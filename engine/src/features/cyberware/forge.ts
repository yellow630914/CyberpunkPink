// L6 功能 cyberware 的第三種解鎖法：請人偽造授權（CYBERWARE 第 5 節「解鎖的方法」；M4-followups-2 第 7 項；M4-cyber-lock 回報）。
// 三種解法：付清（crack.ts 的 payLockDraft）、請改造師破解（crackDraft）、請潛網者偽造授權（這一檔）。偽造成功走效果 cyber_unlock（lock.ts 註冊）把鎖整個拿掉。
// 兩種請法（opts.via）：
//   partner  請夥伴辦：夥伴（隊上的人，不一定是被鎖的人）擲介面（智識＋介面基本功）對 設計圖等級的標準 DC ＋ forge_dc_bonus；不收錢。
//            成功與大成功解開；失敗鎖還在，鎖的主人是勢力就加它的敵對值 crack_hostility（效果 hostility；查不到量表就只寫一句）；大失敗另外讓那一件壞掉（要修：repair.ts）。
//   broker   請中間人辦：付成品價的 forge_fee 成（先帳戶、不夠再現金），不擲檢定、一定成功；中間人的手藝穩，也不留下痕跡（不回報）。
// 都花一個手術的時間（surgery_minutes）；骰子一律 deriveRng（用途帶 uid）。報告 cyber.forge：outcome.result 是 forged、failed、broken。
// 沒有人註冊 cyber_unlock 時整件事做不了（原因寫在 forgeProblems）。

import type { ActorId, Change, CheckRoll, GameState, Kernel, ReportDraft, TimelineBeat } from '../../core'
import { ActionBlocked, DEGREE_NAME, checkParts, checkPassChance, clone, dcFor, effectCtx, rollCheck } from '../../core'
import { HOSTILITY_EFFECT } from './crack'
import { BROKEN_OFF, UNLOCK_EFFECT, pieceName, piecePrice, readLock, writePieces } from './lock'
import type { CyberPiece } from './model'
import { cyberOf, cyberRules } from './model'
import type { Pool } from './surgery'
import { moneyProblem, nameOf, payPool } from './surgery'
import { deckContentOf, pieceBlueprint } from './deck'

export const FORGE_ACTION = 'cyber.forge'
/** 偽造的人擲的屬性與基本功：智識＋介面（潛網者的本行）。 */
export const FORGE_ATTR = 'intellect'
export const FORGE_SKILL = 'interface'

export type ForgeVia = 'partner' | 'broker'
export const isForgeVia = (v: unknown): v is ForgeVia => v === 'partner' || v === 'broker'

export interface ForgeOpts {
  /** 被鎖的人 */
  actor: ActorId
  /** 身上那一件的 uid */
  uid: string
  via: ForgeVia
  /** 請夥伴辦：動手的夥伴（隊上的人） */
  by?: ActorId
  /** 請中間人辦：從哪裡付；不寫先帳戶、不夠再現金 */
  pay?: Pool
}

export interface ForgeQuote {
  uid: string
  bp: string
  name: string
  via: ForgeVia
  by?: ActorId
  /** 請夥伴辦的 DC 與加值（中間人是 null） */
  dc: number | null
  bonus: number | null
  /** 請夥伴辦成功（成功或大成功）的機率，0～1（中間人是 null） */
  chance: number | null
  /** 中間人的價錢（夥伴是 0） */
  fee: number
  pay: Pool | null
  minutes: number
  holder?: string
  faction?: string
}

interface Plan {
  problems: string[]
  quote: ForgeQuote | null
  piece?: CyberPiece
}

const inParty = (state: GameState, who: ActorId): boolean => !!state.actors[who] && (who === state.pc || state.party.includes(who))

