// L6 功能 cyberware 的藥泵：戰鬥外替藥泵裝藥（工單 M4-cyber-battle；ITEMS 4.1 節「預裝在藥泵裡的藥不花行動點」；EQUIPMENT 4.1 節；dev/adr/0019 第三節）。
// 藥泵是設計圖 battle.pump 的義體；預裝的藥記在那一件身上（CyberPiece.loaded：一種藥、幾劑）。戰鬥中用一劑是行動 cyber_pump（battle.ts），
// 戰鬥結束時用掉的劑數寫回那一件。這裡是戰鬥外的那一半：把背包裡一種帶 drug 欄位的物品裝進去（loadPumpDraft）、取出來、給畫面看的清單。
// 改狀態的入口是純函式、回傳報告草稿（cyber.pump）；不成立丟 ActionBlocked，pumpProblems 一條一句列全部。

import type { ActorId, GameState, ItemEntry, Kernel, ReportDraft, TimelineBeat } from '../../core'
import { ActionBlocked, clone, countItem, isRecord } from '../../core'
import { defOf, pumpCapacity } from './battle'
import { blueprintEntry, cyberExtValue, cyberOf } from './model'
import type { CyberPiece } from './model'

export const PUMP_REPORT = 'cyber.pump'

export interface PumpOpts {
  actor: ActorId
  /** 身上那一座藥泵（那一件義體）的 uid */
  uid: string
  /** 裝哪一種藥（物品的 id）；null 是把裡面的藥取出來 */
  item: string | null
  /** 裝幾劑：不寫就裝到滿 */
  qty?: number
}

/** 一座藥泵（給畫面）。 */
export interface PumpView {
  uid: string
  bp: string
  name: string
  /** 一座放幾劑 */
  capacity: number
  /** 預裝的藥；空的是 null */
  loaded: { item: string; name: string; qty: number } | null
}

/** 這個藥泵放得下的藥：帶 drug 欄位（或類別是 drug）、而且有 use（戰鬥中用得出來）、用在自己身上。 */
export function pumpItemBlock(k: Pick<Kernel, 'content'>, item: string): string | null {
  const e = k.content.get<ItemEntry & { drug?: unknown }>('item', item)
  if (!e) return '沒有這種東西。'
  if (!isRecord(e.drug) && e.category !== 'drug') return `${e.name}不是藥，藥泵只放藥。`
  if (!e.use) return `${e.name}沒有戰鬥中用的方法，藥泵放不了。`
  if (e.use.target !== 'self') return `${e.name}不是用在自己身上的，藥泵放不了。`
  return null
}

const pieceName = (k: Pick<Kernel, 'content'>, piece: CyberPiece): string => blueprintEntry(k, piece.bp)?.name ?? piece.bp

/** 這個人身上的藥泵：每一座的容量與預裝的藥。 */
export function pumpView(k: Pick<Kernel, 'content'>, state: GameState, actor: ActorId): PumpView[] {
  const out: PumpView[] = []
  for (const piece of cyberOf(state, actor)) {
    if (piece.kind_of === 'deck' || !defOf(k, piece.bp)?.pump) continue
    out.push({
      uid: piece.uid, bp: piece.bp, name: pieceName(k, piece), capacity: pumpCapacity(k, piece.bp),
      loaded: piece.loaded ? { item: piece.loaded.item, name: k.content.get<ItemEntry>('item', piece.loaded.item)?.name ?? piece.loaded.item, qty: piece.loaded.qty } : null,
    })
  }
  return out
}

interface Plan {
  problems: string[]
  piece?: CyberPiece
  /** 裝完之後藥泵裡是什麼 */
  after?: { item: string; qty: number } | null
  /** 要從背包拿走的、要放回背包的 */
  take?: { item: string; qty: number }
  back?: { item: string; qty: number }
}

