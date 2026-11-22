// L4 規則核心：效果的登錄表（EVENTS 2.4 節的封閉清單）。取代 ElondiaRPG 那個匯入 30 個功能模組的 effects.ts：
// 每個功能自己註冊效果種類。「封閉清單」就是這張表裡註冊過的種類：沒註冊的種類是格式錯誤。
//
// 一批效果（一件事、或一次行動的結算）走四步，效果自己不改狀態：
//   1. 驗格式（每一筆都驗；有一筆不合格，整批不收）
//   2. 合計的上限（EVENTS 2.4 節「每件」）：同一組的所有筆數加起來才比上限，拆成幾筆給也一樣；超過的從最後幾筆往回扣。
//      合計照每一筆寫的量算；如果照當下的狀態調整之後實際的淨變化仍然超出上限，那一組改成邊走邊算（任何時候都不超出）
//   3. 照順序一筆一筆：看當下的狀態夾值（已經包含前面幾筆的結果）→ 轉成變更 → 變更在一份複製的狀態上驗過、套上去
//   4. 呼叫的人接著要套的變更（ctx.tail，例如這次行動的時間）也在那份複製的狀態上驗一次
// 所以 resolve 回傳的 changes 一定套得上去：套用不會失敗（dev/invariants.md 第 16 條）。
//
// 夾到哪一級看「這一筆是誰要的」（AI_TASKS 2.5 節的表），resolve 算好放在 ctx.level：
//   builtin  內建的事件、世界編輯器做的內容：照寫的算（唯一的例外是拿到的錢，照區的等級）
//   floor    玩家明說要的、而且設定「玩家要求的結果也夾值」關著：只擋格式的底線（數值不溢位、物品一次最多 100 個、戰鬥外生命最少剩 1）
//   cap      AI 自己生成的，或設定開著時玩家要的：格式的底線加上數值上限與等級

import type { ActorId, Change, ClampNote, GameState, Grade } from '../types'
import type { ContentRegistry } from '../content/registry'
import type { ChangeRegistry } from '../state/changes'
import { ChangeError } from '../state/changes'
import type { Probe } from '../state/probe'
import { clone } from '../util/clone'
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

/** 這一筆夾到哪一級（見檔頭）。 */
export type EffectLevel = 'builtin' | 'floor' | 'cap'

export interface EffectCtx {
  state: GameState
  /** 效果落在誰身上（通常是主角） */
  actor: ActorId
  /** 主角所在那一區或要地的等級：物品的等級上限、內建事件的錢的上限用它 */
  grade: Grade
  /** 主角的街頭信譽那一階對應的委託等級（LIFE 1.3 節）：AI 給的錢的上限用它。沒給當 I 級 */
  repGrade?: Grade
  source: EffectSource
  /** 設定「玩家要求的結果也夾值」（預設開） */
  clampAsked: boolean
  /** 玩家這一回合的輸入原文；asked 要對得上它 */
  playerInput?: string
  /** 這件事標了 combat：hp、load、afterglow 不受「不會讓人倒下或瀕死」的限制（EVENTS 2.4 節） */
  combat?: boolean
  /** 這一批是一次行動的結算：判定已經花掉的時間與行動種類的時間上限（分鐘）。time 效果合計之後連同判定的時間受上限管 */
  action?: { minutes: number; maxMinutes: number }
  /** 呼叫的人接著要套在同一份報告裡的變更（例：這次行動的時間）。一起驗，保證整份報告套得上去 */
  tail?: Change[]
  content: ContentRegistry
}

/** 效果的每一步收到的：state 是「前面幾筆都套上去之後」的狀態，level 是這一筆夾到哪一級。 */
export interface EffectStepCtx extends EffectCtx {
  level: EffectLevel
}

/** 一件事合計的上限（EVENTS 2.4 節「每件」）。 */
export interface EffectBudget<E extends Effect = Effect> {
  /** 合計的分組：同一組的一起算。例：cred 與 cash 都是 money；敵對值每個勢力一組 */
  group: string
  /** 這一筆的量（有正負） */
  amount: number
  /** 這一組合計最少、最多到多少；不設限的那一邊給 ∓Infinity */
  min: number
  max: number
  /** 把這一筆的量改成 amount 之後的效果（amount 不會是 0：扣到 0 的整筆拿掉） */
  resize(amount: number): E
  /** 被扣減時給玩家看的白話提醒；to 是扣減之後的量（0 是整筆拿掉） */
  notice(to: number): string
}

