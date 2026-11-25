// 白箱測試：features/netrun（網內的一趟：開始的設定、節點、閘門、擦痕跡、帶出去才算數、畫面）。
// 補主套件沒有走到的分支：設定的每一個欄位寫壞、丟東西的現金與帳戶、各種目標的說明句、做事的入口的退路（不在地圖上、節點不存在、太遠、
// 站不上去的遭遇、沒有這件事）、閘門與接管與擦痕跡沒有主控或鑰匙或憑證、區的格式檢查、查詢的函式不改狀態。
// 每個測試名稱寫明在測哪一條規格（文件與節）或不變式（dev/invariants.md）。

import { describe, expect, it } from 'vitest'
import type { GameState, MarkerDef } from '../../src'
import { ActionBlocked, clone } from '../../src'
import { go as diveGo } from '../../src/features/dive'
import { netrunView, readRun } from '../../src/features/netrun'
import { lossOf } from '../../src/features/netrun/loss'
import { regionProblems, ruleProblems, facilityProblems, affixProblems, netExt, gradeOf, encounterAfter } from '../../src/features/netrun/model'
import { gateDraft, doNodeUse, wipeUse, wipeDraft } from '../../src/features/netrun/nodes'
import { parseSetup } from '../../src/features/netrun/start'
import { regionOf } from '../../src/features/netrun/rules'
import { gateBlock, hereOf, useNode, descend, nodeUses, freeUses } from '../../src/features/netrun/uses'
import { logout, logoutBlock } from '../../src/features/netrun/close'
import { keysIn, masterTier } from '../../src/features/netrun/checks'
import { diveIn, makeDiveGame, netMarkers } from '../../src/testkit'

type G = ReturnType<typeof makeDiveGame>['game']

function deepFreeze<T>(o: T): T {
  if (o && typeof o === 'object' && !Object.isFrozen(o)) {
    Object.freeze(o)
    for (const v of Object.values(o as Record<string, unknown>)) deepFreeze(v)
  }
  return o
}

/** 潛入、選「蜂巢的辦公樓」：自己去挖的一座子網，站在第一層的入口。 */
function dig(): G {
  const { game } = makeDiveGame()
  diveIn(game)
  game.commit(diveGo(game.k, game.state, 'ns_tw_dig'))
  expect(readRun(game.state)).not.toBeNull()
  return game
}

/** 在一份複本上把這一趟的狀態換掉（只問查詢的函式；不提交）。 */
function withRun(g: G, patch: (run: Record<string, unknown>) => void): GameState {
  const st = clone(g.state)
  patch(st.ext.netrun as Record<string, unknown>)
  return st
}

