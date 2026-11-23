// 驗收測試：dev/work/M2-explore.md（cpp-feature）。
// 規格：SITES 12.5 節（監視器、被看到、門鎖、巡邏、用哪個遭遇點）、12.1 節（標記）；COMMISSIONS 2.3 節（警戒 60 增援、100 為上限）；
// COMMISSION_MAPS 1.1、1.3、1.5 節；DATA 9.3 節（controls、patrols、zones）；dev/adr/0012、0016 第三節（量表 alert）、第五節與第七節（地圖實例的 ext）。
// 內容一律用測試自帶的假資料：DATA 9.3 節那張小辦公室（只在 (3,5) 多放一個保險箱 $，樣本裡沒有這個標記）。
//
// 擲骰的測試不假設骰面：對每個種子先算「這件事會成功或失敗」（呼叫純函式的草稿看結果），挑到要的那個種子再提交。

import { describe, expect, it } from 'vitest'
import type { Change, ContentPack, Feature, ReportDraft, SpecialMapEntry } from '../../src'
import { ActionBlocked, effectCtx, meterOf } from '../../src'
import { arrive, exploreFeature, unlock } from '../../src/features/explore'
import { TEST_COMBAT, enemyUnit, makeGame, playOut, testWeapon } from '../../src/testkit'

type Pt = [number, number]

const OFFICE = {
  id: 'office', name: '二樓的辦公室', size: [9, 9],
  layout: ['####=E###', '#TOT#.OS#', '#.2.%G1.#', '#DC.#o.o#', '######+##', '#T&$#.GS#', 'E...%.O.#', '#X..#C.K#', '######E##'],
  zones: ['####bb###', '#ccc#bbb#', '#ccccbbb#', '#ccc#bbb#', '######a##', '#ddd#aaa#', 'dddddaaa#', '#ddd#aaa#', '######a##'],
  zone_names: { a: '接待區', b: '開放座位', c: '主管室', d: '茶水間與後門' },
  cells: [
    { id: 'E1', at: [5, 0], mark: 'E', kind: 'window', name: '二樓的窗' },
    { id: 'E2', at: [0, 6], mark: 'E', kind: 'back', name: '後門（茶水間旁的防火門）' },
    { id: 'E3', at: [6, 8], mark: 'E', kind: 'front', name: '正門' },
    { id: 'T1', at: [1, 1], mark: 'T', name: '牆上的保險櫃' }, { id: 'T2', at: [3, 1], mark: 'T', name: '主管室的辦公桌' }, { id: 'T3', at: [1, 5], mark: 'T', name: '茶水間後面的檔案間' },
    { id: 'D1', at: [1, 3], mark: 'D', name: '主管室的終端下方的網路孔' },
    { id: 'C1', at: [2, 3], mark: 'C', name: '主管室的控制面板' },
    { id: '$1', at: [3, 5], mark: '$', name: '檔案間的小保險箱' },
    { id: '&1', at: [2, 5], mark: '&', name: '檔案間（人質放在這裡）' },
    { id: 'C2', at: [5, 7], mark: 'C', name: '接待區的控制面板' },
    { id: 'K1', at: [7, 7], mark: 'K', name: '接待區的員工外套掛架' },
    { id: 'G1', at: [5, 2], mark: 'G', name: '主管室門口' }, { id: 'G2', at: [6, 5], mark: 'G', name: '接待櫃檯' },
    { id: 'X1', at: [1, 7], mark: 'X', name: '後門' },
    { id: 'S1', at: [7, 1], mark: 'S', name: '開放座位的監視器' }, { id: 'S2', at: [7, 5], mark: 'S', name: '接待區的監視器' },
  ],
  spots: [{ id: '!1', at: [6, 2], cover: 'dense' }, { id: '!2', at: [2, 2], cover: 'one_sided' }],
  controls: [
    { id: 'C1', at: [2, 3], zones: ['c', 'd'], node: 'cn_back_half', devices: ['light', 'safe_lock'] },
    { id: 'C2', at: [5, 7], zones: ['a', 'b'], node: 'cn_front_half', devices: ['door', 'camera'] },
  ],
  patrols: [{ guard: 'G2', route: ['a', 'b', 'a', 'd'] }],
}
const MAP = { id: 'map_office_small', kind: 'office_small', size: [9, 9], sheets: [OFFICE] } as unknown as SpecialMapEntry
const PACK: ContentPack = { id: 'explore_m2', content: { special_map: [MAP] } }

// 主角要有武器（M1 的探索測試同一招）；檢定要強到只有自然 1 會失敗
const GEAR = { id: 'test_gear', install(k: { battle: { loadout(o: string, fn: () => unknown): void } }) { k.battle.loadout('test_gear', () => ({ weapons: [testWeapon('pistol', 5)] })) } }
const STRONG = { attrs: { tech: 20, intellect: 20, body: 20 }, skills: { mechanics: 5, interface: 5, athletics: 5 } }
const foe = () => ({ from: 'unit', unit: enemyUnit('minion', 1, { hp: { now: 1, max: 45 }, evade: -30 }) as unknown as Record<string, unknown> })
/** 接待區與開放座位的監視器都接管了（先把監視器關掉，專心測別的）。 */
const QUIET = ['office:a', 'office:b']

