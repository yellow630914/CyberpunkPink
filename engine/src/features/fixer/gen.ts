// L6 功能 fixer 的委託生成：照類型的模板生成一件具體的委託（副本加簡報加未知清單），回答中間人「今天有哪些委託」（掛點 fixer.offers）。
// AI 不參與：這是 commission_gen（AI_TASKS 3.17 節）的退路，也就是第 1、3 步（組骨架、驗證並建立副本）；AI 寫內容的那一步之後再接。
// 規格：COMMISSIONS 第 7 節（類型表）、7.1 節（階段怎麼排、中型與大型多的階段）、7.2 節、第 9 節、2.3 節「每個副本要寫的欄位」；
//   FIXER 第 2 節「未知清單」、第 3 節；ENEMIES 第 13 節；SITES 12.3 節；AI_TASKS 3.17 節；dev/adr/0016 第五節；dev/work/M2-commission-gen.md。
//
// 這個檔不 import 別的功能：副本只當成資料寫出去（格式照 commission 這個內容種類）；敵人只經由單位來源 enemy_pick（挑得到才生成）；
// 哪些面有人登記玩法只問 k.activity；信譽只經由量表 rep 與衍生數值 rep_grade；地圖與勢力只讀內容。內容一律是資料，這裡沒有任何一種類型。
//
// 新的內容種類（這個功能定義）：
//   commission_type      { id, name, main, decisive, stages: [{ name?, faces }]（小型的三個階段）, extra: [{ name?, faces }]（中型與大型插進去的階段）,
//                          branches: { stealth?, talk? }（基本功的 id）, brief（一句帶空格的話：{faction}、{district}、{place}、{fixer}）, gives: { [面]: [連動的 id] } }
//   commission_modifier  { id, name, text, effect: { lock_face?: { stage, face }, attached?: [{ enemy, count? }], foes_plus?, alert_start?, stage? } }
//   commission_link      { id, name, from: 面, to: 面, type: skip|ease|open, effect? }
// 規則（commission_rule/default 的另一部分，commission 的功能只讀它自己的欄位）：reward_range（每一級的報酬範圍）、scales_by_tier（每個信譽階給哪幾種規模）、
//   encounters（每一級的遭遇組合：normal 是一般的階段、last 是最後一個階段）。
//
// 幾個解讀（設計書沒寫死的）：
//   - 階段表照 COMMISSION_TEMPLATES：中型多一個 2a，插在第二階段前面（extra[0]）；大型是 2a 在前（extra[0]）、2b 在第二階段後面（extra[1]）。extra 的內容照表上 2a、2b 的順序寫。
//   - lock_face { stage, face }：那個階段鎖成只有這一個面（COMMISSIONS 7.1 節「鎖成只有一個面」）；stage 是生成之後的第幾階段（1 起算），不能是最後一個階段。
//   - 詞條的 stage（可選）：attached、foes_plus 只加在那一個階段的現實面遭遇上；沒寫是每一個現實面的遭遇。
//   - attached 寫在那一面的 attached 欄位（[{ enemy, count }]），意思是掛在那一場遭遇的第一個敵人身上；副本開地圖時要照它寫進敵人的 UnitRef（commission/run.ts 的 foeRef）。
//   - 詞條的 alert_start 加總之後寫在副本的 alert_start 欄位，出發（go）時併進警戒的起始值。
//   - 連動的效果 stage 一律換成「這個連動接上的那個階段」（生成時才知道是哪一個）。
//   - 同一個 seed 的結果一模一樣；fixer.offers 的亂數把存檔亂數的游標固定在 0，這樣同一天之內不管中間擲了幾次骰，今天的委託都不變。

import type { ContentEntry, GameState, Kernel } from '../../core'
import { UNIT_RANKS, clone, deriveRng, isRecord, isSafeInt, repGrade, repTierOf, meterOf } from '../../core'
import type { CommissionDef, FixerEntry, Offer, Reveal, UnknownItem } from './model'
import { CATS, factionName, offerProblems } from './model'
import type { Cat } from './model'

export const TYPE_KIND = 'commission_type'
export const MODIFIER_KIND = 'commission_modifier'
export const LINK_KIND = 'commission_link'
/** 規則放在 commission 的規則表裡（id: default） */
export const GEN_RULE_KIND = 'commission_rule'
const COMMISSION_KIND = 'commission'

export const GEN_FACES = ['meat', 'net', 'opinion'] as const
export type GenFace = (typeof GEN_FACES)[number]
const FACE_NAME: Record<GenFace, string> = { meat: '現實', net: '內海', opinion: '輿論' }
/** 別的面的玩法：有人登記這種活動才選得了（和 commission 一樣；M3、M5） */
const FACE_ACTIVITY: Record<Exclude<GenFace, 'meat'>, string> = { net: 'face.net', opinion: 'face.opinion' }
export const GEN_SCALES = ['small', 'medium', 'large'] as const
type Scale = (typeof GEN_SCALES)[number]
const LINK_TYPES = ['skip', 'ease', 'open'] as const
const LINK_EFFECT_KEYS = ['stage', 'encounter_half', 'foes_minus', 'skip_explore', 'alert_frozen', 'alert_start'] as const
const GOAL_KINDS = ['fight', 'reach', 'take', 'check', 'scene'] as const
/** 目標寫「站上去的標記」時用的字母（SITES 12.1 節的標記加保險箱與人質） */
const MARKS = ['E', 'T', 'D', 'C', 'G', 'K', 'X', '$', '&'] as const
const PLACEHOLDERS = ['faction', 'district', 'place', 'fixer'] as const
type Rank = (typeof UNIT_RANKS)[number]

/** 每個中間人每天給幾件（工單：三件）。 */
export const OFFERS_PER_DAY = 3
/** 挑不到敵人的組合最多重抽幾次（還是不行就少給一件）。 */
export const GEN_RETRIES = 3
const UNKNOWN_MIN = 4
const UNKNOWN_MAX = 8
const LINKS_MIN = 2
const LINKS_MAX = 4
const MODIFIERS_MIN = 1
const MODIFIERS_MAX = 2
/** 踩點開出來的路最多放在幾個階段上 */
const SCOUT_BRANCH_MAX = 2

