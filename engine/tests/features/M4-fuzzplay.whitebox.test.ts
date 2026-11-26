// 白箱：M4 隨機玩（狀態機式的壞掉輸入）。對 M4 的世界（診所、槍店、大廳、拍賣、契約、藥、調校、未登錄零件、成人場景）每一步從選單隨機挑一個動作（有些參數是壞的），做很多步：
//   - 每一步只能成功，或丟「要玩家知道的原因」（ActionBlocked 這類寫了原因的錯），絕不丟 TypeError／RangeError／ReferenceError；
//   - 被 ActionBlocked 擋下的動作，狀態一個字都不變（壞輸入整串不套）；
//   - 每一份報告的變更套用之後等於狀態的變化（不變式第 2 條，observed）；
//   - 狀態隨時都過存檔的格式檢查（validateState）、存檔再讀檔狀態一樣（不變式第 6 條）、兩種錢不是負的、時間只往前走（除了回退、讀檔）、
//     沉溺不低於下限、衍生數值與被動效果不算出 NaN；
//   - 同一個種子、同一串動作，結果一樣（種子重播）。
// 規格：dev/invariants.md 第 1、2、5、6、7 條；GAME_DESIGN 第 3 節。和 M2-fuzzplay.whitebox.test.ts 一樣的寫法。

import { describe, expect, it, vi } from 'vitest'
import { ActionBlocked, toMinutes } from '../../src'
import { enterDraft as auctionEnter, auctionRunOf, bidDraft, bidOptions, leaveDraft as auctionLeave } from '../../src/features/auction'
import { chooseDraft, contractOf, payoffDraft } from '../../src/features/contract'
import { cyberOf, installDraft as cyberInstall, removeDraft as cyberRemove } from '../../src/features/cyberware'
import { detoxDraft, useDraft } from '../../src/features/drugs'
import { breathDraft, sleepDraft } from '../../src/features/rest'
import { sceneRawOf } from '../../src/features/scene'
import { therapyDraft } from '../../src/features/sink'
import { installDraft as tuningInstall, quietDraft, removeDraft as tuningRemove } from '../../src/features/tuning'
import { orderDraft as unregOrder, pendingParts } from '../../src/features/unreg'
import { validateState } from '../../src/shell/save'
import type { Game } from '../../src/shell/game'
import { AUCTION_HOUSE, BODY_BLOCKS, applyEffects, giveItem, giveMoney, giveProduct, makeBodyGame, observed, openScene, passTime, sceneCast, sceneDo, sceneEndTurn, standAt, stateHash, stopScene } from '../../src/testkit'

vi.setConfig({ testTimeout: 180_000 })

type Rnd = (n: number) => number
const mulberry = (seed: number): Rnd => {
  let a = seed >>> 0
  return (n) => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return Math.floor((((t ^ (t >>> 14)) >>> 0) / 4294967296) * n)
  }
}
const pick = <T>(r: Rnd, a: readonly T[]): T => a[r(a.length)]!

const SPOTS: Array<[string, string]> = [[BODY_BLOCKS.clinics, 'E1'], [BODY_BLOCKS.clinics, 'F1'], [BODY_BLOCKS.clinics, 'F2'], [BODY_BLOCKS.clinics, 'F3'], [BODY_BLOCKS.clinics, 'F4'], [BODY_BLOCKS.shops, 'F1'], [BODY_BLOCKS.shops, 'F4'], [BODY_BLOCKS.hall, 'F1'], [BODY_BLOCKS.hall, 'F3'], [BODY_BLOCKS.hall, 'E1'], ['tw_tower', 'E1']]
const BPS = ['bp_tw_arm', 'bp_tw_accel', 'bp_tw_eye', 'bp_tw_pump', 'bp_tw_plating', 'bp_tw_ears', 'bp_tw_tattoo', 'bp_tw_bridge']
const DRUGS = ['it_tw_cloud', 'it_tw_calm', 'it_tw_supp', 'it_nope']
const TUNINGS = ['tu_tw_still', 'tu_tw_spot', 'tu_nope']
const holder = { kind: 'eden', name: '樂園', faction: 'f_tw_eden', place: { district: 'tw_hive', block: 'tw_tower' } }

