import type { Report } from '@engine/src'
import type { ActionOption, ChoiceOption, PartView, PersonView, Preview, PreviewLoad, ScenePair, ScenePick, SceneView } from '@engine/src/features/scene'
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

/** 這個場景裡出現過的部位（每個座位的部位、連接的兩端）的 id 與名字。 */
export function partNames(v: SceneView): Record<string, string> {
  const out: Record<string, string> = {}
  for (const seat of v.seats) for (const p of seat.parts) out[p.id] = p.name
  for (const l of v.links) {
    out[l.mine] = l.mine_name
    out[l.theirs] = l.theirs_name
  }
  return out
}

/** 主角以外、還在這一圈的人（卡片排在主角的對面；失神退出的在最後面淡掉）。第一個座位是主角。 */
export const othersOf = (v: SceneView): PersonView[] => v.seats.slice(1)
/** 多人（一圈三、四個人）：對象卡不只一張，契合與主動權每個人各一組 */
export const isGroup = (v: SceneView): boolean => v.kind === 'group' || othersOf(v).length > 1
export const isSolo = (v: SceneView): boolean => v.kind === 'solo'

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

/** 結算頁的一列：主角和一個對象（或別的圈）這一場的契合、評價、親密度的變化。 */
export interface DebriefRow { id: string; name: string; fit: number; rating: string; affinity: number | null }

export interface Debrief {
  summary: string
  reason: string
  reasonName: string
  fit: number | null
  rating: string
  insight: number | null
  /** 單人才有：節奏（取代契合）；其餘是 null */
  pace: number | null
  solo: boolean
  /** 每個對象各一列（一對一一列、多人每人一列）；單人是空的 */
  rows: DebriefRow[]
  /** 引擎定案的結果，一行一筆（評價、體悟、關係、餘韻、目的） */
  results: string[]
  /** 這份報告的變更（體悟、親密度、沉溺、橋參數、傾向、性經歷……）換成的文字 */
  changes: Array<{ text: string; kind?: 'plus' | 'minus' }>
  /** AI 開著時整場的正文（成人路由）；沒有就是空的 */
  text: string[]
  notices: string[]
}

interface EndData {
  reason?: string
  fit?: number
  insight?: number
  pace?: number
  solo?: boolean
  pairs?: Record<string, { fit?: number; rating?: string; affinity?: number }>
}

/**
 * scene.end 那一份報告整理成戰報卡的欄位。describe 把變更換成文字、ratingName 查評價的名字、nameOf 查角色的名字，都由 store 給（引擎的表與狀態）。
 * 每個對象一列：多人時照那一拍的 pairs；一對一時 pairs 沒有，那一列的對象是這份報告裡寫了性經歷的另一個人、親密度是那份報告的親密度變更。
 */
export function debriefOf(report: Report, describe: (c: Report['changes']) => string[], ratingName: (fit: number) => string, nameOf: (id: string) => string = (id) => id): Debrief {
  const last = [...report.timeline].reverse().find((b) => b.tag === 'scene.end')
  const data = (last?.data ?? {}) as EndData
  const reason = typeof data.reason === 'string' ? data.reason : report.outcome.result
  const fit = typeof data.fit === 'number' ? data.fit : null
  const solo = data.solo === true
  const changes = report.changes as Array<Record<string, unknown>>
  const affinityOf = (id: string): number | null => {
    // 親密度是量表 affinity 的變更（key 是那個人）；這一份報告沒有改它（變化是 0 或被夾掉）就是沒有變
    const hit = changes.find((c) => c.op === 'meter' && c.kind === 'affinity' && c.key === id)
    return typeof hit?.delta === 'number' ? hit.delta : 0
  }
  const rows: DebriefRow[] = []
  if (!solo) {
    if (data.pairs) {
      for (const [id, p] of Object.entries(data.pairs)) rows.push({ id, name: nameOf(id), fit: p.fit ?? 0, rating: p.rating ?? ratingName(p.fit ?? 0), affinity: typeof p.affinity === 'number' ? p.affinity : affinityOf(id) })
    } else if (fit !== null) {
      const other = changes.find((c) => c.op === 'actor.ext' && c.key === 'sex_record' && c.id !== report.actor)?.id
      const id = typeof other === 'string' ? other : ''
      rows.push({ id, name: id ? nameOf(id) : '對方', fit, rating: ratingName(fit), affinity: id ? affinityOf(id) : null })
    }
  }
  return {
    summary: report.outcome.summary,
    reason,
    reasonName: (END_NAME as Record<string, string>)[reason] ?? reason,
    fit,
    rating: fit === null ? '' : ratingName(fit),
    insight: typeof data.insight === 'number' ? data.insight : null,
    pace: solo && typeof data.pace === 'number' ? data.pace : null,
    solo,
    rows,
    results: [...(report.narration?.results ?? [])],
    changes: describe(report.changes).map((text) => {
      const kind = text.includes('+') ? ('plus' as const) : text.includes('−') ? ('minus' as const) : undefined
      return kind ? { text, kind } : { text }
    }),
    text: report.narration?.text ? report.narration.text.split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean) : [],
    notices: (report.clamps ?? []).map((c) => c.notice),
  }
}

/** 寫法指令欄的字數上限（引擎的 DIRECTION_MAX；引擎自己也會截斷，這裡只是即時顯示） */
export const DIRECTION_LIMIT = 200
/** 即時字數（用「字」數，和引擎一樣：一個全形字與一個半形字都算一個）；超過上限回傳負的剩餘 */
export const directionCount = (text: string): { used: number; left: number } => {
  const used = Array.from(text).length
  return { used, left: DIRECTION_LIMIT - used }
}