const isText = (v: unknown): v is string => typeof v === 'string' && v.trim().length > 0
const isFace = (v: unknown): v is GenFace => (GEN_FACES as readonly unknown[]).includes(v)
const isRank = (v: unknown): v is Rank => (UNIT_RANKS as readonly unknown[]).includes(v)
const isScale = (v: unknown): v is Scale => (GEN_SCALES as readonly unknown[]).includes(v)
const clamp = (n: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, n))

// ===================================================================================================================
// 內容的格式
// ===================================================================================================================

export interface StageTemplate {
  name?: string
  faces: GenFace[]
}

/** 決定性的一步的寫法（COMMISSIONS 2.3 節的目標）；at 寫標記的字母，生成時換成那張圖上的標記 id。 */
export interface DecisiveDef {
  kind: (typeof GOAL_KINDS)[number]
  at?: string
  basic?: string
  with?: string
  goal?: string
  nature?: string
}

export interface TypeEntry extends ContentEntry {
  name: string
  main: GenFace
  decisive: DecisiveDef
  stages: StageTemplate[]
  extra: StageTemplate[]
  branches: { stealth?: string; talk?: string }
  brief: string
  gives: Partial<Record<GenFace, string[]>>
}

export interface ModifierEffect {
  lock_face?: { stage: number; face: GenFace }
  attached?: Array<{ enemy: string; count?: number }>
  foes_plus?: number
  alert_start?: number
  stage?: number
}
export interface ModifierEntry extends ContentEntry {
  name: string
  text: string
  effect: ModifierEffect
}

export interface LinkEntry extends ContentEntry {
  name: string
  from: GenFace
  to: GenFace
  type: (typeof LINK_TYPES)[number]
  effect?: Record<string, unknown>
}

const stageTemplateProblems = (s: unknown, at: string): string[] => {
  if (!isRecord(s)) return [`${at} 要是 { name?, faces }`]
  const p: string[] = []
  if (s.name !== undefined && !isText(s.name)) p.push(`${at}.name 要是文字`)
  if (!Array.isArray(s.faces) || s.faces.length === 0) p.push(`${at}.faces 要是至少一個面的陣列`)
  else {
    if (!s.faces.every(isFace)) p.push(`${at}.faces 的每一項只能是 ${GEN_FACES.join('、')}`)
    else if (new Set(s.faces).size !== s.faces.length) p.push(`${at}.faces 有重複的面`)
  }
  return p
}

function decisiveProblems(d: unknown, main: unknown): string[] {
  if (!isRecord(d)) return ['decisive 要是 { kind, ... }（決定性的一步：目標的寫法）']
  if (!(GOAL_KINDS as readonly unknown[]).includes(d.kind)) return [`decisive.kind 只能是 ${GOAL_KINDS.join('、')}`]
  const p: string[] = []
  if (d.kind === 'reach' || d.kind === 'take' || d.kind === 'check') {
    if (!(typeof d.at === 'string' && (MARKS as readonly string[]).includes(d.at))) p.push(`decisive.at 要是標記的字母（${MARKS.join('、')}），生成時換成那張圖上的標記`)
    if (main !== 'meat') p.push('decisive 要站上標記的目標只有現實面的圖才有標記：主面不是現實時只能寫 fight 或 scene')
  }
  if (d.kind === 'check' && !isText(d.basic)) p.push('decisive.basic 要是基本功的 id')
  if (d.kind === 'scene') {
    if (!isText(d.with)) p.push('decisive.with 要是角色的 id（場景的對象）')
    if (!isText(d.goal)) p.push('decisive.goal 要是場景的目的（info、please、obey、stall、footage）')
    if (d.nature !== undefined && !isText(d.nature)) p.push('decisive.nature 要是文字')
  }
  return p
}

/** 一種類型的模板格式問題（一條一句）。 */
export function typeProblems(e: Record<string, unknown>): string[] {
  const p: string[] = []
  if (!isText(e.name)) p.push('name 要是文字')
  if (!isFace(e.main)) p.push(`main 只能是 ${GEN_FACES.join('、')}`)
  p.push(...decisiveProblems(e.decisive, e.main))
  if (!Array.isArray(e.stages) || e.stages.length !== 3) p.push('stages 要剛好三個階段（小型的樣子；COMMISSIONS 7.1 節）')
  else {
    e.stages.forEach((s: unknown, i: number) => p.push(...stageTemplateProblems(s, `stages[${i}]`)))
    const last = e.stages[2] as { faces?: unknown } | undefined
    if (isFace(e.main) && isRecord(last) && Array.isArray(last.faces) && !(last.faces.length === 1 && last.faces[0] === e.main)) p.push(`stages[2]：最後一個階段只有主面（${String(e.main)}）`)
    // 每個副本至少有一個階段可選兩個以上的面（沒有選擇的類型，例如網內打撈，除外：三個階段加多出來的階段都只有一個面）
    const base = e.stages as Array<{ faces?: unknown[] }>
    const everyStage = [...base, ...(Array.isArray(e.extra) ? (e.extra as Array<{ faces?: unknown[] }>) : [])]
    const noChoice = everyStage.every((s) => isRecord(s) && Array.isArray(s.faces) && s.faces.length === 1)
    if (!noChoice && !base.slice(0, 2).some((s) => isRecord(s) && Array.isArray(s.faces) && s.faces.length >= 2)) p.push('前兩個階段至少要有一個可以選兩個以上的面（小型的副本也要有一次選擇）')
  }
  if (!Array.isArray(e.extra) || e.extra.length > 2) p.push('extra 要是最多兩個階段的陣列（中型用一個、大型用兩個）')
  else e.extra.forEach((s: unknown, i: number) => p.push(...stageTemplateProblems(s, `extra[${i}]`)))
  if (!isRecord(e.branches)) p.push('branches 要是 { stealth?, talk? }（基本功的 id；沒有就寫空物件）')
  else {
    for (const key of Object.keys(e.branches)) if (key !== 'stealth' && key !== 'talk') p.push(`branches.${key} 不是可以用的鍵（stealth、talk）`)
    for (const key of ['stealth', 'talk'] as const) if (e.branches[key] !== undefined && !isText(e.branches[key])) p.push(`branches.${key} 要是基本功的 id`)
  }
  if (!isText(e.brief)) p.push('brief 要是一句帶空格的話')
  else {
    for (const m of e.brief.matchAll(/\{([^{}]*)\}/g)) if (!(PLACEHOLDERS as readonly string[]).includes(m[1]!)) p.push(`brief 的空格 {${m[1]}} 不認得（可以用 ${PLACEHOLDERS.map((x) => `{${x}}`).join('、')}）`)
  }
  if (!isRecord(e.gives)) p.push('gives 要是 { 面: [連動的 id] }（沒有就寫空物件）')
  else {
    for (const [face, list] of Object.entries(e.gives)) {
      if (!isFace(face)) p.push(`gives.${face}：面只能是 ${GEN_FACES.join('、')}`)
      else if (!Array.isArray(list) || !list.every(isText)) p.push(`gives.${face} 要是連動的 id 的陣列`)
    }
  }
  return p
}

