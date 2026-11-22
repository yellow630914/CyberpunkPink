// 建角在 M0 的修正批次（2026-11-22）加的東西（介面回報要搬進引擎的規則與定案）：
// 屬性 ± 按鈕、建角的數字、性別的五個值、私處的外觀（受內容篩選控制）、出身的勢力與名冊改用 id、義體與裝備點數換成現金。
// 規格：CHARACTER 第 1、2、5.1、5.4、5.6 節；DATA 第 1、1.1、8 節；LEWD_SYSTEM 第 9 節。

import { describe, expect, it } from 'vitest'
import fc from 'fast-check'
import type { AttrId, Game } from '../../src'
import { ATTR_IDS, CONTENT_TAG_INTIMATE_BODY, GENDER_IDS, attrMod, clone, createKernel } from '../../src'
import type { CreationDraft } from '../../src/features/creation'
import { attrBlock, attrBudget, attrStepBlock, attrTotals, buildCreationReport, creationBlocks, creationFeature, creationLimits, genderBlock, lookBlock, originView, startMoney } from '../../src/features/creation'
import { makeGame } from '../../src/testkit'
import { MINI_PACK } from '../helpers/miniContent'

function setup(rules: Record<string, unknown> = {}): Game {
  return makeGame({ scenario: 'beforeCreation', features: [creationFeature], content: [MINI_PACK], patch: { rules: rules as never } }).game
}

const draft = (over: Partial<CreationDraft> = {}): CreationDraft => ({
  name: '露', gender: 'female', age: 22,
  origin: 'hive', originChoice: { favor: 'lonestar' },
  attrPick: { reflex: 15, charm: 14, intellect: 13, body: 12, resolve: 10, tech: 8 },
  attrBonus: { tech: -4, reflex: 3, resolve: 3 },
  skills: { streetwise: 3, negotiate: 3, perform: 2, stealth: 2 },
  perks: ['smooth_talker', 'tough'],
  ...over,
})
const PICK = draft().attrPick

describe('建角：屬性的 ± 按鈕（CHARACTER 5.1 節；規則在引擎，畫面只問）', () => {
  it('還沒分配數字不能按；加到單項上限、減到單項下限就擋；自由點數用完不能再加，壓別的可以換', () => {
    const { k } = setup()
    expect(attrStepBlock(k, {}, {}, 'body', 1)).toBe('先選這一項的數字。')
    // 15 的那一項：自由點數只有 2 點，加兩次可以，第三次擋
    expect(attrStepBlock(k, PICK, {}, 'reflex', 1)).toBeNull()
    expect(attrStepBlock(k, PICK, { reflex: 1 }, 'reflex', 1)).toBeNull()
    expect(attrStepBlock(k, PICK, { reflex: 2 }, 'reflex', 1)).toBe('自由點數用完了：先把別的屬性往下壓，一點換一點。')
    // 把技術往下壓一點，就又可以加
    expect(attrStepBlock(k, PICK, { reflex: 2, tech: -1 }, 'reflex', 1)).toBeNull()
    // 單項上限 18：15 加到 18 之後再加就擋（就算點數還夠）
    expect(attrStepBlock(k, PICK, { reflex: 3, tech: -4 }, 'reflex', 1)).toBe('單項最高 18。')
    // 單項下限 4：8 壓到 4 之後再壓就擋，訊息帶調整值
    expect(attrStepBlock(k, PICK, { tech: -3 }, 'tech', -1)).toBeNull()
    expect(attrStepBlock(k, PICK, { tech: -4 }, 'tech', -1)).toBe(`最低 4（調整值 ${attrMod(4)}）。`)
    // 把加上去的收回來一定可以
    expect(attrStepBlock(k, PICK, { reflex: 2 }, 'reflex', -1)).toBeNull()
  })

  it('性質：照 attrStepBlock 說可以的一步一步按，走到哪裡都不會超過上下限、不會透支自由點數；它說不行的那一步，按下去 attrBlock 一定不會過', () => {
    const { k } = setup()
    fc.assert(fc.property(fc.array(fc.tuple(fc.constantFrom<AttrId>(...ATTR_IDS), fc.constantFrom<1 | -1>(1, -1)), { maxLength: 40 }), (clicks) => {
      let bonus: Partial<Record<AttrId, number>> = {}
      for (const [attr, delta] of clicks) {
        const next = { ...bonus, [attr]: (bonus[attr] ?? 0) + delta }
        if (attrStepBlock(k, PICK, bonus, attr, delta) === null) {
          bonus = next
          const totals = attrTotals(PICK, bonus)
          if (ATTR_IDS.some((a) => totals[a] > 18 || totals[a] < 4) || attrBudget(k, bonus).left < 0) return false
        } else if (attrBlock(k, PICK, next) === null) return false
      }
      return true
    }))
  })

  it('數字跟著資料走：creation_rule 改了上下限與自由點數，按鈕跟著改', () => {
    const k = createKernel([creationFeature])
    k.content.load('creation_rule', [{ ...(MINI_PACK.content.creation_rule![0] as object), id: 'default', attr_max: 16, attr_min: 6, attr_free: 0 }])
    expect(attrStepBlock(k, PICK, {}, 'reflex', 1)).toMatch(/自由點數用完了/)
    expect(attrStepBlock(k, PICK, { tech: -1 }, 'reflex', 1)).toBeNull()
    expect(attrStepBlock(k, PICK, { tech: -2, reflex: 1 }, 'reflex', 1)).toBe('單項最高 16。')
    expect(attrStepBlock(k, PICK, { tech: -2 }, 'tech', -1)).toBe(`最低 6（調整值 ${attrMod(6)}）。`)
  })
})

