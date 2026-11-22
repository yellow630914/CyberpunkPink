// L5 戰鬥：算一步。BattleRun 拿著戰鬥狀態的工作副本與這一步的紀錄，提供所有行動共用的基本動作：
// 擲骰、花行動點、攻擊（命中、要害、遮蔽、傷害、重創）、感載與過載、狀態、換位與推拉、補位、監視、倒下與分出結果。
// 功能註冊的行動只組合這些基本動作，不自己改戰鬥狀態的欄位以外的東西，也不碰 GameState：
// 一步算完之後，整份戰鬥狀態由一筆 battle 變更交給提交報告（dev/invariants.md 第 1 條）。
//
// 以第四版介面的 ui/src/lib/combat/real.ts、field.ts 當底，逐條對照 COMBAT_SYSTEM 改寫；和設計書對不上的地方列在 dev/adr/0013。

import type { AttrId, BattleCover, BattleOverlay, BattleSide, BattleState, BattleStatus, BattleUnit, BattleUntil, BattleWeapon, CheckRoll, DamageType, GameState, RollPart, SkillId, TimelineBeat } from '../types'
import { BATTLE_SLOTS } from '../types'
import { attrMod, computeDegree, verdictOf } from '../rules/check'
import { deriveRng } from '../util/rng'
import { clamp } from '../util/sanitize'
import { SIDE_NAME, afterglowFull, coverAt, coverLevel, coverOf, currentUnit, distance, isExposed, isWounded, onField, otherSide, rangeMod, standing, unitAt, unitTag, unitsOf, wielded } from './field'
import type { BattleKernel, BattleView } from './registry'
import type { BattleMode, BattleNumbers, BattleStatusRule, ModKind, StatusUntil } from './rules'
import { LOSE_TURN, coverHpFor, damageTypeOf, modeOf, statusMod, statusRuleOf } from './rules'

const sum = (parts: RollPart[]): number => parts.reduce((s, p) => s + p.value, 0)

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
}

export interface AttackResult {
  /** 這一擊沒有發生（攻擊者在擲骰之前倒下了） */
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
}

export class BattleRun implements BattleView {
  readonly mode: BattleMode
  readonly n: BattleNumbers
  /** 這一步的紀錄：一拍一句，帶事件的標籤 */
  readonly beats: TimelineBeat[] = []
  private exposedQueue: string[] = []
  private flushing = false

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

  /** 一個數字的所有加減：狀態、餘韻、重傷，加上功能註冊的修正（技能、義體、特質）。 */
  mods(kind: ModKind, unit: BattleUnit, other?: BattleUnit, weapon?: BattleWeapon, tags: string[] = []): RollPart[] {
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
    out.push(...this.k.battle.modifiers({ kind, view: this, unit, ...(other ? { other } : {}), ...(weapon ? { weapon } : {}), tags }))
    return out.filter((p) => p.value !== 0)
  }

  /** 帶著「不能換位」的狀態嗎。 */
  cannotMove(u: BattleUnit): boolean {
    return u.statuses.some((s) => statusRuleOf(this.k.content, s.id)?.noMove)
  }

