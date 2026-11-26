// L6 auction 的進場與競價（LEWD_SYSTEM 6.2 節「競價的回合」「成交」；dev/adr/0019 第十八節與 P78～P80、P82、P83；dev/work/M4-auction-bid.md）。
//
// 一場拍賣是活動 auction：進場把目錄與競標者抄進 state.ext.auction.run（形狀見 Run），之後一份報告一個回合：
//   玩家先動（加價 raise／等 wait／退出 fold），還在場的 NPC 照 bidders 的順序各決定一次（預算、興趣、緊接的前一手剛被人加價；一次只加一階；使用者 2026-11-26），
//   一整回合沒有人加價 quiet 加 1（1 是倒數一次、2 落槌），最多 rounds_max 回合；落槌時沒人持有就流標。
// 玩家退出之後這一件由程式照同一套規則在同一份報告裡算到落槌；全部落槌（或離場）時發 activity.end、時間推到時段結束（至少從進場算起 min_minutes）。
// NPC 的亂數用 deriveRng（游標固定 0，鍵：auction、拍賣行、場次、第幾件、第幾回合，第幾位當重擲次數）：不動存檔亂數的游標，同一個選擇重來結果一樣。
// 讀別人的（不 import）：核心的 productOf／partOf／readProduct；內容種類 quirk（pool 含 flaw）；登錄表的效果 contract_hold、hostility（查不到略過；hostility 沒有效果時退而求其次直接改量表）。
//
// 玩家付的錢：得標當場扣（現價加佣金），所以「價錢＋佣金＋這一場已經花掉的 ≤ 進場時身上的錢」等於「價錢＋佣金 ≤ 現在身上的錢」。
// 交不出去（M4 收尾修正批；LEWD_SYSTEM 6.2 節）：玩家標到契約或機密，落槌時先試跑要給的效果（give.ts）；交不出去就不收錢，改由出價第二高的 NPC 得標（沒有人就流標），結果寫「這一件撤拍」。
// 自動跟價（同上；LEWD_SYSTEM 6.2 節第 6 點）：玩家替這一件設一個上限（LotRun.auto），之後每一回合替玩家按——別人加價而再加一階不超過上限（而且付得起）就跟、超過就退出、自己已經最高就等。
//   一份報告一個回合，和手動一樣（所以中途隨時可以取消）：bidDraft { auto: { max } } 設上限並走這一回合、{ act: 'auto_next' } 照著上限再走一回合、{ act: 'auto_off' } 取消（改回手動）；
//   手動加價、等、退出、這一件落槌或退出之後，上限自動拿掉（只管當下這一件）。
// 進行中的放行只有 auction.bid、auction.leave、auction.close（index.ts）。
// 離場時玩家若正是這一件最高的出價人：出價不能收回，這一件照樣算到落槌（沒人加價就是玩家得標、照付）；之後的拍品玩家都不喊。

import type { ActivityEndMerged, Change, GameState, Kernel, ProductData, Report, ReportDraft, ReportTrigger, TimelineBeat } from '../../core'
import {
  ActionBlocked, attachActivityEnd, clone, deriveRng, effectCtx, endActivity, formatAmount, formatTime, fromMinutes, isRecord, isSafeInt, partOf, productOf, toMinutes,
} from '../../core'
import type { CatalogLot } from './catalog'
import { giveEffects, undeliverable } from './give'
import { LOOK_TEXT, catalogOf } from './catalog'
import type { AuctionRules, LotKind } from './model'
import { ACTIVITY, BID_ACTION, CLOSE_ACTION, DONE_POINT, ENTER_ACTION, LEAVE_ACTION, PATCH_OP, auctionOf, auctionRules, houseOf, isText, kindName } from './model'
import { memberOf } from './member'
import { housesHere, sessionAt, sessionOf } from './session'

// ---- 狀態：state.ext.auction.run ----

export const PAYS = ['cash', 'cred'] as const
export type AuctionPay = (typeof PAYS)[number]
export const PAY_NAME: Record<AuctionPay, string> = { cash: '現金晶片', cred: '帳戶' }
/** 玩家在 holder 與 log 裡的名字。 */
export const PC = 'pc'
export type Holder = string | null

export interface LotRun {
  /** 第幾件（0 起算） */
  lot: number
  /** 拍品的 id（內容的一筆）與看貨結果的鍵 */
  id: string
  key: string
  kind: LotKind
  name: string
  desc?: string
  cert: string
  market: number
  reserve: number
  step: number
  /** 仿品（不外露；寫在狀態裡給引擎算） */
  fake: boolean
  part?: string
  blueprint?: string
  item?: string
  npc?: string
  contract?: Record<string, unknown>
  effects?: Array<Record<string, unknown>>
  once: boolean
  /** 現價；一開始是底價 */
  price: number
  /** 現在最高的人：'pc'、競標者的 id，或 null（沒有人出過價） */
  holder: Holder
  /** 已經喊完幾回合 */
  round: number
  /** 連續幾回合沒有人加價 */
  quiet: number
  /** 退出這一件的競標者 */
  out: string[]
  pc_out: boolean
  /** 自動跟價的上限（價錢，不含佣金）；沒設是沒有這一格。只管這一件：手動喊、取消、落槌、退出都拿掉 */
  auto?: number
  /** 每個人（'pc'、競標者的 id）出過的最高價（交不出去時找出價第二高的 NPC 用；舊存檔沒有） */
  bids?: Record<string, number>
  state: 'open' | 'sold' | 'passed'
}

export interface RunBidder {
  id: string
  name: string
  npc?: string
  interests: LotKind[]
  mult: number
}

export interface Won { lot: number; price: number; fee: number }
export interface LogEntry { lot: number; winner: Holder; price: number; rounds: number; withdrawn?: string }

