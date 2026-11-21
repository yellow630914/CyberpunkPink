// 白箱測試：ui/src/stores/engine.ts（dev/work/M0-ui-engine.md 第三節）。
// 補驗收測試（engine.test.ts）沒走到的分支：被擋下與出錯的行動、busy、重試／用規則／重擲、建角預覽的規則、
// 屬性 ± 的四種擋法、舊系統的提交點（commit、ledger）、讀檔失敗、空的回退。

import { beforeEach, describe, expect, it } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { ChangeError } from '@engine/src'
import { useEngine } from './engine'

const DRAFT = {
  name: '露', gender: 'female', age: 22, origin: 'hive', originChoice: { favor: '孤星連' },
  attrPick: { reflex: 15, charm: 14, intellect: 13, body: 12, resolve: 10, tech: 8 },
  attrBonus: { tech: -4, reflex: 3, resolve: 3 },
  skills: { streetwise: 3, negotiate: 3, perform: 2, stealth: 2 },
  perks: ['smooth_talker', 'tough'],
}

const json = (v: unknown) => JSON.stringify(v)

function ready(ai: boolean) {
  const e = useEngine()
  e.setAi({ useAi: ai })
  e.newGame({ seed: 7 })
  expect(e.createCharacter(DRAFT)).toEqual([])
  return e
}

describe('store 的唯讀投影', () => {
  beforeEach(() => setActivePinia(createPinia()))

  it('M0-ui-engine 第三節 hasCharacter／pc：開新局之後沒有主角，pc 是 null', () => {
    const e = useEngine()
    e.newGame({ seed: 1 })
    expect(e.hasCharacter).toBe(false)
    expect(e.pc).toBeNull()
  })

  it('M0-ui-engine 第三節 timeLabel：HH:MM，個位數補 0', () => {
    const e = useEngine()
    e.newGame({ seed: 1 })
    e.ledger([{ op: 'time', minutes: 65 }])
    expect(e.timeLabel).toBe('09:05')
  })

  it('M0-ui-engine 第三節 log：game.new 那一份不顯示；ui.money、ui.time 的帳也不顯示', () => {
    const e = useEngine()
    e.newGame({ seed: 1 })
    expect(e.log).toEqual([])
    e.ledger([{ op: 'cash', delta: 5 }])
    e.commit({ summary: '時間過去', action: 'ui.time', changes: [{ op: 'time', minutes: 10 }] })
    expect(e.log).toEqual([])
    expect(e.state.reports.map((r) => r.action)).toEqual(['game.new', 'ui.money', 'ui.time'])
  })

  it('M0-ui-engine 第三節 log：最新的排最前面', () => {
    const e = useEngine()
    e.newGame({ seed: 1 })
    e.commit({ summary: '一' })
    e.commit({ summary: '二' })
    expect(e.log.map((x) => x.prose[0])).toEqual(['二', '一'])
  })

  it('M0-ui-engine 第三節 chainSteps：還沒有任務鏈時是空陣列', () => {
    const e = useEngine()
    e.newGame({ seed: 1 })
    expect(e.chainSteps).toEqual([])
  })

  it('M0-ui-engine 第三節：state 是複製出來的投影，改它不會改到引擎', () => {
    const e = useEngine()
    e.newGame({ seed: 1 })
    ;(e.state.money as { cash: number }).cash = 999
    e.commit({ summary: '重新整理' })
    expect(e.money.cash).toBe(0)
  })
})

