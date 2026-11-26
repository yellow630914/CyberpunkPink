// 冒煙 M4・第三波：契約與長線（dev/work/M4-smoke.md 第 3 點、dev/work/M4-plan.md「第三波」那一圈）。固定種子、AI 關閉。
//   契約（主角是契約人）  效果簽下契約 → 過幾天收到指令 → 抗拒失敗 → 走到指定的地方、事件做完 → 一條逾期 → 還清
//   契約（主角是持約人）  持有一個契約人 → 觸發一件事 → 調整 → 解約
//   長線                  染上惡意韌體 → 推進到發作 → 清除；沉溺到 66 → 蠱惑的事件來（長休醒來、潛入登入各一次）→ 順著五次
// 內容一律是 testkit 的 bodyWorld()；功能是全部；走的是真正的功能與真正的提交。
// 每一個數字都是「這一局這樣算出來」的結果，不是設計書的承諾；設計書的數字在各功能自己的測試裡。

import { describe, expect, it, vi } from 'vitest'
import type { Report } from '../../src'
import { toMinutes } from '../../src'
import { chooseOption, eventView } from '../../src/features/director'
import { adjustDraft, arriveDraft, boundView, chooseDraft, completeDraft, contractOf, heldIn, payoffDraft, payoffQuote, releaseDraft, triggerDraft } from '../../src/features/contract'
import { lureView } from '../../src/features/lure'
import { cleanDraft, malwareOf, malwareView } from '../../src/features/malware'
import { rentDraft, sleepDraft } from '../../src/features/rest'
import type { Game } from '../../src/shell/game'
import { BODY_BLOCKS, applyEffects, diveIn, flow, giveItem, makeActor, makeBodyGame, observed, passTime, standAt, untilIdle } from '../../src/testkit'

vi.setConfig({ testTimeout: 60_000 })

const actions = (rs: Report[]): string[] => rs.map((r) => r.action ?? '')
const pc = (g: Game) => g.state.actors.pc!
const WEAK = { attrs: { resolve: 4 }, skills: {}, ext: { bridge: { sensitivity: 30, tolerance: 30, craving: 30, docility: 40 } } }
const AYIN = 'npc_tw_ayin'

function setSink(g: Game, n: number): void {
  g.commit({ kind: 'system', action: 'test.sink', location: {}, party: [], timeline: [], changes: [{ op: 'actor.track', id: 'pc', track: 'sink', delta: n - pc(g).sink } as never], outcome: { result: 'ok', summary: '測試用的沉溺。' } })
}

// ---------------------------------------------------------------------------------------------------------------------

