// 驗收測試：dev/work/M4-creation-lifepath.md（cpp-feature）。建角第 5 步：生命軌跡。八張表的格式、選或擲或跳過、結果只能是規定的幾種、
// 照內容篩選過濾、提交時變成遊戲裡的東西（NPC 與名冊、債、旗標、傾向、性經歷記錄、橋參數、出身的固定傾向與豔名）。
// 規格：CHARACTER 第 3 節、5.5 節、第 6 節的 lifepath_entry、第 2 節歡場與櫻町的固定傾向；LEWD_SYSTEM 1.1 節；NPC_SYSTEM 4.1 節；EVENTS 2.4 節；dev/adr/0019 第十一節。
// 內容一律用測試自帶的最小假資料（每張表兩三條，含一條帶篩選標籤的、一條只有車族看得到的、一條 effects 給錢與債的）。

import { describe, expect, it } from 'vitest'
import type { ContentPack, Feature, Game } from '../../src'
import { ContentError } from '../../src'
import { billsFeature, readBills } from '../../src/features/bills'
import { characterFeature } from '../../src/features/character'
import type { CreationDraft } from '../../src/features/creation'
import { buildCreationReport, creationBlocks, creationFeature, lifepathBlock, lifepathResults, lifepathRoll, lifepathTables } from '../../src/features/creation'
import { LIFEPATH_TABLES } from '../../src/features/creation'
import { lewdFeature } from '../../src/features/lewd'
import { npcsFeature, readNpcs } from '../../src/features/npcs'
import { readRoster, rosterFeature } from '../../src/features/roster'
import { commitViolations, makeGame, meterFeature, testMeter } from '../../src/testkit'
import { MINI_PACK } from '../helpers/miniContent'

type Rec = Record<string, any>

// ---- 假資料 ----

const entry = (table: string, id: string, text: string, over: Rec = {}): Rec => ({ id, table, text, result: {}, ...over })

const ENTRIES: Rec[] = [
  // 家人：照出身換說法；一個沒有結果
  entry('family', 'fam_tower', '住在同一棟塔', { texts: { biker: '還在車隊上跑' }, result: { npc: { role: 'family', faction_from: 'origin', affinity: 20 } } }),
  entry('family', 'fam_gone', '失散了', {}),
  // 那件事：債與沉溺的下限；只有車族看得到的；帶篩選標籤的
  entry('incident', 'inc_debt', '欠了一筆債', { result: { effects: [{ kind: 'debt', to: 'lonestar', amount: 2000, rate: 0.05 }, { kind: 'sink_floor', amount: 5 }] } }),
  entry('incident', 'inc_biker', '車隊散夥時分到一筆錢', { origins: ['biker'], result: { effects: [{ kind: 'cash', amount: 100 }] } }),
  entry('incident', 'inc_dark', '被人用過一次', { tags: ['lp_dark'], result: { effects: [{ kind: 'cash', amount: 100 }] } }),
  // 朋友、仇人、舊情：各有一個人；朋友在名冊上
  entry('friend', 'fr_old', '一起長大的', { result: { npc: { role: 'friend', faction_from: 'origin', affinity: 30, roster: true } } }),
  entry('friend', 'fr_none', '沒什麼朋友'),
  entry('enemy', 'en_rival', '搶同一個位置的', { result: { npc: { role: 'enemy', faction_from: 'rouge', affinity: -20, hostility: 15 } } }),
  entry('enemy', 'en_loose', '一個沒有勢力的仇人', { result: { npc: { role: 'enemy', hostility: 10 } } }),
  entry('ex', 'ex_gone', '分了', { result: { npc: { role: 'ex', affinity: 10 } } }),
  // 第二個朋友（放在舊情那張表，用來測「朋友最多一位」）
  entry('ex', 'ex_friendish', '分了之後還是朋友', { result: { npc: { role: 'friend', affinity: 5 } } }),
  entry('want', 'want_money', '錢', { result: { goal: 'get_rich' } }),
  entry('want', 'want_leave', '離開這座城', { result: { goal: 'leave_city' } }),
  // 性經歷：全部帶「成人」標籤，關掉之後整張表不列
  entry('sex', 'sex_some', '普通', { tags: ['lp_adult'], result: { sex_record: { times: 12, partners: 3, service_times: 2 }, bridge: { craving: 8, tolerance: -5, sensitivity: 10 }, tendency: [{ tag: 't_praise' }] } }),
  entry('sex', 'sex_many', '豐富', { tags: ['lp_adult'], result: { sex_record: { times: 40, partners: 9, service_times: 20 }, axis: { relation: 1 } } }),
  // 潛在性癖：一條「潛在」、一條結果裡的標籤被篩掉的
  entry('kink', 'kink_rope', '被綁過', { result: { tendency: [{ tag: 't_rope', state: 'latent' }] } }),
  entry('kink', 'kink_watch', '被看過', { result: { tendency: [{ tag: 't_watch', state: 'has' }] } }),
]

