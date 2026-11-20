"""技能圖標的中間符號：SUBJECTS（英文鍵 → SVG 內容，200×200）與 SKILL_SUBJECT（技能名 → 符號鍵）。
規格：剪影＋扁平，--c 主體、--o 輪廓與切口、--a 至多一個小重點；不用 --b（底框給）。
class="s" 給主形狀 9 的 --o 描邊；線條符號是寬 --o 線上疊窄 --c 線。
夜課只用抽象符號（心、緞帶、月、星光、唇印、鏡子、相機……），不畫人體。
檢查：python3 tools/art/subjects/sheet.py skills <png>"""
import math

S = 'class="s"'
C, O, A = 'var(--c)', 'var(--o)', 'var(--a)'


def f(v):
    return f'{v:.1f}'.rstrip('0').rstrip('.')


def P(d, fill=C, s=True, extra=''):
    return f'<path {S if s else ""} fill="{fill}" d="{d}"{extra}/>'


def Ci(cx, cy, r, fill=C, s=True):
    return f'<circle {S if s else ""} cx="{f(cx)}" cy="{f(cy)}" r="{f(r)}" fill="{fill}"/>'


def R(x, y, w, h, rx=0, fill=C, s=True, tf=''):
    t = f' transform="{tf}"' if tf else ''
    return f'<rect {S if s else ""} x="{f(x)}" y="{f(y)}" width="{f(w)}" height="{f(h)}" rx="{f(rx)}" fill="{fill}"{t}/>'


def E(cx, cy, rx, ry, fill=C, s=True, tf=''):
    t = f' transform="{tf}"' if tf else ''
    return f'<ellipse {S if s else ""} cx="{f(cx)}" cy="{f(cy)}" rx="{f(rx)}" ry="{f(ry)}" fill="{fill}"{t}/>'


def L(d, w=14, col=C, cap='round'):
    """線條符號：寬的 --o 線墊底，窄的主色線在上。"""
    return (f'<path d="{d}" fill="none" stroke="var(--o)" stroke-width="{w + 10}" stroke-linecap="{cap}" stroke-linejoin="round"/>'
            f'<path d="{d}" fill="none" stroke="{col}" stroke-width="{w}" stroke-linecap="{cap}" stroke-linejoin="round"/>')


def Lo(d, w=7, col=O):
    """單色細線（切口用）。"""
    return f'<path d="{d}" fill="none" stroke="{col}" stroke-width="{w}" stroke-linecap="round" stroke-linejoin="round"/>'


def ring(cx, cy, r, w=14, col=C):
    return (f'<circle cx="{f(cx)}" cy="{f(cy)}" r="{f(r)}" fill="none" stroke="var(--o)" stroke-width="{w + 10}"/>'
            f'<circle cx="{f(cx)}" cy="{f(cy)}" r="{f(r)}" fill="none" stroke="{col}" stroke-width="{w}"/>')


def G(body, tf):
    return f'<g transform="{tf}">{body}</g>'


_HEART = [('M', 100, 176), ('C', 40, 136, 26, 104, 40, 78), ('Q', 56, 52, 86, 64), ('Q', 96, 70, 100, 80),
          ('Q', 104, 70, 114, 64), ('Q', 144, 52, 160, 78), ('Q', 174, 104, 100, 176)]


def heart_d(cx, cy, s):
    """心形路徑，中心 (cx, cy)，半寬約 s。"""
    k = s / 74
    out = []
    for seg in _HEART:
        pts = seg[1:]
        out.append(seg[0] + ' '.join(f(cx + (pts[i] - 100) * k if i % 2 == 0 else cy + (pts[i] - 116) * k) for i in range(len(pts))))
    return ''.join(out) + 'Z'


def H(cx, cy, s, fill=C, st=True):
    return P(heart_d(cx, cy, s), fill, st)


def star_d(cx, cy, R1, r1, n=5, rot=-90):
    pts = []
    for k in range(n * 2):
        rr = R1 if k % 2 == 0 else r1
        a = math.radians(rot + k * 180 / n)
        pts.append(f'{f(cx + rr * math.cos(a))} {f(cy + rr * math.sin(a))}')
    return 'M' + 'L'.join(pts) + 'Z'


def poly_d(cx, cy, r, n, rot=-90):
    return 'M' + 'L'.join(f'{f(cx + r * math.cos(math.radians(rot + k * 360 / n)))} {f(cy + r * math.sin(math.radians(rot + k * 360 / n)))}' for k in range(n)) + 'Z'


def sparkle_d(cx, cy, r):
    q = r * .28
    return (f'M{f(cx)} {f(cy - r)}Q{f(cx + q)} {f(cy - q)} {f(cx + r)} {f(cy)}Q{f(cx + q)} {f(cy + q)} {f(cx)} {f(cy + r)}'
            f'Q{f(cx - q)} {f(cy + q)} {f(cx - r)} {f(cy)}Q{f(cx - q)} {f(cy - q)} {f(cx)} {f(cy - r)}Z')


def bullet(x, y, w=30, h=90, acc=False):
    """直立的子彈：(x, y) 是彈尖頂端的左邊界。"""
    tip = h * .38
    return (P(f'M{x} {y + tip}Q{x} {y} {x + w / 2} {y - 4}Q{x + w} {y} {x + w} {y + tip}Z')
            + R(x, y + tip, w, h - tip, 3) + R(x, y + h - 12, w, 12, 2, A if acc else O, False))


def rocket(cx=100, cy=100, k=1.0, acc=True):
    b = (P('M100 26Q136 56 136 110V140H64V110Q64 56 100 26Z') + P('M64 104L40 140V160L64 146Z') + P('M136 104L160 140V160L136 146Z')
         + Ci(100, 84, 15, O, False) + (Ci(100, 84, 7, A, False) if acc else '') + P('M86 146L100 174L114 146Z', C))
    return G(b, f'translate({cx} {cy}) scale({k}) translate(-100 -100)')


EYE = 'M22 100Q100 34 178 100Q100 166 22 100Z'
SHIELD = 'M100 30L156 50V96Q156 146 100 172Q44 146 44 96V50Z'
BUBBLE = 'M40 50H160Q172 50 172 62V122Q172 134 160 134H96L62 162L68 134H40Q28 134 28 122V62Q28 50 40 50Z'
CLOUD = 'M54 144Q28 144 28 118Q28 94 54 92Q58 62 88 62Q108 62 118 78Q128 68 144 70Q168 74 168 100Q180 108 178 124Q174 144 152 144Z'
FLAME = 'M100 24Q146 66 142 108Q138 150 100 150Q62 150 58 108Q56 80 80 62Q82 84 96 90Q84 56 100 24Z'
HAND = ('M56 176V102Q56 90 66 90V56Q66 46 76 46Q86 46 86 56V86V44Q86 34 96 34Q106 34 106 44V86V50Q106 40 116 40'
        'Q126 40 126 50V92V66Q126 56 136 56Q146 56 146 66V130Q146 176 110 176Z')
CUP = 'M44 30H156Q156 92 112 108V140H134V160H66V140H88V108Q44 92 44 30Z'

SUBJECTS = {}


def add(k, body):
    assert k not in SUBJECTS, k
    SUBJECTS[k] = body


# ================= 射擊 =================
add('crosshair', ring(100, 100, 52, 14) + L('M100 28V62M100 138V172M28 100H62M138 100H172', 14) + Ci(100, 100, 11, A))
add('bullseye', Ci(100, 100, 68) + Ci(100, 100, 48, O, False) + Ci(100, 100, 34, C, False) + Ci(100, 100, 16, A, False))
add('scope', Ci(100, 100, 66) + Lo('M100 40V160M40 100H160', 8) + f'<circle cx="100" cy="100" r="30" fill="none" stroke="{O}" stroke-width="8"/>' + Ci(100, 100, 9, A, False))
add('bullet', G(bullet(80, 26, 40, 148, True), 'rotate(40 100 100)'))
add('bullet_pair', bullet(54, 34, 38, 132) + bullet(108, 34, 38, 132, True))
add('bullet_stream', ''.join(R(x, y - 13, 44, 26, 3) + P(f'M{x + 44} {y - 13}Q{x + 70} {y - 10} {x + 72} {y}Q{x + 70} {y + 10} {x + 44} {y + 13}Z') + R(x, y - 13, 10, 26, 2, A if k == 2 else O, False)
                              for k, (x, y) in enumerate(((28, 60), (58, 100), (88, 140)))) + L('M24 100H40M54 140H70', 8))
add('muzzle', R(20, 80, 80, 40, 8) + R(44, 66, 26, 16, 4) + P(star_d(132, 100, 54, 26, 8, -90)) + Ci(132, 100, 14, A, False))
add('barrage', ''.join(G(bullet(86, 30, 28, 84, a == 0), f'rotate({a} 100 160)') for a in (-36, 0, 36)))
add('pistol', R(34, 60, 132, 36, 8) + P('M58 92H100L108 160Q108 168 100 168H72Q64 168 62 160Z') + Lo('M100 112Q120 112 120 96', 9)
    + R(130, 70, 24, 10, 4, A, False))
add('twin_barrel', R(28, 62, 112, 30, 8) + R(28, 108, 112, 30, 8) + R(136, 54, 30, 46, 8) + R(136, 100, 30, 46, 8)
    + Lo('M60 62V92M90 62V92M60 108V138M90 108V138', 6) + Ci(151, 77, 7, A, False))
