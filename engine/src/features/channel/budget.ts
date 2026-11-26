// L6 功能 channel 的預算（MEDIA 4.2 節；dev/adr/0020 第二節、V15）：補貼、開銷的扣法、拿出來、贊助的終止。
// 預算不是主角身上的錢，也不走 bill.collect：它在 state.ext.channel.budget，只經由 channel.* 變更動。
// 改狀態的入口都是「匯出一個純函式，回傳報告草稿」，不成立丟 ActionBlocked（原因寫成給玩家看的完整句子）。

import type { Change, ContentEntry, GameState, Kernel, ReportDraft, TimelineBeat } from '../../core'
import { ActionBlocked, clone, isSafeInt } from '../../core'
import type { ChannelState, Pool } from './model'
import { FUND_ACTION, OWN, SPONSOR_END_ACTION, WITHDRAW_ACTION, channelRules, isText, readChannel } from './model'

export type Purse = 'cred' | 'cash'
const PURSE_NAME: Record<Purse, string> = { cred: '帳戶', cash: '現金' }
const NOT_OPEN = '還沒有頻道，沒有預算可以用。'

const draftOf = (state: GameState, action: string, changes: Change[], result: string, summary: string, beat?: TimelineBeat): ReportDraft => ({
  kind: 'broadcast', action, location: clone(state.location), ...(state.pc ? { actor: state.pc } : {}), party: [], timeline: beat ? [beat] : [], changes, outcome: { result, summary },
})

const beatOf = (state: GameState, tag: string, text: string, data: Record<string, unknown>): TimelineBeat => ({ layer: 'meat', ...(state.pc ? { actor: state.pc } : {}), text, tag, data })

const nameOf = (k: Pick<Kernel, 'content'>, pool: string): string => {
  if (pool === OWN) return '自有資金'
  const f = k.content.hasKind('faction') ? k.content.get<ContentEntry & { name?: unknown; short?: unknown }>('faction', pool) : undefined
  return typeof f?.short === 'string' && f.short ? f.short : typeof f?.name === 'string' && f.name ? f.name : pool
}

const money = (n: number): string => n.toLocaleString('en-US')

/** 公帳的名單：先照金主加入的先後，再接著沒有贊助（例如事件撥的）但有錢的。 */
export function poolOrder(ch: Pick<ChannelState, 'sponsors' | 'budget'>): string[] {
  const ids = ch.sponsors.map((s) => s.faction)
  for (const id of Object.keys(ch.budget.pools)) if (!ids.includes(id)) ids.push(id)
  return ids
}

// ---- 開銷的扣法 ----

export interface Paid {
  pool: string
  purse: Purse
  amount: number
}

export type PayAnswer = { changes: Change[]; paid: Paid[] } | { block: string }

/**
 * 頻道的開銷怎麼扣（MEDIA 4.2）：先扣公帳（照金主加入的先後，只扣帳戶那一格），再扣自有資金。
 * purse 寫了的是只收一種錢的開銷（黑市的設備只收現金、平台的推廣只收帳戶）：那一格不夠就付不出來；公帳只有帳戶，所以只收現金的開銷公帳付不了。
 * 沒寫的：公帳之後自有的帳戶先、現金後。純函式（不改 state）；回傳的變更套上去才真的扣，付不出來回 { block }（一句完整的原因）。
 * 公帳的可支領額度不受影響（那是「拿出來」才扣的）。
 */
export function payFromBudget(state: Pick<GameState, 'ext'>, amount: number, o: { purse?: Purse } = {}): PayAnswer {
  const ch = readChannel(state)
  if (!ch.open) return { block: NOT_OPEN }
  if (!isSafeInt(amount) || amount < 0) return { block: '開銷要是 0 以上的整數。' }
  if (amount === 0) return { changes: [], paid: [] }
  const slots: Array<{ pool: string; purse: Purse; have: number }> = []
  if (o.purse !== 'cash') for (const id of poolOrder(ch)) slots.push({ pool: id, purse: 'cred', have: ch.budget.pools[id]?.cred ?? 0 })
  if (o.purse !== 'cash') slots.push({ pool: OWN, purse: 'cred', have: ch.budget.own.cred })
  if (o.purse !== 'cred') slots.push({ pool: OWN, purse: 'cash', have: ch.budget.own.cash })
  const have = slots.reduce((s, x) => s + x.have, 0)
  if (have < amount) {
    const where = o.purse === 'cash' ? '這筆只收現金（公帳是帳戶，付不了），自有資金的現金' : o.purse === 'cred' ? '這筆只收帳戶，公帳加自有資金的帳戶' : '公帳加自有資金'
    return { block: `預算不夠：${where}共有 ${money(have)}，要 ${money(amount)}，還差 ${money(amount - have)}。` }
  }
  let left = amount
  const paid: Paid[] = []
  for (const s of slots) {
    if (left <= 0) break
    const take = Math.min(left, s.have)
    if (take > 0) { paid.push({ pool: s.pool, purse: s.purse, amount: take }); left -= take }
  }
  const changes = paid.map((p): Change => ({ op: 'channel.budget', pool: p.pool, [p.purse]: -p.amount }))
  return { changes, paid }
}

