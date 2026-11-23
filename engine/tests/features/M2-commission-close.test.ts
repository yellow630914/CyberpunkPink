// 驗收測試：dev/work/M2-commission-close.md（cpp-feature）。副本做完與做不完的結算：評價、路線的後果（目標勢力的敵對值）、歷練點；
// 戰敗被接受之後照戰敗事件的旗標決定委託失敗並回到入口、或留在這個階段的開頭繼續。
// 規格：COMMISSIONS 2.3 節的表（規模與歷練點）、第 8 節；COMBAT_SYSTEM 8.4、8.5 節；SERIES 第 6 節；ENEMIES 第 6 節；FACTIONS 6.2 節；CORE_RULES 7.1 節；dev/adr/0016 第一、二節與 G16。
// 內容一律是測試自帶的最小假資料（同 M2-commission-run 的三階段假副本與小辦公室）。敵對值的量表用測試裝的替身（security 的功能不 import）；
// 歷練點的效果 xp 是替身（abilities 還沒有登記它）。接受戰敗先用測試自己發的 activity.end 驗，最後一條用真的戰敗功能串起來（M2-defeat 做完了）。

import { describe, expect, it } from 'vitest'
import type { ContentPack, Effect, Feature, GameState, Report } from '../../src'
import { attachActivityEnd, endActivity, meterOf, toMinutes } from '../../src'
import { acceptDefeat, defeatFeature } from '../../src/features/defeat'
import { enemiesFeature } from '../../src/features/enemies'
import { exploreFeature } from '../../src/features/explore'
import {
  DEFAULT_COMMISSION_RULES, HOSTILITY_EFFECT, RATINGS, XP_EFFECT, breathe, chooseBranch, chooseFace, commissionFeature, commissionView, failedOf, fallout, rate, readRun, retreat, xpFor,
} from '../../src/features/commission'
import { TEST_COMBAT, makeGame, playOut, stateHash, testWeapon } from '../../src/testkit'
import { meterFeature, testMeter } from '../../src/testkit'

type Rec = Record<string, unknown>

// ===================================================================================================================
// 假資料
// ===================================================================================================================

/** DATA 9.3 節的小辦公室（和 M2-explore 的測試同一張）。E1 窗（開放座位，一進去就看得到 G1）、E2 後門、E3 正門；T3 檔案間、X1 後門撤離點。 */
const OFFICE = {
  id: 'office', name: '二樓的辦公室', size: [9, 9],
  layout: ['####=E###', '#TOT#.OS#', '#.2.%G1.#', '#DC.#o.o#', '######+##', '#T&$#.GS#', 'E...%.O.#', '#X..#C.K#', '######E##'],
  zones: ['####bb###', '#ccc#bbb#', '#ccccbbb#', '#ccc#bbb#', '######a##', '#ddd#aaa#', 'dddddaaa#', '#ddd#aaa#', '######a##'],
  zone_names: { a: '接待區', b: '開放座位', c: '主管室', d: '茶水間與後門' },
  cells: [
    { id: 'E1', at: [5, 0], mark: 'E', kind: 'window', name: '二樓的窗' },
    { id: 'E2', at: [0, 6], mark: 'E', kind: 'back', name: '後門（茶水間旁的防火門）' },
    { id: 'E3', at: [6, 8], mark: 'E', kind: 'front', name: '正門' },
    { id: 'T1', at: [1, 1], mark: 'T', name: '牆上的保險櫃' }, { id: 'T2', at: [3, 1], mark: 'T', name: '主管室的辦公桌' }, { id: 'T3', at: [1, 5], mark: 'T', name: '茶水間後面的檔案間' },
    { id: 'D1', at: [1, 3], mark: 'D', name: '主管室的終端下方的網路孔' },
    { id: 'C1', at: [2, 3], mark: 'C', name: '主管室的控制面板' },
    { id: '$1', at: [3, 5], mark: '$', name: '檔案間的小保險箱' },
    { id: '&1', at: [2, 5], mark: '&', name: '檔案間（人質放在這裡）' },
    { id: 'C2', at: [5, 7], mark: 'C', name: '接待區的控制面板' },
    { id: 'K1', at: [7, 7], mark: 'K', name: '接待區的員工外套掛架' },
    { id: 'G1', at: [5, 2], mark: 'G', name: '主管室門口' }, { id: 'G2', at: [6, 5], mark: 'G', name: '接待櫃檯' },
    { id: 'X1', at: [1, 7], mark: 'X', name: '後門' },
    { id: 'S1', at: [7, 1], mark: 'S', name: '開放座位的監視器' }, { id: 'S2', at: [7, 5], mark: 'S', name: '接待區的監視器' },
  ],
  spots: [{ id: '!1', at: [6, 2], cover: 'dense' }, { id: '!2', at: [2, 2], cover: 'one_sided' }],
  controls: [
    { id: 'C1', at: [2, 3], zones: ['c', 'd'], node: 'cn_back_half', devices: ['light', 'safe_lock'] },
    { id: 'C2', at: [5, 7], zones: ['a', 'b'], node: 'cn_front_half', devices: ['door', 'camera'] },
  ],
  patrols: [{ guard: 'G2', route: ['a', 'b', 'a', 'd'] }],
}
const MAP = { id: 'map_office_small', kind: 'office_small', size: [9, 9], sheets: [OFFICE] }

