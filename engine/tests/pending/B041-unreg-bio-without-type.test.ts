// B041（M4 邊界，cpp-tester-boundary）：效果 part_unreg 寫了 material: 'bio' 卻沒指定 type，種子抽到沒有生體版的類型（機構、槍管）時，
// 框架就是壞的（框架格式檢查說「機構沒有生體版」），交貨丟錯、零件永遠領不到。
// 規格：CRAFTING 第 11 節（未登錄零件：有些類型沒有生體版，不能出生體）；frameOf 的註解「沒有生體版的類型給了生體丟 ActionBlocked」。
// 重現：engine/tests/pending/fixtures/B041-unreg-bio-without-type.json。dev/bugs/B041-unreg-bio-without-type.md。

import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { frameProblems, pendingParts } from '../../src/features/unreg'
import { applyEffects, makeBodyGame, passTime } from '../../src/testkit'

const fx = JSON.parse(readFileSync(new URL('./fixtures/B041-unreg-bio-without-type.json', import.meta.url), 'utf8')) as { seeds: number[]; bad_seed: number }

describe('B041：生體的未登錄零件不能抽到沒有生體版的類型', () => {
  it('效果 part_unreg 只寫 material: bio（不指定 type）：掃過這些種子，每一件等著交貨的零件的框架都過格式檢查', () => {
    const bad: string[] = []
    for (const seed of fx.seeds) {
      const g = makeBodyGame({ seed }).game
      const r = applyEffects(g, [{ kind: 'part_unreg', source: 'gift', material: 'bio', grade: 2 }])
      expect(r.errors).toEqual([])
      for (const p of pendingParts(g.state)) {
        const pr = frameProblems(g.k, p.frame)
        if (pr.length) bad.push(`種子 ${seed}：${p.frame.type} ${pr.join('、')}`)
      }
    }
    expect(bad).toEqual([])
  })

  it('壞的那一個種子：等到交貨的時間，交貨成功（不丟錯），零件到背包', async () => {
    const g = makeBodyGame({ seed: fx.bad_seed }).game
    applyEffects(g, [{ kind: 'part_unreg', source: 'gift', material: 'bio', grade: 2 }])
    const p = pendingParts(g.state)[0]!
    passTime(g, 10 * 1440)
    await expect(g.unregDeliver(p.id)).resolves.toBeTruthy()
  })
})
