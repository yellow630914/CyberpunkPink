// 驗收測試：dev/work/M0-fix-ui.md（交給 cpp-ui）。引擎在 M0 的修正批次（2026-11-22）改了幾個介面，store 與 engineView 照著接。
// 工單完成前這個檔會失敗。跑法：在 ui/ 跑 npx vitest run --config vitest.pending.config.ts M0-fix-ui
// 完成後：搬到 ui/src/stores/engine.fix.test.ts（import 的路徑跟著改），npm test 與 npm run typecheck 都要過。

import { beforeEach, describe, expect, it } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { GENDER_IDS } from '@engine/src'
import type { Report } from '@engine/src'
import { useEngine } from './engine'
import { GENDER_OPTIONS, logEntryOf, rulesFromUi } from '../lib/engineView'

/** 出身的勢力用 id（DATA 1.1 節）：孤星連是 lonestar */
const DRAFT = {
  name: '露', gender: 'female', age: 22, origin: 'hive', originChoice: { favor: 'lonestar' },
  attrPick: { reflex: 15, charm: 14, intellect: 13, body: 12, resolve: 10, tech: 8 },
  attrBonus: { tech: -4, reflex: 3, resolve: 3 },
  skills: { streetwise: 3, negotiate: 3, perform: 2, stealth: 2 },
  perks: ['smooth_talker', 'tough'],
}
const PICK = DRAFT.attrPick

function started(over: Record<string, unknown> = {}, rules: object = {}) {
  const e = useEngine()
  e.setAi({ useAi: false })
  expect(e.newGame({ seed: 7, rules, draft: { ...DRAFT, ...over } as never })).toEqual([])
  return e
}

describe('M0-fix-ui：行動的結果分開（審查 E4）', () => {
  beforeEach(() => setActivePinia(createPinia()))

  it('被擋下的行動回傳 refused 與原因（不是 blocked）；狀態不變、不留回退', async () => {
    const e = useEngine()
    e.newGame({ seed: 7 })
    const r = await e.act({ kind: 'free', text: '還沒有主角就想動' })
    expect(r).toEqual({ status: 'refused', reason: '還沒有主角。' })
    expect(e.canUndo).toBe(false)
    expect(e.log).toHaveLength(0)
  })

  it('套用了是 applied，而且沒有 reason', async () => {
    const e = started()
    expect(await e.act({ kind: 'free', text: '我看看四周' })).toEqual({ status: 'applied' })
  })

  it('任務鏈列的按鈕問引擎（stepActions）：擲骰可以重擲、不能用規則；之後記了帳就都不能按（只能回退）', async () => {
    const e = started()
    await e.act({ kind: 'free', text: '我看看四周' })
    expect(e.stepActions('roll')).toEqual({ retry: null, useRules: '只有 AI 的步驟可以用規則代替。', reroll: null })
    expect(e.stepActions('judge').reroll).toBe('這一步不是擲骰，不能重擲。')
    e.ledger([{ op: 'cash', delta: -10 }])
    const sealed = e.stepActions('roll')
    for (const reason of [sealed.retry, sealed.useRules, sealed.reroll]) expect(reason).toMatch(/只能回退/)
  })
})

describe('M0-fix-ui：沒有正文的帳併進最新一樓（AI_TASKS 5.5 節；ui-undo-ledger-steps、審查 S3）', () => {
  beforeEach(() => setActivePinia(createPinia()))

  it('ledger 不另留回退：自由行動之後記五筆帳，回退一步連同那一樓一起收回', async () => {
    const e = started()
    await e.act({ kind: 'free', text: '我看看四周' })
    for (let i = 0; i < 5; i++) e.ledger([{ op: 'cash', delta: -10 }])
    expect(e.money.cash).toBe(1450)
    expect(e.undo()).toBe(true)
    expect(e.money.cash).toBe(1500)
    expect(e.state.time).toEqual({ day: 1, hour: 8, minute: 0 })
    expect(e.canUndo).toBe(false)
  })

  it('commit 預設留一步回退；給 attach 就併進最新一樓', () => {
    const e = started()
    e.commit({ summary: '休息了一會兒', changes: [{ op: 'time', minutes: 60 }] })
    expect(e.canUndo).toBe(true)
    e.commit({ summary: '順手買了一瓶水', changes: [{ op: 'cash', delta: -5 }] }, { attach: true })
    expect(e.undo()).toBe(true)
    expect(e.money.cash).toBe(1500)
    expect(e.state.time).toEqual({ day: 1, hour: 8, minute: 0 })
    expect(e.canUndo).toBe(false)
  })
})

