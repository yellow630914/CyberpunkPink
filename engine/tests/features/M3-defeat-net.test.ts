// 驗收測試：dev/work/M3-defeat-net.md（cpp-feature）。features/defeat 的內海面：被定位、白蕾絲不算贏的人、扣線的欄位與條件。
// 規格：CYBERSPACE 6.7、6.8 節；ENEMIES 第 6、9 節；COMBAT_SYSTEM 8.3、8.4 節；dev/adr/0018 第十節與 N15、N17。
// 內容一律用測試自帶的最小假資料。內海的戰鬥用 TEST_NET_COMBAT 與 BATTLE_SETUPS.net；事件視窗用真的（director 的 eventRunFeature）。
// 四件假的戰敗事件：pinned、polluted（不算委託失敗）、勢力甲的預設、被定位用的一件（另加一件通用的當退路）。
// 扣線：netcombat 不在這裡裝；用兩種它會留下的痕跡代替（單位的 ext.net.tethered，與紀錄裡 tag tether、data.tethered 的那一拍）。

import { describe, expect, it } from 'vitest'
import type { BattleSetup, ContentPack, Feature, Origin, Report } from '../../src'
import { chooseOption, directorFeature, eventRunFeature, eventView } from '../../src/features/director'
import { acceptDefeat, defeatFeature, defeatOf, defeatView, pickDefeat, winnersOf } from '../../src/features/defeat'
import { BATTLE_SETUPS, TEST_COMBAT, TEST_NET_COMBAT, enemyUnit, laceUnit, makeGame, observed, playOut } from '../../src/testkit'

type Fx = Record<string, unknown>

// ---- 替身 ----

interface Heard { kind: string; origin: Origin; outcome: string; result: Record<string, unknown> }
const caller = (log: Heard[]): Feature => ({
  id: 'caller',
  install(k) {
    k.hooks.on('activity.end', 'caller', (p) => {
      if (p.kind !== 'defeat' || p.origin.by !== 'caller') return
      log.push({ kind: p.kind, origin: p.origin, outcome: p.outcome, result: p.result })
      return { lines: ['發起的人收到了戰敗的結果'] }
    })
  },
})
/** 只留下 netcombat 紀錄裡的那一拍（tag tether、data.tethered），不標單位：測「從紀錄讀」那一條路。 */
const beatOnly: Feature = {
  id: 'beat_only',
  install: (k) => void k.battle.on('round.start', 'beat_only', ({ run, round }) => {
    if (round === 1) run.say('被扣線了。', 'tether', { tethered: true, units: ['a1'] })
  }),
}
const enemyStub: Feature = { id: 'enemy_stub', install: (k) => k.content.defineKind({ kind: 'enemy', owner: 'enemy_stub', validate: () => [] }) }

// ---- 假資料 ----

const opt = (id: string, text: string, o: Fx = {}): Fx => ({ id, text, outcomes: { any: [] }, ...o })
const ev = (id: string, o: Fx = {}): Fx => ({
  id, name: id, kind: 'generic', factions: [], fails_commission: true,
  versions: { default: { text: `${id}：開頭。`, stages: [{ options: [opt('plain', '繼續。'), opt('cut', '剪斷纜線。', { need: { kind: 'defeat_tethered' } }), opt('net_only', '看著網。', { need: { kind: 'defeat_net' } })] }] } },
  ...o,
})
const EVENTS = [
  ev('pinned', { kind: 'pinned' }),
  ev('polluted', { kind: 'polluted', fails_commission: false }),
  ev('df_a', { factions: ['a'] }),
  ev('df_located', { kind: 'located' }),
  ev('df_custom'),
  ev('df_generic', { default: true }),
]
const PACK: ContentPack = {
  id: 'defeat_m3',
  content: {
    faction: [{ id: 'a', name: '勢力甲', short: '甲', class: 'corp' }],
    enemy: [
      { id: 'lace_pink', name: '粉蕾絲', kind: 'lace', defeat: 'pinned' },
      { id: 'lace_black', name: '黑蕾絲', kind: 'lace', defeat: 'polluted' },
      { id: 'lace_white', name: '白蕾絲', kind: 'lace', defeat: 'pinned' },
      { id: 'en_goon', name: '打手', kind: 'human', defeat: 'pinned' },
    ],
    defeat_event: EVENTS,
  },
} as unknown as ContentPack

