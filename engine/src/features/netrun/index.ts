// L6 功能：一趟網內的行程（CYBERSPACE 8.1、8.3 節；NETRUNNING 第 3～5 節；UI 第 5 節；dev/adr/0018 第六、七節；dev/work/M3-netrun.md）。
//
// 一種實作、兩種活動（都是 order 50）：face.net（委託副本開的那一段）與 netrun（自己潛進去的一趟）。同一份狀態 state.ext.netrun：
// 開一份生成的地圖、在上面走（站上節點算一個探索回合）、處理遭遇節點（開戰、潛行繞過）、閘門、休息點、登出、結束與交回。
// 這一張只有「本體」：入口、鏈路、遭遇、閘門、休息點；檔案庫、控制節點、人、陷阱、巡邏、安全點、六種目標在下一張（M3-netrun-nodes）。
//
// 接上核心的地方：
//   內容  net_region（區的規則表，overridable；內建 subnet）、netrun_rule（探索的數字，id: default）
//   活動  face.net、netrun（setup 見 start.ts 的 parseSetup；activity.end 的 outcome：done、left、retreat、located；result 帶 trace、peak、rounds、loot、located?、layer）
//   量表  trace（keyed: map；-30～100；AI 與玩家要的效果只在有這個功能的行程進行中時收、夾在 ±20）
//   報告  netrun.enter、.use（result 寫做了哪一件：fight、sneak、sneak_fail、rest、pass）、.descend、.pressure、.trace、.located、.logout、.end
//   格子  站上節點的探索回合（k.grid.onEnter）、遭遇節點與單向鏈路的放行（passRule）、這一格能做的事（usesOf）
//   戰鬥  k.battle.onEnd：只認 origin.ext.net.run 是這一趟的（贏了節點變地板、追蹤度寫回量表、全員拔線收尾）
//   掛鉤  report.after（門檻、通過、被定位、全員拔線之後的收尾）、activity.end（戰敗被接受：只收掉這一趟，不另外發 activity.end）
//   掛點  netrun.round、netrun.close（這個功能宣告，之後的區回答）
// 對外：netrunView、useNode、nodeUses、descend、logout。

import type { Feature, Kernel } from '../../core'
import { onDefeatAccepted, afterReport } from './close'
import { onBattleEnd } from './fight'
import { ACT_FACE, ACT_NET, OWNER, REGION_KIND, RULE_KIND, TRACE, readRun, regionProblems, ruleProblems } from './model'
import { startRun, setupOf } from './start'
import { installWalk } from './walk'

export {
  ACT_FACE, ACT_NET, DEFAULT_REGIONS, DEFAULT_RULES, EXT, NET_MODE, REGION_KIND, RULE_KIND, TRACE, encounterAfter, gradeOf, netExt, nodeAt, readRun, regionProblems, ruleProblems,
} from './model'
export type { CloseOutcome, CloseReturn, Fx, FoeNode, Goal, LayerCounts, NetExt, NetRegion, NetRun, NetrunRules, Rank, RunKind } from './model'
export { countsOf, netrunRules, regionOf } from './rules'
export { LAYER_NAME, layerLabel, layerSpec, parseSetup, startRun } from './start'
export { closeDraft, logout, logoutBlock } from './close'
export { descend, gateBlock, gateOpen, nodeUses, usesOfMarker, useNode } from './uses'
export { netrunView } from './view'
export type { NetrunView, NodeRef } from './view'

/**
 * 進行中放行的 doing 前綴（工單 M3-netrun 的驗收條件守著這張清單）：這一趟自己的報告、走格子、戰鬥與戰鬥結束的結算、重來、事件、戰敗的選擇、自由行動。
 * 其餘（交易、休息、接委託……）一律擋下，原因是一句話。
 */
export const NETRUN_ALLOW: readonly string[] = [
  'commit:netrun.', 'grid.', 'commit:grid.', 'battle.', 'commit:battle.', 'chain:battle_end', 'battle.retry', 'event.start', 'commit:event.', 'commit:defeat.', 'chain:free_action',
]

export const netrunFeature: Feature = {
  id: OWNER,
  install(k: Kernel) {
    k.content.defineKind({ kind: REGION_KIND, owner: OWNER, overridable: true, validate: regionProblems })
    k.content.defineKind({ kind: RULE_KIND, owner: OWNER, overridable: true, validate: ruleProblems })

    // 追蹤度：一座子網一條（鍵是這一趟的地圖實例），往下一層不歸零。AI 與玩家要的效果只在這個功能的行程進行中時收；連動讓這一段的上升減半（trace_half）只管效果進來的量
    k.meters.define({
      kind: TRACE, owner: OWNER, name: '追蹤度', min: -30, max: 100, start: 0, keyed: 'map', cap: { down: 20, up: 20 },
      accepts: (state) => (readRun(state) ? null : '追蹤度只在潛進網內的一趟裡有。'),
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
    k.hooks.on('activity.end', OWNER, ({ state, kind, origin, outcome }) => (kind === 'defeat' && outcome === 'accept' ? onDefeatAccepted(k, state, origin) : undefined))

    // 一份報告套用之後：門檻、通過、被定位、全員拔線之後的收尾
    k.hooks.on('report.after', OWNER, ({ state, report }) => afterReport(k, state, report))
  },
}