export interface Run {
  house: string
  /** 場次（開槌日的天數） */
  session: number
  pay: AuctionPay
  /** 進場的時間與這一場結束的時間（分鐘） */
  entered: number
  end: number
  lots: LotRun[]
  bidders: RunBidder[]
  /** 現在第幾件（0 起算） */
  at: number
  /** 這一場已經付掉的（價錢加佣金） */
  spent: number
  won: Won[]
  log: LogEntry[]
}

/** 讀進行中的一場；沒有或壞掉是 null。回傳的是複本。 */
export function readRun(state: Pick<GameState, 'ext'>): Run | null {
  const raw = auctionOf(state).run
  if (!raw || !isText(raw.house) || !isSafeInt(raw.session) || !(PAYS as readonly unknown[]).includes(raw.pay)) return null
  if (!Array.isArray(raw.lots) || !Array.isArray(raw.bidders) || !raw.lots.every(isRecord) || !raw.bidders.every(isRecord)) return null
  if (!isSafeInt(raw.at) || !isSafeInt(raw.spent) || !isSafeInt(raw.entered) || !isSafeInt(raw.end)) return null
  return clone(raw) as unknown as Run
}

const lotOf = (run: Run): LotRun | undefined => run.lots[run.at]
const feeOf = (rules: Pick<AuctionRules, 'fee_pct'>, price: number): number => Math.round(price * rules.fee_pct)
const nameOfBidder = (run: Run, who: string): string => (who === PC ? '你' : run.bidders.find((b) => b.id === who)?.name ?? who)
const CN = ['零', '一', '二', '三', '四', '五', '六', '七', '八', '九', '十']
const pct = (n: number): string => (Math.abs(n * 10 - Math.round(n * 10)) < 1e-9 ? `${CN[Math.round(n * 10)] ?? String(Math.round(n * 10))}成` : `${Math.round(n * 1000) / 10}%`)

// ---- 進場 ----

export interface EnterInput {
  house?: string
  pay?: string
}

/** 現在進不了場的原因（一條一個條件）；進得了是空的。 */
export function enterBlocks(k: Kernel, state: GameState, houseId: string): string[] {
  const house = houseOf(k, houseId)
  if (!house) return ['沒有這一家拍賣行。']
  const p: string[] = []
  if (readRun(state)) p.push('你已經在拍賣廳裡了。')
  else {
    const act = k.activity.blockOf(state, `commit:${ENTER_ACTION}`)
    if (act) p.push(act)
  }
  if (!state.pc) p.push('還沒有主角。')
  if (!housesHere(k, state).some((h) => h.id === houseId)) p.push(`要站在${house.name}裡才進得了場。`)
  const m = memberOf(k, state, houseId)
  if (!m.member) p.push(...m.blocks)
  const now = toMinutes(state.time)
  const done = auctionOf(state).done[houseId]
  const doneSession = done !== undefined ? sessionAt(k, house, done) : null
  if (doneSession && now >= doneSession.start && now < doneSession.end) p.push(`這一場${house.name}你已經進過了，下一場再來。`)
  else {
    const s = sessionOf(k, state, houseId)
    if (!s) p.push(`${house.name}近期沒有開槌。`)
    else if (now < s.start) p.push(`${house.name}的這一場要到${formatTime(fromMinutes(s.start))}才開槌。`)
    else if (now >= s.end) p.push(`${house.name}的這一場已經結束了。`)
    else if ((catalogOf(k, state, houseId)?.lots.length ?? 0) === 0) p.push('這一場沒有任何拍品。')
  }
  return [...new Set(p)]
}

/** 進場：報告 auction.enter。pay 是這一場整場用哪一種錢付（cash 或 cred）。 */
export function enterDraft(k: Kernel, state: GameState, input: EnterInput): ReportDraft {
  const house = isText(input.house) ? houseOf(k, input.house) : undefined
  if (!house) throw new ActionBlocked('要指定哪一家拍賣行。')
  if (!(PAYS as readonly unknown[]).includes(input.pay)) throw new ActionBlocked('要選這一場用現金晶片還是帳戶付款。')
  const blocks = enterBlocks(k, state, house.id)
  if (blocks.length > 0) throw new ActionBlocked(blocks.join(''))
  const pay = input.pay as AuctionPay
  const c = catalogOf(k, state, house.id)!
  const run: Run = {
    house: house.id, session: c.session.day, pay, entered: toMinutes(state.time), end: c.session.end,
    lots: c.lots.map((l): LotRun => lotRunOf(l)),
    bidders: c.bidders.map((b) => ({ id: b.id, name: b.name, ...(b.npc !== undefined ? { npc: b.npc } : {}), interests: [...b.interests], mult: b.mult })),
    at: 0, spent: 0, won: [], log: [],
  }
  const first = run.lots[0]!
  const lines = [
    `你進了${house.name}的會場，這一場用${PAY_NAME[pay]}付款。武器寄存在門口；會場掃了義體，沒有登記。`,
    announce(state, first),
  ]
  const beats: TimelineBeat[] = lines.map((text) => beat(state, text, ENTER_ACTION, { house: house.id, session: run.session, pay }))
  return {
    kind: 'action', action: ENTER_ACTION, location: clone(state.location), ...(state.pc ? { actor: state.pc } : {}), party: [], timeline: beats,
    changes: [{ op: PATCH_OP, run: run as unknown as Record<string, unknown> }],
    outcome: { result: 'entered', summary: lines.join('') }, narration: { results: lines.slice(0, 1) },
  }
}

function lotRunOf(l: CatalogLot): LotRun {
  return {
    lot: l.index, id: l.id, key: l.key, kind: l.kind, name: l.name, ...(l.desc !== undefined ? { desc: l.desc } : {}), cert: l.cert,
    market: l.market, reserve: l.reserve, step: l.step, fake: l.fake,
    ...(l.part !== undefined ? { part: l.part } : {}), ...(l.blueprint !== undefined ? { blueprint: l.blueprint } : {}), ...(l.item !== undefined ? { item: l.item } : {}),
    ...(l.npc !== undefined ? { npc: l.npc } : {}), ...(l.contract !== undefined ? { contract: clone(l.contract) } : {}), ...(l.effects !== undefined ? { effects: clone(l.effects) } : {}),
    once: l.once, price: l.reserve, holder: null, round: 0, quiet: 0, out: [], pc_out: false, bids: {}, state: 'open',
  }
}

