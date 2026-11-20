"""第 3 層圖標主體：零件、義體、藥物與消耗品。座標 200×200，顏色只用 CSS 變數。"""
import math

S = 'class="s"'  # 帶縫的輪廓


def _gear(cx, cy, R, r, n, phase=0.0):
    """齒輪外形的 path d。"""
    pts = []
    step = 2 * math.pi / n
    for i in range(n):
        a = phase + i * step
        for da, rad in ((-0.32, r), (-0.17, R), (0.17, R), (0.32, r)):
            t = a + da * step
            pts.append(f'{cx + rad * math.cos(t):.1f} {cy + rad * math.sin(t):.1f}')
    return 'M' + 'L'.join(pts) + 'Z'


def _hex(cx, cy, r):
    pts = [f'{cx + r * math.cos(math.pi / 6 + k * math.pi / 3):.1f} {cy + r * math.sin(math.pi / 6 + k * math.pi / 3):.1f}' for k in range(6)]
    return 'M' + 'L'.join(pts) + 'Z'


SUBJECTS = {}

# ---------- 外皮 ----------
hexes = ''.join(f'<path fill="none" stroke="var(--b)" stroke-width="5" stroke-linejoin="round" d="{_hex(x, y, 14)}"/>'
                for x, y in ((62, 70), (86, 70), (110, 70), (134, 70), (74, 92), (98, 92), (122, 92), (62, 114), (86, 114), (110, 114), (74, 136)))
SUBJECTS['a synthetic skin swatch'] = (
    f'<path {S} fill="var(--c)" d="M40 44H160Q164 44 164 48V120L120 164H44Q40 164 40 160V48Q40 44 44 44Z"/>'
    + hexes
    + f'<path fill="var(--a)" d="{_hex(98, 92, 9)}"/>'
    + f'<path {S} fill="var(--b)" d="M164 120Q126 118 120 164Q132 132 164 120Z"/>'
    + f'<path {S} fill="var(--b)" d="M164 120L120 164Q118 128 164 120Z"/>'
    + '<path fill="none" stroke="var(--c)" stroke-width="4" stroke-linecap="round" d="M150 132Q134 138 130 152"/>'
)
SUBJECTS['a skin swatch'] = (
    f'<path {S} fill="var(--c)" d="M46 50Q72 34 100 46Q128 34 154 50Q168 76 156 100Q168 126 152 150Q128 166 100 154Q74 164 60 152L46 120Q36 98 46 74Q38 60 46 50Z"/>'
    + ''.join(f'<circle cx="{x}" cy="{y}" r="{r}" fill="var(--b)"/>' for x, y, r in ((84, 76, 5), (98, 70, 4), (110, 80, 5), (92, 88, 3.5), (124, 70, 3.5), (120, 96, 4), (104, 100, 3)))
    + '<path fill="none" stroke="var(--b)" stroke-width="5" stroke-linecap="round" d="M84 126Q100 118 116 126M96 140Q110 134 124 140"/>'
    + '<path fill="var(--a)" d="M140 128C131 122 130 116 134 113Q138 111 140 115Q142 111 146 113Q150 116 140 128Z"/>'
    + f'<path {S} fill="var(--b)" d="M46 120Q74 116 60 152Q50 156 42 146Q34 130 46 120Z"/>'
    + '<path fill="none" stroke="var(--c)" stroke-width="4" stroke-linecap="round" d="M50 128Q60 132 54 144"/>'
)
fur_top = 'M36 56' + ''.join(f'L{40 + 12 * k + 6} {40 if k % 2 == 0 else 46}L{52 + 12 * k} 54' for k in range(10))
fur_bot = ''.join(f'L{152 - 12 * k - 6} {160 if k % 2 == 0 else 154}L{140 - 12 * k} 146' for k in range(10))
SUBJECTS['a fur swatch'] = (
    f'<path {S} fill="var(--b)" d="{fur_top}L164 56L160 80L166 100L160 120L164 146{fur_bot}L36 146L40 120L34 100L40 80Z"/>'
    + '<path fill="none" stroke="var(--c)" stroke-width="10" stroke-linecap="round" d="M60 64Q72 84 62 104M96 60Q110 84 96 110Q88 126 98 140M134 66Q146 88 136 108M126 124Q136 132 130 140M58 124Q66 130 62 138"/>'
    + '<path fill="none" stroke="var(--o)" stroke-width="4" stroke-linecap="round" d="M76 92L80 100M114 76L118 84M150 118L146 126M78 128L82 134"/>'
    + f'<path {S} fill="var(--c)" d="M152 130H172V150L162 158L152 150Z"/><circle cx="162" cy="141" r="5" fill="var(--a)"/>'
)

