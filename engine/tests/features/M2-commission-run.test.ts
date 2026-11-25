// 驗收測試：dev/work/M2-commission-run.md（cpp-feature）。委託副本本體：進去、階段、面、分支、現實面的一段、里程碑、連動、警戒、喘口氣、撤退、做完。
// 規格：COMMISSIONS 2.3、第 3～5 節、6.2 節、第 11 節；SERIES 第 6 節；SITES 12.5 節（DC 基準 10 ＋ 等級 × 2、警戒的門檻）；UI 7.4 節；
// dev/adr/0016 第一、二、五、六節與 G2、G7、G9、G12。
// 內容一律是測試自帶的最小假資料：一件三階段的假副本、DATA 9.3 節的小辦公室（和探索的測試同一張）、三個假兵種（緋櫻的雜兵、精英、首領；另有一個別的勢力的雜兵）。
// 輔助面的擲骰（M2-commission-aux）、做完之後的結算（M2-commission-close）、內海與輿論的玩法（M3、M5）、成人場景（M2-scene）都是這裡的替身。
//
// 擲骰的測試不假設骰面：對每個種子先算「這件事會成功或失敗」（呼叫純函式的草稿看結果），挑到要的那個種子再提交。

import { describe, expect, it } from 'vitest'
import type { Change, ContentPack, Feature, GameState, Report } from '../../src'
import { ActionBlocked, ContentError, endActivity, meterOf, toMinutes } from '../../src'
import { defeatFeature } from '../../src/features/defeat'
import { enemiesFeature } from '../../src/features/enemies'
import { exploreFeature } from '../../src/features/explore'
import {
  COMMISSION_ALLOW, breathe, checkGoal, chooseBranch, chooseFace, commissionFeature, commissionProblems, commissionView, encounterAfter, enterDraft, finish, milestone, playScene, readRun, replay, retreat,
} from '../../src/features/commission'
import { TEST_COMBAT, makeGame, observed, playOut, stateHash, testWeapon } from '../../src/testkit'

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

const PACK: ContentPack = {
  id: 'm2_commission_run',
  content: {
    skill: SKILLS, weapon_class: WEAPONS, faction: FACTIONS, special_map: [MAP as never], enemy: ENEMIES as never,
    commission: [DEF as never],
    defeat_event: [
      { id: 'df_generic', name: '醒在巷子裡', kind: 'generic', factions: [], fails_commission: false, default: true, versions: { default: { text: '你醒來的時候人在巷子裡。', effects: [] } } },
      { id: 'df_custom', name: '副本自訂的戰敗', kind: 'custom', factions: [], fails_commission: true, versions: { default: { text: '你被帶走了。', effects: [] } } },
    ],
  },
}

// ---- 替身 ----

/** 主角要有武器；檢定要強到只有自然 1 會失敗（要失敗的測試自己挑種子與難度）。 */
const GEAR = { id: 'test_gear', install(k: { battle: { loadout(o: string, fn: () => unknown): void } }) { k.battle.loadout('test_gear', () => ({ weapons: [testWeapon('pistol', 5, 30)] })) } }
const STRONG = { attrs: { tech: 20, intellect: 20, body: 20, reflex: 20, charm: 20 }, skills: { mechanics: 5, interface: 5, athletics: 5, stealth: 3, negotiate: 3 } }

/** 別的面（內海）的玩法的替身：只是登記這種活動，由測試自己送出結束。放行自己的結束報告。 */
function fakeActivity(kind: string, order: number): Feature {
  const key = `fake_${kind.replace('.', '_')}`
  return {
    id: key,
    install(k) {
      k.activity.define({
        kind, owner: key, order,
        active: (s) => (isRec(s.ext[key]) ? { id: kind, label: kind } : null),
        allow: [`commit:${key}.`], reason: () => '替身活動開著。',
        start: (_k, _state, setup, origin) => [{
          kind: 'event', action: `${key}.open`, location: {}, party: [], timeline: [],
          changes: [{ op: 'ext', key, value: { setup, origin } }], outcome: { result: 'open', summary: `${kind} 開了。` },
        }],
      })
      // 副本是白名單：別的面的玩法自己登記「開得起來」與「結束的報告放行」（M3、M5 的功能也要這樣做）
      k.activity.allow('commission', `${kind}.start`, key)
      k.activity.allow('commission', `commit:${key}.`, key)
    },
  }
}
const isRec = (v: unknown): v is Rec => typeof v === 'object' && v !== null && !Array.isArray(v)
const FAKE_NET = fakeActivity('face.net', 50)
const FAKE_SCENE = fakeActivity('scene', 20)
/** 替身活動做完：照規矩用 endActivity 發 activity.end，併進那一份結束報告。 */
function endFake(g: G, kind: string, outcome: string, result: Rec): Report[] {
  const key = `fake_${kind.replace('.', '_')}`
  const open = g.state.ext[key] as { origin: never }
  const end = endActivity(g.k, { state: g.state, kind, id: kind, origin: open.origin, outcome, result })
  return g.commit({
    kind: 'event', action: `${key}.close`, location: {}, party: [], timeline: [], changes: [{ op: 'ext', key, value: null }, ...end.changes],
    outcome: { result: outcome, summary: `${kind} 結束了。` },
  })
}

/** 掛在 rest.done 與 activity.end 上的觀察者：記下被叫到什麼。 */
const SEEN: { rest: string[]; ends: Array<{ kind: string; outcome: string; origin: Rec; result: Rec }> } = { rest: [], ends: [] }
const OBSERVER: Feature = {
  id: 'observer',
  install(k) {
    k.hooks.on('rest.done', 'observer', ({ kind }) => { SEEN.rest.push(kind); return [{ op: 'flag', key: 'rested', value: kind }] })
    k.hooks.on('activity.end', 'observer', ({ kind, outcome, origin, result }) => { SEEN.ends.push({ kind, outcome, origin: origin as never, result }) })
  },
}

interface Opts { seed?: number; features?: Feature[]; pc?: Rec; content?: ContentPack[]; patch?: Partial<GameState> }
function setup(o: Opts = {}) {
  SEEN.rest.length = 0
  SEEN.ends.length = 0
  const t = makeGame({
    seed: o.seed, features: [exploreFeature, enemiesFeature, defeatFeature, TEST_COMBAT, GEAR as never, commissionFeature, OBSERVER, ...(o.features ?? [])],
    content: o.content ?? [PACK], pc: (o.pc ?? STRONG) as never, ...(o.patch ? { patch: o.patch } : {}),
  })
  return t
}
type G = ReturnType<typeof setup>['game']

const origin = { by: 'fixer', ref: 'fx_1' }
const enter = (g: G, extra: Rec = {}, def: unknown = 'cm_t1') => g.launch('commission', { def, ...extra }, origin)
const view = (g: G) => commissionView(g.k, g.state)!
const runOf = (g: G) => readRun(g.state)!
const face = (g: G, f: 'meat' | 'net' | 'opinion' = 'meat') => g.commit(chooseFace(g.k, g.state, f))
const pick = (g: G, id: string) => g.commit(chooseBranch(g.k, g.state, id))
const instance = (g: G, id = runOf(g).map!) => g.state.maps.instances[id]!
const extOf = (g: G) => (instance(g).ext ?? {}) as Rec
const guardFoes = (g: G) => ((extOf(g).guards as Rec).G1 as { foes: Rec[]; faction: string }).foes
const alertOf = (g: G, id = runOf(g).map!) => meterOf(g.k, g.state, 'alert', id)
/** 測試自己動手改狀態（在副本裡也放行：副本自己的報告前綴）。 */
const commit = (g: G, changes: Change[]) => g.commit({ kind: 'system', action: 'commission.test', location: {}, party: [], timeline: [], changes, outcome: { result: 'ok', summary: '測試' } })
const commitAs = (g: G, action: string) => g.commit({ kind: 'system', action, location: {}, party: [], timeline: [], changes: [], outcome: { result: 'ok', summary: '測試' } })
const stand = (g: G, x: number, y: number) => commit(g, [{ op: 'map.at', to: { map: runOf(g).map!, sheet: 'office', x, y } }])
const minutes = (g: G) => toMinutes(g.state.time)

/** 走到保全那一格附近開打（從正門 E3），打贏、結算。 */
async function fightHere(g: G, from: 'front' | 'window' = 'front'): Promise<Report[]> {
  if (from === 'front') expect(g.gridMove([6, 3]).status).toBe('applied')
  expect(g.battle).not.toBeNull()
  expect(playOut(g).outcome).toBe('win')
  return (await g.finishBattle()).reports
}
/** 一個階段從頭打完：選面、選分支、打贏遭遇。 */
async function playFight(g: G, branchId = 'assault'): Promise<Report[]> {
  face(g)
  pick(g, branchId)
  return fightHere(g, branchId === 'assault' ? 'front' : 'window')
}
/** 第三階段：拿到東西再走到撤離點。 */
function playTake(g: G): Report[] {
  face(g)
  pick(g, 'assault')
  expect(g.gridMove([1, 5]).status).toBe('applied')
  g.commit(exploreFeature.useHere(g.k, g.state, 'take'))
  return g.gridMove([1, 7]).reports
}

