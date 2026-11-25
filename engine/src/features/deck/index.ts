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
//   掛點   creation.step（features/creation 宣告）：建角第 9 步的構裝、SKIN、快駭程式與出身白給的那幾類（creation.ts）
//   效果   deck_rental（只有內建的來源能給）
//   狀態   actor.ext.deck：{ uid?, rental?: { deck }, slots: string[], skin?, scripts: [{ item, qty }] }（只經由報告裡的 actor.ext 變更寫）
// 讀的：k.stats、k.content、k.activity.active（戰鬥、face.net、netrun、dive 進行中不能換）、背包。不 import 別的功能：快駭程式只認內容種類 quickhack 的 id，沒有人定義那個種類時不收。
// 報告（kind action）：deck.equip、deck.install、deck.remove、deck.skin、deck.scripts。
// M4-scene-net：化身的身體（avatar.ts；actor.ext.deck.avatar、報告 deck.avatar、掛點 scene.body 在內海那一層回答化身開著的部位）與 SKIN 的風格與曝露度（skin.ts；
//   衍生數值 skin_exposure、skin_style_value，條件 skin_style、skin_exposure）。改化身要在接入點，潛入中放行（k.activity.allow('dive', 'commit:deck.avatar')）。
// 對外：deckOf、equipDraft／installDraft／removeDraft／skinDraft／scriptsDraft（以及各自的 …Block）、deckView、avatarOf／avatarDraft／avatarBlock。

import type { Feature } from '../../core'
import { AVATAR_ACTION, avatarBody } from './avatar'
import { installBattle } from './battle'
import { answerCreation } from './creation'
import { installEffects } from './effects'
import { installKinds } from './kinds'
import { OWNER } from './model'
import { installSkinLook } from './skin'
import { installStats } from './stats'

export { IMPLANT_ONLY, equipBlock, equipDraft, installBlock, installDraft, removeBlock, removeDraft, scriptsBlock, scriptsDraft, skinBlock, skinDraft } from './ops'
export { DEFAULT_DECK_RULES, deckRules, extOf as deckExtOf } from './model'
export type { ConstructEntry, DeckEntry, DeckExt, DeckRules, DeckSource, ScriptEntry, SkinEntry } from './model'
export { AVATAR_ACTION, AVATAR_GENDERS, AVATAR_PARTS, AVATAR_SAVES_MAX, atAccessPoint, avatarBlock, avatarBody, avatarDraft, avatarOf, readAvatar } from './avatar'
export type { Avatar, AvatarLook, AvatarOpts, AvatarPart, SavedAvatar } from './avatar'
export { skinExposureOf, skinStyleOf, skinStyleValue, wornSkin } from './skin'
export { deckOf, pieceKind } from './state'
export type { DeckInfo, Piece, PieceKind } from './state'
export { deckView } from './view'
export type { DeckCandidate, DeckCell, DeckView } from './view'

/** 掛點 creation.step（features/creation 宣告）與 scene.body（features/scene 宣告）：這裡只認名字與格式，不 import。 */
type AnyHook = (name: string, owner: string, fn: (payload: never) => unknown) => void

export const deckFeature: Feature = {
  id: OWNER,
  install(k) {
    installKinds(k)
    installStats(k)
    installBattle(k)
    installEffects(k)
    installSkinLook(k)
    // 改化身：潛入中放行（接入點的限制在 avatarBlock；網內的行程與戰鬥由各自的活動擋）
    k.activity.allow('dive', `commit:${AVATAR_ACTION}`, OWNER)
    // 成人場景問身體（M4-scene-net）：內海那一層回答化身開著的部位（不給敏感度的修正，P42）；現實那一層不回答
    ;(k.hooks.on.bind(k.hooks) as unknown as AnyHook)('scene.body', OWNER, (({ state, actor, layer }: { state: Parameters<typeof avatarBody>[0]; actor: string; layer: string }) => avatarBody(state, actor, layer)) as never)
    // 建角的第 9 步（M4-creation-body）：構裝、SKIN、快駭程式（掛點 creation.step 由 features/creation 宣告，這裡只認名字）
    ;(k.hooks.on.bind(k.hooks) as unknown as AnyHook)('creation.step', OWNER, ((p: Parameters<typeof answerCreation>[1]) => answerCreation(k, p)) as never)
  },
}
