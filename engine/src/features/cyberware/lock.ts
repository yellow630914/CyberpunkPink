// L6 功能 cyberware 的授權鎖與四個效果（CYBERWARE 第 5 節；TRADE 3.4 節；DOWNTIME 第 5 節；dev/adr/0019 第三節「授權鎖」與 P11、P12、P45；dev/work/M4-cyber-lock.md）。
//
// 那一件的 lock（成品資料的欄位，核心的 ProductData.lock 是一筆紀錄；這裡讀成 CyberLock）：{ kind: 'subscription' | 'contract', holder?, weekly?, owed? }。
// 鎖住是那一件的 off: { why: 'lock' }；有 until 的是有期限的鎖，讀的時候比對時間（model.ts 的 readPieces），到了就當沒有，下一次寫 pieces 時順手清掉。
//
//   訂閱  每週帳單（掛點 bill.collect、bill.settled；bills 宣告，這裡只認名字與格式）：主角身上每一件 lock.kind 是 subscription 的各出一行（order 2、帳戶）；
//         沒付成就鎖住並把欠的加進 owed；付了而且 owed 是 0 的解開。玩家停掉的（skipped、why 是 stopped）鎖住那一件、不算欠；寬限中的（grace）不動它。
//   效果  cyber_install、cyber_take、cyber_lock、cyber_unlock（內建的來源才收，ai: false）。cyber_lock 可以不寫選擇器（帳單與契約的鎖）：on: true 鎖照槽順序第一件非橋、還沒停著的，on: false 解開所有 off.why 等於 why 的件。掛點 defeat.gear 對前三種回答 true（戰敗時拿走義體的規則關著，它們就從事件裡拿掉）。
//   掃橋  掛點 scan.person（M4-security-m4 宣告）：回答 { cyber: { count, items } }；沒有人問也不會壞。
// 補繳、破解在 crack.ts；修理在 repair.ts；小手術在 modify.ts。契約（kind: 'contract'）目前只有「帶著它」：掃橋看得到、破解可以拿掉；遠端接管不做。

import type { ActorId, BlueprintEntry, Change, Effect, EffectCtx, GameState, Kernel, ProductData } from '../../core'
import { LEGALITIES, clone, isRecord, isSafeInt, partOf, productOf, productPrice, readProduct, slotProblems } from '../../core'
import { DECK_FULL, brainDeck, deckContentOf, pieceBlueprint } from './deck'
import type { CyberPiece, PartId } from './model'
import { EXT, PART_IDS, PART_NAME, baseSlot, cyberExtValue, cyberOf, cyberRules, isPartId, isBridge, nowOf, partIdOf } from './model'
import { floorWith, keptParts, pieceSink, usedProduct } from './surgery'

export const OWNER = 'cyberware'
export const LOCK_KINDS = ['subscription', 'contract'] as const
export type LockKind = (typeof LOCK_KINDS)[number]
export const LOCK_OFF = 'lock'
export const BROKEN_OFF = 'broken'
/** 帳單項目的順序：DOWNTIME 5.1 節那張表的第 2 項（義體訂閱） */
export const SUBSCRIPTION_ORDER = 2
export const SUBSCRIPTION_PREFIX = 'cyber_sub.'

export const INSTALL_EFFECT = 'cyber_install'
export const TAKE_EFFECT = 'cyber_take'
export const LOCK_EFFECT = 'cyber_lock'
export const UNLOCK_EFFECT = 'cyber_unlock'
/** 掛點 defeat.gear 回答 true 的三種（拿走身上的義體與裝備） */
export const GEAR_EFFECTS: readonly string[] = [INSTALL_EFFECT, TAKE_EFFECT, LOCK_EFFECT]

const isText = (v: unknown): v is string => typeof v === 'string' && v.trim().length > 0
const SLOT_WORDS: readonly string[] = [...PART_IDS, 'arm', 'leg']

// ---- 那一件的 lock ----