// ---- 補貼 ----

export interface FundInput {
  purse: Purse
  amount: number
}

/** 補貼的入口擋下的原因（成立是 null）。 */
export function fundBlock(k: Pick<Kernel, 'activity'>, state: GameState, input: FundInput): string | null {
  if (!readChannel(state).open) return '還沒有頻道，沒有預算可以補貼。'
  if (input.purse !== 'cred' && input.purse !== 'cash') return '要選從帳戶或現金投進去。'
  if (!isSafeInt(input.amount) || input.amount < 1) return '補貼的錢要是 1 以上的整數。'
  if (state.money[input.purse] < input.amount) return `你的${PURSE_NAME[input.purse]}只有 ${money(state.money[input.purse])}，投不了 ${money(input.amount)}。`
  return k.activity.blockOf(state, `commit:${FUND_ACTION}`)
}

/** 把自己的錢投進預算的自有那一格（從帳戶投進帳戶、從現金投進現金），沒有代價；隨時拿得回來。 */
export function fund(k: Pick<Kernel, 'activity'>, state: GameState, input: FundInput): ReportDraft {
  const block = fundBlock(k, state, input)
  if (block) throw new ActionBlocked(block)
  const text = `你把 ${money(input.amount)} 的${PURSE_NAME[input.purse]}投進了頻道的預算。`
  return draftOf(state, FUND_ACTION, [{ op: input.purse, delta: -input.amount }, { op: 'channel.budget', pool: OWN, [input.purse]: input.amount }], 'ok', text,
    beatOf(state, FUND_ACTION, text, { purse: input.purse, amount: input.amount }))
}

// ---- 拿出來 ----

export interface WithdrawInput {
  /** own（自有資金）或勢力的 id（公帳） */
  pool: string
  amount: number
  /** 自有資金拿的是帳戶還是現金（預設帳戶）；公帳只有帳戶 */
  purse?: Purse
}

export interface WithdrawPreview {
  ok: boolean
  /** 擋下的原因（ok 為 false 時才有） */
  block: string | null
  pool: string
  purse: Purse
  amount: number
  /** 在可支領額度以內、沒有代價的部分 */
  free: number
  /** 超過額度的部分 */
  over: number
  /** 這次的代價：公帳的勢力好感 −steps、敵對值 +steps（over 每滿 over_step 一次） */
  steps: number
  faction: string | null
  favor: number
  hostility: number
  quota_before: number
  quota_after: number
}

/** 拿錢的預覽：會扣哪個勢力多少好感、加多少敵對值、額度剩多少。實際拿的（withdraw）算出來的和它一樣。 */
export function withdrawPreview(k: Pick<Kernel, 'content' | 'activity'>, state: GameState, input: WithdrawInput): WithdrawPreview {
  const ch = readChannel(state)
  const rules = channelRules(k)
  const fromOwn = input.pool === OWN
  const purse: Purse = fromOwn ? (input.purse ?? 'cred') : 'cred'
  const pool: Pool | undefined = fromOwn ? undefined : ch.budget.pools[input.pool]
  const have = fromOwn ? ch.budget.own[purse] : pool?.cred ?? 0
  const quota = fromOwn ? 0 : pool?.quota ?? 0
  const free = fromOwn ? 0 : Math.min(input.amount, quota)
  const over = fromOwn ? 0 : Math.max(0, input.amount - free)
  const steps = fromOwn ? 0 : Math.floor(over / rules.over_step)
  const out = (block: string | null): WithdrawPreview => ({
    ok: block === null, block, pool: input.pool, purse, amount: input.amount, free, over, steps, faction: fromOwn ? null : input.pool,
    favor: -steps, hostility: steps, quota_before: quota, quota_after: quota - free,
  })
  if (!ch.open) return out('還沒有頻道，沒有預算可以拿。')
  if (!isSafeInt(input.amount) || input.amount < 1) return out('要拿的錢要是 1 以上的整數。')
  if (input.purse !== undefined && input.purse !== 'cred' && input.purse !== 'cash') return out('要選拿帳戶或現金。')
  if (!fromOwn && input.purse === 'cash') return out(`${nameOf(k, input.pool)}的公帳只有帳戶，拿不了現金。`)
  if (!fromOwn && !isText(input.pool)) return out('要指定從自有資金或哪一個勢力的公帳拿。')
  if (have < input.amount) return out(`${fromOwn ? `自有資金的${PURSE_NAME[purse]}` : `${nameOf(k, input.pool)}的公帳`}只有 ${money(have)}，拿不了 ${money(input.amount)}。`)
  return out(k.activity.blockOf(state, `commit:${WITHDRAW_ACTION}`))
}

