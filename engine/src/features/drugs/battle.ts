// L6 功能 drugs 的戰鬥那一半（dev/work/M4-drugs.md 第 3 點；ITEMS 4.1 節；dev/adr/0019 第五節與 P13、P65）。
//   效果 op drug { item? }  戰鬥中吃一劑：由物品的 use.effects 叫（快取格的「使用道具」與藥泵的 cyber_pump 都跑這一份資料）。
//                          單位的 ext.drugs.taken 記這一場吃了每一種幾劑；戰鬥中不直接改角色的狀態（成癮、instant、剩餘的時間在戰鬥結束時寫）。
//   修正                  這一場吃的藥的 effects 與 side 裡 mod 類的，用戰鬥的修正生效（來源 drug，所以 ap_regen、ram_regen 照樣受全身 +1 的夾法管）。
//                          這一場「算」的只有：mod、unit_tag、內海的 stat net_load_decay（P65：單位在組成時只抄一次，戰鬥中吃的藥要自己更新單位的 decay）。
//                          屬性（attr）、其他衍生數值（stat）、檢定修正（check）這一場不算：它們由 k.passives 在戰鬥外讀，戰鬥裡的單位數字開打時就定了。
//   turn.start            每個自己的回合開始，身上生效的藥（戰鬥外吃的、這一場吃的）的 upkeep_load 加進感載（失去的回合不加）。
//   onEnd                 這一場吃的每一種寫進角色（成癮、instant、不是「一場戰鬥」型的補上藥效的時間）；身上還在的「一場戰鬥」型的藥記成被這一場接住（撐到喘口氣）。
//                          這一場被重來或回退就不會走到這裡，什麼都沒發生。

import type { BattleEffectCtx, BattleUnit, Change, Condition, GameState, Kernel, PassiveEffect } from '../../core'
import { BattleBlocked, isRecord, unitTag } from '../../core'
import type { DrugDef } from './model'
import { DRUG_OP, EXT, drugDef, isUnbridged, liveDrugs } from './model'
import { doseResult } from './dose'

/** 單位 ext.drugs 的樣子：這一場吃了每一種幾劑。 */
export interface UnitDrugs {
  taken: Record<string, number>
}

export const unitDrugs = (u: BattleUnit): UnitDrugs | undefined => {
  const raw = u.ext[EXT]
  if (!isRecord(raw) || !isRecord(raw.taken)) return undefined
  return raw as unknown as UnitDrugs
}

/** 這個單位在戰鬥裡沒有橋：標籤 unbridged（核心照 P15 加），或對到的角色明寫沒有橋。 */
function unitUnbridged(state: GameState | undefined, u: BattleUnit): boolean {
  if (u.tags.includes('unbridged')) return true
  return !!state && !!u.actor && isUnbridged(state, u.actor)
}

/** 這一筆的 if 在這個單位身上成立嗎（有 if 的要有對到的角色才測；沒有角色就當不成立）。 */
function holds(k: Kernel, state: GameState | undefined, u: BattleUnit, list: Condition[] | undefined): boolean {
  if (!list?.length) return true
  if (!state || !u.actor || !state.actors[u.actor]) return false
  const ctx = { state, actor: u.actor, stats: k.stats, timeRules: k.timeRules }
  return list.every((c) => k.conditions.test(c, ctx))
}

const effectsOf = (def: DrugDef): PassiveEffect[] => [...def.effects, ...def.side]

/** 這個單位身上這一種藥的效果在戰鬥外已經生效了（k.passives 已經算進去）：這一場吃的不能再算一次（同一種不疊加）。 */
const alreadyLive = (state: GameState | undefined, u: BattleUnit, id: string): boolean => !!state && !!u.actor && !!state.actors[u.actor] && liveDrugs(state, u.actor).includes(id)