export interface CyberLock {
  kind: LockKind
  /** 勢力或 NPC 的 id */
  holder?: string
  /** 每週的訂閱費；沒寫照成品價 × 規則表 subscription_rate 四捨五入 */
  weekly?: number
  /** 欠的（沒付成的加總）；補繳付清才解鎖 */
  owed: number
}

/** 讀一筆 lock（ProductData.lock）；不合格（沒有 kind、kind 不認得）是 undefined。 */
export function readLock(raw: unknown): CyberLock | undefined {
  if (!isRecord(raw) || !(LOCK_KINDS as readonly unknown[]).includes(raw.kind)) return undefined
  const out: CyberLock = { kind: raw.kind as LockKind, owed: isSafeInt(raw.owed) && raw.owed > 0 ? raw.owed : 0 }
  if (isText(raw.holder)) out.holder = raw.holder
  if (isSafeInt(raw.weekly) && raw.weekly >= 0) out.weekly = raw.weekly
  return out
}

/** 把 CyberLock 寫回成品資料的 lock（保留原本紀錄裡別人放的鍵）。 */
const lockWritten = (old: Record<string, unknown> | undefined, lock: CyberLock): Record<string, unknown> => {
  const out: Record<string, unknown> = { ...(old ? clone(old) : {}), kind: lock.kind, owed: lock.owed }
  if (lock.holder !== undefined) out.holder = lock.holder
  if (lock.weekly !== undefined) out.weekly = lock.weekly
  return out
}

/** 校驗 cyber_install 的 lock 欄位與契約的紀錄用：回傳問題。 */
export function lockProblems(raw: unknown, at = 'lock'): string[] {
  if (!isRecord(raw)) return [`${at} 要是 { kind, holder?, weekly?, owed? }`]
  const p: string[] = []
  if (!(LOCK_KINDS as readonly unknown[]).includes(raw.kind)) p.push(`${at}.kind 只能是 ${LOCK_KINDS.join('、')}`)
  if (raw.holder !== undefined && !isText(raw.holder)) p.push(`${at}.holder 要是勢力或 NPC 的 id`)
  if (raw.weekly !== undefined && !(isSafeInt(raw.weekly) && raw.weekly >= 0)) p.push(`${at}.weekly 要是 0 以上的整數`)
  if (raw.owed !== undefined && !(isSafeInt(raw.owed) && raw.owed >= 0)) p.push(`${at}.owed 要是 0 以上的整數`)
  return p
}

// ---- 一件的名字與價錢（設計圖組的與內容種類 deck 的成品甲板都通用） ----

export function pieceName(k: Pick<Kernel, 'content'>, piece: Pick<CyberPiece, 'bp' | 'kind_of'>): string {
  return pieceBlueprint(k, piece)?.name ?? (piece.kind_of === 'deck' ? deckContentOf(k, piece.bp)?.name : undefined) ?? piece.bp
}

/** 成品價（不含安裝費）；成品甲板是那一筆自己寫的 price（沒寫是 0）。 */
export function piecePrice(k: Pick<Kernel, 'content'>, piece: CyberPiece): number {
  return piece.kind_of === 'deck' ? (deckContentOf(k, piece.bp)?.price ?? 0) : productPrice(k.content, piece.bp, piece)
}

/** 這一件訂閱每週付多少：lock.weekly，沒寫照成品價 × subscription_rate 四捨五入（P11）。 */
export function weeklyOf(k: Kernel, piece: CyberPiece, lock: CyberLock): number {
  return lock.weekly ?? Math.max(0, Math.round(piecePrice(k, piece) * cyberRules(k).subscription_rate + 1e-9))
}

/** 把身上的義體寫回去的變更（整理過：過期的 off 已經清掉）。 */
export const writePieces = (state: GameState, actor: ActorId, pieces: CyberPiece[]): Change => ({ op: 'actor.ext', id: actor, key: EXT, value: cyberExtValue(state, actor, pieces) })

/** 這一件現在是被授權鎖鎖住的。 */
export const isLocked = (piece: Pick<CyberPiece, 'off'>): boolean => piece.off?.why === LOCK_OFF

// ---- 每週帳單：訂閱 ----

