// L5 戰鬥：對外的幾個函式。每一個都是純函式：讀遊戲狀態，回傳一份報告草稿（或查詢的結果）；交給提交報告才會改狀態。
//
//   startBattle   開打                    → 報告 battle.start
//   battleOptions 現在輪到誰、每個行動能不能做、做不到的原因（畫面照這個顯示，不自己判斷）
//   battleAct     玩家的一步              → 報告 battle.step
//   battleAuto    AI 的一步（或替玩家代打）→ 報告 battle.step
//   endBattle     分出結果之後的結算       → 報告 battle.end（把這場的每一步收成一份）
//
// 戰鬥的每一步是一份報告（dev/adr/0011）：戰鬥狀態只經由 battle 變更改變，存檔、回退、探針都照常。

import type { BattleInput, BattleState, BattleTarget, BattleUnit, Change, GameState, ReportDraft, TimelineBeat } from '../types'
import { partySnapshot } from '../action/action'
import { clone } from '../util/clone'
import { currentUnit, sameTarget, unitTag } from './field'
import { aiStep } from './ai'
import type { BattleActionDef, BattleActionGroup, BattleKernel, BattleTargetKind, BattleTargetOption } from './registry'
import { modeOf } from './rules'
import { BattleRun } from './run'
import type { BattleSetup } from './setup'
import { setupBattle } from './setup'
import { advance } from './turn'

/** 結束回合：核心內建的行動，每個戰場都有。 */
export const END_TURN = 'end_turn'
/** 結束的報告最多留幾拍（太長時保留頭尾；AI_TASKS 3.9 節）。 */
export const TIMELINE_KEEP = { head: 60, tail: 140 }

/** 這一步做不成：原因一條一條列（給玩家看的句子）。狀態不變。 */
export class BattleBlocked extends Error {
  constructor(public readonly reasons: string[]) {
    super(reasons.join(' '))
    this.name = 'BattleBlocked'
  }
}

export interface BattleActionOption {
  id: string
  name: string
  desc: string
  group: BattleActionGroup
  icon?: string
  hold?: boolean
  target: BattleTargetKind
  cost: { ap: number; [pool: string]: number }
  /** 現在能不能做 */
  ok: boolean
  /** 做不到的原因，一條一條列（缺的是哪個條件） */
  blocks: string[]
  /** 可以選的目標；每一個帶著選不了的原因 */
  targets: BattleTargetOption[]
}

export interface BattleOptions {
  battle: string
  round: number
  /** 輪到誰（單位 id）；戰鬥分出結果了是 null */
  current: string | null
  /** 等誰：player 等玩家下指令；ai 呼叫 battleAuto；over 呼叫 endBattle */
  waiting: 'player' | 'ai' | 'over'
  /** 輪到的那個人能做的行動（照圓環的圈與順序）；等的不是玩家時是空的 */
  actions: BattleActionOption[]
}

function optionOf(run: BattleRun, u: BattleUnit, def: BattleActionDef): BattleActionOption {
  const cost = def.cost(run, u)
  const blocks: string[] = []
  if (cost.ap > u.ap.now) blocks.push(`行動點不夠（要 ${cost.ap} 點，現在 ${u.ap.now} 點）。`)
  for (const [pool, v] of Object.entries(cost)) if (pool !== 'ap' && v > (u.pools[pool]?.now ?? 0)) blocks.push(`${pool.toUpperCase()} 不夠（要 ${v}，現在 ${u.pools[pool]?.now ?? 0}）。`)
  blocks.push(...(def.blocks?.(run, u) ?? []))
  const targets = def.target === 'none' ? [] : (def.targets?.(run, u) ?? [])
  if (def.target !== 'none' && targets.length === 0) blocks.push('沒有可以選的目標。')
  const ok = blocks.length === 0 && (def.target === 'none' || targets.some((t) => t.blocks.length === 0))
  return {
    id: def.id, name: def.name, desc: def.desc, group: def.group, ...(def.icon ? { icon: def.icon } : {}), ...(def.hold ? { hold: true } : {}),
    target: def.target, cost, ok, blocks, targets,
  }
}

