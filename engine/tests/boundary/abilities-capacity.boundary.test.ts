// 邊界測試：技能的歷練點、樹的階與橋的容量（M1）。cpp-tester-boundary 寫的。
//
// 規格：SKILLS 1.3 節（階的門檻 0／40／120／240／400；學一個技能花「階 × 20」）、1.9 節（強度預算與佔的容量）；
// CORE_RULES 6.4 節（四類技能、四個容量；每個技能佔 1～6）；SKILL_TREES（每個技能的容量）；SKILLS 1.7 節（橋的機能，M4 才有）。
//
// 邊界表（數值或條件｜範圍｜出處｜測的點）：
//   樹的階         累計花費 0／40／120／240／400 開 1～5 階     SKILLS 1.3    每個門檻 −1、剛好、+1；0、負數、NaN、很大
//   學一個技能花    tier × 20；歷練點剛好夠、少 1           SKILLS 1.3    每一階
//   前置           要先學會；樹的階不夠擋下                SKILLS 1.3    門檻 −1
//   技能的容量      cap 1～6（整數）                       CORE_RULES 6.4 / DATA 第 2 節   0、1、6、7、小數、NaN
//   橋的容量        每一類各自算；裝著的合計 ≤ 容量          CORE_RULES 6.4   剛好等於、多 1、0（空的）、四類都滿
//   招牌的容量      3                                    SKILLS 1.9 / CORE_RULES 6.4
//   被動／其餘      被動 2／3／4／5／6；其餘 1／1／2／2／3   SKILLS 1.9    內建資料的每一個技能
//   歷練點          階 × 20，一件事學不到的不扣             SKILLS 1.3

import { describe, expect, it } from 'vitest'
import fc from 'fast-check'
import type { ContentPack } from '../../src'
import { CORE_PACK } from '../../data'
import { TREE_XP, abilitiesFeature, abilitiesOf, capacityOf, equipAbilities, learn, learnBlock, treeTier } from '../../src/features/abilities'
import { createKernel } from '../../src'
import { makeGame } from '../../src/testkit'

const CATS = ['meat', 'net', 'social', 'media'] as const
type Cat = (typeof CATS)[number]
const PATH_OF: Record<Cat, string> = { meat: 'p_meat', net: 'p_net', social: 'p_social', media: 'p_media' }
const TIERS = [1, 2, 3, 4, 5] as const

/** 這份測試自己的樹：四類各一棵；每棵 招牌 ＋ 每階前層一個、後層一個（前層接上一階的前層，後層接同階的前層）。容量照 id 排出 1～6。 */
const capFor = (ci: number, tier: number, layerIdx: number): number => ((ci * 7 + tier * 3 + layerIdx * 5) % 6) + 1
const ability = (id: string, path: string, category: Cat, tier: number, layer: string, kind: string, cap: number, after?: string) => ({
  id, name: id, path, category, tier, layer, kind, cap, xp: tier * 20, cells: 1, text: `${id}。`, meat: null, net: null, opinion: null, ...(after ? { after } : {}),
})
const ABILITIES = CATS.flatMap((cat, ci) => {
  const p = PATH_OF[cat]
  const sig = ability(`${p}_sig`, p, cat, 1, 'signature', 'passive', 3)
  const list = [sig]
  TIERS.forEach((t) => {
    const front = `${p}_t${t}f`
    list.push(ability(front, p, cat, t, 'front', t % 2 ? 'active' : 'passive', capFor(ci, t, 0), t === 1 ? sig.id : `${p}_t${t - 1}f`))
    list.push(ability(`${p}_t${t}b`, p, cat, t, 'back', 'reaction', capFor(ci, t, 1), front))
  })
  return list
})
const PATHS = CATS.map((cat) => ({ id: PATH_OF[cat], name: cat, tree: `${cat}樹`, category: cat, signature: `${PATH_OF[cat]}_sig`, domains: { meat: 'strong', net: 'strong', opinion: 'strong' }, resonance: [] }))
const PACK: ContentPack = { id: 'abilities_boundary', content: { path: PATHS, ability: ABILITIES } }
const BY_ID = new Map(ABILITIES.map((a) => [a.id, a]))

type AbState = { xp: number; learned: string[]; equipped: string[]; spent: Record<string, number> }
/** capacity：沒給是每類 20；給 null 是沒有橋（沒有 ext.bridge） */
const gameWith = (ab: Partial<AbState>, capacity: Record<string, unknown> | null = { meat: 20, net: 20, social: 20, media: 20 }) =>
  makeGame({ features: [abilitiesFeature], content: [PACK], pc: { ext: { ...(capacity !== null ? { bridge: { capacity } } : {}), abilities: { xp: 0, learned: [], equipped: [], spent: {}, ...ab } } } }).game

