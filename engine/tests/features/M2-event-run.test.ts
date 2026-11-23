// 驗收測試：dev/work/M2-event-run.md（cpp-feature）。規格：EVENTS 2.1、2.3、2.4、3.6、3.7（自由回應）、第 5 節（只連一層）、第 6 節；
// DATA 第 4 節（adult_scene）、第 5 節（versions、stages、inherit、fallback）；dev/adr/0016 第一、四節。
// 內容一律用測試自帶的最小假資料。量表（敵對值、好感）用 testkit 的 meterFeature；
// 發起事件的功能（caller）、成人場景（scene）、新生成的人（cast_stub）用測試裡的替身。
//
// 預設的假資料：範圍 street（主角擲）、crew（隊上最好的人擲、DC +2）；事件的表頭 { scope: 'street', triggers: ['enter_block'] }。
// 擲骰：骰面從存檔的亂數導出（用途是 event/<活動 id>/<第幾段>/<選項 id>），測試先在同一個種子上看骰面，再把 DC 設成想要的成功程度。

import { describe, expect, it } from 'vitest'
import type { Actor, ContentPack, Feature, GameState, Launch, Origin, Report, ReportDraft } from '../../src'
import { ActionBlocked, ContentError, computeDegree, meterOf } from '../../src'
import { chooseOption, directorFeature, directorOf, eventRunFeature, eventView, openEventOf, resolveBody } from '../../src/features/director'
import type { EventView } from '../../src/features/director'
import { pickEvent, treatEvent } from '../../src/features/enemies/capture'
import type { CaptureCandidate } from '../../src/features/enemies/capture'
import { BATTLE_SETUPS, METER_CONTENT, makeActor, makeGame, meterFeature, observed, testMeter } from '../../src/testkit'

// ---- 替身 ----

/** 發起的功能：收 activity.end（只認 origin.by 是 caller 的），記下收到的東西，回傳一行字與一個旗標。 */
interface Heard { kind: string; id: string; origin: Origin; outcome: string; result: Record<string, unknown> }
const caller = (log: Heard[]): Feature => ({
  id: 'caller',
  install(k) {
    k.hooks.on('activity.end', 'caller', (p) => {
      if (p.kind !== 'event' || p.origin.by !== 'caller') return
      log.push({ kind: p.kind, id: p.id, origin: p.origin, outcome: p.outcome, result: p.result })
      return { lines: ['發起的人收到了結果'], changes: [{ op: 'flag', key: `heard_${String(p.result.option)}`, value: true }] }
    })
  },
})

/** 成人場景：只記下 setup 的活動（kind 是 scene）。 */
const SCENE_KEY = 'scene_stub'
const sceneStub: Feature = {
  id: 'scene_stub',
  install(k) {
    k.activity.define({
      kind: 'scene', owner: 'scene_stub', order: 20,
      active: (s) => (s.ext[SCENE_KEY] ? { id: 'sc1', label: '成人場景' } : null),
      allow: ['scene.', 'commit:scene.'],
      reason: () => '場景進行中。',
      start: (_k, state, setup, origin) => [{ kind: 'social', action: 'scene.start', location: { ...state.location }, party: [], timeline: [], changes: [{ op: 'ext', key: SCENE_KEY, value: { setup, origin } }], outcome: { result: 'open', summary: '場景開了。' } }],
    })
  },
}
const sceneOf = (s: GameState) => s.ext[SCENE_KEY] as { setup: Record<string, unknown>; origin: Origin } | undefined

/** 新生成的人：回答 npc: npc_ann（回傳角色與 actor.add），其餘不答。 */
const castStub: Feature = {
  id: 'cast_stub',
  install(k) {
    k.hooks.on('director.cast', 'cast_stub', ({ spec }) => {
      if (spec.npc !== 'npc_ann') return
      return { actor: 'npc_ann', changes: [{ op: 'actor.add', actor: makeActor({ id: 'npc_ann', name: '安', role: 'npc' }) }] }
    })
  },
}

// ---- 假資料 ----

type Fx = Record<string, unknown>
const cash = (amount: number): Fx => ({ kind: 'cash', amount })
const hostility = (amount: number, key = 'f_alpha'): Fx => ({ kind: 'hostility', key, amount })
const flag = (key: string): Fx => ({ kind: 'flag', key, value: true })

const SCOPES = [
  { id: 'street', triggers: { enter_block: 1 }, cooldown_hours: 0, repeat_days: 0, lost: 'drop' },
  { id: 'crew', triggers: { enter_block: 1 }, roller: 'best', dc_plus: 2 },
  { id: 'solo', triggers: { enter_block: 1 }, roller: 'pc' },
]
const ev = (id: string, body: Fx, o: Fx = {}): Fx => ({ id, scope: 'street', triggers: ['enter_block'], ...body, ...o })
const opt = (id: string, text: string, o: Fx = {}): Fx => ({ id, text, outcomes: { any: [] }, ...o })

/** 一個帶檢定的選項：四級結果各不一樣。dc 可以是階梯的名字或數字。 */
const rollOption = (dc: number | string): Fx => opt('o1', '試試看。', {
  check: ['negotiate', 'charm', dc],
  outcomes: { critical: [cash(110)], success: [cash(50)], fail: [hostility(2)], fumble: [hostility(5), cash(-20)] },
})
const rollEvent = (dc: number | string, o: Fx = {}): Fx => ev('ev_roll', { text: '一個人擋住了去路。', options: [rollOption(dc), opt('o2', '走開。', { outcomes: { any: [flag('walked_away')] } })] }, o)

type Content = Record<string, Array<Record<string, unknown>>>
interface Opts {
  events?: Fx[]
  content?: Content
  features?: Feature[]
  seed?: number
  pc?: Parameters<typeof makeGame>[0] extends infer S ? (S extends { pc?: infer P } ? P : never) : never
  actors?: Actor[]
  patch?: Partial<GameState>
}
const pack = (o: Opts): ContentPack => ({ id: 'event_run_test', content: { event_scope: SCOPES, event: o.events ?? [rollEvent(13)], ...o.content } as unknown as ContentPack['content'] })
const make = (o: Opts = {}) =>
  makeGame({
    features: [directorFeature, eventRunFeature, meterFeature(
      testMeter({ kind: 'hostility', owner: 'test', name: '敵對值', keyed: 'faction' }),
      testMeter({ kind: 'favor', owner: 'test', name: '好感', keyed: 'faction' }),
      testMeter({ kind: 'affinity', owner: 'test', name: '親密度', keyed: 'npc', min: -100, max: 100 }),
    ), ...(o.features ?? [])],
    content: [METER_CONTENT, pack(o)], seed: o.seed ?? 7,
    pc: o.pc ?? { skills: { negotiate: 2 } }, actors: o.actors, patch: { money: { cred: 0, cash: 100 }, time: { day: 3, hour: 10, minute: 0 }, ...o.patch },
  }).game
type G = ReturnType<typeof make>

const open = (g: G, event: string, extra: Fx = {}) => g.launch('event', { event, ...extra }, { by: 'caller', ref: 'x1', ext: { k: 1 } })
const pick = (g: G, id: string): Report[] => g.commit(chooseOption(g.k, g.state, id))
const view = (g: G): EventView => eventView(g.k, g.state)!
const ids = (g: G): string[] => view(g).options.map((o) => o.id)
const rollOf = (d: ReportDraft) => d.timeline.find((b) => b.roll)?.roll
const walk = (): ReportDraft => ({ kind: 'action', action: 'test.walk', location: { district: 'test', block: 'empty_room' }, party: [], timeline: [], changes: [{ op: 'time', minutes: 5 }], outcome: { result: 'ok', summary: '走了幾步' } })
const hostilityOf = (g: G, faction = 'f_alpha'): number => meterOf(g.k, g.state, 'hostility', faction)

