// L6 功能 medical 給畫面的總覽：隊上每個人的生命值與狀況、能不能急救與治療、這裡有沒有診所、每一種重創能怎麼處理。
// 每一項的 block 是現在做不了的原因（一句完整的話；能做是 null）；數字與原因都從各個入口的報價來，畫面不自己算。

import type { ActorId, GameState, Kernel } from '../../core'
import { aidBlock, aidQuote } from './aid'
import type { AidQuote } from './aid'
import { clinicBlock, clinicQuote } from './clinic'
import type { ClinicQuote } from './clinic'
import { clinicHere, selfListed } from './common'
import type { ClinicGrade } from './model'
import { AIDED, TREATED, WOUND_RECOVERING, WOUND_NAME, hasCond, maxHpOf, medicalRules, woundsOf } from './model'
import type { WoundPart } from './model'
import { woundSurgeryBlock, woundSurgeryQuote } from './surgery'
import type { WoundSurgeryQuote, WoundVia } from './surgery'

export interface ViewSurgeryOption {
  via: WoundVia
  quote: WoundSurgeryQuote | null
  block: string | null
}

export interface ViewWound {
  part: WoundPart
  name: string
  options: ViewSurgeryOption[]
}

export interface ViewMember {
  id: ActorId
  name: string
  hp: number
  max_hp: number
  treated: boolean
  aided: boolean
  /** 手術後休養到什麼時候（總分鐘）；沒有休養是 null */
  recovering_until: number | null
  wounds: ViewWound[]
  /** 動手的人預設是主角（沒有主角是這個人自己） */
  aid: { by: ActorId; quote: AidQuote | null; block: string | null }
  heal: { quote: ClinicQuote | null; block: string | null }
}

export interface MedicalView {
  /** 腳下的診所；沒有是 null */
  clinic: { name: string; grade: ClinicGrade } | null
  /** 自己動刀有沒有人註冊條件（沒有就不列） */
  self_listed: boolean
  members: ViewMember[]
}

export function medicalView(k: Kernel, state: GameState, opts: { by?: ActorId } = {}): MedicalView {
  const here = clinicHere(k, state)
  const rules = medicalRules(k)
  const by = opts.by ?? state.pc ?? state.party[0] ?? ''
  const selfOk = selfListed(k, rules)
  const members: ViewMember[] = state.party.filter((id) => !!state.actors[id]).map((id) => {
    const a = state.actors[id]!
    const until = a.conditions.find((c) => c.id === WOUND_RECOVERING)?.until
    const wounds: ViewWound[] = woundsOf(state, id).map((part) => ({
      part, name: WOUND_NAME[part],
      options: (['clinic', ...(selfOk ? ['self'] : [])] as WoundVia[]).map((via) => ({
        via, quote: woundSurgeryQuote(k, state, { target: id, part, via, by: via === 'self' ? by : undefined }), block: woundSurgeryBlock(k, state, { target: id, part, via, by: via === 'self' ? by : undefined }),
      })),
    }))
    const doer = state.actors[by] ? by : id
    return {
      id, name: a.name, hp: a.hp, max_hp: maxHpOf(k, state, id),
      treated: hasCond(state, id, TREATED), aided: hasCond(state, id, AIDED), recovering_until: hasCond(state, id, WOUND_RECOVERING) && until !== undefined ? until : null,
      wounds,
      aid: { by: doer, quote: aidQuote(k, state, { by: doer, target: id }), block: aidBlock(k, state, { by: doer, target: id }) },
      heal: { quote: clinicQuote(k, state, { target: id }), block: clinicBlock(k, state, { target: id }) },
    }
  })
  return { clinic: here ? { name: here.name, grade: here.grade } : null, self_listed: selfOk, members }
}
