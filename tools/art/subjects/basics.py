"""第 2 層的通用圖標：基本功 18、傷害類型 5、設施 31。給 tools/art/gen_icons.py 收進 icons-sprite.svg（ic-<id>）。
規格同 ART_STYLE 第 5 節：剪影＋扁平、--o 縫與輪廓、--b 主體、--c 亮部、--a 現實皮只有一個粉的重點；座標 200×200。
清單的來源：
  基本功    CORE_RULES 第 2 節的表（十八項）
  傷害類型  COMBAT_SYSTEM「傷害類型」的表（五種）
  設施      TRADE 第 2 節的商店種類（17 種）＋ DOWNTIME 第 4 節的打工地點與 SITES 第 2～9 節的街區設施歸成的 14 種
每一列：(id, 名字, 英文主體（給 icon_manifest 的提示詞）, SVG)。
icon_manifest.py 會拿 CORE_RULES、COMBAT_SYSTEM、TRADE 的表來對這三份清單，對不上會列出來。"""
import math

S = 'class="s"'
O, A, B, C = 'var(--o)', 'var(--a)', 'var(--b)', 'var(--c)'


def line(d, w=14, col=C, cap='round'):
    """線條：寬的 --o 墊底，窄的顏色在上（和 subjects/skills.py 的 L 一樣）。"""
    return (f'<path d="{d}" fill="none" stroke="{O}" stroke-width="{w + 12}" stroke-linecap="{cap}" stroke-linejoin="round"/>'
            f'<path d="{d}" fill="none" stroke="{col}" stroke-width="{w}" stroke-linecap="{cap}" stroke-linejoin="round"/>')


def star(cx, cy, r1, r2, n, rot=-90):
    pts = []
    for k in range(n * 2):
        r = r1 if k % 2 == 0 else r2
        a = math.radians(rot + k * 180 / n)
        pts.append(f'{cx + r * math.cos(a):.1f} {cy + r * math.sin(a):.1f}')
    return 'M' + 'L'.join(pts) + 'Z'


def scallop(x0, x1, y, n, depth):
    """遮陽棚的波浪下緣（由右往左）。"""
    w = (x1 - x0) / n
    d = ''
    for k in range(n):
        xa = x1 - k * w
        d += f'Q{xa - w / 2:.1f} {y + depth} {xa - w:.1f} {y}'
    return d


