// L6 功能 cyberware 的解授權鎖：補繳與破解（CYBERWARE 第 5 節「解鎖的方法」；TRADE 3.4 節；SKILL_TREES 解鎖匠；dev/adr/0019 P11；dev/work/M4-cyber-lock.md 第 3 條）。
// 三種解法裡這一張做兩種：付清（payLockDraft，報告 cyber.pay）、請改造師破解（crackDraft，報告 cyber.crack）；
// 第三種「請潛網者偽造授權」只留出口：效果 cyber_unlock（lock.ts）。
//
// 補繳：付清 owed 就解開（沒有欠款的不能補繳）。
// 破解：動刀的人擲技術＋義體學對（設計圖等級的標準 DC ＋ crack_dc_bonus）。成功與大成功把 lock 整個拿掉（鎖與 off 一起）；失敗鎖還在，觸發回報：
//   鎖的 holder 是勢力就加那個勢力的敵對值 crack_hostility（效果 hostility；查不到量表就只寫一句）；大失敗另外讓那一件壞掉（off: { why: 'broken' }，要修：repair.ts）。
//   條件 ability（daily: 'unlock'）成立的人檢定 +unlock_bonus，失敗（含大失敗）不觸發回報；沒有人註冊這個條件就沒有這一條。
// 骰子一律 deriveRng（用途帶 uid）；擲過骰的報告多一筆 rng 推進游標。

import type { ActorId, Change, CheckRoll, GameState, Kernel, ReportDraft, RollPart, TimelineBeat } from '../../core'
import { ActionBlocked, DEGREE_NAME, checkParts, checkPassChance, clone, dcFor, effectCtx, rollCheck } from '../../core'
import type { CyberLock } from './lock'
import { BROKEN_OFF, isLocked, pieceName, readLock, weeklyOf, writePieces } from './lock'
import type { CyberPiece } from './model'
import { cyberOf, cyberRules } from './model'
import type { Pool } from './surgery'
import { SELF_ATTR, moneyProblem, nameOf, payPool } from './surgery'
import { deckContentOf, pieceBlueprint } from './deck'

export const PAY_ACTION = 'cyber.pay'
export const CRACK_ACTION = 'cyber.crack'
export const HOSTILITY_EFFECT = 'hostility'

const inParty = (state: GameState, who: ActorId): boolean => !!state.actors[who] && (who === state.pc || state.party.includes(who))

// ---- 畫面讀的：身上哪幾件有鎖 ----

export interface LockViewItem {
  uid: string
  bp: string
  name: string
  slot: CyberPiece['slot']
  kind: CyberLock['kind'] | null
  holder?: string
  /** 每週的訂閱費（訂閱的；契約是那一筆寫的 weekly，沒寫是 0） */
  weekly: number
  owed: number
  /** 現在被鎖住（off 是 lock） */
  locked: boolean
  /** 有期限的鎖到什麼時候（總分鐘） */
  until?: number
}

/** 這個人身上有授權鎖的（有 lock 紀錄，或被鎖住的）每一件。 */
export function lockView(k: Kernel, state: GameState, actor: ActorId): LockViewItem[] {
  const out: LockViewItem[] = []
  for (const piece of cyberOf(state, actor)) {
    const lock = readLock(piece.lock)
    if (!lock && !isLocked(piece)) continue
    out.push({
      uid: piece.uid, bp: piece.bp, name: pieceName(k, piece), slot: piece.slot, kind: lock?.kind ?? null, ...(lock?.holder ? { holder: lock.holder } : {}),
      weekly: lock ? (lock.kind === 'subscription' ? weeklyOf(k, piece, lock) : (lock.weekly ?? 0)) : 0, owed: lock?.owed ?? 0, locked: isLocked(piece),
      ...(isLocked(piece) && piece.off?.until !== undefined ? { until: piece.off.until } : {}),
    })
  }
  return out
}

// ---- 補繳 ----

export interface PayLockOpts {
  actor: ActorId
  /** 身上那一件的 uid */
  uid: string
  /** 從哪裡付；不寫先帳戶、不夠再現金 */
  pay?: Pool
}

