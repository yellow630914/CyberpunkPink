#!/usr/bin/env python3
"""第 3 層圖標的生成清單：把 ITEMS、SKILL_TREES、NIGHT_LESSONS 裡的每一筆整理成一列，附英文提示詞，給 ComfyUI 批次跑。
每一列都寫好退回用的第 2 層圖標（icons-sprite.svg 的 ic-…），第 3 層還沒畫的先用它。
輸出：
  docs/art/icons/items.csv    物品
  docs/art/icons/skills.csv   技能（八棵樹＋夜課）
  docs/art/icons/glyphs.csv   基本功、傷害類型、設施的通用圖標（第 2 層就是成品；向量原稿在 subjects/basics.py）
欄位：id, 名字, 分類, 第2層, 等級, 牌子, 獨特, prompt, 備註
提示詞的寫法與負向提示詞在 ART_STYLE 5.1 節。英文主體是照中文名字裡的關鍵字推的，推不出來的用分類的主體；
要改某一筆，直接改 CSV 的 prompt 欄（重跑會蓋掉；手改的寫在 icons/overrides.csv，同樣的欄位，只放要改的列，重跑時會套上去）。
用法：python3 tools/art/icon_manifest.py"""
import csv, hashlib, os, re


def sid(prefix, name):
    """由名字算出固定的 id，順序變了也不會跑掉。"""
    return f'{prefix}_{hashlib.sha1(name.encode()).hexdigest()[:6]}'

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '../..'))
DOCS = os.path.join(ROOT, 'docs')
OUT = os.path.join(DOCS, 'art', 'icons')

STYLE = ('flat vector game icon, bold simple silhouette, 3 to 4 flat colors, thick dark outline with small gaps between shapes, '
         'cute cyberpunk, centered single object, isolated on plain flat background, no text, no letters')
PALETTE = 'dark purple outline, cream white and lavender body, one small hot-pink accent'

BRAND = [('緋櫻', 'sleek red-and-white Japanese corporate design'), ('星旗', 'military stencil design'), ('崑崙', 'jade-green Chinese tech design'),
         ('蜜腺', 'organic amber biotech design'), ('夜鶯', 'minimal teal network design'), ('萬華鏡', 'glossy prismatic media design'),
         ('伊甸園', 'luxury gold and black design'), ('黑泉', 'heavy industrial design'), ('織女', 'soft lavender consumer-electronics design'),
         ('甜心', 'cute pastel snack-brand design'), ('同人', 'hand-made DIY look with stickers and tape'), ('聖堂', 'occult hand-wired design'),
         ('鉻娘子', 'chrome biker custom design'), ('胭脂堂', 'traditional red-lacquer design'), ('拆體客', 'salvaged scrap design'),
         ('天使', 'clean white medical design'), ('貞網局', 'bureaucratic steel-blue design')]

