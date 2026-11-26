// 冒煙 M4・第二波：成人場景（dev/work/M4-smoke.md 第 3 點、dev/work/M4-plan.md「第二波」那一圈）。固定種子、AI 關閉（結算全照規則）。
// 學一個夜課 → 一對一 → 三個人的一圈加一個不展開的圈、換圈 → 單人 → 潛入（dive）裡的一場 → 每一場的結算都在範圍裡（沉溺 ±4、橋參數最多一項 +1）。
// 內容一律是 testkit 的 bodyWorld()；功能是全部；走的是真正的功能與真正的提交。成人的內容只有機制與數字，場景的描寫是 AI 的事（AI 關著就沒有）。

import { describe, expect, it, vi } from 'vitest'
import type { Report } from '../../src'
import { learnDraft, nightList } from '../../src/features/nightclass'
import { sceneRawOf } from '../../src/features/scene'
import type { Game } from '../../src/shell/game'
import {
  BODY_BLOCKS, M4_ACTION_PREFIXES, diveIn, flow, giveInsight, giveItem, makeBodyGame, observed, openScene, prefixProblems, roundTrip, sceneCast, sceneDo, sceneEndTurn, sceneRounds, standAt, stateHash, stopScene, wearDeck,
} from '../../src/testkit'
import type { SceneSettlement } from '../../src/testkit'

vi.setConfig({ testTimeout: 60_000 })

const actions = (rs: Report[]): string[] => rs.map((r) => r.action ?? '')
const pc = (g: Game) => g.state.actors.pc!
const parts = (my_part: string, their_part: string) => ({ my_part, their_part })

/** 每一場的結算都要在範圍裡：沉溺每個人 ±4；橋參數每個人每一項變化 ±? 最多一項 +1（其餘不增）。 */
function expectInRange(s: SceneSettlement, label: string): void {
  for (const [id, d] of Object.entries(s.sink)) expect(Math.abs(d), `${label}：${id} 的沉溺變化 ${d}`).toBeLessThanOrEqual(4)
  for (const [id, b] of Object.entries(s.bridge)) {
    const ups = Object.entries(b).filter(([, v]) => v > 0)
    expect(ups.length, `${label}：${id} 的橋參數往上的有 ${ups.map(([k]) => k).join('、')}`).toBeLessThanOrEqual(1)
    for (const [key, v] of ups) expect(v, `${label}：${id} 的 ${key} +${v}`).toBeLessThanOrEqual(1)
  }
}