# ---------- 晶片 ----------
SUBJECTS['a software cartridge'] = (
    f'<path {S} fill="var(--b)" d="M48 28H146L156 38V158Q156 174 140 174H60Q44 174 44 158V32Q44 28 48 28Z"/>'
    + '<path stroke="var(--o)" stroke-width="5" stroke-linecap="round" d="M64 38H128M64 48H128"/>'
    + f'<rect {S} x="60" y="62" width="80" height="66" rx="8" fill="var(--c)"/>'
    + '<path fill="var(--b)" d="M68 120L90 90L104 106L114 96L132 120Z"/><circle cx="118" cy="78" r="7" fill="var(--a)"/>'
    + '<rect x="64" y="146" width="72" height="20" rx="4" fill="var(--o)"/>'
    + ''.join(f'<rect x="{70 + 13 * k}" y="150" width="7" height="12" rx="2" fill="var(--c)"/>' for k in range(5))
)
SUBJECTS['a microchip'] = (
    ''.join(f'<rect {S} x="{x}" y="{y}" width="24" height="12" rx="4" fill="var(--c)"/>' for y in (52, 76, 100, 124, 148) for x in (30, 146))
    + f'<rect {S} x="50" y="34" width="100" height="136" rx="12" fill="var(--b)"/>'
    + '<path fill="var(--o)" d="M86 34A14 14 0 0 0 114 34Z"/>'
    + '<path fill="none" stroke="var(--c)" stroke-width="6" stroke-linecap="round" d="M64 60V150"/>'
    + '<circle cx="128" cy="150" r="8" fill="var(--a)"/>'
    + '<path fill="none" stroke="var(--o)" stroke-width="5" stroke-linecap="round" stroke-linejoin="round" d="M84 84H116V120H84Z"/>'
)
SUBJECTS['a memory chip'] = (
    '<g transform="rotate(-14 100 100)">'
    + f'<path {S} fill="var(--b)" d="M28 62H172V136H106V128H94V136H28Z"/>'
    + ''.join(f'<rect x="{x}" y="74" width="26" height="34" rx="3" fill="var(--o)"/>' for x in (38, 74, 110))
    + '<rect x="146" y="74" width="16" height="16" rx="3" fill="var(--o)"/>'
    + ''.join(f'<rect x="{x}" y="116" width="6" height="14" rx="1.5" fill="var(--c)"/>' for x in list(range(36, 92, 10)) + list(range(110, 166, 10)))
    + '<circle cx="154" cy="102" r="6" fill="var(--a)"/>'
    + '<path stroke="var(--c)" stroke-width="4" stroke-linecap="round" d="M42 80V100"/>'
    + '</g>'
)

# ---------- 神經與感測 ----------
dend = 'M100 100L46 52M64 68L40 76M100 100L156 44M138 62L150 76M100 100L170 128M100 100L48 152M68 132L60 168M100 100L112 176'
tips = ((46, 52), (40, 76), (156, 44), (150, 76), (170, 128), (48, 152), (60, 168), (112, 176))
SUBJECTS['a glowing neuron node'] = (
    f'<path fill="none" stroke="var(--o)" stroke-width="20" stroke-linecap="round" d="{dend}"/>'
    + f'<path fill="none" stroke="var(--b)" stroke-width="9" stroke-linecap="round" d="{dend}"/>'
    + ''.join(f'<circle {S} cx="{x}" cy="{y}" r="7" fill="var(--c)"/>' for x, y in tips)
    + '<circle cx="100" cy="100" r="44" fill="none" stroke="var(--c)" stroke-width="4" stroke-dasharray="6 9" stroke-linecap="round"/>'
    + f'<circle {S} cx="100" cy="100" r="28" fill="var(--b)"/><circle cx="100" cy="100" r="18" fill="var(--c)"/>'
    + '<circle cx="100" cy="100" r="9" fill="var(--a)"/>'
)
SUBJECTS['a sensor lens'] = (
    f'<circle {S} cx="100" cy="100" r="72" fill="var(--b)"/>'
    + ''.join(f'<path stroke="var(--o)" stroke-width="6" stroke-linecap="round" d="M100 32V40" transform="rotate({a} 100 100)"/>' for a in range(0, 360, 30))
    + f'<circle {S} cx="100" cy="100" r="50" fill="var(--c)"/>'
    + '<circle cx="100" cy="100" r="38" fill="var(--o)"/>'
    + f'<path fill="var(--b)" d="{_hex(100, 100, 30)}"/>'
    + '<path fill="none" stroke="var(--o)" stroke-width="4" d="M74 85L100 100M126 85L100 100M100 130V100"/>'
    + '<circle cx="100" cy="100" r="13" fill="var(--o)"/>'
    + '<circle cx="86" cy="84" r="8" fill="var(--c)"/><circle cx="116" cy="118" r="4" fill="var(--c)"/>'
    + '<circle cx="152" cy="54" r="7" fill="var(--a)"/>'
)

