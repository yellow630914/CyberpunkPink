// 驗收測試：dev/work/M0-fix-data.md（交給 cpp-data）。
// 工單完成前這個檔會失敗（CORE_PACK 還沒有 action_kind，creation.json 還沒有那三個欄位）。
// 跑法：在 engine/ 跑 npx vitest run --config vitest.pending.config.ts M0-fix-data
// 完成後：git mv engine/tests/pending/M0-fix-data.test.ts engine/tests/data/M0-fix-data.test.ts，主套件與 npx tsc --noEmit 都要過。

import { describe, expect, it } from 'vitest'
import type { ActionKindEntry, CreationRuleEntry } from '../../src'
import { Game, prepareAction, sanitizeJudgment } from '../../src'
import { allFeatures } from '../../src/features'
import { CORE_PACK, SOURCES } from '../../data'
import { makeActor } from '../../src/testkit'

/** AI_TASKS 3.1 節的行動種類表：id → [名字, 屬性, 基本功, DC 的檔位, 平常幾分鐘, 最多幾分鐘] */
const TABLE: Record<string, [string, string, string | null, string, number, number]> = {
  free: ['自由行動', 'intellect', null, 'normal', 30, 240],
  beg: ['乞討', 'charm', 'perform', 'normal', 60, 240],
  rumor: ['打聽', 'intellect', 'streetwise', 'normal', 60, 240],
  search: ['搜索、查證', 'intellect', 'investigate', 'normal', 30, 120],
  scavenge: ['搜刮', 'intellect', 'investigate', 'normal', 60, 240],
  tail: ['跟蹤', 'reflex', 'stealth', 'hard', 60, 240],
  pickpocket: ['扒竊', 'reflex', 'stealth', 'hard', 15, 60],
  sneak: ['潛入', 'reflex', 'stealth', 'hard', 30, 120],
  lockpick: ['撬鎖', 'tech', 'mechanics', 'normal', 15, 60],
  hack: ['駭入一台裝置', 'intellect', 'interface', 'hard', 30, 120],
  climb: ['攀爬、破門', 'body', 'athletics', 'normal', 15, 60],
  escape: ['甩掉追的人', 'reflex', 'athletics', 'hard', 15, 60],
  persuade: ['說服、拜託', 'charm', 'negotiate', 'normal', 30, 120],
  deceive: ['唬人、混進去', 'charm', 'perform', 'hard', 15, 60],
  threaten: ['威脅、逼問', 'resolve', 'intimidate', 'normal', 15, 60],
  busk: ['街頭表演', 'charm', 'perform', 'normal', 60, 240],
  repair: ['修理', 'tech', 'mechanics', 'normal', 60, 240],
  first_aid: ['急救', 'tech', 'medicine', 'normal', 10, 30],
  flirt: ['誘惑、搭訕', 'charm', 'seduce', 'normal', 30, 120],
}

/** 參考範圍裡引擎現在套得了的部分（錢與生命值）：工單「參考範圍」那張表 */
const HINTS: Record<string, Record<string, Array<{ kind: string; amount: number }>>> = {
  // free 不給現金（2026-11-22 定案，AI_TASKS 3.1 節）：參考範圍是「一則傳聞／沒有／沒有」，AI 關閉時的退路只給時間與敘述
  beg: { success: [{ kind: 'cash', amount: 20 }], narrow: [{ kind: 'cash', amount: 10 }], critical: [{ kind: 'cash', amount: 30 }] },
  pickpocket: { success: [{ kind: 'cash', amount: 30 }], narrow: [{ kind: 'cash', amount: 15 }], critical: [{ kind: 'cash', amount: 45 }] },
  busk: { success: [{ kind: 'cash', amount: 25 }], narrow: [{ kind: 'cash', amount: 10 }], critical: [{ kind: 'cash', amount: 38 }] },
  climb: { narrow: [{ kind: 'hp', amount: -2 }], fail: [{ kind: 'hp', amount: -2 }], fumble: [{ kind: 'hp', amount: -2 }] },
  escape: { narrow: [{ kind: 'hp', amount: -2 }] },
}

const entries = (): ActionKindEntry[] => (CORE_PACK.content.action_kind ?? []) as ActionKindEntry[]
const byId = () => Object.fromEntries(entries().map((e) => [e.id, e]))

