// M3 白箱修正批（dev/work/M3-fix-whitebox.md；使用者 2026-11-25 裁決「都照建議」）：B025～B029 與四個小項的完整情境。
// B025～B029 各自最小的重現在 tests/features/B025～B029-*.test.ts；這一份補它們沒有走到的情境與分支：
//   B026 開戰時追蹤度在 90、99、100 的差別；B028 重創記是哪一件、帶進下一場、三種修好（睡一覺、付錢修、當場除錯）與壞掉的資料；B029 分幾次過的時間、重新增加時重新起算；
//   潛入中換腳本（DIVE_ALLOW）；煙霧彈的目標是雙方的格子（現實與內海的腳本）；追蹤度升了沒跨門檻不再多發 netrun.trace 報告（peak 併進該步的報告）。

import { describe, expect, it } from 'vitest'
import type { BattleUnit, ContentPack, Game, GridCtx, MarkerDef } from '../../src'
import { BattleBlocked, BattleRun, advance, clone, createKernel, effectCtx, meterOf, readyFeatures, setupBattle } from '../../src'
import { DIVE_ALLOW, go as diveGo } from '../../src/features/dive'
import { BROKEN_CONDITION, BROKEN_EXT, breakOne, fixOne, netcombatFeature, repairBlock, repairDraft, repairRows } from '../../src/features/netcombat'
import { brokenOf, carryOf, netcombatRules, ruleProblems } from '../../src/features/netcombat/model'
import { readRun } from '../../src/features/netrun'
import { diveIn, laceUnit, makeDiveGame, makeNetBattleGame, makeState, netAvatar } from '../../src/testkit'
import { scriptsDraft } from '../../src/features/deck'

type G = ReturnType<typeof makeNetBattleGame>['game']
type Rec = Record<string, unknown>

const sys = (g: Game, action: string, changes: unknown[]) => g.commit({ kind: 'system', action, location: {}, party: [], timeline: [], changes: changes as never, outcome: { result: 'ok', summary: 't' } })
const conds = (g: Game, actor = 'pc') => g.state.actors[actor]!.conditions.map((c) => c.id)
const extOf = (g: Game, actor = 'pc') => g.state.actors[actor]!.ext[BROKEN_EXT]

// ---------------------------------------------------------------------------------------------
// B026：開戰時追蹤度已經在上限

const JAM = (['weapon', 'defense', 'tool'] as const).map((s) => ({ id: `jam_${s}`, name: s, desc: `${s}。`, until: 'own_turn_end', turns: 1, kind: 'debuff' }))
const NET = { sync: 'standard', sync_max: 'standard', broken: [] as string[] }

/** 一對一的內海戰鬥（裝 netcombat），開戰時 field.trace = trace；雙方感載上限 999，一直輪到第 rounds 輪。 */
function battleAt(trace: number, rounds: number): BattleRun {
  const k = createKernel([netcombatFeature])
  k.content.loadPack({ id: 'fw_b026', content: { battle_status: JAM } } as unknown as ContentPack)
  readyFeatures(k)
  const state = makeState()
  const unit = (u: unknown) => ({ from: 'unit', unit: u as Rec })
  const setup = {
    mode: 'net', grade: 1, cover: { ally: [0, 0, 0, 0], foe: [0, 0, 0, 0] }, field: { trace },
    allies: [unit(netAvatar(0, 1, { control: 'ai', load: { now: 0, max: 999 }, ext: { net: NET } } as never))],
    foes: [unit(laceUnit('minion', 1, { load: { now: 0, max: 999 }, ext: { net: NET } } as never))],
  }
  const battle = clone(setupBattle(k, state, setup as never).battle)
  state.battle = battle
  const run = new BattleRun(k, state, battle)
  for (let guard = 0; guard < 400 && run.battle.round < rounds && !run.over; guard++) advance(run)
  return run
}

