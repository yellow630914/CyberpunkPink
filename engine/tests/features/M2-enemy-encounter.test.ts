// 驗收測試：dev/work/M2-enemy-encounter.md（cpp-feature）。照勢力與位階挑兵種（enemy_pick）、附屬單位的覆寫（attached）、打贏之後的俘虜。
// 規格：ENEMIES 1.6 節（各勢力出現在哪幾級）、第 10 節（跟著主人）、第 13 節、6.1 節（俘虜）；dev/adr/0013 D5、0016 第四、五節與 G13。
// 內容一律是測試自帶的最小假資料，不讀 engine/data。
// 俘虜的處置是事件視窗（M2-event-run，還沒有）：這裡用測試自己定義的替身活動 event（只收 { inline }，選項怎麼結算照
// dev/work/M2-event-run.md 的格式：outcomes 的四級與 any、效果經 k.effects），驗「戰鬥結束那一份帶什麼 launch、事件做完之後交回什麼」。
// 量表效果（hostility、favor）與 scout_reveal 也是測試自己登記的替身（security、fixer 還沒有）。

import { describe, expect, it } from 'vitest'
import type { ContentPack, Feature, GameState, Launch, Report, ReportDraft } from '../../src'
import { ActionBlocked, BattleRun, LOSE_TURN, attachActivityEnd, clone, deriveRng, endActivity } from '../../src'
import type { CaptureState } from '../../src/features/enemies'
import {
  ASK_DC, CAPTURE_BASE, CAPTURE_EXT, askDc, captureCause, captureChance, captureKindOk, captureOf, enemiesFeature, pickCandidates, pickEnemy, pickProblems, rollCaptures,
} from '../../src/features/enemies'
import type { Game } from '../../src'
import { chooseOption, directorFeature, eventRunFeature, eventView } from '../../src/features/director'
import { fixerFeature } from '../../src/features/fixer'
import { BATTLE_SETUPS, TEST_COMBAT, makeBattleGame, makeGame, observed, stateHash } from '../../src/testkit'

type Rec = Record<string, unknown>
type Entry = Rec & { id: string }
const isRec = (v: unknown): v is Rec => typeof v === 'object' && v !== null && !Array.isArray(v)

// ===================================================================================================================
// 假資料
// ===================================================================================================================

const SKILLS = [
  { id: 'firearms', attr: 'reflex' }, { id: 'brawl', attr: 'body' }, { id: 'composure', attr: 'resolve' },
  { id: 'intimidate', attr: 'resolve' }, { id: 'negotiate', attr: 'charm' }, { id: 'seduce', attr: 'charm' },
].map((s) => ({ ...s, name: s.id, desc: `${s.id}。` }))
const WEAPONS = [{ id: 'pistol', name: '手槍', dice: 3, type: 'physical', range: [1, 4], mag: 2, cover_mult: 0.25, pierce: 0, traits: [], attr: 'reflex', skill: 'firearms' }]
const FACTIONS = ['hizakura', 'kunlun', 'starbelle', 'blackspring'].map((id) => ({ id, name: id, short: id, class: 'corp' }))
const enemy = (id: string, rank: string, more: Rec = {}): Entry => ({
  id, name: `測試${id}`, desc: '測試用的敵人。', faction: 'hizakura', rank, grades: [1, 5], kind: 'human',
  position: { prefer: [1, 2], cover_use: 0.5 }, mode: 'lethal', weapons: [{ class: 'pistol' }], ai: { prefer: 'weakest', focus: 1, flee_below: 0 }, ...more,
})
/** 掛在格上的一台。 */
const drone = (id: string, kind = 'attack', more: Rec = {}): Entry =>
  enemy(id, 'minion', { name: `${id}號機`, kind: 'machine', position: { prefer: [2, 3], size: 'overlay' }, overlay: { kind }, mods: { hp: 0.5 }, ...more })

const ENEMIES: Entry[] = [
  // enemy_pick：緋櫻的雜兵三種（一種等級範圍窄）、精英、首領；具名與掛在格上的不會被挑
  enemy('en_p_mook_a', 'minion', { grades: [1, 3] }),
  enemy('en_p_mook_b', 'minion', { grades: [1, 3] }),
  enemy('en_p_mook_c', 'minion', { grades: [2, 3] }),
  enemy('en_p_elite', 'elite', { grades: [2, 4] }),
  enemy('en_p_boss', 'boss', { grades: [4, 5] }),
  enemy('en_p_named', 'minion', { grades: [1, 3], named: true }),
  { ...drone('en_p_ovl', 'attack'), faction: 'hizakura', grades: [1, 3] },
  // 崑崙：雜兵只有兩種，等級範圍 [2,3] 與 [4,4]（找最近的一級）
  enemy('en_k_low', 'minion', { faction: 'kunlun', grades: [2, 3] }),
  enemy('en_k_high', 'minion', { faction: 'kunlun', grades: [4, 4] }),
  // 附屬單位
  drone('en_d_drone', 'attack'),
  drone('en_d_hound', 'attack'),
  enemy('en_h_master', 'elite', { faction: 'blackspring', grades: [1, 5], attached: [{ enemy: 'en_d_drone' }], position: { prefer: [3] } }),
  enemy('en_h_plain', 'minion', { faction: 'blackspring', grades: [1, 5], position: { prefer: [3] } }),
  // 俘虜
  enemy('en_c_mook', 'minion', { faction: 'starbelle', adult: ['豐滿', '支配'] }),
  enemy('en_c_mook2', 'minion', { faction: 'starbelle' }),
  enemy('en_c_elite', 'elite', { faction: 'starbelle' }),
  enemy('en_c_boss', 'boss', { faction: 'starbelle' }),
  enemy('en_c_nocap', 'minion', { faction: 'starbelle', capture: false }),
  enemy('en_c_noadult', 'minion', { faction: 'starbelle', adult: null }),
  enemy('en_c_nofaction', 'minion', { faction: 'none' }),
  enemy('en_c_bot', 'minion', { faction: 'starbelle', kind: 'machine' }),
  enemy('en_c_android', 'minion', { faction: 'starbelle', kind: 'machine', humanoid: true, adult: ['人偶'] }),
  enemy('en_c_unbridged', 'minion', { faction: 'starbelle', kind: 'unbridged' }),
]
const PACK: ContentPack = { id: 'm2_enemy_encounter', content: { skill: SKILLS, weapon_class: WEAPONS, faction: FACTIONS, enemy: ENEMIES } }

// ---- 替身：事件視窗（M2-event-run）、成人場景（M2-scene）、量表效果（M2-security）、scout_reveal（M2-fixer） ----

const FAKE_KEY = 'fake_event'
const fakeEvent = (s: Pick<GameState, 'ext'>): { id: string; event: Rec; origin: Launch['origin'] } | null => (isRec(s.ext[FAKE_KEY]) ? (s.ext[FAKE_KEY] as never) : null)