const PACK: ContentPack = {
  id: 'lifepath_test',
  content: {
    origin: [
      { id: 'biker', name: '車族', line: '荒地上的人', skill_bonus: { stealth: 1 }, status: 'unregistered', home: 'd_port', favor: { choose_one: ['rouge'], value: 25 }, perk: 'origin_oldport', roster: ['npc_ray'] },
      { id: 'brothel', name: '歡場', line: '四十二番街的店裡長大', skill_bonus: { perform: 1 }, status: 'citizen', home: 'd_42', favor: { choose_one: ['nora'], value: 25 }, perk: 'origin_hive', roster: ['npc_ray'], tendency: { axes: { costume: 1 }, tags: ['t_brothel'] }, fame: { d_42: 10 } },
    ],
    district: [{ id: 'd_42', name: '四十二番街' }, { id: 'd_port', name: '舊港' }],
    lifepath_entry: ENTRIES,
  },
} as unknown as ContentPack

/** 傾向的標籤是 lewd 定義的內容種類：只裝 creation 的局沒有它。 */
const LEWD_PACK: ContentPack = {
  id: 'lifepath_lewd_test',
  content: {
    tendency_tag: [
      { id: 't_brothel', name: '歡場', axis: 'costume' },
      { id: 't_praise', name: '溺愛', axis: 'relation' },
      { id: 't_rope', name: '束縛', axis: 'relation' },
      { id: 't_watch', name: '窺視', axis: 'sense' },
    ],
  },
} as unknown as ContentPack

/** 區的內容種類是世界的功能定義的；這裡只要查得到區的 id，用一個最小的替身。 */
const districtKind: Feature = { id: 'lp_district', install(k) { k.content.defineKind({ kind: 'district', owner: 'lp_district', validate: () => [] }) } }
const hostility = meterFeature(testMeter({ kind: 'hostility', name: '敵對值', keyed: 'faction' }))

const FULL: Feature[] = [characterFeature, lewdFeature, npcsFeature, rosterFeature, billsFeature, districtKind, hostility, creationFeature]
const ONLY_CREATION: Feature[] = [characterFeature, districtKind, creationFeature]

const setup = (features: Feature[] = FULL, o: Rec = {}): Game =>
  makeGame({ scenario: 'beforeCreation', features, content: [MINI_PACK, PACK, ...(features.includes(lewdFeature) ? [LEWD_PACK] : []), ...(o.content ?? [])], seed: 11, ...(o.patch ? { patch: o.patch } : {}) }).game

const draft = (over: Partial<CreationDraft> = {}): CreationDraft => ({
  name: '露', gender: 'female', age: 22,
  origin: 'biker',
  attrPick: { reflex: 15, charm: 14, intellect: 13, body: 12, resolve: 10, tech: 8 },
  attrBonus: { tech: -4, reflex: 3, resolve: 3 },
  skills: { streetwise: 3, negotiate: 3, perform: 2, stealth: 2 },
  perks: ['smooth_talker', 'tough'],
  ...over,
})

/** 提交，回傳 creation.commit 那一份報告（後面接著的是名冊等功能補的報告）。 */
const create = (g: Game, d: CreationDraft) => ({ report: g.commit(buildCreationReport(g.k, g.state, d))[0]! })
const pc = (g: Game) => g.state.actors.pc!
const problems = (g: Game, d: CreationDraft) => creationBlocks(g.k, g.state, d).filter((b) => b.step === 'lifepath').map((b) => b.reason)
const withOff = (...tags: string[]) => ({ patch: { rules: { contentOff: tags } as never } })
const meter = (g: Game, kind: string, key: string): number => ((g.state.meters as Rec)[kind]?.[key] as number | undefined) ?? 0

// ===================================================================================================================

