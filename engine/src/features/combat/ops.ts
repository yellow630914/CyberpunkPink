// L6 功能 combat：通用的效果（op）。dev/adr/0015 第一節；dev/work/M1b-ops.md。
// 道具、技能、招牌行動、武器的附帶效果、快駭都只寫 [{ op, ... }]；這裡註冊的是「做一件事」的那一批，每一個 op 不看來源是技能還是道具。
// 只用核心的基本動作（BattleRun）與公式（amount）；落在掛著的東西（ctx.overlay）上時，只有 strike、damage、對防火牆的 check 有作用，其餘跳過。
// 每個 op 註冊時一起給格式檢查（problems）：欄位的型別、不認得的欄位、公式用 amountProblems；訊息開頭是欄位的名字。

import type { AttackOpts, BattleEffectCtx, BattleRun, BattleUnit, BattleWeapon, DamageType, Kernel, RollPart } from '../../core'
import { BATTLE_SLOTS, BattleBlocked, STATUS_UNTILS, WOUND_PARTS, attrMod, damageTypeOf, isRecord, onField, statusRuleOf, unitTag, wielded } from '../../core'
import { tagsOf } from './items'
import { ATTR, B, F, S, STATUS_KINDS, TYPE, UNTIL, adjacentPick, list, num, oneOf, orWord, pair, qty, schema, shape } from './schema'
import { LIGHT, PART_NAME, TORSO_HP_LOSS, isPart } from './wounds'

const OWNER = 'combat'
type Eff = Record<string, unknown>
type Ctx = BattleEffectCtx

// ---- 共用的小工具 ----

/** 這一筆落在哪個人身上：掛著的東西、替身、沒有對象都跳過。 */
function who(ctx: Ctx): BattleUnit | undefined {
  const u = ctx.unit
  return u && !ctx.run.isStandIn(u) ? u : undefined
}


/** 回復類的效果帶給 run.heal、run.vent 的標籤：道具照舊（['item', …物品的標籤]）、技能是 ['skill']，其餘是來源的種類。 */
function healTags(ctx: Ctx): string[] {
  const s = ctx.source
  if (s.kind === 'item') return ['item', ...tagsOf(ctx.run.k, s.id)]
  if (s.kind === 'ability') return ['skill']
  return [s.kind]
}

/** 加一個資源（行動點、彈匣、RAM）：不帶 over_cap 不超過上限（本來就超過的不會被拉下來）；減不會低於 0。回傳新的值。 */
function grow(now: number, delta: number, max: number, over: boolean): number {
  if (delta < 0) return Math.max(0, now + delta)
  return over ? now + delta : Math.max(now, Math.min(max, now + delta))
}

/** 一筆落在哪一格（cover 用）：人、掛著的東西落在它的那一格；都不是就看玩家選的目標。 */
function cellOf(ctx: Ctx): { side: 'ally' | 'foe'; slot: number } | null {
  const t = ctx.target
  if (ctx.unit) return ctx.unit.slot >= 1 ? { side: ctx.unit.side, slot: ctx.unit.slot } : null
  if (!t) return null
  if ('slot' in t) return { side: t.side, slot: t.slot }
  if ('unit' in t) {
    const u = ctx.run.battle.units[t.unit]
    return u && u.slot >= 1 ? { side: u.side, slot: u.slot } : null
  }
  if ('overlay' in t) {
    const o = ctx.run.battle.overlays.find((x) => x.id === t.overlay)
    return o ? { side: o.side, slot: o.slot } : null
  }
  return null
}

/** pick 裡放的單位（id 或 { unit }）；挑不到、不在場上回傳 undefined。 */
function pickedUnit(ctx: Ctx, key: unknown): BattleUnit | undefined {
  const v = typeof key === 'string' ? ctx.pick[key] : undefined
  const id = typeof v === 'string' ? v : isRecord(v) && typeof v.unit === 'string' ? v.unit : undefined
  return id ? ctx.run.battle.units[id] : undefined
}

/** 沒有橋的人吃不到感載類的效果：記一句。 */
function noBridge(run: BattleRun, u: BattleUnit, name: string): void {
  run.say(`${unitTag(u)} 沒有橋，${name}對他無效。`, 'load', { target: u.id, amount: 0 })
}

