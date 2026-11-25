// L5 戰鬥：對外的幾個函式。每一個都是純函式：讀遊戲狀態，回傳一份報告草稿（或查詢的結果）；交給提交報告才會改狀態。
//
//   startBattle   開打                    → 報告 battle.start
//   battleOptions 現在輪到誰、每個行動能不能做、做不到的原因（畫面照這個顯示，不自己判斷）
//   battleAct     玩家的一步              → 報告 battle.step
//   battleAuto    AI 的一步（或替玩家代打）→ 報告 battle.step
//   endBattle     分出結果之後的結算       → 報告 battle.end（把這場的每一步收成一份）
//   abortBattle   打到一半不打了（重來）   → 報告 battle.abort（一樣把每一步收成一份，不結算）
//
// 戰鬥的每一步是一份報告（dev/adr/0011）：戰鬥狀態只經由 battle 變更改變，存檔、回退、探針都照常。

import type { BattleInput, BattleState, BattleTarget, BattleUnit, Change, GameState, Origin, ReportDraft, TimelineBeat } from '../types'
import { partySnapshot } from '../action/action'
import { attachActivityEnd, endActivity } from '../action/activity'
import { clone } from '../util/clone'
import { currentUnit, distancesFrom, poolShort, sameTarget, unitTag } from './field'
import { BattleBlocked, performAction } from './act'
import { aiStep } from './ai'
import type { BattleActionDef, BattleActionGroup, BattleKernel, BattlePick, BattleTargetKind, BattleTargetOption } from './registry'
import { actionCost, actionIcon, flashBlock } from './registry'
import { SINK_RESIST, modeOf, sinkRise } from './rules'
import { BattleRun } from './run'
import type { BattleSetup } from './setup'
import { setupBattle } from './setup'
import { advance } from './turn'

export { BattleBlocked, performAction }

/** 結束回合：核心內建的行動，每個戰場都有。 */
export const END_TURN = 'end_turn'
/** 結束的報告最多留幾拍（太長時保留頭尾；AI_TASKS 3.9 節）。 */
export const TIMELINE_KEEP = { head: 60, tail: 140 }

export interface BattleActionOption {
  id: string
  name: string
  desc: string
  group: BattleActionGroup
  /** 圖示的鍵（每個行動都有；畫面自己對照到圖） */
  icon: string
  hold?: boolean
  target: BattleTargetKind
  /** 目標以外還要選的東西（道具、武器、無人機、打誰、放哪一格……）；沒有就是空的。畫面照這個列出來讓玩家選 */
  picks: BattlePick[]
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
  /**
   * 輪到的人到對面每個還在場上的單位、每一台沒被擊落的掛著的東西的距離：鍵是那個單位（f1）或那一台（o3）的 id，值是核心的 distance（我的格 ＋ 他的格 − 1）。
   * 每次都帶；沒有人輪到（分出結果了）是空的。畫面不必自己算
   */
  distances: Record<string, number>
}

function optionOf(run: BattleRun, u: BattleUnit, def: BattleActionDef): BattleActionOption {
  const cost = actionCost(run, u, def)
  const blocks: string[] = []
  if (cost.ap > u.ap.now) blocks.push(`行動點不夠（要 ${cost.ap} 點，現在 ${u.ap.now} 點）。`)
  for (const [pool, v] of Object.entries(cost)) if (pool !== 'ap' && v > (u.pools[pool]?.now ?? 0)) blocks.push(poolShort(pool, v, u.pools[pool]?.now ?? 0))
  const flash = flashBlock(run, u, cost)
  if (flash) blocks.push(flash)
  blocks.push(...(def.blocks?.(run, u) ?? []))
  const targets = def.target === 'none' ? [] : (def.targets?.(run, u) ?? [])
  if (def.target !== 'none' && targets.length === 0) blocks.push('沒有可以選的目標。')
  const ok = blocks.length === 0 && (def.target === 'none' || targets.some((t) => t.blocks.length === 0))
  return {
    id: def.id, name: def.name, desc: def.desc, group: def.group, icon: actionIcon(def), ...(def.hold ? { hold: true } : {}),
    target: def.target, picks: def.picks?.(run, u) ?? [], cost, ok, blocks, targets,
  }
}

