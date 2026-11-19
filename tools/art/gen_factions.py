#!/usr/bin/env python3
"""產生 docs/art/factions.svg：勢力關係圖。資料照 docs/world/FACTIONS.md 第 3 節。
用法：python3 tools/art/gen_factions.py"""
import math, os
ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '../..'))
FONT = "'Noto Sans TC','PingFang TC','Microsoft JhengHei','WenQuanYi Zen Hei',sans-serif"
W, H = 1800, 1360
CX, CY = 880, 700
R_IN, R_OUT = 290, 560

# (名字, 角度, 級別)  級別：M 主要、m 次要、a 公家機關
CORPS = [('緋櫻', -90, 'M'), ('萬華鏡', -60, 'M'), ('甜心', -30, 'm'), ('伊甸園', 0, 'M'), ('蜜腺', 30, 'M'),
         ('天使急救', 60, 'm'), ('黑泉', 90, 'M'), ('星旗', 120, 'M'), ('崑崙', 150, 'M'), ('織女', 180, 'm'),
         ('夜鶯', 210, 'M'), ('貞網局', 240, 'm')]
STREET = [('女僕公會', -101, 'm'), ('特攻姬', -81, 'M'), ('同人眾', -62, 'm'), ('親衛隊', -44, 'm'), ('夜宴社', -26, 'm'),
          ('祭典組', -6, 'm'), ('蜜糖會', 14, 'M'), ('拆體客', 36, 'm'), ('鉻娘子', 56, 'M'), ('素體教', 78, 'm'),
          ('野薔薇', 100, 'M'), ('孤星連', 122, 'm'), ('胭脂堂', 146, 'M'), ('野良', 170, 'M'), ('牆語者', 196, 'M'),
          ('鎮溺隊', 222, 'a'), ('市警', 244, 'a')]
# 關係：敵、競、生、盟；主（左罩著右）；金（左出錢給右）
E = [
 ('緋櫻','星旗','敵'),('緋櫻','崑崙','競'),('緋櫻','蜜腺','生'),('緋櫻','夜鶯','生'),('緋櫻','萬華鏡','競'),('緋櫻','伊甸園','生'),
 ('緋櫻','黑泉','競'),('緋櫻','織女','生'),('星旗','崑崙','競'),('星旗','黑泉','生'),('星旗','織女','競'),('崑崙','織女','主'),
 ('蜜腺','萬華鏡','生'),('蜜腺','伊甸園','生'),('蜜腺','黑泉','生'),('蜜腺','天使急救','主'),('夜鶯','萬華鏡','生'),('夜鶯','織女','競'),
 ('夜鶯','貞網局','主'),('萬華鏡','伊甸園','生'),('萬華鏡','黑泉','競'),('萬華鏡','甜心','生'),('伊甸園','黑泉','生'),('伊甸園','天使急救','生'),
 ('織女','甜心','生'),
 ('蜜糖會','胭脂堂','競'),('蜜糖會','野薔薇','生'),('蜜糖會','祭典組','主'),('蜜糖會','拆體客','敵'),('胭脂堂','鉻娘子','競'),
 ('胭脂堂','野薔薇','生'),('鉻娘子','特攻姬','敵'),('鉻娘子','牆語者','盟'),('鉻娘子','野薔薇','競'),('鉻娘子','拆體客','主'),
 ('鉻娘子','孤星連','敵'),('鉻娘子','素體教','敵'),('特攻姬','同人眾','主'),('特攻姬','親衛隊','主'),('野良','牆語者','生'),
 ('野良','孤星連','敵'),('牆語者','野薔薇','生'),('牆語者','同人眾','生'),('牆語者','素體教','敵'),
 ('緋櫻','特攻姬','敵'),('緋櫻','女僕公會','主'),('緋櫻','親衛隊','主'),('緋櫻','孤星連','競'),('星旗','野薔薇','競'),('星旗','孤星連','主'),
 ('崑崙','胭脂堂','生'),('蜜腺','素體教','敵'),('夜鶯','牆語者','敵'),('萬華鏡','親衛隊','主'),('萬華鏡','夜宴社','主'),
 ('伊甸園','蜜糖會','敵'),('伊甸園','胭脂堂','競'),('伊甸園','素體教','敵'),('黑泉','野薔薇','競'),('黑泉','素體教','金'),
 ('織女','同人眾','生'),('貞網局','牆語者','敵'),
 ('市警','緋櫻','競'),('市警','星旗','生'),('市警','崑崙','生'),('市警','蜜腺','生'),('市警','夜鶯','生'),('市警','萬華鏡','生'),
 ('市警','伊甸園','生'),('市警','黑泉','生'),('市警','胭脂堂','生'),('市警','特攻姬','競'),('市警','鉻娘子','敵'),('市警','拆體客','敵'),
 ('鎮溺隊','蜜腺','生'),('鎮溺隊','貞網局','生'),('鎮溺隊','牆語者','敵'),('鎮溺隊','鉻娘子','敵'),('鎮溺隊','天使急救','競'),('鎮溺隊','素體教','競'),
]
STYLE = {  # 關係 → (顏色, 線寬, 虛線, 透明度)
 '敵': ('#ff3355', 3.2, '', .95), '競': ('#ffb347', 2.2, '9 6', .85), '生': ('#7fd7ff', 1.3, '', .38),
 '盟': ('#5dffb0', 3, '', .95), '主': ('#ff4fa3', 3.4, '', .95), '金': ('#ffe066', 3, '3 5', .95),
}
pos = {}
for name, a, lv in CORPS:
    pos[name] = (CX + R_IN * math.cos(math.radians(a)), CY + R_IN * math.sin(math.radians(a)), lv, 'corp')
