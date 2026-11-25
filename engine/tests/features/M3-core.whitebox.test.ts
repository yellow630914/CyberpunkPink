// 白箱測試：M3 期間改過的核心（battle 的閃斷擋法、同步原則的錯誤路徑、格子地圖生成器的「檢查函式抓得到」、存檔第 4 版的地圖實例、地圖實例的重複）。
// 補主套件沒有走到的分支。每個測試名稱寫明在測哪一條規格（文件與節）或不變式（dev/invariants.md）。

import { describe, expect, it } from 'vitest'
import fc from 'fast-check'
import type { GenResult, GenSpec } from '../../src'
import { BattleBlocked, BattleRun, FLASH, clone, generateSheet, genProblems, genSpecProblems, performAction, seedRand, syncBlocks, syncCapOf, syncSensitivityOf } from '../../src'
import { diveIn, makeDiveGame, makeNetBattleGame } from '../../src/testkit'
import { go as diveGo } from '../../src/features/dive'

type Rec = Record<string, unknown>

describe('白箱 core/battle：閃斷中直接下指令（CYBERSPACE 6.2 節「閃斷」；不變式第 178 條）', () => {
  it('performAction 在閃斷的單位身上做花 RAM 的行動：丟 BattleBlocked、原因開頭「閃斷中」、不扣任何東西；不花 RAM 的行動（回填、換構裝）照做', () => {
    const { game: g } = makeNetBattleGame()
    const run = new BattleRun(g.k, g.state, clone(g.state.battle!))
    const pc = Object.values(run.battle.units).find((u) => u.actor === 'pc')!
    pc.wield = 0
    run.applyStatus(pc, FLASH, { force: true })
    const attack = g.k.battle.getAction('net_attack')!
    const foe = Object.values(run.battle.units).find((u) => u.side === 'foe')!
    const ram = pc.pools.ram!.now
    const ap = pc.ap.now
    try {
      performAction(run, pc, attack, { unit: foe.id }, {} as never)
      throw new Error('應該被擋')
    } catch (e) {
      expect(e).toBeInstanceOf(BattleBlocked)
      expect((e as BattleBlocked).reasons[0]).toMatch(/^閃斷中/)
    }
    expect(pc.pools.ram!.now).toBe(ram)
    expect(pc.ap.now).toBe(ap)
    // 回填只花行動點，閃斷中照做
    pc.pools.ram!.now = 0
    performAction(run, pc, g.k.battle.getAction('net_refill')!, null, {} as never)
    expect(pc.pools.ram!.now).toBeGreaterThan(0)
  })
})

describe('白箱 core/rules/sync：同步原則的錯誤路徑（CORE_RULES 第 5 節；不變式第 144 條）', () => {
  it('沒有這個角色：syncCapOf 與 syncSensitivityOf 丟「沒有 … 這個角色」；不是檔位的名字寫「沒有「x」這一檔」', () => {
    const { game: g } = makeNetBattleGame({ noBattle: true })
    expect(() => syncCapOf(g.k, g.state, 'nobody')).toThrow(/沒有 nobody 這個角色/)
    expect(() => syncSensitivityOf(g.k, g.state, 'nobody')).toThrow(/沒有 nobody 這個角色/)
    expect(syncBlocks(g.k, g.state, 'pc', 'x' as never)).toEqual(['沒有「x」這一檔。'])
  })

  it('條件都夠、但上限被壓低（詛咒讓檔位上限 −3）：開不了時寫「現在開不了（目前最高到…）」，不是缺的條件', () => {
    const { game: g } = makeNetBattleGame({ noBattle: true })
    const a = g.state.actors.pc!
    a.skills.sync = 5
    ;(a.ext.bridge as Rec).sensitivity = 80
    expect(syncBlocks(g.k, g.state, 'pc', 'full')).toEqual([])
    g.k.stats.addStatProvider('sync_cap_bonus', 'wb_curse', () => [{ label: '詛咒', value: -3, source: 'test' }])
    expect(syncCapOf(g.k, g.state, 'pc')).toBe('shallow')
    expect(syncBlocks(g.k, g.state, 'pc', 'deep')).toEqual(['深檔現在開不了（目前最高到淺檔）。'])
    expect(syncBlocks(g.k, g.state, 'pc', 'shallow')).toEqual([])
  })
})

