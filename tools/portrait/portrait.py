#!/usr/bin/env python3
"""固定角色形象圖的生成腳本（MOSS-Image + ComfyUI）。

流程：角色描述 → 構圖師（LLM，composer.md）→ 版面 JSON → 換成 MOSS 的版面格式
寫進工作流 → 送 ComfyUI → 下載圖片。

同一個角色重跑會得到同一張圖：版面 JSON 存在 out/<id>/layout.json（有就沿用），
種子由角色 id 算出來（或在角色檔裡指定）。要換構圖就加 --recompose，或直接改 layout.json。

只用標準函式庫。用法見 README.md。
"""
from __future__ import annotations

import argparse
import copy
import hashlib
import json
import os
import re
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
import uuid
from pathlib import Path

HERE = Path(__file__).resolve().parent
LABELS = {"character", "object", "text"}
UI_ONLY_WIDGETS = {"control_after_generate", "control_before_generate"}


# ---------------------------------------------------------------- 設定與角色檔

def load_characters(path: Path) -> dict:
    data = json.loads(path.read_text(encoding="utf-8"))
    if isinstance(data, list):
        data = {"characters": data}
    chars = data.get("characters")
    if not isinstance(chars, list) or not chars:
        sys.exit(f"{path}：characters 要是一個不空的陣列")
    seen = set()
    for i, c in enumerate(chars):
        cid = c.get("id")
        if not isinstance(cid, str) or not re.fullmatch(r"[A-Za-z0-9_\-]+", cid or ""):
            sys.exit(f"{path}：第 {i + 1} 個角色的 id 只能用英數、底線、連字號")
        if cid in seen:
            sys.exit(f"{path}：id {cid} 重複")
        seen.add(cid)
        if not isinstance(c.get("description"), str) or not c["description"].strip():
            sys.exit(f"{path}：{cid} 沒有 description")
    return data


def seed_of(char: dict) -> int:
    if isinstance(char.get("seed"), int):
        return char["seed"]
    digest = hashlib.sha256(char["id"].encode("utf-8")).digest()
    return int.from_bytes(digest[:6], "big")


def merge_tags(*parts: str) -> str:
    out, seen = [], set()
    for part in parts:
        for tag in (part or "").split(","):
            t = tag.strip()
            if t and t.lower() not in seen:
                seen.add(t.lower())
                out.append(t)
    return ", ".join(out)


# ---------------------------------------------------------------- 構圖師（LLM）

def strip_to_json(text: str) -> str:
    text = text.strip()
    fence = re.search(r"```(?:json)?\s*(.*?)```", text, re.S)
    if fence:
        text = fence.group(1).strip()
    start, end = text.find("{"), text.rfind("}")
    if start < 0 or end < start:
        raise ValueError("回應裡找不到 JSON 物件")
    return text[start : end + 1]


def check_layout(layout: object) -> list[str]:
    """回傳問題清單；空的表示可以用。"""
    probs: list[str] = []
    if not isinstance(layout, dict):
        return ["整個回應要是一個 JSON 物件"]
    if not isinstance(layout.get("caption"), str) or not layout["caption"].strip():
        probs.append("caption 要是不空的字串")
    if "negative" in layout and not isinstance(layout["negative"], str):
        probs.append("negative 要是字串")
    items = layout.get("items")
    if not isinstance(items, list) or not items:
        probs.append("items 要是不空的陣列")
        return probs
    if not any(isinstance(it, dict) and it.get("label") == "character" for it in items):
        probs.append("items 裡至少要有一個 character 框")
    for i, it in enumerate(items):
        where = f"items[{i}]"
        if not isinstance(it, dict):
            probs.append(f"{where} 要是物件")
            continue
        if it.get("label") not in LABELS:
            probs.append(f"{where}.label 只能是 character、object、text")
        if not isinstance(it.get("caption"), str) or not it["caption"].strip():
            probs.append(f"{where}.caption 要是不空的字串")
        if it.get("label") == "text" and not isinstance(it.get("text"), str):
            probs.append(f"{where} 是 text，要有 text 欄位")
        for axis in ("x", "y"):
            v = it.get(axis)
            if not (isinstance(v, list) and len(v) == 2 and all(isinstance(n, (int, float)) for n in v)):
                probs.append(f"{where}.{axis} 要是兩個數字 [起, 迄]（百分比 0～100）")
            elif max(v) - min(v) <= 0:
                probs.append(f"{where}.{axis} 的範圍是空的")
    return probs


def user_message(char: dict) -> str:
    lines = [char["description"].strip()]
    comp = char.get("composition")
    if comp and "composition" not in char["description"].lower():
        lines.append(f"Composition: {comp}")
    return "\n".join(lines)