function plan(k: Kernel, state: GameState, o: PumpOpts): Plan {
  const problems: string[] = []
  if (!state.actors[o.actor]) return { problems: ['找不到這個角色。'] }
  if (state.battle) problems.push('戰鬥中不能替藥泵裝藥。')
  const act = k.activity.blockOf(state, `commit:${PUMP_REPORT}`)
  if (act && !problems.includes(act)) problems.push(act)
  const piece = cyberOf(state, o.actor).find((p) => p.uid === o.uid)
  if (!piece) return { problems: [...problems, '身上沒有這一件義體。'] }
  if (piece.kind_of === 'deck' || !defOf(k, piece.bp)?.pump) return { problems: [...problems, `${pieceName(k, piece)}不是藥泵。`], piece }
  const cap = pumpCapacity(k, piece.bp)
  const have = piece.loaded
  // 取出
  if (o.item === null) {
    if (!have) problems.push('藥泵本來就是空的。')
    return { problems, piece, after: null, ...(have ? { back: { ...have } } : {}) }
  }
  const why = pumpItemBlock(k, o.item)
  if (why) return { problems: [...problems, why], piece }
  const name = k.content.get<ItemEntry>('item', o.item)?.name ?? o.item
  // 同一種藥補上去；換一種藥就把原本的退回背包
  const same = have?.item === o.item
  const room = cap - (same ? have!.qty : 0)
  if (room <= 0) problems.push('藥泵已經裝滿了。')
  const want = o.qty ?? room
  if (!Number.isSafeInteger(want) || want < 1) problems.push('至少要裝一劑。')
  else if (want > room) problems.push(`藥泵最多放 ${cap} 劑，現在還放得下 ${Math.max(0, room)} 劑。`)
  else if (countItem(state.inventory, o.item) < want) problems.push(`背包裡的${name}只有 ${countItem(state.inventory, o.item)} 劑，不夠 ${want} 劑。`)
  const qty = Math.max(0, want)
  return { problems, piece, after: { item: o.item, qty: (same ? have!.qty : 0) + qty }, take: { item: o.item, qty }, ...(have && !same ? { back: { ...have } } : {}) }
}

/** 替藥泵裝藥現在行不行：全部的原因（一條一句）；行是空陣列。 */
export const pumpProblems = (k: Kernel, state: GameState, o: PumpOpts): string[] => plan(k, state, o).problems
/** 第一條原因；行是 null。 */
export const pumpBlock = (k: Kernel, state: GameState, o: PumpOpts): string | null => plan(k, state, o).problems[0] ?? null

/**
 * 替藥泵裝藥（或取出）。不成立丟 ActionBlocked。寫進狀態：背包少那幾劑、那一件的 loaded 換成新的（換一種藥時原本的退回背包）。不花錢、不花時間。報告 cyber.pump。
 */
export function loadPumpDraft(k: Kernel, state: GameState, o: PumpOpts): ReportDraft {
  const p = plan(k, state, o)
  if (p.problems.length > 0 || !p.piece || p.after === undefined) throw new ActionBlocked(p.problems[0] ?? '現在裝不了。')
  const piece = p.piece
  const name = pieceName(k, piece)
  const itemName = (id: string): string => k.content.get<ItemEntry>('item', id)?.name ?? id
  const next = cyberOf(state, o.actor).map((x) => {
    if (x.uid !== piece.uid) return x
    const { loaded: _loaded, ...rest } = x
    void _loaded
    return p.after ? { ...rest, loaded: { ...p.after } } : rest
  })
  const changes: ReportDraft['changes'] = []
  if (p.take) changes.push({ op: 'item', id: p.take.item, qty: -p.take.qty })
  if (p.back) changes.push({ op: 'item', id: p.back.item, qty: p.back.qty })
  changes.push({ op: 'actor.ext', id: o.actor, key: 'cyber', value: cyberExtValue(state, o.actor, next) })
  const lines: string[] = []
  if (p.back) lines.push(`${name}裡原本的${itemName(p.back.item)}取了出來。`)
  if (p.take) lines.push(`${name}裝進了${itemName(p.take.item)}。`)
  const beats: TimelineBeat[] = lines.map((text, i) => ({ layer: 'meat', actor: o.actor, text, tag: i === 0 ? PUMP_REPORT : 'cyber.note', data: { uid: piece.uid, ...(p.after ? { item: p.after.item, qty: p.after.qty } : {}) } }))
  return {
    kind: 'action', action: PUMP_REPORT, location: clone(state.location), actor: o.actor, party: [], timeline: beats, changes,
    outcome: { result: p.after ? 'loaded' : 'emptied', summary: lines.join('') },
    narration: { results: lines },
  }
}