describe('動作：act、retryStep、useRules、reroll', () => {
  beforeEach(() => setActivePinia(createPinia()))

  it('M0-ui-engine 第三節 act：被擋下的行動（還沒有主角）回傳 blocked 與原因，不丟到元件；狀態不變（GAME_DESIGN 第 3 節）', async () => {
    const e = useEngine()
    e.setAi({ useAi: false })
    e.newGame({ seed: 7 })
    const before = json(e.state)
    const r = await e.act({ kind: 'free', text: '我看看四周' })
    expect(r).toEqual({ status: 'blocked', reason: '還沒有主角。' })
    expect(e.busy).toBe(false)
    expect(json(e.state)).toBe(before)
    expect(e.canUndo).toBe(false)
  })

  it('M0-ui-engine 第三節 busy：任務鏈在跑的時候是 true，跑完是 false', async () => {
    const e = ready(true)
    const p = e.act({ kind: 'free', text: '我看看四周' })
    expect(e.busy).toBe(true)
    await p
    expect(e.busy).toBe(false)
  })

  it('M0-ui-engine 第三節：不是 ActionBlocked 的錯誤照樣丟出去，busy 一定回到 false，狀態不變', async () => {
    const e = ready(false)
    const before = json(e.state)
    await expect(e.retryStep('judge')).rejects.toThrow(/沒有可以重試的任務鏈/)
    expect(e.busy).toBe(false)
    expect(json(e.state)).toBe(before)
  })

  it('AI_TASKS 2.4 節「已經套用」：最新一樓可以在套用之後重試，重試之後紀錄還是同一樓（不多一則）', async () => {
    const e = ready(true)
    await e.act({ kind: 'free', text: '我看看四周' })
    const n = e.log.length
    expect(await e.retryStep('judge')).toEqual({ status: 'applied' })
    expect(e.log).toHaveLength(n)
    expect(e.chainSteps.find((s) => s.id === 'judge')?.status).toBe('done')
  })

  it('AI_TASKS 2.4 節「用規則代替」：這一步改走程式的退路', async () => {
    const e = ready(true)
    await e.act({ kind: 'free', text: '我看看四周' })
    expect(await e.useRules('judge')).toEqual({ status: 'applied' })
    expect(e.chainSteps.find((s) => s.id === 'judge')?.status).toBe('fallback')
  })

  it('AI_TASKS 2.4 節「擲骰的步驟」；不變式第 5 條：重擲換骰而且留紀錄（任務鏈列的那一步記重擲幾次）', async () => {
    const e = ready(false)
    await e.act({ kind: 'free', text: '我看看四周' })
    const n = e.log.length
    expect(await e.reroll()).toEqual({ status: 'applied' })
    expect(await e.reroll()).toEqual({ status: 'applied' })
    expect(e.log).toHaveLength(n)
    expect(e.chainSteps.find((s) => s.id === 'roll')?.rerolls).toBe(2)
  })

  it('不變式第 5 條：同一個種子、同一串輸入，兩個 store 得到同一個結果', async () => {
    const a = ready(false)
    await a.act({ kind: 'free', text: '我看看四周' })
    setActivePinia(createPinia())
    const b = ready(false)
    await b.act({ kind: 'free', text: '我看看四周' })
    expect(json(b.state)).toBe(json(a.state))
  })
})

