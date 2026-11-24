// L6 功能 combat：武器的附帶效果 fx 與特殊彈（dev/work/M1b-ordnance.md 第一、二節；ITEMS 5.1 節）。
// fx 放在 BattleWeapon.ext.fx（敵人資料的武器寫 fx，之後零件也給得出來），特殊彈的物品寫 ammo: { fits, fx }；兩個同時有就合起來
// （數字相加、清單接起來、type 以彈為準）。全部讀格式，不看武器的類型或物品的 id。
//
// - 每一擊都帶的（hit、dice、pierce、armor_mult、type、cover_mult_min、no_cover、silent）：在 attack.before 加進這一擊的 opts。
// - on_hit：命中而且造成傷害之後做的效果清單（attack.after）；on_use：命中骰擲出自然 1 時的代價（ITEMS 2.9、2.10 節；ENEMY_ROSTER）：
//   `jam: 'natural1'` 卡彈——那一擊照常結算（自然 1 本來就失手），之後彈匣清空、標 ext.jammed，要換彈才能再射（換彈清掉）；
//   `backfire: { dice }` 炸膛——開槍的人自己受 dice 顆 d6 的物理傷害。兩個都寫就都發生。在 attack.after（改打掛著的東西是 attack.redirected）
//   看這一擊的自然骰面，所以每一種打人的方式都吃得到（技能效果清單的 { op: 'attack' }、反應、打掛著的東西）；沒有彈匣的武器不卡彈。
// - 特殊彈打空了，weapon.ammo 清掉（那一件已經在換彈時用掉了）；戰鬥結束時沒打完的作廢（BattleWeapon 不寫回快取格）。

import type { AttackOpts, AttackResult, BattleRun, BattleUnit, BattleWeapon, ItemEntry, Kernel } from '../../core'
import { isRecord, unitTag } from '../../core'
import { B, S, TYPE, list, num, oneOf, shape } from './schema'

const OWNER = 'combat'
type Eff = Record<string, unknown>

/** 武器的附帶效果（資料的格式）。 */
export interface Fx {
  hit?: number
  dice?: number
  pierce?: number
  armor_mult?: number
  type?: string
  cover_mult_min?: number
  no_cover?: boolean
  on_hit?: Eff[]
  on_use?: { jam?: 'natural1'; backfire?: { dice: number } }
  silent?: boolean
}

/** 物品的 ammo 欄位：能裝在哪幾類武器上，與裝上之後的附帶效果。 */
export interface AmmoDef {
  fits: string[]
  fx: Fx
}
export type AmmoItem = ItemEntry & { ammo?: AmmoDef }

// ---- 格式檢查 ----

const int: (v: unknown) => string | null = (v) => (typeof v === 'number' && Number.isInteger(v) ? null : '要是整數')

/**
 * 檢查一份 fx：欄位的型別、不認得的欄位、on_hit 的每一筆效果（op 查得到、欄位對）。回傳每一個問題，空的就是合格。
 * k.battle.effectProblems 只有在內容載入完（功能都裝好）之後才完整，所以由 ready 呼叫。
 */
export function fxProblems(k: Kernel, fx: unknown): string[] {
  const out: string[] = []
  const spec = {
    hit: int, dice: int, pierce: int, armor_mult: num(0), type: TYPE, cover_mult_min: num(0), no_cover: B, silent: B,
    on_hit: list((v) => (isRecord(v) ? null : '每一筆要是 { op, ... }')),
    on_use: shape({ jam: oneOf(['natural1']), backfire: shape({ dice: (v) => (typeof v === 'number' && Number.isInteger(v) && v >= 1 ? null : '要是 1 以上的整數（骰幾顆 d6）') }, ['dice']) }),
  }
  const why = shape(spec)(fx)
  if (why) return [why]
  const e = fx as Fx
  if (e.on_hit !== undefined) out.push(...k.battle.effectProblems(e.on_hit).map((m) => `on_hit：${m}`))
  return out
}

/** 一件物品的 ammo 欄位格式：fits 是武器類型的清單（至少一個）、fx 是一份 fx。沒有 ammo 欄位的物品沒有問題。 */
export function ammoProblems(k: Kernel, entry: Record<string, unknown>): string[] {
  if (entry.ammo === undefined) return []
  const why = shape({ fits: list(S), fx: () => null }, ['fits', 'fx'])(entry.ammo)
  if (why) return [`ammo：${why}`]
  const a = entry.ammo as { fits: unknown[]; fx: unknown }
  const out: string[] = []
  if (a.fits.length === 0) out.push('ammo：fits 至少要寫一種武器的類型')
  out.push(...fxProblems(k, a.fx).map((m) => `ammo.fx：${m}`))
  return out
}

// ---- 讀 fx ----

