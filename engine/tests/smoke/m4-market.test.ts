// 冒煙 M4・第五波：市集與工藝（dev/work/M4-smoke.md 第 3 點、dev/work/M4-plan.md「第五波」那一圈）。固定種子、AI 關閉。
//   未登錄零件  接一件報酬欄帶未登錄零件的 III 級委託 → 做完、結算 → Game.unregDeliver 交貨 → 組進一把槍 → 拆下來還是同一件 → 賣掉
//   訂做        委託台訂做一件、過三天取貨
//   學工藝      向 NPC 學義體學 0 → 2 級（歷練點沒動）
//   拍賣        週四預展看貨 → 週五進場 → 標到一件零件與一件義體、退出一件 → 結束
// 內容一律是 testkit 的 bodyWorld()；功能是全部；走的是真正的功能與真正的提交；主角的武器用 TEST_GEAR（假兵種一碰就倒，委託的戰鬥不是這一條要測的）。

import { describe, expect, it, vi } from 'vitest'
import type { Report } from '../../src'
import { UNREG_STACK_ID, toMinutes } from '../../src'
import { abilitiesOf, tutorBlock, tutorDraft, tutorOptions } from '../../src/features/abilities'
import { assembleDraft, learnDraft, salvageDraft } from '../../src/features/craft'
import { accept, board, go, jobOf } from '../../src/features/fixer'
import { actorOf as npcActorOf } from '../../src/features/npcs'
import { checkout } from '../../src/features/trade'
import { auctionRunOf, auctionView, bidDraft, bidOptions, catalogView, enterDraft as auctionEnter, inspectDraft, leaveDraft, memberOf } from '../../src/features/auction'
import { deliverBlock, orderDraft, pendingParts } from '../../src/features/unreg'
import type { Game } from '../../src/shell/game'
import {
  AUCTION_HOUSE, BODY_BLOCKS, HOLDER_NPC, M4_ACTION_PREFIXES, STRONG_PC, TUTOR_NPC, VAULT_FIXER, flow, giveItem, giveMoney, makeBodyGame, observed, passTime, passUntil, playStage, prefixProblems, roundTrip, standAt, stateHash,
} from '../../src/testkit'

vi.setConfig({ testTimeout: 120_000 })

const actions = (rs: Report[]): string[] => rs.map((r) => r.action ?? '')
const pc = (g: Game) => g.state.actors.pc!
const BRIDGE = { sensitivity: 30, tolerance: 30, craving: 30, docility: 30 }
const MARKET_PC = { ...STRONG_PC, skills: { ...STRONG_PC.skills, firearms: 3 }, ext: { bridge: BRIDGE } }
const unregStacks = (g: Game) => g.state.inventory.filter((s) => s.id === UNREG_STACK_ID)

const setup = (seed = 6): Game => makeBodyGame({ seed, noGear: false, pc: MARKET_PC, at: { block: 'tw_market', marker: 'E1' } }).game

