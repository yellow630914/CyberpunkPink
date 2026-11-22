// 2026-11-22 的設計決定（docs/log/DECISIONS.md）的回歸測試。每一條對一個測試：
//   1. SKILLS 第 12 節：槍手全裝的容量 62（照 SKILL_TREES；引擎裡的槍手樹加起來也是 62）
//   2. ENEMIES 4.4 節：被困在第 4 格（站在第 4 格、前面三格沒有還站著的同伴）擲士氣失敗就投降
//   3. ENEMIES 第 2、13 節：兵種的護甲與行動點修正夾住（護甲最少 0、行動點最少 1）；強度係數最高 2（格式檢查與程式）
//   4. BALANCE 7.4 節：存檔規則的數字壞掉（不是有限的數字）回到預設，不是 0
//   5. CORE_RULES 6.4 節：有橋的每一類容量最低 8（abilities-capacity.boundary.test.ts 與 whitebox 也測）
//   6. EQUIPMENT 6.1 節：外套敞開減半（無條件捨去、最少 1）；裝甲制服的內藏槽不減半
//   7. AI_TASKS 4.1 節：正文的硬規則——不擋世界裡的數字，擋狀態欄、骰值語彙與機制的數字（B014 已有基本三條）

import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import type { ContentPack, UnitRef } from '../../src'
import { createKernel, sanitizeRules } from '../../src'
import { CORE_PACK } from '../../data'
import { characterFeature } from '../../src/features/character'
import { concealment, gearFeature } from '../../src/features/gear'
import { enemiesFeature, enemyStats } from '../../src/features/enemies'
import { BATTLE_SETUPS, TEST_COMBAT, makeGame, makeState } from '../../src/testkit'
import { Game } from '../../src'
import { allFeatures } from '../../src/features'
import { arena, duel, one } from '../helpers/battle'

const doc = (rel: string) => readFileSync(fileURLToPath(new URL(`../../../docs/${rel}`, import.meta.url)), 'utf8')

// ---------------------------------------------------------------------------------------------
describe('1. 槍手全裝的容量 62', () => {
  it('引擎裡的槍手樹（27 個技能）容量加起來 62，SKILLS 第 12 節的表寫 62', () => {
    const g = new Game({ features: allFeatures(), content: [CORE_PACK], strict: true })
    const tree = g.k.content.list<{ id: string; path: string; cap: number }>('ability').filter((a) => a.path === 'gunner')
    expect(tree).toHaveLength(27)
    expect(tree.reduce((n, a) => n + a.cap, 0)).toBe(62)
    const row = doc('systems/SKILLS.md').split('\n').find((l) => l.startsWith('| 槍手 | 現實 |'))!
    expect(row.split('|').map((c) => c.trim())[4]).toBe('62')
  })
})

// ---------------------------------------------------------------------------------------------
const baseEnemy = (id: string, rank: string, more: Record<string, unknown> = {}) => ({
  id, name: `兵${id}`, desc: '測試用的敵人。', faction: 'none', rank, grades: [1, 5], kind: 'human', position: { prefer: [1] }, mode: 'lethal',
  weapons: [{ class: 'pistol' }], ai: { prefer: 'weakest', focus: 1, flee_below: 0.5 }, ...more,
})
const PACK: ContentPack = {
  id: 'decisions_1122',
  content: {
    skill: ['firearms', 'brawl', 'composure'].map((id) => ({ id, name: id, attr: id === 'composure' ? 'resolve' : id === 'firearms' ? 'reflex' : 'body', desc: `${id}。` })),
    weapon_class: [{ id: 'pistol', name: '手槍', dice: 3, type: 'physical', range: [1, 4], mag: 2, cover_mult: 0.25, pierce: 1, traits: [], attr: 'reflex', skill: 'firearms' }],
    faction: [],
    enemy: [baseEnemy('en_minion', 'minion'), baseEnemy('en_elite', 'elite')],
  },
}

describe('2. 士氣：被困在第 4 格就投降', () => {
  /** 敵方的單位照 slots 站（第一個是被測的）；我方一個人。 */
  function field(slots: number[]) {
    const foes: UnitRef[] = slots.map((slot) => ({ from: 'enemy', id: 'en_minion', grade: 1, slot }) as UnitRef)
    return arena({ ...duel([one({}, 1)], []), foes }, [enemiesFeature, TEST_COMBAT], (k) => k.content.loadPack(PACK))
  }
  const fail = (a: ReturnType<typeof field>, u: ReturnType<ReturnType<typeof field>['foe']>) => {
    u.hp!.now = 1 // 低於 flee_below 就擲士氣；骰 2 一定不過
    return a.k.battle.emit('ai.step', { run: a.run([2]), unit: u })
  }

  it('站在第 4 格、前面三格沒有還站著的同伴：一對一也投降（原本是撤退）', () => {
    const a = field([4])
    expect(a.foe(1).slot).toBe(4)
    expect(fail(a, a.foe(1))).toBe(true)
    expect(a.foe(1).out).toBe('surrendered')
  })

  it('前面三格任何一格有還站著的同伴就不算被困：撤退', () => {
    for (const front of [1, 2, 3]) {
      const a = field([4, front])
      fail(a, a.foe(1))
      expect(a.foe(1).out, `第 ${front} 格有同伴`).toBe('fled')
    }
  })

  it('前面的同伴倒下了就又算被困；不在第 4 格的不算（獨自站在第 3 格一對一還是撤退）', () => {
    const a = field([4, 2])
    a.foe(2).out = 'down'
    fail(a, a.foe(1))
    expect(a.foe(1).out).toBe('surrendered')
    const b = field([3])
    fail(b, b.foe(1))
    expect(b.foe(1).out).toBe('fled')
  })
})

