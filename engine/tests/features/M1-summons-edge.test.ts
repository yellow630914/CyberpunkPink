// summons 功能的補充測試（驗收測試 M1-summons.test.ts 沒走到的分支）：放出與擊落的帳、五種無人機的指揮、移動與收回的錯誤、
// 載具、控制節點的錯誤與開關。用明確的功能清單（不靠 allFeatures，總表有沒有加這一行都一樣）。

import { describe, expect, it } from 'vitest'
import type { BattleUnit, ContentPack } from '../../src'
import { allFeatures } from '../../src/features'
import { summonsFeature } from '../../src/features/summons'
import { makeBattleGame } from '../../src/testkit'
import { TEST_STATUSES, duel, foe, one } from '../helpers/battle'

const PACK: ContentPack = { id: 'summons_edge', content: { battle_status: [...TEST_STATUSES] } }
const FEATURES = [...allFeatures().filter((f) => f.id !== 'summons'), summonsFeature]
const kinds = ['attack', 'shield', 'scout', 'medic', 'jammer'] as const
const drones = kinds.map((kind) => ({ kind, grade: 1 }))
const FULL = { drones, vehicle: { name: '小貨車', hp: [30, 60] } }
const pilot = (summons: unknown = FULL, skills: Record<string, number> = { sync: 6, piloting: 3, firearms: 2 }) =>
  one({ weapon: 'pistol', skills, ext: summons === null ? {} : { summons } })
const game = (allies: unknown[], more = {}, seed = 7) => makeBattleGame({ features: FEATURES, content: [PACK], battle: duel(allies, [foe('elite'), foe('elite')], { ally: [0, 0, 0, 0], foe: [0, 0, 0, 0] }, more), seed }).game
type G = ReturnType<typeof game>
const turnTo = (g: G, id: string): BattleUnit => { const b = g.state.battle!; b.turn = b.order.indexOf(id); const u = b.units[id]!; u.ap.now = u.ap.max; u.control = 'player'; return u }
const opt = (g: G, id: string) => g.battleOptions()!.actions.find((a) => a.id === id)
const deploy = (g: G, drone: number, slot: number) => g.battleAct({ action: 'drone.deploy', target: { side: 'ally', slot }, pick: { drone } })
const refused = (r: { status: string; reasons?: string[] }, ...reasons: string[]) => expect(r).toMatchObject({ status: 'refused', reasons })

describe('誰有這些行動', () => {
  it('沒有 ext.summons 的人沒有無人機與叫車的行動；每個人都有控制節點（只要場上有節點）', () => {
    const g = game([pilot(null)], { nodes: [{ kind: 'light', name: '燈' }] })
    turnTo(g, 'a1')
    for (const id of ['drone.deploy', 'drone.command', 'drone.move', 'drone.recall', 'vehicle.call']) expect(opt(g, id)).toBeUndefined()
    expect(opt(g, 'node.use')).toBeDefined()
    const g2 = game([pilot(null)])
    turnTo(g2, 'a1')
    expect(opt(g2, 'node.use')).toBeUndefined()
  })

  it('有無人機但還沒放出：指揮、移動、收回列著但是灰的；只有載具的人沒有無人機的行動', () => {
    const g = game([pilot()])
    turnTo(g, 'a1')
    for (const id of ['drone.command', 'drone.move', 'drone.recall']) expect(opt(g, id)).toMatchObject({ ok: false, blocks: ['沒有可以選的目標。'] })
    const g2 = game([pilot({ vehicle: { name: '車', hp: [30, 60] } })])
    turnTo(g2, 'a1')
    expect(opt(g2, 'drone.deploy')).toBeUndefined()
    expect(opt(g2, 'vehicle.call')).toBeDefined()
  })
})