/** 一把武器現在裝的特殊彈（查得到、有 ammo 欄位才算）。 */
export function ammoOf(k: Pick<Kernel, 'content'>, w: BattleWeapon): { id: string; item: AmmoItem; def: AmmoDef } | undefined {
  if (!w.ammo) return undefined
  const item = k.content.get<AmmoItem>('item', w.ammo)
  return item?.ammo ? { id: w.ammo, item, def: item.ammo } : undefined
}

const sum = (a: number | undefined, b: number | undefined): number | undefined => (a === undefined && b === undefined ? undefined : (a ?? 0) + (b ?? 0))

/** 兩份 fx 合起來：數字相加（armor_mult 是倍率，相乘；炸膛的骰數相加）、on_hit 接起來、type 以後面（彈）為準、旗標與卡彈有一個就算。 */
export function mergeFx(a: Fx | undefined, b: Fx | undefined): Fx | undefined {
  if (!a) return b
  if (!b) return a
  const jam = a.on_use?.jam ?? b.on_use?.jam
  const bf = a.on_use?.backfire || b.on_use?.backfire ? { dice: sum(a.on_use?.backfire?.dice, b.on_use?.backfire?.dice)! } : undefined
  const out: Fx = {}
  for (const key of ['hit', 'dice', 'pierce', 'cover_mult_min'] as const) {
    const v = sum(a[key], b[key])
    if (v !== undefined) out[key] = v
  }
  // 護甲倍率是倍率：武器自己的 ×2 加上空尖彈的 ×2 是 ×4，不是 ×4 的巧合（×2 加 ×1.5 是 ×3，不是 ×3.5）
  if (a.armor_mult !== undefined || b.armor_mult !== undefined) out.armor_mult = (a.armor_mult ?? 1) * (b.armor_mult ?? 1)
  const type = b.type ?? a.type
  if (type !== undefined) out.type = type
  if (a.no_cover || b.no_cover) out.no_cover = true
  if (a.silent || b.silent) out.silent = true
  const on_hit = [...(a.on_hit ?? []), ...(b.on_hit ?? [])]
  if (on_hit.length) out.on_hit = on_hit
  if (jam !== undefined || bf) out.on_use = { ...(jam !== undefined ? { jam } : {}), ...(bf ? { backfire: bf } : {}) }
  return out
}

/** 這把武器現在的 fx：自己的（ext.fx）加上裝著的特殊彈的。都沒有就是 undefined。 */
export function fxOf(k: Pick<Kernel, 'content'>, w: BattleWeapon): Fx | undefined {
  const own = isRecord(w.ext?.fx) ? (w.ext!.fx as Fx) : undefined
  return mergeFx(own, ammoOf(k, w)?.def.fx)
}

/** 每一擊都帶的欄位加進這一擊的 opts（attack.before 與打掛著的東西的射擊共用）。 */
export function applyFx(opts: AttackOpts, fx: Fx): void {
  if (fx.hit) opts.hit = (opts.hit ?? 0) + fx.hit
  if (fx.dice) opts.dice = (opts.dice ?? 0) + fx.dice
  if (fx.pierce) opts.pierce = (opts.pierce ?? 0) + fx.pierce
  if (fx.armor_mult !== undefined) opts.armorMult = (opts.armorMult ?? 1) * fx.armor_mult
  // 這一擊已經指定了傷害類型（技能的攻擊）就不蓋掉
  if (fx.type !== undefined && opts.type === undefined) opts.type = fx.type as AttackOpts['type']
  if (fx.cover_mult_min !== undefined) opts.coverMultMin = Math.max(opts.coverMultMin ?? 0, fx.cover_mult_min)
  if (fx.no_cover) opts.noCoverDamage = true
  if (fx.silent) opts.tags = [...(opts.tags ?? []), 'silent']
  if (ownsSink(fx.on_hit)) opts.noSink = true
}

/**
 * 一串命中效果（on_hit）裡有沒有帶定力檢定的 sink：有的話，傷害類型自己帶的沉溺（快感 +1）這一擊不加（AttackOpts.noSink），
 * 由那一筆 sink 效果決定——定力檢定過了就擋掉，沒過才加（COMBAT_SYSTEM 第 5 節：定力擋得掉沉溺那一部分）。
 */
export function ownsSink(on_hit: Eff[] | undefined): boolean {
  return !!on_hit?.some((e) => e.op === 'sink' && e.save !== undefined)
}

// ---- 彈匣打空：特殊彈作廢 ----

/** 彈匣空了而且裝著特殊彈：清掉（那一件在換彈時已經用掉了）。 */
export function settleAmmo(w: BattleWeapon): void {
  if (w.ammo && w.mag && w.mag.now <= 0) delete w.ammo
}

// ---- 擲出自然 1：卡彈與炸膛 ----

