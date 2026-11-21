"""ITEMS.md 的檢查（docs/systems/BALANCE.md 1.4、2.9、2.10 節）。sim.py 的 `items` 主題呼叫這裡。

逐表讀 docs/gear/ITEMS.md，對照每一節自己寫的公式：
- 零件（第 2 節）：份量照等級（I 0.5、II 1、III 1.5、IV 2；生體低一級）；屬性括號裡的格數合計＝份量；
  武器零件（2.9～2.11 節）照 2.9 節的換算表算；目錄價＝等級基準 × 類型係數 × 牌子係數 × 生體 2（1.3 節）。
- 設計圖（第 3 節）：授權＝基準 × 2 × 牌子；成品＝必要槽的同級零件合計 × 1.2 × 型係數（1.4 節）。
- 藥（4.2 節）：份量的前一半是持續型或立即型的預算；價＝基準 × 0.2 × 牌子，取整到 5 或 10。
- 飾品（7.2 節）：價＝基準（記號 40、功能 250、0.5 格 80、1 格 320，貴金屬 +300）× 牌子 × 合法係數。
- SKIN（11.8 節）：價＝風格值的基準（40／150／500／1,600）× 1.2 × 牌子；風格值 5 不賣。
允許的誤差（2026-11-21 確認，BALANCE 第 8 節第 9、14 項；ITEMS 1.3 節與第 2 節開頭）：
- 價 6%（取整）。IV 級的等級基準是 6,000 ±1,000：IV 級的價照 5,000～7,000 之間的任何一個基準算都算合（曲線是 5,100）。
- 份量：寫的份量要等於那一級的預算（不打折）；效果折成的格和寫的份量可以差 ±0.5 格（沒有算格的小特性落在這裡）。
"""
import re

BRAND = {'織女': .9, '星旗': .9, '崑崙': 1.1, '緋櫻': 1.5, '夜鶯': 1.3, '伊甸園': 1.3, '萬華鏡': 1.2, '無牌': .8,
         '黑泉': 1.3, '蜜腺': 1.0, '鉻娘子改': 1.0, '胭脂堂的師傅': 1.5, '聖堂': 1.2, '同人': .7, '白手套': 1.3,
         '玻璃岸的工坊': 1.5, '特攻': 1.2, '天使急救': 1.2}
BASE = {'I': 150, 'II': 500, 'III': 1600, 'IV': 6000}
PART_TYPE = {'2.1': 1.5, '2.2': 1.5, '2.3': 1.0, '2.4': .4, '2.5': 1.0, '2.6': 1.0, '2.7': .6, '2.8': .6,
             '2.9': .3, '2.10': .3, '2.11': .4, '2.12': .6}
SLOT_TYPE = {'晶片': 1.5, '神經節': 1.5, '神經元': 1.5, '活體神經': 1.5, '軟體': 1, '基因譜': 1, '配分的譜': 1,
             '板材': .4, '骨': .4, '甲殼': .4, '致動器': 1, '培養肌': 1, '感測器': 1, '感官': 1, '電源': .6,
             '代謝腺': .6, '外皮': .6, '活皮': .6, '毛皮': .6, '槍管': .3, '機構': .3, '刃': .4, '爪': .4,
             '棘': .4, '纖維': .6, '蛛絲': .6}
WEAPON_TYPE = {'衝鋒槍': 1.5, '霰彈槍': 1.5, '步槍': 2.8, '狙擊': 2.8, '輕機槍': 2.8, '重武器': 2.8}
BUDGET = {'I': .5, 'II': 1, 'III': 1.5, 'IV': 2, 'V': 3}
BIO_BUDGET = {'I': .5, 'II': .5, 'III': 1, 'IV': 1.5, 'V': 2}
PRICE_TOL = 0.06
BASE_TOL = {'IV': 1000}    # IV 級的基準 6,000 ±1,000（2026-11-21 確認）
WEIGHT_TOL = 0.5           # 效果折成的格與寫的份量之間，允許差半格（2026-11-21 確認）


def base_range(g):
    t = BASE_TOL.get(g, 0)
    return BASE[g] - t, BASE[g] + t


def price_ok(price, g, factor, tol=PRICE_TOL, slack=10):
    """價＝基準 × factor，基準可以在 base_range 之內，再加 tol 的取整誤差（或 slack 元以內）。"""
    lo, hi = (b * factor for b in base_range(g))
    return lo * (1 - tol) - slack <= price <= hi * (1 + tol) + slack


def brand(b):
    for k in sorted(BRAND, key=len, reverse=True):
        if b.startswith(k):
            return BRAND[k]
    return None


def num(s):
    m = re.search(r'-?\d+(?:\.\d+)?', s.replace(',', '').replace('−', '-'))
    return float(m.group()) if m else None


def rows(lines, start_pat, stop_pat, head):
    """(行號, dict) — start_pat 那一節到 stop_pat 之前、表頭以 head 開頭的表。"""
    hdr, on = None, False
    for i, l in enumerate(lines):
        if re.match(start_pat, l):
            on = True
            continue
        if on and re.match(stop_pat, l):
            on = False
        if not on:
            continue
        if l.startswith('| ' + head):
            hdr = [c.strip() for c in l.strip().strip('|').split('|')]
            continue
        if hdr and l.startswith('| ') and not l.startswith('|---'):
            c = [x.strip() for x in l.strip().strip('|').split('|')]
            if len(c) == len(hdr):
                yield i + 1, dict(zip(hdr, c))


