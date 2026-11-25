// 驗收測試：dev/work/M2-npc-interact.md（cpp-feature）。規格：NPC_SYSTEM 第 6 節（6.1 選單、6.2 基準 DC 與修正、6.3 送禮與偷竊、6.4 讀橋、6.5 誘惑）；
// AI_TASKS 3.1 節（自由行動的鏈與參考範圍）；dev/adr/0016 第七節。
// 內容一律用測試自帶的最小假資料：兩個勢力加一個「夜鶯」、兩個區（蜂巢的主要勢力是阿爾法）、幾件東西、九筆互動的行動種類（owner: npcs）、
// 幾位固定 NPC（街坊鮑勃、行者安、阿爾法的人科拉、中間人媽咪……）。區與街區這兩種內容種類是別的功能的，測試用替身定義。
// 擲骰的成功程度用「換種子」控制：換到預覽的那一顆骰剛好是要的成功程度（prepareAction 不改狀態）。

import { describe, expect, it } from 'vitest'
import type { ContentPack, Feature, Kernel, ReportDraft } from '../../src'
import { MONEY_CAP_BY_GRADE, countItem, inputOf, meterOf, prepareAction } from '../../src'
import { actionsFeature } from '../../src/features/actions'
import { lewdFeature } from '../../src/features/lewd'
import { CALL_MAX, CHAT_DONE_NOTE, GIFT_NOTE_MAX, callNamesBlock, callNamesDraft, callNamesOf, knowFactText, memoriesOf, npcsFeature, npcsHere, interactBlock, interactInput, interactRules, interactions, giftGain, giftTier, DEFAULT_INTERACT_RULES, doneToday, knownFacts, knows, npcOf, readNpcs, tableEffects } from '../../src/features/npcs'
import type { InteractKind } from '../../src/features/npcs'
import { securityFeature } from '../../src/features/security'
import { makeGame, observed } from '../../src/testkit'

// ---- 替身與假資料 ----

/** 別的功能的內容種類：區、街區、路數。 */
const STUBS: Feature = {
  id: 'test_stubs',
  install(k: Kernel) {
    for (const kind of ['district', 'block', 'path']) k.content.defineKind({ kind, owner: 'test', validate: () => [] })
  },
}

type Rec = Record<string, unknown>
type Content = Record<string, Rec[]>

const ATTRS = ['body', 'reflex', 'tech', 'intellect', 'resolve', 'charm'].map((id) => ({ id, name: id, desc: `${id}。` }))
const SKILLS = [
  ['negotiate', 'charm'], ['seduce', 'charm'], ['intimidate', 'resolve'], ['stealth', 'reflex'], ['interface', 'intellect'],
].map(([id, attr]) => ({ id: id!, name: id!, attr: attr!, desc: `${id}。` }))
const item = (id: string, more: Rec = {}) => ({ id, name: id, desc: `${id}。`, category: 'misc', grade: 1, size: 1, legal: 'free', ...more })
const ITEMS = [
  item('it_flower', { name: '一束花', price: 70 }), item('it_bread', { name: '麵包', price: 5, tags: ['food'] }), item('it_junk', { name: '破銅爛鐵', price: 3 }),
  item('it_black', { name: '黑帶', price: 100, legal: 'banned' }), item('it_deck', { name: '甲板', price: 900, tags: ['deck'] }),
]

/** 九筆互動：名字、屬性、基本功、時間照資料；DC、能不能做、AI 關著時的結果由功能給。 */
const kindEntry = (id: string, name: string, attr: string, skill: string, dc: string, more: Rec = {}) => ({ id, name, attr, skill, dc, minutes: 10, max_minutes: 30, owner: 'npcs', ...more })
const KINDS: Rec[] = [
  kindEntry('npc_chat', '聊天', 'charm', 'negotiate', 'normal'),
  kindEntry('npc_gift', '送禮', 'charm', 'negotiate', 'normal'),
  kindEntry('npc_seduce', '誘惑', 'charm', 'seduce', 'normal'),
  kindEntry('npc_ask_small', '請小忙', 'charm', 'negotiate', 'normal'),
  kindEntry('npc_ask_mid', '請中忙', 'charm', 'negotiate', 'hard'),
  kindEntry('npc_ask_big', '請大忙', 'charm', 'negotiate', 'extreme'),
  kindEntry('npc_intimidate', '威嚇', 'resolve', 'intimidate', 'normal'),
  kindEntry('npc_steal', '偷竊', 'reflex', 'stealth', 'hard'),
  kindEntry('npc_read_bridge', '快駭讀橋', 'intellect', 'interface', 'hard'),
]

const npc = (id: string, name: string, more: Rec = {}) => ({ id, name, kind: 'citizen', age: 30, guard: 12, wealth: 1, home: { district: 'd_hive', block: 'b_market' }, haunts: [{ district: 'd_hive', block: 'b_market' }], ...more })
const BOB = npc('npc_bob', '鮑勃', { wealth: 2 })
const ANN = npc('npc_ann', '安', { kind: 'runner', guard: 13, faction: 'f_alpha', paths: [{ path: 'p_gun', slot: 'main', tier: 2 }], bridge: { sensitivity: 40, tolerance: 30, craving: 20, docility: 10 }, tendencies: { axes: {}, tags: { tg_dom: 'has', tg_goth: 'latent' } }, flags: ['likes:it_flower', 'secret:舊帳'], haunts: [{ district: 'd_hive', block: 'b_market' }, { district: 'd_hive', block: 'b_tower', time: ['late'] }] })
const CORA = npc('npc_cora', '科拉', { faction: 'f_beta', guard: 15 })
const MAMA = npc('npc_mama', '媽咪', { kind: 'staff', flags: ['fixer', 'no_steal', 'no_hack'], bridge: { sensitivity: 10, tolerance: 10, craving: 10, docility: 10 } })
const DUDE = npc('npc_dude', '阿呆', { gender: 'male', flags: ['no_banned'], tendencies: { axes: {}, tags: {} }, bridge: { sensitivity: 20, tolerance: 20, craving: 20, docility: 20 } })
const FAR = npc('npc_far', '遠方的人', { home: { district: 'd_far' }, haunts: [{ district: 'd_far' }] })
const NOBRIDGE = npc('npc_nobridge', '沒橋的', { bridge: null })

const baseContent = (): Content => structuredClone({
  attribute: ATTRS, skill: SKILLS, item: ITEMS,
  faction: [
    { id: 'f_alpha', name: '阿爾法公司', short: '阿爾法', class: 'corp' }, { id: 'f_beta', name: '貝塔幫', short: '貝塔', class: 'street' },
    { id: 'nightingale', name: '夜鶯', short: '夜鶯', class: 'public' },
  ],
  district: [{ id: 'd_hive', name: '蜂巢', grade: 1, factions: ['f_alpha'] }, { id: 'd_far', name: '遠方', grade: 1, factions: [] }],
  block: [{ id: 'b_market', district: 'd_hive', name: '市場', facilities: {} }, { id: 'b_tower', district: 'd_hive', name: '塔下', facilities: {} }],
  path: [{ id: 'p_gun', name: '槍手' }],
  tendency_tag: [{ id: 'tg_dom', name: '支配', axis: 'relation' }, { id: 'tg_goth', name: '哥德風', axis: 'costume' }],
  npc: [BOB, ANN, CORA, MAMA, DUDE, FAR, NOBRIDGE],
  action_kind: KINDS,
}) as Content