def call_llm(cfg: dict, system: str, messages: list[dict]) -> str:
    url = cfg["base"].rstrip("/") + "/chat/completions"
    body = {
        "model": cfg["model"],
        "messages": [{"role": "system", "content": system}, *messages],
        "temperature": cfg.get("temperature", 0.7),
    }
    if cfg.get("json_mode"):
        body["response_format"] = {"type": "json_object"}
    headers = {"Content-Type": "application/json"}
    if cfg.get("key"):
        headers["Authorization"] = f"Bearer {cfg['key']}"
    req = urllib.request.Request(url, json.dumps(body).encode("utf-8"), headers)
    try:
        with urllib.request.urlopen(req, timeout=cfg.get("timeout", 180)) as r:
            data = json.loads(r.read().decode("utf-8"))
    except urllib.error.HTTPError as e:
        raise RuntimeError(f"LLM 回 {e.code}：{e.read().decode('utf-8', 'replace')[:500]}") from e
    try:
        return data["choices"][0]["message"]["content"]
    except (KeyError, IndexError, TypeError) as e:
        raise RuntimeError(f"LLM 的回應看不懂：{json.dumps(data)[:500]}") from e


def compose(char: dict, cfg: dict, system: str, tries: int = 3) -> dict:
    messages = [{"role": "user", "content": user_message(char)}]
    last = ""
    for attempt in range(1, tries + 1):
        reply = call_llm(cfg, system, messages)
        try:
            layout = json.loads(strip_to_json(reply))
            probs = check_layout(layout)
        except (ValueError, json.JSONDecodeError) as e:
            probs = [f"JSON 解析失敗：{e}"]
            layout = None
        if not probs:
            return layout
        last = "；".join(probs)
        print(f"  [{char['id']}] 第 {attempt} 次版面不合格：{last}", file=sys.stderr)
        messages += [
            {"role": "assistant", "content": reply},
            {"role": "user", "content": "這份版面有問題，請修正後只輸出一個 JSON 物件：\n- " + "\n- ".join(probs)},
        ]
    raise RuntimeError(f"{char['id']}：構圖師連續 {tries} 次交不出合格的版面（{last}）")


# ---------------------------------------------------------------- 版面 → MOSS 格式

def clamp_pct(v: float) -> float:
    return max(0.0, min(100.0, float(v)))


def to_bbox(it: dict, width: int, height: int) -> list[int]:
    """百分比（原點左上）→ abs_centralized、yxyx（原點在畫面中心、像素）。"""
    x0, x1 = sorted(clamp_pct(n) for n in it["x"])
    y0, y1 = sorted(clamp_pct(n) for n in it["y"])
    return [
        round(y0 * height / 100 - height / 2),
        round(x0 * width / 100 - width / 2),
        round(y1 * height / 100 - height / 2),
        round(x1 * width / 100 - width / 2),
    ]


def moss_text(layout: dict, style: str, width: int, height: int) -> str:
    items = []
    for it in layout["items"]:
        out = {"label": it["label"], "caption": it["caption"].strip()}
        if it["label"] == "text":
            out["text"] = it["text"]
        out["bbox"] = to_bbox(it, width, height)
        items.append(out)
    caption = layout["caption"].strip()
    if style:
        caption = caption + "\n" + style.strip()
    doc = {
        "summary": {"meta": ["illustration"], "canvas": "single", "caption": caption},
        "items": items,
        "bbox_coord_space": "abs_centralized",
        "bbox_format": "yxyx",
    }
    return json.dumps(doc, ensure_ascii=False)


# ---------------------------------------------------------------- 工作流（UI 格式 → API 格式）

def ui_to_api(ui: dict) -> dict:
    nodes = {n["id"]: n for n in ui["nodes"]}
    links = {l[0]: l for l in ui["links"]}  # [id, from_node, from_slot, to_node, to_slot, type]

    def source(node_id: int, slot_name: str, slot_type: str):
        """跟著連線往回找；略過被 bypass（mode 4）的節點。"""
        node = nodes[node_id]
        for inp in node.get("inputs", []):
            if inp["name"] == slot_name and inp.get("link") is not None:
                lk = links[inp["link"]]
                src = nodes[lk[1]]
                if src.get("mode") == 4:
                    # bypass：找同型別的第一個輸入往上接
                    for sin in src.get("inputs", []):
                        if sin.get("type") == slot_type and sin.get("link") is not None:
                            return source(src["id"], sin["name"], slot_type)
                    return None
                return [str(lk[1]), lk[2]]
        return None

    api: dict = {}
    for n in ui["nodes"]:
        if n.get("mode") in (2, 4):  # 2＝停用、4＝bypass
            continue
        inputs: dict = {}
        named = n.get("widgets_values_named")
        if named is None and n.get("widgets_values"):
            sys.exit(f"節點 {n['id']}（{n['type']}）沒有 widgets_values_named，請用新版 ComfyUI 匯出工作流")
        for k, v in (named or {}).items():
            if k not in UI_ONLY_WIDGETS:
                inputs[k] = v
        for inp in n.get("inputs", []):
            src = source(n["id"], inp["name"], inp.get("type"))
            if src is not None:
                inputs[inp["name"]] = src
        api[str(n["id"])] = {"class_type": n["type"], "inputs": inputs, "_meta": {"title": n.get("title", n["type"])}}
    return api


