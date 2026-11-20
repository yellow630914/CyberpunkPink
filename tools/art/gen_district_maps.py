#!/usr/bin/env python3
"""各區的街區圖：每區一張，比街區結構圖（district-blocks.svg）細一級。
  docs/art/street-<區>.svg
- 街區、要地、橋接區的位置照 gen_maps.py 的 DISTRICTS（欄、列與連接），所以和 district-blocks.svg 對得起來。
- 每塊街區畫成 13 × 9 格（DISTRICTS 1.3 節）：一條橫的大街、兩條直的巷子、兩個路口，街與街之間是六塊店面。
- 店面裡的設施讀自 SITES 第 2～9 節的表（「設施」欄），每一個配一個設施圖標（subjects/basics.py 的 FACILITY_KEYWORDS）；
  粗體的地標用區的顏色。「→」的出口：連到隔壁街區、要地、橋接區的畫成街道；車站、地下層入口、豎井放進店面。
- 示意：店面的位置是排版，不是定案；實作時照每塊的格子地圖。
用法：python3 tools/art/gen_district_maps.py   （SITES 或 DISTRICTS 改了就重跑）"""
import math, os, re, sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
from gen_maps import DISTRICTS, FONT, BG, INK, INK2, INK3, LINE, GATE, RED, MINT, PINK  # noqa: E402
from subjects.basics import facility_icon  # noqa: E402

ROOT = os.path.abspath(os.path.join(HERE, '../..'))
OUT = os.path.join(ROOT, 'docs', 'art')
SLUG = {'蜂巢': 'hive', '四十二番街': 'banchi', '櫻町': 'sakuramachi', '冠冕區': 'crown', '舊港': 'oldport', '玻璃岸': 'glassshore', '鏽帶': 'rustbelt', '地下層': 'underlayer'}
SITES_SEC = {'蜂巢': '2', '四十二番街': '3', '櫻町': '4', '冠冕區': '5', '舊港': '6', '玻璃岸': '7', '鏽帶': '8', '地下層': '9'}
CELL = 32
BW, BH = 13 * CELL, 9 * CELL          # 一塊街區
VX = (4, 8)                            # 直的巷子在第 4、8 欄
HY = 4                                 # 橫的大街在第 4 列
ROAD = '#2a2140'


def split_top(s):
    """用頓號切，括號與引號裡的頓號不切。"""
    out, depth, cur = [], 0, ''
    for ch in s:
        if ch in '（「(':
            depth += 1
        elif ch in '）」)':
            depth -= 1
        if ch == '、' and depth == 0:
            out.append(cur.strip())
            cur = ''
        else:
            cur += ch
    if cur.strip():
        out.append(cur.strip())
    return out


def plain(s):
    return re.sub(r'\[([^\]]+)\]\([^)]+\)', r'\1', s)


def read_blocks():
    """SITES 第 2～9 節：{街區名: (是什麼, 深度標, [(設施名, 是不是地標)])}。"""
    out, sec = {}, ''
    for l in open(os.path.join(ROOT, 'docs', 'world', 'SITES.md'), encoding='utf-8'):
        m = re.match(r'^## (\d+)\.', l)
        if m:
            sec = m.group(1)
        if sec in SITES_SEC.values() and l.startswith('| **'):
            c = [x.strip() for x in l.strip().strip('|').split('|')]
            m = re.match(r'\*\*(.+?)\*\*(?:（(.+?)）)?', c[0])
            name, tag = m.group(1), m.group(2) or ''
            facs = []
            raw = plain(c[2]).replace('固定的只有：', '')
            raw = re.sub(r'；其餘.*', '', raw)
            for f in split_top(raw):
                bold = f.startswith('**') or f.startswith('→ **')
                f = f.replace('**', '')
                if not f.startswith('→'):
                    f = re.sub(r'（[^）]*）', '', f).strip()
                else:
                    f = re.sub(r'（第 \d+ 節）', '', f).strip()
                facs.append((f, bold))
            out[name] = (plain(c[1]).replace('**', ''), tag, facs)
    return out


