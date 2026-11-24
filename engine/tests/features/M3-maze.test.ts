// 驗收測試：dev/work/M3-maze.md（cpp-feature）。features/maze：迷宮館（報名、三層、機關、寶箱、時間與評價、籌碼、打輸只是斷線）。
// 規格：CYBERSPACE 3.3 節、8.1 節（密度表迷宮館那一列、壓力條）、8.2 節；ENEMIES 第 9 節最後一列；DATA 第 10 節；dev/adr/0018 第六、十三節。
// 內容是測試自帶的最小假資料：三個遊戲敵人（雜兵、精英、首領）、一副比賽甲板與一副自己的甲板、四個構裝（比賽版、I、II、III 級）、一張寶箱表與一張獎品表、maze_rule 的小表；不讀 engine/data。
// netrun 用真的（活動、生成、探索回合、閘門）；deck 用真的（deck_rental、deck_grade）；戰鬥用 TEST_NET_COMBAT 加一把很強的攻擊構裝；敵人用真的 enemies。
// 骰面：檢定與擲表的骰面由狀態的亂數導出，要某一種結果的測試掃種子（先在乾淨的一局上試，再用找到的種子正式做）。

import { describe, expect, it, vi } from 'vitest'
import type { Change, ContentPack, Feature, Origin } from '../../src'
import { ActionBlocked, Sheet, clone, endActivity, gridHere, gridView, meterOf, pointKey } from '../../src'
import { deckFeature } from '../../src/features/deck'
import { diveFeature, exit as diveExit, readDive } from '../../src/features/dive'
import { enemiesFeature } from '../../src/features/enemies'
import { logout as netrunLogout, netExt, netrunFeature, readRun, regionOf, regionProblems, useNode } from '../../src/features/netrun'
import { generateSheet, seedRand } from '../../src'
import { layerSpec } from '../../src/features/netrun'
import {
  DEFAULT_REGION, DEFAULT_RULES, brackets, enter, enterBlocks, mazeFeature, mazeRegion, mazeRules, mazeView, open, openBlock, rate, readMaze, ruleProblems, solve, solveBlock, tableProblems, useMaze,
} from '../../src/features/maze'
import { closeRun } from '../../src/features/maze/ops'
import { chipKey, downKey, roundKey } from '../../src/features/maze/model'
import { TEST_NET_COMBAT, makeActor, makeGame, netWeapon, observed, playOut } from '../../src/testkit'
import { snapshotText, validateState } from '../../src/shell/save'

type Rec = Record<string, any>

// 走完一整趟迷宮館要打八場真的內海戰鬥（一個測試約 2～3 秒）；全套一起跑、機器忙的時候會慢好幾倍，預設的十秒不夠（M3 冒煙查到的：data-rules 回報全套跑時逾時一次，單獨跑 7 秒多）
vi.setConfig({ testTimeout: 60_000 })

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

// ===================================================================================================================
// 三、開出來的地圖
// ===================================================================================================================

const key = (p: [number, number]) => `${p[0]},${p[1]}`
const teleport = (g: G, p: [number, number], sheet?: string): void => void commit(g, [{ op: 'map.at', to: { map: run(g).map, sheet: sheet ?? g.state.maps.at!.sheet, x: p[0], y: p[1] } }])
/** 鄰格：先找走得上去的；沒有（旁邊都是還沒解開的機關或別的遭遇）就取不是牆的第一個（測試直接放過去）。 */
function neighbourOf(g: G, p: [number, number]): [number, number] {
  const sheet = sheetOf(g)
  const around = ([[0, -1], [1, 0], [0, 1], [-1, 0]] as const).map(([dx, dy]) => [p[0] + dx, p[1] + dy] as [number, number]).filter(([x, y]) => sheet.inBounds(x, y))
  const pick = around.find(([x, y]) => sheet.walkable(x, y)) ?? around.find(([x, y]) => sheet.kindAt(x, y) !== 'wall')
  if (!pick) throw new Error(`${key(p)} 旁邊沒有可以站的格子`)
  return pick
}
const standNear = (g: G, p: [number, number]): void => teleport(g, neighbourOf(g, p))
const rookie = (o: Opts = {}, seed = 11): G => {
  const g = setup(o)
  g.commit(enter(g.k, g.state, 'rookie', { seed }))
  return g
}
const reportsOf = (g: G, action: string) => g.state.reports.filter((r) => r.action === action)
/** 站在遭遇節點旁邊，開戰。 */
function fightAt(g: G, foeId: string): void {
  const foe = sheetOf(g).marker(foeId)!
  standNear(g, foe.at)
  g.commit(useNode(g.k, g.state, 'fight', foeId))
}
/** 這一層的遭遇節點一個一個打贏（每個都站到旁邊、開戰、自動打完、結算）。 */
async function winFoes(g: G): Promise<void> {
  for (const foe of marks(g, 'f')) {
    if (sheetOf(g).kindAt(foe.at[0], foe.at[1]) !== 'net_foe') continue
    fightAt(g, foe.id)
    expect(playOut(g).outcome).toBe('win')
    await g.finishBattle()
  }
}
/** 打完這一層、走到閘門、往下一層（最後一層是通過出口）。 */
async function clearLayer(g: G): Promise<void> {
  await winFoes(g)
  teleport(g, marks(g, 'g')[0]!.at)
  g.commit(useNode(g.k, g.state, run(g).layer === run(g).layers.length - 1 ? 'pass' : 'descend'))
}
const roundsOf = (g: G): number[] => mazeView(g.k, g.state)!.layers.map((l) => l.used)

