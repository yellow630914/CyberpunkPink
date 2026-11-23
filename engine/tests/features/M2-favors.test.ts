// 驗收測試：dev/work/M2-favors.md（cpp-feature）。規格：FIXER 第 8 節；EVENTS 2.4 節的 owed、owed_to_pc；TRADE 4.4 節（人情作價）；
// dev/adr/0015 E2（戰鬥的人情池讀 favor_small／favor_mid／favor_big）；dev/adr/0016（量表與前綴的規矩）。
// 內容一律用測試自帶的最小假資料。

import { describe, expect, it } from 'vitest'
import type { ContentPack, Effect, Feature, GameState, Kernel, ReportDraft } from '../../src'
import { ActionBlocked, ContentError, effectCtx } from '../../src'
import { call, favorPrice, favorRules, favorsFeature, favorsOf, spend, spendBlock } from '../../src/features/favors'
import { makeGame, observed } from '../../src/testkit'

const PACK: ContentPack = {
  id: 'favors_test',
  content: {
    faction: [{ id: 'hizakura', name: '緋櫻重工', short: '緋櫻', class: 'corp' }],
    npc: [{ id: 'npc_a', name: '阿甲' }, { id: 'npc_b', name: '阿乙' }],
  },
}

/** 沒有人定義 rep 時拿掉信譽效果的對照組：這個功能把 rep 效果登記成「記進計數器」。 */
const REP: Feature = {
  id: 'test_rep',
  install(k: Kernel) {
    k.effects.register({
      kind: 'rep', owner: 'test_rep',
      validate: (raw) => (Number.isSafeInteger(raw.amount) ? [] : ['amount 要是整數']),
      toChanges: (e) => [{ op: 'counter', key: 'rep', delta: e.amount as number }],
      describe: (e) => `街頭信譽 ${e.amount as number}`,
    })
  },
}

type G = ReturnType<typeof makeGame>['game']
const game = (o: { rep?: boolean; pc?: false; content?: ContentPack[] } = {}): G =>
  makeGame({ features: o.rep ? [favorsFeature, REP] : [favorsFeature], content: o.content ?? [PACK], ...(o.pc === false ? { pc: false as const } : {}) }).game

const draft = (changes: ReportDraft['changes'], action = 'test.give'): ReportDraft => ({
  kind: 'event', action, location: { district: 'test' }, party: [], timeline: [], changes, outcome: { result: 'ok', summary: '測試' },
})

/** 用效果給人情（內建的）：走和事件一樣的路——效果登錄表解析、提交。 */
function give(g: G, kind: 'owed_to_pc' | 'owed', who: string, size: string, source: 'builtin' | 'ai' = 'builtin') {
  const r = g.k.effects.resolve([{ kind, who, size }], effectCtx(g.k, g.state, { source }))
  if (r.errors.length) throw new Error(r.errors.join('；'))
  g.commit(draft(r.changes))
  return r
}
const stat = (g: G, id: string, actor = 'pc') => g.k.stats.stat(g.state, actor, id)
const test = (g: G, cond: Record<string, unknown>) => g.k.conditions.test(cond as never, { state: g.state, stats: g.k.stats, timeRules: g.k.timeRules })

