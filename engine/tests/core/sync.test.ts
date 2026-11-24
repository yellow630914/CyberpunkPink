// 驗收測試：dev/work/M3-core-battle.md 第 7 項（同步原則放在核心的規則層：core/rules/sync.ts）。
// 規格：CORE_RULES 第 5 節；CYBERSPACE 6.4 節；LEWD_SYSTEM 第 1 節（敏感度的門檻）；dev/adr/0018 第二節。
// 內容用測試自帶的最小資料；沒有讀 engine/data。

import { describe, expect, it } from 'vitest'
import type { Kernel } from '../../src'
import { ContentError, DEFAULT_MODES, DEFAULT_SYNC_RULE, SYNC_GEARS, SYNC_RULE_KIND, battleAttr, isSyncGear, syncBlock, syncBlocks, syncCapOf, syncGearIndex, syncRuleOf, syncSensitivityOf, syncSkillOf } from '../../src'
import { makeKernel, makeState } from '../../src/testkit'
import type { ActorOverrides } from '../../src/testkit'

const kernel = (): Kernel => makeKernel()
/** 一個主角：同步 sync 級、敏感度 sens（寫在 ext.bridge；不給就是沒有橋參數）、沉溺 sink。 */
const pc = (sync: number, sens?: number, sink = 0): ActorOverrides => ({ skills: { sync }, ext: sens === undefined ? {} : { bridge: { sensitivity: sens } }, sink })
const capOf = (k: Kernel, o: ActorOverrides) => syncCapOf(k, makeState({ pc: o }), 'pc')
const stat = (k: Kernel, id: string, value: number | ((state: unknown) => number)) => k.stats.defineStat({ id, owner: 'test', name: id, base: (s) => (typeof value === 'number' ? value : value(s)) })

describe('預設的表：逐格等於 CORE_RULES 第 5 節', () => {
  it('淺 −2／×0.5、標準 0／×1、深 +2／×1.5、全 +4／×2.5；全檔每回合多回 1 點行動點、過載時沉溺 +2；深要同步 3 級與敏感度 40、全要 5 級與 70', () => {
    const rule = syncRuleOf(kernel().content)
    expect(SYNC_GEARS).toEqual(['shallow', 'standard', 'deep', 'full'])
    expect(rule.skill).toBe('sync')
    expect(rule.sinkBonusAt).toBe(60)
    expect(rule.gears).toEqual({
      shallow: { name: '淺', check: -2, loadPct: 50, needSkill: 0, needSensitivity: 0 },
      standard: { name: '標準', check: 0, loadPct: 100, needSkill: 0, needSensitivity: 0 },
      deep: { name: '深', check: 2, loadPct: 150, needSkill: 3, needSensitivity: 40 },
      full: { name: '全', check: 4, loadPct: 250, needSkill: 5, needSensitivity: 70, apRegen: 1, sinkOnOverload: 2 },
    })
    // 只有全檔有這兩個欄位
    for (const g of ['shallow', 'standard', 'deep'] as const) expect(rule.gears[g]).not.toHaveProperty('apRegen')
  })

  it('回傳的是新的一份：改它不會動到預設，也不會動到下一次拿到的', () => {
    const k = kernel()
    const a = syncRuleOf(k.content)
    a.gears.deep.check = 99
    a.skill = 'x'
    expect(syncRuleOf(k.content).gears.deep.check).toBe(2)
    expect(syncRuleOf(k.content).skill).toBe('sync')
    expect(DEFAULT_SYNC_RULE.gears.deep.check).toBe(2)
  })

  it('檔位的順位與辨認', () => {
    expect(SYNC_GEARS.map(syncGearIndex)).toEqual([0, 1, 2, 3])
    expect(isSyncGear('deep')).toBe(true)
    expect(isSyncGear('ultra')).toBe(false)
  })
})

