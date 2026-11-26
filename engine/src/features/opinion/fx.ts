// 招與反應的效果（OP_EFFECTS）解譯，和反應的觸發（OP_TRIGGERS）。效果只改戰役的狀態（不進 k.effects）：
//   聲量、風向、抽牌、設防、多佔幾格、防守與牌面的加減、編輯點、對手的公關點、直接佔格、免相鄰、讓對手的一步無效、風向反過來、搶回格子、擲骰、旗標、戰役外的效果。
// 不改狀態以外的任何東西；亂數都從這份報告的 run.rng 取（同一個種子、同樣的操作，整場逐份報告相同）。
// 反應：玩家在結束回合時決定要不要預留編輯點（有 cost 的）；沒有 cost 的自動發動。對手的回合裡每一步先問反應，再做那一步。

import type { ContentEntry } from '../../core'
import { checkParts, makeCheck } from '../../core'
import { cellScore, cellsOwnedBy } from './board'
import type { OpEffect, OpReact, OpTrigger } from './hooks'
import type { Cell, Seat } from './model'
import { CELL_NAME, isCell } from './model'
import type { Run } from './run'
import { modVars } from './mods'
import { whenHolds } from './when'

export interface FxInput {
  /** 設防選的一格 */
  cell?: string
  /** 設防選的幾格（效果 guard 的 cells 是數字時） */
  cells?: string[]
  /** 抽牌再棄時，自己選要棄哪幾張（手牌的第幾張，從 0 起）；沒選就棄花費最低的 */
  discard?: number[]
}

export interface FxCtx {
  /** 給紀錄用的名字（招或被動） */
  src: string
  /** 誰付的點、誰擲的骰（沒有就是第一個座位的人） */
  actor?: string
  seat?: Seat
  input?: FxInput
  /** 反應：觸發它的是哪一步 */
  trig?: { on: string; cell?: Cell; amount?: number }
}

export interface FxFlags {
  negated: boolean
  reversed: boolean
  retaken: boolean
}
export const newFlags = (): FxFlags => ({ negated: false, reversed: false, retaken: false })

const sign = (n: number): string => `${n >= 0 ? '+' : '−'}${Math.abs(n)}`
const names = (cells: Cell[]): string => cells.map((c) => `「${CELL_NAME[c]}」`).join('、')

/** 一件事（招或反應）用到的座位：指定的人、沒有就第一個。 */
export const seatOf = (run: Run, actor?: string): Seat => run.w.desk.find((s) => s.actor === actor) ?? run.w.desk[0]!

/** 設防的格子：自己的、照效果寫的挑。 */
function guardCells(run: Run, e: OpEffect, input: FxInput | undefined): Cell[] {
  const w = run.w
  const mine = cellsOwnedBy(w, 'you')
  const spec = e.cells
  if (spec === 'all') return mine
  if (spec === 'pick') return typeof input?.cell === 'string' && isCell(input.cell) && mine.includes(input.cell) ? [input.cell] : []
  if (Array.isArray(spec)) return (spec as string[]).filter((c): c is Cell => isCell(c) && mine.includes(c))
  const n = spec as number
  const picked = (input?.cells ?? []).filter((c): c is Cell => isCell(c) && mine.includes(c))
  const rest = mine.filter((c) => !picked.includes(c)).sort((a, b) => cellScore(w, b) - cellScore(w, a))
  return [...picked, ...rest].slice(0, n)
}

/** 直接佔格（效果 take）：不看相鄰、不用這回合的佔領次數。 */
function takeCells(run: Run, e: OpEffect, lines: string[]): void {
  const w = run.w
  const taken: Cell[] = []
  const zero: Cell[] = []
  for (const c of (e.cells as string[]).filter(isCell)) {
    const owner = w.cells[c].owner
    if (owner === 'you') continue
    if (owner === null || e.if === 'any') {
      w.cells[c] = { owner: 'you' }
      taken.push(c)
    } else if (e.foe_def_zero === true) zero.push(c)
  }
  if (e.foe_def_zero === true) for (const c of (e.cells as string[]).filter(isCell)) if (w.cells[c].owner === 'foe' && !zero.includes(c)) zero.push(c)
  for (const c of zero) if (!w.zero_def.includes(c)) w.zero_def.push(c)
  if (taken.length > 0) lines.push(`直接佔下${names(taken)}（不必相鄰、不花聲量）`)
  if (zero.length > 0) lines.push(`${names(zero)}這回合的防守當作 0`)
  if (taken.length === 0 && zero.length === 0) lines.push('沒有格子可以直接佔')
}

