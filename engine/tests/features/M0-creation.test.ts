// 驗收測試：dev/work/M0-creation.md（交給 cpp-feature）。
// 工單完成前這個檔會失敗（engine/src/features/creation 還不存在）。跑法：在 engine/ 跑 npx vitest run --config vitest.pending.config.ts M0-creation
// 完成後：git mv engine/tests/pending/M0-creation.test.ts engine/tests/features/M0-creation.test.ts，主套件要全過。

import { describe, expect, it } from 'vitest'
import type { ContentPack, Game } from '../../src'
import { clone } from '../../src'
import type { CreationDraft } from '../../src/features/creation'
import { ageBlock, attrBlock, attrBudget, attrTotals, buildCreationReport, creationBlocks, creationFeature, perkBlock, perkFilterBlock, perkSummary, skillBlock, skillLeft } from '../../src/features/creation'
import { commitViolations, makeGame } from '../../src/testkit'
import { MINI_PACK } from '../helpers/miniContent'

/** 還沒建角的一局，裝了建角功能與一小包內容。 */
function setup(rules: Record<string, unknown> = {}): Game {
  const { game } = makeGame({ scenario: 'beforeCreation', features: [creationFeature], content: [MINI_PACK], patch: { rules: rules as never } })
  return game
}

/** CHARACTER 5.1 節的例子：技術 8 壓到 4，多 4 點，連同原本的 2 點把反應 15 加到 18、意志 10 加到 13。 */
const draft = (over: Partial<CreationDraft> = {}): CreationDraft => ({
  name: '露', gender: 'female', age: 22,
  origin: 'hive', originChoice: { favor: 'lonestar' },
  attrPick: { reflex: 15, charm: 14, intellect: 13, body: 12, resolve: 10, tech: 8 },
  attrBonus: { tech: -4, reflex: 3, resolve: 3 },
  skills: { streetwise: 3, negotiate: 3, perform: 2, stealth: 2 },
  perks: ['smooth_talker', 'tough', 'loose_lips'],
  ...over,
})

