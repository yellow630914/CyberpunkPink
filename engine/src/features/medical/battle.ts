// L6 功能 medical 的戰鬥效果 op wound_treat（戰地手術、全面翻修的現實欄用；SKILL_TREES 改造師；dev/work/M4-medical.md 第 6 點）。
// 落在 who 指到的那個人身上：他在這一場的重創，輕的直接解除（狀態拿掉）、重的降成輕的（軀幹的生命值上限與橋的承受層數加回來；肢體的重創命中 −4 回到輕的數字；
// 護甲失效是「直到修理」，不在這裡還）；all: true 是全部清掉。只在現實的戰場做得了。
// 狀態的名字照 features/combat 的約定（limb_hurt、dazed、bleeding），這裡不 import 它。
// part 寫了就只處理那一個部位（features/combat 的效果 op wound 在現實的戰場轉呼叫這一套：M4-followups-2 第 5 項，兩邊只有一份邏輯）。

import type { BattleEffectCtx, BattleUnit, Kernel } from '../../core'
import { BattleBlocked, unitTag } from '../../core'

export const WOUND_TREAT_OP = 'wound_treat'
const OWNER = 'medical'
/** 重創的四個部位與輕的那一級的狀態（橋的輕傷是感載 +10，沒有狀態）。 */
const PARTS = ['limb', 'head', 'torso', 'bridge'] as const
const LIGHT: Record<string, string | undefined> = { limb: 'limb_hurt', head: 'dazed', torso: 'bleeding' }
const PART_NAME: Record<string, string> = { limb: '肢體', head: '頭', torso: '軀幹', bridge: '橋' }
const TORSO_HP_LOSS = 5

function treatOp(ctx: BattleEffectCtx, e: Record<string, unknown>): void {
  const { run } = ctx
  if (run.mode.layer !== 'meat') throw new BattleBlocked(['戰地手術只在現實的戰場做得了。'])
  const unit: BattleUnit | undefined = ctx.unit
  if (!unit || run.isStandIn(unit)) return
  const clear = e.all === true
  for (const part of PARTS) {
    if (typeof e.part === 'string' && e.part !== part) continue
    const level = unit.wounds[part] ?? 0
    if (!level) continue
    if (level === 2) {
      if (part === 'torso' && unit.hp) unit.hp.max += TORSO_HP_LOSS
      else if (part === 'bridge') unit.layersMax += 1
    }
    const light = LIGHT[part]
    if (level === 2 && !clear) {
      unit.wounds[part] = 1
      if (part === 'limb') run.applyStatus(unit, 'limb_hurt', { quiet: true })
    } else {
      delete unit.wounds[part]
      if (light) run.removeStatus(unit, light, true)
    }
    run.say(`${unitTag(unit)} 的${PART_NAME[part]}${level === 2 && !clear ? '傷勢減輕了，只剩輕傷' : '傷處理好了'}。`, undefined, { target: unit.id, part, level: unit.wounds[part] ?? 0 }, ctx.user)
  }
}

export function installBattle(k: Kernel): void {
  k.battle.effect(WOUND_TREAT_OP, OWNER, treatOp, {
    problems: (e) => {
      const p: string[] = []
      for (const key of Object.keys(e)) if (!['op', 'who', 'if', 'all', 'part'].includes(key)) p.push(`${key}：沒有這個欄位（可以寫：who、if、all、part）`)
      if (e.all !== undefined && typeof e.all !== 'boolean') p.push('all 要是 true 或 false')
      if (e.part !== undefined && !(typeof e.part === 'string' && (PARTS as readonly string[]).includes(e.part))) p.push(`part 要是 ${PARTS.join('、')} 其中一個`)
      return p
    },
  })
}
