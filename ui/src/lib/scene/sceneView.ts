import type { Report } from '@engine/src'
import type { ActionOption, ChoiceOption, PartView, Preview, PreviewLoad, ScenePair, ScenePick, SceneView } from '@engine/src/features/scene'
import { END_NAME } from '@engine/src/features/scene'

/**
 * 成人場景的畫面整理（M2-ui-scene）：只整理引擎給的東西——部位的標籤與內容篩選、預覽的字、戰報卡的欄位。
 * 感載、契合、主動權、預覽、能不能做與原因，全部是引擎算的（features/scene 的 sceneView、sceneOptions）；這裡沒有骰子，也沒有算式。
 * 所有參與者都是成年人。畫面不出現露骨的字：部位只是中性的文字標籤，每回合的一句是引擎給的。
 */

/** 內容篩選「身體的私密描寫」（contentOff 的 intimate_body）關掉時，這幾個部位的名字收起來。 */
export const INTIMATE_PARTS: readonly string[] = ['chest', 'front', 'back', 'tail', 'tentacle']
export const INTIMATE_FILTER = 'intimate_body'

export const hidesIntimate = (contentOff: readonly string[]): boolean => contentOff.includes(INTIMATE_FILTER)

const CIRCLED = ['①', '②', '③', '④', '⑤', '⑥', '⑦', '⑧']

/** 收起來的部位換成中性的編號；一個場景裡同一個部位永遠是同一個編號。 */
export function partLabels(ids: readonly string[], names: Record<string, string>, hide: boolean): Record<string, string> {
  const out: Record<string, string> = {}
  let n = 0
  for (const id of ids) {
    if (hide && INTIMATE_PARTS.includes(id)) {
      out[id] = `部位${CIRCLED[n] ?? n + 1}`
      n += 1
    } else out[id] = names[id] ?? id
  }
  return out
}

/** 這個場景裡出現過的部位（雙方的部位、連接的兩端）的 id 與名字。 */
export function partNames(v: SceneView): Record<string, string> {
  const out: Record<string, string> = {}
  for (const p of [...v.people.pc.parts, ...v.people.partner.parts]) out[p.id] = p.name
  for (const l of v.links) {
    out[l.mine] = l.mine_name
    out[l.theirs] = l.theirs_name
  }
  return out
}

export type PartState = 'link' | 'reach' | 'off'
export const partState = (p: PartView): PartState => (p.linked ? 'link' : p.reach ? 'reach' : 'off')

/** +3、−2、0（只是字，不算）。 */
export const signed = (n: number): string => (n > 0 ? `+${n}` : n < 0 ? `−${-n}` : '0')

const loadText = (who: string, l: PreviewLoad | null): string | null => (l ? `${who}的感載 ${l.dice.startsWith('−') || l.dice.startsWith('-') ? '' : '+'}${l.dice}（×${l.mult}，約 ${l.avg}，${l.min}～${l.max}）` : null)

/** 預覽的幾行字：全是引擎回的數字。 */
export function previewLines(p: Preview | null | undefined, theirName: string): string[] {
  if (!p) return []
  const out: string[] = []
  const t = loadText(theirName, p.target_load)
  const m = loadText('你', p.my_load)
  if (t) out.push(t)
  if (m) out.push(m)
  if (p.fit_max !== undefined) out.push(`契合 ${signed(p.fit)}～${signed(p.fit_max)}`)
  else if (p.fit !== 0) out.push(`契合 ${signed(p.fit)}`)
  if (p.init !== 0) out.push(`主動權 ${signed(p.init)}`)
  if (p.link) out.push('會建立一條連接')
  if (p.per_round) {
    const r = p.per_round
    const bits = [loadText(theirName, r.target_load), loadText('你', r.my_load), r.fit !== 0 ? `契合 ${signed(r.fit)}` : null].filter((x): x is string => !!x)
    if (bits.length > 0) out.push(`之後每回合：${bits.join('、')}`)
  }
  return out
}

