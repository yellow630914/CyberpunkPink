// 反應：條件成立時自動觸發（SKILLS 1.2 節）。規格：dev/work/M1b-skill-format.md 第四節。
// 兩種寫法並存：舊的 meat.trigger 字串（掩護射擊、小心後面！：隊友被攻擊、擲命中之前），和新的 { on, who, if? }。
// 觸發時：先扣消耗（行動點用反應的人手上剩的，不夠就不觸發）、記次數、記一拍，再做 react（改這一擊／這次檢定／這次退出）與 do（效果清單）。
// 帶 reaction 標籤的攻擊、以及反應自己的效果裡做出來的攻擊，都不再觸發反應。

import type { AttackOpts, AttackResult, BattleRun, BattleUnit, BattleWeapon, Kernel } from '../../core'
import { amount, FLASH, LOSE_TURN, isWounded, onField, unitsOf } from '../../core'
import { colIn, layerOf } from './column'
import { heldGun, needsBlocks, rangeBlock, whenBlocks } from './conditions'
import { requestMove } from './social'
import { adminNeed, bumpUses, costOf, usageBlocks } from './use'
import { syncWallet } from './wallet'
import type { AbilityEntry, ReactDef, TriggerDef } from './types'
import { OWNER } from './types'
import { equippedOf, isRec, linkedIds, tierIn } from './unitdata'

/** 正在做某個反應的效果：這段時間裡發生的攻擊不再觸發反應。 */
const reacting = new WeakSet<BattleRun>()
export const inReaction = (run: BattleRun): boolean => reacting.has(run)

interface Event {
  /** 遇到這件事的人：被打的、過載的、檢定是對他擲的（拿 DC 的那一方：被快駭、被誘惑的人）、要退出的 */
  subject: BattleUnit
  /** 對他做這件事的人：攻擊的人、讓他過載的人、擲檢定的人（DC 加多少就是讓他更難）、讓他退出的人 */
  by?: BattleUnit
  opts?: AttackOpts
  roll?: { wound: boolean; crit?: boolean }
  out?: { negate?: boolean; wound?: boolean; prevent?: boolean }
  how?: string
  tags?: string[]
  check?: { dc: number; bonus: number }
  result?: AttackResult
  weapon?: BattleWeapon
  /** overload 專用：內海的閃斷（歸零的是哪一池、歸零之前有多少；現實的過載沒有） */
  flash?: { pool: string; before: number }
}

const sideMates = (run: BattleRun, a: BattleUnit): BattleUnit[] => unitsOf(run.battle, a.side)

/**
 * 這個人的一台（沒被擊落的），掛在 subject 同一格或相鄰 reach 格以內；同一格的優先。
 * reach 預設：with_own_overlay（和他同一格）是 0，其餘的 who（ally、adjacent……）寫 redirect 時是 1（掛在同一格或相鄰一格；M1b-skill-format 的寫法）；
 * react.reach 可以明寫（攔截：1）。
 */
function overlayFor(run: BattleRun, holder: BattleUnit, subject: BattleUnit, reach: number) {
  const mine = run.battle.overlays.filter((o) => !o.down && o.owner === holder.id && o.side === holder.side && Math.abs(o.slot - subject.slot) <= reach)
  return mine.sort((a, b) => Math.abs(a.slot - subject.slot) - Math.abs(b.slot - subject.slot))[0]
}
const reachOf = (trig: TriggerDef, react: ReactDef | undefined): number => react?.reach ?? (trig.who === 'with_own_overlay' ? 0 : 1)

/** 替身對應的那一台的操作者（被擊落的也找得到：被擊落的那一擊之後的反應要認得是誰的）。 */
const ownerOfStandIn = (run: BattleRun, s: BattleUnit): string | undefined => run.battle.overlays.find((o) => o.id === s.ext.overlay)?.owner