  /** 迴避 = 基礎（單位身上算好的）＋ 那一格的遮蔽 ＋ 黑暗 ＋ 修正。by 是攻擊的人（有夜視的不算黑暗）。 */
  evadeOf(target: BattleUnit, by?: BattleUnit, o: { coverShift?: number; extra?: number } = {}): { total: number; parts: RollPart[]; cover: number } {
    const level = clamp(coverOf(this.battle, target) - (o.coverShift ?? 0), 0, 2)
    const cover = this.n.coverBonus[level] ?? 0
    const parts: RollPart[] = [{ label: '迴避', value: target.evade, source: 'base' }]
    if (cover) parts.push({ label: this.mode.coverNames[level]!, value: cover, source: 'cover' })
    if (this.battle.field.dark && !by?.tags.includes('night_vision')) parts.push({ label: '黑暗', value: this.n.darkEvade, source: 'field' })
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
      if (!pool || pool.now < v) throw new Error(`${u.name} 的${key === 'ap' ? '行動點' : key}不夠（要 ${v}）`)
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
    const w = o.weapon ?? wielded(attacker)
    if (!w) throw new Error(`${attacker.name} 手上沒有武器`)
    const none: AttackResult = { hit: false, crit: false, natural: 0, total: 0, evade: 0, raw: 0, dealt: 0, track: 'none', wound: false, downed: false }
    const spend = o.spend ?? 1
    if (w.mag && spend > 0) w.mag.now = Math.max(0, w.mag.now - spend)
    const opts: AttackOpts = { ...o, tags: [...(o.tags ?? [])] }
    // 反應在擲骰之前（掩護射擊、小心後面！）：可以改這一擊的加減，也可能先把攻擊的人打倒
    this.k.battle.emit('attack.before', { run: this, attacker, target, weapon: w, opts })
    if (attacker.out || target.out || this.over) return { ...none, aborted: true }

    const aimed = !!opts.aimed || w.traits.includes('aimed')
    const tags = aimed ? [...opts.tags!, 'aimed'] : opts.tags!
    const parts = this.hitParts(attacker, target, w, opts)
    const ev = this.evadeOf(target, attacker, { coverShift: opts.coverShift, extra: opts.evade })
    const natural = this.d20()
    const total = natural + sum(parts)
    // 自然 20 一定命中，自然 1 一定失手
    const hit = natural === 20 || (natural !== 1 && total >= ev.total)
    const margin = this.n.critMargin + (opts.critMargin ?? 0) + sum(this.mods('crit_margin', attacker, target, w, tags))
    const crit = hit && (!!opts.autoCrit || total - ev.total >= margin)
    // 重創：自然 20，或瞄準過的射擊打出要害
    const wound = hit && !opts.noWound && (natural === 20 || (crit && aimed))
    const baseDice = w.far && distance(attacker, target) > w.far.beyond ? w.far.dice : w.dice
    // 要害多一顆；雜兵不擲部位，重創直接多一顆
    const dice = Math.max(1, baseDice + (opts.dice ?? 0) + sum(this.mods('dice', attacker, target, w, tags)) + (crit ? 1 : 0) + (wound && target.rank === 'minion' ? 1 : 0))
    const rolled = this.d6(dice)
    const raw = Math.max(0, rolled + w.flat + (opts.damage ?? 0) + sum(this.mods('damage', attacker, target, w, tags)))

    const roll: CheckRoll = {
      dice: '1d20', natural, parts, total, dc: ev.total, margin: total - ev.total,
      degree: natural === 1 ? 'fumble' : crit ? 'critical' : hit ? 'success' : 'fail',
      verdict: verdictOf(natural === 1 ? 'fumble' : crit ? 'critical' : hit ? 'success' : 'fail', total - ev.total),
    }
    const head = `${unitTag(attacker)} 用${w.name}${opts.label ?? (w.traits.includes('melee') ? '攻擊' : '射擊')} ${unitTag(target)}：`
    const ids = { attacker: attacker.id, target: target.id, weapon: w.class }
    let result: AttackResult = { ...none, hit, crit, natural, total, evade: ev.total, raw: hit ? raw : 0, wound }
    if (!hit) {
      const blocked = natural !== 1 && ev.cover > 0 && total >= ev.total - ev.cover
      this.say(`${head}${natural === 1 ? '自然 1，失手。' : blocked ? `被${this.mode.coverWord}擋下。` : '沒打中。'}`, 'miss', { ...ids, natural, blocked }, attacker, roll)
    } else {
      this.say(`${head}${natural === 20 ? '自然 20！' : crit ? '要害！' : '命中。'}`, crit ? 'crit' : 'hit', { ...ids, natural }, attacker, roll)
      const before = !!target.out
      const d = this.damage(target, raw, opts.type ?? w.type, attacker, { pierce: w.pierce + (opts.pierce ?? 0) + sum(this.mods('pierce', attacker, target, w, tags)) })
      result = { ...result, dealt: d.dealt, track: d.track, downed: !before && !!target.out }
      if (wound && target.rank !== 'minion' && !target.out && d.dealt > 0) this.k.battle.emit('wound', { run: this, attacker, target, aimed, ...(opts.part ? { part: opts.part } : {}) })
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
   * 照傷害類型把一筆傷害打在目標身上（COMBAT_SYSTEM 第 4、5 節）。by 是造成傷害的人（敵人的傷害倍率、仇恨）。
   * 生命：扣護甲（穿甲只抵銷護甲）→ 類型對標籤的倍率 → 位階與難度的倍率 → 有機體的先扣機體、回灌感載。
   * 感載：不看護甲（內海的防護照扣）→ 餘韻的加成 → 敏感度 → 過載。
   */
  damage(target: BattleUnit, raw: number, typeId: DamageType, by?: BattleUnit, o: { pierce?: number } = {}): { dealt: number; track: AttackResult['track'] } {
    if (target.out) return { dealt: 0, track: 'none' }
    const type = damageTypeOf(this.k.content, typeId)
    const armor = Math.max(0, target.armor + (target.hull?.armor ?? 0) + sum(this.mods('armor', target, by)))
    const afterArmor = (v: number, share: number): number => {
      const eff = Math.floor(armor * share)
      return this.n.pierceOverflow ? Math.max(0, v - eff + (o.pierce ?? 0)) : Math.max(0, v - Math.max(0, eff - (o.pierce ?? 0)))
    }
    if (type.track === 'load') {
      if (type.needsBridge && !target.load) {
        this.say(`${unitTag(target)} 沒有橋，${type.name}傷害對他無效。`, 'damage', { target: target.id, type: typeId, amount: 0 })
        return { dealt: 0, track: 'none' }
      }
      let v = this.mode.armorOnLoad ? afterArmor(raw, 1) : raw
      if (by) v *= by.dmgMult.load * (1 + (by.layers * this.mode.afterglow.loadDealtPct + sum(this.mods('load_dealt_pct', by, target))) / 100)
      const got = this.addLoad(target, v, by)
      if (got > 0 && type.sink) target.sink += type.sink
      return { dealt: got, track: got > 0 ? 'load' : 'none' }
    }
    if (!target.hp) return { dealt: 0, track: 'none' }
    let dm = afterArmor(raw, type.armor)
    for (const [tag, mult] of Object.entries(type.vs ?? {})) if (target.tags.includes(tag)) dm *= mult
    if (by && dm > 0 && by.dmgMult.hp !== 1) dm = Math.max(1, Math.round(dm * by.dmgMult.hp))
    dm = Math.round(dm)
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
    target.hp.now = Math.max(0, target.hp.now - dm)
    this.say(`${unitTag(target)} 受到 ${dm} 點${type.name}傷害。`, 'damage', { target: target.id, type: typeId, amount: dm, left: target.hp.now, ...(by ? { by: by.id } : {}) }, by)
    if (target.hp.now <= 0) this.setOut(target, 'down', by)
    else for (const s of type.onHit ?? []) if (statusRuleOf(this.k.content, s.status)) this.applyStatus(target, s.status, { ...(by ? { by } : {}), turns: s.turns })
    return { dealt: dm + soaked, track: 'hp' }
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

  /** 過載：感載歸零（多的不留）、疊一層餘韻；已經疊滿就倒下。沒倒下的照戰場的規則失去下一個回合（現實）或閃斷（內海）。 */
  overload(target: BattleUnit, by?: BattleUnit): void {
    if (!target.load || target.out) return
    target.load.now = 0
    if (afterglowFull(target)) {
      this.say(`${unitTag(target)} 餘韻疊滿之後再過載：昏了過去。`, 'overload', { target: target.id, layers: target.layers, down: true }, by)
      this.setOut(target, 'burnout', by)
      return
    }
    target.layers += 1
    if (this.mode.overload === 'lose_turn') {
      this.say(`${unitTag(target)} 過載！失去下一個回合，餘韻 ${target.layers} 層。`, 'overload', { target: target.id, layers: target.layers }, by)
      this.applyStatus(target, LOSE_TURN, { force: true, ...(by ? { by } : {}) })
    } else {
      const pool = this.mode.flashPool ? target.pools[this.mode.flashPool] : undefined
      if (pool) pool.now = 0
      this.say(`${unitTag(target)} 過載！閃斷，餘韻 ${target.layers} 層。`, 'overload', { target: target.id, layers: target.layers, flash: true }, by)
    }
    this.k.battle.emit('overload', { run: this, unit: target, ...(by ? { by } : {}) })
  }

  /** 回生命值（不超過上限）。回傳實際回了多少。 */
  heal(target: BattleUnit, amount: number): number {
    if (!target.hp || target.out) return 0
    const v = Math.max(0, Math.min(Math.round(amount), target.hp.max - target.hp.now))
    target.hp.now += v
    if (v) this.say(`${unitTag(target)} 生命 +${v}。`, 'heal', { target: target.id, amount: v })
    return v
  }

  /** 排感載（不低於 0）。 */
  vent(target: BattleUnit, amount: number): number {
    if (!target.load || target.out) return 0
    const v = Math.max(0, Math.min(Math.round(amount), target.load.now))
    target.load.now -= v
    if (v) this.say(`${unitTag(target)} 感載 −${v}。`, 'load', { target: target.id, amount: -v, now: target.load.now })
    return v
  }

  /** 一次豁免或戰鬥裡的檢定：1d20 ＋ mod(屬性) ＋ 基本功 ＋ 修正 對 DC。自然 20 一定過、自然 1 一定不過。 */
  save(u: BattleUnit, attr: AttrId, skill: SkillId | undefined, dc: number, label: string, extra: RollPart[] = []): { ok: boolean; roll: CheckRoll } {
    const parts: RollPart[] = [
      { label: this.k.stats.attrName(attr), value: attrMod(u.attrs[attr] ?? 10), source: 'attr' },
      ...(skill ? [{ label: this.k.stats.skillName(skill), value: u.skills[skill] ?? 0, source: 'skill' }] : []),
      ...this.mods('save', u), ...extra,
    ].filter((p) => p.value !== 0)
    const natural = this.d20()
    const total = natural + sum(parts)
    const degree = computeDegree(natural, total, dc)
    const roll: CheckRoll = { dice: '1d20', natural, parts, total, dc, degree, verdict: verdictOf(degree, total - dc), margin: total - dc, attr, ...(skill ? { skill } : {}) }
    const ok = degree === 'critical' || degree === 'success'
    this.say(`${unitTag(u)} ${label}：${total} 對 ${dc}，${ok ? '過了' : '沒過'}。`, undefined, { unit: u.id, ok }, u, roll)
    return { ok, roll }
  }

  // ---- 狀態 ----

  /** 給一個狀態。同一個狀態再得一次只重算時間，不疊加。首領有控制保護（ENEMIES 4.5 節）。回傳有沒有給上去。 */
  applyStatus(target: BattleUnit, id: string, o: StatusOpts = {}): boolean {
    if (target.out) return false
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
    const until: BattleUntil = kind === 'battle_end' ? { at: 'battle_end' } : { at: kind.endsWith('start') ? 'turn_start' : 'turn_end', of, turns }
    const status: BattleStatus = { id, until, ...(o.by ? { by: o.by.id } : {}), ...(o.data ? { data: { ...o.data } } : {}) }
    target.statuses = [...target.statuses.filter((s) => s.id !== id), status]
    if (id !== LOSE_TURN) this.say(`${unitTag(target)}：${rule.name}。`, 'status', { target: target.id, status: id, ...(o.by ? { by: o.by.id } : {}) }, o.by)
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

  // ---- 倒下、退出與結果 ----

  /**
   * 這個人退出戰鬥。how：down（生命歸零倒下）、burnout（餘韻疊滿再過載，昏過去）、subdued（被制伏）、
   * surrendered（投降）、fled（逃走）、removed（被帶走）。戰鬥中沒有人會死（COMBAT_SYSTEM 8.2 節）。
   */
  setOut(u: BattleUnit, how: string, by?: BattleUnit): void {
    if (u.out) return
    u.out = how
    delete u.watch
    u.statuses = u.statuses.filter((s) => s.id !== LOSE_TURN)
    const words: Record<string, string> = { down: u.side === 'foe' ? '被打倒了' : '倒下了', burnout: '昏了過去', subdued: '被制伏，退出戰鬥', surrendered: '投降了', fled: '逃走了', removed: '被帶走了' }
    const tag = how === 'subdued' ? 'subdue' : how === 'surrendered' ? 'surrender' : how === 'fled' ? 'flee' : 'down'
    if (how !== 'burnout') this.say(`${unitTag(u)} ${words[how] ?? '退出了戰鬥'}。`, tag, { target: u.id, how, rank: u.rank, side: u.side, ...(by ? { by: by.id } : {}) }, by)
    else this.say(`${unitTag(u)} 倒下了。`, 'down', { target: u.id, how, rank: u.rank, side: u.side, ...(by ? { by: by.id } : {}) }, by)
    // 操作者倒下，所有和人重疊的東西停機（COMBAT_SYSTEM 9.1 節）
    for (const o of this.battle.overlays) if (o.owner === u.id && !o.down) this.dropOverlay(o, undefined, true)
    this.k.battle.emit('out', { run: this, unit: u, how, ...(by ? { by } : {}) })
    this.compact(u.side)
    this.checkResult()
  }

  /** 和人重疊的東西被擊落或停機。 */
  dropOverlay(o: BattleOverlay, by?: BattleUnit, quiet = false): void {
    if (o.down) return
    o.down = true
    this.say(quiet ? `${o.name}停機了。` : `${o.name}被擊落了。`, 'overlay.down', { overlay: o.id, kind: o.kind, owner: o.owner, ...(by ? { by: by.id } : {}) }, by)
    if (!quiet) this.k.battle.emit('overlay.down', { run: this, overlay: o, ...(by ? { by } : {}) })
  }

  /** 一方全部倒下或退出：分出結果。 */
  checkResult(): void {
    if (this.battle.result) return
    if (standing(this.battle, 'ally') === 0) this.finish('lose', '全隊倒下：戰敗。')
    else if (standing(this.battle, 'foe') === 0) this.finish('win', '敵人全部倒下或退出：勝利。')
  }

  /** 這場戰鬥分出結果了（勝、敗、脫離、投降，或功能自己的結果）。之後不再有人行動；結束的報告由外殼提交。 */
  finish(outcome: string, text: string): void {
    if (this.battle.result) return
    this.battle.result = { outcome, text }
    for (const u of Object.values(this.battle.units)) delete u.watch
    this.k.battle.emit('battle.result', { run: this, outcome })
    this.say(text, 'battle.end', { outcome })
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

  /** 有人站上暴露的格子：記下來，這個動作結算完再交給監視。 */
  exposed(u: BattleUnit): void {
    if (isExposed(this.battle, u) && !this.exposedQueue.includes(u.id)) this.exposedQueue.push(u.id)
  }

  /** 換位：和相鄰那一格的隊友交換，或移到相鄰的空格。合不合法由呼叫的人先用 moveBlock 檢查。 */
  move(u: BattleUnit, to: number): void {
    const other = unitAt(this.battle, u.side, to)
    const from = u.slot
    if (other) other.slot = from
    u.slot = to
    this.say(other ? `${unitTag(u)} 和 ${other.name} 換位。` : `${unitTag(u)} 移到第 ${to} 格。`, 'move', { unit: u.id, from, to, ...(other ? { swap: other.id } : {}) }, u)
    this.exposed(u)
    if (other) this.exposed(other)
    this.k.battle.emit('moved', { run: this, unit: u, from, to, by: 'action' })
    this.compact(u.side)
  }

  /** 推（+1 往後）或拉（−1 往前）一格；目的格有人就兩個人交換（COMBAT_SYSTEM 2.4 節）。到底了就不動。 */
  shift(u: BattleUnit, delta: number, by?: BattleUnit): boolean {
    return this.place(u, u.slot + delta, by)
  }

  /** 把人放到某一格（抓捕索把後排的人拉到第 1 格）；那一格有人就交換。 */
  place(u: BattleUnit, to: number, by?: BattleUnit): boolean {
    if (!onField(u) || to < 1 || to > BATTLE_SLOTS || to === u.slot) return false
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
   */
  compact(side: BattleSide): void {
    const c = this.battle.cover[side]
    for (let guard = 0; guard < 8; guard++) {
      let moved = false
      for (let s = 1; s < BATTLE_SLOTS && !moved; s++) {
        if (unitAt(this.battle, side, s) || coverLevel(coverAt(this.battle, side, s)) > 0) continue
        const back = unitsOf(this.battle, side).filter((u) => u.slot > s)
        if (!back.length) continue
        for (const u of back) u.slot -= 1
        for (const o of this.battle.overlays) if (o.side === side && !o.down && o.slot > s) o.slot -= 1
        for (let i = s - 1; i < BATTLE_SLOTS - 1; i++) c[i] = c[i + 1]!
        c[BATTLE_SLOTS - 1] = { level: 0, hp: 0 }
        this.say(`${SIDE_NAME[side]}後排連同${this.mode.coverWord}往前補位。`, 'compact', { side, slot: s })
        for (const u of back) this.exposed(u)
        moved = true
      }
      if (!moved) break
    }
  }

  /** 後方排隊的人補上來：有空格才補，從最後面的空格進場；先攻當場擲，行動點從上限開始。 */
  reinforce(side: BattleSide): void {
    const queue = this.battle.reserve[side]
    while (queue.length && unitsOf(this.battle, side).length < BATTLE_SLOTS && !this.over) {
      let slot = 0
      for (let s = BATTLE_SLOTS; s >= 1; s--) if (!unitAt(this.battle, side, s)) { slot = s; break }
      if (!slot) break
      const u = this.unit(queue.shift()!)
      u.slot = slot
      u.initiative = this.d20() + u.initBonus
      this.battle.order.push(u.id)
      this.say(`${unitTag(u)} 從後方補上來，站到第 ${slot} 格。`, 'reinforce', { unit: u.id, side, slot })
      this.exposed(u)
      this.compact(side)
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
        if (!t || !isExposed(this.battle, t)) continue
        const watchers = this.battle.order.map((id) => this.battle.units[id]!).filter((w) => w && w.side === otherSide(t.side) && onField(w) && w.watch && !w.statuses.some((s) => s.id === LOSE_TURN))
        for (const w of watchers) {
          if (t.out || !isExposed(this.battle, t) || this.over) break
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