/** 擲一次：skill 是 'd20' 就是純擲骰（骰面不低於 dc 算過）；其餘照基本功擲檢定（骰面加屬性、基本功與修正）。回傳過不過與那一拍要記的數字。 */
function rollOf(run: Run, actor: string | undefined, skill: string, dc: number): { pass: boolean; data: Record<string, unknown> } {
  const natural = run.rng.int(1, 20)
  if (skill === 'd20') return { pass: natural >= dc, data: { skill, dc, roll: natural, total: natural } }
  const who = actor && run.state.actors[actor] ? actor : run.state.pc
  if (!who || !run.state.actors[who]) return { pass: natural >= dc, data: { skill, dc, roll: natural, total: natural } }
  const entry = run.k.content.hasKind('skill') ? run.k.content.get<ContentEntry & { attr?: string }>('skill', skill) : undefined
  const attr = (typeof entry?.attr === 'string' ? entry.attr : 'charm') as 'charm'
  const check = makeCheck({ natural, parts: checkParts(run.k.stats, run.state, who, { attr, skill, tags: ['opinion'] }), dc, attr, skill })
  return { pass: check.degree === 'success' || check.degree === 'critical', data: { skill, dc, roll: natural, total: check.total, degree: check.degree } }
}

/**
 * 做一串效果。lines 接上每一筆做了什麼（給玩家看的完整句子的片段，沒有句號）；flags 記 negate、reverse、retake。
 * 效果的格式在登記時就驗過了（opinion.check）：這裡遇到不認得的當作沒有這筆，不丟錯。
 */
