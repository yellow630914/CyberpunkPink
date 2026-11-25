// L6 功能 lewd 的建角（M4-creation-lifepath；CHARACTER 第 2 節、第 3 節、5.5 節；LEWD_SYSTEM 1.1 節、第 5 節）。
//
// 掛點 creation.step 的 lifepath（第 5 步，features/creation 宣告；這裡只認名字與格式，不 import）：
//   出身的固定傾向與豔名：出身資料多讀 tendency?: { axes?: { 軸: 等級 }, tags?: [標籤] }（軸從這個等級開始、標籤是「有」）與 fame?: { 區的 id: 豔名 }（歡場、櫻町那兩列）
//   picks 裡的 tendency（標籤：has 是「有」、latent 是「潛在」）、axis（軸 +幾級）、bridge（橋參數的微調）與草稿自己挑的 kinks（最多 2 個，latent 為真的是「潛在」）
// 寫的是放進主角時的 actor.ext：tendency（直接是「有」或「潛在」的標籤不另外加點；只有 axis 寫了才加級）、bridge（沒有橋的略過；加減之後夾在 0～100）；
// 豔名是一筆量表的變更。內容篩選關掉的標籤不寫（提醒一句）。沒有橋、查不到的標籤、不認得的軸與橋參數寫進提醒，不擋草稿（內容的格式在載入時已經查過）。

import type { Change, ContentEntry, GameState, Kernel } from '../../core'
import { clone, contentAllowed, isRecord } from '../../core'
import type { Axis, BridgeParam, TagEntry, TagState } from './model'
import { AXES, BRIDGE_PARAMS, TAG_KIND, isAxis, isParam, lewdRules, readBridge, stepTendencyFree, tagStateOf, tendencyOf } from './model'

interface Payload { state: GameState; draft: { origin?: string; bridge?: string | null; kinks?: unknown }; step: string; picks: unknown[]; actorExt?: Record<string, unknown> }
interface Answer { took: number[]; ext?: Record<string, unknown>; changes?: Change[]; notes?: string[] }

const isInt = (v: unknown): v is number => typeof v === 'number' && Number.isSafeInteger(v)
const isText = (v: unknown): v is string => typeof v === 'string' && v.length > 0

/** 出身資料多出來的兩欄（歡場、櫻町）：tendency 與 fame。格式在 lewd 的 ready 檢查。 */
export function originProblems(k: Pick<Kernel, 'content'>): string[] {
  const p: string[] = []
  const rules = lewdRules(k)
  for (const o of k.content.list<ContentEntry & { tendency?: unknown; fame?: unknown }>('origin')) {
    const at = `origin/${o.id}`
    if (o.tendency !== undefined) {
      const t = o.tendency
      if (!isRecord(t) || Object.keys(t).some((f) => f !== 'axes' && f !== 'tags')) p.push(`${at}：tendency 要是 { axes?, tags? }`)
      else {
        if (t.axes !== undefined && !(isRecord(t.axes) && Object.entries(t.axes).every(([a, v]) => isAxis(a) && isInt(v) && v >= 1 && v <= rules.axis_max))) p.push(`${at}：tendency.axes 要是「軸（${AXES.join('、')}）→ 1～${rules.axis_max} 級」`)
        if (t.tags !== undefined) {
          if (!(Array.isArray(t.tags) && t.tags.every(isText))) p.push(`${at}：tendency.tags 要是傾向標籤 id 的陣列`)
          else for (const tag of t.tags) if (k.content.hasKind(TAG_KIND) && !k.content.has(TAG_KIND, tag)) p.push(`${at}：tendency.tags 引用了不存在的傾向標籤 ${tag}`)
        }
      }
    }
    if (o.fame !== undefined) {
      if (!(isRecord(o.fame) && Object.values(o.fame).every((v) => isInt(v) && v >= 1 && v <= 100))) p.push(`${at}：fame 要是「區的 id → 1～100 的豔名」`)
      else for (const d of Object.keys(o.fame)) if (k.content.hasKind('district') && !k.content.has('district', d)) p.push(`${at}：fame 引用了不存在的區 ${d}`)
    }
  }
  return p
}

