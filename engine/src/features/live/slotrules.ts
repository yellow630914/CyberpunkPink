// L6 功能 live 的時段直播規則表（MEDIA 1.3 節；dev/adr/0020 V27、V28；dev/work/M5-live-slot.md「新的格式與鍵」）。
// 寫在內容種類 live_rule 的 default 那一筆的 slot 欄位裡（overridable：資料蓋掉預設，格式不對的欄位忽略）。這個檔不 import model.ts（model.ts 讀它）。
//
//   slot.kinds       { chat|talent|stroll|adult: { skills, start, street, tags } }  四種各自的基本功（取較高的一項）、起始熱度用人氣級（pop）或豔名級（fame）、
//                    是不是只能在街區地圖上（street）、內容篩選的標籤（tags；預設都不帶：沒有「成人直播」這個開關，V63）
//   slot.dc          [{ subs, dc }]  難度四段，由小到大，第一筆的 subs 是 0（訂閱不到 1,000 是 10、1,000 起 13、一萬起 16、十萬起 19）
//   slot.gain        { fumble, fail, success, critical }  檢定的結果換幾點熱度（0、1、3、6）
//   slot.hour_heat   每多一小時加幾點（1）；slot.cap 熱度的上限（12）
//   slot.pop_div     人氣 ÷ 這個數捨去是人氣級（20）；slot.digits_base 訂閱的位數加成 = 訂閱的十進位次方 − 這個數（3；一千 0、一萬 1、十萬 2），最少 0
//   slot.gear_cap    設備（衍生數值 stream_gear_bonus）最多算幾點（3）
//   slot.custom      自訂的修正上限：最多 ±check 檢定、±heat 熱度（2、1）
//   slot.steady      穩著播：檢定 +check、熱度不超過 cap
//   slot.bold        搏出位：檢定 check（−1）、成功時熱度再 +success_heat
//   slot.niche       冷門題材：起始熱度 +start（−1，最少 0）、訂閱 ×subs_mult
//   slot.fame_gain   成人種類收播時這一區豔名加幾點（1）
//   slot.text_max    自訂描述最多幾個字（照「字」算，超過的截斷並提醒；MEDIA 1.3 沒有寫上限，200 是暫定）

import { isRecord, isSafeInt } from '../../core'

export const SLOT_KINDS = ['chat', 'talent', 'stroll', 'adult'] as const
export type SlotKind = (typeof SLOT_KINDS)[number]
export const SLOT_KIND_NAME: Record<SlotKind, string> = { chat: '閒聊', talent: '才藝', stroll: '逛街', adult: '成人' }

/** 標籤（封閉清單）：只影響彈幕的口氣與直播事件的抽選權重，不直接給熱度。 */
export const SLOT_TAGS = ['funny', 'gentle', 'provoke', 'tech', 'nostalgia', 'edge', 'late'] as const
export type SlotTag = (typeof SLOT_TAGS)[number]
export const SLOT_TAG_NAME: Record<SlotTag, string> = { funny: '搞笑', gentle: '溫柔', provoke: '挑釁', tech: '技術', nostalgia: '懷舊', edge: '擦邊', late: '深夜' }
export const SLOT_MAX_TAGS = 2

/** 表演的方向（封閉清單）。 */
export const SLOT_DIRECTIONS = ['steady', 'bold', 'niche'] as const
export type SlotDirection = (typeof SLOT_DIRECTIONS)[number]
export const SLOT_DIRECTION_NAME: Record<SlotDirection, string> = { steady: '穩著播', bold: '搏出位', niche: '冷門題材' }

export const SLOT_HOURS = [1, 2, 3] as const
/** 檢定的四種結果（核心的成功程度：大失敗、失敗、成功、大成功）。 */
export const SLOT_RESULTS = ['fumble', 'fail', 'success', 'critical'] as const
export type SlotResult = (typeof SLOT_RESULTS)[number]
export const SLOT_RESULT_NAME: Record<SlotResult, string> = { fumble: '冷場', fail: '失敗', success: '成功', critical: '大成功' }

export interface SlotKindRule {
  skills: string[]
  start: 'pop' | 'fame'
  street: boolean
  tags: string[]
}

export interface SlotRules {
  kinds: Record<SlotKind, SlotKindRule>
  dc: Array<{ subs: number; dc: number }>
  gain: Record<SlotResult, number>
  hour_heat: number
  cap: number
  pop_div: number
  digits_base: number
  gear_cap: number
  custom: { check: number; heat: number }
  steady: { check: number; cap: number }
  bold: { check: number; success_heat: number }
  niche: { start: number; subs_mult: number }
  fame_gain: number
  text_max: number
}

export const DEFAULT_SLOT: SlotRules = {
  kinds: {
    chat: { skills: ['perform', 'negotiate'], start: 'pop', street: false, tags: [] },
    talent: { skills: ['perform'], start: 'pop', street: false, tags: [] },
    stroll: { skills: ['streetwise', 'perform'], start: 'pop', street: true, tags: [] },
    adult: { skills: ['seduce'], start: 'fame', street: false, tags: [] },
  },
  dc: [{ subs: 0, dc: 10 }, { subs: 1000, dc: 13 }, { subs: 10000, dc: 16 }, { subs: 100000, dc: 19 }],
  gain: { fumble: 0, fail: 1, success: 3, critical: 6 },
  hour_heat: 1, cap: 12, pop_div: 20, digits_base: 3, gear_cap: 3,
  custom: { check: 2, heat: 1 },
  steady: { check: 1, cap: 6 },
  bold: { check: -1, success_heat: 1 },
  niche: { start: -1, subs_mult: 1.2 },
  fame_gain: 1, text_max: 200,
}