interface Opts {
  content?: (c: Content) => void
  features?: Feature[]
  fake?: NonNullable<Parameters<typeof makeGame>[0]>['fake']
  pc?: Rec
}
const ALL_FEATURES: Feature[] = [STUBS, actionsFeature, lewdFeature, securityFeature, npcsFeature]
const make = (o: Opts = {}) => {
  const c = baseContent()
  o.content?.(c)
  const pack: ContentPack = { id: 'interact_test', content: c as unknown as ContentPack['content'] }
  const { game, fake } = makeGame({
    features: o.features ?? ALL_FEATURES, content: [pack], seed: 7,
    // 主角：帶一台甲板（隊上有人帶甲板才讀得了橋）、背包裡有幾件禮物
    pc: { ext: { deck: { grade: 2 } }, ...(o.pc ?? {}) },
    patch: { time: { day: 3, hour: 10, minute: 0 }, inventory: [{ id: 'it_flower', qty: 2 }, { id: 'it_bread', qty: 1 }, { id: 'it_black', qty: 1 }, { id: 'it_junk', qty: 1 }] },
    ...(o.fake !== undefined ? { fake: o.fake } : {}),
  })
  // 走進蜂巢的市場（和世界一樣，報告帶一筆 location 變更）：名單建好，固定 NPC 就在這裡
  game.commit(draft([{ op: 'location', to: { district: 'd_hive', block: 'b_market' } }], 'test.go'))
  return { g: game, fake }
}
type G = ReturnType<typeof make>['g']

const draft = (changes: ReportDraft['changes'], action = 'test.step'): ReportDraft => ({
  kind: 'action', action, location: { district: 'test' }, party: [], timeline: [], changes, outcome: { result: 'ok', summary: '測試' },
})
const give = (g: G, effects: Rec[]) => {
  const r = g.k.effects.resolve(effects, { state: g.state, actor: 'pc', grade: 1, source: 'builtin', clampAsked: true, content: g.k.content })
  if (r.errors.length) throw new Error(r.errors.join('；'))
  if (r.changes.length) g.commit(draft(r.changes, 'test.give'))
}
const aff = (g: G, id: string) => meterOf(g.k, g.state, 'affinity', id)
const host = (g: G, id: string) => meterOf(g.k, g.state, 'hostility', id)
const cash = (g: G) => g.state.money.cash
/** 認識並把親密度設成某個值。 */
const know = (g: G, id: string, affinity = 0) => give(g, [{ kind: 'meet', npc: id }, ...(affinity !== 0 ? [{ kind: 'affinity', key: id, amount: affinity }] : [])])
const nextDay = (g: G) => {
  g.state.time = { ...g.state.time, day: g.state.time.day + 1 }
}

type Degree = 'critical' | 'success' | 'fail' | 'fumble'
/** 換種子：直到這一次行動預覽出來的成功程度是要的那一個。 */
function rig(g: G, input: ReturnType<typeof interactInput>, degree: Degree): void {
  for (let seed = 1; seed < 2000; seed++) {
    g.state.rng.seed = seed
    if (prepareAction(g.k, g.state, input).roll.degree === degree) return
  }
  throw new Error(`找不到會擲出 ${degree} 的種子`)
}
/** 對這個人做一件事，擲出指定的成功程度，回傳 act 的結果。 */
async function act(g: G, kind: InteractKind, id: string, degree: Degree, extra: Parameters<typeof interactInput>[4] = {}) {
  const input = interactInput(g.k, g.state, kind, id, extra)
  rig(g, input, degree)
  const r = await g.act(input)
  expect(r.status, r.reason).toBe('applied')
  return r
}
const row = (g: G, id: string, kind: InteractKind) => interactions(g.k, g.state, id).find((v) => v.kind === kind)!

// ---- 基準 DC 與修正（6.2 節）----

describe('基準 DC：警覺 − ⌊親密度 ÷ 20⌋ ＋ 情境修正，每一條列在明細裡', () => {
  it('街坊（警覺 12）、親密度 40：聊天的 DC 是 10；明細裡警覺與親密度各一條', () => {
    const { g } = make()
    know(g, 'npc_bob', 40)
    const v = row(g, 'npc_bob', 'npc_chat')
    expect(v.dc).toBe(10)
    expect(v.mods).toEqual([{ label: '鮑勃的警覺', value: 12 }, { label: '親密度 40', value: -2 }])
    // 真的擲出來的 DC 就是它
    const p = prepareAction(g.k, g.state, interactInput(g.k, g.state, 'npc_chat', 'npc_bob'))
    expect(p.roll.dc).toBe(10)
  })

  it('勢力敵對值 40 以上再 +2（39 不加）；好感 60 以上 −1、20 以下 +1；各一條', () => {
    const { g } = make()
    know(g, 'npc_cora', 40)
    give(g, [{ kind: 'favor', key: 'f_beta', amount: 30 }])
    expect(meterOf(g.k, g.state, 'favor', 'f_beta')).toBe(40)
    expect(row(g, 'npc_cora', 'npc_chat').dc).toBe(13) // 警覺 15 − 2
    give(g, [{ kind: 'hostility', key: 'f_beta', amount: 39 }])
    expect(row(g, 'npc_cora', 'npc_chat').dc).toBe(13)
    give(g, [{ kind: 'hostility', key: 'f_beta', amount: 1 }])
    const v = row(g, 'npc_cora', 'npc_chat')
    expect(v.dc).toBe(15)
    expect(v.mods.find((m) => m.label.includes('敵對值'))).toEqual({ label: '對方勢力的敵對值 40', value: 2 })
    // 好感
    give(g, [{ kind: 'favor', key: 'f_beta', amount: 20 }])
    expect(row(g, 'npc_cora', 'npc_chat').mods.find((m) => m.label.includes('好感'))).toEqual({ label: '對方勢力的好感 60', value: -1 })
    give(g, [{ kind: 'favor', key: 'f_beta', amount: -50 }])
    expect(row(g, 'npc_cora', 'npc_chat').mods.find((m) => m.label.includes('好感'))).toEqual({ label: '對方勢力的好感只有 10', value: 1 })
  })

  it('沒有勢力的人沒有好感與敵對值那兩條（蜂巢的主要勢力是阿爾法，也不算）；沒裝敵對值與好感的功能：那幾條當成 0，不丟錯', () => {
    const { g: plain } = make()
    know(plain, 'npc_bob', 0)
    expect(row(plain, 'npc_bob', 'npc_chat').mods).toEqual([{ label: '鮑勃的警覺', value: 12 }])
    const { g } = make({ features: [STUBS, actionsFeature, npcsFeature], content: (c) => { delete c.tendency_tag; (c.npc as Rec[]).forEach((n) => { delete n.tendencies }) } })
    know(g, 'npc_cora', 0)
    const v = row(g, 'npc_cora', 'npc_chat')
    expect(v.dc).toBe(15)
    expect(v.mods).toEqual([{ label: '科拉的警覺', value: 15 }])
    expect(v.ok).toBe(true)
  })

  it('各種互動再照 6.1 節加減：送禮 −2；交涉照資料寫的檔位 13／16／19；讀橋 10 ＋ 防護階 × 3；威嚇在對方的主場 +2', () => {
    const { g } = make()
    know(g, 'npc_ann', 0)
    know(g, 'npc_bob', 0)
    give(g, [{ kind: 'favor', key: 'f_alpha', amount: 30 }])
    expect(row(g, 'npc_bob', 'npc_gift').dc).toBe(12 - 2)
    expect(row(g, 'npc_bob', 'npc_ask_small').dc).toBe(13)
    expect(row(g, 'npc_bob', 'npc_ask_mid').dc).toBe(16)
    expect(row(g, 'npc_bob', 'npc_ask_big').dc).toBe(19)
    // 行者預設防護階 1：10 + 3
    expect(row(g, 'npc_ann', 'npc_read_bridge').dc).toBe(13)
    // 安屬於阿爾法，蜂巢的主要勢力是阿爾法：威嚇 +2（好感 40，不加不減）
    const v = row(g, 'npc_ann', 'npc_intimidate')
    expect(v.mods.find((m) => m.label.includes('主場'))).toEqual({ label: '對方的勢力在這裡是主場', value: 2 })
    expect(v.dc).toBe(13 + 2)
  })

  it('誘惑：這一區的豔名每 25 點 −1；成功率與機率一起給', () => {
    const { g } = make()
    know(g, 'npc_bob', 0)
    const before = row(g, 'npc_bob', 'npc_seduce')
    give(g, [{ kind: 'fame', amount: 60 }])
    expect(meterOf(g.k, g.state, 'fame')).toBe(60)
    const after = row(g, 'npc_bob', 'npc_seduce')
    expect(after.dc).toBe(before.dc! - 2)
    expect(after.mods).toContainEqual({ label: '這一區的豔名 60', value: -2 })
    expect(after.chance).toBeGreaterThan(before.chance!)
    expect(after.chance).toBeGreaterThan(0)
    expect(after.chance).toBeLessThanOrEqual(1)
  })
})

