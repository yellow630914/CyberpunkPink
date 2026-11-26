// 修正（OPINION 的被動）的讀法：開戰時問回來的被動存在 war.passives，這裡把它們的 mods 照種類取出來。
// 每一筆修正可以帶 when（和對手行動的 when 同一套文法，不能用 can_capture）：現在不成立就不算。純函式、不改任何東西。

import type { OpMod, OpModKind, OpPassive } from './hooks'
import type { War } from './model'
import { CELLS } from './model'
import type { WhenVars } from './when'
import { whenHolds } from './when'

/** 讀修正要知道的環境：現在的公信力（沒有量表當 50）。 */
export interface Env {
  cred: number
}
export const DEFAULT_ENV: Env = { cred: 50 }

/** when 看得到的數字（can_capture 在修正裡一律是 0）。 */
export function modVars(w: War, env: Env): WhenVars {
  let you = 0
  let foe = 0
  for (const c of CELLS) {
    const s = (w.topic.scores[c] ?? 0) + (w.bonus[c] ?? 0)
    if (w.cells[c].owner === 'you') you += s
    else if (w.cells[c].owner === 'foe') foe += s
  }
  return { round: w.round, wind: w.wind, voice: w.voice.foe, your_voice: w.voice.you, score_gap: foe - you, can_capture: 0, hand: w.hand.length, cred: env.cred }
}

/** 一串被動裡這一種修正的每一筆。有 when 的要給 vars 才算得出來（沒給就不算；開戰之前還沒有戰役，bring 與編輯台選項只看沒有 when 的）。 */
export function passiveMods(passives: readonly OpPassive[], kind: OpModKind, vars: (() => WhenVars) | null): OpMod[] {
  const out: OpMod[] = []
  let at: WhenVars | null = null
  for (const p of passives) {
    for (const m of p.mods ?? []) {
      if (m.kind !== kind) continue
      if (m.when !== undefined) {
        if (!vars) continue
        at ??= vars()
        if (!whenHolds(m.when, at)) continue
      }
      out.push(m)
    }
  }
  return out
}

/** 這一種修正現在成立的每一筆。 */
export const modsOf = (w: War, kind: OpModKind, env: Env = DEFAULT_ENV): OpMod[] => passiveMods(w.passives, kind, () => modVars(w, env))

export const modSum = (w: War, kind: OpModKind, env: Env = DEFAULT_ENV): number => modsOf(w, kind, env).reduce((s, m) => s + (m.amount ?? 0), 0)
export const modHas = (w: War, kind: OpModKind, env: Env = DEFAULT_ENV): boolean => modsOf(w, kind, env).length > 0