/** 只收 { inline } 的事件視窗：開起來把事件放進 state.ext.fake_event，同時只開一件；進行中放行 event.、commit:event.。 */
const FAKE_EVENT: Feature = {
  id: 'fake_event',
  install(k) {
    k.activity.define({
      kind: 'event', owner: 'fake_event', order: 30,
      active: (s) => (fakeEvent(s) ? { id: fakeEvent(s)!.id, label: '事件' } : null),
      allow: ['event.', 'commit:event.'],
      reason: () => '事件視窗開著，先回應它。',
      start(_k, state, setup, origin) {
        if (fakeEvent(state)) throw new ActionBlocked('已經有一件事件開著。')
        const inline = isRec(setup) && isRec(setup.inline) ? setup.inline : null
        if (!inline) throw new ActionBlocked('這個替身只收內嵌的事件。')
        const id = `v${state.seq.uid + 1}`
        return [{
          kind: 'event', action: 'event.open', location: clone(state.location), party: [], timeline: [],
          changes: [{ op: 'uid', advance: 1 }, { op: 'ext', key: FAKE_KEY, value: { id, event: inline, origin: clone(origin) } }],
          outcome: { result: 'open', summary: '事件開了。' },
        }]
      },
    })
  },
}
/** 成人場景的替身：只是登記這種活動（帶走的選項看有沒有人登記它）。 */
const FAKE_SCENE: Feature = {
  id: 'fake_scene',
  install(k) {
    k.activity.define({ kind: 'scene', owner: 'fake_scene', order: 20, active: () => null, allow: [], reason: () => '場景進行中。' })
  },
}
const meterKey = (kind: string, key: string) => `meter:${kind}:${key}`
/** 量表效果的替身：hostility、favor 記在旗標 meter:<kind>:<key> 裡。 */
const FAKE_METERS: Feature = {
  id: 'fake_meters',
  install(k) {
    for (const kind of ['hostility', 'favor']) {
      k.effects.register({
        kind, owner: 'fake_meters',
        validate: (raw) => (typeof raw.key === 'string' && typeof raw.amount === 'number' ? [] : ['要有 key 與 amount']),
        toChanges: (e, ctx) => [{ op: 'flag', key: meterKey(kind, e.key as string), value: Number(ctx.state.flags[meterKey(kind, e.key as string)] ?? 0) + (e.amount as number) }],
        describe: (e) => `${kind}：${e.key as string} ${e.amount as number}`,
      })
    }
  },
}
const FAKE_REVEAL: Feature = {
  id: 'fake_reveal',
  install(k) {
    k.effects.register({
      kind: 'scout_reveal', owner: 'fake_reveal', validate: () => [],
      toChanges: (e) => [{ op: 'flag', key: `revealed:${String(e.job ?? '')}`, value: true }], describe: () => '揭開一項未知',
    })
  },
}

const meter = (g: Game, kind: string, key: string): number => Number(g.state.flags[meterKey(kind, key)] ?? 0)

/** 把開著的替身事件的一個選項結算掉（照 M2-event-run 的結果規則：四級缺的往旁邊找、沒有檢定的用 any），發 activity.end，提交那一份。 */
function closeEvent(game: Game, option: string, degree?: string): Report[] {
  const ev = fakeEvent(game.state)
  if (!ev) throw new Error('現在沒有開著的事件。')
  const opt = (ev.event.options as Rec[]).find((o) => o.id === option)
  if (!opt) throw new Error(`事件裡沒有 ${option} 這個選項（有：${(ev.event.options as Rec[]).map((o) => String(o.id)).join('、')}）`)
  const outcomes = opt.outcomes as Rec
  const order: Record<string, string[]> = { critical: ['critical', 'success'], success: ['success'], fail: ['fail'], fumble: ['fumble', 'fail'] }
  const group = degree ? (order[degree] ?? []).map((d) => outcomes[d]).find((x) => x !== undefined) : outcomes.any
  const effects = (group ?? []) as Rec[]
  const res = game.k.effects.resolve(effects, { state: game.state, actor: game.state.pc!, grade: 1, source: 'builtin', clampAsked: true, content: game.k.content })
  expect(res.errors).toEqual([])
  const end = endActivity(game.k, {
    state: game.state, kind: 'event', id: ev.id, origin: ev.origin!, outcome: option,
    result: { event: ev.event.id, option, ...(degree ? { degree } : {}), flags: [] },
  })
  const draft: ReportDraft = {
    kind: 'event', action: 'event.close', location: clone(game.state.location), party: [], timeline: [],
    changes: [{ op: 'ext', key: FAKE_KEY, value: null }, ...res.changes, ...end.changes],
    outcome: { result: option, summary: ['事件結束了。', ...end.lines].join('') }, ...(end.lines.length ? { narration: { results: end.lines } } : {}),
  }
  return game.commit(attachActivityEnd(draft, end))
}

// ---- 一場戰鬥：我方對給的敵人，照 how 把每個敵人弄成對應的結局，結算 ----

type How = 'down' | 'surrender' | 'burnout' | 'fled' | 'subdue_load' | 'subdue_stun' | 'subdue_plain' | 'subdue_nolayer' | 'stand'
interface FightOpts {
  foes: Array<{ id: string; grade?: number; how: How }>
  features?: Feature[]
  seed?: number
  outcome?: string
  pc?: Rec
  /** 開打的 origin.ext（commission、employer） */
  ext?: Rec
  rules?: Rec
  /** 結算之前把 state.rng 的種子換成這個（讓每個人擲的骰面固定） */
  rngSeed?: number
  /** 內容包（預設是這個檔的 PACK） */
  content?: ContentPack[]
}
const ALL = [enemiesFeature, TEST_COMBAT, FAKE_EVENT, FAKE_SCENE, FAKE_METERS, FAKE_REVEAL]

function arrange(o: FightOpts) {
  const test = makeBattleGame({
    features: o.features ?? ALL, content: o.content ?? [PACK], seed: o.seed ?? 3, ...(o.pc ? { pc: o.pc as never } : {}), ...(o.rules ? { patch: { rules: o.rules } as never } : {}),
    battle: {
      mode: 'meat', grade: 1, cover: 'medium', allies: BATTLE_SETUPS.encounter(1).allies,
      foes: o.foes.map((f) => ({ from: 'enemy', id: f.id, ...(f.grade ? { grade: f.grade } : {}) })) as never,
      origin: { escapable: true, place: '測試用的倉庫', ...(o.ext ? { ext: o.ext } : {}) },
    },
  })
  const game = test.game
  const b = game.state.battle!
  const run = new BattleRun(game.k, game.state, b)
  const foes = Object.values(b.units).filter((u) => u.side === 'foe').sort((x, y) => x.id.localeCompare(y.id))
  foes.forEach((u, i) => {
    const how = o.foes[i]!.how
    switch (how) {
      case 'down': run.setOut(u, 'down'); break
      case 'surrender': run.setOut(u, 'surrendered'); break
      case 'burnout': run.setOut(u, 'burnout'); break
      case 'fled': run.setOut(u, 'fled'); break
      case 'subdue_load': u.layers = 1; run.applyStatus(u, LOSE_TURN, { force: true }); run.setOut(u, 'subdued'); break
      case 'subdue_stun': run.applyStatus(u, LOSE_TURN, { force: true }); run.setOut(u, 'subdued'); break
      case 'subdue_plain': run.setOut(u, 'subdued'); break
      case 'subdue_nolayer': run.applyStatus(u, LOSE_TURN, { force: true }); run.setOut(u, 'subdued'); break
      case 'stand': break
    }
  })
  b.result = { outcome: o.outcome ?? 'win', text: '打完了。' }
  if (o.rngSeed !== undefined) game.state.rng.seed = o.rngSeed
  return { game, foes: foes.map((u) => u.id) }
}

async function fight(o: FightOpts) {
  const { game, foes } = arrange(o)
  const { result, violations } = await observed(game, () => game.finishBattle())
  expect(violations).toEqual([])
  const reports = result.reports
  const end = reports.find((r) => r.action === 'battle.end') as Report
  return { game, foes, reports, end, actions: reports.map((r) => r.action), cap: captureOf(game.state), launched: fakeEvent(game.state) }
}

