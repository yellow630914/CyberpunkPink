#!/usr/bin/env python3
"""夾值用的模擬器（docs/systems/BALANCE.md）。不依賴任何套件。

用法：python3 tools/balance/sim.py [主題 ...] [--set current|proposed] [--doc-budget] [--trials N] [--seed N]
主題：summary（預設）、hits、encounter、cross、capture、key、quests、grade、duel、legend、difficulty、commission、net、check、economy、xp、opinion、roster、items、skills、mech、netrun、all

所有曲線都寫在這個檔案的 CURVES 裡，和 BALANCE.md 的表一一對應。
current 是第一輪夾值之前文件寫的數字（2026-11-20），proposed 是 BALANCE.md 的曲線；兩組只在 DIFF 列出的欄位不同。
DIFF 都已經寫回 ENEMIES 1.5、第 13 節與 COMBAT_SYSTEM 1.1、第 5 節；遭遇的預算固定一般 4、首領戰 8（2026-11-20 確認）。
current 這一組已經假設主角的武器也吃敵人表上的「武器骰」；照當時的文件主角沒有這一條，IV、V 級還會更慢。
"""
import argparse, copy, math, os, random, re, sys

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '../..'))
G = ['I', 'II', 'III', 'IV', 'V']
RANKS = ['雜兵', '精英', '首領']

# ───────────────────────── 曲線 ─────────────────────────
CURRENT = {
    # 主角這一邊的基準：同級裝備、四人隊伍裡的一個「主力」（BALANCE.md 2.2 節）
    'p_atk':    [4, 6, 8, 10, 12],        # mod(反應) ＋ 槍械 ＋ 瞄具與智慧套件
    'p_ev':     [12, 13, 14, 15, 16],     # 10 ＋ mod(反應) ＋ 義體與技能（不含遮蔽）
    'p_hp':     [46, 46, 50, 50, 55],     # 20 ＋ 體格 13 × 2，III 與 V 各多一件加生命的義體
    'p_armor':  [2, 3, 4, 5, 6],          # 均衡的穿法；重甲再 +2
    'p_flat':   [1, 2, 3, 4, 6],          # 槍管全押傷害：0.5／1／1.5／2／3 格 × 2
    'p_skill':  [0, 1, 2, 3, 4],          # 技能給的傷害（被動與共鳴，約 0～2 格）
    'p_regen':  [3, 3, 3, 3.5, 4],        # IV 起一半的人有反射加速器或同類的 +1
    'p_apmax':  [5, 5, 5, 6, 6],
    'p_load':   [38, 38, 42, 42, 46],     # 感載上限；承受層數 3
    'p_layers': [3, 3, 3, 3, 4],
    # 武器：設計圖的等級骰（敵我共用）
    'grade_dice': [0, 0, 1, 1, 2],
    # 敵人（ENEMIES 1.5 節）
    'e_atk':    [3, 5, 7, 9, 11],
    'e_ev':     [10, 11, 12, 13, 14],
    'e_armor':  [1, 2, 3, 5, 6],
    'e_hp':     {'雜兵': [32, 40, 52, 68, 88], '精英': [80, 100, 130, 170, 220], '首領': [190, 240, 310, 410, 530]},
    'e_load':   {'雜兵': [20, 22, 24, 27, 30], '精英': [28, 30, 33, 37, 42], '首領': [38, 40, 44, 49, 55]},
    'e_layers': {'雜兵': 1, '精英': 2, '首領': 4},
    'e_apmax':  {'雜兵': [4] * 5, '精英': [5, 5, 5, 6, 6], '首領': [6, 6, 6, 7, 7]},
    'e_dmg_mult': {'雜兵': 1.0, '精英': 1.0, '首領': 1.0},
    'cap_dice': {'雜兵': 3, '精英': 3, '首領': 3},   # capture 的神經武器的基礎骰（照實彈的手槍）
    'e_net_dice': 1,                      # 網內敵人多 1 顆（CYBERSPACE 6.2 節）
    'net_guard': [1, 2, 3, 5, 6],         # 網內的防護（同護甲）
    # 遭遇（夾值之前的 ENEMIES 第 13 節）
    'budget':   [4, 5, 6, 7, 8],          # 舊的一般遭遇＝ 3 ＋ 等級
    'boss_budget': [8, 9, 10, 11, 12],    # 舊的首領戰＝ 7 ＋ 等級
    'points': {'雜兵': 1, '精英': 2.5, '首領': 5},
    # 檢定（COMMISSION_TEMPLATES 共通的約定）
    'dc_std':   [10, 13, 16, 19, 22],
    'dc_max':   22,                       # DC 階梯的最高一檔
    'p_check':  [6, 8, 10, 12, 14],       # 專精者：mod ＋ 基本功 ＋ 裝備
    # 錢（LIFE 1.3 節）
    'income_mid': [400, 1200, 4000, 13000, 40000],
    'gear':       [1000, 3000, 10000, 32000, None],
    'bills':      [250, 700, 2400, 7800, 25000],
    'part_base':  [150, 500, 1600, 6000, None],   # ITEMS 1.3 節
    # 歷練點（CORE_RULES 7.1 節）
    'xp_start': 200, 'xp_size': {'小': 20, '中': 35, '大': 60},
    # 輿論（OPINION 4.3b、5.2 節；ENEMIES 1.5 節）
    'op_player_ep': [2, 3, 4, 5, 6],      # 媒體型主力在這一級的編輯點
    'op_release':   [2, 2, 3, 3, 3],      # 對手發稿一點加的聲量
}

# BALANCE.md 提出、並且已經改進核心規則表的數字
DIFF = {
    'grade_dice': [0, 0, 1, 2, 3],        # 設計圖的等級骰：IV、V 各多一顆，讓傷害跟上血量
    'e_ev':    [10, 12, 14, 16, 18],      # 迴避跟著主角的命中走，每級 +2
    'e_atk':   [3, 4, 5, 6, 7],           # 攻擊跟著主角的迴避走，每級 +1
    'e_armor': [1, 2, 3, 4, 5],           # 每級 +1，拿掉 IV 的跳級
    'e_hp':    {'雜兵': [45, 55, 67, 82, 100], '精英': [110, 130, 165, 205, 250], '首領': [260, 300, 380, 470, 580]},
    'e_dmg_mult': {'雜兵': 0.4, '精英': 0.6, '首領': 1.0},
    'e_load':  {'雜兵': [22, 27, 33, 40, 49], '精英': [37, 45, 55, 67, 82], '首領': [52, 63, 77, 94, 115]},
    'net_guard': [1, 2, 3, 4, 5],
    'budget':  [4, 4, 4, 4, 4],           # 一般遭遇固定 4 點，不隨等級長（2026-11-20 確認）
    'boss_budget': [8, 8, 8, 8, 8],       # 首領戰固定 8 點
    'dc_max':  25,                        # DC 階梯加一檔 25（2026-11-20 確認）
    # capture 的神經武器：雜兵 4d6、精英 6d6、首領 11d6（第二階段，2026-11-21；BALANCE 2.7 節）。
    # 照「主角挨幾下倒」（雜兵約 10 下、精英約 7 下、首領約 4 下）換到感載的總量：首領一下約等於一次過載。
    'cap_dice': {'雜兵': 4, '精英': 6, '首領': 11},
}
PROPOSED = copy.deepcopy(CURRENT)
PROPOSED.update(copy.deepcopy(DIFF))
CURVES = {'current': CURRENT, 'proposed': PROPOSED}

# 難度（BALANCE.md 第 7 節）。難度只調敵人與 DC：係數乘在敵人上（hp 生命、dmg 傷害、load 感載上限；普通 = 1），
# dc 加在寫成檔位的 DC 上，pr 加在輿論戰對手每回合的公關點上。歷練、帳單、報酬不看難度，是存檔規則裡各自的倍率。
# 首領一組；雜兵與精英照敵人的等級分三段：低（I～II）、中（III）、高（IV～V）。
BANDS = ['低', '中', '高']
BAND_OF = [0, 0, 1, 2, 2]
def _d(boss, low, mid, high, dc=0, pr=0):
    return {'boss': dict(zip(('hp', 'dmg', 'load'), boss)),
            'minions': [dict(zip(('hp', 'dmg', 'load'), x)) for x in (low, mid, high)],
            'dc': dc, 'pr': pr}
DIFFICULTY = {
    '故事': _d((0.6, 0.5, 0.6), (0.6, 0.4, 0.6), (0.6, 0.4, 0.6), (0.6, 0.4, 0.6), dc=-2, pr=-1),
    '簡單': _d((0.85, 0.8, 0.85), (0.85, 0.75, 0.85), (0.85, 0.75, 0.85), (0.85, 0.75, 0.85), dc=-1, pr=-1),
    '普通': _d((1, 1, 1), (1, 1, 1), (1, 1, 1), (1, 1, 1)),
    '困難': _d((1.15, 1.35, 1.15), (1.15, 1.35, 1.15), (1.15, 1.35, 1.15), (1.15, 1.35, 1.15), dc=1, pr=1),
    '傳奇': _d((1.3, 1.5, 1.3), (1.3, 1.7, 1.3), (1.3, 1.7, 1.3), (1.3, 1.7, 1.3), dc=2, pr=2),
}
CUSTOM_COEF = (0.25, 5.0)   # 自訂難度每一格係數的範圍
CUSTOM_DC = (-4, 4)         # 自訂難度的 DC 偏移


# 目標（BALANCE.md 1.2 節）
TARGET_HITS = {'雜兵': (3, 4), '精英': (8, 9.5), '首領': (18, 22)}
TARGET_LOSS = (0.10, 0.15)
COVER = [(4, 0.4), (2, 0.4), (0, 0.2)]   # 掩體、半掩體、暴露的比例


# ───────────────────────── 期望值 ─────────────────────────
def swing(bonus, defense, dice, flat, armor, pierce=0, minion=False):
    """一次攻擊的期望：(命中率, 命中時的期望實際傷害)。含要害（超過 5 加一顆）與自然 20。"""
    p_hit, dmg = 0.0, 0.0
    for r in range(1, 21):
        if r == 1:
            continue
        total = r + bonus
        if r != 20 and total < defense:
            continue
        d = dice + (1 if total >= defense + 5 else 0) + (1 if (r == 20 and minion) else 0)
        raw = d * 3.5 + flat
        dmg += max(0.0, raw - max(0, armor - pierce)) / 20
        p_hit += 1 / 20
    return p_hit, (dmg / p_hit if p_hit else 0.0)


def cover_avg(fn):
    return sum(w * fn(c) for c, w in COVER)


def player_hit(C, g, eg=None, weapon=(3, 0)):
    """主角（g 級）打敵人（eg 級）：(命中率, 一下的期望實際傷害)。weapon＝(基礎骰, 穿甲)。"""
    eg = g if eg is None else eg
    base, pierce = weapon
    dice = base + C['grade_dice'][g]
    flat = C['p_flat'][g] + C['p_skill'][g]
    res = [(w, swing(C['p_atk'][g], C['e_ev'][eg] + c, dice, flat, C['e_armor'][eg], pierce, True)) for c, w in COVER]
    ph = sum(w * r[0] for w, r in res)
    dm = sum(w * r[0] * r[1] for w, r in res) / ph
    return ph, dm


def enemy_hit(C, eg, g=None, rank='雜兵'):
    g = eg if g is None else g
    dice = 3 + C['grade_dice'][eg]
    res = [(w, swing(C['e_atk'][eg], C['p_ev'][g] + c, dice, 0, C['p_armor'][g])) for c, w in COVER]
    ph = sum(w * r[0] for w, r in res)
    dm = sum(w * r[0] * r[1] for w, r in res) / ph * C['e_dmg_mult'][rank]
    return ph, dm


def hits_table(C, weapon=(3, 0)):
    rows = []
    for g in range(5):
        ph, dm = player_hit(C, g, weapon=weapon)
        rows.append((G[g], ph, dm, {r: C['e_hp'][r][g] / dm for r in RANKS}))
    return rows


def net_table(C):
    """內海：3 顆骰的武器構裝，敵人的血量＝感載上限 ×（層數＋1）。"""
    rows = []
    for g in range(5):
        dice = 3 + C['grade_dice'][g]
        flat = C['p_flat'][g] + C['p_skill'][g]
        res = [(w, swing(C['p_atk'][g], C['e_ev'][g] + c, dice, flat, C['net_guard'][g], 0, True)) for c, w in COVER]
        ph = sum(w * r[0] for w, r in res)
        dm = sum(w * r[0] * r[1] for w, r in res) / ph
        hits = {r: C['e_load'][r][g] * (C['e_layers'][r] + 1) / dm for r in RANKS}
        # 敵人打主角：骰多 1 顆，扣主角的防護
        edice = 3 + C['grade_dice'][g] + C['e_net_dice']
        eres = [(w, swing(C['e_atk'][g], C['p_ev'][g] + c, edice, 0, C['p_armor'][g])) for c, w in COVER]
        eph = sum(w * r[0] for w, r in eres)
        edm = sum(w * r[0] * r[1] for w, r in eres) / eph   # 網內不打折（BALANCE.md 2.5 節）
        pool = C['p_load'][g] * (C['p_layers'][g] + 1)
        rows.append((G[g], ph, dm, hits, pool / edm))
    return rows


