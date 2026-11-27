// 技能的輿論欄（M5-abilities-opinion；SKILLS 1.5 節、第 13 節；SKILL_TREES「補充規則」第 1、4、6 條；dev/adr/0020 第五、七節）。
// 這裡只把技能資料的 `opinion` 欄翻成輿論戰的三個掛點的回答，棋盤的規則與效果的解譯全在 features/opinion（不 import）：
//   opinion.moves     坐在編輯台的每個人，裝著的（主角）或路數樹階以內的（夥伴，0016 G4）主動技能，各回一筆 OpMove
//   opinion.passives  被動、共鳴（路數的 resonance[i].opinion）、反應、開著的姿態，各回一筆 OpPassive
//   opinion.open      預備類技能（kind: prep）預備好的 opinion.open，帶進這一場；用過就沒了（report.before 在開場那一份報告裡清掉）
//   opinion.check     內容載入之後（ready）每個技能的輿論欄經它驗；沒有人回答（opinion 沒裝）就不驗
// 欄的形狀（每種 kind 一種，花費與次數寫在 use.opinion：edit、per_turn、per_war（或 per_fight）、cash、favor）：
//   active    { effects: OpEffect[], need?: 條件 }
//   passive   { mods: OpMod[] }                       共鳴同形，寫在路數的 resonance[i].opinion
//   reaction  { on, effects, when?, if_mark? }        use.opinion.edit 是從沒用完的編輯點扣；不能花錢或人情（opinion 的反應只有編輯點）
//   stance    { mods: OpMod[], stance: true }         開著才算：開著的姿態記在 actor.ext.abilities.stance（和戰鬥外的姿態同一格、同時只能開一個）
//   prep      { open: { voice?, wind?, cells?, hand?, foe_pr_first?, cards? } }
// 欄寫 pending: true 的整欄不回、不驗。夜課延伸的技能（night:）沒有輿論欄的寫法，遇到就不回。
// 花錢或花人情的招（掮客）：花費翻成 need（錢夠、有這個人情）與一筆 out 的效果（opinion 在戰役結算時才套）：
//   cash n   → need { kind: 'money', wallet: 'cash', min: n }；out { kind: 'cash', amount: −n }
//   favor f  → need { kind: 'has_favor', dir: 'owed_to_pc', size: f }；out { kind: 'favor_spend', dir: 'owed_to_pc', size: f }
//   沒有人註冊效果 favor_spend（favors 功能還沒有）時，花人情的招不回（不讓它變成免費的）。
// 一個技能的 limit 只有一種（OpMove.limit 只能寫一個）：per_turn 與 per_war（per_fight）不能同時寫（格式檢查擋）。

import type { ActorId, Change, GameState, Kernel } from '../../core'
import { holdingOf, treeTierFor } from './stats'
import { isRec, onlyKeys } from './format'
import { abilitiesOf } from './learn'
import { abilityEntry, isNightId } from './outside'
import type { AbilityEntry, AbilityUse, PathEntry, PreparedEntry } from './types'
import { OWNER } from './types'

// ---- 本地的形狀（和 opinion 的 OpMove／OpPassive／OpOpen 同形；不 import 那一邊） ----

type OpEffect = { kind: string; [field: string]: unknown }
interface OpLimit { per: 'turn' | 'war'; n: number }
interface OpMove { id: string; owner: string; actor: string; name: string; cost: number; limit?: OpLimit; need?: Record<string, unknown>; effects: OpEffect[] }
interface OpReact { on: string | string[]; cost?: number; limit?: OpLimit; if_mark?: string; when?: string; effects: OpEffect[] }
interface OpPassive { id: string; owner: string; actor?: string; name: string; mods?: Array<Record<string, unknown>>; reacts?: OpReact[] }
interface OpOpen { owner: string; line: string; voice?: number; wind?: number; cells?: string[]; hand?: number; foe_pr_first?: number; cards?: string[] }

type Hooks = {
  on(name: string, owner: string, fn: (payload: never) => unknown, order?: number): void
  run(name: string, payload: unknown): Array<{ owner: string; result: unknown }>
  owners(name: string): string[]
}
const hooksOf = (k: Pick<Kernel, 'hooks'>): Hooks => k.hooks as unknown as Hooks