interface Opts { ext?: Record<string, unknown>; at?: string; seed?: number; features?: Feature[] }
function setup(o: Opts = {}) {
  const t = makeGame({ seed: o.seed, features: [exploreFeature, TEST_COMBAT, GEAR as never, ...(o.features ?? [])], content: [PACK], pc: STRONG })
  const id = t.game.enterMap('map_office_small', { at: o.at ?? 'E3', ...(o.ext ? { ext: o.ext } : {}) })
  return { ...t, id }
}
type G = ReturnType<typeof setup>['game']

const alertOf = (g: G, id = 'm1') => meterOf(g.k, g.state, 'alert', id)
const instance = (g: G) => g.state.maps.instances.m1!
const cellsOf = (g: G) => instance(g).sheets.office?.cells ?? {}
const moversOf = (g: G) => instance(g).sheets.office?.movers ?? {}
const extOf = (g: G) => (instance(g).ext ?? {}) as Record<string, unknown>
const commit = (g: G, changes: Change[]) => g.commit({ kind: 'system', action: 'test', location: {}, party: [], timeline: [], changes, outcome: { result: 'ok', summary: '測試' } })
const stand = (g: G, x: number, y: number) => commit(g, [{ op: 'map.at', to: { map: 'm1', sheet: 'office', x, y } }])
const setAlert = (g: G, set: number) => commit(g, [{ op: 'meter', kind: 'alert', key: 'm1', set }])
const useHere = (g: G, id: string): ReportDraft => exploreFeature.useHere(g.k, g.state, id)
const tags = (d: ReportDraft) => d.timeline.map((b) => b.tag)
const at = (g: G): Pt => [g.state.maps.at!.x, g.state.maps.at!.y]

/** 第一個讓 want 成立的種子（種子不同，同一件事的骰面不同）。 */
function seedWhere(opts: Opts, want: (g: G) => boolean): number {
  for (let seed = 1; seed <= 300; seed++) if (want(setup({ ...opts, seed }).game)) return seed
  throw new Error('找不到合適的種子')
}
const result = (f: (g: G) => ReportDraft) => (g: G): string | null => { try { return f(g).outcome.result } catch { return null } }

describe('監視器（SITES 12.5 節）', () => {
  it('在有監視器的區塊走三格警戒 +6；接管那一區之後再走不加', () => {
    const seed = seedWhere({ ext: { dc_base: 5 } }, (g) => { stand(g, 5, 7); return result((x) => useHere(x, 'seize'))(g) === 'done' })
    const { game, id } = setup({ seed, ext: { dc_base: 5 } })
    for (const dir of ['north', 'west', 'north'] as const) expect(game.gridMove(dir).status).toBe('applied') // (6,7)、(5,7)、(5,6)：都是接待區，S2 在那裡
    expect(alertOf(game, id)).toBe(6)
    expect(game.gridMove('south').reports[0]!.outcome.summary).toContain('監視器')
    expect(alertOf(game)).toBe(8)
    // 站在 C2（接待區的控制面板）上接管：控制區 C2 管 a、b 兩區
    const [report] = game.commit(useHere(game, 'seize'))
    expect(report!.action).toBe('grid.use')
    expect(extOf(game).controlled).toEqual(['office:a', 'office:b'])
    for (const dir of ['north', 'north', 'south'] as const) game.gridMove(dir)
    expect(alertOf(game)).toBe(8)
  })

  it('沒有監視器的區塊不加；一步走多格時每一格都算；走進沒被接管的另一區照加', () => {
    const { game } = setup({ at: 'E2' }) // 後門在茶水間 d：沒有監視器
    game.gridMove([3, 6])
    expect(alertOf(game)).toBe(0)
    const b = setup() // 正門 → 接待區的 (5,5)：(6,7)、(5,7)、(5,6)、(5,5) 四格都在接待區
    b.game.gridMove([5, 5])
    expect(alertOf(b.game)).toBe(8)
  })

  it('接管的是 d 區的控制面板時，接待區的監視器還在（只有那幾區失效）', () => {
    const { game } = setup({ ext: { controlled: ['office:c', 'office:d'] } })
    game.gridMove([5, 6])
    expect(alertOf(game)).toBe(6)
  })
})

