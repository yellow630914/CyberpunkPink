// 驗收測試：dev/work/M5-abilities-opinion.md（cpp-feature）。技能的輿論欄翻成輿論戰的掛點（opinion.moves、.passives、.open）、經 opinion.check 驗；
// 日常技能的衍生數值（daily.stat、tier_min）；導流階的加值（老粉都在）只在本來的導流階大於 0 時才加；樹在輿論戰沒有效果的不回任何東西。
// 規格：SKILLS 1.5、1.8、第 13 節；SKILL_TREES「補充規則」第 1、4、6 條；OPINION 4.3、4.3b、第 7 節；MEDIA 第 2、3 節；dev/adr/0020 第五、七、十三節；dev/work/M5-opinion-desk.md。
// 測試不裝 opinion（最後一組例外：真的 opinion 回答 opinion.check）：自帶六種技能（主動、被動、反應、姿態、預備、日常各一）加幾個邊角，
// 替身回答 opinion.check，一個問掛點的小函式（照 opinion 的問法：用 k.hooks.run 把回答攤平）。
// 與工單不一樣的地方（回報裡也有）：
// - 「切換姿態的那一招（花 0 點、每回合一次）」沒有做：opinion 的封閉清單裡沒有「換姿態」的效果，被動又是開戰時問一次存起來的；
//   姿態改成在開戰前用 ability.stance（abilities 的 stance()）開，開著才回；戰役中換姿態要 opinion 加一個效果與重問（要的介面見回報）。
// - 花人情的招要有效果 favor_spend（favors 還沒有）；沒有人註冊時那一招不回（這裡用替身效果驗翻出來的樣子）。

import { describe, expect, it } from 'vitest'
import type { ContentPack, Feature, Kernel, ReportDraft } from '../../src'
import { createKernel, readyFeatures } from '../../src'
import { abilitiesFeature, FLOW_TIER_STAT, prep, stance } from '../../src/features/abilities'
import { combatFeature } from '../../src/features/combat'
import { makeActor, makeGame, makeState } from '../../src/testkit'

type Rec = Record<string, any>

// ===================================================================================================================
// 假資料
// ===================================================================================================================

const feature = (id: string, install: (k: Kernel) => void): Feature => ({ id, install })

const tree = (id: string, signature: string, opinion: 'none' | 'mid' | 'strong', more: Rec = {}): Rec => ({
  id, name: id, tree: `${id} 樹`, category: 'media', signature, domains: { meat: 'none', net: opinion === 'none' ? 'none' : 'mid', opinion }, resonance: [], ...more,
})
const sk = (id: string, path: string, kind: string, more: Rec = {}): Rec => {
  const tier = (more.tier as number | undefined) ?? 1
  return { id, name: id, path, category: 'media', tier, layer: tier === 1 && id.endsWith('_sig') ? 'signature' : 'front', kind, cap: 1, xp: tier * 20, cells: 1, text: `${id}。`, meat: null, net: null, opinion: null, ...(id.endsWith('_sig') ? {} : { after: `${path}_sig` }), ...more }
}

const OPINION_SIGN = { mods: [{ kind: 'forged_ok' }] }
const ABILITIES: Rec[] = [
  sk('st_sig', 'st', 'passive', { cap: 3, opinion: OPINION_SIGN }),
  // 主動：花 2 點編輯點、每回合 1 次
  sk('st_act', 'st', 'active', { use: { opinion: { edit: 2, per_turn: 1 } }, opinion: { effects: [{ kind: 'voice', amount: 3 }, { kind: 'wind', amount: 1 }], need: { kind: 'flag', key: 'ok' } } }),
  // 主動：每場 2 次（per_fight 在輿論欄讀成每場）
  sk('st_fight', 'st', 'active', { use: { opinion: { edit: 1, per_fight: 2 } }, opinion: { effects: [{ kind: 'voice', amount: 1 }] } }),
  // 被動
  sk('st_pas', 'st', 'passive', { opinion: { mods: [{ kind: 'fuel_first', amount: 1 }] } }),
  // 反應：從沒用完的編輯點扣 1 點，每場 1 次
  sk('st_rea', 'st', 'reaction', { use: { opinion: { edit: 1, per_war: 1 } }, opinion: { on: 'foe.mute', effects: [{ kind: 'negate' }, { kind: 'wind', amount: 1 }] } }),
  // 姿態：開著才算
  sk('st_stance', 'st', 'stance', { opinion: { stance: true, mods: [{ kind: 'line_first', amount: 1 }] } }),
  // 預備：不花時段、帶進下一場
  sk('st_prep', 'st', 'prep', { prep: { slot: 0, scope: 'next_battle' }, opinion: { open: { voice: 2, hand: 1 } } }),
  // 日常：素材品質 +1、素材上限 = 樹階（最多 2）
  sk('st_daily', 'st', 'daily', { daily: { kind: 'studio', text: '日常。', stat: { footage_quality: 1, footage_cap: { per_tier: 1, max: 2 } } } }),
  // 日常：樹階 3 以上剪片時多一個擇一
  sk('st_daily3', 'st', 'daily', { tier: 3, daily: { kind: 'cut', stat: { cut_pick: 1 }, tier_min: 3 } }),
  // 日常：衍生數值沒有人定義（forge_bonus；測試不定義它）
  sk('st_forge', 'st', 'daily', { daily: { kind: 'forge', stat: { forge_bonus: 2 } } }),
  // 老粉都在：導流階 +1（net 欄的 flow_bonus）
  sk('st_fans', 'st', 'passive', { net: { flow_bonus: 1 } }),
  // pending 的輿論欄：不回
  sk('st_pending', 'st', 'active', { use: { opinion: { edit: 1 } }, opinion: { pending: true, text: '輿論的寫法還沒有做成機制。' } }),
  // 沒有輿論欄的
  sk('st_plain', 'st', 'passive', {}),
  // 掮客：花錢、花人情
  sk('fx_sig', 'fx', 'passive', { cap: 3 }),
  sk('fx_cash', 'fx', 'active', { use: { opinion: { edit: 1, cash: 300 } }, opinion: { effects: [{ kind: 'voice', amount: 4 }] } }),
  sk('fx_favor', 'fx', 'active', { use: { opinion: { edit: 1, favor: 'small', per_war: 1 } }, opinion: { effects: [{ kind: 'wind', amount: 2 }], need: { kind: 'flag', key: 'ok' } } }),
  // 槍手：輿論戰沒有效果
  sk('gn_sig', 'gn', 'passive', { cap: 3, category: 'meat' }),
  sk('gn_act', 'gn', 'active', { category: 'meat', use: { ap: 1 }, meat: { target: 'enemy', do: [{ op: 'damage', amount: 1, type: 'physical' }] } }),
]
const PATHS: Rec[] = [
  tree('st', 'st_sig', 'strong', { resonance: [{ tier: 2, cells: 1, text: '共鳴二。', opinion: { mods: [{ kind: 'open_hand', amount: 1 }] } }, { tier: 4, cells: 1, text: '共鳴四。', opinion: { mods: [{ kind: 'draw_extra', amount: 1 }] } }] }),
  tree('fx', 'fx_sig', 'mid'),
  { id: 'gn', name: 'gn', tree: 'gn 樹', category: 'meat', signature: 'gn_sig', domains: { meat: 'strong', net: 'weak', opinion: 'none' }, resonance: [] },
]
const pack = (abilities: Rec[] = ABILITIES, paths: Rec[] = PATHS): ContentPack => ({ id: 'ab_op', content: { path: paths, ability: abilities } }) as unknown as ContentPack