export function modifierProblems(e: Record<string, unknown>): string[] {
  const p: string[] = []
  if (!isText(e.name)) p.push('name 要是文字')
  if (!isText(e.text)) p.push('text 要是文字（給玩家看的說明）')
  if (!isRecord(e.effect)) return [...p, 'effect 要是物件（沒有機制效果就寫空物件）']
  const ef = e.effect
  for (const key of Object.keys(ef)) if (!['lock_face', 'attached', 'foes_plus', 'alert_start', 'stage'].includes(key)) p.push(`effect.${key} 不是可以用的鍵（lock_face、attached、foes_plus、alert_start、stage）`)
  if (ef.lock_face !== undefined) {
    const l = ef.lock_face
    if (!isRecord(l) || !(isSafeInt(l.stage) && l.stage >= 1) || !isFace(l.face)) p.push('effect.lock_face 要是 { stage: 第幾階段, face: 面 }')
  }
  if (ef.attached !== undefined) {
    if (!Array.isArray(ef.attached) || ef.attached.length === 0 || !ef.attached.every((a) => isRecord(a) && isText(a.enemy) && (a.count === undefined || (isSafeInt(a.count) && a.count >= 1 && a.count <= 6)))) {
      p.push('effect.attached 要是 [{ enemy, count? }]（至少一台；count 是 1～6）')
    }
  }
  if (ef.foes_plus !== undefined && !(isSafeInt(ef.foes_plus) && ef.foes_plus >= 1 && ef.foes_plus <= 4)) p.push('effect.foes_plus 要是 1～4 的整數')
  if (ef.alert_start !== undefined && !(isSafeInt(ef.alert_start) && ef.alert_start >= 0 && ef.alert_start <= 100)) p.push('effect.alert_start 要是 0～100 的整數')
  if (ef.stage !== undefined && !(isSafeInt(ef.stage) && ef.stage >= 1)) p.push('effect.stage 要是第幾階段（1 起算）')
  return p
}

export function linkProblems(e: Record<string, unknown>): string[] {
  const p: string[] = []
  if (!isText(e.name)) p.push('name 要是給玩家看的名字')
  if (!isFace(e.from)) p.push(`from 只能是 ${GEN_FACES.join('、')}（哪一面做了這件事）`)
  if (!isFace(e.to)) p.push(`to 只能是 ${GEN_FACES.join('、')}（幫到後面哪一面的階段）`)
  if (!(LINK_TYPES as readonly unknown[]).includes(e.type)) p.push(`type 只能是 ${LINK_TYPES.join('、')}`)
  if (e.effect !== undefined) {
    if (!isRecord(e.effect)) p.push('effect 要是物件')
    else {
      const ef = e.effect
      for (const key of Object.keys(ef)) if (!(LINK_EFFECT_KEYS as readonly string[]).includes(key)) p.push(`effect.${key} 不是可以用的鍵（${LINK_EFFECT_KEYS.join('、')}）`)
      if (ef.foes_minus !== undefined && !(isSafeInt(ef.foes_minus) && ef.foes_minus >= 0)) p.push('effect.foes_minus 要是 0 以上的整數')
      if (ef.alert_start !== undefined && !(isSafeInt(ef.alert_start) && Math.abs(ef.alert_start) <= 100)) p.push('effect.alert_start 要是 −100～100 的整數')
      for (const key of ['encounter_half', 'skip_explore', 'alert_frozen'] as const) if (ef[key] !== undefined && typeof ef[key] !== 'boolean') p.push(`effect.${key} 要是 true 或 false`)
    }
  }
  return p
}

// ===================================================================================================================
// 規則（commission_rule 的另一部分）
// ===================================================================================================================

export interface GenRules {
  /** 每一級（1～5）的報酬範圍（現金的全額，中間人還沒抽成） */
  reward_range: Record<number, [number, number]>
  /** 每個信譽階（0～5）給哪幾種規模 */
  scales_by_tier: Scale[][]
  /** 每一級的遭遇組合：一般的階段、最後一個階段各一組（ENEMIES 第 13 節：一般 4 點、首領戰 8 點） */
  encounters: Record<number, { normal: Rank[]; last: Rank[] }>
}

const MINIONS: Rank[] = ['minion', 'minion', 'minion', 'minion']
const MIXED: Rank[] = ['minion', 'minion', 'elite']
const BOSS: Rank[] = ['boss', 'minion', 'minion']

export const DEFAULT_GEN_RULES: GenRules = {
  reward_range: { 1: [300, 500], 2: [900, 1500], 3: [3000, 5000], 4: [10000, 16000], 5: [30000, 50000] },
  scales_by_tier: [['small'], ['small'], ['small', 'medium'], ['small', 'medium', 'large'], ['medium', 'large'], ['medium', 'large']],
  encounters: {
    1: { normal: MINIONS, last: ['elite', 'elite', 'minion', 'minion'] },
    2: { normal: MINIONS, last: BOSS },
    3: { normal: MIXED, last: BOSS },
    4: { normal: MIXED, last: BOSS },
    5: { normal: MIXED, last: BOSS },
  },
}

/** 規模在報酬範圍裡的位置（小的偏下、大的偏上）；報酬一定落在範圍裡。 */
const SCALE_POS: Record<Scale, [number, number]> = { small: [0, 0.4], medium: [0.3, 0.7], large: [0.6, 1] }