describe('被看到（SITES 12.5 節）', () => {
  it('走進保全看得到的格子就開打：origin.ext.pre.spotted 是 true；不是走到保全站的那一格也算（站著的保全崗記自己的位置）', () => {
    const { game } = setup({ ext: { controlled: QUIET, guards: { G1: { foes: [foe()], faction: 'hizakura' } } } })
    const r = game.gridMove([6, 3]) // 從接待區進開放座位：(6,4) 在接待區看不到、(6,3) 一進 b 區就看得到 G1(5,2)
    expect(r.reports.map((x) => x.action)).toEqual(['grid.move', 'battle.start'])
    expect(at(game)).toEqual([6, 3])
    const o = game.battle!.origin
    expect(o).toMatchObject({ escapable: true, place: '主管室門口', faction: 'hizakura' })
    expect(o.ext).toMatchObject({ map: 'm1', sheet: 'office', guard: 'G1', at: [5, 2], pre: { spotted: true } })
    expect(o.ext).not.toHaveProperty('patrol')
  })

  it('潛行：不開打、警戒 +5；同一個保全只算一次（再走一格、走到它那一格都不重複加）', () => {
    const { game } = setup({ ext: { stealth: true, controlled: QUIET, guards: { G1: { foes: [foe()] } } } })
    const r = game.gridMove([6, 3])
    expect(r.reports.map((x) => x.action)).toEqual(['grid.move'])
    expect(game.battle).toBeNull()
    expect(alertOf(game)).toBe(5)
    expect(extOf(game).seen_by).toEqual(['G1'])
    game.gridMove('north')
    expect(alertOf(game)).toBe(5)
    game.gridMove('west') // 走進 G1 那一格：潛行不開打，也不重複加
    expect(at(game)).toEqual([5, 2])
    expect(game.battle).toBeNull()
    expect(alertOf(game)).toBe(5)
  })

  it('一步結束時保全看得到你就算（照字面）：一開始就在視線裡的，第一步就開打', () => {
    const { game } = setup({ at: 'E1', ext: { controlled: QUIET, guards: { G1: { foes: [foe()] } } } }) // 入口 (5,0) 和 G1 (5,2) 同在開放座位
    expect(game.gridMove('south').reports.map((x) => x.action)).toEqual(['grid.move', 'battle.start'])
  })

  it('剛進圖也算一步：arrive 回傳的報告帶 launch 開他的遭遇；潛行時是警戒 +5，只算一次', () => {
    const open = setup({ at: 'E1', ext: { controlled: QUIET, guards: { G1: { foes: [foe()] } } } })
    const draft = arrive(open.game.k, open.game.state)!
    expect(draft.action).toBe('grid.arrive')
    expect(draft.launch).toHaveLength(1)
    const reports = open.game.commit(draft)
    expect(reports.map((x) => x.action)).toEqual(['grid.arrive', 'battle.start'])
    expect(open.game.battle!.origin.ext).toMatchObject({ guard: 'G1', pre: { spotted: true } })

    const sneak = setup({ at: 'E1', ext: { stealth: true, controlled: QUIET, guards: { G1: { foes: [foe()] } } } })
    const quiet = arrive(sneak.game.k, sneak.game.state)!
    expect(quiet.launch).toBeUndefined()
    sneak.game.commit(quiet)
    expect(alertOf(sneak.game)).toBe(5)
    expect(extOf(sneak.game).seen_by).toEqual(['G1'])
    expect(arrive(sneak.game.k, sneak.game.state)).toBeNull()

    const unseen = setup({ ext: { controlled: QUIET, guards: { G1: { foes: [foe()] } } } }) // 正門 (6,8) 看不到 G1
    expect(arrive(unseen.game.k, unseen.game.state)).toBeNull()
    expect(arrive(makeGame({ features: [exploreFeature] }).game.k, makeGame({ features: [exploreFeature] }).game.state)).toBeNull() // 不在地圖上
  })

  it('沒有放人的保全崗不會看到你', () => {
    const { game } = setup({ ext: { controlled: QUIET } })
    game.gridMove([6, 3])
    expect(game.battle).toBeNull()
  })

  it('開打之後脫離：保全不會因為你還在視線裡再開一次，走到他那一格才再開', async () => {
    const { game } = setup({ ext: { controlled: QUIET, guards: { G1: { foes: [foe()] } } } })
    game.gridMove([6, 3])
    playOut(game)
    game.state.battle!.result = { outcome: 'fled', text: 'x' }
    await game.finishBattle()
    expect(game.gridMove('north').reports.map((x) => x.action)).toEqual(['grid.move'])
    expect(game.gridMove('west').reports.map((x) => x.action)).toEqual(['grid.move', 'battle.start'])
  })
})

