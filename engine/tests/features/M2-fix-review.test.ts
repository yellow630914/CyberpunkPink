// 驗收測試：dev/work/M2-fix-review.md（M2 引擎審查後的修正批；依據 dev/reviews/2026-11-23-M2.md、dev/adr/0016、0017）。
// 每一項一個 describe；內容一律用測試自帶的最小假資料（事件、範圍）加 testkit 的假世界（TEST_WORLD）。

import { describe, expect, it } from 'vitest'
import type { ContentPack, Feature, Kernel, ReportDraft } from '../../src'
import { Rng, attachActivityEnd, endActivity, hash32, isRecord, meterOf } from '../../src'
import { BATTLE_SETUPS, STRONG_PC, SUNDAY_MORNING, makeCityGame, makeCommissionGame, makeGame, makeWorldGame, playOut, playStage, stateHash, untilIdle } from '../../src/testkit'
import { chooseBranch, chooseFace, readRun, retreat } from '../../src/features/commission'
import { directorOf } from '../../src/features/director'
import { accept, board as fixerBoard, fixerFeature, go, jobOf } from '../../src/features/fixer'
import type { Offer } from '../../src/features/fixer'
import { breathDraft, sleepDraft } from '../../src/features/rest'
import { buildCreationReport } from '../../src/features/creation'
import type { CreationDraft } from '../../src/features/creation'
import { CAPTURE_EXT } from '../../src/features/enemies'
import { readRoster } from '../../src/features/roster'
import { securityFeature } from '../../src/features/security'
import { hostilityMarkup, tradeFeature } from '../../src/features/trade'
import { chooseOption, eventView } from '../../src/features/director'
import { sceneRawOf } from '../../src/features/scene'
import { board, advance, transitOf, wait } from '../../src/features/transit'
import { arrive } from '../../src/features/world'

type Fx = Record<string, unknown>

// ===================================================================================================================
// 必修 1：車上開打、開場景
// ===================================================================================================================

const opt = (id: string, text: string, o: Fx = {}): Fx => ({ id, text, outcomes: { any: [] }, ...o })
const RIDE_PACK = (trigger: 'transit_wait' | 'transit_stop' = 'transit_wait'): ContentPack => ({
  id: 'fix_ride',
  content: {
    event_scope: [{ id: 'transit', triggers: { transit_wait: 1, transit_stop: 1 }, cooldown_hours: 0, repeat_days: 0, lost: 'drop' }],
    event: [{
      id: 'ev_fix_ride', scope: 'transit', triggers: [trigger], category: 'trouble', adult: true,
      text: '有人在車廂裡盯著你。', cast: [{ role: 'a', gen: { kind: 'citizen', name: '陌生人' } }],
      options: [
        opt('fight', '動手。', { outcomes: { any: [{ kind: 'fight', foes: BATTLE_SETUPS.encounter().foes, cover: 'sparse' }] } }),
        opt('go', '跟他走。', { adult_scene: { when: 'always', gate: 'fixed', nature: 'mutual', role: 'none', goal: 'please', circles: [['$pc', '$a']] } }),
        opt('look', '看回去。'),
      ],
    }],
  } as unknown as ContentPack['content'],
})

/** 站在塔下站、上車、等車（transit_wait 的事件在車上開起來）。 */
function onTheTrain(trigger: 'transit_wait' | 'transit_stop' = 'transit_wait', seed = 3) {
  const t = makeCityGame({ seed, content: [RIDE_PACK(trigger)], patch: { time: { ...SUNDAY_MORNING } } })
  const g = t.game
  g.commit(arrive(g.k, g.state, 'tw_tower', 'F2'))
  g.commit(board(g.k, g.state, { line: 'tw_metro', pay: 'cred' }))
  return g
}

