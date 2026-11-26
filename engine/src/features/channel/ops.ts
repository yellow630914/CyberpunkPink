// L6 功能 channel 的變更種類（model.ts 檔頭列了十一種）。每一種只動 state.ext.channel，而且彼此疊在同一份報告裡也不會互相蓋掉
// （一份報告可以先付開銷、再記一集；用整份 ext 換的寫法會被後面的蓋成舊的）。預算的格子永遠不會被扣成負的：扣超過的整份報告不收。

import type { Change, GameState, Kernel } from '../../core'
import { isRecord, isSafeInt } from '../../core'
import type { ChannelState, Episode, GearRow, Role, Sponsor, Staff } from './model'
import { EXT, GEAR_CLASSES, OPEN_ACTION, OWN, OWNER, ROLES, channelRules, channelValue, isText, readChannel } from './model'

const write = (state: GameState, fn: (c: ChannelState) => void): void => {
  const c = readChannel(state)
  fn(c)
  state.ext[EXT] = channelValue(c)
}

const NOT_OPEN = '還沒有頻道。'

const delta = (v: unknown): v is number => isSafeInt(v)

export const sponsorProblems = (s: unknown): string[] => {
  if (!isRecord(s)) return ['sponsor 要是一份贊助']
  const p: string[] = []
  if (!isText(s.faction)) p.push('sponsor.faction 要是勢力的 id')
  if (!isSafeInt(s.every_weeks) || s.every_weeks < 1) p.push('sponsor.every_weeks 要是 1 以上的整數')
  if (!isSafeInt(s.amount) || s.amount < 0) p.push('sponsor.amount 要是 0 以上的整數')
  if (!isSafeInt(s.since) || s.since < 0) p.push('sponsor.since 要是總分鐘（非負整數）')
  if (!isSafeInt(s.weeks_left_to_pay) || s.weeks_left_to_pay < 0) p.push('sponsor.weeks_left_to_pay 要是 0 以上的整數')
  if (!isSafeInt(s.eps_since_plug) || s.eps_since_plug < 0) p.push('sponsor.eps_since_plug 要是 0 以上的整數')
  if (s.plug_every !== undefined && !(isSafeInt(s.plug_every) && s.plug_every >= 1)) p.push('sponsor.plug_every 要是 1 以上的整數')
  if (s.plug_pay !== undefined && !(isSafeInt(s.plug_pay) && s.plug_pay >= 0)) p.push('sponsor.plug_pay 要是 0 以上的整數')
  return p
}

const episodeProblems = (e: unknown): string[] => {
  if (!isRecord(e)) return ['entry 要是一筆集數的紀錄']
  const p: string[] = []
  if (e.kind !== 'live' && e.kind !== 'show') p.push('entry.kind 要是 live 或 show')
  if (!isSafeInt(e.at) || e.at < 0) p.push('entry.at 要是總分鐘（非負整數）')
  if (typeof e.subs !== 'number' || !Number.isFinite(e.subs)) p.push('entry.subs 要是數字')
  if (typeof e.tips !== 'number' || !Number.isFinite(e.tips)) p.push('entry.tips 要是數字')
  if (typeof e.note !== 'string') p.push('entry.note 要是一句話')
  return p
}