describe('建角：給畫面的數字與出身的摘要', () => {
  it('creationLimits：來源是資料與這一局的存檔規則（畫面不自己留預設值）；資料沒載入時和檢查用同一組預設值', () => {
    const game = setup({ startPerkPoints: 6, startMoney: 900 })
    expect(creationLimits(game.k, game.state)).toEqual({
      attrArray: [15, 14, 13, 12, 10, 8], attrFree: 2, attrMax: 18, attrMin: 4, skillPoints: 10, skillMax: 3, perkPoints: 6, perkMax: 8, flawMax: 2,
      startMoney: 900, cyberPoints: 10, gearPoints: 12, cyberPointCash: 500, gearPointCash: 150,
    })
    const bare = makeGame({ scenario: 'beforeCreation', features: [creationFeature] }).game
    expect(creationLimits(bare.k, bare.state)).toMatchObject({ attrArray: [15, 14, 13, 12, 10, 8], attrFree: 2, attrMax: 18, attrMin: 4, perkMax: 8, flawMax: 2, gearPoints: 12 })
    // 回傳的陣列是複製的：改它不會動到資料
    creationLimits(game.k, game.state).attrArray.push(99)
    expect(creationLimits(game.k, game.state).attrArray).toHaveLength(6)
  })

  it('originView：好感可以給哪幾個勢力（id 與短名）、開場就在名冊上的人（id 與名字）；沒有這個出身是 null', () => {
    const { k } = setup()
    expect(originView(k, 'hive')).toEqual({
      favor: [{ id: 'lonestar', name: '孤星連' }, { id: 'nora', name: '野良' }], favorValue: 25,
      roster: [{ id: 'npc_xiaomai', name: '小麥' }, { id: 'npc_ray', name: '雷' }],
    })
    expect(originView(k, 'oldport')!.favor).toEqual([{ id: 'rouge', name: '胭脂堂' }])
    expect(originView(k, 'no_such_origin')).toBeNull()
  })

  it('出身的勢力用 id 選（DATA 1.1 節）：中文名不收；擋住的句子寫短名；選的 id 存進角色', () => {
    const game = setup()
    expect(creationBlocks(game.k, game.state, draft({ originChoice: { favor: '孤星連' } }))).toEqual([{ step: 'origin', reason: '要選一個勢力：孤星連、野良。' }])
    expect(creationBlocks(game.k, game.state, draft({ originChoice: { favor: 'rouge' } }))[0]!.step).toBe('origin')
    game.commit(buildCreationReport(game.k, game.state, draft({ originChoice: { favor: 'nora' } })))
    expect(game.state.actors.pc!.ext.origin).toEqual({ id: 'hive', favor: 'nora', favorValue: 25, status: 'citizen', home: '蜂巢四號塔的單位', roster: ['npc_xiaomai', 'npc_ray'] })
  })

  it('內容的格式：出身的勢力與名冊只收 id，而且要找得到（引用檢查）', () => {
    const k = createKernel()
    const hive = MINI_PACK.content.origin![0] as Record<string, unknown>
    expect(k.content.validate('origin', [{ ...hive, favor: { choose_one: ['孤星連'], value: 25 } }])[0]).toMatch(/勢力 id/)
    expect(k.content.validate('origin', [{ ...hive, roster: ['小麥'] }])[0]).toMatch(/npc_ 開頭/)
    expect(k.content.validate('origin', [{ ...hive, roster: ['xiaomai'] }])[0]).toMatch(/npc_ 開頭/)
    expect(k.content.validate('faction', [{ id: 'lonestar', name: '孤星連', short: '孤星連', class: 'gang' }])[0]).toMatch(/class/)
    expect(k.content.validate('npc', [{ id: 'xiaomai', name: '小麥' }])[0]).toMatch(/npc_/)
    k.content.loadPack({ id: 'p', content: { ...MINI_PACK.content, faction: [], npc: [] } })
    expect(k.content.checkRefs().sort()).toEqual([
      'origin/hive：引用了不存在的 faction/lonestar', 'origin/hive：引用了不存在的 faction/nora', 'origin/hive：引用了不存在的 npc/npc_ray', 'origin/hive：引用了不存在的 npc/npc_xiaomai',
      'origin/oldport：引用了不存在的 faction/rouge', 'origin/oldport：引用了不存在的 npc/npc_nana', 'origin/oldport：引用了不存在的 npc/npc_ray',
    ])
  })
})