describe('必修 1：車上的事件選開打或開場景：這一趟車先結束，人在下一站', () => {
  const stationOf = (g: ReturnType<typeof onTheTrain>) => ({ block: g.state.location.block, facility: g.state.location.facility })

  it('車上開打（月台上等車時跳出來的事件）：戰鬥開得起來，這一趟結束，人在下一站，沒坐完的票作廢（車資只有已經付的起跳）', async () => {
    const g = onTheTrain()
    const cred0 = g.state.money.cred
    g.commit(wait(g.k, g.state))
    expect(eventView(g.k, g.state)).toMatchObject({ event: 'ev_fix_ride' })
    expect(g.k.activity.active(g.state).map((a) => a.kind)).toEqual(['event', 'ride'])
    const reports = g.commit(chooseOption(g.k, g.state, 'fight'))
    expect(reports.map((r) => r.action)).toEqual(['event.close', 'battle.start'])
    expect(g.state.battle).not.toBeNull()
    expect(transitOf(g.state).trip).toBeNull()
    expect(g.k.activity.active(g.state).map((a) => a.kind)).toEqual(['battle'])
    // 塔下站往院子的方向，下一站是院子站
    expect(stationOf(g)).toEqual({ block: 'tw_yard', facility: 'F1' })
    expect(transitOf(g.state).visited).toContain('tw_yard:F1')
    // 沒有補扣下一站的錢：車資只有上車時付的起跳
    expect(cred0 - g.state.money.cred).toBe(0)
    // 收尾那一份寫了這一趟到此為止，句子裡沒有數字（寫正文時數字不進文字）
    const close = reports.find((r) => r.action === 'event.close')!
    expect(JSON.stringify(close.narration?.results ?? [])).toMatch(/到此為止/)
    expect(JSON.stringify(close.narration?.results ?? [])).not.toMatch(/\d/)
    // 打完之後人還在下一站
    playOut(g)
    await g.finishBattle({ autoRules: true })
    expect(g.state.battle).toBeNull()
    expect(stationOf(g)).toEqual({ block: 'tw_yard', facility: 'F1' })
    expect(g.k.activity.active(g.state)).toEqual([])
  })

  it('車上開成人場景（癡漢）：場景開得起來，這一趟結束，人在下一站；場景走完之後什麼活動都不剩、人還在下一站', async () => {
    const g = onTheTrain()
    g.commit(wait(g.k, g.state))
    const reports = g.commit(chooseOption(g.k, g.state, 'go'))
    expect(reports.map((r) => r.action)).toEqual(['event.close', 'scene.start'])
    expect(sceneRawOf(g.state)).not.toBeNull()
    expect(transitOf(g.state).trip).toBeNull()
    expect(g.k.activity.active(g.state).map((a) => a.kind)).toEqual(['scene'])
    expect(stationOf(g)).toEqual({ block: 'tw_yard', facility: 'F1' })
    await untilIdle(g)
    expect(sceneRawOf(g.state)).toBeNull()
    expect(g.k.activity.active(g.state)).toEqual([])
    expect(stationOf(g)).toEqual({ block: 'tw_yard', facility: 'F1' })
    expect(transitOf(g.state).trip).toBeNull()
  })

  it('一站一站坐到中途才出事（transit_stop）：人在「再下一站」；到了終點站就留在終點站', async () => {
    const g = onTheTrain('transit_stop')
    g.commit(wait(g.k, g.state)) // 這個版本的事件只在每一站跳出來
    expect(eventView(g.k, g.state)).toBeNull()
    g.commit(advance(g.k, g.state)) // 塔下 → 院子（終點站）
    expect(eventView(g.k, g.state)).toMatchObject({ event: 'ev_fix_ride' })
    expect(stationOf(g)).toEqual({ block: 'tw_tower', facility: 'F2' }) // 站在上車的那一塊（人要下車才會換位置）
    g.commit(chooseOption(g.k, g.state, 'fight'))
    expect(transitOf(g.state).trip).toBeNull()
    expect(stationOf(g)).toEqual({ block: 'tw_yard', facility: 'F1' }) // 終點站沒有下一站，停在這一站
    playOut(g)
    await g.finishBattle({ autoRules: true })
    expect(stationOf(g)).toEqual({ block: 'tw_yard', facility: 'F1' })
  })

  it('選了不開戰鬥也不開場景的選項：車照樣在，這一趟不結束', () => {
    const g = onTheTrain()
    g.commit(wait(g.k, g.state))
    g.commit(chooseOption(g.k, g.state, 'look'))
    expect(transitOf(g.state).trip).not.toBeNull()
    expect(g.k.activity.active(g.state).map((a) => a.kind)).toEqual(['ride'])
    expect(stationOf(g)).toEqual({ block: 'tw_tower', facility: 'F2' })
  })

  it('存讀檔：開打之後、打到一半、打完之後各存讀一次，狀態一模一樣，讀完人還在下一站', async () => {
    const g = onTheTrain()
    g.commit(wait(g.k, g.state))
    g.commit(chooseOption(g.k, g.state, 'fight'))
    const roundTrip = (): void => {
      const before = JSON.stringify(g.state)
      expect(g.load(g.save())).toBeNull()
      expect(JSON.stringify(g.state)).toBe(before)
    }
    roundTrip()
    g.battleNext({ anyone: true })
    roundTrip()
    playOut(g)
    await g.finishBattle({ autoRules: true })
    roundTrip()
    expect(stationOf(g)).toEqual({ block: 'tw_yard', facility: 'F1' })
    expect(transitOf(g.state).trip).toBeNull()
  })

  it('回退：回到選項之前，人又在車上、車票還在、事件視窗開著（人回到上車的那一站）', () => {
    const g = onTheTrain()
    g.commit(wait(g.k, g.state))
    const before = JSON.stringify(g.state)
    g.commit(chooseOption(g.k, g.state, 'fight'))
    expect(g.undoSteps(1)).toBe(true)
    expect(JSON.stringify(g.state)).toBe(before)
    expect(transitOf(g.state).trip).not.toBeNull()
    expect(eventView(g.k, g.state)).toMatchObject({ event: 'ev_fix_ride' })
    // 回去之後改選場景也一樣走得通
    g.commit(chooseOption(g.k, g.state, 'go'))
    expect(sceneRawOf(g.state)).not.toBeNull()
    expect(transitOf(g.state).trip).toBeNull()
  })
})

// ===================================================================================================================
// 副本的場景：進辦公室的副本（cm_tw_office：第一階段有強攻與潛行兩條路）
// ===================================================================================================================

function inCommission(seed = 5) {
  const { game: g } = makeWorldGame({ seed, pc: STRONG_PC, patch: { time: { day: 3, hour: 10, minute: 0 }, money: { cred: 500, cash: 1000 } } })
  g.commit(arrive(g.k, g.state, 'tw_market', 'E1'))
  g.launch('commission', { def: 'cm_tw_office' }, { by: 'fix_review', ref: 'cm_tw_office' })
  return g
}
type CG = ReturnType<typeof inCommission>

/** 選現實面、走潛行那條路（擲一次）：回傳擲出的自然骰與擲骰之前的亂數狀態。 */
function stealthRoll(g: CG): { natural: number; before: { seed: number; cursor: number } } {
  g.commit(chooseFace(g.k, g.state, 'meat'))
  const before = { ...g.state.rng }
  const reports = g.commit(chooseBranch(g.k, g.state, 'duct'))
  const roll = reports[0]!.timeline.find((b) => b.roll)?.roll
  if (!roll) throw new Error('這條路沒有擲骰')
  return { natural: roll.natural, before }
}
/** 那一擲的骰子是從哪一個亂數狀態導出來的（種子、游標、用途一樣，結果就一樣）。 */
const dieOf = (before: { seed: number; cursor: number }): number => new Rng(hash32(before.seed, before.cursor, 'commission/cm_tw_office/1/branch', 0)).state

// ===================================================================================================================
// 應修 1：回到階段開始、回到入口不是「隨時可用」
// ===================================================================================================================

describe('應修 1：副本裡沒打輸，回到階段開始與回到入口都被擋；撤退只走 commission.retreat', () => {
  it('選了面、選了分支之後：rewindToKind(stage／entry) 都被擋，回傳副本進行中的原因，狀態與回退的步數都不變', () => {
    const g = inCommission()
    g.commit(chooseFace(g.k, g.state, 'meat'))
    const hash = stateHash(g.state)
    for (const kind of ['stage', 'entry']) {
      expect(g.blockOf(`rewind:${kind}`)).toMatch(/進行中，只能做副本裡的事/)
      expect(g.rewindToKind(kind, '回去')).toMatch(/進行中，只能做副本裡的事/)
    }
    expect(stateHash(g.state)).toBe(hash)
    expect(readRun(g.state)).toMatchObject({ step: 'branch' })
    // 還是可以走正式的撤退
    const reports = g.commit(retreat(g.k, g.state))
    expect(reports.map((r) => r.action)).toEqual(expect.arrayContaining(['commission.retreat', 'rewind']))
    expect(readRun(g.state)).toBeNull()
  })

  it('放行表裡沒有 rewind:stage、rewind:entry（別的前綴照舊）', () => {
    const g = inCommission()
    expect(g.k.activity.get('commission')!.allow.filter((p) => p.startsWith('rewind:'))).toEqual([])
    expect(g.blockOf('commit:commission.face')).toBeNull()
  })

  it('打輸之後的三選一照舊有「回到這個階段開始時」（Game.rewindToStage 只在等著選的戰敗才成立）', () => {
    const g = inCommission()
    expect(g.rewindToStage()).toBe('現在沒有在等戰敗的選擇。')
  })
})