add('tile_target', R(36, 36, 128, 128, 16) + f'<circle cx="100" cy="100" r="36" fill="none" stroke="{O}" stroke-width="9"/>'
    + Lo('M100 52V148M52 100H148', 8) + Ci(100, 100, 9, A, False))
add('mark_pin', E(100, 146, 52, 16, 'none', False).replace('fill="none"', f'fill="none" stroke="{O}" stroke-width="20"')
    + E(100, 146, 52, 16, 'none', False).replace('fill="none"', f'fill="none" stroke="{C}" stroke-width="10"')
    + P('M58 34H142L100 112Z') + Ci(100, 60, 10, A, False))
add('press_down', L('M56 40L100 72L144 40M56 78L100 110L144 78', 16) + R(34, 132, 132, 26, 8) + R(90, 139, 20, 12, 4, A, False))
add('push', P('M30 78H100V48L170 100L100 152V122H30Z') + Lo('M48 78V122M66 78V122', 7) + Ci(130, 100, 8, A, False))
add('dash', P('M92 54L166 100L92 146V122H64V78H92Z') + L('M30 70H48M22 100H46M30 130H48', 12) + Ci(110, 100, 8, A, False))
add('pierce', R(82, 34, 36, 132, 6) + Lo('M82 78H118M82 122H118', 7) + L('M30 100H150', 16) + P('M140 74L176 100L140 126Z') + Lo('M100 34L94 60L106 72', 6) + R(26, 90, 14, 20, 4, A, False))
add('ecg', L('M24 108H62L78 66L100 146L118 50L134 108H168', 13) + Ci(170, 108, 10, A))
add('back_arrow', L('M156 56V96Q156 132 120 132H76', 18) + P('M82 104L38 132L82 160Z'))
add('boomerang', L('M52 132A54 54 0 1 1 150 126', 16) + P('M130 122L170 116L156 154Z') + Ci(52, 140, 12, A))
add('metronome', P('M78 32H122L158 168H42Z') + R(42, 150, 116, 18, 4, O, False) + Lo('M100 140L136 54', 9) + R(110, 84, 24, 18, 4, A, False, 'rotate(22 122 93)'))
add('flow', L('M28 76Q46 54 64 76T100 76T136 76T172 76', 13) + L('M28 124Q46 102 64 124T100 124T136 124T172 124', 13))
add('ricochet', L('M30 146L76 64L118 140L150 84', 15) + P('M136 72L170 54L166 94Z') + P(star_d(118, 140, 18, 8, 6), A, False))
add('firewall', R(32, 106, 136, 64, 6) + Lo('M32 128H168M32 150H168M76 106V128M124 106V128M54 128V150M100 128V150M146 128V150M76 150V170M124 150V170', 6)
    + P('M100 24Q136 56 132 84Q128 104 100 104Q72 104 68 84Q66 66 84 54Q86 70 96 72Q88 48 100 24Z') + P('M100 66Q116 80 112 92Q108 100 100 100Q92 100 90 92Q90 82 100 66Z', A, False))
add('stopwatch', R(86, 26, 28, 18, 5) + L('M146 54L156 44', 12) + Ci(100, 110, 60) + Ci(100, 110, 46, O, False)
    + Lo('M100 110V76M100 110L124 124', 9, C) + Ci(100, 110, 7, A, False))

# ================= 無人機與機甲 =================
add('drone', L('M58 62L142 146M142 62L58 146', 11) + ''.join(E(x, y, 26, 8) for x, y in ((52, 56), (148, 56), (52, 146), (148, 146)))
    + R(72, 78, 56, 50, 16) + Ci(100, 103, 11, A))
add('plane', P('M26 98L172 36L132 162L100 124Z') + P('M100 124L172 36L94 160Z') + Lo('M100 124L172 36', 6))
add('shield', P(SHIELD) + P('M100 30L156 50V96Q156 146 100 172Z', O, False) + P('M100 44L144 60V96Q144 136 100 158Z', C, False) + Ci(100, 98, 10, A, False))
add('shield_aim', P(SHIELD) + f'<circle cx="100" cy="98" r="26" fill="none" stroke="{O}" stroke-width="8"/>' + Lo('M100 60V136M62 98H138', 8) + Ci(100, 98, 8, A, False))
add('shield_heart', P(SHIELD) + H(100, 98, 30, A, False))
add('link', R(28, 76, 84, 48, 24, 'none', False, 'rotate(-30 70 100)').replace('fill="none"', f'fill="none" stroke="{O}" stroke-width="28"')
    + R(28, 76, 84, 48, 24, 'none', False, 'rotate(-30 70 100)').replace('fill="none"', f'fill="none" stroke="{C}" stroke-width="16"')
    + R(88, 76, 84, 48, 24, 'none', False, 'rotate(-30 130 100)').replace('fill="none"', f'fill="none" stroke="{O}" stroke-width="28"')
    + R(88, 76, 84, 48, 24, 'none', False, 'rotate(-30 130 100)').replace('fill="none"', f'fill="none" stroke="{C}" stroke-width="16"')
    + Ci(100, 100, 8, A, False))
add('repeat', L('M50 92A52 52 0 0 1 140 66', 15) + P('M124 48L162 62L136 92Z') + L('M150 108A52 52 0 0 1 60 134', 15) + P('M76 152L38 138L64 108Z'))
add('map_pin', P('M100 174Q48 116 48 84A52 52 0 0 1 152 84Q152 116 100 174Z') + H(100, 84, 24, O, False))
add('formation', ''.join(P(f'M{x} {y - 30}L{x + 26} {y + 24}L{x} {y + 12}L{x - 26} {y + 24}Z') for x, y in ((100, 58), (56, 128), (144, 128))) + Ci(100, 62, 7, A, False))
add('spring', R(46, 30, 108, 20, 6) + R(46, 150, 108, 20, 6) + L('M100 50L140 68L60 90L140 112L60 134L100 150', 12) + Ci(100, 40, 5, A, False))
add('wrench', L('M58 146L126 78', 22) + P('M122 36A38 38 0 1 0 164 78L142 84L118 60Z') + Ci(58, 146, 8, A, False))
add('screwdriver', G(R(82, 22, 36, 70, 14) + R(82, 72, 36, 12, 0, A, False) + R(93, 92, 14, 58) + P('M93 150H107L100 172Z'), 'rotate(45 100 100)'))
add('fist', P('M48 74Q48 58 64 58H138Q154 58 154 74V136Q154 156 134 156H70Q48 156 48 134Z') + Lo('M80 58V100M106 58V100M132 58V100', 8)
    + P('M38 98Q38 88 50 88H96Q108 88 108 100Q108 112 96 112H52Q38 112 38 98Z') + Ci(130, 134, 8, A, False))
add('chevrons', L('M46 50L90 100L46 150M100 50L144 100L100 150', 20))
add('tower', P('M46 170V58H70V78H88V58H112V78H130V58H154V170Z') + P('M82 170V138Q82 120 100 120Q118 120 118 138V170Z', O, False) + R(92, 92, 16, 18, 4, A, False))
add('rocket', rocket())
add('missiles', ''.join(G(P('M100 40Q118 56 118 84V146H82V84Q82 56 100 40Z') + R(82, 120, 36, 10, 0, O, False) + P('M88 146L100 166L112 146Z', A if x == 100 else C), f'translate({x - 100} {dy})')
                         for x, dy in ((52, 14), (100, -8), (148, 14))))
add('cloud', P(CLOUD) + P('M60 120Q72 108 86 118', 'none', False, f' stroke="{O}" stroke-width="7" stroke-linecap="round"') + Ci(130, 116, 8, A, False))
add('brain', P('M100 40Q60 30 46 62Q28 72 36 102Q30 130 58 140Q66 164 100 156Q134 164 142 140Q170 130 164 102Q172 72 154 62Q140 30 100 40Z')
    + Lo('M100 44V154M62 84Q80 80 84 100M138 84Q120 80 116 100M66 122Q82 116 92 126M134 122Q118 116 108 126', 7))
add('radar', P('M40 64A76 76 0 0 0 128 152Z') + Lo('M84 108L118 74', 8) + Ci(120, 72, 9, A) + L('M140 52Q156 60 160 76M140 26Q178 38 186 76', 9)
    + P('M70 140L58 172H110L98 148Z'))
add('sync', ring(78, 100, 42, 14) + ring(122, 100, 42, 14) + Lo('M100 66A42 42 0 0 1 100 134', 14, C) + Ci(100, 100, 9, A, False))
add('guided', G(rocket(100, 100, .62, False), 'translate(-28 28) rotate(45 100 100)') + ring(146, 54, 22, 8) + Lo('M146 24V38M146 70V84M116 54H130M162 54H176', 6, C) + Ci(146, 54, 6, A, False)
    + Lo('M112 88L124 76', 6, C))
add('gear', ''.join(R(88, 22, 24, 30, 5, C, True, f'rotate({a} 100 100)') for a in range(0, 360, 45)) + Ci(100, 100, 52) + Ci(100, 100, 22, O, False) + Ci(100, 100, 9, A, False))
add('toolbox', L('M74 82V60H126V82', 12) + R(32, 80, 136, 84, 12) + R(32, 80, 136, 28, 12) + R(88, 98, 24, 20, 4, A))
add('hive', ''.join(P(poly_d(x, y, 32, 6, 0), A if (x, y) == (100, 72) else C) for x, y in ((100, 72), (72, 128), (128, 128))))
add('dome', R(24, 146, 152, 22, 8) + P('M34 146A66 66 0 0 1 166 146Z') + Lo('M100 82V146M62 98Q76 120 76 146M138 98Q124 120 124 146', 7) + Ci(100, 74, 9, A))
add('wings', P('M94 84Q60 40 22 50Q30 72 50 80Q30 88 30 106Q52 110 68 104Q58 118 66 134Q88 126 94 104Z')
    + P('M106 84Q140 40 178 50Q170 72 150 80Q170 88 170 106Q148 110 132 104Q142 118 134 134Q112 126 106 104Z') + P(poly_d(100, 98, 14, 4), A))