describe('白箱 core/grid/gen：檢查函式 genProblems 抓得到每一種壞掉的結果（不變式第 151～153 條）', () => {
  const FOE = 'net_foe'
  const spec: GenSpec = {
    id: 'wb_gen', name: '白箱圖', size: [11, 9], carve: [30, 40], exit: { kind: 'net_gate', name: '閘門' }, oneway: 0.5, fragile: 0.3, loops: 2,
    places: [
      { kind: 'net_archive', count: [1, 2], where: 'dead_end', name: '檔案庫' },
      { kind: 'net_rest', count: [1, 1], where: 'mid_path', name: '休息點', apart: 1 },
      { kind: FOE, count: [1, 3], where: 'far_half', name: '遭遇' },
      { kind: 'net_alarm', count: [0, 1], where: 'link', name: '警報', trap: true },
      { kind: 'net_loop', count: [0, 1], where: 'any', name: '迴圈碎片', trap: true, hidden: true },
    ],
  }
  /** 有單向、會斷的鏈路與藏起來的東西的一張圖（掃種子找）。 */
  function base(): GenResult {
    for (let seed = 1; seed < 400; seed++) {
      const r = generateSheet(spec, seedRand(seed, 'wb'))
      if (r.graph.edges.some((e) => e.oneway) && r.graph.edges.some((e) => e.fragile) && r.hidden.length > 0 && genProblems(spec, r).length === 0) return r
    }
    throw new Error('找不到有單向、會斷的鏈路與藏起來的東西的種子')
  }
  const dup = (r: GenResult): GenResult => JSON.parse(JSON.stringify(r)) as GenResult
  const flag = (r: GenResult, re: RegExp): boolean => genProblems(spec, r).some((m) => re.test(m))

  it('節點的毛病：id 重複、種類與版面對不上、標記的 id 對不上、沒標記的節點 id 不是 n<編號>、入口不是 depth 0、depth 寫錯', () => {
    const r = base()
    expect(genProblems(spec, r)).toEqual([])
    const a = dup(r); a.graph.nodes.push({ ...a.graph.nodes[0]! }); expect(flag(a, /節點的 id 有重複/)).toBe(true)
    const b = dup(r); b.graph.nodes.find((n) => n.kind === 'net_gate')!.kind = 'net_rest'; expect(flag(b, /和版面的 .* 不一樣/)).toBe(true)
    const c = dup(r); c.graph.nodes.find((n) => n.kind === 'net_gate')!.id = 'zz'; expect(flag(c, /的 id 和那一格的標記 .* 不一樣/)).toBe(true)
    const d = dup(r); d.graph.nodes.find((n) => n.kind === 'floor')!.id = 'room1'; expect(flag(d, /沒有標記的節點 room1 的 id 要是 n<編號>/)).toBe(true)
    const e = dup(r); e.graph.nodes.find((n) => n.kind === 'entry')!.depth = 3; expect(flag(e, /入口要是 depth 0 的節點/)).toBe(true)
    const f = dup(r); f.graph.nodes.find((n) => n.kind === 'net_gate')!.depth += 2; expect(flag(f, /的 depth 是 .*實際走/)).toBe(true)
    const g = dup(r); g.graph.nodes.find((n) => n.kind === 'net_gate')!.at = [0, 0]; expect(flag(g, /在走不到的格子上|從入口走不到/)).toBe(true)
  })

  it('版面的毛病：大小和 spec 不一樣、邊框不是牆、入口不是剛好一個', () => {
    const r = base()
    const a = dup(r); a.sheet.size = [r.sheet.size[0] + 1, r.sheet.size[1]]; expect(genProblems(spec, a).length).toBeGreaterThan(0)
    const b = dup(r); b.sheet.layout[0] = '.' + b.sheet.layout[0]!.slice(1); expect(genProblems(spec, b).length).toBeGreaterThan(0)
    const c = dup(r); c.sheet.cells = c.sheet.cells!.filter((m) => m.mark !== 'E'); expect(genProblems(spec, c).length).toBeGreaterThan(0)
  })

  it('鏈路的毛病：兩端不是節點、格子不連續、鏈路的格子是節點、同一格在兩段鏈路、oneway／fragile 和版面上的 net_valve／net_bridge 對不上、同時單向與會斷', () => {
    const r = base()
    const a = dup(r); a.graph.edges[0]!.a = 'nope'; expect(flag(a, /的兩端不是節點/)).toBe(true)
    const b = dup(r); const eb = b.graph.edges.find((x) => x.cells.length >= 2)!; eb.cells = [eb.cells[1]!, eb.cells[0]!, ...eb.cells.slice(2)]; expect(flag(b, /的格子不連續/)).toBe(true)
    const c = dup(r); const ec = c.graph.edges.find((x) => x.cells.length >= 1)!; ec.cells = [...ec.cells.slice(0, -1), c.graph.nodes.find((n) => n.kind === 'entry')!.at]; expect(genProblems(spec, c).length).toBeGreaterThan(0)
    const d = dup(r); const ed = d.graph.edges.find((x) => x.cells.length >= 1)!; d.graph.edges.push({ ...ed, a: ed.a, b: ed.b }); expect(flag(d, /同時在兩段鏈路裡|net_valve|net_bridge/)).toBe(true)
    const e = dup(r); e.graph.edges.find((x) => x.oneway)!.oneway = undefined; expect(flag(e, /net_valve，oneway 是|不屬於任何一段鏈路/)).toBe(true)
    const f = dup(r); f.graph.edges.find((x) => x.fragile)!.fragile = false; expect(flag(f, /net_bridge，fragile 是|不屬於任何一段鏈路/)).toBe(true)
    const g = dup(r); const eg = g.graph.edges.find((x) => x.oneway)!; eg.fragile = true; expect(flag(g, /同時單向與會斷|net_bridge，fragile 是/)).toBe(true)
  })

  it('走得到與保證的路：單向的方向反過來、出口不是剛好一個或不是最深的、safe_path 不從入口開始、經過陷阱、逆著單向走、藏起來的東西重疊或 trap 不對', () => {
    const r = base()
    // 出口那一格的標記改名：找不到出口
    const a = dup(r); a.sheet.cells!.find((m) => m.mark === 'g')!.name = '別的名字'; expect(genProblems(spec, a).length).toBeGreaterThan(0)
    // safe_path 不從入口開始、中間有一格不連續
    const b = dup(r); b.safe_path = b.safe_path.slice(1); expect(flag(b, /safe_path 要從入口開始/)).toBe(true)
    const c = dup(r); c.safe_path = []; expect(flag(c, /safe_path 要從入口開始/)).toBe(true)
    const d = dup(r); d.safe_path[2] = [d.safe_path[2]![0] + 3, d.safe_path[2]![1]]; expect(flag(d, /不連續|走不上去/)).toBe(true)
    // 藏起來的東西：重疊、trap 和 spec 不一樣
    const e = dup(r); e.hidden.push({ ...e.hidden[0]! }); expect(flag(e, /重疊在/)).toBe(true)
    const f = dup(r); f.hidden[0] = { ...f.hidden[0]!, trap: false }; expect(flag(f, /的 trap 和 spec 不一樣/)).toBe(true)
    // 數量：spec 要 0～1 個警報，多放兩個
    const g = dup(r)
    const floor = g.sheet.layout.flatMap((row, y) => [...row].map((ch, x) => ({ ch, x, y }))).filter((c) => c.ch === '.' && !g.safe_path.some((p) => p[0] === c.x && p[1] === c.y)).slice(0, 3)
    for (const c of floor) { const row = [...g.sheet.layout[c.y]!]; row[c.x] = 'p'; g.sheet.layout[c.y] = row.join('') }
    expect(genProblems(spec, g).length).toBeGreaterThan(0)
  })

  it('genSpecProblems：spec 不是物件、沒有 id、places 不是陣列、出口與陷阱同一種、出口沒有名字：各一句', () => {
    expect(genSpecProblems(null as never)).toEqual(['spec 要有 id'])
    expect(genSpecProblems({ ...spec, id: '' })).toEqual(['spec 要有 id'])
    expect(genSpecProblems({ ...spec, places: 3 as never }).join('；')).toMatch(/places 要是陣列/)
    expect(genSpecProblems({ ...spec, exit: { kind: 'net_gate', name: ' ' } }).join('；')).toMatch(/exit\.name 要有字/)
    expect(genSpecProblems({ ...spec, places: [{ kind: 'net_gate', count: [0, 1], where: 'any', trap: true }] }).join('；')).toMatch(/同時是陷阱的種類/)
  })

  it('性質：任何種子、一般子網與迷宮館兩種密度，生成的圖過自己的檢查，而且每個毛病都是檢查抓得到的（隨機挑一個壞法壞掉就有問題）', () => {
    fc.assert(fc.property(fc.integer({ min: 1, max: 5000 }), fc.constantFrom('far', 'dead', 'exit'), (seed, how) => {
      let r: GenResult
      try { r = generateSheet(spec, seedRand(seed, 'wb2')) } catch { return }
      expect(genProblems(spec, r)).toEqual([])
      const bad = dup(r)
      if (how === 'far') bad.graph.nodes.find((n) => n.kind === 'net_gate')!.depth += 1
      else if (how === 'dead') bad.safe_path = bad.safe_path.slice(0, -1)
      else bad.graph.nodes.find((n) => n.kind === 'entry')!.depth += 1
      expect(genProblems(spec, bad).length).toBeGreaterThan(0)
    }), { numRuns: 25 })
  })
})

