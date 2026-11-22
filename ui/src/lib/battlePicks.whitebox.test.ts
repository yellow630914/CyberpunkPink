// 白箱測試：ui/src/lib/battlePicks.ts（dev/work/M1-ui-combat-picks.md 第一節）。
// 驗收測試（battlePicks.test.ts）用真的戰鬥走過道具、換武器、掃射、無人機、控制節點；這裡逐條對工單第一節的每一句，
// 用手寫的最小宣告把每一個分支單獨走一次，最後拿引擎實際給的每一個行動對一次「ready 就送得進去、缺一定要選的就送不進去」
// （dev/invariants.md 第 46 條：宣告與行動本身對得上；畫面只問 pickApplies、pickProblems，不自己判斷）。

import { beforeEach, describe, expect, it } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import type { BattleActionOption, BattlePick, BattlePickOption, BattleSetup, BattleTarget } from '@engine/src'
import { pickProblems } from '@engine/src'
import { partyUnit, enemyUnit, testWeapon } from '@engine/src/testkit'
import { useEngine } from '../stores/engine'
import { pickFlow } from './battlePicks'

const opt = (value: string | number | boolean, label: string, extra: Partial<BattlePickOption> = {}): BattlePickOption => ({ value, label, blocks: [], ...extra })
const pick = (key: string, options: BattlePickOption[], extra: Partial<BattlePick> = {}): BattlePick => ({ key, label: key, kind: 'choice', required: true, options, ...extra })
const action = (over: Partial<BattleActionOption> = {}): BattleActionOption => ({
  id: 'x', name: '測試', desc: '', group: 'tactic', icon: 'skill', target: 'unit', picks: [], cost: { ap: 1 }, ok: true, blocks: [], targets: [], ...over,
})
const A: BattleTarget = { unit: 'a1' }
const B: BattleTarget = { unit: 'a2' }
const S2: BattleTarget = { side: 'ally', slot: 2 }

describe('pickFlow 的 picks（工單第一節「picks」）', () => {
  it('照 action.picks 的順序列，每一項帶 key、label、kind、required', () => {
    const a = action({ picks: [pick('z', [opt(1, '一')], { label: '最後宣告的鍵在前', required: false }), pick('a', [opt(true, '開')], { kind: 'toggle', label: '開關' })] })
    expect(pickFlow(a, { target: null, pick: {} }).picks.map((p) => [p.key, p.label, p.kind, p.required])).toEqual([
      ['z', '最後宣告的鍵在前', 'choice', false], ['a', '開關', 'toggle', true],
    ])
  })

  it('還沒選目標時列全部選項；選了目標只列對它適用的（for）；一個適用的都沒有的那一項整項不列', () => {
    const a = action({
      picks: [
        pick('item', [opt('x', '只給 a1', { for: [A] }), opt('y', '只給格子', { for: [S2] }), opt('z', '誰都行')]),
        pick('only', [opt(1, '只給 a2', { for: [B] })]),
      ],
    })
    const none = pickFlow(a, { target: null, pick: {} })
    expect(none.picks.map((p) => [p.key, p.options.map((o) => o.value)])).toEqual([['item', ['x', 'y', 'z']], ['only', [1]]])
    const onA = pickFlow(a, { target: A, pick: {} })
    expect(onA.picks.map((p) => [p.key, p.options.map((o) => o.value)])).toEqual([['item', ['x', 'z']]])
    const onSlot = pickFlow(a, { target: S2, pick: {} })
    expect(onSlot.picks.map((p) => [p.key, p.options.map((o) => o.value)])).toEqual([['item', ['y', 'z']]])
  })

  it('選項的 reason 是 blocks 用換行接起來（一條一個條件）；空的是 null', () => {
    const a = action({ picks: [pick('k', [opt(1, '兩個原因', { blocks: ['第一條。', '第二條。'] }), opt(2, '一個原因', { blocks: ['只有一條。'] }), opt(3, '可以')])] })
    expect(pickFlow(a, { target: null, pick: {} }).picks[0]!.options.map((o) => o.reason)).toEqual(['第一條。\n第二條。', '只有一條。', null])
  })

  it('selected 是 choice.pick[key] === value（嚴格相等：字串的 "1" 不算選了 1）；有 at 才帶 at', () => {
    const a = action({ picks: [pick('k', [opt(1, '一', { at: { unit: 'f1' } }), opt(2, '二')])] })
    const loose = pickFlow(a, { target: null, pick: { k: '1' } }).picks[0]!.options
    expect(loose.map((o) => o.selected)).toEqual([false, false])
    const strict = pickFlow(a, { target: null, pick: { k: 1 } }).picks[0]!.options
    expect(strict.map((o) => o.selected)).toEqual([true, false])
    expect(strict[0]!.at).toEqual({ unit: 'f1' })
    expect('at' in strict[1]!).toBe(false)
  })
})

