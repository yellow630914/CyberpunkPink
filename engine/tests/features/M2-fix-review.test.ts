// 驗收測試：dev/work/M2-fix-review.md（M2 引擎審查後的修正批；依據 dev/reviews/2026-11-23-M2.md、dev/adr/0016、0017）。
// 每一項一個 describe；內容一律用測試自帶的最小假資料（事件、範圍）加 testkit 的假世界（TEST_WORLD）。

import { describe, expect, it } from 'vitest'
import type { ContentPack, Report } from '../../src'
import { Rng, hash32 } from '../../src'
import { BATTLE_SETUPS, STRONG_PC, SUNDAY_MORNING, makeCityGame, makeWorldGame, playOut, stateHash } from '../../src/testkit'
import { chooseBranch, chooseFace, readRun, retreat } from '../../src/features/commission'
import { chooseOption, eventView } from '../../src/features/director'
import { sceneOf } from '../../src/features/scene'
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

  it('車上開成人場景（癡漢）：場景開得起來，這一趟結束，人在下一站', () => {
    const g = onTheTrain()
    g.commit(wait(g.k, g.state))
    const reports = g.commit(chooseOption(g.k, g.state, 'go'))
    expect(reports.map((r) => r.action)).toEqual(['event.close', 'scene.start'])
    expect(sceneOf(g.state)).not.toBeNull()
    expect(transitOf(g.state).trip).toBeNull()
    expect(g.k.activity.active(g.state).map((a) => a.kind)).toEqual(['scene'])
    expect(stationOf(g)).toEqual({ block: 'tw_yard', facility: 'F1' })
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
    expect(sceneOf(g.state)).not.toBeNull()
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