describe('白箱 core/state：地圖實例的重複與生成地圖的存檔（存檔第 4 版；不變式第 146、150 條）', () => {
  it('開同一個 id 的地圖實例兩次：第二次整筆不收（寫「地圖實例的 id 重複」）；gen 不合格也不收', () => {
    const { game: g } = makeDiveGame()
    diveIn(g)
    g.commit(diveGo(g.k, g.state, 'ns_tw_dig'))
    const inst = Object.values(g.state.maps.instances).find((m) => m.gen)!
    const draft = (instance: unknown) => ({ kind: 'system' as const, action: 'event.test', location: clone(g.state.location), party: [], timeline: [], changes: [{ op: 'map.open', instance }] as never, outcome: { result: 'ok', summary: 't' } })
    expect(() => g.commit(draft(clone(inst)))).toThrow(/地圖實例的 id 重複/)
    const bad = clone(inst) as unknown as Rec
    bad.id = 'm_new'
    ;(bad.gen as Rec).map = 3
    expect(() => g.commit(draft(bad))).toThrow()
  })

  it('帶 gen 的存檔往返之後狀態一模一樣；壞掉的 gen（版面被動過）讀檔時整份擋下', () => {
    const { game: g } = makeDiveGame()
    diveIn(g)
    g.commit(diveGo(g.k, g.state, 'ns_tw_dig'))
    const saved = g.save('manual', 't')
    const before = clone(g.state)
    expect(g.load(saved)).toBeNull()
    expect(g.state).toEqual(before)
    // save() 回傳的是字串（存檔的 JSON）；改壞其中的版面再讀
    const bad = JSON.parse(saved) as { state: { maps: { instances: Record<string, { gen?: { map: { sheets: Array<{ layout: string[] }> } } }> } } }
    const id = Object.keys(bad.state.maps.instances).find((i) => bad.state.maps.instances[i]!.gen)!
    bad.state.maps.instances[id]!.gen!.map.sheets[0]!.layout = ['x']
    const err = g.load(JSON.stringify(bad))
    expect(err).not.toBeNull()
    expect(err).toMatch(new RegExp(id))
    // 讀檔失敗不動目前的狀態
    expect(g.state).toEqual(before)
  })
})
