// 測試基礎建設：具名的情境與小工具（dev/test-harness.md 第 1 節；dev/work/M2-smoke.md 第 2 點）。
//
//   makeWorldGame()       帶著 TEST_WORLD 與全部功能（可以用 without 拿掉幾個）的一局，什麼情境的步驟都沒有做
//   makeCityGame()        建好角色、站在起點的街區（塔下）、租了住處
//   makeCommissionGame()  已經接案、隊伍兩個人、站在委託地點（市場）；還沒出發
//   walkTo、passTime、untilIdle   小工具：走到版面上的一個標記、讓時間過去、把引擎開起來的事件與場景用第一個選項走完
//
// 全部走真正的功能與真正的提交（和介面用的是同一條路）；只有主角的武器用 TEST_GEAR 補（假兵種一碰就倒，冒煙不測裝備的組裝）。
// AI 一律關著；要接假的服務商就給 fake。

import { CORE_PACK } from '../../data'
import type { ContentPack } from '../core/content/registry'
import type { Feature } from '../core/kernel'
import { createKernel } from '../core/kernel'
import type { GameState, Report, ReportDraft } from '../core/types'
import { allFeatures } from '../features'
import { accept, board } from '../features/fixer'
import { chooseOption, eventView } from '../features/director'
import { join, muster } from '../features/roster'
import { rentDraft } from '../features/rest'
import { sceneAct, sceneRawOf } from '../features/scene'
import { arrive } from '../features/world'
import type { Game } from '../shell/game'
import { playOut } from './battle'
import { playNetOut } from './netPlay'
import type { ActorOverrides, GameSetup, TestGame } from './factory'
import { makeActor, makeGame } from './factory'
import { TEST_GEAR, testWorld, worldFor } from './world'
import { TEST_NET_OFFER } from './worldNet'

// ---- 帶著假世界的一局 ----

export interface WorldGameSetup extends GameSetup {
  /** 拿掉這幾個功能（id）：它們的內容種類與引用它們的內容跟著濾掉（worldFor） */
  without?: string[]
  /** 不要主角的武器（TEST_GEAR）；預設有 */
  noGear?: boolean
  /** 不載資料的規則表（engine/data 的 *_rule、戰鬥的狀態與傷害類型、行動種類、設施種類）與技能表；預設載（假世界只有內容，規則表在資料裡，和真的一局一樣） */
  noRules?: boolean
  /**
   * 先載入的包（例：資料的規則表加技能表）。假世界載在後面：規則表（可被取代的種類）由假世界蓋掉，
   * 其餘種類（技能……）假世界裡 id 一樣的筆濾掉，用先載入的那一份。
   */
  base?: ContentPack[]
  /** 用這一包當假世界（預設 TEST_WORLD；M4 的是 worldBody.ts 的 bodyWorld()）。每次要給新的複本 */
  world?: ContentPack
}

export interface WorldGame extends TestGame {
  /** 因為拿掉功能而被濾掉的內容種類 */
  dropped: string[]
  /** 因為引用的東西跟著不見而被濾掉的幾筆（種類/id） */
  droppedEntries: string[]
}

/** 全部功能（FEATURES 的總表）加上主角的武器；without 的拿掉。 */
export function worldFeatures(without: string[] = [], gear = true): Feature[] {
  const all = allFeatures().filter((f) => !without.includes(f.id))
  return gear ? [...all, TEST_GEAR, TEST_NET_OFFER] : all
}

/**
 * 資料的規則表加技能表（engine/data 的 CORE_PACK 裡可被取代的種類，加 skill：規則表引用它）：假世界載在它後面，同 id 的規則（例：事件範圍 street）由假世界蓋掉。
 * 沒有人定義的種類（拿掉功能之後）與引用跟著斷掉的筆濾掉。
 */
export function dataRules(features: Feature[]): ContentPack {
  const kernel = createKernel(features)
  const content: ContentPack['content'] = {}
  for (const [kind, entries] of Object.entries(CORE_PACK.content)) if (kind === 'skill' || kernel.content.isOverridable(kind)) content[kind] = entries
  return worldFor(features, { id: 'data_rules', content }).pack
}

/** 帶著 TEST_WORLD 與全部功能的一局：只有工廠的狀態（空房間、一位主角），沒有任何情境的步驟。 */
export function makeWorldGame(o: WorldGameSetup = {}): WorldGame {
  const features = worldFeatures(o.without, o.noGear !== true)
  const { pack, dropped, droppedEntries } = worldFor(features, o.world ?? testWorld())
  const base = [...(o.noRules ? [] : [dataRules(features)]), ...(o.base ?? [])]
  if (base.length > 0) {
    const kernel = createKernel(features)
    const have = new Set(base.flatMap((p) => Object.entries(p.content).flatMap(([kind, es]) => (kernel.content.isOverridable(kind) ? [] : es.map((e) => `${kind}/${e.id}`)))))
    for (const [kind, es] of Object.entries(pack.content)) pack.content[kind] = es.filter((e) => !have.has(`${kind}/${e.id}`))
  }
  const { without: _without, noGear: _noGear, noRules: _noRules, base: _base, world: _world, ...rest } = o
  const t = makeGame({ ...rest, features: [...features, ...(o.features ?? [])], content: [...base, pack, ...(o.content ?? [])] })
  return { ...t, dropped, droppedEntries }
}

