// 成人場景介面的驗收測試用的最小假資料（M2-ui-scene）：三個基本體位、一個要學的體位、兩個假技能、兩件假道具、兩個角色。
// 規則一律是引擎的：這裡只有內容。畫面用 Vue 的伺服器端渲染轉成 HTML 來檢查（沒有瀏覽器）。

import { createPinia, setActivePinia } from 'pinia'
import { createSSRApp } from 'vue'
import { createMemoryHistory, createRouter } from 'vue-router'
import { renderToString } from 'vue/server-renderer'
import type { Actor, Change, ContentPack } from '@engine/src'
import type { FakeProvider } from '@engine/src'
import { useEngine } from '../../src/stores/engine'

export const DRAFT = {
  name: '露', gender: 'female', age: 22, origin: 'hive', originChoice: { favor: 'lonestar' },
  attrPick: { reflex: 15, charm: 14, intellect: 13, body: 12, resolve: 10, tech: 8 },
  attrBonus: { tech: -4, reflex: 3, resolve: 3 },
  skills: { streetwise: 3, negotiate: 3, perform: 2, stealth: 2 },
  perks: ['smooth_talker', 'tough'],
}

const roles = [{ id: 'a', upper: true }, { id: 'b', upper: false }]
const link = (a: string, b: string) => ({ from: ['a', a], to: ['b', b] })
export const PACK: ContentPack = {
  id: 'ui_scene',
  content: {
    night_skill: [
      { id: 'nt_hold', name: '牽著走', tag: 'tg_dom', tags: ['tg_dom'], scene: { ap: 2, my_part: ['hand_l', 'hand_r'], their_part: ['chest', 'back'], on_use: { their_load: '2d6', my_load: '1d6', fit: 4, initiative: 15 }, link: { their_load: '1d6', my_load: 0, fit: 1 }, match_bonus: 12 } },
      { id: 'nt_kiss', name: '慢慢靠近', scene: { ap: 1, my_part: ['mouth'], their_part: ['mouth'], on_use: { their_load: '1d6', fit: 2 }, link: { their_load: '1d6', fit: 0 }, positions: ['pos_face'] } },
      { id: 'nt_lap', name: '坐上來' },
      // M4-ui-scene：夜課的學習與單人
      { id: 'nt_c1', name: '學習一', branch: 'common', tier: 1, desc: '一個一階的共通技能。', scene: { ap: 1, my_part: ['mouth'], their_part: ['mouth'], on_use: { their_load: '1d6', fit: 2 } } },
      { id: 'nt_c3', name: '學習三', branch: 'common', tier: 3, scene: { ap: 1, my_part: ['mouth'], their_part: ['mouth'], on_use: { their_load: '1d6', fit: 2 } } },
      { id: 'nt_rich', name: '很貴的一招', branch: 'common', tier: 1, insight: 80, scene: { ap: 1, my_part: ['mouth'], their_part: ['mouth'], on_use: { their_load: '1d6', fit: 2 } } },
      { id: 'nt_solo', name: '一個人也行', branch: 'body', tier: 1, scene: { ap: 1, my_part: ['hand_l'], their_part: ['chest'], on_use: { my_load: '1d6', fit: 2 }, solo: 'ok' } },
      { id: 'nt_aud', name: '要有人看', branch: 'costume', tier: 1, scene: { ap: 1, my_part: ['hand_l'], their_part: ['chest'], on_use: { my_load: '1d6', fit: 2 }, solo: 'audience' } },
    ],
    night_resonance: [
      { id: 'res_c1', name: '熟門熟路', branch: 'common', tier: 1, desc: '一句說明。', scene: { free_switch: 1 } },
      { id: 'res_c4', name: '很深的功夫', branch: 'common', tier: 4, scene: { end_fit: 2 } },
    ],
    position: [
      { id: 'pos_face', name: '面對面', people: 2, roles, mult: { a: 1, b: 1.5 }, initiative_drift: 3, tags: [], unlocked_by: null, text: '兩個人面對面。', links: [link('mouth', 'mouth'), link('hand_l', 'chest'), link('hand_r', 'chest'), link('front', 'front'), link('hand_l', 'back')] },
      { id: 'pos_behind', name: '從後面', people: 2, roles, mult: { a: 1, b: 1.25 }, initiative_drift: 3, tags: [], unlocked_by: null, links: [link('front', 'back'), link('hand_l', 'chest'), link('hand_r', 'chest'), link('mouth', 'back')] },
      { id: 'pos_lie', name: '並躺', people: 2, roles: [{ id: 'a', upper: false }, { id: 'b', upper: false }], mult: { a: 1, b: 1 }, initiative_drift: 0, tags: [], unlocked_by: null, links: [link('hand_l', 'hand_l'), link('mouth', 'mouth'), link('hand_r', 'chest')] },
      { id: 'pos_trio', name: '三個人', people: 3, roles: [{ id: 'a', upper: true }, { id: 'b', upper: false }, { id: 'c', upper: false }], mult: { a: 1, b: 1.2, c: 1.2 }, initiative_drift: 2, tags: [], unlocked_by: null, text: '三個人貼在一起。', links: [link('mouth', 'mouth'), { from: ['a', 'hand_l'], to: ['b', 'chest'] }, { from: ['a', 'hand_r'], to: ['c', 'chest'] }, { from: ['b', 'mouth'], to: ['c', 'mouth'] }] },
      { id: 'pos_lap', name: '腿上', people: 2, roles, mult: { a: 1, b: 1 }, initiative_drift: 3, tags: [], unlocked_by: 'nt_lap', links: [link('front', 'front'), link('hand_l', 'chest')] },
    ],
    item: [
      { id: 'it_toy', name: '脈衝環', desc: '一個測試用的玩具。', category: 'tool', grade: 2, size: 0, legal: 'free', scene: { ap: 1, as_part: 'toy', their_part: ['front', 'chest'], on_use: { their_load: '1d6', fit: 2 }, link: { their_load: '1d6', fit: 0 } } },
      { id: 'it_calm', name: '冷靜貼片', desc: '一個測試用的貼片。', category: 'consumable', grade: 1, size: 0, legal: 'free', consumable: true, scene: { ap: 1, on_use: { my_load: '-1d6' } } },
    ],
    tendency_tag: [{ id: 'tg_dom', name: '支配', axis: 'relation' }, { id: 'tg_kiss', name: '親吻', axis: 'sense' }],
  } as unknown as ContentPack['content'],
}

