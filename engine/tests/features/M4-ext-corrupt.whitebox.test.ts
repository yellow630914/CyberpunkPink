// 白箱：M4 功能的狀態（state.ext.<功能>、actors[id].ext.<功能>）被讀檔、舊版存檔或手改弄成形狀不對的東西時，
// 每個功能的「讀」與「畫面的資料」不能丟例外，也不能讓衍生數值與被動效果算出 NaN（M4 白箱，cpp-tester-whitebox）。
// 規格：dev/invariants.md 第 6 條（讀不進來的存檔不改變現在的狀態；讀進來的就要能玩）、GAME_DESIGN 第 3 節第 13 條；
// 各功能的 xxxOf／readXxx 檔頭都寫「形狀不對的當沒有」；dev/adr/0019 第二節（被動效果的來源登記：來源的函式讀的是存檔）。
// 做法：開一局有進度的簾後館（會員、義體、藥、契約、未登錄零件的單、調校），對 M4 每個功能的 ext 鍵與它底下的每一層鍵，
// 換成十六種壞值，再呼叫每個功能匯出的讀取函式與畫面資料函式，記下丟例外的。
// 和 M2-ext-corrupt.whitebox.test.ts 一樣的做法與寫法。

import { describe, expect, it, vi } from 'vitest'
import type { GameState } from '../../src'
import { cyberOf, cyberView, lockView, pumpView } from '../../src/features/cyberware'
import { drugView } from '../../src/features/drugs'
import { retreatView, sinkView } from '../../src/features/sink'
import { bridgeView, tuningList } from '../../src/features/tuning'
import { malwareView } from '../../src/features/malware'
import { lureView } from '../../src/features/lure'
import { boundView, contractOf, holderContractView, heldOf } from '../../src/features/contract'
import { auctionOf, auctionView, catalogView, sessionOf } from '../../src/features/auction'
import { accountView, curtainOf as readCurtain, curtainView, fallView, memberView } from '../../src/features/curtain'
import { frameView, pendingView, unregOf } from '../../src/features/unreg'
import { craftOf } from '../../src/features/craft'
import { arenaView } from '../../src/features/arena'
import { nightList } from '../../src/features/nightclass'
import { medicalView } from '../../src/features/medical'
import { deckView } from '../../src/features/deck'
import { billPreview } from '../../src/features/bills'
import { HOLDER_NPC, AUCTION_HOUSE, applyEffects, curtainPrelude, giveItem, makeCurtainGame, passTime, standAt } from '../../src/testkit'
import { BODY_BLOCKS } from '../../src/testkit'

vi.setConfig({ testTimeout: 120_000 })

const BAD: unknown[] = [null, 'x', '', -1, 0, 1.5, Number.NaN, [], {}, true, [null], [1, 2], { a: 1 }, { id: 'x' }, [{}], [[]]]
/** 世界的 ext 鍵（state.ext） */
const WORLD_KEYS = ['contract', 'auction', 'curtain', 'unreg', 'craft', 'arena', 'deck', 'cyber', 'lure', 'dive', 'netrun', 'scene', 'sink', 'drugs', 'tuning', 'malware']
/** 角色的 ext 鍵（actors.pc.ext） */
const ACTOR_KEYS = ['cyber', 'drugs', 'sink', 'tuning', 'malware', 'bridge', 'tendency', 'scene', 'sex_record', 'contract', 'deck', 'craft', 'wound', 'medical']