describe('建角（M0-ui-engine 第三、四節；CHARACTER 第 5 節）', () => {
  beforeEach(() => setActivePinia(createPinia()))

  it('M0-ui-engine 第三節 createCharacter：被擋下時狀態一個字都不變，也不留回退的一步', () => {
    const e = useEngine()
    e.newGame({ seed: 7 })
    const before = json(e.state)
    const blocked = e.createCharacter({ ...DRAFT, perks: ['smooth_talker', 'tough', 'smooth_talker', 'tough', 'tough'] })
    expect(blocked.length).toBeGreaterThan(0)
    expect(json(e.state)).toBe(before)
    expect(e.canUndo).toBe(false)
  })

  it('M0-ui-engine 第三節 createCharacter：成功時經過提交點（多一份報告、留一步回退）', () => {
    const e = useEngine()
    e.newGame({ seed: 7 })
    const n = e.state.reports.length
    e.createCharacter(DRAFT)
    expect(e.state.reports).toHaveLength(n + 1)
    expect(e.canUndo).toBe(true)
  })

  it('不變式第 32 條；CHARACTER 第 5 節：建角的數字從引擎拿', () => {
    const e = useEngine()
    e.newGame({ seed: 7 })
    expect(e.creation.limits).toEqual({ attrArray: [15, 14, 13, 12, 10, 8], attrFree: 2, attrMax: 18, attrMin: 4, skillPoints: 10, skillMax: 3, perkPoints: 4, perkMax: 8, flawMax: 2 })
  })

  it('M0-ui-engine 第四節：設定頁的特質點交給引擎預覽；清掉或開新局之後回到這一局的規則', () => {
    const e = useEngine()
    e.newGame({ seed: 7 })
    expect(e.creation.perkSummary([]).left).toBe(4)
    e.creation.previewRules({ startPerkPoints: 6 })
    expect(e.creation.perkSummary([]).left).toBe(6)
    expect(e.creation.limits.perkPoints).toBe(6)
    expect(e.creation.blocks({ ...DRAFT, perks: [] }).find((b) => b.step === 'perks')).toBeUndefined()
    e.creation.previewRules(null)
    expect(e.creation.perkSummary([]).left).toBe(4)
    e.creation.previewRules({ startPerkPoints: 6 })
    e.newGame({ seed: 8 })
    expect(e.creation.perkSummary([]).left).toBe(4)
  })

  it('M0-ui-engine 第四節：預覽不動現在這一局', () => {
    const e = useEngine()
    e.newGame({ seed: 7 })
    const before = json(e.state)
    e.creation.previewRules({ startPerkPoints: 9, difficulty: 'hard' })
    e.creation.skillLeft({ streetwise: 1 })
    e.creation.skillBlock({ streetwise: 4 })
    e.creation.perkBlock(['tough'])
    expect(json(e.state)).toBe(before)
  })

  it('UI 第 14 節第 1 步「年齡是硬界線」：只收整數、低於 18 擋下、18 可以', () => {
    const e = useEngine()
    expect(e.creation.ageBlock('18')).toBeNull()
    expect(e.creation.ageBlock('17')).toMatch(/18/)
    expect(e.creation.ageBlock('18.5')).toMatch(/整數/)
    expect(e.creation.ageBlock('')).toMatch(/整數/)
  })

  it('CHARACTER 第 5 節第 2 步：基本功點數剩幾點、單項上限 3', () => {
    const e = useEngine()
    e.newGame({ seed: 7 })
    expect(e.creation.skillLeft({})).toBe(10)
    expect(e.creation.skillBlock({ streetwise: 3 })).toBeNull()
    expect(e.creation.skillBlock({ streetwise: 4 })).not.toBeNull()
  })

  describe('attrStepBlock（M0-ui-engine 第四節「能不能再加」問引擎；CHARACTER 第 5 節：單項 4～18、自由點數 2）', () => {
    const pick = DRAFT.attrPick

    it('這一項還沒選數字：先選', () => {
      const e = useEngine()
      expect(e.creation.attrStepBlock({}, {}, 'reflex', 1)).toBe('先選這一項的數字。')
    })

    it('加到超過 18：擋下', () => {
      const e = useEngine()
      // 壓低 tech 換點數，確定擋下的是上限，不是自由點數
      expect(e.creation.attrStepBlock(pick, { reflex: 2, tech: -2 }, 'reflex', 1)).toBeNull()
      expect(e.creation.attrStepBlock(pick, { reflex: 3, tech: -2 }, 'reflex', 1)).toBe('單項最高 18。')
    })

    it('壓到低於 4：擋下，並說出 4 的調整值', () => {
      const e = useEngine()
      expect(e.creation.attrStepBlock(pick, { tech: -3 }, 'tech', -1)).toBeNull()
      expect(e.creation.attrStepBlock(pick, { tech: -4 }, 'tech', -1)).toBe('最低 4（調整值 -3）。')
    })

    it('自由點數用完了：再加一點擋下；先壓別的就又可以加', () => {
      const e = useEngine()
      expect(e.creation.attrStepBlock(pick, { reflex: 2 }, 'charm', 1)).toMatch(/自由點數用完了/)
      expect(e.creation.attrStepBlock(pick, { reflex: 2, tech: -1 }, 'charm', 1)).toBeNull()
    })

    it('往下壓永遠不會因為自由點數被擋', () => {
      const e = useEngine()
      expect(e.creation.attrStepBlock(pick, { reflex: 2 }, 'charm', -1)).toBeNull()
    })
  })

  it('CORE_RULES 第 1 節：屬性的調整值是（屬性 − 10）÷ 2 捨去', () => {
    const e = useEngine()
    expect([4, 9, 10, 11, 15, 18].map((v) => e.creation.attrMod(v))).toEqual([-3, -1, 0, 0, 2, 4])
  })

  it('建角畫面要的清單：六項屬性、特質都有', () => {
    const e = useEngine()
    expect(e.creation.attributes.map((a) => a.id).sort()).toEqual(['body', 'charm', 'intellect', 'reflex', 'resolve', 'tech'])
    expect(e.creation.perks.length).toBeGreaterThan(0)
  })
})

