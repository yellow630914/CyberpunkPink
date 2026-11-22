import type { BattleState, Report } from '@engine/src'
import type { LiveEvent } from '../data/media'

/**
 * 直播的事件：只看引擎每一拍的 tag（BATTLE_EVENTS），不掃文字。MEDIA 1.2 節：亮點來自引擎本來就會發出的事件。
 * 「對我方有利」看的是事件裡的單位站哪一邊：要害看出手的人，其餘看被打的那個。
 */
export const DANMAKU_TAGS = ['crit', 'overload', 'down', 'subdue', 'wound'] as const
const KEEP = new Set<string>([...DANMAKU_TAGS, 'battle.end'])

/** 一份（或幾份）報告裡值得直播的事件，照出現的順序。battle 是那一步之後的狀態（查單位站哪一邊）。 */
export function liveEventsOf(reports: Report[], battle: BattleState | null): LiveEvent[] {
  const out: LiveEvent[] = []
  for (const r of reports) {
    for (const b of r.timeline) {
      if (!b.tag || !KEEP.has(b.tag)) continue
      if (b.tag === 'battle.end') { out.push({ tag: b.tag, good: b.data?.outcome === 'win', text: b.text, ...(typeof b.data?.outcome === 'string' ? { outcome: b.data.outcome } : {}) }); continue }
      const id = String((b.tag === 'crit' ? b.data?.attacker : b.data?.target) ?? '')
      const side = (b.data?.side as string | undefined) ?? battle?.units[id]?.side
      // 要害：我方出手才算好事；其餘事件：發生在敵方身上才算好事
      const good = b.tag === 'crit' ? side === 'ally' : side === 'foe'
      out.push({ tag: b.tag, good, text: b.text })
    }
  }
  return out
}

/** 彈幕：要害、過載、打倒、制伏、重創各一則，字用那一拍的 text。 */
export function danmakuOf(events: LiveEvent[]): Array<{ text: string; kind?: 'hot' }> {
  return events.filter((e) => (DANMAKU_TAGS as readonly string[]).includes(e.tag)).map((e) => ({ text: e.text, ...(e.good && (e.tag === 'crit' || e.tag === 'subdue') ? { kind: 'hot' as const } : {}) }))
}
