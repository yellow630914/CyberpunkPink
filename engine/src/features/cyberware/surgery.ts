// L6 功能 cyberware 的手術：把一件成品裝上去、拆下來（CYBERWARE 2.1 節；CRAFTING 10.2 節；TRADE 3.4 節；dev/adr/0019 第三節與 P2～P6；dev/work/M4-cyberware.md）。
// 改狀態的入口都是「匯出一個純函式，回傳報告草稿」：installDraft、removeDraft 不成立時丟 ActionBlocked（原因一條一句）；
// installBlock、removeBlock 回傳第一條原因（能做是 null），installProblems、removeProblems 回傳全部。報價與畫面用同一份算法（installQuote、removeQuote）。
//
// 四種人動刀（via）：clinic 正規診所（費用成品價的五成、登記、沉溺成本 −10%、沒有併發症）、unlicensed 無照診所（三成、10%）、black 黑診所（四成、15%、不登記）、
// self 自己或隊友動刀（免費、擲技術＋義體學對設計圖等級的標準 DC；動刀的人要通過 self_requires、人要在住處或診所）。
// 哪一種人「在這裡」看站的設施：設施種類（world 的 facility_type）多讀一個欄位 clinic: { grade }，用條件 at_facility 問；自己動刀的地方用條件 at_home 問。
// 骰子一律用 deriveRng（用途帶 uid）：重新讀檔重擲、結果不變；每次擲過骰，報告多一筆 rng 推進游標，同一件失手之後再試才會換新的骰面。
// 數字都從規則表 cyber_rule 讀（model.ts）。手術費沒有乘區的倍率（這一張先不乘）。

import type { ActorId, BlueprintEntry, Change, CheckRoll, GameState, Kernel, ProductData, QuirkEntry, ReportDraft, TimelineBeat } from '../../core'
import {
  ActionBlocked, DEGREE_NAME, blueprintOf, checkParts, clone, dcFor, deriveRng, formatAmount, formatDuration, partOf, partTypeName, productOf, productPrice, readProduct, rollCheck, sinkUpChanges, stackOf,
} from '../../core'
import { DECK_FULL, brainDeck, deckContentOf, isDeckPiece, netActivityBlock, pieceBlueprint } from './deck'
import { usedExtras } from './used'
import type { CyberPiece, CyberRules, PartId, Side, SurgeonKind } from './model'
import {
  EXT, FACILITY_TYPE_KIND, PART_NAME, RECOVERING, SURGEON_NAME, cyberExtValue, cyberOf, cyberRules, hasBridge, isSurgeonKind, nowOf, partIdOf,
} from './model'

/** 衍生數值：動刀的人讓沉溺成本加減百分之幾（cyberware 定義；夾在 −25～0）。 */
export const SURGERY_STAT = 'surgery_sink_pct'
/** 自己動刀的檢定用技術這項屬性（CYBERWARE 2.1 節：技術＋義體學）。 */
export const SELF_ATTR = 'tech'
export const INSTALL_ACTION = 'cyber.install'
export const REMOVE_ACTION = 'cyber.remove'

export type Pool = 'cred' | 'cash'

// ---- 這裡有誰可以動刀 ----

type FacilityTypeEntry = { id: string; name?: unknown; clinic?: unknown }

/** 現在站的設施是哪一種診所（用條件 at_facility 問；沒有人登記就沒有診所）。 */
export function clinicHere(k: Kernel, state: GameState): { type: string; name: string; grade: 'clinic' | 'unlicensed' | 'black' } | null {
  if (!k.conditions.kinds().includes('at_facility') || !k.content.hasKind(FACILITY_TYPE_KIND)) return null
  const ctx = { state, stats: k.stats, timeRules: k.timeRules }
  for (const t of k.content.list<FacilityTypeEntry>(FACILITY_TYPE_KIND)) {
    const grade = (t.clinic as { grade?: unknown } | undefined)?.grade
    if (grade !== 'clinic' && grade !== 'unlicensed' && grade !== 'black') continue
    if (k.conditions.test({ kind: 'at_facility', types: [t.id] }, ctx)) return { type: t.id, name: typeof t.name === 'string' && t.name ? t.name : t.id, grade }
  }
  return null
}

/** 一串條件裡用到的條件種類（含 all、any、not 裡面的）。 */
function conditionKinds(c: unknown, out: Set<string> = new Set()): Set<string> {
  if (c && typeof c === 'object') {
    const kind = (c as { kind?: unknown }).kind
    if (typeof kind === 'string') {
      if (kind === 'all' || kind === 'any') for (const x of ((c as { of?: unknown[] }).of ?? [])) conditionKinds(x, out)
      else if (kind === 'not') conditionKinds((c as { of?: unknown }).of, out)
      else out.add(kind)
    }
  }
  return out
}