const base = (...foes: Array<{ enemy: string; tags?: string[] }>): BattleSetup => base2(foes, {})
const base2 = (foes: Array<{ enemy: string; tags?: string[] }>, o: { ext?: Fx; faction?: string; allies?: Fx }): BattleSetup => {
  const s = BATTLE_SETUPS.net()
  return {
    ...s,
    allies: o.allies ? s.allies.map((u) => ({ from: 'unit', unit: { ...(u as unknown as { unit: Fx }).unit, ...o.allies } })) as never : s.allies,
    foes: foes.map((f) => ({ from: 'unit', unit: laceUnit('minion', 1, { enemy: f.enemy, tags: ['lace', ...(f.tags ?? [])] } as never) as unknown as Fx })),
    origin: { ...s.origin!, escapable: false, faction: o.faction ?? 'a', ext: { by: 'caller', ref: 'r1', ...(o.ext ?? {}) } },
  } as BattleSetup
}

interface Opts { setup: BattleSetup; features?: Feature[]; rules?: Record<string, unknown>; located?: boolean | number }
function arena(o: Opts) {
  const log: Heard[] = []
  const net = o.setup.mode === 'net'
  const { game } = makeGame({
    features: [defeatFeature, net ? TEST_NET_COMBAT : TEST_COMBAT, directorFeature, eventRunFeature, enemyStub, caller(log), ...(o.features ?? [])],
    content: [PACK], seed: 2, pc: { gender: 'female' },
    patch: { money: { cred: 0, cash: 2000 }, rules: { defeatView: 'never', ...(o.rules ?? {}) } as never },
  })
  game.startBattle(o.setup)
  if (o.located !== undefined) game.state.battle!.field.located = o.located
  return { g: game, log }
}
type A = ReturnType<typeof arena>

/** 把戰鬥結成輸（或投降），結算。 */
async function lose(a: A, how: 'lose' | 'surrender' = 'lose'): Promise<Report[]> {
  a.g.state.battle!.result = { outcome: how, text: how === 'lose' ? '全隊倒下。' : '投降。' }
  const { result, violations } = await observed(a.g, () => a.g.finishBattle())
  expect(violations).toEqual([])
  return result.reports
}
const play = async (o: Opts, how: 'lose' | 'surrender' = 'lose') => { const a = arena(o); const reports = await lose(a, how); return { ...a, reports } }

const pinkFoe = { enemy: 'lace_pink', tags: ['lace:pink'] }

// ---- 被定位 ----

describe('選哪一件', () => {
  it('輸給資料寫 defeat: pinned 的粉蕾絲：選到 pinned（個別敵人優先於勢力的預設）', async () => {
    const { g } = await play({ setup: base(pinkFoe) })
    expect(defeatOf(g.state)).toMatchObject({ event: 'pinned', tier: 'enemy', net: true, located: false, faction: 'a' })
  })

  it('同一場但 battle.field.located 是 true：跳過個別敵人的，選到目標勢力的預設；defeat_event 也不看', async () => {
    const { g } = await play({ setup: base2([pinkFoe], { ext: { defeat_event: 'df_custom' } }), located: true })
    expect(defeatOf(g.state)).toMatchObject({ event: 'df_a', tier: 'faction', net: true, located: true })
    // 沒有目標勢力的預設時退到通用的
    const none = await play({ setup: base2([pinkFoe], { faction: 'zzz' }), located: true })
    expect(defeatOf(none.g.state)).toMatchObject({ event: 'df_generic', tier: 'generic' })
  })

  it('origin.ext.located_event 有寫時選到它；寫了不存在的 id 就往下一個順位', async () => {
    const { g } = await play({ setup: base2([pinkFoe], { ext: { located_event: 'df_located' } }), located: true })
    expect(defeatOf(g.state)).toMatchObject({ event: 'df_located', tier: 'origin' })
    const bad = await play({ setup: base2([pinkFoe], { ext: { located_event: 'nowhere' } }), located: true })
    expect(defeatOf(bad.g.state)).toMatchObject({ event: 'df_a' })
  })

  it('天使急救優先於被定位的事件', () => {
    const withAngel = { ...PACK, content: { ...PACK.content, defeat_event: [...EVENTS, ev('df_angel', { angel: true, fails_commission: false })] } } as ContentPack
    const b = makeGame({ features: [defeatFeature, TEST_NET_COMBAT, enemyStub], content: [withAngel], patch: { flags: { angel_member: true } as never } }).game
    expect(pickDefeat(b.k, b.state, { located: true, locatedEvent: 'df_located', faction: 'a', roll: 0.1 })).toMatchObject({ event: 'df_angel', tier: 'angel' })
    // 沒有天使的資格：被定位的事件
    const plain = makeGame({ features: [defeatFeature, TEST_NET_COMBAT, enemyStub], content: [PACK] }).game
    expect(pickDefeat(plain.k, plain.state, { located: true, locatedEvent: 'df_located', faction: 'a', enemies: ['pinned'], event: 'df_custom', roll: 0.1 })).toMatchObject({ event: 'df_located', tier: 'origin' })
  })

  it('倒數還沒到（field.located 是數字）、或不是內海的戰鬥：不算被定位，照平常的順序', async () => {
    const counting = await play({ setup: base(pinkFoe), located: 2 })
    expect(defeatOf(counting.g.state)).toMatchObject({ event: 'pinned', tier: 'enemy', located: false })
    const meatSetup = { ...BATTLE_SETUPS.hopeless(), origin: { escapable: false, faction: 'a', ext: { located_event: 'df_located' } }, foes: [{ from: 'unit', unit: enemyUnit('boss', 1, { enemy: 'en_goon' }) as unknown as Fx }] } as BattleSetup
    const meat = await play({ setup: meatSetup, located: true })
    expect(defeatOf(meat.g.state)).toMatchObject({ event: 'pinned', tier: 'enemy' })
    expect(defeatOf(meat.g.state)!.net).toBeUndefined()
    expect(defeatView(meat.g.k, meat.g.state)).toMatchObject({ net: false, tethered: false, located: false })
  })
})