/** 在同一個種子上先看骰面（骰面不看 DC），找一個自然骰 6～15 的種子，之後 DC 設成 total ± 幾就是想要的成功程度。 */
function findRoll(): { seed: number; natural: number; total: number } {
  for (let seed = 1; seed < 400; seed++) {
    const g = make({ seed })
    open(g, 'ev_roll')
    const r = rollOf(chooseOption(g.k, g.state, 'o1'))!
    if (r.natural >= 6 && r.natural <= 15) return { seed, natural: r.natural, total: r.total }
  }
  throw new Error('找不到合適的種子')
}
const ROLL = findRoll()
/** 想要的成功程度 → 數字 DC（自然骰不是 1 也不是 20，所以只看差距：差 5 以上大成功、差 −5 以下大失敗）。 */
const DC_FOR = { critical: ROLL.total - 5, success: ROLL.total - 1, fail: ROLL.total + 1, fumble: ROLL.total + 5 } as const

// ---- 選項、檢定與四級結果 ----

describe('選項與檢定：固定骰面下四種成功程度各走到對的那一組', () => {
  const run = (degree: keyof typeof DC_FOR) => {
    const g = make({ seed: ROLL.seed, events: [rollEvent(DC_FOR[degree])] })
    open(g, 'ev_roll')
    const reports = pick(g, 'o1')
    return { g, reports, close: reports.find((r) => r.action === 'event.close')! }
  }

  it('大成功：錢 +110；成功：錢 +50；失敗：敵對值 +2；大失敗：敵對值 +5 並扣 20 塊', () => {
    const crit = run('critical')
    expect(crit.close.outcome.result).toBe('critical')
    expect(crit.g.state.money.cash).toBe(210)
    const ok = run('success')
    expect(ok.close.outcome.result).toBe('success')
    expect(ok.g.state.money.cash).toBe(150)
    expect(hostilityOf(ok.g)).toBe(0)
    const fail = run('fail')
    expect(fail.close.outcome.result).toBe('fail')
    expect(hostilityOf(fail.g)).toBe(2)
    expect(fail.g.state.money.cash).toBe(100)
    const fumble = run('fumble')
    expect(fumble.close.outcome.result).toBe('fumble')
    expect(hostilityOf(fumble.g)).toBe(5)
    expect(fumble.g.state.money.cash).toBe(80)
  })

  it('報告的時間軸有那一次擲骰（骰面、加值、DC、成功程度），一次選擇只擲一次', () => {
    const { g, close } = run('success')
    const rolls = close.timeline.filter((b) => b.roll)
    expect(rolls).toHaveLength(1)
    const r = rolls[0]!.roll!
    expect(r.natural).toBe(ROLL.natural)
    expect(r.dc).toBe(DC_FOR.success)
    expect(r.degree).toBe('success')
    expect(r.parts.map((p) => p.source)).toContain('skill')
    expect(close.kind).toBe('event')
    expect(g.state.rng.cursor).toBe(1)
    // 報告的紀錄不變式
    expect(close.changes.some((c) => c.op === 'rng')).toBe(true)
  })

  it('缺的結果往旁邊找：大成功用成功的、大失敗用失敗的；沒有檢定的選項用 any', () => {
    const body = { text: '只寫了兩組。', options: [opt('o1', '試試看。', { check: ['negotiate', 'charm', 0 + DC_FOR.critical], outcomes: { success: [cash(30)], fail: [hostility(1)] } }), opt('o2', '不試。', { outcomes: { any: [cash(10)] } })] }
    const critical = make({ seed: ROLL.seed, events: [ev('ev_roll', body)] })
    open(critical, 'ev_roll')
    pick(critical, 'o1')
    expect(critical.state.money.cash).toBe(130) // 大成功沒有寫，用成功的
    const fumbleBody = { ...body, options: [opt('o1', '試試看。', { check: ['negotiate', 'charm', DC_FOR.fumble], outcomes: { success: [cash(30)], fail: [hostility(1)] } })] }
    const fumble = make({ seed: ROLL.seed, events: [ev('ev_roll', fumbleBody)] })
    open(fumble, 'ev_roll')
    pick(fumble, 'o1')
    expect(hostilityOf(fumble)).toBe(1) // 大失敗沒有寫，用失敗的
    const plain = make({ events: [ev('ev_roll', body)] })
    open(plain, 'ev_roll')
    pick(plain, 'o2')
    expect(plain.state.money.cash).toBe(110)
    expect(plain.state.rng.cursor).toBe(0) // 沒有檢定就不擲
  })

  it('沒有開著的事件、沒有這個選項：丟 ActionBlocked，狀態不動', () => {
    const g = make()
    expect(() => chooseOption(g.k, g.state, 'o1')).toThrow(ActionBlocked)
    open(g, 'ev_roll')
    const before = JSON.stringify(g.state)
    expect(() => chooseOption(g.k, g.state, 'nope')).toThrow(/沒有這個選項/)
    expect(JSON.stringify(g.state)).toBe(before)
  })

  it('同一個種子結果一樣（骰面與報告都一樣）；種子不同，骰面就會不同', () => {
    const naturals = (seed: number) => {
      const g = make({ seed })
      open(g, 'ev_roll')
      const d = chooseOption(g.k, g.state, 'o1')
      return { natural: rollOf(d)!.natural, d: JSON.stringify(d) }
    }
    expect(naturals(5)).toEqual(naturals(5))
    expect(new Set([1, 2, 3, 4, 5, 6, 7, 8].map((s) => naturals(s).natural)).size).toBeGreaterThan(2)
  })
})

describe('數字 DC 與難度的階梯', () => {
  const dcOf = (check: unknown[], o: Opts = {}): number => {
    const g = make({ ...o, events: [ev('ev_roll', { text: '看。', options: [opt('o1', '試。', { check })] })] })
    open(g, 'ev_roll')
    return view(g).options[0]!.check!.dc
  }

  it('階梯的名字照核心的表（容易 10、普通 13、困難 16、極難 19、傳說 22、超凡 25）；數字原樣', () => {
    expect(['easy', 'normal', 'hard', 'extreme', 'legendary', 'mythic'].map((t) => dcOf(['negotiate', 'charm', t]))).toEqual([10, 13, 16, 19, 22, 25])
    expect(dcOf(['negotiate', 'charm', 14])).toBe(14)
    expect(dcOf(['negotiate', 'charm', 24])).toBe(24)
    expect(dcOf(['negotiate', 'charm', 1])).toBe(1)
  })

  it('存檔規則的難度偏移與範圍的 dc_plus 都加上去，數字 DC 也一樣；view 記得階梯的名字', () => {
    expect(dcOf(['negotiate', 'charm', 12], { patch: { rules: { dcOffset: 2 } } as never })).toBe(14)
    expect(dcOf(['negotiate', 'charm', 'hard'], { patch: { rules: { dcOffset: -1 } } as never })).toBe(15)
    const g = make({ events: [ev('ev_roll', { text: '看。', options: [opt('o1', '試。', { check: ['negotiate', 'charm', 'normal'] })] }, { scope: 'crew' })] })
    open(g, 'ev_roll')
    expect(view(g).options[0]!.check).toMatchObject({ dc: 15, tier: 'normal' })
    const numeric = make({ events: [ev('ev_roll', { text: '看。', options: [opt('o1', '試。', { check: ['negotiate', 'charm', 12] })] })] })
    open(numeric, 'ev_roll')
    expect(view(numeric).options[0]!.check!.tier).toBeUndefined()
  })

  it('檢定只寫兩項（基本功與難度）時屬性取基本功預設的屬性；不是整數或超出範圍的數字在載入時擋下', () => {
    const skills: Content = { skill: [{ id: 'negotiate', name: '交涉', attr: 'charm', desc: '把話談成。' }] }
    const g = make({ content: skills, events: [ev('ev_roll', { text: '看。', options: [opt('o1', '試。', { check: ['negotiate', 'hard'] })] })] })
    open(g, 'ev_roll')
    expect(view(g).options[0]!.check).toMatchObject({ attr: 'charm', skill_name: '交涉', dc: 16 })
    for (const bad of [0, 41, 12.5, -3, 'impossible']) {
      expect(() => make({ events: [ev('ev_roll', { text: '看。', options: [opt('o1', '試。', { check: ['negotiate', 'charm', bad] })] })] })).toThrow(ContentError)
    }
  })
})