// ===================================================================================================================
// 應修 2：撤退之後再進去，骰子換一批
// ===================================================================================================================

describe('應修 2：撤退（與委託失敗）回去之後骰子不固定；一般的回退照舊固定', () => {
  it('同一個種子撤退兩次：三趟的第一擲各用不同的亂數，游標一直往前推，種子不動', () => {
    const g = inCommission()
    const seed = g.state.rng.seed
    const a = stealthRoll(g)
    g.commit(retreat(g.k, g.state))
    expect(g.state.rng.seed).toBe(seed)
    expect(g.state.rng.cursor).toBeGreaterThan(a.before.cursor + 1) // 比第一擲之前、擲完之後都大
    g.launch('commission', { def: 'cm_tw_office' }, { by: 'fix_review', ref: 'cm_tw_office' })
    const b = stealthRoll(g)
    g.commit(retreat(g.k, g.state))
    g.launch('commission', { def: 'cm_tw_office' }, { by: 'fix_review', ref: 'cm_tw_office' })
    const c = stealthRoll(g)
    expect(new Set([a.before.cursor, b.before.cursor, c.before.cursor]).size).toBe(3)
    expect(new Set([dieOf(a.before), dieOf(b.before), dieOf(c.before)]).size).toBe(3)
    expect(g.state.rng.seed).toBe(seed)
  })

  it('看得見的差別：二十個種子，撤退再進去，第一擲的點數多半不一樣（潛行失敗直接開打的種子不能撤退，略過）', () => {
    let tried = 0
    let differ = 0
    for (let seed = 1; seed <= 20; seed++) {
      const g = inCommission(seed)
      const a = stealthRoll(g)
      if (g.state.battle) continue
      tried++
      g.commit(retreat(g.k, g.state))
      g.launch('commission', { def: 'cm_tw_office' }, { by: 'fix_review', ref: 'cm_tw_office' })
      const b = stealthRoll(g)
      if (a.natural !== b.natural) differ++
    }
    expect(tried).toBeGreaterThanOrEqual(10)
    expect(differ).toBeGreaterThanOrEqual(Math.floor(tried * 0.6))
  })

  it('一般的回退不變：回到進去之前（Game.rewindTo、回退一步）之後，同一條路擲出同樣的骰子，亂數回到快照的', () => {
    const g = inCommission(7)
    const entry = g.state.snapshots.find((x) => x.kind === 'entry')!
    const cursorAtEntry = g.state.rng.cursor
    const a = stealthRoll(g)
    expect(g.rewindTo(entry.id, { summary: '回到進去之前。' })).toBeNull()
    expect(g.state.rng.cursor).toBe(cursorAtEntry)
    g.launch('commission', { def: 'cm_tw_office' }, { by: 'fix_review', ref: 'cm_tw_office' })
    const b = stealthRoll(g)
    expect(b.natural).toBe(a.natural)
    expect(dieOf(b.before)).toBe(dieOf(a.before))
    // 回退一步（undo）也是固定骰值
    expect(g.undoSteps(1)).toBe(true)
    const c = g.commit(chooseBranch(g.k, g.state, 'duct'))[0]!.timeline.find((x) => x.roll)!.roll!
    expect(c.natural).toBe(a.natural)
  })

  it('報告的 rewind.fresh 要是布林；Game.rewindToKind 的 fresh 選項只有明講才換骰子（游標比回去之前的還大）', () => {
    const t = makeCityGame({ seed: 4 })
    const g = t.game
    const sys = (changes: Array<Record<string, unknown>>, extra: Record<string, unknown> = {}) => ({
      kind: 'system' as const, action: 'test.step', location: {}, party: [], timeline: [], changes: changes as never, outcome: { result: 'ok', summary: '測試。' }, ...extra,
    })
    expect(() => g.commit(sys([], { rewind: { kind: 'mark', summary: 'x', fresh: 'yes' } }))).toThrow(/fresh/)
    g.commit(sys([{ op: 'snapshot.take', kind: 'mark', label: '記號', owner: 'test' }]))
    const atMark = g.state.rng.cursor
    g.commit(sys([{ op: 'rng', advance: 3 }]))
    const later = g.state.rng.cursor
    expect(later).toBe(atMark + 3)
    expect(g.rewindToKind('mark', '一般的回去。')).toBeNull()
    expect(g.state.rng.cursor).toBe(atMark) // 一般的回退：亂數回到快照的
    g.commit(sys([{ op: 'snapshot.take', kind: 'mark', label: '記號', owner: 'test' }]))
    g.commit(sys([{ op: 'rng', advance: 3 }]))
    const now = g.state.rng.cursor
    expect(g.rewindToKind('mark', '重來。', { fresh: true })).toBeNull()
    expect(g.state.rng.cursor).toBe(now + 1) // 比快照的、比現在的都大
  })
})

// ===================================================================================================================
// 應修 3：副本內的事件——同一件委託不重複；壓力條漲過門檻多擲一次
// ===================================================================================================================

/** 副本內的範圍：每個階段開始必中、壓力條必中；通知型的事件（不擋，好數）。 */
const CM_SCOPE = (o: Fx = {}): Fx => ({
  id: 'commission', triggers: { stage: 1, pressure: 1 }, events_as: { pressure: 'stage' }, priority: 1, in_commission: true, unique_in_commission: true, lost: 'drop', ...o,
})
const note = (id: string, triggers: string[] = ['stage']): Fx => ({ id, scope: 'commission', triggers, blocking: false, text: `${id}：副本裡的小插曲。`, effects: [] })
const eventPack = (events: Fx[], scope: Fx = CM_SCOPE()): ContentPack => ({ id: 'fix_cm_events', content: { event_scope: [scope], event: events } as unknown as ContentPack['content'] })
function withEvents(events: Fx[], scope: Fx = CM_SCOPE(), seed = 5) {
  const { game: g } = makeWorldGame({ seed, pc: STRONG_PC, content: [eventPack(events, scope)], patch: { time: { day: 3, hour: 10, minute: 0 }, money: { cred: 500, cash: 1000 } } })
  g.commit(arrive(g.k, g.state, 'tw_market', 'E1'))
  g.launch('commission', { def: 'cm_tw_office' }, { by: 'fix_review', ref: 'cm_tw_office' })
  return g
}
type EG = ReturnType<typeof withEvents>
const noticed = (reports: Array<{ action?: string; timeline: Array<{ data?: Record<string, unknown> }> }>): string[] =>
  reports.filter((r) => r.action === 'event.notice').map((r) => String(r.timeline[0]!.data!.event))
