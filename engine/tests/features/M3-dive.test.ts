// 驗收測試：dev/work/M3-dive.md（cpp-feature）。features/dive：從接入點潛入、在網內選去處、登出（最小版）。
// 規格：CYBERSPACE 2.1～2.4 節（兩種連線、接入點、誰能進、身體）、第 1 節的表、4.1、4.3 節；NETRUNNING 第 3 節；EVENTS 3.3 節；DATA 第 12 節；dev/adr/0018 第八節與 N30。
// 內容是測試自帶的最小假資料：一種帶 dive 的設施（費用 30、租一副 2 槽的甲板、押金 50）、一種沒有租的、一種不帶 dive 的；幾筆 net_site。
// 替身：netrun（一個最小的活動，origin 與 outcome 照真的交回）、deck_rental 與 deck_grade（甲板）、at_facility（城市）、move；最後一組換成真的 deck 功能核對格式。

import { describe, expect, it } from 'vitest'
import type { ContentPack, Feature, GridCtx, MarkerDef, Origin, ReportDraft } from '../../src'
import { ActionBlocked, ContentError, attachActivityEnd, clone, endActivity, toMinutes } from '../../src'
import { deckFeature } from '../../src/features/deck'
import {
  DIVE_ALLOW, DIVE_NET_ONLY, diveFeature, diveOptions, diveView, enter, enterBlock, exit, exitBlock, go, goBlock, inNet, netSiteProblems, readDive, sites,
} from '../../src/features/dive'
import { makeGame } from '../../src/testkit'

type Rec = Record<string, any>

// ===================================================================================================================
// 假資料與替身
// ===================================================================================================================

/** 站在哪個標記上是哪一種設施（替身 at_facility 看這張表）。 */
const TYPE_AT: Record<string, string> = { F1: 'fac_pod', F2: 'fac_shop', F3: 'fac_booth' }
/** 街區在哪一區（替身 move 看這張表）。 */
const DISTRICT_OF: Record<string, string> = { b_street: 'd1', net_harbor: 'net' }
const HOME = { district: 'd1', block: 'b_street' }

const PACK: ContentPack = {
  id: 'dive_test',
  content: {
    facility_type: [
      { id: 'fac_pod', name: '潛艙店', functions: ['rest', 'dive'], dive: { fee: 30, rental: 'dk_rent', deposit: 50, safe: 1 } },
      { id: 'fac_shop', name: '商店', functions: ['buy'] },
      { id: 'fac_booth', name: '網咖隔間', functions: ['dive'], dive: { fee: 5 } },
    ],
    deck: [{ id: 'dk_rent', name: '比賽甲板', slots: 2 }],
    net_site: [
      { id: 'site_sub', name: '一般子網', kind: 'netrun', need: 'rental', setup: { region: 'tiny', grade: 1 } },
      { id: 'site_own', name: '企業環礁的深處', kind: 'netrun', need: 'deck', setup: { region: 'tiny', grade: 2, by: 'maze' } },
      { id: 'site_harbor', name: '港灣', kind: 'block', need: 'any', block: 'net_harbor', marker: 'E1' },
      { id: 'site_secret', name: '暗門', kind: 'netrun', need: 'any', setup: { region: 'tiny', grade: 1 }, when: { kind: 'flag', key: 'knows_secret' } },
    ],
  } as unknown as ContentPack['content'],
}

interface StubOpts {
  /** 登記 move（城市的功能） */
  move?: boolean
  /** 登記 at_facility（城市的功能） */
  city?: boolean
  /** 登記 deck_rental、deck_grade 與 deck 內容種類（甲板的功能；要換成真的就給 false） */
  deck?: boolean
  /** 登記 netrun 活動 */
  netrun?: boolean
}

