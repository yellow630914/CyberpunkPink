// 測試基礎建設：內海的具名情境與小工具（dev/test-harness.md 第 1 節；dev/work/M3-smoke.md 第 2 點）。
//
//   makeNetBattleGame()      四個有甲板的化身（主角加三個隊友）對一場內海的一般遭遇，已經開打
//   makeNetCommissionGame()  接了那件主面是內海的委託（中間人 fx_tw_netbroker 桌上寫好的四階段副本）、隊伍兩個人都有甲板、站在委託地點（市場）；還沒出發
//   makeDiveGame()           （第二波）站在潛艙店（塔下的 F3）、有自己的甲板、現金夠
//   netWalkTo(game, 節點 id)  走到網內這一層的一個節點（標記 id 或 'entry'）；netUse(game, 做什麼, 節點?) 在站的（或旁邊的）節點上做一件事
//   playNetStage(game)       一個內海階段強攻到底：選面、選分支、走到遭遇旁邊開戰、打贏、通過閘門或做完目標
//
// 全部走真正的功能與真正的提交；只有主角的「管理行動的次數」用 TEST_NET_ADMIN 補（技能樹的內海欄是 abilities 自己的測試；這裡只要戰鬥裡有人做得了管理行動）。
// AI 一律關著；要接假的服務商就給 fake。

import { gridHere, pointKey } from '../core'
import type { Feature } from '../core/kernel'
import type { GameState, Report, ReportDraft } from '../core/types'
import { equipDraft, installDraft, removeDraft, scriptsDraft } from '../features/deck'
import { chooseBranch, chooseFace, readRun } from '../features/commission'
import { enter as diveEnter } from '../features/dive'
import { enter as mazeEnter, open as mazeOpen, solve as mazeSolve } from '../features/maze'
import { accept, board } from '../features/fixer'
import { join, muster } from '../features/roster'
import { netExt, netrunView, readRun as readNetRun, useNode } from '../features/netrun'
import { arrive } from '../features/world'
import type { Game } from '../shell/game'
import type { ActorOverrides } from './factory'
import { makeActor } from './factory'
import type { CommissionGame, CommissionOptions, WorldGame, WorldGameSetup } from './scenarios'
import { RUNNER, STRONG_PC, fightOut, makeRunner, makeWorldGame, walkTo } from './scenarios'
import { NET_FIXER, NET_OFFER_ID } from './worldNet'

type Cell = [number, number]

/**
 * 報告的 action 前綴（「功能的前綴.動詞」）：0016 第七節的二十二個，加核心與外殼自己的（game、battle、rewind、save）與導演的 director、測試自己發的 test
 * （M2 冒煙的 ACTION_PREFIXES 是同一份）；M3 加 0018 第十三節的四個：deck、netrun、dive、maze。
 */
export const M3_ACTION_PREFIXES: readonly string[] = [
  'world', 'transit', 'grid', 'event', 'scan', 'scene', 'defeat', 'capture', 'commission', 'fixer', 'roster', 'favor', 'npc', 'security', 'trade', 'bill', 'rest', 'home', 'work', 'lewd', 'ability', 'gear',
  'game', 'battle', 'rewind', 'save', 'director', 'test',
  'deck', 'netrun', 'dive', 'maze',
]

/** 這一局的報告裡，action 不是「功能的前綴.動詞」或前綴不在清單裡的（排序、不重複；rewind 那一份的 action 整個就是 rewind，不算）。 */
export function prefixProblems(game: Game, allowed: readonly string[] = M3_ACTION_PREFIXES): string[] {
  return [...new Set(game.state.reports.map((r) => r.action ?? ''))].filter((a) => a !== 'rewind' && (!/^[a-z_]+\.[a-z_]+$/.test(a) || !allowed.includes(a.split('.')[0]!))).sort()
}

// ---- 主角、隊友與甲板 ----