# ---------------- 基本功 ----------------
BASICS = [
    ('bs_brawl', '格鬥', 'a clenched fist',
     f'<path {S} fill="{B}" d="M48 96Q48 76 70 76H140Q160 76 160 96V132Q160 168 122 170H86Q48 168 48 132Z"/>'
     + ''.join(f'<rect {S} x="{x}" y="44" width="27" height="54" rx="13" fill="{C}"/>' for x in (50, 78, 106, 134))
     + f'<path {S} fill="{C}" d="M44 112H112Q126 112 126 125Q126 138 112 138H60Q44 138 44 124Z"/>'
     f'<rect {S} x="72" y="166" width="64" height="18" rx="5" fill="{A}"/>'),
    ('bs_athletics', '運動', 'a running sneaker with speed lines',
     f'<path {S} fill="{B}" d="M52 66Q70 60 86 74L114 102Q152 106 172 124Q182 134 178 150H52Z"/>'
     f'<rect {S} x="46" y="146" width="140" height="22" rx="9" fill="{C}"/>'
     f'<path d="M84 90L98 80M98 104L112 94" stroke="{O}" stroke-width="7" stroke-linecap="round"/>'
     f'<path d="M14 90H38M8 116H36M18 142H36" stroke="{A}" stroke-width="9" stroke-linecap="round"/>'),
    ('bs_heavy', '重裝', 'a heavy kettlebell',
     line('M68 94V70Q68 42 100 42Q132 42 132 70V94', 18, C)
     + f'<path {S} fill="{B}" d="M100 78Q164 78 164 136Q164 170 140 178H60Q36 170 36 136Q36 78 100 78Z"/>'
     f'<rect x="76" y="120" width="48" height="16" rx="8" fill="{A}"/>'),
    ('bs_firearms', '槍械', 'a gun scope reticle',
     f'<circle cx="100" cy="100" r="62" fill="none" stroke="{O}" stroke-width="30"/><circle cx="100" cy="100" r="62" fill="none" stroke="{B}" stroke-width="16"/>'
     + line('M100 20V64M100 136V180M20 100H64M136 100H180', 10, C, 'butt')
     + f'<circle {S} cx="100" cy="100" r="13" fill="{A}"/>'),
    ('bs_piloting', '操縱', 'a joystick',
     line('M100 136V74', 14, C)
     + f'<path {S} fill="{B}" d="M38 150Q38 132 58 132H142Q162 132 162 150V176H38Z"/>'
     f'<circle {S} cx="100" cy="58" r="28" fill="{B}"/><circle cx="100" cy="50" r="10" fill="{A}"/>'
     f'<circle cx="62" cy="156" r="8" fill="{O}"/><circle cx="138" cy="156" r="8" fill="{O}"/>'),
    ('bs_stealth', '隱匿', 'a hooded figure with glowing eyes in shadow',
     f'<path {S} fill="{B}" d="M100 24Q164 30 166 104Q168 146 186 178H14Q32 146 34 104Q36 30 100 24Z"/>'
     f'<path fill="{O}" d="M100 62Q142 66 144 112Q142 150 100 154Q58 150 56 112Q58 66 100 62Z"/>'
     f'<path fill="{A}" d="M68 108Q81 96 94 108Q81 115 68 108ZM106 108Q119 96 132 108Q119 115 106 108Z"/>'
     f'<path fill="none" stroke="{C}" stroke-width="7" stroke-linecap="round" d="M66 34Q100 22 134 34"/>'),
    ('bs_mechanics', '機械', 'a wrench and a hex nut',
     line('M44 166L108 98', 20, B)
     + f'<circle {S} cx="122" cy="76" r="36" fill="{B}"/><rect x="111" y="30" width="22" height="48" fill="{O}" transform="rotate(45 122 76)"/>'
     f'<rect x="58" y="134" width="30" height="14" rx="4" fill="{A}" transform="rotate(-47 73 141)"/>'
     f'<path {S} fill="{C}" d="M150 112L174 126V154L150 168L126 154V126Z"/><circle cx="150" cy="140" r="11" fill="{O}"/>'),
    ('bs_cyberware', '義體學', 'a robotic hand with segmented fingers',
     ''.join(f'<rect {S} x="{x}" y="28" width="24" height="34" rx="9" fill="{C}"/><rect {S} x="{x}" y="66" width="24" height="34" rx="6" fill="{C}"/>' for x in (58, 88, 118))
     + f'<path {S} fill="{C}" d="M138 118L166 92Q178 84 184 96Q186 104 180 110L152 144Z"/>'
     f'<rect {S} x="52" y="96" width="96" height="70" rx="16" fill="{B}"/><circle {S} cx="100" cy="130" r="14" fill="{A}"/>'
     f'<rect {S} x="70" y="164" width="60" height="18" rx="5" fill="{C}"/>'),
    ('bs_medicine', '醫療', 'a medical syringe',
     '<g transform="rotate(-45 100 100)">'
     f'<rect {S} x="12" y="74" width="16" height="52" rx="4" fill="{B}"/><rect {S} x="26" y="92" width="30" height="16" fill="{B}"/>'
     f'<rect {S} x="54" y="76" width="92" height="48" rx="7" fill="{C}"/><rect x="98" y="84" width="42" height="32" rx="3" fill="{A}"/>'
     f'<path d="M70 76V94M84 76V94M98 76V90" stroke="{O}" stroke-width="5"/>'
     f'<rect {S} x="146" y="88" width="16" height="24" rx="3" fill="{B}"/>'
     f'<path d="M162 100H190" stroke="{O}" stroke-width="10" stroke-linecap="round"/><path d="M162 100H190" stroke="{C}" stroke-width="4" stroke-linecap="round"/></g>'),
    ('bs_interface', '介面', 'a terminal window with a command prompt',
     f'<rect {S} x="24" y="38" width="152" height="124" rx="14" fill="{B}"/><rect x="38" y="62" width="124" height="86" rx="6" fill="{O}"/>'
     f'<circle cx="42" cy="50" r="5" fill="{C}"/><circle cx="58" cy="50" r="5" fill="{C}"/>'
     f'<path d="M56 82L80 104L56 126" fill="none" stroke="{C}" stroke-width="11" stroke-linecap="round" stroke-linejoin="round"/>'
     f'<rect x="92" y="118" width="40" height="11" rx="4" fill="{A}"/>'),
    ('bs_investigate', '調查', 'a magnifying glass',
     line('M124 124L170 170', 20, B)
     + f'<rect x="114" y="122" width="30" height="16" rx="4" fill="{A}" transform="rotate(45 129 130)"/>'
     f'<circle cx="84" cy="84" r="50" fill="none" stroke="{O}" stroke-width="32"/><circle cx="84" cy="84" r="50" fill="{C}" stroke="{B}" stroke-width="17"/>'
     f'<path d="M62 70Q68 58 82 56" fill="none" stroke="{B}" stroke-width="8" stroke-linecap="round"/>'),
    ('bs_streetwise', '街頭直覺', 'a radar sweep with one blip',
     f'<circle {S} cx="100" cy="100" r="74" fill="{B}"/>'
     f'<path fill="{C}" d="M100 100L100 34A66 66 0 0 1 157 67Z"/>'
     f'<circle cx="100" cy="100" r="44" fill="none" stroke="{O}" stroke-width="6"/><path d="M100 30V170M30 100H170" stroke="{O}" stroke-width="6"/>'
     f'<circle cx="100" cy="100" r="8" fill="{O}"/><circle {S} cx="136" cy="128" r="11" fill="{A}"/>'),
    ('bs_intimidate', '威嚇', 'a stylized cartoon skull',
     f'<path {S} fill="{C}" d="M100 24Q164 24 166 90Q166 120 146 132V148H54V132Q34 120 34 90Q36 24 100 24Z"/>'
     f'<rect {S} x="60" y="138" width="80" height="38" rx="10" fill="{B}"/>'
     f'<ellipse cx="72" cy="94" rx="19" ry="21" fill="{O}"/><ellipse cx="128" cy="94" rx="19" ry="21" fill="{O}"/><circle cx="128" cy="94" r="7" fill="{A}"/>'
     f'<path fill="{O}" d="M100 114L90 132H110Z"/><path d="M84 146V176M100 146V176M116 146V176" stroke="{O}" stroke-width="6"/>'),
    ('bs_resolve', '定力', 'an unmoving mountain under a sun',
     f'<circle {S} cx="148" cy="54" r="20" fill="{A}"/>'
     f'<path {S} fill="{B}" d="M14 166L80 54L118 118L138 90L186 166Z"/>'
     f'<path fill="{C}" d="M80 54L99 86L89 82L80 94L71 82L61 86Z"/><path fill="{C}" d="M138 90L150 108L138 104L128 106Z"/>'),
    ('bs_sync', '同步', 'two aligned signal waves in a frame',
     f'<rect {S} x="22" y="46" width="156" height="108" rx="20" fill="{B}"/>'
     + line('M42 100Q61 62 80 100T118 100T156 100', 12, C)
     + f'<path d="M42 100Q61 62 80 100T118 100T156 100" fill="none" stroke="{A}" stroke-width="4" stroke-linecap="round"/>'),
    ('bs_negotiate', '交涉', 'two overlapping speech bubbles',
     f'<path {S} fill="{B}" d="M40 34H120Q138 34 138 52V94Q138 112 120 112H66L40 134V112Q22 112 22 94V52Q22 34 40 34Z"/>'
     f'<path {S} fill="{C}" d="M80 82H160Q178 82 178 100V142Q178 160 160 160H160V182L134 160H80Q62 160 62 142V100Q62 82 80 82Z"/>'
     f'<circle cx="94" cy="121" r="9" fill="{O}"/><circle cx="120" cy="121" r="9" fill="{A}"/><circle cx="146" cy="121" r="9" fill="{O}"/>'),
    ('bs_seduce', '誘惑', 'a pair of glossy lips (stylized, non-explicit)',
     f'<path {S} fill="{B}" d="M22 104Q50 64 78 70Q92 74 100 84Q108 74 122 70Q150 64 178 104Q140 106 100 106Q60 106 22 104Z"/>'
     f'<path {S} fill="{C}" d="M22 104Q60 112 100 112Q140 112 178 104Q152 154 100 156Q48 154 22 104Z"/>'
     f'<path d="M76 130Q88 136 100 136" fill="none" stroke="{B}" stroke-width="6" stroke-linecap="round"/>'
     f'<path {S} fill="{A}" d="M160 60C142 48 142 34 150 30Q156 28 160 36Q164 28 170 30Q178 34 160 60Z"/>'),
    ('bs_perform', '表演', 'a stage microphone',
     f'<path {S} fill="{B}" d="M74 112H126L114 182H86Z"/>'
     f'<rect {S} x="66" y="20" width="68" height="80" rx="34" fill="{C}"/>'
     f'<path d="M74 46H126M70 68H130M100 24V96" stroke="{O}" stroke-width="5"/>'
     f'<rect {S} x="62" y="96" width="76" height="18" rx="6" fill="{A}"/>'),
]

