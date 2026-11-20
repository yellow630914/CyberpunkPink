#!/usr/bin/env python3
"""緋夜城的城市地圖 v1：有機的海岸線、海灣與運河、不規則的區界、每區自己的街道網、主幹道與大眾運輸。
輸出 docs/art/city-map.svg。版面照 v0 的配置（各區的相對位置、地鐵線、城門），只換畫法。
用法：python3 tools/art/gen_city.py"""
import math, os, random

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '../..'))
OUT = os.path.join(ROOT, 'docs', 'art', 'city-map.svg')
W, H = 1600, 1000
rnd = random.Random(2069)


def densify(pts, step=26):
    out = []
    for (x1, y1), (x2, y2) in zip(pts, pts[1:] + pts[:1]):
        n = max(1, int(math.hypot(x2 - x1, y2 - y1) / step))
        for i in range(n):
            t = i / n
            out.append((x1 + (x2 - x1) * t, y1 + (y2 - y1) * t))
    return out


def jitter(pts, amp, seed):
    r = random.Random(seed)
    out, cx, cy = [], sum(p[0] for p in pts) / len(pts), sum(p[1] for p in pts) / len(pts)
    ph = [r.uniform(0, 6.28) for _ in range(3)]
    for i, (x, y) in enumerate(pts):
        a = math.atan2(y - cy, x - cx)
        k = amp * (0.55 * math.sin(i * 0.9 + ph[0]) + 0.3 * math.sin(i * 2.3 + ph[1]) + 0.25 * r.uniform(-1, 1))
        out.append((x + math.cos(a) * k, y + math.sin(a) * k))
    return out


def smooth(pts, closed=True):
    """Catmull-Rom → 三次貝茲。"""
    n = len(pts)
    P = pts if closed else [pts[0]] + pts + [pts[-1]]
    m = n if closed else n - 1
    d = f'M{P[0 if closed else 1][0]:.1f} {P[0 if closed else 1][1]:.1f}'
    for i in range(m):
        if closed:
            p0, p1, p2, p3 = P[(i - 1) % n], P[i], P[(i + 1) % n], P[(i + 2) % n]
        else:
            p0, p1, p2, p3 = P[i], P[i + 1], P[i + 2], P[min(i + 3, len(P) - 1)]
        c1 = (p1[0] + (p2[0] - p0[0]) / 6, p1[1] + (p2[1] - p0[1]) / 6)
        c2 = (p2[0] - (p3[0] - p1[0]) / 6, p2[1] - (p3[1] - p1[1]) / 6)
        d += f'C{c1[0]:.1f} {c1[1]:.1f} {c2[0]:.1f} {c2[1]:.1f} {p2[0]:.1f} {p2[1]:.1f}'
    return d + ('Z' if closed else '')


def blob(pts, amp, seed, step=26):
    return smooth(jitter(densify(pts, step), amp, seed))


# ---------- 水 ----------
# 西邊的陸地輪廓（順時針，從北邊界往下沿海岸，再繞東邊回來）
coast = [(360, -20), (330, 40), (268, 78), (250, 112), (300, 138), (352, 150), (340, 190)]
coast += [(470, 196), (560, 214), (575, 232), (470, 244), (380, 250)]           # 鏡灣（玻璃岸與冠冕區之間）
coast += [(372, 300), (330, 318), (322, 340), (372, 352), (392, 400), (368, 446)]
coast += [(520, 450), (690, 452), (760, 460), (700, 470), (520, 468), (380, 474)]  # 櫻堀（運河）
coast += [(350, 560), (300, 600), (296, 640), (336, 670), (360, 730), (338, 800), (352, 880)]
coast += [(470, 905), (600, 900), (640, 930), (700, 905), (760, 930), (780, 1020)]  # 彈坑灣
coast += [(1620, 1020), (1620, -20)]


def coast_path():
    r = random.Random(7)
    pts = []
    for (x1, y1), (x2, y2) in zip(coast, coast[1:]):
        n = max(1, int(math.hypot(x2 - x1, y2 - y1) / 18))
        for i in range(n):
            t = i / n
            x, y = x1 + (x2 - x1) * t, y1 + (y2 - y1) * t
            if x < 1600:
                x += r.uniform(-6, 6) + 5 * math.sin(y * 0.05)
                y += r.uniform(-3, 3)
            pts.append((x, y))
    pts.append(coast[-1])
    return smooth(pts)