/** 橋參數（和 scenarios.ts 的一樣：工廠做的主角沒有走建角，沒有它的話第一次讀檔會被補上一份）；主角的敏感度夠深檔（40 以上）。 */
const BRIDGE = { sensitivity: 30, tolerance: 30, craving: 30, docility: 30 }
const PC_BRIDGE = { ...BRIDGE, sensitivity: 45 }

/** 內海的主角：強主角加介面與同步，帶「管理行動 2 次」的測試標記（TEST_NET_ADMIN 讀）。 */
export const NET_PC: ActorOverrides = {
  ...STRONG_PC,
  attrs: { ...STRONG_PC.attrs, resolve: 18 },
  skills: { ...STRONG_PC.skills, interface: 5, firearms: 3, brawl: 3, sync: 3, composure: 3 },
  ext: { bridge: PC_BRIDGE, test_admin: 2 },
}

/** 測試用的功能：有 ext.test_admin 的角色，內海開戰時 unit.ext.net.admin 是那個數字（真的來源是技能樹的內海欄，那一段有 abilities 自己的測試）。 */
export const TEST_NET_ADMIN: Feature = {
  id: 'test_net_admin',
  install(k) {
    k.battle.on('unit.ready', 'test_net_admin', ({ run, unit }) => {
      if (run.mode.layer !== 'net' || !unit.actor) return
      const n = run.state.actors[unit.actor]?.ext.test_admin
      if (typeof n !== 'number' || n <= 0) return
      unit.ext.net = { ...(typeof unit.ext.net === 'object' && unit.ext.net ? unit.ext.net : {}), admin: n }
      for (const tag of ['admin', 'netrunner']) if (!unit.tags.includes(tag)) unit.tags.push(tag)
    })
  },
}

/** 一位隊友（有橋參數；role 預設是 companion，進隊）。 */
export function makeNetMate(id: string, name: string, role: 'companion' | 'npc' = 'companion') {
  return makeActor({ id, name, role, attrs: { body: 14, reflex: 15, tech: 14, intellect: 14, resolve: 14, charm: 12 }, skills: { firearms: 2, brawl: 2, sync: 2, composure: 2 }, ext: { bridge: BRIDGE } })
}

/** 內海委託裡的行者（名冊上的人）：和 makeRunner 一樣，加一份橋參數：沒有橋的人進不了內海，會自動留在現實當輔助（M3 修正批），測試要他一起進網內。 */
export function makeNetRunner() {
  const r = makeRunner()
  return makeActor({ id: r.id, name: r.name, role: r.role, ext: { ...r.ext, bridge: BRIDGE } })
}

/** 主角的構裝與快駭程式（甲板 6 槽：槍、近戰、干擾、防護、工具、快駭）。 */
export const PC_SLOTS = ['cs_tw_gun', 'cs_tw_blade', 'cs_tw_jam', 'cs_tw_guard', 'cs_tw_probe', 'qh_tw_zap']
/** 隊友的構裝（槍加防護）。 */
export const MATE_SLOTS = ['cs_tw_gun', 'cs_tw_guard']

/** 背包要有的東西：每個人一副甲板（編號 D1、D2……）、各一件構裝與快駭程式（加迷宮館新手組的兩件比賽版）、腳本兩支。 */
export function netInventory(n: number): Array<{ id: string; qty: number; data?: { uid: string } }> {
  return [
    ...Array.from({ length: n }, (_, i) => ({ id: 'dk_tw_ii', qty: 1, data: { uid: `D${i + 1}` } })),
    ...['cs_tw_gun', 'cs_tw_blade', 'cs_tw_jam', 'cs_tw_guard', 'cs_tw_probe', 'qh_tw_zap', 'cs_tw_gun_rent', 'cs_tw_blade_rent'].map((id) => ({ id, qty: 1 })),
    { id: 'it_tw_script', qty: 2 },
  ]
}

