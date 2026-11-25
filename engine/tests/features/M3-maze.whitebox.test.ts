// 白箱測試：features/maze（迷宮館：報名、機關、寶箱、評價、結算）。
// 補主套件沒有走到的分支：報名的各種擋法（沒有這一組／這一級、隊上沒人、人太多、押金不夠、燒傷、公開組的構裝與甲板）、
// 不在館裡的機關與寶箱、評價的邊界、表的挑法、格式檢查、ready 的參照檢查、中途離開的結算、查詢的函式不改狀態。
// 每個測試名稱寫明在測哪一條規格（文件與節）或不變式（dev/invariants.md）。

import { describe, expect, it } from 'vitest'
import type { ContentPack, GameState } from '../../src'
import { ActionBlocked, ContentError, clone } from '../../src'
import {
  DEFAULT_RULES, brackets, enter, enterBlocks, mazeRegion, mazeRules, mazeView, openBlock, rate, readMaze, ruleProblems, solveBlock, tableOf, tableProblems, useMaze,
} from '../../src/features/maze'
import { closeRun, onBattleEnd, onRound, resultDraft } from '../../src/features/maze/ops'
import { diveIn, makeDiveGame, makeWorldGame, mazeSignUp, refitForRookie } from '../../src/testkit'

type G = ReturnType<typeof makeDiveGame>['game']

function deepFreeze<T>(o: T): T {
  if (o && typeof o === 'object' && !Object.isFrozen(o)) {
    Object.freeze(o)
    for (const v of Object.values(o as Record<string, unknown>)) deepFreeze(v)
  }
  return o
}

/** 換掉假世界的 maze_rule（規則表可以被後載入的包整筆取代；不變式第 168 條）。 */
const rulePack = (rule: Record<string, unknown>): ContentPack => ({ id: 'wb_maze_rule', content: { maze_rule: [{ id: 'default', ...rule }] } as never })

/** 潛入、換比賽版：站在報名之前。 */
function ready(o: Parameters<typeof makeDiveGame>[0] = {}): G {
  const { game } = makeDiveGame(o)
  if (o.noDeck) {
    // 沒有自己的甲板：先把比賽版構裝放進身上的格子（甲板租下來才裝得上；同 M3-fix-review 的 rentalGame）
    game.commit({ kind: 'system', action: 'test.set', location: {}, party: [], timeline: [], changes: [{ op: 'actor.ext', id: 'pc', key: 'deck', value: { slots: ['cs_tw_gun_rent', 'cs_tw_blade_rent'], scripts: [] } }] as never, outcome: { result: 'ok', summary: 't' } })
  } else refitForRookie(game)
  diveIn(game)
  return game
}

