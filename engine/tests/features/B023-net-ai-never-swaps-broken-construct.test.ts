// B023：內海的單位手上的構裝破損之後，AI 控制的那一步不會換成另一個構裝（dev/bugs/B023-net-ai-never-swaps-broken-construct.md）。
// 規格：CYBERSPACE 6.5 節「破損：一個構裝槽失效」「重：到登出之後修好為止」；6.3 節行動表有「換構裝」（net_swap）；ENEMIES 4.3 節（AI 每一步挑分數最高的行動）。
// 修好了（M3 修正批）：`net_swap`（features/netcombat/actions.ts）有了 `aiScore`：手上的構裝破損、身上還有沒破損的別的構裝時給 2.5（比攻擊的 2 高），AI 會先換。
// 只在 `battleNext({ anyone: true })`／敵方 AI 的那一步才看得到；玩家自己按「換構裝」本來就是對的。

import { describe, expect, it } from 'vitest'
import { makeNetBattleGame } from '../../src/testkit'

describe('B023：構裝破損之後 AI 會換構裝、或用別的構裝攻擊', () => {
  it('我方化身手上的槍破損了、身上還有近戰與干擾兩個沒破損的構裝：輪到他時，AI 這一回合要不是換構裝、就是打出一次攻擊', () => {
    const { game: g } = makeNetBattleGame()
    const a1 = g.battle!.units.a1!
    expect(a1.weapons.map((w) => w.id)).toEqual(['cs_tw_gun', 'cs_tw_blade', 'cs_tw_jam'])
    // 照 netcombat 的資料慣例：unit.ext.net.broken 是破損的構裝 id
    a1.ext.net = { ...(a1.ext.net as Record<string, unknown>), broken: ['cs_tw_gun'] }
    expect(g.battleOptions()).toMatchObject({ current: 'a1', waiting: 'player' })
    const foeLoad = (): number => Object.values(g.battle!.units).filter((u) => u.side === 'foe').reduce((n, u) => n + (u.load?.now ?? 0) + u.layers, 0)
    const before = { wield: a1.wield, load: foeLoad() }
    // 讓程式替 a1 出手（和 playOut 同一條路），直到不再輪到他
    for (let i = 0; i < 12 && g.battle && !g.battle.result && g.battleOptions()?.current === 'a1'; i++) {
      const r = g.battleNext({ anyone: true })
      expect(r.status).toBe('applied')
    }
    const after = g.battle!.units.a1!
    const swapped = after.wield !== before.wield
    const attacked = foeLoad() > before.load
    expect(swapped || attacked, `a1 的槍破損了：沒有換構裝（wield ${before.wield} → ${after.wield}），也沒有打出攻擊（敵方感載 ${before.load} → ${foeLoad()}）`).toBe(true)
  })

  it('對照：沒有破損時，AI 照常攻擊', () => {
    const { game: g } = makeNetBattleGame()
    const before = Object.values(g.battle!.units).filter((u) => u.side === 'foe').reduce((n, u) => n + (u.load?.now ?? 0) + u.layers, 0)
    for (let i = 0; i < 12 && g.battle && !g.battle.result && g.battleOptions()?.current === 'a1'; i++) g.battleNext({ anyone: true })
    const after = Object.values(g.battle!.units).filter((u) => u.side === 'foe').reduce((n, u) => n + (u.load?.now ?? 0) + u.layers, 0)
    expect(after).toBeGreaterThan(before)
  })
})
