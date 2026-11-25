// 白箱測試：features/dive（M3 第二波：從接入點潛入、選去處、登出）。
// 補主套件沒有走到的分支：被強制斷線的畫面與押金、戰鬥中登出、去處的各種擋法、內容格式檢查（設施的 dive、net_site）、
// 戰敗被接受時帶著被定位、自動登出的退路、查詢的函式不改狀態（不變式第 1 條）。
// 每個測試名稱寫明在測哪一條規格（文件與節）或不變式（dev/invariants.md）。

import { describe, expect, it } from 'vitest'
import type { ContentPack, GameState } from '../../src'
import { ActionBlocked, ContentError, clone } from '../../src'
import { diveOptions, diveView, enter, exit, exitBlock, go, goBlock, netSiteProblems, readDive, sites } from '../../src/features/dive'
import { diveDefProblems } from '../../src/features/dive/model'
import { afterReport, onEnd } from '../../src/features/dive/ops'
import { diveIn, makeDiveGame, makeWorldGame } from '../../src/testkit'

type G = ReturnType<typeof makeDiveGame>['game']
const sys = (g: G, changes: unknown[], action = 'test.set') => g.commit({ kind: 'system', action, location: {}, party: [], timeline: [], changes: changes as never, outcome: { result: 'ok', summary: 't' } })

/** 遞迴凍結：查詢的函式要是偷改了狀態會丟錯（不變式第 1 條）。 */
function deepFreeze<T>(o: T): T {
  if (o && typeof o === 'object' && !Object.isFrozen(o)) {
    Object.freeze(o)
    for (const v of Object.values(o as Record<string, unknown>)) deepFreeze(v)
  }
  return o
}
const frozen = (g: G): GameState => deepFreeze(clone(g.state))

describe('白箱 dive：被強制斷線（CYBERSPACE 2.4 節、第 1 節的表「倒下之後」；dev/adr/0018 第八節）', () => {
  it('戰敗被接受而且 result.located 是 true：標成 located（不是 defeat）', () => {
    const { game } = makeDiveGame({ noDeck: true })
    diveIn(game)
    const d = readDive(game.state)!
    const out = onEnd(game.state, 'defeat', { by: 'netrun' }, 'accept', { net: true, located: true })
    expect(out?.changes[0]).toMatchObject({ op: 'ext', key: 'dive', value: { ...d, over: 'located' } })
    expect(onEnd(game.state, 'defeat', { by: 'netrun' }, 'accept', { net: true })?.changes[0]).toMatchObject({ value: { over: 'defeat' } })
    // 現實的戰敗、不是接受、或已經標過的：不標
    expect(onEnd(game.state, 'defeat', { by: 'netrun' }, 'accept', { net: false })).toBeUndefined()
    expect(onEnd(game.state, 'defeat', { by: 'netrun' }, 'retry', { net: true })).toBeUndefined()
    expect(onEnd(game.state, 'netrun', { by: 'maze' }, 'located', {})).toBeUndefined()
  })

  it('被強制斷線之後的畫面：押金寫 0、提醒寫「押金沒收」、over 帶出來（CYBERSPACE 2.4 節）', () => {
    const { game } = makeDiveGame({ noDeck: true })
    diveIn(game)
    const d = readDive(game.state)!
    expect(d.deck).toBe('rental')
    expect(d.paid?.deposit).toBeGreaterThan(0)
    // 只在一份複本上標 over（真的提交會被 report.after 自動登出）
    const st = clone(game.state)
    st.ext.dive = { ...(st.ext.dive as object), over: 'located' }
    const v = diveView(game.k, st)
    expect(v.dive?.over).toBe('located')
    expect(v.exit).toMatchObject({ refund: 0, note: '被強制斷線了：租用甲板的押金沒收了。' })
    // 去處全部擋下：先登出
    expect(v.sites.length).toBeGreaterThan(0)
    for (const s of v.sites) expect(s.block).toBe('你被強制斷線了：先登出。')
    expect(goBlock(game.k, st, v.sites[0]!.id)).toBe('你被強制斷線了：先登出。')
  })

  it('沒有押金的訪客被斷線：提醒是「回到身體」，退款 0', () => {
    const { game } = makeDiveGame({ noDeck: true })
    // 把租用拿掉：用一份複本當成訪客
    diveIn(game)
    const st = clone(game.state)
    st.ext.dive = { ...(st.ext.dive as object), deck: 'none', paid: undefined }
    const v = diveView(game.k, st)
    expect(v.exit).toMatchObject({ refund: 0, note: '登出之後意識回到身體。' })
    expect(v.dive?.paid).toEqual({ fee: 0, deposit: 0 })
  })

  it('自動登出：回退、rewind 的報告、戰鬥中、還有別的活動時不自動登出（dev/adr/0018 第八節）', () => {
    const { game } = makeDiveGame({ noDeck: true })
    diveIn(game)
    const st = clone(game.state)
    st.ext.dive = { ...(st.ext.dive as object), over: 'defeat' }
    expect(afterReport(game.k, st, 'x.y', true)).toBeUndefined()
    expect(afterReport(game.k, st, 'rewind', false)).toBeUndefined()
    expect(afterReport(game.k, { ...st, battle: {} as never }, 'x.y', false)).toBeUndefined()
    const auto = afterReport(game.k, st, 'x.y', false)!
    expect(auto).toHaveLength(1)
    expect(auto[0]!.action).toBe('dive.exit')
    expect(auto[0]!.outcome.result).toBe('forced')
    // 押金沒收：沒有正的 cash 變更
    expect(auto[0]!.changes.some((c) => c.op === 'cash' && (c as { delta: number }).delta > 0)).toBe(false)
    expect(auto[0]!.outcome.summary).toContain('被沒收了')
    // 沒有被斷線：不自動登出
    expect(afterReport(game.k, game.state, 'x.y', false)).toBeUndefined()
  })

  it('被定位的登出那一句寫「現實的增援找到了接入點」（CYBERSPACE 2.4 節）', () => {
    const { game } = makeDiveGame({ noDeck: true })
    diveIn(game)
    const st = clone(game.state)
    st.ext.dive = { ...(st.ext.dive as object), over: 'located' }
    const auto = afterReport(game.k, st, 'x.y', false)!
    expect(auto[0]!.outcome.summary).toContain('現實的增援找到了接入點')
  })
})