describe('lifepathTables：看得到哪些', () => {
  it('蜂巢那樣的別的出身看不到車族限定的那一條；車族看得到；整張表照八張的順序列', () => {
    const g = setup()
    const ids = (origin: string, table: string) => lifepathTables(g.k, g.state, { origin }).find((t) => t.table === table)?.options.map((o) => o.id)
    expect(ids('biker', 'incident')).toEqual(['inc_debt', 'inc_biker', 'inc_dark'])
    expect(ids('brothel', 'incident')).toEqual(['inc_debt', 'inc_dark'])
    expect(lifepathTables(g.k, g.state, { origin: 'biker' }).map((t) => t.table)).toEqual(['family', 'incident', 'friend', 'enemy', 'ex', 'want', 'sex', 'kink'])
    expect(LIFEPATH_TABLES).toEqual(['family', 'incident', 'friend', 'enemy', 'ex', 'want', 'sex', 'kink'])
  })

  it('篩選關掉那個標籤之後那一條不列；結果裡的傾向標籤被關掉的也不列；sex 表的條目全部被篩掉時整張表不列', () => {
    const g = setup(FULL, withOff('lp_dark', 'lp_adult', 't_watch'))
    const tables = lifepathTables(g.k, g.state, { origin: 'biker' })
    expect(tables.find((t) => t.table === 'incident')!.options.map((o) => o.id)).toEqual(['inc_debt', 'inc_biker'])
    expect(tables.find((t) => t.table === 'sex')).toBeUndefined()
    expect(tables.find((t) => t.table === 'kink')!.options.map((o) => o.id)).toEqual(['kink_rope'])
    // 關掉別的、不是這條的標籤不影響
    const plain = setup(FULL, withOff('lp_other'))
    expect(lifepathTables(plain.k, plain.state, { origin: 'biker' }).find((t) => t.table === 'sex')!.options).toHaveLength(2)
  })

  it('文字照出身換：texts 有這個出身的用它，否則用 text；結果不因為文字不同而不同', () => {
    const g = setup()
    const text = (origin: string) => lifepathTables(g.k, g.state, { origin }).find((t) => t.table === 'family')!.options[0]!.text
    expect(text('biker')).toBe('還在車隊上跑')
    expect(text('brothel')).toBe('住在同一棟塔')
    const a = create(setup(), draft({ origin: 'biker', lifepath: { family: 'fam_tower' } }))
    const b = create(setup(), draft({ origin: 'brothel', originChoice: { favor: 'nora' }, lifepath: { family: 'fam_tower' } }))
    expect(a.report.changes.some((c) => c.op === 'npcs.gen')).toBe(true)
    expect(b.report.changes.some((c) => c.op === 'npcs.gen')).toBe(true)
  })

  it('origin 的 lifepath_extra 認領的條目，只有那個出身看得到', () => {
    const extra: ContentPack = { id: 'extra', content: { lifepath_entry: [entry('want', 'want_port', '碼頭上的一件事', {})] } } as unknown as ContentPack
    const origins: ContentPack = { id: 'extra_origin', content: { origin: [{ id: 'dock', name: '碼頭', line: '碼頭的人', skill_bonus: { stealth: 1 }, status: 'citizen', home: 'd_port', favor: { choose_one: ['rouge'], value: 25 }, perk: 'origin_oldport', roster: ['npc_ray'], lifepath_extra: ['want_port'] }] } } as unknown as ContentPack
    const g = setup(FULL, { content: [extra, origins] })
    const want = (origin: string) => lifepathTables(g.k, g.state, { origin }).find((t) => t.table === 'want')!.options.map((o) => o.id)
    expect(want('dock')).toEqual(['want_money', 'want_leave', 'want_port'])
    expect(want('biker')).toEqual(['want_money', 'want_leave'])
    expect(problems(g, draft({ lifepath: { want: 'want_port' } }))).toEqual(['「碼頭上的一件事」是別的出身才有的選項。'])
  })
})

