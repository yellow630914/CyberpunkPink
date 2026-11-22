// 驗收測試：dev/work/M1b-data-rules.md（cpp-data）。
// 規格：SKILL_TREES 改造師「拆解」「超頻」兩列；ITEMS 5.1 節電磁彈、5.2 節閃光彈與紙鶴；COMBAT_SYSTEM 2.5 節；dev/adr/0015 第二、三節。
// 內容資料照測試自帶：這裡只讀規則表 battle_statuses.json 本身。

import { describe, expect, it } from 'vitest'
import type { BattleStatusEntry } from '../../src'
import { Game, beginTurn, statusRuleOf } from '../../src'
import { allFeatures } from '../../src/features'
import { CORE_PACK, SOURCES } from '../../data'
import statuses from '../../data/rules/battle_statuses.json'
import { arena, duel, foe, one } from '../helpers/battle'

const NEW_IDS = ['off_limb', 'off_eye', 'off_smartgun', 'off_reflex', 'off_generic', 'boost_limb', 'boost_smartgun', 'boost_subdermal', 'boost_generic', 'ap_minus_1', 'see_dark', 'untargeted']
const OLD_IDS = ['lose_turn', 'suppressed', 'dazed', 'bleeding', 'limb_hurt', 'burning', 'jammed', 'marked', 'pinned_down']
const rows = statuses as BattleStatusEntry[]
const row = (id: string) => rows.find((e) => e.id === id)!
const withRules = () => arena(duel([one()], [foe(), foe()]), undefined, (k) => k.content.load('battle_status', rows))

describe('M1b-data-rules：義體失效、超頻與其他戰鬥狀態', () => {
  it('整包載得進去（loadPack 沒有錯），引用都找得到，出處寫了第二波的來源', () => {
    expect(() => new Game({ features: allFeatures(), content: [CORE_PACK] })).not.toThrow()
    const k = new Game({ features: allFeatures(), content: [CORE_PACK] }).k
    expect(k.content.checkRefs()).toEqual([])
    const ids = k.content.list('battle_status').map((e) => e.id)
    expect(ids).toEqual(expect.arrayContaining([...OLD_IDS, ...NEW_IDS]))
    expect(ids).toHaveLength(OLD_IDS.length + NEW_IDS.length)
    expect(SOURCES.battle_status).toContain('M1b-data-rules')
  })

  it('每一筆 name 與 desc 是給玩家看的完整句子', () => {
    for (const id of NEW_IDS) {
      const e = row(id)
      expect(e.name.trim().length, id).toBeGreaterThan(1)
      expect(e.desc.length, id).toBeGreaterThan(10)
      expect(e.desc, id).toMatch(/[。！]$/)
    }
  })

  it('數字逐項照設計書', () => {
    for (const id of ['off_limb', 'off_eye', 'off_smartgun']) expect(row(id), id).toMatchObject({ mods: { hit: -2 }, until: 'own_turn_end', turns: 1, kind: 'debuff' })
    expect(row('off_reflex')).toMatchObject({ turn_start: { ap: -1 }, once: true, until: 'own_turn_end', kind: 'debuff' })
    for (const id of ['boost_limb', 'boost_smartgun']) expect(row(id), id).toMatchObject({ mods: { hit: 2 }, until: 'own_turn_end', turns: 1, kind: 'buff' })
    expect(row('boost_subdermal')).toMatchObject({ mods: { armor: 2 }, until: 'own_turn_end', kind: 'buff' })
    expect(row('ap_minus_1')).toMatchObject({ turn_start: { ap: -1 }, once: true, until: 'own_turn_end', kind: 'debuff' })
    expect(row('see_dark')).toMatchObject({ mods: { see_dark: 1 }, until: 'own_turn_end', kind: 'buff' })
    expect(row('untargeted')).toMatchObject({ mods: { ai_target_pct: -100 }, until: 'own_turn_end', kind: 'buff' })
    // 其他種類：沒有數字上的效果，只有名字與說明
    for (const id of ['off_generic', 'boost_generic']) {
      expect(row(id).mods, id).toBeUndefined()
      expect(row(id).turn_start, id).toBeUndefined()
    }
    // boost_eye 格式裡沒有對應的修正種類，不加
    expect(rows.find((e) => e.id === 'boost_eye')).toBeUndefined()
  })

  it('現有的九個狀態沒有被改動', () => {
    expect(rows.slice(0, OLD_IDS.length).map((e) => e.id)).toEqual(OLD_IDS)
    expect(row('suppressed')).toEqual({ id: 'suppressed', name: '壓制', desc: '到他下一回合結束前不能換位，攻擊 −2。', mods: { hit: -2 }, no_move: true, until: 'own_turn_end', turns: 1, kind: 'debuff' })
    expect(row('pinned_down')).toEqual({ id: 'pinned_down', name: '被壓住', desc: '開打之前被制住：第一回合行動點 −1，這一場戰鬥。', turn_start: { ap: -1 }, once: true, until: 'battle_end', kind: 'debuff' })
    expect(row('jammed')).toEqual({ id: 'jammed', name: '失效', desc: '電磁傷害命中後，義體與智慧武器失效一回合。', until: 'own_turn_end', turns: 1, kind: 'debuff' })
    expect(row('marked')).toMatchObject({ mods: { hit_against: 2 }, until: 'source_turn_start' })
  })

  it('statusRuleOf 讀得到新狀態', () => {
    const a = withRules()
    expect(statusRuleOf(a.k.content, 'off_limb')).toMatchObject({ mods: { hit: -2 }, until: 'own_turn_end', turns: 1 })
    expect(statusRuleOf(a.k.content, 'off_reflex')).toMatchObject({ turnStart: { ap: -1 }, once: true })
  })
})