def weapon_part_value(a):
    """武器零件的格（ITEMS 2.9 節的換算）：(得到的格, 代價退的格)。"""
    main, _, cost = a.partition('代價')
    v = 0.0
    for t in re.split(r'[；;。]', main):
        t = t.strip()
        m = re.search(r'傷害 \+(\d)d6', t)
        if m:
            v += 2 * int(m.group(1))
            continue
        m, m2 = re.search(r'傷害 \+(\d+)', t), re.search(r'穿甲 \+(\d+)', t)
        v += (0.5 * int(m.group(1)) if m else 0) + (int(m2.group(1)) if m2 else 0)
        if m or m2:
            continue
        if '適用距離' in t and '延' in t: v += 1
        elif (m := re.search(r'遮蔽倍率 \+([\d.]+)', t)): v += 2 * float(m.group(1))
        elif t.startswith('無聲') or t.startswith('不卡彈'): v += .5
        elif (m := re.search(r'壓制 DC \+(\d)', t)): v += .5 * int(m.group(1))
        elif '彈匣 +1 格' in t: v += 2
        elif '合計只花 1 點' in t or '只花 2 格' in t or '不另外花行動點' in t: v += 1
        elif '不花行動點' in t or '少花 1 行動點' in t: v += 2
        elif '傷害類型改成' in t: v += 2
    c = 0.0
    for t in re.split(r'[；;]', cost):
        if not t.strip(' ：:'):
            continue
        c += 1 if ('怪癖' in t or '過熱' in t or '彈匣 −1' in t or ('命中 −1' in t and '致動器' not in t)) else .5
    return v, min(c, 1)


