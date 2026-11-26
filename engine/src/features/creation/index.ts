// L6 功能：建角。檢查建角草稿的每一步（基本資料、出身、屬性、基本功、特質，加上義體與裝備點數換成的錢），把合格的草稿變成放進主角的報告
// （CHARACTER 第 1、2、5.1、5.3、5.4、5.6 節；UI 第 14 節的年齡；DATA 第 1、8 節）。全部是純函式：不改傳進來的東西，也不自己提交。
// 第 6、8、9 步（橋與義體、技能、裝備）不 import 別的功能：經掛點 creation.step 問各功能（body.ts；M4-creation-body），這裡只管點數的上限與沒花完的換多少現金；
// 草稿沒給選的東西時，義體與裝備花了幾點由呼叫的人算好交進來（cyberSpent、gearSpent）。
// 第 5 步生命軌跡（lifepath.ts；M4-creation-lifepath）：內容種類 lifepath_entry，結果是效果清單、個人目標、性經歷記錄（creation 自己處理）與 NPC、傾向、橋參數（經掛點 creation.step 的 lifepath 交給 npcs、lewd）。
// 檢查回傳 string | null：null 是沒問題，字串是擋住的原因（給玩家看的完整句子）。

import type { Actor, AttrId, FactionEntry, Feature, GameState, Kernel, NpcEntry, OriginEntry, PerkEntry, ReportDraft, SkillId } from '../../core'
import { ATTR_IDS, CONTENT_TAG_INTIMATE_BODY, ContentError, blankState, GENDER_IDS, MIN_AGE, SKILL_MAX, attrMod, clone, contentAllowed, contentTagName, isRecord } from '../../core'
import { abilitiesStepBlock, askStep, cyberStepBlock, dedupeExt, gearStepBlock, leftoverCash, pointsSpent } from './body'
import type { BodyStep } from './body'
import { LIFEPATH_KIND, TENDENCY_TAG_KIND, askLifepath, entryProblems, lifepathBlock, lifepathEffects, lifepathRefs, lifepathSummary } from './lifepath'
import type { LifepathEntry, LifepathSummaryRow } from './lifepath'
import { creationLimits, rule } from './model'
import type { CreationBlock, CreationDraft, CreationLook, CreationStep, LookPrivate } from './model'

export type { CreationBlock, CreationDraft, CreationLimits, CreationLook, CreationStep, LifepathTable, LookPrivate } from './model'
export { DEFAULT_GEAR_KINDS, LIFEPATH_TABLES, creationLimits } from './model'
export { BRIDGE_TWEAK_MAX, LIFEPATH_KIND, MAX_KINKS, NPC_ROLES, ROLE_NAME, TABLE_NAME, kinkChoices, lifepathBlock, lifepathProblems, lifepathRoll, lifepathTables, textOf } from './lifepath'
export type { LifepathEntry, LifepathNpc, LifepathOption, LifepathOutcome, LifepathResult, LifepathSummaryRow, LifepathTableView, LifepathTendency, NpcRole } from './lifepath'
export { DEFAULT_BEAST_LINE, DEFAULT_BEAST_LINES, DEFAULT_BRAND_LINES, GEAR_GROUPS, creationCatalog, creationLook, lookTexts, suggestedKit } from './catalog'
export type { CatalogAnswer, CatalogPayload, CatalogRow, CreationCatalog, DerivedLook, LookAnswer, LookPayload, LookTexts, SuggestedKit } from './catalog'
export { BODY_STEPS, abilitiesStepBlock, askStep, creationSummary, cyberStepBlock, gearStepBlock, leftoverCash, pointsSpent } from './body'
export type { BodyStep, CapacitySplit, CreationSummary, OwnedItem, PointSummary, StepAnswer, StepPayload, StepResult } from './body'

type AttrMap = Partial<Record<AttrId, number>>

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