const STUB_ID = 'dive_test_stubs'
function stubs(o: StubOpts = {}): Feature {
  return {
    id: STUB_ID,
    install(k) {
      const city = o.city !== false
      const deck = o.deck !== false
      k.content.defineKind({ kind: 'facility_type', owner: STUB_ID, validate: (e) => (typeof e.name === 'string' ? [] : ['要有 name']) })
      if (city) {
        k.conditions.register<{ kind: 'at_facility'; types?: string[] }>({
          kind: 'at_facility', owner: STUB_ID, validate: () => [],
          test: (c, { state }) => {
            const type = TYPE_AT[state.location.facility ?? '']
            return !!type && (!c.types || c.types.includes(type))
          },
        })
      }
      if (deck) {
        k.content.defineKind({ kind: 'deck', owner: STUB_ID, validate: (e) => (typeof e.name === 'string' ? [] : ['要有 name']) })
        k.stats.defineStat({ id: 'deck_grade', owner: STUB_ID, name: '甲板等級', base: (s, a) => (s.actors[a]?.ext.owndeck ? 3 : (s.actors[a]?.ext.deck as { rental?: unknown } | undefined)?.rental ? 1 : 0) })
        k.effects.register<{ kind: 'deck_rental'; deck: string | null }>({
          kind: 'deck_rental', owner: STUB_ID, ai: false,
          validate: (raw) => (raw.deck === null || typeof raw.deck === 'string' ? [] : ['deck 要是甲板的 id 或 null']),
          toChanges: (e, ctx) => [{ op: 'actor.ext', id: ctx.actor, key: 'deck', value: e.deck === null ? {} : { rental: { deck: e.deck } } }],
          describe: (e) => (e.deck === null ? '收回了租來的甲板' : '租用甲板'),
        })
      }
      if (o.move !== false) {
        k.effects.register<{ kind: 'move'; block: string; at?: string }>({
          kind: 'move', owner: STUB_ID,
          validate: (raw) => (typeof raw.block === 'string' && DISTRICT_OF[raw.block] ? [] : ['沒有這塊街區']),
          toChanges: (e) => [{ op: 'location', to: { district: DISTRICT_OF[e.block], block: e.block, ...(e.at ? { facility: e.at } : {}) } }],
          describe: (e) => `前往：${e.block}`,
        })
      }
      if (o.netrun !== false) {
        // 最小的網內行程：state.ext.stubnet；放行的清單照真的 netrun（沒有 commit:dive.，所以行程中選不了別的去處、也不能登出）
        k.activity.define({
          kind: 'netrun', owner: STUB_ID, order: 50,
          active: (s) => (s.ext.stubnet ? { id: 'sn1', label: '網內的一趟' } : null),
          allow: ['commit:netrun.', 'commit:defeat.', 'grid.', 'battle.', 'commit:battle.', 'commit:dive.mark'],
          reason: () => '正在網內：只能做網內的事。',
          start: (_k, state, setup, origin) => [{
            kind: 'netrun', action: 'netrun.enter', location: clone(state.location), party: [], timeline: [],
            changes: [{ op: 'ext', key: 'stubnet', value: { origin, setup } }], outcome: { result: 'entered', summary: '潛進了一座子網。' },
          }],
        })
      }
    },
  }
}

const stubOf = (g: G): { origin: Origin; setup: Rec } | undefined => g.state.ext.stubnet as never

/** 替身 netrun 交回結果：發 activity.end（kind netrun、origin 是開它的人），清掉狀態。 */
function stubEnd(g: G, outcome: string): ReportDraft {
  const st = stubOf(g)!
  const end = endActivity(g.k, { state: g.state, kind: 'netrun', id: 'sn1', origin: st.origin, outcome, result: {} })
  return attachActivityEnd({
    kind: 'netrun', action: 'netrun.end', location: clone(g.state.location), party: [], timeline: [],
    changes: [...end.changes, { op: 'ext', key: 'stubnet', value: null }], outcome: { result: outcome, summary: `這一趟結束了（${outcome}）。` },
  }, end)
}

/** 替身的戰敗被接受：發 activity.end（kind defeat、outcome accept）。 */
function stubDefeat(g: G, result: Rec = { net: true }): ReportDraft {
  const end = endActivity(g.k, { state: g.state, kind: 'defeat', id: 'b1', origin: { by: 'netrun', ext: { net: { run: 'sn1' } } }, outcome: 'accept', result })
  return attachActivityEnd({
    kind: 'event', action: 'defeat.accept', location: clone(g.state.location), party: [], timeline: [],
    changes: [...end.changes, { op: 'ext', key: 'stubnet', value: null }], outcome: { result: 'accepted', summary: '你接受了這個結果。' },
  }, end)
}

interface Opts extends StubOpts {
  cash?: number
  bridge?: boolean
  owndeck?: boolean
  /** 站在哪個標記上（F1 潛艙店、F2 商店、F3 網咖隔間；null 是不在設施上） */
  at?: string | null
  conditions?: Array<{ id: string; until?: number }>
  more?: Feature[]
  content?: ContentPack[]
}
type G = ReturnType<typeof makeGame>['game']

function setup(o: Opts = {}): G {
  const { game } = makeGame({
    seed: 5, features: [stubs(o), diveFeature, ...(o.more ?? [])], content: o.content ?? [PACK],
    pc: { ext: { ...(o.bridge === false ? {} : { bridge: { sensitivity: 40, tolerance: 20, craving: 10, docility: 0 } }), ...(o.owndeck ? { owndeck: 1 } : {}) }, conditions: o.conditions ?? [] },
    patch: { money: { cred: 0, cash: o.cash ?? 200 }, location: { ...HOME, ...(o.at === null ? {} : { facility: o.at ?? 'F1' }) } },
  })
  return game
}

