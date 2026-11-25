// 條件 ability 與日常技能（SKILLS 1.2、1.11 節；SKILL_TREES 改造師「預備與日常」；dev/work/M4-abilities-m4.md）。
// 日常技能「做什麼」不在這裡（手術在 cyberware 與 medical、解剖在 enemies、工坊在 craft、解鎖匠在 cyberware），這裡只讓別人問得到「這個人有沒有」：
//   條件 ability { id?, daily?, who?, equipped? }
//     id        學會了那個技能（equipped: true 時要裝著；夜課延伸的技能是 night:<夜課的 id>）
//     daily     裝著一個帶這種日常的技能（技能資料 daily.kind，例：surgery、dissect、workshop、unlock）；日常一定要裝著才算
//     who       看誰（名冊上的人的角色 id）；沒給是 ctx.actor，再沒有是主角
//   id 與 daily 都寫時兩個都要成立。夥伴（沒有自己的學習紀錄、有 ext.paths）：路數那棵樹階數以內的技能算學會也算裝著。
//   讀的只有 actor.ext.abilities、ext.paths 與（夜課延伸的）actor.ext.scene.skills；不呼叫任何衍生數值，所以可以放心寫在被動效果的 if 裡。
// 裝著帶 daily.kind 是 dissect 的技能的人，進戰鬥（現實與內海）時單位多一個標籤 dissect（內海的戰後掉落 needs: dissect 看它；battle.ts 的 applyPassives）。

import type { Condition, ConditionCtx, Kernel } from '../../core'
import { abilityEntry } from './outside'
import { holdingOf } from './stats'
import type { AbilityEntry } from './types'
import { OWNER } from './types'

/** 單位身上的標籤：裝著帶這種日常的技能就有（解剖：內海的掉落 needs: dissect 讀它）。 */
export const DISSECT_TAG = 'dissect'
export const DISSECT_DAILY = 'dissect'

/** 一個技能帶哪一種日常（沒有是 undefined）。 */
export const dailyKindOf = (ab: Pick<AbilityEntry, 'daily'> | undefined): string | undefined => {
  const kind = ab?.daily?.kind
  return typeof kind === 'string' && kind.length > 0 ? kind : undefined
}

interface AbilityCondition extends Condition {
  id?: string
  daily?: string
  who?: string
  equipped?: boolean
}

const isText = (v: unknown): v is string => typeof v === 'string' && v.trim().length > 0

export function registerCondition(k: Kernel): void {
  k.conditions.register<AbilityCondition>({
    kind: 'ability', owner: OWNER,
    validate: (raw) => {
      const p: string[] = []
      for (const key of Object.keys(raw)) if (!['kind', 'id', 'daily', 'who', 'equipped'].includes(key)) p.push(`${key}：沒有這個欄位（可以寫：id、daily、who、equipped）`)
      if (raw.id === undefined && raw.daily === undefined) p.push('要寫 id（技能的 id）或 daily（日常的種類）其中一個')
      if (raw.id !== undefined && !isText(raw.id)) p.push('id 要是技能的 id')
      if (raw.daily !== undefined && !isText(raw.daily)) p.push('daily 要是日常的種類（例如 surgery、dissect、workshop、unlock）')
      if (raw.who !== undefined && !isText(raw.who)) p.push('who 要是角色的 id')
      if (raw.equipped !== undefined && typeof raw.equipped !== 'boolean') p.push('equipped 要是 true 或 false')
      return p
    },
    test: (c, ctx: ConditionCtx) => {
      const who = c.who ?? ctx.actor ?? ctx.state.pc
      if (!who || !ctx.state.actors[who]) return false
      const held = holdingOf(k, ctx.state, who)
      if (c.id !== undefined && !(c.equipped === true ? held.equipped : held.learned).includes(c.id)) return false
      if (c.daily !== undefined && !held.equipped.some((id) => dailyKindOf(abilityEntry(k, id)) === c.daily)) return false
      return true
    },
  })
}