export interface EffectDef<E extends Effect = Effect> {
  kind: string
  owner: string
  /** 格式：欄位、型別、引用的 id 存不存在。回傳錯誤訊息（空的就是合格）。內容底線也在這裡擋。數量要是安全整數（isSafeInt） */
  validate(raw: Record<string, unknown>, ctx: EffectCtx): string[]
  /** 一件事合計的上限：這一筆在這個情境下（看 ctx.level）要不要算進合計、上下限是多少。回傳 null 就是不算 */
  budget?(effect: E, ctx: EffectStepCtx): EffectBudget<E> | null
  /**
   * 看當下的狀態夾值：每一筆都會被呼叫（ctx.state 已經包含這一批前面幾筆的結果），自己看 ctx.level 決定夾哪幾條。
   * 回傳夾過的效果；effect 是 null 表示整筆拿掉。沒被夾就不用回傳 note。
   */
  clamp?(effect: E, ctx: EffectStepCtx): { effect: E | null; note?: Omit<ClampNote, 'path'> }
  toChanges(effect: E, ctx: EffectStepCtx): Change[]
  /** 定案的結果的一行白話（<results> 與報告卡用）：「拿到：現金 12」。不寫欄位名稱。寫的是實際發生的量 */
  describe(effect: E, ctx: EffectStepCtx): string
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

/** 這一筆要不要照上限夾。asked 對不上玩家輸入的，當成 AI 自己加的。 */
export function shouldClamp(effect: Effect, ctx: Pick<EffectCtx, 'source' | 'clampAsked' | 'playerInput'>): boolean {
  if (ctx.source === 'builtin') return false
  if (ctx.source === 'ai') return true
  if (ctx.clampAsked) return true
  return !askedMatches(effect.asked, ctx.playerInput)
}

/** 這一筆夾到哪一級：內建的照寫的算；免夾的只擋格式的底線；其餘照上限。 */
export function effectLevel(effect: Effect, ctx: Pick<EffectCtx, 'source' | 'clampAsked' | 'playerInput'>): EffectLevel {
  if (ctx.source === 'builtin') return 'builtin'
  return shouldClamp(effect, ctx) ? 'cap' : 'floor'
}

/** asked 那段字要真的出現在玩家這一回合的輸入裡（字串比對，忽略頭尾空白）。 */
export function askedMatches(asked: unknown, playerInput: string | undefined): boolean {
  if (typeof asked !== 'string' || !playerInput) return false
  const a = asked.trim()
  return a.length > 0 && playerInput.includes(a)
}

export class EffectRegistry {
  private defs = new Map<string, EffectDef>()

  constructor(private probe: Probe, private changes: ChangeRegistry) {}

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