KW = [  # 中文關鍵字 → 英文主體（先比對的先用）
    ('狙擊', 'a sniper rifle'), ('步槍', 'an assault rifle'), ('霰彈', 'a shotgun'), ('衝鋒', 'a compact submachine gun'), ('機槍', 'a heavy machine gun'),
    ('火箭', 'a rocket launcher'), ('手槍', 'a handgun'), ('彈槍', 'a sensory dart pistol'), ('電擊', 'a stun baton'), ('劍', 'a sword'), ('刀', 'a blade knife'),
    ('鞭', 'a whip'), ('棍', 'a baton'), ('爪', 'cyber claws'), ('彈', 'a cartridge round'), ('手榴', 'a grenade'), ('煙霧', 'a smoke grenade'), ('閃光', 'a flashbang'),
    ('外套', 'a jacket'), ('大衣', 'a long coat'), ('風衣', 'a trench coat'), ('夾克', 'a jacket'), ('披肩', 'a shawl'), ('裙', 'a skirt'), ('褲', 'trousers'),
    ('襯衫', 'a shirt'), ('背心', 'a vest top'), ('上衣', 'a top'), ('洋裝', 'a dress'), ('連身', 'a one-piece outfit'), ('旗袍', 'a qipao dress'), ('皮帶裝', 'a vest top'), ('針織', 'a top'), ('兔女郎', 'a swimsuit'), ('兔男郎', 'a vest top'), ('總管', 'a maid uniform'), ('浴衣', 'a kimono'), ('水手', 'a shirt'), ('比基尼', 'a swimsuit'), ('盔甲', 'a helmet'), ('全甲', 'a helmet'), ('束衣', 'a dress'), ('圍裙', 'a frilly apron'), ('禮服', 'a dress'), ('睡裙', 'a dress'), ('帽T', 'a hood'), ('吉祥物', 'a mask'), ('刺青', 'a glowing skin tattoo patch'), ('胸帶', 'a vest top'), ('西裝', 'a shirt'), ('燕尾', 'a shirt'), ('飛行', 'a jacket'), ('和服', 'a kimono'),
    ('女僕', 'a maid uniform'), ('制服', 'a uniform'), ('泳裝', 'a swimsuit'), ('靴', 'boots'), ('鞋', 'shoes'), ('襪', 'stockings'), ('手套', 'gloves'),
    ('帽', 'a cap'), ('兜帽', 'a hood'), ('盔', 'a helmet'), ('面具', 'a mask'), ('口罩', 'a face mask'), ('眼鏡', 'glasses'), ('面紗', 'a veil'),
    ('內衣', 'a bra'), ('內褲', 'panties'), ('項圈', 'a choker collar'), ('項鍊', 'a necklace'), ('戒指', 'a ring'), ('耳環', 'earrings'), ('手環', 'a bracelet'),
    ('腿環', 'a thigh garter'), ('髮飾', 'a hair ornament'), ('胸針', 'a brooch'), ('錶', 'a wristwatch'), ('腰鍊', 'a waist chain'),
    ('義眼', 'a cybernetic eye'), ('義臂', 'a cybernetic arm'), ('義腿', 'a cybernetic leg'), ('甲板', 'a cyberdeck'), ('晶片', 'a microchip'),
    ('神經', 'a glowing neuron node'), ('軟體', 'a software cartridge'), ('骨', 'a bone plate'), ('甲殼', 'a chitin shell plate'), ('板', 'an armor plate'),
    ('肌', 'artificial muscle fibers'), ('致動', 'a hydraulic actuator'), ('感測', 'a sensor lens'), ('耳蝸', 'an audio implant'), ('電源', 'a power cell'),
    ('電池', 'a battery'), ('腺', 'a biological gland'), ('皮', 'a skin swatch'), ('毛皮', 'a fur swatch'), ('槍管', 'a gun barrel'), ('機構', 'a gear mechanism'),
    ('刃', 'a blade'), ('棘', 'a spike'), ('纖維', 'a spool of fiber'), ('蛛絲', 'a spool of spider silk'), ('藥', 'a pill'), ('針', 'an injector syringe'),
    ('貼', 'a medical patch'), ('糖', 'a candy'), ('酒', 'a bottle'), ('箱', 'a crate'), ('工具', 'a tool kit'), ('扳手', 'a wrench'), ('無人機', 'a small drone'),
    ('天線', 'an antenna'), ('帶', 'a cassette tape'), ('繩', 'a coil of rope'), ('鎖', 'a padlock'), ('鈴', 'a small bell'), ('羽毛', 'a feather'),
]
L2_SUBJECT = {
    'part_chip': 'a microchip', 'part_neuron': 'a glowing neuron node', 'part_software': 'a software cartridge', 'part_plate': 'an armor plate',
    'part_actuator': 'a hydraulic actuator', 'part_sensor': 'a sensor lens', 'part_power': 'a power cell', 'part_skin': 'a synthetic skin swatch',
    'part_barrel': 'a gun barrel', 'part_mech': 'a gear mechanism', 'part_blade': 'a blade', 'part_fiber': 'a spool of fiber', 'bp': 'a rolled blueprint',
    'drug': 'a pill capsule', 'ammo': 'bullets', 'consumable': 'a first-aid kit', 'cargo': 'a cargo crate', 'tool': 'a tool', 'adult': 'a heart-shaped gift box with a ribbon',
    'carry_main': 'a rifle', 'carry_side': 'a handgun', 'carry_melee': 'a knife', 'slot_armor': 'a tactical vest', 'acc_ring': 'a ring', 'acc_neck': 'a choker',
    'acc_leg': 'a thigh garter', 'slot_top': 'a top', 'slot_bottom': 'a skirt', 'slot_coat': 'a jacket', 'slot_shoes': 'boots', 'slot_head': 'a cap',
    'slot_face': 'a mask', 'slot_hands': 'gloves', 'slot_bra': 'a bra', 'slot_panties': 'panties',
    'cw_bridge': 'a neural port implant', 'cw_brain': 'a brain implant', 'cw_eye': 'a cybernetic eye', 'cw_earthroat': 'an ear implant', 'cw_torso': 'a torso implant',
    'cw_skin': 'a glowing skin tattoo patch', 'cw_arm': 'a cybernetic arm', 'cw_leg': 'a cybernetic leg', 'cw_intimate': 'a heart-shaped lock', 'unknown': 'a mystery box',
}
PART = [('橋', 'cw_bridge'), ('腦', 'cw_brain'), ('眼', 'cw_eye'), ('耳', 'cw_earthroat'), ('喉', 'cw_earthroat'), ('軀幹', 'cw_torso'), ('皮膚', 'cw_skin'),
        ('臂', 'cw_arm'), ('手', 'cw_arm'), ('腿', 'cw_leg'), ('私密', 'cw_intimate')]
