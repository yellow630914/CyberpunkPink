// L6 功能 cyberware 的橋（CYBERWARE 第 7 節；CRAFTING 第 7 節、8.7 節；CORE_RULES 6.4 節；TRADE 3.4 節換橋那一列；dev/adr/0019 第三節與 P7、P8、P15；dev/work/M4-cyber-bridge.md）。
//
// 橋是 slot 'bridge' 的一件義體（一個人一座）。這個檔管：
//   容量（P8）  晶片給總量、軟體給四類的份數、神經元之類的零件給親和；算成衍生數值 bridge_cap_meat／net／social／media（沒有橋是 0），abilities 讀它們。
//   換橋        一次手術拆舊的、裝新的（中間不經過「沒有橋」）；從沒有橋到有橋（ext.bridge 是 null）是同一個入口，沒有舊橋的那一座不加倍收費、也沒有暫時的沉溺。
// 四項橋參數（actor.ext.bridge）歸 lewd：這裡只在「沒有橋 → 有橋」時整個鍵寫成預設值（lewd_rule 的 default_bridge，查不到用 30），其餘時候不碰。
// 橋的機能（耐受 +15、RAM +2、換配置半小時、同步檔位上限 +1、敏感度 −15……）是設計圖或零件的 effects，由 passive.ts 的被動效果來源 cyber 給；這裡不寫程式。
//
// 休養：橋本身休養中照樣生效（容量一直算，不然整段時間沒有技能），只有機能的 effects 等好了才算（passive.ts 的 isActive）。被授權鎖鎖住的橋容量照算（授權鎖那一張再定）。

import type { ActorId, ContentEntry, GameState, Kernel, ProductData, ReportDraft, TimelineBeat } from '../../core'
import { ActionBlocked, AFFINITY_KEYS, blueprintOf, clone, deriveRng, effectCtx, productOf, productPrice, readProduct, stackOf } from '../../core'
import type { Change, QuirkEntry } from '../../core'
import type { CyberPiece, PartId, SurgeonKind } from './model'
import { EXT, PART_NAME, RECOVERING, SURGEON_NAME, cyberExtValue, cyberOf, cyberRules, isBridge, isSurgeonKind, nowOf } from './model'
import type { Pool } from './surgery'
import { complicationPool, floorWith, keptParts, latestReady, missingText, moneyProblem, payPool, pieceSink, surgeonBlock, usedProduct } from './surgery'

export const BRIDGE_ACTION = 'cyber.bridge'
/** 效果 sink_floor（M4-sink 註冊）：暫時的下限加減，amount 與 days */
export const SINK_FLOOR_EFFECT = 'sink_floor'
/** 內容種類 lewd_rule（features/lewd；這裡只認名字與欄位，不 import） */
const LEWD_RULE_KIND = 'lewd_rule'
const DEFAULT_BRIDGE_FALLBACK = 30

/** 四類技能容量（AFFINITY_KEYS 的順序就是補點與扣點時一樣大的先後）。 */
export const BRIDGE_CATS = AFFINITY_KEYS
export type BridgeCat = (typeof BRIDGE_CATS)[number]
/** 衍生數值的 id：bridge_cap_meat、bridge_cap_net、bridge_cap_social、bridge_cap_media */
export const capStatId = (cat: BridgeCat): string => `bridge_cap_${cat}`

/** 一類容量是怎麼來的：照軟體的份數分到的（share）、補到下限或被扣掉的（floor，正的是補、負的是被扣）、零件的親和（affinity）；容量＝三者的合計。 */
export interface CapacityPart {
  share: number
  floor: number
  affinity: number
}

export interface BridgeCapacity {
  /** 四類合計 */
  total: number
  /** 每一類的容量（沒有橋是 0） */
  split: Record<BridgeCat, number>
  /** 每一類的組成 */
  from: Record<BridgeCat, CapacityPart>
  /** 晶片的總量（沒有橋或沒有晶片是 0） */
  chip: number
}

const zeroCap = (): BridgeCapacity => {
  const zero = { share: 0, floor: 0, affinity: 0 }
  return {
    total: 0, chip: 0,
    split: { meat: 0, net: 0, social: 0, media: 0 },
    from: { meat: { ...zero }, net: { ...zero }, social: { ...zero }, media: { ...zero } },
  }
}

const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v)