/** 學工藝：向 NPC 學義體學 0 → 2 級，歷練點沒動。 */
async function teachFlow(g: Game, f = flow('市集：學工藝')): Promise<void> {
  const { k } = g
  await f.step('歷練點先放 5；站在市場、阿鉚在場：可以學義體學（最高 2 級）', () => {
    g.commit({ kind: 'system', action: 'test.xp', location: {}, party: [], timeline: [], changes: [{ op: 'actor.ext', id: 'pc', key: 'abilities', value: { xp: 5, learned: [], equipped: [], spent: {} } }] as never, outcome: { result: 'ok', summary: '測試給的歷練點。' } })
    giveMoney(g, 0, 0)
    expect(pc(g).skills.cyberware ?? 0).toBe(0)
    const o = tutorOptions(k, g.state, { npc: TUTOR_NPC })
    expect(o).toMatchObject([{ skill: 'cyberware', max: 2, ok: true }])
  })
  await f.step('一堂一堂上：0 → 1 → 2；每一堂都是 ability.tutor、花學費與時間；歷練點沒動；到 2 級為止再學被擋', () => {
    const cash0 = g.state.money.cred + g.state.money.cash
    const xp0 = abilitiesOf(g.state, 'pc').xp
    let lessons = 0
    const levels: number[] = []
    for (; lessons < 12 && (pc(g).skills.cyberware ?? 0) < 2; lessons++) {
      const reports = g.commit(tutorDraft(k, g.state, { npc: TUTOR_NPC, skill: 'cyberware' }))
      expect(actions(reports)[0]).toBe('ability.tutor')
      levels.push(pc(g).skills.cyberware ?? 0)
    }
    // 一級要兩堂、二級再要幾堂：中間經過 1 級
    expect(levels).toContain(1)
    expect(lessons).toBeGreaterThanOrEqual(4)
    expect(pc(g).skills.cyberware).toBe(2)
    expect(abilitiesOf(g.state, 'pc').xp).toBe(xp0)
    expect(xp0).toBe(5)
    expect(g.state.money.cred + g.state.money.cash).toBeLessThan(cash0)
    expect(tutorBlock(k, g.state, { npc: TUTOR_NPC, skill: 'cyberware' })).toBeTruthy()
  })
}

/** 訂做：委託台訂做一件槍管（II 級）、付現金、三天後取貨。 */
async function orderFlow(g: Game, f = flow('市集：訂做'), checkpoint: (label: string) => void = () => undefined): Promise<void> {
  const { k } = g
  await f.step('站在同人攤的委託台：訂做一件機械的槍管（II 級）、指定方向「傷害」；付現金、多一筆等著交貨的訂單', () => {
    standAt(g, BODY_BLOCKS.shops, 'F2')
    const cash0 = g.state.money.cash
    const reports = g.commit(orderDraft(k, g.state, { type: 'barrel', grade: 2, want: ['barrel_damage'] }))
    expect(actions(reports)).toEqual(['unreg.order'])
    expect(g.state.money.cash).toBe(cash0 - 900)
    expect(pendingParts(g.state)).toHaveLength(1)
    expect(pendingParts(g.state)[0]).toMatchObject({ hold: 'order', frame: { type: 'barrel', grade: 2 } })
    checkpoint('after-order')
  })
  const id = pendingParts(g.state)[0]!.id
  await f.step('三天內取貨被擋（還要等）；過三天回到委託台：Game.unregDeliver 交貨，零件進背包（內嵌的、帶名字與怪癖）', async () => {
    expect(deliverBlock(k, g.state, id)).toMatch(/還要等/)
    passTime(g, 3 * 24 * 60)
    expect(deliverBlock(k, g.state, id)).toBeNull()
    const r = await g.unregDeliver(id)
    expect(r.status).toBe('applied')
    const part = unregStacks(g).find((s) => (s.data as { uid?: string })?.uid === id)!
    expect(part).toBeTruthy()
    expect(JSON.stringify(part.data)).toContain('短舌')
    expect(pendingParts(g.state)).toHaveLength(0)
  })
}