/** 第一個讓 want 成立的種子（種子不同，同一件事的骰面不同）。 */
function seedWhere(opts: Opts, want: (g: G) => boolean): number {
  for (let seed = 1; seed <= 300; seed++) if (want(setup({ ...opts, seed }).game)) return seed
  throw new Error('找不到合適的種子')
}
/** 這個分支擲出來是過還是沒過（只看草稿，不提交）。 */
const rollOf = (id: string) => (g: G): string | undefined => {
  enter(g)
  face(g)
  return chooseBranch(g.k, g.state, id).outcome.result
}

// ===================================================================================================================

describe('進去（活動 commission 的 start）', () => {
  it('第一筆變更是 entry 快照（owner 是這件委託）；狀態記下副本整筆、第一階段、還沒選面；時間不動', () => {
    const { game } = setup()
    const t0 = minutes(game)
    const reports = enter(game)
    expect(reports.map((r) => r.action)).toEqual(['commission.enter'])
    expect(reports[0]!.changes[0]).toMatchObject({ op: 'snapshot.take', kind: 'entry', owner: 'cm_t1' })
    expect(game.state.snapshots.map((s) => [s.kind, s.owner])).toEqual([['entry', 'cm_t1']])
    const run = runOf(game)
    expect(run).toMatchObject({ stage: 1, step: 'face', alert: 0, peak: 0, breathed: false, links: [], route: [] })
    expect(run.def.id).toBe('cm_t1')
    expect(run.origin).toEqual(origin)
    expect(minutes(game)).toBe(t0)
    expect(game.k.activity.active(game.state).map((a) => a.kind)).toEqual(['commission'])
  })

  it('def 可以給整筆；setup 的 alert_start、scouted、aux、terms 原樣記下（terms 帶到結束）', () => {
    const { game } = setup({ content: [{ ...PACK, content: { ...PACK.content, commission: [] } }] })
    enter(game, { alert_start: 15, scouted: { stages: [2], branches: ['shift_table'], guards: [1] }, aux: { net: ['npc_a'] }, terms: { pay: 900 } }, DEF)
    expect(runOf(game)).toMatchObject({ alert: 15, peak: 15, setup: { scouted: { stages: [2], branches: ['shift_table'], guards: [1] }, aux: { net: ['npc_a'] }, terms: { pay: 900 } } })
  })

  it('開不成：已經在副本裡、沒有這件委託、整筆的資料有問題、alert_start 不合格；開不成的什麼都不留', () => {
    const { game } = setup()
    expect(() => game.launch('commission', { def: 'cm_nobody' }, origin)).toThrow(/沒有 cm_nobody/)
    expect(() => game.launch('commission', { def: { id: 'cm_bad', kind: 'x' } }, origin)).toThrow(/資料有問題/)
    expect(() => game.launch('commission', { def: 'cm_t1', alert_start: 500 }, origin)).toThrow(/alert_start/)
    expect(() => game.launch('commission', {}, origin)).toThrow(ActionBlocked)
    expect(game.state.snapshots).toEqual([])
    expect(readRun(game.state)).toBeNull()
    enter(game)
    expect(() => enter(game)).toThrow(/進行中，只能做副本裡的事/) // 開活動自己就問放行：副本進行中什麼活動都開不了
    expect(() => enterDraft(game.k, game.state, { def: 'cm_t1' }, origin)).toThrow(/已經在一件委託的副本裡/)
    expect(game.state.snapshots).toHaveLength(1)
  })

  it('一個可選的面都沒有的階段：在 start 就擋下（只開了還沒有登記的內海面）', () => {
    const bad = JSON.parse(JSON.stringify(DEF)) as typeof DEF
    bad.stages[1] = { faces: { net: { layer: 'core', encounter: [], gives: 'cred', branches: [{ id: 'assault', kind: 'assault' }] } } } as never
    const { game } = setup({ content: [{ ...PACK, content: { ...PACK.content, commission: [] } }] })
    expect(() => enter(game, {}, bad)).toThrow(/第 2 階段沒有選得了的面.*內海/)
    expect(readRun(game.state)).toBeNull()
    // 內海的玩法登記了，就進得去
    const ok = setup({ features: [FAKE_NET], content: [{ ...PACK, content: { ...PACK.content, commission: [] } }] })
    expect(() => enter(ok.game, {}, bad)).not.toThrow()
  })

  it('遭遇要挑敵人卻沒有 enemy_pick 這種來源（沒裝敵人的功能）：在 start 就擋下', () => {
    const t = makeGame({ features: [exploreFeature, TEST_COMBAT, commissionFeature], content: [{ id: 'p', content: { skill: SKILLS, weapon_class: WEAPONS, faction: FACTIONS, special_map: [MAP as never], commission: [DEF as never] } }], pc: STRONG as never })
    expect(() => enter(t.game)).toThrow(/enemy_pick/)
  })
})

describe('進去之後只放行副本裡的事（白名單）', () => {
  it('交易、休息、接別的委託這類報告被擋下並有原因；放行清單裡的每一項都過', () => {
    const { game } = setup()
    enter(game)
    // rewind:stage、rewind:entry 也不放行（M2 修正批 2）：回到階段開始只在戰敗的三選一裡，回到入口只走撤退
    for (const doing of ['commit:trade.checkout', 'commit:rest.sleep', 'commit:fixer.accept', 'commit:world.arrive', 'commit:transit.board', 'commit:bill.settle', 'rewind:battle', 'rewind:stage', 'rewind:entry']) {
      expect(game.blockOf(doing), doing).toMatch(/進行中，只能做副本裡的事/)
    }
    for (const prefix of COMMISSION_ALLOW) expect(game.blockOf(`${prefix}x`) ?? game.blockOf(prefix), prefix).toBeNull()
    for (const doing of ['commit:commission.face', 'grid.move', 'grid.enter', 'commit:grid.use', 'battle.start', 'commit:battle.step', 'chain:battle_end', 'battle.retry', 'event.start', 'commit:event.choose',
      'scene.start', 'commit:scene.act', 'commit:defeat.accept', 'commit:capture.free', 'commit:gear.equip', 'chain:free_action']) {
      expect(game.blockOf(doing), doing).toBeNull()
    }
    // 真的提交：交易的報告丟 ActionBlocked，狀態不變
    const before = stateHash(game.state)
    expect(() => commitAs(game, 'trade.checkout')).toThrow(ActionBlocked)
    expect(() => commitAs(game, 'rest.sleep')).toThrow(/只能做副本裡的事/)
    expect(() => commitAs(game, 'fixer.accept')).toThrow(ActionBlocked)
    expect(stateHash(game.state)).toBe(before)
    // 副本自己的報告與副本裡的自由行動（G12）不擋
    expect(() => commitAs(game, 'commission.test')).not.toThrow()
  })

  it('清單就是工單寫的那十五項（十七項拿掉 rewind:stage、rewind:entry）加上 M4 的吃藥與急救兩項，一項不多（忘了登記的新功能在副本裡就是用不了）', () => {
    expect([...COMMISSION_ALLOW].sort()).toEqual([
      'battle.', 'battle.retry', 'chain:battle_end', 'chain:free_action', 'commit:battle.', 'commit:capture.', 'commit:commission.', 'commit:defeat.', 'commit:event.', 'commit:gear.',
      'commit:grid.', 'event.start', 'grid.', 'scene.start', 'commit:scene.', 'commit:drug.', 'commit:medical.',
    ].sort())
  })
})