SECTION_L2 = {'2.1': 'part_chip', '2.2': 'part_neuron', '2.3': 'part_software', '2.4': 'part_plate', '2.5': 'part_actuator', '2.6': 'part_sensor',
              '2.7': 'part_power', '2.8': 'part_skin', '2.9': 'part_barrel', '2.10': 'part_mech', '2.11': 'part_blade', '2.12': 'part_fiber',
              '3.1': 'bp', '3.2': 'carry_main', '3.3': 'slot_armor', '3.4': 'bp', '4': 'drug', '4.1': 'drug', '4.2': 'drug', '5.1': 'ammo', '5.2': 'consumable',
              '5.3': 'cargo', '6': 'tool', '7.1': 'slot_top', '7.2': 'acc_ring', '7.3': 'adult',
              '11.2': 'net_weapon', '11.3': 'net_defense', '11.4': 'net_tool', '11.5': 'net_hack', '11.6': 'net_body', '11.8': 'skin'}
WEAR = [('內褲', 'slot_panties'), ('丁字', 'slot_panties'), ('胸罩', 'slot_bra'), ('內衣', 'slot_bra'), ('外套', 'slot_coat'), ('大衣', 'slot_coat'),
        ('夾克', 'slot_coat'), ('風衣', 'slot_coat'), ('披肩', 'slot_coat'), ('裙', 'slot_bottom'), ('褲', 'slot_bottom'), ('腰卷', 'slot_bottom'), ('袴', 'slot_bottom'),
        ('靴', 'slot_shoes'), ('鞋', 'slot_shoes'), ('帽', 'slot_head'), ('頭帶', 'slot_head'), ('盔', 'slot_head'), ('髮', 'slot_head'), ('眼鏡', 'slot_face'),
        ('面罩', 'slot_face'), ('面具', 'slot_face'), ('口罩', 'slot_face'), ('面紗', 'slot_face'), ('手套', 'slot_hands')]
ITEM_HEADS = {'零件', '道具', '名字', '名稱', '飾品', '設計圖', '型號', '藥（街名）', '彈種', '東西', '貨物', '工具'}
GRADES = {'I', 'II', 'III', 'IV', 'V'}
NET_ARCH = {'近戰': 'a sword', '鞭': 'a whip', '手槍': 'a handgun', '衝鋒槍': 'a compact submachine gun', '霰彈槍': 'a shotgun', '步槍': 'a rifle',
            '狙擊槍': 'a sniper rifle', '輕機槍': 'a heavy machine gun', '重型': 'a rocket launcher', '干擾': 'an antenna'}
