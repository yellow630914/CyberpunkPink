// L6 功能：裝備。設計圖與零件兩種內容、身上的四層（穿著 10 格、飾品 5 格、攜帶 3 格、快取格）、穿脫的規則、全身的護甲、
// 一把組好的武器的數字、藏匿量與掃描，並把武器與快取格帶進戰鬥。
// 規格：EQUIPMENT 第 1～4、6 節；COMBAT_SYSTEM 第 4、5 節；DATA 7.1、7.2 節。組裝的檢定、品質、拆解、染色、重量的懲罰是 M4。
// dev/work/M1-gear.md；暫定值見 dev/adr/0013（D9：護甲捨去；D10：沒有重量的懲罰、通用飾品格固定 3 格）。

import type { Feature } from '../../core'
import { installBattle } from './battle'
import { installChanges } from './changes'
import { installKinds } from './kinds'
import { OWNER, blueprintOf, stackOf } from './model'
import { armorOf, bodyArmorOf, scanFinds } from './numbers'

export { equip, equipBlock, unequip } from './equip'
export { QUICK_CATEGORIES, quickBlock } from './quick'
export type { BlueprintEntry, Gear, PartEntry } from './model'
export { ACCESSORY_SLOTS, CARRY_SLOTS, QUICK_BASE, QUICK_MAX, WEAR_SLOTS, gearOf, quickCapacity } from './model'
export { armorOf, bodyArmorOf, concealment, scanFinds, weaponOf } from './numbers'

export const gearFeature: Feature = {
  id: OWNER,
  install(k) {
    installKinds(k)
    installChanges(k)
    // 戰鬥的單位與報告讀同一個數字：全身的護甲（義體上的板材值在 M4 加進來）
    k.stats.defineStat({ id: 'armor', owner: OWNER, name: '護甲值', base: (state, actor) => (state.actors[actor] ? armorOf(k, state, actor) : 0) })
    // 全身的護甲裡身上那一件的份：軀幹的重創只讓這一份失效，頭盔與（M4 之後）義體上的板材不受影響
    k.stats.defineStat({ id: 'armor_body', owner: OWNER, name: '身上那件護甲', base: (state, actor) => (state.actors[actor] ? bodyArmorOf(k, state, actor) : 0) })
    installBattle(k)
    // 掃橋（EQUIPMENT 6.3 節）：身上攜帶格裡這一級掃得到的武器（掛點 scan.carried 由 security 宣告；兩邊不互相 import）
    k.hooks.on('scan.carried', OWNER, ({ state, actor, strength }) => {
      const out: Array<{ item: string; name: string; legal: string; uid: string }> = []
      for (const uid of scanFinds(k, state, actor, strength)) {
        const stack = stackOf(state, uid)
        const bp = blueprintOf(k, stack)
        if (stack && bp) out.push({ item: stack.id, name: bp.name, legal: bp.legal, uid })
      }
      return out.length > 0 ? out : undefined
    })
  },
}
