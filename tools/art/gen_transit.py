#!/usr/bin/env python3
"""地鐵路線圖：遊戲內車站介面用的路線圖（示意，不照比例）。
輸出 docs/art/transit-map.svg。
路線與站名照 DISTRICTS 1.2.1 節的表；各站的相對位置照城市地圖（city-map.svg）的方位，畫成 45 度的路線圖。
外環巴士在精煉廠分成兩支（往薔薇驛、骨場，與沿外環公路往玻璃岸），照 city-map.svg 的巴士路線畫。
用法：python3 tools/art/gen_transit.py"""
import os

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '../..'))
OUT = os.path.join(ROOT, 'docs', 'art', 'transit-map.svg')
FONT = "'Noto Sans TC','PingFang TC','Microsoft JhengHei','WenQuanYi Zen Hei',sans-serif"
BG, INK, INK2, INK3, LINE = '#0d0a14', '#efe9f7', '#b8adc9', '#7d7390', '#3a2d52'
W, H = 1600, 1120

LINES = {  # 色、粗細、虛線
    'red': ('地鐵紅線', '#ff3355', 10, ''),
    'sakura': ('地鐵櫻線', '#ff8fc0', 10, ''),
    'lrt': ('輕軌環線', '#5dffb0', 8, ''),
    'bus': ('外環巴士', '#ff9d4d', 6, '2 12'),
    'ferry': ('渡輪', '#4fd8ff', 5, '14 9'),
}
# 站：id → (名字, x, y, 標籤的位置 dx dy anchor, 區)
ST = {
    'kanmuri': ('冠冕中央', 400, 330, -22, -14, 'end', '冠冕區'),
    'kami': ('番街上城', 520, 410, 18, -12, 'start', '四十二番街'),
    'naka': ('番街中城', 640, 490, 0, 0, None, '四十二番街'),
    'shimo': ('番街下城', 790, 490, 0, -24, 'middle', '四十二番街'),
    'tenjo': ('蜂巢天井', 940, 490, 0, -24, 'middle', '蜂巢'),
    'eastgate': ('東門', 1120, 490, 0, -24, 'middle', '蜂巢'),
    'gekijo': ('櫻町劇場前', 400, 560, -22, 5, 'end', '櫻町'),
    'senbon': ('千本通', 400, 680, -22, 5, 'end', '櫻町'),
    'port': ('舊港碼頭', 490, 770, 20, 30, 'start', '舊港'),
    'l_naka': ('番街中城', 640, 570, 0, 0, None, '四十二番街'),
    'l_hive': ('蜂巢', 990, 640, 22, 5, 'start', '蜂巢'),
    'l_sakura': ('櫻町', 520, 640, -22, 5, 'end', '櫻町'),
    'b_east': ('東門（東門外）', 1300, 490, 18, 34, 'start', '鏽帶'),
    'b_refinery': ('精煉廠', 1390, 400, 22, 5, 'start', '鏽帶'),
    'b_rose': ('薔薇驛', 1480, 620, 22, 5, 'start', '鏽帶'),
    'b_bone': ('骨場', 1480, 760, 22, 5, 'start', '鏽帶'),
    'b_glass': ('玻璃岸', 720, 180, 0, -22, 'middle', '玻璃岸'),
    'f_bay': ('冠冕濱海', 250, 390, 20, 5, 'start', '冠冕區'),
    'f_yacht': ('玻璃岸遊艇碼頭', 300, 170, 20, -14, 'start', '玻璃岸'),
}
ROUTES = [
    ('red', 'M400 330L520 410L600 490H1120'),
    ('sakura', 'M400 330V680L490 770'),
    ('lrt', 'M560 570H950Q990 570 990 610V670Q990 710 950 710H560Q520 710 520 670V610Q520 570 560 570Z'),
    ('bus', 'M1300 490L1390 400L1480 490V760'),
    ('bus', 'M1390 400V210Q1390 180 1360 180H720'),
    ('ferry', 'M490 770C330 790 210 640 250 390C270 270 220 220 300 170'),
]
DCOL = {'冠冕區': '#ffd66b', '四十二番街': '#ff4fa3', '櫻町': '#ffb7d5', '蜂巢': '#b9a6ff', '舊港': '#8fa3bd', '玻璃岸': '#9fe8ff', '鏽帶': '#e08a45'}