describe('誰擲：範圍的 roller', () => {
  const crewEvent = (): Fx => ev('ev_roll', { text: '隊伍遇到的事。', options: [opt('o1', '上前交涉。', { check: ['negotiate', 'charm', 'normal'], outcomes: { any: [flag('rolled')] } })] }, { scope: 'crew' })
  const ally = (skill: number, charm = 12): Actor => makeActor({ id: 'ally', name: '夥伴', role: 'companion', attrs: { charm }, skills: { negotiate: skill } })

  it('roller 是 pc：主角擲，不協力；沒寫 roller 也是主角擲', () => {
    const g = make({ actors: [ally(3)], events: [ev('ev_roll', { text: '看。', options: [opt('o1', '試。', { check: ['negotiate', 'charm', 'normal'] })] }, { scope: 'solo' })] })
    open(g, 'ev_roll')
    expect(view(g).options[0]!.check).toMatchObject({ roller: 'pc', assist: false })
    const plain = make({ actors: [ally(3)] })
    open(plain, 'ev_roll')
    expect(view(plain).options[0]!.check).toMatchObject({ roller: 'pc', assist: false })
  })

  it('roller 是 best：隊上這一項最好的人擲；另一位有同一項 2 級以上協力 +2', () => {
    const g = make({ actors: [ally(3)], pc: { skills: { negotiate: 2 } }, events: [crewEvent()] })
    open(g, 'ev_roll')
    const o = view(g).options[0]!.check!
    expect(o).toMatchObject({ roller: 'ally', roller_name: '夥伴', assist: true, dc: 15 })
    // 加值：魅力 12 → +1、交涉 3、協力 +2
    expect(o.bonus).toBe(1 + 3 + 2)
    const d = chooseOption(g.k, g.state, 'o1')
    const roll = rollOf(d)!
    expect(d.timeline.find((b) => b.roll)!.actor).toBe('ally')
    expect(roll.parts.map((p) => [p.label, p.value])).toEqual(expect.arrayContaining([['協力', 2]]))
    expect(d.actor).toBe('ally')
  })

  it('另一位沒有 2 級：不協力；主角比較強：主角擲', () => {
    const g = make({ actors: [ally(3)], pc: { skills: { negotiate: 1 } }, events: [crewEvent()] })
    open(g, 'ev_roll')
    expect(view(g).options[0]!.check).toMatchObject({ roller: 'ally', assist: false })
    const strong = make({ actors: [ally(1, 10)], pc: { attrs: { charm: 14 }, skills: { negotiate: 3 } }, events: [crewEvent()] })
    open(strong, 'ev_roll')
    expect(view(strong).options[0]!.check).toMatchObject({ roller: 'pc', assist: false })
    // 一樣好的：照隊伍的順序（主角在前）
    const tie = make({ actors: [ally(2, 10)], pc: { skills: { negotiate: 2 } }, events: [crewEvent()] })
    open(tie, 'ev_roll')
    expect(view(tie).options[0]!.check).toMatchObject({ roller: 'pc', assist: true })
  })

  it('成功率是骰面 1～20 各算一次、成功與大成功的比例', () => {
    const g = make({ actors: [ally(3)], pc: { skills: { negotiate: 2 } }, events: [crewEvent()] })
    open(g, 'ev_roll')
    const c = view(g).options[0]!.check!
    let ok = 0
    for (let n = 1; n <= 20; n++) if (['success', 'critical'].includes(computeDegree(n, n + c.bonus, c.dc))) ok++
    expect(c.chance).toBe(Math.round((ok / 20) * 100))
    // 差很多的時候：自然 20 永遠大成功、自然 1 永遠大失敗，所以不會是 0 或 100
    const hopeless = make({ events: [ev('ev_roll', { text: '看。', options: [opt('o1', '試。', { check: ['negotiate', 'charm', 40] })] })] })
    open(hopeless, 'ev_roll')
    expect(view(hopeless).options[0]!.check!.chance).toBe(5)
    const sure = make({ events: [ev('ev_roll', { text: '看。', options: [opt('o1', '試。', { check: ['negotiate', 'charm', 1] })] })] })
    open(sure, 'ev_roll')
    expect(view(sure).options[0]!.check!.chance).toBe(95)
  })
})

// ---- need 與 show_locked ----

describe('need 與 show_locked', () => {
  const body = {
    text: '門口有人守著。',
    options: [
      opt('free', '直接走過去。'),
      opt('hidden', '亮出通行證。', { need: { kind: 'flag', key: 'has_pass' }, outcomes: { any: [cash(10)] } }),
      opt('locked', '報上名字。', { need: { kind: 'flag', key: 'known' }, show_locked: '要有人認得你才行。', outcomes: { any: [cash(20)] } }),
    ],
  }

  it('need 不成立的選項不在清單裡；寫了 show_locked 的在、帶原因、選了被擋下；條件成立之後都選得了', () => {
    const g = make({ events: [ev('ev_door', body)] })
    open(g, 'ev_door')
    expect(ids(g)).toEqual(['free', 'locked'])
    const locked = view(g).options.find((o) => o.id === 'locked')!
    expect(locked.locked).toBe('要有人認得你才行。')
    expect(view(g).options.find((o) => o.id === 'free')!.locked).toBeNull()
    const before = JSON.stringify(g.state)
    expect(() => chooseOption(g.k, g.state, 'locked')).toThrow('要有人認得你才行。')
    expect(() => chooseOption(g.k, g.state, 'hidden')).toThrow(/沒有這個選項/)
    expect(JSON.stringify(g.state)).toBe(before)
    // 條件成立
    g.commit({ kind: 'system', action: 'event.flag', location: {}, party: [], timeline: [], changes: [{ op: 'flag', key: 'has_pass', value: true }, { op: 'flag', key: 'known', value: true }], outcome: { result: 'ok', summary: '有了' } })
    expect(ids(g)).toEqual(['free', 'hidden', 'locked'])
    expect(view(g).options.every((o) => o.locked === null)).toBe(true)
    pick(g, 'hidden')
    expect(g.state.money.cash).toBe(110)
  })

  it('show_locked 寫 true：給一句通用的原因；need 可以是一串條件（全部成立）', () => {
    const g = make({ events: [ev('ev_door', { text: '門。', options: [opt('a', '甲。', { need: [{ kind: 'flag', key: 'x' }, { kind: 'flag', key: 'y' }], show_locked: true })] })] })
    open(g, 'ev_door')
    expect(view(g).options[0]!.locked).toMatch(/條件/)
  })
})

// ---- 事件開著時別的報告被擋 ----

describe('事件視窗是一個活動：開著時擋住別的事', () => {
  it('走地圖、休息這類別的報告被擋下，句子是事件視窗給的；選完之後不擋', () => {
    const g = make()
    expect(g.blockOf('commit:test.walk')).toBeNull()
    open(g, 'ev_roll')
    expect(g.k.activity.active(g.state).map((a) => a.kind)).toEqual(['event'])
    expect(g.blockOf('commit:test.walk')).toMatch(/先回應/)
    expect(g.blockOf('commit:rest.sleep')).toMatch(/先回應/)
    expect(g.blockOf('grid.move')).toMatch(/先回應/)
    const before = JSON.stringify(g.state)
    expect(() => g.commit(walk())).toThrow(ActionBlocked)
    expect(JSON.stringify(g.state)).toBe(before)
    // 事件自己的報告與自由行動放行
    expect(g.blockOf('commit:event.choose')).toBeNull()
    expect(g.blockOf('commit:event.close')).toBeNull()
    expect(g.blockOf('chain:free_action')).toBeNull()
    pick(g, 'o2')
    expect(g.k.activity.active(g.state)).toEqual([])
    expect(g.blockOf('commit:test.walk')).toBeNull()
    g.commit(walk())
  })

  it('同時只開一件：已經開著時再開丟 ActionBlocked；開著時別的功能可以用 k.activity.allow 把自己的行動放進來', () => {
    const g = make()
    open(g, 'ev_roll')
    expect(() => open(g, 'ev_roll')).toThrow(/已經有一件事件開著/)
    expect(() => g.k.activity.start(g.k, g.state, 'event', { event: 'ev_roll' })).toThrow(ActionBlocked)
    const h = make({ features: [{ id: 'extra', install: (k) => k.activity.allow('event', 'commit:test.', 'extra') }] })
    open(h, 'ev_roll')
    expect(h.blockOf('commit:test.walk')).toBeNull()
  })

  it('沒有這件事件、沒給 event 或 inline：開不成，一條一句', () => {
    const g = make()
    expect(() => open(g, 'nope')).toThrow(/沒有「nope」/)
    expect(() => g.launch('event', {})).toThrow(ActionBlocked)
    expect(() => g.launch('event', { event: 'ev_roll', inline: { id: 'x' } })).toThrow(/不能兩個都給/)
    expect(g.k.activity.active(g.state)).toEqual([])
  })
})

