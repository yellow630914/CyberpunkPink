// 白箱測試：L7 外殼（存檔、讀檔、回退、一局遊戲的門面）。
// 補主套件沒有走到的分支與錯誤路徑。每個測試名稱寫明在測哪一條規格（文件與節）或不變式（dev/invariants.md）。

import { describe, expect, it } from 'vitest'
import type { Feature, GameState, ReportDraft } from '../../src'
import { Game, SAVE_FORMAT, SAVE_VERSION, UndoStack, clone, packSave, restoreKeeping, saveMeta, unpackSave, validateState } from '../../src'
import { makeActor, makeGame, makeState } from '../../src/testkit'
import { MINI_PACK } from '../helpers/miniContent'

const fileOf = (state: unknown, extra: Record<string, unknown> = {}) => JSON.stringify({ format: SAVE_FORMAT, version: SAVE_VERSION, meta: { label: 'x' }, state, ...extra })
const draft = (changes: ReportDraft['changes'], action = 'wb'): ReportDraft => ({ kind: 'system', action, location: {}, party: [], timeline: [], changes, outcome: { result: 'ok', summary: action } })

describe('白箱 L7 存檔的摘要（MIGRATION「敘事、狀態與介面」）', () => {
  it('還沒建角：名字寫「還沒建角」，沒有 pc 欄位；地點用 · 接起來、略過空的', () => {
    const s = makeState({ pc: false, patch: { location: { district: 'hive', facility: 'bar' } } })
    const m = saveMeta(s, 'auto', 't')
    expect(m.label).toBe('還沒建角・第 1 天 08:00')
    expect(m.place).toBe('hive · bar')
    expect('pc' in m).toBe(false)
    expect(saveMeta(s, 'manual', '', '自己取的').label).toBe('自己取的')
  })

  it('出身是字串時放進摘要', () => {
    const s = makeState({ pc: { ext: { origin: 'hive' } } })
    expect(saveMeta(s, 'manual', '').pc).toEqual({ name: '測試主角', origin: 'hive' })
  })
})

