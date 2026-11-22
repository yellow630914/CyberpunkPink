// L6 功能：建角。檢查建角草稿的每一步（基本資料、出身、屬性、基本功、特質，加上義體與裝備點數換成的錢），把合格的草稿變成放進主角的報告
// （CHARACTER 第 1、2、5.1、5.3、5.4、5.6 節；UI 第 14 節的年齡；DATA 第 1、8 節）。全部是純函式：不改傳進來的東西，也不自己提交。
// 不做生命軌跡、橋與義體、技能樹、裝備（那些系統還沒搬進來）：義體與裝備花了幾點由呼叫的人算好交進來，這裡只管上限與沒花完的換多少現金。
// 檢查回傳 string | null：null 是沒問題，字串是擋住的原因（給玩家看的完整句子）。

import type { Actor, AttrId, CreationRuleEntry, FactionEntry, Feature, GameState, Kernel, NpcEntry, OriginEntry, PerkEntry, ReportDraft, SkillId } from '../../core'
import { ATTR_IDS, CONTENT_TAG_INTIMATE_BODY, GENDER_IDS, MIN_AGE, SKILL_MAX, attrMod, clone, contentAllowed, isRecord } from '../../core'

/** 建角的步驟（CHARACTER 第 1 節）：basics 第 1 步、origin 第 2 步、attrs 第 3 步、skills 第 4 步、cyber 第 6 步、perks 第 7 步、gear 第 9 步。 */
export type CreationStep = 'basics' | 'origin' | 'attrs' | 'skills' | 'cyber' | 'perks' | 'gear'
export interface CreationBlock { step: CreationStep; reason: string }

/** 私處的外觀（DATA 第 8 節的 look.private）：選的詞條加上自由輸入的一段。成人內容，受內容篩選「身體的私密描寫」控制。 */
export interface LookPrivate {
  options: string[]
  text: string
}

/** 外觀：鍵是部位，值是下拉選的詞條；private 是私處的外觀。 */
export interface CreationLook {
  private?: LookPrivate
  [part: string]: string | LookPrivate | undefined
}

export interface CreationDraft {
  name: string
  /** female、male、femboy、trans_f、futa（DATA 第 1 節的五個值；TS 只有男跨女一種，id 是 trans_f） */
  gender: string
  pronoun?: string
  age: number | string
  /** 外觀的下拉選的結果，原樣存。look.private（私處）在內容篩選關掉「身體的私密描寫」時不寫進角色 */
  look?: CreationLook
  /** 手動補充的外觀 */
  lookNote?: string
  background?: string
  /** 出身的 id */
  origin: string
  /** 好感給哪個勢力：勢力的 id（出身的 favor.choose_one 有兩個以上時要選） */
  originChoice?: { favor?: string }
  /** 第 6 步花掉的義體點數。沒花完的每點換現金（CHARACTER 5.4 節）；沒給就不換（當成花完） */
  cyberSpent?: number
  /** 第 9 步花掉的裝備點數。沒花完的每點換現金；沒給就不換 */
  gearSpent?: number
  /** 六個數字各分給哪一項 */
  attrPick: Partial<Record<AttrId, number>>
  /** 每一項的增減：正的花自由點數，負的是往下壓 */
  attrBonus: Partial<Record<AttrId, number>>
  /** 買的基本功等級（不含出身送的 +1） */
  skills: Record<SkillId, number>
  /** 買的特質與缺陷（不含出身特質） */
  perks: string[]
}

type AttrMap = Partial<Record<AttrId, number>>

/** creation_rule/default 沒有載入（或沒寫那一欄）時的預設值（CHARACTER 5.1、5.3、5.4 節）。 */
const DEFAULT_RULE = { attr_array: [15, 14, 13, 12, 10, 8], attr_free: 2, attr_max: 18, attr_min: 4, perk_max: 8, flaw_max: 2, gear_points: 12, cyber_point_cash: 500, gear_point_cash: 150 }