describe('M0-creation：每一步的檢查（CHARACTER 第 1、5 節；UI 第 14 節）', () => {
  it('功能的 id 是 creation', () => {
    expect(creationFeature.id).toBe('creation')
  })

  it('年齡是硬界線：只收整數，低於 18 擋下', () => {
    expect(ageBlock(18)).toBeNull()
    expect(ageBlock('25')).toBeNull()
    expect(ageBlock(17)).toMatch(/18/)
    expect(ageBlock('17')).toMatch(/成年人/)
    expect(ageBlock('abc')).toMatch(/整數/)
    expect(ageBlock('18.5')).toMatch(/整數/)
    expect(ageBlock('')).not.toBeNull()
    expect(ageBlock(201)).not.toBeNull()
  })

  it('屬性：15、14、13、12、10、8 分到六項，加 2 點自由點數；壓下去一點換一點', () => {
    const game = setup()
    const k = game.k
    expect(attrBudget(k, {})).toEqual({ total: 2, lowered: 0, spent: 0, left: 2 })
    expect(attrBudget(k, { tech: -4, reflex: 3, resolve: 3 })).toEqual({ total: 6, lowered: 4, spent: 6, left: 0 })
    const d = draft()
    expect(attrTotals(d.attrPick, d.attrBonus)).toEqual({ reflex: 18, charm: 14, intellect: 13, body: 12, resolve: 13, tech: 4 })
    expect(attrBlock(k, d.attrPick, d.attrBonus)).toBeNull()
    expect(attrBlock(k, { reflex: 15, charm: 14 }, {})).toMatch(/4 項屬性沒有分配/)
    expect(attrBlock(k, { ...d.attrPick, tech: 15 }, d.attrBonus)).toMatch(/每個數字只能用一次/)
    expect(attrBlock(k, d.attrPick, {})).toMatch(/2 點自由點數沒有用/)
    expect(attrBlock(k, d.attrPick, { reflex: 3 })).toMatch(/自由點數只有 2 點/)
    expect(attrBlock(k, d.attrPick, { tech: -2, reflex: 4 })).toMatch(/18/)
    expect(attrBlock(k, d.attrPick, { tech: -5, reflex: 3, resolve: 3, charm: 1 })).toMatch(/4/)
    // 自由點數要剛好用完
    expect(attrBlock(k, d.attrPick, { tech: -4, reflex: 3, resolve: 2 })).toMatch(/1 點自由點數沒有用/)
  })

  it('基本功：10 點，單項最高 3 級（存檔規則可以調）；不存在的基本功擋下', () => {
    const game = setup()
    const { k, state } = game
    expect(skillLeft(k, state, { streetwise: 3, negotiate: 2 })).toBe(5)
    expect(skillBlock(k, state, { streetwise: 3, negotiate: 3, perform: 2, stealth: 2 })).toBeNull()
    expect(skillBlock(k, state, {})).toBeNull()
    expect(skillBlock(k, state, { streetwise: 4 })).toMatch(/3/)
    expect(skillBlock(k, state, { streetwise: 3, negotiate: 3, perform: 3, stealth: 2 })).not.toBeNull()
    expect(skillBlock(k, state, { juggling: 1 })).not.toBeNull()
    expect(skillBlock(k, state, { streetwise: -1 })).not.toBeNull()
    expect(skillBlock(k, state, { streetwise: 1.5 })).not.toBeNull()
    const loose = setup({ startSkillPoints: 12, startSkillMax: 4 })
    expect(skillLeft(loose.k, loose.state, {})).toBe(12)
    expect(skillBlock(loose.k, loose.state, { streetwise: 4, negotiate: 4, perform: 4 })).toBeNull()
  })

  it('特質：4 點（存檔規則可以調）；缺陷退點數，最多 2 個；特質最多 8 個；出身特質不能買', () => {
    const game = setup()
    const { k, state } = game
    expect(perkSummary(k, state, [])).toEqual({ left: 4, perks: 0, flaws: 0 })
    expect(perkSummary(k, state, ['smooth_talker', 'tough', 'loose_lips'])).toEqual({ left: 2, perks: 2, flaws: 1 })
    expect(perkBlock(k, state, ['smooth_talker', 'tough'])).toBeNull()
    expect(perkBlock(k, state, ['smooth_talker', 'tough', 'black_market'])).toMatch(/點/)
    expect(perkBlock(k, state, ['smooth_talker', 'tough', 'black_market', 'afraid_of_pain'])).toBeNull()
    expect(perkBlock(k, state, ['loose_lips', 'old_wound', 'afraid_of_pain'])).toMatch(/缺陷最多 2 個/)
    expect(perkBlock(k, state, ['no_such_perk'])).not.toBeNull()
    expect(perkBlock(k, state, ['origin_hive'])).not.toBeNull()
    expect(perkBlock(k, state, ['tough', 'tough'])).not.toBeNull()
    const rich = setup({ startPerkPoints: 6 })
    expect(perkSummary(rich.k, rich.state, ['corp_reader'])).toEqual({ left: 3, perks: 1, flaws: 0 })
  })

  it('特質帶內容標籤（M4-fix-2；使用者 2026-11-26：保留、disable）：標籤被篩選關掉的特質照樣在目錄裡，perkFilterBlock 回原因、perkBlock 與整份檢查擋下，選不了', () => {
    const pack = { id: 'tagged_perks', content: { perk: [
      { id: 'night_regular', name: '暗室熟客', category: 'social', cost: 1, flaw: false, desc: '熟門熟路。', tags: ['ntr'] },
      { id: 'two_tags', name: '兩個標籤', category: 'social', cost: 1, flaw: false, desc: '兩個標籤。', tags: ['ntr', 'blacktape'] },
      { id: 'plain_perk', name: '一般的特質', category: 'social', cost: 1, flaw: false, desc: '沒有標籤。' },
    ] } } as unknown as ContentPack
    const open = makeGame({ scenario: 'beforeCreation', features: [creationFeature], content: [MINI_PACK, pack] }).game
    const closed = makeGame({ scenario: 'beforeCreation', features: [creationFeature], content: [MINI_PACK, pack], patch: { rules: { contentOff: ['ntr'] } as never } }).game
    // 篩選開著：沒有原因、選得了
    expect(perkFilterBlock(open.k, open.state, 'night_regular')).toBeNull()
    expect(perkBlock(open.k, open.state, ['night_regular'])).toBeNull()
    // 篩選關掉：特質照樣在內容裡（畫面照樣列、灰掉寫這句）；原因是完整的一句，寫出特質的名字與題材的名字
    expect(closed.k.content.has('perk', 'night_regular')).toBe(true)
    const why = perkFilterBlock(closed.k, closed.state, 'night_regular')!
    expect(why).toBe('「暗室熟客」屬於「NTR」，被你的內容篩選關掉了，選不了。')
    expect(perkBlock(closed.k, closed.state, ['night_regular'])).toBe(why)
    expect(perkBlock(closed.k, closed.state, ['tough', 'night_regular'])).toBe(why)
    // 兩個標籤只關一個也算；沒有標籤的、查不到的特質沒有這個原因
    expect(perkFilterBlock(closed.k, closed.state, 'two_tags')).toContain('「NTR」')
    expect(perkFilterBlock(closed.k, closed.state, 'plain_perk')).toBeNull()
    expect(perkFilterBlock(closed.k, closed.state, 'tough')).toBeNull()
    expect(perkFilterBlock(closed.k, closed.state, 'no_such_perk')).toBeNull()
    expect(perkBlock(closed.k, closed.state, ['plain_perk'])).toBeNull()
    // 整份檢查：草稿帶著被關掉的特質，第 7 步（perks）擋下
    expect(creationBlocks(closed.k, closed.state, draft({ perks: ['smooth_talker', 'night_regular'] })).filter((b) => b.step === 'perks').map((b) => b.reason)).toEqual([why])
    expect(creationBlocks(open.k, open.state, draft({ perks: ['smooth_talker', 'night_regular'] }))).toEqual([])
    // 標籤的格式：要是字串的陣列
    expect(() => makeGame({ scenario: 'beforeCreation', features: [creationFeature], content: [MINI_PACK, { id: 'bad_tags', content: { perk: [{ id: 'bad', name: '壞的', category: 'social', cost: 1, flaw: false, desc: '壞的。', tags: 'ntr' }] } } as unknown as ContentPack] })).toThrow(/tags 要是內容篩選標籤的陣列/)
  })

  it('整份檢查：沒有問題是空的；有問題列出是哪一步、為什麼', () => {
    const game = setup()
    const { k, state } = game
    expect(creationBlocks(k, state, draft())).toEqual([])
    const steps = (d: CreationDraft) => creationBlocks(k, state, d).map((b) => b.step)
    expect(steps(draft({ name: '   ' }))).toEqual(['basics'])
    expect(steps(draft({ age: 17 }))).toEqual(['basics'])
    expect(steps(draft({ origin: 'atlantis' }))).toEqual(['origin'])
    // 好感給誰有兩個以上可以選：要選一個，而且要是清單裡的
    expect(steps(draft({ originChoice: {} }))).toEqual(['origin'])
    expect(steps(draft({ originChoice: { favor: 'hizakura' } }))).toEqual(['origin'])
    // 只有一個可以選的出身不用選
    expect(steps(draft({ origin: 'oldport', originChoice: undefined }))).toEqual([])
    expect(steps(draft({ attrBonus: {} }))).toEqual(['attrs'])
    expect(steps(draft({ skills: { streetwise: 9 } }))).toEqual(['skills'])
    expect(steps(draft({ perks: ['origin_hive'] }))).toEqual(['perks'])
    expect(steps(draft({ age: 17, attrBonus: {}, perks: ['no_such_perk'] }))).toEqual(['basics', 'attrs', 'perks'])
    for (const b of creationBlocks(k, state, draft({ age: 17, attrBonus: {} }))) expect(b.reason.length).toBeGreaterThan(3)
  })
})

