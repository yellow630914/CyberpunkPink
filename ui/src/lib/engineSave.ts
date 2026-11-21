import { underageAt } from './save'

/**
 * 介面的存檔：引擎的存檔（時間、錢、紀錄、主角）加上還沒搬進引擎的假資料（義體、背包、地圖……）包在一起。
 * 引擎的存檔格式是 cyberpunkpink-engine-save，由引擎自己驗證；這裡只管外面這一層。
 * 第四版以前的假存檔（cyberpunkpink-save）作廢，不讀。
 */
export const BUNDLE_FORMAT = 'cyberpunkpink-ui-save'
export const BUNDLE_VERSION = 1

export interface BundleMeta { label: string; day: number; time: string; place: string; savedAt: string; kind?: '手動' | '自動' | '快照' }
export interface Bundle { format: typeof BUNDLE_FORMAT; version: number; meta: BundleMeta; engine: string; legacy: Record<string, unknown> }

export function packBundle(engine: string, legacy: Record<string, unknown>, meta: BundleMeta): string {
  return JSON.stringify({ format: BUNDLE_FORMAT, version: BUNDLE_VERSION, meta, engine, legacy } satisfies Bundle)
}

export type Unbundled = { ok: true; bundle: Bundle } | { ok: false; error: string }

export function unpackBundle(raw: string): Unbundled {
  let v: unknown
  try { v = JSON.parse(raw) } catch { return { ok: false, error: '這不是存檔（讀不出 JSON）。' } }
  const b = v as Partial<Bundle> | null
  if (!b || typeof b !== 'object' || b.format !== BUNDLE_FORMAT) {
    return { ok: false, error: (b as { format?: string } | null)?.format === 'cyberpunkpink-save' ? '這是舊版介面的假存檔，已經作廢，讀不了。' : '這不是這個遊戲的存檔。' }
  }
  if (typeof b.version !== 'number' || b.version > BUNDLE_VERSION) return { ok: false, error: '這份存檔比這個版本新，讀不了。' }
  if (typeof b.engine !== 'string' || !b.legacy || typeof b.legacy !== 'object') return { ok: false, error: '存檔缺了內容。' }
  const bad = underageAt(b.legacy)
  if (bad.length) return { ok: false, error: `存檔裡有低於 18 歲的角色（${bad[0]}），整筆不讀。` }
  return { ok: true, bundle: b as Bundle }
}

/** 假存檔那一半的形狀檢查（只驗證、不套用）：每個欄位要是對的種類，不然整份不讀。回傳錯誤訊息，null 是可以。 */
export function legacyProblem(legacy: Record<string, unknown>): string | null {
  const OBJ = ['hostility', 'character', 'cyber', 'equip', 'npcs', 'loc', 'basics', 'params', 'tendency', 'fame', 'sexRecord', 'deck', 'channel', 'contracts', 'bills', 'craftFill', 'guides', 'media', 'job', 'mech', 'dyes', 'money']
  const ARR = ['party', 'inventory', 'quick', 'learned', 'loadout', 'nightLearned', 'roster', 'pending', 'vehicles']
  const isObj = (v: unknown): boolean => !!v && typeof v === 'object' && !Array.isArray(v)
  for (const k of OBJ) if (legacy[k] !== undefined && !isObj(legacy[k])) return `存檔的「${k}」格式不對。`
  for (const k of ARR) if (legacy[k] !== undefined && !Array.isArray(legacy[k])) return `存檔的「${k}」格式不對。`
  const m = legacy.money as { fav?: unknown } | undefined
  if (m && m.fav !== undefined && typeof m.fav !== 'number') return '存檔的「money」格式不對。'
  if (legacy.coatClosed !== undefined && typeof legacy.coatClosed !== 'boolean') return '存檔的「coatClosed」格式不對。'
  if (legacy.dungeonSeed !== undefined && typeof legacy.dungeonSeed !== 'number') return '存檔的「dungeonSeed」格式不對。'
  return null
}