const SKILLS = [
  { id: 'firearms', attr: 'reflex' }, { id: 'brawl', attr: 'body' }, { id: 'composure', attr: 'resolve' }, { id: 'stealth', attr: 'reflex' }, { id: 'negotiate', attr: 'charm' },
  { id: 'seduce', attr: 'charm' }, { id: 'perform', attr: 'charm' }, { id: 'mechanics', attr: 'tech' }, { id: 'interface', attr: 'intellect' }, { id: 'athletics', attr: 'body' },
].map((s) => ({ ...s, name: s.id, desc: `${s.id}。` }))
const WEAPONS = [{ id: 'pistol', name: '手槍', dice: 3, type: 'physical', range: [1, 4], mag: 2, cover_mult: 0.25, pierce: 0, traits: [], attr: 'reflex', skill: 'firearms' }]
const FACTIONS = ['hizakura', 'nora'].map((id) => ({ id, name: id, short: id, class: 'corp' }))
/** 一碰就倒的假兵種（生命減半、迴避與攻擊壓低）：測試只關心「打贏」；主角拿一把骰數特別多的槍。 */
const enemy = (id: string, rank: string, faction = 'hizakura'): Rec => ({
  id, name: `${faction}的${rank}`, desc: '測試用的敵人。', faction, rank, grades: [1, 5], kind: 'human', mods: { hp: 0.5, evade: -30, attack: -8 },
  position: { prefer: [1, 2], cover_use: 0.5 }, mode: 'lethal', weapons: [{ class: 'pistol' }], ai: { prefer: 'weakest', focus: 1, flee_below: 0 },
})
const ENEMIES = [enemy('en_cm_hz_mook', 'minion'), enemy('en_cm_hz_elite', 'elite'), enemy('en_cm_hz_boss', 'boss'), enemy('en_cm_nr_mook', 'minion', 'nora')]

const branch = (id: string, kind: string, entry: string, need?: Rec) => ({ id, kind, entry, ...(need ? { need } : {}) })
/** 三階段的假副本（小規模）。主面現實；第一階段另開了內海面；最後一個階段要拿到東西、帶到撤離點。 */
const DEF = {
  id: 'cm_t1', name: '測試用的副本', kind: 'steal_item', main: 'meat', scale: 'small', grade: 3, target_faction: 'hizakura', employer: 'nora', district: 'glass_shore',
  conditions: ['no_kill'], defeat_event: 'df_custom', modifiers: ['shift_change'],
  stages: [
    {
      name: '外圍',
      faces: {
        meat: {
          map: 'map_office_small', encounter: ['minion', 'minion', 'elite'], post: 'G1', gives: 'badge',
          branches: [
            branch('assault', 'assault', 'E3'), branch('duct', 'stealth', 'E1', { basic: 'stealth', level: 2 }), branch('bribe', 'talk', 'E1', { cash: 50 }),
            branch('shift_gap', 'scouted', 'E1', { scouted: 'shift_table' }),
          ],
        },
        net: { layer: 'guest', encounter: ['minion'], gives: 'cred', branches: [{ id: 'assault', kind: 'assault' }] },
      },
    },
    {
      faces: {
        meat: {
          map: 'map_office_small', encounter: ['minion', 'minion', 'elite'], post: 'G1', gives: 'quiet',
          branches: [branch('assault', 'assault', 'E3'), branch('badge_door', 'linked', 'E1', { link: 'badge' })],
        },
      },
    },
    {
      name: '決定性的一步',
      faces: {
        meat: {
          map: 'map_office_small', encounter: ['boss', 'minion', 'minion'], post: 'G1', goal: { kind: 'take', at: 'T3' },
          branches: [branch('assault', 'assault', 'E2')],
        },
      },
    },
  ],
  links: {
    badge: { type: 'skip', name: '員工證', effect: { encounter_half: true } },
    cred: { type: 'open', name: '員工憑證' },
    quiet: { type: 'ease', name: '摸清了樓層', effect: { stage: 3, alert_frozen: true, alert_start: -10 } },
  },
}

/** 三階段都有潛行的路（每個階段都打一場遭遇）：全部潛行成功的路線用它。 */
const stealthStage = (name: string) => ({
  name,
  faces: { meat: { map: 'map_office_small', encounter: ['minion'], post: 'G1', branches: [branch('assault', 'assault', 'E3'), branch('duct', 'stealth', 'E1', { basic: 'stealth', level: 2 })] } },
})
const DEF2 = {
  id: 'cm_t2', name: '全程潛行的副本', kind: 'steal_item', main: 'meat', scale: 'small', grade: 1, target_faction: 'hizakura', district: 'glass_shore',
  stages: [stealthStage('外圍'), stealthStage('中段'), stealthStage('決定性的一步')], links: {},
}
/** 沒有自訂戰敗事件的（戰敗用通用的那一件，不算失敗）、自訂了而且寫明不算失敗的。 */
const { defeat_event: _unused, ...DEF_BASE } = DEF
const DEF_GENERIC = { ...DEF_BASE, id: 'cm_t3', name: '沒有自訂戰敗事件' }
const DEF_NOFAIL = { ...DEF, id: 'cm_t4', name: '自訂了不算失敗的戰敗事件', defeat_event: 'df_nofail' }