function plan(k: Kernel, state: GameState, o: ForgeOpts): Plan {
  const problems: string[] = []
  if (!state.actors[o.actor]) return { problems: ['找不到這個角色。'], quote: null }
  if (!isForgeVia(o.via)) return { problems: ['要說是請夥伴辦還是請中間人辦。'], quote: null }
  const act = k.activity.blockOf(state, `commit:${FORGE_ACTION}`)
  if (act) problems.push(act)
  if (!k.effects.has(UNLOCK_EFFECT)) problems.push('現在沒有地方偽造授權。')
  const piece = cyberOf(state, o.actor).find((p) => p.uid === o.uid)
  if (!piece) return { problems: [...problems, '身上沒有這一件義體。'], quote: null }
  const name = pieceName(k, piece)
  const lock = readLock(piece.lock)
  if (!lock) problems.push(`${name}沒有授權鎖可以偽造。`)
  const rules = cyberRules(k)
  const bp = pieceBlueprint(k, piece)
  const grade = bp?.grade ?? deckContentOf(k, piece.bp)?.grade ?? 1
  const isFaction = !!lock?.holder && k.content.hasKind('faction') && k.content.has('faction', lock.holder)
  const quote: ForgeQuote = {
    uid: o.uid, bp: piece.bp, name, via: o.via, dc: null, bonus: null, chance: null, fee: 0, pay: null, minutes: rules.surgery_minutes,
    ...(lock?.holder ? { holder: lock.holder } : {}), ...(isFaction && o.via === 'partner' ? { faction: lock!.holder! } : {}),
  }
  if (o.via === 'partner') {
    const by = o.by
    if (!by || !state.actors[by]) problems.push('要選一位夥伴來偽造。')
    else if (!inParty(state, by)) problems.push('偽造的人要是主角或隊上的人。')
    else {
      quote.by = by
      quote.dc = dcFor((rules.self_dc[Math.min(5, Math.max(1, grade)) - 1] ?? rules.self_dc[0] ?? 10) + rules.forge_dc_bonus, state.rules)
      quote.bonus = checkParts(k.stats, state, by, { attr: FORGE_ATTR, skill: FORGE_SKILL, tags: ['forge'] }).reduce((s, p) => s + p.value, 0)
      quote.chance = checkPassChance(quote.bonus, quote.dc)
    }
  } else {
    quote.fee = Math.max(0, Math.round(piecePrice(k, piece) * rules.forge_fee + 1e-9))
    const mp = moneyProblem(state, quote.fee, o.pay, '偽造的價錢')
    if (mp) problems.push(mp)
    quote.pay = quote.fee > 0 ? payPool(state.money, quote.fee, o.pay) : null
  }
  return { problems, quote, piece }
}

export const forgeProblems = (k: Kernel, state: GameState, o: ForgeOpts): string[] => plan(k, state, o).problems
export const forgeBlock = (k: Kernel, state: GameState, o: ForgeOpts): string | null => plan(k, state, o).problems[0] ?? null
/** 這一次偽造的 DC 與價錢（畫面與草稿用同一份）；身上沒有這一件是 null。 */
export const forgeQuote = (k: Kernel, state: GameState, o: ForgeOpts): ForgeQuote | null => plan(k, state, o).quote

/** 失敗的回報：鎖的主人是勢力就加敵對值（和破解失敗同一個規則）。 */
function reportBack(k: Kernel, state: GameState, actor: ActorId, faction: string | undefined, amount: number): { changes: Change[]; lines: string[] } {
  const line = '動靜被回報給了鎖的主人。'
  if (!faction || amount <= 0 || !k.effects.has(HOSTILITY_EFFECT)) return { changes: [], lines: [line] }
  const ctx = effectCtx(k, state, { source: 'builtin', actor })
  const fx = [{ kind: HOSTILITY_EFFECT, key: faction, amount }]
  if (k.effects.validate(fx, ctx).length > 0) return { changes: [], lines: [line] }
  const res = k.effects.resolve(fx, ctx)
  return res.errors.length > 0 ? { changes: [], lines: [line] } : { changes: res.changes, lines: [line, ...res.lines] }
}

