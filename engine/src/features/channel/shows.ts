// L6 功能 channel 的節目（MEDIA 4.3、4.3a、4.6；dev/adr/0020 第二節、V20；dev/work/M5-channel-shows.md「新的格式與鍵」）。
// 內容種類 show（overridable）：一筆一種節目，預設六筆寫在這裡（DEFAULT_SHOWS），資料用同一個 id 蓋掉整筆、或加新的：
//   { id, name, skills: 基本功[], slots: 時段數, cost: number | Record<舞台的 size, number>, accepts: 類型[] | 'any', min_quality,
//     adult_accepts?: 類型[]（成人檔另收的）, cred_affected?: 公信力照評價表加減（現場與專題）, requires?: 條件（誰開得出來；ctx.actor 是上鏡的人）,
//     tags?: 內容篩選的標籤, venue?: 'stage'（要站在帶 stage 欄位的設施上；cost 寫成 { size: 價錢 } 照 stage.size 訂價）,
//     materials: [最少, 最多]（公演 0～3）, material_bonus?: { types, each, max }（取代「看點合計 ÷ 4」：放進這些類型的料，每件 +each、最多 max）,
//     on_grade?: Record<評價, 效果[]>（效果裡寫 '$host' 的字串換成上鏡的人）, adult_needs_media?: 沒有媒體型路數的人開不出這個節目的成人檔,
//     // 以下是這一張在工單的格式之外多加的選填欄位（回報裡有寫）
//     gear?: 設備的類（MEDIA 4.6「用在」那張表；沒寫是收音與剪輯機）, adult_sizes?: 成人檔只開得出來的舞台 size（公演的深夜場）,
//     scoop?: true（播完可以直接開輿論戰：結果帶 scoop: 那一件的 ref） }
// 預設的六筆都不帶 tags：內容篩選的開關對它們沒有作用；測試或資料另外寫帶標籤的才會被擋。

import type { Condition, ContentEntry, Effect, Kernel } from '../../core'
import { isRecord, isSafeInt } from '../../core'
import type { GearClass, Grade } from './model'
import { GEAR_CLASSES, GRADES, isText } from './model'

export const SHOW_KIND = 'show'
export const MEDIA_TYPES = ['battle', 'scandal', 'crime', 'intimate', 'celebrity', 'daily'] as const
export const MEDIA_TYPE_NAME: Record<string, string> = { battle: '戰鬥', scandal: '醜聞', crime: '罪證', intimate: '親密', celebrity: '名人', daily: '日常' }

export interface ShowEntry {
  id: string
  name: string
  skills: string[]
  slots: number
  cost: number | Record<string, number>
  accepts: string[] | 'any'
  min_quality: number
  adult_accepts?: string[]
  cred_affected?: boolean
  requires?: Condition
  tags?: string[]
  venue?: 'stage'
  materials: [number, number]
  material_bonus?: { types: string[]; each: number; max: number }
  on_grade?: Partial<Record<Grade, Effect[]>>
  adult_needs_media?: boolean
  gear?: GearClass[]
  adult_sizes?: string[]
  scoop?: boolean
}

/** 預設沒寫 gear 的節目用到哪幾類設備。 */
export const DEFAULT_SHOW_GEAR: GearClass[] = ['mic', 'edit']

const idList = (v: unknown): v is string[] => Array.isArray(v) && v.length <= 40 && v.every((x) => isText(x))
const small = (v: unknown, lo: number, hi: number): v is number => isSafeInt(v) && v >= lo && v <= hi

/**
 * 六筆預設（MEDIA 4.3、4.3a、4.6）：
 *   現場 街頭直覺或表演、一個時段、300、收戰鬥／名人／日常／醜聞（成人檔另收親密）、品質 1 以上
 *   專題 調查、兩個時段、800、只收罪證、品質 3 以上（成人檔另收親密）
 *   八卦 交涉或表演、一個時段、200、收醜聞／親密／名人、品質 2 以上
 *   雜談 表演或交涉、一個時段、100、什麼都收、品質 1 以上
 *   公演 表演、一個時段、製作費照舞台（地下室 200、live house 600、劇場 1,500、祭典與巨蛋 3,000）、可以不放料、花絮（日常、名人）每件 +1 最多 +2、
 *        要有偶像的路數 1 階以上；人氣：翻車 −2、普通 +1、好 +3、爆 +6；成人檔（地下偶像的深夜場）只在地下室與 live house
 *   獨家 調查或表演、500、一件品質 3 以上的罪證或醜聞（成人檔另收親密）、要有主播的路數 1 階以上；公信力：翻車 −4、好 +2、爆 +3；播完可以直接開戰
 */
