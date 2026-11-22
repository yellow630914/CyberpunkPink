// L5 戰鬥：登錄表。核心只有引擎（站位、遮蔽、回合、命中與傷害的流程、感載與過載、狀態、敵人 AI 的骨架）；
// 「有哪些行動、每個行動做什麼」由功能註冊：現實戰鬥註冊射擊、近戰、換彈、監視、制伏……，內海戰鬥（M3）註冊它自己的那一組，
// 技能的功能把每個主動技能註冊成一個行動。功能之間不直接 import，都接在這張表上。dev/adr/0010。

import type { ActorId, BattleInput, BattleSide, BattleState, BattleTarget, BattleUnit, BattleWeapon, Change, GameState, RollPart } from '../types'
import type { Probe } from '../state/probe'
import type { RulesKernel } from '../rules/kernel'
import type { BattleMode, BattleNumbers, ModKind } from './rules'
import type { BattleRun } from './run'

/** 行動圓環的哪一圈（COMBAT_SYSTEM 第 10 節）：中心是技能，內環攻擊，中環補充與切換，外環戰術；system 是圓環外面那一列（結束回合、脫離、投降）。 */
export type BattleActionGroup = 'attack' | 'supply' | 'tactic' | 'skill' | 'system'
/** 這個行動要選什麼目標。 */
export type BattleTargetKind = 'none' | 'foe' | 'ally' | 'unit' | 'foe_slot' | 'ally_slot' | 'overlay' | 'node'

/** 唯讀地看一場戰鬥：行動的條件、畫面的提示、AI 的打分都拿到這個（實際上是一個 BattleRun；這裡只列不改狀態的那幾樣）。 */
export interface BattleView {
  k: BattleKernel
  state: GameState
  battle: BattleState
  /** 這個戰場與它的數字 */
  mode: BattleMode
  n: BattleNumbers
  /** 命中率（%），夾在 5～95；不擲骰 */
  hitChance(attacker: BattleUnit, target: BattleUnit, weapon?: BattleWeapon, opts?: import('./run').AttackOpts): number
  /** 一個數字的所有加減（狀態、餘韻、重傷、功能註冊的修正） */
  mods(kind: ModKind, unit: BattleUnit, other?: BattleUnit, weapon?: BattleWeapon, tags?: string[]): RollPart[]
  /** 帶著「不能換位」的狀態嗎 */
  cannotMove(unit: BattleUnit): boolean
  /** 行動點與其他的池夠不夠 */
  canAfford(unit: BattleUnit, cost: { ap?: number; [pool: string]: number | undefined }): boolean
}

/** 一個可以選的目標，以及現在選不了的原因（一條一條列；空的就是可以選）。 */
export interface BattleTargetOption {
  target: BattleTarget
  blocks: string[]
  /** 給畫面的提示（命中率、距離……） */
  hint?: Record<string, unknown>
}

export interface BattleActionDef {
  id: string
  owner: string
  /** 給玩家看的名字 */
  name: string
  /** 泡泡訊息裡的說明（完整的句子） */
  desc: string
  group: BattleActionGroup
  /** 圖示的名字（畫面自己對照） */
  icon?: string
  /** 哪些戰場可以用；沒寫就是每一個戰場 */
  modes?: string[]
  target: BattleTargetKind
  /** 圓環上排第幾個（同一圈裡小的在前）；數字鍵照這個順序 */
  order?: number
  /** 長按才生效（脫離、投降） */
  hold?: boolean
  /** 這個單位有沒有這個行動：技能沒學、沒有那種裝備就沒有，圓環上不列。沒寫就是每個人都有 */
  has?(view: BattleView, unit: BattleUnit): boolean
  /** 花費：行動點與其他的池（ram）。可以看當下的狀態（狙擊槍的一槍 3 點） */
  cost(view: BattleView, unit: BattleUnit, input?: BattleInput): { ap: number; [pool: string]: number }
  /**
   * 現在做不到的原因，一條一條列（每一條是給玩家看的完整句子，寫出缺的是哪個條件）。空的就是做得到。
   * 不看目標；行動點夠不夠、是不是輪到他、戰鬥結束了沒有，由核心檢查。
   */
  blocks?(view: BattleView, unit: BattleUnit): string[]
  /** 可以選的目標。每一個可以附現在選不了的原因：灰掉但看得到，泡泡寫出原因 */
  targets?(view: BattleView, unit: BattleUnit): BattleTargetOption[]
  /** 做這個行動。行動點與其他的池已經由核心扣好；彈匣這類的由行動自己扣 */
  run(run: BattleRun, unit: BattleUnit, target: BattleTarget | null, input: BattleInput): void
  /**
   * 當成反應自動做一次（監視觸發時）：不花行動點。做不到（彈匣空了、打不到）回傳 false，繼續等。
   * 有這個函式的行動才能當監視的動作。
   */
  auto?(run: BattleRun, unit: BattleUnit, target: BattleUnit): boolean
  /**
   * 敵人 AI 的打分（ENEMIES 4.3 節）：回傳 null 就是現在不列。target 是 AI 已經挑好的目標（不用選目標的行動是 null）。
   * 沒有這個函式的行動 AI 不會用。
   */
  aiScore?(view: BattleView, unit: BattleUnit, target: BattleUnit | null): number | null
  /** AI 用這個行動時的目標；沒寫就是 AI 挑的那個敵人（或 null） */
  aiTarget?(view: BattleView, unit: BattleUnit, target: BattleUnit | null): BattleTarget | null
}

