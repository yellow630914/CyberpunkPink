// B013：生體件掃不到——程式只看零件有沒有 scan_proof 的特性，不看零件是不是生體。
// 規格：EQUIPMENT 6.3 節表「生體件（爪、蛛絲、活皮）｜掃不到」；ITEMS 1.1 節「生體件一律自由……掃描不到」；CRAFTING 8.1 節；DATA 7.2 節零件的 material（mech／bio）。
// 現況：`scanFinds`（features/gear/numbers.ts）每個零件都要有 traits 裡的 scan_proof 才掃不到；material: 'bio' 的零件沒寫那個特性就被掃到。
// 如果設計是「生體件的資料一律自己寫 scan_proof」，那規格要寫明；現在規格寫的是生體件本身掃不到。
// 2026-11-22 修好（dev/bugs 的 B012～B014 報告）：從 tests/pending 搬進主套件。

import { describe, expect, it } from 'vitest'
import type { ContentPack, ItemStack } from '../../src'
import { createKernel } from '../../src'
import { gearFeature, scanFinds } from '../../src/features/gear'
import { makeState } from '../../src/testkit'

const bp = (id: string, more: Record<string, unknown> = {}) => ({ id, kind: 'weapon', name: id, desc: `${id}。`, brand: 'b', grade: 1, legal: 'free', price: 0, size: 2, weight: 1, require: [], optional: [], class: 'claw', carry: 'melee', ...more })
const part = (id: string, type: string, more: Record<string, unknown> = {}) => ({ id, name: id, type, material: 'mech', brand: 'b', grade: 1, price: 0, legal: 'free', cells: 1, stats: {}, weight: 1, size: 1, state: 'new', ...more })
const PACK: ContentPack = {
  id: 'b013',
  content: {
    skill: [{ id: 'brawl', name: 'brawl', attr: 'body', desc: 'brawl。' }],
    weapon_class: [{ id: 'claw', name: '爪', dice: 3, type: 'physical', range: [1, 1], cover_mult: 0, pierce: 1, traits: ['melee'], attr: 'body', skill: 'brawl' }],
    blueprint: [bp('bp_claw')],
    part: [part('pt_bio_blade', 'blade', { material: 'bio', state: 'living' }), part('pt_bio_frame', 'frame', { material: 'bio', state: 'living' }), part('pt_steel', 'frame')],
  },
}

function carrying(parts: Record<string, unknown>) {
  const k = createKernel([gearFeature])
  k.content.loadPack(PACK)
  const state = makeState()
  state.inventory = [{ id: 'bp_claw', qty: 1, data: { uid: 'c1', parts } } as ItemStack]
  state.actors.pc!.ext.gear = { worn: {}, acc: {}, carry: { melee: 'c1' }, quick: [], coat: 'closed' }
  return { k, state }
}

describe('B013：生體件掃不到（EQUIPMENT 6.3 節）', () => {
  it('全是生體零件的爪：任何強度都掃不到', () => {
    const { k, state } = carrying({ blade: 'pt_bio_blade', frame: 'pt_bio_frame' })
    expect(scanFinds(k, state, 'pc', 3)).toEqual([])
  })
  it('對照：混了一個機械零件就整件掃得到（一件東西只要有一個掃得到的零件，整件就掃得到）', () => {
    const { k, state } = carrying({ blade: 'pt_bio_blade', frame: 'pt_steel' })
    expect(scanFinds(k, state, 'pc', 3)).toEqual(['c1'])
  })
})