/** 帳單項目（掛點 bill.collect 的格式；bills 宣告，這裡只認格式）。 */
interface SubscriptionLine {
  id: string
  name: string
  kind: 'due'
  amount: number
  order: number
  pay: 'cred'
}

/** 主角身上的訂閱，每一件一行。金額是 0 的不出。 */
export function subscriptionLines(k: Kernel, state: GameState): Array<SubscriptionLine & { uid: string }> {
  const pc = state.pc
  if (!pc || !state.actors[pc]) return []
  const out: Array<SubscriptionLine & { uid: string }> = []
  for (const piece of cyberOf(state, pc)) {
    const lock = readLock(piece.lock)
    if (lock?.kind !== 'subscription') continue
    const amount = weeklyOf(k, piece, lock)
    if (amount <= 0) continue
    out.push({ uid: piece.uid, id: `${SUBSCRIPTION_PREFIX}${piece.uid}`, name: `${pieceName(k, piece)}訂閱`, kind: 'due', amount, order: SUBSCRIPTION_ORDER, pay: 'cred' })
  }
  return out
}

interface SettledLine {
  id: string
  owner: string
  kind: string
  paid: number
  unpaid: number
  skipped?: true
  /** skipped 的原因：stopped 玩家停掉的、grace 寬限中的（沒寫當成 grace：不動它） */
  why?: string
}

/**
 * 結算完：沒付成的那一件鎖住（off.why 是 lock，已經是壞掉的不蓋它）並把欠的加進 owed；付了而且 owed 是 0 的解開。
 * skipped：寬限中的（why 是 grace）不動它；玩家停掉的（why 是 stopped；不算欠、owed 不加）鎖住那一件，之後恢復付費、付清才解開。回傳要套的變更。
 */
export function subscriptionSettled(state: GameState, lines: readonly SettledLine[]): Change[] {
  const pc = state.pc
  if (!pc || !state.actors[pc]) return []
  const mine = new Map(lines.filter((l) => l.owner === OWNER && l.kind === 'due').map((l) => [l.id, l]))
  if (mine.size === 0) return []
  let touched = false
  const pieces = cyberOf(state, pc).map((piece) => {
    const lock = readLock(piece.lock)
    const line = mine.get(`${SUBSCRIPTION_PREFIX}${piece.uid}`)
    if (lock?.kind !== 'subscription' || !line) return piece
    // 玩家停掉的訂閱：鎖住那一件（不算欠）；寬限中的不動
    if (line.skipped) {
      if (line.why !== 'stopped' || piece.off) return piece
      touched = true
      return { ...piece, off: { why: LOCK_OFF } }
    }
    if (line.unpaid > 0) {
      touched = true
      return { ...piece, lock: lockWritten(piece.lock, { ...lock, owed: lock.owed + line.unpaid }), off: piece.off ?? { why: LOCK_OFF } }
    }
    if (lock.owed === 0 && isLocked(piece)) {
      touched = true
      const { off: _off, ...rest } = piece
      void _off
      return rest as CyberPiece
    }
    return piece
  })
  return touched ? [writePieces(state, pc, pieces)] : []
}

// ---- 四個效果的選擇器 ----

interface Selector {
  slot?: string
  bp?: string
  uid?: string
}

function selectorProblems(raw: Record<string, unknown>, needOne: boolean): string[] {
  const p: string[] = []
  if (raw.slot !== undefined && !(isText(raw.slot) && SLOT_WORDS.includes(raw.slot))) p.push(`slot 要是部位的 id（${SLOT_WORDS.join('、')}）`)
  if (raw.bp !== undefined && !isText(raw.bp)) p.push('bp 要是設計圖的 id')
  if (raw.uid !== undefined && !isText(raw.uid)) p.push('uid 要是那一件義體的編號')
  if (needOne && raw.slot === undefined && raw.bp === undefined && raw.uid === undefined) p.push('slot、bp、uid 至少要寫一個（不然不知道是哪一件）')
  return p
}

