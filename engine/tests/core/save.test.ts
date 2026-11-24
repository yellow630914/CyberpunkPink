import { describe, expect, it } from 'vitest'
import { MIGRATIONS, SAVE_FORMAT, SAVE_VERSION, UNDO_STEPS, UndoStack, clone, packSave, restoreKeeping, saveMeta, unpackSave, validateState } from '../../src'
import { makeGame, makeState, stateHash } from '../../src/testkit'

const raw = (over: (file: Record<string, any>) => void) => {
  const file = JSON.parse(packSave(makeState(), saveMeta(makeState(), 'manual', 't')))
  over(file)
  return JSON.stringify(file)
}

// 規格：MIGRATION「敘事、狀態與介面」（存檔格式版本從 1 開始）；UI 第 14 節（年齡低於 18 整筆拒絕）；dev/invariants.md 第 3、15 條
describe('L7 存檔與讀檔', () => {
  it('打包再讀回來，狀態一模一樣', () => {
    const state = makeState({ patch: { money: { cred: 12, cash: 34 }, flags: { a: true }, inventory: [{ id: 'it_a', qty: 2 }] } })
    const text = packSave(state, saveMeta(state, 'manual', '2026-11-21T10:00:00Z'))
    const r = unpackSave(text)
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.file.state).toEqual(state)
    expect(r.file.format).toBe(SAVE_FORMAT)
    expect(r.file.version).toBe(SAVE_VERSION)
    expect(r.file.meta).toMatchObject({ kind: 'manual', day: 1, time: '第 1 天 08:00', savedAt: '2026-11-21T10:00:00Z', pc: { name: '測試主角' } })
    // 第 2 版（M1）：多了 battle、maps 與存檔規則的三個欄位；第 3 版（M2）：多了 meters（量表）；第 4 版（M3）：地圖實例可以帶 gen（生成的地圖）
    expect(SAVE_VERSION).toBe(4)
  })

  it('不是存檔、壞掉的存檔、太新的存檔都讀不進來，並說明原因', () => {
    expect(unpackSave('not json')).toEqual({ ok: false, error: '這不是存檔：JSON 讀不出來。' })
    expect(unpackSave('{"day":1,"minutes":5}')).toMatchObject({ ok: false, error: '這不是存檔：缺了格式標記。' })
    // 介面第四版的假存檔是另一種格式，不會被誤讀
    expect(unpackSave(JSON.stringify({ format: 'cyberpunkpink-save', version: 4, meta: {}, state: {} })).ok).toBe(false)
    expect(unpackSave(raw((f) => { f.version = SAVE_VERSION + 1 }))).toMatchObject({ ok: false, error: expect.stringContaining('比這個版本新') })
    expect(unpackSave(raw((f) => { f.version = 'one' }))).toMatchObject({ ok: false })
    expect(unpackSave(raw((f) => { f.state = null }))).toMatchObject({ ok: false, error: '存檔裡沒有狀態。' })
    expect(unpackSave(raw((f) => { f.state.money.cash = -5 }))).toMatchObject({ ok: false, error: expect.stringContaining('存檔壞了') })
    expect(unpackSave(raw((f) => { f.state.pc = 'ghost' }))).toMatchObject({ ok: false })
    expect(unpackSave(raw((f) => { f.state.time.hour = 99 }))).toMatchObject({ ok: false })
    expect(unpackSave(raw((f) => { f.state.party.push('ghost') }))).toMatchObject({ ok: false })
  })

  it('有低於 18 的年齡，整筆拒絕，不自動改成 18', () => {
    expect(unpackSave(raw((f) => { f.state.actors.pc.age = 17 }))).toMatchObject({ ok: false, error: expect.stringContaining('成年人') })
    // 藏在功能自己的資料裡的年齡也擋
    const hidden = unpackSave(raw((f) => { f.state.ext.roster = { people: [{ name: 'x', age: 16 }] } }))
    expect(hidden).toMatchObject({ ok: false, error: expect.stringContaining('ext.roster.people[0].age') })
  })

  it('缺的欄位補上預設值；存檔規則超出範圍的夾住', () => {
    const r = unpackSave(raw((f) => { delete f.state.counters; delete f.state.chains; f.state.rules = { difficulty: 'legend', billMult: 99 }; delete f.state.seq.floor }))
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.file.state.counters).toEqual({})
    expect(r.file.state.chains).toEqual([])
    expect(r.file.state.rules).toMatchObject({ difficulty: 'legend', dcOffset: 2, billMult: 2, startXp: 200 })
    expect(r.file.state.seq.floor).toBe(0)
  })

  it('遷移的掛點：舊版的存檔照步驟表一版一版升上來；少了一步就讀不了', () => {
    const v1 = raw((f) => { f.version = 1; f.state.version = 1 })
    const migrations = [
      { from: 1, note: '第 2 版多了 flags.v2', run: (s: Record<string, unknown>) => ({ ...s, flags: { ...(s.flags as object), v2: true } }) },
      { from: 2, note: '第 3 版把 v2 改名成 v3', run: (s: Record<string, unknown>) => ({ ...s, flags: { v3: (s.flags as Record<string, unknown>).v2 } }) },
    ]
    const r = unpackSave(v1, { migrations, version: 3 })
    // （這一段用測試自己的步驟表：從第 1 版升到第 3 版）
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.fromVersion).toBe(1)
    expect(r.file.version).toBe(3)
    expect(r.file.state.version).toBe(3)
    expect(r.file.state.flags).toEqual({ v3: true })
    expect(unpackSave(v1, { migrations: [migrations[1]!], version: 3 })).toEqual({ ok: false, error: '沒有從第 1 版升上來的遷移步驟。' })
    // 正式的步驟表：每一版到下一版各一步，不缺號；第 1 版的存檔照它升到現在的版本
    expect(MIGRATIONS.map((m) => m.from)).toEqual(Array.from({ length: SAVE_VERSION - 1 }, (_, i) => i + 1))
    expect(unpackSave(v1)).toMatchObject({ ok: true, fromVersion: 1, file: { version: SAVE_VERSION } })
    expect(unpackSave(raw((f) => { f.version = 0 })).ok).toBe(false)
  })

  it('validateState 找得出壞的地方', () => {
    expect(validateState(makeState())).toEqual([])
    expect(validateState(null)).toHaveLength(1)
    const bad = clone(makeState()) as any
    bad.inventory = [{ id: 'x', qty: 0 }]
    bad.actors.pc.id = 'other'
    bad.rng = {}
    expect(validateState(bad)).toHaveLength(3)
  })

  it('Game.save 與 Game.load：讀檔之後狀態相同；讀檔修復走 save.loaded 掛鉤；讀壞的檔狀態不變', async () => {
    const { game } = makeGame()
    await game.act({ kind: 'free', text: '我看看四周' })
    const text = game.save('manual', 'now')
    const hash = stateHash(game.state)
    await game.act({ kind: 'free', text: '再看一次' })
    expect(stateHash(game.state)).not.toBe(hash)
    expect(game.load('壞掉的')).toBe('這不是存檔：JSON 讀不出來。')
    expect(game.state.reports).toHaveLength(3)
    expect(game.load(text)).toBeNull()
    expect(stateHash(game.state)).toBe(hash)
    expect(game.undo.size).toBe(0)
    expect(game.undoSteps()).toBe(false)
    // 讀檔修復：功能回傳變更，由提交報告寫入
    game.k.hooks.on('save.loaded', 'test', ({ state }) => (state.flags.repaired ? undefined : [{ op: 'flag', key: 'repaired', value: true }]))
    expect(game.load(text)).toBeNull()
    expect(game.state.flags.repaired).toBe(true)
    expect(game.state.reports.at(-1)!.action).toBe('save.repair')
  })
})

