#!/usr/bin/env python3
"""物品與技能的圖標：第 1 層（未知）、第 2 層（類型與部位的通用圖標）、技能的備用圖標（種類 × 樹）。
規格照 ART_STYLE 第 5 節：剪影＋扁平、3～4 色、形狀之間留縫；顏色用 CSS 變數，同一份原稿換兩套皮：
  --o 縫與輪廓　--a 重點（現實皮只有一個粉）　--b 主體　--c 亮部
輸出：
  docs/art/style/icons-sprite.svg   每個圖標一個 <symbol id="ic-…">，畫面直接引用
  docs/art/style/icons-l2.svg       總覽（上半現實皮、下半內海皮）
用法：python3 tools/art/gen_icons.py"""
import json, os, subprocess, sys, tempfile

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '../..'))
OUT = os.path.join(ROOT, 'docs', 'art', 'style')
S = 'class="s"'  # 帶縫的輪廓

# (id, 名字, 群組, 內容)  座標 200×200
I = []
def add(i, name, group, body):
    I.append((i, name, group, body))

# ---------- 第 1 層 ----------
add('unknown', '未知的物品', '第 1 層',
    f'<path {S} fill="var(--b)" d="M100 22L172 62V140L100 180L28 140V62Z"/><path {S} fill="var(--c)" d="M100 22L172 62L100 102L28 62Z"/>'
    '<path fill="none" stroke="var(--o)" stroke-width="9" d="M100 102V180"/>'
    '<path fill="none" stroke="var(--a)" stroke-width="12" stroke-linecap="round" d="M84 56Q86 44 100 44Q114 44 114 56Q114 64 104 68Q100 70 100 76"/><circle cx="100" cy="88" r="6" fill="var(--a)"/>')

# ---------- 穿著 ----------
G = '穿著'
add('slot_head', '頭部', G, f'<path {S} fill="var(--b)" d="M40 120Q40 50 104 50Q160 50 160 120Z"/><path {S} fill="var(--c)" d="M30 120H186Q190 136 172 136H40Q26 136 30 120Z"/><rect x="70" y="74" width="40" height="12" rx="6" fill="var(--a)"/>')
add('slot_face', '面部', G, f'<path {S} fill="var(--c)" d="M36 70Q100 40 164 70V112Q100 160 36 112Z"/><path fill="var(--o)" d="M58 86H90L84 100H64ZM110 86H142L136 100H116Z"/><path {S} fill="none" stroke-width="7" d="M36 84H18M164 84H182"/><rect x="88" y="118" width="24" height="10" rx="5" fill="var(--a)"/>')
add('slot_top', '上身', G, f'<path {S} fill="var(--b)" d="M70 36L100 50L130 36L176 64L160 96L142 88V170H58V88L40 96L24 64Z"/><path fill="var(--c)" d="M82 40Q100 64 118 40Z"/><rect x="88" y="112" width="24" height="10" rx="5" fill="var(--a)"/>')
add('slot_bottom', '下身', G, f'<path {S} fill="var(--b)" d="M56 30H144L156 176H116L100 82L84 176H44Z"/><rect x="56" y="30" width="88" height="18" fill="var(--c)"/><rect x="92" y="34" width="16" height="10" rx="3" fill="var(--a)"/>')
add('slot_coat', '外套', G, f'<path {S} fill="var(--b)" d="M64 28L100 42L136 28L178 58L162 182H38L22 58Z"/><path {S} fill="var(--c)" d="M64 28L100 110L136 28L120 26L100 70L80 26Z"/><path fill="none" stroke="var(--o)" stroke-width="7" d="M100 110V182"/><circle cx="114" cy="132" r="6" fill="var(--a)"/><circle cx="114" cy="156" r="6" fill="var(--c)"/>')
add('slot_armor', '護甲', G, f'<path {S} fill="var(--b)" d="M56 30H80L100 46L120 30H144L160 60V170H40V60Z"/><rect {S} x="58" y="82" width="84" height="40" rx="6" fill="var(--c)"/><rect {S} x="58" y="128" width="84" height="30" rx="6" fill="var(--c)"/><rect x="92" y="96" width="16" height="12" rx="3" fill="var(--a)"/>')
add('slot_hands', '手', G, f'<path {S} fill="var(--b)" d="M56 180V102Q56 90 66 90V56Q66 46 76 46Q86 46 86 56V86V44Q86 34 96 34Q106 34 106 44V86V50Q106 40 116 40Q126 40 126 50V92V66Q126 56 136 56Q146 56 146 66V130Q146 180 110 180Z"/><rect {S} x="56" y="150" width="90" height="30" rx="8" fill="var(--c)"/><rect x="88" y="158" width="26" height="12" rx="6" fill="var(--a)"/>')
add('slot_shoes', '鞋', G, f'<path {S} fill="var(--b)" d="M50 30H100V112L170 132Q184 138 182 156V166H26V140Q26 130 34 124L50 112Z"/><rect {S} x="26" y="150" width="156" height="24" rx="8" fill="var(--c)"/><path fill="none" stroke="var(--a)" stroke-width="8" stroke-linecap="round" d="M62 62H90M62 84H90"/>')
add('slot_bra', '內衣', G, f'<path {S} fill="var(--b)" d="M28 76Q60 64 96 100Q100 104 104 100Q140 64 172 76Q172 128 134 132Q108 134 100 112Q92 134 66 132Q28 128 28 76Z"/><path {S} fill="none" stroke-width="7" d="M40 72L60 30M160 72L140 30"/><circle cx="100" cy="104" r="7" fill="var(--a)"/>')
add('slot_panties', '內褲', G, f'<path {S} fill="var(--b)" d="M28 58H172Q166 96 132 118L114 156H86L68 118Q34 96 28 58Z"/><rect x="28" y="58" width="144" height="14" fill="var(--c)"/><circle cx="100" cy="80" r="7" fill="var(--a)"/>')

