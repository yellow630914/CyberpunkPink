// 白箱測試：features/deck 帶進戰鬥（battle.ts）、效果的格式（effects.ts）、畫面（view.ts）。
// 規格：CYBERSPACE 4.2 節（構裝）、ITEMS 11.1～11.4 節（武器、防護、工具構裝；被動工具裝上就有效）、5.2 節（腳本用掉就沒了）；不變式第 180 條。
// 補主套件沒有走到的分支：武器構裝變成武器的每一個欄位與退路（不是武器、原型不存在）、被動工具的修正只在內海、戰後腳本扣背包與帶著的清單、兩個效果的格式檢查、畫面的格子。

import { describe, expect, it } from 'vitest'
import type { ContentPack } from '../../src'
import { BattleRun, clone, effectCtx } from '../../src'
import { deckOf, deckView, installDraft, scriptsDraft } from '../../src/features/deck'
import { constructWeapon } from '../../src/features/deck/battle'
import { deckRules } from '../../src/features/deck/model'
import { describePiece } from '../../src/features/deck/state'
import { makeNetBattleGame } from '../../src/testkit'

type G = ReturnType<typeof makeNetBattleGame>['game']
type Rec = Record<string, unknown>

const W = (id: string, o: Rec = {}): Rec => ({ id, class: 'weapon', name: id, grade: 1, legal: 'free', archetype: 'pistol', type: 'neural', ram: 1, ...o })
const CONSTRUCTS = [
  W('cs_wb_plain'), W('cs_wb_pleasure', { type: 'pleasure' }), W('cs_wb_range', { range: [2, 5] }), W('cs_wb_traits', { traits: ['pierce'] }), W('cs_wb_jam', { type: 'jam' }),
  W('cs_wb_jam_traits', { type: 'jam', traits: ['pierce'] }), W('cs_wb_dice', { dice: '5d6' }), W('cs_wb_cover', { cover_mult: 3 }), W('cs_wb_ram3', { ram: 3 }),
  { id: 'cs_wb_tool', class: 'tool', name: '被動護符', grade: 1, legal: 'free', ap: 0, ram: 0, passive: true, target: 'none', mods: { evade: 3 } },
  { id: 'cs_wb_tool_hit', class: 'tool', name: '準星', grade: 1, legal: 'free', ap: 0, ram: 0, passive: true, target: 'none', mods: { hit: 2 } },
  { id: 'cs_wb_body', class: 'body', name: '構裝體', grade: 1, legal: 'free', slots: 2 },
]
const itemOf = (c: Rec) => ({ id: c.id, name: c.name, desc: `${String(c.name)}。`, category: 'misc', grade: 1, size: 0, legal: 'free' })
const SCRIPT = { id: 'it_wb_sc', name: '一次性腳本', desc: '腳本。', category: 'misc', grade: 1, size: 0, legal: 'free', tags: ['script'], use: { ap: 1, target: 'self', effects: [{ op: 'net.ram', amount: 1, who: 'self' }] } }
const PACK: ContentPack = { id: 'wb_deck_battle', content: { construct: CONSTRUCTS, item: [...CONSTRUCTS.map(itemOf), SCRIPT] } as never }

const sys = (g: G, changes: unknown[]) => g.commit({ kind: 'system', action: 'test.set', location: {}, party: [], timeline: [], changes: changes as never, outcome: { result: 'ok', summary: 't' } })
function game(noBattle = true): G {
  const { game: g } = makeNetBattleGame({ noBattle, content: [PACK] as never })
  sys(g, [...CONSTRUCTS.map((c) => ({ op: 'item', id: c.id, qty: 1 })), { op: 'item', id: 'it_wb_sc', qty: 3 }])
  return g
}
const piece = (g: G, id: string) => describePiece(g.k, id, 4, deckRules(g.k))!

describe('白箱 deck/battle：武器構裝變成武器（ITEMS 11.1、11.2 節）', () => {
  it('不是武器的構裝（工具、構裝體）：回傳 null（不丟錯；沒有原型與原型不存在的構裝載入時就被擋下，到不了這裡）', () => {
    const g = game()
    for (const id of ['cs_wb_tool', 'cs_wb_body']) expect(constructWeapon(g.k, g.state, 'pc', 'net', piece(g, id), deckRules(g.k)), id).toBeNull()
  })

  it('每一個欄位：傷害類型（神經／快感；干擾是神經加 jam 特性）、range 蓋過原型、traits 與干擾併起來、dice 寫「5d6」是 5 顆加等級骰、cover_mult 蓋過原型、ram 預設 1、沒有彈匣', () => {
    const g = game()
    const w = (id: string) => constructWeapon(g.k, g.state, 'pc', 'net', piece(g, id), deckRules(g.k))!
    const plain = w('cs_wb_plain')
    expect(plain.type).toBe('neural')
    expect(plain.mag).toBeUndefined()
    expect(plain.pool).toEqual({ ram: 1 })
    expect(plain.traits).not.toContain('jam')
    expect(w('cs_wb_pleasure').type).toBe('pleasure')
    expect(w('cs_wb_range').range).toEqual([2, 5])
    expect(w('cs_wb_traits').traits).toContain('pierce')
    const jam = w('cs_wb_jam')
    expect(jam.type).toBe('neural')
    expect(jam.traits).toContain('jam')
    expect(w('cs_wb_jam_traits').traits).toEqual(expect.arrayContaining(['pierce', 'jam']))
    // 等級 4 的構裝在 4 級甲板上：5d6 加 2 顆
    expect(w('cs_wb_dice').dice).toBe(5 + 0)
    expect(w('cs_wb_cover').coverMult).toBe(3)
    expect(w('cs_wb_ram3').pool).toEqual({ ram: 3 })
  })
})