const ACTIONS: Array<[string, (g: Game, r: Rnd) => unknown]> = [
  ['stand', (g, r) => { const [b, m] = pick(r, SPOTS); return standAt(g, b, m) }],
  ['pass', (g, r) => passTime(g, pick(r, [1, 30, 60, 600, 1440, 4 * 1440, 8 * 1440]))],
  ['money', (g, r) => giveMoney(g, pick(r, [0, 500, 5000]), pick(r, [0, 200, 3000]))],
  ['give_part', (g, r) => giveProduct(g, pick(r, BPS), `U${g.state.seq.uid}_${r(1000)}`)],
  ['give_drug', (g, r) => giveItem(g, pick(r, DRUGS.slice(0, 3)), pick(r, [1, 2, 5]))],
  ['install', (g, r) => { const uid = pick(r, [...g.state.inventory.map((s) => (s.data as { uid?: string } | undefined)?.uid ?? ''), 'U_none']); return g.commit(cyberInstall(g.k, g.state, { actor: 'pc', uid, via: pick(r, ['clinic', 'unlicensed', 'black', 'self'] as const), side: pick(r, ['l', 'r', undefined] as const) })) }],
  ['remove', (g, r) => { const p = cyberOf(g.state, 'pc'); return g.commit(cyberRemove(g.k, g.state, { actor: 'pc', uid: p.length ? pick(r, p).uid : 'U_none', via: pick(r, ['clinic', 'unlicensed', 'black', 'self'] as const) })) }],
  ['drug_use', (g, r) => g.commit(useDraft(g.k, g.state, { actor: 'pc', item: pick(r, DRUGS) }))],
  ['detox', (g, r) => g.commit(detoxDraft(g.k, g.state, { actor: 'pc', drug: pick(r, DRUGS) }))],
  ['tuning', (g, r) => g.commit(tuningInstall(g.k, g.state, { id: pick(r, TUNINGS) }))],
  ['tuning_off', (g, r) => g.commit(tuningRemove(g.k, g.state, { id: pick(r, TUNINGS) }))],
  ['quiet', (g, r) => g.commit(quietDraft(g.k, g.state, { id: pick(r, TUNINGS), ...(r(3) === 0 ? { to: -5 } : {}) } as never))],
  ['therapy', (g, r) => g.commit(therapyDraft(g.k, g.state, r(2) ? { kind: 'counsel' } : {}))],
  ['breath', (g) => g.commit(breathDraft(g.k, g.state))],
  ['sleep', (g, r) => g.commit(sleepDraft(g.k, g.state, r(3) === 0 ? { spot: 'wild' } : {}))],
  ['contract_sign', (g, r) => applyEffects(g, [{ kind: 'contract_sign', type: pick(r, ['debt', 'work', 'private']), debt: pick(r, [0, 3000, 24000]), orders: ['errand', 'work', 'report'], holder }])],
  ['contract_order', (g, r) => applyEffects(g, [{ kind: 'order', order_kind: pick(r, ['errand', 'work', 'report', 'serve']), hours: pick(r, [2, 24, 96]), place: { district: 'tw_hive', block: 'tw_tower' } }])],
  ['contract_choose', (g, r) => { const o = contractOf(g.state)?.queue.filter((x) => x.state === 'sent'); if (!o?.length) throw new ActionBlocked('沒有指令。'); return g.commit(chooseDraft(g.k, g.state, { order: pick(r, o).id, how: pick(r, ['comply', 'resist'] as const) })) }],
  ['contract_payoff', (g) => g.commit(payoffDraft(g.k, g.state))],
  ['contract_hold', (g) => applyEffects(g, [{ kind: 'contract_hold', npc: 'npc_tw_ayin', type: 'private' }])],
  ['auction_enter', (g, r) => g.commit(auctionEnter(g.k, g.state, { house: AUCTION_HOUSE, pay: pick(r, ['cash', 'cred'] as const) }))],
  ['auction_bid', (g, r) => { const o = bidOptions(g.k, g.state); if (!o) throw new ActionBlocked('不在拍賣廳。'); const legal = [...o.raise.filter((x) => x.can).map((x) => ({ act: 'raise' as const, steps: x.steps! })), ...(o.wait.can ? [{ act: 'wait' as const }] : []), ...(o.fold.can ? [{ act: 'fold' as const }] : [])]; return g.commit(bidDraft(g.k, g.state, legal.length ? pick(r, legal) : { act: 'raise', steps: 9 } as never)) }],
  ['auction_leave', (g) => g.commit(auctionLeave(g.k, g.state))],
  ['unreg_order', (g, r) => g.commit(unregOrder(g.k, g.state, { type: pick(r, ['core', 'action', 'barrel', 'zzz']), grade: pick(r, [1, 2, 3, 4, 5]), ...(r(3) === 0 ? { material: 'bio' } : {}) }))],
  ['unreg_deliver', async (g) => { const p = pendingParts(g.state)[0]; if (!p) throw new ActionBlocked('沒有等著交貨的。'); return g.unregDeliver(p.id) }],
  ['scene_open', (g, r) => openScene(g, { with: [pick(r, ['npc_tw_ann', 'npc_tw_bo', 'npc_tw_zzz'])], nature: pick(r, ['mutual', 'trade', 'work']), goal: 'please', mode: pick(r, ['full', 'simple']) })],
  ['scene_do', (g, r) => sceneDo(g, pick(r, [{ kind: 'tease' }, { kind: 'dominate' }, { kind: 'yield' }, { kind: 'end_turn' }, { kind: 'talk' }, { kind: 'faster' }, { kind: 'skill', id: 'nope' }] as never[]))],
  ['scene_turn', (g) => sceneEndTurn(g)],
  ['scene_stop', (g) => stopScene(g)],
  ['undo', (g) => g.undoSteps(1)],
  ['save_load', (g) => { const err = g.load(g.save('manual', 'fuzz')); if (err) throw new Error(`讀檔失敗：${err}`) }],
]