describe('M0-fix-data：行動種類的資料（AI_TASKS 3.1 節）', () => {
  it('十九種，順序照表格由上到下（殺價、打工、日常直播等那三個系統搬進來再加）', () => {
    expect(entries().map((e) => e.id)).toEqual(Object.keys(TABLE))
    expect(SOURCES.action_kind).toMatch(/AI_TASKS/)
  })

  it('每一種的名字、屬性、基本功、DC、時間照表格；名字是括號前面的字，整格的原文放在 desc', () => {
    const e = byId()
    for (const [id, [name, attr, skill, dc, minutes, max]] of Object.entries(TABLE)) {
      expect(e[id], id).toMatchObject({ name, attr, dc, minutes, max_minutes: max })
      expect(e[id]!.skill ?? null, `${id} 的基本功`).toBe(skill)
      expect(String(e[id]!.desc ?? '').startsWith(name), `${id} 的 desc`).toBe(true)
    }
    expect(e.scavenge!.desc).toBe('搜刮（翻垃圾、拆廢品）')
    expect(e.sneak!.desc).toBe('潛入（現實，進一個不讓進的地方）')
  })

  it('鏈：只有誘惑寫了別的鏈（adult_action，AI_TASKS 3.5 節）；其餘不寫（走自由行動的鏈）', () => {
    expect(entries().filter((e) => e.chain !== undefined).map((e) => [e.id, e.chain])).toEqual([['flirt', 'adult_action']])
  })

  it('參考範圍（I 級）：只寫引擎現在套得了的效果（現金與生命值）；大成功是成功的一倍半（四捨五入）', () => {
    const e = byId()
    for (const id of Object.keys(TABLE)) {
      expect(e[id]!.hint ?? {}, `${id} 的 hint`).toEqual(HINTS[id] ?? {})
      expect(e[id]!.hint_by_grade, `${id} 不寫其他等級`).toBeUndefined()
    }
  })

  it('表格三格的原文都記在 hint_note（成功、勉強成功、失敗），之後那些系統搬進來再改寫成效果', () => {
    const e = byId()
    for (const id of Object.keys(TABLE)) {
      const note = e[id]!.hint_note ?? {}
      expect(Object.keys(note).sort(), id).toEqual(['fail', 'narrow', 'success'])
      for (const v of Object.values(note)) expect(typeof v === 'string' && v.trim().length > 0, id).toBe(true)
    }
    expect(e.free!.hint_note).toEqual({ success: '一則傳聞', narrow: '沒有', fail: '沒有' })
    expect(e.free!.hint).toBeUndefined()
    expect(e.sneak!.hint_note!.narrow).toBe('進得去，狀態「被記下」')
    expect(e.pickpocket!.hint_note!.fail).toBe('沒得手；被看到時那一區的勢力或市警敵對值 +3')
    expect(e.first_aid!.hint_note!.success).toMatch(/1d6 \+ 醫療等級/)
  })

  it('整包載得進去：格式、引用（基本功）、參考範圍的效果都過', () => {
    const k = new Game({ features: allFeatures(), content: [CORE_PACK] }).k
    expect(k.content.checkRefs()).toEqual([])
  })

  it('裝上所有功能：十八種可以做（free 用資料的那一筆）；誘惑先不註冊（它的鏈還沒搬進來）', () => {
    const game = new Game({ features: allFeatures(), content: [CORE_PACK], strict: true })
    const ids = game.k.actions.list().map((a) => a.id).sort()
    expect(ids).toEqual(Object.keys(TABLE).filter((id) => id !== 'flirt').sort())
    expect(game.k.actions.get('free')).toMatchObject({ owner: 'actions', name: '自由行動', attr: 'intellect', minutes: 30, maxMinutes: 240 })
    // free 的參考範圍不給現金（2026-11-22 定案）：資料沒有寫 hint，所以沒有參考範圍
    expect(game.k.actions.get('free')!.hint).toBeUndefined()
    expect(game.k.actions.get('flirt')).toBeUndefined()
  })

  it('AI 關閉時每一種都跑得完；乞討成功拿到參考範圍的一半', async () => {
    const game = new Game({ features: allFeatures(), content: [CORE_PACK], strict: true, ai: { ai: 0 } })
    game.newGame({ seed: 7, setup: () => ({ kind: 'system', action: 'creation.commit', location: {}, party: [], timeline: [], changes: [{ op: 'actor.add', actor: makeActor({ hp: 40 }) }, { op: 'pc', id: 'pc' }], outcome: { result: 'created', summary: '建角。' } }) })
    for (const id of Object.keys(TABLE).filter((x) => x !== 'flirt')) {
      const before = game.state.money.cash
      const r = await game.act({ kind: id, text: '試一次' })
      expect(r.status, id).toBe('applied')
      const degree = r.reports[0]!.outcome.result
      const cash = (HINTS[id]?.[degree === 'success' && r.reports[0]!.timeline[0]!.roll!.margin < 3 ? 'narrow' : degree] ?? []).filter((x) => x.kind === 'cash').reduce((n, x) => n + x.amount, 0)
      expect(game.state.money.cash - before, `${id} ${degree}`).toBe(Math.trunc(cash / 2))
      expect(game.state.actors.pc!.hp).toBeGreaterThanOrEqual(1)
    }
  })

  it('急救的時間上限是 30 分鐘：判定交太久被夾住時，提醒照實寫「30 分鐘」（B002）', () => {
    const game = new Game({ features: allFeatures(), content: [CORE_PACK] })
    game.newGame({ seed: 7, setup: () => ({ kind: 'system', action: 'creation.commit', location: {}, party: [], timeline: [], changes: [{ op: 'actor.add', actor: makeActor() }, { op: 'pc', id: 'pc' }], outcome: { result: 'created', summary: '建角。' } }) })
    const p = prepareAction(game.k, game.state, { kind: 'first_aid' })
    const r = sanitizeJudgment(game.k, game.state, p, { degree: p.roll.degree, minutes: 999 }, { clampAsked: true })
    expect(r.judgment!.minutes).toBe(30)
    expect(r.clamps.find((c) => c.path === 'judgment.minutes')!.notice).toBe('這件事最多花 30 分鐘。')
  })
})

describe('M0-fix-data：建角的數字補三個欄位（CHARACTER 5.4 節）', () => {
  it('creation_rule/default：起始的裝備點數 12；沒花完的義體點數每點 C$500、裝備點數每點 C$150', () => {
    const rule = (CORE_PACK.content.creation_rule as CreationRuleEntry[]).find((r) => r.id === 'default')!
    expect(rule).toMatchObject({ gear_points: 12, cyber_point_cash: 500, gear_point_cash: 150 })
    // 原本的欄位不動
    expect(rule).toMatchObject({ attr_array: [15, 14, 13, 12, 10, 8], attr_free: 2, attr_max: 18, attr_min: 4, skill_points: 10, skill_max: 3, perk_points: 4, perk_max: 8, flaw_max: 2, min_age: 18, start_money: 1500 })
  })
})