/**
 * 一件橋的容量（P8；工單 M4-cyber-bridge 第 1 條）：
 *   晶片（好幾個時取 bridge.capacity 最高的）給總量 T；軟體的 bridge.split 給四類的份數（好幾套就逐類相加；沒有軟體或份數全是 0 當四類等分）。
 *   照份數分、無條件捨去，剩下的點數照小數部分由大到小補（一樣大照 meat、net、social、media 的順序）；
 *   任何一類不到 cap_min 的補到 cap_min，差額從目前最多的那一類扣（一次一點；扣到它也只剩 cap_min 就換次多的；全都只剩 cap_min 就不再扣）；
 *   最後每一類加上所有零件 affinity 那一類的值（不再夾）。
 */
export function capacityOfProduct(k: Pick<Kernel, 'content'>, bpId: string, data: unknown, capMin: number): BridgeCapacity {
  const info = productOf(k.content, bpId, data)
  if (!info) return zeroCap()
  let chip = 0
  let any = false
  const weights: Record<BridgeCat, number> = { meat: 0, net: 0, social: 0, media: 0 }
  for (const { part } of info.parts) {
    const c = part.bridge?.capacity
    if (isNum(c)) {
      chip = any ? Math.max(chip, c) : c
      any = true
    }
    const split = part.bridge?.split
    if (split) for (const cat of BRIDGE_CATS) if (isNum(split[cat]) && split[cat]! > 0) weights[cat] += split[cat]!
  }
  const total = Math.max(0, Math.floor(chip))
  let sum = BRIDGE_CATS.reduce((n, c) => n + weights[c], 0)
  if (sum <= 0) {
    for (const c of BRIDGE_CATS) weights[c] = 1
    sum = BRIDGE_CATS.length
  }
  // 照份數分、無條件捨去；餘數用整數算（total × 份數 mod 份數合計），一樣大照四類的順序
  const share: Record<BridgeCat, number> = { meat: 0, net: 0, social: 0, media: 0 }
  const rest: Array<{ cat: BridgeCat; frac: number; order: number }> = []
  BRIDGE_CATS.forEach((cat, order) => {
    share[cat] = Math.floor((total * weights[cat]) / sum)
    rest.push({ cat, frac: (total * weights[cat]) % sum, order })
  })
  let left = total - BRIDGE_CATS.reduce((n, c) => n + share[c], 0)
  for (const r of [...rest].sort((a, b) => b.frac - a.frac || a.order - b.order)) {
    if (left <= 0) break
    share[r.cat] += 1
    left -= 1
  }
  // 補到下限，從最多的那一類扣
  const level: Record<BridgeCat, number> = { ...share }
  for (const cat of BRIDGE_CATS) {
    while (level[cat] < capMin) {
      const donor = BRIDGE_CATS.reduce<BridgeCat | null>((best, c) => (c !== cat && level[c] > capMin && (best === null || level[c] > level[best]) ? c : best), null)
      level[cat] += 1
      if (donor) level[donor] -= 1
      else break
    }
  }
  const out = zeroCap()
  out.chip = total
  for (const cat of BRIDGE_CATS) {
    const affinity = isNum(info.affinity[cat]) ? info.affinity[cat]! : 0
    out.from[cat] = { share: share[cat], floor: level[cat] - share[cat], affinity }
    out.split[cat] = level[cat] + affinity
  }
  out.total = BRIDGE_CATS.reduce((n, c) => n + out.split[c], 0)
  return out
}

/** 身上那一座橋（沒有是 undefined）。 */
export const bridgeOf = (state: Pick<GameState, 'actors'>, actor: ActorId): CyberPiece | undefined => cyberOf(state, actor).find(isBridge)

/** 這個人現在的橋的容量：沒有橋是全 0；休養中、被鎖的橋照算。 */
export function bridgeCapacityOf(k: Pick<Kernel, 'content'>, state: Pick<GameState, 'actors'>, actor: ActorId): BridgeCapacity {
  const piece = bridgeOf(state, actor)
  if (!piece) return zeroCap()
  return capacityOfProduct(k, piece.bp, piece, cyberRules(k).cap_min)
}

// ---- 換橋 ----

export interface BridgeOpts {
  /** 被動刀的人 */
  actor: ActorId
  /** 背包裡那一座新橋的 uid */
  uid: string
  /** 誰動刀：clinic、unlicensed、black（橋這種大手術不能自己動刀） */
  via: SurgeonKind
  /** 動刀的人（只影響沉溺成本的手術刀加減；預設是被動刀的人） */
  by?: ActorId
  pay?: Pool
  /** 舊的那一座回到背包（二手）；不寫就沒有了 */
  keep?: boolean
}

