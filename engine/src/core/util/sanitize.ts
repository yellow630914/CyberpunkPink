// L1 純工具：清理函式。AI 與存檔進來的值一律先過這裡（ElondiaRPG 散在約 23 個檔，這裡只有一份）。

export function isRecord(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === 'object' && !Array.isArray(v)
}

export function clamp(n: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, n))
}

/** 有限的數字，否則用 fallback。字串的數字（"12"）也收。 */
export function num(v: unknown, fallback = 0): number {
  const n = typeof v === 'string' && v.trim() !== '' ? Number(v) : v
  return typeof n === 'number' && Number.isFinite(n) ? n : fallback
}

export function int(v: unknown, fallback = 0): number {
  return Math.round(num(v, fallback))
}

/** 去掉頭尾空白並截斷的字串；不是字串就用 fallback。 */
export function str(v: unknown, max = 2000, fallback = ''): string {
  return typeof v === 'string' ? v.trim().slice(0, max) : fallback
}

export function bool(v: unknown, fallback = false): boolean {
  return typeof v === 'boolean' ? v : v === 1 ? true : v === 0 ? false : fallback
}

export function oneOf<T extends string>(v: unknown, list: readonly T[], fallback: T): T {
  return typeof v === 'string' && (list as readonly string[]).includes(v) ? (v as T) : fallback
}

/** id 的格式：小寫英文、數字、底線、點、冒號（DATA 第 1 節）。 */
export function isId(v: unknown): v is string {
  return typeof v === 'string' && /^[a-z0-9][a-z0-9_.:-]{0,79}$/.test(v)
}
