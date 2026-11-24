// 驗收測試：dev/work/M3-maze.md（cpp-feature）。features/maze：迷宮館（報名、三層、機關、寶箱、時間與評價、籌碼、打輸只是斷線）。
// 規格：CYBERSPACE 3.3 節、8.1 節（密度表迷宮館那一列、壓力條）、8.2 節；ENEMIES 第 9 節最後一列；DATA 第 10 節；dev/adr/0018 第六、十三節。
// 內容是測試自帶的最小假資料：三個遊戲敵人（雜兵、精英、首領）、一副比賽甲板與一副自己的甲板、四個構裝（比賽版、I、II、III 級）、一張寶箱表與一張獎品表、maze_rule 的小表；不讀 engine/data。
// netrun 用真的（活動、生成、探索回合、閘門）；deck 用真的（deck_rental、deck_grade）；戰鬥用 TEST_NET_COMBAT 加一把很強的攻擊構裝；敵人用真的 enemies。
// 骰面：檢定與擲表的骰面由狀態的亂數導出，要某一種結果的測試掃種子（先在乾淨的一局上試，再用找到的種子正式做）。

import { describe, expect, it } from 'vitest'
import type { Change, ContentPack, Feature, Origin } from '../../src'
import { ActionBlocked, Sheet, clone, endActivity, gridHere, meterOf, pointKey } from '../../src'
import { deckFeature } from '../../src/features/deck'
import { enemiesFeature } from '../../src/features/enemies'
import { netExt, netrunFeature, readRun, regionOf, regionProblems, useNode } from '../../src/features/netrun'
import { generateSheet, seedRand } from '../../src'
import { layerSpec } from '../../src/features/netrun'
import {
  DEFAULT_REGION, DEFAULT_RULES, brackets, enter, enterBlocks, mazeFeature, mazeRegion, mazeRules, mazeView, open, openBlock, rate, readMaze, ruleProblems, solve, solveBlock, tableProblems, useMaze,
} from '../../src/features/maze'
import { TEST_NET_COMBAT, makeActor, makeGame, netWeapon, playOut } from '../../src/testkit'

type Rec = Record<string, any>

// ===================================================================================================================
// 假資料
// ===================================================================================================================

const SKILLS = ['firearms', 'brawl', 'composure', 'interface', 'sync', 'stealth', 'streetwise', 'athletics'].map((id) => ({
  id, name: id, desc: `${id}。`,
  attr: id === 'composure' ? 'resolve' : id === 'stealth' || id === 'firearms' ? 'reflex' : id === 'interface' || id === 'streetwise' ? 'intellect' : 'body',
}))
const program = (id: string, rank: string, o: Rec = {}): Rec => ({
  id, name: `遊戲敵人${id}`, desc: '迷宮館的遊戲敵人。', faction: 'maze', rank, grades: [1, 5], kind: 'program',
  position: { prefer: [2, 3], cover_use: 0.5 }, ai: { prefer: 'overloaded', focus: 1, flee_below: 0 }, ...o,
})
const deck = (id: string, o: Rec = {}): Rec => ({ id, name: id, desc: `${id}。`, grade: 1, slots: 2, firewall: 10, legal: 'free', ...o })
const construct = (id: string, grade: number, o: Rec = {}): Rec => ({ id, class: 'weapon', name: `構裝${id}`, grade, legal: 'free', type: 'neural', ram: 1, archetype: 'pistol', ...o })
const WEAPON_CLASSES = [{ id: 'pistol', name: '手槍', dice: 3, type: 'physical', range: [1, 4], mag: 2, cover_mult: 0.25, pierce: 0, traits: [], attr: 'reflex', skill: 'firearms' }]
const item = (id: string, name: string): Rec => ({ id, name, desc: `${name}。`, category: 'misc', grade: 1, size: 0, legal: 'free' })

/** 寶箱表：兩列都給東西（籌碼與回復腳本）加一列「再擲獎品表」；獎品表：兩列。 */
const CHEST = { id: 'chest', kind: 'chest', rows: [
  { weight: 1, name: '比賽籌碼', chips: [3, 8] },
  { weight: 1, name: '回復腳本', give: [{ kind: 'item', id: 'it_potion', qty: 1 }] },
  { weight: 1, name: '神祕的寶箱', prize: true },
] }
const PRIZE = { id: 'prize', kind: 'prize', rows: [
  { weight: 1, name: '正式版構裝', give: [{ kind: 'item', id: 'it_prize', qty: 1 }] },
  { weight: 1, name: '三十枚籌碼', chips: 30 },
] }