// ---- 白蕾絲 ----

describe('白蕾絲不算贏的人', () => {
  const white = { enemy: 'lace_white', tags: ['lace:white'] }
  const black = { enemy: 'lace_black', tags: ['lace:black'] }

  it('場上站著一隻白蕾絲與一隻黑蕾絲：贏的人只有黑蕾絲，選到 polluted；接受之後 activity.end 的 fails_commission 是 false', async () => {
    const { g, log } = await play({ setup: base(white, black) })
    expect(defeatOf(g.state)).toMatchObject({ event: 'polluted', tier: 'enemy', fails_commission: false })
    g.commit(acceptDefeat(g.k, g.state))
    expect(log).toHaveLength(1)
    expect(log[0]).toMatchObject({ kind: 'defeat', origin: { by: 'caller', ref: 'r1' }, outcome: 'accept', result: { event: 'polluted', kind: 'polluted', fails_commission: false, net: true, tethered: false, located: false } })
    expect(defeatOf(g.state)).toBeNull()
  })

  it('winnersOf：白蕾絲的 defeat 不列；黑蕾絲倒了就只剩白蕾絲站著，沒有贏的人、勢力用場地的', () => {
    const a = arena({ setup: base(white, black) })
    const b = a.g.state.battle!
    expect(winnersOf(a.g.k, b)).toMatchObject({ enemies: ['polluted'], faction: 'a' })
    for (const u of Object.values(b.units)) if (u.enemy === 'lace_black') u.out = 'down'
    expect(winnersOf(a.g.k, b)).toEqual({ enemies: [], faction: 'a', machines: false })
    const w = arena({ setup: base(white, white) })
    expect(winnersOf(w.g.k, w.g.state.battle!).enemies).toEqual([])
  })

  it('只剩白蕾絲站著：選到場地勢力的預設（白蕾絲自己寫的 pinned 不算）；沒有場地的勢力就是通用的', async () => {
    const { g } = await play({ setup: base(white) })
    expect(defeatOf(g.state)).toMatchObject({ event: 'df_a', tier: 'faction' })
    const noPlace = { ...base(white), origin: { escapable: false, ext: { by: 'caller' } } } as BattleSetup
    const none = await play({ setup: noPlace })
    expect(defeatOf(none.g.state)).toMatchObject({ event: 'df_generic', tier: 'generic' })
  })

  it('沒有白蕾絲的戰鬥照舊：站著的人都算', () => {
    const a = arena({ setup: base(black, pinkFoe) })
    expect(winnersOf(a.g.k, a.g.state.battle!).enemies.sort()).toEqual(['pinned', 'polluted'])
  })
})

// ---- 扣線 ----