const commit = (game: Game, d: ReportDraft): Report[] => game.commit(d)

/** 給隊上的人（依序）穿上甲板、裝構裝（第一個人全套，其他人槍加防護）、帶腳本：走真正的 deck 報告。 */
export function equipParty(game: Game, ids: readonly string[]): void {
  const { k } = game
  ids.forEach((id, i) => {
    commit(game, equipDraft(k, game.state, id, `D${i + 1}`))
    for (const item of i === 0 ? PC_SLOTS : MATE_SLOTS) commit(game, installDraft(k, game.state, id, item))
    // 腳本的效果（net.ram）是 netcombat 註冊的：拿掉它，假世界就沒有那支腳本（worldFor）
    if (i === 0 && k.content.has('item', 'it_tw_script')) commit(game, scriptsDraft(k, game.state, id, [{ item: 'it_tw_script', qty: 2 }]))
  })
}

// ---- 一場內海戰鬥 ----

export interface NetBattleOptions extends WorldGameSetup {
  /** 敵方的組合（位階；預設四個粉雜兵） */
  foes?: Array<'minion' | 'elite' | 'boss'>
  /** 敵方的顏色（預設粉） */
  color?: 'white' | 'pink' | 'black'
  /** 不開打（只建好人與甲板） */
  noBattle?: boolean
}

/**
 * 四個有甲板的化身（主角加三個隊友）對一場內海的一般遭遇（四個粉雜兵，遮蔽「中」），已經開打；種子預設 5。
 * 戰場是內海、敵人是 enemy_pick 挑的（野良幫的蕾絲）；沒有網內的行程（追蹤度不給）。
 */
export function makeNetBattleGame(o: NetBattleOptions = {}): WorldGame {
  const { foes, color, noBattle, patch, actors, ...rest } = o
  const t = makeWorldGame({
    seed: 5, ...rest, pc: NET_PC, actors: [makeNetMate('a_tw_n1', '隊友一'), makeNetMate('a_tw_n2', '隊友二'), makeNetMate('a_tw_n3', '隊友三'), ...(actors ?? [])],
    features: [...(o.features ?? []), TEST_NET_ADMIN],
    patch: { time: { day: 3, hour: 10, minute: 0 }, money: { cred: 500, cash: 1000 }, inventory: netInventory(4) as never, ...patch },
  })
  const { game } = t
  equipParty(game, ['pc', 'a_tw_n1', 'a_tw_n2', 'a_tw_n3'])
  if (noBattle) return t
  const ranks = foes ?? ['minion', 'minion', 'minion', 'minion']
  game.startBattle({
    mode: 'net', grade: 1, cover: 'medium',
    allies: ['pc', 'a_tw_n1', 'a_tw_n2', 'a_tw_n3'].map((id) => ({ from: 'actor', id })),
    foes: ranks.map((rank, i) => ({ from: 'enemy_pick', faction: 'f_gang', grade: 1, rank, color: color ?? 'pink', seed: `netbattle/${i}` })),
    origin: { escapable: true, place: '測試用的子網', faction: 'f_gang' },
  } as never)
  return t
}

// ---- 內海的委託 ----

export interface NetCommissionGame extends CommissionGame {
  /** 手上那一件委託的 id（桌上寫好的那一件） */
  offer: string
}

/**
 * 接了那件主面是內海的委託（中間人 fx_tw_netbroker 桌上寫好的四階段副本、付現金；offer: 'generated' 是桌上照類型生成的第一件）、隊伍兩個人（主角加名冊上的行者，行者分紅）都有甲板、站在委託地點（市場的西口）；還沒出發。
 * 強主角（NET_PC）、第 3 天上午 10:00、帳戶 500、現金 1,000；種子預設 6。
 */
export interface NetCommissionOptions extends CommissionOptions {
  /** 接哪一件：written 是桌上寫好的四階段那一件（預設）；generated 是掮客的桌上照類型（竊密）生成的第一件（小型、三階段、最後一個內海面是隔離區） */
  offer?: 'written' | 'generated'
}