function whoMatches(run: BattleRun, holder: BattleUnit, who: string, e: Event, reach: number): boolean {
  const s = e.subject
  const mate = s.side === holder.side
  switch (who) {
    case 'self': return s === holder
    case 'adjacent': return mate && s !== holder && onField(s) && Math.abs(s.slot - holder.slot) === 1
    case 'ally': return mate && s !== holder
    case 'self_or_ally': return mate
    // 偶像接著的隊友（同步中）：holder 的 link 名單裡有他（M3-skill-net-b）
    case 'linked': return mate && s !== holder && linkedIds(holder).includes(s.id)
    case 'near': return mate && onField(s) && Math.abs(s.slot - holder.slot) <= 1
    case 'foe_by_self': return !mate && e.by === holder
    // 自己的一台被打（敢打我家孩子？）：被打的是自己的無人機（替身）
    case 'own_overlay': return run.isStandIn(s) && ownerOfStandIn(run, s) === holder.id
    // 被打的是（自己或隊友）那一格掛著自己的一台（掩護飛行、攔截、穹頂）
    case 'with_own_overlay': return mate && onField(s) && !run.isStandIn(s) && !!overlayFor(run, holder, s, reach)
    default: return false
  }
}

/** 做這件事的人要符合的條件（trigger.by）：沒有「做的人」的事不觸發。 */
function byHolds(run: BattleRun, holder: BattleUnit, by: NonNullable<TriggerDef['by']>, e: Event): boolean {
  if (!e.by) return false
  if (needsBlocks(run, e.by, by.needs).length) return false
  return !rangeBlock(holder, e.by.slot, by.range)
}

function ifHolds(cond: string | undefined, on: string, e: Event): boolean {
  if (cond === undefined) return true
  if (on === 'hit') return (cond === 'wound' && !!e.roll?.wound) || (cond === 'crit' && !!e.roll?.crit)
  if (on === 'after') {
    switch (cond) {
      case 'miss': return e.result?.hit === false
      case 'hit': return e.result?.hit === true
      case 'crit': return e.result?.crit === true
      case 'melee': return !!e.weapon?.traits.includes('melee')
      case 'bridged': return !!e.subject.load
    }
    return false
  }
  if (on === 'checked') return !!e.tags?.includes(cond)
  return true
}

/** 數字或公式（不擲骰）。 */
function num(run: BattleRun, holder: BattleUnit, ab: AbilityEntry, v: number | string | undefined): number {
  if (v === undefined) return 0
  return typeof v === 'number' ? v : Math.round(amount({ run, user: holder, n: { tier: tierIn(holder, ab.path) } }, v))
}