describe('L7 回退', () => {
  it('回退之後狀態和當時完全相同；再做同樣的行動擲出同樣的骰', async () => {
    const { game } = makeGame()
    const h0 = stateHash(game.state)
    const first = await game.act({ kind: 'free', text: '我看看四周' })
    const h1 = stateHash(game.state)
    await game.act({ kind: 'free', text: '我敲敲牆' })
    expect(game.undo.labels()).toEqual(['我看看四周', '我敲敲牆'])
    expect(game.undoSteps()).toBe(true)
    expect(stateHash(game.state)).toBe(h1)
    expect(game.undoSteps()).toBe(true)
    expect(stateHash(game.state)).toBe(h0)
    expect(game.undoSteps()).toBe(false)
    const again = await game.act({ kind: 'free', text: '我看看四周' })
    expect(again.reports[0]!.timeline[0]!.roll).toEqual(first.reports[0]!.timeline[0]!.roll)
    expect(stateHash(game.state)).toBe(h1)
  })

  it('一次回退好幾步；最多留 5 步；被擋下的行動不留步數', async () => {
    const { game } = makeGame()
    const hashes = [stateHash(game.state)]
    for (let i = 0; i < 7; i++) {
      await game.act({ kind: 'free', text: `第 ${i} 次` })
      hashes.push(stateHash(game.state))
    }
    expect(game.undo.size).toBe(UNDO_STEPS)
    expect(game.undoSteps(9)).toBe(false)
    expect(game.undoSteps(3)).toBe(true)
    expect(stateHash(game.state)).toBe(hashes[4])
    expect(game.undo.size).toBe(2)
    await expect(game.act({ kind: 'no_such_action' })).rejects.toThrow()
    expect(game.undo.size).toBe(2)
    expect(() => game.commit({ kind: 'system', location: {}, party: [], timeline: [], changes: [{ op: 'cash', delta: -1 }], outcome: { result: 'x', summary: '付錢' } })).toThrow()
    expect(game.undo.size).toBe(2)
    game.commit({ kind: 'system', location: {}, party: [], timeline: [], changes: [{ op: 'cash', delta: 5 }], outcome: { result: 'x', summary: '撿到錢' } })
    expect(game.undo.labels().at(-1)).toBe('撿到錢')
  })

  it('UndoStack 與 restoreKeeping', () => {
    const stack = new UndoStack(2)
    const a = makeState(), b = makeState({ patch: { money: { cred: 1, cash: 1 } } })
    stack.push(a, 'a')
    stack.push(b, 'b')
    stack.push(a, 'c')
    expect(stack.labels()).toEqual(['b', 'c'])
    expect(stack.pop(0)).toBeNull()
    expect(stack.pop(2)).toEqual(b)
    expect(stack.size).toBe(0)
    // 委託副本的回退：保留現在的紀錄
    const current = makeState({ patch: { flags: { now: true } } })
    const restored = restoreKeeping(current, a, (cur, out) => { out.flags = { ...cur.flags } })
    expect(restored.flags).toEqual({ now: true })
    expect(a.flags).toEqual({})
  })
})

