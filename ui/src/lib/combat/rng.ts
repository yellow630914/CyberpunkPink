/**
 * 擲骰（CORE_RULES 第 1 節）。戰鬥的邏輯都吃一個 Rng，測試時換成固定的序列或有種子的亂數。
 */
export type Rng = () => number

export const mathRng: Rng = () => Math.random()

/** 有種子的亂數（mulberry32）：同一個種子擲出同一串。 */
export function seeded(seed: number): Rng {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/** 依序吐出指定的值（0～1）；用完之後一直吐最後一個。測試用。 */
export function sequence(values: number[]): Rng {
  let i = 0
  return () => values[Math.min(i++, values.length - 1)]
}
/** 讓 d20 擲出指定點數的值（給 sequence 用）。 */
export const face20 = (n: number) => (n - 1) / 20 + 0.001
/** 讓 d6 擲出指定點數的值。 */
export const face6 = (n: number) => (n - 1) / 6 + 0.001

export const d20 = (r: Rng) => 1 + Math.floor(r() * 20)
export function d6(r: Rng, n: number) { let s = 0; for (let i = 0; i < n; i++) s += 1 + Math.floor(r() * 6); return s }
export const pick = <T>(r: Rng, a: readonly T[]): T => a[Math.floor(r() * a.length)]
export const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v))
