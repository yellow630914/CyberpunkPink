// 測試基礎建設：簾後館一趟的「會玩的玩家」（dev/test-harness.md 第 1 節；dev/work/M4-smoke.md 第 3 點「簾後館」）。
//
// 簾後館的一趟是活動 netrun（四幕、每一幕一層）：每一層走到遭遇旁邊開戰並打贏（有的遭遇守在別的遭遇後面，走不到旁邊的先跳過、做完擋路的再來）、
// 點單與賞箱可以順手做（extras）、走到閘門往下一幕（最後一幕走到出口）。走完之後結算由簾後館自己在 netrun.close 接著發。
// 和 playMaze 同一個辦法，只是沒有機關與迷宮館的寶箱。

import type { Report } from '../core'
import { netrunView, readRun as readRunOf } from '../features/netrun'
import { useCurtain } from '../features/curtain'
import type { Game } from '../shell/game'
import { WalkRefused, netMarkers, netUse, netWalkCell, standBeside } from './scenariosNet'

/**
 * 一場內海戰鬥的「更會玩的玩家」（playNetOut 的加強版，簾後館這種一場接一場的趟用；playNetOut 在武器構裝破損、手上只剩干擾與近戰的時候會僵住）：
 * 有不是干擾的攻擊構裝就攻擊、近戰打得到就近戰、攻擊用不了就用工具構裝（對敵人加感載）、再不行換一個沒破損的構裝、RAM 不夠就回填；其餘結束回合。
 * 只打到分出結果；結算（game.finishBattle）由呼叫的人做。
 */
export function playNetSmart(game: Game, maxSteps = 200): { outcome: string; steps: number } {
  let steps = 0
  while (game.battle && !game.battle.result) {
    if (++steps > maxSteps) throw new Error(`內海的戰鬥打了 ${maxSteps} 步還沒分出結果`)
    const o = game.battleOptions()
    if (!o || o.waiting === 'over') break
    if (o.waiting === 'ai') {
      const r = game.battleNext()
      if (r.status !== 'applied') throw new Error(`自動戰鬥的一步沒有成立：${(r.reasons ?? []).join(' ')}`)
      continue
    }
    const me = game.battle!.units[o.current!]!
    const ok = (id: string) => o.actions.find((a) => a.id === id && a.ok)
    const hit = (a: { id: string; targets: Array<{ target: unknown; blocks: string[] }> } | undefined): { action: string; target: { unit: string } } | null => {
      const t = a?.targets.find((x) => x.blocks.length === 0 && typeof x.target === 'object' && x.target !== null && 'unit' in x.target)
      return a && t ? { action: a.id, target: t.target as { unit: string } } : null
    }
    const holdingJam = me.weapons[me.wield]?.traits.includes('jam') === true
    let input: { action: string; target?: { unit: string }; pick?: Record<string, unknown> } | null = null
    if (!holdingJam) input = hit(ok('net_attack')) ?? hit(ok('net_melee'))
    if (!input) {
      const tool = o.actions.find((a) => a.id.startsWith('net_tool:') && a.ok)
      input = hit(tool)
    }
    if (!input && ok('net_swap')) {
      const broken = ((me.ext.net as { broken?: string[] } | undefined)?.broken) ?? []
      const to = me.weapons.findIndex((w, i) => i !== me.wield && !broken.includes(w.id) && !w.traits.includes('jam'))
      if (to >= 0) input = { action: 'net_swap', pick: { weapon: to } }
    }
    if (!input && ok('net_refill') && (me.pools.ram?.now ?? 99) < 2) input = { action: 'net_refill' }
    const r = game.battleAct((input ?? { action: 'end_turn' }) as never)
    if (r.status !== 'applied') throw new Error(`內海的一步沒有成立（${(input ?? { action: 'end_turn' }).action}）：${(r.reasons ?? []).join(' ')}`)
  }
  if (!game.battle?.result) throw new Error('現在沒有在戰鬥')
  return { outcome: game.battle.result.outcome, steps }
}

/** 打完眼前的內海戰鬥並結算；沒有戰鬥回傳 null。 */
async function fightSmart(game: Game): Promise<{ outcome: string; reports: Report[] } | null> {
  if (!game.battle) return null
  const { outcome } = playNetSmart(game)
  return { outcome, reports: (await game.finishBattle()).reports }
}