describe('選單的其他細節', () => {
  it('存檔的難度偏移照加（多一條「難度設定」）；查不到的人每一種都做不了、沒有 DC', () => {
    const { g } = make()
    know(g, 'npc_bob', 0)
    const before = row(g, 'npc_bob', 'npc_chat').dc!
    g.state.rules.dcOffset = 2
    const v = row(g, 'npc_bob', 'npc_chat')
    expect(v.dc).toBe(before + 2)
    expect(v.mods.at(-1)).toEqual({ label: '難度設定', value: 2 })
    expect(prepareAction(g.k, g.state, interactInput(g.k, g.state, 'npc_chat', 'npc_bob')).roll.dc).toBe(before + 2)
    const none = interactions(g.k, g.state, 'npc_nobody')
    expect(none).toHaveLength(9)
    for (const x of none) expect(x).toMatchObject({ ok: false, reason: '查不到這個人。', dc: null, chance: null })
  })

  it('沒裝 security 時偷竊失敗只扣親密度（沒有勢力的敵對值可加），不丟錯', async () => {
    const { g } = make({ features: [STUBS, actionsFeature, npcsFeature], content: (c) => { delete c.tendency_tag; (c.npc as Rec[]).forEach((n) => { delete n.tendencies }) } })
    know(g, 'npc_cora', 0)
    await act(g, 'npc_steal', 'npc_cora', 'fail')
    expect(aff(g, 'npc_cora')).toBe(-10)
    expect(g.state.meters.hostility).toBeUndefined()
  })

  it('禮物大成功比成功多 +1；收下的禮物少一件，不合意的還在', async () => {
    const { g } = make()
    know(g, 'npc_cora', 0)
    await act(g, 'npc_gift', 'npc_cora', 'critical', { item: 'it_flower' })
    expect(aff(g, 'npc_cora')).toBe(2 + 1)
    expect(countItem(g.state.inventory, 'it_flower')).toBe(1)
  })

  it('成功率：1d20 每一面算一次，大成功與成功都算；DC 越高機率越低', () => {
    const { g } = make()
    know(g, 'npc_bob', 0)
    const chat = row(g, 'npc_bob', 'npc_chat')
    const big = row(g, 'npc_bob', 'npc_ask_big')
    expect(chat.chance).toBeGreaterThan(big.chance!)
    // 主角魅力 10、沒有基本功：加值 0；DC 12 → 骰 12～20 成功（自然 1 大失敗）：9/20
    expect(chat.dc).toBe(12)
    expect(chat.chance).toBe(9 / 20)
  })
})

// ---- 聊天 ----

describe('聊天（6.1 節）', () => {
  it('成功親密度 +2、大成功 +4、大失敗 −2；失敗不變', async () => {
    for (const [degree, want] of [['success', 2], ['critical', 4], ['fumble', -2], ['fail', 0]] as const) {
      const { g } = make()
      know(g, 'npc_bob', 0)
      await act(g, 'npc_chat', 'npc_bob', degree)
      expect(aff(g, 'npc_bob'), degree).toBe(want)
    }
  })

  it('表的結果在報告的 narration.results 裡（寫正文收得到）：一件事一行；沒有結果的行動（失敗）是空的', async () => {
    const { g } = make()
    know(g, 'npc_bob', 0)
    const ok = await act(g, 'npc_chat', 'npc_bob', 'success')
    expect(ok.reports[0]!.narration!.results).toEqual(['親密度（鮑勃）：+2'])
    expect(ok.reports[0]!.outcome.summary).toContain('親密度（鮑勃）：+2')
    const fail = await act(g, 'npc_chat', 'npc_bob', 'fail')
    expect(fail.reports[0]!.narration!.results).toEqual([])
    const gift = await act(g, 'npc_gift', 'npc_bob', 'success', { item: 'it_flower' })
    expect(gift.reports[0]!.narration!.results).toEqual(['親密度（鮑勃）：+1', '失去：一束花'])
  })

  it('同一天第二次聊天不再加（但照樣能聊）；換一天又加；今天做過的記在 state.ext.npcs.today', async () => {
    const { g } = make()
    know(g, 'npc_bob', 0)
    await act(g, 'npc_chat', 'npc_bob', 'success')
    expect(aff(g, 'npc_bob')).toBe(2)
    expect(doneToday(g.state, 'npc_bob')).toEqual(['chat'])
    expect(readNpcs(g.state).today).toEqual({ day: 3, done: { npc_bob: ['chat'] } })
    expect(row(g, 'npc_bob', 'npc_chat').ok).toBe(true)
    await act(g, 'npc_chat', 'npc_bob', 'critical')
    expect(aff(g, 'npc_bob')).toBe(2)
    // 大失敗第二次照扣
    await act(g, 'npc_chat', 'npc_bob', 'fumble')
    expect(aff(g, 'npc_bob')).toBe(0)
    nextDay(g)
    expect(doneToday(g.state, 'npc_bob')).toEqual([])
    await act(g, 'npc_chat', 'npc_bob', 'success')
    expect(aff(g, 'npc_bob')).toBe(2)
    expect(readNpcs(g.state).today).toEqual({ day: 4, done: { npc_bob: ['chat'] } })
  })

  it('輸入不必用 interactInput 組：自己寫的 { kind, target } 就行；報告帶著行動的輸入（args），文字不帶任何標記', async () => {
    const { g } = make()
    know(g, 'npc_bob', 0)
    const raw = { kind: 'npc_chat', target: 'npc_bob' }
    rig(g, raw, 'success')
    const r = await g.act(raw)
    expect(r.status).toBe('applied')
    expect(aff(g, 'npc_bob')).toBe(2)
    expect(doneToday(g.state, 'npc_bob')).toEqual(['chat'])
    expect(r.reports[0]!.args).toEqual(raw)
    // interactInput 組的文字就是玩家寫的那句，不接任何東西
    const input = interactInput(g.k, g.state, 'npc_chat', 'npc_bob', { text: '我隨口問他今天過得怎麼樣' })
    expect(input).toEqual({ kind: 'npc_chat', target: 'npc_bob', text: '我隨口問他今天過得怎麼樣' })
    nextDay(g)
    rig(g, input, 'success')
    const r2 = await g.act(input)
    expect(r2.reports[0]!.input).toBe('我隨口問他今天過得怎麼樣')
    expect(r2.reports[0]!.args).toEqual(input)
  })

  it('報告帶行動的輸入：送禮的 item、讀橋的 category 都在 args 裡；掛鉤用它記每天的次數', async () => {
    const { g } = make()
    know(g, 'npc_ann', 0)
    const gift = await act(g, 'npc_gift', 'npc_ann', 'success', { item: 'it_flower' })
    expect(gift.reports[0]!.args).toMatchObject({ kind: 'npc_gift', target: 'npc_ann', item: 'it_flower' })
    expect(doneToday(g.state, 'npc_ann')).toEqual(['gift'])
    const read = await act(g, 'npc_read_bridge', 'npc_ann', 'success', { category: 'bridge' })
    expect(read.reports[0]!.args).toMatchObject({ kind: 'npc_read_bridge', target: 'npc_ann', category: 'bridge' })
    expect(knownFacts(g.state, 'npc_ann')).toContain('bridge')
  })

  it('不認識但就在這裡的人：聊天先認識他，再照表加親密度；不認識又不在這裡的被擋下並有原因', async () => {
    const { g } = make()
    expect(knows(g.state, 'npc_bob')).toBe(false)
    expect(row(g, 'npc_bob', 'npc_chat').ok).toBe(true)
    await act(g, 'npc_chat', 'npc_bob', 'success')
    expect(knows(g.state, 'npc_bob')).toBe(true)
    expect(aff(g, 'npc_bob')).toBe(2)
    const far = row(g, 'npc_far', 'npc_chat')
    expect(far.ok).toBe(false)
    expect(far.reason).toBe('你還不認識遠方的人，他也不在這裡。')
    const r = await g.act({ kind: 'npc_chat', target: 'npc_far' })
    expect(r.status).toBe('refused')
    expect(r.reason).toBe('你還不認識遠方的人，他也不在這裡。')
  })
})

