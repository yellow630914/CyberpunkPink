// 白箱測試：ui/src/lib/battleView.ts 在 M1-ui-combat-picks 改過的地方（dev/work/M1-ui-combat-picks.md 第四節，審查 S9）：
// 遮蔽的名字與上限改讀這個戰場的規則（store 的 battleMode()，不是 DEFAULT_MODES／DEFAULT_NUMBERS）；距離改讀射擊的目標帶的 hint.distance。
// 另外補 engine.battle.test.ts 沒走到的分支：格子自己的耐久（載具）、打不破的遮蔽、無人機的過濾、控制節點、狀態的名字查不到時。
// 規則都在引擎：這裡只驗「畫面照引擎給的東西排版」，不驗數字本身。

import { beforeEach, describe, expect, it } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import type { BattleMode, BattleOptions, BattleState } from '@engine/src'
import { BATTLE_SETUPS } from '@engine/src/testkit'
import { useEngine } from '../stores/engine'
import { battleView, disabledReason, RING_KEYS } from './battleView'

beforeEach(() => setActivePinia(createPinia()))

/** 一場一般遭遇，走到輪到玩家 */
function playerTurn() {
  const e = useEngine()
  e.newGame({ seed: 7 })
  e.startBattle(BATTLE_SETUPS.encounter())
  while (e.battleOptions()!.waiting === 'ai') e.battleNext()
  expect(e.battleOptions()!.waiting).toBe('player')
  return { e, battle: structuredClone(e.battle!) as BattleState, options: e.battleOptions()!, mode: e.battleMode()! }
}

describe('遮蔽的名字與上限照這個戰場的規則（工單第四節；審查 S9）', () => {
  it('名字讀 mode.coverNames；上限讀 mode.numbers 的 coverHp（照這一場的等級），不是預設值', () => {
    const { battle, options, mode } = playerTurn()
    const custom: BattleMode = {
      ...mode,
      coverNames: ['沒擋', '矮牆', '高牆'],
      numbers: { ...mode.numbers, coverHp: { half: [111, 112, 113, 114, 115], full: [221, 222, 223, 224, 225] } },
    }
    battle.grade = 3
    battle.cover.ally = [{ level: 1, hp: 5 }, { level: 2, hp: 7 }, { level: 0, hp: 0 }, { level: 0, hp: 0 }]
    const v = battleView(battle, options, custom)
    const cell = (slot: number) => v.cells.find((c) => c.side === 'ally' && c.slot === slot)!.cover
    expect(cell(1)).toEqual({ level: 1, name: '矮牆', hp: 5, max: 113 })
    expect(cell(2)).toEqual({ level: 2, name: '高牆', hp: 7, max: 223 })
    expect(cell(3)).toEqual({ level: 0, name: '沒擋', hp: 0, max: 0 })
  })

  it('這一格自己帶耐久（載具叫來的掩體：max 是 [半掩體, 掩體]）就用它，不照場景的等級算', () => {
    const { battle, options, mode } = playerTurn()
    battle.cover.foe[0] = { level: 2, hp: 40, max: [30, 60] }
    battle.cover.foe[1] = { level: 1, hp: 9, max: [30, 60] }
    const v = battleView(battle, options, mode)
    expect(v.cells.find((c) => c.side === 'foe' && c.slot === 1)!.cover.max).toBe(60)
    expect(v.cells.find((c) => c.side === 'foe' && c.slot === 2)!.cover.max).toBe(30)
  })

  it('打不破的遮蔽（煙霧、人群）帶 soft 的種類；沒有的不帶這個鍵', () => {
    const { battle, options, mode } = playerTurn()
    battle.cover.ally[3] = { level: 1, hp: 0, soft: { kind: 'smoke', until: 3 } }
    const v = battleView(battle, options, mode)
    expect(v.cells.find((c) => c.side === 'ally' && c.slot === 4)!.cover.soft).toBe('smoke')
    expect('soft' in v.cells.find((c) => c.side === 'ally' && c.slot === 3)!.cover).toBe(false)
  })
})

