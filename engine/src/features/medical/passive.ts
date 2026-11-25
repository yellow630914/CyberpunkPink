// L6 功能 medical 的被動效果（來源 wound；dev/adr/0019 第二節與 P46；dev/work/M4-medical.md 第 4 點）。
// 身上有哪一種重的重創（wound_limb、wound_head、wound_torso）就給規則表 wound_effects 那一組；wound_recovering（手術後休養中）給 recovery_effects。
// 只讀角色的狀況與規則表，不讀任何衍生數值（k.passives 的來源函式不能繞回來問數值）。頭的重創沒有數字：眼或腦的義體失效是 cyberware 讀同一個狀況做的。

import type { ActorId, GameState, Kernel, PassiveEffect } from '../../core'
import { WOUND_PARTS, WOUND_RECOVERING, hasCond, medicalRules, woundCondition } from './model'

export function woundPassives(k: Kernel, state: GameState, actor: ActorId): PassiveEffect[] {
  if (!state.actors[actor]) return []
  const rules = medicalRules(k)
  const out: PassiveEffect[] = []
  for (const part of WOUND_PARTS) {
    const id = woundCondition(part)
    if (hasCond(state, actor, id)) out.push(...rules.wound_effects[id])
  }
  if (hasCond(state, actor, WOUND_RECOVERING)) out.push(...rules.recovery_effects)
  return out
}
