// L5 戰鬥：算一步。BattleRun 拿著戰鬥狀態的工作副本與這一步的紀錄，提供所有行動共用的基本動作：
// 擲骰、花行動點、攻擊（命中、要害、遮蔽、傷害、重創）、感載與過載、狀態、換位與推拉、補位、監視、倒下與分出結果。
// 功能註冊的行動只組合這些基本動作，不自己改戰鬥狀態的欄位以外的東西，也不碰 GameState：
// 一步算完之後，整份戰鬥狀態由一筆 battle 變更交給提交報告（dev/invariants.md 第 1 條）。
//
// 以第四版介面的 ui/src/lib/combat/real.ts、field.ts 當底，逐條對照 COMBAT_SYSTEM 改寫；和設計書對不上的地方列在 dev/adr/0013。

import type { AttrId, BattleCover, BattleImplant, BattleOverlay, BattleOverlayInit, BattleSide, BattleState, BattleStatus, BattleUnit, BattleUntil, BattleWeapon, CheckRoll, CoverLevel, DamageType, GameState, RollPart, SkillId, TimelineBeat } from '../types'
import { ATTR_IDS, BATTLE_SLOTS } from '../types'
import { attrMod, computeDegree, verdictOf } from '../rules/check'
import { battleAttr } from '../rules/sync'
import { deriveRng } from '../util/rng'
import { clamp, isRecord } from '../util/sanitize'
import { clone } from '../util/clone'
import { BattleBlocked } from './act'
import { runEffects } from './effects'
import { SIDE_NAME, afterglowFull, coverAt, coverLevel, coverOf, currentUnit, cutKey, distance, isCut, isWounded, onField, otherSide, overlayAt, poolName, rangeMod, standing, unitAt, unitTag, unitsOf, wielded } from './field'
import type { BattleEffectInput, BattleEffectLast, BattleKernel, BattleView, BenchEntry, UnitSourceCtx } from './registry'
import type { BattleMode, BattleNumbers, BattleStatusRule, ModKind, StatusUntil } from './rules'
import { FLASH, LOSE_TURN, coverHpFor, damageTypeOf, modeOf, statusMod, statusRuleOf } from './rules'
import type { UnitRef } from './units'
import { buildUnit, resolveUnit } from './units'

const sum = (parts: RollPart[]): number => parts.reduce((s, p) => s + p.value, 0)

/** 先攻的順序：由高到低；一樣高時我方先、再照站位（COMBAT_SYSTEM 1.2 節）。負的是 a 先。 */
export function initiativeOrder(a: BattleUnit, b: BattleUnit): number {
  return b.initiative - a.initiative || (a.side === b.side ? a.slot - b.slot : a.side === 'ally' ? -1 : 1)
}

/** 一次攻擊的選項：行動與技能用這些組出各種打法（瞄準、連射、穿透、不耗彈……）。 */
export interface AttackOpts {
  /** 用哪一把；沒寫是手上那一把 */
  weapon?: BattleWeapon
  /** 這一擊算瞄準過的射擊：命中加上瞄準的加值，打出要害時重創（COMBAT_SYSTEM 第 6 節）。武器帶 aimed 特性時一律算 */
  aimed?: boolean
  /** 額外的命中加值 */
  hit?: number
  /** 目標這一次迴避的加減（小心後面！+3） */
  evade?: number
  /** 額外的傷害骰（連射：花掉的格數 − 1） */
  dice?: number
  /** 額外的固定傷害 */
  damage?: number
  pierce?: number
  /** 要害門檻的加減（負的更容易） */
  critMargin?: number
  /** 命中就一定算要害 */
  autoCrit?: boolean
  /** 不擲重創 */
  noWound?: boolean
  /** 重創的部位由攻擊者選（瞄準過的射擊） */
  part?: string
  /** 把目標那一格的遮蔽當成低幾級來算 */
  coverShift?: number
  /** 這一擊對遮蔽的倍率至少算多少 */
  coverMultMin?: number
  /** 這一擊不傷遮蔽 */
  noCoverDamage?: boolean
  /** 花彈匣幾格（預設 1）；0 是不耗彈 */
  spend?: number
  /** 換一種傷害類型（特殊彈） */
  type?: DamageType
  /** 紀錄上這一擊怎麼說（「連射」「瞄準射擊」「監視」） */
  label?: string
  /** 情境的標籤，給修正與掛點看：aimed、burst、reaction、watch、support…… */
  tags?: string[]
  /** 用已經擲好的 d20 面，不另外擲命中骰（投擲物：一顆骰對兩格）。自然 20 一定命中、自然 1 一定失手照舊 */
  natural?: number
  /** 目標的護甲乘幾倍再扣（空尖彈 2）；打掛著的東西時乘在它的護甲上 */
  armorMult?: number
  /**
   * 這一擊改打和人重疊的一台（由 attack.before 的處理函式設：無人機擋槍、立牌、替身）：照那一台自己的迴避與護甲算，原本的目標不受影響，
   * 彈匣只扣一次；結果帶 redirected: true。第一個設的算數（後面的處理函式再設不會蓋掉）；找不到、已經被擊落的就照原本的打
   */
  redirect?: { overlay: string }
  /**
   * 這一擊不打了（由 attack.before 的處理函式設：卡彈、炸膛、被禁止開火）：寫給玩家看的一句完整的話。設了之後核心結束這一擊——
   * 不擲任何骰、不發 attack.after、把這句話記成一拍、結果 aborted 並帶 cancelled，然後發 attack.cancel；彈匣已經扣了（扣在 attack.before 之前）。
   * 後面的 attack.before 處理函式不再跑。第一個設的算數
   */
  cancel?: string
  /** 取消那一拍多帶的資料欄位（jam: true、backfire: true）；只在 cancel 有設時用 */
  cancelData?: Record<string, unknown>
  /** 這一擊的傷害類型自己帶的沉溺（快感 +1）不加：由呼叫的人的效果決定（on_hit 帶定力檢定的 sink）。不經過 sink.before */
  noSink?: boolean
}

export interface AttackResult {
  /** 這一擊沒有發生（攻擊者在擲骰之前退出了，或替身那一台被擊落、收走：run.gone；被 opts.cancel 取消；目標已經不在）。效果用 noteAttack 寫進 last，hit 留 undefined */
  aborted?: boolean
  hit: boolean
  crit: boolean
  natural: number
  total: number
  evade: number
  /** 擲出來的傷害（還沒扣護甲） */
  raw: number
  /** 實際造成的量 */
  dealt: number
  /** 打在哪：hp、load、hull；none 是沒有效果（沒有橋的人吃神經傷害） */
  track: 'hp' | 'load' | 'hull' | 'none'
  wound: boolean
  /** 這一擊讓目標倒下 */
  downed: boolean
  /** 這一擊被改打到別的東西上（opts.redirect）：這份結果是那一台的；原本的目標不受影響，不發 attack.after */
  redirected?: boolean
  /** 命中了，但被 attack.hit 的處理函式擋下（out.negate）：沒有傷害、沒有重創、沒有推拉 */
  negated?: boolean
  /** 這一擊被 attack.before 的處理函式取消了（opts.cancel），值是那一句話；同時 aborted 也是 true */
  cancelled?: string
}

export interface StatusOpts {
  by?: BattleUnit
  /** 幾個回合；沒寫照資料 */
  turns?: number
  /** 什麼時候結束；沒寫照資料 */
  until?: StatusUntil
  /** 這一筆自己的數字（蓋掉資料的預設） */
  data?: Record<string, number>
  /** 不看首領的控制保護（過載的失去回合） */
  force?: boolean
  /** 不記「某某：狀態名」那一拍（呼叫的人自己記一拍，例如 run.implantStatus 要寫是哪一件義體） */
  quiet?: boolean
}

/** run.implantStatus 的選項（dev/adr/0015 第三節）。 */
export interface ImplantStatusOpts {
  /** 指定第幾件（implants 的索引）；最優先 */
  pick?: number
  /** 指定哪一種；沒有那一種就回傳 null */
  kind?: string
  by?: BattleUnit
  /** 幾個回合；沒寫照規則表 */
  turns?: number
  until?: StatusUntil
}

/** run.callIn 的選項。 */
export interface CallInOpts {
  /** 誰叫的（紀錄那一拍記他的角色）；沒寫就是沒有人（劇本、場地叫來的） */
  by?: BattleUnit
  /** 換掉叫人那一拍的句子（沒寫：「某某被叫來支援，下一輪開頭進場。」） */
  text?: string
}

/** 和人重疊的東西（無人機、砲塔）的標籤：機器（電磁加倍照這個算）。 */
const OVERLAY_TAGS: readonly string[] = ['machine']
/** 替身（和人重疊的東西自己開火時的攻擊者）的標籤。 */
const OVERLAY_STAND_IN_TAGS: readonly string[] = ['machine', 'overlay']

export class BattleRun implements BattleView {
  readonly mode: BattleMode
  readonly n: BattleNumbers
  /** 這一步的紀錄：一拍一句，帶事件的標籤 */
  readonly beats: TimelineBeat[] = []
  private exposedQueue: string[] = []
  private flushing = false
  /** 正在問 cover_level 的修正：修正的條件裡又問有效遮蔽時（in_cover）回答那一格本身的，不然會問不完 */
  private askingCover = false
  /** 這一步裡剛失去回合的那個人（beginTurn 設、advance 在發他的 turn.end 時用：帶 lost: true）。不是戰鬥狀態，不存檔 */
  skippedTurn?: string

  /** battle 是工作副本：呼叫的人先複製好；state 是這一步開始時的遊戲狀態，只讀。 */
  constructor(readonly k: BattleKernel, readonly state: GameState, readonly battle: BattleState) {
    const mode = modeOf(k.content, battle.mode)
    if (!mode) throw new Error(`沒有 ${battle.mode} 這個戰場`)
    this.mode = mode
    this.n = mode.numbers
  }

  // ---- 查詢 ----

  get over(): boolean {
    return !!this.battle.result
  }

  unit(id: string): BattleUnit {
    const u = this.battle.units[id]
    if (!u) throw new Error(`這場戰鬥沒有 ${id} 這個單位`)
    return u
  }

  current(): BattleUnit | undefined {
    return currentUnit(this.battle)
  }

  /** 這一方現在叫得到的候補（BattleView.bench）：每個來源合起來，去重，已經在這一場裡的不列。 */
  bench(side: BattleSide): BenchEntry[] {
    return this.k.battle.benchOf(this.state, this.battle, side)
  }

  statusRule(id: string): BattleStatusRule {
    const r = statusRuleOf(this.k.content, id)
    if (!r) throw new Error(`沒有 ${id} 這個狀態`)
    return r
  }

  // ---- 骰子：從（存檔的種子、游標、戰鬥 id、第幾次）導出；同一個狀態、同一串行動，骰面一定一樣 ----

  private rng() {
    return deriveRng(this.state.rng, `battle/${this.battle.id}/${this.battle.rolls++}`)
  }

  roll(count: number, sides: number): number[] {
    const r = this.rng()
    return Array.from({ length: Math.max(0, count) }, () => r.int(1, sides))
  }

  d20(): number {
    return this.roll(1, 20)[0]!
  }

  d6(count: number): number {
    return this.roll(count, 6).reduce((a, b) => a + b, 0)
  }

  /** 0～1 的亂數（AI 的加權抽選、擲部位） */
  rand(): number {
    return this.rng().next()
  }

  /** 加權抽一個；權重都不是正的回傳 undefined。 */
  pick<T>(items: readonly T[], weight: (item: T) => number): T | undefined {
    const ws = items.map((x) => Math.max(0, weight(x)))
    const total = ws.reduce((a, b) => a + b, 0)
    if (total <= 0) return undefined
    let r = this.rand() * total
    for (let i = 0; i < items.length; i++) {
      r -= ws[i]!
      if (r < 0) return items[i]
    }
    return items[items.length - 1]
  }

  // ---- 紀錄 ----

