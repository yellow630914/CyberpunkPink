// L6 功能：迷宮館（CYBERSPACE 3.3 節、8.1 節密度表迷宮館那一列、8.2 節；ENEMIES 第 9 節最後一列；DATA 第 10 節 maze 那一列；dev/adr/0018 第六節與第十三節；dev/work/M3-maze.md）。
//
// 合法的地下城：報名（組別、押金、能用的構裝）、三層、機關、寶箱與獎品表、時間與評價、比賽籌碼、打輸只是斷線。它是生成器與「一趟網內的行程」的第二個使用者：
// 只靠活動 netrun（launch；setup.region 整筆放這一區的規則）、掛點 netrun.round 與 netrun.close、地圖實例的 ext.net（只讀格式）與 k.grid 的註冊接上去，不 import netrun。
//
// 接上核心的地方：
//   內容  maze_rule（規則表，overridable：組別、每層的標準回合數、評價、機關的感載、寶箱怪的機率、籌碼的價值……；id: default）、maze_table（寶箱表與獎品表）
//   掛點  netrun.round（每層用了幾個探索回合）、netrun.close（結算）；battle.onEnd（戰鬥的回合數與倒下的人次、寶箱怪打贏之後給箱子裡的東西）
//   格子  passRule net_puzzle（機關擋路）、usesOf（寶箱與機關）、onEnter（警報節點叫出兩個小兵）
//   掛鉤  report.after：往下一層之後的休息（感載 −10）、結算之後發 maze.result 並把狀態清乾淨
//   效果  只用別人登記的：deck_rental（新手組租館方的比賽甲板、結算時收回）
//   放行  netrun 進行中放行 commit:maze.（解機關、開寶箱、層間休息、結果）
//   狀態  state.ext.maze：{ id, bracket, grade, deposit, rented, origin, over? }；累積的（每層回合、倒下、籌碼）在核心的計數器 maze:<id>:…
// 這一區的預設（9 × 7、挖 18～24 步、沒有追蹤度、倒下不加沉溺、每層 2 場遭遇、機關 1、寶箱 1～2、陷阱 0～1）寫在 model.ts 的 DEFAULT_REGION；資料的 maze_rule.region 可以蓋掉。
// 對外：brackets、enter（報名）、solve、open、useMaze、mazeView、mazeRules、mazeRegion。
//
// 沒有做的（CYBERSPACE 8.2 節）：延長賽（第 4、5 層）、直播與觀看數、主題（d8）、十二條詞條；主題、館主、獎品的內容是資料。
// 報告（kind netrun）：maze.enter、maze.use、maze.rest、maze.result。

import type { ContentEntry, Feature, GameState, Kernel } from '../../core'
import { ContentError, isRecord } from '../../core'
import type { MazeTable } from './model'
import { ACT_NETRUN, OWNER, RULE_KIND, TABLE_KIND, mazeRules, ruleProblems, tableProblems, tableOf } from './model'
import type { RunLike } from './ops'
import { closeRun, descendedInMaze, onBattleEnd, onEnterAlarm, onRound, pendingResult, restDraft, resultDraft, usesOfMarker } from './ops'

export { brackets, enter, enterBlocks, nearUses, open, openBlock, solve, solveBlock, useMaze } from './ops'
export type { BracketRow, EnterOpts } from './ops'
export { mazeView } from './view'
export type { MazeView } from './view'
export { DEFAULT_REGION, DEFAULT_RULES, EXT as MAZE_EXT, REGION_ID as MAZE_REGION, RULE_KIND, TABLE_KIND, mazeChange, mazeRegion, mazeRules, rate, readMaze, ruleProblems, tableProblems, tableOf } from './model'
export type { BracketDef, BracketGrade, MazeResult, MazeRules, MazeState, MazeTable, RatingRow, SolveOption, TableRow } from './model'

type AnyHook = (name: string, owner: string, fn: (payload: never) => unknown) => void

export const mazeFeature: Feature = {
  id: OWNER,
  install(kernel) {
    const k = kernel as Kernel
    k.content.defineKind({ kind: RULE_KIND, owner: OWNER, overridable: true, validate: ruleProblems })
    k.content.defineKind({ kind: TABLE_KIND, owner: OWNER, validate: tableProblems })

    // 掛點 netrun.round、netrun.close 是 features/netrun 宣告的：這裡只認名字與格式，不 import
    const on = k.hooks.on.bind(k.hooks) as unknown as AnyHook
    on('netrun.round', OWNER, (({ state, run }: { state: GameState; run: RunLike }) => onRound(state, run)) as never)
    on('netrun.close', OWNER, (({ state, run, outcome }: { state: GameState; run: RunLike; outcome: string }) => closeRun(k, state, run, outcome)) as never)

    // 戰鬥結束：回合數、倒下的人次、寶箱怪
    k.battle.onEnd(OWNER, ({ state, battle, outcome }) => onBattleEnd(k, state, battle, outcome))

    // 一份報告套用之後：結算完了就發 maze.result；往下一層之後休息
    k.hooks.on('report.after', OWNER, ({ state, report }) => {
      if (report.rewind || report.action === 'rewind') return undefined
      const over = pendingResult(state)
      if (over) return [resultDraft(state, over)]
      return descendedInMaze(k, state, report.action ?? '') ? [restDraft(k, state)] : undefined
    })

    // 機關擋路：站到它旁邊解開才會變成地板；寶箱與機關的用途；警報節點
    k.grid.passRule('net_puzzle', OWNER, () => '機關擋住了路：站到它旁邊，選一個辦法解開它。')
    k.grid.usesOf(OWNER, (ctx, marker) => usesOfMarker(ctx.k as Kernel, ctx.state, marker))
    k.grid.onEnter(OWNER, (ctx) => onEnterAlarm(ctx))

    // netrun 進行中放行迷宮館自己的報告
    k.activity.allow(ACT_NETRUN, 'commit:maze.', OWNER)
  },

  ready(k) {
    const problems: string[] = []
    const rules = mazeRules(k)
    if (k.content.hasKind('deck')) for (const [id, b] of Object.entries(rules.brackets)) if (b.deck && !k.content.has('deck', b.deck)) problems.push(`maze_rule 的 ${id} 組：比賽甲板 ${b.deck} 不在內容裡`)
    for (const [kind, want] of [['chest', rules.chest_table], ['prize', rules.prize_table]] as const) {
      if (want && !(k.content.hasKind(TABLE_KIND) && k.content.get(TABLE_KIND, want))) problems.push(`maze_rule：${kind === 'chest' ? '寶箱' : '獎品'}表 ${want} 不在內容裡`)
    }
    if (k.content.hasKind(TABLE_KIND)) {
      for (const t of k.content.list<MazeTable & ContentEntry>(TABLE_KIND)) {
        for (const [i, row] of (Array.isArray(t.rows) ? t.rows : []).entries()) {
          for (const e of Array.isArray(row.give) ? row.give : []) {
            if (isRecord(e) && typeof e.kind === 'string' && !k.effects.has(e.kind)) problems.push(`${TABLE_KIND}/${t.id}：rows[${i}] 的效果 ${e.kind} 沒有人登記`)
          }
        }
      }
      void tableOf
    }
    if (problems.length) throw new ContentError(problems)
  },
}