describe('syncCapOf：開得到哪一檔', () => {
  it('同步 2 級只到標準（敏感度再高也一樣）', () => {
    const k = kernel()
    expect(capOf(k, pc(2, 100))).toBe('standard')
    expect(capOf(k, pc(0, 100))).toBe('standard')
  })

  it('同步 3 級、敏感度 39 只到標準；敏感度 40 到深', () => {
    const k = kernel()
    expect(capOf(k, pc(3, 39))).toBe('standard')
    expect(capOf(k, pc(3, 40))).toBe('deep')
  })

  it('同步 5 級、敏感度 70 到全；敏感度 69 只到深；同步 4 級、敏感度 100 只到深', () => {
    const k = kernel()
    expect(capOf(k, pc(5, 70))).toBe('full')
    expect(capOf(k, pc(5, 69))).toBe('deep')
    expect(capOf(k, pc(4, 100))).toBe('deep')
    expect(capOf(k, pc(6, 100))).toBe('full')
  })

  it('沒有橋參數的人敏感度當 50：同步 3 級到深（要 40），同步 5 級只到深（全要 70）', () => {
    const k = kernel()
    expect(capOf(k, pc(3))).toBe('deep')
    expect(capOf(k, pc(5))).toBe('deep')
    expect(syncSensitivityOf(k, makeState({ pc: pc(3) }), 'pc')).toBe(50)
  })

  it('敏感度的來源：衍生數值 bridge_sensitivity 有人註冊就讀它（蓋過 actor.ext.bridge），沒有就讀 actor.ext.bridge.sensitivity', () => {
    const k = kernel()
    const state = makeState({ pc: pc(5, 20) })
    expect(syncSensitivityOf(k, state, 'pc')).toBe(20)
    expect(syncCapOf(k, state, 'pc')).toBe('standard')
    stat(k, 'bridge_sensitivity', 80)
    expect(syncSensitivityOf(k, state, 'pc')).toBe(80)
    expect(syncCapOf(k, state, 'pc')).toBe('full')
  })

  it('沉溺 60 的人上限 +1 級（59 不加）；加完最高還是全', () => {
    const k = kernel()
    expect(capOf(k, pc(2, 50, 59))).toBe('standard')
    expect(capOf(k, pc(2, 50, 60))).toBe('deep')
    expect(capOf(k, pc(3, 40, 60))).toBe('full')
    expect(capOf(k, pc(5, 70, 100))).toBe('full')
    // 條件連標準都沒有特別的（淺、標準都不看條件）：沉溺 +1 從標準算起
    expect(capOf(k, pc(0, 0, 60))).toBe('deep')
  })

  it('衍生數值 sync_cap_bonus 再加幾級（沒有人註冊是 0）：1 再 +1，最高是全', () => {
    const k = kernel()
    expect(capOf(k, pc(2, 50))).toBe('standard')
    stat(k, 'sync_cap_bonus', 1)
    expect(capOf(k, pc(2, 50))).toBe('deep')
    // 沉溺 60 再加 1 級：標準 → 深 → 全
    expect(capOf(k, pc(2, 50, 60))).toBe('full')
    // 已經在深：加 1 到全；已經是全：還是全
    expect(capOf(k, pc(3, 40))).toBe('full')
    expect(capOf(k, pc(5, 70, 80))).toBe('full')
  })

  it('sync_cap_bonus 很大也只到全；是 0 就不變', () => {
    const k = kernel()
    stat(k, 'sync_cap_bonus', 9)
    expect(capOf(k, pc(0, 0))).toBe('full')
    const k2 = kernel()
    stat(k2, 'sync_cap_bonus', 0)
    expect(capOf(k2, pc(0, 0))).toBe('standard')
  })

  it('syncSkillOf：讀那一項基本功的等級，沒學過是 0；沒有這個角色丟錯', () => {
    const k = kernel()
    const state = makeState({ pc: pc(4, 50) })
    expect(syncSkillOf(k, state, 'pc')).toBe(4)
    expect(syncSkillOf(k, makeState(), 'pc')).toBe(0)
    expect(() => syncSkillOf(k, state, 'nobody')).toThrow(/沒有 nobody/)
    expect(() => syncCapOf(k, state, 'nobody')).toThrow(/沒有 nobody/)
  })
})