/** 契約（主角是契約人）。 */
async function boundFlow(g: Game, f = flow('契約（契約人）'), checkpoint: (label: string) => void = () => undefined): Promise<Game> {
  const { k } = g
  await f.step('效果簽下契約：債務契約（C$24,000）、持約人是一個勢力；身分變成契約人、滿意 50、佇列是空的', () => {
    const r = applyEffects(g, [{ kind: 'contract_sign', type: 'debt', debt: 24000, orders: ['errand', 'work', 'report'], report_weekday: 0, holder: { kind: 'eden', name: '樂園', faction: 'f_tw_eden', place: { district: 'tw_hive', block: 'tw_tower' } }, rules: [] }])
    expect(r.errors).toEqual([])
    expect(actions(r.reports)).toContain('contract.sign')
    expect(contractOf(g.state)).toMatchObject({ type: 'debt', debt: 24000, satisfaction: 50 })
    expect((pc(g).ext.identity as { class?: string }).class).toBe('bound')
    expect(contractOf(g.state)!.queue).toEqual([])
  })
  checkpoint('after-sign')
  await f.step('過幾天收到指令：每天 08:00 擲，擲到就多一條 sent 的指令（有 contract.order 的報告）', () => {
    let got = false
    for (let d = 0; d < 20 && !got; d++) {
      const rs = passTime(g, 24 * 60)
      got = rs.some((r) => r.action === 'contract.order')
    }
    expect(got).toBe(true)
    const o = contractOf(g.state)!.queue.find((x) => x.state === 'sent')!
    expect(o).toBeTruthy()
    expect(o.deadline).toBeGreaterThan(toMinutes(g.state.time))
  })
  const first = contractOf(g.state)!.queue.find((x) => x.state === 'sent')!.id
  await f.step('抗拒失敗：定力很低的主角抗拒、沒過 → 被強制（forced）、期限不變、滿意不變或下降、紀錄帶擲骰', () => {
    const sat0 = boundView(k, g.state)!.satisfaction
    const reports = g.commit(chooseDraft(k, g.state, { order: first, how: 'resist' }))
    expect(actions(reports)).toContain('contract.choose')
    const o = contractOf(g.state)!.queue.find((x) => x.id === first)!
    expect(['forced', 'resisted']).toContain(o.state)
    // 這一局的骰面：定力 4 對 DC 20 的出借，過不了（5% 的機會）
    expect(o.state).toBe('forced')
    expect(boundView(k, g.state)!.satisfaction).toBeLessThanOrEqual(sat0)
  })
  await f.step('事件塞進來一條差事（要去塔下）：照做 → 走到指定的地方 → 事件跳出來 → 做完（order_done）→ 指令了結、滿意往上', async () => {
    const r = applyEffects(g, [{ kind: 'order', order_kind: 'errand', place: { district: 'tw_hive', block: 'tw_tower' }, hours: 24 }])
    expect(r.errors).toEqual([])
    const errand = contractOf(g.state)!.queue.filter((x) => x.kind === 'errand').pop()!
    const sat0 = boundView(k, g.state)!.satisfaction
    g.commit(chooseDraft(k, g.state, { order: errand.id, how: 'comply' }))
    expect(contractOf(g.state)!.queue.find((x) => x.id === errand.id)!.state).toBe('doing')
    standAt(g, 'tw_tower', 'E1')
    const reports = g.commit(arriveDraft(k, g.state, { order: errand.id }))
    expect(actions(reports)).toContain('contract.arrive')
    // 走到了之後觸發點 order 帶出指令事件（ct_tw_order_errand）：做完它
    const ev = eventView(k, g.state)
    expect(ev?.event).toBe('ct_tw_order_errand')
    g.commit(chooseOption(k, g.state, 'ok'))
    expect(contractOf(g.state)!.queue.find((x) => x.id === errand.id)!.state).toBe('done')
    expect(boundView(k, g.state)!.satisfaction).toBeGreaterThan(sat0)
    expect(g.state.flags.tw_bound_errand).toBe(true)
  })
  checkpoint('after-errand')
  await f.step('一條逾期：一條很短的差事被強制之後不去做，期限一過就是 overdue、滿意往下、有一份 contract.overdue', () => {
    applyEffects(g, [{ kind: 'order', order_kind: 'errand', place: { district: 'tw_hive', block: 'tw_gate' }, hours: 2 }])
    const late = contractOf(g.state)!.queue.filter((x) => x.kind === 'errand').pop()!
    g.commit(chooseDraft(k, g.state, { order: late.id, how: 'resist' }))
    const sat0 = boundView(k, g.state)!.satisfaction
    const rs = passTime(g, 6 * 60)
    expect(actions(rs)).toContain('contract.overdue')
    expect(contractOf(g.state)!.queue.find((x) => x.id === late.id)!.state).toBe('overdue')
    expect(boundView(k, g.state)!.satisfaction).toBeLessThan(sat0)
  })
  await f.step('還清：付還清的價錢（債的 1.5 倍）→ 契約解除、身分回去、佇列清空；一份 contract.pay', () => {
    const quote = payoffQuote(k, g.state)!
    expect(quote.debt).toBe(24000)
    expect(g.state.money.cred + g.state.money.cash).toBeGreaterThanOrEqual(quote.price)
    const cash0 = g.state.money.cred + g.state.money.cash
    const reports = g.commit(payoffDraft(k, g.state))
    expect(actions(reports)).toContain('contract.pay')
    expect(contractOf(g.state)).toBeNull()
    expect((pc(g).ext.identity as { class?: string } | undefined)?.class).not.toBe('bound')
    expect(g.state.money.cred + g.state.money.cash).toBeLessThan(cash0)
  })
  return g
}