// ---- 替身 ----

/** 衍生數值：素材品質、素材上限、剪片擇一（media 正式定義；forge_bonus 故意不定義）。 */
const STATS = feature('stats_stub', (k) => {
  for (const id of ['footage_quality', 'footage_cap', 'cut_pick']) k.stats.defineStat({ id, owner: 'stats_stub', name: id, base: () => 0, min: 0, max: 9 })
})
/** 條件 flag（核心有）；替身效果 favor_spend 與條件 has_favor（favors 正式）。 */
const FAVORS = feature('favor_stub', (k) => {
  k.conditions.register({ kind: 'has_favor', owner: 'favor_stub', validate: () => [], test: () => true })
  k.effects.register({ kind: 'favor_spend', owner: 'favor_stub', validate: () => [], toChanges: () => [], describe: () => '用掉一個人情' } as never)
})
/** 替身回答 opinion.check：效果的種類是 bad 就回一條問題（真的 opinion 驗的是整套封閉清單）。 */
const CHECKS: Array<{ what: string; data: any }> = []
const CHECKER = feature('check_stub', (k) => {
  ;(k.hooks.on as any)('opinion.check', 'check_stub', ({ what, data }: { what: string; data: any }) => {
    CHECKS.push({ what, data })
    const bad = JSON.stringify(data).includes('"bad"')
    return bad ? ['這個效果不在封閉清單裡'] : []
  })
})
/** 流頻道的替身：導流階的本來值由 state.flags.flow 給。 */
const FLOW = feature('flow_stub', (k) => k.stats.addStatProvider(FLOW_TIER_STAT, 'flow_stub', (state) => (typeof state.flags.flow === 'number' && state.flags.flow > 0 ? [{ label: '頻道', value: state.flags.flow as number, source: 'skill' }] : [])))

const BASE: Feature[] = [combatFeature, abilitiesFeature, STATS]
interface Opts {
  learned?: string[]
  equipped?: string[]
  /** 主角那棵樹的累計歷練點（決定樹階） */
  spent?: Record<string, number>
  features?: Feature[]
  packs?: ContentPack[]
  actors?: Rec[]
  flags?: Rec
}
const abilityState = (o: Opts): Rec => ({ xp: 0, learned: o.learned ?? o.equipped ?? [], equipped: o.equipped ?? [], spent: o.spent ?? {} })
const make = (o: Opts = {}) => {
  const { game } = makeGame({
    features: [...BASE, ...(o.features ?? [])], content: o.packs ?? [pack()], seed: 7,
    pc: { ext: { bridge: { capacity: { meat: 12, net: 12, social: 12, media: 12 } }, abilities: abilityState(o) } },
    ...(o.actors ? { actors: o.actors as never } : {}),
    patch: { flags: { ok: true, ...(o.flags ?? {}) }, money: { cred: 100, cash: 500 } } as never,
  })
  return game
}
type G = ReturnType<typeof make>

/** 問掛點的小函式：照 opinion 的問法，把每個回答攤平。 */
const ask = (g: G, name: string, desk: string[] = ['pc']): any[] => (g.k.hooks as any).run(name, { state: g.state, war: null, desk }).flatMap((a: { result: unknown }) => (Array.isArray(a.result) ? a.result : []))
const moves = (g: G, desk?: string[]): Rec[] => ask(g, 'opinion.moves', desk)
const passives = (g: G, desk?: string[]): Rec[] => ask(g, 'opinion.passives', desk)
const opens = (g: G, desk?: string[]): Rec[] => ask(g, 'opinion.open', desk)
const byId = (xs: Rec[], id: string): Rec | undefined => xs.find((x) => x.id === id)
const stat = (g: G, id: string, who = 'pc'): number => g.k.stats.stat(g.state, who, id)

