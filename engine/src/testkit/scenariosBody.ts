// 測試基礎建設：M4 的具名情境與小工具（dev/test-harness.md 第 1 節；dev/work/M4-smoke.md 第 2 點）。
//
//   makeBodyGame()          帶著 bodyWorld()（TEST_WORLD 加內海加 M4 的幾筆）與全部功能的一局：強主角（有義體學、醫療、機械）、站在診所街的西口、帳戶與現金夠付手術；還沒裝任何義體、沒有橋
//   makeBodyCreationGame()  還沒建角（建角的測試用）
//   standAt(game, 街區, 標記)  站到一個街區的設施或出口上
//   giveProduct(game, 設計圖, uid)  背包多一件成品（零件照設計圖的 stock）
//   freshBody(game)         讓主角一開始就有橋與一副甲板（不經手術）：橋裝進 ext.cyber、甲板放進腦部（wearDeck），沉溺補到下限
//
// 全部走真正的功能與真正的提交；AI 一律關著。M4 的具名情境（「剛裝完義體在休養」「沉溺 65 而且藏著」……）也在這裡（scenariosBody 的後半，每一個都是用真的功能做出來的，不是直接寫狀態）。

import type { Change, GameState, Report, ReportDraft } from '../core'
import { effectCtx } from '../core'
import { enterDraft, interviewDraft, tasteDraft } from '../features/curtain'
import { go as diveGo } from '../features/dive'
import { cyberOf, installDraft } from '../features/cyberware'
import { arrive } from '../features/world'
import type { Game } from '../shell/game'
import type { ActorOverrides } from './factory'
import type { WorldGame, WorldGameSetup } from './scenarios'
import { STRONG_PC, makeWorldGame } from './scenarios'
import { bodyStock, bodyWorld, BODY_BLOCKS, CURTAIN_SITE } from './worldBody'
import { NET_PC, TEST_NET_ADMIN } from './scenariosNet'
import { diveIn, equipParty, netInventory } from './scenariosNet'

const BRIDGE = { sensitivity: 30, tolerance: 30, craving: 30, docility: 30 }

/** M4 冒煙的主角：強主角（屬性 20 的那一種）加義體學 3、醫療 2、槍械 3、定力 3、表演 2；有橋參數；血量 40。 */
export const BODY_PC: ActorOverrides = {
  ...STRONG_PC,
  hp: 40,
  skills: { ...STRONG_PC.skills, firearms: 3, cyberware: 3, medicine: 2, composure: 3, perform: 2, seduce: 2 },
  ext: { bridge: BRIDGE },
}

/** 第 3 天上午 10:00（週三；導演的每日抽事件不會一開局就來：旗標要得到）。 */
export const BODY_START = { day: 3, hour: 10, minute: 0 }

export interface BodyGameOptions extends WorldGameSetup {
  pc?: ActorOverrides
  /** 起點（街區 id 與標記）；預設診所街的西口之外：站在診所街的 E1 */
  at?: { block: string; marker: string } | null
}

/** 帶著 bodyWorld() 與全部功能的一局。預設站在診所街的 E1（沒有走進任何設施）、帳戶 20,000、現金 2,000。 */
export function makeBodyGame(o: BodyGameOptions = {}): WorldGame {
  const { pc, at, patch, ...rest } = o
  const t = makeWorldGame({
    seed: 6, noGear: true, ...rest, world: bodyWorld(), pc: pc ?? BODY_PC,
    patch: { time: { ...BODY_START }, money: { cred: 20000, cash: 2000 }, ...patch },
  })
  if (at !== null) t.game.commit(arrive(t.game.k, t.game.state, at?.block ?? BODY_BLOCKS.clinics, at?.marker ?? 'E1'))
  return t
}

/** 站到一個街區的設施（F1……）或出口（E1、E2）上。 */
export function standAt(game: Game, block: string, marker: string): Report[] {
  return game.commit(arrive(game.k, game.state, block, marker))
}

const commit = (game: Game, changes: Change[], action = 'test.give', summary = '測試用的提交。'): Report[] =>
  game.commit({ kind: 'system', action, location: {}, party: [], timeline: [], changes, outcome: { result: 'ok', summary } } satisfies ReportDraft)

/** 背包多一件義體或武器的成品（零件照設計圖的 stock；uid 要不重複）。 */
export function giveProduct(game: Game, bp: string, uid: string, parts: Record<string, string> = bodyStock(bp)): Report[] {
  return commit(game, [{ op: 'item', id: bp, qty: 1, data: { uid, parts } } as unknown as Change])
}

/** 背包多幾份東西（藥、零件、授權書……）。 */
export function giveItem(game: Game, id: string, qty = 1): Report[] {
  return commit(game, [{ op: 'item', id, qty } as unknown as Change])
}

