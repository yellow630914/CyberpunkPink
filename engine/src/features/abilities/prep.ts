// 預備（SKILLS 1.11 節；dev/adr/0015 E4；dev/adr/0016 G10 之後 M2）：戰鬥外的一個動作。報告 ability.prep：時間加 prep.slot 個時段，
// 預備好的記在 actor.ext.abilities.prepared；下一場現實戰鬥開打時帶進來（mods 整場有效、do 在開打時做一次），
// next_battle 的用掉就清，commission 的在同一件委託（origin.ext.commission，沒有就是那一場自己）裡一直有效。
//
// M2 多的（dev/work/M2-abilities-m2.md）：
// - prep.effects：預備的當下就在戰鬥外結算的效果，走 k.effects（沒有人註冊的種類略過那一筆）。字串裡的 $target、$commission、$tendency 換成輸入的人、輸入的委託、
//   那個人傾向裡的一個標籤。情報網：scout_reveal（每件委託 1 次：照輸入的 commission 記次數，沒給就擋下）；讀人：npc_known（他的一個傾向）。
// - prep.target 是 person：要選一個人（輸入的 target），記進預備好的那一筆；帶進戰鬥的 meat.mods 只對那個人有效（單位的角色或 ext.npc 對得上），
//   戰鬥外的 prep.out_mods（誘惑與交涉檢定 +2）也只對他有效，預備用掉之前一直有效（out.ts）。

import type { ActorId, BattleRun, BattleUnit, Change, GameState, Kernel, ReportDraft } from '../../core'
import { SEGMENT_HOURS, clone, deriveRng, effectCtx, isRecord, toMinutes } from '../../core'
import { abilitiesOf } from './learn'
import type { AbilityEntry, AbilityState, PreparedEntry } from './types'
import { commissionKeyOf, useOf } from './use'
import { broughtPrep, dataOf, tierIn } from './unitdata'

/** 預備的輸入：選的人（prep.target 是 person 的）、這件預備算在哪一件委託（有每件委託次數的）。 */
export interface PrepInput {
  target?: string
  commission?: string
}

type PrepKernel = Pick<Kernel, 'content' | 'effects' | 'stats'>

/** 傾向的標籤：這個人身上 actor.ext.tendency.tags 裡有的（有或深的優先，沒有才是潛在的）；讀不到是 none。同一個人同一刻讀，結果一樣。 */
function tendencyOf(state: GameState, actor: ActorId, id: string, person: string): string {
  const raw = state.actors[person]?.ext.tendency
  const tags = isRecord(raw) && isRecord(raw.tags) ? raw.tags : {}
  const names = Object.keys(tags).sort()
  const known = names.filter((t) => tags[t] === 'has' || tags[t] === 'deep')
  const pool = known.length ? known : names.filter((t) => tags[t] === 'latent')
  if (!pool.length) return 'tendency:none'
  return `tendency:${deriveRng(state.rng, `ability/prep/${actor}/${id}/${person}/${toMinutes(state.time)}`).pick(pool)}`
}

/** 把字串裡的 $target、$commission、$tendency 換掉（深複製；沒有輸入的那一個留著原樣，由效果自己的格式檢查擋下）。 */
function fill(v: unknown, vars: Record<string, string | undefined>): unknown {
  if (typeof v === 'string') {
    let out = v
    for (const [name, value] of Object.entries(vars)) if (value !== undefined) out = out.split(name).join(value)
    return out
  }
  if (Array.isArray(v)) return v.map((x) => fill(x, vars))
  if (isRecord(v)) return Object.fromEntries(Object.entries(v).map(([key, x]) => [key, fill(x, vars)]))
  return v
}

/** 這一次預備要結算的效果（換好字串、拿掉沒有人註冊的種類）與它們的結果；格式不合或套不上去丟錯（訊息是第一個原因）。 */
function settle(k: PrepKernel, state: GameState, actor: ActorId, ab: AbilityEntry, input: PrepInput): { changes: Change[]; lines: string[] } {
  const list = ab.prep?.effects
  if (!list?.length) return { changes: [], lines: [] }
  const vars = {
    $target: input.target, $commission: input.commission,
    ...(input.target !== undefined ? { $tendency: tendencyOf(state, actor, ab.id, input.target) } : {}),
  }
  const effects = (fill(list, vars) as Array<Record<string, unknown>>).filter((e) => k.effects.has(String(e.kind)))
  if (!effects.length) return { changes: [], lines: [] }
  const res = k.effects.resolve(effects, effectCtx(k as never, state, { source: 'builtin', actor }))
  if (res.errors.length) throw new Error(res.errors[0]!.replace(/^effects\[\d+\]：/, ''))
  return { changes: res.changes, lines: res.lines }
}