// ---- 多段 ----

describe('多段的事件', () => {
  const stage = (n: number, o: Fx = {}): Fx => ({ text: `第 ${n} 段。`, options: [opt('go', `往下走（${n}）。`, { outcomes: { any: [flag(`s${n}`)] }, ...o }), opt('stop', `在這裡停（${n}）。`, { ends: true, outcomes: { any: [flag(`stop${n}`)] } })] })
  const three = ev('ev_three', { text: '一個很長的夜晚。', stages: [stage(1), stage(2), stage(3)] })

  it('三段的事件走完三段才結束：前兩段是 event.choose、事件還開著；最後一段是 event.close', () => {
    const log: Heard[] = []
    const g = make({ events: [three], features: [caller(log)] })
    open(g, 'ev_three')
    expect(view(g).stage).toEqual({ index: 0, count: 3 })
    expect(view(g).text).toBe('一個很長的夜晚。\n第 1 段。')
    const r1 = pick(g, 'go')
    expect(r1.map((r) => r.action)).toEqual(['event.choose'])
    expect(openEventOf(g.state)).not.toBeNull()
    expect(view(g).stage).toEqual({ index: 1, count: 3 })
    expect(view(g).text).toBe('第 2 段。')
    expect(g.state.flags.s1).toBe(true)
    expect(log).toHaveLength(0)
    expect(pick(g, 'go').map((r) => r.action)).toEqual(['event.choose'])
    expect(view(g).stage.index).toBe(2)
    const last = pick(g, 'go')
    expect(last.map((r) => r.action)).toEqual(['event.close'])
    expect(openEventOf(g.state)).toBeNull()
    expect(g.k.activity.active(g.state)).toEqual([])
    expect(g.state.flags).toMatchObject({ s1: true, s2: true, s3: true })
    expect(log).toHaveLength(1)
    expect(log[0]!.result).toMatchObject({ event: 'ev_three', option: 'go', stage: 2, flags: [] })
  })

  it('第二段的選項寫 ends 就提早結束，後面的段不走', () => {
    const log: Heard[] = []
    const g = make({ events: [three], features: [caller(log)] })
    open(g, 'ev_three')
    pick(g, 'go')
    const r = pick(g, 'stop')
    expect(r.map((x) => x.action)).toEqual(['event.close'])
    expect(openEventOf(g.state)).toBeNull()
    expect(g.state.flags).toMatchObject({ s1: true, stop2: true })
    expect(g.state.flags.s3).toBeUndefined()
    expect(log[0]!.result).toMatchObject({ option: 'stop', stage: 1 })
  })

  it('每一段的選項各算各的；ends 在 view 上看得出來；換段時 rng 只在有檢定時才往前', () => {
    const g = make({ events: [three] })
    open(g, 'ev_three')
    expect(view(g).options.map((o) => [o.id, o.ends])).toEqual([['go', false], ['stop', true]])
    pick(g, 'go')
    pick(g, 'go')
    expect(view(g).options.map((o) => [o.id, o.ends])).toEqual([['go', true], ['stop', true]]) // 最後一段什麼都會結束
    expect(g.state.rng.cursor).toBe(0)
  })

  it('單段的事件寫 options，選項沒有 id 時依序叫 o1、o2；每一段的 id 要在那一段裡不重複', () => {
    const g = make({ events: [ev('ev_x', { text: '甲乙。', options: [{ text: '甲。', outcomes: { any: [] } }, { text: '乙。' }] })] })
    open(g, 'ev_x')
    expect(ids(g)).toEqual(['o1', 'o2'])
    expect(() => make({ events: [ev('ev_x', { text: '甲乙。', options: [opt('a', '甲。'), opt('a', '乙。')] })] })).toThrow(/重複/)
  })
})

// ---- 版本與 inherit ----

describe('分版本與 inherit', () => {
  const versioned = ev('ev_ver', {
    versions: {
      default: { text: '預設版的開頭。', stages: [{ text: '預設版的第一段。', options: [opt('a', '甲。', { outcomes: { any: [flag('def_a')] } }), opt('b', '乙。', { outcomes: { any: [flag('def_b')] } })] }, { text: '預設版的第二段。', options: [opt('c', '丙。')] }] },
      masc: { text: '男性版的開頭。', stages: [{ inherit: 'default.stages.0' }, { inherit: 'default.stages.1', text: '男性版的第二段。' }] },
      yuri: { text: '百合版的開頭。', options: [opt('y', '丁。', { outcomes: { any: [flag('yuri_y')] } })] },
    },
  })

  it('inherit 的那一段選項和被繼承的一樣；version: masc 走那一版的文字；沒給 version 走 default', () => {
    const g = make({ events: [versioned] })
    open(g, 'ev_ver')
    expect(view(g).version).toBe('default')
    expect(view(g).text).toBe('預設版的開頭。\n預設版的第一段。')
    const base = view(g).options.map((o) => [o.id, o.text])
    pick(g, 'b')
    expect(view(g).text).toBe('預設版的第二段。')
    pick(g, 'c')

    const m = make({ events: [versioned] })
    open(m, 'ev_ver', { version: 'masc' })
    expect(view(m).version).toBe('masc')
    expect(view(m).text).toBe('男性版的開頭。\n預設版的第一段。') // 這一段沒寫 text，沿用被繼承的
    expect(view(m).options.map((o) => [o.id, o.text])).toEqual(base)
    pick(m, 'a')
    expect(m.state.flags.def_a).toBe(true)
    expect(view(m).text).toBe('男性版的第二段。') // 寫了 text 的換掉
    expect(view(m).options.map((o) => o.id)).toEqual(['c'])
    expect(openEventOf(m.state)!.version).toBe('masc')
  })

  it('版本可以直接寫 options；沒有的版本走 default；inherit 的 adult_scene 蓋在被繼承的選項的 adult_scene 上', () => {
    const y = make({ events: [versioned] })
    open(y, 'ev_ver', { version: 'yuri' })
    expect(ids(y)).toEqual(['y'])
    const none = make({ events: [ev('ev_d', { versions: { default: { text: '只有預設。', options: [opt('a', '甲。')] } } })] })
    open(none, 'ev_d', { version: 'yuri' })
    expect(view(none).version).toBe('default')

    const scene = (extra: Fx) => ({ when: 'always', gate: 'fixed', nature: 'forced', role: 'bound', goal: 'obey', circles: [['$pc', '$a']], ...extra })
    const withScene = ev('ev_s', {
      cast: [{ role: 'a', gen: { name: '回收員' } }, { role: 'b', gen: { name: '另一位回收員' } }],
      versions: {
        default: { text: '一般。', stages: [{ options: [opt('x', '拖延。', { adult_scene: scene({}) })] }] },
        masc: { text: '被動。', stages: [{ inherit: 'default.stages.0', adult_scene: { circles: [['$pc', '$a', '$b']], start_position: 'pos_pinned_under' } }] },
      },
    })
    const g = make({ events: [withScene], features: [sceneStub] })
    open(g, 'ev_s', { version: 'masc' })
    pick(g, 'x')
    const setup = sceneOf(g.state)!.setup
    expect(setup).toMatchObject({ nature: 'forced', role: 'bound', goal: 'obey', start_position: 'pos_pinned_under' })
    expect((setup.circles as string[][])[0]).toHaveLength(3)
  })

  it('resolveBody 解開版本與 inherit：指到不存在的段或繞圈會得到錯誤訊息', () => {
    const body = resolveBody(versioned as never, 'masc')
    expect(typeof body).toBe('object')
    expect(typeof resolveBody({ id: 'x', stages: [{ inherit: 'stages.0' }] } as never)).toBe('string')
    expect(typeof resolveBody({ id: 'x', versions: { default: { text: 't', stages: [{ inherit: 'masc.stages.0' }] } } } as never)).toBe('string')
  })
})

