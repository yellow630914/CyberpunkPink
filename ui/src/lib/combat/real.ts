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
  // 第四版：機甲的武器（ITEMS 14.4 節的 I 級）與無人機（傷害比手槍低一級，COMBAT_SYSTEM 9.1 節）
  mech_gun: { n: '機甲機砲', dice: 4, r: [1, 6], mag: 4, pen: 2, t: 'p', cm: 1 },
  drone_gun: { n: '無人機的機槍', dice: 2, r: [1, 5], mag: 0, pen: 0, t: 'p', cm: 0.25 },
}
/** 機甲（COMBAT_SYSTEM 9.3 節、ENEMIES 11.1 節）：機師的強化狀態，只佔自己那一格 */
export interface MechSpec { name: string; dur: number; armor: number; turns: number; weapon: string }
/** 無人機（COMBAT_SYSTEM 9.1 節）：掛在我方某一格、和人重疊、永遠暴露；生命與護甲照等級（I 14／1） */
export type DroneKind = 'atk' | 'shield'
export interface Drone { id: number; owner: number; side: Side; slot: number; kind: DroneKind; name: string; hp: number; hpMax: number; armor: number; used: boolean; down: boolean; guard: boolean; turret?: boolean }
export const DRONE_NAMES: Record<DroneKind, string> = { atk: '攻擊型無人機', shield: '護盾型無人機' }
/** 控制節點（COMBAT_SYSTEM 2.4 節）：潛網者拿下之後可以關燈、放防爆門、接管砲塔 */
export interface ControlNode { id: string; kind: 'light' | 'door' | 'turret'; name: string; taken: boolean; used: boolean }
export const NODE_NAMES: Record<ControlNode['kind'], string> = { light: '燈光控制', door: '防爆門', turret: '砲塔' }
/** 同步原則的回灌倍率（CORE_RULES 第 5 節）：機甲的回灌 20% × 這個 */
export const SYNC_BACKLASH = { 淺: 0.5, 標準: 1, 深: 1.5, 全: 2.5 } as const
/** 行動圓環中心的技能清單的一列 */
export interface SkillAction { k: string; n: string; c: number; ram?: number; tg?: 'foe' | 'marked' | 'pslot'; d: string; why: string | null }
export const REAL_COVER_NAMES = ['暴露', '半掩體', '掩體'] as const

export interface RealUnit extends BaseUnit {
  hp: number; hpMax: number; armor: number
  stun: boolean; daze: boolean; bleed: boolean; boss: boolean
  /** 快取格裡的急救噴劑 */
  kit: number
  /** 難度的傷害係數（BALANCE 7.2 節），只用在敵人 */
  dmgMult: number
  ws: Array<{ k: string; mag: number }>
  // ---- 第四版 ----
  skills: string[]
  hack: { bonus: number; ram: number } | null
  ram: number
  fw: number
  sync: number
  nv: boolean
  smoke: number
  /** 被「就是你了」或快駭的標記指定：全隊打他命中 +2；markBy 是誰標的（他的下一回合開始時清掉） */
  mark: number | null
  /** 這一場用過的每場一次的東西 */
  once: string[]
  /** 支援類快駭每回合一次 */
  qhSupport: boolean
  mech: MechSpec | null
  mechOn: boolean
  mechDur: number
  mechLeft: number
  mechUsed: boolean
  baseArmor: number
  dronesKit: DroneKind[]
}
export interface RealUnitSpec {
  name: string; role?: string; hp: number; armor: number; lm: number; lay: number; ap: number; refl: number; gun: number
  mel?: number; will?: number; tier?: number; elite?: boolean; boss?: boolean; kit?: number; dmg?: number; ws: string[]
  /** 第四版：學會的主動技能（技能樹的名字：要害射擊、定點射、連射控制、看我的！、就是你了） */
  skills?: string[]
  /** 快駭（ITEMS 11.9 節，潛網者限定）：檢定加值（智識＋介面＋主控）與 RAM */
  hack?: { bonus: number; ram: number }
  /** 防火牆（快駭的目標值）；沒寫是 10 ＋ 等級 × 2 */
  fw?: number
  /** 同步（基本功）：無人機連得住幾台、機甲的持續 */
  sync?: number
  mech?: MechSpec
  drones?: DroneKind[]
  /** 夜視：黑暗裡攻擊不受影響 */
  nv?: boolean
  /** 煙霧彈的數量 */
  smoke?: number
}
export interface RealSetup {
  party: RealUnitSpec[]
  foes: RealUnitSpec[]
  covP?: Cover[]
  covE?: Cover[]
  /** 要活的：敵方第幾個（0 起算）要制伏，不能打死 */
  capture?: number
  /** 第四版：場上的控制節點與場地效果 */
  nodes?: Array<ControlNode['kind']>
  dark?: boolean
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
    skills: o.skills ?? [], hack: o.hack ?? null, ram: o.hack?.ram ?? 0, fw: o.fw ?? 10 + (o.tier ?? 1) * 2, sync: o.sync ?? 0, nv: !!o.nv, smoke: o.smoke ?? 0,
    mark: null, once: [], qhSupport: false, mech: o.mech ?? null, mechOn: false, mechDur: 0, mechLeft: 0, mechUsed: false, baseArmor: o.armor, dronesKit: [...(o.drones ?? [])],
  }
}