describe('檢查：第 5 步', () => {
  it('全部可以跳過；沒寫、寫 skip 都過得了', () => {
    const g = setup()
    expect(problems(g, draft())).toEqual([])
    expect(problems(g, draft({ lifepath: Object.fromEntries(LIFEPATH_TABLES.map((t) => [t, 'skip'])) }))).toEqual([])
    expect(lifepathBlock(g.k, g.state, draft({ lifepath: { family: 'fam_gone', want: 'want_money' }, kinks: [] }))).toBeNull()
  })

  it('選了被篩掉的、選了別張表的、選了查不到的、選了別的出身的，各被擋並有原因', () => {
    const g = setup(FULL, withOff('lp_dark'))
    expect(problems(g, draft({ lifepath: { incident: 'inc_dark' } }))).toEqual(['「被人用過一次」被你的內容篩選關掉了，選不了。'])
    expect(problems(g, draft({ lifepath: { friend: 'en_rival' } }))).toEqual(['「搶同一個位置的」不是「朋友」這張表的選項。'])
    expect(problems(g, draft({ lifepath: { friend: 'nope' } }))).toEqual(['「朋友」這張表沒有「nope」這個選項。'])
    expect(problems(g, draft({ origin: 'brothel', originChoice: { favor: 'nora' }, lifepath: { incident: 'inc_biker' } }))).toEqual(['「車隊散夥時分到一筆錢」是別的出身才有的選項。'])
    expect(() => buildCreationReport(g.k, g.state, draft({ lifepath: { incident: 'inc_dark' } }))).toThrow('被你的內容篩選關掉了')
    expect(creationBlocks(g.k, g.state, draft({ lifepath: { incident: 'inc_dark' } })).map((b) => b.step)).toEqual(['lifepath'])
  })

  it('朋友與仇人各最多一位（看 result.npc 的角色）', () => {
    const g = setup()
    expect(problems(g, draft({ lifepath: { friend: 'fr_old', ex: 'ex_friendish' } }))).toEqual(['朋友最多一位。'])
    expect(problems(g, draft({ lifepath: { friend: 'fr_old', enemy: 'en_rival', ex: 'ex_gone' } }))).toEqual([])
  })

  it('kinks：三個被擋、用被關掉的標籤被擋、不是標籤被擋、重複被擋；兩個可以', () => {
    const g = setup(FULL, withOff('t_watch'))
    expect(problems(g, draft({ kinks: [{ tag: 't_rope' }, { tag: 't_praise' }, { tag: 't_brothel' }] }))).toEqual(['潛在性癖最多選 2 個。'])
    expect(problems(g, draft({ kinks: [{ tag: 't_watch' }] }))).toEqual(['「窺視」這個題材被你的內容篩選關掉了，選不了。'])
    expect(problems(g, draft({ kinks: [{ tag: 'nothing' }] }))).toEqual(['「nothing」不是傾向的標籤。'])
    expect(problems(g, draft({ kinks: [{ tag: 't_rope' }, { tag: 't_rope', latent: true }] }))).toEqual(['「束縛」不能選兩次。'])
    expect(problems(g, draft({ kinks: [{ tag: 't_rope' }, { tag: 't_praise', latent: true }] }))).toEqual([])
  })
})

describe('lifepathRoll：擲', () => {
  it('同一個種子兩次一樣；重擲換次數，順序固定；擲到的一定是看得到的條目', () => {
    const g = setup()
    const d = { origin: 'biker' }
    for (const table of LIFEPATH_TABLES) {
      const seq = [0, 1, 2, 3, 4, 5].map((n) => lifepathRoll(g.k, g.state, d, table, n))
      expect(seq).toEqual([0, 1, 2, 3, 4, 5].map((n) => lifepathRoll(g.k, g.state, d, table, n)))
      const visible = lifepathTables(g.k, g.state, d).find((t) => t.table === table)!.options.map((o) => o.id)
      for (const id of seq) expect(visible).toContain(id)
      expect(lifepathRoll(g.k, g.state, d, table)).toBe(seq[0])
    }
    // 另一個種子換一組順序（八張表加起來不可能全部一樣）
    const other = makeGame({ scenario: 'beforeCreation', features: FULL, content: [MINI_PACK, PACK, LEWD_PACK], seed: 99 }).game
    const rolls = (game: Game) => LIFEPATH_TABLES.flatMap((t) => [0, 1, 2, 3].map((n) => lifepathRoll(game.k, game.state, d, t, n)))
    expect(rolls(other)).not.toEqual(rolls(g))
  })

  it('被篩掉的條目擲不到；整張表沒有條目回傳 null', () => {
    const g = setup(FULL, withOff('lp_adult', 'lp_dark'))
    const seen = new Set([0, 1, 2, 3, 4, 5, 6, 7].map((n) => lifepathRoll(g.k, g.state, { origin: 'brothel' }, 'incident', n)))
    expect(seen.has('inc_dark')).toBe(false)
    expect(seen.has('inc_biker')).toBe(false)
    expect(lifepathRoll(g.k, g.state, { origin: 'biker' }, 'sex')).toBeNull()
  })
})