/** 輿論欄開頭的標記：開場資料的 owner 前綴（report.before 靠它找出這一份報告用掉了哪一筆預備）。 */
export const OPEN_OWNER = `${OWNER}:`
const OPEN_TAG = 'opinion.open'

/** 用的消耗只認這幾個鍵（use.opinion）。 */
const USE_OPINION_KEYS = ['edit', 'per_turn', 'per_war', 'per_fight', 'cash', 'favor', 'note'] as const
const OPEN_KEYS = ['voice', 'wind', 'cells', 'hand', 'foe_pr_first', 'cards'] as const

/** 每一種 kind 的輿論欄可以寫的鍵。 */
const COLUMN_KEYS: Record<string, readonly string[]> = {
  active: ['effects', 'need', 'pending', 'text'],
  passive: ['mods', 'pending', 'text'],
  reaction: ['on', 'effects', 'when', 'if_mark', 'pending', 'text'],
  stance: ['mods', 'stance', 'pending', 'text'],
  prep: ['open', 'pending', 'text'],
  daily: ['pending', 'text'],
}

const isText = (v: unknown): v is string => typeof v === 'string' && v.trim().length > 0
const isInt = (v: unknown): v is number => typeof v === 'number' && Number.isInteger(v)

/** 技能的輿論欄用的那一組消耗：只看 use.opinion（use 不是照戰場分的，或沒寫 opinion 那一組，就是空的）。 */
export function opinionUse(ab: Pick<AbilityEntry, 'use'>): AbilityUse {
  const u = ab.use
  return isRec(u) && isRec(u.opinion) ? (u.opinion as AbilityUse) : {}
}

/** 這個技能有沒有要回答的輿論欄（有、不是 pending）。 */
export const opinionOn = (ab: Pick<AbilityEntry, 'opinion'> | undefined): ab is Pick<AbilityEntry, 'opinion'> & { opinion: Record<string, unknown> } => !!ab && isRec(ab.opinion) && ab.opinion.pending !== true

/** 預備類技能的開場資料（opinion.open）；沒有是 undefined。 */
export const openOf = (ab: Pick<AbilityEntry, 'opinion'> | undefined): Record<string, unknown> | undefined => (opinionOn(ab) && isRec(ab.opinion.open) ? ab.opinion.open : undefined)

// ---- 格式（內容載入時；純形狀，不問別的功能） ----