describe('門鎖（SITES 12.5 節）', () => {
  it('沒鑰匙走不過去、有原因（兩種辦法）；拿了 K 之後走得過去，那一格之後是開的門', () => {
    const { game } = setup()
    stand(game, 5, 6)
    const blocked = game.gridMove('west')
    expect(blocked.status).toBe('refused')
    expect(blocked.reason).toMatch(/憑證/)
    expect(blocked.reason).toMatch(/接管/)
    expect(blocked.reason).toMatch(/撬鎖/)
    expect(blocked.reason).toMatch(/破門/)
    expect(game.gridView()!.moves.west).toBe(blocked.reason)
    expect(game.gridMove([3, 6]).status).toBe('refused')
    stand(game, 7, 7)
    game.commit(useHere(game, 'key'))
    expect(extOf(game).keys).toEqual(['K1'])
    stand(game, 5, 6)
    expect(game.gridView()!.moves.west).toBeNull()
    expect(game.gridMove('west').status).toBe('applied')
    expect(at(game)).toEqual([4, 6])
    expect(cellsOf(game)['4,6']).toEqual({ kind: 'door' })
    // 開了就是開的：把鑰匙拿掉（接管、鑰匙都不在）也不會再鎖回去
    commit(game, [{ op: 'map.ext', map: 'm1', value: null }])
    stand(game, 5, 6)
    expect(game.gridMove('west').status).toBe('applied')
  })

  it('那一區被接管也放行（不必有鑰匙）；接管的是別區就不放行', () => {
    const a = setup({ ext: { controlled: ['office:d'] } })
    stand(a.game, 5, 6)
    expect(a.game.gridMove([3, 6]).status).toBe('applied')
    expect(cellsOf(a.game)['4,6']).toEqual({ kind: 'door' })
    const b = setup({ ext: { controlled: ['office:a', 'office:b', 'office:c'] } })
    stand(b.game, 5, 6)
    expect(b.game.gridMove('west').status).toBe('refused')
  })

  it('撬鎖：機械對 DC 基準，成功門開、不加警戒；失敗警戒 +5、門還鎖著', () => {
    const win = seedWhere({ ext: { dc_base: 5 } }, (g) => { stand(g, 5, 6); return result((x) => unlock(x.k, x.state, [4, 6], 'pick'))(g) === 'unlocked' })
    const ok = setup({ seed: win, ext: { dc_base: 5 } })
    stand(ok.game, 5, 6)
    const draft = unlock(ok.game.k, ok.game.state, [4, 6], 'pick')
    expect(draft.action).toBe('grid.unlock')
    expect(draft.timeline.find((b) => b.roll)!.roll).toMatchObject({ dc: 5, skill: 'mechanics' })
    ok.game.commit(draft)
    expect(alertOf(ok.game)).toBe(0)
    expect(cellsOf(ok.game)['4,6']).toEqual({ kind: 'door' })
    expect(ok.game.gridMove('west').status).toBe('applied')

    const lose = seedWhere({ ext: { dc_base: 60 } }, (g) => { stand(g, 5, 6); return result((x) => unlock(x.k, x.state, [4, 6], 'pick'))(g) === 'failed' })
    const bad = setup({ seed: lose, ext: { dc_base: 60 } })
    stand(bad.game, 5, 6)
    bad.game.commit(unlock(bad.game.k, bad.game.state, [4, 6], 'pick'))
    expect(alertOf(bad.game)).toBe(5)
    expect(cellsOf(bad.game)['4,6']).toBeUndefined()
    expect(bad.game.gridMove('west').status).toBe('refused')
  })

  it('破門：運動對 DC 基準，不論成敗警戒 +10', () => {
    const win = seedWhere({ ext: { dc_base: 5 } }, (g) => { stand(g, 5, 6); return result((x) => unlock(x.k, x.state, [4, 6], 'break'))(g) === 'unlocked' })
    const ok = setup({ seed: win, ext: { dc_base: 5 } })
    stand(ok.game, 5, 6)
    const draft = unlock(ok.game.k, ok.game.state, [4, 6], 'break')
    expect(draft.timeline.find((b) => b.roll)!.roll).toMatchObject({ skill: 'athletics' })
    ok.game.commit(draft)
    expect(alertOf(ok.game)).toBe(10)
    expect(cellsOf(ok.game)['4,6']).toEqual({ kind: 'door' })

    const lose = seedWhere({ ext: { dc_base: 60 } }, (g) => { stand(g, 5, 6); return result((x) => unlock(x.k, x.state, [4, 6], 'break'))(g) === 'failed' })
    const bad = setup({ seed: lose, ext: { dc_base: 60 } })
    stand(bad.game, 5, 6)
    bad.game.commit(unlock(bad.game.k, bad.game.state, [4, 6], 'break'))
    expect(alertOf(bad.game)).toBe(10)
    expect(cellsOf(bad.game)['4,6']).toBeUndefined()
  })

  it('DC 基準：dc_base；沒寫是 10 ＋ 等級 × 2（等級沒寫算 I 級）；等級可以寫數字或羅馬數字', () => {
    const dc = (ext: Record<string, unknown>) => {
      const { game } = setup({ ext })
      stand(game, 5, 6)
      return unlock(game.k, game.state, [4, 6], 'pick').timeline.find((b) => b.roll)!.roll!.dc
    }
    expect(dc({ dc_base: 17 })).toBe(17)
    expect(dc({ grade: 3 })).toBe(16)
    expect(dc({ grade: 'IV' })).toBe(18)
    expect(dc({})).toBe(12)
    expect(dc({ dc_base: 17, grade: 5 })).toBe(17)
  })

  it('撬不了的情況：不是上鎖的門、不在身邊、已經有鑰匙、不認得的做法、不在地圖上', () => {
    const { game } = setup()
    stand(game, 5, 6)
    expect(() => unlock(game.k, game.state, [5, 5], 'pick')).toThrow(ActionBlocked)
    expect(() => unlock(game.k, game.state, [4, 6], 'smash' as never)).toThrow(/撬鎖.*破門/)
    stand(game, 6, 7)
    expect(() => unlock(game.k, game.state, [4, 6], 'pick')).toThrow(/旁邊/)
    stand(game, 5, 6)
    const keyed = setup({ ext: { keys: ['K1'] } })
    stand(keyed.game, 5, 6)
    expect(() => unlock(keyed.game.k, keyed.game.state, [4, 6], 'pick')).toThrow(/不必動手/)
    const away = makeGame({ features: [exploreFeature, TEST_COMBAT], pc: STRONG }).game
    expect(() => unlock(away.k, away.state, [4, 6], 'pick')).toThrow(/不在格子地圖上/)
  })
})