export interface BridgeQuote {
  uid: string
  bp: string
  name: string
  grade: number
  via: SurgeonKind
  /** 新橋的目錄價 */
  price: number
  /** 這一種人動刀的安裝費（成品價 × 費率） */
  install_fee: number
  /** 實收：有舊橋是安裝費 × bridge_fee_mult，第一座就是安裝費 */
  fee: number
  pay: Pool | null
  /** 新橋的沉溺成本 */
  sink: number
  minutes: number
  /** 裝好之後休養多久（橋本身照樣生效，只有機能的 effects 要等） */
  recovery_minutes: number
  complication: number
  registered: boolean
  /** 被換掉的舊橋；第一座是 null */
  replaces: { uid: string; bp: string; name: string; sink: number } | null
  /** 這一次另外加的暫時沉溺；沒有舊橋、或沒有人註冊 sink_floor 效果是 null */
  temp_sink: { amount: number; days: number } | null
  /** 舊橋回到背包（keep 且不是全生體） */
  keeps: boolean
  /** 換之前與換之後的容量（畫面列「換橋會變成多少」） */
  before: BridgeCapacity
  after: BridgeCapacity
}

interface BridgePlan {
  problems: string[]
  quote: BridgeQuote | null
  old?: CyberPiece
}

function planBridge(k: Kernel, state: GameState, o: BridgeOpts): BridgePlan {
  const problems: string[] = []
  const rules = cyberRules(k)
  const by = o.by ?? o.actor
  if (!state.actors[o.actor]) return { problems: ['找不到這個角色。'], quote: null }
  if (!isSurgeonKind(o.via)) return { problems: ['要說是誰動刀。'], quote: null }
  const act = k.activity.blockOf(state, `commit:${BRIDGE_ACTION}`)
  if (act) problems.push(act)
  const stack = stackOf(state, o.uid)
  if (!stack) return { problems: [...problems, '背包裡沒有這一件。'], quote: null }
  const bp = blueprintOf(k.content, stack)
  if (!bp) return { problems: [...problems, '這不是能裝的義體。'], quote: null }
  if (bp.kind !== 'cyberware') return { problems: [...problems, `${bp.name}不是義體。`], quote: null }
  if (!isBridge(bp.slot)) return { problems: [...problems, `${bp.name}不是橋。`], quote: null }
  const info = productOf(k.content, stack.id, stack.data)!
  const old = bridgeOf(state, o.actor)

  if (cyberOf(state, o.actor).some((p) => p.uid === o.uid)) problems.push(`${bp.name}已經裝在身上了。`)
  if (info.missing.length > 0) problems.push(`缺零件：${missingText(info.missing)}。`)
  if (old?.off?.why === 'lock') problems.push('舊橋有授權鎖，要先解鎖。')
  if (o.via === 'self') problems.push('橋是大手術，只有診所做得了。')
  else {
    const sb = surgeonBlock(k, state, o.via, o.actor, by, rules)
    if (sb) problems.push(sb)
  }

  const price = productPrice(k.content, stack.id, stack.data)
  const installFee = Math.round(price * rules.surgeons[o.via].fee + 1e-9)
  const fee = old ? Math.round(installFee * rules.bridge_fee_mult + 1e-9) : installFee
  const mp = moneyProblem(state, fee, o.pay, '手術費')
  if (mp) problems.push(mp)

  const temp = old && k.effects.has(SINK_FLOOR_EFFECT) && rules.bridge_swap_sink.amount > 0 ? { ...rules.bridge_swap_sink } : null
  const oldInfo = old ? productOf(k.content, old.bp, old) : undefined
  const quote: BridgeQuote = {
    uid: o.uid, bp: stack.id, name: bp.name, grade: bp.grade, via: o.via, price, install_fee: installFee, fee, pay: payPool(state.money, fee, o.pay),
    sink: pieceSink(k, state, stack.id, stack.data, { via: o.via, by }), minutes: rules.surgery_minutes,
    recovery_minutes: rules.bridge_recovery_minutes, complication: o.via === 'self' ? 0 : rules.surgeons[o.via].complication, registered: o.via === 'clinic',
    replaces: old ? { uid: old.uid, bp: old.bp, name: k.content.get<{ id: string; name?: string }>('blueprint', old.bp)?.name ?? old.bp, sink: old.sink } : null,
    temp_sink: temp,
    keeps: !!old && o.keep === true && !!oldInfo && !oldInfo.allBio,
    before: bridgeCapacityOf(k, state, o.actor),
    after: capacityOfProduct(k, stack.id, stack.data, rules.cap_min),
  }
  return { problems, quote, ...(old ? { old } : {}) }
}

