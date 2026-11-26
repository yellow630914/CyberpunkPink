# 固定角色形象圖（MOSS-Image + ComfyUI）

角色描述 → 構圖師（LLM，`composer.md`）→ 版面 JSON → 換成 MOSS 的版面格式寫進 `workflow.json` → 送 ComfyUI → 存圖。

## 準備

- ComfyUI 開著，裝好 `workflow.json` 用到的模型與 LoRA（MOSS image base、qwen3.5 文字編碼、flux2 小 VAE、三個 MOSS LoRA）。
- 一個 OpenAI 相容的聊天端點當構圖師（OpenAI、OpenRouter、本機的 LM Studio／Ollama 的 `/v1` 都可以）。
- Python 3.9 以上，只用標準函式庫。

```bash
export PORTRAIT_LLM_BASE=https://api.openai.com/v1
export PORTRAIT_LLM_KEY=你的金鑰
export PORTRAIT_LLM_MODEL=模型名稱
export COMFY_URL=http://127.0.0.1:8188
```

## 用法

```bash
python3 tools/portrait/portrait.py tools/portrait/characters.example.json
```

- `--only id1 id2`：只做這幾個角色。
- `--layout-only`：只排版，存在 `out/<id>/layout.json`，可以先手改再生圖。
- `--recompose`：不沿用舊的 layout.json，重新排版。
- `--count N`：每個角色生 N 張（第 n 張用 種子＋n）。
- `--dry-run`：不送 ComfyUI，把要送的工作流寫成 `out/<id>/<id>_<種子>.prompt.json`。
- `--json-mode`：請 LLM 用 `response_format: json_object`（後端支援才開）。
- `--workflow`、`--composer`、`--server`、`--out`：換工作流、構圖師提示詞、ComfyUI 位址、輸出資料夾。

## 「固定」怎麼做到

- 版面存在 `out/<id>/layout.json`，有就沿用，不會每次重排。
- 種子由角色 id 算出來（也可以在角色檔寫 `seed`）。同一個 id、同一份版面、同一個工作流，畫出來是同一張。
- 想換一張：改 `seed`、加 `--recompose`，或直接改 layout.json。

## 角色檔

見 `characters.example.json`：

| 欄位 | 說明 |
|---|---|
| `width`、`height` | 畫布大小（預設 1152 × 1536） |
| `style` | 畫質詞與畫風，程式接在 caption 後面（構圖師不寫這些） |
| `negative` | 共用的負面標籤；年齡相關的標籤預設帶著，可以改 |
| `characters[].id` | 英數、底線、連字號；也是輸出資料夾名 |
| `characters[].description` | 角色形象描述。種族後面括號裡的英文標籤會原樣寫進圖；標成「穿在裡面」的內衣不會畫成露出來 |
| `characters[].composition` | `upper body`、`cowboy shot`、`full body`（描述裡已經寫了 Composition 就不用） |
| `characters[].seed`、`count`、`style`、`negative` | 選填，覆蓋共用的設定；`negative` 是加在共用的後面 |

## 版面怎麼換成 MOSS 的格式

構圖師給的框是百分比、原點在左上（`x: [左, 右]`、`y: [上, 下]`）。程式換成工作流要的 `abs_centralized`、`yxyx`：原點在畫面中心、單位是像素，`bbox = [上, 左, 下, 右]`。`text` 框多帶 `text` 欄位。負面標籤＝共用 ＋ 角色 ＋ 這張圖專屬的，去重。

## 換工作流

用 ComfyUI 存成一般的工作流 JSON（不是 API 格式）。程式自己轉成 API 格式：

- 從取樣器（有 `seed` 與 `positive` 的節點）的 positive、negative 連線找正向、負向提示詞的節點，改它們的 `text`。
- 改取樣器的 `seed`、空 latent 的 `width`、`height`，`SaveImage` 的 `filename_prefix` 改成 `portrait/<id>`。
- 停用（mode 2）的節點拿掉；bypass（mode 4）的節點照同型別的輸入接過去。
- 需要 `widgets_values_named`（新版 ComfyUI 匯出才有）。
