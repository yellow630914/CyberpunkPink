// L6 功能 curtain 的簾口（CYBERSPACE 8.8 節「怎麼進去」第 2 點；dev/adr/0019 第十四節「facility_type 的欄位 curtain_door」；M4-followups）。
// 簾口是暗礁的一個節點，每週換位置，不在固定地圖上：位置與領位員是內容（世界的設施種類多一個欄位 curtain_door: true，哪一個節點這一週是簾口是資料與事件的事）。
// 引擎只問一件事：報名時人是不是站在簾口。內容裡沒有任何設施種類寫 curtain_door（或沒有人註冊條件 at_facility）時當作沒有這條限制。

import type { GameState, Kernel } from '../../core'

const FACILITY_TYPE_KIND = 'facility_type'
const AT_FACILITY = 'at_facility'

/** 這一份內容裡寫了 curtain_door: true 的設施種類。 */
const doorTypes = (k: Pick<Kernel, 'content'>): string[] => (k.content.hasKind(FACILITY_TYPE_KIND) ? k.content.list(FACILITY_TYPE_KIND).filter((t) => t.curtain_door === true).map((t) => t.id) : [])

/** 現在站的位置不是簾口時，報名不成立的原因（一句）；站在簾口、或這一局沒有簾口這回事是 null。 */
export function doorBlock(k: Pick<Kernel, 'content' | 'conditions' | 'stats' | 'timeRules'>, state: GameState): string | null {
  const doors = doorTypes(k)
  if (!doors.length || !k.conditions.kinds().includes(AT_FACILITY)) return null
  const ok = k.conditions.test({ kind: AT_FACILITY, types: doors }, { state, stats: k.stats, timeRules: k.timeRules })
  return ok ? null : '要站在簾口才能報名：簾口是暗礁的一個節點，每週換位置，持有效的邀請函，鯨落的領位員會帶你過去。'
}