/** 自己動刀這一項列不列：self_requires 用到的條件種類都有人註冊（例：沒有 abilities，條件 ability 不存在，就沒有自己動刀）。 */
export function selfListed(k: Kernel, rules: CyberRules = cyberRules(k)): boolean {
  const known = new Set(k.conditions.kinds())
  return rules.self_requires.every((c) => [...conditionKinds(c)].every((kind) => known.has(kind)))
}

/** 自己動刀的人通過 self_requires 嗎；沒過的每一條寫一句。 */
function selfConditionProblems(k: Kernel, state: GameState, by: ActorId, rules: CyberRules): string[] {
  const ctx = { state, actor: by, stats: k.stats, timeRules: k.timeRules }
  const out: string[] = []
  for (const c of rules.self_requires) {
    if (k.conditions.test(c, ctx)) continue
    out.push(c.kind === 'ability' ? '動刀的人還沒有學會手術這項技能。' : '動刀的人不符合自己動刀的條件。')
  }
  return [...new Set(out)]
}

/** 人在住處或診所嗎（自己動刀的地方）。住處用條件 at_home 問，沒有人登記就沒有住處。 */
function atHomeOrClinic(k: Kernel, state: GameState): boolean {
  if (clinicHere(k, state)) return true
  if (!k.conditions.kinds().includes('at_home')) return false
  return k.conditions.test({ kind: 'at_home' }, { state, stats: k.stats, timeRules: k.timeRules })
}

/** 這個人（by 動刀、替 actor 動）現在選這一種動刀的人不行的原因；行是 null。 */
export function surgeonBlock(k: Kernel, state: GameState, via: SurgeonKind, actor: ActorId, by: ActorId, rules: CyberRules): string | null {
  if (via !== 'self') {
    const here = clinicHere(k, state)
    if (here?.grade === via) return null
    return `這裡沒有${SURGEON_NAME[via]}。`
  }
  if (!selfListed(k, rules)) return '現在還不能自己動刀。'
  if (!state.actors[by]) return '找不到動刀的人。'
  if (by !== actor && !state.party.includes(by)) return '動刀的人不在隊上。'
  const need = selfConditionProblems(k, state, by, rules)
  if (need.length > 0) return need[0]!
  if (!atHomeOrClinic(k, state)) return '自己動刀要在住處或診所。'
  return null
}

/** surgeons 的一項：一種動刀的人。block 是現在選不了的原因（能選是 null）。 */
export interface SurgeonOption {
  id: SurgeonKind
  name: string
  /** 手術費：成品價的幾成 */
  fee: number
  sink_pct: number
  /** 留下併發症的機率（自己動刀看檢定：0） */
  complication: number
  /** 登記在橋 ID 上 */
  registered: boolean
  block: string | null
}

/**
 * 這裡有哪幾種人可以動刀、各自的原因：站的設施有 clinic 的就列那一種診所；自己動刀在 self_requires 用到的條件都有人註冊時才列（沒有 ability 條件就不列）。
 * actor 是被動刀的人，by 是動刀的人（只有自己動刀看它，預設是 actor 自己）。
 */
export function surgeons(k: Kernel, state: GameState, actor: ActorId, by: ActorId = actor): SurgeonOption[] {
  const rules = cyberRules(k)
  const out: SurgeonOption[] = []
  const here = clinicHere(k, state)
  const make = (id: SurgeonKind, block: string | null): SurgeonOption => ({
    id, name: SURGEON_NAME[id], fee: rules.surgeons[id].fee, sink_pct: rules.surgeons[id].sink_pct,
    complication: id === 'self' ? 0 : rules.surgeons[id].complication, registered: id === 'clinic', block,
  })
  if (here) out.push(make(here.grade, null))
  if (selfListed(k, rules)) out.push(make('self', surgeonBlock(k, state, 'self', actor, by, rules)))
  return out
}

// ---- 沉溺成本、休養、價錢 ----

/**
 * 一件義體裝上去的沉溺成本（P2）：設計圖的 sink_cost 加成品所有零件（與怪癖、精工）stats.sink 的合計；全生體 0；有接面的（機械接生體）乘 mixed_sink_mult 無條件捨去；
 * 再乘（100＋動刀的人加減的百分比）％四捨五入；最少 0。百分比：這一種人自己的 sink_pct（正規診所 −10）與動刀的人的衍生數值 surgery_sink_pct（手術刀每階 −5%）取比較好的，
 * 不疊（CYBERWARE 2.1 節）；手術刀只算在正規診所與自己動刀上（無照與黑診所「照設計圖」）。by 是動刀的人（沒給就不算手術刀）。
 */