# ---------- 飾品 ----------
G = '飾品'
add('acc_neck', '頸', G, f'<path {S} fill="none" stroke-width="22" stroke="var(--o)" d="M40 70Q100 150 160 70"/><path fill="none" stroke-width="13" stroke="var(--b)" stroke-linecap="round" d="M40 70Q100 150 160 70"/><path {S} fill="var(--a)" d="M100 170C70 150 66 128 80 122Q92 118 100 130Q108 118 120 122Q134 128 100 170Z"/><rect {S} x="92" y="106" width="16" height="16" rx="4" fill="var(--c)"/>')
add('acc_leg', '腿', G, f'<path {S} fill="var(--c)" d="M60 40H140L132 180H68Z"/><rect {S} x="52" y="74" width="96" height="30" rx="10" fill="var(--b)"/><circle cx="100" cy="89" r="8" fill="var(--a)"/><path fill="none" stroke="var(--o)" stroke-width="6" d="M70 120L130 150M130 120L70 150" opacity=".35"/>')
add('acc_ring', '通用', G, f'<circle {S} cx="100" cy="122" r="50" fill="none" stroke-width="22"/><circle cx="100" cy="122" r="50" fill="none" stroke="var(--b)" stroke-width="13"/><path {S} fill="var(--c)" d="M78 64L100 40L122 64L100 86Z"/><path fill="var(--a)" d="M100 52L110 64L100 76L90 64Z"/>')

# ---------- 攜帶 ----------
G = '攜帶'
add('carry_main', '主武器', G, f'<path {S} fill="var(--b)" d="M14 92H150V112H14Z"/><path {S} fill="var(--c)" d="M60 84H150Q160 84 160 94V112H60Z"/><path {S} fill="var(--b)" d="M150 96H190V106H150Z"/><path {S} fill="var(--b)" d="M86 112H110L114 160H92Z"/><path {S} fill="var(--b)" d="M60 112L36 112L24 150H50Z"/><rect x="76" y="92" width="50" height="8" rx="4" fill="var(--a)"/>')
add('carry_side', '副武器', G, f'<path {S} fill="var(--b)" d="M58 104H104L114 168Q116 182 102 182H74Q60 182 58 168Z"/><path {S} fill="var(--c)" d="M26 64Q26 50 40 50H160Q174 50 174 64V92Q174 106 160 106H40Q26 106 26 92Z"/><rect {S} x="150" y="62" width="30" height="16" rx="5" fill="var(--b)"/><rect x="44" y="64" width="80" height="10" rx="5" fill="var(--a)"/>')
add('carry_melee', '近戰', G, f'<path {S} fill="var(--c)" d="M98 24L124 30L84 136L64 128Z"/><path {S} fill="var(--b)" d="M50 120L100 138L94 152L44 134Z"/><path {S} fill="var(--b)" d="M62 140L82 148L66 186Q62 194 52 190Q44 186 46 176Z"/><circle cx="64" cy="168" r="5" fill="var(--a)"/>')

