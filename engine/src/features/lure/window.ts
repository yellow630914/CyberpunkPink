// L6 功能 lure 的視窗：妖精的吻擴散階段「替你做決定」的另一半（CYBERWARE 第 5 節「擴散」：自由行動與成人場景裡，牠會插進一個選項，甚至替你選；
// dev/work/M4-lure.md 總指揮補記；M4-core-gaps 第 16 項）。事件端（觸發點 kiss_choose）在 spread.ts；這裡是兩種視窗：
//   自由行動（核心的掛點 action.window）：玩家送出一個自由行動時，插一個選項（牠給的那句話），機率中了就直接把這一次換成牠給的那句話；
//   成人場景（features/scene 的掛點 scene.window）：玩家這一步之前，插一個選項（牠挑的那個行動），機率中了就替玩家做這個行動（玩家按「停下」不換）。
// 牠的資料是 rogue_ai 的 whisper 欄位（沒寫 whisper 的就只有事件端）。什麼時候算「擴散階段」跟事件端一樣：身上有牠的吻、進到擴散（條件 malware stage 2）、牠的篩選沒被關掉；沒有人註冊
// 惡意韌體的條件就沒有。抽籤用 deriveRng（同一個狀態同一個結果）。只讀，不改狀態、不寫旗標。

import type { ActionInput, ActionWindowAnswer, GameState, Kernel } from '../../core'
import { deriveRng } from '../../core'
import { MALWARE_CONDITION, WINDOW_WHY, allEntries, allowed } from './model'
import type { RogueAiEntry } from './model'

/** 這一刻主角身上有牠的吻、而且進到擴散階段的每一個流竄 AI（資料有寫 whisper 的）。 */
export function spreadingWindows(k: Kernel, state: GameState): RogueAiEntry[] {
  const pc = state.pc
  if (!pc || !state.actors[pc] || !k.conditions.kinds().includes(MALWARE_CONDITION)) return []
  const ctx = { state, stats: k.stats, timeRules: k.timeRules, actor: pc }
  return allEntries(k).filter((e) => e.whisper !== undefined && e.kiss !== undefined && allowed(state, e) && k.conditions.test({ kind: MALWARE_CONDITION, id: e.kiss, stage: 2 }, ctx))
}

const hits = (state: GameState, e: RogueAiEntry, key: string): boolean => {
  const chance = e.whisper?.replace_chance ?? 0
  return chance > 0 && deriveRng(state.rng, `lure/window/${e.id}/${key}`).next() < chance
}

/** 掛點 action.window：自由行動的視窗。 */
export function freeWindow(k: Kernel, state: GameState, input: ActionInput): ActionWindowAnswer | undefined {
  if (input.kind !== 'free') return undefined
  const e = spreadingWindows(k, state).find((x) => x.whisper?.free !== undefined)
  if (!e || !e.whisper?.free) return undefined
  const option = { id: `lure:${e.id}`, label: e.whisper.label, input: { kind: 'free', text: e.whisper.free } as ActionInput }
  const replace = hits(state, e, `free/${state.seq.chain}`) ? { input: option.input, why: e.whisper.why ?? WINDOW_WHY } : undefined
  return { option, ...(replace ? { replace } : {}) }
}

/** 掛點 scene.window：成人場景的視窗（scene 是這一場的狀態；只認 id 與 step 兩個欄位）。 */
export function sceneWindowAnswer(k: Kernel, state: GameState, scene: { id: string; step: number }): { option?: { id: string; label: string; input: { kind: string } }; replace?: { input: { kind: string }; why: string } } | undefined {
  const e = spreadingWindows(k, state).find((x) => x.whisper?.scene !== undefined)
  if (!e || !e.whisper?.scene) return undefined
  const input = { kind: e.whisper.scene.kind }
  const replace = hits(state, e, `scene/${scene.id}/${scene.step}`) ? { input, why: e.whisper.why ?? WINDOW_WHY } : undefined
  return { option: { id: `lure:${e.id}`, label: e.whisper.label, input }, ...(replace ? { replace } : {}) }
}