describe('建角：性別的五個值與私處的外觀（DATA 第 1、8 節；LEWD_SYSTEM 第 9 節）', () => {
  it('性別只收五個值（TS 只有男跨女一種 trans_f；trans_m 已經拿掉）；空的要選，其他的擋下', () => {
    expect([...GENDER_IDS]).toEqual(['female', 'male', 'femboy', 'trans_f', 'futa'])
    expect(genderBlock('trans_m')).toBe('沒有這個性別。')
    for (const g of GENDER_IDS) expect(genderBlock(g)).toBeNull()
    expect(genderBlock('')).toBe('要選性別。')
    for (const bad of ['TS', 'trans', 'Female', '女']) expect(genderBlock(bad)).toBe('沒有這個性別。')
    const game = setup()
    expect(creationBlocks(game.k, game.state, draft({ gender: 'TS' }))).toEqual([{ step: 'basics', reason: '沒有這個性別。' }])
    for (const gender of ['trans_f', 'futa']) {
      const g = setup()
      g.commit(buildCreationReport(g.k, g.state, draft({ gender })))
      expect(g.state.actors.pc!.gender).toBe(gender)
    }
  })

  it('look.private（私處）：{ options, text }；內容篩選開著（預設）時存進角色；格式不對擋在第 1 步', () => {
    const look = { hair: '黑色短髮', eyes: '琥珀色', private: { options: ['shaved'], text: '左邊大腿內側有一顆小痣。' } }
    const game = setup()
    expect(creationBlocks(game.k, game.state, draft({ look }))).toEqual([])
    game.commit(buildCreationReport(game.k, game.state, draft({ look })))
    expect((game.state.actors.pc!.ext.profile as { look: unknown }).look).toEqual(look)
    expect(lookBlock(look)).toBeNull()
    expect(lookBlock(undefined)).toBeNull()
    expect(lookBlock({ hair: '黑色短髮', private: { options: [], text: '' } })).toBeNull()
    for (const bad of [{ private: '剃得很乾淨' }, { private: { options: 'shaved', text: '' } }, { private: { options: [1], text: '' } }, { private: { options: [] } }]) {
      expect(lookBlock(bad as never)).toBe('私處的外觀要有選的詞條與補充的一段字。')
      expect(creationBlocks(setup().k, setup().state, draft({ look: bad as never }))[0]).toEqual({ step: 'basics', reason: '私處的外觀要有選的詞條與補充的一段字。' })
    }
    expect(lookBlock({ hair: 3 } as never)).toBe('外觀的每一項都要是一段字。')
  })

  it('內容篩選關掉「身體的私密描寫」：不寫私處（草稿裡有也不存），其他的外觀照存；不算錯誤', () => {
    const look = { hair: '黑色短髮', private: { options: ['shaved'], text: '左邊大腿內側有一顆小痣。' } }
    const game = setup({ contentOff: [CONTENT_TAG_INTIMATE_BODY] })
    expect(game.state.rules.contentOff).toEqual(['intimate_body'])
    expect(creationBlocks(game.k, game.state, draft({ look }))).toEqual([])
    const before = clone(look)
    game.commit(buildCreationReport(game.k, game.state, draft({ look })))
    expect((game.state.actors.pc!.ext.profile as { look: unknown }).look).toEqual({ hair: '黑色短髮' })
    expect(JSON.stringify(game.state)).not.toContain('小痣')
    expect(look).toEqual(before)
    // 存檔再讀檔之後篩選還在（跟著存檔走）
    expect(game.load(game.save())).toBeNull()
    expect(game.state.rules.contentOff).toEqual(['intimate_body'])
  })
})

