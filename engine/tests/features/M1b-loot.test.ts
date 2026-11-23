// 驗收測試：dev/work/M1b-loot.md（cpp-feature）。掉落的格式與打贏之後的結算。
// 規格：ENEMIES 第 7 節（零件的件數與機率、現金晶片的範圍、機器）、1.3 節；dev/adr/0011（結束收成一份、骰子導出）；dev/adr/0007（每一種一次最多 100 個）。
// 只用測試自己帶的最小假資料，不讀 engine/data。

import { describe, expect, it } from 'vitest'
import type { Change, ContentPack, Report } from '../../src'
import { Game, createKernel } from '../../src'
import { CASH_RANGE, enemiesFeature } from '../../src/features/enemies'
import { lootRefs } from '../../src/features/enemies/loot'
import { BATTLE_SETUPS, TEST_COMBAT, makeBattleGame, observed, playOut } from '../../src/testkit'

const SKILLS = ['firearms', 'brawl', 'composure'].map((id) => ({ id, name: id, attr: id === 'composure' ? 'resolve' : id === 'firearms' ? 'reflex' : 'body', desc: `${id}。` }))
const WEAPONS = [{ id: 'pistol', name: '手槍', dice: 3, type: 'physical', range: [1, 4], mag: 2, cover_mult: 0.25, pierce: 0, traits: [], attr: 'reflex', skill: 'firearms' }]
const item = (id: string, name: string, category = 'misc') => ({ id, name, desc: `${name}。`, category, grade: 1, size: 1, legal: 'free' })
const ITEMS = [item('it_t_a', '甲零件'), item('it_t_b', '乙零件'), item('it_t_c', '丙零件'), item('it_t_top', '頂級晶片'), item('it_t_chip', '晶片', 'part')]
const foe = (id: string, rank: string, more: Record<string, unknown> = {}) => ({
  id, name: `測試${rank}`, desc: '測試用的敵人。', faction: 'hizakura', rank, grades: [1, 5], kind: 'human',
  position: { prefer: [1, 2], cover_use: 0.5 }, mode: 'lethal', weapons: [{ class: 'pistol' }], ai: { prefer: 'weakest', focus: 1, flee_below: 0 }, ...more,
})
const drop = (it: string, chance: number, more: Record<string, unknown> = {}) => ({ item: it, chance, ...more })
/** 兩件一定掉、一件一定不掉：件數的上限決定拿到幾件 */
const TWO_OF_THREE = [drop('it_t_a', 1), drop('it_t_b', 1), drop('it_t_c', 0)]
const PACK: ContentPack = {
  id: 'loot_test',
  content: {
    skill: SKILLS, weapon_class: WEAPONS, faction: [{ id: 'hizakura', name: '緋櫻重工', short: '緋櫻', class: 'corp' }], item: ITEMS,
    enemy: [
      foe('en_l_mook', 'minion', { loot: TWO_OF_THREE, cash: false }),
      foe('en_l_elite', 'elite', { loot: TWO_OF_THREE, cash: false }),
      // 三件都不掉，最後一件是 top
      foe('en_l_boss_none', 'boss', { loot: [drop('it_t_a', 0), drop('it_t_b', 0), drop('it_t_top', 0, { top: true })], cash: false }),
      // 前三件都掉、top 排在第四：件數已經滿了，要換掉最後一件，不超過 3
      foe('en_l_boss_full', 'boss', { loot: [drop('it_t_a', 1), drop('it_t_b', 1), drop('it_t_c', 1), drop('it_t_top', 0, { top: true })], cash: false }),
      // top 自己擲中了：不重複補
      foe('en_l_boss_hit', 'boss', { loot: [drop('it_t_top', 1, { top: true }), drop('it_t_a', 0)], cash: false }),
      // 雜兵與精英帶 top 時照一般的機率擲，不保證
      foe('en_l_mook_top', 'minion', { loot: [drop('it_t_top', 0, { top: true })], cash: false }),
      // 件數的下限（精英 1、首領 2）：機率低到不會擲中，也要從有機率的補；機率 0 的是「不掉」，不補
      foe('en_l_elite_min', 'elite', { loot: [drop('it_t_a', 0.0001), drop('it_t_b', 0.00005), drop('it_t_c', 0)], cash: false }),
      foe('en_l_boss_min', 'boss', { loot: [drop('it_t_b', 0.00005), drop('it_t_a', 0.0001), drop('it_t_c', 0.00002), drop('it_t_chip', 0)], cash: false }),
      foe('en_l_boss_one', 'boss', { loot: [drop('it_t_a', 0.0001), drop('it_t_b', 0)], cash: false }),
      foe('en_l_cash', 'minion'),
      foe('en_l_corp', 'minion', { cash: false }),
      foe('en_l_same', 'minion', { loot: [drop('it_t_a', 1)], cash: false }),
      foe('en_l_many', 'minion', { loot: [drop('it_t_a', 1, { qty: [100, 100] })], cash: false }),
      foe('en_l_range', 'minion', { loot: [drop('it_t_a', 1, { qty: [2, 4] })], cash: false }),
      foe('en_l_chance', 'minion', { loot: [drop('it_t_a', 0.5)], cash: false }),
      // 還沒轉成資料的敘述：收下、不發
      foe('en_l_text', 'minion', { loot: [{ text: '外皮（緋櫻，II 級）' }, { text: '員工憑證' }] }),
    ],
  },
}
const FEATURES = [enemiesFeature, TEST_COMBAT]
const refs = (...ids: string[]) => ids.map((id) => ({ from: 'enemy', id }))
const allies = () => BATTLE_SETUPS.encounter(1).allies