def read_sites():
    """DISTRICTS 1.3 節的要地欄：{要地名: 括號裡的說明}。"""
    out = {}
    text = open(os.path.join(ROOT, 'docs', 'world', 'DISTRICTS.md'), encoding='utf-8').read()
    for m in re.finditer(r'\*\*([^*]+?)\*\*（([^）]*?層[^）]*?)）', text):
        out.setdefault(m.group(1), m.group(2))
    return out


def symbols(ids):
    sprite = open(os.path.join(ROOT, 'docs', 'art', 'style', 'icons-sprite.svg'), encoding='utf-8').read()
    out = []
    for i in sorted(ids):
        m = re.search(rf'<symbol id="ic-{i}".*?</symbol>', sprite, re.S)
        if m:
            out.append(m.group(0))
    return ''.join(out)


def esc(s):
    return s.replace('&', '&amp;').replace('<', '&lt;')


def text_w(s, size):
    return sum(size * (0.58 if ord(ch) < 128 else 1.0) for ch in s)


def wrap(s, size, width, lines=2):
    out, cur = [], ''
    for ch in s:
        if text_w(cur + ch, size) > width:
            out.append(cur)
            cur = ch
        else:
            cur += ch
    out.append(cur)
    if len(out) > lines:
        out = out[:lines]
        out[-1] = out[-1][:-1] + '…'
    return out