export function pieceSink(k: Kernel, state: GameState, bpId: string, data: unknown, opts: { via: SurgeonKind; by?: ActorId }): number {
  const info = productOf(k.content, bpId, data)
  const rules = cyberRules(k)
  let base: number
  if (info) {
    if (info.allBio) return 0
    base = (info.bp.sink_cost ?? 0) + (info.stats.sink ?? 0)
    if (info.seams > 0) base = Math.floor(base * rules.mixed_sink_mult)
  } else {
    // 內容種類 deck 的成品甲板：沒有零件，成本是那一筆的 sink_cost，沒寫照規則表（P51）
    const deck = deckContentOf(k, bpId)
    if (!deck) return 0
    base = deck.sink_cost ?? rules.deck_sink_default
  }
  let pct = rules.surgeons[opts.via].sink_pct
  if ((opts.via === 'self' || opts.via === 'clinic') && opts.by && state.actors[opts.by] && k.stats.hasStat(SURGERY_STAT)) pct = Math.min(pct, k.stats.stat(state, opts.by, SURGERY_STAT))
  return Math.max(0, Math.round((base * (100 + pct)) / 100 + 1e-9))
}

/** 這一件裝好之後要養多久（分鐘）：照侵入度；全生體乘 bio_recovery_mult。 */
export function recoveryOf(rules: CyberRules, bp: Pick<BlueprintEntry, 'invasiveness'>, allBio: boolean): number {
  const base = rules.recovery_minutes[bp.invasiveness ?? 'light'] ?? 0
  return Math.round(base * (allBio ? rules.bio_recovery_mult : 1))
}

/** 這個人用 self 動刀的 DC 與加值（技術＋義體學＋別的修正，和真正擲的是同一組）。 */
export interface SelfCheck {
  by: ActorId
  skill: string
  dc: number
  /** 擲骰面以外的加值合計 */
  bonus: number
}

export function selfCheckOf(k: Kernel, state: GameState, by: ActorId, bp: Pick<BlueprintEntry, 'grade'>, rules: CyberRules): SelfCheck | undefined {
  if (!state.actors[by]) return undefined
  const base = rules.self_dc[Math.min(5, Math.max(1, bp.grade)) - 1] ?? rules.self_dc[0] ?? 10
  const parts = checkParts(k.stats, state, by, { attr: SELF_ATTR, skill: rules.self_skill, tags: ['surgery'] })
  return { by, skill: rules.self_skill, dc: dcFor(base, state.rules), bonus: parts.reduce((s, p) => s + p.value, 0) }
}

/** 付一筆錢用哪一種：指定的就用指定的（不夠回 null）；沒指定先帳戶、不夠再現金。 */
export function payPool(money: GameState['money'], cost: number, want?: Pool): Pool | null {
  if (cost <= 0) return want ?? 'cred'
  return (want ? [want] : (['cred', 'cash'] as Pool[])).find((p) => money[p] >= cost) ?? null
}
const POOL_NAME: Record<Pool, string> = { cred: '帳戶', cash: '現金' }
export const moneyProblem = (state: GameState, fee: number, pay: Pool | undefined, what: string): string | null =>
  fee > 0 && payPool(state.money, fee, pay) === null ? `錢不夠：${what}要 ${formatAmount(fee)}，${pay ? POOL_NAME[pay] : '帳戶與現金'}付不起。` : null

export const missingText = (missing: string[]): string => {
  const n = new Map<string, number>()
  for (const t of missing) n.set(t, (n.get(t) ?? 0) + 1)
  return [...n].map(([t, c]) => (c > 1 ? `${partTypeName(t)}×${c}` : partTypeName(t))).join('、')
}

// ---- 裝上 ----

export interface InstallOpts {
  /** 被裝的人 */
  actor: ActorId
  /** 背包裡那一疊成品的 uid（stack.data.uid） */
  uid: string
  /** 設計圖的部位是 arm 或 leg 時要給：l 是左、r 是右 */
  side?: Side
  /** 誰動刀 */
  via: SurgeonKind
  /** 動刀的人（只有 via 是 self 時看它；預設是被裝的人自己） */
  by?: ActorId
  /** 手術費從哪裡付；不寫先帳戶、不夠再現金 */
  pay?: Pool
}

/** 一次裝上的報價（畫面與草稿用同一份）。 */
export interface InstallQuote {
  uid: string
  bp: string
  name: string
  grade: number
  /** 裝在哪個部位；arm、leg 沒給左右是 null */
  slot: PartId | null
  via: SurgeonKind
  /** 成品的目錄價（productPrice） */
  price: number
  /** 手術費（自己動刀是 0） */
  fee: number
  /** 錢從哪裡付；付不起是 null */
  pay: Pool | null
  /** 沉溺成本（裝上時算定；自己動刀大成功再 −1） */
  sink: number
  /** 手術花的時間（分鐘） */
  minutes: number
  /** 裝好之後要養多久（分鐘；0 是不用養） */
  recovery_minutes: number
  /** 留下併發症的機率（0～1；自己動刀看檢定：0） */
  complication: number
  /** 登記在橋 ID 上 */
  registered: boolean
  /** 自己動刀的 DC 與加值；其他人動刀沒有 */
  self?: SelfCheck
}

