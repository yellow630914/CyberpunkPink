// 冒煙 M4・性質測試（dev/work/M4-smoke.md 第 6 點；fast-check，固定種子、跑的次數不多）。
//   沉溺的下限  隨機的一串「裝、拆、吃藥、過幾天、過週一」之後，沉溺不低於 sink_floor；下限不是負的
//   簾後館      任何種子生成的四幕都合格（四層、每層有入口與閘門、守閘門的敵人挑得到）
//   未登錄零件  任何種子的框架 frameProblems 是空的、裝進成品再拆出來逐欄相同
//   拍賣        任何種子與出價方式，一場拍賣每一件不超過 8 回合、玩家付的總數不超過進場時身上的現金
// 內容一律是 testkit 的 bodyWorld()；功能是全部。

import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import { ActionBlocked, UNREG_STACK_ID, toMinutes } from '../../src'
import { assembleDraft, learnDraft, salvageDraft } from '../../src/features/craft'
import { auctionRunOf, auctionView, bidDraft, bidOptions, enterDraft as auctionEnter } from '../../src/features/auction'
import { installBlock, installDraft, removeBlock, removeDraft, cyberOf } from '../../src/features/cyberware'
import { enterDraft as curtainEnterDraft } from '../../src/features/curtain'
import { useDraft as drugUse } from '../../src/features/drugs'
import { netExt, readRun } from '../../src/features/netrun'
import { frameOf, frameProblems, orderDraft, pendingParts } from '../../src/features/unreg'
import type { Game } from '../../src/shell/game'
import {
  AUCTION_HOUSE, BODY_BLOCKS, CURTAIN_NIGHTS, STRONG_PC, curtainPrelude, giveItem, giveMoney, giveProduct, makeBodyGame, makeCurtainGame, observed, passTime, passUntil, sceneCast, standAt,
} from '../../src/testkit'

const RUNS = { numRuns: 12, seed: 4242 }

// ---------------------------------------------------------------------------------------------------------------------
// 沉溺的下限
// ---------------------------------------------------------------------------------------------------------------------

type Op = { k: 'install' } | { k: 'remove' } | { k: 'drug' } | { k: 'pass'; days: number } | { k: 'monday' }
const opArb: fc.Arbitrary<Op> = fc.oneof(
  fc.constant<Op>({ k: 'install' }), fc.constant<Op>({ k: 'remove' }), fc.constant<Op>({ k: 'drug' }), fc.constant<Op>({ k: 'monday' }),
  fc.integer({ min: 1, max: 9 }).map((days): Op => ({ k: 'pass', days })),
)

const PRODUCTS: Array<{ bp: string; uid: string; side?: 'l' | 'r' }> = [{ bp: 'bp_tw_arm', uid: 'P1', side: 'l' }, { bp: 'bp_tw_accel', uid: 'P2' }, { bp: 'bp_tw_plating', uid: 'P3' }]

function applyOp(g: Game, op: Op, queue: string[]): void {
  const { k } = g
  const pc = g.state.actors.pc!
  try {
    if (op.k === 'install') {
      const next = PRODUCTS.find((p) => queue.includes(p.uid))
      if (!next || installBlock(k, g.state, { actor: 'pc', uid: next.uid, via: 'clinic', ...(next.side ? { side: next.side } : {}) })) return
      g.commit(installDraft(k, g.state, { actor: 'pc', uid: next.uid, via: 'clinic', ...(next.side ? { side: next.side } : {}) }))
      queue.splice(queue.indexOf(next.uid), 1)
    } else if (op.k === 'remove') {
      const piece = cyberOf(g.state, 'pc').find((p) => PRODUCTS.some((x) => x.uid === p.uid))
      if (!piece || removeBlock(k, g.state, { actor: 'pc', uid: piece.uid, via: 'clinic' })) return
      g.commit(removeDraft(k, g.state, { actor: 'pc', uid: piece.uid, via: 'clinic' }))
    } else if (op.k === 'drug') {
      giveItem(g, 'it_tw_cloud', 1)
      g.commit(drugUse(k, g.state, { actor: 'pc', item: 'it_tw_cloud' }))
    } else if (op.k === 'pass') passTime(g, op.days * 1440)
    else {
      const now = g.state.time
      const toMonday = (7 - ((now.day - 1 + 7 - 6) % 7)) % 7 || 7
      passUntil(g, { day: now.day + toMonday, hour: 6, minute: 5 })
    }
  } catch (e) {
    if (!(e instanceof ActionBlocked)) throw e
  }
  void pc
}

