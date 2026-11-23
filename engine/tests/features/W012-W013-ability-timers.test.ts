// W012、W013：技能這邊自己算計時的東西（臨時遮蔽、buff）在給的人退出時結束、救回來時 buff 清空（dev/bugs/2026-11-23-W012、W013；W011 在 W011-lost-turn-ability-timers.test.ts）。
// 重現資料在 engine/tests/whitebox/fixtures/W012～W013 的 JSON（不是 Repro 格式：直接在一場不經過提交的戰鬥上呼叫基本動作）。
// 修在：features/abilities（ops.ts 的 out、mods.ts 的 out 與 revive）、features/hack（revive 清持續型）；核心發 out 與 revive 掛點。

import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import type { BattleUnit, ContentPack, Kernel } from '../../src'
import { advance, readyFeatures } from '../../src'
import { abilitiesFeature } from '../../src/features/abilities'
import { combatFeature } from '../../src/features/combat'
import { testWeapon } from '../../src/testkit'
import type { Arena } from '../helpers/battle'
import { TEST_STATUSES, arena, duel, foe, one } from '../helpers/battle'

type Rec = Record<string, any>
const fixture = (id: string): Rec => JSON.parse(readFileSync(fileURLToPath(new URL(`../whitebox/fixtures/${id}.json`, import.meta.url)), 'utf8')) as Rec
const STATUSES = [...TEST_STATUSES, { id: 'guarded', name: '戒備', desc: '到他的下一回合開始。', until: 'own_turn_start', turns: 1, kind: 'buff' }]
const SRC = { kind: 'ability', id: 'sk_x', name: '測試' } as const

function field(setup: Rec): Arena {
  const allies = (setup.allies as Rec[]).map((x, i) => one({ weapon: x.weapon, weapons: [{ ...testWeapon('pistol', 10), mag: { now: x.mag ?? 5, max: 5 } }], wield: 0 } as never, i + 1))
  const foes = (setup.foes as Rec[]).map((x) => foe(x.rank, { hp: { now: x.hp, max: x.hp }, ...(x.ap === 0 ? { ap: { now: 0, max: 0, regen: 0 } } : {}) } as never))
  return arena(duel(allies, foes, setup.cover ?? { ally: [0, 0, 0, 0], foe: [0, 0, 0, 0] }), [combatFeature, abilitiesFeature], (k: Kernel) => {
    k.content.loadPack({ id: 'w011', content: { battle_status: STATUSES } } as unknown as ContentPack)
    readyFeatures(k)
  })
}
const unit = (a: Arena, id: string): BattleUnit => a.battle.units[id]!
function apply(a: Arena, run: ReturnType<Arena['run']>, c: Rec): void {
  for (const x of c.apply ?? []) run.effects([x.effect], { user: unit(a, x.user), target: x.target, source: SRC })
  for (const x of c.statuses ?? []) run.applyStatus(unit(a, x.unit), x.status, { by: unit(a, x.by), ...(x.until ? { until: x.until } : {}) } as never)
}
const ids = (u: BattleUnit, key: 'wards' | 'buffs'): string[] => (((u.ext.abilities as Rec | undefined)?.[key] ?? []) as Rec[]).map((x) => x.id)

describe('W012：計時看的那個人退出之後（SKILL_TREES 跑位射擊；dev/adr/0015 補記 fix3「同核心狀態的規則」）', () => {
  const fx = fixture('W012-timers-outlive-leaving-unit')

  it('跑位射擊：做的人在下一回合之前倒下，升上去的那一級不會留整場（守著與監視都在退出時結束）', () => {
    const a = field(fx.setup)
    const run = a.run(Array(300).fill(1))
    const c = fx.cases[0]
    apply(a, run, c)
    expect(a.battle.cover.ally[0]!.level).toBe(1)
    run.setOut(unit(a, 'a1'), 'down', unit(a, 'f1'))
    for (let i = 0; i < 6 && !run.over; i++) advance(run)
    expect(a.battle.cover.ally[0]!.level).toBe(c.expect['cover.ally[0]'])
  })

  it('source_turn_end 的 buff：給的人在自己的回合裡倒下，這個回合結束照樣到期（核心的狀態會）', () => {
    const a = field(fx.setup)
    const run = a.run(Array(300).fill(1))
    const c = fx.cases[1]
    a.battle.turn = a.battle.order.indexOf('a2')
    a.battle.acting = 'a2'
    apply(a, run, c)
    run.setOut(unit(a, 'a2'), 'down', unit(a, 'f1'))
    advance(run)
    // 對照：核心的狀態到期了
    expect(unit(a, 'a1').statuses.map((s) => s.id)).not.toContain('jammed')
    expect(ids(unit(a, 'a1'), 'buffs')).toEqual(c.expect.buffs)
  })
})

describe('W013：被拉回來的人狀態清空，buff 也清（dev/adr/0015 第一節 run.revive「狀態清空」；SKILL_TREES 拉回來）', () => {
  const fx = fixture('W013-buffs-survive-revive')

  it('revive 之後沒有 buff，也吃不到 buff 的修正', () => {
    const a = field(fx.setup)
    const run = a.run()
    apply(a, run, fx)
    const me = unit(a, 'a1')
    run.setOut(me, 'down', unit(a, 'f1'))
    expect(run.revive(me, 5)).toBe(true)
    expect(me.statuses).toEqual([])
    expect(ids(me, 'buffs')).toEqual(fx.expect.buffs)
    expect(run.mods('hit', me).filter((p) => p.source === 'skill')).toEqual([])
  })
})