// ---- 送禮 ----

describe('不認識的生成人（區的名單裡的路人，認識之後才是角色）', () => {
  const GEN = { id: 'ng_hive', district: 'd_hive', citizens: 5, runners: 0, occupations: [['攤販', 1]], factions: [['none', 1]], names: ['np_zh'], haunts: [{ block: 'b_market' }] }
  const POOL = { id: 'np_zh', family: ['陸', '周', '王'], given: ['守仁', '曉雯', '志明', '小芬'] }
  const stranger = (g: G): string => {
    const n = npcsHere(g.k, g.state).find((x) => !g.k.content.has('npc', x.id))
    if (!n) throw new Error('這裡沒有生成的人')
    return n.id
  }
  const withGen = () => make({ content: (c) => { c.npc_gen = [GEN]; c.name_pool = [POOL] } })

  it('聊天：起手先認識他（prelude），再照表加親密度；兩件事都在報告上，親密度的那一行寫的是他的名字', async () => {
    const { g } = withGen()
    const id = stranger(g)
    expect(knows(g.state, id)).toBe(false)
    expect(g.state.actors[id]).toBeUndefined()
    const r = await act(g, 'npc_chat', id, 'success')
    expect(knows(g.state, id)).toBe(true)
    expect(g.state.actors[id]!.role).toBe('npc')
    expect(aff(g, id)).toBe(2)
    // 認識他（npcs.meet）排在親密度前面
    const ops = r.reports[0]!.changes.map((c) => c.op)
    expect(ops.indexOf('npcs.meet')).toBeGreaterThanOrEqual(0)
    expect(ops.indexOf('npcs.meet')).toBeLessThan(ops.indexOf('meter'))
    expect(r.reports[0]!.narration!.results).toEqual([`親密度（${g.state.actors[id]!.name}）：+2`])
  })

  it('AI 開著也一樣：AI 給的親密度對一個還不認識的人（起手先認識他，AI 的效果驗證的是認識之後的狀態）', async () => {
    const { g } = make({ content: (c) => { c.npc_gen = [GEN]; c.name_pool = [POOL] }, fake: {} })
    const id = stranger(g)
    const input = interactInput(g.k, g.state, 'npc_chat', id)
    rig(g, input, 'success')
    const r = await g.act(input, { autoRules: true })
    expect(r.status).toBe('applied')
    expect(knows(g.state, id)).toBe(true)
    expect(aff(g, id)).toBe(2)
  })

  it('失敗的互動也算認識了他（照舊）；沒有結果可記的那一次，narration.results 是空的', async () => {
    const { g } = withGen()
    const id = stranger(g)
    const r = await act(g, 'npc_chat', id, 'fail')
    expect(knows(g.state, id)).toBe(true)
    expect(aff(g, id)).toBe(0)
    expect(r.reports[0]!.narration!.results).toEqual([])
  })
})

describe('送禮（6.3 節）', () => {
  it('價值先除以財富的倍率再看哪一級：C$70、財富 2 級、倍率照資料——落在 60 以上那一級（+2）；預設倍率 ×2 時是 35，落在 10 以上那一級（+1）', async () => {
    const rules = { id: 'default', gift: { wealth_mult: [0.5, 1, 1, 3, 5, 8] } }
    const { g } = make({ content: (c) => { c.npc_interact_rule = [rules] } })
    know(g, 'npc_bob', 0)
    expect(giftTier(DEFAULT_INTERACT_RULES, 70, 2)).toBe(1)
    expect(interactRules(g.k).gift.wealth_mult).toEqual([0.5, 1, 1, 3, 5, 8])
    expect(giftTier(interactRules(g.k), 70, 2)).toBe(2)
    await act(g, 'npc_gift', 'npc_bob', 'success', { item: 'it_flower' })
    expect(aff(g, 'npc_bob')).toBe(2)
    // 其他級距
    for (const [price, wealth, want] of [[9, 1, 0], [10, 1, 1], [60, 1, 2], [250, 1, 4], [1000, 1, 6], [999, 1, 4], [4, 0, 0], [5, 0, 1], [8000, 5, 6], [7999, 5, 4]] as const) {
      expect(giftTier(DEFAULT_INTERACT_RULES, price, wealth), `${price}／財富 ${wealth}`).toBe(want)
    }
    // 預設倍率
    const d = make()
    know(d.g, 'npc_bob', 0)
    await act(d.g, 'npc_gift', 'npc_bob', 'success', { item: 'it_flower' })
    expect(aff(d.g, 'npc_bob')).toBe(1)
  })

  it('合對方的喜好再 +2（安喜歡花）；窮人幾乎都喜歡真的食物；大失敗冒犯 −3；失敗不變，禮物還在手上', async () => {
    const { g } = make()
    know(g, 'npc_ann', 0)
    await act(g, 'npc_gift', 'npc_ann', 'success', { item: 'it_flower' })
    expect(aff(g, 'npc_ann')).toBe(2 + 2) // 70 ÷ 倍率 2（財富 1 級 ×1 → 70）：+2，喜歡 +2
    expect(countItem(g.state.inventory, 'it_flower')).toBe(1)

    const b = make()
    know(b.g, 'npc_cora', 0)
    await act(b.g, 'npc_gift', 'npc_cora', 'success', { item: 'it_bread' })
    expect(aff(b.g, 'npc_cora')).toBe(2) // 5 元不到 10，但窮人（財富 1）喜歡真的食物 +2
    expect(giftGain(b.g.k, DEFAULT_INTERACT_RULES, npcOf(b.g.k, b.g.state, 'npc_bob')!, 'it_bread', 'success')).toBe(0) // 財富 2 級不算窮

    const f = make()
    know(f.g, 'npc_bob', 0)
    await act(f.g, 'npc_gift', 'npc_bob', 'fumble', { item: 'it_flower' })
    expect(aff(f.g, 'npc_bob')).toBe(-3)
    expect(countItem(f.g.state.inventory, 'it_flower')).toBe(2)
    const e = make()
    know(e.g, 'npc_bob', 0)
    await act(e.g, 'npc_gift', 'npc_bob', 'fail', { item: 'it_flower' })
    expect(aff(e.g, 'npc_bob')).toBe(0)
    expect(countItem(e.g.state.inventory, 'it_flower')).toBe(2)
  })

  it('送過之後今天不能再送（有原因）、禮物從背包少一件、換一天又能送；沒選禮物或背包裡沒有被擋下', async () => {
    const { g } = make()
    know(g, 'npc_bob', 0)
    await act(g, 'npc_gift', 'npc_bob', 'success', { item: 'it_flower' })
    expect(countItem(g.state.inventory, 'it_flower')).toBe(1)
    expect(doneToday(g.state, 'npc_bob')).toContain('gift')
    const v = row(g, 'npc_bob', 'npc_gift')
    expect(v.ok).toBe(false)
    expect(v.reason).toBe('你今天已經送過鮑勃禮物了。')
    const r = await g.act(interactInput(g.k, g.state, 'npc_gift', 'npc_bob', { item: 'it_flower' }))
    expect(r.status).toBe('refused')
    expect(r.reason).toBe('你今天已經送過鮑勃禮物了。')
    expect(countItem(g.state.inventory, 'it_flower')).toBe(1)
    nextDay(g)
    expect(row(g, 'npc_bob', 'npc_gift').ok).toBe(true)

    const h = make()
    know(h.g, 'npc_bob', 0)
    expect(interactBlock(h.g.k, h.g.state, 'npc_gift', 'npc_bob', { kind: 'npc_gift', target: 'npc_bob' })).toBe('要先選一件東西當禮物。')
    expect(interactBlock(h.g.k, h.g.state, 'npc_gift', 'npc_bob', { kind: 'npc_gift', target: 'npc_bob', item: 'it_deck' } as never)).toBe('你的背包裡沒有甲板。')
    expect(row(h.g, 'npc_bob', 'npc_gift')).toMatchObject({ ok: true, needs: 'item' })
  })

  it('送黑帶給不碰黑帶的人算冒犯', async () => {
    const { g } = make()
    know(g, 'npc_dude', 0)
    await act(g, 'npc_gift', 'npc_dude', 'success', { item: 'it_black' })
    expect(aff(g, 'npc_dude')).toBe(-3)
  })
})