  /** 記一拍。tag 是事件（BATTLE_EVENTS），data 是事件的數字與對象。 */
  say(text: string, tag?: string, data?: Record<string, unknown>, by?: BattleUnit, roll?: CheckRoll): void {
    this.beats.push({ layer: this.mode.layer, text, ...(by?.actor ? { actor: by.actor } : {}), ...(roll ? { roll } : {}), ...(tag ? { tag } : {}), ...(data ? { data } : {}) })
  }

  // ---- 修正 ----

  /** 一個數字的所有加減：狀態、餘韻、重傷，加上功能註冊的修正（技能、義體、特質）。base：這個數字在修正之前是多少（只有 action_ap 會給）。 */
  mods(kind: ModKind, unit: BattleUnit, other?: BattleUnit, weapon?: BattleWeapon, tags: string[] = [], base?: number): RollPart[] {
    const out: RollPart[] = []
    for (const s of unit.statuses) {
      const rule = statusRuleOf(this.k.content, s.id)
      const v = statusMod(rule, s, kind)
      if (v) out.push({ label: rule?.name ?? s.id, value: v, source: 'status' })
    }
    if (kind === 'hit' || kind === 'evade' || kind === 'save') {
      // 餘韻每一層：現實是全屬性 −2（檢定 −1），內海是檢定 +1（CORE_RULES 4.2 節）
      if (unit.layers > 0 && this.mode.afterglow.roll) out.push({ label: '餘韻', value: unit.layers * this.mode.afterglow.roll, source: 'afterglow' })
    }
    // 重傷：生命值低於一半，所有檢定 −2（CORE_RULES 4.1 節）。迴避是對方檢定的目標值，不是自己的檢定，不扣
    if ((kind === 'hit' || kind === 'save') && isWounded(unit)) out.push({ label: '重傷', value: -2, source: 'condition' })
    out.push(...this.k.battle.modifiers({ kind, view: this, unit, ...(other ? { other } : {}), ...(weapon ? { weapon } : {}), tags, ...(base !== undefined ? { base } : {}) }))
    return out.filter((p) => p.value !== 0)
  }

  /** 帶著「不能換位」的狀態嗎。 */
  cannotMove(u: BattleUnit): boolean {
    return u.statuses.some((s) => statusRuleOf(this.k.content, s.id)?.noMove)
  }

  /**
   * 這個單位現在吃到幾級遮蔽：他站的那一格本身的（煙霧算至少半掩體），加上 cover_level 的修正，夾在 0～2；開著機體的人永遠 0。
   * 加上去的級數只影響「算幾級」（迴避、暴露、AI、條件），不改那一格的遮蔽本身：遮蔽的耐久、被打穿、被拆都只看那一格自己的。
   */
  coverOf(u: BattleUnit): CoverLevel {
    const base = coverOf(this.battle, u)
    if (u.hull || this.askingCover || !onField(u) || this.isStandIn(u)) return base
    this.askingCover = true
    let bonus = 0
    try {
      bonus = sum(this.mods('cover_level', u))
    } finally {
      this.askingCover = false
    }
    return clamp(base + bonus, 0, 2) as CoverLevel
  }

  /** 站在暴露的格子上：有效遮蔽是 0。 */
  isExposed(u: BattleUnit): boolean {
    return onField(u) && this.coverOf(u) === 0
  }

  /** 攻擊的人不吃黑暗：有夜視的標籤，或 see_dark 的修正大於 0（other 是他的目標）。 */
  seesDark(by: BattleUnit, other?: BattleUnit): boolean {
    return by.tags.includes('night_vision') || sum(this.mods('see_dark', by, other)) > 0
  }

  /** 迴避 = 基礎（單位身上算好的）＋ 那一格的遮蔽 ＋ 黑暗 ＋ 修正。by 是攻擊的人（有夜視或 see_dark 的不算黑暗）。 */
  evadeOf(target: BattleUnit, by?: BattleUnit, o: { coverShift?: number; extra?: number } = {}): { total: number; parts: RollPart[]; cover: number } {
    const level = clamp(this.coverOf(target) - (o.coverShift ?? 0), 0, 2)
    const cover = this.n.coverBonus[level] ?? 0
    const parts: RollPart[] = [{ label: '迴避', value: target.evade, source: 'base' }]
    if (cover) parts.push({ label: this.mode.coverNames[level]!, value: cover, source: 'cover' })
    if (this.battle.field.dark && !(by && this.seesDark(by, target))) parts.push({ label: '黑暗', value: this.n.darkEvade, source: 'field' })
    if (o.extra) parts.push({ label: '掩護', value: o.extra, source: 'skill' })
    parts.push(...this.mods('evade', target, by))
    return { total: sum(parts), parts, cover }
  }

  /** 命中的所有加值（不含骰面）。 */
  hitParts(attacker: BattleUnit, target: BattleUnit, w: BattleWeapon, o: AttackOpts = {}): RollPart[] {
    const tags = o.tags ?? []
    const aimed = !!o.aimed || w.traits.includes('aimed')
    return [
      { label: w.name, value: w.hit, source: 'weapon' },
      { label: '距離', value: rangeMod(this.n, attacker, target, w), source: 'range' },
      ...(aimed ? [{ label: '瞄準', value: this.n.aimedHit, source: 'aim' }] : []),
      ...(o.hit ? [{ label: o.label ?? '加值', value: o.hit, source: 'skill' }] : []),
      ...this.mods('hit', attacker, target, w, aimed ? [...tags, 'aimed'] : tags),
      ...this.mods('hit_against', target, attacker, w, tags),
    ].filter((p) => p.value !== 0)
  }

  /** 命中率（%），夾在 5～95：畫面的提示與 AI 的打分用，不擲骰。 */
  hitChance(attacker: BattleUnit, target: BattleUnit, w: BattleWeapon | undefined = wielded(attacker), o: AttackOpts = {}): number {
    if (!w) return 0
    const need = this.evadeOf(target, attacker, { coverShift: o.coverShift, extra: o.evade }).total - sum(this.hitParts(attacker, target, w, o))
    return clamp((21 - need) * 5, 5, 95)
  }

  // ---- 花費 ----

  /** 花行動點與其他的池。不夠就丟錯（核心在行動之前已經檢查過；反應與技能自己花的要先看夠不夠）。 */
  spend(u: BattleUnit, cost: { ap?: number; [pool: string]: number | undefined }): void {
    for (const [key, v] of Object.entries(cost)) {
      if (!v) continue
      const pool = key === 'ap' ? u.ap : u.pools[key]
      if (!pool || pool.now < v) throw new Error(`${u.name} 的${poolName(key)}不夠（要 ${v}）`)
      pool.now -= v
    }
  }

  canAfford(u: BattleUnit, cost: { ap?: number; [pool: string]: number | undefined }): boolean {
    return Object.entries(cost).every(([key, v]) => !v || ((key === 'ap' ? u.ap : u.pools[key])?.now ?? 0) >= v)
  }

  /** 退還行動點（不超過上限）。 */
  refund(u: BattleUnit, ap: number): void {
    u.ap.now = Math.min(u.ap.max, u.ap.now + ap)
  }

  // ---- 攻擊（COMBAT_SYSTEM 第 3～6 節） ----

  /**
   * 一次攻擊：擲命中 → 要害 → 傷害骰 → 遮蔽受損 → 照傷害類型打在生命或感載上 → 重創 → 推拉。
   * 行動點由行動自己（或核心）扣；彈匣在這裡扣（o.spend，預設 1 格）。
   */
  attack(attacker: BattleUnit, target: BattleUnit, o: AttackOpts = {}): AttackResult {
    // 目標是替身（和人重疊的東西自己開火時的攻擊者；反應打回去）：改走 attackOverlay，打的是那一台的耐久（dev/adr/0015 第三節）。
    // 那一台已經被擊落或收走了，這一擊就沒有發生（不會當成打人）
    if (this.isStandIn(target)) {
      const hung = this.battle.overlays.find((x) => x.id === target.ext.overlay)
      return hung ? this.attackOverlay(attacker, hung, o) : { hit: false, crit: false, natural: 0, total: 0, evade: 0, raw: 0, dealt: 0, track: 'none', wound: false, downed: false, aborted: true }
    }
    const w = o.weapon ?? wielded(attacker)
    if (!w) throw new Error(`${attacker.name} 手上沒有武器`)
    const none: AttackResult = { hit: false, crit: false, natural: 0, total: 0, evade: 0, raw: 0, dealt: 0, track: 'none', wound: false, downed: false }
    const spend = o.spend ?? 1
    if (w.mag && spend > 0) w.mag.now = Math.max(0, w.mag.now - spend)
    const opts: AttackOpts = { ...o, tags: [...(o.tags ?? [])] }
    // redirect 第一個設的算數：設過之後，後面的處理函式再寫不會蓋掉它
    let redirect = opts.redirect
    Object.defineProperty(opts, 'redirect', { enumerable: true, configurable: true, get: () => redirect, set: (v: AttackOpts['redirect']) => { if (!redirect && v) redirect = v } })
    // 反應在擲骰之前（掩護射擊、小心後面！）：可以改這一擊的加減，也可能先把攻擊的人打倒
    this.k.battle.emit('attack.before', { run: this, attacker, target, weapon: w, opts })
    if (opts.cancel !== undefined) return this.cancelStrike(attacker, target, w, opts, { ...none, aborted: true })
    // 攻擊的人在反應裡被打下來了（替身是那一台被擊落或收走）：這一擊沒有發生
    if (this.gone(attacker) || target.out || this.over) return { ...none, aborted: true }
    // 改打掛著的東西（擋槍）：照它的迴避與護甲算，原本的目標不受影響；彈匣上面已經扣過了，不再扣。結算之後發 attack.redirected（不發 attack.after）
    const diverted = opts.redirect ? this.battle.overlays.find((x) => x.id === opts.redirect!.overlay && !x.down) : undefined
    if (diverted) {
      const result: AttackResult = { ...this.strikeOverlay(attacker, diverted, { ...opts, redirect: undefined, spend: 0 }), redirected: true }
      this.k.battle.emit('attack.redirected', { run: this, attacker, target, overlay: diverted, weapon: w, opts, result })
      return result
    }

    const aimed = !!opts.aimed || w.traits.includes('aimed')
    const tags = aimed ? [...opts.tags!, 'aimed'] : opts.tags!
    const parts = this.hitParts(attacker, target, w, opts)
    const ev = this.evadeOf(target, attacker, { coverShift: opts.coverShift, extra: opts.evade })
    const natural = opts.natural ?? this.d20()
    const total = natural + sum(parts)
    // 自然 20 一定命中，自然 1 一定失手
    const hit = natural === 20 || (natural !== 1 && total >= ev.total)
    const margin = this.n.critMargin + (opts.critMargin ?? 0) + sum(this.mods('crit_margin', attacker, target, w, tags))
    const crit = hit && (!!opts.autoCrit || total - ev.total >= margin)
    // 重創：自然 20，或瞄準過的射擊打出要害
    let wound = hit && !opts.noWound && (natural === 20 || (crit && aimed))
    // 命中確定、傷害還沒算：處理函式可以擋下這一擊（negate），或把重創改成一般的命中（wound = false）
    const hitOut: { negate?: boolean; wound?: boolean } = {}
    if (hit) {
      this.k.battle.emit('attack.hit', { run: this, attacker, target, weapon: w, opts, roll: { natural, total, evade: ev.total, crit, wound }, out: hitOut })
      if (hitOut.wound === false) wound = false
    }
    const negated = hit && !!hitOut.negate
    if (negated) wound = false
    const baseDice = w.far && distance(attacker, target) > w.far.beyond ? w.far.dice : w.dice
    // 這一擊的傷害類型自己帶的骰數（電磁與熱能的武器少一顆；COMBAT_SYSTEM 第 4 節）：照實際打出去的類型（特殊彈換了類型就照換過的）
    const typeDice = damageTypeOf(this.k.content, opts.type ?? w.type).dice ?? 0
    // 要害多一顆；雜兵不擲部位，重創直接多一顆
    const dice = Math.max(1, baseDice + typeDice + (opts.dice ?? 0) + sum(this.mods('dice', attacker, target, w, tags)) + (crit ? 1 : 0) + (wound && target.rank === 'minion' ? 1 : 0))
    const rolled = this.d6(dice)
    const raw = Math.max(0, rolled + w.flat + (opts.damage ?? 0) + sum(this.mods('damage', attacker, target, w, tags)))

    const roll: CheckRoll = {
      dice: '1d20', natural, parts, total, dc: ev.total, margin: total - ev.total,
      degree: natural === 1 ? 'fumble' : crit ? 'critical' : hit ? 'success' : 'fail',
      verdict: verdictOf(natural === 1 ? 'fumble' : crit ? 'critical' : hit ? 'success' : 'fail', total - ev.total),
      // 這一擊用的是哪個屬性與基本功（武器的；無人機的武器是操作者的操縱）
      attr: w.attr, skill: w.skill,
    }
    const head = `${unitTag(attacker)} 用${w.name}${opts.label ?? (w.traits.includes('melee') ? '攻擊' : '射擊')} ${unitTag(target)}：`
    const ids = { attacker: attacker.id, target: target.id, weapon: w.class }
    let result: AttackResult = { ...none, hit, crit, natural, total, evade: ev.total, raw: hit ? raw : 0, wound }
    if (!hit) {
      const blocked = natural !== 1 && ev.cover > 0 && total >= ev.total - ev.cover
      this.say(`${head}${natural === 1 ? '自然 1，失手。' : blocked ? `被${this.mode.coverWord}擋下。` : '沒打中。'}`, 'miss', { ...ids, natural, blocked }, attacker, roll)
    } else {
      this.say(`${head}${natural === 20 ? '自然 20！' : crit ? '要害！' : '命中。'}`, crit ? 'crit' : 'hit', { ...ids, natural }, attacker, roll)
      if (negated) {
        this.say(`${unitTag(target)} 擋下了這一擊，沒有受到傷害。`, 'damage', { target: target.id, type: opts.type ?? w.type, amount: 0, negated: true }, attacker)
        result = { ...result, negated: true }
      } else {
        const before = !!target.out
        const d = this.damage(target, raw, opts.type ?? w.type, attacker, { pierce: w.pierce + (opts.pierce ?? 0) + sum(this.mods('pierce', attacker, target, w, tags)), ...(opts.armorMult !== undefined ? { armorMult: opts.armorMult } : {}), ...(opts.noSink ? { noSink: true } : {}) })
        result = { ...result, dealt: d.dealt, track: d.track, downed: !before && !!target.out }
        if (wound && target.rank !== 'minion' && !target.out && d.dealt > 0) this.k.battle.emit('wound', { run: this, attacker, target, aimed, ...(opts.part ? { part: opts.part } : {}) })
      }
    }
    // 任何攻擊都會傷到目標那一格的遮蔽，不管有沒有打中人：這一擊的傷害骰 × 武器的遮蔽倍率
    const mult = Math.max(w.coverMult, opts.coverMultMin ?? 0)
    if (!opts.noCoverDamage && mult > 0 && target.slot >= 1) this.hurtCover(target.side, target.slot, rolled * mult, attacker)
    // 推與拉（霰彈把人往後推一格、電擊鞭把人拉近一格）
    if (hit && !target.out && result.dealt > 0) {
      if (w.traits.includes('push')) this.shift(target, +1, attacker)
      else if (w.traits.includes('pull')) this.shift(target, -1, attacker)
    }
    this.k.battle.emit('attack.after', { run: this, attacker, target, weapon: w, opts, result })
    return result
  }

