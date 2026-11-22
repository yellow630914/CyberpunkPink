// 驗收測試：dev/work/M0-ui-engine.md（交給 cpp-ui）。
// 工單 M0-ui-engine 完成後從 tests/pending/ 搬來。



import { beforeEach, describe, expect, it } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { useEngine } from './engine'
import { aiSettingsFromUi, logEntryOf, rulesFromUi, uiFromAiSettings } from '../lib/engineView'

const DRAFT = {
  name: '露', gender: 'female', age: 22, origin: 'hive', originChoice: { favor: 'lonestar' },
  attrPick: { reflex: 15, charm: 14, intellect: 13, body: 12, resolve: 10, tech: 8 },
  attrBonus: { tech: -4, reflex: 3, resolve: 3 },
  skills: { streetwise: 3, negotiate: 3, perform: 2, stealth: 2 },
  perks: ['smooth_talker', 'tough'],
}

describe('M0-ui-engine：store 包住引擎', () => {
  beforeEach(() => setActivePinia(createPinia()))

  it('開新遊戲：還沒有主角', () => {
    const e = useEngine()
    e.newGame({ seed: 7 })
    expect(e.hasCharacter).toBe(false)
    expect(e.state.pc).toBeNull()
    expect(e.state.time).toEqual({ day: 1, hour: 8, minute: 0 })
  })

  it('建角：規則在引擎；擋住時回傳是哪一步、為什麼，狀態不變', () => {
    const e = useEngine()
    e.newGame({ seed: 7 })
    const blocked = e.createCharacter({ ...DRAFT, age: 17 })
    expect(blocked).toHaveLength(1)
    expect(blocked[0]).toMatchObject({ step: 'basics' })
    expect(blocked[0]!.reason).toMatch(/18/)
    expect(e.hasCharacter).toBe(false)
    expect(e.createCharacter(DRAFT)).toEqual([])
    expect(e.hasCharacter).toBe(true)
    expect(e.pc).toMatchObject({ name: '露', age: 22 })
    expect(e.pc!.skills.streetwise).toBe(4)
    expect(e.money.cred + e.money.cash).toBe(1500)
  })

  it('建角畫面要的數字從引擎拿：自由點數、基本功剩幾點、特質點剩幾點', () => {
    const e = useEngine()
    e.newGame({ seed: 7 })
    expect(e.creation.attrBudget(DRAFT.attrBonus)).toEqual({ total: 6, lowered: 4, spent: 6, left: 0 })
    expect(e.creation.attrBlock(DRAFT.attrPick, {})).toMatch(/自由點數/)
    expect(e.creation.skillLeft(DRAFT.skills)).toBe(0)
    expect(e.creation.perkSummary(DRAFT.perks)).toEqual({ left: 0, perks: 2, flaws: 0 })
    expect(e.creation.ageBlock('17')).toMatch(/18/)
    expect(e.creation.origins.map((o: { id: string }) => o.id)).toEqual(['hive', 'corp', 'nomad', 'pleasure', 'oldport', 'sakura', 'under'])
    expect(e.creation.skills).toHaveLength(18)
  })

  it('自由行動：引擎擲骰、結算，紀錄多一則；AI 關閉時是戰報', async () => {
    const e = useEngine()
    e.setAi({ useAi: false })
    e.newGame({ seed: 7 })
    e.createCharacter(DRAFT)
    const before = e.log.length
    const r = await e.act({ kind: 'free', text: '我對著牆壁練習殺價', attr: 'charm', skill: 'negotiate' })
    expect(r.status).toBe('applied')
    expect(e.busy).toBe(false)
    expect(e.log).toHaveLength(before + 1)
    // 最新的一則排在最前面
    const entry = e.log[0]!
    expect(entry.time).toBe('第 1 天 08:00')
    expect(entry.prose[0]).toContain('自由行動')
    expect(entry.roll).toMatchObject({ skill: '交涉', dc: 13 })
    expect(entry.roll!.die).toBeGreaterThanOrEqual(1)
    expect(entry.roll!.mod).toBe(2 + 3 + 2)
    expect(['大成功', '成功', '失敗', '大失敗']).toContain(entry.roll!.result)
    expect(e.timeLabel).toBe('08:30')
  })

  it('沒有金鑰時 AI 接假的服務商：有正文，任務鏈的每一步看得到', async () => {
    const e = useEngine()
    e.setAi({ useAi: true })
    e.newGame({ seed: 7 })
    e.createCharacter(DRAFT)
    await e.act({ kind: 'free', text: '我看看四周' })
    expect(e.log[0]!.prose[0]).toContain('假的服務商')
    expect(e.chainSteps.map((s: { id: string }) => s.id)).toEqual(['roll', 'judge', 'hint', 'person', 'reward', 'relate', 'text', 'apply'])
    expect(e.chainSteps.find((s: { id: string }) => s.id === 'judge')).toMatchObject({ status: 'done' })
    expect(e.chainSteps.find((s: { id: string }) => s.id === 'person')).toMatchObject({ status: 'skipped' })
  })

  it('存檔、讀檔、回退', async () => {
    const e = useEngine()
    e.setAi({ useAi: false })
    e.newGame({ seed: 7 })
    e.createCharacter(DRAFT)
    await e.act({ kind: 'free', text: '第一件事' })
    const saved = e.save()
    const logLength = e.log.length
    await e.act({ kind: 'free', text: '第二件事' })
    expect(e.canUndo).toBe(true)
    expect(e.undo()).toBe(true)
    expect(e.log).toHaveLength(logLength)
    await e.act({ kind: 'free', text: '第三件事' })
    expect(e.load(saved)).toBeNull()
    expect(e.log).toHaveLength(logLength)
    expect(e.canUndo).toBe(false)
    expect(e.load('壞掉的存檔')).toMatch(/不是存檔/)
    expect(e.log).toHaveLength(logLength)
  })
})