const isRange = (v: unknown): v is [number, number] => Array.isArray(v) && v.length === 2 && isSafeInt(v[0]) && isSafeInt(v[1]) && v[0] >= 0 && v[0] <= v[1]
const isRankList = (v: unknown): v is Rank[] => Array.isArray(v) && v.length > 0 && v.every(isRank)

/** 規則裡生成的那幾個欄位的問題（commission 的功能只檢查它自己的欄位，這幾個由這裡檢查）。 */
export function genRuleProblems(e: Record<string, unknown>): string[] {
  const p: string[] = []
  if (e.reward_range !== undefined) {
    if (!isRecord(e.reward_range)) p.push('reward_range 要是 { 等級: [最少, 最多] }')
    else for (const [g, r] of Object.entries(e.reward_range)) if (!(/^[1-5]$/.test(g) && isRange(r))) p.push(`reward_range.${g} 要是 1～5 級的 [最少, 最多]（0 以上的整數，最少不大於最多）`)
  }
  if (e.scales_by_tier !== undefined) {
    const t = e.scales_by_tier
    const rows = Array.isArray(t) ? t.map((v, i) => [String(i), v] as const) : isRecord(t) ? Object.entries(t) : null
    if (!rows) p.push('scales_by_tier 要是每個信譽階（0～5）一列的陣列或物件')
    else for (const [i, v] of rows) if (!(/^[0-5]$/.test(i) && Array.isArray(v) && v.length > 0 && v.every(isScale))) p.push(`scales_by_tier.${i} 要是第 0～5 階的規模清單（${GEN_SCALES.join('、')}，至少一種）`)
  }
  if (e.encounters !== undefined) {
    if (!isRecord(e.encounters)) p.push('encounters 要是 { 等級: { normal, last } }')
    else {
      for (const [g, v] of Object.entries(e.encounters)) {
        if (!/^[1-5]$/.test(g) || !isRecord(v)) { p.push(`encounters.${g} 要是 1～5 級的 { normal?, last? }`); continue }
        for (const key of ['normal', 'last'] as const) if (v[key] !== undefined && !isRankList(v[key])) p.push(`encounters.${g}.${key} 要是位階的陣列（${UNIT_RANKS.join('、')}，至少一個）`)
      }
    }
  }
  return p
}

/** 現在生效的生成規則：資料 commission_rule/default 蓋掉內建的預設（格式不對的項目忽略）。 */
export function genRules(k: Pick<Kernel, 'content'>): GenRules {
  const out: GenRules = { reward_range: { ...DEFAULT_GEN_RULES.reward_range }, scales_by_tier: DEFAULT_GEN_RULES.scales_by_tier.map((r) => [...r]), encounters: clone(DEFAULT_GEN_RULES.encounters) }
  const e = k.content.get<ContentEntry & Record<string, unknown>>(GEN_RULE_KIND, 'default')
  if (!e) return out
  if (isRecord(e.reward_range)) for (const [g, r] of Object.entries(e.reward_range)) if (/^[1-5]$/.test(g) && isRange(r)) out.reward_range[Number(g)] = [r[0], r[1]]
  const t = e.scales_by_tier
  const rows = Array.isArray(t) ? t.map((v, i) => [String(i), v] as const) : isRecord(t) ? Object.entries(t) : []
  for (const [i, v] of rows) if (/^[0-5]$/.test(i) && Array.isArray(v) && v.length > 0 && v.every(isScale)) out.scales_by_tier[Number(i)] = [...v]
  if (isRecord(e.encounters)) {
    for (const [g, v] of Object.entries(e.encounters)) {
      if (!/^[1-5]$/.test(g) || !isRecord(v)) continue
      const cur = out.encounters[Number(g)]!
      if (isRankList(v.normal)) cur.normal = [...v.normal]
      if (isRankList(v.last)) cur.last = [...v.last]
    }
  }
  return out
}

// ===================================================================================================================
// 載入之後的檢查
// ===================================================================================================================

/**
 * 載入之後查模板（給功能的 ready 用；一條一句）：每一種類型最後一個階段只有主面、每個階段至少一個面、decisive 寫得出目標（格式在內容種類的檢查裡一起做，
 * 這裡再查要看別的內容才查得到的：gives 的連動在不在、詞條的敵人在不在、規則的那幾個欄位）。
 */
export function genProblems(k: Pick<Kernel, 'content'>): string[] {
  const p: string[] = []
  const links = new Set(k.content.list(LINK_KIND).map((l) => l.id))
  for (const t of k.content.list<TypeEntry>(TYPE_KIND)) {
    for (const m of typeProblems(t as unknown as Record<string, unknown>)) p.push(`${TYPE_KIND}/${t.id}：${m}`)
    if (isRecord(t.gives)) {
      for (const [face, list] of Object.entries(t.gives)) {
        if (Array.isArray(list)) for (const id of list) if (isText(id) && !links.has(id)) p.push(`${TYPE_KIND}/${t.id}：gives.${face} 的連動 ${id} 在 ${LINK_KIND} 裡查不到`)
      }
    }
  }
  if (k.content.hasKind('enemy')) {
    for (const m of k.content.list<ModifierEntry>(MODIFIER_KIND)) {
      for (const a of m.effect?.attached ?? []) if (isText(a?.enemy) && !k.content.has('enemy', a.enemy)) p.push(`${MODIFIER_KIND}/${m.id}：attached 的敵人 ${a.enemy} 查不到`)
    }
  }
  const rule = k.content.get<ContentEntry & Record<string, unknown>>(GEN_RULE_KIND, 'default')
  if (rule) for (const m of genRuleProblems(rule)) p.push(`${GEN_RULE_KIND}/default：${m}`)
  return p
}

// ===================================================================================================================
// 生成
// ===================================================================================================================

/** 地圖（內容種類 special_map）裡生成要用的幾個欄位。 */
interface MapEntry extends ContentEntry {
  name?: string
  fits?: string[]
  district_weight?: Record<string, number>
  sheets: Array<{ id: string; name?: string; cells?: Array<{ id: string; mark: string; name?: string }> }>
}

/** 現在有人登記玩法的面：現實一定有（副本自己玩）；內海、輿論要有人登記那種活動（M3、M5）。 */
export function registeredFaces(k: Pick<Kernel, 'activity'>): GenFace[] {
  return GEN_FACES.filter((f) => f === 'meat' || !!k.activity.get(FACE_ACTIVITY[f]))
}