const PACK: ContentPack = {
  id: 'm2_commission_run',
  content: {
    skill: SKILLS, weapon_class: WEAPONS, faction: FACTIONS, special_map: [MAP as never], enemy: ENEMIES as never,
    commission: [DEF as never, DEF2 as never, DEF_GENERIC as never, DEF_NOFAIL as never],
    defeat_event: [
      { id: 'df_nofail', name: '副本自訂、不算失敗', kind: 'custom', factions: [], fails_commission: false, versions: { default: { text: '你被丟在巷口。', effects: [] } } },
      { id: 'df_generic', name: '醒在巷子裡', kind: 'generic', factions: [], fails_commission: false, default: true, versions: { default: { text: '你醒來的時候人在巷子裡。', effects: [] } } },
      { id: 'df_custom', name: '副本自訂的戰敗', kind: 'custom', factions: [], fails_commission: true, versions: { default: { text: '你被帶走了。', effects: [] } } },
    ],
  },
}


// ---- 替身 ----

const GEAR = { id: 'test_gear', install(k: { battle: { loadout(o: string, fn: () => unknown): void } }) { k.battle.loadout('test_gear', () => ({ weapons: [testWeapon('pistol', 5, 30)] })) } }
const STRONG = { attrs: { tech: 20, intellect: 20, body: 20, reflex: 20, charm: 20 }, skills: { mechanics: 5, interface: 5, athletics: 5, stealth: 3, negotiate: 3 } }

/** 敵對值的量表（security 的功能不 import：照 ADR 0016 第三節的定義寫一份）。 */
const HOSTILITY = meterFeature(testMeter({ kind: 'hostility', owner: 'test_security', name: '敵對值', keyed: 'faction', min: 0, max: 100, start: 0, cap: { down: 10, up: 10 } }))
/** 歷練點的效果（abilities 還沒有登記它）：記在計數器 xp 上。 */
const XP: Feature = {
  id: 'xp_stub',
  install(k) {
    k.effects.register<Effect & { amount: number }>({
      kind: XP_EFFECT, owner: 'xp_stub',
      validate: (raw) => (Number.isSafeInteger(raw.amount) ? [] : ['amount 要是整數']),
      toChanges: (e) => [{ op: 'counter', key: 'xp', delta: e.amount }],
      describe: (e) => `歷練點 +${e.amount}`,
    })
  },
}

/** 掛在 activity.end 上的觀察者（發起的人）：記下被叫到什麼。 */
const SEEN: { ends: Array<{ kind: string; outcome: string; origin: Rec; result: Rec }> } = { ends: [] }
const OBSERVER: Feature = {
  id: 'observer',
  install(k) {
    k.hooks.on('activity.end', 'observer', ({ kind, outcome, origin, result }) => { SEEN.ends.push({ kind, outcome, origin: origin as never, result }) })
  },
}

interface Opts { seed?: number; features?: Feature[]; pc?: Rec; content?: ContentPack[]; patch?: Partial<GameState> | { rules: Rec } }
function setup(o: Opts = {}) {
  SEEN.ends.length = 0
  return makeGame({
    seed: o.seed, features: [exploreFeature, enemiesFeature, defeatFeature, TEST_COMBAT, GEAR as never, commissionFeature, HOSTILITY, XP, OBSERVER, ...(o.features ?? [])],
    content: o.content ?? [PACK], pc: (o.pc ?? STRONG) as never, ...(o.patch ? { patch: o.patch as never } : {}),
  })
}
type G = ReturnType<typeof setup>['game']

const origin = { by: 'fixer', ref: 'fx_1' }
const enter = (g: G, def = 'cm_t1', extra: Rec = {}) => g.launch('commission', { def, ...extra }, origin)
const view = (g: G) => commissionView(g.k, g.state)!
const runOf = (g: G) => readRun(g.state)!
const face = (g: G) => g.commit(chooseFace(g.k, g.state, 'meat'))
const pick = (g: G, id: string) => g.commit(chooseBranch(g.k, g.state, id))
/** 測試自己動手改狀態（在副本裡也放行：副本自己的報告前綴）。 */
const commit = (g: G, changes: Array<Rec>) => g.commit({ kind: 'system', action: 'commission.test', location: {}, party: [], timeline: [], changes: changes as never, outcome: { result: 'ok', summary: '測試' } })
const minutes = (g: G) => toMinutes(g.state.time)
const hostilityOf = (g: G) => meterOf(g.k, g.state, 'hostility', 'hizakura')
const endOf = (kind = 'commission') => SEEN.ends.filter((e) => e.kind === kind)

async function fightHere(g: G, from: 'front' | 'window' = 'front'): Promise<void> {
  if (from === 'front') expect(g.gridMove([6, 3]).status).toBe('applied')
  expect(g.battle).not.toBeNull()
  expect(playOut(g).outcome).toBe('win')
  await g.finishBattle()
}
async function playFight(g: G, branchId = 'assault'): Promise<void> {
  face(g)
  pick(g, branchId)
  await fightHere(g, branchId === 'assault' ? 'front' : 'window')
}
/** 第三階段：拿到東西再走到撤離點。 */
function playTake(g: G): void {
  face(g)
  pick(g, 'assault')
  expect(g.gridMove([1, 5]).status).toBe('applied')
  g.commit(exploreFeature.useHere(g.k, g.state, 'take'))
  g.gridMove([1, 7])
}