/** 委託的報酬：III 級委託（報酬欄多一件未登錄零件）→ 做完、結算 → 交貨 → 組進槍 → 拆下來還是同一件 → 賣掉。 */
async function rewardFlow(g: Game, f = flow('市集：委託的報酬零件'), checkpoint: (label: string) => void = () => undefined): Promise<void> {
  const { k } = g
  let jobId = ''
  await f.step('站在金庫街、街頭信譽 70：中間人桌上有 III 級、報酬欄帶「未登錄零件（槍管，III級）」的委託；接下它（付現金）', () => {
    g.commit({ kind: 'system', action: 'test.rep', location: {}, party: [], timeline: [], changes: [{ op: 'meter', kind: 'rep', key: '_', delta: 70 }] as never, outcome: { result: 'ok', summary: '測試給的街頭信譽。' } })
    standAt(g, BODY_BLOCKS.vault, 'E1')
    const row = board(k, g.state, VAULT_FIXER).offers.find((o) => o.offer.commission.grade === 3 && o.offer.extra)!
    expect(row).toBeTruthy()
    expect(row.offer.extra!.label).toContain('未登錄零件')
    const reports = g.commit(accept(k, g.state, { id: row.id, fixer: VAULT_FIXER }, { pay: 'cash' }))
    expect(actions(reports)).toContain('fixer.accept')
    jobId = jobOf(g.state, row.id)!.id
    expect(jobOf(g.state, jobId)!.terms?.extra).toBeTruthy()
    checkpoint('after-accept')
  })
  await f.step('出發、打完三個階段（強攻）：做完入帳；報酬多一筆等著交貨的零件（source: reward）、現金只有原本的六成', async () => {
    g.commit(go(k, g.state, jobId))
    for (let i = 0; i < 3; i++) await playStage(g)
    expect(jobOf(g.state, jobId)!.status).toBe('done')
    const p = pendingParts(g.state).filter((x) => x.source === 'reward')
    expect(p).toHaveLength(1)
    expect(p[0]!.frame).toMatchObject({ type: 'barrel', grade: 3 })
    checkpoint('after-payout')
  })
  let partUid = ''
  await f.step('Game.unregDeliver 交貨：零件（III 級槍管）進背包；等著交貨的那一筆沒了', async () => {
    const id = pendingParts(g.state).find((x) => x.source === 'reward')!.id
    const r = await g.unregDeliver(id)
    expect(r.status).toBe('applied')
    const part = unregStacks(g).find((s) => (s.data as { uid?: string })?.uid === id)!
    expect(part).toBeTruthy()
    partUid = id
    expect(pendingParts(g.state).filter((x) => x.source === 'reward')).toHaveLength(0)
  })
  let gunUid = ''
  let before: unknown
  await f.step('組進一把槍：學會手槍的設計圖、零件放進槍管的位置（動手的是同人社團，超規一級）；成品帶著內嵌的零件', () => {
    standAt(g, BODY_BLOCKS.shops, 'F2')
    giveItem(g, 'it_tw_lic')
    giveItem(g, 'pt_tw_action')
    g.commit(learnDraft(k, g.state, { item: 'it_tw_lic' }))
    before = structuredClone(unregStacks(g).find((s) => (s.data as { uid?: string })?.uid === partUid)!.data)
    const reports = g.commit(assembleDraft(k, g.state, { blueprint: 'bp_tw_pistol', parts: { barrel: partUid, action: 'pt_tw_action' }, maker: 'doujin' }))
    expect(actions(reports)).toContain('craft.assemble')
    expect(unregStacks(g).find((s) => (s.data as { uid?: string })?.uid === partUid)).toBeUndefined()
    const guns = g.state.inventory.filter((s) => s.id === 'bp_tw_pistol' && (s.data as { uid?: string })?.uid)
    gunUid = String((guns[guns.length - 1]!.data as { uid: string }).uid)
    expect(JSON.stringify(guns[guns.length - 1]!.data)).toContain(partUid)
    checkpoint('after-assemble')
  })
  await f.step('拆下來還是同一件：拆解成品，內嵌的零件整筆回到背包、逐欄和交貨時一樣', () => {
    const reports = g.commit(salvageDraft(k, g.state, { uid: gunUid }))
    expect(actions(reports)).toContain('craft.salvage')
    const back = unregStacks(g).find((s) => (s.data as { uid?: string })?.uid === partUid)
    expect(back, '拆下來沒有拿回那一件未登錄零件').toBeTruthy()
    expect(back!.data).toEqual(before)
  })
  await f.step('賣掉：槍店收購（帶 uid 指名那一件）；現金增加、背包少一件', () => {
    standAt(g, BODY_BLOCKS.shops, 'F1')
    const cash0 = g.state.money.cash + g.state.money.cred
    const reports = g.commit(checkout(k, g.state, 's_tw_gun', { sell: [{ item: UNREG_STACK_ID, qty: 1, uid: partUid }], pay: 'cred' }))
    expect(actions(reports)).toContain('trade.checkout')
    expect(g.state.money.cash + g.state.money.cred).toBeGreaterThan(cash0)
    expect(unregStacks(g).find((s) => (s.data as { uid?: string })?.uid === partUid)).toBeUndefined()
    expect(prefixProblems(g, M4_ACTION_PREFIXES)).toEqual([])
  })
  void toMinutes
}

