// 邊界測試：M3 甲板（ITEMS 11.1 節構裝等級與加值、5.2 節腳本的支數上限、11.9 節裝與卸、構裝槽；CYBERSPACE 4.2 節）。
// cpp-tester-boundary／whitebox 寫的。每個數值測：下限、下限−1、上限、上限+1、零、最大組合；組合用 fast-check。
//
// 邊界表：
//   構裝等級 1～5 × 甲板等級 1～4        → 實際照幾級算（甲板等級夾過；cap_construct_grade 關掉就照構裝自己的）、命中與傷害骰的加值（ITEMS 11.1 節的表）
//   甲板的槽數 3～6、一件佔 1 或 2 槽       → 剛好裝滿、再多一件擋下；剩 1 槽裝 2 槽的擋下、剩 2 槽裝得下；被專屬構裝佔掉的槽（reserved）≥ 槽數 → 一件都裝不了
//   換成比較小的甲板                      → 裝不下的構裝退回背包（不是丟掉），換回來又算進去
//   腳本支數 = 甲板等級 + 1               → 剛好上限、上限 + 1、0（全部放下）、數量 0／負數／小數、同一種拆成兩筆合併計算、背包不夠
//   性質：任何裝卸的順序之後，用掉的槽 ≤ 能用的槽、腳本 ≤ 上限

import { describe, expect, it } from 'vitest'
import fc from 'fast-check'
import type { ContentPack, Feature, GameState } from '../../src'
import { ActionBlocked, clone } from '../../src'
import { DEFAULT_DECK_RULES, deckOf, equipDraft, installBlock, installDraft, removeDraft, scriptsBlock, scriptsDraft } from '../../src/features/deck'
import { constructWeapon } from '../../src/features/deck/battle'
import { deckRules, gradeBonus } from '../../src/features/deck/model'
import { makeNetBattleGame } from '../../src/testkit'

type G = ReturnType<typeof makeNetBattleGame>['game']

// ---------------------------------------------------------------------------------------------
// 假資料：四副甲板（等級 1～4、槽 3～6，照 ITEMS 11.9 節的入門甲板表）、五把武器構裝（等級 1～5）、一件佔兩槽的、八件佔一槽的雜項、兩種腳本

const DECKS = [1, 2, 3, 4].map((g) => ({ id: `dk_b${g}`, name: `邊界甲板${g}`, desc: `邊界測試的 ${g} 級甲板。`, grade: g, slots: g + 2, firewall: 10, legal: 'free' }))
const WEAPONS = [1, 2, 3, 4, 5].map((g) => ({ id: `cs_b${g}`, class: 'weapon', name: `邊界槍${g}`, grade: g, legal: 'free', archetype: 'pistol', type: 'neural', ram: 1 }))
const BODY = { id: 'cs_b_body', class: 'body', name: '邊界的構裝體', grade: 2, legal: 'free', slots: 2 }
const FILLERS = Array.from({ length: 8 }, (_, i) => ({ id: `cs_f${i}`, class: 'tool', name: `邊界工具${i}`, grade: 1, legal: 'free', ap: 1, ram: 1, target: 'foe', do: [{ op: 'load', amount: 1, type: 'neural' }] }))
const SCRIPTS = ['it_b_s1', 'it_b_s2'].map((id) => ({ id, name: id, desc: `${id}：一支腳本。`, category: 'misc', grade: 1, size: 0, legal: 'free', tags: ['script'] }))
const itemOf = (c: { id: string; name: string }) => ({ id: c.id, name: c.name, desc: `${c.name}。`, category: 'misc', grade: 1, size: 0, legal: 'free' })

const pack = (rule?: Record<string, unknown>): ContentPack => ({
  id: 'm3_deck_boundary',
  content: {
    deck: DECKS,
    construct: [...WEAPONS, BODY, ...FILLERS],
    item: [...[...WEAPONS, BODY, ...FILLERS].map(itemOf), ...SCRIPTS],
    ...(rule ? { deck_rule: [{ id: 'default', ...rule }] } : {}),
  } as never,
})

