import { SlotBattle, COVER_BONUS, cover, sameTarget, type BaseUnit, type Cover, type Phase, type Target, type WeaponBase, type Side } from './field'
import { d20, d6, clamp, type Rng } from './rng'

/**
 * 現實戰鬥（COMBAT_SYSTEM、ENEMIES 1.5 節、BALANCE 第 2 節的 I 級數字）。照 docs/mockups/combat-demo.html 改寫成純邏輯：
 * 站位與遮蔽、行動點、彈匣、監視、感載與過載、制伏、脫離與投降、重創（流血、暈眩）、壓制、敵人的 AI。
 */
export interface RealWeapon extends WeaponBase { mag: number; t: 'p' | 'n' }
export const REAL_WEAPONS: Record<string, RealWeapon> = {
  rifle: { n: '步槍', dice: 4, r: [3, 7], mag: 3, pen: 2, t: 'p', long: true, cm: 0.5 },
  shotgun: { n: '霰彈槍', dice: 5, far: 3, r: [1, 3], mag: 2, pen: 0, t: 'p', push: true, cm: 1.5 },
  pistol: { n: '手槍', dice: 3, r: [1, 4], mag: 2, pen: 0, t: 'p', cm: 0.25 },
  smg: { n: '衝鋒槍', dice: 3, r: [2, 5], mag: 3, pen: 0, t: 'p', cm: 0.5 },
  sniper: { n: '狙擊槍', dice: 6, r: [5, 7], mag: 1, pen: 4, t: 'p', long: true, cm: 0.25, snipe: true },
  stun: { n: '感官彈槍', dice: 3, r: [2, 5], mag: 2, pen: 0, t: 'n', cm: 0 },
  knife: { n: '刀', dice: 3, r: [1, 1], mag: 0, pen: 1, t: 'p', melee: true, cm: 0 },
}
export const REAL_COVER_NAMES = ['暴露', '半掩體', '掩體'] as const

export interface RealUnit extends BaseUnit {
  hp: number; hpMax: number; armor: number
  stun: boolean; daze: boolean; bleed: boolean; boss: boolean
  /** 快取格裡的急救噴劑 */
  kit: number
  /** 難度的傷害係數（BALANCE 7.2 節），只用在敵人 */
  dmgMult: number
  ws: Array<{ k: string; mag: number }>
}
export interface RealUnitSpec {
  name: string; role?: string; hp: number; armor: number; lm: number; lay: number; ap: number; refl: number; gun: number
  mel?: number; will?: number; tier?: number; elite?: boolean; boss?: boolean; kit?: number; dmg?: number; ws: string[]
}
export interface RealSetup {
  party: RealUnitSpec[]
  foes: RealUnitSpec[]
  covP?: Cover[]
  covE?: Cover[]
  /** 要活的：敵方第幾個（0 起算）要制伏，不能打死 */
  capture?: number
}

/** 行動圓環的一格（COMBAT_SYSTEM 第 10 節）：內環攻擊、中環補充與切換、外環戰術；中心是技能 */
export type RingGroup = 'atk' | 'res' | 'tac'
export type TargetKind = 'foe' | 'melee' | 'slot' | 'ecov' | 'sub' | 'pcov'
export interface RingAction { k: string; n: string; c: number; g: RingGroup; icon: string; d: string; w: string; tg?: TargetKind; ram?: string }