describe('白箱 netrun：開始的設定（dev/adr/0018 第七節；dev/work/M3-netrun.md「setup 的格式」）', () => {
  it('parseSetup：不是物件、沒有等級', () => {
    expect(parseSetup(3).problems).toEqual(['開始的設定要是一個物件。', '設定要寫這一趟的等級（grade，1～5 或 I～V）。'])
    expect(parseSetup({ grade: 'III' }).parsed.grade).toBe(3)
    expect(gradeOf('VI')).toBeUndefined()
    expect(gradeOf(0)).toBeUndefined()
  })

  it('parseSetup：每一個欄位寫壞各一句', () => {
    const { problems } = parseSetup({
      grade: 1, fx: 3, layers: 'x', encounter: ['god'], lace: 3, seed: 1.5, trace: 'x', faction: '', party: [3], objective: { kind: 'dance' },
      controls: 'x', entry: 'walk', facility: 3, site: 3, from_backdoor: 3, affixes: 'x',
    })
    expect(problems).toEqual([
      'fx 要是一個物件。', 'layers 要是層的名字的陣列。', 'encounter 要是位階（minion、elite、boss）的陣列，最多八個。', 'lace 要寫蕾絲的顏色（white、pink、black）。',
      'seed 要是整數。', 'trace（追蹤度的起始值）要是整數。', 'faction 要是勢力的 id。', 'party 要是角色 id 的陣列（進網內的人）。',
      'objective.kind 不認得「dance」（download、seize、find、defeat、plant、extract、pass、clear）。',
      'controls 要是控制節點的清單（id，或 { node, name?, layer? }）。', "entry 只能是 'dig'（自己去挖的子網）。", 'facility 要是設施類型的 id。', 'site 要是這座子網的鍵（字串）。',
      'from_backdoor 要是圖的 id（第幾層的後門）。', 'affixes 要是詞條 id 的陣列（最多八個）。',
    ])
  })

  it('parseSetup：fx 的整數欄位、layers 的長度、objective 的子欄位、controls 的每一筆、dig 要 site', () => {
    expect(parseSetup({ grade: 1, fx: { minus: 1.5, trace_start: 'x', half: true } }).problems).toEqual(['fx.minus 要是整數。', 'fx.trace_start 要是整數。'])
    expect(parseSetup({ grade: 1, fx: { half: true, skip: 'yes' } }).parsed.fx).toEqual({ half: true })
    expect(parseSetup({ grade: 1, layers: [] }).problems).toEqual(['layers 要是一到八個層的名字（字串）。'])
    expect(parseSetup({ grade: 1, layers: Array(9).fill('a') }).problems).toEqual(['layers 要是一到八個層的名字（字串）。'])
    expect(parseSetup({ grade: 1, objective: 3 }).problems).toEqual(['objective 要是 { kind, ... }，kind 是 download、seize、find、defeat、plant、extract（或 pass、clear）。'])
    expect(parseSetup({ grade: 1, objective: { kind: 'defeat', turns: 11, foe: 3, item: 3, node: 3 } }).problems).toEqual([
      'objective.turns 要是 1～10 的整數。', 'objective.foe 要是敵人的 id。', 'objective.item 要是物品的 id。', 'objective.node 要是控制節點的 id。',
    ])
    const c = parseSetup({ grade: 1, controls: ['cn_a', { node: 'cn_b', name: '門', layer: 'core' }, { name: 'x' }, 3] })
    expect(c.parsed.controls).toEqual([{ node: 'cn_a' }, { node: 'cn_b', name: '門', layer: 'core' }])
    expect(c.problems).toEqual(['controls 的每一筆要是控制節點的 id，或 { node, name?, layer? }。', 'controls 的每一筆要是控制節點的 id，或 { node, name?, layer? }。'])
    expect(parseSetup({ grade: 1, entry: 'dig' }).problems).toEqual(['自己去挖的子網要寫 site（這座子網的鍵）。'])
  })

  it('parseSetup：lace 可以是字串、{ color }，或 { } 沒寫顏色（不算錯）；party 去重', () => {
    expect(parseSetup({ grade: 1, lace: 'pink' }).parsed.color).toBe('pink')
    expect(parseSetup({ grade: 1, lace: { color: 'black' } }).parsed.color).toBe('black')
    expect(parseSetup({ grade: 1, lace: {} }).problems).toEqual([])
    expect(parseSetup({ grade: 1, lace: { color: 3 } }).problems).toEqual(['lace 要寫蕾絲的顏色（white、pink、black）。'])
    expect(parseSetup({ grade: 1, party: ['a', 'a', 'b'] }).parsed.party).toEqual(['a', 'b'])
  })

  it('encounterAfter：half、minus、lace_down 的組合（COMMISSIONS 第 6 節連動表）', () => {
    expect(encounterAfter(['boss', 'elite', 'minion'], { lace_down: true })).toEqual(['elite', 'minion', 'minion'])
    expect(encounterAfter(['minion', 'minion', 'minion', 'minion'], { half: true }).length).toBeLessThan(4)
    expect(encounterAfter(['minion', 'minion'], { minus: 5 }).length).toBeGreaterThanOrEqual(0)
  })

  it('regionOf：沒寫區、寫壞的區、找不到的區各一句', () => {
    const { game } = makeDiveGame()
    expect(regionOf(game.k, undefined)).toEqual({ problem: '沒有說這一趟要去哪一區。' })
    expect(regionOf(game.k, 'nowhere')).toEqual({ problem: '找不到「nowhere」這一區的規則表，這一趟開不起來。' })
    expect('problem' in regionOf(game.k, { id: 'x', name: 3 } as never)).toBe(true)
    expect('region' in regionOf(game.k, 'tw_subnet')).toBe(true)
  })
})

