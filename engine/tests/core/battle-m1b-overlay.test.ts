// 驗收測試：dev/work/M1b-core-overlay.md（每一輪開頭的掛點、沒有操作者的和人重疊的東西、自己開火的替身、義體在戰鬥裡的清單與失效、超頻）。
// 規格：dev/adr/0015 第三節與 E6（操作者退出時 autonomous 的改成自律）。
// 效果、掛點與規則表的狀態都是測試裡臨時註冊、自帶的最小假資料；不讀 engine/data 的內容類。

import { describe, expect, it } from 'vitest'
import type { BattleOverlayInit, BattleSetup, BattleUnit, ContentPack, Feature, Kernel } from '../../src'
import { BATTLE_EVENTS, BattleBlocked, MOD_KINDS, battleProblems, clone, otherSide, targetWeight, unitsOf } from '../../src'
import { summonsFeature } from '../../src/features/summons'
import { TEST_COMBAT, makeBattleGame, stateHash, testWeapon } from '../../src/testkit'
import type { Arena } from '../helpers/battle'
import { arena, duel, foe, one } from '../helpers/battle'

/** 骰面：給的先出，之後都是 1。 */
const dice = (...v: number[]) => [...v, ...Array(80).fill(1)]
/** 一台的樣子（預設有操作者 a1）。 */
const init = (o: Partial<BattleOverlayInit> = {}): BattleOverlayInit => ({ side: 'ally', slot: 1, owner: 'a1', kind: 'attack', name: '機', hp: { now: 14, max: 14 }, armor: 1, evade: 13, ...o })
/** 沒有操作者的一台。 */
const ownerless = (o: Partial<BattleOverlayInit> = {}): BattleOverlayInit => {
  const { owner: _owner, ...rest } = init({ side: 'foe', name: '巡邏機', ...o })
  return rest
}
const tags = (run: { beats: Array<{ tag?: string }> }) => run.beats.map((b) => b.tag).filter(Boolean)
const plus = (kind: string, value: number, seen?: Array<{ unit: string; tags: string[] }>) => (k: Kernel) =>
  k.battle.modifier('t', (q) => {
    if (q.kind !== kind) return []
    seen?.push({ unit: q.unit.id, tags: [...q.tags] })
    return [{ label: kind, value }]
  })
/** 場上沒有遮蔽的 a1、a2 對 f1、f2；a1 沒有護甲、迴避 0。 */
const two = (allies?: unknown[], foes?: unknown[]) => duel(allies ?? [one({ armor: 0, evade: 0, hp: { now: 100, max: 100 } }), one({}, 2)], foes ?? [foe(), foe()])

const status = (id: string, name: string, extra: Record<string, unknown> = {}) => ({ id, name, desc: `${name}：測試用的狀態。`, until: 'own_turn_end', turns: 2, kind: 'debuff', ...extra })
const PACK: ContentPack = {
  id: 'overlay_test',
  content: { battle_status: [status('off_eye', '視覺失效', { mods: { hit: -2 } }), status('off_arm', '手臂失效'), status('off_generic', '義體失效', { mods: { hit: -1 } }), status('boost_generic', '義體超頻', { kind: 'buff' })] },
}
const loadRules = (k: Kernel) => k.content.loadPack(PACK)
const EYE = { kind: 'eye', name: '義眼' }
const ARM = { kind: 'arm', name: '義臂' }

describe('核心帶的名單（dev/adr/0015 第三節）', () => {
  it('MOD_KINDS 多了 overlay_hp、overlay_armor、overlay_evade、overlay_cap、overlay_backlash；狀態資料也寫得進去、問得到', () => {
    for (const kind of ['overlay_hp', 'overlay_armor', 'overlay_evade', 'overlay_cap', 'overlay_backlash']) expect(MOD_KINDS, kind).toContain(kind)
    const a = arena(duel([one()], [foe()]), undefined, (k) => k.content.loadPack({ id: 'p', content: { battle_status: [status('engaged', '連線中', { mods: { overlay_cap: 1, overlay_backlash: -2 }, until: 'battle_end', kind: 'buff' })] } }))
    const run = a.run()
    run.applyStatus(a.ally(1), 'engaged')
    expect(run.mods('overlay_cap', a.ally(1)).map((p) => p.value)).toEqual([1])
    expect(run.mods('overlay_backlash', a.ally(1)).map((p) => p.value)).toEqual([-2])
  })

  it('BATTLE_EVENTS 不需要新事件：放出、自律、擊落都用既有的 overlay、overlay.down', () => {
    expect(BATTLE_EVENTS).toEqual(expect.arrayContaining(['overlay', 'overlay.down', 'status', 'round']))
  })
})

