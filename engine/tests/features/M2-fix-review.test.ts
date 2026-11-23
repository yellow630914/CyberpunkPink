// 驗收測試：dev/work/M2-fix-review.md（M2 引擎審查後的修正批；依據 dev/reviews/2026-11-23-M2.md、dev/adr/0016、0017）。
// 每一項一個 describe；內容一律用測試自帶的最小假資料（事件、範圍）加 testkit 的假世界（TEST_WORLD）。

import { describe, expect, it } from 'vitest'
import type { ContentPack, Report } from '../../src'
import { BATTLE_SETUPS, SUNDAY_MORNING, makeCityGame, playOut } from '../../src/testkit'
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