describe('白箱 netrun：帶出去才算數（CYBERSPACE 8.1 節「帶出去才算數」）', () => {
  it('現金與帳戶：骰到 1～3 的丟掉，背包（錢包）裡沒有那麼多只拿走剩下的；帶出來的那一件一定丟', () => {
    const { game } = makeDiveGame()
    const st = clone(game.state)
    st.money.cash = 7
    st.money.cred = 0
    const loot = Array.from({ length: 12 }, (_, i) => ({ kind: i % 2 ? 'cash' : 'cred', qty: 5, name: i % 2 ? '現金' : '帳戶的餘額', from: 'x' })) as never[]
    const out = lossOf(game.k, st, { id: 'r1', loot: [...loot, { kind: 'item', id: 'it_tw_script', qty: 9, name: '回填包', from: 'g', goal: true }] as never })
    // 帶出來的那一件一定在丟掉的清單裡；背包只有 2 支，拿走 2 支
    expect(out.lost.some((l) => l.goal)).toBe(true)
    expect(out.changes).toContainEqual({ op: 'item', id: 'it_tw_script', qty: -2 })
    // 現金：丟掉的加起來最多拿走 7；帳戶是 0，一筆 cred 都不會寫
    const cash = out.changes.filter((c) => c.op === 'cash').reduce((s, c) => s + (c as unknown as { delta: number }).delta, 0)
    expect(cash).toBeGreaterThanOrEqual(-7)
    expect(out.changes.some((c) => c.op === 'cred')).toBe(false)
    expect(out.lines[0]).toMatch(/^慌亂中丟掉了：/)
    expect(out.lines[0]).toContain('回填包 ×9')
  })

  it('沒有丟東西：拿到過東西寫「都帶出來了」；什麼都沒拿到不寫', () => {
    const { game } = makeDiveGame()
    // 找一個骰到 4～6 的 id：同一份狀態骰面固定
    let id = ''
    for (let i = 0; i < 50 && !id; i++) if (lossOf(game.k, game.state, { id: `s${i}`, loot: [{ kind: 'cash', qty: 1, name: '現金', from: 'x' }] as never }).lost.length === 0) id = `s${i}`
    expect(id).not.toBe('')
    expect(lossOf(game.k, game.state, { id, loot: [{ kind: 'cash', qty: 1, name: '現金', from: 'x' }] as never }).lines).toEqual(['這一趟拿到的東西都帶出來了。'])
    expect(lossOf(game.k, game.state, { id, loot: [] }).lines).toEqual([])
  })
})

describe('白箱 netrun：畫面上的目標說明（CYBERSPACE 8.3 節「目標」；NETRUNNING 第 3 節）', () => {
  const cases: Array<[Record<string, unknown>, string]> = [
    [{ kind: 'download' }, '下載：待在目標的檔案庫上，做滿 1 次（離開那一格進度歸零；每回合追蹤度會漲）。'],
    [{ kind: 'plant', turns: 3 }, '放東西：待在目標的節點上，上傳 3 個回合。'],
    [{ kind: 'plant' }, '放東西：待在目標的節點上，上傳 1 個回合。'],
    [{ kind: 'seize' }, '接管目標的控制節點。'],
    [{ kind: 'find' }, '找到目標的人：走到他那裡，交涉或快駭。'],
    [{ kind: 'defeat' }, '打倒守著目標的那一場。'],
    [{ kind: 'defeat', foe: 'en_x' }, '打倒守著目標的那一場，指定的敵人就在裡面。'],
    [{ kind: 'extract' }, '拿到目標的東西，再走到出口或安全點。'],
    [{ kind: 'extract', got: true }, '東西拿到了：走到出口或安全點，倒下的話這一件一定會丟。'],
    [{ kind: 'mystery' }, '目標：mystery。'],
  ]
  for (const [goal, text] of cases) {
    it(`goal ${JSON.stringify(goal)} → 「${text}」`, () => {
      const g = dig()
      const st = withRun(g, (r) => { r.goal = goal })
      expect(netrunView(g.k, st)!.goal.text).toBe(text)
    })
  }

  it('最後一層、目標不是通過：閘門的原因寫出目標；extract 還沒拿到另一句（不變式第 159 條的主幹之外）', () => {
    const g = dig()
    const run = readRun(g.state)!
    const net = netExt(g.state, run.map)!
    const last = { ...run, layer: run.layers.length - 1, goal: { kind: 'find' } } as never
    const sheet = run.layers[run.layers.length - 1]!
    const opened = { ...net, opened: [sheet] }
    expect(gateBlock(g.state, last, opened, sheet)).toBe('這一趟的目標是「找人」（find），還沒做到，不能就這樣離開。')
    expect(gateBlock(g.state, { ...(last as object), goal: { kind: 'extract' } } as never, opened, sheet)).toBe('這一趟要把東西帶出來，還沒拿到，不能就這樣離開。')
    expect(gateBlock(g.state, { ...(last as object), goal: { kind: 'extract', got: true } } as never, opened, sheet)).toBeNull()
    expect(gateBlock(g.state, { ...(last as object), goal: { kind: 'weird' } } as never, opened, sheet)).toBe('這一趟的目標是「weird」（weird），還沒做到，不能就這樣離開。')
    expect(gateBlock({ ...g.state, battle: {} as never }, last, opened, sheet)).toMatch(/戰鬥/)
  })
})