describe('白箱 M4 狀態的讀取：ext 被弄壞時不丟例外', () => {
  it('每個功能的 ext 鍵 × 每一層鍵 × 十六種壞值，讀取函式與畫面資料函式都只能回傳東西，不能丟例外；衍生數值不能算出 NaN', () => {
    const { game } = makeCurtainGame()
    const k = game.k
    curtainPrelude(game)
    // 一些進度：藥、契約（持約人在簽）、時間往前走
    giveItem(game, 'it_tw_cloud', 2)
    applyEffects(game, [{ kind: 'contract_hold', npc: HOLDER_NPC, type: 'private' }])
    passTime(game, 3 * 24 * 60)
    standAt(game, BODY_BLOCKS.hall, 'F4')
    const base = game.state

    const readers: Array<[string, (s: GameState) => unknown]> = [
      ['cyberOf', (s) => cyberOf(s, 'pc')], ['cyberView', (s) => cyberView(k, s, 'pc')], ['lockView', (s) => lockView(k, s, 'pc')], ['pumpView', (s) => pumpView(k, s, 'pc')],
      ['drugView', (s) => drugView(k, s, 'pc')], ['sinkView', (s) => sinkView(k, s, 'pc')], ['retreatView', (s) => retreatView(s)],
      ['bridgeView', (s) => bridgeView(k, s, 'pc')], ['tuningList', (s) => tuningList(k, s, 'pc')],
      ['malwareView', (s) => malwareView(k, s, 'pc')], ['lureView', (s) => lureView(k, s)],
      ['boundView', (s) => boundView(k, s)], ['contractOf', (s) => contractOf(s)], ['holderContractView', (s) => holderContractView(k, s, HOLDER_NPC)], ['heldOf', (s) => heldOf(s)],
      ['auctionOf', (s) => auctionOf(s)], ['auctionView', (s) => auctionView(k, s)], ['catalogView', (s) => catalogView(k, s, AUCTION_HOUSE)], ['sessionOf', (s) => sessionOf(k, s, AUCTION_HOUSE)],
      ['readCurtain', (s) => readCurtain(s)], ['curtainView', (s) => curtainView(k, s)], ['accountView', (s) => accountView(k, s)], ['fallView', (s) => fallView(k, s)], ['memberView', (s) => memberView(k, s)],
      ['unregOf', (s) => unregOf(s)], ['pendingView', (s) => pendingView(k, s)], ['frameView', (s) => frameView(k, s, 'nope')],
      ['craftOf', (s) => craftOf(s)], ['arenaView', (s) => arenaView(k, s)], ['nightList', (s) => nightList(k, s, 'pc')], ['medicalView', (s) => medicalView(k, s)], ['deckView', (s) => deckView(k, s, 'pc')],
      ['billPreview', (s) => billPreview(k, s)],
      ['stat:max_hp', (s) => k.stats.stat(s, 'pc', 'max_hp')], ['stat:load_cap', (s) => k.stats.stat(s, 'pc', 'load_cap')], ['stat:ap_max', (s) => k.stats.stat(s, 'pc', 'ap_max')],
      ['attr:body', (s) => k.stats.effectiveAttr(s, 'pc', 'body')], ['attr:resolve', (s) => k.stats.effectiveAttr(s, 'pc', 'resolve')],
      ['passives', (s) => k.passives.of(s, 'pc')], ['activities', (s) => k.activity.active(s)], ['block:install', (s) => k.activity.blockOf(s, 'commit:cyber.install')],
    ]
    for (const [, fn] of readers) fn(base) // 原樣不會壞
    const crashes = new Map<string, string>()
    const nans: string[] = []
    let calls = 0
    const variants: Array<{ label: string; apply: (s: GameState) => void }> = []
    for (const key of WORLD_KEYS) {
      for (const b of BAD) variants.push({ label: `ext.${key}←${JSON.stringify(b)}`, apply: (s) => { s.ext[key] = structuredClone(b) } })
      const orig = base.ext[key]
      if (orig && typeof orig === 'object' && !Array.isArray(orig)) {
        for (const sub of Object.keys(orig as Record<string, unknown>)) {
          for (const b of BAD) variants.push({ label: `ext.${key}.${sub}←${JSON.stringify(b)}`, apply: (s) => { (s.ext[key] as Record<string, unknown>)[sub] = structuredClone(b) } })
          variants.push({ label: `ext.${key}.${sub}←(刪掉)`, apply: (s) => { delete (s.ext[key] as Record<string, unknown>)[sub] } })
        }
      }
    }
    for (const key of ACTOR_KEYS) {
      for (const b of BAD) variants.push({ label: `pc.ext.${key}←${JSON.stringify(b)}`, apply: (s) => { s.actors.pc!.ext[key] = structuredClone(b) } })
      const orig = base.actors.pc!.ext[key]
      if (orig && typeof orig === 'object' && !Array.isArray(orig)) {
        for (const sub of Object.keys(orig as Record<string, unknown>)) {
          for (const b of BAD) variants.push({ label: `pc.ext.${key}.${sub}←${JSON.stringify(b)}`, apply: (s) => { (s.actors.pc!.ext[key] as Record<string, unknown>)[sub] = structuredClone(b) } })
        }
      }
    }
    for (const v of variants) {
      const s = structuredClone(base)
      v.apply(s)
      for (const [name, fn] of readers) {
        try {
          const out = fn(s)
          calls++
          if (typeof out === 'number' && !Number.isFinite(out)) nans.push(`${name} | ${v.label} = ${out}`)
        } catch (e) { crashes.set(`${name} | ${v.label}`, (e as Error).message.slice(0, 80)) }
      }
    }
    expect(calls).toBeGreaterThan(5000)
    expect([...crashes.entries()].slice(0, 30), `丟例外的（共 ${crashes.size}）`).toEqual([])
    expect(nans.slice(0, 30)).toEqual([])
  })
})