/** 測試自己發一個接受戰敗的 activity.end（照 defeat 的格式：origin 是這件委託發起的那一場，result 是 { battle, event, kind, fails_commission, option }），併進一份 defeat.accept 的報告。 */
function acceptStub(g: G, fails: boolean, over: Rec = {}): Report[] {
  const run = runOf(g)
  const end = endActivity(g.k, {
    state: g.state, kind: 'defeat', id: 'b_stub', origin: { by: 'commission', ext: { commission: run.def.id, stage: run.stage, face: 'meat' }, ...over },
    outcome: 'accept', result: { battle: 'b_stub', event: 'df_stub', kind: 'custom', fails_commission: fails, option: 'done' },
  })
  return g.commit(attachActivityEnd({
    kind: 'event', action: 'defeat.accept', location: {}, party: [], timeline: [], changes: end.changes,
    outcome: { result: 'accepted', summary: '接受了。' }, narration: { results: end.lines },
  } as never, end))
}

// ===================================================================================================================

const R = DEFAULT_COMMISSION_RULES
const pass = (stage: number): Rec => ({ stage, face: 'meat', branch: 'duct', kind: 'stealth', roll: 'pass', stealth: true })
const assault = (stage: number): Rec => ({ stage, face: 'meat', branch: 'assault', kind: 'assault' })
const mockRun = (route: Rec[], links = 0, faction = 'hizakura') =>
  ({ def: { target_faction: faction }, route, links: Array.from({ length: links }, (_, i) => ({ id: `l${i}`, from: 1, face: 'meat' })) }) as never

describe('評價（G16）：從 B 起算，四級', () => {
  it('每個潛行或交涉成功的階段 +1、三個以上連動 +1、警戒最後在 60 以上 −1、到過 100 再 −1；夾在 C～S 之內', () => {
    const at = (route: Rec[], links: number, alert = 0, peak = alert) => rate(mockRun(route, links), R, alert, peak)
    expect(RATINGS).toEqual(['C', 'B', 'A', 'S'])
    expect(at([], 0)).toMatchObject({ rating: 'B', parts: { stealth: 0, links: 0, alert: 0, peak: 0, score: 0 } })
    expect(at([assault(1), assault(2), assault(3)], 0).rating).toBe('B')
    expect(at([pass(1)], 0).rating).toBe('A')
    expect(at([pass(1), pass(2)], 0).rating).toBe('S')
    expect(at([pass(1), pass(2), pass(3)], 0).rating).toBe('S')
    // 交涉成功一樣算；沒過的不算
    expect(at([{ stage: 1, face: 'meat', branch: 'bribe', kind: 'talk', roll: 'pass', stealth: true }], 0).rating).toBe('A')
    expect(at([{ stage: 1, face: 'meat', branch: 'duct', kind: 'stealth', roll: 'fail' }], 0).rating).toBe('B')
    expect(at([], 2).rating).toBe('B')
    expect(at([], 3).rating).toBe('A')
    expect(at([], 0, 59).rating).toBe('B')
    expect(at([], 0, 60).rating).toBe('C')
    expect(at([], 0, 0, 100)).toMatchObject({ rating: 'C', parts: { alert: 0, peak: -1 } })
    expect(at([], 0, 100, 100)).toMatchObject({ rating: 'C', parts: { alert: -1, peak: -1, score: -2 } })
    expect(at([pass(1), pass(2)], 3, 60).rating).toBe('S')
    expect(at([pass(1)], 0, 100, 100).rating).toBe('C')
  })
})

describe('路線的後果：目標勢力的敵對值', () => {
  it('有階段走了現實 +5，每個強攻的階段再 +3，最多 +15；潛行或交涉成功的階段不算走了現實', () => {
    const f = (route: Rec[], faction?: string) => fallout(mockRun(route, 0, faction), R)
    expect(f([assault(1), assault(2), assault(3)])).toEqual({ faction: 'hizakura', delta: 14, reality: 3, assault: 3 })
    expect(f([assault(1)]).delta).toBe(8)
    expect(f([assault(1), assault(2), assault(3), assault(4), assault(5)]).delta).toBe(15)
    expect(f([pass(1), pass(2), pass(3)])).toEqual({ faction: 'hizakura', delta: 0, reality: 0, assault: 0 })
    expect(f([pass(1), assault(2), pass(3)]).delta).toBe(8)
    // 潛行沒過、照強攻走：算強攻；連動開出來的路走了現實但不是強攻：只有基礎的 +5
    expect(f([{ stage: 1, face: 'meat', branch: 'duct', kind: 'stealth', roll: 'fail' }]).delta).toBe(8)
    expect(f([{ stage: 1, face: 'meat', branch: 'badge_door', kind: 'linked' }]).delta).toBe(5)
    // 別的面不算現實；沒有目標勢力不加
    expect(f([{ stage: 1, face: 'net', branch: 'assault', kind: 'assault' }]).delta).toBe(0)
    expect(f([assault(1)], 'none')).toMatchObject({ faction: null, delta: 0 })
  })
})