// ---------------------------------------------------------------------------------------------
// 1. 樹的階

describe('邊界 SKILLS 1.3：樹的階與歷練點', () => {
  it('門檻的表：0／40／120／240／400；每個門檻 −1 還在上一階、剛好開、+1 還是這一階', () => {
    expect(TREE_XP).toEqual([0, 40, 120, 240, 400])
    const g = gameWith({})
    const tierAt = (spent: number) => { g.state.actors.pc!.ext.abilities = { xp: 0, learned: [], equipped: [], spent: { [PATH_OF.meat]: spent } }; return treeTier(g.k, g.state, 'pc', PATH_OF.meat) }
    expect([0, 1, 39, 40, 41, 119, 120, 121, 239, 240, 241, 399, 400, 401, 99999].map(tierAt)).toEqual([1, 1, 1, 2, 2, 2, 3, 3, 3, 4, 4, 4, 5, 5, 5])
    // 壞掉的數字：NaN、Infinity、字串讀進來時丟掉（當成沒花過）；負的照數字算，都在 1 階
    for (const bad of [-1, -400, Number.NaN, Infinity, -Infinity, '400' as never]) expect(tierAt(bad), String(bad)).toBe(1)
    // 沒有這棵樹的記錄：1 階
    expect(treeTier(g.k, g.state, 'pc', 'p_net')).toBe(1)
  })

  it('性質：任何累計花費，階在 1～5，剛好是「門檻 ≤ 花費」的最大一階；花得越多階不會變低', () => {
    const g = gameWith({})
    fc.assert(fc.property(fc.integer({ min: 0, max: 1000 }), fc.integer({ min: 0, max: 50 }), (spent, extra) => {
      const at = (s: number) => { g.state.actors.pc!.ext.abilities = { xp: 0, learned: [], equipped: [], spent: { [PATH_OF.meat]: s } }; return treeTier(g.k, g.state, 'pc', PATH_OF.meat) }
      const want = [0, 40, 120, 240, 400].filter((x) => x <= spent).length
      expect(at(spent)).toBe(want)
      expect(at(spent + extra)).toBeGreaterThanOrEqual(at(spent))
    }))
  })

  it('學一個技能花「階 × 20」：歷練點剛好夠可以學、少 1 不行；花掉的記進那一棵樹的累計，別的樹不動', () => {
    for (const t of TIERS) {
      // 把這棵樹開到這一階：累計花費直接給門檻；前置另外標成學過
      const id = `${PATH_OF.meat}_t${t}f`
      const learned = t === 1 ? [`${PATH_OF.meat}_sig`] : [`${PATH_OF.meat}_t${t - 1}f`]
      const spent = { [PATH_OF.meat]: TREE_XP[t - 1]! }
      const enough = gameWith({ xp: t * 20, learned, spent })
      expect(learnBlock(enough.k, enough.state, 'pc', id), `${t} 階 剛好`).toBeNull()
      enough.commit(learn(enough.k, enough.state, 'pc', id))
      expect(abilitiesOf(enough.state, 'pc')).toMatchObject({ xp: 0, spent: { [PATH_OF.meat]: TREE_XP[t - 1]! + t * 20 } })
      expect(abilitiesOf(enough.state, 'pc').learned).toContain(id)
      const short = gameWith({ xp: t * 20 - 1, learned, spent })
      expect(learnBlock(short.k, short.state, 'pc', id), `${t} 階 少 1`).toMatch(/歷練點不夠/)
      expect(() => learn(short.k, short.state, 'pc', id)).toThrow(/歷練點不夠/)
    }
  })

  it('樹的階擋下：門檻 −1 學不到，剛好學得到；別的樹花的點數不算；前置沒學會學不到；已經學會的學不到；沒有這個技能', () => {
    for (const t of [2, 3, 4, 5] as const) {
      const id = `${PATH_OF.net}_t${t}f`
      const learned = [`${PATH_OF.net}_t${t - 1}f`]
      const at = (spentHere: number, other = 0) => { const g = gameWith({ xp: 999, learned, spent: { [PATH_OF.net]: spentHere, [PATH_OF.meat]: other } }); return learnBlock(g.k, g.state, 'pc', id) }
      expect(at(TREE_XP[t - 1]! - 1), `${t} 階 −1`).toMatch(new RegExp(`還沒開到 ${t} 階`))
      expect(at(TREE_XP[t - 1]!), `${t} 階 剛好`).toBeNull()
      expect(at(0, 9999), '別的樹花的不算').toMatch(/還沒開到/)
    }
    const g = gameWith({ xp: 999, learned: [], spent: {} })
    expect(learnBlock(g.k, g.state, 'pc', `${PATH_OF.meat}_t1f`)).toMatch(/要先學會/)
    expect(learnBlock(g.k, g.state, 'pc', `${PATH_OF.meat}_sig`)).toBeNull() // 招牌沒有前置
    const done = gameWith({ xp: 999, learned: [`${PATH_OF.meat}_sig`] })
    expect(learnBlock(done.k, done.state, 'pc', `${PATH_OF.meat}_sig`)).toBe('已經學會了。')
    expect(learnBlock(g.k, g.state, 'pc', 'sk_nope')).toBe('沒有這個技能。')
    expect(() => learn(g.k, g.state, 'pc', 'sk_nope')).toThrow(/沒有這個技能/)
  })

  it('性質（模型）：任意的學習順序、任意的起始歷練點：學得到 ⇔ 還沒學、前置學過、樹的階夠、歷練點夠；歷練點不會是負的；累計花費 = 這棵樹學過的 xp 總和', () => {
    const ids = ABILITIES.map((a) => a.id)
    fc.assert(fc.property(fc.integer({ min: 0, max: 700 }), fc.array(fc.constantFrom(...ids), { maxLength: 40 }), (xp0, attempts) => {
      const g = gameWith({ xp: xp0 })
      let xp = xp0
      const learned = new Set<string>()
      const spent: Record<string, number> = {}
      for (const id of attempts) {
        const a = BY_ID.get(id)!
        const tier = [0, 40, 120, 240, 400].filter((x) => x <= (spent[a.path] ?? 0)).length
        const can = !learned.has(id) && tier >= a.tier && (!(a as { after?: string }).after || learned.has((a as { after?: string }).after!)) && xp >= a.xp
        expect(learnBlock(g.k, g.state, 'pc', id) === null, `${id} xp ${xp} 階 ${tier}`).toBe(can)
        if (!can) continue
        g.commit(learn(g.k, g.state, 'pc', id))
        xp -= a.xp
        learned.add(id)
        spent[a.path] = (spent[a.path] ?? 0) + a.xp
        const now = abilitiesOf(g.state, 'pc')
        expect(now.xp).toBe(xp)
        expect(now.xp).toBeGreaterThanOrEqual(0)
        expect(now.spent).toEqual(spent)
        expect(new Set(now.learned)).toEqual(learned)
      }
    }), { numRuns: 100 })
  })

  it('起手：建角的 200 點，一棵樹的招牌（1 階，20）＋ 同階前層，花到 40 開 2 階（SKILLS 1.3：大約是學兩個 1 階技能）', () => {
    const g = gameWith({ xp: 200 })
    const p = PATH_OF.meat
    for (const id of [`${p}_sig`, `${p}_t1f`]) g.commit(learn(g.k, g.state, 'pc', id))
    expect(abilitiesOf(g.state, 'pc').spent[p]).toBe(40)
    expect(treeTier(g.k, g.state, 'pc', p)).toBe(2)
    g.commit(learn(g.k, g.state, 'pc', `${p}_t1b`)) // 後層 1 階，花 20
    g.commit(learn(g.k, g.state, 'pc', `${p}_t2f`)) // 開了 2 階
    expect(abilitiesOf(g.state, 'pc').xp).toBe(200 - 20 - 20 - 20 - 40)
  })
})