/** 找一個種子，讓 deriveRng({seed, cursor}, label) 的前 n 個百分骰都滿足 ok；cursor 取這一局現在的。 */
function seedWhere(game: Game, n: number, ok: (rolls: number[]) => boolean): number {
  const b = game.state.battle!
  for (let seed = 1; seed < 20000; seed++) {
    const rng = deriveRng({ seed, cursor: game.state.rng.cursor }, `capture/${b.id}`)
    const rolls = Array.from({ length: n }, () => rng.int(1, 100))
    if (ok(rolls)) return seed
  }
  throw new Error('找不到合適的種子')
}
/** 每一個符合的人都擲中（骰面都在 1～10）的種子。 */
const winSeed = (g: Game, n = 4): number => seedWhere(g, n, (r) => r.every((x) => x <= 10))

const stateOf = (g: Game): CaptureState => captureOf(g.state)!
const optionIds = (ev: { event: Rec } | null): string[] => (ev ? (ev.event.options as Rec[]).map((o) => String(o.id)) : [])
const optionOf = (ev: { event: Rec }, id: string): Rec => (ev.event.options as Rec[]).find((o) => o.id === id)!

/** 贏、制伏一個（感載滿了），種子固定成擲得中；回傳結算之後的樣子。 */
async function oneCaptive(o: Partial<FightOpts> = {}) {
  const base: FightOpts = { foes: [{ id: 'en_c_mook', how: 'subdue_load' }, { id: 'en_c_mook', how: 'down' }], ...o }
  const probe = arrange(base)
  const seed = winSeed(probe.game, 4)
  return fight({ ...base, rngSeed: seed })
}

// ===================================================================================================================

describe('enemy_pick：挑得到（ENEMIES 1.6 節、第 13 節）', () => {
  const g = () => makeGame({ features: [enemiesFeature, TEST_COMBAT], content: [PACK] }).game

  it('候選是這個勢力、這個位階、等級範圍含這一級的制式兵種：不含具名的、掛在格上的一台，也不含別的勢力與位階', () => {
    const game = g()
    expect(pickCandidates(game.k, { faction: 'hizakura', grade: 1, rank: 'minion' })).toEqual(['en_p_mook_a', 'en_p_mook_b'])
    expect(pickCandidates(game.k, { faction: 'hizakura', grade: 2, rank: 'minion' })).toEqual(['en_p_mook_a', 'en_p_mook_b', 'en_p_mook_c'])
    expect(pickCandidates(game.k, { faction: 'hizakura', grade: 3, rank: 'elite' })).toEqual(['en_p_elite'])
    expect(pickCandidates(game.k, { faction: 'kunlun', grade: 3, rank: 'minion' })).toEqual(['en_k_low'])
  })

  it('同一個 seed 永遠挑到同一個；不同的 seed 會挑到不同的（兩個候選的場合 20 個 seed 兩個都出現）', () => {
    const game = g()
    const spec = { faction: 'hizakura', grade: 1, rank: 'minion' } as const
    for (const seed of ['a', 'b', 'c1', '7']) {
      const first = pickEnemy(game.k, game.state, spec, seed)
      for (let i = 0; i < 5; i++) expect(pickEnemy(game.k, game.state, spec, seed)).toBe(first)
    }
    const seen = new Set(Array.from({ length: 20 }, (_, i) => pickEnemy(game.k, game.state, spec, `s${i}`)))
    expect([...seen].sort()).toEqual(['en_p_mook_a', 'en_p_mook_b'])
  })

  it('亂數是 deriveRng(state.rng, "enemy_pick/<seed>")、候選照 id 排好再抽', () => {
    const game = g()
    const spec = { faction: 'hizakura', grade: 2, rank: 'minion' } as const
    const ids = ['en_p_mook_a', 'en_p_mook_b', 'en_p_mook_c']
    for (const seed of ['x', 'y', 'z']) expect(pickEnemy(game.k, game.state, spec, seed)).toBe(deriveRng(game.state.rng, `enemy_pick/${seed}`).pick(ids))
  })

  it('等級範圍不含這一級時挑最近的一級（D5）：離範圍最近的那幾個兵種', () => {
    const game = g()
    // 崑崙雜兵：[2,3] 與 [4,4]。I 級離 [2,3] 差 1；V 級離 [4,4] 差 1；IV 級在 [4,4] 裡（[2,3] 差 1，不選）
    expect(pickCandidates(game.k, { faction: 'kunlun', grade: 1, rank: 'minion' })).toEqual(['en_k_low'])
    expect(pickCandidates(game.k, { faction: 'kunlun', grade: 5, rank: 'minion' })).toEqual(['en_k_high'])
    expect(pickCandidates(game.k, { faction: 'kunlun', grade: 4, rank: 'minion' })).toEqual(['en_k_high'])
    // 緋櫻的首領只有 IV～V：I 級照最近的（IV）算
    expect(pickCandidates(game.k, { faction: 'hizakura', grade: 1, rank: 'boss' })).toEqual(['en_p_boss'])
  })

  it('沒有符合的勢力、位階時錯誤訊息寫出勢力、等級、位階三個條件（pickProblems 先問；pickEnemy 與開打都丟同一句）', () => {
    const game = g()
    const spec = { faction: 'nowhere', grade: 3, rank: 'elite' } as const
    const problems = pickProblems(game.k, spec)
    expect(problems).toHaveLength(1)
    for (const word of ['nowhere', '3', '精英', 'elite']) expect(problems[0], word).toContain(word)
    expect(() => pickEnemy(game.k, game.state, spec)).toThrow(problems[0]!)
    // 勢力有、位階沒有：崑崙沒有首領
    expect(pickProblems(game.k, { faction: 'kunlun', grade: 4, rank: 'boss' })[0]).toMatch(/kunlun.*4.*首領/)
    // 挑得到的是空的
    expect(pickProblems(game.k, { faction: 'hizakura', grade: 1, rank: 'minion' })).toEqual([])
  })

  it('條件格式不對（等級不是 1～5、位階不認得、沒有勢力）也由 pickProblems 一條一句回答', () => {
    const game = g()
    const bad = pickProblems(game.k, { faction: '', grade: 9, rank: 'chief' } as never)
    expect(bad).toHaveLength(3)
    expect(bad.join('')).toMatch(/faction.*grade.*rank/)
    expect(() => pickCandidates(game.k, { faction: 'hizakura', grade: 0, rank: 'minion' })).toThrow(/grade/)
  })

  it('來源 enemy_pick：開打時挑到的兵種就是 unit.enemy；同一個 seed 同一個狀態開兩次一樣；每一個位階與勢力都對', () => {
    const open = (seed: string) => {
      const { game } = makeBattleGame({
        features: [enemiesFeature, TEST_COMBAT], content: [PACK],
        battle: {
          mode: 'meat', grade: 2, cover: 'medium', allies: BATTLE_SETUPS.encounter(1).allies,
          foes: [{ from: 'enemy_pick', faction: 'hizakura', grade: 2, rank: 'minion', seed }, { from: 'enemy_pick', faction: 'hizakura', grade: 3, rank: 'elite', seed: 'e' }] as never,
        },
      })
      return Object.values(game.state.battle!.units).filter((u) => u.side === 'foe')
    }
    const a = open('one'), b = open('one')
    expect(a.map((u) => u.enemy)).toEqual(b.map((u) => u.enemy))
    expect(['en_p_mook_a', 'en_p_mook_b', 'en_p_mook_c']).toContain(a[0]!.enemy)
    expect(a[1]!.enemy).toBe('en_p_elite')
    expect(a.map((u) => u.rank)).toEqual(['minion', 'elite'])
    expect(a[1]!.grade).toBe(3)
  })

  it('等級夾在兵種的範圍裡算數值（V 級的崑崙雜兵是 IV 級的數字）；strength、name、slot 照 enemy 的寫法帶過去', () => {
    const { game } = makeBattleGame({
      features: [enemiesFeature, TEST_COMBAT], content: [PACK],
      battle: {
        mode: 'meat', grade: 5, cover: 'medium', allies: BATTLE_SETUPS.encounter(1).allies,
        foes: [{ from: 'enemy_pick', faction: 'kunlun', grade: 5, rank: 'minion', name: '指定的名字' }, { from: 'enemy_pick', faction: 'kunlun', grade: 1, rank: 'minion', slot: 3 }] as never,
      },
    })
    const [x, y] = Object.values(game.state.battle!.units).filter((u) => u.side === 'foe')
    expect(x).toMatchObject({ enemy: 'en_k_high', grade: 4, name: '指定的名字' })
    expect(y).toMatchObject({ enemy: 'en_k_low', grade: 2 })
    expect(y!.slot).toBe(3)
  })

  it('開打時挑不到：丟錯，訊息有三個條件', () => {
    expect(() => makeBattleGame({
      features: [enemiesFeature, TEST_COMBAT], content: [PACK],
      battle: { mode: 'meat', grade: 1, allies: BATTLE_SETUPS.encounter(1).allies, foes: [{ from: 'enemy_pick', faction: 'kunlun', grade: 2, rank: 'boss' }] as never },
    })).toThrow(/kunlun.*2.*首領/)
    expect(() => makeBattleGame({
      features: [enemiesFeature, TEST_COMBAT], content: [PACK],
      battle: { mode: 'meat', grade: 1, allies: BATTLE_SETUPS.encounter(1).allies, foes: [{ from: 'enemy_pick', faction: 'kunlun', grade: 2, rank: 'minion', seed: { x: 1 } }] as never },
    })).toThrow(/seed/)
  })
})

