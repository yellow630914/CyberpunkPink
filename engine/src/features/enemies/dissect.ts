// 戰後的解剖：現實的義體掉落（ENEMIES 第 7 節與第 15 節；CRAFTING 10.4 節；SKILL_TREES 改造師「解剖」的日常那一段的現實面；
// LIFE 第 9 節行規「拆死人的、拆活人的」；dev/adr/0019 第四節；dev/work/M4-craft-salvage.md）。
// 敵人資料的掉落寫 { blueprint, parts?, chance, needs: 'dissect' }（loot.ts）是一件要改造師拆的義體成品。
// 這一種不在戰鬥結束時自動擲：打贏一場現實的戰鬥時（battle.onEnd），把倒下或被制伏、資料有這種掉落的敵人記進 state.ext.enemies_dissect
// （蓋掉上一場的；打輸、內海的戰鬥不記——內海的 needs: 'dissect' 由 loot.ts 自動擲，兩邊互不誤觸）；之後由玩家在一小時內選一個動手，一場一次。
//   狀態  state.ext.enemies_dissect = { battle, until, targets: [{ key, name, faction?, human, loot }], done?: true }
//         key 是戰鬥單位的 id；until 是有效到的絕對分鐘；loot 是那個敵人身上要改造師拆的義體項目（陣列）；human 是不是人（人與無橋者；機器不算）
//   條件  動手的人要通過條件 ability（daily: 'dissect'）；沒有人註冊這個條件時一律不能做
//   做了  照那個敵人的項目各擲機率（deriveRng，用途 enemies.dissect/<戰鬥>/<key>），擲到的給一疊義體成品（data: ProductData，state: 'used'）；時間加 60 分鐘；
//         對象是人：做的人沉溺 +1（走效果 sink）、那個勢力的敵對值 +5（走效果 hostility，沒有人定義這個量表就略過；勢力是 none 不加）；機器不加
// 數字照設計書（ENEMIES 第 7 節：沉溺 +1、敵對值 +5；CRAFTING 10.4 節：戰後一小時）。報告 enemies.dissect。
// 不 import features/craft：成品的 uid 前綴 pr 與 craft 的流水號是同一個慣例（核心的 seq.uid）。

import type { ActorId, BattleUnit, BlueprintEntry, Change, GameState, Kernel, ProductData, ReportDraft, TimelineBeat } from '../../core'
import { ActionBlocked, clone, deriveRng, effectCtx, isRecord, modeOf, toMinutes } from '../../core'
import type { EnemyEntry } from './kinds'
import { resolveEnemy } from './kinds'
import type { LootBlueprint } from './loot'
import { dissectLootOf } from './loot'

export const DISSECT_EXT = 'enemies_dissect'
export const DISSECT_ACTION = 'enemies.dissect'
/** 戰後多久之內能解剖（分鐘）。 */
export const DISSECT_WINDOW_MINUTES = 60
/** 解剖花的時間（分鐘）。 */
export const DISSECT_MINUTES = 60
/** 拆的是人：做的人沉溺 +N、那個勢力的敵對值 +N（LIFE 第 9 節「不拆活人」；ENEMIES 第 7 節）。 */
export const DISSECT_SINK = 1
export const DISSECT_HOSTILITY = 5
/** 算解剖對象的退出方式：被打倒、昏過去、被制伏。投降、逃走與被帶走的不算。 */
const DISSECTABLE_OUT: readonly string[] = ['down', 'burnout', 'subdued']
/** 算「人」的兵種（kind）：有血有肉的對象；機器、載具、機甲、吉祥物、蕾絲與程式不算。 */
const HUMAN_KINDS: readonly string[] = ['human', 'unbridged']
/** 成品的 uid 前綴（和 craft 的組裝同一個慣例：核心流水號 seq.uid ＋ 1）。 */
const PRODUCT_UID_PREFIX = 'pr'

export interface DissectTarget {
  key: string
  name: string
  faction?: string
  human: boolean
  loot: LootBlueprint[]
}
export interface DissectState {
  battle: string
  until: number
  targets: DissectTarget[]
  done?: true
}

const isText = (v: unknown): v is string => typeof v === 'string' && v.trim().length > 0

/** 讀 state.ext.enemies_dissect；沒有、壞掉的回 null（不丟錯）。 */
export function dissectOf(state: Pick<GameState, 'ext'>): DissectState | null {
  const raw = state.ext[DISSECT_EXT]
  if (!isRecord(raw) || !isText(raw.battle) || typeof raw.until !== 'number' || !Number.isFinite(raw.until) || !Array.isArray(raw.targets)) return null
  const targets: DissectTarget[] = []
  for (const t of raw.targets) {
    if (!isRecord(t) || !isText(t.key) || !isText(t.name) || typeof t.human !== 'boolean') continue
    const loot = dissectLootOf({ loot: Array.isArray(t.loot) ? t.loot : [] })
    if (loot.length === 0) continue
    targets.push({ key: t.key, name: t.name, human: t.human, loot, ...(isText(t.faction) ? { faction: t.faction } : {}) })
  }
  return { battle: raw.battle, until: raw.until, targets, ...(raw.done === true ? { done: true as const } : {}) }
}