describe('開出來的地圖', () => {
  it('9 × 7、三層、kind 是 maze；每層 2 場遭遇、1 個機關、1～2 個寶箱、沒有休息點與巡邏、看不到的陷阱最多 1 個且是警報節點（20 個種子）', () => {
    for (let seed = 1; seed <= 20; seed++) {
      const g = rookie({ seed }, seed)
      const inst = g.state.maps.instances[run(g).map]!
      expect(inst.gen!.map.kind).toBe('maze')
      expect(inst.gen!.map.size).toEqual([9, 7])
      expect(inst.gen!.map.sheets).toHaveLength(3)
      for (const sheet of inst.gen!.map.sheets) {
        expect(sheet.size).toEqual([9, 7])
        const cells = sheet.cells ?? []
        const n = (mark: string) => cells.filter((m) => m.mark === mark).length
        expect(n('f'), `${seed} 遭遇`).toBe(2)
        expect(n('m'), `${seed} 機關`).toBe(1)
        expect(n('a'), `${seed} 寶箱`).toBeGreaterThanOrEqual(1)
        expect(n('a')).toBeLessThanOrEqual(2)
        expect(n('r'), `${seed} 休息點`).toBe(0)
        expect(n('E')).toBe(1)
        expect(n('g')).toBe(1)
        expect(sheet.sight).toBe(2)
      }
      for (const sheet of Object.keys(ext(g).graph)) {
        const traps = ext(g).traps[sheet]!
        expect(traps.length).toBeLessThanOrEqual(1)
        expect(traps.every((t) => t.kind === 'net_alarm')).toBe(true)
        expect(ext(g).patrols).toEqual([])
      }
      expect(ext(g)).toMatchObject({ region: 'maze', grade: 1, dc: 10 })
    }
  })

  it('節點的數量：18～24 步挖出來的每一層是 6～11 個節點（一百個種子，九成以上是 7～8 個；設計書 6～8）', () => {
    const g = setup()
    const found = regionOf(g.k, mazeRegion(mazeRules(g.k)))
    if ('problem' in found) throw new Error(found.problem)
    const counts: number[] = []
    for (let seed = 1; seed <= 100; seed++) {
      const res = generateSheet(layerSpec(found.region, found.region.layer, 'l1', '前庭', false, false), seedRand(seed, 'maze'))
      counts.push(res.graph.nodes.length)
    }
    expect(Math.min(...counts)).toBeGreaterThanOrEqual(6)
    expect(Math.max(...counts)).toBeLessThanOrEqual(11)
    expect(counts.filter((n) => n <= 8).length).toBeGreaterThanOrEqual(90)
  })

  it('每一層入口走得到出口、機關與遭遇當成過得去（生成器的保證）；機關是 net_puzzle（走不上去）、寶箱是 net_archive', () => {
    const g = rookie()
    const sheet = sheetOf(g)
    const puzzle = marks(g, 'm')[0]!
    expect(sheet.kindAt(puzzle.at[0], puzzle.at[1])).toBe('net_puzzle')
    expect(sheet.walkable(puzzle.at[0], puzzle.at[1])).toBe(false)
    const chest = marks(g, 'a')[0]!
    expect(sheet.kindAt(chest.at[0], chest.at[1])).toBe('net_archive')
    expect(sheet.walkable(chest.at[0], chest.at[1])).toBe(true)
    expect(ext(g).safe_path.l1!.length).toBeGreaterThan(1)
  })

  it('戰鬥沒有追蹤度（field 沒有 trace）、館方的熔斷（field.safe）；這一區沒有量表', async () => {
    const g = rookie()
    const foe = marks(g, 'f')[0]!
    fightAt(g, foe.id)
    const b = g.battle!
    expect(b.mode).toBe('net')
    expect(b.field).toEqual({ safe: true })
    expect(b.field).not.toHaveProperty('trace')
    expect(Object.values(b.units).filter((u) => u.side === 'foe').length).toBeGreaterThanOrEqual(1)
    expect(b.origin.ext).toMatchObject({ by: 'netrun', net: { run: run(g).id, region: 'maze', node: foe.id } })
    playOut(g)
    await g.finishBattle()
    expect(meterOf(g.k, g.state, 'trace', run(g).map)).toBe(0)
  })

  it('有人昏過去（burnout）沉溺不變（場地 safe）；對照：沒有 safe 的區加 2', async () => {
    const sinkAfter = async (safe: boolean): Promise<number> => {
      const g = setup({ rule: safe ? {} : { region: { safe: false } } })
      g.commit(enter(g.k, g.state, 'rookie', { seed: 11 }))
      fightAt(g, marks(g, 'f')[0]!.id)
      const u = Object.values(g.battle!.units).find((x) => x.actor === 'c1')!
      u.out = 'burnout'
      expect(g.battle!.field.safe === true).toBe(safe)
      playOut(g)
      await g.finishBattle()
      return g.state.actors.c1!.sink
    }
    expect(await sinkAfter(true)).toBe(0)
    expect(await sinkAfter(false)).toBe(2)
  })
})

// ===================================================================================================================
// 四、機關
// ===================================================================================================================