describe('加一筆：owed_to_pc', () => {
  it('小的：清單多一筆、favor_small 是 1、has_favor 成立；記下對象、大小與時間', () => {
    const g = game()
    expect(favorsOf(g.state).owed_to_pc).toEqual([])
    expect(test(g, { kind: 'has_favor', dir: 'owed_to_pc' })).toBe(false)
    give(g, 'owed_to_pc', 'npc_a', 'small')
    const f = favorsOf(g.state)
    expect(f.owed_to_pc).toHaveLength(1)
    expect(f.owed_to_pc[0]).toMatchObject({ who: 'npc_a', size: 'small', at: { day: g.state.time.day, hour: g.state.time.hour, minute: g.state.time.minute } })
    expect(stat(g, 'favor_small')).toBe(1)
    expect(stat(g, 'favor_mid')).toBe(0)
    expect(stat(g, 'favor_big')).toBe(0)
    expect(test(g, { kind: 'has_favor', dir: 'owed_to_pc' })).toBe(true)
    expect(test(g, { kind: 'has_favor', dir: 'owed_to_pc', who: 'npc_a', size: 'small' })).toBe(true)
    expect(test(g, { kind: 'has_favor', dir: 'owed_to_pc', who: 'npc_b' })).toBe(false)
    expect(test(g, { kind: 'has_favor', dir: 'owed_to_pc', size: 'mid' })).toBe(false)
  })

  it('勢力也可以欠；三種大小各算各的；每一筆有不重複的 id（用掉之後也不重複）', () => {
    const g = game()
    give(g, 'owed_to_pc', 'hizakura', 'big')
    give(g, 'owed_to_pc', 'npc_a', 'mid')
    give(g, 'owed_to_pc', 'npc_b', 'small')
    give(g, 'owed_to_pc', 'npc_b', 'small')
    expect([stat(g, 'favor_small'), stat(g, 'favor_mid'), stat(g, 'favor_big')]).toEqual([2, 1, 1])
    const ids = favorsOf(g.state).owed_to_pc.map((x) => x.id)
    expect(new Set(ids).size).toBe(4)
    g.commit(spend(g.k, g.state, { id: ids[3]! }))
    give(g, 'owed_to_pc', 'npc_b', 'small')
    const after = favorsOf(g.state).owed_to_pc.map((x) => x.id)
    expect(after).not.toContain(ids[3])
    expect(new Set(after).size).toBe(4)
  })

  it('提交一份帶人情的報告：不變式（changes 套用之後等於實際的變化）成立', async () => {
    const g = game()
    const { violations } = await observed(g, () => give(g, 'owed_to_pc', 'npc_a', 'small'))
    expect(violations).toEqual([])
  })
})