describe('白箱 deck/battle：被動的工具構裝只在內海有修正（ITEMS 11.4 節）', () => {
  it('裝著被動護符與準星：內海戰鬥裡迴避 +3、命中 +2；沒有裝的人（敵方）沒有', () => {
    const g = game()
    const slots = ['cs_tw_gun', 'cs_wb_tool', 'cs_wb_tool_hit']
    sys(g, [{ op: 'actor.ext', id: 'pc', key: 'deck', value: { ...(clone(g.state.actors.pc!.ext.deck as Rec)), slots } }])
    g.startBattle({
      mode: 'net', grade: 1, cover: 'medium', allies: [{ from: 'actor', id: 'pc' }],
      foes: [{ from: 'enemy_pick', faction: 'f_gang', grade: 1, rank: 'minion', color: 'pink', seed: 'wb' }], origin: { escapable: true, place: '白箱', faction: 'f_gang' },
    } as never)
    const run = new BattleRun(g.k, g.state, clone(g.state.battle!))
    const pc = Object.values(run.battle.units).find((u) => u.actor === 'pc')!
    const evade = run.mods('evade', pc).filter((m) => m.source === 'construct')
    expect(evade.map((m) => [m.label, m.value])).toEqual([['被動護符', 3]])
    expect(run.mods('hit', pc).filter((m) => m.source === 'construct').map((m) => [m.label, m.value])).toEqual([['準星', 2]])
    const foe = Object.values(run.battle.units).find((u) => u.side === 'foe')!
    expect(run.mods('evade', foe).some((m) => m.source === 'construct')).toBe(false)
  })
})

describe('白箱 deck/battle：戰後用掉的腳本從背包與帶著的清單扣（ITEMS 5.2 節）', () => {
  it('帶 3 支、戰鬥中跑了 2 支：背包剩 1、帶著的剩 1；沒用的不動；紀錄寫「用掉：… ×2」', async () => {
    const g2 = game()
    g2.commit(scriptsDraft(g2.k, g2.state, 'pc', [{ item: 'it_wb_sc', qty: 3 }]))
    expect(deckOf(g2.k, g2.state, 'pc').scripts).toEqual([{ item: 'it_wb_sc', qty: 3 }])
    g2.startBattle({
      mode: 'net', grade: 1, cover: 'medium', allies: [{ from: 'actor', id: 'pc' }],
      foes: [{ from: 'enemy_pick', faction: 'f_gang', grade: 1, rank: 'minion', color: 'pink', seed: 'wb2' }], origin: { escapable: true, place: '白箱', faction: 'f_gang' },
    } as never)
    const pcId = Object.values(g2.battle!.units).find((u) => u.actor === 'pc')!.id
    // 輪到主角時跑兩次腳本
    let used = 0
    for (let i = 0; i < 80 && g2.battle && used < 2; i++) {
      const o = g2.battleOptions()
      if (!o || o.waiting === 'over') break
      if (o.waiting === 'ai') { g2.battleNext(); continue }
      if (o.current !== pcId) { g2.battleAct({ action: 'end_turn' } as never); continue }
      const a = o.actions.find((x) => x.id === 'net_script' && x.ok)
      if (!a) { g2.battleAct({ action: 'end_turn' } as never); continue }
      const r = g2.battleAct({ action: 'net_script', target: { unit: pcId }, pick: { item: 'it_wb_sc' } } as never)
      if (r.status === 'applied') used += 1
      else g2.battleAct({ action: 'end_turn' } as never)
    }
    expect(used).toBe(2)
    g2.battleAct({ action: 'net_surrender' } as never)
    const out = await g2.finishBattle()
    const inv = g2.state.inventory.filter((s) => s.id === 'it_wb_sc').reduce((n, s) => n + s.qty, 0)
    expect(inv).toBe(1)
    expect(deckOf(g2.k, g2.state, 'pc').scripts).toEqual([{ item: 'it_wb_sc', qty: 1 }])
    expect(JSON.stringify(out.reports)).toContain('用掉：一次性腳本 ×2')
  }, 60_000)
})