export const DEFAULT_SHOWS: ShowEntry[] = [
  {
    id: 'live_news', name: '現場', skills: ['streetwise', 'perform'], slots: 1, cost: 300, accepts: ['battle', 'celebrity', 'daily', 'scandal'], min_quality: 1,
    adult_accepts: ['intimate'], cred_affected: true, materials: [1, 3], gear: ['lens', 'mic', 'edit'],
  },
  {
    id: 'feature', name: '專題', skills: ['investigate'], slots: 2, cost: 800, accepts: ['crime'], min_quality: 3, adult_accepts: ['intimate'], cred_affected: true,
    adult_needs_media: true, materials: [1, 3], gear: ['lens', 'mic', 'edit'],
  },
  { id: 'gossip', name: '八卦', skills: ['negotiate', 'perform'], slots: 1, cost: 200, accepts: ['scandal', 'intimate', 'celebrity'], min_quality: 2, materials: [1, 3], gear: ['mic', 'light', 'edit'] },
  {
    id: 'talk', name: '雜談', skills: ['perform', 'negotiate'], slots: 1, cost: 100, accepts: 'any', min_quality: 1, adult_needs_media: true, materials: [1, 3], gear: ['lens', 'mic', 'light', 'edit'],
  },
  {
    id: 'concert', name: '公演', skills: ['perform'], slots: 1, cost: { basement: 200, livehouse: 600, theater: 1500, festival: 3000, dome: 3000 }, accepts: ['daily', 'celebrity'], min_quality: 1,
    venue: 'stage', materials: [0, 3], material_bonus: { types: ['daily', 'celebrity'], each: 1, max: 2 }, requires: { kind: 'channel_path', path: 'idol', min: 1 },
    adult_sizes: ['basement', 'livehouse'], gear: ['mic', 'light'],
    on_grade: {
      flop: [{ kind: 'popularity', key: '$host', amount: -2 }], ok: [{ kind: 'popularity', key: '$host', amount: 1 }],
      good: [{ kind: 'popularity', key: '$host', amount: 3 }], hit: [{ kind: 'popularity', key: '$host', amount: 6 }],
    },
  },
  {
    id: 'scoop', name: '獨家', skills: ['investigate', 'perform'], slots: 1, cost: 500, accepts: ['crime', 'scandal'], min_quality: 3, adult_accepts: ['intimate'], materials: [1, 1],
    requires: { kind: 'channel_path', path: 'anchor', min: 1 }, scoop: true, gear: ['mic', 'edit'],
    on_grade: { flop: [{ kind: 'credibility', amount: -4 }], good: [{ kind: 'credibility', amount: 2 }], hit: [{ kind: 'credibility', amount: 3 }] },
  },
]

function effectListProblems(v: unknown, at: string): string[] {
  if (!Array.isArray(v)) return [`${at} 要是效果的陣列`]
  return v.flatMap((e, i) => (isRecord(e) && isText(e.kind) ? [] : [`${at}[${i}] 要是 { kind, ... } 的效果`]))
}