  /**
   * 攻擊一個和人重疊的東西（無人機、砲塔；COMBAT_SYSTEM 9.1 節）：它永遠暴露、不吃那一格的遮蔽，也不傷那一格的遮蔽。
   * 命中對它自己的迴避（黑暗照算）；傷害扣它的護甲（穿甲只抵銷護甲）；耐久歸零就被擊落（overlay.down 掛點：操作者的回灌由功能做）。
   * 沒有要害與重創。彈匣照扣（先扣，之後才發 attack.before）。
   * 發 attack.before（目標是那一台的替身：武器的附帶效果、卡彈、反應都在這裡；不看 opts.redirect，打的就是這一台）與 attack.after（同一個替身）；
   * 沒有發生的（那一台已經被擊落、反應把攻擊的人打倒、被 opts.cancel 取消）回傳 aborted、不發 attack.after。
   */
  attackOverlay(attacker: BattleUnit, o: BattleOverlay, opts: AttackOpts = {}): AttackResult {
    const w = opts.weapon ?? wielded(attacker)
    if (!w) throw new Error(`${attacker.name} 手上沒有武器`)
    const none: AttackResult = { hit: false, crit: false, natural: 0, total: 0, evade: 0, raw: 0, dealt: 0, track: 'none', wound: false, downed: false }
    if (o.down) return { ...none, aborted: true }
    const spend = opts.spend ?? 1
    if (w.mag && spend > 0) w.mag.now = Math.max(0, w.mag.now - spend)
    const o2: AttackOpts = { ...opts, tags: [...(opts.tags ?? [])], spend: 0 }
    const standIn = this.standIn(o)
    this.k.battle.emit('attack.before', { run: this, attacker, target: standIn, weapon: w, opts: o2 })
    if (o2.cancel !== undefined) return this.cancelStrike(attacker, standIn, w, o2, { ...none, aborted: true })
    if (this.gone(attacker) || o.down || this.over) return { ...none, aborted: true }
    const result = this.strikeOverlay(attacker, o, { ...o2, weapon: w })
    if (!result.aborted) this.k.battle.emit('attack.after', { run: this, attacker, target: standIn, weapon: w, opts: o2, result })
    return result
  }

  /** attack.before 的處理函式取消了這一擊（opts.cancel）：把那一句話記成一拍、發 attack.cancel，回傳 aborted 的結果。 */
  private cancelStrike(attacker: BattleUnit, target: BattleUnit, w: BattleWeapon, opts: AttackOpts, none: AttackResult): AttackResult {
    const reason = opts.cancel!
    const hung = this.isStandIn(target)
    this.say(reason, undefined, { attacker: attacker.id, ...(hung ? { overlay: target.id } : { target: target.id }), weapon: w.class, cancelled: true, ...opts.cancelData }, attacker)
    this.k.battle.emit('attack.cancel', { run: this, attacker, target, weapon: w, opts, reason })
    return { ...none, cancelled: reason }
  }

  /** attackOverlay 的本體（不發 attack.before、attack.after；彈匣由呼叫的人先扣：改打的 redirect 也走這裡，已經扣過了）。 */
  private strikeOverlay(attacker: BattleUnit, o: BattleOverlay, opts: AttackOpts = {}): AttackResult {
    const w = opts.weapon ?? wielded(attacker)
    if (!w) throw new Error(`${attacker.name} 手上沒有武器`)
    const none: AttackResult = { hit: false, crit: false, natural: 0, total: 0, evade: 0, raw: 0, dealt: 0, track: 'none', wound: false, downed: false }
    if (o.down) return { ...none, aborted: true }
    const spend = opts.spend ?? 1
    if (w.mag && spend > 0) w.mag.now = Math.max(0, w.mag.now - spend)
    const tags = opts.tags ?? []
    const parts: RollPart[] = [
      { label: w.name, value: w.hit, source: 'weapon' },
      { label: '距離', value: rangeMod(this.n, attacker, o, w), source: 'range' },
      ...(opts.hit ? [{ label: opts.label ?? '加值', value: opts.hit, source: 'skill' }] : []),
      ...this.mods('hit', attacker, undefined, w, tags),
    ].filter((p) => p.value !== 0)
    const dark = this.battle.field.dark && !this.seesDark(attacker) ? this.n.darkEvade : 0
    const evade = o.evade + dark
    const natural = opts.natural ?? this.d20()
    const total = natural + sum(parts)
    const hit = natural === 20 || (natural !== 1 && total >= evade)
    const degree = natural === 1 ? 'fumble' : hit ? 'success' : 'fail'
    const roll: CheckRoll = { dice: '1d20', natural, parts, total, dc: evade, margin: total - evade, degree, verdict: verdictOf(degree, total - evade), attr: w.attr, skill: w.skill }
    const head = `${unitTag(attacker)} 用${w.name}${opts.label ?? (w.traits.includes('melee') ? '攻擊' : '射擊')} ${o.name}：`
    const ids = { attacker: attacker.id, overlay: o.id, weapon: w.class }
    if (!hit) {
      this.say(`${head}${natural === 1 ? '自然 1，失手。' : '沒打中。'}`, 'miss', { ...ids, natural }, attacker, roll)
      return { ...none, natural, total, evade }
    }
    const baseDice = w.far && distance(attacker, o) > w.far.beyond ? w.far.dice : w.dice
    const raw = Math.max(0, this.d6(Math.max(1, baseDice + (damageTypeOf(this.k.content, opts.type ?? w.type).dice ?? 0) + (opts.dice ?? 0))) + w.flat + (opts.damage ?? 0))
    // 照傷害類型算（COMBAT_SYSTEM 第 5 節）：和打人同一份算法；無人機與砲塔是機器；現實沒有橋，感載類的傷害對它無效（內海打得到：overlayHurt）
    const dealt = this.overlayHurt(o, raw, opts.type ?? w.type, attacker, { pierce: w.pierce + (opts.pierce ?? 0), ...(opts.armorMult !== undefined ? { armorMult: opts.armorMult } : {}) })
    this.say(`${head}命中，${o.name}受到 ${dealt} 點傷害。`, 'hit', { ...ids, natural, amount: dealt }, attacker, roll)
    const downed = o.hp.now <= 0
    if (downed) this.dropOverlay(o, attacker)
    return { ...none, hit: true, natural, total, evade, raw, dealt, track: 'hp', downed }
  }

  /**
   * 一筆傷害打在一台和人重疊的東西上的算法（不記拍、不擊落）：護甲（可以乘倍率）、穿甲、類型對機器的倍率、做的人的傷害倍率；扣耐久。回傳實際扣了多少。
   * 感載類（神經、快感）：現實沒有橋，無效（0）；內海（`mode.layer === 'net'`）守衛程式就是程式，打在它的耐久上，護甲照那一種傷害的 `armor` 比例
   * （神經與快感是 0，無視護甲），做的人的倍率用 `dmgMult.load`（dev/adr/0018 N27 與實作補記 M3-core-fix-a）。
   */
  private overlayHurt(o: BattleOverlay, raw: number, typeId: DamageType, by: BattleUnit | undefined, opts: { pierce?: number; armorMult?: number } = {}): number {
    const load = damageTypeOf(this.k.content, typeId).track === 'load'
    if (load && !this.overlayTakesLoad()) return 0
    const armor = opts.armorMult !== undefined ? Math.round(o.armor * opts.armorMult) : o.armor
    const dealt = this.hpDamage(raw, typeId, armor, OVERLAY_TAGS, by, { pierce: opts.pierce ?? 0, ...(load ? { mult: 'load' as const } : {}) })
    o.hp.now = Math.max(0, o.hp.now - dealt)
    return dealt
  }

  /** 感載類的傷害打不打得到掛著的東西：內海打得到（它是程式），現實沒有橋、無效。 */
  private overlayTakesLoad(): boolean {
    return this.mode.layer === 'net'
  }

  /**
   * 一筆直接的傷害打在一台和人重疊的東西上（不擲命中：效果的 damage、爆炸；dev/adr/0015）。算法和 attackOverlay 一樣
   * （照傷害類型扣它的護甲、穿甲抵銷護甲、電磁對機器加倍、做的人的傷害倍率；感載類的傷害在現實對它無效、沒有橋，在內海照 overlayHurt 打在它的耐久上）；
   * 耐久歸零就被擊落（overlay.down 掛點）。
   * 記一拍 damage；那一台已經被擊落回傳 { dealt: 0, downed: false }。回傳實際造成的量與有沒有擊落。
   */
  damageOverlay(o: BattleOverlay, raw: number, typeId: DamageType, by?: BattleUnit, opts: { pierce?: number; armorMult?: number } = {}): { dealt: number; downed: boolean } {
    if (o.down) return { dealt: 0, downed: false }
    const type = damageTypeOf(this.k.content, typeId)
    if (type.track === 'load' && !this.overlayTakesLoad()) {
      this.say(`${o.name}沒有橋，${type.name}傷害對它無效。`, 'damage', { overlay: o.id, type: typeId, amount: 0 }, by)
      return { dealt: 0, downed: false }
    }
    const dealt = this.overlayHurt(o, raw, typeId, by, opts)
    this.say(dealt > 0 ? `${o.name}受到 ${dealt} 點${type.name}傷害。` : `${o.name}的護甲擋下了這一擊。`, 'damage', { overlay: o.id, type: typeId, amount: dealt, left: o.hp.now, ...(by ? { by: by.id } : {}) }, by)
    const downed = o.hp.now <= 0
    if (downed) this.dropOverlay(o, by)
    return { dealt, downed }
  }