function rule(k: Kernel) {
  const r = k.content.get<CreationRuleEntry>('creation_rule', 'default')
  return {
    attr_array: r?.attr_array ?? DEFAULT_RULE.attr_array,
    attr_free: r?.attr_free ?? DEFAULT_RULE.attr_free,
    attr_max: r?.attr_max ?? DEFAULT_RULE.attr_max,
    attr_min: r?.attr_min ?? DEFAULT_RULE.attr_min,
    perk_max: r?.perk_max ?? DEFAULT_RULE.perk_max,
    flaw_max: r?.flaw_max ?? DEFAULT_RULE.flaw_max,
    gear_points: r?.gear_points ?? DEFAULT_RULE.gear_points,
    cyber_point_cash: r?.cyber_point_cash ?? DEFAULT_RULE.cyber_point_cash,
    gear_point_cash: r?.gear_point_cash ?? DEFAULT_RULE.gear_point_cash,
  }
}

/** 建角的數字（給畫面顯示與下拉選單用）。來源是資料（creation_rule/default）與這一局的存檔規則；畫面不自己留一份預設值。 */
export interface CreationLimits {
  attrArray: number[]
  attrFree: number
  attrMax: number
  attrMin: number
  skillPoints: number
  skillMax: number
  perkPoints: number
  perkMax: number
  flawMax: number
  /** 起始的錢（全部是現金，每個出身一樣） */
  startMoney: number
  cyberPoints: number
  gearPoints: number
  /** 沒花完的義體點數、裝備點數每點換多少現金 */
  cyberPointCash: number
  gearPointCash: number
}

export function creationLimits(k: Kernel, state: GameState): CreationLimits {
  const r = rule(k)
  return {
    attrArray: [...r.attr_array], attrFree: r.attr_free, attrMax: r.attr_max, attrMin: r.attr_min,
    skillPoints: state.rules.startSkillPoints, skillMax: state.rules.startSkillMax,
    perkPoints: state.rules.startPerkPoints, perkMax: r.perk_max, flawMax: r.flaw_max,
    startMoney: state.rules.startMoney, cyberPoints: state.rules.startCyberPoints, gearPoints: r.gear_points,
    cyberPointCash: r.cyber_point_cash, gearPointCash: r.gear_point_cash,
  }
}

const isInt = (v: unknown): v is number => typeof v === 'number' && Number.isInteger(v)
const sum = (xs: number[]): number => xs.reduce((s, x) => s + x, 0)

// ---- 第 1 步：年齡 ----

/** 年齡是硬界線：只收整數，低於 18 擋下（UI 第 14 節）。 */
export function ageBlock(raw: string | number): string | null {
  const s = String(raw).trim()
  if (!/^\d+$/.test(s)) return '年齡要填整數。'
  if (Number(s) < MIN_AGE) return `所有角色都是成年人：年齡要 ${MIN_AGE} 以上。`
  if (Number(s) > 200) return '年齡填不到這麼大。'
  return null
}

// ---- 第 3 步：屬性 ----

export function attrTotals(pick: AttrMap, bonus: AttrMap): Record<AttrId, number> {
  return Object.fromEntries(ATTR_IDS.map((a) => [a, (pick[a] ?? 0) + (bonus[a] ?? 0)])) as Record<AttrId, number>
}

/** 自由點數：總共有幾點（基本的加上壓下去的）、花了幾點、剩幾點。 */
export function attrBudget(k: Kernel, bonus: AttrMap): { total: number; lowered: number; spent: number; left: number } {
  const lowered = sum(ATTR_IDS.map((a) => Math.max(0, -(bonus[a] ?? 0))))
  const spent = sum(ATTR_IDS.map((a) => Math.max(0, bonus[a] ?? 0)))
  const total = rule(k).attr_free + lowered
  return { total, lowered, spent, left: total - spent }
}