export function makeNetCommissionGame(o: NetCommissionOptions = {}): NetCommissionGame {
  const { pc, pay, patch, actors, offer, ...rest } = o
  const t = makeWorldGame({
    seed: 6, ...rest, pc: pc ?? NET_PC, actors: [makeNetRunner(), ...(actors ?? [])], features: [...(o.features ?? []), TEST_NET_ADMIN],
    patch: { time: { day: 3, hour: 10, minute: 0 }, money: { cred: 500, cash: 1000 }, inventory: netInventory(2) as never, ...patch },
  })
  const { game } = t
  game.commit(arrive(game.k, game.state, 'tw_market', 'E1'))
  const rows = board(game.k, game.state, NET_FIXER).offers
  const row = offer === 'generated' ? rows.find((r) => r.id !== NET_OFFER_ID) : rows.find((r) => r.id === NET_OFFER_ID)
  if (!row) throw new Error(offer === 'generated' ? 'makeNetCommissionGame：掮客的桌上沒有生成的內海委託' : 'makeNetCommissionGame：掮客的桌上沒有那件內海的委託')
  game.commit(accept(game.k, game.state, { id: row.id, fixer: NET_FIXER }, { pay: pay ?? 'cash' }))
  game.commit(join(game.k, game.state, RUNNER, { pay: 'share' }))
  game.commit(muster(game.k, game.state, { party: [RUNNER], tagalong: [] }))
  equipParty(game, ['pc', RUNNER])
  return { ...t, job: row.id, fixer: NET_FIXER, runner: RUNNER, offer: row.id }
}

// ---- 第二波：潛入 ----

/** 站在潛艙店（塔下的 F3）、有自己的甲板（主角一個人）、現金 500；星期日上午 10:00。 */
export function makeDiveGame(o: WorldGameSetup & { noDeck?: boolean } = {}): WorldGame {
  const { noDeck, patch, ...rest } = o
  const t = makeWorldGame({
    seed: 4, ...rest, pc: NET_PC, features: [...(o.features ?? []), TEST_NET_ADMIN],
    patch: { time: { day: 6, hour: 10, minute: 0 }, money: { cred: 500, cash: 500 }, inventory: netInventory(1) as never, ...patch },
  })
  const { game } = t
  game.commit(arrive(game.k, game.state, 'tw_tower', 'E1'))
  walkTo(game, 'F3')
  if (!noDeck) equipParty(game, ['pc'])
  return t
}

/** 潛入（走 dive 的 enter；站在潛艙店上）。 */
export function diveIn(game: Game): Report[] {
  return game.commit(diveEnter(game.k, game.state))
}

// ---- 網內的走路與動作 ----

/** 現在站的這一層的標記（id、名字、記號、位置）。 */
export function netMarkers(game: Game): Array<{ id: string; mark: string; name: string; at: Cell }> {
  const at = game.state.maps.at
  if (!at) return []
  const inst = game.state.maps.instances[at.map]
  const def = inst?.gen?.map.sheets.find((s) => s.id === at.sheet)
  return (def?.cells ?? []).map((c) => ({ id: c.id, mark: c.mark, name: c.name ?? c.id, at: [...c.at] as Cell }))
}

/** 現在站的格子。 */
const posOf = (game: Game): Cell => {
  const at = game.state.maps.at
  if (!at) throw new Error('現在不在任何一張地圖上')
  return [at.x, at.y]
}

/**
 * 走到一格：路上踩到陷阱、被攔下會停在半路，就接著走（最多 12 趟）；每走一趟，戰鬥開了就交給 onBattle（預設不處理，戰鬥還開著就停下回傳）。
 * 走不過去丟錯（寫原因）。回傳走路的報告。
 */
export class WalkRefused extends Error {}

