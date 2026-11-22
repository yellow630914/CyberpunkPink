// L6 功能：快駭（NETRUNNING 第 1、2 節；ITEMS 11.9 節；DATA 7.5 節；dev/work/M1b-hack.md）。
// 甲板與 RAM（沒有甲板就沒有 RAM）、內容種類 quickhack 與它變成的行動、快駭的檢定、接管與控制節點、持續型的快駭、引爆；
// 腳本當成快駭用是道具寫 use.tag_required: 'quickhack'，效果用同一批 op（沒有另外的機制）。
// 誰有主控只看單位的標籤 quickhack（技能的 meat.tags 給）；主控的樹階讀 unit.ext.abilities.tiers；不 import 別的功能。
// 不做追蹤度、敵對值、視線、攝影機與警報類的程式（dev/adr/0015 E9；M2、M3）。內海那一面在 M3。

import type { Feature } from '../../core'
import { registerActions } from './actions'
import { OWNER } from './deck'
import { registerKinds } from './kinds'
import { registerOps } from './ops'

export type { Deck } from './deck'
export { DEFAULT_TREE, GRADE_CHECK, deckOf, levelOfTier, runLevel, treeTier } from './deck'
export type { QuickhackEntry } from './kinds'

export const hackFeature: Feature = {
  id: OWNER,
  install(k) {
    registerKinds(k)
    registerOps(k)
  },
  ready(k) {
    registerActions(k)
  },
}