# ---------- 義體部位 ----------
G = '義體部位'
add('cw_bridge', '橋', G, f'<path {S} fill="var(--b)" d="M58 180V120Q58 40 120 40Q170 40 170 100Q170 120 150 130V180Z"/><rect {S} x="128" y="110" width="40" height="40" rx="8" fill="var(--c)"/><path fill="var(--o)" d="M138 120H158V140H138Z"/><path fill="none" stroke="var(--a)" stroke-width="6" stroke-linecap="round" d="M144 126V134M152 126V134"/>')
add('cw_brain', '腦', G, f'<path {S} fill="var(--c)" d="M100 40Q60 30 46 62Q28 72 36 102Q30 130 58 140Q66 164 100 156Q134 164 142 140Q170 130 164 102Q172 72 154 62Q140 30 100 40Z"/><path fill="none" stroke="var(--o)" stroke-width="7" d="M100 44V154M62 84Q80 80 84 100M138 84Q120 80 116 100M66 122Q82 116 92 126"/><path fill="none" stroke="var(--a)" stroke-width="7" stroke-linecap="round" d="M116 120H140V136"/><circle cx="140" cy="140" r="6" fill="var(--a)"/>')
add('cw_eye', '眼', G, f'<path {S} fill="var(--c)" d="M20 100Q100 30 180 100Q100 170 20 100Z"/><circle {S} cx="100" cy="100" r="36" fill="var(--b)"/><circle cx="100" cy="100" r="14" fill="var(--o)"/><path fill="none" stroke="var(--a)" stroke-width="6" d="M100 54V74M100 126V146M54 100H74M126 100H146"/>')
add('cw_earthroat', '耳與喉', G, f'<path {S} fill="var(--c)" d="M86 30Q136 30 136 80Q136 104 116 116Q104 124 104 140Q104 170 78 170Q60 170 60 150"/><path {S} fill="var(--b)" d="M86 30Q136 30 136 80Q136 104 116 116Q104 124 104 140Q104 170 78 170Q60 170 60 150Q60 30 86 30Z"/><path fill="none" stroke="var(--o)" stroke-width="7" d="M84 70Q104 64 106 88Q106 100 94 104"/><path fill="none" stroke="var(--a)" stroke-width="8" stroke-linecap="round" d="M154 70Q170 90 154 110M166 52Q194 90 166 128"/>')
add('cw_torso', '軀幹', G, f'<path {S} fill="var(--b)" d="M50 30H150L162 110L140 176H60L38 110Z"/><path {S} fill="var(--c)" d="M64 50H136V100H64Z"/><path fill="none" stroke="var(--o)" stroke-width="6" d="M100 50V100M64 75H136"/><path {S} fill="var(--a)" d="M100 158C82 146 78 134 86 128Q94 124 100 132Q106 124 114 128Q122 134 100 158Z"/>')
add('cw_skin', '皮膚', G, f'<path {S} fill="var(--c)" d="M40 50Q100 24 160 50V150Q100 176 40 150Z"/><path fill="none" stroke="var(--b)" stroke-width="8" stroke-linecap="round" d="M60 80H96L110 100H140M70 124H100L112 108"/><circle cx="140" cy="100" r="8" fill="var(--a)"/><circle cx="60" cy="80" r="6" fill="var(--b)"/><circle cx="70" cy="124" r="6" fill="var(--b)"/>')
add('cw_arm', '臂', G, f'<path {S} fill="var(--b)" d="M30 60H100L120 80V104H44Q30 104 30 90Z"/><path {S} fill="var(--c)" d="M108 72L150 58L178 86L150 118L114 104Z"/><circle {S} cx="104" cy="88" r="16" fill="var(--c)"/><circle cx="104" cy="88" r="6" fill="var(--a)"/><path fill="none" stroke="var(--o)" stroke-width="6" d="M60 60V104M150 58V118"/>')
add('cw_leg', '腿', G, f'<path {S} fill="var(--b)" d="M70 20H130L124 96H76Z"/><circle {S} cx="100" cy="104" r="18" fill="var(--c)"/><path {S} fill="var(--b)" d="M82 116H118L114 166H86Z"/><path {S} fill="var(--c)" d="M74 160H134Q150 160 150 176V184H74Z"/><circle cx="100" cy="104" r="7" fill="var(--a)"/>')
add('cw_intimate', '私密', G, f'<path {S} fill="var(--b)" d="M100 176C40 136 26 104 40 78Q56 52 86 64Q96 70 100 80Q104 70 114 64Q144 52 160 78Q174 104 100 176Z"/><rect {S} x="78" y="98" width="44" height="38" rx="8" fill="var(--c)"/><path {S} fill="none" stroke-width="12" stroke="var(--o)" d="M86 98V86Q86 72 100 72Q114 72 114 86V98"/><path fill="none" stroke-width="6" stroke="var(--c)" d="M86 98V86Q86 72 100 72Q114 72 114 86V98"/><circle cx="100" cy="116" r="6" fill="var(--a)"/>')