const preparedOf = (g: G): unknown => (g.state.actors.pc!.ext.abilities as Rec).prepared
const mate = (id: string, path: string, tier: number): Rec => makeActor({ id, name: `夥伴${id}`, role: 'companion', ext: { paths: [{ path, slot: 'main', tier }] } })

const draft = (changes: ReportDraft['changes'], timeline: ReportDraft['timeline'] = []): ReportDraft => ({
  kind: 'action', action: 'test.step', location: { district: 'test' }, party: [], timeline, changes, outcome: { result: 'ok', summary: '測試' },
})

// ===================================================================================================================
// opinion.moves
// ===================================================================================================================

describe('opinion.moves：主動技能變成一招', () => {
  it('裝著的主動技能各回一筆：id 是技能的 id，cost 是 use.opinion.edit，limit 與 effects 照資料', () => {
    const g = make({ equipped: ['st_sig', 'st_act', 'st_fight'] })
    const act = byId(moves(g), 'st_act')!
    expect(act).toMatchObject({ id: 'st_act', owner: 'abilities', actor: 'pc', name: 'st_act', cost: 2, limit: { per: 'turn', n: 1 } })
    expect(act.effects).toEqual([{ kind: 'voice', amount: 3 }, { kind: 'wind', amount: 1 }])
    expect(act.need).toEqual({ kind: 'flag', key: 'ok' })
    // per_fight 讀成每場
    expect(byId(moves(g), 'st_fight')).toMatchObject({ cost: 1, limit: { per: 'war', n: 2 } })
    expect(moves(g).map((m) => m.id).sort()).toEqual(['st_act', 'st_fight'])
  })

  it('沒裝著的不回；pending 的不回；被動、日常、沒有輿論欄的不是招', () => {
    const g = make({ learned: ['st_sig', 'st_act', 'st_pending', 'st_plain', 'st_pas'], equipped: ['st_sig', 'st_pending', 'st_plain', 'st_pas'] })
    expect(moves(g)).toEqual([])
    g.commit({ ...draft([{ op: 'actor.ext', id: 'pc', key: 'abilities', value: abilityState({ equipped: ['st_sig', 'st_act', 'st_pending'] }) }]) })
    expect(moves(g).map((m) => m.id)).toEqual(['st_act'])
  })

  it('只問坐在編輯台的人：desk 裡沒有的人不回', () => {
    const g = make({ equipped: ['st_sig', 'st_act'], actors: [mate('m1', 'st', 1)] })
    expect(moves(g, ['m1']).map((m) => m.id)).toEqual(['st_act', 'st_fight']) // 夥伴 m1 樹階 1 以內的主動技能（他的 actor 是 m1）
    expect(moves(g, ['m1'])[0]!.actor).toBe('m1')
    expect(moves(g, [])).toEqual([])
  })

  it('夥伴照路數與樹階回：樹階以內的算、超過的不算；不在這棵樹的路數不算', () => {
    const g = make({ equipped: [], actors: [mate('m1', 'st', 1), mate('m2', 'st', 3), mate('m3', 'fx', 3)] })
    const ids = (who: string) => moves(g, [who]).map((m) => m.id).sort()
    expect(ids('m1')).toEqual(['st_act', 'st_fight'])
    // 樹階 3 以內的主動技能也是這兩個（st_daily3 是日常）
    expect(ids('m2')).toEqual(['st_act', 'st_fight'])
    expect(ids('m3')).toEqual(['fx_cash']) // 花人情的那一招沒有 favor_spend 的人註冊，不回
  })

  it('兩個人坐著都有同一個技能：第二個人的 id 加上 @人，次數不會混在一起', () => {
    const g = make({ equipped: ['st_sig', 'st_act'], actors: [mate('m1', 'st', 1)] })
    const list = moves(g, ['pc', 'm1'])
    expect(list.map((m) => m.id)).toEqual(['st_act', 'st_act@m1', 'st_fight'])
    expect(list.map((m) => m.actor)).toEqual(['pc', 'm1', 'm1'])
  })

  it('夜課延伸的技能（night:）沒有輿論欄的寫法：遇到就不回、不丟錯', () => {
    const g = make({ equipped: ['st_sig', 'st_act'] })
    const night = { id: 'nt', name: '夜課', branch: 'common', tier: 1, tag: '共通', text: '夜課。', outside: { cap: 1, kind: 'active', use: { opinion: { edit: 1 } }, opinion: { effects: [{ kind: 'voice', amount: 1 }] } } }
    const k = createKernel([...BASE, feature('night_stub', (kk) => kk.content.defineKind({ kind: 'night_skill', owner: 'night_stub', validate: () => [] }))])
    k.content.loadPack(pack())
    k.content.loadPack({ id: 'nt', content: { night_skill: [night] } } as unknown as ContentPack)
    readyFeatures(k)
    const state = makeState({ pc: { ext: { bridge: { capacity: { meat: 12, net: 12, social: 12, media: 12 } }, abilities: abilityState({ equipped: ['night:nt', 'st_act'] }), scene: { skills: ['nt'] } } } })
    const list = (k.hooks as any).run('opinion.moves', { state, war: null, desk: ['pc'] }).flatMap((a: any) => a.result)
    expect(list.map((m: Rec) => m.id)).toEqual(['st_act'])
    expect(g.k.hooks).toBeDefined()
  })

  it('花錢的招：翻成 need（現金夠）加一筆 out 的效果（戰役結算時才扣）；效果與次數照資料', () => {
    const g = make({ equipped: ['fx_sig', 'fx_cash'] })
    const m = byId(moves(g), 'fx_cash')!
    expect(m.cost).toBe(1)
    expect(m.need).toEqual({ kind: 'money', wallet: 'cash', min: 300 })
    expect(m.effects).toEqual([{ kind: 'voice', amount: 4 }, { kind: 'out', effect: { kind: 'cash', amount: -300 } }])
    // 帶著替身的條件判斷：現金 500 夠、200 不夠
    const ctx = { state: g.state, actor: 'pc', stats: g.k.stats, timeRules: g.k.timeRules }
    expect(g.k.conditions.test(m.need as never, ctx)).toBe(true)
    g.state.money.cash = 200
    expect(g.k.conditions.test(m.need as never, ctx)).toBe(false)
  })

  it('花人情的招：沒有人註冊效果 favor_spend 時不回；註冊了（favors）翻成 need 加 out，兩個條件合成 all', () => {
    const none = make({ equipped: ['fx_sig', 'fx_favor'] })
    expect(moves(none)).toEqual([])
    const g = make({ equipped: ['fx_sig', 'fx_favor'], features: [FAVORS] })
    const m = byId(moves(g), 'fx_favor')!
    expect(m.limit).toEqual({ per: 'war', n: 1 })
    expect(m.need).toEqual({ kind: 'all', of: [{ kind: 'flag', key: 'ok' }, { kind: 'has_favor', dir: 'owed_to_pc', size: 'small' }] })
    expect(m.effects).toEqual([{ kind: 'wind', amount: 2 }, { kind: 'out', effect: { kind: 'favor_spend', dir: 'owed_to_pc', size: 'small' } }])
  })
})

