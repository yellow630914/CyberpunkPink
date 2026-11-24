// L6 功能 netcombat：給畫面的整理（netBattleView）。只讀，不改狀態：每個我方單位的檔位、上限、每一檔開不開得了與原因、破損的槽、這一回合換過檔沒有。
// 規則都在 sync.ts 與 jam.ts；這裡把它們排成畫面要的樣子（畫面不自己判斷）。

import type { BattleKernel, GameState, SyncGear } from '../../core'
import { BattleRun, SYNC_GEARS, clone, currentUnit, modeOf, syncRuleOf } from '../../core'
import { brokenOf, constructEntry, gearAt, netOf } from './model'
import { capIndex, gearBlocks, shiftLimit, shiftsUsed } from './sync'

export interface NetGearView {
  gear: SyncGear
  /** 「深」「全」…… */
  name: string
  /** 這一檔的檢定加減與受到的感載（%） */
  check: number
  loadPct: number
  /** 現在換得到嗎 */
  ok: boolean
  /** 換不到的原因，一條一個條件（缺的是同步幾級、敏感度多少，現在是多少）；已經是這一檔也寫在這裡 */
  blocks: string[]
  current: boolean
}

export interface NetUnitView {
  unit: string
  name: string
  /** 現在的檔位 */
  gear: SyncGear
  /** 現在換得到的最高一檔（sync_max 加修正 sync_cap） */
  max: SyncGear
  gears: NetGearView[]
  /** 破損的構裝（id 與名字） */
  broken: Array<{ id: string; name: string }>
  /** 這一場被重創過（結束時會留下 net_broken） */
  heavy: boolean
  /** 沒有構裝可以破損的人少的傷害骰顆數 */
  diceLoss: number
  /** 這一回合換過檔沒有（換過了不能再換）與還能換幾次 */
  shifted: boolean
  shiftsLeft: number
}

export interface NetBattleView {
  battle: string
  round: number
  units: NetUnitView[]
}

/** 現在這場內海戰鬥的畫面資料；沒有在打、或打的不是內海回傳 null。 */
export function netBattleView(k: BattleKernel, state: GameState): NetBattleView | null {
  const b = state.battle
  if (!b || modeOf(k.content, b.mode)?.layer !== 'net') return null
  const run = new BattleRun(k, state, clone(b))
  const rule = syncRuleOf(k.content)
  const units: NetUnitView[] = []
  for (const u of Object.values(run.battle.units)) {
    const n = netOf(u)
    if (u.side !== 'ally' || !n) continue
    // 換檔的次數每個自己的回合開始時歸零：不是現在這個人的回合，就當作還沒換過
    const used = currentUnit(run.battle)?.id === u.id ? shiftsUsed(u) : 0
    const net = u.ext.net as Record<string, unknown>
    units.push({
      unit: u.id, name: u.name, gear: n.sync, max: gearAt(capIndex(run, u)),
      gears: SYNC_GEARS.map((g) => {
        const blocks = gearBlocks(run, u, g)
        return { gear: g, name: rule.gears[g].name, check: rule.gears[g].check, loadPct: rule.gears[g].loadPct, ok: blocks.length === 0, blocks, current: g === n.sync }
      }),
      broken: brokenOf(u).map((id) => ({ id, name: constructEntry(k, id)?.name ?? id })),
      heavy: net.heavy === true,
      diceLoss: typeof net.dice_loss === 'number' ? net.dice_loss : 0,
      shifted: used > 0,
      shiftsLeft: Math.max(0, shiftLimit(run, u) - used),
    })
  }
  return { battle: b.id, round: b.round, units }
}