crater = blob([(630, 940), (660, 905), (720, 898), (775, 925), (790, 980), (760, 1030), (640, 1030), (612, 985)], 8, 21, 14)
lake = blob([(1440, 470), (1530, 455), (1555, 520), (1500, 560), (1430, 540)], 9, 11, 14)

# ---------- 區 ----------
D = {  # 名字: (色, 輪廓, 街道的角度, 間距, 次要間距, 種子)
    '玻璃岸': ('#9fe8ff', [(300, 100), (380, 40), (520, 28), (700, 50), (860, 38), (905, 120), (880, 175), (720, 160), (600, 196), (470, 180), (380, 160)], 'curve', 30, 0, 1),
    '冠冕區': ('#ffd66b', [(380, 270), (480, 252), (600, 262), (700, 236), (775, 270), (792, 360), (740, 410), (690, 436), (560, 428), (420, 436), (340, 336)], 'radial', 0, 0, 2),
    '櫻町': ('#ffb7d5', [(380, 490), (520, 482), (690, 484), (760, 520), (805, 600), (770, 690), (790, 760), (640, 785), (500, 770), (360, 760), (310, 640), (350, 560)], 14, 24, 38, 3),
    '四十二番街': ('#ff7dbd', [(700, 440), (800, 470), (940, 560), (930, 615), (830, 590), (730, 500)], 33, 14, 30, 4),
    '蜂巢': ('#b9a6ff', [(960, 430), (1060, 395), (1185, 410), (1200, 520), (1185, 640), (1200, 770), (1080, 790), (965, 770), (900, 700), (905, 620), (945, 540)], -4, 13, 13, 5),
    '舊港': ('#aebfd6', [(370, 815), (560, 800), (800, 812), (960, 790), (1100, 820), (1190, 860), (1180, 990), (900, 990), (760, 940), (640, 935), (480, 930), (360, 900)], 'docks', 0, 0, 6),
    '鏽帶': ('#e08a45', [(1250, 170), (1350, 135), (1470, 150), (1570, 118), (1590, 330), (1560, 560), (1590, 800), (1560, 990), (1400, 975), (1250, 990), (1240, 760), (1260, 520), (1240, 330)], 'sparse', 0, 0, 8),
}


def grid_lines(bbox, angle, s1, s2, seed):
    x0, y0, x1, y1 = bbox
    cx, cy = (x0 + x1) / 2, (y0 + y1) / 2
    R = math.hypot(x1 - x0, y1 - y0)
    r = random.Random(seed)
    a = math.radians(angle)
    ux, uy, vx, vy = math.cos(a), math.sin(a), -math.sin(a), math.cos(a)
    out = []
    for spacing, (dx, dy, px, py) in ((s1, (ux, uy, vx, vy)), (s2, (vx, vy, ux, uy))):
        t = -R
        while t < R:
            off = t + r.uniform(-3, 3)
            mx, my = cx + px * off, cy + py * off
            # 每條路有時斷開，讓街區不像方格紙
            seg = -R
            while seg < R:
                ln = r.uniform(60, 260)
                if r.random() > 0.12:
                    out.append(((mx + dx * seg, my + dy * seg), (mx + dx * (seg + ln), my + dy * (seg + ln))))
                seg += ln + (r.uniform(10, 40) if r.random() < 0.3 else 0)
            t += spacing * r.uniform(0.75, 1.3)
    return out


def bbox(pts):
    xs, ys = [p[0] for p in pts], [p[1] for p in pts]
    return min(xs) - 20, min(ys) - 20, max(xs) + 20, max(ys) + 20


