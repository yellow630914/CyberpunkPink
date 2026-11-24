// L6 功能：一趟網內的行程（CYBERSPACE 8.1、8.3 節；NETRUNNING 第 3～5 節；UI 第 5 節；dev/adr/0018 第六、七節；dev/work/M3-netrun.md）。
//
// 一種實作、兩種活動（都是 order 50）：face.net（委託副本開的那一段）與 netrun（自己潛進去的一趟）。同一份狀態 state.ext.netrun：
// 開一份生成的地圖、在上面走（站上節點算一個探索回合）、處理遭遇節點（開戰、潛行繞過）、閘門、休息點、登出、結束與交回。
// 第一張（M3-netrun）是本體：入口、鏈路、遭遇、閘門、休息點。第二張（M3-netrun-nodes）加其餘的節點：檔案庫與下載、控制節點、人、陷阱、巡邏、安全點、
// 六種目標（下載、接管、找人、打倒、放東西、帶出來）、探索中的管理行動（破解閘門、擦痕跡）與「帶出去才算數」。
//   nodes.ts（節點上的事）、rounds.ts（探索回合的引擎、巡邏撞上、陷阱）、patrol.ts（路線與位置）、loss.ts（帶出去才算數）、checks.ts（主控、檢定、後門鑰匙）。
// 第三張（M3-netrun-dig）加了自己去挖的一般子網（setup.entry: 'dig'）：dig.ts——設施類型（net_facility）決定層數、詞條（net_affix）、離開之後留著七天（同一個 site 是同一張圖）、
//   再進去追蹤度從一半起算、後門、離開時那家企業的敵對值、被定位之後清後門與多一個雜兵；自己的那一趟每個探索回合算 round_minutes 分鐘；感載在內海不自然消退（基礎 0，M3 修正批）：探索回合只消退衍生數值 net_load_decay（甲板的散熱 deck_cooling、技能、藥……）那麼多。
//
// 接上核心的地方：
//   內容  net_region（區的規則表，overridable；內建 subnet）、netrun_rule（探索的數字，id: default）、net_facility（設施類型）、net_affix（詞條）
//   活動  face.net、netrun（setup 見 start.ts 的 parseSetup；activity.end 的 outcome：done、left、retreat、located；result 帶 trace、peak、rounds、loot、located?、layer）
//   量表  trace（keyed: map；-30～100；AI 與玩家要的效果只在有這個功能的行程進行中時收、夾在 ±20）
//   報告  netrun.enter、.use（result 寫做了哪一件：fight、sneak、sneak_fail、rest、pass、download、plant、loot、seize、talk、hack、crack、cred、wipe、backdoor……）、.descend、.trap、.pressure、.trace、.located、.logout、.end、.expire
//   格子  站上節點的探索回合（k.grid.onEnter）、遭遇節點與單向鏈路的放行（passRule）、這一格能做的事（usesOf）
//   戰鬥  k.battle.onEnd：只認 origin.ext.net.run 是這一趟的（贏了節點變地板、追蹤度寫回量表、全員拔線收尾）
//   掛鉤  report.after（門檻、通過、被定位、全員拔線之後的收尾）、activity.end（戰敗被接受：只收掉這一趟，不另外發 activity.end）、time.passed（自己去挖的子網留著過期的清掉）
//   掛點  netrun.round、netrun.close（這個功能宣告，之後的區回答）
// 對外：netrunView、useNode、nodeUses、freeUses（不在哪一格都能做的：擦痕跡、留後門）、descend、logout、lossOf、tickRun。

import type { Feature, Kernel } from '../../core'
import { toMinutes } from '../../core'
import { onDefeatAccepted, afterReport } from './close'
import { onBattleEnd } from './fight'
import { expireDraft } from './dig'
import { ACT_FACE, ACT_NET, AFFIX_KIND, FACILITY_KIND, OWNER, REGION_KIND, RULE_KIND, TRACE, affixProblems, facilityProblems, readRun, regionProblems, ruleProblems } from './model'
import { startRun, setupOf } from './start'
import { installWalk } from './walk'

export {
  ACT_FACE, ACT_NET, AFFIX_KEYS, AFFIX_KIND, DEFAULT_REGIONS, DEFAULT_RULES, EXT, FACILITY_KIND, NET_MODE, REGION_KIND, RULE_KIND, TRACE, affixFxProblems, affixProblems, encounterAfter, facilityProblems, gradeOf,
  netExt, nodeAt, readRun, regionProblems, ruleProblems,
} from './model'
export type { AffixFx, ArchiveRow, CloseOutcome, CloseReturn, ControlState, DigInfo, Fx, FoeNode, Goal, LayerCounts, LootEntry, NetAffix, NetExt, NetFacility, NetRegion, NetRun, NetrunRules, ObjectiveKind, Patrol, Rank, RunKind, TrapState } from './model'
export { backdoorClears, combineFx, digOwner, expireDraft, expired, hostilityStart, isDigRun, keptOf, rollAffixes } from './dig'
export { DEFAULT_TRAP, OBJECTIVE_KINDS } from './model'
export { countsOf, netrunRules, regionOf } from './rules'
export { LAYER_NAME, layerLabel, layerSpec, parseSetup, startRun } from './start'
export { closeDraft, controlsTaken, logout, logoutBlock } from './close'
export { descend, freeUses, gateBlock, gateDc, gateOpen, nodeUses, tickRun, usesOfMarker, useNode } from './uses'
export { lossOf } from './loss'
export { adjacency, makePatrol, patrolAt, pickRoute, pingpong } from './patrol'
export { GOAL_NAME } from './start'
export { masterTier, mastersOf, keysIn, spendKey } from './checks'
export { scaleByGrade, isGoalNode } from './nodes'
export { netrunView } from './view'
export type { NetrunView, NodeRef } from './view'

