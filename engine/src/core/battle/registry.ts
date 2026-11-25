// L5 戰鬥：登錄表。核心只有引擎（站位、遮蔽、回合、命中與傷害的流程、感載與過載、狀態、敵人 AI 的骨架）；
// 「有哪些行動、每個行動做什麼」由功能註冊：現實戰鬥註冊射擊、近戰、換彈、監視、制伏……，內海戰鬥（M3）註冊它自己的那一組，
// 技能的功能把每個主動技能註冊成一個行動。功能之間不直接 import，都接在這張表上。dev/adr/0010。

import type { ActorId, BattleImplant, BattleInput, BattleOverlay, BattleSide, BattleState, BattleTarget, BattleUnit, BattleWeapon, Change, GameState, RollPart } from '../types'
import type { Probe } from '../state/probe'
import type { RulesKernel } from '../rules/kernel'
import { isRecord } from '../util/sanitize'
import { ifProblem, whoProblem } from './effects'
import { poolName, sameTarget, wielded } from './field'
import type { BattleMode, BattleNumbers, ModKind } from './rules'
import { FLASH } from './rules'
import type { BattleRun } from './run'
import type { UnitRef } from './units'

/** 行動圓環的哪一圈（COMBAT_SYSTEM 第 10 節）：中心是技能，內環攻擊，中環補充與切換，外環戰術；system 是圓環外面那一列（結束回合、脫離、投降）。 */
export type BattleActionGroup = 'attack' | 'supply' | 'tactic' | 'skill' | 'system'
/** 這個行動要選什麼目標。mixed 是幾種混在一起（叫人：我方的格、敵方的格或一個敵人）；實際能選哪些一律以 targets 列的為準。 */
export type BattleTargetKind = 'none' | 'foe' | 'ally' | 'unit' | 'foe_slot' | 'ally_slot' | 'overlay' | 'node' | 'mixed'

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
  /** 一個數字的所有加減（狀態、餘韻、重傷、功能註冊的修正）。base：這個數字在修正之前是多少（問 action_ap 時是行動自己算的行動點） */
  mods(kind: ModKind, unit: BattleUnit, other?: BattleUnit, weapon?: BattleWeapon, tags?: string[], base?: number): RollPart[]
  /** 帶著「不能換位」的狀態嗎 */
  cannotMove(unit: BattleUnit): boolean
  /** 這個單位現在吃到幾級遮蔽：他站的那一格本身的遮蔽，加上 cover_level 的修正（最高到掩體）；開著機體的人用不了遮蔽（永遠 0）。迴避、暴露、AI 都問它，不直接看那一格（技能的 in_cover、other_exposed 條件還看那一格本身的，見 dev/adr/0015 補記） */
  coverOf(unit: BattleUnit): import('../types').CoverLevel
  /** 站在暴露的格子上（有效遮蔽是 0；監視看的就是這個） */
  isExposed(unit: BattleUnit): boolean
  /** 行動點與其他的池夠不夠 */
  canAfford(unit: BattleUnit, cost: { ap?: number; [pool: string]: number | undefined }): boolean
  /**
   * 這一方現在叫得到的候補（k.battle.bench 登記的每個來源合在一起；dev/adr/0016 第五節）：同一個 id 只留第一筆，
   * 已經在這一場裡的人（上場的、在後方等的、倒下或退出的、叫了還沒進場的）不列。沒有人登記就是空的。
   * 每一筆的 blocks 是現在叫不了他的原因（一條一個條件）；叫不叫得進場另外看 run.callIn 有沒有空格
   */
  bench(side: BattleSide): BenchEntry[]
}

/**
 * 候補的一個人（k.battle.bench 的來源回答的每一筆）：這一方叫得到、但還不在這一場裡的人。
 * 核心不替來源決定「誰算候補」（名冊上有空的人、技能召來的幫手……）；只管合起來、去重、拿掉已經在場裡的。
 */
export interface BenchEntry {
  /** 候補的識別（同一個人在不同來源裡用同一個 id；合起來時只留第一筆）。名冊的人用角色的 id */
  id: string
  /** 叫他進場時交給 run.callIn 的那一筆（和開戰時的 UnitRef 同一種格式；名冊的人是 { from: 'actor', id }） */
  ref: UnitRef
  /** 給玩家看的名字 */
  name: string
  /** 現在叫不了他的原因，一條一個條件（給玩家看的完整句子）；空的就是叫得了。叫不了的照樣列出來：灰掉但看得到 */
  blocks: string[]
}
/** 一個候補的來源：回答「這一方現在叫得到誰」。拿到的 battle 是這一刻的戰鬥狀態，只讀。 */
export type BenchSource = (state: GameState, battle: BattleState, side: BattleSide) => BenchEntry[]

