// L6 功能 lure 的條件與效果（dev/work/M4-lure.md「新的格式與鍵」與第 1、2 點）。
//   條件 lure_open  { ai }：這個流竄 AI 現在可以來——牠的 filter 與 tag 都沒被關掉，而且（主角有牠的標籤，或真正的沉溺超過 open_sink）。
//   條件 lure_mode  { ai, mode }：first（牠有標籤可以給而主角還沒有）、gated（有標籤、沉溺不超過 service_sink）、service（有標籤、超過）；事件資料用它挑三個版本（P24）。
//   條件 lure_count { ai, follow_min?, follow_max? }：順著牠的次數。
//   效果 lure       { ai, choice: follow | refuse | ask }（ai: false，只有內建的來源收）：累計與「牠的事」；沉溺的變化不在這裡（事件的每個選項自己寫 sink）。
//                   follow 另外：主角沒有牠的標籤而牠有 tag 時補一筆 tendency；第 clue_at 次立旗標 lure_clue:<ai>；第 kiss_from 次起照 kiss_chance 給一筆 malware（牠的 kiss）。
//                   ask 另外：照固定的順序揭開下一格還沒揭開的 lore，立旗標 ai_lore:<ai>:<格>；四格都揭開之後沒有新的東西。
//                   tendency、malware 用登錄表跑（查不到就略過；被篩選關掉的 tendency 由它自己落空）。
// 看誰：ctx.actor ?? 主角（條件）；效果落在 ctx.actor 身上，累計記在 state.ext.lure（全局）。

import type { ActorId, Change, Condition, ConditionCtx, Effect, GameState, Kernel } from '../../core'
import { clone, deriveRng, effectCtx, isSafeInt } from '../../core'
import type { Choice, LoreSlot, LureRow } from './model'
import {
  COUNT_CONDITION, EXT, LORE_SLOTS, LURE_EFFECT, MALWARE_EFFECT, MODES, MODE_CONDITION, OPEN_CONDITION, OWNER, TENDENCY_EFFECT,
  CHOICES, clueFlag, entryOf, extValue, isChoice, isMode, isOpen, loreFlag, lureOf, lureRules, modeOf, nowOf, ownsTag, readRow,
} from './model'

interface LureEffect extends Effect { ai: string; choice: Choice }
interface AiCondition extends Condition { ai: string }
interface ModeCondition extends AiCondition { mode: string }
interface CountCondition extends AiCondition { follow_min?: number; follow_max?: number }

const isText = (v: unknown): v is string => typeof v === 'string' && v.trim().length > 0
const whose = (ctx: Pick<ConditionCtx, 'state' | 'actor'>): ActorId | null => {
  const id = ctx.actor ?? ctx.state.pc
  return id && ctx.state.actors[id] ? id : null
}
const unknownFields = (raw: Record<string, unknown>, allowed: readonly string[]): string[] =>
  Object.keys(raw).filter((f) => f !== 'kind' && f !== 'asked' && !allowed.includes(f)).map((f) => `${f}：沒有這個欄位（可以寫：${allowed.join('、')}）`)

// ---- 一筆 lure 效果會做什麼 ----

export interface LurePlan {
  changes: Change[]
  lines: string[]
}

/** 照順序一筆一筆跑內建來源的效果（驗不過、查不到、落空的略過），套在 work 上讓後面的看得到前面的結果。 */
function runNested(k: Kernel, work: GameState, actor: ActorId, fx: Effect, out: LurePlan): void {
  if (!k.effects.has(fx.kind)) return
  const ctx = effectCtx(k, work, { source: 'builtin', actor })
  if (k.effects.validate([fx], ctx).length > 0) return
  const res = k.effects.resolve([fx], ctx)
  if (res.errors.length > 0 || res.changes.length === 0) return
  out.changes.push(...res.changes)
  out.lines.push(...res.lines)
  k.changes.applyAll(work, res.changes)
}