describe('白箱 L7 讀檔的每一種錯誤（MIGRATION「敘事、狀態與介面」；dev/invariants.md 第 6、12 條）', () => {
  const ok = makeState()

  it('JSON、格式標記、版本號、太新、沒有狀態', () => {
    expect(unpackSave('{')).toEqual({ ok: false, error: '這不是存檔：JSON 讀不出來。' })
    expect(unpackSave('[]')).toMatchObject({ ok: false, error: '這不是存檔：缺了格式標記。' })
    expect(unpackSave(JSON.stringify({ format: 'cyberpunkpink-save', version: 1, state: ok }))).toMatchObject({ error: '這不是存檔：缺了格式標記。' })
    for (const version of [0, 1.5, '1', undefined]) expect(unpackSave(fileOf(ok, { version }))).toMatchObject({ error: '存檔的版本號不對。' })
    expect(unpackSave(fileOf(ok, { version: SAVE_VERSION + 1 }))).toMatchObject({ ok: false, error: expect.stringMatching(/比這個版本新/) })
    expect(unpackSave(fileOf('x'))).toMatchObject({ error: '存檔裡沒有狀態。' })
  })

  it('舊版的存檔：沒有遷移步驟就拒絕；有就一版一版升上來，fromVersion 是原本的版本', () => {
    const raw = fileOf(ok, { version: 1 })
    expect(unpackSave(raw, { version: 3, migrations: [{ from: 1, note: '', run: (s) => s }] })).toMatchObject({ ok: false, error: '沒有從第 2 版升上來的遷移步驟。' })
    const steps: number[] = []
    const r = unpackSave(raw, { version: 3, migrations: [1, 2].map((from) => ({ from, note: '', run: (s: Record<string, unknown>) => { steps.push(from); return { ...s, flags: { ...(s.flags as object), [`v${from + 1}`]: true } } } })) })
    expect(steps).toEqual([1, 2])
    expect(r.ok && r.fromVersion).toBe(1)
    expect(r.ok && r.file.state.flags).toEqual({ v2: true, v3: true })
    expect(r.ok && r.file.state.version).toBe(3)
  })

  it('缺的欄位用空白的補；seq 缺的鍵補上；存檔規則重新清一次', () => {
    const s = clone(ok) as unknown as Record<string, unknown>
    delete s.chains
    delete s.counters
    s.seq = { report: 4 }
    s.rules = { difficulty: 'custom', dcOffset: 99 }
    const r = unpackSave(fileOf(s))
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.file.state.chains).toEqual([])
    expect(r.file.state.counters).toEqual({})
    expect(r.file.state.seq).toMatchObject({ report: 4, chain: 0, floor: 0 })
    expect(r.file.state.rules.dcOffset).toBe(4)
    // seq 不是物件：整份用空白的
    const r2 = unpackSave(fileOf({ ...clone(ok), seq: 'x' }))
    expect(r2.ok && r2.file.state.seq).toEqual({ report: 0, chain: 0, uid: 0, floor: 0 })
  })

  it('沒有 meta 時從狀態補一份；壞掉的狀態最多列三個問題', () => {
    const r = unpackSave(fileOf(ok, { meta: undefined }))
    expect(r.ok && r.file.meta.label).toBe('測試主角・第 1 天 08:00')
    const bad = { ...clone(ok), rng: null, time: 'noon', money: { cred: -1, cash: 0 }, party: 'x' }
    const e = unpackSave(fileOf(bad))
    expect(e.ok).toBe(false)
    expect(!e.ok && e.error.split('；')).toHaveLength(3)
  })

  it('validateState：每一個欄位的檢查', () => {
    expect(validateState(3)).toEqual(['狀態要是一個物件'])
    const s = clone(ok) as unknown as Record<string, unknown>
    const p = (patch: Record<string, unknown>) => validateState({ ...s, ...patch })
    expect(p({ rng: { seed: 1.5, cursor: 0 } })).toEqual(['rng：要有整數的 seed 與 cursor'])
    expect(p({ money: { cred: 1, cash: 0.5 } })).toEqual(['money：帳戶與現金要是 0 以上的整數'])
    expect(p({ money: 'x' })).toEqual(['money：帳戶與現金要是 0 以上的整數'])
    expect(p({ actors: [] }).length).toBeGreaterThan(0)
    expect(p({ actors: 'x', party: [] })).toEqual(['actors：要是一個物件', 'pc：主角不在 actors 裡'])
    expect(p({ actors: { pc: { ...makeActor(), id: 'other' } } })).toEqual(['actors.pc：id 和鍵不一樣'])
    expect(p({ actors: { pc: 'x' } })).toEqual(['actors.pc：角色要是一個物件'])
    expect(p({ pc: 3 })).toEqual(['pc：主角不在 actors 裡'])
    expect(p({ pc: null })).toEqual([])
    expect(p({ party: ['ghost'] })).toEqual(['party：隊伍裡有不存在的角色'])
    expect(p({ inventory: [{ id: 'a', qty: 0 }] })).toEqual(['inventory：每一疊要有 id 與正整數的 qty'])
    expect(p({ inventory: ['a'] })).toEqual(['inventory：每一疊要有 id 與正整數的 qty'])
    expect(p({ flags: [], location: null })).toEqual(['flags：要是一個物件', 'location：要是一個物件'])
    expect(p({ reports: {}, chains: 'x' })).toEqual(['reports：要是一個陣列', 'chains：要是一個陣列'])
  })

  it('低於 18 的年齡在任何深度都整筆拒絕，不自動改（AI_TASKS 3.19；PROMPTS H5）', () => {
    const s = clone(ok)
    s.ext.roster = { list: [{ name: '小麥', age: 17 }] }
    expect(unpackSave(fileOf(s))).toMatchObject({ ok: false, error: expect.stringMatching(/ext\.roster\.list\[0\]\.age/) })
  })
})

