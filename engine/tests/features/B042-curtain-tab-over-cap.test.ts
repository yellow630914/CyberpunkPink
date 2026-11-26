// B042（M4 探針，cpp-tester-whitebox）→ M4-fix-2 修正，使用者 2026-11-26 裁決 1：落幕時記帳會讓欠款超過上限（保證金的兩倍），「記帳」灰掉，只能付清或簽檔期。
// 規格：CYBERSPACE 8.8 節「記帳：欠著，每週 10%，列進每週帳單；欠款上限是保證金的兩倍，欠到上限就不能再報名，直到還清」。
// 以前上限只是報名的閘門（enterBlocks：owed >= cap 擋下）；選「記帳」時直接把設備費與違約金加進欠款。欠 590 的人再記 150 變 740。
// 重現：engine/tests/features/fixtures/B042-curtain-tab-over-cap.json。dev/bugs/B042-curtain-tab-over-cap.md。

import { readFileSync } from 'node:fs'
import { describe, expect, it, vi } from 'vitest'
import { ActionBlocked } from '../../src'
import { acceptDefeat } from '../../src/features/defeat'
import { accountView, curtainOf, fallView, pathsOf, replayDraft, settleBlock, settleDraft } from '../../src/features/curtain'
import { CURTAIN_NIGHTS, curtainEnter, curtainPrelude, makeCurtainGame, netMarkers, netUse, playCurtainRun, sceneCast, standBeside, stopScene } from '../../src/testkit'

vi.setConfig({ testTimeout: 120_000 })
const fx = JSON.parse(readFileSync(new URL('./fixtures/B042-curtain-tab-over-cap.json', import.meta.url), 'utf8')) as { seed: number; owed_before: number }

/** 報名、打到第二幕投降、接受結果、補演停下：停在「選一條路」。散座保證金 300：上限 600、設備費與違約金 150。 */
async function toChoose(owed: number) {
  const g = makeCurtainGame({ seed: fx.seed, actors: sceneCast('ann') }).game
  const { k } = g
  curtainPrelude(g)
  ;(g.state.ext.curtain as { tab?: { owed: number; since: number } }).tab = { owed, since: 0 }
  curtainEnter(g, CURTAIN_NIGHTS.b)
  await playCurtainRun(g, { stopAfterLayer: 2 })
  const foe = netMarkers(g).find((m) => m.mark === 'f')!
  await standBeside(g, foe.id)
  netUse(g, 'fight', foe.id)
  for (let i = 0; i < 40 && g.battleOptions()?.waiting === 'ai'; i++) g.battleNext()
  g.battleAct({ action: 'net_surrender' })
  await g.finishBattle()
  g.commit(acceptDefeat(k, g.state))
  g.commit(replayDraft(k, g.state))
  stopScene(g)
  return g
}

describe('B042：記帳的欠款不超過保證金的兩倍（超過的話「記帳」灰掉）', () => {
  it('欠款 590（上限 600）：記帳會到 740，這一條路灰掉並寫原因；付清與簽檔期照常；硬選記帳丟 ActionBlocked，欠款不變', async () => {
    const g = await toChoose(fx.owed_before)
    const { k } = g
    const why = settleBlock(k, g.state, 'tab')
    expect(why).toContain('上限')
    expect(why).toContain('590')
    expect(why).toContain('740')
    const paths = pathsOf(k, g.state)
    const tab = paths.find((p) => p.id === 'tab')!
    expect(tab.can).toBe(false)
    expect(tab.why).toBe(why)
    expect(paths.find((p) => p.id === 'pay')!.can).toBe(true)
    expect(settleBlock(k, g.state, 'gig')).toBeNull()
    expect(fallView(k, g.state)!.paths.find((p) => p.id === 'tab')!.can).toBe(false)
    expect(() => settleDraft(k, g.state, { how: 'tab' })).toThrow(ActionBlocked)
    expect(curtainOf(g.state).tab?.owed).toBe(fx.owed_before)
    // 付清這條路照走：欠款不動
    g.commit(settleDraft(k, g.state, { how: 'pay' }))
    expect(curtainOf(g.state).tab?.owed).toBe(fx.owed_before)
    const a = accountView(k, g.state).tab!
    expect(a.owed).toBeLessThanOrEqual(a.cap)
  })

  it('剛好到上限（450 + 150 = 600）可以記帳，欠款停在上限；451 就不行', async () => {
    const at = await toChoose(450)
    expect(settleBlock(at.k, at.state, 'tab')).toBeNull()
    at.commit(settleDraft(at.k, at.state, { how: 'tab' }))
    const tab = accountView(at.k, at.state).tab!
    expect(tab.owed).toBe(600)
    expect(tab.owed).toBeLessThanOrEqual(tab.cap)
    const over = await toChoose(451)
    expect(settleBlock(over.k, over.state, 'tab')).toContain('上限')
  })

  it('沒有欠款的人（150 遠低於上限）照常可以記帳', async () => {
    const g = await toChoose(0)
    expect(settleBlock(g.k, g.state, 'tab')).toBeNull()
    g.commit(settleDraft(g.k, g.state, { how: 'tab' }))
    expect(curtainOf(g.state).tab?.owed).toBe(150)
  })
})