interface PayPlan {
  problems: string[]
  piece?: CyberPiece
  lock?: CyberLock
  owed: number
  pay: Pool | null
}

function planPay(k: Kernel, state: GameState, o: PayLockOpts): PayPlan {
  const problems: string[] = []
  if (!state.actors[o.actor]) return { problems: ['找不到這個角色。'], owed: 0, pay: null }
  const act = k.activity.blockOf(state, `commit:${PAY_ACTION}`)
  if (act) problems.push(act)
  const piece = cyberOf(state, o.actor).find((p) => p.uid === o.uid)
  if (!piece) return { problems: [...problems, '身上沒有這一件義體。'], owed: 0, pay: null }
  const lock = readLock(piece.lock)
  if (!lock) return { problems: [...problems, `${pieceName(k, piece)}沒有授權鎖。`], piece, owed: 0, pay: null }
  if (lock.owed <= 0) problems.push(`${pieceName(k, piece)}沒有欠款要補繳。`)
  const mp = moneyProblem(state, lock.owed, o.pay, '補繳的欠款')
  if (mp) problems.push(mp)
  return { problems, piece, lock, owed: lock.owed, pay: payPool(state.money, lock.owed, o.pay) }
}

export const payLockProblems = (k: Kernel, state: GameState, o: PayLockOpts): string[] => planPay(k, state, o).problems
export const payLockBlock = (k: Kernel, state: GameState, o: PayLockOpts): string | null => planPay(k, state, o).problems[0] ?? null

/** 補繳欠的：付清 owed、鎖解開（被鎖住的才有 off 可拿；壞掉的還是壞的）。報告 cyber.pay。 */
export function payLockDraft(k: Kernel, state: GameState, o: PayLockOpts): ReportDraft {
  const plan = planPay(k, state, o)
  if (plan.problems.length > 0 || !plan.piece || !plan.lock || !plan.pay) throw new ActionBlocked(plan.problems[0] ?? '現在補繳不了。')
  const piece = plan.piece
  const name = pieceName(k, piece)
  const pieces = cyberOf(state, o.actor).map((p) => {
    if (p.uid !== piece.uid) return p
    const next: CyberPiece = { ...p, lock: { ...clone(p.lock ?? {}), kind: plan.lock!.kind, owed: 0 } }
    if (isLocked(next)) delete next.off
    return next
  })
  const changes: Change[] = [{ op: plan.pay, delta: -plan.owed }, writePieces(state, o.actor, pieces)]
  const who = nameOf(state, o.actor)
  const text = `${who}補繳了${name}欠的款，${isLocked(piece) ? '鎖開了' : '帳清了'}。`
  const lines = [text]
  return {
    kind: 'action', action: PAY_ACTION, location: clone(state.location), actor: o.actor, party: [],
    timeline: [{ layer: 'meat', actor: o.actor, text, tag: PAY_ACTION, data: { uid: piece.uid, bp: piece.bp, paid: plan.owed, pool: plan.pay } }],
    changes, outcome: { result: 'paid', summary: text }, narration: { results: lines },
  }
}

// ---- 破解 ----

export interface CrackOpts {
  actor: ActorId
  /** 身上那一件的 uid */
  uid: string
  /** 動刀的人（主角或隊上的人；預設被鎖的人自己） */
  by?: ActorId
}

export interface CrackQuote {
  uid: string
  bp: string
  name: string
  by: ActorId
  /** 設計圖等級的標準 DC ＋ crack_dc_bonus（照難度的偏移） */
  dc: number
  /** 擲骰面以外的加值合計（含解鎖匠） */
  bonus: number
  /** 破解成功（成功或大成功）的機率，0～1 */
  chance: number
  /** 動刀的人通過條件 ability（daily: 'unlock'） */
  unlocker: boolean
  holder?: string
  /** 失敗會加敵對值的勢力（鎖的 holder 是勢力、而且不是解鎖匠） */
  faction?: string
  minutes: number
}

interface CrackPlan {
  problems: string[]
  quote: CrackQuote | null
  piece?: CyberPiece
  lock?: CyberLock
  parts: RollPart[]
}

