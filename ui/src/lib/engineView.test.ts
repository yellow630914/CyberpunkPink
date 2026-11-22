// 白箱測試：ui/src/lib/engineView.ts（dev/work/M0-ui-engine.md 第二節）。
// 補驗收測試沒走到的分支：沒給的欄位、對不上的選項、部分的掛點與上限、紀錄的各種報告形狀、反向轉換的型別檢查。

import { describe, expect, it } from 'vitest'
import type { Report } from '@engine/src'
import { GENDER_OPTIONS, PERK_CATEGORY_NAME, aiSettingsFromUi, logEntryOf, rulesFromUi, uiFromAiSettings } from './engineView'

/** 最少的一份報告；測試只改需要的欄位 */
function rep(over: Partial<Report> = {}): Report {
  return {
    id: 'r1', kind: 'system', action: 'x', party: [], location: {}, timeline: [], changes: [],
    time: { start: { day: 2, hour: 9, minute: 7 }, end: { day: 2, hour: 9, minute: 7 } },
    outcome: { result: 'ok', summary: '摘要。' },
    ...over,
  } as Report
}

type Roll = NonNullable<Report['timeline'][number]['roll']>
function roll(over: Partial<Roll> = {}): Roll {
  return { dice: '1d20', natural: 10, parts: [], total: 10, dc: 13, degree: 'fail', verdict: 'no', margin: -3, attr: 'intellect', ...over } as Roll
}

describe('aiSettingsFromUi（M0-ui-engine 第二節的對照表）', () => {
  it('M0-ui-engine 第二節「左邊沒給的欄位就不輸出右邊的鍵」：空的設定轉出空物件', () => {
    expect(aiSettingsFromUi({})).toEqual({})
  })

  it('M0-ui-engine 第二節 combat_text：只有「每回合一小段」是 1，其他字都是 0', () => {
    expect(aiSettingsFromUi({ combatProse: '每回合一小段' })).toEqual({ combat_text: 1 })
    expect(aiSettingsFromUi({ combatProse: '結束時整場寫一次' })).toEqual({ combat_text: 0 })
    expect(aiSettingsFromUi({ combatProse: '' })).toEqual({ combat_text: 0 })
  })

  it('M0-ui-engine 第二節 chainbar：三個選項各對 0、1、2；對不上的選項不輸出', () => {
    expect(aiSettingsFromUi({ chainRow: '出錯時展開' })).toEqual({ chainbar: 0 })
    expect(aiSettingsFromUi({ chainRow: '一直展開' })).toEqual({ chainbar: 1 })
    expect(aiSettingsFromUi({ chainRow: '隱藏' })).toEqual({ chainbar: 2 })
    expect(aiSettingsFromUi({ chainRow: '不存在的選項' })).toEqual({})
  })

  it('M0-ui-engine 第二節 polish：布林轉成 { free: 0／1 }', () => {
    expect(aiSettingsFromUi({ polish: false })).toEqual({ polish: { free: 0 } })
    expect(aiSettingsFromUi({ polish: true })).toEqual({ polish: { free: 1 } })
  })

  it('M0-ui-engine 第二節 hooks：只給一部分的掛點，只輸出那幾個鍵', () => {
    expect(aiSettingsFromUi({ hooks: { agent_night: true } })).toEqual({ hook_night: 1 })
    expect(aiSettingsFromUi({ hooks: { agent_commission: false, 不認得的掛點: true } })).toEqual({ hook_comm: 0 })
    expect(aiSettingsFromUi({ hooks: {} })).toEqual({})
  })

  it('M0-ui-engine 第二節 hookLimits：hook、event 各自對一個鍵；other 一次寫四個鍵；沒給的不輸出', () => {
    expect(aiSettingsFromUi({ hookLimits: { hook: 3 } })).toEqual({ lim_hook: 3 })
    expect(aiSettingsFromUi({ hookLimits: { event: 0 } })).toEqual({ lim_event: 0 })
    expect(aiSettingsFromUi({ hookLimits: { other: 4 } })).toEqual({ lim_visit: 4, lim_night: 4, lim_comm: 4, lim_shop: 4 })
    expect(aiSettingsFromUi({ hookLimits: {} })).toEqual({})
  })

  it('M0-ui-engine 第二節 retry 與 src：retries 0 也要輸出；src 原樣帶過去', () => {
    expect(aiSettingsFromUi({ retries: 0 })).toEqual({ retry: { '*': 0 } })
    const src = { judge: 'a', text: 'b' }
    expect(aiSettingsFromUi({ taskSource: src })).toEqual({ src })
  })

  it('M0-ui-engine 第二節「布林一律轉成 1／0」：每個開關的 false 都是 0', () => {
    expect(aiSettingsFromUi({ useAi: false, judgeFree: false, judgeShift: false, judgeEvent: false, clampRequested: false, narrate: false, tradeProse: false, agentMode: false, onlyQuery: false }))
      .toEqual({ ai: 0, judge_free: 0, judge_work: 0, judge_other: 0, clamp_asked: 0, narrate: 0, trade_text: 0, agent: 0, query_only: 0 })
  })
})

