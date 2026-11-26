// L6 功能 media 的第二半：開關錄影、把一則紀錄轉成素材、問素材庫、用掉一件（MEDIA 1.1 節、第 2 節、2.1 節；dev/adr/0020 第一節、V1、V5、V7）。
// 改狀態的入口都是「回傳報告草稿」，不成立丟 ActionBlocked（原因寫成給玩家看的完整句子）。
// 使用次數的規則只有這裡知道：別的功能要用一件料，只經由掛點 media.spend（回傳的變更併進自己那一份報告）。

import type { Change, GameState, Kernel, ReportDraft, TimelineBeat } from '../../core'
import { ActionBlocked, clone } from '../../core'
import type { FootageInit } from './ops'
import type { Mark, Material, Miss, RecordEntry, SpendAnswer } from './model'
import { CONVERT_ACTION, REC_ACTION, TYPE_NAME, materialOfClip, materialOfFootage, mediaRules, minutesNow, qualityParts, readMedia } from './model'

export const draftOf = (state: GameState, action: string, changes: Change[], result: string, summary: string, extra: Partial<ReportDraft> = {}): ReportDraft => ({
  kind: 'broadcast', action, location: clone(state.location), ...(state.pc ? { actor: state.pc } : {}), party: [], timeline: [], changes, outcome: { result, summary }, ...extra,
})

// ---- 錄影的開關 ----

/** 現在能不能開關錄影：已經是那個樣子、或有活動擋著，回傳完整的一句原因。 */
export function recordingBlock(k: Kernel, state: GameState, on: boolean): string | null {
  if (readMedia(state).rec === on) return on ? '錄影本來就開著。' : '錄影本來就是關著的。'
  return k.activity.blockOf(state, `commit:${REC_ACTION}`)
}

/** 開或關錄影（玩家不想留下證據的時候關掉它）。 */
export function setRecording(k: Kernel, state: GameState, on: boolean): ReportDraft {
  const block = recordingBlock(k, state, on)
  if (block) throw new ActionBlocked(block)
  return draftOf(state, REC_ACTION, [{ op: 'media.rec', on }], on ? 'on' : 'off', on ? '你把錄影打開了。' : '你把錄影關掉了：之後的事不會留下畫面。')
}

// ---- 轉成素材 ----

const MISS_TEXT: Record<Miss, string> = {
  off: '那時錄影是關著的，沒有留下畫面。',
  none: '那時隊伍裡沒有人裝著錄影的義體，沒有留下畫面。',
  banned: '那個地方不准錄，沒有留下畫面。',
}

const MARK_TEXT: Record<Mark, string> = {
  crit: '拍到了要害的一擊', boss: '拍到首領倒下的那一刻', celebrity: '畫面裡有名人', hq: '畫面很清楚', live: '這一段直播過', lost: '是一段戰敗的畫面', adult: '是成人的畫面', self: '畫面裡有你自己',
}

/** 這則紀錄現在能不能轉成素材：回傳完整的一句原因（轉得了是 null）。撤退或失敗收回的紀錄照樣能轉（使用者 2026-11-24）。 */
export function convertBlock(k: Kernel, state: GameState, id: string): string | null {
  const rec = readMedia(state).records[id]
  if (!rec) return '沒有這則紀錄。'
  if (rec.made !== undefined) return `「${rec.label}」已經轉成素材了：一則紀錄只能轉一次。`
  if (rec.by === null) return `「${rec.label}」：${MISS_TEXT[rec.miss ?? 'none']}`
  return k.activity.blockOf(state, `commit:${CONVERT_ACTION}`)
}