interface Fight {
  outs?: Array<string | undefined>
  outcome?: string
  seed?: number
  grade?: 1 | 2 | 3 | 4 | 5
  taken?: number[]
}
/** 一場我方對給的敵人：照 outs 把每一個敵人設成退出的方式，分出結果，結算。 */
async function fight(ids: string[], o: Fight = {}) {
  const test = makeBattleGame({
    features: FEATURES, content: [PACK], seed: o.seed ?? 3,
    battle: { mode: 'meat', grade: o.grade ?? 1, cover: 'medium', allies: allies(), foes: refs(...ids) as never, origin: { escapable: true, place: '測試用的倉庫' } },
  })
  const game = test.game
  const foes = Object.values(game.state.battle!.units).filter((u) => u.side === 'foe')
  foes.forEach((u, i) => {
    const out = o.outs ? o.outs[i] : 'down'
    if (out) u.out = out
    if (o.taken?.includes(i)) u.ext.enemies = { taken: true }
  })
  game.state.battle!.result = { outcome: o.outcome ?? 'win', text: '打完了。' }
  const before = { cash: game.state.money.cash, cred: game.state.money.cred, inv: structuredClone(game.state.inventory) }
  const { result, violations } = await observed(game, () => game.finishBattle())
  expect(violations).toEqual([])
  const report = result.reports.find((r) => r.action === 'battle.end') as Report
  const changes = report.changes as Array<Change & { id?: string; qty?: number; delta?: number }>
  return {
    game, report, before,
    items: changes.filter((c) => c.op === 'item').map((c) => [c.id, c.qty] as [string, number]),
    cash: changes.filter((c) => c.op === 'cash').map((c) => c.delta as number),
    lines: report.narration?.results ?? [],
  }
}
const owned = (game: Game, id: string) => game.state.inventory.filter((s) => s.id === id).reduce((n, s) => n + s.qty, 0)