/** 換橋（或裝第一座橋）現在行不行：全部的原因（一條一句）；行是空陣列。 */
export const swapBridgeProblems = (k: Kernel, state: GameState, o: BridgeOpts): string[] => planBridge(k, state, o).problems
/** 第一條原因；行是 null。 */
export const swapBridgeBlock = (k: Kernel, state: GameState, o: BridgeOpts): string | null => planBridge(k, state, o).problems[0] ?? null
/** 這一次換橋的報價；背包裡找不到那一座、或那不是橋是 null。 */
export const bridgeQuote = (k: Kernel, state: GameState, o: BridgeOpts): BridgeQuote | null => planBridge(k, state, o).quote

/** 沒有橋的人（ext.bridge 明寫 null）裝第一座橋時，整個鍵寫成四項都是規則的預設值（lewd_rule 的 default_bridge，查不到用 30）。 */
function defaultBridgeParams(k: Pick<Kernel, 'content'>): Record<'sensitivity' | 'tolerance' | 'craving' | 'docility', number> {
  const e = k.content.hasKind(LEWD_RULE_KIND) ? k.content.get<ContentEntry & { default_bridge?: unknown }>(LEWD_RULE_KIND, 'default') : undefined
  const v = e && Number.isInteger(e.default_bridge) && (e.default_bridge as number) >= 0 && (e.default_bridge as number) <= 100 ? (e.default_bridge as number) : DEFAULT_BRIDGE_FALLBACK
  return { sensitivity: v, tolerance: v, craving: v, docility: v }
}

/**
 * 換橋：一次手術拆舊的、裝新的；身上沒有橋的人就是裝第一座。不成立丟 ActionBlocked（swapBridgeProblems 的第一條）。
 * 費用是安裝費 × bridge_fee_mult（第一座不加倍）；休養 bridge_recovery_minutes（橋本身照樣生效，機能的 effects 等好了才算）；沉溺成本照新的那一座（下限跟著換）；
 * 有舊橋時另外給一筆暫時的沉溺（效果 sink_floor 的 amount、days；沒有人註冊就略過）。舊橋 keep 時回到背包（二手），否則沒有了。
 * ext.bridge 的四項參數不變，只有「沒有橋 → 有橋」時整個鍵寫成預設值。裝著的技能超過新容量時不自動卸，結果的句子提醒一次。報告 cyber.bridge。
 */