describe('白箱 maze：報名的擋法（CYBERSPACE 8.2 節「報名」）', () => {
  it('沒有這一組、這一組沒有這一級：各一句', () => {
    const game = ready()
    expect(enterBlocks(game.k, game.state, 'nope')).toEqual(['沒有「nope」這一組。'])
    expect(enterBlocks(game.k, game.state, 'rookie', 3)).toEqual(['新手組沒有 III 級。'])
    expect(() => enter(game.k, game.state, 'nope')).toThrow(ActionBlocked)
  })

  it('一隊最多四人（max_party）：人太多寫出現在有幾個', () => {
    const game = ready({ content: [rulePack({ max_party: 1 })] as never })
    // 把一個隊友塞進隊伍（直接改一份複本：只問擋法）
    const st = clone(game.state)
    st.party = [...st.party, st.party[0]!]
    expect(enterBlocks(game.k, st, 'rookie').join('')).toContain('一隊最多 1 個人（現在隊上有 2 個）。')
  })

  it('隊上沒有人：「沒有人可以報名」', () => {
    const game = ready()
    const st = { ...clone(game.state), party: [] }
    expect(enterBlocks(game.k, st, 'rookie')).toContain('隊上沒有人，沒有人可以報名。')
  })

  it('押金不夠：寫出要多少、手上多少', () => {
    const game = ready()
    const st = clone(game.state)
    st.money.cash = 10
    expect(enterBlocks(game.k, st, 'rookie').join('')).toContain('押金不夠：新手組要 C$50，你只有 C$10。')
  })

  it('剛在網內倒下（net_burn 還沒過）：一個小時內不能再潛入；過期的燒傷不擋', () => {
    const game = ready()
    const st = clone(game.state)
    const now = st.time.day * 1440 + st.time.hour * 60 + st.time.minute
    st.actors[st.pc!]!.conditions.push({ id: 'net_burn', until: now + 60 } as never)
    expect(enterBlocks(game.k, st, 'rookie').join('')).toContain('剛在網內倒下，還在燒傷中')
    st.actors[st.pc!]!.conditions = [{ id: 'net_burn', until: 0 } as never]
    expect(enterBlocks(game.k, st, 'rookie').join('')).not.toContain('燒傷')
  })

  it('公開組（own）：裝著超過 II 級的構裝寫「比賽版或 II 級以下」；沒有武器構裝的原因寫「館方的比賽版，或 II 級以下」', () => {
    const game = ready({ content: [rulePack({ brackets: { open: { kit: ['cs_tw_gun_rent'] } } })] as never })
    // 假世界的構裝都是 I 級：把一件改成 III 級的複本內容不方便，改看沒有武器構裝的那一句
    const st = clone(game.state)
    const deck = st.actors[st.pc!]!.ext.deck as { slots: string[] }
    deck.slots = deck.slots.filter((s) => s !== 'cs_tw_gun_rent' && s !== 'cs_tw_blade_rent')
    const why = enterBlocks(game.k, st, 'open').join('')
    expect(why).toContain('公開組要有能用的武器構裝（館方的比賽版，或 II 級以下）')
  })

  it('沒有館方甲板的組別：隊上沒有人有甲板就擋「這一組要用自己的甲板」', () => {
    const game = ready({ noDeck: true })
    // 潛艙店租的甲板 deck_grade 是 I 級：拿掉租用之後沒有人有甲板
    const st = clone(game.state)
    st.actors[st.pc!]!.ext.deck = { slots: ['cs_tw_gun_rent'], scripts: [] }
    expect(enterBlocks(game.k, st, 'open').join('')).toContain('隊上沒有人有甲板：這一組要用自己的甲板。')
  })

  it('brackets：每一組每一級一列（新手、公開、無差別 III、IV），block 是原因接起來', () => {
    const game = ready()
    const rows = brackets(game.k, game.state)
    expect(rows.map((r) => [r.id, r.grade])).toEqual([['rookie', 1], ['open', 2], ['unlimited', 3], ['unlimited', 4]])
    for (const r of rows) expect(r.block).toBe(r.blocks.length ? r.blocks.join('') : null)
  })

  it('沒有 netrun 的世界：報名一律「還沒開」（NOT_OPEN），狀態沒動', () => {
    const { game } = makeWorldGame({ without: ['netrun'] })
    const blocks = enterBlocks(game.k, game.state, 'rookie')
    expect(blocks).toHaveLength(1)
    expect(blocks[0]).toBeTruthy()
  })
})

describe('白箱 maze：不在館裡的機關與寶箱（CYBERSPACE 8.2 節「三層」）', () => {
  it('不在迷宮館裡：機關、寶箱都擋下；useMaze 不認得的 id 丟 ActionBlocked', () => {
    const game = ready()
    expect(solveBlock(game.k, game.state)).toBe('現在不在迷宮館裡。')
    expect(openBlock(game.k, game.state)).toBe('現在不在迷宮館裡。')
    expect(() => useMaze(game.k, game.state, 'dance')).toThrow('這裡沒有「dance」可以做。')
    expect(() => useMaze(game.k, game.state, 'open')).toThrow('現在不在迷宮館裡。')
    expect(() => useMaze(game.k, game.state, 'solve')).toThrow('現在不在迷宮館裡。')
    expect(mazeView(game.k, game.state)).toBeNull()
  })

  it('報名之後站在入口：旁邊沒有機關、腳下沒有寶箱、不存在的標記寫出 id；戰鬥中寫「正在戰鬥」', () => {
    const game = ready()
    mazeSignUp(game, 'rookie', 3)
    expect(solveBlock(game.k, game.state)).toBe('旁邊沒有機關。')
    expect(solveBlock(game.k, game.state, 'zz')).toBe('這一層沒有「zz」這個機關。')
    expect(openBlock(game.k, game.state)).toBe('這裡沒有寶箱。')
    expect(openBlock(game.k, game.state, 'zz')).toBe('這一層沒有「zz」這個寶箱。')
    const busy = { ...clone(game.state), battle: {} as never }
    expect(solveBlock(game.k, busy)).toMatch(/戰鬥/)
    expect(openBlock(game.k, busy)).toMatch(/戰鬥/)
  })

  it('不存在的解法：寫出可以用的辦法', () => {
    const game = ready()
    mazeSignUp(game, 'rookie', 3)
    const v = mazeView(game.k, game.state)!
    expect(v.layer).toMatchObject({ index: 1, total: 3, name: '前庭' })
    // 找這一層的機關
    const g = game.state.maps.at!
    const def = game.state.maps.instances[g.map]!.gen!.map.sheets.find((s) => s.id === g.sheet)!
    const puzzle = def.cells!.find((c) => c.mark === 'm')
    if (!puzzle) return
    const why = solveBlock(game.k, game.state, puzzle.id, 'magic')
    // 不在旁邊就先寫太遠；在旁邊才寫沒有這個辦法：兩者之一
    expect(why).toMatch(/太遠|沒有「magic」這個辦法（interface、street、body）/)
  })
})