describe('每個階段：選面 → 選分支 → 玩這一段 → 里程碑', () => {
  it('三個階段走完：每個階段時間 +120 分鐘；路線記下每個階段的面與分支；finish 之後不再擋', async () => {
    const { game } = setup()
    enter(game)
    const t0 = minutes(game)
    await playFight(game)
    expect(minutes(game)).toBe(t0 + 120)
    expect(runOf(game)).toMatchObject({ stage: 2, step: 'face' })
    await playFight(game)
    expect(minutes(game)).toBe(t0 + 240)
    const reports = playTake(game)
    expect(reports.map((r) => r.action)).toEqual(['grid.move', 'commission.milestone', 'commission.finish'])
    expect(minutes(game)).toBe(t0 + 360)
    expect(reports[1]!.time.end).toEqual(game.state.time)
    // 做完：狀態與入口、階段的快照都清掉；放行回到平常
    expect(readRun(game.state)).toBeNull()
    expect(game.state.snapshots).toEqual([])
    expect(game.k.activity.active(game.state)).toEqual([])
    expect(game.blockOf('commit:trade.checkout')).toBeNull()
    expect(game.state.maps.at).toBeNull()
    expect(Object.keys(game.state.maps.instances)).toEqual([])
    expect(() => commitAs(game, 'trade.checkout')).not.toThrow()
    // activity.end（kind commission）：路線、連動、警戒、規模、等級與 terms 交回給發起的人
    const end = SEEN.ends.find((e) => e.kind === 'commission')!
    expect(end).toMatchObject({ outcome: 'done', origin })
    expect(end.result).toMatchObject({
      commission: 'cm_t1', kind: 'steal_item', main: 'meat', scale: 'small', grade: 3, target_faction: 'hizakura', employer: 'nora', stages: 3, links: ['badge', 'quiet'],
      route: [{ stage: 1, face: 'meat', branch: 'assault', kind: 'assault' }, { stage: 2, face: 'meat', branch: 'assault', kind: 'assault' }, { stage: 3, face: 'meat', branch: 'assault', kind: 'assault' }],
    })
    expect(typeof end.result.alert).toBe('number')
    expect(end.result.peak).toBeGreaterThanOrEqual(end.result.alert as number)
  })

  it('整趟走完沒有違反任何不變式（提交的每一份報告 = 套用變更；同一個種子同一串輸入同一個結果）', async () => {
    const run = async () => {
      const { game } = setup({ seed: 21 })
      const { violations } = await observed(game, async () => {
        enter(game)
        await playFight(game)
        game.commit(breathe(game.k, game.state))
        await playFight(game)
        playTake(game)
      })
      expect(violations).toEqual([])
      return stateHash(game.state)
    }
    expect(await run()).toBe(await run())
  })

  it('terms 原樣帶到結束', async () => {
    const { game } = setup()
    enter(game, { terms: { pay: 1200, split: [1, 1] } })
    await playFight(game)
    await playFight(game)
    playTake(game)
    expect(SEEN.ends.find((e) => e.kind === 'commission')!.result.terms).toEqual({ pay: 1200, split: [1, 1] })
  })

  it('選面那一份：第一筆是 stage 快照（replace）、帶觸發點 stage（where 有類型、面、目標勢力、詞條）；選了就不能再選面', () => {
    const { game } = setup()
    enter(game)
    const [r] = face(game)
    expect(r!.changes[0]).toMatchObject({ op: 'snapshot.take', kind: 'stage', owner: 'cm_t1', replace: true })
    expect(r!.triggers).toEqual([{ point: 'stage', where: { kind: 'steal_item', face: 'meat', faction: 'hizakura', tags: ['shift_change'] } }])
    expect(runOf(game)).toMatchObject({ step: 'branch', face: 'meat' })
    expect(() => chooseFace(game.k, game.state, 'meat')).toThrow(/選分支/)
    expect(() => chooseBranch(game.k, game.state, 'nope')).toThrow(/沒有這條路/)
  })

  it('每個階段開始有一份 stage 快照，而且只有最新的一份；入口那一份一直留著', async () => {
    const { game } = setup()
    enter(game)
    const kinds = () => game.state.snapshots.map((s) => s.kind)
    expect(kinds()).toEqual(['entry'])
    face(game)
    expect(kinds()).toEqual(['entry', 'stage'])
    const first = game.state.snapshots.find((s) => s.kind === 'stage')!.id
    pick(game, 'assault')
    await fightHere(game)
    face(game)
    expect(kinds().filter((k) => k === 'stage')).toHaveLength(1)
    expect(game.state.snapshots.find((s) => s.kind === 'stage')!.id).not.toBe(first)
    expect(game.state.snapshots.find((s) => s.kind === 'stage')!.label).toMatch(/第 2 階段/)
  })

  it('次序不對、沒在副本裡都擋下，原因是一句話', () => {
    const { game } = setup()
    expect(() => chooseFace(game.k, game.state, 'meat')).toThrow(/沒有在委託的副本裡/)
    enter(game)
    expect(() => chooseBranch(game.k, game.state, 'assault')).toThrow(/先選這個階段玩哪一面/)
    expect(() => milestone(game.k, game.state)).toThrow(/先選這個階段玩哪一面/)
    expect(() => finish(game.k, game.state)).toThrow()
    face(game)
    pick(game, 'assault')
    expect(() => milestone(game.k, game.state)).toThrow(/目標還沒有達成/)
    expect(() => finish(game.k, game.state)).toThrow(/最後一個階段還沒有做完/)
  })
})

describe('面：現實面內建；別的面看有沒有人登記活動', () => {
  it('只有現實面登記時：內海的面列著但選不了，原因是「這一面還沒有開放。」；這個階段沒有開的面另有原因', () => {
    const { game } = setup()
    enter(game)
    expect(view(game).faces).toEqual([
      { face: 'meat', name: '現實', open: true, block: null, chosen: false },
      { face: 'net', name: '內海', open: true, block: '這一面還沒有開放。', chosen: false },
      { face: 'opinion', name: '輿論', open: false, block: '這個階段沒有開這一面。', chosen: false },
    ])
    expect(() => chooseFace(game.k, game.state, 'net')).toThrow('這一面還沒有開放。')
    expect(() => chooseFace(game.k, game.state, 'opinion')).toThrow('這個階段沒有開這一面。')
    expect(readRun(game.state)!.step).toBe('face')
  })

  it('最後一個階段只有主面：別的面選不了（資料也不准列別的面）', async () => {
    const { game } = setup({ features: [FAKE_NET] })
    enter(game)
    await playFight(game)
    await playFight(game)
    expect(view(game).faces.map((f) => [f.face, f.block])).toEqual([['meat', null], ['net', '這個階段沒有開這一面。'], ['opinion', '這個階段沒有開這一面。']])
    expect(() => chooseFace(game.k, game.state, 'net')).toThrow('這個階段沒有開這一面。')
  })

  it('有人登記了活動 face.net：選得了；選了分支就 launch 它、等它的 activity.end，做完自動有里程碑、拿到那一面的 gives', () => {
    const { game } = setup({ features: [FAKE_NET] })
    enter(game)
    expect(view(game).faces[1]!.block).toBeNull()
    const t0 = minutes(game)
    face(game, 'net')
    const reports = pick(game, 'assault')
    expect(reports.map((r) => r.action)).toEqual(['commission.branch', 'fake_face_net.open'])
    const open = game.state.ext.fake_face_net as { setup: Rec; origin: Rec }
    expect(open.setup).toMatchObject({ commission: 'cm_t1', stage: 1, face: 'net', branch: 'assault', grade: 3, faction: 'hizakura', layer: 'guest', encounter: ['minion'], stealth: false })
    expect(open.origin).toEqual({ by: 'commission', ref: 'cm_t1', ext: { commission: 'cm_t1', stage: 1, face: 'net' } })
    expect(runOf(game)).toMatchObject({ step: 'play', face: 'net', route: [{ stage: 1, face: 'net', branch: 'assault' }] })
    // 還沒做完：沒有里程碑；別的功能的報告照樣擋
    expect(view(game).goal).toMatchObject({ kind: 'face', done: false })
    expect(() => commitAs(game, 'trade.checkout')).toThrow(ActionBlocked)
    const done = endFake(game, 'face.net', 'done', { layer: 'guest' })
    expect(done.map((r) => r.action)).toEqual(['fake_face_net.close', 'commission.milestone'])
    expect(runOf(game)).toMatchObject({ stage: 2, step: 'face', links: [{ id: 'cred', from: 1, face: 'net' }] })
    expect(minutes(game)).toBe(t0 + 120)
  })

  it('別的面沒做完（outcome 不是 done）：這一段還在，可以再來一次（replay 再開一次那個玩法）', () => {
    const { game } = setup({ features: [FAKE_NET] })
    enter(game)
    face(game, 'net')
    pick(game, 'assault')
    endFake(game, 'face.net', 'lose', {})
    expect(runOf(game)).toMatchObject({ step: 'play', done: false, stage: 1 })
    const again = game.commit(replay(game.k, game.state))
    expect(again.map((r) => r.action)).toEqual(['commission.replay', 'fake_face_net.open'])
    endFake(game, 'face.net', 'done', {})
    expect(runOf(game).stage).toBe(2)
  })
})