# ---------- 裝甲與機構 ----------
SUBJECTS['an armor plate'] = (
    f'<path {S} fill="var(--b)" d="M36 46Q100 22 164 46L156 116Q146 154 100 178Q54 154 44 116Z"/>'
    + f'<path {S} fill="var(--c)" d="M60 62Q100 46 140 62L134 112Q126 140 100 156Q74 140 66 112Z"/>'
    + '<path fill="none" stroke="var(--b)" stroke-width="10" stroke-linecap="round" stroke-linejoin="round" d="M74 92L100 112L126 92"/>'
    + '<path fill="none" stroke="var(--o)" stroke-width="5" stroke-linecap="round" d="M118 66L108 80L114 84L104 98"/>'
    + ''.join(f'<circle cx="{x}" cy="{y}" r="5" fill="var(--o)"/>' for x, y in ((50, 56), (150, 56), (56, 118), (144, 118)))
    + '<circle cx="100" cy="166" r="5" fill="var(--a)"/>'
)
SUBJECTS['a hydraulic actuator'] = (
    '<g transform="rotate(-40 100 100)">'
    + '<path fill="none" stroke="var(--o)" stroke-width="18" stroke-linecap="round" d="M56 76Q60 50 92 54Q112 56 110 76"/>'
    + '<path fill="none" stroke="var(--b)" stroke-width="8" stroke-linecap="round" d="M56 76Q60 50 92 54Q112 56 110 76"/>'
    + f'<circle {S} cx="26" cy="100" r="18" fill="var(--c)"/><circle cx="26" cy="100" r="7" fill="var(--o)"/>'
    + f'<rect {S} x="36" y="78" width="84" height="44" rx="8" fill="var(--b)"/>'
    + '<path stroke="var(--o)" stroke-width="5" d="M60 78V122M96 78V122"/>'
    + '<path stroke="var(--c)" stroke-width="5" stroke-linecap="round" d="M44 88H54M68 88H88"/>'
    + f'<rect {S} x="124" y="91" width="40" height="18" rx="4" fill="var(--c)"/>'
    + f'<rect {S} x="114" y="72" width="14" height="56" rx="5" fill="var(--c)"/>'
    + f'<circle {S} cx="172" cy="100" r="15" fill="var(--b)"/><circle cx="172" cy="100" r="6" fill="var(--o)"/>'
    + '<circle cx="78" cy="108" r="6" fill="var(--a)"/>'
    + '</g>'
)
SUBJECTS['a gear mechanism'] = (
    f'<path {S} fill="var(--c)" d="{_gear(140, 64, 36, 26, 9, 0.2)}"/>'
    + f'<circle cx="140" cy="64" r="12" fill="var(--b)"/><circle cx="140" cy="64" r="5" fill="var(--o)"/>'
    + f'<path {S} fill="var(--b)" d="{_gear(80, 118, 56, 44, 12)}"/>'
    + f'<circle {S} cx="80" cy="118" r="26" fill="var(--c)"/>'
    + '<path fill="var(--o)" d="M74 108H86V128H74Z"/>'
    + ''.join(f'<circle cx="{80 + 36 * math.cos(a):.1f}" cy="{118 + 36 * math.sin(a):.1f}" r="5" fill="var(--o)"/>' for a in (0.4, 2.5, 4.6))
    + '<circle cx="60" cy="98" r="6" fill="var(--a)"/>'
)

# ---------- 線軸 ----------
SUBJECTS['a spool of fiber'] = (
    f'<ellipse {S} cx="54" cy="96" rx="18" ry="60" fill="var(--b)"/>'
    + f'<rect {S} x="54" y="52" width="82" height="88" fill="var(--c)"/>'
    + ''.join(f'<path fill="none" stroke="var(--b)" stroke-width="4" d="M{x} 54Q{x + 6} 96 {x} 138"/>' for x in (66, 80, 94, 108, 122))
    + f'<ellipse {S} cx="136" cy="96" rx="18" ry="60" fill="var(--b)"/>'
    + '<ellipse cx="136" cy="96" rx="7" ry="20" fill="var(--o)"/>'
    + '<path fill="none" stroke="var(--o)" stroke-width="14" stroke-linecap="round" d="M110 138Q120 168 158 160"/>'
    + '<path fill="none" stroke="var(--c)" stroke-width="6" stroke-linecap="round" d="M110 138Q120 168 158 160"/>'
    + '<circle cx="164" cy="158" r="9" fill="var(--a)"/>'
    + '<path stroke="var(--c)" stroke-width="4" stroke-linecap="round" d="M172 140L168 148M180 160H174M174 176L170 168"/>'
)
SUBJECTS['a spool of spider silk'] = (
    f'<ellipse {S} cx="86" cy="152" rx="52" ry="16" fill="var(--b)"/>'
    + f'<rect {S} x="44" y="46" width="84" height="106" fill="var(--c)"/>'
    + '<path fill="none" stroke="var(--b)" stroke-width="3.5" stroke-linecap="round" d="M46 62L126 92M46 92L126 62M46 102L126 132M46 132L126 102M46 120Q86 112 126 120"/>'
    + f'<ellipse {S} cx="86" cy="46" rx="52" ry="16" fill="var(--b)"/>'
    + '<ellipse cx="86" cy="46" rx="12" ry="5" fill="var(--o)"/>'
    + '<path fill="none" stroke="var(--o)" stroke-width="8" stroke-linecap="round" d="M128 76Q156 80 158 124"/>'
    + '<path fill="none" stroke="var(--c)" stroke-width="3" stroke-linecap="round" d="M128 76Q156 80 158 124"/>'
    + '<path fill="none" stroke="var(--o)" stroke-width="9" stroke-linecap="round" d="M144 126L136 120M144 134L134 136M144 142L136 150M172 126L180 120M172 134L182 136M172 142L180 150"/>'
    + '<path fill="none" stroke="var(--c)" stroke-width="4" stroke-linecap="round" d="M144 126L136 120M144 134L134 136M144 142L136 150M172 126L180 120M172 134L182 136M172 142L180 150"/>'
    + f'<circle {S} cx="158" cy="134" r="12" fill="var(--a)"/>'
    + '<circle cx="154" cy="132" r="2.5" fill="var(--o)"/><circle cx="162" cy="132" r="2.5" fill="var(--o)"/>'
)

