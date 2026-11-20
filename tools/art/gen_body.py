#!/usr/bin/env python3
"""義體部位圖：人形輪廓與九個部位的槽。
輸出 docs/art/body-slots.svg。
剪影與熱點的位置照 docs/mockups/character.html 身體分頁那一版（頭、頸、軀幹、雙臂、雙腿；橋在後頸），重畫成乾淨的線稿；
部位、槽數與典型的義體照 CYBERWARE 第 1 節的表。人形是中性的成年人體模型，不畫身體細節。
每張卡片的圖標是 icons-sprite.svg 的第 2 層義體部位圖標（ic-cw_…）。
用法：python3 tools/art/gen_body.py"""
import os, re

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '../..'))
OUT = os.path.join(ROOT, 'docs', 'art', 'body-slots.svg')
FONT = "'Noto Sans TC','PingFang TC','Microsoft JhengHei','WenQuanYi Zen Hei',sans-serif"
BG, PANEL, INK, INK2, INK3 = '#17111F', '#120D19', '#F3E9FF', '#C9B8E8', '#7d7390'
PINK, LAV, BODY, EDGE = '#F06AA0', '#C9B8E8', '#2C2136', '#5B4675'
W, H = 1200, 1040
CX = 600

# (id, 名字, 熱點的字, 圖標, 槽的寫法, 槽 [(數, 標)], 典型的義體, 哪一欄, 卡片的 y, 熱點 [(x, y)])
PARTS = [
    ('brain', '腦', '腦', 'cw_brain', '3 槽', [(3, '')], '甲板、反射加速器、記憶庫、人格面具槽、人偶晶片', 'L', 60, [(600, 112)]),
    ('eye', '眼', '眼', 'cw_eye', '2 槽', [(2, '')], '義眼（瞄準、夜視、錄影）、掃描器', 'L', 200, [(582, 152)]),
    ('skin', '皮膚', '皮', 'cw_skin', '2 槽', [(2, '')], '觸覺強化皮膚、光學迷彩、光紋刺青', 'L', 340, [(546, 290)]),
    ('arm', '臂', '臂', 'cw_arm', '左 2・右 2', [(2, '左'), (2, '右')], '義臂、內藏武器、駭入接頭、手術指', 'L', 480, [(470, 470), (730, 470)]),
    ('leg', '腿', '腿', 'cw_leg', '左 2・右 2', [(2, '左'), (2, '右')], '義腿、跳躍增壓、靜音足墊', 'L', 640, [(560, 680), (640, 680)]),
    ('ear', '耳與喉', '耳', 'cw_earthroat', '2 槽', [(2, '')], '聲紋偽裝、指向收音、費洛蒙腺', 'R', 60, [(648, 154)]),
    ('bridge', '橋', '橋', 'cw_bridge', '後頸・1 ＋調校 2', [(1, ''), (2, '調校')], '邊緣橋本體；型號決定四類技能的容量', 'R', 200, [(624, 222)]),
    ('torso', '軀幹', '軀', 'cw_torso', '3 槽', [(3, '')], '皮下裝甲、合成臟器、藥泵、備用心臟', 'R', 340, [(600, 340)]),
    ('intimate', '私密', '私', 'cw_intimate', '2 槽', [(2, '')], '感官強化、鎖具、藏匿艙', 'R', 480, [(600, 506)]),
]
CARD_W, CARD_H = 320, 112