export async function netWalkCell(game: Game, to: Cell, onBattle?: () => Promise<boolean>): Promise<Report[]> {
  const out: Report[] = []
  for (let i = 0; i < 12; i++) {
    const here = posOf(game)
    if (here[0] === to[0] && here[1] === to[1]) return out
    const r = game.gridMove(to)
    if (r.status !== 'applied') throw new WalkRefused(`netWalkTo：走不過去（${r.reason ?? '沒有原因'}）`)
    out.push(...r.reports)
    if (game.battle) {
      if (!onBattle) return out
      if (!(await onBattle())) return out
    }
    if (!readNetRun(game.state)) return out
  }
  throw new Error(`netWalkTo：走了十二趟還沒到（現在在 ${posOf(game).join(',')}，要去 ${to.join(',')}）`)
}

/** 走到網內這一層的一個節點：標記的 id、'entry'（入口）或座標。走不過去丟錯（寫原因）；回傳走路的報告（路上開的戰鬥還開著，照 untilIdle 處理）。 */
export function netWalkTo(game: Game, to: string | Cell): Report[] {
  if (!readNetRun(game.state)) throw new Error('netWalkTo：現在不在網內的行程裡')
  const cell: Cell = Array.isArray(to) ? to : (() => {
    const m = to === 'entry' ? netMarkers(game).find((x) => x.mark === 'E') : netMarkers(game).find((x) => x.id === to)
    if (!m) throw new Error(`netWalkTo：這一層沒有「${to}」這個節點（有：${netMarkers(game).map((x) => x.id).join('、')}）`)
    return m.at
  })()
  const out: Report[] = []
  for (let i = 0; i < 12; i++) {
    const here = posOf(game)
    if (here[0] === cell[0] && here[1] === cell[1]) return out
    const r = game.gridMove(cell)
    if (r.status !== 'applied') throw new Error(`netWalkTo：走不過去（${r.reason ?? '沒有原因'}）`)
    out.push(...r.reports)
    if (game.battle || !readNetRun(game.state)) return out
  }
  throw new Error(`netWalkTo：走了十二趟還沒到（現在在 ${posOf(game).join(',')}，要去 ${cell.join(',')}）`)
}

/**
 * 在網內走 n 個探索回合：在入口與它旁邊的一個路口之間來回（不走遭遇節點，也不開戰）；行程中途結束（被定位、登出）就停。
 * 一趟路可能踩好幾個節點，所以照這一趟的探索回合數算，走到至少 n 個為止（最多走十二趟）。回傳走路的報告。
 */
export async function netWalkRounds(game: Game, n: number): Promise<Report[]> {
  const out: Report[] = []
  const run0 = readNetRun(game.state)
  if (!run0) throw new Error('netWalkRounds：現在不在網內的行程裡')
  const start = run0.round
  const sheet = game.state.maps.at!.sheet
  const nodes = netExt(game.state, run0.map)!.graph[sheet]!.nodes.filter((x) => x.kind !== 'net_foe')
  const entry = nodes.find((x) => x.kind === 'entry')!
  const other = nodes.filter((x) => x.id !== entry.id).sort((a, b) => dist(a.at as Cell, entry.at as Cell) - dist(b.at as Cell, entry.at as Cell))[0]
  if (!other) throw new Error('netWalkRounds：這一層沒有別的節點可以來回')
  const cells: Cell[] = [other.at as Cell, entry.at as Cell]
  for (let i = 0; i < 12; i++) {
    const run = readNetRun(game.state)
    if (!run || run.round - start >= n) break
    if (game.battle) break
    out.push(...(await netWalkCell(game, cells[i % 2]!)))
  }
  return out
}

/** 在站的（或旁邊的）節點上做一件事（useNode 的報告）：做什麼（fight、sneak、descend、pass、download、rest、seize……）、節點 id（沒寫是站的那一格）。 */
export function netUse(game: Game, what: string, at?: string): Report[] {
  return game.commit(useNode(game.k, game.state, what, at))
}