// ---- 攻擊 ----

/** natural: true 的那一筆，同一串效果裡的每個落點共用同一個骰面：以（這一串的 last、這一筆資料）為鍵記下第一次擲的。 */
const sharedNatural = new WeakMap<object, WeakMap<object, number>>()
function naturalOf(ctx: Ctx, e: Eff): number | undefined {
  if (typeof e.natural === 'number') return e.natural
  if (e.natural !== true) return undefined
  let byEffect = sharedNatural.get(ctx.last)
  if (!byEffect) sharedNatural.set(ctx.last, (byEffect = new WeakMap()))
  let v = byEffect.get(e)
  if (v === undefined) byEffect.set(e, (v = ctx.run.d20()))
  return v
}

function writeLast(ctx: Ctx, r: { hit: boolean; crit: boolean; downed: boolean; dealt: number }): void {
  ctx.last.hit = r.hit
  ctx.last.crit = r.crit
  ctx.last.downed = r.downed
  ctx.last.dealt = r.dealt
}

function attackOp(ctx: Ctx, e: Eff): void {
  const { run, user } = ctx
  const target = ctx.unit
  const w = wielded(user)
  if (!target || !w) return
  // 花掉幾格：'all' 是彈匣裡剩下的全部。公式裡的 spent 就是這個數字（連射：傷害骰多 spent − 1 顆）
  const spent = e.spend === 'all' ? (w.mag?.now ?? 0) : e.spend === undefined ? undefined : Math.max(0, qty(ctx, e.spend, 1))
  const c = spent === undefined ? ctx : { run, user, n: { ...ctx.n, spent } }
  let hit = qty(c, e.hit, 0)
  // 換一組屬性與基本功算命中：加上兩組的差（武器的命中裡已經含它自己的那一組）
  const as = e.as
  if (isRecord(as)) {
    const skillOf = (id: string): number => user.skills[id] ?? 0
    hit += attrMod(user.attrs[as.attr as keyof BattleUnit['attrs']] ?? 10) + skillOf(String(as.skill)) - (attrMod(user.attrs[w.attr] ?? 10) + skillOf(w.skill))
  }
  const part = typeof ctx.pick.part === 'string' && isPart(ctx.pick.part) ? ctx.pick.part : undefined
  const opts: AttackOpts = {
    ...(hit ? { hit } : {}),
    ...(e.dice !== undefined ? { dice: qty(c, e.dice, 0) } : {}),
    ...(e.damage !== undefined ? { damage: qty(c, e.damage, 0) } : {}),
    ...(e.pierce !== undefined ? { pierce: qty(c, e.pierce, 0) } : {}),
    ...(e.cover_shift !== undefined ? { coverShift: qty(c, e.cover_shift, 0) } : {}),
    ...(typeof e.cover_mult_min === 'number' ? { coverMultMin: e.cover_mult_min } : {}),
    ...(typeof e.armor_mult === 'number' ? { armorMult: e.armor_mult } : {}),
    ...(typeof e.type === 'string' ? { type: e.type as DamageType } : {}),
    ...(e.aimed === true ? { aimed: true } : {}),
    ...(e.no_cover === true ? { noCoverDamage: true } : {}),
    ...(e.no_wound === true ? { noWound: true } : {}),
    ...(e.auto_crit === true ? { autoCrit: true } : {}),
    ...(spent !== undefined ? { spend: spent } : {}),
    ...(typeof e.label === 'string' ? { label: e.label } : {}),
    ...(Array.isArray(e.tags) ? { tags: e.tags.map(String) } : {}),
    ...(part ? { part } : {}),
  }
  const r = run.attack(user, target, opts)
  writeLast(ctx, r)
  if (spent !== undefined) ctx.n.spent = spent
}