export const ANN: Actor = {
  id: 'npc_ann', name: '安', role: 'npc', age: 27, perks: [], hp: 40, load: 0, afterglow: 0, sink: 0, conditions: [],
  attrs: { body: 12, reflex: 12, tech: 12, intellect: 12, resolve: 12, charm: 12 }, skills: { negotiate: 3 },
  ext: { bridge: { sensitivity: 100, tolerance: 30, craving: 30, docility: 30 } },
} as unknown as Actor

const person = (id: string, name: string): Actor => ({ ...ANN, id, name } as Actor)
export const BEA: Actor = person('npc_bea', '貝')
export const CAT: Actor = person('npc_cat', '凱')
export const SETUP = { with: ['npc_ann'], nature: 'mutual' }
export const TRIO = { with: ['npc_ann', 'npc_bea'], nature: 'mutual', mode: 'full' }

export type Eng = ReturnType<typeof useEngine>
export interface Setup { pinia: ReturnType<typeof createPinia>; e: Eng }

/** 開一局、建好角色、放好對象與主角會的招式；mode 是場景的操作（精簡或完整）。 */
export async function setup(o: { seed?: number; mode?: 'simple' | 'full'; rules?: object; pcDocility?: number; begin?: boolean; setup?: Record<string, unknown>; people?: Actor[]; skills?: string[]; insight?: number; ext?: Record<string, unknown>; provider?: FakeProvider } = {}): Promise<Setup> {
  const pinia = createPinia()
  setActivePinia(pinia)
  const e = useEngine()
  e.scene.setMode(o.mode ?? 'simple')
  e.newGame({ seed: o.seed ?? 7, ...(o.rules ? { rules: o.rules } : {}), testContent: [PACK], ...(o.provider ? { testProvider: o.provider } : {}) })
  const blocks = e.createCharacter(DRAFT)
  if (blocks.length) throw new Error(`建角被擋：${blocks.map((b) => b.reason).join('；')}`)
  const pc = e.state.pc!
  const changes: Change[] = [
    { op: 'actor.add', actor: ANN },
    ...(o.people ?? []).map((a) => ({ op: 'actor.add', actor: a })),
    ...(o.insight ? [{ op: 'meter', kind: 'insight', key: '_', delta: o.insight }] : []),
    { op: 'actor.ext', id: pc, key: 'bridge', value: { sensitivity: 50, tolerance: 30, craving: 30, docility: o.pcDocility ?? 10 } },
    { op: 'actor.ext', id: pc, key: 'tendency', value: { axes: {}, points: {}, tags: { tg_dom: 'has' } } },
    { op: 'actor.ext', id: pc, key: 'scene', value: { skills: o.skills ?? ['nt_hold', 'nt_kiss'], positions: ['pos_lap'] } },
    ...Object.entries(o.ext ?? {}).map(([key, value]) => ({ op: 'actor.ext', id: pc, key, value })),
    { op: 'item', id: 'it_toy', qty: 1 }, { op: 'item', id: 'it_calm', qty: 2 },
  ] as unknown as Change[]
  const why = e.commit({ summary: '放好場景要用的東西', action: 'ui.test_scene', changes }, { attach: true })
  if (why) throw new Error(why)
  if (o.begin !== false) {
    const w = await e.scene.begin(o.setup ?? SETUP)
    if (w) throw new Error(`場景開不起來：${w}`)
  }
  return { pinia, e }
}

/** 整頁轉成沒有註解的 HTML（伺服器端渲染；沒有瀏覽器） */
export async function html(pinia: ReturnType<typeof createPinia>, comp: object, props: Record<string, unknown> = {}, route = '/'): Promise<string> {
  const app = createSSRApp(comp, props)
  app.use(pinia)
  const router = createRouter({ history: createMemoryHistory(), routes: [{ path: '/:rest(.*)*', component: { render: () => null } }] })
  await router.push(route)
  await router.isReady()
  app.use(router)
  return (await renderToString(app)).replace(/<!--[\s\S]*?-->/g, '')
}
export const text = (h: string): string => h.replace(/<[^>]+>/g, '')
/** 帶某個屬性的那個標籤的開頭（class、title 都在裡面） */
export const tagOf = (h: string, attr: string): string => {
  const i = h.indexOf(attr)
  if (i < 0) return ''
  const open = h.lastIndexOf('<', i)
  return h.slice(open, h.indexOf('>', i) + 1)
}
export const attrOf = (tag: string, name: string): string | null => new RegExp(`${name}="([^"]*)"`).exec(tag)?.[1] ?? null