// ---- 具名的情境 ----

/** 橋參數（lewd 的預設值）：工廠做的主角沒有走建角，沒有它的話第一次讀檔會被補上一份（save.repair），讀檔前後的狀態就不一樣。 */
const BRIDGE = { sensitivity: 30, tolerance: 30, craving: 30, docility: 30 }

/** 一般的市民：不特別強。 */
export const CITY_PC: ActorOverrides = { attrs: { body: 12, charm: 12 }, skills: { negotiate: 2, stealth: 2 }, ext: { bridge: BRIDGE } }
/** 強到只有自然 1 會失敗的主角（委託副本的檢定與打贏假兵種用）。 */
export const STRONG_PC: ActorOverrides = {
  attrs: { tech: 20, intellect: 20, body: 20, reflex: 20, charm: 20 },
  skills: { mechanics: 5, interface: 5, athletics: 5, stealth: 3, negotiate: 3, investigate: 3, streetwise: 3 },
  ext: { bridge: BRIDGE },
}

export const CITY_START = { block: 'tw_tower', at: 'E1' } as const
export const CITY_HOME = 'r_tw_unit'
export const FIXER = 'fx_tw_broker'
export const RUNNER = 'a_tw_runner'
/** 城市情境的起點時間：第 6 天（星期日）上午 10:00，離週一 06:00 還有二十個小時。 */
export const SUNDAY_MORNING = { day: 6, hour: 10, minute: 0 }

export interface CityOptions extends WorldGameSetup {
  /** 主角（預設 CITY_PC） */
  pc?: ActorOverrides
  /** 不租住處 */
  noHome?: boolean
}

/** 建好角色、站在起點的街區（塔下的西口）、租了住處（四號塔的單位，週租 100，押金從帳戶付）；星期日上午 10:00，帳戶 500、現金 300。 */
export function makeCityGame(o: CityOptions = {}): WorldGame {
  const { pc, noHome, patch, ...rest } = o
  const t = makeWorldGame({
    ...rest, pc: pc ?? CITY_PC,
    patch: { time: { ...SUNDAY_MORNING }, money: { cred: 500, cash: 300 }, ...patch },
  })
  const { game } = t
  game.commit(arrive(game.k, game.state, CITY_START.block, CITY_START.at))
  if (!noHome) game.commit(rentDraft(game.k, game.state, CITY_HOME))
  return t
}

export interface CommissionGame extends WorldGame {
  /** 手上那一件委託的 id（中間人桌上第一件，付現金） */
  job: string
  fixer: string
  /** 名冊上、同隊的行者 */
  runner: string
}

export interface CommissionOptions extends WorldGameSetup {
  pc?: ActorOverrides
  /** 付法（預設現金） */
  pay?: 'cash' | 'cred' | 'favor'
}

/** 副本的一個行者夥伴：身上帶路數（槍手二階），名冊與召集認得。 */
export function makeRunner(id = RUNNER) {
  return makeActor({ id, name: '行者安', role: 'npc', ext: { paths: [{ path: 'p_gun', slot: 'main', tier: 2 }] } })
}

/**
 * 已經接案（中間人桌上的第一件、付現金）、隊伍兩個人（主角加名冊上的行者，行者拿分紅）、站在委託地點（市場的西口）；還沒出發。
 * 強主角、第 3 天上午 10:00、帳戶 500、現金 1,000。
 */
export function makeCommissionGame(o: CommissionOptions = {}): CommissionGame {
  const { pc, pay, patch, actors, ...rest } = o
  const t = makeWorldGame({
    seed: 6, ...rest, pc: pc ?? STRONG_PC, actors: [makeRunner(), ...(actors ?? [])],
    patch: { time: { day: 3, hour: 10, minute: 0 }, money: { cred: 500, cash: 1000 }, ...patch },
  })
  const { game } = t
  game.commit(arrive(game.k, game.state, 'tw_market', 'E1'))
  const row = board(game.k, game.state, FIXER).offers[0]
  if (!row) throw new Error('makeCommissionGame：中間人桌上沒有委託')
  game.commit(accept(game.k, game.state, { id: row.id, fixer: FIXER }, { pay: pay ?? 'cash' }))
  game.commit(join(game.k, game.state, RUNNER, { pay: 'share' }))
  game.commit(muster(game.k, game.state, { party: [RUNNER], tagalong: [] }))
  return { ...t, job: row.id, fixer: FIXER, runner: RUNNER }
}

// ---- 小工具 ----