function strikeOp(ctx: Ctx, e: Eff): void {
  const { run, user } = ctx
  if (!ctx.unit && !ctx.overlay) return
  // 臨時的武器：不吃彈匣、不看手上那把。名字是來源的名字（那顆手雷、那次撞擊）
  const w: BattleWeapon = {
    id: 'strike', name: ctx.source.name, class: 'strike', dice: Math.max(1, qty(ctx, e.dice, 1)), flat: 0,
    type: (typeof e.type === 'string' ? e.type : 'physical') as DamageType,
    range: Array.isArray(e.range) ? [Number(e.range[0]), Number(e.range[1])] : [1, 7], pierce: qty(ctx, e.pierce, 0), hit: qty(ctx, e.hit, 0),
    attr: 'body', skill: 'athletics', coverMult: typeof e.cover_mult === 'number' ? e.cover_mult : 0, traits: Array.isArray(e.traits) ? e.traits.map(String) : [],
  }
  const natural = naturalOf(ctx, e)
  const opts: AttackOpts = { weapon: w, spend: 0, ...(natural !== undefined ? { natural } : {}), ...(typeof e.label === 'string' ? { label: e.label } : {}) }
  const r = ctx.overlay ? run.attackOverlay(user, ctx.overlay, opts) : run.attack(user, ctx.unit!, opts)
  writeLast(ctx, r)
}

function damageOp(ctx: Ctx, e: Eff): void {
  const { run, user } = ctx
  const raw = qty(ctx, e.amount, 0)
  const type = (typeof e.type === 'string' ? e.type : 'physical') as DamageType
  const pierce = qty(ctx, e.pierce, 0)
  const overlay = ctx.overlay ?? (ctx.unit ? run.overlayOfStandIn(ctx.unit) : undefined)
  if (overlay) {
    // 直接的傷害打在掛著的東西上（不擲命中）：核心的算法（dev/work/M1b-core-closeout.md 第 1 項）
    const r = run.damageOverlay(overlay, raw, type, user, { pierce })
    ctx.last.dealt = r.dealt
    ctx.last.downed = r.downed
    return
  }
  const unit = who(ctx)
  if (!unit) return
  const before = !!unit.out
  const r = run.damage(unit, raw, type, user, { pierce })
  ctx.last.dealt = r.dealt
  ctx.last.downed = !before && !!unit.out
}

// ---- 感載、回復、餘韻、狀態 ----

function loadOp(ctx: Ctx, e: Eff): void {
  const { run, user } = ctx
  const unit = who(ctx)
  if (!unit) return
  const type: DamageType = e.type === 'pleasure' ? 'pleasure' : 'neural'
  const rule = damageTypeOf(run.k.content, type)
  ctx.last.overloaded = false
  if (!unit.load) {
    noBridge(run, unit, `${rule.name}的感載`)
    return
  }
  const before = unit.load.now
  const got = run.addLoad(unit, qty(ctx, e.amount, 0), user, { exact: e.exact === true })
  // 快感：照核心的規則加沉溺（傷害類型資料的 sink；走 gainSink，sink.before 擋得下）
  if (got > 0 && rule.sink) run.gainSink(unit, rule.sink, { type, by: user })
  ctx.last.overloaded = got > 0 && before + got >= unit.load.max
}

function afterglowOp(ctx: Ctx, e: Eff): void {
  const { run } = ctx
  const unit = who(ctx)
  if (!unit) return
  const want = qty(ctx, e.amount !== undefined ? e.amount : e.layers, 0)
  const layers = Math.max(0, Math.min(unit.layersMax, unit.layers + want))
  const delta = layers - unit.layers
  unit.layers = layers
  if (delta) run.say(`${unitTag(unit)} 餘韻 ${delta > 0 ? '+' : '−'}${Math.abs(delta)} 層。`, undefined, { target: unit.id, layers: delta })
}

function statusOp(ctx: Ctx, e: Eff): void {
  const { run, user } = ctx
  const unit = who(ctx)
  if (!unit || unit.out) return
  const sv = e.save
  if (isRecord(sv)) {
    const skill = typeof sv.skill === 'string' ? sv.skill : undefined
    const label = skill ? run.k.stats.skillName(skill) : run.k.stats.attrName(sv.attr as keyof BattleUnit['attrs'])
    const tags = Array.isArray(sv.tags) ? sv.tags.map(String) : []
    const { ok } = run.save(unit, sv.attr as keyof BattleUnit['attrs'], skill, qty(ctx, sv.dc, 10), label, [], tags, unit.id !== user.id ? user : undefined)
    if (ok) return
  }
  run.applyStatus(unit, String(e.status), {
    by: user,
    ...(e.turns !== undefined ? { turns: Math.max(1, qty(ctx, e.turns, 1)) } : {}),
    ...(typeof e.until === 'string' ? { until: e.until as (typeof STATUS_UNTILS)[number] } : {}),
    ...(isRecord(e.data) ? { data: Object.fromEntries(Object.entries(e.data).map(([k, v]) => [k, Number(v)])) } : {}),
  })
}