# ---------- 義體 ----------
SUBJECTS['a cybernetic arm'] = (
    '<g transform="translate(-4 6)">'
    + f'<rect {S} x="104" y="56" width="42" height="80" rx="12" fill="var(--b)" transform="rotate(8 125 96)"/>'
    + f'<path {S} fill="var(--b)" d="M36 120Q36 108 60 104Q100 100 124 118L120 158H48Q36 158 36 146Z"/>'
    + '<path fill="none" stroke="var(--c)" stroke-width="7" stroke-linecap="round" d="M56 116Q80 108 102 118"/>'
    + '<path stroke="var(--o)" stroke-width="5" d="M70 106V158"/>'
    + f'<rect {S} x="100" y="24" width="58" height="44" rx="14" fill="var(--c)"/>'
    + '<path fill="none" stroke="var(--o)" stroke-width="5" stroke-linecap="round" d="M114 30V48M128 30V48M142 30V48"/>'
    + '<path stroke="var(--o)" stroke-width="5" stroke-linecap="round" d="M114 88L140 92"/>'
    + f'<circle {S} cx="124" cy="140" r="20" fill="var(--c)"/><circle cx="124" cy="140" r="8" fill="var(--a)"/>'
    + '</g>'
)
SUBJECTS['a cybernetic leg'] = (
    '<path fill="none" stroke="var(--o)" stroke-width="30" stroke-linecap="round" stroke-linejoin="round" d="M96 120Q94 170 128 172H156"/>'
    + '<path fill="none" stroke="var(--c)" stroke-width="16" stroke-linecap="round" stroke-linejoin="round" d="M96 120Q94 170 128 172H156"/>'
    + f'<rect {S} x="84" y="104" width="24" height="30" rx="6" fill="var(--b)"/>'
    + f'<path {S} fill="var(--b)" d="M66 24H130L118 92H80Z"/>'
    + '<path fill="none" stroke="var(--c)" stroke-width="7" stroke-linecap="round" d="M80 36L88 80"/>'
    + '<path stroke="var(--o)" stroke-width="5" d="M70 50H126"/>'
    + f'<circle {S} cx="98" cy="98" r="18" fill="var(--c)"/><circle cx="98" cy="98" r="7" fill="var(--a)"/>'
)
SUBJECTS['a cybernetic eye'] = (
    '<path fill="none" stroke="var(--o)" stroke-width="18" stroke-linecap="round" d="M54 124Q34 150 54 174M46 96Q22 104 28 140"/>'
    + '<path fill="none" stroke="var(--b)" stroke-width="8" stroke-linecap="round" d="M54 124Q34 150 54 174M46 96Q22 104 28 140"/>'
    + f'<circle {S} cx="100" cy="94" r="56" fill="var(--c)"/>'
    + '<path fill="none" stroke="var(--o)" stroke-width="5" d="M72 46Q56 94 72 142"/>'
    + f'<circle {S} cx="118" cy="94" r="28" fill="var(--b)"/>'
    + '<circle cx="118" cy="94" r="12" fill="var(--o)"/><circle cx="112" cy="88" r="5" fill="var(--c)"/>'
    + '<path fill="none" stroke="var(--c)" stroke-width="4" stroke-linecap="round" d="M118 70V76M118 112V118M94 94H100M136 94H142"/>'
    + '<circle cx="54" cy="174" r="6" fill="var(--a)"/>'
)
SUBJECTS['a neural port implant'] = (
    f'<circle {S} cx="100" cy="110" r="58" fill="var(--b)"/>'
    + ''.join(f'<circle cx="{100 + 44 * math.cos(a):.1f}" cy="{110 + 44 * math.sin(a):.1f}" r="5" fill="var(--o)"/>' for a in (0.8, 2.35, 3.9, 5.5))
    + f'<circle {S} cx="100" cy="110" r="28" fill="var(--c)"/>'
    + '<circle cx="100" cy="110" r="15" fill="var(--o)"/>'
    + '<path fill="none" stroke="var(--o)" stroke-width="16" stroke-linecap="round" d="M100 66V40Q100 26 116 24H140"/>'
    + '<path fill="none" stroke="var(--b)" stroke-width="7" stroke-linecap="round" d="M100 66V40Q100 26 116 24H140"/>'
    + f'<rect {S} x="88" y="62" width="24" height="30" rx="5" fill="var(--c)"/>'
    + '<path stroke="var(--o)" stroke-width="4" d="M94 92V100M100 92V102M106 92V100"/>'
    + '<circle cx="142" cy="146" r="7" fill="var(--a)"/>'
)
SUBJECTS['a brain implant'] = (
    f'<path {S} fill="var(--c)" d="M100 66Q70 58 56 80Q36 88 42 114Q36 140 62 148Q72 170 100 162Q128 170 138 148Q164 140 158 114Q164 88 144 80Q130 58 100 66Z"/>'
    + '<path fill="none" stroke="var(--o)" stroke-width="6" stroke-linecap="round" d="M100 82V160M64 100Q78 96 82 112M136 100Q122 96 118 112M66 132Q80 126 90 136M134 132Q122 126 112 138"/>'
    + '<path fill="none" stroke="var(--b)" stroke-width="5" stroke-linecap="round" d="M80 72V84M120 72V84"/>'
    + f'<rect {S} x="70" y="34" width="60" height="40" rx="8" fill="var(--b)"/>'
    + '<rect x="84" y="44" width="22" height="20" rx="3" fill="var(--c)"/>'
    + '<path stroke="var(--o)" stroke-width="5" stroke-linecap="round" d="M130 40L148 26"/>'
    + '<circle cx="118" cy="54" r="6" fill="var(--a)"/>'
    + f'<circle {S} cx="150" cy="24" r="6" fill="var(--c)"/>'
)
SUBJECTS['an ear implant'] = (
    f'<path {S} fill="var(--c)" d="M86 30Q136 30 136 80Q136 104 116 116Q104 124 104 140Q104 170 78 170Q60 170 60 150Q60 30 86 30Z"/>'
    + '<path fill="none" stroke="var(--o)" stroke-width="7" stroke-linecap="round" d="M84 70Q104 64 106 88Q106 100 94 104"/>'
    + '<path fill="none" stroke="var(--o)" stroke-width="22" stroke-linecap="round" d="M70 48Q96 26 128 50"/>'
    + '<path fill="none" stroke="var(--b)" stroke-width="12" stroke-linecap="round" d="M70 48Q96 26 128 50"/>'
    + '<path stroke="var(--o)" stroke-width="5" d="M90 34V44M108 34V44"/>'
    + '<path stroke="var(--o)" stroke-width="11" stroke-linecap="round" d="M128 50L150 30"/><path stroke="var(--b)" stroke-width="5" stroke-linecap="round" d="M128 50L150 30"/>'
    + '<circle cx="152" cy="28" r="7" fill="var(--a)"/>'
    + f'<circle {S} cx="80" cy="152" r="9" fill="var(--b)"/>'
)
SUBJECTS['an audio implant'] = (
    '<path fill="none" stroke="var(--o)" stroke-width="30" stroke-linecap="round" d="M74 116L50 164"/>'
    + '<path fill="none" stroke="var(--b)" stroke-width="20" stroke-linecap="round" d="M74 116L50 164"/>'
    + f'<circle {S} cx="92" cy="86" r="48" fill="var(--b)"/>'
    + f'<circle {S} cx="92" cy="86" r="32" fill="var(--c)"/>'
    + ''.join(f'<circle cx="{92 + dx}" cy="{86 + dy}" r="4" fill="var(--o)"/>' for dx in (-16, 0, 16) for dy in (-16, 0, 16) if dx * dx + dy * dy < 400)
    + '<circle cx="52" cy="160" r="5" fill="var(--a)"/>'
    + '<path fill="none" stroke="var(--c)" stroke-width="8" stroke-linecap="round" d="M150 66Q160 86 150 106M166 50Q184 86 166 122"/>'
)
SUBJECTS['a torso implant'] = (
    f'<path {S} fill="var(--b)" d="M56 32H144Q160 32 162 50L156 140Q150 170 100 174Q50 170 44 140L38 50Q40 32 56 32Z"/>'
    + '<path fill="none" stroke="var(--o)" stroke-width="6" stroke-linecap="round" d="M88 56Q68 52 52 64M88 80Q66 76 50 90M88 124Q66 120 52 134M88 148Q70 144 58 156M112 56Q132 52 148 64M112 80Q134 76 150 90M112 124Q134 120 148 134M112 148Q130 144 142 156"/>'
    + f'<rect {S} x="88" y="38" width="24" height="126" rx="10" fill="var(--c)"/>'
    + f'<circle {S} cx="100" cy="102" r="24" fill="var(--c)"/>'
    + '<circle cx="100" cy="102" r="16" fill="var(--o)"/><circle cx="100" cy="102" r="9" fill="var(--a)"/>'
)
SUBJECTS['a glowing skin tattoo patch'] = (
    '<g transform="rotate(-8 100 100)">'
    + f'<rect {S} x="42" y="42" width="116" height="116" rx="20" fill="var(--c)"/>'
    + '<rect x="52" y="52" width="96" height="96" rx="14" fill="none" stroke="var(--o)" stroke-width="3" stroke-dasharray="7 6"/>'
    + '<path fill="var(--b)" d="M98 100C82 68 58 70 62 92C64 104 82 104 98 100ZM102 100C118 68 142 70 138 92C136 104 118 104 102 100ZM98 104C84 108 70 116 76 128C82 136 94 124 98 104ZM102 104C116 108 130 116 124 128C118 136 106 124 102 104Z"/>'
    + '<rect x="96" y="80" width="8" height="46" rx="4" fill="var(--a)"/>'
    + '</g>'
    + ''.join(f'<path {S} fill="var(--c)" d="M{x} {y - 12}Q{x + 2} {y - 2} {x + 12} {y}Q{x + 2} {y + 2} {x} {y + 12}Q{x - 2} {y + 2} {x - 12} {y}Q{x - 2} {y - 2} {x} {y - 12}Z"/>' for x, y in ((160, 40), (38, 160)))
)
SUBJECTS['artificial muscle fibers'] = (
    '<g transform="rotate(-30 100 100)">'
    + f'<rect {S} x="18" y="90" width="34" height="20" rx="6" fill="var(--c)"/>'
    + f'<rect {S} x="148" y="90" width="34" height="20" rx="6" fill="var(--c)"/>'
    + f'<path {S} fill="var(--b)" d="M42 100C62 48 138 48 158 100C138 152 62 152 42 100Z"/>'
    + '<path fill="none" stroke="var(--c)" stroke-width="5" stroke-linecap="round" d="M56 100C80 72 120 72 144 100M60 88C84 64 116 64 140 88M60 112C84 136 116 136 140 112M56 100C80 128 120 128 144 100"/>'
    + '<path fill="none" stroke="var(--o)" stroke-width="5" d="M78 64V136M122 64V136"/>'
    + '<path stroke="var(--o)" stroke-width="5" d="M30 90V110M170 90V110"/>'
    + '<circle cx="100" cy="100" r="8" fill="var(--a)"/>'
    + '</g>'
)
SUBJECTS['a biological gland'] = (
    '<path fill="none" stroke="var(--o)" stroke-width="20" stroke-linecap="round" d="M96 52Q90 34 74 26M116 50Q124 34 142 30"/>'
    + '<path fill="none" stroke="var(--b)" stroke-width="10" stroke-linecap="round" d="M96 52Q90 34 74 26M116 50Q124 34 142 30"/>'
    + f'<path {S} fill="var(--b)" d="M60 70Q70 42 104 46Q150 50 156 92Q160 134 118 148Q72 160 52 128Q38 100 60 70Z"/>'
    + '<path fill="none" stroke="var(--o)" stroke-width="5" stroke-linecap="round" d="M104 50Q100 100 108 148"/>'
    + '<path fill="none" stroke="var(--c)" stroke-width="4" stroke-linecap="round" d="M96 56Q80 76 84 100Q86 116 72 128M84 100Q70 96 62 104M118 58Q132 80 128 100Q126 118 140 128M128 100Q142 94 150 100"/>'
    + '<circle cx="74" cy="76" r="7" fill="var(--c)"/>'
    + '<path fill="var(--a)" d="M106 156Q114 166 114 172A8 8 0 0 1 98 172Q98 166 106 156Z"/>'
)
_bone = ['<rect {s} x="44" y="86" width="112" height="28" fill="var(--c)"/>'] + \
    [f'<circle {{s}} cx="{x}" cy="{y}" r="17" fill="var(--c)"/>' for x in (40, 160) for y in (84, 116)]