describe('機關（net_puzzle）', () => {
  const puzzleOf = (g: G) => marks(g, 'm')[0]!

  it('擋路：走不上去，原因寫出來；站到旁邊列出三個辦法（介面、街頭直覺、體格）', () => {
    const g = rookie()
    const p = puzzleOf(g)
    standNear(g, p.at)
    const r = g.gridMove(p.at)
    expect(r.status).not.toBe('applied')
    // 四個方向裡朝機關的那一個寫出原因
    const dir = (['east', 'west', 'south', 'north'] as const).find((d) => gridView(g.k, g.state)!.moves[d]?.includes('機關擋住了路'))
    expect(dir).toBeDefined()
    const view = mazeView(g.k, g.state)!
    expect(view.near.map((n) => [n.kind, n.marker.id])).toEqual([['puzzle', p.id]])
    expect(view.near[0]!.uses.map((u) => [u.id, u.name, u.block])).toEqual([
      ['solve:interface', '解機關（介面）', null], ['solve:street', '解機關（街頭直覺）', null], ['solve:body', '解機關（體格）', null],
    ])
  })

  it('解不了的情況：太遠、不在迷宮館、辦法不對、戰鬥中，各一句', () => {
    const g = rookie()
    const p = puzzleOf(g)
    teleport(g, marks(g, 'E')[0]!.at)
    // 入口剛好貼著機關的話換一個遠的位置也無妨：只在不相鄰時檢查「太遠」
    if (Math.abs(p.at[0] - at(g)[0]) + Math.abs(p.at[1] - at(g)[1]) !== 1) expect(solveBlock(g.k, g.state, p.id)).toMatch(/太遠了/)
    standNear(g, p.at)
    expect(solveBlock(g.k, g.state, p.id, 'dance')).toMatch(/沒有「dance」這個辦法/)
    expect(solveBlock(g.k, g.state, 'zz9')).toMatch(/沒有「zz9」/)
    expect(solveBlock(g.k, g.state)).toBeNull()
    expect(() => solve(g.k, g.state, p.id, 'dance')).toThrow(ActionBlocked)
    const outside = setup()
    expect(solveBlock(outside.k, outside.state)).toBe('現在不在迷宮館裡。')
  })

  /** 掃種子：站到機關旁邊解一次，要的結果（solved 或 solve_fail）。 */
  function seedFor(result: 'solved' | 'solve_fail', option?: string, o: Opts = {}, bracket = 'rookie'): number {
    for (let seed = 1; seed <= 80; seed++) {
      const g = setup({ ...o, seed })
      g.commit(enter(g.k, g.state, bracket, { seed: 11 }))
      standNear(g, puzzleOf(g).at)
      if (solve(g.k, g.state, undefined, option).outcome.result === result) return seed
    }
    throw new Error('找不到合適的種子')
  }

  it('成功：那一格變成地板、走得上去；報告 maze.use（solved）；同一個不能再解', () => {
    const seed = seedFor('solved')
    const g = setup({ seed })
    g.commit(enter(g.k, g.state, 'rookie', { seed: 11 }))
    const p = puzzleOf(g)
    standNear(g, p.at)
    const reports = g.commit(solve(g.k, g.state, p.id))
    expect(reports[0]!.action).toBe('maze.use')
    expect(reports[0]!.outcome.result).toBe('solved')
    expect(reports[0]!.timeline[0]).toMatchObject({ tag: 'maze.roll', data: { dc: 10 } })
    expect(sheetOf(g).kindAt(p.at[0], p.at[1])).toBe('floor')
    expect(sheetOf(g).walkable(p.at[0], p.at[1])).toBe(true)
    expect(solveBlock(g.k, g.state, p.id)).toMatch(/已經解開了/)
    expect(mazeView(g.k, g.state)!.near).toEqual([])
    // 能走上去了
    const r = g.gridMove(p.at)
    expect(r.status).toBe('applied')
    expect(at(g)).toEqual(p.at)
  })

  it('失敗：解的人感載加 8（I 級）、機關還在、可以再試；試到成功為止', () => {
    const seed = seedFor('solve_fail')
    const g = setup({ seed })
    g.commit(enter(g.k, g.state, 'rookie', { seed: 11 }))
    const p = puzzleOf(g)
    standNear(g, p.at)
    const before = g.state.actors.pc!.load + g.state.actors.c1!.load
    const reports = g.commit(solve(g.k, g.state, p.id))
    expect(reports[0]!.outcome.result).toBe('solve_fail')
    const who = reports[0]!.timeline[0]!.actor!
    expect(g.state.actors[who]!.load).toBe(8)
    expect(g.state.actors.pc!.load + g.state.actors.c1!.load).toBe(before + 8)
    expect(sheetOf(g).kindAt(p.at[0], p.at[1])).toBe('net_puzzle')
    expect(solveBlock(g.k, g.state, p.id)).toBeNull()
    let solved = false
    for (let i = 0; i < 40 && !solved; i++) {
      const rs = g.commit(solve(g.k, g.state, p.id))
      solved = rs[0]!.outcome.result === 'solved'
    }
    expect(solved).toBe(true)
    expect(sheetOf(g).kindAt(p.at[0], p.at[1])).toBe('floor')
  })

  it('失敗的感載照等級乘（II 級 ×1.22：8 → 10）；加不到過載（最多加到上限少一）', () => {
    const seed = seedFor('solve_fail', undefined, { ownDeck: true }, 'open')
    const g = setup({ seed, ownDeck: true })
    g.commit(enter(g.k, g.state, 'open', { seed: 11 }))
    const p = puzzleOf(g)
    standNear(g, p.at)
    const rs = g.commit(solve(g.k, g.state, p.id))
    expect(g.state.actors[rs[0]!.timeline[0]!.actor!]!.load).toBe(10)
    // 感載已經幾乎滿了：只加到上限少一
    const h = setup({ seed })
    h.commit(enter(h.k, h.state, 'rookie', { seed: 11 }))
    standNear(h, puzzleOf(h).at)
    const cap = 20 + Math.floor(0 / 2) + 2 * 3
    commit(h, [{ op: 'actor.track', id: 'pc', track: 'load', delta: cap - 3 }, { op: 'actor.track', id: 'c1', track: 'load', delta: cap - 3 }])
    const r = h.commit(solve(h.k, h.state, puzzleOf(h).id))
    const who = r[0]!.timeline[0]!.actor!
    expect(h.state.actors[who]!.load).toBe(cap - 1)
  })

  it('三個辦法各有各的檢定（屬性與基本功）；沒指定辦法用加值最高的', () => {
    const g = rookie()
    const p = puzzleOf(g)
    standNear(g, p.at)
    const by = (option?: string) => solve(g.k, g.state, p.id, option).timeline[0]!.roll!
    expect(by('interface')).toMatchObject({ attr: 'intellect', skill: 'interface' })
    expect(by('street')).toMatchObject({ attr: 'intellect', skill: 'streetwise' })
    expect(by('body')).toMatchObject({ attr: 'body' })
    expect(by('body').skill).toBeUndefined()
    // 主角智識 14、介面 3：自動挑到的是介面
    expect(by()).toMatchObject({ attr: 'intellect', skill: 'interface' })
  })

  it('useMaze：solve（站在旁邊的第一個機關）與 solve:<辦法>；不認得的 id 擋下', () => {
    const g = rookie()
    standNear(g, puzzleOf(g).at)
    expect(useMaze(g.k, g.state, 'solve').action).toBe('maze.use')
    expect(useMaze(g.k, g.state, 'solve:body', puzzleOf(g).id).timeline[0]!.roll).toMatchObject({ attr: 'body' })
    expect(() => useMaze(g.k, g.state, 'dance')).toThrow(/沒有「dance」可以做/)
  })
})