export class RealBattle extends SlotBattle<RealUnit> {
  readonly coverNames = REAL_COVER_NAMES
  readonly wallWord = '遮蔽'
  captureId: number | null = null
  kills = 0
  /** 第四版：無人機（和人重疊）、控制節點、場地效果 */
  drones: Drone[] = []
  nodes: ControlNode[] = []
  dark = false
  private droneSeq = 1

  constructor(setup: RealSetup, rng: Rng) {
    super(rng, setup.covP ?? [cover(1), cover(2), cover(2), cover(1)], setup.covE ?? [cover(1), cover(2), cover(1), cover(2)])
    setup.party.forEach((p, i) => this.units.push(makeUnit('P', i + 1, p)))
    setup.foes.forEach((p, i) => this.units.push(makeUnit('E', i + 1, p)))
    this.rollInitiative()
    this.nodes = (setup.nodes ?? []).map((k, i) => ({ id: `n${i}`, kind: k, name: NODE_NAMES[k], taken: false, used: false }))
    this.dark = !!setup.dark
    if (setup.capture != null) this.captureId = this.units.filter(u => u.side === 'E')[setup.capture]?.id ?? null
    this.log('戰鬥開始。第一回合所有人從行動點上限開始。', 'h')
    if (this.captureId != null) this.log(`委託的條件：要活的。${this.units[this.captureId].name}要制伏，不能打死。`, 'h')
  }