/** 被專屬構裝佔掉的槽（招牌能力的專屬構裝，N33）：這裡用狀態裡的計數器代替，讓測試可以任意改。 */
const RESERVE: Feature = {
  id: 'm3_deck_boundary_reserve',
  install(k) {
    k.stats.addStatProvider('deck_slots_reserved', 'm3_deck_boundary_reserve', (state) => {
      const n = state.counters.b_reserve ?? 0
      return n ? [{ label: '邊界測試：被佔掉的槽', value: n, source: 'test' }] : []
    })
  },
}

const commit = (g: G, changes: unknown[]) => g.commit({ kind: 'system', action: 'test.set', location: {}, party: [], timeline: [], changes: changes as never, outcome: { result: 'ok', summary: 't' } })

/**
 * 一局不開打的遊戲；主角卸掉原本的甲板與構裝，背包放進四副邊界甲板（uid U1～U4）、所有構裝與腳本（每種 5 個），裝上 deck 級甲板。
 * 不裝義體功能（without: ['cyberware']）：這個檔測的是 M3 的背包甲板——裝上、換成別副（比較小的放不下的構裝與腳本退回背包）、卸下都是 equipDraft 的行為；
 * 裝了義體功能之後甲板是腦部的義體、equipDraft 一律回 IMPLANT_ONLY（dev/adr/0019「實作補記：M4-cyber-deck」）。腦部甲板的槽數、等級、腳本上限看 tests/features/M4-cyber-deck.test.ts。
 */
function game(deck: number, rule?: Record<string, unknown>): G {
  const { game: g } = makeNetBattleGame({ noBattle: true, content: [pack(rule)] as never, features: [RESERVE], without: ['cyberware'] })
  commit(g, [
    { op: 'actor.ext', id: 'pc', key: 'deck', value: { slots: [], scripts: [] } },
    ...DECKS.map((d, i) => ({ op: 'item', id: d.id, qty: 1, data: { uid: `U${i + 1}` } })),
    ...[...WEAPONS, BODY, ...FILLERS].map((c) => ({ op: 'item', id: c.id, qty: 1 })),
    ...SCRIPTS.map((s) => ({ op: 'item', id: s.id, qty: 5 })),
  ])
  g.commit(equipDraft(g.k, g.state, 'pc', `U${deck}`))
  return g
}
const install = (g: G, item: string) => g.commit(installDraft(g.k, g.state, 'pc', item))
const reserve = (g: G, n: number) => commit(g, [{ op: 'counter', key: 'b_reserve', delta: n - (g.state.counters.b_reserve ?? 0) }])
const info = (g: G) => deckOf(g.k, g.state, 'pc')

// ---------------------------------------------------------------------------------------------