// ===================================================================================================================
// 五、寶箱
// ===================================================================================================================

/** 只有一列的寶箱表：每次都擲到它。 */
const onlyChest = (row: Rec): Rec => ({ maze_table: [{ id: 'chest', kind: 'chest', rows: [row] }, PRIZE] })
const chipsOf = (g: G): number => mazeView(g.k, g.state)!.chips
const potions = (g: G): number => g.state.inventory.filter((s) => s.id === 'it_potion').reduce((n, s) => n + s.qty, 0)

describe('寶箱（這一區的檔案庫）', () => {
  const chestOf = (g: G, i = 0) => marks(g, 'a')[i]!

  it('站在上面才開得了；開一次，擲寶箱表一列：效果套用（給東西）、籌碼記起來；那一格記成處理過，第二次灰掉', () => {
    const g = rookie({ extra: onlyChest({ weight: 1, name: '回復腳本', give: [{ kind: 'item', id: 'it_potion', qty: 1 }], chips: 4 }) })
    const c = chestOf(g)
    expect(openBlock(g.k, g.state, c.id)).toMatch(/要站在上面/)
    expect(openBlock(g.k, g.state)).toBe('這裡沒有寶箱。')
    teleport(g, c.at)
    expect(openBlock(g.k, g.state)).toBeNull()
    expect(gridView(g.k, g.state)!.here.uses.map((u) => [u.id, u.name, u.block])).toEqual([['open', '開寶箱', null]])
    const reports = g.commit(open(g.k, g.state))
    expect(reports[0]!.action).toBe('maze.use')
    expect(reports[0]!.outcome.result).toBe('chest')
    expect(potions(g)).toBe(1)
    expect(chipsOf(g)).toBe(4)
    expect(openBlock(g.k, g.state)).toMatch(/已經打開過了/)
    expect(gridView(g.k, g.state)!.here.uses[0]!.block).toMatch(/已經打開過了/)
    expect(() => open(g.k, g.state)).toThrow(ActionBlocked)
  })

  it('netrun 自己的檔案庫用途不列（這一區的寶箱由迷宮館處理）', () => {
    const g = rookie()
    teleport(g, chestOf(g).at)
    expect(gridView(g.k, g.state)!.here.uses.map((u) => u.id)).toEqual(['open'])
    expect(() => useNode(g.k, g.state, 'loot')).toThrow(/沒有「loot」/)
  })

  it('固定種子擲到表的某一列、效果套用：三列都掃得到（籌碼 3～8 枚、回復腳本、再擲獎品表）', () => {
    const seen = new Set<string>()
    for (let seed = 1; seed <= 60 && seen.size < 3; seed++) {
      const g = rookie({ seed }, 11)
      teleport(g, chestOf(g).at)
      const before = potions(g)
      const rs = g.commit(open(g.k, g.state))
      const line = rs[0]!.narration!.results!.join('')
      if (line.includes('比賽籌碼')) {
        expect(chipsOf(g)).toBeGreaterThanOrEqual(3)
        expect(chipsOf(g)).toBeLessThanOrEqual(8)
        seen.add('chips')
      } else if (line.includes('回復腳本')) {
        expect(potions(g)).toBe(before + 1)
        seen.add('item')
      } else if (line.includes('神祕的寶箱')) {
        // 再擲一次獎品表：正式版構裝，或三十枚籌碼
        expect(line).toMatch(/正式版構裝|三十枚籌碼/)
        if (line.includes('三十枚籌碼')) expect(chipsOf(g)).toBe(30)
        else expect(g.state.inventory.some((s) => s.id === 'it_prize')).toBe(true)
        seen.add('prize')
      }
    }
    expect([...seen].sort()).toEqual(['chips', 'item', 'prize'])
  })

  it('同一個種子、同一個箱子，結果一樣', () => {
    const a = rookie({ seed: 21 })
    const b = rookie({ seed: 21 })
    teleport(a, chestOf(a).at)
    teleport(b, chestOf(b).at)
    expect(a.commit(open(a.k, a.state))[0]!.outcome.summary).toBe(b.commit(open(b.k, b.state))[0]!.outcome.summary)
  })

  it('寶箱怪（機率 1 時一定是）：開了一場戰鬥——兩個小兵、內海、沒有追蹤度、熔斷；箱子還沒打開', () => {
    const g = rookie({ rule: { mimic: 1 }, extra: onlyChest({ weight: 1, name: '回復腳本', give: [{ kind: 'item', id: 'it_potion', qty: 1 }] }) })
    const c = chestOf(g)
    teleport(g, c.at)
    const d = open(g.k, g.state)
    expect(d.outcome.result).toBe('mimic')
    expect(d.launch).toHaveLength(1)
    g.commit(d)
    const b = g.battle!
    expect(b.mode).toBe('net')
    expect(b.field).toEqual({ safe: true })
    const foes = Object.values(b.units).filter((u) => u.side === 'foe')
    expect(foes).toHaveLength(2)
    expect(foes.every((u) => u.rank === 'minion' && u.enemy === 'mz_slime')).toBe(true)
    expect(b.origin.ext).toMatchObject({ by: 'maze', maze: { chest: c.id }, net: { run: run(g).id, map: run(g).map, sheet: 'l1', node: c.id, region: 'maze' } })
    expect(potions(g)).toBe(0)
    expect(g.state.maps.instances[run(g).map]!.sheets.l1!.cells[pointKey(c.at[0], c.at[1])]?.used).not.toBe(true)
  })

  it('寶箱怪打贏了才給箱子裡的東西（回合數照算）；那一格處理過、不能再開', async () => {
    const g = rookie({ rule: { mimic: 1 }, extra: onlyChest({ weight: 1, name: '回復腳本', give: [{ kind: 'item', id: 'it_potion', qty: 1 }], chips: 2 }) })
    const c = chestOf(g)
    teleport(g, c.at)
    g.commit(open(g.k, g.state))
    expect(playOut(g).outcome).toBe('win')
    const fought = g.battle!.round
    await g.finishBattle()
    expect(potions(g)).toBe(1)
    expect(chipsOf(g)).toBe(2)
    expect(roundsOf(g)[0]).toBe(fought)
    expect(openBlock(g.k, g.state)).toMatch(/已經打開過了/)
    expect(g.state.maps.instances[run(g).map]!.sheets.l1!.cells[pointKey(c.at[0], c.at[1])]).toMatchObject({ used: true })
  })

  it('寶箱怪不是每個箱子都有：機率 0 時一個都沒有', () => {
    for (let seed = 1; seed <= 10; seed++) {
      const g = rookie({ seed, rule: { mimic: 0 } })
      teleport(g, chestOf(g).at)
      expect(open(g.k, g.state).launch).toBeUndefined()
    }
  })

  it('警報節點（館裡的陷阱）：踩上去叫出兩個小兵打一場，不加追蹤度；踩過就失效', () => {
    let found: G | null = null
    let trap: [number, number] | null = null
    for (let seed = 1; seed <= 60 && !found; seed++) {
      const g = rookie({ seed }, seed)
      const t = ext(g).traps.l1?.find((x) => x.kind === 'net_alarm')
      if (t) { found = g; trap = t.at }
    }
    expect(found).not.toBeNull()
    const g = found!
    standNear(g, trap!)
    expect(g.gridMove(trap!).status).toBe('applied')
    const b = g.battle!
    expect(b).toBeTruthy()
    expect(Object.values(b.units).filter((u) => u.side === 'foe').map((u) => u.rank)).toEqual(['minion', 'minion'])
    expect(b.field).toEqual({ safe: true })
    expect((b.origin.ext!.net as Rec).node).toMatch(/^alarm:/)
    expect(meterOf(g.k, g.state, 'trace', run(g).map)).toBe(0)
    expect(ext(g).traps.l1!.find((x) => x.kind === 'net_alarm')!.used).toBe(true)
  })
})