describe('B026：開戰時追蹤度在 90、99、100 的定位倒數（CYBERSPACE 6.8 節；使用者 2026-11-25）', () => {
  it('從 100 開戰：第 1 輪就開始倒數（剩 3 輪、說一句話），第 2 輪 2、第 3 輪 1、第 4 輪開頭被強制斷線（戰敗）', () => {
    const r1 = battleAt(100, 1)
    expect(r1.battle.field.located).toBe(3)
    expect(r1.beats.some((b) => b.text.includes('已經被定位') && b.tag === 'located')).toBe(true)
    expect(battleAt(100, 2).battle.field.located).toBe(2)
    expect(battleAt(100, 3).battle.field.located).toBe(1)
    const r4 = battleAt(100, 4)
    expect(r4.battle.field.located).toBe(true)
    expect(r4.battle.result?.outcome).toBe('lose')
  })

  it('從 90 或 99 開戰照舊：第 1 輪還沒有倒數，第 2 輪的 +3 把追蹤度推過去才開始（比 100 晚一輪）', () => {
    for (const start of [90, 99]) {
      expect(battleAt(start, 1).battle.field.located, `從 ${start}`).toBeUndefined()
      expect(battleAt(start, 2).battle.field.located, `從 ${start}`).toBe(3)
    }
    // 從 100 開戰的第 2 輪已經是 2：比從 99 開戰的 3 少一輪
    expect(battleAt(100, 2).battle.field.located).toBe(2)
  })

  it('從 89 開戰：第 2 輪 +3 到 92 才開始；從 100 開戰、倒數中追蹤度降回 90 以下：取消', () => {
    expect(battleAt(89, 2).battle.field.located).toBe(3)
    const run = battleAt(100, 1)
    expect(run.battle.field.located).toBe(3)
    run.battle.field.trace = 80
    // 下一次追蹤度動（第 2 輪 +3 到 83）：不到 90，取消
    for (let guard = 0; guard < 50 && run.battle.round < 2; guard++) advance(run)
    expect(run.battle.field.located).toBeUndefined()
  })

  it('沒有追蹤度的戰鬥（field.trace 不是數字）不受影響', () => {
    const run = battleAt(Number.NaN, 3)
    expect(run.battle.field.located).toBeUndefined()
  })
})

// ---------------------------------------------------------------------------------------------
// B028：重創記是哪一件、帶進下一場、修好

/** 走到主角的回合再投降，把戰鬥收掉（和 M3-netcombat-jam.whitebox 的收法一樣）。 */
async function surrender(g: G): Promise<void> {
  const pcId = Object.values(g.state.battle!.units).find((u) => u.actor === 'pc')!.id
  for (let i = 0; i < 80 && g.battle; i++) {
    const o = g.battleOptions()
    if (!o || o.waiting === 'over') break
    if (o.waiting === 'ai') { g.battleNext(); continue }
    if (o.current === pcId) break
    g.battleAct({ action: 'end_turn' } as never)
  }
  g.battleAct({ action: 'net_surrender' } as never)
  await g.finishBattle()
}

function nextBattle(g: G): BattleUnit {
  g.startBattle({
    mode: 'net', grade: 1, cover: 'medium', allies: [{ from: 'actor', id: 'pc' }],
    foes: [{ from: 'enemy_pick', faction: 'f_gang', grade: 1, rank: 'minion', color: 'pink', seed: 'fw028' }],
    origin: { escapable: true, place: 'B028', faction: 'f_gang' },
  } as never)
  return Object.values(g.state.battle!.units).find((x) => x.actor === 'pc')!
}

const liveRun = (g: G): BattleRun => new BattleRun(g.k, g.state, g.state.battle!)
const pcOf = (g: G): BattleUnit => Object.values(g.state.battle!.units).find((u) => u.actor === 'pc')!