# ---------- 零件 ----------
G = '零件'
pins = ''.join(f'<path d="M{x} 30V46M{x} 154V170" stroke="var(--b)" stroke-width="8" stroke-linecap="round"/>' for x in (70, 100, 130)) + ''.join(f'<path d="M30 {y}H46M154 {y}H170" stroke="var(--b)" stroke-width="8" stroke-linecap="round"/>' for y in (70, 100, 130))
add('part_chip', '晶片', G, pins + f'<rect {S} x="46" y="46" width="108" height="108" rx="12" fill="var(--c)"/><rect x="72" y="72" width="56" height="56" rx="6" fill="var(--b)"/><rect x="88" y="88" width="24" height="24" rx="4" fill="var(--a)"/>')
add('part_neuron', '機械神經元', G, f'<path fill="none" stroke="var(--o)" stroke-width="20" stroke-linecap="round" d="M100 100L40 50M100 100L160 46M100 100L170 130M100 100L44 150M100 100L104 182"/><path fill="none" stroke="var(--b)" stroke-width="10" stroke-linecap="round" d="M100 100L40 50M100 100L160 46M100 100L170 130M100 100L44 150M100 100L104 182"/><circle {S} cx="100" cy="100" r="30" fill="var(--c)"/><circle cx="100" cy="100" r="11" fill="var(--a)"/>')
add('part_software', '軟體', G, f'<rect {S} x="34" y="28" width="132" height="148" rx="12" fill="var(--b)"/><rect {S} x="56" y="28" width="88" height="54" rx="4" fill="var(--c)"/><rect x="112" y="40" width="18" height="30" rx="3" fill="var(--b)"/><path fill="none" stroke="var(--c)" stroke-width="10" stroke-linecap="round" stroke-linejoin="round" d="M80 108L62 128L80 148M120 108L138 128L120 148"/><path stroke="var(--a)" stroke-width="10" stroke-linecap="round" d="M108 104L92 152"/>')
add('part_plate', '板材', G, f'<path {S} fill="var(--b)" d="M30 128L100 162L170 128L100 94Z"/><path {S} fill="var(--c)" d="M30 100L100 134L170 100L100 66Z"/><path {S} fill="var(--b)" d="M30 72L100 106L170 72L100 38Z"/><circle cx="100" cy="72" r="7" fill="var(--a)"/>')
add('part_actuator', '致動器', G, f'<rect {S} x="40" y="80" width="80" height="40" rx="8" fill="var(--b)"/><rect {S} x="116" y="90" width="50" height="20" rx="6" fill="var(--c)"/><circle {S} cx="40" cy="100" r="24" fill="var(--c)"/><circle {S} cx="170" cy="100" r="16" fill="var(--b)"/><circle cx="40" cy="100" r="8" fill="var(--a)"/><path stroke="var(--o)" stroke-width="6" d="M70 80V120M90 80V120"/>')
add('part_sensor', '感測器', G, f'<rect {S} x="34" y="54" width="132" height="92" rx="20" fill="var(--b)"/><circle {S} cx="100" cy="100" r="34" fill="var(--c)"/><circle cx="100" cy="100" r="16" fill="var(--o)"/><circle cx="108" cy="92" r="6" fill="var(--c)"/><circle cx="148" cy="72" r="7" fill="var(--a)"/>')
add('part_power', '電源', G, f'<rect {S} x="44" y="40" width="112" height="136" rx="16" fill="var(--b)"/><rect {S} x="78" y="24" width="44" height="20" rx="5" fill="var(--c)"/><path {S} fill="var(--a)" d="M108 60L70 116H98L90 156L130 96H102Z"/>')
add('part_skin', '外皮', G, f'<path {S} fill="var(--c)" d="M30 50H140Q170 50 170 80V150H60Q30 150 30 120Z"/><circle {S} cx="150" cy="134" r="28" fill="var(--b)"/><circle cx="150" cy="134" r="10" fill="var(--o)"/><path fill="none" stroke="var(--b)" stroke-width="6" d="M50 78H120M50 98H110M50 118H100"/><circle cx="64" cy="132" r="6" fill="var(--a)"/>')
add('part_barrel', '槍管', G, f'<rect {S} x="20" y="78" width="160" height="44" rx="10" fill="var(--b)"/><rect {S} x="150" y="70" width="34" height="60" rx="8" fill="var(--c)"/><path stroke="var(--o)" stroke-width="6" d="M60 78V122M90 78V122M120 78V122"/><circle cx="167" cy="100" r="9" fill="var(--o)"/><rect x="30" y="94" width="20" height="12" rx="6" fill="var(--a)"/>')
gear = ''.join(f'<rect {S} x="88" y="20" width="24" height="34" rx="5" fill="var(--b)" transform="rotate({a} 100 100)"/>' for a in range(0, 360, 45))
add('part_mech', '機構', G, gear + f'<circle {S} cx="100" cy="100" r="52" fill="var(--b)"/><circle {S} cx="100" cy="100" r="24" fill="var(--c)"/><circle cx="100" cy="100" r="9" fill="var(--a)"/>')
add('part_blade', '刃', G, f'<path {S} fill="var(--c)" d="M30 170L150 30Q176 30 172 56L52 186Z"/><path fill="none" stroke="var(--b)" stroke-width="7" d="M44 172L156 46"/><circle cx="150" cy="56" r="6" fill="var(--a)"/>')
add('part_fiber', '纖維', G, f'<rect {S} x="40" y="30" width="120" height="24" rx="8" fill="var(--b)"/><rect {S} x="40" y="146" width="120" height="24" rx="8" fill="var(--b)"/><rect {S} x="62" y="54" width="76" height="92" fill="var(--c)"/><path fill="none" stroke="var(--b)" stroke-width="5" d="M62 70H138M62 86H138M62 102H138M62 118H138M62 134H138"/><path fill="none" stroke="var(--a)" stroke-width="7" stroke-linecap="round" d="M138 110Q170 110 176 150"/>')