/** 符合選擇器的義體，照部位的順序（同一個部位照身上的順序）。 */
export function select(pieces: readonly CyberPiece[], sel: Selector): CyberPiece[] {
  const hit = pieces.filter((p) =>
    (sel.uid === undefined || p.uid === sel.uid) && (sel.bp === undefined || p.bp === sel.bp) && (sel.slot === undefined || p.slot === sel.slot || baseSlot(p.slot) === sel.slot))
  return hit.map((p, i) => ({ p, i })).sort((a, b) => PART_IDS.indexOf(a.p.slot) - PART_IDS.indexOf(b.p.slot) || a.i - b.i).map((x) => x.p)
}

const actorOk = (ctx: EffectCtx): string[] => (ctx.state.actors[ctx.actor] ? [] : [`沒有 ${ctx.actor} 這個角色。`])

// ---- cyber_install：直接裝上一件 ----

interface InstallEffect extends Effect {
  blueprint: string
  parts?: Record<string, unknown>
  slot?: string
  side?: 'l' | 'r'
  lock?: Record<string, unknown>
  quirks?: string[]
}

interface InstallPlan {
  /** 落空的原因（寫給玩家看）；能裝是 undefined */
  failed?: string
  name: string
  changes: Change[]
  slot?: PartId
}

function planInstall(k: Kernel, state: GameState, actor: ActorId, e: InstallEffect): InstallPlan {
  const bp = k.content.get<BlueprintEntry>('blueprint', e.blueprint)
  if (!bp) return { failed: '找不到這張設計圖。', name: e.blueprint, changes: [] }
  const rules = cyberRules(k)
  const pieces = cyberOf(state, actor)
  const tryPart = (slot: PartId): boolean => pieces.filter((p) => p.slot === slot).length < rules.slots[slot]
  let slot: PartId | null = null
  if (e.slot !== undefined && isPartId(e.slot)) slot = e.slot
  else if (bp.slot === 'arm' || bp.slot === 'leg') {
    slot = partIdOf(bp.slot, e.side) ?? (['l', 'r'] as const).map((s) => partIdOf(bp.slot, s)!).find(tryPart) ?? partIdOf(bp.slot, 'l')
  } else slot = partIdOf(bp.slot)
  if (!slot) return { failed: `${bp.name}沒有可以裝的部位。`, name: bp.name, changes: [] }
  if (!tryPart(slot)) return { failed: `${PART_NAME[slot]}的槽已經滿了，${bp.name}沒有裝上。`, name: bp.name, changes: [], slot }
  if (bp.deck !== undefined && slot === 'brain' && brainDeck(k, state, actor)) return { failed: `${DECK_FULL}${bp.name}沒有裝上。`, name: bp.name, changes: [], slot }

  const uid = `pr${state.seq.uid + 1}`
  const data: ProductData = {
    uid, parts: (e.parts ? clone(e.parts) : clone(bp.stock ?? {})) as ProductData['parts'], state: 'new',
    ...(e.quirks && e.quirks.length > 0 ? { quirks: [...e.quirks] } : {}),
    ...(e.lock ? { lock: lockWritten(undefined, readLock(e.lock) ?? { kind: 'contract', owed: 0 }) } : {}),
  }
  const sink = pieceSink(k, state, bp.id, data, { via: 'clinic' })
  const piece: CyberPiece = { ...readProduct(data), uid, bp: bp.id, kind_of: 'blueprint', slot, sink, at: nowOf(state), registered: false }
  const changes: Change[] = [writePieces(state, actor, [...pieces, piece]), { op: 'uid', advance: 1 }]
  const patient = state.actors[actor]!
  const floor = floorWith(k, state, actor, sink)
  if (patient.sink < floor) changes.push({ op: 'actor.track', id: actor, track: 'sink', delta: floor - patient.sink })
  return { name: bp.name, changes, slot }
}