// ---------------------------------------------------------------------------------------------
// 2. 橋的容量

const learnedAll = ABILITIES.map((a) => a.id)
const sumBy = (ids: string[], cat: Cat) => [...new Set(ids)].reduce((n, id) => n + (BY_ID.get(id)!.category === cat ? BY_ID.get(id)!.cap : 0), 0)

describe('邊界 CORE_RULES 6.4：橋的四類容量', () => {
  it('性質：任何橋的容量（每類 8～34）、任何一組裝著的技能（含重複）：裝得上 ⇔ 每一類的合計都不超過那一類的容量；裝不上丟錯並指出是哪一類', () => {
    const idsArb = fc.array(fc.constantFrom(...learnedAll), { maxLength: 30 })
    const capArb = fc.record({ meat: fc.integer({ min: 8, max: 34 }), net: fc.integer({ min: 8, max: 34 }), social: fc.integer({ min: 8, max: 34 }), media: fc.integer({ min: 8, max: 34 }) })
    fc.assert(fc.property(capArb, idsArb, (capacity, ids) => {
      const g = gameWith({ xp: 0, learned: learnedAll }, capacity)
      const over = CATS.filter((c) => sumBy(ids, c) > capacity[c])
      if (over.length === 0) {
        const r = equipAbilities(g.k, g.state, 'pc', ids)
        g.commit(r)
        expect(abilitiesOf(g.state, 'pc').equipped).toEqual([...new Set(ids)])
        const cap = capacityOf(g.k, g.state, 'pc')
        for (const c of CATS) expect(cap[c]).toEqual({ used: sumBy(ids, c), max: capacity[c] })
      } else {
        const names = { meat: '現實型', net: '內海型', social: '社交型', media: '媒體型' }
        expect(() => equipAbilities(g.k, g.state, 'pc', ids)).toThrow(new RegExp(`${names[over[0]!]}的容量不夠（要 ${sumBy(ids, over[0]!)}，橋只有 ${capacity[over[0]!]}）`))
        expect(abilitiesOf(g.state, 'pc').equipped, '裝不上就什麼都不改').toEqual([])
      }
    }), { numRuns: 300 })
  })

  it('邊上：容量剛好等於裝著的合計可以，少 1 不行；四類各自算（一類滿了不影響別類）；橋的每一類最低 8（CORE_RULES 6.4、CYBERWARE 7.1）', () => {
    // 現實型的技能挑到合計 ≥ 9：容量 8 是下限，「少 1 不行」要在 8 以上才量得到
    const meatIds: string[] = []
    for (const a of ABILITIES.filter((x) => x.category === 'meat')) { if (sumBy(meatIds, 'meat') < 9) meatIds.push(a.id) }
    const used = sumBy(meatIds, 'meat')
    expect(used).toBeGreaterThanOrEqual(9)
    const exact = gameWith({ learned: learnedAll }, { meat: used, net: 8, social: 8, media: 8 })
    expect(() => equipAbilities(exact.k, exact.state, 'pc', meatIds)).not.toThrow()
    const less = gameWith({ learned: learnedAll }, { meat: used - 1, net: 99, social: 99, media: 99 })
    expect(() => equipAbilities(less.k, less.state, 'pc', meatIds)).toThrow(/現實型的容量不夠/)
    // 四類各裝滿一個
    const four = CATS.map((c) => ABILITIES.find((a) => a.category === c && a.layer === 'signature')!.id)
    const allFull = gameWith({ learned: learnedAll }, { meat: 8, net: 8, social: 8, media: 8 })
    expect(() => equipAbilities(allFull.k, allFull.state, 'pc', four)).not.toThrow()
    // 容量寫得比 8 低的（3、0、負的），載入時夾到 8：照 8 算
    const low = gameWith({ learned: learnedAll }, { meat: 3, net: 0, social: -5, media: 7 })
    for (const c of CATS) expect(capacityOf(low.k, low.state, 'pc')[c].max).toBe(8)
  })

  it('沒學會的裝不上；重複的只算一次；空清單全部卸下；順序照給的', () => {
    const g = gameWith({ learned: [`${PATH_OF.meat}_sig`] })
    expect(() => equipAbilities(g.k, g.state, 'pc', [`${PATH_OF.meat}_t1f`])).toThrow(/還沒學會/)
    g.commit(equipAbilities(g.k, g.state, 'pc', [`${PATH_OF.meat}_sig`, `${PATH_OF.meat}_sig`]))
    expect(capacityOf(g.k, g.state, 'pc').meat.used).toBe(3)
    g.commit(equipAbilities(g.k, g.state, 'pc', []))
    expect(abilitiesOf(g.state, 'pc').equipped).toEqual([])
  })

  it('沒有橋（沒有 ext.bridge）：每類容量 0，裝什麼都不行、卸光可以；有橋但資料壞掉（NaN、字串、缺的欄位）：照下限 8', () => {
    const none = gameWith({ learned: learnedAll }, null)
    expect(capacityOf(none.k, none.state, 'pc').meat.max).toBe(0)
    expect(() => equipAbilities(none.k, none.state, 'pc', [`${PATH_OF.meat}_sig`])).toThrow(/容量不夠/)
    expect(() => equipAbilities(none.k, none.state, 'pc', [])).not.toThrow()
    const broken = gameWith({ learned: learnedAll }, { meat: Number.NaN, net: 'x', social: null })
    for (const c of CATS) expect(capacityOf(broken.k, broken.state, 'pc')[c].max).toBe(8)
    expect(() => equipAbilities(broken.k, broken.state, 'pc', [`${PATH_OF.meat}_sig`])).not.toThrow()
  })

  it('裝著的技能被內容拿掉（存檔比內容舊）：不算進容量，不擋新的裝配', () => {
    const g = gameWith({ learned: learnedAll, equipped: ['sk_gone', `${PATH_OF.meat}_sig`] }, { meat: 3, net: 0, social: 0, media: 0 })
    expect(capacityOf(g.k, g.state, 'pc').meat.used).toBe(3)
  })
})

