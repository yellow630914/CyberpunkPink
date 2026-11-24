// 白箱測試：L6 功能（建角 creation、角色 character、特質 perks）。
// 補主套件沒有走到的分支與錯誤路徑。每個測試名稱寫明在測哪一條規格（文件與節）或不變式（dev/invariants.md）。

import { describe, expect, it } from 'vitest'
import type { EffectCtx, GameState, Kernel } from '../../src/core'
import { createKernel, readyFeatures } from '../../src/core'
import { characterFeature } from '../../src/features/character'
import { isWounded } from '../../src/features/character/stats'
import type { CreationDraft } from '../../src/features/creation'
import { attrBlock, attrBudget, attrTotals, buildCreationReport, creationBlocks, creationFeature, perkBlock, perkSummary, skillBlock } from '../../src/features/creation'
import { perksFeature } from '../../src/features/perks'
import { makeState } from '../../src/testkit'
import { MINI_PACK } from '../helpers/miniContent'

const kernelWith = (features = [creationFeature, characterFeature, perksFeature], packs = [MINI_PACK]): Kernel => {
  const k = createKernel(features)
  for (const p of packs) k.content.loadPack(p)
  readyFeatures(k)
  return k
}
/** MINI_PACK 拿掉 creation_rule：驗「沒有載入時用預設值」。 */
const NO_RULE_PACK = { id: 'mini-norule', content: Object.fromEntries(Object.entries(MINI_PACK.content).filter(([kind]) => kind !== 'creation_rule')) }
const good: CreationDraft = {
  name: '露', gender: 'female', age: 22, origin: 'hive', originChoice: { favor: 'lonestar' },
  attrPick: { reflex: 15, charm: 14, intellect: 13, body: 12, resolve: 10, tech: 8 }, attrBonus: { reflex: 2 },
  skills: { streetwise: 3, negotiate: 3 }, perks: ['smooth_talker'],
}
const ctxOf = (k: Kernel, state: GameState, o: Partial<EffectCtx> = {}): EffectCtx => ({ state, actor: 'pc', grade: 1, source: 'ai', clampAsked: true, content: k.content, ...o })