describe('歷練點：照規模固定給，不看評價，乘存檔規則的歷練倍率', () => {
  it('小 20、中 35、大 60；倍率 2 時小型是 40；沒有這個規模是 0', () => {
    const { game } = setup()
    expect(['small', 'medium', 'large'].map((s) => xpFor(game.state, R, s))).toEqual([20, 35, 60])
    const double = setup({ patch: { rules: { xpMult: 2 } } }).game
    expect(xpFor(double.state, R, 'small')).toBe(40)
    expect(xpFor(double.state, R, 'large')).toBe(120)
    expect(xpFor(setup({ patch: { rules: { xpMult: 0.5 } } }).game.state, R, 'medium')).toBe(18)
    expect(xpFor(game.state, R, 'huge')).toBe(0)
  })

  /** 在副本裡直接把狀態改成「全部做完」（只差 finish），照規模換 def。 */
  function atDone(g: G, scale: string, over: Rec = {}): void {
    const run = runOf(g)
    commit(g, [{ op: 'ext', key: 'commission', value: { ...run, def: { ...run.def, scale }, step: 'done', stage: run.def.stages.length + 1, ...over } }])
  }

  it('做完時進狀態（歷練點的效果有人登記才寫）、也在結果裡；評價 S 與 C 一樣多；小型 20，倍率 2 是 40', () => {
    for (const [mult, scale, want] of [[1, 'small', 20], [2, 'small', 40], [1, 'medium', 35], [1, 'large', 60]] as const) {
      const { game } = setup({ patch: { rules: { xpMult: mult } } })
      enter(game)
      atDone(game, scale) // 狀態一變成「全部做完」，報告套用之後副本自己接 finish
      expect(game.state.counters.xp, `${scale} ×${mult}`).toBe(want)
      expect(endOf()[0]!.result).toMatchObject({ xp: want, scale })
    }
    const good = setup().game, bad = setup().game
    enter(good)
    atDone(good, 'small', { route: [pass(1), pass(2), pass(3)] })
    enter(bad)
    atDone(bad, 'small', { alert: 80, peak: 100 })
    expect([good.state.counters.xp, bad.state.counters.xp]).toEqual([20, 20])
    expect(endOf().map((e) => e.result.rating)).toEqual(['S', 'C'])
  })

  it('沒有人登記歷練點的效果（abilities 沒裝）：照樣做完，只是結果裡有數字、狀態沒有', () => {
    const t = makeGame({ features: [exploreFeature, enemiesFeature, defeatFeature, TEST_COMBAT, GEAR as never, commissionFeature, HOSTILITY, OBSERVER], content: [PACK], pc: STRONG as never })
    SEEN.ends.length = 0
    enter(t.game)
    atDone(t.game, 'small')
    expect(t.game.state.counters.xp).toBeUndefined()
    expect(endOf()[0]!.result).toMatchObject({ xp: 20 })
  })
})

describe('做完（finish）：評價、路線的後果、歷練點，再發 activity.end', () => {
  it('三個階段都強攻做完：評價 B、目標勢力的敵對值 +5 + 9 = 14（夾在 15 之內）、歷練點 20；result 帶著進來時的 terms，原樣不動', async () => {
    const { game } = setup()
    const terms = { pay: 900, split: { fixer: 0.1 }, employer: 'nora', list: [1, 2, { deep: true }] }
    enter(game, 'cm_t1', { terms })
    await playFight(game)
    // 畫面的預估：一個強攻的階段做完之後，B、+8、20 點
    expect(view(game).close).toMatchObject({ rating: 'B', fallout: { faction: 'hizakura', delta: 8, reality: 1, assault: 1 }, xp: 20 })
    await playFight(game)
    playTake(game)
    expect(readRun(game.state)).toBeNull()
    expect(hostilityOf(game)).toBe(14)
    expect(game.state.counters.xp).toBe(20)
    const done = endOf()
    expect(done).toHaveLength(1)
    expect(done[0]).toMatchObject({ outcome: 'done', origin })
    expect(done[0]!.result).toMatchObject({
      commission: 'cm_t1', kind: 'steal_item', scale: 'small', grade: 3, target_faction: 'hizakura', links: ['badge', 'quiet'], rating: 'B', xp: 20,
      hostility: { faction: 'hizakura', delta: 14, reality: 3, assault: 3 },
    })
    expect(done[0]!.result.terms).toEqual(terms)
    expect((done[0]!.result.route as Rec[]).map((r) => [r.stage, r.branch])).toEqual([[1, 'assault'], [2, 'assault'], [3, 'assault']])
    // 做完的那一份報告：句子裡有評價與敵對值
    const fin = game.state.reports.find((r) => r.action === 'commission.finish')!
    expect(fin.narration?.results?.join('')).toMatch(/評價 B/)
  })

  it('全部走潛行並且成功：評價升兩級（S）、敵對值不加；歷練點一樣', async () => {
    let g: G | null = null
    for (let seed = 1; seed <= 60 && !g; seed++) {
      const t = setup({ seed }).game
      enter(t, 'cm_t2')
      let ok = true
      for (let n = 0; n < 3 && ok; n++) {
        face(t)
        pick(t, 'duct')
        ok = runOf(t).route.at(-1)!.roll === 'pass'
        if (ok) {
          t.gridMove('south') // 潛行的一段不開打：走到遭遇的地方就算過了這一場，自動有里程碑
          t.gridMove('south')
        }
      }
      if (ok) g = t
    }
    expect(g, '找不到三次潛行都成功的種子').not.toBeNull()
    const game = g!
    expect(readRun(game.state)).toBeNull()
    expect(hostilityOf(game)).toBe(0)
    expect(game.state.counters.xp).toBe(20)
    expect(endOf()[0]!.result).toMatchObject({ rating: 'S', xp: 20, hostility: { delta: 0, reality: 0 } })
    expect((endOf()[0]!.result.route as Rec[]).every((r) => r.roll === 'pass')).toBe(true)
  })

  it('潛行成功一個階段：預估的評價升一級、不留敵對值（畫面先看得到）', async () => {
    let seen: Rec | null = null
    for (let seed = 1; seed <= 60 && !seen; seed++) {
      const g = setup({ seed }).game
      enter(g, 'cm_t2')
      face(g)
      pick(g, 'duct')
      if (runOf(g).route.at(-1)!.roll !== 'pass') continue
      seen = view(g).close as never
    }
    expect(seen).toMatchObject({ rating: 'A', fallout: { delta: 0, reality: 0 }, parts: { stealth: 1 } })
  })

  it('撤退不發評價也不算後果：activity.end 是 retreat，結果裡沒有 rating 與 xp；敵對值與歷練點都沒動', async () => {
    const { game } = setup()
    enter(game)
    await playFight(game)
    game.commit(retreat(game.k, game.state))
    expect(endOf()[0]).toMatchObject({ outcome: 'retreat' })
    expect(endOf()[0]!.result.rating).toBeUndefined()
    expect(hostilityOf(game)).toBe(0)
    expect(game.state.counters.xp).toBeUndefined()
    expect(failedOf(game.state)).toBeNull()
  })

  it('沒有人定義敵對值的量表（security 沒裝）：照樣做完，不寫敵對值', async () => {
    const t = makeGame({ features: [exploreFeature, enemiesFeature, defeatFeature, TEST_COMBAT, GEAR as never, commissionFeature, XP, OBSERVER], content: [PACK], pc: STRONG as never })
    SEEN.ends.length = 0
    enter(t.game)
    await playFight(t.game)
    await playFight(t.game)
    playTake(t.game)
    expect(endOf()[0]!.result).toMatchObject({ rating: 'B', hostility: { delta: 14 } })
    expect(meterOf(t.game.k, t.game.state, 'hostility', 'hizakura')).toBe(0)
  })

  it('規則的數字可以用資料蓋掉（commission_rule/default）：歷練點與敵對值', async () => {
    const rule = { id: 'default', xp_small: 50, hostility_base: 1, hostility_per_assault: 1, hostility_max: 9 }
    const { game } = setup({ content: [{ ...PACK, content: { ...PACK.content, commission_rule: [rule] } }] })
    enter(game)
    await playFight(game)
    await playFight(game)
    playTake(game)
    expect(hostilityOf(game)).toBe(4)
    expect(game.state.counters.xp).toBe(50)
  })
})