describe('建角：起始的錢（CHARACTER 5.4 節：全部是現金；沒花完的義體點數每點 C$500、裝備點數每點 C$150）', () => {
  it('下限、上限、上限+1：花完不換、沒花的全換、花超過擋在那一步；草稿沒寫花了幾點的那一項不換', () => {
    const game = setup()
    const money = (over: Partial<CreationDraft>) => startMoney(game.k, game.state, draft(over))
    expect(money({})).toEqual({ base: 1500, cyber: 0, gear: 0, total: 1500 })
    expect(money({ cyberSpent: 10, gearSpent: 12 })).toEqual({ base: 1500, cyber: 0, gear: 0, total: 1500 })
    expect(money({ cyberSpent: 0, gearSpent: 0 })).toEqual({ base: 1500, cyber: 5000, gear: 1800, total: 8300 })
    expect(money({ cyberSpent: 7, gearSpent: 11 })).toEqual({ base: 1500, cyber: 1500, gear: 150, total: 3150 })
    expect(money({ cyberSpent: 9 })).toEqual({ base: 1500, cyber: 500, gear: 0, total: 2000 })
    expect(creationBlocks(game.k, game.state, draft({ cyberSpent: 10, gearSpent: 12 }))).toEqual([])
    expect(creationBlocks(game.k, game.state, draft({ cyberSpent: 11 }))).toEqual([{ step: 'cyber', reason: '義體點數只有 10 點。' }])
    expect(creationBlocks(game.k, game.state, draft({ gearSpent: 13 }))).toEqual([{ step: 'gear', reason: '裝備點數只有 12 點。' }])
    expect(creationBlocks(game.k, game.state, draft({ cyberSpent: -1 }))[0]).toEqual({ step: 'cyber', reason: '花掉的義體點數要是 0 以上的整數。' })
    expect(creationBlocks(game.k, game.state, draft({ gearSpent: 1.5 }))[0]).toEqual({ step: 'gear', reason: '花掉的裝備點數要是 0 以上的整數。' })
    // 步驟照建角的順序排：義體（第 6 步）在特質（第 7 步）之前，裝備（第 9 步）在最後
    expect(creationBlocks(game.k, game.state, draft({ cyberSpent: 99, gearSpent: 99, perks: ['no_such_perk'] })).map((b) => b.step)).toEqual(['cyber', 'perks', 'gear'])
  })

  it('換的錢放現金、每個出身一樣；義體點數跟著存檔規則走；報告只有一筆錢', () => {
    for (const origin of ['hive', 'oldport']) {
      const game = setup({ startCyberPoints: 6, startMoney: 1000 })
      const report = game.commit(buildCreationReport(game.k, game.state, draft({ origin, originChoice: origin === 'hive' ? { favor: 'lonestar' } : undefined, cyberSpent: 4, gearSpent: 10 })))[0]!
      expect(game.state.money).toEqual({ cred: 0, cash: 1000 + 2 * 500 + 2 * 150 })
      expect(report.changes.filter((c) => c.op === 'cash' || c.op === 'cred')).toEqual([{ op: 'cash', delta: 2300 }])
    }
    const game = setup({ startCyberPoints: 6 })
    expect(creationBlocks(game.k, game.state, draft({ cyberSpent: 7 }))).toEqual([{ step: 'cyber', reason: '義體點數只有 6 點。' }])
  })

  it('性質：花 c 點義體、g 點裝備，現金＝起始的錢 + (義體點數 − c) × 500 + (12 − g) × 150', () => {
    fc.assert(fc.property(fc.integer({ min: 0, max: 20 }), fc.integer({ min: 0, max: 5000 }), fc.integer({ min: 0, max: 20 }), fc.integer({ min: 0, max: 12 }), (points, base, c0, g) => {
      const c = Math.min(c0, points)
      const game = setup({ startCyberPoints: points, startMoney: base })
      game.commit(buildCreationReport(game.k, game.state, draft({ cyberSpent: c, gearSpent: g })))
      return game.state.money.cash === base + (points - c) * 500 + (12 - g) * 150 && game.state.money.cred === 0
    }), { numRuns: 30 })
  })
})