NET_NAME = {'客服窗': 'an armor plate', '散熱罩': 'a power cell', '聖盾': 'an armor plate', '誘餌': 'a heart-shaped gift box with a ribbon', '懺悔室': 'a padlock',
            '貞潔鎖': 'a heart-shaped lock', '光學迷彩': 'a veil', '探針': 'a sensor lens', '後門鑰匙': 'a padlock', '雜訊產生器': 'an antenna',
            '冷卻扇': 'a battery', '鏡像': 'glasses', '拆釘鉗': 'a tool', '回填器': 'a memory chip', '熔斷保險': 'a power cell', '鉤索': 'a coil of rope',
            '破城槌': 'a wrench', '泥瓦匠': 'a crate', '拆遷隊': 'a grenade', '斷路器': 'a microchip', '王座': 'a cyberdeck', '拖把': 'a feather',
            '紅點': 'a sensor lens', '改寫': 'a rolled blueprint', '執事・家政課': 'a shirt', '夜禮服': 'a dress', '泳裝・樂園島': 'a swimsuit', '薄紗': 'a veil', '守門人': 'a helmet', '巨大少女': 'a small drone', '天使像': 'a small bell', '鐵處女': 'a cybernetic arm'}
SKIN_STYLE = {'企業': 'a uniform', '街頭': 'a hood', '霓虹龐克': 'a jacket', '虛擬主播': 'headphones', '偶像': 'a dress', '女僕': 'a maid uniform',
              '櫻町系': 'a kimono', '仙俠': 'a qipao dress', '護士': 'a one-piece outfit', '修女': 'a veil', '騎士': 'a helmet', '巫女': 'a kimono',
              '魔法少女': 'a skirt', '歡場': 'a swimsuit', '特攻': 'a long coat', '哥德': 'a dress', '角色扮演': 'a mask', '自選': 'a clothes hanger',
              '畫報系': 'a jacket', '工裝': 'a one-piece outfit', '荒地': 'a hood', '任俠': 'a jacket', '高訂': 'a dress'}


def tables(path):
    """逐表讀出 (目前的節號, 標題列, 每一列)。"""
    lines = open(path, encoding='utf-8').read().split('\n')
    sec, i = '', 0
    while i < len(lines):
        l = lines[i]
        m = re.match(r'^#{2,4}\s+(\d+(?:\.\d+)?)', l)
        if m:
            sec = m.group(1)
        if l.startswith('| ') and i + 1 < len(lines) and re.match(r'^\|[-| ]+\|$', lines[i + 1]):
            head = [x.strip() for x in l.strip().strip('|').split('|')]
            rows, j = [], i + 2
            while j < len(lines) and lines[j].startswith('|'):
                rows.append([x.strip() for x in lines[j].strip().strip('|').split('|')])
                j += 1
            yield sec, head, rows, i
            i = j
            continue
        i += 1


def plain(s):
    return re.sub(r'\*\*|\[([^\]]+)\]\([^)]+\)', lambda m: m.group(1) or '', s).strip()


def subject_for(name, l2, extra=''):
    for k, v in KW:
        if k in name or (extra and k in extra):
            return v
    return L2_SUBJECT.get(l2, 'an item')