export function applyEffects(run: Run, effects: OpEffect[], cx: FxCtx, flags: FxFlags, lines: string[], depth = 0): void {
  const w = run.w
  for (const e of effects) {
    switch (e.kind) {
      case 'voice': {
        const n = e.amount as number
        run.addVoice('you', n)
        lines.push(`你的聲量 ${sign(n)}（現在 ${w.voice.you}）`)
        break
      }
      case 'foe_voice': {
        const n = e.amount as number
        run.addVoice('foe', n)
        lines.push(`對手的聲量 ${sign(n)}（現在 ${w.voice.foe}）`)
        break
      }
      case 'wind': {
        const got = run.pushWind(e.amount as number)
        lines.push(`風向 ${sign(got)}（現在 ${w.wind >= 0 ? '+' : ''}${w.wind}）`)
        break
      }
      case 'draw': {
        const got = run.draw(e.n as number)
        const back = (e.then_discard as number | undefined) ?? 0
        let gone: string[] = []
        if (back > 0) {
          const picked = [...new Set(cx.input?.discard ?? [])].filter((i) => Number.isInteger(i) && i >= 0 && i < w.hand.length).slice(0, back)
          if (picked.length === back) {
            gone = [...picked].sort((a, b) => b - a).map((i) => w.hand.splice(i, 1)[0]!)
            w.discard.push(...gone)
          } else gone = run.discardCheapest(back)
        }
        lines.push(`抽了 ${got.length} 張牌${back > 0 ? `，再棄掉 ${gone.length} 張` : ''}`)
        break
      }
      case 'guard': {
        const cells = guardCells(run, e, cx.input)
        const until = w.round + ((e.rounds as number | undefined) ?? 1) - 1
        for (const c of cells) w.cells[c] = { ...w.cells[c], guard: Math.max(w.cells[c].guard ?? 0, until) }
        lines.push(cells.length > 0 ? `替${names(cells)}設防${until > w.round ? `（到第 ${until} 回合）` : ''}` : '沒有格子可以設防')
        break
      }
      case 'capture_extra': {
        const n = e.n as number
        w.captures += n
        for (let i = 0; i < n; i++) w.xcap.push({ def: (e.def as number | undefined) ?? 0, any: e.any === true })
        lines.push(`這回合多佔 ${n} 格（照付聲量${e.def !== undefined ? `，防守 ${sign(e.def as number)}` : ''}${e.any === true ? '，不必相鄰' : ''}）`)
        break
      }
      case 'def_mod': {
        w.defmods.push({
          amount: e.amount as number, scope: e.scope as 'next' | 'turn' | 'war', ...(e.vs ? { vs: e.vs as 'empty' | 'foe' } : {}),
          ...(Array.isArray(e.cells) ? { cells: (e.cells as string[]).filter(isCell) } : {}), ...(e.first_each_turn === true ? { first: true } : {}),
        })
        lines.push(`你佔格子的防守 ${sign(e.amount as number)}（${e.scope === 'next' ? '下一次' : e.scope === 'turn' ? '這回合' : '到這場結束'}）`)
        break
      }
      case 'card_mod': {
        w.cardmods.push({
          card: e.card as 'fuel' | 'line', scope: e.scope as 'next' | 'turn', ...(e.amount !== undefined ? { amount: e.amount as number } : {}),
          ...(e.mult !== undefined ? { mult: e.mult as number } : {}), ...(e.cap !== undefined ? { cap: e.cap as number } : {}),
        })
        lines.push(`你這回合${e.scope === 'next' ? '打出的下一張' : '打出的'}${e.card === 'fuel' ? '料' : '說法'}牌${e.mult !== undefined ? `數字 ×${e.mult}` : `數字 ${sign(e.amount as number)}`}`)
        break
      }
      case 'ep': {
        const seat = cx.seat ?? seatOf(run, cx.actor)
        const n = e.amount as number
        seat.ep = Math.max(0, seat.ep + n)
        if (e.scope === 'war') seat.ep_max = Math.max(0, Math.min(12, seat.ep_max + n))
        lines.push(`編輯點 ${sign(n)}${e.scope === 'war' ? '（到這場結束）' : ''}`)
        break
      }
      case 'foe_pr': {
        const n = e.amount as number
        w.foe_state.pr_mod = (w.foe_state.pr_mod ?? 0) + n
        lines.push(`對手下一回合的公關點 ${sign(n)}`)
        break
      }
      case 'take': takeCells(run, e, lines); break
      case 'free_adjacency':
        w.free_adj = true
        lines.push('到這場結束，你的佔領不必和自己的格子相鄰')
        break
      case 'negate':
        flags.negated = true
        lines.push('那一步無效')
        break
      case 'reverse':
        flags.reversed = true
        lines.push('那一次的風向反過來，往你這邊推')
        break
      case 'retake': {
        const c = cx.trig?.cell
        if (c && w.cells[c].owner === 'foe') {
          w.cells[c] = { owner: 'you' }
          flags.retaken = true
          lines.push(`「${CELL_NAME[c]}」立刻搶回來了`)
        }
        break
      }
      case 'link_voice': {
        if (w.links.length > 0) {
          run.addVoice('you', e.amount as number)
          lines.push(`把前面階段拿到的連動再用一次，聲量 +${e.amount as number}（現在 ${w.voice.you}）`)
        } else {
          const el = e.else as { skill: string; dc: number; pass: number | OpEffect[]; fail: number | OpEffect[] }
          const r = rollOf(run, cx.actor, el.skill, el.dc)
          run.note(`${cx.src}：沒有連動可以用，改擲一次${el.skill === 'd20' ? '' : '檢定'}：骰 ${String(r.data.roll)}，合計 ${String(r.data.total)} 對 ${el.dc}，${r.pass ? '成功' : '失敗'}。`, { tag: 'opinion.roll', data: { ...r.data, pass: r.pass } })
          const side = r.pass ? el.pass : el.fail
          if (typeof side === 'number') {
            run.addVoice('you', side)
            lines.push(`${r.pass ? '成功' : '失敗'}，聲量 ${sign(side)}（現在 ${w.voice.you}）`)
          } else {
            lines.push(r.pass ? '成功' : '失敗')
            applyEffects(run, side, cx, flags, lines, depth + 1)
          }
        }
        break
      }
      case 'roll': {
        const r = rollOf(run, cx.actor, e.skill as string, e.dc as number)
        run.note(`${cx.src}：擲${e.skill === 'd20' ? ' d20' : '檢定'}：骰 ${String(r.data.roll)}，合計 ${String(r.data.total)} 對 ${e.dc as number}，${r.pass ? '成功' : '失敗'}。`, { tag: 'opinion.roll', data: { ...r.data, pass: r.pass } })
        lines.push(r.pass ? '擲骰成功' : '擲骰失敗')
        applyEffects(run, (r.pass ? e.pass : e.fail) as OpEffect[], cx, flags, lines, depth + 1)
        break
      }
      case 'mark':
        w.marks[e.key as string] = w.round
        break
      case 'out':
        w.out.push({ ...(e.effect as Record<string, unknown>) })
        lines.push('戰役外還有一筆後果，結算時才算')
        break
      default: break
    }
  }
}