describe('邊界 ITEMS 11.1：構裝等級 × 甲板等級 → 實際等級與命中、傷害骰的加值', () => {
  /** 一把武器構裝在這張甲板上的命中與傷害骰（等級 1 的槍在 1 級甲板上當基準）。 */
  function weaponOn(g: G, cs: string) {
    const piece = info(g).equipped.find((p) => p.id === cs)
    expect(piece, `${cs} 沒有生效`).toBeDefined()
    const w = constructWeapon(g.k, g.state, 'pc', 'net', piece!, deckRules(g.k))!
    return { piece: piece!, hit: w.hit, dice: w.dice }
  }

  it('ITEMS 11.1 節的表（預設）：I 無、II 命中 +1、III 命中 +1 且多 1 顆骰、IV 命中 +2 且多 2 顆骰；V 暫照 IV；表上沒有的往下找', () => {
    expect(DEFAULT_DECK_RULES.grade_bonus).toEqual({ 1: { hit: 0, dice: 0 }, 2: { hit: 1, dice: 0 }, 3: { hit: 1, dice: 1 }, 4: { hit: 2, dice: 2 }, 5: { hit: 2, dice: 2 } })
    expect(gradeBonus(DEFAULT_DECK_RULES, 0)).toEqual({ hit: 0, dice: 0 })
    expect(gradeBonus(DEFAULT_DECK_RULES, 9)).toEqual({ hit: 2, dice: 2 })
  })

  it('性質：加值隨等級只增不減（命中、傷害骰都是）', () => {
    for (let g = 1; g < 5; g++) {
      const a = gradeBonus(DEFAULT_DECK_RULES, g)
      const b = gradeBonus(DEFAULT_DECK_RULES, g + 1)
      expect(b.hit).toBeGreaterThanOrEqual(a.hit)
      expect(b.dice).toBeGreaterThanOrEqual(a.dice)
    }
  })

  it('cap_construct_grade 開（使用者 2026-11-24 定案、預設）：實際等級 = min(構裝等級, 甲板等級)；加值照實際等級；等級 1～5 乘甲板 1～4 全部走一遍', () => {
    for (let dk = 1; dk <= 4; dk++) {
      const g = game(dk)
      expect(deckRules(g.k).cap_construct_grade).toBe(true)
      install(g, 'cs_b1')
      const base = weaponOn(g, 'cs_b1')
      expect(base.piece.runsAt).toBe(1)
      g.commit(removeDraft(g.k, g.state, 'pc', 'cs_b1'))
      for (let cg = 1; cg <= 5; cg++) {
        install(g, `cs_b${cg}`)
        const w = weaponOn(g, `cs_b${cg}`)
        const run = Math.min(cg, dk)
        expect(w.piece.runsAt, `構裝 ${cg} 級在 ${dk} 級甲板上`).toBe(run)
        const bonus = gradeBonus(DEFAULT_DECK_RULES, run)
        // 同一個人、同一個原型：命中與傷害骰只差在等級加值
        expect(w.hit - base.hit, `命中：構裝 ${cg} 級、甲板 ${dk} 級`).toBe(bonus.hit)
        expect(w.dice - base.dice, `傷害骰：構裝 ${cg} 級、甲板 ${dk} 級`).toBe(bonus.dice)
        g.commit(removeDraft(g.k, g.state, 'pc', `cs_b${cg}`))
      }
    }
  })

  it('cap_construct_grade 關：照構裝自己的等級算（V 級在 I 級甲板上也是 V 級）', () => {
    const g = game(1, { cap_construct_grade: false })
    install(g, 'cs_b1')
    const base = weaponOn(g, 'cs_b1')
    g.commit(removeDraft(g.k, g.state, 'pc', 'cs_b1'))
    install(g, 'cs_b5')
    const w = weaponOn(g, 'cs_b5')
    expect(w.piece.runsAt).toBe(5)
    expect(w.hit - base.hit).toBe(2)
    expect(w.dice - base.dice).toBe(2)
  })

  it('換成比較低級的甲板：裝著的構裝馬上照新甲板的等級算（不用重裝）', () => {
    const g = game(4)
    install(g, 'cs_b4')
    expect(info(g).equipped[0]!.runsAt).toBe(4)
    g.commit(equipDraft(g.k, g.state, 'pc', 'U2'))
    expect(info(g).equipped[0]!.runsAt).toBe(2)
    g.commit(equipDraft(g.k, g.state, 'pc', 'U4'))
    expect(info(g).equipped[0]!.runsAt).toBe(4)
  })
})