/** 偽造授權。不成立丟 ActionBlocked（forgeProblems 的第一條）。成功時走效果 cyber_unlock 拿掉鎖。 */
export function forgeDraft(k: Kernel, state: GameState, o: ForgeOpts): ReportDraft {
  const p = plan(k, state, o)
  if (p.problems.length > 0 || !p.quote || !p.piece) throw new ActionBlocked(p.problems[0] ?? '現在偽造不了。')
  const q = p.quote
  const piece = p.piece
  const rules = cyberRules(k)
  const patient = nameOf(state, o.actor)
  const changes: Change[] = [{ op: 'time', minutes: q.minutes }]
  const lines: string[] = []
  let roll: CheckRoll | undefined
  let result: 'forged' | 'failed' | 'broken'
  let ok = true
  const who = q.via === 'partner' ? nameOf(state, q.by!) : '中間人'
  if (q.via === 'partner') {
    roll = rollCheck(k.stats, state, { actor: q.by!, attr: FORGE_ATTR, skill: FORGE_SKILL, dc: q.dc!, purpose: `${FORGE_ACTION}/${q.uid}`, tags: ['forge'] })
    changes.push({ op: 'rng', advance: 1 })
    ok = roll.degree === 'critical' || roll.degree === 'success'
  } else if (q.fee > 0 && q.pay) changes.push({ op: q.pay, delta: -q.fee })
  if (ok) {
    result = 'forged'
    const res = k.effects.resolve([{ kind: UNLOCK_EFFECT, uid: q.uid }], effectCtx(k, state, { source: 'builtin', actor: o.actor }))
    if (res.errors.length > 0) throw new ActionBlocked(res.errors[0]!)
    changes.push(...res.changes)
    lines.push(`${who}替${patient}身上的${q.name}偽造了一份授權，鎖拿掉了${q.via === 'broker' ? `，花了 ${q.fee}` : ''}。`)
    if (roll?.degree === 'critical') lines.push('偽造得很乾淨，鎖的主人那邊什麼也沒看到。')
  } else {
    result = roll!.degree === 'fumble' ? 'broken' : 'failed'
    if (roll!.degree === 'fumble') {
      changes.push(writePieces(state, o.actor, cyberOf(state, o.actor).map((x) => (x.uid === piece.uid ? { ...x, off: { why: BROKEN_OFF } } : x))))
      lines.push(`${who}偽造的授權被${q.name}認出來了：${q.name}壞掉了，鎖還在。`)
    } else lines.push(`${who}試著替${q.name}偽造授權，沒有成功，鎖還在。`)
    const back = reportBack(k, state, o.actor, q.faction, rules.crack_hostility)
    changes.push(...back.changes)
    lines.push(...back.lines)
  }
  const beats: TimelineBeat[] = [{ layer: 'meat', actor: q.by ?? o.actor, text: lines[0]!, tag: FORGE_ACTION, data: { uid: q.uid, bp: q.bp, via: q.via, ...(q.by ? { by: q.by } : {}), fee: q.fee, ...(roll ? { degree: roll.degree, dc: q.dc } : {}) } }]
  if (roll) beats.push({ layer: 'meat', actor: q.by!, text: `${DEGREE_NAME[roll.degree]}（骰 ${roll.natural}，合計 ${roll.total}，對 DC ${roll.dc}）`, roll, tag: 'cyber.roll', data: { degree: roll.degree } })
  for (const text of lines.slice(1)) beats.push({ layer: 'meat', actor: o.actor, text, tag: 'cyber.note' })
  return {
    kind: 'action', action: FORGE_ACTION, location: clone(state.location), actor: o.actor, party: [], timeline: beats, changes,
    outcome: { result, summary: lines.join('') }, narration: { results: lines },
  }
}