describe('件數：位階決定上限（ENEMIES 第 7 節：雜兵 0～1、精英 1～2、首領 2～3）', () => {
  it('chance 1 的兩件加 chance 0 的一件：雜兵只拿到第一件（上限 1）', async () => {
    const r = await fight(['en_l_mook'])
    expect(r.items).toEqual([['it_t_a', 1]])
    expect(owned(r.game, 'it_t_a')).toBe(1)
    expect(owned(r.game, 'it_t_b')).toBe(0)
  })

  it('精英拿到兩件（上限 2），機率 0 的那一件不會掉', async () => {
    const r = await fight(['en_l_elite'])
    expect(r.items).toEqual([['it_t_a', 1], ['it_t_b', 1]])
    expect(owned(r.game, 'it_t_c')).toBe(0)
  })

  it('首領的三件都沒擲中時還是有 top 的那一件', async () => {
    const r = await fight(['en_l_boss_none'])
    expect(r.items).toEqual([['it_t_top', 1]])
  })

  it('首領已經擲滿三件而沒有 top：換掉最後一件補上 top，總共還是三件', async () => {
    const r = await fight(['en_l_boss_full'])
    expect(r.items).toEqual([['it_t_a', 1], ['it_t_b', 1], ['it_t_top', 1]])
  })

  it('首領自己擲中 top 時不重複補', async () => {
    const r = await fight(['en_l_boss_hit'])
    expect(r.items).toEqual([['it_t_top', 1]])
    expect(r.lines).toEqual(['拿到 頂級晶片'])
  })

  it('精英至少 1 件：都沒擲中時補機率最高的那一件；機率 0 的不補', async () => {
    const r = await fight(['en_l_elite_min'])
    expect(r.items).toEqual([['it_t_a', 1]])
  })

  it('首領至少 2 件：都沒擲中時補機率最高的兩件（甲、乙），不是 loot 的前兩筆；有機率的不夠就只有那些', async () => {
    const r = await fight(['en_l_boss_min'])
    expect(r.items).toEqual([['it_t_a', 1], ['it_t_b', 1]])
    const one = await fight(['en_l_boss_one'])
    expect(one.items).toEqual([['it_t_a', 1]])
  })

  it('雜兵帶 top 時照一般的機率，不保證', async () => {
    const r = await fight(['en_l_mook_top'])
    expect(r.items).toEqual([])
  })

  it('qty 是 [最少, 最多] 時在範圍裡擲；機率 0.5 的在大量樣本裡有掉有不掉', async () => {
    for (const seed of [1, 2, 3, 4, 5, 6]) {
      const r = await fight(['en_l_range'], { seed })
      expect(r.items).toHaveLength(1)
      expect(r.items[0]![1]).toBeGreaterThanOrEqual(2)
      expect(r.items[0]![1]).toBeLessThanOrEqual(4)
    }
    const hits = []
    for (let seed = 1; seed <= 24; seed++) hits.push((await fight(['en_l_chance'], { seed })).items.length)
    expect(hits).toContain(0)
    expect(hits).toContain(1)
  })
})

describe('算誰的、什麼時候算', () => {
  it('被打倒、昏過去、被制伏、投降的都算；逃走的、被帶走的不算', async () => {
    const r = await fight(['en_l_same', 'en_l_same', 'en_l_same', 'en_l_same'], { outs: ['down', 'subdued', 'surrendered', 'burnout'] })
    expect(r.items).toEqual([['it_t_a', 4]])
    const fled = await fight(['en_l_same', 'en_l_same', 'en_l_same'], { outs: ['down', 'fled', 'removed'] })
    expect(fled.items).toEqual([['it_t_a', 1]])
    // 被帶走的標記由招牌行動寫（ext.enemies.taken）：單位是被打倒的，也不算
    const taken = await fight(['en_l_same', 'en_l_same'], { outs: ['down', 'down'], taken: [1] })
    expect(taken.items).toEqual([['it_t_a', 1]])
  })

  it('沒有退出的（還站著的）不算', async () => {
    const r = await fight(['en_l_same', 'en_l_same'], { outs: ['down', undefined] })
    expect(r.items).toEqual([['it_t_a', 1]])
  })

  it('戰敗、脫離、投降時沒有掉落、沒有現金', async () => {
    for (const outcome of ['lose', 'fled', 'surrender']) {
      const r = await fight(['en_l_cash', 'en_l_same'], { outcome })
      expect(r.items, outcome).toEqual([])
      expect(r.cash, outcome).toEqual([])
      expect(r.game.state.money.cash).toBe(r.before.cash)
    }
  })

  it('沒有 enemy 欄位的單位（直接給的）與我方都不算', async () => {
    const test = makeBattleGame({ features: FEATURES, content: [PACK], battle: 'encounter' })
    const game = test.game
    for (const u of Object.values(game.state.battle!.units)) u.out = 'down'
    game.state.battle!.result = { outcome: 'win', text: '' }
    const { result } = await observed(game, () => game.finishBattle())
    const changes = result.reports.find((r) => r.action === 'battle.end')!.changes
    expect(changes.filter((c) => c.op === 'item' || c.op === 'cash')).toEqual([])
  })
})