describe('白箱 L7 回退的堆疊（AI_TASKS 2.4「回退最多 5 步」；GAME_DESIGN 第 9 節；dev/invariants.md 第 4 條）', () => {
  it('超過上限時丟掉最舊的；labels 照順序', () => {
    const u = new UndoStack(2)
    for (const l of ['a', 'b', 'c']) u.push(makeState(), l)
    expect(u.labels()).toEqual(['b', 'c'])
    expect(u.size).toBe(2)
  })

  it('pop：n 小於 1 或大於步數回傳 null、不動；回傳的是複製的', () => {
    const u = new UndoStack()
    const s = makeState()
    u.push(s, 'a')
    expect(u.pop(0)).toBeNull()
    expect(u.pop(2)).toBeNull()
    expect(u.size).toBe(1)
    const got = u.pop(1)!
    expect(got).toEqual(s)
    expect(got).not.toBe(s)
    expect(u.size).toBe(0)
  })

  it('push 存的是複製的：之後改狀態不影響快照', () => {
    const u = new UndoStack()
    const s = makeState()
    u.push(s, 'a')
    s.money.cash = 99
    expect(u.pop()!.money.cash).toBe(0)
  })

  it('restoreKeeping：沒有 keep 就是快照的複製；有 keep 時保留現在的幾樣東西（SERIES 第 6 節）', () => {
    const now = makeState({ patch: { flags: { memory: true } } })
    const snap = makeState()
    expect(restoreKeeping(now, snap)).toEqual(snap)
    const out = restoreKeeping(now, snap, (cur, r) => { r.flags = clone(cur.flags) })
    expect(out.flags).toEqual({ memory: true })
    expect(snap.flags).toEqual({})
  })
})