// ===================================================================================================================
// 六、時間與評價
// ===================================================================================================================

describe('時間：每一層用了幾個回合（探索加戰鬥）', () => {
  it('探索回合照 netrun.round 數進這一層（一段路好幾個節點每一個都算，和 netrun 自己數的一樣）', () => {
    const g = rookie({ seed: 4 }, 4)
    const reach = sheetOf(g).reachable({ x: at(g)[0], y: at(g)[1] })
    // 走到走得到的、離入口最遠的那個節點（一路上會經過好幾個節點）
    const nodes = ext(g).graph.l1!.nodes.filter((n) => reach.has(key(n.at)) && key(n.at) !== key(at(g))).sort((a, b) => b.depth - a.depth)
    expect(nodes.length).toBeGreaterThan(0)
    expect(g.gridMove(nodes[0]!.at).status).toBe('applied')
    expect(run(g).round).toBeGreaterThanOrEqual(1)
    expect(roundsOf(g)).toEqual([run(g).round, 0, 0])
    expect(mazeView(g.k, g.state)!.rounds).toBe(run(g).round)
  })

  it('戰鬥的回合數從那一場結束的報告加進這一層；第二層的戰鬥加在第二層', async () => {
    const g = rookie()
    fightAt(g, marks(g, 'f')[0]!.id)
    playOut(g)
    const r1 = g.battle!.round
    await g.finishBattle()
    expect(roundsOf(g)).toEqual([r1, 0, 0])
    await clearLayer(g)
    expect(run(g).layer).toBe(1)
    const before = roundsOf(g)
    fightAt(g, marks(g, 'f')[0]!.id)
    playOut(g)
    const r2 = g.battle!.round
    await g.finishBattle()
    expect(roundsOf(g)).toEqual([before[0], before[1]! + r2, 0])
    expect(mazeView(g.k, g.state)).toMatchObject({ layer: { index: 2, total: 3, name: '迴廊' }, rounds: roundsOf(g).reduce((a, b) => a + b, 0), standard: 37 })
  })

  it('倒下的人數照戰鬥結束時退出的人（倒下、昏過去、被釘住）；拔線的不算', async () => {
    const g = rookie()
    fightAt(g, marks(g, 'f')[0]!.id)
    const units = Object.values(g.battle!.units).filter((u) => u.side === 'ally')
    units.find((u) => u.actor === 'pc')!.out = 'down'
    playOut(g)
    await g.finishBattle()
    expect(mazeView(g.k, g.state)!.downs).toBe(1)
    const h = rookie()
    fightAt(h, marks(h, 'f')[0]!.id)
    Object.values(h.battle!.units).find((u) => u.actor === 'pc')!.out = 'jacked_out'
    playOut(h)
    await h.finishBattle()
    expect(mazeView(h.k, h.state)!.downs).toBe(0)
  })

  it('mazeView：標準、比例、預估的評價與獎金；沒有在迷宮館裡是 null', () => {
    expect(mazeView(setup().k, setup().state)).toBeNull()
    const g = rookie()
    const v = mazeView(g.k, g.state)!
    expect(v).toMatchObject({ bracket: 'rookie', name: '新手組', grade: 1, deposit: 50, rounds: 0, standard: 37, ratio: 0, downs: 0, chips: 0, chipValue: 10, rating: 'S', mult: 1.5, prize: 450 })
    expect(v.layers).toEqual([{ name: '前庭', standard: 12, used: 0, current: true }, { name: '迴廊', standard: 15, used: 0, current: false }, { name: '館主廳', standard: 10, used: 0, current: false }])
    commit(g, [{ op: 'counter', key: roundKey(mz(g).id, 0), delta: 40 }])
    expect(mazeView(g.k, g.state)).toMatchObject({ rounds: 40, rating: 'A', mult: 1.2, prize: 360 })
  })
})