const pack = (rule: Rec = {}, extra: Rec = {}, drop: string[] = []): ContentPack => ({
  id: 'maze_test',
  content: Object.fromEntries(Object.entries({
    skill: SKILLS,
    weapon_class: WEAPON_CLASSES,
    battle_status: (['weapon', 'defense', 'tool'] as const).map((s) => ({ id: `jam_${s}`, name: `${s}構裝停用`, desc: '被干擾。', until: 'own_turn_end', turns: 1, kind: 'debuff' })),
    faction: [{ id: 'maze', name: '迷宮館', short: '館', class: 'corp' }],
    enemy: [program('mz_slime', 'minion'), program('mz_knight', 'elite'), program('mz_king', 'boss')],
    deck: [deck('dk_rent', { name: '館方的比賽甲板' }), deck('dk_own', { grade: 2, slots: 3 })],
    construct: [construct('cs_kit', 1, { name: '比賽版' }), construct('cs_g1', 1), construct('cs_g2', 2), construct('cs_g3', 3)],
    item: [item('it_potion', '回復腳本'), item('it_prize', '正式版構裝')],
    maze_table: [CHEST, PRIZE],
    maze_rule: [{ id: 'default', brackets: { rookie: { deck: 'dk_rent', kit: ['cs_kit'] }, open: { kit: ['cs_kit'] } }, mimic: 0, chest_table: 'chest', prize_table: 'prize', ...rule }],
    ...extra,
  }).filter(([kind]) => !drop.includes(kind))) as never,
})

/** 內海的武器構裝（很強，讓戰鬥一回合就結束）與一個「拔線」的行動。 */
const COMBAT: Feature = {
  id: 'maze_test_combat',
  install(k) {
    k.battle.loadout('maze_test_combat', (_s, _a, mode) => (mode === 'net' ? { weapons: [netWeapon(40, 14)] } : undefined))
    k.battle.action({
      id: 'test.net.jack', owner: 'maze_test_combat', name: '拔線', desc: '自己登出。', group: 'system', icon: 'flee', modes: ['net'], target: 'none', order: 9,
      cost: () => ({ ap: 1 }),
      run: (run, u) => void run.setOut(u, 'jacked_out'),
    })
  },
}

const FEATURES: Feature[] = [enemiesFeature, deckFeature, netrunFeature, TEST_NET_COMBAT, COMBAT, mazeFeature]

interface Opts {
  seed?: number
  /** 隊員：幾個人（主角加同伴） */
  party?: number
  cash?: number
  rule?: Rec
  features?: Feature[]
  /** 主角裝著的構裝與自己的甲板 */
  slots?: string[]
  ownDeck?: boolean
  extra?: Rec
  /** 不載入的內容種類（那個功能沒裝） */
  drop?: string[]
}
type G = ReturnType<typeof makeGame>['game']

function setup(o: Opts = {}) {
  const ext = (own: boolean) => ({ deck: { ...(own ? { uid: 'D1' } : {}), slots: o.slots ?? [], scripts: [] } })
  const pc = { attrs: { intellect: 14, body: 12, resolve: 14, reflex: 14 }, skills: { interface: 3, streetwise: 2, firearms: 3 }, ext: ext(o.ownDeck === true) }
  const actors = Array.from({ length: (o.party ?? 2) - 1 }, (_, i) => makeActor({ id: `c${i + 1}`, name: `同伴${i + 1}`, role: 'companion', ext: ext(o.ownDeck === true) }))
  const inventory = o.ownDeck ? [{ id: 'dk_own', qty: 1, data: { uid: 'D1' } }] : []
  const t = makeGame({
    seed: o.seed ?? 5, features: o.features ?? FEATURES, content: [pack(o.rule, o.extra, o.drop)], pc: pc as never, actors,
    patch: { money: { cred: 0, cash: o.cash ?? 2000 }, ...(inventory.length ? { inventory } : {}) } as never,
  })
  return t.game
}

