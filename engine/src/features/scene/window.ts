// L6 功能 scene：成人場景的視窗（掛點 scene.window；M4-core-gaps 第 16 項；CYBERWARE 第 5 節「妖精的吻」擴散階段：自由行動與成人場景裡，牠會插進一個選項，甚至替你選）。
// 玩家這一步要做什麼之前，別的功能可以：插一個選項（option；畫面在 SceneOptions.inserted 列出來，選了就是送出它的 input）、或替玩家選（replace：
// 這一步玩家送出的行動換成它，原因一句話記進這一步的紀錄）。玩家按「停下」不換（結束的決定永遠在玩家手上）；換進去的行動現在做不到（blocks 不是空的）就不換。
// 自由行動的同一種視窗是核心的掛點 action.window。回答的人只讀，不改狀態；沒有人回答什麼都不變。

import type { ActorId, GameState, Kernel } from '../../core'
import { clone, isRecord } from '../../core'
import type { SceneRaw } from './model'
import type { Play, SceneInput } from './play'

/** 掛點 scene.window 的一個回答：兩個鍵都選填、可以一起給。 */
export interface SceneWindowAnswer {
  option?: { id: string; label: string; input: SceneInput }
  replace?: { input: SceneInput; why: string }
}

declare module '../../core' {
  interface HookMap {
    /** 成人場景裡玩家這一步之前的視窗（features/scene 宣告）：state 是現在的狀態，actor 是玩家（主角），scene 是這一場的狀態（唯讀的複本）。 */
    'scene.window': [{ state: GameState; actor: ActorId; scene: SceneRaw }, SceneWindowAnswer | void]
  }
}

/** 視窗的結果：插進來的選項（每個帶是誰插的）與替玩家選的（第一個合格的算數）。 */
export interface SceneWindow {
  options: Array<{ id: string; label: string; input: SceneInput; owner: string }>
  replace?: { input: SceneInput; why: string; owner: string }
}

/** 問 scene.window。p 用來驗行動現在做不做得到（選項不合格的不列、替選不合格的不換）。 */
export function sceneWindow(k: Pick<Kernel, 'hooks'>, state: GameState, p: Play): SceneWindow {
  const out: SceneWindow = { options: [] }
  const pc = p.s.pc
  const input = (v: unknown): SceneInput | undefined => (isRecord(v) && typeof v.kind === 'string' && v.kind !== 'stop' ? (clone(v) as unknown as SceneInput) : undefined)
  for (const h of k.hooks.run('scene.window', { state, actor: pc, scene: clone(p.s) })) {
    const a = h.result
    if (!isRecord(a)) continue
    const o = a.option
    const oi = isRecord(o) ? input(o.input) : undefined
    if (isRecord(o) && typeof o.id === 'string' && o.id && typeof o.label === 'string' && o.label && oi) out.options.push({ id: o.id, label: o.label, input: oi, owner: h.owner })
    const r = a.replace
    const ri = isRecord(r) ? input(r.input) : undefined
    if (!out.replace && isRecord(r) && typeof r.why === 'string' && r.why && ri && p.blocks(pc, ri).length === 0) out.replace = { input: ri, why: r.why, owner: h.owner }
  }
  return out
}
