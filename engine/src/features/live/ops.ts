// L6 功能 live 的變更種類：三種，每一種只動 state.ext.live，疊在同一份報告裡不會互相蓋掉。
//   live.open  { session }              開播（id 套用時發 lv<seq+1>，要和 session.id 一樣）
//   live.add   { events, heat, tips }   這一份報告裡聽到的事件：次數、亮點、熱度與打賞（熱度與打賞已經照模板與上限算好）
//   live.close { entry }                收播：清掉 session、記一筆結果（最近 log_keep 筆）
//   live.heat  { delta, highlight? }    直接加減這一場的熱度（效果 heat、highlight；M5-live-slot）：時段直播夾在 0～這一場的上限、其餘最少 0；打賞跟著熱度走
// 回到快照時（rewind.keep）用整份 ext 換（rewind.ts）。

import type { Change, GameState, Kernel } from '../../core'
import { isRecord, isSafeInt } from '../../core'
import type { Highlight, LiveState, Session, Settled } from './model'
import { EXT, MODES, OWNER, isText, liveRules, liveValue, readLive } from './model'
import { SLOT_KINDS } from './slotrules'

const write = (state: GameState, fn: (l: LiveState) => void): void => {
  const l = readLive(state)
  fn(l)
  state.ext[EXT] = liveValue(l)
}

const NO_SESSION = '現在沒有在直播。'

export function sessionProblems(s: unknown): string[] {
  if (!isRecord(s)) return ['session 要是一場直播']
  const p: string[] = []
  if (!isText(s.id)) p.push('session.id 要是這一場的 id')
  if (!(MODES as readonly unknown[]).includes(s.mode)) p.push('session.mode 要是 activity 或 slot')
  if (!isText(s.template)) p.push('session.template 要是模板的 id')
  if (!isText(s.by)) p.push('session.by 要是開播的人（角色 id）')
  if (!isSafeInt(s.heat) || s.heat < 0) p.push('session.heat 要是 0 以上的整數')
  if (!isSafeInt(s.tips) || s.tips < 0) p.push('session.tips 要是 0 以上的整數')
  if (!Array.isArray(s.goals)) p.push('session.goals 要是陣列')
  if (!isRecord(s.counts) || !isRecord(s.from)) p.push('session.counts 與 session.from 要是物件')
  if (s.mode === 'activity' && !isRecord(s.host)) p.push('活動直播要有 host（宿主的種類與 id）')
  if (s.mode === 'slot') {
    if (!(SLOT_KINDS as readonly unknown[]).includes(s.kind)) p.push(`時段直播的 kind 要是 ${SLOT_KINDS.join('、')} 其中一個`)
    if (!isSafeInt(s.hours) || s.hours < 1 || s.hours > 9) p.push('時段直播的 hours 要是 1 以上的整數')
    if (!isSafeInt(s.cap) || s.cap < 0 || (isSafeInt(s.heat) && s.heat > s.cap)) p.push('時段直播的 cap 要是 0 以上的整數，而且不小於 heat')
    if (!isRecord(s.plan) || !Array.isArray(s.plan.tags)) p.push('時段直播的 plan 要是 { tags, direction? }')
  }
  return p
}

const entryProblems = (e: unknown): string[] => {
  if (!isRecord(e)) return ['entry 要是收播的結果']
  const p: string[] = []
  if (!isText(e.id)) p.push('entry.id 要是這一場的 id')
  if (!isSafeInt(e.at) || e.at < 0) p.push('entry.at 要是總分鐘（非負整數）')
  if (!isSafeInt(e.heat) || e.heat < 0) p.push('entry.heat 要是 0 以上的整數')
  if (!isSafeInt(e.subs)) p.push('entry.subs 要是整數')
  if (!isSafeInt(e.tips) || e.tips < 0) p.push('entry.tips 要是 0 以上的整數')
  if (!isSafeInt(e.goals_done) || e.goals_done < 0) p.push('entry.goals_done 要是 0 以上的整數')
  return p
}

interface AddEvent { event: string; heat: number; report: string }