/** 身上現在的義體件數（含橋）。 */
export const pieceCount = (state: GameState, actor = 'pc'): number => cyberOf(state, actor).length

/**
 * 在診所裝上一件背包裡的義體成品（走 cyberware 的 installDraft，經正規診所）：站到診所街的 F1、裝、站回原處。
 * 回傳裝的那一份報告。
 */
export function installAtClinic(game: Game, uid: string, side?: 'l' | 'r', actor = 'pc'): Report {
  const here = game.state.location
  standAt(game, BODY_BLOCKS.clinics, 'F1')
  const reports = game.commit(installDraft(game.k, game.state, { actor, uid, via: 'clinic', ...(side ? { side } : {}) }))
  void here
  return reports.find((r) => r.action === 'cyber.install')!
}

/** 帳戶與現金各加（或扣）多少。 */
export function giveMoney(game: Game, cred: number, cash = 0): Report[] {
  return commit(game, [...(cred !== 0 ? [{ op: 'cred', delta: cred } as Change] : []), ...(cash !== 0 ? [{ op: 'cash', delta: cash } as Change] : [])], 'test.money', '測試用的錢。')
}

/**
 * 一串效果直接套到狀態上（內建的來源：和事件、建角開局用的是同一條路）：驗過格式、結算、提交一份 test.effect 的報告。
 * 回傳 { errors, reports }；有格式的錯誤就什麼都不提交。
 */
export function applyEffects(game: Game, effects: Array<Record<string, unknown>>, actor = 'pc'): { errors: string[]; reports: Report[] } {
  const ctx = effectCtx(game.k, game.state, { source: 'builtin', actor })
  const errors = game.k.effects.validate(effects as never, ctx)
  if (errors.length > 0) return { errors, reports: [] }
  const res = game.k.effects.resolve(effects as never, ctx)
  if (res.errors.length > 0) return { errors: res.errors, reports: [] }
  return { errors: [], reports: commit(game, res.changes, 'test.effect', res.lines.join('') || '測試用的效果。') }
}

/**
 * 簾後館：站得到簾口的一局（給 makeBodyGame 的設定）。主角是 NET_PC（強、有介面與同步），背包有一副甲板與全套構裝（netInventory(1)）。
 * 回傳的 setup 要整個交給 makeBodyGame；呼叫的人再用 curtainEntry(game) 走完邀請函、面談、口味單、穿甲板、潛入、走到簾口。
 */
export const CURTAIN_PRELUDE = ['邀請函', '面談', '口味單', '穿甲板', '潛入', '走到簾口'] as const

/** 簾後館的一局：NET_PC、背包有甲板與全套構裝、站在塔下。features 要加上 TEST_NET_ADMIN（管理行動）。 */
export function makeCurtainGame(o: BodyGameOptions = {}): WorldGame {
  return makeBodyGame({ seed: 3, pc: NET_PC, ...o, features: [TEST_NET_ADMIN, ...(o.features ?? [])], patch: { inventory: netInventory(1) as never, ...o.patch }, at: o.at === undefined ? { block: 'tw_tower', marker: 'E1' } : o.at })
}

/**
 * 簾後館的前奏：穿上甲板與構裝（面談要有自己的甲板）、街頭信譽 40、邀請函、面談（散座）、口味單三個、走到大廳的簾口（F4；街上的簾口，不經過潛入）。回傳每一步的報告。
 * 暗礁裡的簾口（潛入之後選 ns_tw_curtain）報名會被潛入的活動擋下（B030），之後一趟的場熱與落幕也不啟動（B031）：那一條走法在 engine/tests/pending/。
 */
export function curtainPrelude(game: Game, o: { dive?: boolean } = {}): Report[] {
  const out: Report[] = []
  const { k } = game
  equipParty(game, ['pc'])
  out.push(...commit(game, [{ op: 'meter', kind: 'rep', key: '_', delta: 40 } as unknown as Change], 'test.rep', '測試給的街頭信譽。'))
  out.push(...applyEffects(game, [{ kind: 'curtain_invite' }]).reports)
  out.push(...game.commit(interviewDraft(k, game.state, { tier: 'floor', skill: 'negotiate' })))
  out.push(...game.commit(tasteDraft(k, game.state, ['tg_tw_dom', 'tg_tw_sub', 'tg_tw_pamper'])))
  if (o.dive) {
    standAt(game, 'tw_tower', 'F3')
    out.push(...diveIn(game))
    out.push(...game.commit(diveGo(k, game.state, CURTAIN_SITE)))
  } else out.push(...standAt(game, BODY_BLOCKS.hall, 'F4'))
  return out
}

/** 報名（站在簾口；指定哪一夜才不看亂數）。 */
export function curtainEnter(game: Game, night: string): Report[] {
  return game.commit(enterDraft(game.k, game.state, { party: ['pc'], night }))
}
