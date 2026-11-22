// 預備（SKILLS 1.11 節；dev/adr/0015 E4）：戰鬥外的一個動作。報告 ability.prep：時間加 prep.slot 個時段，
// 預備好的記在 actor.ext.abilities.prepared；下一場現實戰鬥開打時帶進來（mods 整場有效、do 在開打時做一次），
// next_battle 的用掉就清，commission 的在同一件委託（origin.ext.commission，沒有就是那一場自己）裡一直有效。

import type { ActorId, BattleRun, BattleUnit, GameState, Kernel, ReportDraft } from '../../core'
import { SEGMENT_HOURS, clone } from '../../core'
import { abilitiesOf } from './learn'
import type { AbilityEntry, PreparedEntry } from './types'
import { commissionKeyOf } from './use'
import { broughtPrep, dataOf, tierIn } from './unitdata'

/** 現在預備得了這個技能嗎；預備不了就回傳第一個原因（給玩家看的完整句子），預備得了是 null。 */
export function prepBlock(k: Pick<Kernel, 'content'>, state: GameState, actor: ActorId, id: string): string | null {
  const ab = k.content.get<AbilityEntry>('ability', id)
  if (!ab) return '沒有這個技能。'
  if (ab.kind !== 'prep') return `${ab.name}不是預備技能。`
  if (!state.actors[actor]) return '沒有這個角色。'
  if (state.battle) return '戰鬥中不能預備。'
  const mine = abilitiesOf(state, actor)
  if (!mine.learned.includes(id)) return `還沒學會${ab.name}。`
  if (!mine.equipped.includes(id)) return `要先裝上${ab.name}。`
  if (!ab.prep || ab.prep.slot === undefined || !ab.prep.scope || !ab.prep.meat) return `${ab.name}還沒有可以帶進戰鬥的效果。`
  return null
}

/** 預備一次：時間往前 slot 個時段，記進角色身上。預備不了丟錯（訊息是那個原因）。 */
export function prep(k: Pick<Kernel, 'content'>, state: GameState, actor: ActorId, id: string): ReportDraft {
  const why = prepBlock(k, state, actor, id)
  if (why) throw new Error(why)
  const ab = k.content.get<AbilityEntry>('ability', id)!
  const def = ab.prep!
  const mine = abilitiesOf(state, actor)
  const entry: PreparedEntry = { id, scope: def.scope! }
  const next = { ...mine, prepared: [...(mine.prepared ?? []).filter((x) => x.id !== id), entry] }
  const slots = def.slot!
  return {
    kind: 'action', action: 'ability.prep', location: clone(state.location), actor, party: [],
    timeline: [{ layer: 'meat', actor, text: `${state.actors[actor]!.name}做了預備：${ab.name}（花 ${slots} 個時段）。`, tag: 'prep' }],
    changes: [{ op: 'time', minutes: slots * SEGMENT_HOURS * 60 }, { op: 'actor.ext', id: actor, key: 'abilities', value: next }],
    outcome: { result: 'prepared', summary: `預備了${ab.name}，花了 ${slots} 個時段。下一場${def.scope === 'commission' ? '委託裡的戰鬥' : '現實戰鬥'}帶進去。` },
  }
}

// ---- 帶進戰鬥 ----

/** 單位剛組好（現實戰鬥）：這個角色預備好的、這一場用得上的，記進單位（unit.ext.abilities.brought）。 */
export function bringPrep(run: Pick<BattleRun, 'state' | 'battle'>, u: BattleUnit): void {
  if (!u.actor || run.battle.mode !== 'meat') return
  const prepared = abilitiesOf(run.state, u.actor).prepared
  if (!prepared?.length) return
  const key = commissionKeyOf(run.battle)
  const here = prepared.filter((p) => p.scope === 'next_battle' || p.key === undefined || p.key === key).map((p) => p.id)
  if (here.length) dataOf(u).brought = here
}

/** 開打時：每個人帶進來的預備，各做一次它的 do。 */
export function startPrep(run: BattleRun): void {
  for (const u of Object.values(run.battle.units)) {
    for (const id of broughtPrep(u)) {
      const ab = run.k.content.get<AbilityEntry>('ability', id)
      const list = ab?.prep?.meat?.do
      if (!ab || !list?.length) continue
      run.say(`${u.name}：${ab.name}（預備）。`, 'skill', { unit: u.id, ability: ab.id, prep: true }, u)
      run.effects(list, { user: u, target: null, source: { kind: 'ability', id: ab.id, name: ab.name }, n: { tier: tierIn(u, ab.path) } })
    }
  }
}