// ---- 內嵌事件：別的功能發起、做完交回 ----

describe('內嵌的事件：別的功能用 launch 開、做完收到 activity.end', () => {
  const inline = (o: Fx = {}): Fx => ({
    id: 'inline_ask', scope: 'street', text: '雇主問你要不要升階。',
    options: [opt('yes', '好。', { outcomes: { any: [cash(10)] }, flags: ['promoted'] }), opt('no', '不要。')],
    ...o,
  })

  it('origin 原樣回來，result.option 是選的那一個；發起的人回傳的 changes 與 lines 併進結束的那一份報告', () => {
    const log: Heard[] = []
    const g = make({ features: [caller(log)] })
    const reports = g.launch('event', { inline: inline() }, { by: 'caller', ref: 'job7', ext: { stage: 2, nested: { a: [1] } } })
    expect(reports[0]!.action).toBe('event.open')
    expect(openEventOf(g.state)).toMatchObject({ event: 'inline_ask', origin: { by: 'caller', ref: 'job7' } })
    expect(view(g).options.map((o) => o.id)).toEqual(['yes', 'no'])
    const done = pick(g, 'yes')
    expect(log).toHaveLength(1)
    expect(log[0]!.origin).toEqual({ by: 'caller', ref: 'job7', ext: { stage: 2, nested: { a: [1] } } })
    expect(log[0]!.result).toEqual({ event: 'inline_ask', option: 'yes', flags: ['promoted'], stage: 0, version: 'default' })
    expect(log[0]!.kind).toBe('event')
    expect(log[0]!.outcome).toBe('done')
    expect(g.state.money.cash).toBe(110)
    expect(g.state.flags.heard_yes).toBe(true)
    expect(done[0]!.narration!.results).toEqual(['拿到：現金 10', '發起的人收到了結果'])
    expect(done[0]!.outcome.summary).toContain('發起的人收到了結果')
  })

  it('檢定的結果在 result.degree；沒有檢定就沒有 degree', () => {
    const log: Heard[] = []
    const g = make({ seed: ROLL.seed, features: [caller(log)] })
    g.launch('event', { inline: inline({ options: [opt('o1', '擲。', { check: ['negotiate', 'charm', DC_FOR.success] })] }) }, { by: 'caller' })
    pick(g, 'o1')
    expect(log[0]!.result.degree).toBe('success')
    expect(log[0]!.outcome).toBe('success')
    const h = make({ features: [caller(log)] })
    h.launch('event', { inline: inline() }, { by: 'caller' })
    pick(h, 'no')
    expect(log[1]!.result).not.toHaveProperty('degree')
  })

  it('報告的 launch 也開得起來；只有 origin.by 對得上的功能收到（別人的不收）', () => {
    const log: Heard[] = []
    const g = make({ features: [caller(log)] })
    const draft: ReportDraft = { ...walk(), action: 'test.walk', launch: [{ kind: 'event', setup: { inline: inline() }, origin: { by: 'someone_else' } } as Launch] }
    g.commit(draft)
    expect(openEventOf(g.state)).not.toBeNull()
    pick(g, 'no')
    expect(log).toHaveLength(0)
  })

  it('內嵌的事件照同一套格式檢查：不合格就開不成，原因寫出是哪裡；開不成整步不成立', () => {
    const g = make({ features: [] })
    const bad = (e: Fx) => () => g.launch('event', { inline: e }, { by: 'caller' })
    expect(bad(inline({ options: [] }))).toThrow(/選項/)
    expect(bad(inline({ options: [opt('a', '甲。', { outcomes: { any: [{ kind: 'teleport' }] } })] }))).toThrow(/不在封閉清單/)
    expect(bad(inline({ options: [opt('a', '甲。', { outcomes: { great: [] } })] }))).toThrow(/outcomes/)
    expect(bad(inline({ id: undefined }))).toThrow(/id/)
    expect(bad(inline({ text: undefined }))).toThrow(ActionBlocked)
    expect(bad(inline({ options: [opt('a', '甲。', { outcomes: { any: [{ kind: 'chain', event: 'nope' }] } })] }))).toThrow(/查不到/)
    const draft: ReportDraft = { ...walk(), launch: [{ kind: 'event', setup: { inline: inline({ options: [] }) } }] }
    const before = JSON.stringify(g.state)
    expect(() => g.commit(draft)).toThrow(ActionBlocked)
    expect(JSON.stringify(g.state)).toBe(before)
  })

  it('內嵌的整筆事件存在狀態裡：存檔再讀，選項與結果不變', () => {
    const log: Heard[] = []
    const g = make({ features: [caller(log)] })
    g.launch('event', { inline: inline() }, { by: 'caller', ref: 'k1' })
    const raw = g.save()
    const h = make({ features: [caller(log)] })
    expect(h.load(raw)).toBeNull()
    expect(view(h)).toEqual(view(g))
    pick(h, 'yes')
    expect(log.at(-1)!.origin).toMatchObject({ by: 'caller', ref: 'k1' })
    expect(h.state.money.cash).toBe(110)
  })
})

// ---- 指示：fight、chain ----

describe('結果裡的指示', () => {
  const fightEvent = (): Fx => ev('ev_fight', { text: '對面不肯讓路。', options: [opt('fight', '動手。', { outcomes: { any: [flag('fought'), { kind: 'fight', foes: BATTLE_SETUPS.encounter().foes, cover: 'sparse', faction: 'f_alpha' }] } }), opt('leave', '走開。')] })

  it('fight：收尾之後戰鬥開起來，origin.ext.by 是 director；效果照樣結算；發起的人也收到結果', () => {
    const log: Heard[] = []
    const g = make({ events: [fightEvent()], features: [caller(log)] })
    open(g, 'ev_fight')
    const reports = pick(g, 'fight')
    expect(reports.map((r) => r.action)).toEqual(['event.close', 'battle.start'])
    expect(reports[0]!.launch).toHaveLength(1)
    expect(g.state.battle).toBeTruthy()
    expect(g.state.battle!.origin.ext).toMatchObject({ by: 'director', ref: 'ev_fight', event: 'ev_fight' })
    expect(g.state.battle!.origin.faction).toBe('f_alpha')
    expect(g.state.battle!.units.a1!.actor).toBe('pc')
    expect(g.state.flags.fought).toBe(true)
    expect(openEventOf(g.state)).toBeNull()
    expect(log).toHaveLength(1)
  })

  it('fight 在還有下一段的選項上也會收尾（同一時間只有一段活動）', () => {
    const e = ev('ev_two', { text: '兩段。', stages: [{ text: '第一段。', options: [opt('fight', '動手。', { outcomes: { any: [{ kind: 'fight', foes: BATTLE_SETUPS.encounter().foes }] } })] }, { text: '第二段。', options: [opt('x', '不會到。')] }] })
    const g = make({ events: [e] })
    open(g, 'ev_two')
    pick(g, 'fight')
    expect(openEventOf(g.state)).toBeNull()
    expect(g.state.battle).toBeTruthy()
  })

  it('chain：帶出第二件，origin 是 director；第二件收尾之後事件視窗就空了', () => {
    const first = ev('ev_one', { text: '第一件。', options: [opt('next', '繼續。', { outcomes: { any: [flag('one_done'), { kind: 'chain', event: 'ev_two' }] } })] })
    const second = ev('ev_two', { text: '第二件。', options: [opt('end', '結束。', { outcomes: { any: [flag('two_done')] } })] })
    const g = make({ events: [first, second] })
    open(g, 'ev_one')
    const r = pick(g, 'next')
    expect(r.map((x) => x.action)).toEqual(['event.close', 'event.open'])
    expect(g.state.flags.one_done).toBe(true)
    const o = openEventOf(g.state)!
    expect(o).toMatchObject({ event: 'ev_two', chained: true, origin: { by: 'director', ref: 'ev_one' } })
    expect(o.origin.ext).toMatchObject({ chain: true, caller: 'caller', event: 'ev_one' })
    expect(view(g).text).toBe('第二件。')
    pick(g, 'end')
    expect(g.state.flags.two_done).toBe(true)
    expect(openEventOf(g.state)).toBeNull()
  })

  it('第二件再寫 chain 在載入時被擋；chain 指到不存在的事件、指示寫了別的種類、指示與 adult_scene 同一個選項也擋', () => {
    const chainTo = (id: string, target: string): Fx => ev(id, { text: '甲。', options: [opt('n', '下一件。', { outcomes: { any: [{ kind: 'chain', event: target }] } })] })
    expect(() => make({ events: [chainTo('ev_one', 'ev_two'), chainTo('ev_two', 'ev_three'), ev('ev_three', { text: '丙。', options: [opt('a', '好。')] })] })).toThrow(/只能連一層/)
    expect(() => make({ events: [chainTo('ev_one', 'ev_gone')] })).toThrow(/ev_gone 查不到/)
    expect(() => make({ events: [ev('ev_x', { text: '甲。', options: [opt('a', '好。', { outcomes: { any: [{ kind: 'summon', foes: [] }] } })] })] })).toThrow(/不在封閉清單/)
    expect(() => make({ events: [ev('ev_x', { text: '甲。', options: [opt('a', '好。', { outcomes: { any: [{ kind: 'fight', foes: [] }] } })] })] })).toThrow(/foes/)
    expect(() => make({ events: [ev('ev_x', { text: '甲。', options: [opt('a', '好。', { adult_scene: { when: 'always', circles: [['$pc']] }, outcomes: { any: [{ kind: 'fight', foes: BATTLE_SETUPS.encounter().foes }] } })] })] })).toThrow(/同一個選項/)
    // 一組結果裡兩個指示也擋
    expect(() => make({ events: [ev('ev_x', { text: '甲。', options: [opt('a', '好。', { outcomes: { any: [{ kind: 'fight', foes: BATTLE_SETUPS.encounter().foes }, { kind: 'chain', event: 'ev_y' }] } })] }), ev('ev_y', { text: '乙。', options: [opt('a', '好。')] })] })).toThrow(/最多一個/)
    // 一層是合法的
    expect(() => make({ events: [chainTo('ev_one', 'ev_two'), ev('ev_two', { text: '乙。', options: [opt('a', '好。')] })] })).not.toThrow()
  })
})