export const REAL_ACTIONS: RingAction[] = [
  { k: 'shoot', n: '射擊', c: 2, g: 'atk', icon: 'shoot', tg: 'foe', d: '花彈匣 1 格，朝一個敵人開槍。狙擊槍的一槍花 3 點，已經包含瞄準：命中 +3，要害時重創。', w: '手上是近戰武器，或彈匣空了' },
  { k: 'melee', n: '近戰', c: 2, g: 'atk', icon: 'melee', tg: 'melee', d: '打近身（雙方第 1 格）的敵人。', w: '手上不是近戰武器，或近身沒有敵人' },
  { k: 'reload', n: '換彈', c: 1, g: 'res', icon: 'reload', d: '把彈匣補滿。', w: '彈匣是滿的，或手上是近戰武器' },
  { k: 'swap', n: '換武器', c: 1, g: 'res', icon: 'swap', d: '換成另一把武器。', w: '只有一把武器' },
  { k: 'item', n: '道具', c: 1, g: 'res', icon: 'item', d: '用快取格裡的急救噴劑：生命 +2d6，止血。', w: '快取格裡沒有急救噴劑' },
  { k: 'move', n: '換位', c: 1, g: 'tac', icon: 'move', tg: 'slot', d: '和相鄰的隊友交換，或移到相鄰的空格。', w: '沒有可以換的格，或被壓制' },
  { k: 'cover', n: '打遮蔽', c: 2, g: 'tac', icon: 'cover', tg: 'ecov', d: '不打人，直接打敵方一格的遮蔽；倍率加倍。', w: '手上是近戰武器、彈匣空了，或敵方沒有遮蔽' },
  { k: 'watch', n: '監視', c: 2, g: 'tac', icon: 'watch', d: '到你的下一回合開始前，第一次有敵人站上暴露的格子（換位、補位、被推過去，或遮蔽被打成暴露），自動朝他開一槍，不另花行動點，彈匣照扣。', w: '已經在監視' },
  { k: 'subdue', n: '制伏', c: 2, g: 'tac', icon: 'subdue', tg: 'sub', d: '把正在過載的近身敵人綁起來，讓他退出戰鬥。要過格鬥檢定。', w: '沒有可以制伏的目標（要在近身、對方正在過載；精英要餘韻疊滿）' },
]
/** 數字鍵 1～9 對應的行動（由內環往外） */
export const RING_KEYS = ['shoot', 'melee', 'reload', 'swap', 'item', 'move', 'cover', 'watch', 'subdue']

export const TARGET_HINT: Record<TargetKind, string> = {
  foe: '選一個敵人（綠框）。括號裡是命中率。Tab 換目標，Enter 確定。',
  melee: '選近身的敵人。',
  slot: '選要換到哪一格（綠框）。往後退、讓前面空著時，原本那一格要有遮蔽。',
  ecov: '選敵方的一格，打它的遮蔽。沒人站的格子，遮蔽耐久減半。',
  sub: '選一個正在過載的近身敵人。精英要餘韻疊滿。',
  pcov: '選我方的一格。',
}

function makeUnit(side: Side, slot: number, o: RealUnitSpec): RealUnit {
  return {
    id: 0, side, slot, name: o.name, role: o.role ?? '', hp: o.hp, hpMax: o.hp, armor: o.armor, load: 0, loadMax: o.lm, layers: 0, layersMax: o.lay,
    ap: o.ap, apMax: o.ap, refl: o.refl, gun: o.gun, mel: o.mel ?? 0, will: o.will ?? 0, tier: o.tier ?? 1, elite: !!o.elite, boss: !!o.boss, kit: o.kit ?? 0, dmgMult: o.dmg ?? 1,
    ws: o.ws.map(k => ({ k, mag: REAL_WEAPONS[k].mag })), wi: 0, aim: false, stun: false, supp: 0, watch: false, mv: false, daze: false, bleed: false, down: false, out: false, ini: 0,
  }
}

export class RealBattle extends SlotBattle<RealUnit> {
  readonly coverNames = REAL_COVER_NAMES
  readonly wallWord = '遮蔽'
  captureId: number | null = null
  kills = 0

  constructor(setup: RealSetup, rng: Rng) {
    super(rng, setup.covP ?? [cover(1), cover(2), cover(2), cover(1)], setup.covE ?? [cover(1), cover(2), cover(1), cover(2)])
    setup.party.forEach((p, i) => this.units.push(makeUnit('P', i + 1, p)))
    setup.foes.forEach((p, i) => this.units.push(makeUnit('E', i + 1, p)))
    this.rollInitiative()
    if (setup.capture != null) this.captureId = this.units.filter(u => u.side === 'E')[setup.capture]?.id ?? null
    this.log('戰鬥開始。第一回合所有人從行動點上限開始。', 'h')
    if (this.captureId != null) this.log(`委託的條件：要活的。${this.units[this.captureId].name}要制伏，不能打死。`, 'h')
  }