export function installOps(k: Kernel): void {
  k.changes.register<Change & { name: string; at: number }>({
    op: OPEN_ACTION, owner: OWNER,
    validate: (s, c) => {
      const p: string[] = []
      if (readChannel(s).open) p.push('頻道已經開了')
      if (typeof c.name !== 'string' || c.name.length === 0 || c.name.length > 400) p.push('name 要是頻道的名字（1～400 個字元）')
      if (!isSafeInt(c.at) || c.at < 0) p.push('at 要是總分鐘（非負整數）')
      return p
    },
    apply: (s, c) => write(s, (ch) => { ch.open = true; ch.name = c.name; ch.since = c.at; ch.mark = c.at }),
    describe: (c) => `開了頻道「${c.name}」。`,
  })

  k.changes.register<Change & { pool: string; cred?: number; cash?: number; quota?: number }>({
    op: 'channel.budget', owner: OWNER,
    validate: (s, c) => {
      const ch = readChannel(s)
      if (!ch.open) return [NOT_OPEN]
      if (!isText(c.pool) || c.pool === '__proto__') return ['pool 要是 own 或勢力的 id']
      const p: string[] = []
      for (const f of ['cred', 'cash', 'quota'] as const) if (c[f] !== undefined && !delta(c[f])) p.push(`${f} 要是整數（可以是負的）`)
      if (p.length) return p
      if (c.pool === OWN) {
        if (c.quota !== undefined && c.quota !== 0) p.push('自有資金沒有可支領額度')
        const have = ch.budget.own
        if (have.cred + (c.cred ?? 0) < 0) p.push(`預算（自有）的帳戶不夠：有 ${have.cred}，要扣 ${-(c.cred ?? 0)}`)
        if (have.cash + (c.cash ?? 0) < 0) p.push(`預算（自有）的現金不夠：有 ${have.cash}，要扣 ${-(c.cash ?? 0)}`)
        return p
      }
      if (c.cash !== undefined && c.cash !== 0) p.push('公帳只有帳戶一格，沒有現金')
      const have = ch.budget.pools[c.pool] ?? { cred: 0, quota: 0 }
      if (have.cred + (c.cred ?? 0) < 0) p.push(`公帳（${c.pool}）不夠：有 ${have.cred}，要扣 ${-(c.cred ?? 0)}`)
      if (have.quota + (c.quota ?? 0) < 0) p.push(`公帳（${c.pool}）的可支領額度不夠：有 ${have.quota}，要扣 ${-(c.quota ?? 0)}`)
      return p
    },
    apply: (s, c) => write(s, (ch) => {
      if (c.pool === OWN) {
        ch.budget.own.cred += c.cred ?? 0
        ch.budget.own.cash += c.cash ?? 0
        return
      }
      const pool = ch.budget.pools[c.pool] ?? { cred: 0, quota: 0 }
      pool.cred += c.cred ?? 0
      pool.quota += c.quota ?? 0
      ch.budget.pools[c.pool] = pool
    }),
    describe: (c) => {
      const parts = [['帳戶', c.cred], ['現金', c.cash], ['額度', c.quota]].filter((x): x is [string, number] => typeof x[1] === 'number' && x[1] !== 0)
        .map(([name, n]) => `${name} ${n > 0 ? '+' : '−'}${Math.abs(n)}`)
      return parts.length ? `預算（${c.pool === OWN ? '自有' : `公帳 ${c.pool}`}）：${parts.join('，')}` : null
    },
  })

  k.changes.register<Change & { sponsor: Sponsor }>({
    op: 'channel.sponsor', owner: OWNER,
    validate: (s, c) => (readChannel(s).open ? sponsorProblems(c.sponsor) : [NOT_OPEN]),
    apply: (s, c) => write(s, (ch) => {
      const next = { ...c.sponsor }
      const at = ch.sponsors.findIndex((x) => x.faction === next.faction)
      if (at >= 0) ch.sponsors[at] = next
      else ch.sponsors.push(next)
    }),
    describe: (c) => `贊助：${c.sponsor.faction}，每 ${c.sponsor.every_weeks} 週 ${c.sponsor.amount}`,
  })

  k.changes.register<Change & { faction: string; weeks_left_to_pay?: number; eps_since_plug?: number }>({
    op: 'channel.sponsor_set', owner: OWNER,
    validate: (s, c) => {
      const ch = readChannel(s)
      if (!ch.open) return [NOT_OPEN]
      const p: string[] = []
      if (!ch.sponsors.some((x) => x.faction === c.faction)) p.push(`沒有 ${String(c.faction)} 的贊助`)
      for (const f of ['weeks_left_to_pay', 'eps_since_plug'] as const) if (c[f] !== undefined && !(isSafeInt(c[f]) && (c[f] as number) >= 0)) p.push(`${f} 要是 0 以上的整數`)
      return p
    },
    apply: (s, c) => write(s, (ch) => {
      const sp = ch.sponsors.find((x) => x.faction === c.faction)
      if (!sp) return
      if (c.weeks_left_to_pay !== undefined) sp.weeks_left_to_pay = c.weeks_left_to_pay
      if (c.eps_since_plug !== undefined) sp.eps_since_plug = c.eps_since_plug
    }),
  })

  k.changes.register<Change & { faction: string }>({
    op: 'channel.sponsor_end', owner: OWNER,
    validate: (s, c) => (!readChannel(s).open ? [NOT_OPEN] : readChannel(s).sponsors.some((x) => x.faction === c.faction) ? [] : [`沒有 ${String(c.faction)} 的贊助`]),
    apply: (s, c) => write(s, (ch) => { ch.sponsors = ch.sponsors.filter((x) => x.faction !== c.faction) }),
    describe: (c) => `終止 ${c.faction} 的贊助`,
  })

  k.changes.register<Change & { episodes?: number; lives?: number; adult_reco?: boolean; reset?: true; mark?: number }>({
    op: 'channel.week', owner: OWNER,
    validate: (s, c) => {
      if (!readChannel(s).open) return [NOT_OPEN]
      const p: string[] = []
      for (const f of ['episodes', 'lives'] as const) if (c[f] !== undefined && !(isSafeInt(c[f]) && (c[f] as number) >= 0)) p.push(`${f} 要是 0 以上的整數（加幾）`)
      if (c.adult_reco !== undefined && typeof c.adult_reco !== 'boolean') p.push('adult_reco 要是 true 或 false')
      if (c.mark !== undefined && !(isSafeInt(c.mark) && c.mark >= 0)) p.push('mark 要是總分鐘（非負整數）')
      return p
    },
    // 先清、再加：一份報告裡「結算這一週」與「這一週開過」不會互相吃掉
    apply: (s, c) => write(s, (ch) => {
      if (c.reset === true) ch.week = { episodes: 0, lives: 0, adult_reco: false }
      ch.week.episodes += c.episodes ?? 0
      ch.week.lives += c.lives ?? 0
      if (c.adult_reco !== undefined) ch.week.adult_reco = c.adult_reco
      if (c.mark !== undefined) ch.mark = c.mark
    }),
  })

  k.changes.register<Change & { entry: Episode }>({
    op: 'channel.log', owner: OWNER,
    validate: (s, c) => (readChannel(s).open ? episodeProblems(c.entry) : [NOT_OPEN]),
    apply: (s, c) => write(s, (ch) => { ch.log = [...ch.log, c.entry].slice(-channelRules(k).log_keep) }),
  })

  // 編制：staff 給 null 是請他離開；同一個人不能坐兩個位子（位子的上限看頻道等級，入口自己擋：seatStaff）
  k.changes.register<Change & { role: Role; staff: Pick<Staff, 'who' | 'hired' | 'wage'> | null }>({
    op: 'channel.staff', owner: OWNER,
    validate: (s, c) => {
      const ch = readChannel(s)
      if (!ch.open) return [NOT_OPEN]
      if (!(ROLES as readonly unknown[]).includes(c.role)) return [`role 要是 ${ROLES.join('、')} 其中一個`]
      if (c.staff === null) return ch.staff[c.role] ? [] : ['那個位子本來就沒有人']
      if (!isRecord(c.staff) || !isText(c.staff.who)) return ['staff.who 要是角色的 id']
      const p: string[] = []
      if (typeof c.staff.hired !== 'boolean') p.push('staff.hired 要是 true 或 false')
      if (!isSafeInt(c.staff.wage) || c.staff.wage < 0) p.push('staff.wage 要是 0 以上的整數')
      const other = ROLES.find((r) => r !== c.role && ch.staff[r]?.who === c.staff!.who)
      if (other) p.push(`${c.staff.who} 已經坐在別的位子上了`)
      return p
    },
    apply: (s, c) => write(s, (ch) => {
      if (c.staff === null) delete ch.staff[c.role]
      else ch.staff[c.role] = { who: c.staff.who, hired: c.staff.hired, wage: c.staff.wage, unpaid_weeks: 0 }
    }),
    describe: (c) => (c.staff === null ? `${c.role} 的位子空了` : `${c.role} 的位子換成 ${c.staff.who}`),
  })

  k.changes.register<Change & { role: Role; unpaid_weeks: number }>({
    op: 'channel.staff_set', owner: OWNER,
    validate: (s, c) => {
      const ch = readChannel(s)
      if (!ch.open) return [NOT_OPEN]
      if (!(ROLES as readonly unknown[]).includes(c.role) || !ch.staff[c.role]) return ['那個位子沒有人']
      return isSafeInt(c.unpaid_weeks) && c.unpaid_weeks >= 0 ? [] : ['unpaid_weeks 要是 0 以上的整數']
    },
    apply: (s, c) => write(s, (ch) => { ch.staff[c.role]!.unpaid_weeks = c.unpaid_weeks }),
  })

  k.changes.register<Change & { gear: GearRow }>({
    op: 'channel.gear_add', owner: OWNER,
    validate: (s, c) => {
      const ch = readChannel(s)
      if (!ch.open) return [NOT_OPEN]
      if (!isRecord(c.gear)) return ['gear 要是一件設備']
      const g = c.gear
      const p: string[] = []
      if (!isText(g.uid)) p.push('gear.uid 要是流水號')
      else if (ch.gear.some((x) => x.uid === g.uid)) p.push(`設備 ${g.uid} 已經裝著了`)
      if (!isText(g.item)) p.push('gear.item 要是物品的 id')
      if (!(GEAR_CLASSES as readonly unknown[]).includes(g.cls)) p.push(`gear.cls 要是 ${GEAR_CLASSES.join('、')} 其中一個`)
      if (!isSafeInt(g.grade) || g.grade < 1 || g.grade > 3) p.push('gear.grade 要是 1～3（消費、專業、企業級）')
      if (typeof g.portable !== 'boolean') p.push('gear.portable 要是 true 或 false')
      return p
    },
    apply: (s, c) => write(s, (ch) => { ch.gear.push({ uid: c.gear.uid, item: c.gear.item, cls: c.gear.cls, grade: c.gear.grade, portable: c.gear.portable }); ch.seq += 1 }),
    describe: (c) => `裝上設備 ${c.gear.item}`,
  })

  k.changes.register<Change & { uid: string }>({
    op: 'channel.gear_remove', owner: OWNER,
    validate: (s, c) => (!readChannel(s).open ? [NOT_OPEN] : readChannel(s).gear.some((x) => x.uid === c.uid) ? [] : [`沒有裝著設備 ${String(c.uid)}`]),
    apply: (s, c) => write(s, (ch) => { ch.gear = ch.gear.filter((x) => x.uid !== c.uid) }),
  })
}
