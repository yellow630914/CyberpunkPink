#!/usr/bin/env python3
"""產生街區結構圖與網路空間結構圖。
  docs/art/district-blocks.svg   八個區的街區、橋接區、要地與出口
  docs/art/cyberspace.svg        內海的分區與深度
資料寫在這個檔案裡；改了 DISTRICTS.md 或 CYBERSPACE.md 的結構要回來改這裡再重跑。
用法：python3 tools/art/gen_maps.py"""
import os

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '../..'))
FONT = "'Noto Sans TC','PingFang TC','Microsoft JhengHei','WenQuanYi Zen Hei',sans-serif"
BG, INK, INK2, INK3, LINE = '#0d0a14', '#efe9f7', '#b8adc9', '#7d7390', '#3a2d52'
GATE, RED, MINT, PINK = '#ffe9a8', '#ff3355', '#5dffb0', '#ff4fa3'

# 節點：(種類, 名稱, 欄, 列[, 旗標])   種類 B=街區 S=要地 X=大區之間的橋接區
#   旗標 'U'=有地下層入口  'R'=隨機生成
# 邊：(a, b[, 小區之間橋接區的名稱])
DISTRICTS = [
    ('蜂巢', '#b9a6ff', 5, [
        ('B', '屋頂村', 2, 0), ('S', '九號塔', 4, 0),
        ('X', '尾巴口|→ 霓虹腸', 0, 1), ('B', '西棟', 1, 1), ('B', '天井市場', 2, 1, 'U'), ('B', '四號塔', 3, 1), ('B', '東側', 4, 1),
        ('X', '運河橋|→ 舊港', 1, 2), ('X', '高架橋下|→ 櫻町', 2, 2), ('S', '機電層', 3, 2), ('X', '東門|→ 鏽帶', 4, 2),
    ], [('西棟', '天井市場'), ('天井市場', '四號塔'), ('四號塔', '東側'), ('天井市場', '屋頂村', '外牆樓梯'),
        ('東側', '九號塔'), ('四號塔', '機電層'), ('西棟', '尾巴口'), ('西棟', '運河橋'), ('天井市場', '高架橋下'), ('東側', '東門')]),
    ('霓虹腸', '#ff4fa3', 6, [
        ('X', '冠冕門・南|→ 冠冕區', 0, 0), ('B', '頭段', 1, 0), ('B', '腹段・北', 2, 0), ('B', '腹段・南', 3, 0, 'U'), ('B', '尾段', 4, 0), ('X', '尾巴口|→ 蜂巢', 5, 0),
        ('S', '琉璃宮', 1, 1), ('B', '刀巷', 2, 1), ('S', '井', 3, 1), ('B', '旅館坡', 4, 1),
        ('X', '燈籠巷|→ 櫻町', 1, 2), ('X', '鏽梯|→ 舊港', 2, 2),
    ], [('冠冕門・南', '頭段'), ('頭段', '腹段・北'), ('腹段・北', '腹段・南'), ('腹段・南', '尾段'), ('尾段', '尾巴口'),
        ('頭段', '琉璃宮'), ('腹段・北', '刀巷', '暗巷'), ('腹段・南', '井'), ('尾段', '旅館坡', '坡道'),
        ('刀巷', '燈籠巷'), ('刀巷', '鏽梯')]),
    ('櫻町', '#ffb7d5', 5, [
        ('S', '奉公課分館', 0, 0), ('X', '櫻門|→ 冠冕區', 1, 0), ('S', '緋櫻映像本社', 2, 0), ('X', '燈籠巷|→ 霓虹腸', 3, 0),
        ('B', '社宅群', 0, 1), ('B', '劇場通', 1, 1, 'U'), ('B', '電器街', 3, 1), ('X', '高架橋下|→ 蜂巢', 4, 1),
        ('B', '神社坡', 0, 2), ('B', '千本通', 1, 2), ('X', '千本通南口|→ 舊港', 2, 2),
    ], [('社宅群', '奉公課分館'), ('社宅群', '劇場通'), ('劇場通', '櫻門'), ('劇場通', '緋櫻映像本社'), ('劇場通', '電器街', '拱廊'),
        ('電器街', '燈籠巷'), ('電器街', '高架橋下'), ('劇場通', '千本通'), ('千本通', '神社坡', '石階'), ('千本通', '千本通南口')]),
    ('冠冕區', '#ffd66b', 5, [
        ('S', '樂園', 1, 0), ('B', '空中花園', 2, 0), ('S', '緋櫻塔', 3, 0),
        ('X', '海岸公路|→ 玻璃岸', 0, 1), ('B', '濱海', 1, 1), ('B', '中央廣場', 2, 1), ('X', '冠冕門・南|→ 霓虹腸', 3, 1),
        ('S', '夜鶯核心機房', 1, 2), ('B', '服務層', 2, 2, 'U'), ('X', '櫻門|→ 櫻町', 3, 2),
    ], [('空中花園', '中央廣場', '空橋電梯'), ('空中花園', '樂園'), ('中央廣場', '緋櫻塔'), ('中央廣場', '濱海'), ('濱海', '海岸公路'),
        ('中央廣場', '冠冕門・南'), ('中央廣場', '服務層', '貨梯'), ('中央廣場', '櫻門'), ('服務層', '夜鶯核心機房')]),
    ('舊港', '#8fa3bd', 5, [
        ('X', '千本通南口|→ 櫻町', 0, 0), ('X', '鏽梯|→ 霓虹腸', 1, 0), ('X', '運河橋|→ 蜂巢', 3, 0),
        ('B', '碼頭', 0, 1), ('B', '夜市碼頭', 1, 1), ('B', '貨櫃城', 2, 1, 'U'), ('B', '倉庫區', 3, 1), ('X', '南門|→ 鏽帶', 4, 1),
        ('S', '水下殘骸', 1, 2), ('B', '彈坑灣', 2, 2), ('S', '熔爐', 3, 2),
    ], [('碼頭', '夜市碼頭', '棧橋'), ('夜市碼頭', '貨櫃城'), ('貨櫃城', '倉庫區'), ('倉庫區', '南門'), ('碼頭', '千本通南口'),
        ('夜市碼頭', '鏽梯'), ('倉庫區', '運河橋'), ('貨櫃城', '彈坑灣'), ('彈坑灣', '水下殘骸'), ('倉庫區', '熔爐')]),
    ('玻璃岸', '#9fe8ff', 4, [
        ('S', '外海平台', 0, 0), ('S', '蜜腺療養院', 2, 0),
        ('B', '遊艇碼頭', 0, 1), ('B', '俱樂部街', 1, 1), ('B', '別墅區', 2, 1), ('X', '外環公路|→ 鏽帶', 3, 1),
        ('X', '海岸公路|→ 冠冕區', 1, 2),
    ], [('遊艇碼頭', '外海平台', '接駁船'), ('遊艇碼頭', '俱樂部街'), ('俱樂部街', '別墅區', '林蔭道'), ('別墅區', '蜜腺療養院'),
        ('別墅區', '外環公路'), ('俱樂部街', '海岸公路')]),
    ('鏽帶', '#e08a45', 5, [
        ('X', '外環公路|→ 玻璃岸', 1, 0), ('S', '星旗前進基地', 3, 0),
        ('X', '東門|→ 蜂巢', 0, 1), ('B', '東門外', 1, 1), ('B', '廠前鎮', 2, 1), ('B', '機甲墳場', 3, 1), ('X', '荒地邊緣|地圖的盡頭', 4, 1),
        ('X', '南門|→ 舊港', 0, 2), ('B', '薔薇驛', 1, 2), ('B', '骨場', 2, 2, 'R'), ('S', '精煉廠', 3, 2),
    ], [('東門', '東門外'), ('東門外', '外環公路'), ('東門外', '廠前鎮', '公路'), ('廠前鎮', '機甲墳場', '公路'), ('機甲墳場', '星旗前進基地'),
        ('機甲墳場', '荒地邊緣'), ('東門外', '薔薇驛', '公路'), ('薔薇驛', '南門'), ('薔薇驛', '骨場'), ('廠前鎮', '精煉廠')]),
    ('地下層', '#5dffb0', 5, [
        ('X', '入口|蜂巢・霓虹腸', 0, 0), ('B', '月台市', 1, 0), ('B', '排水大廳', 3, 0), ('X', '入口|櫻町・舊港・冠冕', 4, 0),
        ('B', '轉播站', 1, 1), ('S', '廢棄資料中心', 2, 1), ('B', '書店街', 3, 1),
        ('X', '門|→ 粉牆', 0, 2), ('B', '骨幹', 1, 2), ('B', '聖堂前', 3, 2), ('S', '聖堂', 4, 2),
    ], [('入口|蜂巢・霓虹腸', '月台市'), ('入口|櫻町・舊港・冠冕', '排水大廳'), ('月台市', '排水大廳', '貓道'), ('月台市', '轉播站', '豎井'),
        ('排水大廳', '書店街', '豎井'), ('轉播站', '廢棄資料中心'), ('廢棄資料中心', '書店街'), ('轉播站', '骨幹', '豎井'),
        ('書店街', '聖堂前', '豎井'), ('骨幹', '聖堂前', '隧道'), ('聖堂前', '聖堂'), ('骨幹', '門')]),
]