// ---------------------------------------------------------------------------------------------
describe('3. 兵種的護甲與行動點修正夾住；強度係數最高 2', () => {
  const kernel = (...enemies: Array<{ id: string }>) => { const k = createKernel([enemiesFeature, TEST_COMBAT]); k.content.loadPack({ ...PACK, content: { ...PACK.content, enemy: enemies } }); return k }

  it('護甲：I 級的表是 1，修正 −5 也只到 0；行動點：雜兵的表是 4，修正 −9 也至少 1', () => {
    const k = kernel(baseEnemy('en_soft', 'minion', { mods: { armor: -5, ap: -9 } }), baseEnemy('en_plain', 'minion'))
    const s = enemyStats(k, makeState(), 'en_soft', { grade: 1 })
    expect(s.armor).toBe(0)
    expect(s.ap).toBe(1)
    // 剛好在邊上：護甲 −1 → 0；行動點 −3 → 1（不被夾）、−4 → 1（夾住）
    for (const [mods, armor, ap] of [[{ armor: -1, ap: -3 }, 0, 1], [{ armor: 0, ap: -2 }, 1, 2], [{ armor: -2, ap: -4 }, 0, 1]] as const) {
      const k2 = kernel(baseEnemy('en_edge', 'minion', { mods }))
      expect(enemyStats(k2, makeState(), 'en_edge', { grade: 1 })).toMatchObject({ armor, ap })
    }
    expect(enemyStats(k, makeState(), 'en_plain', { grade: 1 })).toMatchObject({ armor: 1, ap: 4 })
  })

  it('強度係數：格式檢查最高 2（2 可以、2.01 不行；遭遇的 foes 一樣）；程式裡給更大的也只乘 2', () => {
    const k = kernel()
    const problems = (kind: string, e: Record<string, unknown>) => k.content.validate(kind, [e]).join('\n')
    expect(problems('enemy', baseEnemy('en_x', 'elite', { strength: 2 }))).toBe('')
    expect(problems('enemy', baseEnemy('en_x', 'elite', { strength: 2.01 }))).toMatch(/strength.*0 到 2/)
    const enc = (strength: number) => ({ id: 'enc_x', name: '地點', grade: 1, cover: 'sparse', foes: [{ enemy: 'en_elite', strength }] })
    expect(problems('encounter', enc(2))).toBe('')
    expect(problems('encounter', enc(2.5))).toMatch(/foes\[0\]\.strength.*0 到 2/)
    const k2 = kernel(baseEnemy('en_elite', 'elite'))
    const hp = (strength: number) => enemyStats(k2, makeState(), 'en_elite', { grade: 1, allies: 4, strength }).hp
    expect(hp(2)).toBe(220)
    expect(hp(5)).toBe(220)
  })
})

// ---------------------------------------------------------------------------------------------
describe('4. 存檔規則：壞掉的數字回到預設，不是 0', () => {
  it('defeatMoneyCap：不是有限的數字（NaN、字串、物件、無限大）回到預設（不設上限）；負數夾成 0；0 與正數照原值', () => {
    const cap = (v: unknown) => sanitizeRules({ defeatMoneyCap: v }).defeatMoneyCap
    for (const bad of [Number.NaN, 'abc', {}, [], true, Infinity, -Infinity, undefined, null]) expect(cap(bad), String(bad)).toBeNull()
    expect(cap(-5)).toBe(0)
    expect(cap(0)).toBe(0)
    expect(cap(1500)).toBe(1500)
    expect(cap('800')).toBe(800)
    expect(cap(12.6)).toBe(13)
  })

  it('其他起始數字壞掉也回到預設：每週帳單倍率、歷練倍率、起始的點數與錢', () => {
    const d = sanitizeRules({})
    const bad = sanitizeRules({ billMult: 'x', xpMult: Number.NaN, startXp: {}, startSkillPoints: 'x', startPerkPoints: Number.NaN, startCyberPoints: null, startMoney: undefined, defeatMoneyLoss: 'x' })
    expect(bad).toEqual(d)
  })
})