add('anger', ''.join(G(L('M88 40Q88 88 40 88', 18), f'rotate({a} 100 100)') for a in (0, 90, 180, 270)))
add('robot', L('M100 54V36', 9) + Ci(100, 32, 9, A) + R(28, 84, 18, 36, 6) + R(154, 84, 18, 36, 6) + R(44, 54, 112, 92, 22)
    + R(64, 80, 72, 34, 10, O, False) + R(74, 90, 14, 14, 4, C, False) + R(112, 90, 14, 14, 4, C, False) + Lo('M80 128H120', 7))

# ================= 醫療與義體 =================
add('scalpel', G(R(91, 96, 18, 78, 6) + P('M91 98V46Q91 26 106 26Q116 46 109 98Z') + R(91, 108, 18, 8, 0, A, False), 'rotate(40 100 100)'))
add('medkit', L('M76 60V44H124V60', 12) + R(32, 58, 136, 106, 14) + P('M88 82H112V100H130V124H112V142H88V124H70V100H88Z', A, False))
add('heart_plus', H(100, 100, 66) + P('M90 74H110V94H130V114H110V134H90V114H70V94H90Z', O, False))
add('bandage', G(R(26, 74, 148, 52, 26) + R(74, 74, 52, 52, 0, O, False) + R(80, 80, 40, 40, 4, C, False)
                 + ''.join(Ci(x, y, 3.5, O, False) for x in (90, 110) for y in (90, 110)), 'rotate(-35 100 100)'))
add('syringe', G(R(60, 82, 80, 36, 6) + R(70, 90, 34, 20, 3, A, False) + R(140, 94, 22, 12) + R(160, 78, 12, 44, 4) + R(52, 76, 10, 48, 4) + L('M50 100H24', 6), 'rotate(-45 100 100)'))
add('stitches', L('M26 100Q63 80 100 100T174 100', 14) + L('M50 68L60 124M84 72L94 128M112 74L122 128M144 72L152 124', 12) + Ci(174, 100, 8, A))
add('wind', L('M28 74H118Q144 74 144 54Q144 36 126 36Q110 36 110 52', 13) + L('M28 108H150Q172 108 172 130Q172 150 152 150Q136 150 134 134', 13)
    + L('M42 142H96', 13))
add('lamp', L('M100 26V48', 12) + P('M36 112Q36 50 100 50Q164 50 164 112Z') + Ci(70, 112, 11, O, False) + Ci(100, 112, 11, A, False) + Ci(130, 112, 11, O, False)
    + L('M66 140L56 166M100 142V172M134 140L144 166', 10))
add('gauge', P('M26 138A74 74 0 0 1 174 138Z') + Lo('M46 116L56 120M60 82L68 90M100 70V82M140 82L132 90M154 116L144 120', 7) + L('M100 136L146 78', 10) + Ci(100, 136, 12, A))
add('heart_bolt', H(100, 102, 68) + P('M110 62L78 108H100L90 146L124 96H102Z', O, False))
add('crack', R(36, 36, 128, 128, 18) + Lo('M100 36L84 76L114 98L90 132L104 164', 10) + Lo('M114 98L140 92', 7) + Ci(60, 140, 8, A, False))
add('nut', P(poly_d(100, 100, 68, 6, 0)) + Ci(100, 100, 30, O, False))
add('clipboard', R(44, 40, 112, 132, 12) + R(74, 28, 52, 26, 8) + Lo('M68 110H132M68 136H112', 9) + L('M66 80L80 92L100 70', 8, A))
add('plug', R(62, 80, 76, 60, 12) + R(76, 46, 12, 36, 4) + R(112, 46, 12, 36, 4) + L('M100 140V172', 14) + Ci(100, 110, 9, A, False))
add('drops', ''.join(P(f'M{x} {y - 34}Q{x + 26} {y} {x + 26} {y + 14}A26 26 0 0 1 {x - 26} {y + 14}Q{x - 26} {y} {x} {y - 34}Z', A if x == 148 else C) for x, y in ((52, 70), (100, 96), (148, 122))))
add('snowflake', L('M100 28V172M38 64L162 136M38 136L162 64', 12)
    + ''.join(G(L('M84 44L100 60L116 44', 9), f'rotate({a} 100 100)') for a in range(0, 360, 60)) + Ci(100, 100, 11, A))
add('magnifier', L('M120 120L162 162', 24) + ring(86, 86, 46, 16) + Lo('M66 76Q70 64 82 60', 8, C))
add('lock', L('M68 90V68Q68 38 100 38Q132 38 132 68V90', 16) + R(46, 86, 108, 84, 14) + Ci(100, 120, 12, O, False) + P('M94 124H106L110 148H90Z', O, False))
add('unlock', L('M60 90V64Q60 34 92 34Q124 34 124 64', 16) + R(46, 86, 108, 84, 14) + Ci(100, 120, 12, A, False) + P('M94 124H106L110 148H90Z', A, False))
add('bolt', P('M118 24L58 110H96L82 176L146 86H106Z') + P(sparkle_d(152, 150, 16), A))
add('spark', L('M24 128H62L78 112', 13) + L('M176 72H138L122 88', 13) + P(star_d(100, 100, 36, 14, 8)) + Ci(100, 100, 9, A, False))
add('alarm', Ci(56, 52, 20) + Ci(144, 52, 20) + L('M70 162L58 174M130 162L142 174', 12) + Ci(100, 108, 58) + Ci(100, 108, 44, O, False)
    + Lo('M100 108V80M100 108L122 120', 9, C) + Ci(100, 108, 7, A, False))
add('explode', P(star_d(100, 100, 72, 38, 10, -90)) + P(star_d(100, 100, 34, 18, 10, -72), A, False))
add('medal', P('M64 26H92L110 78H82Z') + P('M136 26H108L90 78H118Z') + Ci(100, 118, 46) + P(star_d(100, 120, 26, 11), A, False))
add('hand', P(HAND))
add('hand_heart', P(HAND) + H(102, 128, 22, A, False))

# ================= 網路 =================
add('terminal', R(28, 40, 144, 120, 14) + R(28, 40, 144, 26, 14, O, False) + R(28, 56, 144, 10, 0, O, False) + Ci(46, 53, 5, A, False)
    + Lo('M54 92L76 110L54 128', 10, O) + Lo('M90 130H124', 10, O))
add('broken_ice', P('M100 26L148 60V140L100 174L52 140V60Z') + Lo('M100 26V174M52 60L100 90L148 60', 6) + Lo('M118 40L104 76L124 98L106 134L120 168', 9)
    + P('M150 40L170 30L164 52Z', A))
add('black_ice', P('M100 26L148 60V140L100 174L52 140V60Z', O, False, f' stroke="{C}" stroke-width="9" stroke-linejoin="round"')
    + Lo('M100 92V170M56 62L100 92L144 62', 6, C) + P('M86 112L100 98L114 112L100 140Z', A, False))
add('eye', P(EYE) + Ci(100, 100, 32, O, False) + Ci(112, 88, 10, C, False))
add('eye_aim', P(EYE) + Ci(100, 100, 32, O, False) + Lo('M100 76V124M76 100H124', 6, C) + Ci(100, 100, 7, A, False))
add('eye_no', P(EYE) + Ci(100, 100, 30, O, False) + Ci(110, 90, 9, C, False) + L('M42 158L158 42', 13))
add('eye_heart', P(EYE) + H(100, 102, 30, O, False) + Lo('M50 62L42 50M100 50V36M150 62L158 50', 8, C))
add('cursor', P('M58 30V150L86 126L106 168L128 158L108 118H146Z') + P(sparkle_d(150, 52, 18), A))
add('loop', L('M100 100C80 66 36 66 36 100C36 134 80 134 100 100C120 66 164 66 164 100C164 134 120 134 100 100Z', 17))
add('eraser', G(R(30, 72, 140, 56, 10) + R(30, 72, 56, 56, 10, A, False) + Lo('M86 72V128', 7), 'rotate(-30 100 100)') + Lo('M40 168H120', 9, C))
add('wifi', L('M80 130A28 28 0 0 1 120 130M60 110A56 56 0 0 1 140 110M40 90A84 84 0 0 1 160 90', 15) + Ci(100, 152, 13, A))
add('battery', R(30, 60, 128, 80, 14) + R(158, 82, 16, 36, 5) + R(44, 74, 30, 52, 5, O, False) + R(80, 74, 30, 52, 5, O, False) + R(116, 74, 28, 52, 5, A, False))
add('flame', P(FLAME) + P('M100 84Q124 106 120 126Q116 142 100 142Q84 142 80 126Q80 108 100 84Z', A, False))
add('mute', P('M30 78H58L96 46V154L58 122H30Z') + L('M120 78L162 120M162 78L120 120', 13))
add('blocks', ''.join(R(x, y, 40, 40, 6, A if (x, y) == (100, 56) else C) for x, y in ((40, 104), (80, 104), (120, 104), (100, 56), (60, 56))))
add('surge', P('M100 24L146 74H118V122H82V74H54Z') + L('M28 146Q46 128 64 146T100 146T136 146T172 146', 12) + P(sparkle_d(150, 40, 14), A))
add('download', P('M84 26H116V84H142L100 128L58 84H84Z') + L('M34 120V158H166V120', 15) + R(130, 140, 20, 8, 4, A, False))
add('dive', P('M86 24H114V72H136L100 112L64 72H86Z') + L('M26 132Q44 116 62 132T100 132T138 132T174 132M50 162Q66 148 82 162T116 162T150 162', 11)
    + Ci(150, 92, 9, A) + Ci(56, 92, 6))
