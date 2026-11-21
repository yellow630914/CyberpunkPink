// 白箱測試：ui/src/stores/saves.ts（存檔的格子；M0-ui-engine 第五節第 3 步改成引擎存檔＋舊系統的資料）。
// 規格：dev/invariants.md 第 6、12 條；dev/adr/0005（舊的假存檔作廢）；UI 第 15 節（讀檔與存檔）。

import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { useSaves } from './saves'
import { useGame } from './game'
import { useEngine } from './engine'

const mem = new Map<string, string>()
let failWrites = false
const fakeStorage = {
  getItem: (k: string) => mem.get(k) ?? null,
  setItem: (k: string, v: string) => { if (failWrites) throw new Error('QuotaExceededError'); mem.set(k, v) },
  removeItem: (k: string) => { mem.delete(k) },
}
const json = (v: unknown) => JSON.stringify(v)

beforeEach(() => {
  mem.clear()
  failWrites = false
  ;(globalThis as { localStorage?: unknown }).localStorage = fakeStorage
  setActivePinia(createPinia())
})
afterEach(() => { delete (globalThis as { localStorage?: unknown }).localStorage })

describe('格子的讀取', () => {
  it('UI 第 15 節：瀏覽器裡沒有東西時，三個存檔格與兩個自動存檔格都是空的', () => {
    const s = useSaves()
    expect(s.slots).toEqual([null, null, null])
    expect(s.autos).toEqual([null, null])
  })

  it('讀不出 JSON、或不是陣列：當作沒有，不丟例外', () => {
    mem.set('cpp-engine-saves-v1', '{壞掉')
    mem.set('cpp-engine-autosaves-v1', '{"a":1}')
    const s = useSaves()
    expect(s.slots).toEqual([null, null, null])
    expect(s.autos).toEqual([null, null])
  })

  it('沒有 localStorage（私密視窗、節點環境）：格子是空的，不丟例外', () => {
    delete (globalThis as { localStorage?: unknown }).localStorage
    expect(useSaves().slots).toEqual([null, null, null])
  })

  it('存的陣列比格子少：補成空的', () => {
    mem.set('cpp-engine-saves-v1', json([{ slot: 0, label: 'a', data: 'x' }]))
    expect(useSaves().slots).toEqual([{ slot: 0, label: 'a', data: 'x' }, null, null])
  })

  it('dev/adr/0005：舊的假存檔格子（cpp-ui-saves-v1）不讀、也不刪', () => {
    mem.set('cpp-ui-saves-v1', json([{ slot: 0, label: '舊的', data: 'x' }]))
    const s = useSaves()
    expect(s.slots).toEqual([null, null, null])
    s.saveTo(1)
    expect(mem.get('cpp-ui-saves-v1')).toBe(json([{ slot: 0, label: '舊的', data: 'x' }]))
  })
})

describe('存檔', () => {
  it('saveTo：寫進格子與瀏覽器；標籤用這一局的時間與地點', () => {
    const s = useSaves()
    expect(s.saveTo(2)).toBeNull()
    expect(s.slots[2]).toMatchObject({ slot: 2, label: expect.stringMatching(/^第 14 天 17:20・/) })
    expect(JSON.parse(mem.get('cpp-engine-saves-v1')!)[2].data).toBe(s.slots[2]!.data)
  })

  it('saveTo：瀏覽器存不了時回傳一句話（格子在這一頁還是看得到）', () => {
    const s = useSaves()
    failWrites = true
    expect(s.saveTo(0)).toMatch(/存不了/)
    expect(s.slots[0]).not.toBeNull()
  })

  it('autosave：最新的在第一格，只留兩份', () => {
    const s = useSaves()
    const g = useGame()
    s.autosave()
    g.advance(60)
    s.autosave()
    g.advance(60)
    s.autosave()
    expect(s.autos.map((a) => a?.label.split('・')[0])).toEqual(['第 14 天 19:20', '第 14 天 18:20'])
  })

  it('autosave：瀏覽器存不了時不丟例外', () => {
    const s = useSaves()
    failWrites = true
    expect(() => s.autosave()).not.toThrow()
  })

  it('remove：清掉一格並寫回瀏覽器', () => {
    const s = useSaves()
    s.saveTo(0)
    s.remove(0)
    expect(s.slots[0]).toBeNull()
    expect(JSON.parse(mem.get('cpp-engine-saves-v1')!)[0]).toBeNull()
  })
})

describe('讀檔', () => {
  it('不變式第 6 條：存檔再讀檔，引擎的狀態一模一樣，舊系統的資料也回來', () => {
    const s = useSaves()
    const g = useGame()
    const e = useEngine()
    g.hostility['緋櫻'] = 70
    const engineBefore = json(e.state)
    s.saveTo(0)
    g.advance(90)
    g.money.cash -= 100
    g.hostility['緋櫻'] = 10
    expect(s.loadFrom('slots', 0)).toBeNull()
    expect(json(e.state)).toBe(engineBefore)
    expect(g.hostility['緋櫻']).toBe(70)
  })

  it('loadFrom：空的格子回傳一句話', () => {
    const s = useSaves()
    expect(s.loadFrom('slots', 1)).toBe('這一格是空的。')
    expect(s.loadFrom('autos', 0)).toBe('這一格是空的。')
  })

  it('不變式第 6 條；dev/adr/0005：舊的假存檔讀不了，兩邊的狀態都不變', () => {
    const s = useSaves()
    const g = useGame()
    const e = useEngine()
    const before = json(e.state)
    const legacyBefore = json(g.serialize())
    expect(s.loadRaw(json({ format: 'cyberpunkpink-save', version: 2, state: { day: 3 } }))).toMatch(/作廢/)
    expect(json(e.state)).toBe(before)
    expect(json(g.serialize())).toBe(legacyBefore)
  })

  it('不變式第 6 條：外層對但引擎那一份壞掉，回傳引擎的錯誤，舊系統的資料不動', () => {
    const s = useSaves()
    const g = useGame()
    const e = useEngine()
    const raw = JSON.parse(s.pack('手動').raw)
    raw.engine = '壞掉的引擎存檔'
    raw.legacy.hostility = { 緋櫻: 1 }
    const before = json(e.state)
    const legacyBefore = json(g.serialize())
    expect(s.loadRaw(json(raw))).toMatch(/不是存檔/)
    expect(json(e.state)).toBe(before)
    expect(json(g.serialize())).toBe(legacyBefore)
  })

  it('不變式第 12 條；UI 第 14 節：舊系統那一份有低於 18 的年齡，整筆拒絕，兩邊都不動', () => {
    const s = useSaves()
    const g = useGame()
    const e = useEngine()
    const raw = JSON.parse(s.pack('手動').raw)
    raw.legacy.party = [{ name: 'x', age: 16 }]
    const before = json(e.state)
    expect(s.loadRaw(json(raw))).toMatch(/低於 18/)
    expect(json(e.state)).toBe(before)
    expect(json(g.party)).not.toContain('"age":16')
  })

  it('讀檔之後只有引擎存檔裡的報告：舊系統的錢和引擎一致時，讀檔不多出一份帳', () => {
    const s = useSaves()
    const e = useEngine()
    const raw = s.pack('手動').raw
    const n = e.state.reports.length
    expect(s.loadRaw(raw)).toBeNull()
    expect(e.state.reports).toHaveLength(n)
    expect(e.canUndo).toBe(false)
  })
})