/** 一個反應成立之後的事（改這一擊、這次檢定、這次退出）。 */
function applyReact(run: BattleRun, holder: BattleUnit, ab: AbilityEntry, on: string, r: ReactDef | undefined, e: Event, reach: number): void {
  if (!r) return
  if (on === 'attacked' && e.opts) {
    if (r.evade !== undefined) e.opts.evade = (e.opts.evade ?? 0) + num(run, holder, ab, r.evade)
    if (r.hit !== undefined) e.opts.hit = (e.opts.hit ?? 0) + num(run, holder, ab, r.hit)
    if (r.no_wound) e.opts.noWound = true
    if (r.damage !== undefined) e.opts.damage = (e.opts.damage ?? 0) + num(run, holder, ab, r.damage)
    if (r.redirect === 'overlay') {
      const o = overlayFor(run, holder, e.subject, r.reach ?? reach)
      if (o) e.opts.redirect = { overlay: o.id }
    }
  } else if (on === 'hit' && e.out) {
    if (r.negate) e.out.negate = true
    // 替身：這一擊沒有傷害，結算完（遮蔽也傷過了）被打的人換到相鄰的一格
    if (r.then_move) requestMove(e.subject)
    if (r.no_wound) e.out.wound = false
    // 這一擊的穿甲（傷害還沒算：獵殺節奏）
    if (r.pierce !== undefined && e.opts) e.opts.pierce = (e.opts.pierce ?? 0) + num(run, holder, ab, r.pierce)
  } else if (on === 'overload') {
    if (r.keep_turn) run.removeStatus(e.subject, LOSE_TURN, true)
    // 偶像：這一次過載同步不斷開（大家不要走；features/abilities/link.ts 的 overload 掛點讀這個記號）
    if (r.keep_link) e.subject.uses.link_keep = 1
    // 內海的閃斷：RAM 補回去（一半、原本的、滿的）、拿掉閃斷的狀態（死線、逆流、急凍）
    if (r.flash && e.flash) {
      const pool = e.subject.pools[e.flash.pool]
      if (pool && r.flash.ram) {
        const back = r.flash.ram === 'full' ? pool.max : r.flash.ram === 'before' ? e.flash.before : Math.ceil(e.flash.before / 2)
        pool.now = Math.min(pool.max, Math.max(pool.now, back))
      }
      if (r.flash.end) run.removeStatus(e.subject, FLASH, true)
    }
  } else if (on === 'checked' && e.check) {
    if (r.dc !== undefined) e.check.dc += num(run, holder, ab, r.dc)
  } else if (on === 'out_before' && e.out && r.prevent) {
    e.out.prevent = true
    // 因為生命歸零而來的，核心擋下之後生命至少 1；餘韻疊滿再過載而來的（burnout）核心只把感載歸零，要停在哪裡由這裡定：
    // 感載停在上限 −1、餘韻不再疊（過載的這一步還沒疊），留在戰鬥裡（還不准睡）
    if (e.how === 'burnout' && e.subject.load) e.subject.load.now = Math.max(0, e.subject.load.max - 1)
  }
}

/**
 * 這個反應現在有沒有東西可做（沒有就不觸發、不扣消耗）。
 * do 裡有「朝攻擊的人開火」（drone.act、at: attacker：敢打我家孩子？）時，攻擊的人要是還在場上的敵人：
 * 砲塔、沒有操作者的無人機（替身）不算——技能寫的是「敵人…朝他射擊」（SKILL_TREES 機師），打機器沒有寫，不觸發也不花行動點與次數。
 */
function hasWork(run: BattleRun, holder: BattleUnit, on: string, m: { react?: ReactDef; do?: Array<Record<string, unknown>> }, e: Event, reach: number): boolean {
  const r = m.react
  if (m.do?.some((x) => x.op === 'drone.act' && x.at === 'attacker') && !(e.by && !run.isStandIn(e.by) && e.by.side !== holder.side && onField(e.by))) return false
  if (!r) return true
  if (r.redirect === 'overlay' && (run.isStandIn(e.subject) || !overlayFor(run, holder, e.subject, r.reach ?? reach))) return false
  if (r.prevent && !(e.how && r.prevent.how.includes(e.how))) return false
  if (on === 'out_before' && e.out?.prevent) return false
  return true
}