// ---- adult_scene ----

describe('adult_scene', () => {
  const scene = (when: string): Fx => ({ when, gate: 'fixed', nature: 'work', role: 'worker', goal: 'please', circles: [['$pc', '$a']], start_position: 'pos_x' })
  const sceneEvent = (when: string, dc: number | string = 13): Fx => ev('ev_scene', {
    text: '包廂的門口。', cast: [{ role: 'a', gen: { kind: 'citizen', name: '熟客' } }],
    options: [opt('o1', '進去陪他。', { check: ['negotiate', 'charm', dc], outcomes: { success: [cash(40)], fail: [cash(5)] }, adult_scene: scene(when) }), opt('no', '不去。')],
  }, { adult: true })

  it('沒有人登記 scene 時不開、不丟錯（照樣收尾，效果照結算）', () => {
    const g = make({ seed: ROLL.seed, events: [sceneEvent('always', DC_FOR.success)] })
    open(g, 'ev_scene')
    const r = pick(g, 'o1')
    expect(r.map((x) => x.action)).toEqual(['event.close'])
    expect(r[0]!.launch).toBeUndefined()
    expect(g.state.money.cash).toBe(140)
    expect(openEventOf(g.state)).toBeNull()
  })

  it('用替身登記之後：when: success 只在成功時開；setup 帶著性質、身分、目的與登場角色（$pc、$a 換成 id）', () => {
    const ok = make({ seed: ROLL.seed, events: [sceneEvent('success', DC_FOR.success)], features: [sceneStub] })
    open(ok, 'ev_scene')
    const a = openEventOf(ok.state)!.cast.a!
    const r = pick(ok, 'o1')
    expect(r.map((x) => x.action)).toEqual(['event.close', 'scene.start'])
    expect(r[0]!.adult).toBe(true)
    const s = sceneOf(ok.state)!
    expect(s.setup).toMatchObject({ when: 'success', gate: 'fixed', nature: 'work', role: 'worker', goal: 'please', start_position: 'pos_x' })
    expect(s.setup.circles).toEqual([['pc', a]])
    expect(ok.state.actors[a]!.name).toBe('熟客')
    expect(s.origin).toMatchObject({ by: 'director', ref: 'ev_scene' })
    expect(ok.state.money.cash).toBe(140)

    const bad = make({ seed: ROLL.seed, events: [sceneEvent('success', DC_FOR.fail)], features: [sceneStub] })
    open(bad, 'ev_scene')
    pick(bad, 'o1')
    expect(sceneOf(bad.state)).toBeUndefined()
    expect(bad.state.money.cash).toBe(105)
  })

  it('when: fail 只在失敗（含大失敗）時開；always 都開；大成功算成功', () => {
    const run = (when: string, dc: number): boolean => {
      const g = make({ seed: ROLL.seed, events: [sceneEvent(when, dc)], features: [sceneStub] })
      open(g, 'ev_scene')
      pick(g, 'o1')
      return sceneOf(g.state) !== undefined
    }
    expect([DC_FOR.critical, DC_FOR.success, DC_FOR.fail, DC_FOR.fumble].map((dc) => run('fail', dc))).toEqual([false, false, true, true])
    expect([DC_FOR.critical, DC_FOR.success, DC_FOR.fail, DC_FOR.fumble].map((dc) => run('success', dc))).toEqual([true, true, false, false])
    expect([DC_FOR.critical, DC_FOR.fail, DC_FOR.fumble].map((dc) => run('always', dc))).toEqual([true, true, true])
  })

  it('沒有檢定的選項：always 與 success 開，fail 不開', () => {
    const e = (when: string) => ev('ev_s', { text: '甲。', options: [opt('go', '進去。', { adult_scene: scene(when) })] })
    const run = (when: string) => {
      const g = make({ events: [e(when)], features: [sceneStub] })
      open(g, 'ev_s')
      pick(g, 'go')
      return sceneOf(g.state) !== undefined
    }
    expect([run('always'), run('success'), run('fail')]).toEqual([true, true, false])
  })
})

// ---- 登場角色 ----

describe('登場角色', () => {
  const castEvent = (cast: Fx[], effects: Fx[] = []): Fx => ev('ev_cast', { text: '有人在等你。', cast, options: [opt('talk', '搭話。', { outcomes: { any: effects } })] })

  it('開的時候對每個 cast 問 director.cast；有人答就用答的人（先套他的變更）；效果裡的 $a、$pc 換成 id', () => {
    const g = make({ events: [castEvent([{ role: 'a', npc: 'npc_ann' }], [{ kind: 'affinity', key: '$a', amount: 5 }, { kind: 'flag', key: '$pc', value: true }])], features: [castStub] })
    const r = open(g, 'ev_cast')
    expect(r[0]!.changes.map((c) => c.op)).toEqual(['uid', 'actor.add', 'ext'])
    expect(openEventOf(g.state)!.cast).toEqual({ a: 'npc_ann' })
    expect(view(g).cast).toEqual([{ role: 'a', actor: 'npc_ann', name: '安' }])
    pick(g, 'talk')
    expect(meterOf(g.k, g.state, 'affinity', 'npc_ann')).toBe(5)
    expect(g.state.flags.pc).toBe(true)
  })

  it('沒有人答的角色用一個只有名字的臨時角色；名字來自 gen.name，沒寫叫路人；每位角色一個', () => {
    const g = make({ events: [castEvent([{ role: 'a', gen: { kind: 'citizen', name: '無名的路人' } }, { role: 'b', gen: { kind: 'citizen' } }], [{ kind: 'affinity', key: '$a', amount: 3 }, { kind: 'affinity', key: '$b', amount: -2 }])] })
    open(g, 'ev_cast')
    const cast = openEventOf(g.state)!.cast
    expect(Object.keys(cast)).toEqual(['a', 'b'])
    expect(g.state.actors[cast.a!]).toMatchObject({ name: '無名的路人', role: 'npc', ext: { event_temp: true } })
    expect(g.state.actors[cast.b!]!.name).toBe('路人')
    expect(cast.a).not.toBe(cast.b)
    pick(g, 'talk')
    expect(meterOf(g.k, g.state, 'affinity', cast.a)).toBe(3)
    expect(meterOf(g.k, g.state, 'affinity', cast.b)).toBe(-2)
  })

  it('cast 最多 2 位、代號不能重複也不能叫 pc、npc 與 gen 不能同時寫', () => {
    const three = [{ role: 'a' }, { role: 'b' }, { role: 'c' }]
    for (const cast of [three, [{ role: 'a' }, { role: 'a' }], [{ role: 'pc' }], [{ role: 'a', npc: 'npc_ann', gen: {} }]]) {
      expect(() => make({ events: [castEvent(cast)] })).toThrow(ContentError)
    }
  })
})