def figure():
    """中性的人體模型：頭、頸、軀幹、雙臂、雙腿。左右對稱，右半邊用鏡射。"""
    arm = 'M512 262Q488 266 482 300L464 430L450 540Q448 568 464 570Q478 570 480 544L498 432L516 330Z'
    leg = 'M514 512H596L590 700L584 900Q584 920 566 920H548Q534 920 538 900L532 700Z'
    torso = 'M520 248Q600 226 680 248Q702 256 700 292L690 360Q676 420 684 470L692 520Q600 540 508 520L516 470Q524 420 510 360L500 292Q498 256 520 248Z'
    mirror = f'transform="matrix(-1 0 0 1 {2 * CX} 0)"'
    g = [f'<ellipse cx="{CX}" cy="930" rx="120" ry="12" fill="#000" fill-opacity=".35"/>',
         f'<g fill="{BODY}" stroke="{EDGE}" stroke-width="2.5" stroke-linejoin="round">',
         f'<path d="{arm}"/><path d="{arm}" {mirror}/>',
         f'<path d="{leg}"/><path d="{leg}" {mirror}/>',
         f'<path d="M584 196H616L620 240H580Z"/>',
         f'<path d="{torso}"/>',
         f'<ellipse cx="{CX}" cy="140" rx="46" ry="58"/>',
         '</g>']
    # 掃描線與關節的淡線（義體的接縫感，不畫身體細節）
    g.append(f'<g fill="none" stroke="{EDGE}" stroke-width="1.5" stroke-opacity=".8">'
             f'<path d="M532 300Q600 316 668 300"/><path d="M520 470Q600 488 680 470"/>'
             f'<path d="M478 430H500M700 430H722M538 700H590M610 700H662"/></g>')
    g.append(f'<path d="M600 198V236" stroke="{PINK}" stroke-width="3" stroke-opacity=".5" stroke-dasharray="2 4"/>')
    return ''.join(g)


def back_inset(x, y):
    """背面的小圖：橋在後頸。"""
    o = [f'<g transform="translate({x} {y})">',
         f'<rect width="300" height="200" fill="{PANEL}" stroke="#2E2339"/>',
         f'<path d="M0 0H90V3H0Z" fill="{PINK}"/>',
         f'<text x="16" y="28" font-size="13" font-weight="800" fill="{INK2}">背面・後頸</text>',
         f'<g transform="translate(150 118)" fill="{BODY}" stroke="{EDGE}" stroke-width="2.5">'
         '<path d="M-90 70Q-86 34 -44 28Q-16 24 -14 8H14Q16 24 44 28Q86 34 90 70Z"/><path d="M-16 -20H16L18 12H-18Z"/><ellipse cx="0" cy="-54" rx="36" ry="44"/></g>',
         f'<rect x="141" y="102" width="18" height="16" rx="3" fill="{PINK}"/><rect x="141" y="102" width="18" height="16" rx="3" fill="none" stroke="{BG}" stroke-width="2"/>',
         f'<path d="M159 110H204" stroke="{INK3}" stroke-width="1.5"/><circle cx="159" cy="110" r="3" fill="{PINK}"/>',
         f'<text x="210" y="106" font-size="12" font-weight="800" fill="{PINK}">橋</text><text x="210" y="122" font-size="11" fill="{INK2}">邊緣橋的接口</text>',
         '</g>']
    return ''.join(o)