  wp(u: RealUnit) { return REAL_WEAPONS[u.ws[u.wi].k] }
  /** 迴避 = 10 ＋ 反應 ＋ 遮蔽（半掩體 +2、掩體 +4）− 餘韻 */
  dodge(u: RealUnit) { return 10 + u.refl + COVER_BONUS[this.coverOf(u).l] - u.layers }
  /** 命中的加值 = 槍械或格鬥 ＋ 距離 ＋ 瞄準 +3 − 被壓制 2 − 餘韻 */
  bonus(a: RealUnit, t: RealUnit, w: RealWeapon) { return (w.melee ? a.mel : a.gun) + this.rangeMod(a, t, w) + (a.aim || w.snipe ? 3 : 0) - (a.supp ? 2 : 0) - a.layers }
  hitChance(a: RealUnit, t: RealUnit, w = this.wp(a)) { return clamp((21 - (this.dodge(t) - this.bonus(a, t, w))) * 5, 5, 95) }
  /** 位階的傷害倍率：雜兵 ×0.4、精英 ×0.6、首領 ×1（ENEMIES 1.5 節）。只用在敵人打我方 */
  tierMult(a: RealUnit) { return a.boss ? 1 : a.elite ? 0.6 : 0.4 }
  /** 實彈傷害：骰數扣掉（護甲 − 穿透），敵人打我方再乘位階倍率，至少 1 */
  damage(a: RealUnit, t: RealUnit, raw: number, w: RealWeapon) {
    let dm = Math.max(0, raw - Math.max(0, t.armor - w.pen))
    if (a.side === 'E' && dm > 0) dm = Math.max(1, Math.round(dm * this.tierMult(a) * a.dmgMult))
    return dm
  }

