// 冒煙測試的主幹，用真正的功能與資料走一遍（dev/test-harness.md 第 6 節）：
//   開新遊戲 → 建角 → 空房間的自由行動 → 存檔 → 讀檔 → 回退（固定種子、AI 關閉）
//
// 要 M0-data、M0-character、M0-perks、M0-creation 四張工單都完成，而且每個功能都列進 engine/src/features/index.ts 的 FEATURES 才會過。
// 跑法：在 engine/ 跑 npx vitest run --config vitest.pending.config.ts M0-smoke-features
// 四張都完成後（最後完成的那一張負責）：git mv engine/tests/pending/M0-smoke-features.test.ts engine/tests/smoke/m0-features.test.ts，主套件要全過。

import { describe, expect, it } from 'vitest'
import { Game } from '../../src'
import { CORE_PACK } from '../../data'
import { FEATURES, allFeatures } from '../../src/features'
import { buildCreationReport } from '../../src/features/creation'
import { commitViolations, stateHash } from '../../src/testkit'

describe('冒煙 M0（真正的功能與資料）', () => {
  it('功能的總表裡有 M0 的功能', () => {
    expect(Object.keys(FEATURES)).toEqual(expect.arrayContaining(['character', 'perks', 'creation']))
  })

  it('開新遊戲 → 建角 → 空房間的自由行動 → 存檔 → 讀檔 → 回退', async () => {
    const game = new Game({ features: allFeatures(), content: [CORE_PACK], strict: true, ai: { ai: 0 } })
    game.k.probe.start()

    game.newGame({ seed: 20261121, rules: { difficulty: 'normal' } })
    expect(game.state.pc).toBeNull()

    // 建角：蜂巢出身，CHARACTER 5.1 節的那個例子
    game.commit(buildCreationReport(game.k, game.state, {
      name: '露', gender: 'female', age: 22, origin: 'hive', originChoice: { favor: '孤星連' },
      attrPick: { reflex: 15, charm: 14, intellect: 13, body: 12, resolve: 10, tech: 8 },
      attrBonus: { tech: -4, reflex: 3, resolve: 3 },
      skills: { streetwise: 3, negotiate: 3, perform: 2, stealth: 2 },
      perks: ['smooth_talker', 'tough'],
    }))
    const pc = game.state.actors[game.state.pc!]!
    expect(pc.skills.streetwise).toBe(4)
    expect(pc.perks).toEqual(['origin_hive', 'smooth_talker', 'tough'])
    // 生命值從上限開始：20 + 體格 12 × 2，加上「耐打」的 +5
    expect(game.k.stats.stat(game.state, pc.id, 'max_hp')).toBe(49)
    expect(pc.hp).toBe(49)
    expect(game.state.money.cred + game.state.money.cash).toBe(1500)

    // 空房間的自由行動：交涉的檢定吃到魅力 14（+2）、交涉 3 級、能言善道 +2
    const act = await game.act({ kind: 'free', text: '我對著牆壁練習殺價', attr: 'charm', skill: 'negotiate' })
    expect(act.status).toBe('applied')
    const roll = act.reports[0]!.timeline[0]!.roll!
    expect(roll.total).toBe(roll.natural + 2 + 3 + 2)
    expect(roll.parts.map((p) => p.label)).toEqual(['魅力', '交涉', '能言善道'])
    expect(act.reports[0]!.party[0]).toMatchObject({ hp: [49, 49, 49] })

    // 存檔 → 讀檔 → 回退
    const saved = game.save('manual', 'smoke')
    const hash = stateHash(game.state)
    await game.act({ kind: 'free', text: '我坐在地上發呆' })
    expect(game.load(saved)).toBeNull()
    expect(stateHash(game.state)).toBe(hash)
    await game.act({ kind: 'free', text: '我坐在地上發呆' })
    expect(game.undoSteps()).toBe(true)
    expect(stateHash(game.state)).toBe(hash)

    expect(commitViolations(game.k, game.k.probe.stop())).toEqual([])
  })
})
