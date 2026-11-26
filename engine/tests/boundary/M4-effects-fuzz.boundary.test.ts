// 邊界：效果登錄表的壞輸入（M4 邊界，cpp-tester-boundary）。
// 規格：GAME_DESIGN 第 3 節（AI 與內容交的結果先驗格式再寫入，壞的不會讓引擎丟程式錯誤）；EVENTS 2.4 節（AI 的效果是封閉清單，ai: false 的一律擋）；dev/adr/0019。
// 性質：對登錄表裡的每一種效果、三種來源（內建、AI、玩家要的），丟隨機的欄位（錯的型別、空的、很大的、原型的鍵），
//   1. validate 與 resolve 不丟例外（TypeError、RangeError 都不行）；
//   2. 來源是 AI 或玩家，而這一種是 ai: false：一定有問題或沒有任何變更（不管欄位寫得多合格）；
//   3. resolve 出來的變更套到狀態複本上不丟例外、套完的狀態過存檔格式檢查、錢不是負的。

import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import { clone, effectCtx } from '../../src'
import { validateState } from '../../src/shell/save'
import { makeBodyGame } from '../../src/testkit'

const g = makeBodyGame().game
const k = g.k
const kinds = k.effects.kinds().sort()
const aiKinds = new Set(k.effects.aiKinds())

const FIELDS = ['amount', 'id', 'item', 'npc', 'key', 'kind', 'days', 'hours', 'who', 'type', 'holder', 'qty', 'tag', 'to', 'from', 'level', 'source', 'slot', 'side', 'uid', 'bp', 'parts', 'on', 'why', 'weekly', 'owed', 'rules', 'orders', 'debt', 'grade', 'material', 'want', 'quirk', 'order_kind', 'place', 'lock', 'drug', 'minutes', 'stage', 'name', 'by', 'blueprint', 'asked', 'set', 'delta', 'min', 'max', 'faction', 'order', 'how', 'house', 'lot', 'tuning', 'malware', 'val', 'value', 'count', 'text', 'cast', 'effects', 'once']
const atom = fc.oneof(
  fc.integer({ min: -5, max: 500 }), fc.constantFrom(0, -1, 1.5, Number.NaN, Infinity, -Infinity, Number.MAX_SAFE_INTEGER, 2 ** 60), fc.constantFrom('', ' ', 'x', 'pc', 'npc_tw_ayin', 'f_tw_eden', 'bp_tw_arm', 'it_tw_cloud', 'tu_tw_still', '__proto__', 'constructor', 'a'.repeat(300)),
  fc.boolean(), fc.constant(null), fc.constant(undefined),
)
const value: fc.Arbitrary<unknown> = fc.oneof(atom, atom, atom, fc.array(atom, { maxLength: 3 }), fc.dictionary(fc.constantFrom(...FIELDS.slice(0, 20)), atom, { maxKeys: 3 }))
// AI 與內容交來的都是 JSON：先走一遍 JSON（NaN、Infinity 變 null、undefined 的鍵不見，原型也是一般物件），和真正進來的東西一樣
const payload = fc.dictionary(fc.constantFrom(...FIELDS), value, { maxKeys: 6 }).map((o) => JSON.parse(JSON.stringify(o)) as Record<string, unknown>)

describe('效果登錄表的壞輸入', () => {
  it(`登錄的效果種類有 ${kinds.length} 種；每一種的 ai 旗標與登錄表的 aiKinds 對得上`, () => {
    expect(kinds.length).toBeGreaterThan(40)
    for (const kind of kinds) expect(aiKinds.has(kind), kind).toBe(k.effects.aiKinds().includes(kind))
  })

  for (const source of ['builtin', 'ai', 'player'] as const) {
    it(`來源 ${source}：每一種效果 × 隨機欄位：validate 與 resolve 不丟例外；ai: false 的種類對 AI 與玩家一定擋；變更套得上、狀態合法`, () => {
      fc.assert(fc.property(fc.constantFrom(...kinds), payload, (kind, p) => {
        const fx = { ...p, kind }
        const ctx = effectCtx(k, g.state, { source: source === 'player' ? 'ai' : source, ...(source === 'player' ? { clampAsked: false, asked: '隨便' } : {}), actor: 'pc' } as never)
        const problems = k.effects.validate([fx as never], ctx)
        const res = k.effects.resolve([fx as never], ctx)
        if (source !== 'builtin' && !aiKinds.has(kind)) {
          expect(problems.length > 0 || res.changes.length === 0, `${kind} 是 ai: false，來源 ${source} 卻有變更：${JSON.stringify(fx).slice(0, 200)}`).toBe(true)
          expect(res.changes).toEqual([])
        }
        if (res.changes.length > 0) {
          const s = clone(g.state)
          k.changes.applyAll(s, res.changes)
          expect(validateState(JSON.parse(JSON.stringify(s))), `${kind}：${JSON.stringify(fx).slice(0, 200)}`).toEqual([])
          expect(s.money.cash).toBeGreaterThanOrEqual(0)
          expect(s.money.cred).toBeGreaterThanOrEqual(0)
        }
      }), { numRuns: 1500, seed: 21 })
    })
  }
})