/**
 * 一個行動實際要花多少：行動自己算的花費，加上修正（action_ap：技能的減免）。行動點最少 0。
 * 畫面顯示的、核心檢查夠不夠的、實際扣的、AI 算的，都是這一個數字。
 */
export function actionCost(view: BattleView, unit: BattleUnit, def: BattleActionDef, input?: BattleInput): { ap: number; [pool: string]: number } {
  const base = def.cost(view, unit, input)
  const t = input?.target
  const tags = [def.id, `group:${def.group}`, ...(t && 'unit' in t && t.unit !== unit.id ? ['other'] : [])]
  const delta = view.mods('action_ap', unit, undefined, undefined, tags).reduce((sum, p) => sum + p.value, 0)
  return delta ? { ...base, ap: Math.max(0, base.ap + delta) } : base
}

/** 問一個數字的修正時帶的情境。 */
export interface ModQuery {
  kind: ModKind
  view: BattleView
  /** 問的是誰的數字 */
  unit: BattleUnit
  /** 對手（攻擊時是目標，迴避時是攻擊者） */
  other?: BattleUnit
  weapon?: BattleWeapon
  /** 情境的標籤：aimed、burst、reaction、watch、melee、first_round…… */
  tags: string[]
}

export type BattleModifier = (q: ModQuery) => RollPart[]

/** 戰鬥裡的掛點。處理函式拿到正在算的這一步（BattleRun），可以用它的基本動作改戰鬥狀態；不可以碰 GameState。 */
export interface BattleHookMap {
  /**
   * 一個單位剛組好（開打時每個上場與在後方等的人各一次；還沒擲先攻、還沒輪到任何人）。
   * 功能把自己的資料掛到單位上：裝著的技能、義體、帶進來的東西。先攻的修正讀得到這裡掛上去的東西
   */
  'unit.ready': { run: BattleRun; unit: BattleUnit }
  /** 開打：單位都站好、先攻擲完之後。技能的開場效果、預備帶進來的東西放這裡 */
  'battle.start': { run: BattleRun }
  /** 一個單位的回合開始：行動點已經回復、狀態已經結算、確定不是失去回合 */
  'turn.start': { run: BattleRun; unit: BattleUnit }
  'turn.end': { run: BattleRun; unit: BattleUnit }
  /** 擲命中之前：反應（掩護射擊、小心後面！）在這裡；可以改 opts（命中、迴避的加減） */
  'attack.before': { run: BattleRun; attacker: BattleUnit; target: BattleUnit; weapon: BattleWeapon; opts: import('./run').AttackOpts }
  /** 一次攻擊結算完（命中或沒中）：武器的特性與技能的後續（輕機槍的壓制、還給你～） */
  'attack.after': { run: BattleRun; attacker: BattleUnit; target: BattleUnit; weapon: BattleWeapon; opts: import('./run').AttackOpts; result: import('./run').AttackResult }
  /** 重創（自然 20，或瞄準過的射擊打出要害），目標不是雜兵：現實擲部位，內海是破損 */
  'wound': { run: BattleRun; attacker: BattleUnit; target: BattleUnit; aimed: boolean; part?: string }
  /** 過載了（感載已經歸零、餘韻加了一層、沒有倒下；失去回合或閃斷已經照戰場的規則做了） */
  'overload': { run: BattleRun; unit: BattleUnit; by?: BattleUnit }
  /** 倒下或退出（how：down、subdued、surrendered、fled……） */
  'out': { run: BattleRun; unit: BattleUnit; how: string; by?: BattleUnit }
  /** 有人換了格（by：action 是自己換位，forced 是被推拉）。補位不算 */
  'moved': { run: BattleRun; unit: BattleUnit; from: number; to: number; by: 'action' | 'forced' }
  /** 有人站上暴露的格子（換位、補位、被推拉、遮蔽被打成暴露）：監視之外的反應 */
  'exposed': { run: BattleRun; unit: BattleUnit }
  /** 機體（機甲、構裝體）耐久歸零 */
  'hull.break': { run: BattleRun; unit: BattleUnit }
  /** 和人重疊的東西被擊落 */
  'overlay.down': { run: BattleRun; overlay: import('../types').BattleOverlay; by?: BattleUnit }
  /** AI 的回合，每一步之前：功能可以先替他做一件事（撤退、投降、啟動機體、招牌行動）。回傳 true 表示這一步做完了 */
  'ai.step': { run: BattleRun; unit: BattleUnit }
  /** 分出結果的那一刻（還在這一步裡） */
  'battle.result': { run: BattleRun; outcome: string }
}
export type BattleHookName = keyof BattleHookMap