def l2_for(sec, head, row, name):
    l2 = SECTION_L2.get(sec) or SECTION_L2.get(sec.split('.')[0], 'unknown')
    joined = ' '.join(row)
    if sec in ('3.1',) or sec.startswith('12') or sec.startswith('13'):
        for k, v in PART:
            if k in joined:
                return v
    if sec == '3.2' or ((sec.startswith('12') or sec.startswith('13')) and re.search('槍|刀|劍|刃', joined)):
        if re.search('手槍|衝鋒|彈槍|電擊', name + joined):
            return 'carry_side'
        if re.search('刀|劍|鞭|棍|刃', name):
            return 'carry_melee'
        return 'carry_main'
    if sec in ('7.1', '3.3'):
        for k, v in WEAR:
            if k in name:
                return v if sec == '7.1' or v in ('slot_face', 'slot_head', 'slot_hands', 'slot_shoes') else 'slot_armor'
    if sec == '7.2':
        for k, v in [('項圈', 'acc_neck'), ('項鍊', 'acc_neck'), ('頸', 'acc_neck'), ('腿', 'acc_leg'), ('襪', 'acc_leg')]:
            if k in name:
                return v
    if sec.startswith('12') or sec.startswith('13'):
        for k, v in [('晶片', 'part_chip'), ('神經', 'part_neuron'), ('軟體', 'part_software'), ('板', 'part_plate'), ('致動', 'part_actuator'), ('肌', 'part_actuator'),
                     ('感測', 'part_sensor'), ('電源', 'part_power'), ('外皮', 'part_skin'), ('皮', 'part_skin'), ('槍管', 'part_barrel'), ('機構', 'part_mech'),
                     ('刃', 'part_blade'), ('纖維', 'part_fiber')]:
            if k in joined:
                return v
    return l2


def items():
    out, seen = [], set()
    for sec, head, rows, idx in tables(os.path.join(DOCS, 'gear', 'ITEMS.md')):
        if head[0] not in ITEM_HEADS:
            continue
        hi = {h: k for k, h in enumerate(head)}
        for r in rows:
            if not r or not r[0] or set(r[0]) <= set('-—'):
                continue
            for name in [plain(n) for n in r[0].split('／')]:
                if not name or name in seen:
                    continue
                seen.add(name)
                grade = next((c for c in r if c in GRADES), '') or next((c.split('～')[-1] for c in r if '～' in c and c.split('～')[-1] in GRADES), '')
                brand = r[hi['牌子']] if '牌子' in hi and hi['牌子'] < len(r) else ''
                unique = sec.startswith('12') or sec.startswith('13')
                net = sec.startswith('11.')
                l2 = l2_for(sec, head, r, name)
                subj = subject_for(name, l2)
                if sec.startswith('11.'):
                    bare = re.sub(r'^(構裝|構裝體|程式)「|」$', '', name)
                    kw = next((v for k, v in KW if k in bare), None)
                    subj = (NET_ARCH.get(r[hi['原型']]) if '原型' in hi else None) or NET_NAME.get(bare) or kw or \
                           (SKIN_STYLE.get(r[hi['風格']]) if '風格' in hi else None) or subj
                bstyle = next((v for k, v in BRAND if k in brand or k in name), '')
                detail = {'I': 'very simple', 'II': 'simple', 'III': 'moderately detailed', 'IV': 'detailed', 'V': 'intricate'}.get(grade, 'simple')
                prompt = ', '.join(x for x in [STYLE, f'{subj}', bstyle, f'{detail} shape', 'ornate one-of-a-kind artifact with a faint violet glow' if unique else '', 'holographic digital program look with pixel edges and a cyan glow' if net else '', PALETTE] if x)
                out.append({'id': sid('it', name), '名字': name, '分類': f'ITEMS {sec}', '第2層': f'ic-{l2}', '等級': grade, '牌子': brand,
                            '獨特': '是' if unique else '', 'prompt': prompt, '備註': ''})
    return out


TREE = {'槍手': ('gun', 'crosshair'), '機師': ('pilot', 'drone and mech'), '改造師': ('surgeon', 'scalpel and cybernetics'), '潛網者': ('runner', 'cat-ear netrunner headset and circuits'),
        '名媛': ('actor', 'theater mask'), '掮客': ('broker', 'handshake and coins'), '主播': ('streamer', 'live camera'), '偶像': ('idol', 'microphone and star'),
        '夜課': ('night', 'crescent moon and heart')}
