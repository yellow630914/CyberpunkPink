// 白箱測試：ui/src/lib/engineSave.ts（介面的存檔外層：引擎存檔＋還沒搬進引擎的假資料）。
// 規格：dev/work/M0-ui-engine.md 第五節第 3 步（存檔改成 engine＋legacy 兩份包在一起）；dev/adr/0005（舊假存檔作廢）；
// dev/invariants.md 第 6、12 條；UI 第 14 節「匯入的資料裡有低於 18 的年齡時整筆拒絕，不自動改成 18」。

import { describe, expect, it } from 'vitest'
import { BUNDLE_FORMAT, BUNDLE_VERSION, packBundle, unpackBundle } from './engineSave'

const META = { label: '第 1 天 08:00・蜂巢', day: 1, time: '08:00', place: '蜂巢', savedAt: '2026-11-21T00:00:00.000Z', kind: '手動' as const }
const good = (over: Record<string, unknown> = {}) => JSON.stringify({ format: BUNDLE_FORMAT, version: BUNDLE_VERSION, meta: META, engine: '{}', legacy: { hostility: { 緋櫻: 1 } }, ...over })

describe('packBundle／unpackBundle', () => {
  it('M0-ui-engine 第五節第 3 步：打包再拆開，引擎與舊系統兩份原樣回來', () => {
    const r = unpackBundle(packBundle('ENGINE', { a: 1, party: [{ age: 30 }] }, META))
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.bundle).toEqual({ format: BUNDLE_FORMAT, version: BUNDLE_VERSION, meta: META, engine: 'ENGINE', legacy: { a: 1, party: [{ age: 30 }] } })
  })

  it('不變式第 6 條：讀不出 JSON 的回傳錯誤，不丟例外', () => {
    expect(unpackBundle('{壞掉')).toEqual({ ok: false, error: '這不是存檔（讀不出 JSON）。' })
    expect(unpackBundle('')).toMatchObject({ ok: false })
  })

  it('JSON 但不是物件（null、數字、字串）：不是這個遊戲的存檔', () => {
    for (const raw of ['null', '3', '"x"', 'true']) expect(unpackBundle(raw)).toEqual({ ok: false, error: '這不是這個遊戲的存檔。' })
  })

  it('dev/adr/0005：舊版介面的假存檔（cyberpunkpink-save）作廢，給一句看得懂的話', () => {
    expect(unpackBundle(JSON.stringify({ format: 'cyberpunkpink-save', version: 2, state: {} }))).toEqual({ ok: false, error: '這是舊版介面的假存檔，已經作廢，讀不了。' })
  })

  it('dev/adr/0005：直接拿引擎的存檔（不是外層）也擋下', () => {
    expect(unpackBundle(JSON.stringify({ format: 'cyberpunkpink-engine-save', version: 1 }))).toEqual({ ok: false, error: '這不是這個遊戲的存檔。' })
  })

  it('版本比這個版本新、或版本不是數字：讀不了', () => {
    expect(unpackBundle(good({ version: BUNDLE_VERSION + 1 }))).toEqual({ ok: false, error: '這份存檔比這個版本新，讀不了。' })
    expect(unpackBundle(good({ version: '1' }))).toEqual({ ok: false, error: '這份存檔比這個版本新，讀不了。' })
  })

  it('缺了引擎的那一份、或舊系統的那一份：存檔缺了內容', () => {
    expect(unpackBundle(good({ engine: undefined }))).toEqual({ ok: false, error: '存檔缺了內容。' })
    expect(unpackBundle(good({ engine: { a: 1 } }))).toEqual({ ok: false, error: '存檔缺了內容。' })
    expect(unpackBundle(good({ legacy: null }))).toEqual({ ok: false, error: '存檔缺了內容。' })
    expect(unpackBundle(good({ legacy: 'x' }))).toEqual({ ok: false, error: '存檔缺了內容。' })
  })

  it('不變式第 12 條；UI 第 14 節：舊系統那一份任何深度有低於 18 的年齡，整筆拒絕並指出位置', () => {
    const r = unpackBundle(good({ legacy: { party: [{ age: 30 }, { name: '某人', age: 17 }] } }))
    expect(r.ok).toBe(false)
    if (!r.ok) {
      expect(r.error).toMatch(/低於 18/)
      expect(r.error).toContain('party[1].age')
    }
  })

  it('不變式第 12 條的邊界：剛好 18 歲可以', () => {
    expect(unpackBundle(good({ legacy: { npcs: { a: { age: 18 } } } })).ok).toBe(true)
  })
})