/** 一場現實的戰鬥打贏之後：倒下或被制伏、資料有義體掉落的敵人（被帶走的不算）。 */
function targetsOf(k: Pick<Kernel, 'content'>, units: BattleUnit[]): DissectTarget[] {
  const out: DissectTarget[] = []
  for (const u of units) {
    if (u.side !== 'foe' || !u.enemy || !u.out || !DISSECTABLE_OUT.includes(u.out) || !k.content.has('enemy', u.enemy)) continue
    const ext = u.ext.enemies
    if (isRecord(ext) && ext.taken) continue
    const e: EnemyEntry = resolveEnemy(k.content, u.enemy)
    const loot = dissectLootOf(e)
    if (loot.length === 0) continue
    out.push({
      key: u.id, name: u.name, human: HUMAN_KINDS.includes(String(e.kind)), loot,
      ...(isText(e.faction) && e.faction !== 'none' ? { faction: e.faction } : {}),
    })
  }
  return out
}

export function installDissect(k: Pick<Kernel, 'battle' | 'content'>, owner: string): void {
  k.battle.onEnd(owner, ({ state, battle, outcome }) => {
    // 內海的戰鬥不動這份狀態（內海的解剖是 loot.ts 的自動擲）
    if (modeOf(k.content, battle.mode)?.layer === 'net') return
    const targets = outcome === 'win' ? targetsOf(k, Object.values(battle.units) as BattleUnit[]) : []
    if (targets.length === 0) {
      // 打輸了、沒有可拆的：上一場的對象不在手邊了
      return isRecord(state.ext) && state.ext[DISSECT_EXT] !== undefined ? { changes: [{ op: 'ext', key: DISSECT_EXT, value: null }] } : undefined
    }
    const value: DissectState = { battle: battle.id, until: toMinutes(state.time) + DISSECT_WINDOW_MINUTES, targets }
    return { changes: [{ op: 'ext', key: DISSECT_EXT, value: value as unknown as Record<string, unknown> }] }
  })
}

// ---- 選項與入口 ----

export interface DissectOpts {
  /** 要拆的對象（戰鬥單位的 id，dissectOptions 列出來的 key） */
  target: string
  /** 動手的人（主角或隊上的人；預設主角） */
  by?: ActorId
}

export interface DissectOption {
  key: string
  name: string
  faction?: string
  human: boolean
  /** 可能拆到的義體（設計圖的 id 與名字；不給機率） */
  items: Array<{ blueprint: string; name: string }>
  /** 拆的代價：做的人沉溺 +sink、勢力的敵對值 +hostility（機器是 0 與 null） */
  sink: number
  hostility: { faction: string; amount: number } | null
  /** 現在這個人做不了的原因（沒有人會解剖、動手的人不在隊上……）；做得了是 null */
  block: string | null
}

/** 動手的人現在會不會解剖：條件 ability（daily: 'dissect'）；沒有人註冊這個條件時不會。 */
function canDissect(k: Kernel, state: GameState, by: ActorId): boolean {
  if (!state.actors[by] || !k.conditions.kinds().includes('ability')) return false
  return k.conditions.test({ kind: 'ability', daily: 'dissect' }, { state, actor: by, stats: k.stats, timeRules: k.timeRules })
}

const hostilityOf = (t: DissectTarget): { faction: string; amount: number } | null => (t.human && t.faction !== undefined ? { faction: t.faction, amount: DISSECT_HOSTILITY } : null)

/** 這一場現在做不做得了（不看對象與動手的人）：沒有對象、已經做過、過了一小時。 */
function windowBlock(k: Kernel, state: GameState, st: DissectState | null): string | null {
  const act = k.activity.blockOf(state, `commit:${DISSECT_ACTION}`)
  if (act) return act
  if (!st || st.targets.length === 0) return '現在沒有可以解剖的對象。'
  if (st.done) return '這一場已經解剖過了。'
  if (toMinutes(state.time) > st.until) return '過了一小時，現場已經收拾過了，來不及解剖。'
  return null
}

const personBlock = (k: Kernel, state: GameState, by: ActorId): string | null => {
  if (!state.actors[by]) return '找不到動手的人。'
  if (by !== state.pc && !state.party.includes(by)) return '動手的人要是主角或隊上的人。'
  return canDissect(k, state, by) ? null : `${state.actors[by]!.name}不會解剖。`
}