export function attrBlock(k: Kernel, pick: AttrMap, bonus: AttrMap): string | null {
  const r = rule(k)
  if (ATTR_IDS.some((a) => bonus[a] !== undefined && !isInt(bonus[a]))) return '屬性的增減要是整數。'
  const unset = ATTR_IDS.filter((a) => pick[a] === undefined)
  if (unset.length > 0) return `還有 ${unset.length} 項屬性沒有分配。`
  const pool = [...r.attr_array]
  for (const a of ATTR_IDS) {
    const i = pool.indexOf(pick[a]!)
    if (i < 0) return '每個數字只能用一次。'
    pool.splice(i, 1)
  }
  const b = attrBudget(k, bonus)
  if (b.spent > b.total) return `自由點數只有 ${b.total} 點。`
  if (b.left > 0) return `還有 ${b.left} 點自由點數沒有用。`
  const totals = attrTotals(pick, bonus)
  if (ATTR_IDS.some((a) => totals[a] > r.attr_max)) return `單項最高 ${r.attr_max}。`
  if (ATTR_IDS.some((a) => totals[a] < r.attr_min)) return `單項最低 ${r.attr_min}。`
  return null
}

/**
 * 按一下某一項屬性的 ＋ 或 − 會不會被擋：回傳擋住的原因，可以按就回傳 null。
 * 規則：先要分配數字；加了之後不能超過單項上限、減了之後不能低於單項下限；自由點數不夠時不能再加（把別的屬性往下壓可以換）。
 */
export function attrStepBlock(k: Kernel, pick: AttrMap, bonus: AttrMap, attr: AttrId, delta: 1 | -1): string | null {
  const r = rule(k)
  if (pick[attr] === undefined) return '先選這一項的數字。'
  const next: AttrMap = { ...bonus, [attr]: (bonus[attr] ?? 0) + delta }
  const total = attrTotals(pick, next)[attr]
  if (delta > 0 && total > r.attr_max) return `單項最高 ${r.attr_max}。`
  if (delta < 0 && total < r.attr_min) return `最低 ${r.attr_min}（調整值 ${attrMod(r.attr_min)}）。`
  if (attrBudget(k, next).left < 0) return '自由點數用完了：先把別的屬性往下壓，一點換一點。'
  return null
}

// ---- 第 4 步：基本功 ----

export function skillLeft(_k: Kernel, state: GameState, levels: Record<SkillId, number>): number {
  return state.rules.startSkillPoints - sum(Object.values(levels))
}

export function skillBlock(k: Kernel, state: GameState, levels: Record<SkillId, number>): string | null {
  const entries = Object.entries(levels)
  if (entries.some(([, v]) => !isInt(v) || v < 0)) return '基本功的等級要是 0 以上的整數。'
  const unknown = entries.find(([id, v]) => v > 0 && !k.content.has('skill', id))
  if (unknown) return `沒有「${unknown[0]}」這項基本功。`
  if (entries.some(([, v]) => v > state.rules.startSkillMax)) return `建角時單項最高 ${state.rules.startSkillMax} 級。`
  if (skillLeft(k, state, levels) < 0) return `基本功的點數只有 ${state.rules.startSkillPoints} 點。`
  return null
}

// ---- 第 7 步：特質與缺陷 ----

export function perkSummary(k: Kernel, state: GameState, picked: string[]): { left: number; perks: number; flaws: number } {
  const found = picked.map((id) => k.content.get<PerkEntry>('perk', id)).filter((p): p is PerkEntry => p !== undefined)
  const perks = found.filter((p) => !p.flaw)
  const flaws = found.filter((p) => p.flaw)
  return { left: state.rules.startPerkPoints + sum(flaws.map((p) => p.cost)) - sum(perks.map((p) => p.cost)), perks: perks.length, flaws: flaws.length }
}

export function perkBlock(k: Kernel, state: GameState, picked: string[]): string | null {
  const r = rule(k)
  if (new Set(picked).size !== picked.length) return '同一個特質不能選兩次。'
  const missing = picked.find((id) => !k.content.has('perk', id))
  if (missing !== undefined) return `沒有「${missing}」這個特質。`
  if (picked.some((id) => k.content.get<PerkEntry>('perk', id)!.category === 'origin')) return '出身特質是出身送的，不能用點數買。'
  const s = perkSummary(k, state, picked)
  if (s.flaws > r.flaw_max) return `缺陷最多 ${r.flaw_max} 個。`
  if (s.perks > r.perk_max) return `特質最多 ${r.perk_max} 個。`
  if (s.left < 0) return `特質點超過了 ${-s.left} 點。`
  return null
}

