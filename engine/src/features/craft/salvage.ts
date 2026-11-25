// L6 craft 的拆解與畫設計圖（CRAFTING 10.4 節、第 11 節第一條；dev/adr/0019 第四節；dev/work/M4-craft-salvage.md）。
// 背包裡的一件成品拆成零件：要在住處（level_min self_home_level）或帶 craft 的設施；有授權鎖的先解鎖；穿戴中的先脫下來。
// 每個零件各擲一次完好：機率 ＝ salvage_base ＋ 做的人那一項基本功（義體用義體學、其餘用機械）× salvage_per_skill，最多 salvage_max。
//   完好的回背包：內容的零件是 { state: 'used', uid } 的一疊（和全新的分開放）；內嵌的零件（未登錄零件）整筆放回（核心的 partStack，不改內容）。
//   沒過的報廢；生體的零件一律報廢（拆了就死，CRAFTING 8.1 節）；成品那一疊拿掉；時間加 salvage_minutes。
// 一件成品的零件全部完好拆下來、而且還不會做那張設計圖：學會它（known 多一筆；第三個來源，CRAFTING 第 11 節）。
// 骰子一律 deriveRng（用途 craft.salvage/<成品的 uid>）；擲過骰的報告多一筆 { op: 'rng', advance: 1 }。
// 不做：「失敗的零件降一級」（零件是內容的一筆，沒有低一級的對應；M4-craft-salvage 回報）。

import type { ActorId, BlueprintEntry, Change, GameState, Kernel, ProductData, ReportDraft, TimelineBeat } from '../../core'
import { ActionBlocked, clone, deriveRng } from '../../core'
import type { CraftRules } from './model'
import { SALVAGE_ACTION, craftOf, craftRules, isKnown, knownChange, nameOf, workbenchHere } from './model'
import type { Fitted } from './parts'
import { USED_PART_UID_PREFIX, byBlock, byOf, dataOf, fittedOf, needsUid, productStack, usedPartChange, wornUid } from './parts'
import { skillFor } from './preview'

export interface SalvageOpts {
  /** 背包裡那一件成品的 uid */
  uid: string
  /** 動手的人（主角或隊上的人；預設主角） */
  by?: ActorId
}

/** 一個零件拆下來會怎樣。bio：生體，一律報廢（不擲）；lost：內容查不到這個零件，沒有東西可以拆；roll：擲一次，chance 是完好的機率。 */
export interface SalvageLine {
  type: string
  /** 零件的 id（內嵌的是 unreg:<uid>；內容查不到的是引用本身） */
  id: string
  name: string
  fate: 'roll' | 'bio' | 'lost'
  /** 完好的機率（0～1）；bio 與 lost 是 0 */
  chance: number
  /** 是未登錄零件（拆下來整筆回背包） */
  unreg: boolean
}

export interface SalvagePreview {
  blueprint: { id: string; name: string; kind: string; grade: number } | null
  uid: string
  by: ActorId
  /** 擲完好的那一項基本功與做的人現在的級數 */
  skill: string
  skillName: string
  level: number
  parts: SalvageLine[]
  minutes: number
  /** 零件全部完好拆下來就會學會這張設計圖（還不會做，而且沒有生體與查不到的零件） */
  teaches: boolean
  /** 全部不能拆的原因（一條一句）；能拆是空陣列 */
  problems: string[]
  block: string | null
}

interface SalvagePlan {
  preview: SalvagePreview
  bp?: BlueprintEntry
  rules: CraftRules
  by: ActorId
  data?: ProductData
  fitted: Fitted[]
}

const refId = (f: Fitted): string => f.part?.id ?? (typeof f.ref === 'string' ? f.ref : 'unreg')

function planSalvage(k: Kernel, state: GameState, o: SalvageOpts): SalvagePlan {
  const rules = craftRules(k)
  const by = byOf(state, o.by)
  const problems: string[] = []
  const act = k.activity.blockOf(state, `commit:${SALVAGE_ACTION}`)
  if (act) problems.push(act)
  const empty = (): SalvagePlan => ({
    preview: { blueprint: null, uid: o.uid, by, skill: rules.skills.mech, skillName: k.stats.skillName(rules.skills.mech), level: 0, parts: [], minutes: rules.salvage_minutes, teaches: false, problems, block: problems[0] ?? null },
    rules, by, fitted: [],
  })

  if (!state.actors[by]) problems.push('找不到動手的人。')
  else {
    const b = byBlock(state, by)
    if (b) problems.push(b)
  }
  const found = productStack(k, state, o.uid)
  if (!found) {
    problems.push('背包裡沒有這一件成品。')
    return empty()
  }
  const { stack, bp } = found
  const data = dataOf(k, stack)
  if (!workbenchHere(k, state, rules)) problems.push('拆解要在有工作台的住處（二級以上）或有工作台的店面。')
  if (data.lock !== undefined) problems.push('有授權鎖的東西要先解鎖。')
  if (wornUid(state, o.uid)) problems.push('穿戴中的東西要先脫下來。')

  const skill = skillFor(rules, bp, false)
  const level = state.actors[by]?.skills[skill] ?? 0
  const chance = Math.max(0, Math.min(rules.salvage_max, rules.salvage_base + level * rules.salvage_per_skill))
  const fitted = fittedOf(k, bp, data)
  const lines: SalvageLine[] = fitted.map((f) => ({
    type: f.type, id: refId(f), name: f.part?.name ?? refId(f),
    fate: !f.part ? 'lost' : f.part.material === 'bio' ? 'bio' : 'roll',
    chance: f.part && f.part.material !== 'bio' ? chance : 0,
    unreg: f.part?.unreg === true,
  }))
  const teaches = lines.length > 0 && lines.every((l) => l.fate === 'roll') && !isKnown(state, bp.id)
  const preview: SalvagePreview = {
    blueprint: { id: bp.id, name: bp.name, kind: bp.kind, grade: bp.grade },
    uid: o.uid, by, skill, skillName: k.stats.skillName(skill), level, parts: lines, minutes: rules.salvage_minutes, teaches, problems, block: problems[0] ?? null,
  }
  return { preview, bp, rules, by, data, fitted }
}

