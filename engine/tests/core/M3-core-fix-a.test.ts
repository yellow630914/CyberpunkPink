// 驗收測試：dev/adr/0018「實作補記：M3-core-fix-a」。
//   一、內海（mode.layer === 'net'）的 run.overlayHurt／damageOverlay／attackOverlay：感載類的傷害（神經、快感）打在掛著的東西的耐久上，
//       護甲照那一種傷害的 armor 比例；現實維持無效（tests/core/battle-m1b-closeout.test.ts「感載類的傷害對它無效」）。
//   二、核心的 leave() 認得 pinned：一句「被釘住」、標籤 pin（不是通用的「退出了戰鬥」與 down）。
// 內容用測試自帶的最小資料（單位、掛著的東西、一份把神經的護甲比例改成 0.5 的傷害類型）。

import { describe, expect, it } from 'vitest'
import type { BattleOverlay, Kernel } from '../../src'
import { laceUnit, netAvatar, netWeapon } from '../../src/testkit'
import { TEST_STATUSES, arena, duel, foe, netArena, netDuel, one } from '../helpers/battle'
import type { Arena } from '../helpers/battle'

const overlay = (o: Partial<BattleOverlay> = {}): BattleOverlay => ({
  id: 'o1', side: 'foe', slot: 1, owner: 'f1', kind: 'shield', name: 'o1', hp: { now: 20, max: 20 }, armor: 0, evade: 0, used: false, down: false, ...o,
})

/** 內海：蕾絲對化身，敵方第 1 格掛一台（預設耐久 20、護甲 0）。 */
const netHung = (o: Partial<BattleOverlay> = {}, prepare?: (k: Kernel) => void): Arena => {
  const a = netArena(netDuel([netAvatar(0)], [laceUnit('elite')]), prepare)
  a.battle.overlays.push(overlay(o))
  return a
}
/** 現實：敵方第 1 格掛一台。 */
const meatHung = (o: Partial<BattleOverlay> = {}): Arena => {
  const a = arena(duel([one({ weapon: 'pistol' })], [foe('elite')]), undefined, (k) => k.content.loadPack({ id: 'p', content: { battle_status: TEST_STATUSES } }))
  a.battle.overlays.push(overlay(o))
  return a
}

describe('內海：感載類的傷害打得到掛著的東西（dev/adr/0018 N27、M3-core-fix-a）', () => {
  it('神經傷害打在耐久上，護甲不看（神經的 armor 比例是 0）；記一拍「受到 N 點神經傷害」', () => {
    const a = netHung({ armor: 5 })
    const o = a.battle.overlays[0]!
    const run = a.run()
    const foeUnit = a.foe(1)
    expect(run.damageOverlay(o, 10, 'neural', foeUnit)).toEqual({ dealt: 10, downed: false })
    expect(o.hp.now).toBe(10)
    expect(run.beats.map((b) => b.text)).toEqual(['o1受到 10 點神經傷害。'])
    expect(run.beats[0]).toMatchObject({ tag: 'damage', data: { overlay: 'o1', type: 'neural', amount: 10, left: 10 } })
  })

  it('快感也一樣；掛著的東西沒有沉溺，不會有人多一點沉溺', () => {
    const a = netHung({ armor: 3 })
    const o = a.battle.overlays[0]!
    const sink = a.foe(1).sink
    expect(a.run().damageOverlay(o, 7, 'pleasure', a.foe(1))).toEqual({ dealt: 7, downed: false })
    expect(o.hp.now).toBe(13)
    expect(a.foe(1).sink).toBe(sink)
  })

  it('耐久歸零就擊落：overlay.down 掛點、down 與 hp 歸零；擊落之後再打什麼都不做', () => {
    const downs: string[] = []
    const a = netHung({ hp: { now: 5, max: 5 } }, (k) => k.battle.on('overlay.down', 't', ({ overlay: o, by }) => { downs.push(`${o.id}:${by?.id}`) }))
    const o = a.battle.overlays[0]!
    const run = a.run()
    expect(run.damageOverlay(o, 99, 'neural', a.foe(1))).toEqual({ dealt: 99, downed: true })
    expect(o).toMatchObject({ down: true, hp: { now: 0 } })
    expect(downs).toEqual(['o1:f1'])
    const beats = run.beats.length
    expect(run.damageOverlay(o, 99, 'neural', a.foe(1))).toEqual({ dealt: 0, downed: false })
    expect(run.beats).toHaveLength(beats)
  })

  it('護甲照傷害類型的 armor 比例：神經改成 0.5 之後，護甲 6 只扣 3；穿甲抵銷護甲；armorMult 乘在護甲上；物理照扣全部', () => {
    const a = netHung({ armor: 6, hp: { now: 99, max: 99 } }, (k) =>
      k.content.loadPack({ id: 'half', content: { damage_type: [{ id: 'neural', name: '神經', track: 'load', armor: 0.5, needs_bridge: true }] } } as never))
    const o = a.battle.overlays[0]!
    const run = a.run()
    expect(run.damageOverlay(o, 10, 'neural', a.foe(1)).dealt).toBe(7)
    expect(run.damageOverlay(o, 10, 'neural', a.foe(1), { pierce: 2 }).dealt).toBe(9)
    expect(run.damageOverlay(o, 10, 'neural', a.foe(1), { armorMult: 0 }).dealt).toBe(10)
    expect(run.damageOverlay(o, 10, 'physical', a.foe(1)).dealt).toBe(4)
    expect(o.hp.now).toBe(99 - 7 - 9 - 10 - 4)
  })

  it('護甲擋得光的物理傷害照舊記「護甲擋下了這一擊」；內海的物理傷害與現實同一份算法', () => {
    const a = netHung({ armor: 5 })
    const run = a.run()
    expect(run.damageOverlay(a.battle.overlays[0]!, 4, 'physical', a.foe(1))).toEqual({ dealt: 0, downed: false })
    expect(run.beats.at(-1)!.text).toBe('o1的護甲擋下了這一擊。')
  })

  it('做的人的傷害倍率：感載類讀 dmgMult.load（不是 hp），最少還是 1 點', () => {
    const a = netHung({ hp: { now: 99, max: 99 } })
    const o = a.battle.overlays[0]!
    const f = a.foe(1)
    f.dmgMult = { hp: 3, load: 0.5 }
    expect(a.run().damageOverlay(o, 10, 'neural', f).dealt).toBe(5)
    f.dmgMult = { hp: 3, load: 0.01 }
    expect(a.run().damageOverlay(o, 10, 'neural', f).dealt).toBe(1)
    // 物理的仍讀 hp
    f.dmgMult = { hp: 2, load: 0.5 }
    expect(a.run().damageOverlay(o, 10, 'physical', f).dealt).toBe(20)
  })

  it('命中的路（attackOverlay）：內海蕾絲的神經武器打得到掛著的東西，擊落時發 overlay.down', () => {
    const lace = laceUnit('elite', 1, { evade: 0, weapons: [netWeapon(99, 4, { type: 'neural' })] } as never)
    const a = netArena(netDuel([netAvatar(0)], [lace]))
    a.battle.overlays.push(overlay({ armor: 9, hp: { now: 3, max: 3 } }))
    const o = a.battle.overlays[0]!
    const r = a.run([5, 6, 6, 6, 6, 6, 6, 6, 6]).attackOverlay(a.foe(1), o, { natural: 20 })
    expect(r.hit).toBe(true)
    expect(r.dealt).toBeGreaterThan(0)
    expect(r.downed).toBe(true)
    expect(o).toMatchObject({ down: true, hp: { now: 0 } })
  })
})

