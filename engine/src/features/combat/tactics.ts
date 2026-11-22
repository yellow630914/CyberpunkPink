// L6 功能 combat：制伏、脫離、投降。COMBAT_SYSTEM 1.3 節、第 7 節、8.5 節。
// 制伏灰掉時，每一個缺的條件各寫一句（PLAN 5.5 第一項）。

import type { BattleActionDef, BattleKernel, BattleUnit, BattleView, ItemEntry } from '../../core'
import { losingTurn, otherSide, unitsOf } from '../../core'

const OWNER = 'combat'
const MODES = ['meat']

/** 束帶或鎖橋器：快取格裡數量大於 0、內容的 tags 包含 restraint。 */
function restraints(k: BattleKernel, u: BattleUnit): Array<{ slot: { item: string; qty: number }; entry: ItemEntry }> {
  const out = []
  for (const slot of u.quick) {
    if (slot.qty <= 0) continue
    const entry = k.content.get<ItemEntry>('item', slot.item)
    if (entry?.tags?.includes('restraint')) out.push({ slot, entry })
  }
  return out
}

const subdueDc = (view: BattleView, t: BattleUnit): number => {
  const d = view.n.subdueDc
  return d.base + t.grade * d.perGrade + (t.rank === 'elite' ? d.elite : t.rank === 'boss' ? d.boss : 0)
}

/** 制伏在 ENEMIES 4.3 節的行動分；站在制伏得到人的那一格，位置分也加這麼多（dev/adr/0014）。 */
const SUBDUE_SCORE = 4

/**
 * 這個人從 slot 那一格制伏不了 t 的原因，一條一個條件（COMBAT_SYSTEM 第 7 節）；空的就是制伏得了。
 * 畫面的灰掉原因（targets）與 AI 的位置分（aiSlotScore）共用。
 */
function subdueBlocks(slot: number, t: BattleUnit): string[] {
  const blocks: string[] = []
  if (!losingTurn(t)) blocks.push('對方沒有在過載、失去回合。')
  if (slot !== 1 || t.slot !== 1) blocks.push('要在近身：雙方都站在第 1 格。')
  if (t.rank !== 'minion' && t.layers < t.layersMax) blocks.push(`精英與首領要餘韻疊滿才制伏得了（現在 ${t.layers}／${t.layersMax} 層）。`)
  return blocks
}

const subdue: BattleActionDef = {
  id: 'subdue', owner: OWNER, name: '制伏', desc: '用束帶或鎖橋器綁住一個過載、失去回合的近身敵人，讓他退出戰鬥；要先過一次格鬥檢定。',
  group: 'tactic', icon: 'subdue', order: 4, target: 'foe', modes: MODES,
  cost: () => ({ ap: 2 }),
  blocks: (view, u) => (restraints(view.k, u).length ? [] : ['快取格裡沒有束帶或鎖橋器。']),
  targets: (view, u) => unitsOf(view.battle, otherSide(u.side)).map((t) => ({ target: { unit: t.id }, blocks: subdueBlocks(u.slot, t), hint: { dc: subdueDc(view, t) } })),
  run: (run, u, target) => {
    if (!target || !('unit' in target)) return
    const t = run.unit(target.unit)
    const { ok } = run.save(u, 'body', 'brawl', subdueDc(run, t), '制伏', [], ['subdue'])
    if (!ok) return
    // 有束帶先用束帶；鎖橋器不消耗（內容的 consumable 寫 false）
    const have = restraints(run.k, u)
    const use = have.find((x) => x.entry.consumable !== false) ?? have[0]
    if (use && use.entry.consumable !== false) {
      use.slot.qty -= 1
      if (use.slot.qty <= 0) u.quick = u.quick.filter((q) => q.qty > 0)
    }
    run.setOut(t, 'subdued', u)
  },
  // 要活的敵人（打法 capture）優先制伏（ENEMIES 4.1、4.3 節：分數 4，和別的行動一起平方加權抽）
  aiScore: (_v, u, t) => (t && u.ai?.mode === 'capture' ? SUBDUE_SCORE : null),
  // AI 挑的目標制伏不了、但場上有制伏得了的人：改對那個人動手（選第一個；第 1 格只會有一個人）
  aiTarget: (view, u, t) => {
    const ok = unitsOf(view.battle, otherSide(u.side)).filter((x) => subdueBlocks(u.slot, x).length === 0)
    const pick = t && ok.some((x) => x.id === t.id) ? t : ok[0]
    return pick ? { unit: pick.id } : t ? { unit: t.id } : null
  },
  // 站在那一格就制伏得到人：位置分加上制伏的分數，要抓人的敵人才不會先換位走開（核心的 AI 先算位置、再挑行動）
  aiSlotScore: (view, u, slot) => (u.ai?.mode === 'capture' && unitsOf(view.battle, otherSide(u.side)).some((t) => subdueBlocks(slot, t).length === 0) ? SUBDUE_SCORE : 0),
}

const flee: BattleActionDef = {
  id: 'flee', owner: OWNER, name: '脫離', desc: '全隊一起離開這場戰鬥，由隊上運動或隱匿最好的人擲檢定；失敗只是白花了行動點。',
  group: 'system', icon: 'flee', order: 1, target: 'none', hold: true, modes: MODES,
  cost: () => ({ ap: 2 }),
  blocks: (view) => (view.battle.origin.escapable ? [] : ['副本裡的戰鬥不能脫離，只能撤退。']),
  run: (run, u) => {
    const team = unitsOf(run.battle, u.side)
    const score = (x: BattleUnit) => Math.max(x.skills.athletics ?? 0, x.skills.stealth ?? 0)
    let best = team[0]
    for (const x of team) if (!best || score(x) > score(best)) best = x
    if (!best) return
    const useAthletics = (best.skills.athletics ?? 0) >= (best.skills.stealth ?? 0)
    const top = Math.max(0, ...unitsOf(run.battle, otherSide(u.side)).map((f) => f.grade))
    const dc = run.n.fleeDc.base + top * run.n.fleeDc.perGrade
    const { ok } = useAthletics ? run.save(best, 'body', 'athletics', dc, '脫離', [], ['flee']) : run.save(best, 'reflex', 'stealth', dc, '脫離', [], ['flee'])
    if (ok) {
      run.say(`${best.name} 帶著全隊脫離了戰鬥。`, 'flee', { unit: best.id }, best)
      run.finish('fled', '全隊脫離了這場戰鬥，敵人還在原地。')
    } else {
      run.say(`${best.name} 沒能甩開敵人，脫離失敗。`, 'flee.fail', { unit: best.id }, best)
    }
  },
}

const surrender: BattleActionDef = {
  id: 'surrender', owner: OWNER, name: '投降', desc: '放下武器認輸，戰鬥立刻結束，算戰敗；不花行動點，一定成功。',
  group: 'system', icon: 'surrender', order: 2, target: 'none', hold: true, modes: MODES,
  cost: () => ({ ap: 0 }),
  run: (run, u) => {
    run.say(`${u.name} 舉起手投降了。`, 'surrender', { unit: u.id }, u)
    run.finish('surrender', '投降：戰鬥結束，算戰敗。')
  },
}

export const TACTIC_ACTIONS: BattleActionDef[] = [subdue, flee, surrender]