// ---------------------------------------------------------------------------------------------
describe('6. 外套敞開減半；裝甲制服的內藏槽不減半', () => {
  const bp = (id: string, kind: string, more: Record<string, unknown> = {}) => ({ id, kind, name: id, desc: `${id}。`, brand: 'b', grade: 1, legal: 'free', price: 0, size: 1, weight: 1, require: [], optional: [], ...more })
  const PACK6: ContentPack = {
    id: 'd6',
    content: { blueprint: [bp('bp_coat', 'armor', { armor: 0, covers: ['outer'], weight_class: 'light', conceal: 5 }), bp('bp_jacket', 'armor', { armor: 0, covers: ['outer'], weight_class: 'light', conceal: 3 }), bp('bp_uniform', 'armor', { armor: 1, covers: ['armor'], weight_class: 'medium', conceal_add: 2 })] },
  }
  const capacity = (worn: Record<string, string>, coat: 'open' | 'closed') => {
    const k = createKernel([gearFeature])
    k.content.loadPack(PACK6)
    const state = makeState()
    state.inventory = Object.entries(worn).map(([, id], i) => ({ id, qty: 1, data: { uid: `u${i}`, parts: {} } }))
    state.actors.pc!.ext.gear = { worn: Object.fromEntries(Object.keys(worn).map((slot, i) => [slot, `u${i}`])), acc: {}, carry: {}, quick: [], coat }
    return concealment(k, state, 'pc').capacity
  }

  it('長外套 5 → 敞開 2（捨去）；短外套 3 → 1；扣上照原值', () => {
    expect(capacity({ outer: 'bp_coat' }, 'closed')).toBe(5)
    expect(capacity({ outer: 'bp_coat' }, 'open')).toBe(2)
    expect(capacity({ outer: 'bp_jacket' }, 'closed')).toBe(3)
    expect(capacity({ outer: 'bp_jacket' }, 'open')).toBe(1)
  })

  it('裝甲制服的 +2 不減半：長外套敞開 2 ＋ 2 ＝ 4；只穿制服敞開與扣上都是 1 ＋ 2 ＝ 3', () => {
    expect(capacity({ outer: 'bp_coat', armor: 'bp_uniform' }, 'open')).toBe(4)
    expect(capacity({ outer: 'bp_coat', armor: 'bp_uniform' }, 'closed')).toBe(7)
    expect(capacity({ armor: 'bp_uniform' }, 'open')).toBe(3)
    expect(capacity({ armor: 'bp_uniform' }, 'closed')).toBe(3)
  })
})

// ---------------------------------------------------------------------------------------------
describe('7. 正文的硬規則（AI_TASKS 4.1 節）：世界裡的數字放行，狀態欄、骰值語彙與機制的數字擋下', () => {
  function lost(reply: string) {
    const t = makeGame({ features: [characterFeature, TEST_COMBAT], pc: { hp: 30, load: 3, afterglow: 1, sink: 4 }, actors: [], seed: 11, ai: { ai: 1, narrate: 1, retry: { narrate: 1 } }, fake: { byTask: { narrate: [{ text: reply }, { text: reply }] } } })
    t.game.startBattle({ ...BATTLE_SETUPS.hopeless(), allies: [{ from: 'actor', id: 'pc' }] })
    while (t.game.battle && !t.game.battle.result) t.game.battleNext({ anyone: true })
    return t.game
  }
  const stored = async (reply: string) => {
    const g = lost(`${reply}\n<covered>1</covered>`)
    await g.finishBattle()
    return g.state.reports.map((r) => r.narration?.text ?? '').join('\n')
  }

  const ALLOWED = [
    '凌晨 3 點，十七樓的走廊只剩兩個人。他把 2,000 元塞進你手裡：「拿去，別問。」',
    '她數了數，三十一個人，他們走了 12 分鐘才到。你記得那間 B2 的倉庫。',
    '他說：3/4 的人都已經走了。',
    '你受到 3 倍的驚嚇，倒在地上。', // 「3 倍」不是機制的點數
  ]
  const BLOCKED = [
    'HP: 30/30',
    'HP 30',
    '感載 0/52',
    '生命 12/30',
    '你擲出 17，贏了。',
    '你骰出 3 點，輸了。',
    '要過 DC 13 的檢定。',
    '擲了一顆 d20。',
    '先打 2d6 的傷害。',
    '命中率只有六成。',
    '他造成 40 傷害。',
    '被打了 3 點傷害。',
    '你失去 12 點生命，倒下了。',
    '感載 +8，你眼前一白。',
    '生命 −12。',
  ]

  for (const text of ALLOWED) {
    it(`放行：${text}`, async () => {
      expect(await stored(text)).toContain(text.slice(0, 8))
    })
  }
  for (const text of BLOCKED) {
    it(`擋下：${text}`, async () => {
      const kept = await stored(`你倒在地上。${text}`)
      expect(kept).not.toContain(text)
    })
  }
})
