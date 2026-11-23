// L6 功能 fixer 的入帳（M2-fixer-pay 的第二拍）：副本做完之後的報酬、中間人的抽成、出場費與分紅、信譽、一起去的人的忠誠與親密度；失敗只扣信譽。
// 規格：FIXER 第 2 節④（結算）與第 8 節；COMMISSIONS 6.5、第 8 節；NPC_SYSTEM 10.5 節（薪水與分紅）、10.4 節（忠誠）、7.3 節（一起出過委託）；
// UI 7.3 節（分帳那一條）；LIFE 1.1 節（兩種錢）；dev/adr/0016 第三節與 G16；dev/work/M2-fixer-pay.md。
//
// 誰拿什麼（每個人的錢只付一次）：
//   隊伍裡的人（state.party，不含主角）：有出場費（roster_fee > 0）的在入帳時從報酬裡付；拿分紅的（出場費 0）入帳時分一份。
//   輔助面請來的人：付錢請的，出場費在召集時就付了（預付，不再從報酬裡扣；拿分紅的照樣分一份）；借來的也是預付；
//     用人情與靠交情請來的不拿錢，也不佔分紅（人情一律不分）。
// 報酬 = 談好的數字 × 評價的加成（G16）；照付法給：現金全額、帳戶 85%、人情 70% 現金再加一個人情。
// 先扣中間人的抽成（算在到手的那一部分上：換成人情的那三成不抽），再付出場費（跟著報酬用同一種錢），剩下的在場拿分紅的人均分、主角多拿一份。
// 不夠付出場費時從主角身上同一種錢補；補不出來記成欠（一行結果，忠誠照沒付算）。
// 純函式：讀狀態、回傳數字或報告草稿；splitPreview 與入帳共用同一個 splitOf，所以數字一定一樣。

import type { Change, GameState, Kernel, ReportDraft } from '../../core'
import { clone, effectCtx, formatAmount } from '../../core'
import { fixerDraft as draft } from './board'
import { feeOf } from './hire'
import type { AuxEntry, FavorSize, HireWay, Job, PayKind, PayoutRecord, PendingEnd, Rating } from './model'
import { FAVOR_SIZE_NAME, PAY_NAME, RATING_KEYS, auxList, favorSizeOf, fixerRules, jobOf } from './model'

export type Wallet = 'cash' | 'cred'
export const WALLET_NAME: Record<Wallet, string> = { cash: '現金', cred: '帳戶' }

export interface SplitSegment {
  kind: 'cut' | 'fee' | 'share' | 'boss'
  /** 中間人（cut）或角色的 id；主角是 pc 的 id */
  who: string
  name: string
  wallet: Wallet
  /** 這一段說好的數字 */
  amount: number
  /** 出場費：從報酬裡付了多少、主角補了多少、記成欠多少（加起來是 amount） */
  paid?: number
  covered?: number
  debt?: number
  /** 分紅：占幾份 */
  shares?: number
}

/** 條外的人：預付的（付錢與借來的，錢在召集時付過了）與不拿錢的（用人情、靠交情）。 */
export interface SplitOutside {
  who: string
  name: string
  way: HireWay
  /** 召集時預付的現金（沒有是 0） */
  prepaid: number
}

export interface Split {
  job: string
  rating: Rating
  /** 評價對報酬的加成（比例） */
  bonus: number
  pay: PayKind
  /** 分帳用哪種錢 */
  wallet: Wallet
  /** 談好的報酬、乘上評價之後的報酬、照付法到手的數字 */
  base: number
  reward: number
  gross: number
  cut_rate: number
  cut: number
  /** 分帳條的每一段，照順序：抽成、出場費、拿分紅的人、主角 */
  segments: SplitSegment[]
  /** 抽成與出場費之後剩的，拿分紅的人與主角均分 */
  pool: number
  /** 分成幾份（拿分紅的人數 ＋ 主角的份數） */
  shares: number
  /** 主角實拿：他的分紅，扣掉補出場費的錢 */
  pc_net: number
  /** 主角補的出場費、記成欠的出場費 */
  covered: number
  debt: number
  prepaid: SplitOutside[]
  outside: SplitOutside[]
  /** 換人情：多一個人情，記在中間人名下 */
  favor: { who: string; size: FavorSize } | null
  /** 匯進帳戶：目標勢力的敵對值（只加一次） */
  hostility: { faction: string; amount: number } | null
  /** 一起去的人（隊伍與輔助面，不含借來的）：親密度加；錢照說好的付了的人：忠誠加 */
  went: string[]
  paid_people: string[]
  /** 分帳那一條下面的兩行：先扣什麼、剩多少均分、你實拿多少 */
  lines: string[]
}

