// B042（M4 探針，cpp-tester-whitebox）：簾後館記帳的欠款超過上限（保證金的兩倍）。
// 規格：CYBERSPACE 8.8 節「記帳：欠著，每週 10%，列進每週帳單；欠款上限是保證金的兩倍，欠到上限就不能再報名，直到還清」。
// 現況：上限只是報名的閘門（enterBlocks：owed >= cap 擋下）；選「記帳」時直接把設備費與違約金加進欠款，沒有夾也沒有擋。
// 欠 590（還沒到上限 600，可以報名）的人再落幕選記帳：欠 590 + 150 = 740，超過上限 600。
// 重現：engine/tests/pending/fixtures/B042-curtain-tab-over-cap.json。dev/bugs/B042-curtain-tab-over-cap.md（規格要問：夾住、還是擋下記帳那一條路）。

import { readFileSync } from 'node:fs'
import { describe, expect, it, vi } from 'vitest'
import { acceptDefeat } from '../../src/features/defeat'
import { accountView, curtainOf, replayDraft, settleDraft } from '../../src/features/curtain'
import { CURTAIN_NIGHTS, curtainEnter, curtainPrelude, makeCurtainGame, netMarkers, netUse, playCurtainRun, sceneCast, standBeside, stopScene } from '../../src/testkit'

vi.setConfig({ testTimeout: 120_000 })
const fx = JSON.parse(readFileSync(new URL('./fixtures/B042-curtain-tab-over-cap.json', import.meta.url), 'utf8')) as { seed: number; owed_before: number }

describe('B042：記帳的欠款不超過保證金的兩倍', () => {
  it('欠款 590（上限 600）：報名、打到第二幕投降、補演、選記帳：欠款不超過上限（現況 740）', async () => {
    const g = makeCurtainGame({ seed: fx.seed, actors: sceneCast('ann') }).game
    const { k } = g
    curtainPrelude(g)
    ;(g.state.ext.curtain as { tab?: { owed: number; since: number } }).tab = { owed: fx.owed_before, since: 0 }
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
    g.commit(settleDraft(k, g.state, { how: 'tab' }))
    const tab = accountView(k, g.state).tab!
    expect(curtainOf(g.state).tab?.owed).toBe(tab.owed)
    expect(tab.owed).toBeLessThanOrEqual(tab.cap)
  })
})