describe('戰敗被接受：委託失敗並回到入口（測試自己發的 activity.end）', () => {
  it('fails_commission 是 true：時間、錢、背包回到進去之前；委託不再進行；接著收到 outcome failed；紀錄還在並標成被收回', async () => {
    const { game } = setup({ patch: { money: { cred: 100, cash: 500 }, inventory: [{ id: 'it_x', qty: 2 }] } as never })
    const before = { time: game.state.time, money: { ...game.state.money }, inventory: JSON.parse(JSON.stringify(game.state.inventory)), flags: { ...game.state.flags } }
    enter(game, 'cm_t1', { terms: { pay: 900 } })
    await playFight(game)
    commit(game, [{ op: 'cash', delta: -200 }, { op: 'item', id: 'it_y', qty: 1 }, { op: 'flag', key: 'in_there', value: true }])
    face(game)
    pick(game, 'assault')
    expect(minutes(game)).toBeGreaterThan(toMinutes(before.time))
    SEEN.ends.length = 0

    const reports = acceptStub(game, true)
    expect(reports[0]).toMatchObject({ action: 'defeat.accept', retracted: true })
    expect(reports.at(-1)!.action).toBe('rewind')
    // 回到進去之前
    expect(game.state.time).toEqual(before.time)
    expect(game.state.money).toEqual(before.money)
    expect(game.state.inventory).toEqual(before.inventory)
    expect(game.state.flags).toEqual(before.flags)
    expect(readRun(game.state)).toBeNull()
    expect(game.k.activity.active(game.state)).toEqual([])
    expect(game.state.maps.at).toBeNull()
    expect(Object.keys(game.state.maps.instances)).toEqual([])
    expect(game.state.snapshots).toEqual([])
    expect(game.blockOf('commit:trade.checkout')).toBeNull()
    // 戰敗那一頭先收到，接著是 outcome failed；result 帶著 terms、路線、連動，評價最低、沒有歷練點
    expect(SEEN.ends.map((e) => [e.kind, e.outcome])).toEqual([['defeat', 'accept'], ['commission', 'failed']])
    const failed = SEEN.ends[1]!
    expect(failed.origin).toEqual(origin)
    expect(failed.result).toMatchObject({ commission: 'cm_t1', scale: 'small', grade: 3, target_faction: 'hizakura', links: ['badge'], rating: 'C', xp: 0 })
    expect(failed.result.terms).toEqual({ pay: 900 })
    expect((failed.result.route as Rec[]).map((r) => r.branch)).toEqual(['assault', 'assault'])
    // 路線的後果與歷練點跟著回去：不留
    expect(hostilityOf(game)).toBe(0)
    expect(game.state.counters.xp).toBeUndefined()
    // 紀錄還在：進去、階段、里程碑、戰敗都留著，標成被收回；失敗那一份在回去之後，不被收回
    const log = game.state.reports.filter((r) => r.action?.startsWith('commission.') || r.action === 'defeat.accept')
    expect(log.filter((r) => r.action !== 'commission.failed').length).toBeGreaterThan(4)
    expect(log.filter((r) => r.action !== 'commission.failed').every((r) => r.retracted)).toBe(true)
    expect(game.state.reports.filter((r) => r.action === 'commission.failed')).toMatchObject([{ outcome: { result: 'failed' } }])
    expect(game.state.reports.find((r) => r.action === 'commission.failed')!.retracted).toBeFalsy()
    // 失敗的記號留著（其餘的都回去了），已經交代過
    expect(failedOf(game.state)).toMatchObject({ commission: 'cm_t1', pending: false, result: { rating: 'C' } })
  })

  it('失敗之後再問 commissionView 是空的；存檔往返不變；還能再進去（記號清掉）', async () => {
    const { game } = setup()
    enter(game)
    await playFight(game)
    face(game)
    pick(game, 'assault')
    acceptStub(game, true)
    expect(commissionView(game.k, game.state)).toBeNull()
    const hash = stateHash(game.state)
    const raw = game.save('manual', 't')
    expect(game.load(raw)).toBeNull()
    expect(stateHash(game.state)).toBe(hash)
    expect(commissionView(game.k, game.state)).toBeNull()
    expect(failedOf(game.state)).toMatchObject({ pending: false })
    enter(game)
    expect(runOf(game)).toMatchObject({ stage: 1, step: 'face' })
    expect(failedOf(game.state)).toBeNull()
  })

  it('第一階段就失敗也一樣；失敗那一份只發一次 activity.end（沒有重複）', async () => {
    const { game } = setup()
    const t0 = game.state.time
    enter(game)
    face(game)
    pick(game, 'assault')
    acceptStub(game, true)
    expect(game.state.time).toEqual(t0)
    expect(endOf('commission')).toHaveLength(1)
    // 之後別的回退不再重發
    enter(game)
    game.commit(retreat(game.k, game.state))
    expect(endOf('commission').map((e) => e.outcome)).toEqual(['failed', 'retreat'])
  })

  it('不是這件委託發起的戰敗（別的功能開的那一場）：不理它', async () => {
    const { game } = setup()
    enter(game)
    face(game)
    const run = runOf(game)
    const end = endActivity(game.k, { state: game.state, kind: 'defeat', id: 'b_x', origin: { by: 'caller', ext: { commission: 'someone_else', stage: run.stage } }, outcome: 'accept', result: { fails_commission: true } })
    expect(end).toMatchObject({ changes: [], lines: [] })
    expect(end.rewind).toBeUndefined()
    // 同一件委託但是別的階段的（過時的）也不理
    const stale = endActivity(game.k, { state: game.state, kind: 'defeat', id: 'b_y', origin: { by: 'core', ext: { commission: 'cm_t1', stage: 3 } }, outcome: 'accept', result: { fails_commission: true } })
    expect(stale.rewind).toBeUndefined()
    // 還沒開始玩這一段（選面的時候）不會有戰敗，也不理
    const early = endActivity(game.k, { state: game.state, kind: 'defeat', id: 'b_z', origin: { by: 'core', ext: { commission: 'cm_t1', stage: run.stage } }, outcome: 'accept', result: { fails_commission: true } })
    expect(early.rewind).toBeUndefined()
  })
})

