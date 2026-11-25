// 測試基礎建設：替一個角色「穿上」背包裡的一副甲板（dev/adr/0019「實作補記：M4-cyber-deck」的 testkit 做法）。
//
// 為什麼要有它：M3 的甲板是背包裡的成品，deck.equip 一下就裝上（equipDraft）；M4-cyber-deck 之後，只要局裡有義體功能（它掛了 deck.source），
// 甲板就是腦部的義體，equipDraft 一律回 IMPLANT_ONLY。測試要的只是「這個人一開始就有一副甲板」，不是手術本身，所以兩種局用同一個輔助：
//   沒有人掛 deck.source（沒裝義體功能的局）：照舊走 deck 的 equipDraft（來源是 'own'，M3 的樣子）；
//   有人掛（含全部功能的局）：直接把那一疊放進腦部（actor.ext.cyber 多一件 kind_of: 'deck'、slot: 'brain'）——
//     不經手術：不收費、不花時間、不休養（沒有 ready_at）、不要診所與橋；沉溺照一般安裝的成本（pieceSink，無照那一檔：沒有診所的折扣）記在那一件上，
//     並把角色的沉溺補到新的下限（身上義體的合計），所以 sink_floor 與沉溺的不變式照舊成立。來源是 'implant'。
// 腦裡原本那一件內容種類 deck 的甲板（有的話）整副放回背包（和 equipDraft 換甲板時舊的還在背包裡一樣）；設計圖組的甲板要先用 removeDraft 拆，這裡不替它動刀。
// 要測手術本身（診所、費用、休養、沉溺成本）的是 tests/features/M4-cyber-deck.test.ts，那裡用真的 installDraft。

import type { ActorId, Change, ContentEntry, GameState, Kernel, ReportDraft } from '../core'
import { clone, toMinutes } from '../core'
import { cyberOf, isDeckPiece, pieceSink } from '../features/cyberware'
import type { CyberPiece } from '../features/cyberware'
import { equipDraft } from '../features/deck'

/** 動作名：測試自己發的報告用 test 前綴（M3_ACTION_PREFIXES 認得）。 */
export const WEAR_DECK_ACTION = 'test.wear_deck'

/** 這一局的甲板是腦部的義體嗎（有人掛 deck.source，也就是裝了義體功能）。 */
export const deckIsImplant = (k: Pick<Kernel, 'hooks'>): boolean => k.hooks.owners('deck.source').length > 0

/** 背包裡編號 uid 的那一副甲板（id 要是內容種類 deck 的一筆）。 */
const deckStack = (k: Pick<Kernel, 'content'>, state: Pick<GameState, 'inventory'>, uid: string) =>
  state.inventory.find((s) => s.data?.uid === uid && k.content.has('deck', s.id))

/** 角色現在的沉溺下限：有衍生數值 sink_floor 就用它，沒有就是身上義體成本的合計（和 features/cyberware 的 floorWith 同一個算法）。 */
const floorNow = (k: Kernel, state: GameState, actor: ActorId, pieces: readonly CyberPiece[]): number =>
  k.stats.hasStat('sink_floor') ? k.stats.stat(state, actor, 'sink_floor') : pieces.reduce((n, p) => n + p.sink, 0)

/**
 * 讓 actor 穿上背包裡編號 uid 的那一副甲板；回傳報告草稿（交給 game.commit）。
 * 沒有人掛 deck.source 時就是 equipDraft（action 是 deck.equip）；有人掛時是直接放進腦部（action 是 test.wear_deck），說明在檔頭。
 * 背包裡沒有那一副、人不存在、或腦裡已經有一副設計圖組的甲板時丟 Error（測試寫錯了，不是遊戲的規則）。
 */