function unstatusOp(ctx: Ctx, e: Eff): void {
  const { run } = ctx
  const unit = who(ctx)
  if (!unit) return
  if (typeof e.status === 'string') {
    run.removeStatus(unit, e.status)
    return
  }
  const kinds = Array.isArray(e.kinds) ? e.kinds.map(String) : []
  let left = Math.max(0, qty(ctx, e.count, 1))
  for (const s of [...unit.statuses]) {
    if (left <= 0) break
    const rule = statusRuleOf(run.k.content, s.id)
    if (rule && kinds.includes(rule.kind) && run.removeStatus(unit, s.id)) left -= 1
  }
}

// ---- 檢定 ----

/** vs 可以對的三種防守值（防火牆、迴避、意志）。 */
const DEFENSES = ['firewall', 'evade', 'will'] as const

/** 一種防守值（check 的 vs）。掛著的東西只有防火牆（等於它的迴避，E5）；沒有對象、這一種算不出來回傳 null（整筆跳過）。 */
function defenseOf(ctx: Ctx, key: string, unit: BattleUnit | undefined, tags: string[]): number | null {
  const { run, user } = ctx
  if (ctx.overlay) return key === 'firewall' ? run.standIn(ctx.overlay).evade : null
  if (!unit) return null
  if (key === 'evade') return run.evadeOf(unit, user).total
  if (key === 'will') return 10 + attrMod(unit.attrs.resolve ?? 10) + (unit.skills.composure ?? 0)
  // 防火牆（dev/adr/0015 E5）：有甲板（unit.ext.deck，有 grade）用甲板的（沒寫是 10），沒有的用不含遮蔽與狀態的迴避；再加修正 firewall（問的是目標，帶這次檢定的標籤）
  const deck = unit.ext.deck
  const hasDeck = isRecord(deck) && typeof deck.grade === 'number' && Number.isFinite(deck.grade)
  const base = hasDeck ? (typeof deck.firewall === 'number' && Number.isFinite(deck.firewall) ? deck.firewall : 10) : unit.evade
  return base + run.mods('firewall', unit, user, undefined, tags).reduce((sum, p) => sum + p.value, 0)
}

/** 加值：一個數字或公式（標成「加值」），或一串 { label, value }（每一項各自標名字，檢定的明細才分得出來源）。 */
function bonusParts(ctx: Ctx, v: unknown): RollPart[] {
  if (Array.isArray(v)) return v.map((x) => ({ label: String((x as Eff).label), value: qty(ctx, (x as Eff).value, 0), source: 'skill' }))
  const bonus = qty(ctx, v, 0)
  return bonus ? [{ label: '加值', value: bonus, source: 'skill' }] : []
}

/**
 * 檢定：做的人（ctx.user）擲 1d20 ＋ mod(attr) ＋ 基本功 ＋ 修正 ＋ 加值，對 DC。對別人擲的檢定（對象不是自己）在擲之前發 check.before
 * （unit 是擲骰的人、other 是對象；對象那一邊的反應改 DC，dev/adr/0015 補記）。落在掛著的東西上：只有對防火牆的檢定擲（它沒有甲板，防火牆就是它的迴避），其餘跳過。
 * vs：數字；evade、firewall、will；{ firewall | evade | will: true, elite?, boss? }（對象是精英、首領時 DC 再加 elite、boss：快駭的控制類）；
 * { base, per_grade?, elite?, boss? }（照場景等級與位階的固定難度）。
 */