describe('戰敗被接受：不算失敗，留在這個階段的開頭繼續', () => {
  it('fails_commission 是 false：不回退；還在同一個階段、要重新選分支；警戒與拿到的連動留著；地圖關掉', async () => {
    const { game } = setup()
    enter(game)
    await playFight(game)
    const t1 = minutes(game)
    face(game)
    pick(game, 'assault')
    const first = Object.keys(game.state.maps.instances)
    expect(first).toHaveLength(1)
    const startAlert = runOf(game).alert
    commit(game, [{ op: 'meter', kind: 'alert', key: runOf(game).map!, delta: 25 }])
    const raised = meterOf(game.k, game.state, 'alert', runOf(game).map!)
    expect(raised).toBe(startAlert + 25)
    SEEN.ends.length = 0
    const reports = acceptStub(game, false)
    expect(reports.map((r) => r.action)).toEqual(['defeat.accept'])
    expect(reports[0]!.retracted).toBeFalsy()
    // 沒有回退：時間與進度都在，沒有 failed 的 activity.end
    expect(minutes(game)).toBe(t1)
    expect(SEEN.ends.map((e) => [e.kind, e.outcome])).toEqual([['defeat', 'accept']])
    expect(failedOf(game.state)).toBeNull()
    expect(game.k.activity.active(game.state).map((a) => a.kind)).toEqual(['commission'])
    // 還在第二階段、要重新選分支；連動與警戒（地圖上漲的 25）留著
    expect(runOf(game)).toMatchObject({ stage: 2, step: 'branch', face: 'meat', alert: raised, peak: raised, links: [{ id: 'badge' }] })
    expect(runOf(game).map).toBeUndefined()
    expect(game.state.maps.at).toBeNull()
    expect(Object.keys(game.state.maps.instances)).toEqual([])
    const v = view(game)
    expect(v).toMatchObject({ stage: 2, step: 'branch', alert: { value: raised } })
    expect(v.links.map((l) => l.id)).toEqual(['badge'])
    // 這個階段選過的路線拿掉了（它要重選），第一階段的還在
    expect(runOf(game).route.map((r) => r.stage)).toEqual([1])
    // 重新選分支：新的地圖、遭遇重新放、警戒從漲過的值起算
    pick(game, 'assault')
    const second = Object.keys(game.state.maps.instances)
    expect(second).toHaveLength(1)
    expect(second[0]).not.toBe(first[0])
    expect(meterOf(game.k, game.state, 'alert', runOf(game).map!)).toBe(raised)
    const guards = (game.state.maps.instances[runOf(game).map!]!.ext as { guards: Record<string, { foes: unknown[] }> }).guards
    expect(guards.G1!.foes).toHaveLength(2) // 三個守備，員工證讓它少一半（進位）
    expect(runOf(game).route.map((r) => r.stage)).toEqual([1, 2])
    // 照常做完
    await fightHere(game)
    expect(runOf(game).stage).toBe(3)
  })

  it('連動「警戒不漲」的那一段：回到這一段開始的警戒，不是地圖上漲的', async () => {
    const { game } = setup()
    enter(game)
    await playFight(game)
    await playFight(game)
    face(game)
    pick(game, 'assault')
    // 第三階段開始時警戒是連動 quiet 壓過的（alert_frozen）：地圖上漲 40，收回來還是這一段開始的
    const start = runOf(game).start_alert!
    expect(runOf(game).frozen).toBe(true)
    commit(game, [{ op: 'meter', kind: 'alert', key: runOf(game).map!, delta: 40 }])
    acceptStub(game, false)
    expect(runOf(game)).toMatchObject({ stage: 3, step: 'branch', alert: start })
  })

  it('副本自訂了 defeat_event 而且它寫明不算失敗：照它的（真的戰敗功能串起來，委託還在）', async () => {
    const { game } = setup()
    enter(game, 'cm_t4')
    face(game)
    pick(game, 'assault')
    game.gridMove([6, 3])
    game.state.battle!.result = { outcome: 'lose', text: '輸了。' }
    await game.finishBattle()
    expect(game.pendingDefeat).not.toBeNull()
    SEEN.ends.length = 0
    game.commit(acceptDefeat(game.k, game.state))
    expect(SEEN.ends.map((e) => [e.kind, e.outcome])).toEqual([['defeat', 'accept']])
    expect(SEEN.ends[0]!.result).toMatchObject({ event: 'df_nofail', fails_commission: false })
    expect(runOf(game)).toMatchObject({ stage: 1, step: 'branch' })
    expect(game.state.maps.at).toBeNull()
  })
})