describe('用掉：spend', () => {
  it('用掉指定對象的小人情：那一筆沒了，別人的還在；報告是 favor.use', () => {
    const g = game()
    give(g, 'owed_to_pc', 'npc_a', 'small')
    give(g, 'owed_to_pc', 'npc_b', 'small')
    expect(spendBlock(g.k, g.state, { who: 'npc_b', size: 'small' })).toBeNull()
    const [report] = g.commit(spend(g.k, g.state, { who: 'npc_b', size: 'small' }))
    expect(report!.action).toBe('favor.use')
    expect(report!.outcome.summary).toContain('阿乙')
    expect(favorsOf(g.state).owed_to_pc.map((x) => x.who)).toEqual(['npc_a'])
    expect(stat(g, 'favor_small')).toBe(1)
  })

  it('不指定對象：用最早記下的那一筆；也可以指定哪一筆（id）', () => {
    const g = game()
    give(g, 'owed_to_pc', 'npc_a', 'small')
    give(g, 'owed_to_pc', 'npc_b', 'small')
    g.commit(spend(g.k, g.state, { size: 'small' }))
    expect(favorsOf(g.state).owed_to_pc.map((x) => x.who)).toEqual(['npc_b'])
    const id = favorsOf(g.state).owed_to_pc[0]!.id
    g.commit(spend(g.k, g.state, { id }))
    expect(favorsOf(g.state).owed_to_pc).toEqual([])
  })

  it('沒有時被擋下並有原因（完整的句子）；狀態不變、報告提交不出去', () => {
    const g = game()
    const reason = spendBlock(g.k, g.state, { who: 'npc_a', size: 'small' })
    expect(reason).toMatch(/阿甲沒有欠你人情。/)
    expect(() => spend(g.k, g.state, { who: 'npc_a', size: 'small' })).toThrow(ActionBlocked)
    expect(spendBlock(g.k, g.state, { size: 'small' })).toMatch(/^沒有人欠你/)
    expect(spendBlock(g.k, g.state, { id: 'fv_99' })).toMatch(/沒有這一筆/)
    // 對象有欠，但大小不對
    give(g, 'owed_to_pc', 'npc_a', 'big')
    expect(spendBlock(g.k, g.state, { who: 'npc_a', size: 'small' })).toMatch(/阿甲欠你的人情是大的，頂不了一個小人情/)
    expect(spendBlock(g.k, g.state, { who: 'npc_b', size: 'mid' })).toMatch(/阿乙沒有欠你人情/)
    expect(favorsOf(g.state).owed_to_pc).toHaveLength(1)
  })

  it('只有中的時可以拿中的當小的用，整筆用掉；有小的時先用小的', () => {
    const g = game()
    give(g, 'owed_to_pc', 'npc_a', 'mid')
    expect(spendBlock(g.k, g.state, { who: 'npc_a', size: 'small' })).toBeNull()
    const [report] = g.commit(spend(g.k, g.state, { who: 'npc_a', size: 'small' }))
    expect(report!.narration!.results![0]).toContain('當小的用')
    expect(favorsOf(g.state).owed_to_pc).toEqual([])
    expect(stat(g, 'favor_mid')).toBe(0)
    give(g, 'owed_to_pc', 'npc_a', 'mid')
    give(g, 'owed_to_pc', 'npc_a', 'small')
    g.commit(spend(g.k, g.state, { who: 'npc_a', size: 'small' }))
    expect(favorsOf(g.state).owed_to_pc.map((x) => x.size)).toEqual(['mid'])
  })

  it('大的可以當中的用；大的頂不了小的；小的頂不了中的', () => {
    const g = game()
    give(g, 'owed_to_pc', 'npc_a', 'big')
    expect(spendBlock(g.k, g.state, { size: 'small' })).not.toBeNull()
    expect(spendBlock(g.k, g.state, { size: 'mid' })).toBeNull()
    g.commit(spend(g.k, g.state, { size: 'mid' }))
    expect(favorsOf(g.state).owed_to_pc).toEqual([])
    give(g, 'owed_to_pc', 'npc_a', 'small')
    expect(spendBlock(g.k, g.state, { size: 'mid' })).not.toBeNull()
  })

  it('主角欠人的那一邊不能被當成「欠你的」用掉', () => {
    const g = game()
    give(g, 'owed', 'npc_a', 'small')
    expect(spendBlock(g.k, g.state, { who: 'npc_a', size: 'small' })).not.toBeNull()
    // 變更也不收：沒有欠你的那一筆
    expect(() => g.commit(draft([{ op: 'favor.spend', dir: 'owed_to_pc', who: 'npc_a', size: 'small' }]))).toThrow()
    expect(favorsOf(g.state).owed_by_pc).toHaveLength(1)
  })
})

describe('AI 給的人情：只收小與中', () => {
  it('AI 給大的：整筆拿掉並提醒（clamps 的白話）；內建的照寫', () => {
    const g = game()
    const ai = g.k.effects.resolve([{ kind: 'owed_to_pc', who: 'npc_a', size: 'big' }], effectCtx(g.k, g.state, { source: 'ai' }))
    expect(ai.errors).toEqual([])
    expect(ai.changes).toEqual([])
    expect(ai.clamps).toHaveLength(1)
    expect(ai.clamps[0]!.notice).toMatch(/大人情/)
    const owed = g.k.effects.resolve([{ kind: 'owed', who: 'npc_a', size: 'big' }], effectCtx(g.k, g.state, { source: 'ai' }))
    expect(owed.changes).toEqual([])
    expect(owed.clamps).toHaveLength(1)
    const builtin = g.k.effects.resolve([{ kind: 'owed_to_pc', who: 'npc_a', size: 'big' }], effectCtx(g.k, g.state, { source: 'builtin' }))
    expect(builtin.clamps).toEqual([])
    expect(builtin.changes).toHaveLength(1)
    give(g, 'owed_to_pc', 'npc_a', 'big')
    expect(stat(g, 'favor_big')).toBe(1)
  })

  it('AI 給小與中照收；一件事最多一個（EVENTS 2.4 節），多的拿掉並提醒', () => {
    const g = game()
    const one = g.k.effects.resolve([{ kind: 'owed_to_pc', who: 'npc_a', size: 'mid' }], effectCtx(g.k, g.state, { source: 'ai' }))
    expect(one.changes).toHaveLength(1)
    expect(one.clamps).toEqual([])
    const two = g.k.effects.resolve(
      [{ kind: 'owed_to_pc', who: 'npc_a', size: 'small' }, { kind: 'owed_to_pc', who: 'npc_b', size: 'small' }],
      effectCtx(g.k, g.state, { source: 'ai' }),
    )
    expect(two.changes).toHaveLength(1)
    expect(two.changes[0]).toMatchObject({ who: 'npc_a' })
    expect(two.clamps).toHaveLength(1)
  })
})