export function answerCreation(k: Kernel, p: Payload): Answer | void {
  if (p.step !== 'lifepath') return
  const rules = lewdRules(k)
  const notes: string[] = []
  const changes: Change[] = []
  const ext: Record<string, unknown> = {}
  const took: number[] = []
  let t = tendencyOf({ actors: { pc: { ext: p.actorExt ?? {} } } } as never, 'pc', rules)
  let touched = false

  const name = (tag: string): string => k.content.get<TagEntry>(TAG_KIND, tag)?.name ?? tag
  /** 標籤變成「有」或「潛在」：不降級（有或深不會退回潛在）；關掉的題材不寫。直接給的標籤不另外加點。 */
  const setTag = (tag: string, state: Extract<TagState, 'has' | 'latent'>): void => {
    if (!k.content.has(TAG_KIND, tag)) {
      notes.push(`查不到「${tag}」這個傾向標籤，沒有記下。`)
      return
    }
    if (!contentAllowed(p.state.rules, tag)) {
      notes.push(`「${name(tag)}」這個題材被你的內容篩選關掉了，沒有記下。`)
      return
    }
    const cur = tagStateOf(t, tag)
    if (cur === 'deep' || cur === state || (cur === 'has' && state === 'latent')) return
    t = stepTendencyFree(t, tag, state)
    touched = true
  }
  const raiseAxis = (axis: string, n: number, how: 'add' | 'floor'): void => {
    if (!isAxis(axis)) {
      notes.push(`不認得「${axis}」這條傾向的軸，沒有算。`)
      return
    }
    const a: Axis = axis
    const next = Math.min(rules.axis_max, how === 'add' ? t.axes[a] + n : Math.max(t.axes[a], n))
    if (next === t.axes[a]) return
    t = { ...clone(t), axes: { ...t.axes, [a]: next } }
    touched = true
  }

  // 出身的固定傾向與豔名
  const origin = p.draft.origin === undefined ? undefined : k.content.get<ContentEntry & { tendency?: { axes?: Record<string, number>; tags?: string[] }; fame?: Record<string, number> }>('origin', p.draft.origin)
  if (origin?.tendency) {
    for (const [axis, n] of Object.entries(origin.tendency.axes ?? {})) raiseAxis(axis, n, 'floor')
    for (const tag of origin.tendency.tags ?? []) setTag(tag, 'has')
  }
  for (const [district, n] of Object.entries(origin?.fame ?? {})) {
    if (!k.meters.has('fame') || !k.content.has('district', district)) notes.push(`出身的豔名（${district}）沒有地方記，沒有算。`)
    else changes.push({ op: 'meter', kind: 'fame', key: district, delta: n })
  }

  // 生命軌跡選的：標籤、軸、橋參數
  const tweak: Partial<Record<BridgeParam, number>> = {}
  p.picks.forEach((pick, index) => {
    if (!isRecord(pick)) return
    let mine = false
    if (Array.isArray(pick.tendency)) {
      mine = true
      for (const e of pick.tendency) if (isRecord(e) && isText(e.tag)) setTag(e.tag, e.state === 'latent' ? 'latent' : 'has')
    }
    if (isRecord(pick.axis)) {
      mine = true
      for (const [axis, n] of Object.entries(pick.axis)) if (isInt(n) && n > 0) raiseAxis(axis, n, 'add')
    }
    if (isRecord(pick.bridge)) {
      mine = true
      for (const [param, n] of Object.entries(pick.bridge)) {
        if (!isParam(param) || !isInt(n)) notes.push(`不認得「${param}」這項橋參數，沒有算。`)
        else tweak[param] = (tweak[param] ?? 0) + n
      }
    }
    if (mine) took.push(index)
  })
  // 自己挑的潛在性癖
  if (Array.isArray(p.draft.kinks)) {
    for (const kink of p.draft.kinks) if (isRecord(kink) && isText(kink.tag)) setTag(kink.tag, kink.latent === true ? 'latent' : 'has')
  }

  if (touched) ext.tendency = t
  // 橋參數的起始值微調：沒有橋的略過；每一項夾在 0～100
  if (Object.keys(tweak).length > 0) {
    if (p.actorExt?.bridge === null || p.draft.bridge === null) notes.push('你沒有橋，橋參數的起始值沒有地方微調，這一項略過了。')
    else {
      const raw = p.actorExt?.bridge
      const base = readBridge(raw, rules) ?? Object.fromEntries(BRIDGE_PARAMS.map((q) => [q, rules.default_bridge])) as Record<BridgeParam, number>
      const next = { ...base }
      for (const [param, n] of Object.entries(tweak) as Array<[BridgeParam, number]>) next[param] = Math.max(0, Math.min(100, base[param] + n))
      ext.bridge = { ...(isRecord(raw) ? clone(raw) : {}), ...next }
    }
  }
  return { took, ext, changes, notes }
}