/** 一個技能的輿論欄與 use.opinion 的形狀問題（訊息不帶技能的名字，呼叫的人加）。 */
export function opinionShapeProblems(e: { kind?: unknown; opinion?: unknown; use?: unknown; prep?: unknown }): string[] {
  const col = e.opinion
  if (col === undefined || col === null) return []
  if (!isRec(col)) return ['opinion 要是物件或 null']
  const kind = typeof e.kind === 'string' ? e.kind : ''
  const keys = COLUMN_KEYS[kind]
  if (!keys) return [`opinion：${kind || '這個'}種類的技能沒有輿論欄的寫法`]
  const p = onlyKeys(`opinion（${kind}）`, col, keys)
  if (col.text !== undefined && !isText(col.text)) p.push('opinion.text 要是完整的句子')
  if (col.pending !== undefined && col.pending !== true) p.push('opinion.pending 只能是 true')
  const u = isRec(e.use) && isRec(e.use.opinion) ? e.use.opinion : {}
  if (col.pending === true) return p
  const listOf = (key: string): void => { if (!(Array.isArray(col[key]) && (col[key] as unknown[]).length > 0)) p.push(`opinion.${key} 要是陣列（至少一筆）`) }
  if (kind === 'active') {
    listOf('effects')
    if (col.need !== undefined && !isRec(col.need)) p.push('opinion.need 要是條件（物件）')
    if (u.edit === undefined) p.push('主動技能的輿論欄要寫 use.opinion.edit（花幾點編輯點；不花就寫 0）')
  } else if (kind === 'passive') listOf('mods')
  else if (kind === 'stance') {
    listOf('mods')
    if (col.stance !== true) p.push('姿態的輿論欄要寫 stance: true')
  } else if (kind === 'reaction') {
    listOf('effects')
    if (col.on === undefined) p.push('反應的輿論欄要寫 on（觸發點）')
    if (u.cash !== undefined || u.favor !== undefined) p.push('反應的花費只能是編輯點（use.opinion.edit）；opinion 的反應不能花錢或人情')
  } else if (kind === 'prep') {
    if (!isRec(col.open)) p.push('預備的輿論欄要寫 open（{ voice?, wind?, cells?, hand?, foe_pr_first?, cards? }）')
    else if (Object.keys(col.open).length === 0) p.push('opinion.open 至少要寫一項')
    else p.push(...onlyKeys('opinion.open', col.open, OPEN_KEYS))
    // 預備的機制照舊：花幾個時段、帶進下一場還是這件委託，寫在 prep
    const prep = isRec(e.prep) ? e.prep : {}
    if (!(isInt(prep.slot) && prep.slot >= 0)) p.push('預備的輿論欄要在 prep.slot 寫花幾個時段（0 是不花時段）')
    if (prep.scope !== 'next_battle' && prep.scope !== 'commission') p.push('預備的輿論欄要在 prep.scope 寫 next_battle 或 commission')
  }
  // 消耗只認 use.opinion 這一組
  if (isRec(e.use) && ('meat' in e.use || 'net' in e.use || 'opinion' in e.use) && isRec(e.use.opinion)) p.push(...onlyKeys('use.opinion', e.use.opinion, USE_OPINION_KEYS))
  if (u.per_turn !== undefined && (u.per_war !== undefined || u.per_fight !== undefined)) p.push('use.opinion 的次數只能寫一種（per_turn，或 per_war／per_fight）：招一次只認一個次數限制')
  if (u.per_war !== undefined && u.per_fight !== undefined) p.push('use.opinion 的 per_war 與 per_fight 是同一個意思，只寫一個')
  if (u.cash !== undefined && !(isInt(u.cash) && u.cash >= 1)) p.push('use.opinion.cash 要是 1 以上的整數（輿論戰沒有行動者的等級可以代公式）')
  if (u.favor !== undefined && u.favor !== 'small' && u.favor !== 'mid') p.push('use.opinion.favor 只能是 small 或 mid')
  if (kind !== 'active' && kind !== 'reaction' && (u.cash !== undefined || u.favor !== undefined || u.edit !== undefined)) p.push(`${kind} 技能的 use.opinion 不能寫 edit、cash、favor`)
  return p
}

// ---- 誰有哪些輿論欄 ----

interface Held { actor: ActorId; ab: AbilityEntry; col: Record<string, unknown> }

const pathOf = (k: Pick<Kernel, 'content'>, ab: AbilityEntry): PathEntry | undefined => k.content.get<PathEntry>('path', ab.path)

/** 這個人現在算數的、有輿論欄的技能（照 holdingOf：主角裝著的、夥伴路數樹階以內的；樹在輿論戰沒有效果的不算）。 */
function heldOf(k: Pick<Kernel, 'content' | 'activity'>, state: GameState, actor: ActorId): Held[] {
  if (!state.actors[actor]) return []
  const out: Held[] = []
  for (const id of holdingOf(k, state, actor).equipped) {
    if (isNightId(id)) continue
    const ab = abilityEntry(k, id)
    if (!ab || ab.enemy || !opinionOn(ab)) continue
    if (pathOf(k, ab)?.domains.opinion === 'none') continue
    out.push({ actor, ab, col: ab.opinion! })
  }
  return out
}

/** 兩個人坐著都有同一個技能時，後面的那一個 id 加上 @人（次數與反應的記數才不會混在一起）。 */
function uniqueIds(): (id: string, actor: string) => string {
  const seen = new Set<string>()
  return (id, actor) => {
    if (!seen.has(id)) {
      seen.add(id)
      return id
    }
    return `${id}@${actor}`
  }
}

const limitOf = (u: AbilityUse): OpLimit | undefined => {
  if (isInt(u.per_turn)) return { per: 'turn', n: u.per_turn }
  const war = u.per_war ?? u.per_fight
  return isInt(war) ? { per: 'war', n: war } : undefined
}

const all = (list: Array<Record<string, unknown>>): Record<string, unknown> | undefined => (list.length === 0 ? undefined : list.length === 1 ? list[0] : { kind: 'all', of: list })

