// B012：大小 4 的東西（狙擊槍、重武器、摺起來的機甲）「藏不了」，程式卻在藏匿量夠大時把它算成藏好了。
// 規格：EQUIPMENT 6.1 節大小表「4｜狙擊槍、重武器、摺起來的機甲；藏不了」；第 4 節「機甲……大小 4，藏不住，臨檢一定掃得到」。
// 現況：`concealment`（features/gear/numbers.ts）只比 已用 ＋ 大小 ≤ 藏匿量；長外套扣上（5）加內藏槽（+2）加飾品，藏匿量可以到 12，大小 4 的就進了 hidden。
// 工單做完之前照預期失敗。跑法：npm run test:pending -- B012

import { describe, expect, it } from 'vitest'
import type { ContentPack, ItemStack } from '../../src'
import { createKernel } from '../../src'
import { concealment, gearFeature } from '../../src/features/gear'
import { makeState } from '../../src/testkit'

const bp = (id: string, kind: string, more: Record<string, unknown> = {}) => ({ id, kind, name: id, desc: `${id}。`, brand: 'b', grade: 1, legal: 'free', price: 0, size: 1, weight: 1, require: [], optional: [], ...more })
const PACK: ContentPack = {
  id: 'b012',
  content: {
    skill: [{ id: 'firearms', name: 'firearms', attr: 'reflex', desc: 'firearms。' }],
    weapon_class: [{ id: 'sniper', name: '狙擊槍', dice: 6, type: 'physical', range: [5, 7], mag: 1, cover_mult: 1, pierce: 2, traits: [], attr: 'reflex', skill: 'firearms' }],
    blueprint: [
      bp('bp_sniper', 'weapon', { class: 'sniper', carry: 'main', size: 4 }),
      bp('bp_rifle', 'weapon', { class: 'sniper', carry: 'side', size: 3 }),
      bp('bp_long_coat', 'armor', { armor: 0, covers: ['outer'], weight_class: 'light', conceal: 5 }),
      bp('bp_uniform', 'armor', { armor: 1, covers: ['armor'], weight_class: 'medium', conceal_add: 2 }),
    ],
  },
}

function loadout() {
  const k = createKernel([gearFeature])
  k.content.loadPack(PACK)
  const state = makeState()
  const made = (uid: string, id: string): ItemStack => ({ id, qty: 1, data: { uid, parts: {} } })
  state.inventory = [made('s1', 'bp_sniper'), made('r1', 'bp_rifle'), made('c1', 'bp_long_coat'), made('u1', 'bp_uniform')]
  state.actors.pc!.ext.gear = { worn: { outer: 'c1', armor: 'u1' }, acc: {}, carry: { main: 's1', side: 'r1' }, quick: [], coat: 'closed' }
  return { k, state }
}

describe('B012：大小 4 藏不了（EQUIPMENT 6.1 節）', () => {
  it('長外套扣上 ＋ 裝甲制服（藏匿量 7）：大小 3 的步槍藏得住，大小 4 的狙擊槍還是露在外面', () => {
    const { k, state } = loadout()
    const c = concealment(k, state, 'pc')
    expect(c.capacity).toBe(7)
    expect(c.hidden).toEqual(['r1'])
    expect(c.shown).toEqual(['s1'])
  })
})