/** 現在輪到誰、能做什麼。沒有在打回傳 null。 */
export function battleOptions(k: BattleKernel, state: GameState): BattleOptions | null {
  const b = state.battle
  if (!b) return null
  const u = currentUnit(b)
  if (b.result || !u) return { battle: b.id, round: b.round, current: null, waiting: 'over', actions: [] }
  if (u.control !== 'player') return { battle: b.id, round: b.round, current: u.id, waiting: 'ai', actions: [] }
  const run = new BattleRun(k, state, clone(b))
  const me = run.unit(u.id)
  const actions = k.battle.actionsFor(b.mode).filter((d) => !d.has || d.has(run, me)).map((d) => optionOf(run, me, d))
  return { battle: b.id, round: b.round, current: u.id, waiting: 'player', actions }
}

function draftOf(run: BattleRun, action: string, by?: BattleUnit): ReportDraft {
  const b = run.battle
  return {
    kind: 'combat', action, location: clone(run.state.location), ...(by?.actor ? { actor: by.actor } : {}),
    party: [], timeline: run.beats,
    changes: [{ op: 'battle', state: b, step: true }],
    outcome: { result: b.result?.outcome ?? 'step', summary: run.beats.map((x) => x.text).join('') },
  }
}

/** 開打。回傳 battle.start 的報告草稿。 */
export function startBattle(k: BattleKernel, state: GameState, setup: BattleSetup): ReportDraft {
  const run = setupBattle(k, state, setup)
  const draft = draftOf(run, 'battle.start')
  // 戰鬥的 id 用掉一個流水號
  draft.changes.unshift({ op: 'uid', advance: 1 })
  return draft
}

function open(k: BattleKernel, state: GameState): { run: BattleRun; unit: BattleUnit } {
  const b = state.battle
  if (!b) throw new BattleBlocked(['現在沒有在戰鬥。'])
  if (b.result) throw new BattleBlocked(['戰鬥已經結束。'])
  const run = new BattleRun(k, state, clone(b))
  const unit = run.current()
  if (!unit || unit.out) throw new Error('戰鬥的狀態不對：輪到的人不在場上。')
  return { run, unit }
}

/** 做一個行動（花費、行動本身、收尾）。做完之後如果這個人自己退出了，直接往下輪。 */
function perform(run: BattleRun, unit: BattleUnit, def: BattleActionDef, target: BattleTarget | null, input: BattleInput): void {
  run.spend(unit, def.cost(run, unit, input))
  def.run(run, unit, target, input)
  run.settle()
  if (!run.over && unit.out && run.current()?.id === unit.id) advance(run)
}

/**
 * 玩家的一步。不成立（不是輪到玩家、沒有這個行動、條件不符、目標不能選）丟 BattleBlocked，附每一條原因。
 * 回傳 battle.step 的報告草稿。
 */
export function battleAct(k: BattleKernel, state: GameState, input: BattleInput): ReportDraft {
  const { run, unit } = open(k, state)
  if (unit.control !== 'player') throw new BattleBlocked([`現在輪到${unitTag(unit)}，不是你下指令的時候。`])
  const def = k.battle.getAction(input.action)
  if (!def || (def.modes && !def.modes.includes(run.battle.mode)) || (def.has && !def.has(run, unit))) throw new BattleBlocked([`${unit.name} 沒有這個行動。`])
  const opt = optionOf(run, unit, def)
  if (opt.blocks.length) throw new BattleBlocked(opt.blocks)
  let target: BattleTarget | null = null
  if (def.target !== 'none') {
    if (!input.target) throw new BattleBlocked(['要選一個目標。'])
    const t = opt.targets.find((o) => sameTarget(o.target, input.target!))
    if (!t) throw new BattleBlocked(['這個目標不能選。'])
    if (t.blocks.length) throw new BattleBlocked(t.blocks)
    target = t.target
  }
  perform(run, unit, def, target, input)
  return draftOf(run, 'battle.step', unit)
}

/**
 * AI 的一步：輪到的人由程式選一個動作；沒事可做（或做滿了）就結束他的回合。
 * anyone：輪到玩家操縱的人時也由程式代打（沒有畫面的測試、冒煙、自動戰鬥用）；沒給時輪到玩家就丟 BattleBlocked。
 */
export function battleAuto(k: BattleKernel, state: GameState, o: { anyone?: boolean } = {}): ReportDraft {
  const { run, unit } = open(k, state)
  if (unit.control === 'player' && !o.anyone) throw new BattleBlocked([`現在輪到${unit.name}，等玩家下指令。`])
  const acted = aiStep(run, unit)
  run.settle()
  if (!run.over && (!acted || unit.out) && run.current()?.id === unit.id) advance(run)
  return draftOf(run, 'battle.step', unit)
}