// ===================================================================================================================

describe('attached：UnitRef 蓋掉兵種自己的附屬單位（ENEMIES 第 10 節、M1b 的行為）', () => {
  const open = (foe: Rec) => {
    const { game } = makeBattleGame({
      features: [enemiesFeature, TEST_COMBAT], content: [PACK],
      battle: { mode: 'meat', grade: 3, cover: { ally: [0, 0, 0, 0], foe: [0, 0, 0, 0] }, allies: BATTLE_SETUPS.encounter(1).allies, foes: [foe] as never },
    })
    return game
  }
  const hang = (g: Game) => g.state.battle!.overlays.map((o) => ({ enemy: o.ext?.enemy, owner: o.owner, slot: o.slot, autonomous: o.autonomous }))

  it('沒寫 attached：照兵種自己的（一台）', () => {
    expect(hang(open({ from: 'enemy', id: 'en_h_master' })).map((o) => o.enemy)).toEqual(['en_d_drone'])
  })

  it('寫兩隻獵犬：掛兩台，owner 是主人、自律；兩台在主人那一格附近（放不下的挪到最近的空格）', () => {
    const g = open({ from: 'enemy', id: 'en_h_master', attached: [{ enemy: 'en_d_hound', count: 2 }] })
    const o = hang(g)
    expect(o).toHaveLength(2)
    expect(o.map((x) => x.enemy)).toEqual(['en_d_hound', 'en_d_hound'])
    expect(o.every((x) => x.owner === 'f1' && x.autonomous)).toBe(true)
    expect(new Set(o.map((x) => x.slot)).size).toBe(2)
    // 蓋掉的不再掛兵種自己的那一台
    expect(o.some((x) => x.enemy === 'en_d_drone')).toBe(false)
  })

  it('寫空陣列：不帶，連兵種自己的也不掛', () => {
    expect(hang(open({ from: 'enemy', id: 'en_h_master', attached: [] }))).toEqual([])
  })

  it('沒有附屬單位的兵種也可以由 UnitRef 給：同一份格式（slot 寫第幾格或 same）', () => {
    const o = hang(open({ from: 'enemy', id: 'en_h_plain', attached: [{ enemy: 'en_d_hound', slot: 4 }, { enemy: 'en_d_drone', slot: 'same' }] }))
    // 'same' 是主人那一格（主人站第 1 格）
    expect(o).toEqual([
      { enemy: 'en_d_hound', owner: 'f1', slot: 4, autonomous: true },
      { enemy: 'en_d_drone', owner: 'f1', slot: 1, autonomous: true },
    ])
  })

  it('enemy_pick 也收 attached', () => {
    const g = open({ from: 'enemy_pick', faction: 'blackspring', grade: 3, rank: 'minion', seed: 'k', attached: [{ enemy: 'en_d_hound' }] })
    expect(hang(g).map((x) => x.enemy)).toEqual(['en_d_hound'])
  })

  it('主人倒下之後兩台都自律（沒有操作者、自己動），照 M1b 的行為', () => {
    const g = open({ from: 'enemy', id: 'en_h_master', attached: [{ enemy: 'en_d_hound', count: 2 }] })
    const b = g.state.battle!
    new BattleRun(g.k, g.state, b).setOut(b.units.f1!, 'down')
    expect(b.overlays.map((o) => ({ down: o.down, auto: o.auto, owner: o.owner, orphan: o.ext?.orphan, autonomous: o.autonomous }))).toEqual([
      { down: false, auto: true, owner: undefined, orphan: true, autonomous: true },
      { down: false, auto: true, owner: undefined, orphan: true, autonomous: true },
    ])
  })

  it('寫得不對：格式（不是陣列、count 超過 4、多的鍵）、查不到的敵人、不是掛在格上的兵種，都在開打時丟錯並寫出是哪一筆', () => {
    expect(() => open({ from: 'enemy', id: 'en_h_master', attached: 'en_d_hound' })).toThrow(/attached 要是陣列/)
    expect(() => open({ from: 'enemy', id: 'en_h_master', attached: [{ enemy: 'en_d_hound', count: 9 }] })).toThrow(/attached\[0\]\.count/)
    expect(() => open({ from: 'enemy', id: 'en_h_master', attached: [{ enemy: 'en_d_hound', x: 1 }] })).toThrow(/attached\[0\]\.x/)
    expect(() => open({ from: 'enemy', id: 'en_h_master', attached: [{ enemy: 'en_not_there' }] })).toThrow(/attached\[0\].*en_not_there/)
    expect(() => open({ from: 'enemy', id: 'en_h_master', attached: [{ enemy: 'en_d_drone' }, { enemy: 'en_h_plain' }] })).toThrow(/attached\[1\].*en_h_plain.*overlay/)
  })
})

// ===================================================================================================================