describe('M1b-data-rules：戰鬥裡的效果', () => {
  it('off_limb：攻擊的命中明細多一項 −2；到他下一回合結束就消失', () => {
    const a = withRules()
    const me = a.ally(1), t = a.foe(1)
    const run = a.run()
    const parts = () => run.hitParts(me, t, me.weapons[0]!)
    const before = parts().reduce((n, p) => n + p.value, 0)
    run.applyStatus(me, 'off_limb')
    expect(parts().find((p) => p.label === '義肢失效')?.value).toBe(-2)
    expect(parts().reduce((n, p) => n + p.value, 0)).toBe(before - 2)
  })

  it('boost_limb：命中 +2', () => {
    const a = withRules()
    const me = a.ally(1), t = a.foe(1)
    const run = a.run()
    run.applyStatus(me, 'boost_limb')
    expect(run.hitParts(me, t, me.weapons[0]!).find((p) => p.label === '義肢超頻')?.value).toBe(2)
  })

  it('boost_subdermal：護甲多 2，打他的傷害少 2', () => {
    const a = withRules()
    const me = a.ally(1)
    const run = a.run()
    expect(run.mods('armor', me).some((p) => p.label === '皮下裝甲超頻' && p.value === 2)).toBe(false)
    run.applyStatus(me, 'boost_subdermal')
    expect(run.mods('armor', me).find((p) => p.label === '皮下裝甲超頻')?.value).toBe(2)
  })

  it('ap_minus_1 與 off_reflex：他的下一個回合開始少 1 點行動點，然後狀態消失', () => {
    for (const id of ['ap_minus_1', 'off_reflex']) {
      const a = withRules()
      const t = a.foe(1)
      t.uses.turns = 1
      const run = a.run()
      run.applyStatus(t, id)
      t.ap.now = 0
      beginTurn(run, t)
      expect(t.ap.now, id).toBe(Math.max(0, t.ap.regen) - 1)
      expect(t.statuses.map((s) => s.id), id).toEqual([])
    }
  })

  it('off_generic、boost_generic：帶得上去，沒有任何數字上的修正', () => {
    const a = withRules()
    const me = a.ally(1), t = a.foe(1)
    const run = a.run()
    const hit = () => run.hitParts(me, t, me.weapons[0]!).reduce((n, p) => n + p.value, 0)
    const before = hit()
    expect(run.applyStatus(me, 'off_generic')).toBe(true)
    expect(run.applyStatus(me, 'boost_generic')).toBe(true)
    expect(hit()).toBe(before)
    expect(run.mods('armor', me)).toEqual([])
  })

  it('see_dark：黑暗裡攻擊的人不吃黑暗（對手的迴避不 +2）', () => {
    const a = withRules()
    const me = a.ally(1), t = a.foe(1)
    a.battle.field.dark = true
    const run = a.run()
    const ev = () => run.evadeOf(t, me).total
    const dark = ev()
    run.applyStatus(me, 'see_dark')
    expect(ev()).toBe(dark - 2)
  })

  it('untargeted：AI 不挑他；場上只剩他時照樣會挑', () => {
    const a = arena(duel([one(), one({}, 2)], [foe()]), undefined, (k) => k.content.load('battle_status', rows))
    const shy = a.ally(1)
    const run = a.run()
    run.applyStatus(shy, 'untargeted')
    const f = a.foe(1)
    expect(run.mods('ai_target_pct', shy, f).reduce((n, p) => n + p.value, 0)).toBe(-100)
    for (let i = 0; i < 30; i++) {
      const pick = run.pick([a.ally(1), a.ally(2)], (t) => (run.mods('ai_target_pct', t, f).reduce((n, p) => n + p.value, 0) <= -100 ? 0 : 1))
      expect(pick?.id).toBe('a2')
    }
  })
})