const allNotices = (g: EG): string[] => noticed(g.state.reports.filter((r) => !r.retracted))

describe('應修 3：副本內的事件同一件委託不重複', () => {
  it('每個階段開始都必中的範圍：兩件事件輪流各出一次，第三個階段沒有可抽的就不出（不會重複）', async () => {
    const g = withEvents([note('ev_a'), note('ev_b')])
    await playStage(g) // 第一階段：選面時擲一次
    await playStage(g) // 第二階段
    const got = allNotices(g)
    expect(got).toHaveLength(2)
    expect(new Set(got).size).toBe(2)
    expect(directorOf(g.state).in_commission).toMatchObject({ id: 'cm_tw_office' })
    expect([...directorOf(g.state).in_commission!.events].sort()).toEqual(['ev_a', 'ev_b'])
    // 第三個階段：兩件都出過了
    const before = allNotices(g).length
    g.commit(chooseFace(g.k, g.state, 'meat'))
    expect(allNotices(g)).toHaveLength(before)
  })

  it('對照：範圍不寫 unique_in_commission，同一件事件每個階段都會再出', async () => {
    const g = withEvents([note('ev_a')], CM_SCOPE({ unique_in_commission: false }))
    await playStage(g)
    g.commit(chooseFace(g.k, g.state, 'meat'))
    expect(allNotices(g)).toEqual(['ev_a', 'ev_a'])
  })

  it('撤退回到進去之前，重進同一件委託不算重複（記的東西跟著狀態回去）', () => {
    const g = withEvents([note('ev_a')])
    g.commit(chooseFace(g.k, g.state, 'meat'))
    expect(allNotices(g)).toEqual(['ev_a'])
    g.commit(retreat(g.k, g.state))
    expect(directorOf(g.state).in_commission).toBeUndefined()
    g.launch('commission', { def: 'cm_tw_office' }, { by: 'fix_review', ref: 'cm_tw_office' })
    g.commit(chooseFace(g.k, g.state, 'meat'))
    expect(noticed(g.state.reports.filter((r) => !r.retracted))).toEqual(['ev_a'])
  })

  it('範圍的格式：unique_in_commission 要是布林；events_as 的兩邊都要在 triggers 的表裡', () => {
    const g = withEvents([note('ev_a')])
    expect(g.k.content.validate('event_scope', [{ id: 's_x', triggers: { stage: 1 }, unique_in_commission: 'yes' }]).join('')).toMatch(/unique_in_commission/)
    expect(g.k.content.validate('event_scope', [{ id: 's_x', triggers: { stage: 1 }, events_as: { pressure: 'stage' } }]).join('')).toMatch(/events_as\.pressure/)
    expect(g.k.content.validate('event_scope', [{ id: 's_x', triggers: { stage: 1, pressure: 1 }, events_as: { pressure: 'nowhere' } }]).join('')).toMatch(/nowhere/)
    expect(g.k.content.validate('event_scope', [{ id: 's_x', triggers: { stage: 1, pressure: 1 }, events_as: { pressure: 'stage' } }])).toEqual([])
  })
})

describe('應修 3：警戒（壓力條）漲過門檻，導演多擲一次', () => {
  /** 選面、選強攻，走到地圖上；之後用一份測試的報告把這張地圖的警戒設成 n。 */
  function onMap(events: Fx[], scope: Fx = CM_SCOPE({ triggers: { stage: 0, pressure: 1 } }), alertStart = 0) {
    const { game: g } = makeWorldGame({ seed: 5, pc: STRONG_PC, content: [eventPack(events, scope)], patch: { time: { day: 3, hour: 10, minute: 0 }, money: { cred: 500, cash: 1000 } } })
    g.commit(arrive(g.k, g.state, 'tw_market', 'E1'))
    g.launch('commission', { def: 'cm_tw_office', alert_start: alertStart }, { by: 'fix_review', ref: 'cm_tw_office' })
    g.commit(chooseFace(g.k, g.state, 'meat'))
    g.commit(chooseBranch(g.k, g.state, 'assault'))
    return g
  }
  const setAlert = (g: EG, n: number) => g.commit({
    kind: 'gig', action: 'commission.test', location: {}, party: [], timeline: [], changes: [{ op: 'meter', kind: 'alert', key: readRun(g.state)!.map!, set: n }], outcome: { result: 'ok', summary: `警戒 ${n}。` },
  })
  const actionsOf = (rs: Array<{ action?: string }>): string[] => rs.map((r) => r.action ?? '')

  it('警戒從 60 以下漲到 60 以上：接一份 commission.pressure（帶 pressure 觸發點），導演擲中就放行事件（事件寫的觸發點是 stage，一樣收）；整個階段只一次', () => {
    const g = onMap([note('ev_p')])
    expect(allNotices(g)).toEqual([]) // 這個範圍的 stage 機率是 0，選面時沒有事
    const a = setAlert(g, 59)
    expect(actionsOf(a)).toEqual(['commission.test'])
    const b = setAlert(g, 70)
    expect(actionsOf(b)).toEqual(['commission.test', 'commission.pressure', 'event.notice'])
    expect(b[1]!.triggers).toEqual([{ point: 'pressure', where: expect.objectContaining({ face: 'meat' }) }])
    expect(noticed(b)).toEqual(['ev_p'])
    expect(readRun(g.state)!.pressured).toBe(true)
    // 再漲、降了再漲：這個階段不再擲
    expect(actionsOf(setAlert(g, 90))).toEqual(['commission.test'])
    expect(actionsOf(setAlert(g, 10))).toEqual(['commission.test'])
    expect(actionsOf(setAlert(g, 80))).toEqual(['commission.test'])
  })

  it('一開地圖警戒就在門檻以上：不算跨過，不擲', () => {
    const g = onMap([note('ev_p')], CM_SCOPE({ triggers: { stage: 0, pressure: 1 } }), 70)
    expect(readRun(g.state)!.pressured).toBe(true)
    expect(actionsOf(setAlert(g, 80))).toEqual(['commission.test'])
    expect(allNotices(g)).toEqual([])
  })

  it('壓力條的機率是範圍自己寫的（15%）：機率 0 就不放行，但這個階段的壓力條還是記成發過了', () => {
    const g = onMap([note('ev_p')], CM_SCOPE({ triggers: { stage: 0, pressure: 0 } }))
    expect(actionsOf(setAlert(g, 80))).toEqual(['commission.test', 'commission.pressure'])
    expect(allNotices(g)).toEqual([])
  })

  it('事件直接寫 pressure 也收；寫 stage 的也收（events_as）；不在這個範圍的不收', () => {
    const g = onMap([note('ev_direct', ['pressure'])])
    expect(noticed(setAlert(g, 80))).toEqual(['ev_direct'])
  })

  it('警戒整趟累計：第一個階段漲過之後，下一個階段一開地圖就在門檻以上，不再算「跨過」（整趟只擲一次）', async () => {
    // 每一段的地圖一開（commission.branch 的報告）就把那張地圖的警戒設成 80：下一份報告（走路）才看得到「漲過了」
    const bump: Feature = {
      id: 'bump_alert',
      install(k) {
        k.hooks.on('report.before', 'bump_alert', ({ draft }) => {
          if (draft.action !== 'commission.branch') return
          const set = draft.changes.find((c) => c.op === 'meter' && c.kind === 'alert')
          return set ? [{ op: 'meter', kind: 'alert', key: String(set.key), set: 80 }] : undefined
        })
      },
    }
    const { game: g } = makeWorldGame({
      seed: 5, pc: STRONG_PC, features: [bump], content: [eventPack([note('ev_a'), note('ev_b')], CM_SCOPE({ triggers: { stage: 0, pressure: 1 } }))],
      patch: { time: { day: 3, hour: 10, minute: 0 }, money: { cred: 500, cash: 1000 } },
    })
    g.commit(arrive(g.k, g.state, 'tw_market', 'E1'))
    g.launch('commission', { def: 'cm_tw_office' }, { by: 'fix_review', ref: 'cm_tw_office' })
    const first = await playStage(g)
    expect(actionsOf(first).filter((a) => a === 'commission.pressure')).toHaveLength(1)
    expect(readRun(g.state)).toMatchObject({ stage: 2 })
    expect(readRun(g.state)!.pressured).toBeUndefined() // 階段之間清掉
    const second = await playStage(g)
    expect(actionsOf(second).filter((a) => a === 'commission.pressure')).toHaveLength(0) // 警戒帶著走：這個階段一開地圖就是 80
    expect(allNotices(g)).toHaveLength(1)
  })
})