describe('白箱 L6 建角（CHARACTER 第 1、2、5 節；UI 第 14 節；dev/invariants.md 第 32 條）', () => {
  it('creation_rule 沒有載入時用預設值（15、14、13、12、10、8＋2 點，4～18，特質 8、缺陷 2）', () => {
    const k = kernelWith([creationFeature], [NO_RULE_PACK])
    const s = makeState({ pc: false })
    expect(attrBudget(k, {}).total).toBe(2)
    expect(attrBlock(k, good.attrPick, { reflex: 4, tech: -2 })).toBe('單項最高 18。')
    expect(creationBlocks(k, s, good)).toEqual([])
  })

  it('attrTotals：沒分配的那一項算 0', () => {
    expect(attrTotals({ body: 12 }, { tech: 2 })).toMatchObject({ body: 12, tech: 2, charm: 0 })
  })

  it('屬性：增減不是整數、點數花超過、單項低於下限，各自的訊息', () => {
    const k = kernelWith()
    expect(attrBlock(k, good.attrPick, { reflex: 1.5 })).toBe('屬性的增減要是整數。')
    expect(attrBlock(k, good.attrPick, { reflex: 3 })).toBe('自由點數只有 2 點。')
    expect(attrBlock(k, good.attrPick, { tech: -5, reflex: 3, charm: 4 })).toBe('單項最低 4。')
    expect(attrBlock(k, { ...good.attrPick, tech: 15 }, good.attrBonus)).toBe('每個數字只能用一次。')
  })

  it('基本功：負數或小數、沒有的基本功、超過建角的單項上限、點數超過（CORE_RULES 2；CHARACTER 5.6）', () => {
    const k = kernelWith()
    const s = makeState({ pc: false })
    expect(skillBlock(k, s, { streetwise: -1 })).toBe('基本功的等級要是 0 以上的整數。')
    expect(skillBlock(k, s, { streetwise: 1.5 })).toBe('基本功的等級要是 0 以上的整數。')
    expect(skillBlock(k, s, { flying: 1 })).toBe('沒有「flying」這項基本功。')
    expect(skillBlock(k, s, { flying: 0 })).toBeNull()
    expect(skillBlock(k, s, { streetwise: 4 })).toBe('建角時單項最高 3 級。')
    expect(skillBlock(k, s, { streetwise: 3, negotiate: 3, perform: 3, mechanics: 2 })).toBe('基本功的點數只有 10 點。')
  })

  it('特質：重複、不存在、出身特質、缺陷超過 2、特質點超過（CHARACTER 5.3）', () => {
    const k = kernelWith()
    const s = makeState({ pc: false })
    expect(perkBlock(k, s, ['tough', 'tough'])).toBe('同一個特質不能選兩次。')
    expect(perkBlock(k, s, ['ghost'])).toBe('沒有「ghost」這個特質。')
    expect(perkBlock(k, s, ['origin_hive'])).toBe('出身特質是出身送的，不能用點數買。')
    expect(perkBlock(k, s, ['loose_lips', 'old_wound', 'afraid_of_pain'])).toBe('缺陷最多 2 個。')
    expect(perkBlock(k, s, ['smooth_talker', 'tough', 'black_market'])).toBe('特質點超過了 1 點。')
    // 沒載入的特質不算進點數（perkSummary 只看找得到的）
    expect(perkSummary(k, s, ['ghost', 'tough'])).toEqual({ left: 2, perks: 1, flaws: 0 })
  })

  it('特質最多 8 個：creation_rule 把上限調低時擋下（CHARACTER 4.4、5.3）', () => {
    const rule = { ...MINI_PACK.content.creation_rule![0]!, perk_max: 1 }
    const k = kernelWith([creationFeature], [{ id: 'm', content: { ...MINI_PACK.content, creation_rule: [rule] } }])
    expect(perkBlock(k, makeState({ pc: false }), ['tough', 'black_market'])).toBe('特質最多 1 個。')
  })

  it('基本資料：已經有主角、沒有名字、沒選性別、年齡，每一步只回報第一個問題', () => {
    const k = kernelWith()
    expect(creationBlocks(k, makeState(), good)).toEqual([{ step: 'basics', reason: '已經有主角了。' }])
    const s = makeState({ pc: false })
    expect(creationBlocks(k, s, { ...good, name: '  ' })[0]!.reason).toBe('要有名字。')
    expect(creationBlocks(k, s, { ...good, gender: '' })[0]!.reason).toBe('要選性別。')
    expect(creationBlocks(k, s, { ...good, age: '17' })[0]!.reason).toMatch(/18 以上/)
    expect(creationBlocks(k, s, { ...good, age: '201' })[0]!.reason).toBe('年齡填不到這麼大。')
  })

  it('出身：沒有這個出身；兩個以上勢力要選、選了不在清單裡也擋；只有一個時自動用那一個（CHARACTER 第 2 節）', () => {
    const k = kernelWith()
    const s = makeState({ pc: false })
    expect(creationBlocks(k, s, { ...good, origin: 'moon' })).toEqual([{ step: 'origin', reason: '沒有這個出身。' }])
    expect(creationBlocks(k, s, { ...good, originChoice: undefined })[0]!.reason).toBe('要選一個勢力：孤星連、野良。')
    expect(creationBlocks(k, s, { ...good, originChoice: { favor: 'rouge' } })[0]!.step).toBe('origin')
    const d = buildCreationReport(k, s, { ...good, origin: 'oldport', originChoice: undefined, skills: { negotiate: 2, streetwise: 0 } })
    const actor = (d.changes[0] as unknown as { actor: { ext: { origin: { favor: string } }; skills: Record<string, number>; perks: string[] } }).actor
    expect(actor.ext.origin.favor).toBe('rouge')
    // 0 級的不放進去；出身送的 +1 加在沒買過的基本功上
    expect(actor.skills).toEqual({ negotiate: 2, stealth: 1 })
    expect(actor.perks).toEqual(['origin_oldport', 'smooth_talker'])
  })

  it('不合格的草稿：buildCreationReport 丟出第一個問題的原因', () => {
    const k = kernelWith()
    expect(() => buildCreationReport(k, makeState({ pc: false }), { ...good, name: '' })).toThrow('要有名字。')
  })

  it('沒有角色功能（max_hp 沒註冊）時生命值是 1；起始的錢是 0 時不給錢；外觀等欄位原樣存（CHARACTER 5.4、5.6）', () => {
    const k = kernelWith([creationFeature])
    const s = makeState({ pc: false, patch: { rules: { ...makeState().rules, startMoney: 0 } } })
    const d = buildCreationReport(k, s, { ...good, name: ' 露 ', age: ' 30 ', pronoun: '她', look: { hair: 'pink' }, lookNote: '刺青', background: '過去' })
    expect(d.changes.map((c) => c.op)).toEqual(['actor.add', 'pc'])
    const actor = (d.changes[0] as unknown as { actor: { hp: number; name: string; age: number; ext: { profile: unknown } } }).actor
    expect(actor).toMatchObject({ hp: 1, name: '露', age: 30 })
    expect(actor.ext.profile).toEqual({ pronoun: '她', look: { hair: 'pink' }, lookNote: '刺青', background: '過去' })
  })

  it('有角色功能時生命值從上限開始（含特質的加減）（CORE_RULES 4.1；CHARACTER 4.1）', () => {
    const k = kernelWith()
    const d = buildCreationReport(k, makeState({ pc: false }), { ...good, perks: ['tough'] })
    // 體格 12：20 + 12×2 = 44，耐打 +5
    expect((d.changes[0] as unknown as { actor: { hp: number } }).actor.hp).toBe(49)
    expect(d.changes.at(-1)).toEqual({ op: 'cash', delta: 1500 })
  })
})

