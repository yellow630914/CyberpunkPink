// B030（dev/bugs/B030-curtain-enter-blocked-in-dive.md）：在暗礁的簾口（潛入之後選去處 ns_tw_curtain，人站在 net_site 登記的網內街區）報名簾後館，
// 被潛入的活動擋下：「你的意識在網內，身體躺在潛艙店。先登出。」。簾後館只往活動 netrun 的放行清單加了 commit:curtain.（features/curtain/index.ts），
// 沒有往 dive 加；而簾口要站在潛入的網內街區才報名得到（示意包與測試的假世界都是這樣放簾口的）。
// 預期：站在簾口、潛入進行中，enterBlocks 是空的、enterDraft 成立。目前會失敗（修好之後搬到 tests/smoke/m4-curtain.test.ts 的潛入那一條）。

import { describe, expect, it } from 'vitest'
import { enterBlocks } from '../../src/features/curtain'
import { CURTAIN_NIGHTS, curtainEnter, curtainPrelude, makeCurtainGame, sceneCast } from '../../src/testkit'

describe('B030：潛入裡站在簾口，簾後館報得了名', () => {
  it('enterBlocks 沒有潛入的活動擋下的那一句；enterDraft 成立', () => {
    const g = makeCurtainGame({ seed: 3, actors: sceneCast('ann') }).game
    curtainPrelude(g, { dive: true })
    expect(g.k.activity.active(g.state).map((a) => a.kind)).toContain('dive')
    expect(g.state.location).toMatchObject({ block: 'tw_curtain_door', facility: 'F1' })
    expect(enterBlocks(g.k, g.state, { party: ['pc'], night: CURTAIN_NIGHTS.a })).toEqual([])
    expect(() => curtainEnter(g, CURTAIN_NIGHTS.a)).not.toThrow()
  })
})