const dist = (a: Cell, b: Cell): number => Math.abs(a[0] - b[0]) + Math.abs(a[1] - b[1])

// ---- 一個內海階段 ----

export interface NetStageOptions {
  /** 分支（預設強攻） */
  branch?: string
  /** 不選面（已經選過了） */
  noFace?: boolean
  /** 打輸了就停下（預設丟錯） */
  allowLoss?: boolean
  /** 走到這一個節點的時候停下來（回傳還沒做的事交給呼叫的人）：給 'foe' 就是走到遭遇旁邊、還沒開戰 */
  stopAt?: 'foe' | 'gate'
  /** 只走這麼多層（往下一層之後就停下；預設走到整趟做完） */
  layers?: number
  /** 做到一半的時候叫它（冒煙在那裡存檔讀檔）：download 是第一次下載之後、第二次之前 */
  checkpoint?: (label: 'download') => void
}

/** 這個遭遇節點還有東西守著（沒處理過）。 */
function foeOpen(game: Game, markerId: string): boolean {
  const at = game.state.maps.at
  if (!at) return false
  const net = game.state.maps.instances[at.map]?.ext?.net as { foes?: Record<string, Record<string, { done?: boolean }>> } | undefined
  const node = net?.foes?.[at.sheet]?.[markerId]
  return !!node && node.done !== true
}

/** 站到一個標記旁邊（四個鄰格哪個走得到就去哪個）。已經在旁邊就不動。 */
export async function standBeside(game: Game, markerId: string, onBattle?: () => Promise<boolean>): Promise<Report[]> {
  const m = netMarkers(game).find((x) => x.id === markerId)
  if (!m) throw new Error(`standBeside：這一層沒有「${markerId}」`)
  if (dist(posOf(game), m.at) === 1) return []
  let last = ''
  for (const c of ([[0, -1], [1, 0], [0, 1], [-1, 0]] as const).map(([dx, dy]) => [m.at[0] + dx, m.at[1] + dy] as Cell)) {
    try {
      return await netWalkCell(game, c, onBattle)
    } catch (e) {
      if (!(e instanceof WalkRefused)) throw e
      last = e.message
    }
  }
  throw new Error(`standBeside：走不到「${m.name}」的旁邊（${last}）`)
}

/**
 * 玩一個內海階段（強攻一路打到底）：選內海面、選分支（網內的行程跟著開）；每一層走到遭遇節點旁邊開戰並打贏（路上撞到巡邏也打），
 * 再走到閘門通過（最後一層是出口）；目標是下載的，走到目標的檔案庫上做滿規定的次數。回傳這一階段的每一份報告。
 * 階段做完（交回 done）時停下；打輸（allowLoss）也停下。
 */