KIND = {'主動': 'active', '被動': 'passive', '反應': 'reaction', '姿態': 'stance', '預備': 'prep', '日常': 'daily'}
SKW = [('射擊', 'a gunshot muzzle flash'), ('要害', 'a crosshair on a weak point'), ('掩護', 'a protective shield'), ('換位', 'two swapping arrows'), ('彈匣', 'an ammo magazine'),
       ('遮蔽', 'a cover wall'), ('先攻', 'a stopwatch'), ('行動點', 'a lightning gauge'), ('壓制', 'suppressive bullet spray'), ('近戰', 'a knife slash'),
       ('無人機', 'a small drone'), ('機甲', 'a mech frame'), ('同步', 'linked neural waves'), ('治療', 'a medical cross'), ('急救', 'a medical cross'),
       ('義體', 'a cybernetic arm'), ('手術', 'a scalpel'), ('RAM', 'a memory chip'), ('快駭', 'a hacking code bracket'), ('破冰', 'a cracking ice crystal'),
       ('接管', 'a takeover cursor'), ('追蹤', 'a radar sweep'), ('蕾絲', 'a lace firewall pattern'), ('編輯點', 'an editing pen'), ('聲量', 'a megaphone'),
       ('風向', 'a weather vane'), ('格子', 'a flag on a tile'), ('佔', 'a flag on a tile'), ('勸降', 'a white flag'), ('標記', 'a target mark'), ('人情', 'a handshake'),
       ('錢', 'coins'), ('感載', 'a pink nerve spark'), ('過載', 'an overloaded spark burst'), ('誘惑', 'a wink'), ('表演', 'a spotlight'), ('人格', 'a theater mask'),
       ('直播', 'a live camera'), ('應援', 'glowsticks'), ('親衛隊', 'a fan club banner'), ('素材', 'a film reel'), ('隊友', 'two allied figures')]


def skills():
    out = []
    path = os.path.join(DOCS, 'content', 'SKILL_TREES.md')
    tree = ''
    text = open(path, encoding='utf-8').read().split('\n')
    tree_at = {}
    for i, l in enumerate(text):
        m = re.match(r'^## (\S+)：', l)
        if m:
            tree_at[i] = m.group(1)
    lines_tree = []
    cur = ''
    for i in range(len(text)):
        cur = tree_at.get(i, cur)
        lines_tree.append(cur)
    for sec, head, rows, idx in tables(path):
        if head[:3] != ['技能', '層', '種類']:
            continue
        tname = lines_tree[idx]
        tier = ''
        for k in range(idx, 0, -1):
            m = re.match(r'^### (\d) 階', text[k])
            if m:
                tier = m.group(1)
                break
        tid, motif = TREE.get(tname, ('', 'emblem'))
        for r in rows:
            name, kind = plain(r[0]), r[2] if len(r) > 2 else ''
            effect = ' '.join(r[7:10]) if len(r) > 9 else ' '.join(r)
            subj = next((v for k, v in SKW if k in effect or k in name), 'an abstract power symbol')
            prompt = ', '.join([STYLE.replace('game icon', 'game skill icon').replace('single object', 'single symbol'), f'{subj}', f'{motif} theme', f'{KIND.get(kind, "active")} ability', PALETTE])
            out.append({'id': sid(f'sk_{tid}', tname + name), '名字': name, '分類': f'{tname} {tier} 階', '第2層': f'ic-sk_{tid}_{KIND.get(kind, "active")}',
                        '等級': tier, '牌子': '', '獨特': '招牌' if '招牌' in r[1] else '', 'prompt': prompt, '備註': ''})
    # 夜課：提示詞只用抽象的符號，不畫人體
    path = os.path.join(DOCS, 'content', 'NIGHT_LESSONS.md')
    text = open(path, encoding='utf-8').read().split('\n')
    for sec, head, rows, idx in tables(path):
        if head[0] != '技能' or '掛在' not in head:
            continue
        branch, tier = '', ''
        for k in range(idx, 0, -1):
            if not tier:
                m = re.match(r'^\*\*(\d) 階\*\*', text[k])
                if m:
                    tier = m.group(1)
            m = re.match(r'^## (\S+)', text[k])
            if m:
                branch = m.group(1)
                break
        hi = {h: k for k, h in enumerate(head)}
        for r in rows:
            name = plain(r[0])
            use = r[hi['用法']] if '用法' in hi and hi['用法'] < len(r) else ''
            kind = next((v for k, v in KIND.items() if k in use), 'active')
            if '體位' in use:
                subj = 'two abstract interlocking shapes'
            else:
                subj = next((v for k, v in [('說', 'a speech bubble with a heart'), ('看', 'a winking eye'), ('摸', 'a gentle hand with sparkles'), ('口', 'a lipstick mark'),
                                            ('綁', 'a silk ribbon bow'), ('標記', 'a small heart stamp'), ('穿', 'a dress on a hanger'), ('鏡頭', 'a camera with a heart')] if k in name + ' ' + ' '.join(r[1:2])), 'an abstract heart symbol')
            prompt = ', '.join([STYLE.replace('game icon', 'game skill icon').replace('single object', 'single symbol'), subj, 'crescent moon and heart theme', f'{kind} ability',
                                'tasteful, non-explicit, symbolic only', PALETTE])
            out.append({'id': sid('sk_night', name), '名字': name, '分類': f'夜課・{branch} {tier} 階', '第2層': f'ic-sk_night_{kind}', '等級': tier,
                        '牌子': '', '獨特': '', 'prompt': prompt, '備註': '只用抽象符號，不畫人體'})
    return out