# ───────────────────────── 遭遇（蒙地卡羅） ─────────────────────────
class Unit:
    __slots__ = ('hp', 'max', 'ap', 'apmax', 'regen', 'acc', 'mag', 'magmax', 'atk', 'ev', 'armor', 'dice', 'flat', 'pierce', 'mult', 'minion',
                 'mech', 'dur', 'mturns', 'exposed', 'turn', 'cov', 'mark', 'skip')
    # mech：機甲的設定（dict）；dur：機體耐久；mturns：啟動剩幾回合
    # cov：固定的遮蔽（遭遇點的配置，None＝照 COVER 的比例）；mark：被標記（隊友打他 +2）；skip：下一個回合被控制住

    def __init__(self, **k):
        for a in self.__slots__:
            setattr(self, a, k.get(a, None if a == 'cov' else 0))
        self.max = self.hp
        self.ap = self.apmax


def attack(rng, a, d):
    cover = rng.choices([c for c, _ in COVER], [w for _, w in COVER])[0]
    if d.cov is not None:
        cover = d.cov                  # 遭遇點的配置（COMMISSION_MAPS 1.3 節）
    r = rng.randint(1, 20)
    if r == 1:
        return 0
    total = r + a.atk + (2 if d.mark else 0)   # 標記：隊友打他 +2（COMBAT_SYSTEM 偵察型、快駭的支援）
    if d.exposed:
        cover = 0                      # 機甲啟動期間永遠暴露（COMBAT_SYSTEM 9.3 節）
    de = d.ev + cover
    if r != 20 and total < de:
        return 0
    n = a.dice + (1 if total >= de + 5 else 0) + (1 if (r == 20 and d.minion) else 0)
    raw = sum(rng.randint(1, 6) for _ in range(n)) + a.flat
    return max(0, raw - max(0, d.armor - a.pierce)) * a.mult


def mech_tick(u):
    """敵方機師（ENEMIES 第 11 節）：照 m['start'] 那一回合啟動（3 點行動點），持續 2 ＋ 同步回合；機體歸零或時間到就解除。"""
    m = u.mech
    if u.mturns > 0:
        u.mturns -= 1
        if u.mturns == 0 or u.dur <= 0:
            u.mturns = 0
            u.dur = 0
            u.armor, u.dice, u.regen, u.magmax, u.exposed, u.mult = m['base']
            u.mag = min(u.mag, u.magmax)
    elif not m.get('used') and u.turn >= m['start'] and u.ap >= 3:
        u.ap -= 3
        m['used'] = True
        m['base'] = (u.armor, u.dice, u.regen, u.magmax, u.exposed, u.mult)
        u.armor = min(m['armor_cap'], u.armor + m['armor'])
        u.dice = m['dice']
        u.regen += m['ap']
        u.magmax = u.mag = m['mag']
        u.exposed = True
        u.dur = m['dur']
        u.mturns = m['turns']


def take_turn(rng, u, foes, focus, other=0.0):
    u.turn += 1
    u.acc += u.regen
    gain = int(u.acc)
    u.acc -= gain
    u.ap = min(u.apmax + (u.mech['ap'] if u.mech and u.mturns else 0), u.ap + gain)
    if u.mech:
        mech_tick(u)
    if other and rng.random() < other and u.ap >= 1:
        u.ap -= 1                      # 移動、招牌行動、瞄準這類不直接打血的事
    while u.ap >= 2:
        live = [f for f in foes if f.hp > 0]
        if not live:
            return
        if u.mag == 0:
            u.ap -= 1
            u.mag = u.magmax
            continue
        t = min(live, key=lambda f: f.hp) if focus else rng.choice(live)
        u.ap -= 2
        u.mag -= 1
        dmg = attack(rng, u, t)
        if t.dur > 0:                  # 傷害先打在機體上，多的打到機師
            soak = min(t.dur, dmg)
            t.dur -= soak
            dmg -= soak
        t.hp = max(0, t.hp - dmg)


def make_party(C, g):
    return [Unit(hp=C['p_hp'][g], apmax=C['p_apmax'][g], regen=C['p_regen'][g], mag=2, magmax=2,
                 atk=C['p_atk'][g], ev=C['p_ev'][g], armor=C['p_armor'][g], dice=3 + C['grade_dice'][g],
                 flat=C['p_flat'][g] + C['p_skill'][g], mult=1.0) for _ in range(C.get('party_n', 4))]


def make_enemy(C, eg, rank):
    if rank == '機師':
        return make_pilot(C, eg)
    if rank == '首領機師':
        return make_pilot(C, eg, {'start': 1}, rank='首領')
    d = C.get('difficulty')
    k = (d['boss'] if rank == '首領' else d['minions'][BAND_OF[eg]]) if d else {'hp': 1, 'dmg': 1}
    key = C.get('key_mult', 1.0) if rank != '雜兵' else 1.0   # 任務關鍵節點 ×1.1～1.2、具名 ×1.3～1.5：精英與首領的生命與傷害
    k = {'hp': k['hp'] * key, 'dmg': k['dmg'] * key}
    duel = C.get('duel') if rank != '雜兵' else None          # 對決的修正（ENEMIES 第 13 節）：少於四人對具名的精英與首領
    if duel:
        k = {'hp': k['hp'] * duel['hp'], 'dmg': k['dmg'] * duel['dmg']}
    return Unit(hp=round(C['e_hp'][rank][eg] * k['hp']), apmax=C['e_apmax'][rank][eg], regen=3, mag=2, magmax=2,
                atk=C['e_atk'][eg], ev=C['e_ev'][eg], armor=C['e_armor'][eg], dice=3 + C['grade_dice'][eg],
                flat=0, mult=C['e_dmg_mult'][rank] * k['dmg'], minion=(rank == '雜兵'))


# 敵方的機甲（ENEMIES 第 11 節）：精英機師的強化狀態，2.5 點。耐久＝同級精英生命 × dur；護甲 +4、上限 8；每回合多回 2 點行動點；
# 武器換成機甲的武器（4d6 加等級骰，彈匣 4）；永遠暴露；同步＝機甲的等級，持續 2 ＋ 同步回合；精英在第 2 回合啟動。
# 定案（2026-11-21）：機體＝同級精英生命 ×0.3（型號再乘修正）；機師本人的生命 ×0.7、傷害 ×0.8（精英的倍率 0.6 變成約 0.5）
MECH = {'dur': 0.3, 'pilot_hp': 0.7, 'dmg': 0.8, 'armor': 4, 'armor_cap': 8, 'ap': 2, 'dice': 4, 'mag': 4, 'start': 2}


def make_pilot(C, eg, cfg=None, rank='精英'):
    m = dict(MECH, **(C.get('mech') or {}), **(cfg or {}))
    u = make_enemy(C, eg, rank)
    u.hp = u.max = round(u.hp * m['pilot_hp'])
    u.mult *= m['dmg']
    arm = m['armor'][eg] if isinstance(m['armor'], (list, tuple)) else m['armor']
    u.mech = {'dmg': m['dmg'], 'dur': round(C['e_hp']['精英'][eg] * m['dur']), 'armor': arm, 'armor_cap': m['armor_cap'], 'ap': m['ap'],
              'dice': m['dice'] + C['grade_dice'][eg], 'mag': m['mag'], 'start': m['start'], 'turns': 2 + (eg + 1)}
    return u


def compositions(C, budget, boss=False):
    """把預算組成幾種典型的位階組合（ENEMIES 第 13 節）。"""
    pts = C['points']
    out = []
    if boss:
        rest = budget - pts['首領']
        out.append(['首領'] + ['雜兵'] * int(round(rest)))
        if rest >= pts['精英']:
            out.append(['首領', '精英'] + ['雜兵'] * int(round(rest - pts['精英'])))
        return out
    out.append(['雜兵'] * int(round(budget)))
    for e in (1, 2):
        rest = budget - e * pts['精英']
        if rest >= 0:
            out.append(['精英'] * e + ['雜兵'] * int(round(rest)))
    return out


def unit_of(r, eg):
    """comp 的一格：'雜兵' 照遭遇的等級；('雜兵', 3) 指定等級（高一級的敵人用）。回傳 (等級, 位階)。"""
    return (r[1], r[0]) if isinstance(r, tuple) else (eg, r)


def encounter(C, g, eg, comp, rng, trials, other=0.25, rounds=20):
    loss = rnds = wins = downs = 0.0
    for _ in range(trials):
        party = make_party(C, g)
        foes = [make_enemy(C, *unit_of(r, eg)) for r in comp]
        n = 0
        while n < rounds and any(f.hp > 0 for f in foes) and any(p.hp > 0 for p in party):
            n += 1
            sides = [(party, foes, True, 0.0), (foes, party, False, other)]
            if rng.random() < 0.5:
                sides.reverse()
            for us, them, focus, oth in sides:
                for u in us:
                    if u.hp > 0:
                        take_turn(rng, u, them, focus, oth)
        lost = sum(p.max - p.hp for p in party) / sum(p.max for p in party)
        loss += lost
        rnds += n
        wins += all(f.hp <= 0 for f in foes)
        downs += sum(p.hp <= 0 for p in party)
    return loss / trials, rnds / trials, wins / trials, downs / trials


def encounter_table(C, rng, trials, boss=False):
    rows = []
    for g in range(5):
        budget = (C['boss_budget'] if boss else C['budget'])[g]
        res = [(comp, encounter(C, g, g, comp, rng, trials)) for comp in compositions(C, budget, boss)]
        rows.append((G[g], budget, res))
    return rows


def cross_table(C, rng, trials):
    """g 級的隊伍打 eg 級的四個雜兵。"""
    out = []
    for g in range(5):
        row = []
        for eg in range(5):
            if abs(eg - g) > 2:
                row.append(None)
                continue
            row.append(encounter(C, g, eg, ['雜兵'] * 4, rng, trials))
        out.append(row)
    return out


# ───────────────────────── 打感載的遭遇（capture） ─────────────────────────
# ENEMIES 4.1 節的 `capture`：敵人用神經武器打主角的感載。神經傷害不扣護甲，位階的傷害倍率不用在感載上（ENEMIES 1.5 節）。
# 主角：感載上限與層數照 2.2 節，敏感度 50（×1），每回合自然消退 2 ＋ mod(意志) ＝ 3（CORE_RULES 4.2 節）。
# 過載：感載歸零、疊一層餘韻、失去下一個回合；疊滿再過載就倒下。隊伍這邊照常用實彈打敵人的生命。
# 損耗＝隊伍的（餘韻層數 × 上限 ＋ 剩下的感載）÷（上限 ×（層數＋1））的總和（BALANCE 2.7 節）。
# 不算制伏：敵人把過載的人綁走算在「每回合四分之一的機會做別的事」裡（1.3 節的模擬約定）。
P_DECAY = 3


def capture_encounter(C, g, eg, comp, rng, trials, other=0.25, rounds=20, decay=P_DECAY):
    loss = rnds = wins = downs = overloads = any_down = multi_down = 0.0
    lmax, lcap = C['p_load'][g], C['p_layers'][g]
    for _ in range(trials):
        party = make_party(C, g)
        for p in party:
            p.armor = 0                    # 神經傷害不扣護甲
        st = [{'load': 0.0, 'lay': 0, 'skip': False, 'down': False} for _ in party]
        foes = [make_enemy(C, *unit_of(r, eg)) for r in comp]
        for f, r in zip(foes, comp):
            ug, rk = unit_of(r, eg)
            f.dice = C['cap_dice'][rk] + C['grade_dice'][ug]
            f.mult = f.mult / C['e_dmg_mult'][rk]   # 感載不吃位階的倍率；難度與強度係數照留
        n = 0
        alive_p = lambda: [i for i, s_ in enumerate(st) if not s_['down']]
        while n < rounds and any(f.hp > 0 for f in foes) and alive_p():
            n += 1
            order = ['party', 'foes']
            if rng.random() < 0.5:
                order.reverse()
            for side in order:
                if side == 'party':
                    for i, u in enumerate(party):
                        s_ = st[i]
                        if s_['down']:
                            continue
                        s_['load'] = max(0.0, s_['load'] - decay)
                        if s_['skip']:
                            s_['skip'] = False
                            u.acc += u.regen   # 失去回合：行動點照回，但這回合不動
                            gain = int(u.acc); u.acc -= gain; u.ap = min(u.apmax, u.ap + gain)
                            continue
                        take_turn(rng, u, foes, True, 0.0)
                else:
                    for f in foes:
                        if f.hp <= 0:
                            continue
                        f.acc += f.regen
                        gain = int(f.acc); f.acc -= gain; f.ap = min(f.apmax, f.ap + gain)
                        if rng.random() < other and f.ap >= 1:
                            f.ap -= 1
                        while f.ap >= 2:
                            live = alive_p()
                            if not live:
                                break
                            if f.mag == 0:
                                f.ap -= 1; f.mag = f.magmax; continue
                            i = rng.choice(live)
                            f.ap -= 2; f.mag -= 1
                            dmg = attack(rng, f, party[i])
                            s_ = st[i]
                            s_['load'] += dmg
                            if s_['load'] >= lmax:        # 過載：感載歸零（多的不留），疊一層，失去下一個回合
                                s_['load'] = 0.0
                                overloads += 1
                                if s_['lay'] >= lcap:
                                    s_['down'], s_['lay'] = True, lcap + 1
                                else:
                                    s_['lay'] += 1
                                    s_['skip'] = True
        pool = lmax * (lcap + 1) * len(party)
        lost = sum(s_['lay'] * lmax + (s_['load'] if not s_['down'] else 0) for s_ in st) / pool
        loss += lost
        rnds += n
        wins += all(f.hp <= 0 for f in foes)
        nd = sum(s_['down'] for s_ in st)
        downs += nd
        any_down += nd >= 1
        multi_down += nd >= 2
    # (損耗, 回合, 勝率, 平均倒下的人數, 每人平均過載幾次, 有人倒下的比例, 兩人以上倒下的比例)
    n_p = C.get('party_n', 4)
    return (loss / trials, rnds / trials, wins / trials, downs / trials, overloads / trials / n_p,
            any_down / trials, multi_down / trials)