/** 轉成素材：品質照 V5 在這一刻定下來（之後不隨時間變），三次使用機會，標題與說明由程式照那一則的記號寫。 */
export function convertDraft(k: Kernel, state: GameState, id: string): ReportDraft {
  const block = convertBlock(k, state, id)
  if (block) throw new ActionBlocked(block)
  const rec = readMedia(state).records[id]!
  const rules = mediaRules(k)
  const q = qualityParts(k, state, rec, rules)
  const footage = footageFrom(rec, q.value, minutesNow(state), rules.uses)
  const beat: TimelineBeat = {
    layer: 'meat', ...(state.pc ? { actor: state.pc } : {}), text: `你把「${rec.label}」做成了一段素材。`, tag: 'media.convert',
    data: { record: rec.id, type: rec.type, quality: q.value, cap: q.cap, uses: rules.uses, parts: q.parts },
  }
  return draftOf(state, CONVERT_ACTION, [{ op: 'media.make', record: rec.id, footage }], 'converted', `你把「${rec.label}」做成了素材。`, {
    timeline: [beat], narration: { results: [`「${rec.label}」做成了一段${TYPE_NAME[rec.type]}類的素材。`] },
  })
}

function footageFrom(rec: RecordEntry, quality: number, now: number, uses: number): FootageInit {
  const notes = rec.marks.map((m) => MARK_TEXT[m])
  return {
    title: rec.label, text: `${rec.label}。${notes.length > 0 ? `${notes.join('，')}。` : ''}`, type: rec.type, quality, authentic: 'real', exclusive: rec.exclusive,
    involves: { factions: [...rec.involves.factions], people: [...rec.involves.people] }, uses, made_at: now, origin: 'own',
    celebrity: rec.marks.includes('celebrity'), self: rec.marks.includes('self'), adult: rec.marks.includes('adult'), ...(rec.tags && rec.tags.length > 0 ? { tags: [...rec.tags] } : {}),
  }
}

// ---- 素材庫 ----

/** 一件料（素材 ft… 或片 cl…）現在的樣子（用完的也回；不存在是 null）。 */
export function materialOf(k: Kernel, state: GameState, ref: string): Material | null {
  const m = readMedia(state)
  const f = m.footage[ref]
  if (f) return materialOfFootage(k, state, f)
  const c = m.clips[ref]
  return c ? materialOfClip(k, state, c) : null
}

/** 素材庫裡還能用的料（掛點 media.materials）：只列使用次數大於 0 的；kinds 沒給是素材與片都要。 */
export function materialsOf(k: Kernel, state: GameState, kinds?: Array<'footage' | 'clip'>): Material[] {
  const rules = mediaRules(k)
  const m = readMedia(state)
  return [
    ...(!kinds || kinds.includes('footage') ? Object.values(m.footage).filter((f) => f.uses > 0).map((f) => materialOfFootage(k, state, f, rules)) : []),
    ...(!kinds || kinds.includes('clip') ? Object.values(m.clips).filter((c) => c.uses > 0).map((c) => materialOfClip(k, state, c, rules)) : []),
  ]
}

/**
 * 用掉一件（掛點 media.spend；自己的下一張工單也用它）：扣 1 次，或 all 扣光。用完的、不存在的回原因。
 * 回傳的 material 是扣完之後的樣子（次數已經少了）；變更由問的人併進自己那一份報告，套用了次數才少。
 */
export function spend(k: Kernel, state: GameState, o: { ref: string; how?: string; all?: boolean }): SpendAnswer {
  const m = readMedia(state)
  const f = m.footage[o.ref]
  const c = f ? undefined : m.clips[o.ref]
  const item = f ?? c
  if (!item) return { block: '素材庫裡沒有這件料。' }
  if (item.uses <= 0) return { block: `「${item.title}」已經用完了，只能留著當紀念。` }
  const uses = o.all === true ? 0 : item.uses - 1
  const change = { op: 'media.use', ref: item.id, take: o.all === true ? 'all' : 1 } as const
  // 片和素材各算各的次數：用片不動來源、用素材也不動剪出來的片（MEDIA 2.1 節）
  return { changes: [change], material: f ? materialOfFootage(k, state, { ...f, uses }) : materialOfClip(k, state, { ...c!, uses }) }
}