export async function playNetStage(game: Game, o: NetStageOptions = {}): Promise<Report[]> {
  const out: Report[] = []
  const win = async (): Promise<boolean> => {
    for (let i = 0; i < 6 && game.battle; i++) {
      const r = await fightOut(game)
      out.push(...r!.reports)
      if (r!.outcome !== 'win') {
        if (o.allowLoss) return false
        throw new Error(`playNetStage：戰鬥沒有打贏（${r!.outcome}）`)
      }
    }
    return true
  }
  const run0 = readRun(game.state)
  if (run0 && run0.step === 'face' && !o.noFace) out.push(...game.commit(chooseFace(game.k, game.state, 'net')))
  if (readRun(game.state)?.step === 'branch') out.push(...game.commit(chooseBranch(game.k, game.state, o.branch ?? 'assault')))
  if (!(await win())) return out
  const startLayer = readNetRun(game.state)?.layer ?? 0
  for (let guard = 0; guard < 40 && readNetRun(game.state); guard++) {
    if (o.layers !== undefined && readNetRun(game.state)!.layer - startLayer >= o.layers) return out
    const view = netrunView(game.k, game.state)!
    const marks = netMarkers(game)
    // 這一層還沒打的遭遇節點：站到旁邊開戰
    const foe = marks.find((m) => m.mark === 'f' && foeOpen(game, m.id))
    if (foe) {
      out.push(...(await standBeside(game, foe.id, win)))
      if (!readNetRun(game.state)) break
      if (!(await win())) return out
      if (o.stopAt === 'foe') return out
      if (foeOpen(game, foe.id)) out.push(...netUse(game, 'fight', foe.id))
      if (!(await win())) return out
      continue
    }
    // 目標是下載：走到目標的檔案庫上做滿
    const g = view.goal
    if (g.kind === 'download' && !g.done && view.layer.index === view.layer.total && g.at) {
      const m = marks.find((x) => x.id === g.at!.id)
      if (!m) throw new Error('playNetStage：找不到下載的目標節點')
      out.push(...(await netWalkCell(game, m.at, win)))
      for (let i = 0; i < (g.turns ?? 1) + 2 && readNetRun(game.state) && !netrunView(game.k, game.state)!.goal.done; i++) {
        out.push(...netUse(game, 'download'))
        if (!(await win())) return out
        if (i === 0) o.checkpoint?.('download')
      }
      continue
    }
    // 閘門：通過（最後一層是出口）或往下一層
    const gate = marks.find((m) => m.mark === 'g')
    if (!gate) throw new Error('playNetStage：這一層沒有閘門')
    out.push(...(await netWalkCell(game, gate.at, win)))
    if (!readNetRun(game.state)) break
    if (o.stopAt === 'gate') return out
    const here = netrunView(game.k, game.state)!
    const use = here.here.uses.find((u) => (u.id === 'pass' || u.id === 'descend') && !u.block)
    if (!use) throw new Error(`playNetStage：閘門上做不了通過（${here.here.uses.map((u) => `${u.id}:${u.block ?? '可'}`).join('、')}）`)
    out.push(...netUse(game, use.id))
    if (!(await win())) return out
  }
  return out
}

// ---- 第二波：迷宮館 ----

/** 迷宮館新手組只能用館方發的比賽版構裝：把隊上每個人身上的構裝卸下，換成比賽版的槍與近戰（快駭程式不算構裝，不動）。 */
export function refitForRookie(game: Game, ids: readonly string[] = game.state.party): void {
  const { k } = game
  for (const id of ids) {
    const ext = game.state.actors[id]?.ext.deck as { slots?: string[] } | undefined
    for (const item of [...(ext?.slots ?? [])]) if (k.content.has('construct', item) && !item.endsWith('_rent')) game.commit(removeDraft(k, game.state, id, item))
    for (const item of ['cs_tw_gun_rent', 'cs_tw_blade_rent']) {
      if (!((game.state.actors[id]?.ext.deck as { slots?: string[] } | undefined)?.slots ?? []).includes(item)) game.commit(installDraft(k, game.state, id, item))
    }
  }
}

/** 迷宮館報名（新手組；種子可以指定）。 */
export function mazeSignUp(game: Game, bracket = 'rookie', seed?: number): Report[] {
  return game.commit(mazeEnter(game.k, game.state, bracket, seed === undefined ? {} : { seed }))
}

/**
 * 把迷宮館這一趟走完（三層）：每一層解機關（站到旁邊解，失敗再解）、一個一個打贏遭遇、開寶箱（走到上面開）、走到閘門往下一層（最後一層通過出口）。
 * 擋路的東西（還沒解的機關、還沒打的遭遇）會讓後面的格子走不到：每一輪從現在走得到的事裡挑一件做，一件都做不了才丟錯。
 * 結算（maze.result）由迷宮館自己在通過之後接著發。回傳每一份報告。
 */