/** 一個可以選的目標，以及現在選不了的原因（一條一條列；空的就是可以選）。 */
export interface BattleTargetOption {
  target: BattleTarget
  blocks: string[]
  /** 給畫面的提示（命中率、距離……） */
  hint?: Record<string, unknown>
}

/**
 * 目標以外，這一步還要玩家選的東西（BattleInput.pick 裡的一個鍵）：用哪個道具、換上哪一把、放哪一台無人機、打誰、放在哪一格……
 * 行動在註冊時用 picks 宣告，battleOptions 原樣交給畫面：畫面照宣告列出來讓玩家選，不必認得每個行動（dev/adr/0014）。
 * 這是給畫面的說明；一步成不成立仍然由行動自己的 run 決定（不合的丟 BattleBlocked），兩邊對不對得上由測試守。
 */
export type BattlePickKind =
  /** 幾個選項挑一個（道具、武器、無人機、叫人做哪一件事、打哪個部位）：畫面列成一排按鈕 */
  | 'choice'
  /** 開或不開（掃射）：只有一個選項，value 是 true；不開就不送這個鍵 */
  | 'toggle'
  /** 場上的一個人：value 是單位 id，選項的 at 指到那個人 */
  | 'foe' | 'ally' | 'unit'
  /** 一格：value 是第幾格（1～4），選項的 at 指到那一格 */
  | 'foe_slot' | 'ally_slot'

export interface BattlePickOption {
  /** 選了它，input.pick[key] 就放這個值 */
  value: string | number | boolean
  /** 給玩家看的名字 */
  label: string
  /** 現在選不了的原因，一條一個條件（完整的句子）；空的就是可以選。選不了的照樣列出來：灰掉但看得到 */
  blocks: string[]
  /** 這個選項是場上的哪個東西（選人、選格的那幾種才有）：畫面可以讓玩家直接點場上的那一個 */
  at?: BattleTarget
  /**
   * 只有這一步的目標是這幾個當中的一個時才適用；沒寫就是不管目標是誰都適用（還沒選目標時，每個選項都先算適用）。
   * 兩個方向都用它：先選了目標，這一項只剩適用的選項（指揮無人機：攻擊型才要選敵人）；先選了選項，目標只剩 for 裡的（煙霧彈只能放在格子上）
   */
  for?: BattleTarget[]
  /** 給畫面的提示（花幾點、命中率……） */
  hint?: Record<string, unknown>
}

export interface BattlePick {
  /** BattleInput.pick 裡的鍵 */
  key: string
  /** 給玩家看的名字（「道具」「換上」「掃射」「打誰」） */
  label: string
  kind: BattlePickKind
  /**
   * 一定要選：對這一步的目標有適用的選項時，沒選就做不成。false 是可以不選，行動照自己的預設做（換武器換到下一把）。
   * 對這一步的目標一個適用的選項都沒有，這一項就不用選（醫療無人機不用選敵人）
   */
  required: boolean
  options: BattlePickOption[]
}

/** 這個選項對這個目標適不適用（看 for）。還沒選目標（target 是空的）時每個選項都算適用：還沒有東西可以把它排除。 */
export function pickApplies(option: BattlePickOption, target: BattleTarget | null | undefined): boolean {
  return !option.for || !target || option.for.some((t) => sameTarget(t, target))
}

/**
 * 照宣告看這一步選的東西齊不齊：回傳每一個問題（一條一句）；空的就是照宣告看沒有問題。
 * 畫面在送出之前用它提示玩家還缺什麼；核心不照它擋（行動的 run 才是依據）。
 */
export function pickProblems(picks: readonly BattlePick[], target: BattleTarget | null | undefined, chosen: Record<string, unknown> | undefined): string[] {
  const out: string[] = []
  for (const p of picks) {
    const options = p.options.filter((o) => pickApplies(o, target))
    const value = chosen?.[p.key]
    // 開關：沒開（沒送，或送 false）就是不選
    if (value === undefined || (p.kind === 'toggle' && value === false)) {
      if (p.required && options.length) out.push(`要選${p.label}。`)
      continue
    }
    const found = options.find((o) => o.value === value)
    if (!found) out.push(`${p.label}：沒有這個選項。`)
    else out.push(...found.blocks)
  }
  return out
}