describe('巡邏（SITES 12.5 節）', () => {
  const quiet = { stealth: true, controlled: QUIET, guards: { G2: { foes: [foe()] } } }
  // 預期的一圈：站在接待櫃檯 (6,5)，路線 接待區→開放座位→接待區→茶水間：先走兩格到開放座位，回來，再穿過上鎖的門走到茶水間（從原位走路最近的那一格 (3,6)），再回來
  const LAP: Pt[] = [[6, 4], [6, 3], [6, 4], [6, 5], [5, 5], [5, 6], [4, 6], [3, 6], [4, 6], [5, 6], [5, 5], [6, 5]]
  /** 玩家在正門口 (6,8)、(6,7) 之間來回走 n 步（站在 (6,8) 往北、站在 (6,7) 往南），回傳 G2 每一步之後的位置。 */
  const pace = (g: G, n: number): Array<Pt | undefined> => Array.from({ length: n }, () => {
    g.gridMove(at(g)[1] === 8 ? 'north' : 'south')
    return moversOf(g).G2?.at as Pt | undefined
  })

  it('每一步往路線的下一個區塊靠近一格，走完一圈回原位，再走一圈一樣', () => {
    const { game } = setup({ ext: quiet })
    expect(moversOf(game).G2).toBeUndefined() // 還沒走，站在 G2 的位置
    const path = pace(game, 24)
    expect(path.slice(0, 12)).toEqual(LAP)
    expect(path.slice(12)).toEqual(LAP)
  })

  it('存檔再讀，位置不變、接著走的路也不變', () => {
    const { game } = setup({ ext: quiet })
    pace(game, 5)
    const raw = game.save('manual', 't')
    const at5 = [...moversOf(game).G2!.at]
    expect(at5).toEqual(LAP[4])
    const next = pace(game, 1)[0]
    expect(game.load(raw)).toBeNull()
    expect(moversOf(game).G2!.at).toEqual(at5)
    expect(at(game)).toEqual([6, 7])
    expect(pace(game, 1)[0]).toEqual(next)
    expect(next).toEqual(LAP[5])
  })

  it('巡邏減半的連動：只走路線的前一半（接待區→開放座位→接待區）', () => {
    const { game } = setup({ ext: { ...quiet, patrol_half: true } })
    const path = pace(game, 8)
    expect(path).toEqual([[6, 4], [6, 3], [6, 4], [6, 5], [6, 4], [6, 3], [6, 4], [6, 5]])
  })

  it('沒放人的保全不走', () => {
    const { game } = setup({ ext: { controlled: QUIET } })
    expect(pace(game, 4)).toEqual([undefined, undefined, undefined, undefined])
    expect(moversOf(game)).toEqual({})
  })

  it('被看到照保全現在的位置算：巡邏走進你的視線就開打；用他現在所在區塊的遭遇點；在他站的那一格開打的是他', () => {
    const { game } = setup({ at: 'E1', ext: { controlled: QUIET, guards: { G2: { foes: [foe()] } } } })
    expect(game.gridMove('south').reports.map((x) => x.action)).toEqual(['grid.move']) // (5,1)；保全走到 (6,4)，在接待區
    const r = game.gridMove('south') // (5,2)；保全走到 (6,3)，進了開放座位：看得到你了
    expect(r.reports.map((x) => x.action)).toEqual(['grid.move', 'battle.start'])
    const b = game.battle!
    expect(b.origin.ext).toMatchObject({ guard: 'G2', at: [6, 3], patrol: true, pre: { spotted: true }, spot: '!1' })
    expect(b.cover.foe.map((c) => c.level)).toEqual([1, 1, 2, 2]) // 開放座位的遭遇點 !1：密
    expect(moversOf(game).G2!.at).toEqual([6, 3])
  })

  it('保全走到你這一格也開打；打贏之後巡邏的保全拿掉，不再走、不再看到你', async () => {
    const { game } = setup({ ext: { controlled: QUIET, guards: { G2: { foes: [foe()] } } } })
    // 人站在 (6,4)；保全已經走到 (6,2)、正要往回走（下一個目標是接待區的原位）。人往北走到 (6,3)，保全先動一步也走到 (6,3)
    stand(game, 6, 4)
    commit(game, [{ op: 'map.sheet', map: 'm1', sheet: 'office', movers: { G2: { at: [6, 2], leg: 2 } } }])
    const r = game.gridMove('north')
    expect(r.reports.map((x) => x.action)).toEqual(['grid.move', 'battle.start'])
    expect(game.battle!.origin.ext).toMatchObject({ guard: 'G2', at: [6, 3], patrol: true })
    expect(playOut(game).outcome).toBe('win')
    await game.finishBattle()
    expect(moversOf(game).G2).toMatchObject({ gone: true })
    expect(cellsOf(game)['6,5']).toBeUndefined()
    const where = [...(moversOf(game).G2!.at as Pt)]
    for (const dir of ['north', 'south', 'north'] as const) expect(game.gridMove(dir).reports.map((x) => x.action)).toEqual(['grid.move'])
    expect(moversOf(game).G2!.at).toEqual(where)
  })
})