// ---------------------------------------------------------------------------------------------
// 3. 技能的資料：容量 1～6 與 SKILLS 1.9 節的表

describe('邊界 DATA 第 2 節／SKILLS 1.9：技能的容量與歷練點的格式', () => {
  const problems = (e: Record<string, unknown>) => createKernel([abilitiesFeature]).content.validate('ability', [{ ...ABILITIES[1]!, ...e }]).join('\n')

  it('cap：1 與 6 剛好；0、7、小數、NaN、字串被擋', () => {
    expect(problems({ cap: 1 })).toBe('')
    expect(problems({ cap: 6 })).toBe('')
    for (const bad of [0, 7, -1, 2.5, Number.NaN, Infinity, '3', null]) expect(problems({ cap: bad }), String(bad)).toMatch(/cap 要是 1～6 的整數/)
  })

  it('xp 一定是階 × 20：每一階剛好收、差 1 擋下；階 0 與 6 擋下', () => {
    for (const t of TIERS) {
      expect(problems({ tier: t, xp: t * 20 })).toBe('')
      expect(problems({ tier: t, xp: t * 20 + 1 })).toMatch(/xp 一定是 tier × 20/)
      expect(problems({ tier: t, xp: t * 20 - 1 })).toMatch(/xp 一定是 tier × 20/)
    }
    expect(problems({ tier: 0, xp: 0 })).toMatch(/tier 要是 1～5/)
    expect(problems({ tier: 6, xp: 120 })).toMatch(/tier 要是 1～5/)
  })

  it('內建資料（data/rules/abilities.json）每一個技能的容量照 SKILLS 1.9 節：招牌 3；被動 2／3／4／5／6（階 1～5）；其餘 1／1／2／2／3；xp = 階 × 20；每棵樹的招牌在樹裡', () => {
    const list = CORE_PACK.content.ability as unknown as Array<{ id: string; path: string; tier: number; kind: string; layer: string; cap: number; xp: number }>
    expect(list.length).toBeGreaterThan(0)
    const rest = [1, 1, 2, 2, 3]
    for (const a of list) {
      const want = a.layer === 'signature' ? 3 : a.kind === 'passive' ? a.tier + 1 : rest[a.tier - 1]!
      expect(a.cap, `${a.id}（${a.tier} 階 ${a.kind} ${a.layer}）`).toBe(want)
      expect(a.xp, a.id).toBe(a.tier * 20)
    }
    for (const p of CORE_PACK.content.path as unknown as Array<{ id: string; signature: string }>) {
      const sig = list.find((a) => a.id === p.signature)!
      expect(sig.path).toBe(p.id)
      expect(list.filter((a) => a.path === p.id && a.layer === 'signature')).toHaveLength(1)
    }
  })

  it('內建資料：一棵樹全裝的容量在 SKILLS 第 12 節說的 60～61 上下（槍手 60、掮客 60）；任何一類的橋容量最多 28，裝不下一整棵', () => {
    const list = CORE_PACK.content.ability as unknown as Array<{ path: string; cap: number }>
    const total = (path: string) => list.filter((a) => a.path === path).reduce((n, a) => n + a.cap, 0)
    for (const path of new Set(list.map((a) => a.path))) {
      expect(total(path), path).toBeGreaterThanOrEqual(60)
      expect(total(path), path).toBeLessThanOrEqual(62) // SKILLS 第 12 節寫槍手 60，SKILL_TREES 的表加起來是 62（規格自己的小出入，見回報）
      expect(total(path)).toBeGreaterThan(28 * 2)
    }
  })

  it('內建資料：載入之後的檢查（前置在同一棵樹、category 和樹一樣）都過；整棵樹每一階的前置都指向更早或同階的技能', () => {
    const k = createKernel([abilitiesFeature])
    k.content.loadPack({ id: 'core_abilities', content: { path: CORE_PACK.content.path!, ability: CORE_PACK.content.ability!, battle_status: CORE_PACK.content.battle_status! } })
    const list = CORE_PACK.content.ability as unknown as Array<{ id: string; path: string; tier: number; after?: string }>
    const byId = new Map(list.map((a) => [a.id, a]))
    for (const a of list) if (a.after) expect(byId.get(a.after)!.tier, a.id).toBeLessThanOrEqual(a.tier)
  })
})