/** 動刀的人是解鎖匠（條件 ability 的日常 unlock 成立；沒有人註冊條件就不是）。 */
function isUnlocker(k: Kernel, state: GameState, by: ActorId): boolean {
  return k.conditions.kinds().includes('ability') && k.conditions.test({ kind: 'ability', daily: 'unlock' }, { state, actor: by, stats: k.stats, timeRules: k.timeRules })
}

function planCrack(k: Kernel, state: GameState, o: CrackOpts): CrackPlan {
  const problems: string[] = []
  const none = (): CrackPlan => ({ problems, quote: null, parts: [] })
  const rules = cyberRules(k)
  const by = o.by ?? o.actor
  if (!state.actors[o.actor]) return { problems: ['找不到這個角色。'], quote: null, parts: [] }
  const act = k.activity.blockOf(state, `commit:${CRACK_ACTION}`)
  if (act) problems.push(act)
  const piece = cyberOf(state, o.actor).find((p) => p.uid === o.uid)
  if (!piece) {
    problems.push('身上沒有這一件義體。')
    return none()
  }
  const name = pieceName(k, piece)
  const lock = readLock(piece.lock)
  if (!lock) problems.push(`${name}沒有授權鎖可以破解。`)
  if (!state.actors[by]) problems.push('找不到動刀的人。')
  else if (!inParty(state, by)) problems.push('動刀的人要是主角或隊上的人。')
  if (problems.length > 0 && !state.actors[by]) return { problems, quote: null, piece, ...(lock ? { lock } : {}), parts: [] }

  const bp = pieceBlueprint(k, piece)
  const grade = bp?.grade ?? deckContentOf(k, piece.bp)?.grade ?? 1
  const dc = dcFor((rules.self_dc[Math.min(5, Math.max(1, grade)) - 1] ?? rules.self_dc[0] ?? 10) + rules.crack_dc_bonus, state.rules)
  const unlocker = state.actors[by] ? isUnlocker(k, state, by) : false
  const situation: RollPart[] = unlocker ? [{ label: '解鎖匠', value: rules.unlock_bonus, source: 'situation' }] : []
  const parts = state.actors[by] ? checkParts(k.stats, state, by, { attr: SELF_ATTR, skill: rules.self_skill, tags: ['crack'] }, situation) : []
  const isFaction = !!lock?.holder && k.content.hasKind('faction') && k.content.has('faction', lock.holder)
  const quote: CrackQuote = {
    uid: o.uid, bp: piece.bp, name, by, dc, bonus: parts.reduce((s, p) => s + p.value, 0), chance: checkPassChance(parts.reduce((s, p) => s + p.value, 0), dc), unlocker, ...(lock?.holder ? { holder: lock.holder } : {}),
    ...(isFaction && !unlocker ? { faction: lock!.holder! } : {}), minutes: rules.surgery_minutes,
  }
  return { problems, quote, piece, ...(lock ? { lock } : {}), parts: situation }
}

export const crackProblems = (k: Kernel, state: GameState, o: CrackOpts): string[] => planCrack(k, state, o).problems
export const crackBlock = (k: Kernel, state: GameState, o: CrackOpts): string | null => planCrack(k, state, o).problems[0] ?? null
/** 這一次破解的 DC 與加值（畫面與草稿用同一份）；身上沒有這一件是 null。 */
export const crackQuote = (k: Kernel, state: GameState, o: CrackOpts): CrackQuote | null => planCrack(k, state, o).quote

/** 失敗的回報：鎖的 holder 是勢力就加敵對值（效果 hostility；查不到就只寫一句）。回傳變更與一句話。 */
function reportBack(k: Kernel, state: GameState, actor: ActorId, q: CrackQuote, amount: number): { changes: Change[]; lines: string[] } {
  const line = '動靜被回報給了鎖的主人。'
  if (!q.faction || amount <= 0 || !k.effects.has(HOSTILITY_EFFECT)) return { changes: [], lines: [line] }
  const ctx = effectCtx(k, state, { source: 'builtin', actor })
  const fx = [{ kind: HOSTILITY_EFFECT, key: q.faction, amount }]
  if (k.effects.validate(fx, ctx).length > 0) return { changes: [], lines: [line] }
  const res = k.effects.resolve(fx, ctx)
  if (res.errors.length > 0) return { changes: [], lines: [line] }
  return { changes: res.changes, lines: [line, ...res.lines] }
}