describe('syncBlock：開不了的原因（給玩家看的完整句子）', () => {
  it('開得了（不高於上限）是 null；開不了是一句話，寫出缺的是什麼、現在是多少', () => {
    const k = kernel()
    const state = makeState({ pc: pc(3, 39) })
    expect(syncBlock(k, state, 'pc', 'shallow')).toBeNull()
    expect(syncBlock(k, state, 'pc', 'standard')).toBeNull()
    const deep = syncBlock(k, state, 'pc', 'deep')!
    // 同步夠、只缺敏感度：句子寫出敏感度的門檻與現在的數字
    expect(deep).toContain('敏感度')
    expect(deep).toContain('40')
    expect(deep).toContain('39')
    expect(deep).not.toMatch(/級才能/)
    expect(deep.endsWith('。')).toBe(true)
  })

  it('同步與敏感度都不夠：syncBlocks 一條一個條件，syncBlock 接在一起', () => {
    const k = kernel()
    const state = makeState({ pc: pc(2, 30) })
    const blocks = syncBlocks(k, state, 'pc', 'full')
    expect(blocks).toHaveLength(2)
    expect(blocks[0]).toMatch(/5 級.*全檔.*2 級/)
    expect(blocks[1]).toMatch(/敏感度.*70.*全檔.*30/)
    expect(syncBlock(k, state, 'pc', 'full')).toBe(blocks.join(''))
  })

  it('只缺同步：句子寫出幾級', () => {
    const k = kernel()
    const blocks = syncBlocks(k, makeState({ pc: pc(2, 90) }), 'pc', 'deep')
    expect(blocks).toHaveLength(1)
    expect(blocks[0]).toMatch(/3 級.*深檔.*2 級/)
  })

  it('沉溺或 sync_cap_bonus 把上限抬高之後，原本開不了的就開得了', () => {
    const k = kernel()
    expect(syncBlock(k, makeState({ pc: pc(2, 50, 60) }), 'pc', 'deep')).toBeNull()
    expect(syncBlock(k, makeState({ pc: pc(2, 50, 60) }), 'pc', 'full')).not.toBeNull()
    stat(k, 'sync_cap_bonus', 1)
    expect(syncBlock(k, makeState({ pc: pc(2, 50, 60) }), 'pc', 'full')).toBeNull()
  })

  it('不認得的檔位：說沒有這一檔', () => {
    expect(syncBlocks(kernel(), makeState({ pc: pc(5, 90) }), 'pc', 'ultra' as never)).toEqual(['沒有「ultra」這一檔。'])
  })

  it('基本功的名字：有載入 skill 的內容就用它的名字', () => {
    const k = kernel()
    k.content.load('skill', [{ id: 'sync', name: '同步', attr: 'resolve', desc: '撐住回灌。' }])
    expect(syncBlocks(k, makeState({ pc: pc(1, 90) }), 'pc', 'deep')[0]).toMatch(/^同步要 3 級/)
  })
})

