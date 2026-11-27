// 找上門的結算（OPINION 第 6 節；dev/adr/0020 V35）：對手落後到條件成立、這一場還沒用過，在它的回合一開始停下來（pending: 'visit'，turn.ts），
// 玩家按「結算」（opinion.visit，沒有選擇）：留守的人（隊伍裡沒坐編輯台的）擲 d20 ＋ 他們裡最高的戰鬥基本功（槍械、格鬥）＋（人數 − 1）對 DC（12 ＋ 強度 × 2）；
// 沒有人留守直接擋不住。畫面不切到戰鬥。
//   擋住：照常打完對手的回合；這一場正在直播（條件 live_on，有人註冊才問）時牌庫多一張「找上門的直播」（料 +4）。
//   擋不住：對手資料寫 capture 的（幫派、星旗）戰役立刻結束算敗，被帶走——先開戰敗事件（takenDraft；M5-defeat-entry）；其餘你下一回合不能行動（編輯點 0、不能佔領）。
// 自己發起的戰役與委託副本同一套。

import type { GameState, Kernel, Launch, ReportDraft } from '../../core'
import { ActionBlocked, clone } from '../../core'
import { warBlock } from './cards'
import { OPINION_SNAPSHOT } from './faceopen'
import { DEFEAT_ENTRY, VISIT_ACTION, readWar } from './model'
import type { War, WarCard } from './model'
import { Run } from './run'
import { advance, closeDraft } from './turn'

/** 戰鬥基本功：槍械與格鬥（COMBAT_SYSTEM 的命中用哪一組）。 */
export const VISIT_SKILLS = ['firearms', 'brawl'] as const
export const VISIT_LIVE_CARD = 'card_visit_live'

/** 留守的人：隊伍裡（含主角）沒坐編輯台的、而且確實在狀態裡。 */
export function stayOf(state: Pick<GameState, 'pc' | 'party' | 'actors'>, w: Pick<War, 'desk'>): string[] {
  const seated = new Set(w.desk.map((s) => s.actor))
  const ids = [...(state.pc ? [state.pc] : []), ...state.party]
  return [...new Set(ids)].filter((id) => Object.hasOwn(state.actors, id) && !seated.has(id))
}

/** 一個人的戰鬥基本功（槍械、格鬥裡高的那一個）。 */
export const combatSkill = (state: Pick<GameState, 'actors'>, id: string): number => Math.max(0, ...VISIT_SKILLS.map((s) => state.actors[id]?.skills[s] ?? 0))

export function visitBlock(k: Kernel, state: GameState): string | null {
  const w = readWar(state)
  if (!w) return '現在沒有輿論戰。'
  if (w.pending !== 'visit') return w.pending === undefined ? '現在沒有人找上門。' : (warBlock(w) ?? '現在沒有人找上門。')
  return k.activity.blockOf(state, `commit:${VISIT_ACTION}`)
}

const isLive = (k: Kernel, state: GameState): boolean => k.conditions.kinds().includes('live_on') && k.conditions.test({ kind: 'live_on' } as never, { state, stats: k.stats, timeRules: k.timeRules })

/**
 * 被帶走（對手 capture）：世界裡有戰敗的入口（活動 defeat.entry）就先開戰敗事件；沒有就像以前，交回 lost 帶 captured。
 *   face：戰役清掉、不發這一場的 activity.end——交回由戰敗的接受接手（副本聽 kind defeat，算失敗就回到入口）；「重來」回到開戰前的 opinion 快照。
 *   solo：照舊結算（標準結果列的敗、議題的 on_end），同一份報告多帶 launch；沒有開戰前的快照，沒有「重來」。
 * origin 是這一場的發起人（副本的 origin 帶 commission 與 stage，副本認得）。
 */
