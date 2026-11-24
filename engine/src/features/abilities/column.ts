// 「這一欄」：技能的 meat 欄與 net 欄是同一套格式，戰鬥裡照戰場的 layer 選（M3-abilities-net；dev/adr/0018 第一節、N33）。
// 被動的修正、資源池、標籤、反應、姿態、主動的行動、AI 的條件全部經過這裡拿欄；現實（meat）的行為和以前一樣。
// 同步檔位（淺、標準、深、全）看單位的 sync:<檔> 標籤（netcombat 維持；沒有標籤的單位當標準）：
// 招牌的專屬構裝（unique）淺檔整欄不生效，帶 overclock 標籤的行動淺檔做不了（CYBERSPACE 6.4 節）。

import type { BattleUnit, BattleView, Kernel } from '../../core'
import { isSyncGear, syncRuleOf } from '../../core'
import type { SyncGear } from '../../core'
import type { AbilityEntry, MeatDef } from './types'
import { equippedOf } from './unitdata'

/** 技能的兩個戰鬥用的欄（輿論欄不碰）。和戰場的 layer 同一組字。 */
export type Layer = 'meat' | 'net'

/** 這一場在哪一層（沒有戰場資料的、不認得的都當現實）。 */
export const layerOf = (v: { mode?: { layer?: string } }): Layer => (v.mode?.layer === 'net' ? 'net' : 'meat')

/** 這個技能在這一層的那一欄（沒有就是 null；不看 pending 與淺檔）。 */
export const colOf = (ab: Pick<AbilityEntry, 'meat' | 'net'>, layer: Layer): MeatDef | null => (layer === 'net' ? ab.net : ab.meat) ?? null

/** 單位現在的同步檔位：sync:<檔> 標籤；沒有標籤的單位當標準。 */
export function gearOf(u: Pick<BattleUnit, 'tags'>): SyncGear {
  for (const t of u.tags) {
    if (t.startsWith('sync:')) {
      const g = t.slice('sync:'.length)
      if (isSyncGear(g)) return g
    }
  }
  return 'standard'
}

/** 檔位的名字加「檔」（淺檔、標準檔……；照規則表）。 */
export const gearName = (k: Pick<Kernel, 'content'>, g: SyncGear): string => `${syncRuleOf(k.content).gears[g].name}檔`

/** 這一欄在這個單位身上現在是休眠的嗎：專屬構裝（unique）在淺檔。 */
export const dormant = (u: Pick<BattleUnit, 'tags'>, m: MeatDef): boolean => m.unique === true && gearOf(u) === 'shallow'

export const OVERCLOCK = 'overclock'
export const SHALLOW_UNIQUE = '淺檔時專屬構裝不能用，要換到標準檔以上。'
export const SHALLOW_OVERCLOCK = '淺檔不能超頻，要換到標準檔以上。'

/** 這個欄會不會被當成動作（主動技能的行動）：有目標、效果清單或用法。 */
export const isActionCol = (m: MeatDef | null | undefined): m is MeatDef => !!m && !m.pending && !!(m.target || m.do || m.choose || m.tease)

/**
 * 這個單位身上現在算數的這一欄：照戰場選欄；pending 的、專屬構裝在淺檔的都是 null。
 * 被動的修正、池、標籤、反應、姿態都問它；行動不問它（行動在淺檔要留著、灰掉並寫原因）。
 */
export function colIn(view: Pick<BattleView, 'mode'>, u: BattleUnit, ab: AbilityEntry): MeatDef | null {
  const m = colOf(ab, layerOf(view))
  return !m || m.pending || dormant(u, m) ? null : m
}

/** 裝著的技能裡這一層算數的每一欄（技能與欄）。 */
export function liveCols(view: Pick<BattleView, 'k' | 'mode'>, u: BattleUnit): Array<{ ab: AbilityEntry; m: MeatDef }> {
  const out: Array<{ ab: AbilityEntry; m: MeatDef }> = []
  for (const ab of equippedOf(view, u)) {
    const m = colIn(view, u, ab)
    if (m) out.push({ ab, m })
  }
  return out
}

/** 行動現在因為同步檔位做不了的原因（專屬構裝、超頻在淺檔）。 */
export function gearBlocks(u: BattleUnit, m: MeatDef): string[] {
  if (gearOf(u) !== 'shallow') return []
  const out: string[] = []
  if (m.unique === true) out.push(SHALLOW_UNIQUE)
  if (m.tags?.includes(OVERCLOCK)) out.push(SHALLOW_OVERCLOCK)
  return out
}