describe('提交：全部功能都裝', () => {
  const FULL_PICK = (): CreationDraft => draft({
    lifepath: { family: 'fam_tower', incident: 'inc_debt', friend: 'fr_old', enemy: 'en_rival', ex: 'ex_gone', want: 'want_money', sex: 'sex_some', kink: 'kink_rope' },
    kinks: [{ tag: 't_watch' }, { tag: 't_brothel', latent: true }],
  })

  it('friend：生成一個 NPC、親密度是資料寫的、他在名冊上；樣子跟著出身給好感的勢力', () => {
    const g = setup()
    g.k.probe.start()
    create(g, FULL_PICK())
    expect(commitViolations(g.k, g.k.probe.stop())).toEqual([])
    const friend = readNpcs(g.state).gen.gen_lp_friend!
    expect(friend).toMatchObject({ kind: 'citizen', faction: 'rouge', flags: ['lifepath:friend'] })
    expect(friend.age).toBeGreaterThanOrEqual(18)
    expect(g.state.actors.gen_lp_friend!.name).toBe(friend.name)
    expect(meter(g, 'affinity', 'gen_lp_friend')).toBe(30)
    expect(readNpcs(g.state).rel.gen_lp_friend!.relation).toBe('朋友')
    expect(Object.keys(readRoster(g.state).members)).toContain('gen_lp_friend')
    expect(pc(g).ext.origin).toMatchObject({ id: 'biker', roster: ['npc_ray', 'gen_lp_friend'] })
    // 沒有 roster: true 的家人、舊情不進名冊，但都在人物名單裡、認識
    expect(Object.keys(readRoster(g.state).members)).not.toContain('gen_lp_family')
    expect(meter(g, 'affinity', 'gen_lp_family')).toBe(20)
    expect(meter(g, 'affinity', 'gen_lp_ex')).toBe(10)
    // 名字不重複
    const names = ['family', 'friend', 'enemy', 'ex'].map((r) => g.state.actors[`gen_lp_${r}`]!.name)
    expect(new Set(names).size).toBe(4)
  })

  it('enemy：帶著敵對值（所屬勢力的敵對值加資料寫的量）、親密度是負的、生成的人記旗標；沒有勢力的仇人敵對值沒有地方記（提醒）', () => {
    const g = setup()
    const r = create(g, draft({ lifepath: { enemy: 'en_rival' } }))
    expect(readNpcs(g.state).gen.gen_lp_enemy).toMatchObject({ faction: 'rouge', flags: ['lifepath:enemy'] })
    expect(meter(g, 'hostility', 'rouge')).toBe(15)
    expect(meter(g, 'affinity', 'gen_lp_enemy')).toBe(-20)
    expect(readNpcs(g.state).rel.gen_lp_enemy!.relation).toBe('仇人')
    expect(r.report.clamps ?? []).toEqual([])
    const g2 = setup()
    const r2 = create(g2, draft({ lifepath: { enemy: 'en_loose' } }))
    expect(meter(g2, 'hostility', 'rouge')).toBe(0)
    expect(r2.report.clamps!.map((c) => c.notice)).toEqual(['「一個沒有勢力的仇人」的仇人沒有所屬的勢力，敵對值沒有地方記。'])
  })

  it('incident：債在帳單裡；沉溺的下限 +5 是 sink_floor 效果，那個功能沒裝時落空並寫進提醒', () => {
    const g = setup()
    const r = create(g, draft({ lifepath: { incident: 'inc_debt' } }))
    expect(readBills(g.state).debts).toHaveLength(1)
    expect(readBills(g.state).debts[0]).toMatchObject({ to: 'lonestar', principal: 2000 })
    expect(r.report.clamps!.map((c) => [c.path, c.notice])).toEqual([
      ['lifepath.incident.effects[1]', '「欠了一筆債」的一項結果（sink_floor）沒有功能接得住（這一局沒有裝那個功能），沒有算。'],
    ])
    // 車族限定的那一條給錢：落在主角身上
    const g2 = setup()
    const before = g2.state.money.cash
    create(g2, draft({ lifepath: { incident: 'inc_biker' } }))
    expect(g2.state.money.cash).toBe(before + 1500 + 100)
  })

  it('goal：旗標 goal:<id>；沒選的不留', () => {
    const g = setup()
    create(g, FULL_PICK())
    expect(g.state.flags['goal:get_rich']).toBe(true)
    expect(g.state.flags['goal:leave_city']).toBeUndefined()
  })

  it('sex_record 的次數是資料的（只寫三欄）；橋參數照資料微調而且還在 0～100；標籤是「有」', () => {
    const g = setup()
    create(g, FULL_PICK())
    expect(pc(g).ext.sex_record).toEqual({ partners: 3, times: 12, service_times: 2 })
    // 預設 30：慾求 +8、耐受 −5、敏感度 +10、馴化不動
    expect(pc(g).ext.bridge).toEqual({ sensitivity: 40, tolerance: 25, craving: 38, docility: 30 })
    expect((pc(g).ext.tendency as Rec).tags.t_praise).toBe('has')
    // 直接是「有」的標籤不另外加點（軸還是 0）
    expect((pc(g).ext.tendency as Rec).axes.relation).toBe(0)
  })

  it('橋參數夾在 0～100：起點很高時加不過 100、很低時減不過 0', () => {
    const rule: ContentPack = { id: 'rule_hi', content: { lewd_rule: [{ id: 'default', default_bridge: 95 }] } } as unknown as ContentPack
    const hi = setup(FULL, { content: [rule] })
    create(hi, draft({ lifepath: { sex: 'sex_some' } }))
    expect(pc(hi).ext.bridge).toEqual({ sensitivity: 100, tolerance: 90, craving: 100, docility: 95 })
    const lo: ContentPack = { id: 'rule_lo', content: { lewd_rule: [{ id: 'default', default_bridge: 2 }] } } as unknown as ContentPack
    const g = setup(FULL, { content: [lo] })
    create(g, draft({ lifepath: { sex: 'sex_some' } }))
    expect(pc(g).ext.bridge).toEqual({ sensitivity: 12, tolerance: 0, craving: 10, docility: 2 })
  })

  it('kinks：一個「有」、一個「潛在」寫進傾向；潛在的不加點；軸 axis 寫了才加級；潛在不覆蓋「有」', () => {
    const g = setup()
    create(g, FULL_PICK())
    const t = pc(g).ext.tendency as Rec
    expect(t.tags).toEqual({ t_praise: 'has', t_rope: 'latent', t_watch: 'has', t_brothel: 'latent' })
    expect(t.axes).toEqual({ relation: 0, sense: 0, body: 0, costume: 0 })
    // sex_many 的 axis: relation +1；再自己挑一個已經有的標籤「潛在」不降級
    const g2 = setup()
    create(g2, draft({ lifepath: { sex: 'sex_some', kink: 'kink_watch' }, kinks: [{ tag: 't_praise', latent: true }, { tag: 't_watch', latent: true }] }))
    expect((pc(g2).ext.tendency as Rec).tags).toEqual({ t_praise: 'has', t_watch: 'has' })
    const g3 = setup()
    create(g3, draft({ lifepath: { sex: 'sex_many' } }))
    expect((pc(g3).ext.tendency as Rec).axes.relation).toBe(1)
    expect(pc(g3).ext.sex_record).toEqual({ partners: 9, times: 40, service_times: 20 })
  })

  it('一條都不選：沒有生命軌跡的變更、沒有提醒、行為和以前一樣', () => {
    const g = setup()
    const report = buildCreationReport(g.k, g.state, draft())
    expect(report.changes.map((c) => c.op)).toEqual(['actor.add', 'pc', 'cash'])
    expect(report.clamps).toBeUndefined()
    const extKeys = Object.keys((report.changes[0] as Rec).actor.ext).sort()
    expect(extKeys).toEqual(['origin', 'profile'])
    expect(lifepathResults(g.k, g.state, draft())).toEqual([])
  })
})

