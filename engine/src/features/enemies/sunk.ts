// 沉溺高的敵人被「推過線」（M4-enemies-m4；ENEMIES 12.1 節、CYBERWARE 第 6 節「NPC 也會溺感」、CORE_RULES 4.2 節「重度改造、高沉溺的人比同類高 1～2」）。
//
//   承受層數  資料的 mods.sink 在 60 以上 +1、100 以上再 +1：在組單位時算進 layersMax（stats.ts 的 sinkLayers）。
//   推過線    兩個時機，退出的方式都記成 sunk（不是 down、burnout、subdued）：
//             一、資料的沉溺在 80 以上（溺感邊緣）的敵人被灌倒（餘韻疊滿再過載；out.before 的 how 是 burnout）；
//             二、資料的沉溺不到 100、這一場被快感傷害加上去的沉溺使它到 100 以上（unit.sink 是這一場加的）：當場。
//             資料本來就在 100 以上的不算「推過線」（他一開始就是溺感者的種類，不會一開打就退出）。
//   後果      不能俘虜（制伏之外的退出，capture.ts 只收 subdued）；掉落照常、可以解剖（loot.ts、dissect.ts 的 out 清單有 sunk）；
//             結束的報告多一句，並接著提交一份帶觸發點 foe_sunk 的報告（之後的事是事件）。溺感者之後「不再屬於任何一方、去找最近的人」是事件的事，這裡只記退出的方式。

import type { BattleRun, BattleUnit, Change, GameState, Kernel, ReportDraft } from '../../core'
import { clone, unitTag } from '../../core'
import { SINK_EDGE, SINK_LINE } from './curve'
import { OWNER } from './kinds'
import { isRec, peekEnemy } from './unitdata'

/** 退出的方式。 */
export const SUNK = 'sunk'
/** 觸發點（事件導演讀；範圍 adult）。 */
export const FOE_SUNK_POINT = 'foe_sunk'
/** 結束的報告留下誰被推過線的地方（state.ext；foe_sunk 的報告送出之後清掉）。 */
export const SUNK_EXT = 'enemy_sunk'

/** 資料寫的沉溺（沒寫是 0）。 */
export const dataSink = (u: BattleUnit): number => {
  const v = peekEnemy(u).sink
  return typeof v === 'number' ? v : 0
}

const isFoe = (u: BattleUnit): boolean => u.side === 'foe' && !!u.enemy

/** 資料的沉溺不到 100、加上這一場加的沉溺到了 100 以上。 */
const crossed = (u: BattleUnit): boolean => dataSink(u) < SINK_LINE && dataSink(u) + u.sink >= SINK_LINE

function pushOver(run: BattleRun, u: BattleUnit, by?: BattleUnit): boolean {
  if (!run.setOut(u, SUNK, by)) return false
  run.say(`${unitTag(u)} 沉溺過了線，成了溺感者，不再是任何人的手下。`, undefined, { unit: u.id, sunk: true, sink: dataSink(u) + u.sink }, by)
  return true
}

/** 這一刻有沒有敵人被快感傷害推到 100：有就讓他退出（sunk）。 */
function sweep(run: BattleRun): void {
  for (const u of Object.values(run.battle.units)) if (isFoe(u) && !u.out && crossed(u)) pushOver(run, u)
}

/** 這場戰鬥裡退出方式是 sunk 的敵人。 */
export const sunkUnits = (units: Record<string, BattleUnit>): BattleUnit[] => Object.values(units).filter((u) => u.side === 'foe' && u.out === SUNK)

export function installSunk(k: Kernel): void {
  // 被灌倒：沉溺在 80 以上的敵人，餘韻疊滿再過載昏過去的那一刻，改成推過線。排在最後，別的功能擋下來的就不動它
  k.battle.on('out.before', OWNER, ({ run, unit, how, by, out }) => {
    if (how !== 'burnout' || out.prevent || !isFoe(unit) || dataSink(unit) < SINK_EDGE) return
    // 被擋下就當沒發生（setOut 回傳 false 時仍走原本的 burnout）
    if (pushOver(run, unit, by)) out.prevent = true
  }, 100)
  // 快感傷害加的沉溺推到 100：每一步（行動做完）、每個回合開頭與結束時看一次（不在攻擊的中間退出）
  k.battle.on('action.done', OWNER, ({ run }) => sweep(run))
  k.battle.on('turn.start', OWNER, ({ run }) => sweep(run))
  k.battle.on('turn.end', OWNER, ({ run }) => sweep(run))
  k.battle.on('round.start', OWNER, ({ run }) => sweep(run))

  // 結束：多一句，並留一筆給 foe_sunk 的報告
  k.battle.onEnd(OWNER, ({ battle }) => {
    const list = sunkUnits(battle.units)
    if (!list.length) return
    const changes: Change[] = [{ op: 'ext', key: SUNK_EXT, value: { battle: battle.id, units: list.map((u) => ({ unit: u.id, enemy: u.enemy, name: u.name, grade: u.grade, rank: u.rank })) } }]
    return { changes, lines: list.map((u) => `${u.name}的沉溺過了線，成了溺感者`) }
  })

  // 結束的報告套用之後：帶觸發點 foe_sunk 的報告（每個被推過線的敵人一個觸發點），並把記著的東西清掉
  k.hooks.on('report.after', OWNER, ({ state, report }): ReportDraft[] | void => {
    const rec = state.ext[SUNK_EXT]
    if (report.action !== 'battle.end' || !isRec(rec) || !Array.isArray(rec.units)) return
    const units = (rec.units as unknown[]).filter(isRec)
    return [{
      kind: report.kind, action: 'enemies.foe_sunk', location: clone(state.location), ...(state.pc ? { actor: state.pc } : {}), party: [], timeline: [],
      changes: [{ op: 'ext', key: SUNK_EXT, value: null }],
      outcome: { result: 'sunk', summary: `${units.map((u) => String(u.name)).join('、')}沉溺過了線，不再是敵人，也不再屬於任何一方。` },
      triggers: units.map((u) => ({ point: FOE_SUNK_POINT, where: { enemy: u.enemy, name: u.name, grade: u.grade, rank: u.rank } })),
    }]
  })
}

/** 給測試與畫面：現在狀態裡記著的、還沒送出 foe_sunk 的紀錄。 */
export const pendingSunk = (state: Pick<GameState, 'ext'>): unknown => state.ext[SUNK_EXT] ?? null