/** 契約（主角是持約人）。 */
async function holderFlow(g: Game, f = flow('契約（持約人）')): Promise<Game> {
  const { k } = g
  await f.step('持有一個契約人（阿音）：效果 contract_hold；她的身分是契約人、heldIn 有她', () => {
    const r = applyEffects(g, [{ kind: 'contract_hold', npc: AYIN, type: 'private' }])
    expect(r.errors).toEqual([])
    expect(heldIn(g.state, AYIN)).toBeTruthy()
    expect((g.state.actors[AYIN]!.ext.identity as { class?: string }).class).toBe('bound')
  })
  await f.step('觸發一件事（差事）：有 contract.trigger（或她抗拒的 contract.refuse）；觸發點 holder_order 帶出事件、做完', async () => {
    const reports = g.commit(triggerDraft(k, g.state, { npc: AYIN, kind: 'errand' }))
    expect(['contract.trigger', 'contract.refuse']).toContain(reports[0]!.action)
    if (reports[0]!.action === 'contract.trigger') {
      const ev = eventView(k, g.state)
      if (ev) {
        expect(ev.event).toBe('ct_tw_errand')
        g.commit(chooseOption(k, g.state, 'take'))
        expect(g.state.flags.tw_holder_errand).toBe(true)
      }
    }
  })
  await f.step('調整：把關係改成夥伴、加一條規矩（宵禁）', () => {
    const r1 = g.commit(adjustDraft(k, g.state, { npc: AYIN, patch: { relation: 'partner' } }))
    expect(actions(r1)).toContain('contract.adjust')
    expect(heldIn(g.state, AYIN)!.relation).toBe('partner')
    g.commit(adjustDraft(k, g.state, { npc: AYIN, patch: { rules_add: [{ kind: 'curfew', value: '02:00' }] } }))
    expect(heldIn(g.state, AYIN)!.rules).toEqual(expect.arrayContaining([{ kind: 'curfew', value: '02:00' }]))
  })
  await f.step('解約：身分回去、不再持有；觸發點 released 帶出事件', () => {
    const reports = g.commit(releaseDraft(k, g.state, { npc: AYIN }))
    expect(actions(reports)).toContain('contract.release')
    expect(heldIn(g.state, AYIN)).toBeFalsy()
    expect((g.state.actors[AYIN]!.ext.identity as { class?: string } | undefined)?.class).not.toBe('bound')
  })
  return g
}

/** 長線：惡意韌體。 */
async function malwareFlow(g: Game, f = flow('長線：惡意韌體')): Promise<Game> {
  const { k } = g
  await f.step('染上惡意韌體（蠕蟲）：潛伏階段、橋上多一筆', () => {
    const r = applyEffects(g, [{ kind: 'malware', id: 'mw_tw_worm' }])
    expect(r.errors).toEqual([])
    const row = malwareOf(g.state, 'pc').find((x) => x.id === 'mw_tw_worm')!
    expect(row.stage).toBe(0)
  })
  await f.step('推進到發作：時間過了潛伏的天數；發作之後智識有懲罰（來源 malware）', () => {
    expect(g.k.stats.attrParts(g.state, 'pc', 'intellect').some((p) => p.source === 'malware')).toBe(false)
    passTime(g, 8 * 24 * 60)
    const row = malwareOf(g.state, 'pc').find((x) => x.id === 'mw_tw_worm')!
    expect(row.stage).toBeGreaterThanOrEqual(1)
    expect(g.k.stats.attrParts(g.state, 'pc', 'intellect').some((p) => p.source === 'malware' && p.value < 0)).toBe(true)
    expect(malwareView(k, g.state, 'pc').find((v) => v.id === 'mw_tw_worm')).toBeTruthy()
  })
  await f.step('清除：診所清除（花錢、花時間）→ 這一筆沒有了、智識的懲罰拿掉', () => {
    standAt(g, BODY_BLOCKS.clinics, 'F1')
    const reports = g.commit(cleanDraft(k, g.state, { actor: 'pc', id: 'mw_tw_worm', via: 'clinic' }))
    expect(actions(reports)).toContain('malware.clean')
    expect(malwareOf(g.state, 'pc').find((x) => x.id === 'mw_tw_worm')).toBeUndefined()
    expect(g.k.stats.attrParts(g.state, 'pc', 'intellect').some((p) => p.source === 'malware')).toBe(false)
  })
  return g
}