describe('B028：重創記是哪一件構裝，下一場帶進來、不能用（CYBERSPACE 6.5 節）', () => {
  it('這一場輕的一次、重的一次：戰後只有重的那一件記在 actor.ext.net_broken，狀況 net_broken 跟著寫', async () => {
    const { game: g } = makeNetBattleGame()
    const run = liveRun(g)
    const pc = pcOf(g)
    // 第一次輕（武器構裝先破：cs_tw_gun），第二次本來就有破損 = 重（下一個武器構裝：cs_tw_blade）
    expect(breakOne(run, pc)).toBe('cs_tw_gun')
    expect(pc.ext.net).toMatchObject({ broken: ['cs_tw_gun'] })
    expect(carryOf(pc)).toEqual([])
    expect(breakOne(run, pc)).toBe('cs_tw_blade')
    expect(carryOf(pc)).toEqual(['cs_tw_blade'])
    expect(pc.ext.net).toMatchObject({ heavy: true, broken: ['cs_tw_gun', 'cs_tw_blade'] })
    await surrender(g)
    expect(conds(g)).toContain(BROKEN_CONDITION)
    expect(extOf(g)).toEqual(['cs_tw_blade'])
  })

  it('帶進下一場：記下的那一件在 ext.net.broken 裡、手上的武器是它就攻擊灰掉；本來就有破損，再中一次也是重的', async () => {
    const { game: g } = makeNetBattleGame()
    const run = liveRun(g)
    breakOne(run, pcOf(g))
    breakOne(run, pcOf(g))
    await surrender(g)
    const u = nextBattle(g)
    expect(brokenOf(u)).toEqual(['cs_tw_blade'])
    expect(carryOf(u)).toEqual(['cs_tw_blade'])
    expect(u.ext.net).toMatchObject({ heavy: true })
    // 破損的是近戰構裝：換上它，近戰攻擊灰掉並寫原因
    u.wield = u.weapons.findIndex((w) => w.id === 'cs_tw_blade')
    expect(g.k.battle.getAction('net_melee')!.blocks!(liveRun(g), u).join('')).toContain('破損')
    // 開打的第一拍交代了誰帶著沒修好的重創
    expect(g.state.battle!.beats?.map((b) => b.text).join('') ?? '').toBeDefined()
    // 又被重創一次：記在 carry 裡的有兩件
    const again = liveRun(g)
    expect(breakOne(again, pcOf(g))).toBe('cs_tw_gun')
    expect(carryOf(pcOf(g))).toEqual(['cs_tw_blade', 'cs_tw_gun'])
  })

  it('帶進來的原樣帶回去：這一場沒有新的破損也沒有修，戰後不再寫（狀況與 ext 都不變）', async () => {
    const { game: g } = makeNetBattleGame({ noBattle: true })
    sys(g, 'test.set', [{ op: 'actor.condition', id: 'pc', condition: BROKEN_CONDITION }, { op: 'actor.ext', id: 'pc', key: BROKEN_EXT, value: ['cs_tw_blade'] }])
    nextBattle(g)
    const before = g.state.reports.length
    await surrender(g)
    expect(conds(g)).toContain(BROKEN_CONDITION)
    expect(extOf(g)).toEqual(['cs_tw_blade'])
    // 戰鬥結束的報告裡沒有再寫 net_broken
    const mine = g.state.reports.slice(before).flatMap((r) => r.changes).filter((c) => (c.op === 'actor.condition' && c.condition === BROKEN_CONDITION) || (c.op === 'actor.ext' && c.key === BROKEN_EXT))
    expect(mine).toEqual([])
  })

  it('沒記是哪一件（只有狀況）：照武器、工具、防護的順序挑沒破損的第一件（cs_tw_gun），戰後把挑到的記下來', async () => {
    const { game: g } = makeNetBattleGame({ noBattle: true })
    sys(g, 'test.set', [{ op: 'actor.condition', id: 'pc', condition: BROKEN_CONDITION }])
    const u = nextBattle(g)
    expect(brokenOf(u)).toEqual(['cs_tw_gun'])
    expect(carryOf(u)).toEqual(['cs_tw_gun'])
    await surrender(g)
    expect(extOf(g)).toEqual(['cs_tw_gun'])
  })

  it('記的是現在沒裝著的構裝：這一場不影響戰鬥、戰後原樣記著；壞掉的資料（不是字串的陣列、不認得的 id）不丟錯', async () => {
    const { game: g } = makeNetBattleGame({ noBattle: true })
    sys(g, 'test.set', [{ op: 'actor.condition', id: 'pc', condition: BROKEN_CONDITION }, { op: 'actor.ext', id: 'pc', key: BROKEN_EXT, value: ['cs_nowhere', 7, null] }])
    const u = nextBattle(g)
    expect(brokenOf(u)).toEqual([])
    expect(carryOf(u)).toEqual(['cs_nowhere'])
    await surrender(g)
    expect(extOf(g)).toEqual(['cs_nowhere'])
    sys(g, 'test.set', [{ op: 'actor.ext', id: 'pc', key: BROKEN_EXT, value: 'oops' }])
    expect(() => nextBattle(g)).not.toThrow()
  })

  it('傷害骰少一顆的重創記成 dice：下一場開打時傷害骰就少一顆', async () => {
    const { game: g } = makeNetBattleGame({ noBattle: true })
    sys(g, 'test.set', [{ op: 'actor.condition', id: 'pc', condition: BROKEN_CONDITION }, { op: 'actor.ext', id: 'pc', key: BROKEN_EXT, value: ['dice'] }])
    const u = nextBattle(g)
    expect(u.ext.net).toMatchObject({ dice_loss: 1, heavy: true })
    expect(carryOf(u)).toEqual(['dice'])
    expect(brokenOf(u)).toEqual([])
  })

  it('當場修好（net.fix）：記著的那一件也跟著少，戰後把狀況拿掉', async () => {
    const { game: g } = makeNetBattleGame({ noBattle: true })
    sys(g, 'test.set', [{ op: 'actor.condition', id: 'pc', condition: BROKEN_CONDITION }, { op: 'actor.ext', id: 'pc', key: BROKEN_EXT, value: ['cs_tw_blade'] }])
    const u = nextBattle(g)
    expect(brokenOf(u)).toEqual(['cs_tw_blade'])
    expect(fixOne(liveRun(g), u)).toBe('cs_tw_blade')
    expect(carryOf(u)).toEqual([])
    expect(u.ext.net).not.toHaveProperty('heavy')
    await surrender(g)
    expect(conds(g)).not.toContain(BROKEN_CONDITION)
    expect(extOf(g)).toBeUndefined()
  })

  it('睡一覺清掉（隊上每個人）；喘口氣不清', async () => {
    const { game: g } = makeNetBattleGame({ noBattle: true })
    sys(g, 'test.set', [
      { op: 'actor.condition', id: 'pc', condition: BROKEN_CONDITION }, { op: 'actor.ext', id: 'pc', key: BROKEN_EXT, value: ['cs_tw_blade'] },
      { op: 'actor.condition', id: 'a_tw_n1', condition: BROKEN_CONDITION },
    ])
    const { breathDraft, sleepDraft } = await import('../../src/features/rest')
    g.commit(breathDraft(g.k, g.state))
    expect(conds(g)).toContain(BROKEN_CONDITION)
    // 睡一覺要距上次 16 小時以上
    sys(g, 'test.time', [{ op: 'time', minutes: 24 * 60 }])
    g.commit(sleepDraft(g.k, g.state))
    expect(conds(g)).not.toContain(BROKEN_CONDITION)
    expect(extOf(g)).toBeUndefined()
    expect(conds(g, 'a_tw_n1')).not.toContain(BROKEN_CONDITION)
  })
})