  /** 護甲照比例（type.armor 或 1）扣掉之後剩下的傷害；穿甲只抵銷護甲。 */
  private armorAfter(v: number, armor: number, share: number, pierce = 0): number {
    const eff = Math.floor(armor * share)
    return this.n.pierceOverflow ? Math.max(0, v - eff + pierce) : Math.max(0, v - Math.max(0, eff - pierce))
  }

  /**
   * 生命傷害的算法（打人與打和人重疊的東西共用）：照類型扣護甲 → 類型對標籤的倍率 → 攻擊者的位階與難度倍率。
   * o.mult 是讀攻擊者哪一個傷害倍率（沒寫是 hp；內海的感載類傷害打在掛著的東西上讀 load）。
   */
  private hpDamage(raw: number, typeId: DamageType, armor: number, tags: readonly string[], by?: BattleUnit, o: { pierce?: number; mult?: 'hp' | 'load' } = {}): number {
    const type = damageTypeOf(this.k.content, typeId)
    let dm = this.armorAfter(raw, armor, type.armor, o.pierce)
    for (const [tag, mult] of Object.entries(type.vs ?? {})) if (tags.includes(tag)) dm *= mult
    const mult = by ? by.dmgMult[o.mult ?? 'hp'] : 1
    if (by && dm > 0 && mult !== 1) dm = Math.max(1, Math.round(dm * mult))
    return Math.round(dm)
  }

  /**
   * 照傷害類型把一筆傷害打在目標身上（COMBAT_SYSTEM 第 4、5 節）。by 是造成傷害的人（敵人的傷害倍率、仇恨）。
   * 生命：扣護甲（穿甲只抵銷護甲）→ 類型對標籤的倍率 → 位階與難度的倍率 → 有機體的先扣機體、回灌感載。
   * 感載：不看護甲（內海的防護照扣）→ 餘韻的加成 → 敏感度 → 過載；傷害類型帶沉溺的（快感）另外走 gainSink，o.noSink 是呼叫的人說「這一點由我決定」。
   */
  damage(target: BattleUnit, raw: number, typeId: DamageType, by?: BattleUnit, o: { pierce?: number; armorMult?: number; noSink?: boolean } = {}): { dealt: number; track: AttackResult['track'] } {
    if (target.out) return { dealt: 0, track: 'none' }
    const type = damageTypeOf(this.k.content, typeId)
    const armorBase = target.armor + (target.hull?.armor ?? 0) + sum(this.mods('armor', target, by))
    const armor = Math.max(0, o.armorMult !== undefined ? Math.round(armorBase * o.armorMult) : armorBase)
    if (type.track === 'load') {
      if (type.needsBridge && !target.load) {
        this.say(`${unitTag(target)} 沒有橋，${type.name}傷害對他無效。`, 'damage', { target: target.id, type: typeId, amount: 0 })
        return { dealt: 0, track: 'none' }
      }
      let v = this.mode.armorOnLoad ? this.armorAfter(raw, armor, 1, o.pierce) : raw
      if (by) v *= by.dmgMult.load * (1 + (by.layers * this.mode.afterglow.loadDealtPct + sum(this.mods('load_dealt_pct', by, target))) / 100)
      const got = this.addLoad(target, v, by)
      // 傷害類型自己帶的沉溺（快感 +1）：走 gainSink（sink.before 擋得下）；noSink 是呼叫的人的效果自己決定
      if (got > 0 && type.sink && !o.noSink) this.gainSink(target, type.sink, { type: typeId, ...(by ? { by } : {}) })
      return { dealt: got, track: got > 0 ? 'load' : 'none' }
    }
    if (!target.hp) return { dealt: 0, track: 'none' }
    let dm = this.hpDamage(raw, typeId, armor, target.tags, by, o)
    if (dm <= 0) {
      this.say(`${unitTag(target)} 的護甲擋下了這一擊。`, 'damage', { target: target.id, type: typeId, amount: 0 })
      return { dealt: 0, track: 'none' }
    }
    if (by) by.uses.threat = (by.uses.threat ?? 0) + dm
    // 機體（機甲、構裝體）：傷害先打在它上面，一部分回灌成機師的感載；多的才打到本人
    let soaked = 0
    if (target.hull) {
      const hull = target.hull
      soaked = Math.min(hull.hp.now, dm)
      hull.hp.now -= soaked
      dm -= soaked
      this.say(`${unitTag(target)} 的${hull.name}受到 ${soaked} 點傷害（剩 ${hull.hp.now}）。`, 'hull', { target: target.id, amount: soaked, left: hull.hp.now })
      const back = Math.round(soaked * hull.backlash)
      if (back > 0) this.addLoad(target, back, undefined, { exact: true, label: '回灌' })
      if (hull.hp.now <= 0) this.k.battle.emit('hull.break', { run: this, unit: target })
      if (dm <= 0 || target.out) return { dealt: soaked, track: 'hull' }
    }
    const hpBefore = target.hp.now
    target.hp.now = Math.max(0, target.hp.now - dm)
    const at = this.beats.length
    this.say(`${unitTag(target)} 受到 ${dm} 點${type.name}傷害。`, 'damage', { target: target.id, type: typeId, amount: dm, left: target.hp.now, ...(by ? { by: by.id } : {}) }, by)
    // 生命歸零：先問有沒有人擋下（out.before）；擋下的生命拉回 1，這一拍記的剩餘生命跟著改
    const zero = target.hp.now <= 0
    const prevented = zero && this.outPrevented(target, 'down', by)
    if (prevented && this.beats[at]?.data) this.beats[at]!.data!.left = target.hp.now
    if (zero && !prevented) this.leave(target, 'down', by)
    else for (const s of type.onHit ?? []) if (statusRuleOf(this.k.content, s.status)) this.applyStatus(target, s.status, { ...(by ? { by } : {}), turns: s.turns })
    // 被擋下（out.before）而生命拉回 1 的：實際扣掉的只有扣到 1 為止的那一段
    return { dealt: (prevented ? hpBefore - target.hp.now : dm) + soaked, track: 'hp' }
  }

  /**
   * 加感載（CORE_RULES 4.2 節）：受到的感載 = 原始值 ×（0.75 ＋ 敏感度 ÷ 200）；到達上限就過載。
   * exact：不乘敏感度（回灌、重創寫死的 +10）。回傳實際加了多少。
   */
  addLoad(target: BattleUnit, raw: number, by?: BattleUnit, o: { exact?: boolean; label?: string } = {}): number {
    if (!target.load || target.out) return 0
    const taken = o.exact ? raw : raw * (0.75 + target.sensitivity / 200) * Math.max(0, 1 + sum(this.mods('load_taken_pct', target, by)) / 100)
    const v = Math.max(0, Math.round(taken))
    if (!v) return 0
    target.load.now += v
    if (by) by.uses.threat = (by.uses.threat ?? 0) + v
    this.say(`${unitTag(target)}${o.label ? `（${o.label}）` : ''}感載 +${v}。`, 'load', { target: target.id, amount: v, now: Math.min(target.load.now, target.load.max), ...(by ? { by: by.id } : {}) }, by)
    if (target.load.now >= target.load.max) this.overload(target, by)
    return v
  }

  /**
   * 加沉溺（傷害類型自己帶的快感 +1、快感的感載效果）：先發 sink.before，處理函式設 out.block 就不加（定力擋、免疫沉溺的人）。
   * 不記拍（沉溺是慢慢累積的，由呼叫的人決定要不要說）。回傳實際加了多少。對沒有 hp 與 load 的替身、已經退出的人沒有作用。
   */
  gainSink(unit: BattleUnit, amount: number, o: { type?: DamageType; by?: BattleUnit } = {}): number {
    const v = Math.max(0, Math.round(amount))
    if (!v || unit.out || this.isStandIn(unit)) return 0
    const out: { block?: boolean } = {}
    this.k.battle.emit('sink.before', { run: this, unit, amount: v, ...(o.type ? { type: o.type } : {}), ...(o.by ? { by: o.by } : {}), out })
    if (out.block) return 0
    unit.sink += v
    return v
  }

  /**
   * 過載：感載歸零（多的不留）、疊一層餘韻；已經疊滿就倒下。沒倒下的照戰場的規則失去下一個回合（現實）或閃斷（內海）。
   * 閃斷（N3；dev/adr/0018）：flashPool 那一池歸零，給狀態 flash（到他下一個自己的回合結束前，RAM 不回復）；
   * 在別人的回合被灌到過載的，flash 到他的下一個回合結束；在自己的回合裡（回合開始的結算、自己的行動、反應）過載的，到這個回合結束。
   * overload 掛點帶 flash: { pool, before }（歸零的是哪一池、歸零之前有多少）：處理函式可以把池補回去（補的留著）、改 flash 的時間或拿掉它。
   */
  overload(target: BattleUnit, by?: BattleUnit): void {
    if (!target.load || target.out) return
    target.load.now = 0
    // 「到下次過載」的狀態（紙鶴的標記）：過載一發生就結束，不管接下來是失去回合還是昏過去
    for (const st of [...target.statuses]) if (st.until.at === 'overload') this.removeStatus(target, st.id)
    if (afterglowFull(target)) {
      // 即將昏過去：有人擋下（out.before）就到此為止，感載已經歸零，其餘由處理函式自己改
      if (this.outPrevented(target, 'burnout', by)) return
      this.say(`${unitTag(target)} 餘韻疊滿之後再過載：昏了過去。`, 'overload', { target: target.id, layers: target.layers, down: true }, by)
      this.leave(target, 'burnout', by)
      return
    }
    target.layers += 1
    let flash: { pool: string; before: number } | undefined
    if (this.mode.overload === 'lose_turn') {
      this.say(`${unitTag(target)} 過載！失去下一個回合，餘韻 ${target.layers} 層。`, 'overload', { target: target.id, layers: target.layers }, by)
      this.applyStatus(target, LOSE_TURN, { force: true, ...(by ? { by } : {}) })
    } else {
      const poolId = this.mode.flashPool
      const pool = poolId ? target.pools[poolId] : undefined
      if (poolId) flash = { pool: poolId, before: pool?.now ?? 0 }
      if (pool) pool.now = 0
      this.say(`${unitTag(target)} 過載！閃斷，餘韻 ${target.layers} 層。`, 'overload', { target: target.id, layers: target.layers, flash: true }, by)
      // 閃斷的狀態：自己給自己的 own_turn_end 照一般的規矩會從下一個回合才開始數；閃斷不是，在自己的回合裡過載的就到這個回合結束
      if (this.applyStatus(target, FLASH, { quiet: true, ...(by ? { by } : {}) })) {
        const st = target.statuses.find((x) => x.id === FLASH)
        if (st && st.until.at === 'turn_end') delete st.until.skip
      }
    }
    this.k.battle.emit('overload', { run: this, unit: target, ...(by ? { by } : {}), ...(flash ? { flash } : {}) })
  }