describe('M0-ui-engine：把引擎的東西轉成畫面要的樣子（純函式）', () => {
  it('介面的設定轉成引擎的 AI 設定（cpp-ai-v1 的形狀）', () => {
    const ai = aiSettingsFromUi({
      useAi: true, judgeFree: false, judgeShift: true, judgeEvent: true, narrate: true, polish: true, clampRequested: false, agentMode: false,
      tradeProse: false, combatProse: '每回合一小段', onlyQuery: true, retries: 2, chainRow: '隱藏',
      hooks: { agent_hook: true, agent_event: false, agent_night: true, agent_commission: true, agent_flavor: false },
      hookLimits: { event: 2, hook: 1, other: 7 }, taskSource: { judge: '便宜的小模型' },
    })
    expect(ai).toMatchObject({
      ai: 1, judge_free: 0, judge_work: 1, judge_other: 1, narrate: 1, clamp_asked: 0, agent: 0,
      trade_text: 0, combat_text: 1, query_only: 1, chainbar: 2,
      hook_text: 1, hook_block: 0, hook_night: 1, hook_comm: 1, hook_shop: 0,
      lim_event: 2, lim_hook: 1, lim_visit: 7, lim_night: 7, lim_comm: 7, lim_shop: 7,
      src: { judge: '便宜的小模型' },
    })
    expect(ai).toMatchObject({ retry: { '*': 2 }, polish: { free: 1 } })
  })

  it('一份報告轉成紀錄的一則', () => {
    const entry = logEntryOf({
      id: 'r3', kind: 'action', action: 'free', actor: 'pc', input: '我看看四周', party: [],
      time: { start: { day: 14, hour: 17, minute: 5 }, end: { day: 14, hour: 17, minute: 35 } },
      location: { district: 'hive', block: '四號塔', facility: '屋頂的晾衣場' },
      timeline: [{ layer: 'meat', actor: 'pc', text: '', roll: { dice: '1d20', natural: 14, parts: [{ label: '智識', value: 1, source: 'attr' }, { label: '街頭直覺', value: 4, source: 'skill' }], total: 19, dc: 13, degree: 'critical', verdict: 'yes_and', margin: 6, attr: 'intellect', skill: 'streetwise' } }],
      changes: [{ op: 'cash', delta: 12 }, { op: 'cred', delta: -5 }, { op: 'time', minutes: 30 }, { op: 'rng', advance: 1 }],
      outcome: { result: 'critical', summary: '露：自由行動，大成功。' },
      narration: { results: ['拿到：現金 12'], text: '第一段。\n\n第二段。' },
      clamps: [{ path: 'reward.items[0]', from: 500, to: 120, notice: '你要的比這一區給得起的多，實際拿到 120 元。' }],
    })
    expect(entry).toMatchObject({
      id: 'r3', time: '第 14 天 17:05', place: 'hive · 四號塔 · 屋頂的晾衣場',
      prose: ['第一段。', '第二段。'],
      roll: { skill: '街頭直覺', die: 14, mod: 5, dc: 13, result: '大成功' },
    })
    expect(entry.changes).toEqual([{ text: '現金 +12', kind: 'plus' }, { text: '帳戶 −5', kind: 'minus' }])
    expect(entry.notices).toEqual(['你要的比這一區給得起的多，實際拿到 120 元。'])
  })

  it('沒有正文的報告用摘要當正文', () => {
    const entry = logEntryOf({
      id: 'r2', kind: 'system', action: 'creation.commit', party: [], location: {}, timeline: [], changes: [],
      time: { start: { day: 1, hour: 8, minute: 0 }, end: { day: 1, hour: 8, minute: 0 } },
      outcome: { result: 'created', summary: '建角完成。' },
    })
    expect(entry.prose).toEqual(['建角完成。'])
    expect(entry.roll).toBeUndefined()
    expect(entry.changes).toEqual([])
  })
})

describe('M0-ui-engine：cpp-ai-v1 與存檔規則的轉換', () => {
  it('介面欄位轉成引擎形狀再轉回來，值不變', () => {
    const ui = {
      useAi: false, judgeFree: true, judgeShift: false, judgeEvent: true, narrate: false, polish: true, clampRequested: true, agentMode: true,
      tradeProse: false, combatProse: '每回合一小段', onlyQuery: true, retries: 3, chainRow: '一直展開',
      hooks: { agent_hook: false, agent_event: true, agent_night: false, agent_commission: true, agent_flavor: true },
      hookLimits: { event: 2, hook: 1, other: 7 }, taskSource: { judge: 'x' },
    }
    expect(uiFromAiSettings(JSON.parse(JSON.stringify(aiSettingsFromUi(ui))))).toEqual(ui)
    expect(uiFromAiSettings(null)).toEqual({})
  })
  it('存檔規則：難度與特質點', () => {
    expect(rulesFromUi({ difficulty: '傳奇', traitPoints: 6 })).toEqual({ difficulty: 'legend', startPerkPoints: 6 })
  })
})