describe('分支', () => {
  it('強攻永遠在；need.basic 不夠的分支列出來並有原因；沒踩到的 scouted 分支不列', () => {
    const { game } = setup({ pc: { ...STRONG, skills: { ...STRONG.skills, stealth: 1 } }, patch: { money: { cred: 0, cash: 100 } } })
    enter(game)
    face(game)
    const b = view(game).branches
    expect(b.map((x) => x.id)).toEqual(['assault', 'duct', 'bribe'])
    expect(b[0]).toMatchObject({ id: 'assault', kind: 'assault', block: null })
    expect(b[1]!.block).toMatch(/stealth要 2 級.*現在 1 級/)
    expect(b[2]!.block).toBeNull()
    expect(() => chooseBranch(game.k, game.state, 'duct')).toThrow(/要 2 級/)
    expect(() => chooseBranch(game.k, game.state, 'shift_gap')).toThrow(/沒有這條路/)
  })

  it('踩到了的 scouted 分支才列（setup.scouted.branches 寫分支的 id 或 need.scouted 的鍵都行），帶小標', () => {
    for (const key of ['shift_gap', 'shift_table']) {
      const { game } = setup()
      enter(game, { scouted: { branches: [key] } })
      face(game)
      expect(view(game).branches.find((x) => x.id === 'shift_gap')).toMatchObject({ kind: 'scouted', block: null, mark: 'scouted' })
    }
  })

  it('need.cash：錢不夠有原因；選了付錢', () => {
    const poor = setup({ patch: { money: { cred: 0, cash: 10 } } }).game
    enter(poor)
    face(poor)
    expect(view(poor).branches.find((x) => x.id === 'bribe')!.block).toMatch(/要付 50 現金.*只有 10/)
    const rich = setup({ patch: { money: { cred: 0, cash: 500 } } }).game
    enter(rich)
    face(rich)
    pick(rich, 'bribe')
    expect(rich.state.money.cash).toBe(450)
  })

  it('need.link：在拿到那個連動之後才選得了；沒拿到的原因寫出連動的名字', async () => {
    const { game } = setup()
    enter(game)
    await playFight(game)
    expect(runOf(game).links).toEqual([{ id: 'badge', from: 1, face: 'meat' }])
    face(game)
    expect(view(game).branches.find((x) => x.id === 'badge_door')).toMatchObject({ kind: 'linked', block: null, mark: 'link' })
    // 沒拿到的對照：直接從第二階段開始
    const other = setup()
    const def2 = JSON.parse(JSON.stringify(DEF)) as typeof DEF
    enter(other.game, {}, def2)
    expect(() => commit(other.game, [{ op: 'ext', key: 'commission', value: { ...runOf(other.game), stage: 2 } }])).not.toThrow()
    face(other.game)
    expect(view(other.game).branches.find((x) => x.id === 'badge_door')!.block).toBe('還沒拿到連動「員工證」。')
    expect(() => chooseBranch(other.game.k, other.game.state, 'badge_door')).toThrow('還沒拿到連動「員工證」。')
  })

  it('潛行：檢定帶 infiltrate 標籤、DC 基準 = 10 ＋ 等級 × 2；過了這一段是潛行的（地圖的 ext.stealth），警戒不加', () => {
    const seed = seedWhere({}, (g) => rollOf('duct')(g) === 'pass')
    const { game } = setup({ seed })
    enter(game)
    face(game)
    const draft = chooseBranch(game.k, game.state, 'duct')
    const roll = draft.timeline.find((b) => b.roll)!.roll!
    expect(roll.dc).toBe(16)
    expect(roll.skill).toBe('stealth')
    game.commit(draft)
    expect(extOf(game).stealth).toBe(true)
    expect(runOf(game).route[0]).toMatchObject({ branch: 'duct', kind: 'stealth', roll: 'pass', stealth: true })
    // 沒有 +10；入口那一格（窗）就在 G1 的視線裡，潛行只是警戒 +5、不開打（進圖也算一步）
    expect(alertOf(game)).toBe(5)
    expect(game.battle).toBeNull()
  })

  it('潛行沒過：警戒 +10，照強攻走（ext.stealth 沒有）', () => {
    const seed = seedWhere({}, (g) => rollOf('duct')(g) === 'fail')
    const { game } = setup({ seed })
    enter(game)
    face(game)
    pick(game, 'duct')
    expect(alertOf(game)).toBe(10)
    expect(extOf(game).stealth).toBeUndefined()
    expect(runOf(game).route[0]).toMatchObject({ roll: 'fail' })
    expect(runOf(game).route[0]!.stealth).toBeUndefined()
  })

  it('交涉：同一套（擲一次、過了潛行、沒過警戒 +10）；沒指定基本功時交涉與誘惑取高的', () => {
    const win = seedWhere({ patch: { money: { cred: 0, cash: 100 } } }, (g) => rollOf('bribe')(g) === 'pass')
    const a = setup({ seed: win, patch: { money: { cred: 0, cash: 100 } } }).game
    enter(a)
    face(a)
    const d = chooseBranch(a.k, a.state, 'bribe')
    expect(['negotiate', 'seduce']).toContain(d.timeline.find((b) => b.roll)!.roll!.skill)
    a.commit(d)
    expect(extOf(a).stealth).toBe(true)
    const lose = seedWhere({ patch: { money: { cred: 0, cash: 100 } } }, (g) => rollOf('bribe')(g) === 'fail')
    const b = setup({ seed: lose, patch: { money: { cred: 0, cash: 100 } } }).game
    enter(b)
    face(b)
    pick(b, 'bribe')
    expect(alertOf(b)).toBe(10)
  })

  it('潛行的一段不開打：被看到只加警戒 +5；走到遭遇的地方就算過了這一場，自動有里程碑', () => {
    const seed = seedWhere({}, (g) => rollOf('duct')(g) === 'pass')
    const { game } = setup({ seed })
    enter(game)
    face(game)
    pick(game, 'duct')
    expect(alertOf(game)).toBe(5) // 進圖就被 G1 看到：潛行只加警戒
    const walked = game.gridMove('south') // 窗口 (5,0) → (5,1)：同一個保全只算一次，不再加；開放座位的監視器 +2
    expect(walked.reports.map((r) => r.action)).toEqual(['grid.move'])
    expect(game.battle).toBeNull()
    expect(alertOf(game)).toBe(7)
    expect(view(game).goal).toMatchObject({ kind: 'fight', done: false })
    const r = game.gridMove('south') // 走到 G1 那一格
    expect(r.reports.map((x) => x.action)).toEqual(['grid.move', 'commission.milestone'])
    expect(runOf(game)).toMatchObject({ stage: 2, step: 'face', links: [{ id: 'badge' }] })
    expect(runOf(game).alert).toBe(9) // 5（被看到）＋ 開放座位的監視器每走一格 +2（兩格）
  })
})