export interface BattleActionDef {
  id: string
  owner: string
  /** 給玩家看的名字 */
  name: string
  /** 泡泡訊息裡的說明（完整的句子） */
  desc: string
  group: BattleActionGroup
  /**
   * 圖示的鍵（一個字串；畫面自己對照到圖，沒有圖的鍵由畫面決定怎麼退）。現在用到的鍵與哪些還沒有圖見 dev/adr/0014。
   * 沒寫的話：技能那一圈用 'skill'（晶片），其他圈用行動自己的 id
   */
  icon?: string
  /**
   * 行動的標籤：問花費的修正（action_ap）與行動做完的掛點（action.done）都帶著，讓別的功能不必認得行動的 id。
   * 核心定的一個：weapon_attack——用手上那一把武器攻擊一次（射擊、近戰、內海的構裝攻擊）；
   * 「帶某個特性的武器開一槍少花幾點」這類減免看這個標籤與手上的武器，不看行動叫什麼
   */
  tags?: string[]
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
   * 照這一步的輸入多給幾個標籤（接在 actionTags 的最後面）：用的是哪一類道具、是不是治療。
   * 花費的減免（action_ap、action_ram）與 action.done 掛點靠它認得出「用醫療道具」，不必認得行動的 id（dev/adr/0015 第二節）
   */
  costTags?(view: BattleView, unit: BattleUnit, input?: BattleInput): string[]
  /**
   * 現在做不到的原因，一條一條列（每一條是給玩家看的完整句子，寫出缺的是哪個條件）。空的就是做得到。
   * 不看目標；行動點夠不夠、是不是輪到他、戰鬥結束了沒有，由核心檢查。
   */
  blocks?(view: BattleView, unit: BattleUnit): string[]
  /** 可以選的目標。每一個可以附現在選不了的原因：灰掉但看得到，泡泡寫出原因 */
  targets?(view: BattleView, unit: BattleUnit): BattleTargetOption[]
  /** 目標以外還要選的東西（run 會讀的每一個 input.pick 的鍵都要宣告，畫面才送得出來）。沒有就不寫 */
  picks?(view: BattleView, unit: BattleUnit): BattlePick[]
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
  /**
   * 敵人 AI 的位置分（ENEMIES 4.2 節）多加的一項：站在 slot 那一格，這個行動有沒有「一定要站在這裡才做得到」而且值得做的對象。
   * 有就回傳要加在那一格位置分上的分數（制伏回傳它的行動分 4）；沒有回傳 0。位置分其他的項大約在 −2～4 之間，換過去高出 1.5 以上才換位。
   * 只有受站位限制、又比一般攻擊值得的行動才要寫（制伏、內海的釘住）。有這個行動、付得起（要換過去的再加換位的 1 點）、
   * 行動自己的 blocks 是空的，核心才會問；核心取所有行動裡最高的那一個
   */
  aiSlotScore?(view: BattleView, unit: BattleUnit, slot: number): number
}

/** 這個行動的圖示的鍵：有寫用寫的；沒寫的話技能那一圈是 'skill'，其他圈是行動自己的 id。 */
export function actionIcon(def: Pick<BattleActionDef, 'id' | 'group' | 'icon'>): string {
  return def.icon ?? (def.group === 'skill' ? 'skill' : def.id)
}

/**
 * 問花費的修正、行動做完的掛點帶的標籤：[行動的 id, 'group:<圈>', 行動自己宣告的標籤…]；目標是自己以外的人時再多一個 'other'；
 * 最後接行動的 costTags（照這一步的輸入多給的；要給 view 才問，沒給就沒有）。
 */
export function actionTags(unit: BattleUnit, def: BattleActionDef, input?: BattleInput, view?: BattleView): string[] {
  const t = input?.target
  return [def.id, `group:${def.group}`, ...(def.tags ?? []), ...(t && 'unit' in t && t.unit !== unit.id ? ['other'] : []), ...(view && def.costTags ? def.costTags(view, unit, input) : [])]
}

/**
 * 一個行動實際要花多少：行動自己算的花費，加上修正（action_ap：技能的減免；action_ram：只在這個行動本來就花 RAM 時，最少 1）。行動點最少 0。
 * 畫面顯示的、核心檢查夠不夠的、實際扣的、AI 算的，都是這一個數字。
 * 問修正時帶著：行動的標籤（actionTags）、手上那一把武器、行動自己算的行動點或 RAM（base）。
 */
export function actionCost(view: BattleView, unit: BattleUnit, def: BattleActionDef, input?: BattleInput): { ap: number; [pool: string]: number } {
  const base = def.cost(view, unit, input)
  const tags = actionTags(unit, def, input, view)
  const weapon = wielded(unit)
  const delta = view.mods('action_ap', unit, undefined, weapon, tags, base.ap).reduce((sum, p) => sum + p.value, 0)
  const ram = base.ram ?? 0
  const ramDelta = ram > 0 ? view.mods('action_ram', unit, undefined, weapon, tags, ram).reduce((sum, p) => sum + p.value, 0) : 0
  if (!delta && !ramDelta) return base
  return { ...base, ...(delta ? { ap: Math.max(0, base.ap + delta) } : {}), ...(ramDelta ? { ram: Math.max(1, ram + ramDelta) } : {}) }
}

