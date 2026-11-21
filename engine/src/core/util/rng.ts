// L1 純工具：可重現的亂數（mulberry32，照搬 ElondiaRPG 的 rng.ts）。
// 骰子不直接吃存檔的亂數狀態，而是從（種子、游標、用途、重擲次數）導出：同一個種子、同一串輸入，得到同一個結果；
// 重試別的步驟不會重擲，只有玩家按「重擲」才換一顆（AI_TASKS 2.4 節）。

export class Rng {
  constructor(public state: number) {}

  next(): number {
    let t = (this.state = (this.state + 0x6d2b79f5) | 0)
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }

  /** 含兩端的整數 */
  int(min: number, max: number): number {
    return min + Math.floor(this.next() * (max - min + 1))
  }

  pick<T>(items: readonly T[]): T {
    if (items.length === 0) throw new Error('pick from empty list')
    return items[this.int(0, items.length - 1)]!
  }

  chance(p: number): boolean {
    return this.next() < p
  }

  /** 加權抽選（全專案只有這一個）。權重小於等於 0 的不會被抽到。 */
  weighted<T>(items: readonly T[], weight: (item: T) => number): T {
    const ws = items.map((x) => Math.max(0, weight(x)))
    const total = ws.reduce((a, b) => a + b, 0)
    if (total <= 0) throw new Error('weighted pick: no positive weight')
    let r = this.next() * total
    for (let i = 0; i < items.length; i++) {
      r -= ws[i]!
      if (r < 0) return items[i]!
    }
    return items[items.length - 1]!
  }
}

export interface DiceRoll {
  dice: string
  rolls: number[]
  total: number
}

const DICE_RE = /^(\d*)d(\d+)([+-]\d+)?$/

/** 擲骰，例如 "1d20+5"、"2d6"、"d8"。 */
export function roll(rng: Rng, dice: string): DiceRoll {
  const m = DICE_RE.exec(dice.replace(/\s+/g, ''))
  if (!m) throw new Error(`bad dice: ${dice}`)
  const count = Number(m[1]) || 1
  const sides = Number(m[2])
  if (sides < 1 || count > 100) throw new Error(`bad dice: ${dice}`)
  const mod = Number(m[3] ?? 0)
  const rolls = Array.from({ length: count }, () => rng.int(1, sides))
  return { dice, rolls, total: rolls.reduce((a, b) => a + b, 0) + mod }
}

/** 字串與數字的雜湊（FNV-1a，32 位元）。全專案只有這一個。 */
export function hash32(...parts: Array<string | number>): number {
  let h = 0x811c9dc5
  for (const p of parts) {
    const s = typeof p === 'number' ? `#${p}` : `$${p}`
    for (let i = 0; i < s.length; i++) {
      h ^= s.charCodeAt(i)
      h = Math.imul(h, 0x01000193)
    }
    h ^= 0x1f
    h = Math.imul(h, 0x01000193)
  }
  return h | 0
}

/** 從存檔的亂數狀態導出一顆專用的亂數：用途（例如 "free_action/roll"）與重擲次數不同，結果就不同。 */
export function deriveRng(rng: { seed: number; cursor: number }, purpose: string, reroll = 0): Rng {
  return new Rng(hash32(rng.seed, rng.cursor, purpose, reroll))
}