export function installOps(k: Kernel): void {
  k.changes.register<Change & { session: Session }>({
    op: 'live.open', owner: OWNER,
    validate: (s, c) => {
      const cur = readLive(s)
      const p = sessionProblems(c.session)
      if (cur.session) p.push('已經在直播了')
      else if (isRecord(c.session) && c.session.id !== `lv${cur.seq + 1}`) p.push(`這一場的 id 要是 lv${cur.seq + 1}`)
      return p
    },
    apply: (s, c) => write(s, (l) => { l.seq += 1; l.session = JSON.parse(JSON.stringify(c.session)) as Session }),
    describe: () => '開播了。',
  })

  k.changes.register<Change & { events: AddEvent[]; heat: number; tips: number }>({
    op: 'live.add', owner: OWNER,
    validate: (s, c) => {
      const p: string[] = []
      if (!readLive(s).session) return [NO_SESSION]
      if (!Array.isArray(c.events) || c.events.length === 0 || c.events.some((e) => !isRecord(e) || !isText(e.event) || !isSafeInt(e.heat) || e.heat < 0)) p.push('events 要是事件的陣列 [{ event, heat, report }]')
      if (!isSafeInt(c.heat) || c.heat < 0) p.push('heat 要是 0 以上的整數')
      if (!isSafeInt(c.tips) || c.tips < 0) p.push('tips 要是 0 以上的整數')
      return p
    },
    apply: (s, c) => write(s, (l) => {
      const ses = l.session!
      const keep = liveRules(k).highlight_keep
      for (const e of c.events) {
        ses.counts[e.event] = (ses.counts[e.event] ?? 0) + 1
        if (e.heat > 0) {
          ses.from[e.event] = (ses.from[e.event] ?? 0) + e.heat
          ses.highlights.push({ event: e.event, heat: e.heat, report: e.report } satisfies Highlight)
        }
      }
      if (ses.highlights.length > keep) ses.highlights = ses.highlights.slice(-keep)
      ses.heat += c.heat
      ses.tips += c.tips
    }),
  })

  k.changes.register<Change & { delta: number; highlight?: boolean }>({
    op: 'live.heat', owner: OWNER,
    validate: (s, c) => {
      if (!readLive(s).session) return [NO_SESSION]
      return isSafeInt(c.delta) && c.delta !== 0 && (c.highlight === undefined || typeof c.highlight === 'boolean') ? [] : ['delta 要是不為 0 的整數']
    },
    apply: (s, c) => write(s, (l) => {
      const ses = l.session!
      const before = ses.heat
      ses.heat = Math.min(ses.cap ?? Infinity, Math.max(0, ses.heat + c.delta))
      const real = ses.heat - before
      ses.tips = Math.max(0, ses.tips + real * liveRules(k).heat_tips)
      if (c.highlight === true && real > 0) {
        ses.counts.highlight = (ses.counts.highlight ?? 0) + 1
        ses.from.highlight = (ses.from.highlight ?? 0) + real
        ses.highlights.push({ event: 'highlight', heat: real, report: '' } satisfies Highlight)
        const keep = liveRules(k).highlight_keep
        if (ses.highlights.length > keep) ses.highlights = ses.highlights.slice(-keep)
      }
    }),
  })

  k.changes.register<Change & { entry: Settled }>({
    op: 'live.close', owner: OWNER,
    validate: (s, c) => {
      const cur = readLive(s)
      if (!cur.session) return [NO_SESSION]
      const p = entryProblems(c.entry)
      if (isRecord(c.entry) && c.entry.id !== cur.session.id) p.push(`收的是 ${String(c.entry.id)}，現在在播的是 ${cur.session.id}`)
      return p
    },
    apply: (s, c) => write(s, (l) => {
      l.session = null
      l.log = [...l.log, JSON.parse(JSON.stringify(c.entry)) as Settled].slice(-liveRules(k).log_keep)
    }),
    describe: (c) => (c.entry.lost === true ? '收播了（戰敗的畫面）。' : '收播了。'),
  })
}