const beat = (state: GameState, text: string, tag: string, data?: Record<string, unknown>, actor = false): TimelineBeat => ({
  layer: 'meat', ...(actor && state.pc ? { actor: state.pc } : {}), text, tag, ...(data ? { data } : {}),
})

/** 主持人報現價（程式的句子；P84：這一批不叫 AI）。 */
function announce(state: GameState, lot: LotRun): string {
  return `主持人：第 ${lot.lot + 1} 件，${kindName(lot.kind, state)}「${lot.name}」，${lot.cert}底價 ${formatAmount(lot.reserve)}，一階 ${formatAmount(lot.step)}。`
}

// ---- 一回合 ----

/** 玩家自己出的一手：加價、等、退出。 */
export type Move = { act: 'raise'; steps: number } | { act: 'wait' } | { act: 'fold' }
/** auto：設上限並走這一回合；auto_next：照已經設的上限再走一回合；auto_off：取消自動跟價（不走回合）。 */
export type BidInput = Move | { act: 'auto'; max: number } | { act: 'auto_next' } | { act: 'auto_off' }
/** 自動跟價的簡寫：bidDraft 與 bidBlock 收 { auto: { max } }（max 是願意出到的價錢，不含佣金）。 */
export type AutoInput = { auto: { max: number } }
type Plan = BidInput | { act: 'leave' }

const planOf = (input: BidInput | AutoInput): BidInput => ('auto' in input ? { act: 'auto', max: input.auto.max } : input)

export interface BidOption {
  act: 'raise' | 'wait' | 'fold' | 'auto' | 'auto_next' | 'auto_off'
  /** 加價才有：加幾階、加完的現價、佣金、價錢加佣金 */
  steps?: number
  price?: number
  fee?: number
  total?: number
  can: boolean
  /** 現在不能的原因（一條一個條件）；能是空的 */
  blocks: string[]
}

export interface BidOptions {
  raise: BidOption[]
  wait: BidOption
  fold: BidOption
  /** 自動跟價（要給上限 max）：能不能用、最低要給多少（現價再加一階才有意義）；current 是這一件現在設著的上限（沒設是 null） */
  auto: BidOption & { min: number; current: number | null }
  /** 照設著的上限再走一回合（沒設不能用） */
  auto_next: BidOption
  /** 取消自動跟價，改回手動（沒設不能用；不走回合） */
  auto_off: BidOption
}

function blocksOf(k: Kernel, state: GameState, run: Run, rules: AuctionRules, input: BidInput): string[] {
  const p: string[] = []
  const act = k.activity.blockOf(state, `commit:${BID_ACTION}`)
  if (act) p.push(act)
  const lot = lotOf(run)
  if (!lot) return [...p, '這一場已經喊完了。']
  if (lot.pc_out) p.push('這一件你已經退出了，不能再喊。')
  if (input.act === 'raise') {
    if (!(isSafeInt(input.steps) && input.steps >= 1 && input.steps <= rules.raise_max)) p.push(`一次只能加 1～${rules.raise_max} 階。`)
    else {
      if (lot.holder === PC) p.push('你已經是最高的出價人，這一回合只能等。')
      const price = lot.price + input.steps * lot.step
      if (price + feeOf(rules, price) > state.money[run.pay]) p.push(`付不起這個價（含${pct(rules.fee_pct)}佣金）。`)
    }
  } else if (input.act === 'wait') {
    if (lot.holder !== PC) p.push('你不是目前最高的出價人，只能加價或退出。')
  } else if (input.act === 'fold') {
    if (lot.holder === PC) p.push('你是目前最高的出價人，不能退出；只能等。')
  } else if (input.act === 'auto') {
    if (!(isSafeInt(input.max) && input.max > 0)) p.push('自動跟價要給一個大於 0 的上限。')
  } else if (input.act === 'auto_next') {
    if (lot.auto === undefined) p.push('這一件沒有設自動跟價。')
  } else if (input.act === 'auto_off') {
    if (lot.auto === undefined) p.push('這一件沒有設自動跟價，不用取消。')
  } else p.push('不認得這個動作：要加價、等、退出或自動跟價。')
  return [...new Set(p)]
}

/** 現在每一種動作能不能做、原因，與每一種加價之後的價錢與含佣金的總數。不改狀態；沒有進行中的拍賣是 null。 */
export function bidOptions(k: Kernel, state: GameState): BidOptions | null {
  const run = readRun(state)
  if (!run) return null
  const rules = auctionRules(k)
  const lot = lotOf(run)
  const one = (input: BidInput): BidOption => {
    const blocks = blocksOf(k, state, run, rules, input)
    return { act: input.act, can: blocks.length === 0, blocks }
  }
  return {
    raise: Array.from({ length: rules.raise_max }, (_, i): BidOption => {
      const steps = i + 1
      const price = (lot?.price ?? 0) + steps * (lot?.step ?? 0)
      const fee = feeOf(rules, price)
      return { ...one({ act: 'raise', steps }), steps, price, fee, total: price + fee }
    }),
    wait: one({ act: 'wait' }),
    fold: one({ act: 'fold' }),
    auto: { ...one({ act: 'auto', max: (lot?.price ?? 0) + (lot?.step ?? 0) }), min: (lot?.price ?? 0) + (lot?.step ?? 0), current: lot?.auto ?? null },
    auto_next: one({ act: 'auto_next' }),
    auto_off: one({ act: 'auto_off' }),
  }
}