# ---------------- 傷害類型 ----------------
DAMAGE = [
    ('dmg_physical', '物理', 'a bullet with an impact burst',
     f'<path {S} fill="{C}" d="{star(100, 100, 82, 52, 9)}"/>'
     '<g transform="rotate(-40 100 100)">'
     f'<rect {S} x="46" y="80" width="70" height="40" rx="4" fill="{B}"/><path {S} fill="{B}" d="M114 80H132Q168 100 132 120H114Z"/>'
     f'<rect x="60" y="80" width="12" height="40" fill="{A}"/></g>'),
    ('dmg_thermal', '熱能', 'a flame',
     f'<path {S} fill="{B}" d="M100 16Q122 58 146 76Q178 102 170 138Q162 182 100 184Q38 182 30 138Q26 104 52 82Q56 110 72 112Q60 68 100 16Z"/>'
     f'<path {S} fill="{C}" d="M100 82Q112 108 128 118Q142 134 134 154Q126 172 100 172Q74 172 66 154Q62 134 80 120Q88 140 96 132Q90 108 100 82Z"/>'
     f'<ellipse cx="100" cy="152" rx="14" ry="15" fill="{A}"/>'),
    ('dmg_emp', '電磁', 'a lightning bolt inside a broken pulse ring',
     f'<circle cx="100" cy="100" r="74" fill="none" stroke="{O}" stroke-width="28" stroke-dasharray="66 22"/><circle cx="100" cy="100" r="74" fill="none" stroke="{B}" stroke-width="14" stroke-dasharray="66 22"/>'
     f'<path {S} fill="{C}" d="M114 28L62 110H96L84 172L140 86H106Z"/>'
     f'<rect x="150" y="36" width="14" height="14" fill="{A}"/>'),
    ('dmg_neural', '神經', 'a nerve impulse spike in a circle',
     f'<circle {S} cx="100" cy="100" r="76" fill="{B}"/>'
     + line('M30 106H66L82 64L102 148L118 82L128 106H170', 11, C)
     + f'<circle {S} cx="82" cy="64" r="10" fill="{A}"/>'),
    ('dmg_pleasure', '快感', 'a heart with a single DNA strand',
     f'<path {S} fill="{B}" d="M100 180C38 140 18 106 26 74Q36 34 76 36Q94 40 100 60Q106 40 124 36Q164 34 174 74Q182 106 100 180Z"/>'
     f'<path d="M78 66L122 72M74 96L126 96M80 124L120 120" stroke="{O}" stroke-width="6" stroke-linecap="round"/>'
     + line('M100 50Q140 80 100 108Q62 134 100 160', 9, C)
     + f'<path d="M100 50Q60 80 100 108Q138 134 100 160" fill="none" stroke="{A}" stroke-width="7" stroke-linecap="round"/>'),
]