describe('round.start：每一輪開頭的掛點', () => {
  interface Seen { round: number; turn: number; lastTag?: string; started: boolean }
  const spy = (seen: Seen[], order?: string[]): Feature => ({
    id: 'spy',
    install: (k) => {
      k.battle.on('battle.start', 'spy', () => { order?.push('battle.start') })
      k.battle.on('round.start', 'spy', ({ run, round }) => {
        order?.push('round.start')
        seen.push({ round, turn: run.battle.turn, ...(run.beats.at(-1)?.tag ? { lastTag: run.beats.at(-1)!.tag } : {}), started: Object.values(run.battle.units).some((u) => !!u.uses.turns) })
      })
      k.battle.on('turn.start', 'spy', () => { order?.push('turn.start') })
    },
  })
  const tough = () => duel([one({ hp: { now: 9999, max: 9999 } }), one({ hp: { now: 9999, max: 9999 } }, 2)], [foe('elite', { hp: { now: 9999, max: 9999 } }), foe('elite', { hp: { now: 9999, max: 9999 } })])
  const playTo = (g: ReturnType<typeof makeBattleGame>['game'], round: number) => {
    for (let i = 0; i < 600 && g.battle!.round < round && !g.battle!.result; i++) g.battleNext({ anyone: true })
  }

  it('每一輪發一次、第一輪也發；發的時候還沒有人行動（第一輪沒有人開始過回合，之後是這一輪的第一個人還沒輪到）', () => {
    const seen: Seen[] = []
    const order: string[] = []
    const { game } = makeBattleGame({ features: [TEST_COMBAT, spy(seen, order)], battle: tough(), seed: 3 })
    // 開打的那一步：battle.start → round.start → 第一個人的 turn.start
    expect(order).toEqual(['battle.start', 'round.start', 'turn.start'])
    expect(seen).toEqual([{ round: 1, turn: 0, lastTag: 'round', started: false }])
    playTo(game, 4)
    expect(game.battle!.round).toBeGreaterThanOrEqual(4)
    expect(seen.map((s) => s.round)).toEqual(Array.from({ length: game.battle!.round }, (_, i) => i + 1))
    for (const s of seen) expect(s).toMatchObject({ turn: 0, lastTag: 'round' })
  })

  it('arena（不經過提交）開打也發第一輪的；掛點在 turn.start 之前', () => {
    const order: string[] = []
    const a = arena(duel([one()], [foe()]), [TEST_COMBAT], (k) => {
      k.battle.on('round.start', 'spy', ({ round }) => { order.push(`round.start ${round}`) })
      k.battle.on('turn.start', 'spy', () => { order.push('turn.start') })
    })
    expect(order[0]).toBe('round.start 1')
    expect(order.indexOf('turn.start')).toBeGreaterThan(0)
    expect(a.battle.round).toBe(1)
  })

  it('掛點裡分出了結果：不再輪到下一個人（沒有 turn 的那一拍），戰鬥結束', () => {
    const ender: Feature = { id: 'ender', install: (k) => k.battle.on('round.start', 'ender', ({ run, round }) => { if (round === 2) run.finish('win', '掛點結束了這場戰鬥。') }) }
    const { game } = makeBattleGame({ features: [TEST_COMBAT, ender], battle: tough(), seed: 3 })
    playTo(game, 5)
    expect(game.battle!.result).toMatchObject({ outcome: 'win' })
    expect(game.battle!.round).toBe(2)
    const beats = game.state.reports.flatMap((r) => r.timeline)
    const at = beats.map((b, i) => (b.tag === 'round' && (b.data as { round?: number }).round === 2 ? i : -1)).filter((i) => i >= 0).at(-1)!
    expect(at).toBeGreaterThan(0)
    expect(beats.slice(at + 1).filter((b) => b.tag === 'turn')).toEqual([])
    expect(beats.at(-1)).toMatchObject({ tag: 'battle.end' })
  })

  it('掛點做完核心替它收尾（補位）：第一個人的回合開始時，後方的人已經補上來了', () => {
    const downer: Feature = {
      id: 'downer',
      install: (k) => {
        k.battle.on('round.start', 'downer', ({ run, round }) => { if (round === 2) run.setOut(run.unit('f1'), 'down') })
        k.battle.on('turn.start', 'downer', ({ run }) => { if (run.battle.round === 2) seenSlot.push(run.battle.units.f5!.slot) })
      },
    }
    const seenSlot: number[] = []
    const five = [0, 1, 2, 3, 4].map(() => foe('elite', { hp: { now: 9999, max: 9999 } }))
    const { game } = makeBattleGame({ features: [TEST_COMBAT, downer], battle: duel([one({ hp: { now: 9999, max: 9999 } })], five), seed: 3 })
    expect(game.battle!.units.f5!.slot).toBe(0)
    playTo(game, 3)
    expect(game.battle!.units.f1!.out).toBe('down')
    expect(game.battle!.units.f5!.slot).toBeGreaterThanOrEqual(1)
    // 第 2 輪第一個人開始回合的那一刻，f5 就已經在場上了
    expect(seenSlot[0]).toBeGreaterThanOrEqual(1)
  })
})

describe('沒有操作者的一台', () => {
  const hang: Feature = {
    id: 'hang',
    install: (k) => k.battle.on('battle.start', 'hang', ({ run }) => { run.addOverlay(ownerless({ slot: 2, ext: { drone: 0 } })) }),
  }

  it('開得了戰：BattleOverlay 沒有 owner 這個鍵；battleProblems 放行；讀得了檔，讀回來還是沒有操作者', () => {
    const { game } = makeBattleGame({ features: [TEST_COMBAT, hang], battle: duel([one()], [foe(), foe()]), seed: 5 })
    const o = game.battle!.overlays[0]!
    expect('owner' in o).toBe(false)
    expect(o).toMatchObject({ side: 'foe', slot: 2, kind: 'attack', name: '巡邏機', used: false, down: false })
    expect(battleProblems(game.battle)).toEqual([])
    const before = stateHash(game.state)
    expect(game.load(game.save('manual', 'x'))).toBeNull()
    expect(stateHash(game.state)).toBe(before)
    expect('owner' in game.battle!.overlays[0]!).toBe(false)
    expect(game.battleNext({ anyone: true }).status).toBe('applied')
  })

  it('打得到、被擊落時不找操作者：overlay.down 的拍沒有 owner；summons 的處理函式不丟錯、沒有人被灌感載', () => {
    const downs: Array<{ owner: unknown }> = []
    const a = arena(two(), [TEST_COMBAT, summonsFeature], (k) => k.battle.on('overlay.down', 'spy', ({ overlay }) => { downs.push({ owner: overlay.owner }) }))
    const run = a.run(dice(6, 6, 6, 6, 6, 6))
    const o = run.addOverlay(ownerless({ slot: 1, hp: { now: 3, max: 3 }, ext: { drone: 0 } }))
    const res = run.attackOverlay(a.ally(1), o, { natural: 20 })
    expect(res).toMatchObject({ hit: true, downed: true })
    expect(o.down).toBe(true)
    expect(downs).toEqual([{ owner: undefined }])
    const beat = run.beats.find((b) => b.tag === 'overlay.down')!
    expect(beat.text).toBe('巡邏機被擊落了。')
    expect('owner' in (beat.data as object)).toBe(false)
    for (const u of Object.values(a.battle.units)) expect(u.load!.now).toBe(0)
    expect(battleProblems(a.battle)).toEqual([])
  })

  it('停機（quiet）一台沒有操作者的也不找操作者', () => {
    const a = arena(two())
    const run = a.run()
    const o = run.addOverlay(ownerless())
    run.dropOverlay(o, undefined, true)
    expect(run.beats.at(-1)).toMatchObject({ text: '巡邏機停機了。', tag: 'overlay.down' })
  })
})