function installEffect(k: Kernel): void {
  k.effects.register<InstallEffect>({
    kind: INSTALL_EFFECT, owner: OWNER, ai: false,
    validate(raw, ctx) {
      const p = [...actorOk(ctx)]
      const id = raw.blueprint
      const bp = isText(id) ? k.content.get<BlueprintEntry>('blueprint', id) : undefined
      if (!isText(id)) p.push('blueprint 要是設計圖的 id')
      else if (!bp) p.push(`沒有 ${id} 這張設計圖。`)
      else if (bp.kind !== 'cyberware') p.push(`${bp.name}不是義體。`)
      else if (bp.slot === 'bridge') p.push('橋不能這樣裝，換橋是另一種手術。')
      if (raw.slot !== undefined && !(isText(raw.slot) && isPartId(raw.slot))) p.push(`slot 要是部位的 id（${PART_IDS.join('、')}）`)
      else if (isText(raw.slot) && bp && partIdOf(bp.slot, bp.slot === 'arm' || bp.slot === 'leg' ? (String(raw.slot).endsWith('_l') ? 'l' : 'r') : undefined) !== raw.slot) p.push('slot 對不上設計圖的部位。')
      if (raw.side !== undefined && raw.side !== 'l' && raw.side !== 'r') p.push('side 只能是 l 或 r')
      if (raw.lock !== undefined) p.push(...lockProblems(raw.lock))
      if (raw.quirks !== undefined) {
        if (!(Array.isArray(raw.quirks) && raw.quirks.every(isText))) p.push('quirks 要是 quirk 的 id 的陣列')
        else for (const q of raw.quirks as string[]) if (!(k.content.hasKind('quirk') && k.content.has('quirk', q))) p.push(`沒有 ${q} 這個 quirk。`)
      }
      if (raw.parts !== undefined) {
        if (!isRecord(raw.parts)) p.push('parts 要是 { 零件類型: 零件的 id }')
        else if (bp) {
          for (const [type, v] of Object.entries(raw.parts)) {
            for (const ref of Array.isArray(v) ? v : [v]) {
              if (!partOf(k.content, ref)) p.push(`parts.${type}：找不到這個零件。`)
              else p.push(...slotProblemsOf(k, bp, type, ref).map((m) => `parts.${type}：${m}`))
            }
          }
        }
      }
      return p
    },
    toChanges: (e, ctx) => planInstall(k, ctx.state, ctx.actor, e).changes,
    describe(e, ctx) {
      const plan = planInstall(k, ctx.state, ctx.actor, e)
      return plan.failed ?? `裝上了：${plan.name}（${PART_NAME[plan.slot!]}）`
    },
  })
}

const slotProblemsOf = (k: Kernel, bp: BlueprintEntry, type: string, ref: unknown): string[] => slotProblems(k.content, bp, type, ref).problems

// ---- cyber_take：拿走一件 ----

interface TakeEffect extends Effect, Selector {
  to?: 'gone' | 'bag'
}

interface TakePlan {
  name?: string
  changes: Change[]
  /** 拿走之後回到背包 */
  returned: boolean
}

function planTake(k: Kernel, state: GameState, actor: ActorId, e: TakeEffect): TakePlan {
  const pieces = cyberOf(state, actor)
  const piece = select(pieces.filter((p) => !isBridge(p)), e)[0]
  if (!piece) return { changes: [], returned: false }
  const changes: Change[] = [writePieces(state, actor, pieces.filter((p) => p.uid !== piece.uid))]
  let returned = false
  if (e.to === 'bag') {
    if (piece.kind_of === 'deck') {
      changes.push({ op: 'item', id: piece.bp, qty: 1, data: { uid: piece.uid } })
      returned = true
    } else {
      const info = productOf(k.content, piece.bp, piece)
      const kept = keptParts(k, piece, !info || info.allBio)
      if (kept !== null && kept.length > 0) {
        changes.push({ op: 'item', id: piece.bp, qty: 1, data: usedProduct(piece, kept) as unknown as Record<string, unknown> })
        returned = true
      }
    }
    if (piece.loaded && piece.loaded.qty > 0) changes.push({ op: 'item', id: piece.loaded.item, qty: piece.loaded.qty })
  }
  return { name: pieceName(k, piece), changes, returned }
}