/** 拍賣：週四預展看貨 → 週五進場 → 標到一件零件與一件義體、退出一件 → 結束。 */
async function auctionFlow(g: Game, f = flow('市集：拍賣')): Promise<void> {
  const { k } = g
  await f.step('站在拍賣行；玩家是白槌的會員（玻璃岸的好感 40）', () => {
    standAt(g, BODY_BLOCKS.hall, 'F1')
    g.commit({ kind: 'system', action: 'test.favor', location: {}, party: [], timeline: [], changes: [{ op: 'meter', kind: 'favor', key: 'f_tw_gallery', set: 40 }] as never, outcome: { result: 'ok', summary: '測試給的好感。' } })
    expect(memberOf(k, g.state, AUCTION_HOUSE)).toBeTruthy()
  })
  await f.step('週四預展：阿音要先是場上的角色（見過面），她的契約才交得出去、目錄才抽得到；目錄出來了（八件，含那一份契約）、看兩件貨（零件與義體）', () => {
    // 交不出去的拍品不抽（M4 收尾修正批 必修 2）：阿音沒見過面時目錄只有七件、沒有契約
    passUntil(g, { day: 10, hour: 14 })
    const without = catalogView(k, g.state, AUCTION_HOUSE)!
    if (!without.open) throw new Error('目錄還沒出來')
    expect(without.lots).toHaveLength(7)
    expect(without.lots.some((l) => l.kind === 'contract')).toBe(false)
    g.commit({ kind: 'system', action: 'test.npc', location: {}, party: [], timeline: [], changes: npcActorOf(k, g.state, HOLDER_NPC), outcome: { result: 'ok', summary: '阿音在場上。' } })
    const cat = catalogView(k, g.state, AUCTION_HOUSE)!
    if (!cat.open) throw new Error('目錄還沒出來')
    expect(cat.lots).toHaveLength(8)
    expect(cat.lots.some((l) => l.kind === 'contract')).toBe(true)
    const nowM = toMinutes(g.state.time)
    expect(cat.session.preview!.from).toBeLessThanOrEqual(nowM)
    expect(cat.session.preview!.to).toBeGreaterThanOrEqual(nowM)
    for (const kind of ['part', 'cyberware']) {
      const i = cat.lots.findIndex((l) => l.kind === kind)
      expect(i).toBeGreaterThanOrEqual(0)
      const reports = g.commit(inspectDraft(k, g.state, { house: AUCTION_HOUSE, lot: i }))
      expect(actions(reports)).toContain('auction.inspect')
    }
  })
  let cash0 = 0
  await f.step('週五進場（黃金時段、付現金；帶了一萬現金）：開一場拍賣', () => {
    passUntil(g, { day: 11, hour: 19, minute: 10 })
    giveMoney(g, 0, 10000)
    cash0 = g.state.money.cash
    const reports = g.commit(auctionEnter(k, g.state, { house: AUCTION_HOUSE, pay: 'cash' }))
    expect(actions(reports)).toContain('auction.enter')
    expect(auctionRunOf(g.state)).toBeTruthy()
    expect(g.k.activity.active(g.state).map((a) => a.kind)).toContain('auction')
  })
  const wonKinds: string[] = []
  const folded: string[] = []
  await f.step('一件一件喊：第一件零件與第一件義體加價標下（最高的人是自己就等）、其餘的退出；每一件不超過 8 回合', () => {
    const lotKind = new Map<number, string>()
    for (let i = 0; i < 400 && auctionRunOf(g.state); i++) {
      const v = auctionView(k, g.state)
      if (!v) break
      const o = bidOptions(k, g.state)!
      lotKind.set(v.lot_no, v.lot.kind)
      expect(v.round).toBeLessThanOrEqual(8)
      const want = (v.lot.kind === 'part' || v.lot.kind === 'cyberware') && !wonKinds.includes(v.lot.kind)
      let input: Parameters<typeof bidDraft>[2]
      if (want) {
        const up = [...o.raise].reverse().find((r) => r.can)
        input = v.holder.id === 'pc' ? { act: 'wait' } : up ? { act: 'raise' as const, steps: up.steps! } : o.wait.can ? { act: 'wait' } : { act: 'fold' }
      } else if (o.fold.can) {
        input = { act: 'fold' }
        if (!folded.includes(String(v.lot_no))) folded.push(String(v.lot_no))
      } else input = { act: 'wait' }
      g.commit(bidDraft(k, g.state, input))
      const after = auctionView(k, g.state)
      // 標到了：這一件的號碼在 won 裡（最後一件喊完整場就收了，看報告）
      const gotIt = after ? after.won.some((w) => w.lot === v.lot.index) : g.state.reports.slice(-3).some((r) => r.action?.startsWith('auction.') && r.outcome.summary.includes('由你以'))
      if (gotIt && !wonKinds.includes(v.lot.kind)) wonKinds.push(v.lot.kind)
    }
  })
  await f.step('結算：整場喊完就收；標到的東西進背包（一件零件與一件義體成品）、玩家付的總數不超過進場時的現金、有退出的一件', () => {
    expect(auctionRunOf(g.state)).toBeFalsy()
    expect(g.k.activity.active(g.state).map((a) => a.kind)).not.toContain('auction')
    expect(wonKinds.sort()).toEqual(['cyberware', 'part'])
    expect(g.state.inventory.some((s) => s.id.startsWith('pt_tw_'))).toBe(true)
    expect(g.state.inventory.some((s) => s.id.startsWith('bp_tw_') && (s.data as { uid?: string } | undefined)?.uid)).toBe(true)
    const spent = cash0 - g.state.money.cash
    expect(spent).toBeGreaterThan(0)
    expect(spent).toBeLessThanOrEqual(cash0)
    expect(folded.length).toBeGreaterThan(0)
    expect(g.state.reports.some((r) => r.action === 'auction.close')).toBe(true)
  })
  void leaveDraft
}