describe('標記的用途（SITES 12.1 節；COMMISSION_MAPS 1.5 節）', () => {
  // 六種各做一次。控制面板（C）與保險箱（$）要擲骰：DC 壓低，挑兩個都成功的種子。
  const ext = { dc_base: 1 }
  const seed = seedWhere({ ext }, (g) => { stand(g, 5, 7); const a = result((x) => useHere(x, 'seize'))(g); stand(g, 3, 5); return a === 'done' && result((x) => useHere(x, 'open'))(g) === 'done' })
  const CASES: Array<{ mark: string; id: string; name: string; where: Pt; key: string }> = [
    { mark: 'T', id: 'take', name: '拿取／動手', where: [3, 1], key: '3,1' },
    { mark: 'D', id: 'plug', name: '插上資料埠', where: [1, 3], key: '1,3' },
    { mark: 'K', id: 'key', name: '拿走憑證', where: [7, 7], key: '7,7' },
    { mark: 'C', id: 'seize', name: '接管控制區', where: [2, 3], key: '2,3' },
    { mark: '$', id: 'open', name: '打開', where: [3, 5], key: '3,5' },
    { mark: '&', id: 'carry', name: '帶走', where: [2, 5], key: '2,5' },
  ]

  it('六種標記各做一次：狀態記下來、報告的標籤對、做過的不能再做並有原因', () => {
    const { game } = setup({ seed, ext })
    for (const c of CASES) {
      stand(game, c.where[0], c.where[1])
      const uses = game.gridView()!.here.uses
      expect(uses, c.mark).toEqual([{ id: c.id, name: c.name, block: null }])
      const draft = useHere(game, c.id)
      expect(draft.action, c.mark).toBe('grid.use')
      expect(tags(draft), c.mark).toContain(`mark:${c.mark}`)
      expect(draft.outcome.result, c.mark).toBe('done')
      const [report] = game.commit(draft)
      expect(report!.timeline.find((b) => b.tag === `mark:${c.mark}`)!.data).toMatchObject({ use: c.id, ok: true })
      expect(cellsOf(game)[c.key], c.mark).toEqual({ used: true })
      // 做過的：列出來但灰掉，原因寫成一句話；硬要做丟 ActionBlocked
      const after = game.gridView()!.here.uses
      expect(after[0]!.block, c.mark).toMatch(/已經做過/)
      expect(() => useHere(game, c.id), c.mark).toThrow(ActionBlocked)
    }
    expect(extOf(game)).toMatchObject({ keys: ['K1'], carry: ['&1'], controlled: ['office:c', 'office:d'] })
  })

  it('C 接管的是控制區資料列的 zones（C1 管 c、d）；站在別的標記上不能做這件事', () => {
    const { game } = setup({ seed, ext })
    stand(game, 2, 3)
    game.commit(useHere(game, 'seize'))
    expect(extOf(game).controlled).toEqual(['office:c', 'office:d'])
    stand(game, 7, 7)
    expect(() => useHere(game, 'seize')).toThrow(/這一格沒有「接管控制區」可以做/)
    stand(game, 1, 1)
    expect(() => useHere(game, 'carry')).toThrow(/這一格沒有「帶走」可以做/)
    expect(() => useHere(game, 'dance')).toThrow(/這一格沒有「dance」可以做/)
  })

  it('檢定沒過：標記不記成用過、沒有 mark: 的標籤（是 mark_fail:）、警戒不變，可以再試', () => {
    const lose = seedWhere({ ext: { dc_base: 60 } }, (g) => { stand(g, 5, 7); const a = result((x) => useHere(x, 'seize'))(g); stand(g, 3, 5); return a === 'failed' && result((x) => useHere(x, 'open'))(g) === 'failed' })
    const { game } = setup({ seed: lose, ext: { dc_base: 60 } })
    stand(game, 5, 7)
    const c = useHere(game, 'seize')
    expect(tags(c)).toContain('mark_fail:C')
    expect(tags(c)).not.toContain('mark:C')
    game.commit(c)
    expect(cellsOf(game)['5,7']).toBeUndefined()
    expect(extOf(game).controlled).toBeUndefined()
    expect(alertOf(game)).toBe(0)
    expect(() => useHere(game, 'seize')).not.toThrow()
    stand(game, 3, 5)
    const o = useHere(game, 'open')
    expect(o.outcome.result).toBe('failed')
    // $ 的 DC 是基準 ＋ 2
    expect(o.timeline.find((b) => b.roll)!.roll!.dc).toBe(62)
    stand(game, 5, 7)
    expect(useHere(game, 'seize').timeline.find((b) => b.roll)!.roll!.dc).toBe(60)
  })

  it('X 離開還是照舊（M1）', () => {
    const { game } = setup()
    stand(game, 1, 7)
    expect(game.gridView()!.here.uses).toEqual([{ id: 'leave', name: '離開', block: null }])
    const [r] = game.commit(useHere(game, 'leave'))
    expect(r!.action).toBe('grid.leave')
    expect(game.state.maps.at).toBeNull()
  })
})