describe('pickFlow 的 targets（工單第一節「targets」）', () => {
  it('照 action.targets 的順序；目標自己的 blocks（換行接起來）優先於「用不上選的」', () => {
    const a = action({
      targets: [{ target: B, blocks: [] }, { target: A, blocks: ['太遠了。', '看不到。'] }, { target: S2, blocks: [] }],
      picks: [pick('item', [opt('only_a', '只給自己', { for: [A] })])],
    })
    const f = pickFlow(a, { target: null, pick: { item: 'only_a' } })
    expect(f.targets.map((t) => [t.target, t.reason])).toEqual([
      [B, '這個目標用不上選的「只給自己」。'],
      [A, '太遠了。\n看不到。'],
      [S2, '這個目標用不上選的「只給自己」。'],
    ])
  })

  it('選的選項沒有 for（誰都適用）不排除任何目標；選的值對不到任何選項也不排除', () => {
    const a = action({ targets: [{ target: A, blocks: [] }, { target: B, blocks: [] }], picks: [pick('item', [opt('any', '誰都行'), opt('a', '只給 a1', { for: [A] })])] })
    expect(pickFlow(a, { target: null, pick: { item: 'any' } }).targets.map((t) => t.reason)).toEqual([null, null])
    expect(pickFlow(a, { target: null, pick: { item: 'nope' } }).targets.map((t) => t.reason)).toEqual([null, null])
    // 沒選就不排除
    expect(pickFlow(a, { target: null, pick: {} }).targets.map((t) => t.reason)).toEqual([null, null])
  })

  it('兩項都選了帶 for 的選項：理由寫第一個（照宣告的順序）對不上的那一個', () => {
    const a = action({
      targets: [{ target: A, blocks: [] }, { target: B, blocks: [] }, { target: S2, blocks: [] }],
      picks: [pick('p1', [opt(1, '甲', { for: [A, B] })]), pick('p2', [opt(2, '乙', { for: [A] })])],
    })
    expect(pickFlow(a, { target: null, pick: { p1: 1, p2: 2 } }).targets.map((t) => t.reason)).toEqual([
      null, '這個目標用不上選的「乙」。', '這個目標用不上選的「甲」。',
    ])
  })
})