add('backdoor', R(54, 28, 92, 144, 6) + R(68, 42, 64, 130, 0, O, False) + P('M68 42L112 56V158L68 172Z') + Ci(100, 112, 6, A, False))
add('server', ''.join(R(40, y, 120, 36, 8) + Ci(140, y + 18, 6, A if y == 32 else O, False) + Lo(f'M58 {y + 18}H100', 7) for y in (32, 82, 132)))
add('puppet', L('M48 36H152M100 26V58', 12) + Lo('M60 36V108M140 36V108M100 58V100', 5, C) + H(100, 130, 44) + Lo('M60 108L76 116M140 108L124 116', 5, C) + Ci(100, 30, 6, A, False))
add('mirror', E(100, 82, 46, 58) + E(100, 82, 32, 44, O, False) + Lo('M82 64L104 42M84 88L118 54', 8, C) + R(90, 140, 20, 34, 6) + P(sparkle_d(152, 40, 14), A))
add('windows', ''.join(R(x, y, 96, 72, 10) + R(x, y, 96, 18, 8, O, False) + Ci(x + 82, y + 9, 4, A if x == 74 else C, False) for x, y in ((30, 30), (52, 64), (74, 98))))
add('broadcast', P('M100 70L132 172H68Z') + Lo('M86 116H114M78 146H122', 7) + Ci(100, 62, 13, A) + L('M66 40Q52 60 66 82M134 40Q148 60 134 82M44 26Q20 60 44 96M156 26Q180 60 156 96', 9))
add('chain_break', R(20, 76, 76, 46, 23, 'none', False, 'rotate(-35 58 100)').replace('fill="none"', f'fill="none" stroke="{O}" stroke-width="28"')
    + R(20, 76, 76, 46, 23, 'none', False, 'rotate(-35 58 100)').replace('fill="none"', f'fill="none" stroke="{C}" stroke-width="16"')
    + R(104, 78, 76, 46, 23, 'none', False, 'rotate(-35 142 100)').replace('fill="none"', f'fill="none" stroke="{O}" stroke-width="28"')
    + R(104, 78, 76, 46, 23, 'none', False, 'rotate(-35 142 100)').replace('fill="none"', f'fill="none" stroke="{C}" stroke-width="16"')
    + L('M92 50L100 66M116 56L108 72', 7, A) + Lo('M84 136L92 150', 7, C))
add('floppy', R(36, 36, 128, 128, 12) + R(64, 36, 72, 46, 4, O, False) + R(108, 44, 18, 30, 3, C, False) + R(58, 104, 84, 60, 6, O, False) + R(66, 112, 68, 52, 4, C, False)
    + Lo('M76 128H124M76 146H112', 6) + R(140, 46, 12, 12, 2, A, False))
add('key', Ci(62, 100, 36) + Ci(62, 100, 14, O, False) + R(94, 90, 80, 20, 4) + R(140, 108, 14, 24, 3) + R(160, 108, 14, 30, 3) + Ci(62, 100, 6, A, False))
add('keyhole', Ci(100, 100, 68) + Ci(100, 84, 20, O, False) + P('M90 94H110L118 140H82Z', O, False) + P(sparkle_d(154, 46, 16), A))

# ================= 表演 =================
MASK = 'M40 52Q100 28 160 52Q166 122 100 170Q34 122 40 52Z'
add('mask', P(MASK) + P('M58 82Q72 68 88 82Q72 92 58 82Z', O, False) + P('M112 82Q128 68 142 82Q128 92 112 82Z', O, False)
    + P('M70 118Q100 146 130 118Q100 130 70 118Z', O, False) + Ci(136, 110, 7, A, False))
add('masks', G(P(MASK) + P('M58 80Q72 92 88 80', 'none', False, f' stroke="{O}" stroke-width="9" stroke-linecap="round"') + P('M112 80Q128 92 142 80', 'none', False, f' stroke="{O}" stroke-width="9" stroke-linecap="round"')
               + P('M70 116Q100 144 130 116Z', O, False), 'translate(-28 -14) scale(.78) rotate(-14 100 100)')
    + G(P(MASK) + P('M58 86Q72 74 88 86', 'none', False, f' stroke="{O}" stroke-width="9" stroke-linecap="round"') + P('M112 86Q128 74 142 86', 'none', False, f' stroke="{O}" stroke-width="9" stroke-linecap="round"')
        + P('M72 134Q100 108 128 134Z', O, False) + P('M134 96Q142 110 134 116Q126 110 134 96Z', A, False), 'translate(70 52) scale(.78) rotate(14 100 100) translate(-46 -38)'))
add('domino', P('M22 82Q62 60 100 82Q138 60 178 82Q178 130 140 130Q112 130 100 112Q88 130 60 130Q22 130 22 82Z')
    + E(64, 98, 18, 12, O, False) + E(136, 98, 18, 12, O, False) + P(poly_d(100, 70, 9, 4), A))
add('ghost', P('M48 164V90Q48 36 100 36Q152 36 152 90V164L134 148L117 164L100 148L83 164L66 148Z') + E(82, 92, 9, 13, O, False) + E(118, 92, 9, 13, O, False)
    + Lo('M30 60V80M170 110V130M24 120V132', 6, C) + E(100, 124, 10, 6, A, False))
add('heart_arrow', L('M28 168L84 112', 11) + H(104, 98, 58) + L('M122 80L160 42', 11) + P('M144 32L176 26L170 58Z', A))
add('book', P('M100 52Q70 34 28 44V156Q70 146 100 164Z') + P('M100 52Q130 34 172 44V156Q130 146 100 164Z') + Lo('M100 54V162', 7) + Lo('M44 72Q66 66 84 74M44 96Q66 90 84 98M116 74Q134 66 156 72M116 98Q134 90 156 96', 6)
    + P('M136 44H150V84L143 76L136 84Z', A, False))
add('sun', Ci(100, 100, 36) + ''.join(G(L('M100 28V46', 13), f'rotate({a} 100 100)') for a in range(0, 360, 45)) + Ci(100, 100, 12, A, False))
add('speech', P(BUBBLE) + Ci(66, 92, 10, O, False) + Ci(100, 92, 10, O, False) + Ci(134, 92, 10, A, False))
add('speech_heart', P(BUBBLE) + H(100, 92, 30, A, False))
add('bubbles', G(P(BUBBLE), 'translate(-20 -16) scale(.62)') + G(P(BUBBLE), 'translate(70 6) scale(.6)') + G(P(BUBBLE), 'translate(14 62) scale(.68)')
    + Ci(87, 120, 6, A, False) + Ci(68, 120, 6, O, False) + Ci(106, 120, 6, O, False))
add('heart_chain', H(100, 120, 54) + R(84, 24, 32, 42, 16, 'none', False).replace('fill="none"', f'fill="none" stroke="{O}" stroke-width="22"')
    + R(84, 24, 32, 42, 16, 'none', False).replace('fill="none"', f'fill="none" stroke="{C}" stroke-width="10"') + H(100, 120, 20, A, False))
add('id_card', R(26, 52, 148, 96, 14) + Ci(66, 92, 16, O, False) + P('M42 132Q42 112 66 112Q90 112 90 132Z', O, False) + Lo('M106 84H152M106 104H146M106 124H134', 8) + R(140, 60, 18, 14, 3, A, False))
add('honey', R(56, 42, 88, 24, 6) + R(48, 64, 104, 106, 26) + P('M48 86Q60 102 72 88Q84 112 98 90Q110 104 124 88Q136 100 152 86V96H48Z', O, False) + H(100, 132, 20, A, False))
add('star', P(star_d(100, 104, 72, 32)) + P(sparkle_d(154, 42, 14), A))
add('lips', P('M24 100Q58 56 86 74Q100 82 114 74Q142 56 176 100Q142 150 100 150Q58 150 24 100Z') + Lo('M34 100Q100 116 166 100', 9) + E(126, 128, 12, 6, A, False))
add('swap', P('M40 66H134V44L170 76L134 108V86H40Z') + P('M160 114H66V92L30 124L66 156V134H160Z') + R(48, 70, 18, 12, 4, A, False))
add('swirl', L('M104 100Q104 88 94 88Q80 88 80 104Q80 124 102 124Q130 124 130 98Q130 64 96 64Q56 64 56 104Q56 148 104 148Q148 148 166 110', 13) + H(154, 52, 18, A, False))
add('dizzy', L('M102 108Q102 98 94 98Q84 98 84 110Q84 126 102 126Q124 126 124 104Q124 78 98 78Q66 78 66 110Q66 146 102 146Q138 146 148 120', 11)
    + P(star_d(56, 52, 22, 9)) + P(star_d(146, 58, 18, 7), A))