  wp(u: RealUnit) { return REAL_WEAPONS[u.ws[u.wi].k] }
  /**
   * 迴避 = 10 ＋ 反應 ＋ 遮蔽（半掩體 +2、掩體 +4；機甲用不了遮蔽）＋ 同一格的護盾型無人機 +2 − 餘韻；
   * 黑暗時全場 +2，攻擊的一方有夜視就不算（COMBAT_SYSTEM 2.5 節）
   */
  dodge(u: RealUnit, by?: RealUnit) {
    const cov = u.mechOn ? 0 : COVER_BONUS[this.coverOf(u).l]
    const shield = this.drones.some(d => !d.down && d.side === u.side && d.slot === u.slot && d.kind === 'shield') ? 2 : 0
    return 10 + u.refl + cov + shield + (this.dark && !(by?.nv) ? 2 : 0) - u.layers
  }
  /** 命中的加值 = 槍械或格鬥 ＋ 距離 ＋ 瞄準 +3 ＋ 被標記 +2 − 被壓制 2 − 餘韻 */
  bonus(a: RealUnit, t: RealUnit, w: RealWeapon) { return (w.melee ? a.mel : a.gun) + this.rangeMod(a, t, w) + (a.aim || w.snipe ? 3 : 0) + (t.mark !== null && a.side !== t.side ? 2 : 0) + (a.once.includes('看我的！:now') ? 1 : 0) - (a.supp ? 2 : 0) - a.layers }
  hitChance(a: RealUnit, t: RealUnit, w = this.wp(a)) { return clamp((21 - (this.dodge(t, a) - this.bonus(a, t, w))) * 5, 5, 95) }
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
    // 操作者倒下，所有無人機停機（COMBAT_SYSTEM 9.1 節）
    for (const d of this.drones) if (d.owner === u.id && !d.down) { d.down = true; this.log(`${d.name}停機了。`) }
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
    const r = d20(this.rng), bonus = this.bonus(a, t, w), tot = r + bonus, dg = this.dodge(t, a), cb = t.mechOn ? 0 : COVER_BONUS[this.coverOf(t).l]
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
      else if (this.shieldBlock(t)) { this.log(`${msg}命中，可是護盾型無人機替 ${this.tag(t)} 擋下了這一擊。`, 'g') }
      else if (t.mechOn) { this.log(`${msg}${crit ? '要害！' : '命中，'}打在機體上。`); this.mechHit(t, Math.max(0, raw - Math.max(0, t.armor - w.pen))) }
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
      this.turnStart(u)
      if (u.down) { this.advance(); continue }
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
    // 第四版：敵方的機師照 ENEMIES 11.3 節啟動機甲（精英第 2 回合、首領第 1 回合）；偶爾先打掉一台無人機
    if (u.mech && !u.mechUsed && u.ap >= 3 && (this.round >= 2 || u.boss)) { this.mechStart(u); return true }
    const dr = this.drones.filter(d => !d.down && d.side !== u.side)
    if (dr.length && !this.wp(u).melee && u.ws[u.wi].mag >= 1 && u.ap >= 2 && this.rng() < 0.3) { u.ap -= 2; this.shootDrone(u, dr[0]); this.flushWatch(); return !this.end }
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
    if (m.startsWith('sk:')) return this.skillTargets(m.slice(3), u)
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
    if (k.startsWith('sk:')) { this.skillPick(k.slice(3), u, t); this.mode = null; this.flushWatch(); return true }
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

  // ======================================================================
  // 第四版：主動技能、快駭、機甲、無人機、控制節點、場地效果
  // ======================================================================
  /** 每個人的回合開始時：清掉他下的標記、RAM 回 1、無人機可以再指揮、機甲多回 2 點並倒數 */
  turnStart(u: RealUnit) {
    for (const t of this.units) if (t.mark === u.id) t.mark = null
    u.qhSupport = false
    if (u.hack && this.round > 1) u.ram = Math.min(u.hack.ram, u.ram + 1)
    for (const d of this.drones) if (d.owner === u.id) d.used = false
    if (u.mechOn) {
      if (this.round > 1) u.ap = Math.min(u.apMax + 2, u.ap + 2)
      u.mechLeft--
      if (u.mechLeft <= 0) this.mechOff(u, '時間到，機甲解除。')
    }
  }
  /** 煙霧那一格打不破（COMBAT_SYSTEM 2.5 節） */
  smokeAt: string[] = []
  hurtCover(side: Side, slot: number, dmg: number) { if (this.smokeAt.includes(`${side}${slot}`)) return; super.hurtCover(side, slot, dmg) }

  // ---- 機甲 ----
  mechStart(u: RealUnit) {
    const m = u.mech!
    u.ap -= 3
    u.mechUsed = true; u.mechOn = true; u.mechDur = m.dur; u.mechLeft = m.turns
    u.armor = Math.min(8, u.baseArmor + m.armor)
    u.ws.push({ k: m.weapon, mag: REAL_WEAPONS[m.weapon].mag }); u.wi = u.ws.length - 1
    this.log(`${this.tag(u)} 啟動${m.name}：機體 ${m.dur}、護甲 +${m.armor}、每回合多回 2 點行動點，持續 ${m.turns} 回合；用不了遮蔽。`, 'h')
  }
  mechOff(u: RealUnit, why: string) {
    if (!u.mechOn) return
    u.mechOn = false; u.mechDur = 0; u.armor = u.baseArmor
    const i = u.ws.findIndex(w => w.k === u.mech!.weapon)
    if (i >= 0) u.ws.splice(i, 1)
    u.wi = 0
    this.log(`${this.tag(u)}：${why}`, 'h')
  }
  /** 實彈打在機體上：先扣機體耐久；20% 回灌成機師的感載（標準檔）；機體歸零損毀，感載 +15 */
  mechHit(t: RealUnit, dm: number) {
    if (dm <= 0) { this.log(`${this.tag(t)} 的機體沒受傷。`); return }
    t.mechDur -= dm
    const back = Math.max(1, Math.round(dm * 0.2 * SYNC_BACKLASH['標準']))
    this.log(`機體 −${dm}（剩 ${Math.max(0, t.mechDur)}），回灌：${this.tag(t)} 感載 +${back}。`)
    this.neural(t, back)
    if (t.mechDur <= 0 && !t.down) { this.mechOff(t, '機體損毀，機甲解除。機師感載 +15。'); this.neural(t, 15) }
  }