describe('內容檢查：效果的 who', () => {
  const check = (g: G, e: Effect) => g.k.effects.validate([e], effectCtx(g.k, g.state, { source: 'builtin' }))
  it('查得到的人或勢力、或 $a 這類登場角色的代號才合格', () => {
    const g = game()
    expect(check(g, { kind: 'owed_to_pc', who: 'npc_a', size: 'small' })).toEqual([])
    expect(check(g, { kind: 'owed', who: 'hizakura', size: 'mid' })).toEqual([])
    expect(check(g, { kind: 'owed_to_pc', who: '$a', size: 'small' })).toEqual([])
    expect(check(g, { kind: 'owed_to_pc', who: 'nobody', size: 'small' })[0]).toMatch(/who：nobody 不是查得到的人或勢力/)
    expect(check(g, { kind: 'owed_to_pc', who: '', size: 'small' })).not.toEqual([])
    expect(check(g, { kind: 'owed_to_pc', who: 'npc_a', size: 'huge' })[0]).toMatch(/size/)
    expect(check(g, { kind: 'owed_to_pc', size: 'small' })).not.toEqual([])
  })

  it('代號沒有換成真的人就結算：整批不收（不會把 $a 記進狀態）', () => {
    const g = game()
    const r = g.k.effects.resolve([{ kind: 'owed_to_pc', who: '$a', size: 'small' }], effectCtx(g.k, g.state, { source: 'builtin' }))
    expect(r.errors.length).toBeGreaterThan(0)
    expect(r.changes).toEqual([])
    expect(() => g.commit(draft([{ op: 'favor.add', dir: 'owed_to_pc', who: '$a', size: 'small' }]))).toThrow()
  })

  it('條件 has_favor 的格式：dir 要有；size 只能是三種', () => {
    const g = game()
    expect(g.k.conditions.validate({ kind: 'has_favor', dir: 'owed_to_pc', who: 'npc_a', size: 'mid' })).toEqual([])
    expect(g.k.conditions.validate({ kind: 'has_favor' })).not.toEqual([])
    expect(g.k.conditions.validate({ kind: 'has_favor', dir: 'owed_to_pc', size: 'huge' })).not.toEqual([])
  })
})

describe('主角欠人的一邊：owed', () => {
  it('分開記，不算進 favor_*；has_favor 用 dir 分兩邊', () => {
    const g = game()
    give(g, 'owed', 'npc_a', 'small')
    give(g, 'owed', 'hizakura', 'big')
    expect(favorsOf(g.state).owed_by_pc.map((x) => [x.who, x.size])).toEqual([['npc_a', 'small'], ['hizakura', 'big']])
    expect(favorsOf(g.state).owed_to_pc).toEqual([])
    expect([stat(g, 'favor_small'), stat(g, 'favor_mid'), stat(g, 'favor_big')]).toEqual([0, 0, 0])
    expect(test(g, { kind: 'has_favor', dir: 'owed_by_pc', who: 'npc_a', size: 'small' })).toBe(true)
    expect(test(g, { kind: 'has_favor', dir: 'owed_to_pc', who: 'npc_a' })).toBe(false)
    give(g, 'owed_to_pc', 'npc_a', 'small')
    expect(stat(g, 'favor_small')).toBe(1)
    expect(favorsOf(g.state).owed_by_pc).toHaveLength(2)
  })
})