describe('放出', () => {
  it('同步 0 與 1 連 1 台、6 連 4 台；放得出去的台數就是上限', () => {
    for (const [sync, cap] of [[0, 1], [1, 1], [4, 3], [6, 4]] as const) {
      const g = game([pilot({ drones }, { sync, piloting: 1 })])
      turnTo(g, 'a1')
      for (let i = 0; i < cap; i++) { g.state.battle!.units.a1!.ap.now = 5; expect(deploy(g, i, i + 1).status).toBe('applied') }
      g.state.battle!.units.a1!.ap.now = 5
      expect(opt(g, 'drone.deploy')!.blocks).toEqual([`同步 ${sync} 級只連得住 ${cap} 台。`])
      refused(deploy(g, cap, 4), `同步 ${sync} 級只連得住 ${cap} 台。`)
    }
  })

  it('沒有 sync 技能當 0 級；每一台都放出去了：「沒有可以放的無人機了。」', () => {
    const g = game([pilot({ drones: [{ kind: 'attack', grade: 1 }] }, {})])
    turnTo(g, 'a1')
    expect(deploy(g, 0, 1).status).toBe('applied')
    expect(opt(g, 'drone.deploy')!.blocks).toEqual(['同步 0 級只連得住 1 台。', '沒有可以放的無人機了。'])
  })

  it('無效的索引、同一台放兩次、空格也可以掛、不是我方的格不行', () => {
    const g = game([pilot()])
    turnTo(g, 'a1')
    for (const drone of [undefined, -1, 5, 1.5, '0']) refused(g.battleAct({ action: 'drone.deploy', target: { side: 'ally', slot: 4 }, pick: drone === undefined ? {} : { drone } }), '沒有這一台無人機。')
    expect(deploy(g, 0, 4).status).toBe('applied') // 第 4 格是空的，照樣可以掛
    refused(deploy(g, 0, 3), '沒有這一台無人機。')
    expect(g.battleAct({ action: 'drone.deploy', target: { side: 'foe', slot: 1 }, pick: { drone: 1 } }).status).toBe('refused')
  })

  it('照等級的生命與護甲、名字沒寫就用種類的名字、寫了就用寫的；迴避是基礎加 3', () => {
    const g = game([pilot({ drones: [{ kind: 'medic', grade: 4 }, { kind: 'jammer', grade: 2, name: '小黑', item: 'it_x' }] })])
    turnTo(g, 'a1')
    deploy(g, 0, 1)
    deploy(g, 1, 2)
    const [a, b] = g.battle!.overlays
    expect(a).toMatchObject({ name: '醫療無人機', hp: { now: 25, max: 25 }, armor: 4, evade: 13, used: false, ext: { drone: 0, grade: 4 } })
    expect(b).toMatchObject({ name: '小黑', kind: 'jammer', hp: { now: 17 }, armor: 2, item: 'it_x' })
    expect(a!.id).not.toBe(b!.id)
  })

  it('收回之後可以再放出（同一台）；被擊落的這一場不能再放', () => {
    const g = game([pilot()])
    turnTo(g, 'a1')
    deploy(g, 0, 1)
    const d = g.battle!.overlays[0]!
    expect(g.battleAct({ action: 'drone.recall', target: { overlay: d.id } }).status).toBe('applied')
    expect(deploy(g, 0, 2).status).toBe('applied')
    g.state.battle!.overlays[0]!.hp.now = 0
    g.state.battle!.overlays[0]!.down = true
    g.state.battle!.units.a1!.uses['drone:0'] = 2
    refused(deploy(g, 0, 3), '沒有這一台無人機。')
    // 被擊落的不佔同步的名額、也不佔那一格
    expect(deploy(g, 1, 2).status).toBe('applied')
  })
})