  /**
   * 回生命值（不超過上限）。回傳實際回了多少。by 是做的人：帶了才吃他的 heal_dealt 修正（多回幾點；tags 是這次回復的標籤：
   * 道具是 ['item', …物品的標籤]）；不帶（狀態每回合的回復）不吃。
   */
  heal(target: BattleUnit, amount: number, by?: BattleUnit, tags: string[] = []): number {
    if (!target.hp || target.out) return 0
    let want = Math.round(amount)
    if (by && want > 0) want += sum(this.mods('heal_dealt', by, target, undefined, tags))
    const v = Math.max(0, Math.min(want, target.hp.max - target.hp.now))
    target.hp.now += v
    if (v) this.say(`${unitTag(target)} 生命 +${v}。`, 'heal', { target: target.id, amount: v, ...(by ? { by: by.id } : {}) }, by)
    return v
  }

  /** 排感載（不低於 0）。by 與 tags 同 heal，吃 vent_dealt 修正。 */
  vent(target: BattleUnit, amount: number, by?: BattleUnit, tags: string[] = []): number {
    if (!target.load || target.out) return 0
    let want = Math.round(amount)
    if (by && want > 0) want += sum(this.mods('vent_dealt', by, target, undefined, tags))
    const v = Math.max(0, Math.min(want, target.load.now))
    target.load.now -= v
    if (v) this.say(`${unitTag(target)} 感載 −${v}。`, 'load', { target: target.id, amount: -v, now: target.load.now, ...(by ? { by: by.id } : {}) }, by)
    return v
  }

  /**
   * 一次豁免或戰鬥裡的檢定：1d20 ＋ mod(屬性) ＋ 基本功 ＋ 修正 對 DC。自然 20 一定過、自然 1 一定不過。
   * tags 是這個檢定的標籤（subdue、resist:suppressed、morale、flee、hack……），修正（save）讀得到：只對某一類檢定加值的修正不會影響別的。
   * other 是「對誰擲的」（u 擲骰；other 是拿 DC 的那一方：被快駭、被誘惑的人，或是豁免裡下手的人）：帶了就在擲之前發 check.before 掛點
   * （unit 是 u、other 是 other；other 那一邊的反應在那裡改這一次的 DC 與加值，dev/adr/0015 補記）。
   */
  save(u: BattleUnit, attr: AttrId, skill: SkillId | undefined, dc: number, label: string, extra: RollPart[] = [], tags: string[] = [], other?: BattleUnit): { ok: boolean; roll: CheckRoll } {
    const opts = { dc, bonus: 0 }
    if (other) this.k.battle.emit('check.before', { run: this, unit: u, other, tags, opts })
    // 這個戰場裡屬性由別的代替的（內海：體格由意志代替；CYBERSPACE 4.1 節）照換過的算；檢定記下的也是實際用的那一個
    attr = battleAttr(this.mode, attr)
    const parts: RollPart[] = [
      { label: this.k.stats.attrName(attr), value: attrMod(u.attrs[attr] ?? 10), source: 'attr' },
      ...(skill ? [{ label: this.k.stats.skillName(skill), value: u.skills[skill] ?? 0, source: 'skill' }] : []),
      ...this.mods('save', u, other, undefined, tags), ...extra,
      ...(opts.bonus ? [{ label: '反應', value: opts.bonus, source: 'reaction' }] : []),
    ].filter((p) => p.value !== 0)
    const natural = this.d20()
    const total = natural + sum(parts)
    const degree = computeDegree(natural, total, opts.dc)
    const roll: CheckRoll = { dice: '1d20', natural, parts, total, dc: opts.dc, degree, verdict: verdictOf(degree, total - opts.dc), margin: total - opts.dc, attr, ...(skill ? { skill } : {}) }
    const ok = degree === 'critical' || degree === 'success'
    this.say(`${unitTag(u)} ${label}：${total} 對 ${opts.dc}，${ok ? '過了' : '沒過'}。`, undefined, { unit: u.id, ok }, u, roll)
    return { ok, roll }
  }

  // ---- 狀態 ----

  /**
   * 對 holder 給的 own_turn_end（到他的回合結束）要不要略過「現在這個回合的結束」：他自己的回合正在進行（battle.acting）、而且是他自己給自己的。
   * 是的話，計時從他下一個回合的結束才開始數（「到你下一回合結束前」給自己用時，不會在同一個回合就少掉一次）。
   * 別人給的（沒有 by 的也算別人）、不在他的回合裡給的、source_turn_end 與 own_turn_start 都不用它。功能自己另外算計時的東西（buff、守著）問這個。
   */
  skipsOwnTurnEnd(holder: BattleUnit, by?: BattleUnit): boolean {
    return this.battle.acting === holder.id && by?.id === holder.id && this.current()?.id === holder.id
  }

  /** 給一個狀態。同一個狀態再得一次只重算時間，不疊加。首領有控制保護（ENEMIES 4.5 節）。回傳有沒有給上去。 */
  applyStatus(target: BattleUnit, id: string, o: StatusOpts = {}): boolean {
    if (target.out || this.isStandIn(target)) return false
    const rule = this.statusRule(id)
    let turns = o.turns ?? rule.turns
    if (rule.kind === 'control' && !o.force && target.rank === 'boss') {
      // 控制效果在首領身上最多 1 回合，之後免疫控制 1 回合
      if ((target.uses.control_immune ?? 0) >= this.battle.round) {
        this.say(`${unitTag(target)} 剛被控制過，這一次沒有用。`, 'status', { target: target.id, status: id, blocked: true })
        return false
      }
      turns = 1
      target.uses.control_immune = this.battle.round + 1
    }
    const kind = o.until ?? rule.until
    const of = kind.startsWith('source') ? (o.by?.id ?? target.id) : target.id
    // 他在自己的回合裡給自己的 own_turn_end：這個回合的結束不算（到他「下一個」回合結束），所以標 skip
    const until: BattleUntil = kind === 'battle_end' ? { at: 'battle_end' } : kind === 'next_overload' ? { at: 'overload' }
      : { at: kind.endsWith('start') ? 'turn_start' : 'turn_end', of, turns, ...(kind === 'own_turn_end' && this.skipsOwnTurnEnd(target, o.by) ? { skip: true as const } : {}) }
    const status: BattleStatus = { id, until, ...(o.by ? { by: o.by.id } : {}), ...(o.data ? { data: { ...o.data } } : {}) }
    target.statuses = [...target.statuses.filter((s) => s.id !== id), status]
    if (id !== LOSE_TURN && !o.quiet) this.say(`${unitTag(target)}：${rule.name}。`, 'status', { target: target.id, status: id, ...(o.by ? { by: o.by.id } : {}) }, o.by)
    return true
  }

  removeStatus(target: BattleUnit, id: string, quiet = false): boolean {
    if (!target.statuses.some((s) => s.id === id)) return false
    target.statuses = target.statuses.filter((s) => s.id !== id)
    if (!quiet && id !== LOSE_TURN) this.say(`${unitTag(target)} 的${statusRuleOf(this.k.content, id)?.name ?? id}結束了。`, 'status.end', { target: target.id, status: id })
    return true
  }

  /** 解掉可以被 by 解的狀態（急救止血：first_aid）。回傳解掉了哪幾個。 */
  cleanse(target: BattleUnit, by: string): string[] {
    const gone = target.statuses.filter((s) => statusRuleOf(this.k.content, s.id)?.cleansedBy?.includes(by)).map((s) => s.id)
    for (const id of gone) this.removeStatus(target, id)
    return gone
  }

  // ---- 義體（dev/adr/0015 第三節） ----

  /**
   * 讓目標的一件義體失效（off）或超頻（boost）：挑一件（opts.pick 指定第幾件 → opts.kind 指定哪一種 → 第一件還沒帶這個狀態的），
   * 給單位狀態 off_<種類> 或 boost_<種類>（規則表沒有的退回 off_generic、boost_generic）；每一種義體差多少是規則表的資料，核心不寫數字。
   * 回傳挑到的那一件（就是 target.implants 裡的那個物件）；沒有可挑的（沒有義體、指定的那一件或那一種沒有、每一件都已經帶著這個狀態、
   * 目標已經退出）回傳 null，不記拍。「還沒帶這個狀態」看的是狀態 id：同一種的兩件、或都退回 _generic 的兩件，共用同一個狀態，
   * 第二次就沒有可挑的（要換掉第一件的時間，用 pick 指定）。狀態查不到（連 _generic 都沒有）丟錯，訊息寫出要哪一個狀態 id。記一拍 status。
   */
  implantStatus(target: BattleUnit, mode: 'off' | 'boost', opts: ImplantStatusOpts = {}): BattleImplant | null {
    const list = target.implants ?? []
    if (!list.length || target.out) return null
    const statusOf = (i: BattleImplant): string => {
      const own = `${mode}_${i.kind}`
      const generic = `${mode}_generic`
      if (statusRuleOf(this.k.content, own)) return own
      if (statusRuleOf(this.k.content, generic)) return generic
      throw new Error(`義體「${i.name}」要 ${own} 這個狀態（規則表沒有的退回 ${generic}），兩個都查不到：先在規則表（battle_status）補上`)
    }
    let chosen: BattleImplant | undefined
    if (opts.pick !== undefined) chosen = Number.isInteger(opts.pick) ? list[opts.pick] : undefined
    else if (opts.kind !== undefined) chosen = list.find((i) => i.kind === opts.kind)
    else chosen = list.find((i) => !target.statuses.some((st) => st.id === statusOf(i)))
    if (!chosen) return null
    const id = statusOf(chosen)
    const given = this.applyStatus(target, id, { ...(opts.by ? { by: opts.by } : {}), ...(opts.turns !== undefined ? { turns: opts.turns } : {}), ...(opts.until ? { until: opts.until } : {}), quiet: true })
    if (!given) return null
    const word = mode === 'off' ? '失效了' : '超頻了'
    this.say(`${unitTag(target)} 的${chosen.name}${word}。`, 'status', { target: target.id, status: id, implant: chosen.kind, mode, ...(opts.by ? { by: opts.by.id } : {}) }, opts.by)
    return chosen
  }

  // ---- 倒下、退出與結果 ----

  /**
   * 這個人退出戰鬥。how：down（生命歸零倒下）、burnout（餘韻疊滿再過載，昏過去）、subdued（被制伏）、
   * surrendered（投降）、fled（逃走）、removed（被帶走）；內海另有 jacked_out（拔線）與 pinned（被釘住，登不出去；紀錄標籤 pin）。
   * 戰鬥中沒有人會死（COMBAT_SYSTEM 8.2 節）。
   * 先問 out.before 掛點有沒有人擋下：擋下的回傳 false、什麼都不做（生命歸零而來的，生命至少 1；其餘由處理函式自己改）。
   * 回傳這一次有沒有讓他退出（已經退出的也回傳 false）。
   */
  setOut(u: BattleUnit, how: string, by?: BattleUnit): boolean {
    if (u.out || this.isStandIn(u)) return false
    if (this.outPrevented(u, how, by)) return false
    this.leave(u, how, by)
    return true
  }

  /** 即將退出：問 out.before 有沒有人擋下。擋下回傳 true；因為生命歸零而來的（how 是 down），生命拉回至少 1。 */
  private outPrevented(u: BattleUnit, how: string, by?: BattleUnit): boolean {
    const out: { prevent?: boolean } = {}
    this.k.battle.emit('out.before', { run: this, unit: u, how, ...(by ? { by } : {}), out })
    if (!out.prevent) return false
    if (how === 'down' && u.hp && u.hp.now < 1) u.hp.now = 1
    return true
  }