/** 戰鬥結束時每個功能要加進結束報告的東西。 */
export interface BattleEndExtra {
  changes?: Change[]
  /** 定案的結果，一行一筆（接在核心的後面） */
  lines?: string[]
}
export type BattleEndHandler = (ctx: { k: BattleKernel; state: GameState; battle: BattleState; outcome: string }) => BattleEndExtra | void

/** 把一筆「誰上場」變成戰鬥裡的單位（還沒有 id、站位、先攻）。 */
export type BattleUnitInit = Omit<BattleUnit, 'id' | 'side' | 'slot' | 'initiative'>
export interface UnitSourceCtx {
  k: BattleKernel
  state: GameState
  side: BattleSide
  mode: string
  grade: number
  /** 這一方上場的人數（對決的修正用） */
  allyCount: number
}
export type UnitSource = (ref: Record<string, unknown>, ctx: UnitSourceCtx) => BattleUnitInit

/** 角色帶進戰鬥的裝備：武器、護甲、迴避的修正、快取格、標籤。裝備的功能註冊。 */
export interface Loadout {
  weapons?: BattleWeapon[]
  armor?: number
  evade?: number
  quick?: Array<{ item: string; qty: number }>
  tags?: string[]
}
export type LoadoutProvider = (state: GameState, actor: ActorId, mode: string) => Loadout | void

/**
 * 道具在戰鬥裡的一種效果（內容種類 item 的 use.effects 裡每一筆的 op）。現實戰鬥的功能註冊 heal、cleanse、afterglow、vent、soft_cover；
 * 之後的功能（投擲物、藥、腳本）各自加自己的。target 是玩家選的目標；unit 是那個目標是人的時候的那個單位。
 */
export type BattleItemOp = (ctx: { run: BattleRun; user: BattleUnit; target: BattleTarget; unit?: BattleUnit; item: string }, effect: Record<string, unknown>) => void

export interface BattleKernel extends RulesKernel {
  battle: BattleRegistry
}

export class BattleRegistry {
  private actions = new Map<string, BattleActionDef>()
  private hooks = new Map<string, Array<{ owner: string; order: number; fn: (p: unknown) => unknown }>>()
  private mods: Array<{ owner: string; fn: BattleModifier }> = []
  private ends: Array<{ owner: string; fn: BattleEndHandler }> = []
  private sources = new Map<string, { owner: string; fn: UnitSource }>()
  private loadouts: Array<{ owner: string; fn: LoadoutProvider }> = []
  private itemOps = new Map<string, { owner: string; fn: BattleItemOp }>()

  constructor(private probe: Probe) {}

  private reg(registry: string, id: string, owner: string): void {
    this.probe.emit('core/battle/registry', 'registry.register', { registry, id, owner })
  }

  /** 註冊一個行動。id 重複就丟錯。 */
  action(def: BattleActionDef): void {
    const old = this.actions.get(def.id)
    if (old) throw new Error(`戰鬥行動重複註冊：${def.id}（已經由 ${old.owner} 註冊）`)
    this.actions.set(def.id, def)
    this.reg('battle.actions', def.id, def.owner)
  }

  getAction(id: string): BattleActionDef | undefined {
    return this.actions.get(id)
  }