describe('指揮', () => {
  const setup = (idx: number, slot = 1, seed = 7) => {
    const g = game([pilot(), one({ weapon: 'rifle' }, 2)], {}, seed)
    turnTo(g, 'a1')
    deploy(g, idx, slot)
    return { g, d: g.battle!.overlays[0]! }
  }

  it('攻擊型：沒給目標、目標不是敵人、目標已經倒下，都不能指揮，也不算動過', () => {
    const { g, d } = setup(0)
    refused(g.battleAct({ action: 'drone.command', target: { overlay: d.id } }), '要選一個敵人。')
    refused(g.battleAct({ action: 'drone.command', target: { overlay: d.id }, pick: { at: 'a2' } }), '要選一個敵人。')
    refused(g.battleAct({ action: 'drone.command', target: { overlay: d.id }, pick: { at: 'zz' } }), '要選一個敵人。')
    expect(g.battle!.overlays[0]!.used).toBe(false)
  })

  it('攻擊型的武器：2d6 加等級骰、命中是反應加操縱、不耗操作者的彈匣', () => {
    const { g, d } = setup(0)
    const mag = g.battle!.units.a1!.weapons[0]!.mag!.now
    const r = g.battleAct({ action: 'drone.command', target: { overlay: d.id }, pick: { at: 'f1' } })
    const roll = r.reports[0]!.timeline.find((b) => b.roll)!.roll!
    expect(roll.skill).toBe('piloting')
    expect(roll.parts.find((p) => p.source === 'weapon')).toMatchObject({ value: 2 + 3 }) // mod(反應 15) 2 + 操縱 3
    expect(g.battle!.units.a1!.weapons[0]!.mag!.now).toBe(mag)
    expect(g.battle!.overlays[0]!.used).toBe(true)
  })

  it('干擾型：電磁傷害', () => {
    const { g, d } = setup(4)
    // 打到命中為止（種子固定）：用感載的變化確認傷害類型是電磁（對有橋的敵人是打感載還是生命看資料，這裡只看紀錄的武器名）
    const r = g.battleAct({ action: 'drone.command', target: { overlay: d.id }, pick: { at: 'f1' } })
    expect(r.status).toBe('applied')
    expect(r.reports[0]!.timeline.some((b) => b.text.includes('干擾無人機'))).toBe(true)
  })

  it('偵察型：標記；沒給敵人不行', () => {
    const { g, d } = setup(2)
    refused(g.battleAct({ action: 'drone.command', target: { overlay: d.id } }), '要選一個敵人。')
    expect(g.battleAct({ action: 'drone.command', target: { overlay: d.id }, pick: { at: 'f2' } }).status).toBe('applied')
    expect(g.battle!.units.f2!.statuses.map((s) => s.id)).toEqual(['marked'])
    expect(g.battle!.units.f2!.statuses[0]!.by).toBe('a1')
  })

  it('護盾型：指揮就是守著同一格的人（不用選敵人），算動過；到操作者的下一個回合開始', () => {
    const { g, d } = setup(1)
    expect(g.battleAct({ action: 'drone.command', target: { overlay: d.id } }).status).toBe('applied')
    expect(g.battle!.overlays[0]).toMatchObject({ used: true, ext: { guard: 'own_turn_start' } })
    refused(g.battleAct({ action: 'drone.command', target: { overlay: d.id } }), '這一台這一回合動過了。')
  })

  it('醫療型：同一格的隊友回血、止血；那一格沒有人不行', () => {
    const { g, d } = setup(3, 2)
    const mate = g.state.battle!.units.a2!
    mate.hp!.now = 10
    mate.statuses.push({ id: 'bleeding', until: { at: 'battle_end' } })
    expect(g.battleAct({ action: 'drone.command', target: { overlay: d.id } }).status).toBe('applied')
    expect(g.battle!.units.a2!.hp!.now).toBeGreaterThanOrEqual(12)
    expect(g.battle!.units.a2!.statuses).toEqual([])
    const g2 = game([pilot()])
    turnTo(g2, 'a1')
    deploy(g2, 3, 3)
    refused(g2.battleAct({ action: 'drone.command', target: { overlay: g2.battle!.overlays[0]!.id } }), '那一格沒有人。')
  })

  it('每回合一次；輪到操作者的下一個回合又能指揮', () => {
    const { g, d } = setup(2)
    g.battleAct({ action: 'drone.command', target: { overlay: d.id }, pick: { at: 'f1' } })
    expect(g.battleOptions()!.actions.find((a) => a.id === 'drone.command')!.targets[0]!.blocks).toEqual(['這一台這一回合動過了。'])
    const round = g.battle!.round
    for (let i = 0; i < 40 && !(g.battle!.round > round && g.battleOptions()!.current === 'a1'); i++) {
      const o = g.battleOptions()!
      if (o.waiting === 'ai') g.battleNext()
      else { turnTo(g, o.current!); g.battleAct({ action: 'end_turn' }) }
    }
    expect(g.battleOptions()!.current).toBe('a1')
    expect(g.battle!.overlays[0]!.used).toBe(false)
    expect(g.battleOptions()!.actions.find((a) => a.id === 'drone.command')!.targets[0]!.blocks).toEqual([])
  })

  it('不存在的、已經擊落的目標選不了', () => {
    const { g, d } = setup(2)
    // 核心先檢查目標列得出來沒有：不存在的、已經擊落的都選不了
    refused(g.battleAct({ action: 'drone.command', target: { overlay: 'o99' }, pick: { at: 'f1' } }), '這個目標不能選。')
    g.state.battle!.overlays[0]!.down = true
    refused(g.battleAct({ action: 'drone.recall', target: { overlay: d.id } }), '沒有可以選的目標。')
  })
})