describe('邊界 CYBERSPACE 4.2／ITEMS 11.9：構裝槽（甲板的槽數、一件佔一或兩槽、被專屬構裝佔掉的槽）', () => {
  it('每個等級的槽數（3、4、5、6）：剛好裝滿；再多一件擋下，原因寫「槽滿了」並寫出能用幾槽；少裝一件就裝得下', () => {
    for (let dk = 1; dk <= 4; dk++) {
      const slots = dk + 2
      const g = game(dk)
      for (let i = 0; i < slots; i++) {
        expect(installBlock(g.k, g.state, 'pc', `cs_f${i}`), `第 ${i + 1} 件`).toBeNull()
        install(g, `cs_f${i}`)
      }
      expect(info(g)).toMatchObject({ capacity: slots, used: slots, free: 0 })
      expect(installBlock(g.k, g.state, 'pc', `cs_f${slots}`)).toBe(`構裝槽滿了（能用的 ${slots} 槽都裝著東西）。`)
      expect(() => installDraft(g.k, g.state, 'pc', `cs_f${slots}`)).toThrow(ActionBlocked)
      // 卸掉一件又裝得下
      g.commit(removeDraft(g.k, g.state, 'pc', 'cs_f0'))
      expect(installBlock(g.k, g.state, 'pc', `cs_f${slots}`)).toBeNull()
    }
  })

  it('佔兩槽的構裝體：剩 1 槽擋下（寫出只剩幾槽、要幾槽），剩 2 槽裝得下；裝了之後用掉 2 槽', () => {
    const g = game(2) // 4 槽
    for (const i of [0, 1, 2]) install(g, `cs_f${i}`) // 剩 1
    expect(info(g).free).toBe(1)
    expect(installBlock(g.k, g.state, 'pc', 'cs_b_body')).toBe('構裝槽不夠（只剩 1 槽，邊界的構裝體要 2 槽）。')
    g.commit(removeDraft(g.k, g.state, 'pc', 'cs_f2')) // 剩 2
    expect(installBlock(g.k, g.state, 'pc', 'cs_b_body')).toBeNull()
    install(g, 'cs_b_body')
    expect(info(g)).toMatchObject({ used: 4, free: 0 })
  })

  it('被專屬構裝佔掉的槽：能用的槽 = 槽數 − 佔掉的；佔掉 = 槽數 − 1 只剩一槽；≥ 槽數時一件都裝不了（能用的槽最少 0、不是負的）', () => {
    for (const taken of [0, 1, 3, 4, 5, 99]) {
      const g = game(2) // 4 槽
      reserve(g, taken)
      const cap = Math.max(0, 4 - taken)
      expect(info(g), `佔 ${taken}`).toMatchObject({ slotsTotal: 4, reserved: taken, capacity: cap, free: cap })
      const block = installBlock(g.k, g.state, 'pc', 'cs_f0')
      if (cap === 0) expect(block).toBe('構裝槽滿了（能用的 0 槽都裝著東西）。')
      else expect(block).toBeNull()
    }
  })

  it('已經裝著的東西遇到槽被佔掉：照槽的順序留前面放得下的，後面的記在 inactive（沒丟）；槽回來又算進去', () => {
    const g = game(2)
    for (const i of [0, 1, 2, 3]) install(g, `cs_f${i}`)
    expect(info(g).used).toBe(4)
    reserve(g, 2)
    expect(info(g).equipped.map((p) => p.id)).toEqual(['cs_f0', 'cs_f1'])
    expect(info(g).inactive).toEqual(['cs_f2', 'cs_f3'])
    reserve(g, 0)
    expect(info(g).equipped.map((p) => p.id)).toEqual(['cs_f0', 'cs_f1', 'cs_f2', 'cs_f3'])
    expect(info(g).inactive).toEqual([])
  })

  it('換成比較小的甲板：放不下的構裝退回背包（東西還在，只是不在槽上）、記一拍說明；換回大的，槽是新的一份（退回的不自動裝回）', () => {
    const g = game(4) // 6 槽
    for (const i of [0, 1, 2, 3, 4]) install(g, `cs_f${i}`)
    const report = g.commit(equipDraft(g.k, g.state, 'pc', 'U1')) // 3 槽
    expect(info(g)).toMatchObject({ capacity: 3, used: 3 })
    expect(info(g).equipped.map((p) => p.id)).toEqual(['cs_f0', 'cs_f1', 'cs_f2'])
    expect(report.at(-1)!.timeline.some((b) => /退回背包/.test(b.text))).toBe(true)
    for (const i of [3, 4]) expect(g.state.inventory.some((s) => s.id === `cs_f${i}`)).toBe(true)
    g.commit(equipDraft(g.k, g.state, 'pc', 'U4'))
    expect(info(g).equipped.map((p) => p.id)).toEqual(['cs_f0', 'cs_f1', 'cs_f2'])
  })

  it('沒有甲板（卸下）：沒有槽、裝不了任何東西，原因寫「沒有甲板」', () => {
    const g = game(2)
    g.commit(equipDraft(g.k, g.state, 'pc', null))
    expect(info(g)).toMatchObject({ has: false, slotsTotal: 0, capacity: 0 })
    expect(installBlock(g.k, g.state, 'pc', 'cs_f0')).toBe('沒有甲板。')
  })

  it('性質：任意的裝與卸（含佔兩槽的、佔槽的變動）之後，用掉的槽 ≤ 能用的槽、free = capacity − used、equipped 裡每件背包都有', () => {
    const ops = fc.array(fc.tuple(fc.constantFrom('install', 'remove', 'reserve', 'swap'), fc.nat(9)), { minLength: 1, maxLength: 25 })
    fc.assert(fc.property(fc.integer({ min: 1, max: 4 }), ops, (dk, list) => {
      const g = game(dk)
      const items = [...FILLERS.map((f) => f.id), 'cs_b_body', 'cs_b1', 'cs_b3']
      for (const [op, n] of list) {
        try {
          if (op === 'install') install(g, items[n % items.length]!)
          else if (op === 'remove') g.commit(removeDraft(g.k, g.state, 'pc', items[n % items.length]!))
          else if (op === 'reserve') reserve(g, n % 7)
          else g.commit(equipDraft(g.k, g.state, 'pc', `U${(n % 4) + 1}`))
        } catch (e) {
          if (!(e instanceof ActionBlocked)) throw e
        }
        const d = info(g)
        expect(d.used).toBeLessThanOrEqual(d.capacity)
        expect(d.free).toBe(d.capacity - d.used)
        expect(d.used).toBe(d.equipped.reduce((s, p) => s + p.size, 0))
        for (const p of d.equipped) expect(g.state.inventory.some((s) => s.id === p.id)).toBe(true)
      }
    }), { numRuns: 25 })
  }, 30_000)
})