describe('白箱 netrun：做事的入口的退路（dev/work/M3-netrun-nodes.md；CYBERSPACE 8.1 節）', () => {
  it('不在網內的地圖上：useNode、descend 都丟「現在不在網內的地圖上」', () => {
    const { game } = makeDiveGame()
    expect(() => useNode(game.k, game.state, 'rest')).toThrow('現在不在網內的地圖上。')
    expect(() => descend(game.k, game.state)).toThrow('現在不在網內的地圖上。')
    expect(nodeUses(game.k, game.state)).toEqual([])
    expect(freeUses(game.k, game.state)).toEqual([])
    expect(hereOf(game.k, game.state)).toBeNull()
  })

  it('節點不存在、離太遠、站的格子什麼都沒有、遭遇沒寫 at、沒有這件事：各一句', () => {
    const g = dig()
    expect(() => useNode(g.k, g.state, 'loot', 'no_such')).toThrow('這一層沒有「no_such」這個節點。')
    const marks = netMarkers(g)
    const at = g.state.maps.at!
    const far = marks.find((m) => Math.abs(m.at[0] - at.x) + Math.abs(m.at[1] - at.y) > 1)!
    expect(() => useNode(g.k, g.state, 'loot', far.id)).toThrow(`「${far.name}」離這裡太遠了，要走到它旁邊（或站在上面）。`)
    // 入口那一格是 E：不是任何一種有事可做的節點
    expect(() => useNode(g.k, g.state, 'dance')).toThrow(/這裡沒有「dance」可以做。|這一格什麼都沒有/)
    // 站的格子什麼都沒有：在一份複本上把人放到一格空地
    const def = g.state.maps.instances[at.map]!.gen!.map.sheets.find((s) => s.id === at.sheet)!
    let empty: [number, number] | null = null
    def.layout.forEach((row, y) => [...row].forEach((ch, x) => { if (!empty && ch === '.' && !def.cells!.some((c) => c.at[0] === x && c.at[1] === y)) empty = [x, y] }))
    if (empty) {
      const st = clone(g.state)
      st.maps.at = { ...at, x: empty[0], y: empty[1] }
      expect(() => useNode(g.k, st, 'loot')).toThrow('這一格什麼都沒有，沒有可以做的事。')
      // 站在遭遇節點上（不會發生，但入口要擋）：沒寫 at
      const foe = marks.find((m) => m.mark === 'f')
      if (foe) {
        st.maps.at = { ...at, x: foe.at[0], y: foe.at[1] }
        expect(() => useNode(g.k, st, 'fight')).toThrow(`「${foe.name}」站不上去，要走到它旁邊再選。`)
      }
    }
  })

  it('descend：不是站在閘門上；最後一層沒有下一層', () => {
    const g = dig()
    expect(() => descend(g.k, g.state)).toThrow('要站在閘門上才能往下一層。')
    const at = g.state.maps.at!
    const gate = netMarkers(g).find((m) => m.mark === 'g')!
    const st = clone(g.state)
    st.maps.at = { ...at, x: gate.at[0], y: gate.at[1] }
    const run = st.ext.netrun as { layer: number; layers: string[] }
    run.layer = run.layers.length - 1
    // 換層之後站的是同一張圖的閘門（只為了問最後一層）
    if (run.layers.length === 1 || run.layers[run.layer] === at.sheet) expect(() => descend(g.k, st)).toThrow('這已經是最後一層了，沒有下一層。')
  })

  it('閘門：破解沒有主控、用憑證沒有憑證、用鑰匙沒有鑰匙：各丟 ActionBlocked（NETRUNNING 第 5 節、CYBERSPACE 8.3 節）', () => {
    const g = dig()
    const run = readRun(g.state)!
    const net = netExt(g.state, run.map)!
    const sheet = run.layers[run.layer]!
    // 主角是工廠的角色，沒有主控（沒有 master_tier、沒有 paths）
    expect(masterTier(g.k, g.state, g.state.pc!)).toBe(0)
    expect(() => gateDraft(g.k, g.state, run, net, sheet, 'crack', 10)).toThrow('隊上沒有人有主控，破解不了閘門：要有主控、憑證或後門鑰匙。')
    expect(() => gateDraft(g.k, g.state, run, { ...net, keys: [] }, sheet, 'cred', 10)).toThrow('手上沒有憑證。')
    expect(() => gateDraft(g.k, g.state, run, net, sheet, 'crack_key', 10)).toThrow('沒有可以用的後門鑰匙（要帶著和這座網同一級的後門鑰匙）。')
    // 有憑證：用掉一張，閘門記成開了
    const d = gateDraft(g.k, g.state, run, { ...net, keys: ['k1', 'k2'] }, sheet, 'cred', 10)
    expect(d.outcome.result).toBe('cred')
    const ext = d.changes.find((c) => c.op === 'map.ext') as unknown as { value: { net: { keys: string[]; opened: string[] } } }
    expect(ext.value.net.keys).toEqual(['k2'])
    expect(ext.value.net.opened).toContain(sheet)
  })

  it('主控的來源：actor.ext.paths 裡 master_path 那一路的階數，夾在 5；壞掉的列略過（NETRUNNING 第 4 節「主控」；dev/work/M3-netrun-nodes.md）', () => {
    const g = dig()
    const st = clone(g.state)
    st.actors[st.pc!]!.ext.paths = [{ path: 'netrunner', tier: 9 }, { path: 'netrunner', tier: 'x' }, 3, { path: 'other', tier: 4 }]
    // master_path 是規則表的（預設 netrunner）：9 夾成 5；別的路數不算
    expect(masterTier(g.k, st, st.pc!)).toBe(5)
    st.actors[st.pc!]!.ext.paths = [{ path: 'other', tier: 4 }]
    expect(masterTier(g.k, st, st.pc!)).toBe(0)
    st.actors[st.pc!]!.ext.paths = 'x'
    expect(masterTier(g.k, st, st.pc!)).toBe(0)
  })

  it('擦痕跡：沒有主控的隊伍沒有這一項（undefined），硬做丟「擦不了痕跡」', () => {
    const g = dig()
    const run = readRun(g.state)!
    const net = netExt(g.state, run.map)!
    expect(wipeUse(g.k, g.state, run, net)).toBeUndefined()
    expect(() => wipeDraft(g.k, g.state, run, net)).toThrow('隊上沒有人有主控，擦不了痕跡。')
    expect(() => useNode(g.k, g.state, 'wipe')).toThrow('隊上沒有人有主控，擦不了痕跡。')
  })

  it('doNodeUse：不認得的 id 回傳 null（由 useNode 轉成「這裡沒有…可以做」）', () => {
    const g = dig()
    const run = readRun(g.state)!
    const net = netExt(g.state, run.map)!
    const m = netMarkers(g)[0]!
    expect(doNodeUse(g.k, g.state, run, net, run.layers[0]!, { id: m.id, mark: m.mark, name: m.name, at: m.at } as MarkerDef, 'dance')).toBeNull()
  })

  it('後門鑰匙：沒有帶 backdoor_key 標籤或等級不對的不算', () => {
    const g = dig()
    expect(keysIn(g.k, g.state, 1)).toEqual([])
  })

  it('登出：戰鬥中擋下；自己去挖的一趟沒有「撤退」的提醒（CYBERSPACE 2.4 節；不變式第 160 條）', () => {
    const g = dig()
    expect(logoutBlock({ ...g.state, battle: {} as never })).toMatch(/戰鬥/)
    expect(() => logout(g.k, { ...clone(g.state), battle: {} as never })).toThrow(ActionBlocked)
    expect(netrunView(g.k, g.state)!.logout).toEqual({ block: null, note: null })
    const { game } = makeDiveGame()
    expect(logoutBlock(game.state)).toBe('現在沒有在網內的行程裡。')
    expect(() => logout(game.k, game.state)).toThrow('現在沒有在網內的行程裡。')
  })
})