describe('logEntryOf（M0-ui-engine 第二節；UI 第 3.2 節）', () => {
  it('M0-ui-engine 第二節 place：只有一部分的地點用「 · 」接有的；都沒有是空字串', () => {
    expect(logEntryOf(rep({ location: { district: 'hive', facility: '麵攤' } })).place).toBe('hive · 麵攤')
    expect(logEntryOf(rep({ location: { block: '四號塔' } })).place).toBe('四號塔')
    expect(logEntryOf(rep()).place).toBe('')
  })

  it('M0-ui-engine 第二節 time：用 formatTime(report.time.start)', () => {
    expect(logEntryOf(rep()).time).toBe('第 2 天 09:07')
  })

  it('M0-ui-engine 第二節 prose：照空行切段；只有空白的行也算空行；空的段落不留', () => {
    const e = logEntryOf(rep({ narration: { text: '  第一段。 \n \n第二段。\n\n\n\n第三段。\n\n' } }))
    expect(e.prose).toEqual(['第一段。', '第二段。', '第三段。'])
  })

  it('M0-ui-engine 第二節 prose：沒有 narration.text 時用 outcome.summary（只有 results 也一樣）', () => {
    expect(logEntryOf(rep({ narration: { results: ['拿到：現金 5'] } })).prose).toEqual(['摘要。'])
  })

  it('M0-ui-engine 第二節 changes：時間與亂數沒有描述，不出現；預設的描述用只有核心的核心', () => {
    const e = logEntryOf(rep({ changes: [{ op: 'time', minutes: 30 }, { op: 'rng', advance: 2 }] as Report['changes'] }))
    expect(e.changes).toEqual([])
  })

  it('M0-ui-engine 第二節 changes：有 + 是 plus、有 −（U+2212）是 minus、都沒有就不放 kind', () => {
    const e = logEntryOf(rep(), () => ['現金 +3', '帳戶 −2', '認識了阿蓮', '用 ASCII 的 - 不算'])
    expect(e.changes).toEqual([{ text: '現金 +3', kind: 'plus' }, { text: '帳戶 −2', kind: 'minus' }, { text: '認識了阿蓮' }, { text: '用 ASCII 的 - 不算' }])
  })

  it('stores/engine.ts commit 的註解：舊系統（ui.）的報告沒有變更可描述時，變化的字取 narration.results', () => {
    const e = logEntryOf(rep({ action: 'ui.legacy', narration: { text: '正文', results: ['好感 +1', '現金 −5'] } }), () => [])
    expect(e.changes).toEqual([{ text: '好感 +1', kind: 'plus' }, { text: '現金 −5', kind: 'minus' }])
  })

  it('同上：舊系統的報告沒有 narration 時，變化是空的', () => {
    expect(logEntryOf(rep({ action: 'ui.legacy' }), () => []).changes).toEqual([])
  })

  it('同上：引擎描述得出東西時用引擎的描述，不用 results', () => {
    const e = logEntryOf(rep({ action: 'ui.legacy', narration: { results: ['舊的字'] } }), () => ['現金 +1'])
    expect(e.changes).toEqual([{ text: '現金 +1', kind: 'plus' }])
  })

  it('同上：不是 ui. 開頭的報告不拿 results 補（results 只是舊系統的退路）', () => {
    expect(logEntryOf(rep({ action: 'free', narration: { results: ['拿到：現金 5'] } }), () => []).changes).toEqual([])
  })

  it('M0-ui-engine 第二節 notices；UI 3.2 節夾值的提醒：沒有 clamps 是空陣列', () => {
    expect(logEntryOf(rep()).notices).toEqual([])
  })

  it('M0-ui-engine 第二節 roll：沒有基本功那一項時用屬性那一項的名字', () => {
    const e = logEntryOf(rep({ timeline: [{ layer: 'meat', actor: 'pc', text: '', roll: roll({ parts: [{ label: '智識', value: 1, source: 'attr' }, { label: '情境', value: -2, source: 'situation' }] as Roll['parts'] }) }] }))
    expect(e.roll).toMatchObject({ skill: '智識', mod: -1, die: 10, dc: 13, result: '失敗' })
  })

  it('M0-ui-engine 第二節 roll：屬性與基本功都沒有時名字是空字串；mod 是所有 parts 的加總', () => {
    const e = logEntryOf(rep({ timeline: [{ layer: 'meat', actor: 'pc', text: '', roll: roll({ parts: [{ label: '情境', value: 2, source: 'situation' }, { label: '特質', value: 1, source: 'perk' }] as Roll['parts'] }) }] }))
    expect(e.roll).toMatchObject({ skill: '', mod: 3 })
  })

  it('M0-ui-engine 第二節 roll：取第一個有 roll 的節拍，前面沒有 roll 的節拍跳過、後面的不看', () => {
    const e = logEntryOf(rep({
      timeline: [
        { layer: 'meat', actor: 'pc', text: '走過去' },
        { layer: 'meat', actor: 'pc', text: '', roll: roll({ natural: 4 }) },
        { layer: 'meat', actor: 'pc', text: '', roll: roll({ natural: 17 }) },
      ],
    }))
    expect(e.roll?.die).toBe(4)
  })

  it('CORE_RULES 第 3 節的四種程度：result 用 DEGREE_NAME 轉成中文', () => {
    const name = (degree: Roll['degree']) => logEntryOf(rep({ timeline: [{ layer: 'meat', actor: 'pc', text: '', roll: roll({ degree }) }] })).roll?.result
    expect([name('critical'), name('success'), name('fail'), name('fumble')]).toEqual(['大成功', '成功', '失敗', '大失敗'])
  })

  it('M0-ui-engine 第二節：沒有任何節拍有 roll 就不放這個欄位', () => {
    expect('roll' in logEntryOf(rep({ timeline: [{ layer: 'meat', actor: 'pc', text: '' }] }))).toBe(false)
  })
})