def find_nodes(api: dict) -> dict:
    sampler = next((k for k, n in api.items() if "positive" in n["inputs"] and "seed" in n["inputs"]), None)
    if sampler is None:
        sys.exit("工作流裡找不到取樣器（要有 seed 與 positive 輸入）")
    pos = api[sampler]["inputs"]["positive"][0]
    neg = api[sampler]["inputs"]["negative"][0]
    latent = api[sampler]["inputs"].get("latent_image", [None])[0]
    save = next((k for k, n in api.items() if n["class_type"] == "SaveImage"), None)
    for name, k in (("正向", pos), ("負向", neg)):
        if "text" not in api[k]["inputs"]:
            sys.exit(f"{name}提示詞的節點 {k} 沒有 text 欄位")
    return {"sampler": sampler, "positive": pos, "negative": neg, "latent": latent, "save": save}


def build_prompt(base_api: dict, ids: dict, text: str, negative: str, seed: int,
                 width: int, height: int, prefix: str) -> dict:
    api = copy.deepcopy(base_api)
    api[ids["positive"]]["inputs"]["text"] = text
    api[ids["negative"]]["inputs"]["text"] = negative
    api[ids["sampler"]]["inputs"]["seed"] = seed
    if ids["latent"] and "width" in api[ids["latent"]]["inputs"]:
        api[ids["latent"]]["inputs"]["width"] = width
        api[ids["latent"]]["inputs"]["height"] = height
        api[ids["latent"]]["inputs"]["batch_size"] = 1
    if ids["save"]:
        api[ids["save"]]["inputs"]["filename_prefix"] = prefix
    return api


# ---------------------------------------------------------------- ComfyUI

def http_json(url: str, payload: dict | None = None, timeout: int = 60) -> dict:
    data = json.dumps(payload).encode("utf-8") if payload is not None else None
    req = urllib.request.Request(url, data, {"Content-Type": "application/json"} if data else {})
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            return json.loads(r.read().decode("utf-8"))
    except urllib.error.HTTPError as e:
        raise RuntimeError(f"{url} 回 {e.code}：{e.read().decode('utf-8', 'replace')[:800]}") from e


def run_comfy(server: str, prompt: dict, out_dir: Path, stem: str, poll: float = 1.5, limit: float = 900) -> list[Path]:
    server = server.rstrip("/")
    res = http_json(server + "/prompt", {"prompt": prompt, "client_id": uuid.uuid4().hex})
    if res.get("node_errors"):
        raise RuntimeError(f"ComfyUI 拒絕這份工作流：{json.dumps(res['node_errors'], ensure_ascii=False)[:800]}")
    pid = res["prompt_id"]
    started = time.time()
    while True:
        hist = http_json(f"{server}/history/{pid}")
        if pid in hist:
            entry = hist[pid]
            status = entry.get("status", {})
            if status.get("status_str") == "error":
                raise RuntimeError(f"ComfyUI 執行失敗：{json.dumps(status.get('messages', []), ensure_ascii=False)[:800]}")
            if status.get("completed", True):
                break
        if time.time() - started > limit:
            raise RuntimeError(f"等了 {int(limit)} 秒還沒畫完（prompt_id {pid}）")
        time.sleep(poll)
    saved: list[Path] = []
    for node_out in entry.get("outputs", {}).values():
        for img in node_out.get("images", []):
            if img.get("type") != "output":
                continue
            q = urllib.parse.urlencode({"filename": img["filename"], "subfolder": img.get("subfolder", ""), "type": "output"})
            with urllib.request.urlopen(f"{server}/view?{q}", timeout=120) as r:
                blob = r.read()
            ext = Path(img["filename"]).suffix or ".png"
            dest = out_dir / f"{stem}{'' if not saved else f'_{len(saved)}'}{ext}"
            dest.write_bytes(blob)
            saved.append(dest)
    if not saved:
        raise RuntimeError("畫完了但沒有輸出圖片（工作流要有 SaveImage）")
    return saved


# ---------------------------------------------------------------- 主程式