// ---- 交涉 ----

describe('交涉（小、中、大三種請託）', () => {
  it('每種請託一天一次；答應的內容只記成旗標；大失敗親密度 −3，今天不再談（三種都擋）', async () => {
    const { g } = make()
    know(g, 'npc_bob', 0)
    await act(g, 'npc_ask_small', 'npc_bob', 'success')
    expect(g.state.flags['npc_ask:npc_bob:small']).toBe(3)
    expect(row(g, 'npc_bob', 'npc_ask_small')).toMatchObject({ ok: false, reason: '你今天已經請鮑勃幫過小忙了。' })
    expect(row(g, 'npc_bob', 'npc_ask_mid').ok).toBe(true)
    await act(g, 'npc_ask_mid', 'npc_bob', 'fumble')
    expect(aff(g, 'npc_bob')).toBe(-3)
    expect(g.state.flags['npc_ask:npc_bob:mid']).toBeUndefined()
    for (const kind of ['npc_ask_small', 'npc_ask_mid', 'npc_ask_big'] as const) expect(row(g, 'npc_bob', kind)).toMatchObject({ ok: false, reason: expect.any(String) })
    expect(row(g, 'npc_bob', 'npc_ask_big').reason).toBe('鮑勃今天不想再談了。')
    nextDay(g)
    expect(row(g, 'npc_bob', 'npc_ask_big').ok).toBe(true)
  })

  it('失敗：沒進展，也不算今天談過一次以外的事（這一種請託今天還是記了一次）', async () => {
    const { g } = make()
    know(g, 'npc_bob', 0)
    await act(g, 'npc_ask_big', 'npc_bob', 'fail')
    expect(aff(g, 'npc_bob')).toBe(0)
    expect(g.state.flags['npc_ask:npc_bob:big']).toBeUndefined()
    expect(doneToday(g.state, 'npc_bob')).toEqual(['ask_big'])
  })
})

// ---- 威嚇 ----

describe('威嚇', () => {
  it('成功親密度 −3；大失敗對方勢力敵對值 +3；失敗沒事', async () => {
    const { g } = make()
    know(g, 'npc_ann', 0)
    await act(g, 'npc_intimidate', 'npc_ann', 'success')
    expect(aff(g, 'npc_ann')).toBe(-3)
    expect(g.state.flags['npc_obeyed:npc_ann']).toBe(3)
    await act(g, 'npc_intimidate', 'npc_ann', 'fail')
    expect(aff(g, 'npc_ann')).toBe(-3)
    expect(host(g, 'f_alpha')).toBe(0)
    await act(g, 'npc_intimidate', 'npc_ann', 'fumble')
    expect(host(g, 'f_alpha')).toBe(3)
    expect(g.state.flags['npc_standoff:npc_ann']).toBe(3)
  })

  it('對中間人被擋下並有原因', async () => {
    const { g } = make()
    know(g, 'npc_mama', 0)
    const v = row(g, 'npc_mama', 'npc_intimidate')
    expect(v).toMatchObject({ ok: false, reason: '媽咪是中間人，不能威嚇。' })
    const r = await g.act(interactInput(g.k, g.state, 'npc_intimidate', 'npc_mama'))
    expect(r.status).toBe('refused')
    expect(r.reason).toBe('媽咪是中間人，不能威嚇。')
  })
})

// ---- 偷竊 ----

describe('偷竊', () => {
  const FIXED_CASH = (c: Content) => { c.npc_interact_rule = [{ id: 'default', steal: { cash: [[10, 10], [50, 50], [60, 60], [70, 70], [80, 80], [90, 90]] } }] }

  it('成功拿到錢（照財富）；大成功拿到範圍的上限', async () => {
    const { g } = make({ content: (c) => { c.npc_interact_rule = [{ id: 'default', steal: { cash: [[10, 10], [20, 30], [60, 60], [70, 70], [80, 80], [90, 90]] } }] } })
    await act(g, 'npc_steal', 'npc_cora', 'success')
    // 財富 1 級：20～30
    expect(cash(g)).toBeGreaterThanOrEqual(20)
    expect(cash(g)).toBeLessThanOrEqual(30)
    const b = make({ content: FIXED_CASH })
    await act(b.g, 'npc_steal', 'npc_bob', 'success')
    expect(cash(b.g)).toBe(60) // 財富 2 級
    const c2 = make({ content: (c) => { c.npc_interact_rule = [{ id: 'default', steal: { cash: [[10, 10], [20, 30], [60, 60], [70, 70], [80, 80], [90, 90]] } }] } })
    await act(c2.g, 'npc_steal', 'npc_cora', 'critical')
    expect(cash(c2.g)).toBe(30)
  })

  it('失敗：親密度 −10、勢力敵對值 +3；大失敗 −20、+6，行者轉敵對（旗標）', async () => {
    const h = make()
    know(h.g, 'npc_cora', 0)
    await act(h.g, 'npc_steal', 'npc_cora', 'fail')
    expect(aff(h.g, 'npc_cora')).toBe(-10)
    expect(host(h.g, 'f_beta')).toBe(3)
    expect(cash(h.g)).toBe(0)
    await act(h.g, 'npc_steal', 'npc_cora', 'fumble')
    expect(aff(h.g, 'npc_cora')).toBe(-30)
    expect(host(h.g, 'f_beta')).toBe(9)
    // 行者大失敗轉敵對
    const r = make({ content: (c) => { (c.npc as Rec[]).push(npc('npc_thief', '賊', { kind: 'runner', faction: 'f_beta', paths: [{ path: 'p_gun', slot: 'main', tier: 1 }] })) } })
    know(r.g, 'npc_thief', 0)
    await act(r.g, 'npc_steal', 'npc_thief', 'fumble')
    expect(r.g.state.flags['npc_hostile:npc_thief']).toBe(3)
  })

  it('no_steal 的不能偷（有原因）；中間人更不能；偷的人要在這裡；偷到的錢照一次能拿多少的上限夾（蜂巢是一級的區）', async () => {
    const { g } = make()
    know(g, 'npc_mama', 0)
    expect(row(g, 'npc_mama', 'npc_steal')).toMatchObject({ ok: false, reason: '媽咪的東西偷不得。' })
    know(g, 'npc_far', 0)
    expect(row(g, 'npc_far', 'npc_steal')).toMatchObject({ ok: false, reason: '他不在這裡：要在同一個地方才做得到。' })
    const r = make({ content: (c) => { (c.npc as Rec[]).push(npc('npc_rich', '富人', { wealth: 5 })) } })
    await act(r.g, 'npc_steal', 'npc_rich', 'success')
    expect(cash(r.g)).toBe(MONEY_CAP_BY_GRADE[1])
  })

  it('資料沒有 npc_steal 那一筆時，interactions 裡沒有偷竊，也不丟錯', () => {
    const { g } = make({ content: (c) => { c.action_kind = c.action_kind!.filter((e) => e.id !== 'npc_steal') } })
    const list = interactions(g.k, g.state, 'npc_bob')
    expect(list.map((v) => v.kind)).not.toContain('npc_steal')
    expect(list).toHaveLength(8)
    expect(() => interactInput(g.k, g.state, 'npc_steal', 'npc_bob')).toThrow('資料裡沒有 npc_steal 這種互動。')
    // 沒有任何一筆：一個互動都沒有
    const { g: empty } = make({ content: (c) => { c.action_kind = [] } })
    expect(interactions(empty.k, empty.state, 'npc_bob')).toEqual([])
  })
})