def head(w, h, title):
    return [f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {w} {h}" width="{w}" height="{h}" font-family="{FONT}">',
            f'<title>{title}</title>',
            '<defs><pattern id="g" width="40" height="40" patternUnits="userSpaceOnUse"><path d="M40 0H0V40" fill="none" stroke="#fff" stroke-opacity=".03"/></pattern>'
            '<filter id="glow" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="6" result="b"/><feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge></filter></defs>',
            f'<rect width="{w}" height="{h}" fill="{BG}"/><rect width="{w}" height="{h}" fill="url(#g)"/>']


def two_lines(o, cx, cy, text, size, fill, weight=500):
    parts = text.split('|')
    if len(parts) == 1 and len(text) > 5:
        h = (len(text) + 1) // 2
        parts = [text[:h], text[h:]]
    if len(parts) == 1:
        o.append(f'<text x="{cx}" y="{cy+size*0.36}" text-anchor="middle" font-size="{size}" font-weight="{weight}" fill="{fill}">{text}</text>')
    else:
        o.append(f'<text x="{cx}" y="{cy-2}" text-anchor="middle" font-size="{size}" font-weight="{weight}" fill="{fill}">{parts[0]}</text>')
        o.append(f'<text x="{cx}" y="{cy+size+1}" text-anchor="middle" font-size="{size-1}" fill="{fill}" fill-opacity=".85">{parts[1]}</text>')