def main() -> None:
    ap = argparse.ArgumentParser(description="固定角色形象圖（MOSS-Image + ComfyUI）")
    ap.add_argument("characters", type=Path, help="角色檔（JSON），格式見 characters.example.json")
    ap.add_argument("--only", nargs="*", help="只做這幾個 id")
    ap.add_argument("--out", type=Path, default=HERE / "out", help="輸出資料夾（預設 tools/portrait/out）")
    ap.add_argument("--workflow", type=Path, default=HERE / "workflow.json", help="ComfyUI 匯出的工作流（UI 格式）")
    ap.add_argument("--composer", type=Path, default=HERE / "composer.md", help="構圖師的提示詞")
    ap.add_argument("--server", default=os.environ.get("COMFY_URL", "http://127.0.0.1:8188"), help="ComfyUI 位址")
    ap.add_argument("--recompose", action="store_true", help="不沿用 layout.json，重新請構圖師排版")
    ap.add_argument("--layout-only", action="store_true", help="只排版、不生圖（排完可以先手改 layout.json）")
    ap.add_argument("--dry-run", action="store_true", help="不送 ComfyUI，只把要送的工作流寫成 prompt.json")
    ap.add_argument("--count", type=int, help="每個角色生幾張（覆蓋角色檔；第 n 張用 種子+n）")
    ap.add_argument("--json-mode", action="store_true", help="請 LLM 用 response_format=json_object（後端支援才開）")
    args = ap.parse_args()

    conf = load_characters(args.characters)
    width = int(conf.get("width", 1152))
    height = int(conf.get("height", 1536))
    style = conf.get("style", "anime illustration, clean lineart, high detail")
    base_negative = conf.get("negative", "")
    system = args.composer.read_text(encoding="utf-8")

    llm = {
        "base": os.environ.get("PORTRAIT_LLM_BASE", "https://api.openai.com/v1"),
        "key": os.environ.get("PORTRAIT_LLM_KEY", ""),
        "model": os.environ.get("PORTRAIT_LLM_MODEL", ""),
        "temperature": float(os.environ.get("PORTRAIT_LLM_TEMPERATURE", "0.7")),
        "json_mode": args.json_mode,
    }

    ui = json.loads(args.workflow.read_text(encoding="utf-8"))
    base_api = ui_to_api(ui)
    ids = find_nodes(base_api)

    chars = conf["characters"]
    if args.only:
        wanted = set(args.only)
        missing = wanted - {c["id"] for c in chars}
        if missing:
            sys.exit(f"角色檔裡沒有：{', '.join(sorted(missing))}")
        chars = [c for c in chars if c["id"] in wanted]

    failed = []
    for char in chars:
        cid = char["id"]
        cdir = args.out / cid
        cdir.mkdir(parents=True, exist_ok=True)
        layout_path = cdir / "layout.json"
        try:
            if layout_path.exists() and not args.recompose:
                layout = json.loads(layout_path.read_text(encoding="utf-8"))
                probs = check_layout(layout)
                if probs:
                    raise RuntimeError(f"{layout_path} 有問題：{'；'.join(probs)}")
                print(f"[{cid}] 沿用 {layout_path}")
            else:
                if not llm["model"]:
                    raise RuntimeError("沒有設定 PORTRAIT_LLM_MODEL（也可以手寫 layout.json 再跑）")
                print(f"[{cid}] 請構圖師排版……")
                layout = compose(char, llm, system)
                layout_path.write_text(json.dumps(layout, ensure_ascii=False, indent=2), encoding="utf-8")
            if args.layout_only:
                continue

            text = moss_text(layout, char.get("style", style), width, height)
            negative = merge_tags(base_negative, char.get("negative", ""), layout.get("negative", ""))
            seed = seed_of(char)
            count = args.count or int(char.get("count", 1))
            for n in range(count):
                s = seed + n
                stem = f"{cid}_{s}"
                prompt = build_prompt(base_api, ids, text, negative, s, width, height, f"portrait/{cid}")
                if args.dry_run:
                    (cdir / f"{stem}.prompt.json").write_text(json.dumps(prompt, ensure_ascii=False, indent=2), encoding="utf-8")
                    print(f"[{cid}] 寫好 {cdir / (stem + '.prompt.json')}（種子 {s}）")
                    continue
                print(f"[{cid}] 生圖中（種子 {s}）……")
                for p in run_comfy(args.server, prompt, cdir, stem):
                    print(f"[{cid}] 存好 {p}")
        except Exception as e:  # noqa: BLE001 — 一個角色失敗不擋其他角色
            print(f"[{cid}] 失敗：{e}", file=sys.stderr)
            failed.append(cid)
    if failed:
        sys.exit(f"失敗的角色：{', '.join(failed)}")


if __name__ == "__main__":
    main()