/** 現在這個動作做不成的原因（接起來的一句）；成立是 null。 */
export function bidBlock(k: Kernel, state: GameState, input: BidInput | AutoInput): string | null {
  const run = readRun(state)
  if (!run) return '現在不在拍賣廳裡。'
  const p = blocksOf(k, state, run, auctionRules(k), planOf(input))
  return p.length > 0 ? p.join('') : null
}

export interface ActRecord {
  who: string
  name: string
  act: 'raise' | 'wait' | 'fold' | 'out' | 'hold' | 'pass'
  steps?: number
  /** 這個動作之後的現價 */
  price: number
}

export interface Hammer {
  lot: number
  name: string
  result: 'sold' | 'passed'
  winner: Holder
  winner_name: string | null
  price: number
  rounds: number
  /** 玩家標到了，但這一件交不出去（不收錢；改由出價第二高的 NPC 得標，沒有就流標）：原因是給玩家看的一句話 */
  withdrawn?: string
}

export interface RoundLog {
  lot: number
  /** 這一回合是這一件的第幾回合 */
  round: number
  acts: ActRecord[]
  /** 連續沒有人加價的回合數：1 是倒數一次 */
  quiet: number
  countdown: boolean
  price: number
  holder: Holder
  hammer?: Hammer
}

/** 玩家（或沒有玩家）動完，NPC 照順序各決定一次；回合結束更新 quiet，到了該落槌的時候回傳 hammered。 */
function playRound(state: GameState, run: Run, rules: AuctionRules, lot: LotRun, pc: Move | null): { log: RoundLog; hammered: boolean } {
  lot.round += 1
  const acts: ActRecord[] = []
  let raised = false
  // 緊接的前一手是不是剛被人加價（LEWD_SYSTEM 6.2 節第 3 點：NPC 的加價機率 +10；使用者 2026-11-26：是緊接的前一手，不是這一回合裡任何一個更早的加價）
  let prevRaised = false
  const act = (who: string, a: ActRecord['act'], steps?: number): void => {
    acts.push({ who, name: nameOfBidder(run, who), act: a, ...(steps !== undefined ? { steps } : {}), price: lot.price })
    prevRaised = a === 'raise'
  }
  const bid = (who: string): void => void ((lot.bids ??= {})[who] = lot.price)
  if (pc?.act === 'raise') {
    lot.price += pc.steps * lot.step
    lot.holder = PC
    bid(PC)
    raised = true
    act(PC, 'raise', pc.steps)
  } else if (pc?.act === 'wait') act(PC, 'wait')
  else if (pc?.act === 'fold') {
    lot.pc_out = true
    act(PC, 'fold')
  }
  const purpose = `auction/${run.house}/${run.session}/${lot.lot}/${lot.round}`
  run.bidders.forEach((b, i) => {
    if (lot.out.includes(b.id)) return
    if (lot.holder === b.id) return void act(b.id, 'hold')
    if (lot.price + lot.step > lot.market * b.mult) {
      lot.out.push(b.id)
      return void act(b.id, 'out')
    }
    const base = b.interests.includes(lot.kind) ? rules.interest.yes : rules.interest.no
    const chance = Math.min(1, base + (prevRaised ? rules.interest.after_raise : 0))
    if (deriveRng({ seed: state.rng.seed, cursor: 0 }, purpose, i).chance(chance)) {
      lot.price += lot.step
      lot.holder = b.id
      bid(b.id)
      raised = true
      act(b.id, 'raise', 1)
    } else act(b.id, 'pass')
  })
  lot.quiet = raised ? 0 : lot.quiet + 1
  const hammered = lot.quiet >= 2 || lot.round >= rules.rounds_max
  return { log: { lot: lot.lot, round: lot.round, acts, quiet: lot.quiet, countdown: lot.quiet === 1, price: lot.price, holder: lot.holder }, hammered }
}

// ---- 落槌與成交 ----

interface Settled {
  changes: Change[]
  /** 給畫面與結果看的句子（帶數字） */
  lines: string[]
  /** 給 AI 寫正文用的句子（不帶機制數字） */
  plain: string[]
  hammer: Hammer
}

function runEffects(k: Kernel, work: GameState, effects: Array<Record<string, unknown>>): { changes: Change[]; lines: string[] } {
  const r = k.effects.resolve(effects, effectCtx(k, work, { source: 'builtin' }))
  return r.errors.length > 0 ? { changes: [], lines: [] } : { changes: r.changes, lines: r.lines }
}

/** 用帳戶買違禁品或契約：cred_dirty.factions 的每個勢力敵對值加 amount（清單是空的什麼都不做；有 hostility 效果用效果，沒有就直接改量表，兩個都沒有略過）。 */
function dirtyChanges(k: Kernel, work: GameState, rules: AuctionRules): Change[] {
  const { amount, factions } = rules.cred_dirty
  if (amount === 0 || factions.length === 0) return []
  if (k.effects.has('hostility')) return runEffects(k, work, factions.map((key) => ({ kind: 'hostility', key, amount }))).changes
  if (k.meters.has('hostility')) return factions.map((key): Change => ({ op: 'meter', kind: 'hostility', key, delta: amount }))
  return []
}

/** 瑕疵：quirk 裡 pool 含 flaw、適用這一種設計圖的，照這一件抽一個（查不到就沒有）。 */
function flawOf(k: Kernel, state: GameState, run: Run, lot: LotRun, bpKind: unknown): string | undefined {
  if (!k.content.hasKind('quirk')) return undefined
  const pool = k.content.list('quirk')
    .filter((q) => Array.isArray(q.pool) && (q.pool as unknown[]).includes('flaw') && (q.applies === undefined || (Array.isArray(q.applies) && (q.applies as unknown[]).includes(bpKind))))
    .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
  if (pool.length === 0) return undefined
  return deriveRng({ seed: state.rng.seed, cursor: 0 }, `auction/${run.house}/${run.session}/flaw/${lot.lot}`).pick(pool).id
}