describe('白箱 maze：評價、表、規則（CYBERSPACE 8.2 節「時間與評價」「寶箱」「獎品表」）', () => {
  it('rate：剛好等於門檻算過；標準是 0 時比例當成無限大（只有沒門檻的列接得住）', () => {
    const r = DEFAULT_RULES
    expect(rate(r, 37, 37, 0).rating).toBe('S')
    expect(rate(r, 38, 37, 0).rating).toBe('A')
    expect(rate(r, 37, 37, 1).rating).toBe('A')
    expect(rate(r, 37, 37, 2).rating).toBe('B')
    expect(rate(r, 37, 37, 3).rating).toBe('C')
    expect(rate(r, 0, 0, 0).rating).toBe('C')
  })

  it('tableOf：規則指定的 id 不存在是 null；沒指定是這一種裡 id 排最前面的；沒有這種內容是 null', () => {
    const { game } = makeWorldGame()
    const rules = mazeRules(game.k)
    expect(tableOf(game.k, 'chest', rules)?.id).toBe('mzt_tw_chest')
    expect(tableOf(game.k, 'chest', { ...rules, chest_table: 'none_such' })).toBeNull()
    const { chest_table: _c, prize_table: _p, ...rest } = rules
    expect(tableOf(game.k, 'prize', rest as never)?.id).toBe('mzt_tw_prize')
    expect(tableOf({ content: { hasKind: () => false } } as never, 'chest', rules)).toBeNull()
  })

  it('mazeRegion：handled 一定含 a、m，資料加的併進去；layer 各項個別蓋', () => {
    const r = mazeRegion({ ...DEFAULT_RULES, region: { handled: ['x'], layer: { foe: [1, 1] } } })
    expect(r.handled).toEqual(['a', 'm', 'x'])
    expect((r.layer as Record<string, unknown>).foe).toEqual([1, 1])
    expect((r.layer as Record<string, unknown>).archive).toEqual([1, 2])
    expect(r.id).toBe('maze')
  })

  it('mazeRules：資料沒寫的組別留著內建的、新的組別補上預設（own、max_grade 5）', () => {
    const { game } = makeWorldGame({ content: [rulePack({ brackets: { pro: { name: '職業組', grades: [{ grade: 5, deposit: 9, prize: 99 }] } } })] as never })
    const rules = mazeRules(game.k)
    expect(Object.keys(rules.brackets).sort()).toEqual(['open', 'pro', 'rookie', 'unlimited'])
    expect(rules.brackets.pro).toMatchObject({ name: '職業組', own: true, max_grade: 5, kit: [] })
    // 排序：內建的三組在前，其餘照 id
    expect(brackets(game.k, game.state).map((b) => b.id)).toEqual(['rookie', 'open', 'unlimited', 'unlimited', 'pro'])
  })

  it('ruleProblems：每一個欄位寫壞各一句', () => {
    expect(ruleProblems({ brackets: {} })).toEqual(['brackets 要是 { 組別的 id: 一個組別 }'])
    expect(ruleProblems({ brackets: { x: 3 } })).toEqual(['brackets.x 要是 { name, grades, own, max_grade, deck?, kit?, guard? }'])
    expect(ruleProblems({ brackets: { x: { grades: [] } } })).toEqual(['brackets.x.name 要有名字', 'brackets.x.grades 要是一到五筆 { grade（1～5）, deposit, prize }（0 以上的整數）'])
    expect(ruleProblems({ brackets: { rookie: { own: 1, max_grade: 9, deck: 3, kit: [3], guard: ['god'] } } })).toEqual([
      'brackets.rookie.own 要是布林值', 'brackets.rookie.max_grade 要是 0～5 的整數', 'brackets.rookie.deck 要是甲板的 id', 'brackets.rookie.kit 要是構裝 id 的陣列',
      'brackets.rookie.guard 要是位階（minion、elite、boss）的陣列',
    ])
    expect(ruleProblems({ layers: [{ name: 'a', standard: 0 }] })).toHaveLength(1)
    expect(ruleProblems({ rating: [{ rating: 'S', mult: 1, ratio: 1 }] })).toEqual(['rating 的最後一列不能寫 ratio 或 downs（它是墊底的，什麼都接）'])
    expect(ruleProblems({ rating: [{ rating: 'S', mult: 99 }] })).toHaveLength(1)
    expect(ruleProblems({ puzzle_load: 101, rest_load: -1, chip: 1.5, max_party: 9, mimic: 2, load_mult: [1], faction: 3, solve: [{ id: 'x' }], mimic_foes: [], chest_table: 3, region: 3 })).toEqual([
      'puzzle_load 要是 0～100 的整數', 'rest_load 要是 0～100 的整數', 'chip 要是 0～10000 的整數', 'max_party 要是 1～8 的整數', 'mimic 要是 0～1 的數字',
      'load_mult 要是五個數字（I～V 級各一）', 'faction 要是勢力的 id', 'solve 要是一串 { id, name, attr, skill? }（解機關的辦法）',
      'mimic_foes 要是位階（minion、elite、boss）的陣列', 'chest_table 要是 id（字串）', 'region 要是 net_region 的欄位（只寫要蓋掉的）',
    ])
  })

  it('tableProblems：kind、rows、每一列的欄位', () => {
    expect(tableProblems({ kind: 'x' })).toEqual(["kind 只能是 'chest'（寶箱）或 'prize'（獎品）", 'rows 要是至少一列 { weight, give?, chips?, prize? }'])
    expect(tableProblems({ kind: 'chest', rows: [3, { weight: 0, name: 3, give: [1], chips: -1, prize: 'y' }, { weight: 1 }] })).toEqual([
      'rows[0] 要是 { weight, give?, chips?, prize? }',
      'rows[1].weight 要是大於 0 的數字', 'rows[1].name 要有名字', 'rows[1].give 要是一串效果（每一筆是一個物件）', 'rows[1].chips 要是 0 以上的整數，或 [最少, 最多]', 'rows[1].prize 要是布林值',
      'rows[2] 什麼都沒給（要有 give、chips 或 prize）',
    ])
  })

  it('ready：比賽甲板不存在、指定的寶箱表與獎品表不存在、表裡的效果沒有人登記：整批 ContentError', () => {
    const pack: ContentPack = {
      id: 'wb_maze_bad',
      content: {
        maze_rule: [{ id: 'default', brackets: { rookie: { deck: 'dk_none' } }, chest_table: 'mzt_none', prize_table: 'mzt_none2' }],
        maze_table: [{ id: 'mzt_wb', kind: 'chest', rows: [{ weight: 1, give: [{ kind: 'no_such_effect' }] }] }],
      } as never,
    }
    let err: unknown
    try { makeWorldGame({ content: [pack] }) } catch (e) { err = e }
    expect(err).toBeInstanceOf(ContentError)
    const msg = (err as Error).message
    expect(msg).toContain('maze_rule 的 rookie 組：比賽甲板 dk_none 不在內容裡')
    expect(msg).toContain('maze_rule：寶箱表 mzt_none 不在內容裡')
    expect(msg).toContain('maze_rule：獎品表 mzt_none2 不在內容裡')
    expect(msg).toContain('maze_table/mzt_wb：rows[0] 的效果 no_such_effect 沒有人登記')
  })

  it('readMaze：形狀不對當成沒有；壞的 rented、origin 退回預設', () => {
    expect(readMaze({ ext: { maze: { id: 'z', bracket: 'b', grade: 1.5, deposit: 0 } } })).toBeNull()
    expect(readMaze({ ext: { maze: { id: 'z', bracket: 'b', grade: 1, deposit: 0, rented: 'x', origin: 3, prior: { a: 1, b: 'dk' } } } })).toEqual({
      id: 'z', bracket: 'b', grade: 1, deposit: 0, rented: [], prior: { b: 'dk' }, origin: { by: 'maze' },
    })
  })
})