describe('距離讀射擊的目標帶的 hint.distance（工單第四節）', () => {
  it('照射擊的 targets 的順序列，數字就是引擎給的 hint.distance', () => {
    const { battle, options, mode } = playerTurn()
    const shoot = options.actions.find((a) => a.id === 'shoot')!
    const want = shoot.targets.filter((t) => 'unit' in t.target && typeof t.hint?.distance === 'number')
      .map((t) => ({ id: (t.target as { unit: string }).unit, distance: t.hint!.distance }))
    expect(want.length).toBeGreaterThan(0)
    expect(battleView(battle, options, mode).distances.map((d) => ({ id: d.id, distance: d.distance }))).toEqual(want)
  })

  it('不是單位的目標、沒有數字的 hint、單位查不到的都不列；沒有射擊這個行動就整列不顯示', () => {
    const { battle, options, mode } = playerTurn()
    const shoot = options.actions.find((a) => a.id === 'shoot')!
    const first = shoot.targets.find((t) => 'unit' in t.target)!
    const fake: BattleOptions = {
      ...options,
      actions: options.actions.map((a) => (a.id !== 'shoot' ? a : {
        ...a,
        targets: [
          { target: { side: 'foe', slot: 1 }, blocks: [], hint: { distance: 1 } },
          { target: { unit: 'nobody' }, blocks: [], hint: { distance: 2 } },
          { target: first.target, blocks: [], hint: { distance: '3' } },
          { target: first.target, blocks: [], hint: { distance: 4 } },
          { target: first.target, blocks: [] },
        ],
      })),
    }
    expect(battleView(battle, fake, mode).distances.map((d) => d.distance)).toEqual([4])
    const noShoot: BattleOptions = { ...options, actions: options.actions.filter((a) => a.id !== 'shoot') }
    expect(battleView(battle, noShoot, mode).distances).toEqual([])
  })

  it('等的不是玩家（AI 的回合、分出結果）就不顯示距離', () => {
    const { battle, options, mode } = playerTurn()
    expect(battleView(battle, { ...options, waiting: 'ai' }, mode).distances).toEqual([])
    expect(battleView(battle, { ...options, waiting: 'over' }, mode).distances).toEqual([])
  })
})