/** 玩家得標、當場取貨。work 是套到這一件之前的狀態（連續得標時 uid 的流水號才對）。 */
function deliver(k: Kernel, work: GameState, run: Run, lot: LotRun): { changes: Change[]; lines: string[]; plain: string[]; banned: boolean } {
  const houseName = houseOf(k, run.house)?.name ?? run.house
  const changes: Change[] = []
  const lines: string[] = []
  const plain: string[] = []
  const looked = auctionOf(work).looked[lot.key]
  let banned = false
  const surprise = (): void => {
    if (!lot.fake || looked === 'fake') return
    lines.push('拿到手才發現這一件是仿品。')
    plain.push('拿到手才發現這一件是仿品。')
  }
  if (lot.kind === 'part' && lot.part !== undefined) {
    banned = partOf(k.content, lot.part)?.legal === 'banned'
    if (lot.fake) {
      changes.push({ op: 'item', id: lot.part, qty: 1, data: { state: 'used', uid: `us${work.seq.uid + 1}` } }, { op: 'uid', advance: 1 })
      surprise()
    } else changes.push({ op: 'item', id: lot.part, qty: 1 })
  } else if (lot.kind === 'cyberware' && lot.blueprint !== undefined) {
    const bp = k.content.get('blueprint', lot.blueprint)
    const data: ProductData = { uid: `pr${work.seq.uid + 1}`, parts: clone((bp?.stock ?? {}) as ProductData['parts']), quality: 'standard', state: 'new' }
    if (lot.fake) {
      data.state = 'used'
      data.quality = 'flawed'
      const q = flawOf(k, work, run, lot, bp?.kind)
      if (q !== undefined) data.quirks = [q]
    }
    banned = productOf(k.content, lot.blueprint, data)?.legal === 'banned'
    changes.push({ op: 'item', id: lot.blueprint, qty: 1, data: data as unknown as Record<string, unknown> }, { op: 'uid', advance: 1 })
    if (lot.fake) surprise()
  } else if (lot.kind === 'contract') {
    banned = true
    const r = runEffects(k, work, giveEffects(lot, houseName))
    changes.push(...r.changes)
    lines.push(...r.lines.map((x) => `${x.replace(/。$/, '')}。`))
  } else {
    if (lot.item !== undefined) changes.push({ op: 'item', id: lot.item, qty: 1 })
    const fx = giveEffects(lot, houseName)
    if (fx.length > 0) {
      const r = runEffects(k, work, fx)
      changes.push(...r.changes)
      lines.push(...r.lines.map((x) => `${x.replace(/。$/, '')}。`))
    }
  }
  return { changes, lines, plain, banned }
}

/** 出價第二高的 NPC（玩家以外、出過價的人裡價最高的；同價的先在名單上的）。沒有人出過價是 null。 */
function secondBidder(run: Run, lot: LotRun): { id: string; price: number } | null {
  let best: { id: string; price: number } | null = null
  for (const b of run.bidders) {
    const price = lot.bids?.[b.id]
    if (price !== undefined && (best === null || price > best.price)) best = { id: b.id, price }
  }
  return best
}

/**
 * 落槌：這一件結清。玩家得標就先試跑要交的東西（契約與機密）：交不出去不收錢、改由出價第二高的 NPC 得標（沒有就流標），結果寫「這一件撤拍」；
 * 交得出去就付錢、取貨、算帳戶的紀錄；work 跟著套上去。once 的拍品不管被誰買走都記進 sold（世界上只有一件）。
 */
function settle(k: Kernel, work: GameState, run: Run, lot: LotRun, rules: AuctionRules, rounds: number): Settled {
  const houseName = houseOf(k, run.house)?.name ?? run.house
  let withdrawn: string | undefined
  if (lot.holder === PC && (lot.kind === 'contract' || lot.kind === 'secret')) {
    const why = undeliverable(k, work, lot, houseName)
    if (why !== null) {
      withdrawn = why
      const second = secondBidder(run, lot)
      lot.holder = second ? second.id : null
      if (second) lot.price = second.price
    }
  }
  const sold = lot.holder !== null
  lot.state = sold ? 'sold' : 'passed'
  run.log.push({ lot: lot.lot, winner: lot.holder, price: lot.price, rounds, ...(withdrawn !== undefined ? { withdrawn } : {}) })
  const winnerName = lot.holder === null ? null : nameOfBidder(run, lot.holder)
  const hammer: Hammer = { lot: lot.lot, name: lot.name, result: sold ? 'sold' : 'passed', winner: lot.holder, winner_name: winnerName, price: lot.price, rounds, ...(withdrawn !== undefined ? { withdrawn } : {}) }
  const changes: Change[] = []
  const lines: string[] = []
  const plain: string[] = []
  const markSold = (): void => {
    if (!lot.once) return
    const c: Change = { op: PATCH_OP, sold: [lot.id] }
    changes.push(c)
    k.changes.applyAll(work, [c])
  }
  if (withdrawn !== undefined) {
    lines.push(`第 ${lot.lot + 1} 件「${lot.name}」你標到了，可是${withdrawn.replace(/。$/, '')}：不收你的錢，這一件撤拍。${sold ? `館方改由${winnerName}以 ${formatAmount(lot.price)} 得標。` : '沒有別的人出過價，流標。'}`)
    plain.push(`「${lot.name}」交不出去，這一件撤拍了。`)
    if (sold) markSold()
    return { changes, lines, plain, hammer }
  }
  if (!sold) {
    lines.push(`第 ${lot.lot + 1} 件「${lot.name}」沒有人出價，流標。`)
    plain.push(`「${lot.name}」流標了。`)
    return { changes, lines, plain, hammer }
  }
  lines.push(`第 ${lot.lot + 1} 件「${lot.name}」落槌，由${winnerName}以 ${formatAmount(lot.price)} 得標。`)
  plain.push(`「${lot.name}」由${lot.holder === PC ? '你' : winnerName}得標。`)
  if (lot.holder === PC) {
    const fee = feeOf(rules, lot.price)
    run.spent += lot.price + fee
    run.won.push({ lot: lot.lot, price: lot.price, fee })
    changes.push({ op: run.pay, delta: -(lot.price + fee) })
    k.changes.applyAll(work, changes)
    const d = deliver(k, work, run, lot)
    changes.push(...d.changes)
    k.changes.applyAll(work, d.changes)
    markSold()
    if (run.pay === 'cred' && d.banned) {
      const dirty = dirtyChanges(k, work, rules)
      changes.push(...dirty)
      k.changes.applyAll(work, dirty)
    }
    lines.push(`你付了 ${formatAmount(lot.price)}，加佣金 ${formatAmount(fee)}（${PAY_NAME[run.pay]}）。`, ...d.lines)
    plain.push(...d.plain)
  } else markSold()
  return { changes, lines, plain, hammer }
}