export function wearDeck(k: Kernel, state: GameState, actor: ActorId, uid: string): ReportDraft {
  if (!deckIsImplant(k)) return equipDraft(k, state, actor, uid)
  if (!state.actors[actor]) throw new Error(`wearDeck：沒有 ${actor} 這個角色`)
  const stack = deckStack(k, state, uid)
  if (!stack) throw new Error(`wearDeck：背包裡沒有編號 ${uid} 的甲板`)

  const all = cyberOf(state, actor)
  const old = all.filter((p) => p.slot === 'brain' && isDeckPiece(k, p))
  const blueprintDeck = old.find((p) => p.kind_of !== 'deck')
  if (blueprintDeck) throw new Error(`wearDeck：腦裡已經有一副設計圖組的甲板（${blueprintDeck.bp}），先用 removeDraft 拆掉`)
  const keep = all.filter((p) => !old.includes(p))
  const sink = pieceSink(k, state, stack.id, stack.data, { via: 'unlicensed' })
  const piece: CyberPiece = { uid, bp: stack.id, kind_of: 'deck', slot: 'brain', parts: {}, sink, at: toMinutes(state.time) }
  const pieces = [...keep, piece]

  const patient = state.actors[actor]!
  const floor = floorNow(k, state, actor, all) - old.reduce((n, p) => n + p.sink, 0) + sink
  const raw = patient.ext.cyber
  const changes: Change[] = [
    // 舊的那副（kind_of: 'deck'）整副回背包（只帶 uid，M3 的樣子）；新的那疊離開背包
    ...old.map((p): Change => ({ op: 'item', id: p.bp, qty: 1, data: { uid: p.uid } })),
    { op: 'item', id: stack.id, qty: -1, data: { uid } },
    { op: 'actor.ext', id: actor, key: 'cyber', value: { ...(raw && typeof raw === 'object' && !Array.isArray(raw) ? clone(raw as Record<string, unknown>) : {}), pieces: clone(pieces) } },
    ...(patient.sink < floor ? [{ op: 'actor.track', id: actor, track: 'sink', delta: floor - patient.sink } as Change] : []),
  ]
  const name = k.content.get<ContentEntry & { name?: string }>('deck', stack.id)?.name ?? stack.id
  const summary = `${patient.name}的腦部裝上${name}。`
  return {
    kind: 'action', action: WEAR_DECK_ACTION, location: clone(state.location), actor, party: [],
    timeline: [{ layer: 'meat', actor, text: summary, tag: WEAR_DECK_ACTION }], changes,
    outcome: { result: 'ok', summary },
  }
}

/**
 * 讓 actor 拿掉自己的甲板（wearDeck 的反向）；沒有人掛 deck.source 時是 equipDraft(null)（卸下背包裡裝上的那一副）；有人掛時把腦裡內容種類 deck 的那一件整副放回背包
 * （和 removeDraft 一樣不替設計圖組的甲板退東西：那要用真的 removeDraft）。沒有甲板可以拿的時候丟 Error。不花時間、不收費、不動沉溺（和 wearDeck 一樣是測試的捷徑）。
 * ext.deck 裡槽與腳本的記錄不動：拿掉之後 deckOf 讀成沒有甲板、槽全部是 inactive（和 M3 的卸下一樣）。
 */
export function unwearDeck(k: Kernel, state: GameState, actor: ActorId): ReportDraft {
  if (!deckIsImplant(k)) return equipDraft(k, state, actor, null)
  if (!state.actors[actor]) throw new Error(`unwearDeck：沒有 ${actor} 這個角色`)
  const all = cyberOf(state, actor)
  const old = all.filter((p) => p.slot === 'brain' && isDeckPiece(k, p))
  if (old.length === 0) throw new Error(`unwearDeck：${actor} 的腦裡沒有甲板`)
  const blueprintDeck = old.find((p) => p.kind_of !== 'deck')
  if (blueprintDeck) throw new Error(`unwearDeck：腦裡是設計圖組的甲板（${blueprintDeck.bp}），用 removeDraft 拆`)
  const raw = state.actors[actor]!.ext.cyber
  const summary = `${state.actors[actor]!.name}的腦部拿掉了甲板。`
  return {
    kind: 'action', action: WEAR_DECK_ACTION, location: clone(state.location), actor, party: [],
    timeline: [{ layer: 'meat', actor, text: summary, tag: WEAR_DECK_ACTION }],
    changes: [
      ...old.map((p): Change => ({ op: 'item', id: p.bp, qty: 1, data: { uid: p.uid } })),
      { op: 'actor.ext', id: actor, key: 'cyber', value: { ...(raw && typeof raw === 'object' && !Array.isArray(raw) ? clone(raw as Record<string, unknown>) : {}), pieces: clone(all.filter((p) => !old.includes(p))) } },
    ],
    outcome: { result: 'ok', summary },
  }
}
