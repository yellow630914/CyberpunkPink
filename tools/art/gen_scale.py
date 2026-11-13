#!/usr/bin/env python3
"""產生 docs/art/map-scale.svg：地圖的三層規模示意（城市 → 街區 → 一塊街區的格子）。
用法：python3 tools/art/gen_scale.py"""
import os
ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '../..'))
FONT = "'Noto Sans TC','PingFang TC','Microsoft JhengHei','WenQuanYi Zen Hei',sans-serif"

GRID = [
    "######2######",
    "#A.K.ooo.M.T#",
    "#..#.ooo.#..#",
    "#...........3",
    "1...F.F.F...#",
    "#C.........D#",
    "#..#.....#..#",
    "#S.G..E..L.B#",
    "######4######",
]
TILES = {  # 字 → (顏色, 標籤)
    'A': ('#ff4fa3', '阿蓮雜貨'), 'K': ('#ff8fc8', '桃子屋'), 'M': ('#e08a45', '黑市攤'),
    'T': ('#ff3355', '地鐵站'), 'F': ('#ffd66b', '攤販'), 'C': ('#4fd8ff', '縫縫診所'),
    'D': ('#b9a6ff', '四號塔'), 'S': ('#b9a6ff', '膠囊旅館'), 'G': ('#ffd66b', '扭蛋機'),
    'E': ('#5dffb0', '地下層入口'), 'L': ('#5dffb0', '輕軌站'), 'B': ('#efe9f7', '佈告欄'),
}
LINKS = {'1': '往霓虹腸・尾', '2': '往屋頂村', '3': '往東側', '4': '往高架橋下'}

DISTRICTS = [  # 名稱, 顏色, 街區
    ('蜂巢', '#b9a6ff', ['天井市場', '四號塔', '東側', '屋頂村', '西棟']),
    ('霓虹腸', '#ff4fa3', ['頭段', '腹段・北', '腹段・南', '刀巷', '尾段', '旅館坡']),
    ('櫻町', '#ffb7d5', ['劇場通', '千本通', '電器街', '社宅群', '神社坡']),
    ('冠冕區', '#ffd66b', ['中央廣場', '空中花園', '濱海', '服務層']),
    ('舊港', '#8fa3bd', ['碼頭', '貨櫃城', '倉庫區', '彈坑灣', '夜市碼頭']),
    ('玻璃岸', '#9fe8ff', ['別墅區', '俱樂部街', '遊艇碼頭']),
    ('鏽帶', '#e08a45', ['東門外', '廠前鎮', '薔薇驛', '骨場', '機甲墳場']),
    ('地下層', '#5dffb0', ['月台市', '排水大廳', '轉播站', '書店街', '骨幹', '聖堂前']),
]

W, H, C = 1600, 1000, 62
ox, oy = 60, 190
o = [f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {W} {H}" width="{W}" height="{H}" font-family="{FONT}">',
     '<title>地圖規模示意 v0</title>',
     f'<rect width="{W}" height="{H}" fill="#0d0a14"/>',
     '<defs><pattern id="g" width="40" height="40" patternUnits="userSpaceOnUse"><path d="M40 0H0V40" fill="none" stroke="#fff" stroke-opacity=".03"/></pattern></defs>',
     f'<rect width="{W}" height="{H}" fill="url(#g)"/>',
     '<text x="60" y="70" font-size="38" font-weight="900" fill="#ff4fa3" letter-spacing="5">地圖規模</text>',
     '<text x="60" y="100" font-size="14" fill="#b8adc9" letter-spacing="2">城市 8 區 → 39 塊街區 → 每塊 13 × 9 格　·　示意 v0</text>',
     f'<text x="{ox}" y="{oy-22}" font-size="18" font-weight="700" fill="#b9a6ff" letter-spacing="3">一塊街區：蜂巢・天井市場（13 × 9）</text>']
for r, row in enumerate(GRID):
    for c, ch in enumerate(row):
        x, y = ox + c * C, oy + r * C
        if ch == '#':
            o.append(f'<rect x="{x}" y="{y}" width="{C}" height="{C}" fill="#241b36" stroke="#0d0a14" stroke-width="2"/>')
            o.append(f'<path d="M{x+8} {y+C-8}L{x+C-8} {y+8}" stroke="#3a2d52" stroke-width="2"/>')
            continue
        fill = '#151020'
        if ch == 'o': fill = '#16243a'
        o.append(f'<rect x="{x}" y="{y}" width="{C}" height="{C}" fill="{fill}" stroke="#3a2d52"/>')
        if ch in TILES:
            col, name = TILES[ch]
            o.append(f'<rect x="{x+5}" y="{y+5}" width="{C-10}" height="{C-10}" fill="{col}" fill-opacity=".16" stroke="{col}" stroke-width="2"/>')
            fs = 13 if len(name) <= 4 else 11
            if len(name) > 3:
                h = (len(name) + 1) // 2
                o.append(f'<text x="{x+C/2}" y="{y+C/2-3}" text-anchor="middle" font-size="{fs}" fill="{col}">{name[:h]}</text>')
                o.append(f'<text x="{x+C/2}" y="{y+C/2+13}" text-anchor="middle" font-size="{fs}" fill="{col}">{name[h:]}</text>')
            else:
                o.append(f'<text x="{x+C/2}" y="{y+C/2+5}" text-anchor="middle" font-size="13" fill="{col}">{name}</text>')
        elif ch in LINKS:
            o.append(f'<rect x="{x+5}" y="{y+5}" width="{C-10}" height="{C-10}" fill="#ffe9a8" fill-opacity=".9"/>')
            o.append(f'<text x="{x+C/2}" y="{y+C/2+7}" text-anchor="middle" font-size="20" font-weight="700" fill="#0d0a14">⇄</text>')