SUBJECTS['a bone plate'] = (
    '<g transform="rotate(-35 100 100)">'
    + ''.join(s.format(s=S) for s in _bone) + ''.join(s.format(s='') for s in _bone)
    + f'<rect {S} x="68" y="78" width="64" height="44" rx="8" fill="var(--b)"/>'
    + ''.join(f'<circle cx="{x}" cy="100" r="7" fill="var(--o)"/><path stroke="var(--c)" stroke-width="3" d="M{x - 4} 96L{x + 4} 104"/>' for x in (82, 118))
    + '<circle cx="100" cy="100" r="5" fill="var(--a)"/>'
    + '</g>'
)
SUBJECTS['a chitin shell plate'] = (
    f'<path {S} fill="var(--b)" d="M100 38C148 38 166 84 160 122C154 158 124 176 100 176C76 176 46 158 40 122C34 84 52 38 100 38Z"/>'
    + '<path stroke="var(--o)" stroke-width="6" d="M100 54V176"/>'
    + '<path fill="none" stroke="var(--o)" stroke-width="4" stroke-linecap="round" d="M52 110Q74 102 94 108M148 110Q126 102 106 108M58 144Q76 136 94 142M142 144Q124 136 106 142"/>'
    + '<path fill="none" stroke="var(--c)" stroke-width="7" stroke-linecap="round" d="M60 80Q66 66 80 60M124 66Q136 72 140 84"/>'
    + f'<path {S} fill="var(--c)" d="M62 42Q100 18 138 42L132 58Q100 46 68 58Z"/>'
    + '<circle cx="78" cy="126" r="5" fill="var(--a)"/>'
)