  /** 退出的後半（沒有人擋下之後）：記下 out、停機、發 out 掛點、補位、看結果。 */
  private leave(u: BattleUnit, how: string, by?: BattleUnit): void {
    if (u.out) return
    u.out = how
    delete u.watch
    // 叫來還沒進場的人在後方就退出了（被帶走）：不再等著進場，也不留在後方排隊
    if (this.battle.called?.includes(u.id)) {
      this.battle.called = this.battle.called.filter((id) => id !== u.id)
      if (!this.battle.called.length) delete this.battle.called
      this.battle.reserve[u.side] = this.battle.reserve[u.side].filter((id) => id !== u.id)
    }
    u.statuses = u.statuses.filter((s) => s.id !== LOSE_TURN)
    const words: Record<string, string> = { down: u.side === 'foe' ? '被打倒了' : '倒下了', burnout: '昏了過去', subdued: '被制伏，退出戰鬥', surrendered: '投降了', fled: '逃走了', removed: '被帶走了', jacked_out: '拔線離開了', pinned: '被釘住了，退出戰鬥，登不出去' }
    const tag = how === 'subdued' ? 'subdue' : how === 'surrendered' ? 'surrender' : how === 'fled' ? 'flee' : how === 'jacked_out' ? 'jack_out' : how === 'pinned' ? 'pin' : 'down'
    if (how !== 'burnout') this.say(`${unitTag(u)} ${words[how] ?? '退出了戰鬥'}。`, tag, { target: u.id, how, rank: u.rank, side: u.side, ...(by ? { by: by.id } : {}) }, by)
    else this.say(`${unitTag(u)} 倒下了。`, 'down', { target: u.id, how, rank: u.rank, side: u.side, ...(by ? { by: by.id } : {}) }, by)
    // 操作者退出（COMBAT_SYSTEM 9.1 節；dev/adr/0015 第三節）：他的東西，autonomous 的沒有操作者、自己動（自律）；其餘的停機
    for (const o of this.battle.overlays) {
      if (o.owner !== u.id || o.down) continue
      if (o.autonomous) this.orphan(o)
      else this.dropOverlay(o, undefined, true)
    }
    // 他再也沒有回合了：給別人的、「到他的回合開始／結束」的狀態沒有人會數，現在結束（和監視、守著一樣；W012）
    for (const holder of Object.values(this.battle.units)) {
      if (holder === u) continue
      // 已經退出的人身上的不再記拍（沒有人看得到）
      for (const st of [...holder.statuses]) if ((st.until.at === 'turn_start' || st.until.at === 'turn_end') && st.until.of === u.id) this.removeStatus(holder, st.id, !!holder.out)
    }
    this.k.battle.emit('out', { run: this, unit: u, how, ...(by ? { by } : {}) })
    this.compact(u.side)
    this.checkResult()
  }

  /**
   * 把因為生命歸零倒下的人救回來（out 是 down 的才收；burnout、subdued 與還在場上的回傳 false）。
   * 回到場上：有空格放最後面的空格（和增援同一條，dev/adr/0013 C6），沒有空格就排進後方的最前面；
   * 生命是給的數字（最少 1、不超過上限），行動點 0，狀態與姿態清空，先攻的順位不變。戰鬥已經分出結果之後不能救。
   * 最後發 revive 掛點：功能記在他身上的限時的東西（buff、持續型快駭）在那裡清（dev/adr/0015 補記 M1b-review-core）。
   */
  revive(u: BattleUnit, hp: number): boolean {
    if (this.over || u.out !== 'down' || !u.hp) return false
    const b = this.battle
    delete u.out
    u.slot = 0
    u.hp.now = clamp(Number.isFinite(hp) ? Math.round(hp) : 1, 1, u.hp.max)
    u.ap.now = 0
    u.statuses = []
    delete u.stance
    // 最後面的空格（被斷路的格子跳過：補位進不去）
    const slot = this.lastFreeSlot(u.side)
    if (slot) u.slot = slot
    else b.reserve[u.side].unshift(u.id)
    this.say(`${unitTag(u)} 重新站了起來（生命 ${u.hp.now}）${slot ? `，回到第 ${slot} 格` : '，在後方等著補上來'}。`, 'revive', { unit: u.id, hp: u.hp.now, slot, side: u.side }, u)
    if (slot) {
      this.exposed(u)
      this.compact(u.side)
    }
    // 功能自己記在他身上的限時的東西（buff、持續型快駭）也屬於「狀態清空」：由功能在這個掛點清
    this.k.battle.emit('revive', { run: this, unit: u })
    return true
  }

  /**
   * 叫一個人來增援（dev/adr/0016 第五節；dev/adr/0013 C6）：照開戰時同一條路把 ref 解成單位（來源查不到丟錯；沒有空格時不解，直接回傳 null），排進這一方後方的最前面，
   * 記一拍 call_in；**下一輪開頭**（round.start 之前）補進最後面的空格：先攻當場擲（照一般的補位）、行動點從上限開始、照先攻排進順序，
   * 那一輪他就輪得到。回傳這個單位（還在後方：slot 是 0、不在先攻的順序裡；id 是新發的 a5、f5……）。
   * 這一方現在沒有空格（站在場上的加上後方等著的〔含已經叫了還沒進場的〕，已經有四個）：回傳 null，什麼都不動。
   * 到下一輪開頭時空格被別人佔了（倒下的人被救回來）：他留在後方，照平常的補位等（有人倒下才進場）。
   * 叫來的人在叫來的那一刻發一次 unit.ready（功能把自己的資料掛上去）。戰鬥已經分出結果之後回傳 null。
   * 叫得動誰（候補名單、叫了幾次、花什麼）由呼叫的功能先查：這裡不看 view.bench 的 blocks。
   */
  callIn(side: BattleSide, ref: UnitRef, opts: CallInOpts = {}): BattleUnit | null {
    const b = this.battle
    if (this.over) return null
    // 空格 = 四格 − 站在場上的 − 在後方等著補上來的（含叫了還沒進場的：他們已經佔了一個空格）
    if (unitsOf(b, side).length + b.reserve[side].length >= BATTLE_SLOTS) return null
    // 有空格才解（解的時候不改任何狀態；來源查不到丟錯，狀態還是沒有動）
    const ctx: UnitSourceCtx = { k: this.k, state: this.state, side, mode: b.mode, grade: b.grade, allyCount: b.origin.headcount?.ally ?? Object.values(b.units).filter((x) => x.side === 'ally').length }
    const init = resolveUnit(this.k, this.state, ref, ctx, this.mode)
    let n = Object.values(b.units).filter((x) => x.side === side).length + 1
    const prefix = side === 'ally' ? 'a' : 'f'
    while (b.units[`${prefix}${n}`]) n += 1
    const u = buildUnit(init, ref, `${prefix}${n}`, side, 0)
    // 剛上場的人行動點從上限開始（C6）；功能在 unit.ready 裡可以再改
    u.ap.now = u.ap.max
    b.units[u.id] = u
    b.reserve[side].unshift(u.id)
    b.called = [...(b.called ?? []), u.id]
    // 功能把自己的資料掛上去；那一邊記的拍子（和開打時一樣）不進紀錄
    const mark = this.beats.length
    this.k.battle.emit('unit.ready', { run: this, unit: u })
    this.beats.length = mark
    this.say(opts.text ?? `${unitTag(u)} 被叫來支援，下一輪開頭進場。`, 'call_in', { unit: u.id, side, ...(opts.by ? { by: opts.by.id } : {}) }, opts.by)
    return u
  }

  /**
   * 叫來還沒進場的人（run.callIn）在一輪的開頭補進場（startRound 在 round.start 之前呼叫）：照叫的順序，各補進最後面的空格；
   * 那一輪他就輪得到（開頭的時候誰都還沒動）。沒有空格的（被別人佔了）留在後方，不再算「叫來的」，之後照平常的補位。
   */
  admitCalled(): void {
    const b = this.battle
    const list = b.called
    if (!list) return
    delete b.called
    for (const id of list) {
      const u = b.units[id]
      if (!u || u.out || u.slot >= 1 || this.over) continue
      const slot = this.lastFreeSlot(u.side)
      if (!slot) continue
      const queue = b.reserve[u.side]
      const at = queue.indexOf(id)
      if (at >= 0) queue.splice(at, 1)
      this.enter(u, slot, true)
    }
  }

  // ---- 和人重疊的東西（COMBAT_SYSTEM 第 9 節；dev/adr/0015 第三節） ----

  /**
   * 掛上一台和人重疊的東西（無人機、砲塔、立牌、內海的守衛程式）：發 id、查那一格有沒有別台、有操作者時問他的修正。
   * 那一格已經掛著一台沒被擊落的丟 BattleBlocked（狀態不變）。有 owner 時耐久（現在與上限）、護甲、迴避各加他的修正
   * overlay_hp、overlay_armor、overlay_evade（標籤是 [種類]）；沒有操作者的照給的數字，不問。
   * 記一拍 overlay；text 可以換掉那一句（沒寫：有操作者是「某某 放出…，掛在第 N 格。」，沒有是「…掛在我方第 N 格。」）。回傳掛上去的那一台。
   * 連得住幾台（overlay_cap）由放它的功能先查；這裡只管每格一台。
   */
  addOverlay(init: BattleOverlayInit, o: { text?: string } = {}): BattleOverlay {
    const b = this.battle
    if (!Number.isInteger(init.slot) || init.slot < 1 || init.slot > BATTLE_SLOTS) throw new Error(`${init.name} 要掛在第 1～${BATTLE_SLOTS} 格，不是 ${String(init.slot)}`)
    if (overlayAt(b, init.side, init.slot)) throw new BattleBlocked(['這一格已經掛著一台了。'])
    const owner = init.owner !== undefined ? this.unit(init.owner) : undefined
    const tags = [init.kind]
    const plus = (kind: 'overlay_hp' | 'overlay_armor' | 'overlay_evade'): number => (owner ? sum(this.mods(kind, owner, undefined, undefined, tags)) : 0)
    const hp = plus('overlay_hp')
    const max = Math.max(1, init.hp.max + hp)
    const overlay: BattleOverlay = {
      ...init, id: `o${(b.seq += 1)}`,
      hp: { now: clamp(init.hp.now + hp, 1, max), max }, armor: Math.max(0, init.armor + plus('overlay_armor')), evade: init.evade + plus('overlay_evade'),
      ...(init.weapon ? { weapon: clone(init.weapon) } : {}), ...(init.ext ? { ext: clone(init.ext) } : {}),
      used: false, down: false,
    }
    if (overlay.owner === undefined) delete overlay.owner
    b.overlays.push(overlay)
    const text = o.text ?? (owner ? `${owner.name} 放出${overlay.name}，掛在第 ${overlay.slot} 格。` : `${overlay.name}掛在${SIDE_NAME[overlay.side]}第 ${overlay.slot} 格。`)
    this.say(text, 'overlay', { overlay: overlay.id, kind: overlay.kind, slot: overlay.slot }, owner)
    return overlay
  }

  /** 和人重疊的東西被擊落或停機。 */
  dropOverlay(o: BattleOverlay, by?: BattleUnit, quiet = false): void {
    if (o.down) return
    o.down = true
    this.say(quiet ? `${o.name}停機了。` : `${o.name}被擊落了。`, 'overlay.down', { overlay: o.id, kind: o.kind, ...(o.owner ? { owner: o.owner } : {}), ...(by ? { by: by.id } : {}) }, by)
    if (!quiet) this.k.battle.emit('overlay.down', { run: this, overlay: o, ...(by ? { by } : {}) })
  }

  /** 操作者退出之後自律（autonomous 的那一台）：沒有操作者、每一輪自己動（auto）、ext.orphan。不發 overlay.down、不停機。 */
  private orphan(o: BattleOverlay): void {
    delete o.owner
    o.auto = true
    o.ext = { ...o.ext, orphan: true }
    this.say(`${o.name}失去了操作者，進入自律模式。`, 'overlay', { overlay: o.id, kind: o.kind, slot: o.slot, orphan: true })
  }