interface InstallPlan {
  problems: string[]
  quote: InstallQuote | null
}

function planInstall(k: Kernel, state: GameState, o: InstallOpts): InstallPlan {
  const problems: string[] = []
  const rules = cyberRules(k)
  const by = o.by ?? o.actor
  if (!state.actors[o.actor]) return { problems: ['找不到這個角色。'], quote: null }
  if (!isSurgeonKind(o.via)) return { problems: ['要說是誰動刀。'], quote: null }
  const act = k.activity.blockOf(state, `commit:${INSTALL_ACTION}`)
  if (act) problems.push(act)
  const stack = stackOf(state, o.uid)
  if (!stack) return { problems: [...problems, '背包裡沒有這一件。'], quote: null }
  const found = blueprintOf(k.content, stack)
  // 內容種類 deck 的成品甲板（M4-cyber-deck）：部位固定是腦，沒有零件、不要檢查缺什麼，數字照那一筆
  const dk = found ? undefined : deckContentOf(k, stack.id)
  if (!found && !dk) return { problems: [...problems, '這不是能裝的義體。'], quote: null }
  if (found && found.kind !== 'cyberware') return { problems: [...problems, `${found.name}不是義體。`], quote: null }
  const bp: Pick<BlueprintEntry, 'name' | 'grade' | 'slot' | 'invasiveness' | 'needs_bridge' | 'deck'> = found ?? { name: dk!.name, grade: dk!.grade, slot: 'brain', invasiveness: (dk!.invasiveness ?? 'invasive') as BlueprintEntry['invasiveness'] }
  const info = found ? productOf(k.content, stack.id, stack.data)! : undefined

  if (cyberOf(state, o.actor).some((p) => p.uid === o.uid)) problems.push(`${bp.name}已經裝在身上了。`)
  if (info && info.missing.length > 0) problems.push(`缺零件：${missingText(info.missing)}。`)

  // 甲板：不能在網內動手術；腦裡只能有一副
  const isDeck = dk !== undefined || bp.deck !== undefined
  if (isDeck) {
    const net = netActivityBlock(k, state, '換甲板')
    if (net) problems.unshift(net)
  }

  // 部位與槽
  const slot = partIdOf(bp.slot, o.side)
  if (bp.slot === 'bridge') problems.push('換橋是另一種手術。')
  else if (!bp.slot) problems.push(`${bp.name}沒有寫部位，裝不上去。`)
  else if (!slot) problems.push(`${bp.slot === 'arm' ? '手臂' : '腿'}要說是左邊還是右邊。`)
  else {
    if (isDeck && slot === 'brain' && brainDeck(k, state, o.actor)) problems.push(DECK_FULL)
    if (cyberOf(state, o.actor).filter((p) => p.slot === slot).length >= rules.slots[slot]) problems.push(`${PART_NAME[slot]}的槽已經滿了。`)
  }
  if (bp.needs_bridge !== false && bp.slot !== 'bridge' && !hasBridge(state, o.actor)) problems.push('這件義體要接在橋上，你還沒有橋。')

  const sb = surgeonBlock(k, state, o.via, o.actor, by, rules)
  if (sb) problems.push(sb)

  // 成品甲板的價錢是那一筆自己寫的 price（沒寫是 0）
  const price = dk ? (dk.price ?? 0) : productPrice(k.content, stack.id, stack.data)
  const fee = Math.round(price * rules.surgeons[o.via].fee + 1e-9)
  const mp = moneyProblem(state, fee, o.pay, '手術費')
  if (mp) problems.push(mp)

  const quote: InstallQuote = {
    uid: o.uid, bp: stack.id, name: bp.name, grade: bp.grade, slot, via: o.via, price, fee, pay: payPool(state.money, fee, o.pay),
    sink: pieceSink(k, state, stack.id, stack.data, { via: o.via, by }), minutes: rules.surgery_minutes,
    recovery_minutes: recoveryOf(rules, bp, info?.allBio ?? false), complication: o.via === 'self' ? 0 : rules.surgeons[o.via].complication, registered: o.via === 'clinic',
    ...(o.via === 'self' ? { self: selfCheckOf(k, state, by, bp, rules) } : {}),
  }
  return { problems, quote }
}

/** 裝上去現在行不行：全部的原因（一條一句）；行是空陣列。 */
export const installProblems = (k: Kernel, state: GameState, o: InstallOpts): string[] => planInstall(k, state, o).problems
/** 裝上去現在行不行：第一條原因；行是 null。 */
export const installBlock = (k: Kernel, state: GameState, o: InstallOpts): string | null => planInstall(k, state, o).problems[0] ?? null
/** 這一次手術的報價；背包裡找不到那件成品是 null。 */
export const installQuote = (k: Kernel, state: GameState, o: InstallOpts): InstallQuote | null => planInstall(k, state, o).quote

