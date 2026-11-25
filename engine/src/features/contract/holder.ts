// L6 功能 contract 主角是持約人時玩家主動做的事（M4-contract-holder；LEWD_SYSTEM 7.5 節、7.3 節、7.8 節；EVENTS 4.5 節最後三條；dev/adr/0019 第八節）。
// 都是「問的函式（回傳原因或 null）加做的函式（回傳報告草稿）」；不成立時草稿丟 ActionBlocked，原因是給玩家看的完整句子、一次只講一條。
// 面板不直接改任何人的參數：觸發只發觸發點（事件由導演從範圍 contract 挑，內容是資料）；調整只改契約上寫的東西；參數只因為事件而變。
//
//   holderEvents                 現在能對他做的五種事（派差事、送去改造、叫來侍奉、安排工作、談一談）各自能不能做與原因
//   triggerBlock／triggerDraft   觸發一件事：他對主角的親密度低於 resist_below、或這一種在紙上被劃掉時，他先擲定力（同一條 DC 公式、用他的馴化）；
//                                抗命成功 → contract.refuse（主角對他的親密度 −2、他的忠誠 −5，這一次不成立、照樣算今天用過）；
//                                否則 contract.trigger（觸發點 holder_order，where { order, npc, relation }；他的照做次數 +1、每滿 docility_every 次馴化 +1）。同一個人同一種一天一次
//   adjustBlock／adjustDraft     調整契約：規矩、住處、工作的安排、分帳、主僕關係、出借。報告 contract.adjust
//   releaseBlock／releaseDraft   解約。報告 contract.release
// 面板的資料在 holderView.ts（唯讀）。

import type { GameState, Kernel, ReportDraft, TimelineBeat } from '../../core'
import { ActionBlocked, contentAllowed, rollCheck } from '../../core'
import { RESIST_ATTR, RESIST_SKILL, RESIST_TAGS, draftOf, resistPlan, rollBeat } from './draft'
import type { ResistPlan } from './draft'
import type { ContractRule, Home, Held, HolderEventKind, Relation } from './model'
import {
  ADJUST_ACTION, AFFINITY, HAS_HOME, HOLDER_EVENTS, HOLDER_EVENT_NAME, HOLDER_POINT, HOMES, JOB_LEN, LEND_TO_LEN, LOYALTY, PAPER_KIND, REFUSE_ACTION, RELATIONS, RELATION_NAME,
  RELEASE_ACTION, RULE_TYPES, TRIGGER_ACTION, contractRules, dayOf, extChange, extOf, isHome, isHolderEvent, isRelation, isRuleType, isText, nowOf, pcOf,
} from './model'
import { affinityOf, docilityStep, meterDelta, nameOf, releasePlan, releasedTrigger } from './held'

const DOM_TAGS = new Set<HolderEventKind>(['modify', 'serve'])
const dom = (state: GameState): boolean => contentAllowed(state.rules, 'contract_dom')

/** 他是主角持有的人嗎。 */
export const heldIn = (state: GameState, npc: string): Held | undefined => (Object.hasOwn(extOf(state).held, npc) ? extOf(state).held[npc] : undefined)

/** 主角持有的所有契約（照契約人的 id）。回傳的是複製：呼叫的人不能靠它改狀態。 */
export const heldOf = (state: GameState): Record<string, Held> => extOf(state).held

/** 給 M5（派工、住戶、家務）：主角持約的每一個人與他住在哪。 */
export const heldPeople = (state: GameState): Array<{ id: string; home: Home }> =>
  Object.entries(extOf(state).held).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)).map(([id, h]) => ({ id, home: h.home }))

const lentText = (state: GameState, npc: string, h: Held): string => `${nameOf(state, npc)}現在被借給${h.lent!.to}了，要等他回來才能再叫他。`

// ---- 觸發事件 ----

export interface TriggerOpts {
  npc: string
  kind: HolderEventKind
}

/** 這一種事在紙上有沒有被劃掉（talk 沒有紙上的格子）。 */
export const crossedOut = (h: Held, kind: HolderEventKind): boolean => {
  const paper = PAPER_KIND[kind]
  return paper !== null && !h.orders.includes(paper)
}