  /** 這個戰場的所有行動，照圈與順序排。 */
  actionsFor(mode: string): BattleActionDef[] {
    const rank: Record<BattleActionGroup, number> = { skill: 0, attack: 1, supply: 2, tactic: 3, system: 4 }
    return [...this.actions.values()].filter((a) => !a.modes || a.modes.includes(mode)).sort((a, b) => rank[a.group] - rank[b.group] || (a.order ?? 0) - (b.order ?? 0))
  }

  /** 掛上一個戰鬥裡的掛點。order 小的先跑。 */
  on<N extends BattleHookName>(name: N, owner: string, fn: (payload: BattleHookMap[N]) => boolean | void, order = 0): void {
    const list = this.hooks.get(name) ?? []
    list.push({ owner, order, fn: fn as (p: unknown) => unknown })
    list.sort((a, b) => a.order - b.order)
    this.hooks.set(name, list)
    this.reg('battle.hooks', name, owner)
  }

  /** 呼叫一個掛點。回傳有沒有哪一個處理函式回傳 true（ai.step 用：這一步有人做了）。 */
  emit<N extends BattleHookName>(name: N, payload: BattleHookMap[N]): boolean {
    let handled = false
    for (const h of this.hooks.get(name) ?? []) {
      const r = h.fn(payload)
      this.probe.emit('core/battle/registry', 'hook.call', () => ({ hook: `battle:${name}`, owner: h.owner, result: r === true }))
      if (r === true) {
        handled = true
        if (name === 'ai.step') break
      }
    }
    return handled
  }

  /** 修正的來源：技能的被動、義體、特質。回傳這個情境下的加減。 */
  modifier(owner: string, fn: BattleModifier): void {
    this.mods.push({ owner, fn })
    this.reg('battle.modifiers', owner, owner)
  }

  modifiers(q: ModQuery): RollPart[] {
    return this.mods.flatMap((m) => m.fn(q)).filter((p) => p.value !== 0)
  }

  /** 戰鬥結束時要加進結束報告的變更（掉落、快取格用掉的東西、重的傷勢、俘虜……）。 */
  onEnd(owner: string, fn: BattleEndHandler): void {
    this.ends.push({ owner, fn })
    this.reg('battle.end', owner, owner)
  }

  endExtras(ctx: Parameters<BattleEndHandler>[0]): BattleEndExtra[] {
    return this.ends.map((e) => e.fn(ctx)).filter((x): x is BattleEndExtra => !!x)
  }

  /** 「誰上場」的來源：核心有 actor（角色）與 unit（直接給整個單位）；敵人的功能註冊 enemy。 */
  unitSource(kind: string, owner: string, fn: UnitSource): void {
    if (this.sources.has(kind)) throw new Error(`單位的來源重複註冊：${kind}（已經由 ${this.sources.get(kind)!.owner} 註冊）`)
    this.sources.set(kind, { owner, fn })
    this.reg('battle.unitSources', kind, owner)
  }

  getUnitSource(kind: string): UnitSource | undefined {
    return this.sources.get(kind)?.fn
  }

  /** 角色帶進戰鬥的裝備。 */
  loadout(owner: string, fn: LoadoutProvider): void {
    this.loadouts.push({ owner, fn })
    this.reg('battle.loadouts', owner, owner)
  }

  /** 註冊一種道具效果。op 重複就丟錯。 */
  itemOp(op: string, owner: string, fn: BattleItemOp): void {
    const old = this.itemOps.get(op)
    if (old) throw new Error(`道具效果重複註冊：${op}（已經由 ${old.owner} 註冊）`)
    this.itemOps.set(op, { owner, fn })
    this.reg('battle.itemOps', op, owner)
  }

  getItemOp(op: string): BattleItemOp | undefined {
    return this.itemOps.get(op)?.fn
  }

  /** 已經註冊的道具效果（檢查內容用：道具寫了沒有人註冊的 op，就是寫錯了）。 */
  itemOpIds(): string[] {
    return [...this.itemOps.keys()]
  }

  loadoutOf(state: GameState, actor: ActorId, mode: string): Required<Loadout> {
    const out: Required<Loadout> = { weapons: [], armor: 0, evade: 0, quick: [], tags: [] }
    for (const p of this.loadouts) {
      const l = p.fn(state, actor, mode)
      if (!l) continue
      out.weapons.push(...(l.weapons ?? []))
      out.armor += l.armor ?? 0
      out.evade += l.evade ?? 0
      out.quick.push(...(l.quick ?? []))
      out.tags.push(...(l.tags ?? []))
    }
    return out
  }
}