describe('pickFlow 的 missing 與 ready（工單第一節「missing」「ready」）', () => {
  it('target 是 none 的行動不要求目標；要目標而還沒選時第一句是「要選一個目標。」，後面接 pickProblems 的每一句', () => {
    const picks = [pick('a', [opt(1, '一')], { label: '甲' }), pick('b', [opt(2, '二')], { label: '乙' })]
    const noTarget = pickFlow(action({ target: 'none', picks }), { target: null, pick: {} })
    expect(noTarget.missing).toEqual(['要選甲。', '要選乙。'])
    const needs = pickFlow(action({ target: 'foe', picks }), { target: null, pick: {} })
    expect(needs.missing).toEqual(['要選一個目標。', ...pickProblems(picks, null, {})])
    expect(needs.missing[0]).toBe('要選一個目標。')
    expect(needs.ready).toBe(false)
  })

  it('選了灰掉的選項：它的原因進 missing，不 ready（不送一個引擎一定擋下的 input）', () => {
    const a = action({ target: 'none', picks: [pick('k', [opt(1, '壞的', { blocks: ['彈匣是空的。'] })])] })
    const f = pickFlow(a, { target: null, pick: { k: 1 } })
    expect(f.missing).toEqual(['彈匣是空的。'])
    expect(f.ready).toBe(false)
  })

  it('選了對這個目標不適用的選項：「沒有這個選項」進 missing（先選選項、再換目標的情形）', () => {
    const a = action({ targets: [{ target: A, blocks: [] }, { target: B, blocks: [] }], picks: [pick('k', [opt('a', '只給 a1', { for: [A] }), opt('b', '只給 a2', { for: [B] })], { label: '道具' })] })
    const f = pickFlow(a, { target: B, pick: { k: 'a' } })
    expect(f.missing).toEqual(['道具：沒有這個選項。'])
    expect(f.ready).toBe(false)
    expect(f.picks[0]!.options.map((o) => [o.value, o.selected])).toEqual([['b', false]])
  })

  it('不一定要選的那一項沒選不擋；ready 就是 missing 是空的', () => {
    const f = pickFlow(action({ target: 'none', picks: [pick('w', [opt(0, '第一把'), opt(1, '第二把')], { required: false })] }), { target: null, pick: {} })
    expect(f).toMatchObject({ missing: [], ready: true, input: { action: 'x' } })
  })
})

describe('pickFlow 的 input（工單第一節「input」）', () => {
  it('有目標才帶 target；pick 一個都沒有就不帶 pick 這個鍵', () => {
    const noPick = pickFlow(action({ target: 'none' }), { target: null, pick: {} }).input
    expect(noPick).toEqual({ action: 'x' })
    expect(Object.keys(noPick)).toEqual(['action'])
    expect(pickFlow(action({ id: 'shoot' }), { target: A, pick: {} }).input).toEqual({ action: 'shoot', target: A })
  })

  it('「有值的」照實送：0、空字串、選項的 false（不是開關）都是值；undefined、null 不送；開關是 false 不送', () => {
    const a = action({
      target: 'none',
      picks: [
        pick('weapon', [opt(0, '第 1 把'), opt(1, '第 2 把')], { required: false }),
        pick('mode', [opt(false, '不瞄準'), opt(true, '瞄準')], { required: false }),
        pick('sweep', [opt(true, '掃射')], { kind: 'toggle', required: false }),
        pick('memo', [opt('', '空白'), opt('x', 'x')], { required: false }),
        pick('gone', [opt('g', 'g')], { required: false }),
      ],
    })
    const f = pickFlow(a, { target: null, pick: { weapon: 0, mode: false, sweep: false, memo: '', gone: null, other: 5 } })
    expect(f.input).toEqual({ action: 'x', pick: { weapon: 0, mode: false, memo: '' } })
    expect(pickFlow(a, { target: null, pick: { sweep: true, gone: undefined } }).input).toEqual({ action: 'x', pick: { sweep: true } })
  })

  it('純函式：不改傳進來的行動與選擇', () => {
    const a = action({ targets: [{ target: A, blocks: [] }], picks: [pick('k', [opt(1, '一', { for: [A], at: A })])] })
    const choice = { target: A, pick: { k: 1, stray: 2 } as Record<string, unknown> }
    const before = JSON.stringify([a, choice])
    pickFlow(a, choice)
    pickFlow(a, { target: null, pick: {} })
    expect(JSON.stringify([a, choice])).toBe(before)
  })
})

// ---- 拿引擎實際給的行動對一次（不變式第 46 條）：ready 的 input 引擎收；缺一定要選的，引擎擋 ----

