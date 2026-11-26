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
import { auctionView, bidDraft, bidOptions, enterDraft as auctionEnterDraft } from '../features/auction'
import { enterDraft, interviewDraft, tasteDraft } from '../features/curtain'
import { useDraft as drugUseDraft, suppressantDraft } from '../features/drugs'
import { learnDraft as nightLearnDraft } from '../features/nightclass'
import { sceneRawOf } from '../features/scene'
import { orderDraft as unregOrderDraft } from '../features/unreg'
import { go as diveGo } from '../features/dive'
import { cyberOf, installDraft } from '../features/cyberware'
import { arrive } from '../features/world'
import type { Game } from '../shell/game'
import type { ActorOverrides } from './factory'
import type { WorldGame, WorldGameSetup } from './scenarios'
import { STRONG_PC, makeWorldGame } from './scenarios'
import { AUCTION_HOUSE, BODY_BLOCKS, CURTAIN_NIGHTS, CURTAIN_SITE, HOLDER_NPC, bodyStock, bodyWorld } from './worldBody'
import { playCurtainRun } from './curtainPlay'
import { giveInsight, openScene, sceneCast, sceneRounds } from './scenePlay'
import { makeActor } from './factory'
import { passUntil } from './scenarios'
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
 * dive: true 走暗礁裡的簾口：在潛艙店潛入、選去處 ns_tw_curtain，站在潛入裡的網內街區的簾口（B030、B031 修好之後和街上的簾口一樣走得完）。
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

/** 種子重播用的 M4 具名情境（repro.setup.named）：body_creation 還沒建角；body_scene 帶四位 NPC（安、波、西、迪）；body_contract 是定力很低的主角；body_market 帶主角的武器、站在市場。 */
export function makeM4Named(name: string, extra: { seed?: number; ai?: Record<string, unknown> }): WorldGame {
  const base = { ...(extra.seed !== undefined ? { seed: extra.seed } : {}), ...(extra.ai ? { ai: extra.ai } : {}) }
  if (name === 'body_creation') return makeBodyGame({ ...base, scenario: 'beforeCreation', at: null })
  if (name === 'body_scene') return makeBodyGame({ ...base, actors: sceneCast('ann', 'bo', 'cy', 'di'), at: { block: 'tw_tower', marker: 'E1' } })
  if (name === 'body_contract') return makeBodyGame({ ...base, pc: { attrs: { resolve: 4 }, skills: {}, ext: { bridge: { sensitivity: 30, tolerance: 30, craving: 30, docility: 40 } } }, at: { block: 'tw_tower', marker: 'E1' } })
  if (name === 'body_market') return makeBodyGame({ ...base, noGear: false, pc: { ...STRONG_PC, skills: { ...STRONG_PC.skills, firearms: 3 }, ext: { bridge: BRIDGE } }, at: { block: 'tw_market', marker: 'E1' } })
  throw new Error(`沒有「${name}」這個 M4 的具名情境`)
}

// ---- M4 的具名情境（dev/test-harness.md 第 1 節；每一個都用真的功能做出來，不是直接寫狀態） ----

const BOUND_PC: ActorOverrides = { attrs: { resolve: 4 }, skills: {}, ext: { bridge: { sensitivity: 30, tolerance: 30, craving: 30, docility: 40 } } }
const SINK_PC: ActorOverrides = { skills: { composure: 3 }, ext: { bridge: BRIDGE } }

/** 「剛裝完義體在休養」：診所裝了一條義臂（左臂），還在休養、沒有生效；沉溺已經補到下限。 */
export function makeRecoveringGame(o: BodyGameOptions = {}): WorldGame {
  const t = makeBodyGame({ ...o, at: { block: BODY_BLOCKS.clinics, marker: 'F1' } })
  giveProduct(t.game, 'bp_tw_arm', 'U_ARM')
  t.game.commit(installDraft(t.game.k, t.game.state, { actor: 'pc', uid: 'U_ARM', side: 'l', via: 'clinic' }))
  return t
}