function checkOp(ctx: Ctx, e: Eff): void {
  const { run, user } = ctx
  const unit = ctx.unit
  const vs = e.vs
  const tags = Array.isArray(e.tags) ? e.tags.map(String) : []
  const named = typeof vs === 'string' ? vs : isRecord(vs) ? DEFENSES.find((d) => vs[d] === true) : undefined
  let dc: number
  if (typeof vs === 'number') {
    if (ctx.overlay) return
    dc = vs
  } else if (named) {
    // 這幾種要看對象：沒有對象（落在一格、沒有目標）就沒有東西可以對，整筆跳過
    const base = defenseOf(ctx, named, unit, tags)
    if (base === null) return
    const rank = unit?.rank
    dc = base + (isRecord(vs) && !ctx.overlay ? (rank === 'elite' ? qty(ctx, vs.elite, 0) : rank === 'boss' ? qty(ctx, vs.boss, 0) : 0) : 0)
  } else if (isRecord(vs)) {
    if (ctx.overlay) return
    const grade = unit?.grade ?? run.battle.grade
    const rank = unit?.rank
    dc = qty(ctx, vs.base, 0) + qty(ctx, vs.per_grade, 0) * grade + (rank === 'elite' ? qty(ctx, vs.elite, 0) : rank === 'boss' ? qty(ctx, vs.boss, 0) : 0)
  } else return
  const skill = typeof e.skill === 'string' ? e.skill : undefined
  const attr = e.attr as keyof BattleUnit['attrs']
  const label = typeof e.label === 'string' ? e.label : skill ? run.k.stats.skillName(skill) : run.k.stats.attrName(attr)
  const { ok } = run.save(user, attr, skill, dc, label, bonusParts(ctx, e.bonus), tags, unit && unit.id !== user.id ? unit : undefined)
  ctx.last.ok = ok
  if (e.stop === true && !ok) ctx.last.stop = true
}

// ---- 站位與遮蔽 ----

function shiftOp(ctx: Ctx, e: Eff): void {
  const unit = who(ctx)
  if (!unit) return
  const delta = e.dir === 'pull' ? -1 : 1
  for (let i = Math.max(1, qty(ctx, e.n, 1)); i > 0; i--) if (!ctx.run.shift(unit, delta, ctx.user)) break
}

function moveOp(ctx: Ctx, e: Eff): void {
  const unit = who(ctx)
  if (!unit || !onField(unit)) return
  const to = ctx.pick.slot
  if (typeof to !== 'number' || !Number.isInteger(to) || to < 1 || to > BATTLE_SLOTS) throw new BattleBlocked(['要選一格。'])
  if (to === unit.slot) return
  if (e.to === 'adjacent' && Math.abs(to - unit.slot) !== 1) throw new BattleBlocked(['只能換到相鄰的格。'])
  ctx.run.move(unit, to)
}

function swapOp(ctx: Ctx, e: Eff): void {
  const unit = who(ctx)
  if (!unit || !onField(unit)) return
  const mate = pickedUnit(ctx, e.with)
  if (!mate || mate.id === unit.id || mate.side !== unit.side || !onField(mate)) throw new BattleBlocked(['要選另一名隊友。'])
  ctx.run.move(unit, mate.slot)
}

function coverOp(ctx: Ctx, e: Eff): void {
  if (ctx.overlay) return
  const cell = cellOf(ctx)
  const levels = qty(ctx, e.levels, 0)
  if (!cell || !levels) return
  if (levels > 0) ctx.run.raiseCover(cell.side, cell.slot, levels, Array.isArray(e.max) ? [Number(e.max[0]), Number(e.max[1])] : undefined)
  else ctx.run.lowerCover(cell.side, cell.slot, -levels, ctx.user)
}

// ---- 行動點、彈匣、資源池 ----

function apOp(ctx: Ctx, e: Eff): void {
  const unit = who(ctx)
  if (!unit) return
  const now = unit.ap.now
  unit.ap.now = grow(now, qty(ctx, e.amount, 0), unit.ap.max, e.over_cap === true)
  const d = unit.ap.now - now
  if (d) ctx.run.say(`${unitTag(unit)} 行動點 ${d > 0 ? '+' : '−'}${Math.abs(d)}。`, undefined, { target: unit.id, ap: d })
}