describe('舊系統的提交點：commit、ledger（M0-ui-engine 第五節第 3 步）', () => {
  beforeEach(() => setActivePinia(createPinia()))

  it('不變式第 1、2 條：commit 經過引擎的提交點，多一份 system 報告', () => {
    const e = useEngine()
    e.newGame({ seed: 1 })
    e.commit({ summary: '摘要', prose: ['第一段', '第二段'], results: ['好感 +1'], place: '麵攤', changes: [{ op: 'cash', delta: 20 }] })
    const r = e.state.reports.at(-1)!
    expect(r).toMatchObject({ kind: 'system', action: 'ui.legacy', location: { facility: '麵攤' }, outcome: { summary: '摘要' }, narration: { text: '第一段\n\n第二段', results: ['好感 +1'] } })
    expect(e.money.cash).toBe(20)
    expect(e.log[0]).toMatchObject({ prose: ['第一段', '第二段'], place: '麵攤' })
  })

  it('commit：沒有正文也沒有 results 時不放 narration；沒有地點時 location 是空的', () => {
    const e = useEngine()
    e.newGame({ seed: 1 })
    e.commit({ summary: '只有摘要' })
    const r = e.state.reports.at(-1)!
    expect(r.narration).toBeUndefined()
    expect(r.location).toEqual({})
    expect(e.log[0]!.prose).toEqual(['只有摘要'])
  })

  it('commit：只有 results 時 narration 只有 results，正文用摘要', () => {
    const e = useEngine()
    e.newGame({ seed: 1 })
    e.commit({ summary: '摘要', results: ['現金 +1'] })
    expect(e.state.reports.at(-1)!.narration).toEqual({ results: ['現金 +1'] })
    expect(e.log[0]).toMatchObject({ prose: ['摘要'], changes: [{ text: '現金 +1', kind: 'plus' }] })
  })

  it('不變式第 3、7 條：不合法的變更（錢變負的）整份不套，狀態完全不變，也不留回退的一步', () => {
    const e = useEngine()
    e.newGame({ seed: 1 })
    e.ledger([{ op: 'cash', delta: 10 }])
    const before = json(e.state)
    const undoBefore = e.canUndo
    expect(() => e.commit({ summary: '花太多', changes: [{ op: 'cred', delta: 5 }, { op: 'cash', delta: -11 }] })).toThrow(ChangeError)
    expect(json(e.state)).toBe(before)
    expect(e.canUndo).toBe(undoBefore)
  })

  it('ledger：變化是 0 的不提交；全部是 0 就什麼都不做', () => {
    const e = useEngine()
    e.newGame({ seed: 1 })
    const n = e.state.reports.length
    e.ledger([{ op: 'cred', delta: 0 }, { op: 'cash', delta: 0 }])
    expect(e.state.reports).toHaveLength(n)
    e.ledger([{ op: 'cred', delta: 0 }, { op: 'cash', delta: 7 }])
    expect(e.state.reports).toHaveLength(n + 1)
    expect(e.state.reports.at(-1)!.changes).toEqual([{ op: 'cash', delta: 7 }])
  })
})

describe('存檔、讀檔、回退（不變式第 4、6 條）', () => {
  beforeEach(() => setActivePinia(createPinia()))

  it('不變式第 6 條：存檔再讀檔，狀態一模一樣', async () => {
    const e = ready(false)
    await e.act({ kind: 'free', text: '我看看四周' })
    const before = json(e.state)
    const raw = e.save()
    await e.act({ kind: 'free', text: '再看一次' })
    expect(e.load(raw)).toBeNull()
    expect(json(e.state)).toBe(before)
  })

  it('不變式第 6 條：讀不進來的存檔不改變現在的狀態，也不清掉回退', async () => {
    const e = ready(false)
    await e.act({ kind: 'free', text: '我看看四周' })
    const before = json(e.state)
    expect(e.load('{"format":"cyberpunkpink-engine-save","version":999}')).not.toBeNull()
    expect(e.load('null')).not.toBeNull()
    expect(json(e.state)).toBe(before)
    expect(e.canUndo).toBe(true)
  })

  it('不變式第 12 條：引擎存檔裡有低於 18 的角色，整筆拒絕', () => {
    const e = ready(false)
    const raw = JSON.parse(e.save())
    const pcId = raw.state.pc as string
    raw.state.actors[pcId].age = 17
    expect(e.load(JSON.stringify(raw))).toMatch(/18/)
    expect(e.pc!.age).toBe(22)
  })

  it('M0-ui-engine 第三節 undo：沒有可以回退的就回傳 false，狀態不變', () => {
    const e = useEngine()
    e.newGame({ seed: 1 })
    const before = json(e.state)
    expect(e.canUndo).toBe(false)
    expect(e.undo()).toBe(false)
    expect(json(e.state)).toBe(before)
  })

  it('不變式第 4 條：回退之後狀態和當時完全相同（亂數也一樣）', async () => {
    const e = ready(false)
    const before = json(e.state)
    await e.act({ kind: 'free', text: '我看看四周' })
    expect(e.undo()).toBe(true)
    expect(json(e.state)).toBe(before)
    expect(e.chainSteps).toEqual([])
  })
})