describe('現實：感載類的傷害對掛著的東西仍然無效', () => {
  it('神經與快感：記一拍「沒有橋」、耐久不變、不算擊落（同 battle-m1b-closeout，這裡再對照一次）', () => {
    const a = meatHung({ armor: 0 })
    const o = a.battle.overlays[0]!
    const run = a.run()
    expect(run.damageOverlay(o, 50, 'neural', a.ally(1))).toEqual({ dealt: 0, downed: false })
    expect(run.damageOverlay(o, 50, 'pleasure', a.ally(1))).toEqual({ dealt: 0, downed: false })
    expect(o.hp.now).toBe(20)
    expect(run.beats.map((b) => b.text)).toEqual(['o1沒有橋，神經傷害對它無效。', 'o1沒有橋，快感傷害對它無效。'])
  })
})

describe('核心的 leave() 認得 pinned', () => {
  it('被釘住：一句「被釘住」、標籤 pin、data 帶 target、how、side、by；不是通用的退出與 down', () => {
    const a = netArena(netDuel([netAvatar(0)], [laceUnit('minion'), laceUnit('minion')]))
    const run = a.run()
    expect(run.setOut(a.foe(1), 'pinned', a.ally(1))).toBe(true)
    expect(a.foe(1).out).toBe('pinned')
    const beat = run.beats.find((b) => b.data?.target === 'f1')!
    expect(beat.tag).toBe('pin')
    expect(beat.text).toContain('被釘住')
    expect(beat.text).not.toContain('退出了戰鬥')
    expect(beat.data).toMatchObject({ target: 'f1', how: 'pinned', side: 'foe', by: 'a1' })
    expect(run.beats.filter((b) => b.tag === 'down')).toEqual([])
  })

  it('沒有人釘（直接用核心的退出、沒有 by）也一樣；一個人只記一拍；已經退出的不重複', () => {
    const a = netArena(netDuel([netAvatar(0), netAvatar(1)], [laceUnit('minion')]))
    const run = a.run()
    expect(run.setOut(a.ally(2), 'pinned')).toBe(true)
    expect(run.setOut(a.ally(2), 'pinned')).toBe(false)
    const beats = run.beats.filter((b) => b.tag === 'pin')
    expect(beats).toHaveLength(1)
    expect(beats[0]!.data).toMatchObject({ target: 'a2', how: 'pinned', side: 'ally' })
    expect(beats[0]!.data).not.toHaveProperty('by')
  })

  it('其他退出的方式照舊：沒登記的方式仍是通用的一句與 down；倒下、拔線、制伏的標籤不變', () => {
    const a = netArena(netDuel([netAvatar(0), netAvatar(1), netAvatar(2), netAvatar(3)], [laceUnit('minion'), laceUnit('minion'), laceUnit('minion')]))
    const run = a.run()
    run.setOut(a.ally(1), 'jacked_out')
    run.setOut(a.ally(2), 'subdued')
    run.setOut(a.ally(3), 'whatever')
    run.setOut(a.ally(4), 'down')
    const tags = (id: string) => run.beats.find((b) => b.data?.target === id)!.tag
    expect([tags('a1'), tags('a2'), tags('a3'), tags('a4')]).toEqual(['jack_out', 'subdue', 'down', 'down'])
    expect(run.beats.find((b) => b.data?.target === 'a3')!.text).toContain('退出了戰鬥')
  })
})