describe('現金晶片（ENEMIES 第 7 節：照等級；cash: false 的企業人沒有現金）', () => {
  it('表和設計書一樣', () => {
    expect(CASH_RANGE).toEqual({ 1: [40, 120], 2: [130, 380], 3: [400, 1200], 4: [1300, 3900], 5: [4000, 12000] })
  })

  it('每一級的現金落在那一級的範圍裡；是現金，不是帳戶', async () => {
    for (const grade of [1, 2, 3, 4, 5] as const) {
      const [lo, hi] = CASH_RANGE[grade]!
      for (const seed of [1, 2, 3]) {
        const r = await fight(['en_l_cash'], { grade, seed })
        expect(r.cash, `${grade}`).toHaveLength(1)
        expect(r.cash[0]).toBeGreaterThanOrEqual(lo)
        expect(r.cash[0]).toBeLessThanOrEqual(hi)
        expect(r.game.state.money.cash).toBe(r.before.cash + r.cash[0]!)
        expect(r.game.state.money.cred).toBe(r.before.cred)
      }
    }
  })

  it('每個人各擲一次，合成一筆變更與一行', async () => {
    const r = await fight(['en_l_cash', 'en_l_cash', 'en_l_cash'], { grade: 2 })
    expect(r.cash).toHaveLength(1)
    expect(r.cash[0]).toBeGreaterThanOrEqual(3 * 130)
    expect(r.cash[0]).toBeLessThanOrEqual(3 * 380)
    expect(r.lines.filter((l) => l.includes('現金'))).toHaveLength(1)
  })

  it('cash: false 的沒有現金；沒寫 loot 只有現金的也成立', async () => {
    const r = await fight(['en_l_corp'])
    expect(r.cash).toEqual([])
    expect(r.lines).toEqual([])
    const only = await fight(['en_l_cash'])
    expect(only.items).toEqual([])
  })
})

describe('進報告、進背包（ADR 0011、0007）', () => {
  it('同一種東西合成一筆變更，每個東西一行，背包真的增加', async () => {
    const r = await fight(['en_l_same', 'en_l_same', 'en_l_same'])
    expect(r.items).toEqual([['it_t_a', 3]])
    expect(r.lines).toEqual(['拿到 甲零件 ×3'])
    expect(owned(r.game, 'it_t_a')).toBe(3)
    expect(r.report.outcome.summary).toContain('拿到 甲零件 ×3。')
  })

  it('不同的東西各一行，現金一行放最後', async () => {
    const r = await fight(['en_l_elite', 'en_l_cash'], { outs: ['down', 'down'] })
    expect(r.lines.slice(0, 2)).toEqual(['拿到 甲零件', '拿到 乙零件'])
    expect(r.lines[2]).toMatch(/^拿到現金晶片 [\d,]+$/)
    expect(r.lines).toHaveLength(3)
  })

  it('每一種一次最多 100 個', async () => {
    const r = await fight(['en_l_many', 'en_l_many'])
    expect(r.items).toEqual([['it_t_a', 100]])
    expect(owned(r.game, 'it_t_a')).toBe(100)
  })

  it('沒有掉落時結束的報告照常、沒有多出來的變更', async () => {
    const r = await fight(['en_l_text'], { outs: ['down'] })
    expect(r.items).toEqual([])
    expect(r.cash).toHaveLength(1)
  })
})