function takeEffect(k: Kernel): void {
  k.effects.register<TakeEffect>({
    kind: TAKE_EFFECT, owner: OWNER, ai: false,
    validate(raw, ctx) {
      const p = [...actorOk(ctx), ...selectorProblems(raw, true)]
      if (raw.to !== undefined && raw.to !== 'gone' && raw.to !== 'bag') p.push('to 只能是 gone 或 bag')
      return p
    },
    toChanges: (e, ctx) => planTake(k, ctx.state, ctx.actor, e).changes,
    describe(e, ctx) {
      const plan = planTake(k, ctx.state, ctx.actor, e)
      if (!plan.name) return '身上沒有符合的義體可以拿走。'
      return plan.returned ? `被拆下來：${plan.name}（回到背包）` : `被拿走：${plan.name}`
    },
  })
}

// ---- cyber_lock：鎖住或解開 ----

interface LockEffect extends Effect, Selector {
  on: boolean
  hours?: number
  why?: string
}

interface LockPlan {
  names: string[]
  changes: Change[]
}

function planLock(k: Kernel, state: GameState, actor: ActorId, e: LockEffect): LockPlan {
  const pieces = cyberOf(state, actor)
  const why = e.why ?? LOCK_OFF
  const bare = e.slot === undefined && e.bp === undefined && e.uid === undefined
  // 不寫選擇器（帳單與契約的鎖）：鎖是照槽順序第一件非橋、還沒停著的；解開是所有因為同一個 why 停著的
  const hit = new Set((bare
    ? e.on ? select(pieces.filter((p) => !isBridge(p) && !p.off), {}).slice(0, 1) : pieces.filter((p) => p.off?.why === why)
    : select(pieces, e)).map((p) => p.uid))
  const names: string[] = []
  const next = pieces.map((p) => {
    if (!hit.has(p.uid)) return p
    if (e.on) {
      // 已經因為別的原因停著（壞了）的不蓋掉
      if (p.off && p.off.why !== why) return p
      names.push(pieceName(k, p))
      const until = e.hours !== undefined ? nowOf(state) + Math.round(e.hours * 60) : undefined
      return { ...p, off: { why, ...(until !== undefined ? { until } : {}) } }
    }
    if (p.off?.why !== why) return p
    names.push(pieceName(k, p))
    const { off: _off, ...rest } = p
    void _off
    return rest as CyberPiece
  })
  return { names, changes: names.length > 0 ? [writePieces(state, actor, next)] : [] }
}

function lockEffect(k: Kernel): void {
  k.effects.register<LockEffect>({
    kind: LOCK_EFFECT, owner: OWNER, ai: false,
    validate(raw, ctx) {
      const p = [...actorOk(ctx), ...selectorProblems(raw, false)]
      if (typeof raw.on !== 'boolean') p.push('on 要是布林值（true 是鎖住，false 是解開）')
      if (raw.hours !== undefined && !(typeof raw.hours === 'number' && Number.isFinite(raw.hours) && raw.hours > 0 && raw.hours <= 24 * 365)) p.push('hours 要是大於 0 的數字（小時）')
      if (raw.why !== undefined && !isText(raw.why)) p.push('why 要是一句短的原因代號')
      return p
    },
    toChanges: (e, ctx) => planLock(k, ctx.state, ctx.actor, e).changes,
    describe(e, ctx) {
      const plan = planLock(k, ctx.state, ctx.actor, e)
      if (plan.names.length === 0) return e.on ? '身上沒有符合的義體可以鎖。' : '身上沒有符合的鎖可以解開。'
      return e.on ? `被鎖住：${plan.names.join('、')}${e.hours !== undefined ? `（${e.hours} 小時）` : ''}` : `解開了：${plan.names.join('、')}`
    },
  })
}

// ---- cyber_unlock：把鎖整個拿掉（買斷、偽造授權成功） ----

interface UnlockEffect extends Effect, Selector {}