// ---- 報告 ----

const actText = (a: ActRecord): string | null => {
  switch (a.act) {
    case 'raise': return a.who === PC ? `你加了 ${a.steps} 階，現價 ${formatAmount(a.price)}。` : `${a.name}加了一階，現價 ${formatAmount(a.price)}。`
    case 'wait': return `你沒有加價，等著。現價 ${formatAmount(a.price)}。`
    case 'fold': return '你退出了這一件。'
    case 'out': return `${a.name}退出了這一件。`
    case 'pass': return `${a.name}沒有出價。`
    default: return null
  }
}

// ---- 報告的 outcome（正式的型別：畫面不用轉型）與整場的回顧 ----

/** 這一場結束後的回顧（auction.close／auction.leave 的 outcome.recap；用 auctionSummary 讀）。 */
export interface AuctionSummary {
  house: string
  house_name: string
  /** 場次（開槌日的天數） */
  session: number
  pay: AuctionPay
  pay_name: string
  /** 中途離場（剩下的拍品都不喊了） */
  left: boolean
  /** 每一件的結果，照拍賣的順序；mine 是玩家得標（付了錢、拿到貨）的那一件 */
  lots: Array<{
    lot: number
    name: string
    kind: LotKind
    kind_name: string
    result: 'sold' | 'passed'
    winner: Holder
    winner_name: string | null
    price: number
    mine: boolean
    /** 玩家標到了但交不出去（撤拍）的原因 */
    withdrawn?: string
  }>
  /** 玩家得標的（價錢與佣金） */
  won: Array<{ lot: number; name: string; price: number; fee: number }>
  /** 一共付了多少（價錢加佣金，用 pay 那一種錢） */
  spent: number
  /** 流標的件數、別人得標的件數、撤拍的件數 */
  passed: number
  lost: number
  withdrawn: number
  /** 一句結語（程式的句子） */
  text: string
}

/** 拍賣報告（auction.enter、auction.bid、auction.close、auction.leave）的 outcome。 */
export interface AuctionOutcome {
  result: string
  summary: string
  house: string
  /** 這一份報告開始時的是第幾件（0 起算） */
  lot: number
  rounds: RoundLog[]
  hammers: Hammer[]
  closed: boolean
  /** 整場結束的才有 */
  won?: Won[]
  spent?: number
  recap?: AuctionSummary
}

const isOutcome = (o: unknown): o is AuctionOutcome => isRecord(o) && isText(o.house) && Array.isArray(o.rounds) && Array.isArray(o.hammers) && typeof o.closed === 'boolean'

/** 讀一份拍賣報告的 outcome（不是拍賣的回合報告是 null）。 */
export function auctionOutcome(report: Pick<Report, 'action' | 'outcome'>): AuctionOutcome | null {
  return typeof report.action === 'string' && report.action.startsWith('auction.') && isOutcome(report.outcome) ? report.outcome : null
}

/** 這一場結束了的讀法：auction.close／auction.leave（結束整場的那一份）的 outcome.recap；其他報告、沒有結束的是 null。 */
export function auctionSummary(report: Pick<Report, 'action' | 'outcome'>): AuctionSummary | null {
  return auctionOutcome(report)?.recap ?? null
}

function summaryOf(k: Kernel, state: GameState, run: Run, left: boolean, text: string): AuctionSummary {
  const lots = run.lots.map((l, i) => {
    const log = run.log.find((x) => x.lot === i)
    const winner: Holder = log?.winner ?? null
    return {
      lot: i, name: l.name, kind: l.kind, kind_name: kindName(l.kind, state), result: (winner === null ? 'passed' : 'sold') as 'sold' | 'passed', winner,
      winner_name: winner === null ? null : nameOfBidder(run, winner), price: log?.price ?? l.price, mine: winner === PC, ...(log?.withdrawn !== undefined ? { withdrawn: log.withdrawn } : {}),
    }
  })
  return {
    house: run.house, house_name: houseOf(k, run.house)?.name ?? run.house, session: run.session, pay: run.pay, pay_name: PAY_NAME[run.pay], left, lots,
    won: run.won.map((w) => ({ lot: w.lot, name: run.lots[w.lot]?.name ?? '', price: w.price, fee: w.fee })), spent: run.spent,
    passed: lots.filter((l) => l.result === 'passed' && l.withdrawn === undefined).length, lost: lots.filter((l) => l.result === 'sold' && !l.mine).length,
    withdrawn: lots.filter((l) => l.withdrawn !== undefined).length, text,
  }
}

interface Step {
  rounds: RoundLog[]
  hammers: Hammer[]
  changes: Change[]
  lines: string[]
  plain: string[]
  beats: TimelineBeat[]
  closed: boolean
}

/**
 * 自動跟價替玩家選這一回合的動作（LEWD_SYSTEM 6.2 節第 6 點；規則和手動喊價完全一樣）：自己已經是最高的人就等；
 * 不是的時候，再加一階（最小的一步）不超過上限、而且付得起（含佣金）就跟，否則退出這一件。
 */