describe('autonomous：操作者退出之後自律（E6）', () => {
  const three = () => arena(duel([one({ weapon: 'pistol' }), one({ weapon: 'pistol' }, 2)], [foe(), foe()]), [TEST_COMBAT], (k) => {
    k.battle.on('overlay.down', 'spy', () => { downHooks.push(1) })
  })
  const downHooks: number[] = []

  it('autonomous 的一台在操作者倒下之後還在：沒有 owner、auto 是 true、ext.orphan；不停機、不發 overlay.down（掛點與拍都沒有），留一拍 overlay', () => {
    downHooks.length = 0
    const a = three()
    const run = a.run()
    const o = run.addOverlay(init({ slot: 2, autonomous: true, ext: { drone: 0, grade: 1 } }))
    expect(o.owner).toBe('a1')
    expect(o.auto).toBeUndefined()
    run.setOut(a.ally(1), 'down')
    expect(o).toMatchObject({ down: false, auto: true, autonomous: true, ext: { drone: 0, grade: 1, orphan: true } })
    expect('owner' in o).toBe(false)
    expect(downHooks).toEqual([])
    expect(run.beats.some((b) => b.tag === 'overlay.down')).toBe(false)
    expect(run.beats.find((b) => b.data && (b.data as { orphan?: boolean }).orphan)).toMatchObject({ tag: 'overlay', text: '機失去了操作者，進入自律模式。', data: { overlay: o.id, orphan: true } })
    expect(battleProblems(a.battle)).toEqual([])
  })

  it('不是 autonomous 的停機（和現在一樣）：down 是 true、拍是「停機了」、不發 overlay.down 掛點、owner 還在', () => {
    downHooks.length = 0
    const a = three()
    const run = a.run()
    const o = run.addOverlay(init({ slot: 2 }))
    run.setOut(a.ally(1), 'down')
    expect(o).toMatchObject({ down: true, owner: 'a1' })
    expect(o.auto).toBeUndefined()
    expect(run.beats.find((b) => b.tag === 'overlay.down')!.text).toBe('機停機了。')
    expect(downHooks).toEqual([])
  })

  it('同一個人的兩台：autonomous 的留著、另一台停機；怎麼退出都一樣（昏過去、被制伏）；已經被擊落的不動；別人的不受影響', () => {
    const a = three()
    const run = a.run()
    const own = run.addOverlay(init({ slot: 1, autonomous: true, name: '自律機' }))
    const stop = run.addOverlay(init({ slot: 2, name: '停機機' }))
    const dead = run.addOverlay(init({ slot: 3, autonomous: true, name: '壞機' }))
    dead.down = true
    const mate = run.addOverlay(init({ slot: 4, owner: 'a2', autonomous: true, name: '隊友機' }))
    run.setOut(a.ally(1), 'burnout')
    expect([own.down, 'owner' in own, own.ext!.orphan]).toEqual([false, false, true])
    expect(stop.down).toBe(true)
    expect(dead).toMatchObject({ down: true, owner: 'a1' })
    expect(dead.ext?.orphan).toBeUndefined()
    expect(mate).toMatchObject({ down: false, owner: 'a2' })
    expect(mate.auto).toBeUndefined()
    // 被制伏也一樣
    run.setOut(a.ally(2), 'subdued')
    expect([mate.down, 'owner' in mate, mate.auto]).toEqual([false, false, true])
  })

  it('自律之後再沒有操作者：同一台不會被第二次當成要處理的（操作者回到場上也不再認他）', () => {
    const a = three()
    const run = a.run()
    const o = run.addOverlay(init({ slot: 2, autonomous: true }))
    run.setOut(a.ally(1), 'down')
    const mark = run.beats.length
    run.revive(a.ally(1), 10)
    expect(run.beats.slice(mark).some((b) => b.tag === 'overlay')).toBe(false)
    expect('owner' in o).toBe(false)
  })
})

describe('run.addOverlay', () => {
  it('同一格第二台被擋：BattleBlocked、一句完整的話；狀態不變（沒有多一台、流水號不動）；第一台被擊落之後同一格可以再掛', () => {
    const a = arena(two())
    const run = a.run()
    const first = run.addOverlay(init({ slot: 2 }))
    const seq = a.battle.seq
    const beats = run.beats.length
    let err: unknown
    try { run.addOverlay(init({ slot: 2, name: '第二台' })) } catch (e) { err = e }
    expect(err).toBeInstanceOf(BattleBlocked)
    expect((err as BattleBlocked).reasons).toEqual(['這一格已經掛著一台了。'])
    expect(a.battle.overlays).toHaveLength(1)
    expect([a.battle.seq, run.beats.length]).toEqual([seq, beats])
    // 另一方的同一格、同一方的別格都可以
    expect(run.addOverlay(init({ side: 'foe', slot: 2 }))).toMatchObject({ side: 'foe', slot: 2 })
    expect(run.addOverlay(init({ slot: 3 }))).toMatchObject({ slot: 3 })
    first.down = true
    expect(run.addOverlay(init({ slot: 2, name: '補上的' })).name).toBe('補上的')
    expect(battleProblems(a.battle)).toEqual([])
  })

  it('發 id（流水號）、used 與 down 一開始是 false、武器與 ext 複製一份；掛著的格子不在 1～4 或操作者不存在丟錯', () => {
    const a = arena(two())
    const run = a.run()
    const weapon = testWeapon('pistol', 3)
    const ext = { drone: 1, deep: { a: 1 } }
    const o1 = run.addOverlay(init({ slot: 1, weapon, ext }))
    const o2 = run.addOverlay(init({ slot: 2 }))
    expect([o1.id, o2.id]).toEqual([`o${a.battle.seq - 1}`, `o${a.battle.seq}`])
    expect([o1.used, o1.down, o2.used, o2.down]).toEqual([false, false, false, false])
    expect(o1.weapon).toEqual(weapon)
    expect(o1.weapon).not.toBe(weapon)
    expect(o1.ext).toEqual(ext)
    expect(o1.ext).not.toBe(ext)
    expect(a.battle.overlays).toEqual([o1, o2])
    expect(() => run.addOverlay(init({ slot: 5 }))).toThrow(/第 1～4 格/)
    expect(() => run.addOverlay(init({ slot: 0 }))).toThrow(/第 1～4 格/)
    expect(() => run.addOverlay(init({ slot: 2.5 }))).toThrow(/第 1～4 格/)
    expect(() => run.addOverlay(init({ slot: 3, owner: 'zz' }))).toThrow(/zz/)
    expect(a.battle.overlays).toHaveLength(2)
  })

  it('有操作者時，耐久（現在與上限）、護甲、迴避各加他的修正，標籤是 [種類]、問的是操作者；沒有操作者的不問', () => {
    const seen: Array<{ unit: string; tags: string[] }> = []
    const a = arena(two(), [TEST_COMBAT], (k) => {
      plus('overlay_hp', 5, seen)(k)
      plus('overlay_armor', 2, seen)(k)
      plus('overlay_evade', -1, seen)(k)
    })
    const run = a.run()
    const mine = run.addOverlay(init({ slot: 1, kind: 'shield' }))
    expect(mine).toMatchObject({ hp: { now: 19, max: 19 }, armor: 3, evade: 12 })
    expect(seen).toEqual([{ unit: 'a1', tags: ['shield'] }, { unit: 'a1', tags: ['shield'] }, { unit: 'a1', tags: ['shield'] }])
    seen.length = 0
    const free = run.addOverlay(ownerless({ slot: 1 }))
    expect(free).toMatchObject({ hp: { now: 14, max: 14 }, armor: 1, evade: 13 })
    expect(seen).toEqual([])
  })

  it('修正是負的：耐久最少 1（現在不超過上限）、護甲最少 0；原本就受過傷的（現在比上限少）照樣加', () => {
    const a = arena(two(), [TEST_COMBAT], (k) => { plus('overlay_hp', -50)(k); plus('overlay_armor', -9)(k) })
    const o = a.run().addOverlay(init({ hp: { now: 4, max: 14 } }))
    expect(o).toMatchObject({ hp: { now: 1, max: 1 }, armor: 0 })
    const b = arena(two(), [TEST_COMBAT], plus('overlay_hp', 3))
    expect(b.run().addOverlay(init({ hp: { now: 4, max: 14 } })).hp).toEqual({ now: 7, max: 17 })
  })

  it('記一拍 overlay：有操作者是「某某 放出…，掛在第 N 格。」（無人機現有的句子），沒有是「…掛在我方／敵方第 N 格。」；text 可以換掉', () => {
    const a = arena(two())
    const run = a.run()
    const o = run.addOverlay(init({ slot: 2, name: '攻擊無人機', kind: 'attack' }))
    expect(run.beats.at(-1)).toEqual({ layer: 'meat', text: `${a.ally(1).name} 放出攻擊無人機，掛在第 2 格。`, tag: 'overlay', data: { overlay: o.id, kind: 'attack', slot: 2 }, ...(a.ally(1).actor ? { actor: a.ally(1).actor } : {}) })
    const f = run.addOverlay(ownerless({ slot: 3, name: '砲塔', kind: 'turret' }))
    expect(run.beats.at(-1)).toMatchObject({ text: '砲塔掛在敵方第 3 格。', tag: 'overlay', data: { overlay: f.id, kind: 'turret', slot: 3 } })
    const g = run.addOverlay(init({ side: 'ally', slot: 4, owner: undefined, name: '立牌', kind: 'decoy' }), { text: '立牌豎起來了。' })
    expect('owner' in g).toBe(false)
    expect(run.beats.at(-1)!.text).toBe('立牌豎起來了。')
  })
})

