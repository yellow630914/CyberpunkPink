import type { DistrictId } from '../data/types'

/**
 * 自己的車（ITEMS 第 14 節）：引擎還沒有「自己的車」這個功能，這裡先留著舊的判斷，由開車的按鈕用（M2-ui-world 之後城市地圖的開車按鈕灰掉，
 * 等引擎有了再接）。公共交通與浮空計程車的車資、時間、路線、能不能上車，已經全部是引擎的（features/transit），舊的算式刪掉了。
 */
export interface Place { district: DistrictId; block: string }

export function driveBlock(vehicles: string[], from: Place, to: Place): string | null {
  if (!vehicles.length) return '你沒有車：機車或汽車要先買（ITEMS 第 14 節）。'
  if (from.district === to.district && from.block === to.block) return '你就在這裡。'
  if (to.district === 'under' || from.district === 'under') return '地下層開不進去，要用走的。'
  return null
}
export const driveMinutes = (from: Place, to: Place) => (from.district === to.district ? 4 : 10)