# ---------- 電源 ----------
SUBJECTS['a power cell'] = (
    f'<rect {S} x="86" y="20" width="28" height="16" rx="4" fill="var(--c)"/>'
    + f'<rect {S} x="62" y="40" width="76" height="126" rx="14" fill="var(--b)"/>'
    + f'<rect {S} x="54" y="30" width="92" height="22" rx="8" fill="var(--c)"/>'
    + f'<rect {S} x="54" y="152" width="92" height="22" rx="8" fill="var(--c)"/>'
    + '<rect x="78" y="64" width="44" height="78" rx="12" fill="var(--o)"/>'
    + '<rect x="86" y="72" width="28" height="62" rx="8" fill="var(--c)"/>'
    + '<path fill="none" stroke="var(--a)" stroke-width="5" stroke-linecap="round" stroke-linejoin="round" d="M100 80L92 102H108L100 126"/>'
    + '<path stroke="var(--o)" stroke-width="4" d="M66 80H74M66 96H74M66 112H74M126 80H134M126 96H134M126 112H134"/>'
)
SUBJECTS['a battery'] = (
    f'<rect {S} x="152" y="80" width="24" height="40" rx="6" fill="var(--c)"/>'
    + f'<rect {S} x="24" y="56" width="134" height="88" rx="16" fill="var(--b)"/>'
    + '<rect x="38" y="70" width="106" height="60" rx="8" fill="var(--o)"/>'
    + ''.join(f'<rect x="{x}" y="78" width="26" height="44" rx="4" fill="var(--c)"/>' for x in (46, 78))
    + '<rect x="110" y="78" width="26" height="44" rx="4" fill="none" stroke="var(--c)" stroke-width="3" stroke-dasharray="5 5"/>'
    + '<path fill="var(--a)" d="M136 146C126 140 125 134 129 131Q133 129 136 133Q139 129 143 131Q147 134 136 146Z" transform="translate(-13 -36)"/>'
)

