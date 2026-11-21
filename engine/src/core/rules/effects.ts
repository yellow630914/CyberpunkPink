// L4 規則核心：效果的登錄表（EVENTS 2.4 節的封閉清單）。取代 ElondiaRPG 那個匯入 30 個功能模組的 effects.ts：
// 每個功能自己註冊效果種類。「封閉清單」就是這張表裡註冊過的種類：沒註冊的種類是格式錯誤。
//
// 一個效果走三步：驗格式 → 夾值（看是誰要的，AI_TASKS 2.5 節）→ 轉成變更（交給報告）。效果自己不改狀態。

import type { ActorId, Change, ClampNote, GameState, Grade } from '../types'
import type { ContentRegistry } from '../content/registry'
import type { Probe } from '../state/probe'
import { isRecord } from '../util/sanitize'

export interface Effect {
  kind: string
  /** 玩家的原話：玩家明說要的那幾筆才附（AI_TASKS 2.5 節） */
  asked?: string
  [field: string]: unknown
}

/** 這個效果是誰要的，決定夾不夾（AI_TASKS 2.5 節的表）。 */
export type EffectSource =
  /** 內建的事件、世界編輯器做的內容：只擋格式錯誤，寫多少就是多少 */
  | 'builtin'
  /** AI 自己生成的：格式加上限 */
  | 'ai'
  /** 玩家主動要求的鏈（自由行動、「我要做別的」……）：看 clampAsked 與 asked */
  | 'player'

export interface EffectCtx {
  state: GameState
  /** 效果落在誰身上（通常是主角） */
  actor: ActorId
  /** 上限用的等級：主角所在那一區或要地的等級 */
  grade: Grade
  source: EffectSource
  /** 設定「玩家要求的結果也夾值」（預設開） */
  clampAsked: boolean
  /** 玩家這一回合的輸入原文；asked 要對得上它 */
  playerInput?: string
  content: ContentRegistry
}

export interface EffectDef<E extends Effect = Effect> {
  kind: string
  owner: string
  /** 格式：欄位、型別、引用的 id 存不存在。回傳錯誤訊息（空的就是合格）。內容底線也在這裡擋。 */
  validate(raw: Record<string, unknown>, ctx: EffectCtx): string[]
  /** 夾值：回傳夾過的效果；effect 是 null 表示整筆拿掉。沒被夾就不用回傳 note。只有該夾的時候才會被呼叫。 */
  clamp?(effect: E, ctx: EffectCtx): { effect: E | null; note?: Omit<ClampNote, 'path'> }
  toChanges(effect: E, ctx: EffectCtx): Change[]
  /** 定案的結果的一行白話（<results> 與報告卡用）：「拿到：現金 12」。不寫欄位名稱。 */
  describe(effect: E, ctx: EffectCtx): string
}

export interface ResolvedEffects {
  /** 驗過、夾過的效果 */
  effects: Effect[]
  changes: Change[]
  /** 定案的結果，一行一筆，和 effects 一一對應 */
  lines: string[]
  clamps: ClampNote[]
  /** 格式錯誤：有任何一筆，整批算驗證不過（這一步失敗） */
  errors: string[]
}

/** 這一筆要不要夾。asked 對不上玩家輸入的，當成 AI 自己加的。 */
export function shouldClamp(effect: Effect, ctx: Pick<EffectCtx, 'source' | 'clampAsked' | 'playerInput'>): boolean {
  if (ctx.source === 'builtin') return false
  if (ctx.source === 'ai') return true
  if (ctx.clampAsked) return true
  return !askedMatches(effect.asked, ctx.playerInput)
}

/** asked 那段字要真的出現在玩家這一回合的輸入裡（字串比對，忽略頭尾空白）。 */
export function askedMatches(asked: unknown, playerInput: string | undefined): boolean {
  if (typeof asked !== 'string' || !playerInput) return false
  const a = asked.trim()
  return a.length > 0 && playerInput.includes(a)
}

export class EffectRegistry {
  private defs = new Map<string, EffectDef>()

  constructor(private probe: Probe) {}

  register<E extends Effect>(def: EffectDef<E>): void {
    if (this.defs.has(def.kind)) throw new Error(`效果種類重複註冊：${def.kind}（已經由 ${this.defs.get(def.kind)!.owner} 註冊）`)
    this.defs.set(def.kind, def as unknown as EffectDef)
    this.probe.emit('core/rules/effects', 'registry.register', { registry: 'effects', id: def.kind, owner: def.owner })
  }

  has(kind: string): boolean {
    return this.defs.has(kind)
  }

  kinds(): string[] {
    return [...this.defs.keys()]
  }

  /** 只驗格式（內容載入時檢查事件的 effects 用）。 */
  validate(raw: unknown, ctx: EffectCtx, path = 'effects'): string[] {
    if (!Array.isArray(raw)) return [`${path}：要是一個陣列`]
    return raw.flatMap((e, i) => this.validateOne(e, ctx, `${path}[${i}]`))
  }

  private validateOne(e: unknown, ctx: EffectCtx, at: string): string[] {
    if (!isRecord(e)) return [`${at}：要是一個物件`]
    const def = typeof e.kind === 'string' ? this.defs.get(e.kind) : undefined
    if (!def) return [`${at}.kind：${JSON.stringify(e.kind)} 不在封閉清單裡（可以用的：${this.kinds().join('、')}）`]
    if (e.asked !== undefined && typeof e.asked !== 'string') return [`${at}.asked：要是玩家輸入裡的一段字`]
    return def.validate(e, ctx).map((p) => `${at}：${p}`)
  }

  /** 驗格式、夾值、轉成變更。有格式錯誤時 changes 是空的（整批不收）。 */
  resolve(raw: unknown, ctx: EffectCtx, path = 'effects'): ResolvedEffects {
    const out: ResolvedEffects = { effects: [], changes: [], lines: [], clamps: [], errors: this.validate(raw, ctx, path) }
    if (out.errors.length) return out
    ;(raw as Effect[]).forEach((e0, i) => {
      const def = this.defs.get(e0.kind)!
      let effect: Effect | null = e0
      if (def.clamp && shouldClamp(e0, ctx)) {
        const r = def.clamp(e0, ctx)
        effect = r.effect
        if (r.note) out.clamps.push({ ...r.note, path: `${path}[${i}]` })
      }
      if (!effect) return
      out.effects.push(effect)
      out.changes.push(...def.toChanges(effect, ctx))
      out.lines.push(def.describe(effect, ctx))
    })
    this.probe.emit('core/rules/effects', 'effects.resolve', () => ({ raw, source: ctx.source, clampAsked: ctx.clampAsked, effects: out.effects, clamps: out.clamps }))
    return out
  }
}