// ---- 反應 ----

export const reactKey = (passiveId: string, i: number): string => `${passiveId}:${i}`
const onList = (r: OpReact): string[] => (Array.isArray(r.on) ? r.on : [r.on])

/** 一個反應這一刻還能不能發動的次數限制。 */
function usable(run: Run, key: string, r: OpReact): boolean {
  if (!r.limit) return true
  return (run.w.moves_used[`${r.limit.per}:${key}`] ?? 0) < r.limit.n
}

/**
 * 觸發點到了：每個寫了這個觸發點的反應照順序問一次（次數沒用完、旗標對得上、條件成立；有 cost 的要玩家預留過）。
 * 發動的反應做它的效果，在紀錄裡留一拍（opinion.react）。回傳 negate、reverse、retake 有沒有人用到。
 */
export function fireReactions(run: Run, on: OpTrigger, cx: { cell?: Cell; amount?: number } = {}): FxFlags {
  const flags = newFlags()
  const w = run.w
  for (const p of w.passives) {
    ;(p.reacts ?? []).forEach((r, i) => {
      if (!onList(r).includes(on)) return
      const key = reactKey(p.id, i)
      if (!usable(run, key, r)) return
      if (r.if_mark !== undefined && w.marks[r.if_mark] !== w.round) return
      if (r.when !== undefined && !whenHolds(r.when, modVars(w, run.env))) return
      let paid: { seat: string } | null = null
      if (r.cost !== undefined) {
        const at = w.reserved.findIndex((x) => x.key === key)
        if (at < 0) return
        paid = { seat: w.reserved[at]!.seat }
        w.reserved.splice(at, 1)
      }
      w.moves_used[`turn:${key}`] = (w.moves_used[`turn:${key}`] ?? 0) + 1
      w.moves_used[`war:${key}`] = (w.moves_used[`war:${key}`] ?? 0) + 1
      const seat = seatOf(run, paid?.seat ?? p.actor)
      const lines: string[] = []
      applyEffects(run, r.effects, { src: p.name, actor: seat.actor, seat, trig: { on, ...cx } }, flags, lines)
      run.note(`${p.name}：${lines.join('，')}。`, { tag: 'opinion.react', actor: seat.actor, data: { id: p.id, on, cost: r.cost ?? 0, ...(cx.cell ? { cell: cx.cell } : {}) }, plain: `${p.name}派上用場了。` })
    })
  }
  return flags
}

/** 有 cost 的反應：key、名字、花費、它屬於哪個座位（給畫面列「預留」的選項）。 */
export interface Reservable {
  key: string
  name: string
  cost: number
  on: string[]
  seat: string
  /** 預留得起嗎（這回合沒用完的編輯點夠不夠）與原因 */
  can: boolean
  reason: string | null
}

export function reservables(run: Run): Reservable[] {
  const w = run.w
  const out: Reservable[] = []
  for (const p of w.passives) {
    ;(p.reacts ?? []).forEach((r, i) => {
      if (r.cost === undefined) return
      const key = reactKey(p.id, i)
      const seat = w.desk.find((s) => s.actor === p.actor && s.ep >= r.cost!) ?? w.desk.find((s) => s.ep >= r.cost!)
      const have = Math.max(0, ...w.desk.map((s) => s.ep))
      const reason = !usable(run, key, r) ? `「${p.name}」這${r.limit!.per === 'war' ? '一場' : '一回合'}的次數用完了。` : !seat ? `編輯點不夠：「${p.name}」要預留 ${r.cost} 點，你剩下最多 ${have} 點。` : null
      out.push({ key, name: p.name, cost: r.cost, on: onList(r), seat: (seat ?? w.desk[0]!).actor, can: reason === null, reason })
    })
  }
  return out
}

/** 新的一回合：照 run.startRound 做完之後，turn.start 的反應（自動發動的那種）接著發動。 */
export function beginTurn(run: Run): void {
  run.startRound()
  fireReactions(run, 'turn.start')
}