  /** 驗格式、夾值、轉成變更（四步見檔頭）。有格式錯誤時 changes 是空的（整批不收）。不改 ctx.state。 */
  resolve(raw: unknown, ctx: EffectCtx, path = 'effects'): ResolvedEffects {
    const fail = (errors: string[]): ResolvedEffects => ({ effects: [], changes: [], lines: [], clamps: [], errors })
    const errors = this.validate(raw, ctx, path)
    if (errors.length) return fail(errors)
    const list = raw as Effect[]
    const levels = list.map((e) => effectLevel(e, ctx))
    const budgets = list.map((e, i) => {
      const b = this.defs.get(e.kind)!.budget?.(e, { ...ctx, level: levels[i]! })
      return b && b.amount !== 0 ? b : null
    })
    const groups = new Map<string, { members: number[]; min: number; max: number }>()
    budgets.forEach((b, i) => {
      if (!b) return
      const g = groups.get(b.group) ?? { members: [], min: -Infinity, max: Infinity }
      groups.set(b.group, { members: [...g.members, i], min: Math.max(g.min, b.min), max: Math.min(g.max, b.max) })
    })

    // 第 2 步：合計的上限。同一組的量加起來才比上限；超過的從最後幾筆往回扣（只扣同一個方向的）
    const planned: Array<Effect | null> = [...list]
    const planNotes = new Map<number, Omit<ClampNote, 'path'>>()
    for (const g of groups.values()) {
      const total = g.members.reduce((sum, i) => sum + budgets[i]!.amount, 0)
      let excess = total > g.max ? total - g.max : total < g.min ? total - g.min : 0
      for (let j = g.members.length - 1; j >= 0 && excess !== 0; j--) {
        const i = g.members[j]!, b = budgets[i]!
        if (Math.sign(b.amount) !== Math.sign(excess)) continue
        const cut = excess > 0 ? Math.min(b.amount, excess) : Math.max(b.amount, excess)
        const to = b.amount - cut
        excess -= cut
        planned[i] = to === 0 ? null : b.resize(to)
        planNotes.set(i, { from: b.amount, to, limit: cut > 0 ? g.max : g.min, notice: b.notice(to) })
      }
    }

    // 第 3 步：照順序，一筆一筆在複製的狀態上夾、轉、驗、套。
    // running 裡的組改成「邊走邊算」：每一筆套上去之後，這一組到目前為止實際的淨變化都不超出上下限（見下面的說明）。
    const pass = (running: ReadonlySet<string>): { out: ResolvedEffects; work: GameState; net: Map<string, number> } | { errors: string[] } => {
      const out: ResolvedEffects = { effects: [], changes: [], lines: [], clamps: [], errors: [] }
      const work = clone(ctx.state)
      const net = new Map<string, number>()
      for (let i = 0; i < list.length; i++) {
        const def = this.defs.get(list[i]!.kind)!
        const step: EffectStepCtx = { ...ctx, state: work, level: levels[i]! }
        const b = budgets[i]
        const g = b ? groups.get(b.group)! : null
        let effect: Effect | null
        let note: Omit<ClampNote, 'path'> | undefined
        if (b && g && running.has(b.group)) {
          const n = net.get(b.group) ?? 0
          const to = b.amount > 0 ? Math.max(0, Math.min(b.amount, g.max - n)) : Math.min(0, Math.max(b.amount, g.min - n))
          effect = to === 0 ? null : to === b.amount ? list[i]! : b.resize(to)
          if (to !== b.amount) note = { from: b.amount, to, limit: b.amount > 0 ? g.max : g.min, notice: b.notice(to) }
        } else {
          effect = planned[i] ?? null
          note = planNotes.get(i)
        }
        if (effect && def.clamp) {
          const r = def.clamp(effect, step)
          effect = r.effect
          // 一筆最多一則：from 是原本的值，to 是最後的值
          if (r.note) note = note ? { ...r.note, from: note.from } : r.note
        }
        if (note) out.clamps.push({ ...note, path: `${path}[${i}]` })
        if (!effect) continue
        // 這一筆實際算進合計的量（夾過、照當下的狀態調整過之後）
        if (b) net.set(b.group, (net.get(b.group) ?? 0) + (def.budget?.(effect, step)?.amount ?? 0))
        const changes = def.toChanges(effect, step)
        const line = def.describe(effect, step)
        try {
          this.changes.applyAll(work, changes)
        } catch (e) {
          if (!(e instanceof ChangeError)) throw e
          return { errors: e.problems.map((p) => `${path}[${i}]：${p}`) }
        }
        out.effects.push(effect)
        out.changes.push(...changes)
        out.lines.push(line)
      }
      return { out, work, net }
    }

    let done = pass(new Set())
    if ('errors' in done) return fail(done.errors)
    // 合計是照每一筆寫的量算的；照當下的狀態調整之後（例：要扣的錢比手上有的多，實際只扣得到手上有的），實際的淨變化可能超出上限：
    // 「扣一大筆（扣不到）再給一大筆」合計看起來沒超過，實際卻多拿。這種組改成邊走邊算再跑一次，實際的淨變化一定在上下限內。
    const { net } = done
    const over = new Set([...groups].filter(([id, g]) => (net.get(id) ?? 0) > g.max || (net.get(id) ?? 0) < g.min).map(([id]) => id))
    if (over.size) {
      done = pass(over)
      if ('errors' in done) return fail(done.errors)
    }
    const { out, work } = done

    // 第 4 步：接著要套的變更也驗一次
    if (ctx.tail?.length) {
      try {
        this.changes.applyAll(work, ctx.tail)
      } catch (e) {
        if (!(e instanceof ChangeError)) throw e
        return fail(e.problems.map((p) => `${path}：加上這次行動其餘的變更之後套不上去（${p}）`))
      }
    }
    this.probe.emit('core/rules/effects', 'effects.resolve', () => ({ raw, source: ctx.source, clampAsked: ctx.clampAsked, effects: out.effects, clamps: out.clamps }))
    return out
  }
}