function magOp(ctx: Ctx, e: Eff): void {
  const unit = who(ctx)
  const mag = unit ? wielded(unit)?.mag : undefined
  if (!unit || !mag) return
  const now = mag.now
  mag.now = e.amount === 'full' ? Math.max(now, mag.max) : grow(now, qty(ctx, e.amount, 0), mag.max, e.over_cap === true)
  const d = mag.now - now
  if (d) ctx.run.say(`${unitTag(unit)} 的彈匣 ${d > 0 ? '+' : '−'}${Math.abs(d)} 格。`, undefined, { target: unit.id, mag: d })
}

function poolOp(ctx: Ctx, e: Eff): void {
  const unit = who(ctx)
  const pool = unit ? unit.pools[String(e.pool)] : undefined
  if (!unit || !pool) return
  const now = pool.now
  pool.now = e.amount === 'full' ? Math.max(now, pool.max) : grow(now, qty(ctx, e.amount, 0), pool.max, false)
  const d = pool.now - now
  if (d) ctx.run.say(`${unitTag(unit)} 的${String(e.pool).toUpperCase()} ${d > 0 ? '+' : '−'}${Math.abs(d)}。`, undefined, { target: unit.id, pool: e.pool, amount: d })
}

// ---- 義體、救回來、重創、退出、場地、先攻、沉溺 ----

function implantOp(ctx: Ctx, e: Eff): void {
  const unit = who(ctx)
  if (!unit) return
  const idx = ctx.pick.implant
  const got = ctx.run.implantStatus(unit, e.mode === 'boost' ? 'boost' : 'off', {
    by: ctx.user,
    ...(typeof idx === 'number' && Number.isInteger(idx) ? { pick: idx } : {}),
    ...(typeof e.kind === 'string' ? { kind: e.kind } : {}),
    ...(e.turns !== undefined ? { turns: Math.max(1, qty(ctx, e.turns, 1)) } : {}),
    ...(typeof e.until === 'string' ? { until: e.until as (typeof STATUS_UNTILS)[number] } : {}),
  })
  ctx.last.ok = got !== null
}

function reviveOp(ctx: Ctx, e: Eff): void {
  const unit = who(ctx)
  if (unit) ctx.run.revive(unit, qty(ctx, e.hp, 1))
}

/**
 * 處理重創：treat 是輕的解除（狀態拿掉）、重的降成輕的（軀幹的生命值上限與橋的承受層數加回來；護甲失效是「直到修理」，不在這裡還）；
 * clear 是全部清掉。part 沒寫就四個部位都處理一次。
 */
function woundOp(ctx: Ctx, e: Eff): void {
  const { run } = ctx
  const unit = who(ctx)
  if (!unit) return
  const clear = e.mode === 'clear'
  const parts = typeof e.part === 'string' ? [e.part] : Object.keys(PART_NAME)
  for (const part of parts) {
    if (!isPart(part)) continue
    const level = unit.wounds[part] ?? 0
    if (!level) continue
    if (level === 2) {
      if (part === 'torso' && unit.hp) unit.hp.max += TORSO_HP_LOSS
      else if (part === 'bridge') unit.layersMax += 1
    }
    const light = part === 'bridge' ? undefined : LIGHT[part]
    if (level === 2 && !clear) {
      unit.wounds[part] = 1
      // 肢體的重創把命中改成 −4：降成輕的就回到狀態自己的數字
      if (part === 'limb') run.applyStatus(unit, 'limb_hurt', { quiet: true })
    } else {
      delete unit.wounds[part]
      if (light) run.removeStatus(unit, light, true)
    }
    run.say(`${unitTag(unit)} 的${PART_NAME[part]}${level === 2 && !clear ? '傷勢減輕了，只剩輕傷' : '傷處理好了'}。`, undefined, { target: unit.id, part, level: unit.wounds[part] ?? 0 })
  }
}

function outOp(ctx: Ctx, e: Eff): void {
  const unit = who(ctx)
  if (unit) ctx.run.setOut(unit, e.how === 'fled' ? 'fled' : 'surrendered', ctx.user)
}

const FIELD_WORD: Record<string, [string, string]> = { dark: ['場上的燈滅了：全場迴避 +2，有夜視的不受影響。', '燈亮了，黑暗散去。'] }
function fieldOp(ctx: Ctx, e: Eff): void {
  const key = String(e.key)
  const value = e.value === undefined ? true : e.value === true
  const field = ctx.run.battle.field
  if (!!field[key] === value) return
  field[key] = value
  ctx.run.say(FIELD_WORD[key]?.[value ? 0 : 1] ?? `${key}：${value ? '開' : '關'}。`, 'field', { key, value })
}