describe('現實面的一段：照分支的入口開地圖，遭遇變成 enemy_pick', () => {
  it('地圖從分支的入口開、owner 是委託；ext 帶守備、增援、DC 基準、origin（by、commission、stage、face、defeat_event、employer）', () => {
    const { game } = setup()
    enter(game)
    face(game)
    const [r] = pick(game, 'assault')
    expect(r!.action).toBe('commission.branch')
    const inst = instance(game)
    expect(inst).toMatchObject({ def: 'map_office_small', owner: 'cm_t1' })
    expect(game.state.maps.at).toEqual({ map: inst.id, sheet: 'office', x: 6, y: 8 }) // E3
    expect(extOf(game)).toMatchObject({
      grade: 3, dc_base: 16, origin: { by: 'commission', commission: 'cm_t1', stage: 1, face: 'meat', defeat_event: 'df_custom', employer: 'nora' },
    })
    expect(extOf(game).reinforce).toEqual([
      { from: 'enemy_pick', faction: 'hizakura', grade: 3, rank: 'minion', seed: 'cm_t1/1/r1' },
      { from: 'enemy_pick', faction: 'hizakura', grade: 3, rank: 'minion', seed: 'cm_t1/1/r2' },
    ])
    expect(runOf(game)).toMatchObject({ step: 'play', branch: 'assault', map: inst.id, start_alert: 0 })
  })

  it('遭遇的每個位階一筆 enemy_pick（勢力是目標勢力、等級是副本的等級、seed 用委託與階段與第幾個）放在 post；開打的敵人是目標勢力的、位階對', async () => {
    const { game } = setup()
    enter(game)
    face(game)
    pick(game, 'assault')
    expect(guardFoes(game)).toEqual([
      { from: 'enemy_pick', faction: 'hizakura', grade: 3, rank: 'minion', seed: 'cm_t1/1/1' },
      { from: 'enemy_pick', faction: 'hizakura', grade: 3, rank: 'minion', seed: 'cm_t1/1/2' },
      { from: 'enemy_pick', faction: 'hizakura', grade: 3, rank: 'elite', seed: 'cm_t1/1/3' },
    ])
    expect(((extOf(game).guards as Rec).G1 as Rec).faction).toBe('hizakura')
    expect(Object.keys(extOf(game).guards as Rec)).toEqual(['G1'])
    game.gridMove([6, 3])
    const foes = Object.values(game.battle!.units).filter((u) => u.side === 'foe')
    expect(foes.map((u) => [u.enemy, u.rank, u.grade])).toEqual([['en_cm_hz_mook', 'minion', 3], ['en_cm_hz_mook', 'minion', 3], ['en_cm_hz_elite', 'elite', 3]])
    // 開戰的 origin：委託、階段、面、自訂的戰敗事件、委託人
    expect(game.battle!.origin.ext).toMatchObject({ by: 'commission', commission: 'cm_t1', stage: 1, face: 'meat', defeat_event: 'df_custom', employer: 'nora', pre: { spotted: true } })
    expect(game.battle!.origin.faction).toBe('hizakura')
    void (await fightHere(game, 'window'))
  })

  it('別的目標勢力挑別的勢力的兵種', () => {
    const other = JSON.parse(JSON.stringify(DEF)) as typeof DEF
    other.id = 'cm_t2'
    other.target_faction = 'nora'
    ;(other.stages[0]!.faces.meat as Rec).encounter = ['minion', 'minion', 'minion']
    const { game } = setup({ content: [{ ...PACK, content: { ...PACK.content, commission: [other as never] } }] })
    enter(game, {}, 'cm_t2')
    face(game)
    pick(game, 'assault')
    game.gridMove([6, 3])
    const foes = Object.values(game.battle!.units).filter((u) => u.side === 'foe')
    expect(foes.map((u) => u.enemy)).toEqual(['en_cm_nr_mook', 'en_cm_nr_mook', 'en_cm_nr_mook'])
  })

  it('守備沒有踩到的階段，地圖的 ext.edge 是 foe（G7）；setup.scouted.guards 有這一段的就沒有', () => {
    const a = setup().game
    enter(a)
    face(a)
    pick(a, 'assault')
    expect(extOf(a).edge).toBe('foe')
    const b = setup().game
    enter(b, { scouted: { guards: [1] } })
    face(b)
    pick(b, 'assault')
    expect(extOf(b).edge).toBeUndefined()
    // 別的階段沒踩到的照舊是 foe
    const c = setup().game
    enter(c, { scouted: { guards: [2] } })
    face(c)
    pick(c, 'assault')
    expect(extOf(c).edge).toBe('foe')
  })

  it('edge: foe 真的生效：敵方每個人先攻擲兩次取高（開戰那份報告裡一人一拍）；踩到守備的沒有', () => {
    const edges = (guards: number[]) => {
      const g = setup().game
      enter(g, { scouted: { guards } })
      face(g)
      pick(g, 'assault')
      const r = g.gridMove([6, 3]).reports.find((x) => x.action === 'battle.start')!
      return r.timeline.filter((b) => (b.data as { edge?: string } | undefined)?.edge).length
    }
    expect(edges([])).toBe(3)
    expect(edges([1])).toBe(0)
  })

  it('入口被保全看到：進圖就開打（問 map.arrive，真的探索回答；origin 的 by 被換成 core，但 commission 與 stage 還在，打贏照樣算）', async () => {
    const { game } = setup()
    enter(game)
    await playFight(game)
    face(game)
    const reports = pick(game, 'badge_door') // 入口 E1：一進來就在 G1 的視線裡
    expect(reports.map((r) => r.action)).toEqual(['commission.branch', 'grid.arrive', 'battle.start'])
    expect(game.battle!.origin.ext).toMatchObject({ commission: 'cm_t1', stage: 2, pre: { spotted: true } })
    expect(playOut(game).outcome).toBe('win')
    const done = (await game.finishBattle()).reports
    expect(done.map((r) => r.action)).toEqual(['battle.end', 'commission.milestone'])
    expect(runOf(game).stage).toBe(3)
  })

  it('入口那一格沒有被保全看到：探索回答 map.arrive 但沒事，只有進圖那一份報告', () => {
    const plain = JSON.parse(JSON.stringify(DEF)) as Rec
    delete plain.defeat_event
    const t = makeGame({ features: [exploreFeature, enemiesFeature, TEST_COMBAT, GEAR as never, commissionFeature], content: [{ id: 'p', content: { skill: SKILLS, weapon_class: WEAPONS, faction: FACTIONS, special_map: [MAP as never], enemy: ENEMIES as never, commission: [plain as never] } }], pc: STRONG as never })
    enter(t.game)
    face(t.game)
    expect(pick(t.game, 'assault').map((r) => r.action)).toEqual(['commission.branch'])
  })
})

describe('連動', () => {
  it('打贏遭遇之後自動有里程碑、拿到 gives；拿到「少一半」的連動之後下一段的敵人是一半（無條件進位）', async () => {
    const { game } = setup()
    enter(game)
    const reports = await playFight(game)
    expect(reports.map((r) => r.action)).toEqual(['battle.end', 'commission.milestone'])
    expect(reports[1]!.narration!.results).toEqual(['拿到連動「員工證」。'])
    expect(runOf(game).links).toEqual([{ id: 'badge', from: 1, face: 'meat' }])
    face(game)
    pick(game, 'assault')
    expect(guardFoes(game).map((f) => f.rank)).toEqual(['minion', 'minion']) // 三個 → ceil(3 / 2) = 2
    expect(extOf(game).origin).toMatchObject({ stage: 2 })
    expect(view(game).links[0]).toMatchObject({ id: 'badge', name: '員工證', type: 'skip', from: 1, stage: 2, used: true })
  })

  it('encounterAfter：少一半進位、少幾個（至少留一個）、沒有遭遇的不動', () => {
    expect(encounterAfter(['minion', 'minion', 'minion', 'minion'], { half: true, minus: 0 })).toEqual(['minion', 'minion'])
    expect(encounterAfter(['minion', 'minion', 'elite'], { half: true, minus: 0 })).toEqual(['minion', 'minion'])
    expect(encounterAfter(['minion'], { half: true, minus: 0 })).toEqual(['minion'])
    expect(encounterAfter(['minion', 'minion', 'elite'], { half: false, minus: 2 })).toEqual(['minion'])
    expect(encounterAfter(['minion', 'minion'], { half: true, minus: 5 })).toEqual(['minion'])
    expect(encounterAfter([], { half: true, minus: 1 })).toEqual([])
  })

  it('連動只對它寫的階段生效：quiet 寫 stage 3，第二階段不受影響', async () => {
    const { game } = setup()
    enter(game)
    await playFight(game)
    await playFight(game)
    const link = view(game).links.find((l) => l.id === 'quiet')!
    expect(link).toMatchObject({ from: 2, stage: 3, used: false })
  })

  it('skip_explore：入口換成保全崗那一格（直接站到遭遇點），進圖就開打', () => {
    const def = JSON.parse(JSON.stringify(DEF)) as typeof DEF
    def.links.badge.effect = { skip_explore: true } as never
    const { game } = setup({ content: [{ ...PACK, content: { ...PACK.content, commission: [] } }] })
    enter(game, {}, def)
    commit(game, [{ op: 'ext', key: 'commission', value: { ...runOf(game), stage: 2, links: [{ id: 'badge', from: 1, face: 'meat' }] } }])
    face(game)
    const reports = pick(game, 'assault')
    expect(game.state.maps.at).toMatchObject({ x: 5, y: 2 })
    expect(reports.map((r) => r.action)).toEqual(['commission.branch', 'grid.arrive', 'battle.start'])
  })

  it('alert_start 加減這一段開始的警戒；alert_frozen：做完時警戒回到這一段開始的樣子', async () => {
    const { game } = setup()
    enter(game, { alert_start: 40 })
    await playFight(game)
    const after1 = runOf(game).alert
    expect(after1).toBeGreaterThanOrEqual(40)
    await playFight(game)
    const after2 = runOf(game).alert
    // 第三階段：quiet 生效（開始時 −10、不漲）
    face(game)
    pick(game, 'assault')
    expect(runOf(game)).toMatchObject({ start_alert: after2 - 10, frozen: true })
    expect(alertOf(game)).toBe(after2 - 10)
    commit(game, [{ op: 'meter', kind: 'alert', key: runOf(game).map!, delta: 30 }])
    expect(view(game).alert.value).toBe(after2 + 20)
    game.gridMove([1, 5])
    game.commit(exploreFeature.useHere(game.k, game.state, 'take'))
    game.gridMove([1, 7])
    const end = SEEN.ends.find((e) => e.kind === 'commission')!
    expect(end.result.alert).toBe(after2 - 10) // 漲的 +30 不算
    expect(end.result.peak).toBeGreaterThanOrEqual(after2)
  })
})