/** 拆解的預覽：每個零件完好的機率、全部完好會不會學會設計圖；不改狀態、不擲骰。 */
export const salvagePreview = (k: Kernel, state: GameState, o: SalvageOpts): SalvagePreview => planSalvage(k, state, o).preview
/** 拆解現在行不行：全部的原因（一條一句）；行是空陣列。 */
export const salvageProblems = (k: Kernel, state: GameState, o: SalvageOpts): string[] => planSalvage(k, state, o).preview.problems
/** 拆解現在行不行：第一條原因；行是 null。 */
export const salvageBlock = (k: Kernel, state: GameState, o: SalvageOpts): string | null => planSalvage(k, state, o).preview.block

/**
 * 拆一件成品。不成立丟 ActionBlocked（salvageProblems 的第一條）。
 * 報告 craft.salvage：outcome.result 是 all（全部完好）、some、none；narration.results 第一句是結果，學會設計圖時第二句寫明。
 */
export function salvageDraft(k: Kernel, state: GameState, o: SalvageOpts): ReportDraft {
  const plan = planSalvage(k, state, o)
  const pv = plan.preview
  if (pv.problems.length > 0 || !plan.bp || !plan.data) throw new ActionBlocked(pv.problems[0] ?? '現在拆不了。')
  const { bp, by, fitted } = plan
  const purpose = `${SALVAGE_ACTION}/${o.uid}`
  const rng = deriveRng(state.rng, purpose)

  const good: Fitted[] = []
  const scrapped: Fitted[] = []
  let rolled = false
  fitted.forEach((f, i) => {
    const line = pv.parts[i]!
    if (line.fate === 'roll') {
      rolled = true
      if (rng.next() < line.chance) good.push(f)
      else scrapped.push(f)
    } else scrapped.push(f)
  })

  const changes: Change[] = [{ op: 'item', id: bp.id, qty: -1, data: { uid: o.uid } }]
  let seq = state.seq.uid
  let used = 0
  for (const f of good) {
    const uid = `${USED_PART_UID_PREFIX}${seq + 1}`
    const c = usedPartChange(f.ref, f.part!, uid)
    if (!c) continue
    changes.push(c)
    if (needsUid(f.ref, f.part!)) {
      seq++
      used++
    }
  }
  if (used > 0) changes.push({ op: 'uid', advance: used })

  const allGood = fitted.length > 0 && good.length === fitted.length
  const learns = allGood && !isKnown(state, bp.id)
  if (learns) changes.push(knownChange(state, [...craftOf(state).known, bp.id]))
  changes.push({ op: 'time', minutes: pv.minutes })
  if (rolled) changes.push({ op: 'rng', advance: 1 })

  const who = nameOf(state, by)
  const names = (list: Fitted[]): string => list.map((f) => f.part?.name ?? refId(f)).join('、')
  const bioN = scrapped.filter((f) => f.part?.material === 'bio').length
  const lines: string[] = []
  if (good.length === 0) lines.push(`${who}把${bp.name}拆開了，沒有一個零件是完好的${fitted.length > 0 ? `（${names(scrapped)}都報廢了）` : ''}。`)
  else if (scrapped.length === 0) lines.push(`${who}把${bp.name}拆開了，零件全都完好：${names(good)}。`)
  else lines.push(`${who}把${bp.name}拆開了，拆下完好的${names(good)}；${names(scrapped)}報廢了。`)
  if (bioN > 0) lines.push('生體的零件拆了就死，沒有辦法留下來。')
  if (learns) lines.push(`對著拆開的零件把圖畫了出來，學會了${bp.name}的組法。`)

  const result = good.length === 0 ? 'none' : scrapped.length === 0 ? 'all' : 'some'
  const data: Record<string, unknown> = {
    uid: o.uid, bp: bp.id, by, minutes: pv.minutes,
    good: good.map(refId), scrapped: scrapped.map(refId), learned: learns,
  }
  const beats: TimelineBeat[] = [{ layer: 'meat', actor: by, text: lines[0]!, tag: SALVAGE_ACTION, data }]
  for (const text of lines.slice(1)) beats.push({ layer: 'meat', actor: by, text, tag: 'craft.note' })
  return {
    kind: 'action', action: SALVAGE_ACTION, location: clone(state.location), actor: by, party: [], timeline: beats, changes,
    outcome: { result, summary: lines.join('') },
    narration: { results: lines },
  }
}