describe('run.overlayAttack 與替身', () => {
  const GUN = { ...testWeapon('pistol', 7), name: '炮', dice: 1 }
  /** 一台敵方的、有自己武器的一台，掛在敵方第 1 格；攻擊者替身會是它。 */
  const turret = (o: Partial<BattleOverlayInit> = {}) => ownerless({ slot: 1, name: '砲塔', kind: 'turret', weapon: clone(GUN), ...o })

  it('命中用那一台自己的武器（名字與命中加值在明細裡）、傷害乘 ext.dmgMult；沒寫的是 1 倍', () => {
    const go = (ext?: Record<string, unknown>) => {
      const a = arena(two())
      const run = a.run(dice(3, 3))
      const o = run.addOverlay(turret({ ...(ext ? { ext } : {}) }))
      const r = run.overlayAttack(o, a.ally(1), { natural: 20, spend: 0 })
      return { a, run, r }
    }
    const plain = go()
    expect(plain.r).toMatchObject({ hit: true, crit: true, track: 'hp' })
    expect(plain.r.raw).toBe(6)
    expect(plain.r.dealt).toBe(6)
    expect(plain.a.ally(1).hp!.now).toBe(94)
    const hit = plain.run.beats.find((b) => b.tag === 'crit')!
    expect(hit.text).toBe('敵・砲塔 用炮射擊 你：自然 20！')
    expect(hit.roll!.parts).toContainEqual({ label: '炮', value: 7, source: 'weapon' })
    // 傷害倍率 2：護甲 0，所以是 2 倍
    const doubled = go({ dmgMult: { hp: 2, load: 1 } })
    expect([doubled.r.raw, doubled.r.dealt]).toEqual([6, 12])
    expect(doubled.a.ally(1).hp!.now).toBe(88)
    // 直接寫一個數字當生命的倍率也行
    expect(go({ dmgMult: 3 }).r.dealt).toBe(18)
  })

  it('opts.weapon 可以換一把；沒有武器丟錯；已經被擊落的回傳 aborted（沒有發生、不擲骰）', () => {
    const a = arena(two())
    const run = a.run(dice())
    const bare = run.addOverlay(ownerless({ slot: 2, name: '空機' }))
    expect(() => run.overlayAttack(bare, a.ally(1))).toThrow(/空機 沒有武器/)
    expect(run.overlayAttack(bare, a.ally(1), { weapon: { ...GUN, name: '借來的槍' }, natural: 20, spend: 0 }).hit).toBe(true)
    expect(run.beats.some((b) => b.text.includes('借來的槍'))).toBe(true)
    const o = run.addOverlay(turret({ slot: 3 }))
    o.down = true
    const rolls = a.battle.rolls
    expect(run.overlayAttack(o, a.ally(1))).toMatchObject({ aborted: true, hit: false })
    expect(a.battle.rolls).toBe(rolls)
  })

  it('彈匣照那一台的武器扣（和 run.attack 一樣）；spend: 0 不扣', () => {
    const a = arena(two())
    const run = a.run(dice())
    const o = run.addOverlay(turret({ weapon: { ...clone(GUN), mag: { now: 2, max: 2 } } }))
    run.overlayAttack(o, a.ally(1), { natural: 1 })
    expect(o.weapon!.mag!.now).toBe(1)
    run.overlayAttack(o, a.ally(1), { natural: 1, spend: 0 })
    expect(o.weapon!.mag!.now).toBe(1)
  })

  it('attack.before、attack.after 拿到的攻擊者是替身：ext.overlay 是那一台的 id、標籤 machine 與 overlay、不在 battle.units 裡、名字與哪一方哪一格照那一台', () => {
    const seen: Array<Record<string, unknown>> = []
    const a = arena(two(), [TEST_COMBAT], (k) => {
      const note = (phase: string, who: BattleUnit, run: { isStandIn(u: BattleUnit): boolean; overlayOfStandIn(u: BattleUnit): unknown; battle: { units: Record<string, BattleUnit> } }) =>
        seen.push({ phase, overlay: who.ext.overlay, tags: who.tags, name: who.name, side: who.side, slot: who.slot, inUnits: who.id in run.battle.units, standIn: run.isStandIn(who), found: !!run.overlayOfStandIn(who), hp: who.hp, status: who.statuses })
      k.battle.on('attack.before', 'spy', ({ run, attacker }) => { note('before', attacker, run) })
      k.battle.on('attack.after', 'spy', ({ run, attacker }) => { note('after', attacker, run) })
    })
    const run = a.run(dice())
    const o = run.addOverlay(turret({ slot: 2 }))
    run.overlayAttack(o, a.ally(1), { natural: 20 })
    const base = { overlay: o.id, tags: ['machine', 'overlay'], name: '砲塔', side: 'foe', slot: 2, inUnits: false, standIn: true, found: true, hp: undefined, status: [] }
    expect(seen).toEqual([{ phase: 'before', ...base }, { phase: 'after', ...base }])
    // 真的單位不是替身
    expect(run.isStandIn(a.ally(1))).toBe(false)
    expect(run.overlayOfStandIn(a.ally(1))).toBeUndefined()
  })

  it('反應用 run.attack 打回去：打的是那一台的耐久（不傷遮蔽、不扣替身的生命）；被擊落之後再打回去沒有發生', () => {
    let reacted: unknown
    const a = arena(two(), [TEST_COMBAT], (k) => {
      let done = false
      k.battle.on('attack.after', 'react', ({ run, attacker, target }) => {
        if (!attacker.ext.overlay || done) return
        done = true
        reacted = run.attack(target, attacker, { natural: 20 })
      })
    })
    const run = a.run(dice(6, 6, 6, 6, 6, 6, 6, 6, 6, 6))
    const o = run.addOverlay(turret({ hp: { now: 20, max: 20 }, armor: 0 }))
    const before = clone(a.foe(1))
    run.overlayAttack(o, a.ally(1), { natural: 20 })
    expect(reacted).toMatchObject({ hit: true, track: 'hp' })
    expect(o.hp.now).toBeLessThan(20)
    expect(a.foe(1)).toEqual(before)
    expect(run.beats.filter((b) => b.tag === 'hit' || b.tag === 'crit').map((b) => b.text).some((t) => t.startsWith(`你 用${a.ally(1).weapons[0]!.name}射擊 砲塔：`) && t.includes('命中，砲塔受到'))).toBe(true)
    // 擊落之後，替身再被打：沒有發生
    o.down = true
    const stand = run.standIn(o)
    expect(run.attack(a.ally(1), stand, { natural: 20 })).toMatchObject({ aborted: true, hit: false })
    // 那一台已經不在了（收走）也一樣，不會把替身當成一個人去打
    a.battle.overlays = []
    expect(run.attack(a.ally(1), stand, { natural: 20 })).toMatchObject({ aborted: true })
  })

  it('run.attack 打替身會發 attack.after（目標是替身）：dev/adr/0015「attackOverlay 也發 attack.after」；改打（redirect）照舊不發', () => {
    const after: Array<{ target: string; overlay: unknown; hit: boolean }> = []
    const a = arena(two(), [TEST_COMBAT], (k) => k.battle.on('attack.after', 'spy', ({ attacker, target, result }) => { after.push({ target: `${target.name}`, overlay: target.ext.overlay, hit: result.hit }); void attacker }))
    const run = a.run(dice(6, 6, 6))
    const o = run.addOverlay(ownerless({ slot: 1, name: '標靶', hp: { now: 50, max: 50 } }))
    run.attackOverlay(a.ally(1), o, { natural: 20 })
    expect(after).toEqual([{ target: '標靶', overlay: o.id, hit: true }])
    // 沒有發生的（aborted）不發
    o.down = true
    run.attackOverlay(a.ally(1), o)
    expect(after).toHaveLength(1)
  })

  it('替身身上：applyStatus、shift、place 回傳 false、不丟錯、不記拍；回復、感載、傷害都沒有效果；setOut 不動', () => {
    const a = arena(two(), [TEST_COMBAT], loadRules)
    const run = a.run(dice())
    const o = run.addOverlay(turret())
    const s = run.standIn(o)
    const beats = run.beats.length
    expect(run.applyStatus(s, 'off_generic')).toBe(false)
    expect(run.shift(s, 1)).toBe(false)
    expect(run.place(s, 3)).toBe(false)
    expect(run.setOut(s, 'down')).toBe(false)
    expect(run.heal(s, 5)).toBe(0)
    expect(run.damage(s, 5, 'physical')).toEqual({ dealt: 0, track: 'none' })
    expect(run.addLoad(s, 5)).toBe(0)
    expect(s).toMatchObject({ slot: 1, statuses: [] })
    expect(s.out).toBeUndefined()
    expect(run.beats.length).toBe(beats)
    expect(o.slot).toBe(1)
  })

  it('替身是臨時組的：battle.units 與戰鬥狀態都不多東西；同一台每次組出來一樣', () => {
    const a = arena(two())
    const run = a.run(dice())
    const o = run.addOverlay(turret({ ext: { dmgMult: { hp: 2, load: 3 } } }))
    const units = Object.keys(a.battle.units)
    const s = run.standIn(o)
    expect(Object.keys(a.battle.units)).toEqual(units)
    expect(s).toMatchObject({ id: o.id, side: 'foe', slot: 1, name: '砲塔', armor: 1, evade: 13, dmgMult: { hp: 2, load: 3 }, tags: ['machine', 'overlay'], ext: { overlay: o.id }, control: 'ai' })
    expect(s.weapons[0]).toBe(o.weapon)
    expect(run.standIn(o)).toEqual(s)
    // 之後 round.start 的功能拿它挑目標：用 targetWeight 挑得出人
    const foes = unitsOf(a.battle, otherSide(s.side))
    expect(foes.length).toBeGreaterThan(0)
    for (const t of foes) expect(targetWeight(run, s, t)).toBeGreaterThan(0)
  })
})