/** 這一次他會不會先擲抗拒：親密度低於 resist_below，或這一種在紙上被劃掉。 */
export const willRoll = (k: Kernel, state: GameState, npc: string, h: Held, kind: HolderEventKind): boolean =>
  affinityOf(k, state, npc) < contractRules(k).holder.resist_below || crossedOut(h, kind)

/** 現在觸發不了的原因（一條）；觸發得了是 null。 */
export function triggerBlock(k: Kernel, state: GameState, o: TriggerOpts): string | null {
  const pc = pcOf(state)
  const h = heldIn(state, o.npc)
  if (!pc || !h || !state.actors[o.npc]) return '他不是你持有契約的人。'
  if (!isHolderEvent(o.kind)) return '要選一種事。'
  if (DOM_TAGS.has(o.kind) && !dom(state)) return '「契約支配」的題材關著，這一類的事現在不會出現。'
  if (h.lent) return lentText(state, o.npc, h)
  if (h.triggered[o.kind] === dayOf(state)) return `今天已經對${nameOf(state, o.npc)}做過「${HOLDER_EVENT_NAME[o.kind]}」了，明天再說。`
  return k.activity.blockOf(state, `commit:${TRIGGER_ACTION}`)
}

export interface HolderEvent {
  kind: HolderEventKind
  name: string
  available: boolean
  /** 做不了的原因（做得了是 null） */
  reason: string | null
  /** 紙上劃掉了這一種（照樣做得了，橋不會替他擋；他可能會不肯） */
  crossed_out: boolean
  /** 他會先擲抗拒嗎；擲的話 DC 與他抗命成功的機率 */
  resist: { dc: number; chance: number } | null
}

/** 現在能對他做的事：照他的狀態列五種（契約支配關掉時不列 modify、serve），各自的原因一句。唯讀。 */
export function holderEvents(k: Kernel, state: GameState, npc: string): HolderEvent[] {
  const h = heldIn(state, npc)
  if (!h || !state.actors[npc]) return []
  return HOLDER_EVENTS.filter((kind) => !(DOM_TAGS.has(kind) && !dom(state))).map((kind): HolderEvent => {
    const reason = triggerBlock(k, state, { npc, kind })
    const roll = willRoll(k, state, npc, h, kind)
    const plan = roll ? resistPlan(k, state, npc, h) : null
    return { kind, name: HOLDER_EVENT_NAME[kind], available: reason === null, reason, crossed_out: crossedOut(h, kind), resist: plan ? { dc: plan.dc, chance: plan.chance } : null }
  })
}

const TRIGGER_TEXT: Record<HolderEventKind, (who: string) => string> = {
  errand: (who) => `你把一件差事交給了${who}。`,
  modify: (who) => `你送${who}去改造。`,
  serve: (who) => `你叫${who}過來。`,
  work: (who) => `你替${who}安排了工作。`,
  talk: (who) => `你找${who}談了一談。`,
}

/** 觸發一件事。 */
export function triggerDraft(k: Kernel, state: GameState, o: TriggerOpts): ReportDraft {
  const why = triggerBlock(k, state, o)
  if (why) throw new ActionBlocked(why)
  const ext = extOf(state)
  const h = ext.held[o.npc]!
  const rules = contractRules(k).holder
  const who = nameOf(state, o.npc)
  const label = HOLDER_EVENT_NAME[o.kind]
  h.triggered[o.kind] = dayOf(state)
  if (willRoll(k, state, o.npc, h, o.kind)) {
    const plan: ResistPlan = resistPlan(k, state, o.npc, h)
    const roll = rollCheck(k.stats, state, { actor: o.npc, attr: RESIST_ATTR, skill: RESIST_SKILL, dc: plan.dc, purpose: `${TRIGGER_ACTION}/${o.npc}/${o.kind}/${dayOf(state)}`, tags: RESIST_TAGS })
    if (roll.degree === 'success' || roll.degree === 'critical') {
      const changes = [
        { op: 'rng', advance: 1 } as const, extChange(ext),
        ...meterDelta(k, AFFINITY, o.npc, rules.refuse_affinity), ...meterDelta(k, LOYALTY, o.npc, rules.refuse_loyalty),
      ]
      return draftOf(state, 'action', REFUSE_ACTION, changes, [`你想叫${who}去做「${label}」，他不肯：${who}頂住了橋的拉扯，你們之間冷了一點。`], 'refused', { beats: [rollBeat(o.npc, roll, 'contract.roll')] })
    }
    return triggered(k, state, o, [{ op: 'rng', advance: 1 }], [rollBeat(o.npc, roll, 'contract.roll')])
  }
  return triggered(k, state, o, [], [])
}

