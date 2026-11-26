// B030（dev/bugs/B030-curtain-enter-blocked-in-dive.md）：在暗礁的簾口（潛入之後選去處 ns_tw_curtain，人站在 net_site 登記的網內街區）報名簾後館，
// 被潛入的活動擋下：「你的意識在網內，身體躺在潛艙店。先登出。」。簾後館只往活動 netrun 的放行清單加了 commit:curtain.（features/curtain/index.ts），
// 沒有往 dive 加；而簾口要站在潛入的網內街區才報名得到（示意包與測試的假世界都是這樣放簾口的）。
// 預期：站在簾口、潛入進行中，enterBlocks 是空的、enterDraft 成立。M4 收尾修正批修好，從 tests/pending 搬進來（冒煙 tests/smoke/m4-curtain.test.ts 另有潛入的走法）。

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

  it('潛入中放行簾後館一趟用得到的報告（報名、一趟裡的、加演、落幕、補演、選路），面談、口味單、買回母帶是現實的事，仍然擋下', () => {
    const g = makeCurtainGame({ seed: 3, actors: sceneCast('ann') }).game
    curtainPrelude(g, { dive: true })
    for (const a of ['enter', 'encore', 'use', 'rest', 'stage', 'result', 'fall', 'replay', 'settle']) expect(g.blockOf(`commit:curtain.${a}`), a).toBeNull()
    for (const a of ['interview', 'taste', 'tape']) expect(g.blockOf(`commit:curtain.${a}`), a).toMatch(/先登出/)
    // 其他的現實的事照舊擋下
    for (const a of ['rest.sleep', 'cyber.install']) expect(g.blockOf(`commit:${a}`), a).toMatch(/先登出/)
  })
})