// ---- 讀橋 ----

describe('快駭讀橋（6.4 節）', () => {
  it('沒有甲板被擋下；對方沒有橋、不能讀、不在視線內也各有一句原因', () => {
    const { g } = make({ pc: { ext: {} } })
    know(g, 'npc_ann', 0)
    expect(row(g, 'npc_ann', 'npc_read_bridge')).toMatchObject({ ok: false, reason: '隊上沒有人帶甲板，沒辦法讀橋。' })
    const h = make()
    know(h.g, 'npc_nobridge', 0)
    know(h.g, 'npc_mama', 0)
    know(h.g, 'npc_far', 0)
    expect(row(h.g, 'npc_nobridge', 'npc_read_bridge').reason).toBe('沒橋的沒有橋，沒有東西可以讀。')
    expect(row(h.g, 'npc_mama', 'npc_read_bridge').reason).toBe('媽咪的橋不能讀。')
    expect(row(h.g, 'npc_far', 'npc_read_bridge').reason).toBe('遠方的人沒有橋，沒有東西可以讀。')
    expect(row(h.g, 'npc_ann', 'npc_read_bridge').ok).toBe(true)
    // 背包裡有帶 deck 標籤的東西也算
    const i = make({ pc: { ext: {} }, content: () => undefined })
    i.g.state.inventory.push({ id: 'it_deck', qty: 1 })
    know(i.g, 'npc_ann', 0)
    expect(row(i.g, 'npc_ann', 'npc_read_bridge').ok).toBe(true)
  })

  it('成功之後 npc_known 多一項（玩家選類別、程式挑內容）；大成功兩項；失敗什麼都沒讀到', async () => {
    const { g } = make()
    know(g, 'npc_ann', 0)
    expect(knownFacts(g.state, 'npc_ann')).toEqual([])
    await act(g, 'npc_read_bridge', 'npc_ann', 'success', { category: 'bridge' })
    expect(knownFacts(g.state, 'npc_ann')).toEqual(['bridge'])
    await act(g, 'npc_read_bridge', 'npc_ann', 'fail', { category: 'tendency' })
    expect(knownFacts(g.state, 'npc_ann')).toEqual(['bridge'])
    await act(g, 'npc_read_bridge', 'npc_ann', 'critical', { category: 'tendency' })
    const facts = knownFacts(g.state, 'npc_ann')
    expect(facts).toHaveLength(3)
    expect(facts.filter((f) => f.startsWith('tendency:')).sort()).toEqual(['tendency:tg_dom', 'tendency:tg_goth'])
    // 同一項不會重複揭開
    await act(g, 'npc_read_bridge', 'npc_ann', 'success', { category: 'tendency' })
    expect(knownFacts(g.state, 'npc_ann')).toHaveLength(4)
    expect(new Set(knownFacts(g.state, 'npc_ann')).size).toBe(4)
  })

  it('近況與秘密的碎片也讀得到：近況是他最近去過、不是你站著的這一塊；秘密來自他的旗標', async () => {
    const { g } = make()
    know(g, 'npc_ann', 0)
    await act(g, 'npc_read_bridge', 'npc_ann', 'success', { category: 'recent' })
    expect(knownFacts(g.state, 'npc_ann')).toEqual(['recent:b_tower'])
    await act(g, 'npc_read_bridge', 'npc_ann', 'success', { category: 'secret' })
    expect(knownFacts(g.state, 'npc_ann')).toEqual(['recent:b_tower', 'secret:舊帳'])
  })

  it('大失敗：親密度 −10、勢力敵對值 +3；夜鶯的敵對值 +2', async () => {
    const { g } = make()
    know(g, 'npc_ann', 0)
    await act(g, 'npc_read_bridge', 'npc_ann', 'fumble', { category: 'bridge' })
    expect(aff(g, 'npc_ann')).toBe(-10)
    expect(host(g, 'f_alpha')).toBe(3)
    expect(host(g, 'nightingale')).toBe(2)
  })

  it('知道對方的傾向之後，誘惑的 DC 少 2；讀過、對方沒有傾向則 +2', async () => {
    const { g } = make()
    know(g, 'npc_ann', 0)
    give(g, [{ kind: 'favor', key: 'f_alpha', amount: 30 }])
    const before = row(g, 'npc_ann', 'npc_seduce')
    await act(g, 'npc_read_bridge', 'npc_ann', 'success', { category: 'tendency' })
    const after = row(g, 'npc_ann', 'npc_seduce')
    expect(after.dc).toBe(before.dc! - 2)
    expect(after.mods).toContainEqual({ label: '知道對方的傾向，投其所好', value: -2 })
    // 沒有傾向的人
    const h = make()
    know(h.g, 'npc_dude', 0)
    const b2 = row(h.g, 'npc_dude', 'npc_seduce').dc!
    await act(h.g, 'npc_read_bridge', 'npc_dude', 'success', { category: 'tendency' })
    expect(knownFacts(h.g.state, 'npc_dude')).toEqual(['tendency:none'])
    expect(row(h.g, 'npc_dude', 'npc_seduce').dc).toBe(b2 + 2)
  })
})

// ---- 誘惑 ----

describe('誘惑（6.5 節）', () => {
  it('成功親密度 +3，而且沒有開任何活動；失敗 −2、大失敗 −5（留一個麻煩的旗標）', async () => {
    const { g } = make()
    know(g, 'npc_bob', 0)
    const r = await act(g, 'npc_seduce', 'npc_bob', 'success')
    expect(aff(g, 'npc_bob')).toBe(3)
    expect(r.reports[0]!.launch).toBeUndefined()
    expect(g.k.activity.active(g.state)).toEqual([])
    await act(g, 'npc_seduce', 'npc_bob', 'fail')
    expect(aff(g, 'npc_bob')).toBe(1)
    await act(g, 'npc_seduce', 'npc_bob', 'fumble')
    expect(aff(g, 'npc_bob')).toBe(-4)
    expect(g.state.flags['npc_trouble:npc_bob']).toBe(3)
  })

  it('內容篩選：關掉那一種對象就不能誘惑，有原因', () => {
    const { g } = make()
    know(g, 'npc_dude', 0)
    expect(row(g, 'npc_dude', 'npc_seduce').ok).toBe(true)
    g.state.rules.contentOff = ['male_partner']
    expect(row(g, 'npc_dude', 'npc_seduce')).toMatchObject({ ok: false, reason: '你在內容篩選裡關掉了這一類對象，所以不能對阿呆用誘惑。' })
  })
})

// ---- 資料與結構 ----