export function autoChoice(state: GameState, run: Run, rules: AuctionRules, lot: LotRun, max: number): Move {
  if (lot.holder === PC) return { act: 'wait' }
  const price = lot.price + lot.step
  const affordable = price + feeOf(rules, price) <= state.money[run.pay]
  return price <= max && affordable ? { act: 'raise', steps: 1 } : { act: 'fold' }
}

/** 算一份報告：玩家的一個動作（或離場），連同這一件之後由程式算完的部分。run 與 work 都是複本，會被改。 */
function runStep(k: Kernel, state: GameState, work: GameState, run: Run, rules: AuctionRules, plan: Plan): Step {
  const st: Step = { rounds: [], hammers: [], changes: [], lines: [], plain: [], beats: [], closed: false }
  const finish = (lot: LotRun): void => {
    const s = settle(k, work, run, lot, rules, lot.round)
    delete lot.auto
    st.changes.push(...s.changes)
    st.hammers.push(s.hammer)
    st.lines.push(...s.lines)
    st.plain.push(...s.plain)
    st.beats.push(beat(state, s.lines[0]!, 'auction.hammer', { ...s.hammer }))
    for (const extra of s.lines.slice(1)) st.beats.push(beat(state, extra, 'auction.settle', { lot: lot.lot }, true))
    run.at += 1
    const next = lotOf(run)
    if (next) st.beats.push(beat(state, announce(state, next), 'auction.announce', { lot: next.lot }))
  }
  const round = (lot: LotRun, pc: Move | null): boolean => {
    const r = playRound(state, run, rules, lot, pc)
    st.rounds.push(r.log)
    for (const a of r.log.acts) {
      const t = actText(a)
      if (t) st.beats.push(beat(state, t, 'auction.bid', { lot: lot.lot, round: r.log.round, ...a }, a.who === PC))
    }
    if (r.log.countdown && !r.hammered) st.beats.push(beat(state, '主持人：倒數一次。', 'auction.countdown', { lot: lot.lot, round: r.log.round }))
    if (r.hammered) st.beats.push(beat(state, lot.quiet >= 2 ? '主持人：落槌。' : `主持人：${rules.rounds_max} 回合到了，以現價落槌。`, 'auction.gavel', { lot: lot.lot, round: r.log.round }))
    return r.hammered
  }
  const toHammer = (lot: LotRun): void => {
    while (lot.state === 'open') {
      if (round(lot, null)) {
        const last = st.rounds[st.rounds.length - 1]!
        finish(lot)
        last.hammer = st.hammers[st.hammers.length - 1]!
      }
    }
  }
  if (plan.act === 'leave') {
    st.beats.push(beat(state, '你離開了拍賣廳，剩下的拍品你都不喊了。', 'auction.leave', { at: run.at }, true))
    while (lotOf(run)) {
      const lot = lotOf(run)!
      if (lot.holder !== PC) lot.pc_out = true
      toHammer(lot)
    }
  } else if (plan.act === 'auto_off') {
    // 取消自動跟價：不走回合，改回手動
    const lot = lotOf(run)!
    delete lot.auto
    st.beats.push(beat(state, '你取消了自動跟價，這一件改回自己喊。', 'auction.auto_off', { lot: lot.lot }, true))
  } else if (plan.act === 'auto' || plan.act === 'auto_next') {
    // 自動跟價：替玩家按這一回合（上限記在這一件上；落槌或玩家退出就拿掉。退出之後和手動退出一樣，由程式算完這一件）
    const lot = lotOf(run)!
    if (plan.act === 'auto') lot.auto = plan.max
    const choice = autoChoice(state, run, rules, lot, lot.auto!)
    const hammered = round(lot, choice)
    const last = st.rounds[st.rounds.length - 1]!
    if (hammered) {
      finish(lot)
      last.hammer = st.hammers[st.hammers.length - 1]!
    } else if (choice.act === 'fold') {
      delete lot.auto
      toHammer(lot)
    }
  } else {
    // 手動：玩家自己接手，自動跟價的上限拿掉
    const lot = lotOf(run)!
    delete lot.auto
    const hammered = round(lot, plan)
    const last = st.rounds[st.rounds.length - 1]!
    if (hammered) {
      finish(lot)
      last.hammer = st.hammers[st.hammers.length - 1]!
    } else if (plan.act === 'fold') toHammer(lot)
  }
  st.closed = !lotOf(run)
  return st
}

function draftOf(k: Kernel, state: GameState, action: string, plan: Plan): ReportDraft {
  const run0 = readRun(state)!
  const rules = auctionRules(k)
  const run = clone(run0)
  const work = clone(state)
  const lotAt = run.at
  const st = runStep(k, state, work, run, rules, plan)
  const house = houseOf(k, run.house)
  const changes: Change[] = [...st.changes]
  const triggers: ReportTrigger[] = []
  let actionName = action
  let result = st.closed ? 'done' : st.hammers.length > 0 ? 'hammer' : 'bid'
  const beats = st.beats.slice()
  const lines = st.lines.slice()
  const plain = st.plain.slice()
  let end: ActivityEndMerged | null = null
  let recapText = ''
  if (st.closed) {
    const now = toMinutes(state.time)
    const target = Math.max(run.end, run.entered + rules.min_minutes)
    const minutes = Math.max(0, target - now)
    const resultData = { house: run.house, won: clone(run.won), spent: run.spent, log: clone(run.log) }
    end = endActivity(k, { state, kind: ACTIVITY, id: `${run.house}:${run.session}`, origin: { by: ACTIVITY, ref: run.house }, outcome: 'done', result: resultData })
    changes.push({ op: PATCH_OP, run: null, done: { [run.house]: run.session } }, ...(minutes > 0 ? [{ op: 'time', minutes } as Change] : []), ...end.changes)
    const tail = `這一場結束了：你得標了 ${run.won.length} 件，一共付了 ${formatAmount(run.spent)}（${PAY_NAME[run.pay]}）。時間到了${formatTime(fromMinutes(now + minutes))}。`
    recapText = tail
    lines.push(tail, ...end.lines.map((x) => `${x.replace(/。$/, '')}。`))
    beats.push(beat(state, tail, CLOSE_ACTION, { house: run.house, won: run.won.length, spent: run.spent }))
    plain.push(`這一場在${house?.name ?? run.house}結束了。`, ...end.lines)
    triggers.push({ point: DONE_POINT, where: { house: run.house, won: run.won.length } })
    if (action === BID_ACTION) actionName = CLOSE_ACTION
    if (plan.act === 'leave') result = 'left'
  } else changes.push({ op: PATCH_OP, run: run as unknown as Record<string, unknown> })
  if (plan.act === 'auto_off') result = 'auto_off'
  const outcome: AuctionOutcome = {
    result, summary: beats.map((b) => b.text).join(''), house: run.house, lot: lotAt, rounds: st.rounds, hammers: st.hammers, closed: st.closed,
    ...(st.closed ? { won: run.won, spent: run.spent, recap: summaryOf(k, state, run, plan.act === 'leave', recapText) } : {}),
  }
  const d: ReportDraft = {
    kind: 'action', action: actionName, location: clone(state.location), ...(state.pc ? { actor: state.pc } : {}), party: [], timeline: beats, changes,
    outcome, ...(triggers.length > 0 ? { triggers } : {}), narration: { results: plain },
  }
  return end ? attachActivityEnd(d, end) : d
}