# ---------- 其他 ----------
G = '其他'
add('bp', '設計圖', G, f'<path {S} fill="var(--b)" d="M30 40H150Q170 40 170 60V160H50Q30 160 30 140Z"/><path fill="none" stroke="var(--c)" stroke-width="3" opacity=".6" d="M50 70H150M50 100H150M50 130H150M80 50V150M110 50V150M140 50V150"/><path fill="none" stroke="var(--c)" stroke-width="8" stroke-linejoin="round" d="M64 132L92 76L120 116L136 92"/><circle {S} cx="150" cy="150" r="22" fill="var(--c)"/><circle cx="150" cy="150" r="8" fill="var(--a)"/>')
add('drug', '藥', G, f'<rect {S} x="30" y="72" width="140" height="56" rx="28" fill="var(--c)" transform="rotate(-35 100 100)"/><path fill="var(--a)" d="M100 100L140 72A28 28 0 0 1 172 116L134 144Z" transform="rotate(-35 100 100) translate(-20 0)" opacity="0"/><rect x="100" y="72" width="70" height="56" rx="28" fill="var(--a)" transform="rotate(-35 100 100)"/><rect x="100" y="72" width="16" height="56" fill="var(--a)" transform="rotate(-35 100 100)"/><path fill="none" stroke="var(--o)" stroke-width="7" d="M100 72V128" transform="rotate(-35 100 100)"/>')
add('ammo', '彈藥', G, ''.join(f'<path {S} fill="var(--c)" d="M{x} 70Q{x + 16} 30 {x + 32} 70Z"/><rect {S} x="{x}" y="68" width="32" height="96" rx="4" fill="var(--b)"/>' for x in (36, 84, 132)) + '<rect x="84" y="140" width="32" height="12" fill="var(--a)"/>')
add('consumable', '消耗品', G, f'<rect {S} x="30" y="56" width="140" height="110" rx="14" fill="var(--c)"/><rect {S} x="72" y="36" width="56" height="26" rx="6" fill="var(--b)"/><path fill="var(--a)" d="M88 82H112V100H130V124H112V142H88V124H70V100H88Z"/>')
add('cargo', '貨物', G, f'<rect {S} x="30" y="50" width="140" height="120" rx="8" fill="var(--b)"/><path fill="none" stroke="var(--o)" stroke-width="8" d="M30 90H170M30 130H170M100 50V170"/><path fill="none" stroke="var(--c)" stroke-width="9" d="M40 60L90 120M110 60L160 120"/><rect x="118" y="138" width="40" height="18" rx="4" fill="var(--a)"/>')
add('tool', '工具', G, f'<path fill="none" stroke="var(--o)" stroke-width="30" stroke-linecap="round" d="M60 150L130 80"/><path fill="none" stroke="var(--b)" stroke-width="18" stroke-linecap="round" d="M60 150L130 80"/><path {S} fill="var(--c)" d="M128 40A36 36 0 1 0 162 76L142 82L120 60Z"/><circle cx="56" cy="154" r="7" fill="var(--a)"/>')
add('adult', '成人道具', G, f'<path {S} fill="var(--b)" d="M100 172C48 138 34 108 46 84Q60 60 88 70Q96 74 100 84Q104 74 112 70Q140 60 154 84Q166 108 100 172Z"/><path {S} fill="var(--c)" d="M62 48Q100 70 138 48Q132 30 100 40Q68 30 62 48Z"/><circle cx="100" cy="46" r="10" fill="var(--a)"/><path fill="none" stroke="var(--c)" stroke-width="7" stroke-linecap="round" d="M70 100Q72 88 84 86"/>')
add('footage', '素材', G, f'<rect {S} x="26" y="50" width="148" height="100" rx="12" fill="var(--b)"/><circle {S} cx="72" cy="98" r="20" fill="var(--c)"/><circle {S} cx="128" cy="98" r="20" fill="var(--c)"/><rect x="66" y="128" width="68" height="12" rx="4" fill="var(--o)"/><circle cx="72" cy="98" r="7" fill="var(--b)"/><circle cx="128" cy="98" r="7" fill="var(--b)"/><circle cx="156" cy="66" r="7" fill="var(--a)"/>')