add('needle', G(P('M94 34Q100 22 106 34V150L100 176L94 150Z') + E(100, 52, 3.5, 10, O, False), 'rotate(40 100 100)') + L('M120 46Q160 60 150 96Q140 130 96 128Q52 126 42 156', 7, A))
add('badge', P(star_d(100, 100, 72, 50, 6)) + Ci(100, 100, 34, O, False) + Ci(100, 100, 26) + P(star_d(100, 100, 14, 6), A, False))
add('rose', L('M100 104V172', 11) + P('M100 140Q126 118 148 128Q132 152 100 146Z') + P('M90 156L80 150L92 146Z', C) + Ci(100, 72, 40)
    + L('M100 74Q90 74 90 66Q90 56 102 56Q116 56 116 70Q116 88 98 90Q78 90 74 72', 7, O) + H(150, 46, 14, A, False))
add('heart_burst', ''.join(G(L('M100 18V34', 10), f'rotate({a} 100 104)') for a in range(0, 360, 45)) + H(100, 104, 52) + P(sparkle_d(116, 92, 12), A, False))
add('curtain', R(24, 28, 152, 22, 6) + P('M30 50H92Q84 110 98 170H30Z') + P('M170 50H108Q116 110 102 170H170Z') + Lo('M52 50Q50 110 56 170M148 50Q150 110 144 170', 6) + P(star_d(100, 112, 14, 6), A))
add('bow', P('M100 100Q60 50 30 66Q20 100 40 128Q70 128 100 100Z') + P('M100 100Q140 50 170 66Q180 100 160 128Q130 128 100 100Z')
    + P('M92 108L66 168L84 162L96 176L100 112Z') + P('M108 108L134 168L116 162L104 176L100 112Z') + R(86, 86, 28, 30, 10, A))
add('cards', ''.join(G(R(70, 34, 62, 92, 10) + P(poly_d(101, 80, 16, 4), A if a == 18 else O, False), f'rotate({a} 100 160)') for a in (-18, 0, 18)))
add('hearts_three', H(66, 120, 32) + H(134, 120, 32) + H(100, 72, 34, A))
add('hearts_touch', H(78, 104, 44) + G(H(124, 98, 44), 'rotate(14 124 98)') + P(sparkle_d(150, 40, 12), A))
add('hearts_two', G(H(62, 100, 38), 'rotate(-12 62 100)') + G(H(138, 100, 38), 'rotate(12 138 100)') + L('M86 132Q100 146 114 132', 8, A))
add('heart_lock', L('M78 76V58Q78 36 100 36Q122 36 122 58V76', 13) + H(100, 112, 64) + Ci(100, 106, 10, O, False) + P('M95 108H105L108 132H92Z', O, False))
add('heart_keyhole', H(100, 104, 68) + Ci(100, 94, 14, O, False) + P('M93 100H107L112 136H88Z', O, False) + P(sparkle_d(160, 40, 14), A))

# ================= 社交與門路 =================
add('handshake', P('M24 76L56 64L88 80L116 68L176 92V132L136 146L106 158Q92 164 80 152L56 130H24Z') + Lo('M92 128L112 110M104 140L124 122M118 148L136 132', 8)
    + Lo('M56 64V130M146 80V140', 8) + H(100, 46, 14, A))
add('converge', ''.join(G(P('M100 74L80 34H120Z'), f'rotate({a} 100 100)') for a in (45, 135, 225, 315)) + Ci(100, 100, 14, A))
add('warning', P('M100 28L174 160H26Z') + R(91, 72, 18, 52, 9, O, False) + Ci(100, 142, 10, A, False))
add('map', P('M28 50L74 36L126 56L172 42V150L126 164L74 144L28 158Z') + Lo('M74 36V144M126 56V164', 7) + Lo('M44 128Q70 96 98 112Q126 128 146 84', 6) + P('M138 66L154 82M154 66L138 82', 'none', False, f' stroke="{A}" stroke-width="7" stroke-linecap="round"'))
add('ticket', P('M28 62H172V86Q158 86 158 100Q158 114 172 114V138H28V114Q42 114 42 100Q42 86 28 86Z') + Lo('M124 66V78M124 94V106M124 122V134', 7) + P(star_d(80, 100, 20, 9), A, False))
add('white_flag', L('M54 172V30', 12) + P('M54 36Q86 22 112 38Q140 54 166 40V110Q140 124 112 108Q86 92 54 106Z') + Ci(54, 28, 9, A))
add('pennant', L('M48 172V30', 12) + P('M48 38L168 76L48 114Z') + H(86, 76, 16, A, False))
add('newspaper', R(30, 40, 140, 120, 10) + R(46, 56, 108, 20, 4, O, False) + R(46, 88, 44, 52, 4, O, False) + Lo('M104 92H154M104 112H154M104 132H140', 7) + R(52, 94, 14, 10, 3, A, False))
add('coins', ''.join(E(80, y, 46, 16) for y in (148, 126, 104)) + E(80, 104, 30, 8, O, False) + Ci(138, 70, 32) + Ci(138, 70, 18, A, False))
add('briefcase', L('M76 66V48H124V66', 12) + R(28, 64, 144, 100, 14) + Lo('M28 104H172', 8) + R(88, 94, 24, 22, 5, A))
add('money_bag', P('M78 54Q62 40 72 30H128Q138 40 122 54Q170 86 166 132Q162 172 100 172Q38 172 34 132Q30 86 78 54Z') + R(74, 50, 52, 12, 6, O, False) + Ci(100, 120, 24, O, False) + Ci(100, 120, 14, A, False))
add('spider_web', ''.join(Lo(f'M100 100L{f(100 + 72 * math.cos(math.radians(a)))} {f(100 + 72 * math.sin(math.radians(a)))}', 16, O) for a in range(-90, 270, 45))
    + ''.join(Lo(f'M100 100L{f(100 + 72 * math.cos(math.radians(a)))} {f(100 + 72 * math.sin(math.radians(a)))}', 7, C) for a in range(-90, 270, 45))
    + ''.join(L(poly_d(100, 100, r, 8, -90), 6) for r in (30, 56)) + Ci(100, 100, 11, A))
add('phone', R(60, 28, 80, 144, 16) + R(70, 46, 60, 100, 6, O, False) + Ci(100, 158, 6, O, False) + L('M154 72Q168 86 154 100M30 84Q20 100 30 116', 9) + H(100, 96, 18, A, False))
add('parachute', P('M28 92Q28 34 100 34Q172 34 172 92Q154 82 136 92Q118 82 100 92Q82 82 64 92Q46 82 28 92Z') + Lo('M30 92L88 140M170 92L112 140M100 92V140', 7, C) + R(80, 134, 40, 36, 6) + R(80, 146, 40, 8, 0, A, False))
add('chess', P('M54 170H146V150Q146 136 132 132Q126 106 134 86Q138 60 114 44L100 28L94 46Q70 52 58 80L50 100Q48 112 60 114L82 104Q88 120 72 130Q54 136 54 150Z') + Ci(90, 72, 7, O, False) + R(54, 152, 92, 8, 0, A, False))
add('globe', Ci(100, 100, 66) + E(100, 100, 28, 66, 'none', False).replace('fill="none"', f'fill="none" stroke="{O}" stroke-width="7"') + Lo('M34 100H166M100 34V166M44 66H156M44 134H156', 7) + P(sparkle_d(160, 40, 14), A))
add('dove', P('M26 110Q62 142 118 128Q148 118 156 96L178 88L158 80Q146 68 132 76Q118 84 112 100Q84 106 58 98Z') + P('M64 102Q68 46 122 30Q108 70 114 100Z') + Ci(144, 86, 5, O, False) + P('M174 92Q186 104 178 118Q168 108 174 92Z', A))
add('umbrella', P('M26 104Q26 38 100 38Q174 38 174 104Q156 94 137 104Q118 94 100 104Q82 94 63 104Q44 94 26 104Z') + L('M100 104V154Q100 170 84 170Q70 170 70 156', 11) + Ci(100, 30, 8, A))
add('city', ''.join(R(x, y, w, 170 - y, 4) for x, y, w in ((26, 92, 36), (60, 50, 40), (98, 76, 38), (134, 108, 40)))
    + ''.join(R(x, y, 9, 9, 2, O, False) for x, y in ((70, 66), (84, 66), (70, 86), (84, 86), (70, 106), (108, 92), (120, 92), (108, 112), (36, 108), (46, 108), (144, 124), (158, 124)))
    + L('M80 50V30', 7) + Ci(80, 28, 7, A))
add('megaphone', P('M34 80H64L144 44V156L64 120H34Z') + R(64, 118, 22, 42, 6) + R(26, 78, 18, 44, 6) + L('M160 74L176 66M164 100H182M160 126L176 134', 9) + Ci(48, 100, 7, A, False))
add('network', L('M100 100L44 52M100 100L156 48M100 100L160 140M100 100L44 148', 9) + ''.join(Ci(x, y, 18) for x, y in ((44, 52), (156, 48), (160, 140), (44, 148))) + Ci(100, 100, 24, A))

# ================= 媒體 =================
add('spotlight', P('M40 166L102 92L144 140Z', C, False, ' opacity=".35"') + G(R(44, 36, 64, 48, 10) + R(104, 32, 20, 56, 6) + R(30, 48, 18, 24, 4), 'rotate(42 84 60)')
    + E(124, 160, 46, 14) + P(sparkle_d(160, 50, 14), A))
