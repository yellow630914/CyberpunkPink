// L6 功能 media 的變更種類（model.ts 檔頭列了八種）。每一種只動 state.ext.media，而且彼此疊在同一份報告裡也不會互相蓋掉
// （一份報告可以用掉好幾件素材、記好幾則紀錄；用整份 ext 換的寫法會被後面的蓋成舊的）。
// 編號（rc…、ft…）在套用時從 seq 發：同一個狀態、同一串變更一定得到同一個結果。

import type { Change, GameState, Kernel } from '../../core'
import { isRecord, isSafeInt } from '../../core'
import type { Cam, CardInfo, Clip, Footage, RecordEntry, StagePending } from './model'
import { CAM_KINDS, EXT, MARKS, OWNER, eventOfSource, isText, isType, mediaValue, readMedia } from './model'
import type { Pov } from './pov'
import { legacyPov, readPov } from './pov'

type Write = (state: GameState, fn: (m: ReturnType<typeof readMedia>) => void) => void
const write: Write = (state, fn) => {
  const m = readMedia(state)
  fn(m)
  state.ext[EXT] = mediaValue(m)
}

/** 記一則：視角與事件的鍵可以不寫（舊的寫法）：視角當「某人的 POV」（有拍的人就帶上他）、事件的鍵由來源推 */
export type RecordInit = Omit<RecordEntry, 'id' | 'pov' | 'event'> & { pov?: Pov; event?: string }
/** 多一段素材：視角可以不寫（事件給的素材、偽造的），當「某人的 POV」 */
export type FootageInit = Omit<Footage, 'id' | 'from_record' | 'pov'> & { pov?: Pov }
/** 架設一台攝影機（uid 套用時發 cm<seq>；帶 uid 是重架：換地方、換人拿） */
export type CamInit = Omit<Cam, 'uid'> & { uid?: string }
export type ClipInit = Omit<Clip, 'id'>
/** 重剪改的欄位：角度、三個數字、card、假料、抹黑的對象（null 是拿掉）。 */
export interface RecutPatch { angle: string; draw: number; trust: number; risk: number; card: CardInfo | null; forged: boolean; blame: string | null }

const recordProblems = (r: unknown): string[] => {
  if (!isRecord(r)) return ['record 要是一則紀錄']
  const p: string[] = []
  if (!isSafeInt(r.at) || r.at < 0) p.push('record.at 要是總分鐘（非負整數）')
  if (!isText(r.label)) p.push('record.label 要是一句標題')
  if (!isRecord(r.source) || !isText(r.source.kind)) p.push('record.source.kind 要是來源的種類')
  if (!isType(r.type)) p.push('record.type 要是 battle、scandal、crime、intimate、celebrity、daily 其中一個')
  if (r.by !== null && !isText(r.by)) p.push('record.by 要是角色 id 或 null')
  if (!Array.isArray(r.marks) || r.marks.some((m) => !(MARKS as readonly unknown[]).includes(m))) p.push(`record.marks 要是 ${MARKS.join('、')} 的陣列`)
  if (r.pov !== undefined && readPov(r.pov) === null) p.push('record.pov 要是 { kind, who? }（kind 是 self_pov、follow、drone、camera、cctv、other_pov 其中一個）')
  if (r.event !== undefined && !isText(r.event)) p.push('record.event 要是一件事的鍵（字串）')
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
  if (f.pov !== undefined && readPov(f.pov) === null) p.push('footage.pov 要是 { kind, who? }')
  return p
}

