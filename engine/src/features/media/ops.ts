// L6 功能 media 的變更種類（model.ts 檔頭列了五種）。每一種只動 state.ext.media，而且彼此疊在同一份報告裡也不會互相蓋掉
// （一份報告可以用掉好幾件素材、記好幾則紀錄；用整份 ext 換的寫法會被後面的蓋成舊的）。
// 編號（rc…、ft…）在套用時從 seq 發：同一個狀態、同一串變更一定得到同一個結果。

import type { Change, GameState, Kernel } from '../../core'
import { isRecord, isSafeInt } from '../../core'
import type { Footage, RecordEntry, StagePending } from './model'
import { EXT, MARKS, OWNER, isText, isType, mediaValue, readMedia } from './model'

type Write = (state: GameState, fn: (m: ReturnType<typeof readMedia>) => void) => void
const write: Write = (state, fn) => {
  const m = readMedia(state)
  fn(m)
  state.ext[EXT] = mediaValue(m)
}

export type RecordInit = Omit<RecordEntry, 'id'>
export type FootageInit = Omit<Footage, 'id' | 'from_record'>

const recordProblems = (r: unknown): string[] => {
  if (!isRecord(r)) return ['record 要是一則紀錄']
  const p: string[] = []
  if (!isSafeInt(r.at) || r.at < 0) p.push('record.at 要是總分鐘（非負整數）')
  if (!isText(r.label)) p.push('record.label 要是一句標題')
  if (!isRecord(r.source) || !isText(r.source.kind)) p.push('record.source.kind 要是來源的種類')
  if (!isType(r.type)) p.push('record.type 要是 battle、scandal、crime、intimate、celebrity、daily 其中一個')
  if (r.by !== null && !isText(r.by)) p.push('record.by 要是角色 id 或 null')
  if (!Array.isArray(r.marks) || r.marks.some((m) => !(MARKS as readonly unknown[]).includes(m))) p.push(`record.marks 要是 ${MARKS.join('、')} 的陣列`)
  return p
}

const footageProblems = (f: unknown): string[] => {
  if (!isRecord(f)) return ['footage 要是一段素材']
  const p: string[] = []
  if (!isText(f.title)) p.push('footage.title 要是一句標題')
  if (!isType(f.type)) p.push('footage.type 要是 battle、scandal、crime、intimate、celebrity、daily 其中一個')
  if (!isSafeInt(f.quality) || f.quality < 1 || f.quality > 5) p.push('footage.quality 要是 1～5 的整數')
  if (!isSafeInt(f.uses) || f.uses < 1 || f.uses > 20) p.push('footage.uses 要是 1～20 的整數')
  if (!isSafeInt(f.made_at) || f.made_at < 0) p.push('footage.made_at 要是總分鐘（非負整數）')
  return p
}

export function installOps(k: Kernel): void {
  k.changes.register<Change & { on: boolean }>({
    op: 'media.rec', owner: OWNER,
    validate: (_s, c) => (typeof c.on === 'boolean' ? [] : ['on 要是 true 或 false']),
    apply: (s, c) => write(s, (m) => { m.rec = c.on }),
    describe: (c) => (c.on ? '錄影：開著。' : '錄影：關掉了。'),
  })

  k.changes.register<Change & { record: RecordInit }>({
    op: 'media.add', owner: OWNER,
    validate: (_s, c) => recordProblems(c.record),
    apply: (s, c) => write(s, (m) => {
      m.seq += 1
      const id = `rc${m.seq}`
      m.records[id] = { ...c.record, id }
    }),
  })

  k.changes.register<Change & { add?: StagePending; clear?: true }>({
    op: 'media.stage', owner: OWNER,
    validate: (_s, c) => {
      if (c.clear === true) return []
      const a = c.add
      if (!isRecord(a) || !isText(a.commission)) return ['要寫 clear: true，或 add 帶 commission']
      return Array.isArray(a.marks) && a.marks.every((m) => (MARKS as readonly unknown[]).includes(m)) && Array.isArray(a.people) && Array.isArray(a.factions) ? [] : ['add 要有 marks、people、factions 的陣列']
    },
    apply: (s, c) => write(s, (m) => {
      if (c.clear === true || !c.add) { m.stage = null; return }
      // 另一件委託的暫存（那一件沒有走完）不接著用：換成新的
      const old = m.stage && m.stage.commission === c.add.commission ? m.stage : null
      const union = <T>(a: T[], b: T[]): T[] => [...new Set([...a, ...b])]
      m.stage = { commission: c.add.commission, marks: union(old?.marks ?? [], c.add.marks), people: union(old?.people ?? [], c.add.people), factions: union(old?.factions ?? [], c.add.factions) }
    }),
  })

  k.changes.register<Change & { footage: FootageInit; record?: string }>({
    op: 'media.make', owner: OWNER,
    validate: (s, c) => {
      const p = footageProblems(c.footage)
      if (c.record !== undefined) {
        const rec = readMedia(s).records[c.record]
        if (!rec) p.push(`沒有 ${String(c.record)} 這則紀錄`)
        else if (rec.made !== undefined) p.push('這則紀錄已經轉成素材了')
      }
      return p
    },
    apply: (s, c) => write(s, (m) => {
      m.seq += 1
      const id = `ft${m.seq}`
      m.footage[id] = { ...c.footage, id, ...(c.record !== undefined ? { from_record: c.record } : {}) }
      if (c.record !== undefined && m.records[c.record]) m.records[c.record] = { ...m.records[c.record]!, made: id }
    }),
  })

  k.changes.register<Change & { ref: string; take: number | 'all' }>({
    op: 'media.use', owner: OWNER,
    validate: (s, c) => {
      const f = isText(c.ref) ? readMedia(s).footage[c.ref] : undefined
      if (!f) return [`沒有 ${String(c.ref)} 這件素材`]
      if (c.take !== 'all' && !(isSafeInt(c.take) && c.take >= 1)) return ['take 要是 1 以上的整數，或 all']
      return f.uses > 0 ? [] : [`「${f.title}」已經用完了`]
    },
    apply: (s, c) => write(s, (m) => {
      const f = m.footage[c.ref]
      if (f) m.footage[c.ref] = { ...f, uses: c.take === 'all' ? 0 : Math.max(0, f.uses - c.take) }
    }),
  })
}