describe('被討：call', () => {
  it('拒絕：那一筆還在，並給 rep −3（有人定義 rep 時）；報告是 favor.called', () => {
    const g = game({ rep: true })
    give(g, 'owed', 'npc_a', 'mid')
    const id = favorsOf(g.state).owed_by_pc[0]!.id
    const [report] = g.commit(call(g.k, g.state, id, 'refuse'))
    expect(report!.action).toBe('favor.called')
    expect(report!.outcome.result).toBe('refuse')
    expect(favorsOf(g.state).owed_by_pc.map((x) => x.id)).toEqual([id])
    expect(g.state.counters.rep).toBe(-3)
    g.commit(call(g.k, g.state, id, 'refuse'))
    expect(g.state.counters.rep).toBe(-6)
    expect(favorsOf(g.state).owed_by_pc).toHaveLength(1)
  })

  it('拒絕：沒有人定義 rep 時略過信譽，其餘一樣', () => {
    const g = game()
    give(g, 'owed', 'npc_a', 'small')
    const id = favorsOf(g.state).owed_by_pc[0]!.id
    const d = call(g.k, g.state, id, 'refuse')
    expect(d.changes).toEqual([])
    g.commit(d)
    expect(favorsOf(g.state).owed_by_pc).toHaveLength(1)
  })

  it('答應：那一筆清掉，不扣信譽；別筆不動', () => {
    const g = game({ rep: true })
    give(g, 'owed', 'npc_a', 'small')
    give(g, 'owed', 'npc_b', 'small')
    const id = favorsOf(g.state).owed_by_pc[0]!.id
    const [report] = g.commit(call(g.k, g.state, id, 'do'))
    expect(report!.action).toBe('favor.called')
    expect(report!.outcome.result).toBe('do')
    expect(favorsOf(g.state).owed_by_pc.map((x) => x.who)).toEqual(['npc_b'])
    expect(g.state.counters.rep).toBeUndefined()
  })

  it('不是主角欠的那一筆（別人欠主角的、或已經還掉的）被擋下並有原因', () => {
    const g = game({ rep: true })
    give(g, 'owed_to_pc', 'npc_a', 'small')
    const id = favorsOf(g.state).owed_to_pc[0]!.id
    expect(() => call(g.k, g.state, id, 'do')).toThrow(ActionBlocked)
    expect(() => call(g.k, g.state, 'fv_99', 'refuse')).toThrow(/沒有欠這一筆/)
  })

  it('被討的報告不變式成立', async () => {
    const g = game({ rep: true })
    give(g, 'owed', 'npc_a', 'small')
    const id = favorsOf(g.state).owed_by_pc[0]!.id
    const { violations } = await observed(g, () => g.commit(call(g.k, g.state, id, 'refuse')))
    expect(violations).toEqual([])
  })
})

describe('作價的規則（TRADE 4.4 節）', () => {
  it('小 300、中 1,500；大的不作價', () => {
    const g = game()
    expect(favorPrice(g.k, 'small')).toBe(300)
    expect(favorPrice(g.k, 'mid')).toBe(1500)
    expect(favorPrice(g.k, 'big')).toBeNull()
    expect(favorRules(g.k)).toEqual({ price: { small: 300, mid: 1500 }, refuse_rep: -3 })
  })

  it('資料 favor_rule/default 蓋掉預設；寫了大的作價或負的價錢是格式錯誤', () => {
    const over: ContentPack = { id: 'rule', content: { favor_rule: [{ id: 'default', price: { small: 250 }, refuse_rep: -5 }] } }
    const g = game({ content: [PACK, over] })
    expect(favorPrice(g.k, 'small')).toBe(250)
    expect(favorPrice(g.k, 'mid')).toBe(1500)
    expect(favorRules(g.k).refuse_rep).toBe(-5)
    for (const bad of [{ price: { big: 9000 } }, { price: { small: -1 } }, { refuse_rep: 3 }, { price: 'x' }]) {
      expect(() => game({ content: [{ id: 'bad', content: { favor_rule: [{ id: 'default', ...bad }] } }] })).toThrow(ContentError)
    }
  })

  it('拒絕被討的信譽也照規則的資料', () => {
    const over: ContentPack = { id: 'rule', content: { favor_rule: [{ id: 'default', refuse_rep: -7 }] } }
    const g = game({ rep: true, content: [PACK, over] })
    give(g, 'owed', 'npc_a', 'small')
    g.commit(call(g.k, g.state, favorsOf(g.state).owed_by_pc[0]!.id, 'refuse'))
    expect(g.state.counters.rep).toBe(-7)
  })
})