/** 現在預備得了這個技能嗎；預備不了就回傳第一個原因（給玩家看的完整句子），預備得了是 null。 */
export function prepBlock(k: PrepKernel, state: GameState, actor: ActorId, id: string, input: PrepInput = {}): string | null {
  const ab = k.content.get<AbilityEntry>('ability', id)
  if (!ab) return '沒有這個技能。'
  if (ab.kind !== 'prep') return `${ab.name}不是預備技能。`
  if (!state.actors[actor]) return '沒有這個角色。'
  if (state.battle) return '戰鬥中不能預備。'
  const mine = abilitiesOf(state, actor)
  if (!mine.learned.includes(id)) return `還沒學會${ab.name}。`
  if (!mine.equipped.includes(id)) return `要先裝上${ab.name}。`
  const def = ab.prep
  if (!def || def.slot === undefined || !def.scope || (!def.meat && !def.effects && !def.out_mods)) return `${ab.name}還沒有可以帶進戰鬥的效果。`
  if (def.target === 'person' && !(typeof input.target === 'string' && input.target.length > 0)) return `${ab.name}要先選一個人。`
  if (def.target === 'person' && input.target === actor) return `${ab.name}要選別人，不能選自己。`
  // 每件委託的次數：照輸入的委託記，沒給就擋下
  const per = useOf(ab).per_commission
  if (per !== undefined) {
    if (!(typeof input.commission === 'string' && input.commission.length > 0)) return `${ab.name}每件委託只能用 ${per} 次，要先指定是哪一件委託。`
    if ((mine.commission?.[input.commission]?.[id] ?? 0) >= per) return `這件委託的次數用完了（每件委託 ${per} 次）。`
  }
  try {
    settle(k, state, actor, ab, input)
  } catch (e) {
    return (e as Error).message
  }
  return null
}

/**
 * 預備一次：時間往前 slot 個時段，記進角色身上；prep.effects 當場結算。預備不了丟錯（訊息是那個原因）。
 * 有每件委託的次數（use.per_commission）的，次數記在 ability.commission[委託][技能 id]（和戰鬥裡的每件委託同一份）。
 */
export function prep(k: PrepKernel, state: GameState, actor: ActorId, id: string, input: PrepInput = {}): ReportDraft {
  const why = prepBlock(k, state, actor, id, input)
  if (why) throw new Error(why)
  const ab = k.content.get<AbilityEntry>('ability', id)!
  const def = ab.prep!
  const mine = abilitiesOf(state, actor)
  const entry: PreparedEntry = { id, scope: def.scope!, ...(def.target === 'person' ? { target: input.target! } : {}) }
  let next: AbilityState = { ...mine, prepared: [...(mine.prepared ?? []).filter((x) => x.id !== id), entry] }
  if (useOf(ab).per_commission !== undefined) {
    const key = input.commission!
    next = { ...next, commission: { ...mine.commission, [key]: { ...(mine.commission?.[key] ?? {}), [id]: (mine.commission?.[key]?.[id] ?? 0) + 1 } } }
  }
  const { changes, lines } = settle(k, state, actor, ab, input)
  const slots = def.slot!
  return {
    kind: 'action', action: 'ability.prep', location: clone(state.location), actor, party: [],
    timeline: [{ layer: 'meat', actor, text: `${state.actors[actor]!.name}做了預備：${ab.name}（${slots ? `花 ${slots} 個時段` : '不花時段'}）。`, tag: 'prep' }],
    changes: [...(slots ? [{ op: 'time' as const, minutes: slots * SEGMENT_HOURS * 60 }] : []), ...changes, { op: 'actor.ext', id: actor, key: 'abilities', value: next }],
    outcome: { result: 'prepared', summary: `預備了${ab.name}，${slots ? `花了 ${slots} 個時段` : '不花時段'}。${lines.length ? `${lines.join('；')}。` : ''}下一場${def.scope === 'commission' ? '委託裡的戰鬥' : '現實戰鬥'}帶進去。` },
    ...(lines.length ? { narration: { results: lines } } : {}),
  }
}

// ---- 帶進戰鬥 ----

/** 單位剛組好（現實戰鬥）：這個角色預備好的、這一場用得上的，記進單位（unit.ext.abilities.brought；選了人的另記 read）。 */
export function bringPrep(run: Pick<BattleRun, 'state' | 'battle' | 'mode'>, u: BattleUnit): void {
  if (!u.actor || run.mode.layer !== 'meat') return
  const prepared = abilitiesOf(run.state, u.actor).prepared
  if (!prepared?.length) return
  const key = commissionKeyOf(run.battle)
  const here = prepared.filter((p) => p.scope === 'next_battle' || p.key === undefined || p.key === key)
  if (!here.length) return
  dataOf(u).brought = here.map((p) => p.id)
  const read = Object.fromEntries(here.filter((p) => p.target !== undefined).map((p) => [p.id, p.target!]))
  if (Object.keys(read).length) dataOf(u).read = read
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
