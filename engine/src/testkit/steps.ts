// 測試基礎建設：M2 的步驟（dev/work/M2-smoke.md 第 3、4 點）。冒煙測試與種子重播共用同一組：
// 一個步驟是「玩家做的一件事」，走和介面一樣的路（匯出的純函式拿報告草稿、交給 Game.commit），不碰狀態。
// 種子重播用 { type: 'm2', do: <名字>, ...參數 } 呼叫（見 repro.ts）；冒煙測試直接 import 這裡的函式。

import type { Report, ReportDraft } from '../core/types'
import { readRun, chooseBranch, chooseFace, retreat } from '../features/commission'
import { acceptDefeat } from '../features/defeat'
import { exploreFeature } from '../features/explore'
import { accept, board, go, latestJob, scout } from '../features/fixer'
import { join, muster } from '../features/roster'
import { rentDraft, sleepDraft } from '../features/rest'
import { checkout } from '../features/trade'
import { advance, alight, board as boardRide, wait } from '../features/transit'
import { shift } from '../features/work'
import type { Game } from '../shell/game'
import { FIXER, RUNNER, fightOut, passTime, passUntil, untilIdle, walkAcross, walkTo } from './scenarios'

type Cell = [number, number]

/** 一張版面上第一個標了這個記號（X 撤離點、T 目標……）的格子的 id。找不到是 null。 */
export function markerByMark(game: Game, mark: string): string | null {
  const at = game.state.maps.at
  if (!at) return null
  const def = game.k.content.get<{ id: string; sheets?: Array<{ id: string; cells?: Array<{ id: string; mark: string; at: Cell }> }> }>('special_map', game.state.maps.instances[at.map]!.def)
  return def?.sheets?.find((s) => s.id === at.sheet)?.cells?.find((c) => c.mark === mark)?.id ?? null
}

/**
 * 玩一個副本的階段（強攻一路打到底）：選現實面、選分支、入口就被看到時先打、走到保全崗打贏；
 * 有「拿東西」的目標就走到目標、拿了、再走到撤離點。每一場戰鬥都打贏並結算。回傳這一階段的每一份報告。
 */
export async function playStage(game: Game, branchId = 'assault'): Promise<Report[]> {
  const out: Report[] = []
  const settle = async (): Promise<void> => {
    for (let i = 0; i < 6 && game.battle; i++) {
      const r = await fightOut(game)
      if (r!.outcome !== 'win') throw new Error(`playStage：戰鬥沒有打贏（${r!.outcome}）`)
      out.push(...r!.reports)
    }
  }
  out.push(...game.commit(chooseFace(game.k, game.state, 'meat')))
  out.push(...game.commit(chooseBranch(game.k, game.state, branchId)))
  await settle()
  const run = readRun(game.state)
  if (!run || run.step !== 'play') return out
  const face = run.def.stages[run.stage - 1]!.faces.meat as unknown as { post?: string; goal?: { kind: string; at: string } }
  if (face.post) {
    out.push(...walkTo(game, face.post))
    await settle()
  }
  if (readRun(game.state)?.step === 'play' && face.goal) {
    out.push(...walkTo(game, face.goal.at))
    await settle()
    if (face.goal.kind === 'take') out.push(...game.commit(exploreFeature.useHere(game.k, game.state, 'take')))
    const exit = markerByMark(game, 'X')
    if (exit) out.push(...walkTo(game, exit))
    await settle()
  }
  return out
}

/** 這個階段的保全還沒打：站著不動就走到保全崗（入口就被看到時已經開打了，什麼都不做）。回傳走路的報告。 */
export function engage(game: Game): Report[] {
  if (game.battle) return []
  const run = readRun(game.state)
  if (!run || run.step !== 'play') throw new Error('engage：現在沒有在副本的某個階段裡')
  const face = run.def.stages[run.stage - 1]!.faces.meat as unknown as { post?: string }
  if (!face.post) throw new Error('engage：這個階段沒有保全崗')
  return walkTo(game, face.post)
}

/** 搭一趟車：在車站上車、等車、一站一站坐到目的地、下車。回傳每一份報告。 */
export function rideTo(game: Game, line: string, dest: string, pay: 'cred' | 'cash' = 'cred'): Report[] {
  const out: Report[] = []
  out.push(...game.commit(boardRide(game.k, game.state, { line, pay, dest })))
  out.push(...game.commit(wait(game.k, game.state)))
  for (let i = 0; i < 20; i++) {
    const r = game.commit(advance(game.k, game.state))
    out.push(...r)
    if (r.some((x) => x.outcome.summary.includes('這是你要去的那一站'))) break
  }
  out.push(...game.commit(alight(game.k, game.state)))
  return out
}