  fall(u: RealUnit, how: string) {
    u.down = true
    u.stun = false
    this.log(this.tag(u) + how, u.side === 'P' ? 'r' : 'g')
    if (u.side === 'E' && !u.out) {
      this.kills++
      if (u.id === this.captureId) this.log('要活的那個人倒下了：委託的條件沒有達成。', 'r')
    }
    this.compact(u.side)
    this.check()
  }
  /** 感載：滿了就過載（清空、疊一層餘韻、失去下一回合）；疊滿之後再過載就倒下 */
  neural(t: RealUnit, n: number) {
    t.load += n
    if (t.load >= t.loadMax) {
      t.load = 0
      t.layers++
      if (t.layers > t.layersMax) this.fall(t, ' 餘韻疊滿後再過載：倒下。')
      else { t.stun = true; this.log(`${this.tag(t)} 過載！失去下一回合，餘韻 ${t.layers} 層。`, 'h') }
    }
  }
  attack(a: RealUnit, t: RealUnit, o: { burst?: boolean } = {}) {
    const w = this.wp(a), slotW = a.ws[a.wi], n = o.burst ? slotW.mag : 1
    if (w.mag) slotW.mag -= n
    const r = d20(this.rng), bonus = this.bonus(a, t, w), tot = r + bonus, dg = this.dodge(t), cb = COVER_BONUS[this.coverOf(t).l]
    const aimed = a.aim || !!w.snipe
    a.aim = false
    /* 敵人打感載的神經武器：雜兵 4d6、精英 6d6（ENEMIES 1.5 節） */
    const nd = w.t === 'n' && a.side === 'E' ? (a.elite || a.boss ? 6 : 4) : 0
    let dice = (nd || (w.far && this.dist(a, t) > 2 ? w.far : w.dice)) + (o.burst ? n - 1 : 0)
    const hit = r === 20 || (r !== 1 && tot >= dg), crit = hit && tot - dg >= 5
    const msg = `${this.tag(a)}${o.burst ? ` 用${w.n}連射（${n} 格）` : ` 用${w.n}${w.snipe ? '瞄準射擊' : '攻擊'}`} ${this.tag(t)}：d20=${r}${bonus >= 0 ? '+' : ''}${bonus}=${tot} 對迴避 ${dg}，`
    if (!hit) {
      this.log(msg + (r === 1 ? '自然 1，' : '') + (r !== 1 && cb && tot >= dg - cb ? '被遮蔽擋下。' : '沒打中。'))
      if (cb && w.cm) { const dm = d6(this.rng, dice) * w.cm; this.log(`遮蔽受 ${Math.round(dm)}（${w.n} ×${w.cm}）。`); this.hurtCover(t.side, t.slot, dm) }
    } else {
      if (crit) dice++
      const wound = r === 20 || (crit && aimed)
      if (wound && !t.elite && !t.boss && t.side === 'E') dice++
      const raw = d6(this.rng, dice)
      if (cb && w.cm) { this.log(`遮蔽受 ${Math.round(raw * w.cm)}（${w.n} ×${w.cm}）。`); this.hurtCover(t.side, t.slot, raw * w.cm) }
      if (w.t === 'n') { const v = a.side === 'E' ? Math.round(raw * a.dmgMult) : raw; this.log(`${msg}${crit ? '要害！' : '命中，'}感載 +${v}。`); this.neural(t, v) }
      else {
        const dm = this.damage(a, t, raw, w)
        t.hp -= dm
        this.log(`${msg}${r === 20 ? '自然 20！' : crit ? '要害！' : '命中，'}傷害 ${raw}，扣護甲後 ${dm}。`)
        if (wound && (t.elite || t.boss || t.side === 'P') && t.hp > 0) {
          if (this.rng() < 0.5) { t.bleed = true; this.log(`${this.tag(t)} 重創（軀幹）：流血。`, 'h') }
          else { t.daze = true; this.log(`${this.tag(t)} 重創（頭）：暈眩，下回合行動點 −2。`, 'h') }
        }
        if (t.hp <= 0) { t.hp = 0; this.fall(t, t.side === 'E' ? ' 被打倒。' : ' 倒下。') }
        else if (w.push && t.slot < 4) {
          const b = this.at(t.side, t.slot + 1), os = t.slot
          if (b) b.slot = os
          t.slot = os + 1
          this.log(`${this.tag(t)} 被轟退一格。`)
          this.exposed(t); this.exposed(b); this.compact(t.side)
        }
      }
    }
    if (o.burst && !t.down) {
      const sv = d20(this.rng) + t.will, dc = 10 + n * 2
      if (sv < dc) { t.supp = 1; this.log(`${this.tag(t)} 被壓制（定力 ${sv} 對 ${dc}）：不能換位、攻擊 −2。`, 'h') }
      else this.log(`${this.tag(t)} 撐住了壓制（定力 ${sv} 對 ${dc}）。`)
    }
  }
  check() {
    if (this.end) return
    const p = this.alive('P').length, e = this.alive('E').length
    if (!p) this.finish('lose', '全隊倒下：戰敗。在正式的遊戲裡，這裡會進入戰敗事件（依贏的是誰）。', '戰敗。')
    else if (!e) {
      const cap = this.captureId == null ? '' : this.units[this.captureId].out ? '要活的那個人被制伏了，委託的條件達成。' : '可是要活的那個人死了，委託的條件沒有達成。'
      this.finish('win', `敵人全部倒下或被制伏：勝利。${cap}`, '勝利。')
    }
  }
  /** 現在這個人的回合開始：回行動點、暈眩、流血、過載中跳過 */
  beginTurn(): Phase {
    for (let guard = 0; guard < 64; guard++) {
      if (this.end) return 'over'
      const u = this.cur()
      this.aiN = 0
      if (u.down) { this.advance(); continue }
      if (this.round > 1) u.ap = Math.min(u.apMax, u.ap + 3)
      if (u.daze) { u.ap = Math.max(0, u.ap - 2); u.daze = false }
      if (u.bleed) {
        u.hp -= 2
        this.log(`${this.tag(u)} 流血 −2。`)
        if (u.hp <= 0) { u.hp = 0; this.fall(u, ' 失血倒下。'); if (this.end) return 'over'; this.advance(); continue }
      }
      u.watch = false
      u.mv = false
      if (u.stun) { u.stun = false; this.log(`${this.tag(u)} 還在過載中，失去這一回合。`); return 'skip' }
      this.mode = null
      return u.side === 'E' ? 'enemy' : 'player'
    }
    return 'over'
  }
  advance() {
    const u = this.cur()
    if (u && u.supp > 0) u.supp--
    this.idx++
    if (this.idx >= this.order.length) { this.idx = 0; this.round++; this.log(`—— 第 ${this.round} 回合 ——`, 'h') }
  }
  start(): Phase { return this.beginTurn() }
  endTurn(): Phase { if (this.end) return 'over'; this.mode = null; this.advance(); return this.beginTurn() }

  canHit(u: RealUnit, t: RealUnit) { const w = this.wp(u); return !u.stun && (w.melee ? this.dist(u, t) === 1 : u.ws[u.wi].mag >= 1) }
  canMove(u: RealUnit, to: number) { return this.canMoveBase(u, to) }
  /** 制伏：雙方都在第 1 格、對方正在過載；精英與首領要餘韻疊滿 */
  canSubdue(a: RealUnit, t: RealUnit) { return a.slot === 1 && t.slot === 1 && t.stun && !t.down && (!(t.elite || t.boss || t.side === 'P') || t.layers >= t.layersMax) }
  subdue(a: RealUnit, t: RealUnit) {
    const r = d20(this.rng) + a.mel, dc = 10 + t.tier * 2
    if (r >= dc) { t.out = true; this.fall(t, ` 被制伏，退出戰鬥（格鬥 ${r} 對 ${dc}）。`) }
    else this.log(`${this.tag(a)} 想制伏 ${this.tag(t)}，沒壓住（格鬥 ${r} 對 ${dc}）。`)
  }