describe('俘虜的條件與機率（ENEMIES 6.1 節）', () => {
  it('機率：雜兵 40%、精英 25%、首領 10%，主角的誘惑每級 +3%', () => {
    expect(CAPTURE_BASE).toEqual({ minion: 40, elite: 25, boss: 10 })
    expect([0, 1, 3, 6].map((s) => captureChance('minion', s))).toEqual([40, 43, 49, 58])
    expect(captureChance('elite', 3)).toBe(34)
    expect(captureChance('boss', 3)).toBe(19)
  })

  const unit = (rank: 'minion' | 'elite' | 'boss', id = 'f1') => ({ id, enemy: 'en_c_mook', name: `甲${id}`, rank, grade: 2 }) as never
  const e = { faction: 'starbelle', adult: ['豐滿'] } as never
  /** 照給的順序出骰面的亂數。 */
  const fixed = (...v: number[]) => ({ int: (lo: number, hi: number) => { const x = v.shift(); if (x === undefined) throw new Error('骰面用完了'); expect(lo).toBe(1); expect(hi).toBe(100); return x } })

  it('固定骰面下雜兵 40%：40 擲中、41 沒中（兩邊各驗一次）；精英 25／26、首領 10／11', () => {
    expect(rollCaptures(fixed(40), [{ u: unit('minion'), e }], 0)).toHaveLength(1)
    expect(rollCaptures(fixed(41), [{ u: unit('minion'), e }], 0)).toHaveLength(0)
    expect(rollCaptures(fixed(25), [{ u: unit('elite'), e }], 0)).toHaveLength(1)
    expect(rollCaptures(fixed(26), [{ u: unit('elite'), e }], 0)).toHaveLength(0)
    expect(rollCaptures(fixed(10), [{ u: unit('boss'), e }], 0)).toHaveLength(1)
    expect(rollCaptures(fixed(11), [{ u: unit('boss'), e }], 0)).toHaveLength(0)
  })

  it('誘惑 3 級多 9%：雜兵 49 擲中、50 沒中；誘惑 0 級同樣的 49 沒中', () => {
    expect(rollCaptures(fixed(49), [{ u: unit('minion'), e }], 3)).toHaveLength(1)
    expect(rollCaptures(fixed(50), [{ u: unit('minion'), e }], 3)).toHaveLength(0)
    expect(rollCaptures(fixed(49), [{ u: unit('minion'), e }], 0)).toHaveLength(0)
  })

  it('每個符合的人各擲一次、照順序用骰面；成功的記下骰面與機率', () => {
    const got = rollCaptures(fixed(5, 99, 20), [{ u: unit('minion', 'f1'), e }, { u: unit('minion', 'f2'), e }, { u: unit('elite', 'f3'), e }], 0)
    expect(got.map((c) => [c.unit, c.roll, c.pct])).toEqual([['f1', 5, 40], ['f3', 20, 25]])
    expect(got[0]).toMatchObject({ enemy: 'en_c_mook', name: '甲f1', rank: 'minion', grade: 2, faction: 'starbelle', adult: ['豐滿'] })
  })

  it('種類：human 可以；機器要 humanoid；沒有橋的人、載具、機甲、吉祥物、蕾絲、程式不行；capture: false 一律不行', () => {
    expect(captureKindOk({ kind: 'human' })).toBe(true)
    expect(captureKindOk({ kind: 'machine' })).toBe(false)
    expect(captureKindOk({ kind: 'machine', humanoid: true })).toBe(true)
    for (const kind of ['unbridged', 'vehicle', 'mech', 'mascot', 'lace', 'program'] as const) expect(captureKindOk({ kind }), kind).toBe(false)
    expect(captureKindOk({ kind: 'human', capture: false })).toBe(false)
    expect(captureKindOk({ kind: 'machine', humanoid: true, capture: false })).toBe(false)
  })

  it('制伏那一刻：有橋的要失去回合而且疊過餘韻；人形的機器要失去回合（電磁停機）；沒有失去回合不算', () => {
    const human = { kind: 'human' } as const, android = { kind: 'machine', humanoid: true } as const
    const lose = { statuses: [{ id: LOSE_TURN }] }
    expect(captureCause(human, { ...lose, load: { now: 0, max: 10 }, layers: 1 } as never)).toBe('load')
    expect(captureCause(human, { ...lose, load: { now: 0, max: 10 }, layers: 0 } as never)).toBe(null)
    expect(captureCause(human, { statuses: [], load: { now: 0, max: 10 }, layers: 2 } as never)).toBe(null)
    expect(captureCause(android, { ...lose, layers: 0 } as never)).toBe('stun')
    expect(captureCause(android, { statuses: [], layers: 0 } as never)).toBe(null)
    expect(captureCause({ kind: 'machine' }, { ...lose, layers: 0 } as never)).toBe(null)
  })

  it('問話的難度：10 ＋ 等級 × 2，精英 +2、首領 +4', () => {
    expect(ASK_DC).toEqual({ base: 10, perGrade: 2, elite: 2, boss: 4 })
    expect([askDc(1, 'minion'), askDc(3, 'minion'), askDc(2, 'elite'), askDc(3, 'boss'), askDc(5, 'boss')]).toEqual([12, 16, 16, 20, 24])
  })
})

// ===================================================================================================================