describe('白箱 dive：登出與去處的擋法（CYBERSPACE 2.4 節：身體；dev/work/M3-dive.md）', () => {
  it('戰鬥中登不出：原因寫「戰鬥裡要用拔線」', () => {
    const { game } = makeDiveGame()
    diveIn(game)
    const st = { ...clone(game.state), battle: {} as never }
    expect(exitBlock(game.k, st)).toBe('正在戰鬥：戰鬥裡要用「拔線」離開，打完才能登出。')
    expect(() => exit(game.k, st)).toThrow(ActionBlocked)
  })

  it('沒有潛入：登出、去處都擋下；sites 是空的', () => {
    const { game } = makeDiveGame()
    expect(exitBlock(game.k, game.state)).toBe('你沒有潛入。')
    expect(goBlock(game.k, game.state, 'ns_tw_dig')).toBe('你還沒有潛入。')
    expect(sites(game.k, game.state)).toEqual([])
    expect(() => go(game.k, game.state, 'ns_tw_dig')).toThrow('你還沒有潛入。')
  })

  it('不存在的去處：原因一句；訪客去要甲板的地方：原因寫「你是訪客」', () => {
    const { game } = makeDiveGame({ noDeck: true, patch: { money: { cred: 0, cash: 30 } } })
    // 現金只夠費用、不夠押金：租不起，連訪客都不是——潛不進去
    const o = diveOptions(game.k, game.state)
    expect(o.deck).toBe('rental')
    expect(o.block).toContain('現金不夠')
    expect(o.block).toContain('押金')
    expect(() => enter(game.k, game.state)).toThrow(ActionBlocked)
  })

  it('已經潛入再潛一次：擋下「先登出」', () => {
    const { game } = makeDiveGame()
    diveIn(game)
    expect(diveOptions(game.k, game.state).block).toBe('你已經潛入了：要換個接入點，先登出。')
  })

  it('站在不是潛艙店的地方：沒有接入點（CYBERSPACE 2.2 節）', () => {
    const { game } = makeWorldGame({ seed: 4 })
    const o = diveOptions(game.k, game.state)
    expect(o.here).toBeNull()
    expect(o.block).toContain('這裡沒有接入點')
  })

  it('沒有主角：原因「還沒有主角」', () => {
    const { game } = makeDiveGame()
    const st = { ...clone(game.state), pc: null as never }
    expect(diveOptions(game.k, st).block).toContain('還沒有主角。')
  })

  it('查詢的函式（diveOptions、diveView、sites、goBlock、exitBlock）不改狀態（不變式第 1 條）', () => {
    const { game } = makeDiveGame({ noDeck: true })
    expect(() => diveView(game.k, frozen(game))).not.toThrow()
    diveIn(game)
    const st = frozen(game)
    expect(() => {
      diveOptions(game.k, st); diveView(game.k, st); sites(game.k, st); exitBlock(game.k, st)
      for (const s of sites(game.k, st)) goBlock(game.k, st, s.id)
    }).not.toThrow()
    // 產生草稿的也不改狀態
    expect(() => exit(game.k, st)).not.toThrow()
  })
})

