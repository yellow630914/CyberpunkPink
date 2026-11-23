// 測試基礎建設：狀態工廠（dev/test-harness.md 第 1 節）。用最少的資料建立合法的遊戲狀態，不讀完整的內建世界。
// 預設情境：空房間、一位主角、固定種子。ElondiaRPG 約 200 個測試檔靠「人類戰士＋真實資料」建狀態，這裡不走那條路。

import type { Actor, GameState } from '../core/types'
import { blankState } from '../core/state/blank'
import { validateActor } from '../core/state/coreChanges'
import type { Feature, Kernel } from '../core/kernel'
import { createKernel } from '../core/kernel'
import type { StateKernel } from '../core/state/kernel'
import { createStateKernel } from '../core/state/kernel'
import type { ContentPack } from '../core/content/registry'
import { FakeProvider } from '../shell/ai/fakeProvider'
import type { FakeProviderOpts } from '../shell/ai/fakeProvider'
import type { Provider } from '../shell/ai/provider'
import { Game } from '../shell/game'
import { snapshotText, validateState } from '../shell/save'

/** 測試的固定種子。 */
export const TEST_SEED = 7

/**
 * 只有核心、沒有外殼的測試用的序列化函式（變更 snapshot.take 存快照要用；dev/adr/0016 第二節）：和 Game 注入的是同一個，
 * 寫出來的文字可以直接交給 unpackSave、Game.rewind。makeGame 建的 Game 自己就帶了，不必另外給。
 */
export const TEST_SERIALIZE: (state: GameState) => string = snapshotText

/** createKernel 加上 TEST_SERIALIZE（核心的測試要存快照時用；功能照 createKernel 一樣給）。嚴格模式不開，要的自己開。 */
export function makeKernel(features: Feature[] = []): Kernel {
  const k = createKernel(features)
  k.serialize = TEST_SERIALIZE
  return k
}

/** createStateKernel 加上 TEST_SERIALIZE：只測 L3（提交、變更）的測試用。 */
export function makeStateKernel(): StateKernel {
  const k = createStateKernel()
  k.serialize = TEST_SERIALIZE
  return k
}

export type ActorOverrides = Partial<Omit<Actor, 'attrs' | 'skills' | 'ext'>> & { attrs?: Partial<Actor['attrs']>; skills?: Actor['skills']; ext?: Actor['ext'] }

/** 一個合法的角色：25 歲，六項屬性都是 10，沒有基本功與特質。 */
export function makeActor(o: ActorOverrides = {}): Actor {
  const a: Actor = {
    id: 'pc', name: '測試主角', role: 'pc', age: 25, gender: 'female',
    perks: [], hp: 40, load: 0, afterglow: 0, sink: 0, conditions: [],
    ...o,
    attrs: { body: 10, reflex: 10, tech: 10, intellect: 10, resolve: 10, charm: 10, ...o.attrs },
    skills: { ...o.skills },
    ext: { ...o.ext },
  }
  const problems = validateActor(a)
  if (problems.length) throw new Error(`makeActor 做出不合法的角色：${problems.join('；')}`)
  return a
}

export interface StateOverrides {
  seed?: number
  /** 主角；給 false 就是還沒建角 */
  pc?: ActorOverrides | false
  /** 其他角色（夥伴、NPC） */
  actors?: Actor[]
  /** 直接蓋掉狀態最外層的欄位（time、money、location、flags、inventory、rules、ext……） */
  patch?: Partial<GameState>
}

/** 空房間、一位主角、固定種子。 */
export function makeState(o: StateOverrides = {}): GameState {
  const s = blankState(o.seed ?? TEST_SEED)
  s.location = { district: 'test', block: 'empty_room', scene: '一個空房間' }
  if (o.pc !== false) {
    const pc = makeActor(o.pc)
    s.actors[pc.id] = pc
    s.pc = pc.id
    s.party = [pc.id]
  }
  for (const a of o.actors ?? []) {
    s.actors[a.id] = a
    if (a.role === 'companion') s.party.push(a.id)
  }
  Object.assign(s, o.patch)
  const problems = validateState(s)
  if (problems.length) throw new Error(`makeState 做出不合法的狀態：${problems.join('；')}`)
  return s
}

/**
 * 具名的情境。目前只有核心用得到的；戰鬥、委託副本、成人場景、輿論戰的情境等那些系統搬進來的批次再加
 * （一般遭遇與首領戰 M1、委託副本的第一階段與成人場景 M2、輿論戰 M5），加在這張表裡。
 */
export const SCENARIOS = {
  /** 空房間、一位主角 */
  emptyRoom: (o: StateOverrides = {}) => makeState(o),
  /** 還沒建角 */
  beforeCreation: (o: StateOverrides = {}) => makeState({ ...o, pc: false }),
  /** 手上有錢的主角（帳戶 1,000、現金 500） */
  withMoney: (o: StateOverrides = {}) => makeState({ ...o, patch: { money: { cred: 1000, cash: 500 }, ...o.patch } }),
  /** 專精的主角：魅力 18、交涉 3 */
  specialist: (o: StateOverrides = {}) => makeState({ ...o, pc: { attrs: { charm: 18 }, skills: { negotiate: 3 }, ...(o.pc || {}) } }),
} satisfies Record<string, (o?: StateOverrides) => GameState>
export type ScenarioId = keyof typeof SCENARIOS

export interface GameSetup extends StateOverrides {
  scenario?: ScenarioId
  features?: Feature[]
  content?: ContentPack[]
  /** AI 的設定；沒給就是 AI 關閉（冒煙測試的基準） */
  ai?: Record<string, unknown>
  /** 假的服務商：給設定就建一個；給 true 用自動模式 */
  fake?: FakeProviderOpts | true | Provider
  idleTimeoutMs?: number
}

export interface TestGame {
  game: Game
  /** 假的服務商（有給 fake 才有） */
  fake: FakeProvider | null
}

/**
 * 一局可以直接動的遊戲：嚴格模式、固定的時鐘、狀態來自工廠。
 * 沒有給 ai 就是 AI 關閉；給了 fake 而沒有給 ai 就是 AI 開著、接假的服務商。
 */
export function makeGame(o: GameSetup = {}): TestGame {
  const provider: Provider | null = o.fake === undefined ? null : o.fake === true ? new FakeProvider() : 'request' in o.fake ? o.fake : new FakeProvider(o.fake)
  const fake = provider instanceof FakeProvider ? provider : null
  let tick = 0
  const game = new Game({
    features: o.features, content: o.content, strict: true,
    ai: o.ai ?? { ai: provider ? 1 : 0 }, fakeProvider: provider,
    now: () => (tick += 10), idleTimeoutMs: o.idleTimeoutMs ?? 200,
  })
  game.newGame({ seed: o.seed ?? TEST_SEED, rules: o.patch?.rules })
  // 工廠的狀態直接放進去（測試的起點不是一個「行動」）；之後的每一個變化都經過提交報告
  const s = SCENARIOS[o.scenario ?? 'emptyRoom'](o)
  Object.assign(game.state, { ...s, reports: game.state.reports, seq: game.state.seq, rules: { ...game.state.rules, ...o.patch?.rules } })
  game.undo.clear()
  return { game, fake }
}