/** 他沒有抗命：照做次數 +1、每滿 docility_every 次馴化 +1；發觸發點，事件由導演挑。 */
function triggered(k: Kernel, state: GameState, o: TriggerOpts, pre: ReportDraft['changes'], beats: TimelineBeat[]): ReportDraft {
  // state 在 triggerDraft 裡已經被 extOf 複製過一次；這裡重讀、套上今天用過的紀錄
  const ext = extOf(state)
  const h = ext.held[o.npc]!
  h.triggered[o.kind] = dayOf(state)
  h.complied += 1
  const who = nameOf(state, o.npc)
  const step = docilityStep(k, state, o.npc, h.complied)
  const lines = [TRIGGER_TEXT[o.kind](who), ...(step.line ? [step.line] : [])]
  return draftOf(state, 'action', TRIGGER_ACTION, [...pre, extChange(ext), ...step.changes], lines, 'triggered', {
    triggers: [{ point: HOLDER_POINT, where: { order: o.kind, npc: o.npc, relation: h.relation } }], beats,
  })
}

// ---- 調整契約 ----

export interface AdjustPatch {
  /** 加幾條規矩 */
  rules_add?: ContractRule[]
  /** 拿掉幾條規矩（kind 與 value 都對上的） */
  rules_remove?: ContractRule[]
  home?: Home
  /** 工作的安排：一句話或一份工作的 id；null 是清掉 */
  job?: string | null
  /** 收入他拿幾成（0～1） */
  split?: number
  relation?: Relation
  /** 借給別人 { to, hours? }；null 是叫他回來 */
  lend?: { to: string; hours?: number } | null
}

export interface AdjustOpts {
  npc: string
  patch: AdjustPatch
}

const PATCH_KEYS = ['rules_add', 'rules_remove', 'home', 'job', 'split', 'relation', 'lend'] as const
const sameRule = (a: ContractRule, b: ContractRule): boolean => a.kind === b.kind && a.value === b.value

const ruleProblem = (r: unknown): string | null => {
  const x = r as Partial<ContractRule> | null
  if (!x || typeof x !== 'object' || !isRuleType(x.kind)) return `規矩的種類只能是 ${RULE_TYPES.join('、')}。`
  if (!(isText(x.value) || (typeof x.value === 'number' && Number.isFinite(x.value)))) return '規矩要寫內容（地方、時間、服裝或人的名字）。'
  if (x.kind === 'zone' && typeof x.value !== 'string') return '禁區要寫成區或街區的名字。'
  return null
}

/** 現在借出去的限制：戀人不借、「NTR」關掉時親密度夠高的人不借、契約支配關掉時不出借；一次借一個地方。 */
export function lendBlock(k: Kernel, state: GameState, npc: string): string | null {
  const h = heldIn(state, npc)
  if (!h) return '他不是你持有契約的人。'
  const who = nameOf(state, npc)
  if (h.lent) return `${who}已經借給${h.lent.to}了。`
  if (h.relation === 'lover') return `${who}是你的戀人：你不會把他借給別人。`
  if (!dom(state)) return '「契約支配」的題材關著，出借這一類的事現在不會出現。'
  if (!contentAllowed(state.rules, 'ntr') && affinityOf(k, state, npc) >= contractRules(k).holder.ntr_affinity) return `「NTR」的題材關著，而${who}和你太親近了，不會借給別人。`
  return null
}

/** 這一個主僕關係現在能不能選（名實相符永遠可以；其餘要他對主角的親密度到 relation_min）。 */
export function relationBlock(k: Kernel, state: GameState, npc: string, to: Relation): string | null {
  const h = heldIn(state, npc)
  if (!h) return '他不是你持有契約的人。'
  if (to === h.relation) return `你們已經是「${RELATION_NAME[to]}」了。`
  const min = contractRules(k).holder.relation_min
  if (to !== 'formal' && affinityOf(k, state, npc) < min) return `${nameOf(state, npc)}對你的親密度還不到 ${min}，不能選「${RELATION_NAME[to]}」。`
  if (to === 'lover' && h.lent) return `${nameOf(state, npc)}還借在${h.lent.to}那裡，先讓他回來。`
  return null
}

