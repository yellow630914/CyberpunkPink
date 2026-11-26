// 收買被接受的帳（OPINION 5.2；dev/adr/0020 V36）：錢進帳、公信力掉、委託人的好感掉；委託副本裡另外記一筆帳，回到快照之後（rewind.keep）把這幾筆套回去。
// 帳記在 狀態裡的 opinion_bribes（ext 的一個鍵，見 model.ts 的 readBribes）（陣列：{ id: 那一場戰役的 id, changes: 那幾筆變更 }）：回去之前有、快照那一刻沒有的，各套一次，並把帳補回去
// （所以一件委託失敗幾次、回去幾次，每一筆收買只算一次；快照那一刻已經有的不再套）。
// 沒有公信力量表、沒有好感量表、沒有委託人時對應的那一筆略過；任何一筆都不給街頭信譽（V54）。

import type { Change, GameState } from '../../core'
import { clone } from '../../core'
import { BRIBES_EXT, readBribes } from './model'
import type { Run } from './run'

export interface Accepted {
  changes: Change[]
  /** 給玩家看的一句（沒有句號） */
  line: string
  cred: number
  favor: number
}

/** 接受收買要加的變更（不改狀態）：錢、公信力、委託人的好感；委託副本多一筆帳。 */
export function acceptedChanges(run: Run, price: number): Accepted {
  const { k, w } = run
  const rule = run.rules.bribe
  const changes: Change[] = []
  const parts: string[] = []
  if (price > 0) {
    changes.push({ op: 'cash', delta: price })
    parts.push(`收下 C$${price.toLocaleString('en-US')}`)
  }
  let cred = 0
  if (rule.cred > 0 && k.meters.has('credibility')) {
    cred = rule.cred
    changes.push({ op: 'meter', kind: 'credibility', key: '_', delta: -cred })
    parts.push(`公信力 −${cred}`)
  }
  let favor = 0
  const employer = w.face?.employer
  if (rule.favor > 0 && employer !== undefined && k.meters.has('favor')) {
    favor = rule.favor
    changes.push({ op: 'meter', kind: 'favor', key: employer, delta: -favor })
    parts.push(`委託人的好感 −${favor}`)
  }
  const out: Change[] = [...changes]
  if (w.mode === 'face') out.push({ op: 'ext', key: BRIBES_EXT, value: [...readBribes(run.state), { id: w.id, changes: clone(changes) }] })
  return { changes: out, line: parts.join('，'), cred, favor }
}

/** 掛點 rewind.keep：回去之前的帳裡有、快照那一刻沒有的，把它的變更套在回去之後的狀態上（各一次），帳也補回去。 */
export function keepBribes(current: GameState, restored: GameState): Change[] | undefined {
  const now = readBribes(current)
  if (now.length === 0) return undefined
  const before = readBribes(restored)
  const had = new Set(before.map((e) => e.id))
  const missing = now.filter((e) => !had.has(e.id))
  if (missing.length === 0) return undefined
  return [...missing.flatMap((e) => clone(e.changes)), { op: 'ext', key: BRIBES_EXT, value: [...before, ...missing].map((e) => clone(e)) }]
}