const clipProblems = (c: unknown): string[] => {
  if (!isRecord(c)) return ['clip 要是一支片']
  const p: string[] = []
  if (!Array.isArray(c.from) || c.from.length < 1 || c.from.length > 3 || !c.from.every(isText)) p.push('clip.from 要是一到三段素材的 id')
  if (!isText(c.angle)) p.push('clip.angle 要是角度的 id')
  if (typeof c.title !== 'string' || typeof c.intro !== 'string') p.push('clip.title 與 clip.intro 要是字串')
  if (!isSafeInt(c.quality) || c.quality < 1 || c.quality > 5) p.push('clip.quality 要是 1～5 的整數')
  if (!Array.isArray(c.types) || c.types.length < 1 || !c.types.every(isType)) p.push('clip.types 要是類型的陣列')
  for (const f of ['draw', 'trust', 'risk'] as const) if (!isSafeInt(c[f]) || (c[f] as number) < 0) p.push(`clip.${f} 要是 0 以上的整數`)
  if (!isSafeInt(c.uses) || c.uses < 1 || c.uses > 20) p.push('clip.uses 要是 1～20 的整數（用完的片不會出生）')
  if (!isSafeInt(c.made_at) || c.made_at < 0) p.push('clip.made_at 要是總分鐘（非負整數）')
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
      m.records[id] = { ...c.record, pov: readPov(c.record.pov) ?? legacyPov(), ...(readPov(c.record.pov) === null ? { legacy: true as const } : {}), event: isText(c.record.event) ? c.record.event : eventOfSource(c.record.source), id }
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
      const cut = union(old?.cut ?? [], c.add.cut ?? [])
      m.stage = { commission: c.add.commission, marks: union(old?.marks ?? [], c.add.marks), people: union(old?.people ?? [], c.add.people), factions: union(old?.factions ?? [], c.add.factions), ...(cut.length > 0 ? { cut } : {}) }
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
      const rec = c.record !== undefined ? m.records[c.record] : undefined
      // 視角與事件的鍵跟著紀錄帶過來（之後不變）；沒有紀錄的（事件給的、偽造的）沒寫就當「某人的 POV」
      const pov = readPov(c.footage.pov) ?? rec?.pov ?? legacyPov()
      const event = c.footage.event ?? rec?.event
      m.footage[id] = { ...c.footage, pov, ...(event ? { event } : {}), id, ...(c.record !== undefined ? { from_record: c.record } : {}) }
      if (c.record !== undefined && m.records[c.record]) m.records[c.record] = { ...m.records[c.record]!, made: id }
    }),
  })

  // 素材（ft…）與片（cl…）各有各的次數：用片不動來源，用素材也不動剪出來的片
  k.changes.register<Change & { ref: string; take: number | 'all' }>({
    op: 'media.use', owner: OWNER,
    validate: (s, c) => {
      const m = isText(c.ref) ? readMedia(s) : undefined
      const f = m ? m.footage[c.ref] ?? m.clips[c.ref] : undefined
      if (!f) return [`沒有 ${String(c.ref)} 這件料`]
      if (c.take !== 'all' && !(isSafeInt(c.take) && c.take >= 1)) return ['take 要是 1 以上的整數，或 all']
      return f.uses > 0 ? [] : [`「${f.title}」已經用完了`]
    },
    apply: (s, c) => write(s, (m) => {
      const f = m.footage[c.ref]
      if (f) { m.footage[c.ref] = { ...f, uses: c.take === 'all' ? 0 : Math.max(0, f.uses - c.take) }; return }
      const cl = m.clips[c.ref]
      if (cl) m.clips[c.ref] = { ...cl, uses: c.take === 'all' ? 0 : Math.max(0, cl.uses - c.take) }
    }),
  })

  k.changes.register<Change & { clip: ClipInit }>({
    op: 'media.clip', owner: OWNER,
    validate: (_s, c) => clipProblems(c.clip),
    apply: (s, c) => write(s, (m) => {
      m.seq += 1
      const id = `cl${m.seq}`
      m.clips[id] = { ...c.clip, id }
    }),
  })

  k.changes.register<Change & { ref: string } & RecutPatch>({
    op: 'media.recut', owner: OWNER,
    validate(s, c) {
      const cl = isText(c.ref) ? readMedia(s).clips[c.ref] : undefined
      if (!cl) return [`沒有 ${String(c.ref)} 這支片`]
      const p: string[] = []
      if (cl.recut) p.push('這支片已經重剪過了')
      if (!isText(c.angle)) p.push('angle 要是角度的 id')
      for (const f of ['draw', 'trust', 'risk'] as const) if (!isSafeInt(c[f]) || c[f] < 0) p.push(`${f} 要是 0 以上的整數`)
      if (typeof c.forged !== 'boolean') p.push('forged 要是 true 或 false')
      return p
    },
    apply: (s, c) => write(s, (m) => {
      const cl = m.clips[c.ref]
      if (!cl) return
      const { blame: _old, ...rest } = cl
      m.clips[c.ref] = { ...rest, angle: c.angle, draw: c.draw, trust: c.trust, risk: c.risk, card: c.card ? { ...c.card } : null, forged: c.forged, recut: true, ...(c.blame ? { blame: c.blame } : {}) }
    }),
  })

  k.changes.register<Change & { ref: string; title: string; intro: string; own_title: boolean; own_intro: boolean }>({
    op: 'media.retitle', owner: OWNER,
    validate: (s, c) => {
      const cl = isText(c.ref) ? readMedia(s).clips[c.ref] : undefined
      if (!cl) return [`沒有 ${String(c.ref)} 這支片`]
      return typeof c.title === 'string' && typeof c.intro === 'string' ? [] : ['title 與 intro 要是字串']
    },
    apply: (s, c) => write(s, (m) => {
      const cl = m.clips[c.ref]
      if (!cl) return
      const { titled: _t, own_title: _a, own_intro: _b, ...rest } = cl
      m.clips[c.ref] = { ...rest, title: c.title, intro: c.intro, ...(c.own_title ? { own_title: true as const } : {}), ...(c.own_intro ? { own_intro: true as const } : {}), ...(c.own_title || c.own_intro ? { titled: true as const } : {}) }
    }),
  })

  // 攝影機的架設：set 新架或重架（帶 uid）、drop 拿掉（放下就不錄）；uid 套用時從 seq 發（cm<seq>）
  k.changes.register<Change & { set?: CamInit; drop?: string }>({
    op: 'media.cam', owner: OWNER,
    validate(s, c) {
      const m = readMedia(s)
      if (c.drop !== undefined) return isText(c.drop) && m.cams.some((x) => x.uid === c.drop) ? [] : [`沒有 ${String(c.drop)} 這台攝影機的架設`]
      const x = c.set
      if (!isRecord(x)) return ['要寫 set（架設）或 drop（拿掉）']
      const p: string[] = []
      if (!isText(x.item)) p.push('set.item 要是攝影機的物品 id')
      if (!(CAM_KINDS as readonly unknown[]).includes(x.kind)) p.push(`set.kind 要是 ${CAM_KINDS.join('、')} 其中一個`)
      if (x.uid !== undefined && !m.cams.some((y) => y.uid === x.uid)) p.push(`沒有 ${String(x.uid)} 這台攝影機的架設`)
      return p
    },
    apply: (s, c) => write(s, (m) => {
      if (c.drop !== undefined) { m.cams = m.cams.filter((x) => x.uid !== c.drop); return }
      const x = c.set!
      const next = (uid: string): Cam => ({ uid, item: x.item, kind: x.kind, ...(x.holder ? { holder: x.holder } : {}), ...(x.place ? { place: { ...x.place } } : {}) })
      if (x.uid !== undefined) { m.cams = m.cams.map((y) => (y.uid === x.uid ? next(y.uid) : y)); return }
      m.seq += 1
      m.cams = [...m.cams, next(`cm${m.seq}`)]
    }),
  })
}
