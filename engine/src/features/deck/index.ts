// L6 功能：甲板、構裝、SKIN、腳本（工單 M3-deck；dev/adr/0018 第三節）。
// 甲板在 M3 是一件成品（內容種類 deck：等級、構裝槽、防火牆、RAM 的加值、散熱、選填的 sink_cost 與 invasiveness）：背包裡有那一副才裝得上、裝上不經手術。
// M4-cyber-deck：甲板是腦部的義體。宣告掛點 deck.source（features/cyberware 回答腦裡那一件的數字）；有人掛它時，deckOf 的來源是 租來的 → 掛點的回答（source: implant）
// （沒有背包那一條路），equipDraft 一律回「甲板是腦部的義體，要動手術才裝得上。」、deckView 不再列背包裡的甲板；沒有人掛時行為和 M3 一樣。
//
// 接上核心的地方：
//   內容   deck、construct、skin、deck_rule（id: default，規則的數字：構裝等級的加值、腳本的上限、換一件幾分鐘、RAM 回復的基本值；可以被後載入的包取代）
//   衍生數值 deck_grade、deck_slots、deck_firewall、deck_slots_reserved（基本 0，招牌能力的專屬構裝佔槽，別的功能加 provider）、net_guard、ram_regen（基本 2）；
//         ram_max 與 ram_regen 加甲板的 ram。沒有甲板時前四個是 0（deckOf 說沒有、槽數 0）
//   戰鬥   loadout（內海：武器構裝變成武器、腳本當快取格）、unit.ready（兩個戰場：unit.ext.deck；沒有甲板的人沒有 RAM）、modifier（被動工具的 mods）、onEnd（用掉的腳本）
//   效果   deck_rental（只有內建的來源能給）
//   狀態   actor.ext.deck：{ uid?, rental?: { deck }, slots: string[], skin?, scripts: [{ item, qty }] }（只經由報告裡的 actor.ext 變更寫）
// 讀的：k.stats、k.content、k.activity.active（戰鬥、face.net、netrun、dive 進行中不能換）、背包。不 import 別的功能：快駭程式只認內容種類 quickhack 的 id，沒有人定義那個種類時不收。
// 報告（kind action）：deck.equip、deck.install、deck.remove、deck.skin、deck.scripts。
// 對外：deckOf、equipDraft／installDraft／removeDraft／skinDraft／scriptsDraft（以及各自的 …Block）、deckView。

import type { Feature } from '../../core'
import { installBattle } from './battle'
import { installEffects } from './effects'
import { installKinds } from './kinds'
import { OWNER } from './model'
import { installStats } from './stats'

export { IMPLANT_ONLY, equipBlock, equipDraft, installBlock, installDraft, removeBlock, removeDraft, scriptsBlock, scriptsDraft, skinBlock, skinDraft } from './ops'
export { DEFAULT_DECK_RULES, deckRules, extOf as deckExtOf } from './model'
export type { ConstructEntry, DeckEntry, DeckExt, DeckRules, DeckSource, ScriptEntry, SkinEntry } from './model'
export { deckOf, pieceKind } from './state'
export type { DeckInfo, Piece, PieceKind } from './state'
export { deckView } from './view'
export type { DeckCandidate, DeckCell, DeckView } from './view'

export const deckFeature: Feature = {
  id: OWNER,
  install(k) {
    installKinds(k)
    installStats(k)
    installBattle(k)
    installEffects(k)
  },
}