/**
 * 一個回合：報告 auction.bid（這一回合結束整場時是 auction.close）。outcome 帶這一回合每個人的動作、倒數的狀態、落槌的結果。
 * 自動跟價（LEWD_SYSTEM 6.2 節第 6 點）也是一回合一份報告：{ auto: { max } } 設上限並走這一回合，{ act: 'auto_next' } 照上限再走一回合，
 * { act: 'auto_off' } 取消（不走回合；result 是 auto_off）。要看到這一件落槌為止就一直送 auto_next，隨時可以改送 auto_off 或手動的一手。
 */
export function bidDraft(k: Kernel, state: GameState, input: BidInput | AutoInput): ReportDraft {
  const block = bidBlock(k, state, input)
  if (block) throw new ActionBlocked(block)
  return draftOf(k, state, BID_ACTION, planOf(input))
}

/** 離場：剩下的每一件都當成玩家退出，由程式算完（報告 auction.leave；結束的流程和喊完一樣）。 */
export function leaveBlock(k: Kernel, state: GameState): string | null {
  if (!readRun(state)) return '現在不在拍賣廳裡。'
  return k.activity.blockOf(state, `commit:${LEAVE_ACTION}`)
}

export function leaveDraft(k: Kernel, state: GameState): ReportDraft {
  const block = leaveBlock(k, state)
  if (block) throw new ActionBlocked(block)
  return draftOf(k, state, LEAVE_ACTION, { act: 'leave' })
}

// ---- 給畫面的讀法 ----

export interface AuctionView {
  house: string
  house_name: string
  pay: AuctionPay
  pay_name: string
  /** 第幾件（1 起算）、共幾件 */
  lot_no: number
  lot_count: number
  lot: {
    index: number
    name: string
    desc?: string
    kind: LotKind
    kind_name: string
    cert: string
    looked?: { result: 'ok' | 'fake' | 'unknown'; text: string }
  }
  reserve: number
  price: number
  step: number
  /** 現在最高的人：id 是 'pc'、競標者的 id 或 null；name 是「你」或他的名字 */
  holder: { id: Holder; name: string | null }
  /** 這一件設著的自動跟價上限（價錢，不含佣金）；沒設是 null */
  auto: number | null
  /** 第幾回合（下一個要喊的回合）與上限；已經喊完幾回合 */
  round: number
  rounds_done: number
  rounds_max: number
  /** 連續沒有人加價的回合數、是否倒數一次 */
  quiet: number
  countdown: boolean
  /** 這一場所有的競標者（名字；預算不給）與有沒有退出這一件 */
  bidders: Array<{ id: string; name: string; out: boolean }>
  /** 一句主持人的話 */
  host: string
  spent: number
  won: Array<{ lot: number; name: string; price: number; fee: number }>
  /** 身上這一種錢還剩多少 */
  money: number
}

/** 給畫面看的一場拍賣（不帶仿品的記號與競標者的預算）。不改狀態；沒有進行中的拍賣是 null。 */
export function auctionView(k: Kernel, state: GameState): AuctionView | null {
  const run = readRun(state)
  const lot = run ? lotOf(run) : undefined
  if (!run || !lot) return null
  const looked = auctionOf(state).looked[lot.key]
  return {
    house: run.house, house_name: houseOf(k, run.house)?.name ?? run.house, pay: run.pay, pay_name: PAY_NAME[run.pay],
    lot_no: lot.lot + 1, lot_count: run.lots.length,
    lot: {
      index: lot.lot, name: lot.name, ...(lot.desc !== undefined ? { desc: lot.desc } : {}), kind: lot.kind, kind_name: kindName(lot.kind, state), cert: lot.cert,
      ...(looked !== undefined ? { looked: { result: looked, text: LOOK_TEXT[looked] } } : {}),
    },
    reserve: lot.reserve, price: lot.price, step: lot.step,
    holder: { id: lot.holder, name: lot.holder === null ? null : nameOfBidder(run, lot.holder) },
    auto: lot.auto ?? null,
    round: lot.round + 1, rounds_done: lot.round, rounds_max: auctionRules(k).rounds_max, quiet: lot.quiet, countdown: lot.quiet === 1,
    bidders: run.bidders.map((b) => ({ id: b.id, name: b.name, out: lot.out.includes(b.id) })),
    host: announce(state, lot),
    spent: run.spent,
    won: run.won.map((w) => ({ lot: w.lot, name: run.lots[w.lot]?.name ?? '', price: w.price, fee: w.fee })),
    money: state.money[run.pay],
  }
}
