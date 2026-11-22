// 白箱測試找到的問題（dev/bugs/2026-11-21-W001～W010）的回歸測試：十個都已經修好（M0 的修正批次（2026-11-22））。
// 每一個測試寫的是「規格期望的行為」。
// 重現資料在 engine/tests/whitebox/fixtures/<id>.json（不是 Repro 格式：要註冊掛鉤或直接呼叫函式，種子重播的格式表達不了）。

import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import type { Change, Feature, ReportDraft } from '../../src'
import { clone, commitTurn, createKernel, prepareAction, sanitizeJudgment } from '../../src'
import type { CreationDraft } from '../../src/features/creation'
import { buildCreationReport, creationFeature } from '../../src/features/creation'
import { makeGame, makeState } from '../../src/testkit'
import { MINI_PACK } from '../helpers/miniContent'

const fixture = <T = Record<string, any>>(id: string): T => JSON.parse(readFileSync(fileURLToPath(new URL(`./fixtures/${id}.json`, import.meta.url)), 'utf8')) as T
const draft = (changes: Change[], action = 'wb'): ReportDraft => ({ kind: 'system', action, location: {}, party: [], timeline: [], changes, outcome: { result: 'ok', summary: action } })
const hookFeature = (name: 'time.passed' | 'save.loaded', returns: Change[]): Feature => ({
  id: `wb_${name}`,
  install: (k) => {
    if (name === 'time.passed') k.hooks.on('time.passed', 'wb', () => [draft(returns, 'follow_up')])
    else k.hooks.on('save.loaded', 'wb', () => returns)
  },
})