describe('冒煙 M4：性質測試', () => {
  it('隨機的一串裝、拆、吃藥、過幾天、過週一：沉溺不低於下限、下限不是負的、沒有違反不變式', async () => {
    await fc.assert(
      fc.asyncProperty(fc.array(opArb, { minLength: 3, maxLength: 9 }), fc.integer({ min: 1, max: 50 }), async (ops, seed) => {
        const g = makeBodyGame({ seed, at: { block: BODY_BLOCKS.clinics, marker: 'F1' } }).game
        for (const p of PRODUCTS) giveProduct(g, p.bp, p.uid)
        const queue = PRODUCTS.map((p) => p.uid)
        const { violations } = await observed(g, async () => {
          for (const op of ops) {
            applyOp(g, op, queue)
            const floor = g.k.stats.stat(g.state, 'pc', 'sink_floor')
            expect(floor).toBeGreaterThanOrEqual(0)
            expect(g.state.actors.pc!.sink, `做完 ${JSON.stringify(op)} 之後`).toBeGreaterThanOrEqual(floor)
          }
        })
        expect(violations).toEqual([])
      }),
      RUNS,
    )
  })

  it('簾後館：任何種子生成的四幕都合格（四層、每一層有入口與閘門、報名成立）', async () => {
    await fc.assert(
      fc.asyncProperty(fc.integer({ min: 1, max: 100000 }), fc.constantFrom(CURTAIN_NIGHTS.a, CURTAIN_NIGHTS.b), async (seed, night) => {
        const g = makeCurtainGame({ seed: 3, actors: sceneCast('ann') }).game
        curtainPrelude(g)
        g.commit(curtainEnterDraft(g.k, g.state, { party: ['pc'], night, seed }))
        const run = readRun(g.state)!
        expect(run.layers).toHaveLength(4)
        const net = netExt(g.state, run.map)!
        const sheets = Object.keys(net.graph)
        expect(sheets).toHaveLength(4)
        for (const sheet of sheets) {
          const kinds = net.graph[sheet]!.nodes.map((n) => n.kind)
          expect(kinds, `${sheet} 沒有入口`).toContain('entry')
          expect(kinds.some((x) => x === 'net_gate' || x === 'exit'), `${sheet} 沒有閘門`).toBe(true)
          expect(kinds, `${sheet} 沒有守閘門的遭遇`).toContain('net_foe')
        }
      }),
      { numRuns: 10, seed: 4242 },
    )
  })

  it('未登錄零件：任何種子的框架 frameProblems 是空的；訂做一件槍管、組進成品、拆出來逐欄相同', async () => {
    await fc.assert(
      fc.asyncProperty(fc.integer({ min: 1, max: 100000 }), fc.constantFrom('barrel', 'plate', 'skin'), fc.integer({ min: 1, max: 4 }), fc.boolean(), fc.integer({ min: 1, max: 2 }), async (seed, type, grade, bio, gunGrade) => {
        const g = makeBodyGame({ seed, noGear: false, pc: { ...STRONG_PC, ext: { bridge: { sensitivity: 30, tolerance: 30, craving: 30, docility: 30 } } }, at: { block: BODY_BLOCKS.shops, marker: 'F2' } }).game
        const f = frameOf(g.k, g.state, { type, grade, seq: 1, source: 'order', ...(bio && type !== 'barrel' ? { material: 'bio' } : {}) })
        expect(frameProblems(g.k, f, 'order')).toEqual([])
        // 訂做一件槍管（I～II 級，現金夠）→ 三天後交貨 → 組進手槍（同人社團）→ 拆出來
        giveMoney(g, 0, 6000)
        g.commit(orderDraft(g.k, g.state, { type: 'barrel', grade: gunGrade }))
        passTime(g, 3 * 1440)
        const id = pendingParts(g.state)[0]!.id
        await g.unregDeliver(id)
        const stack = g.state.inventory.find((x) => x.id === UNREG_STACK_ID && (x.data as { uid?: string })?.uid === id)!
        const before = structuredClone(stack.data)
        giveItem(g, 'it_tw_lic')
        giveItem(g, 'pt_tw_action')
        g.commit(learnDraft(g.k, g.state, { item: 'it_tw_lic' }))
        g.commit(assembleDraft(g.k, g.state, { blueprint: 'bp_tw_pistol', parts: { barrel: id, action: 'pt_tw_action' }, maker: 'doujin' }))
        const guns = g.state.inventory.filter((x) => x.id === 'bp_tw_pistol' && (x.data as { uid?: string })?.uid)
        g.commit(salvageDraft(g.k, g.state, { uid: String((guns[guns.length - 1]!.data as { uid: string }).uid) }))
        const back = g.state.inventory.find((x) => x.id === UNREG_STACK_ID && (x.data as { uid?: string })?.uid === id)
        expect(back?.data).toEqual(before)
      }),
      { numRuns: 8, seed: 4242 },
    )
  })

  it('拍賣：任何種子與出價方式，每一件不超過 8 回合、玩家付的總數不超過進場時的現金、整場收乾淨', async () => {
    await fc.assert(
      fc.asyncProperty(fc.integer({ min: 1, max: 100000 }), fc.array(fc.integer({ min: 0, max: 3 }), { minLength: 30, maxLength: 60 }), async (seed, plan) => {
        const g = makeBodyGame({ seed, at: { block: BODY_BLOCKS.hall, marker: 'F1' } }).game
        g.commit({ kind: 'system', action: 'test.favor', location: {}, party: [], timeline: [], changes: [{ op: 'meter', kind: 'favor', key: 'f_tw_gallery', set: 40 }] as never, outcome: { result: 'ok', summary: '測試。' } })
        passUntil(g, { day: 11, hour: 19, minute: 10 })
        giveMoney(g, 0, 3000)
        const cash0 = g.state.money.cash
        g.commit(auctionEnter(g.k, g.state, { house: AUCTION_HOUSE, pay: 'cash' }))
        for (let i = 0; i < 400 && auctionRunOf(g.state); i++) {
          const v = auctionView(g.k, g.state)!
          expect(v.round).toBeLessThanOrEqual(8)
          const o = bidOptions(g.k, g.state)!
          const c = plan[i % plan.length]!
          const raise = o.raise.filter((r) => r.can)
          const input = c === 0 && raise[0] ? { act: 'raise' as const, steps: raise[0].steps! } : c === 1 && raise.length > 0 ? { act: 'raise' as const, steps: raise[raise.length - 1]!.steps! } : c === 2 && o.fold.can ? { act: 'fold' as const } : o.wait.can ? { act: 'wait' as const } : { act: 'fold' as const }
          g.commit(bidDraft(g.k, g.state, input))
        }
        expect(auctionRunOf(g.state)).toBeFalsy()
        expect(g.state.money.cash).toBeGreaterThanOrEqual(0)
        expect(cash0 - g.state.money.cash).toBeLessThanOrEqual(cash0)
      }),
      { numRuns: 10, seed: 4242 },
    )
  })
})
void toMinutes
void standAt