/**
 * 這個特質現在被內容篩選擋住的原因（一句）；沒擋是 null。特質的 tags 裡有哪個被玩家關掉就擋：照樣列在清單上，畫面灰掉並寫這句，選不了（使用者 2026-11-26：保留、disable）。
 * 查不到這個特質也是 null（那是別的原因）。
 */
export function perkFilterBlock(k: Kernel, state: GameState, id: string): string | null {
  const perk = k.content.get<PerkEntry>('perk', id)
  const off = (perk?.tags ?? []).filter((t) => !contentAllowed(state.rules, t))
  if (!perk || off.length === 0) return null
  const names = off.map((t) => contentTagName(t, k.content.get('tendency_tag', t)?.name as string | undefined)).map((n) => `「${n}」`).join('、')
  return `「${perk.name}」屬於${names}，被你的內容篩選關掉了，選不了。`
}

export function perkBlock(k: Kernel, state: GameState, picked: string[]): string | null {
  const r = rule(k)
  if (new Set(picked).size !== picked.length) return '同一個特質不能選兩次。'
  const missing = picked.find((id) => !k.content.has('perk', id))
  if (missing !== undefined) return `沒有「${missing}」這個特質。`
  if (picked.some((id) => k.content.get<PerkEntry>('perk', id)!.category === 'origin')) return '出身特質是出身送的，不能用點數買。'
  for (const id of picked) {
    const why = perkFilterBlock(k, state, id)
    if (why) return why
  }
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

/**
 * 起始的錢（CHARACTER 5.4 節）：全部是現金，每個出身一樣、不加減。
 * 組成：存檔規則的起始的錢，加上沒花完的義體點數（每點 C$500）與裝備點數（每點 C$250）換的。花了幾點：草稿選的東西算出來的優先
 * （各功能經 creation.step 回答），沒有的話看草稿寫的 cyberSpent、gearSpent；兩邊都沒有的那一項不換。
 */
export function startMoney(k: Kernel, state: GameState, draft: Pick<CreationDraft, 'cyberSpent' | 'gearSpent'> & Partial<CreationDraft>): { base: number; cyber: number; gear: number; total: number } {
  return leftoverCash(creationLimits(k, state), state, pointsSpent(k, state, draft as CreationDraft))
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
  add('lifepath', lifepathBlock(k, state, draft)?.reason)
  const addBlock = (b: CreationBlock | null): void => {
    if (b) out.push(b)
  }
  addBlock(cyberStepBlock(k, state, draft))
  add('perks', perkBlock(k, state, draft.perks))
  addBlock(abilitiesStepBlock(k, state, draft))
  addBlock(gearStepBlock(k, state, draft))
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
  // 第 6、8、9 步：各功能經 creation.step 回答（橋與義體、技能、裝備）。放進主角時就寫的 ext（沒有橋是 bridge: null）併進角色，
  // 其餘的變更接在放進主角的那一筆後面；沒有人回答（草稿沒給選的東西）時什麼都沒有
  const steps = (['cyber', 'abilities', 'gear'] as const).map((step: BodyStep) => askStep(k, state, draft, step))
  for (const r of steps) Object.assign(actor.ext, clone(r.ext))
  const stepChanges = dedupeExt(steps.flatMap((r) => clone(r.changes)))

  // 第 5 步：生命軌跡。問掛點的結果（傾向、橋參數、性經歷記錄、出身名冊）併進角色，NPC、關係、豔名與旗標接在後面
  const lp = askLifepath(k, state, draft, actor.ext, favor)
  Object.assign(actor.ext, lp.ext)
  if (lp.roster.length > 0) {
    const o = actor.ext.origin as { roster: string[] }
    for (const id of lp.roster) if (!o.roster.includes(id)) o.roster.push(id)
  }

  // 生命值從上限開始（有功能註冊了 max_hp 的話）：把角色放進一份複製的狀態算（選的義體也算進去）
  if (k.stats.hasStat('max_hp')) {
    const trial = clone(state)
    trial.actors.pc = clone(actor)
    for (const c of stepChanges) {
      const t = c as { op: string; id?: unknown; key?: unknown; value?: unknown }
      if (t.op === 'actor.ext' && t.id === 'pc' && typeof t.key === 'string') trial.actors.pc!.ext[t.key] = clone(t.value)
    }
    actor.hp = k.stats.stat(trial, 'pc', 'max_hp')
  }

  const changes: ReportDraft['changes'] = [{ op: 'actor.add', actor }, { op: 'pc', id: 'pc' }, ...stepChanges]
  // 起始的錢全部放現金；沒花完的義體與裝備點數換的也是現金（CHARACTER 5.4 節）
  const money = startMoney(k, state, draft).total
  if (money > 0) changes.push({ op: 'cash', delta: money })
  changes.push(...lp.changes)
  // 生命軌跡的效果清單：用內建的來源落在主角身上，沒有功能認得的一筆整筆拿掉、寫進提醒
  const fx = lifepathEffects(k, state, draft, changes)
  changes.push(...fx.changes)
  const notes = [...lp.notes, ...fx.notes]
  return {
    kind: 'system', action: 'creation.commit', location: clone(state.location), actor: 'pc',
    party: [], timeline: [],
    changes,
    ...(notes.length > 0 ? { clamps: notes } : {}),
    outcome: { result: 'created', summary: `${actor.name}的故事從${origin.name}開始。` },
  }
}

/**
 * 第 5 步每一條選的條目提交時會變成什麼（總覽頁用）：條目的文字（照出身換好）與每一種結果的一句話。
 * 效果用一份放了主角的狀態算白話的一行；沒有功能接得住的結果寫明這一局不會生效。
 */
export function lifepathResults(k: Kernel, state: GameState, draft: CreationDraft): LifepathSummaryRow[] {
  const preview = clone(state)
  preview.actors.pc = {
    id: 'pc', role: 'pc', name: draft.name.trim() || '主角', age: 18, gender: draft.gender, attrs: attrTotals(draft.attrPick, draft.attrBonus), skills: {}, perks: [],
    hp: 1, load: 0, afterglow: 0, sink: 0, conditions: [], ext: {},
  }
  preview.pc = 'pc'
  return lifepathSummary(k, draft, preview)
}

export const creationFeature: Feature = {
  id: 'creation',
  install(k) {
    k.content.defineKind<LifepathEntry>({ kind: LIFEPATH_KIND, owner: 'creation', validate: entryProblems, refs: lifepathRefs })
  },
  ready(k) {
    // creation_rule 的 cyber_point_price、cyber_install_mult、gear_point_price、gear_grade_max、gear_kinds 的格式在核心的內容檢查（M4-core-gaps 第 9 項）
    const problems: string[] = []
    // 生命軌跡：結果引用的傾向標籤、勢力要查得到；已經有功能註冊的效果種類，格式要對（沒註冊的留到提交時寫進提醒）
    const fxCtx = { state: blankState(0), actor: 'pc', grade: 1, source: 'builtin', clampAsked: true, content: k.content } as unknown as Parameters<Kernel['effects']['validate']>[1]
    for (const e of k.content.list<LifepathEntry>(LIFEPATH_KIND)) {
      const at = `${LIFEPATH_KIND}/${e.id}`
      const r = e.result
      if (k.content.hasKind(TENDENCY_TAG_KIND)) {
        for (const t of r.tendency ?? []) if (!k.content.has(TENDENCY_TAG_KIND, t.tag)) problems.push(`${at}：result.tendency 引用了不存在的傾向標籤 ${t.tag}`)
      }
      const f = r.npc?.faction_from
      if (f !== undefined && f !== 'origin' && !k.content.has('faction', f)) problems.push(`${at}：result.npc.faction_from 引用了不存在的勢力 ${f}`)
      for (const [i, fx] of (r.effects ?? []).entries()) {
        if (k.effects.has(fx.kind as string)) problems.push(...k.effects.validate([fx], fxCtx, `result.effects[${i}]`).map((m) => `${at}：${m}`))
      }
    }
    if (problems.length) throw new ContentError(problems)
  },
}