# ---------- 內海：構裝與 SKIN ----------
G = '內海'
add('net_weapon', '武器構裝', G, f'<path {S} fill="var(--b)" d="M120 30L170 30L170 80L96 154L46 104Z"/><path {S} fill="var(--c)" d="M46 104L96 154L70 180L20 130Z"/><path fill="none" stroke="var(--o)" stroke-width="8" stroke-linecap="round" stroke-linejoin="round" d="M106 74L90 90L106 106M132 74L148 90"/><rect x="136" y="44" width="16" height="16" fill="var(--a)"/>')
add('net_defense', '防護構裝', G, f'<path {S} fill="var(--b)" d="M100 22L166 50V104Q166 152 100 180Q34 152 34 104V50Z"/><path {S} fill="var(--c)" d="M100 52L136 70V104Q136 132 100 150Q64 132 64 104V70Z"/><path fill="var(--o)" d="M84 92H96V104H84ZM104 92H116V104H104ZM94 112H106V124H94Z"/><rect x="146" y="40" width="14" height="14" fill="var(--a)"/>')
add('net_tool', '工具構裝', G, f'<rect {S} x="34" y="34" width="132" height="132" rx="14" fill="var(--b)"/><rect {S} x="58" y="34" width="72" height="44" fill="var(--c)"/><rect x="108" y="44" width="14" height="26" fill="var(--o)"/><path fill="none" stroke="var(--o)" stroke-width="20" stroke-linecap="round" d="M70 140L124 108"/><path fill="none" stroke="var(--c)" stroke-width="10" stroke-linecap="round" d="M70 140L124 108"/><circle cx="134" cy="102" r="14" fill="var(--a)" stroke="var(--o)" stroke-width="6"/>')
add('net_hack', '駭入程式', G, f'<circle {S} cx="70" cy="80" r="40" fill="var(--b)"/><circle cx="70" cy="80" r="14" fill="var(--o)"/><path {S} fill="var(--c)" d="M98 104L172 160L158 176L144 166L134 178L120 166L130 154L84 120Z"/><path fill="none" stroke="var(--a)" stroke-width="8" stroke-linecap="round" d="M30 150L44 164M44 150L30 164" opacity="0"/><rect x="34" y="138" width="44" height="12" rx="6" fill="var(--a)"/>')
add('net_body', '構裝體', G, f'<path {S} fill="var(--b)" d="M66 26H134L146 60H54Z"/><rect {S} x="42" y="64" width="116" height="74" rx="10" fill="var(--c)"/><path {S} fill="var(--b)" d="M58 138H90V178H58ZM110 138H142V178H110Z"/><rect x="70" y="86" width="60" height="18" rx="9" fill="var(--o)"/><circle cx="100" cy="95" r="6" fill="var(--a)"/>')
add('net_unique', '專屬構裝', G, f'<path {S} fill="var(--b)" d="M100 18L122 72L180 76L136 114L150 172L100 140L50 172L64 114L20 76L78 72Z"/><rect {S} x="74" y="78" width="52" height="52" rx="6" fill="var(--c)"/><path fill="var(--o)" d="M86 90H114V118H86Z"/><rect x="94" y="98" width="12" height="12" fill="var(--a)"/>')
add('skin', 'SKIN', G, f'<path fill="none" stroke="var(--o)" stroke-width="16" stroke-linecap="round" d="M100 46V30Q100 20 112 22"/><path fill="none" stroke="var(--c)" stroke-width="7" stroke-linecap="round" d="M100 46V30Q100 20 112 22"/><path {S} fill="var(--b)" d="M100 46L170 86H30Z"/><path {S} fill="var(--c)" d="M64 86H136L150 176H50Z"/><path fill="none" stroke="var(--o)" stroke-width="6" stroke-dasharray="10 8" d="M60 116H140M58 146H142"/><rect x="92" y="100" width="16" height="16" fill="var(--a)"/>')

# ---------- 技能：六種種類的符號（疊在樹的底框上） ----------
K = {
    'active': ('主動', '<path fill="var(--c)" stroke="var(--o)" stroke-width="7" stroke-linejoin="round" d="M112 38L64 108H96L84 162L136 88H104Z"/>'),
    'passive': ('被動', '<path fill="var(--c)" stroke="var(--o)" stroke-width="7" stroke-linejoin="round" d="M100 40L148 58V100Q148 140 100 162Q52 140 52 100V58Z"/><path fill="none" stroke="var(--o)" stroke-width="7" d="M80 100L96 116L124 84"/>'),
    'reaction': ('反應', '<path fill="none" stroke="var(--o)" stroke-width="22" stroke-linecap="round" d="M60 80Q100 40 140 80M140 120Q100 160 60 120"/><path fill="none" stroke="var(--c)" stroke-width="12" stroke-linecap="round" d="M60 80Q100 40 140 80M140 120Q100 160 60 120"/><path fill="var(--c)" stroke="var(--o)" stroke-width="5" d="M150 64L146 96L118 80Z M50 136L54 104L82 120Z"/>'),
    'stance': ('姿態', '<path fill="var(--c)" stroke="var(--o)" stroke-width="7" stroke-linejoin="round" d="M62 40H76V160H62Z M76 46H140L124 72L140 98H76Z"/>'),
    'prep': ('預備', '<path fill="var(--c)" stroke="var(--o)" stroke-width="7" stroke-linejoin="round" d="M64 40H136V54Q136 82 108 100Q136 118 136 146V160H64V146Q64 118 92 100Q64 82 64 54Z"/><path fill="var(--o)" d="M84 146H116Q108 130 100 128Q92 130 84 146Z"/>'),
    'daily': ('日常', '<path fill="var(--c)" stroke="var(--o)" stroke-width="7" stroke-linejoin="round" d="M54 84H134V120Q134 156 94 156Q54 156 54 120Z"/><path fill="none" stroke="var(--o)" stroke-width="16" d="M134 96Q160 96 158 116Q156 134 134 132"/><path fill="none" stroke="var(--c)" stroke-width="7" d="M134 96Q160 96 158 116Q156 134 134 132"/><path fill="none" stroke="var(--c)" stroke-width="6" stroke-linecap="round" d="M80 70Q72 58 80 46M104 70Q96 58 104 46"/>'),
}
# 九棵樹的底框：形狀照容量的類（現實方、內海圓、社交菱、媒體星形、夜課心），顏色照 ART_STYLE 第 4 節
TREES = [
    ('gun', '槍手', 'square', '#C9B8E8'), ('pilot', '機師', 'square', '#C9B8E8'), ('surgeon', '改造師', 'square', '#C9B8E8'),
    ('runner', '潛網者', 'circle', '#45D6C5'), ('actor', '名媛', 'diamond', '#F2C14E'), ('broker', '掮客', 'diamond', '#F2C14E'),
    ('streamer', '主播', 'burst', '#B39DF0'), ('idol', '偶像', 'burst', '#B39DF0'), ('night', '夜課', 'heart', '#F06AA0'),
]
FRAME = {
    'square': '<path fill="{c}" stroke="var(--o)" stroke-width="8" d="M30 16H156L184 44V170Q184 184 170 184H44L16 156V30Q16 16 30 16Z"/>',
    'circle': '<circle cx="100" cy="100" r="84" fill="{c}" stroke="var(--o)" stroke-width="8"/>',
    'diamond': '<path fill="{c}" stroke="var(--o)" stroke-width="8" stroke-linejoin="round" d="M100 8L192 100L100 192L8 100Z"/>',
    'burst': '<path fill="{c}" stroke="var(--o)" stroke-width="8" stroke-linejoin="round" d="' + 'M' + 'L'.join(
        f'{100 + (88 if k % 2 == 0 else 70) * __import__("math").cos(__import__("math").radians(-90 + k * 22.5)):.1f} {100 + (88 if k % 2 == 0 else 70) * __import__("math").sin(__import__("math").radians(-90 + k * 22.5)):.1f}' for k in range(16)) + 'Z"/>',
    'heart': '<path fill="{c}" stroke="var(--o)" stroke-width="8" stroke-linejoin="round" d="M100 186C24 136 6 100 16 68Q30 26 72 30Q92 34 100 54Q108 34 128 30Q170 26 184 68Q194 100 100 186Z"/>',
}