describe('B028：付錢修（CYBERSPACE 6.5 節：構裝價的 10%；規則表 netcombat_rule.repair）', () => {
  /** 站在潛艙店（塔下 F3），把這種設施當成也有修理服務（設施種類的 functions 多一個 repair_construct）；主角帶著兩件重創的構裝。 */
  function repairGame(): Game {
    const { game: g } = makeDiveGame()
    const t = g.k.content.get<{ functions: string[] }>('facility_type', 'fac_tw_pod')!
    t.functions = [...t.functions, 'repair_construct']
    sys(g, 'test.set', [{ op: 'actor.condition', id: 'pc', condition: BROKEN_CONDITION }, { op: 'actor.ext', id: 'pc', key: BROKEN_EXT, value: ['cs_tw_gun', 'cs_tw_blade'] }])
    return g
  }

  it('價錢：構裝價的 10%（四捨五入）、最少 1；沒寫價的構裝收最少的；傷害骰少一顆也是最少的', () => {
    const { game: g } = makeNetBattleGame({ noBattle: true })
    g.k.content.get<{ price?: number }>('construct', 'cs_tw_gun')!.price = 1300
    g.k.content.get<{ price?: number }>('construct', 'cs_tw_blade')!.price = 14
    sys(g, 'test.set', [{ op: 'actor.condition', id: 'pc', condition: BROKEN_CONDITION }, { op: 'actor.ext', id: 'pc', key: BROKEN_EXT, value: ['cs_tw_gun', 'cs_tw_blade', 'cs_tw_jam', 'dice'] }])
    expect(repairRows(g.k, g.state, 'pc').map((r) => [r.id, r.price])).toEqual([['cs_tw_gun', 130], ['cs_tw_blade', 1], ['cs_tw_jam', 1], ['dice', 1]])
    // 沒帶重創的人沒有東西可修；有狀況沒記是哪一件的，一筆最少價
    expect(repairRows(g.k, g.state, 'a_tw_n1')).toEqual([])
    sys(g, 'test.set', [{ op: 'actor.condition', id: 'a_tw_n1', condition: BROKEN_CONDITION }])
    expect(repairRows(g.k, g.state, 'a_tw_n1')).toEqual([{ id: 'unknown', name: '破損的構裝', price: 1 }])
  })

  it('擋下的原因：不在有修理服務的地方、沒有破損、那一件沒破損、現金不夠、潛入中', () => {
    const { game: g } = makeDiveGame()
    sys(g, 'test.set', [{ op: 'actor.condition', id: 'pc', condition: BROKEN_CONDITION }, { op: 'actor.ext', id: 'pc', key: BROKEN_EXT, value: ['cs_tw_gun'] }])
    expect(repairBlock(g.k, g.state, 'pc')).toBe('這裡沒有修理構裝的服務：要到大街的構裝店這類設施。')
    const t = g.k.content.get<{ functions: string[] }>('facility_type', 'fac_tw_pod')!
    t.functions = [...t.functions, 'repair_construct']
    expect(repairBlock(g.k, g.state, 'pc')).toBeNull()
    expect(repairBlock(g.k, g.state, 'a_nobody')).toBe('沒有 a_nobody 這個角色。')
    expect(repairBlock(g.k, g.state, 'pc', 'cs_tw_jam')).toBe('那一件沒有破損。')
    sys(g, 'test.set', [{ op: 'cash', delta: -g.state.money.cash }])
    expect(repairBlock(g.k, g.state, 'pc')).toMatch(/^現金不夠：修理要 /)
    sys(g, 'test.set', [{ op: 'cash', delta: 500 }, { op: 'actor.condition', id: 'pc', condition: BROKEN_CONDITION, remove: true }])
    expect(repairBlock(g.k, g.state, 'pc')).toBe('身上沒有需要修的構裝。')
    // 潛入中不能修
    sys(g, 'test.set', [{ op: 'actor.condition', id: 'pc', condition: BROKEN_CONDITION }])
    diveIn(g)
    expect(repairBlock(g.k, g.state, 'pc')).toMatch(/先登出/)
  })

  it('修一件：付那一件的錢，記著的少一筆、狀況留著；全修：付全部的錢，狀況與 ext 都拿掉', () => {
    const g = repairGame()
    g.k.content.get<{ price?: number }>('construct', 'cs_tw_gun')!.price = 1200
    g.k.content.get<{ price?: number }>('construct', 'cs_tw_blade')!.price = 800
    const cash = g.state.money.cash
    const one = repairDraft(g.k, g.state, 'pc', 'cs_tw_gun')
    expect(one).toMatchObject({ kind: 'action', action: 'netcombat.repair' })
    g.commit(one)
    expect(g.state.money.cash).toBe(cash - 120)
    expect(extOf(g)).toEqual(['cs_tw_blade'])
    expect(conds(g)).toContain(BROKEN_CONDITION)
    g.commit(repairDraft(g.k, g.state, 'pc'))
    expect(g.state.money.cash).toBe(cash - 120 - 80)
    expect(conds(g)).not.toContain(BROKEN_CONDITION)
    expect(extOf(g)).toBeUndefined()
    expect(() => repairDraft(g.k, g.state, 'pc')).toThrow('身上沒有需要修的構裝。')
  })

  it('格子上列「修理構裝」：站在有修理服務的設施上帶價錢與原因；站在別的標記上、網內的地圖不列', () => {
    const g = repairGame()
    g.k.content.get<{ price?: number }>('construct', 'cs_tw_gun')!.price = 1200
    g.k.content.get<{ price?: number }>('construct', 'cs_tw_blade')!.price = 800
    const here = g.state.location.facility!
    const marker = { id: here, at: [1, 1], mark: 'F', name: '潛艙店' } as unknown as MarkerDef
    const ctx = (kind = 'block'): GridCtx => ({ k: g.k, state: g.state, map: { kind } } as unknown as GridCtx)
    const mine = (list: Array<{ id: string }>) => list.filter((u) => u.id === 'netcombat.repair')
    expect(mine(g.k.grid.listUses(ctx(), marker))).toEqual([{ id: 'netcombat.repair', name: '修理構裝（C$200）', block: null }])
    expect(mine(g.k.grid.listUses(ctx(), { ...marker, id: 'Z9' }))).toEqual([])
    expect(mine(g.k.grid.listUses(ctx('subnet'), marker))).toEqual([])
  })

  it('規則表 netcombat_rule 的 repair：預設 { pct: 10, min: 1 }；可以被後載入的包換掉；格式不對的擋下', () => {
    const { game: g } = makeNetBattleGame({ noBattle: true })
    expect(g.k.content.get('netcombat_rule', 'default')).toMatchObject({ repair: { pct: 10, min: 1 } })
    expect(netcombatRules(g.k).repair).toEqual({ pct: 10, min: 1 })
    for (const repair of [{ pct: 101 }, { pct: 1.5 }, { min: -1 }, { rate: 1 }, 'x']) expect(ruleProblems({ id: 'default', repair }).length, JSON.stringify(repair)).toBeGreaterThan(0)
    expect(ruleProblems({ id: 'default', repair: { pct: 25, min: 5 } })).toEqual([])
    g.k.content.get<{ repair: unknown }>('netcombat_rule', 'default')!.repair = { pct: 25, min: 5 }
    g.k.content.get<{ price?: number }>('construct', 'cs_tw_gun')!.price = 1000
    sys(g, 'test.set', [{ op: 'actor.condition', id: 'pc', condition: BROKEN_CONDITION }, { op: 'actor.ext', id: 'pc', key: BROKEN_EXT, value: ['cs_tw_gun', 'cs_tw_jam'] }])
    expect(repairRows(g.k, g.state, 'pc').map((r) => r.price)).toEqual([250, 5])
  })
})