  // ---- 無人機 ----
  droneCap(u: RealUnit) { return u.sync <= 1 ? 1 : u.sync <= 3 ? 2 : u.sync <= 5 ? 3 : 4 }
  dronesOf(u: RealUnit) { return this.drones.filter(d => d.owner === u.id && !d.down && !d.turret) }
  droneAt(side: Side, slot: number) { return this.drones.find(d => !d.down && d.side === side && d.slot === slot) ?? null }
  /** 護盾型無人機替同一格的人擋下一次攻擊 */
  shieldBlock(t: RealUnit) {
    const d = this.drones.find(x => !x.down && x.side === t.side && x.slot === t.slot && x.kind === 'shield' && x.guard)
    if (!d) return false
    d.guard = false
    return true
  }
  addDrone(owner: RealUnit, kind: DroneKind, slot: number, turret = false) {
    const d: Drone = { id: this.droneSeq++, owner: owner.id, side: owner.side, slot, kind, name: turret ? '接管的砲塔' : DRONE_NAMES[kind], hp: turret ? 20 : 14, hpMax: turret ? 20 : 14, armor: 1, used: false, down: false, guard: kind === 'shield', turret }
    this.drones.push(d)
    return d
  }
  /** 無人機開槍：命中用操作者的槍械，距離照無人機那一格算；傷害 2d6（比手槍低一級） */
  droneShoot(d: Drone, owner: RealUnit, t: RealUnit) {
    const w = REAL_WEAPONS.drone_gun, r = d20(this.rng)
    const b = owner.gun + this.rangeMod({ ...owner, slot: d.slot } as RealUnit, t, w) + (t.mark !== null ? 2 : 0), dg = this.dodge(t, owner)
    if (r === 20 || (r !== 1 && r + b >= dg)) {
      if (this.shieldBlock(t)) { this.log(`${d.name}打中了，可是護盾擋下了。`); return }
      if (t.mechOn) { this.log(`${d.name}命中 ${this.tag(t)} 的機體。`); this.mechHit(t, Math.max(0, d6(this.rng, w.dice) - t.armor)); return }
      const dm = Math.max(0, d6(this.rng, w.dice) - t.armor)
      t.hp -= dm
      this.log(`${d.name}（${owner.name}指揮）射擊 ${this.tag(t)}：${r}${b >= 0 ? '+' : ''}${b} 對 ${dg}，命中，傷害 ${dm}。`)
      if (t.hp <= 0) { t.hp = 0; this.fall(t, ' 被打倒。') }
    } else this.log(`${d.name}（${owner.name}指揮）射擊 ${this.tag(t)}：${r}${b >= 0 ? '+' : ''}${b} 對 ${dg}，沒打中。`)
  }
  /** 敵人單獨瞄準一台無人機：永遠暴露（迴避 10）；擊落時操作者感載 +5 */
  shootDrone(a: RealUnit, d: Drone) {
    const w = this.wp(a)
    if (w.mag) a.ws[a.wi].mag--
    const r = d20(this.rng), tot = r + a.gun
    if (r !== 1 && tot >= 10) {
      const dm = Math.max(1, Math.round(Math.max(0, d6(this.rng, w.dice) - d.armor) * this.tierMult(a)))
      d.hp -= dm
      this.log(`${this.tag(a)} 瞄準${d.name}：${tot} 對 10，命中，耐久 −${dm}。`)
      if (d.hp <= 0) {
        d.down = true
        const o = this.units[d.owner]
        this.log(`${d.name}被擊落了。${d.turret ? '' : `${o.name}感載 +5（回灌）。`}`, 'r')
        if (!d.turret && !o.down) this.neural(o, 5)
      }
    } else this.log(`${this.tag(a)} 瞄準${d.name}：${tot} 對 10，沒打中。`)
  }