def main():
    o = [f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {W} {H}" width="{W}" height="{H}" font-family="{FONT}">',
         '<title>緋夜城 路線圖 v0</title>',
         '<defs><pattern id="g" width="40" height="40" patternUnits="userSpaceOnUse"><path d="M40 0H0V40" fill="none" stroke="#fff" stroke-opacity=".03"/></pattern>'
         '<linearGradient id="sea" x1="0" x2="1"><stop offset="0" stop-color="#123a52"/><stop offset="1" stop-color="#0b1a2c"/></linearGradient>'
         '<filter id="glow" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="5" result="b"/><feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge></filter></defs>',
         f'<rect width="{W}" height="{H}" fill="{BG}"/><rect width="{W}" height="{H}" fill="url(#g)"/>']
    # 海（西邊）與城牆
    o.append('<path d="M0 120H330Q300 200 340 260Q360 330 320 420Q300 520 340 620Q380 720 360 830H0Z" fill="url(#sea)" opacity=".85"/>')
    o.append('<path d="M330 120Q300 200 340 260Q360 330 320 420Q300 520 340 620Q380 720 360 830" fill="none" stroke="#5fb8e8" stroke-opacity=".5" stroke-width="2"/>')
    o.append('<g font-size="15" font-weight="700" fill="#9fe8ff" fill-opacity=".55" letter-spacing="6"><text x="70" y="300">外　海</text><text x="80" y="700">鏡　灣</text></g>')
    o.append('<path d="M1210 200V840" stroke="#efe9f7" stroke-opacity=".5" stroke-width="5"/><path d="M1210 200V840" stroke="#0d0a14" stroke-width="2" stroke-dasharray="3 9"/>')
    o.append(f'<text x="1222" y="222" font-size="12" fill="{INK3}" letter-spacing="4">城牆</text>')
    # 區名（淡）
    for t, x, y in [('玻璃岸', 520, 250), ('冠冕區', 470, 300), ('四十二番街', 700, 445), ('櫻町', 545, 760), ('舊港', 700, 800), ('蜂巢', 1030, 770), ('鏽帶', 1300, 640)]:
        o.append(f'<text x="{x}" y="{y}" font-size="20" font-weight="800" fill="{DCOL[t]}" fill-opacity=".22" letter-spacing="6">{t}</text>')
    # 路線
    for lid, d in ROUTES:
        name, col, w, dash = LINES[lid]
        if lid in ('red', 'sakura'):
            o.append(f'<path d="{d}" fill="none" stroke="{col}" stroke-opacity=".25" stroke-width="{w + 14}" stroke-linejoin="round" stroke-linecap="round" filter="url(#glow)"/>')
        if lid == 'lrt':  # 高架：雙線
            o.append(f'<path d="{d}" fill="none" stroke="{col}" stroke-width="{w + 6}"/><path d="{d}" fill="none" stroke="{BG}" stroke-width="{w - 3}"/>')
            continue
        o.append(f'<path d="{d}" fill="none" stroke="{col}" stroke-width="{w}" stroke-linejoin="round" stroke-linecap="round"' + (f' stroke-dasharray="{dash}"' if dash else '') + '/>')
    # 步行轉乘
    for a, b, t in [('tenjo', 'l_hive', '步行・西棟'), ('eastgate', 'b_east', '步行・過東門')]:
        _, x1, y1, *_ = ST[a]
        _, x2, y2, *_ = ST[b]
        o.append(f'<path d="M{x1} {y1}L{x2} {y2}" stroke="{INK2}" stroke-width="3" stroke-dasharray="2 6" stroke-linecap="round"/>')
        mx, my = (x1 + x2) / 2, (y1 + y2) / 2
        if y1 == y2:
            o.append(f'<text x="{mx}" y="{my - 12}" text-anchor="middle" font-size="11.5" fill="{INK2}" paint-order="stroke" stroke="{BG}" stroke-width="4">{t}</text>')
        else:
            o.append(f'<text x="{mx + 14}" y="{my - 14}" font-size="11.5" fill="{INK2}" paint-order="stroke" stroke="{BG}" stroke-width="4">{t}</text>')
    # 轉乘站（同站）：番街中城 紅線 ↔ 輕軌
    o.append(f'<rect x="626" y="476" width="28" height="108" rx="14" fill="{BG}" stroke="#fff" stroke-width="4"/>')
    # 站點
    for sid, (name, x, y, dx, dy, anchor, dist) in ST.items():
        inter = sid in ('kanmuri', 'port')
        if sid in ('naka', 'l_naka'):
            o.append(f'<circle cx="{x}" cy="{y}" r="7" fill="#fff"/>')
        elif inter:
            o.append(f'<circle cx="{x}" cy="{y}" r="16" fill="{BG}" stroke="#fff" stroke-width="5"/><circle cx="{x}" cy="{y}" r="6" fill="#fff"/>')
        else:
            o.append(f'<circle cx="{x}" cy="{y}" r="10" fill="{BG}" stroke="#fff" stroke-width="4"/>')
        if anchor:
            o.append(f'<text x="{x + dx}" y="{y + dy}" text-anchor="{anchor}" font-size="17" font-weight="800" fill="{INK}" paint-order="stroke" stroke="{BG}" stroke-width="5" stroke-linejoin="round">{name}</text>')
    # 番街中城的名字：一個名字給兩個月台
    o.append(f'<text x="660" y="474" font-size="17" font-weight="800" fill="{INK}" paint-order="stroke" stroke="{BG}" stroke-width="5">番街中城</text>')
    o.append(f'<text x="660" y="532" font-size="11.5" fill="{INK2}" paint-order="stroke" stroke="{BG}" stroke-width="4">站內轉輕軌</text>')
    # 小註
    notes = [(400, 330, -22, 8, 'end', '轉櫻線'), (490, 770, 20, 50, 'start', '入夜後沒有站務員・轉渡輪'), (1120, 490, 0, 30, 'middle', '紅線終點'),
             (300, 170, 20, 8, 'start', '胭脂堂的渡輪')]
    for x, y, dx, dy, an, t in notes:
        o.append(f'<text x="{x + dx}" y="{y + dy}" text-anchor="{an}" font-size="11.5" fill="{INK2}" paint-order="stroke" stroke="{BG}" stroke-width="4">{t}</text>')
    o.append(f'<text x="1360" y="172" text-anchor="end" font-size="11.5" fill="{INK2}">外環公路</text>')
    o.append(f'<text x="1530" y="480" font-size="11.5" fill="{INK2}" transform="rotate(90 1530 480)">往荒地 →</text>')
    # 標題
    o.append('<text x="40" y="70" font-size="40" font-weight="900" fill="#ff4fa3" letter-spacing="6" filter="url(#glow)">路線圖</text>'
             f'<text x="210" y="56" font-size="15" fill="{INK2}" letter-spacing="2">地鐵兩線・輕軌環線・外環巴士・渡輪　·　18 站</text>'
             f'<text x="210" y="80" font-size="13" fill="{INK3}" letter-spacing="1">車站介面用，示意 v0（方位照城市地圖，距離不照比例）</text>')
    # 圖例（右上）
    lx, ly = 850, 40
    leg = []
    for k, (lid, (name, col, w, dash)) in enumerate(LINES.items()):
        if lid == 'lrt':
            sym = f'<path d="M0 0H44" stroke="{col}" stroke-width="{w + 6}"/><path d="M0 0H44" stroke="{BG}" stroke-width="{w - 3}"/>'
        else:
            sym = f'<path d="M0 0H44" stroke="{col}" stroke-width="{w}" stroke-linecap="round"' + (f' stroke-dasharray="{dash}"' if dash else '') + '/>'
        leg.append((sym, name))
    leg += [(f'<circle cx="22" cy="0" r="9" fill="{BG}" stroke="#fff" stroke-width="4"/>', '車站'),
            (f'<circle cx="22" cy="0" r="13" fill="{BG}" stroke="#fff" stroke-width="5"/><circle cx="22" cy="0" r="5" fill="#fff"/>', '轉乘站'),
            (f'<path d="M0 0H44" stroke="{INK2}" stroke-width="3" stroke-dasharray="2 6" stroke-linecap="round"/>', '出站步行轉乘'),
            (f'<circle cx="22" cy="0" r="9" fill="{BG}" stroke="{INK3}" stroke-width="4" stroke-dasharray="3 3"/>', '還沒去過（介面：灰、不能搭）')]
    for k, (sym, t) in enumerate(leg):
        x, y = lx + (k % 3) * 250, ly + (k // 3) * 28 + 6
        o.append(f'<g transform="translate({x} {y})">{sym}<text x="58" y="5" font-size="13" fill="{INK2}">{t}</text></g>')
    # 下方的表
    ty = 880
    o.append(f'<rect x="30" y="{ty - 20}" width="{W - 60}" height="{H - ty - 10}" fill="#151020" stroke="{LINE}"/>')
    cols = [(56, '線'), (220, '路線'), (700, '每站'), (790, '班距'), (880, '付錢'), (1130, '特性')]
    for x, t in cols:
        o.append(f'<text x="{x}" y="{ty + 8}" font-size="12.5" font-weight="700" fill="{INK3}" letter-spacing="2">{t}</text>')
    rows = [
        ('red', '冠冕中央 — 番街上城 — 番街中城 — 番街下城 — 蜂巢天井 — 東門', '5 分', '2～6 分', '刷卡留紀錄／現金單程票', '進站掃橋（敵對值高時有風險）；深夜停駛'),
        ('sakura', '冠冕中央 — 櫻町劇場前 — 千本通 — 舊港碼頭', '5 分', '2～6 分', '刷卡留紀錄／現金單程票', '同紅線；舊港碼頭站入夜後沒有站務員'),
        ('lrt', '蜂巢 — 櫻町 — 番街中城 — 蜂巢（高架，繞一圈）', '8 分', '2～6 分', '帳戶或現金', '不掃橋；擠，扒手多；看得到窗外'),
        ('bus', '東門 — 精煉廠 — 薔薇驛 — 骨場；精煉廠 — 玻璃岸（外環公路）', '20 分', '20 分', '只收現金', '班次少；鏽帶區內唯一的大眾運輸'),
        ('ferry', '舊港碼頭 — 冠冕濱海 — 玻璃岸遊艇碼頭', '15 分', '30 分', '現金或人情', '胭脂堂經營；不問身分；可以帶貨；看得到窗外'),
    ]
    for k, (lid, route, t1, t2, pay, note) in enumerate(rows):
        y = ty + 40 + k * 30
        name, col, w, dash = LINES[lid]
        o.append(f'<rect x="56" y="{y - 13}" width="10" height="18" rx="2" fill="{col}"/><text x="76" y="{y + 1}" font-size="14" font-weight="800" fill="{col}">{name}</text>')
        for x, t in zip([220, 700, 790, 880, 1130], [route, t1, t2, pay, note]):
            o.append(f'<text x="{x}" y="{y + 1}" font-size="13" fill="{INK}">{t}</text>')
    o.append(f'<text x="56" y="{H - 28}" font-size="12" fill="{INK3}">浮空計程車不在圖上：任意兩個地面站點，10 分鐘，點到點，不進舊港與鏽帶深處。地下層沒有公共交通。資料：DISTRICTS 1.2.1 節。由 tools/art/gen_transit.py 產生。</text>')
    o.append('</svg>')
    for p in (OUT, os.path.join(os.path.join(ROOT, 'docs', 'mockups', 'maps'), os.path.basename(OUT))):   # 原型的導覽頁讀 mockups/maps 的副本
        os.makedirs(os.path.dirname(p), exist_ok=True)
        open(p, 'w', encoding='utf-8').write('\n'.join(o))
    print('→', os.path.relpath(OUT, ROOT), len(ST) - 1, 'stations')


if __name__ == '__main__':
    main()