describe('義體：implants 與 run.implantStatus', () => {
  const two2 = () => duel([one({ implants: [EYE, ARM], hp: { now: 100, max: 100 } }), one({}, 2)], [foe(), foe()])

  it('implantStatus(off)：有兩件義體的人連續兩次各挑到不同的一件（第一件、第二件），再挑沒有可挑的就回傳 null；挑到的就是 implants 裡的那個物件', () => {
    const a = arena(two2(), [TEST_COMBAT], loadRules)
    const run = a.run()
    const u = a.ally(1)
    const first = run.implantStatus(u, 'off')
    const second = run.implantStatus(u, 'off')
    expect([first, second]).toEqual([EYE, ARM])
    expect(first).toBe(u.implants![0])
    expect(second).toBe(u.implants![1])
    expect(u.statuses.map((s) => s.id)).toEqual(['off_eye', 'off_arm'])
    const beats = run.beats.length
    expect(run.implantStatus(u, 'off')).toBeNull()
    expect(run.beats.length).toBe(beats)
    expect(u.statuses).toHaveLength(2)
    // 超頻是另一個狀態：照樣從第一件挑起
    expect(run.implantStatus(u, 'boost')).toBe(u.implants![0])
    expect(u.statuses.map((s) => s.id)).toEqual(['off_eye', 'off_arm', 'boost_generic'])
  })

  it('指定 kind 而他沒有那一種時回傳 null、沒有記拍、沒有狀態；有的就挑那一種（跳過前面的）', () => {
    const a = arena(two2(), [TEST_COMBAT], loadRules)
    const run = a.run()
    const u = a.ally(1)
    const beats = run.beats.length
    expect(run.implantStatus(u, 'off', { kind: 'leg' })).toBeNull()
    expect(run.beats.length).toBe(beats)
    expect(u.statuses).toEqual([])
    expect(run.implantStatus(u, 'off', { kind: 'arm' })).toBe(u.implants![1])
    expect(u.statuses.map((s) => s.id)).toEqual(['off_arm'])
    // 同一種再來一次：重算時間，不疊加
    expect(run.implantStatus(u, 'off', { kind: 'arm', turns: 5 })).toBe(u.implants![1])
    expect(u.statuses).toHaveLength(1)
    expect(u.statuses[0]!.until).toMatchObject({ turns: 5 })
  })

  it('沒有義體的人回傳 null、沒有記拍（沒有 implants、空的、已經退出都一樣）', () => {
    const a = arena(duel([one(), one({ implants: [] }, 2)], [foe()]), [TEST_COMBAT], loadRules)
    const run = a.run()
    for (const u of [a.ally(1), a.ally(2)]) expect(run.implantStatus(u, 'off')).toBeNull()
    expect(run.beats).toEqual([])
    const b = arena(two2(), [TEST_COMBAT], loadRules)
    b.ally(1).out = 'down'
    expect(b.run().implantStatus(b.ally(1), 'off')).toBeNull()
  })

  it('pick 指定第幾件（最優先，越界是 null）；by、turns 與 until 傳給狀態；狀態的 until 照給的', () => {
    const a = arena(two2(), [TEST_COMBAT], loadRules)
    const run = a.run()
    const u = a.ally(1)
    expect(run.implantStatus(u, 'off', { pick: 1, kind: 'eye', by: a.foe(1), turns: 3 })).toBe(u.implants![1])
    expect(u.statuses).toEqual([{ id: 'off_arm', by: 'f1', until: { at: 'turn_end', of: 'a1', turns: 3 } }])
    expect(run.implantStatus(u, 'off', { pick: 2 })).toBeNull()
    expect(run.implantStatus(u, 'off', { pick: -1 })).toBeNull()
    expect(run.implantStatus(u, 'off', { pick: 0.5 })).toBeNull()
    expect(run.implantStatus(u, 'off', { pick: 0, until: 'source_turn_start', by: a.foe(2) })).toBe(u.implants![0])
    expect(u.statuses.find((s) => s.id === 'off_eye')).toEqual({ id: 'off_eye', by: 'f2', until: { at: 'turn_start', of: 'f2', turns: 2 } })
  })

  it('規則表沒有 off_<種類> 的用 off_generic、boost 用 boost_generic；兩個都沒有丟錯，訊息寫出要哪一個狀態 id', () => {
    const a = arena(duel([one({ implants: [{ kind: 'spine', name: '脊椎' }] })], [foe()]), [TEST_COMBAT], loadRules)
    const run = a.run()
    expect(run.implantStatus(a.ally(1), 'off')!.kind).toBe('spine')
    expect(a.ally(1).statuses.map((s) => s.id)).toEqual(['off_generic'])
    expect(run.implantStatus(a.ally(1), 'boost')!.kind).toBe('spine')
    expect(a.ally(1).statuses.map((s) => s.id)).toEqual(['off_generic', 'boost_generic'])
    // 同樣都退回 _generic 的另一件：狀態 id 一樣，所以第二次沒有可挑的（要換的話用 pick）
    const b = arena(duel([one({ implants: [{ kind: 'spine', name: '脊椎' }, { kind: 'lung', name: '肺' }] })], [foe()]), [TEST_COMBAT], loadRules)
    const r2 = b.run()
    expect(r2.implantStatus(b.ally(1), 'off')!.kind).toBe('spine')
    expect(r2.implantStatus(b.ally(1), 'off')).toBeNull()
    expect(r2.implantStatus(b.ally(1), 'off', { pick: 1 })!.kind).toBe('lung')
    // 連 _generic 都沒有
    const c = arena(duel([one({ implants: [{ kind: 'spine', name: '脊椎' }] })], [foe()]))
    const run3 = c.run()
    expect(() => run3.implantStatus(c.ally(1), 'off')).toThrow(/off_spine/)
    expect(() => run3.implantStatus(c.ally(1), 'off')).toThrow(/off_generic/)
    expect(() => run3.implantStatus(c.ally(1), 'boost')).toThrow(/boost_generic/)
    expect(c.ally(1).statuses).toEqual([])
    expect(run3.beats).toEqual([])
  })

  it('記一拍 status：寫出是哪一件、什麼狀態；失效與超頻的句子不同；失效真的影響數字（狀態的修正照規則表）', () => {
    const a = arena(two2(), [TEST_COMBAT], loadRules)
    const run = a.run()
    const u = a.ally(1)
    run.implantStatus(u, 'off', { by: a.foe(1) })
    expect(run.beats).toEqual([{ layer: 'meat', text: '你 的義眼失效了。', tag: 'status', data: { target: 'a1', status: 'off_eye', implant: 'eye', mode: 'off', by: 'f1' } }])
    run.implantStatus(u, 'boost')
    expect(run.beats.at(-1)).toMatchObject({ text: '你 的義眼超頻了。', data: { status: 'boost_generic', mode: 'boost' } })
    // 只有一拍（狀態自己的那一拍被這一拍取代）
    expect(run.beats.filter((b) => b.tag === 'status')).toHaveLength(2)
    expect(run.mods('hit', u).filter((p) => p.source === 'status').map((p) => p.value)).toEqual([-2])
  })

  it('狀態給不上去（目標是首領又是控制型的狀態、剛被控制過）：回傳 null、不記拍', () => {
    const control = (k: Kernel) => k.content.loadPack({ id: 'c', content: { battle_status: [status('off_generic', '被癱瘓', { kind: 'control' })] } })
    const a = arena(duel([one()], [foe('boss', { implants: [EYE] })]), [TEST_COMBAT], control)
    const run = a.run()
    expect(run.implantStatus(a.foe(1), 'off')).toBe(a.foe(1).implants![0])
    const beats = run.beats.length
    // 剛被控制過：這一輪不再吃控制
    expect(run.implantStatus(a.foe(1), 'off', { kind: 'eye' })).toBeNull()
    expect(run.beats.length).toBe(beats + 1) // 只有「這一次沒有用」那一拍，沒有「失效了」
    expect(run.beats.at(-1)).toMatchObject({ tag: 'status', data: { blocked: true } })
  })
})