/**
 * 閃斷的那一回合只能做不花 RAM 的事（CYBERSPACE 6.2 節；dev/adr/0018 N3；使用者 2026-11-24：可以回填，不能用花 RAM 的攻擊）：
 * 這個單位帶著閃斷的狀態（flash）、行動的花費裡有 flashPool 那一池（內海是 RAM）時，這個行動做不了；回傳灰掉的原因（給玩家看的完整句子），沒事回傳 null。
 * 回填（只花行動點）、換位、換構裝、腳本（不花 RAM）照做，回填補回來的 RAM 留到下一個回合用。步驟的條件、AI 挑行動、performAction 都問它。
 */
export function flashBlock(view: Pick<BattleView, 'mode'>, u: BattleUnit, cost: { ap: number; [pool: string]: number }): string | null {
  const pool = view.mode.flashPool
  if (!pool || !u.statuses.some((s) => s.id === FLASH) || !((cost[pool] ?? 0) > 0)) return null
  return `閃斷中：這個回合只能做不花 ${poolName(pool)} 的事（換位、換構裝、回填）。`
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
  /** 這個數字在修正之前是多少。只有問 action_ap 時有：行動自己算的行動點（「改成只花 N 點」的減免要知道原價） */
  base?: number
}

export type BattleModifier = (q: ModQuery) => RollPart[]