def district_streets(name, pts, kind, s1, s2, seed):
    r = random.Random(seed * 31)
    bb = bbox(pts)
    L = []
    if kind == 'curve':   # 玻璃岸：沿坡的彎路
        for k in range(9):
            y = bb[1] + 18 + k * 20
            pts2 = [(x, y + 14 * math.sin(x / 70 + k) + r.uniform(-3, 3)) for x in range(int(bb[0]), int(bb[2]) + 40, 40)]
            L.append(('p', smooth(pts2, False)))
        for k in range(14):
            x = bb[0] + 30 + k * 38
            L.append(('l', ((x, bb[1]), (x + r.uniform(-30, 30), bb[3]))))
    elif kind == 'radial':  # 冠冕區：放射的大道加環
        cx, cy = 600, 335
        for k in range(16):
            a = k * math.pi / 8 + 0.1
            L.append(('l', ((cx, cy), (cx + math.cos(a) * 260, cy + math.sin(a) * 260))))
        for rad in (40, 78, 118, 160, 205):
            L.append(('p', f'M{cx + rad} {cy}A{rad} {rad * .78} 0 1 1 {cx - rad} {cy}A{rad} {rad * .78} 0 1 1 {cx + rad} {cy}'))
    elif kind == 'docks':  # 舊港：碼頭與棧橋
        for x in range(380, 1180, 28):
            L.append(('l', ((x, 815), (x + r.uniform(-8, 8), 975))))
        for y in (840, 872, 905, 938):
            L.append(('l', ((360, y + r.uniform(-5, 5)), (1185, y + r.uniform(-5, 5)))))
    elif kind == 'sparse':  # 鏽帶：少數的路與田
        for k in range(7):
            y = 180 + k * 120 + r.uniform(-20, 20)
            pts2 = [(x, y + 25 * math.sin(x / 90 + k)) for x in range(1250, 1600, 50)]
            L.append(('p', smooth(pts2, False)))
        for k in range(5):
            x = 1290 + k * 62
            L.append(('l', ((x, 140), (x + r.uniform(-40, 40), 980))))
    else:
        for seg in grid_lines(bb, kind, s1, s2, seed):
            L.append(('l', seg))
    return L


# ---------- 主幹道 ----------
HIGHWAYS = [
    [(880, 110), (1040, 92), (1230, 96), (1340, 150), (1410, 260), (1410, 330)],     # 外環公路（北）
    [(1410, 330), (1480, 470), (1470, 640), (1430, 790), (1400, 860), (1380, 1000)],  # 外環公路（東）
    [(560, 214), (600, 300), (650, 420), (760, 520), (900, 600), (1060, 640), (1218, 600), (1330, 560), (1410, 470)],  # 中央快速道
    [(380, 640), (520, 640), (700, 650), (860, 700), (1000, 760), (1120, 860), (1218, 900), (1330, 920)],  # 南快速道
    [(640, 40), (660, 140), (640, 232)],                                              # 鏡灣大橋
    [(560, 400), (570, 520), (560, 700), (520, 820), (470, 1000)],                    # 櫻堀大橋往南
]