describe('開戰（SITES 12.5 節「用哪個遭遇點」；COMMISSIONS 2.3 節）', () => {
  const guards = (n = 1) => ({ G1: { foes: Array.from({ length: n }, foe) } })
  const foeCount = (g: G) => Object.values(g.battle!.units).filter((u) => u.side === 'foe').length
  const walkIn = (g: G) => g.gridMove([6, 3])

  it('ext.origin 的鍵原樣併進開戰設定的 origin.ext（pre 與我們的 spotted 合併；這個功能自己的鍵不被蓋掉）；ext.edge 原樣放進去', () => {
    const { game } = setup({ ext: { controlled: QUIET, guards: guards(), edge: 'foe', origin: { by: 'commission', commission: 'cm_1', stage: 2, face: 'meat', pre: { disguise: true }, guard: '被蓋掉', defeat_event: 'de_custom' } } })
    const r = walkIn(game)
    expect(r.reports.map((x) => x.action)).toEqual(['grid.move', 'battle.start'])
    expect(game.battle!.origin.ext).toMatchObject({ by: 'commission', commission: 'cm_1', stage: 2, face: 'meat', defeat_event: 'de_custom', pre: { disguise: true, spotted: true }, guard: 'G1', map: 'm1' })
    // edge: 'foe'：敵方每個人先攻擲兩次取高（開戰那一份報告裡一人一拍）
    const edges = r.reports[1]!.timeline.filter((b) => (b.data as { edge?: string } | undefined)?.edge)
    expect(edges.map((b) => (b.data as { edge: string }).edge)).toEqual(['foe'])
    const plain = setup({ ext: { controlled: QUIET, guards: guards() } })
    expect(walkIn(plain.game).reports[1]!.timeline.filter((b) => (b.data as { edge?: string } | undefined)?.edge)).toEqual([])
  })

  it('警戒 60：這一場的後方多了 reinforce 的人；下一場不再加；59 不加', async () => {
    const make = (alert: number) => {
      const t = setup({ ext: { controlled: QUIET, guards: guards(4), reinforce: [foe(), foe()] } })
      setAlert(t.game, alert)
      return t.game
    }
    const low = make(59)
    walkIn(low)
    expect(foeCount(low)).toBe(4)
    expect(low.battle!.reserve.foe).toHaveLength(0)
    expect(extOf(low).reinforced).toBeUndefined()

    const game = make(60)
    walkIn(game)
    expect(foeCount(game)).toBe(6)
    expect(game.battle!.reserve.foe).toHaveLength(2) // 場上四格滿了，增援在後方
    expect(extOf(game).reinforced).toBe(true)
    // 脫離之後再走進同一個保全：保全還在，增援已經用過，不再加
    playOut(game)
    game.state.battle!.result = { outcome: 'fled', text: 'x' }
    await game.finishBattle()
    expect(game.gridMove([5, 2]).reports.map((x) => x.action)).toEqual(['grid.move', 'battle.start'])
    expect(foeCount(game)).toBe(4)
    expect(game.battle!.reserve.foe).toHaveLength(0)
  })

  it('這一段路上剛加的警戒也算（走在有監視器的區塊走到 60 的那一步就帶增援）', () => {
    // 接待區的監視器沒接管：站在 (6,7)，警戒 58；一步 (5,7) → 60；同一段路的下一步是被看到
    const t = setup({ ext: { guards: { G2: { foes: [foe()] } }, reinforce: [foe()] } })
    setAlert(t.game, 58)
    t.game.gridMove([5, 5])
    expect(t.game.battle).not.toBeNull()
    expect(foeCount(t.game)).toBe(2)
  })

  it('ext.spot 指定的遭遇點決定遮蔽的配置；沒寫或寫了找不到的才照現在的挑法', () => {
    const run = (spot?: string) => {
      const { game } = setup({ ext: { controlled: QUIET, guards: guards(), ...(spot !== undefined ? { spot } : {}) } })
      walkIn(game)
      return { cover: game.battle!.cover.foe.map((c) => c.level), spot: (game.battle!.origin.ext as { spot?: string }).spot }
    }
    expect(run()).toEqual({ cover: [1, 1, 2, 2], spot: '!1' }) // G1 在開放座位：同一區的遭遇點 !1（密）
    expect(run('!2')).toEqual({ cover: [2, 2, 1, 1], spot: '!2' }) // 指定 !2（一邊倒），不管保全站在哪一區
    expect(run('!9')).toEqual({ cover: [1, 1, 2, 2], spot: '!1' })
  })

  it('打贏之後站著的保全崗清掉（那一格記成 used）', async () => {
    const { game } = setup({ ext: { controlled: QUIET, guards: guards() } })
    walkIn(game)
    expect(playOut(game).outcome).toBe('win')
    await game.finishBattle()
    expect(cellsOf(game)['5,2']).toEqual({ used: true })
    expect(game.gridMove('north').reports.map((x) => x.action)).toEqual(['grid.move'])
    expect(game.gridMove('west').reports.map((x) => x.action)).toEqual(['grid.move'])
  })
})