describe('M0-fix-ui：開新局與建角是一件事（審查 S11）；建角的規則都問引擎', () => {
  beforeEach(() => setActivePinia(createPinia()))

  it('newGame 帶 draft：成功時開局加建角一起進去、不留回退；被擋下時回傳是哪一步，原本那一局完全不動', async () => {
    const e = started()
    expect(e.state.reports.map((r) => r.action)).toEqual(['game.new', 'creation.commit'])
    expect(e.canUndo).toBe(false)
    await e.act({ kind: 'free', text: '我看看四周' })
    const before = JSON.stringify(e.state)
    const blocks = e.newGame({ seed: 9, draft: { ...DRAFT, age: 17 } as never })
    expect(blocks).toHaveLength(1)
    expect(blocks[0]).toMatchObject({ step: 'basics' })
    expect(JSON.stringify(e.state)).toBe(before)
    expect(e.canUndo).toBe(true)
  })

  it('出身的勢力用 id：中文名被擋在出身那一步，句子裡寫的是短名；originView 給畫面顯示用的名字', () => {
    const e = useEngine()
    expect(e.newGame({ seed: 7, draft: { ...DRAFT, originChoice: { favor: '孤星連' } } as never })).toEqual([{ step: 'origin', reason: '要選一個勢力：孤星連、野良。' }])
    expect(e.creation.originView('hive')).toEqual({
      favor: [{ id: 'lonestar', name: '孤星連' }, { id: 'nora', name: '野良' }], favorValue: 25,
      roster: [{ id: 'npc_xiaomai', name: '小麥' }, { id: 'npc_ray', name: '雷' }],
    })
    expect(e.creation.originView('corp')!.favor).toHaveLength(12)
    expect(e.creation.originView('corp')!.favor[0]).toEqual({ id: 'hizakura', name: '緋櫻' })
  })

  it('屬性的 ± 按鈕問引擎（attrStepBlock 不在 store 裡自己算）；數字從引擎拿（limits）', () => {
    const e = useEngine()
    e.newGame({ seed: 7 })
    expect(e.creation.attrStepBlock({}, {}, 'body', 1)).toBe('先選這一項的數字。')
    expect(e.creation.attrStepBlock(PICK, { reflex: 2 }, 'reflex', 1)).toBe('自由點數用完了：先把別的屬性往下壓，一點換一點。')
    expect(e.creation.attrStepBlock(PICK, { reflex: 3, tech: -4 }, 'reflex', 1)).toBe('單項最高 18。')
    expect(e.creation.attrStepBlock(PICK, { tech: -4 }, 'tech', -1)).toBe('最低 4（調整值 -3）。')
    expect(e.creation.attrStepBlock(PICK, {}, 'reflex', 1)).toBeNull()
    expect(e.creation.limits).toEqual({
      attrArray: [15, 14, 13, 12, 10, 8], attrFree: 2, attrMax: 18, attrMin: 4, skillPoints: 10, skillMax: 3, perkPoints: 4, perkMax: 8, flawMax: 2,
      startMoney: 1500, cyberPoints: 10, gearPoints: 12, cyberPointCash: 500, gearPointCash: 150,
    })
  })

  it('性別五個值：TS 只有男跨女一種 trans_f（選項的 id 就是引擎的值）；trans_m 已經拿掉', () => {
    expect(GENDER_OPTIONS.map((o) => o.id)).toEqual([...GENDER_IDS])
    for (const o of GENDER_OPTIONS) expect(o.name.length).toBeGreaterThan(0)
    expect(GENDER_OPTIONS.map((o) => o.id)).toEqual(['female', 'male', 'femboy', 'trans_f', 'futa'])
    for (const gender of ['trans_f', 'futa']) {
      setActivePinia(createPinia())
      expect(started({ gender }).pc!.gender).toBe(gender)
    }
    // 拿掉的 trans_m 引擎不收
    setActivePinia(createPinia())
    expect(useEngine().newGame({ seed: 7, draft: { ...DRAFT, gender: 'trans_m' } as never })).toEqual([{ step: 'basics', reason: '沒有這個性別。' }])
    // 舊的寫法（顯示用的「TS」當成值）引擎不收
    setActivePinia(createPinia())
    expect(useEngine().newGame({ seed: 7, draft: { ...DRAFT, gender: 'TS' } as never })).toEqual([{ step: 'basics', reason: '沒有這個性別。' }])
  })

  it('私處的外觀是 look.private（{ options, text }）；內容篩選關掉「身體的私密描寫」時引擎不寫', () => {
    const look = { hair: '黑色短髮', private: { options: ['剃得很乾淨'], text: '左邊大腿內側有一顆小痣。' } }
    const on = started({ look })
    expect((on.pc!.ext.profile as { look: unknown }).look).toEqual(look)
    setActivePinia(createPinia())
    const off = started({ look }, rulesFromUi({ filterIntimateBody: false }))
    expect(off.state.rules.contentOff).toEqual(['intimate_body'])
    expect((off.pc!.ext.profile as { look: unknown }).look).toEqual({ hair: '黑色短髮' })
  })

  it('起始的錢由引擎算（CHARACTER 5.4 節）：沒花完的義體點數每點 500、裝備點數每點 150，全部是現金', () => {
    const e = useEngine()
    e.newGame({ seed: 7 })
    expect(e.creation.startMoney({ cyberSpent: 8, gearSpent: 10 })).toEqual({ base: 1500, cyber: 1000, gear: 300, total: 2800 })
    expect(e.creation.startMoney({})).toEqual({ base: 1500, cyber: 0, gear: 0, total: 1500 })
    setActivePinia(createPinia())
    expect(started({ cyberSpent: 8, gearSpent: 10 }).money).toEqual({ cred: 0, cash: 2800 })
    setActivePinia(createPinia())
    expect(useEngine().newGame({ seed: 7, draft: { ...DRAFT, cyberSpent: 11 } as never })).toEqual([{ step: 'cyber', reason: '義體點數只有 10 點。' }])
  })
})