def audit(path):
    lines = open(path, encoding='utf-8').read().split('\n')
    out = []
    # 零件
    sec = None
    for i, l in enumerate(lines):
        m = re.match(r'### (2\.\d+) ', l)
        if m:
            sec = m.group(1)
        elif l.startswith('## '):
            sec = None
        if not sec or not l.startswith('| ') or l.startswith('| 零件') or l.startswith('|---'):
            continue
        c = [x.strip() for x in l.strip().strip('|').split('|')]
        if len(c) < 8 or c[3] not in BUDGET:
            continue
        hdr_cols = 10 if sec == '2.8' else (9 if sec == '2.4' else 8)
        if len(c) != hdr_cols:
            continue
        name, br, mat, g = c[0], c[1], c[2], c[3]
        attrs, w, price = c[-4], num(c[-3]), num(c[-1])
        bio = mat == '生'
        bud = (BIO_BUDGET if bio else BUDGET)[g]
        if w is not None and abs(w - bud) > 1e-9:
            out.append((i + 1, '零件', name, f'份量 {w:g}，{g} 級{"生體" if bio else ""}的預算是 {bud:g}'))
        vals = [float(x.replace('−', '-')) for x in re.findall(r'（(−?\d+(?:\.\d+)?)(?:[，,][^）]*)?）', attrs)]
        if sec in ('2.9', '2.10', '2.11'):
            v, cst = weapon_part_value(attrs)
            v += sum(vals)   # 換算表沒有的效果，條目自己在括號裡寫了格數
            if abs(v - cst - w) > WEIGHT_TOL + 1e-9:
                out.append((i + 1, '零件', name, f'照 2.9 節的換算是 {v:g} − {cst:g} ＝ {v - cst:g} 格，寫 {w:g}'))
        elif vals and abs(sum(vals) - w) > WEIGHT_TOL + 1e-9 and '價錢 ×' not in attrs:
            out.append((i + 1, '零件', name, f'括號的格合計 {sum(vals):g}，份量寫 {w:g}'))
        b = brand(br)
        if b and g in BASE and price and '價錢 ×' not in attrs:
            factor = PART_TYPE[sec] * b * (2 if bio else 1)
            if not price_ok(price, g, factor):
                out.append((i + 1, '零件', name, f'價 {price:g}，公式 {BASE[g] * factor:.0f}'))
    # 設計圖
    sec, wt, hdr = None, 1, []
    for i, l in enumerate(lines):
        m = re.match(r'### (3\.\d) ', l)
        if m:
            sec, wt = m.group(1), 1
            continue
        if l.startswith('## '):
            sec = None
        if not sec or not l.startswith('| ') or l.startswith('|---'):
            continue
        if l.startswith('| 設計圖'):
            hdr = [x.strip() for x in l.strip().strip('|').split('|')]
            continue
        c = [x.strip() for x in l.strip().strip('|').split('|')]
        if c[0].startswith('**'):
            wt = next((v for k, v in WEAPON_TYPE.items() if k in c[0]), 1)
            continue
        if '必要的槽' not in hdr or len(c) != len(hdr):
            continue
        r = dict(zip(hdr, c))
        b = brand(r['牌子'])
        if b is None:
            continue
        slots = []
        for t in r['必要的槽'].split('＋'):
            mk = re.search(r'×\s*(\d)', t)
            k = int(mk.group(1)) if mk else 1
            bio_slot = '生' in t or ('皆' in t and r['牌子'] == '蜜腺')
            tc = next((SLOT_TYPE[x] for x in sorted(SLOT_TYPE, key=len, reverse=True) if x in t), None)
            slots.append((tc, bio_slot, k))
        if any(s[0] is None for s in slots):
            continue
        for k, g in enumerate(r['級'].split('／')):
            g = g.strip()
            if g not in BASE:
                continue
            fin = r['成品'].split('／')
            auth = r['授權'].split('／')
            f = num(fin[k]) if k < len(fin) else None
            a = num(auth[k]) if k < len(auth) else None
            tcoef = wt if sec == '3.2' else 1
            if sec == '3.3' and '護甲' in r['欄位']:
                tcoef = 1.5
            if sec == '3.1' and r['部位'].startswith('眼'):
                tcoef = 1.4
            if sec == '3.1' and '甲板' in r['設計圖'] and g in ('III', 'IV'):
                tcoef = 1.75
            parts = sum(base_range(g)[1] * tc * b * (2 if bio_slot else 1) * n for tc, bio_slot, n in slots)
            exp = parts * 1.2 * tcoef   # 成品只在高於公式時才列，所以 IV 級用基準的上限
            if g != 'IV' and a and abs(a - BASE[g] * 2 * b) / (BASE[g] * 2 * b) > PRICE_TOL:
                out.append((i, '設計圖', r['設計圖'], f'{g} 授權 {a:g}，公式 {BASE[g] * 2 * b:.0f}'))
            # 外皮（生）在非生體的牌子上照蜜腺的生體外皮算，所以成品只在高於公式時才列
            if f and (f - exp) / exp > 0.08 + PRICE_TOL:
                out.append((i, '設計圖', r['設計圖'], f'{g} 成品 {f:g}，公式 {exp:.0f}（型 ×{tcoef}）'))
    # 藥
    dur = {'I': 1, 'II': 1.5, 'III': 2, 'IV': 3}
    ins = {'I': 2, 'II': 3, 'III': 4, 'IV': 6}
    for i, r in rows(lines, r'### 4\.2 ', r'##', '藥'):
        g, b = r['級'], brand(r['牌子'])
        m = re.match(r'([\d.]+)(?:（([\d.]+)＋([\d.]+)）)?', r['份量'])
        bud = float(m.group(2) or m.group(1))
        if bud not in (dur[g], ins[g]):
            out.append((i, '藥', r['藥（街名）'], f'份量的預算 {bud:g} 不是 {g} 級的 {dur[g]}（持續）或 {ins[g]}（立即）'))
        rnd = lambda raw: round(raw / 5) * 5 if raw < 100 else round(raw / 10) * 10
        exp = rnd(BASE[g] * .2 * b)
        lo, hi = (rnd(x * .2 * b) for x in base_range(g))
        if not (lo - 0.5 <= num(r['價']) <= hi + 0.5):
            out.append((i, '藥', r['藥（街名）'], f'價 {num(r["價"]):g}，公式 {exp:g}'))
    # 飾品
    legal = {'自由': 1, '登記': 1.5, '許可': 2, '違禁': 3}
    for i, r in rows(lines, r'### 7\.2 ', r'### 7\.3 ', '飾品'):
        b, lg = brand(r['牌子']), legal.get(r['合法'].split('（')[0])
        m = re.match(r'(?:約 )?(功能|記號)?(?:＋)?([\d.]+)?', r['份量'])
        base = {'功能': 250, '記號': 40}.get(m.group(1), 0)
        if m.group(2):
            x = float(m.group(2))
            base += 320 if x >= 0.7 else (80 if x > 0 else 0)
        if not (b and lg and base):
            continue
        k = (.25 if '二手' in r['牌子'] else 1) * (.4 if ('用掉' in r['效果'] or '褪' in r['效果']) else 1)
        p = num(r['價'])
        if all(abs(p - round(x * b * lg * k, -1)) > 10 for x in (base, base + 300)):
            out.append((i, '飾品', r['飾品'], f'價 {p:g}，公式 {round(base * b * lg * k, -1):g}'))
    # SKIN
    sv_base = {1: 40, 2: 150, 3: 500, 4: 1600}
    for i, r in rows(lines, r'### 11\.8 ', r'### 11\.9 ', '名字'):
        m = re.match(r'[\d,]+', r.get('價', ''))
        if not m or not r['風格值'].isdigit():
            continue
        sv, b = int(r['風格值']), brand(r['牌子'])
        if sv == 5:
            out.append((i, 'SKIN', r['名字'], '風格值 5 不賣，卻寫了價'))
            continue
        if b:
            exp = sv_base[sv] * 1.2 * b
            p = num(m.group())
            if abs(p - exp) / exp > PRICE_TOL and abs(p - exp) > 10:
                out.append((i, 'SKIN', r['名字'], f'價 {p:g}，公式 {exp:.0f}'))
    return out
