// B024：潛入中走得了現實的街（dev/bugs/B024-dive-walks-real-street.md）。
// 規格：CYBERSPACE 第 2 節表（潛入：「意識整個進去。身體躺著不動」）、2.4 節（潛入的時候，身體是最大的弱點）；dev/adr/0018 第八節（活動 dive 進行中只放行網內做得了的事）。
// 現況：`DIVE_ALLOW`（features/dive/index.ts）放行 `grid.`、`commit:grid.`、`commit:world.`、`commit:trade.`、`commit:npc.`——為了內海固定的街區（net_site 的 kind: block）走得動——
// 但沒有分「腳下是現實的街」還是「內海的街區」：人躺在潛艙裡，還能在現實的街上走、跨區、買東西。
// 固定檔（種子與輸入）：tests/pending/fixtures/B024-dive-walks-real-street.json。工單做完之前照預期失敗。

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { FEATURES } from '../../src/features'
import type { Repro } from '../../src/testkit'
import { checkRepro, diveIn, makeDiveGame, walkTo } from '../../src/testkit'

const FIXTURE = join(fileURLToPath(new URL('./fixtures', import.meta.url)), 'B024-dive-walks-real-street.json')

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

  it('對照：登出之後走得動（這一條現在就是對的）', () => {
    const { game: g } = makeDiveGame()
    expect(() => walkTo(g, 'E2')).not.toThrow()
  })
})