/** 他要住在據點：主角要有住處（有人註冊 has_home 才檢查；沒有人註冊就都可以）。 */
export function homeBlock(k: Kernel, state: GameState, npc: string, to: Home): string | null {
  const h = heldIn(state, npc)
  if (!h) return '他不是你持有契約的人。'
  if (to === h.home) return to === 'base' ? `${nameOf(state, npc)}已經住在你的據點了。` : `${nameOf(state, npc)}已經住在自己的地方了。`
  if (to === 'base' && k.conditions.kinds().includes(HAS_HOME) && !k.conditions.test({ kind: HAS_HOME }, { state, actor: pcOf(state) ?? undefined, stats: k.stats, timeRules: k.timeRules })) return '你還沒有住處，沒有地方讓他住進來。'
  return null
}

/** 現在調整不了的原因（一條）；整份都調得了是 null。每一項各自的規則。 */
export function adjustBlock(k: Kernel, state: GameState, o: AdjustOpts): string | null {
  const h = heldIn(state, o.npc)
  if (!pcOf(state) || !h) return '他不是你持有契約的人。'
  const p = o.patch as Record<string, unknown> | null
  if (!p || typeof p !== 'object') return '沒有要改的地方。'
  const keys = Object.keys(p)
  const unknown = keys.find((f) => !(PATCH_KEYS as readonly string[]).includes(f))
  if (unknown) return `契約上沒有「${unknown}」這一項可以調（能調的：規矩、住處、工作的安排、分帳、主僕關係、出借）。`
  if (keys.filter((f) => p[f] !== undefined).length === 0) return '沒有要改的地方。'
  const patch = o.patch
  if (patch.rules_add !== undefined) {
    if (!Array.isArray(patch.rules_add) || patch.rules_add.length === 0) return '要加的規矩要寫成 { kind, value } 的清單。'
    for (const r of patch.rules_add) {
      const bad = ruleProblem(r)
      if (bad) return bad
    }
    const dup = patch.rules_add.find((r, i) => h.rules.some((x) => sameRule(x, r)) || patch.rules_add!.findIndex((y) => sameRule(y, r)) !== i)
    if (dup) return '這一條規矩已經寫在契約上了。'
  }
  if (patch.rules_remove !== undefined) {
    if (!Array.isArray(patch.rules_remove) || patch.rules_remove.length === 0) return '要拿掉的規矩要寫成 { kind, value } 的清單。'
    const missing = patch.rules_remove.find((r) => !h.rules.some((x) => sameRule(x, r)))
    if (missing) return '契約上沒有這一條規矩可以拿掉。'
  }
  if (patch.home !== undefined) {
    if (!isHome(patch.home)) return `住處只能是 ${HOMES.join('、')}。`
    const why = homeBlock(k, state, o.npc, patch.home)
    if (why) return why
  }
  if (patch.job !== undefined) {
    if (patch.job === null) {
      if (h.job === undefined) return '他現在沒有安排工作。'
    } else if (!isText(patch.job) || patch.job.length > JOB_LEN) return `工作的安排要寫成一句話（最多 ${JOB_LEN} 個字）。`
    else if (patch.job === h.job) return '工作的安排已經是這樣了。'
  }
  if (patch.split !== undefined) {
    if (typeof patch.split !== 'number' || !Number.isFinite(patch.split) || patch.split < 0 || patch.split > 1) return '分帳要寫成 0 到 1 之間的數字（收入他拿幾成）。'
    if (patch.split === h.split) return '分帳已經是這樣了。'
  }
  if (patch.relation !== undefined) {
    if (!isRelation(patch.relation)) return `主僕關係只能是 ${RELATIONS.map((r) => RELATION_NAME[r]).join('、')}。`
    const why = relationBlock(k, state, o.npc, patch.relation)
    if (why) return why
  }
  if (patch.lend !== undefined) {
    if (patch.lend === null) {
      if (!h.lent) return `${nameOf(state, o.npc)}現在沒有借給別人。`
    } else {
      const l = patch.lend
      if (!l || typeof l !== 'object' || !isText(l.to) || l.to.length > LEND_TO_LEN) return `要寫借給誰（最多 ${LEND_TO_LEN} 個字）。`
      if (l.hours !== undefined && !(typeof l.hours === 'number' && Number.isFinite(l.hours) && l.hours > 0 && l.hours <= 24 * 90)) return '借多久要寫成大於 0 的小時數。'
      const why = lendBlock(k, state, o.npc)
      if (why) return why
      // 同一份調整裡改成戀人又要借出去：互相衝突
      if (patch.relation === 'lover') return `${nameOf(state, o.npc)}要成為你的戀人：你不會把他借給別人。`
    }
  }
  return k.activity.blockOf(state, `commit:${ADJUST_ACTION}`)
}