/**
 * 這一擊的命中骰是自然 1 時，付 on_use 的代價（ITEMS 2.9、2.10 節）。那一擊已經照常結算（失手）；
 * 卡彈：彈匣清空、標 ext.jammed（換彈清掉），沒有彈匣的武器不卡彈；炸膛：開槍的人自己受 dice 顆 d6 的物理傷害
 * （開槍的是和人重疊的東西的替身時，傷在那一台的耐久上）。沒有發生的一擊（aborted）與沒有擲命中骰的（natural 是 0）不算。
 */
function misfire(run: BattleRun, attacker: BattleUnit, w: BattleWeapon, result: AttackResult): void {
  // 彈匣與炸膛只有現實才有（內海的武器是構裝，沒有彈匣）
  if (run.mode.layer !== 'meat') return
  if (result.aborted || result.natural !== 1) return
  const use = fxOf(run.k, w)?.on_use
  if (!use) return
  if (use.jam && w.mag) {
    w.mag.now = 0
    w.ext = { ...w.ext, jammed: true }
    settleAmmo(w)
    run.say(`${unitTag(attacker)} 的${w.name}卡彈了，要換彈才能再射。`, undefined, { unit: attacker.id, weapon: w.class, jam: true }, attacker)
  }
  if (use.backfire && !run.over) {
    run.say(`${unitTag(attacker)} 的${w.name}炸膛了！`, undefined, { unit: attacker.id, weapon: w.class, backfire: true }, attacker)
    const dealt = run.d6(use.backfire.dice)
    const hung = run.isStandIn(attacker) ? run.overlayOfStandIn(attacker) : undefined
    if (hung) run.damageOverlay(hung, dealt, 'physical')
    else run.damage(attacker, dealt, 'physical')
  }
}

/** 換彈：卡彈的標記清掉（彈匣由換彈自己補滿）。 */
export function clearJam(w: BattleWeapon): void {
  if (w.ext?.jammed) {
    const { jammed: _gone, ...rest } = w.ext
    w.ext = rest
  }
}

/** 這把武器卡彈了（要先換彈）。 */
export const isJammed = (w: BattleWeapon): boolean => w.ext?.jammed === true

// ---- 命中之後 ----

/**
 * 命中而且造成了傷害之後做 fx.on_hit（沒中、被護甲擋光、被取消的不做）。效果的 who 預設是被打的人；來源是這把武器。
 * 打在和人重疊的東西上時，目標是那一台（大部分的效果對它沒有作用）。
 * 快感傷害自己會加沉溺；on_hit 裡有帶檢定的 sink 時，這一擊在 attack.before 就標成 noSink（ownsSink），由那一筆決定（定力擋得掉沉溺那一部分）。
 */
export function runOnHit(run: BattleRun, user: BattleUnit, target: BattleUnit, w: BattleWeapon, result: AttackResult, on_hit: Eff[] | undefined): void {
  if (!on_hit?.length || !result.hit || result.dealt <= 0 || result.negated || result.aborted) return
  const overlay = run.isStandIn(target) ? run.overlayOfStandIn(target) : undefined
  run.effects(on_hit, {
    user, target: overlay ? { overlay: overlay.id } : { unit: target.id }, source: { kind: 'weapon', id: w.id, name: w.name },
    last: { hit: true, crit: result.crit, downed: result.downed, dealt: result.dealt },
  })
}

// ---- 登錄 ----

export function registerFx(k: Kernel): void {
  k.battle.on('attack.before', OWNER, ({ run, weapon, opts }) => {
    const fx = fxOf(run.k, weapon)
    if (fx) applyFx(opts, fx)
  })
  // 被取消的一擊（別的功能設了 opts.cancel）：彈匣因此空了的特殊彈作廢
  k.battle.on('attack.cancel', OWNER, ({ weapon }) => settleAmmo(weapon))
  k.battle.on('attack.after', OWNER, ({ run, attacker, target, weapon, result }) => {
    const fx = fxOf(run.k, weapon)
    if (fx?.on_hit) runOnHit(run, attacker, target, weapon, result, fx.on_hit)
    // 命中骰自然 1：卡彈、炸膛（用 fx 讀特殊彈的，所以在彈匣作廢之前）
    misfire(run, attacker, weapon, result)
    // 這一擊把彈匣打空了：特殊彈作廢
    settleAmmo(weapon)
  })
  // 改打掛著的東西（立牌、擋槍的無人機）的一擊不發 attack.after：自然 1 的代價照付
  k.battle.on('attack.redirected', OWNER, ({ run, attacker, weapon, result }) => {
    misfire(run, attacker, weapon, result)
    settleAmmo(weapon)
  })
  // 改打別的東西（立牌）的一擊不發 attack.after：行動做完時再看一次彈匣
  k.battle.on('action.done', OWNER, ({ weapon }) => {
    if (weapon) settleAmmo(weapon)
  })
}