const cash = (g: G): number => g.state.money.cash
const pc = (g: G) => g.state.actors.pc!
const dive = (g: G) => readDive(g.state)
const commit = (g: G, d: ReportDraft) => g.commit(d)
const diveIn = (g: G): void => void g.commit(enter(g.k, g.state))
const lastReport = (g: G) => g.state.reports[g.state.reports.length - 1]!
const reportActions = (g: G): string[] => g.state.reports.map((r) => r.action ?? '')

// ===================================================================================================================

describe('潛入的條件（diveOptions）', () => {
  it('站在潛艙店、有橋、現金夠：能潛入，費用與租用的甲板寫出來', () => {
    const g = setup()
    const o = diveOptions(g.k, g.state)
    expect(o.ok).toBe(true)
    expect(o.block).toBeNull()
    expect(o.here).toMatchObject({ type: 'fac_pod', name: '潛艙店', fee: 30, deposit: 50, safe: 1, rental: { deck: 'dk_rent', name: '比賽甲板' } })
    expect(o).toMatchObject({ deck: 'rental', fee: 30, deposit: 50, cost: 80 })
    expect(enterBlock(g.k, g.state)).toBeNull()
  })

  it('不在那種設施上：不行，原因一句（不在設施上、在商店裡都一樣）', () => {
    for (const at of [null, 'F2']) {
      const g = setup({ at })
      const o = diveOptions(g.k, g.state)
      expect(o.ok).toBe(false)
      expect(o.here).toBeNull()
      expect(o.blocks).toHaveLength(1)
      expect(o.blocks[0]).toContain('接入點')
      expect(() => enter(g.k, g.state)).toThrow(ActionBlocked)
    }
  })

  it('沒有橋、帶著 net_burn、錢不夠：各一句', () => {
    const noBridge = diveOptions(setup({ bridge: false }).k, setup({ bridge: false }).state)
    expect(noBridge.blocks).toHaveLength(1)
    expect(noBridge.blocks[0]).toContain('橋')

    const burnt = setup({ conditions: [{ id: 'net_burn' }] })
    const b = diveOptions(burnt.k, burnt.state)
    expect(b.blocks).toHaveLength(1)
    expect(b.blocks[0]).toContain('燒傷')
    // 過期的不算
    const old = setup({ conditions: [{ id: 'net_burn', until: toMinutes(burnt.state.time) - 1 }] })
    expect(diveOptions(old.k, old.state).ok).toBe(true)

    const poor = setup({ cash: 79 })
    const p = diveOptions(poor.k, poor.state)
    expect(p.blocks).toHaveLength(1)
    expect(p.blocks[0]).toContain('現金不夠')
    expect(() => enter(poor.k, poor.state)).toThrow(/現金不夠/)
    expect(cash(poor)).toBe(79)
  })

  it('有自己的甲板的人只要付費用：80 變 30，不收押金', () => {
    const rich = setup({ owndeck: true, cash: 30 })
    expect(diveOptions(rich.k, rich.state)).toMatchObject({ ok: true, deck: 'own', cost: 30, deposit: 0 })
    expect(diveOptions(setup({ owndeck: true, cash: 29 }).k, setup({ owndeck: true, cash: 29 }).state).ok).toBe(false)
  })

  it('沒有人登記 at_facility（城市的功能沒裝）：沒有接入點；沒有 deck_rental：不租、當訪客', () => {
    const noCity = setup({ city: false })
    expect(diveOptions(noCity.k, noCity.state).here).toBeNull()
    // 甲板的功能沒裝（只有 deck 這個內容種類，沒有 deck_rental 效果與 deck_grade）：租不出來，當訪客，只付費用
    const noRental = setup({ deck: false, more: [{ id: 'deck_kind_only', install: (k) => k.content.defineKind({ kind: 'deck', owner: 'deck_kind_only', validate: () => [] }) }] })
    expect(diveOptions(noRental.k, noRental.state)).toMatchObject({ ok: true, deck: 'none', cost: 30, deposit: 0 })
    expect(diveOptions(noRental.k, noRental.state).here!.rental).toBeUndefined()
  })

  it('潛入之後再問：說已經潛入了', () => {
    const g = setup()
    diveIn(g)
    const o = diveOptions(g.k, g.state)
    expect(o.ok).toBe(false)
    expect(o.diving).toBe(true)
    expect(o.block).toContain('已經潛入')
  })
})