// ===================================================================================================================
// 應修 5：完成委託，委託人勢力的好感 +3（評價最高 +5）
// 應修 7：目標勢力的敵對值對委託的後果（找麻煩：遭遇預算 +1；追捕：警戒起始 +20；懸賞：它罩的中間人不接）
// ===================================================================================================================

type Rec = Record<string, unknown>
const faces = (names: string[]): Rec => Object.fromEntries(names.map((f) => [f, {}]))
const offer = (id: string, extra: Rec = {}): Offer => ({
  id, title: `${id} 的委託`, brief: `簡報：${id}。`, reward: 2000, unknowns: [],
  commission: {
    id: `cm_${id}`, name: `委託 ${id}`, kind: 'steal_item', main: 'meat', scale: 'small', grade: 1, target_faction: 'f_gang', district: 'd_x',
    stages: [{ faces: faces(['meat']) }, { faces: faces(['meat']) }, { faces: faces(['meat']) }], ...extra,
  },
}) as unknown as Offer

/** 中間人桌上的委託（照名字給）；副本用替身活動（進去時記下 setup 與 origin）。 */
const FIX_PACK: ContentPack = {
  id: 'fix_review_fixer',
  content: {
    faction: [{ id: 'f_gang', name: '野良幫', short: '野良', class: 'street' }, { id: 'f_corp', name: '緋櫻', short: '緋櫻', class: 'corp' }],
    npc: [{ id: 'npc_mama', name: '媽媽桑' }],
    fixer: [
      { id: 'fx_a', name: '半夢的媽媽桑', npc: 'npc_mama', district: 'd_x', kinds: ['steal_item'], cut: 0.1, backer: 'f_gang' },
      { id: 'fx_free', name: '自由的中間人', npc: 'npc_mama', district: 'd_x', kinds: ['steal_item'], cut: 0.1 },
    ],
  } as unknown as ContentPack['content'],
}
const OFFERS: Record<string, Offer[]> = {
  fx_a: [offer('o_plain'), offer('o_employer', { employer: 'f_corp' })],
  fx_free: [offer('o_free')],
}
const OFFER_FEATURE: Feature = { id: 'fix_offers', install(k: Kernel) { k.hooks.on('fixer.offers', 'fix_offers', ({ fixer }) => structuredClone(OFFERS[fixer.id])) } }
const CM_STUB: Feature = {
  id: 'cm_stub',
  install(k: Kernel) {
    k.activity.define({
      kind: 'commission', owner: 'cm_stub', order: 90,
      active: (st) => (isRecord(st.ext.cm_stub) ? { id: 'cm', label: '副本' } : null),
      allow: ['stub.', 'commit:stub.'], reason: () => '副本進行中。',
      start: (_k, st, setup, origin) => [{
        kind: 'gig', action: 'stub.enter', location: { ...st.location }, party: [], timeline: [],
        changes: [{ op: 'snapshot.take', kind: 'entry', label: '進入副本前' }, { op: 'ext', key: 'cm_stub', value: { setup, origin } }], outcome: { result: 'entered', summary: '進了副本。' },
      }],
    })
  },
}
function fixerGame() {
  const { game: g } = makeGame({ features: [securityFeature, fixerFeature, OFFER_FEATURE, CM_STUB], content: [FIX_PACK], patch: { money: { cred: 0, cash: 1000 } } })
  return g
}
type FG = ReturnType<typeof fixerGame>
const sys = (changes: ReportDraft['changes']): ReportDraft => ({ kind: 'system', action: 'test.setup', location: {}, party: [], timeline: [], changes, outcome: { result: 'ok', summary: '測試。' } })
const setMeter = (g: FG, kind: string, key: string, set: number): void => void g.commit(sys([{ op: 'meter', kind, key, set }]))
const takeJob = (g: FG, id: string, fixer = 'fx_a'): void => void g.commit(accept(g.k, g.state, { id, fixer }, { pay: 'cash' }))
function endStub(g: FG, rating: string) {
  const st = g.state.ext.cm_stub as { origin: { by: string; ref?: string } }
  const end = endActivity(g.k, { state: g.state, kind: 'commission', id: 'cm', origin: st.origin, outcome: 'done', result: { rating, xp: 20 } })
  return g.commit(attachActivityEnd({
    kind: 'gig', action: 'stub.end', location: {}, party: [], timeline: [], changes: [{ op: 'ext', key: 'cm_stub', value: null }, ...end.changes], outcome: { result: 'done', summary: '副本結束。' },
  }, end))
}
const stubSetup = (g: FG) => (g.state.ext.cm_stub as { setup: Rec }).setup
const favorOf = (g: FG, f: string): number => meterOf(g.k, g.state, 'favor', f)