/** 在戰鬥裡投降（輪到主角時按「投降」；還沒輪到就讓 AI 先走）並結算；回傳結算的報告（等著選的戰敗從這裡開始）。 */
export async function surrender(game: Game): Promise<Report[]> {
  if (!game.battle) throw new Error('surrender：現在沒有在戰鬥')
  for (let i = 0; i < 40 && game.battleOptions()?.waiting === 'ai'; i++) {
    const r = game.battleNext()
    if (r.status !== 'applied' || r.over) break
  }
  const r = game.battleAct({ action: 'surrender' })
  if (r.status !== 'applied') throw new Error(`surrender：投降沒有成立（${(r.reasons ?? []).join('')}）`)
  return (await game.finishBattle()).reports
}

// ---- 種子重播用的步驟表 ----

type Args = Record<string, unknown>
const str = (a: Args, key: string): string => {
  const v = a[key]
  if (typeof v !== 'string') throw new Error(`步驟缺少字串參數 ${key}`)
  return v
}
const num = (a: Args, key: string, fallback?: number): number => {
  const v = a[key]
  if (typeof v === 'number') return v
  if (fallback !== undefined) return fallback
  throw new Error(`步驟缺少數字參數 ${key}`)
}
const commit = (game: Game, d: ReportDraft): void => void game.commit(d)

/**
 * 步驟名 → 做法。參數寫在步驟上（{ type: 'm2', do: 'walk', to: 'E2' }）。
 *   walk { to: 標記 id、[x, y] 或 'across'（穿過這條街） }、pass { minutes }、pass_until { day, hour, minute? }、flag { key, value }
 *   rent { id }、ride { line, dest, pay? }、buy { shop, item, qty?, pay? }、work { job, hours }、sleep
 *   until_idle、offer { index? }（接中間人桌上的第 index 件，預設 0，付現金）、scout { method? }、muster（名冊的行者進隊）、go、stage { branch? }、retreat
 *   surrender、accept_defeat、rewind_stage
 */
export const M2_STEPS: Record<string, (game: Game, a: Args) => void | Promise<void>> = {
  walk: (g, a) => void (a.to === 'across' ? walkAcross(g) : walkTo(g, Array.isArray(a.to) ? (a.to as Cell) : str(a, 'to'))),
  pass: (g, a) => void passTime(g, num(a, 'minutes')),
  pass_until: (g, a) => void passUntil(g, { day: num(a, 'day'), hour: num(a, 'hour'), minute: num(a, 'minute', 0) }),
  flag: (g, a) => commit(g, { kind: 'system', action: 'test.flag', location: {}, party: [], timeline: [], changes: [{ op: 'flag', key: str(a, 'key'), value: a.value as never }], outcome: { result: 'ok', summary: '測試用的旗標。' } }),
  rent: (g, a) => commit(g, rentDraft(g.k, g.state, str(a, 'id'))),
  ride: (g, a) => void rideTo(g, str(a, 'line'), str(a, 'dest'), a.pay === 'cash' ? 'cash' : 'cred'),
  buy: (g, a) => commit(g, checkout(g.k, g.state, str(a, 'shop'), { buy: [{ item: str(a, 'item'), qty: num(a, 'qty', 1) }], pay: a.pay === 'cred' ? 'cred' : 'cash' })),
  work: (g, a) => commit(g, shift(g.k, g.state, str(a, 'job'), num(a, 'hours'))),
  sleep: (g) => commit(g, sleepDraft(g.k, g.state)),
  until_idle: async (g) => void (await untilIdle(g)),
  offer: (g, a) => {
    const row = board(g.k, g.state, FIXER).offers[num(a, 'index', 0)]
    if (!row) throw new Error('offer：中間人桌上沒有這一件')
    commit(g, accept(g.k, g.state, { id: row.id, fixer: FIXER }, { pay: 'cash' }))
  },
  scout: (g, a) => {
    const job = latestJob(g.state)
    if (!job) throw new Error('scout：手上沒有委託')
    commit(g, scout(g.k, g.state, job.id, typeof a.method === 'string' ? a.method : 'survey'))
  },
  muster: (g) => {
    commit(g, join(g.k, g.state, RUNNER, { pay: 'share' }))
    commit(g, muster(g.k, g.state, { party: [RUNNER], tagalong: [] }))
  },
  go: (g) => {
    const job = latestJob(g.state)
    if (!job) throw new Error('go：手上沒有委託')
    commit(g, go(g.k, g.state, job.id))
  },
  stage: async (g, a) => void (await playStage(g, typeof a.branch === 'string' ? a.branch : 'assault')),
  retreat: (g) => commit(g, retreat(g.k, g.state)),
  surrender: async (g) => void (await surrender(g)),
  accept_defeat: (g) => commit(g, acceptDefeat(g.k, g.state)),
  rewind_stage: (g) => {
    const why = g.rewindToStage()
    if (why) throw new Error(`rewind_stage：${why}`)
  },
}

/** 做一個步驟。 */
export async function doStep(game: Game, name: string, args: Args = {}): Promise<void> {
  const fn = M2_STEPS[name]
  if (!fn) throw new Error(`沒有「${name}」這個步驟（可以用的：${Object.keys(M2_STEPS).join('、')}）`)
  await fn(game, args)
}