/**
 * 把預算拿出來（進主角的帳戶或現金）：自有資金沒有代價；公帳在那個勢力的可支領額度以內沒有代價並扣額度；超過額度的部分，
 * 每滿 over_step（預設 500），那個勢力好感 −1、敵對值 +1（量表有人定義才動）。
 */
export function withdraw(k: Pick<Kernel, 'content' | 'activity' | 'meters'>, state: GameState, input: WithdrawInput): ReportDraft {
  const p = withdrawPreview(k, state, input)
  if (!p.ok) throw new ActionBlocked(p.block!)
  const fromOwn = input.pool === OWN
  const who = nameOf(k, input.pool)
  const changes: Change[] = [
    fromOwn ? { op: 'channel.budget', pool: OWN, [p.purse]: -p.amount } : { op: 'channel.budget', pool: input.pool, cred: -p.amount, quota: -p.free },
    { op: p.purse, delta: p.amount },
  ]
  if (p.steps > 0) {
    if (k.meters.has('favor')) changes.push({ op: 'meter', kind: 'favor', key: input.pool, delta: -p.steps })
    if (k.meters.has('hostility')) changes.push({ op: 'meter', kind: 'hostility', key: input.pool, delta: p.steps })
  }
  const parts = [`你從${fromOwn ? `自有資金拿出 ${money(p.amount)} 的${PURSE_NAME[p.purse]}` : `${who}的公帳拿出 ${money(p.amount)}`}。`]
  if (!fromOwn) {
    parts.push(p.over === 0 ? `都在可支領額度以內（額度剩 ${money(p.quota_after)}），沒有代價。` : `${money(p.free)} 在額度以內，其餘 ${money(p.over)} 超過了額度${p.steps > 0 ? `，${who}對你的好感 −${p.steps}、敵對值 +${p.steps}` : '，但還不到一個級距，沒有代價'}。`)
  }
  const text = parts.join('')
  return draftOf(state, WITHDRAW_ACTION, changes, 'ok', text, beatOf(state, WITHDRAW_ACTION, text, { pool: input.pool, purse: p.purse, amount: p.amount, free: p.free, over: p.over, steps: p.steps }))
}

// ---- 終止贊助 ----

/** 終止贊助的入口擋下的原因（成立是 null）。 */
export function endSponsorBlock(k: Pick<Kernel, 'activity'>, state: GameState, faction: string): string | null {
  const ch = readChannel(state)
  if (!ch.open) return '還沒有頻道。'
  if (!ch.sponsors.some((s) => s.faction === faction)) return '這個勢力沒有在贊助你的頻道。'
  return k.activity.blockOf(state, `commit:${SPONSOR_END_ACTION}`)
}

/** 終止一份贊助：那個勢力在公帳裡剩下的錢它收回，可支領額度歸零（MEDIA 4.2）。 */
export function endSponsor(k: Pick<Kernel, 'content' | 'activity'>, state: GameState, faction: string): ReportDraft {
  const block = endSponsorBlock(k, state, faction)
  if (block) throw new ActionBlocked(block)
  const pool = readChannel(state).budget.pools[faction] ?? { cred: 0, quota: 0 }
  const who = nameOf(k, faction)
  const changes: Change[] = [{ op: 'channel.sponsor_end', faction }]
  if (pool.cred > 0 || pool.quota > 0) changes.push({ op: 'channel.budget', pool: faction, cred: -pool.cred, quota: -pool.quota })
  const text = `你終止了${who}的贊助。${pool.cred > 0 ? `它把公帳裡剩下的 ${money(pool.cred)} 收了回去，` : ''}可支領額度歸零。`
  return draftOf(state, SPONSOR_END_ACTION, changes, 'ended', text, beatOf(state, SPONSOR_END_ACTION, text, { faction, reclaimed: pool.cred, quota: pool.quota }))
}

export { nameOf as poolName }
