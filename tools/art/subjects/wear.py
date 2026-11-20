"""第 3 層：穿著、飾品與成人道具類主體（手繪 SVG，200×200 座標）。
成人道具一律只畫物件本身（繩、銬、鈴、香水瓶…），會露骨的一律用愛心禮盒之類的抽象主體。"""
import math

S = 'class="s"'
B, C, A, O = 'fill="var(--b)"', 'fill="var(--c)"', 'fill="var(--a)"', 'fill="var(--o)"'
SEAM = 'fill="none" stroke="var(--o)" stroke-linecap="round" stroke-linejoin="round"'


def heart(cx, cy, s, fill, cls=True):
    """以 (cx, cy) 為中心、寬約 1.4s 的愛心。"""
    pts = [(0, .9), (-.6, .45), (-.75, .1), (-.65, -.2), (-.5, -.6), (-.15, -.5), (-.03, -.45), (0, -.3),
           (.03, -.45), (.15, -.5), (.5, -.6), (.65, -.2), (.75, .1), (.6, .45), (0, .9)]
    p = [f'{cx + x * s:.1f} {cy + y * s:.1f}' for x, y in pts]
    d = f'M{p[0]}C{p[1]} {p[2]} {p[3]}Q{p[4]} {p[5]}Q{p[6]} {p[7]}Q{p[8]} {p[9]}Q{p[10]} {p[11]}C{p[12]} {p[13]} {p[14]}Z'
    return f'<path {S if cls else ""} {fill} d="{d}"/>'


def bow(cx, cy, s, loops=C, knot=A):
    """蝴蝶結：兩個環＋中間的結。"""
    return (f'<path {S} {loops} d="M{cx} {cy}L{cx - s} {cy - .7 * s}Q{cx - 1.25 * s} {cy} {cx - s} {cy + .7 * s}Z'
            f'M{cx} {cy}L{cx + s} {cy - .7 * s}Q{cx + 1.25 * s} {cy} {cx + s} {cy + .7 * s}Z"/>'
            f'<circle {S} cx="{cx}" cy="{cy}" r="{.32 * s:.1f}" {knot}/>')


def cord(d, w, col='var(--b)'):
    """有縫的粗線：先畫一條較寬的 --o，再畫顏色。"""
    return (f'<path fill="none" stroke="var(--o)" stroke-width="{w + 10}" stroke-linecap="round" stroke-linejoin="round" d="{d}"/>'
            f'<path fill="none" stroke="{col}" stroke-width="{w}" stroke-linecap="round" stroke-linejoin="round" d="{d}"/>')


def scallops(x0, x1, y, r, fill=C):
    n = max(2, round((x1 - x0) / (2 * r)))
    step = (x1 - x0) / n
    return ''.join(f'<circle {S} cx="{x0 + step * (i + .5):.1f}" cy="{y}" r="{r}" {fill}/>' for i in range(n))


def _beads(f, n, r, fill):
    return ''.join(f'<circle {S} cx="{f(i / (n - 1))[0]:.1f}" cy="{f(i / (n - 1))[1]:.1f}" r="{r}" {fill}/>' for i in range(n))


def _quad(p0, p1, p2):
    return lambda t: ((1 - t) ** 2 * p0[0] + 2 * (1 - t) * t * p1[0] + t * t * p2[0], (1 - t) ** 2 * p0[1] + 2 * (1 - t) * t * p1[1] + t * t * p2[1])


def _tentacle():
    """往上長、頂端捲成漩渦的章魚腳：沿中線取點，寬度漸細，做成一個填色多邊形；吸盤沿內側。"""
    pts = []
    for i in range(20):  # 根部往上的一段
        t = i / 20
        pts.append((118 + 14 * math.sin(t * 2.4), 180 - 100 * t))
    cx, cy = 94, 72
    for i in range(61):  # 漩渦：從右邊開始逆時針往內捲
        t = i / 60
        th = -2 * math.pi * 1.15 * t
        r = 34 * (1 - t) + 7 * t
        pts.append((cx + r * math.cos(th) * 1.0 + (1 - t) * (pts[19][0] - cx - 34) * 0, cy + r * math.sin(th)))
    n = len(pts) - 1
    left, right, cups = [], [], []
    for i, (x, y) in enumerate(pts):
        a, b = pts[min(i + 1, n)], pts[max(i - 1, 0)]
        dx, dy = a[0] - b[0], a[1] - b[1]
        L = math.hypot(dx, dy) or 1
        nx, ny = -dy / L, dx / L
        w = 20 * (1 - i / n) + 5
        left.append((x + nx * w, y + ny * w))
        right.append((x - nx * w, y - ny * w))
        if i % 8 == 3 and i < 64:
            cups.append((x + nx * w * .5, y + ny * w * .5, 2.5 + 5 * (1 - i / n)))
    poly = 'M' + 'L'.join(f'{x:.1f} {y:.1f}' for x, y in left + right[::-1]) + 'Z'
    body = f'<path {S} {B} d="{poly}"/>'
    body += ''.join(f'<circle cx="{x:.1f}" cy="{y:.1f}" r="{r:.1f}" {C} stroke="var(--o)" stroke-width="2.5"/>' for x, y, r in cups)
    return body


def _coil():
    """一捲繩：三圈同心，加麻花紋。"""
    out = ''
    for r in (58, 40, 22):
        out += cord(f'M{100 - r} 96A{r} {r} 0 1 1 {100 + r} 96A{r} {r} 0 1 1 {100 - r} 96', 14, 'var(--b)')
    for r in (58, 40, 22):
        out += f'<circle cx="100" cy="96" r="{r}" fill="none" stroke="var(--c)" stroke-width="4" stroke-dasharray="5 9" transform="rotate(10 100 96)"/>'
    return out


def _chain_links(f, n, w=12):
    out = ''
    for i in range(n):
        t = i / (n - 1)
        x, y = f(t)
        x2, y2 = f(min(1, t + .01))
        ang = math.degrees(math.atan2(y2 - y, x2 - x))
        if i % 2:
            out += f'<rect {S} x="{x - 4:.1f}" y="{y - 3:.1f}" width="8" height="6" rx="3" {C} transform="rotate({ang:.0f} {x:.1f} {y:.1f})"/>'
        else:
            out += f'<ellipse cx="{x:.1f}" cy="{y:.1f}" rx="{w / 2 + 3}" ry="8" fill="none" stroke="var(--o)" stroke-width="13" transform="rotate({ang:.0f} {x:.1f} {y:.1f})"/>' \
                   f'<ellipse cx="{x:.1f}" cy="{y:.1f}" rx="{w / 2 + 3}" ry="8" fill="none" stroke="var(--c)" stroke-width="6" transform="rotate({ang:.0f} {x:.1f} {y:.1f})"/>'
    return out


_NECK = _quad((34, 40), (100, 170), (166, 40))
_WAIST = _quad((24, 60), (100, 150), (176, 60))