export const cloneSlot = (s: SlotRules): SlotRules => JSON.parse(JSON.stringify(s)) as SlotRules

const finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v)
const idText = (v: unknown): v is string => typeof v === 'string' && v.trim().length > 0
const textList = (v: unknown, min: number): v is string[] => Array.isArray(v) && v.length >= min && v.length <= 20 && v.every(idText)
const own = (o: object, key: string): boolean => Object.hasOwn(o, key)

// 數字欄位：[路徑, 最小, 最大, 整數]
const NUM_SPECS: Array<[path: string, lo: number, hi: number, int: boolean]> = [
  ['hour_heat', 0, 12, true], ['cap', 0, 100, true], ['pop_div', 1, 1000, true], ['digits_base', 0, 12, true], ['gear_cap', 0, 20, true],
  ['custom.check', 0, 20, true], ['custom.heat', 0, 20, true], ['steady.check', -10, 10, true], ['steady.cap', 0, 100, true],
  ['bold.check', -10, 10, true], ['bold.success_heat', -10, 20, true], ['niche.start', -20, 20, true], ['niche.subs_mult', 0, 10, false],
  ['fame_gain', 0, 20, true], ['text_max', 0, 100000, true],
  ['gain.fumble', -20, 100, true], ['gain.fail', -20, 100, true], ['gain.success', -20, 100, true], ['gain.critical', -20, 100, true],
]
const getPath = (o: unknown, path: string): unknown => path.split('.').reduce<unknown>((cur, key) => (isRecord(cur) && own(cur, key) ? cur[key] : undefined), o)
const numOk = (v: unknown, [, lo, hi, int]: (typeof NUM_SPECS)[number]): v is number => finite(v) && v >= lo && v <= hi && (!int || Number.isInteger(v))

const dcOk = (v: unknown): v is Array<{ subs: number; dc: number }> =>
  Array.isArray(v) && v.length >= 1 && v.length <= 12
  && v.every((r, i) => isRecord(r) && isSafeInt(r.subs) && r.subs >= 0 && isSafeInt(r.dc) && r.dc >= 1 && r.dc <= 40 && (i === 0 ? r.subs === 0 : r.subs > (v[i - 1] as { subs: number }).subs))

function kindProblems(id: string, v: unknown): string[] {
  if (!isRecord(v)) return [`kinds.${id} 要是 { skills, start, street, tags }`]
  const p: string[] = []
  if (v.skills !== undefined && !textList(v.skills, 1)) p.push(`kinds.${id}.skills 要是基本功 id 的陣列（至少一個）`)
  if (v.start !== undefined && v.start !== 'pop' && v.start !== 'fame') p.push(`kinds.${id}.start 要是 pop 或 fame`)
  if (v.street !== undefined && typeof v.street !== 'boolean') p.push(`kinds.${id}.street 要是 true 或 false`)
  if (v.tags !== undefined && !textList(v.tags, 0)) p.push(`kinds.${id}.tags 要是字串的陣列`)
  return p
}

/** 資料寫的 slot 欄位的格式問題（空的就是合格）。 */
export function slotProblems(v: unknown): string[] {
  if (!isRecord(v)) return ['slot 要是一組設定（物件）']
  const p: string[] = []
  for (const spec of NUM_SPECS) {
    const x = getPath(v, spec[0])
    if (x !== undefined && !numOk(x, spec)) p.push(`slot.${spec[0]} 要是 ${spec[1]}～${spec[2]} 的${spec[3] ? '整數' : '數字'}`)
  }
  if (v.dc !== undefined && !dcOk(v.dc)) p.push('slot.dc 要是 [{ subs, dc }]：由小到大，第一筆的 subs 是 0，dc 是 1～40 的整數')
  if (v.kinds !== undefined) {
    if (!isRecord(v.kinds)) p.push('slot.kinds 要是 { chat, talent, stroll, adult }')
    else {
      for (const key of Object.keys(v.kinds)) {
        if (!(SLOT_KINDS as readonly string[]).includes(key)) p.push(`slot.kinds 的 ${key} 不是時段直播的種類（${SLOT_KINDS.join('、')}）`)
        else p.push(...kindProblems(key, v.kinds[key]).map((m) => `slot.${m}`))
      }
    }
  }
  return p
}

/** 現在生效的時段直播規則：預設加資料蓋掉（格式不對的欄位忽略）。 */
export function readSlot(v: unknown): SlotRules {
  const out = cloneSlot(DEFAULT_SLOT)
  if (!isRecord(v)) return out
  for (const spec of NUM_SPECS) {
    const x = getPath(v, spec[0])
    if (!numOk(x, spec)) continue
    const keys = spec[0].split('.')
    if (keys.length === 1) (out as unknown as Record<string, number>)[keys[0]!] = x
    else ((out as unknown as Record<string, Record<string, number>>)[keys[0]!]!)[keys[1]!] = x
  }
  if (dcOk(v.dc)) out.dc = v.dc.map((r) => ({ subs: r.subs, dc: r.dc }))
  if (isRecord(v.kinds)) {
    for (const id of SLOT_KINDS) {
      const k = own(v.kinds, id) ? v.kinds[id] : undefined
      if (!isRecord(k)) continue
      const row = out.kinds[id]
      if (textList(k.skills, 1)) row.skills = [...k.skills]
      if (k.start === 'pop' || k.start === 'fame') row.start = k.start
      if (typeof k.street === 'boolean') row.street = k.street
      if (textList(k.tags, 0)) row.tags = [...k.tags]
    }
  }
  return out
}
