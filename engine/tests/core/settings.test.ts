import { describe, expect, it } from 'vitest'
import { DEFAULT_AI_SETTINGS, FakeProvider, ProviderHub, retriesFor, sanitizeAiSettings } from '../../src'
import type { Provider } from '../../src'

// 規格：AI_TASKS 2.5 節（clamp_asked 預設開）、5.3 節（重試 0～3，預設 1）；設定的形狀沿用 cpp-ai-v1（docs/mockups/settings.html 的 AI0）
describe('L7 AI 的設定', () => {
  it('cpp-ai-v1 的物件原樣收：開關存的是 0／1', () => {
    const AI0 = { ai: 1, judge_free: 1, judge_work: 1, judge_other: 1, clamp_asked: 1, narrate: 1, trade_text: 1, combat_text: 0, polish: {}, sexrec: 1, bg_flavor_shop: 1, bg_flavor_roster: 1, bg_npc_news: 1, bg_stream_goal: 1, bg_stream_chat: 1, bg_footage_caption: 1, agent: 0, query_only: 0, hook_text: 1, hook_block: 1, hook_night: 1, hook_comm: 1, hook_shop: 1, lim_hook: 1, lim_visit: 10, lim_event: 3, lim_night: 10, lim_comm: 10, lim_shop: 10, chainbar: 0, retry: {}, src: {}, fb: {}, adult: {} }
    expect(sanitizeAiSettings(AI0)).toEqual(DEFAULT_AI_SETTINGS)
    expect(Object.keys(DEFAULT_AI_SETTINGS).sort()).toEqual(Object.keys(AI0).sort())
  })

  it('預設：AI 開、玩家要求的結果也夾值、Agent 關', () => {
    const s = sanitizeAiSettings(undefined)
    expect(s).toMatchObject({ ai: true, clamp_asked: true, agent: false, narrate: true })
    expect(sanitizeAiSettings('亂七八糟')).toEqual(s)
  })

  it('壞的值用預設值；重試的次數夾在 0～3', () => {
    const s = sanitizeAiSettings({ ai: 0, clamp_asked: 'no', lim_event: -4, retry: { judge: 9, reward: -1, narrate: 2, bad: 'x' }, src: { judge: '便宜的小模型', bad: 5 }, polish: { free: 1, move: 0, bad: 'x' } })
    expect(s.ai).toBe(false)
    expect(s.clamp_asked).toBe(true)
    expect(s.lim_event).toBe(0)
    expect(s.retry).toEqual({ judge: 3, reward: 0, narrate: 2 })
    expect(s.src).toEqual({ judge: '便宜的小模型' })
    expect(s.polish).toEqual({ free: true, move: false })
    expect(retriesFor(s, 'judge')).toBe(3)
    expect(retriesFor(s, 'relate')).toBe(1)
  })

  it('服務商的總管：總開關關著沒有服務商；有金鑰而且那一家接上了才用真的；否則用假的', () => {
    const fake = new FakeProvider()
    const real = { source: { name: '主力', provider: 'anthropic', model: 'm' }, supports: { structured: true, tools: true }, request: fake.request.bind(fake) } as Provider
    const on = sanitizeAiSettings({ ai: 1, src: { reward: '主力' } })
    const hub = new ProviderHub({ 主力: { name: '主力', provider: 'anthropic', model: 'm', apiKey: 'k' }, 便宜的小模型: { name: '便宜的小模型', provider: 'openai', model: 's' } }, fake)
    expect(hub.resolve(sanitizeAiSettings({ ai: 0 }), 'judge')).toBeNull()
    // 還沒有任何一家接上（M0）：有金鑰也用假的
    expect(hub.resolve(on, 'judge')).toBe(fake)
    hub.factories.anthropic = () => real
    expect(hub.resolve(on, 'judge')).toBe(real)
    expect(hub.resolve(on, 'reward')).toBe(real)
    // 那個來源沒有金鑰：用假的
    expect(hub.resolve(on, 'relate')).toBe(fake)
    expect(hub.sourceNameFor(on, 'relate')).toBe('便宜的小模型')
    expect(hub.sourceNameFor(on, 'scene_turn')).toBe('主力')
    // 沒有給假的服務商：走退路
    expect(new ProviderHub({}, null).resolve(on, 'judge')).toBeNull()
  })
})