describe('義體的來源：單位直接帶、UnitSource、Loadout；cyber 沒寫時用件數', () => {
  const unitSource = (k: Kernel) => k.battle.unitSource('thug', 'test', () => ({ ...foe('minion'), implants: [EYE, { kind: 'arm', name: '義臂', contract: true }] }))

  it('直接給整個單位：implants 照樣在；cyber 沒寫時補成件數，寫了的不動', () => {
    const a = arena(duel([one({ implants: [EYE, ARM] }), one({ implants: [EYE], cyber: 4 }, 2), one({}, 3)], [foe()]))
    expect(a.ally(1)).toMatchObject({ implants: [EYE, ARM], cyber: 2 })
    expect(a.ally(2)).toMatchObject({ implants: [EYE], cyber: 4 })
    expect(a.ally(3).implants).toBeUndefined()
    expect(a.ally(3).cyber).toBeUndefined()
    // 開打時是快照：和輸入不是同一個物件
    expect(a.ally(1).implants![0]).not.toBe(EYE)
  })

  it('UnitSource 回傳的單位可以帶 implants（含 contract）', () => {
    const setup: BattleSetup = { ...duel([one()], [foe()]), foes: [{ from: 'thug' }] }
    const a = arena(setup, [TEST_COMBAT], unitSource)
    expect(a.foe(1)).toMatchObject({ cyber: 2, implants: [EYE, { kind: 'arm', name: '義臂', contract: true }] })
  })

  it('Loadout 可以帶 implants：角色開打時有；沒有義體的角色 loadoutOf 回傳的東西和以前一樣（沒有 implants 這個鍵）', () => {
    const setup: BattleSetup = { ...duel([one()], [foe()]), allies: [{ from: 'actor', id: 'pc' }] }
    const withImplants = arena(setup, [TEST_COMBAT], (k) => k.battle.loadout('t', () => ({ implants: [EYE, ARM] })))
    expect(withImplants.ally(1)).toMatchObject({ actor: 'pc', implants: [EYE, ARM], cyber: 2 })
    const without = arena(setup, [TEST_COMBAT], (k) => k.battle.loadout('t', () => ({ armor: 1 })))
    expect(without.ally(1).implants).toBeUndefined()
    expect('implants' in without.k.battle.loadoutOf(without.state, 'pc', 'meat')).toBe(false)
    expect(without.k.battle.loadoutOf(without.state, 'pc', 'meat')).toEqual({ weapons: [], armor: 1, evade: 0, quick: [], tags: [] })
    // 兩個提供者各給一件：合起來
    const both = arena(setup, [TEST_COMBAT], (k) => { k.battle.loadout('a', () => ({ implants: [EYE] })); k.battle.loadout('b', () => ({ implants: [ARM] })) })
    expect(both.ally(1).implants).toEqual([EYE, ARM])
  })

  it('battleProblems 驗 implants 的形狀：不是陣列、每一件要有 kind 與 name、contract 要是布林值；好的放行', () => {
    const a = arena(duel([one({ implants: [EYE, { kind: 'arm', name: '義臂', contract: true }] })], [foe()]))
    expect(battleProblems(a.battle)).toEqual([])
    const bad = (edit: (u: Record<string, unknown>) => void): string[] => {
      const b = clone(a.battle)
      edit(b.units.a1 as unknown as Record<string, unknown>)
      return battleProblems(b)
    }
    expect(bad((u) => { u.implants = 'eye' })).toEqual(['units.a1：implants 要是義體的陣列'])
    expect(bad((u) => { u.implants = [{ kind: 'eye' }] })).toEqual(['units.a1：implants[0] 要有 kind、name（字串），contract 要是布林值'])
    expect(bad((u) => { u.implants = [{ name: '眼' }] })).toHaveLength(1)
    expect(bad((u) => { u.implants = [{ kind: '', name: '眼' }] })).toHaveLength(1)
    expect(bad((u) => { u.implants = [EYE, 5] })).toEqual(['units.a1：implants[1] 要有 kind、name（字串），contract 要是布林值'])
    expect(bad((u) => { u.implants = [{ kind: 'eye', name: '眼', contract: 'yes' }] })).toHaveLength(1)
    expect(bad((u) => { u.implants = [] })).toEqual([])
    expect(bad((u) => { delete u.implants })).toEqual([])
  })

  it('battleProblems 放寬 owner：可以沒有；有的話要查得到；auto、autonomous 要是布林值、weapon 要是一把武器', () => {
    const a = arena(duel([one()], [foe()]))
    const run = a.run()
    run.addOverlay(init({ slot: 1 }))
    run.addOverlay(ownerless({ slot: 2 }))
    expect(battleProblems(a.battle)).toEqual([])
    const bad = (edit: (o: Record<string, unknown>) => void): string[] => {
      const b = clone(a.battle)
      edit(b.overlays[1] as unknown as Record<string, unknown>)
      return battleProblems(b)
    }
    const id = a.battle.overlays[1]!.id
    expect(bad((o) => { o.owner = 'zz' })).toEqual([`overlays.${id}：操作者 zz 不在這場戰鬥裡`])
    expect(bad((o) => { o.owner = 7 })).toHaveLength(1)
    expect(bad((o) => { o.owner = 'f1' })).toEqual([])
    expect(bad((o) => { o.auto = 1 })).toEqual([`overlays.${id}：auto 要是布林值`])
    expect(bad((o) => { o.autonomous = 'yes' })).toEqual([`overlays.${id}：autonomous 要是布林值`])
    expect(bad((o) => { o.weapon = 3 })).toEqual([`overlays.${id}：weapon 要是一把武器`])
    // 被擊落的也要查得到操作者
    expect(bad((o) => { o.owner = 'zz'; o.down = true })).toHaveLength(1)
  })
})