export const nameOf = (state: GameState, id: ActorId): string => state.actors[id]?.name ?? id

/** 併發症的池：quirk 裡 pool 有 complication、而且適用義體的（照內容載入的順序）。 */
export function complicationPool(k: Kernel): QuirkEntry[] {
  if (!k.content.hasKind('quirk')) return []
  return k.content.list<QuirkEntry>('quirk').filter((q) => Array.isArray(q.pool) && q.pool.includes('complication') && (!q.applies || q.applies.includes('cyberware')))
}

/** 最晚的休養結束時間（身上所有義體的 ready_at；沒有休養是 0）。 */
export const latestReady = (pieces: CyberPiece[]): number => pieces.reduce((n, p) => Math.max(n, p.ready_at ?? 0), 0)

/** 新的下限：現在的 sink_floor 加這一件（沒有人定義 sink_floor 時照身上義體的成本加總）。 */
export function floorWith(k: Kernel, state: GameState, actor: ActorId, add: number): number {
  const now = k.stats.hasStat('sink_floor') ? k.stats.stat(state, actor, 'sink_floor') : cyberOf(state, actor).reduce((n, p) => n + p.sink, 0)
  return now + add
}

/**
 * 裝上一件義體。不成立丟 ActionBlocked（installProblems 的第一條）。
 * 診所：不擲檢定，照機率留一筆併發症。自己動刀：擲技術＋義體學對標準 DC：大成功成本 −1；成功照常；失敗裝上但多一筆併發症；大失敗沒裝上、東西還在背包、被裝的人沉溺 +1。
 * 寫進狀態：背包那一疊拿掉、pieces 多一件、扣手術費、時間加 surgery_minutes、ready_at＝裝好的時間＋休養、角色掛 recovering（until 是身上最晚的 ready_at）、
 * 沉溺低於新的下限就補到下限。報告 cyber.install。
 */