describe('資料裡的參考範圍、格式與規則', () => {
  it('資料自己寫的參考範圍裡的 $target 換成對象的 id；這張表管的效果（親密度）不重複算', async () => {
    const { g } = make({
      content: (c) => {
        const chat = c.action_kind!.find((e) => e.id === 'npc_chat')!
        chat.hint = { success: [{ kind: 'flag', key: 'ai:chatted:$target', value: true }, { kind: 'affinity', key: '$target', amount: 40 }] }
      },
    })
    know(g, 'npc_bob', 0)
    await act(g, 'npc_chat', 'npc_bob', 'success')
    expect(g.state.flags['ai:chatted:npc_bob']).toBe(true)
    expect(aff(g, 'npc_bob')).toBe(2)
  })

  it('資料裡的 $target 寫在量表的鍵上（affinity）也過得了格式檢查：actions 不驗寫了 owner 的參考範圍，npcs 用替身驗；寫錯的效果照樣擋下', () => {
    expect(() => make({ content: (c) => { c.action_kind!.find((e) => e.id === 'npc_gift')!.hint = { success: [{ kind: 'affinity', key: '$target', amount: 3 }, { kind: 'hostility', key: 'f_alpha', amount: 1 }] } } })).not.toThrow()
    expect(() => make({ content: (c) => { c.action_kind!.find((e) => e.id === 'npc_gift')!.hint = { fail: [{ kind: 'affinity', key: '$target', amount: 1.5 }] } } })).toThrow(/npc_gift.*amount/)
    expect(() => make({ content: (c) => { c.action_kind!.find((e) => e.id === 'npc_gift')!.hint_by_grade = { '2': { success: [{ kind: 'hostility', key: 'f_nowhere', amount: 1 }] } } } })).toThrow(/npc_gift.*f_nowhere/)
  })

  it('格式壞的資料：參考範圍的效果不存在、不認識的基本功，載入就擋下並寫出是哪一筆', () => {
    expect(() => make({ content: (c) => { c.action_kind!.find((e) => e.id === 'npc_gift')!.hint = { success: [{ kind: 'no_such_effect' }] } } })).toThrow(/npc_gift/)
    expect(() => make({ content: (c) => { c.action_kind!.find((e) => e.id === 'npc_gift')!.skill = 'no_such_skill' } })).toThrow(/npc_gift.*no_such_skill/)
    expect(() => make({ content: (c) => { c.npc_interact_rule = [{ id: 'default', gift: { liked: 'x' } }] } })).toThrow(/gift\.liked/)
    expect(() => make({ content: (c) => { c.npc_interact_rule = [{ id: 'default', steal: { cash: [[1, 2]] } }] } })).toThrow(/cash/)
  })

  it('資料沒寫 owner 的行動種類照舊由 actions 註冊；寫了 owner: npcs 的只由這個功能註冊（不會重複註冊）', () => {
    const { g } = make({ content: (c) => { c.action_kind!.push({ id: 'beg', name: '乞討', attr: 'charm', skill: 'negotiate', dc: 'normal', minutes: 10, max_minutes: 30 }) } })
    expect(g.k.actions.get('beg')!.owner).toBe('actions')
    expect(g.k.actions.get('npc_chat')!.owner).toBe('npcs')
    // 沒裝 npcs：資料照樣只是資料
    const { g: bare } = make({ features: [STUBS, actionsFeature], content: (c) => { delete c.tendency_tag; (c.npc as Rec[]).forEach((n) => { delete n.tendencies }) } })
    expect(bare.k.actions.get('npc_chat')).toBeUndefined()
  })

  it('存檔讀檔之後今天的次數還在', async () => {
    const { g } = make()
    know(g, 'npc_bob', 0)
    await act(g, 'npc_chat', 'npc_bob', 'success')
    const saved = g.save('manual', 't')
    nextDay(g)
    expect(g.load(saved)).toBeNull()
    expect(doneToday(g.state, 'npc_bob')).toEqual(['chat'])
    expect(row(g, 'npc_bob', 'npc_gift').ok).toBe(true)
  })

  it('tableEffects 是 6.1 節那張表（單元）：每個互動每個成功程度', () => {
    const { g } = make()
    know(g, 'npc_cora', 0)
    const n = npcOf(g.k, g.state, 'npc_cora')!
    const t = (kind: InteractKind, degree: Degree, extra: Record<string, unknown> = {}) => tableEffects(g.k, g.state, kind, n, { kind, target: n.id, ...extra }, degree).map((e) => `${e.kind}:${String(e.key ?? '')}:${String(e.amount ?? e.qty ?? '')}`)
    expect(t('npc_chat', 'critical')).toEqual(['affinity:npc_cora:4'])
    expect(t('npc_seduce', 'critical')).toEqual(['affinity:npc_cora:5'])
    expect(t('npc_intimidate', 'success')).toEqual(['affinity:npc_cora:-3'])
    expect(t('npc_intimidate', 'fumble')).toEqual(['hostility:f_beta:3'])
    expect(t('npc_steal', 'fail')).toEqual(['affinity:npc_cora:-10', 'hostility:f_beta:3'])
    expect(t('npc_steal', 'fumble')).toEqual(['affinity:npc_cora:-20', 'hostility:f_beta:6'])
    expect(t('npc_gift', 'success', { item: 'it_flower' })).toEqual(['affinity:npc_cora:2', 'item::-1'])
    expect(t('npc_ask_big', 'success')).toEqual([])
  })
})

// ---- AI 開著 ----

describe('AI 開著（假的服務商）：走 judge，AI 給的效果被夾在量表的上限裡', () => {
  const judgeOk = (over: Rec = {}) => (req: Parameters<typeof inputOf>[0]) => {
    const i = inputOf<{ roll: { degree: string }; ref_dc: number }>(req)
    return { json: { degree: i.roll.degree, dc: i.ref_dc, reason: '鮑勃愣了一下。', twist: '', minutes: 10, ...over } }
  }

  it('走了 judge；AI 給的親密度 +50 夾到量表的一件事上限 +8、報告卡有提醒，表不再加同一件；今天的次數照記', async () => {
    const { g, fake } = make({ fake: { byTask: { judge: [judgeOk()], reward: [{ json: { items: [{ kind: 'affinity', key: 'npc_bob', amount: 50, from: { source: 'degree' } }] } }] } } })
    know(g, 'npc_bob', 0)
    const input = interactInput(g.k, g.state, 'npc_chat', 'npc_bob')
    rig(g, input, 'success')
    const r = await g.act(input, { autoRules: true })
    expect(r.status).toBe('applied')
    expect(fake!.requestsFor('judge')).toHaveLength(1)
    expect(aff(g, 'npc_bob')).toBe(8)
    expect(r.reports[0]!.clamps!.length).toBeGreaterThan(0)
    expect(doneToday(g.state, 'npc_bob')).toEqual(['chat'])
  })

  it('AI 給的是負的、同一件事：親密度 −50 也只扣到 −8；AI 沒交的別件（偷到的錢）就是沒有（AI 開著時算回報由 AI 說了算）；表的結果在給 AI 的參考範圍裡', async () => {
    const { g, fake } = make({ fake: { byTask: { reward: [{ json: { items: [{ kind: 'affinity', key: 'npc_cora', amount: -50, from: { source: 'degree' } }] } }] } } })
    know(g, 'npc_cora', 0)
    const input = interactInput(g.k, g.state, 'npc_steal', 'npc_cora')
    rig(g, input, 'success')
    const before = cash(g)
    const r = await g.act(input, { autoRules: true })
    expect(r.status).toBe('applied')
    expect(aff(g, 'npc_cora')).toBe(-8)
    expect(cash(g)).toBe(before)
    const hint = inputOf<{ hint: Array<{ kind: string; amount?: number }> }>(fake!.requestsFor('reward')[0]!).hint
    expect(hint.map((e) => e.kind)).toEqual(['cash'])
    expect(hint[0]!.amount).toBeGreaterThan(0)
  })

  it('AI 開著、算回報走到退路（AI 交的不合格、自動用規則）：照表結算，不受 AI 的上限管（誘惑大成功 +5、偷竊大失敗 −20 與敵對值 +6），結果在 narration.results', async () => {
    const { g } = make({ fake: { adversarial: { mode: 'unknown_id', tasks: ['reward'] } } })
    know(g, 'npc_cora', 0)
    const s = interactInput(g.k, g.state, 'npc_seduce', 'npc_cora')
    rig(g, s, 'critical')
    const r1 = await g.act(s, { autoRules: true })
    expect(r1.status).toBe('applied')
    expect(r1.run.steps.find((x) => x.id === 'reward')!.status).toBe('fallback')
    expect(aff(g, 'npc_cora')).toBe(5)
    const t = interactInput(g.k, g.state, 'npc_steal', 'npc_cora')
    rig(g, t, 'fumble')
    const { result, violations } = await observed(g, () => g.act(t, { autoRules: true }))
    expect(result.status).toBe('applied')
    expect(violations).toEqual([])
    expect(aff(g, 'npc_cora')).toBe(-15)
    expect(host(g, 'f_beta')).toBe(6)
    expect(result.reports[0]!.narration!.results).toEqual(['親密度（科拉）：−20', '敵對值（貝塔）：+6'])
  })

  it('AI 開著、交的合格但沒有照表給：AI 說了算（給 AI 的參考範圍是表，但照量表的上限夾：親密度 −20 夾成 −8）', async () => {
    const { g } = make({ fake: {} })
    know(g, 'npc_cora', 0)
    const t = interactInput(g.k, g.state, 'npc_steal', 'npc_cora')
    rig(g, t, 'fumble')
    const r = await g.act(t, { autoRules: true })
    expect(r.status).toBe('applied')
    expect(r.run.steps.find((x) => x.id === 'reward')!.status).toBe('done')
    expect(aff(g, 'npc_cora')).toBe(-8)
    expect(r.reports[0]!.clamps!.length).toBeGreaterThan(0)
    expect(doneToday(g.state, 'npc_cora')).toEqual([])
  })
})