describe('格式：載入時檢查（ENEMIES 第 7 節、第 15 節）', () => {
  const load = (enemy: Record<string, unknown>, items = ITEMS) => {
    const k = createKernel([enemiesFeature])
    k.content.loadPack({ id: 'fmt', content: { skill: SKILLS, weapon_class: WEAPONS, faction: PACK.content.faction, item: items, enemy: [foe('en_l_x', 'minion', enemy)] } })
    return k
  }

  it('{ text } 的掉落載得進來、不丟錯、引用檢查也過', () => {
    const k = load({ loot: [{ text: '外皮（緋櫻，II 級）' }, { text: '員工憑證' }] })
    expect(k.content.checkRefs()).toEqual([])
  })

  it('item 查不到的在載入時被擋，訊息裡有那個 id', () => {
    const k = load({ loot: [drop('it_t_ghost', 0.5)] })
    expect(k.content.checkRefs().join('\n')).toContain('it_t_ghost')
    expect(() => new Game({ features: FEATURES, content: [{ id: 'bad', content: { skill: SKILLS, weapon_class: WEAPONS, faction: PACK.content.faction, item: ITEMS, enemy: [foe('en_l_x', 'minion', { loot: [drop('it_t_ghost', 0.5)] })] } }] })).toThrow(/it_t_ghost/)
  })

  it('任何一種物品類的內容都可以：不同分類的物品、零件與設計圖的 id', () => {
    const k = load({ loot: [drop('it_t_chip', 1)] })
    expect(k.content.checkRefs()).toEqual([])
    // 零件與設計圖是別的內容種類：其中一種查得到就引用那一種；都查不到引用 item（訊息裡有那個 id）
    const found = (kind: string) => ({ has: (k2: string, id: string) => k2 === kind && id === 'x' })
    for (const kind of ['item', 'part', 'blueprint']) expect(lootRefs(found(kind), { loot: [drop('x', 1), { text: '敘述' }] })).toEqual([[kind, 'x']])
    expect(lootRefs(found('none'), { loot: [drop('x', 1)] })).toEqual([['item', 'x']])
  })

  it('格式不對的被擋：機率超出 0～1、qty 不是正整數或範圍、top 不是布林、cash 不是布林、既沒有 item 也沒有 text', () => {
    const bad = (e: Record<string, unknown>) => () => load(e)
    expect(bad({ loot: [drop('it_t_a', 1.5)] })).toThrow(/chance/)
    expect(bad({ loot: [{ item: 'it_t_a' }] })).toThrow(/chance/)
    expect(bad({ loot: [drop('it_t_a', 1, { qty: 0 })] })).toThrow(/qty/)
    expect(bad({ loot: [drop('it_t_a', 1, { qty: [3, 2] })] })).toThrow(/qty/)
    expect(bad({ loot: [drop('it_t_a', 1, { top: 'yes' })] })).toThrow(/top/)
    expect(bad({ cash: 'no' })).toThrow(/cash/)
    expect(bad({ loot: [{ chance: 1 }] })).toThrow(/loot\[0\]/)
    expect(bad({ loot: 'x' })).toThrow(/loot/)
  })

  it('有 base 的敵人：自己寫的 loot 蓋掉 base 的', () => {
    const k = createKernel([enemiesFeature])
    k.content.loadPack({
      id: 'base', content: {
        skill: SKILLS, weapon_class: WEAPONS, faction: PACK.content.faction, item: ITEMS,
        enemy: [foe('en_l_base', 'minion', { loot: [{ text: '敘述' }] }), { id: 'en_l_child', base: 'en_l_base', loot: [drop('it_t_a', 1)] }],
      },
    })
    expect(k.content.checkRefs()).toEqual([])
  })
})

describe('骰子是導出來的（ADR 0011）', () => {
  const sample = async (seed: number) => {
    const r = await fight(['en_l_chance', 'en_l_range', 'en_l_cash', 'en_l_chance', 'en_l_cash'], { seed, grade: 3 })
    return { items: r.items, cash: r.cash, lines: r.lines }
  }

  it('同一個種子、同一個狀態跑兩次結果一樣', async () => {
    expect(await sample(11)).toEqual(await sample(11))
  })

  it('換種子結果會不同', async () => {
    const all = await Promise.all([1, 2, 3, 4, 5, 6].map(sample))
    expect(new Set(all.map((x) => JSON.stringify(x))).size).toBeGreaterThan(1)
  })

  it('只在結束時擲：打的過程中沒有物品與現金的變更；真的打完一場的結果也有掉落', async () => {
    const setup = { mode: 'meat', grade: 1, cover: 'medium', allies: allies(), foes: refs('en_l_same', 'en_l_same', 'en_l_cash', 'en_l_same') as never, origin: { escapable: true, place: '測試用的倉庫' } } as const
    const { game } = makeBattleGame({ features: FEATURES, content: [PACK], seed: 5, battle: setup })
    const { outcome } = playOut(game)
    expect(outcome).toBe('win')
    const steps = game.state.reports.filter((r) => r.action === 'battle.step')
    expect(steps.length).toBeGreaterThan(0)
    expect(steps.flatMap((r) => r.changes).filter((c) => c.op === 'item' || c.op === 'cash')).toEqual([])
    const cashBefore = game.state.money.cash
    const { result, violations } = await observed(game, () => game.finishBattle())
    expect(violations).toEqual([])
    const end = result.reports.find((r) => r.action === 'battle.end')!
    expect(end.changes.filter((c) => c.op === 'item')).toEqual([{ op: 'item', id: 'it_t_a', qty: 3 }])
    expect(game.state.money.cash).toBeGreaterThan(cashBefore)
  })
})