describe('打贏之後誰擲、誰不擲', () => {
  it('感載滿了被制伏的才擲：骰面擲中時戰鬥結束那一份帶 launch、狀態記下他，capture.offer 報告在後面', async () => {
    const r = await oneCaptive()
    const cap = stateOf(r.game)
    expect(cap).toMatchObject({ battle: 'b1', step: 'treat', picked: 'f1', offered: true })
    expect(cap.candidates.map((c) => [c.unit, c.enemy, c.rank, c.faction])).toEqual([['f1', 'en_c_mook', 'minion', 'starbelle']])
    expect(r.end.launch).toEqual([expect.objectContaining({ kind: 'event', origin: { by: 'enemies', ref: 'b1', ext: { step: 'treat' } } })])
    expect(r.actions.slice(0, 2)).toEqual(['battle.end', 'capture.offer'])
    expect(r.actions).toContain('event.open')
    expect(r.end.narration?.results).toContain('測試en_c_mook被制伏後還醒著，可以處置')
    expect(r.launched?.event.id).toBe('capture_treat')
  })

  it('被生命打倒的、昏過去的、投降的、逃走的不擲（骰面再好也沒有）', async () => {
    for (const how of ['down', 'burnout', 'surrender', 'fled'] as const) {
      const base: FightOpts = { foes: [{ id: 'en_c_mook', how }, { id: 'en_c_mook', how: 'down' }] }
      const r = await fight({ ...base, rngSeed: winSeed(arrange(base).game, 4) })
      expect(r.cap, how).toBeNull()
      expect(r.end.launch, how).toBeUndefined()
      expect(r.actions, how).toEqual(['battle.end'])
    }
  })

  it('被制伏但不是「感載滿了、失去回合」的不擲：沒有失去回合、或疊層數是 0', async () => {
    for (const how of ['subdue_plain'] as const) {
      const base: FightOpts = { foes: [{ id: 'en_c_mook', how }] }
      const r = await fight({ ...base, rngSeed: winSeed(arrange(base).game, 2) })
      expect(r.cap, how).toBeNull()
    }
    const base: FightOpts = { foes: [{ id: 'en_c_mook', how: 'subdue_nolayer' }] }
    const r = await fight({ ...base, rngSeed: winSeed(arrange(base).game, 2) })
    expect(r.cap).toBeNull()
  })

  it('capture: false 的不擲；非人形的機器、沒有橋的人不擲；人形的機器被電磁打到停機時制伏要擲', async () => {
    const cases: Array<[string, How, boolean]> = [
      ['en_c_nocap', 'subdue_load', false], ['en_c_bot', 'subdue_stun', false], ['en_c_unbridged', 'subdue_stun', false],
      ['en_c_android', 'subdue_stun', true], ['en_c_android', 'down', false], ['en_c_mook', 'subdue_load', true],
    ]
    for (const [id, how, expected] of cases) {
      const base: FightOpts = { foes: [{ id, how }, { id: 'en_c_mook', how: 'down' }] }
      const r = await fight({ ...base, rngSeed: winSeed(arrange(base).game, 4) })
      expect(r.cap !== null, `${id} ${how}`).toBe(expected)
    }
  })

  it('戰敗、脫離、投降（我方結果）不擲', async () => {
    for (const outcome of ['lose', 'fled', 'surrender']) {
      const base: FightOpts = { foes: [{ id: 'en_c_mook', how: 'subdue_load' }, { id: 'en_c_mook', how: 'down' }], outcome }
      const r = await fight({ ...base, rngSeed: winSeed(arrange(base).game, 4) })
      expect(r.cap, outcome).toBeNull()
      expect(r.end.launch, outcome).toBeUndefined()
    }
  })

  it('沒有人登記事件視窗時不擲、不留狀態、不丟錯（沒開那個功能的遊戲照樣打得完）', async () => {
    const base: FightOpts = { foes: [{ id: 'en_c_mook', how: 'subdue_load' }], features: [enemiesFeature, TEST_COMBAT] }
    const r = await fight({ ...base, rngSeed: winSeed(arrange(base).game, 2) })
    expect(r.cap).toBeNull()
    expect(r.end.launch).toBeUndefined()
    expect(r.game.state.ext[CAPTURE_EXT]).toBeUndefined()
  })

  it('機率在整條流程上：雜兵 40%（骰面 40 中、41 不中），誘惑 3 級同一個 41 到 49 的骰面就中', async () => {
    const base: FightOpts = { foes: [{ id: 'en_c_mook', how: 'subdue_load' }, { id: 'en_c_mook', how: 'down' }] }
    const probe = arrange(base).game
    const at = (lo: number, hi: number) => seedWhere(probe, 1, ([x]) => x! >= lo && x! <= hi)
    expect((await fight({ ...base, rngSeed: at(40, 40) })).cap).not.toBeNull()
    expect((await fight({ ...base, rngSeed: at(41, 41) })).cap).toBeNull()
    const seduce = { ...base, pc: { skills: { seduce: 3 } } }
    expect((await fight({ ...seduce, rngSeed: at(49, 49) })).cap).not.toBeNull()
    expect((await fight({ ...seduce, rngSeed: at(50, 50) })).cap).toBeNull()
    expect((await fight({ ...base, rngSeed: at(41, 49) })).cap).toBeNull()
    expect((await fight({ ...seduce, rngSeed: at(41, 49) })).cap).not.toBeNull()
  })

  it('精英與首領的機率也在流程上（25%、10%）', async () => {
    const mk = (id: string): FightOpts => ({ foes: [{ id, how: 'subdue_load' }] })
    for (const [id, pct] of [['en_c_elite', 25], ['en_c_boss', 10]] as const) {
      const probe = arrange(mk(id)).game
      const at = (v: number) => seedWhere(probe, 1, ([x]) => x === v)
      expect((await fight({ ...mk(id), rngSeed: at(pct) })).cap, id).not.toBeNull()
      expect((await fight({ ...mk(id), rngSeed: at(pct + 1) })).cap, id).toBeNull()
    }
  })

  it('同一個種子結果一樣（狀態、報告的動作、事件的內容都一樣）', async () => {
    const run = async () => {
      const r = await oneCaptive()
      return { hash: stateHash(r.game.state), actions: r.actions, event: JSON.stringify(r.launched?.event) }
    }
    expect(await run()).toEqual(await run())
  })
})

// ===================================================================================================================

describe('多個人都擲中：全列出來，只能挑一個（ENEMIES 6.1 節）', () => {
  const two: FightOpts = { foes: [{ id: 'en_c_mook', how: 'subdue_load' }, { id: 'en_c_mook2', how: 'subdue_load' }, { id: 'en_c_boss', how: 'down' }] }
  const open = async () => fight({ ...two, rngSeed: winSeed(arrange(two).game, 4) })

  it('兩個都中：先開「挑一個」的事件，兩個都列（選項 id 是 pick:<單位>），狀態是 pick', async () => {
    const r = await open()
    expect(stateOf(r.game)).toMatchObject({ step: 'pick', battle: 'b1' })
    expect(stateOf(r.game).picked).toBeUndefined()
    expect(stateOf(r.game).candidates.map((c) => c.unit)).toEqual(['f1', 'f2'])
    expect(r.launched?.event.id).toBe('capture_pick')
    expect(optionIds(r.launched)).toEqual(['pick:f1', 'pick:f2'])
    expect((r.launched!.event.options as Rec[]).map((o) => o.text).join('')).toContain('測試en_c_mook2')
    expect(r.end.launch).toEqual([expect.objectContaining({ origin: { by: 'enemies', ref: 'b1', ext: { step: 'pick' } } })])
  })

  it('挑了一個：接著開那一個人的處置，另一個不再出現；做完之後狀態清掉', async () => {
    const r = await open()
    const reports = closeEvent(r.game, 'pick:f2')
    expect(reports.map((x) => x.action)).toEqual(['event.close', 'event.open'])
    const cap = stateOf(r.game)
    expect(cap).toMatchObject({ step: 'treat', picked: 'f2' })
    const ev = fakeEvent(r.game.state)!
    expect(ev.event.id).toBe('capture_treat')
    expect(ev.event.text).toContain('測試en_c_mook2')
    expect(ev.event.text).not.toContain('測試en_c_mook被')
    expect(JSON.stringify(ev.event.cast)).toContain('測試en_c_mook2')
    expect(ev.origin).toEqual({ by: 'enemies', ref: 'b1', ext: { step: 'treat' } })
    closeEvent(r.game, 'release')
    expect(captureOf(r.game.state)).toBeNull()
  })

  it('不挑（選了別的、「我要做別的」）：全部放走，什麼都不加，狀態清掉', async () => {
    const r = await open()
    const reports = closeEvent(r.game, 'pick:f1')
    expect(reports).toHaveLength(2)
    // 在第二件事件裡走「我要做別的」：替身用 release 之外的選項 id 代表
    const ev = fakeEvent(r.game.state)!
    ev.event.options = [...(ev.event.options as Rec[]), { id: 'free', text: '我要做別的。', outcomes: { any: [] } }]
    const done = closeEvent(r.game, 'free')
    expect(done.map((x) => x.action)).toEqual(['event.close', 'capture.done'])
    expect(captureOf(r.game.state)).toBeNull()
    expect(meter(r.game, 'hostility', 'starbelle')).toBe(0)
  })

  it('一場最多列四個人', async () => {
    const many: FightOpts = { foes: ['en_c_mook', 'en_c_mook', 'en_c_mook', 'en_c_mook'].map((id) => ({ id, how: 'subdue_load' as const })) }
    const r = await fight({ ...many, rngSeed: winSeed(arrange(many).game, 4) })
    expect(stateOf(r.game).candidates).toHaveLength(4)
    expect(optionIds(r.launched)).toEqual(['pick:f1', 'pick:f2', 'pick:f3', 'pick:f4'])
  })
})

// ===================================================================================================================