// ---------------------------------------------------------------------------------------------
// B029：餘韻的計時

describe('B029：餘韻脫離戰鬥後每十分鐘消一層（CORE_RULES 4.3 節）', () => {
  const glow = (g: Game, actor = 'pc') => g.state.actors[actor]!.afterglow
  const minutes = (g: Game, n: number) => sys(g, 'test.time', [{ op: 'time', minutes: n }])

  it('分好幾次過的時間會累積：3 ＋ 3 ＋ 4 分鐘 = 十分鐘，消一層；餘數不會被丟掉', () => {
    const { game: g } = makeNetBattleGame({ noBattle: true })
    sys(g, 'test.set', [{ op: 'actor.track', id: 'pc', track: 'afterglow', delta: 2 }])
    minutes(g, 3)
    minutes(g, 3)
    expect(glow(g)).toBe(2)
    minutes(g, 4)
    expect(glow(g)).toBe(1)
    // 起點往前推剛好一個十分鐘：再過 10 分鐘全消，起點拿掉
    minutes(g, 10)
    expect(glow(g)).toBe(0)
    expect(g.state.actors.pc!.ext.glow_at).toBeUndefined()
  })

  it('餘韻再增加就重新起算：第 7 分鐘多了一層，第 10 分鐘不消，第 17 分鐘才消', () => {
    const { game: g } = makeNetBattleGame({ noBattle: true })
    sys(g, 'test.set', [{ op: 'actor.track', id: 'pc', track: 'afterglow', delta: 1 }])
    minutes(g, 7)
    sys(g, 'test.set', [{ op: 'actor.track', id: 'pc', track: 'afterglow', delta: 1 }])
    minutes(g, 3)
    expect(glow(g)).toBe(2)
    minutes(g, 7)
    expect(glow(g)).toBe(1)
  })

  it('增加的那份報告自己推了時間：從那份報告結束的那一刻起算', () => {
    const { game: g } = makeNetBattleGame({ noBattle: true })
    sys(g, 'test.set', [{ op: 'time', minutes: 8 }, { op: 'actor.track', id: 'pc', track: 'afterglow', delta: 1 }])
    expect(glow(g)).toBe(1)
    minutes(g, 9)
    expect(glow(g)).toBe(1)
    minutes(g, 1)
    expect(glow(g)).toBe(0)
  })

  it('只有真的消了層才多一份報告；沒有餘韻的人時間怎麼過都不多報告', () => {
    const { game: g } = makeNetBattleGame({ noBattle: true })
    const n0 = g.state.reports.length
    minutes(g, 600)
    expect(g.state.reports.length - n0).toBe(1)
    sys(g, 'test.set', [{ op: 'actor.track', id: 'pc', track: 'afterglow', delta: 1 }])
    const n1 = g.state.reports.length
    minutes(g, 4)
    expect(g.state.reports.length - n1).toBe(1)
    minutes(g, 6)
    expect(g.state.reports.length - n1).toBe(3)
    expect(g.state.reports.at(-1)).toMatchObject({ kind: 'system', action: 'character.afterglow', outcome: { result: 'faded' } })
    expect(g.state.reports.at(-1)!.timeline[0]!.text).not.toMatch(/\d/)
  })

  it('沒有計時起點的（開局就帶著餘韻）：從第一次時間經過的起點算，只多一份「開始計時」的報告', () => {
    const { game: g } = makeNetBattleGame({ noBattle: true })
    g.state.actors.pc!.afterglow = 1
    minutes(g, 4)
    expect(g.state.actors.pc!.ext.glow_at).toBeDefined()
    expect(glow(g)).toBe(1)
    minutes(g, 6)
    expect(glow(g)).toBe(0)
  })

  it('睡一覺照舊全消，起點不留著影響下一次：下次再增加時重新起算', async () => {
    const { game: g } = makeNetBattleGame({ noBattle: true })
    sys(g, 'test.set', [{ op: 'actor.track', id: 'pc', track: 'afterglow', delta: 3 }])
    const { sleepDraft } = await import('../../src/features/rest')
    g.commit(sleepDraft(g.k, g.state))
    expect(glow(g)).toBe(0)
    sys(g, 'test.set', [{ op: 'actor.track', id: 'pc', track: 'afterglow', delta: 1 }])
    minutes(g, 9)
    expect(glow(g)).toBe(1)
  })
})