describe('冒煙 M4：市集與工藝（存讀）', () => {
  it('訂做之後、報酬的零件組進槍之後各存讀一次，接著走；最後的狀態和不中斷的一遍逐欄相同', async () => {
    const plain = setup()
    await orderFlow(plain)
    await rewardFlow(plain)
    const saved = setup()
    const { violations } = await observed(saved, async () => {
      await orderFlow(saved, flow('市集訂做（存讀）'), (label) => roundTrip(saved, label))
      await rewardFlow(saved, flow('市集報酬（存讀）'), (label) => roundTrip(saved, label))
    })
    expect(violations).toEqual([])
    expect(stateHash(saved.state)).toBe(stateHash(plain.state))
  })
})

describe('冒煙 M4：市集與工藝', () => {
  it('向 NPC 學義體學 0 → 2 級（歷練點沒動）', async () => {
    const g = setup()
    const { violations } = await observed(g, async () => teachFlow(g))
    expect(violations).toEqual([])
  })

  it('委託台訂做一件、過三天取貨', async () => {
    const g = setup()
    const { violations } = await observed(g, async () => orderFlow(g))
    expect(violations).toEqual([])
  })

  it('週四預展看貨 → 週五進場 → 標到一件零件與一件義體、退出一件 → 結束', async () => {
    const g = makeBodyGame({ seed: 6, pc: MARKET_PC, at: { block: BODY_BLOCKS.hall, marker: 'F1' } }).game
    const { violations } = await observed(g, async () => auctionFlow(g))
    expect(violations).toEqual([])
  })

  it('接一件報酬欄帶未登錄零件的 III 級委託 → 做完、結算 → 交貨 → 組進槍 → 拆下來還是同一件 → 賣掉', async () => {
    const g = setup()
    const { violations } = await observed(g, async () => rewardFlow(g))
    expect(violations).toEqual([])
  })
})