describe('處置的事件：選項與效果（ENEMIES 6.1 節的表）', () => {
  it('四個選項：帶走、問話、交出去、放走（有 scene、對象非自願沒關、兵種沒寫沒有成人場景）', async () => {
    const r = await oneCaptive()
    expect(optionIds(r.launched)).toEqual(['take', 'ask', 'handover', 'release'])
    expect(r.launched!.event.text).toContain('測試en_c_mook')
  })

  it('「對象非自願」關掉：沒有帶走，其餘三個都在', async () => {
    const r = await oneCaptive({ rules: { contentOff: ['target_unwilling'] } })
    expect(optionIds(r.launched)).toEqual(['ask', 'handover', 'release'])
  })

  it('沒有人登記 scene：沒有帶走（沒有場景可進），其餘三個都在', async () => {
    const r = await oneCaptive({ features: [enemiesFeature, TEST_COMBAT, FAKE_EVENT, FAKE_METERS] })
    expect(optionIds(r.launched)).toEqual(['ask', 'handover', 'release'])
  })

  it('這個兵種寫了 adult: null（沒有成人場景）：沒有帶走', async () => {
    const r = await oneCaptive({ foes: [{ id: 'en_c_noadult', how: 'subdue_load' }, { id: 'en_c_mook', how: 'down' }] })
    expect(optionIds(r.launched)).toEqual(['ask', 'handover', 'release'])
  })

  it('帶走：adult_scene 的性質是 captive，主角與登場角色 $a 一圈，標籤是這個兵種「成人場景」那一欄；登場角色是這個俘虜', async () => {
    const r = await oneCaptive()
    const take = optionOf(r.launched!, 'take')
    expect(take.adult_scene).toEqual({ when: 'always', gate: 'fixed', nature: 'captive', role: 'none', goal: 'none', circles: [['$pc', '$a']], tags: ['豐滿', '支配'] })
    expect(r.launched!.event.cast).toEqual([{ role: 'a', gen: { kind: 'captive', name: '測試en_c_mook', enemy: 'en_c_mook', faction: 'starbelle' } }])
    // 沒寫 adult 的兵種：標籤是空的
    const plain = await oneCaptive({ foes: [{ id: 'en_c_mook2', how: 'subdue_load' }, { id: 'en_c_mook', how: 'down' }] })
    expect((optionOf(plain.launched!, 'take').adult_scene as Rec).tags).toEqual([])
  })

  it('敵對值照表：帶走 +1、問話 +1（成功、失敗、大成功都一樣）、交出去 +2、放走不加', async () => {
    const hostility = (r: { launched: ReturnType<typeof fakeEvent> }, id: string, degree?: string): unknown => {
      const out = optionOf(r.launched!, id).outcomes as Rec
      return (degree ? out[degree] : out.any) as Rec[]
    }
    const r = await oneCaptive()
    const hostile = (n: number) => [{ kind: 'hostility', key: 'starbelle', amount: n }]
    expect(hostility(r, 'take')).toEqual(hostile(1))
    expect(hostility(r, 'ask', 'fail')).toEqual(hostile(1))
    expect(hostility(r, 'handover')).toEqual(hostile(2))
    expect(hostility(r, 'release')).toEqual([])
    expect(JSON.stringify(hostility(r, 'ask', 'success'))).toContain('"amount":1')
    expect(JSON.stringify(hostility(r, 'ask', 'critical'))).toContain('"amount":1')
  })

  it('照表結算：選了之後敵對值真的變了，做完之後 state.ext.capture 清掉，capture.done 有一句話', async () => {
    const expected: Array<[string, string | undefined, number, string]> = [
      ['take', undefined, 1, '帶走了測試en_c_mook'],
      ['ask', 'success', 1, '從測試en_c_mook口中問出了情報'],
      ['ask', 'critical', 1, '從測試en_c_mook口中問出了情報，還拿到一份憑證'],
      ['ask', 'fail', 1, '測試en_c_mook什麼都沒說'],
      ['ask', 'fumble', 1, '測試en_c_mook什麼都沒說'],
      ['handover', undefined, 2, '把測試en_c_mook交了出去'],
      ['release', undefined, 0, '放走了測試en_c_mook'],
    ]
    for (const [option, degree, hostile, line] of expected) {
      const r = await oneCaptive()
      const reports = closeEvent(r.game, option, degree)
      expect(meter(r.game, 'hostility', 'starbelle'), `${option} ${degree}`).toBe(hostile)
      expect(captureOf(r.game.state), `${option} ${degree}`).toBeNull()
      expect(r.game.state.ext[CAPTURE_EXT]).toBeUndefined()
      expect(reports.map((x) => x.action), `${option} ${degree}`).toEqual(['event.close', 'capture.done'])
      const done = reports[1]!
      expect(done.outcome.result).toBe(option)
      expect(done.outcome.summary).toBe(`${line}。`)
      expect(reports[0]!.narration?.results).toEqual([line])
    }
  })

  it('問話成功與大成功的收穫：旗標（情報、憑證），scout_reveal 有人註冊才給（帶這件委託的 id）', async () => {
    const withReveal = await oneCaptive({ ext: { commission: 'job_7' } })
    const ask = optionOf(withReveal.launched!, 'ask').outcomes as Rec
    expect(ask.success).toEqual([
      { kind: 'flag', key: 'capture:info:starbelle', value: true }, { kind: 'scout_reveal', job: 'job_7' }, { kind: 'hostility', key: 'starbelle', amount: 1 },
    ])
    expect(ask.critical).toEqual([
      { kind: 'flag', key: 'capture:info:starbelle', value: true }, { kind: 'flag', key: 'capture:credential:starbelle', value: true },
      { kind: 'scout_reveal', job: 'job_7' }, { kind: 'hostility', key: 'starbelle', amount: 1 },
    ])
    closeEvent(withReveal.game, 'ask', 'critical')
    expect(withReveal.game.state.flags['capture:info:starbelle']).toBe(true)
    expect(withReveal.game.state.flags['capture:credential:starbelle']).toBe(true)
    expect(withReveal.game.state.flags['revealed:job_7']).toBe(true)
    // 沒有人註冊 scout_reveal：略過那一筆，其餘照給
    const without = await oneCaptive({ features: [enemiesFeature, TEST_COMBAT, FAKE_EVENT, FAKE_SCENE, FAKE_METERS] })
    expect(JSON.stringify(optionOf(without.launched!, 'ask').outcomes)).not.toContain('scout_reveal')
    expect(JSON.stringify(optionOf(without.launched!, 'ask').outcomes)).toContain('capture:info:starbelle')
  })

  it('問話的檢定：[基本功, 屬性, DC]；DC 照等級與位階；預設威嚇，交涉對主角比較有利時用交涉', async () => {
    const plain = await oneCaptive()
    expect(optionOf(plain.launched!, 'ask').check).toEqual(['intimidate', 'resolve', askDc(1, 'minion')])
    const charming = await oneCaptive({ pc: { attrs: { charm: 16 }, skills: { negotiate: 2 } } })
    expect(optionOf(charming.launched!, 'ask').check).toEqual(['negotiate', 'charm', 12])
    const fierce = await oneCaptive({ pc: { attrs: { charm: 16, resolve: 16 }, skills: { negotiate: 2, intimidate: 2 } } })
    expect(optionOf(fierce.launched!, 'ask').check).toEqual(['intimidate', 'resolve', 12])
    // 精英與首領的 DC（等級是單位的等級）
    const elite = await fight({ foes: [{ id: 'en_c_elite', grade: 2, how: 'subdue_load' }], rngSeed: winSeed(arrange({ foes: [{ id: 'en_c_elite', grade: 2, how: 'subdue_load' }] }).game, 2) })
    expect((optionOf(elite.launched!, 'ask').check as unknown[])[2]).toBe(16)
    const boss = await fight({ foes: [{ id: 'en_c_boss', grade: 3, how: 'subdue_load' }], rngSeed: winSeed(arrange({ foes: [{ id: 'en_c_boss', grade: 3, how: 'subdue_load' }] }).game, 2) })
    expect((optionOf(boss.launched!, 'ask').check as unknown[])[2]).toBe(20)
  })

  it('交出去：收的人（origin.ext.employer）好感 +1；沒有寫收的人就沒有這一筆', async () => {
    const withBoss = await oneCaptive({ ext: { employer: 'kunlun' } })
    expect((optionOf(withBoss.launched!, 'handover').outcomes as Rec).any).toEqual([{ kind: 'hostility', key: 'starbelle', amount: 2 }, { kind: 'favor', key: 'kunlun', amount: 1 }])
    closeEvent(withBoss.game, 'handover')
    expect([meter(withBoss.game, 'hostility', 'starbelle'), meter(withBoss.game, 'favor', 'kunlun')]).toEqual([2, 1])
    const none = await oneCaptive()
    expect((optionOf(none.launched!, 'handover').outcomes as Rec).any).toEqual([{ kind: 'hostility', key: 'starbelle', amount: 2 }])
  })

  it('勢力是 none 的敵人沒有敵對值可加；量表效果沒有人註冊（security 沒裝）時也跑得起來，只是沒有那幾筆', async () => {
    const nofaction = await oneCaptive({ foes: [{ id: 'en_c_nofaction', how: 'subdue_load' }, { id: 'en_c_mook', how: 'down' }] })
    expect(JSON.stringify(optionOf(nofaction.launched!, 'take').outcomes)).not.toContain('hostility')
    const bare = await oneCaptive({ features: [enemiesFeature, TEST_COMBAT, FAKE_EVENT, FAKE_SCENE] })
    for (const id of ['take', 'handover', 'release']) expect((optionOf(bare.launched!, id).outcomes as Rec).any, id).toEqual([])
    closeEvent(bare.game, 'take')
    expect(captureOf(bare.game.state)).toBeNull()
  })

  it('處置進行中別的報告被事件視窗擋下（替身的白名單）；做完之後不擋', async () => {
    const r = await oneCaptive()
    expect(r.game.blockOf('commit:trade.checkout')).toBe('事件視窗開著，先回應它。')
    closeEvent(r.game, 'release')
    expect(r.game.blockOf('commit:trade.checkout')).toBeNull()
  })

  it('同一個種子結果一樣：整場結算加處置之後的狀態雜湊相同', async () => {
    const run = async () => {
      const r = await oneCaptive()
      closeEvent(r.game, 'ask', 'success')
      return stateHash(r.game.state)
    }
    expect(await run()).toBe(await run())
  })

  it('開著處置存檔再讀：狀態還在（state.ext.capture 與事件）', async () => {
    const r = await oneCaptive()
    const copy = JSON.parse(JSON.stringify(r.game.state.ext)) as Rec
    expect(copy[CAPTURE_EXT]).toEqual(r.game.state.ext[CAPTURE_EXT])
    expect(copy[FAKE_KEY]).toBeDefined()
  })
})