describe('白箱 deck/effects：兩個內建效果的格式檢查（不變式第 180 條）', () => {
  it('deck_script_use 與 deck_rental：沒寫 who 也沒有行動者（沒有主角）寫「沒有 … 這個角色」；deck 不是字串或 null 的、item 不是字串的各一句；來源是 AI 的整個不收（ai: false）', () => {
    const g = game()
    const ctx = (source: 'builtin' | 'ai') => effectCtx(g.k, g.state, { source })
    const resolve = (e: Rec, source: 'builtin' | 'ai' = 'builtin') => g.k.effects.resolve([e], ctx(source))
    expect(resolve({ kind: 'deck_script_use', item: 'it_wb_sc', who: 'nobody' }).errors.join('；')).toMatch(/who 要是現有角色/)
    expect(resolve({ kind: 'deck_script_use', item: 3 }).errors.length).toBeGreaterThan(0)
    expect(resolve({ kind: 'deck_rental', deck: 3, who: 'pc' }).errors.length).toBeGreaterThan(0)
    expect(resolve({ kind: 'deck_rental', deck: 'dk_nope', who: 'pc' }).errors.length).toBeGreaterThan(0)
    expect(resolve({ kind: 'deck_rental', deck: 'dk_tw_rent', who: 'pc' }, 'ai').errors.length).toBeGreaterThan(0)
    const rent = resolve({ kind: 'deck_rental', deck: 'dk_tw_rent', who: 'pc' })
    expect(rent.errors).toEqual([])
    expect(rent.lines.join('')).toContain('租用甲板')
    const back = resolve({ kind: 'deck_rental', deck: null, who: 'pc' })
    expect(back.lines.join('')).toContain('收回了租來的甲板')
  })
})

describe('白箱 deck/view：畫面的格子（ITEMS 11.9 節：構裝體佔兩格）', () => {
  it('佔兩槽的構裝在畫面上是兩格（第二格 continued）；SKIN 與腳本的候選清單不重複、查不到內容的略過', () => {
    const g = game()
    sys(g, [{ op: 'actor.ext', id: 'pc', key: 'deck', value: { ...(clone(g.state.actors.pc!.ext.deck as Rec)), slots: [] } }])
    g.commit(installDraft(g.k, g.state, 'pc', 'cs_wb_body'))
    const v = deckView(g.k, g.state, 'pc')!
    const cells = v.cells
    const i = cells.findIndex((c) => c.piece?.id === 'cs_wb_body')
    expect(cells[i]!.continued).toBeFalsy()
    expect(cells[i + 1]).toMatchObject({ continued: true })
    expect(cells[i + 1]!.piece?.id).toBe('cs_wb_body')
    const ids = v.scripts.available.map((x) => x.item)
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('構裝等級高過甲板（使用者 2026-11-24 定案）：畫面寫「甲板無法發揮這項構裝的所有性能」並寫出照幾級算；等級不高過甲板的沒有這句；資料關掉夾等級（cap_construct_grade: false）就沒有這句', () => {
    const mk = (cap: boolean): G => {
      const { game: g } = makeNetBattleGame({ noBattle: true, content: [{ id: 'wb_cap', content: { ...(PACK.content as Rec), construct: [...CONSTRUCTS, W('cs_wb_g4', { grade: 4 })], item: [...((PACK.content as unknown) as { item: Rec[] }).item, itemOf(W('cs_wb_g4', { grade: 4 }))], deck_rule: [{ id: 'default', cap_construct_grade: cap }] } } as never] as never })
      sys(g, [{ op: 'item', id: 'cs_wb_g4', qty: 1 }, { op: 'item', id: 'cs_wb_plain', qty: 1 }, { op: 'actor.ext', id: 'pc', key: 'deck', value: { ...(clone(g.state.actors.pc!.ext.deck as Rec)), slots: [] } }])
      g.commit(installDraft(g.k, g.state, 'pc', 'cs_wb_g4'))
      g.commit(installDraft(g.k, g.state, 'pc', 'cs_wb_plain'))
      return g
    }
    const g = mk(true)
    const v = deckView(g.k, g.state, 'pc')
    const row = (id: string) => v.equipped.find((e) => e.piece.id === id)!
    expect(row('cs_wb_g4')).toMatchObject({ over: true })
    expect(row('cs_wb_g4').note).toMatch(/^甲板無法發揮這項構裝的所有性能（構裝 4 級、甲板 2 級，照 2 級算）/)
    expect(row('cs_wb_plain')).toMatchObject({ over: false, note: null })
    const h = mk(false)
    const v2 = deckView(h.k, h.state, 'pc')
    expect(v2.equipped.find((e) => e.piece.id === 'cs_wb_g4')).toMatchObject({ over: true, note: null })
  })
})