const commit = (g: G, changes: Change[], action = 'netrun.test'): ReturnType<G['commit']> => g.commit({ kind: 'system', action, location: {}, party: [], timeline: [], changes, outcome: { result: 'ok', summary: '測試' } })
const cash = (g: G): number => g.state.money.cash
const run = (g: G) => readRun(g.state)!
const mz = (g: G) => readMaze(g.state)!
const ext = (g: G) => netExt(g.state, run(g).map)!
const here = (g: G) => gridHere(g.k, g.state)!
const sheetOf = (g: G): Sheet => here(g).sheet
const marks = (g: G, mark: string) => (sheetOf(g).def.cells ?? []).filter((m) => m.mark === mark)
const at = (g: G): [number, number] => [g.state.maps.at!.x, g.state.maps.at!.y]

// ===================================================================================================================
// 一、規則表與這一區
// ===================================================================================================================

describe('規則與這一區的預設（CYBERSPACE 8.2 節、8.1 節密度表）', () => {
  it('三組的押金與獎金、每層的標準回合數、評價的倍率、機關失敗的感載、寶箱怪的機率、籌碼的價值', () => {
    const r = DEFAULT_RULES
    expect(r.brackets.rookie!.grades).toEqual([{ grade: 1, deposit: 50, prize: 300 }])
    expect(r.brackets.open!.grades).toEqual([{ grade: 2, deposit: 150, prize: 900 }])
    expect(r.brackets.unlimited!.grades).toEqual([{ grade: 3, deposit: 500, prize: 3000 }, { grade: 4, deposit: 1600, prize: 9800 }])
    expect(r.layers.map((l) => l.standard)).toEqual([12, 15, 10])
    expect(r.rating.map((x) => [x.rating, x.mult])).toEqual([['S', 1.5], ['A', 1.2], ['B', 1], ['C', 0.7]])
    expect(r.puzzle_load).toBe(8)
    expect(r.mimic).toBe(0.1)
    expect(r.chip).toBe(10)
    expect(r.rest_load).toBe(10)
    expect(r.max_party).toBe(4)
    expect(ruleProblems(r as never)).toEqual([])
  })

  it('這一區：9 × 7、挖 18～24 步、沒有追蹤度、倒下不加沉溺、每層 2 場遭遇、機關 1、寶箱 1～2、陷阱 0～1、沒有巡邏與休息點；netrun 收得下', () => {
    expect(DEFAULT_REGION).toMatchObject({ id: 'maze', map_kind: 'maze', size: [9, 7], carve: [18, 24], pressure: 'none', safe: true, puzzle: [1, 1] })
    expect(DEFAULT_REGION.layer).toMatchObject({ foe: [2, 2], archive: [1, 2], trap: [0, 1], patrol: [0, 0], rest: [0, 0] })
    expect(regionProblems(DEFAULT_REGION as never)).toEqual([])
    const g = setup()
    expect(regionOf(g.k, mazeRegion(mazeRules(g.k)))).toMatchObject({ region: { id: 'maze', puzzle: [1, 1], handled: ['a', 'm'], pressure: 'none', safe: true } })
  })

  it('資料的 maze_rule 蓋掉預設（組別個別蓋、其餘欄位整個蓋）；region 蓋掉這一區的欄位', () => {
    const g = setup({ rule: { chip: 25, layers: [{ name: '甲', standard: 5 }], brackets: { rookie: { deck: 'dk_rent', kit: ['cs_kit'] }, vip: { name: '貴賓組', grades: [{ grade: 5, deposit: 9, prize: 99 }] } }, region: { carve: [10, 12], layer: { foe: [1, 1] } } } })
    const r = mazeRules(g.k)
    expect(r.chip).toBe(25)
    expect(r.layers).toEqual([{ name: '甲', standard: 5 }])
    expect(r.brackets.rookie).toMatchObject({ name: '新手組', deck: 'dk_rent', kit: ['cs_kit'], grades: [{ grade: 1, deposit: 50, prize: 300 }] })
    expect(r.brackets.vip).toMatchObject({ name: '貴賓組' })
    const region = mazeRegion(r)
    expect(region).toMatchObject({ carve: [10, 12], size: [9, 7], handled: ['a', 'm'] })
    expect(region.layer).toMatchObject({ foe: [1, 1], archive: [1, 2] })
  })

  it('格式檢查：壞的規則與壞的表一條一句', () => {
    expect(ruleProblems({ mimic: 2 })).not.toEqual([])
    expect(ruleProblems({ layers: [] })).not.toEqual([])
    expect(ruleProblems({ rating: [{ rating: 'S', mult: 1, ratio: 1 }] })).not.toEqual([])
    expect(ruleProblems({ brackets: { newone: { name: 'x' } } })).not.toEqual([])
    expect(ruleProblems({ brackets: { rookie: { guard: ['dragon'] } } })).not.toEqual([])
    expect(ruleProblems({ solve: [{ id: 'x' }] })).not.toEqual([])
    expect(ruleProblems({ chip: 10 })).toEqual([])
    expect(tableProblems({ kind: 'lootbox', rows: [] })).not.toEqual([])
    expect(tableProblems({ kind: 'chest', rows: [{ weight: 0, chips: 1 }] })).not.toEqual([])
    expect(tableProblems({ kind: 'chest', rows: [{ weight: 1 }] })).not.toEqual([])
    expect(tableProblems({ kind: 'chest', rows: [{ weight: 1, chips: [5, 3] }] })).not.toEqual([])
    expect(tableProblems(CHEST as never)).toEqual([])
    expect(tableProblems(PRIZE as never)).toEqual([])
  })

  it('評價：回合數對標準的比例與倒下的人數，照順序第一列符合的就是；剛好在標準以內、沒人倒下是 S；最後一列墊底', () => {
    const r = DEFAULT_RULES
    const at = (rounds: number, downs: number) => rate(r, rounds, 37, downs).rating
    expect(at(37, 0)).toBe('S')
    expect(at(1, 0)).toBe('S')
    expect(at(38, 0)).toBe('A')
    expect(at(37, 1)).toBe('A')
    expect(at(46, 1)).toBe('A')
    expect(at(47, 1)).toBe('B')
    expect(at(37, 2)).toBe('B')
    expect(at(59, 2)).toBe('B')
    expect(at(60, 2)).toBe('C')
    expect(at(37, 3)).toBe('C')
    expect(at(500, 9)).toBe('C')
    expect(rate(r, 37, 37, 0).mult).toBe(1.5)
    expect(rate(r, 100, 37, 0).mult).toBe(0.7)
  })
})