# 天井標示、玩家、路口文字
o.append(f'<text x="{ox+6.5*C}" y="{oy+2*C+6}" text-anchor="middle" font-size="15" fill="#4fd8ff" letter-spacing="4">天　井</text>')
px, py = ox + 6 * C + C / 2, oy + 5 * C + C / 2
o.append(f'<circle cx="{px}" cy="{py}" r="15" fill="#ff4fa3"/><circle cx="{px}" cy="{py}" r="24" fill="none" stroke="#ff4fa3" stroke-opacity=".5"/>')
o.append(f'<text x="{px}" y="{py+42}" text-anchor="middle" font-size="12" fill="#ff8fc8">你</text>')
lab = [(ox - 6, oy + 4 * C + C / 2, 'end', '1'), (ox + 6.5 * C, oy - 4, 'middle', '2'),
       (ox + 13 * C + 6, oy + 3 * C + C / 2, 'start', '3'), (ox + 6.5 * C, oy + 9 * C + 18, 'middle', '4')]
for x, y, anc, k in lab:
    if anc == 'middle':
        o.append(f'<text x="{x+C*0.9 if k=="2" else x+C*0.9}" y="{y}" font-size="13" fill="#ffe9a8">{LINKS[k]}</text>')
o.append(f'<text x="{ox+4}" y="{oy+4*C-8}" font-size="12" fill="#ffe9a8">{LINKS["1"]}</text>')
o.append(f'<text x="{ox+13*C-4}" y="{oy+3*C-8}" text-anchor="end" font-size="12" fill="#ffe9a8">{LINKS["3"]}</text>')
# 比例說明
by = oy + 9 * C + 50
notes = ['一格 ＝ 一間店面或一段街道，走一格 2 分鐘。橫越這塊約 25 分鐘。',
         '黃色是路口：走上去按「前往」換到隔壁的街區或隔壁的區。',
         '設施（店、診所、車站）是格子，走到才能用。地標與事件疊在街道格上。',
         '案子的行動階段另有「設施內部」地圖（9×9 ～ 15×11，可多層），不算在這裡。']
for i, t in enumerate(notes):
    o.append(f'<text x="{ox}" y="{by+i*24}" font-size="14" fill="#b8adc9">· {t}</text>')

# 右側：各區的街區
rx, ry = 960, 168
o.append(f'<text x="{rx}" y="{ry}" font-size="18" font-weight="700" fill="#efe9f7" letter-spacing="3">八個區 · 39 塊街區</text>')
bw, bh, gap = 82, 46, 6
y = ry + 26
total = 0
for name, col, blocks in DISTRICTS:
    o.append(f'<text x="{rx}" y="{y+30}" font-size="19" font-weight="700" fill="{col}">{name}</text>')
    o.append(f'<text x="{rx}" y="{y+50}" font-size="12" fill="#7d7390">{len(blocks)} 塊</text>')
    for i, b in enumerate(blocks):
        x = rx + 84 + i * (bw + gap)
        hot = (name == '蜂巢' and i == 0)
        o.append(f'<rect x="{x}" y="{y+8}" width="{bw}" height="{bh}" fill="{col}" fill-opacity="{.38 if hot else .13}" stroke="{col}" stroke-width="{3 if hot else 1.5}"/>')
        o.append(f'<text x="{x+bw/2}" y="{y+8+bh/2+5}" text-anchor="middle" font-size="12" fill="#efe9f7">{b}</text>')
    total += len(blocks)
    y += 86
o.append(f'<text x="{rx}" y="{y+20}" font-size="14" fill="#b8adc9">合計 {total} 塊 × 117 格 ≈ {total*117:,} 格</text>')
o.append(f'<text x="{rx}" y="{y+44}" font-size="14" fill="#b8adc9">對照：ElondiaRPG 全大陸 32 個聚落共 85 塊、約 5,000 格</text>')
o.append(f'<text x="{rx}" y="{y+68}" font-size="14" fill="#ff8fc8">總量相當，但全部集中在一座城市裡。</text>')
o.append('</svg>')
out = os.path.join(ROOT, 'docs/art/map-scale.svg')
open(out, 'w', encoding='utf-8').write('\n'.join(o))
print('→ docs/art/map-scale.svg', total, 'blocks')