describe('白箱找到的問題（已修好的回歸測試）', () => {
  // ---- W001 ----
  const w001 = fixture('W001-follow-up-fails-after-commit')
  it('W001 GAME_DESIGN 3 第 13 條、dev/invariants.md 第 3 條：game.commit 的接著提交的報告不合法時，丟錯就要狀態完全不變', () => {
    const { game } = makeGame({ seed: w001.seed, features: [hookFeature('time.passed', w001.setup.hook.returns)] })
    const before = clone(game.state)
    const c = w001.cases[0]
    expect(() => game.commit(draft(c.draft.changes, c.draft.action))).toThrow()
    expect(game.state).toEqual(before)
  })

  it('W001 AI_TASKS 2.4「回退最多 5 步」：game.commit 改了狀態，就要留下回退的那一步', () => {
    const { game } = makeGame({ seed: w001.seed, features: [hookFeature('time.passed', w001.setup.hook.returns)] })
    const c = w001.cases[0]
    expect(() => game.commit(draft(c.draft.changes, c.draft.action))).toThrow(/現金不夠/)
    const changed = game.state.reports.some((r) => r.action === c.draft.action)
    // 修法 a：整個回合是一件事，接著的報告不合法就整串不套；狀態沒變，所以也不留回退、不通知
    expect(changed).toBe(false)
    expect(game.undo.size).toBe(0)
  })

  it('W001 AI_TASKS 2.1、dev/invariants.md 第 16 條：任務鏈套用時接著的報告不合法，丟錯就要狀態完全不變（chain.ts「真的失敗時狀態完全沒變」）', async () => {
    const { game } = makeGame({ seed: w001.seed, features: [hookFeature('time.passed', w001.setup.hook.returns)] })
    const before = clone(game.state)
    await expect(game.act(w001.cases[1].input, { autoRules: true })).rejects.toThrow(/現金不夠/)
    expect(game.state).toEqual(before)
    expect(game.undo.size).toBe(0)
    expect(game.lastRun).toBeNull()
  })

  // ---- W002 ----
  it('W002 dev/invariants.md 第 1 條「任何掛鉤都不直接寫狀態」：嚴格模式要抓到 turn.end 的掛鉤偷改狀態', () => {
    const fx = fixture('W002-turn-end-hook-mutates')
    const k = createKernel()
    k.strict = fx.setup.strict
    k.hooks.on('turn.end', 'cheat', ({ state }) => { state.money.cash += 999 })
    const s = makeState({ seed: fx.seed })
    expect(() => commitTurn(k, s, draft(fx.cases[0].draft.changes, fx.cases[0].draft.action))).toThrow(/turn.end.*直接改了狀態/)
  })

  // ---- W003 ----
  it('W003 dev/invariants.md 第 6 條「讀不進來的存檔不改變現在的狀態」：讀檔修復失敗時，狀態與回退都不變', () => {
    const fx = fixture('W003-load-repair-fails')
    const { game } = makeGame({ seed: fx.seed, features: [hookFeature('save.loaded', fx.setup.hook.returns)] })
    game.commit(draft(fx.steps[0].commit))
    const raw = game.save()
    game.commit(draft(fx.steps[2].commit))
    const before = clone(game.state)
    // 回傳錯誤訊息（不丟錯）
    const result = game.load(raw)
    expect(result).toMatch(/修復沒有成功.*現金不夠/)
    expect(game.state).toEqual(before)
    expect(game.undo.size).toBe(2)
  })

  // ---- W004 ----
  const w004 = fixture('W004-rules-change-unsanitized')
  for (const c of w004.cases as Array<{ patch: Record<string, unknown> }>) {
    it(`W004 dev/invariants.md 第 6、27 條：rules 變更 ${JSON.stringify(c.patch)} 提交之後，存檔再讀檔要一模一樣`, () => {
      const { game } = makeGame({ seed: w004.seed })
      // 超出範圍的值在提交時就擋下，狀態不變
      const before = clone(game.state)
      expect(() => game.commit(draft([{ op: 'rules', patch: c.patch }]))).toThrow(/存檔規則的值超出範圍/)
      expect(game.state).toEqual(before)
      expect(game.load(game.save())).toBeNull()
      expect(game.state).toEqual(before)
    })
  }

  // ---- W005 ----
  const w005 = fixture('W005-nested-underage-commit')
  for (const changes of w005.cases as Change[][]) {
    it(`W005 AI_TASKS 3.19、dev/invariants.md 第 6、12 條：${changes[0]!.op} 放進低於 18 的年齡，提交時就要擋下`, () => {
      const { game } = makeGame({ seed: w005.seed })
      const before = clone(game.state)
      expect(() => game.commit(draft(changes))).toThrow()
      expect(game.state).toEqual(before)
    })
  }

  // ---- W006 ----
  it('W006 CORE_RULES 3「大成功對應是，而且」：免夾的判定，roll.verdict 要和成功程度一致', () => {
    const fx = fixture('W006-free-judgment-verdict')
    const k = createKernel()
    const s = makeState({ seed: fx.seed })
    const p = prepareAction(k, s, fx.input)
    expect(p.roll.degree).toBe('fail') // 前提：這一顆骰照規則是失敗
    const j = sanitizeJudgment(k, s, p, fx.judgment, { clampAsked: fx.setup.clampAsked }).judgment!
    expect(j.degree).toBe('critical')
    expect(j.roll.verdict).toBe('yes_and')
  })

  // ---- W007 ----
  it('W007 AI_TASKS 2.4「回退最多 5 步」：不成立的動作不能吃掉最舊的一步', () => {
    const { game } = makeGame({ seed: fixture('W007-undo-lost-on-failed-action').seed })
    for (let i = 0; i < 5; i++) game.commit(draft([{ op: 'counter', key: 'n', delta: 1 }], `s${i}`))
    expect(() => game.commit(draft([{ op: 'cash', delta: -1 }], 'bad'))).toThrow()
    expect(game.undo.labels()).toEqual(['s0', 's1', 's2', 's3', 's4'])
  })

  // ---- W008 ----
  it('W008 MIGRATION「敘事、狀態與介面」、shell/save.ts SaveMeta.pc「名字與出身」：建好角的存檔摘要要有出身', () => {
    const fx = fixture<{ seed: number; draft: CreationDraft }>('W008-save-meta-origin')
    const { game } = makeGame({ seed: fx.seed, scenario: 'beforeCreation', features: [creationFeature], content: [MINI_PACK] })
    game.commit(buildCreationReport(game.k, game.state, fx.draft))
    const meta = JSON.parse(game.save()).meta as { pc?: { origin?: string } }
    expect(meta.pc).toEqual({ name: '露', origin: 'hive', originName: '蜂巢' })
  })

  // ---- W009 ----
  it('W009 shell/game.ts undoSteps「沒有那麼多步回傳 false」：n 不是整數時回傳 false、什麼都不動', () => {
    const { game } = makeGame({ seed: fixture('W009-undo-non-integer').seed })
    game.commit(draft([]))
    game.commit(draft([]))
    const before = clone(game.state)
    expect(game.undoSteps(1.5)).toBe(false)
    expect(game.state).toEqual(before)
  })

  // ---- W010 ----
  it('W010 AI_TASKS 2.5「正文寫的就是實際拿到的東西」：扣錢超過手上有的時，定案的結果寫實際扣的數字', () => {
    const fx = fixture('W010-money-line-vs-change')
    const k = createKernel()
    const s = makeState({ seed: fx.seed, patch: { money: fx.setup.money } })
    const r = k.effects.resolve(fx.effects, { state: s, actor: 'pc', grade: 1, source: 'ai', clampAsked: true, content: k.content })
    expect(r.changes).toEqual([{ op: 'cash', delta: -30 }])
    expect(r.lines).toEqual(['失去：現金 30'])
    expect(r.effects).toEqual([{ kind: 'cash', amount: -30 }])
    // 付不出來的那一段留一則提醒
    expect(r.clamps).toEqual([{ path: 'effects[0]', from: -100, to: -30, limit: 30, notice: '你身上的現金只有 30 元，實際少了 30 元。' }])
  })
})