for name, a, lv in STREET:
    pos[name] = (CX + R_OUT * math.cos(math.radians(a)), CY + R_OUT * math.sin(math.radians(a)), lv, 'street')

def edge(a, b, kind):
    x1, y1, *_ = pos[a]; x2, y2, *_ = pos[b]
    col, w, dash, op = STYLE[kind]
    mx, my = (x1 + x2) / 2, (y1 + y2) / 2
    d = math.hypot(x2 - x1, y2 - y1)
    pull = .0 if d < 330 else .30          # 長的線往圓心彎一點，短的直走
    qx, qy = mx + (CX - mx) * pull, my + (CY - my) * pull
    marker = ' marker-end="url(#arr-%s)"' % ('m' if kind == '主' else 'g') if kind in ('主', '金') else ''
    # 箭頭的終點往回縮，不要被節點蓋住
    if marker:
        r = 34 if pos[b][2] != "M" else 40
        vx, vy = x2 - qx, y2 - qy; n = math.hypot(vx, vy) or 1
        x2, y2 = x2 - vx / n * r, y2 - vy / n * r
    da = f' stroke-dasharray="{dash}"' if dash else ''
    return f'<path d="M{x1:.0f} {y1:.0f}Q{qx:.0f} {qy:.0f} {x2:.0f} {y2:.0f}" fill="none" stroke="{col}" stroke-width="{w}" stroke-opacity="{op}"{da}{marker} stroke-linecap="round"/>'

def node(name):
    x, y, lv, side = pos[name]
    big = lv == 'M'
    w = max(78, 24 * len(name) + 30) if big else max(70, 20 * len(name) + 26)
    h = 46 if big else 38
    if lv == 'a': col, fill = '#b8adc9', '#1c1626'
    elif side == 'corp': col, fill = '#ffd66b', '#241c12'
    else: col, fill = '#b9a6ff', '#1b1630'
    sw = 2.6 if big else 1.4
    cut = 10
    pts = f'{x-w/2+cut:.0f},{y-h/2:.0f} {x+w/2:.0f},{y-h/2:.0f} {x+w/2:.0f},{y+h/2-cut:.0f} {x+w/2-cut:.0f},{y+h/2:.0f} {x-w/2:.0f},{y+h/2:.0f} {x-w/2:.0f},{y-h/2+cut:.0f}'
    fs = 22 if big else 17
    fw = 700 if big else 500
    dash = ' stroke-dasharray="5 4"' if lv == 'a' else ''
    return (f'<polygon points="{pts}" fill="{fill}" stroke="{col}" stroke-width="{sw}"{dash}/>'
            f'<text x="{x:.0f}" y="{y + fs * .36:.0f}" text-anchor="middle" font-size="{fs}" font-weight="{fw}" fill="{col if big else "#e6def2"}">{name}</text>')

