// 測試用：讓主角身上裝著一座橋（M4-creation-body：橋是身上的一件義體，容量從橋的零件算出來；`ext.bridge.capacity` 不再算數）。
// 不經手術（不收費、不休養、不算沉溺）。BRIDGE_PACK 是測試要一起載入的最小內容（一顆晶片 32、一片神經元、一套均衡軟體、一張橋的設計圖）：四類容量各 8。

import type { ContentPack } from '@engine/src'

type Rec = Record<string, unknown>
interface Eng {
  state: { pc: string | null; actors: Record<string, { ext: Rec }> }
  commit(r: { summary: string; changes: never[] }): string | null
}

const part = (id: string, type: string, over: Rec = {}): Rec => ({ id, name: id, type, material: 'mech', brand: 'test', grade: 1, price: 100, legal: 'free', cells: 1, stats: {}, weight: 1, size: 1, state: 'new', ...over })

export const BRIDGE_STOCK = { chip: 'tp_chip32', neuron: 'tp_neuron', software: 'tp_sw_even' }
export const BRIDGE_PACK: ContentPack = {
  id: 'ui_test_bridge',
  content: {
    part: [
      part('tp_chip32', 'chip', { bridge: { capacity: 32 } }), part('tp_neuron', 'neuron'),
      part('tp_sw_even', 'software', { bridge: { split: { meat: 1, net: 1, social: 1, media: 1 } } }),
    ],
    blueprint: [{
      id: 'tbp_bridge', kind: 'cyberware', name: '測試橋', desc: '一座測試用的橋。', brand: 'test', grade: 1, legal: 'free', price: 900, require: [{ type: 'chip' }, { type: 'neuron' }, { type: 'software' }], optional: [],
      slot: 'bridge', invasiveness: 'invasive', sink_cost: 0, bridge: { tuning_slots: 2 }, stock: BRIDGE_STOCK,
    }],
  },
} as unknown as ContentPack

/** 把一座測試橋（四類容量各 8）放進主角身上。 */
export function giveBridge(e: Eng): string | null {
  const pc = e.state.pc
  if (!pc) return '還沒有主角。'
  const raw = e.state.actors[pc]!.ext.cyber as { pieces?: Rec[] } | undefined
  const pieces = [...(Array.isArray(raw?.pieces) ? raw!.pieces.filter((p) => p.slot !== 'bridge') : []), { uid: 'tbr1', bp: 'tbp_bridge', kind_of: 'blueprint', slot: 'bridge', parts: { ...BRIDGE_STOCK }, state: 'new', sink: 0, at: 0 }]
  return e.commit({ summary: '裝上一座橋', changes: [{ op: 'actor.ext', id: pc, key: 'cyber', value: { ...(raw ?? {}), pieces } }] as never[] })
}