/** 這一筆效果落下去的變更與句子（純函式：同一個狀態同一筆效果結果一樣）。查不到這個流竄 AI 回傳 null。 */
export function lurePlan(k: Kernel, state: GameState, actor: ActorId, e: LureEffect): LurePlan | null {
  const entry = entryOf(k, e.ai)
  if (!entry || !state.actors[actor]) return null
  const rules = lureRules(k)
  const rows = lureOf(state)
  const row: LureRow = rows[e.ai] ?? readRow({})
  const now = nowOf(state)
  const out: LurePlan = { changes: [], lines: [] }
  const flags: Change[] = []
  const nested = new Array<Effect>()
  let line = ''

  if (e.choice === 'follow') {
    row.follow += 1
    line = '你順著牠走了。'
    // 主角沒有牠的標籤、而牠有 tag：得到那個標籤（沒有 → 有）
    if (entry.tag !== undefined && !ownsTag(state, actor, entry)) nested.push({ kind: TENDENCY_EFFECT, tag: entry.tag })
    if (row.follow >= rules.clue_at && state.flags[clueFlag(e.ai)] !== true) flags.push({ op: 'flag', key: clueFlag(e.ai), value: true })
    if (row.follow >= rules.kiss_from && entry.kiss !== undefined && deriveRng(state.rng, `lure/kiss/${e.ai}/${row.follow}/${now}`).next() < rules.kiss_chance) {
      nested.push({ kind: MALWARE_EFFECT, id: entry.kiss })
    }
  } else if (e.choice === 'refuse') {
    row.refused += 1
    line = '你沒有順著牠。'
  } else {
    row.asked += 1
    const slot = LORE_SLOTS.find((s) => !row.lore.includes(s))
    if (slot === undefined) line = '牠沒有再多說什麼。'
    else {
      row.lore.push(slot)
      flags.push({ op: 'flag', key: loreFlag(e.ai, slot), value: true })
      line = `牠說了一點自己的事：${entry.lore[slot]}`
    }
  }
  row.last = now

  out.changes.push({ op: 'ext', key: EXT, value: extValue({ ...rows, [e.ai]: row }) }, ...flags)
  out.lines.push(line)
  const work = clone(state)
  k.changes.applyAll(work, out.changes)
  const tail: LurePlan = { changes: [], lines: [] }
  for (const fx of nested) runNested(k, work, actor, fx, tail)
  out.changes.push(...tail.changes)
  out.lines.push(...tail.lines)
  return out
}

export function installEffects(k: Kernel): void {
  // ---- 條件 ----
  k.conditions.register<AiCondition>({
    kind: OPEN_CONDITION, owner: OWNER,
    validate: (raw) => [...(isText(raw.ai) ? [] : ['ai 要是流竄 AI 的 id']), ...unknownFields(raw, ['ai'])],
    test(c, ctx: ConditionCtx) {
      const who = whose(ctx)
      const e = who ? entryOf(k, c.ai) : undefined
      return !!who && !!e && isOpen(ctx.state, who, e, lureRules(k))
    },
  })

  k.conditions.register<ModeCondition>({
    kind: MODE_CONDITION, owner: OWNER,
    validate: (raw) => [
      ...(isText(raw.ai) ? [] : ['ai 要是流竄 AI 的 id']),
      ...(isMode(raw.mode) ? [] : [`mode 要是 ${MODES.join('、')} 其中一個`]),
      ...unknownFields(raw, ['ai', 'mode']),
    ],
    test(c, ctx: ConditionCtx) {
      const who = whose(ctx)
      const e = who ? entryOf(k, c.ai) : undefined
      return !!who && !!e && modeOf(ctx.state, who, e, lureRules(k)) === c.mode
    },
  })

  k.conditions.register<CountCondition>({
    kind: COUNT_CONDITION, owner: OWNER,
    validate: (raw) => [
      ...(isText(raw.ai) ? [] : ['ai 要是流竄 AI 的 id']),
      ...(['follow_min', 'follow_max'] as const).flatMap((f) => (raw[f] === undefined || (isSafeInt(raw[f]) && (raw[f] as number) >= 0) ? [] : [`${f} 要是 0 以上的整數`])),
      ...unknownFields(raw, ['ai', 'follow_min', 'follow_max']),
    ],
    test(c, { state }: ConditionCtx) {
      const n = lureOf(state)[c.ai]?.follow ?? 0
      return (c.follow_min === undefined || n >= c.follow_min) && (c.follow_max === undefined || n <= c.follow_max)
    },
  })

  // ---- 效果 ----
  k.effects.register<LureEffect>({
    kind: LURE_EFFECT, owner: OWNER, ai: false,
    validate(raw, ctx) {
      const p: string[] = []
      if (!isText(raw.ai)) p.push('ai 要是流竄 AI 的 id')
      else if (!ctx.content.has('rogue_ai', raw.ai)) p.push(`ai：查不到 ${raw.ai} 這個流竄 AI`)
      if (!isChoice(raw.choice)) p.push(`choice 要是 ${CHOICES.join('、')} 其中一個`)
      return [...p, ...unknownFields(raw, ['ai', 'choice'])]
    },
    toChanges: (e, ctx) => lurePlan(k, ctx.state, ctx.actor, e)?.changes ?? [],
    describe: (e, ctx) => lurePlan(k, ctx.state, ctx.actor, e)?.lines.join('；') ?? '什麼也沒有發生。',
  })
}

export type { LoreSlot }