const isCrash = (e: unknown): boolean => e instanceof TypeError || e instanceof RangeError || e instanceof ReferenceError

async function run(seed: number, steps: number): Promise<{ hash: string; log: string[] }> {
  const rnd = mulberry(seed * 7919 + 11)
  const g = makeBodyGame({ seed, actors: sceneCast('ann', 'bo') }).game
  const log: string[] = []
  const { violations } = await observed(g, async () => {
    let lastTime = toMinutes(g.state.time)
    for (let i = 0; i < steps; i++) {
      const [name, fn] = ACTIONS[rnd(ACTIONS.length)]!
      const before = stateHash(g.state)
      try {
        await fn(g, rnd)
        log.push(`${name}:ok`)
      } catch (e) {
        if (isCrash(e)) throw new Error(`第 ${i + 1} 步 ${name} 丟了 ${(e as Error).name}：${(e as Error).message}\n${(e as Error).stack?.split('\n').slice(0, 4).join('\n')}`)
        log.push(`${name}:${e instanceof ActionBlocked ? 'blocked' : 'err'}`)
        if (e instanceof ActionBlocked && !['stand', 'scene_turn'].includes(name)) expect(stateHash(g.state), `第 ${i + 1} 步 ${name} 被擋下之後狀態變了`).toBe(before)
      }
      const problems = validateState(JSON.parse(JSON.stringify(g.state)))
      expect(problems, `第 ${i + 1} 步 ${name} 之後`).toEqual([])
      expect(g.state.money.cash).toBeGreaterThanOrEqual(0)
      expect(g.state.money.cred).toBeGreaterThanOrEqual(0)
      if (name !== 'undo' && name !== 'save_load') expect(toMinutes(g.state.time), `第 ${i + 1} 步 ${name} 之後時間倒退`).toBeGreaterThanOrEqual(lastTime)
      lastTime = toMinutes(g.state.time)
      // 衍生數值與被動效果不是 NaN；沉溺不低於下限
      const pc = g.state.actors.pc!
      for (const stat of ['max_hp', 'load_cap', 'ap_max', 'sink_floor']) if (g.k.stats.hasStat(stat)) expect(Number.isFinite(g.k.stats.stat(g.state, 'pc', stat)), `第 ${i + 1} 步 ${name} 之後 ${stat}`).toBe(true)
      for (const e of g.k.passives.of(g.state, 'pc')) if ('amount' in e) expect(Number.isFinite(e.amount), `第 ${i + 1} 步 ${name} 之後被動效果 ${e.label}`).toBe(true)
      if (g.k.stats.hasStat('sink_floor') && !sceneRawOf(g.state)) expect(pc.sink, `第 ${i + 1} 步 ${name} 之後沉溺低於下限`).toBeGreaterThanOrEqual(Math.min(100, g.k.stats.stat(g.state, 'pc', 'sink_floor')))
    }
  })
  expect(violations).toEqual([])
  if (auctionRunOf(g.state)) g.commit(auctionLeave(g.k, g.state))
  const before = stateHash(g.state)
  expect(g.load(g.save('manual', 'end'))).toBeNull()
  expect(stateHash(g.state)).toBe(before)
  return { hash: before, log }
}

describe('白箱 M4 隨機玩：壞輸入與亂序的動作', () => {
  it('八個種子各 70 步：不丟程式錯誤、被擋下的動作狀態不變、不變式成立、狀態隨時合法、存讀檔一樣；同一個種子重玩結果一樣', async () => {
    let ok = 0
    const seen = new Set<string>()
    for (const seed of [1, 2, 3, 4, 5, 6, 7, 8]) {
      const a = await run(seed, 70)
      ok += a.log.filter((x) => x.endsWith(':ok')).length
      for (const l of a.log) if (l.endsWith(':ok')) seen.add(l.split(':')[0]!)
      if (seed <= 2) expect((await run(seed, 70)).hash).toBe(a.hash)
    }
    expect(ok).toBeGreaterThan(150)
    // 至少走到過這幾種不同的動作（選單有真的在用，不是全被擋）
    expect([...seen].length).toBeGreaterThan(10)
  })
})