# ---------------- 設施 ----------------
# 第三欄是來源：TRADE = 商店種類（TRADE 第 2 節）；其餘是從 DOWNTIME 第 4 節與 SITES 的設施歸出來的
FACILITIES = [
    # TRADE 第 2 節
    ('fac_conv', '超商', 'a small convenience store front with a striped awning', 'TRADE',
     f'<rect {S} x="32" y="76" width="136" height="98" fill="{B}"/>'
     f'<rect x="44" y="104" width="38" height="30" rx="3" fill="{C}"/><rect x="92" y="108" width="30" height="66" fill="{O}"/><rect x="128" y="104" width="28" height="30" rx="3" fill="{C}"/>'
     f'<path {S} fill="{C}" d="M24 34H176V78{scallop(24, 176, 78, 6, 16)}Z"/>'
     + ''.join(f'<rect x="{24 + k * 50.7:.1f}" y="34" width="25" height="44" fill="{B}" opacity=".55"/>' for k in range(3))
     + f'<circle cx="116" cy="142" r="4" fill="{A}"/>'),
    ('fac_market', '市場攤販', 'a market stall with a striped canopy and produce', 'TRADE',
     line('M40 76V176M160 76V176', 6, B)
     + f'<path {S} fill="{C}" d="M46 30H154L182 76{scallop(18, 182, 76, 6, 14)}Z"/>'
     f'<path d="M73 30L64 80M127 30L136 80M100 30V80" stroke="{B}" stroke-width="10" opacity=".7"/>'
     f'<rect {S} x="26" y="124" width="148" height="26" rx="4" fill="{B}"/>'
     f'<circle {S} cx="58" cy="112" r="13" fill="{C}"/><circle {S} cx="86" cy="112" r="13" fill="{C}"/><circle {S} cx="114" cy="112" r="13" fill="{A}"/><circle {S} cx="142" cy="112" r="13" fill="{C}"/>'),
    ('fac_pharmacy', '藥局', 'a medicine bottle with a cross label', 'TRADE',
     f'<rect {S} x="48" y="50" width="104" height="132" rx="18" fill="{C}"/><rect {S} x="62" y="22" width="76" height="32" rx="6" fill="{B}"/>'
     f'<rect x="48" y="86" width="104" height="64" fill="{B}"/>'
     f'<path fill="{A}" d="M92 98H108V110H120V126H108V138H92V126H80V110H92Z"/>'),
    ('fac_clinic', '診所', 'a small clinic building with a cross sign', 'TRADE',
     f'<rect {S} x="34" y="72" width="132" height="106" fill="{B}"/><path {S} fill="{C}" d="M22 78L100 26L178 78Z"/>'
     f'<rect x="86" y="128" width="28" height="50" fill="{O}"/><rect x="48" y="128" width="26" height="24" rx="3" fill="{C}"/><rect x="126" y="128" width="26" height="24" rx="3" fill="{C}"/>'
     f'<circle {S} cx="100" cy="98" r="22" fill="{C}"/><path fill="{A}" d="M94 84H106V92H114V104H106V112H94V104H86V92H94Z"/>'),
    ('fac_gunshop', '槍店', 'a handgun mounted on a display plaque', 'TRADE',
     f'<rect {S} x="20" y="36" width="160" height="128" rx="16" fill="{B}"/>'
     f'<circle cx="38" cy="54" r="5" fill="{O}"/><circle cx="162" cy="54" r="5" fill="{O}"/><circle cx="38" cy="146" r="5" fill="{O}"/><circle cx="162" cy="146" r="5" fill="{O}"/>'
     f'<path {S} fill="{C}" d="M44 70H156V98H112L104 106V110L112 142H80L74 98H44Z"/>'
     f'<path d="M92 104Q92 120 104 120" fill="none" stroke="{O}" stroke-width="6"/><rect x="56" y="78" width="88" height="7" rx="3" fill="{A}"/>'),
    ('fac_cybershop', '義體店', 'a robotic forearm on a display pedestal', 'TRADE',
     f'<path {S} fill="{B}" d="M58 150H142L154 182H46Z"/>'
     + ''.join(f'<rect {S} x="{x}" y="22" width="20" height="40" rx="8" fill="{C}"/>' for x in (72, 96, 120)) +
     f'<rect {S} x="68" y="56" width="76" height="40" rx="12" fill="{C}"/>'
     f'<rect {S} x="82" y="100" width="48" height="52" rx="10" fill="{B}"/><rect {S} x="76" y="92" width="60" height="14" rx="5" fill="{A}"/>'
     f'<path d="M98 116H114M98 130H114" stroke="{O}" stroke-width="5"/>'),
    ('fac_electro', '電器街', 'a retro television with antennas', 'TRADE',
     line('M84 56L60 22M116 56L140 22', 6, C)
     + f'<rect {S} x="26" y="56" width="148" height="114" rx="16" fill="{B}"/><rect x="40" y="70" width="98" height="86" rx="14" fill="{C}"/>'
     f'<path d="M50 114Q62 92 74 114T98 114T122 114" fill="none" stroke="{O}" stroke-width="6" stroke-linecap="round"/>'
     f'<circle cx="156" cy="90" r="9" fill="{A}"/><circle cx="156" cy="118" r="8" fill="{O}"/><path d="M148 140H164" stroke="{O}" stroke-width="5"/>'),
    ('fac_clothes', '服飾店', 'a dress form mannequin', 'TRADE',
     line('M100 140V172', 6, B)
     + f'<ellipse {S} cx="100" cy="176" rx="40" ry="10" fill="{B}"/>'
     f'<path {S} fill="{C}" d="M70 30H130Q140 30 142 44L148 70Q150 86 138 96Q132 104 140 120L150 142H50L60 120Q68 104 62 96Q50 86 52 70L58 44Q60 30 70 30Z"/>'
     f'<path fill="{B}" d="M60 104L140 74L144 90L64 120Z"/><circle {S} cx="100" cy="22" r="9" fill="{A}"/>'),
    ('fac_flagship', '原廠直營', 'a corporate flagship tower with an emblem', 'TRADE',
     f'<path {S} fill="{B}" d="M56 182V52L100 20L144 52V182Z"/>'
     + ''.join(f'<rect x="70" y="{y}" width="60" height="9" rx="2" fill="{C}" opacity=".8"/>' for y in (110, 128, 146))
     + f'<rect x="88" y="162" width="24" height="20" fill="{O}"/>'
     f'<circle {S} cx="100" cy="70" r="24" fill="{C}"/><path fill="{A}" d="M100 54L114 70L100 86L86 70Z"/>'),
    ('fac_doujin', '同人攤', 'an open self-published booklet with a heart sticker', 'TRADE',
     f'<path {S} fill="{B}" d="M18 58Q60 42 100 58Q140 42 182 58V164Q140 150 100 166Q60 150 18 164Z"/>'
     f'<path fill="{C}" d="M30 56Q64 42 96 56V152Q64 140 30 152Z"/><path fill="{C}" d="M104 56Q136 42 170 56V152Q136 140 104 152Z"/>'
     f'<path d="M42 78Q64 70 84 78M42 98Q64 90 84 98M42 118Q64 110 84 118" fill="none" stroke="{O}" stroke-width="5" stroke-linecap="round"/>'
     f'<path {S} fill="{A}" d="M137 132C112 116 110 98 120 92Q130 88 137 98Q144 88 154 92Q164 98 137 132Z"/>'),
    ('fac_blackmarket', '黑市', 'a closed briefcase with a glowing latch', 'TRADE',
     line('M74 66V54Q74 40 88 40H112Q126 40 126 54V66', 10, C)
     + f'<rect {S} x="22" y="64" width="156" height="104" rx="14" fill="{B}"/>'
     f'<rect x="22" y="104" width="156" height="14" fill="{O}"/><rect x="40" y="64" width="12" height="104" fill="{C}" opacity=".7"/><rect x="148" y="64" width="12" height="104" fill="{C}" opacity=".7"/>'
     f'<rect {S} x="86" y="98" width="28" height="26" rx="4" fill="{A}"/>'),
    ('fac_scrapyard', '骨場', 'a crane claw above a scrap pile', 'TRADE',
     line('M100 14V58', 6, C)
     + f'<path {S} fill="{B}" d="M14 180Q30 128 70 134Q90 108 124 124Q168 116 186 180Z"/>'
     f'<circle cx="74" cy="152" r="16" fill="{C}"/><circle cx="74" cy="152" r="6" fill="{O}"/><rect x="118" y="140" width="40" height="14" rx="3" fill="{C}" transform="rotate(-18 138 147)"/>'
     f'<rect {S} x="84" y="54" width="32" height="20" rx="5" fill="{A}"/>'
     + line('M88 74L70 96L80 112M112 74L130 96L120 112', 7, C)),
    ('fac_coldstore', '冷庫', 'a cold-storage fridge with a snowflake', 'TRADE',
     f'<rect {S} x="46" y="18" width="108" height="166" rx="14" fill="{C}"/><path d="M46 74H154" stroke="{O}" stroke-width="8"/>'
     f'<rect x="132" y="34" width="10" height="26" rx="4" fill="{B}"/><rect x="132" y="88" width="10" height="34" rx="4" fill="{B}"/>'
     f'<g stroke="{B}" stroke-width="9" stroke-linecap="round"><path d="M96 98V160M69 113L123 145M69 145L123 113"/></g>'
     f'<circle cx="64" cy="40" r="7" fill="{A}"/>'),
    ('fac_tapes', '帶子街', 'a film reel with trailing tape', 'TRADE',
     line('M140 140Q166 160 178 184', 18, C, 'butt')
     + f'<circle {S} cx="90" cy="90" r="68" fill="{B}"/>'
     + ''.join(f'<circle cx="{90 + 38 * math.cos(math.radians(a)):.1f}" cy="{90 + 38 * math.sin(math.radians(a)):.1f}" r="15" fill="{O}"/>' for a in range(-90, 270, 72))
     + f'<circle cx="90" cy="90" r="14" fill="{C}"/><circle cx="90" cy="90" r="6" fill="{A}"/>'),
    ('fac_gacha', '扭蛋會館', 'a capsule toy vending machine', 'TRADE',
     f'<rect {S} x="50" y="118" width="100" height="64" rx="8" fill="{B}"/>'
     f'<circle {S} cx="100" cy="72" r="56" fill="{C}"/>'
     f'<circle cx="80" cy="90" r="15" fill="{B}"/><circle cx="114" cy="96" r="15" fill="{A}"/><circle cx="96" cy="60" r="15" fill="{B}"/><circle cx="128" cy="62" r="12" fill="{B}"/><circle cx="68" cy="58" r="11" fill="{B}"/>'
     f'<path d="M66 40Q80 26 98 24" fill="none" stroke="#fff" stroke-opacity=".7" stroke-width="6" stroke-linecap="round"/>'
     f'<circle {S} cx="80" cy="150" r="14" fill="{C}"/><path d="M80 141V159" stroke="{O}" stroke-width="5"/><rect x="112" y="142" width="26" height="22" rx="4" fill="{O}"/>'),
    ('fac_furniture', '家具行', 'a plump armchair', 'TRADE',
     f'<rect {S} x="44" y="30" width="112" height="90" rx="26" fill="{B}"/>'
     f'<rect {S} x="40" y="108" width="120" height="40" rx="12" fill="{C}"/>'
     f'<rect {S} x="20" y="84" width="36" height="74" rx="16" fill="{B}"/><rect {S} x="144" y="84" width="36" height="74" rx="16" fill="{B}"/>'
     f'<path d="M40 160V180M160 160V180" stroke="{O}" stroke-width="10" stroke-linecap="round"/>'
     f'<path {S} fill="{A}" d="M100 98C82 86 80 72 88 68Q96 64 100 74Q104 64 112 68Q120 72 100 98Z"/>'),
    ('fac_barter', '月台市', 'a crate between two exchange arrows', 'TRADE',
     f'<rect {S} x="64" y="70" width="72" height="62" rx="6" fill="{B}"/><rect x="64" y="94" width="72" height="12" fill="{A}"/>'
     + line('M34 92Q40 40 100 36Q144 36 160 62', 12, C)
     + f'<path {S} fill="{C}" d="M146 46L176 66L144 82Z"/>'
     + line('M166 110Q160 162 100 166Q56 166 40 140', 12, C)
     + f'<path {S} fill="{C}" d="M54 156L24 136L56 120Z"/>'),
    # DOWNTIME 第 4 節、SITES 的街區設施
    ('fac_bar', '酒吧', 'a cocktail glass with a cherry', 'SITES',
     line('M100 112V166', 8, C)
     + f'<ellipse {S} cx="100" cy="172" rx="42" ry="10" fill="{B}"/>'
     f'<path {S} fill="{C}" d="M30 38H170L100 116Z"/><path fill="{B}" d="M50 52H150L100 104Z"/>'
     f'<path d="M126 24L146 64" stroke="{O}" stroke-width="5"/><circle {S} cx="124" cy="22" r="12" fill="{A}"/>'),
    ('fac_netcafe', '潛艙店', 'a dive pod capsule with a cable', 'SITES',
     line('M150 64Q160 30 186 26', 7, C)
     + f'<rect {S} x="18" y="64" width="164" height="92" rx="46" fill="{B}"/>'
     f'<path fill="{C}" d="M42 108Q42 82 70 82H130Q158 82 158 108Z"/><path d="M70 82V108M100 82V108M130 82V108" stroke="{B}" stroke-width="5"/>'
     f'<circle cx="150" cy="132" r="8" fill="{A}"/><path d="M40 168H160" stroke="{O}" stroke-width="10" stroke-linecap="round"/>'),
    ('fac_hotel', '旅館', 'a bed with a pillow and a crescent moon', 'SITES',
     f'<rect {S} x="22" y="60" width="32" height="118" rx="8" fill="{B}"/>'
     f'<rect {S} x="48" y="112" width="132" height="40" rx="10" fill="{C}"/><rect {S} x="58" y="92" width="42" height="26" rx="12" fill="{C}"/>'
     f'<rect {S} x="96" y="102" width="84" height="50" rx="10" fill="{B}"/><path d="M56 152V178M170 152V178" stroke="{O}" stroke-width="10" stroke-linecap="round"/>'
     f'<path {S} fill="{A}" d="M150 26A24 24 0 1 0 170 66A18 18 0 1 1 150 26Z"/>'),
    ('fac_home', '住處', 'a small house with a heart window', 'SITES',
     f'<rect {S} x="128" y="34" width="20" height="40" fill="{B}"/>'
     f'<rect {S} x="40" y="88" width="120" height="90" fill="{C}"/><path {S} fill="{B}" d="M16 98L100 26L184 98Z"/>'
     f'<rect x="58" y="120" width="30" height="58" fill="{B}"/>'
     f'<path fill="{A}" d="M128 150C108 138 106 122 114 118Q122 114 128 124Q134 114 142 118Q150 122 128 150Z"/>'),
    ('fac_food', '餐館', 'a noodle bowl with chopsticks', 'SITES',
     line('M118 88L168 22M134 88L186 34', 5, C)
     + f'<path d="M58 84Q66 70 74 84T90 84T106 84T122 84T138 84" fill="none" stroke="{C}" stroke-width="8" stroke-linecap="round"/>'
     f'<circle {S} cx="62" cy="80" r="13" fill="{A}"/>'
     f'<path {S} fill="{B}" d="M22 98H178Q172 168 100 170Q28 168 22 98Z"/><rect {S} x="18" y="88" width="164" height="16" rx="8" fill="{C}"/>'),
    ('fac_arena', '擂台', 'a boxing ring with ropes', 'SITES',
     f'<rect {S} x="18" y="140" width="164" height="38" rx="4" fill="{B}"/>'
     f'<rect {S} x="24" y="48" width="16" height="96" rx="4" fill="{C}"/><rect {S} x="160" y="48" width="16" height="96" rx="4" fill="{C}"/>'
     + line('M40 70H160M40 94H160M40 118H160', 6, C, 'butt')
     + f'<rect {S} x="20" y="36" width="24" height="22" rx="5" fill="{A}"/><rect {S} x="156" y="36" width="24" height="22" rx="5" fill="{B}"/>'),
    ('fac_studio', '片場', 'a film clapperboard with a record light', 'SITES',
     f'<rect {S} x="28" y="78" width="144" height="98" rx="8" fill="{B}"/>'
     f'<g transform="rotate(-14 30 72)"><rect {S} x="30" y="44" width="144" height="28" rx="4" fill="{C}"/>'
     + ''.join(f'<path fill="{O}" d="M{x} 44H{x + 18}L{x + 6} 72H{x - 12}Z"/>' for x in (54, 90, 126, 162)) + '</g>'
     f'<path d="M44 106H120M44 130H104M44 154H112" stroke="{C}" stroke-width="8" stroke-linecap="round"/><circle {S} cx="148" cy="130" r="13" fill="{A}"/>'),
    ('fac_garage', '修車廠', 'a car front with a tow-truck beacon', 'SITES',
     f'<rect {S} x="84" y="36" width="32" height="16" rx="5" fill="{A}"/>'
     f'<rect x="32" y="150" width="30" height="28" rx="6" fill="{O}"/><rect x="138" y="150" width="30" height="28" rx="6" fill="{O}"/>'
     f'<path {S} fill="{B}" d="M36 110L56 62Q60 52 72 52H128Q140 52 144 62L164 110Q178 114 178 130V160H22V130Q22 114 36 110Z"/>'
     f'<path fill="{C}" d="M66 66H134L148 104H52Z"/><circle cx="50" cy="132" r="12" fill="{C}"/><circle cx="150" cy="132" r="12" fill="{C}"/>'
     f'<rect x="76" y="124" width="48" height="18" rx="4" fill="{O}"/>'),
    ('fac_shrine', '神社', 'a torii gate', 'SITES',
     f'<rect {S} x="48" y="58" width="22" height="124" fill="{B}"/><rect {S} x="130" y="58" width="22" height="124" fill="{B}"/>'
     f'<rect {S} x="34" y="84" width="132" height="16" fill="{B}"/>'
     f'<path {S} fill="{C}" d="M12 40Q100 56 188 40L182 66Q100 78 18 66Z"/>'
     f'<rect {S} x="89" y="66" width="22" height="26" rx="2" fill="{A}"/>'),
    ('fac_metro', '地鐵站', 'a subway train front on tracks', 'SITES',
     f'<path d="M40 186L64 160M160 186L136 160" stroke="{O}" stroke-width="10" stroke-linecap="round"/>'
     f'<rect {S} x="42" y="20" width="116" height="140" rx="28" fill="{C}"/><rect x="56" y="38" width="88" height="54" rx="10" fill="{B}"/>'
     f'<rect x="42" y="104" width="116" height="12" fill="{B}"/><circle cx="70" cy="136" r="10" fill="{A}"/><circle cx="130" cy="136" r="10" fill="{A}"/>'),
    ('fac_ferry', '渡輪碼頭', 'a small ferry boat on waves', 'SITES',
     f'<rect {S} x="112" y="34" width="24" height="40" rx="3" fill="{B}"/><path d="M72 30V70" stroke="{O}" stroke-width="5"/><path fill="{A}" d="M72 30L98 40L72 50Z"/>'
     f'<rect {S} x="48" y="68" width="100" height="46" rx="6" fill="{C}"/><rect x="60" y="80" width="18" height="16" rx="3" fill="{O}"/><rect x="88" y="80" width="18" height="16" rx="3" fill="{O}"/><rect x="116" y="80" width="18" height="16" rx="3" fill="{O}"/>'
     f'<path {S} fill="{B}" d="M16 112H184L158 158H42Z"/>'
     f'<path d="M24 178Q40 166 56 178T88 178T120 178T152 178T184 178" fill="none" stroke="{C}" stroke-width="7" stroke-linecap="round"/>'),
    ('fac_bus', '巴士站', 'a city bus seen from the side', 'SITES',
     f'<rect {S} x="14" y="50" width="172" height="96" rx="16" fill="{B}"/>'
     + ''.join(f'<rect x="{x}" y="66" width="28" height="30" rx="4" fill="{C}"/>' for x in (64, 100, 136))
     + f'<rect x="28" y="66" width="24" height="64" rx="4" fill="{O}"/><rect x="152" y="104" width="22" height="12" rx="3" fill="{A}"/>'
     f'<circle {S} cx="56" cy="150" r="17" fill="{C}"/><circle {S} cx="144" cy="150" r="17" fill="{C}"/>'),
    ('fac_under', '地下層入口', 'a stairway descending into an arched tunnel', 'SITES',
     f'<path {S} fill="{B}" d="M26 182V84Q26 34 100 34Q174 34 174 84V182Z"/><path fill="{O}" d="M48 182V88Q48 56 100 56Q152 56 152 88V182Z"/>'
     + ''.join(f'<rect x="{48 + k * 8}" y="{150 - k * 22 + 66}" width="{104 - k * 16}" height="12" fill="{C}"/>' for k in range(3))
     + f'<path fill="{A}" d="M88 72H112V100H126L100 126L74 100H88Z"/>'),
    ('fac_gate', '橋接區', 'a checkpoint booth with a boom barrier', 'SITES',
     f'<rect {S} x="66" y="100" width="118" height="18" rx="5" fill="{C}"/>'
     + ''.join(f'<rect x="{x}" y="100" width="12" height="18" fill="{B}"/>' for x in (92, 124, 156))
     + f'<rect {S} x="18" y="64" width="54" height="114" rx="6" fill="{B}"/><rect x="28" y="80" width="34" height="28" rx="3" fill="{C}"/>'
     f'<circle {S} cx="45" cy="50" r="10" fill="{A}"/><rect {S} x="164" y="114" width="12" height="64" fill="{B}"/>'),
]