type Cell = [number, number]

/** 現在站的這張版面上，標記（F1、E2、T3……）在哪一格。找不到丟錯。 */
export function markerAt(game: Game, marker: string): Cell {
  const at = game.state.maps.at
  if (!at) throw new Error('markerAt：現在不在任何一張地圖上')
  const def = game.k.content.get<{ id: string; sheets?: Array<{ id: string; cells?: Array<{ id: string; at: Cell }> }> }>('special_map', game.state.maps.instances[at.map]!.def)
  const cell = def?.sheets?.find((s) => s.id === at.sheet)?.cells?.find((c) => c.id === marker)
  if (!cell) throw new Error(`markerAt：這張版面上沒有標記 ${marker}`)
  return [...cell.at] as Cell
}

/** 走到版面上的一個標記（或一格座標）。走不過去丟錯（寫出原因）；回傳這一步的報告（路上開的事件與戰鬥也在裡面）。 */
export function walkTo(game: Game, to: string | Cell): Report[] {
  const target = typeof to === 'string' ? markerAt(game, to) : to
  const r = game.gridMove(target)
  if (r.status !== 'applied') throw new Error(`walkTo：走不過去（${r.reason ?? '沒有原因'}）`)
  return r.reports
}

/** 穿過這條街：走到離現在最遠的那個出口（E1 或 E2；一整條街 13 格，一定經過一個「每走十格」的觸發點）。 */
export function walkAcross(game: Game): Report[] {
  const here = game.gridView()
  if (!here) throw new Error('walkAcross：現在不在街上')
  const dist = (m: string): number => {
    const [x, y] = markerAt(game, m)
    return Math.abs(x - here.at[0]) + Math.abs(y - here.at[1])
  }
  return walkTo(game, dist('E1') >= dist('E2') ? 'E1' : 'E2')
}

/** 讓時間過去（分鐘）：一份只有 time 變更的報告，走一般的提交（時間點的掛鉤照跑：帳單、導演的 daily 與 weekly……）。 */
export function passTime(game: Game, minutes: number, summary = '時間過去了。'): Report[] {
  const d: ReportDraft = { kind: 'action', action: 'test.wait', location: { ...game.state.location }, party: [], timeline: [], changes: [{ op: 'time', minutes }], outcome: { result: 'ok', summary } }
  return game.commit(d)
}

const minutesOf = (t: GameState['time']): number => t.day * 1440 + t.hour * 60 + t.minute

/** 讓時間過到指定的時刻（同一天的幾點幾分）；已經過了丟錯。 */
export function passUntil(game: Game, time: { day: number; hour: number; minute?: number }): Report[] {
  const left = minutesOf({ minute: 0, ...time }) - minutesOf(game.state.time)
  if (left < 0) throw new Error('passUntil：那個時刻已經過了')
  return passTime(game, left)
}

/** 把一場戰鬥打完（雙方程式選動作；內海的戰鬥我方照 playNetOut）並結算；沒有戰鬥就什麼都不做。回傳結果與結算的報告。 */
export async function fightOut(game: Game): Promise<{ outcome: string; reports: Report[] } | null> {
  if (!game.battle) return null
  const { outcome } = game.battle.mode === 'net' ? playNetOut(game) : playOut(game)
  const done = await game.finishBattle()
  return { outcome, reports: done.reports }
}

export interface IdleLog {
  /** 做了幾件事 */
  steps: number
  /** 每一步做了什麼（給失敗時看） */
  log: string[]
}

/**
 * 把引擎開起來的事件與場景用第一個選項走完：事件視窗選第一個選得了的選項、成人場景選「停下」、戰鬥打到分出結果並結算；
 * 一直做到沒有活動為止（最多 maxSteps 步，超過丟錯：多半是兩個活動在互相開）。等著選的戰敗不處理（要玩家自己接受、重來或回到階段）。
 */
export async function untilIdle(game: Game, maxSteps = 30): Promise<IdleLog> {
  const log: string[] = []
  for (let steps = 0; steps < maxSteps; steps++) {
    const ev = eventView(game.k, game.state)
    if (ev) {
      const o = ev.options.find((x) => !x.locked)
      if (!o) throw new Error(`untilIdle：事件 ${ev.event} 沒有選得了的選項`)
      game.commit(chooseOption(game.k, game.state, o.id))
      log.push(`event ${ev.event}/${o.id}`)
      continue
    }
    if (sceneRawOf(game.state)) {
      game.commit(sceneAct(game.k, game.state, { kind: 'stop' }))
      log.push('scene stop')
      continue
    }
    if (game.battle) {
      const r = await fightOut(game)
      log.push(`battle ${r!.outcome}`)
      if (r!.outcome !== 'win') return { steps: log.length, log }
      continue
    }
    return { steps: log.length, log }
  }
  throw new Error(`untilIdle：做了 ${maxSteps} 步還沒停（${log.slice(-4).join('、')}）`)
}