describe('警戒的量表（COMMISSIONS 2.3 節；0016 第三節）', () => {
  it('照地圖的實例記、0～100：監視器、撬鎖、破門都不超過 100', () => {
    const { game } = setup()
    setAlert(game, 99)
    game.gridMove('north') // 接待區：+2
    expect(alertOf(game)).toBe(100)
    stand(game, 5, 6)
    const seed = seedWhere({}, (g) => { stand(g, 5, 6); return result((x) => unlock(x.k, x.state, [4, 6], 'break'))(g) === 'unlocked' })
    const t = setup({ seed })
    stand(t.game, 5, 6)
    setAlert(t.game, 95)
    t.game.commit(unlock(t.game.k, t.game.state, [4, 6], 'break'))
    expect(alertOf(t.game)).toBe(100)
  })

  it('效果 alert 落在現在這張地圖上（AI 給的一件事合計最多 ±20）', () => {
    const { game, id } = setup()
    const resolve = (effects: unknown[], source: 'builtin' | 'ai') => game.k.effects.resolve(effects, effectCtx(game.k, game.state, { source }))
    const built = resolve([{ kind: 'alert', amount: 15 }], 'builtin')
    expect(built.changes).toEqual([{ op: 'meter', kind: 'alert', key: id, delta: 15 }])
    commit(game, built.changes)
    expect(alertOf(game)).toBe(15)
    const ai = resolve([{ kind: 'alert', amount: 50 }], 'ai')
    expect(ai.changes).toEqual([{ op: 'meter', kind: 'alert', key: id, delta: 20 }])
    // 不在這張地圖上時，兩邊的警戒各記各的：別份實例的數字不動
    expect(meterOf(game.k, game.state, 'alert', 'm9')).toBe(0)
  })
})

describe('委託副本是封閉的活動：探索的行動放行（k.activity.allow）', () => {
  it("走路、做標記的事、撬鎖（grid.、commit:grid.）在 'commission' 活動進行中放行，別的不放", () => {
    const commissionActivity: Feature = {
      id: 'fake_commission',
      install(k) {
        k.activity.define({ kind: 'commission', owner: 'fake_commission', order: 90, active: (s) => (s.flags.in_commission ? { id: 'cm', label: '委託副本' } : null), allow: [], reason: () => '先把委託做完。' })
      },
    }
    const { game } = setup({ features: [commissionActivity] })
    commit(game, [{ op: 'flag', key: 'in_commission', value: true }])
    for (const doing of ['grid.enter', 'grid.move', 'commit:grid.move', 'commit:grid.use', 'commit:grid.unlock', 'commit:grid.leave']) expect(game.k.activity.blockOf(game.state, doing), doing).toBeNull()
    expect(game.k.activity.blockOf(game.state, 'commit:trade.checkout')).toBe('先把委託做完。')
    expect(game.gridMove('north').status).toBe('applied')
  })
})