describe('警戒整趟累計', () => {
  it('跨階段累計：一段做完把那張地圖的警戒收回狀態，下一段從這個數字開始；peak 記到過的最高', async () => {
    const { game } = setup()
    enter(game)
    face(game)
    pick(game, 'assault')
    const id1 = runOf(game).map!
    await fightHere(game)
    const gained = meterOf(game.k, game.state, 'alert', id1)
    expect(gained).toBeGreaterThan(0) // 正門到開放座位要經過接待區與開放座位的監視器
    expect(runOf(game)).toMatchObject({ alert: gained, peak: gained })
    face(game)
    pick(game, 'assault')
    expect(runOf(game).map).not.toBe(id1)
    expect(alertOf(game)).toBe(gained)
    expect(view(game).alert).toMatchObject({ value: gained, reinforce: 60, hard: 100 })
  })

  it('到 100 時最後一個階段的敵人高一級（最高 V）；沒到不升', async () => {
    const run = async (alert: number, grade = 3) => {
      const def = JSON.parse(JSON.stringify(DEF)) as typeof DEF
      def.grade = grade
      const { game } = setup({ content: [{ ...PACK, content: { ...PACK.content, commission: [] } }] })
      enter(game, { alert_start: alert }, def)
      commit(game, [{ op: 'ext', key: 'commission', value: { ...runOf(game), stage: 3 } }])
      face(game)
      pick(game, 'assault')
      return guardFoes(game).map((f) => f.grade)
    }
    expect(await run(99)).toEqual([3, 3, 3])
    expect(await run(100)).toEqual([4, 4, 4])
    expect(await run(100, 5)).toEqual([5, 5, 5])
    // 前面的階段不升
    const { game } = setup()
    enter(game, { alert_start: 100 })
    face(game)
    pick(game, 'assault')
    expect(guardFoes(game).map((f) => f.grade)).toEqual([3, 3, 3])
  })

  it('警戒累計到的值留在 state.ext，撤退或回到階段開始時就回去', async () => {
    const { game } = setup()
    enter(game)
    await playFight(game)
    expect(runOf(game).alert).toBeGreaterThan(0)
    expect(retreat(game.k, game.state).rewind).toEqual({ kind: 'entry', summary: expect.any(String), fresh: true }) // 撤退：回去之後骰子換一批（M2 修正批 3）
  })
})

describe('一段的目標（goal）', () => {
  it('take：要拿了東西再走到撤離點才算；只拿或只走到都不算', () => {
    const { game } = setup()
    enter(game)
    commit(game, [{ op: 'ext', key: 'commission', value: { ...runOf(game), stage: 3 } }])
    face(game)
    pick(game, 'assault')
    expect(view(game).goal).toMatchObject({ kind: 'take', done: false })
    // 先走到撤離點、沒拿東西：不算
    game.gridMove([1, 7])
    expect(runOf(game).stage).toBe(3)
    expect(view(game).goal!.done).toBe(false)
    game.gridMove([1, 5])
    game.commit(exploreFeature.useHere(game.k, game.state, 'take'))
    expect(runOf(game)).toMatchObject({ stage: 3, step: 'play' }) // 拿到了、人還不在撤離點
    expect(view(game).goal).toMatchObject({ kind: 'take', done: false, text: expect.stringContaining('撤離點') })
    const r = game.gridMove([1, 7])
    expect(r.reports.map((x) => x.action)).toEqual(['grid.move', 'commission.milestone', 'commission.finish'])
  })

  it('reach：走到那個標記就算', () => {
    const def = JSON.parse(JSON.stringify(DEF)) as typeof DEF
    ;(def.stages[2]!.faces.meat as Rec).goal = { kind: 'reach', at: 'X1' }
    const { game } = setup({ content: [{ ...PACK, content: { ...PACK.content, commission: [] } }] })
    enter(game, {}, def)
    commit(game, [{ op: 'ext', key: 'commission', value: { ...runOf(game), stage: 3 } }])
    face(game)
    pick(game, 'assault')
    const r = game.gridMove([1, 7])
    expect(r.reports.map((x) => x.action)).toEqual(['grid.move', 'commission.milestone', 'commission.finish'])
  })

  it('check：站在標記上擲一次（基本功對 DC 基準），過了就算；沒過警戒 +5、可以再試', () => {
    const def = JSON.parse(JSON.stringify(DEF)) as typeof DEF
    def.grade = 3
    ;(def.stages[2]!.faces.meat as Rec).goal = { kind: 'check', at: 'T3', basic: 'mechanics' }
    const content = [{ ...PACK, content: { ...PACK.content, commission: [] } }]
    const prep = (g: G) => {
      enter(g, {}, def)
      commit(g, [{ op: 'ext', key: 'commission', value: { ...runOf(g), stage: 3 } }])
      face(g)
      pick(g, 'assault')
      g.gridMove([1, 5])
    }
    const result = (g: G) => { prep(g); return checkGoal(g.k, g.state).outcome.result }
    const win = seedWhere({ content }, (g) => result(g) === 'done')
    const a = setup({ seed: win, content }).game
    prep(a)
    const draft = checkGoal(a.k, a.state)
    expect(draft.timeline.find((b) => b.roll)!.roll).toMatchObject({ skill: 'mechanics', dc: 16 })
    const reports = a.commit(draft)
    expect(reports.map((r) => r.action)).toEqual(['commission.check', 'commission.milestone', 'commission.finish'])
    // 沒過
    const lose = seedWhere({ content, pc: { attrs: { tech: 6 }, skills: {} } }, (g) => result(g) === 'failed')
    const b = setup({ seed: lose, content, pc: { attrs: { tech: 6 }, skills: {} } }).game
    prep(b)
    const before = alertOf(b)
    b.commit(checkGoal(b.k, b.state))
    expect(alertOf(b)).toBe(before + 5)
    expect(runOf(b)).toMatchObject({ stage: 3, step: 'play' })
    expect(runOf(b).checked).toBeFalsy()
    expect(() => checkGoal(b.k, b.state)).not.toThrow() // 可以再試
    // 沒走到那一格、目標不是 check
    const c = setup({ content }).game
    enter(c, {}, def)
    commit(c, [{ op: 'ext', key: 'commission', value: { ...runOf(c), stage: 3 } }])
    face(c)
    pick(c, 'assault')
    expect(() => checkGoal(c.k, c.state)).toThrow(/要先走到/)
    const d = setup().game
    enter(d)
    face(d)
    pick(d, 'assault')
    expect(() => checkGoal(d.k, d.state)).toThrow(/不是動手的檢定/)
  })

  it('scene：沒有人登記 scene 就做不了（有原因）；登記了開那場場景，做完看 goal_done 才算', () => {
    const def = JSON.parse(JSON.stringify(DEF)) as typeof DEF
    ;(def.stages[2]!.faces.meat as Rec).goal = { kind: 'scene', with: 'npc_host', goal: 'info' }
    const content = [{ ...PACK, content: { ...PACK.content, commission: [] } }]
    const none = setup({ content }).game
    enter(none, {}, def)
    commit(none, [{ op: 'ext', key: 'commission', value: { ...runOf(none), stage: 3 } }])
    face(none)
    pick(none, 'assault')
    expect(() => playScene(none.k, none.state)).toThrow('這一段的場景還沒有開放。')

    const { game } = setup({ content, features: [FAKE_SCENE] })
    enter(game, {}, def)
    commit(game, [{ op: 'ext', key: 'commission', value: { ...runOf(game), stage: 3 } }])
    face(game)
    pick(game, 'assault')
    const opened = game.commit(playScene(game.k, game.state))
    expect(opened.map((r) => r.action)).toEqual(['commission.scene', 'fake_scene.open'])
    expect((game.state.ext.fake_scene as { setup: Rec }).setup).toEqual({ with: ['npc_host'], nature: 'work', goal: 'info' })
    endFake(game, 'scene', 'end', { goal_done: false, rating: 'bad' })
    expect(runOf(game)).toMatchObject({ step: 'play', scene: 'failed' })
    expect(view(game).goal).toMatchObject({ kind: 'scene', done: false, text: expect.stringContaining('再來一次') })
    game.commit(playScene(game.k, game.state))
    const done = endFake(game, 'scene', 'end', { goal_done: true })
    expect(done.map((r) => r.action)).toEqual(['fake_scene.close', 'commission.milestone', 'commission.finish'])
  })

  it('離開了地圖（站在撤離點用了「離開」）卻還沒做完：replay 回到這一條路的入口重開，警戒照離開時的', async () => {
    const { game } = setup()
    enter(game)
    face(game)
    pick(game, 'assault')
    const old = runOf(game).map!
    commit(game, [{ op: 'meter', kind: 'alert', key: old, set: 33 }])
    stand(game, 1, 7)
    game.commit(exploreFeature.useHere(game.k, game.state, 'leave'))
    expect(game.state.maps.instances[old]).toBeUndefined()
    expect(runOf(game)).toMatchObject({ step: 'play', map: old })
    const r = game.commit(replay(game.k, game.state))
    expect(r[0]!.action).toBe('commission.replay')
    expect(runOf(game).map).not.toBe(old)
    expect(alertOf(game)).toBe(33)
    expect(game.state.maps.at).toMatchObject({ x: 6, y: 8 })
    expect(() => replay(game.k, game.state)).toThrow(/還開著/)
    await fightHere(game)
    expect(runOf(game).stage).toBe(2)
  })
})