/**
 * 破解授權鎖。不成立丟 ActionBlocked（crackProblems 的第一條）。報告 cyber.crack：outcome.result 是 cracked（成功與大成功）、failed、broken（大失敗）。
 * 寫進狀態：時間加 surgery_minutes、rng 推進；成功拿掉 lock 與 off；大失敗那一件 off: { why: 'broken' }；失敗的回報見上。
 */
export function crackDraft(k: Kernel, state: GameState, o: CrackOpts): ReportDraft {
  const plan = planCrack(k, state, o)
  if (plan.problems.length > 0 || !plan.quote || !plan.piece) throw new ActionBlocked(plan.problems[0] ?? '現在破解不了。')
  const q = plan.quote
  const piece = plan.piece
  const rules = cyberRules(k)
  const roll: CheckRoll = rollCheck(k.stats, state, {
    actor: q.by, attr: SELF_ATTR, skill: rules.self_skill, dc: q.dc, purpose: `${CRACK_ACTION}/${q.uid}`, tags: ['crack'], situation: plan.parts,
  })
  const who = nameOf(state, q.by)
  const patient = nameOf(state, o.actor)
  const changes: Change[] = [{ op: 'time', minutes: q.minutes }, { op: 'rng', advance: 1 }]
  const lines: string[] = []
  let result: 'cracked' | 'failed' | 'broken'
  const set = (fn: (p: CyberPiece) => CyberPiece) => writePieces(state, o.actor, cyberOf(state, o.actor).map((p) => (p.uid === piece.uid ? fn(p) : p)))

  if (roll.degree === 'critical' || roll.degree === 'success') {
    result = 'cracked'
    changes.push(set((p) => {
      const { lock: _lock, ...rest } = p
      void _lock
      if (isLocked(rest)) delete (rest as { off?: unknown }).off
      return rest as CyberPiece
    }))
    lines.push(`${who}對著${patient}身上的${q.name}動了手腳，授權鎖被拆掉了。`)
    if (roll.degree === 'critical') lines.push('拆得很乾淨，沒有留下任何痕跡。')
  } else {
    result = roll.degree === 'fumble' ? 'broken' : 'failed'
    if (roll.degree === 'fumble') {
      changes.push(set((p) => ({ ...p, off: { why: BROKEN_OFF } })))
      lines.push(`${who}一刀下去切到了不該切的地方：${q.name}壞掉了，鎖還在。`)
    } else lines.push(`${who}試著破解${q.name}的授權鎖，沒有成功，鎖還在。`)
    if (q.unlocker) lines.push('對方沒有發現有人動過手腳。')
    else {
      const back = reportBack(k, state, o.actor, q, rules.crack_hostility)
      changes.push(...back.changes)
      lines.push(...back.lines)
    }
  }
  const beats: TimelineBeat[] = [{ layer: 'meat', actor: q.by, text: lines[0]!, tag: CRACK_ACTION, data: { uid: q.uid, bp: q.bp, by: q.by, degree: roll.degree, dc: q.dc, unlocker: q.unlocker } }]
  beats.push({ layer: 'meat', actor: q.by, text: `${DEGREE_NAME[roll.degree]}（骰 ${roll.natural}，合計 ${roll.total}，對 DC ${roll.dc}）`, roll, tag: 'cyber.roll', data: { degree: roll.degree } })
  for (const text of lines.slice(1)) beats.push({ layer: 'meat', actor: o.actor, text, tag: 'cyber.note' })
  return {
    kind: 'action', action: CRACK_ACTION, location: clone(state.location), actor: o.actor, party: [], timeline: beats, changes,
    outcome: { result, summary: lines.join('') }, narration: { results: lines },
  }
}