describe('M0-creation：確認建角（CHARACTER 第 1、2、5.4 節）', () => {
  it('提交一份報告：主角進到狀態裡，屬性、基本功、特質、出身、起始的錢都對', () => {
    const game = setup()
    game.k.probe.start()
    const report = game.commit(buildCreationReport(game.k, game.state, draft()))[0]!
    expect(commitViolations(game.k, game.k.probe.stop())).toEqual([])
    expect(report.kind).toBe('system')
    expect(report.action).toBe('creation.commit')
    const s = game.state
    expect(s.pc).not.toBeNull()
    const pc = s.actors[s.pc!]!
    expect(s.party).toEqual([pc.id])
    expect(pc).toMatchObject({ name: '露', role: 'pc', age: 22, gender: 'female' })
    expect(pc.attrs).toEqual({ reflex: 18, charm: 14, intellect: 13, body: 12, resolve: 13, tech: 4 })
    // 出身給一項基本功 +1，可以超過建角的單項上限（3 → 4）
    expect(pc.skills).toMatchObject({ streetwise: 4, negotiate: 3, perform: 2, stealth: 2 })
    // 出身特質白送，排在最前面
    expect(pc.perks).toEqual(['origin_hive', 'smooth_talker', 'tough', 'loose_lips'])
    expect(pc.ext.origin).toMatchObject({ id: 'hive', favor: 'lonestar' })
    // 起始的錢 1,500：放在哪一個錢包規格沒有寫，所以只驗總數
    expect(s.money.cred + s.money.cash).toBe(1500)
    expect([pc.load, pc.afterglow, pc.sink]).toEqual([0, 0, 0])
  })

  it('生命值從上限開始（有功能註冊了 max_hp 的話）', () => {
    const game = setup()
    game.k.stats.defineStat({ id: 'max_hp', owner: 'test', name: '生命值上限', base: (st, a, stats) => 20 + stats.effectiveAttr(st, a, 'body') * 2 })
    game.commit(buildCreationReport(game.k, game.state, draft()))
    expect(game.state.actors[game.state.pc!]!.hp).toBe(44)
  })

  it('起始的錢跟著存檔規則走；只有一個可以選的出身自動給那個勢力', () => {
    const game = setup({ startMoney: 3000 })
    game.commit(buildCreationReport(game.k, game.state, draft({ origin: 'oldport', originChoice: undefined, skills: { stealth: 3 }, perks: [] })))
    const s = game.state
    expect(s.money.cred + s.money.cash).toBe(3000)
    const pc = s.actors[s.pc!]!
    expect(pc.skills.stealth).toBe(4)
    expect(pc.perks).toEqual(['origin_oldport'])
    expect(pc.ext.origin).toMatchObject({ id: 'oldport', favor: 'rouge' })
  })

  it('有問題的草稿不能提交：丟錯，訊息是第一個問題的原因；狀態不變', () => {
    const game = setup()
    const before = clone(game.state)
    expect(() => buildCreationReport(game.k, game.state, draft({ age: 17 }))).toThrow(/18/)
    expect(() => buildCreationReport(game.k, game.state, draft({ attrBonus: {} }))).toThrow(/自由點數/)
    expect(game.state).toEqual(before)
  })

  it('已經有主角了就不能再建一次', () => {
    const game = setup()
    game.commit(buildCreationReport(game.k, game.state, draft()))
    expect(creationBlocks(game.k, game.state, draft()).map((b) => b.step)).toContain('basics')
    expect(() => buildCreationReport(game.k, game.state, draft())).toThrow()
  })

  it('建角可以回退：回到還沒有主角的時候', () => {
    const game = setup()
    game.commit(buildCreationReport(game.k, game.state, draft()))
    expect(game.undoSteps()).toBe(true)
    expect(game.state.pc).toBeNull()
    expect(game.state.actors).toEqual({})
    expect(game.state.money).toEqual({ cred: 0, cash: 0 })
  })

  it('外觀與背景的文字原樣存下來（給之後的敘事用）；自己寫的文字不影響規則', () => {
    const game = setup()
    game.commit(buildCreationReport(game.k, game.state, draft({ pronoun: '她', look: { hair: '黑色的短髮', eyes: '灰色' }, lookNote: '左眉有一道疤', background: '在四號塔長大，送過三年的信。' })))
    const pc = game.state.actors[game.state.pc!]!
    expect(pc.ext.profile).toMatchObject({ pronoun: '她', look: { hair: '黑色的短髮', eyes: '灰色' }, lookNote: '左眉有一道疤', background: '在四號塔長大，送過三年的信。' })
  })

  it('建完角之後可以在空房間裡做自由行動', async () => {
    const game = setup()
    game.commit(buildCreationReport(game.k, game.state, draft()))
    const r = await game.act({ kind: 'free', text: '我看看四周', attr: 'intellect', skill: 'streetwise' })
    expect(r.status).toBe('applied')
    const roll = r.reports[0]!.timeline[0]!.roll!
    expect(roll.total).toBe(roll.natural + 1 + 4)
  })
})