// ===================================================================================================================
// opinion.passives
// ===================================================================================================================

describe('opinion.passives：被動、共鳴、反應、開著的姿態', () => {
  it('被動回一筆 OpPassive（mods 照資料）；招牌只回它另外寫的東西（聚光燈的 forged_ok）', () => {
    const g = make({ equipped: ['st_sig', 'st_pas'] })
    const list = passives(g)
    expect(byId(list, 'st_sig')).toMatchObject({ owner: 'abilities', actor: 'pc', mods: [{ kind: 'forged_ok' }] })
    expect(byId(list, 'st_pas')).toMatchObject({ actor: 'pc', mods: [{ kind: 'fuel_first', amount: 1 }] })
    // 沒有輿論欄的被動、日常不回
    expect(passives(make({ equipped: ['st_sig', 'st_plain', 'st_daily'] })).map((p) => p.id)).toEqual(['st_sig'])
  })

  it('反應回一筆：on、效果照資料；edit 是從沒用完的編輯點扣的 cost、per_war 是每場', () => {
    const g = make({ equipped: ['st_sig', 'st_rea'] })
    const rea = byId(passives(g), 'st_rea')!
    expect(rea.mods).toBeUndefined()
    expect(rea.reacts).toEqual([{ on: 'foe.mute', cost: 1, limit: { per: 'war', n: 1 }, effects: [{ kind: 'negate' }, { kind: 'wind', amount: 1 }] }])
  })

  it('姿態：沒開不回、開了才回（開在戰鬥外：ability.stance）；同時只能開一個', () => {
    const g = make({ equipped: ['st_sig', 'st_stance', 'st_pas'] })
    expect(byId(passives(g), 'st_stance')).toBeUndefined()
    g.commit(stance(g.k, g.state, 'pc', 'st_stance'))
    expect(byId(passives(g), 'st_stance')).toMatchObject({ actor: 'pc', mods: [{ kind: 'line_first', amount: 1 }] })
    // 再按一次就是關掉
    g.commit(stance(g.k, g.state, 'pc', 'st_stance'))
    expect(byId(passives(g), 'st_stance')).toBeUndefined()
  })

  it('共鳴：路數 resonance[i].opinion，樹開到那一階、裝著招牌才算', () => {
    // 樹階 2 要累計 40 點
    const g = make({ equipped: ['st_sig'], spent: { st: 40 } })
    const ids = passives(g).map((p) => p.id)
    expect(ids).toContain('res:st:0')
    expect(ids).not.toContain('res:st:1') // 4 階的共鳴還沒到
    expect(byId(passives(g), 'res:st:0')).toMatchObject({ mods: [{ kind: 'open_hand', amount: 1 }], actor: 'pc' })
    // 沒裝招牌就不算
    expect(passives(make({ equipped: ['st_pas'], spent: { st: 40 } })).map((p) => p.id)).not.toContain('res:st:0')
    // 夥伴照 ext.paths 的階
    const m = make({ equipped: [], actors: [mate('m4', 'st', 4)] })
    expect(passives(m, ['m4']).map((p) => p.id)).toEqual(expect.arrayContaining(['res:st:0', 'res:st:1']))
    expect(passives(make({ equipped: [], actors: [mate('m1', 'st', 1)] }), ['m1']).map((p) => p.id)).not.toContain('res:st:0')
  })

  it('夥伴的被動、反應照樹階回；夥伴的姿態沒有地方記開關，所以不回', () => {
    const g = make({ equipped: [], actors: [mate('m1', 'st', 1)] })
    const ids = passives(g, ['m1']).map((p) => p.id)
    expect(ids).toEqual(expect.arrayContaining(['st_sig', 'st_pas', 'st_rea']))
    expect(ids).not.toContain('st_stance')
  })
})

// ===================================================================================================================
// opinion.open
// ===================================================================================================================