describe('白箱 L6 角色：衍生數值、重傷、效果與條件（CORE_RULES 1、4.1、4.2；EVENTS 2.2、2.4；dev/invariants.md 第 31 條）', () => {
  it('耐受（橋參數）不是數字時當 0；是數字時影響感載上限', () => {
    const k = kernelWith([characterFeature])
    expect(k.stats.stat(makeState({ pc: { ext: { bridge: { tolerance: 'x' } } } }), 'pc', 'load_cap')).toBe(20)
    expect(k.stats.stat(makeState({ pc: { ext: { bridge: { tolerance: 7 } } } }), 'pc', 'load_cap')).toBe(23)
    expect(k.stats.stat(makeState({ pc: { attrs: { intellect: 1 } } }), 'pc', 'ram_max')).toBe(4)
  })

  it('isWounded：沒有那個角色是假；剛好一半不算重傷', () => {
    const k = kernelWith([characterFeature])
    expect(isWounded(k.stats, makeState(), 'ghost')).toBe(false)
    expect(isWounded(k.stats, makeState({ pc: { hp: 20 } }), 'pc')).toBe(false)
    expect(isWounded(k.stats, makeState({ pc: { hp: 19 } }), 'pc')).toBe(true)
  })

  it('條件 wounded、track：沒有主角時是假；track 的格式；min、max', () => {
    const k = kernelWith([characterFeature])
    const ctx = (s: GameState, actor?: string) => ({ state: s, stats: k.stats, timeRules: k.timeRules, actor })
    expect(k.conditions.test({ kind: 'wounded' }, ctx(makeState({ pc: false })))).toBe(false)
    expect(k.conditions.test({ kind: 'track', track: 'hp', min: 0 }, ctx(makeState({ pc: false })))).toBe(false)
    expect(k.conditions.test({ kind: 'track', track: 'hp', min: 0 }, ctx(makeState(), 'ghost'))).toBe(false)
    expect(k.conditions.validate({ kind: 'track', track: 'mp', min: '1', max: 2 })).toEqual(['requires：track 要是 hp、load、sink、afterglow 其中一個', 'requires：min 要是數字'])
    expect(k.conditions.test({ kind: 'track', track: 'sink', max: 5 }, ctx(makeState({ pc: { sink: 5 } })))).toBe(true)
    expect(k.conditions.test({ kind: 'track', track: 'sink', min: 6 }, ctx(makeState({ pc: { sink: 5 } })))).toBe(false)
  })

  it('hp：已經只剩 1 時 AI 的扣血整筆拿掉並提醒；補血的描述（AI_TASKS 2.5「已經在邊界上」）', () => {
    const k = kernelWith([characterFeature])
    const s = makeState({ pc: { hp: 1 } })
    const r = k.effects.resolve([{ kind: 'hp', amount: -5 }, { kind: 'hp', amount: 3 }], ctxOf(k, s))
    expect(r.effects).toEqual([{ kind: 'hp', amount: 3 }])
    expect(r.clamps[0]).toMatchObject({ from: -5, to: 0, notice: '你已經只剩一口氣了，這一下不會再傷到你。' })
    expect(r.lines).toEqual(['生命：恢復了一些'])
    // 已經滿血時補血不產生變更
    expect(k.effects.resolve([{ kind: 'hp', amount: 3 }], ctxOf(k, makeState())).changes).toEqual([])
  })

  it('load：已經在上限 − 1 時整筆拿掉；往下的不夾，扣到 0 為止；描述（EVENTS 2.4 load）', () => {
    const k = kernelWith([characterFeature])
    const s = makeState({ pc: { load: 19 } })
    const r = k.effects.resolve([{ kind: 'load', amount: 4 }], ctxOf(k, s))
    expect(r.effects).toEqual([])
    expect(r.clamps[0]!.notice).toBe('你的感載已經繃到極限，這一下沒有再往上加。')
    const down = k.effects.resolve([{ kind: 'load', amount: -50 }], ctxOf(k, s))
    expect(down.changes).toEqual([{ op: 'actor.track', id: 'pc', track: 'load', delta: -19 }])
    expect(down.lines).toEqual(['感載：緩了下來'])
  })

  it('sink：往回拉的也夾在 −3；扣到 0 為止；描述（EVENTS 2.4 sink）', () => {
    const k = kernelWith([characterFeature])
    const s = makeState({ pc: { sink: 2 } })
    const r = k.effects.resolve([{ kind: 'sink', amount: -9 }], ctxOf(k, s))
    expect(r.clamps[0]).toMatchObject({ from: -9, to: -3, notice: '一次只能往回拉一點點，實際沒有那麼多。' })
    expect(r.changes).toEqual([{ op: 'actor.track', id: 'pc', track: 'sink', delta: -2 }])
    expect(r.lines).toEqual(['沉溺：往回拉一點'])
  })

  it('效果落在不存在的角色身上：目前值當 0（不丟錯）', () => {
    const k = kernelWith([characterFeature])
    const r = k.effects.resolve([{ kind: 'sink', amount: -1 }], ctxOf(k, makeState(), { actor: 'ghost' }))
    expect(r.changes).toEqual([])
  })
})

