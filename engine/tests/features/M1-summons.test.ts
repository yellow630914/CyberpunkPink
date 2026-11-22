// 驗收測試：dev/work/M1-summons.md（cpp-feature）。前置：M1-data-rules、M1-combat 已經做完。做完之前照預期失敗（features/summons 還不存在）。
// 規格：COMBAT_SYSTEM 2.4、2.5 節（控制節點、場地效果）、9.1 節（無人機）、9.2 節（載具是叫來的掩體）。
// 機甲留到 M6（核心只留接口）。改造師的手術刀是技能樹的一部分，跟著改造師那一批技能做，不在這一張。

import { describe, expect, it } from 'vitest'
import type { BattleUnit, ContentPack } from '../../src'
import { allFeatures } from '../../src/features'
import { DRONE_CAP_BY_SYNC, DRONE_STATS } from '../../src/features/summons'
import { makeBattleGame } from '../../src/testkit'
import { TEST_STATUSES, duel, foe, one } from '../helpers/battle'

const PACK: ContentPack = { id: 'summons_test', content: { battle_status: TEST_STATUSES } }
const pilot = (o: Record<string, unknown> = {}) => one({ weapon: 'pistol', skills: { sync: 2, piloting: 3, firearms: 2 }, ext: { summons: { drones: [{ kind: 'attack', grade: 1 }, { kind: 'shield', grade: 1 }, { kind: 'scout', grade: 1 }], vehicle: { name: '小貨車', hp: [30, 60] } }, ...o } })
const game = (allies: unknown[], more = {}, seed = 7) => makeBattleGame({ features: allFeatures(), content: [PACK], battle: duel(allies, [foe('elite'), foe('elite')], { ally: [0, 0, 0, 0], foe: [0, 0, 0, 0] }, more), seed }).game
type G = ReturnType<typeof game>
const turnTo = (g: G, id: string): BattleUnit => { const b = g.state.battle!; b.turn = b.order.indexOf(id); const u = b.units[id]!; u.ap.now = u.ap.max; u.control = 'player'; return u }
const opt = (g: G, id: string) => g.battleOptions()!.actions.find((a) => a.id === id)!