  // ---- 敵人的 AI（照 Demo） ----
  /** 做一個動作；沒事可做或這一場結束時回傳 false（畫面接著結束這個人的回合） */
  aiStep(): boolean {
    const u = this.cur()
    if (this.end || u.down || this.aiN > 6 || u.ap <= 0) return false
    this.aiN++
    const foes = this.alive('P'), w = this.wp(u), s = u.ws[u.wi]
    let did = false
    const sub = foes.find(t => this.canSubdue(u, t))
    if (sub && u.ap >= 2) { u.ap -= 2; this.subdue(u, sub); did = true }
    else if (w.melee) {
      const t = foes.find(t => this.dist(u, t) === 1)
      if (t && u.ap >= 2) { u.ap -= 2; this.attack(u, t); did = true }
      else if (!t && u.ws.length > 1 && u.ap >= 1) { u.ap--; u.wi = 1; this.log(`${this.tag(u)} 換成${this.wp(u).n}。`); did = true }
    } else if (s.mag < 1) {
      if (u.ap >= 1) { u.ap--; s.mag = w.mag; this.log(`${this.tag(u)} 換彈。`); did = true }
    } else {
      const t = foes.slice().sort((a, b) => this.hitChance(u, b, w) - this.hitChance(u, a, w) || a.hp - b.hp)[0]
      const to = !u.mv && u.ap >= 3 && this.cov.E[u.slot].l === 0 ? [u.slot + 1, u.slot - 1].find(x => x >= 1 && x <= 4 && this.cov.E[x].l > 0 && this.canMove(u, x)) : undefined
      if (u.slot === 1 && u.ws.some(x => REAL_WEAPONS[x.k].melee) && foes.some(f => this.dist(u, f) === 1) && u.ap >= 1) {
        u.ap--; u.wi = u.ws.findIndex(x => REAL_WEAPONS[x.k].melee); this.log(`${this.tag(u)} 換成${this.wp(u).n}。`); did = true
      } else if (to) { u.ap--; u.mv = true; this.move(u, to); did = true }
      else if (t && u.ap >= 3 && s.mag >= 2 && this.rng() < 0.35) { u.ap -= 3; this.attack(u, t, { burst: true }); did = true }
      else if (t && u.ap >= 2) { u.ap -= 2; this.attack(u, t); did = true }
      else if (u.ap === 1 && !u.aim) { u.ap--; u.aim = true; this.log(`${this.tag(u)} 瞄準。`); did = true }
    }
    this.flushWatch()
    return did && !this.end
  }

