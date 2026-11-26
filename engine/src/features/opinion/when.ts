// 對手行動的條件（dev/adr/0020 V39；DATA 6.3 的 actions[].when 與 once[].when）：封閉的小文法。
//   變數  round（現在第幾回合）、wind（風向，正的偏玩家）、voice（它的聲量）、your_voice（你的聲量）、score_gap（它的分數減你的）、
//         can_capture（它這一刻佔得下的格子有幾格）、hand（你的手牌數）、cred（你的公信力）
//   比較  <、<=、>、>=、==；數字是整數（可以負）
//   接法  用 and 接；或單獨寫 always
// 不吃別的字：寫壞的字串在內容載入時被擋（opponentProblems），指出是哪一筆的哪一條。

export const WHEN_VARS = ['round', 'wind', 'voice', 'your_voice', 'score_gap', 'can_capture', 'hand', 'cred'] as const
export type WhenVar = (typeof WHEN_VARS)[number]
export const WHEN_OPS = ['<', '<=', '>', '>=', '=='] as const
export type WhenOp = (typeof WHEN_OPS)[number]

export interface WhenTerm {
  v: WhenVar
  op: WhenOp
  n: number
}
export type When = { always: true } | { always: false; terms: WhenTerm[] }
export type WhenVars = Record<WhenVar, number>

const TERM = /^(round|wind|voice|your_voice|score_gap|can_capture|hand|cred)\s*(<=|>=|==|<|>)\s*(-?\d+)$/

export function parseWhen(src: string): { ok: true; when: When } | { ok: false; error: string } {
  if (typeof src !== 'string') return { ok: false, error: '條件要是字串' }
  const text = src.trim()
  if (text === '') return { ok: false, error: '條件是空的（要「always」或比較）' }
  if (text === 'always') return { ok: true, when: { always: true } }
  const terms: WhenTerm[] = []
  for (const part of text.split(/\s+and\s+/)) {
    const m = TERM.exec(part.trim())
    if (!m) return { ok: false, error: `「${part.trim()}」不是「變數 比較 整數」（變數：${WHEN_VARS.join('、')}；比較：${WHEN_OPS.join(' ')}）` }
    terms.push({ v: m[1] as WhenVar, op: m[2] as WhenOp, n: Number(m[3]) })
  }
  return { ok: true, when: { always: false, terms } }
}

const test = (a: number, op: WhenOp, b: number): boolean => (op === '<' ? a < b : op === '<=' ? a <= b : op === '>' ? a > b : op === '>=' ? a >= b : a === b)

export function evalWhen(when: When, vars: WhenVars): boolean {
  return when.always || when.terms.every((t) => test(vars[t.v], t.op, t.n))
}

/** 寫成字串直接問（寫壞的當不成立）。 */
export function whenHolds(src: string, vars: WhenVars): boolean {
  const r = parseWhen(src)
  return r.ok && evalWhen(r.when, vars)
}