describe('summons 改用 addOverlay：放出的上限問 overlay_cap、被擊落的回灌問 overlay_backlash、耐久護甲迴避問 overlay_*', () => {
  const pilot = (n = 1, sync = 0) => one({ weapon: 'pistol', hp: { now: 100, max: 100 }, skills: { sync, piloting: 2 }, ext: { summons: { drones: Array.from({ length: n }, () => ({ kind: 'attack', grade: 1 })) } } })
  const game = (mods: Array<(k: Kernel) => void>, n = 2, sync = 0) => {
    const feature: Feature = { id: 'mods', install: (k) => { for (const m of mods) m(k) } }
    const g = makeBattleGame({ features: [TEST_COMBAT, summonsFeature, feature], battle: duel([pilot(n, sync), one({}, 2)], [foe('elite'), foe('elite')]), seed: 7 }).game
    const b = g.state.battle!
    b.turn = b.order.indexOf('a1')
    b.units.a1!.ap.now = b.units.a1!.ap.max
    b.units.a1!.control = 'player'
    return g
  }
  const deploy = (g: ReturnType<typeof game>, drone: number, slot: number) => g.battleAct({ action: 'drone.deploy', target: { side: 'ally', slot }, pick: { drone } })

  it('沒有任何修正：和以前一樣（14／1／13、句子一樣、同一格被擋的原因一樣）', () => {
    const g = game([], 2, 2)
    const r = deploy(g, 0, 2)
    expect(r.status).toBe('applied')
    expect(g.battle!.overlays[0]).toMatchObject({ owner: 'a1', side: 'ally', slot: 2, kind: 'attack', hp: { now: 14, max: 14 }, armor: 1, evade: 13, used: false, down: false, ext: { drone: 0, grade: 1 } })
    expect(r.reports[0]!.timeline.find((b) => b.tag === 'overlay')).toMatchObject({ text: '你 放出攻擊無人機，掛在第 2 格。', data: { overlay: g.battle!.overlays[0]!.id, kind: 'attack', slot: 2 } })
    expect(deploy(g, 1, 2)).toMatchObject({ status: 'refused', reasons: ['這一格已經掛著一台了。'] })
  })

  it('overlay_hp +5、overlay_armor +1、overlay_evade +2 的修正：放出來的耐久（現在與上限）、護甲、迴避各加', () => {
    const g = game([plus('overlay_hp', 5), plus('overlay_armor', 1), plus('overlay_evade', 2)])
    deploy(g, 0, 2)
    expect(g.battle!.overlays[0]).toMatchObject({ hp: { now: 19, max: 19 }, armor: 2, evade: 15 })
  })

  it('overlay_cap：同步 0 本來連 1 台，+1 之後連得住 2 台、第三台被擋（句子照舊，台數是加過的）；−1 連 0 台', () => {
    const g = game([plus('overlay_cap', 1)], 3)
    expect(deploy(g, 0, 1).status).toBe('applied')
    expect(deploy(g, 1, 2).status).toBe('applied')
    expect(deploy(g, 2, 3)).toMatchObject({ status: 'refused', reasons: ['同步 0 級只連得住 2 台。'] })
    const g0 = game([plus('overlay_cap', -1)])
    expect(deploy(g0, 0, 1)).toMatchObject({ status: 'refused', reasons: ['同步 0 級只連得住 0 台。'] })
  })

  /** 把一台擊落：操作者受的感載。 */
  const downIt = (mods: Array<(k: Kernel) => void>, hp = 3) => {
    const a = arena(two([pilot()]), [TEST_COMBAT, summonsFeature], (k) => { for (const m of mods) m(k) })
    const run = a.run(dice(6, 6, 6, 6, 6, 6))
    const o = run.addOverlay(init({ slot: 2, hp: { now: hp, max: hp }, ext: { drone: 0, grade: 1 } }))
    run.attackOverlay(a.foe(1), o, { natural: 20 })
    expect(o.down).toBe(true)
    return a.ally(1).load!.now
  }
  it('被擊落時操作者感載 +5（照舊）；overlay_backlash −2 是 +3、+3 是 +8、−9 最少 0（不會倒扣）', () => {
    expect(downIt([])).toBe(5)
    expect(downIt([plus('overlay_backlash', -2)])).toBe(3)
    expect(downIt([plus('overlay_backlash', 3)])).toBe(8)
    expect(downIt([plus('overlay_backlash', -9)])).toBe(0)
  })

  it('overlay_backlash 的標籤是 [種類]；操作者已經退出就沒有人受灌', () => {
    const seen: Array<{ unit: string; tags: string[] }> = []
    downIt([plus('overlay_backlash', 0, seen)])
    expect(seen).toEqual([{ unit: 'a1', tags: ['attack'] }])
  })

  it('操作者倒下：自己放的無人機照舊停機（summons 沒有把它們標成 autonomous）：down 是 true、拍是「停機了」、沒有被擊落的後果', () => {
    const a = arena(two([pilot(), one({}, 2)]), [TEST_COMBAT, summonsFeature])
    const run = a.run()
    a.ally(1).ap.now = 5
    a.k.battle.getAction('drone.deploy')!.run(run, a.ally(1), { side: 'ally', slot: 2 }, { action: 'drone.deploy', pick: { drone: 0 } })
    const o = a.battle.overlays[0]!
    expect(o).toMatchObject({ owner: 'a1', down: false })
    expect(o.autonomous).toBeUndefined()
    run.setOut(a.ally(1), 'down')
    expect(o).toMatchObject({ down: true, owner: 'a1' })
    expect(o.auto).toBeUndefined()
    expect(run.beats.find((b) => b.tag === 'overlay.down')!.text).toMatch(/停機了/)
    expect(a.ally(2).load!.now).toBe(0)
    expect(a.ally(1).load!.now).toBe(0)
  })
})