// ---------------------------------------------------------------------------------------------
// 潛入中換腳本

describe('潛入中換腳本（使用者 2026-11-25：和換 SKIN 一致；戰鬥中不行）', () => {
  it('DIVE_ALLOW 放行 commit:deck.scripts；潛入中帶上、放下腳本都成立；換構裝、換甲板照舊擋', () => {
    expect(DIVE_ALLOW).toContain('commit:deck.scripts')
    const { game: g } = makeDiveGame()
    diveIn(g)
    expect(g.blockOf('commit:deck.scripts')).toBeNull()
    expect(g.blockOf('commit:deck.skin')).toBeNull()
    expect(g.blockOf('commit:deck.install')).toMatch(/先登出/)
    expect(g.blockOf('commit:deck.equip')).toMatch(/先登出/)
    g.commit(scriptsDraft(g.k, g.state, 'pc', [{ item: 'it_tw_script', qty: 1 }]))
    expect(g.state.actors.pc!.ext.deck).toMatchObject({ scripts: [{ item: 'it_tw_script', qty: 1 }] })
    g.commit(scriptsDraft(g.k, g.state, 'pc', []))
    expect(g.state.actors.pc!.ext.deck).toMatchObject({ scripts: [] })
  })

  it('戰鬥中不行（原因「戰鬥中不能換腳本」）', () => {
    const { game: g } = makeNetBattleGame()
    expect(() => scriptsDraft(g.k, g.state, 'pc', [{ item: 'it_tw_script', qty: 1 }])).toThrow('戰鬥中不能換腳本。')
  })
})