def glyphs():
    """基本功、傷害類型、設施。先拿規則文件的表對 subjects/basics.py 的清單，對不上就印出來。"""
    import sys
    sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
    from subjects.basics import BASICS, DAMAGE, FACILITIES
    want = {
        '基本功': ('systems/CORE_RULES.md', '基本功', BASICS),
        '傷害類型': ('systems/COMBAT_SYSTEM.md', '類型', DAMAGE),
        '設施': ('systems/TRADE.md', '種類', [r for r in FACILITIES if r[3] == 'TRADE']),
    }
    for g, (doc, col, rows) in want.items():
        names = []
        for sec, head, trs, idx in tables(os.path.join(DOCS, doc)):
            if head and col in head and (g != '設施' or sec == '2') and (g != '傷害類型' or '打哪一條' in head):
                k = head.index(col)
                names += [re.sub(r'（.*?）', '', plain(r[k])) for r in trs if len(r) > k and plain(r[k])]
        have = {r[1] for r in rows}
        miss, extra = [n for n in names if n not in have], [n for n in have if n not in names]
        if miss or extra:
            print(f'  {g}：文件有、圖標沒有 {miss}；圖標有、文件沒有 {extra}')
    out = []
    for g, src, rows in (('基本功', 'CORE_RULES 第 2 節', BASICS), ('傷害類型', 'COMBAT_SYSTEM 第 5 節', DAMAGE), ('設施', None, FACILITIES)):
        for r in rows:
            note = src or ('TRADE 第 2 節的商店種類' if r[3] == 'TRADE' else '從 DOWNTIME 第 4 節與 SITES 的街區設施歸出來的')
            out.append({'id': r[0], '名字': r[1], '分類': g, '第2層': f'ic-{r[0]}', '等級': '', '牌子': '', '獨特': '',
                        'prompt': ', '.join([STYLE.replace('single object', 'single symbol'), r[2], PALETTE]), '備註': note})
    return out


def overrides():
    path = os.path.join(OUT, 'overrides.csv')
    if not os.path.exists(path):
        return {}
    return {r['id']: r for r in csv.DictReader(open(path, encoding='utf-8-sig'))}


def write(name, rows):
    os.makedirs(OUT, exist_ok=True)
    ov = overrides()
    rows = [{**r, **{k: v for k, v in ov.get(r['id'], {}).items() if v}} for r in rows]
    with open(os.path.join(OUT, name), 'w', encoding='utf-8-sig', newline='') as f:
        w = csv.DictWriter(f, fieldnames=['id', '名字', '分類', '第2層', '等級', '牌子', '獨特', 'prompt', '備註'])
        w.writeheader()
        w.writerows(rows)
    print('→', name, len(rows))


if __name__ == '__main__':
    write('items.csv', items())
    write('skills.csv', skills())
    write('glyphs.csv', glyphs())
