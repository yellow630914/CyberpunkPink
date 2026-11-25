// 核心物件（L5 的最上面）：所有的登錄表與掛鉤掛在一個 kernel 上。功能用 install(kernel) 把自己接上。

import { ActionRegistry, FREE_ACTION } from './action/kinds'
import type { ActionKernel } from './action/action'
import { ActivityRegistry } from './action/activity'
import { registerCoreActivities } from './action/coreActivities'
import { registerCoreBattleActions } from './battle/actions'
import { unitTracks } from './battle/field'
import { BattleRegistry } from './battle/registry'
import { MOD_KINDS, registerBattleKinds, registerWeaponClassKind } from './battle/rules'
import { registerProductKinds } from './content/product'
import { ContentError } from './content/registry'
import { specialMapProblems } from './grid/model'
import { GridRegistry } from './grid/registry'
import { createRulesKernel } from './rules/kernel'
import { passiveContentProblems } from './rules/passive'

export interface Kernel extends ActionKernel {
  /** 戰鬥的登錄表：行動、掛點、修正、單位的來源（現實與內海共用同一套引擎；dev/adr/0010） */
  battle: BattleRegistry
  /** 活動的登錄表：誰開誰的東西、進行中擋住什麼、做完交回給誰（戰鬥與等著選的戰敗核心內建；dev/adr/0016） */
  activity: ActivityRegistry
  /** 格子地圖的登錄表：站上標記會發生什麼、門過不過得去（現實的固定版面與內海的隨機生成共用；dev/adr/0012） */
  grid: GridRegistry
  /** 已經裝上的功能的 id */
  features: string[]
  /** 還沒跑第二段的功能 */
  pendingReady: Feature[]
  /** 會給內容警告的功能（Feature.warnings）；contentWarnings 照順序問它們 */
  warners: Feature[]
}

/** 一個 L6 的功能：只往下 import 核心，用登錄表與掛鉤把自己接上。功能之間不直接 import。 */
export interface Feature {
  id: string
  /** 第一段：註冊登錄表與掛鉤（內容種類、變更、效果、條件、衍生數值、檢定修正、行動種類……）。這時內容還沒載入 */
  install(kernel: Kernel): void
  /** 第二段（可以沒有）：內容載入之後呼叫一次。要讀內容才能註冊的東西放這裡（例：照資料註冊行動種類） */
  ready?(kernel: Kernel): void
  /**
   * 資料檢查的警告（可以沒有）：內容載入之後問，回傳一串完整的句子（寫出是哪一筆內容、哪裡不對勁、為什麼要緊）。
   * 警告不擋載入、不丟錯：只是「格式合格、但多半不是你要的」（例：網內的敵人沒有武器構裝，進內海之後打不了任何人）。唯讀，不改任何東西。
   */
  warnings?(kernel: Kernel): string[]
}

export function createKernel(features: Feature[] = []): Kernel {
  const base = createRulesKernel()
  const actions = new ActionRegistry(base.probe)
  actions.register(FREE_ACTION)
  registerBattleKinds(base.content)
  registerWeaponClassKind(base.content)
  // 設計圖、零件、怪癖（義體、組裝、交易、建角共用的格式；dev/adr/0019 第一節）
  registerProductKinds(base.content)
  const battle = new BattleRegistry(base.probe)
  registerCoreBattleActions(battle)
  registerPassiveBattle(base, battle)
  // 地圖的定義（DATA 9.3 節：一個模板一筆，裡面一到幾張圖）
  base.content.defineKind({ kind: 'special_map', owner: 'core', validate: specialMapProblems })
  const activity = new ActivityRegistry(base.probe)
  registerCoreActivities(activity)
  const k: Kernel = Object.assign(base, { actions, battle, activity, grid: new GridRegistry(base.probe), features: [] as string[], pendingReady: [] as Feature[], warners: [] as Feature[] })
  for (const f of features) installFeature(k, f)
  return k
}

/**
 * 被動效果在戰鬥裡的兩個接點（dev/adr/0019 第二節）：每一種戰鬥修正（單位有 actor 時，這個人身上 mod 類的每一筆變成一個 RollPart，source 是那一筆的來源；
 * 寫了 layer 的只在那一層的戰場算，看這一場的 mode.layer），與 unit.ready（unit_tag 加到單位的標籤）。核心掛一次，功能不必自己掛。
 */
function registerPassiveBattle(k: Pick<Kernel, 'passives'>, battle: BattleRegistry): void {
  k.passives.defineMods(MOD_KINDS)
  // （有的測試只給半個 view，沒有 state：沒有狀態就沒有被動效果）
  battle.modifier('passives', (q) => (q.unit.actor && q.view.state?.actors[q.unit.actor] ? k.passives.modParts(q.view.state, q.unit.actor, q.kind, { layer: q.view.mode.layer, tags: q.tags, tracks: unitTracks(q.unit) }) : []))
  battle.on('unit.ready', 'passives', ({ run, unit }) => {
    if (!unit.actor || !run.state.actors[unit.actor]) return
    for (const tag of k.passives.unitTags(run.state, unit.actor)) if (!unit.tags.includes(tag)) unit.tags.push(tag)
  })
}

export function installFeature(k: Kernel, f: Feature): void {
  if (k.features.includes(f.id)) throw new Error(`功能重複安裝：${f.id}`)
  f.install(k)
  k.features.push(f.id)
  if (f.ready) k.pendingReady.push(f)
  if (f.warnings) k.warners.push(f)
  k.probe.emit('core/kernel', 'feature.install', { id: f.id })
}

/**
 * 內容載入之後呼叫：跑每個功能的第二段，再做核心自己的整體檢查。可以重複呼叫，每個功能只跑一次。
 * 核心的檢查排在所有功能的第二段之後：設計圖、零件、怪癖的 effects 是被動效果，條件種類要等功能都裝上才知道（dev/adr/0019 第二節）；
 * 不合格的丟 ContentError，每一條以「<種類>/<id>：」開頭。
 */
export function readyFeatures(k: Kernel): void {
  for (const f of k.pendingReady.splice(0)) {
    f.ready!(k)
    k.probe.emit('core/kernel', 'feature.ready', { id: f.id })
  }
  const problems = passiveContentProblems(k)
  if (problems.length > 0) throw new ContentError(problems)
}

/** 內容載入之後問每個功能有沒有警告（資料檢查；Feature.warnings）：照功能安裝的順序、每個功能內部的順序接起來。沒有警告是空陣列。 */
export function contentWarnings(k: Kernel): string[] {
  return k.warners.flatMap((f) => f.warnings!(k))
}