describe('應修 5：完成委託，委託人勢力的好感 +3，評價最高再 +2', () => {
  it('評價 B：委託人（commission.employer）的好感 +3（從起始的 10 起算）；別的勢力不動', () => {
    const g = fixerGame()
    takeJob(g, 'o_employer')
    expect(favorOf(g, 'f_corp')).toBe(10)
    g.commit(go(g.k, g.state, 'o_employer'))
    const reports = endStub(g, 'B')
    expect(favorOf(g, 'f_corp')).toBe(13)
    expect(favorOf(g, 'f_gang')).toBe(10)
    const lines = reports.find((r) => r.action === 'fixer.payout')!.narration?.results ?? []
    expect(lines.join('')).toMatch(/好感/)
  })

  it('評價 S（最高）：+3 再 +2 共 +5；評價 A 只有 +3', () => {
    const s = fixerGame()
    takeJob(s, 'o_employer')
    s.commit(go(s.k, s.state, 'o_employer'))
    endStub(s, 'S')
    expect(favorOf(s, 'f_corp')).toBe(15)
    const a = fixerGame()
    takeJob(a, 'o_employer')
    a.commit(go(a.k, a.state, 'o_employer'))
    endStub(a, 'A')
    expect(favorOf(a, 'f_corp')).toBe(13)
  })

  it('沒有寫委託人勢力的委託：沒有好感可加；失敗也不加', () => {
    const g = fixerGame()
    takeJob(g, 'o_plain')
    g.commit(go(g.k, g.state, 'o_plain'))
    endStub(g, 'S')
    expect(favorOf(g, 'f_corp')).toBe(10)
    expect(favorOf(g, 'f_gang')).toBe(10)
    const f = fixerGame()
    takeJob(f, 'o_employer')
    f.commit(go(f.k, f.state, 'o_employer'))
    const st = f.state.ext.cm_stub as { origin: { by: string; ref?: string } }
    const end = endActivity(f.k, { state: f.state, kind: 'commission', id: 'cm', origin: st.origin, outcome: 'failed', result: {} })
    f.commit(attachActivityEnd({ kind: 'gig', action: 'stub.fail', location: {}, party: [], timeline: [], changes: [{ op: 'ext', key: 'cm_stub', value: null }, ...end.changes], outcome: { result: 'failed', summary: '失敗。' } }, end))
    expect(favorOf(f, 'f_corp')).toBe(10)
  })

  it('好感一次最多加 5（AI 給的上限不管程式自己的結算）：S 評價的 +5 整筆進去', () => {
    const g = fixerGame()
    setMeter(g, 'favor', 'f_corp', 50)
    takeJob(g, 'o_employer')
    g.commit(go(g.k, g.state, 'o_employer'))
    endStub(g, 'S')
    expect(favorOf(g, 'f_corp')).toBe(55)
  })
})

describe('應修 7：目標勢力的敵對值對委託的後果（FACTIONS 6.1 節）', () => {
  it('沒注意、記名：出發的設定沒有加成', () => {
    for (const h of [0, 19, 20, 39]) {
      const g = fixerGame()
      setMeter(g, 'hostility', 'f_gang', h)
      takeJob(g, 'o_plain')
      g.commit(go(g.k, g.state, 'o_plain'))
      expect(stubSetup(g), `敵對值 ${h}`).toMatchObject({ alert_start: 0 })
      expect(stubSetup(g)).not.toHaveProperty('encounter_plus')
    }
  })

  it('找麻煩（40～59）：遭遇預算 +1，警戒起始不加', () => {
    for (const h of [40, 59]) {
      const g = fixerGame()
      setMeter(g, 'hostility', 'f_gang', h)
      takeJob(g, 'o_plain')
      const reports = g.commit(go(g.k, g.state, 'o_plain'))
      expect(stubSetup(g), `敵對值 ${h}`).toMatchObject({ alert_start: 0, encounter_plus: 1 })
      expect(reports[0]!.narration?.results?.join('')).toMatch(/找你麻煩/)
    }
  })

  it('追捕（60 以上）：遭遇預算 +1 加上警戒起始 +20（高的段包含低的段）；懸賞、通緝也一樣', () => {
    for (const h of [60, 79, 80, 100]) {
      const g = fixerGame()
      setMeter(g, 'hostility', 'f_gang', h)
      // 懸賞以上時目標勢力罩的中間人不接，所以這一件從沒有後台的中間人手上接
      takeJob(g, h >= 80 ? 'o_free' : 'o_plain', h >= 80 ? 'fx_free' : 'fx_a')
      const reports = g.commit(go(g.k, g.state, h >= 80 ? 'o_free' : 'o_plain'))
      expect(stubSetup(g), `敵對值 ${h}`).toMatchObject({ alert_start: 20, encounter_plus: 1 })
      expect(reports[0]!.narration?.results?.join('')).toMatch(/追捕/)
    }
  })

  it('別的勢力的敵對值不算：只看這件委託的目標勢力；警戒起始上限 100', () => {
    const g = fixerGame()
    setMeter(g, 'hostility', 'f_corp', 90)
    takeJob(g, 'o_plain')
    g.commit(go(g.k, g.state, 'o_plain'))
    expect(stubSetup(g)).toMatchObject({ alert_start: 0 })
    const h = fixerGame()
    setMeter(h, 'hostility', 'f_gang', 70)
    takeJob(h, 'o_plain')
    h.commit(go(h.k, h.state, 'o_plain'))
    expect(stubSetup(h).alert_start).toBe(20)
  })

  it('沒有裝敵對值的功能（沒有 hostility_tier 條件）：出發照舊，沒有加成', () => {
    const { game: g } = makeGame({ features: [fixerFeature, OFFER_FEATURE, CM_STUB], content: [FIX_PACK] })
    takeJob(g as unknown as FG, 'o_plain')
    g.commit(go(g.k, g.state, 'o_plain'))
    expect(stubSetup(g as unknown as FG)).toMatchObject({ alert_start: 0 })
    expect(stubSetup(g as unknown as FG)).not.toHaveProperty('encounter_plus')
  })

  it('懸賞（80 以上）：它罩的中間人不接你：桌上沒有委託、給原因；79 以下照常；沒有後台的中間人照常', () => {
    const g = fixerGame()
    setMeter(g, 'hostility', 'f_gang', 79)
    expect(fixerBoard(g.k, g.state, 'fx_a')).toMatchObject({ open: true })
    expect(fixerBoard(g.k, g.state, 'fx_a').offers).toHaveLength(2)
    setMeter(g, 'hostility', 'f_gang', 80)
    const closed = fixerBoard(g.k, g.state, 'fx_a')
    expect(closed).toMatchObject({ open: false, offers: [] })
    expect(closed.reason).toMatch(/野良懸賞要你.*不肯接你/)
    expect(() => accept(g.k, g.state, { id: 'o_plain', fixer: 'fx_a' }, { pay: 'cash' })).toThrow(/不肯接你/)
    expect(fixerBoard(g.k, g.state, 'fx_free')).toMatchObject({ open: true })
    expect(fixerBoard(g.k, g.state, 'fx_free').offers).toHaveLength(1)
    // 已經在手上的委託不受影響（接案之前才看）
    setMeter(g, 'hostility', 'f_gang', 0)
    takeJob(g, 'o_plain')
    setMeter(g, 'hostility', 'f_gang', 90)
    expect(jobOf(g.state, 'o_plain')).not.toBeNull()
    expect(() => g.commit(go(g.k, g.state, 'o_plain'))).not.toThrow()
  })
})