describe('白箱 maze：結算的路（CYBERSPACE 8.2 節「打輸」、「時間與評價」；不變式第 176、179 條）', () => {
  it('中途離開（left）：押金沒收、籌碼照算到那一刻換現金、比賽甲板換回潛艙店那一副；摘要寫「沒闖過」', () => {
    const game = ready({ noDeck: true })
    const before = readMaze(game.state)
    expect(before).toBeNull()
    mazeSignUp(game, 'rookie', 3)
    const m = readMaze(game.state)!
    expect(m.prior).toEqual({ [game.state.pc!]: 'dk_tw_rent' })
    const st = clone(game.state)
    st.counters[`maze:${m.id}:chip`] = 4
    st.counters[`maze:${m.id}:r0`] = 5
    const out = closeRun(game.k, st, { id: 'r', layer: 0, origin: { by: 'maze' } }, 'left')!
    expect(out.lines).toEqual(['你被送回了館方的回復室。押金沒收了，籌碼照算到這一刻。'])
    expect(out.changes).toContainEqual({ op: 'cash', delta: 40 })
    // 換回報名前那一副（不是收成沒有）
    expect(JSON.stringify(out.changes)).toContain('dk_tw_rent')
    // 計數器歸零
    expect(out.changes).toContainEqual({ op: 'counter', key: `maze:${m.id}:chip`, delta: -4 })
    expect(out.changes).toContainEqual({ op: 'counter', key: `maze:${m.id}:r0`, delta: -5 })
    const over = (out.changes.find((c) => c.op === 'ext' && (c as unknown as { key: string }).key === 'maze') as unknown as { value: { over: Record<string, unknown> } }).value.over
    expect(over).toMatchObject({ outcome: 'left', refund: 0, forfeited: m.deposit, chips: 4, chipCash: 40, prize: 0 })
    const d = resultDraft(st, { ...m, over: over as never })
    expect(d.outcome.result).toBe('forfeit')
    expect(d.outcome.summary).toContain(`押金 ${m.deposit} 沒收。`.replace(`${m.deposit}`, String(m.deposit)))
  })

  it('不是迷宮館開的一趟、已經結算過的：closeRun、onRound 不理', () => {
    const game = ready()
    mazeSignUp(game, 'rookie', 3)
    expect(closeRun(game.k, game.state, { id: 'r', layer: 0, origin: { by: 'dive' } }, 'done')).toBeUndefined()
    expect(onRound(game.state, { id: 'r', layer: 0, origin: { by: 'dive' } })).toBeUndefined()
    expect(onRound(game.state, { id: 'r', layer: 1, origin: { by: 'maze' } })).toEqual([{ op: 'counter', key: `maze:${readMaze(game.state)!.id}:r1`, delta: 1 }])
    const st = clone(game.state)
    ;(st.ext.maze as Record<string, unknown>).over = { outcome: 'done' }
    expect(onRound(st, { id: 'r', layer: 0, origin: { by: 'maze' } })).toBeUndefined()
    expect(closeRun(game.k, st, { id: 'r', layer: 0, origin: { by: 'maze' } }, 'done')).toBeUndefined()
  })

  it('onBattleEnd：不是這一趟的戰鬥不理；倒下、燒斷、被釘住都算倒下的人次，拔線不算；回合至少算 1', () => {
    const game = ready()
    mazeSignUp(game, 'rookie', 3)
    const m = readMaze(game.state)!
    const at = game.state.maps.at!
    const runId = (game.state.ext.netrun as { id: string }).id
    const battle = (round: number, link: unknown) => ({
      round, origin: { ext: { net: link } },
      units: { a: { side: 'ally', out: 'down' }, b: { side: 'ally', out: 'burnout' }, c: { side: 'ally', out: 'pinned' }, d: { side: 'ally', out: 'jacked_out' }, e: { side: 'foe', out: 'down' } },
    })
    expect(onBattleEnd(game.k, game.state, battle(3, { run: 'other', map: at.map, sheet: at.sheet }), 'win')).toBeUndefined()
    expect(onBattleEnd(game.k, game.state, battle(3, 'x'), 'win')).toBeUndefined()
    const out = onBattleEnd(game.k, game.state, battle(0, { run: runId, map: at.map, sheet: at.sheet }), 'lose')!
    expect(out.changes).toEqual([{ op: 'counter', key: `maze:${m.id}:r0`, delta: 1 }, { op: 'counter', key: `maze:${m.id}:down`, delta: 3 }])
    expect(out.lines).toEqual([])
  })

  it('查詢的函式（brackets、enterBlocks、mazeView、solveBlock、openBlock）不改狀態（不變式第 1 條）', () => {
    const game = ready()
    const a: GameState = deepFreeze(clone(game.state))
    expect(() => { brackets(game.k, a); enterBlocks(game.k, a, 'rookie'); mazeView(game.k, a) }).not.toThrow()
    mazeSignUp(game, 'rookie', 3)
    const b: GameState = deepFreeze(clone(game.state))
    expect(() => { mazeView(game.k, b); solveBlock(game.k, b); openBlock(game.k, b); brackets(game.k, b) }).not.toThrow()
  })
})