/** 戰鬥裡的掛點。處理函式拿到正在算的這一步（BattleRun），可以用它的基本動作改戰鬥狀態；不可以碰 GameState。 */
export interface BattleHookMap {
  /**
   * 一個單位剛組好（開打時每個上場與在後方等的人各一次；還沒擲先攻、還沒輪到任何人；戰鬥中用 run.callIn 叫來的人在叫來的那一刻也發一次，
   * 那時他在後方、還沒有先攻）。功能把自己的資料掛到單位上：裝著的技能、義體、帶進來的東西。先攻的修正讀得到這裡掛上去的東西
   */
  'unit.ready': { run: BattleRun; unit: BattleUnit }
  /** 開打：單位都站好、先攻擲完之後。技能的開場效果、預備帶進來的東西放這裡 */
  'battle.start': { run: BattleRun }
  /**
   * 每一輪（全員輪過一次）開頭，第一輪也發；發的時候還沒有人行動（還沒輪到這一輪的第一個人）。
   * 沒有操作者、auto 的東西（巡邏的無人機、砲塔）每一輪自己做一個動作放這裡；倒數計時的東西（天使急救）也在這裡數。
   * 處理函式做完之後，核心替它收尾（run.settle：補位、看結果）
   */
  'round.start': { run: BattleRun; round: number }
  /**
   * 一個單位的回合開始：行動點已經回復、狀態已經結算。**失去回合的人也發**（lost: true；他的回合照樣開始，只是動不了）：
   * 計時類的東西（守著、臨時遮蔽、buff、持續型快駭、無人機的守著與停機）要照樣數，所以聽這個掛點就對了；
   * 要「替他做一件事」的處理函式（回合開始時的效果、自己動一次）先看 lost，失去的回合不做（dev/adr/0015 補記 M1b-review-core）。
   * 發的時候他的失去回合狀態已經拿掉（回合開始前就帶著的那一個）；處理函式裡讓他又過載的，失去的是下一個回合。失去回合的 turn.start 之後 battle.acting 沒有設
   */
  'turn.start': { run: BattleRun; unit: BattleUnit; lost?: boolean }
  /**
   * 一個單位的回合結束（還在場上的才發；回合裡自己退出的不發：他的計時由 out 結束，見 dev/adr/0015 補記）。
   * lost: true 是失去的那個回合（他沒有動，但 turn.start 與 turn.end 都照發，計時照數）
   */
  'turn.end': { run: BattleRun; unit: BattleUnit; lost?: boolean }
  /**
   * 擲命中之前：反應（掩護射擊、小心後面！）在這裡；可以改 opts（命中、迴避的加減）。
   * attacker 可能是替身（和人重疊的東西自己開火，run.overlayAttack；ext.overlay 是那一台的 id，不在 battle.units 裡）：
   * 要對攻擊者做攻擊以外的事（給狀態、推拉）的功能先看 ext.overlay（run.isStandIn）；run.attack 打替身會自動改打那一台的耐久
   */
  'attack.before': { run: BattleRun; attacker: BattleUnit; target: BattleUnit; weapon: BattleWeapon; opts: import('./run').AttackOpts }
  /**
   * 一次攻擊被 attack.before 的處理函式取消了（opts.cancel：卡彈、炸膛）：那一句話已經記成一拍、彈匣已經扣了，沒有擲任何骰、不發 attack.after。
   * 取消的後果放這裡（炸膛傷到開槍的人）；reason 就是 opts.cancel。attacker 可能是替身（見 attack.before）
   */
  'attack.cancel': { run: BattleRun; attacker: BattleUnit; target: BattleUnit; weapon: BattleWeapon; opts: import('./run').AttackOpts; reason: string }
  /**
   * 一次攻擊結算完（命中或沒中）：武器的特性與技能的後續（輕機槍的壓制、原樣奉還）。
   * 打和人重疊的東西（run.attackOverlay）也發，target 是那一台的替身；改打（opts.redirect）的那一擊不發，它發 attack.redirected。attacker 可能是替身（見 attack.before）
   */
  'attack.after': { run: BattleRun; attacker: BattleUnit; target: BattleUnit; weapon: BattleWeapon; opts: import('./run').AttackOpts; result: import('./run').AttackResult }
  /**
   * 改打（opts.redirect）的那一擊結算完：target 是原本的目標（沒有受影響），overlay 是吃下這一擊的那一台，result 是那一台的結果（redirected: true；
   * 打中、打空、被護甲擋光都發）。不發 attack.after：它的處理函式都假設 target 是被打中的人。立牌「吃了一擊就倒下」放在這裡
   */
  'attack.redirected': { run: BattleRun; attacker: BattleUnit; target: BattleUnit; overlay: import('../types').BattleOverlay; weapon: BattleWeapon; opts: import('./run').AttackOpts; result: import('./run').AttackResult }
  /**
   * 命中已經確定、傷害還沒算（只有打人的攻擊；打掛著的東西沒有）。roll 是這一擊的骰面與結果（wound：本來會重創）；
   * 處理函式改 out：negate 設成 true，這一擊不造成傷害、不重創、不推拉（遮蔽照樣受傷，attack.after 照樣發）；wound 設成 false，重創改成一般的命中
   */
  'attack.hit': { run: BattleRun; attacker: BattleUnit; target: BattleUnit; weapon: BattleWeapon; opts: import('./run').AttackOpts; roll: { natural: number; total: number; evade: number; crit: boolean; wound: boolean }; out: { negate?: boolean; wound?: boolean } }
  /** 重創（自然 20，或瞄準過的射擊打出要害），目標不是雜兵：現實擲部位，內海是破損 */
  'wound': { run: BattleRun; attacker: BattleUnit; target: BattleUnit; aimed: boolean; part?: string }
  /**
   * 有人即將加沉溺（run.gainSink：傷害類型自己帶的、快感的感載效果）。處理函式把 out.block 設成 true 就不加（定力擋、免疫沉溺的人）。
   * type 是造成它的傷害類型；呼叫的人自己決定沉溺的（AttackOpts.noSink）不經過這裡
   */
  'sink.before': { run: BattleRun; unit: BattleUnit; amount: number; type?: import('../types').DamageType; by?: BattleUnit; out: { block?: boolean } }
  /**
   * 過載了（感載已經歸零、餘韻加了一層、沒有倒下；失去回合或閃斷已經照戰場的規則做了）。
   * 餘韻已經疊滿再過載（昏過去）的那一次不發這個，先發 out.before（how: burnout），有人擋下就到此為止：
   * 功能自己記的「到下次過載」的東西（until: next_overload）兩個都要聽（核心的狀態在 overload() 一開頭就拿掉了，不必管）。
   * flash：這個戰場的過載是閃斷（內海）時才有——歸零的是哪一池（pool）、歸零之前有多少（before）；那一池已經歸零、單位已經帶著狀態 flash。
   * 處理函式可以把池補回去（過載時 RAM 回滿、只減半：補的留著，flash 的 noRegen 只管下個回合開始的回復）、改 flash 的時間（閃斷持續兩回合）、拿掉它
   */
  'overload': { run: BattleRun; unit: BattleUnit; by?: BattleUnit; flash?: { pool: string; before: number } }
  /**
   * 有人即將退出（how：down、burnout、subdued、surrendered、fled……）。處理函式把 out.prevent 設成 true 就擋下：setOut 回傳 false、什麼都不做。
   * 因為生命歸零而來的（how 是 down），核心保證擋下之後生命至少 1；其餘的數字（感載、餘韻、狀態）由處理函式自己改
   */
  'out.before': { run: BattleRun; unit: BattleUnit; how: string; by?: BattleUnit; out: { prevent?: boolean } }
  /**
   * 倒下或退出（how：down、subdued、surrendered、fled……）。發的時候核心已經把「他給別人的、算他的回合的狀態」拿掉
   * （source_turn_start、source_turn_end）；功能自己記的計時（buff、臨時遮蔽、守著）也在這裡結束：他再也沒有回合了
   */
  'out': { run: BattleRun; unit: BattleUnit; how: string; by?: BattleUnit }
  /**
   * 倒下的人被救回來了（run.revive）：發的時候他已經回到場上（或排在後方）、生命已經給了、行動點 0、核心的狀態與姿態已經清空。
   * 「狀態清空」包括功能自己記在他身上的限時的東西（buff、持續型快駭……）：功能在這裡清自己的
   */
  'revive': { run: BattleRun; unit: BattleUnit }
  /**
   * 一個帶著 other（對誰擲的）的檢定（run.save）擲之前。**unit 是擲骰的人**（run.save 的 u：快駭與誘惑是丟程式、出手的人；
   * 對效果擲的豁免是被打的人），**other 是這個檢定對他擲的那個人**（拿 DC 的那一方：被快駭、被誘惑的人；豁免則是下手的人）。
   * other 那一邊的反應（非請勿看）在這裡改這一次的 DC 與加值（opts.dc、opts.bonus；DC 加是讓擲骰的 unit 更難、bonus 加是讓他更容易）。
   * 和 attack.before（attacker 擲命中、target 的反應）同一個方向。tags 是這個檢定的標籤（hack、seduce……）。沒有 other 的檢定不發（dev/adr/0015 補記）
   */
  'check.before': { run: BattleRun; unit: BattleUnit; other: BattleUnit; tags: string[]; opts: { dc: number; bonus: number } }
  /** 有人換了格（by：action 是自己換位，forced 是被推拉）。補位不算（補位發 compacted） */
  'moved': { run: BattleRun; unit: BattleUnit; from: number; to: number; by: 'action' | 'forced' }
  /**
   * 補位（run.compact）做完了：unit 從 from 格往前遞補到 to 格（to < from；這一次 compact 裡的淨移動，同一次補了兩格就是一個事件、from 是原本的格）。
   * 發的時候這一方的站位、遮蔽、掛著的東西都已經整理好。每個往前移動的單位各發一次；沒動的不發。
   * 「站在那一格的人往前補位」的反應（不准動）聽這個，不必每個動作做完去掃站位
   */
  'compacted': { run: BattleRun; side: BattleSide; unit: BattleUnit; from: number; to: number }
  /** 有人站上暴露的格子（換位、補位、被推拉、遮蔽被打成暴露）：監視之外的反應 */
  'exposed': { run: BattleRun; unit: BattleUnit }
  /** 機體（機甲、構裝體）耐久歸零 */
  'hull.break': { run: BattleRun; unit: BattleUnit }
  /** 和人重疊的東西被擊落 */
  'overlay.down': { run: BattleRun; overlay: import('../types').BattleOverlay; by?: BattleUnit }
  /**
   * 一個花了行動點的行動做完了（玩家下的、AI 選的、功能用 performAction 替單位做的都算；監視的自動攻擊、反應、技能裡面附帶的攻擊不算）。
   * action 是行動的 id，tags 是 actionTags（含行動自己的 costTags，和問 action_ap 時帶的一樣；在行動做之前問好），cost 是實際扣的、base 是行動自己算的（修正之前），weapon 是行動開始時手上那一把。
   * 「每回合第一次才便宜」這類要記次數的東西掛這裡：修正（action_ap）只管算，用掉幾次在這裡記
   */
  'action.done': { run: BattleRun; unit: BattleUnit; action: string; tags: string[]; target: BattleTarget | null; input: BattleInput; cost: { ap: number; [pool: string]: number }; base: { ap: number; [pool: string]: number }; weapon?: BattleWeapon }
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
  /** 身上裝著的義體（M4 的義體功能給；在那之前主角這一邊是空的）。單位的 cyber 沒寫時用件數 */
  implants?: BattleImplant[]
}
export type LoadoutProvider = (state: GameState, actor: ActorId, mode: string) => Loadout | void