// ---------------------------------------------------------------------------------------------
// 煙霧彈的目標：內海腳本的 slot

const SMOKE = { id: 'it_fw_smoke', name: '煙霧彈腳本', desc: '格子變成半掩體。', category: 'misc', grade: 1, size: 0, legal: 'free', tags: ['script'], use: { ap: 1, target: 'slot', modes: ['net'], effects: [{ op: 'soft_cover', kind: 'smoke', rounds: 2 }] } }
const ALLY_ONLY = { ...SMOKE, id: 'it_fw_ally_slot', use: { ...SMOKE.use, target: 'ally_slot' } }
const PACK: ContentPack = { id: 'fw_smoke', content: { item: [SMOKE, ALLY_ONLY] } as never }

describe('煙霧彈（target: slot）可以放在我方或敵方的格子上（現實與內海的腳本）', () => {
  it('內海的腳本：slot 的對我方四格與敵方四格都列；ally_slot 還是只有我方；放在敵方的格子上成立', () => {
    const { game: g } = makeNetBattleGame({ content: [PACK] as never })
    const run = new BattleRun(g.k, g.state, clone(g.state.battle!))
    const pc = Object.values(run.battle.units).find((u) => u.actor === 'pc')!
    const def = g.k.battle.getAction('net_script')!
    const cells = (item: string) => {
      pc.quick = [{ item, qty: 1 }]
      return def.targets!(run, pc).filter((t) => 'slot' in t.target).map((t) => `${(t.target as { side: string }).side}${(t.target as { slot: number }).slot}`)
    }
    expect(cells('it_fw_smoke')).toEqual(['ally1', 'ally2', 'ally3', 'ally4', 'foe1', 'foe2', 'foe3', 'foe4'])
    expect(cells('it_fw_ally_slot')).toEqual(['ally1', 'ally2', 'ally3', 'ally4'])
    pc.quick = [{ item: 'it_fw_smoke', qty: 2 }]
    def.run!(run, pc, { side: 'foe', slot: 2 }, {} as never)
    expect(run.battle.cover.foe[1]!.soft).toMatchObject({ kind: 'smoke' })
    def.run!(run, pc, { side: 'ally', slot: 3 }, {} as never)
    expect(run.battle.cover.ally[2]!.soft).toMatchObject({ kind: 'smoke' })
    // 只放我方格子的腳本放到敵方：不是這樣用的
    pc.quick = [{ item: 'it_fw_ally_slot', qty: 1 }]
    try {
      def.run!(run, pc, { side: 'foe', slot: 1 }, {} as never)
      throw new Error('應該被擋下')
    } catch (e) {
      expect(e).toBeInstanceOf(BattleBlocked)
    }
  })
})