export function showProblems(e: Record<string, unknown>): string[] {
  const p: string[] = []
  if (!isText(e.name)) p.push('name 要是給玩家看的名字')
  if (!(Array.isArray(e.skills) && e.skills.length >= 1 && e.skills.length <= 2 && e.skills.every((s) => isText(s)))) p.push('skills 要是一到兩項基本功的 id')
  if (!small(e.slots, 1, 6)) p.push('slots 要是 1～6 的整數（時段數）')
  const costOk = small(e.cost, 0, 1_000_000) || (isRecord(e.cost) && Object.keys(e.cost).length > 0 && Object.values(e.cost).every((n) => small(n, 0, 1_000_000)))
  if (!costOk) p.push('cost 要是 0 以上的整數，或「舞台的 size → 價錢」的對照')
  if (e.accepts !== 'any' && !(idList(e.accepts) && e.accepts.length > 0 && e.accepts.every((t) => (MEDIA_TYPES as readonly string[]).includes(t)))) p.push(`accepts 要是 'any'，或 ${MEDIA_TYPES.join('、')} 的陣列`)
  if (!small(e.min_quality, 1, 5)) p.push('min_quality 要是 1～5 的整數')
  if (e.adult_accepts !== undefined && !(idList(e.adult_accepts) && e.adult_accepts.every((t) => (MEDIA_TYPES as readonly string[]).includes(t)))) p.push(`adult_accepts 要是 ${MEDIA_TYPES.join('、')} 的陣列`)
  for (const f of ['cred_affected', 'adult_needs_media', 'scoop'] as const) if (e[f] !== undefined && typeof e[f] !== 'boolean') p.push(`${f} 要是 true 或 false`)
  if (e.tags !== undefined && !idList(e.tags)) p.push('tags 要是標籤的陣列')
  if (e.venue !== undefined && e.venue !== 'stage') p.push("venue 只能是 'stage'")
  if (e.venue === 'stage' && !isRecord(e.cost)) p.push('要站在舞台上的節目，cost 要寫成「舞台的 size → 價錢」')
  if (e.requires !== undefined && !(isRecord(e.requires) && isText(e.requires.kind))) p.push('requires 要是條件 { kind, ... }')
  if (!(Array.isArray(e.materials) && e.materials.length === 2 && small(e.materials[0], 0, 3) && small(e.materials[1], 0, 3) && (e.materials[0] as number) <= (e.materials[1] as number) && (e.materials[1] as number) >= 1)) {
    p.push('materials 要是 [最少, 最多]：0～3 的整數，最多至少 1')
  }
  if (e.material_bonus !== undefined) {
    const b = e.material_bonus
    if (!(isRecord(b) && idList(b.types) && b.types.length > 0 && small(b.each, 0, 10) && small(b.max, 0, 10))) p.push('material_bonus 要是 { types: 類型[], each, max }')
  }
  if (e.on_grade !== undefined) {
    if (!isRecord(e.on_grade)) p.push('on_grade 要是「評價 → 效果[]」')
    else for (const [g, list] of Object.entries(e.on_grade)) {
      if (!(GRADES as readonly string[]).includes(g)) p.push(`on_grade.${g}：評價只有 ${GRADES.join('、')}`)
      else p.push(...effectListProblems(list, `on_grade.${g}`))
    }
  }
  if (e.gear !== undefined && !(Array.isArray(e.gear) && e.gear.every((c) => (GEAR_CLASSES as readonly unknown[]).includes(c) && c !== 'stream'))) p.push('gear 要是 lens、mic、light、edit 的陣列（串流只給直播用）')
  if (e.adult_sizes !== undefined && !idList(e.adult_sizes)) p.push('adult_sizes 要是舞台 size 的陣列')
  return p
}

const copyOf = (s: ShowEntry): ShowEntry => JSON.parse(JSON.stringify(s)) as ShowEntry

function fromEntry(e: ContentEntry & Record<string, unknown>): ShowEntry {
  const out: Record<string, unknown> = JSON.parse(JSON.stringify(e))
  return out as unknown as ShowEntry
}

/** 現在有哪些節目：預設六筆，資料同 id 的整筆蓋掉、不同 id 的加在後面（格式不合的忽略）。 */
export function showsOf(k: Pick<Kernel, 'content'>): ShowEntry[] {
  const out = new Map<string, ShowEntry>(DEFAULT_SHOWS.map((s) => [s.id, copyOf(s)]))
  if (k.content.hasKind(SHOW_KIND)) {
    for (const e of k.content.list<ContentEntry & Record<string, unknown>>(SHOW_KIND)) {
      if (showProblems(e).length > 0) continue
      out.set(e.id, fromEntry(e))
    }
  }
  return [...out.values()]
}

export const showOf = (k: Pick<Kernel, 'content'>, id: string): ShowEntry | undefined => showsOf(k).find((s) => s.id === id)

/** 這個節目這一集收哪些類型（成人檔另收的加進去）；'any' 是什麼都收。 */
export function acceptedTypes(show: ShowEntry, adult: boolean): string[] | 'any' {
  if (show.accepts === 'any') return 'any'
  return adult ? [...new Set([...show.accepts, ...(show.adult_accepts ?? [])])] : [...show.accepts]
}

export const typeText = (types: string[] | 'any'): string => (types === 'any' ? '任何' : types.map((t) => MEDIA_TYPE_NAME[t] ?? t).join('、'))

/** 設備的類：節目沒寫就是收音與剪輯機。 */
export const gearOf = (show: ShowEntry): GearClass[] => show.gear ?? DEFAULT_SHOW_GEAR