describe('資料的 sync_rule/default 蓋得掉預設（規則表，dev/adr/0017）', () => {
  it('是規則表（後載入的取代前面的）：用同一個 id 再載一次不丟錯', () => {
    const k = kernel()
    expect(k.content.hasKind(SYNC_RULE_KIND)).toBe(true)
    expect(k.content.isOverridable(SYNC_RULE_KIND)).toBe(true)
    k.content.load(SYNC_RULE_KIND, [{ id: 'default', sink_bonus_at: 50 }])
    expect(() => k.content.load(SYNC_RULE_KIND, [{ id: 'default', sink_bonus_at: 40 }])).not.toThrow()
    expect(syncRuleOf(k.content).sinkBonusAt).toBe(40)
  })

  it('檔的整筆取代、沒寫的檔與欄位照預設；改了門檻之後 syncCapOf 照新的算', () => {
    const k = kernel()
    k.content.load(SYNC_RULE_KIND, [{
      id: 'default', sink_bonus_at: 50, skill: 'tune',
      gears: { deep: { name: '深潛', check: 3, load_pct: 130, need_skill: 2, need_sensitivity: 30 } },
    }])
    const rule = syncRuleOf(k.content)
    expect(rule.skill).toBe('tune')
    expect(rule.sinkBonusAt).toBe(50)
    expect(rule.gears.deep).toEqual({ name: '深潛', check: 3, loadPct: 130, needSkill: 2, needSensitivity: 30 })
    expect(rule.gears.full).toEqual(DEFAULT_SYNC_RULE.gears.full)
    expect(rule.gears.shallow).toEqual(DEFAULT_SYNC_RULE.gears.shallow)
    // 看的是 tune 這一項基本功（不是 sync）：tune 2 級、敏感度 30 就到深
    const state = makeState({ pc: { skills: { tune: 2, sync: 0 }, ext: { bridge: { sensitivity: 30 } } } })
    expect(syncCapOf(k, state, 'pc')).toBe('deep')
    expect(syncSkillOf(k, state, 'pc')).toBe(2)
    // 沉溺 50 就 +1
    state.actors.pc!.sink = 50
    expect(syncCapOf(k, state, 'pc')).toBe('full')
  })

  it('全檔的 ap_regen、sink_on_overload：資料沒寫就沒有（整筆取代，不從預設繼承）', () => {
    const k = kernel()
    k.content.load(SYNC_RULE_KIND, [{ id: 'default', gears: { full: { name: '全', check: 4, load_pct: 250, need_skill: 5, need_sensitivity: 70 } } }])
    expect(syncRuleOf(k.content).gears.full).toEqual({ name: '全', check: 4, loadPct: 250, needSkill: 5, needSensitivity: 70 })
    k.content.load(SYNC_RULE_KIND, [{ id: 'default', gears: { full: { name: '全', check: 4, load_pct: 250, need_skill: 5, need_sensitivity: 70, ap_regen: 2, sink_on_overload: 3 } } }])
    expect(syncRuleOf(k.content).gears.full).toMatchObject({ apRegen: 2, sinkOnOverload: 3 })
  })

  const bad = (entry: Record<string, unknown>): string => {
    try {
      kernel().content.load(SYNC_RULE_KIND, [{ id: 'default', ...entry }])
      return ''
    } catch (e) {
      expect(e).toBeInstanceOf(ContentError)
      return (e as ContentError).problems.join('\n')
    }
  }
  const GOOD = { name: '深', check: 2, load_pct: 150, need_skill: 3, need_sensitivity: 40 }

  it('格式壞的被擋，訊息寫出是哪一個欄位', () => {
    expect(bad({ gears: { deep: GOOD } })).toBe('')
    expect(bad({ gears: { ultra: GOOD } })).toMatch(/gears\.ultra：沒有這一檔/)
    expect(bad({ gears: 5 })).toMatch(/gears 要是/)
    expect(bad({ gears: { deep: 'x' } })).toMatch(/gears\.deep 要是/)
    expect(bad({ gears: { deep: { ...GOOD, name: '' } } })).toMatch(/gears\.deep\.name/)
    expect(bad({ gears: { deep: { ...GOOD, check: 1.5 } } })).toMatch(/gears\.deep\.check/)
    expect(bad({ gears: { deep: { ...GOOD, load_pct: '150' } } })).toMatch(/gears\.deep\.load_pct/)
    expect(bad({ gears: { deep: { ...GOOD, load_pct: -1 } } })).toMatch(/gears\.deep\.load_pct/)
    expect(bad({ gears: { deep: { ...GOOD, need_skill: 7 } } })).toMatch(/gears\.deep\.need_skill/)
    expect(bad({ gears: { deep: { ...GOOD, need_sensitivity: 101 } } })).toMatch(/gears\.deep\.need_sensitivity/)
    expect(bad({ gears: { deep: { ...GOOD, ap_regen: -1 } } })).toMatch(/gears\.deep\.ap_regen/)
    expect(bad({ gears: { deep: { ...GOOD, sink_on_overload: 1.5 } } })).toMatch(/gears\.deep\.sink_on_overload/)
    expect(bad({ gears: { deep: { ...GOOD, typo: 1 } } })).toMatch(/gears\.deep\.typo：沒有這個欄位/)
    expect(bad({ gears: { deep: { name: '深' } } })).toMatch(/check/)
    expect(bad({ sink_bonus_at: 0 })).toMatch(/sink_bonus_at/)
    expect(bad({ sink_bonus_at: '60' })).toMatch(/sink_bonus_at/)
    expect(bad({ skill: '' })).toMatch(/skill/)
    expect(bad({ extra: 1 })).toMatch(/extra：沒有這個欄位/)
  })

  it('格式壞的整批不收：預設還在', () => {
    const k = kernel()
    expect(() => k.content.load(SYNC_RULE_KIND, [{ id: 'default', gears: { deep: { ...GOOD, check: 'x' } } }])).toThrow(ContentError)
    expect(syncRuleOf(k.content)).toEqual(DEFAULT_SYNC_RULE)
  })
})

describe('battleAttr：這個戰場裡實際用哪個屬性（給組武器的功能用）', () => {
  it('內海：體格由意志代替，其餘照舊；現實：都照舊；沒有戰場也不丟錯', () => {
    expect(battleAttr(DEFAULT_MODES.net, 'body')).toBe('resolve')
    for (const a of ['reflex', 'tech', 'intellect', 'resolve', 'charm'] as const) expect(battleAttr(DEFAULT_MODES.net, a)).toBe(a)
    for (const a of ['body', 'reflex', 'tech', 'intellect', 'resolve', 'charm'] as const) expect(battleAttr(DEFAULT_MODES.meat, a)).toBe(a)
    expect(battleAttr(undefined, 'body')).toBe('body')
    expect(battleAttr({ attrAs: { charm: 'tech' } }, 'charm')).toBe('tech')
  })
})