/** 對一件事，每個裝著對應反應的人各問一次。 */
function fire(run: BattleRun, on: TriggerDef['on'], e: Event): void {
  if (reacting.has(run) || run.over) return
  if (e.opts?.tags?.includes('reaction')) return
  // 攻擊類的事只對敵人的攻擊（隊友誤傷不算）
  if ((on === 'attacked' || on === 'hit' || on === 'after') && e.by && e.by.side === e.subject.side) return
  for (const holder of [...unitsOf(run.battle, 'ally'), ...unitsOf(run.battle, 'foe')]) {
    if (!onField(holder)) continue
    for (const ab of equippedOf(run, holder)) {
      // 照戰場選欄；專屬構裝淺檔不生效（沒有欄就是沒有反應）
      const m = colIn(run, holder, ab)
      const t = m?.trigger
      if (!m || !isRec(t) || (t as TriggerDef).on !== on) continue
      const trig = t as TriggerDef
      // 掛著的東西被打也會發掛點（target 是替身）：只有 who: own_overlay 的反應管它；管人的（self、adjacent、near、ally、with_own_overlay）不管替身
      if (run.isStandIn(e.subject) && trig.who !== 'own_overlay' && trig.who !== 'foe_by_self') continue
      const reach = reachOf(trig, m.react)
      if (!whoMatches(run, holder, trig.who, e, reach) || !ifHolds(trig.if, on, e)) continue
      if (trig.tag !== undefined && !(e.opts?.tags ?? []).includes(trig.tag)) continue
      if (trig.by && !byHolds(run, holder, trig.by, e)) continue
      if (whenBlocks(run, holder, m.when).length) continue
      if (!hasWork(run, holder, on, m, e, reach)) continue
      if (usageBlocks(run, holder, ab).length) continue
      const cost = costOf(run, holder, ab)
      if (!run.canAfford(holder, cost)) continue
      run.spend(holder, cost)
      syncWallet(run)
      bumpUses(holder, ab, layerOf(run))
      if (adminNeed(ab, layerOf(run)) > 0) run.effects([{ op: 'net.admin_spend', who: 'self', n: adminNeed(ab, layerOf(run)), amount: adminNeed(ab, layerOf(run)) }], { user: holder, target: { unit: holder.id }, source: { kind: 'ability', id: ab.id, name: ab.name }, n: { tier: tierIn(holder, ab.path) } })
      run.say(`${holder.name}：${ab.name}。`, 'skill', { unit: holder.id, ability: ab.id, ally: e.subject.id }, holder)
      applyReact(run, holder, ab, on, m.react, e, reach)
      if (m.do?.length) {
        reacting.add(run)
        try {
          const standIn = run.isStandIn(e.subject)
          run.effects(m.do, {
            user: holder, target: standIn ? { overlay: e.subject.id } : { unit: e.subject.id }, source: { kind: 'ability', id: ab.id, name: ab.name },
            n: { tier: tierIn(holder, ab.path) }, ...(e.by ? { attacker: e.by } : {}), victim: e.subject,
          })
        } finally {
          reacting.delete(run)
        }
      }
      if (run.over || (e.by && run.gone(e.by)) || e.subject.out) return
    }
  }
}

// ---- 舊的寫法：掩護射擊、小心後面！ ----

/** 隊友被攻擊、擲命中之前（SKILL_TREES：掩護射擊、小心後面！）。 */
function legacy(run: BattleRun, attacker: BattleUnit, target: BattleUnit, opts: AttackOpts): void {
  if (opts.tags?.includes('reaction') || attacker.side === target.side || reacting.has(run) || run.isStandIn(target)) return
  for (const mate of sideMates(run, target)) {
    if (mate.id === target.id) continue
    for (const ab of equippedOf(run, mate)) {
      const m = colIn(run, mate, ab)
      if (typeof m?.trigger !== 'string') continue
      if (run.gone(attacker) || target.out || run.over) return
      if (m.trigger === 'ally_attacked_adjacent' && Math.abs(mate.slot - target.slot) !== 1) continue
      if (usageBlocks(run, mate, ab).length) continue
      const cost = costOf(run, mate, ab)
      if (!run.canAfford(mate, cost)) continue
      if (m.attack) {
        const w = heldGun(mate)
        if (!w || (w.mag && w.mag.now < 1)) continue
      }
      run.spend(mate, cost)
      syncWallet(run)
      bumpUses(mate, ab, layerOf(run))
      run.say(`${mate.name}：${ab.name}。`, 'skill', { unit: mate.id, ability: ab.id, ally: target.id }, mate)
      if (m.evade) opts.evade = (opts.evade ?? 0) + m.evade
      if (m.attack) {
        const r = run.attack(mate, attacker, { label: ab.name, tags: ['reaction'] })
        if (r.hit && m.on_hit?.hit_against_ally) opts.hit = (opts.hit ?? 0) + m.on_hit.hit_against_ally
      }
    }
  }
}