describe('應修 7：真的副本——敵對值讓守備多一個雜兵、警戒起始升高', () => {
  /** 接案（makeCommissionGame 已經接好）、把目標勢力的敵對值設成 h、出發、選現實面與強攻，看第一個階段地圖上的守備與警戒。 */
  function openStage(h: number) {
    const t = makeCommissionGame({ seed: 6 })
    const g = t.game
    const target = String(jobOf(g.state, t.job)!.commission.target_faction)
    g.commit(sys([{ op: 'meter', kind: 'hostility', key: target, set: h }]))
    g.commit(go(g.k, g.state, t.job))
    g.commit(chooseFace(g.k, g.state, 'meat'))
    g.commit(chooseBranch(g.k, g.state, 'assault'))
    const run = readRun(g.state)!
    const ext = g.state.maps.instances[run.map!]!.ext as { guards?: Record<string, { foes: unknown[] }> }
    const foes = Object.values(ext.guards ?? {}).reduce((n, x) => n + x.foes.length, 0)
    return { run, foes, alert: meterOf(g.k, g.state, 'alert', run.map!) }
  }

  it('沒注意：守備與警戒照常；找麻煩：多一個雜兵；追捕：多一個雜兵、警戒從 20 起算', () => {
    const base = openStage(0)
    expect(base.alert).toBe(0)
    expect(base.foes).toBeGreaterThan(0)
    const trouble = openStage(45)
    expect(trouble.foes).toBe(base.foes + 1)
    expect(trouble.alert).toBe(0)
    expect(trouble.run.setup.encounter_plus).toBe(1)
    const pursuit = openStage(65)
    expect(pursuit.foes).toBe(base.foes + 1)
    expect(pursuit.alert).toBe(20)
    expect(pursuit.run.alert).toBe(20)
  })
})

describe('commission setup.encounter_plus 的格式', () => {
  it('0～4 的整數；0 不記；其餘擋下並寫出原因', () => {
    const { game: g } = makeWorldGame({ seed: 5, pc: STRONG_PC })
    for (const bad of [-1, 5, 1.5, '1']) expect(() => g.launch('commission', { def: 'cm_tw_office', encounter_plus: bad })).toThrow(/encounter_plus/)
    g.launch('commission', { def: 'cm_tw_office', encounter_plus: 0 })
    expect(readRun(g.state)!.setup).not.toHaveProperty('encounter_plus')
  })
})

describe('應修 7（交易那一半）：敵對值的物價分段的規則格式', () => {
  it('hostility_markups 要是遞增的 [敵對值, 倍率]，倍率 1 以上；60 以上不做生意由 hostility_refuse_at 管', () => {
    const { game: g } = makeGame({ features: [tradeFeature] })
    const bad = (rule: Rec) => g.k.content.validate('trade_rule', [{ id: 'default', ...rule }]).join('；')
    expect(bad({ hostility_markups: [[20, 1.1], [40, 1.2]] })).toBe('')
    expect(bad({ hostility_markups: [] })).toBe('')
    expect(bad({ hostility_markups: [[40, 1.2], [20, 1.1]] })).toMatch(/hostility_markups/)
    expect(bad({ hostility_markups: [[20, 0.9]] })).toMatch(/hostility_markups/)
    expect(bad({ hostility_markups: [[20]] })).toMatch(/hostility_markups/)
    expect(bad({ hostility_markups: 1.2 })).toMatch(/hostility_markups/)
    expect(bad({ hostility_refuse_at: -1 })).toMatch(/hostility_refuse_at/)
  })

  it('hostilityMarkup：取最後一個達到的；沒有達到的是 1', () => {
    const rules = { hostility_markups: [[20, 1.1], [40, 1.2]] as Array<[number, number]> }
    expect([0, 19, 20, 39, 40, 59, 60, 100].map((h) => hostilityMarkup(rules, h))).toEqual([1, 1, 1.1, 1.1, 1.2, 1.2, 1.2, 1.2])
  })
})

// ===================================================================================================================
// M2-ui-life：睡覺、喘口氣的「結果」句子不帶數字，AI 開著時不會被 H4 擋下
// ===================================================================================================================

describe('M2-ui-life：rest.sleep、rest.breath 的 results 句子不帶數字（H4），數字留在變更與這一拍的 data', () => {
  const H4 = /(?:生命值?|傷害|血量)\s*[:：]?\s*[-−+＋－]\s*\d/
  /** 已經受了傷的主角（城市情境：站在塔下、租了住處）。 */
  function hurt(ai: boolean) {
    const t = makeCityGame({ seed: 4, ...(ai ? { fake: true as const } : {}) })
    const pcId = t.game.state.pc!
    t.game.state.actors[pcId]!.hp = 10
    return { g: t.game, pcId }
  }

  it('睡一覺：results 與摘要都沒有「生命值 +N」；回了多少在變更與 data 裡', () => {
    const { g, pcId } = hurt(false)
    const d = sleepDraft(g.k, g.state, { spot: 'wild' })
    for (const line of d.narration?.results ?? []) expect(line, line).not.toMatch(H4)
    expect(d.outcome.summary).not.toMatch(H4)
    const gain = d.changes.find((c) => c.op === 'actor.track' && c.id === pcId && c.track === 'hp')
    expect(gain).toBeDefined()
    const beat = d.timeline.find((b) => b.tag === 'rest.heal')!
    expect(beat.data).toMatchObject({ id: pcId, hp: (gain as unknown as { delta: number }).delta })
    expect(d.narration!.results![1]).toMatch(/傷勢好了不少/)
  })

  it('喘口氣：有回血的 results 沒有數字；第三次不回血的那一句也沒有', () => {
    const { g } = hurt(false)
    const first = breathDraft(g.k, g.state)
    g.commit(first)
    for (const line of first.narration?.results ?? []) expect(line, line).not.toMatch(H4)
    expect(first.narration!.results![1]).toMatch(/傷勢緩了一些/)
    g.commit(breathDraft(g.k, g.state))
    const third = breathDraft(g.k, g.state)
    expect(third.narration!.results!.join('')).toMatch(/沒有回復生命值/)
    for (const line of third.narration?.results ?? []) expect(line, line).not.toMatch(H4)
  })

  it('重傷沒處理過：睡一覺最多回到一半的那一句也不帶數字', () => {
    const { g, pcId } = hurt(false)
    g.state.actors[pcId]!.hp = 3
    const d = sleepDraft(g.k, g.state, { spot: 'wild' })
    for (const line of d.narration?.results ?? []) expect(line, line).not.toMatch(H4)
  })

  it('AI 開著（假服務商把 results 抄進正文）：睡覺與喘口氣都套用得了，不會停在半路', async () => {
    const { g, pcId } = hurt(true)
    const a = await g.commitNarrated(breathDraft(g.k, g.state), { mode: 'new' })
    expect(a.status).toBe('applied')
    expect(a.reports[0]!.narration?.text).toContain('假的服務商')
    expect(g.state.actors[pcId]!.hp).toBeGreaterThan(10)
    const b = await g.commitNarrated(sleepDraft(g.k, g.state, { spot: 'wild' }), { mode: 'new' })
    expect(b.status).toBe('applied')
  })
})