describe('無人機（COMBAT_SYSTEM 9.1 節）', () => {
  it('數量看同步：0～1 連 1 台、2～3 連 2 台、4～5 連 3 台、6 連 4 台；生命與護甲照等級', () => {
    expect([0, 1, 2, 3, 4, 5, 6].map((s) => DRONE_CAP_BY_SYNC[s])).toEqual([1, 1, 2, 2, 3, 3, 4])
    expect(DRONE_STATS).toEqual([{ hp: 14, armor: 1 }, { hp: 17, armor: 2 }, { hp: 20, armor: 3 }, { hp: 25, armor: 4 }])
  })

  it('放出、指揮、移動、收回各 1 點；和人重疊、不佔格、每格最多一台；每台每回合指揮一次；連得住幾台看同步', () => {
    const g = game([pilot(), one({ weapon: 'rifle' }, 2)])
    const me = turnTo(g, 'a1')
    expect(['drone.deploy', 'drone.command', 'drone.move', 'drone.recall'].map((id) => opt(g, id)?.cost.ap)).toEqual([1, 1, 1, 1])
    expect(g.battleAct({ action: 'drone.deploy', target: { side: 'ally', slot: 2 }, pick: { drone: 0 } }).status).toBe('applied')
    const d = g.battle!.overlays[0]!
    expect(d).toMatchObject({ side: 'ally', slot: 2, owner: 'a1', kind: 'attack', hp: { now: 14, max: 14 }, armor: 1, down: false })
    expect(Object.values(g.battle!.units).filter((u) => u.side === 'ally' && u.slot === 2)).toHaveLength(1) // 不佔格
    // 同一格不能再掛一台
    expect(g.battleAct({ action: 'drone.deploy', target: { side: 'ally', slot: 2 }, pick: { drone: 1 } })).toMatchObject({ status: 'refused', reasons: ['這一格已經掛著一台了。'] })
    expect(g.battleAct({ action: 'drone.deploy', target: { side: 'ally', slot: 1 }, pick: { drone: 1 } }).status).toBe('applied')
    // 同步 2：連得住 2 台
    expect(opt(g, 'drone.deploy').blocks).toEqual(['同步 2 級只連得住 2 台。'])
    // 指揮攻擊型：射擊一次，命中用操作者的操縱；每台每回合一次
    const cmd = g.battleAct({ action: 'drone.command', target: { overlay: d.id }, pick: { at: 'f1' } })
    expect(cmd.status).toBe('applied')
    expect(cmd.reports[0]!.timeline.find((b) => b.roll)!.roll!.skill).toBe('piloting')
    expect(g.battleAct({ action: 'drone.command', target: { overlay: d.id }, pick: { at: 'f1' } })).toMatchObject({ status: 'refused', reasons: ['這一台這一回合動過了。'] })
    expect(g.battleAct({ action: 'drone.move', target: { overlay: d.id }, pick: { slot: 3 } }).status).toBe('applied')
    expect(g.battle!.overlays[0]!.slot).toBe(3)
    expect(g.battleAct({ action: 'drone.recall', target: { overlay: d.id } }).status).toBe('applied')
    expect(g.battle!.overlays.map((o) => o.kind)).toEqual(['shield'])
    expect(g.battle!.units.a1!.ap.now).toBe(me.ap.max - 5)
  })

  it('護盾型：同一格的人迴避 +2；偵察型：標記一個敵人，隊友打他 +2；被擊落時操作者感載 +5；放出的無人機都帶 autonomous（操作者倒下之後自律）', () => {
    const g = game([pilot(), one({ weapon: 'rifle' }, 2)])
    turnTo(g, 'a1')
    g.battleAct({ action: 'drone.deploy', target: { side: 'ally', slot: 2 }, pick: { drone: 1 } })
    g.battleAct({ action: 'drone.deploy', target: { side: 'ally', slot: 1 }, pick: { drone: 2 } })
    const [shield, scout] = g.battle!.overlays
    g.battleAct({ action: 'drone.command', target: { overlay: scout!.id }, pick: { at: 'f1' } })
    expect(g.battle!.units.f1!.statuses.map((s) => s.id)).toContain('marked')
    // 敵人打第 2 格的人：迴避多 2
    turnTo(g, 'f1')
    const hit = g.battleAct({ action: 'shoot', target: { unit: 'a2' } })
    expect(hit.reports[0]!.timeline.find((b) => b.roll)!.roll!.dc).toBe(12 + 2)
    // 敵人可以單獨瞄準無人機：永遠暴露
    const load = g.battle!.units.a1!.load!.now
    g.state.battle!.overlays[0]!.hp.now = 1
    turnTo(g, 'f1')
    for (let i = 0; i < 12 && !g.battle!.overlays[0]!.down; i++) { turnTo(g, 'f1').weapons[0]!.mag!.now = 2; g.battleAct({ action: 'shoot', target: { overlay: shield!.id } }) }
    expect(g.battle!.overlays[0]!.down).toBe(true)
    expect(g.battle!.units.a1!.load!.now).toBe(load + 5)
    expect(g.battle!.overlays.map((o) => o.autonomous)).toEqual([true, true])
  })
})

describe('載具與控制節點', () => {
  it('載具不是單位，是叫來的掩體：我方的一格變成掩體，耐久比一般的高；被打爛了就是暴露', () => {
    const g = game([pilot()])
    turnTo(g, 'a1')
    expect(g.battleAct({ action: 'vehicle.call', target: { side: 'ally', slot: 1 } }).status).toBe('applied')
    expect(g.battle!.cover.ally[0]).toMatchObject({ level: 2, hp: 60, max: [30, 60] })
    expect(opt(g, 'vehicle.call').blocks).toEqual(['這一場已經把車叫進來了。'])
  })

  it('控制節點被拿下之後可以改變戰場：關燈（黑暗：全場迴避 +2）、放下防爆門（替一格造出掩體）', () => {
    const g = game([one({ weapon: 'pistol' })], { nodes: [{ kind: 'light', name: '燈光控制' }, { kind: 'door', name: '防爆門' }] })
    turnTo(g, 'a1')
    expect(opt(g, 'node.use').blocks).toEqual(['還沒有拿下任何控制節點。'])
    for (const n of g.state.battle!.nodes) n.taken = true
    expect(g.battleAct({ action: 'node.use', target: { node: 'n1' } }).status).toBe('applied')
    expect(g.battle!.field.dark).toBe(true)
    expect(g.battleAct({ action: 'node.use', target: { node: 'n2' }, pick: { slot: 1 } }).status).toBe('applied')
    expect(g.battle!.cover.ally[0]).toMatchObject({ level: 2, hp: 30 })
    expect(g.battle!.nodes.map((n) => n.used)).toEqual([false, true]) // 燈可以再開；防爆門放下就用掉了
  })
})