describe('潛入', () => {
  it('沒有甲板的主角：現金少 80、租了甲板、狀態記著身體的位置、報告帶 login', () => {
    const g = setup()
    const before = clone(g.state.location)
    const reports = commit(g, enter(g.k, g.state))
    expect(cash(g)).toBe(120)
    expect(pc(g).ext.deck).toEqual({ rental: { deck: 'dk_rent' } })
    expect(g.k.stats.stat(g.state, 'pc', 'deck_grade')).toBeGreaterThan(0)
    expect(dive(g)).toMatchObject({
      body: { location: before, at: 'F1' }, access: { facility: 'F1', type: 'fac_pod', safe: 1, name: '潛艙店' }, deck: 'rental', paid: { fee: 30, deposit: 50 },
    })
    expect(dive(g)!.since).toBe(toMinutes(g.state.time))
    expect(reports[0]!.action).toBe('dive.enter')
    expect(reports[0]!.triggers).toEqual([{ point: 'login', where: { district: 'd1', block: 'b_street', facility: 'F1' } }])
    expect(g.k.activity.active(g.state).map((a) => a.kind)).toContain('dive')
  })

  it('有自己甲板的主角：只少 30，不租', () => {
    const g = setup({ owndeck: true })
    diveIn(g)
    expect(cash(g)).toBe(170)
    expect(pc(g).ext.deck).toBeUndefined()
    expect(dive(g)).toMatchObject({ deck: 'own', paid: { fee: 30, deposit: 0 } })
  })

  it('訪客：設施沒有租的甲板，只付費用，狀態是 none', () => {
    const g = setup({ at: 'F3' })
    diveIn(g)
    expect(cash(g)).toBe(195)
    expect(dive(g)).toMatchObject({ deck: 'none', access: { type: 'fac_booth', safe: 0 } })
    expect(dive(g)!.paid).toEqual({ fee: 5, deposit: 0 })
  })

  it('報告給正文用的句子不帶機制的數字', () => {
    const g = setup()
    const r = commit(g, enter(g.k, g.state))[0]!
    for (const line of r.narration?.results ?? []) expect(line).not.toMatch(/\d/)
  })

  it('不成立時整步不動（現金、甲板、狀態都沒變）', () => {
    const g = setup({ cash: 10 })
    expect(() => commit(g, enter(g.k, g.state))).toThrow(ActionBlocked)
    expect(cash(g)).toBe(10)
    expect(dive(g)).toBeNull()
  })

  it('也可以用 Game.launch(dive) 開（活動的 start）', () => {
    const g = setup()
    g.launch('dive', {})
    expect(dive(g)).not.toBeNull()
    expect(cash(g)).toBe(120)
  })
})

describe('潛入中現實的事做不了（白名單）', () => {
  it('替身的 rest.、transit.、fixer. 報告被擋，原因一句；清單上的放行', () => {
    const g = setup()
    diveIn(g)
    const why = '你的意識在網內，身體躺在潛艙店。先登出。'
    for (const doing of ['commit:rest.sleep', 'commit:rest.breath', 'commit:transit.board', 'commit:fixer.accept', 'commit:commission.start', 'commit:work.shift', 'commit:deck.equip', 'commit:bills.pay']) {
      expect(g.blockOf(doing), doing).toBe(why)
    }
    // 腳下是現實的街（身體躺的那個地方）：走格子、世界的移動、交易、對話都擋下，原因是先登出（B024）
    for (const doing of ['grid.move', 'commit:grid.move', 'commit:world.go', 'commit:trade.checkout', 'commit:npc.talk']) {
      expect(g.blockOf(doing), doing).toBe(why)
    }
    for (const doing of [
      'commit:dive.go', 'netrun.start', 'commit:netrun.use', 'commit:maze.enter', 'battle.start', 'commit:battle.act', 'chain:battle_end', 'battle.retry',
      'event.start', 'commit:event.choose', 'commit:defeat.accept', 'scene.start', 'commit:scene.end', 'commit:deck.skin', 'chain:free_action',
    ]) {
      expect(g.blockOf(doing), doing).toBeNull()
    }
    // 清單本身（驗收條件守著它）
    expect(DIVE_ALLOW).toContain('commit:dive.')
    expect(DIVE_ALLOW).toContain('commit:deck.skin')
    expect(DIVE_ALLOW.some((p) => p.startsWith('commit:rest'))).toBe(false)
  })

  it('沒有潛入的時候不擋', () => {
    const g = setup()
    expect(g.blockOf('commit:rest.sleep')).toBeNull()
  })
})