order = {'生': 0, '競': 1, '金': 2, '主': 3, '盟': 4, '敵': 5}
edges = '\n'.join(edge(a, b, k) for a, b, k in sorted(E, key=lambda e: order[e[2]]))
nodes = '\n'.join(node(n) for n in pos)
lg_x, lg_y = 1500, 70
legend_rows = [('敵', '敵對：公開或實質上在打'), ('競', '競爭：搶同一塊餅'), ('盟', '盟友'), ('主', '主從：箭頭指向被罩著的一方'),
               ('金', '金主：箭頭指向拿錢的一方'), ('生', '生意：有往來，沒有交情')]
lg = [f'<rect x="{lg_x-24}" y="{lg_y-34}" width="300" height="372" fill="#0d0a14" fill-opacity=".86" stroke="#ff4fa3" stroke-opacity=".5"/>',
      f'<text x="{lg_x}" y="{lg_y}" font-size="17" fill="#ff8fc8" letter-spacing="4">圖例</text>']
for i, (k, t) in enumerate(legend_rows):
    col, w, dash, op = STYLE[k]; y = lg_y + 34 + i * 30
    da = f' stroke-dasharray="{dash}"' if dash else ''
    mk = ' marker-end="url(#arr-%s)"' % ('m' if k == '主' else 'g') if k in ('主', '金') else ''
    lg.append(f'<path d="M{lg_x} {y}H{lg_x+50}" stroke="{col}" stroke-width="{w}" stroke-opacity="{max(op,.8)}"{da}{mk}/>'
              f'<text x="{lg_x+66}" y="{y+5}" font-size="14" fill="#d9d0e6">{t}</text>')
y0 = lg_y + 34 + 6 * 30 + 14
samples = [('#ffd66b', '#241c12', 2.6, '', '企業（內圈）・粗框是主要勢力'), ('#b9a6ff', '#1b1630', 2.6, '', '街頭勢力（外圈）・粗框是主要勢力'),
           ('#b9a6ff', '#1b1630', 1.4, '', '細框是次要勢力'), ('#b8adc9', '#1c1626', 1.4, ' stroke-dasharray="5 4"', '公家機關')]
for i, (c, f, sw, d, t) in enumerate(samples):
    y = y0 + i * 28
    lg.append(f'<rect x="{lg_x}" y="{y-11}" width="50" height="20" fill="{f}" stroke="{c}" stroke-width="{sw}"{d}/><text x="{lg_x+66}" y="{y+5}" font-size="13.5" fill="#d9d0e6">{t}</text>')
svg = f'''<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {W} {H}" width="{W}" height="{H}" font-family="{FONT}">
<title>緋夜城 勢力關係圖</title>
<defs>
<pattern id="grid" width="40" height="40" patternUnits="userSpaceOnUse"><path d="M40 0H0V40" fill="none" stroke="#ffffff" stroke-opacity=".035"/></pattern>
<marker id="arr-m" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="5" markerHeight="5" orient="auto"><path d="M0 0L10 5L0 10z" fill="#ff4fa3"/></marker>
<marker id="arr-g" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="5" markerHeight="5" orient="auto"><path d="M0 0L10 5L0 10z" fill="#ffe066"/></marker>
</defs>
<rect width="{W}" height="{H}" fill="#120d1c"/><rect width="{W}" height="{H}" fill="url(#grid)"/>
<circle cx="{CX}" cy="{CY}" r="{R_IN}" fill="none" stroke="#ffd66b" stroke-opacity=".10" stroke-width="1.5"/>
<circle cx="{CX}" cy="{CY}" r="{R_OUT}" fill="none" stroke="#b9a6ff" stroke-opacity=".10" stroke-width="1.5"/>
<text x="60" y="78" font-size="40" font-weight="900" fill="#ff4fa3" letter-spacing="8">勢力關係圖</text>
<text x="62" y="110" font-size="14" fill="#b8adc9" letter-spacing="3">CYBERPUNKPINK · 緋夜城 2069 · 關係已確認（2026-11-19）</text>
<text x="62" y="134" font-size="13" fill="#8f84a3">內圈是十二家企業，外圈是十五個街頭勢力與兩個公家機關</text>
{edges}
{nodes}
{''.join(lg)}
</svg>'''
out = os.path.join(ROOT, 'docs/art/factions.svg')
open(out, 'w', encoding='utf-8').write(svg)
print('→ docs/art/factions.svg', len(E), '條關係')