def card(p, sprite_ids):
    pid, name, ch, icon, slot_txt, slots, typical, side, cy, hots = p
    x = 40 if side == 'L' else W - 40 - CARD_W
    y = cy
    c = 14
    o = [f'<path d="M{x} {y}H{x + CARD_W - c}L{x + CARD_W} {y + c}V{y + CARD_H}H{x + c}L{x} {y + CARD_H - c}Z" fill="{PANEL}" stroke="#2E2339"/>',
         f'<use href="#ic-{icon}" x="{x + 12}" y="{y + 14}" width="54" height="54" style="--o:{BG};--a:{PINK};--b:#8E7CC3;--c:{INK}"/>',
         f'<text x="{x + 78}" y="{y + 32}" font-size="19" font-weight="900" fill="{INK}">{name}</text>',
         f'<text x="{x + CARD_W - 14}" y="{y + 31}" text-anchor="end" font-size="12" font-weight="700" fill="{INK3}">{slot_txt}</text>']
    sprite_ids.add(icon)
    sx = x + 78
    for n, lab in slots:
        if lab:
            o.append(f'<text x="{sx}" y="{y + 60}" font-size="11" font-weight="700" fill="{INK3}">{lab}</text>')
            sx += 11 * len(lab) + 5
        for k in range(n):
            dash = ' stroke-dasharray="3 3"' if lab == '調校' else ''
            o.append(f'<rect x="{sx}" y="{y + 44}" width="20" height="20" rx="4" fill="#2E2339" stroke="{LAV}" stroke-opacity=".7" stroke-width="1.5"{dash}/>')
            sx += 25
        sx += 10
    o.append(f'<text x="{x + 14}" y="{y + 94}" font-size="12" fill="{INK2}">{typical}</text>')
    # 引線
    ax = x + CARD_W if side == 'L' else x
    ay = y + 30
    for k, (hx, hy) in enumerate(hots):
        if k == 0:
            ex = (hx - 60) if side == 'L' else (hx + 60)
            ex = max(ex, ax + 30) if side == 'L' else min(ex, ax - 30)
            o.append(f'<path d="M{ax} {ay}H{ex}L{hx} {hy}" fill="none" stroke="{INK3}" stroke-width="1.5"/>')
        o.append(f'<circle cx="{hx}" cy="{hy}" r="15" fill="{LAV}" stroke="{BG}" stroke-width="3"/>'
                 f'<text x="{hx}" y="{hy + 5}" text-anchor="middle" font-size="13" font-weight="900" fill="{BG}">{ch}</text>')
        if pid == 'leg':
            continue
        if k == 1:
            o.append(f'<text x="{hx + 22}" y="{hy + 5}" font-size="11.5" font-weight="700" fill="{INK3}">右</text>')
        elif len(hots) > 1:
            o.append(f'<text x="{hx - 22}" y="{hy + 5}" text-anchor="end" font-size="11.5" font-weight="700" fill="{INK3}">左</text>')
    return ''.join(o)


def main():
    used = set()
    cards = ''.join(card(p, used) for p in PARTS)
    sprite = open(os.path.join(ROOT, 'docs', 'art', 'style', 'icons-sprite.svg'), encoding='utf-8').read()
    syms = ''.join(re.search(rf'<symbol id="ic-{i}".*?</symbol>', sprite, re.S).group(0) for i in sorted(used))
    o = [f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {W} {H}" width="{W}" height="{H}" font-family="{FONT}">',
         '<title>義體部位圖 v0</title>',
         '<defs><style>.s{stroke:var(--o);stroke-width:9;stroke-linejoin:round;stroke-linecap:round;paint-order:stroke}</style>'
         '<pattern id="g" width="24" height="24" patternUnits="userSpaceOnUse"><path d="M24 0H0V24" fill="none" stroke="#fff" stroke-opacity=".03"/></pattern>'
         f'<pattern id="scan" width="6" height="6" patternUnits="userSpaceOnUse"><path d="M0 0H6" stroke="{LAV}" stroke-opacity=".05"/></pattern>'
         f'{syms}</defs>',
         f'<rect width="{W}" height="{H}" fill="{BG}"/><rect width="{W}" height="{H}" fill="url(#g)"/>',
         f'<path d="M400 40H786L800 54V960H414L400 946Z" fill="{PANEL}"/><path d="M400 40H786L800 54V960H414L400 946Z" fill="url(#scan)"/>',
         f'<path d="M400 40h16v3h-16zM400 40h3v16h-3z" fill="{PINK}"/><path d="M800 960h-16v-3h16zM800 960h-3v-16h3z" fill="{PINK}"/>',
         figure(), cards, back_inset(40, 790),
         f'<text x="{W - 40}" y="{H - 60}" text-anchor="end" font-size="26" font-weight="900" fill="{PINK}" letter-spacing="4">義體部位圖</text>',
         f'<text x="{W - 40}" y="{H - 34}" text-anchor="end" font-size="12" fill="{INK3}">九個部位・實線的槽裝義體，虛線的是橋的調校槽　·　部位與槽數：CYBERWARE 第 1 節　·　示意 v0</text>',
         '</svg>']
    for p in (OUT, os.path.join(os.path.join(ROOT, 'docs', 'mockups', 'maps'), os.path.basename(OUT))):   # 原型的導覽頁讀 mockups/maps 的副本
        os.makedirs(os.path.dirname(p), exist_ok=True)
        open(p, 'w', encoding='utf-8').write('\n'.join(o))
    print('→', os.path.relpath(OUT, ROOT))


if __name__ == '__main__':
    main()