describe('opinion.open：預備類技能帶進這一場；用過就沒了', () => {
  it('預備之後問 opinion.open 有一筆；開場那一份報告（有 opinion.open 那一拍）用掉它，下一場就沒有了', () => {
    const g = make({ equipped: ['st_sig', 'st_prep'] })
    expect(opens(g)).toEqual([])
    g.commit(prep(g.k, g.state, 'pc', 'st_prep'))
    const list = opens(g)
    expect(list).toHaveLength(1)
    expect(list[0]).toMatchObject({ voice: 2, hand: 1, owner: 'abilities:pc:st_prep' })
    expect(typeof list[0].line).toBe('string')
    // 沒有被別的戰鬥帶走：現實戰鬥的預備只認 meat／net 的內容
    expect(preparedOf(g)).toEqual([{ id: 'st_prep', scope: 'next_battle' }])
    // 開場報告：帶著那一拍
    g.commit(draft([], [{ layer: 'meat', text: '開場。', tag: 'opinion.open', data: { owner: list[0].owner, voice: 2 } }]))
    expect(preparedOf(g)).toEqual([])
    expect(opens(g)).toEqual([])
  })

  it('別的報告（沒有 opinion.open 那一拍）不動預備', () => {
    const g = make({ equipped: ['st_sig', 'st_prep'] })
    g.commit(prep(g.k, g.state, 'pc', 'st_prep'))
    g.commit(draft([], [{ layer: 'meat', text: '別的事。', tag: 'something' }]))
    expect(opens(g)).toHaveLength(1)
  })

  it('預備 scope 是 commission 的：開場之後留著並綁在那件委託上', () => {
    const packs = [pack(ABILITIES.map((a) => (a.id === 'st_prep' ? { ...a, prep: { slot: 0, scope: 'commission' } } : a)))]
    const g = make({ equipped: ['st_sig', 'st_prep'], packs, features: [feature('commission_stub', (k) => k.activity.define({ kind: 'commission', owner: 'commission_stub', order: 90, active: (s) => (s.flags.cm === true ? { id: 'cm1', label: '委託' } : null), allow: ['commit:'], reason: () => '委託進行中。' }))], flags: { cm: true } })
    g.commit(prep(g.k, g.state, 'pc', 'st_prep'))
    const owner = opens(g)[0]!.owner
    g.commit(draft([], [{ layer: 'meat', text: '開場。', tag: 'opinion.open', data: { owner } }]))
    expect(preparedOf(g)).toEqual([{ id: 'st_prep', scope: 'commission', key: 'cm1' }])
    expect(opens(g)).toHaveLength(1)
  })

  it('輿論的預備不會被下一場現實戰鬥帶走（bringsIn 不算它）', () => {
    const g = make({ equipped: ['st_sig', 'st_prep'] })
    g.commit(prep(g.k, g.state, 'pc', 'st_prep'))
    expect(preparedOf(g)).toHaveLength(1)
  })
})

// ===================================================================================================================
// opinion.check
// ===================================================================================================================

