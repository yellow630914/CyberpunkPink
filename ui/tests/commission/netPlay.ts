// 委託內海面的測試共用：把網內的一段自動走完（只呼叫 store 的動作與引擎的提交；測試才用的傳送是引擎的 map.at 變更）。
import { expect } from 'vitest'
import type { useEngine } from '../../src/stores/engine'

type Eng = ReturnType<typeof useEngine>

/** 把這一層全部標成看過 */
export function reveal(e: Eng): void {
  const g = e.net.grid()!
  const rows = Array.from({ length: g.size[1] }, () => '1'.repeat(g.size[0]))
  expect(e.commit({ summary: '看過', action: 'netrun.test', changes: [{ op: 'map.sheet', map: g.map, sheet: g.sheet, seen: rows }] as never })).toBeNull()
}
/** 傳送到一格（測試用） */
export function teleport(e: Eng, x: number, y: number): void {
  const g = e.net.grid()!
  expect(e.commit({ summary: '傳送', action: 'netrun.test', changes: [{ op: 'map.at', to: { map: g.map, sheet: g.sheet, x, y } }] as never })).toBeNull()
}
/** 戰鬥自動打到結束並收尾 */
export async function autoBattle(e: Eng): Promise<string | undefined> {
  for (let i = 0; i < 400 && e.battle && !e.battle.result; i++) if (e.battleNext({ anyone: true }).status !== 'applied') break
  const outcome = e.battle?.result?.outcome
  await e.finishBattle()
  return outcome
}
/** 站到遭遇節點旁邊：試四個鄰格 */
export function standNextToFoe(e: Eng): string {
  reveal(e)
  const foe = e.net.sheet()!.markers.find((m) => m.mark === 'f' && !m.used)!
  const g = e.net.grid()!
  for (const [dx, dy] of [[0, 1], [0, -1], [1, 0], [-1, 0]] as const) {
    const [x, y] = [foe.at[0] + dx, foe.at[1] + dy]
    const kind = g.cells[y]?.[x]
    if (!kind || kind === 'wall' || kind === 'net_foe') continue
    teleport(e, x, y)
    if (e.net.view()!.near.length > 0) return foe.id
  }
  throw new Error('站不到遭遇節點旁邊')
}
/** 一段內海：打掉遭遇、通過閘門，直到這一趟結束。回傳打贏幾場 */
export async function playNetStage(e: Eng): Promise<number> {
  let wins = 0
  for (let guard = 0; guard < 12 && e.net.view(); guard++) {
    const v = e.net.view()!
    if (v.goal.kind === 'download' && v.goal.at) {
      reveal(e)
      teleport(e, v.goal.at.pos[0], v.goal.at.pos[1])
      for (let i = 0; i < 6 && e.net.view(); i++) expect((await e.net.use('download')).status).toBe('applied')
      continue
    }
    reveal(e)
    if (e.net.sheet()!.markers.some((m) => m.mark === 'f' && !m.used)) {
      const id = standNextToFoe(e)
          expect((await e.net.use('fight', id)).status).toBe('applied')
      expect(await autoBattle(e)).toBe('win')
      wins++
      continue
    }
    const gate = e.net.sheet()!.markers.find((m) => m.mark === 'g')!
    teleport(e, gate.at[0], gate.at[1])
    const r = await e.net.use('pass')
    if (r.status !== 'applied') expect((await e.net.descend()).status, r.reason).toBe('applied')
  }
  return wins
}