describe('出身的固定傾向與豔名（歡場）', () => {
  it('歡場：扮相那一軸 1 級、那個風格標籤是「有」、四十二番街的豔名 +10；一條生命軌跡都不選也一樣', () => {
    const g = setup()
    create(g, draft({ origin: 'brothel', originChoice: { favor: 'nora' } }))
    const t = pc(g).ext.tendency as Rec
    expect(t.axes).toEqual({ relation: 0, sense: 0, body: 0, costume: 1 })
    expect(t.tags).toEqual({ t_brothel: 'has' })
    expect(meter(g, 'fame', 'd_42')).toBe(10)
    // 車族沒有
    const g2 = setup()
    create(g2, draft())
    expect(pc(g2).ext.tendency).toBeUndefined()
    expect(meter(g2, 'fame', 'd_42')).toBe(0)
  })

  it('風格標籤被內容篩選關掉：標籤不寫（軸照舊 1 級、豔名照舊）', () => {
    const g = setup(FULL, withOff('t_brothel'))
    const r = create(g, draft({ origin: 'brothel', originChoice: { favor: 'nora' } }))
    const t = pc(g).ext.tendency as Rec
    expect(t.axes.costume).toBe(1)
    expect(t.tags).toEqual({})
    expect(meter(g, 'fame', 'd_42')).toBe(10)
    expect(r.report.clamps!.map((c) => c.notice)).toEqual(['「歡場」這個題材被你的內容篩選關掉了，沒有記下。'])
  })
})

