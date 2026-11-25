// L6 功能 drugs 的被動效果與條件（來源 drug、withdrawal；dev/adr/0019 第二節與 P20；dev/work/M4-drugs.md 第 2、5、7 點）。
//   drug        身上有效的每一種藥的 effects 與 side（needs_bridge 而這個人明寫沒有橋的不給）、藥效過後 after.effects 還沒過期的、抑制劑生效中的下限與看到的沉溺
//   withdrawal  戒斷中的每一種藥的懲罰（重度的每一筆 ×2；身上有一種 eases_withdrawal 的藥生效中時每一筆減半，無條件捨去、最少 1）、抑制劑的停藥反彈
// 只讀 actor.ext.drugs、物品的 drug 欄位與規則表，不讀任何衍生數值（k.passives 的來源函式不能繞回來問數值）。
// 抑制劑「溺感者無效」：條件 sunk（M4-sink 註冊）成立的人不給；沒有人註冊就當作不成立。寫成每一筆的 if（不在來源函式裡測）：k.passives 繞圈時會自己處理。
// 節奏資源（ap_regen、ram_regen）：來源標 drug，核心合計全身最多 +1（P13）；要給回復一律寫 { mod: 'ap_regen' }，不要寫成狀態的 mods（來源會變 status）。

import type { ActorId, Condition, GameState, Kernel, PassiveEffect } from '../../core'
import { isRecord } from '../../core'
import { drugDef, drugRules, isLive, isUnbridged, nowOf, readDrugs } from './model'
import type { DrugDef } from './model'

export const SUNK_CONDITION = 'sunk'
export const SUPPRESSANT_LABEL = '抑制劑'
export const REBOUND_LABEL = '停藥反彈'

/** 加上 label（沒寫的用藥的名字）。 */
const labelled = (list: PassiveEffect[], label: string): PassiveEffect[] => list.filter(isRecord).map((e) => ({ label, ...e }) as PassiveEffect)

/** 溺感者無效：有人註冊了 sunk 才加這個條件。 */
function notSunk(k: Pick<Kernel, 'conditions'>): Condition[] {
  return k.conditions.kinds().includes(SUNK_CONDITION) ? [{ kind: 'not', of: { kind: SUNK_CONDITION } }] : []
}

/** 這個人身上現在有一種 eases_withdrawal 的藥生效中嗎。 */
export function easesWithdrawal(k: Pick<Kernel, 'content'>, state: Pick<GameState, 'actors' | 'time'>, actor: ActorId): boolean {
  const now = nowOf(state)
  return readDrugs(state, actor).active.some((a) => isLive(a, now) && drugDef(k, a.id)?.eases_withdrawal === true)
}

/** 戒斷的每一筆：重度 ×2，鎮靜（eases）再減半（無條件捨去、最少 1）。沒有 amount 的（unit_tag）原樣。 */
export function scaledWithdrawal(list: PassiveEffect[], heavy: boolean, eases: boolean): PassiveEffect[] {
  return list.filter(isRecord).map((e) => {
    const amount = (e as { amount?: unknown }).amount
    if (typeof amount !== 'number') return { ...e } as PassiveEffect
    let v = heavy ? amount * 2 : amount
    if (eases) v = Math.sign(v) * Math.max(1, Math.floor(Math.abs(v) / 2))
    return { ...e, amount: v } as PassiveEffect
  })
}

/** 一種藥現在給的被動效果（effects 加 side）；沒有橋的人吃了 needs_bridge 的藥是空的。 */
export function drugEffects(def: DrugDef, unbridged: boolean): PassiveEffect[] {
  if (def.needs_bridge && unbridged) return []
  return labelled([...def.effects, ...def.side], def.name)
}

/** 來源 drug：生效中的藥、藥效過後的 after.effects、抑制劑。 */
export function drugPassives(k: Kernel, state: GameState, actor: ActorId): PassiveEffect[] {
  if (!state.actors[actor] || !isRecord(state.actors[actor]!.ext.drugs)) return []
  const now = nowOf(state)
  const d = readDrugs(state, actor)
  const unbridged = isUnbridged(state, actor)
  const out: PassiveEffect[] = []
  const seen = new Set<string>()
  for (const a of d.active) {
    if (!isLive(a, now) || seen.has(a.id)) continue
    seen.add(a.id)
    const def = drugDef(k, a.id)
    if (def) out.push(...drugEffects(def, unbridged))
  }
  for (const p of d.pending) {
    if (p.kind !== 'after' || p.at <= now) continue
    const def = drugDef(k, p.drug)
    if (def?.after && !(def.needs_bridge && unbridged)) out.push(...labelled(def.after.effects, `${def.name}（藥效過後）`))
  }
  const s = d.suppressant
  if (s?.until !== undefined && s.until > now) {
    const rules = drugRules(k).suppressant
    const guard = notSunk(k)
    if (rules.floor !== 0) out.push({ stat: 'sink_floor', amount: rules.floor, label: SUPPRESSANT_LABEL, ...(guard.length ? { if: guard } : {}) })
    if (rules.shown !== 0) out.push({ stat: 'sink_shown', amount: rules.shown, label: SUPPRESSANT_LABEL, ...(guard.length ? { if: guard } : {}) })
  }
  return out
}

/** 來源 withdrawal：戒斷中的懲罰與抑制劑的停藥反彈。 */
export function withdrawalPassives(k: Kernel, state: GameState, actor: ActorId): PassiveEffect[] {
  if (!state.actors[actor] || !isRecord(state.actors[actor]!.ext.drugs)) return []
  const now = nowOf(state)
  const d = readDrugs(state, actor)
  const out: PassiveEffect[] = []
  const rows = Object.entries(d.withdrawal).filter(([, w]) => w.until > now)
  if (rows.length > 0) {
    const eases = easesWithdrawal(k, state, actor)
    for (const [id, w] of rows) {
      const def = drugDef(k, id)
      if (!def?.addiction) continue
      out.push(...labelled(scaledWithdrawal(def.addiction.withdrawal.effects, w.heavy, eases), `${def.name}的戒斷`))
    }
  }
  const s = d.suppressant
  if (s?.rebound_until !== undefined && s.rebound_until > now) {
    const rebound = drugRules(k).suppressant.rebound
    const guard = notSunk(k)
    if (rebound !== 0) out.push({ stat: 'sink_floor', amount: rebound, label: REBOUND_LABEL, ...(guard.length ? { if: guard } : {}) })
  }
  return out
}