# ---------- 藥物 ----------
SUBJECTS['a pill capsule'] = (
    '<g transform="rotate(-38 100 100)">'
    + f'<path {S} fill="var(--c)" d="M64 70H100V130H64A30 30 0 0 1 64 70Z"/>'
    + f'<path {S} fill="var(--b)" d="M104 70H136A30 30 0 0 1 136 130H104Z"/>'
    + ''.join(f'<circle cx="{x}" cy="{y}" r="{r}" fill="var(--b)"/>' for x, y, r in ((58, 108, 6), (74, 116, 5), (82, 98, 6), (62, 90, 4), (90, 116, 4)))
    + '<circle cx="76" cy="84" r="5" fill="var(--a)"/>'
    + '<path fill="none" stroke="var(--c)" stroke-width="7" stroke-linecap="round" d="M114 84H140"/>'
    + '</g>'
)
SUBJECTS['a pill'] = (
    f'<path {S} fill="var(--b)" d="M110 54V64A32 15 0 0 0 174 64V54Z"/>'
    + f'<ellipse {S} cx="142" cy="54" rx="32" ry="15" fill="var(--c)"/>'
    + '<path stroke="var(--o)" stroke-width="4" d="M122 54H162"/>'
    + f'<path {S} fill="var(--b)" d="M34 112V128A62 32 0 0 0 158 128V112Z"/>'
    + f'<ellipse {S} cx="96" cy="112" rx="62" ry="32" fill="var(--c)"/>'
    + '<path stroke="var(--o)" stroke-width="6" stroke-linecap="round" d="M48 112H144"/>'
    + '<path fill="var(--a)" d="M96 104C86 98 85 92 89 89Q93 87 96 91Q99 87 103 89Q107 92 96 104Z"/>'
    + '<path fill="none" stroke="var(--b)" stroke-width="5" stroke-linecap="round" d="M70 128Q96 136 122 128"/>'
)
SUBJECTS['a candy'] = (
    '<g transform="rotate(-18 100 100)">'
    + f'<path {S} fill="var(--c)" d="M70 100L30 68Q22 100 30 132Z"/>'
    + f'<path {S} fill="var(--c)" d="M130 100L170 68Q178 100 170 132Z"/>'
    + '<path fill="none" stroke="var(--o)" stroke-width="4" stroke-linecap="round" d="M40 84L58 98M40 116L58 102M160 84L142 98M160 116L142 102"/>'
    + f'<ellipse {S} cx="100" cy="100" rx="40" ry="34" fill="var(--b)"/>'
    + '<path fill="none" stroke="var(--c)" stroke-width="8" stroke-linecap="round" d="M78 76Q92 100 78 124M100 68Q116 100 100 132M122 76Q136 100 122 124"/>'
    + '</g>'
    + '<path fill="var(--a)" d="M60 50Q62 60 70 62Q62 64 60 74Q58 64 50 62Q58 60 60 50Z"/>'
)
SUBJECTS['a medical patch'] = (
    '<g transform="rotate(-35 100 100)">'
    + f'<rect {S} x="22" y="68" width="156" height="64" rx="32" fill="var(--c)"/>'
    + f'<rect {S} x="72" y="76" width="56" height="48" rx="8" fill="var(--b)"/>'
    + ''.join(f'<circle cx="{x}" cy="{y}" r="3.5" fill="var(--b)"/>' for x in (40, 54, 146, 160) for y in (88, 112))
    + '<path fill="none" stroke="var(--c)" stroke-width="3" stroke-dasharray="4 5" d="M80 84H120V116H80Z"/>'
    + '<path fill="var(--a)" d="M100 114C88 106 86 98 91 94Q96 91 100 96Q104 91 109 94Q114 98 100 114Z"/>'
    + '</g>'
)
SUBJECTS['an injector syringe'] = (
    '<g transform="rotate(-45 100 100)">'
    + '<path stroke="var(--o)" stroke-width="12" stroke-linecap="round" d="M150 100H178"/>'
    + '<path stroke="var(--c)" stroke-width="4" stroke-linecap="round" d="M150 100H178"/>'
    + f'<rect {S} x="136" y="88" width="16" height="24" rx="4" fill="var(--b)"/>'
    + f'<rect {S} x="34" y="92" width="30" height="16" rx="3" fill="var(--b)"/>'
    + f'<rect {S} x="20" y="72" width="14" height="56" rx="5" fill="var(--c)"/>'
    + f'<rect {S} x="62" y="74" width="80" height="52" rx="8" fill="var(--c)"/>'
    + f'<rect {S} x="56" y="64" width="12" height="72" rx="5" fill="var(--b)"/>'
    + '<rect x="96" y="84" width="38" height="32" rx="4" fill="var(--b)"/>'
    + '<rect x="90" y="84" width="6" height="32" fill="var(--o)"/>'
    + '<path stroke="var(--o)" stroke-width="4" d="M108 74V86M120 74V86M132 74V86"/>'
    + '<circle cx="184" cy="100" r="5" fill="var(--a)"/>'
    + '</g>'
)
SUBJECTS['a first-aid kit'] = (
    '<path fill="none" stroke="var(--o)" stroke-width="24" stroke-linejoin="round" d="M72 66V40H128V66"/>'
    + '<path fill="none" stroke="var(--c)" stroke-width="12" stroke-linejoin="round" d="M72 66V40H128V66"/>'
    + f'<rect {S} x="28" y="58" width="144" height="112" rx="18" fill="var(--b)"/>'
    + '<path stroke="var(--o)" stroke-width="5" d="M28 84H172"/>'
    + f'<rect {S} x="46" y="76" width="14" height="18" rx="3" fill="var(--c)"/>'
    + f'<rect {S} x="140" y="76" width="14" height="18" rx="3" fill="var(--c)"/>'
    + f'<path {S} fill="var(--c)" d="M88 98H112V114H128V138H112V154H88V138H72V114H88Z"/>'
    + '<circle cx="150" cy="150" r="6" fill="var(--a)"/>'
)
SUBJECTS['a rolled blueprint'] = (
    f'<path {S} fill="var(--b)" d="M44 50H156V150Q156 166 140 166H44Z"/>'
    + '<path fill="none" stroke="var(--c)" stroke-width="2" opacity=".55" d="M64 56V160M84 56V160M104 56V160M124 56V160M144 56V160M48 76H154M48 96H154M48 116H154M48 136H154"/>'
    + '<path fill="none" stroke="var(--c)" stroke-width="5" stroke-linejoin="round" stroke-linecap="round" d="M62 146V100L94 76L126 100V146ZM84 146V120H104V146M126 120H146"/>'
    + f'<path {S} fill="var(--c)" d="M140 166Q156 166 156 150Q156 140 146 140Q136 140 136 150Q136 158 144 158"/>'
    + f'<rect {S} x="30" y="34" width="140" height="28" rx="14" fill="var(--c)"/>'
    + '<ellipse cx="44" cy="48" rx="6" ry="8" fill="var(--o)"/>'
    + '<path stroke="var(--b)" stroke-width="4" stroke-linecap="round" d="M70 42H150"/>'
    + '<rect x="94" y="30" width="12" height="36" rx="3" fill="var(--a)"/>'
)