// ===================================================================================================================
// 七、層與層之間
// ===================================================================================================================

describe('層與層之間的休息', () => {
  it('往下一層之後感載 −10（不是歸零）：報告 maze.rest；沒有 10 點就只減有的', async () => {
    const g = rookie()
    commit(g, [{ op: 'actor.track', id: 'pc', track: 'load', delta: 17 }, { op: 'actor.track', id: 'c1', track: 'load', delta: 4 }])
    await winFoes(g)
    teleport(g, marks(g, 'g')[0]!.at)
    const loads = [g.state.actors.pc!.load, g.state.actors.c1!.load]
    const reports = g.commit(useNode(g.k, g.state, 'descend'))
    expect(reports.map((r) => r.action)).toEqual(['netrun.descend', 'maze.rest'])
    // 打贏的戰鬥裡沒有再加感載（戰鬥外的感載自然消退只在探索回合）：以下單看這一次休息的差
    expect(g.state.actors.pc!.load).toBe(Math.max(0, loads[0]! - 10))
    expect(g.state.actors.c1!.load).toBe(Math.max(0, loads[1]! - 10))
    expect(run(g).layer).toBe(1)
  })

  it('第二層到第三層也是；最後一層出口不再休息（結算）', async () => {
    const g = rookie()
    await clearLayer(g)
    await winFoes(g)
    teleport(g, marks(g, 'g')[0]!.at)
    expect(g.commit(useNode(g.k, g.state, 'descend')).map((r) => r.action)).toEqual(['netrun.descend', 'maze.rest'])
    expect(run(g).layer).toBe(2)
  })
})

// ===================================================================================================================
// 八、結算
// ===================================================================================================================

const finalData = (g: G): Rec => reportsOf(g, 'maze.result')[0]!.timeline[0]!.data as Rec

describe('結算：破關', () => {
  it('走完三層：評價 S（回合數在標準以內、沒人倒下）；獎金 = 表上的 C$300 × 1.5、押金退回、獎品表擲一次、籌碼換現金；比賽甲板收回、狀態清乾淨', async () => {
    // 獎品表只有一列：C$ 之外給一件東西與 5 枚籌碼
    const g = rookie({ extra: { maze_table: [CHEST, { id: 'prize', kind: 'prize', rows: [{ weight: 1, name: '正式版構裝', give: [{ kind: 'item', id: 'it_prize', qty: 1 }], chips: 5 }] }] } })
    expect(cash(g)).toBe(1950)
    await clearLayer(g)
    await clearLayer(g)
    expect(run(g).layer).toBe(2)
    // 先開一個寶箱：籌碼 7 枚記進這一趟
    commit(g, [{ op: 'counter', key: chipKey(mz(g).id), delta: 7 }])
    expect(mazeView(g.k, g.state)!.chips).toBe(7)
    await winFoes(g)
    const rounds = mazeView(g.k, g.state)!.rounds
    expect(rounds).toBeLessThanOrEqual(37)
    teleport(g, marks(g, 'g')[0]!.at)
    const reports = g.commit(useNode(g.k, g.state, 'pass'))
    expect(reports.map((r) => r.action)).toEqual(['netrun.use', 'netrun.end', 'maze.result'])
    const data = finalData(g)
    expect(data).toMatchObject({ outcome: 'done', rating: 'S', mult: 1.5, rounds, standard: 37, downs: 0, chips: 12, prize: 450, refund: 50, forfeited: 0, chipCash: 120 })
    // 1950 + 獎金 450 + 押金 50 + 籌碼 12 枚 × C$10
    expect(cash(g)).toBe(1950 + 450 + 50 + 120)
    expect(g.state.inventory.some((s) => s.id === 'it_prize')).toBe(true)
    expect(reports[2]!.outcome.result).toBe('S')
    // 甲板收回、狀態清乾淨
    for (const id of ['pc', 'c1']) {
      expect(g.state.actors[id]!.ext.deck).not.toHaveProperty('rental')
      expect(g.k.stats.stat(g.state, id, 'deck_grade')).toBe(0)
    }
    expect(readMaze(g.state)).toBeNull()
    expect(readRun(g.state)).toBeNull()
    expect(g.state.maps.at).toBeNull()
    expect(Object.keys(g.state.maps.instances)).toEqual([])
    expect(Object.entries(g.state.counters).filter(([k, v]) => k.startsWith('maze:') && v !== 0)).toEqual([])
    expect(g.k.activity.active(g.state)).toEqual([])
    expect(mazeView(g.k, g.state)).toBeNull()
  })

  /** 走完三層，把總回合數補到 total、倒下的人數補到 downs，破關；回傳結算的資料（一個測試只走一趟：一趟約 2～3 秒）。 */
  const playRated = async (total: number, downs: number): Promise<{ g: G; data: Rec }> => {
    const g = rookie({ extra: { maze_table: [CHEST, { id: 'prize', kind: 'prize', rows: [{ weight: 1, name: '一枚籌碼', chips: 1 }] }] } })
    await clearLayer(g)
    await clearLayer(g)
    await winFoes(g)
    // 把總回合數補到要的數字（打真的戰鬥的回合數少，補在第一層）
    const extraRounds = total - mazeView(g.k, g.state)!.rounds
    expect(extraRounds).toBeGreaterThan(0)
    commit(g, [
      { op: 'counter', key: roundKey(mz(g).id, 0), delta: extraRounds },
      ...(downs ? [{ op: 'counter', key: downKey(mz(g).id), delta: downs } as Change] : []),
    ])
    teleport(g, marks(g, 'g')[0]!.at)
    g.commit(useNode(g.k, g.state, 'pass'))
    return { g, data: finalData(g) }
  }

  it('評價照回合數與倒下的人數：回合 40、沒人倒下是 A（獎金 ×1.2）', async () => {
    const a = await playRated(40, 0)
    expect(a.data).toMatchObject({ rating: 'A', mult: 1.2, prize: 360, refund: 50, chipCash: 10 })
    expect(cash(a.g)).toBe(1950 + 360 + 50 + 10)
  })

  it('評價照回合數與倒下的人數：回合 55、倒下 2 人次是 B（獎金 ×1）', async () => {
    const b = await playRated(55, 2)
    expect(b.data).toMatchObject({ rating: 'B', mult: 1, prize: 300 })
  })

  it('評價照回合數與倒下的人數：回合 80 是 C（獎金 ×0.7）', async () => {
    const c = await playRated(80, 0)
    expect(c.data).toMatchObject({ rating: 'C', mult: 0.7, prize: 210 })
    expect(cash(c.g)).toBe(1950 + 210 + 50 + 10)
  })

  it('公開組：獎金 C$900 × 倍率、押金 C$150；比賽甲板不是租的所以不收', async () => {
    const g = setup({ ownDeck: true, extra: { maze_table: [CHEST, { id: 'prize', kind: 'prize', rows: [{ weight: 1, name: '一枚籌碼', chips: 1 }] }] } })
    g.commit(enter(g.k, g.state, 'open', { seed: 11 }))
    expect(cash(g)).toBe(1850)
    await clearLayer(g)
    await clearLayer(g)
    await clearLayer(g)
    expect(finalData(g)).toMatchObject({ rating: 'S', prize: 1350, refund: 150 })
    expect(cash(g)).toBe(1850 + 1350 + 150 + 10)
    expect(g.state.actors.pc!.ext.deck).toMatchObject({ uid: 'D1' })
  })

  it('館主廳的守閘門那一場：新手組與公開組是精英的組合、無差別組是首領戰（沒有另外指定）', () => {
    const rk = rookie()
    const guard = (g: G, sheet: string): string[] => Object.values(ext(g).foes[sheet]!).find((f) => f.gate)!.foes.map((f) => String(f.rank))
    expect(guard(rk, 'l3')).toEqual(['elite', 'elite', 'minion'])
    const un = setup({ ownDeck: true })
    un.commit(enter(un.k, un.state, 'unlimited', { seed: 11 }))
    expect(guard(un, 'l1')).toEqual(['elite', 'elite', 'minion'])
    expect(guard(un, 'l3')).toEqual(['boss', 'minion', 'minion', 'minion'])
  })
})