  /**
   * 替身：和人重疊的東西自己開火時的攻擊者，由核心臨時組出來，不在 battle.units 裡、不寫進戰鬥狀態。
   * 名字、哪一方、哪一格、迴避、護甲照那一台；武器是它自己的；傷害倍率照 ext.dmgMult（{ hp, load }，或一個數字當生命的倍率；沒寫都是 1）；
   * 標籤 machine、overlay；ext.overlay 是那一台的 id。沒有 hp 與 load（對它做回復、感載、傷害都沒有效果），
   * 狀態給不上去（applyStatus 回傳 false）、推拉不動（shift、place 回傳 false）。凡是拿到 attacker 的掛點都可能拿到替身：
   * 要對攻擊者做攻擊以外的事的功能先看 ext.overlay（或 run.overlayOfStandIn）。
   */
  standIn(o: BattleOverlay): BattleUnit {
    const m = o.ext?.dmgMult
    const mult = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : 1)
    const dmgMult = typeof m === 'number' ? { hp: mult(m), load: 1 } : isRecord(m) ? { hp: mult(m.hp), load: mult(m.load) } : { hp: 1, load: 1 }
    return {
      id: o.id, side: o.side, slot: o.slot, name: o.name, control: 'ai', grade: this.battle.grade, rank: 'minion',
      attrs: Object.fromEntries(ATTR_IDS.map((id) => [id, 10])) as BattleUnit['attrs'], skills: {},
      armor: o.armor, layers: 0, layersMax: 0, sensitivity: 50, sink: 0,
      ap: { now: 0, max: 0, regen: 0 }, pools: {}, weapons: o.weapon ? [o.weapon] : [], wield: 0,
      evade: o.evade, initBonus: 0, initiative: 0, statuses: [], dmgMult, tags: [...OVERLAY_STAND_IN_TAGS], quick: [], uses: {}, wounds: {},
      ext: { overlay: o.id },
    }
  }

  /** 這個單位是不是替身（核心臨時組的，不在 battle.units 裡）。 */
  isStandIn(u: BattleUnit): boolean {
    return typeof u.ext?.overlay === 'string' && this.battle.units[u.id] !== u
  }

  /** 替身對應的那一台（掛著、還沒被擊落的）；不是替身，或那一台已經被擊落、不見了就是 undefined。 */
  overlayOfStandIn(u: BattleUnit): BattleOverlay | undefined {
    if (!this.isStandIn(u)) return undefined
    return this.battle.overlays.find((x) => x.id === u.ext.overlay && !x.down)
  }

  /**
   * 這個單位已經不能再出手了：人退出了（倒下、制伏、逃走……），或是替身而那一台已經被擊落、收走。
   * 攻擊者在反應裡被打下來之後，「攻擊的人已經退出就停」問的是這個：只看 `u.out` 對替身永遠不成立（替身沒有 out，被擊落的是那一台）。
   * 不在戰鬥裡的單位（後方排隊的）不算退出。
   */
  gone(u: BattleUnit): boolean {
    return !!u.out || (this.isStandIn(u) && !this.overlayOfStandIn(u))
  }

  /**
   * 這一台自己開火：用它自己的武器（opts.weapon 可以換）、傷害乘 ext.dmgMult；攻擊者是替身（standIn），
   * attack.before、attack.after 拿到的 attacker 帶 ext.overlay。其餘和 run.attack 一樣（命中、要害、遮蔽、重創、反應）。
   * 這一台已經被擊落回傳 aborted；沒有武器丟錯。對方的反應用 run.attack 打回去時，打的是這一台的耐久。
   */
  overlayAttack(o: BattleOverlay, target: BattleUnit, opts: AttackOpts = {}): AttackResult {
    const weapon = opts.weapon ?? o.weapon
    if (!weapon) throw new Error(`${o.name} 沒有武器`)
    if (o.down) return { hit: false, crit: false, natural: 0, total: 0, evade: 0, raw: 0, dealt: 0, track: 'none', wound: false, downed: false, aborted: true }
    return this.attack(this.standIn(o), target, { ...opts, weapon })
  }

  /** 一方全部倒下或退出：分出結果。 */
  checkResult(): void {
    if (this.battle.result) return
    if (standing(this.battle, 'ally') === 0) {
      // 個人的脫離（N12）：我方每一個人都是用 mode.leave.out 退出（內海：全員拔線）才算脫離，待遇照 fled；有一個人不是（倒下、被釘住、被制伏）就是戰敗
      const leave = this.mode.leave
      const mine = Object.values(this.battle.units).filter((u) => u.side === 'ally')
      if (leave && mine.length > 0 && mine.every((u) => u.out === leave.out)) this.finish(leave.outcome, '全隊都平安離開了這場戰鬥。')
      else this.finish('lose', '全隊倒下：戰敗。')
    } else if (standing(this.battle, 'foe') === 0) this.finish('win', '敵人全部倒下或退出：勝利。')
  }

  /** 這場戰鬥分出結果了（勝、敗、脫離、投降，或功能自己的結果）。之後不再有人行動；結束的報告由外殼提交。 */
  finish(outcome: string, text: string): void {
    if (this.battle.result) return
    this.battle.result = { outcome, text }
    for (const u of Object.values(this.battle.units)) delete u.watch
    this.k.battle.emit('battle.result', { run: this, outcome })
    this.say(text, 'battle.end', { outcome })
  }

  // ---- 先攻的順序 ----

  /** 對調兩個人在先攻順序裡的位置；現在輪到的人不變（他還是現在輪到的那一個）。兩個人有一個不在順序裡回傳 false。 */
  swapOrder(a: BattleUnit, b: BattleUnit): boolean {
    const order = this.battle.order
    const i = order.indexOf(a.id)
    const j = order.indexOf(b.id)
    if (a.id === b.id || i < 0 || j < 0) return false
    const current = order[this.battle.turn]
    order[i] = b.id
    order[j] = a.id
    if (current) this.battle.turn = order.indexOf(current)
    this.say(`${unitTag(a)} 和 ${unitTag(b)} 對調了行動的順序。`, undefined, { a: a.id, b: b.id })
    return true
  }

  /** 這一輪已經動過、或正在動：順位在現在輪到的人之前、或就是他。不在先攻順序裡（還在後方排隊、已經不在了）回傳 false。 */
  hasActed(u: BattleUnit): boolean {
    const i = this.battle.order.indexOf(u.id)
    return i >= 0 && i <= this.battle.turn
  }

  /**
   * 把這一輪還沒動過的人排到現在輪到的人後面一位（下一個就輪到他）。
   * 動過沒有，預設看現在的順位；對調順位之後要問的是「對調之前」動過沒有（大局：被換到前面的人，原本在後面才算還沒動過），
   * 這時由呼叫的人在對調之前用 hasActed 問好，把結果用 opts.acted 帶進來。
   * 已經動過的、正在動的、已經退出或不在場上的、不在順序裡的回傳 false，順序不動。他本來排在現在輪到的人前面（對調過）時，
   * 要把輪到的人的指標跟著修正，輪到的還是原來那個人。
   */
  actNext(u: BattleUnit, opts: { acted?: boolean } = {}): boolean {
    const b = this.battle
    const i = b.order.indexOf(u.id)
    const cur = b.order[b.turn]
    if (i < 0 || cur === undefined || u.id === cur || (opts.acted ?? i <= b.turn) || !onField(u)) return false
    if (i !== b.turn + 1) {
      b.order.splice(i, 1)
      b.turn = b.order.indexOf(cur)
      b.order.splice(b.turn + 1, 0, u.id)
    }
    this.say(`${unitTag(u)} 排到下一個行動。`, undefined, { unit: u.id })
    return true
  }

  // ---- 效果（dev/adr/0015 第一節） ----

  /**
   * 照順序做一串效果（道具、技能、招牌行動、武器的附帶效果、快駭的 { op, ... }）：解析每一筆的 who（落在誰身上）與 if（看上一筆的結果），
   * 再呼叫註冊的處理函式。op 查不到、who 或 if 不在清單裡丟錯。回傳最後的 last（上一筆攻擊或檢定的結果）。詳見 effects.ts。
   */
  effects(list: readonly Record<string, unknown>[], input: BattleEffectInput): BattleEffectLast {
    return runEffects(this, list, input)
  }

  // ---- 遮蔽與站位（COMBAT_SYSTEM 第 2 節） ----

  private coverMax(c: BattleCover, level: 1 | 2): number {
    return c.max?.[level - 1] ?? coverHpFor(this.n, level, this.battle.grade)
  }

  /** 遮蔽受傷：沒人站的格子傷害加倍；打穿一級就降一級，多的傷害算到下一級。打不破的（煙霧、人群）不受傷。 */
  hurtCover(side: BattleSide, slot: number, dmg: number, by?: BattleUnit): void {
    const c = this.battle.cover[side][slot - 1]
    if (!c || c.soft || c.level === 0) return
    let v = Math.round(dmg)
    if (v <= 0) return
    if (!unitAt(this.battle, side, slot)) v *= this.n.emptyCoverMult
    c.hp -= v
    this.say(`${SIDE_NAME[side]}第 ${slot} 格的${this.mode.coverWord}受到 ${v} 點傷害。`, 'cover.hit', { side, slot, amount: v, ...(by ? { by: by.id } : {}) })
    while (c.level > 0 && c.hp <= 0) {
      c.level = (c.level - 1) as 0 | 1
      if (c.level > 0) c.hp += this.coverMax(c, c.level as 1)
      else c.hp = 0
      this.say(`${SIDE_NAME[side]}第 ${slot} 格的${this.mode.coverWord}被打成${this.mode.coverNames[c.level]}。`, 'cover.break', { side, slot, level: c.level, ...(by ? { by: by.id } : {}) }, by)
      if (c.level === 0) {
        const u = unitAt(this.battle, side, slot)
        if (u) this.exposed(u)
      }
    }
    this.compact(side)
  }

  /** 把一格的遮蔽升幾級（最高到掩體），耐久補滿。 */
  raiseCover(side: BattleSide, slot: number, levels = 1, max?: [number, number]): void {
    const c = this.battle.cover[side][slot - 1]
    if (!c) return
    c.level = clamp(c.level + levels, 0, 2) as 0 | 1 | 2
    if (max) c.max = max
    c.hp = c.level > 0 ? this.coverMax(c, c.level as 1 | 2) : 0
    this.say(`${SIDE_NAME[side]}第 ${slot} 格現在是${this.mode.coverNames[c.level]}。`, 'cover.raise', { side, slot, level: c.level })
  }

  /** 把一格的遮蔽降幾級，不必過耐久（拆牆、技能）。 */
  lowerCover(side: BattleSide, slot: number, levels = 1, by?: BattleUnit): void {
    const c = this.battle.cover[side][slot - 1]
    if (!c || c.level === 0) return
    c.level = clamp(c.level - levels, 0, 2) as 0 | 1 | 2
    c.hp = c.level > 0 ? this.coverMax(c, c.level as 1 | 2) : 0
    this.say(`${SIDE_NAME[side]}第 ${slot} 格的${this.mode.coverWord}被拆成${this.mode.coverNames[c.level]}。`, 'cover.break', { side, slot, level: c.level, ...(by ? { by: by.id } : {}) }, by)
    if (c.level === 0) {
      const u = unitAt(this.battle, side, slot)
      if (u) this.exposed(u)
    }
    this.compact(side)
  }

  /** 打不破的遮蔽（煙霧：一格暫時的半掩體，持續幾回合後自己散掉；COMBAT_SYSTEM 2.5 節）。 */
  softCover(side: BattleSide, slot: number, kind: string, rounds?: number): void {
    const c = this.battle.cover[side][slot - 1]
    if (!c) return
    c.soft = { kind, ...(rounds !== undefined ? { until: this.battle.round + rounds - 1 } : {}) }
    this.say(`${SIDE_NAME[side]}第 ${slot} 格起了${kind === 'smoke' ? '煙霧' : kind === 'crowd' ? '人群' : kind}：算打不破的${this.mode.coverNames[1]}。`, 'field', { side, slot, kind })
  }

  /**
   * 斷路（dev/adr/0018 第一節；兩個戰場都能用）：把某一方的某一格「凍結」到第 untilRound 回合結束為止——
   * 站在上面的人換不了位（moveBlock 的原因一句；run.move、shift、place 也擋），別人換不進來，補位與增援跳過它。
   * 記在 battle.field 的 cut:<方>:<格>（值是到第幾輪結束為止）；那一輪結束時自動解除。這一格已經被斷路的，取比較晚的期限。
   * untilRound 比現在的輪還早（已經過了）什麼都不做；格子不在 1～4 丟錯。
   */
  cutSlot(side: BattleSide, slot: number, untilRound: number, by?: BattleUnit): void {
    if (!Number.isInteger(slot) || slot < 1 || slot > BATTLE_SLOTS) throw new Error(`斷路要指定第 1～${BATTLE_SLOTS} 格，不是 ${String(slot)}`)
    if (!Number.isFinite(untilRound) || untilRound < this.battle.round) return
    const key = cutKey(side, slot)
    const old = this.battle.field[key]
    const until = Math.round(typeof old === 'number' && old >= this.battle.round ? Math.max(old, untilRound) : untilRound)
    this.battle.field[key] = until
    this.say(`${SIDE_NAME[side]}第 ${slot} 格被斷路了：${until <= this.battle.round ? '這一輪' : `到第 ${until} 回合結束前`}，站在這一格的人換不了位，後面的人也補不進來。`, 'field', { side, slot, kind: 'cut', until }, by)
  }

  /**
   * 一輪結束時解除到期的斷路（turn.ts 的 endRound 在回合數加一之前呼叫）：記一拍，並讓被擋住的補位補回來。
   */
  releaseCuts(): void {
    const b = this.battle
    const freed: BattleSide[] = []
    for (const side of ['ally', 'foe'] as const) {
      for (let slot = 1; slot <= BATTLE_SLOTS; slot++) {
        const key = cutKey(side, slot)
        const v = b.field[key]
        if (v === undefined || (typeof v === 'number' && v > b.round)) continue
        delete b.field[key]
        this.say(`${SIDE_NAME[side]}第 ${slot} 格的斷路解除了。`, 'field', { side, slot, kind: 'uncut' })
        if (!freed.includes(side)) freed.push(side)
      }
    }
    for (const side of freed) this.compact(side)
  }

  /** 有人站上暴露的格子：記下來，這個動作結算完再交給監視。 */
  exposed(u: BattleUnit): void {
    if (this.isExposed(u) && !this.exposedQueue.includes(u.id)) this.exposedQueue.push(u.id)
  }

  /**
   * 換位：和相鄰那一格的隊友交換，或移到相鄰的空格。合不合法由呼叫的人先用 moveBlock 檢查（原因一句，給玩家看）。
   * 被斷路的格子（run.cutSlot）不能進出：這一格或目的格被斷路時什麼都不做、回傳 false；做了回傳 true。
   */
  move(u: BattleUnit, to: number): boolean {
    if (isCut(this.battle, u.side, u.slot) || isCut(this.battle, u.side, to)) return false
    const other = unitAt(this.battle, u.side, to)
    const from = u.slot
    if (other) other.slot = from
    u.slot = to
    this.say(other ? `${unitTag(u)} 和 ${other.name} 換位。` : `${unitTag(u)} 移到第 ${to} 格。`, 'move', { unit: u.id, from, to, ...(other ? { swap: other.id } : {}) }, u)
    this.exposed(u)
    if (other) this.exposed(other)
    this.k.battle.emit('moved', { run: this, unit: u, from, to, by: 'action' })
    this.compact(u.side)
    return true
  }

  /** 推（+1 往後）或拉（−1 往前）一格；目的格有人就兩個人交換（COMBAT_SYSTEM 2.4 節）。到底了就不動。 */
  shift(u: BattleUnit, delta: number, by?: BattleUnit): boolean {
    return this.place(u, u.slot + delta, by)
  }

  /** 把人放到某一格（抓捕索把後排的人拉到第 1 格）；那一格有人就交換。 */
  place(u: BattleUnit, to: number, by?: BattleUnit): boolean {
    if (!onField(u) || this.isStandIn(u) || to < 1 || to > BATTLE_SLOTS || to === u.slot) return false
    // 被斷路的格子不能進出：推不動、拉不動（斷路：run.cutSlot）
    if (isCut(this.battle, u.side, u.slot) || isCut(this.battle, u.side, to)) {
      this.say(`${unitTag(u)} 所在的格子被斷路了，推拉都動不了他。`, 'field', { unit: u.id, kind: 'cut_hold', from: u.slot, to }, by)
      return false
    }
    const other = unitAt(this.battle, u.side, to)
    const from = u.slot
    if (other) other.slot = from
    u.slot = to
    this.say(`${unitTag(u)} 被${to > from ? '推到' : '拉到'}第 ${to} 格${other ? `，和 ${other.name} 換了位置` : ''}。`, to > from ? 'push' : 'pull', { unit: u.id, from, to, ...(by ? { by: by.id } : {}) }, by)
    this.exposed(u)
    if (other) this.exposed(other)
    this.k.battle.emit('moved', { run: this, unit: u, from, to, by: 'forced' })
    this.compact(u.side)
    return true
  }

  /**
   * 補位：前面那一格沒有單位、也沒有遮蔽時，後面的單位自動往前遞補，而且帶著自己那一格的遮蔽一起往前；
   * 最後面空出來的那一格是暴露。前面那一格空了但遮蔽還在（煙霧也算），後面的人留在原地。
   * 全部補完、狀態整理好之後，對每個往前移動的單位發一次 compacted（from、to 是這一次 compact 的淨移動，照原本的格由前往後）。
   */
  compact(side: BattleSide): void {
    const c = this.battle.cover[side]
    const from = new Map<string, number>()
    for (let guard = 0; guard < 8; guard++) {
      let moved = false
      for (let s = 1; s < BATTLE_SLOTS && !moved; s++) {
        if (unitAt(this.battle, side, s) || coverLevel(coverAt(this.battle, side, s)) > 0) continue
        const back = unitsOf(this.battle, side).filter((u) => u.slot > s)
        if (!back.length) continue
        // 被斷路的格子（run.cutSlot）出不去也進不來：這一排只要有一格被斷路，這一次就不補（整排連同遮蔽往前移會動到它）
        if (this.anyCut(side, s)) continue
        for (const u of back) {
          if (!from.has(u.id)) from.set(u.id, u.slot)
          u.slot -= 1
        }
        // 和人重疊的東西跟著它掛的那一格走：後面的往前一格；掛在空出來那一格的，那一格轉到最後面，它也跟著到最後面。
        // 這樣每格還是最多一台（COMBAT_SYSTEM 第 2 節；設計書沒寫人倒下之後掛在他那一格的怎麼辦，dev/adr/0013 C13）
        const orphans: BattleOverlay[] = []
        for (const o of this.battle.overlays) {
          if (o.side !== side || o.down) continue
          if (o.slot > s) o.slot -= 1
          else if (o.slot === s) {
            o.slot = BATTLE_SLOTS
            orphans.push(o)
          }
        }
        for (let i = s - 1; i < BATTLE_SLOTS - 1; i++) c[i] = c[i + 1]!
        c[BATTLE_SLOTS - 1] = { level: 0, hp: 0 }
        this.say(`${SIDE_NAME[side]}後排連同${this.mode.coverWord}往前補位。`, 'compact', { side, slot: s })
        for (const o of orphans) this.say(`${o.name}退到${SIDE_NAME[side]}的第 ${BATTLE_SLOTS} 格。`, 'overlay', { overlay: o.id, kind: o.kind, from: s, slot: BATTLE_SLOTS })
        for (const u of back) this.exposed(u)
        moved = true
      }
      if (!moved) break
    }
    // 狀態都整理好了才發：處理函式（守著一格的反擊）可以放心做會動到站位的事
    for (const [id, was] of [...from].sort((a, b) => a[1] - b[1])) {
      const u = this.battle.units[id]
      if (u && u.slot < was) this.k.battle.emit('compacted', { run: this, side, unit: u, from: was, to: u.slot })
    }
  }

  /** 這一方最後面的空格（沒有就是 0）。被斷路的格子（run.cutSlot）跳過：補位、增援、救回來的人都進不去。 */
  private lastFreeSlot(side: BattleSide): number {
    for (let s = BATTLE_SLOTS; s >= 1; s--) if (!unitAt(this.battle, side, s) && !isCut(this.battle, side, s)) return s
    return 0
  }

  /** 從第 from 格到最後一格，有沒有被斷路的。 */
  private anyCut(side: BattleSide, from: number): boolean {
    for (let s = from; s <= BATTLE_SLOTS; s++) if (isCut(this.battle, side, s)) return true
    return false
  }

  /**
   * 一個在後方的人站上場：放進這一格；還不在先攻順序裡的當場擲先攻（1d20 ＋ mod(反應) ＋ 修正，和開打時同一條算式）並排進去；補位。
   * roundStart：一輪開頭才進場的（run.callIn 叫來的）。那時誰都還沒動，輪到的指標不必讓位：他的順位排在最前面就是這一輪第一個動。
   */
  private enter(u: BattleUnit, slot: number, roundStart = false): void {
    const b = this.battle
    u.slot = slot
    // 救回來之後排在後方的人（revive）本來就在先攻的順序裡，順位不變
    if (!b.order.includes(u.id)) {
      u.initiative = this.d20() + u.initBonus + sum(this.mods('initiative', u))
      // 排在第一個先攻比他低的人前面（一樣高照開打時的規矩：我方先、再照站位）；都不比他低就排最後
      const at = b.order.findIndex((id) => initiativeOrder(u, b.units[id]!) < 0)
      if (at < 0) b.order.push(u.id)
      else {
        b.order.splice(at, 0, u.id)
        // 插在輪到的人前面（或正好是他的位置）：指標跟著往後一格，輪到的還是原來那個人
        if (at <= b.turn && !roundStart) b.turn += 1
      }
    }
    this.say(`${unitTag(u)} 從後方補上來，站到第 ${slot} 格。`, 'reinforce', { unit: u.id, side: u.side, slot, ...(roundStart ? { called: true } : {}) })
    this.exposed(u)
    this.compact(u.side)
  }

  /**
   * 後方排隊的人補上來：有空格才補，從最後面的空格進場；行動點從上限開始。
   * 先攻當場擲（1d20 ＋ mod(反應) ＋ 修正，和開打時同一條算式），照它排進先攻的順序：
   * 他的順位在這一輪已經過了，下一輪才動；還沒到，這一輪就輪得到他（COMBAT_SYSTEM 1.2 節；dev/adr/0013 C6）。
   * 叫來還沒進場的人（run.callIn）不在這裡補：他們等下一輪開頭（admitCalled）；排在他們後面的人照常先補。
   */
  reinforce(side: BattleSide): void {
    const b = this.battle
    const queue = b.reserve[side]
    while (!this.over && unitsOf(b, side).length < BATTLE_SLOTS) {
      const id = queue.find((x) => !b.called?.includes(x))
      const slot = this.lastFreeSlot(side)
      if (id === undefined || !slot) break
      queue.splice(queue.indexOf(id), 1)
      this.enter(this.unit(id), slot)
    }
  }

  /**
   * 監視（COMBAT_SYSTEM 1.3 節）：每個站上暴露格子的人，對面每一個正在監視的人各自朝他做一次監視的動作（不另花行動點）。
   * 觸發的那一刻做不到（彈匣空了、打不到）就不算，繼續等。之後交給其他的反應（exposed 掛點）。
   */
  flushWatch(): void {
    if (this.flushing) return
    this.flushing = true
    try {
      for (let guard = 0; guard < 24 && this.exposedQueue.length && !this.over; guard++) {
        const t = this.battle.units[this.exposedQueue.shift()!]
        if (!t || !this.isExposed(t)) continue
        const watchers = this.battle.order.map((id) => this.battle.units[id]!).filter((w) => w && w.side === otherSide(t.side) && onField(w) && w.watch && !w.statuses.some((s) => s.id === LOSE_TURN))
        for (const w of watchers) {
          if (t.out || !this.isExposed(t) || this.over) break
          const def = this.k.battle.getAction(w.watch!.action)
          if (!def?.auto) continue
          this.say(`${unitTag(w)} 監視觸發：${unitTag(t)} 站上了暴露的格子。`, 'watch.fire', { unit: w.id, target: t.id }, w)
          const mark = this.beats.length
          if (def.auto(this, w, t)) delete w.watch
          else this.beats.splice(mark - 1, 1)
        }
        if (!t.out && !this.over) this.k.battle.emit('exposed', { run: this, unit: t })
      }
      this.exposedQueue = []
    } finally {
      this.flushing = false
    }
  }

  /** 一個動作做完之後的收尾：監視、後方補位、分出結果。 */
  settle(): void {
    this.flushWatch()
    this.reinforce('ally')
    this.reinforce('foe')
    this.flushWatch()
    this.checkResult()
  }
}