function takeOp(k: Kernel, ctx: BattleEffectCtx, e: Record<string, unknown>): void {
  const { run } = ctx
  const u = ctx.unit
  if (!u || run.isStandIn(u)) return
  const id = typeof e.item === 'string' ? e.item : (ctx.item ?? ctx.source.id)
  const def = drugDef(k, id)
  if (!def) throw new BattleBlocked([`${id} 不是藥，吃不了。`])
  const ext = (u.ext[EXT] as UnitDrugs | undefined) ?? { taken: {} }
  u.ext[EXT] = ext
  const first = !(ext.taken[id] > 0)
  ext.taken[id] = (ext.taken[id] ?? 0) + 1
  if (unitUnbridged(run.state, u) && def.needs_bridge) {
    run.say(`${unitTag(u)} 服下了${def.name}，可是沒有橋，沒有任何效果。`, 'item', { unit: u.id, item: id, no_effect: true }, ctx.user)
    return
  }
  run.say(`${unitTag(u)} 服下了${def.name}。`, 'item', { unit: u.id, item: id, doses: ext.taken[id] }, ctx.user)
  // 只在這一種藥第一次生效時動單位：已經在戰鬥外生效的（k.passives 算過）或這一場已經吃過的（不疊加）不再算
  if (!first || alreadyLive(run.state, u, id)) return
  for (const eff of effectsOf(def)) {
    if (!holds(k, run.state, u, eff.if)) continue
    if ('unit_tag' in eff && !u.tags.includes(eff.unit_tag)) u.tags.push(eff.unit_tag)
    // P65：內海的消退單位開打時只抄一次，戰鬥中吃的藥要自己改單位的 decay
    if ('stat' in eff && eff.stat === 'net_load_decay' && run.mode.decayStat) u.decay = Math.max(0, (u.decay ?? 0) + eff.amount)
  }
}

export function installBattle(k: Kernel, owner: string): void {
  k.battle.effect(DRUG_OP, owner, (ctx, e) => takeOp(k, ctx, e), {
    problems: (e) => {
      const p: string[] = []
      for (const key of Object.keys(e)) if (!['op', 'who', 'if', 'item'].includes(key)) p.push(`${key}：沒有這個欄位（可以寫：who、if、item）`)
      if (e.item !== undefined && !(typeof e.item === 'string' && e.item.trim())) p.push('item 要是物品的 id')
      return p
    },
  })

  // 修正：這一場吃的藥的 mod
  k.battle.modifier(owner, (q) => {
    const ext = unitDrugs(q.unit)
    if (!ext) return []
    const state = q.view.state as GameState | undefined
    const unbridged = unitUnbridged(state, q.unit)
    const out = []
    for (const id of Object.keys(ext.taken)) {
      if (!(ext.taken[id]! > 0) || alreadyLive(state, q.unit, id)) continue
      const def = drugDef(k, id)
      if (!def || (def.needs_bridge && unbridged)) continue
      for (const eff of effectsOf(def)) {
        if (!('mod' in eff) || eff.mod !== q.kind) continue
        if (eff.layer !== undefined && eff.layer !== q.view.mode.layer) continue
        if (eff.tags && !eff.tags.every((t) => q.tags.includes(t))) continue
        if (!holds(k, state, q.unit, eff.if)) continue
        out.push({ label: eff.label ?? def.name, value: eff.amount, source: 'drug' })
      }
    }
    return out
  })

  // 每個自己的回合開始：藥的 upkeep_load（戰鬥外吃還在的，加這一場吃的）
  k.battle.on('turn.start', owner, ({ run, unit, lost }) => {
    if (lost || unit.out || !unit.load) return
    const ids = new Set<string>(Object.keys(unitDrugs(unit)?.taken ?? {}))
    if (unit.actor && run.state.actors[unit.actor]) for (const id of liveDrugs(run.state, unit.actor)) ids.add(id)
    const unbridged = unitUnbridged(run.state, unit)
    let total = 0
    for (const id of ids) {
      const def = drugDef(k, id)
      if (!def || def.upkeep_load <= 0 || (def.needs_bridge && unbridged)) continue
      total += def.upkeep_load
    }
    if (total > 0) run.addLoad(unit, total, undefined, { exact: true, label: '藥效' })
  })

  // 戰鬥結束：寫回角色
  k.battle.onEnd(owner, ({ state, battle }) => {
    const changes: Change[] = []
    const lines: string[] = []
    const seen = new Set<string>()
    for (const u of Object.values(battle.units) as BattleUnit[]) {
      if (u.side !== 'ally' || !u.actor || seen.has(u.actor) || !state.actors[u.actor]) continue
      seen.add(u.actor)
      const taken = unitDrugs(u)?.taken ?? {}
      const doses = Object.entries(taken).filter(([, n]) => n > 0).map(([id, count]) => ({ id, count }))
      const r = doseResult(k, state, u.actor, doses, { inBattle: true, flagBattle: true })
      if (!r.touched) continue
      changes.push(...r.changes)
      const who = state.actors[u.actor]!.name
      for (const { id, count } of doses) {
        const a = r.addiction[id]
        lines.push(`服用：${who}的${drugDef(k, id)?.name ?? id} ×${count}${a ? `（成癮 ${a.before} → ${a.after}）` : ''}`)
      }
      lines.push(...r.lines.filter((l) => !doses.some(({ id }) => l.startsWith(`${drugDef(k, id)?.name ?? id}：沒有橋`))))
    }
    return changes.length || lines.length ? { changes, lines } : undefined
  })
}