describe('喘口氣', () => {
  it('每兩個階段之間只能一次；發 rest.done（stage），處理函式被叫到；不花時間', async () => {
    const { game } = setup()
    enter(game)
    // 還沒做完任何階段、階段中間都不行
    expect(view(game).breathe).toMatchObject({ can: false })
    expect(() => breathe(game.k, game.state)).toThrow(/做完一個階段之後/)
    await playFight(game)
    expect(view(game).breathe).toEqual({ can: true, reason: null })
    const t = minutes(game)
    const [r] = game.commit(breathe(game.k, game.state))
    expect(r!.action).toBe('commission.breathe')
    expect(SEEN.rest).toEqual(['stage'])
    expect(game.state.flags.rested).toBe('stage')
    expect(minutes(game)).toBe(t)
    expect(runOf(game).breathed).toBe(true)
    expect(view(game).breathe).toMatchObject({ can: false, reason: '這兩個階段之間已經喘過一口氣了。' })
    expect(() => breathe(game.k, game.state)).toThrow('這兩個階段之間已經喘過一口氣了。')
    // 選了面、玩這一段的時候不行；做完下一個階段之後又可以
    face(game)
    pick(game, 'assault')
    expect(() => breathe(game.k, game.state)).toThrow(/做完一個階段之後/)
    await fightHere(game)
    expect(view(game).breathe.can).toBe(true)
    game.commit(breathe(game.k, game.state))
    expect(SEEN.rest).toEqual(['stage', 'stage'])
  })

  it('戰鬥中不能喘口氣（放行的白名單也擋）', async () => {
    const { game } = setup()
    enter(game)
    await playFight(game)
    face(game)
    pick(game, 'assault')
    game.gridMove([6, 3])
    expect(game.battle).not.toBeNull()
    expect(() => breathe(game.k, game.state)).toThrow('戰鬥中不能喘口氣。')
    expect(view(game).breathe.can).toBe(false)
    expect(game.blockOf('commit:commission.breathe')).toBe('正在戰鬥，先把這一場打完。')
  })
})

describe('撤退', () => {
  it('時間、錢、背包、警戒都回到進去之前；紀錄留著並標成被收回；委託的活動結束', async () => {
    const { game } = setup({ patch: { money: { cred: 100, cash: 500 }, inventory: [{ id: 'it_x', qty: 2 }] } })
    const before = { time: game.state.time, money: { ...game.state.money }, inventory: JSON.parse(JSON.stringify(game.state.inventory)), meters: JSON.parse(JSON.stringify(game.state.meters)), flags: { ...game.state.flags } }
    enter(game)
    await playFight(game)
    commit(game, [{ op: 'cash', delta: -200 }, { op: 'item', id: 'it_y', qty: 1 }, { op: 'flag', key: 'in_there', value: true }])
    face(game)
    pick(game, 'assault')
    expect(game.state.meters.alert).toBeDefined()
    expect(minutes(game)).toBeGreaterThan(toMinutes(before.time))
    const reports = game.commit(retreat(game.k, game.state))
    expect(reports[0]).toMatchObject({ action: 'commission.retreat', retracted: true })
    expect(reports.at(-1)!.action).toBe('rewind')
    expect(game.state.time).toEqual(before.time)
    expect(game.state.money).toEqual(before.money)
    expect(game.state.inventory).toEqual(before.inventory)
    expect(game.state.meters).toEqual(before.meters)
    expect(game.state.flags).toEqual(before.flags)
    expect(readRun(game.state)).toBeNull()
    expect(game.k.activity.active(game.state)).toEqual([])
    expect(game.state.maps.at).toBeNull()
    expect(Object.keys(game.state.maps.instances)).toEqual([])
    expect(game.state.snapshots).toEqual([])
    // 紀錄還在：進去、階段、里程碑都留著，標成被收回
    const log = game.state.reports.filter((r) => r.action?.startsWith('commission.'))
    expect(log.length).toBeGreaterThan(3)
    expect(log.every((r) => r.retracted)).toBe(true)
    // activity.end 發了（outcome retreat），發起的人知道這件委託退出來了
    expect(SEEN.ends.find((e) => e.kind === 'commission')).toMatchObject({ outcome: 'retreat', origin, result: { commission: 'cm_t1' } })
    // 沒有被擋了
    expect(game.blockOf('commit:trade.checkout')).toBeNull()
    // 還能再進去
    enter(game)
    expect(runOf(game)).toMatchObject({ stage: 1, step: 'face' })
  })

  it('戰鬥中不能撤退；等著選的戰敗也不能', async () => {
    const { game } = setup()
    enter(game)
    face(game)
    pick(game, 'assault')
    game.gridMove([6, 3])
    expect(() => retreat(game.k, game.state)).toThrow('戰鬥中不能撤退，先把這一場打完。')
    expect(view(game).retreat).toMatchObject({ can: false })
    game.state.battle!.result = { outcome: 'lose', text: '輸了。' }
    await game.finishBattle()
    expect(game.pendingDefeat).not.toBeNull()
    expect(view(game).retreat.can).toBe(false)
    expect(() => game.commit(retreat(game.k, game.state))).toThrow(ActionBlocked)
  })

  it('撤退之後 stage 與 entry 快照都沒有了（比入口晚的一起丟掉）', async () => {
    const { game } = setup()
    enter(game)
    await playFight(game)
    face(game)
    game.commit(retreat(game.k, game.state))
    expect(game.state.snapshots).toEqual([])
  })
})

describe('戰敗：回到這個階段開始時（rewindToStage；ui-stage-legacy-dungeon 的引擎版）', () => {
  /** 打完第一階段、第二階段選面與分支、走到遭遇、打輸。 */
  async function loseStage2(): Promise<{ game: G; stageStart: GameState['time'] }> {
    const { game } = setup()
    enter(game)
    await playFight(game)
    const stageStart = game.state.time
    face(game)
    pick(game, 'assault')
    game.gridMove([6, 3])
    game.state.battle!.result = { outcome: 'lose', text: '輸了。' }
    const r = await game.finishBattle()
    expect(r.reports.map((x) => x.action)).toEqual(['battle.end', 'defeat.pending'])
    expect(game.pendingDefeat).not.toBeNull()
    return { game, stageStart }
  }

  it('在第二階段打輸選「回到這個階段開始時」：回到第二階段剛選面之前，委託還在進行，時間回到那一刻', async () => {
    const { game, stageStart } = await loseStage2()
    // 三選一的期間放行的只有三個選擇：副本裡的別的事照樣擋
    expect(game.blockOf('commit:commission.face')).toMatch(/戰敗的三個選擇/)
    expect(game.rewindToStage()).toBeNull()
    expect(game.state.time).toEqual(stageStart)
    expect(runOf(game)).toMatchObject({ stage: 2, step: 'face', links: [{ id: 'badge' }] })
    expect(runOf(game).face).toBeUndefined()
    expect(game.k.activity.active(game.state).map((a) => a.kind)).toEqual(['commission'])
    expect(game.pendingDefeat).toBeNull()
    expect(game.battle).toBeNull()
    expect(game.state.maps.at).toBeNull()
    expect(Object.keys(game.state.maps.instances)).toEqual([])
    // 入口還在，這個階段的 stage 與開打前的快照都丟了
    expect(game.state.snapshots.map((s) => s.kind)).toEqual(['entry'])
    // 之後的紀錄留著，標成被收回
    expect(game.state.reports.some((r) => r.retracted && r.action === 'battle.end')).toBe(true)
    // 接著重新選面又存一份 stage 快照，照常走完
    face(game)
    expect(game.state.snapshots.map((s) => s.kind)).toEqual(['entry', 'stage'])
    pick(game, 'assault')
    await fightHere(game)
    expect(runOf(game).stage).toBe(3)
  })

  it('「重來這場戰鬥」：回到開打前，委託與地圖都在', async () => {
    const { game } = await loseStage2()
    expect(game.retryBattle()).toBeNull()
    expect(game.battle).not.toBeNull()
    expect(runOf(game)).toMatchObject({ stage: 2, step: 'play' })
    expect(playOut(game).outcome).toBe('win')
    await game.finishBattle()
    expect(runOf(game).stage).toBe(3)
  })

  it('第一階段打輸、回到階段開始：回到選面之前，時間是進去那一刻', async () => {
    const { game } = setup()
    enter(game)
    const t0 = game.state.time
    face(game)
    pick(game, 'assault')
    game.gridMove([6, 3])
    game.state.battle!.result = { outcome: 'lose', text: '輸了。' }
    await game.finishBattle()
    expect(game.rewindToStage()).toBeNull()
    expect(game.state.time).toEqual(t0)
    expect(runOf(game)).toMatchObject({ stage: 1, step: 'face' })
  })
})