/** 主動技能變成一招：花錢與人情翻成 need 與一筆 out 的效果。花人情但沒有人能消耗它（沒有效果 favor_spend）時回 undefined。 */
function moveOf(k: Pick<Kernel, 'effects'>, held: Held, id: string): OpMove | undefined {
  const { actor, ab, col } = held
  const u = opinionUse(ab)
  const needs: Array<Record<string, unknown>> = isRec(col.need) ? [col.need] : []
  const effects: OpEffect[] = [...(col.effects as OpEffect[])]
  if (typeof u.cash === 'number') {
    needs.push({ kind: 'money', wallet: 'cash', min: u.cash })
    effects.push({ kind: 'out', effect: { kind: 'cash', amount: -u.cash } })
  }
  if (u.favor !== undefined) {
    if (!k.effects.has('favor_spend')) return undefined
    needs.push({ kind: 'has_favor', dir: 'owed_to_pc', size: u.favor })
    effects.push({ kind: 'out', effect: { kind: 'favor_spend', dir: 'owed_to_pc', size: u.favor } })
  }
  const need = all(needs)
  const limit = limitOf(u)
  return { id, owner: OWNER, actor, name: ab.name, cost: u.edit ?? 0, ...(limit ? { limit } : {}), ...(need ? { need } : {}), effects }
}

/** 被動、姿態、反應變成一筆被動。姿態沒開（actor.ext.abilities.stance 不是它）、不是這三種的回 undefined。 */
function passiveOf(state: GameState, held: Held, id: string): OpPassive | undefined {
  const { actor, ab, col } = held
  if (ab.kind === 'passive') return Array.isArray(col.mods) ? { id, owner: OWNER, actor, name: ab.name, mods: col.mods as Array<Record<string, unknown>> } : undefined
  if (ab.kind === 'stance') return col.stance === true && Array.isArray(col.mods) && abilitiesOf(state, actor).stance === ab.id ? { id, owner: OWNER, actor, name: ab.name, mods: col.mods as Array<Record<string, unknown>> } : undefined
  if (ab.kind === 'reaction' && Array.isArray(col.effects)) {
    const u = opinionUse(ab)
    const limit = limitOf(u)
    const react: OpReact = {
      on: col.on as string | string[],
      ...(isInt(u.edit) && u.edit > 0 ? { cost: u.edit } : {}),
      ...(limit ? { limit } : {}),
      ...(typeof col.if_mark === 'string' ? { if_mark: col.if_mark } : {}),
      ...(typeof col.when === 'string' ? { when: col.when } : {}),
      effects: col.effects as OpEffect[],
    }
    return { id, owner: OWNER, actor, name: ab.name, reacts: [react] }
  }
  return undefined
}

/** 這個人的共鳴（路數 resonance[i].opinion）：樹開到那一階、而且裝著這棵樹的招牌（和現實、內海的共鳴同一條）。 */
function resonancesOf(k: Pick<Kernel, 'content' | 'activity'>, state: GameState, actor: ActorId): OpPassive[] {
  if (!state.actors[actor]) return []
  const equipped = holdingOf(k, state, actor).equipped
  const out: OpPassive[] = []
  for (const p of k.content.list<PathEntry>('path')) {
    if (p.domains.opinion === 'none' || !equipped.includes(p.signature)) continue
    const tier = treeTierFor(state, actor, p.id)
    p.resonance.forEach((r, i) => {
      if (isRec(r.opinion) && Array.isArray(r.opinion.mods) && r.tier <= tier) out.push({ id: `res:${p.id}:${i}`, owner: OWNER, actor, name: `${p.tree}（共鳴）`, mods: r.opinion.mods as Array<Record<string, unknown>> })
    })
  }
  return out
}

/** 現在在用的那件委託的 id（預備 scope 是 commission 的綁它）。 */
const commissionNow = (k: Pick<Kernel, 'activity'>, state: GameState): string | undefined => k.activity.active(state).find((a) => a.kind === 'commission')?.id

/** 這個人預備好、這一場用得上的輿論預備（next_battle，或 commission 而且綁的是現在這件／還沒綁）。 */
function preparedOpen(k: Pick<Kernel, 'content' | 'activity'>, state: GameState, actor: ActorId): Array<{ p: PreparedEntry; ab: AbilityEntry; open: Record<string, unknown> }> {
  const key = commissionNow(k, state)
  const out: Array<{ p: PreparedEntry; ab: AbilityEntry; open: Record<string, unknown> }> = []
  for (const p of abilitiesOf(state, actor).prepared ?? []) {
    const ab = abilityEntry(k, p.id)
    const open = openOf(ab)
    if (!ab || !open || ab.kind !== 'prep' || pathOf(k, ab)?.domains.opinion === 'none') continue
    if (p.scope === 'commission' && p.key !== undefined && p.key !== key) continue
    out.push({ p, ab, open })
  }
  return out
}

