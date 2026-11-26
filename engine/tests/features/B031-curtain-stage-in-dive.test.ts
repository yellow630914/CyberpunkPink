// B031（dev/bugs/B031-curtain-run-never-starts-in-dive.md）：從潛入裡的簾口報了名（B030 放行 commit:curtain. 之後），
// 簾後館 features/curtain/after.ts 的 afterReport 看到「進行中的活動不只有 netrun」（dive 也在）就整個不插報告：
// 沒有 curtain.stage（這一趟的地圖實例 run.map、場熱的起點與 sponsor／encore／cut 的門檻）、往下一幕之後沒有化妝室、
// 開戰時 onBattleStart 認不得這一趟（run.map 沒有）所以戰鬥的 origin.ext 沒有 curtain、defeat_event、defeat_play，輸了走通用的戰敗事件，不落幕、不補演、不記帳。
// 預期：潛入裡報名之後，第一份 netrun 報告後面接 curtain.stage，run.map 有值；第二幕開戰時 origin.ext.defeat_play 是 true。M4 收尾修正批修好，從 tests/pending 搬進來。

import { describe, expect, it } from 'vitest'
import { curtainOf } from '../../src/features/curtain'
import { CURTAIN_NIGHTS, curtainEnter, curtainPrelude, makeCurtainGame, netMarkers, netUse, sceneCast, standBeside } from '../../src/testkit'

describe('B031：潛入裡報名之後，簾後館的一趟照樣啟動', () => {
  it('報名之後有 curtain.stage、run.map 有值；開戰的 origin 帶著 defeat_play', async () => {
    const g = makeCurtainGame({ seed: 3, actors: sceneCast('ann') }).game
    curtainPrelude(g, { dive: true })
    const reports = curtainEnter(g, CURTAIN_NIGHTS.a)
    expect(reports.map((r) => r.action)).toContain('curtain.stage')
    expect(curtainOf(g.state).run?.map).toBeTruthy()
    const foe = netMarkers(g).find((m) => m.mark === 'f')!
    await standBeside(g, foe.id)
    netUse(g, 'fight', foe.id)
    expect(g.battle!.origin.ext?.defeat_play).toBe(true)
  })
})
