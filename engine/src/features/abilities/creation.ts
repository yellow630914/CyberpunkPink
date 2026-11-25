// L6 功能 abilities 的建角（M4-creation-body；CHARACTER 第 1 節第 8 步與 2.1 節；SKILLS 1.3 節；dev/adr/0019 第十一節與 P53、P54；dev/work/M4-creation-body.md）。
//
// 掛點 creation.step 的 abilities（第 8 步，features/creation 宣告；這裡只認名字與格式，不 import）：picks 是技能的 id，照學的順序。
//   對一份從 0 開始、歷練點是存檔規則 startXp 的技能狀態，逐一跑學技能的規則（learnBlock：樹的階、前置、歷練點）；選了「沒有橋」（draft.bridge 是 null）一個都不能學。
//   提交時：actor.ext.abilities 是學會的、每棵樹的累計、剩下的歷練點。草稿沒寫 abilities（舊的給法）時不回答，主角的歷練點照舊從 0 開始。
// 另外聽 report.after：creation.commit 之後接一份 ability.loadout，照學的順序把學的技能裝進橋，容量裝不下的跳過（P54）；建角不花遊戲時間，也不看地點。

import type { Actor, ActorId, Change, GameState, Kernel, ReportDraft } from '../../core'
import { abilitiesOf, capacityBlock, capacityFor, learnBlock, reportOf } from './learn'
import { maskChanges } from './loadout'
import { abilityEntry } from './outside'
import type { AbilityEntry, AbilityState } from './types'
import { OWNER } from './types'

interface DraftLike { bridge?: string | null; abilities?: unknown }
interface Payload { state: GameState; draft: DraftLike; step: string; picks: unknown[] }
interface Answer { took: number[]; blocks?: string[]; points?: number; changes?: Change[]; notes?: string[] }

const PC = 'pc'
export const NO_BRIDGE_ABILITY = '沒有橋就裝不了技能。'
export const CREATION_LOADOUT = 'ability.loadout'

/** 檢查學技能的規則用的一個空角色：只有 ext.abilities 有東西（建角之前還沒有主角）。 */
const stub = (mine: AbilityState): Actor => ({
  id: PC, role: 'pc', name: '', age: 18, gender: 'female', attrs: { reflex: 10, charm: 10, intellect: 10, body: 10, resolve: 10, tech: 10 },
  skills: {}, perks: [], hp: 1, load: 0, afterglow: 0, sink: 0, conditions: [], ext: { abilities: mine },
})

/** 掛點 creation.step 的回答：第 8 步。 */
export function answerCreation(k: Kernel, p: Payload): Answer | void {
  if (p.step !== 'abilities' || p.draft.abilities === undefined) return
  const took: number[] = []
  const ids: string[] = []
  p.picks.forEach((pick, index) => {
    if (typeof pick === 'string' && abilityEntry(k, pick)) {
      took.push(index)
      ids.push(pick)
    }
  })
  const start: AbilityState = { xp: p.state.rules.startXp, learned: [], equipped: [], spent: {} }
  const blocks: string[] = []
  let mine = start
  if (p.draft.bridge === null) {
    if (ids.length > 0) blocks.push(NO_BRIDGE_ABILITY)
  } else {
    for (const id of ids) {
      const ab = abilityEntry(k, id) as AbilityEntry
      const trial = { ...p.state, actors: { ...p.state.actors, [PC]: stub(mine) } } as GameState
      const why = learnBlock(k, trial, PC, id)
      if (why) {
        blocks.push(`${ab.name}：${why}`)
        continue
      }
      mine = { ...mine, xp: mine.xp - ab.xp, learned: [...mine.learned, id], spent: { ...mine.spent, [ab.path]: (mine.spent[ab.path] ?? 0) + ab.xp } }
    }
  }
  return { took, blocks, points: start.xp - mine.xp, changes: [{ op: 'actor.ext', id: PC, key: 'abilities', value: mine }] }
}

/** 建角之後把學的技能照順序裝進橋：能放進容量的裝上，放不下的跳過。沒有東西可裝就是 null。 */
export function creationLoadoutDraft(k: Kernel, state: GameState, actor: ActorId): ReportDraft | null {
  const mine = abilitiesOf(state, actor)
  let list: string[] = []
  const skipped: string[] = []
  for (const id of mine.learned) {
    const next = [...list, id]
    if (capacityBlock(capacityFor(k, state, actor, next)) === null) list = next
    else skipped.push(id)
  }
  if (list.length === 0) return null
  const names = (ids: string[]): string => ids.map((id) => abilityEntry(k, id)?.name ?? id).join('、')
  const summary = `起手學的技能照順序裝進了橋：${names(list)}。${skipped.length > 0 ? `容量放不下的沒有裝：${names(skipped)}。` : ''}`
  const report = reportOf(state, actor, CREATION_LOADOUT, { ...mine, equipped: list }, summary, 'loadout')
  report.changes.push(...maskChanges(k, state, actor, mine.equipped, list))
  return report
}

type AnyHook = (name: string, owner: string, fn: (payload: never) => unknown) => void

export function registerCreation(k: Kernel): void {
  // 掛點 creation.step 是 features/creation 宣告的：這裡只認名字與格式
  ;(k.hooks.on.bind(k.hooks) as unknown as AnyHook)('creation.step', OWNER, ((p: Payload) => answerCreation(k, p)) as never)
  k.hooks.on('report.after', OWNER, ({ state, report }): ReportDraft[] | void => {
    if (report.action !== 'creation.commit' || !state.pc) return
    const draft = creationLoadoutDraft(k, state, state.pc)
    return draft ? [draft] : undefined
  })
}