/** 「沉溺 65 而且藏著」：沉溺 65、開了抑制劑的每週帳單（別人看到的沉溺比較低）。 */
export function makeHiddenSinkGame(o: BodyGameOptions = {}): WorldGame {
  const t = makeBodyGame({ pc: SINK_PC, ...o })
  const g = t.game
  commit(g, [{ op: 'actor.track', id: 'pc', track: 'sink', delta: 65 } as unknown as Change], 'test.sink', '測試用的沉溺。')
  g.commit(suppressantDraft(g.k, g.state, { weekly: true }))
  return t
}

/** 「依賴一種藥」：兩劑雲絲，成癮值到重度。 */
export function makeDependentGame(o: BodyGameOptions = {}): WorldGame {
  const t = makeBodyGame(o)
  const g = t.game
  giveItem(g, 'it_tw_cloud', 2)
  g.commit(drugUseDraft(g.k, g.state, { actor: 'pc', item: 'it_tw_cloud' }))
  commit(g, [{ op: 'time', minutes: 120 }], 'test.wait', '時間過去了。')
  g.commit(drugUseDraft(g.k, g.state, { actor: 'pc', item: 'it_tw_cloud' }))
  return t
}

/** 「身上有一份債務契約、佇列兩條」：簽了債務契約（C$24,000），佇列有一條差事（去塔下）、一條回報（不指定地點）。 */
export function makeBoundGame(o: BodyGameOptions = {}): WorldGame {
  const t = makeBodyGame({ pc: BOUND_PC, at: { block: 'tw_tower', marker: 'E1' }, ...o })
  const g = t.game
  applyEffects(g, [{ kind: 'contract_sign', type: 'debt', debt: 24000, orders: ['errand', 'work', 'report'], report_weekday: 0, holder: { kind: 'eden', name: '樂園', faction: 'f_tw_eden', place: { district: 'tw_hive', block: 'tw_tower' } }, rules: [] }])
  applyEffects(g, [{ kind: 'order', order_kind: 'errand', place: { district: 'tw_hive', block: 'tw_tower' }, hours: 24 }])
  applyEffects(g, [{ kind: 'order', order_kind: 'report', hours: 72 }])
  return t
}

/** 「持有一個契約人」：主角持有阿音的契約（私人、債務）。 */
export function makeHolderGame(o: BodyGameOptions = {}): WorldGame {
  const t = makeBodyGame({ actors: [makeActor({ id: HOLDER_NPC, name: '阿音', role: 'npc', gender: 'female', age: 26, ext: { bridge: { sensitivity: 40, tolerance: 25, craving: 30, docility: 35 } } })], ...o })
  applyEffects(t.game, [{ kind: 'contract_hold', npc: HOLDER_NPC, type: 'private' }])
  return t
}

/** 「三個人的場景進行到第三回合」：主角、安、波一圈（西、迪不展開的一圈），已經過了兩回合。 */
export function makeTrioSceneGame(o: BodyGameOptions = {}): WorldGame {
  const t = makeBodyGame({ actors: sceneCast('ann', 'bo', 'cy', 'di'), at: { block: 'tw_tower', marker: 'E1' }, ...o })
  const g = t.game
  giveInsight(g, 40)
  g.commit(nightLearnDraft(g.k, g.state, 'pc', 'nt_tw_kiss'))
  openScene(g, { circles: [['pc', 'npc_tw_ann', 'npc_tw_bo'], ['npc_tw_cy', 'npc_tw_di']], nature: 'mutual', mode: 'full' })
  sceneRounds(g, 2)
  return t
}

/** 「簾後館第二幕、場熱 65」：報名、走完序幕與第一幕，站在第二幕（第三層）；場熱設成 65。 */
export async function makeCurtainAct2Game(o: BodyGameOptions = {}): Promise<WorldGame> {
  const t = makeCurtainGame(o)
  const g = t.game
  curtainPrelude(g)
  curtainEnter(g, CURTAIN_NIGHTS.a)
  await playCurtainRun(g, { stopAfterLayer: 2 })
  const map = g.state.maps.at!.map
  // 場熱：一趟進行中不收別的報告（網內的活動放行清單），直接把量表放到 65（測試的起點，不是一個行動）
  const meters = g.state.meters as Record<string, Record<string, number>>
  meters.stage_heat = { ...(meters.stage_heat ?? {}), [map]: 65 }
  return t
}