/** 戰鬥結束時核心自己的結算：把三條軌寫回角色。 */
function writeBack(k: BattleKernel, state: GameState, b: BattleState): { changes: Change[]; lines: string[] } {
  const changes: Change[] = []
  const lines: string[] = []
  const cap = (id: string, stat: string, fallback: number) => (k.stats.hasStat(stat) ? k.stats.stat(state, id, stat) : fallback)
  for (const u of Object.values(b.units)) {
    if (u.side === 'ally') {
      if (u.out === 'down' || u.out === 'burnout') lines.push(`倒下：${u.name}`)
      else if (u.out === 'subdued') lines.push(`被制伏：${u.name}`)
    }
    const a = u.actor ? state.actors[u.actor] : undefined
    if (!a) continue
    const track = (name: 'hp' | 'load' | 'afterglow' | 'sink', to: number) => {
      const delta = Math.round(to) - a[name]
      if (delta) changes.push({ op: 'actor.track', id: a.id, track: name, delta })
    }
    // 倒下的人帶著傷回來：戰鬥外生命最少剩 1（EVENTS 2.4 節的底線；dev/adr/0013）
    if (u.hp) track('hp', Math.min(Math.max(u.hp.now, 1), Math.max(1, cap(a.id, 'max_hp', u.hp.max))))
    if (u.load) track('load', Math.min(u.load.now, Math.max(0, cap(a.id, 'load_cap', u.load.max) - 1)))
    // 餘韻跟著人走；餘韻疊滿再過載而倒下的：醒來時餘韻清空，沉溺 +2（CORE_RULES 4.2 節）
    track('afterglow', u.out === 'burnout' ? 0 : u.layers)
    const sink = u.sink + (u.out === 'burnout' ? 2 : 0)
    if (sink) track('sink', a.sink + sink)
  }
  for (const u of Object.values(b.units)) if (u.side === 'foe' && u.out === 'subdued') lines.push(`制伏：${u.name}`)
  return { changes, lines }
}

/** 這場戰鬥每一步的紀錄，照順序接起來；太長時保留頭尾。 */
export function battleTimeline(state: GameState, b: BattleState): TimelineBeat[] {
  const ids = new Set(b.steps)
  const beats = state.reports.filter((r) => ids.has(r.id)).flatMap((r) => r.timeline)
  const { head, tail } = TIMELINE_KEEP
  if (beats.length <= head + tail) return clone(beats)
  const skipped = beats.length - head - tail
  return clone([...beats.slice(0, head), { layer: beats[0]!.layer, text: `（中間略過 ${skipped} 拍）` }, ...beats.slice(-tail)])
}

export const OUTCOME_NAME: Record<string, string> = { win: '勝利', lose: '戰敗', fled: '脫離', surrender: '投降' }

/**
 * 戰鬥分出結果之後的結算：三條軌寫回角色、功能加進來的變更（掉落、用掉的道具、傷勢……）、把這場的每一步收成一份報告。
 * 還沒分出結果就丟錯。回傳 battle.end 的報告草稿；交給提交之後 state.battle 變回 null。
 */
export function endBattle(k: BattleKernel, state: GameState): ReportDraft {
  const b = state.battle
  if (!b) throw new Error('現在沒有在戰鬥。')
  if (!b.result) throw new Error('這場戰鬥還沒有分出結果。')
  const outcome = b.result.outcome
  const core = writeBack(k, state, b)
  const extras = k.battle.endExtras({ k, state, battle: b, outcome })
  const changes: Change[] = [...core.changes, ...extras.flatMap((x) => x.changes ?? []), { op: 'battle', state: null, fold: true }, { op: 'rng', advance: 1 }]
  const lines = [...core.lines, ...extras.flatMap((x) => x.lines ?? [])]
  const after = clone(state)
  k.changes.applyAll(after, changes)
  const mode = modeOf(k.content, b.mode)
  const foes = Object.values(b.units).filter((u) => u.side === 'foe').map((u) => u.name)
  const summary = `${b.origin.place ? `${b.origin.place}：` : ''}和${[...new Set(foes)].join('、')}打了 ${b.round} 回合，${OUTCOME_NAME[outcome] ?? outcome}。${b.result.text}${lines.map((l) => `${l}。`).join('')}`
  return {
    kind: mode?.layer === 'net' ? 'netrun' : 'combat', action: 'battle.end', location: clone(state.location), ...(state.pc ? { actor: state.pc } : {}),
    party: partySnapshot(k, state, after),
    timeline: battleTimeline(state, b),
    changes,
    outcome: { result: outcome, summary },
    narration: { results: lines },
  }
}