add('camera', R(28, 62, 144, 98, 16) + R(64, 44, 48, 26, 8) + Ci(100, 112, 34, O, False) + Ci(100, 112, 22, C, False) + Ci(150, 82, 8, A, False))
add('camera_flash', R(28, 74, 120, 88, 14) + R(48, 58, 40, 22, 6) + Ci(88, 118, 30, O, False) + Ci(88, 118, 18, C, False) + P(star_d(150, 54, 30, 12, 8)) + Ci(150, 54, 7, A, False))
add('live', Ci(100, 100, 30, A) + L('M56 56A62 62 0 0 0 56 144M144 56A62 62 0 0 1 144 144', 13))
add('scissors', G(ring(70, 146, 20, 11) + ring(130, 146, 20, 11) + P('M84 128L132 30Q138 40 136 54L98 136Z') + P('M116 128L68 30Q62 40 64 54L102 136Z') + Ci(100, 112, 7, A, False), 'rotate(-20 100 100)'))
add('play', R(28, 44, 144, 112, 22) + P('M84 72L132 100L84 128Z', O, False) + Ci(150, 62, 7, A, False))
add('funnel', P('M28 40H172L116 104V160L84 176V104Z') + P('M58 58H142L118 84H82Z', O, False) + P('M100 60Q112 74 100 82Q88 74 100 60Z', A, False))
add('microphone', R(74, 26, 52, 84, 26) + Lo('M78 56H122M78 76H122', 6) + L('M54 88Q54 136 100 136Q146 136 146 88', 11) + L('M100 136V164M74 168H126', 11) + R(92, 92, 16, 10, 4, A, False))
add('rosette', P('M72 118L52 172L76 160L90 180L102 130Z') + P('M128 118L148 172L124 160L110 180L98 130Z') + P(star_d(100, 84, 58, 46, 16)) + Ci(100, 84, 38, O, False) + Ci(100, 84, 32) + P(star_d(100, 86, 18, 8), A, False))
add('bomb', Ci(90, 114, 56) + R(112, 50, 34, 22, 6, C, True, 'rotate(40 129 61)') + L('M140 46Q150 30 166 32', 8) + P(star_d(168, 30, 14, 6, 6), A) + Lo('M60 96Q66 80 80 76', 9, O))
add('drum', L('M44 30L96 72M156 30L104 72', 10) + P('M36 84V146Q36 170 100 170Q164 170 164 146V84Z') + E(100, 84, 64, 20) + Lo('M36 110L68 150L100 110L132 150L164 110', 7) + Ci(44, 30, 8, A))
add('eyes', ''.join(G(P(EYE) + Ci(100, 100, 30, O, False) + Ci(110, 90, 10, A if (x, y) == (100, 56) else C, False), f'translate({x - 100} {y - 100}) scale(.5) translate({100 - 100} 0)') for x, y in ()))
SUBJECTS.pop('eyes')
add('eyes', ''.join(G(P(EYE) + Ci(100, 100, 32, O, False) + Ci(112, 88, 12, A if k == 0 else C, False), f'translate({x} {y}) scale(.56)') for k, (x, y) in enumerate(((44, 18), (2, 86), (86, 86)))))
add('stamp', Ci(100, 44, 20) + R(88, 60, 24, 36, 4) + R(48, 92, 104, 36, 10) + R(40, 124, 120, 18, 6) + R(52, 156, 96, 12, 6, A, False))
add('tv', L('M74 30L100 54L126 30', 9) + R(26, 54, 148, 112, 16) + R(42, 70, 98, 80, 8, O, False) + Ci(158, 86, 7, A, False) + Ci(158, 112, 7, O, False) + P(sparkle_d(92, 110, 16), C, False))
add('chart_up', R(36, 120, 30, 46, 5) + R(85, 92, 30, 74, 5) + R(134, 62, 30, 104, 5) + L('M36 96L84 62L108 78L150 38', 10) + P('M132 30L166 26L160 58Z', A))
add('tuning_fork', L('M70 30V96Q70 126 100 126Q130 126 130 96V30M100 126V172', 15) + L('M38 46Q28 66 38 86M162 46Q172 66 162 86', 8) + Ci(100, 172, 9, A))
add('satellite', R(74, 72, 52, 56, 10) + R(22, 82, 46, 36, 4) + R(132, 82, 46, 36, 4) + Lo('M45 82V118M155 82V118', 6) + Ci(100, 100, 10, A, False) + L('M100 128V150', 10) + P('M70 150H130L120 170H80Z') + L('M80 40Q100 26 120 40M66 26Q100 2 134 26', 9))
add('trophy', L('M54 50Q24 50 30 78Q36 98 64 100M146 50Q176 50 170 78Q164 98 136 100', 10) + P('M50 32H150V68Q150 118 100 124Q50 118 50 68Z') + R(90, 120, 20, 22) + R(62, 140, 76, 28, 6) + P(star_d(100, 72, 22, 9), A, False))
add('power', L('M66 66A50 50 0 1 0 134 66', 17) + L('M100 34V96', 17) + P(sparkle_d(156, 156, 14), A))

# ================= 偶像 =================
add('lightstick', G(R(88, 106, 24, 70, 8) + R(88, 116, 24, 10, 0, O, False) + H(100, 70, 42) + H(100, 70, 18, A, False), 'rotate(18 100 100)') + L('M40 52L28 42M44 86H28M152 30L160 18', 8))
add('notes', E(60, 146, 22, 16, C, True, 'rotate(-20 60 146)') + E(140, 128, 22, 16, C, True, 'rotate(-20 140 128)') + R(70, 46, 12, 98) + R(150, 30, 12, 98) + P('M70 46L162 30V56L70 72Z') + E(140, 128, 8, 5, A, False))
add('note_bubble', P(BUBBLE) + E(86, 112, 13, 10, O, False) + R(92, 66, 9, 46, 0, O, False) + P('M92 66Q118 70 122 92Q110 80 100 82Z', O, False) + P(sparkle_d(134, 74, 10), A, False))
add('heart_note', H(100, 102, 68) + E(86, 126, 14, 11, O, False) + R(93, 68, 9, 58, 0, O, False) + P('M93 68Q122 72 126 98Q112 84 100 86Z', O, False) + Ci(68, 82, 7, A, False))
add('moon', P('M118 30A72 72 0 1 0 170 128A56 56 0 1 1 118 30Z') + P(star_d(150, 54, 16, 7), A))
add('cushion', P('M36 40Q100 54 164 40Q150 100 164 160Q100 146 36 160Q50 100 36 40Z') + Lo('M64 64L86 86M136 64L114 86M64 136L86 114M136 136L114 114', 6) + Ci(100, 100, 11, A))
add('crown', P('M30 150V66L66 100L100 44L134 100L170 66V150Z') + R(30, 132, 140, 22, 4) + Ci(100, 100, 10, A, False) + Ci(66, 143, 5, O, False) + Ci(134, 143, 5, O, False))
add('fireworks', ''.join(G(L('M100 64V36', 10) + Ci(100, 26, 6, C, False), f'rotate({a} 100 96)') for a in range(0, 360, 45)) + Ci(100, 96, 14, A) + P(sparkle_d(156, 156, 16)) + P(sparkle_d(40, 156, 12)))
add('vinyl', Ci(100, 100, 68) + f'<circle cx="100" cy="100" r="50" fill="none" stroke="{O}" stroke-width="5"/><circle cx="100" cy="100" r="38" fill="none" stroke="{O}" stroke-width="5"/>' + Ci(100, 100, 20, A, False) + Ci(100, 100, 5, O, False))
add('dome_stage', '')
SUBJECTS.pop('dome_stage')
add('stage', P('M24 128H176L166 168H34Z') + R(24, 30, 152, 20, 6) + P('M30 50H80Q72 90 84 128H30Z') + P('M170 50H120Q128 90 116 128H170Z') + P(star_d(100, 92, 22, 9), A))

# ================= 夜課（抽象） =================
add('feather', P('M156 30Q170 92 118 138Q90 162 62 156Q58 128 82 96Q110 54 156 30Z') + Lo('M150 40Q108 100 44 172', 8) + Lo('M120 76L104 72M104 102L86 98M90 126L74 122', 6) + P(sparkle_d(60, 60, 14), A))
add('swap_heart', H(100, 102, 40) + L('M44 86A60 60 0 0 1 140 52', 11) + P('M130 34L164 48L136 74Z') + L('M156 118A60 60 0 0 1 60 152', 11) + P('M70 170L36 156L64 130Z', A))
add('breath', L('M30 74H112Q136 74 136 54Q136 38 120 38M30 104H150Q170 104 170 124Q170 142 152 142M30 134H100', 12) + H(80, 158, 16, A, False))
add('rings', ring(74, 104, 38, 13) + ring(126, 104, 38, 13) + f'<path d="M106 82A38 38 0 0 1 112 70" fill="none" stroke="{C}" stroke-width="13"/>'
    + P(poly_d(126, 58, 12, 4), A))
add('heart_give', H(100, 76, 40) + P('M24 116Q40 108 60 118Q72 124 92 124H122Q134 124 134 134Q134 144 122 144H96L134 146Q156 140 176 120V164H24Z') + P(sparkle_d(150, 42, 12), A))
add('hourglass_heart', R(48, 28, 104, 16, 6) + R(48, 156, 104, 16, 6) + P('M60 44H140V58Q140 84 110 100Q140 116 140 142V156H60V142Q60 116 90 100Q60 84 60 58Z')
    + H(100, 138, 18, A, False) + P('M80 60H120Q110 80 100 84Q90 80 80 60Z', O, False))