const ratingOf = (v: unknown): Rating => ((RATING_KEYS as readonly unknown[]).includes(v) ? (v as Rating) : 'B')
const nameOf = (state: Pick<GameState, 'actors'>, id: string): string => (Object.hasOwn(state.actors, id) ? state.actors[id]!.name : id)
const pct = (r: number): string => `${r >= 0 ? '+' : '−'}${Math.round(Math.abs(r) * 100)}%`

/** 目標勢力（沒有目標勢力是 null）。 */
function targetFaction(job: Pick<Job, 'commission'>): string | null {
  const t = job.commission.target_faction
  return typeof t === 'string' && t.trim() && t !== 'none' ? t : null
}

/** 這一趟照 rating 算出來的分帳：入帳與 splitPreview 共用。 */
export function splitOf(k: Kernel, state: GameState, job: Job, rating: Rating = 'B'): Split {
  const rules = fixerRules(k)
  const bonus = rules.rating_bonus[rating] ?? 0
  const base = job.terms.reward
  const reward = Math.max(0, Math.round(base * (1 + bonus)))
  const pay = job.terms.pay
  const wallet: Wallet = pay === 'cred' ? 'cred' : 'cash'
  const gross = Math.round(reward * (pay === 'cred' ? rules.pay_cred : pay === 'favor' ? rules.pay_favor : 1))
  const cutRate = Math.min(1, Math.max(0, job.terms.cut))
  const cut = Math.round(gross * cutRate)
  const fixerName = String(k.content.get('fixer', job.fixer)?.name ?? nameOf(state, job.npc))

  // 誰在場拿錢
  const members = state.party.filter((id) => id !== state.pc && Object.hasOwn(state.actors, id))
  const feeFolks: Array<{ id: string; fee: number }> = []
  const shareFolks: string[] = []
  for (const id of members) {
    const fee = feeOf(k, state, id)
    if (fee > 0) feeFolks.push({ id, fee })
    else shareFolks.push(id)
  }
  const prepaid: SplitOutside[] = []
  const outside: SplitOutside[] = []
  const went = [...members]
  const paidPeople: string[] = []
  for (const e of auxList(job)) {
    if (!Object.hasOwn(state.actors, e.actor)) continue
    const row: SplitOutside = { who: e.actor, name: nameOf(state, e.actor), way: e.way, prepaid: e.cost.cash ?? 0 }
    if (e.way === 'pay' && row.prepaid === 0) shareFolks.push(e.actor)
    else if (e.way === 'pay' || e.way === 'borrow') prepaid.push(row)
    else outside.push(row)
    if (e.way !== 'borrow') {
      went.push(e.actor)
      if (e.way === 'pay') paidPeople.push(e.actor)
    }
  }

  // 抽成之後先付出場費：報酬裡的先付，不夠的從主角身上同一種錢補，補不出來記成欠
  let remPool = Math.max(0, gross - cut)
  let remCover = state.money[wallet]
  const feeSegs: SplitSegment[] = []
  let covered = 0
  let debt = 0
  for (const f of feeFolks) {
    const paid = Math.min(f.fee, remPool)
    remPool -= paid
    const short = f.fee - paid
    const cover = Math.min(short, remCover)
    remCover -= cover
    const owed = short - cover
    covered += cover
    debt += owed
    feeSegs.push({ kind: 'fee', who: f.id, name: nameOf(state, f.id), wallet, amount: f.fee, paid, covered: cover, debt: owed })
    if (owed === 0) paidPeople.push(f.id)
  }
  const pool = remPool
  const shares = shareFolks.length + rules.boss_shares
  const per = Math.floor(pool / shares)
  const partnerTotal = per * shareFolks.length
  const boss = pool - partnerTotal
  for (const id of shareFolks) paidPeople.push(id)

  const segments: SplitSegment[] = [
    { kind: 'cut', who: job.fixer, name: fixerName, wallet, amount: cut },
    ...feeSegs,
    ...shareFolks.map((id): SplitSegment => ({ kind: 'share', who: id, name: nameOf(state, id), wallet, amount: per, shares: 1 })),
    { kind: 'boss', who: state.pc ?? 'pc', name: state.pc ? nameOf(state, state.pc) : '你', wallet, amount: boss, shares: rules.boss_shares },
  ]

  const faction = targetFaction(job)
  const hostility = pay === 'cred' && faction !== null && rules.hostility_cred > 0 && k.effects.has('hostility') ? { faction, amount: rules.hostility_cred } : null
  const favor = pay === 'favor' && k.effects.has('owed_to_pc') ? { who: job.npc, size: favorSizeOf(job.commission) } : null

  const feeTotal = feeFolks.reduce((s, f) => s + f.fee, 0)
  const wn = WALLET_NAME[wallet]
  const lines = [
    `報酬 ${formatAmount(reward)}（談好的 ${formatAmount(base)}，評價 ${rating}${bonus !== 0 ? ` ${pct(bonus)}` : ''}），${PAY_NAME[pay]}：到手 ${formatAmount(gross)} ${wn}${favor ? `，另外多一個${FAVOR_SIZE_NAME[favor.size]}人情` : ''}。`,
    `先扣中間人抽成 ${formatAmount(cut)}${feeTotal > 0 ? `、出場費 ${formatAmount(feeTotal)}` : ''}，剩 ${formatAmount(pool)} 由 ${shares} 份均分（你 ${rules.boss_shares} 份），你實拿 ${formatAmount(boss - covered)} ${wn}${covered > 0 ? `（其中 ${formatAmount(covered)} 是替報酬不夠的出場費補的）` : ''}。`,
  ]
  return {
    job: job.id, rating, bonus, pay, wallet, base, reward, gross, cut_rate: cutRate, cut, segments, pool, shares, pc_net: boss - covered, covered, debt,
    prepaid, outside, favor, hostility, went, paid_people: [...new Set(paidPeople)], lines,
  }
}