// dev/adr/0005 第 5 點：狀態的形狀一改就留一份舊版的存檔當回歸測試
describe('舊版的存檔（tests/fixtures/saves/）讀得進來', () => {
  it('第 1 版（M0）：升到現在的版本；多出來的欄位補上；戰敗最多扣多少錢從 0 改成 1；其餘的不變', async () => {
    const { readFileSync } = await import('node:fs')
    const text = readFileSync(new URL('../fixtures/saves/v1-m0.json', import.meta.url), 'utf8')
    const old = JSON.parse(text) as { version: number; state: Record<string, any> }
    expect(old.version).toBe(1)
    const r = unpackSave(text)
    expect(r).toMatchObject({ ok: true, fromVersion: 1 })
    if (!r.ok) return
    const s = r.file.state
    expect(s.version).toBe(SAVE_VERSION)
    expect(s.battle).toBeNull()
    expect(s.maps).toEqual({ instances: {}, at: null, seq: 0 })
    // 存檔規則：玩家選的留著（困難、可以跳過、關掉的標籤），新的欄位照難度補
    expect(s.rules).toMatchObject({ difficulty: 'hard', dcOffset: 1, defeatView: 'skippable', contentOff: ['ntr'], defeatMoneyLoss: 1, defeatMoneyCap: null, heavyWounds: true })
    expect(s.rules.enemyCoef.boss).toEqual({ hp: 1.15, dmg: 1.35, load: 1.15 })
    // 其餘的原樣
    for (const k of ['rng', 'time', 'money', 'location', 'pc', 'actors', 'party', 'inventory', 'flags', 'counters', 'reports', 'chains', 'seq', 'ext']) expect(s[k as keyof typeof s], k).toEqual(old.state[k])
    // 讀進來的那一份存得下去、再讀回來一模一樣
    const again = unpackSave(packSave(s, r.file.meta))
    expect(again.ok && again.file.state).toEqual(s)
    const { game } = makeGame()
    expect(game.load(text)).toBeNull()
    expect(game.state.money).toEqual(old.state.money)
  })
})