export async function playMaze(game: Game): Promise<Report[]> {
  const out: Report[] = []
  const win = async (): Promise<boolean> => {
    for (let i = 0; i < 6 && game.battle; i++) {
      const r = await fightOut(game)
      out.push(...r!.reports)
      if (r!.outcome !== 'win') throw new Error(`playMaze：戰鬥沒有打贏（${r!.outcome}）`)
    }
    return true
  }
  /** 走到（鄰接）某個地方；走不過去回傳 false。 */
  const reach = async (go: () => Promise<Report[]>): Promise<boolean> => {
    try {
      out.push(...(await go()))
      return true
    } catch (e) {
      if (e instanceof WalkRefused || /走不到/.test((e as Error).message)) return false
      throw e
    }
  }
  for (let guard = 0; guard < 60 && readNetRun(game.state); guard++) {
    const marks = netMarkers(game)
    let did = false
    // 機關：站到旁邊解開
    for (const p of marks.filter((m) => m.mark === 'm' && isPuzzleOpen(game, m.id))) {
      if (!(await reach(() => standBeside(game, p.id, win)))) continue
      for (let i = 0; i < 8 && isPuzzleOpen(game, p.id); i++) out.push(...game.commit(mazeSolve(game.k, game.state, p.id)))
      if (isPuzzleOpen(game, p.id)) throw new Error('playMaze：機關解了八次還沒開')
      did = true
      break
    }
    if (did) continue
    // 遭遇：一個一個打
    for (const foe of marks.filter((m) => m.mark === 'f' && foeOpen(game, m.id))) {
      if (!(await reach(() => standBeside(game, foe.id, win)))) continue
      if (!readNetRun(game.state)) return out
      if (foeOpen(game, foe.id)) out.push(...netUse(game, 'fight', foe.id))
      await win()
      did = true
      break
    }
    if (did) continue
    // 寶箱：走得到的就走到上面開一次（走不到的不要了，不影響過關）
    for (const chest of marks.filter((m) => m.mark === 'a' && !chestOpened(game, m.id))) {
      if (!(await reach(() => netWalkCell(game, chest.at, win)))) continue
      if (!readNetRun(game.state)) return out
      out.push(...game.commit(mazeOpen(game.k, game.state, chest.id)))
      if (!chestOpened(game, chest.id)) throw new Error('playMaze：寶箱開了還沒記成開過')
      did = true
      break
    }
    if (did) continue
    // 閘門
    const gate = marks.find((m) => m.mark === 'g')
    if (!gate) throw new Error('playMaze：這一層沒有閘門')
    if (!(await reach(() => netWalkCell(game, gate.at, win)))) throw new Error(`playMaze：卡住了：機關、遭遇、寶箱都處理完了，閘門還是走不到（在 ${posOf(game).join(',')}）`)
    if (!readNetRun(game.state)) break
    const here = netrunView(game.k, game.state)!
    const use = here.here.uses.find((u) => (u.id === 'pass' || u.id === 'descend') && !u.block)
    if (!use) throw new Error(`playMaze：閘門上做不了通過（${here.here.uses.map((u) => `${u.id}:${u.block ?? '可'}`).join('、')}）`)
    out.push(...netUse(game, use.id))
    await win()
  }
  return out
}

/** 這個機關還沒解開（格子還是 net_puzzle）。 */
function isPuzzleOpen(game: Game, markerId: string): boolean {
  const here = gridHere(game.k, game.state)
  const m = netMarkers(game).find((x) => x.id === markerId)
  return !!here && !!m && here.sheet.kindAt(m.at[0], m.at[1]) === 'net_puzzle'
}

/** 這個寶箱開過了（格子記了 used）。 */
function chestOpened(game: Game, markerId: string): boolean {
  const here = gridHere(game.k, game.state)
  const m = netMarkers(game).find((x) => x.id === markerId)
  return !!here && !!m && here.sheetState.cells[pointKey(m.at[0], m.at[1])]?.used === true
}

export type { GameState }
