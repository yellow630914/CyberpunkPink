// B024：潛入中走得了現實的街（dev/bugs/B024-dive-walks-real-street.md）。
// 規格：CYBERSPACE 第 2 節表（潛入：「意識整個進去。身體躺著不動」）、2.4 節（潛入的時候，身體是最大的弱點）；dev/adr/0018 第八節（活動 dive 進行中只放行網內做得了的事）。
// 修好了（M3 修正批）：features/dive 把 `grid.`、`commit:grid.`、`commit:world.`、`commit:trade.`、`commit:npc.` 改成帶條件的放行（DIVE_NET_ONLY）：
// 只有腳下是網內生成的地圖或 net_site 登記的網內街區時才放行；人躺在潛艙裡，現實的街上走不了、買不了東西。
// 固定檔（種子與輸入）：tests/fixtures/repro/B024-dive-walks-real-street.json（種子重播也會跑它）。

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { FEATURES } from '../../src/features'
import type { Repro } from '../../src/testkit'
import { checkRepro, diveIn, makeDiveGame, walkTo } from '../../src/testkit'

const FIXTURE = join(fileURLToPath(new URL('../fixtures/repro', import.meta.url)), 'B024-dive-walks-real-street.json')

describe('B024：潛入中不能在現實的街上走', () => {
  it('固定檔重播：潛入之後走格子被擋下（原因是先登出）', async () => {
    const repro = JSON.parse(readFileSync(FIXTURE, 'utf8')) as Repro
    expect(await checkRepro(repro, FEATURES)).toEqual([])
  })

  it('同一件事直接寫：潛入之後走到街的出口，被擋下；人還站在潛艙店', () => {
    const { game: g } = makeDiveGame()
    diveIn(g)
    expect(() => walkTo(g, 'E2')).toThrow(/先登出/)
    expect(g.state.location).toMatchObject({ block: 'tw_tower', facility: 'F3' })
  })

  it('對照：登出之後走得動', () => {
    const { game: g } = makeDiveGame()
    expect(() => walkTo(g, 'E2')).not.toThrow()
  })
})