async function sceneFlow(g: Game, f = flow('成人場景'), checkpoint: (label: string) => void = () => undefined): Promise<Game> {
  const { k } = g
  const settlements: SceneSettlement[] = []
  await f.step('學一個夜課：給體悟、學「指腹游走」與「親吻」「慢慢摸索」（扣體悟、記進角色）', () => {
    giveInsight(g, 40)
    const before = nightList(k, g.state, 'pc').insight
    expect(before).toBe(40)
    for (const id of ['nt_tw_stroke', 'nt_tw_kiss', 'nt_tw_slow']) {
      const reports = g.commit(learnDraft(k, g.state, 'pc', id))
      expect(actions(reports)).toEqual(['nightclass.learn'])
    }
    expect(nightList(k, g.state, 'pc').insight).toBeLessThan(before)
    expect((pc(g).ext.scene as { skills: string[] }).skills).toEqual(expect.arrayContaining(['nt_tw_stroke', 'nt_tw_kiss', 'nt_tw_slow']))
  })
  await f.step('一對一：開場、用一個夜課（接上對方的胸）、結束回合讓對方走、再過一個回合、停下結算', () => {
    standAt(g, 'tw_tower', 'E1')
    const start = openScene(g, { with: ['npc_tw_ann'], nature: 'mutual', goal: 'please', mode: 'full' })
    expect(actions(start)).toEqual(['scene.start'])
    expect(sceneRawOf(g.state)).toMatchObject({ kind: 'pair', turn: 'pc' })
    expect(g.k.activity.active(g.state).map((a) => a.kind)).toEqual(['scene'])
    const used = sceneDo(g, { kind: 'skill', id: 'nt_tw_stroke', target: 'npc_tw_ann', pick: parts('hand_l', 'chest') })
    expect(actions(used)).toEqual(['scene.act'])
    expect(sceneRawOf(g.state)!.links).toHaveLength(1)
    checkpoint('mid-scene')
    sceneEndTurn(g)
    expect(sceneRawOf(g.state)).toMatchObject({ turn: 'pc', round: 2 })
    const s = stopScene(g)
    settlements.push(s)
    expect(actions(s.reports)).toEqual(['scene.end'])
    expect(sceneRawOf(g.state)).toBeNull()
    expectInRange(s, '一對一')
  })
  await f.step('三個人的一圈加一個不展開的圈：開場（主角、安、波一圈；西與迪不展開）、用夜課連兩個人、換圈、叫人過來', () => {
    const start = openScene(g, { circles: [['pc', 'npc_tw_ann', 'npc_tw_bo'], ['npc_tw_cy', 'npc_tw_di']], nature: 'mutual', mode: 'full' })
    expect(actions(start)).toEqual(['scene.start'])
    const raw = sceneRawOf(g.state)!
    expect(raw).toMatchObject({ kind: 'group', position: 'pos_tw_trio' })
    expect(raw.seats.map((x) => x.id)).toEqual(['pc', 'npc_tw_ann', 'npc_tw_bo'])
    expect(raw.circles.map((c) => c.people)).toEqual([['npc_tw_cy', 'npc_tw_di']])
    // 連著兩個人：用不同的部位接上
    sceneDo(g, { kind: 'skill', id: 'nt_tw_kiss', target: 'npc_tw_ann', pick: parts('mouth', 'mouth') })
    sceneDo(g, { kind: 'skill', id: 'nt_tw_stroke', target: 'npc_tw_bo', pick: parts('hand_r', 'chest') })
    expect(sceneRawOf(g.state)!.links.map((l) => [l.by, l.to])).toEqual([['pc', 'npc_tw_ann'], ['pc', 'npc_tw_bo']])
    sceneEndTurn(g)
    // 換圈（2 行動點）：離開這一圈，加入不展開的那一圈
    const moved = sceneDo(g, { kind: 'move_circle', circle: 'c1' })
    expect(actions(moved)).toEqual(['scene.act'])
    expect(sceneRawOf(g.state)!.seats.map((x) => x.id)).toEqual(expect.arrayContaining(['pc', 'npc_tw_cy', 'npc_tw_di']))
    expect(sceneRawOf(g.state)!.seats.map((x) => x.id)).not.toContain('npc_tw_ann')
    sceneRounds(g, 1)
    const s = stopScene(g)
    settlements.push(s)
    expect(sceneRawOf(g.state)).toBeNull()
    expectInRange(s, '三個人與換圈')
  })
  await f.step('單人：在住處獨處（沒有對象、沒有主動權），用「慢慢摸索」、停下；沒有任何「對方」漏出來', () => {
    const start = openScene(g, { solo: true, mode: 'full' })
    expect(actions(start)).toEqual(['scene.start'])
    const raw = sceneRawOf(g.state)!
    expect(raw.seats.map((x) => x.id)).toEqual(['pc'])
    expect(raw.circles).toEqual([])
    sceneDo(g, { kind: 'skill', id: 'nt_tw_slow', pick: parts('hand_l', 'chest') })
    sceneRounds(g, 1)
    const s = stopScene(g)
    settlements.push(s)
    expectInRange(s, '單人')
  })
  await f.step('潛入裡的一場：穿上甲板、站到潛艙店、潛入；在網內和對象開場（現實與內海同一套規則、層是 net）；結算在範圍裡；登出', () => {
    giveItem(g, 'dk_tw_ii')
    const deck = g.state.inventory.find((s) => s.id === 'dk_tw_ii')!
    // 甲板要有編號才穿得上（deck.equip 與 wearDeck 認 stack.data.uid）
    g.commit({ kind: 'system', action: 'test.deck', location: {}, party: [], timeline: [], changes: [{ op: 'item', id: 'dk_tw_ii', qty: -1 }, { op: 'item', id: 'dk_tw_ii', qty: 1, data: { uid: 'D1' } }] as never, outcome: { result: 'ok', summary: '測試。' } })
    void deck
    g.commit(wearDeck(k, g.state, 'pc', 'D1'))
    standAt(g, 'tw_tower', 'F3')
    diveIn(g)
    expect(g.k.activity.active(g.state).map((a) => a.kind)).toContain('dive')
    const start = openScene(g, { with: ['npc_tw_ann'], nature: 'mutual', goal: 'please', mode: 'full' })
    expect(actions(start)).toEqual(['scene.start'])
    expect(sceneRawOf(g.state)).toMatchObject({ layer: 'net' })
    sceneDo(g, { kind: 'skill', id: 'nt_tw_kiss', target: 'npc_tw_ann', pick: parts('mouth', 'mouth') })
    sceneRounds(g, 1)
    const s = stopScene(g)
    settlements.push(s)
    expectInRange(s, '潛入裡的一場')
    expect(g.k.activity.active(g.state).map((a) => a.kind)).toContain('dive')
  })
  await f.step('每一場的結算都在範圍裡（四場都記下了）；整條主幹的報告前綴都在 M4 的清單裡', () => {
    expect(settlements).toHaveLength(4)
    expect(prefixProblems(g, M4_ACTION_PREFIXES)).toEqual([])
  })
  return g
}