/** 分帳那一條（UI 7.3 節）：每一段是誰、多少、哪一種錢；預設照評價 B 算。 */
export function splitPreview(k: Kernel, state: GameState, job: Job, rating: Rating = 'B'): Split {
  return splitOf(k, state, job, rating)
}

// ---- 入帳 ----

/** 這個效果有人註冊才給；格式不合（例如查不到那個人）就略過，不讓一個效果擋住整份入帳。 */
function effectChanges(k: Kernel, state: GameState, eff: Record<string, unknown> & { kind: string }): { changes: Change[]; lines: string[] } {
  if (!k.effects.has(eff.kind)) return { changes: [], lines: [] }
  const res = k.effects.resolve([eff], effectCtx(k, state, { source: 'builtin' }))
  return res.errors.length > 0 ? { changes: [], lines: [] } : { changes: res.changes, lines: res.lines }
}

/** 做完（done）之後把請的人放掉：身上的 busy 拿掉，借來的臨時角色移除。 */
function releaseChanges(state: GameState, entries: readonly AuxEntry[]): Change[] {
  const out: Change[] = []
  for (const e of entries) {
    const a = Object.hasOwn(state.actors, e.actor) ? state.actors[e.actor] : undefined
    if (!a) continue
    if (e.way === 'borrow') out.push({ op: 'actor.remove', id: e.actor })
    else if (a.conditions.some((c) => c.id === 'busy')) out.push({ op: 'actor.condition', id: e.actor, condition: 'busy', remove: true })
  }
  return out
}