// ---- 第 1 步：性別與外觀 ----

export function genderBlock(gender: string): string | null {
  if (gender === '') return '要選性別。'
  return (GENDER_IDS as readonly string[]).includes(gender) ? null : '沒有這個性別。'
}

const isLookPrivate = (v: unknown): v is LookPrivate => isRecord(v) && Array.isArray(v.options) && v.options.every((x) => typeof x === 'string') && typeof v.text === 'string'

/** 外觀的格式：每個部位是一段字；private（私處）是 { options, text }。 */
export function lookBlock(look: CreationLook | undefined): string | null {
  if (look === undefined) return null
  if (!isRecord(look)) return '外觀的格式不對。'
  for (const [part, v] of Object.entries(look)) {
    if (part === 'private') {
      if (v !== undefined && !isLookPrivate(v)) return '私處的外觀要有選的詞條與補充的一段字。'
    } else if (typeof v !== 'string') return '外觀的每一項都要是一段字。'
  }
  return null
}

// ---- 第 2 步：出身 ----

export interface NamedId { id: string; name: string }

/** 出身給畫面用的摘要：好感可以給哪幾個勢力（短名）、開場就在名冊上的人（名字）。沒有這個出身回傳 null。 */
export function originView(k: Kernel, originId: string): { favor: NamedId[]; favorValue: number; roster: NamedId[] } | null {
  const o = k.content.get<OriginEntry>('origin', originId)
  if (!o) return null
  return {
    favor: o.favor.choose_one.map((id) => ({ id, name: k.content.get<FactionEntry>('faction', id)?.short ?? id })),
    favorValue: o.favor.value,
    roster: o.roster.map((id) => ({ id, name: k.content.get<NpcEntry>('npc', id)?.name ?? id })),
  }
}

/** 出身要不要選勢力：回傳選定的勢力（id），或擋住的原因。只有一個可以選的自動用那一個。 */
function favorOf(k: Kernel, origin: OriginEntry, draft: CreationDraft): { favor: string } | { block: string } {
  const list = origin.favor.choose_one
  if (list.length === 1) return { favor: list[0]! }
  const chosen = draft.originChoice?.favor
  if (chosen === undefined || !list.includes(chosen)) return { block: `要選一個勢力：${list.map((id) => k.content.get<FactionEntry>('faction', id)?.short ?? id).join('、')}。` }
  return { favor: chosen }
}

// ---- 第 6、9 步：義體與裝備的點數，沒花完的換成現金 ----

function pointsBlock(spent: number | undefined, total: number, what: string): string | null {
  if (spent === undefined) return null
  if (!isInt(spent) || spent < 0) return `花掉的${what}點數要是 0 以上的整數。`
  return spent > total ? `${what}點數只有 ${total} 點。` : null
}

/**
 * 起始的錢（CHARACTER 5.4 節）：全部是現金，每個出身一樣、不加減。
 * 組成：存檔規則的起始的錢，加上沒花完的義體點數（每點 C$500）與裝備點數（每點 C$150）換的。草稿沒有寫花了幾點的那一項不換。
 */
export function startMoney(k: Kernel, state: GameState, draft: Pick<CreationDraft, 'cyberSpent' | 'gearSpent'>): { base: number; cyber: number; gear: number; total: number } {
  const r = rule(k)
  const left = (spent: number | undefined, total: number) => (spent !== undefined && isInt(spent) ? Math.max(0, total - Math.max(0, spent)) : 0)
  const base = state.rules.startMoney
  const cyber = left(draft.cyberSpent, state.rules.startCyberPoints) * r.cyber_point_cash
  const gear = left(draft.gearSpent, r.gear_points) * r.gear_point_cash
  return { base, cyber, gear, total: base + cyber + gear }
}

// ---- 整份 ----