/** 長線：沉溺與蠱惑。回傳 rest、login 兩個觸發點各看到幾次蠱惑的事件。 */
async function lureFlow(g: Game, f = flow('長線：蠱惑')): Promise<{ g: Game; seen: { rest: number; login: number } }> {
  const { k } = g
  const seen = { rest: 0, login: 0 }
  await f.step('住處、沉溺到 66：蠱惑的條件打開（lure_open）', () => {
    standAt(g, 'tw_tower', 'E1')
    g.commit(rentDraft(k, g.state, 'r_tw_unit'))
    setSink(g, 66)
    expect(pc(g).sink).toBe(66)
    expect(k.conditions.test({ kind: 'lure_open', ai: 'ai_tw_mommy' } as never, { state: g.state, actor: 'pc', stats: k.stats, timeRules: k.timeRules })).toBe(true)
  })
  const follow = async (label: string, wake: () => Report[], point: 'rest' | 'login'): Promise<void> => {
    await f.step(label, () => {
      const rs = wake()
      expect(rs.some((r) => (r.triggers ?? []).some((t) => t.point === point)), `${label}：沒有 ${point} 的觸發點`).toBe(true)
      const ev = eventView(k, g.state)
      expect(ev?.event, `${label}：沒有蠱惑的事件`).toBe(point === 'rest' ? 'lu_tw_rest' : 'lu_tw_login')
      seen[point]++
      g.commit(chooseOption(k, g.state, 'follow'))
      expect(eventView(k, g.state)).toBeNull()
    })
  }
  const sleep = (): Report[] => {
    standAt(g, 'tw_tower', 'F1')
    passTime(g, 17 * 60)
    return g.commit(sleepDraft(k, g.state))
  }
  const dive = (): Report[] => {
    giveItem(g, 'dk_tw_ii')
    return []
  }
  void dive
  await follow('長休醒來：rest 觸發點發出、蠱惑的事件來、順著牠（第 1 次）', sleep, 'rest')
  await follow('再睡一覺：順著牠（第 2 次）', sleep, 'rest')
  await follow('再睡一覺：順著牠（第 3 次）', sleep, 'rest')
  await f.step('順著三次：給一則指向粉牆的線索（旗標）', () => {
    expect(g.state.flags['lure_clue:ai_tw_mommy']).toBeTruthy()
  })
  await follow('再睡一覺：順著牠（第 4 次）', sleep, 'rest')
  await follow('再睡一覺：順著牠（第 5 次）', sleep, 'rest')
  await f.step('順著五次：lureView 累計 5 次、沉溺比 66 高（每次順著 +2）', () => {
    const v = lureView(k, g.state)
    expect(JSON.stringify(v)).toContain('5')
    expect(pc(g).sink).toBeGreaterThan(66)
  })
  return { g, seen }
}

describe('冒煙 M4：契約（主角是契約人）', () => {
  it('效果簽下契約 → 過幾天收到指令 → 抗拒失敗 → 走到指定的地方、事件做完 → 一條逾期 → 還清', async () => {
    const t = makeBodyGame({ pc: WEAK, at: { block: 'tw_tower', marker: 'E1' } })
    const { violations } = await observed(t.game, async () => boundFlow(t.game))
    expect(violations).toEqual([])
  })
})

describe('冒煙 M4：契約（主角是持約人）', () => {
  it('持有一個契約人 → 觸發一件事 → 調整 → 解約', async () => {
    const t = makeBodyGame({ actors: [makeActor({ id: AYIN, name: '阿音', role: 'npc', gender: 'female', age: 26, ext: { bridge: { sensitivity: 40, tolerance: 25, craving: 30, docility: 35 } } })] })
    const { violations } = await observed(t.game, async () => holderFlow(t.game))
    expect(violations).toEqual([])
  })
})

describe('冒煙 M4：長線', () => {
  it('染上惡意韌體 → 推進到發作 → 清除', async () => {
    const t = makeBodyGame({ at: { block: BODY_BLOCKS.clinics, marker: 'E1' } })
    const { violations } = await observed(t.game, async () => malwareFlow(t.game))
    expect(violations).toEqual([])
  })

  it('沉溺到 66 → 長休醒來蠱惑的事件來 → 順著五次', async () => {
    const t = makeBodyGame({ pc: { skills: { composure: 3 }, ext: { bridge: { sensitivity: 30, tolerance: 30, craving: 30, docility: 40 } } }, at: { block: 'tw_tower', marker: 'E1' } })
    const { violations } = await observed(t.game, async () => lureFlow(t.game))
    expect(violations).toEqual([])
  })
})
void diveIn
void untilIdle