describe('白箱 L7 一局遊戲（GAME_DESIGN 3；AI_TASKS 2.4、2.6；dev/invariants.md 第 4、6 條）', () => {
  it('內容的引用斷了：開局就丟錯', () => {
    expect(() => new Game({ content: [{ id: 'p', content: { origin: [{ ...MINI_PACK.content.origin![0]!, perk: 'missing_perk' }] } }] })).toThrow(/內容的引用斷了/)
  })

  it('subscribe：提交時通知，取消訂閱後不再通知', () => {
    const { game } = makeGame()
    const seen: number[] = []
    const off = game.subscribe((_s, rs) => seen.push(rs.length))
    game.commit(draft([{ op: 'cash', delta: 1 }]))
    off()
    game.commit(draft([{ op: 'cash', delta: 1 }]))
    expect(seen).toEqual([1])
  })

  it('commit：預設的回退標籤是報告的摘要；不合法時丟錯、狀態不變、不留回退', () => {
    const { game } = makeGame()
    game.commit(draft([{ op: 'cash', delta: 1 }], '買菸'))
    expect(game.undo.labels()).toEqual(['買菸'])
    const before = clone(game.state)
    expect(() => game.commit(draft([{ op: 'cash', delta: -99 }]))).toThrow(/現金不夠/)
    expect(game.state).toEqual(before)
    expect(game.undo.labels()).toEqual(['買菸'])
  })

  it('讀檔失敗回傳錯誤訊息、狀態與回退都不變（dev/invariants.md 第 6 條）', () => {
    const { game } = makeGame()
    game.commit(draft([{ op: 'cash', delta: 3 }]))
    const before = clone(game.state)
    expect(game.load('nope')).toMatch(/JSON/)
    expect(game.state).toEqual(before)
    expect(game.undo.size).toBe(1)
  })

  it('讀檔修復：save.loaded 的掛鉤回傳變更就提交一份 save.repair 報告，拿到 fromVersion', () => {
    const fix: Feature = { id: 'fix', install: (k) => k.hooks.on('save.loaded', 'fix', ({ fromVersion }) => [{ op: 'counter', key: `from${fromVersion}`, delta: 1 }]) }
    const { game } = makeGame({ features: [fix] })
    const seen: Array<Array<string | undefined>> = []
    game.subscribe((_s, rs) => seen.push(rs.map((r) => r.action)))
    expect(game.load(game.save())).toBeNull()
    expect(game.state.counters).toEqual({ from1: 1 })
    expect(seen).toEqual([['save.repair']])
  })

  it('讀檔之後、開新遊戲之後不能回退到之前', () => {
    const { game } = makeGame()
    game.commit(draft([{ op: 'cash', delta: 3 }]))
    const raw = game.save()
    game.commit(draft([{ op: 'cash', delta: 3 }]))
    expect(game.load(raw)).toBeNull()
    expect(game.undoSteps()).toBe(false)
    game.commit(draft([{ op: 'cash', delta: 3 }]))
    game.newGame({ seed: 1 })
    expect(game.undoSteps()).toBe(false)
    expect(game.state.money.cash).toBe(0)
  })

  it('回退：沒有那麼多步回傳 false、什麼都不動', () => {
    const { game } = makeGame()
    const before = clone(game.state)
    expect(game.undoSteps(1)).toBe(false)
    expect(game.undoSteps(0)).toBe(false)
    expect(game.state).toEqual(before)
  })

  it('沒有那條任務鏈丟錯；沒有可以重試的鏈丟錯（AI_TASKS 2.4「更早的鏈只能回退」）', async () => {
    const { game } = makeGame()
    expect(game.lastRun).toBeNull()
    await expect(game.runChain('nope', {})).rejects.toThrow(/沒有 nope 這條任務鏈/)
    await expect(game.retryStep('judge')).rejects.toThrow(/沒有可以重試的任務鏈/)
    await expect(game.useRules('judge')).rejects.toThrow(/沒有可以重試的任務鏈/)
  })

  it('上一條鏈還在跑時不能開始新的；關掉 AI 時進行中的鏈被取消（AI_TASKS 2.6）', async () => {
    const { game } = makeGame({ ai: { ai: 1 }, idleTimeoutMs: 5000, fake: { byTask: { judge: [{ hang: true }] } } })
    const first = game.act({ kind: 'free', text: '找人聊天' })
    await new Promise((r) => setTimeout(r, 5))
    expect(game.lastRun?.status).toBe('running')
    await expect(game.act({ kind: 'free', text: '再一個' })).rejects.toThrow(/還在跑/)
    game.setAiSettings({ ai: 0 })
    const r = await first
    expect(r.status).toBe('cancelled')
    expect(r.reports).toEqual([])
  })

  it('設定 AI 但沒有在跑的鏈：不取消任何東西', async () => {
    const { game } = makeGame()
    await game.act({ kind: 'free', text: '看看四周' }, { autoRules: true })
    game.setAiSettings({ ai: 0 })
    expect(game.lastRun?.status).toBe('applied')
  })

  it('被拒絕的一步停下來等玩家（不自動重試）；玩家按「用規則代替」走退路（AI_TASKS 2.6）', async () => {
    const { game, fake } = makeGame({ ai: { ai: 1 }, fake: { byTask: { judge: [{ refusal: true }] } } })
    const r = await game.act({ kind: 'free', text: '試試看' })
    expect(r.status).toBe('paused')
    expect(fake!.requestsFor('judge')).toHaveLength(1)
    expect(game.undo.size).toBe(1)
    const r2 = await game.useRules('judge')
    expect(r2.status).toBe('applied')
    expect(game.undo.size).toBe(1)
  })

  it('上一條鏈停在半路就開始新的行動：那一條作廢，它留的那一步回退也拿掉', async () => {
    const { game } = makeGame({ ai: { ai: 1 }, fake: { byTask: { judge: [{ refusal: true }] } } })
    const first = await game.act({ kind: 'free', text: '試試看' })
    expect(first.status).toBe('paused')
    const r = await game.act({ kind: 'free', text: '換一件事' })
    expect(game.lastRun).toBe(r.run)
    expect(r.status).toBe('applied')
    expect(game.undo.size).toBe(1)
  })

  it('新的一局：game.new 的掛鉤可以放初始狀態，存檔規則清乾淨', () => {
    const init: Feature = { id: 'init', install: (k) => k.hooks.on('game.new', 'init', () => [{ op: 'ext', key: 'init', value: { ok: true } }]) }
    const game = new Game({ features: [init] })
    const r = game.newGame({ seed: 3, rules: { difficulty: 'hard', startMoney: -5 } })
    expect(r.action).toBe('game.new')
    expect(game.state.ext.init).toEqual({ ok: true })
    expect(game.state.rules).toMatchObject({ difficulty: 'hard', dcOffset: 1, startMoney: 0 })
    expect(game.state.rng.seed).toBe(3)
  })

  it('存檔：預設 manual、savedAt 由外面給；打包出來的讀得回來，狀態一模一樣（dev/invariants.md 第 6 條）', () => {
    const { game } = makeGame()
    game.commit(draft([{ op: 'item', id: 'it_a', qty: 2, data: { dye: 'pink' } }, { op: 'flag', key: 'f', value: 'x' }]))
    const raw = game.save()
    const parsed = JSON.parse(raw) as { meta: { kind: string; savedAt: string } }
    expect(parsed.meta).toMatchObject({ kind: 'manual', savedAt: '' })
    const before = clone(game.state) as GameState
    expect(game.load(raw)).toBeNull()
    expect(game.state).toEqual(before)
    expect(packSave(game.state, saveMeta(game.state, 'snapshot', 'now'))).toContain('"kind":"snapshot"')
  })
})