const playable = (faces: readonly GenFace[], reg: readonly GenFace[]): boolean => faces.some((f) => reg.includes(f))

/** 這個規模的階段怎麼排（COMMISSION_TEMPLATES 的階段表：中型是 1、2a、2、★，大型是 1、2a、2、2b、★；extra 照表的順序寫 [2a, 2b]）；模板的階段不夠回傳 null。 */
export function stagePlan(t: Pick<TypeEntry, 'stages' | 'extra'>, scale: Scale): StageTemplate[] | null {
  const [s1, s2, s3] = t.stages
  if (!s1 || !s2 || !s3) return null
  if (scale === 'small') return [s1, s2, s3]
  if (scale === 'medium') return t.extra[0] ? [s1, t.extra[0], s2, s3] : null
  return t.extra[0] && t.extra[1] ? [s1, t.extra[0], s2, t.extra[1], s3] : null
}

/** 這種類型現在抽得到的規模（模板的階段排得出來、每個階段都有一個有人登記玩法的面）。 */
function feasibleScales(t: TypeEntry, reg: readonly GenFace[]): Scale[] {
  return GEN_SCALES.filter((sc) => {
    const plan = stagePlan(t, sc)
    return plan !== null && plan.every((s) => playable(s.faces, reg))
  })
}

/** 中間人給的那幾種類型裡，現在抽得到的（每個階段都有一個有人登記玩法的面；M2 等於主面是現實的）。 */
export function eligibleTypes(k: Pick<Kernel, 'content' | 'activity'>, fixer: Pick<FixerEntry, 'kinds'>): TypeEntry[] {
  const reg = registeredFaces(k)
  return k.content.list<TypeEntry>(TYPE_KIND).filter((t) => fixer.kinds.includes(t.id) && typeProblems(t as unknown as Record<string, unknown>).length === 0 && feasibleScales(t, reg).includes('small'))
}

/** 挑得到這個勢力、這一級、這個位階的敵人嗎（有人註冊 enemy_pick 才問；沒有人註冊就不檢查）。 */
function pickable(k: Kernel, state: GameState, faction: string, grade: number, rank: Rank, cache: Map<string, boolean>): boolean {
  const source = k.battle.getUnitSource('enemy_pick')
  if (!source) return true
  const key = `${faction}/${grade}/${rank}`
  let ok = cache.get(key)
  if (ok === undefined) {
    try {
      source({ from: 'enemy_pick', faction, grade, rank, seed: 'commission_gen/check' }, { k: k as never, state, side: 'foe', mode: 'lethal', grade, allyCount: 4 })
      ok = true
    } catch {
      ok = false
    }
    cache.set(key, ok)
  }
  return ok
}

type Rng = ReturnType<typeof deriveRng>

function shuffle<T>(rng: Rng, items: readonly T[]): T[] {
  const a = [...items]
  for (let i = a.length - 1; i > 0; i--) {
    const j = rng.int(0, i)
    ;[a[i], a[j]] = [a[j]!, a[i]!]
  }
  return a
}