// ---- 自由回應 ----

describe('自由回應', () => {
  it('事件開著時做一次自由行動，之後事件收掉、result.option 是 free；那一份自由行動不被擋', async () => {
    const log: Heard[] = []
    const g = make({ features: [caller(log)] })
    open(g, 'ev_roll')
    expect(view(g).free).toBe(true)
    const r = await g.act({ kind: 'free', text: '我不管他，直接繞過去。' }, { autoRules: true })
    expect(r.status).toBe('applied')
    expect(openEventOf(g.state)).toBeNull()
    expect(g.k.activity.active(g.state)).toEqual([])
    expect(log).toHaveLength(1)
    expect(log[0]!.result).toMatchObject({ event: 'ev_roll', option: 'free', flags: [], stage: 0 })
    expect(['critical', 'success', 'fail', 'fumble']).toContain(log[0]!.result.degree)
    const last = g.state.reports.at(-1)!
    expect(last.action).toBe('event.close')
    expect(g.state.flags.heard_free).toBe(true)
    // 之後不擋
    g.commit(walk())
  })

  it('別的活動進行中時自由行動不會誤收掉事件；寫正文的鏈（narrated）也不算自由回應', async () => {
    const g = make()
    open(g, 'ev_roll')
    const r = await g.commitNarrated(chooseOption(g.k, g.state, 'o2'), { mode: 'new' })
    expect(r.status).toBe('applied')
    expect(openEventOf(g.state)).toBeNull()
    expect(g.state.reports.filter((x) => x.action === 'event.close')).toHaveLength(1)
    expect(g.state.flags.walked_away).toBe(true)
  })
})

// ---- 存檔、重播、回退 ----

describe('存檔與重播', () => {
  it('開著事件存檔再讀，選項與結果不變（多段的中途也一樣）', () => {
    const e = ev('ev_two', { text: '兩段。', stages: [{ text: '第一段。', options: [opt('go', '繼續。', { outcomes: { any: [flag('s1')] } })] }, { text: '第二段。', options: [rollOption(13)] }] })
    const g = make({ events: [e] })
    open(g, 'ev_two')
    pick(g, 'go')
    const raw = g.save()
    const h = make({ events: [e] })
    expect(h.load(raw)).toBeNull()
    expect(view(h)).toEqual(view(g))
    expect(chooseOption(h.k, h.state, 'o1')).toEqual(chooseOption(g.k, g.state, 'o1'))
    const a = pick(g, 'o1'), b = pick(h, 'o1')
    expect(JSON.stringify(a.map((r) => r.changes))).toBe(JSON.stringify(b.map((r) => r.changes)))
    expect(h.state.money).toEqual(g.state.money)
  })

  it('同一個種子、同樣的選擇：結果一樣；回退之後再選一次，骰面一樣', () => {
    const play = (seed: number) => {
      const g = make({ seed })
      open(g, 'ev_roll')
      pick(g, 'o1')
      return JSON.stringify([g.state.money, hostilityOf(g), g.state.rng])
    }
    expect(play(9)).toBe(play(9))
    const g = make({ seed: 9 })
    open(g, 'ev_roll')
    const first = rollOf(chooseOption(g.k, g.state, 'o1'))!.natural
    pick(g, 'o1')
    expect(g.undoSteps(1)).toBe(true)
    expect(openEventOf(g.state)).not.toBeNull()
    expect(rollOf(chooseOption(g.k, g.state, 'o1'))!.natural).toBe(first)
  })

  it('報告的紀錄不變式成立（開、選、收尾）', async () => {
    const g = make({ seed: ROLL.seed, events: [rollEvent(DC_FOR.fumble)] })
    const { violations } = await observed(g, () => {
      open(g, 'ev_roll')
      pick(g, 'o1')
    })
    expect(violations).toEqual([])
  })
})

// ---- 內容檢查 ----

describe('內容載入：事件內文的格式', () => {
  const bad = (body: Fx, o: Fx = {}) => () => make({ events: [ev('ev_bad', body, o)] })

  it('效果的種類要有人註冊、效果的格式要對、引用要查得到', () => {
    expect(bad({ text: '甲。', options: [opt('a', '甲。', { outcomes: { any: [{ kind: 'teleport' }] } })] })).toThrow(/不在封閉清單/)
    expect(bad({ text: '甲。', options: [opt('a', '甲。', { outcomes: { any: [{ kind: 'cash', amount: 1.5 }] } })] })).toThrow(/amount/)
    expect(bad({ text: '甲。', options: [opt('a', '甲。', { outcomes: { any: [{ kind: 'hostility', key: 'f_nobody', amount: 1 }] } })] })).toThrow(ContentError)
    // 陣列寫法的效果不收（0016 第四節）
    expect(bad({ text: '甲。', options: [opt('a', '甲。', { outcomes: { any: [['cash', 300]] } })] })).toThrow(/物件/)
  })

  it('版本至少有 default；inherit 要指得到；版本的名字只有 default、masc、yuri', () => {
    expect(bad({ versions: { masc: { text: '甲。', options: [opt('a', '甲。')] } } })).toThrow(/default/)
    expect(bad({ versions: { default: { text: '甲。', stages: [{ inherit: 'default.stages.4' }] } } })).toThrow(/inherit|stages/)
    expect(bad({ versions: { default: { text: '甲。', stages: [{ inherit: 'masc.stages.0' }] } } })).toThrow(/不存在/)
    expect(bad({ versions: { default: { text: '甲。', options: [opt('a', '甲。')] }, fem: { text: '乙。', options: [opt('a', '乙。')] } } })).toThrow(/fem/)
    expect(bad({ versions: { default: { text: '甲。', stages: [{ inherit: 'default.stages.0' }] } } })).toThrow(/繞回了自己/)
  })

  it('選項最多 4 個、檢定的格式、need 的條件、outcomes 的鍵、內文只能寫一種', () => {
    const five = [1, 2, 3, 4, 5].map((n) => opt(`o${n}`, `第 ${n} 個。`))
    expect(bad({ text: '甲。', options: five })).toThrow(/最多 4/)
    expect(bad({ text: '甲。', options: [opt('a', '甲。', { check: ['negotiate', 'strength', 13] })] })).toThrow(/屬性/)
    expect(bad({ text: '甲。', options: [opt('a', '甲。', { check: ['negotiate', 'charm', 'brutal'] })] })).toThrow(/check/)
    expect(bad({ text: '甲。', options: [opt('a', '甲。', { need: { kind: 'no_such_condition' } })] })).toThrow(/條件/)
    expect(bad({ text: '甲。', options: [opt('a', '甲。', { outcomes: { critical: [] } })] })).toThrow(/any/)
    expect(bad({ text: '甲。', options: [opt('a', '甲。')], stages: [] })).toThrow(/剛好/)
    expect(bad({ options: [opt('a', '甲。')] })).toThrow(/text/)
    expect(bad({ text: '甲。', options: [opt('a', '甲。', { adult_scene: { when: 'maybe', circles: [['$pc']] } })] })).toThrow(/when/)
    expect(bad({ text: '甲。', options: [opt('a', '甲。', { flags: 'x' })] })).toThrow(/flags/)
  })

  it('合格的事件載得進來；通知（blocking: false）的內文由導演檢查，這裡不看', () => {
    expect(() => make({ events: [rollEvent(13), ev('ev_note', { text: '一則通知。' }, { blocking: false })] })).not.toThrow()
  })
})

