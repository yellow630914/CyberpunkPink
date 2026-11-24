// L6 功能：快駭（NETRUNNING 第 1、2 節；ITEMS 11.9 節；DATA 7.5 節；dev/work/M1b-hack.md）。
// 甲板與 RAM（沒有甲板就沒有 RAM）、內容種類 quickhack 與它變成的行動、快駭的檢定、接管與控制節點、持續型的快駭、引爆；
// 腳本當成快駭用是道具寫 use.tag_required: 'quickhack'，效果用同一批 op（沒有另外的機制）。
// 誰有主控只看單位的標籤 quickhack（技能的 meat.tags 給）；主控的樹階讀 unit.ext.abilities.tiers；不 import 別的功能。
// 內海（M3-hack-net）：快駭程式的行動兩個戰場都能用；內海每用一次追蹤度加程式的 trace（net.trace），現實被發現時那個勢力的敵對值加 trace（trace.ts；dev/adr/0018 第十一節）。
// 不做視線、攝影機與警報類的程式、戰鬥外對裝置的快駭（M3 之後）。

import type { Feature } from '../../core'
import { registerActions } from './actions'
import { OWNER } from './deck'
import { registerKinds } from './kinds'
import { registerOps } from './ops'
import { registerTrace } from './trace'

export type { Deck } from './deck'
export { DEFAULT_TREE, GRADE_CHECK, deckOf, levelOfTier, runLevel, treeTier } from './deck'
export type { QuickhackEntry } from './kinds'
export { traceOfAction } from './trace'

export const hackFeature: Feature = {
  id: OWNER,
  install(k) {
    registerKinds(k)
    registerOps(k)
    registerTrace(k)
  },
  ready(k) {
    registerActions(k)
  },
}