describe('M0-fix-ui：存檔規則帶進引擎（審查 S4；內容篩選）', () => {
  it('自訂難度的 DC 偏移帶進引擎（−4～+4；超出的由引擎夾住）；預設難度不帶偏移', () => {
    expect(rulesFromUi({ difficulty: '自訂', customDiff: { dc: 3 } })).toMatchObject({ difficulty: 'custom', dcOffset: 3 })
    expect(rulesFromUi({ difficulty: '困難', customDiff: { dc: 3 } })).toEqual({ difficulty: 'hard' })
    setActivePinia(createPinia())
    const e = useEngine()
    e.newGame({ seed: 7, rules: rulesFromUi({ difficulty: '自訂', customDiff: { dc: -9 } }) })
    expect(e.state.rules).toMatchObject({ difficulty: 'custom', dcOffset: -4 })
  })

  it('內容篩選：關掉的那幾格變成引擎的 contentOff；開著的不出現', () => {
    expect(rulesFromUi({ filterIntimateBody: false }).contentOff).toEqual(['intimate_body'])
    expect(rulesFromUi({ filterIntimateBody: true }).contentOff ?? []).toEqual([])
  })
})

describe('M0-fix-ui：撤退回到快照，但紀錄留著（SERIES 第 6 節）；時鐘問引擎', () => {
  beforeEach(() => setActivePinia(createPinia()))

  it('rewind：時間與錢回到快照那一刻；之後的紀錄留著並標成被收回（擲骰行還在）；多一則交代這件事；不能再回退', async () => {
    const e = started()
    const snap = e.save()
    await e.act({ kind: 'free', text: '副本裡的第一件事' })
    e.ledger([{ op: 'cash', delta: -100 }, { op: 'time', minutes: 120 }])
    expect(e.rewind(snap, '你退了出來。這一段經歷被收回了。')).toBeNull()
    expect(e.state.time).toEqual({ day: 1, hour: 8, minute: 0 })
    expect(e.money.cash).toBe(1500)
    expect(e.canUndo).toBe(false)
    // 紀錄最新的排最前面：交代撤退的那一則、被收回的自由行動（帳不顯示）
    expect(e.log[0]!.prose).toEqual(['你退了出來。這一段經歷被收回了。'])
    expect(e.log[0]!.retracted).toBeUndefined()
    expect(e.log[1]).toMatchObject({ retracted: true })
    expect(e.log[1]!.roll).toBeDefined()
    expect(e.rewind('不是存檔', 'x')).toMatch(/不是存檔/)
  })

  it('clock：星期、時段、離收租日幾天（第 1 天是週二，第 7 天是週一）', () => {
    const e = started()
    expect(e.clock).toEqual({ weekday: 1, segment: 'morning', segmentWeekday: 1, daysToMonday: 6 })
    e.commit({ summary: '過了幾天', changes: [{ op: 'time', minutes: 6 * 1440 }] })
    expect(e.clock).toMatchObject({ weekday: 0, daysToMonday: 0 })
  })
})

describe('M0-fix-ui：紀錄的一則（logEntryOf）多兩樣', () => {
  const report = (over: Partial<Report>): Report => ({
    id: 'r9', kind: 'action', action: 'free', time: { start: { day: 1, hour: 8, minute: 0 }, end: { day: 1, hour: 8, minute: 30 } }, location: {}, party: [],
    timeline: [{ layer: 'meat', text: '看了一圈', twist: '牆角有一張被撕掉一半的傳單', roll: { dice: '1d20', natural: 12, parts: [{ label: '智識', value: 1, source: 'attr' }], total: 13, dc: 13, degree: 'success', verdict: 'yes_but', margin: 0 } }],
    changes: [], outcome: { result: 'success', summary: '看了一圈。' }, ...over,
  })

  it('判定的轉折（twist）帶到紀錄的擲骰行（roll.twist）；沒有轉折就沒有這一欄', () => {
    expect(logEntryOf(report({}), () => []).roll!.twist).toBe('牆角有一張被撕掉一半的傳單')
    const plain = report({})
    delete plain.timeline[0]!.twist
    expect('twist' in logEntryOf(plain, () => []).roll!).toBe(false)
  })

  it('被收回的經歷（report.retracted）帶到紀錄；平常沒有這一欄', () => {
    expect(logEntryOf(report({ retracted: true }), () => []).retracted).toBe(true)
    expect('retracted' in logEntryOf(report({}), () => [])).toBe(false)
  })
})