add('heart_ring', ring(100, 100, 50, 10) + ''.join(H(100 + 54 * math.cos(math.radians(a)), 100 + 54 * math.sin(math.radians(a)), 22, A if a == -90 else C) for a in (-90, 0, 90, 180)))
add('halo', E(100, 70, 58, 20, 'none', False).replace('fill="none"', f'fill="none" stroke="{O}" stroke-width="26"') + E(100, 70, 58, 20, 'none', False).replace('fill="none"', f'fill="none" stroke="{C}" stroke-width="14"')
    + P(sparkle_d(70, 134, 26)) + P(sparkle_d(130, 140, 18), A) + P(sparkle_d(108, 112, 10)))
add('sparkles', P(sparkle_d(84, 108, 52)) + P(sparkle_d(146, 56, 24), A) + P(sparkle_d(150, 148, 16)))
add('armchair', P('M46 46Q46 30 62 30H138Q154 30 154 46V112H46Z') + R(24, 82, 34, 76, 14) + R(142, 82, 34, 76, 14) + R(50, 108, 100, 36, 10) + L('M42 158V172M158 158V172', 10) + H(100, 72, 20, A, False))
add('collar', E(100, 76, 60, 24, 'none', False).replace('fill="none"', f'fill="none" stroke="{O}" stroke-width="30"') + E(100, 76, 60, 24, 'none', False).replace('fill="none"', f'fill="none" stroke="{C}" stroke-width="18"')
    + ring(100, 114, 14, 8) + L('M100 128Q104 160 140 160Q170 160 170 136', 8) + Ci(100, 100, 7, A, False))
add('gift', R(36, 82, 128, 86, 8) + R(28, 64, 144, 28, 8) + R(90, 64, 20, 104, 0, O, False) + R(94, 64, 12, 104, 0, A, False)
    + P('M100 62Q70 28 56 42Q48 58 100 62Z') + P('M100 62Q130 28 144 42Q152 58 100 62Z'))
add('chain', ''.join(R(x - 30, 100 - 18, 60, 36, 18, 'none', False, f'rotate(-40 {x} {200 - x})').replace('fill="none"', f'fill="none" stroke="{O}" stroke-width="26"').replace('y="82"', f'y="{200 - x - 18}"')
                     + R(x - 30, 100 - 18, 60, 36, 18, 'none', False, f'rotate(-40 {x} {200 - x})').replace('fill="none"', f'fill="none" stroke="{A if x == 100 else C}" stroke-width="14"').replace('y="82"', f'y="{200 - x - 18}"')
                     for x in (56, 100, 144)))
add('sound_heart', H(80, 104, 48) + L('M136 76Q150 100 136 124M156 56Q182 100 156 144', 10) + P(sparkle_d(80, 98, 12), A, False))
add('cherry', L('M66 120Q70 70 120 40M134 128Q126 80 120 40', 8) + P('M120 40Q146 22 166 40Q144 56 120 40Z') + Ci(62, 134, 30) + Ci(136, 140, 30) + E(52, 124, 7, 5, A, False) + E(126, 130, 7, 5, C, False).replace(C, O))
add('yin_yang', Ci(100, 100, 66) + P('M100 34A66 66 0 0 1 100 166A33 33 0 0 1 100 100A33 33 0 0 0 100 34Z', O, False) + H(100, 67, 13, O, False) + H(100, 135, 13, A, False))
add('tentacle', L('M60 172Q40 120 80 96Q126 68 120 46Q114 26 92 34Q80 40 86 54', 26) + ''.join(Ci(x, y, 5, O, False) for x, y in ((60, 150), (66, 122), (90, 100), (114, 80))) + H(150, 140, 18, A, False))
add('perfume', R(84, 30, 32, 20, 6) + R(92, 46, 16, 16, 0) + R(48, 62, 104, 108, 26) + H(100, 118, 26, A, False) + L('M118 38H140', 8) + Ci(152, 30, 5) + Ci(166, 44, 4) + Ci(166, 22, 4))
add('wall_heart', R(28, 34, 144, 132, 8) + Lo('M28 78H172M28 122H172M76 34V78M124 34V78M52 78V122M100 78V122M148 78V122M76 122V166M124 122V166', 6) + H(100, 104, 34, A))
add('glasses', ring(62, 108, 30, 12) + ring(138, 108, 30, 12) + L('M92 104Q100 96 108 104M32 100L24 76M168 100L176 76', 10) + P(sparkle_d(150, 48, 14), A))
add('hug_heart', H(100, 104, 44) + L('M48 54Q16 104 52 156M152 54Q184 104 148 156', 13) + P(sparkle_d(100, 96, 10), A, False))
add('paw', P('M100 96Q136 96 148 132Q154 160 126 160Q112 160 100 152Q88 160 74 160Q46 160 52 132Q64 96 100 96Z') + Ci(52, 84, 17) + Ci(82, 56, 18) + Ci(118, 56, 18) + Ci(148, 84, 17) + H(100, 132, 14, A, False))
add('vibrate', R(66, 34, 68, 132, 14) + R(76, 50, 48, 92, 5, O, False) + H(100, 96, 18, A, False) + L('M44 64L30 78L44 92L30 106L44 120L30 134M156 64L170 78L156 92L170 106L156 120L170 134', 7))
add('plus_star', P('M88 30H112V88H170V112H112V170H88V112H30V88H88Z') + P(sparkle_d(154, 46, 18), A))
add('windup_key', E(66, 50, 30, 20, C, True, 'rotate(-30 66 50)') + E(134, 50, 30, 20, C, True, 'rotate(30 134 50)') + E(66, 50, 12, 6, O, False, 'rotate(-30 66 50)') + E(134, 50, 12, 6, O, False, 'rotate(30 134 50)')
    + R(90, 54, 20, 70) + R(64, 120, 72, 22, 8) + H(100, 160, 18, A))
add('heart_balloon', L('M100 132Q86 150 100 162Q114 174 100 184', 7) + H(100, 82, 60) + P('M94 132L100 142L106 132Z') + Lo('M66 64Q72 48 88 46', 8, O) + P(sparkle_d(160, 140, 14), A))
add('target_heart', ring(100, 100, 58, 12) + ring(100, 100, 32, 10) + H(100, 102, 18, A))
add('rainbow', L('M26 150A74 74 0 0 1 174 150', 14) + L('M50 150A50 50 0 0 1 150 150', 14, A) + L('M74 150A26 26 0 0 1 126 150', 14))
add('hanger', L('M100 64V52Q100 34 116 34Q130 34 130 48', 10) + L('M100 64L28 128Q22 140 36 140H164Q178 140 172 128Z', 12) + H(100, 112, 18, A, False))
add('bell', R(90, 24, 20, 16, 6) + P('M100 36Q148 36 148 92V128L166 148H34L52 128V92Q52 36 100 36Z') + Ci(100, 158, 14, A) + P('M76 64Q82 52 96 50', 'none', False, f' stroke="{O}" stroke-width="7" stroke-linecap="round"'))
add('thermometer', R(84, 26, 32, 110, 16) + Ci(100, 146, 26) + R(94, 70, 12, 70, 6, A, False) + Ci(100, 146, 14, A, False) + Lo('M116 50H128M116 74H128M116 98H128', 7, C))
add('heart_no', H(100, 108, 46) + ring(100, 100, 66, 11) + L('M54 54L146 146', 11))
add('glass', P(CUP) + P('M50 40H150Q148 70 100 84Q52 70 50 40Z', O, False) + P('M58 44H142Q140 64 100 74Q60 64 58 44Z', C, False).replace(C, C) + Ci(84, 54, 5, A, False) + Ci(106, 60, 4, O, False) + P(sparkle_d(160, 36, 12), A))
add('whistle', Ci(84, 116, 52) + R(84, 64, 92, 40, 10) + Ci(84, 116, 20, O, False) + Ci(84, 116, 8, A, False) + R(150, 64, 10, 40, 0, O, False) + L('M30 64Q34 40 56 40', 9))
add('wand', L('M44 164L112 96', 12) + P(star_d(128, 78, 42, 18)) + Ci(128, 78, 8, A, False) + P(sparkle_d(48, 64, 14)) + P(sparkle_d(166, 150, 12)))
add('necktie', P('M78 30H122L114 58H86Z') + P('M86 58H114L136 140L100 176L64 140Z') + Lo('M80 92L120 76M74 120L126 100M72 148L130 124', 7) + Ci(100, 44, 6, A, False))
add('fan', P('M100 160L26 88A104 104 0 0 1 174 88Z') + ''.join(Lo(f'M100 160L{f(100 + 104 * math.cos(math.radians(a)))} {f(160 + 104 * math.sin(math.radians(a)))}', 5) for a in (-120, -105, -90, -75, -60))
    + P('M100 160L52 106A64 64 0 0 1 148 106Z', O, False) + Ci(100, 160, 10, A))
add('sword', G(P('M92 136V36L100 20L108 36V136Z') + R(64, 132, 72, 14, 6) + R(93, 146, 14, 26, 4) + Ci(100, 176, 8, A), 'rotate(35 100 100)'))
add('headphones', L('M40 120V96Q40 40 100 40Q160 40 160 96V120', 12) + P('M58 44L60 20L80 36Z') + P('M142 44L140 20L120 36Z') + R(26, 104, 38, 62, 14) + R(136, 104, 38, 62, 14) + H(155, 135, 12, A, False))