describe('opinion.check：內容載入之後，每個技能的輿論欄經它驗', () => {
  const load = (abilities: Rec[], features: Feature[] = [CHECKER]) => () => {
    const k = createKernel([...BASE, ...features])
    k.content.loadPack(pack(abilities))
    readyFeatures(k)
    return k
  }
  const patch = (id: string, more: Rec): Rec[] => ABILITIES.map((a) => (a.id === id ? { ...a, ...more } : a))

  it('替身回一條問題：整批擋下，並寫出是哪個技能', () => {
    expect(load(patch('st_act', { opinion: { effects: [{ kind: 'bad' }] } }))).toThrow(/st_act：輿論欄：這個效果不在封閉清單裡/)
    expect(load(patch('st_pas', { opinion: { mods: [{ kind: 'bad' }] } }))).toThrow(/st_pas：輿論欄/)
    expect(load(patch('st_prep', { opinion: { open: { voice: 1, cards: ['bad'] } } }))).toThrow(/st_prep：輿論欄/)
  })

  it('每一種都交給了替身：主動是 move、被動與姿態與反應是 passive、預備是 open；共鳴也驗', () => {
    CHECKS.length = 0
    load(ABILITIES)()
    const whats = new Set(CHECKS.map((c) => c.what))
    expect([...whats].sort()).toEqual(['move', 'open', 'passive'])
    expect(CHECKS.some((c) => c.what === 'passive' && c.data.id === 'res:st:0')).toBe(true)
    expect(CHECKS.some((c) => c.what === 'move' && c.data.id === 'st_act' && c.data.cost === 2 && c.data.limit.n === 1)).toBe(true)
    // pending 的不驗
    expect(CHECKS.some((c) => c.data.id === 'st_pending')).toBe(false)
  })

  it('共鳴的輿論欄有問題也擋下', () => {
    const k = (paths: Rec[]) => () => { const kk = createKernel([...BASE, CHECKER]); kk.content.loadPack(pack(ABILITIES, paths)); readyFeatures(kk) }
    expect(k([{ ...PATHS[0], resonance: [{ tier: 2, cells: 1, text: '共鳴。', opinion: { mods: [{ kind: 'bad' }] } }] }, PATHS[1]!, PATHS[2]!])).toThrow(/st：resonance\[0\]：輿論欄/)
  })

  it('沒有人回答 opinion.check 時照樣載入（資料只是資料）：只查形狀', () => {
    expect(load(ABILITIES, [])).not.toThrow()
    expect(load(patch('st_act', { opinion: { effects: [{ kind: 'bad' }] } }), [])).not.toThrow()
  })

  it('形狀不對在檢查前就擋下：主動沒寫 edit、被動沒寫 mods、姿態沒寫 stance、預備沒寫 prep.scope、反應花錢', () => {
    const noEdit = patch('st_act', { use: { opinion: { per_turn: 1 } } })
    expect(load(noEdit, [])).toThrow(/st_act：主動技能的輿論欄要寫 use\.opinion\.edit/)
    expect(load(patch('st_pas', { opinion: {} }), [])).toThrow(/st_pas：opinion\.mods 要是陣列/)
    expect(load(patch('st_stance', { opinion: { mods: [{ kind: 'line_first', amount: 1 }] } }), [])).toThrow(/st_stance：姿態的輿論欄要寫 stance: true/)
    expect(load(patch('st_prep', { prep: { slot: 0 } }), [])).toThrow(/st_prep：預備的輿論欄要在 prep\.scope/)
    expect(load(patch('st_rea', { use: { opinion: { edit: 1, cash: 100 } } }), [])).toThrow(/st_rea：反應的花費只能是編輯點/)
    expect(load(patch('st_act', { opinion: { effects: [{ kind: 'voice', amount: 1 }], extra: 1 } }), [])).toThrow(/st_act：.*extra/)
  })

  it('一個招只認一個次數限制；per_war 與 per_fight 不能並寫；cash 要整數、favor 只有 small、mid', () => {
    expect(load(patch('st_act', { use: { opinion: { edit: 1, per_turn: 1, per_war: 2 } } }), [])).toThrow(/次數只能寫一種/)
    expect(load(patch('st_act', { use: { opinion: { edit: 1, per_war: 1, per_fight: 1 } } }), [])).toThrow(/同一個意思/)
    expect(load(patch('fx_cash', { use: { opinion: { edit: 1, cash: 'grade*100' } } }), [])).toThrow(/fx_cash.*cash/)
    expect(load(patch('fx_favor', { use: { opinion: { edit: 1, favor: 'big' } } }), [])).toThrow(/favor 只能是 small 或 mid/)
  })

  it('use.edit 只有輿論那一組能寫；日常、預備不能寫 edit', () => {
    expect(load(patch('st_act', { use: { meat: { ap: 1, edit: 2 }, opinion: { edit: 1 } } }), [])).toThrow(/use\.meat\.edit 只有輿論用/)
    expect(load(patch('st_prep', { use: { opinion: { edit: 1 } } }), [])).toThrow(/st_prep：prep 技能的 use\.opinion 不能寫 edit/)
  })

  it('daily.stat 的 id 要是十個裡的；加值要是數字或 { amount?, per_tier?, min?, max? }；tier_min 是 1～5', () => {
    const dl = (daily: Rec) => load(patch('st_daily', { daily: { kind: 'studio', ...daily } }), [])
    expect(dl({ stat: { footage_bad: 1 } })).toThrow(/daily\.stat\.footage_bad 不是可以用的鍵/)
    expect(dl({ stat: { footage_quality: 0 } })).toThrow(/daily\.stat\.footage_quality 要是不為 0 的數字/)
    expect(dl({ stat: { footage_quality: '1' } })).toThrow(/daily\.stat\.footage_quality 要是數字/)
    expect(dl({ stat: { footage_cap: { max: 2 } } })).toThrow(/要寫 amount 或 per_tier/)
    expect(dl({ stat: {} })).toThrow(/至少要寫一項/)
    expect(dl({ stat: { footage_quality: 1 }, tier_min: 6 })).toThrow(/tier_min 要是 1～5/)
    expect(dl({ stat: { episode_bonus: 1, flow_tier: { amount: 1 } }, tier_min: 2 })).not.toThrow()
  })
})

// ===================================================================================================================
// 樹在輿論戰沒有效果
// ===================================================================================================================

describe('domains.opinion 是 none 的樹：不回任何東西', () => {
  it('槍手裝著什麼都不回；資料寫了 opinion 欄會被擋下（包括共鳴）', () => {
    const g = make({ equipped: ['gn_sig', 'gn_act'] })
    expect(moves(g)).toEqual([])
    expect(passives(g)).toEqual([])
    expect(opens(g)).toEqual([])
    const bad = (abilities: Rec[], paths = PATHS) => () => { const k = createKernel(BASE); k.content.loadPack(pack(abilities, paths)); readyFeatures(k) }
    expect(bad(ABILITIES.map((a) => (a.id === 'gn_act' ? { ...a, opinion: { effects: [{ kind: 'voice', amount: 1 }] } } : a)))).toThrow(/gn_act：gn 樹在輿論沒有效果（domains\.opinion 是 none），opinion 要是 null/)
    expect(bad(ABILITIES, [PATHS[0]!, PATHS[1]!, { ...PATHS[2]!, resonance: [{ tier: 1, cells: 1, text: '共鳴。', opinion: { mods: [{ kind: 'ep', amount: 1 }] } }] }])).toThrow(/gn：resonance\[0\]\.opinion：這棵樹在輿論戰沒有效果/)
  })

  it('就算那個人學著別棵樹的輿論技能，槍手樹本身仍然不回（樹階以內的夥伴也一樣）', () => {
    const g = make({ equipped: [], actors: [mate('g3', 'gn', 3)] })
    expect(moves(g, ['g3'])).toEqual([])
    expect(passives(g, ['g3'])).toEqual([])
  })
})

// ===================================================================================================================
// 日常：衍生數值
// ===================================================================================================================

