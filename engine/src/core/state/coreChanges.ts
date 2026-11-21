// L3 狀態核心：核心自己註冊的通用變更。功能要的其他種類自己註冊（kernel.changes.register）。
//
// | op | 欄位 | 做什麼 |
// |---|---|---|
// | cred、cash | delta | 帳戶、現金晶片加減；不會變成負數（不夠就不合法） |
// | time | minutes | 時間往前推 |
// | flag | key, value（null 是拿掉） | 劇情旗標，只有這一種寫法 |
// | counter | key, delta | 計數器 |
// | item | id, qty（負的是拿走）, data? | 背包 |
// | location | to | 換地點 |
// | rng | advance | 亂數游標往前（每條任務鏈套用時一次） |
// | rules | patch | 改存檔規則 |
// | actor.add | actor | 新增一個角色；年齡低於 18 一律擋下 |
// | actor.remove | id | 拿掉一個角色 |
// | actor.track | id, track(hp/load/sink/afterglow), delta | 三條軌與餘韻的加減，最低 0（上限由產生變更的人先算好） |
// | actor.skill | id, skill, delta | 基本功等級加減，0～6 |
// | actor.perk | id, perk, remove? | 加上或拿掉一個特質 |
// | actor.condition | id, condition, until?, remove? | 加上或拿掉一個暫時的狀態 |
// | actor.ext | id, key, value | 角色身上某個功能自己的資料，整份換掉 |
// | pc | id | 指定主角 |
// | party | id, remove? | 進出隊伍 |
// | ext | key, value | 某個功能自己的狀態，整份換掉 |
// | chain | slot | 記下一條任務鏈的細節，並清掉五樓以前的（AI_TASKS 5.5 節） |
// | narration | report, text?, uncovered?, results? | 替一份已經提交的報告補上正文（寫正文在結果之後才有） |

import type { Actor, ChainRecordSlot, Change, FlagValue, GameState, ReportLocation, SaveRules } from '../types'
import { ATTR_IDS } from '../types'
import { clone } from '../util/clone'
import { formatAmount } from '../util/money'
import { isId, isRecord } from '../util/sanitize'
import { addMinutes, isValidTime } from '../util/time'
import type { ChangeDef, ChangeRegistry } from './changes'
import { addItem, countItem, removeItem } from './inventory'

/** 只保留最近幾樓的任務鏈細節（AI_TASKS 5.5 節）。 */
export const CHAIN_FLOORS_KEPT = 5
/** 所有角色 18 歲以上（AI_TASKS 3.19 節；PROMPTS H5）。 */
export const MIN_AGE = 18
export const SKILL_MAX = 6
export const TRACKS = ['hp', 'load', 'sink', 'afterglow'] as const
export type TrackId = (typeof TRACKS)[number]

const isInt = (v: unknown): v is number => typeof v === 'number' && Number.isInteger(v)
const actorOf = (s: GameState, id: unknown): Actor | undefined => (typeof id === 'string' ? s.actors[id] : undefined)
const needActor = (s: GameState, id: unknown): string[] => (actorOf(s, id) ? [] : [`沒有 ${String(id)} 這個角色`])

/** 一個角色的骨架合不合格式。回傳錯誤訊息。 */
export function validateActor(a: unknown): string[] {
  if (!isRecord(a)) return ['角色要是一個物件']
  const p: string[] = []
  if (!isId(a.id)) p.push('id 的格式不對')
  if (typeof a.name !== 'string' || !a.name.trim()) p.push('要有名字')
  if (!['pc', 'companion', 'npc'].includes(a.role as string)) p.push('role 只能是 pc、companion、npc')
  if (!isInt(a.age)) p.push('年齡要是整數')
  else if (a.age < MIN_AGE) p.push(`所有角色都是成年人：年齡要 ${MIN_AGE} 以上（拿到 ${a.age}）`)
  if (!isRecord(a.attrs) || ATTR_IDS.some((k) => !isInt((a.attrs as Record<string, unknown>)[k]))) p.push('六項屬性都要是整數')
  if (!isRecord(a.skills) || Object.values(a.skills).some((v) => !isInt(v) || v < 0 || v > SKILL_MAX)) p.push(`基本功等級要是 0～${SKILL_MAX} 的整數`)
  if (!Array.isArray(a.perks) || a.perks.some((x) => typeof x !== 'string')) p.push('perks 要是 id 的陣列')
  for (const t of TRACKS) if (!isInt(a[t]) || (a[t] as number) < 0) p.push(`${t} 要是 0 以上的整數`)
  if (!Array.isArray(a.conditions)) p.push('conditions 要是陣列')
  if (!isRecord(a.ext)) p.push('ext 要是物件')
  return p
}