describe('uiFromAiSettings（aiSettingsFromUi 的反向；缺的、型別不對的欄位不輸出）', () => {
  it('開關收 0／1 與 true／false；字串、null 不收', () => {
    expect(uiFromAiSettings({ ai: true, narrate: 0, judge_free: '1', agent: null })).toEqual({ useAi: true, narrate: false })
  })

  it('combat_text：1 是每回合一小段、0 是結束時整場寫一次；不是數字不收', () => {
    expect(uiFromAiSettings({ combat_text: 0 })).toEqual({ combatProse: '結束時整場寫一次' })
    expect(uiFromAiSettings({ combat_text: 1 })).toEqual({ combatProse: '每回合一小段' })
    expect(uiFromAiSettings({ combat_text: '1' })).toEqual({})
  })

  it('chainbar：0、1、2 對三個選項；範圍外的退回「出錯時展開」；不是數字不收', () => {
    expect(uiFromAiSettings({ chainbar: 2 }).chainRow).toBe('隱藏')
    expect(uiFromAiSettings({ chainbar: 9 }).chainRow).toBe('出錯時展開')
    expect(uiFromAiSettings({ chainbar: 'x' })).toEqual({})
  })

  it('polish、retry、src：形狀不對就不收', () => {
    expect(uiFromAiSettings({ polish: 1 })).toEqual({})
    expect(uiFromAiSettings({ polish: {} })).toEqual({})
    expect(uiFromAiSettings({ polish: { free: 0 } })).toEqual({ polish: false })
    expect(uiFromAiSettings({ retry: { judge: 2 } })).toEqual({})
    expect(uiFromAiSettings({ retry: { '*': '2' } })).toEqual({})
    expect(uiFromAiSettings({ src: 'x' })).toEqual({})
  })

  it('掛點與上限：只有給了的才輸出；other 讀 lim_visit（四個鍵寫的是同一個值）', () => {
    expect(uiFromAiSettings({ hook_night: 1 })).toEqual({ hooks: { agent_night: true } })
    expect(uiFromAiSettings({ lim_event: 2, lim_night: 5 })).toEqual({ hookLimits: { event: 2 } })
    expect(uiFromAiSettings({ lim_visit: 5 })).toEqual({ hookLimits: { other: 5 } })
  })

  it('不是物件的輸入一律是空的', () => {
    expect(uiFromAiSettings(undefined)).toEqual({})
    expect(uiFromAiSettings(3)).toEqual({})
    expect(uiFromAiSettings('ai')).toEqual({})
  })
})

describe('rulesFromUi（M0-ui-engine 第四節：存檔規則從設定頁帶）', () => {
  it('M0-ui-engine 第四節的難度對照：六個難度各對一個引擎的值', () => {
    const map = { 故事: 'story', 簡單: 'easy', 普通: 'normal', 困難: 'hard', 傳奇: 'legend', 自訂: 'custom' }
    for (const [ui, eng] of Object.entries(map)) expect(rulesFromUi({ difficulty: ui })).toEqual({ difficulty: eng })
  })

  it('對不上的難度不輸出；特質點 0 也要帶；什麼都沒給是空物件', () => {
    expect(rulesFromUi({ difficulty: '地獄' })).toEqual({})
    expect(rulesFromUi({ traitPoints: 0 })).toEqual({ startPerkPoints: 0 })
    expect(rulesFromUi({})).toEqual({})
  })
})

describe('顯示用的對照表', () => {
  it('DATA 第 1 節的性別值：介面的每個選項就是一個引擎的值，而且不重複', () => {
    const vals = GENDER_OPTIONS.map((o) => o.id)
    expect(new Set(vals).size).toBe(vals.length)
    expect(vals).toHaveLength(5)
    for (const v of vals) expect(['male', 'female', 'femboy', 'trans_f', 'futa']).toContain(v)
    expect(GENDER_OPTIONS.find((o) => o.id === 'trans_f')!.name).toBe('TS')
  })

  it('特質的分類都有中文名', () => {
    for (const v of Object.values(PERK_CATEGORY_NAME)) expect(v).toMatch(/^[一-鿿]+$/)
  })
})