/** 現在輪到誰、能做什麼。沒有在打回傳 null。 */
export function battleOptions(k: BattleKernel, state: GameState): BattleOptions | null {
  const b = state.battle
  if (!b) return null
  const u = currentUnit(b)
  if (b.result || !u) return { battle: b.id, round: b.round, current: null, waiting: 'over', actions: [], distances: {} }
  const distances = distancesFrom(b, u)
  if (u.control !== 'player') return { battle: b.id, round: b.round, current: u.id, waiting: 'ai', actions: [], distances }
  const run = new BattleRun(k, state, clone(b))
  const me = run.unit(u.id)
  const actions = k.battle.actionsFor(b.mode).filter((d) => !d.has || d.has(run, me)).map((d) => optionOf(run, me, d))
  return { battle: b.id, round: b.round, current: u.id, waiting: 'player', actions, distances }
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

/** 做一個行動與收尾。做完之後如果這個人自己退出了，直接往下輪。 */
function perform(run: BattleRun, unit: BattleUnit, def: BattleActionDef, target: BattleTarget | null, input: BattleInput): void {
  performAction(run, unit, def, target, input)
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
    // 餘韻跟著人走；餘韻疊滿再過載而倒下的：醒來時餘韻清空，沉溺 +2（CORE_RULES 4.2 節）。
    // battle.field.safe 的場地（迷宮館的熔斷保護，CYBERSPACE 8.2 節；dev/adr/0018）不加這 +2（戰鬥中自己累積的沉溺照算）
    track('afterglow', u.out === 'burnout' ? 0 : u.layers)
    const sink = u.sink + (u.out === 'burnout' && b.field.safe !== true ? sinkRise(2, u.tags.includes(SINK_RESIST)) : 0)
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

export const OUTCOME_NAME: Record<string, string> = { win: '勝利', lose: '戰敗', fled: '脫離', surrender: '投降', jack_out: '全員拔線' }

/** 這個結果算不算戰敗（全隊倒下，或投降；COMBAT_SYSTEM 8.1、8.5 節）：戰敗之後等玩家三選一（8.4 節）。 */
export const isDefeat = (outcome: string): boolean => outcome === 'lose' || outcome === 'surrender'

/**
 * 等著玩家三選一的戰敗（接受結果、重來這場戰鬥、回到這個階段開始時；COMBAT_SYSTEM 8.4 節）：
 * 打輸或投降的那一場已經結算、開打前的快照還留著的期間。這段時間不能做別的事。沒有在等回傳 null。
 */
export function pendingDefeat(state: GameState): { snapshot: string; battle: string; outcome: string } | null {
  if (state.battle) return null
  for (let i = state.snapshots.length - 1; i >= 0; i--) {
    const slot = state.snapshots[i]!
    const lost = slot.kind === 'battle' ? slot.data?.lost : undefined
    if (lost && typeof lost === 'object') {
      const l = lost as { battle?: unknown; outcome?: unknown }
      return { snapshot: slot.id, battle: String(l.battle ?? ''), outcome: String(l.outcome ?? 'lose') }
    }
  }
  return null
}

/** 這一方還站著的人數（沒有退出的；在後方等著的也算）。 */
const standing = (b: BattleState, side: 'ally' | 'foe'): number => Object.values(b.units).filter((u) => u.side === side && !u.out).length

/** 一場戰鬥是誰發起的：取自 battle.origin.ext（沒有 by 當 core）；by 與 ref 以外的鍵放在 origin.ext（battleSetupWithOrigin 的反向）。 */
export function originOfBattle(ext: Record<string, unknown> | undefined): Origin {
  const { by, ref, ...rest } = ext ?? {}
  return {
    by: typeof by === 'string' && by ? by : 'core',
    ...(typeof ref === 'string' ? { ref } : {}),
    ...(Object.keys(rest).length ? { ext: clone(rest) } : {}),
  }
}

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
  // 開打前的快照（COMBAT_SYSTEM 8.4 節）：打輸與投降之後留著，等玩家三選一（標上是哪一場輸的）；其餘的結果就是定案，丟掉。
  // 放在功能的變更前面：功能可以接著把它丟掉（沒有戰敗事件可以接受時）
  const snapshot: Change[] = !state.snapshots.some((x) => x.kind === 'battle') ? []
    : isDefeat(outcome) ? [{ op: 'snapshot.mark', kind: 'battle', data: { lost: { battle: b.id, outcome } } }]
      : [{ op: 'snapshot.drop', kind: 'battle' }]
  // 結束交回（dev/adr/0016 第一節）：發 activity.end，處理函式回傳的變更接在功能的變更後面、句子進結果、launch 與 rewind 放到報告上
  const end = endActivity(k, {
    state, kind: 'battle', id: b.id, origin: originOfBattle(b.origin.ext), outcome,
    result: { battle: b.id, grade: b.grade, standing: { ally: standing(b, 'ally'), foe: standing(b, 'foe') } },
  })
  const changes: Change[] = [...core.changes, ...snapshot, ...extras.flatMap((x) => x.changes ?? []), ...end.changes, { op: 'battle', state: null, fold: true }, { op: 'rng', advance: 1 }]
  const lines = [...core.lines, ...extras.flatMap((x) => x.lines ?? []), ...end.lines]
  const triggers = extras.flatMap((x) => x.triggers ?? [])
  const after = clone(state)
  k.changes.applyAll(after, changes)
  const mode = modeOf(k.content, b.mode)
  const foes = Object.values(b.units).filter((u) => u.side === 'foe').map((u) => u.name)
  const summary = `${b.origin.place ? `${b.origin.place}：` : ''}和${[...new Set(foes)].join('、')}打了 ${b.round} 回合，${OUTCOME_NAME[outcome] ?? outcome}。${b.result.text}${lines.map((l) => `${l}。`).join('')}`
  return attachActivityEnd({
    kind: mode?.layer === 'net' ? 'netrun' : 'combat', action: 'battle.end', location: clone(state.location), ...(state.pc ? { actor: state.pc } : {}),
    party: partySnapshot(k, state, after),
    timeline: battleTimeline(state, b),
    changes,
    outcome: { result: outcome, summary },
    narration: { results: lines },
    // 功能要掛在結束報告上的觸發點（BattleEndExtra.triggers；例：沉溺過了線的敵人 foe_sunk）
    ...(triggers.length ? { triggers } : {}),
  }, end)
}

/**
 * 打到一半不打了（重來這場戰鬥；COMBAT_SYSTEM 8.4 節）：把這一場到現在的每一步收成一份報告，不結算（三條軌不寫回、沒有掉落、沒有戰敗事件）。
 * 外殼接著回到開打前的快照，這一份會留在紀錄裡、標成被收回：紀錄裡一場戰鬥只有一筆，重來幾次就是幾筆，不是幾百筆（dev/adr/0011）。
 */
export function abortBattle(k: BattleKernel, state: GameState): ReportDraft {
  const b = state.battle
  if (!b) throw new Error('現在沒有在戰鬥。')
  const mode = modeOf(k.content, b.mode)
  const foes = [...new Set(Object.values(b.units).filter((u) => u.side === 'foe').map((u) => u.name))]
  return {
    kind: mode?.layer === 'net' ? 'netrun' : 'combat', action: 'battle.abort', location: clone(state.location), ...(state.pc ? { actor: state.pc } : {}),
    party: [], timeline: battleTimeline(state, b),
    changes: [{ op: 'battle', state: null, fold: true }],
    outcome: { result: 'aborted', summary: `${b.origin.place ? `${b.origin.place}：` : ''}和${foes.join('、')}打到第 ${b.round} 回合，沒有打完。` },
  }
}