SUBJECTS = {
    # ---------------- 衣服 ----------------
    # 泡泡袖短上衣，領口一顆小愛心
    'a top': (
        f'<ellipse {S} cx="54" cy="70" rx="28" ry="24" {B}/><ellipse {S} cx="146" cy="70" rx="28" ry="24" {B}/>'
        f'<path {S} {B} d="M66 44L86 36Q100 54 114 36L134 44V146Q100 156 66 146Z"/>'
        f'<path {S} {C} d="M84 36Q100 62 116 36L124 40Q100 76 76 40Z"/>'
        f'<rect {S} x="40" y="86" width="28" height="12" rx="6" {C}/><rect {S} x="132" y="86" width="28" height="12" rx="6" {C}/>'
        + heart(100, 104, 16, A)),
    # 工裝褲：兩條褲管、側口袋、腰帶扣
    'trousers': (
        f'<path {S} {B} d="M56 28H144L156 174H114L100 84L86 174H44Z"/>'
        f'<rect {S} x="54" y="26" width="92" height="18" rx="3" {C}/>'
        f'<rect {S} x="40" y="102" width="26" height="30" rx="4" {C}/><rect {S} x="134" y="102" width="26" height="30" rx="4" {C}/>'
        f'<path {SEAM} stroke-width="5" d="M100 44V84M72 44Q74 62 60 66M128 44Q126 62 140 66"/>'
        f'<rect x="90" y="30" width="20" height="10" rx="3" {A}/>'),
    # 百褶裙：腰頭、褶線、小蝴蝶結
    'a skirt': (
        f'<path {S} {B} d="M62 52H138L172 150Q100 166 28 150Z"/>'
        f'<path {SEAM} stroke-width="5" d="M84 66L66 154M100 66V160M116 66L134 154M70 66L44 148M130 66L156 148"/>'
        f'<rect {S} x="58" y="40" width="84" height="20" rx="4" {C}/>'
        + bow(124, 50, 13, C, A)),
    # 女僕裝：連身裙＋荷葉邊白圍裙＋領結
    'a maid uniform': (
        f'<path {S} {B} d="M72 30L100 42L128 30L140 40L132 94L170 156Q100 178 30 156L68 94L60 40Z"/>'
        f'<path {S} {C} d="M76 96H124L146 154Q100 166 54 154Z"/>'
        + scallops(54, 146, 158, 7)
        + f'<path {S} {C} d="M84 56H116V96H84Z"/>'
        f'<path {SEAM} stroke-width="5" d="M70 96H130"/>'
        + bow(100, 40, 14, C, A)),
    # 瑪莉珍鞋：圓頭、一條扣帶、厚鞋底
    'shoes': (
        f'<path {S} {C} d="M24 146H180Q180 162 164 162H70V180H40L34 162Q24 160 24 146Z"/>'
        f'<path {S} {B} d="M28 148Q20 92 54 88L124 98Q178 108 178 148Z"/>'
        f'<path {O} d="M58 96Q74 118 100 116Q118 114 124 104Z"/>'
        f'<rect {S} x="80" y="84" width="16" height="44" rx="7" {C} transform="rotate(-20 88 106)"/>'
        f'<circle {S} cx="92" cy="122" r="7" {A}/>'),
    # 手套：荷葉邊袖口、手背一顆愛心
    'gloves': (
        f'<path {S} {B} d="M60 140V96Q58 84 68 82V54Q68 44 78 44Q88 44 88 54V80V42Q88 32 98 32Q108 32 108 42V80V46Q108 36 118 36Q128 36 128 46V88V68Q130 56 140 58Q150 60 148 72L144 126Q140 144 128 148Z"/>'
        + scallops(52, 148, 150, 10)
        + f'<rect {S} x="56" y="134" width="88" height="16" rx="6" {C}/>'
        + heart(104, 104, 18, A)),
    # 棒球帽：側面，帽簷往右，帽頂一顆釦
    'a cap': (
        f'<path {S} {C} d="M98 124Q150 112 182 128Q186 142 168 142H98Z"/>'
        f'<path {S} {B} d="M22 132Q22 58 84 58Q140 58 140 132Z"/>'
        f'<path {SEAM} stroke-width="5" d="M82 62Q64 92 62 130M86 62Q104 92 108 130"/>'
        f'<rect {S} x="20" y="124" width="122" height="14" rx="5" {C}/>'
        f'<circle {S} cx="84" cy="56" r="8" {A}/>'),
    # 過膝襪：蕾絲襪口、後縫線、小蝴蝶結
    'stockings': (
        f'<path {S} {B} d="M62 42H122L118 120Q118 138 130 146L158 154Q176 160 174 172Q172 180 158 180H84Q70 180 70 164Z"/>'
        + scallops(60, 124, 56, 8)
        + f'<rect {S} x="56" y="28" width="72" height="24" rx="4" {C}/>'
        f'<path {SEAM} stroke-width="4" d="M82 70L86 168"/>'
        + bow(92, 40, 12, C, A)),
    # 飛行夾克：羅紋下襬與袖口、拉鍊、臂章
    'a jacket': (
        f'<path {S} {B} d="M68 34L100 44L132 34L162 50L176 144H152L146 94V156H54V94L48 144H24L38 50Z"/>'
        f'<rect {S} x="20" y="140" width="34" height="18" rx="5" {C}/><rect {S} x="146" y="140" width="34" height="18" rx="5" {C}/>'
        f'<rect {S} x="52" y="150" width="96" height="22" rx="5" {C}/>'
        f'<path {S} {C} d="M68 34L100 60L132 34L124 26L100 44L76 26Z"/>'
        f'<path {SEAM} stroke-width="5" d="M100 60V150"/>'
        f'<rect {S} x="116" y="78" width="20" height="16" rx="4" {A}/>'),
    # 背心：細肩帶、圓領、羅紋下襬
    'a vest top': (
        f'<path {S} {B} d="M64 28H80Q84 64 100 66Q116 64 120 28H136Q136 62 152 78V164H48V78Q64 62 64 28Z"/>'
        f'<rect {S} x="46" y="152" width="108" height="20" rx="4" {C}/>'
        f'<path {SEAM} stroke-width="4" d="M66 158V166M82 158V166M98 158V166M114 158V166M130 158V166"/>'
        + heart(100, 104, 18, A)),
    # 戰術背心：三個彈匣袋、胸前魔鬼氈
    'a tactical vest': (
        f'<path {S} {B} d="M56 26H80Q84 54 100 54Q116 54 120 26H144L154 62V172H46V62Z"/>'
        f'<rect {S} x="56" y="110" width="26" height="46" rx="5" {C}/><rect {S} x="87" y="110" width="26" height="46" rx="5" {C}/><rect {S} x="118" y="110" width="26" height="46" rx="5" {C}/>'
        f'<path {SEAM} stroke-width="5" d="M56 124H82M87 124H113M118 124H144"/>'
        f'<rect {S} x="80" y="72" width="40" height="22" rx="4" {C}/>'
        f'<rect x="90" y="78" width="20" height="10" rx="3" {A}/>'),
    # 戰鬥靴：高筒、交叉鞋帶、厚底
    'boots': (
        f'<path {S} {B} d="M60 26H114V118L152 132Q174 140 174 156V160H40V138L60 116Z"/>'
        f'<rect {S} x="36" y="152" width="142" height="24" rx="6" {C}/>'
        f'<path {SEAM} stroke-width="4" d="M44 164H170"/>'
        f'<path fill="none" stroke="var(--c)" stroke-width="6" stroke-linecap="round" d="M74 50L104 66M104 50L74 66M74 74L104 90M104 74L74 90M74 98L104 114M104 98L74 114"/>'
        f'<rect {S} x="56" y="22" width="62" height="16" rx="4" {C}/>'
        f'<rect {S} x="114" y="26" width="10" height="22" rx="4" {A}/>'),
    # 工作連身服：腰帶、胸袋、拉鍊
    'a one-piece outfit': (
        f'<path {S} {B} d="M66 24L100 34L134 24L158 50L144 72L138 66V100L144 176H108L100 120L92 176H56L62 100V66L56 72L42 50Z"/>'
        f'<path {S} {C} d="M66 24L100 46L134 24L126 18L100 34L74 18Z"/>'
        f'<path {SEAM} stroke-width="5" d="M100 46V98"/>'
        f'<rect {S} x="110" y="58" width="20" height="20" rx="3" {C}/>'
        f'<rect {S} x="58" y="94" width="84" height="16" rx="4" {C}/>'
        f'<rect x="92" y="96" width="16" height="12" rx="3" {A}/>'),
    # 旗袍：立領、斜襟、盤扣、開衩
    'a qipao dress': (
        f'<path {S} {B} d="M76 32H124L146 44L140 70L130 64Q128 92 140 120L150 178H50L60 120Q72 92 70 64L60 70L54 44Z"/>'
        f'<rect {S} x="78" y="20" width="44" height="16" rx="5" {C}/>'
        f'<path {SEAM} stroke-width="5" d="M100 36Q112 56 132 60M136 178L126 136"/>'
        f'<path fill="none" stroke="var(--c)" stroke-width="5" stroke-linecap="round" d="M72 150Q80 138 92 146M80 160Q90 150 100 158"/>'
        f'<circle {S} cx="116" cy="52" r="7" {A}/>'),
    # 洋裝：細肩帶、兩層荷葉裙、腰間蝴蝶結
    'a dress': (
        f'<path {SEAM} stroke-width="14" d="M78 38L74 22M122 38L126 22"/><path fill="none" stroke="var(--b)" stroke-width="6" stroke-linecap="round" d="M78 38L74 22M122 38L126 22"/>'
        f'<path {S} {C} d="M44 132H156L176 172Q100 184 24 172Z"/>'
        f'<path {S} {B} d="M70 92H130L158 140Q100 152 42 140Z"/>'
        f'<path {S} {B} d="M72 36Q86 46 100 36Q114 46 128 36L130 94H70Z"/>'
        f'<path {SEAM} stroke-width="4" d="M86 104L76 140M114 104L124 140M100 104V144"/>'
        + bow(100, 94, 15, C, A)),
    # 襯衫：尖領、門襟與鈕扣、袖口、小領結
    'a shirt': (
        f'<path {S} {B} d="M70 28L100 40L130 28L160 42L176 140L154 146L144 92V172H56V92L46 146L24 140L40 42Z"/>'
        f'<rect {S} x="20" y="134" width="32" height="16" rx="4" {C} transform="rotate(-10 36 142)"/><rect {S} x="148" y="134" width="32" height="16" rx="4" {C} transform="rotate(10 164 142)"/>'
        f'<path {SEAM} stroke-width="5" d="M100 44V172"/>'
        + ''.join(f'<circle cx="108" cy="{y}" r="4" {C}/>' for y in (78, 106, 134, 158))
        + f'<path {S} {C} d="M70 28L100 42L84 64Z"/><path {S} {C} d="M130 28L100 42L116 64Z"/>'
        + bow(100, 44, 12, A, C)),
    # 立領制服：肩章、雙排扣、胸前徽章
    'a uniform': (
        f'<path {S} {B} d="M64 34H136L164 48L174 150H152L144 96V172H56V96L48 150H26L36 48Z"/>'
        f'<rect {S} x="78" y="22" width="44" height="18" rx="4" {C}/>'
        f'<rect {S} x="34" y="40" width="34" height="14" rx="6" {C}/><rect {S} x="132" y="40" width="34" height="14" rx="6" {C}/>'
        f'<path {SEAM} stroke-width="5" d="M100 40V172M56 150H144"/>'
        + ''.join(f'<circle {S} cx="{x}" cy="{y}" r="5" {C}/>' for x in (86, 114) for y in (66, 94, 122))
        + f'<path {S} {A} d="M134 70L140 78L134 86L128 78Z"/>'),
    # 風衣：大翻領、腰帶與扣環、長下襬
    'a trench coat': (
        f'<path {S} {B} d="M68 22L100 34L132 22L162 40L172 132H150L146 100L160 178H40L54 100L50 132H28L38 40Z"/>'
        f'<path {S} {C} d="M68 22L86 72L100 82L114 72L132 22L120 18L100 58L80 18Z"/>'
        f'<path {SEAM} stroke-width="5" d="M108 82V178"/>'
        + ''.join(f'<circle cx="{x}" cy="{y}" r="4" {O}/>' for x in (88, 126) for y in (90, 130, 152))
        + f'<rect {S} x="48" y="104" width="104" height="14" rx="3" {C}/>'
        f'<path {S} {C} d="M118 116L126 150L118 152L112 118Z"/>'
        f'<rect x="114" y="102" width="16" height="18" rx="3" fill="none" stroke="var(--a)" stroke-width="5"/>'),
    # 長大衣：毛毛高領、筆直到底、一顆大釦
    'a long coat': (
        f'<path {S} {B} d="M64 40H136L162 54L170 140H148L144 96L154 180H46L56 96L52 140H30L38 54Z"/>'
        + ''.join(f'<circle {S} cx="{x}" cy="{y}" r="13" {C}/>' for x, y in ((64, 44), (80, 36), (100, 34), (120, 36), (136, 44)))
        + f'<path {SEAM} stroke-width="5" d="M100 52V180M64 124H86M114 124H136"/>'
        f'<circle {S} cx="112" cy="82" r="7" {A}/>'),
    # 頭盔：帶貓耳的全罩頭盔、大面罩、側燈
    'a helmet': (
        f'<path {S} {B} d="M46 74L54 30L84 54Z"/><path {S} {B} d="M154 74L146 30L116 54Z"/>'
        f'<path {S} {B} d="M38 132Q34 50 100 46Q166 50 162 132Q162 156 140 156H60Q38 156 38 132Z"/>'
        f'<path {S} {C} d="M50 92Q100 76 150 92V118Q100 134 50 118Z"/>'
        f'<path fill="none" stroke="var(--b)" stroke-width="6" stroke-linecap="round" d="M66 98L80 94M66 112L96 104"/>'
        f'<circle {S} cx="150" cy="140" r="7" {A}/>'),
    # 狐狸面具：大耳、斜眼、頰上紋
    'a mask': (
        f'<path {S} {C} d="M50 28L80 66H120L150 28L162 96Q158 150 100 174Q42 150 38 96Z"/>'
        f'<path {B} d="M56 44L72 64H62ZM144 44L128 64H138Z"/>'
        f'<path {O} d="M60 98Q74 86 90 100Q74 104 60 98ZM140 98Q126 86 110 100Q126 104 140 98Z"/>'
        f'<path fill="none" stroke="var(--b)" stroke-width="6" stroke-linecap="round" d="M52 120L70 124M56 134L72 132M148 120L130 124M144 134L128 132"/>'
        f'<circle cx="100" cy="146" r="7" {A}/>'),
    # 發光口罩：耳掛、褶、LED 笑臉
    'a face mask': (
        f'<path {SEAM} stroke-width="16" d="M44 80Q22 82 24 104Q26 124 50 120M156 80Q178 82 176 104Q174 124 150 120"/>'
        f'<path fill="none" stroke="var(--c)" stroke-width="7" stroke-linecap="round" d="M44 80Q22 82 24 104Q26 124 50 120M156 80Q178 82 176 104Q174 124 150 120"/>'
        f'<path {S} {B} d="M42 72Q100 56 158 72Q162 124 100 146Q38 124 42 72Z"/>'
        f'<path {SEAM} stroke-width="4" d="M52 86Q100 76 148 86M54 124Q100 136 146 124"/>'
        f'<path fill="none" stroke="var(--a)" stroke-width="7" stroke-linecap="round" d="M80 100Q100 118 120 100"/>'),
    # 圓眼鏡：兩個圓框、鼻橋、反光
    'glasses': (
        cord('M22 90H34M166 90H178', 8)
        + cord('M88 96Q100 84 112 96', 8)
        + f'<circle {S} cx="60" cy="102" r="38" {B}/><circle {S} cx="140" cy="102" r="38" {B}/>'
        f'<circle cx="60" cy="102" r="27" {C}/><circle cx="140" cy="102" r="27" {C}/>'
        f'<path fill="none" stroke="var(--b)" stroke-width="5" stroke-linecap="round" d="M46 96L58 84M126 96L138 84"/>'
        f'<circle cx="160" cy="76" r="5" {A}/>'),
    # 面紗：頭飾帶＋垂下的蕾絲紗，一朵小花
    'a veil': (
        f'<path {S} {C} d="M42 62Q100 40 158 62L172 160Q154 172 136 160Q118 172 100 160Q82 172 64 160Q46 172 28 160Z"/>'
        + ''.join(f'<circle cx="{x}" cy="{y}" r="3.2" {B}/>' for y in (86, 110, 134) for x in range(52 + (12 if y == 110 else 0), 152, 24))
        + cord('M38 62Q100 36 162 62', 10)
        + ''.join(f'<circle {S} cx="{70 + 9 * math.cos(math.radians(a)):.1f}" cy="{50 + 9 * math.sin(math.radians(a)):.1f}" r="7" {C}/>' for a in range(0, 360, 72))
        + f'<circle cx="70" cy="50" r="6" {A}/>'),
    # 胸罩：花邊上緣、肩帶、中間小蝴蝶結
    'a bra': (
        f'<path {SEAM} stroke-width="14" d="M44 78L58 32M156 78L142 32"/><path fill="none" stroke="var(--c)" stroke-width="6" stroke-linecap="round" d="M44 78L58 32M156 78L142 32"/>'
        f'<path {S} {B} d="M26 80Q62 60 98 98Q100 132 66 136Q28 132 26 80Z"/><path {S} {B} d="M174 80Q138 60 102 98Q100 132 134 136Q172 132 174 80Z"/>'
        + ''.join(f'<circle {S} cx="{x}" cy="{y}" r="6" {C}/>' for x, y in ((34, 76), (50, 72), (66, 74), (82, 82), (166, 76), (150, 72), (134, 74), (118, 82)))
        + f'<path {SEAM} stroke-width="4" d="M40 110Q62 120 86 108M160 110Q138 120 114 108"/>'
        + bow(100, 100, 12, C, A)),
    # 內褲：荷葉邊褲頭、兩側綁帶、正面小愛心
    'panties': (
        f'<path {S} {B} d="M32 62H168Q160 104 128 122L114 152H86L72 122Q40 104 32 62Z"/>'
        + scallops(40, 160, 62, 8)
        + bow(30, 68, 14, C, C) + bow(170, 68, 14, C, C)
        + heart(100, 92, 16, A)),
    # 戒指：粗戒圈＋愛心寶石與爪座
    'a ring': (
        cord('M54 122A46 46 0 1 0 146 122A46 46 0 1 0 54 122', 14)
        + f'<path {S} {C} d="M80 78H120L112 90H88Z"/>'
        + heart(100, 58, 34, A)
        + f'<path fill="none" stroke="var(--c)" stroke-width="5" stroke-linecap="round" d="M68 150Q100 172 132 150"/>'),
    # 皮項圈：寬皮帶、鉚釘、O 環、愛心吊牌
    'a choker collar': (
        f'<path {S} {B} d="M26 70Q100 116 174 70V100Q100 146 26 100Z"/>'
        + ''.join(f'<circle cx="{x}" cy="{70 + 46 * (1 - ((x - 100) / 74) ** 2) * 1 + 15:.1f}" r="5" {C}/>' for x in (44, 66, 134, 156))
        + cord('M88 124A12 12 0 1 0 112 124A12 12 0 1 0 88 124', 6, 'var(--c)')
        + heart(100, 158, 30, A)),
    # 細頸鍊：絲絨細帶、蕾絲邊、正面一個蝴蝶結
    'a choker': (
        cord('M26 78Q100 132 174 78', 12)
        + ''.join(f'<circle {S} cx="{_quad((26, 86), (100, 140), (174, 86))(t)[0]:.1f}" cy="{_quad((26, 86), (100, 140), (174, 86))(t)[1] + 6:.1f}" r="6" {C}/>' for t in (.12, .26, .4, .6, .74, .88))
        + bow(100, 112, 22, C, A)
        + f'<path {S} {C} d="M94 118L84 152L96 146ZM106 118L116 152L104 146Z"/>'),
    # 項鍊：串珠鍊、水滴墜子
    'a necklace': (
        f'<path {SEAM} stroke-width="8" d="M34 40Q100 170 166 40"/>'
        + _beads(_NECK, 13, 7, C)
        + f'<path {S} {C} d="M92 110H108L104 120H96Z"/>'
        f'<path {S} {B} d="M100 118Q128 148 116 164Q100 178 84 164Q72 148 100 118Z"/>'
        f'<circle cx="100" cy="152" r="7" {A}/>'),
    # 手環：手鐲＋兩個吊飾（星星、愛心）
    'a bracelet': (
        cord('M34 86A66 32 0 1 0 166 86A66 32 0 1 0 34 86', 16)
        + f'<path {SEAM} stroke-width="8" d="M78 116V132M122 116V132"/>'
        + f'<path {S} {C} d="M78 128l7 13 14 2-10 10 2 14-13-7-13 7 2-14-10-10 14-2z"/>'
        + heart(122, 146, 30, A)),
    # 腿環：荷葉邊的吊襪環、正面蝴蝶結
    'a thigh garter': (
        ''.join(f'<circle {S} cx="{100 + 76 * math.cos(math.radians(a)):.1f}" cy="{100 + 38 * math.sin(math.radians(a)):.1f}" r="11" {C}/>' for a in range(0, 360, 30))
        + f'<ellipse {S} cx="100" cy="100" rx="70" ry="34" {B}/>'
        f'<ellipse cx="100" cy="96" rx="50" ry="20" {O}/>'
        f'<path fill="none" stroke="var(--c)" stroke-width="4" stroke-dasharray="6 6" d="M34 108Q100 146 166 108"/>'
        + bow(100, 136, 20, C, A)),
    # 胸針：花邊橢圓框、浮雕、兩條緞帶尾
    'a brooch': (
        f'<path {S} {B} d="M84 120L64 178L82 166L96 178L100 124Z"/><path {S} {B} d="M116 120L136 178L118 166L104 178L100 124Z"/>'
        + ''.join(f'<circle {S} cx="{100 + 50 * math.cos(math.radians(a)):.1f}" cy="{86 + 58 * math.sin(math.radians(a)):.1f}" r="10" {C}/>' for a in range(0, 360, 30))
        + f'<ellipse {S} cx="100" cy="86" rx="48" ry="56" {C}/>'
        f'<ellipse {S} cx="100" cy="86" rx="34" ry="42" {B}/>'
        + heart(100, 88, 34, A)),
    # 簪：長簪、梅花、垂珠
    'a hair ornament': (
        cord('M48 168L136 60', 8, 'var(--c)')
        + f'<path {SEAM} stroke-width="4" d="M120 92V146M138 98V130"/>'
        + f'<circle {S} cx="120" cy="150" r="7" {C}/><circle {S} cx="138" cy="134" r="7" {C}/>'
        + ''.join(f'<circle {S} cx="{132 + 22 * math.cos(math.radians(a)):.1f}" cy="{58 + 22 * math.sin(math.radians(a)):.1f}" r="16" {B}/>' for a in range(-90, 270, 72))
        + f'<circle {S} cx="132" cy="58" r="11" {A}/>'),
    # 耳環：一對不對稱的垂墜（月亮、愛心）
    'earrings': (
        f'<path {SEAM} stroke-width="12" d="M58 30Q76 30 76 46V62M138 30Q156 30 156 46V62"/>'
        f'<path fill="none" stroke="var(--c)" stroke-width="5" stroke-linecap="round" d="M58 30Q76 30 76 46V62M138 30Q156 30 156 46V62"/>'
        f'<circle {S} cx="76" cy="72" r="9" {C}/><circle {S} cx="144" cy="72" r="9" {C}/>'
        f'<path {S} {B} d="M84 96A36 36 0 1 0 98 150A28 28 0 1 1 84 96Z" transform="translate(-14 0)"/>'
        f'<path {SEAM} stroke-width="8" d="M144 82V100"/>'
        + heart(144, 132, 48, A)),
    # 腰鏈：一圈細鏈、中央三條垂墜
    'a waist chain': (
        _chain_links(_WAIST, 13, 18)
        + cord('M82 102V128M100 106V142M118 102V128', 4, 'var(--c)')
        + f'<circle {S} cx="82" cy="134" r="7" {C}/><circle {S} cx="118" cy="134" r="7" {C}/>'
        + f'<path {S} {A} d="M100 140L110 156L100 172L90 156Z"/>'),
    # 和服：寬袖、交領、腰帶與帶締
    'a kimono': (
        f'<path {S} {B} d="M70 24L100 36L130 24L178 40V110H146V178H54V110H22V40Z"/>'
        f'<path {SEAM} stroke-width="5" d="M54 40V110M146 40V110"/>'
        f'<path {S} {C} d="M70 24L104 96L130 24L120 20L100 66L80 20Z"/>'
        f'<path fill="none" stroke="var(--c)" stroke-width="5" stroke-linecap="round" d="M66 150Q74 140 84 148M118 160Q128 150 136 158"/>'
        f'<rect {S} x="52" y="90" width="96" height="30" rx="3" {C}/>'
        f'<path stroke="var(--a)" stroke-width="6" stroke-linecap="round" d="M56 105H144"/>'),
    # 泳裝：連身、細肩帶、裙襬荷葉、一顆星
    'a swimsuit': (
        f'<path {S} {B} d="M68 26H82Q86 58 100 60Q114 58 118 26H132Q132 62 148 80Q140 112 146 130Q122 132 110 152H90Q78 132 54 130Q60 112 52 80Q68 62 68 26Z"/>'
        + scallops(46, 154, 134, 9)
        + f'<path {SEAM} stroke-width="5" d="M56 98Q100 116 144 98"/>'
        f'<path {S} {A} d="M100 70l5 10 11 2-8 8 2 11-10-5-10 5 2-11-8-8 11-2z"/>'),
    # 兜帽：貓耳連帽、帽繩
    'a hood': (
        f'<path {S} {B} d="M44 82L42 26L82 50Z"/><path {S} {B} d="M156 82L158 26L118 50Z"/>'
        f'<path {S} {B} d="M100 34Q172 38 168 116Q164 168 100 172Q36 168 32 116Q28 38 100 34Z"/>'
        f'<ellipse {S} cx="100" cy="112" rx="48" ry="52" {C}/>'
        f'<ellipse cx="100" cy="114" rx="36" ry="42" {O}/>'
        + cord('M84 160V184', 5, 'var(--c)') + cord('M116 160V178', 5, 'var(--c)')
        + f'<rect x="112" y="174" width="8" height="12" rx="3" {A}/>'),
    # 披肩：三角形、翻邊、流蘇、別針
    'a shawl': (
        f'<path {S} {B} d="M22 54Q100 84 178 54L100 172Z"/>'
        f'<path fill="none" stroke="var(--c)" stroke-width="4" stroke-linecap="round" d="'
        + ''.join(f'M{100 + (x - 100) * t:.1f} {172 - (172 - (54 + 30 * (1 - ((x - 100) / 78) ** 2))) * t:.1f}l{-6 if x < 100 else 6} 10' for x in (22, 178) for t in (.15, .3, .45, .6, .75, .9)) + '"/>'
        + f'<path {S} {C} d="M22 54Q100 84 178 54L170 70Q100 100 30 70Z"/>'
        f'<path fill="none" stroke="var(--c)" stroke-width="5" stroke-linecap="round" d="M84 118Q100 104 116 118Q100 132 84 118Z"/>'
        f'<circle {S} cx="100" cy="82" r="8" {A}/>'),
    # 愛心禮盒：盒蓋、緞帶、大蝴蝶結
    'a heart-shaped gift box with a ribbon': (
        heart(100, 108, 88, B)
        + f'<path {S} {B} d="M30 104Q26 68 50 58Q74 48 92 62L100 72L108 62Q126 48 150 58Q174 68 170 104Q100 122 30 104Z"/>'
        f'<path {S} {C} d="M38 122Q100 140 162 122L156 138Q100 156 44 138Z"/>'
        f'<path fill="none" stroke="var(--c)" stroke-width="6" stroke-linecap="round" d="M44 88Q46 74 58 70"/>'
        + bow(100, 56, 28, C, A)),
    # 愛心鎖：愛心鎖身、鎖扣、鑰匙孔
    'a heart-shaped lock': (
        cord('M70 90V64Q70 34 100 34Q130 34 130 64V90', 14, 'var(--c)')
        + heart(100, 112, 86, B)
        + f'<circle cx="100" cy="110" r="11" {O}/><path {O} d="M95 112H105L108 136H92Z"/>'
        f'<circle cx="140" cy="96" r="6" {A}/>'),

    # ---------------- 成人道具（只畫物件，不露骨） ----------------
    # 一捲絲繩，掛一個流蘇
    'a silk rope': (
        _coil()
        + cord('M156 96Q172 120 160 140', 8)
        + f'<path {S} {C} d="M148 146H172L178 182H142Z"/>'
        f'<path {SEAM} stroke-width="3" d="M152 156L150 180M160 156V180M168 156L170 180"/>'
        f'<circle {S} cx="160" cy="144" r="8" {A}/>'),
    # 一對軟墊手銬，中間一小段鏈子
    'padded cuffs': (
        cord('M24 100A34 40 0 1 0 92 100A34 40 0 1 0 24 100', 20)
        + cord('M108 100A34 40 0 1 0 176 100A34 40 0 1 0 108 100', 20)
        + f'<path fill="none" stroke="var(--c)" stroke-width="5" stroke-dasharray="4 7" d="M24 100A34 40 0 1 0 92 100A34 40 0 1 0 24 100M108 100A34 40 0 1 0 176 100A34 40 0 1 0 108 100"/>'
        + f'<rect {S} x="88" y="92" width="24" height="16" rx="8" {C}/>'
        + heart(100, 136, 26, A)
        + f'<path {SEAM} stroke-width="4" d="M100 108V124"/>'),
    # 一捲膠帶，拉出一截鋸齒尾
    'a tape roll': (
        f'<path {S} {C} d="M132 132L170 152L160 172L150 162L142 170L134 160L126 166L104 150Z"/>'
        f'<circle {S} cx="92" cy="94" r="62" {B}/>'
        f'<circle {S} cx="92" cy="94" r="30" {C}/><circle cx="92" cy="94" r="18" {O}/>'
        f'<path fill="none" stroke="var(--c)" stroke-width="4" d="M92 42A52 52 0 0 1 144 94"/>'
        + heart(56, 132, 18, A, False)),
    # 項圈連牽繩：左上一圈項圈，牽繩彎到右下的手把
    'a collar with leash': (
        cord('M74 104Q90 160 130 150Q160 142 160 170', 8, 'var(--c)')
        + cord('M148 170A12 10 0 1 0 172 170A12 10 0 1 0 148 170', 8, 'var(--c)')
        + cord('M28 70A46 30 0 1 0 120 70A46 30 0 1 0 28 70', 18)
        + ''.join(f'<circle cx="{74 + 46 * math.cos(math.radians(a)):.1f}" cy="{70 + 30 * math.sin(math.radians(a)):.1f}" r="4" {C}/>' for a in (30, 60, 120, 150))
        + heart(74, 120, 24, A)),
    # 鈴鐺：貓鈴、中央環帶、上方蝴蝶結
    'a jingle bell': (
        f'<circle {S} cx="100" cy="112" r="58" {B}/>'
        f'<path {S} {C} d="M42 104Q100 120 158 104V118Q100 134 42 118Z"/>'
        f'<circle cx="100" cy="146" r="10" {O}/><path {SEAM} stroke-width="7" d="M100 150V168"/>'
        f'<path fill="none" stroke="var(--c)" stroke-width="6" stroke-linecap="round" d="M66 76Q74 66 86 64"/>'
        + bow(100, 48, 26, C, A)),
    # 眼罩：閉著的眼睛圖案、鬆緊帶
    'a blindfold': (
        cord('M24 96H40M160 96H176', 8, 'var(--c)')
        + f'<path {S} {B} d="M36 78Q100 54 164 78Q174 120 140 132Q118 136 100 120Q82 136 60 132Q26 120 36 78Z"/>'
        f'<path fill="none" stroke="var(--c)" stroke-width="6" stroke-linecap="round" d="M52 98Q66 110 82 98M118 98Q134 110 148 98M58 104L54 112M67 107V116M76 104L80 112M124 104L120 112M133 107V116M142 104L146 112"/>'
        + heart(100, 88, 16, A)),
    # 貓耳耳機
    'headphones': (
        f'<path {S} {B} d="M54 66L52 28L80 48Z"/><path {S} {B} d="M146 66L148 28L120 48Z"/>'
        + cord('M44 120V100Q44 40 100 40Q156 40 156 100V120', 14)
        + f'<rect {S} x="26" y="104" width="44" height="64" rx="18" {B}/><rect {S} x="130" y="104" width="44" height="64" rx="18" {B}/>'
        f'<rect {S} x="58" y="112" width="16" height="48" rx="8" {C}/><rect {S} x="126" y="112" width="16" height="48" rx="8" {C}/>'
        f'<circle cx="44" cy="136" r="7" {A}/>'),
    # 電極貼片：愛心貼片、中央扣、電線接到小盒
    'an electrode patch': (
        cord('M96 116Q100 160 140 150', 6)
        + f'<rect {S} x="132" y="134" width="40" height="34" rx="8" {B}/><rect x="140" y="142" width="16" height="6" rx="3" {C}/>'
        + heart(84, 86, 96, C)
        + f'<circle {S} cx="84" cy="86" r="16" {B}/><circle cx="84" cy="86" r="6" {C}/>'
        + f'<path {A} d="M164 40L146 66H158L150 88L172 58H160Z"/>'),
    # 遙控器：大愛心鈕、兩顆小鈕、訊號波
    'a remote control with heart': (
        f'<rect {S} x="58" y="52" width="72" height="124" rx="30" {B}/>'
        + heart(94, 100, 44, A)
        + f'<circle {S} cx="80" cy="144" r="8" {C}/><circle {S} cx="108" cy="144" r="8" {C}/>'
        + cord('M138 48Q150 60 138 72M152 34Q174 60 152 86', 6, 'var(--c)')),
    # 貓尾巴：彎彎的毛尾、尾尖亮色、根部蝴蝶結
    'a cat tail': (
        cord('M64 172Q44 128 86 112Q138 94 132 56Q126 30 98 34', 26)
        + f'<path fill="none" stroke="var(--c)" stroke-width="26" stroke-linecap="round" d="M114 34Q106 32 98 34"/>'
        f'<path fill="none" stroke="var(--c)" stroke-width="5" stroke-linecap="round" d="M62 128Q72 120 74 112M104 102Q114 100 116 90M126 74Q134 70 138 62"/>'
        + bow(64, 164, 22, C, A)),
    # 小鳥籠：圓頂、欄杆、底座、門上愛心鎖
    'a birdcage': (
        cord('M100 22V34', 6, 'var(--c)') + cord('M92 18A8 8 0 1 0 108 18', 5, 'var(--c)')
        + cord('M44 156V96Q44 36 100 36Q156 36 156 96V156', 8)
        + cord('M72 156V60M100 156V36M128 156V60', 6)
        + cord('M44 96H156', 6)
        + f'<rect {S} x="34" y="150" width="132" height="22" rx="6" {C}/>'
        + heart(114, 126, 28, A)),
    # 香水瓶：圓瓶、液面、噴嘴與氣囊
    'a perfume bottle': (
        cord('M108 54Q130 40 148 54', 5, 'var(--c)')
        + f'<ellipse {S} cx="160" cy="66" rx="16" ry="20" {B}/>'
        f'<rect {S} x="84" y="44" width="32" height="22" rx="5" {B}/><rect {S} x="90" y="62" width="20" height="16" {C}/>'
        f'<path {S} {C} d="M60 84H140Q164 84 164 124Q164 176 100 176Q36 176 36 124Q36 84 60 84Z"/>'
        f'<path {B} d="M40 128Q100 112 160 128Q158 170 100 170Q42 170 40 128Z"/>'
        f'<path fill="none" stroke="var(--b)" stroke-width="6" stroke-linecap="round" d="M56 100Q50 108 50 118"/>'
        + heart(100, 146, 22, A)),
    # 噴霧罐：罐身、蓋子、噴出的霧點
    'a spray can': (
        f'<rect {S} x="58" y="66" width="70" height="112" rx="12" {B}/>'
        f'<path {S} {C} d="M64 66Q66 46 93 46Q120 46 122 66Z"/><rect {S} x="84" y="30" width="18" height="18" rx="3" {C}/>'
        f'<rect {S} x="58" y="104" width="70" height="34" {C}/>'
        + heart(93, 121, 22, A)
        + ''.join(f'<circle cx="{x}" cy="{y}" r="{r}" {C} stroke="var(--o)" stroke-width="3"/>' for x, y, r in ((122, 34, 6), (142, 26, 5), (140, 46, 7), (162, 36, 5), (160, 58, 6)))),
    # 軟膏罐：扁圓罐、蓋子、標籤
    'an ointment jar': (
        f'<path {S} {B} d="M36 96H164V154Q164 172 146 172H54Q36 172 36 154Z"/>'
        f'<ellipse {S} cx="100" cy="96" rx="64" ry="12" {B}/>'
        f'<path {S} {C} d="M40 62Q40 50 56 50H144Q160 50 160 62V84Q160 92 144 92H56Q40 92 40 84Z"/>'
        f'<path {SEAM} stroke-width="4" d="M52 66H148"/>'
        f'<rect {S} x="62" y="114" width="76" height="40" rx="8" {C}/>'
        + heart(100, 134, 24, A)
        + f'<path {C} d="M140 22Q152 38 146 44Q140 48 134 44Q128 38 140 22Z" stroke="var(--o)" stroke-width="4"/>'),
    # 捲捲的觸手、吸盤、根部小蝴蝶結
    'a curly tentacle': _tentacle() + bow(118, 168, 18, C, A),
    # 骰子：等角的骰、點是小圓、上面一個愛心
    'a heart die': (
        f'<path {S} {C} d="M100 28L168 64L100 100L32 64Z"/>'
        f'<path {S} {B} d="M32 64L100 100V176L32 140Z"/><path {S} {B} d="M168 64L100 100V176L168 140Z"/>'
        f'<path fill="none" stroke="var(--o)" stroke-width="6" d="M100 100V176"/>'
        + heart(100, 64, 34, A, False)
        + ''.join(f'<circle cx="{x}" cy="{y}" r="7" {O}/>' for x, y in ((52, 96), (80, 142), (66, 119), (122, 100), (148, 88), (122, 148), (148, 136)))),
    # 麥克風：網罩頭、握把、燈環
    'a microphone': (
        f'<g transform="rotate(30 100 100)">'
        f'<path {S} {B} d="M84 96H116L110 176Q100 184 90 176Z"/>'
        f'<rect {S} x="80" y="88" width="40" height="14" rx="4" {C}/>'
        f'<circle {S} cx="100" cy="60" r="38" {C}/>'
        f'<path fill="none" stroke="var(--b)" stroke-width="4" d="M66 50H134M64 66H136M80 26V94M100 22V98M120 26V94"/>'
        f'<rect x="86" y="120" width="28" height="8" rx="4" {A}/></g>'),
    # 補光燈環與小鏡頭：大圓環、中間鏡頭、錄影點
    'a camera lens': (
        cord('M100 160V180M76 182H124', 8)
        + cord('M38 92A62 62 0 1 0 162 92A62 62 0 1 0 38 92', 20, 'var(--c)')
        + f'<rect {S} x="70" y="66" width="60" height="52" rx="12" {B}/>'
        f'<circle {S} cx="100" cy="92" r="18" {C}/><circle cx="100" cy="92" r="9" {O}/>'
        f'<circle cx="122" cy="76" r="5" {A}/>'),
    # 馬鞭：細長桿、握把、愛心皮拍頭
    'a riding crop': (
        cord('M52 160L144 52', 8)
        + cord('M40 172L66 144', 18, 'var(--c)')
        + cord('M34 166Q18 188 44 180', 5, 'var(--c)')
        + f'<path {SEAM} stroke-width="4" d="M50 150L58 158M58 142L66 150"/>'
        + f'<g transform="rotate(40 152 42)">{heart(152, 42, 40, A)}</g>'),
    # 愛心拍：愛心板面、心形洞、握把與腕繩
    'a heart paddle': (
        cord('M64 150L36 178', 22, 'var(--b)')
        + cord('M36 178Q14 188 22 166', 5, 'var(--c)')
        + f'<g transform="rotate(-45 112 90)">{heart(112, 86, 106, C)}</g>'
        + heart(96, 92, 22, O, False) + heart(128, 76, 22, O, False) + heart(126, 110, 22, O, False)
        + f'<circle {S} cx="68" cy="146" r="7" {A}/>'),
    # 低溫蠟燭：柱狀蠟燭、頂上流蠟、火焰、小燭台
    'a candle': (
        f'<path {S} {C} d="M40 156H160Q160 176 100 176Q40 176 40 156Z"/>'
        f'<rect {S} x="66" y="76" width="68" height="84" rx="6" {B}/>'
        f'<path {S} {C} d="M66 82Q66 74 74 74H126Q134 74 134 82V92Q130 102 126 92Q122 112 116 92Q110 100 104 92H90Q84 118 78 92Q72 100 66 92Z"/>'
        f'<path {SEAM} stroke-width="5" d="M100 74V62"/>'
        f'<path {S} {A} d="M100 24Q120 44 116 56Q110 66 100 66Q90 66 84 56Q80 44 100 24Z"/>'),
    # AR 眼鏡：一片式鏡片、HUD 線、鏡頭小點
    'AR glasses': (
        cord('M24 90H34M166 90H176', 8)
        + f'<path {S} {B} d="M26 80Q100 64 174 80V108Q166 132 128 128L100 112L72 128Q34 132 26 108Z"/>'
        f'<path {C} d="M40 88Q100 76 160 88V106Q154 120 128 118L100 102L72 118Q46 120 40 106Z"/>'
        f'<path fill="none" stroke="var(--b)" stroke-width="4" stroke-linecap="round" d="M52 98H74M52 106H66M126 96L140 96L146 104M136 108H148"/>'
        f'<circle cx="100" cy="86" r="5" {A}/>'),
    # 印章：圓鈕把手、印身、地上一個愛心印
    'a stamp seal': (
        f'<path {S} {C} d="M26 160L94 150L118 176L46 186Z"/>'
        + f'<g transform="rotate(-8 74 168)">{heart(74, 166, 26, A, False)}</g>'
        + f'<circle {S} cx="128" cy="38" r="20" {C}/>'
        f'<path {S} {B} d="M114 52H142L150 92H106Z"/>'
        f'<rect {S} x="96" y="88" width="64" height="40" rx="8" {B}/>'
        f'<rect {S} x="92" y="124" width="72" height="18" rx="4" {C}/>'),
    # 衣架與一件小洋裝、閃光
    'a clothes hanger': (
        cord('M100 46V34Q100 22 112 22Q122 22 122 32', 6, 'var(--c)')
        + f'<path {S} {B} d="M74 60L100 50L126 60L132 96L170 168Q100 182 30 168L68 96Z"/>'
        f'<path {SEAM} stroke-width="5" d="M70 100H130"/>'
        + cord('M28 72L100 46L172 72Z', 8, 'var(--c)')
        + bow(100, 100, 14, C, A)
        + f'<path {C} stroke="var(--o)" stroke-width="3" d="M156 104Q158 114 168 116Q158 118 156 128Q154 118 144 116Q154 114 156 104Z"/>'),
    # 圍裙：荷葉邊、綁帶、愛心口袋
    'a frilly apron': (
        cord('M70 32Q100 18 130 32', 7, 'var(--c)')
        + cord('M62 94Q34 92 26 112M138 94Q166 92 174 112', 7, 'var(--c)')
        + ''.join(f'<circle {S} cx="{x}" cy="{y}" r="9" {C}/>' for x, y in ((58, 104), (52, 122), (46, 140), (42, 158), (142, 104), (148, 122), (154, 140), (158, 158)))
        + scallops(44, 156, 170, 9)
        + f'<path {S} {B} d="M70 34H130V92L152 166Q100 178 48 166L70 92Z"/>'
        f'<path {SEAM} stroke-width="5" d="M66 94H134"/>'
        + heart(100, 128, 34, A)),
    # 聽診器：Y 形管、耳件、愛心聽頭
    'a stethoscope': (
        cord('M60 30Q52 70 82 92M140 30Q148 70 118 92M82 92Q100 104 118 92M100 100V128Q100 162 132 162', 8)
        + f'<circle {S} cx="60" cy="28" r="8" {C}/><circle {S} cx="140" cy="28" r="8" {C}/>'
        + f'<circle {S} cx="144" cy="150" r="26" {C}/>'
        + heart(144, 151, 26, A)),
}