// ---- 掛點的回答 ----

/** 三個掛點的回答（給測試與 registerOpinion 用）。 */
export function movesFor(k: Pick<Kernel, 'content' | 'activity' | 'effects'>, state: GameState, desk: string[]): OpMove[] {
  const idOf = uniqueIds()
  const out: OpMove[] = []
  for (const actor of desk) {
    for (const held of heldOf(k, state, actor)) {
      if (held.ab.kind !== 'active' || !Array.isArray(held.col.effects)) continue
      const m = moveOf(k, held, idOf(held.ab.id, actor))
      if (m) out.push(m)
    }
  }
  return out
}

export function passivesFor(k: Pick<Kernel, 'content' | 'activity'>, state: GameState, desk: string[]): OpPassive[] {
  const idOf = uniqueIds()
  const out: OpPassive[] = []
  for (const actor of desk) {
    for (const held of heldOf(k, state, actor)) {
      const pas = passiveOf(state, held, idOf(held.ab.id, actor))
      if (pas) out.push(pas)
    }
    out.push(...resonancesOf(k, state, actor))
  }
  return out
}

export function opensFor(k: Pick<Kernel, 'content' | 'activity'>, state: GameState, desk: string[]): OpOpen[] {
  const out: OpOpen[] = []
  for (const actor of desk) {
    if (!state.actors[actor]) continue
    for (const { ab, open } of preparedOpen(k, state, actor)) {
      out.push({ ...(open as Partial<OpOpen>), owner: `${OPEN_OWNER}${actor}:${ab.id}`, line: `${state.actors[actor]!.name}預備了「${ab.name}」` })
    }
  }
  return out
}

/**
 * 開場那一份報告用掉了哪些預備：它的 opinion.open 那幾拍（data.owner 是 `abilities:<人>:<技能>`）→ next_battle 的預備清掉，
 * commission 的留著並綁在現在這件委託上（和戰鬥的預備同一個做法，end.ts）。回傳變更，併進那一份報告。
 */
export function usedPrep(k: Pick<Kernel, 'content' | 'activity'>, state: GameState, beats: ReadonlyArray<{ tag?: string; data?: Record<string, unknown> }>): Change[] {
  const used = new Map<string, Set<string>>()
  for (const b of beats) {
    const owner = b.tag === OPEN_TAG && b.data && typeof b.data.owner === 'string' ? b.data.owner : ''
    if (!owner.startsWith(OPEN_OWNER)) continue
    const [actor, ...rest] = owner.slice(OPEN_OWNER.length).split(':')
    const id = rest.join(':')
    if (!actor || !id) continue
    used.set(actor, (used.get(actor) ?? new Set()).add(id))
  }
  const key = commissionNow(k, state)
  const changes: Change[] = []
  for (const [actor, ids] of used) {
    const mine = abilitiesOf(state, actor)
    if (!mine.prepared?.length) continue
    const prepared = mine.prepared
      .filter((p) => !(p.scope === 'next_battle' && ids.has(p.id)))
      .map((p) => (p.scope === 'commission' && p.key === undefined && ids.has(p.id) && key !== undefined ? { ...p, key } : p))
    changes.push({ op: 'actor.ext', id: actor, key: 'abilities', value: { ...mine, prepared } })
  }
  return changes
}

export function registerOpinion(k: Kernel): void {
  const h = hooksOf(k)
  h.on('opinion.moves', OWNER, (({ state, desk }: { state: GameState; desk: string[] }) => movesFor(k, state, desk)) as never)
  h.on('opinion.passives', OWNER, (({ state, desk }: { state: GameState; desk: string[] }) => passivesFor(k, state, desk)) as never)
  h.on('opinion.open', OWNER, (({ state, desk }: { state: GameState; desk: string[] }) => opensFor(k, state, desk)) as never)
  h.on('report.before', OWNER, (({ state, draft }: { state: GameState; draft: { timeline: ReadonlyArray<{ tag?: string; data?: Record<string, unknown> }> } }) => {
    if (!draft.timeline.some((b) => b.tag === OPEN_TAG && typeof b.data?.owner === 'string' && b.data.owner.startsWith(OPEN_OWNER))) return undefined
    const changes = usedPrep(k, state, draft.timeline)
    return changes.length > 0 ? changes : undefined
  }) as never)
}