describe('結算：打輸只是斷線', () => {
  /** 第二層裡開一場戰鬥，全員拔線。 */
  async function jackOutAll(g: G): Promise<void> {
    fightAt(g, marks(g, 'f')[0]!.id)
    for (let i = 0; i < 40 && g.battle && !g.battle.result; i++) {
      const cur = g.battle.units[g.battle.order[g.battle.turn]!]!
      if (cur.side === 'ally') expect(g.battleAct({ action: 'test.net.jack' }).status).toBe('applied')
      else g.battleNext()
    }
    expect(g.battle!.result!.outcome).toBe('jack_out')
    await g.finishBattle()
  }

  it('第二層全員拔線：押金沒收、籌碼留著（換成現金）、沒有獎金、比賽甲板收回、狀態清乾淨；不是戰敗', async () => {
    const g = rookie()
    await clearLayer(g)
    expect(run(g).layer).toBe(1)
    commit(g, [{ op: 'counter', key: chipKey(mz(g).id), delta: 6 }])
    const reports = await (async () => { await jackOutAll(g); return g.state.reports })()
    expect(reportsOf(g, 'maze.result')).toHaveLength(1)
    expect(finalData(g)).toMatchObject({ outcome: 'left', forfeited: 50, refund: 0, prize: 0, chips: 6, chipCash: 60 })
    expect(finalData(g).rating).toBeUndefined()
    expect(cash(g)).toBe(1950 + 60)
    expect(reportsOf(g, 'maze.result')[0]!.outcome.result).toBe('forfeit')
    expect(g.state.actors.pc!.ext.deck).not.toHaveProperty('rental')
    expect(readMaze(g.state)).toBeNull()
    expect(readRun(g.state)).toBeNull()
    expect(g.state.maps.at).toBeNull()
    expect(g.pendingDefeat).toBeNull()
    expect(Object.entries(g.state.counters).filter(([k, v]) => k.startsWith('maze:') && v !== 0)).toEqual([])
    expect(reports.length).toBeGreaterThan(0)
  })

  it('探索中登出（left）也是押金沒收、籌碼照算', () => {
    const g = rookie()
    commit(g, [{ op: 'counter', key: chipKey(mz(g).id), delta: 3 }])
    g.commit(netrunLogout(g.k, g.state))
    expect(finalData(g)).toMatchObject({ forfeited: 50, chips: 3, chipCash: 30, prize: 0 })
    expect(cash(g)).toBe(1950 + 30)
    expect(readMaze(g.state)).toBeNull()
  })

  it('戰敗被接受：押金沒收、籌碼照算到那一刻、沒有戰敗以外的損失（狀態清乾淨）', async () => {
    const g = rookie()
    commit(g, [{ op: 'counter', key: chipKey(mz(g).id), delta: 2 }])
    fightAt(g, marks(g, 'f')[0]!.id)
    const link = g.battle!.origin.ext!.net as Rec
    const map = run(g).map
    const origin: Origin = { by: 'netrun', ref: run(g).id, ext: { net: link } }
    const end = endActivity(g.k, { state: g.state, kind: 'defeat', id: 'b1', origin, outcome: 'accept', result: { net: true } })
    commit(g, [{ op: 'battle', state: null, fold: true }], 'battle.abort')
    commit(g, [{ op: 'snapshot.drop', kind: 'battle' }, ...end.changes], 'defeat.accept')
    expect(finalData(g)).toMatchObject({ outcome: 'defeat', forfeited: 50, chips: 2, chipCash: 20, prize: 0 })
    expect(cash(g)).toBe(1950 + 20)
    expect(readMaze(g.state)).toBeNull()
    expect(readRun(g.state)).toBeNull()
    expect(g.state.maps.instances[map]).toBeUndefined()
    expect(g.state.actors.pc!.ext.deck).not.toHaveProperty('rental')
  })

  it('被定位（這一區不會有，但真的發生了）也照押金沒收處理', () => {
    const g = rookie()
    const done = closeRun(g.k, g.state, run(g), 'located')!
    expect(readMaze(g.state)).not.toBeNull()
    commit(g, done.changes)
    expect(finalData(g)).toMatchObject({ outcome: 'located', forfeited: 50, prize: 0 })
    expect(readMaze(g.state)).toBeNull()
  })

  it('別人開的 netrun（origin.by 不是 maze）結束，迷宮館不動', () => {
    const g = setup()
    commit(g, [{ op: 'actor.ext', id: 'pc', key: 'deck', value: { rental: { deck: 'dk_rent' } } }])
    g.launch('netrun', { region: mazeRegion(mazeRules(g.k)), grade: 1, faction: 'maze', seed: 3, encounter: [] }, { by: 'core' })
    expect(readRun(g.state)).toMatchObject({ region: 'maze' })
    expect(readMaze(g.state)).toBeNull()
    const r = g.k.hooks.run('netrun.close', { state: g.state, run: run(g), outcome: 'done' } as never)
    expect(r).toEqual([])
  })
})