export interface CurtainPlayOptions {
  /** 順手做點單（走到點單的人上面、擲、接受）與賞箱（走到上面開）；預設不做 */
  extras?: boolean
  /** 走完這一幕（第幾幕，1 起算；序幕是第 1 層）就停下，不往下一幕 */
  stopAfterLayer?: number
  /** 打輸了就停下（預設丟錯） */
  allowLoss?: boolean
  /** 每打完一場（結算之後）叫一次（除錯與逐場檢查用） */
  onFight?: (game: Game, outcome: string) => void
}

export interface CurtainPlayResult {
  reports: Report[]
  /** 做過的點單（marker id） */
  orders: string[]
  /** 開過的賞箱（marker id） */
  chests: string[]
}

/** 這個遭遇節點還有東西守著。 */
function foeOpen(game: Game, markerId: string): boolean {
  const at = game.state.maps.at
  if (!at) return false
  const net = game.state.maps.instances[at.map]?.ext?.net as { foes?: Record<string, Record<string, { done?: boolean }>> } | undefined
  const node = net?.foes?.[at.sheet]?.[markerId]
  return !!node && node.done !== true
}

/** 把簾後館這一趟走完（或走到 stopAfterLayer）。回傳每一份報告與做過的點單、賞箱。 */
export async function playCurtainRun(game: Game, o: CurtainPlayOptions = {}): Promise<CurtainPlayResult> {
  const out: Report[] = []
  const res: CurtainPlayResult = { reports: out, orders: [], chests: [] }
  const win = async (): Promise<boolean> => {
    for (let i = 0; i < 6 && game.battle; i++) {
      const r = await fightSmart(game)
      out.push(...r!.reports)
      o.onFight?.(game, r!.outcome)
      if (r!.outcome !== 'win') {
        if (o.allowLoss) return false
        throw new Error(`playCurtainRun：戰鬥沒有打贏（${r!.outcome}）`)
      }
    }
    return true
  }
  const reach = async (go: () => Promise<Report[]>): Promise<boolean> => {
    try {
      out.push(...(await go()))
      return true
    } catch (e) {
      if (e instanceof WalkRefused || /走不到/.test((e as Error).message)) return false
      throw e
    }
  }
  const seenExtras = new Set<string>()
  for (let guard = 0; guard < 80 && game.state.maps.at && readNetRun(game); guard++) {
    const view = netrunView(game.k, game.state)!
    if (o.stopAfterLayer !== undefined && view.layer.index > o.stopAfterLayer) return res
    const marks = netMarkers(game)
    let did = false
    // 遭遇：一個一個打（擋路的先跳過）
    for (const foe of marks.filter((m) => m.mark === 'f' && foeOpen(game, m.id))) {
      if (!(await reach(() => standBeside(game, foe.id, win)))) continue
      if (!readNetRun(game)) return res
      if (foeOpen(game, foe.id)) out.push(...netUse(game, 'fight', foe.id))
      if (!(await win())) return res
      did = true
      break
    }
    if (did) continue
    // 順手做的：點單與賞箱
    if (o.extras) {
      for (const m of marks.filter((x) => (x.mark === 'p' || x.mark === 'a') && !seenExtras.has(`${view.layer.index}:${x.id}`))) {
        seenExtras.add(`${view.layer.index}:${m.id}`)
        if (!(await reach(() => netWalkCell(game, m.at, win)))) continue
        if (!readNetRun(game)) return res
        try {
          if (m.mark === 'p') {
            out.push(...game.commit(useCurtain(game.k, game.state, 'order')))
            res.orders.push(m.id)
          } else {
            out.push(...game.commit(useCurtain(game.k, game.state, 'chest')))
            res.chests.push(m.id)
          }
        } catch {
          // 這一格不是點單或賞箱（終幕的 p 是獎品室等）：略過
        }
        did = true
        break
      }
    }
    if (did) continue
    // 閘門（最後一層是出口）
    const gate = marks.find((m) => m.mark === 'g')
    if (!gate) throw new Error('playCurtainRun：這一層沒有閘門')
    if (!(await reach(() => netWalkCell(game, gate.at, win)))) throw new Error(`playCurtainRun：卡住了：遭遇都處理完了，閘門還是走不到（第 ${view.layer.index} 層）`)
    if (!readNetRun(game)) break
    const here = netrunView(game.k, game.state)!
    const use = here.here.uses.find((u) => (u.id === 'pass' || u.id === 'descend') && !u.block)
    if (!use) throw new Error(`playCurtainRun：閘門上做不了通過（${here.here.uses.map((u) => `${u.id}:${u.block ?? '可'}`).join('、')}）`)
    out.push(...netUse(game, use.id))
    if (!(await win())) return res
  }
  return res
}

const readNetRun = (game: Game) => readRunOf(game.state)