describe('去處（sites）', () => {
  it('租用甲板的人看得到兩筆（要自己的甲板那一筆灰掉並有原因）；when 不成立的不列', () => {
    const g = setup()
    expect(sites(g.k, g.state)).toEqual([])
    diveIn(g)
    const rows = sites(g.k, g.state)
    expect(rows.map((r) => r.id)).toEqual(['site_sub', 'site_own', 'site_harbor'])
    expect(rows.find((r) => r.id === 'site_sub')!.block).toBeNull()
    expect(rows.find((r) => r.id === 'site_own')!.block).toMatch(/自己的甲板.*租來的/)
    expect(rows.find((r) => r.id === 'site_harbor')!.block).toBeNull()
    expect(goBlock(g.k, g.state, 'site_own')).toMatch(/自己的甲板/)
    expect(() => go(g.k, g.state, 'site_own')).toThrow(ActionBlocked)
  })

  it('自己有甲板的人哪裡都去得了；訪客只去得了 any 的；when 成立了就列出來', () => {
    const own = setup({ owndeck: true })
    diveIn(own)
    expect(sites(own.k, own.state).every((r) => r.block === null)).toBe(true)
    commit(own, { kind: 'system', action: 'dive.flag', location: {}, party: [], timeline: [], changes: [{ op: 'flag', key: 'knows_secret', value: true }], outcome: { result: 'ok', summary: '知道了暗門。' } })
    expect(sites(own.k, own.state).map((r) => r.id)).toContain('site_secret')

    const guest = setup({ at: 'F3' })
    diveIn(guest)
    const rows = sites(guest.k, guest.state)
    expect(rows.find((r) => r.id === 'site_sub')!.block).toMatch(/訪客/)
    expect(rows.find((r) => r.id === 'site_own')!.block).toMatch(/訪客/)
    expect(rows.find((r) => r.id === 'site_harbor')!.block).toBeNull()
  })

  it('沒有人登記 move：網內的街區灰掉；沒有 netrun 活動：子網灰掉', () => {
    const g = setup({ move: false, netrun: false })
    diveIn(g)
    const rows = sites(g.k, g.state)
    expect(rows.find((r) => r.id === 'site_harbor')!.block).toMatch(/還走不進去/)
    expect(rows.find((r) => r.id === 'site_sub')!.block).toMatch(/還沒有接上/)
  })

  it('一趟行程進行中去不了別的地方', () => {
    const g = setup()
    diveIn(g)
    commit(g, go(g.k, g.state, 'site_sub'))
    expect(sites(g.k, g.state).every((r) => r.block !== null)).toBe(true)
  })
})