/** 解剖現在行不行（第一條原因；行是 null）。 */
export function dissectBlock(k: Kernel, state: GameState, o: DissectOpts): string | null {
  const st = dissectOf(state)
  const w = windowBlock(k, state, st)
  if (w) return w
  const by = o.by ?? state.pc ?? ''
  const p = personBlock(k, state, by)
  if (p) return p
  return st!.targets.some((t) => t.key === o.target) ? null : '找不到這個對象。'
}

/** 現在可以解剖的對象（一小時內、這一場還沒做過）；不在時間內、做過了、沒有對象都是空的。每一個帶這個人現在做不做得了。 */
export function dissectOptions(k: Kernel, state: GameState, by: ActorId | undefined = state.pc ?? undefined): DissectOption[] {
  const st = dissectOf(state)
  if (windowBlock(k, state, st) !== null) return []
  const block = personBlock(k, state, by ?? '')
  return st!.targets.map((t): DissectOption => ({
    key: t.key, name: t.name, ...(t.faction !== undefined ? { faction: t.faction } : {}), human: t.human,
    items: t.loot.flatMap((l) => {
      const bp = k.content.get<BlueprintEntry>('blueprint', l.blueprint)
      return bp ? [{ blueprint: bp.id, name: bp.name }] : []
    }),
    sink: t.human ? DISSECT_SINK : 0, hostility: hostilityOf(t), block,
  }))
}

/**
 * 解剖一個對象。不成立丟 ActionBlocked（dissectBlock 的原因）。
 * 報告 enemies.dissect：outcome.result 是 got（拆到了）或 nothing（一件完好的都沒有）；義體成品進背包（state: 'used'）。
 */
export function dissectDraft(k: Kernel, state: GameState, o: DissectOpts): ReportDraft {
  const block = dissectBlock(k, state, o)
  if (block) throw new ActionBlocked(block)
  const st = dissectOf(state)!
  const target = st.targets.find((t) => t.key === o.target)!
  const by = o.by ?? state.pc ?? ''
  const rng = deriveRng(state.rng, `${DISSECT_ACTION}/${st.battle}/${target.key}`)

  const changes: Change[] = []
  const got: string[] = []
  let seq = state.seq.uid
  for (const l of target.loot) {
    const hit = rng.next() < l.chance
    const bp = k.content.get<BlueprintEntry>('blueprint', l.blueprint)
    if (!hit || !bp) continue
    seq++
    const product: ProductData = { uid: `${PRODUCT_UID_PREFIX}${seq}`, parts: clone(l.parts ?? bp.stock ?? {}), state: 'used' }
    changes.push({ op: 'item', id: bp.id, qty: 1, data: product as unknown as Record<string, unknown> })
    got.push(bp.name)
  }
  if (seq > state.seq.uid) changes.push({ op: 'uid', advance: seq - state.seq.uid })
  changes.push({ op: 'time', minutes: DISSECT_MINUTES }, { op: 'rng', advance: 1 }, { op: 'ext', key: DISSECT_EXT, value: { ...clone(st), done: true } as unknown as Record<string, unknown> })

  // 拆的是人：沉溺與敵對值走效果（沒有人註冊就略過）
  const ctx = effectCtx(k, state, { source: 'builtin', actor: by })
  const effects: Array<Record<string, unknown> & { kind: string }> = []
  if (target.human) {
    effects.push({ kind: 'sink', amount: DISSECT_SINK })
    const h = hostilityOf(target)
    if (h) effects.push({ kind: 'hostility', key: h.faction, amount: h.amount })
  }
  const notes: string[] = []
  for (const eff of effects) {
    if (!k.effects.has(eff.kind)) continue
    const res = k.effects.resolve([eff], ctx)
    if (res.errors.length > 0) continue
    changes.push(...res.changes)
    notes.push(...res.lines)
  }

  const who = state.actors[by]?.name ?? by
  const first = got.length > 0 ? `${who}把${target.name}身上的義體拆了下來：${got.join('、')}（二手的）。` : `${who}動手拆了${target.name}，沒有一件拆得完好。`
  const lines = [first, ...(target.human ? [`拆的是${target.name}，是活人，行規不認這個。`] : []), ...notes]
  const data = { battle: st.battle, target: target.key, name: target.name, human: target.human, got, by, minutes: DISSECT_MINUTES }
  const beats: TimelineBeat[] = [{ layer: 'meat', actor: by, text: lines[0]!, tag: DISSECT_ACTION, data }]
  for (const text of lines.slice(1)) beats.push({ layer: 'meat', actor: by, text, tag: 'enemies.note' })
  return {
    kind: 'action', action: DISSECT_ACTION, location: clone(state.location), actor: by, party: [], timeline: beats, changes,
    outcome: { result: got.length > 0 ? 'got' : 'nothing', summary: lines.join('') },
    narration: { results: lines },
  }
}