/**
 * 「M2、M3 的舊存檔」：一對一的場景進行中，寫成 M2、M3 的兩格寫法（沒有 v）。
 * （M3 存檔的「甲板放在背包裡」那一半：使用者 2026-11-25 裁決不做舊存檔的甲板搬移，所以這個情境只有場景。）
 */
export function makeLegacySceneGame(o: BodyGameOptions = {}): WorldGame {
  const t = makeBodyGame({ actors: sceneCast('ann'), at: { block: 'tw_tower', marker: 'E1' }, ...o })
  const g = t.game
  openScene(g, { with: ['npc_tw_ann'], nature: 'mutual', goal: 'please', mode: 'full' })
  const raw = JSON.parse(JSON.stringify(sceneRawOf(g.state))) as Record<string, any>
  const pc: string = raw.pc
  const partner: string = raw.seats[1].id
  const side = (id: string): 'pc' | 'partner' => (id === pc ? 'pc' : 'partner')
  const seat = (id: string) => raw.seats.find((x: { id: string }) => x.id === id)
  const pick = (key: string): Record<string, unknown> => ({ pc: seat(pc)[key], partner: seat(partner)[key] })
  const { v: _v, kind: _k, layer: _l, seats: _s, pairs, circles: _c, roles, links, lines, turn, ...keep } = raw
  void [_v, _k, _l, _s, _c]
  g.state.ext.scene = {
    ...keep, partner, turn: side(turn), ap: pick('ap'), gear: pick('gear'), max_gear: pick('max_gear'), shifted: pick('shifted'), sink_gain: pick('sink_gain'), climax: pick('climax'),
    received: pick('received'), teased: pick('teased'), restrained: pick('restrained'), fit: pairs[partner].fit, init: pairs[partner].init, first_person: pairs[partner].first,
    roles: { pc: roles[pc], partner: roles[partner] }, links: links.map((l: { by: string; to: string }) => { const { to: _to, ...rest } = l; void _to; return { ...rest, by: side(l.by) } }),
    lines: lines.map((l: { who: string }) => ({ ...l, who: side(l.who) })),
  } as never
  return t
}

/** 「一件未登錄零件等著交貨、另一件訂做中」：報酬的零件（III 級槍管）等著交貨，委託台又訂做了一件（II 級槍管，三天後）。 */
export function makePartsGame(o: BodyGameOptions = {}): WorldGame {
  const t = makeBodyGame({ at: { block: BODY_BLOCKS.shops, marker: 'F2' }, ...o })
  const g = t.game
  applyEffects(g, [{ kind: 'part_unreg', source: 'reward', type: 'barrel', grade: 3, brand: 'hz', from: '委託的報酬' }])
  g.commit(unregOrderDraft(g.k, g.state, { type: 'barrel', grade: 2, want: ['barrel_damage'] }))
  return t
}

/** 「拍賣進行到第二件、主角是最高的人」：週五進場，第一件退出，第二件加價到自己是最高的出價人。 */
export function makeAuctionSecondLotGame(o: BodyGameOptions = {}): WorldGame {
  const t = makeBodyGame({ at: { block: BODY_BLOCKS.hall, marker: 'F1' }, ...o })
  const g = t.game
  commit(g, [{ op: 'meter', kind: 'favor', key: 'f_tw_gallery', set: 40 } as unknown as Change], 'test.favor', '測試給的好感。')
  passUntil(g, { day: 11, hour: 19, minute: 10 })
  giveMoney(g, 0, 10000)
  g.commit(auctionEnterDraft(g.k, g.state, { house: AUCTION_HOUSE, pay: 'cash' }))
  for (let i = 0; i < 100 && auctionView(g.k, g.state)?.lot_no === 1; i++) g.commit(bidDraft(g.k, g.state, { act: 'fold' }))
  for (let i = 0; i < 20; i++) {
    const v = auctionView(g.k, g.state)
    if (!v || v.lot_no !== 2) throw new Error('makeAuctionSecondLotGame：第二件已經過了，主角沒有成為最高的人')
    if (v.holder.id === 'pc') break
    const raise = [...bidOptions(g.k, g.state)!.raise].reverse().find((r) => r.can)
    g.commit(bidDraft(g.k, g.state, raise ? { act: 'raise', steps: raise.steps! } : { act: 'wait' }))
  }
  return t
}