/**
 * 效果（dev/adr/0015 第一節）：道具（use.effects）、技能、招牌行動、武器的附帶效果、快駭用同一張登錄表，每一筆資料是 { op, ... }，
 * 另外可以帶兩個核心解析的共同欄位：who（落在誰身上）、if（看上一筆的結果要不要做）。
 * 誰註冊什麼：features/combat 註冊通用的，features/summons、abilities、hack 各註冊自己的。
 */
export interface BattleEffectSource {
  kind: 'item' | 'ability' | 'weapon' | 'hack' | 'field'
  id: string
  name: string
}
/** 公式要代的數字：tier 樹階、grade 場景等級（沒給用這場戰鬥的）、spent 花掉的格數或 RAM。 */
export interface BattleEffectNumbers {
  tier?: number
  grade?: number
  spent?: number
}
/**
 * 上一筆攻擊或檢定的結果：做攻擊與檢定的 op 把結果寫進 ctx.last，後面的 if 看它（整串效果共用同一個物件）。
 * overloaded 是上一筆讓對象過載了（灌感載的 op 寫）；stop 設成 true，這一筆做完之後這一串效果都不做（檢定的 stop 用）。
 * 攻擊的 op 用 noteAttack 寫結果：沒有發生的一擊 hit 是 undefined，不是 false。
 */