describe('存檔：打到一半存檔再讀，接著走完的結果和沒有中斷的一樣', () => {
  it('第二階段的地圖上存檔，繼續走完：finish 的結果與最後的狀態一樣', async () => {
    const { game } = setup({ seed: 11 })
    enter(game, { terms: { pay: 1 } })
    await playFight(game)
    face(game)
    pick(game, 'assault')
    const raw = game.save('manual', 't')
    const finishOnce = async () => {
      SEEN.ends.length = 0
      await fightHere(game)
      playTake(game)
      return { end: SEEN.ends.find((e) => e.kind === 'commission')!.result, hash: stateHash(game.state), time: game.state.time }
    }
    const a = await finishOnce()
    expect(game.load(raw)).toBeNull()
    expect(runOf(game)).toMatchObject({ stage: 2, step: 'play' })
    expect(game.state.maps.at).not.toBeNull()
    const b = await finishOnce()
    expect(b).toEqual(a)
  })

  it('階段之間存檔也一樣（連動、警戒、喘過氣都在存檔裡）', async () => {
    const { game } = setup({ seed: 5 })
    enter(game)
    await playFight(game)
    game.commit(breathe(game.k, game.state))
    const raw = game.save('manual', 't')
    const keep = JSON.parse(JSON.stringify(runOf(game)))
    expect(game.load(raw)).toBeNull()
    expect(runOf(game)).toEqual(keep)
    expect(runOf(game).breathed).toBe(true)
    expect(view(game).links.map((l) => l.id)).toEqual(['badge'])
  })
})

describe('畫面的一份快照（commissionView）', () => {
  it('階段軌：做完的、現在的、沒揭開的（只有最後一個階段與踩點揭開的看得到面）；選了什麼', async () => {
    const { game } = setup()
    expect(commissionView(game.k, game.state)).toBeNull()
    enter(game)
    let v = view(game)
    expect(v).toMatchObject({ id: 'cm_t1', name: '測試用的副本', kind: 'steal_item', main: 'meat', scale: 'small', grade: 3, stages: 3, stage: 1, stageName: '外圍', step: 'face', conditions: ['no_kill'], stageMinutes: 120 })
    expect(v.track.map((n) => [n.state, n.known, n.decisive])).toEqual([['current', true, false], ['ahead', false, false], ['ahead', true, true]])
    expect(v.track[0]!.faces).toEqual(['meat', 'net'])
    expect(v.track[1]!.faces).toBeUndefined()
    expect(v.track[2]!.faces).toEqual(['meat'])
    face(game)
    pick(game, 'assault')
    expect(view(game).track[0]!.chose).toEqual({ face: 'meat', branch: 'assault' })
    expect(view(game).goal).toMatchObject({ kind: 'fight', done: false })
    await fightHere(game)
    v = view(game)
    expect(v.track.map((n) => n.state)).toEqual(['done', 'current', 'ahead'])
    expect(v.stage).toBe(2)
    expect(v.links).toHaveLength(1)
    // 踩點揭開的階段看得到面
    const s = setup().game
    enter(s, { scouted: { stages: [2] } })
    expect(view(s).track[1]!.known).toBe(true)
    expect(view(s).track[1]!.faces).toEqual(['meat'])
  })
})

describe('內容的格式（commission 這種內容）', () => {
  const bad = (patch: (d: typeof DEF) => void): string[] => {
    const d = JSON.parse(JSON.stringify(DEF)) as typeof DEF
    patch(d)
    return commissionProblems(d as never)
  }
  it('樣本合格', () => {
    expect(commissionProblems(DEF as never)).toEqual([])
    expect(commissionProblems({ ...DEF, grade: 'III' } as never)).toEqual([])
  })
  it('每一面至少一條強攻、階段數對規模、最後一個階段只有主面、gives 與 need.link 要查得到連動', () => {
    expect(bad((d) => { (d.stages[0]!.faces.meat as Rec).branches = [branch('duct', 'stealth', 'E1')] })).toEqual(expect.arrayContaining([expect.stringMatching(/至少要有一條強攻/)]))
    expect(bad((d) => { d.scale = 'medium' })).toEqual(expect.arrayContaining([expect.stringMatching(/要 4 個/)]))
    expect(bad((d) => { d.stages[2]!.faces = { meat: d.stages[2]!.faces.meat, net: d.stages[0]!.faces.net } as never })).toEqual(expect.arrayContaining([expect.stringMatching(/最後一個階段只有主面/)]))
    expect(bad((d) => { (d.stages[0]!.faces.meat as Rec).gives = 'nope' })).toEqual(expect.arrayContaining([expect.stringMatching(/links 裡沒有這個連動/)]))
    expect(bad((d) => { (d.stages[1]!.faces.meat as Rec).branches = [branch('assault', 'assault', 'E3'), branch('x', 'linked', 'E1', { link: 'nope' })] })).toEqual(expect.arrayContaining([expect.stringMatching(/need.link 寫了 nope/)]))
    expect(bad((d) => { (d.stages[2]!.faces.meat as Rec).goal = { kind: 'fight' }; (d.stages[2]!.faces.meat as Rec).encounter = [] })).toEqual(expect.arrayContaining([expect.stringMatching(/要有遭遇/)]))
    expect(bad((d) => { (d.stages[0]!.faces.meat as Rec).branches = [{ id: 'assault', kind: 'assault' }] })).toEqual(expect.arrayContaining([expect.stringMatching(/entry 要是入口的標記/)]))
    expect(bad((d) => { d.links.badge.effect = { foes_minus: -1, nope: 1 } as never })).toEqual(expect.arrayContaining([expect.stringMatching(/foes_minus/), expect.stringMatching(/nope/)]))
  })
  it('載入之後查地圖：入口、保全崗、目標的標記要在版面上（ready）；勢力與地圖是引用檢查', () => {
    const wrongEntry = JSON.parse(JSON.stringify(DEF)) as typeof DEF
    wrongEntry.stages[0]!.faces.meat.branches[0]!.entry = 'E9'
    expect(() => setup({ content: [{ ...PACK, content: { ...PACK.content, commission: [wrongEntry as never] } }] })).toThrow(ContentError)
    const wrongPost = JSON.parse(JSON.stringify(DEF)) as typeof DEF
    ;(wrongPost.stages[0]!.faces.meat as Rec).post = 'S1'
    expect(() => setup({ content: [{ ...PACK, content: { ...PACK.content, commission: [wrongPost as never] } }] })).toThrow(/不是.*保全崗/)
    const g = setup().game
    const ghost = { ...DEF, id: 'cm_ghost', target_faction: 'nobody' }
    g.k.content.load('commission', [ghost as never])
    expect(g.k.content.checkRefs()).toEqual(['commission/cm_ghost：引用了不存在的 faction/nobody'])
  })
  it('規則的數字照設計書，資料 commission_rule/default 可以蓋掉（每階段的分鐘數）', async () => {
    const { game } = setup({ content: [{ ...PACK, content: { ...PACK.content, commission_rule: [{ id: 'default', stage_minutes: 60 }] } }] })
    enter(game)
    const t0 = minutes(game)
    await playFight(game)
    expect(minutes(game)).toBe(t0 + 60)
  })
})

describe('竊聽花（M4-followups）：條件 malware_leak 成立時，警戒起始值上升', () => {
  const LEAK: Feature = {
    id: 'leak_stub',
    install(k) {
      k.conditions.register({ kind: 'malware_leak', owner: 'leak_stub', validate: () => [], test: (_c, { state }) => state.flags.leak === true })
    },
  }

  it('身上有竊聽花：進副本時警戒起始值加 leak_alert（預設 10）；沒有就是 0；沒有人註冊條件的局照舊', () => {
    const { game } = setup({ features: [LEAK] })
    enter(game)
    expect(runOf(game).alert).toBe(0)
    const leaky = setup({ features: [LEAK], patch: { flags: { leak: true } } as never })
    enter(leaky.game)
    expect(runOf(leaky.game).alert).toBe(10)
    expect(runOf(leaky.game).peak).toBe(10)
    const bare = setup({ patch: { flags: { leak: true } } as never })
    enter(bare.game)
    expect(runOf(bare.game).alert).toBe(0)
  })

  it('起始警戒是自己寫的（alert_start）時加在上面，最多 100', () => {
    const t = setup({ features: [LEAK], patch: { flags: { leak: true } } as never })
    enter(t.game, { alert_start: 95 })
    expect(runOf(t.game).alert).toBe(100)
  })
})