# ================= 技能 → 符號 =================
SKILL_SUBJECT = {
    # 槍手
    '戰鬥直覺': 'crosshair', '要害射擊': 'bullseye', '掩護射擊': 'shield_aim', '點放': 'bullet_pair', '看我的！': 'muzzle', '連射控制': 'bullet_stream',
    '定點射': 'scope', '壓制姿態': 'press_down', '構裝精通': 'swap', '就是你了': 'mark_pin', '走開啦': 'push', '幫槍槍保養': 'sparkles',
    '穿透': 'pierce', '跑位射擊': 'dash', '死線': 'ecg', '獵眼': 'eye_aim', '掩護撤退': 'back_arrow', '獵殺節奏': 'metronome',
    '彈幕': 'barrage', '心流': 'flow', '下一個！': 'ricochet', '不准動喔': 'tile_target', '一槍定局': 'bullet', '火力牆': 'firewall',
    '子彈時間': 'stopwatch', '人槍合一': 'pistol', '還給你～': 'boomerang',
    # 機師
    '編隊': 'drone', '乖孩子去吧': 'plane', '掩護飛行': 'shield', '多工連結': 'link', '再一次嘛': 'repeat', '去陪陪他': 'map_pin',
    '雙聯火控': 'twin_barrel', '護航編隊': 'formation', '回灌緩衝': 'spring', '修修就好': 'wrench', '撞過去！': 'fist', '突擊姿態': 'chevrons',
    '堡壘姿態': 'tower', '同步衝刺': 'rocket', '飽和攻擊': 'missiles', '煙煙罩著你': 'cloud', '神經硬化': 'brain', '遠端火力': 'radar',
    '攔截': 'shield', '共鳴駕駛': 'sync', '精準導引': 'guided', '整備': 'toolbox', '蜂群': 'hive', '穹頂': 'dome', '女武神': 'wings',
    '敢打我家孩子？': 'anger', '人機一體': 'robot',
    # 改造師
    '手術刀': 'scalpel', '戰場急救': 'medkit', '拆解': 'screwdriver', '呼呼不燙了': 'wind', '縫合手': 'stitches', '不痛不痛': 'syringe',
    '手術': 'lamp', '超頻': 'gauge', '拉回來': 'heart_bolt', '找縫': 'crack', '拆拆好好玩': 'nut', '巡房': 'clipboard', '卸下': 'plug',
    '排好隊喔': 'drops', '急凍': 'snowflake', '解剖': 'magnifier', '解鎖匠': 'unlock', '短路': 'spark', '戰地手術': 'bandage',
    '還不准睡': 'alarm', '主刀': 'scalpel', '工坊': 'gear', '拆光': 'explode', '全面翻修': 'heart_plus', '極限超頻': 'bolt', '名醫': 'medal',
    '手手拿開': 'hand',
    # 潛網者
    '主控': 'terminal', '破冰': 'broken_ice', '偷看是不行的喔': 'eye_no', '接管': 'cursor', '迴圈': 'loop', '我不在家喔': 'eraser',
    '頻寬': 'wifi', '過熱': 'flame', '靜默': 'mute', '改寫地形': 'blocks', '盯～': 'eye', '逆流': 'surge', '灌頂': 'download',
    '後門': 'backdoor', '封鎖': 'lock', '謝謝招待': 'battery', '值機': 'server', '傀儡': 'puppet', '看錯人囉': 'mirror', '多工': 'windows',
    '群播': 'broadcast', '不讓你帶走': 'chain_break', '黑冰': 'black_ice', '備份': 'floppy', '管理員': 'key', '根權限': 'keyhole', '深潛': 'dive',
    # 藝人
    '入戲': 'mask', '看這邊♡': 'heart_arrow', '替身': 'ghost', '讀人': 'book', '戳戳你': 'heart_bolt', '我很清醒喔': 'sun', '跟我說嘛': 'speech',
    '不要走嘛': 'heart_chain', '偽裝': 'domino', '假身分': 'id_card', '蜜罐': 'honey', '我演得很像吧': 'star', '媚態': 'lips', '換臉': 'swap',
    '說服蕾絲': 'speech_heart', '銷魂': 'swirl', '第二張臉': 'masks', '暈乎乎': 'dizzy', '入骨': 'needle', '頂替': 'badge',
    '欺負人家要賠喔': 'rose', '千面': 'cards', '傾城': 'heart_burst', '謝幕': 'curtain', '眾生相': 'bubbles', '繞指柔': 'bow', '這才是真的我': 'mirror',
    # 掮客
    '人面': 'handshake', '集火': 'converge', '小心後面！': 'warning', '戰前佈置': 'map', '換個位子嘛': 'swap', '有我在': 'shield_heart',
    '代理': 'ticket', '勸降': 'white_flag', '擋': 'shield', '買版面': 'newspaper', '再加一點嘛': 'coins', '黑市門路': 'briefcase',
    '收買': 'money_bag', '保釋': 'scissors', '情報網': 'spider_web', '打他打他！': 'fist', '派工網': 'phone', '增援': 'parachute',
    '布陣': 'chess', '大局': 'globe', '我有認識的人': 'id_card', '有話好好說': 'dove', '總攻令': 'pennant', '護盤': 'umbrella',
    '全城欠我': 'city', '號令': 'megaphone', '人脈': 'network',
    # 主播
    '聚光燈': 'spotlight', '曝光': 'camera_flash', '我查查看': 'magnifier', '現場連線': 'live', '剪剪貼貼': 'scissors', '留一手': 'cards',
    '開台囉～': 'play', '灌流': 'funnel', '主持': 'microphone', '洗版': 'bubbles', '獨家': 'rosette', '老粉都在': 'bell', '爆料王': 'bomb',
    '帶節奏': 'drum', '圍觀': 'eyes', '追擊': 'chevrons', '假料工坊': 'stamp', '頭條': 'newspaper', '反彈反彈': 'boomerang',
    '插播一下喔': 'tv', '流量密碼': 'chart_up', '直擊': 'camera', '號外': 'megaphone', '定調': 'tuning_fork', '全網聯播': 'satellite',
    '今天也第一名': 'trophy', '還不能下播': 'power',
    # 偶像
    '應援': 'lightstick', '進行曲': 'metronome', '表態': 'hand', '聲援': 'hearts_three', '搖籃曲': 'moon', '我還可以！': 'battery',
    '握握手': 'handshake', '安可': 'repeat', '動員': 'pennant', '聽我唱～': 'note_bubble', '安撫': 'dove', '大家都在喔': 'network',
    '合唱': 'notes', '一句話': 'speech', '召集': 'broadcast', '公演': 'stage', '唱出來': 'vinyl', '絕唱': 'flame', '我來擋！': 'shield',
    '巨蛋': 'dome', '休息一下下': 'cushion', 'C 位是我的': 'crown', '畢業公演': 'fireworks', '為你而唱': 'heart_note', '全員同步': 'sync',
    '傳說': 'star', '大家不要走': 'heart_chain',
    # 夜課・共通
    '慢慢摸': 'feather', '偷偷看你': 'eye_heart', '跪姿': 'cushion', '騎乘': 'moon', '換我在上面': 'swap_heart', '讓我喘一下': 'breath',
    '說悄悄話（延伸）': 'speech_heart', '交纏': 'rings', '交給你嘛': 'heart_give', '再一下下': 'hourglass_heart', '夾在中間': 'hearts_three',
    '摸摸頭（延伸）': 'halo', '四人圈': 'heart_ring', '一起去': 'heart_burst',
    # 夜課・關係
    '膝上': 'armchair', '貼貼': 'hearts_touch', '我來教你': 'glasses', '你說哪裡就哪裡': 'map_pin', '綁縛': 'bow', '牽著走（延伸）': 'collar',
    '這次算我的': 'gift', '留個手印': 'hand_heart', '一手一個': 'hearts_two', '落款': 'stamp', '不准停': 'chain', '借過一下': 'heart_keyhole',
    '咬牙忍住（延伸）': 'heart_lock', '咬耳朵': 'sound_heart', '再一口': 'cherry', '互含': 'yin_yang', '有人在看': 'eye',
    '對著鏡頭笑（延伸）': 'camera', '好多手': 'tentacle', '噴一點點': 'perfume', '靠牆': 'wall_heart', '照那本來演': 'book',
    '整夜開麥（延伸）': 'microphone', '全場都看過來': 'spotlight', '讓我看看你': 'mirror', '抱緊緊': 'hug_heart', '蹭蹭': 'paw',
    '冰冰的手': 'snowflake', '開震動（延伸）': 'vibrate', '多長一個': 'plus_star', '乖乖不動': 'windup_key', '兩邊都要': 'hearts_two',
    '抱起來': 'heart_balloon', '只看這裡（延伸）': 'target_heart', '都可以': 'rainbow', '看我穿這樣': 'hanger', '歡迎回來主人': 'bell',
    '量量看': 'thermometer', '不可以喔': 'heart_no', '拍拍乾淨': 'sparkles', '今晚的客人（延伸）': 'glass', '立正': 'whistle', '變身': 'wand',
    '揪領子': 'necktie', '開衩伸腿': 'fan', '換成你喜歡的': 'masks', '親一口收下': 'lips', '要看好喔（延伸）': 'lightstick',
    '我不會認輸的': 'sword', '用這個聲音叫你': 'headphones',
}