describe('日常技能的衍生數值（daily.stat、tier_min）', () => {
  it('裝著的人：素材品質 +1；素材上限 = 樹階（最多 2）；樹階 3 以上才有剪片擇一', () => {
    const at = (spent: number, equipped = ['st_sig', 'st_daily', 'st_daily3']) => make({ equipped, spent: { st: spent } })
    // 樹階 1（0 點）
    let g = at(0)
    expect(stat(g, 'footage_quality')).toBe(1)
    expect(stat(g, 'footage_cap')).toBe(1)
    expect(stat(g, 'cut_pick')).toBe(0)
    // 樹階 2（40 點）
    g = at(40)
    expect(stat(g, 'footage_cap')).toBe(2)
    expect(stat(g, 'cut_pick')).toBe(0)
    // 樹階 3（120 點）：上限仍是 2，剪片擇一 1
    g = at(120)
    expect(stat(g, 'footage_cap')).toBe(2)
    expect(stat(g, 'cut_pick')).toBe(1)
    expect(stat(g, 'footage_quality')).toBe(1)
  })

  it('沒裝著不算；橋關著（斷線靜修）也不算', () => {
    const g = make({ learned: ['st_sig', 'st_daily'], equipped: ['st_sig'] })
    expect(stat(g, 'footage_quality')).toBe(0)
  })

  it('夥伴：只算隊伍裡的人；照路數的樹階（tier_min 也看路數那一列）', () => {
    const g = make({ equipped: [], actors: [mate('m2', 'st', 2), mate('m3', 'st', 3)] })
    expect(stat(g, 'footage_quality', 'm2')).toBe(1)
    expect(stat(g, 'footage_cap', 'm2')).toBe(2)
    expect(stat(g, 'cut_pick', 'm2')).toBe(0)
    expect(stat(g, 'cut_pick', 'm3')).toBe(1)
    // 不在隊伍裡（留守）的人不算
    g.state.party = g.state.party.filter((x) => x !== 'm3')
    expect(stat(g, 'cut_pick', 'm3')).toBe(0)
  })

  it('衍生數值沒有人定義時不丟錯（forge_bonus 沒定義：載入、裝著都沒事，問不到而已）', () => {
    const g = make({ equipped: ['st_sig', 'st_forge'] })
    expect(g.k.stats.hasStat('forge_bonus')).toBe(false)
    // 後來有人定義、而且 provider 在 ready 之前掛的才會算：這裡只確認沒出事
    expect(stat(g, 'footage_quality')).toBe(0)
  })

  it('衍生數值是別的功能定義的：provider 掛在 ready，定義得晚的功能（install 之後）也問得到', () => {
    const late = feature('late_stats', (k) => k.stats.defineStat({ id: 'forge_bonus', owner: 'late_stats', name: 'forge_bonus', base: () => 0, min: 0, max: 9 }))
    const g = make({ equipped: ['st_sig', 'st_forge'], features: [late] })
    expect(stat(g, 'forge_bonus')).toBe(2)
  })
})

// ===================================================================================================================
// 老粉都在
// ===================================================================================================================

describe('老粉都在：導流階的 +1 只在本來的導流階大於 0 時才加', () => {
  it('基礎是 0（沒有頻道）時裝著它還是 0；基礎是 1 時是 2', () => {
    const none = make({ equipped: ['st_sig', 'st_fans'], features: [FLOW] })
    expect(stat(none, FLOW_TIER_STAT)).toBe(0)
    const one = make({ equipped: ['st_sig', 'st_fans'], features: [FLOW], flags: { flow: 1 } })
    expect(stat(one, FLOW_TIER_STAT)).toBe(2)
    // 沒裝時就是本來的
    expect(stat(make({ equipped: ['st_sig'], features: [FLOW], flags: { flow: 1 } }), FLOW_TIER_STAT)).toBe(1)
  })

  it('沒有人替導流階加本來的值（channel 沒裝）：還是 0；問的人多次呼叫結果一樣（沒有遞迴的殘留）', () => {
    const g = make({ equipped: ['st_sig', 'st_fans'] })
    expect(stat(g, FLOW_TIER_STAT)).toBe(0)
    expect(stat(g, FLOW_TIER_STAT)).toBe(0)
    g.state.flags.flow = 3
    expect(stat(g, FLOW_TIER_STAT)).toBe(0) // 沒有 provider 讀這個旗標
  })

  it('日常技能給的導流階（daily.stat.flow_tier）也算「本來」的：不會被 0 的條件擋掉自己', () => {
    const packs = [pack([...ABILITIES, sk('st_flowd', 'st', 'daily', { daily: { kind: 'flow', stat: { flow_tier: 1 } } })])]
    const g = make({ equipped: ['st_sig', 'st_flowd', 'st_fans'], packs })
    expect(stat(g, FLOW_TIER_STAT)).toBe(2) // 日常給 1，本來大於 0，所以老粉都在再 +1
  })
})

// ===================================================================================================================
// 接上真的 opinion
// ===================================================================================================================