export interface BattleEffectLast {
  /** 命中了嗎。沒有發生的一擊（aborted）留 undefined：`if: miss` 不成立（用 noteAttack 寫） */
  hit?: boolean
  crit?: boolean
  downed?: boolean
  overloaded?: boolean
  ok?: boolean
  dealt?: number
  /** 這一筆做完之後這一串效果都不做（落在好幾個人身上的一筆，每個落點都做完才停） */
  stop?: boolean
  /** 上一擊沒有發生（卡彈、被取消、攻擊的人在反應裡倒下、目標已經不在）；noteAttack 寫 */
  aborted?: boolean
}
export interface BattleEffectCtx {
  run: BattleRun
  /** 做的人 */
  user: BattleUnit
  /** 玩家選的目標：可以是人、一格、一台、節點、沒有 */
  target: BattleTarget | null
  /** 這一筆落在哪個人身上（核心照 who 解析好的；who 是 target 而目標不是人時沒有） */
  unit?: BattleUnit
  /** 這一筆落在哪一台和人重疊的東西上（範圍打到掛著的東西時） */
  overlay?: BattleOverlay
  source: BattleEffectSource
  /** 來源是道具時等於 source.id（現有的道具效果讀這個） */
  item?: string
  /** 這一步其他的選擇（BattleInput.pick） */
  pick: Record<string, unknown>
  n: BattleEffectNumbers
  last: BattleEffectLast
  /** 反應裡：正在攻擊的人、被打的人（who: attacker、victim 看這兩個） */
  attacker?: BattleUnit
  victim?: BattleUnit
}
/** run.effects 收的：ctx 裡呼叫的人給的那幾樣（run、unit、overlay 由核心補）。 */
export interface BattleEffectInput {
  user: BattleUnit
  target?: BattleTarget | null
  source: BattleEffectSource
  pick?: Record<string, unknown>
  n?: BattleEffectNumbers
  /** 沒給就是一個新的空物件；給了的話整串效果做完之後呼叫的人看得到最後的結果 */
  last?: BattleEffectLast
  attacker?: BattleUnit
  victim?: BattleUnit
}
export type BattleEffectOp = (ctx: BattleEffectCtx, effect: Record<string, unknown>) => void
export interface BattleEffectOpts {
  /** 這個效果自己的格式檢查：回傳給資料作者看的訊息（欄位的型別、不認得的欄位、公式用 amountProblems）；空的就是合格 */
  problems?(effect: Record<string, unknown>): string[]
}
export interface BattleEffectDef extends BattleEffectOpts {
  op: string
  owner: string
  fn: BattleEffectOp
}

