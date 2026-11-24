import type { BattleState, Report } from '@engine/src'
import type { LiveEvent } from '../data/media'

/**
 * 直播與彈幕的事件：只看引擎每一拍的 tag（BATTLE_EVENTS），不掃文字。MEDIA 1.2 節：亮點來自引擎本來就會發出的事件。
 * 「對我方有利」看的是事件裡的單位站哪一邊：要害與換檔、管理行動看出手的人，其餘看被打的那個。
 * 內海的幾種（換檔、干擾、破損、釘住、拔線、管理行動、追蹤度、被定位）只在內海的紀錄裡出現；它們只是氣氛：不影響任何數字，也不進直播的目標。
 */
export const DANMAKU_TAGS = ['crit', 'overload', 'down', 'subdue', 'wound'] as const
export const NET_DANMAKU_TAGS = ['shift', 'jam', 'break', 'pin', 'jack_out', 'admin', 'trace', 'located'] as const
const KEEP = new Set<string>([...DANMAKU_TAGS, ...NET_DANMAKU_TAGS, 'battle.end'])
/** 事件裡「出手的人」放在哪個欄位；沒列的看被打的那個（target） */
const ACTOR: Record<string, string> = { crit: 'attacker', shift: 'unit', admin: 'unit' }
/** 一律不算好事的（追蹤度往上、被定位、拔線）：彈幕寫出來但不標亮 */
const NEVER_GOOD = new Set(['trace', 'located', 'jack_out'])

/** 一份（或幾份）報告裡值得直播的事件，照出現的順序。battle 是那一步之後的狀態（查單位站哪一邊）。 */
export function liveEventsOf(reports: Report[], battle: BattleState | null): LiveEvent[] {
  const out: LiveEvent[] = []
  for (const r of reports) {
    for (const b of r.timeline) {
      if (!b.tag || !KEEP.has(b.tag)) continue
      if (b.tag === 'battle.end') { out.push({ tag: b.tag, good: b.data?.outcome === 'win', text: b.text, ...(typeof b.data?.outcome === 'string' ? { outcome: b.data.outcome } : {}) }); continue }
      const id = String(b.data?.[ACTOR[b.tag] ?? 'target'] ?? '')
      const side = (b.data?.side as string | undefined) ?? battle?.units[id]?.side
      // 要害、換檔、管理行動：我方出手才算好事；其餘事件：發生在敵方身上才算好事
      const good = NEVER_GOOD.has(b.tag) ? false : ACTOR[b.tag] ? side === 'ally' && b.data?.ok !== false : side === 'foe'
      out.push({ tag: b.tag, good, text: b.text })
    }
  }
  return out
}

/** 彈幕：要害、過載、打倒、制伏、重創（內海另有換檔、干擾、破損、釘住、拔線、管理行動、追蹤度、被定位）各一則，字用那一拍的 text。 */
export function danmakuOf(events: LiveEvent[]): Array<{ text: string; kind?: 'hot' }> {
  const tags: readonly string[] = [...DANMAKU_TAGS, ...NET_DANMAKU_TAGS]
  return events.filter((e) => tags.includes(e.tag)).map((e) => ({ text: e.text, ...(e.good && (e.tag === 'crit' || e.tag === 'subdue' || e.tag === 'pin') ? { kind: 'hot' as const } : {}) }))
}
