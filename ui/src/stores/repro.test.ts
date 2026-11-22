// 白箱測試找到、已經修好的 bug 的重現（dev/bugs/2026-11-21-ui-*.md）。重現資料在 ui/tests/fixtures/repro/。

import { afterEach, describe, expect, it } from 'vitest'
import { at, runUiRepro, type UiRepro } from '../../tests/helpers/uiRepro'

const files = import.meta.glob<UiRepro>('../../tests/fixtures/repro/*.json', { eager: true, import: 'default' })
const fixtures: UiRepro[] = Object.keys(files).sort().map((k) => files[k]!)

afterEach(() => { delete (globalThis as { localStorage?: unknown }).localStorage })

describe('ui 的 bug 重現（已修）', () => {
  it.each(fixtures.map((f) => ({ name: `${f.id}：${f.note}`, fx: f })))('$name', async ({ fx }) => {
    const view = await runUiRepro(fx)
    for (const [path, want] of Object.entries(fx.expect)) expect(at(view, path), path).toEqual(want)
  })

  it('同一份重現跑兩次，結果一樣（不變式第 5 條）', async () => {
    for (const fx of fixtures.filter((f) => !f.steps.some((s) => s.type === 'actTwice'))) {
      expect(await runUiRepro(fx)).toEqual(await runUiRepro(fx))
    }
  })
})

describe('E7 讀檔原子、weekday（補測）', async () => {
  const { createPinia, setActivePinia } = await import('pinia')
  const { useGame } = await import('./game')
  const { useEngine } = await import('./engine')
  const { useSaves } = await import('./saves')
  const { legacyProblem } = await import('../lib/engineSave')

  it('引擎那一半壞掉：回傳錯誤、兩邊都不動', () => {
    ;(globalThis as { localStorage?: unknown }).localStorage = { getItem: () => null, setItem: () => {}, removeItem: () => {} }
    setActivePinia(createPinia())
    const g = useGame(), e = useEngine(), s = useSaves()
    const raw = JSON.parse(s.pack('手動').raw) as { engine: string }
    raw.engine = '{壞掉'
    const before = JSON.stringify(e.state)
    expect(s.loadRaw(JSON.stringify(raw))).toBeTruthy()
    expect(JSON.stringify(e.state)).toBe(before)
    expect(g.money.acc).toBe(4620)
  })
  it('假存檔那一半形狀不對：整份不讀、引擎不動', () => {
    ;(globalThis as { localStorage?: unknown }).localStorage = { getItem: () => null, setItem: () => {}, removeItem: () => {} }
    setActivePinia(createPinia())
    const e = useEngine(), s = useSaves()
    const raw = JSON.parse(s.pack('手動').raw) as { legacy: Record<string, unknown> }
    raw.legacy.inventory = 'x'
    const before = JSON.stringify(e.state)
    expect(s.loadRaw(JSON.stringify(raw))).toContain('inventory')
    expect(JSON.stringify(e.state)).toBe(before)
    expect(legacyProblem({})).toBeNull()
  })
  it('星期：第 1 天週二，第 7、14 天週一', () => {
    setActivePinia(createPinia())
    const g = useGame()
    expect([g.day, g.weekday, g.billIn]).toEqual([14, '週一', 7])
  })
})