// ---- 內容載入之後：經 opinion.check 驗 ----

/** 一個技能要交給 opinion.check 的資料（actor 用 _ 代：格式檢查不看人）。 */
function draftsOf(ab: AbilityEntry): Array<{ what: 'move' | 'passive' | 'open'; data: unknown }> {
  if (!opinionOn(ab)) return []
  const held: Held = { actor: '_', ab, col: ab.opinion! }
  if (ab.kind === 'active' && Array.isArray(ab.opinion!.effects)) {
    // 檢查時不管有沒有人註冊 favor_spend：翻出來的格式要對
    const m = moveOf({ effects: { has: () => true } } as never, held, ab.id)
    return m ? [{ what: 'move', data: m }] : []
  }
  if (ab.kind === 'prep' && isRec(ab.opinion!.open)) return [{ what: 'open', data: { ...ab.opinion!.open, owner: `${OPEN_OWNER}_:${ab.id}`, line: ab.name } }]
  const p = passiveOf({ actors: { _: { ext: { abilities: { stance: ab.id } } } } } as never, held, ab.id)
  return p ? [{ what: 'passive', data: p }] : []
}

const askCheck = (k: Pick<Kernel, 'hooks'>, at: string, what: 'move' | 'passive' | 'open', data: unknown): string[] => {
  const out: string[] = []
  for (const a of hooksOf(k).run('opinion.check', { what, data })) if (Array.isArray(a.result)) for (const m of a.result) out.push(`${at}：輿論欄：${String(m)}`)
  return out
}

/**
 * 一個技能的輿論欄的問題（內容載入之後、ready 時查）：先看形狀；形狀對了再經 opinion.check 驗內容（沒有人回答，也就是 opinion 沒裝，就不驗）。
 * 訊息開頭是技能的 id。夜課延伸的、敵人的招牌行動不查。
 */
export function opinionColumnProblems(k: Pick<Kernel, 'hooks'>, ab: AbilityEntry): string[] {
  if (ab.enemy || isNightId(ab.id)) return []
  const shape = opinionShapeProblems(ab).map((m) => `${ab.id}：${m}`)
  if (shape.length > 0) return shape
  if (hooksOf(k).owners('opinion.check').length === 0) return []
  return draftsOf(ab).flatMap((d) => askCheck(k, ab.id, d.what, d.data))
}

/** 一棵樹的共鳴裡的輿論欄的問題：形狀、樹在輿論戰有沒有效果、經 opinion.check 驗。 */
export function resonanceProblems(k: Pick<Kernel, 'hooks'>, p: Pick<PathEntry, 'id' | 'tree' | 'domains' | 'resonance'>): string[] {
  const out: string[] = []
  p.resonance.forEach((r, i) => {
    if (r.opinion === undefined) return
    const at = `${p.id}：resonance[${i}].opinion`
    const shape = resonanceOpinionProblems(at, r.opinion, p.domains.opinion)
    if (shape.length > 0) return void out.push(...shape)
    if (hooksOf(k).owners('opinion.check').length > 0) out.push(...askCheck(k, `${p.id}：resonance[${i}]`, 'passive', { id: `res:${p.id}:${i}`, owner: OWNER, name: p.tree, mods: r.opinion.mods }))
  })
  return out
}

/** 共鳴的輿論欄格式：{ mods: [...] }；樹在輿論戰沒有效果的不能寫。 */
export function resonanceOpinionProblems(at: string, v: unknown, domain: unknown): string[] {
  if (v === undefined) return []
  if (!isRec(v)) return [`${at} 要是 { mods: [...] }`]
  const p = onlyKeys(at, v, ['mods'])
  if (!(Array.isArray(v.mods) && v.mods.length > 0)) p.push(`${at}.mods 要是陣列（至少一筆）`)
  if (domain === 'none') p.push(`${at}：這棵樹在輿論戰沒有效果（domains.opinion 是 none），不能寫輿論的共鳴`)
  return p
}