function takenDraft(run: Run): ReportDraft {
  const { k, state, w } = run
  if (!k.activity.get(DEFEAT_ENTRY)) return closeDraft(run, VISIT_ACTION)
  const face = w.mode === 'face'
  const launch: Launch = {
    kind: DEFEAT_ENTRY, origin: clone(w.origin),
    setup: {
      reason: 'opinion_captured', ...(state.pc ? { who: state.pc } : {}), ...(w.foe.faction !== undefined ? { faction: w.foe.faction } : {}),
      ...(state.location.district ? { where: state.location.district } : {}), ...(face ? { retry: OPINION_SNAPSHOT } : {}),
    },
  }
  const d = face ? run.draft(VISIT_ACTION, 'captured', run.beats.map((b) => b.text).join(''), { war: null }) : closeDraft(run, VISIT_ACTION)
  d.launch = [...(d.launch ?? []), launch]
  return d
}

/** 結算找上門。 */
export function resolveVisit(k: Kernel, state: GameState): ReportDraft {
  const block = visitBlock(k, state)
  if (block) throw new ActionBlocked(block)
  const run = new Run(k, state, readWar(state), 'visit')
  const w = run.w
  const rule = run.rules.visit
  const dc = rule.dc_base + rule.dc_per_strength * w.foe.strength
  const stay = stayOf(state, w)
  let roll = 0
  let total = 0
  let held = false
  if (stay.length > 0) {
    roll = run.rng.int(1, 20)
    const best = Math.max(...stay.map((id) => combatSkill(state, id)))
    total = roll + best + (stay.length - 1)
    held = total >= dc
    run.note(`留守的人去擋：骰 ${roll}，加上最好的戰鬥基本功 ${best}、人數加成 ${stay.length - 1}，合計 ${total}，對 DC ${dc}，${held ? '擋住了' : '沒有擋住'}。`, {
      tag: 'opinion.visit', data: { roll, total, dc, held, stay, best, bonus: stay.length - 1 },
    })
  } else {
    run.note(`沒有人留守，擋不住（DC ${dc}）。`, { tag: 'opinion.visit', data: { roll: 0, total: 0, dc, held: false, stay } })
  }
  w.visit = { roll, total, dc, held, stay }
  delete w.pending

  if (held) {
    run.note('找上門的人被擋在門外，這一場照常打下去。', { tag: 'opinion.visit.held', plain: '對手派來的人被擋在了門外。' })
    if (isLive(k, state) && rule.live_voice > 0) {
      const card: WarCard = { id: VISIT_LIVE_CARD, name: '找上門的直播', kind: 'fuel', cost: rule.live_voice >= run.rules.deck.fuel_two_at ? 2 : 1, voice: rule.live_voice }
      w.custom = { ...(w.custom ?? {}), [card.id]: card }
      w.deck = run.shuffle([...w.deck, card.id])
      run.note(`這一場正在直播，整個過程都播了出去：牌庫多一張「${card.name}」（聲量 +${rule.live_voice}）。`, { tag: 'opinion.visit.live', data: { card: card.id, voice: rule.live_voice }, plain: '找上門的過程被直播了出去，成了一張好料。' })
    }
    advance(run)
    return run.draft(VISIT_ACTION, w.turn === 'ended' ? 'ended' : 'held', run.beats.map((b) => b.text).join(''))
  }
  if (w.foe.capture === true) {
    run.note('對手的人闖進編輯台，把你帶走了。', { tag: 'opinion.visit.captured', plain: '對手的人闖進編輯台，把你帶走了。' })
    run.finish('visit', undefined, true)
    return takenDraft(run)
  }
  w.foe_state.visit_stun = true
  run.note('留守的人沒擋住，編輯台被牽制了一陣：你下一回合動不了。', { tag: 'opinion.visit.stunned', plain: '對手的人鬧了進來，編輯台被攪得動彈不得。' })
  advance(run)
  return run.draft(VISIT_ACTION, w.turn === 'ended' ? 'ended' : 'stunned', run.beats.map((b) => b.text).join(''))
}