/** 把第二版的一對一場景還原成 M2、M3 的兩格寫法（沒有 v；pc 與 partner 各一格；links 與 lines 的人寫 'pc'／'partner'）。 */
function toLegacy(raw: Record<string, any>): Record<string, unknown> {
  const pc: string = raw.pc
  const partner: string = raw.seats[1].id
  const side = (id: string): 'pc' | 'partner' => (id === pc ? 'pc' : 'partner')
  const seatOf = (id: string) => raw.seats.find((x: { id: string }) => x.id === id)
  const pick = (key: string): Record<string, unknown> => ({ pc: seatOf(pc)[key], partner: seatOf(partner)[key] })
  const { v: _v, kind: _k, layer: _l, seats: _s, pairs, circles: _c, roles, links, lines, turn, ...keep } = raw
  void [_v, _k, _l, _s, _c]
  return {
    ...keep, partner, turn: side(turn), ap: pick('ap'), gear: pick('gear'), max_gear: pick('max_gear'), shifted: pick('shifted'), sink_gain: pick('sink_gain'), climax: pick('climax'),
    received: pick('received'), teased: pick('teased'), restrained: pick('restrained'), fit: pairs[partner].fit, init: pairs[partner].init, first_person: pairs[partner].first,
    roles: { pc: roles[pc], partner: roles[partner] },
    links: links.map((l: { by: string; to: string }) => { const { to: _to, ...rest } = l; void _to; return { ...rest, by: side(l.by) } }),
    lines: lines.map((l: { who: string }) => ({ ...l, who: side(l.who) })),
  }
}

describe('冒煙 M4：成人場景（舊存檔）', () => {
  it('M2、M3 的兩格寫法的一對一場景（沒有 v）：存檔讀回來之後轉成第二版、接著玩（用夜課、結束回合、停下結算）不丟錯；沒有人學過的不丟', async () => {
    const g = makeBodyGame({ actors: sceneCast('ann'), at: { block: 'tw_tower', marker: 'E1' } }).game
    giveInsight(g, 40)
    g.commit(learnDraft(g.k, g.state, 'pc', 'nt_tw_stroke'))
    openScene(g, { with: ['npc_tw_ann'], nature: 'mutual', goal: 'please', mode: 'full' })
    sceneDo(g, { kind: 'skill', id: 'nt_tw_stroke', target: 'npc_tw_ann', pick: parts('hand_l', 'chest') })
    const now = JSON.parse(JSON.stringify(sceneRawOf(g.state))) as Record<string, any>
    const legacy = toLegacy(now)
    expect(legacy).not.toHaveProperty('v')
    expect(legacy).toHaveProperty('partner', 'npc_tw_ann')
    // 場景進行中不收別的報告：直接換成舊的寫法（測試的起點，不是一個行動）
    g.state.ext.scene = legacy as never
    expect(g.state.ext.scene).not.toHaveProperty('v')
    // 存檔、讀檔、接著玩
    expect(g.load(g.save('manual', '2026-11-26T00:00:00Z', 'legacy-scene'))).toBeNull()
    const raw = sceneRawOf(g.state)!
    expect(raw).toMatchObject({ v: 2, kind: 'pair', layer: 'meat', pc: 'pc', turn: 'pc' })
    expect(raw.seats.map((x) => x.id)).toEqual(['pc', 'npc_tw_ann'])
    expect(raw.links.map((l) => [l.by, l.to])).toEqual([['pc', 'npc_tw_ann']])
    expect(raw.pairs.npc_tw_ann!.fit).toBe(now.pairs.npc_tw_ann.fit)
    const { violations } = await observed(g, async () => {
      sceneEndTurn(g)
      const s = stopScene(g)
      expectInRange(s, '舊的場景')
    })
    expect(violations).toEqual([])
    expect(sceneRawOf(g.state)).toBeNull()
  })
})

describe('冒煙 M4：成人場景（存讀）', () => {
  it('一對一打到一半存讀一次，接著走；最後的狀態和不中斷的一遍逐欄相同', async () => {
    const make = () => makeBodyGame({ actors: sceneCast('ann', 'bo', 'cy', 'di'), at: { block: BODY_BLOCKS.clinics, marker: 'E1' } }).game
    const plain = make()
    await sceneFlow(plain)
    const saved = make()
    const { violations } = await observed(saved, async () => sceneFlow(saved, flow('成人場景（存讀）'), (label) => roundTrip(saved, label)))
    expect(violations).toEqual([])
    expect(stateHash(saved.state)).toBe(stateHash(plain.state))
  })
})

describe('冒煙 M4：成人場景', () => {
  it('學夜課 → 一對一 → 三個人的一圈加不展開的圈、換圈 → 單人 → 潛入裡的一場 → 結算都在範圍裡', async () => {
    const t = makeBodyGame({ actors: sceneCast('ann', 'bo', 'cy', 'di'), at: { block: BODY_BLOCKS.clinics, marker: 'E1' } })
    const { violations } = await observed(t.game, async () => sceneFlow(t.game))
    expect(violations).toEqual([])
  })
})