export function swapBridgeDraft(k: Kernel, state: GameState, o: BridgeOpts): ReportDraft {
  const plan = planBridge(k, state, o)
  if (plan.problems.length > 0 || !plan.quote) throw new ActionBlocked(plan.problems[0] ?? '現在換不了橋。')
  const q = plan.quote
  const old = plan.old
  const stack = stackOf(state, o.uid)!
  const bp = blueprintOf(k.content, stack)!
  const patient = state.actors[o.actor]!
  const nowAt = nowOf(state) + q.minutes
  const ready = q.recovery_minutes > 0 ? nowAt + q.recovery_minutes : undefined

  // 併發症：診所不留；無照與黑診所照機率（和 installDraft 同一種抽法）
  let rolled = false
  let complication = false
  if (q.complication > 0) {
    rolled = true
    complication = deriveRng(state.rng, `${BRIDGE_ACTION}/${q.uid}/complication`).chance(q.complication)
  }
  const base: ProductData = readProduct(stack.data, k.content)
  const parts = Object.keys(base.parts).length > 0 ? base.parts : clone(bp.stock ?? {})
  const quirks = [...(base.quirks ?? [])]
  let quirkName: string | undefined
  if (complication) {
    const pool = complicationPool(k).filter((x: QuirkEntry) => !quirks.includes(x.id))
    if (pool.length > 0) {
      const pick = deriveRng(state.rng, `${BRIDGE_ACTION}/${q.uid}/quirk`).pick(pool)
      quirks.push(pick.id)
      quirkName = pick.name
    }
  }
  const piece: CyberPiece = {
    ...base, uid: q.uid, parts, ...(quirks.length > 0 ? { quirks } : {}),
    bp: q.bp, slot: 'bridge' as PartId, sink: q.sink, at: nowAt, ...(ready !== undefined ? { ready_at: ready } : {}), registered: q.registered,
  }
  const others = cyberOf(state, o.actor).filter((p) => p.uid !== old?.uid)
  const pieces = [...others, piece]
  // 下限：現在的下限換掉舊橋的成本、加上新橋的成本
  const floor = floorWith(k, state, o.actor, q.sink - (old?.sink ?? 0))

  const changes: Change[] = [{ op: 'item', id: q.bp, qty: -1, data: { uid: q.uid } }]
  if (q.fee > 0) changes.push({ op: q.pay!, delta: -q.fee })
  changes.push({ op: 'time', minutes: q.minutes }, { op: 'actor.ext', id: o.actor, key: EXT, value: cyberExtValue(state, o.actor, pieces) })
  if (ready !== undefined) changes.push({ op: 'actor.condition', id: o.actor, condition: RECOVERING, until: Math.max(latestReady(pieces), ready) })
  if (patient.sink < floor) changes.push({ op: 'actor.track', id: o.actor, track: 'sink', delta: floor - patient.sink })
  const firstBridge = patient.ext.bridge === null
  if (firstBridge) changes.push({ op: 'actor.ext', id: o.actor, key: 'bridge', value: defaultBridgeParams(k) })

  const who = `${patient.name}在${SURGEON_NAME[q.via]}動了手術`
  const lines: string[] = []
  let returned = false
  if (old) {
    lines.push(`${who}，${q.replaces!.name}從${PART_NAME.bridge}拆了下來，換上${bp.name}。`)
    if (q.keeps) {
      const oldInfo = productOf(k.content, old.bp, old)
      const kept = keptParts(k, old, !oldInfo || oldInfo.allBio)
      if (kept && kept.length > 0) {
        changes.push({ op: 'item', id: old.bp, qty: 1, data: usedProduct(old, kept) as unknown as Record<string, unknown> })
        returned = true
        lines.push('舊橋回到了背包，變成二手貨。')
      }
    } else {
      lines.push('舊橋沒有留下來。')
    }
  } else {
    lines.push(`${who}，${bp.name}裝進了${PART_NAME.bridge}。`)
  }
  if (ready !== undefined) lines.push('新橋還要養一陣子，橋本身已經能用，只是它帶的機能要等一等才生效。')
  if (complication) lines.push(quirkName ? `手術留下了併發症：${quirkName}。` : '手術不算乾淨，留下了一點後遺症。')
  if (old && BRIDGE_CATS.some((c) => q.after.split[c] < q.before.split[c])) lines.push('有幾類的容量比舊橋小：裝著的技能不會自動卸下，超過的要自己整理。')
  if (floor > 0 && patient.sink < floor) lines.push('身上的義體把沉溺墊高了。')
  if (firstBridge) lines.push('神經終於有了接口，橋的參數有了起點。')

  // 暫時的沉溺：效果 sink_floor（M4-sink 註冊；沒有人註冊就略過）
  const extra: string[] = []
  if (q.temp_sink) {
    const ctx = effectCtx(k, state, { source: 'builtin', actor: o.actor })
    const fx = [{ kind: SINK_FLOOR_EFFECT, amount: q.temp_sink.amount, days: q.temp_sink.days }]
    if (k.effects.validate(fx, ctx).length === 0) {
      const res = k.effects.resolve(fx, ctx)
      if (res.errors.length === 0) {
        changes.push(...res.changes)
        extra.push(...res.lines)
      }
    }
  }
  if (rolled) changes.push({ op: 'rng', advance: 1 })

  const data: Record<string, unknown> = {
    uid: q.uid, bp: q.bp, via: q.via, fee: q.fee, sink: q.sink, at: nowAt, ...(ready !== undefined ? { ready_at: ready } : {}),
    replaced: old?.uid ?? null, returned, first: firstBridge, complication: quirkName ?? null,
    capacity: { ...q.after.split }, total: q.after.total,
  }
  const beats: TimelineBeat[] = [{ layer: 'meat', actor: o.actor, text: lines[0]!, tag: BRIDGE_ACTION, data }]
  for (const text of [...lines.slice(1), ...extra]) beats.push({ layer: 'meat', actor: o.actor, text, tag: 'cyber.note' })
  return {
    kind: 'action', action: BRIDGE_ACTION, location: clone(state.location), actor: o.actor, party: [], timeline: beats, changes,
    outcome: { result: complication ? 'complication' : old ? 'swapped' : 'installed', summary: lines.join('') },
    narration: { results: lines },
  }
}
