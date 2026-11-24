// 委託內海面測試共用的假資料與開局（M3-ui-commission-net 與 M3-fix-ui 共用）。
import { expect } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import type { ContentPack, Feature, Kernel } from '@engine/src'
import { netWeapon } from '@engine/src/testkit'
import { useEngine } from '../../src/stores/engine'
import { DRAFT, PACK } from './fixtures'

export type Rec = Record<string, unknown>
export const meat = (gives?: string, at = 'T1'): Rec => ({ map: 'ui_room_a', encounter: [], goal: { kind: 'reach', at }, ...(gives ? { gives } : {}), branches: [{ id: 'assault', kind: 'assault', entry: 'E1' }] })
export const net = (extra: Rec = {}): Rec => ({ region: 'sub_ui', layer: 'guest', encounter: ['minion'], branches: [{ id: 'assault', kind: 'assault' }], ...extra })

/** 四階段：1 現實或內海、2 現實或內海、3 只有現實（給資料埠）、4 只有內海（隔離區） */
export const NET4 = {
  id: 'cm_net4', name: '內海的四階段', kind: 't_ui', main: 'net', scale: 'medium', grade: 1, target_faction: 'hizakura', district: 'ui_d', conditions: [],
  stages: [
    { name: '外圍', faces: { meat: meat(), net: net() } },
    { name: '員工層', faces: { meat: meat(), net: net({ layer: 'staff' }) } },
    { name: '現實的資料埠', faces: { meat: meat('airgap_open') } },
    { name: '隔離區', faces: { net: net({ layer: 'core', locked_by: 'airgap_open' }) } },
  ],
  links: { airgap_open: { type: 'open', name: '資料埠', effect: { stage: 4, gate_open: true } } },
}
/** 同一件，但資料埠是第三階段的內海面給的：玩家選現實就拿不到，隔離區鎖著 */
export const NET4_GAP = { ...NET4, id: 'cm_net4_gap', stages: [...NET4.stages.slice(0, 2), { name: '資料埠在內海那一面', faces: { meat: meat(), net: net({ gives: 'airgap_open' }) } }, NET4.stages[3]] }
/** 純現實：三個階段都只有現實 */
export const MEAT3 = {
  id: 'cm_meat3', name: '純現實的三階段', kind: 't_ui', main: 'meat', scale: 'small', grade: 2, target_faction: 'hizakura', district: 'ui_d', conditions: [],
  stages: ['甲', '乙', '丙'].map((name) => ({ name, faces: { meat: meat() } })), links: {},
}
export const OFFERS = [
  { id: 'of_net4', title: '內海的四階段', brief: '潛進去。', reward: 1000, commission: NET4, unknowns: [{ id: 'u_lace', cat: 'lace', text: '第一階段由白蕾絲看守。', reveal: { flag: 'lace_s1' }, face: 'net' }, { id: 'u_g', cat: 'guard', text: '辦公層四個保全', reveal: { guards: 1 } }] },
  { id: 'of_net4_gap', title: '隔離區鎖著', brief: '潛進去。', reward: 1000, commission: NET4_GAP, unknowns: [] },
  { id: 'of_meat3', title: '純現實', brief: '動手。', reward: 800, commission: MEAT3, unknowns: [] },
]
export const lace = (id: string, rank: string, color: string): Rec => ({
  id, name: `測試${id}`, desc: '測試用。', faction: 'hizakura', rank, grades: [1, 5], kind: 'lace', color,
  position: { prefer: [2, 3], cover_use: 0.5 }, ai: { prefer: 'overloaded', focus: 1, flee_below: 0 },
})
export const COUNTS0 = { foe: [0, 0], patrol: [0, 0], archive: [0, 0], trap: [0, 0], rest: [0, 0], safe: [0, 0], control: [0, 0], person: [0, 0] }
export const NETPACK = {
  id: 'ui_net_pack',
  content: {
    net_region: [{ id: 'sub_ui', name: '測試子網', map_kind: 'subnet', size: [11, 9], carve: [30, 40], sight: 2, pressure: 'trace', cover: 'medium', dc: [10, 13, 16, 19, 22], oneway: 0.5, fragile: 0.5, loops: 2, layer: { ...COUNTS0, foe: [1, 1], rest: [1, 1] }, commission: { ...COUNTS0, foe: [1, 1], rest: [1, 1] } }],
    deck: [{ id: 'dk_ii', name: '測試甲板 II', desc: '測試。', grade: 2, slots: 4, firewall: 12, legal: 'free' }],
    construct: [{ id: 'cs_rifle', class: 'weapon', name: '夜巡', grade: 3, legal: 'register', type: 'neural', ram: 1, archetype: 'rifle' }],
    weapon_class: [{ id: 'rifle', name: '步槍', dice: 4, type: 'physical', range: [3, 7], mag: 3, cover_mult: 0.5, pierce: 2, traits: ['long'], attr: 'reflex', skill: 'firearms' }],
    battle_status: (['weapon', 'defense', 'tool'] as const).map((s) => ({ id: `jam_${s}`, name: `${s}停用`, desc: '被干擾。', until: 'own_turn_end', turns: 1, kind: 'debuff' })),
    enemy: [lace('l_w', 'minion', 'white'), lace('l_p', 'minion', 'pink'), lace('l_e', 'elite', 'pink'), lace('l_b', 'boss', 'pink')],
  },
} as unknown as ContentPack
export const OFFERS_FEATURE: Feature = {
  id: 'ui_net_offers',
  install(k: Kernel) { k.hooks.on('fixer.offers', 'ui_net_offers', ({ fixer }) => (fixer.id === 'fx_ui' ? structuredClone(OFFERS) as never : undefined)) },
}
export const GEAR: Feature = { id: 'ui_net_gear', install(k) { k.battle.loadout('ui_net_gear', (_s, _a, mode) => (mode === 'net' ? { weapons: [netWeapon(60, 14)] } : undefined)) } }
export const give = (id: string, data?: Rec) => ({ op: 'item', id, qty: 1, ...(data ? { data } : {}) }) as never

export function start(seed = 7) {
  const pinia = createPinia()
  setActivePinia(pinia)
  const e = useEngine()
  e.newGame({ seed, testContent: [PACK, NETPACK], testFeatures: [OFFERS_FEATURE, GEAR] })
  expect(e.createCharacter(DRAFT)).toEqual([])
  expect(e.commit({ summary: '給東西', changes: [give('dk_ii', { uid: 'D1' }), give('cs_rifle')] })).toBeNull()
  expect(e.commit({ summary: '練槍', changes: [{ op: 'actor.skill', id: e.state.pc!, skill: 'firearms', delta: 5 }, { op: 'actor.skill', id: e.state.pc!, skill: 'interface', delta: 3 }] as never })).toBeNull()
  expect(e.deck.equip('D1')).toBeNull()
  expect(e.deck.install('cs_rifle')).toBeNull()
  return { e, pinia }
}
export type Eng = ReturnType<typeof start>['e']
export const depart = async (e: Eng, id: string) => {
  expect((await e.fixer.accept({ id, fixer: 'fx_ui' }, 'cash')).status).toBe('applied')
  const r = await e.fixer.go(id)
  expect(r.reason).toBeUndefined()
}
export const minutes = (e: Eng) => e.state.time.day * 1440 + e.state.time.hour * 60 + e.state.time.minute
