"""第 3 層：武器與器具類主體（手繪 SVG，200×200 座標）。"""

S = 'class="s"'
B, C, A, O = 'fill="var(--b)"', 'fill="var(--c)"', 'fill="var(--a)"', 'fill="var(--o)"'
SEAM = 'fill="none" stroke="var(--o)" stroke-linecap="round"'


def rot(deg, body):
    return f'<g transform="rotate({deg} 100 100)">{body}</g>'


def _spiral():
    import math
    pts = []
    for i in range(0, 241):
        t = i / 240 * 2.6 * 2 * math.pi
        r = 14 + 17.5 * t / (2 * math.pi)
        pts.append(f'{100 + r * math.cos(t):.1f} {90 + r * math.sin(t):.1f}')
    return 'M' + 'L'.join(pts)


_SPIRAL = _spiral()

SUBJECTS = {
    # 傳統步槍：木托、長槍管、槍栓
    'a rifle': rot(-30,
        f'<path {S} {B} d="M118 92H188V100H118Z"/>'
        f'<path {S} {C} d="M12 98L64 90H124V108H84L74 116H62L20 122Q10 122 12 110Z"/>'
        f'<path {S} {B} d="M84 108H150V114Q150 118 146 118H90Z"/>'
        f'<path {S} {B} d="M74 116Q72 132 86 134" fill="none"/>'
        f'<path {SEAM} stroke-width="5" d="M40 98L48 118"/>'
        f'<rect {S} x="94" y="78" width="10" height="12" rx="3" {B}/>'
        f'<circle cx="99" cy="78" r="6" {A}/>'),
    # 突擊步槍：提把、香蕉彈匣、短托
    'an assault rifle': (
        f'<path {S} {B} d="M140 94H182V102H140Z"/>'
        f'<rect {S} x="176" y="88" width="10" height="20" rx="2" {C}/>'
        f'<path {S} {B} d="M18 92H50L58 100H146V112H58L52 120H24Q16 120 16 112Z"/>'
        f'<path {S} {C} d="M50 84H140V112H50Z"/>'
        f'<path {S} {B} d="M68 70H118V78L112 84H74L68 78Z"/>'
        f'<path {S} {B} d="M96 112H118Q122 136 132 152L112 160Q100 140 96 112Z"/>'
        f'<path {S} {B} d="M62 112H80L74 142H58Z"/>'
        f'<path {SEAM} stroke-width="4" d="M26 106H44"/>'
        f'<rect x="120" y="92" width="14" height="8" rx="2" {A}/>'),
    # 狙擊槍：極長細槍管、大瞄準鏡、腳架
    'a sniper rifle': rot(-30,
        f'<path {S} {B} d="M120 96H196V102H120Z"/>'
        f'<rect {S} x="188" y="92" width="10" height="14" rx="2" {B}/>'
        f'<path {S} {B} d="M6 94L30 92L44 100H126V110H70L64 120L18 124Q6 124 6 112Z"/>'
        f'<path {S} {C} d="M52 72Q52 66 58 66H112Q118 66 118 72V80Q118 86 112 86H58Q52 86 52 80Z"/>'
        f'<path {S} {C} d="M44 70H54V82H44Z"/>'
        f'<path {S} {C} d="M116 68H128V84H116Z"/>'
        f'<path {S} {B} d="M74 86H92V100H74Z"/>'
        f'<path fill="none" stroke="var(--o)" stroke-width="12" stroke-linecap="round" d="M140 102L128 132M140 102L154 130"/>'
        f'<path fill="none" stroke="var(--b)" stroke-width="5" stroke-linecap="round" d="M140 102L128 132M140 102L154 130"/>'
        f'<circle cx="122" cy="76" r="5" {A}/>'),
    # 霰彈槍：雙管、泵動護木
    'a shotgun': rot(-30,
        f'<path {S} {B} d="M96 82H180V93H96Z"/>'
        f'<path {S} {B} d="M96 95H180V106H96Z"/>'
        f'<circle cx="176" cy="87" r="3" {O}/><circle cx="176" cy="100" r="3" {O}/>'
        f'<path {S} {C} d="M8 98L56 88H100V108H70L60 120L18 128Q8 128 8 116Z"/>'
        f'<rect {S} x="112" y="102" width="50" height="20" rx="6" {C}/>'
        f'<path {SEAM} stroke-width="4" d="M124 106V118M134 106V118M144 106V118M154 106V118"/>'
        f'<path {S} {B} d="M70 108Q68 124 82 126" fill="none"/>'
                f'<rect x="76" y="94" width="14" height="8" rx="3" {A}/>'),
    # 衝鋒槍：短胖、彈匣在握把前、折疊托
    'a compact submachine gun': (
        f'<path {S} {B} d="M132 86H168V100H132Z"/>'
        f'<path {S} {C} d="M40 72H140V108H40Z"/>'
        f'<path {S} {B} d="M54 108H82L76 156Q76 162 70 162H56Q50 162 50 156Z"/>'
        f'<path {S} {B} d="M96 108H120V170H96Z"/>'
        f'<path fill="none" stroke="var(--o)" stroke-width="16" stroke-linejoin="round" d="M40 80H24V106H40"/>'
        f'<path fill="none" stroke="var(--b)" stroke-width="7" stroke-linejoin="round" d="M40 80H24V106H40"/>'
        f'<path {SEAM} stroke-width="4" d="M104 124H112M104 136H112M104 148H112"/>'
        f'<path {SEAM} stroke-width="5" d="M52 88H90"/>'
        f'<rect x="118" y="80" width="14" height="8" rx="3" {A}/>'),
    # 重機槍：粗散熱套、彈鏈、三腳架
    'a heavy machine gun': (
        f'<path fill="none" stroke="var(--o)" stroke-width="14" stroke-linecap="round" d="M84 116L64 166M84 116L112 166"/>'
        f'<path fill="none" stroke="var(--b)" stroke-width="6" stroke-linecap="round" d="M84 116L64 166M84 116L112 166"/>'
        f'<rect {S} x="96" y="76" width="70" height="26" rx="6" {B}/>'
        f'<path {S} {C} d="M162 82H184V96H162Z"/>'
        f'<path {S} {C} d="M24 70H100V116H24Z"/>'
        f'<path {S} {B} d="M24 116H40V130H24Z"/>'
        f'<circle cx="110" cy="89" r="5" {O}/><circle cx="128" cy="89" r="5" {O}/><circle cx="146" cy="89" r="5" {O}/>'
        f'<path {S} {B} d="M48 116H74L70 140H52Z"/>'
        f'<path {SEAM} stroke-width="4" d="M54 124H68M54 132H66"/>'
        f'<rect x="34" y="80" width="18" height="8" rx="3" {A}/>'),
    # 手槍：滑套、握把、扳機護弓
    'a handgun': (
        f'<path {S} {B} d="M64 104H104L112 120Q112 126 106 126H90L96 162Q98 170 90 170H70Q62 170 62 162Z"/>'
        f'<path {S} {C} d="M40 62Q40 54 48 54H160Q168 54 168 62V96Q168 104 160 104H48Q40 104 40 96Z"/>'
        f'<path {SEAM} stroke-width="5" d="M56 68V90M68 68V90M80 68V90"/>'
        f'<path {S} {B} d="M156 46H164V54H156Z"/>'
        f'<path {SEAM} stroke-width="5" d="M96 106Q100 120 112 120"/>'
        f'<rect x="104" y="74" width="40" height="10" rx="5" {A}/>'),
    # 感官飛鏢槍：圓胖槍身＋前端插著尾翼飛鏢
    'a sensory dart pistol': (
        f'<path {S} {B} d="M60 104H92L102 122H86L90 160Q92 168 84 168H66Q58 168 58 160Z"/>'
        f'<path {S} {C} d="M30 82Q30 60 52 60H114Q128 60 128 74V92Q128 104 114 104H52Q30 104 30 82Z"/>'
        f'<rect {S} x="128" y="74" width="16" height="16" rx="3" {B}/>'
        f'<path {S} {B} d="M144 78H166L180 82L166 86H144Z"/>'
        f'<path {S} {C} d="M144 70L156 78H144Z"/>'
        f'<path {S} {C} d="M144 94L156 86H144Z"/>'
        f'<circle cx="64" cy="82" r="10" {O}/><circle cx="64" cy="82" r="5" {A}/>'
        f'<path {SEAM} stroke-width="4" d="M86 72H112"/>'),
    # 電擊棍：棍身＋前端電極叉＋閃電
    'a stun baton': rot(45,
        f'<rect {S} x="88" y="98" width="24" height="76" rx="8" {B}/>'
        f'<path {SEAM} stroke-width="4" d="M90 140H110M90 152H110M90 164H110"/>'
        f'<path {S} {C} d="M84 92H116V104H84Z"/>'
        f'<rect {S} x="92" y="40" width="16" height="54" rx="4" {C}/>'
        f'<path {S} {B} d="M88 26H96V44H88Z"/><path {S} {B} d="M104 26H112V44H104Z"/>'
        f'<path {A} d="M104 54L92 72H100L96 86L110 66H102Z"/>'),
    # 警棍（拐棍）：長棍＋側握把
    'a baton': rot(-40,
        f'<rect {S} x="30" y="88" width="148" height="24" rx="10" {B}/>'
        f'<rect {S} x="60" y="112" width="18" height="44" rx="6" {C}/>'
        f'<circle {S} cx="69" cy="160" r="8" {C}/>'
        f'<path {SEAM} stroke-width="4" d="M150 92V108"/>'
        f'<rect x="156" y="94" width="16" height="12" rx="4" {A}/>'),
    # 戰術刀：寬刃、背齒、護手
    'a blade knife': rot(-45,
        f'<path {S} {C} d="M92 88H168L184 100L168 112H92Z"/>'
        f'<path {SEAM} stroke-width="4" d="M100 100H160"/>'
        f'<path {O} d="M112 88L118 82L124 88L130 82L136 88L142 82L148 88Z"/>'
        f'<rect {S} x="84" y="78" width="12" height="44" rx="4" {B}/>'
        f'<path {S} {B} d="M34 92Q34 88 38 88H84V112H38Q34 112 34 108Z"/>'
        f'<path {SEAM} stroke-width="4" d="M50 94V106M62 94V106M74 94V106"/>'
        f'<circle cx="28" cy="100" r="6" {A}/>'),
    # 武士刀：極長微彎刃、圓鍔、纏柄
    'a sword': rot(-45,
        f'<path {S} {C} d="M72 94Q140 92 196 84Q182 104 72 106Z"/>'
        f'<path {SEAM} stroke-width="3" d="M80 100Q140 98 180 92"/>'
        f'<ellipse {S} cx="68" cy="100" rx="8" ry="18" {B}/>'
        f'<rect {S} x="8" y="93" width="56" height="14" rx="5" {B}/>'
        f'<path {SEAM} stroke-width="3" d="M18 94L26 106M30 94L38 106M42 94L50 106"/>'
        f'<rect x="168" y="86" width="12" height="7" rx="3" {A} transform="rotate(-8 174 90)"/>'),
    # 鞭：握柄＋盤繞鞭身
    'a whip': (
        f'<path fill="none" stroke="var(--o)" stroke-width="20" stroke-linecap="round" d="M78 128C40 132 30 80 66 64C110 44 168 64 160 108C154 146 104 158 96 132C90 112 120 96 132 112"/>'
        f'<path fill="none" stroke="var(--b)" stroke-width="9" stroke-linecap="round" d="M78 128C40 132 30 80 66 64C110 44 168 64 160 108C154 146 104 158 96 132C90 112 120 96 132 112"/>'
        f'<path {S} {C} d="M72 120L84 132L50 168Q44 174 38 168Q32 162 38 156Z"/>'
        f'<path {SEAM} stroke-width="4" d="M58 140L66 148M50 148L58 156"/>'
        f'<circle cx="136" cy="116" r="6" {A}/>'),
    # 機械爪：手背護甲＋三根彎爪
    'cyber claws': (
        f'<path {S} {C} d="M84 58Q100 26 116 22Q104 44 98 64Z"/>'
        f'<path {S} {C} d="M104 62Q132 30 150 32Q132 50 118 70Z"/>'
        f'<path {S} {C} d="M120 78Q154 58 170 66Q150 76 130 92Z"/>'
        f'<path {S} {B} d="M64 66L118 64L136 90L120 128Q110 144 90 144H66Q50 144 48 128L46 88Z"/>'
        f'<path {S} {B} d="M54 140H100V178H54Z"/>'
        f'<path {SEAM} stroke-width="4" d="M66 92H104L114 104"/>'
        f'<path {SEAM} stroke-width="4" d="M56 158H98"/>'
        f'<circle cx="80" cy="114" r="8" {A}/>'),
    # 尖刺：長錐＋環箍＋頂帽
    'a spike': rot(30,
        f'<path {S} {C} d="M88 72H112L100 184Z"/>'
        f'<path {SEAM} stroke-width="4" d="M100 82V160"/>'
        f'<rect {S} x="82" y="56" width="36" height="16" rx="4" {B}/>'
        f'<rect {S} x="74" y="24" width="52" height="30" rx="8" {B}/>'
        f'<rect x="86" y="34" width="28" height="9" rx="4" {A}/>'),
    # 臂刃：手腕護套＋往前伸的彎刃
    'a blade': rot(-30,
        f'<path {S} {C} d="M90 84Q150 70 192 92Q150 92 96 116Z"/>'
        f'<path {SEAM} stroke-width="3" d="M104 98Q140 86 172 90"/>'
        f'<path {S} {B} d="M16 86Q16 78 24 78H96Q104 78 104 86V114Q104 122 96 122H24Q16 122 16 114Z"/>'
        f'<path {SEAM} stroke-width="4" d="M40 80V120M64 80V120"/>'
        f'<rect x="72" y="94" width="18" height="12" rx="3" {A}/>'),
    # 單發子彈：直立大彈殼＋彈頭
    'a cartridge round': (
        f'<path {S} {C} d="M76 74Q76 26 100 20Q124 26 124 74Z"/>'
        f'<path {S} {B} d="M74 74H126V160H74Z"/>'
        f'<rect {S} x="68" y="160" width="64" height="18" rx="3" {B}/>'
        f'<path {SEAM} stroke-width="4" d="M76 150H124"/>'
        f'<path {SEAM} stroke-width="4" d="M90 88V138"/>'
        f'<circle cx="100" cy="169" r="5" {A}/>'),
    # 一排子彈：彈夾上三發斜躺
    'bullets': rot(-20,
        f'<rect {S} x="34" y="132" width="132" height="14" rx="3" {B}/>'
        + ''.join(
            f'<path {S} {C} d="M{x} 74Q{x} 44 {x + 14} 38Q{x + 28} 44 {x + 28} 74Z"/>'
            f'<path {S} {B} d="M{x} 74H{x + 28}V128H{x}Z"/>'
            f'<path {SEAM} stroke-width="4" d="M{x} 120H{x + 28}"/>'
            for x in (46, 86, 126))
        + f'<rect x="92" y="90" width="16" height="22" rx="4" {A}/>'),
    # 槍管：斜放，前端制退器帶槽、照門
    'a gun barrel': rot(-35,
        f'<rect {S} x="16" y="88" width="120" height="24" rx="5" {B}/>'
        f'<rect {S} x="22" y="80" width="26" height="40" rx="5" {C}/>'
        f'<rect {S} x="132" y="80" width="50" height="40" rx="8" {C}/>'
        f'<path {SEAM} stroke-width="6" d="M146 86V98M160 86V98M146 102V114M160 102V114"/>'
        f'<path {S} {B} d="M112 76H124V88H112Z"/>'
        f'<path {SEAM} stroke-width="3" d="M60 100H110"/>'
        f'<circle cx="35" cy="100" r="6" {A}/>'),
    # 駭客終端：掀開的螢幕＋鍵盤
    'a cyberdeck': (
        f'<path {S} {C} d="M46 34H154L162 42V100H38V42Z"/>'
        f'<rect x="52" y="46" width="96" height="44" rx="3" {O}/>'
        f'<path fill="none" stroke="var(--c)" stroke-width="4" stroke-linecap="round" stroke-linejoin="round" d="M60 78H80L88 62H104L110 72H136"/>'
        f'<path {S} {B} d="M38 104H162L178 156Q180 166 170 166H30Q20 166 22 156Z"/>'
        + ''.join(f'<rect x="{x}" y="{y}" width="16" height="10" rx="2" {O}/>'
                  for y in (116, 132) for x in (44, 66, 88, 110, 132))
        + f'<rect x="64" y="148" width="72" height="9" rx="3" {O}/>'
        + f'<rect x="148" y="132" width="16" height="10" rx="2" {A}/>'),
    # 小型無人機：四旋翼＋中央眼
    'a small drone': (
        f'<path fill="none" stroke="var(--o)" stroke-width="18" stroke-linecap="round" d="M56 64L144 136M144 64L56 136"/>'
        f'<path fill="none" stroke="var(--b)" stroke-width="8" stroke-linecap="round" d="M56 64L144 136M144 64L56 136"/>'
        + ''.join(f'<ellipse {S} cx="{x}" cy="{y}" rx="28" ry="9" {C}/>' for x in (52, 148) for y in (54, 128))
        + f'<path {S} {B} d="M76 86Q76 74 88 74H112Q124 74 124 86V112Q124 126 110 126H90Q76 126 76 112Z"/>'
        f'<circle cx="100" cy="102" r="12" {O}/><circle cx="100" cy="102" r="6" {A}/>'
        f'<path {SEAM} stroke-width="4" d="M84 140V152M116 140V152"/>'),
    # 天線：桅桿＋三角支架＋訊號弧
    'an antenna': (
        f'<path fill="none" stroke="var(--o)" stroke-width="16" stroke-linecap="round" d="M100 70L66 170M100 70L134 170M80 130H120"/>'
        f'<path fill="none" stroke="var(--b)" stroke-width="7" stroke-linecap="round" d="M100 70L66 170M100 70L134 170M80 130H120"/>'
        f'<rect {S} x="56" y="164" width="88" height="14" rx="4" {B}/>'
        f'<path fill="none" stroke="var(--o)" stroke-width="14" stroke-linecap="round" d="M68 42Q60 58 68 74M132 42Q140 58 132 74M50 30Q36 58 50 86M150 30Q164 58 150 86"/>'
        f'<path fill="none" stroke="var(--c)" stroke-width="6" stroke-linecap="round" d="M68 42Q60 58 68 74M132 42Q140 58 132 74M50 30Q36 58 50 86M150 30Q164 58 150 86"/>'
        f'<circle {S} cx="100" cy="58" r="13" {C}/>'
        f'<circle cx="100" cy="58" r="6" {A}/>'),
    # 工具：多功能鉗
    'a tool': rot(15,
        f'<path {S} {B} d="M92 98L80 176Q78 184 70 182Q64 180 66 172L80 96Z"/>'
        f'<path {S} {B} d="M108 98L120 176Q122 184 130 182Q136 180 134 172L120 96Z"/>'
        f'<path {S} {C} d="M84 96L88 30L100 22L100 96Z"/>'
        f'<path {S} {C} d="M116 96L112 30L100 22L100 96Z"/>'
        f'<path {SEAM} stroke-width="3" d="M100 30V90M92 44H98M92 56H98M102 44H108M102 56H108"/>'
        f'<circle {S} cx="100" cy="98" r="12" {B}/>'
        f'<circle cx="100" cy="98" r="5" {A}/>'),
    # 工具箱：提把＋扣環＋露出的螺絲起子
    'a tool kit': (
        f'<path {S} {C} d="M112 40L122 30L128 36L120 64H112Z"/>'
        f'<path fill="none" stroke="var(--o)" stroke-width="18" stroke-linejoin="round" d="M76 70V50H124V70"/>'
        f'<path fill="none" stroke="var(--b)" stroke-width="8" stroke-linejoin="round" d="M76 70V50H124V70"/>'
        f'<path {S} {B} d="M30 76L38 66H162L170 76V102H30Z"/>'
        f'<path {S} {B} d="M30 104H170V164Q170 170 164 170H36Q30 170 30 164Z"/>'
        f'<path {SEAM} stroke-width="5" d="M30 104H170"/>'
        f'<rect {S} x="88" y="94" width="24" height="20" rx="4" {C}/>'
        f'<rect x="94" y="100" width="12" height="8" rx="2" {A}/>'
        f'<path {SEAM} stroke-width="4" d="M44 140H76M44 152H64"/>'),
    # 活動扳手：開口顎＋調整螺紋
    'a wrench': rot(-45,
        f'<rect {S} x="24" y="88" width="104" height="24" rx="12" {B}/>'
        f'<circle cx="40" cy="100" r="5" {O}/>'
        f'<path {S} {C} d="M124 80H150Q178 80 178 100Q178 106 174 108H150V94H136V120H124Z"/>'
        f'<path {S} {C} d="M136 120H170Q166 132 150 132H136Z"/>'
        f'<rect {S} x="110" y="112" width="22" height="12" rx="3" {B}/>'
        f'<path {SEAM} stroke-width="3" d="M116 113V123M121 113V123M126 113V123"/>'
        f'<rect x="64" y="95" width="30" height="10" rx="5" {A}/>'),
    # 掛鎖：U 形鎖梁＋鎖身＋鑰匙孔
    'a padlock': (
        f'<path fill="none" stroke="var(--o)" stroke-width="30" d="M66 92V64Q66 30 100 30Q134 30 134 64V92"/>'
        f'<path fill="none" stroke="var(--c)" stroke-width="16" d="M66 92V64Q66 30 100 30Q134 30 134 64V92"/>'
        f'<path {S} {B} d="M46 92L56 82H144L154 92V160L144 170H56L46 160Z"/>'
        f'<circle cx="100" cy="118" r="11" {O}/><path {O} d="M95 124H105L108 146H92Z"/>'
        f'<path {SEAM} stroke-width="4" d="M60 100V118M140 100V118"/>'
        f'<rect x="126" y="148" width="16" height="10" rx="3" {A}/>'),
    # 木箱：木板條＋斜撐
    'a crate': (
        f'<rect {S} x="32" y="38" width="136" height="128" rx="6" {C}/>'
        f'<path {SEAM} stroke-width="5" d="M50 80H150M50 124H150"/>'
        f'<path {S} {B} d="M50 56L66 56L150 132L150 148L134 148L50 72Z"/>'
        f'<path fill="none" stroke="var(--o)" stroke-width="9" d="M32 56H168M32 148H168M50 38V166M150 38V166"/>'
        f'<path fill="none" stroke="var(--b)" stroke-width="14" d="M41 38V166M159 38V166"/>'
        f'<circle cx="41" cy="47" r="4" {O}/><circle cx="159" cy="47" r="4" {O}/><circle cx="41" cy="157" r="4" {O}/><circle cx="159" cy="157" r="4" {O}/>'
        f'<rect x="76" y="94" width="20" height="12" rx="3" {A}/>'),
    # 貨櫃：波紋板＋門閂
    'a cargo crate': (
        f'<path {S} {B} d="M22 58L34 46H178V146L166 158H22Z"/>'
        f'<path {S} {C} d="M22 58H166V158H22Z"/>'
        f'<path {SEAM} stroke-width="5" d="M38 68V148M54 68V148M70 68V148M86 68V148"/>'
        f'<path {SEAM} stroke-width="4" d="M100 62V154"/>'
        f'<path fill="none" stroke="var(--b)" stroke-width="5" stroke-linecap="round" d="M120 70V146M144 70V146"/>'
        f'<rect x="114" y="98" width="36" height="10" rx="3" {A}/>'),
    # 神秘箱：蓋子掀起、內部發光、閃光
    'a mystery box': (
        f'<path {S} {B} d="M40 96H160V164Q160 170 154 170H46Q40 170 40 164Z"/>'
        f'<path {S} {C} d="M88 96H112V170H88Z"/>'
        f'<path {S} {B} d="M34 66L152 42L158 66L40 90Z"/>'
        f'<path {S} {C} d="M84 56L108 52L114 76L90 80Z"/>'
        f'<path fill="none" stroke="var(--o)" stroke-width="12" stroke-linecap="round" d="M70 34V20M140 24L150 14M162 92H176"/>'
        f'<path fill="none" stroke="var(--c)" stroke-width="5" stroke-linecap="round" d="M70 34V20M140 24L150 14M162 92H176"/>'
        f'<path {A} d="M30 34L34 44L44 48L34 52L30 62L26 52L16 48L26 44Z"/>'
        f'<rect x="54" y="118" width="20" height="8" rx="3" {O}/>'),
    # 卡帶：兩個捲軸孔＋標籤＋底部梯形
    'a cassette tape': (
        f'<path {S} {B} d="M24 56Q24 46 34 46H166Q176 46 176 56V146Q176 156 166 156H34Q24 156 24 146Z"/>'
        f'<rect {S} x="42" y="62" width="116" height="52" rx="6" {C}/>'
        f'<circle cx="72" cy="88" r="13" {O}/><circle cx="128" cy="88" r="13" {O}/>'
        f'<circle cx="72" cy="88" r="5" {B}/><circle cx="128" cy="88" r="5" {B}/>'
        f'<rect x="88" y="82" width="24" height="12" rx="2" {O}/>'
        f'<path {S} {C} d="M60 156L68 130H132L140 156Z"/>'
        f'<circle cx="84" cy="144" r="4" {O}/><circle cx="116" cy="144" r="4" {O}/>'
        f'<rect x="50" y="68" width="30" height="7" rx="3" {A}/>'),
    # 一捆繩：盤繞圈＋垂下的尾端
    'a coil of rope': (
        f'<path fill="none" stroke="var(--o)" stroke-width="22" stroke-linecap="round" d="{_SPIRAL} Q150 150 148 176"/>'
        f'<path fill="none" stroke="var(--c)" stroke-width="12" stroke-linecap="round" d="{_SPIRAL} Q150 150 148 176"/>'
        f'<circle cx="100" cy="90" r="9" {O}/>'
        f'<circle cx="148" cy="176" r="7" {A}/>'),
    # 小鈴鐺：鐘形＋頂環＋鈴舌
    'a small bell': (
        f'<circle cx="100" cy="36" r="12" fill="none" stroke="var(--o)" stroke-width="16"/>'
        f'<circle cx="100" cy="36" r="12" fill="none" stroke="var(--b)" stroke-width="7"/>'
        f'<circle {S} cx="100" cy="156" r="14" {A}/>'
        f'<path {S} {B} d="M100 46Q58 46 56 100Q54 130 34 144Q30 150 38 150H162Q170 150 166 144Q146 130 144 100Q142 46 100 46Z"/>'
        f'<path fill="none" stroke="var(--c)" stroke-width="8" stroke-linecap="round" d="M76 78Q72 96 72 118"/>'
        f'<path {SEAM} stroke-width="5" d="M50 136H150"/>'),
    # 手錶：錶帶＋圓錶面＋指針
    'a wristwatch': (
        f'<path {S} {B} d="M76 22H124L120 60H80Z"/>'
        f'<path {S} {B} d="M80 140H120L124 178H76Z"/>'
        f'<path {SEAM} stroke-width="4" d="M84 34H116M84 166H116"/>'
        f'<rect {S} x="142" y="92" width="12" height="16" rx="3" {B}/>'
        f'<circle {S} cx="100" cy="100" r="46" {C}/>'
        f'<circle cx="100" cy="100" r="34" fill="none" stroke="var(--o)" stroke-width="4"/>'
        f'<path {SEAM} stroke-width="7" d="M100 100V76M100 100L118 110"/>'
        f'<circle cx="100" cy="100" r="6" {A}/>'),
    # 破片手榴彈：格紋彈體＋握片＋拉環
    'a grenade': (
        f'<circle cx="138" cy="44" r="14" fill="none" stroke="var(--o)" stroke-width="15"/>'
        f'<circle cx="138" cy="44" r="14" fill="none" stroke="var(--a)" stroke-width="6"/>'
        f'<path {S} {C} d="M84 40H114L118 54L140 64L144 96L132 92L120 70H84Z"/>'
        f'<ellipse {S} cx="100" cy="122" rx="48" ry="54" {B}/>'
        f'<path {SEAM} stroke-width="6" d="M54 108H146M54 140H146M84 70V174M116 70V174"/>'
        f'<path fill="none" stroke="var(--c)" stroke-width="7" stroke-linecap="round" d="M68 96Q66 108 66 118"/>'),
    # 煙霧彈：圓柱罐＋頂部冒煙
    'a smoke grenade': (
        f'<path {S} {C} d="M74 64Q58 64 58 50Q58 36 72 36Q74 22 90 22Q104 22 108 32Q124 26 134 38Q148 40 146 54Q144 66 128 64Z"/>'
        f'<rect {S} x="84" y="66" width="32" height="14" rx="3" {B}/>'
        f'<path {S} {B} d="M64 82Q64 76 70 76H130Q136 76 136 82V170Q136 176 130 176H70Q64 176 64 170Z"/>'
        f'<path {SEAM} stroke-width="5" d="M64 100H136M64 156H136"/>'
        f'<circle cx="80" cy="128" r="6" {O}/><circle cx="100" cy="128" r="6" {O}/><circle cx="120" cy="128" r="6" {O}/>'
        f'<rect x="88" y="44" width="24" height="9" rx="4" {A}/>'),
    # 閃光彈：開孔圓柱＋放射爆光
    'a flashbang': (
        f'<path fill="none" stroke="var(--o)" stroke-width="16" stroke-linecap="round" d="M100 34V20M58 52L46 40M142 52L154 40M40 100H26M160 100H174"/>'
        f'<path fill="none" stroke="var(--a)" stroke-width="7" stroke-linecap="round" d="M100 34V20M58 52L46 40M142 52L154 40M40 100H26M160 100H174"/>'
        f'<rect {S} x="84" y="46" width="32" height="14" rx="3" {C}/>'
        f'<path {S} {B} d="M60 66L68 58H132L140 66V170L132 178H68L60 170Z"/>'
        f'<path {SEAM} stroke-width="5" d="M60 84H140M60 160H140"/>'
        f'<rect x="72" y="96" width="12" height="48" rx="6" {O}/><rect x="94" y="96" width="12" height="48" rx="6" {O}/><rect x="116" y="96" width="12" height="48" rx="6" {O}/>'
        f'<path fill="none" stroke="var(--c)" stroke-width="5" stroke-linecap="round" d="M70 70H90"/>'),
    # 火箭發射器：長管＋露出的彈頭＋握把
    'a rocket launcher': rot(-30,
        f'<path {S} {C} d="M150 86H170Q192 92 196 100Q192 108 170 114H150Z"/>'
        f'<rect {S} x="10" y="80" width="146" height="40" rx="6" {B}/>'
        f'<rect {S} x="4" y="74" width="16" height="52" rx="4" {C}/>'
        f'<rect {S} x="138" y="74" width="16" height="52" rx="4" {C}/>'
        f'<path {S} {C} d="M58 120H76L70 150H56Z"/><path {S} {C} d="M98 120H116L114 146H100Z"/>'
        f'<path {S} {B} d="M74 60H112V80H74Z"/>'
        f'<path {SEAM} stroke-width="4" d="M30 100H128"/>'
        f'<circle cx="182" cy="100" r="5" {A}/>'),
    # 瓶子：瓶身＋瓶頸＋標籤＋瓶塞
    'a bottle': (
        f'<rect {S} x="86" y="20" width="28" height="16" rx="3" {A}/>'
        f'<path {S} {B} d="M88 36H112V64Q138 76 138 104V170Q138 178 130 178H70Q62 178 62 170V104Q62 76 88 64Z"/>'
        f'<rect {S} x="62" y="112" width="76" height="40" {C}/>'
        f'<path fill="none" stroke="var(--o)" stroke-width="4" stroke-linecap="round" stroke-linejoin="round" d="M74 132H90L96 122L104 142L110 132H126"/>'
        f'<path fill="none" stroke="var(--c)" stroke-width="6" stroke-linecap="round" d="M76 92Q72 98 72 104"/>'),
    # 羽毛：斜放，羽軸＋羽枝缺口
    'a feather': rot(40,
        f'<path {S} {C} d="M100 22Q140 50 136 110Q132 140 104 150H96Q68 140 64 110Q60 50 100 22Z"/>'
        f'<path {O} d="M136 76L118 86L136 90Z"/>'
        f'<path {O} d="M64 100L84 110L64 116Z"/>'
        f'<path fill="none" stroke="var(--o)" stroke-width="13" stroke-linecap="round" d="M100 40V184"/>'
        f'<path fill="none" stroke="var(--b)" stroke-width="6" stroke-linecap="round" d="M100 40V184"/>'
        f'<path {SEAM} stroke-width="3" d="M100 70L120 56M100 96L124 80M100 120L122 108M100 82L80 66M100 108L76 94M100 132L80 124"/>'
        f'<circle cx="100" cy="178" r="5" {A}/>'),
}