describe('建議 2：enemies 的俘虜鍵', () => {
  it('常數改名 CAPTURE_EXT，鍵的字串還是 capture（舊存檔照樣讀得到）', () => {
    expect(CAPTURE_EXT).toBe('capture')
  })
})

// ===================================================================================================================
// M2-ui-people：建角時出身的名冊真的進名冊
// ===================================================================================================================

describe('M2-ui-people：建角之後，出身帶來的夥伴（pc.ext.origin.roster）進名冊', () => {
  const ORIGIN_PACK = (roster: string[]): ContentPack => ({
    id: 'fix_origin',
    content: {
      perk: [{ id: 'origin_fix', name: '出身的小特質', category: 'origin', cost: 2, flaw: false, desc: '測試用。', checks: { skills: ['streetwise'], bonus: 1 } }],
      origin: [{ id: 'o_fix', name: '測試出身', line: '測試用', skill_bonus: { streetwise: 1 }, status: 'citizen', home: '塔下', favor: { choose_one: ['f_corp'], value: 25 }, perk: 'origin_fix', roster }],
    } as unknown as ContentPack['content'],
  })
  const DRAFT: CreationDraft = {
    name: '露', gender: 'female', age: 22, origin: 'o_fix', originChoice: { favor: 'f_corp' },
    attrPick: { reflex: 15, charm: 14, intellect: 13, body: 12, resolve: 10, tech: 8 }, attrBonus: { tech: -4, reflex: 3, resolve: 3 },
    skills: { streetwise: 3, negotiate: 3, perform: 2, stealth: 2 }, perks: [],
  }
  const create = (roster: string[], o: { without?: string[] } = {}) => {
    const t = makeWorldGame({ scenario: 'beforeCreation', content: [ORIGIN_PACK(roster)], ...o })
    const reports = t.game.commit(buildCreationReport(t.game.k, t.game.state, DRAFT))
    return { g: t.game, reports }
  }

  it('出身的兩位夥伴變成角色、進名冊當固定夥伴（分紅）；忠誠是起始值；各一份 roster.join 接在 creation.commit 後面', () => {
    const { g, reports } = create(['npc_tw_friend', 'npc_tw_vendor'])
    expect(reports.map((r) => r.action)).toEqual(['creation.commit', 'roster.join', 'roster.join'])
    const roster = readRoster(g.state)
    expect(Object.keys(roster.members).sort()).toEqual(['npc_tw_friend', 'npc_tw_vendor'])
    expect(roster.members.npc_tw_friend).toMatchObject({ fixed: true, pay: 'share' })
    expect(g.state.actors.npc_tw_friend).toMatchObject({ name: '街坊小周', role: 'npc' })
    expect(meterOf(g.k, g.state, 'loyalty', 'npc_tw_friend')).toBe(30)
    expect(reports[1]!.outcome.summary).toMatch(/出身帶來的夥伴/)
    // 他們已經認識了（人物介面的名單看得到）
    expect(g.state.ext.npcs).toBeDefined()
  })

  it('存檔讀檔、回退都正確：回退建角之後名冊與角色一起沒了', () => {
    const { g } = create(['npc_tw_friend'])
    const json = JSON.stringify(g.state)
    expect(g.load(g.save())).toBeNull()
    expect(JSON.stringify(g.state)).toBe(json)
  })

  it('同一個人寫了兩次只進一次；名冊裝不下的略過，不會讓建角失敗', () => {
    const dup = create(['npc_tw_friend', 'npc_tw_friend'])
    expect(dup.reports.map((r) => r.action)).toEqual(['creation.commit', 'roster.join'])
    expect(Object.keys(readRoster(dup.g.state).members)).toEqual(['npc_tw_friend'])
    // 名冊容量是 0（魅力低、資料把基底與人面階數的加成都蓋成 0）：一個都進不去，建角照常
    const t = makeWorldGame({ scenario: 'beforeCreation', content: [ORIGIN_PACK(['npc_tw_friend']), { id: 'cap0', content: { roster_rule: [{ id: 'default', cap_base: 0, cap_per_face: 0 }] } as unknown as ContentPack['content'] }] })
    const weak: CreationDraft = { ...DRAFT, attrPick: { reflex: 15, charm: 8, intellect: 13, body: 12, resolve: 10, tech: 14 }, attrBonus: { tech: -4, reflex: 3, resolve: 3 } }
    const reports = t.game.commit(buildCreationReport(t.game.k, t.game.state, weak))
    expect(reports.map((r) => r.action)).toEqual(['creation.commit'])
    expect(Object.keys(readRoster(t.game.state).members)).toEqual([])
  })

  it('沒有裝人物的功能（沒有 meet 效果）：建角照常，名冊是空的', () => {
    const { g, reports } = create(['npc_tw_friend'], { without: ['npcs'] })
    expect(reports.map((r) => r.action)).toEqual(['creation.commit'])
    expect(Object.keys(readRoster(g.state).members)).toEqual([])
  })

  it('沒有裝名冊的功能：建角照常（沒有人接那份報告）', () => {
    const { g, reports } = create(['npc_tw_friend'], { without: ['roster'] })
    expect(reports.map((r) => r.action)).toEqual(['creation.commit'])
    expect(g.state.actors.pc!.ext.origin).toMatchObject({ roster: ['npc_tw_friend'] })
  })
})