const sanitize = (s: string): string => s.toLowerCase().replace(/\//g, '__').replace(/[^a-z0-9_]/g, '_')

/** 這一種的內容 id 與委託的 id（同一個 seed 永遠一樣）。 */
export const offerIdOf = (seed: string): string => `of_${sanitize(seed)}`
export const commissionIdOf = (seed: string): string => `cm_${sanitize(seed)}`

interface Branch {
  id: string
  kind: 'assault' | 'stealth' | 'talk' | 'linked' | 'scouted'
  name: string
  entry?: string
  need?: Record<string, unknown>
}

interface StageWork {
  name: string
  faces: GenFace[]
  /** 每一面做出來的東西 */
  built: Partial<Record<GenFace, Record<string, unknown>>>
}

/** 這張圖的某一張圖上，某一種標記有哪些格子（id）。 */
const marksOf = (sheet: MapEntry['sheets'][number], mark: string): string[] => (sheet.cells ?? []).filter((c) => c.mark === mark).map((c) => c.id)

/** 這張地圖可不可以用：每一張用到的圖要有入口與保全崗；放決定性目標的那張要有目標的標記。 */
function sheetsFor(map: MapEntry, meatStages: number, decisiveMark: string | undefined): number[] | null {
  if (!Array.isArray(map.sheets) || map.sheets.length === 0 || meatStages === 0) return meatStages === 0 ? [] : null
  const idx = Array.from({ length: meatStages }, (_, i) => Math.min(i, map.sheets.length - 1))
  for (const [i, s] of idx.entries()) {
    const sheet = map.sheets[s]!
    if (marksOf(sheet, 'E').length === 0 || marksOf(sheet, 'G').length === 0) return null
    if (i === meatStages - 1 && decisiveMark !== undefined && marksOf(sheet, decisiveMark).length === 0) return null
  }
  return idx
}

const rankName = (r: Rank): string => (r === 'minion' ? '雜兵' : r === 'elite' ? '精英' : '首領')

function rankSummary(ranks: readonly Rank[]): string {
  const n = new Map<Rank, number>()
  for (const r of ranks) n.set(r, (n.get(r) ?? 0) + 1)
  return UNIT_RANKS.filter((r) => n.has(r)).map((r) => `${rankName(r)} ${n.get(r)}`).join('、')
}

interface LinkCand { link: LinkEntry; from: number; to: number }

/** 現在還能挑的連動：前面的階段（from）的某一面給、後面的階段（to）的某一面用；同一個階段同一面只給一個、每個連動只用一次。 */
function linkCands(type: TypeEntry, links: readonly LinkEntry[], faces: ReadonlyArray<readonly GenFace[]>, chosen: readonly LinkCand[]): LinkCand[] {
  const out: LinkCand[] = []
  const total = faces.length
  for (const link of links) {
    if (chosen.some((x) => x.link.id === link.id)) continue
    const listed = type.gives[link.from]
    if (listed !== undefined && listed.length > 0 && !listed.includes(link.id)) continue
    for (let i = 1; i < total; i++) {
      if (!faces[i - 1]!.includes(link.from)) continue
      if (chosen.some((x) => x.from === i && x.link.from === link.from)) continue
      for (let j = i + 1; j <= total; j++) if (faces[j - 1]!.includes(link.to)) out.push({ link, from: i, to: j })
    }
  }
  return out
}

/** 挑 want 個連動（挑不滿就多試幾次，取挑得最多的）。第一個盡量選「開路」接到現實面的：這樣至少有一條要連動的分支。 */
function pickLinks(rng: Rng, type: TypeEntry, links: readonly LinkEntry[], faces: ReadonlyArray<readonly GenFace[]>, want: number): LinkCand[] {
  let best: LinkCand[] = []
  for (let attempt = 0; attempt < 6 && best.length < want; attempt++) {
    const chosen: LinkCand[] = []
    while (chosen.length < want) {
      const all = linkCands(type, links, faces, chosen)
      if (all.length === 0) break
      const open = chosen.length === 0 ? all.filter((x) => x.link.type === 'open' && x.link.to === 'meat') : []
      const open2 = chosen.length === 0 && open.length === 0 ? all.filter((x) => x.link.type === 'open') : []
      chosen.push(rng.pick(open.length > 0 ? open : open2.length > 0 ? open2 : all))
    }
    if (chosen.length > best.length) best = chosen
  }
  return best
}

interface Ctx {
  k: Kernel
  state: GameState
  fixer: FixerEntry
  rng: Rng
  rules: GenRules
  reg: GenFace[]
  seed: string
}

/** 挑一次；回傳一件委託，或不成立的原因。 */
function build(c: Ctx): Offer | string {
  const { k, state, fixer, rng, rules, reg } = c
  const types = eligibleTypes(k, fixer)
  if (types.length === 0) return '這位中間人的門路裡沒有現在抽得到的類型。'
  const type = rng.pick(types)

  // 等級（±1）、規模（照信譽階）、目標勢力（那一區的勢力）
  const base = repGrade(k, state)
  const grade = clamp(base + rng.pick([-1, 0, 0, 1]), 1, 5)
  const tier = repTierOf(meterOf(k, state, 'rep'))
  const feasible = feasibleScales(type, reg)
  const allowed = (rules.scales_by_tier[clamp(tier, 0, 5)] ?? ['small']).filter((s) => feasible.includes(s))
  const scale: Scale = allowed.length > 0 ? rng.pick(allowed) : 'small'
  const district = k.content.get('district', fixer.district)
  const inDistrict = Array.isArray(district?.factions) ? (district!.factions as unknown[]).filter(isText) : []
  const factions = inDistrict.length > 0 ? inDistrict : k.content.list('faction').map((f) => f.id)
  if (factions.length === 0) return '查不到可以當目標的勢力。'
  const faction = rng.pick(factions)

  // 階段照模板
  const plan = stagePlan(type, scale)!
  const total = plan.length
  const stages: StageWork[] = plan.map((s, i) => ({ name: s.name ?? `第 ${i + 1} 階段`, faces: [...s.faces], built: {} }))
  const multi = type.stages.slice(0, 2).some((s) => s.faces.length >= 2)
  const hasMulti = (list: readonly StageWork[]): boolean => list.some((s) => s.faces.length >= 2)

  const allLinks = k.content.list<LinkEntry>(LINK_KIND).filter((l) => linkProblems(l as unknown as Record<string, unknown>).length === 0).sort((a, b) => a.id.localeCompare(b.id))

  // 詞條 1～2 個：lock_face 把那個階段鎖成一個面（不能讓某個階段沒有玩得了的面，也不能讓「至少一個階段有兩個面」不成立，也不能讓接得上的連動不夠）
  const mods = k.content.list<ModifierEntry>(MODIFIER_KIND).filter((m) => modifierProblems(m as unknown as Record<string, unknown>).length === 0)
  const chosenMods: ModifierEntry[] = []
  const wantMods = rng.int(MODIFIERS_MIN, MODIFIERS_MAX)
  for (const m of shuffle(rng, mods)) {
    if (chosenMods.length >= wantMods) break
    const ef = m.effect
    if (ef.stage !== undefined && (ef.stage > total || !stages[ef.stage - 1]!.faces.includes('meat'))) continue
    if (ef.lock_face) {
      const { stage, face } = ef.lock_face
      const st = stages[stage - 1]
      if (!st || stage >= total || st.faces.length < 2 || !st.faces.includes(face) || !reg.includes(face)) continue
      const after = stages.map((s, i) => (i === stage - 1 ? { ...s, faces: [face] } : s))
      if (multi && !hasMulti(after)) continue
      if (pickLinks(rng, type, allLinks, after.map((x) => x.faces), LINKS_MIN).length < LINKS_MIN) continue
      st.faces = [face]
    }
    chosenMods.push(m)
  }
  if (chosenMods.length < MODIFIERS_MIN && mods.length > 0) return '詞條都用不上這一件。'

  // 現實面用哪張圖：fits 含這個類型、照區的權重抽
  const meatIdx = stages.map((s, i) => (s.faces.includes('meat') ? i : -1)).filter((i) => i >= 0)
  const decisiveMark = type.main === 'meat' && (type.decisive.kind === 'take' || type.decisive.kind === 'reach' || type.decisive.kind === 'check') ? type.decisive.at : undefined
  let map: MapEntry | undefined
  let sheetOf: number[] = []
  if (meatIdx.length > 0) {
    const fitting = k.content.list<MapEntry>('special_map').filter((m) => Array.isArray(m.fits) && m.fits.includes(type.id) && sheetsFor(m, meatIdx.length, decisiveMark) !== null)
    const weight = (m: MapEntry): number => (m.district_weight && Object.keys(m.district_weight).length > 0 ? Math.max(0, Number(m.district_weight[fixer.district] ?? 0)) : 1)
    const weighted = fitting.filter((m) => weight(m) > 0)
    const pool = weighted.length > 0 ? weighted : fitting
    if (pool.length === 0) return `沒有 fits 含 ${type.id} 的地圖可以放下這一件。`
    map = rng.weighted(pool, weighted.length > 0 ? weight : () => 1)
    sheetOf = sheetsFor(map, meatIdx.length, decisiveMark)!
  }

  // 連動 2～4 個：前面的階段的某一面給、後面的階段的某一面用
  const chosen = pickLinks(rng, type, allLinks, stages.map((x) => x.faces), rng.int(LINKS_MIN, LINKS_MAX))
  if (chosen.length < LINKS_MIN) return '接得上的連動不夠（前面的階段給、後面的階段用）。'

  // 每個階段每一面
  const lvl = Math.min(5, grade + 1)
  const meatSet = new Set(meatIdx)
  // 踩點開出來的路放在哪幾個現實面的階段上
  const scoutStages = shuffle(rng, meatIdx).slice(0, SCOUT_BRANCH_MAX).sort((a, b) => a - b)
  const enc = rules.encounters[grade] ?? DEFAULT_GEN_RULES.encounters[grade]!
  const alertTotal = chosenMods.reduce((s, m) => s + (m.effect.alert_start ?? 0), 0)
  const decisive = type.decisive
  const used: Array<{ stage: number; faction: string; rank: Rank }> = []

  stages.forEach((st, i) => {
    const n = i + 1
    const last = n === total
    const isMeatStage = meatSet.has(i)
    const sheet = isMeatStage && map ? map.sheets[sheetOf[meatIdx.indexOf(i)]!]! : undefined
    const entries = sheet ? shuffle(rng, marksOf(sheet, 'E')) : []
    let entryAt = 0
    const nextEntry = (): string => entries[entryAt++ % entries.length]!
    for (const face of st.faces) {
      const meat = face === 'meat'
      const branches: Branch[] = [{ id: 'assault', kind: 'assault', name: '正面強攻', ...(meat ? { entry: nextEntry() } : {}) }]
      if (type.branches.stealth) branches.push({ id: 'stealth', kind: 'stealth', name: '潛進去', ...(meat ? { entry: nextEntry() } : {}), need: { basic: type.branches.stealth, level: lvl } })
      if (type.branches.talk) branches.push({ id: 'talk', kind: 'talk', name: '交涉', ...(meat ? { entry: nextEntry() } : {}), need: { basic: type.branches.talk, level: lvl } })
      for (const ch of chosen) {
        if (ch.to === n && ch.link.to === face && ch.link.type === 'open') {
          branches.push({ id: `via_${ch.link.id}`, kind: 'linked', name: `借助「${ch.link.name}」`, ...(meat ? { entry: nextEntry() } : {}), need: { link: ch.link.id } })
        }
      }
      if (meat && scoutStages.includes(i)) branches.push({ id: `back_s${n}`, kind: 'scouted', name: '踩點才知道的路', entry: nextEntry(), need: { scouted: `route_s${n}` } })
      const ranks = [...(last ? enc.last : enc.normal)]
      const f: Record<string, unknown> = { branches, encounter: ranks }
      const give = chosen.find((ch) => ch.from === n && ch.link.from === face)
      if (give) f.gives = give.link.id
      if (meat && map && sheet) {
        f.map = map.id
        f.sheet = sheet.id
        const guards = marksOf(sheet, 'G')
        f.post = rng.pick(guards)
        if (last && type.main === 'meat') {
          const goal: Record<string, unknown> = { kind: decisive.kind }
          if (decisive.kind === 'reach' || decisive.kind === 'take' || decisive.kind === 'check') goal.at = rng.pick(marksOf(sheet, decisive.at!))
          if (decisive.kind === 'check') goal.basic = decisive.basic
          if (decisive.kind === 'scene') { goal.with = decisive.with; goal.goal = decisive.goal; if (decisive.nature) goal.nature = decisive.nature }
          f.goal = goal
        }
      } else if (last && !meat) {
        const goal: Record<string, unknown> = { kind: decisive.kind }
        if (decisive.kind === 'scene') { goal.with = decisive.with; goal.goal = decisive.goal; if (decisive.nature) goal.nature = decisive.nature }
        f.goal = goal
      }
      // 詞條：多幾個敵人、帶附屬單位
      if (meat) {
        for (const m of chosenMods) {
          const ef = m.effect
          if (ef.stage !== undefined && ef.stage !== n) continue
          if (ef.foes_plus) (f.encounter as Rank[]).push(...Array.from({ length: ef.foes_plus }, (): Rank => 'minion'))
          if (ef.attached) f.attached = [...((f.attached as unknown[] | undefined) ?? []), ...ef.attached.map((a) => ({ enemy: a.enemy, count: a.count ?? 1 }))]
        }
        for (const r of new Set<Rank>([...(f.encounter as Rank[]), 'minion'])) used.push({ stage: n, faction, rank: r })
      }
      st.built[face] = f
    }
  })

  // 挑得到敵人嗎（要把每一個用到的位階都問過；增援是雜兵）
  const cache = new Map<string, boolean>()
  const highest = Math.min(5, grade + 1)
  for (const u of used) {
    if (!pickable(k, state, u.faction, grade, u.rank, cache) || (u.stage === total && !pickable(k, state, u.faction, highest, u.rank, cache))) {
      return `挑不到敵人：勢力 ${u.faction}、等級 ${grade}、位階 ${u.rank}。`
    }
  }

  // 連動的資料
  const links: Record<string, unknown> = {}
  for (const ch of chosen) {
    const effect = ch.link.effect ? { ...clone(ch.link.effect), stage: ch.to } : undefined
    links[ch.link.id] = { type: ch.link.type, name: ch.link.name, ...(effect ? { effect } : {}) }
  }

  // 簡報、標題、報酬
  const finalMeat = [...stages].reverse().find((s) => s.built.meat)?.built.meat
  const placeSheet = map && finalMeat ? map.sheets.find((s) => s.id === finalMeat.sheet) : undefined
  const place = placeSheet?.name ?? map?.name ?? district?.name ?? fixer.district
  const factionText = factionName(k, faction)
  const fill: Record<string, string> = { faction: factionText, district: String(district?.name ?? fixer.district), place: String(place), fixer: String(fixer.name ?? fixer.id) }
  const brief = type.brief.replace(/\{([^{}]*)\}/g, (m, key: string) => fill[key] ?? m)
  const title = `${type.name}・${place}`
  const [lo, hi] = rules.reward_range[grade] ?? DEFAULT_GEN_RULES.reward_range[grade]!
  const [t0, t1] = SCALE_POS[scale]
  const from = lo + (hi - lo) * t0
  const to = lo + (hi - lo) * t1
  const reward = clamp(Math.round(rng.int(Math.round(from), Math.max(Math.round(from), Math.round(to))) / 10) * 10, lo, hi)

  const commission: CommissionDef = {
    id: commissionIdOf(c.seed), name: title, kind: type.id, main: type.main, scale, grade, target_faction: faction, district: fixer.district,
    ...(isText(fixer.block) ? { block: fixer.block } : {}),
    client: fixer.id,
    ...(chosenMods.length > 0 ? { modifiers: chosenMods.map((m) => m.id) } : {}),
    ...(alertTotal > 0 ? { alert_start: clamp(alertTotal, 0, 100) } : {}),
    stages: stages.map((s) => ({ name: s.name, faces: s.built as Record<string, unknown> })),
    links,
  }

  // 未知清單 4～8 項：每一項都指到副本裡真的東西（目標、雇主先只給旗標）
  interface Cand2 { cat: Cat; text: string; reveal: Reveal }
  const paths: Cand2[] = []
  const rest: Cand2[] = []
  stages.forEach((s, i) => {
    const n = i + 1
    if (n < total) rest.push({ cat: 'stage', text: `第 ${n} 階段（${s.name}）可以選：${s.faces.map((f) => FACE_NAME[f]).join('、')}。`, reveal: { stage: n } })
    const m = s.built.meat as { encounter?: Rank[]; branches?: Branch[] } | undefined
    if (m) {
      rest.push({ cat: 'guard', text: `第 ${n} 階段的守備：${(m.encounter ?? []).length} 個人（${rankSummary(m.encounter ?? [])}）。`, reveal: { guards: n } })
      const b = m.branches?.find((x) => x.kind === 'scouted')
      if (b) paths.push({ cat: 'path', text: `第 ${n} 階段多一條路：${b.name}。`, reveal: { branch: String((b.need as { scouted: string }).scouted) } })
    }
  })
  for (const m of chosenMods) rest.push({ cat: 'modifier', text: `${m.name}：${m.text}`, reveal: { modifier: m.id } })
  rest.push({ cat: 'target', text: '目標的行蹤與作息摸清楚了。', reveal: { flag: 'target_known' } })
  rest.push({ cat: 'employer', text: `${fill.fixer}沒說的事：雇主另有盤算。`, reveal: { flag: 'employer_secret' } })
  const want = Math.max(rng.int(UNKNOWN_MIN, UNKNOWN_MAX), paths.length)
  const picked = [...paths, ...shuffle(rng, rest)].slice(0, want)
  if (picked.length < UNKNOWN_MIN) return '未知清單湊不到 4 項。'
  const ordered = picked.map((u, idx) => ({ u, idx })).sort((a, b) => CATS.indexOf(a.u.cat) - CATS.indexOf(b.u.cat) || a.idx - b.idx).map((x) => x.u)
  const unknowns: UnknownItem[] = ordered.map((u, i) => ({ id: `u${i + 1}_${u.cat}`, cat: u.cat, text: u.text, reveal: u.reveal }))

  const offer: Offer = { id: offerIdOf(c.seed), commission, title, brief, reward, unknowns }

  // 通過格式的檢查（commission 這個內容種類沒裝時跳過）
  const bad = [...offerProblems(offer)]
  if (k.content.hasKind(COMMISSION_KIND)) bad.push(...k.content.validate(COMMISSION_KIND, [commission]))
  if (bad.length > 0) return `生成的結果沒有通過檢查：${bad.slice(0, 3).join('；')}`
  return offer
}

export interface GenOpts {
  fixer: FixerEntry
  /** 同一個 seed 永遠生成同一件 */
  seed: string
}

export interface GenTrace {
  offer: Offer | null
  /** 每一次抽的結果：不成立的原因（成功的那一次是 null） */
  tries: Array<string | null>
}

/**
 * 生成一件委託，附每一次抽的結果：挑不到敵人（或接不上連動、沒有檢查過）的組合重抽，最多重抽 GEN_RETRIES 次；還是不行回傳 offer: null。
 * 亂數是 deriveRng(state.rng, 'commission_gen/<seed>')；重抽時 seed 後面加「#r次數」。
 */
export function generateTrace(k: Kernel, state: GameState, opts: GenOpts): GenTrace {
  const tries: Array<string | null> = []
  for (let a = 0; a <= GEN_RETRIES; a++) {
    const label = a === 0 ? opts.seed : `${opts.seed}#r${a}`
    const rng = deriveRng(state.rng, `commission_gen/${label}`)
    const r = build({ k, state, fixer: opts.fixer, rng, rules: genRules(k), reg: registeredFaces(k), seed: opts.seed })
    if (typeof r !== 'string') {
      tries.push(null)
      return { offer: r, tries }
    }
    tries.push(r)
  }
  return { offer: null, tries }
}

/** 生成一件委託（不成立回傳 null）。同一個狀態、同一個 seed 一模一樣。 */
export function generate(k: Kernel, state: GameState, opts: GenOpts): Offer | null {
  return generateTrace(k, state, opts).offer
}

/** fixer.offers 的 seed：中間人加日子加第幾件。 */
export const offerSeed = (fixer: string, day: number, i: number): string => `${fixer}/${day}/${i}`

/**
 * 這個中間人這一天的委託（掛點 fixer.offers 的答案）：每天三件；有人註冊 enemy_pick 時挑不到敵人的組合重抽，還是不行就少給一件。
 * 同一天回答一樣的東西：亂數用的存檔游標固定在 0，中間擲了幾次骰都不變（信譽升階之後等級會變，那是狀態變了）。
 */
export function offersFor(k: Kernel, state: GameState, fixer: FixerEntry, day: number): Offer[] {
  if (eligibleTypes(k, fixer).length === 0) return []
  const pinned: GameState = { ...state, rng: { seed: state.rng.seed, cursor: 0 } }
  const out: Offer[] = []
  for (let i = 0; i < OFFERS_PER_DAY; i++) {
    const o = generate(k, pinned, { fixer, seed: offerSeed(fixer.id, day, i) })
    if (o) out.push(o)
  }
  return out
}