describe('扣線：net、tethered 與條件', () => {
  const pink = { enemy: 'lace_pink', tags: ['lace:pink', 'tether'] }
  const tetheredAllies = { ext: { net: { sync: 'standard', tethered: true } } }
  const optionIds = (g: A['g']): string[] => ((eventView(g.k, g.state)?.options ?? []) as Array<{ id: string }>).map((o) => o.id)

  it('單位上標了扣線：等待中的戰敗 tethered 是 true；寫了 defeat_tethered 條件的選項看得到，沒有被扣線時看不到', async () => {
    const yes = await play({ setup: base2([pink], { allies: tetheredAllies }), rules: { defeatView: 'always' } })
    expect(defeatOf(yes.g.state)).toMatchObject({ net: true, tethered: true, stage: 'playing' })
    expect(optionIds(yes.g)).toEqual(['plain', 'cut', 'net_only'])
    expect(defeatView(yes.g.k, yes.g.state)).toMatchObject({ net: true, tethered: true, located: false })
    const no = await play({ setup: base(pink), rules: { defeatView: 'always' } })
    expect(defeatOf(no.g.state)).toMatchObject({ net: true, tethered: false })
    expect(optionIds(no.g)).toEqual(['plain', 'net_only'])
    expect(defeatView(no.g.k, no.g.state)).toMatchObject({ net: true, tethered: false })
  })

  it('紀錄裡有 tag tether、data.tethered 的那一拍（單位沒標）：也算被扣線', async () => {
    const { g } = await play({ setup: base(pink), features: [beatOnly] })
    expect(defeatOf(g.state)).toMatchObject({ net: true, tethered: true })
  })

  it('投降不扣線；現實的戰鬥沒有 net 與 tethered，兩個條件都不成立', async () => {
    const sur = await play({ setup: base2([pink], { allies: tetheredAllies }) }, 'surrender')
    expect(defeatOf(sur.g.state)).toMatchObject({ outcome: 'surrender', net: true, tethered: false })
    const meat = await play({ setup: BATTLE_SETUPS.hopeless(), rules: { defeatView: 'always' } })
    expect(optionIds(meat.g)).toEqual(['plain'])
    expect(defeatOf(meat.g.state)).not.toHaveProperty('tethered')
  })

  it('接受之後 activity.end 的 result 帶 net、tethered、located；現實的不帶這三個鍵', async () => {
    const { g, log } = await play({ setup: base2([pink], { allies: tetheredAllies }), located: true })
    g.commit(acceptDefeat(g.k, g.state))
    expect(log[0]!.result).toMatchObject({ net: true, tethered: true, located: true, event: 'df_a' })
    const meatSetup = { ...BATTLE_SETUPS.hopeless(), origin: { escapable: false, ext: { by: 'caller', ref: 'r1' } } } as BattleSetup
    const meat = await play({ setup: meatSetup })
    meat.g.commit(acceptDefeat(meat.g.k, meat.g.state))
    expect(meat.log[0]!.result).not.toHaveProperty('net')
    expect(meat.log[0]!.result).not.toHaveProperty('tethered')
  })

  it('事件演完（選了被扣線才有的選項）之後可以接受', async () => {
    const { g, log } = await play({ setup: base2([pink], { allies: tetheredAllies }), rules: { defeatView: 'always' } })
    g.commit(chooseOption(g.k, g.state, 'cut'))
    expect(defeatOf(g.state)).toMatchObject({ stage: 'played', played: { option: 'cut' } })
    g.commit(acceptDefeat(g.k, g.state))
    expect(log[0]!.result).toMatchObject({ option: 'cut', tethered: true })
  })
})

// ---- 三選一照舊 ----

describe('三選一照舊', () => {
  it('重來這一場：回到開打前（等待中的戰敗沒了、戰鬥回到第 1 輪）；回到階段在副本以外等於重來', async () => {
    const { g } = await play({ setup: base(pinkFoe), rules: { defeatView: 'always' } })
    expect(g.retryBattle()).toBeNull()
    expect(defeatOf(g.state)).toBeNull()
    expect(g.battle).toMatchObject({ round: 1 })
    const again = await play({ setup: base(pinkFoe), located: true })
    expect(again.g.rewindToStage()).toBeNull()
    expect(defeatOf(again.g.state)).toBeNull()
    expect(again.g.battle).not.toBeNull()
  })

  it('接受之後不再擋別的事：快照丟了、等待中的戰敗沒了', async () => {
    const { g } = await play({ setup: base(pinkFoe), located: true })
    expect(g.pendingDefeat).not.toBeNull()
    g.commit(acceptDefeat(g.k, g.state))
    expect(g.pendingDefeat).toBeNull()
    expect(g.state.snapshots).toEqual([])
    expect(g.blockOf('battle.start')).toBeNull()
  })

  it('同一個種子：選到同一件、欄位一樣；存檔再讀，net、tethered、located 還在', async () => {
    const run = async () => (await play({ setup: base2([pinkFoe], { allies: { ext: { net: { tethered: true } } } }), located: true, rules: { defeatView: 'always' } })).g
    const a = await run(), b = await run()
    expect(JSON.stringify(defeatOf(a.state))).toBe(JSON.stringify(defeatOf(b.state)))
    expect(a.load(a.save('manual', 't'))).toBeNull()
    expect(defeatOf(a.state)).toMatchObject({ net: true, tethered: true, located: true })
  })

  it('現實的戰鬥打輸照舊選事件（沒有內海的欄位）', async () => {
    const a = arena({ setup: BATTLE_SETUPS.hopeless() })
    playOut(a.g)
    await observed(a.g, () => a.g.finishBattle())
    expect(defeatOf(a.g.state)).toMatchObject({ tier: expect.any(String) })
    expect(defeatOf(a.g.state)!.net).toBeUndefined()
  })
})