// ===================================================================================================================
// 二、報名
// ===================================================================================================================

describe('報名：組別、押金、能用的構裝', () => {
  it('brackets：三組（無差別組 III、IV 級各一列）；每一列有押金、獎金、能不能用自己的構裝、能不能報', () => {
    const g = setup()
    const rows = brackets(g.k, g.state)
    expect(rows.map((r) => [r.id, r.grade, r.deposit, r.prize])).toEqual([['rookie', 1, 50, 300], ['open', 2, 150, 900], ['unlimited', 3, 500, 3000], ['unlimited', 4, 1600, 9800]])
    expect(rows[0]).toMatchObject({ name: '新手組', own: false, deck: 'dk_rent', blocks: [], block: null })
    expect(rows[1]).toMatchObject({ own: true, maxGrade: 2 })
    // 沒有自己的甲板：新手組有館方發的甲板能報，公開組與無差別組要自己有甲板
    expect(rows[1]!.block).toMatch(/甲板/)
    expect(rows[2]!.block).toMatch(/甲板/)
  })

  it('新手組：付押金、替隊上每個人租比賽甲板、開一趟 netrun（三層、等級 I、origin.by 是 maze、region 整筆是這一區）', () => {
    const g = setup()
    expect(g.k.stats.stat(g.state, 'pc', 'deck_grade')).toBe(0)
    const reports = g.commit(enter(g.k, g.state, 'rookie', { seed: 11 }))
    expect(reports.map((r) => r.action)).toEqual(['maze.enter', 'netrun.enter'])
    expect(cash(g)).toBe(2000 - 50)
    for (const id of ['pc', 'c1']) {
      expect(g.state.actors[id]!.ext.deck).toMatchObject({ rental: { deck: 'dk_rent' } })
      expect(g.k.stats.stat(g.state, id, 'deck_grade')).toBe(1)
    }
    expect(mz(g)).toMatchObject({ bracket: 'rookie', grade: 1, deposit: 50, rented: ['pc', 'c1'], origin: { by: 'maze', ref: 'rookie' } })
    expect(run(g)).toMatchObject({ kind: 'netrun', region: 'maze', grade: 1, layers: ['l1', 'l2', 'l3'], layer: 0, origin: { by: 'maze', ref: 'rookie' } })
    expect(run(g).setup).toMatchObject({ faction: 'maze', layers: ['前庭', '迴廊', '館主廳'], encounter: ['elite', 'elite', 'minion'] })
    expect(g.state.maps.instances[run(g).map]!.gen?.map.kind).toBe('maze')
    expect(g.k.activity.active(g.state).map((a) => a.kind)).toEqual(['netrun'])
  })

  it('公開組（要有自己的甲板）：押金 C$150、等級 II；不租甲板', () => {
    const g = setup({ ownDeck: true })
    g.commit(enter(g.k, g.state, 'open', { seed: 3 }))
    expect(cash(g)).toBe(2000 - 150)
    expect(mz(g)).toMatchObject({ bracket: 'open', grade: 2, rented: [] })
    expect(run(g).grade).toBe(2)
    expect(g.state.actors.pc!.ext.deck).not.toHaveProperty('rental')
  })

  it('無差別組：III 級押金 C$500、IV 級 C$1,600；沒選等級是 III；沒有這一級的擋下', () => {
    const g = setup({ ownDeck: true })
    expect(enterBlocks(g.k, g.state, 'unlimited', 4)).toEqual([])
    expect(enterBlocks(g.k, g.state, 'unlimited', 2)).toEqual(['無差別組沒有 II 級。'])
    const a = setup({ ownDeck: true, seed: 8 })
    a.commit(enter(a.k, a.state, 'unlimited', { grade: 4, seed: 4 }))
    expect(cash(a)).toBe(2000 - 1600)
    expect(run(a).grade).toBe(4)
    // 無差別組的最後一場是首領戰（沒有另外指定守閘門的組合，用 netrun 的預設）
    expect(run(a).setup).not.toHaveProperty('encounter')
    const b = setup({ ownDeck: true, seed: 8 })
    b.commit(enter(b.k, b.state, 'unlimited', { seed: 4 }))
    expect(cash(b)).toBe(2000 - 500)
    expect(run(b).grade).toBe(3)
  })

  it('公開組帶 III 級構裝被擋並有原因；比賽版與 I～II 級的構裝可以', () => {
    const g = setup({ ownDeck: true, slots: ['cs_g3'] })
    const why = enterBlocks(g.k, g.state, 'open')
    expect(why).toHaveLength(2)
    expect(why[0]).toMatch(/測試主角.*「構裝cs_g3」（III 級）/)
    expect(why[1]).toMatch(/同伴1|測試主角/)
    expect(() => enter(g.k, g.state, 'open')).toThrow(/III 級/)
    expect(cash(g)).toBe(2000)
    expect(brackets(g.k, g.state).find((r) => r.id === 'open')!.block).toMatch(/III 級/)
    // 無差別組不限
    expect(enterBlocks(g.k, g.state, 'unlimited')).toEqual([])
    for (const slots of [['cs_g2'], ['cs_g1', 'cs_kit'], ['cs_kit']]) {
      const ok = setup({ ownDeck: true, slots })
      expect(enterBlocks(ok.k, ok.state, 'open'), slots.join()).toEqual([])
    }
  })

  it('新手組一律用館方的比賽版：自己的構裝（不是比賽版）被擋；比賽版可以', () => {
    const g = setup({ slots: ['cs_g1'] })
    expect(enterBlocks(g.k, g.state, 'rookie').join('')).toMatch(/新手組只能用館方發的比賽版構裝.*「構裝cs_g1」/)
    expect(enterBlocks(setup({ slots: ['cs_kit'] }).k, setup({ slots: ['cs_kit'] }).state, 'rookie')).toEqual([])
  })

  it('錢不夠付押金被擋（原因寫出差多少）；什麼都沒動', () => {
    const g = setup({ cash: 49 })
    expect(enterBlocks(g.k, g.state, 'rookie')[0]).toMatch(/押金不夠.*C\$50/)
    expect(() => enter(g.k, g.state, 'rookie')).toThrow(/押金不夠/)
    expect(readMaze(g.state)).toBeNull()
    expect(g.k.activity.active(g.state)).toEqual([])
    expect(enterBlocks(setup({ cash: 50 }).k, setup({ cash: 50 }).state, 'rookie')).toEqual([])
  })

  it('一隊最多四人；剛在網內倒下的人（net_burn）一小時內不能報；已經在迷宮館裡不能再報', () => {
    const five = setup({ party: 5 })
    expect(enterBlocks(five.k, five.state, 'rookie')).toEqual(['一隊最多 4 個人（現在隊上有 5 個）。'])
    expect(enterBlocks(setup({ party: 4 }).k, setup({ party: 4 }).state, 'rookie')).toEqual([])
    const g = setup()
    commit(g, [{ op: 'actor.condition', id: 'c1', condition: 'net_burn', until: 100000 }])
    expect(enterBlocks(g.k, g.state, 'rookie')[0]).toMatch(/同伴1剛在網內倒下/)
    const h = setup()
    h.commit(enter(h.k, h.state, 'rookie', { seed: 2 }))
    expect(enterBlocks(h.k, h.state, 'rookie')[0]).toBe('你已經報了名，先把這一趟做完。')
  })

  it('沒有這一組、單人報名都可以', () => {
    const g = setup({ party: 1 })
    expect(() => enter(g.k, g.state, 'nope')).toThrow(/沒有「nope」這一組/)
    g.commit(enter(g.k, g.state, 'rookie', { seed: 2 }))
    expect(mz(g).rented).toEqual(['pc'])
  })

  it('把 netrun 拿掉，報名被擋並有原因「迷宮館現在沒有開放。」；每一組都是', () => {
    const g = setup({ features: [enemiesFeature, deckFeature, TEST_NET_COMBAT, mazeFeature] })
    expect(enterBlocks(g.k, g.state, 'rookie')).toEqual(['迷宮館現在沒有開放。'])
    expect(() => enter(g.k, g.state, 'rookie')).toThrow(ActionBlocked)
    expect(() => enter(g.k, g.state, 'rookie')).toThrow('迷宮館現在沒有開放。')
    expect(brackets(g.k, g.state).every((r) => r.block === '迷宮館現在沒有開放。')).toBe(true)
    expect(cash(g)).toBe(2000)
  })

  it('把 maze 拿掉，netrun 照樣跑得起來（一般的子網開得起來、走得動、結束得了）', () => {
    const g = setup({ features: [enemiesFeature, deckFeature, netrunFeature, TEST_NET_COMBAT, COMBAT], drop: ['maze_rule', 'maze_table'] })
    commit(g, [{ op: 'actor.ext', id: 'pc', key: 'deck', value: { rental: { deck: 'dk_rent' } } }])
    g.launch('netrun', { region: { id: 'plain', name: '一般', map_kind: 'subnet', size: [9, 7], carve: [16, 22], pressure: 'none', cover: 'medium', dc: [10, 13, 16, 19, 22], layer: { foe: [0, 0], patrol: [0, 0], archive: [0, 0], trap: [0, 0], rest: [1, 1], safe: [0, 0], control: [0, 0], person: [0, 0] } }, grade: 1, seed: 3, encounter: [] }, { by: 'core' })
    expect(readRun(g.state)).toMatchObject({ region: 'plain' })
    const gate = marks(g, 'g')[0]!.at
    commit(g, [{ op: 'map.at', to: { map: run(g).map, sheet: 'l1', x: gate[0], y: gate[1] } }])
    g.commit(useNode(g.k, g.state, 'pass'))
    expect(readRun(g.state)).toBeNull()
  })

  it('開不起來（敵人查不到）：整步不成立，押金沒收走、沒有租到甲板、沒有這一趟的狀態', () => {
    const g = setup({ features: [deckFeature, netrunFeature, TEST_NET_COMBAT, COMBAT, mazeFeature], drop: ['enemy'] })
    const before = cash(g)
    const r = (() => { try { return g.commit(enter(g.k, g.state, 'rookie', { seed: 2 })) } catch (e) { return e } })()
    expect(r).toBeTruthy()
    expect(cash(g)).toBe(before)
    expect(readMaze(g.state)).toBeNull()
    expect(g.state.actors.pc!.ext.deck).not.toHaveProperty('rental')
    expect(readRun(g.state)).toBeNull()
  })
})
