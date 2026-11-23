// W011：失去回合的那一個回合，技能這邊聽 turn.start 計時的東西（守著、臨時遮蔽、buff）和核心的狀態同一刻數（dev/bugs/2026-11-23-W011）。
// 修法在核心：beginTurn 對失去回合的人也發 turn.start（lost: true；dev/adr/0015 補記 M1b-review-core）。這份原本在 tests/pending/，修好之後搬進主套件。
// 重現資料在 engine/tests/whitebox/fixtures/W011 的 JSON（不是 Repro 格式：直接在一場不經過提交的戰鬥上呼叫基本動作與 beginTurn）。
// 每個測試寫的是規格期望的行為；「對照」是核心本來就對的那一半（狀態、監視在同一刻到期）。

import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import type { BattleUnit, ContentPack, Kernel } from '../../src'
import { beginTurn, readyFeatures } from '../../src'
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

describe('W011：失去的那一個回合也是「下一回合開始」（SKILL_TREES 不准動喔、跑位射擊；COMBAT_SYSTEM 1.3 節監視；dev/adr/0015 補記 fix3）', () => {
  const fx = fixture('W011-lost-turn-skips-feature-timers')

  it('對照（會過）：失去回合的人，核心照樣拿掉 own_turn_start 的狀態、清掉監視', () => {
    const a = field(fx.setup)
    const run = a.run()
    const c = fx.cases[0]
    apply(a, run, c)
    unit(a, 'a1').watch = { action: 'watch' }
    expect(beginTurn(run, unit(a, 'a1'))).toBe(false)
    expect(unit(a, 'a1').statuses.map((s) => s.id)).not.toContain('guarded')
    expect(unit(a, 'a1').watch).toBeUndefined()
  })

  it('不准動喔「到你的下一回合開始前」：守著的人失去回合，守著在那一刻失效（和監視一樣）', () => {
    const a = field(fx.setup)
    const run = a.run()
    apply(a, run, fx.cases[0])
    beginTurn(run, unit(a, 'a1'))
    expect(ids(unit(a, 'a1'), 'wards')).toEqual(fx.cases[0].expect.wards)
  })

  it('跑位射擊「到你的下一回合開始前遮蔽高一級」：失去回合的那一刻，升上去的那一級拿回來', () => {
    const a = field(fx.setup)
    const run = a.run()
    apply(a, run, fx.cases[0])
    expect(a.battle.cover.ally[0]!.level).toBe(2)
    beginTurn(run, unit(a, 'a1'))
    expect(a.battle.cover.ally[0]!.level).toBe(fx.cases[0].expect['cover.ally[0]'])
  })

  it('buff（own_turn_start）照核心狀態的規則：失去的那一個回合開始也數一次', () => {
    const a = field(fx.setup)
    const run = a.run()
    apply(a, run, fx.cases[0])
    beginTurn(run, unit(a, 'a1'))
    expect(ids(unit(a, 'a1'), 'buffs')).toEqual(fx.cases[0].expect.buffs)
  })

  it('buff（source_turn_start）：給的人失去回合，也數一次（核心的 source_turn_start 狀態會到期）', () => {
    const a = field(fx.setup)
    const run = a.run()
    const c = fx.cases[1]
    apply(a, run, c)
    expect(beginTurn(run, unit(a, 'f1'))).toBe(false)
    // 對照：核心的狀態到期了
    expect(unit(a, 'a1').statuses.map((s) => s.id)).not.toContain('marked')
    expect(ids(unit(a, 'a1'), 'buffs')).toEqual(c.expect.buffs)
  })
})