// ===================================================================================================================

describe('格式：capture 與 humanoid', () => {
  const load = (more: Rec) => () => makeGame({ features: [enemiesFeature, TEST_COMBAT], content: [{ ...PACK, content: { ...PACK.content, enemy: [...ENEMIES, enemy('en_x', 'minion', more)] } } as unknown as ContentPack] })

  it('capture、humanoid 要是 true 或 false；寫對的載得進來', () => {
    expect(load({ capture: false })).not.toThrow()
    expect(load({ kind: 'machine', humanoid: true })).not.toThrow()
    expect(load({ capture: 'no' })).toThrow(/enemy\/en_x：.*capture/)
    expect(load({ humanoid: 1 })).toThrow(/enemy\/en_x：.*humanoid/)
  })

  it('沒寫新欄位的資料行為不變：M1 的敵人與掉落測試原樣過（見 M1-enemies、M1b-loot 兩個檔）', () => {
    const { game } = makeGame({ features: [enemiesFeature, TEST_COMBAT], content: [PACK] })
    expect(game.k.content.get('enemy', 'en_c_mook')).toBeDefined()
    expect(game.k.battle.getUnitSource('enemy_pick')).toBeDefined()
  })
})

// ===================================================================================================================
// M2-closeout 第 9 項：副本外的戰鬥（沒有進行中的委託）打贏之後的俘虜
// ===================================================================================================================

const chooseOptionOf = (g: Game, id: string): ReportDraft => chooseOption(g.k, g.state, id)

describe('M2-closeout 9：不在委託裡的俘虜（審問選項的 scout_reveal 只在副本裡放）', () => {
  // 真的事件視窗與真的 fixer（scout_reveal 的格式檢查：手上沒有進行中的委託就不合格）；成人場景與量表效果仍是替身
  const REAL = [enemiesFeature, TEST_COMBAT, directorFeature, eventRunFeature, FAKE_SCENE, FAKE_METERS, fixerFeature]
  const REAL_PACK: ContentPack = { id: 'm2_closeout_real', content: { ...PACK.content, event_scope: [{ id: 'capture', triggers: {}, cooldown_hours: 0, repeat_days: 0, lost: 'drop' }] } as ContentPack['content'] }
  const real = (o: Partial<FightOpts> = {}) => oneCaptive({ features: REAL, content: [REAL_PACK], ...o })

  it('擲中一個、沒有委託：打贏的結算照常成立（以前整步被擋），處置的事件開起來，審問的結果裡沒有 scout_reveal', async () => {
    const r = await real()
    expect(r.actions).toContain('battle.end')
    expect(r.game.state.battle).toBeNull()
    const ev = eventView(r.game.k, r.game.state)
    expect(ev).not.toBeNull()
    expect(ev!.options.map((o) => o.id)).toEqual(expect.arrayContaining(['ask', 'handover', 'release']))
    // 審問的選項在引擎裡：用事件視窗開著的那一件（內嵌的）看它的結果
    const open = r.game.state.ext.director as { open?: { inline?: { options: Rec[] } } }
    const ask = (open.open!.inline!.options as Rec[]).find((o) => o.id === 'ask')!
    expect(JSON.stringify(ask.outcomes)).not.toContain('scout_reveal')
    expect(JSON.stringify(ask.outcomes)).toContain('capture:info:starbelle')
    // 處置得下去：放走之後俘虜的狀態清掉
    r.game.commit(chooseOptionOf(r.game, 'release'))
    expect(captureOf(r.game.state)).toBeNull()
  })

  it('沒有 scout_reveal 的效果（fixer 沒裝）與副本外的戰鬥：同樣沒有那一筆；副本裡（origin.ext.commission）才放', async () => {
    const plain = await oneCaptive()
    expect(JSON.stringify(optionOf(plain.launched!, 'ask').outcomes)).not.toContain('scout_reveal')
    const inJob = await oneCaptive({ ext: { commission: 'job_7' } })
    expect(JSON.stringify(optionOf(inJob.launched!, 'ask').outcomes)).toContain('"scout_reveal"')
  })

  it('擲中好幾個：先挑一個，挑完之後處置的事件也開得起來（以前挑完開不起來）', async () => {
    const base: FightOpts = {
      foes: [{ id: 'en_c_mook', how: 'subdue_load' }, { id: 'en_c_mook2', how: 'subdue_load' }], features: REAL, content: [REAL_PACK],
    }
    const probe = arrange(base)
    const r = await fight({ ...base, rngSeed: winSeed(probe.game, 4) })
    const first = eventView(r.game.k, r.game.state)!
    expect(first.options.every((o) => o.id.startsWith('pick:'))).toBe(true)
    expect(first.options.length).toBeGreaterThanOrEqual(2)
    r.game.commit(chooseOptionOf(r.game, first.options[0]!.id))
    const treat = eventView(r.game.k, r.game.state)
    expect(treat).not.toBeNull()
    expect(treat!.options.map((o) => o.id)).toEqual(expect.arrayContaining(['ask', 'handover', 'release']))
  })
})