describe('選去處（go）與那一趟結束', () => {
  it('go 開了替身的 netrun：origin.by 是 dive、setup 原樣交過去', () => {
    const g = setup()
    diveIn(g)
    const reports = commit(g, go(g.k, g.state, 'site_sub'))
    expect(reports.map((r) => r.action)).toEqual(['dive.go', 'netrun.enter'])
    expect(stubOf(g)!.origin).toMatchObject({ by: 'dive', ref: 'site_sub' })
    expect(stubOf(g)!.setup).toEqual({ region: 'tiny', grade: 1 })
  })

  it('setup 寫了 by 的，交給那個功能接手（origin.by 是它）', () => {
    const g = setup({ owndeck: true })
    diveIn(g)
    commit(g, go(g.k, g.state, 'site_own'))
    expect(stubOf(g)!.origin.by).toBe('maze')
    // origin.by 不是 dive 的，被定位也不由這裡登出
    commit(g, stubEnd(g, 'located'))
    expect(dive(g)).not.toBeNull()
    expect(dive(g)!.over).toBeUndefined()
  })

  it('交回 left 之後還在潛入中，可以再去；done 也是', () => {
    const g = setup()
    diveIn(g)
    for (const outcome of ['left', 'done']) {
      commit(g, go(g.k, g.state, 'site_sub'))
      expect(exitBlock(g.k, g.state)).toMatch(/網內的一趟/)
      commit(g, stubEnd(g, outcome))
      expect(dive(g)).not.toBeNull()
      expect(dive(g)!.over).toBeUndefined()
      expect(stubOf(g)).toBeUndefined()
      expect(goBlock(g.k, g.state, 'site_sub')).toBeNull()
    }
    expect(cash(g)).toBe(120)
  })

  it('交回 located 之後自動登出：位置回去、甲板收回、押金沒退、報告帶 logout', () => {
    const g = setup()
    diveIn(g)
    const before = clone(g.state.location)
    commit(g, go(g.k, g.state, 'site_sub'))
    const reports = commit(g, stubEnd(g, 'located'))
    expect(reports.map((r) => r.action)).toEqual(['netrun.end', 'dive.exit'])
    expect(dive(g)).toBeNull()
    expect(g.k.activity.active(g.state).map((a) => a.kind)).not.toContain('dive')
    expect(g.state.location).toEqual(before)
    expect(pc(g).ext.deck).toEqual({})
    expect(g.k.stats.stat(g.state, 'pc', 'deck_grade')).toBe(0)
    expect(cash(g)).toBe(120)
    const out = reports[1]!
    expect(out.triggers).toEqual([{ point: 'logout', where: { district: 'd1', block: 'b_street', facility: 'F1' } }])
    expect(out.outcome.result).toBe('forced')
    expect(out.outcome.summary).toContain('沒收')
    for (const line of out.narration?.results ?? []) expect(line).not.toMatch(/\d/)
  })

  it('網內的戰敗被接受之後也自動登出、押金沒收；不是網內的戰敗不管', () => {
    const g = setup()
    diveIn(g)
    commit(g, go(g.k, g.state, 'site_sub'))
    const reports = commit(g, stubDefeat(g))
    expect(reports.map((r) => r.action)).toEqual(['defeat.accept', 'dive.exit'])
    expect(dive(g)).toBeNull()
    expect(cash(g)).toBe(120)

    const h = setup()
    diveIn(h)
    commit(h, go(h.k, h.state, 'site_sub'))
    commit(h, stubDefeat(h, { net: false }))
    expect(dive(h)).not.toBeNull()
    expect(dive(h)!.over).toBeUndefined()
  })

  it('等手上的事做完才登出：標了強制斷線但還有別的活動時先不登出', () => {
    const g = setup()
    diveIn(g)
    commit(g, go(g.k, g.state, 'site_sub'))
    // 標成被強制斷線，但行程還沒收（模擬戰敗之後還有別的活動）：不自動登出
    commit(g, { kind: 'system', action: 'dive.mark', location: {}, party: [], timeline: [], changes: [{ op: 'ext', key: 'dive', value: { ...clone(dive(g)!), over: 'defeat' } }], outcome: { result: 'ok', summary: '標記。' } })
    expect(dive(g)!.over).toBe('defeat')
    expect(reportActions(g)).not.toContain('dive.exit')
    // 行程結束之後自動接上
    commit(g, stubEnd(g, 'left'))
    expect(dive(g)).toBeNull()
    expect(lastReport(g).action).toBe('dive.exit')
  })

  it('kind 是 block 的：用 move 把人放過去；登出時放回身體的位置', () => {
    const g = setup()
    diveIn(g)
    const before = clone(g.state.location)
    commit(g, go(g.k, g.state, 'site_harbor'))
    expect(g.state.location).toMatchObject({ district: 'net', block: 'net_harbor', facility: 'E1' })
    expect(exitBlock(g.k, g.state)).toBeNull()
    commit(g, exit(g.k, g.state))
    expect(g.state.location).toEqual(before)
    expect(dive(g)).toBeNull()
  })
})

describe('腳下是網內還是現實（B024）', () => {
  it('身體躺著、腳下還是現實的街：走格子、世界的移動、交易、對話都擋下，原因是先登出；選了網內的街區之後這幾樣放行；登出之後又擋回來（沒潛入不擋）', () => {
    const g = setup()
    const why = '你的意識在網內，身體躺在潛艙店。先登出。'
    diveIn(g)
    for (const doing of DIVE_NET_ONLY) expect(g.blockOf(`${doing}x`), doing).toBe(why)
    expect(inNet(g.k, g.state)).toBe(false)
    commit(g, go(g.k, g.state, 'site_harbor'))
    expect(inNet(g.k, g.state)).toBe(true)
    for (const doing of DIVE_NET_ONLY) expect(g.blockOf(`${doing}x`), doing).toBeNull()
    // 網內的街區裡現實的事照樣做不了
    expect(g.blockOf('commit:rest.sleep')).toBe(why)
    commit(g, exit(g.k, g.state))
    for (const doing of DIVE_NET_ONLY) expect(g.blockOf(`${doing}x`), doing).toBeNull()
  })

  it('成人場景放行（M3 修正批：網內放行所有成人場景）：scene.start 與 commit:scene. 在現實的街上潛入中也不擋', () => {
    const g = setup()
    diveIn(g)
    expect(g.blockOf('scene.start')).toBeNull()
    expect(g.blockOf('commit:scene.end')).toBeNull()
    expect(DIVE_ALLOW).toContain('scene.start')
    expect(DIVE_ALLOW).toContain('commit:scene.')
  })
})