function planUnlock(k: Kernel, state: GameState, actor: ActorId, e: UnlockEffect): LockPlan {
  const pieces = cyberOf(state, actor)
  const hit = new Set(select(pieces, e).filter((p) => p.lock !== undefined || isLocked(p)).map((p) => p.uid))
  const names: string[] = []
  const next = pieces.map((p) => {
    if (!hit.has(p.uid)) return p
    names.push(pieceName(k, p))
    const { lock: _lock, ...rest } = p
    void _lock
    if (isLocked(rest)) delete (rest as { off?: unknown }).off
    return rest as CyberPiece
  })
  return { names, changes: names.length > 0 ? [writePieces(state, actor, next)] : [] }
}

function unlockEffect(k: Kernel): void {
  k.effects.register<UnlockEffect>({
    kind: UNLOCK_EFFECT, owner: OWNER, ai: false,
    validate(raw, ctx) {
      const p = [...actorOk(ctx), ...selectorProblems(raw, true)]
      return p
    },
    toChanges: (e, ctx) => planUnlock(k, ctx.state, ctx.actor, e).changes,
    describe(e, ctx) {
      const plan = planUnlock(k, ctx.state, ctx.actor, e)
      return plan.names.length > 0 ? `授權鎖拿掉了：${plan.names.join('、')}` : '身上沒有符合的授權鎖。'
    },
  })
}

/** 註冊四個效果。 */
export function installEffects(k: Kernel): void {
  installEffect(k)
  takeEffect(k)
  lockEffect(k)
  unlockEffect(k)
}

// ---- 掛點 ----

/** 掃橋讀到的義體（掛點 scan.person 的 cyber）：全生體的或每個零件都帶 scan_proof 的那幾件不列；不含橋。 */
export function scanAnswer(k: Kernel, state: GameState, actor: ActorId): { cyber: { count: number; items: Array<{ uid: string; name: string; legal: string; registered: boolean; item: string }> } } | undefined {
  const items: Array<{ uid: string; name: string; legal: string; registered: boolean; item: string }> = []
  for (const piece of cyberOf(state, actor)) {
    if (isBridge(piece)) continue
    if (piece.kind_of === 'deck') {
      const legal = (deckContentOf(k, piece.bp) as { legal?: unknown } | undefined)?.legal
      items.push({ uid: piece.uid, name: pieceName(k, piece), legal: (LEGALITIES as readonly unknown[]).includes(legal) ? (legal as string) : 'free', registered: piece.registered === true, item: piece.bp })
      continue
    }
    const info = productOf(k.content, piece.bp, piece)
    if (!info) continue
    if (info.parts.length > 0 && info.parts.every((p) => p.part.material === 'bio' || p.part.traits?.includes('scan_proof'))) continue
    items.push({ uid: piece.uid, name: info.bp.name, legal: info.legal, registered: piece.registered === true, item: piece.bp })
  }
  return items.length > 0 ? { cyber: { count: items.length, items } } : undefined
}

type AnyHook = (name: string, owner: string, fn: (payload: never) => unknown) => void

/** 掛上掛點：帳單、戰敗、掃橋（別的功能宣告的掛點用名字掛，沒有人問也不會壞）。 */
export function installLockHooks(k: Kernel): void {
  const on = k.hooks.on.bind(k.hooks) as unknown as AnyHook
  on('bill.collect', OWNER, (({ state }: { state: GameState }) => {
    const lines = subscriptionLines(k, state).map(({ uid: _uid, ...line }) => ({ ...line, owner: OWNER }))
    return lines.length > 0 ? lines : undefined
  }) as never)
  on('bill.settled', OWNER, (({ state, lines }: { state: GameState; lines: SettledLine[] }) => {
    const changes = subscriptionSettled(state, lines)
    return changes.length > 0 ? changes : undefined
  }) as never)
  on('defeat.gear', OWNER, (({ effect }: { effect: Effect }) => (GEAR_EFFECTS.includes(effect.kind) ? true : undefined)) as never)
  on('scan.person', OWNER, (({ state, actor }: { state: GameState; actor: ActorId }) => scanAnswer(k, state, actor)) as never)
}