describe('沒有主角', () => {
  it('三個衍生數值是 0，不丟錯；條件不成立；加人情被擋下（人情只記在主角名下）', () => {
    const g = game({ pc: false })
    expect(g.state.pc).toBeFalsy()
    for (const id of ['favor_small', 'favor_mid', 'favor_big']) expect(() => g.k.stats.stat(g.state, 'pc', id)).not.toThrow()
    expect([stat(g, 'favor_small'), stat(g, 'favor_mid'), stat(g, 'favor_big')]).toEqual([0, 0, 0])
    expect(test(g, { kind: 'has_favor', dir: 'owed_to_pc' })).toBe(false)
    expect(spendBlock(g.k, g.state, { size: 'small' })).toMatch(/還沒有主角/)
    expect(() => g.commit(draft([{ op: 'favor.add', dir: 'owed_to_pc', who: 'npc_a', size: 'small' }]))).toThrow(/還沒有主角/)
  })

  it('不是主角的角色（夥伴）讀這三個數值是 0：人情不分給夥伴', () => {
    const g = game()
    give(g, 'owed_to_pc', 'npc_a', 'small')
    g.commit(draft([{ op: 'actor.add', actor: { id: 'mate', name: '夥伴', role: 'companion', age: 25, gender: 'female', attrs: { body: 10, reflex: 10, tech: 10, intellect: 10, resolve: 10, charm: 10 }, skills: {}, perks: [], hp: 40, load: 0, afterglow: 0, sink: 0, conditions: [], ext: {} } }]))
    expect(stat(g, 'favor_small', 'mate')).toBe(0)
    expect(stat(g, 'favor_small')).toBe(1)
  })
})

describe('存檔與回到快照', () => {
  it('存檔往返：兩邊的清單、流水號都不變', () => {
    const g = game()
    give(g, 'owed_to_pc', 'npc_a', 'small')
    give(g, 'owed_to_pc', 'hizakura', 'big')
    give(g, 'owed', 'npc_b', 'mid')
    const before = favorsOf(g.state)
    const raw = g.save()
    const other = game()
    expect(other.load(raw)).toBeNull()
    expect(favorsOf(other.state)).toEqual(before)
    expect(stat(other, 'favor_big')).toBe(1)
    // 讀回來之後接著加，id 不和舊的重複
    give(other, 'owed_to_pc', 'npc_a', 'small')
    expect(new Set(favorsOf(other.state).owed_to_pc.map((x) => x.id)).size).toBe(3)
  })

  it('回到快照：人情跟著回去（兩邊都是）；之後的紀錄留著', () => {
    const g = game()
    give(g, 'owed_to_pc', 'npc_a', 'small')
    const raw = g.save('snapshot')
    const keep = favorsOf(g.state)
    give(g, 'owed_to_pc', 'npc_b', 'mid')
    give(g, 'owed', 'npc_b', 'small')
    g.commit(spend(g.k, g.state, { who: 'npc_a', size: 'small' }))
    expect(g.rewind(raw, { summary: '你回到了那一刻。' })).toBeNull()
    expect(favorsOf(g.state)).toEqual(keep)
    expect(stat(g, 'favor_small')).toBe(1)
    expect(stat(g, 'favor_mid')).toBe(0)
  })

  it('回退一步（undo）：人情跟著回去', () => {
    const g = game()
    give(g, 'owed_to_pc', 'npc_a', 'small')
    expect(g.undoSteps(1)).toBe(true)
    expect(favorsOf(g.state).owed_to_pc).toEqual([])
  })
})

describe('讀存檔裡不合格的資料不丟錯', () => {
  it('ext.favors 形狀壞掉：當成空的', () => {
    const g = game()
    ;(g.state as GameState).ext.favors = { owed_to_pc: 'x', owed_by_pc: [{ nope: 1 }], seq: -3 }
    expect(favorsOf(g.state)).toEqual({ owed_to_pc: [], owed_by_pc: [], seq: 0 })
    expect(stat(g, 'favor_small')).toBe(0)
  })
})