describe('移動與收回', () => {
  it('只能換到相鄰、沒有掛著別台的格；每一種錯法都不扣行動點', () => {
    const g = game([pilot()])
    turnTo(g, 'a1')
    deploy(g, 0, 2)
    deploy(g, 1, 3)
    const [a] = g.battle!.overlays
    const ap = g.battle!.units.a1!.ap.now
    for (const slot of [undefined, 2, 3.5, 0, 5, '1', 3, 4]) {
      refused(g.battleAct({ action: 'drone.move', target: { overlay: a!.id }, ...(slot === undefined ? {} : { pick: { slot } }) }), '只能換到相鄰、沒有掛著別台的格。')
    }
    expect(g.battle!.overlays[0]!.slot).toBe(2)
    expect(g.battle!.units.a1!.ap.now).toBe(ap)
  })

  it('移動不看「動過了」：指揮完還能移動', () => {
    const g = game([pilot(), one({ weapon: 'rifle' }, 2)])
    turnTo(g, 'a1')
    deploy(g, 2, 1)
    const d = g.battle!.overlays[0]!
    g.battleAct({ action: 'drone.command', target: { overlay: d.id }, pick: { at: 'f1' } })
    expect(g.battleAct({ action: 'drone.move', target: { overlay: d.id }, pick: { slot: 2 } }).status).toBe('applied')
  })
})

describe('被動與被擊落', () => {
  it('護盾型被擊落之後，同一格的人不再多 2 點迴避；護盾換格之後跟著走', () => {
    const g = game([pilot(), one({ weapon: 'rifle' }, 2)])
    turnTo(g, 'a1')
    deploy(g, 1, 2)
    const dc = (slot: number) => { const id = `a${slot}`; turnTo(g, 'f1').weapons[0]!.mag!.now = 3; return g.battleAct({ action: 'shoot', target: { unit: id } }).reports[0]!.timeline.find((b) => b.roll)!.roll!.dc }
    expect(dc(2)).toBe(14)
    turnTo(g, 'a1')
    g.battleAct({ action: 'drone.move', target: { overlay: g.battle!.overlays[0]!.id }, pick: { slot: 1 } })
    expect(dc(2)).toBe(12)
    expect(dc(1)).toBe(14)
    g.state.battle!.overlays[0]!.down = true
    expect(dc(1)).toBe(12)
  })

  it('被擊落：操作者感載 +5、這一場不能再放；操作者已經倒下就不加', () => {
    const g = game([pilot(), one({ weapon: 'rifle' }, 2)])
    turnTo(g, 'a1')
    deploy(g, 1, 2)
    const o = g.battle!.overlays[0]!
    g.state.battle!.overlays[0]!.hp.now = 1
    turnTo(g, 'f1').weapons[0]!.mag!.now = 3
    for (let i = 0; i < 20 && !g.battle!.overlays[0]!.down; i++) { turnTo(g, 'f1').weapons[0]!.mag!.now = 3; g.battleAct({ action: 'shoot', target: { overlay: o.id } }) }
    expect(g.battle!.overlays[0]!.down).toBe(true)
    expect(g.battle!.units.a1!.uses['drone:1']).toBe(2)
    expect(g.battle!.units.a1!.load!.now).toBe(5)
  })

  it('操作者倒下：所有無人機進入自律模式（沒有操作者、自己動），沒有被擊落的後果（不加感載、不記成擊落）', () => {
    const g = game([pilot(), one({ weapon: 'rifle' }, 2)])
    turnTo(g, 'a1')
    deploy(g, 0, 1)
    deploy(g, 1, 2)
    g.state.battle!.units.a1!.hp!.now = 1
    for (let i = 0; i < 30 && !g.battle!.units.a1!.out; i++) { const f = turnTo(g, 'f1'); f.weapons[0]!.mag!.now = 3; g.battleAct({ action: 'shoot', target: { unit: 'a1' } }) }
    expect(g.battle!.units.a1!.out).toBe('down')
    // COMBAT_SYSTEM 9.1 節：自律模式（dev/adr/0015 E6，兩邊統一）：還在、沒有操作者、每一輪自己動；不發 overlay.down，所以沒有回灌
    expect(g.battle!.overlays.map((o) => o.down)).toEqual([false, false])
    expect(g.battle!.overlays.map((o) => ({ owner: o.owner, auto: o.auto, orphan: o.ext!.orphan }))).toEqual([{ owner: undefined, auto: true, orphan: true }, { owner: undefined, auto: true, orphan: true }])
    expect(g.battle!.units.a1!.load!.now).toBe(0)
    expect(g.battle!.units.a1!.uses['drone:0']).toBe(1)
  })
})

