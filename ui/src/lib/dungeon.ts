/**
 * 地下城的刷新（SITES 第 11 節）：離開之後重新擺放遭遇、陷阱與藏貨，版面不變。純函式，同一個種子擺出來的一樣。
 * 只動 E（遭遇）、T（陷阱）、L（藏貨）；入口、上下的通道與安全點留在原地。名字跟著搬：第 N 個遭遇還是同一個名字。
 */
const MOVABLE = new Set(['E', 'T', 'L'])

/** 小而穩定的亂數（mulberry32）。 */
export function rng(seed: number) {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

export function refreshFloor(f: { rows: string[]; names: Record<string, string> }, seed: number): { rows: string[]; names: Record<string, string> } {
  const cells = f.rows.map(r => [...r])
  const feats: Array<{ ch: string; name?: string }> = []
  const free: Array<[number, number]> = []
  cells.forEach((row, y) => row.forEach((c, x) => {
    if (MOVABLE.has(c)) { feats.push({ ch: c, name: f.names[`${x},${y}`] }); row[x] = '.'; free.push([x, y]) }
    else if (c === '.') free.push([x, y])
  }))
  // 不擺在入口、通道與安全點的隔壁，免得一下來就踩到
  const fixed: Array<[number, number]> = []
  cells.forEach((row, y) => row.forEach((c, x) => { if ('SUDR'.includes(c)) fixed.push([x, y]) }))
  const ok = ([x, y]: [number, number]) => !fixed.some(([fx, fy]) => Math.abs(fx - x) + Math.abs(fy - y) <= 1)
  const pool = free.filter(ok)
  const r = rng(seed)
  for (let i = pool.length - 1; i > 0; i--) { const j = Math.floor(r() * (i + 1)); [pool[i], pool[j]] = [pool[j], pool[i]] }
  const names: Record<string, string> = {}
  for (const [k, v] of Object.entries(f.names)) { const [x, y] = k.split(',').map(Number); if (!MOVABLE.has(f.rows[y][x])) names[k] = v }
  feats.forEach((ft, i) => {
    const [x, y] = pool[i]
    cells[y][x] = ft.ch
    if (ft.name) names[`${x},${y}`] = ft.name
  })
  return { rows: cells.map(r2 => r2.join('')), names }
}