# ---------------- 物品 → 主體 ----------------
ITEM_SUBJECT = {
    # 7.3 一、束具
    '千代結（麻繩）': 'a silk rope', '蝴蝶結（緞帶手銬）': 'padded cuffs', '黏黏（拘束膠帶）': 'a tape roll',
    '步鍊（腳鐐）': 'padded cuffs', '密碼鎖': 'a heart-shaped lock', '磁鎖手銬': 'padded cuffs',
    '蛇（記憶繩）': 'a silk rope', '紅線（龜甲繩衣）': 'a silk rope', '拘束套組（磁吸環）': 'padded cuffs',
    '真空繭（拘束衣）': 'a heart-shaped gift box with a ribbon', '月吊（吊縛架）': 'a silk rope',
    # 二、項圈與牽繩
    '乖孩子（項圈）': 'a choker collar', '散步（牽繩）': 'a collar with leash', '搖鈴（主人鈴）': 'a jingle bell',
    '光繩（全息牽繩）': 'a collar with leash', '回家（定位項圈）': 'a choker collar', '聽話（訓練項圈）': 'a choker collar',
    '名牌（項圈與牽繩）': 'a collar with leash', '誠實（吐真項圈）': 'a choker collar',
    # 三、口與眼
    '晚安（眼罩）': 'a blindfold', '無聲（降噪耳塞）': 'headphones', '咬咬（口球）': 'a heart-shaped gift box with a ribbon',
    '小貓舌（舌套）': 'a heart-shaped gift box with a ribbon', '黑幕（全息眼罩）': 'a blindfold',
    'O（口環）': 'a heart-shaped gift box with a ribbon', '靜音（智慧口塞）': 'a face mask',
    '只給你聽（骨傳導耳機）': 'headphones', '零（感官隔離頭套）': 'a hood',
    # 四、夾與貼片
    '小螃蟹（乳夾）': 'a heart-shaped gift box with a ribbon', '叮叮噹（鈴鐺乳夾）': 'a jingle bell',
    '牽線（乳鏈夾）': 'a heart-shaped gift box with a ribbon', '啾啾（吸吮器）': 'a heart-shaped gift box with a ribbon',
    '麻麻（電流貼片）': 'an electrode patch', '穿孔鎖鏈': 'a heart-shaped lock', '放大鏡（感官晶片貼）': 'an electrode patch',
    # 五、震動與遙控
    '小蜜蜂（跳蛋）': 'a remote control with heart', '電子愛撫（脈衝貼）': 'an electrode patch',
    '脈衝環': 'a remote control with heart', '大魔王（魔杖按摩器）': 'a heart-shaped gift box with a ribbon',
    '一起（情侶震動器）': 'a remote control with heart', '十指（觸感手套）': 'gloves', '出門散步（跳蛋內褲）': 'panties',
    '推推（打賞連動按摩棒）': 'a remote control with heart', '雷鳴（按摩棒）': 'a heart-shaped gift box with a ribbon',
    '回饋（神經刺激環）': 'a remote control with heart', '遠距戀愛（遙控玩具）': 'a remote control with heart',
    '過載（超頻按摩棒）': 'a heart-shaped gift box with a ribbon',
    # 六、插入：一律抽象
    '標準型（智慧假陽具）': 'a heart-shaped gift box with a ribbon', '寶石（肛塞）': 'a heart-shaped gift box with a ribbon',
    '抱抱杯（套具）': 'a heart-shaped gift box with a ribbon', '連珠（拉珠）': 'a heart-shaped gift box with a ribbon',
    '借你一根（穿戴式）': 'a heart-shaped gift box with a ribbon', '插槽（義體接頭）': 'a heart-shaped gift box with a ribbon',
    '打樁（抽插機）': 'a heart-shaped gift box with a ribbon', '量身（智慧套具）': 'a heart-shaped gift box with a ribbon',
    # 七、尾與獸化
    '喵尾（尾巴塞）': 'a cat tail', '真心話（肌電尾巴）': 'a cat tail', '變身濾鏡（全息獸化）': 'a cat tail', '活尾（生體尾巴）': 'a cat tail',
    # 八、貞操
    '小鳥籠（一次性貞操具）': 'a birdcage', '鎖具': 'a heart-shaped lock', '封印（貞操胸罩）': 'a heart-shaped lock',
    '差一點（寸止環）': 'a heart-shaped gift box with a ribbon', '倒數（智慧貞操帶）': 'a heart-shaped lock', '樂園（鎖具）': 'a heart-shaped lock',
    # 九、換裝
    '一夜限定（換裝包）': 'a clothes hanger', '新婚（裸體圍裙）': 'a frilly apron', 'Cosplay 列印': 'a clothes hanger',
    '心音（聽診器）': 'a stethoscope', '閃亮亮（玩具變身手環）': 'a bracelet', '快速換裝（全息衣櫥）': 'a clothes hanger',
    '皮（虛擬主播面罩）': 'a mask', '第二層皮膚（噴塗乳膠）': 'a spray can',
    # 十、香氛與藥
    '初戀（草莓香霧）': 'a perfume bottle', '甜夜（香氛噴霧）': 'a perfume bottle', '回頭（費洛蒙香水）': 'a perfume bottle',
    '敏敏（感度軟膏）': 'an ointment jar', '晚香玉（香氛噴霧）': 'a perfume bottle', '粉紅泡泡（吸入式感官擴增）': 'a spray can',
    '斷片（迷香）': 'a candle', '暖流（按摩油）': 'an ointment jar', '延長賽（口香糖）': 'a heart-shaped gift box with a ribbon',
    '冰火（雙效潤滑）': 'an ointment jar',
    # 十一、觸手
    '八爪（觸手手套）': 'a curly tentacle', '章魚燒（觸手玩具）': 'a curly tentacle', 'Q 彈（觸手凝膠）': 'an ointment jar',
    '藤蔓（活觸手）': 'a curly tentacle', '八岐（機械觸手背包）': 'a curly tentacle', '黏土（變形外皮）': 'an ointment jar',
    '女王蔓（觸手缸）': 'a curly tentacle',
    # 十二、多人與遊戲
    '今晚誰（遊戲骰）': 'a heart die', '分享（雙頭龍）': 'a heart-shaped gift box with a ribbon',
    '大家的聲音（群播耳機）': 'headphones', '連線（感官共享網）': 'an electrode patch',
    # 十三、記錄與直播
    '耳邊（麥克風）': 'a microphone', '小眼睛（針孔）': 'a camera lens', '兩人份（鏡頭）': 'a camera lens',
    '第三者（AR 觀眾眼鏡）': 'AR glasses', '開播中（直播燈環）': 'a camera lens', '感覺記錄器（感官帶貼片）': 'an electrode patch',
    '給他看（私訊直播）': 'a camera lens', '四面八方（環景鏡頭）': 'a camera lens',
    # 十四、痛與標記
    '戒尺': 'a heart paddle', '啪啪（愛心皮拍）': 'a heart paddle', '低溫（蠟燭）': 'a candle', '九尾（智慧鞭）': 'a riding crop',
    '朱印（口紅）': 'a stamp seal', '署名（光敏刺青筆）': 'a stamp seal', '所有物（皮下刻印）': 'a stamp seal',

    # 7.1／3.3 服裝：原本對到不合適主體的
    '長外套 再版': 'a long coat', '長外套 增補版': 'a long coat',
    '防彈衣 M1': 'a tactical vest', '防彈衣 M2': 'a tactical vest', '防彈衣 M3': 'a tactical vest',
    '貼身防彈內襯-200': 'a vest top', '貼身防彈內襯-300': 'a vest top',
    '防彈皮背心 再版': 'a tactical vest', '防彈皮背心 增補版': 'a tactical vest',
    '戰術背心 M2': 'a tactical vest', '戰術背心 M3': 'a tactical vest', '獵兵背心 M3': 'a tactical vest', '獵兵背心 M4': 'a tactical vest',
    '荒地斗篷・街': 'a shawl', '荒地斗篷・巷': 'a shawl',
    '企業套裝-200': 'a shirt', '企業套裝-300': 'a shirt', '裝甲西裝-300': 'a shirt', '裝甲西裝-400': 'a shirt',
    '執事燕尾服・五分咲': 'a jacket', '執事燕尾服・滿開': 'a jacket',
    '高訂禮服・高訂': 'a dress', '高訂禮服・孤品': 'a dress', '打歌服・三分咲': 'a dress', '打歌服・五分咲': 'a dress',
    '護士服-100': 'a uniform', '護士服-200': 'a uniform', '修女服・領班': 'a dress',
    '巫女裝束・師傅作': 'a kimono', '巫女裝束・名匠作': 'a kimono',
    '天上天下・親衛': 'a trench coat', '天上天下・總長': 'a trench coat',
    '投影面罩「皮」 goodnight': 'a mask', '投影面罩「皮」 midnight': 'a mask',
    '戲服 Take 2': 'a dress', '戲服 Take 3': 'a dress',
    '白百合頭飾': 'a hair ornament', '天狐兜帽': 'a hood', '貓耳耳機': 'headphones', '零號乳膠頭套': 'a hood',
    'Miss 七月牛角髮箍': 'a hair ornament', '兔耳髮箍・蜜': 'a hair ornament', '稻荷狐面': 'a mask',
    '濾毒半罩': 'a face mask', '皮・goodnight': 'a mask', '蕾絲眼紗': 'a veil', '乖孩子嘴套': 'a face mask', '巷口連帽T': 'a hood',
    '天上天下頭帶': 'a hair ornament', '料理長廚師服': 'a shirt', '雲錦短襦': 'a kimono', '開台露肩針織衫': 'a top',
    '乳牛比基尼上衣': 'a bra', '乳牛比基尼下著': 'panties', '請入座乳膠束衣': 'a vest top',
    '二十丹黑褲襪': 'stockings', '開襠亮面褲襪': 'stockings',
    '天使白護士服': 'a uniform', '天使白護理師服': 'a uniform', '晚禱修女服': 'a dress', '師傅作巫女裝束': 'a kimono',
    '香檳亮片晚禮服': 'a dress', '敞胸牛郎西裝': 'a shirt', '夜宴哥德羅莉塔': 'a dress', '一番星打歌服': 'a dress',
    '一番星打歌服・王子': 'a uniform', '灰西裝三件式': 'a shirt', '放學後體育服': 'a top', '緋夜祭浴衣': 'a kimono',
    '午夜藍斜肩禮服': 'a dress', '黑絲絨晚禮服': 'a dress', 'Ａ子駕駛員戰鬥服': 'a one-piece outfit',
    '零七乳膠緊身衣': 'a one-piece outfit', '開襠發光緊身衣': 'a one-piece outfit', '桃子吉祥物玩偶裝': 'a one-piece outfit',
    '下一位改造護士服': 'a uniform', '神父不在乳膠修女服': 'a dress', '本台金鍊微比基尼': 'a swimsuit',
    '愛與正義改造魔法少女服': 'a dress', '頭版星形打歌服': 'a dress', '桃子屋裸體圍裙': 'a frilly apron',
    '晚安活絲睡裙': 'a dress', '白百合長裙女僕服・男娘': 'a maid uniform',
    '霓虹透明雨衣': 'a trench coat', '孤星 MA-1': 'a jacket', '紫電特攻服': 'a trench coat', '長途防砂斗篷': 'a shawl',
    '櫻吹雪羽織': 'a kimono', '聖銀騎士披風': 'a shawl',
    '特攻纏胸布': 'a bra', '荷花肚兜': 'a bra', '白襦袢': 'a kimono', '亞麻束胸': 'a bra', '蕾絲吊帶襯衣': 'a vest top',
    '千代結龜甲縛': 'a silk rope', '乳鈴細繩胸罩': 'a bra', '蝴蝶結網紗短睡衣': 'a dress', '六尺褌': 'panties',
    '白足袋': 'stockings', '帆布綁腿': 'stockings',
    '螢光字平口褲': 'panties', '桃子條紋內褲': 'panties', '夜宴蕾絲內褲': 'panties', '無痕內褲': 'panties',
    '都可以蕾絲內褲': 'panties', '黑色安全褲': 'panties', '軍綠平角褲': 'panties', '荷葉邊燈籠襯褲': 'panties',
    '立繪印花內褲': 'panties', '緞面丁字褲': 'panties', '開襠蕾絲內褲': 'panties', '珍珠丁字褲': 'panties',
    '發光透明內褲': 'panties', '一拉就開細繩褲': 'panties', '網紗囊袋丁字褲': 'panties', '蝴蝶鏤空內褲': 'panties',
    '白鼻緒草履': 'shoes', '鐵片雪駄': 'shoes', '嗷肉球爪套': 'gloves',
}
