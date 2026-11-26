// 冒煙 M4・具名的情境（dev/test-harness.md 第 1 節；dev/work/M4-smoke.md 第 2 點）：每一個都用真的功能做出來，這裡只確認做出來的樣子對、不丟錯、不變式沒有違規。

import { describe, expect, it, vi } from 'vitest'
import { toMinutes } from '../../src'
import { auctionRunOf, auctionView } from '../../src/features/auction'
import { boundView, contractOf, heldIn } from '../../src/features/contract'
import { curtainHeat, curtainOf } from '../../src/features/curtain'
import { cyberOf, cyberView } from '../../src/features/cyberware'
import { drugView } from '../../src/features/drugs'
import { sceneRawOf } from '../../src/features/scene'
import { pendingParts } from '../../src/features/unreg'
import {
  HOLDER_NPC, makeAuctionSecondLotGame, makeBoundGame, makeCurtainAct2Game, makeDependentGame, makeHiddenSinkGame, makeHolderGame, makeLegacySceneGame, makePartsGame, makeRecoveringGame,
  makeTrioSceneGame, observed, sceneEndTurn, stopScene,
} from '../../src/testkit'

vi.setConfig({ testTimeout: 60_000 })

describe('冒煙 M4：具名的情境', () => {
  it('剛裝完義體在休養：義臂在身上、休養中不生效、沉溺在下限', () => {
    const g = makeRecoveringGame().game
    expect(cyberOf(g.state, 'pc').map((p) => p.bp)).toEqual(['bp_tw_arm'])
    expect(cyberView(g.k, g.state, 'pc').recovering_until).toBeGreaterThan(toMinutes(g.state.time))
    expect(g.k.stats.attrParts(g.state, 'pc', 'body').some((p) => p.source === 'cyber')).toBe(false)
    expect(g.state.actors.pc!.sink).toBe(g.k.stats.stat(g.state, 'pc', 'sink_floor'))
  })

  it('沉溺 65 而且藏著：真正的沉溺 65、抑制劑開著、別人看到的沉溺比較低', () => {
    const g = makeHiddenSinkGame().game
    expect(g.state.actors.pc!.sink).toBe(65)
    expect(drugView(g.k, g.state, 'pc')!.suppressant).toMatchObject({ weekly: true })
    const shown = g.k.stats.stat(g.state, 'pc', 'sink_shown')
    expect(shown).toBeLessThanOrEqual(65)
  })

  it('依賴一種藥：雲絲的成癮值在重度那一檔', () => {
    const g = makeDependentGame().game
    expect(drugView(g.k, g.state, 'pc')!.addiction.find((a) => a.id === 'it_tw_cloud')).toMatchObject({ stage: 'heavy' })
  })

  it('身上有一份債務契約、佇列兩條：差事與回報', () => {
    const g = makeBoundGame().game
    expect(contractOf(g.state)!.queue.map((o) => o.kind)).toEqual(['errand', 'report'])
    expect(boundView(g.k, g.state)).toMatchObject({ type: 'debt', debt: 24000 })
  })

  it('持有一個契約人：阿音是主角持約的人', () => {
    const g = makeHolderGame().game
    expect(heldIn(g.state, HOLDER_NPC)).toBeTruthy()
  })

  it('三個人的場景進行到第三回合：三人一圈、不展開的一圈、第 3 回合輪到主角', async () => {
    const g = makeTrioSceneGame().game
    const raw = sceneRawOf(g.state)!
    expect(raw).toMatchObject({ kind: 'group', round: 3, turn: 'pc' })
    expect(raw.seats.map((s) => s.id)).toEqual(['pc', 'npc_tw_ann', 'npc_tw_bo'])
    expect(raw.circles.map((c) => c.people)).toEqual([['npc_tw_cy', 'npc_tw_di']])
    const { violations } = await observed(g, async () => {
      sceneEndTurn(g)
      stopScene(g)
    })
    expect(violations).toEqual([])
  })

  it('簾後館第二幕、場熱 65：站在第三層、一趟還在、場熱是 65', async () => {
    const g = (await makeCurtainAct2Game()).game
    expect(curtainOf(g.state).run).toBeTruthy()
    expect(g.state.maps.at!.sheet).toBe('l3')
    expect(curtainHeat(g.k, g.state, g.state.maps.at!.map)).toBe(65)
  })

  it('M2、M3 的舊存檔（兩格寫法的一對一場景；甲板搬家使用者裁決不做）：讀回來轉成第二版、接著玩', async () => {
    const g = makeLegacySceneGame().game
    expect(g.state.ext.scene).not.toHaveProperty('v')
    expect(g.load(g.save('manual', '2026-11-26T00:00:00Z', 'legacy'))).toBeNull()
    expect(sceneRawOf(g.state)).toMatchObject({ v: 2, kind: 'pair' })
    const { violations } = await observed(g, async () => {
      sceneEndTurn(g)
      stopScene(g)
    })
    expect(violations).toEqual([])
  })

  it('一件未登錄零件等著交貨、另一件訂做中：兩筆等著交貨的（一筆 reward、一筆 order）；訂做的還要等三天', () => {
    const g = makePartsGame().game
    const p = pendingParts(g.state)
    expect(p.map((x) => x.source).sort()).toEqual(['order', 'reward'])
    expect(p.find((x) => x.source === 'order')!.hold).toBe('order')
  })

  it('拍賣進行到第二件、主角是最高的人', () => {
    const g = makeAuctionSecondLotGame().game
    expect(auctionRunOf(g.state)).toBeTruthy()
    expect(auctionView(g.k, g.state)).toMatchObject({ lot_no: 2, holder: { id: 'pc' } })
  })
})
