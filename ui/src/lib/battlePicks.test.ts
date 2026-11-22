// 驗收測試：dev/work/M1-ui-combat-picks.md（交給 cpp-ui）。工單做完之前照預期失敗（ui/src/lib/battlePicks.ts 還不存在、幾個圖示還沒有圖）。
// 規格：COMBAT_SYSTEM 第 10 節（畫面只問引擎；每一格用圖示）；dev/adr/0014（行動的宣告：icon、picks）；審查 dev/reviews/2026-11-22-M1a.md 的 E3、S9。
// 規則都在引擎：畫面照 battleOptions 給的 picks 生選單，不認得個別的行動。跑法：在 ui/ 跑 npx vitest run --config vitest.pending.config.ts M1-ui-combat-picks

import { beforeEach, describe, expect, it } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import type { BattleActionOption, BattleSetup } from '@engine/src'
import { partyUnit, enemyUnit, testWeapon } from '@engine/src/testkit'
import { useEngine } from '../../src/stores/engine'
import { COMBAT_ICONS } from '../../src/data/combatIcons'
// 這個檔由工單新增
import { pickFlow } from '../../src/lib/battlePicks'

const raw = (unit: unknown, slot?: number) => ({ from: 'unit', unit: unit as Record<string, unknown>, ...(slot ? { slot } : {}) })
/** 一個什麼都帶的人（第 1 格）加兩個隊友；敵方兩個人。內容用引擎的規則資料（CORE_PACK 的道具）。 */
const SETUP: BattleSetup = {
  mode: 'meat', grade: 1, cover: { ally: [1, 1, 0, 0], foe: [0, 2, 0, 0] },
  allies: [
    raw(partyUnit(0, 1, {
      weapons: [{ ...testWeapon('rifle', 6), id: 'lmg', name: '輕機槍', class: 'lmg', mag: { now: 4, max: 4 }, traits: ['sweep'] }, testWeapon('pistol', 6), testWeapon('knife', 6)],
      quick: [{ item: 'it_medgel_1', qty: 2 }, { item: 'it_coolant_1', qty: 1 }, { item: 'it_smoke_1', qty: 1 }, { item: 'it_zip_tie', qty: 1 }],
      skills: { firearms: 2, sync: 6, piloting: 3 }, ap: { now: 30, max: 30, regen: 3 }, initBonus: 99,
      ext: { summons: { drones: [{ kind: 'attack', grade: 1 }, { kind: 'medic', grade: 1 }], vehicle: { name: '小貨車', hp: [30, 60] } } },
    })),
    raw(partyUnit(1, 1)), raw(partyUnit(2, 1)),
  ],
  foes: [raw(enemyUnit('elite', 1)), raw(enemyUnit('elite', 1))],
  nodes: [{ kind: 'light', name: '燈' }, { kind: 'door', name: '防爆門' }],
}