  // ---- 玩家的行動 ----
  cost(k: string, u = this.cur()) { const a = REAL_ACTIONS.find(x => x.k === k); return k === 'shoot' && this.wp(u).snipe ? 3 : a?.c ?? 0 }
  ok(k: string, u: RealUnit): boolean {
    const w = this.wp(u), mag = u.ws[u.wi].mag
    switch (k) {
      case 'shoot': return !w.melee && mag >= 1
      case 'melee': return !!w.melee && this.alive('E').some(t => this.dist(u, t) === 1)
      case 'move': return this.canMove(u, u.slot - 1) || this.canMove(u, u.slot + 1)
      case 'reload': return !!w.mag && mag < w.mag
      case 'swap': return u.ws.length > 1
      case 'item': return u.kit > 0
      case 'cover': return !w.melee && mag >= 1 && this.cov.E.some(c => c.l > 0)
      case 'watch': return !u.watch
      case 'subdue': return this.alive('E').some(t => this.canSubdue(u, t))
      default: return false
    }
  }
  /** 現在做不到的原因；做得到回傳 null */
  reason(k: string): string | null {
    if (this.end) return '戰鬥已經結束'
    const u = this.cur()
    if (u.side !== 'P') return '現在是敵人的回合'
    const a = REAL_ACTIONS.find(x => x.k === k)
    if (!a) return '沒有這個行動'
    if (u.ap < this.cost(k, u)) return '行動點不夠'
    return this.ok(k, u) ? null : a.w
  }
  /** 按下一格：要選目標的進入選目標，其他的直接做。回傳有沒有做 */
  act(k: string): boolean {
    if (this.reason(k)) return false
    const u = this.cur(), a = REAL_ACTIONS.find(x => x.k === k)!
    if (a.tg) { this.mode = this.mode === k ? null : k; return true }
    this.mode = null
    if (k === 'reload') { u.ap--; u.ws[u.wi].mag = this.wp(u).mag; this.log(`${u.name} 換彈。`) }
    else if (k === 'swap') { u.ap--; u.wi = (u.wi + 1) % u.ws.length; this.log(`${u.name} 換成${this.wp(u).n}。`) }
    else if (k === 'watch') { u.ap -= 2; u.watch = true; this.log(`${u.name} 監視：敵人一站上暴露的格子就開槍。`) }
    else if (k === 'item') {
      u.ap--; u.kit--
      const v = d6(this.rng, 2)
      u.hp = Math.min(u.hpMax, u.hp + v)
      u.bleed = false
      this.log(`${u.name} 用急救噴劑：生命 +${v}，止血。`, 'g')
    }
    return true
  }
  /** 正在選目標時，可以選的目標（畫面的綠框，Tab 依序換） */
  targets(): Target[] {
    const m = this.mode, u = this.cur()
    if (!m || this.end) return []
    const foes = this.alive('E').sort((a, b) => a.slot - b.slot)
    if (m === 'shoot') return foes.map(t => ({ kind: 'unit', id: t.id }))
    if (m === 'melee') return foes.filter(t => this.dist(u, t) === 1).map(t => ({ kind: 'unit', id: t.id }))
    if (m === 'subdue') return foes.filter(t => this.canSubdue(u, t)).map(t => ({ kind: 'unit', id: t.id }))
    if (m === 'move') return [u.slot - 1, u.slot + 1].filter(s => this.canMove(u, s)).map(slot => ({ kind: 'slot', side: 'P', slot }))
    if (m === 'cover') return [1, 2, 3, 4].filter(s => this.cov.E[s].l > 0).map(slot => ({ kind: 'slot', side: 'E', slot }))
    return []
  }
  pick(t: Target): boolean {
    if (!this.mode || this.end) return false
    const u = this.cur(), k = this.mode
    const ok = this.targets().some(x => sameTarget(x, t))
    if (!ok) return false
    if (t.kind === 'unit') {
      const tu = this.units[t.id]
      if (k === 'shoot') { u.ap -= this.cost('shoot', u); this.attack(u, tu) }
      else if (k === 'melee') { u.ap -= 2; this.attack(u, tu) }
      else if (k === 'subdue') { u.ap -= 2; this.subdue(u, tu) }
    } else {
      if (k === 'move') { u.ap--; this.move(u, t.slot) }
      else if (k === 'cover') {
        u.ap -= 2
        u.ws[u.wi].mag--
        const w = this.wp(u), dm = Math.round(d6(this.rng, w.dice) * Math.max(1, w.cm * 2))
        this.log(`${u.name} 打敵方第 ${t.slot} 格的遮蔽（${dm}）。`)
        this.hurtCover('E', t.slot, dm)
      }
    }
    this.mode = null
    this.flushWatch()
    return true
  }
  /** 脫離：花 2 點，全隊擲一次 d20 + 3 對 10 ＋ 敵方最高等級 × 2 */
  flee(): boolean | null {
    const u = this.cur()
    if (this.end || u.side !== 'P' || u.ap < 2) return null
    u.ap -= 2
    const r = d20(this.rng) + 3, dc = 10 + Math.max(...this.alive('E').map(x => x.tier)) * 2
    if (r >= dc) { this.finish('fled', '脫離成功：全隊離開這場戰鬥，回到地圖上。敵人還在原地。', `脫離成功（${r} 對 ${dc}）。`); return true }
    this.log(`脫離失敗（${r} 對 ${dc}）：這 2 點行動點不退，沒有別的懲罰。`, 'r')
    return false
  }
  surrender() {
    if (this.end) return
    this.finish('surrender', '投降：戰鬥結束，算戰敗。之後不再受傷害，每個人停在現在的生命與感載。在正式的遊戲裡，這裡直接進戰敗事件（和全隊倒下時是同一個，依贏的是誰）。', '投降。')
  }
}