def main():
    o = []
    o.append(f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {W} {H}" width="{W}" height="{H}" font-family="\'Noto Sans TC\',\'PingFang TC\',\'Microsoft JhengHei\',\'WenQuanYi Zen Hei\',sans-serif">')
    o.append('<title>緋夜城 地圖 v1</title><defs>')
    o.append('<radialGradient id="sea" cx="0" cy=".45" r="1.1"><stop offset="0" stop-color="#1d6a73"/><stop offset=".45" stop-color="#123a52"/><stop offset="1" stop-color="#0b1a2c"/></radialGradient>')
    o.append('<pattern id="dots" width="16" height="16" patternUnits="userSpaceOnUse"><circle cx="8" cy="8" r="1" fill="#ffffff" fill-opacity=".05"/></pattern>')
    o.append('<filter id="glow" x="-30%" y="-30%" width="160%" height="160%"><feGaussianBlur stdDeviation="5" result="b"/><feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge></filter>')
    o.append('<filter id="shore" x="-10%" y="-10%" width="120%" height="120%"><feGaussianBlur stdDeviation="9"/></filter>')
    o.append('<pattern id="fields" width="22" height="22" patternUnits="userSpaceOnUse" patternTransform="rotate(30)"><path d="M0 0H22" stroke="#e08a45" stroke-opacity=".12" stroke-width="5"/></pattern>')
    land = coast_path()
    o.append(f'<clipPath id="landclip"><path d="{land}"/></clipPath>')
    dpaths = {}
    for i, (name, (col, pts, kind, s1, s2, seed)) in enumerate(D.items()):
        dpaths[name] = blob(pts, 14, seed * 13, 20)
        o.append(f'<clipPath id="dc{i}"><path d="{dpaths[name]}"/></clipPath>')
    o.append('<style>.name{font-size:30px;font-weight:800;paint-order:stroke;stroke:#0d0a14;stroke-width:7px;stroke-linejoin:round;letter-spacing:4px}'
             '.sub{font-size:13px;fill:#b8adc9;paint-order:stroke;stroke:#0d0a14;stroke-width:4px;letter-spacing:1px}'
             '.lm{font-size:12.5px;fill:#efe9f7;paint-order:stroke;stroke:#0d0a14;stroke-width:4px}'
             '.st{font-size:12px;fill:#fff;paint-order:stroke;stroke:#0d0a14;stroke-width:4px}'
             '.gate{font-size:13px;font-weight:700;fill:#ffe9a8;paint-order:stroke;stroke:#0d0a14;stroke-width:4px}'
             '.wn{font-size:13px;fill:#9fe8ff;font-weight:700;letter-spacing:3px;paint-order:stroke;stroke:#0b1a2c;stroke-width:4px}'
             '.lg{font-size:13px;fill:#d9d0e6}.dot{fill:#0d0a14;stroke:#fff;stroke-width:2}.mk{fill:#efe9f7}</style></defs>')
    # 海
    o.append(f'<rect width="{W}" height="{H}" fill="url(#sea)"/>')
    o.append(f'<rect width="{W}" height="{H}" fill="url(#dots)"/>')
    # 陸地與岸邊的光
    o.append(f'<path d="{land}" fill="none" stroke="#45d6c5" stroke-opacity=".35" stroke-width="26" filter="url(#shore)"/>')
    o.append(f'<path d="{land}" fill="#16111f"/>')
    o.append(f'<path d="{land}" fill="none" stroke="#5fb8e8" stroke-opacity=".7" stroke-width="2"/>')
    o.append(f'<path d="{lake}" fill="#123a52" stroke="#5fb8e8" stroke-opacity=".7" stroke-width="2"/>')
    # 底層的街道：城牆以內整片都是城
    o.append('<clipPath id="urban"><path d="M0 0H908L1218 322V1000H0Z"/></clipPath>')
    o.append('<g clip-path="url(#landclip)"><g clip-path="url(#urban)" fill="none" stroke="#2c2340" stroke-width="1" stroke-linecap="round">')
    for a, b in grid_lines((260, 20, 1220, 1000), 8, 24, 26, 99):
        o.append(f'<path d="M{a[0]:.0f} {a[1]:.0f}L{b[0]:.0f} {b[1]:.0f}"/>')
    o.append('</g></g>')
    # 區的底色與街道
    o.append('<g clip-path="url(#landclip)">')
    for i, (name, (col, pts, kind, s1, s2, seed)) in enumerate(D.items()):
        o.append(f'<path d="{dpaths[name]}" fill="{col}" fill-opacity=".07"/>')
        if name == '鏽帶':
            o.append(f'<path d="{dpaths[name]}" fill="url(#fields)"/>')
        o.append(f'<g clip-path="url(#dc{i})" fill="none" stroke="{col}" stroke-opacity=".32" stroke-width="1.2" stroke-linecap="round">')
        for typ, v in district_streets(name, pts, kind, s1, s2, seed):
            if typ == 'l':
                (a, b) = v
                o.append(f'<path d="M{a[0]:.0f} {a[1]:.0f}L{b[0]:.0f} {b[1]:.0f}"/>')
            else:
                o.append(f'<path d="{v}"/>')
        o.append('</g>')
    o.append('</g>')
    o.append(f'<path d="{lake}" fill="#123a52" stroke="#5fb8e8" stroke-opacity=".7" stroke-width="2"/>')
    # 鏽帶的地形線
    o.append('<g fill="none" stroke="#e08a45" stroke-opacity=".22" stroke-width="1.2">')
    for k, (cx, cy) in enumerate([(1330, 300), (1520, 760), (1350, 880)]):
        for rr in range(1, 5):
            o.append(f'<path d="{blob([(cx - 30 * rr, cy), (cx, cy - 22 * rr), (cx + 34 * rr, cy), (cx, cy + 20 * rr)], 4, k * 10 + rr, 16)}"/>')
    o.append('</g>')
    o.append(f'<path d="{crater}" fill="none" stroke="#45d6c5" stroke-opacity=".35" stroke-width="18" filter="url(#shore)"/><path d="{crater}" fill="#174a5e" stroke="#5fb8e8" stroke-opacity=".8" stroke-width="2"/>')
    # 舊港的棧橋與防波堤
    o.append('<g fill="#16111f" stroke="#5fb8e8" stroke-opacity=".6" stroke-width="1.5">')
    for x, y, w, h in [(626, 950, 30, 9), (628, 975, 26, 9), (330, 820, 40, 12), (322, 860, 46, 12), (300, 620, 30, 10)]:
        o.append(f'<rect x="{x}" y="{y}" width="{w}" height="{h}" rx="2"/>')
    o.append('</g>')
    o.append('<path d="M250 900C300 950 420 990 560 985" fill="none" stroke="#9fe8ff" stroke-opacity=".5" stroke-width="3" stroke-dasharray="1 0"/>')
    # 區界（虛線）
    for name, (col, *_rest) in D.items():
        o.append(f'<path d="{dpaths[name]}" fill="none" stroke="#ff4a6a" stroke-opacity=".55" stroke-width="1.4" stroke-dasharray="2 4"/>')
    # 主幹道
    o.append('<g fill="none" stroke-linecap="round" stroke-linejoin="round">')
    for hw in HIGHWAYS:
        d = smooth(hw, False)
        o.append(f'<path d="{d}" stroke="#0d0a14" stroke-width="8"/><path d="{d}" stroke="#c9a54a" stroke-width="4"/>')
    o.append('</g>')
    # 四十二番街的霓虹帶
    neon = 'M705 432C745 500 800 505 850 535S905 575 928 590'
    o.append(f'<g fill="none" stroke-linecap="round" filter="url(#glow)"><path d="{neon}" stroke="#ff4fa3" stroke-opacity=".28" stroke-width="40"/><path d="{neon}" stroke="#ff4fa3" stroke-width="3"/></g>')
    # 城牆與城門
    o.append('<path d="M908 190L1218 322V985" fill="none" stroke="#efe9f7" stroke-opacity=".75" stroke-width="6" stroke-linejoin="round"/>')
    o.append('<path d="M908 190L1218 322V985" fill="none" stroke="#0d0a14" stroke-width="2" stroke-dasharray="3 9"/>')
    o.append('<g fill="#ffe9a8" stroke="#0d0a14" stroke-width="2"><rect x="1206" y="586" width="24" height="28" rx="3"/><rect x="1206" y="886" width="24" height="28" rx="3"/></g>')
    o.append('<text class="gate" x="1200" y="574" text-anchor="end">東門</text><text class="gate" x="1238" y="932">南門</text>')
    o.append('<text class="sub" x="1010" y="262" transform="rotate(23 1010 262)">城　牆</text>')
    # 運輸
    o.append('<path d="M365 880C270 800 285 640 345 520S330 330 400 335M345 520C290 400 300 240 372 150" fill="none" stroke="#4fd8ff" stroke-width="2.5" stroke-dasharray="3 8" stroke-linecap="round"/>')
    o.append('<path d="M1230 600C1300 560 1350 470 1380 420M1380 420C1440 500 1475 580 1470 640S1440 790 1400 840M1380 420C1400 380 1410 350 1410 330" fill="none" stroke="#ff9d4d" stroke-width="3" stroke-dasharray="2 7" stroke-linecap="round"/>')
    o.append('<path d="M1010 530C930 520 860 515 820 518S760 600 740 690C830 700 930 695 1010 690S1020 580 1010 530Z" fill="none" stroke="#5dffb0" stroke-width="3" stroke-dasharray="10 5"/>')
    for d, c in (('M590 330C592 400 588 470 590 540S604 640 600 700S572 820 560 870', '#ff8fc0'),
                 ('M590 330C640 380 680 410 715 440S790 500 820 518S890 570 925 585S1010 600 1060 600H1205', '#ff3355')):
        o.append(f'<path d="{d}" fill="none" stroke="#fff" stroke-width="7" stroke-linecap="round"/><path d="{d}" fill="none" stroke="{c}" stroke-width="4" stroke-linecap="round"/>')
    o.append('<g class="dot">' + ''.join(f'<circle cx="{x}" cy="{y}" r="{r}"/>' for x, y, r in [
        (590, 330, 8), (715, 440, 6), (820, 518, 6), (925, 585, 6), (1060, 600, 6), (1205, 600, 6), (590, 540, 6), (600, 700, 6), (560, 870, 6),
        (1010, 530, 4), (740, 690, 4), (1010, 690, 4), (1380, 420, 5), (1470, 640, 5), (1400, 840, 5), (365, 880, 5), (400, 335, 5), (372, 150, 5)]) + '</g>')
    o.append('<g class="st"><text x="604" y="322">冠冕中央</text><text x="728" y="432">上城</text><text x="806" y="506">中城</text><text x="914" y="574">下城</text>'
             '<text x="1034" y="622">蜂巢天井</text><text x="604" y="560">劇場前</text><text x="614" y="716">千本通</text><text x="574" y="890">舊港碼頭</text></g>')
    # 水的名字
    o.append('<g class="wn"><text x="150" y="330" text-anchor="middle">外　海</text><text x="470" y="226">鏡　灣</text>'
             '<text x="470" y="462" font-size="11">櫻　堀</text><text x="705" y="968" text-anchor="middle">彈坑灣</text><text x="1492" y="512" text-anchor="middle" font-size="11">冷卻池</text></g>')
    # 區名
    o.append('<text class="name" x="640" y="112" fill="#9fe8ff" text-anchor="middle">玻璃岸</text>'
             '<text class="name" x="490" y="392" fill="#ffd66b" text-anchor="middle">冠冕區</text>'
             '<text class="name" x="520" y="630" fill="#ffb7d5" text-anchor="middle">櫻町</text>'
             '<text class="name" x="1090" y="718" fill="#b9a6ff" text-anchor="middle">蜂巢</text>'
             '<text class="name" x="880" y="905" fill="#aebfd6" text-anchor="middle">舊港</text>'
             '<text class="name" x="1420" y="250" fill="#e08a45" text-anchor="middle">鏽帶</text>'
             '<text class="name" x="790" y="476" fill="#ff7dbd" font-size="24" transform="rotate(29 790 476)">四十二番街</text>'
             '<text class="sub" x="1560" y="760" transform="rotate(90 1560 760)" text-anchor="middle">荒地　→　地圖的邊緣</text>')
    # 地標
    marks = [(560, 290, '緋櫻塔'), (690, 282, '萬華鏡球體'), (660, 370, '樂園'), (500, 140, '鏡廳'), (770, 96, '廢教堂'),
             (480, 520, '緋櫻劇場'), (700, 612, '稻荷神社'), (470, 690, '白手套'), (660, 740, '電器街'),
             (1040, 470, '四號塔'), (1140, 440, '九號塔'), (1130, 650, '巡守站'), (450, 850, '海棠樓'), (1060, 870, '熔爐'), (800, 842, '貨櫃城'),
             (1390, 405, '精煉廠'), (1500, 630, '薔薇驛'), (1420, 860, '骨場'), (1500, 320, '機甲墳場'), (1320, 720, '傳教所'), (1500, 900, '星旗基地'),
             (770, 462, '琉璃宮'), (880, 590, '井')]
    o.append('<g class="mk">' + ''.join(f'<path d="M{x} {y - 7}l7 7-7 7-7-7z"/>' for x, y, _ in marks) + '</g>')
    o.append('<g class="lm">' + ''.join(f'<text x="{x + 11}" y="{y + 5}">{t}</text>' for x, y, t in marks) + '<text x="1120" y="86" fill="#b8adc9">外環公路</text></g>')
    o.append('<g fill="#5dffb0" stroke="#0d0a14" stroke-width="1.5">' + ''.join(
        f'<path d="M{x} {y}l8 -13h-16z"/>' for x, y in [(640, 413), (880, 513), (720, 573), (990, 633), (960, 863)]) + '</g>')
    # 標題與圖例
    o.append('<text x="28" y="72" font-size="46" font-weight="900" fill="#ff4fa3" filter="url(#glow)" letter-spacing="6">緋夜城</text>'
             '<text x="30" y="100" font-size="14" fill="#b8adc9" letter-spacing="3">CYBERPUNKPINK · 2069</text>'
             '<text x="30" y="122" font-size="12" fill="#7d7390">地圖 v1（示意，非比例）</text>'
             '<g transform="translate(250 70)" fill="none" stroke="#efe9f7" stroke-width="2"><path d="M0 22V-22M-7-12L0-24L7-12"/><text x="0" y="-30" text-anchor="middle" font-size="13" fill="#efe9f7" stroke="none">北</text></g>')
    lg = [('<path d="M16 {y}H56" stroke="#fff" stroke-width="7"/><path d="M16 {y}H56" stroke="#ff3355" stroke-width="4"/>', '地鐵紅線'),
          ('<path d="M16 {y}H56" stroke="#fff" stroke-width="7"/><path d="M16 {y}H56" stroke="#ff8fc0" stroke-width="4"/>', '地鐵櫻線'),
          ('<path d="M16 {y}H56" stroke="#5dffb0" stroke-width="3" stroke-dasharray="10 5"/>', '輕軌環線'),
          ('<path d="M16 {y}H56" stroke="#ff9d4d" stroke-width="3" stroke-dasharray="2 7" stroke-linecap="round"/>', '外環巴士'),
          ('<path d="M16 {y}H56" stroke="#4fd8ff" stroke-width="2.5" stroke-dasharray="3 8" stroke-linecap="round"/>', '渡輪'),
          ('<path d="M16 {y}H56" stroke="#0d0a14" stroke-width="8"/><path d="M16 {y}H56" stroke="#c9a54a" stroke-width="4"/>', '主幹道'),
          ('<path d="M16 {y}H56" stroke="#4a3f5e" stroke-width="1.5"/>', '街道'),
          ('<path d="M16 {y}H56" stroke="#ff4a6a" stroke-width="1.6" stroke-dasharray="2 4"/>', '區界'),
          ('<path d="M16 {y}H56" stroke="#efe9f7" stroke-opacity=".75" stroke-width="6"/>', '城牆'),
          ('<rect x="26" y="{y8}" width="20" height="18" rx="3" fill="#ffe9a8"/>', '城門'),
          ('<path d="M36 {y7}l7 7-7 7-7-7z" fill="#efe9f7"/>', '地標'),
          ('<path d="M36 {y6}l8-13h-16z" fill="#5dffb0"/>', '地下層入口'),
          ('<circle cx="36" cy="{y}" r="6" class="dot"/>', '車站／碼頭')]
    o.append(f'<g transform="translate(22 600)"><rect width="230" height="{44 + len(lg) * 26}" rx="6" fill="#0d0a14" fill-opacity=".88" stroke="#ff4fa3" stroke-opacity=".6"/>'
             '<text x="16" y="28" font-size="15" font-weight="700" fill="#ff7dbd" letter-spacing="2">圖例</text><g class="lg">')
    for k, (sym, label) in enumerate(lg):
        y = 52 + k * 26
        o.append(sym.format(y=y, y8=y - 9, y7=y - 7, y6=y + 6) + f'<text x="68" y="{y + 5}">{label}</text>')
    o.append('</g></g></svg>')
    open(OUT, 'w', encoding='utf-8').write('\n'.join(o))
    print('→', OUT, os.path.getsize(OUT) // 1024, 'KB')


if __name__ == '__main__':
    main()