def district_map(name, col, ncols, nodes, edges, blocks, sites):
    rows = 1 + max(n[3] for n in nodes)
    cols = 1 + max(n[2] for n in nodes)
    has_b_col = [any(n[0] == 'B' and n[2] == c for n in nodes) for c in range(cols)]
    has_b_row = [any(n[0] == 'B' and n[3] == r for n in nodes) for r in range(rows)]
    GX, GY = 150, 150
    cw = [BW if b else 250 for b in has_b_col]
    rh = [BH + 40 if b else 150 for b in has_b_row]
    X0, Y0 = 60, 200
    xs = [X0 + sum(cw[:c]) + GX * c for c in range(cols)]
    ys = [Y0 + sum(rh[:r]) + GY * r for r in range(rows)]
    W = xs[-1] + cw[-1] + 60
    H = ys[-1] + rh[-1] + 150
    W = max(W, 1500)

    def key(n):
        return n[1] if n[0] == 'X' and n[1].startswith('入口|') else n[1].split('|')[0]

    geo, grid = {}, {}  # key → (kind, x, y, w, h)、(欄, 列)
    for n in nodes:
        c, r = n[2], n[3]
        cx, cy = xs[c] + cw[c] / 2, ys[r] + rh[r] / 2 + (20 if has_b_row[r] else 0)
        if n[0] == 'B':
            w, h = BW, BH
        elif n[0] == 'S':
            w, h = 230, 120
        else:
            w, h = 210, 64
        geo[key(n)] = (n[0], cx - w / 2, cy - h / 2, w, h)
        grid[key(n)] = (c, r)

    o = [f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {W} {H}" width="{W}" height="{H}" font-family="{FONT}">',
         f'<title>{name} 街區圖 v0</title>']
    used = {'fac_metro', 'fac_under', 'fac_gate'}
    body = []

    # ---- 街道（區內的連接） ----
    def anchor(k, other):
        kind, x, y, w, h = geo[k]
        _, ox, oy, ow, oh = geo[other]
        cx, cy, ocx, ocy = x + w / 2, y + h / 2, ox + ow / 2, oy + oh / 2
        dx, dy = ocx - cx, ocy - cy
        if grid[k][1] == grid[other][1]:  # 同一列：左右接；不同列：一律從上下接，轉彎放在列與列之間的空地
            return ('h', x + (w if dx > 0 else 0), cy)
        if kind == 'B':
            sx = x + (VX[0] + .5) * CELL if dx < -10 else x + (VX[1] + .5) * CELL
        elif geo[other][0] == 'B' and grid[k][0] == grid[other][0]:
            sx = ox + (VX[1] + .5) * CELL  # 正上下方是街區：對齊它的巷子，路直直下去
        else:
            sx = cx
        return ('v', sx, y + (h if dy > 0 else 0))

    road_paths, pills, junctions = [], [], []
    for e in edges:
        a, b = e[0], e[1]
        (oa, x1, y1), (ob, x2, y2) = anchor(a, b), anchor(b, a)
        if oa == 'h' and ob == 'h':
            mx = (x1 + x2) / 2
            pts = [(x1, y1), (mx, y1), (mx, y2), (x2, y2)]
        elif oa == 'v' and ob == 'v':
            my = (y1 + y2) / 2
            pts = [(x1, y1), (x1, my), (x2, my), (x2, y2)]
        elif oa == 'h':
            pts = [(x1, y1), (x2, y1), (x2, y2)]
        else:
            pts = [(x1, y1), (x1, y2), (x2, y2)]
        d = 'M' + 'L'.join(f'{x:.0f} {y:.0f}' for x, y in pts)
        road_paths.append(d)
        for k, (px, py) in ((a, (x1, y1)), (b, (x2, y2))):
            if geo[k][0] == 'B':
                junctions.append((px, py))
        if len(e) > 2:
            # 標在最長的一段的中點
            segs = list(zip(pts, pts[1:]))
            (p, q) = max(segs, key=lambda s: math.hypot(s[1][0] - s[0][0], s[1][1] - s[0][1]))
            pills.append(((p[0] + q[0]) / 2, (p[1] + q[1]) / 2, e[2]))
    for d in road_paths:
        body.append(f'<path d="{d}" fill="none" stroke="{col}" stroke-opacity=".45" stroke-width="22" stroke-linejoin="round"/>'
                    f'<path d="{d}" fill="none" stroke="{ROAD}" stroke-width="18" stroke-linejoin="round"/>'
                    f'<path d="{d}" fill="none" stroke="{INK3}" stroke-width="1.5" stroke-dasharray="6 8"/>')

    # ---- 節點 ----
    edge_words = {}
    for e in edges:
        for k, other in ((e[0], e[1]), (e[1], e[0])):
            edge_words.setdefault(k, []).append(other.split('|')[0])
            if len(e) > 2:
                edge_words[k].append(e[2])
    for n in nodes:
        k = key(n)
        kind, x, y, w, h = geo[k]
        label = n[1].split('|')
        if kind == 'B':
            what, tag, facs = blocks.get(k, ('', '', []))
            # 出口：連到圖上其他節點的畫成街道，其餘放進店面
            lots = []
            for f, bold in facs:
                if f.startswith('→'):
                    t = f[1:].strip()
                    ic = facility_icon(t)
                    if ic not in ('fac_metro', 'fac_ferry', 'fac_bus', 'fac_under') and any(wd and (wd in t or t in wd) for wd in edge_words.get(k, [])):
                        continue
                    if ic not in ('fac_metro', 'fac_ferry', 'fac_bus', 'fac_under'):
                        ic = 'fac_under' if re.search('入口|迷宮|洞|豎井|隧道|排水', t) else 'fac_gate'
                    lots.append((t, False, ic, True))
                else:
                    lots.append((f, bold, facility_icon(f), False))
            if n[4:] == ('R',) or (len(n) > 4 and n[4] == 'R'):
                lots.append(('其餘 4～8 個每天隨機', False, None, False))
            body.append(block(x, y, col, lots, used))
            # 名字與說明
            body.append(f'<text x="{x}" y="{y - 30}" font-size="22" font-weight="800" fill="{col}" letter-spacing="2">{esc(k)}'
                        + (f'<tspan font-size="13" font-weight="600" fill="{INK2}" dx="10">{esc(tag)}</tspan>' if tag else '')
                        + (f'<tspan font-size="13" font-weight="600" fill="{INK2}" dx="10">◇ 隨機生成</tspan>' if len(n) > 4 and n[4] == 'R' else '') + '</text>')
            body.append(f'<text x="{x}" y="{y - 10}" font-size="12.5" fill="{INK2}">{esc(wrap(what, 12.5, BW, 1)[0])}</text>')

        elif kind == 'S':
            c = 16
            d = f'M{x + c} {y}H{x + w - c}L{x + w} {y + c}V{y + h}H{x}V{y + c}Z'
            body.append(f'<path d="{d}" fill="#1b1430"/><path d="{d}" fill="{RED}" fill-opacity=".12" stroke="{RED}" stroke-width="2" stroke-dasharray="7 4"/>')
            body.append(f'<text x="{x + w / 2}" y="{y + 44}" text-anchor="middle" font-size="19" font-weight="800" fill="#ffb3c0">{esc(k)}</text>')
            sub = sites.get(k, '')
            for i, ln in enumerate(wrap(sub, 12, w - 24, 2)):
                body.append(f'<text x="{x + w / 2}" y="{y + 70 + i * 17}" text-anchor="middle" font-size="12" fill="{INK2}">{esc(ln)}</text>')
            body.append(f'<text x="{x + 12}" y="{y + h - 10}" font-size="10.5" fill="{RED}" fill-opacity=".8" letter-spacing="1">要地</text>')
        else:
            body.append(f'<rect x="{x}" y="{y}" width="{w}" height="{h}" rx="{h / 2}" fill="#1b1430"/>'
                        f'<rect x="{x}" y="{y}" width="{w}" height="{h}" rx="{h / 2}" fill="{GATE}" fill-opacity=".12" stroke="{GATE}" stroke-width="2"/>')
            body.append(f'<use href="#ic-fac_gate" x="{x + 14}" y="{y + h / 2 - 16}" width="32" height="32" style="--o:#17111F;--a:#F06AA0;--b:#c9a54a;--c:#ffe9a8"/>')
            body.append(f'<text x="{x + 54}" y="{y + 28}" font-size="15" font-weight="800" fill="{GATE}">{esc(label[0])}</text>')
            if len(label) > 1:
                body.append(f'<text x="{x + 54}" y="{y + 47}" font-size="12" fill="{GATE}" fill-opacity=".8">{esc(label[1])}</text>')
    for px, py in junctions:
        body.append(f'<circle cx="{px:.0f}" cy="{py:.0f}" r="9" fill="{BG}" stroke="{col}" stroke-width="3"/><circle cx="{px:.0f}" cy="{py:.0f}" r="3" fill="{col}"/>')
    for mx, my, t in pills:
        w = text_w(t, 13) + 24
        body.append(f'<rect x="{mx - w / 2:.0f}" y="{my - 12:.0f}" width="{w:.0f}" height="24" rx="12" fill="{BG}" stroke="{INK2}" stroke-width="1.5"/>'
                    f'<text x="{mx:.0f}" y="{my + 5:.0f}" text-anchor="middle" font-size="13" fill="{INK}">{esc(t)}</text>')

    # ---- 底、標題、圖例 ----
    o.append('<defs><style>.s{stroke:var(--o);stroke-width:9;stroke-linejoin:round;stroke-linecap:round;paint-order:stroke}</style>'
             '<pattern id="g" width="32" height="32" patternUnits="userSpaceOnUse"><path d="M32 0H0V32" fill="none" stroke="#fff" stroke-opacity=".025"/></pattern>'
             '<filter id="glow" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="6" result="b"/><feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge></filter>'
             + symbols(used) + '</defs>')
    o.append(f'<rect width="{W}" height="{H}" fill="{BG}"/><rect width="{W}" height="{H}" fill="url(#g)"/>')
    o.append(f'<path d="M0 0H{W}V6H0Z" fill="{col}"/>')
    o.append(f'<text x="60" y="78" font-size="42" font-weight="900" fill="{col}" letter-spacing="6" filter="url(#glow)">{name}</text>')
    o.append(f'<text x="{60 + text_w(name, 42) + 6 * len(name) + 20:.0f}" y="78" font-size="22" font-weight="700" fill="{INK}" letter-spacing="3">街區圖</text>')
    nb = sum(1 for n in nodes if n[0] == 'B')
    ns = sum(1 for n in nodes if n[0] == 'S')
    nx = sum(1 for n in nodes if n[0] == 'X')
    o.append(f'<text x="60" y="110" font-size="14" fill="{INK2}" letter-spacing="1">街區 {nb} · 要地 {ns} · 出口 {nx}　·　一塊街區 13 × 9 格，一格是一間店面或一段街，走一格 {'10' if name == '鏽帶' else '2'} 分鐘　·　位置照街區結構圖（連接關係，不是實際方位）　·　示意 v0</text>')
    # 圖例
    lx, ly = W - 60 - 700, 40
    leg = [
        (f'<rect x="0" y="-9" width="40" height="18" fill="{ROAD}" stroke="{col}" stroke-opacity=".6" stroke-width="2"/>', '街道'),
        (f'<circle cx="20" cy="0" r="8" fill="{BG}" stroke="{col}" stroke-width="3"/><circle cx="20" cy="0" r="3" fill="{col}"/>', '路口'),
        (f'<rect x="0" y="-11" width="40" height="22" rx="11" fill="{BG}" stroke="{INK2}" stroke-width="1.5"/>', '區內的橋接區'),
        (f'<rect x="0" y="-11" width="40" height="22" rx="11" fill="{GATE}" fill-opacity=".14" stroke="{GATE}" stroke-width="1.5"/>', '大區之間的出口'),
        (f'<path d="M6 -11H34L40 -5V11H0V-5Z" fill="{RED}" fill-opacity=".14" stroke="{RED}" stroke-width="2" stroke-dasharray="5 3"/>', '要地'),
        (f'<text x="0" y="5" font-size="13" font-weight="800" fill="{col}">粗名</text>', '有名字的地標'),
    ]
    for i, (sym, t) in enumerate(leg):
        gx, gy = lx + (i % 3) * 240, ly + (i // 3) * 34 + 14
        o.append(f'<g transform="translate({gx} {gy})">{sym}<text x="52" y="5" font-size="13" fill="{INK2}">{t}</text></g>')
    o.append(f'<text x="{lx}" y="{ly + 92}" font-size="12" fill="{INK3}">店面裡的小圖是設施的種類（圖標與 ART_STYLE 5.1 節的設施圖標同一套）</text>')
    o += body
    o.append(f'<text x="60" y="{H - 40}" font-size="13" fill="{INK3}">資料：SITES 第 {SITES_SEC[name]} 節（每塊街區的設施）、DISTRICTS 1.3 節（要地與區內的橋接區）。由 tools/art/gen_district_maps.py 產生。</text>')
    o.append('</svg>')
    return '\n'.join(o)


def block(x, y, col, lots, used):
    """一塊 13 × 9 的街區：大街、巷子、六塊店面，每塊店面放兩個（多的時候三個）設施。"""
    o = [f'<g>']
    o.append(f'<rect x="{x - 4}" y="{y - 4}" width="{BW + 8}" height="{BH + 8}" fill="none" stroke="{col}" stroke-opacity=".5" stroke-width="2"/>')
    o.append(f'<rect x="{x}" y="{y}" width="{BW}" height="{BH}" fill="{ROAD}"/>')
    regions = []
    xr = [(0, VX[0]), (VX[0] + 1, VX[1]), (VX[1] + 1, 13)]
    yr = [(0, HY), (HY + 1, 9)]
    for (r0, r1) in yr:
        for (c0, c1) in xr:
            regions.append((x + c0 * CELL + 3, y + r0 * CELL + 3, (c1 - c0) * CELL - 6, (r1 - r0) * CELL - 6))
    # 寬的店面先放長的名字
    order = sorted(range(6), key=lambda i: -regions[i][2])
    k = max(2, math.ceil(len(lots) / 6))
    slots = []
    cnt = [0] * 6
    for t in range(len(lots)):  # 輪流分給六塊店面（寬的先），每塊最多 k 個
        cnt[order[t % 6]] += 1
    for i in order:
        rx, ry, rw, rhh = regions[i]
        m = max(cnt[i], 1)
        for j in range(cnt[i]):
            slots.append((rx, ry + j * rhh / m, rw, rhh / m))
    slots.sort(key=lambda s: -s[2])  # 長的名字進寬的店面
    for rx, ry, rw, rhh in regions:
        o.append(f'<rect x="{rx}" y="{ry}" width="{rw}" height="{rhh}" fill="#1b1430" stroke="{col}" stroke-opacity=".22"/>')
    # 街道的中線與路口
    o.append(f'<path d="M{x} {y + (HY + .5) * CELL}H{x + BW}" stroke="{INK3}" stroke-width="1.5" stroke-dasharray="6 8"/>')
    for c in VX:
        o.append(f'<path d="M{x + (c + .5) * CELL} {y}V{y + BH}" stroke="{INK3}" stroke-width="1.2" stroke-dasharray="4 7"/>')
        o.append(f'<circle cx="{x + (c + .5) * CELL}" cy="{y + (HY + .5) * CELL}" r="7" fill="{BG}" stroke="{col}" stroke-width="2.5"/>')
    items = sorted(lots, key=lambda t: -text_w(t[0], 12))
    # 長名字進寬的店面，但地標盡量排前面
    for (name, bold, ic, is_exit), (sx, sy, sw, sh) in zip(items, slots):
        isz = 30 if sh >= 52 else 24
        isz = 34 if sh >= 100 else isz
        cy = sy + sh / 2
        if ic:
            used.add(ic)
            st = '--o:#17111F;--a:#F06AA0;--b:#8E7CC3;--c:#F3E9FF'
            if bold:
                st = f'--o:#17111F;--a:#F06AA0;--b:{col};--c:#FFF6FB'
            if is_exit:
                st = f'--o:#17111F;--a:#F06AA0;--b:{MINT if ic == "fac_under" else "#c9a54a"};--c:#F3E9FF'
            o.append(f'<use href="#ic-{ic}" x="{sx + 5:.0f}" y="{cy - isz / 2:.0f}" width="{isz}" height="{isz}" style="{st}"/>')
        else:
            o.append(f'<rect x="{sx + 7:.0f}" y="{cy - 10:.0f}" width="20" height="20" rx="3" fill="none" stroke="{INK3}" stroke-dasharray="3 3"/>')
        tx = sx + isz + 10
        size = 13
        lines = wrap(name, size, sw - isz - 12, 2)
        fill = col if bold else (MINT if is_exit and ic == 'fac_under' else (GATE if is_exit else INK))
        fw = 800 if bold else 500
        y0 = cy - (len(lines) - 1) * 8 + 4.5
        for i, ln in enumerate(lines):
            o.append(f'<text x="{tx:.0f}" y="{y0 + i * 16:.0f}" font-size="{size}" font-weight="{fw}" fill="{fill}">{esc(ln)}</text>')
    if len(items) > len(slots):
        print('  放不下：', [t[0] for t in items[len(slots):]])
    o.append('</g>')
    return '\n'.join(o)


def main():
    os.makedirs(OUT, exist_ok=True)
    blocks, sites = read_blocks(), read_sites()
    for name, col, ncols, nodes, edges in DISTRICTS:
        missing = [n[1] for n in nodes if n[0] == 'B' and n[1] not in blocks]
        if missing:
            print('  SITES 沒有這幾塊：', missing)
        svg = district_map(name, col, ncols, nodes, edges, blocks, sites)
        path = os.path.join(OUT, 'street-' + SLUG[name] + '.svg')
        open(path, 'w', encoding='utf-8').write(svg)
        print('→', os.path.relpath(path, ROOT))


if __name__ == '__main__':
    main()