// ===================================================================================================================
// 九、接口：netrun 的兩個欄位、潛入中報名、不變式、存檔
// ===================================================================================================================

/** 照 features/index.ts 的順序：潛入在迷宮館前面（迷宮館的結果報告接在潛入自動登出的後面，登出才不會被問兩次）。 */
const WITH_DIVE: Feature[] = [enemiesFeature, deckFeature, netrunFeature, TEST_NET_COMBAT, COMBAT, diveFeature, mazeFeature]

describe('接口與整合', () => {
  it('netrun 新收的兩個區欄位（puzzle、handled）：格式不對擋下；沒寫不影響一般的子網', () => {
    const r = mazeRegion(DEFAULT_RULES)
    expect(regionProblems({ ...r, puzzle: [3, 1] } as never)).not.toEqual([])
    expect(regionProblems({ ...r, puzzle: 'one' } as never)).not.toEqual([])
    expect(regionProblems({ ...r, handled: ['ab'] } as never)).not.toEqual([])
    expect(regionProblems({ ...r, handled: 'a' } as never)).not.toEqual([])
    expect(regionProblems(r as never)).toEqual([])
    const { puzzle: _p, handled: _h, ...plain } = r
    expect(regionProblems(plain as never)).toEqual([])
  })

  it('潛入中也能報名（dive 放行 commit:maze.）：打完之後還在潛入，登出得了；戰敗被接受則被強制斷線、自動登出', async () => {
    const g = setup({ features: WITH_DIVE })
    const dive = (): Change[] => [{ op: 'ext', key: 'dive', value: { since: 0, body: { location: clone(g.state.location) }, access: { type: 'fac_pod', safe: 1, name: '潛艙店' }, deck: 'none' } }]
    commit(g, dive(), 'dive.test')
    expect(g.k.activity.active(g.state).map((a) => a.kind)).toEqual(['dive'])
    g.commit(enter(g.k, g.state, 'rookie', { seed: 11 }))
    expect(g.k.activity.active(g.state).map((a) => a.kind)).toEqual(['netrun', 'dive'])
    await clearLayer(g)
    await clearLayer(g)
    await clearLayer(g)
    expect(reportsOf(g, 'maze.result')).toHaveLength(1)
    expect(readDive(g.state)).not.toBeNull()
    expect(g.k.activity.active(g.state).map((a) => a.kind)).toEqual(['dive'])
    g.commit(diveExit(g.k, g.state))
    expect(readDive(g.state)).toBeNull()
    // 戰敗被接受：迷宮館結算押金沒收，潛入的那一頭被標成被強制斷線、自動登出
    const h = setup({ features: WITH_DIVE })
    commit(h, [{ op: 'ext', key: 'dive', value: { since: 0, body: { location: clone(h.state.location) }, access: { type: 'fac_pod', safe: 1, name: '潛艙店' }, deck: 'none' } }], 'dive.test')
    h.commit(enter(h.k, h.state, 'rookie', { seed: 11 }))
    fightAt(h, marks(h, 'f')[0]!.id)
    const link = h.battle!.origin.ext!.net as Rec
    const end = endActivity(h.k, { state: h.state, kind: 'defeat', id: 'b1', origin: { by: 'netrun', ref: run(h).id, ext: { net: link } }, outcome: 'accept', result: { net: true } })
    commit(h, [{ op: 'battle', state: null, fold: true }], 'battle.abort')
    commit(h, [{ op: 'snapshot.drop', kind: 'battle' }, ...end.changes], 'defeat.accept')
    expect(finalData(h)).toMatchObject({ outcome: 'defeat', forfeited: 50 })
    expect(readMaze(h.state)).toBeNull()
    expect(readDive(h.state)).toBeNull()
    expect(reportsOf(h, 'dive.exit')).toHaveLength(1)
  })

  it('報名到解機關、開寶箱、打一場、往下一層，每一份報告都守得住不變式；存檔再讀回來這一趟還在、狀態一樣', async () => {
    const g = setup()
    const { violations } = await observed(g, async () => {
      g.commit(enter(g.k, g.state, 'rookie', { seed: 11 }))
      standNear(g, marks(g, 'm')[0]!.at)
      g.commit(solve(g.k, g.state))
      teleport(g, marks(g, 'a')[0]!.at)
      g.commit(open(g.k, g.state))
      await winFoes(g)
      teleport(g, marks(g, 'g')[0]!.at)
      g.commit(useNode(g.k, g.state, 'descend'))
    })
    expect(violations).toEqual([])
    const text = snapshotText(g.state)
    const back = (JSON.parse(text) as { state: { ext: Rec; counters: Rec } }).state
    expect(back.ext.maze).toMatchObject({ bracket: 'rookie', grade: 1, deposit: 50 })
    expect(Object.keys(back.counters).some((k) => k.startsWith('maze:'))).toBe(true)
    expect(validateState(back as never)).toEqual([])
  })
})