// ---- fallback：用到的標籤被關掉 ----

describe('fallback', () => {
  const tagged = ev('ev_dark', { text: '黑暗的版本。', options: [opt('a', '甲。')], fallback: 'ev_plain' }, { tags: ['pc_unwilling'] })
  const plain = ev('ev_plain', { text: '溫和的版本。', options: [opt('a', '甲。')] })

  it('標籤開著走本身；被關掉時改走 fallback 指的那一件；沒有 fallback 就開不成', () => {
    const on = make({ events: [tagged, plain] })
    open(on, 'ev_dark')
    expect(openEventOf(on.state)!.event).toBe('ev_dark')
    const off = make({ events: [tagged, plain], patch: { rules: { contentOff: ['pc_unwilling'] } } as never })
    open(off, 'ev_dark')
    expect(openEventOf(off.state)!.event).toBe('ev_plain')
    expect(view(off).text).toBe('溫和的版本。')
    const none = make({ events: [{ ...tagged, fallback: undefined }, plain], patch: { rules: { contentOff: ['pc_unwilling'] } } as never })
    expect(() => open(none, 'ev_dark')).toThrow(/被關掉的內容標籤/)
    expect(none.k.activity.active(none.state)).toEqual([])
  })
})

// ---- 導演的接縫 ----

describe('導演放行擋住型的事件：開事件視窗，導演自己的狀態不被蓋掉', () => {
  const step = (g: G) => g.commit({ kind: 'action', action: 'test.step', location: { district: 'test', block: 'empty_room' }, party: [], timeline: [], changes: [{ op: 'time', minutes: 5 }], triggers: [{ point: 'enter_block' }], outcome: { result: 'ok', summary: 'step' } })

  it('觸發點之後事件視窗開起來（origin 是導演、帶範圍與觸發點）；冷卻與上次的日子都記著；選完之後導演的紀錄還在', () => {
    const g = make({ content: { event_scope: [{ ...SCOPES[0], cooldown_hours: 2 }] } })
    const rs = step(g)
    expect(rs.map((r) => r.action)).toEqual(['test.step', 'event.open'])
    const o = openEventOf(g.state)!
    expect(o).toMatchObject({ event: 'ev_roll', origin: { by: 'director', ext: { scope: 'street', trigger: 'enter_block' } } })
    const d = directorOf(g.state)
    expect(d.seen.ev_roll).toBe(3)
    expect(d.scopes.street!.count).toBe(1)
    expect(d.city).toEqual({ day: 3, blocking: 1 })
    expect(d.open).toBeDefined()
    pick(g, 'o2')
    const after = directorOf(g.state)
    expect(after.open).toBeUndefined()
    expect(after.seen.ev_roll).toBe(3)
    expect(after.scopes.street!.count).toBe(1)
    expect(after.scopes.street!.until).toBe(d.scopes.street!.until)
    expect(g.state.flags.walked_away).toBe(true)
  })

  it('事件開著時走路（會帶觸發點）的報告被擋，所以導演不會再放行第二件；選完之後又可以放行', () => {
    const second = ev('ev_two', { text: '第二件。', options: [opt('a', '好。')] }, { weight: 0.0001 })
    const g = make({ events: [rollEvent(13), second] })
    step(g)
    const firstId = openEventOf(g.state)!.event
    expect(() => step(g)).toThrow(ActionBlocked)
    pick(g, firstId === 'ev_roll' ? 'o2' : 'a')
    expect(openEventOf(g.state)).toBeNull()
    step(g)
    expect(openEventOf(g.state)).not.toBeNull()
  })
})

// ---- 真實的俘虜事件（features/enemies/capture.ts 的 treatEvent、pickEvent） ----

describe('真實的俘虜處置事件：DC 是數字', () => {
  const cand = (o: Partial<CaptureCandidate> = {}): CaptureCandidate => ({ unit: 'f1', enemy: 'e_guard', name: '受俘的保全', rank: 'minion', grade: 2, faction: 'f_alpha', adult: [], pct: 40, roll: 10, ...o })
  const makeCapture = (o: Opts = {}, withScene = true) => make({ features: [caller([]), ...(withScene ? [sceneStub] : [])], events: [], pc: { attrs: { resolve: 14, charm: 12 }, skills: { intimidate: 2, negotiate: 1 } }, ...o })
  const launchTreat = (g: G, c = cand()) => {
    const event = treatEvent(g.k, g.state, c, {})
    g.launch('event', { inline: event }, { by: 'enemies', ref: 'b1', ext: { step: 'treat' } })
    return event
  }

  it('整件事件過內嵌的格式檢查：帶走、問話、交出去、放走四個選項；問話的 DC 是 10 ＋ 等級 × 2（數字）', () => {
    const g = makeCapture()
    const event = launchTreat(g)
    expect(event.id).toBe('capture_treat')
    expect(ids(g)).toEqual(['take', 'ask', 'handover', 'release'])
    const ask = view(g).options.find((o) => o.id === 'ask')!.check!
    expect(ask).toMatchObject({ dc: 14, roller: 'pc' })
    expect(ask.tier).toBeUndefined()
    expect(['intimidate', 'negotiate']).toContain(ask.skill)
    // 首領、等級 V：10 + 10 + 4
    const boss = makeCapture()
    launchTreat(boss, cand({ rank: 'boss', grade: 5 }))
    expect(view(boss).options.find((o) => o.id === 'ask')!.check!.dc).toBe(24)
    // 沒有人登記 scene 時不列「帶走」
    const noScene = makeCapture({}, false)
    launchTreat(noScene)
    expect(ids(noScene)).toEqual(['ask', 'handover', 'release'])
  })

  it('問話：成功程度不同結果不同（旗標、敵對值 +1）；結果交回 origin.by 是 enemies 的人', () => {
    const seen = new Set<string>()
    for (let seed = 1; seed < 80 && seen.size < 3; seed++) {
      const g = makeCapture({ seed })
      launchTreat(g)
      const d = chooseOption(g.k, g.state, 'ask')
      const degree = rollOf(d)!.degree
      pick(g, 'ask')
      seen.add(degree)
      expect(hostilityOf(g)).toBe(1)
      const info = g.state.flags['capture:info:f_alpha'] === true
      const credential = g.state.flags['capture:credential:f_alpha'] === true
      expect([info, credential]).toEqual(degree === 'critical' ? [true, true] : degree === 'success' ? [true, false] : degree === 'fail' ? [false, false] : [false, false])
      expect(openEventOf(g.state)).toBeNull()
    }
    expect(seen.size).toBeGreaterThanOrEqual(2)
  })

  it('交出去：敵對值 +2；放走：什麼都不加；帶走：敵對值 +1 並開成人場景（captive、登場角色是那個人）', () => {
    const hand = makeCapture()
    launchTreat(hand)
    pick(hand, 'handover')
    expect(hostilityOf(hand)).toBe(2)
    const free = makeCapture()
    launchTreat(free)
    pick(free, 'release')
    expect(hostilityOf(free)).toBe(0)
    const take = makeCapture()
    launchTreat(take)
    const a = openEventOf(take.state)!.cast.a!
    expect(take.state.actors[a]).toMatchObject({ name: '受俘的保全', role: 'npc' })
    const r = pick(take, 'take')
    expect(r.map((x) => x.action)).toEqual(['event.close', 'scene.start'])
    expect(hostilityOf(take)).toBe(1)
    expect(sceneOf(take.state)!.setup).toMatchObject({ when: 'always', gate: 'fixed', nature: 'captive', role: 'none', goal: 'none', circles: [['pc', a]] })
  })

  it('「挑一個」的事件（pickEvent）也收得進來：選項 id 是 pick:<單位>', () => {
    const g = makeCapture()
    g.launch('event', { inline: pickEvent([cand(), cand({ unit: 'f2', name: '另一個人', rank: 'elite' })]) }, { by: 'enemies', ref: 'b1', ext: { step: 'pick' } })
    expect(ids(g)).toEqual(['pick:f1', 'pick:f2'])
    pick(g, 'pick:f2')
    expect(openEventOf(g.state)).toBeNull()
  })
})