/**
 * 先攻對調：對象和 pick[with] 兩個人換順位。act_next（dev/adr/0015 E7）：被換到前面的那一個（對調之前排比較後面的），
 * **對調之前**這一輪還沒動過的話馬上輪到他（排在現在這一位後面）；已經動過的只換順位；兩種都讓他拿回 1 點行動點（不超過上限）。
 * 「一個動過、一個沒動過」的對調：動過的那一個被換到後面，原本沒動過、被換到前面的那一個接著動。
 */
function orderOp(ctx: Ctx, e: Eff): void {
  const { run } = ctx
  const unit = who(ctx)
  if (!unit) return
  const mate = pickedUnit(ctx, e.with)
  if (!mate || mate.id === unit.id) throw new BattleBlocked(['要選另一個人來對調行動的順序。'])
  // 對調之後，排在前面的是對調之前排在後面的那一個；他動過沒有要在對調之前問
  const order = run.battle.order
  const front = order.indexOf(unit.id) > order.indexOf(mate.id) ? unit : mate
  const acted = run.hasActed(front)
  if (!run.swapOrder(unit, mate)) throw new BattleBlocked(['要選另一個人來對調行動的順序。'])
  if (e.act_next !== true) return
  run.actNext(front, { acted })
  run.refund(front, 1)
}

function sinkOp(ctx: Ctx, e: Eff): void {
  const { run, user } = ctx
  const unit = who(ctx)
  if (!unit) return
  const sv = e.save
  if (isRecord(sv)) {
    const skill = typeof sv.skill === 'string' ? sv.skill : undefined
    const attr = sv.attr as keyof BattleUnit['attrs']
    const { ok } = run.save(unit, attr, skill, qty(ctx, sv.dc, 10), skill ? run.k.stats.skillName(skill) : run.k.stats.attrName(attr), [], ['sink'], unit.id !== user.id ? user : undefined)
    if (ok) return
  }
  const add = Math.max(0, qty(ctx, e.amount, 0))
  if (!add) return
  unit.sink += add
  run.say(`${unitTag(unit)} 沉溺 +${add}。`, undefined, { target: unit.id, sink: add })
}

// ---- 登錄 ----

const SAVE = shape({ attr: ATTR, skill: S, dc: F, tags: list(S) }, ['attr', 'dc'])
const SINK_SAVE = shape({ attr: ATTR, skill: S, dc: F }, ['attr', 'dc'])
const VS = (v: unknown): string | null => {
  if (typeof v === 'number') return Number.isFinite(v) ? null : '要是有限的數字'
  if (typeof v === 'string') return oneOf(DEFENSES)(v)
  if (isRecord(v)) {
    const named = DEFENSES.filter((d) => v[d] !== undefined)
    if (named.length > 1) return `${DEFENSES.join('、')} 只能寫一個`
    if (named.length === 1) {
      if (v[named[0]!] !== true) return `${named[0]!}：要是 true`
      return shape({ firewall: B, evade: B, will: B, elite: F, boss: F })(v)
    }
  }
  return shape({ base: F, per_grade: F, elite: F, boss: F }, ['base'])(v)
}
const BONUS = (v: unknown): string | null => (Array.isArray(v) ? list(shape({ label: S, value: F }, ['label', 'value']))(v) : F(v))