describe('M1-ui-combat-picks：畫面照引擎的宣告生選單（pickFlow，純函式）', () => {
  beforeEach(() => setActivePinia(createPinia()))
  const start = () => {
    const e = useEngine()
    e.newGame({ seed: 7 })
    e.startBattle(SETUP)
    expect(e.battleOptions()!.current).toBe('a1')
    return e
  }
  const act = (e: ReturnType<typeof start>, id: string): BattleActionOption => e.battleOptions()!.actions.find((a) => a.id === id)!

  it('使用道具：先列出能用的道具（束帶不列）；選了道具之後，用不上它的目標帶著原因；選齊了才 ready，input 照樣送得進引擎', () => {
    const e = start()
    const item = act(e, 'item')
    const none = pickFlow(item, { target: null, pick: {} })
    expect(none.picks.map((p) => [p.key, p.label, p.kind, p.required])).toEqual([['item', '用哪一個道具', 'choice', true]])
    expect(none.picks[0]!.options.map((o) => [o.value, o.label, o.reason, o.selected])).toEqual([
      ['it_medgel_1', '急救凝膠 I ×2', null, false], ['it_coolant_1', '冷卻劑 I ×1', null, false], ['it_smoke_1', '煙霧彈 I ×1', null, false],
    ])
    expect(none.ready).toBe(false)
    expect(none.missing).toEqual(['要選一個目標。', '要選用哪一個道具。'])
    // 選了冷卻劑（只能自己用）：隊友與格子都用不上，原因寫出來；自己可以
    const cool = pickFlow(item, { target: null, pick: { item: 'it_coolant_1' } })
    expect(cool.picks[0]!.options.find((o) => o.value === 'it_coolant_1')!.selected).toBe(true)
    const reasonOf = (flow: typeof cool, key: string) => flow.targets.find((t) => JSON.stringify(t.target) === key)!.reason
    expect(reasonOf(cool, '{"unit":"a1"}')).toBeNull()
    expect(reasonOf(cool, '{"unit":"a2"}')).toBe('這個目標用不上選的「冷卻劑 I ×1」。')
    expect(reasonOf(cool, '{"side":"ally","slot":1}')).toBe('這個目標用不上選的「冷卻劑 I ×1」。')
    // 引擎自己給的原因優先（第 3 格的隊友不相鄰）
    expect(reasonOf(pickFlow(item, { target: null, pick: { item: 'it_medgel_1' } }), '{"unit":"a3"}')).toBe('要相鄰才用得到。')
    // 選齊了
    const ok = pickFlow(item, { target: { unit: 'a1' }, pick: { item: 'it_coolant_1' } })
    expect(ok).toMatchObject({ ready: true, missing: [], input: { action: 'item', target: { unit: 'a1' }, pick: { item: 'it_coolant_1' } } })
    expect(e.battleAct(ok.input).status).toBe('applied')
    // 先選了目標（一格）：只剩用得上的選項
    const slot = pickFlow(act(e, 'item'), { target: { side: 'ally', slot: 2 }, pick: {} })
    expect(slot.picks[0]!.options.map((o) => o.value)).toEqual(['it_smoke_1'])
  })

  it('不用選的那一項不擋：換武器不選就換到下一把；掃射的開關沒開就不送；灰掉的選項帶著引擎給的原因', () => {
    const e = start()
    const swap = pickFlow(act(e, 'swap'), { target: null, pick: {} })
    expect(swap).toMatchObject({ ready: true, input: { action: 'swap' } })
    expect(swap.input.pick).toBeUndefined()
    expect(swap.picks[0]!.options.map((o) => [o.label, o.reason])).toEqual([['輕機槍', '這一把已經拿在手上。'], ['手槍', null], ['刀', null]])
    expect(pickFlow(act(e, 'swap'), { target: null, pick: { weapon: 2 } }).input).toEqual({ action: 'swap', pick: { weapon: 2 } })
    const shoot = act(e, 'shoot')
    expect(pickFlow(shoot, { target: { unit: 'f1' }, pick: { sweep: false } }).input).toEqual({ action: 'shoot', target: { unit: 'f1' } })
    expect(pickFlow(shoot, { target: { unit: 'f1' }, pick: { sweep: true } }).input).toEqual({ action: 'shoot', target: { unit: 'f1' }, pick: { sweep: true } })
    // 宣告裡沒有的鍵不送
    expect(pickFlow(shoot, { target: { unit: 'f1' }, pick: { nonsense: 1 } }).input).toEqual({ action: 'shoot', target: { unit: 'f1' } })
  })

  it('無人機與控制節點：放出要選哪一台；指揮攻擊型要選敵人（選項帶著場上的位置），醫療型不用；防爆門要選格、關燈不用', () => {
    const e = start()
    const deploy = pickFlow(act(e, 'drone.deploy'), { target: { side: 'ally', slot: 1 }, pick: {} })
    expect(deploy.missing).toEqual(['要選放出哪一台。'])
    expect(e.battleAct(pickFlow(act(e, 'drone.deploy'), { target: { side: 'ally', slot: 1 }, pick: { drone: 0 } }).input).status).toBe('applied')
    expect(e.battleAct(pickFlow(act(e, 'drone.deploy'), { target: { side: 'ally', slot: 2 }, pick: { drone: 1 } }).input).status).toBe('applied')
    const [atk, med] = e.battle!.overlays.map((o) => o.id)
    const command = act(e, 'drone.command')
    const forAtk = pickFlow(command, { target: { overlay: atk! }, pick: {} })
    expect(forAtk.ready).toBe(false)
    expect(forAtk.picks.map((p) => [p.key, p.kind])).toEqual([['at', 'foe']])
    expect(forAtk.picks[0]!.options.map((o) => [o.value, o.at])).toEqual([['f1', { unit: 'f1' }], ['f2', { unit: 'f2' }]])
    // 醫療型：沒有適用的選項，這一項不列，直接 ready
    const forMed = pickFlow(command, { target: { overlay: med! }, pick: {} })
    expect(forMed).toMatchObject({ picks: [], ready: true, input: { action: 'drone.command', target: { overlay: med } } })
    expect(e.battleAct(pickFlow(command, { target: { overlay: atk! }, pick: { at: 'f1' } }).input).status).toBe('applied')
    // 控制節點
    const node = act(e, 'node.use')
    expect(pickFlow(node, { target: { node: 'n1' }, pick: {} }).picks).toEqual([])
    expect(pickFlow(node, { target: { node: 'n2' }, pick: {} }).picks.map((p) => [p.key, p.kind, p.options.length])).toEqual([['slot', 'ally_slot', 4]])
  })

  it('引擎用到的每一個圖示的鍵都有圖（結束回合、投降、無人機四個、叫車、控制節點要補）', () => {
    const e = start()
    const keys = [...new Set(e.battleOptions()!.actions.map((a) => a.icon))].sort()
    expect(keys.length).toBeGreaterThan(12)
    expect(keys.filter((key) => !COMBAT_ICONS[key])).toEqual([])
  })
})