  // ---- 技能清單（行動圓環的中心） ----
  skillList(u = this.cur()): SkillAction[] {
    if (u.side !== 'P') return []
    const out: SkillAction[] = []
    const has = (n: string) => u.skills.includes(n)
    const w = this.wp(u), mag = u.ws[u.wi].mag
    if (has('要害射擊')) out.push({ k: 'aim', n: '要害射擊', c: has('定點射') ? 2 : 3, tg: 'foe', d: '瞄準再射擊一次（花彈匣 1 格）：命中 +3，打出要害時擲重創。', why: w.melee ? '手上是近戰武器' : mag < 1 ? '彈匣空了' : null })
    if (has('連射控制')) out.push({ k: 'burst', n: '連射', c: 3, tg: 'foe', d: '花掉彈匣裡剩下的全部（至少 2 格）：傷害骰多「格數 − 1」顆；目標過定力（DC 10＋格數×2），失敗被壓制。', why: w.melee ? '手上是近戰武器' : w.mag < 2 ? '彈匣容量不到 2' : mag < 2 ? '彈匣剩不到 2 格' : null })
    if (has('看我的！')) out.push({ k: 'first', n: '看我的！', c: 1, tg: 'foe', d: '只能在第一回合：射擊一次只花 1 點，命中 +1。每場一次。', why: this.round !== 1 ? '只能在第一回合用' : u.once.includes('看我的！') ? '這一場用過了' : w.melee || mag < 1 ? '要有子彈的槍' : null })
    if (has('就是你了')) out.push({ k: 'mark', n: '就是你了', c: 1, tg: 'foe', d: '指定一個敵人：到你的下一回合開始前，全隊打他命中 +2。', why: null })
    if (u.hack) {
      out.push({ k: 'qh_tag', n: '快駭・標記', c: 0, ram: 1, tg: 'foe', d: '支援類：不用檢定，標記一個看得到的敵人（全隊打他 +2；控制類快駭要先標記）。每回合一次。', why: u.qhSupport ? '支援類快駭這回合用過了' : null })
      out.push({ k: 'qh_short', n: '快駭・短路', c: 1, ram: 2, tg: 'foe', d: '神經類：快駭檢定對目標的防火牆，成功感載 +2d6（機甲擋不住，直接打在機師身上）。', why: null })
      out.push({ k: 'qh_freeze', n: '快駭・癱瘓', c: 1, ram: 3, tg: 'marked', d: '控制類：目標要先被標記；防火牆精英 +2、首領 +4。成功他失去下一回合。', why: this.alive('E').some(t => t.mark !== null) ? null : '沒有被標記的敵人' })
      for (const n of this.nodes.filter(x => !x.taken)) out.push({ k: `node:${n.id}`, n: `奪取${n.name}`, c: 1, ram: 2, d: '快駭檢定對 DC 13：拿下這個控制節點。', why: null })
    }
    for (const n of this.nodes.filter(x => x.taken && !x.used)) {
      if (n.kind === 'light') out.push({ k: `use:${n.id}`, n: this.dark ? '開燈' : '關燈', c: 1, d: '黑暗：全場迴避 +2，有夜視的攻擊不受影響。', why: null })
      if (n.kind === 'door') out.push({ k: `use:${n.id}`, n: '放下防爆門', c: 1, tg: 'pslot', d: '替我方一格造出掩體。', why: null })
      if (n.kind === 'turret') out.push({ k: `use:${n.id}`, n: '接管砲塔', c: 1, tg: 'pslot', d: '砲塔照無人機的規則掛在我方一格，你可以指揮它開槍。', why: this.droneAtFree() ? null : '我方每一格都掛著東西了' })
    }
    if (u.mech) out.push({ k: 'mech', n: `啟動${u.mech.name}`, c: 3, d: `機甲是大招：機體 ${u.mech.dur}、護甲 +${u.mech.armor}、每回合多回 2 點，持續 ${u.mech.turns} 回合；用不了遮蔽；機體受傷的 20% 變成你的感載。每場一次。`, why: u.mechUsed ? '這一場用過了' : null })
    if (u.dronesKit.length) out.push({ k: 'drone', n: `放出${DRONE_NAMES[u.dronesKit[0]]}`, c: 1, tg: 'pslot', d: `掛在我方一格，和人重疊、永遠暴露。同步 ${u.sync} 連得住 ${this.droneCap(u)} 台。`, why: this.dronesOf(u).length >= this.droneCap(u) ? `同步 ${u.sync} 只連得住 ${this.droneCap(u)} 台` : this.droneAtFree() ? null : '我方每一格都掛著東西了' })
    for (const d of this.drones.filter(x => x.owner === u.id && !x.down)) {
      if (d.kind === 'atk') out.push({ k: `cmd:${d.id}`, n: `指揮${d.name}（第 ${d.slot} 格）`, c: 1, tg: 'foe', d: '讓它射擊一次：命中用你的槍械，傷害 2d6。每台每回合一次。', why: d.used ? '這一台這回合動過了' : null })
      else out.push({ k: `cmd:${d.id}`, n: `${d.name}：架起護盾`, c: 1, d: '替同一格的人擋下一次攻擊；同一格的人迴避 +2。', why: d.used ? '這一台這回合動過了' : d.guard ? '護盾已經架著' : null })
    }
    if (u.smoke > 0) out.push({ k: 'smoke', n: `煙霧彈（${u.smoke}）`, c: 1, tg: 'pslot', d: '我方一格變成打不破的半掩體。', why: null })
    return out
  }
  private droneAtFree() { return [1, 2, 3, 4].some(sl => !this.droneAt('P', sl)) }
  skillReason(k: string): string | null {
    if (this.end) return '戰鬥已經結束'
    const u = this.cur()
    if (u.side !== 'P') return '現在是敵人的回合'
    const s = this.skillList(u).find(x => x.k === k)
    if (!s) return '沒有這個技能'
    if (u.ap < s.c) return '行動點不夠'
    if (s.ram && u.ram < s.ram) return `RAM 不夠（要 ${s.ram}）`
    return s.why
  }
  /** 按技能：要選目標的進入選目標（mode = 'sk:…'），其他的直接做 */
  skillAct(k: string): boolean {
    if (this.skillReason(k)) return false
    const u = this.cur(), s = this.skillList(u).find(x => x.k === k)!
    if (s.tg) { this.mode = `sk:${k}`; return true }
    this.mode = null
    u.ap -= s.c
    if (s.ram) u.ram -= s.ram
    if (k === 'mech') { u.ap += 3; this.mechStart(u) }
    else if (k.startsWith('node:')) {
      const n = this.nodes.find(x => `node:${x.id}` === k)!, r = d20(this.rng) + u.hack!.bonus
      if (r >= 13) { n.taken = true; this.log(`${u.name} 快駭${n.name}（${r} 對 13）：拿下了。`, 'g') }
      else this.log(`${u.name} 快駭${n.name}（${r} 對 13）：沒拿下。`, 'r')
    } else if (k.startsWith('use:')) {
      const n = this.nodes.find(x => `use:${x.id}` === k)!
      if (n.kind === 'light') { this.dark = !this.dark; this.log(this.dark ? `${u.name} 關了燈：場地變成黑暗，全場迴避 +2。` : `${u.name} 把燈打開。`, 'h') }
    } else if (k.startsWith('cmd:')) {
      const d = this.drones.find(x => `cmd:${x.id}` === k)!
      d.used = true; d.guard = true
      this.log(`${u.name} 讓${d.name}架起護盾。`)
    }
    this.flushWatch()
    return true
  }
  private skillTargets(k: string, u: RealUnit): Target[] {
    const foes = this.alive('E').sort((a, b) => a.slot - b.slot)
    const s = this.skillList(u).find(x => x.k === k)
    if (!s) return []
    if (s.tg === 'foe') return foes.map(t => ({ kind: 'unit', id: t.id }))
    if (s.tg === 'marked') return foes.filter(t => t.mark !== null).map(t => ({ kind: 'unit', id: t.id }))
    if (s.tg === 'pslot') return [1, 2, 3, 4].filter(sl => (k === 'smoke' || k.startsWith('use:') && this.nodes.find(n => `use:${n.id}` === k)?.kind === 'door') ? true : !this.droneAt('P', sl)).map(slot => ({ kind: 'slot', side: 'P', slot }))
    return []
  }
  private skillPick(k: string, u: RealUnit, t: Target) {
    const s = this.skillList(u).find(x => x.k === k)!
    u.ap -= s.c
    if (s.ram) u.ram -= s.ram
    if (t.kind === 'unit') {
      const tu = this.units[t.id]
      if (k === 'aim') { u.aim = true; this.log(`${u.name} 要害射擊：瞄準。`); this.attack(u, tu) }
      else if (k === 'burst') this.attack(u, tu, { burst: true })
      else if (k === 'first') { u.once.push('看我的！', '看我的！:now'); this.attack(u, tu); u.once = u.once.filter(x => x !== '看我的！:now') }
      else if (k === 'mark' || k === 'qh_tag') { tu.mark = u.id; if (k === 'qh_tag') u.qhSupport = true; this.log(`${u.name} ${k === 'mark' ? '指定' : '快駭標記'} ${this.tag(tu)}：全隊打他命中 +2。`, 'h') }
      else if (k === 'qh_short') {
        const r = d20(this.rng) + u.hack!.bonus
        if (r >= tu.fw) { const v = d6(this.rng, 2); this.log(`${u.name} 快駭・短路 ${this.tag(tu)}（${r} 對防火牆 ${tu.fw}）：感載 +${v}。`); this.neural(tu, v) }
        else this.log(`${u.name} 快駭・短路 ${this.tag(tu)}（${r} 對防火牆 ${tu.fw}）：被擋下。`, 'r')
      } else if (k === 'qh_freeze') {
        const fw = tu.fw + (tu.boss ? 4 : tu.elite ? 2 : 0), r = d20(this.rng) + u.hack!.bonus
        if (r >= fw) { tu.stun = true; this.log(`${u.name} 快駭・癱瘓 ${this.tag(tu)}（${r} 對 ${fw}）：他失去下一回合。`, 'g') }
        else this.log(`${u.name} 快駭・癱瘓 ${this.tag(tu)}（${r} 對 ${fw}）：被擋下。`, 'r')
      } else if (k.startsWith('cmd:')) {
        const d = this.drones.find(x => `cmd:${x.id}` === k)!
        d.used = true
        this.droneShoot(d, u, tu)
      }
    } else {
      if (k === 'drone') { const kind = u.dronesKit.shift()!; const d = this.addDrone(u, kind, t.slot); this.log(`${u.name} 放出${d.name}，掛在我方第 ${t.slot} 格。`) }
      else if (k === 'smoke') { u.smoke--; this.cov.P[t.slot] = { l: 1, d: 99 }; this.smokeAt.push(`P${t.slot}`); this.log(`${u.name} 丟出煙霧彈：我方第 ${t.slot} 格變成打不破的半掩體。`, 'h') }
      else if (k.startsWith('use:')) {
        const n = this.nodes.find(x => `use:${x.id}` === k)!
        n.used = true
        if (n.kind === 'door') { this.cov.P[t.slot] = { l: 2, d: 30 }; this.log(`${u.name} 放下防爆門：我方第 ${t.slot} 格變成掩體。`, 'h') }
        if (n.kind === 'turret') { this.addDrone(u, 'atk', t.slot, true); this.log(`${u.name} 接管了砲塔，掛在我方第 ${t.slot} 格。`, 'h') }
      }
    }
  }
}