export function registerOps(k: Kernel): void {
  const op = (name: string, fn: (ctx: Ctx, e: Eff) => void, problems: (e: Eff) => string[]): void => k.battle.effect(name, OWNER, fn, { problems })

  op('attack', attackOp, schema({
    hit: F, dice: F, damage: F, pierce: F, type: TYPE, aimed: B, spend: orWord('all'), cover_shift: F, cover_mult_min: num(0), no_cover: B, no_wound: B, auto_crit: B,
    armor_mult: num(0), as: shape({ attr: ATTR, skill: S }, ['attr', 'skill']), label: S, tags: list(S),
  }))
  op('strike', strikeOp, schema({
    dice: F, type: TYPE, hit: F, range: pair, pierce: F, cover_mult: num(0),
    natural: (v) => (v === true || (Number.isInteger(v) && (v as number) >= 1 && (v as number) <= 20) ? null : '要是 true（擲一次、每個落點共用）或 1～20 的整數'),
    label: S, traits: list(S),
  }, ['dice']))
  op('damage', damageOp, schema({ amount: F, type: TYPE, pierce: F }, ['amount']))
  op('load', loadOp, schema({ amount: F, type: oneOf(['neural', 'pleasure']), exact: B }, ['amount']))
  op('heal', (ctx, e) => {
    const u = who(ctx)
    if (u) ctx.run.heal(u, qty(ctx, e.amount, 0), ctx.user, healTags(ctx))
  }, schema({ amount: F }, ['amount']))
  op('vent', (ctx, e) => {
    const u = who(ctx)
    if (u) ctx.run.vent(u, qty(ctx, e.amount, 0), ctx.user, healTags(ctx))
  }, schema({ amount: F }, ['amount']))
  op('afterglow', afterglowOp, schema({ amount: F, layers: F }, [], [['amount', 'layers']]))
  op('status', statusOp, schema({ status: S, turns: F, until: UNTIL, data: (v) => (isRecord(v) && Object.values(v).every((x) => typeof x === 'number' && Number.isFinite(x)) ? null : '要是「名字 → 數字」的物件'), save: SAVE }, ['status']))
  op('unstatus', unstatusOp, schema({ status: S, kinds: list(oneOf(STATUS_KINDS)), count: F }, [], [['status', 'kinds']]))
  op('cleanse', ({ run, unit }, e) => {
    if (!unit || run.isStandIn(unit)) return
    if (typeof e.by === 'string') run.cleanse(unit, e.by)
    else if (typeof e.status === 'string') run.removeStatus(unit, e.status)
  }, schema({ by: S, status: S }, [], [['by', 'status']]))
  // also: true：目標那一格之外，再加玩家選的相鄰一格（pick.also；煙霧彈 III 級的兩格）。目標在邊上又沒選時，只有一個相鄰的格就用它
  op('soft_cover', ({ run, target, pick }, e) => {
    if (!target || !('slot' in target)) return
    const rounds = typeof e.rounds === 'number' ? e.rounds : undefined
    run.softCover(target.side, target.slot, String(e.kind), rounds)
    if (e.also !== true) return
    run.softCover(target.side, adjacentPick(pick.also, target.slot), String(e.kind), rounds)
  }, schema({ kind: S, rounds: num(1), also: B }, ['kind']))
  op('check', checkOp, schema({ attr: ATTR, skill: S, vs: VS, bonus: BONUS, tags: list(S), label: S, stop: B }, ['attr', 'vs']))
  op('shift', shiftOp, schema({ dir: oneOf(['push', 'pull']), n: F }, ['dir']))
  op('move', moveOp, schema({ to: oneOf(['pick', 'adjacent']) }, ['to']))
  op('swap', swapOp, schema({ with: S }, ['with']))
  op('cover', coverOp, schema({ levels: F, max: pair }, ['levels']))
  op('ap', apOp, schema({ amount: F, over_cap: B }, ['amount']))
  op('mag', magOp, schema({ amount: orWord('full'), over_cap: B }, ['amount']))
  op('pool', poolOp, schema({ pool: S, amount: orWord('full') }, ['pool', 'amount']))
  op('implant', implantOp, schema({ mode: oneOf(['off', 'boost']), kind: S, turns: F, until: UNTIL }, ['mode']))
  op('revive', reviveOp, schema({ hp: F }))
  op('wound', woundOp, schema({ mode: oneOf(['treat', 'clear']), part: oneOf(WOUND_PARTS.map((p) => p.id)) }, ['mode']))
  op('out', outOp, schema({ how: oneOf(['surrendered', 'fled']) }, ['how']))
  op('field', fieldOp, schema({ key: oneOf(['dark']), value: B }, ['key']))
  op('order', orderOp, schema({ with: S, act_next: B }, ['with']))
  op('sink', sinkOp, schema({ amount: F, save: SINK_SAVE }, ['amount']))
}