export function installDraft(k: Kernel, state: GameState, o: InstallOpts): ReportDraft {
  const plan = planInstall(k, state, o)
  if (plan.problems.length > 0 || !plan.quote) throw new ActionBlocked(plan.problems[0] ?? '現在裝不了。')
  const q = plan.quote
  const rules = cyberRules(k)
  const by = o.by ?? o.actor
  const stack = stackOf(state, o.uid)!
  const found = blueprintOf(k.content, stack)
  const bp = found ?? { name: deckContentOf(k, stack.id)!.name }
  const patient = state.actors[o.actor]!

  let roll: CheckRoll | undefined
  let rolled = false
  let installed = true
  let complication = false
  let great = false
  if (q.via === 'self') {
    roll = rollCheck(k.stats, state, { actor: by, attr: SELF_ATTR, skill: rules.self_skill, dc: q.self!.dc, purpose: `${INSTALL_ACTION}/${q.uid}`, tags: ['surgery'] })
    rolled = true
    if (roll.degree === 'critical') great = true
    else if (roll.degree === 'fail') complication = true
    else if (roll.degree === 'fumble') installed = false
  } else if (q.complication > 0) {
    rolled = true
    complication = deriveRng(state.rng, `${INSTALL_ACTION}/${q.uid}/complication`).chance(q.complication)
  }
  const sink = great ? Math.max(0, q.sink - 1) : q.sink

  const changes: Change[] = []
  const lines: string[] = []
  const surgeonText = q.via === 'self' && by !== o.actor ? `${nameOf(state, by)}替${patient.name}動刀` : q.via === 'self' ? `${patient.name}自己動刀` : `${patient.name}在${SURGEON_NAME[q.via]}動了手術`
  const data: Record<string, unknown> = { uid: q.uid, bp: q.bp, via: q.via, slot: q.slot, fee: q.fee, sink, installed }

  if (!installed) {
    // 大失敗：沒裝上、東西還在背包、被裝的人沉溺 +1；時間照花
    changes.push({ op: 'time', minutes: q.minutes }, ...sinkUpChanges(k, state, o.actor, 1))
    lines.push(`${surgeonText}，這一刀失手了：${bp.name}沒有裝上，神經被扯得很痛，東西還留在背包裡。`, `${patient.name}又往深處滑了一點。`)
  } else {
    const now = nowOf(state) + q.minutes
    const ready = q.recovery_minutes > 0 ? now + q.recovery_minutes : undefined
    const base: ProductData = readProduct(stack.data, k.content)
    const parts = Object.keys(base.parts).length > 0 ? base.parts : clone(found?.stock ?? {})
    const quirks = [...(base.quirks ?? [])]
    let quirkName: string | undefined
    if (complication) {
      rolled = true
      const pool = complicationPool(k).filter((x) => !quirks.includes(x.id))
      if (pool.length > 0) {
        const pick = deriveRng(state.rng, `${INSTALL_ACTION}/${q.uid}/quirk`).pick(pool)
        quirks.push(pick.id)
        quirkName = pick.name
      }
    }
    // 二手的義體（M4-cyber-lock；P12）：殘響與可能的惡意韌體，掛在同一份報告
    const used = usedExtras(k, state, o.actor, q.bp, { ...base, uid: q.uid, parts, ...(quirks.length > 0 ? { quirks } : {}) })
    if (used.quirk) quirks.push(used.quirk.id)
    const piece: CyberPiece = {
      ...base, uid: q.uid, parts, ...(quirks.length > 0 ? { quirks } : {}),
      bp: q.bp, kind_of: found ? 'blueprint' : 'deck', slot: q.slot!, sink, at: now, ...(ready !== undefined ? { ready_at: ready } : {}), registered: q.registered,
    }
    const pieces = [...cyberOf(state, o.actor), piece]
    const floor = floorWith(k, state, o.actor, sink)
    changes.push({ op: 'item', id: q.bp, qty: -1, data: { uid: q.uid } })
    if (q.fee > 0) changes.push({ op: q.pay!, delta: -q.fee })
    changes.push({ op: 'time', minutes: q.minutes }, { op: 'actor.ext', id: o.actor, key: EXT, value: cyberExtValue(state, o.actor, pieces) })
    changes.push(...used.changes)
    if (ready !== undefined) changes.push({ op: 'actor.condition', id: o.actor, condition: RECOVERING, until: Math.max(latestReady(pieces), ready) })
    if (patient.sink < floor) changes.push({ op: 'actor.track', id: o.actor, track: 'sink', delta: floor - patient.sink })
    lines.push(`${surgeonText}，${bp.name}裝進了${PART_NAME[q.slot!]}。`)
    if (great) lines.push('手術比想像中順利，神經幾乎沒有被驚動。')
    if (ready !== undefined) lines.push('新裝的部位還要養一陣子，這段時間不會生效。')
    if (complication) lines.push(quirkName ? `手術留下了併發症：${quirkName}。` : '手術不算乾淨，留下了一點後遺症。')
    if (used.quirk) lines.push(`${bp.name}是二手的，前一個使用者的殘響還留在裡面：${used.quirk.name}。`)
    if (floor > 0 && patient.sink < floor) lines.push('身上的義體把沉溺墊高了。')
    Object.assign(data, { at: now, ...(ready !== undefined ? { ready_at: ready } : {}), complication: quirkName ?? null, echo: used.quirk?.id ?? null })
  }
  if (rolled) changes.push({ op: 'rng', advance: 1 })

  const beats: TimelineBeat[] = [{ layer: 'meat', actor: o.actor, text: lines[0]!, tag: INSTALL_ACTION, data }]
  if (roll) beats.push({ layer: 'meat', actor: by, text: `${DEGREE_NAME[roll.degree]}（骰 ${roll.natural}，合計 ${roll.total}，對 DC ${roll.dc}）`, roll, tag: 'cyber.roll', data: { degree: roll.degree } })
  for (const text of lines.slice(1)) beats.push({ layer: 'meat', actor: o.actor, text, tag: 'cyber.note' })
  return {
    kind: 'action', action: INSTALL_ACTION, location: clone(state.location), actor: o.actor, party: [], timeline: beats, changes,
    outcome: { result: !installed ? 'botched' : complication ? 'complication' : great ? 'great' : 'installed', summary: lines.join('') },
    narration: { results: lines },
  }
}

// ---- 拆下 ----

export interface RemoveOpts {
  actor: ActorId
  /** 身上那一件的 uid */
  uid: string
  via: SurgeonKind
  by?: ActorId
  pay?: Pool
}

export interface RemoveQuote {
  uid: string
  bp: string
  name: string
  via: SurgeonKind
  /** 拆的費用：安裝費 × remove_fee_mult（自己動刀不收） */
  fee: number
  pay: Pool | null
  minutes: number
  /** 拆下來之後這一件整個沒有了（全生體；或零件全毀） */
  vanishes: boolean
  /** 自己動刀的 DC 與加值 */
  self?: SelfCheck
}

interface RemovePlan {
  problems: string[]
  quote: RemoveQuote | null
  piece?: CyberPiece
}