/**
 * 進行中放行的 doing 前綴（工單 M3-netrun 的驗收條件守著這張清單）：這一趟自己的報告、走格子、戰鬥與戰鬥結束的結算、重來、事件、戰敗的選擇、
 * 成人場景（使用者 2026-11-24：網內放行所有成人場景；戰敗事件開的場景與流竄 AI 的場景都要開得起來）、自由行動。
 * 其餘（交易、休息、接委託……）一律擋下，原因是一句話。
 */
export const NETRUN_ALLOW: readonly string[] = [
  'commit:netrun.', 'grid.', 'commit:grid.', 'battle.', 'commit:battle.', 'chain:battle_end', 'battle.retry', 'event.start', 'commit:event.', 'commit:defeat.', 'scene.start', 'commit:scene.', 'chain:free_action',
]

export const netrunFeature: Feature = {
  id: OWNER,
  install(k: Kernel) {
    k.content.defineKind({ kind: REGION_KIND, owner: OWNER, overridable: true, validate: regionProblems })
    k.content.defineKind({ kind: RULE_KIND, owner: OWNER, overridable: true, validate: ruleProblems })
    // 自己去挖的子網（M3-netrun-dig）：設施類型（層數與名字）與詞條（封閉的鍵）
    k.content.defineKind({ kind: FACILITY_KIND, owner: OWNER, overridable: true, validate: facilityProblems })
    k.content.defineKind({ kind: AFFIX_KIND, owner: OWNER, overridable: true, validate: affixProblems })

    // 追蹤度：一座子網一條（鍵是這一趟的地圖實例），往下一層不歸零。AI 與玩家要的效果只在這個功能的行程進行中時收；連動讓這一段的上升減半（trace_half）只管效果進來的量
    k.meters.define({
      kind: TRACE, owner: OWNER, name: '追蹤度', min: -30, max: 100, start: 0, keyed: 'map', cap: { down: 20, up: 20 },
      // 只收這一趟自己的地圖的追蹤度（自己去挖的子網離開後地圖留七天：別座還留著的圖不能被效果改，M3 審查建議 2）
      accepts: (state, key) => {
        const run = readRun(state)
        return run ? (key === run.map ? null : '追蹤度只能動這一趟的那座網。') : '追蹤度只在潛進網內的一趟裡有。'
      },
      adjust: (state, _key, delta) => {
        const run = readRun(state)
        return run && delta > 0 && setupOf(run).fx.trace_half ? delta / 2 : delta
      },
    })

    for (const kind of [ACT_FACE, ACT_NET] as const) {
      k.activity.define({
        kind, owner: OWNER, order: 50,
        active: (state) => {
          const run = readRun(state)
          return run && run.kind === kind ? { id: run.id, label: `網內的行程（${run.region}）` } : null
        },
        allow: [...NETRUN_ALLOW],
        reason: () => '正在網內：只能做網內的事（走格子、處理節點、戰鬥、登出）。要離開就登出，或走到出口。',
        start: (k2, state, setup, origin) => startRun(k2 as Kernel, state, kind, setup, origin),
      })
    }
    // 委託副本是封閉的活動：它開 face.net、這一段的報告都要它放行
    k.activity.allow('commission', 'face.net.start', OWNER)
    k.activity.allow('commission', 'commit:netrun.', OWNER)

    installWalk(k, OWNER)

    // 戰鬥打完：只認這一趟開的戰鬥
    k.battle.onEnd(OWNER, ({ k: kernel, state, battle, outcome }) => onBattleEnd(kernel as Kernel, state, battle, outcome))

    // 戰敗被接受：只把這一趟收掉（關地圖、清狀態），不另外發 activity.end（0018 第十節）
    k.hooks.on('activity.end', OWNER, ({ state, kind, origin, outcome, result }) => (kind === 'defeat' && outcome === 'accept' ? onDefeatAccepted(k, state, origin, result) : undefined))

    // 一份報告套用之後：門檻、通過、被定位、全員拔線之後的收尾
    k.hooks.on('report.after', OWNER, ({ state, report }) => afterReport(k, state, report))

    // 時間過了：自己去挖的子網留著超過 keep_days 天的清掉（下次再進去重新生成）
    k.hooks.on('time.passed', OWNER, ({ state, to }) => {
      const last = state.reports[state.reports.length - 1]
      if (!last || last.rewind) return undefined
      const d = expireDraft(k, state, toMinutes(to))
      return d ? [d] : undefined
    })
  },
}