describe('存檔往返：帶著沒有操作者的一台與 implants 的戰鬥，存了再讀，接著打的結果和沒有中斷的一樣', () => {
  /**
   * 敵方開打時掛兩台：一台沒有操作者的砲塔、一台屬於 f1 的 autonomous（f1 馬上倒下，它就自律）；每一輪開頭都自己打我方一個人，
   * 並讓我方 a1 的一件義體失效。我方 a1 與敵方 f2 帶著義體。
   */
  const patrol: Feature = {
    id: 'patrol',
    install: (k) => {
      k.battle.on('battle.start', 'patrol', ({ run }) => {
        run.addOverlay(ownerless({ slot: 1, name: '巡邏砲塔', kind: 'turret', auto: true, weapon: { ...testWeapon('pistol', 6), dice: 2 }, ext: { dmgMult: { hp: 1, load: 1 } } }))
        run.addOverlay({ side: 'foe', slot: 2, owner: 'f1', kind: 'attack', name: '附屬機', hp: { now: 10, max: 10 }, armor: 0, evade: 10, weapon: { ...testWeapon('pistol', 4), dice: 2 }, autonomous: true })
        run.setOut(run.unit('f1'), 'down')
      })
      k.battle.on('round.start', 'patrol', ({ run }) => {
        run.implantStatus(run.unit('a1'), 'off')
        for (const o of run.battle.overlays) {
          if (!o.auto || o.down) continue
          const me = run.standIn(o)
          const t = run.pick(unitsOf(run.battle, 'ally'), (x) => targetWeight(run, me, x))
          if (t) run.overlayAttack(o, t, { spend: 0 })
        }
      })
    },
  }
  const setup = (): BattleSetup => duel(
    [one({ implants: [EYE, ARM], hp: { now: 60, max: 60 } }), one({ hp: { now: 60, max: 60 } }, 2)],
    [foe('minion', { hp: { now: 4, max: 4 } }), foe('elite', { implants: [{ kind: 'arm', name: '義臂', contract: true }] }), foe('minion')],
  )
  const start = () => makeBattleGame({ features: [TEST_COMBAT, patrol], content: [PACK], battle: setup(), seed: 21 }).game

  it('開打時的樣子：附屬機在 f1 倒下之後自律（沒有 owner、auto、orphan）；砲塔沒有 owner；義體在', () => {
    const g = start()
    const [turret, drone] = g.battle!.overlays
    expect('owner' in turret!).toBe(false)
    expect(drone).toMatchObject({ down: false, auto: true, autonomous: true, ext: { orphan: true } })
    expect('owner' in drone!).toBe(false)
    expect(g.battle!.units.f1!.out).toBe('down')
    expect(g.battle!.units.a1!.implants).toEqual([EYE, ARM])
    expect(g.battle!.units.a1!.statuses.map((s) => s.id)).toEqual(['off_eye'])
    expect(battleProblems(g.battle)).toEqual([])
  })

  it('每一輪開頭自己打、義體一件一件失效；存檔讀檔不改變狀態、之後的每一步都和沒有中斷的一樣', () => {
    const play = (saveAt: number | null) => {
      const g = start()
      for (let i = 0; i < 90 && !g.battle!.result; i++) {
        if (i === saveAt) {
          const before = stateHash(g.state)
          const raw = g.save('manual', 'x')
          expect(g.load(raw)).toBeNull()
          expect(stateHash(g.state)).toBe(before)
          expect(g.battle!.overlays.map((o) => 'owner' in o)).toEqual([false, false])
          expect(g.battle!.units.a1!.implants).toEqual([EYE, ARM])
        }
        g.battleNext({ anyone: true })
      }
      return g
    }
    const plain = play(null)
    // 確實打到過：砲塔與附屬機打過人、義體失效過兩件以上（至少第 2 輪）
    const text = plain.state.reports.flatMap((r) => r.timeline).map((b) => b.text).join('\n')
    expect(text).toMatch(/巡邏砲塔 用.*射擊/)
    expect(text).toMatch(/附屬機 用.*射擊/)
    expect(text).toMatch(/你 的義眼失效了/)
    expect(plain.battle!.round).toBeGreaterThanOrEqual(2)
    for (const at of [1, 5, 14, 40]) expect(stateHash(play(at).state), `第 ${at} 步存檔`).toBe(stateHash(plain.state))
  })

  it('壞掉的存檔整筆不讀：操作者指到不存在的人', () => {
    const g = start()
    const file = JSON.parse(g.save('manual', 'x')) as { state: { battle: { overlays: Array<Record<string, unknown>> } } }
    file.state.battle.overlays[0]!.owner = 'zz'
    const before = stateHash(g.state)
    expect(g.load(JSON.stringify(file))).toMatch(/存檔壞了.*battle：overlays\..*操作者 zz 不在這場戰鬥裡/)
    expect(stateHash(g.state)).toBe(before)
  })
})

describe('Arena 型別（給 TypeScript 看一下 helpers 的形狀沒有壞）', () => {
  it('arena() 開打時已經發過第一輪的 round.start', () => {
    const a: Arena = arena()
    expect(a.battle.round).toBe(1)
    expect(tags({ beats: a.run().beats })).toEqual([])
  })
})