# 網內的一層連打幾場（CYBERSPACE 8.1 節）：感載與餘韻跨場帶著走。場與場之間走 between 個節點，每個探索回合感載消退 3，
# 餘韻不消；休息點（每層一個，2026-11-21）把感載歸零、餘韻全消、RAM 回滿。網內的傷害不打折，敵人多 1 顆骰，扣主角的防護。
def net_fight(C, g, comp, rng, st, decay=P_DECAY, other=0.25, rounds=20):
    lmax, lcap = C['p_load'][g], C['p_layers'][g]
    party = make_party(C, g)
    foes = []
    for r in comp:
        f = make_enemy(C, g, r)
        f.hp = f.max = C['e_load'][r][g] * (C['e_layers'][r] + 1)
        f.armor = C['net_guard'][g]
        f.dice = 3 + C['grade_dice'][g] + C['e_net_dice']
        f.mult = 1.0
        foes.append(f)
    alive_p = lambda: [i for i, s_ in enumerate(st) if not s_['down']]
    n = 0
    while n < rounds and any(f.hp > 0 for f in foes) and alive_p():
        n += 1
        order = ['party', 'foes'] if rng.random() < 0.5 else ['foes', 'party']
        for side in order:
            if side == 'party':
                for i, u in enumerate(party):
                    s_ = st[i]
                    if s_['down']:
                        continue
                    s_['load'] = max(0.0, s_['load'] - decay)
                    if s_['skip']:
                        s_['skip'] = False
                        continue
                    take_turn(rng, u, foes, True, 0.0)
            else:
                for f in foes:
                    if f.hp <= 0:
                        continue
                    f.acc += f.regen
                    gain = int(f.acc); f.acc -= gain; f.ap = min(f.apmax, f.ap + gain)
                    if rng.random() < other and f.ap >= 1:
                        f.ap -= 1
                    while f.ap >= 2:
                        live = alive_p()
                        if not live:
                            break
                        if f.mag == 0:
                            f.ap -= 1; f.mag = f.magmax; continue
                        i = rng.choice(live)
                        f.ap -= 2; f.mag -= 1
                        s_ = st[i]
                        s_['load'] += attack(rng, f, party[i])
                        if s_['load'] >= lmax:
                            s_['load'] = 0.0
                            s_['over'] += 1
                            if s_['lay'] >= lcap:
                                s_['down'] = True
                            else:
                                s_['lay'] += 1
                                s_['skip'] = True
    return all(f.hp <= 0 for f in foes)


def net_layer(C, g, fights, rng, trials, rest_after=None, between=3):
    """fights：這一層依序的遭遇；rest_after：第幾場之後經過休息點（None＝沒有）。回傳（有人倒下的比例、平均倒下的人數、
    最後一場開打前每人平均帶著的餘韻、全部打完的比例）。"""
    any_down = downs = carried = done = 0.0
    for _ in range(trials):
        st = [{'load': 0.0, 'lay': 0, 'skip': False, 'down': False, 'over': 0} for _ in range(4)]
        ok = True
        for k, comp in enumerate(fights):
            if k == len(fights) - 1:
                carried += sum(s_['lay'] for s_ in st if not s_['down']) / 4
            if not net_fight(C, g, comp, rng, st):
                ok = False
                break
            for s_ in st:
                s_['load'] = max(0.0, s_['load'] - P_DECAY * between)
                s_['skip'] = False
            if rest_after is not None and k == rest_after:
                for s_ in st:
                    s_['load'], s_['lay'] = 0.0, 0
        nd = sum(s_['down'] for s_ in st)
        any_down += nd >= 1
        downs += nd
        done += ok and nd < 4
    return any_down / trials, downs / trials, carried / trials, done / trials


NET_MAPS = {
    '一般子網 3 層（每層 2 場＋層主，最後一層是首領戰）': [['N', 'E', 'G'], ['N', 'E', 'G'], ['N', 'E', 'B']],
    '沉船帶 4 層（每層 3 場＋層主）': [['N', 'E', 'N', 'G']] * 3 + [['N', 'E', 'N', 'B']],
    '沉船帶 4 層（每層 4 場＋層主，最多的）': [['N', 'E', 'N', 'E', 'G']] * 3 + [['N', 'E', 'N', 'E', 'B']],
    '深海一個海域 2 層': [['N', 'E', 'N'], ['N', 'E', 'B']],
}
NET_COMPS = {'N': ['雜兵'] * 4, 'E': ['精英', '雜兵', '雜兵'], 'G': ['首領', '雜兵'], 'B': ['首領', '雜兵', '雜兵', '雜兵']}