describe('接上真的 opinion', () => {
  const real = async () => {
    const op = await import('../../src/features/opinion')
    const { METER_CONTENT } = await import('../../src/testkit')
    return { op, METER_CONTENT }
  }

  it('opinion.check 由它回答：合格的欄載入；效果不在封閉清單、修正的數字超出範圍、觸發點寫錯的整批擋下並指出技能', async () => {
    const { op } = await real()
    const run = (abilities: Rec[]) => () => {
      const k = createKernel([...BASE, op.opinionFeature, FAVORS])
      k.content.loadPack(pack(abilities))
      readyFeatures(k)
      return k
    }
    expect(run(ABILITIES)).not.toThrow()
    const patch = (id: string, more: Rec): Rec[] => ABILITIES.map((a) => (a.id === id ? { ...a, ...more } : a))
    expect(run(patch('st_act', { opinion: { effects: [{ kind: 'bad' }] } }))).toThrow(/st_act：輿論欄：.*不在效果的封閉清單裡/)
    expect(run(patch('st_pas', { opinion: { mods: [{ kind: 'fuel_first', amount: 99 }] } }))).toThrow(/st_pas：輿論欄/)
    expect(run(patch('st_rea', { opinion: { on: 'foe.nothing', effects: [{ kind: 'negate' }] } }))).toThrow(/st_rea：輿論欄.*觸發點/)
    expect(run(patch('st_prep', { opinion: { open: { voice: 99 } } }))).toThrow(/st_prep：輿論欄/)
  })

  it('一場真的戰役：招、被動、開著的姿態、預備的開場；花錢的招記一筆戰役外的 cash 後果；用過的預備清掉', async () => {
    const { op, METER_CONTENT } = await real()
    const toy = feature('real_toy', (k) => {
      k.content.defineKind({ kind: 'district', owner: 'real_toy', validate: () => [] })
      for (const [kind, def] of [
        ['subs', { name: '訂閱', min: 0, max: Infinity, start: 0, keyed: 'none' }], ['credibility', { name: '公信力', min: 0, max: 100, start: 50, keyed: 'none' }],
        ['popularity', { name: '人氣', min: 0, max: 100, start: 0, keyed: 'npc' }], ['hostility', { name: '敵對值', min: 0, max: 100, start: 0, keyed: 'faction' }], ['fame', { name: '豔名', min: 0, max: 100, start: 0, keyed: 'district' }],
      ] as Array<[string, Rec]>) k.meters.define({ kind, owner: 'real_toy', ...def } as never)
    })
    const SC = { kaleido: 3, sakura: 2, nightingale: 1, tape: 1, doujin: 1, fanclub: 1, whisper: 1, wall: 1, relay: 0 }
    const opPack = {
      id: 'real_op',
      content: {
        city_card: ['city_scandal', 'city_festival', 'city_algo', 'city_graduation', 'city_blackout', 'city_quiet'].map((id) => ({ id, name: id, effect: { kind: 'none' } })),
        topic: [{ id: 'tp', name: '測試議題', kind: 'ignite', scores: SC, involves: { factions: ['f_alpha'], people: [], types: ['scandal'] } }],
        pr_opponent: [{ id: 'pr_idle', name: '不動的對手', faction: 'f_alpha', strength: 1, start: 'opposite', cell_priority: {}, actions: [{ do: 'release', when: 'round > 99' }] }],
      },
    } as unknown as ContentPack
    const district = { id: 'real_d', content: { district: [{ id: 'd_a', name: '甲區' }] } } as unknown as ContentPack
    const { game: g } = makeGame({
      features: [toy, op.opinionFeature, combatFeature, abilitiesFeature, STATS, FAVORS], content: [METER_CONTENT, district, opPack, pack()], seed: 7,
      pc: { ext: { bridge: { capacity: { meat: 12, net: 12, social: 12, media: 12 } }, abilities: abilityState({ equipped: ['st_sig', 'st_act', 'st_pas', 'st_stance', 'st_prep', 'fx_sig', 'fx_cash'], spent: { st: 0 } }) } },
      patch: { time: { day: 3, hour: 10, minute: 0 }, location: { district: 'd_a' }, flags: { ok: true }, money: { cred: 100, cash: 500 } } as never,
    })
    // 開戰前：開姿態、預備
    g.commit(stance(g.k, g.state, 'pc', 'st_stance'))
    g.commit(prep(g.k, g.state, 'pc', 'st_prep'))
    expect(preparedOf(g)).toHaveLength(1)
    g.launch('opinion', { topic: 'tp', foe: 'pr_idle' })
    const war = op.readWar(g.state)!
    // 預備的開場：聲量 +2；預備用掉了
    expect(war.voice.you).toBeGreaterThanOrEqual(2)
    expect(preparedOf(g)).toEqual([])
    // 被動與姿態：戰役存著的被動裡有它們（招牌的 forged_ok、被動的 fuel_first、開著的姿態的 line_first）
    const ids = war.passives.map((p: Rec) => p.id)
    expect(ids).toEqual(expect.arrayContaining(['st_sig', 'st_pas', 'st_stance']))
    // 招：st_act 花 2 點，聲量 +3、風向 +1
    const before = { voice: war.voice.you, wind: war.wind, ep: war.desk[0]!.ep }
    const view = op.movesView(g.k, g.state)
    expect(view.moves.map((m) => m.id).sort()).toEqual(['fx_cash', 'st_act'])
    g.commit(op.useMove(g.k, g.state, { id: 'st_act' }))
    const after = op.readWar(g.state)!
    expect(after.voice.you - before.voice).toBe(3)
    expect(after.wind - before.wind).toBe(1)
    expect(after.desk[0]!.ep).toBe(before.ep - 2)
    // 每回合 1 次：第二次被擋，原因寫出來
    expect(op.moveBlock(g.k, g.state, { id: 'st_act' })).toMatch(/次數用完了|編輯點不夠/)
    // 花錢的招：效果加一筆戰役外的 cash −300（結算時才扣）；現金不夠時灰掉
    op.readWar(g.state)!.desk[0]!.ep = 3 // 編輯點用完了，測試補一點
    g.state.money.cash = 100
    expect(op.moveBlock(g.k, g.state, { id: 'fx_cash' })).toBe('現金要在 300 以上。')
    g.state.money.cash = 500
    expect(op.moveBlock(g.k, g.state, { id: 'fx_cash' })).toBeNull()
    g.commit(op.useMove(g.k, g.state, { id: 'fx_cash' }))
    expect(op.readWar(g.state)!.out).toEqual([{ kind: 'cash', amount: -300 }])
  })
})