GROUPS = [('基本功', BASICS), ('傷害類型', DAMAGE), ('設施', FACILITIES)]

# 街區設施的名字 → 設施圖標（gen_district_maps.py 用；先比對的先用）
FACILITY_KEYWORDS = [
    ('地鐵', 'fac_metro'), ('輕軌', 'fac_metro'), ('渡輪', 'fac_ferry'), ('接駁船', 'fac_ferry'), ('巴士', 'fac_bus'), ('計程車', 'fac_bus'),
    ('地下層入口', 'fac_under'), ('豎井', 'fac_under'), ('防空洞', 'fac_under'), ('入水點', 'fac_under'), ('檢修門', 'fac_under'), ('走私洞', 'fac_under'),
    ('迷宮', 'fac_under'), ('入口', 'fac_under'), ('排水道', 'fac_under'), ('隧道', 'fac_under'),
    ('冷庫', 'fac_coldstore'), ('帶子街', 'fac_tapes'), ('扭蛋', 'fac_gacha'), ('同人', 'fac_doujin'), ('家具', 'fac_furniture'),
    ('以物易物', 'fac_barter'), ('交易台', 'fac_barter'), ('交易棚', 'fac_barter'),
    ('黑市', 'fac_blackmarket'), ('洗錢', 'fac_blackmarket'), ('兌換', 'fac_blackmarket'), ('撈貨', 'fac_blackmarket'), ('當舖', 'fac_blackmarket'), ('收費站', 'fac_blackmarket'),
    ('拍賣', 'fac_blackmarket'),
    ('骨場', 'fac_scrapyard'), ('拾荒', 'fac_scrapyard'), ('殘骸', 'fac_scrapyard'), ('廢', 'fac_scrapyard'), ('磅秤', 'fac_scrapyard'), ('吊臂', 'fac_scrapyard'),
    ('垃圾', 'fac_scrapyard'), ('零件', 'fac_scrapyard'), ('沉沒', 'fac_scrapyard'), ('機櫃', 'fac_scrapyard'),
    ('藥局', 'fac_pharmacy'), ('診所', 'fac_clinic'), ('急救', 'fac_clinic'), ('療養院', 'fac_clinic'), ('安置', 'fac_clinic'),
    ('義體', 'fac_cybershop'), ('生體件', 'fac_cybershop'), ('獸耳', 'fac_cybershop'), ('機娘', 'fac_cybershop'), ('解鎖', 'fac_cybershop'),
    ('槍', 'fac_gunshop'), ('武器', 'fac_gunshop'), ('靶場', 'fac_gunshop'), ('軍品', 'fac_gunshop'),
    ('電器', 'fac_electro'), ('甲板', 'fac_electro'), ('無人機', 'fac_electro'), ('修理', 'fac_electro'), ('天線', 'fac_electro'), ('播音', 'fac_electro'),
    ('發電', 'fac_electro'), ('唱片', 'fac_electro'), ('舊網節點', 'fac_netcafe'), ('接入席', 'fac_netcafe'), ('光纖', 'fac_netcafe'),
    ('潛艙', 'fac_netcafe'), ('遊戲中心', 'fac_netcafe'), ('螢幕', 'fac_studio'), ('門', 'fac_gate'),
    ('服', 'fac_clothes'), ('精品', 'fac_clothes'), ('訂製', 'fac_clothes'), ('裁縫', 'fac_clothes'), ('洗衣', 'fac_clothes'), ('成人用品', 'fac_clothes'), ('周邊', 'fac_clothes'),
    ('原廠', 'fac_flagship'), ('企業', 'fac_flagship'), ('議事堂', 'fac_flagship'), ('領事', 'fac_flagship'), ('塔', 'fac_flagship'), ('球體', 'fac_flagship'),
    ('銀行', 'fac_flagship'), ('分社', 'fac_flagship'), ('本社', 'fac_flagship'), ('大廳', 'fac_flagship'), ('會所', 'fac_flagship'), ('俱樂部', 'fac_bar'),
    ('畫廊', 'fac_flagship'), ('奉公課', 'fac_flagship'), ('精煉廠', 'fac_flagship'), ('基地', 'fac_flagship'),
    ('片場', 'fac_studio'), ('棚', 'fac_studio'), ('工坊', 'fac_studio'), ('印刷', 'fac_studio'), ('握手會', 'fac_studio'), ('劇場', 'fac_studio'), ('劇院', 'fac_studio'),
    ('戲院', 'fac_studio'), ('表演場', 'fac_studio'), ('鏡廳', 'fac_studio'),
    ('擂台', 'fac_arena'), ('拳', 'fac_arena'), ('賭', 'fac_arena'), ('井', 'fac_arena'), ('摔角', 'fac_arena'), ('人偶', 'fac_arena'),
    ('車廠', 'fac_garage'), ('修車', 'fac_garage'), ('加油', 'fac_garage'), ('車庫', 'fac_garage'), ('停車', 'fac_garage'), ('卡車', 'fac_garage'), ('改裝', 'fac_garage'),
    ('修船', 'fac_ferry'), ('遊艇', 'fac_ferry'), ('船', 'fac_ferry'), ('碼頭', 'fac_ferry'), ('泊位', 'fac_ferry'), ('潛水', 'fac_ferry'), ('燈塔', 'fac_ferry'), ('海灘', 'fac_ferry'),
    ('神社', 'fac_shrine'), ('禮拜', 'fac_shrine'), ('教', 'fac_shrine'), ('神龕', 'fac_shrine'), ('聖堂', 'fac_shrine'), ('墓', 'fac_shrine'), ('獻花', 'fac_shrine'), ('寢區', 'fac_hotel'),
    ('酒', 'fac_bar'), ('過載', 'fac_bar'), ('半夢', 'fac_bar'), ('靜室', 'fac_bar'), ('糖罐', 'fac_bar'), ('彈殼', 'fac_bar'), ('案內所', 'fac_bar'), ('料亭', 'fac_bar'),
    ('拉客', 'fac_bar'), ('泳池', 'fac_bar'), ('香檳', 'fac_bar'), ('海棠樓', 'fac_bar'), ('夜市', 'fac_market'), ('白手套', 'fac_food'),
    ('旅館', 'fac_hotel'), ('旅社', 'fac_hotel'), ('旅舍', 'fac_hotel'), ('飯店', 'fac_hotel'), ('休息所', 'fac_hotel'), ('宿', 'fac_hotel'), ('繭', 'fac_hotel'), ('營地', 'fac_hotel'),
    ('安全屋', 'fac_home'), ('單位', 'fac_home'), ('住', 'fac_home'), ('別墅', 'fac_home'), ('鐵皮屋', 'fac_home'), ('樓長', 'fac_home'), ('隔壁', 'fac_home'), ('棚', 'fac_home'),
    ('麵', 'fac_food'), ('食', 'fac_food'), ('餐', 'fac_food'), ('茶', 'fac_food'), ('咖啡', 'fac_food'), ('和菓子', 'fac_food'), ('菜園', 'fac_food'), ('糰糧', 'fac_food'),
    ('桃子屋', 'fac_conv'), ('雜貨', 'fac_conv'), ('販賣機', 'fac_conv'), ('超商', 'fac_conv'), ('二手', 'fac_market'), ('攤', 'fac_market'), ('市', 'fac_market'),
    ('店', 'fac_conv'), ('澡堂', 'fac_home'), ('浴', 'fac_home'), ('崗', 'fac_gate'), ('哨', 'fac_gate'), ('閘', 'fac_gate'), ('巡', 'fac_gate'), ('站', 'fac_gate'),
]


def facility_icon(name):
    for k, v in FACILITY_KEYWORDS:
        if k in name:
            return v
    return None