def net_run(C, g, layers, rng, trials, mode='layer', between=3):
    """一整張隨機地圖：mode＝'layer' 每層一個休息點（在那一層的一半），'map' 整張只有一個（在一半），'none' 沒有。"""
    fights, rests = [], set()
    for L in layers:
        if mode == 'layer':
            rests.add(len(fights) + len(L) // 2 - 1)
        fights += [NET_COMPS[k] for k in L]
    if mode == 'map':
        rests.add(len(fights) // 2 - 1)
    any_down = downs = done = 0.0
    for _ in range(trials):
        st = [{'load': 0.0, 'lay': 0, 'skip': False, 'down': False, 'over': 0} for _ in range(4)]
        ok = True
        for k, comp in enumerate(fights):
            if not net_fight(C, g, comp, rng, st):
                ok = False
                break
            for s_ in st:
                s_['load'] = max(0.0, s_['load'] - P_DECAY * between)
                s_['skip'] = False
            if k in rests:
                for s_ in st:
                    s_['load'], s_['lay'] = 0.0, 0
        nd = sum(s_['down'] for s_ in st)
        any_down += nd >= 1
        downs += nd
        done += ok
    return any_down / trials, downs / trials, done / trials


def show_netrun(C, rng, trials):
    print(f'■ 網內的隨機地圖連打（CYBERSPACE 8.1 節）：同級四人，{trials} 次；感載與餘韻跨場帶著走，場與場之間走 3 個節點（每個探索回合感載 −3，餘韻不消）')
    print('  休息點：感載歸零、餘韻全消。欄位是 有人倒下的比例／平均倒下幾人／打完的比例')
    for label, layers in NET_MAPS.items():
        for mode, name in (('layer', '每層一個休息點'), ('map', '整張只有一個'), ('none', '沒有')):
            cells = []
            for g in (0, 2, 4):
                a, d, ok = net_run(C, g, layers, rng, trials, mode)
                cells.append(f'{G[g]} {pct(a)}／{d:.2f}／{pct(ok)}')
            print(f'  {label}，{name}：' + '｜'.join(cells))


def capture_table(C, rng, trials, budget=None):
    rows = []
    for g in range(5):
        b = C['budget'][g] if budget is None else budget
        comps = compositions(C, b)
        res = [(comp, capture_encounter(C, g, g, comp, rng, trials)) for comp in comps]
        rows.append((G[g], b, res))
    return rows


# ───────────────────────── 檢定、錢、歷練點、輿論 ─────────────────────────
def p_success(bonus, dc):
    return sum(1 for r in range(1, 21) if r == 20 or (r != 1 and r + bonus >= dc)) / 20


def check_table(C):
    rows = []
    for g in range(5):
        std = C['dc_std'][g]
        b = C['p_check'][g]
        cap = lambda x: max(10, min(C['dc_max'], x))
        rows.append((G[g], b, {k: (cap(dc), p_success(b, cap(dc))) for k, dc in
                                (('易', std - 3), ('標準', std), ('難', std + 3), ('極難', std + 6))},
                     p_success(b - 4, std)))
    return rows


def economy_table(C):
    rows = []
    for g in range(5):
        inc = C['income_mid'][g]
        small = inc * 0.6
        gear = C['gear'][g]
        rows.append((G[g], inc, small, C['bills'][g], small / C['bills'][g], (gear / inc) if gear else None,
                     (C['income_mid'][g] / C['income_mid'][g - 1]) if g else None,
                     (C['part_base'][g] / C['part_base'][g - 1]) if (g and C['part_base'][g]) else None))
    return rows


def xp_table(C):
    """每件中型委託 35 點；照 LIFE 1.3 節，每一級大約 15～20 件委託。"""
    per = C['xp_size']['中']
    rows = []
    for g, (lo, hi) in enumerate([(0, 15), (15, 33), (33, 51), (51, 69), (69, 90)]):
        rows.append((G[g], lo, hi, C['xp_start'] + lo * per, C['xp_start'] + hi * per))
    return rows


def opinion_table(C):
    """粗估：一回合能推的聲量（你：編輯點 × 2；對手：公關點 × 發稿值）。"""
    rows = []
    for g in range(5):
        you = C['op_player_ep'][g] * 2
        opp = {s: s * 2 * C['op_release'][g] for s in (1, 2, 3)}
        rows.append((G[g], C['op_player_ep'][g], you, opp))
    return rows


# ───────────────────────── 名單的檢查 ─────────────────────────
ROMAN = {'I': 0, 'II': 1, 'III': 2, 'IV': 3, 'V': 4}


NET_KINDS = ('蕾絲', '程式', '化身', '內海')


def parse_roster(path):
    """讀 ENEMY_ROSTER.md：每個兵種的（名字, 位階, 最低級, 最高級, 修正, 修正的原文, 是不是網內的）。"""
    text = open(path, encoding='utf-8').read()
    units = []
    faction = None
    for block in re.split(r'\n#### ', text)[1:]:
        name = block.split('\n', 1)[0].strip()
        prev_faction = faction
        heads = re.findall(r'\n### ([^\n（]+)', '\n' + block)   # 這一塊裡出現的勢力標題，屬於下一個兵種
        if heads:
            faction = heads[-1].strip()
        m = re.search(r'\n\| (雜兵|精英|首領) \| ([IV]+)(?:～([IV]+))? \| ([^|]*) \|', block)
        mod = re.search(r'數值修正\*\*：([^\n]*)', block)
        if not m or not mod:
            continue
        lo = ROMAN[m.group(2)]
        hi = ROMAN[m.group(3)] if m.group(3) else lo
        net = any(k in m.group(4) for k in NET_KINDS) and '現實' not in m.group(4)
        s = mod.group(1)
        md = {'hp': 1.0, 'armor': 0, 'ev': 0, 'atk': 0, 'load': 1.0}
        for key, pat in (('hp', r'生命 ×([\d.]+)'), ('load', r'感載 ×([\d.]+)')):
            x = re.search(pat, s)
            if x:
                md[key] = float(x.group(1))
        for key, pat in (('armor', r'(?:護甲|防護) ([+−-]\d)'), ('ev', r'(?:迴避|防火牆) ([+−-]\d)'), ('atk', r'攻擊 ([+−-]\d)')):
            x = re.search(pat, s)
            if x:
                md[key] = int(x.group(1).replace('−', '-'))
        # 無人機與守衛程式和人重疊、永遠暴露，規則給的迴避（防火牆）+3 補回遮蔽（ENEMIES 第 10 節、CYBERSPACE 9 節）
        md['overlay'] = ('無人機的規則' in s) or ('守衛程式的規則' in s)
        md['layers'] = 1 if re.search(r'承受層數(?:照位階 )?\+1', s) else 0   # 溺感邊緣、溺感者的規則
        x = re.search(r'敏感度 (\d+)', s)
        md['sens'] = (0.75 + int(x.group(1)) / 200) if x else 1.0   # 受到的感載 × (0.75 ＋ 敏感度 ÷ 200)（CORE_RULES 4.2 節）
        md['faction'] = prev_faction
        md['bridge'] = '有橋' in m.group(4)
        units.append((name, m.group(1), lo, hi, md, s, net))
    return units


def neural_swings(C, rank, g, md):
    """現實裡有橋的兵種，用神經打法（不扣護甲）灌倒要攻擊幾次、照表的兵種要幾次。"""
    dice = 3 + C['grade_dice'][g]
    flat = C['p_flat'][g] + C['p_skill'][g]

    def per_swing(ev_mod):
        res = [(w, swing(C['p_atk'][g], C['e_ev'][g] + ev_mod + c, dice, flat, 0, 0, rank == '雜兵')) for c, w in COVER]
        return sum(w * r[0] * r[1] for w, r in res)
    base = C['e_load'][rank][g] * (C['e_layers'][rank] + 1)
    pool = base * (1 + md.get('layers', 0) / (C['e_layers'][rank] + 1)) * md['load'] / md.get('sens', 1.0)
    return pool / per_swing(md['ev']), base / per_swing(0)


# 勢力共通的修正可以超過 ±15%（ENEMIES 1.3 節）：要有描述撐著、要帶反向的代價，並且寫在這裡（BALANCE 第 3 節）
ROSTER_EXCEPTIONS = {'蜜糖會': {'load': 1.3, 'why': '勢力共通的感載 ×1.3（耐灌），代價是她們不追著人打、多半只教訓人（2026-11-21 確認）'}}


def unit_swings(C, rank, g, md, net=False):
    """同級主力打這個兵種要攻擊幾次、照表的兵種要幾次。網內的兵種打的是感載 ×（層數＋1），扣的是防護。"""
    dice = 3 + C['grade_dice'][g]
    flat = C['p_flat'][g] + C['p_skill'][g]
    arm = (C['net_guard'] if net else C['e_armor'])[g]
    pool = (C['e_load'][rank][g] * (C['e_layers'][rank] + 1 + md.get('layers', 0))) if net else C['e_hp'][rank][g]
    mult = md['load'] if net else md['hp']

    def per_swing(ev_mod, arm_mod, cover):
        res = [(w, swing(C['p_atk'][g], C['e_ev'][g] + ev_mod + c, dice, flat, arm + arm_mod, 0, rank == '雜兵')) for c, w in cover]
        return sum(w * r[0] * r[1] for w, r in res)   # 每次攻擊的期望傷害（含沒打中）
    cover = [(0, 1.0)] if md.get('overlay') else COVER
    base_pool = (C['e_load'][rank][g] * (C['e_layers'][rank] + 1)) if net else pool
    return pool * mult / per_swing(md['ev'], md['armor'], cover), base_pool / per_swing(0, 0, COVER)


OVERLAY_FLOOR = -0.5   # 小型無人機與守衛程式（0.5 點）的生命可以低到 ×0.5（ENEMIES 第 10 節）


def roster_audit(C, path, limit=0.15):
    """每個兵種在它等級範圍的每一級：同級主力要攻擊幾次才打倒，和同一級照表的兵種比；偏差超過 limit 的列出來。
    迴避與護甲的修正都算進去；曲線本身的偏差不算在兵種頭上（ENEMIES 1.3 節的 ±15%）。
    無人機與守衛程式照 0.5 點算，下限放寬到 OVERLAY_FLOOR，上限一樣是 +limit。"""
    out, excused = [], []
    units = parse_roster(path)
    for name, rank, lo, hi, md, s, net in units:
        paths = [('hp', unit_swings)]
        if not net and md['bridge'] and md['load'] != 1.0:   # 只有敏感度的差別是個性（×0.9～1.1），不另外查
            paths.append(('load', lambda C_, r_, g_, md_, net_: neural_swings(C_, r_, g_, md_)))   # 現實的神經打法
        for kind, fn in paths:
            worst = None
            devs = []
            for g in range(lo, hi + 1):
                sw, base = fn(C, rank, g, md, net)
                dev = sw / base - 1
                devs.append(dev)
                if worst is None or abs(dev) > abs(worst[1]):
                    worst = (G[g], dev, sw)
            lo_lim = OVERLAY_FLOOR if md.get('overlay') else -limit
            bad = [d for d in devs if d > limit or d < lo_lim]
            if not bad:
                continue
            ex = ROSTER_EXCEPTIONS.get(md.get('faction') or '', {})
            if kind == 'load' and md['load'] <= ex.get('load', 0) + 1e-9:
                excused.append((name, rank, worst, md['faction']))
                continue
            out.append((name, rank, worst, s[:40], net or kind == 'load'))
    out.sort(key=lambda r: -abs(r[2][1]))
    return out, len(units), excused


# ───────────────────────── 輸出 ─────────────────────────
def pct(x):
    return f'{x * 100:.0f}%'


def show_hits(C):
    print('■ 同級打同級：一下的期望與挨幾下倒（現實，手槍或衝鋒槍 3d6；含要害與遮蔽）')
    print('等級 | 命中率 | 一下 | 雜兵 | 精英 | 首領')
    for g, ph, dm, h in hits_table(C):
        flag = ''.join('!' if not (TARGET_HITS[r][0] * 0.9 <= h[r] <= TARGET_HITS[r][1] * 1.1) else '' for r in RANKS)
        print(f'{g:>3} | {pct(ph):>5} | {dm:4.1f} | {h["雜兵"]:4.1f} | {h["精英"]:4.1f} | {h["首領"]:5.1f} {flag}')
    print('步槍 4d6、穿甲 2：')
    for g, ph, dm, h in hits_table(C, weapon=(4, 2)):
        print(f'{g:>3} | {pct(ph):>5} | {dm:4.1f} | {h["雜兵"]:4.1f} | {h["精英"]:4.1f} | {h["首領"]:5.1f}')
    print('敵人打主角（雜兵的武器 3d6）：')
    for eg in range(5):
        ph, dm = enemy_hit(C, eg)
        print(f'{G[eg]:>3} | 命中 {pct(ph)} | 一下 {dm:4.1f} | 主角挨 {C["p_hp"][eg] / dm:4.1f} 下倒')


def show_net(C):
    print('■ 內海：3 顆骰的武器構裝；敵人的血量＝感載上限 ×（層數＋1）')
    print('等級 | 命中率 | 一下 | 雜兵 | 精英 | 首領 | 雜兵要打主角幾下')
    for g, ph, dm, h, mine in net_table(C):
        print(f'{g:>3} | {pct(ph):>5} | {dm:4.1f} | {h["雜兵"]:4.1f} | {h["精英"]:4.1f} | {h["首領"]:5.1f} | {mine:4.1f}')


def show_encounter(C, rng, trials):
    for boss in (False, True):
        goal = '掉 30～50% 的生命、勝率 90% 以上' if boss else '掉 10～15% 的生命'
        print('■ ' + ('首領戰' if boss else '一般遭遇') + f'：同級四人，{trials} 次的平均（目標：{goal}）')
        for g, budget, res in encounter_table(C, rng, trials, boss):
            for comp, (loss, rounds, win, down) in res:
                desc = '＋'.join(f'{comp.count(r)}{r}' for r in RANKS if comp.count(r))
                print(f'{g:>3} 預算 {budget:>4} {desc:<14} 掉 {pct(loss):>4}  {rounds:4.1f} 回合  勝 {pct(win):>4}  倒下 {down:.2f} 人')


CAP_TARGET = {'一般': '掉 10～15% 的感載；每人平均過載 0.5 次以下，沒有人倒下（有人倒下的場次 5% 以下）',
              '首領戰': '每人平均過載 1～2 次；平均倒下 0.5 人以下，兩人以上倒下的場次 10% 以下；勝率 90% 以上'}


def show_capture(C, rng, trials):
    cd = C['cap_dice']
    print(f'■ 打感載的遭遇（capture）：同級四人，{trials} 次的平均；敵人的神經武器雜兵 {cd["雜兵"]}d6、精英 {cd["精英"]}d6、首領 {cd["首領"]}d6，'
          '加等級骰，不扣護甲、不吃位階的倍率')
    print('  損耗＝隊伍的（餘韻 × 上限 ＋ 感載）÷（上限 ×（層數＋1））；過載是每個人平均過載幾次；倒下是餘韻疊滿再過載（BALANCE 2.7 節）')
    print(f'  目標（一般遭遇）：{CAP_TARGET["一般"]}')
    for g, budget, res in capture_table(C, rng, trials):
        for comp, (loss, rounds, win, down, ol, anyd, multi) in res:
            desc = '＋'.join(f'{comp.count(r)}{r}' for r in RANKS if comp.count(r))
            print(f'{g:>3} 預算 {budget:>4} {desc:<14} 掉 {pct(loss):>4}  {rounds:4.1f} 回合  勝 {pct(win):>4}  每人過載 {ol:.2f} 次  '
                  f'倒下 {down:.2f} 人（有人倒下 {pct(anyd)}）')
    print(f'  首領戰（8 點）目標：{CAP_TARGET["首領戰"]}')
    for comp in (['首領', '雜兵', '雜兵', '雜兵'], ['首領', '精英']):
        desc = '＋'.join(f'{comp.count(r)}{r}' for r in RANKS if comp.count(r))
        for g in range(5):
            loss, rounds, win, down, ol, anyd, multi = capture_encounter(C, g, g, comp, rng, max(200, trials // 2))
            print(f'{G[g]:>3} {desc:<14} 掉 {pct(loss):>4}  {rounds:4.1f} 回合  勝 {pct(win):>4}  每人過載 {ol:.2f} 次  '
                  f'倒下 {down:.2f} 人（兩人以上 {pct(multi)}）')
    K = dict(C, key_mult=1.3)
    cells = []
    for g in range(5):
        loss, rounds, win, down, ol, anyd, multi = capture_encounter(K, g, g, ['首領', '雜兵'], rng, max(200, trials // 2))
        cells.append(f'{G[g]} 過載 {ol:.2f} 倒 {down:.2f} 勝{pct(win)}')
    print('  具名 ×1.3 的首領＋1 雜兵（7.5 點）：' + '｜'.join(cells))
    print('  重的遭遇（5.5 點）與輕的（2 點）：')
    for b in (2, 5.5):
        cells = []
        for g, budget, res in capture_table(C, rng, max(200, trials // 2), budget=b):
            cells.append(f'{g} ' + '／'.join(f'{pct(r[1][0])} 過{r[1][4]:.1f}' for r in res))
        print(f'  {b:>4} 點：' + '｜'.join(cells))


def show_difficulty(C, rng, trials):
    print('■ 難度：同級四人；一般遭遇＝ 4 雜兵與 2 雜兵＋1 精英的平均，首領戰＝ 3 雜兵＋1 首領與 1 精英＋1 首領的平均')
    print('難度 | 等級 | 一般遭遇掉血 | 首領戰掉血 | 首領戰勝率 | 首領戰倒下的人數')
    for name, d in DIFFICULTY.items():
        print(f'{name}：DC {d["dc"]:+d}，輿論對手的公關點 {d["pr"]:+d}')
        D = dict(C, difficulty=d)
        for g in range(5):
            n = [encounter(D, g, g, c, rng, trials) for c in (['雜兵'] * 4, ['精英', '雜兵', '雜兵'])]
            b = [encounter(D, g, g, c, rng, trials) for c in (['首領', '雜兵', '雜兵', '雜兵'], ['首領', '精英'])]
            avg = lambda xs, i: sum(x[i] for x in xs) / len(xs)
            print(f'{name} | {G[g]:>3} | {pct(avg(n, 0)):>4} | {pct(avg(b, 0)):>4} | {pct(avg(b, 2)):>4} | {avg(b, 3):.2f}')


def show_key(C, rng, trials):
    """精英與首領的強度：任務的關鍵節點 ×1.1～1.2，具名的 ×1.3～1.5（2026-11-20）。"""
    for m in (1.0, 1.1, 1.2, 1.3, 1.4, 1.5):
        K = dict(C, key_mult=m)
        print(f'■ 精英與首領 ×{m}：同級四人，{trials} 次的平均')
        for boss in (False, True):
            for g, budget, res in encounter_table(K, rng, trials, boss):
                cells = []
                for comp, (loss, rnds, win, downs) in res:
                    if '精英' not in comp and '首領' not in comp:
                        continue
                    desc = '＋'.join(f'{comp.count(r)}{r}' for r in RANKS if comp.count(r))
                    cells.append(f'{desc} {pct(loss)} 勝{pct(win)}')
                print(f'  {"首領戰" if boss else "一般"} {g}：' + '｜'.join(cells))


# QUESTS 第二階段重排後的寫法（2026-11-21）：點數乘上係數之後放進預算
QUEST_LAYOUTS = [
    ('關鍵節點 ×1.2：首領＋2 雜兵（8 點，首領戰）', 1.2, ['首領', '雜兵', '雜兵']),
    ('關鍵節點 ×1.2：精英＋5 雜兵（8 點，首領戰）', 1.2, ['精英'] + ['雜兵'] * 5),
    ('具名 ×1.3：首領＋2 雜兵（8.5 點，超過預算，對照用）', 1.3, ['首領', '雜兵', '雜兵']),
    ('具名 ×1.3：首領＋1 雜兵（7.5 點，首領戰）', 1.3, ['首領', '雜兵']),
    ('具名 ×1.3：精英＋2 雜兵（5.25 點，重）', 1.3, ['精英', '雜兵', '雜兵']),
    ('具名 ×1.3：精英＋1 雜兵（4.25 點，一般）', 1.3, ['精英', '雜兵']),
    ('詞條「車庫裡有機甲」：首領＋機甲（精英）＋3 雜兵（10.5 點，接受的例外）', 1.0, ['首領', '精英', '雜兵', '雜兵', '雜兵']),
    ('對照：首領＋機甲（精英）＋1 雜兵（8.5 點，預算內）', 1.0, ['首領', '精英', '雜兵']),
]


def show_quest_layouts(C, rng, trials):
    print(f'■ 任務裡寫死的遭遇（QUESTS 重排後的寫法）：同級四人，{trials} 次的平均')
    for label, m, comp in QUEST_LAYOUTS:
        K = dict(C, key_mult=m)
        cells = []
        for g in range(5):
            loss, rnds, win, downs = encounter(K, g, g, comp, rng, trials)
            cells.append(f'{G[g]} {pct(loss)} 勝{pct(win)}')
        print(f'  {label}：' + '｜'.join(cells))


# 高一級的敵人（ENEMIES 第 13 節，2026-11-21）：點數 ×1.5～2，預設 ×1.75
GRADE_UP = 1.75
GRADE_LAYOUTS = [
    ('同級：4 雜兵（4 點，對照）', lambda g: ['雜兵'] * 4),
    ('同級：5 雜兵（5 點，對照）', lambda g: ['雜兵'] * 5),
    ('高一級 1 雜兵＋2 同級雜兵', lambda g: [('雜兵', g + 1)] + ['雜兵'] * 2),
    ('高一級 2 雜兵', lambda g: [('雜兵', g + 1)] * 2),
    ('高一級 2 雜兵＋1 同級雜兵', lambda g: [('雜兵', g + 1)] * 2 + ['雜兵']),
    ('高一級 1 精英', lambda g: [('精英', g + 1)]),
    ('高一級 1 雜兵＋3 同級雜兵', lambda g: [('雜兵', g + 1)] + ['雜兵'] * 3),
    ('高一級 3 雜兵', lambda g: [('雜兵', g + 1)] * 3),
    ('高一級 1 精英＋1 同級雜兵', lambda g: [('精英', g + 1), '雜兵']),
    ('首領＋高一級 1 雜兵＋1 同級雜兵', lambda g: ['首領', ('雜兵', g + 1), '雜兵']),
]


def comp_points(C, comp, g, up=GRADE_UP):
    return sum(C['points'][unit_of(r, g)[1]] * (up if unit_of(r, g)[0] > g else 1) for r in comp)


def show_grade(C, rng, trials):
    print(f'■ 高一級的敵人：g 級的隊伍（四人）在 g 級的副本裡遇到 g＋1 級的敵人，{trials} 次的平均；點數照 ×{GRADE_UP}（×1.5 與 ×2 一併列出）')
    for label, fn in GRADE_LAYOUTS:
        comp = fn(0)
        pts = [comp_points(C, comp, 0, up) for up in (1.5, GRADE_UP, 2)]
        cells = []
        for g in range(4):
            loss, rnds, win, downs = encounter(C, g, g, fn(g), rng, trials)
            cells.append(f'{G[g]} {pct(loss)} {rnds:.1f} 回合')
        print(f'  {label}（×1.5 {pts[0]:g}／×{GRADE_UP} {pts[1]:g}／×2 {pts[2]:g} 點）：' + '｜'.join(cells))


# 對決的修正（ENEMIES 第 13 節，2026-11-21）：少於四人打具名的精英與首領時不乘 ×1.3，改乘這一張表（生命, 傷害）
DUEL_MOD = {1: {'精英': (0.8, 0.8), '首領': (0.35, 0.5)},
            2: {'精英': (1.0, 1.0), '首領': (0.8, 0.8)},
            3: {'精英': (1.0, 1.0), '首領': (1.0, 1.0)}}
DUEL_TARGET = '勝率 80% 以上（多半 85～95%），掉 50～70% 的生命'
# QUESTS 與 EVENTS_CITY 裡的對決：(名字, 人數, 等級, 位階, 主角的命中修正)；命中修正是她的被動對一個人特別有效的部分
DUELS = [
    ('柊（槍手 ⑤，一個人；完璧讓大約三分之二的攻擊命中 −3）', 1, 1, '首領', -2),
    ('鐵蘭（嘶—— ②，一個人）', 1, 1, '精英', 0),
    ('齒輪（鉻娘子 ①，一個人）', 1, 2, '精英', 0),
    ('凌霄（小仙 ②，主角＋一名隊員）', 2, 3, '首領', 0),
    ('蘇凝（崑崙 ③，一個人）', 1, 3, '首領', 0),
    ('熔爐的精英（城市事件，一個人，制式）', 1, 1, '精英', 0),
]


def show_duel(C, rng, trials):
    print(f'■ 對決：少於四人打一個精英或首領，{trials} 次的平均，回合上限 30（目標：{DUEL_TARGET}）')
    for n in (1, 2, 3):
        for rank in (('精英', '首領') if n < 3 else ('首領',)):
            for label, mod in (('不修正', (1.0, 1.0)), ('具名 ×1.3', (1.3, 1.3)), ('對決的修正', DUEL_MOD[n][rank])):
                D = dict(C, party_n=n, duel={'hp': mod[0], 'dmg': mod[1]})
                cells = []
                for g in range(5):
                    loss, rnds, win, downs = encounter(D, g, g, [rank], rng, trials, rounds=30)
                    cells.append(f'{G[g]} 勝{pct(win)} 掉{pct(loss)}')
                print(f'  {n} 人對{rank}，{label}（生命 ×{mod[0]:g}、傷害 ×{mod[1]:g}）：' + '｜'.join(cells))
    print('  任務裡的對決（照對決的修正）：')
    for label, n, g, rank, atk in DUELS:
        mod = DUEL_MOD[n][rank]
        D = copy.deepcopy(dict(C, party_n=n, duel={'hp': mod[0], 'dmg': mod[1]}))
        D['p_atk'] = [x + atk for x in D['p_atk']]
        loss, rnds, win, downs = encounter(D, g, g, [rank], rng, trials, rounds=30)
        print(f'    {label}，{G[g]} 級：勝 {pct(win)}，掉 {pct(loss)}，{rnds:.1f} 回合')


# 傳奇人物（NPCS 第 10 節，2026-11-21）：V 級的具名首領 ×2，點數也乘（10 點），刻意超過首領戰的 8 點；不吃對決的修正
LEGEND_MULT = 2.0
LEGEND_LAYOUTS = [
    ('對照：具名 ×1.5 的首領單挑（7.5 點）', 1.5, ['首領'], 4),
    ('傳奇人物 ×2 單挑（10 點）', LEGEND_MULT, ['首領'], 4),
    ('傳奇人物 ×2＋2 雜兵（12 點）', LEGEND_MULT, ['首領', '雜兵', '雜兵'], 4),
    ('傳奇人物 ×2＋1 精英（12.5 點）', LEGEND_MULT, ['首領', '精英'], 4),
    ('傳奇人物 ×2.5 單挑（12.5 點，對照）', 2.5, ['首領'], 4),
    ('三個人對傳奇人物 ×2', LEGEND_MULT, ['首領'], 3),
    ('兩個人對傳奇人物 ×2', LEGEND_MULT, ['首領'], 2),
    ('一個人對傳奇人物 ×2', LEGEND_MULT, ['首領'], 1),
]


def show_legend(C, rng, trials):
    print(f'■ 傳奇人物：V 級的隊伍打 V 級的具名首領 ×{LEGEND_MULT:g}（點數也乘），{trials} 次的平均，回合上限 30；刻意打不太贏（BALANCE 2.7 節）')
    for label, m, comp, n in LEGEND_LAYOUTS:
        K = dict(C, key_mult=m, party_n=n)
        loss, rnds, win, downs = encounter(K, 4, 4, comp, rng, trials, rounds=30)
        print(f'  {label}：勝 {pct(win)}，掉 {pct(loss)}，{rnds:.1f} 回合，倒下 {downs:.2f} 人')
    K = dict(C, key_mult=LEGEND_MULT)
    loss, rnds, win, downs = encounter(K, 3, 4, ['首領'], rng, trials, rounds=30)
    print(f'  IV 級的隊伍（低一級）對傳奇人物 ×{LEGEND_MULT:g}：勝 {pct(win)}，掉 {pct(loss)}，倒下 {downs:.2f} 人')
    D = dict(C, key_mult=LEGEND_MULT, difficulty=DIFFICULTY['故事'])
    loss, rnds, win, downs = encounter(D, 4, 4, ['首領'], rng, trials, rounds=30)
    print(f'  故事難度，V 級四人對傳奇人物 ×{LEGEND_MULT:g}：勝 {pct(win)}，掉 {pct(loss)}，倒下 {downs:.2f} 人')


# 機甲的幾種寫法（BALANCE 第 6 節第 1 項）：(說明, 設定)。耐久＝同級精英生命 × dur，機師本人的生命 × pilot_hp
MECH_OPTIONS = [
    ('定案：機體 ×0.3、機師的生命 ×0.7、傷害 ×0.8', {}),
    ('對照：機體 ×0.4、機師 ×1、傷害 ×1（原本的建議）', {'dur': 0.4, 'pilot_hp': 1.0, 'dmg': 1.0}),
    ('對照：機體 ×0.3、機師 ×1、傷害 ×1', {'dur': 0.3, 'pilot_hp': 1.0, 'dmg': 1.0}),
    ('對照：機體 ×0.2、機師 ×0.6、傷害 ×1', {'dur': 0.2, 'pilot_hp': 0.6, 'dmg': 1.0}),
]


def show_mech(C, rng, trials):
    print(f'■ 敵方的機甲（2.5 點，照精英）：同級四人，{trials} 次的平均；一般遭遇＝機師＋2 雜兵，比的是精英＋2 雜兵；首領戰＝首領＋機師＋1 雜兵')
    print('  機甲：護甲 +4（上限 8）、每回合多回 2 點行動點、武器 4d6 加等級骰、永遠暴露、持續 2 ＋ 同步（＝等級）回合、第 2 回合啟動')
    base = [encounter(C, g, g, ['精英', '雜兵', '雜兵'], rng, trials) for g in range(5)]
    bb = [encounter(C, g, g, ['首領', '精英', '雜兵'], rng, trials) for g in range(5)]
    print('  對照（精英）：' + '｜'.join(f'{G[g]} {pct(x[0])}' for g, x in enumerate(base)) + '；首領戰 ' + '｜'.join(f'{G[g]} {pct(x[0])}' for g, x in enumerate(bb)))
    for label, cfg in MECH_OPTIONS:
        D = dict(C, mech=cfg)
        r = [encounter(D, g, g, ['機師', '雜兵', '雜兵'], rng, trials) for g in range(5)]
        b = [encounter(D, g, g, ['首領', '機師', '雜兵'], rng, trials) for g in range(5)]
        print(f'  {label}：' + '｜'.join(f'{G[g]} {pct(x[0])}（{x[0] / y[0] - 1:+.0%}）' for g, (x, y) in enumerate(zip(r, base)))
              + '；首領戰 ' + '｜'.join(f'{G[g]} {pct(x[0])} 勝{pct(x[2])}' for g, x in enumerate(b)))
    bp = [encounter(C, g, g, ['首領機師', '雜兵', '雜兵', '雜兵'], rng, trials) for g in range(2, 5)]
    bo = [encounter(C, g, g, ['首領', '雜兵', '雜兵', '雜兵'], rng, trials) for g in range(2, 5)]
    print('  首領機師（第 1 回合啟動）＋3 雜兵，定案的寫法：' + '｜'.join(f'{G[g + 2]} {pct(x[0])} 勝{pct(x[2])}（首領 {pct(y[0])}）' for g, (x, y) in enumerate(zip(bp, bo))))


# 技能樹的份量與容量（SKILLS 1.9 節）：被動 1／1.5／2／2.5／3 格、容量 2～6；主動 1～5 格；每場一次的主動 3／4／6／8／10 格；
# 反應照主動 ＋1 格；姿態照被動 ＋0.5 格；主動、反應、姿態、預備、日常的容量 1／1／2／2／3。招牌不照表。誤差 ±0.5 格。
SK_PASSIVE = {1: 1, 2: 1.5, 3: 2, 4: 2.5, 5: 3}
SK_ACTIVE = {1: 1, 2: 2, 3: 3, 4: 4, 5: 5}
SK_ONCE = {1: 3, 2: 4, 3: 6, 4: 8, 5: 10}
SK_CAP_PASSIVE = {1: 2, 2: 3, 3: 4, 4: 5, 5: 6}
SK_CAP_OTHER = {1: 1, 2: 1, 3: 2, 4: 2, 5: 3}


def parse_skill_trees(path):
    tree = tier = None
    rows = []
    for line in open(path, encoding='utf-8'):
        m = re.match(r'^## (\S+)：', line)
        if m:
            tree, tier = m.group(1), None
            continue
        m = re.match(r'^### (\d) 階', line)
        if m:
            tier = int(m.group(1))
            continue
        if line.startswith('|') and tree and tier:
            c = [x.strip() for x in line.strip().strip('|').split('|')]
            if len(c) > 7 and re.match(r'^\d+$', c[3]):
                rows.append({'tree': tree, 'tier': tier, 'name': c[0].strip('*'), 'layer': c[1], 'kind': c[2],
                             'cap': int(c[3]), 'pre': c[4], 'cost': c[5], 'w': c[6]})
    return rows


def skills_audit(path):
    rows, bad = parse_skill_trees(path), []
    for r in rows:
        if r['layer'] == '招牌':
            continue
        t, k = r['tier'], r['kind']
        m = re.match(r'([\d.]+) 格', r['w'])
        once = '每場 1' in r['cost'] and '每回合' not in r['cost']
        if k == '被動':
            exp, cap = SK_PASSIVE[t], SK_CAP_PASSIVE[t]
        elif k == '姿態':
            exp, cap = SK_PASSIVE[t] + 0.5, SK_CAP_OTHER[t]
        elif k in ('主動', '反應'):
            exp, cap = (SK_ONCE[t] if once else SK_ACTIVE[t]) + (1 if k == '反應' else 0), SK_CAP_OTHER[t]
        else:
            exp, cap = None, SK_CAP_OTHER[t]
        msg = []
        if exp is not None and m and abs(float(m.group(1)) - exp) > 0.5:
            msg.append(f'份量 {m.group(1)} 格，表是 {exp:g}')
        if r['cap'] != cap:
            msg.append(f'容量 {r["cap"]}，表是 {cap}')
        if msg:
            bad.append((r, '；'.join(msg)))
    return rows, bad


def show_skills():
    path = os.path.join(ROOT, 'docs/content/SKILL_TREES.md')
    rows, bad = skills_audit(path)
    trees = {}
    for r in rows:
        trees.setdefault(r['tree'], []).append(r)
    print(f'■ 技能樹：讀到 {len(trees)} 棵樹、{len(rows)} 個技能；份量與容量照 SKILLS 1.9 節（誤差 ±0.5 格，招牌不算），不合的 {len(bad)} 個')
    for r, msg in bad:
        print(f'  {r["tree"]} {r["tier"]} 階 {r["name"]}（{r["kind"]}，{r["cost"]}）：{msg}')
    print('  每棵樹的容量（全裝／每一階／只裝招牌與前層）：')
    for t, rs in trees.items():
        per = [sum(r['cap'] for r in rs if r['tier'] == k) for k in range(1, 6)]
        front = sum(r['cap'] for r in rs if r['layer'] in ('前', '招牌'))
        print(f'    {t}：{sum(r["cap"] for r in rs)}／{"、".join(map(str, per))}／{front}')


def show_cross(C, rng, trials):
    print('■ 跨級：g 級的隊伍打 e 級的四個雜兵（掉血％／回合）')
    print('隊伍＼敵人 | ' + ' | '.join(G))
    for g, row in enumerate(cross_table(C, rng, trials)):
        cells = ['—' if c is None else f'{pct(c[0])}/{c[1]:.0f}' for c in row]
        print(f'{G[g]:>9} | ' + ' | '.join(cells))


def show_check(C):
    print('■ 檢定：專精者（mod＋基本功＋裝備）的成功率；最後一欄是不專精的人（−4）擲標準')
    for g, b, d, weak in check_table(C):
        cells = '  '.join(f'{k} {dc}:{pct(p)}' for k, (dc, p) in d.items())
        print(f'{g:>3} +{b:<2} {cells}  外行 {pct(weak)}')


def show_economy(C):
    print('■ 錢：小型委託的個人收入 ÷ 週帳單；一件裝備要幾件中型委託；每級的倍率')
    for g, inc, small, bills, ratio, per_gear, step, pstep in economy_table(C):
        print(f'{g:>3} 中型 {inc:>6}  小型 {small:>7.0f}  帳單 {bills:>6}  小型÷帳單 {ratio:4.2f}'
              f'  裝備＝{per_gear and f"{per_gear:.1f}" or "—":>4} 件  收入倍率 {step and f"{step:.2f}" or "—":>4}  零件倍率 {pstep and f"{pstep:.2f}" or "—"}')


def show_xp(C):
    print('■ 歷練點：每一級大約做多少件中型委託、累計多少點')
    for g, lo, hi, a, b in xp_table(C):
        print(f'{g:>3} 第 {lo:>2}～{hi:>2} 件  累計 {a:>5}～{b:>5}')


# 輿論戰（OPINION 第 3、4 節）的簡化模擬：九格、六回合、聲量上限 10、佔沒人的格子花 2、佔對方的格子花 3（風向當 0）。
# 你：每點編輯點聲量 2（±1），料牌在 III 級的戰役 +1、V 級 +2（2026-11-21 定案；每回合約「編輯點 ÷ 1.5」張料牌）。
# 對手：每點公關點發稿一次，聲量照 ENEMIES 1.5 節（I～II +2、III～V +3，±1）。分數照大眾議題的量級：中央 3、兩格 2、其他 1。
OP_SCORES = [[1, 1, 2], [1, 3, 1], [2, 1, 1]]
OP_CARD_BONUS = [0, 0, 1, 1, 2]
OP_PR = {1: 2, 2: 4, 3: 6}


def opinion_war(C, g, strength, rng, trials, bonus=True, turns=6):
    wins = 0.0
    adj = lambda c: [(c[0] + dx, c[1] + dy) for dx, dy in ((1, 0), (-1, 0), (0, 1), (0, -1)) if 0 <= c[0] + dx < 3 and 0 <= c[1] + dy < 3]
    ep = C['op_player_ep'][g]
    for _ in range(trials):
        own = {(2, 0): 'P', (0, 2): 'O'}
        vol = {'P': 0, 'O': 0}
        over = None
        for t in range(turns):
            order = ['P', 'O'] if rng.random() < 0.5 else ['O', 'P']
            for side in order:
                if side == 'P':
                    gain = sum(2 + rng.randint(-1, 1) for _ in range(ep))
                    if bonus:
                        gain += math.ceil(ep / 1.5) * OP_CARD_BONUS[g]
                else:
                    gain = sum(C['op_release'][g] + rng.randint(-1, 1) for _ in range(OP_PR[strength]))
                vol[side] = min(10, vol[side] + gain)
                other = 'O' if side == 'P' else 'P'
                cand = {n for c, o in own.items() if o == side for n in adj(c) if own.get(n) != side}
                opts = [((3 if own.get(n) == other else 2), n) for n in cand]
                opts = [(cost, n) for cost, n in opts if vol[side] >= cost]
                if opts:
                    cost, n = max(opts, key=lambda x: (OP_SCORES[x[1][0]][x[1][1]] + (1 if own.get(x[1]) == other else 0), -x[0]))
                    vol[side] -= cost
                    own[n] = side
                    if other not in own.values():
                        over = side
                        break
            if over:
                break
        if over:
            wins += over == 'P'
        else:
            sc = {k: sum(OP_SCORES[c[0]][c[1]] for c, o in own.items() if o == k) for k in ('P', 'O')}
            wins += 1 if sc['P'] > sc['O'] else 0.5 if sc['P'] == sc['O'] else 0
    return wins / trials


# 完整一點的輿論戰（OPINION 4.2、5.2 節）：雙方每回合先花點數，再佔一格（對手強度 2 以上可以花 2 點追擊多佔一格）。
# 你（主播）：編輯點 4 起每回合用追擊（1 點，多佔一格），5 起再用頭條（2 點，聲量 +5、多佔一格）（SKILL_TREES 主播）。
# 你的一點編輯點：料（聲量 +2，三分之二的機會再加料牌的等級加值）、說法（風向 +1）、降流（對手的聲量 −2）。
# 對手的一點公關點：發稿（聲量照 ENEMIES 1.5 節的 +2／+3）、否認（風向 1）、降流（你的聲量 −2）；反爆料 2 點（風向照表 2／3）。
# 佔沒人的格子花 2；搶對方的格子：你花 3 − 風向，對手花 3 ＋ 風向（最少 0）。風向 −5～+5，正的偏你。
OP_DENY = [1, 1, 1, 1, 2]        # 否認推的風向（ENEMIES 1.5 節）
OP_COUNTER = [2, 2, 2, 2, 3]     # 反爆料推的風向


def opinion_war2(C, g, ep, strength, rng, trials, bonus=True, turns=6):
    adj = lambda c: [(c[0] + dx, c[1] + dy) for dx, dy in ((1, 0), (-1, 0), (0, 1), (0, -1)) if 0 <= c[0] + dx < 3 and 0 <= c[1] + dy < 3]
    res = {'win': 0.0, 'big': 0.0, 'lose': 0.0}
    for _ in range(trials):
        own = {(2, 0): 'P', (0, 2): 'O'}
        vol = {'P': 0, 'O': 0}
        wind = 0
        over = None

        def cost(side, n):
            o = own.get(n)
            if o is None:
                return 2
            return max(0, 3 - wind) if side == 'P' else max(0, 3 + wind)

        def best(side):
            cand = {n for c, o in own.items() if o == side for n in adj(c) if own.get(n) != side}
            if not cand:
                return None
            return max(cand, key=lambda n: (OP_SCORES[n[0]][n[1]] + (1.5 if own.get(n) else 0)) - 0.3 * cost(side, n))

        def occupy(side):
            n = best(side)
            if n is not None and vol[side] >= cost(side, n):
                vol[side] -= cost(side, n)
                own[n] = side
                return 'O' if side == 'P' else 'P' not in own.values() or None
            return None

        for t in range(turns):
            for side in (['P', 'O'] if rng.random() < 0.5 else ['O', 'P']):
                other = 'O' if side == 'P' else 'P'
                n = best(side)
                need = cost(side, n) if n else 99
                extra = 0
                if side == 'P':
                    left = ep
                    if ep >= 5:                  # 主播 4 階的頭條：2 點，聲量 +5，多佔一格（每回合一次）
                        left -= 2; vol['P'] += 5; extra += 1
                    if ep >= 4:                  # 主播 3 階的追擊：1 點，多佔一格（每回合一次）
                        left -= 1; extra += 1
                    for _ in range(left):
                        if wind < 0 and rng.random() < 0.6:
                            wind = min(5, wind + 1)
                        elif vol['P'] < need or rng.random() < 0.7:
                            vol['P'] += 2 + (OP_CARD_BONUS[g] if bonus and rng.random() < 2 / 3 else 0)
                        else:
                            vol['O'] = max(0, vol['O'] - 2)
                else:
                    pr = OP_PR[strength]
                    while pr > 0:
                        if strength >= C.get('op_chase_min', 3) and pr >= 2 and extra == 0 and vol['O'] >= 2 * need + 2:
                            pr -= 2; extra = 1
                        elif wind > 0 and pr >= 2 and rng.random() < 0.5:
                            pr -= 2; wind = max(-5, wind - OP_COUNTER[g])
                        elif wind > 0:
                            pr -= 1; wind = max(-5, wind - OP_DENY[g])
                        elif vol['O'] < need or rng.random() < 0.6:
                            pr -= 1; vol['O'] += C['op_release'][g] + 0
                        else:
                            pr -= 1; vol['P'] = max(0, vol['P'] - 2)
                vol[side] = min(10, vol[side])
                vol[other] = min(10, vol[other])
                for _ in range(1 + extra):
                    n = best(side)
                    if n is not None and vol[side] >= cost(side, n):
                        vol[side] -= cost(side, n)
                        own[n] = side
                        if other not in own.values():
                            over = side
                            break
                if over:
                    break
            if over:
                break
        sc = {k: sum(OP_SCORES[c[0]][c[1]] for c, o in own.items() if o == k) for k in ('P', 'O')}
        if over == 'P' or (not over and sc['P'] - sc['O'] >= 4):
            res['big'] += 1
        if over == 'P' or (not over and sc['P'] > sc['O']):
            res['win'] += 1
        elif over == 'O' or (not over and sc['P'] < sc['O']):
            res['lose'] += 1
    return {k: v / trials for k, v in res.items()}


def show_opinion(C):
    print('■ 輿論（粗估）：一回合能推的聲量')
    for g, ep, you, opp in opinion_table(C):
        print(f'{g:>3} 你 {ep} 點 → {you} 聲量  對手 強度1/2/3 → {opp[1]}/{opp[2]}/{opp[3]}')
    rng = random.Random(7)
    print('■ 輿論戰（風向、說法、降流、否認、反爆料、追擊）：你的編輯點對對手的強度，勝率（和局另計）；OPINION 5.2 節的勢均力敵：2 點對強度 1、3～4 點對強度 2、5～6 點對強度 3')
    for g in range(5):
        cells = []
        for ep, k in ((2, 1), (3, 2), (4, 2), (5, 3), (6, 3), (4, 3), (6, 2)):
            r = opinion_war2(C, g, ep, k, rng, 1000)
            cells.append(f'{ep} 點對強度 {k}：{pct(r["win"])}')
        print(f'  {G[g]:>3}：' + '｜'.join(cells))
    r1 = [opinion_war2(C, g, 4, 2, rng, 1000, bonus=False)['win'] for g in range(5)]
    print('  對照：料牌不加等級加值，4 點對強度 2：' + '｜'.join(f'{G[g]} {pct(x)}' for g, x in enumerate(r1)))
    print('■ 輿論戰的簡化模擬（媒體型主力對一個對手，勝率；和局算一半）：料牌照等級加值／不加')
    for g in range(5):
        cells = [f'強度 {k}：{pct(opinion_war(C, g, k, rng, 2000))}／{pct(opinion_war(C, g, k, rng, 2000, bonus=False))}' for k in (1, 2, 3)]
        print(f'  {G[g]:>3}（編輯點 {C["op_player_ep"][g]}）：' + '｜'.join(cells))


# ───────────────────────── 委託的決定性階段（commission） ─────────────────────────
# 2026-11-21：介面第四版的自動測試（只會普通射擊、普通出牌）兩件委託每次都輸，這裡照規格重建那兩個決定性階段，
# 用會用技能、掩體、標記、會選牌的策略 AI 判斷是不是平衡的問題。目標照 BALANCE 7.1 節首領戰的勝率（決定性的一步輸了就是委託失敗）。
DECISIVE_TARGET = {'故事': (0.97, '100%'), '簡單': (0.95, '100%'), '普通': (0.90, '90% 以上'),
                   '困難': (0.80, '82～94%'), '傳奇': (0.55, '56～73%')}

# 遭遇點的配置（COMMISSION_MAPS 1.3 節，我方 4→1｜敵方 1→4）：倉庫的 ① 卸貨區是「中」，② 貨架列是「密」
SPOTS = {'① 卸貨區（中）': ([4, 2, 2, 0], [0, 2, 2, 4]), '② 貨架列（密）': ([4, 4, 2, 2], [2, 2, 4, 4])}


def _regen(u):
    u.turn += 1
    u.acc += u.regen
    gain = int(u.acc)
    u.acc -= gain
    u.ap = min(u.apmax, u.ap + gain)


def _shoot(rng, u, foes, mult=1.0):
    """花光行動點打 foes 裡血最少的（集火）；mult 是對這個目標的傷害倍率（弱點 ×2）。"""
    while u.ap >= 2:
        live = [f for f in foes if f.hp > 0]
        if not live:
            return
        if u.mag == 0:
            u.ap -= 1
            u.mag = u.magmax
            continue
        t = min(live, key=lambda f: f.hp)
        u.ap -= 2
        u.mag -= 1
        t.hp = max(0, t.hp - attack(rng, u, t) * (mult if t.minion == 'object' else 1.0))


def sabotage(C, g, comp, rng, trials, plan, spot, dc_off=0, smart=True, weak=False, rounds=20):
    """破壞（COMMISSION_TEMPLATES ct_type_sabotage）的決定性一步：目標物不會動、佔一格，生命是同級精英的兩倍、護甲照等級，永遠暴露。
    plan：'clear' 先清場再打目標物；'split' 兩人打目標物、兩人打敵人；'bomb' 一人裝炸藥（1 點移動＋2 點，機械對標準 DC），其他人打敵人。
    炸藥在裝好那一回合結束起算的第二回合結束時引爆；敵人花 2 點（加 1 點移動）可以拆，不擲。
    smart：潛網者每回合標記集火的目標（快駭的支援 0 點，隊友打他 +2）；一個人用一次控制的招牌（2 點，最強的敵人失去下一個回合）。
    weak：有 weak_point：裝炸藥不擲，打目標物傷害 ×2。回傳（毀掉的比例、掉多少生命、回合、倒下幾人）。"""
    pc, fc = SPOTS[spot]
    win = loss = rnds = downs = 0.0
    dc = min(C['dc_max'], C['dc_std'][g] + dc_off)
    pb = 1.0 if weak else p_success(C['p_check'][g], dc)
    for _ in range(trials):
        party = make_party(C, g)
        for i, p in enumerate(party):
            p.cov = pc[i % 4]
        foes = [make_enemy(C, *unit_of(r, g)) for r in comp]
        for i, f in enumerate(foes):
            f.cov = fc[min(i, 3)]
        obj = Unit(hp=2 * C['e_hp']['精英'][g], ev=C['e_ev'][g], armor=C['e_armor'][g], cov=0, minion='object')
        armed = det = None
        ctrl = smart
        n = 0
        while n < rounds and obj.hp > 0 and any(p.hp > 0 for p in party):
            n += 1
            order = ['P', 'E'] if rng.random() < 0.5 else ['E', 'P']
            for side in order:
                if side == 'P':
                    live = [f for f in foes if f.hp > 0]
                    if smart and live:
                        for f in foes:
                            f.mark = 0
                        min(live, key=lambda f: f.hp).mark = 1
                    for i, p in enumerate(party):
                        if p.hp <= 0:
                            continue
                        _regen(p)
                        live = [f for f in foes if f.hp > 0]
                        if ctrl and i == 1 and live and p.ap >= 2:
                            big = max(live, key=lambda f: (f.max, f.hp))
                            if big.max > C['e_hp']['雜兵'][g] * 1.5:
                                p.ap -= 2
                                big.skip = True
                            ctrl = False
                        if plan == 'bomb' and i == 3 and armed is None:
                            need = 3 if p.turn == 1 else 2
                            if p.ap >= need:
                                p.ap -= need
                                if rng.random() < pb:
                                    armed, det = True, n + 2
                            continue          # 裝炸藥的人守在那一格，不開槍
                        if plan == 'bomb' and i == 3:
                            _shoot(rng, p, live)
                            continue
                        if plan == 'split' and i in (0, 1):
                            tgt = [obj]
                        else:
                            tgt = live if live else [obj]
                        _shoot(rng, p, tgt, 2.0 if weak else 1.0)
                        if tgt is not live and obj.hp <= 0:
                            break
                        if live and not any(f.hp > 0 for f in foes) and plan != 'bomb':
                            _shoot(rng, p, [obj], 2.0 if weak else 1.0)
                else:
                    tried = False
                    for f in foes:
                        if f.hp <= 0:
                            continue
                        if f.skip:
                            f.skip = False
                            _regen(f)
                            continue
                        if armed and not tried and rng.random() < 0.5:
                            _regen(f)
                            if f.ap >= 3:
                                f.ap -= 3
                                armed = None
                                tried = True
                            take_turn_noregen(rng, f, party)
                            continue
                        take_turn(rng, f, party, False, 0.25)
                if obj.hp <= 0 or not any(p.hp > 0 for p in party):
                    break
            if armed and n >= det:
                obj.hp = 0
        lost = sum(p.max - p.hp for p in party) / sum(p.max for p in party)
        win += obj.hp <= 0 and any(p.hp > 0 for p in party)
        loss += lost
        rnds += n
        downs += sum(p.hp <= 0 for p in party)
    return win / trials, loss / trials, rnds / trials, downs / trials


def take_turn_noregen(rng, u, foes):
    while u.ap >= 2:
        live = [f for f in foes if f.hp > 0]
        if not live:
            return
        if u.mag == 0:
            u.ap -= 1
            u.mag = u.magmax
            continue
        t = rng.choice(live)
        u.ap -= 2
        u.mag -= 1
        t.hp = max(0, t.hp - attack(rng, u, t))


SAB_COMPS = [('小／中型：重（5.5）1 精英＋3 雜兵', ['精英', '雜兵', '雜兵', '雜兵']),
             ('小／中型：重（5）5 雜兵', ['雜兵'] * 5),
             ('大型：首領戰（8）1 首領＋3 雜兵', ['首領', '雜兵', '雜兵', '雜兵']),
             ('大型：首領戰（7.5）1 首領＋1 精英', ['首領', '精英'])]
SAB_PLANS = {'clear': '清場', 'split': '分火', 'bomb': '炸藥'}


# 滅火（ct_type_firefight）的決定性一步：六回合守住，你開場佔緋櫻映畫與夜鶯直播，潔絲（pr_jess）從街上的耳語打上來。
# 格子 (列, 行)：上排同人圈、帶子街、應援圈；中排緋櫻映畫、萬華鏡、夜鶯直播；下排牆報、街上的耳語、地下轉播站（OPINION 3.1 節）。
FF_SCORES = {'帶子外流（tp_tape_leak）': [[1, 3, 2], [0, 1, 2], [0, 2, 0]],
             '偶像的醜聞': [[2, 1, 3], [1, 2, 2], [1, 0, 0]],
             '大眾議題（企業醜聞）': [[1, 1, 1], [2, 3, 1], [1, 1, 0]]}
# 牌庫（OPINION 4.3 節，14 張）：(種類, 花的編輯點, 數字)。料的數字另加戰役等級的加值（III、IV +1，V +2）。
FF_DECK = [('料', 1, 2)] * 4 + [('料', 2, 4)] * 2 + [('說法', 1, 1)] * 3 + [('說法', 2, 2)] + [('降流', 1, 2)] * 2 + [('設防', 1, 0), ('轉移', 1, 2)]
# 潔絲的 mimic（DATA 6.3 節）：行動表比一般的公關長，每回合隨機開放三到四種。
JESS_POOL = ['發稿', '否認', '降流', '反爆料', '律師函', '下架', '追擊', '料', '說法', '水軍', '頭條', '轉移']
PR_POOL = ['發稿', '否認', '降流', '反爆料', '律師函', '下架', '追擊']   # 一般的公關（OPINION 5.2 節的行動表），全部開放
JESS_COST = {'發稿': 1, '否認': 1, '降流': 1, '反爆料': 2, '律師函': 2, '下架': 2, '追擊': 2, '料': 1, '說法': 1, '水軍': 1, '頭條': 2, '轉移': 1}


def firefight(C, g, rng, trials, scores, pr=6, chase=True, fuel=0, sig='free', eps=None, wind0=0, start_cells=(), rounds=6,
              jess_grade=2, open_n=(3, 4), smart=True, pool=None, free_cards=False):
    """回傳 {'win','big','tie','lose'}。pr：潔絲每回合的公關點（難度、連動已經加減好）；chase：她能不能追擊（強度 3）；
    fuel：她的料的聲量加減（leaker_discredited −1）；sig：招牌「推薦位」第一回合搶萬華鏡 'free'（不花聲量、不看相鄰、不算那一次佔領）／'paid'（照防守花聲量、算那一次佔領）／None；
    eps：坐在編輯台的人的編輯點（預設是這一級的媒體型主力一人）；smart=False 是只會照順序出牌的機器人。"""
    adj = lambda c: [(c[0] + dx, c[1] + dy) for dx, dy in ((1, 0), (-1, 0), (0, 1), (0, -1)) if 0 <= c[0] + dx < 3 and 0 <= c[1] + dy < 3]
    S = scores
    eps = eps or [C['op_player_ep'][g]]
    bonus = OP_CARD_BONUS[g]
    jrel = C['op_release'][jess_grade]
    deny, counter = OP_DENY[jess_grade], OP_COUNTER[jess_grade]
    KAL = (1, 1)
    res = {'win': 0.0, 'big': 0.0, 'tie': 0.0, 'lose': 0.0}
    for _ in range(trials):
        own = {(1, 0): 'P', (1, 2): 'P', (2, 1): 'O'}
        for c in start_cells:
            own[c] = 'P'
        vol = {'P': 0, 'O': 0}
        wind = wind0
        deck = FF_DECK[:]
        rng.shuffle(deck)
        disc, hand = [], []
        ep_cut = 0
        took_last = False
        over = None

        def draw(k):
            for _ in range(k):
                if len(hand) >= 5:
                    return
                if not deck:
                    deck.extend(disc); disc.clear(); rng.shuffle(deck)
                    if not deck:
                        return
                hand.append(deck.pop())

        def cost(side, n):
            o = own.get(n)
            if o is None:
                return 2
            return max(0, 3 - wind) if side == 'P' else max(0, 3 + wind)

        def cands(side):
            return {n for c, o in own.items() if o == side for n in adj(c) if own.get(n) != side}

        def value(side, n):
            return S[n[0]][n[1]] + (S[n[0]][n[1]] if own.get(n) else 0) + 0.3 * sum(1 for m in adj(n) if own.get(m) is None)

        def pick(side, avoid=(), prefer=None):
            cs = [n for n in cands(side) if n not in avoid]
            if prefer and prefer in cs:
                return prefer
            if not cs:
                return None
            return max(cs, key=lambda n: value(side, n) - 0.4 * cost(side, n))

        def occupy(side, k, guard=None):
            nonlocal over
            got = 0
            for _ in range(k):
                n = pick(side, avoid=(guard,) if guard else (), prefer=KAL if side == 'O' else None)
                if n is None or vol[side] < cost(side, n):
                    break
                vol[side] -= cost(side, n)
                own[n] = side
                got += 1
                other = 'O' if side == 'P' else 'P'
                if other not in own.values():
                    over = side
                    break
            return got

        draw(3)
        for t in range(rounds):
            # ── 你 ──
            draw(2)
            if free_cards:                   # 對照：牌不受手牌限制，每點編輯點換任何一種效果（BALANCE 2.13 節的模型）
                hand[:] = [c for c in FF_DECK for _ in range(3)]
            ep = max(0, sum(eps) - ep_cut)
            ep_cut = 0
            k = 1
            main = eps[0]
            if main >= 4 and ep >= 1:        # 主播的追擊：1 點，多佔一格
                ep -= 1; k += 1
            if main >= 5 and ep >= 2:        # 主播的頭條：2 點，聲量 +5，多佔一格
                ep -= 2; k += 1; vol['P'] += 5
            guard = None
            if smart:
                # 要佔 k 格大約要多少聲量
                need, tmp = 0, []
                for _ in range(k):
                    n = pick('P', avoid=tmp)
                    if n is None:
                        break
                    tmp.append(n); need += cost('P', n)
                hand.sort(key=lambda c: (c[0] != '料', -c[2] / c[1]))
                while ep > 0:
                    playable = [c for c in hand if c[1] <= ep]
                    if not playable:
                        break
                    if wind < 0 and any(c[0] == '說法' for c in playable):
                        c = max((c for c in playable if c[0] == '說法'), key=lambda c: c[2])
                    elif vol['P'] < need and any(c[0] == '料' for c in playable):
                        c = max((c for c in playable if c[0] == '料'), key=lambda c: c[2] / c[1])
                    elif any(c[0] == '設防' for c in playable) and guard is None:
                        c = next(c for c in playable if c[0] == '設防')
                    elif any(c[0] == '說法' for c in playable):
                        c = max((c for c in playable if c[0] == '說法'), key=lambda c: c[2])
                    elif vol['O'] >= 2 and any(c[0] == '降流' for c in playable):
                        c = next(c for c in playable if c[0] == '降流')
                    elif any(c[0] == '料' for c in playable):
                        c = max((c for c in playable if c[0] == '料'), key=lambda c: c[2])
                    else:
                        break
                    hand.remove(c); disc.append(c); ep -= c[1]
                    if c[0] == '料':
                        vol['P'] += c[2] + bonus
                    elif c[0] == '說法':
                        wind = min(5, wind + c[2])
                    elif c[0] == '降流':
                        vol['O'] = max(0, vol['O'] - 2)
                    elif c[0] == '設防':
                        mine = [n for n, o in own.items() if o == 'P']
                        guard = max(mine, key=lambda n: S[n[0]][n[1]]) if mine else None
                    elif c[0] == '轉移':
                        vol['P'] = max(0, vol['P'] - 2); vol['O'] = max(0, vol['O'] - 2)
            else:
                # 普通出牌的機器人：照手牌的順序能出就出，設防與轉移也照樣丟
                for c in list(hand):
                    if c[1] <= ep:
                        hand.remove(c); disc.append(c); ep -= c[1]
                        if c[0] == '料':
                            vol['P'] += c[2] + bonus
                        elif c[0] == '說法':
                            wind = min(5, wind + c[2])
                        elif c[0] == '降流':
                            vol['O'] = max(0, vol['O'] - 2)
                        elif c[0] == '轉移':
                            vol['P'] = max(0, vol['P'] - 2); vol['O'] = max(0, vol['O'] - 2)
            vol['P'] = min(10, vol['P'])
            took_last = occupy('P', k) > 0
            if over:
                break
            # ── 潔絲 ──
            p = pr
            kO = 1
            if sig == 'free' and t == 0 and own.get(KAL) != 'O':
                own[KAL] = 'O'
            elif sig == 'paid' and t == 0:
                pass
            opened = set(pool) if pool else set(rng.sample(JESS_POOL, rng.choice(open_n)))
            target = pick('O', avoid=(guard,) if guard else (), prefer=KAL)
            need = cost('O', target) if target else 99
            while p > 0:
                can = lambda a: a in opened and JESS_COST[a] <= p
                if took_last and can('反爆料'):
                    p -= 2; wind = max(-5, wind - counter); took_last = False
                elif wind >= 2 and can('否認'):
                    p -= 1; wind = max(-5, wind - deny)
                elif vol['O'] < need and can('頭條') and kO == 1:
                    p -= 2; vol['O'] += 5; kO += 1
                elif vol['O'] < need and (can('發稿') or can('料') or can('水軍')):
                    a = '發稿' if can('發稿') else '料' if can('料') else '水軍'
                    p -= 1
                    if a == '水軍':
                        vol['O'] += 3 + fuel
                        if rng.randint(1, 20) <= 5:
                            wind = min(5, wind + 1)
                    else:
                        vol['O'] += max(0, (jrel if a == '發稿' else 2 + OP_CARD_BONUS[jess_grade]) + fuel)
                elif chase and can('追擊') and kO == 1 and vol['O'] >= 2 * need:
                    p -= 2; kO += 1
                elif wind > 0 and can('說法'):
                    p -= 1; wind = max(-5, wind - 1)
                elif can('律師函'):
                    p -= 2; ep_cut = 1
                elif can('下架') and hand:
                    p -= 2; c = rng.choice(hand); hand.remove(c); disc.append(c)
                elif can('降流') and vol['P'] > 0:
                    p -= 1; vol['P'] = max(0, vol['P'] - 2)
                elif can('發稿') or can('料'):
                    p -= 1; vol['O'] += max(0, jrel + fuel)
                elif can('否認') and wind > -5:
                    p -= 1; wind = max(-5, wind - deny)
                elif can('反爆料') and wind > -5:
                    p -= 2; wind = max(-5, wind - counter)
                else:
                    break
                vol['O'] = min(10, vol['O'])
            if sig == 'paid' and t == 0 and own.get(KAL) != 'O' and vol['O'] >= cost('O', KAL):
                vol['O'] -= cost('O', KAL); own[KAL] = 'O'; kO -= 1
            if kO > 0:
                occupy('O', kO, guard)
            if over:
                break
        if over:
            sp, so = (1, 0) if over == 'P' else (0, 1)
        else:
            sp = sum(S[c[0]][c[1]] for c, o in own.items() if o == 'P')
            so = sum(S[c[0]][c[1]] for c, o in own.items() if o == 'O')
        if over == 'P' or (not over and sp - so >= 4):
            res['big'] += 1
        if sp > so:
            res['win'] += 1
        elif sp == so:
            res['tie'] += 1
        else:
            res['lose'] += 1
    return {k: v / trials for k, v in res.items()}


def show_commission(C, rng, trials):
    print('■ 委託的決定性階段（介面第四版自動測試輸掉的兩件）。目標照 BALANCE 7.1 節首領戰的勝率：'
          + '、'.join(f'{k} {v[1]}' for k, v in DECISIVE_TARGET.items()))
    print(f'■ 破壞（ct_type_sabotage）：倉庫 map_warehouse，目標物＝同級精英生命 ×2、護甲照等級、永遠暴露；同級四人，{trials} 次')
    print('  策略 AI：潛網者每回合標記集火的目標（+2）、一人用一次控制的招牌、照遭遇點的配置站掩體；三種打法取勝率最高的')
    spot = '① 卸貨區（中）'
    print(f'  遭遇點 {spot}，普通難度，三種打法（勝率／掉多少生命／回合）：')
    D = dict(C, difficulty=DIFFICULTY['普通'])
    for label, comp in SAB_COMPS:
        cells = []
        for g in range(5):
            r = {pl: sabotage(D, g, comp, rng, trials, pl, spot) for pl in SAB_PLANS}
            cells.append(f'{G[g]} ' + '／'.join(f'{SAB_PLANS[pl]}{pct(v[0])}' for pl, v in r.items()))
        print(f'    {label}：' + '｜'.join(cells))
    print('  各難度，最好的打法（勝率／掉多少生命／倒下幾人）；括號是同一組敵人沒有目標物、照一般遭遇打的勝率：')
    for name, d in DIFFICULTY.items():
        D = dict(C, difficulty=d)
        lo = DECISIVE_TARGET[name][0]
        for label, comp in SAB_COMPS:
            cells, worst = [], 1.0
            for g in range(5):
                best = max((sabotage(D, g, comp, rng, trials, pl, spot, d['dc']) + (pl,) for pl in SAB_PLANS), key=lambda x: x[0])
                plain = encounter(D, g, g, comp, rng, trials // 2)
                worst = min(worst, best[0])
                cells.append(f'{G[g]} {pct(best[0])}/{pct(best[1])}/{best[3]:.1f}（{pct(plain[2])}）')
            print(f'    {name}｜{label}：' + '｜'.join(cells) + ('' if worst >= lo else '　← 低於目標'))
    print('  對照（普通）：只會普通射擊、不標記不控制、先清場（介面的機器人）｜② 貨架列（密）｜有 weak_point：')
    D = dict(C, difficulty=DIFFICULTY['普通'])
    for label, comp in SAB_COMPS[:1] + SAB_COMPS[2:3]:
        a = [pct(sabotage(D, g, comp, rng, trials, 'clear', spot, smart=False)[0]) for g in range(5)]
        b = [pct(max(sabotage(D, g, comp, rng, trials, pl, '② 貨架列（密）')[0] for pl in SAB_PLANS)) for g in range(5)]
        c = [pct(max(sabotage(D, g, comp, rng, trials, pl, spot, weak=True)[0] for pl in SAB_PLANS)) for g in range(5)]
        print(f'    {label}：機器人 {" ".join(a)}｜密 {" ".join(b)}｜弱點 {" ".join(c)}')

    print(f'■ 滅火（ct_type_firefight）：六回合守住，你開場佔緋櫻映畫與夜鶯直播，潔絲（pr_jess，mimic、招牌「推薦位」）從街上的耳語打上來；{trials} 次')
    print('  你：這一級的媒體型主力一人（編輯點 I～V 是 2～6，4 點起追擊、5 點起頭條），會選牌的 AI。勝＝結算時分數比潔絲高（平手算沒守住）')
    print('  牌：抽＝14 張牌、開場 3 張、每回合抽 2、手牌上限 5；選＝每點編輯點換任何一種效果（BALANCE 2.13 節的模型）')
    print('  現行＝強度固定 3（6 點、可以追擊），招牌第一回合不花聲量搶下萬華鏡、另外多佔一格')
    print('  調整後（2026-11-21）＝強度照副本的共通規則（I～II 1、III～IV 2、V 3，大型 +1，上限 3）；招牌是第一回合的佔領不看相鄰、照防守花聲量')
    print('  連動：源＝source_destroyed（第 2 階段，她每回合 −1 點）；封口＝leaker_quiet（大型的 2b，強度 −1）。議題：帶子外流（tp_tape_leak，她的預設議題）')
    sc = FF_SCORES['帶子外流（tp_tape_leak）']
    setups = [('II 中', 1, 0, ()), ('II 中＋源', 1, 0, ('src',)), ('II 大＋源＋封口', 1, 1, ('src', 'quiet')),
              ('III 中', 2, 0, ()), ('III 中＋源', 2, 0, ('src',)), ('III 大＋源＋封口', 2, 1, ('src', 'quiet'))]
    for name, d in DIFFICULTY.items():
        lo = DECISIVE_TARGET[name][0]
        for rule in ('現行', '調整後'):
            cells, bad = [], False
            for label, g, large, ln in setups:
                k = 3 if rule == '現行' else min(3, [1, 1, 2, 2, 3][g] + large)
                if 'quiet' in ln:
                    k = max(1, k - 1)
                pr = max(1, 2 * k + d['pr'] - (1 if 'src' in ln else 0))
                sig = 'free' if rule == '現行' else 'paid'
                r1 = firefight(C, g, rng, trials, sc, pr=pr, chase=k >= 3, sig=sig)['win']
                r2 = firefight(C, g, rng, trials, sc, pr=pr, chase=k >= 3, sig=sig, free_cards=True)['win']
                bad |= bool(ln) and r1 < lo
                cells.append(f'{label}（強度 {k}）{pct(r1)}/{pct(r2)}')
            print(f'    {name}｜{rule}：' + '｜'.join(cells) + ('　← 有連動也低於目標' if bad else ''))
    print('  對照（普通、III 中型、沒有連動；三種議題的勝率，抽／選）：')
    for label, kw in [('現行（強度 3）', {}), ('現行，只會照順序出牌的機器人', {'smart': False}),
                      ('現行，招牌照防守花聲量、算那一次佔領', {'sig': 'paid'}), ('現行，沒有招牌', {'sig': None}),
                      ('現行，兩個人坐編輯台（主播＋任何人 2 點）', {'eps': [4, 2]}), ('現行，四回合', {'rounds': 4}),
                      ('現行，每回合 5 點', {'pr': 5}), ('只改強度（共通規則：強度 2、4 點、不能追擊）', {'pr': 4, 'chase': False}),
                      ('調整後（強度 2，招牌照防守花聲量）', {'pr': 4, 'chase': False, 'sig': 'paid'})]:
        r = [(firefight(C, 2, rng, trials, FF_SCORES[s], **kw)['win'], firefight(C, 2, rng, trials, FF_SCORES[s], free_cards=True, **kw)['win']) for s in FF_SCORES]
        print(f'    {label}：' + '｜'.join(f'{s} {pct(x)}/{pct(y)}' for s, (x, y) in zip(FF_SCORES, r)))


def show_roster(C, limit=0.15):
    path = os.path.join(ROOT, 'docs/content/ENEMY_ROSTER.md')
    rows, n, excused = roster_audit(C, path, limit)
    print(f'■ 名單：讀到 {n} 個兵種；同級主力要攻擊的次數比照表的兵種多或少 {limit:.0%} 以上的，共 {len(rows)} 個（ENEMIES 1.3 節）')
    print('  現實的兵種查生命這一條路；有橋又寫了感載倍率的，另外查神經打法那一條路（不扣護甲，算進敏感度）；網內的兵種查感載')
    for name, rank, (g, dev, sw), s, net in rows:
        print(f'  {name}｜{rank}{"｜感載" if net else ""}｜最偏的一級 {g}：{sw:.1f} 次（{dev:+.0%}）｜{s}')
    for fac, ex in ROSTER_EXCEPTIONS.items():
        mine = [r for r in excused if r[3] == fac]
        if mine:
            devs = [r[2][1] for r in mine]
            print(f'  例外：{fac} {len(mine)} 個兵種的神經打法多 {min(devs):+.0%}～{max(devs):+.0%}，照 ROSTER_EXCEPTIONS 放行（{ex["why"]}）')


def show_items():
    import items_audit
    path = os.path.join(ROOT, 'docs/gear/ITEMS.md')
    rows = items_audit.audit(path)
    print(f'■ 物品：零件的份量與價、設計圖的授權與成品、藥、飾品、SKIN 的價，照 ITEMS 各節自己寫的公式；不合的共 {len(rows)} 筆')
    print(f'  允許的誤差：價 {items_audit.PRICE_TOL:.0%}；IV 級的基準 {items_audit.BASE["IV"]:,} ±{items_audit.BASE_TOL["IV"]:,}；'
          f'效果折成的格與份量差 ±{items_audit.WEIGHT_TOL:g} 格（BALANCE 第 3 節）')
    for line, kind, name, msg in rows:
        print(f'  第 {line} 行｜{kind}｜{name}｜{msg}')


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('topics', nargs='*', default=['summary'])
    ap.add_argument('--set', default='proposed', choices=list(CURVES))
    ap.add_argument('--trials', type=int, default=2000)
    ap.add_argument('--seed', type=int, default=7)
    ap.add_argument('--doc-budget', action='store_true', help='遭遇預算照夾值之前的「3＋等級」與「7＋等級」，對照用')
    a = ap.parse_args()
    C = copy.deepcopy(CURVES[a.set])
    if a.doc_budget:
        C['budget'], C['boss_budget'] = CURRENT['budget'][:], CURRENT['boss_budget'][:]
    rng = random.Random(a.seed)
    topics = a.topics
    if 'all' in topics:
        topics = ['hits', 'net', 'encounter', 'cross', 'capture', 'key', 'quests', 'grade', 'duel', 'legend', 'difficulty', 'check', 'economy', 'xp', 'opinion', 'roster', 'items', 'skills', 'mech', 'netrun', 'commission']
    if 'summary' in topics:
        topics = ['hits', 'encounter', 'cross']
    print(f'曲線：{a.set}')
    for t in topics:
        {'hits': lambda: show_hits(C), 'net': lambda: show_net(C),
         'encounter': lambda: show_encounter(C, rng, a.trials), 'cross': lambda: show_cross(C, rng, max(200, a.trials // 4)),
         'check': lambda: show_check(C), 'economy': lambda: show_economy(C), 'xp': lambda: show_xp(C),
         'opinion': lambda: show_opinion(C), 'roster': lambda: show_roster(C), 'items': show_items, 'skills': show_skills,
         'mech': lambda: show_mech(C, rng, max(500, a.trials // 2)),
         'netrun': lambda: show_netrun(C, rng, max(200, a.trials // 10)),
         'key': lambda: show_key(C, rng, max(300, a.trials // 2)),
         'capture': lambda: show_capture(C, rng, max(500, a.trials // 2)),
         'quests': lambda: show_quest_layouts(C, rng, max(300, a.trials // 4)),
         'grade': lambda: show_grade(C, rng, max(300, a.trials // 4)),
         'duel': lambda: show_duel(C, rng, max(500, a.trials // 2)),
         'legend': lambda: show_legend(C, rng, max(500, a.trials // 2)),
         'difficulty': lambda: show_difficulty(C, rng, max(300, a.trials // 4)),
         'commission': lambda: show_commission(C, rng, max(300, a.trials // 4))}[t]()
        print()


if __name__ == '__main__':
    main()