BADGE = {  # 右下角的小徽記，區分同一類的樹
    'gun': '<circle cx="160" cy="160" r="11" fill="none" stroke="#F3E9FF" stroke-width="4"/><path d="M160 144V176M144 160H176" stroke="#F3E9FF" stroke-width="4"/>',
    'pilot': ''.join(f'<ellipse cx="160" cy="149" rx="5" ry="11" fill="#F3E9FF" transform="rotate({a} 160 160)"/>' for a in (0, 120, 240)) + '<circle cx="160" cy="160" r="4" fill="#17111F"/>',
    'surgeon': '<path d="M148 172L168 148Q176 146 174 154L154 178Z" fill="#F3E9FF"/>',
    'runner': '<path d="M146 170L148 148L158 158ZM174 170L172 148L162 158Z" fill="#F3E9FF"/><path d="M146 170Q160 180 174 170" fill="none" stroke="#F3E9FF" stroke-width="4"/>',
    'actor': '<path d="M146 152H174Q174 176 160 176Q146 176 146 152Z" fill="#F3E9FF"/><circle cx="154" cy="160" r="2.5" fill="#17111F"/><circle cx="166" cy="160" r="2.5" fill="#17111F"/>',
    'broker': '<circle cx="154" cy="160" r="9" fill="none" stroke="#F3E9FF" stroke-width="4"/><circle cx="166" cy="160" r="9" fill="none" stroke="#F3E9FF" stroke-width="4"/>',
    'streamer': '<circle cx="160" cy="160" r="12" fill="none" stroke="#F3E9FF" stroke-width="4"/><circle cx="160" cy="160" r="5" fill="#F06AA0"/>',
    'idol': '<path d="M160 145l4.4 9 9.9 1.4-7.2 7 1.7 9.8-8.8-4.6-8.8 4.6 1.7-9.8-7.2-7 9.9-1.4z" fill="#F3E9FF"/>',
    'night': '<path d="M166 146A15 15 0 1 0 172 170A11 11 0 1 1 166 146Z" fill="#F3E9FF"/>',
}


def skill_icons():
    out = []
    for tid, tname, shape, col in TREES:
        for kid, (kname, glyph) in K.items():
            cx, cy, w, h = CENTERS.get(f'glyph-{kid}', (100, 100, 100, 100))
            k = min(.6, 84 / max(w, h))  # 中間的符號一律縮到 84 以內，再把幾何中心對到 (100, 100)
            body = (FRAME[shape].format(c=col) + f'<g transform="translate(100 {106 if shape == "heart" else 100}) scale({k:.3f}) translate({-cx:.1f} {-cy:.1f})">{glyph}</g>'
                    + f'<circle cx="160" cy="160" r="22" fill="#17111F"/>{BADGE[tid]}')
            out.append((f'sk_{tid}_{kid}', f'{tname}・{kname}', tid, body))
    return out


CENTERS_PATH = os.path.join(OUT, 'icon-centers.json')
CENTERS = {}


def measure():
    """用瀏覽器量每個圖標的幾何外框（getBBox），存到 icon-centers.json。圖標或符號改了就跑一次 --measure。"""
    style = '<style>.s{stroke:var(--o);stroke-width:9;stroke-linejoin:round;stroke-linecap:round;paint-order:stroke}</style>'
    raw = [(i, b) for i, n, g, b in I] + [(f'glyph-{kid}', glyph) for kid, (kname, glyph) in K.items()]
    html = '<!doctype html><body>' + ''.join(f'<svg width="200" height="200" viewBox="0 0 200 200" style="--o:#000;--a:#f0a;--b:#888;--c:#eee"><defs>{style}</defs><g data-id="{i}">{b}</g></svg>' for i, b in raw) + '</body>'
    tmp = tempfile.mkdtemp()
    open(os.path.join(tmp, 'm.html'), 'w', encoding='utf-8').write(html)
    js = ("const {chromium}=require('playwright');(async()=>{const b=await chromium.launch();const p=await b.newPage();"
          f"await p.goto('file://{tmp}/m.html');"
          "const r=await p.evaluate(()=>Object.fromEntries([...document.querySelectorAll('g[data-id]')].map(g=>{const x=g.getBBox();return [g.dataset.id,[x.x+x.width/2,x.y+x.height/2,x.width,x.height].map(v=>Math.round(v*10)/10)]})));"
          "console.log(JSON.stringify(r));await b.close();})();")
    out = subprocess.run(['node', '-e', js], capture_output=True, text=True, check=True).stdout
    json.dump(json.loads(out), open(CENTERS_PATH, 'w'), indent=0, sort_keys=True)
    print('→ icon-centers.json')