const raw = (unit: unknown, slot?: number) => ({ from: 'unit', unit: unit as Record<string, unknown>, ...(slot ? { slot } : {}) })
const SETUP: BattleSetup = {
  mode: 'meat', grade: 1, cover: { ally: [1, 1, 0, 0], foe: [0, 2, 0, 0] },
  allies: [
    raw(partyUnit(0, 1, {
      weapons: [{ ...testWeapon('rifle', 6), id: 'lmg', name: '輕機槍', class: 'lmg', mag: { now: 4, max: 4 }, traits: ['sweep'] }, testWeapon('pistol', 6), testWeapon('knife', 6)],
      quick: [{ item: 'it_medgel_1', qty: 2 }, { item: 'it_coolant_1', qty: 1 }, { item: 'it_smoke_1', qty: 1 }, { item: 'it_zip_tie', qty: 1 }],
      skills: { firearms: 2, sync: 6, piloting: 3 }, ap: { now: 30, max: 30, regen: 3 }, initBonus: 99,
      ext: { summons: { drones: [{ kind: 'attack', grade: 1 }, { kind: 'medic', grade: 1 }], vehicle: { name: '小貨車', hp: [30, 60] } } },
    })),
    raw(partyUnit(1, 1)), raw(partyUnit(2, 1)),
  ],
  foes: [raw(enemyUnit('elite', 1)), raw(enemyUnit('elite', 1))],
  nodes: [{ kind: 'light', name: '燈' }, { kind: 'door', name: '防爆門' }],
}

describe('pickFlow 對引擎（dev/invariants.md 第 46 條：宣告與行動本身對得上）', () => {
  beforeEach(() => setActivePinia(createPinia()))
  const fresh = () => {
    setActivePinia(createPinia())
    const e = useEngine()
    e.newGame({ seed: 7 })
    e.startBattle(SETUP)
    return e
  }

  it('每一個做得成的行動、每一個選得了的目標、每一個選得了的選項：ready 的 input 引擎都收；缺一定要選的，引擎擋下而且狀態不變', () => {
    const e0 = fresh()
    const actions = e0.battleOptions()!.actions.filter((a) => a.ok && !a.hold && a.id !== 'end')
    expect(actions.length).toBeGreaterThan(8)
    const tried: string[] = []
    const wrong: string[] = []
    for (const a of actions) {
      const targets: Array<BattleTarget | null> = a.target === 'none' ? [null] : a.targets.filter((t) => t.blocks.length === 0).map((t) => t.target)
      for (const target of targets) {
        const base = pickFlow(a, { target, pick: {} })
        // 每一項一定要選的先選第一個選得了的；再對每一項的每一個選得了的選項各試一次
        const defaults: Record<string, unknown> = {}
        for (const p of base.picks) { const o = p.options.find((x) => !x.reason); if (p.required && o) defaults[p.key] = o.value }
        const choices: Array<Record<string, unknown>> = [defaults]
        for (const p of base.picks) for (const o of p.options) if (!o.reason) choices.push({ ...defaults, [p.key]: o.value })
        for (const chosen of choices) {
          const f = pickFlow(a, { target, pick: chosen })
          if (!f.ready) continue
          const e = fresh()
          const r = e.battleAct(f.input)
          tried.push(JSON.stringify(f.input))
          if (r.status !== 'applied') wrong.push(`${JSON.stringify(f.input)} → ${r.status}：${(r.reasons ?? []).join(' / ')}`)
        }
        // 缺一定要選的：引擎也要擋（不能有「畫面說還缺、引擎照預設做了」）
        const lacking = base.picks.filter((p) => p.required)
        if (lacking.length) {
          const e = fresh()
          const before = JSON.stringify(e.state)
          const r = e.battleAct(base.input)
          if (r.status !== 'refused') wrong.push(`缺 ${lacking.map((p) => p.key).join('、')} 卻被引擎收下：${JSON.stringify(base.input)}`)
          else expect(JSON.stringify(e.state)).toBe(before)
        }
      }
    }
    expect(tried.length).toBeGreaterThan(20)
    expect(wrong).toEqual([])
  }, 60_000)
})