/** 每一步最多回報一筆（那一步第一個碰到的問題）；沒有問題的步驟不出現。 */
export function creationBlocks(k: Kernel, state: GameState, draft: CreationDraft): CreationBlock[] {
  const out: CreationBlock[] = []
  const add = (step: CreationStep, reason: string | null | undefined): void => {
    if (reason) out.push({ step, reason })
  }
  add('basics',
    state.pc !== null ? '已經有主角了。'
      : draft.name.trim() === '' ? '要有名字。'
        : genderBlock(draft.gender) ?? ageBlock(draft.age) ?? lookBlock(draft.look))
  const origin = k.content.get<OriginEntry>('origin', draft.origin)
  add('origin', origin === undefined ? '沒有這個出身。' : (favorOf(k, origin, draft) as { block?: string }).block)
  add('attrs', attrBlock(k, draft.attrPick, draft.attrBonus))
  add('skills', skillBlock(k, state, draft.skills))
  add('cyber', pointsBlock(draft.cyberSpent, state.rules.startCyberPoints, '義體'))
  add('perks', perkBlock(k, state, draft.perks))
  add('gear', pointsBlock(draft.gearSpent, rule(k).gear_points, '裝備'))
  return out
}

/** 合格的草稿變成一份報告草稿；不合格就丟錯，訊息是第一個問題的原因。提交由呼叫的人做。 */
export function buildCreationReport(k: Kernel, state: GameState, draft: CreationDraft): ReportDraft {
  const blocks = creationBlocks(k, state, draft)
  if (blocks.length > 0) throw new Error(blocks[0]!.reason)
  const origin = k.content.get<OriginEntry>('origin', draft.origin)!
  const favor = (favorOf(k, origin, draft) as { favor: string }).favor

  const skills: Record<SkillId, number> = {}
  for (const [id, v] of Object.entries(draft.skills)) if (v > 0) skills[id] = v
  // 出身的 +1 可以超過建角的單項上限，但還是不能超過基本功本身的上限
  for (const [id, v] of Object.entries(origin.skill_bonus)) skills[id] = Math.min(SKILL_MAX, (skills[id] ?? 0) + v)

  const profile: Record<string, unknown> = {}
  if (draft.pronoun !== undefined) profile.pronoun = draft.pronoun
  if (draft.look !== undefined) {
    // 內容篩選關掉「身體的私密描寫」時不寫私處（DATA 第 8 節：不問、不寫）
    const { private: intimate, ...parts } = clone(draft.look)
    profile.look = intimate !== undefined && contentAllowed(state.rules, CONTENT_TAG_INTIMATE_BODY) ? { ...parts, private: intimate } : parts
  }
  if (draft.lookNote !== undefined) profile.lookNote = draft.lookNote
  if (draft.background !== undefined) profile.background = draft.background

  const actor: Actor = {
    id: 'pc', role: 'pc', name: draft.name.trim(), age: Number(String(draft.age).trim()), gender: draft.gender,
    attrs: attrTotals(draft.attrPick, draft.attrBonus),
    skills,
    perks: [origin.perk, ...draft.perks],
    hp: 1, load: 0, afterglow: 0, sink: 0, conditions: [],
    ext: {
      origin: { id: origin.id, favor, favorValue: origin.favor.value, status: origin.status, home: origin.home, roster: clone(origin.roster) },
      profile,
    },
  }
  // 生命值從上限開始（有功能註冊了 max_hp 的話）：把角色放進一份複製的狀態算
  if (k.stats.hasStat('max_hp')) {
    const trial = clone(state)
    trial.actors.pc = clone(actor)
    actor.hp = k.stats.stat(trial, 'pc', 'max_hp')
  }

  const changes: ReportDraft['changes'] = [{ op: 'actor.add', actor }, { op: 'pc', id: 'pc' }]
  // 起始的錢全部放現金；沒花完的義體與裝備點數換的也是現金（CHARACTER 5.4 節）
  const money = startMoney(k, state, draft).total
  if (money > 0) changes.push({ op: 'cash', delta: money })
  return {
    kind: 'system', action: 'creation.commit', location: clone(state.location), actor: 'pc',
    party: [], timeline: [],
    changes,
    outcome: { result: 'created', summary: `${actor.name}的故事從${origin.name}開始。` },
  }
}

export const creationFeature: Feature = {
  id: 'creation',
  install() {},
}