describe('白箱 netrun：區、規則、設施、詞條的格式檢查（DATA 第 10 節；CYBERSPACE 8.1 節）', () => {
  it('regionProblems（net_region）：name、map_kind、carve、sight、oneway、loops、safe、cover、temper、trap', () => {
    const p = regionProblems({ id: 'x', name: '', map_kind: '', carve: [0, 1], sight: 10, oneway: 2, fragile: -1, loops: 7, safe: 'y', cover: 'thick', temper: 3, trap: 3 })
    for (const want of [
      '要有 name', 'map_kind 要是地圖的種類（subnet、maze、wreck、deep）', 'carve 要是 [最少, 最多]，1～500 的整數', 'sight 要是 1～9 的整數',
      'oneway 要是 0～1 的數字', 'fragile 要是 0～1 的數字', 'loops 要是 0～6 的整數', 'safe 要是布林值', 'temper 要是 { 勢力的 id: 詞條的效果 }', 'trap 要是 { alarm, loop_load }',
    ]) expect(p).toContain(want)
    expect(p.some((m) => m.startsWith('cover 要是'))).toBe(true)
    expect(regionProblems({ trap: { alarm: 101, zap: 1 } } as never)).toEqual(expect.arrayContaining(['trap.zap 不認得（alarm、loop_load）', 'trap.alarm 要是 0～100 的整數']))
    // cover 也可以是 { ally, foe } 各四格
    expect(regionProblems({ cover: { ally: [0, 1, 2, 0], foe: [0, 0, 0, 0] } } as never).some((m) => m.startsWith('cover'))).toBe(false)
    expect(regionProblems({ cover: { ally: [0, 1, 3, 0], foe: [0, 0, 0, 0] } } as never).some((m) => m.startsWith('cover'))).toBe(true)
  })

  it('ruleProblems（netrun_rule）：master_path 不是字串、encounter 的形狀', () => {
    expect(ruleProblems({ master_path: 3 } as never)).toEqual(['master_path 要是路數的 id'])
    expect(ruleProblems({ encounter: 3 } as never)).toEqual(['encounter 要是 { plain?, guard?, boss? }'])
    expect(ruleProblems({ encounter: { other: [], boss: ['god'] } } as never)).toEqual(['encounter.other 不認得（plain、guard、boss）', 'encounter.boss 要是位階（minion、elite、boss）的陣列，最多八個'])
  })

  it('facilityProblems、affixProblems：region 不是字串', () => {
    expect(affixProblems({ name: 'x', region: 3, fx: {} } as never)).toContain('region 要是區的 id（沒寫是共通詞條）')
    expect(facilityProblems({} as never).length).toBeGreaterThan(0)
  })
})

describe('白箱 netrun：查詢的函式不改狀態（不變式第 1 條）', () => {
  it('netrunView、nodeUses、freeUses、gateBlock、logoutBlock 在凍結的狀態上照常', () => {
    const g = dig()
    const st = deepFreeze(clone(g.state))
    expect(() => { netrunView(g.k, st); nodeUses(g.k, st); freeUses(g.k, st); logoutBlock(st) }).not.toThrow()
    // 做事的草稿也只回傳變更，不改狀態
    expect(() => logout(g.k, st)).not.toThrow()
  })
})