describe('串起來的一條：在副本裡真的打輸 → 戰敗事件 → 接受 → 失敗並回到入口', () => {
  it('副本自訂的戰敗事件算失敗：接受之後委託失敗、回到進去之前，收到 outcome failed（帶戰敗的結果）', async () => {
    const { game } = setup({ patch: { money: { cred: 100, cash: 500 } } as never })
    const t0 = game.state.time
    enter(game, 'cm_t1', { terms: { pay: 1 } })
    await playFight(game)
    face(game)
    pick(game, 'assault')
    game.gridMove([6, 3])
    game.state.battle!.result = { outcome: 'lose', text: '輸了。' }
    const lost = await game.finishBattle()
    expect(lost.reports.map((x) => x.action)).toEqual(['battle.end', 'defeat.pending'])
    expect(game.pendingDefeat).not.toBeNull()
    SEEN.ends.length = 0
    const reports = game.commit(acceptDefeat(game.k, game.state))
    expect(reports.at(-1)!.action).toBe('rewind')
    expect(game.state.time).toEqual(t0)
    expect(game.state.money).toMatchObject({ cred: 100, cash: 500 })
    expect(readRun(game.state)).toBeNull()
    expect(game.pendingDefeat).toBeNull()
    expect(game.battle).toBeNull()
    expect(game.k.activity.active(game.state)).toEqual([])
    expect(game.state.snapshots).toEqual([])
    expect(SEEN.ends.map((e) => [e.kind, e.outcome])).toEqual([['defeat', 'accept'], ['commission', 'failed']])
    expect(SEEN.ends[0]!.result).toMatchObject({ event: 'df_custom', fails_commission: true })
    expect(SEEN.ends[1]).toMatchObject({ origin, result: { commission: 'cm_t1', rating: 'C', xp: 0, defeat: { event: 'df_custom' } } })
    expect(SEEN.ends[1]!.result.terms).toEqual({ pay: 1 })
    expect(game.state.reports.some((r) => r.action === 'battle.end' && r.retracted)).toBe(true)
    expect(commissionView(game.k, game.state)).toBeNull()
  })

  it('通用的戰敗事件不算失敗：接受之後還在這個階段、要重新選分支，再走完整件委託', async () => {
    const { game } = setup()
    enter(game, 'cm_t3')
    await playFight(game)
    face(game)
    pick(game, 'assault')
    game.gridMove([6, 3])
    game.state.battle!.result = { outcome: 'surrender', text: '投降了。' }
    await game.finishBattle()
    SEEN.ends.length = 0
    game.commit(acceptDefeat(game.k, game.state))
    expect(SEEN.ends.map((e) => [e.kind, e.outcome])).toEqual([['defeat', 'accept']])
    expect(SEEN.ends[0]!.result).toMatchObject({ event: 'df_generic', fails_commission: false })
    expect(runOf(game)).toMatchObject({ stage: 2, step: 'branch', links: [{ id: 'badge' }] })
    expect(game.battle).toBeNull()
    pick(game, 'assault')
    await fightHere(game)
    playTake(game)
    expect(readRun(game.state)).toBeNull()
    expect(endOf().map((e) => e.outcome)).toEqual(['done'])
    expect(endOf()[0]!.result).toMatchObject({ rating: 'B', hostility: { delta: 14 } })
  })
})

describe('喘口氣不影響結算', () => {
  it('階段之間喘一口氣不改路線、連動與評價', async () => {
    const { game } = setup()
    enter(game)
    await playFight(game)
    const before = view(game).close
    game.commit(breathe(game.k, game.state))
    expect(view(game).close).toEqual(before)
    expect(HOSTILITY_EFFECT).toBe('hostility')
  })
})
