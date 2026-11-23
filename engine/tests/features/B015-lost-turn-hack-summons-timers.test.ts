// B015：失去回合的那一個回合，hack 的持續型（迴圈）要照常結算與倒數、summons 的守著與停機計時要照常走（和 W011 同一個根：beginTurn 對失去回合的人不發 turn.start）。
// 規格出處與說明：dev/bugs/B015-lost-turn-hack-dot-and-summons-timers.md。修法在核心：失去回合的人也發 turn.start、turn.end（lost: true；dev/adr/0015 補記 M1b-review-core）。
// 這份原本在 tests/pending/，修好之後搬進主套件。每個測試寫的是規格期望的行為；「對照」是沒有失去回合時本來就對的那一半。
// 內容一律是測試自帶的假資料；重現就是這個檔（不經過提交，直接在一場戰鬥上呼叫效果與 beginTurn）。

import { describe, expect, it } from 'vitest'
import type { BattleOverlay, ContentPack, Kernel } from '../../src'
import { beginTurn, readyFeatures } from '../../src'
import { combatFeature } from '../../src/features/combat'
import { hackFeature } from '../../src/features/hack'
import { summonsFeature } from '../../src/features/summons'
import { hang } from '../../src/features/summons/drones'
import type { Arena } from '../helpers/battle'
import { TEST_STATUSES, arena, duel, foe, one } from '../helpers/battle'

const SRC = { kind: 'hack', id: 'qh_loop', name: '迴圈' } as const
const dice = (...v: number[]): number[] => [...v, ...Array(80).fill(1)]
const world = (): Arena =>
  arena(
    duel(
      [one({ tags: ['quickhack'], ext: { deck: { grade: 3, slots: [] }, summons: { drones: [{ kind: 'shield', grade: 1 }] } }, skills: { sync: 2 } } as never), one({}, 2)],
      [foe('minion', { ap: { now: 0, max: 0, regen: 0 } } as never), foe('minion', { ap: { now: 0, max: 0, regen: 0 } } as never)],
    ),
    [combatFeature, hackFeature, summonsFeature],
    (k: Kernel) => {
      k.content.loadPack({ id: 'b015', content: { battle_status: TEST_STATUSES } } as unknown as ContentPack)
      readyFeatures(k)
    },
  )

describe('B015：失去回合的那個回合，持續型要照常在「回合開始時」結算（NETRUNNING 2 與 SKILL_TREES 迴圈「目標每回合開始時受感載，共 3 回合」）', () => {
  it('對照（會過）：沒有失去回合時，迴圈每個回合開始結算一次、剩餘回合數減 1', () => {
    const a = world()
    const run = a.run(dice(3, 3, 3, 3))
    run.effects([{ op: 'hack.dot', amount: 5, turns: 3 }], { user: a.ally(1), target: { unit: 'f1' }, source: SRC })
    const before = a.foe(1).load!.now
    beginTurn(run, a.foe(1))
    expect(a.foe(1).load!.now).toBeGreaterThan(before)
    expect(((a.foe(1).ext.hack as Record<string, any>).dot as { turns: number }).turns).toBe(2)
  })

  it('目標這個回合失去回合（過載、癱瘓）：他的回合照樣開始，迴圈照樣結算一次、剩餘回合數照樣減 1（現在整個跳過，迴圈多撐一整輪）', () => {
    const a = world()
    const run = a.run(dice(3, 3, 3, 3))
    run.effects([{ op: 'hack.dot', amount: 5, turns: 3 }], { user: a.ally(1), target: { unit: 'f1' }, source: SRC })
    run.applyStatus(a.foe(1), 'frozen', { force: true })
    const before = a.foe(1).load!.now
    expect(beginTurn(run, a.foe(1))).toBe(false)
    expect(a.foe(1).load!.now).toBeGreaterThan(before)
    expect(((a.foe(1).ext.hack as Record<string, any>).dot as { turns: number }).turns).toBe(2)
  })
})

describe('B015：失去回合的那個回合，守著「到操作者的下一個回合開始」要結束（COMBAT_SYSTEM 9.1；features/summons/hooks.ts）', () => {
  const guarded = (): { a: Arena; d: BattleOverlay } => {
    const a = world()
    const run = a.run(dice())
    const d = hang(run, a.ally(1), 1, { idx: 0 })
    d.ext = { ...d.ext, guard: 'own_turn_start' }
    return { a, d }
  }

  it('對照（會過）：操作者正常開始回合，守著結束', () => {
    const { a, d } = guarded()
    beginTurn(a.run(dice()), a.ally(1))
    expect(d.ext!.guard).toBeUndefined()
  })

  it('操作者這個回合失去回合：核心的 own_turn_start 狀態同一刻到期，守著也要結束（現在多留一整輪，敵人下一輪還是打到無人機）', () => {
    const { a, d } = guarded()
    const run = a.run(dice())
    run.applyStatus(a.ally(1), 'frozen', { force: true })
    expect(beginTurn(run, a.ally(1))).toBe(false)
    expect(d.ext!.guard).toBeUndefined()
  })

  it('被電磁打到的停機（stun 1）：操作者失去回合時，停機照「操作者的下一個回合」算過去（變 2，回合結束拿掉），不多停一輪', () => {
    const { a, d } = guarded()
    d.ext = { ...d.ext, stun: 1 }
    const run = a.run(dice())
    run.applyStatus(a.ally(1), 'frozen', { force: true })
    beginTurn(run, a.ally(1))
    expect(d.ext!.stun === 2 || d.ext!.stun === undefined).toBe(true)
  })
})