describe('載具', () => {
  it('叫車花 2 點；載具不是單位、不佔格；已經是半掩體的格子也能升成掩體；格式不對的耐久退回預設', () => {
    const g = game([pilot({ drones, vehicle: { name: '壞掉的車', hp: ['x', 0] } })])
    const me = turnTo(g, 'a1')
    expect(opt(g, 'vehicle.call')!.cost.ap).toBe(2)
    g.state.battle!.cover.ally[1] = { level: 1, hp: 3 } as never
    expect(g.battleAct({ action: 'vehicle.call', target: { side: 'ally', slot: 2 } }).status).toBe('applied')
    expect(g.battle!.cover.ally[1]).toMatchObject({ level: 2, hp: 30 })
    expect(g.battle!.cover.ally[1]!.max).toBeUndefined()
    expect(g.battle!.units.a1!.ap.now).toBe(me.ap.max - 2)
    refused(g.battleAct({ action: 'vehicle.call', target: { side: 'ally', slot: 3 } }), '這一場已經把車叫進來了。')
  })

  it('只能停在我方的格；被打爛了就是暴露', () => {
    const g = game([pilot()])
    turnTo(g, 'a1')
    expect(g.battleAct({ action: 'vehicle.call', target: { side: 'foe', slot: 1 } }).status).toBe('refused')
    expect(g.battleAct({ action: 'vehicle.call', target: { unit: 'a1' } }).status).toBe('refused')
    g.battleAct({ action: 'vehicle.call', target: { side: 'ally', slot: 1 } })
    expect(g.battleOptions()!.actions.find((a) => a.id === 'vehicle.call')!.targets).toHaveLength(4)
  })
})

describe('控制節點', () => {
  const nodes = [{ kind: 'light', name: '燈光控制' }, { kind: 'door', name: '防爆門' }, { kind: 'turret', name: '砲塔' }]
  const setup = () => { const g = game([one({ weapon: 'pistol' })], { nodes }); turnTo(g, 'a1'); return g }

  it('每一個節點都列出來，沒拿下的與用掉的帶著原因', () => {
    const g = setup()
    g.state.battle!.nodes[0]!.taken = true
    g.state.battle!.nodes[1]!.taken = true
    g.state.battle!.nodes[1]!.used = true
    expect(opt(g, 'node.use')!.targets.map((t) => t.blocks)).toEqual([[], ['這個節點已經用掉了。'], ['這個節點還沒有拿下。']])
    expect(opt(g, 'node.use')!.blocks).toEqual([])
  })

  it('燈可以一直用：關了再開；黑暗只有一個開關', () => {
    const g = setup()
    g.state.battle!.nodes[0]!.taken = true
    g.battleAct({ action: 'node.use', target: { node: 'n1' } })
    expect(g.battle!.field.dark).toBe(true)
    g.battleAct({ action: 'node.use', target: { node: 'n1' } })
    expect('dark' in g.battle!.field).toBe(false)
    expect(g.battle!.nodes[0]!.used).toBe(false)
  })

  it('沒拿下的、用掉的、沒給格子、格子不對、不認得的種類，都做不成，也不扣行動點', () => {
    const g = setup()
    const ap = g.battle!.units.a1!.ap.now
    refused(g.battleAct({ action: 'node.use', target: { node: 'n2' }, pick: { slot: 1 } }), '還沒有拿下任何控制節點。')
    for (const n of g.state.battle!.nodes) n.taken = true
    refused(g.battleAct({ action: 'node.use', target: { node: 'n2' } }), '要選放在哪一格。')
    refused(g.battleAct({ action: 'node.use', target: { node: 'n2' }, pick: { slot: 5 } }), '要選放在哪一格。')
    refused(g.battleAct({ action: 'node.use', target: { node: 'n3' } }), '這個節點現在用不了。')
    refused(g.battleAct({ action: 'node.use', target: { node: 'n9' } }), '這個目標不能選。')
    expect(g.battle!.units.a1!.ap.now).toBe(ap)
    g.battleAct({ action: 'node.use', target: { node: 'n2' }, pick: { slot: 4 } })
    refused(g.battleAct({ action: 'node.use', target: { node: 'n2' }, pick: { slot: 4 } }), '這個節點已經用掉了。')
  })

  it('有一個節點拿下了就不是「還沒有拿下任何」；每個人都花 1 點', () => {
    const g = setup()
    g.state.battle!.nodes[2]!.taken = true
    expect(opt(g, 'node.use')).toMatchObject({ blocks: [], cost: { ap: 1 } })
  })
})