const money = (op: 'cred' | 'cash', name: string): ChangeDef<Change & { delta: number }> => ({
  op, owner: 'core',
  validate: (s, c) => (!isInt(c.delta) ? ['delta 要是整數'] : s.money[op] + c.delta < 0 ? [`${name}不夠：有 ${s.money[op]}，要扣 ${-c.delta}`] : []),
  apply: (s, c) => { s.money[op] += c.delta },
  describe: (c) => (c.delta ? `${name} ${c.delta > 0 ? '+' : '−'}${formatAmount(Math.abs(c.delta))}` : null),
})

export function registerCoreChanges(reg: ChangeRegistry): void {
  reg.register(money('cred', '帳戶'))
  reg.register(money('cash', '現金'))

  reg.register<Change & { minutes: number }>({
    op: 'time', owner: 'core',
    validate: (_s, c) => (isInt(c.minutes) && c.minutes >= 0 ? [] : ['minutes 要是 0 以上的整數（時間只往前走）']),
    apply: (s, c) => { s.time = addMinutes(s.time, c.minutes) },
  })

  reg.register<Change & { key: string; value: FlagValue | null }>({
    op: 'flag', owner: 'core',
    validate: (_s, c) => [
      ...(typeof c.key === 'string' && c.key ? [] : ['key 要是字串']),
      ...(c.value === null || ['boolean', 'number', 'string'].includes(typeof c.value) ? [] : ['value 只能是布林、數字、字串或 null']),
    ],
    apply: (s, c) => {
      if (c.value === null) delete s.flags[c.key]
      else s.flags[c.key] = c.value
    },
  })

  reg.register<Change & { key: string; delta: number }>({
    op: 'counter', owner: 'core',
    validate: (_s, c) => (typeof c.key === 'string' && c.key && isInt(c.delta) ? [] : ['要有 key 與整數的 delta']),
    apply: (s, c) => { s.counters[c.key] = (s.counters[c.key] ?? 0) + c.delta },
  })

  reg.register<Change & { id: string; qty: number; data?: Record<string, unknown> }>({
    op: 'item', owner: 'core',
    validate: (s, c) => {
      if (!isId(c.id)) return ['物品的 id 格式不對']
      if (!isInt(c.qty) || c.qty === 0) return ['qty 要是不為 0 的整數']
      if (c.qty < 0 && countItem(s.inventory, c.id) < -c.qty) return [`背包裡的 ${c.id} 不夠 ${-c.qty} 個`]
      return []
    },
    apply: (s, c) => {
      if (c.qty > 0) addItem(s.inventory, c.id, c.qty, c.data ? clone(c.data) : undefined)
      else removeItem(s.inventory, c.id, -c.qty)
    },
    describe: (c) => `${c.qty > 0 ? '得到' : '失去'} ${c.id} ×${Math.abs(c.qty)}`,
  })

  reg.register<Change & { to: ReportLocation }>({
    op: 'location', owner: 'core',
    validate: (_s, c) => (isRecord(c.to) ? [] : ['to 要是地點']),
    apply: (s, c) => { s.location = clone(c.to) },
  })

  reg.register<Change & { advance: number }>({
    op: 'rng', owner: 'core',
    validate: (_s, c) => (isInt(c.advance) && c.advance > 0 ? [] : ['advance 要是正整數']),
    apply: (s, c) => { s.rng.cursor += c.advance },
  })

  reg.register<Change & { patch: Partial<SaveRules> }>({
    op: 'rules', owner: 'core',
    validate: (s, c) => (isRecord(c.patch) && Object.keys(c.patch).every((k) => k in s.rules) ? [] : ['patch 只能改存檔規則裡有的欄位']),
    apply: (s, c) => { Object.assign(s.rules, clone(c.patch)) },
  })

  reg.register<Change & { actor: Actor }>({
    op: 'actor.add', owner: 'core',
    validate: (s, c) => {
      const p = validateActor(c.actor)
      if (!p.length && s.actors[c.actor.id]) p.push(`角色的 id 重複：${c.actor.id}`)
      return p
    },
    apply: (s, c) => { s.actors[c.actor.id] = clone(c.actor) },
  })

  reg.register<Change & { id: string }>({
    op: 'actor.remove', owner: 'core',
    validate: (s, c) => [...needActor(s, c.id), ...(s.pc === c.id ? ['不能拿掉主角'] : [])],
    apply: (s, c) => {
      delete s.actors[c.id]
      s.party = s.party.filter((x) => x !== c.id)
    },
  })

  reg.register<Change & { id: string; track: TrackId; delta: number }>({
    op: 'actor.track', owner: 'core',
    validate: (s, c) => [...needActor(s, c.id), ...(TRACKS.includes(c.track) ? [] : ['track 只能是 hp、load、sink、afterglow']), ...(isInt(c.delta) ? [] : ['delta 要是整數'])],
    apply: (s, c) => {
      const a = s.actors[c.id]!
      a[c.track] = Math.max(0, a[c.track] + c.delta)
    },
  })

  reg.register<Change & { id: string; skill: string; delta: number }>({
    op: 'actor.skill', owner: 'core',
    validate: (s, c) => {
      const a = actorOf(s, c.id)
      if (!a) return needActor(s, c.id)
      if (!isId(c.skill) || !isInt(c.delta)) return ['要有 skill 與整數的 delta']
      const v = (a.skills[c.skill] ?? 0) + c.delta
      return v < 0 || v > SKILL_MAX ? [`基本功等級要在 0～${SKILL_MAX}（會變成 ${v}）`] : []
    },
    apply: (s, c) => {
      const a = s.actors[c.id]!
      a.skills[c.skill] = (a.skills[c.skill] ?? 0) + c.delta
    },
  })

  reg.register<Change & { id: string; perk: string; remove?: boolean }>({
    op: 'actor.perk', owner: 'core',
    validate: (s, c) => {
      const a = actorOf(s, c.id)
      if (!a) return needActor(s, c.id)
      if (!isId(c.perk)) return ['perk 的 id 格式不對']
      if (c.remove) return a.perks.includes(c.perk) ? [] : [`${c.id} 沒有 ${c.perk} 這個特質`]
      return a.perks.includes(c.perk) ? [`${c.id} 已經有 ${c.perk} 了`] : []
    },
    apply: (s, c) => {
      const a = s.actors[c.id]!
      if (c.remove) a.perks = a.perks.filter((x) => x !== c.perk)
      else a.perks.push(c.perk)
    },
  })

  reg.register<Change & { id: string; condition: string; until?: number; remove?: boolean }>({
    op: 'actor.condition', owner: 'core',
    validate: (s, c) => [...needActor(s, c.id), ...(isId(c.condition) ? [] : ['condition 的 id 格式不對']), ...(c.until === undefined || isInt(c.until) ? [] : ['until 要是整數（總分鐘數）'])],
    apply: (s, c) => {
      const a = s.actors[c.id]!
      a.conditions = a.conditions.filter((x) => x.id !== c.condition)
      if (!c.remove) a.conditions.push(c.until === undefined ? { id: c.condition } : { id: c.condition, until: c.until })
    },
  })

  reg.register<Change & { id: string; key: string; value: unknown }>({
    op: 'actor.ext', owner: 'core',
    validate: (s, c) => [...needActor(s, c.id), ...(typeof c.key === 'string' && c.key ? [] : ['key 要是字串'])],
    apply: (s, c) => {
      const a = s.actors[c.id]!
      if (c.value === null || c.value === undefined) delete a.ext[c.key]
      else a.ext[c.key] = clone(c.value)
    },
  })

  reg.register<Change & { id: string }>({
    op: 'pc', owner: 'core',
    validate: (s, c) => {
      const a = actorOf(s, c.id)
      return !a ? needActor(s, c.id) : a.role === 'pc' ? [] : ['主角的 role 要是 pc']
    },
    apply: (s, c) => {
      s.pc = c.id
      if (!s.party.includes(c.id)) s.party.unshift(c.id)
    },
  })

  reg.register<Change & { id: string; remove?: boolean }>({
    op: 'party', owner: 'core',
    validate: (s, c) => [...needActor(s, c.id), ...(c.remove && s.pc === c.id ? ['主角不能離隊'] : [])],
    apply: (s, c) => {
      s.party = s.party.filter((x) => x !== c.id)
      if (!c.remove) s.party.push(c.id)
    },
  })

  reg.register<Change & { key: string; value: unknown }>({
    op: 'ext', owner: 'core',
    validate: (_s, c) => (typeof c.key === 'string' && c.key ? [] : ['key 要是字串']),
    apply: (s, c) => {
      if (c.value === null || c.value === undefined) delete s.ext[c.key]
      else s.ext[c.key] = clone(c.value)
    },
  })

  reg.register<Change & { slot: ChainRecordSlot }>({
    op: 'chain', owner: 'core',
    validate: (_s, c) => (isRecord(c.slot) && typeof c.slot.id === 'string' && isInt(c.slot.floor) ? [] : ['slot 要有 id 與 floor']),
    forLog: (c) => ({ op: 'chain', slot: { id: c.slot.id, floor: c.slot.floor } }),
    apply: (s, c) => {
      if (!s.chains.some((x) => x.id === c.slot.id)) s.seq.chain += 1
      s.chains = s.chains.filter((x) => x.id !== c.slot.id)
      s.chains.push(clone(c.slot))
      s.seq.floor = Math.max(s.seq.floor, c.slot.floor)
      const keepFrom = s.seq.floor - CHAIN_FLOORS_KEPT + 1
      for (const slot of s.chains) {
        if (slot.floor < keepFrom && !slot.cleaned) {
          slot.cleaned = true
          delete slot.detail
        }
      }
    },
  })

  reg.register<Change & { report: string; text?: string; results?: string[]; uncovered?: number[] }>({
    op: 'narration', owner: 'core',
    validate: (s, c) => (s.reports.some((r) => r.id === c.report) ? [] : [`沒有 ${String(c.report)} 這份報告`]),
    apply: (s, c) => {
      const r = s.reports.find((x) => x.id === c.report)!
      r.narration = { ...r.narration, ...(c.text !== undefined ? { text: c.text } : {}), ...(c.results ? { results: [...c.results] } : {}), ...(c.uncovered ? { uncovered: [...c.uncovered] } : {}) }
    },
  })
}

/** 狀態裡任何深度的 age 欄位，低於 18 的位置（讀檔與匯入時整筆拒絕，不自動改成 18）。 */
export function underageAt(v: unknown, path = ''): string[] {
  if (Array.isArray(v)) return v.flatMap((x, i) => underageAt(x, `${path}[${i}]`))
  if (isRecord(v)) {
    const out: string[] = []
    for (const [k, x] of Object.entries(v)) {
      if (k === 'age' && typeof x === 'number' && x < MIN_AGE) out.push(path ? `${path}.age` : 'age')
      else out.push(...underageAt(x, path ? `${path}.${k}` : k))
    }
    return out
  }
  return []
}

export { isValidTime }