/**
 * 副本交回來（activity.end 記下了 pending）之後的入帳（報告 fixer.payout）。
 * done：報酬照付法入帳、抽成與出場費與分紅、信譽 +2、一起去的人親密度 +2、錢照說好的付了的人忠誠 +2、請來的人放掉。
 * failed：沒有報酬、信譽 −3、請來的人放掉；已經付的出場費不退。
 * 手上已經沒有這件委託時只把等著的事清掉。
 */
export function payoutDraft(k: Kernel, state: GameState, pend: PendingEnd): ReportDraft {
  const job = jobOf(state, pend.job)
  if (!job) return draft(state, 'fixer.payout', 'cleared', '手上已經沒有這件委託了。', [{ op: 'fixer.settle', job: pend.job }])
  const rules = fixerRules(k)
  const entries = auxList(job)
  const changes: Change[] = []
  const lines: string[] = []

  if (pend.outcome === 'failed') {
    const rep = effectChanges(k, state, { kind: 'rep', amount: rules.rep_fail })
    changes.push(...rep.changes)
    lines.push(`「${job.title}」失敗了：沒有報酬。`, ...rep.lines)
    if (entries.some((e) => (e.cost.cash ?? 0) > 0)) lines.push('已經付出去的出場費不退。')
    changes.push(...releaseChanges(state, entries))
    const record: PayoutRecord = { outcome: 'failed', rating: null, reward: 0, wallet: 'cash', gross: 0, cut: 0, pool: 0, pc_net: 0, debt: 0 }
    changes.push({ op: 'fixer.settle', job: job.id, payout: record })
    return draft(state, 'fixer.payout', 'failed', `「${job.title}」失敗了，沒有報酬。`, changes, { narration: { results: lines } })
  }

  const s = splitOf(k, state, job, ratingOf(pend.rating))
  if (s.pc_net !== 0) changes.push({ op: s.wallet, delta: s.pc_net })
  lines.push(...s.lines)
  if (s.favor) {
    const e = effectChanges(k, state, { kind: 'owed_to_pc', who: s.favor.who, size: s.favor.size })
    changes.push(...e.changes)
    lines.push(...e.lines)
  }
  if (s.hostility) {
    const e = effectChanges(k, state, { kind: 'hostility', key: s.hostility.faction, amount: s.hostility.amount })
    changes.push(...e.changes)
    lines.push(...e.lines)
  }
  for (const f of s.segments.filter((x) => x.kind === 'fee' && (x.debt ?? 0) > 0)) lines.push(`${f.name}的出場費還欠 ${formatAmount(f.debt!)}（報酬不夠，你身上也補不出來），這一筆記成欠；忠誠照沒付算。`)
  const rep = effectChanges(k, state, { kind: 'rep', amount: rules.rep_done })
  changes.push(...rep.changes)
  lines.push(...rep.lines)
  // 一起去的人：親密度；錢照說好的付了的人：忠誠（借來的臨時角色等一下就移除，不算）
  for (const id of s.went) {
    const e = effectChanges(k, state, { kind: 'affinity', key: id, amount: rules.trip_affinity })
    changes.push(...e.changes)
  }
  for (const id of s.paid_people) {
    const e = effectChanges(k, state, { kind: 'loyalty', key: id, amount: rules.trip_loyalty })
    changes.push(...e.changes)
  }
  if (s.went.length > 0) lines.push(`一起去的人親密度 +${rules.trip_affinity}。`)
  changes.push(...releaseChanges(state, entries))
  const record: PayoutRecord = { outcome: 'done', rating: s.rating, reward: s.reward, wallet: s.wallet, gross: s.gross, cut: s.cut, pool: s.pool, pc_net: s.pc_net, debt: s.debt }
  changes.push({ op: 'fixer.settle', job: job.id, payout: record })
  return draft(state, 'fixer.payout', 'paid', `「${job.title}」入帳：你實拿 ${formatAmount(s.pc_net)} ${WALLET_NAME[s.wallet]}。`, changes, {
    timeline: [{ layer: 'meat', tag: 'fixer.payout', text: s.lines.join(' '), data: { split: clone(s) as unknown as Record<string, unknown> } }],
    narration: { results: lines },
  })
}
