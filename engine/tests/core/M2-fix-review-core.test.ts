// 驗收測試：dev/work/M2-fix-review.md 裡屬於核心與外殼的幾項（應修 4：成人路由接到服務商；turn.end 帶這一回合的每一份報告）。
// 內容一律用測試自帶的最小假資料；AI 用假的服務商（FakeProvider）。

import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import type { Change, ContentPack, Provider, ProviderSource, ReportDraft } from '../../src'
import { ADULT_SOURCE_KEY, ContentError, FakeProvider, Game, ProviderHub, compareNatural, compareText, sanitizeAiSettings } from '../../src'
import { CORE_PACK } from '../../data'
import { allFeatures } from '../../src/features'
import { makeGame } from '../../src/testkit'

const draft = (changes: Change[], action = 'test.note', extra: Partial<ReportDraft> = {}): ReportDraft => ({
  kind: 'system', action, location: {}, party: [], timeline: [], changes, outcome: { result: 'ok', summary: `${action}。` }, ...extra,
})
const spend = (extra: Partial<ReportDraft> = {}): ReportDraft => draft([{ op: 'cash', delta: -50 }, { op: 'time', minutes: 30 }], 'trade.checkout', { kind: 'deal', timeline: [{ layer: 'meat', text: '你付了錢。' }], ...extra })

const SRC = (name: string, provider: ProviderSource['provider']): ProviderSource => ({ name, provider, model: `m-${name}`, apiKey: 'k' })
/** 每一家各有自己的假服務商：看請求落在哪一家。 */
function twoSources() {
  const general = new FakeProvider()
  const adult = new FakeProvider()
  const hub = new ProviderHub({ 主力: SRC('主力', 'anthropic'), 成人主力: SRC('成人主力', 'openai') }, null)
  hub.factories.anthropic = () => general
  hub.factories.openai = () => adult
  return { general, adult, hub }
}

describe('應修 4：成人路由接到服務商（AI_TASKS 第 1 節第 9 條：走哪個模型由引擎看狀態決定）', () => {
  it('ProviderHub.resolve：adult 的請求看設定的 adult 表（寫正文與潤色共用 narrate_adult）；沒有指定就和一般的來源一樣', () => {
    const { general, adult, hub } = twoSources()
    const s = sanitizeAiSettings({ ai: 1, src: { narrate: '主力' }, adult: { narrate_adult: '成人主力' } })
    expect(hub.resolve(s, 'narrate')).toBe(general)
    expect(hub.resolve(s, 'narrate', { adult: false })).toBe(general)
    expect(hub.resolve(s, 'narrate', { adult: true })).toBe(adult)
    expect(hub.resolve(s, 'polish', { adult: true })).toBe(adult)
    // 一般的任務不受影響；沒有指定成人來源的任務，成人請求用一般的來源
    expect(hub.resolve(s, 'judge', { adult: true })).toBe(general) // 預設主力
    const none = sanitizeAiSettings({ ai: 1, src: { narrate: '主力' } })
    expect(hub.resolve(none, 'narrate', { adult: true })).toBe(general)
    expect(hub.sourceNameFor(s, 'narrate', { adult: true })).toBe('成人主力')
    expect(hub.sourceNameFor(s, 'narrate')).toBe('主力')
  })

  it('成人路由的五個來源：場景的三個任務共用 scene、收尾的三個共用 aftercare；表裡沒有的任務用自己的 id 當鍵', () => {
    expect(ADULT_SOURCE_KEY).toMatchObject({ narrate: 'narrate_adult', scene_gate: 'scene', scene_turn: 'scene', scene_talk: 'scene', sex_record: 'aftercare', sink: 'aftercare', tendency: 'aftercare', npc_news: 'npc_news_adult', image: 'image_adult' })
    const { hub } = twoSources()
    const s = sanitizeAiSettings({ ai: 1, adult: { scene: '成人主力', aftercare: '成人主力', 另一個任務: '成人主力' } })
    for (const t of ['scene_gate', 'scene_turn', 'scene_talk', 'sex_record', 'sink', 'tendency', '另一個任務']) expect(hub.sourceNameFor(s, t, { adult: true }), t).toBe('成人主力')
    expect(hub.sourceNameFor(s, 'scene_turn')).toBe('主力')
  })

  it('成人路由的來源沒有金鑰（或那一家沒接上）：照一般的規矩用假的服務商或走退路，不會落到別家', () => {
    const general = new FakeProvider()
    const fake = new FakeProvider()
    const hub = new ProviderHub({ 主力: SRC('主力', 'anthropic'), 成人主力: { name: '成人主力', provider: 'openai', model: 'x' } }, fake)
    hub.factories.anthropic = () => general
    const s = sanitizeAiSettings({ ai: 1, src: { narrate: '主力' }, adult: { narrate_adult: '成人主力' } })
    expect(hub.resolve(s, 'narrate', { adult: true })).toBe(fake)
    expect(new ProviderHub({ 主力: SRC('主力', 'anthropic') }, null).resolve(sanitizeAiSettings({ ai: 1, adult: { narrate_adult: '不存在' } }), 'narrate', { adult: true })).toBeNull()
  })

  it('整條鏈：草稿帶 adult 的寫正文請求落在成人來源，不帶的落在一般來源（請求的 adult 記號照舊）', async () => {
    const { game } = makeGame({ scenario: 'withMoney', ai: { ai: 1, src: { narrate: '主力' }, adult: { narrate_adult: '成人主力' } }, fake: true })
    const { general, adult } = twoSources()
    game.hub.sources = { 主力: SRC('主力', 'anthropic'), 成人主力: SRC('成人主力', 'openai') }
    game.hub.factories.anthropic = () => general as Provider
    game.hub.factories.openai = () => adult as Provider
    const a = await game.commitNarrated(spend({ adult: true }), { mode: 'new' })
    expect(a.status).toBe('applied')
    expect(adult.requestsFor('narrate')).toHaveLength(1)
    expect(adult.requestsFor('narrate')[0]!.adult).toBe(true)
    expect(general.requests).toHaveLength(0)
    const b = await game.commitNarrated(spend(), { mode: 'new' })
    expect(b.status).toBe('applied')
    expect(general.requestsFor('narrate')).toHaveLength(1)
    expect(general.requestsFor('narrate')[0]!.adult).toBeUndefined()
    expect(adult.requests).toHaveLength(1)
  })
})