describe('登出', () => {
  it('位置回到潛入前、deck_rental 收回、押金退回、報告帶 logout', () => {
    const g = setup()
    diveIn(g)
    expect(cash(g)).toBe(120)
    const before = clone(g.state.location)
    const reports = commit(g, exit(g.k, g.state))
    expect(reports[0]!.action).toBe('dive.exit')
    expect(reports[0]!.triggers).toEqual([{ point: 'logout', where: { district: 'd1', block: 'b_street', facility: 'F1' } }])
    expect(g.state.location).toEqual(before)
    expect(pc(g).ext.deck).toEqual({})
    expect(g.k.stats.stat(g.state, 'pc', 'deck_grade')).toBe(0)
    expect(cash(g)).toBe(170)
    expect(dive(g)).toBeNull()
    expect(reports[0]!.outcome.summary).toContain('退回')
    // 費用不退：只退押金，一共花了 30
    expect(200 - cash(g)).toBe(30)
  })

  it('自己有甲板的登出：不碰自己的甲板、沒有押金可退', () => {
    const g = setup({ owndeck: true })
    diveIn(g)
    commit(g, exit(g.k, g.state))
    expect(cash(g)).toBe(170)
    expect(pc(g).ext.owndeck).toBe(1)
  })

  it('一趟行程進行中登出被擋；沒有潛入也不能登出', () => {
    const g = setup()
    expect(() => exit(g.k, g.state)).toThrow('你沒有潛入')
    diveIn(g)
    commit(g, go(g.k, g.state, 'site_sub'))
    expect(exitBlock(g.k, g.state)).toContain('先把它做完')
    expect(() => exit(g.k, g.state)).toThrow(ActionBlocked)
    expect(dive(g)).not.toBeNull()
  })

  it('沒有人登記 move 也能登出（位置沒動就不用放回去）', () => {
    const g = setup({ move: false })
    diveIn(g)
    const before = clone(g.state.location)
    commit(g, exit(g.k, g.state))
    expect(g.state.location).toEqual(before)
    expect(dive(g)).toBeNull()
  })

  it('登出之後可以再潛入（狀態乾淨）', () => {
    const g = setup()
    diveIn(g)
    commit(g, exit(g.k, g.state))
    diveIn(g)
    expect(dive(g)).toMatchObject({ deck: 'rental', paid: { fee: 30, deposit: 50 } })
    expect(cash(g)).toBe(170 - 80)
  })
})

describe('存檔與畫面', () => {
  it('存檔再讀，潛入的狀態一樣；讀回來還能去、能登出', () => {
    const a = setup()
    diveIn(a)
    const raw = a.save()
    const b = setup({ cash: 999 })
    expect(b.load(raw)).toBeNull()
    expect(readDive(b.state)).toEqual(readDive(a.state))
    expect(b.state.ext.dive).toEqual(a.state.ext.dive)
    expect(b.k.activity.active(b.state).map((x) => x.kind)).toContain('dive')
    expect(b.blockOf('commit:rest.sleep')).toBe('你的意識在網內，身體躺在潛艙店。先登出。')
    commit(b, go(b.k, b.state, 'site_sub'))
    commit(b, stubEnd(b, 'left'))
    commit(b, exit(b.k, b.state))
    expect(dive(b)).toBeNull()
    expect(cash(b)).toBe(170)
  })

  it('潛入中被強制斷線的狀態也存得下來', () => {
    const a = setup()
    diveIn(a)
    commit(a, go(a.k, a.state, 'site_sub'))
    commit(a, { kind: 'system', action: 'dive.mark', location: {}, party: [], timeline: [], changes: [{ op: 'ext', key: 'dive', value: { ...clone(dive(a)!), over: 'located' } }], outcome: { result: 'ok', summary: '標記。' } })
    const b = setup()
    expect(b.load(a.save())).toBeNull()
    expect(readDive(b.state)!.over).toBe('located')
  })

  it('diveView：沒潛入時是這裡能不能潛，潛入中是去處與登出', () => {
    const g = setup()
    const v0 = diveView(g.k, g.state)
    expect(v0.diving).toBe(false)
    expect(v0.options.ok).toBe(true)
    expect(v0.dive).toBeNull()
    expect(v0.sites).toEqual([])
    diveIn(g)
    const v1 = diveView(g.k, g.state)
    expect(v1.diving).toBe(true)
    expect(v1.dive).toMatchObject({ name: '潛艙店', type: 'fac_pod', safe: 1, deck: 'rental', paid: { fee: 30, deposit: 50 }, body: { district: 'd1', block: 'b_street', facility: 'F1' } })
    expect(v1.sites).toHaveLength(3)
    expect(v1.exit).toMatchObject({ block: null, refund: 50 })
  })

  it('格子：站在潛艙店列「潛入」（灰掉時有原因）、潛入中站在身體那一格列「登出」', () => {
    const g = setup()
    const marker = { id: 'F1', at: [1, 1], mark: 'F', name: '潛艙店' } as unknown as MarkerDef
    const ctx = (): GridCtx => ({ k: g.k, state: g.state, map: { kind: 'block' } } as unknown as GridCtx)
    expect(g.k.grid.listUses(ctx(), marker)).toEqual([{ id: 'dive.enter', name: '潛入（80）', block: null }])
    // 站在別的標記上不列
    expect(g.k.grid.listUses(ctx(), { ...marker, id: 'F9' })).toEqual([])
    // 網內的地圖不列
    expect(g.k.grid.listUses({ ...ctx(), map: { kind: 'subnet' } } as unknown as GridCtx, marker)).toEqual([])
    diveIn(g)
    expect(g.k.grid.listUses(ctx(), marker)).toEqual([{ id: 'dive.exit', name: '登出', block: null }])
    const poor = setup({ cash: 1 })
    const gray = poor.k.grid.listUses({ k: poor.k, state: poor.state, map: { kind: 'block' } } as unknown as GridCtx, marker)
    expect(gray[0]!.block).toContain('現金不夠')
  })
})