describe('白箱 dive：內容的格式檢查（DATA 第 12 節；dev/work/M3-dive.md）', () => {
  it('diveDefProblems：不是物件、fee／deposit 不是整數、rental 不是字串、safe 超出、多的欄位', () => {
    expect(diveDefProblems(3)).toEqual(['dive 要是 { fee?, rental?, deposit?, safe? }'])
    expect(diveDefProblems({ fee: -1, deposit: 1.5, rental: 3, safe: 4, extra: 1 })).toEqual([
      'dive.fee 要是 0 以上的整數', 'dive.deposit 要是 0 以上的整數', 'dive.rental 要是甲板的 id', 'dive.safe 要是 0～3 的整數',
      'dive.extra 不是這個欄位（fee、rental、deposit、safe）',
    ])
    expect(diveDefProblems({})).toEqual([])
  })

  it('netSiteProblems：desc、setup、by、block 的 marker 與 setup、when 的形狀', () => {
    const base = { name: 'x', need: 'any' }
    expect(netSiteProblems({ ...base, kind: 'netrun', desc: 3, setup: 3, by: 'maze' })).toEqual(['desc 要是一句話', 'setup 要是一個物件', 'by 寫在 setup 裡（setup.by）'])
    expect(netSiteProblems({ ...base, kind: 'block', block: 'b', marker: 3, setup: {} })).toEqual(['marker 要是街區上的標記 id', 'kind 是 block 的不用 setup'])
    expect(netSiteProblems({ ...base, kind: 'block' })).toEqual(['kind 是 block 的要有 block（街區的 id）'])
    expect(netSiteProblems({ ...base, kind: 'netrun', block: 'b' })).toEqual(['block、marker 只給 kind 是 block 的'])
    expect(netSiteProblems({ ...base, kind: 'netrun', setup: { by: 3 } })).toEqual(['setup.by 要是功能的名字（字串）'])
    expect(netSiteProblems({ ...base, kind: 'netrun', when: { x: 1 } })).toEqual(['when 要是一個條件（{ kind, ... }）'])
  })

  it('ready：設施的 dive 寫壞、租的甲板不存在、net_site 指向不存在的街區，整批丟 ContentError', () => {
    const pack: ContentPack = {
      id: 'bad_dive',
      content: {
        facility_type: [{ id: 'fac_bad_pod', name: '壞掉的潛艙店', functions: ['dive'], dive: { fee: -3, rental: 'dk_nowhere' } }],
        net_site: [{ id: 'ns_bad_block', name: '不存在的街', kind: 'block', need: 'any', block: 'nowhere' }],
      } as never,
    }
    let err: unknown
    try { makeWorldGame({ content: [pack] }) } catch (e) { err = e }
    expect(err).toBeInstanceOf(ContentError)
    const msg = String((err as Error).message)
    expect(msg).toContain('facility_type/fac_bad_pod：dive.fee 要是 0 以上的整數')
    expect(msg).toContain('facility_type/fac_bad_pod：dive.rental 的甲板 dk_nowhere 不在內容裡')
    expect(msg).toContain('net_site/ns_bad_block：block nowhere 沒有這塊街區')
  })

  it('readDive：形狀不對當成沒有潛入；壞的 since、safe、paid、over 退回預設', () => {
    expect(readDive({ ext: { dive: { body: {} } } })).toBeNull()
    expect(readDive({ ext: { dive: { body: { location: {} }, access: {} } } })).toBeNull()
    const d = readDive({ ext: { dive: { since: -5, body: { location: { block: 'b' }, at: 3 }, access: { type: 't', safe: -1, facility: 3 }, deck: 'weird', paid: { fee: 'x', deposit: 1 }, over: 'nope' } } })
    expect(d).toEqual({ since: 0, body: { location: { block: 'b' } }, access: { type: 't', safe: 0 }, deck: 'none' })
  })
})

describe('白箱 dive：潛入的入口（CYBERSPACE 2.2、2.3 節）', () => {
  it('付了押金的那份報告摘要寫「押金登出時退」，正文的句子不帶錢的數字（不變式第 126 條：結果句子不帶數字）', () => {
    const { game } = makeDiveGame({ noDeck: true })
    const d = enter(game.k, game.state)
    expect(d.outcome.summary).toMatch(/押金 .*登出時退/)
    for (const line of (d.narration?.results ?? []) as string[]) expect(line).not.toMatch(/\d/)
  })

  it('登出的 usesOf 只在身體躺的那一格列出；潛入前列「潛入（費用）」（dev/work/M3-dive.md）', () => {
    const { game } = makeDiveGame({ noDeck: true })
    expect(game.gridView()!.here.uses.map((u) => [u.id, u.name])).toContainEqual(['dive.enter', expect.stringMatching(/^潛入（/)])
    diveIn(game)
    const uses = game.gridView()!.here.uses
    expect(uses.map((u) => u.id)).toContain('dive.exit')
    expect(uses.find((u) => u.id === 'dive.exit')!.block).toBeNull()
  })
})

void sys
