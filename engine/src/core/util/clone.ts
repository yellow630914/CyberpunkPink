// L1 純工具：複製、比較與差異。狀態是純 JSON（沒有函式、Map、Date），所以用 JSON 的語意比較。

/** JSON 的複製。注意：NaN 與 Infinity 會變成 null（JSON 寫不出來），所以進狀態之前要先用 nonFiniteAt 擋掉。 */
export function clone<T>(v: T): T {
  return v === undefined ? v : (JSON.parse(JSON.stringify(v)) as T)
}

/** 任何深度裡不是有限的數字（NaN、Infinity）的位置。這種數字存不進 JSON：存檔會把它寫成 null。 */
export function nonFiniteAt(v: unknown, path = ''): string[] {
  if (typeof v === 'number') return Number.isFinite(v) ? [] : [path || '(root)']
  if (Array.isArray(v)) return v.flatMap((x, i) => nonFiniteAt(x, `${path}[${i}]`))
  if (v && typeof v === 'object') return Object.entries(v as Record<string, unknown>).flatMap(([k, x]) => nonFiniteAt(x, path ? `${path}.${k}` : k))
  return []
}

export function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true
  if (typeof a !== typeof b || a === null || b === null || typeof a !== 'object') return false
  if (Array.isArray(a) !== Array.isArray(b)) return false
  if (Array.isArray(a)) {
    const bb = b as unknown[]
    return a.length === bb.length && a.every((x, i) => deepEqual(x, bb[i]))
  }
  const ao = a as Record<string, unknown>, bo = b as Record<string, unknown>
  const ka = Object.keys(ao).filter((k) => ao[k] !== undefined), kb = Object.keys(bo).filter((k) => bo[k] !== undefined)
  return ka.length === kb.length && ka.every((k) => deepEqual(ao[k], bo[k]))
}

/** 兩份狀態不一樣的路徑（測試與探針用）。最多列 max 條。 */
export function diffPaths(a: unknown, b: unknown, path = '', out: string[] = [], max = 50): string[] {
  if (out.length >= max || deepEqual(a, b)) return out
  const ra = a && typeof a === 'object', rb = b && typeof b === 'object'
  if (!ra || !rb || Array.isArray(a) !== Array.isArray(b)) {
    out.push(path || '(root)')
    return out
  }
  const ao = a as Record<string, unknown>, bo = b as Record<string, unknown>
  for (const k of new Set([...Object.keys(ao), ...Object.keys(bo)])) diffPaths(ao[k], bo[k], path ? `${path}.${k}` : k, out, max)
  return out
}

/** 把 src 的內容搬進 target（保留 target 這個物件本身，介面拿著的參考不會斷）。 */
export function replaceInPlace<T extends object>(target: T, src: T): T {
  const t = target as Record<string, unknown>
  for (const k of Object.keys(t)) delete t[k]
  Object.assign(t, src)
  return target
}