def districts():
    PW, PH, COLS = 780, 470, 2
    W, H = 40 + COLS * PW, 150 + 4 * PH + 70
    o = head(W, H, '緋夜城 街區結構 v0')
    o.append(f'<text x="40" y="66" font-size="38" font-weight="900" fill="{PINK}" letter-spacing="5">街區結構</text>')
    o.append(f'<text x="40" y="96" font-size="14" fill="{INK2}" letter-spacing="2">八個區 · 街區、橋接區、要地與出口　·　示意 v0（位置是連接關係，不是實際方位）</text>')
    # 圖例
    lx = 820
    items = [('街區（13×9，固定）', 'B'), ('要地（多層，任務用）', 'S'), ('大區之間的橋接區', 'X'), ('小區之間的橋接區', 'P')]
    for i, (t, k) in enumerate(items):
        x = lx + i * 190
        if k == 'B':
            o.append(f'<rect x="{x}" y="50" width="34" height="22" fill="#b9a6ff" fill-opacity=".15" stroke="#b9a6ff" stroke-width="1.5"/>')
        elif k == 'S':
            o.append(f'<path d="M{x+6} 50H{x+28}L{x+34} 56V72H{x}V56Z" fill="{RED}" fill-opacity=".14" stroke="{RED}" stroke-width="2" stroke-dasharray="5 3"/>')
        elif k == 'X':
            o.append(f'<rect x="{x}" y="50" width="34" height="22" rx="11" fill="{GATE}" fill-opacity=".14" stroke="{GATE}" stroke-width="1.5"/>')
        else:
            o.append(f'<rect x="{x}" y="54" width="34" height="14" rx="7" fill="{BG}" stroke="{INK3}"/>')
        o.append(f'<text x="{x+42}" y="66" font-size="12" fill="{INK2}">{t}</text>')
    o.append(f'<path d="M{lx+8} 88l8 13h-16z" fill="{MINT}" transform="rotate(180 {lx+8} 94)"/><text x="{lx+24}" y="100" font-size="12" fill="{INK2}">地下層入口</text>')
    o.append(f'<text x="{lx+120}" y="100" font-size="12" fill="{INK2}">◇ 隨機生成</text>')

    BH = 58
    for i, (name, col, cols, nodes, edges) in enumerate(DISTRICTS):
        px, py = 20 + (i % COLS) * PW, 130 + (i // COLS) * PH
        o.append(f'<rect x="{px+10}" y="{py+10}" width="{PW-20}" height="{PH-20}" fill="#151020" fill-opacity=".7" stroke="{LINE}"/>')
        o.append(f'<path d="M{px+10} {py+10}h150v6h-150z" fill="{col}"/>')
        o.append(f'<text x="{px+28}" y="{py+52}" font-size="26" font-weight="700" fill="{col}" letter-spacing="3">{name}</text>')
        nb = sum(1 for n in nodes if n[0] == 'B'); ns = sum(1 for n in nodes if n[0] == 'S')
        nx = sum(1 for n in nodes if n[0] == 'X'); npill = sum(1 for e in edges if len(e) > 2)
        o.append(f'<text x="{px+PW-28}" y="{py+48}" text-anchor="end" font-size="13" fill="{INK3}">街區 {nb} · 要地 {ns} · 出口 {nx} · 區內橋接 {npill}</text>')
        gx0, gy0 = px + 36, py + 84
        cw = (PW - 72) / cols
        BW = min(118, cw - 16)
        rh = 118
        pos = {}
        for n in nodes:
            key = n[1].split('|')[0] if n[0] != 'X' or n[1] not in [m[1] for m in nodes if m is not n] else n[1]
            if n[1] in ('入口|蜂巢・霓虹腸', '入口|櫻町・舊港・冠冕'):
                key = n[1]
            pos[key] = (gx0 + n[2] * cw + cw / 2, gy0 + n[3] * rh + BH / 2)
        for e in edges:
            (x1, y1), (x2, y2) = pos[e[0]], pos[e[1]]
            o.append(f'<path d="M{x1} {y1}L{x2} {y2}" stroke="{INK3}" stroke-width="2.5"/>')
        for n in nodes:
            kind, label = n[0], n[1]
            flag = n[4] if len(n) > 4 else ''
            cx, cy = gx0 + n[2] * cw + cw / 2, gy0 + n[3] * rh + BH / 2
            x, y = cx - BW / 2, cy - BH / 2
            if kind == 'B':
                o.append(f'<rect x="{x}" y="{y}" width="{BW}" height="{BH}" fill="#1b1430"/>')
                o.append(f'<rect x="{x}" y="{y}" width="{BW}" height="{BH}" fill="{col}" fill-opacity=".15" stroke="{col}" stroke-width="2"/>')
                two_lines(o, cx, cy, label, 16, INK, 700)
                if flag == 'U':
                    o.append(f'<path d="M{x+BW-12} {y+6}l7 11h-14z" fill="{MINT}" transform="rotate(180 {x+BW-12} {y+11.5})"/>')
                if flag == 'R':
                    o.append(f'<text x="{x+BW-8}" y="{y+16}" text-anchor="end" font-size="12" fill="{INK2}">◇</text>')
            elif kind == 'S':
                c = 12
                d = f'M{x+c} {y}H{x+BW-c}L{x+BW} {y+c}V{y+BH}H{x}V{y+c}Z'
                o.append(f'<path d="{d}" fill="#1b1430"/>')
                o.append(f'<path d="{d}" fill="{RED}" fill-opacity=".14" stroke="{RED}" stroke-width="2" stroke-dasharray="6 4"/>')
                two_lines(o, cx, cy, label, 15, '#ffb3c0', 700)
            else:
                w, h = BW - 6, BH - 12
                o.append(f'<rect x="{cx-w/2}" y="{cy-h/2}" width="{w}" height="{h}" rx="{h/2}" fill="#1b1430"/>')
                o.append(f'<rect x="{cx-w/2}" y="{cy-h/2}" width="{w}" height="{h}" rx="{h/2}" fill="{GATE}" fill-opacity=".12" stroke="{GATE}" stroke-width="1.5"/>')
                two_lines(o, cx, cy - 3, label, 13, GATE)
        for e in edges:
            if len(e) > 2:
                (x1, y1), (x2, y2) = pos[e[0]], pos[e[1]]
                mx, my = (x1 + x2) / 2, (y1 + y2) / 2
                w = 14 * len(e[2]) + 14
                o.append(f'<rect x="{mx-w/2}" y="{my-10}" width="{w}" height="20" rx="10" fill="{BG}" stroke="{INK3}"/>')
                o.append(f'<text x="{mx}" y="{my+4.5}" text-anchor="middle" font-size="12" fill="{INK2}">{e[2]}</text>')
    tb = sum(1 for d in DISTRICTS for n in d[3] if n[0] == 'B')
    ts = sum(1 for d in DISTRICTS for n in d[3] if n[0] == 'S')
    tp = sum(1 for d in DISTRICTS for e in d[4] if len(e) > 2)
    o.append(f'<text x="40" y="{H-30}" font-size="15" fill="{INK2}">合計：街區 {tb} 塊 · 要地 {ts} 處 · 大區之間的橋接區 12 處 · 小區之間的橋接區 {tp} 處</text>')
    o.append('</svg>')
    open(os.path.join(ROOT, 'docs/art/district-blocks.svg'), 'w', encoding='utf-8').write('\n'.join(o))
    print('→ docs/art/district-blocks.svg', tb, ts, tp)


# 內海：(名稱, 副標, x, y, w, h, 顏色, 固定/隨機)
ZONES = [
    ('港灣', '登入點・每個人的房間', 70, 330, 170, 150, '#b9a6ff', '固定'),
    ('大街', '商店・牆報廣場・公共服務', 300, 330, 210, 150, '#4fd8ff', '固定'),
    ('樂園島', '遊戲館・演唱會場・擂台・主題館', 580, 150, 260, 150, '#ff8fc8', '固定的場館 ＋ 隨機的館內關卡'),
    ('企業環礁', '各企業的子網・禁區', 580, 330, 260, 150, '#ffd66b', '主線固定；一般案子生成'),
    ('暗礁', '黑市・同人伺服器・駭客的窩', 580, 510, 260, 150, '#5dffb0', '固定的據點 ＋ 會搬家的節點'),
    ('沉船帶', '大潮崩時留在牆內的舊網殘骸', 910, 240, 240, 330, '#8fa3bd', '隨機生成'),
    ('深海', '牆外。妖精。沒有底', 1300, 190, 250, 430, '#ff4fa3', '隨機生成，規則不同'),
]
FLOW = [('港灣', '大街'), ('大街', '樂園島'), ('大街', '企業環礁'), ('大街', '暗礁'), ('樂園島', '沉船帶'), ('企業環礁', '沉船帶'), ('暗礁', '沉船帶')]


def cyberspace():
    W, H = 1600, 860
    o = head(W, H, '內海 結構 v0')
    # 深度漸層
    o.append('<defs><linearGradient id="deep" x1="0" x2="1"><stop offset="0" stop-color="#16243a" stop-opacity=".0"/><stop offset=".72" stop-color="#16243a" stop-opacity=".55"/><stop offset="1" stop-color="#2a0b24" stop-opacity=".9"/></linearGradient></defs>')
    o.append(f'<rect x="0" y="120" width="{W}" height="{H-200}" fill="url(#deep)"/>')
    o.append(f'<text x="40" y="66" font-size="38" font-weight="900" fill="{PINK}" letter-spacing="5">內海</text>')
    o.append(f'<text x="40" y="96" font-size="14" fill="{INK2}" letter-spacing="2">網路空間的結構 · 越往右越深　·　示意 v0</text>')
    cen = {z[0]: (z[2] + z[4] / 2, z[3] + z[5] / 2, z[2], z[2] + z[4]) for z in ZONES}
    for a, b in FLOW:
        x1, y1, _, r = cen[a]; x2, y2, l, _ = cen[b]
        o.append(f'<path d="M{r} {y1}C{(r+l)/2} {y1} {(r+l)/2} {y2} {l} {y2}" fill="none" stroke="{INK3}" stroke-width="2.5"/>')
    # 粉牆
    wx = 1225
    o.append(f'<path d="M{wx} 130V{H-90}" stroke="{PINK}" stroke-width="18" stroke-opacity=".25" filter="url(#glow)"/>')
    o.append(f'<path d="M{wx} 130V{H-90}" stroke="{PINK}" stroke-width="4"/>')
    for y in range(150, H - 100, 26):
        o.append(f'<path d="M{wx-10} {y}h20" stroke="{PINK}" stroke-opacity=".6"/>')
    o.append(f'<text x="{wx+18}" y="160" font-size="22" font-weight="700" fill="{PINK}" letter-spacing="6">粉牆</text>')
    o.append(f'<path d="M1150 405H{wx-12}" stroke="{PINK}" stroke-width="2.5" stroke-dasharray="5 6"/><path d="M{wx+12} 405H1300" stroke="{PINK}" stroke-width="2.5" stroke-dasharray="5 6"/>')
    o.append(f'<text x="{wx-34}" y="394" text-anchor="middle" font-size="14" fill="#ff8fc8">門</text>')
    for name, sub, x, y, w, h, col, mode in ZONES:
        c = 14
        d = f'M{x} {y}H{x+w-c}L{x+w} {y+c}V{y+h}H{x+c}L{x} {y+h-c}Z'
        o.append(f'<path d="{d}" fill="#151020"/><path d="{d}" fill="{col}" fill-opacity=".13" stroke="{col}" stroke-width="2"/>')
        o.append(f'<text x="{x+18}" y="{y+40}" font-size="24" font-weight="700" fill="{col}" letter-spacing="3">{name}</text>')
        o.append(f'<text x="{x+18}" y="{y+66}" font-size="13" fill="{INK}">{sub}</text>')
        rnd = '隨機' in mode or '生成' in mode
        o.append(f'<text x="{x+18}" y="{y+h-16}" font-size="12" fill="{INK2}">{"◇ " if rnd else "■ "}{mode}</text>')
    # 現實的接點
    o.append(f'<path d="M0 {H-150}H{W}" stroke="{LINE}" stroke-dasharray="4 6"/>')
    o.append(f'<text x="40" y="{H-118}" font-size="16" font-weight="700" fill="{INK}" letter-spacing="3">現實的接點</text>')
    pts = [('自己的床、據點的接入點', 70), ('潛艙店（街上的網咖）', 330), ('設施的資料埠 → 直接進那個設施的子網核心', 620), ('地下層的舊網節點 → 沉船帶與「門」', 1010)]
    for t, x in pts:
        o.append(f'<circle cx="{x}" cy="{H-84}" r="6" fill="{BG}" stroke="{MINT}" stroke-width="2"/><text x="{x+14}" y="{H-79}" font-size="13" fill="{INK2}">{t}</text>')
    o.append(f'<text x="40" y="{H-36}" font-size="13" fill="{INK3}">淺 ← 訪客就能進、沒有危險　　　　　　要甲板、有蕾絲　　　　　　沒有追蹤度，只有沉溺 → 深</text>')
    o.append('</svg>')
    open(os.path.join(ROOT, 'docs/art/cyberspace.svg'), 'w', encoding='utf-8').write('\n'.join(o))
    print('→ docs/art/cyberspace.svg')


if __name__ == '__main__':
    districts()
    cyberspace()