function planRemove(k: Kernel, state: GameState, o: RemoveOpts): RemovePlan {
  const problems: string[] = []
  const rules = cyberRules(k)
  const by = o.by ?? o.actor
  if (!state.actors[o.actor]) return { problems: ['找不到這個角色。'], quote: null }
  if (!isSurgeonKind(o.via)) return { problems: ['要說是誰動刀。'], quote: null }
  const piece = cyberOf(state, o.actor).find((p) => p.uid === o.uid)
  // 甲板：人在網內、潛入中不能拆（比一般的活動限制先說）
  if (piece && isDeckPiece(k, piece)) {
    const net = netActivityBlock(k, state, '拆甲板')
    if (net) problems.push(net)
  }
  const act = k.activity.blockOf(state, `commit:${REMOVE_ACTION}`)
  if (act && !problems.includes(act)) problems.push(act)
  if (!piece) return { problems: [...problems, '身上沒有這一件義體。'], quote: null }
  const deck = piece.kind_of === 'deck' ? deckContentOf(k, piece.bp) : undefined
  const bp = pieceBlueprint(k, piece)
  const name = bp?.name ?? deck?.name ?? piece.bp
  if (piece.slot === 'bridge') problems.push('橋不能這樣拆，換橋是另一種手術。')
  if (piece.off?.why === 'lock') problems.push('有授權鎖，要先解鎖。')
  const sb = surgeonBlock(k, state, o.via, o.actor, by, rules)
  if (sb) problems.push(sb)

  const price = piece.kind_of === 'deck' ? (deck?.price ?? 0) : productPrice(k.content, piece.bp, piece)
  const installFee = Math.round(price * rules.surgeons[o.via].fee + 1e-9)
  const fee = Math.round(installFee * rules.remove_fee_mult + 1e-9)
  const mp = moneyProblem(state, fee, o.pay, '拆除的手術費')
  if (mp) problems.push(mp)
  const info = piece.kind_of === 'deck' ? undefined : productOf(k.content, piece.bp, piece)
  const quote: RemoveQuote = {
    uid: o.uid, bp: piece.bp, name, via: o.via, fee, pay: payPool(state.money, fee, o.pay), minutes: rules.surgery_minutes, vanishes: piece.kind_of === 'deck' ? false : !info || info.allBio,
    ...(o.via === 'self' ? { self: selfCheckOf(k, state, by, { grade: bp?.grade ?? deck?.grade ?? 1 }, rules) } : {}),
  }
  return { problems, quote, piece }
}

export const removeProblems = (k: Kernel, state: GameState, o: RemoveOpts): string[] => planRemove(k, state, o).problems
export const removeBlock = (k: Kernel, state: GameState, o: RemoveOpts): string | null => planRemove(k, state, o).problems[0] ?? null
export const removeQuote = (k: Kernel, state: GameState, o: RemoveOpts): RemoveQuote | null => planRemove(k, state, o).quote

/** 拆下來之後剩下的零件：全生體整件沒有了（回傳 null）；混裝只留機械的，生體的死了；機械的全留。壞掉認不出的零件留著。 */
export function keptParts(k: Kernel, piece: CyberPiece, allBio: boolean): Array<{ type: string; ref: unknown; array: boolean }> | null {
  if (allBio) return null
  const out: Array<{ type: string; ref: unknown; array: boolean }> = []
  for (const [type, v] of Object.entries(piece.parts)) {
    const array = Array.isArray(v)
    for (const ref of array ? v : [v]) {
      if (partOf(k.content, ref)?.material === 'bio') continue
      out.push({ type, ref, array })
    }
  }
  return out
}

/** 拆下來的一件變回背包裡的一疊（二手）：只留下沒死的零件，身上的欄位（部位、成本、時間、鎖）都拿掉。 */
export function usedProduct(piece: CyberPiece, kept: Array<{ type: string; ref: unknown; array: boolean }>): ProductData {
  const parts: Record<string, unknown> = {}
  for (const { type, ref, array } of kept) {
    if (array) parts[type] = [...((parts[type] as unknown[] | undefined) ?? []), clone(ref)]
    else parts[type] = clone(ref)
  }
  const { bp: _bp, kind_of: _kind, slot: _slot, sink: _sink, at: _at, ready_at: _ready, off: _off, registered: _reg, loaded: _loaded, ...product } = piece
  void _bp, void _kind, void _slot, void _sink, void _at, void _ready, void _off, void _reg, void _loaded
  return { ...clone(product), parts: parts as ProductData['parts'], state: 'used' }
}

/**
 * 拆下一件義體。費用是安裝費 × remove_fee_mult（自己動刀不收、照樣擲，失敗時一個隨機的零件報廢）；有授權鎖的拆不了；橋這一張不能拆。
 * 拆下來的變回背包裡的一疊（state: used）；全生體的那一件直接沒有了；混裝的只留下機械的零件。下限跟著降，沉溺本身不動。報告 cyber.remove。
 */