def center(i, body):
    """把圖標的幾何中心對到 (100, 100)。"""
    cx, cy = CENTERS.get(i, (100, 100))[:2]
    dx, dy = 100 - cx, 100 - cy
    return body if abs(dx) < .5 and abs(dy) < .5 else f'<g transform="translate({dx:.1f} {dy:.1f})">{body}</g>'


def main():
    if '--measure' in sys.argv or not os.path.exists(CENTERS_PATH):
        measure()
    CENTERS.update(json.load(open(CENTERS_PATH)))
    I[:] = [(i, n, g, center(i, b)) for i, n, g, b in I]
    style = '<style>.s{stroke:var(--o);stroke-width:9;stroke-linejoin:round;stroke-linecap:round;paint-order:stroke}</style>'
    items = [f'<symbol id="ic-{i}" viewBox="0 0 200 200"><title>{n}</title>{b}</symbol>' for i, n, g, b in I]
    skills = [f'<symbol id="ic-{i}" viewBox="0 0 200 200"><title>{n}</title>{b}</symbol>' for i, n, g, b in skill_icons()]
    sprite = f'<svg xmlns="http://www.w3.org/2000/svg" style="display:none"><defs>{style}</defs>\n' + '\n'.join(items + skills) + '\n</svg>\n'
    open(os.path.join(OUT, 'icons-sprite.svg'), 'w', encoding='utf-8').write(sprite)

    # 總覽：物品（兩套皮）＋技能
    cols, cw, ch = 12, 100, 112
    rows_i = (len(I) + cols - 1) // cols
    skins = [('現實', '#17111F', '--o:#17111F;--a:#F06AA0;--b:#8E7CC3;--c:#F3E9FF', '#F3E9FF'),
             ('內海', '#F8C3D8', '--o:#1E2346;--a:#F06AA0;--b:#45D6C5;--c:#FFF4E8', '#1E2346')]
    W = cols * cw + 40
    parts, y = [], 70
    for sname, bg, vars_, ink in skins:
        h = rows_i * ch + 50
        parts.append(f'<rect x="0" y="{y}" width="{W}" height="{h}" fill="{bg}"/><text x="20" y="{y + 30}" font-size="16" font-weight="800" fill="{ink}">物品・{sname}皮（第 1、2 層，{len(I)} 個）</text><g style="{vars_}">')
        for k, (i, n, g, b) in enumerate(I):
            x, yy = 20 + (k % cols) * cw, y + 46 + (k // cols) * ch
            parts.append(f'<use href="#ic-{i}" x="{x + 18}" y="{yy}" width="64" height="64"/><text x="{x + 50}" y="{yy + 84}" text-anchor="middle" font-size="11" fill="{ink}">{n}</text>')
        parts.append('</g>')
        y += h
    sk = skill_icons()
    h = 9 * 92 + 50
    parts.append(f'<rect x="0" y="{y}" width="{W}" height="{h}" fill="#17111F"/><text x="20" y="{y + 30}" font-size="16" font-weight="800" fill="#F3E9FF">技能的備用圖標：九棵樹 × 六種種類（形狀：現實方、內海圓、社交菱、媒體星形、夜課心）</text><g style="--o:#17111F;--c:#F3E9FF">')
    for k, (i, n, t, b) in enumerate(sk):
        r, c = k // 6, k % 6
        x, yy = 20 + c * 190, y + 46 + r * 92
        parts.append(f'<use href="#ic-{i}" x="{x}" y="{yy}" width="64" height="64"/><text x="{x + 72}" y="{yy + 38}" font-size="12" fill="#C9B8E8">{n}</text>')
    parts.append('</g>')
    y += h
    svg = (f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {W} {y}" width="{W}" height="{y}" font-family="\'Noto Sans TC\',sans-serif">'
           f'<defs>{style}{"".join(items + skills)}</defs><rect width="{W}" height="70" fill="#17111F"/>'
           f'<text x="20" y="44" font-size="26" font-weight="900" fill="#F06AA0">圖標・第 1、2 層與技能的備用圖標</text>' + ''.join(parts) + '</svg>')
    open(os.path.join(OUT, 'icons-l2.svg'), 'w', encoding='utf-8').write(svg)
    open(os.path.join(ROOT, 'docs', 'mockups', 'icons-l2.svg'), 'w', encoding='utf-8').write(svg)  # 原型的總覽頁用
    print('→ icons-sprite.svg, icons-l2.svg', len(I), 'item icons,', len(sk), 'skill icons')


if __name__ == '__main__':
    main()