/** 舊的道具效果的呼叫方式（只有道具的那幾個欄位）：getItemOp 收這個，補齊其餘的欄位再交給效果。 */
export interface BattleItemOpCtx {
  run: BattleRun
  user: BattleUnit
  target: BattleTarget
  unit?: BattleUnit
  item: string
}
/** 舊名：道具效果現在就是效果（BattleEffectOp）。 */
export type BattleItemOp = BattleEffectOp

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
  private effects = new Map<string, BattleEffectDef>()
  private benches: Array<{ owner: string; fn: BenchSource }> = []

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

  /**
   * 呼叫一個掛點。回傳有沒有哪一個處理函式回傳 true（ai.step 用：這一步有人做了）。
   * attack.before 有人設了 opts.cancel 之後，後面的處理函式不再跑（這一擊已經不打了，反應不該對它起反應）。
   */
  emit<N extends BattleHookName>(name: N, payload: BattleHookMap[N]): boolean {
    let handled = false
    for (const h of this.hooks.get(name) ?? []) {
      const r = h.fn(payload)
      this.probe.emit('core/battle/registry', 'hook.call', () => ({ hook: `battle:${name}`, owner: h.owner, result: r === true }))
      if (r === true) {
        handled = true
        if (name === 'ai.step') break
      }
      if (name === 'attack.before' && (payload as BattleHookMap['attack.before']).opts.cancel !== undefined) break
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

  /**
   * 候補的來源（dev/adr/0016 第五節）：回答「這一方現在叫得到誰」，每個人一筆（BenchEntry）。名冊登記「名冊上有空、不在這一場裡的人」，
   * 技能的「增援」只問 view.bench、呼叫 run.callIn，不知道名冊。可以登記好幾個來源（來源之間不互相知道）；同一個 owner 也可以登記幾次。
   */
  bench(owner: string, fn: BenchSource): void {
    this.benches.push({ owner, fn })
    this.reg('battle.benches', owner, owner)
  }

  /**
   * 這一方現在叫得到的候補：每個來源照登記的順序回答，合起來。同一個 id 只留第一筆；已經在這一場裡的人不列：
   * 這一場有單位的 actor 等於他的 id（或 ref 是 { from: 'actor', id } 而 id 對得上）。不是角色的候補，來源拿到 battle、自己看有沒有已經在場裡。
   */
  benchOf(state: GameState, battle: BattleState, side: BattleSide): BenchEntry[] {
    const present = new Set<string>()
    for (const u of Object.values(battle.units)) if (u.actor) present.add(u.actor)
    const seen = new Set<string>()
    const out: BenchEntry[] = []
    for (const src of this.benches) {
      for (const e of src.fn(state, battle, side)) {
        if (seen.has(e.id)) continue
        seen.add(e.id)
        if (present.has(e.id) || (e.ref.from === 'actor' && typeof e.ref.id === 'string' && present.has(e.ref.id))) continue
        out.push(e)
      }
    }
    return out
  }

  /** 角色帶進戰鬥的裝備。 */
  loadout(owner: string, fn: LoadoutProvider): void {
    this.loadouts.push({ owner, fn })
    this.reg('battle.loadouts', owner, owner)
  }

  /**
   * 註冊一種效果（內容裡 { op, ... } 的 op）。op 重複就丟錯。核心自己不註冊任何效果：誰管那個領域誰註冊。
   * problems 是這個效果自己的格式檢查（effectProblems 會呼叫）。
   */
  effect(op: string, owner: string, fn: BattleEffectOp, opts: BattleEffectOpts = {}): void {
    this.addEffect(op, owner, fn, opts, '效果')
  }

  private addEffect(op: string, owner: string, fn: BattleEffectOp, opts: BattleEffectOpts, what: string): void {
    const old = this.effects.get(op)
    if (old) throw new Error(`${what}重複註冊：${op}（已經由 ${old.owner} 註冊）`)
    this.effects.set(op, { op, owner, fn, ...(opts.problems ? { problems: opts.problems } : {}) })
    this.reg('battle.effects', op, owner)
  }

  getEffect(op: string): BattleEffectDef | undefined {
    return this.effects.get(op)
  }

  /** 已經註冊的效果的 op。 */
  effectIds(): string[] {
    return [...this.effects.keys()]
  }

  /**
   * 檢查一串效果（每個來源載入內容時都用它查）：每一筆的 op 查不查得到、who 與 if 在不在清單裡，再加那個效果自己的 problems。
   * 回傳每一個問題（一句一條，寫出是哪個 op）；空的就是合格。
   */
  effectProblems(list: unknown): string[] {
    if (!Array.isArray(list)) return ['效果要是 { op, ... } 的陣列']
    const out: string[] = []
    list.forEach((e, i) => {
      if (!isRecord(e) || typeof e.op !== 'string' || !e.op) {
        out.push(`第 ${i + 1} 筆效果要是 { op, ... }`)
        return
      }
      const def = this.effects.get(e.op)
      if (!def) out.push(`不認得的效果 ${e.op}（還沒有功能註冊它；第 ${i + 1} 筆）`)
      for (const m of [whoProblem(e.who), ifProblem(e.if)]) if (m) out.push(`效果 ${e.op}：${m}`)
      if (def?.problems) out.push(...def.problems(e).map((m) => `效果 ${e.op}：${m}`))
    })
    return out
  }

  /** 舊名：註冊一種道具效果（= effect；道具效果現在是效果的一種）。 */
  itemOp(op: string, owner: string, fn: BattleEffectOp, opts: BattleEffectOpts = {}): void {
    this.addEffect(op, owner, fn, opts, '道具效果')
  }

  /** 舊名：用舊的道具效果的呼叫方式叫一個效果（補齊 source、pick、n、last）。 */
  getItemOp(op: string): ((ctx: BattleItemOpCtx, effect: Record<string, unknown>) => void) | undefined {
    const def = this.effects.get(op)
    if (!def) return undefined
    return (ctx, effect) => def.fn({ source: { kind: 'item', id: ctx.item, name: ctx.item }, pick: {}, n: {}, last: {}, ...ctx }, effect)
  }

  /** 舊名：已經註冊的效果的 op（= effectIds）。 */
  itemOpIds(): string[] {
    return this.effectIds()
  }

  /** 合起來的裝備。implants 只在有義體的時候才有這個鍵（沒有義體的角色回傳的東西和以前一樣）。 */
  loadoutOf(state: GameState, actor: ActorId, mode: string): Required<Omit<Loadout, 'implants'>> & { implants?: BattleImplant[] } {
    const out: Required<Omit<Loadout, 'implants'>> = { weapons: [], armor: 0, evade: 0, quick: [], tags: [] }
    const implants: BattleImplant[] = []
    for (const p of this.loadouts) {
      const l = p.fn(state, actor, mode)
      if (!l) continue
      out.weapons.push(...(l.weapons ?? []))
      out.armor += l.armor ?? 0
      out.evade += l.evade ?? 0
      out.quick.push(...(l.quick ?? []))
      out.tags.push(...(l.tags ?? []))
      implants.push(...(l.implants ?? []))
    }
    return implants.length ? { ...out, implants } : out
  }
}