describe('內容的格式', () => {
  it('net_site 的格式問題', () => {
    expect(netSiteProblems({ name: 'x', kind: 'netrun', need: 'any' })).toEqual([])
    expect(netSiteProblems({ name: 'x', kind: 'block', need: 'deck', block: 'b', marker: 'E1' })).toEqual([])
    expect(netSiteProblems({ kind: 'netrun', need: 'any' })).toHaveLength(1)
    expect(netSiteProblems({ name: 'x', kind: 'dungeon', need: 'any' })).toHaveLength(1)
    expect(netSiteProblems({ name: 'x', kind: 'netrun', need: 'vip' })).toHaveLength(1)
    expect(netSiteProblems({ name: 'x', kind: 'block', need: 'any' })).toHaveLength(1)
    expect(netSiteProblems({ name: 'x', kind: 'netrun', need: 'any', block: 'b' })).toHaveLength(1)
    expect(netSiteProblems({ name: 'x', kind: 'netrun', need: 'any', when: 'oops' })).toHaveLength(1)
    expect(netSiteProblems({ name: 'x', kind: 'netrun', need: 'any', setup: { by: 3 } })).toHaveLength(1)
  })

  it('壞的 net_site 載不進去；設施種類的 dive 欄位壞了、租的甲板不存在、when 的條件不存在，整批擋下', () => {
    const bad = (content: Rec): ContentPack => ({ id: 'bad', content: { ...(PACK.content as Rec), ...content } as never })
    expect(() => setup({ content: [bad({ net_site: [{ id: 's', name: 'x', kind: 'netrun', need: 'nope' }] })] })).toThrow()
    expect(() => setup({ content: [bad({ facility_type: [{ id: 'fac_pod', name: '潛艙店', functions: ['dive'], dive: { safe: 9 } }] })] })).toThrow(ContentError)
    expect(() => setup({ content: [bad({ facility_type: [{ id: 'fac_pod', name: '潛艙店', functions: ['dive'], dive: { rental: 'dk_nope' } }] })] })).toThrow(/dk_nope/)
    expect(() => setup({ content: [bad({ net_site: [{ id: 's', name: 'x', kind: 'netrun', need: 'any', when: { kind: 'no_such_condition' } }] })] })).toThrow(ContentError)
  })
})

describe('接上真的 deck 功能（deck_rental 與 deck_grade 的格式對得上）', () => {
  const REAL: ContentPack = {
    id: 'dive_real_deck',
    content: {
      ...(PACK.content as Rec),
      deck: [{ id: 'dk_rent', name: '比賽甲板', desc: '館方租給訪客的比賽甲板。', grade: 1, slots: 2, firewall: 8, legal: 'free', cooling: 1 }],
    } as never,
  }
  const realSetup = (): G => setup({ deck: false, more: [deckFeature], content: [REAL] })

  it('潛入租到真的甲板（等級、槽數都有）、登出收回', () => {
    const g = realSetup()
    expect(g.k.stats.stat(g.state, 'pc', 'deck_grade')).toBe(0)
    diveIn(g)
    expect(g.k.stats.stat(g.state, 'pc', 'deck_grade')).toBe(1)
    expect(g.k.stats.stat(g.state, 'pc', 'deck_slots')).toBe(2)
    expect(sites(g.k, g.state).find((r) => r.id === 'site_sub')!.block).toBeNull()
    commit(g, exit(g.k, g.state))
    expect(g.k.stats.stat(g.state, 'pc', 'deck_grade')).toBe(0)
    expect(cash(g)).toBe(170)
  })
})