describe('白箱 L6 特質（CHARACTER 4.1、4.3、4.4、5.2、5.3）', () => {
  it('檢定修正：有 skills 限制但這次沒用基本功的不算；tags 要全部對上；沒有 checks 的特質略過', () => {
    const k = kernelWith([perksFeature])
    const s = makeState({ pc: { perks: ['smooth_talker', 'corp_reader', 'black_market', 'ghost_perk'] } })
    expect(k.stats.checkModifiers(s, 'pc', { attr: 'charm', tags: [] })).toEqual([])
    expect(k.stats.checkModifiers(s, 'pc', { attr: 'charm', skill: 'negotiate', tags: [] }).map((p) => p.label)).toEqual(['能言善道'])
    expect(k.stats.checkModifiers(s, 'pc', { attr: 'charm', skill: 'negotiate', tags: ['vs:corp'] }).map((p) => p.label)).toEqual(['能言善道', '看得懂合約'])
    expect(k.stats.checkModifiers(s, 'ghost', { attr: 'charm', tags: [] })).toEqual([])
  })

  it('衍生數值的來源：沒有那個角色、特質沒寫這個數值，都不加', () => {
    const k = kernelWith([characterFeature, perksFeature])
    expect(k.stats.statParts(makeState({ pc: { perks: ['tough', 'smooth_talker'] } }), 'pc', 'load_cap').map((p) => p.source)).toEqual(['base'])
    expect(k.stats.statParts(makeState(), 'ghost', 'afterglow_cap')).toEqual([{ label: '基礎', value: 3, source: 'base' }])
  })

  // perk 不給 AI 與玩家要的結果（ai: false）：驗證與結算都用內建的來源；AI 被擋見 M0-perks
  const ctxB = (k: Kernel, state: GameState, o: Partial<EffectCtx> = {}): EffectCtx => ctxOf(k, state, { source: 'builtin', ...o })
  it('perk 效果：id 不是字串、不存在、拿掉沒有的、加已經有的（EVENTS 2.4；CHARACTER 4.4）', () => {
    const k = kernelWith([perksFeature])
    const s = makeState({ pc: { perks: ['tough'] } })
    const v = (e: Record<string, unknown>) => k.effects.validate([{ kind: 'perk', ...e }], ctxB(k, s))
    expect(v({ id: 3 })).toEqual(['effects[0]：特質 3 不存在'])
    expect(v({})).toEqual(['effects[0]：特質  不存在'])
    expect(v({ id: 'smooth_talker', remove: true })[0]).toMatch(/沒有 能言善道/)
    expect(v({ id: 'tough' })[0]).toMatch(/已經有 耐打/)
    expect(k.effects.validate([{ kind: 'perk', id: 'tough' }], ctxB(k, s, { actor: 'ghost' }))).toEqual([])
  })

  it('perk 效果：上限 8 個不含出身與缺陷；creation_rule 沒載入時用 8；描述「學會、染上、放掉」（CHARACTER 4.4）', () => {
    const k = kernelWith([perksFeature], [NO_RULE_PACK])
    const full = ['a1', 'a2', 'a3', 'a4', 'a5', 'a6', 'a7', 'a8']
    const pack = { id: 'many', content: { perk: full.map((id) => ({ id, name: id, category: 'social', cost: 1, flaw: false, desc: '測試用。' })) } }
    k.content.loadPack(pack)
    const s = makeState({ pc: { perks: [...full.slice(0, 7), 'origin_hive', 'loose_lips', 'not_loaded'] } })
    const ok = k.effects.resolve([{ kind: 'perk', id: 'a8' }], ctxB(k, s))
    expect(ok.errors).toEqual([])
    expect(ok.lines).toEqual(['學會：a8'])
    s.actors.pc!.perks.push('a8')
    expect(k.effects.validate([{ kind: 'perk', id: 'tough' }], ctxB(k, s))[0]).toMatch(/特質最多 8 個/)
    // 缺陷與出身特質不佔名額
    const flaw = k.effects.resolve([{ kind: 'perk', id: 'old_wound' }], ctxB(k, s))
    expect(flaw.lines).toEqual(['染上：舊傷'])
    expect(k.effects.validate([{ kind: 'perk', id: 'origin_oldport' }], ctxB(k, s))).toEqual([])
    const rm = k.effects.resolve([{ kind: 'perk', id: 'a8', remove: true }], ctxB(k, s))
    expect(rm.changes).toEqual([{ op: 'actor.perk', id: 'pc', perk: 'a8', remove: true }])
    expect(rm.lines).toEqual(['放掉：a8'])
  })

  it('has_perk：要有 perk；看 ctx.actor，沒給看主角；沒有主角是假', () => {
    const k = kernelWith([perksFeature])
    expect(k.conditions.validate({ kind: 'has_perk' })).toEqual(['requires：要有 perk（特質的 id）'])
    const ctx = (s: GameState, actor?: string) => ({ state: s, stats: k.stats, timeRules: k.timeRules, actor })
    expect(k.conditions.test({ kind: 'has_perk', perk: 'tough' }, ctx(makeState({ pc: false })))).toBe(false)
    expect(k.conditions.test({ kind: 'has_perk', perk: 'tough' }, ctx(makeState({ pc: { perks: ['tough'] } })))).toBe(true)
    expect(k.conditions.test({ kind: 'has_perk', perk: 'tough' }, ctx(makeState({ pc: { perks: ['tough'] } }), 'ghost'))).toBe(false)
  })
})