/** 一個行動花幾點、現在能不能做：原因一條一句，畫面把它放在 title 與提示。 */
export const reasonText = (blocks: readonly string[]): string => blocks.join('')

/** 技能與道具要在完整版選部位嗎（引擎宣告的 required）。 */
export const needsPick = (c: Pick<ChoiceOption | ActionOption, 'picks'>): boolean => c.picks.some((p) => p.required)

// ---- 選部位：照引擎宣告的選項（picks 與 pairs）決定卡上每個部位點不點得下去 ----

export interface PickMark { pick: 'can' | 'no' | 'picked'; reason?: string }
const NOT_USED = '這個行動用不到這個部位。'

/**
 * 選技能、道具、說話的部位時，一個部位現在的樣子：點得下去（can）、已選的（picked）、點不下去（no，reason 是引擎的原因）。
 * 自己的部位看 picks 裡 my_part 的選項；對方的部位看 pairs 裡「已選的那個自己的部位」配這一個的組合。能不能接是引擎說的，這裡不判斷。
 */
export function pickMark(picks: readonly ScenePick[], pairs: readonly ScenePair[], mine: string | null, who: 'pc' | 'partner', part: string): PickMark {
  if (who === 'pc') {
    const opt = picks.find((k) => k.key === 'my_part')?.options.find((o) => o.value === part)
    if (!opt) return { pick: 'no', reason: NOT_USED }
    if (mine === part) return { pick: 'picked' }
    return opt.blocks.length > 0 ? { pick: 'no', reason: reasonText(opt.blocks) } : { pick: 'can' }
  }
  if (!mine) return { pick: 'no', reason: '先點你自己的部位。' }
  const pair = pairs.find((x) => x.my_part === mine && x.their_part === part)
  if (!pair) return { pick: 'no', reason: NOT_USED }
  return pair.blocks.length > 0 ? { pick: 'no', reason: reasonText(pair.blocks) } : { pick: 'can' }
}

// ---- 戰報 ----

export interface Debrief {
  summary: string
  reason: string
  reasonName: string
  fit: number | null
  rating: string
  insight: number | null
  /** 引擎定案的結果，一行一筆（評價、體悟、關係、餘韻、目的） */
  results: string[]
  /** 這份報告的變更（體悟、親密度……）換成的文字 */
  changes: Array<{ text: string; kind?: 'plus' | 'minus' }>
  /** AI 開著時整場的正文（成人路由）；沒有就是空的 */
  text: string[]
  notices: string[]
}

/**
 * scene.end 那一份報告整理成戰報卡的欄位。describe 把變更換成文字、ratingName 查評價的名字，都由 store 給（引擎的表）。
 */
export function debriefOf(report: Report, describe: (c: Report['changes']) => string[], ratingName: (fit: number) => string): Debrief {
  const last = [...report.timeline].reverse().find((b) => b.tag === 'scene.end')
  const data = (last?.data ?? {}) as { reason?: string; fit?: number; insight?: number }
  const reason = typeof data.reason === 'string' ? data.reason : report.outcome.result
  const fit = typeof data.fit === 'number' ? data.fit : null
  return {
    summary: report.outcome.summary,
    reason,
    reasonName: (END_NAME as Record<string, string>)[reason] ?? reason,
    fit,
    rating: fit === null ? '' : ratingName(fit),
    insight: typeof data.insight === 'number' ? data.insight : null,
    results: [...(report.narration?.results ?? [])],
    changes: describe(report.changes).map((text) => {
      const kind = text.includes('+') ? ('plus' as const) : text.includes('−') ? ('minus' as const) : undefined
      return kind ? { text, kind } : { text }
    }),
    text: report.narration?.text ? report.narration.text.split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean) : [],
    notices: (report.clamps ?? []).map((c) => c.notice),
  }
}