// ---- M2 修正批 14：interactions 的 note、knowFactText 的匯出 ----

describe('interactions 的 note：今天聊過了，再聊不會再加親密度（說明句由引擎給，畫面不自己讀 doneToday 寫）', () => {
  it('還沒聊過：note 是 null；聊過之後（成功的、大失敗的都算做過）：聊天那一列 ok 照舊、reason 是 null、note 是那一句；別的互動沒有 note', async () => {
    const { g } = make()
    know(g, 'npc_bob', 0)
    expect(row(g, 'npc_bob', 'npc_chat')).toMatchObject({ ok: true, reason: null, note: null })
    await act(g, 'npc_chat', 'npc_bob', 'success')
    expect(doneToday(g.state, 'npc_bob')).toContain('chat')
    expect(row(g, 'npc_bob', 'npc_chat')).toMatchObject({ ok: true, reason: null, note: CHAT_DONE_NOTE })
    expect(CHAT_DONE_NOTE).toBe('今天聊過了，不會再加親密度。')
    for (const v of interactions(g.k, g.state, 'npc_bob').filter((x) => x.kind !== 'npc_chat')) expect(v.note, v.kind).toBeNull()
  })

  it('說的是真的：同一天再聊一次確實不加親密度；隔天又重置，note 消失，又能加', async () => {
    const { g } = make()
    know(g, 'npc_bob', 0)
    await act(g, 'npc_chat', 'npc_bob', 'success')
    const first = aff(g, 'npc_bob')
    expect(first).toBeGreaterThan(0)
    await act(g, 'npc_chat', 'npc_bob', 'success')
    expect(aff(g, 'npc_bob')).toBe(first)
    nextDay(g)
    expect(row(g, 'npc_bob', 'npc_chat').note).toBeNull()
    await act(g, 'npc_chat', 'npc_bob', 'success')
    expect(aff(g, 'npc_bob')).toBeGreaterThan(first)
  })

  it('對象查不到（沒有這個人）：每一列都做不了、沒有 note；聊天被別的原因擋住時（還不認識也不在這裡）也沒有 note，只有 reason', () => {
    const { g } = make()
    for (const v of interactions(g.k, g.state, 'npc_nobody')) expect(v, v.kind).toMatchObject({ ok: false, note: null })
    const far = row(g, 'npc_cora', 'npc_chat')
    if (!far.ok) expect(far.note).toBeNull()
  })
})

describe('knowFactText 從人物功能匯出（畫面把「知道的事」寫成句子用）', () => {
  it('每一種寫法都有一句話：傾向、橋、契約、秘密、最近的行蹤；名字用傳進去的函式換', () => {
    expect(knowFactText('bridge')).toBeTypeOf('string')
    expect(knowFactText('contract')).toBeTypeOf('string')
    expect(knowFactText('tendency:tg_x', (t) => `「${t}」`)).toContain('「tg_x」')
    expect(knowFactText('recent:b_market', undefined, (p) => `<${p}>`)).toContain('<b_market>')
    expect(knowFactText('secret:鑰匙')).toContain('鑰匙')
  })
})

// ---- 使用者新增的輸入欄（2026-11-25；M4-followups）：稱呼與送禮附的一句話 ----

describe('稱呼（NPC_SYSTEM 7.0 節）', () => {
  it('認識的人可以填「你怎麼叫他」「他怎麼叫你」（最多 12 字，原樣存）；不改親密度；清空是 null；不認識的人、超過 12 字、什麼都沒填擋下', () => {
    const { g } = make()
    know(g, 'npc_ann', 6)
    const before = aff(g, 'npc_ann')
    g.commit(callNamesDraft(g.k, g.state, 'npc_ann', { call_them: '小貓', call_me: '前輩' }))
    expect(callNamesOf(g.state, 'npc_ann')).toEqual({ call_them: '小貓', call_me: '前輩' })
    expect(aff(g, 'npc_ann')).toBe(before)
    expect(g.state.reports[g.state.reports.length - 1]!.action).toBe('npc.call')
    // 原樣：空白、標點、任何字都不動（只看字數）
    g.commit(callNamesDraft(g.k, g.state, 'npc_ann', { call_them: ' ，、。！ ' }))
    expect(callNamesOf(g.state, 'npc_ann').call_them).toBe(' ，、。！ ')
    g.commit(callNamesDraft(g.k, g.state, 'npc_ann', { call_them: 'x'.repeat(CALL_MAX) }))
    expect(callNamesBlock(g.state, 'npc_ann', { call_me: 'y'.repeat(CALL_MAX + 1) })).toBe(`「他怎麼叫你」最多 ${CALL_MAX} 個字。`)
    expect(callNamesBlock(g.state, 'npc_ann', { call_them: 'y'.repeat(CALL_MAX + 1) })).toBe(`「你怎麼叫他」最多 ${CALL_MAX} 個字。`)
    expect(callNamesBlock(g.state, 'npc_ann', {})).toMatch(/要改/)
    expect(callNamesBlock(g.state, 'npc_nobody', { call_them: 'a' })).toBe('你還不認識這個人，沒辦法改稱呼。')
    g.commit(callNamesDraft(g.k, g.state, 'npc_ann', { call_them: null }))
    expect(callNamesOf(g.state, 'npc_ann')).toEqual({ call_me: '前輩' })
    g.commit(callNamesDraft(g.k, g.state, 'npc_ann', { call_me: '' }))
    expect(callNamesOf(g.state, 'npc_ann')).toEqual({})
  })
})

describe('送禮附一句話（NPC_SYSTEM 6.3 節）', () => {
  it('收下了：那句話原樣進共同記憶（和這個人），親密度和沒附的一樣；沒收下（失敗）不記；超過 200 字不記', async () => {
    const { g } = make()
    know(g, 'npc_ann', 0)
    const plain = make()
    know(plain.g, 'npc_ann', 0)
    await act(plain.g, 'npc_gift', 'npc_ann', 'success', { item: 'it_flower' })
    const note = '  上次你說想吃真的草莓。  '
    await act(g, 'npc_gift', 'npc_ann', 'success', { item: 'it_flower', note })
    expect(aff(g, 'npc_ann')).toBe(aff(plain.g, 'npc_ann'))
    const noted = memoriesOf(g.state).filter((m) => m.text.includes('真的草莓'))
    expect(noted).toHaveLength(1)
    expect(noted[0]!.who).toContain('npc_ann')
    const failed = make()
    know(failed.g, 'npc_ann', 0)
    await act(failed.g, 'npc_gift', 'npc_ann', 'fail', { item: 'it_flower', note })
    expect(memoriesOf(failed.g.state).some((m) => m.text.includes('真的草莓'))).toBe(false)
    const long = make()
    know(long.g, 'npc_ann', 0)
    await act(long.g, 'npc_gift', 'npc_ann', 'success', { item: 'it_flower', note: '草'.repeat(GIFT_NOTE_MAX + 1) })
    expect(memoriesOf(long.g.state).some((m) => m.text.includes('草草草'))).toBe(false)
  })
})