describe('沒有橋、沒裝的功能', () => {
  it('選了沒有橋的草稿：bridge 的微調略過並提醒，其他（傾向、性經歷記錄）照常', () => {
    const g = setup()
    const r = create(g, draft({ bridge: null, lifepath: { sex: 'sex_some' } }))
    expect(pc(g).ext.sex_record).toEqual({ partners: 3, times: 12, service_times: 2 })
    expect((pc(g).ext.tendency as Rec).tags.t_praise).toBe('has')
    expect((pc(g).ext.bridge as Rec | null)).not.toEqual(expect.objectContaining({ craving: 38 }))
    expect(r.report.clamps!.map((c) => c.notice)).toEqual(['你沒有橋，橋參數的起始值沒有地方微調，這一項略過了。'])
  })

  it('只裝 creation 的 kernel：提交帶 npc 的條目不丟錯，沒有人認得的寫進提醒；goal、sex_record 照常', () => {
    const g = setup(ONLY_CREATION)
    const d = draft({ lifepath: { family: 'fam_tower', friend: 'fr_old', want: 'want_money', sex: 'sex_some', incident: 'inc_debt' } })
    expect(problems(g, d)).toEqual([])
    const r = create(g, d)
    expect(r.report.changes.some((c) => c.op === 'npcs.gen')).toBe(false)
    expect(r.report.clamps!.map((c) => c.notice)).toEqual([
      '「還在車隊上跑」的人物沒有功能接得住（這一局沒有裝那個功能），只留下紀錄，不會生效。',
      '「一起長大的」的人物沒有功能接得住（這一局沒有裝那個功能），只留下紀錄，不會生效。',
      '「普通」的傾向、橋參數沒有功能接得住（這一局沒有裝那個功能），只留下紀錄，不會生效。',
      '「欠了一筆債」的一項結果（debt）沒有功能接得住（這一局沒有裝那個功能），沒有算。',
      '「欠了一筆債」的一項結果（sink_floor）沒有功能接得住（這一局沒有裝那個功能），沒有算。',
    ])
    expect(g.state.flags['goal:get_rich']).toBe(true)
    expect(pc(g).ext.sex_record).toEqual({ partners: 3, times: 12, service_times: 2 })
    expect((pc(g).ext.origin as Rec).roster).toEqual(['npc_ray'])
  })

  it('沒有 hostility 量表時仇人的敵對值寫進提醒，人照樣生成', () => {
    const g = setup([characterFeature, lewdFeature, npcsFeature, rosterFeature, billsFeature, districtKind, creationFeature])
    const r = create(g, draft({ lifepath: { enemy: 'en_rival' } }))
    expect(readNpcs(g.state).gen.gen_lp_enemy).toBeDefined()
    expect(r.report.clamps!.map((c) => c.notice)).toEqual(['「搶同一個位置的」的仇人帶著敵對值，但這一局沒有記敵對值的功能，沒有算。'])
  })
})

describe('lifepathResults：總覽頁', () => {
  it('每一條選的條目列出會變成什麼（文字照出身換好）；沒有功能接得住的效果寫明不會生效', () => {
    const g = setup()
    const rows = lifepathResults(g.k, g.state, draft({ lifepath: { family: 'fam_tower', incident: 'inc_debt', enemy: 'en_rival', sex: 'sex_some', want: 'want_money' } }))
    expect(rows.map((r) => [r.table, r.id, r.text])).toEqual([
      ['family', 'fam_tower', '還在車隊上跑'], ['incident', 'inc_debt', '欠了一筆債'], ['enemy', 'en_rival', '搶同一個位置的'], ['want', 'want_money', '錢'], ['sex', 'sex_some', '普通'],
    ])
    expect(rows[0]!.outcomes).toEqual([{ kind: 'npc', text: '認識一位家人，親密度 +20' }])
    expect(rows[1]!.outcomes.map((o) => o.kind)).toEqual(['effect', 'effect'])
    expect(rows[1]!.outcomes[0]!.text).toContain('2000')
    expect(rows[1]!.outcomes[1]!.text).toBe('一項結果（sink_floor）：這一局沒有功能接得住，不會生效。')
    expect(rows[2]!.outcomes[0]!.text).toBe('認識一位仇人，親密度 −20，所屬勢力的敵對值 +15')
    expect(rows[4]!.outcomes.map((o) => o.kind)).toEqual(['tendency', 'sex_record', 'bridge'])
  })
})

