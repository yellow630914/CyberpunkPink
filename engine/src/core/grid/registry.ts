// L5 地圖：登錄表與「踩格子後的結算」。核心只管模型、位置、看過的格子與「走一步」；
// 站上一個標記會發生什麼（走進保全崗就開打、連接格換一張圖、資料埠、憑證、撤離點……）由功能註冊。
// 監視器、巡邏、門鎖的檢定（SITES 12.5 節）是 M2 的功能，掛在 pass 與 entered 上。

import type { BattleSetup } from '../battle/setup'
import type { Change, GameState, GridPos, ReportDraft } from '../types'
import type { Probe } from '../state/probe'
import type { RulesKernel } from '../rules/kernel'
import type { MarkerDef, Sheet, SpecialMapEntry } from './model'

export interface GridCtx {
  k: GridKernel
  state: GameState
  /** 現在這一張圖（已經套上這份實例改過的格子） */
  sheet: Sheet
  map: SpecialMapEntry
  /** 走到的位置 */
  at: GridPos
}

/** 站上一格之後要發生的事。 */
export interface GridEffect {
  /** 加進這一步的報告的變更 */
  changes?: Change[]
  /** 接著要提交的報告（開一場戰鬥、一件事件）。有這個的時候這一段路到這一格為止 */
  followUps?: ReportDraft[]
  /** 在這一格開打（走到敵人那一格就開打；COMBAT_SYSTEM 第 10 節）。這一段路到這一格為止；外殼提交完這一步之後照這份設定開戰 */
  battle?: BattleSetup
  /** 這一段路到這一格為止（不再往下走） */
  stop?: boolean
  /** 給玩家看的一句話（接在這一步的摘要後面） */
  line?: string
}

/** 站上帶某種標記的格子時呼叫。marker 是那一格的標記（遭遇點的 mark 是 '!'）。回傳 void 就是沒事。 */
export type MarkTrigger = (ctx: GridCtx, marker: MarkerDef) => GridEffect | void
/** 每走進一格都呼叫（監視器、巡邏、陷阱）。 */
export type EnterHook = (ctx: GridCtx) => GridEffect | void
/** 過不過得去（上鎖的門）：回傳 null 是放行；字串是擋住的原因（給玩家看的句子）。 */
export type PassRule = (ctx: GridCtx, x: number, y: number) => string | null

/** 這一格現在能做的事（畫面：走到上面立刻列出來，按 E 才做；UI 1.1 節）。 */
export interface GridUse {
  id: string
  name: string
  /** 做不到的原因；能做是 null */
  block: string | null
}
export type UseProvider = (ctx: GridCtx, marker: MarkerDef) => GridUse[]

export interface GridKernel extends RulesKernel {
  grid: GridRegistry
}

export class GridRegistry {
  private marks = new Map<string, Array<{ owner: string; fn: MarkTrigger }>>()
  private enters: Array<{ owner: string; fn: EnterHook }> = []
  private passes = new Map<string, Array<{ owner: string; fn: PassRule }>>()
  private uses: Array<{ owner: string; fn: UseProvider }> = []

  constructor(private probe: Probe) {}

  private reg(registry: string, id: string, owner: string): void {
    this.probe.emit('core/grid/registry', 'registry.register', { registry, id, owner })
  }

  /** 站上帶這個標記的格子時觸發（mark：E、T、D、C、G、S、K、X、$、&、!）。 */
  onMark(mark: string, owner: string, fn: MarkTrigger): void {
    this.marks.set(mark, [...(this.marks.get(mark) ?? []), { owner, fn }])
    this.reg('grid.marks', mark, owner)
  }

  markTriggers(mark: string): MarkTrigger[] {
    return (this.marks.get(mark) ?? []).map((x) => x.fn)
  }

  /** 每走進一格都觸發。 */
  onEnter(owner: string, fn: EnterHook): void {
    this.enters.push({ owner, fn })
    this.reg('grid.enter', owner, owner)
  }

  enterHooks(): EnterHook[] {
    return this.enters.map((x) => x.fn)
  }

  /** 某一種格子過不過得去（door_locked）。沒有人註冊的話，要條件的格子一律過不去。 */
  passRule(kind: string, owner: string, fn: PassRule): void {
    this.passes.set(kind, [...(this.passes.get(kind) ?? []), { owner, fn }])
    this.reg('grid.pass', kind, owner)
  }

  passRules(kind: string): PassRule[] {
    return (this.passes.get(kind) ?? []).map((x) => x.fn)
  }

  /** 站在一個標記上能做的事（拿、插上、偷、接管、打開、帶走）。 */
  usesOf(owner: string, fn: UseProvider): void {
    this.uses.push({ owner, fn })
    this.reg('grid.uses', owner, owner)
  }

  listUses(ctx: GridCtx, marker: MarkerDef): GridUse[] {
    return this.uses.flatMap((x) => x.fn(ctx, marker))
  }
}