describe('turn.end 帶這一回合提交的每一份報告（導演收集觸發點用）', () => {
  it('reports 的第一份是行動自己（和 report 是同一份），後面是 report.after 的掛鉤接著提交的', () => {
    const { game } = makeGame({ scenario: 'withMoney' })
    game.k.hooks.on('report.after', 'follow', ({ report }) => (report.action === 'test.first' ? [draft([], 'test.follow', { triggers: [{ point: 'late' }] })] : undefined))
    let seen: Array<{ action?: string; triggers?: unknown }> = []
    game.k.hooks.on('turn.end', 'watch', ({ report, reports }) => {
      seen = reports.map((r) => ({ action: r.action, triggers: r.triggers }))
      expect(reports[0]).toBe(report)
      return undefined
    })
    game.commit(draft([], 'test.first'))
    expect(seen).toEqual([{ action: 'test.first', triggers: undefined }, { action: 'test.follow', triggers: [{ point: 'late' }] }])
  })
})

describe('建議 1：會影響抽籤順序的排序不看語系', () => {
  it('compareText 照字元碼：和語系無關（捷克語系的 localeCompare 會把 ch 排在 h 後面，這裡不會）', () => {
    expect(['h', 'ch', 'b', 'a_b', 'ab', 'B', '10', '9'].sort(compareText)).toEqual(['10', '9', 'B', 'a_b', 'ab', 'b', 'ch', 'h'])
    expect(compareText('a', 'a')).toBe(0)
    expect(compareText('a', 'b')).toBeLessThan(0)
    expect(compareText('ch', 'h')).toBeLessThan(0)
    // 對照：同一個比較交給捷克語系的排序規則，結果反過來
    expect(new Intl.Collator('cs').compare('ch', 'h')).toBeGreaterThan(0)
  })

  it('compareNatural：數字照大小（u2 在 u10 前）、其餘照字元碼；兩個不同的 id 不會比出 0', () => {
    expect(['u10', 'u2', 'u1', 'e3', 'u2b', 'u02'].sort(compareNatural)).toEqual(['e3', 'u1', 'u2', 'u2b', 'u02', 'u10'])
    expect(compareNatural('u2', 'u02')).toBeLessThan(0) // 同一個數字、寫法不同：位數少的在前，不比出 0
    expect(compareNatural('u2', 'u2')).toBe(0)
    expect(compareNatural('u', 'u1')).toBeLessThan(0)
    expect(compareNatural('ch1', 'h1')).toBeLessThan(0)
  })

  it('engine/src 裡不再用 localeCompare（除了說明它的那一份註解）', () => {
    const SRC = fileURLToPath(new URL('../../src', import.meta.url))
    const walk = (dir: string): string[] => readdirSync(dir).flatMap((n) => (statSync(join(dir, n)).isDirectory() ? walk(join(dir, n)) : n.endsWith('.ts') ? [join(dir, n)] : []))
    const code = (text: string): string => text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '').replace(/\/\/ .*$/gm, '')
    const bad = walk(SRC).filter((f) => /\.localeCompare\(/.test(code(readFileSync(f, 'utf8'))))
    expect(bad).toEqual([])
  })
})

describe('M2-ui-people：npc 是可以被後載入的包取代的種類（dev/adr/0017 補記）', () => {
  const original = (CORE_PACK.content as Record<string, Array<Record<string, unknown>>>).npc!.find((n) => n.id === 'npc_lian')!
  const mine = (npc: Array<Record<string, unknown>>): ContentPack => ({ id: 'mine', content: { npc } as unknown as ContentPack['content'] })

  it('後載入的包同一個 id 整筆取代核心包的那一位（不是合併）；沒有被蓋到的人照舊在；refs 沒有斷', () => {
    const copy: Record<string, unknown> = { ...structuredClone(original), name: '阿蓮（示意版）' }
    delete copy.note
    const g = new Game({ features: allFeatures(), content: [CORE_PACK, mine([copy])] })
    expect(g.k.content.isOverridable('npc')).toBe(true)
    expect(g.k.content.get('npc', 'npc_lian')).toMatchObject({ name: '阿蓮（示意版）' })
    expect(g.k.content.get('npc', 'npc_lian')).not.toHaveProperty('note')
    expect(g.k.content.has('npc', 'npc_ray')).toBe(true)
    expect(g.k.content.checkRefs()).toEqual([])
  })

  it('取代的那一筆也要過檢查（不合格整包不收）；同一個包裡 id 重複照舊擋下', () => {
    expect(() => new Game({ features: allFeatures(), content: [CORE_PACK, mine([{ id: 'x_lian', name: '壞的' }])] })).toThrow(ContentError)
    const dup = { ...structuredClone(original), name: '重複' }
    expect(() => new Game({ features: allFeatures(), content: [CORE_PACK, mine([dup, dup])] })).toThrow(/重複/)
  })
})