describe('格子上的人、無人機、控制節點（畫面的模型；COMBAT_SYSTEM 第 10 節）', () => {
  it('狀態的名字：有給 nameOf 用名字，查不到或沒給 nameOf 用 id', () => {
    const { battle, options, mode } = playerTurn()
    const u = Object.values(battle.units).find((x) => x.side === 'ally' && x.slot === 1)!
    u.statuses = [{ id: 'known', left: 1 } as never, { id: 'unknown', left: 1 } as never]
    const unitOf = (v: ReturnType<typeof battleView>) => v.cells.find((c) => c.unit?.id === u.id)!.unit!
    expect(unitOf(battleView(battle, options, mode)).statuses).toEqual(['known', 'unknown'])
    expect(unitOf(battleView(battle, options, mode, (_k, id) => (id === 'known' ? '已知的狀態' : undefined))).statuses).toEqual(['已知的狀態', 'unknown'])
  })

  it('沒有生命這條軌（內海的單位只有感載）、空手的人：不帶 hp、mag，武器名字是空的', () => {
    const { battle, options, mode } = playerTurn()
    const u = Object.values(battle.units).find((x) => x.side === 'ally' && x.slot === 1)!
    delete (u as { hp?: unknown }).hp
    u.weapons = []
    const cu = battleView(battle, options, mode).cells.find((c) => c.unit?.id === u.id)!.unit!
    expect('hp' in cu).toBe(false)
    expect('mag' in cu).toBe(false)
    expect(cu.weapon).toBe('')
    expect(cu.load).toEqual({ now: u.load!.now, max: u.load!.max })
  })

  it('退出的人與在後方等的人（第 0 格）不畫在格子上', () => {
    const { battle, options, mode } = playerTurn()
    const u = Object.values(battle.units).find((x) => x.side === 'foe' && x.slot === 1)!
    u.out = 'down'
    const v = battleView(battle, options, mode)
    expect(v.cells.find((c) => c.side === 'foe' && c.slot === 1)!.unit).toBeNull()
    expect(v.order.find((o) => o.id === u.id)).toMatchObject({ out: 'down' })
  })

  it('無人機：只畫沒被擊落、在這一方這一格的；控制節點照引擎的 taken、used；黑暗照 field.dark', () => {
    const { battle, options, mode } = playerTurn()
    const base = { owner: 'a1', armor: 0, evade: 13, used: false, hp: { now: 5, max: 10 } }
    battle.overlays = [
      { ...base, id: 'o1', side: 'ally', slot: 2, kind: 'attack', name: '攻擊型', down: false },
      { ...base, id: 'o2', side: 'ally', slot: 2, kind: 'medic', name: '醫療型', down: true },
      { ...base, id: 'o3', side: 'foe', slot: 2, kind: 'turret', name: '砲塔', down: false },
    ] as never
    battle.nodes = [{ id: 'n1', kind: 'light', name: '燈', taken: true, used: false }, { id: 'n2', kind: 'door', name: '門', taken: false, used: true, ext: { x: 1 } }]
    battle.field = { dark: true }
    const v = battleView(battle, options, mode)
    expect(v.cells.find((c) => c.side === 'ally' && c.slot === 2)!.overlays).toEqual([{ id: 'o1', name: '攻擊型', kind: 'attack', hp: { now: 5, max: 10 } }])
    expect(v.cells.find((c) => c.side === 'foe' && c.slot === 2)!.overlays.map((o) => o.id)).toEqual(['o3'])
    expect(v.nodes).toEqual([{ id: 'n1', name: '燈', taken: true, used: false }, { id: 'n2', name: '門', taken: false, used: true }])
    expect(v.field.dark).toBe(true)
    battle.field = { dark: 1 }
    expect(battleView(battle, options, mode).field.dark).toBe(false)
  })
})

describe('灰掉的原因與數字鍵（COMBAT_SYSTEM 第 10 節：引擎給幾條就寫幾條）', () => {
  it('disabledReason：能做是 null；行動自己的 blocks 優先；否則目標的原因去掉重複；都沒有是 null', () => {
    expect(disabledReason({ ok: true, blocks: ['不會用到'], targets: [] })).toBeNull()
    expect(disabledReason({ ok: false, blocks: ['甲。', '乙。'], targets: [{ target: { unit: 'f1' }, blocks: ['丙。'] }] })).toBe('甲。\n乙。')
    expect(disabledReason({ ok: false, blocks: [], targets: [{ target: { unit: 'f1' }, blocks: ['丙。', '丁。'] }, { target: { unit: 'f2' }, blocks: ['丙。'] }] })).toBe('丙。\n丁。')
    expect(disabledReason({ ok: false, blocks: [], targets: [] })).toBeNull()
  })

  it('RING_KEYS 只排攻擊、補充、戰術三圈，最多九個', () => {
    const { options } = playerTurn()
    const many: BattleOptions = { ...options, actions: Array.from({ length: 12 }, (_, i) => ({ ...options.actions[0]!, id: `a${i}`, group: (['attack', 'supply', 'tactic', 'skill', 'system'] as const)[i % 5] })) }
    const keys = RING_KEYS(many)
    expect(keys).toHaveLength(8)
    expect(keys.every((k) => ['attack', 'supply', 'tactic'].includes(many.actions.find((a) => a.id === k)!.group))).toBe(true)
    const lots: BattleOptions = { ...options, actions: Array.from({ length: 12 }, (_, i) => ({ ...options.actions[0]!, id: `b${i}`, group: 'attack' as const })) }
    expect(RING_KEYS(lots)).toEqual(['b0', 'b1', 'b2', 'b3', 'b4', 'b5', 'b6', 'b7', 'b8'])
  })
})