/** 預設借出的時數：規則表的期限（出借 24 小時）。 */
const defaultLendHours = (k: Kernel): number => {
  const spec = contractRules(k).deadline_hours.lend
  return typeof spec === 'number' ? spec : 24
}

export function adjustDraft(k: Kernel, state: GameState, o: AdjustOpts): ReportDraft {
  const why = adjustBlock(k, state, o)
  if (why) throw new ActionBlocked(why)
  const ext = extOf(state)
  const h = ext.held[o.npc]!
  const who = nameOf(state, o.npc)
  const patch = o.patch
  const lines: string[] = []
  if (patch.rules_remove) {
    h.rules = h.rules.filter((x) => !patch.rules_remove!.some((r) => sameRule(r, x)))
    lines.push(`你把${patch.rules_remove.length}條規矩從${who}的契約上拿掉了。`)
  }
  if (patch.rules_add) {
    h.rules.push(...patch.rules_add.map((r) => ({ kind: r.kind, value: r.value })))
    lines.push(`你在${who}的契約上加了${patch.rules_add.length}條規矩。`)
  }
  if (patch.home) {
    h.home = patch.home
    lines.push(patch.home === 'base' ? `${who}搬進了你的據點。` : `${who}搬回自己的地方住。`)
  }
  if (patch.job !== undefined) {
    if (patch.job === null) {
      delete h.job
      lines.push(`你把${who}的工作安排撤掉了。`)
    } else {
      h.job = patch.job
      lines.push(`你替${who}安排了工作：${patch.job}。`)
    }
  }
  if (patch.split !== undefined) {
    h.split = patch.split
    lines.push(`${who}的收入，你讓他拿${Math.round(patch.split * 100)}%。`)
  }
  if (patch.relation) {
    h.relation = patch.relation
    lines.push(`你和${who}的關係改成了「${RELATION_NAME[patch.relation]}」。`)
  }
  if (patch.lend !== undefined) {
    if (patch.lend === null) {
      delete h.lent
      lines.push(`你把${who}叫了回來。`)
    } else {
      const hours = patch.lend.hours ?? defaultLendHours(k)
      h.lent = { to: patch.lend.to, until: nowOf(state) + Math.round(hours * 60) }
      lines.push(`你把${who}借給了${patch.lend.to}。`)
    }
  }
  return draftOf(state, 'action', ADJUST_ACTION, [extChange(ext)], lines, 'adjusted')
}

// ---- 解約 ----

export interface ReleaseOpts {
  npc: string
  /** 解約之後他留在名冊上（什麼都不發）；沒寫是不留，發觸發點 released 讓名冊或事件決定他走不走 */
  stay?: boolean
}

export function releaseBlock(k: Kernel, state: GameState, o: ReleaseOpts): string | null {
  if (!pcOf(state) || !heldIn(state, o.npc)) return '他不是你持有契約的人。'
  return k.activity.blockOf(state, `commit:${RELEASE_ACTION}`)
}

/** 解約永遠是選項（遊戲會記得：旗標 released:<npc>）。 */
export function releaseDraft(k: Kernel, state: GameState, o: ReleaseOpts): ReportDraft {
  const why = releaseBlock(k, state, o)
  if (why) throw new ActionBlocked(why)
  const h = heldIn(state, o.npc)!
  const end = releasePlan(state, o.npc, { stay: o.stay === true })!
  return draftOf(state, 'action', RELEASE_ACTION, end.changes, [end.text], o.stay ? 'released_stay' : 'released', o.stay ? {} : { triggers: releasedTrigger(o.npc, h.relation) })
}