// ---------------------------------------------------------------------------------------------
// 報告噪音：peak 併進該步的報告

describe('追蹤度升了沒跨門檻：不再多發 netrun.trace 報告，peak 併進該步原本的報告', () => {
  /** 潛入、進自己去挖的子網（ns_tw_dig；追蹤度從 0 起算）。 */
  function inDig() {
    const t = makeDiveGame()
    diveIn(t.game)
    t.game.commit(diveGo(t.game.k, t.game.state, 'ns_tw_dig'))
    return t.game
  }
  const mapOf = (g: Game) => g.state.maps.at!.map
  const traceNow = (g: Game) => meterOf(g.k, g.state, 'trace', mapOf(g))
  const askAi = (g: Game, amount: number) => {
    const r = g.k.effects.resolve([{ kind: 'trace', amount }], effectCtx(g.k, g.state, { source: 'ai' }))
    expect(r.errors).toEqual([])
    return g.commit({ kind: 'event', action: 'event.test', location: clone(g.state.location), party: [], timeline: [], changes: r.changes, outcome: { result: 'ok', summary: '測試' } })
  }

  it('AI 給 +5、−3、+2：每一次只多一份自己的報告；peak 跟著升（到 5、不降、再到 5）', () => {
    const g = inDig()
    expect(readRun(g.state)!.peak).toBe(0)
    const n0 = g.state.reports.length
    askAi(g, 5)
    expect(traceNow(g)).toBe(5)
    expect(readRun(g.state)!.peak).toBe(5)
    expect(g.state.reports.length - n0).toBe(1)
    askAi(g, -3)
    expect(traceNow(g)).toBe(2)
    expect(readRun(g.state)!.peak).toBe(5)
    askAi(g, 2)
    expect(readRun(g.state)!.peak).toBe(5)
    askAi(g, 4)
    expect(traceNow(g)).toBe(8)
    expect(readRun(g.state)!.peak).toBe(8)
    expect(g.state.reports.length - n0).toBe(4)
    expect(g.state.reports.filter((r) => r.action === 'netrun.trace')).toEqual([])
  })

  it('跨過門檻（30）還是多一份 netrun.trace（有門檻的那一句），peak 在原本的報告裡就記了', () => {
    const g = inDig()
    const n0 = g.state.reports.length
    askAi(g, 20)
    askAi(g, 15)
    expect(traceNow(g)).toBe(35)
    expect(readRun(g.state)!.peak).toBe(35)
    const added = g.state.reports.slice(n0)
    expect(added.map((r) => r.action)).toEqual(['event.test', 'event.test', 'netrun.trace'])
    expect(added.at(-1)!.outcome.summary).toContain('追蹤度到了 30')
  })

  it('連 peak 以外都沒有變的追蹤度：所有 netrun.trace 報告都帶著門檻的句子，沒有只寫「追蹤度 N。」的', () => {
    const g = inDig()
    for (const amount of [3, 4, 5, -2, 6]) askAi(g, amount)
    for (const r of g.state.reports.filter((x) => x.action === 'netrun.trace' || x.action === 'netrun.pressure')) expect(r.outcome.summary).not.toMatch(/^追蹤度 -?\d+。$/)
  })
})