// ---- 第一次低於一半生命 ----

/** 場上有沒有人裝著 hp_half 的反應（沒有就不用看：也不在單位身上記號）。 */
function anyHalfReaction(run: BattleRun): boolean {
  return Object.values(run.battle.units).some((u) => equippedOf(run, u).some((ab) => { const m = colIn(run, u, ab); return isRec(m?.trigger) && (m!.trigger as TriggerDef).on === 'hp_half' }))
}

/**
 * hp_half 的反應裡「是誰害的」（do 裡 who: attacker 要用）：剛打傷他的人（還在場上的敵人）；不是被打傷的（流血、燃燒、效果），
 * 就是對面最前面的敵人。
 */
function foeOf(run: BattleRun, u: BattleUnit, by?: BattleUnit): BattleUnit | undefined {
  if (by && !run.isStandIn(by) && by.side !== u.side && onField(by)) return by
  return unitsOf(run.battle, u.side === 'ally' ? 'foe' : 'ally')[0]
}

/** 看一遍：還沒標過、而且生命低於一半的人，標上「已經低於一半過」，再問 hp_half 的反應。by 是剛打過的人（有就帶給反應）。 */
function scanHalf(run: BattleRun, by?: BattleUnit): void {
  if (!anyHalfReaction(run)) return
  for (const u of Object.values(run.battle.units)) {
    if (!u.hp || u.out || !onField(u) || u.uses.hp_half || !isWounded(u)) continue
    u.uses.hp_half = 1
    const foe = foeOf(run, u, by)
    fire(run, 'hp_half', { subject: u, ...(foe ? { by: foe } : {}) })
  }
}

export function registerReactions(k: Kernel): void {
  k.battle.on('attack.before', OWNER, ({ run, attacker, target, opts }) => {
    legacy(run, attacker, target, opts)
    fire(run, 'attacked', { subject: target, by: attacker, opts })
  })
  k.battle.on('attack.hit', OWNER, ({ run, attacker, target, opts, roll, out }) => fire(run, 'hit', { subject: target, by: attacker, opts, roll, out }))
  k.battle.on('attack.after', OWNER, ({ run, attacker, target, weapon, opts, result }) => {
    fire(run, 'after', { subject: target, by: attacker, opts, result, weapon })
    scanHalf(run, attacker)
  })
  // 改打掛著的東西（擋槍）的那一擊不發 attack.after：自己的無人機替人挨了一擊，也算「自己的一台被打之後」（敢打我家孩子？）
  k.battle.on('attack.redirected', OWNER, ({ run, attacker, overlay, weapon, opts, result }) => fire(run, 'after', { subject: run.standIn(overlay), by: attacker, opts, result, weapon }))
  k.battle.on('overload', OWNER, ({ run, unit, by, flash }) => fire(run, 'overload', { subject: unit, ...(by ? { by } : {}), ...(flash ? { flash } : {}) }))
  // check.before 的 unit 是擲骰的人、other 是檢定對他擲的那個人（dev/adr/0015 補記）：反應的主角是 other，擲骰的 unit 是對他下手的人
  k.battle.on('check.before', OWNER, ({ run, unit, other, tags, opts }) => fire(run, 'checked', { subject: other, by: unit, tags, check: opts }))
  k.battle.on('out.before', OWNER, ({ run, unit, how, by, out }) => fire(run, 'out_before', { subject: unit, ...(by ? { by } : {}), how, out }))
  // 低於一半生命沒有自己的掛點（流血、燃燒、效果都會扣）：在這幾個地方看一遍
  k.battle.on('action.done', OWNER, ({ run }) => scanHalf(run))
  k.battle.on('turn.start', OWNER, ({ run }) => scanHalf(run))
  k.battle.on('turn.end', OWNER, ({ run }) => scanHalf(run))
  k.battle.on('round.start', OWNER, ({ run }) => scanHalf(run))
}