export function removeDraft(k: Kernel, state: GameState, o: RemoveOpts): ReportDraft {
  const plan = planRemove(k, state, o)
  if (plan.problems.length > 0 || !plan.quote || !plan.piece) throw new ActionBlocked(plan.problems[0] ?? '現在拆不了。')
  const q = plan.quote
  const piece = plan.piece
  const rules = cyberRules(k)
  const by = o.by ?? o.actor
  const patient = state.actors[o.actor]!
  const isDeckKind = piece.kind_of === 'deck'
  const info = isDeckKind ? undefined : productOf(k.content, piece.bp, piece)
  const allBio = !isDeckKind && (!info || info.allBio)

  let roll: CheckRoll | undefined
  let ruined = false
  if (q.via === 'self') {
    roll = rollCheck(k.stats, state, { actor: by, attr: SELF_ATTR, skill: rules.self_skill, dc: q.self!.dc, purpose: `${REMOVE_ACTION}/${q.uid}`, tags: ['surgery'] })
    ruined = roll.degree === 'fail' || roll.degree === 'fumble'
  }
  let kept = isDeckKind ? [] : keptParts(k, piece, allBio)
  const bioDied = info && !allBio ? info.parts.filter((p) => p.part.material === 'bio').length : 0
  let lostPart: string | undefined
  if (ruined && kept && kept.length > 0) {
    const i = deriveRng(state.rng, `${REMOVE_ACTION}/${q.uid}/part`).int(0, kept.length - 1)
    lostPart = partOf(k.content, kept[i]!.ref)?.name ?? '一個零件'
    kept = kept.filter((_, j) => j !== i)
  }

  const rest = cyberOf(state, o.actor).filter((p) => p.uid !== q.uid)
  const changes: Change[] = []
  if (q.fee > 0) changes.push({ op: q.pay!, delta: -q.fee })
  changes.push({ op: 'time', minutes: q.minutes }, { op: 'actor.ext', id: o.actor, key: EXT, value: cyberExtValue(state, o.actor, rest) })

  const lines: string[] = []
  const who = q.via === 'self' && by !== o.actor ? `${nameOf(state, by)}替${patient.name}動刀` : q.via === 'self' ? `${patient.name}自己動刀` : `${patient.name}在${SURGEON_NAME[q.via]}動了手術`
  lines.push(`${who}，把${q.name}從${PART_NAME[piece.slot]}拆了下來。`)
  let returned = false
  if (isDeckKind) {
    // 成品甲板整副回到背包（M3 的樣子：只帶編號）；槽裡的構裝還記在 ext.deck.slots，再裝一副就回來
    changes.push({ op: 'item', id: piece.bp, qty: 1, data: { uid: piece.uid } })
    returned = true
    lines.push('拆下來的甲板回到了背包。')
  } else if (kept === null) {
    lines.push('那是活的組織，離開身體就死了，什麼也沒有剩下。')
  } else if (kept.length === 0) {
    lines.push('拆下來的零件全都壞了，什麼也沒有剩下。')
  } else {
    // 組回一疊成品：原樣的 uid、品質、怪癖，狀態變成二手，零件只留下沒死的（內嵌零件整筆照搬）
    const data = usedProduct(piece, kept)
    changes.push({ op: 'item', id: piece.bp, qty: 1, data: data as unknown as Record<string, unknown> })
    returned = true
    lines.push('拆下來的東西回到了背包，變成二手貨。')
    if (bioDied > 0) lines.push('活的那幾個零件離開身體就死了。')
  }
  if (lostPart) lines.push(`手上沒抓穩，${lostPart}在拆的時候報廢了。`)
  // 藥泵裡預裝的藥：連同這一件拆出來，回到背包（M4-cyber-battle）
  if (piece.loaded && piece.loaded.qty > 0) {
    changes.push({ op: 'item', id: piece.loaded.item, qty: piece.loaded.qty })
    lines.push('藥泵裡預裝的藥一併取了出來。')
  }
  if (q.via === 'self') changes.push({ op: 'rng', advance: 1 })

  const beats: TimelineBeat[] = [{ layer: 'meat', actor: o.actor, text: lines[0]!, tag: REMOVE_ACTION, data: { uid: q.uid, bp: piece.bp, via: q.via, fee: q.fee, returned, lost: lostPart ?? null } }]
  if (roll) beats.push({ layer: 'meat', actor: by, text: `${DEGREE_NAME[roll.degree]}（骰 ${roll.natural}，合計 ${roll.total}，對 DC ${roll.dc}）`, roll, tag: 'cyber.roll', data: { degree: roll.degree } })
  for (const text of lines.slice(1)) beats.push({ layer: 'meat', actor: o.actor, text, tag: 'cyber.note' })
  return {
    kind: 'action', action: REMOVE_ACTION, location: clone(state.location), actor: o.actor, party: [], timeline: beats, changes,
    outcome: { result: returned ? (lostPart ? 'damaged' : 'removed') : 'gone', summary: lines.join('') },
    narration: { results: lines },
  }
}

/** 給畫面的時間句子。 */
export const surgeryTime = (minutes: number): string => formatDuration(minutes)