describe('邊界 ITEMS 5.2／11.9：腳本的支數上限 = 甲板等級 + script_extra（預設 1）', () => {
  const take = (g: G, list: Array<{ item: string; qty: number }>) => g.commit(scriptsDraft(g.k, g.state, 'pc', list))

  it('每個甲板等級 1～4：剛好帶滿（等級 + 1）成立、再多一支擋下並寫出上限與現在要帶幾支；0 支（全部放下）成立', () => {
    for (let dk = 1; dk <= 4; dk++) {
      const g = game(dk)
      const limit = dk + 1
      expect(info(g).scriptLimit).toBe(limit)
      expect(scriptsBlock(g.k, g.state, 'pc', [{ item: 'it_b_s1', qty: limit }])).toBeNull()
      expect(scriptsBlock(g.k, g.state, 'pc', [{ item: 'it_b_s1', qty: limit + 1 }])).toBe(`最多帶 ${limit} 支腳本（${['', 'I', 'II', 'III', 'IV'][dk]} 級甲板），現在要帶 ${limit + 1} 支。`)
      take(g, [{ item: 'it_b_s1', qty: limit }])
      expect(info(g).scripts).toEqual([{ item: 'it_b_s1', qty: limit }])
      take(g, [])
      expect(info(g).scripts).toEqual([])
    }
  })

  it('兩種腳本合起來算：上限 3（II 級）時 2 + 1 成立、2 + 2 擋下；同一種拆成兩筆（1 + 2）合併成 3 支成立', () => {
    const g = game(2)
    expect(scriptsBlock(g.k, g.state, 'pc', [{ item: 'it_b_s1', qty: 2 }, { item: 'it_b_s2', qty: 1 }])).toBeNull()
    expect(scriptsBlock(g.k, g.state, 'pc', [{ item: 'it_b_s1', qty: 2 }, { item: 'it_b_s2', qty: 2 }])).toMatch(/最多帶 3 支/)
    take(g, [{ item: 'it_b_s1', qty: 1 }, { item: 'it_b_s1', qty: 2 }])
    expect(info(g).scripts).toEqual([{ item: 'it_b_s1', qty: 3 }])
  })

  it('數量的格式：0、負數、小數、NaN、超過安全整數都擋下（一條「要是 1 以上的整數」）', () => {
    const g = game(2)
    for (const qty of [0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY, Number.MAX_SAFE_INTEGER + 2]) {
      expect(scriptsBlock(g.k, g.state, 'pc', [{ item: 'it_b_s1', qty }]), String(qty)).toBe('腳本的數量要是 1 以上的整數。')
    }
  })

  it('背包不夠：IV 級甲板上限 5 支、背包 5 個時帶 5 成立；背包只剩 4 個時帶 5 被背包擋（寫出不夠）', () => {
    const g = game(4)
    expect(scriptsBlock(g.k, g.state, 'pc', [{ item: 'it_b_s1', qty: 5 }])).toBeNull()
    commit(g, [{ op: 'item', id: 'it_b_s1', qty: -1 }])
    expect(scriptsBlock(g.k, g.state, 'pc', [{ item: 'it_b_s1', qty: 5 }])).toMatch(/背包裡的.*不夠 5 個/)
  })

  it('不是腳本的東西、沒有甲板：各一句；沒有甲板時放下（空的）照樣成立', () => {
    const g = game(2)
    expect(scriptsBlock(g.k, g.state, 'pc', [{ item: 'cs_f0', qty: 1 }])).toMatch(/不是腳本/)
    g.commit(equipDraft(g.k, g.state, 'pc', null))
    expect(scriptsBlock(g.k, g.state, 'pc', [{ item: 'it_b_s1', qty: 1 }])).toBe('沒有甲板，不能帶腳本。')
    expect(scriptsBlock(g.k, g.state, 'pc', [])).toBeNull()
  })

  it('換成低級的甲板：帶著的腳本照新上限留前面的（上限 4 → 2：留 2 支，其餘放回背包）；規則表的 script_extra 改了上限跟著動', () => {
    const g = game(3)
    take(g, [{ item: 'it_b_s1', qty: 3 }, { item: 'it_b_s2', qty: 1 }])
    expect(info(g).scripts.reduce((n, s) => n + s.qty, 0)).toBe(4)
    g.commit(equipDraft(g.k, g.state, 'pc', 'U1'))
    expect(info(g).scriptLimit).toBe(2)
    expect(info(g).scripts).toEqual([{ item: 'it_b_s1', qty: 2 }])
    expect(g.state.inventory.find((s) => s.id === 'it_b_s2')!.qty).toBe(5)
    const h = game(1, { script_extra: 0 })
    expect(info(h).scriptLimit).toBe(1)
    const z = game(1, { script_extra: 3 })
    expect(info(z).scriptLimit).toBe(4)
  })

  it('性質：任意的腳本清單，成立的 ⇔ 合併後總數 ≤ 上限、且每種背包夠；成立的做完之後 scripts 就是那份（合併後）', () => {
    const entry = fc.record({ item: fc.constantFrom('it_b_s1', 'it_b_s2'), qty: fc.integer({ min: 1, max: 4 }) })
    fc.assert(fc.property(fc.integer({ min: 1, max: 4 }), fc.array(entry, { maxLength: 5 }), (dk, list) => {
      const g = game(dk)
      const total = list.reduce((n, s) => n + s.qty, 0)
      const per = (id: string) => list.filter((s) => s.item === id).reduce((n, s) => n + s.qty, 0)
      const ok = total <= dk + 1 && per('it_b_s1') <= 5 && per('it_b_s2') <= 5
      expect(scriptsBlock(g.k, g.state, 'pc', list) === null).toBe(ok)
      if (ok) {
        take(g, list)
        expect(info(g).scripts.reduce((n, s) => n + s.qty, 0)).toBe(total)
        expect(info(g).scripts.length).toBeLessThanOrEqual(2)
      }
    }), { numRuns: 30 })
  })
})

// 防止「凍結的狀態」被偷改（不變式第 1 條）：問裝不裝得了、帶不帶得了都不改狀態
describe('邊界：問的函式不改狀態', () => {
  it('installBlock、scriptsBlock、deckOf 在同一份狀態上連問幾次，狀態一字不差', () => {
    const g = game(2)
    install(g, 'cs_f0')
    const before: GameState = clone(g.state)
    for (const id of ['cs_f0', 'cs_f1', 'cs_b_body', 'nope']) installBlock(g.k, g.state, 'pc', id)
    scriptsBlock(g.k, g.state, 'pc', [{ item: 'it_b_s1', qty: 9 }])
    info(g)
    expect(g.state).toEqual(before)
  })
})