describe('內容的格式', () => {
  const load = (g: Game, e: Rec) => g.k.content.validate('lifepath_entry', [e])

  it('結果只能是規定的鍵；格式不對的整筆擋下並寫出原因', () => {
    const g = setup()
    expect(load(g, entry('want', 'x1', 't', { result: { gold: 1 } })).join()).toContain('result.gold：不認得這個結果')
    expect(load(g, entry('nope', 'x2', 't')).join()).toContain('table 要是')
    expect(load(g, entry('want', 'x3', ''))).not.toEqual([])
    expect(load(g, entry('want', 'x4', 't', { weight: 0 })).join()).toContain('weight')
    expect(load(g, entry('want', 'x5', 't', { result: { npc: { role: 'boss' } } })).join()).toContain('result.npc.role')
    expect(load(g, entry('want', 'x6', 't', { result: { npc: { role: 'friend', roster: 'yes' } } })).join()).toContain('result.npc.roster')
    expect(load(g, entry('sex', 'x7', 't', { result: { bridge: { craving: 11 } } })).join()).toContain('result.bridge')
    expect(load(g, entry('sex', 'x8', 't', { result: { sex_record: { first: 1 } } })).join()).toContain('result.sex_record.first')
    expect(load(g, entry('want', 'x9', 't', { result: { effects: [{ amount: 1 }] } })).join()).toContain('result.effects[0]')
    expect(load(g, entry('want', 'x10', 't', { origins: ['nowhere'] }))).toEqual([])
  })

  it('性經歷記錄與橋參數只有性經歷那張表能寫；傾向只有性經歷與潛在性癖兩張表', () => {
    const g = setup()
    expect(load(g, entry('want', 'y1', 't', { result: { sex_record: { times: 1 } } })).join()).toContain('只有「性經歷」那張表能寫')
    expect(load(g, entry('kink', 'y2', 't', { result: { bridge: { craving: 1 } } })).join()).toContain('只有「性經歷」那張表能寫')
    expect(load(g, entry('want', 'y3', 't', { result: { tendency: [{ tag: 'a' }] } })).join()).toContain('只有「性經歷、潛在性癖」那幾張表能寫')
    expect(load(g, entry('kink', 'y4', 't', { result: { tendency: [{ tag: 'a' }], axis: { body: 1 } } }))).toEqual([])
  })

  it('載入後 ready 擋引用不存在的標籤、勢力與格式不對的出身欄位', () => {
    const bad = (content: Rec) => ({ id: 'bad', content }) as unknown as ContentPack
    const tryBoot = (pack: ContentPack): string => {
      try {
        const g = makeGame({ scenario: 'beforeCreation', features: FULL, content: [MINI_PACK, PACK, LEWD_PACK, pack], seed: 1 })
        void g
        return ''
      } catch (e) {
        return e instanceof ContentError ? e.message : String(e)
      }
    }
    expect(tryBoot(bad({ lifepath_entry: [entry('kink', 'z1', 't', { result: { tendency: [{ tag: 't_missing' }] } })] }))).toContain('引用了不存在的傾向標籤 t_missing')
    expect(tryBoot(bad({ lifepath_entry: [entry('enemy', 'z2', 't', { result: { npc: { role: 'enemy', faction_from: 'nobody' } } })] }))).toContain('不存在的勢力 nobody')
    expect(tryBoot(bad({ lifepath_entry: [entry('incident', 'z3', 't', { result: { effects: [{ kind: 'cash', amount: 'lots' }] } })] }))).toContain('result.effects[0]')
    expect(tryBoot(bad({ origin: [{ id: 'weird', name: '怪', line: '怪', skill_bonus: { stealth: 1 }, status: 'citizen', home: 'd_42', favor: { choose_one: ['nora'], value: 25 }, perk: 'origin_hive', roster: ['npc_ray'], fame: { nowhere: 5 } }] }))).toContain('fame 引用了不存在的區 nowhere')
    expect(tryBoot(bad({ origin: [{ id: 'weird2', name: '怪', line: '怪', skill_bonus: { stealth: 1 }, status: 'citizen', home: 'd_42', favor: { choose_one: ['nora'], value: 25 }, perk: 'origin_hive', roster: ['npc_ray'], tendency: { axes: { flavor: 1 } } }] }))).toContain('tendency.axes')
    expect(tryBoot(bad({}))).toBe('')
  })
})
