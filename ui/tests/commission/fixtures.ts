// 委託介面的驗收測試用的最小假資料（M2-ui-commission）：一位中間人、兩件假委託、兩張小房間（一張走得通、一張中間有上鎖的門）、一組名冊上的人。
// 規則一律是引擎的（CORE_PACK 的規則表與敵人）：這裡只有委託、地圖與人。

import { createPinia, setActivePinia } from 'pinia'
import { createSSRApp } from 'vue'
import { createMemoryHistory, createRouter } from 'vue-router'
import { renderToString } from 'vue/server-renderer'
import type { Actor, ContentPack, Feature, Kernel } from '@engine/src'
import { useEngine } from '../../src/stores/engine'

type Rec = Record<string, unknown>

export const DRAFT = {
  name: '露', gender: 'female', age: 22, origin: 'hive', originChoice: { favor: 'lonestar' },
  attrPick: { reflex: 15, charm: 14, intellect: 13, body: 12, resolve: 10, tech: 8 },
  attrBonus: { tech: -4, reflex: 3, resolve: 3 },
  skills: { streetwise: 3, negotiate: 3, perform: 2, stealth: 2 },
  perks: ['smooth_talker', 'tough'],
}

const cell = (id: string, at: [number, number], mark: string, name: string, kind?: string): Rec => ({ id, at, mark, name, ...(kind ? { kind } : {}) })

/** 走得通的小房間：北門進來、站上 T1 就是目標；沒有上鎖的門 */
const ROOM_A = {
  id: 'ui_room_a', kind: 'room', size: [9, 5], fits: [],
  sheets: [{
    id: 'a', name: '小房間', size: [9, 5],
    layout: ['####E####', '#..1.G..#', 'E...T...E', '#..2....#', '###X#####'],
    cells: [cell('E1', [4, 0], 'E', '北門', 'front'), cell('E2', [0, 2], 'E', '西門', 'back'), cell('E3', [8, 2], 'E', '東門', 'side'), cell('G1', [5, 1], 'G', '守衛的位置'), cell('T1', [4, 2], 'T', '目標'), cell('X1', [3, 4], 'X', '撤離點')],
    spots: [{ id: '!1', at: [3, 1], cover: 'dense' }, { id: '!2', at: [3, 3], cover: 'medium' }],
  }],
}
/** 中間有一道上鎖的門（%）：進門之後 T1 在門後面 */
const ROOM_LOCK = {
  id: 'ui_room_lock', kind: 'room', size: [9, 5], fits: [],
  sheets: [{
    id: 'l', name: '上鎖的房間', size: [9, 5],
    layout: ['####E####', '#..1.G..#', '####%####', '#..2T...E', '###X#####'],
    cells: [cell('E1', [4, 0], 'E', '北門', 'front'), cell('E2', [8, 3], 'E', '東門', 'side'), cell('G1', [5, 1], 'G', '守衛的位置'), cell('T1', [4, 3], 'T', '目標'), cell('X1', [3, 4], 'X', '撤離點')],
    spots: [{ id: '!1', at: [3, 1], cover: 'dense' }, { id: '!2', at: [3, 3], cover: 'medium' }],
  }],
}

const branch = (id: string, kind: string, entry: string, need?: Rec): Rec => ({ id, kind, entry, ...(need ? { need } : {}) })
const faces = (names: string[], map: string, goal?: Rec): Rec => Object.fromEntries(names.map((f) => [f, f === 'meat'
  ? { map, encounter: [], ...(goal ? { goal } : {}), gives: f === 'meat' ? undefined : undefined, branches: [branch('assault', 'assault', 'E1'), branch('duct', 'stealth', 'E1', { basic: 'stealth', level: 5 }), branch('bribe', 'talk', 'E1', { basic: 'negotiate', level: 5 }), branch('pass', 'linked', 'E1', { link: 'lk_pass' })] }
  : f === 'net' ? { layer: 'guest', branches: [{ id: 'assault', kind: 'assault' }] } : { branches: [{ id: 'assault', kind: 'assault' }] }]))

/** 三階段的假委託：每個階段都只要走到 T1。第一階段另開了內海與輿論（輔助面能派人）。 */
function commission(id: string, map: string, extra: Rec = {}, scale: 'small' | 'medium' = 'small'): Rec {
  const stage = (name: string, names: string[]): Rec => ({ name, faces: faces(names, map, { kind: 'reach', at: 'T1' }) })
  return {
    id, name: `假副本 ${id}`, kind: 't_ui', main: 'meat', scale, grade: 2, target_faction: 'hizakura', district: 'ui_d', conditions: ['不准死人'],
    stages: scale === 'medium'
      ? [stage('摸進去', ['meat', 'net', 'opinion']), stage('多一道門', ['meat', 'net']), stage('往裡面走', ['meat', 'net']), stage('動手', ['meat'])]
      : [stage('摸進去', ['meat', 'net', 'opinion']), stage('往裡面走', ['meat', 'net']), stage('動手', ['meat'])],
    links: { lk_pass: { type: 'open', name: '員工憑證' } },
    ...extra,
  }
}

export const OFFER_A = {
  id: 'of_ui_a', title: '測試用的竊密', brief: '{fixer}要一份帳本。', reward: 1000, commission: commission('cm_ui_a', 'ui_room_a'),
  unknowns: [
    { id: 'u_stage2', cat: 'stage', text: '第二階段可以選：現實、內海', reveal: { stage: 2 } },
    { id: 'u_guard', cat: 'guard', text: '辦公層四個保全', reveal: { guards: 1 } },
    { id: 'u_path', cat: 'path', text: '貨梯直通機房', reveal: { branch: 'duct' } },
    { id: 'u_client', cat: 'employer', text: '雇主是緋櫻的稽核部', reveal: { flag: 'employer_known' } },
  ],
}
/** 中型（四階段）、六個沒揭開的守備：踩點次數與第 4 次起 +1 的格子用 */
export const OFFER_C = {
  id: 'of_ui_c', title: '測試用的中型案', brief: '{fixer}要你多跑幾趟。', reward: 3000, commission: commission('cm_ui_c', 'ui_room_a', {}, 'medium'),
  unknowns: [1, 2, 3, 4, 5, 6].map((n) => ({ id: `u_g${n}`, cat: 'guard', text: `第 ${n} 組守備`, reveal: { guards: 1 } })),
}
export const OFFER_B = { id: 'of_ui_b', title: '測試用的上鎖房間', brief: '{fixer}要你進那間房。', reward: 2000, commission: commission('cm_ui_b', 'ui_room_lock'), unknowns: [] }

/** 這位中間人今天給的兩件委託（掛在 fixer.offers 上，和真的生成功能一樣的介面） */
export const PROVIDER: Feature = {
  id: 'ui_offers',
  install(k: Kernel) {
    k.hooks.on('fixer.offers', 'ui_offers', ({ fixer }) => (fixer.id === 'fx_ui' ? structuredClone([OFFER_A, OFFER_B, OFFER_C]) as never : undefined))
  },
}

export const PACK: ContentPack = {
  id: 'ui_commission',
  content: {
    district: [{ id: 'ui_d', name: '測試區', grade: 2, blocks: ['b_ui'], factions: ['hizakura'] }],
    block: [{ id: 'b_ui', district: 'ui_d', name: '測試街', kind: 'block', map: 'm_ui', exits: { E1: { to: 'b_ui', arrive: 'E1' } }, facilities: {} }],
    fixer: [{ id: 'fx_ui', name: '測試中間人', npc: 'npc_monroe', district: 'ui_d', kinds: ['t_ui'], cut: 0.1 }],
    special_map: [ROOM_A, ROOM_LOCK, { id: 'm_ui', kind: 'block', size: [5, 3], sheets: [{ id: 'street', name: '測試街', size: [5, 3], layout: ['#E###', '#...#', '#####'], cells: [{ id: 'E1', at: [1, 0], mark: 'E', name: '出口' }] }] }],
  } as unknown as ContentPack['content'],
}

/** 名冊上的人：有路數（行者）、有出場費的人。 */
export function person(id: string, name: string): Actor {
  return {
    id, name, role: 'npc', age: 27, perks: [], hp: 40, load: 0, afterglow: 0, sink: 0, conditions: [],
    attrs: { body: 12, reflex: 12, tech: 12, intellect: 12, resolve: 12, charm: 12 }, skills: { stealth: 3, firearms: 3, negotiate: 3, interface: 3, perform: 3 },
    ext: { paths: [{ path: 'gunner', slot: 'main', tier: 2 }], bridge: { sensitivity: 30, tolerance: 30, craving: 30, docility: 30 } },
  }
}
export const CREW = ['jo', 'ann', 'bob', 'cy', 'dee'].map((id) => person(id, `人${id}`))

export type Eng = ReturnType<typeof useEngine>
export interface Setup { pinia: ReturnType<typeof createPinia>; e: Eng }

/** 開一局：測試自帶的內容、建好角色、現金 3000；crew 是放進名冊的人數 */
export function setup(o: { seed?: number; cash?: number; crew?: number } = {}): Setup {
  const pinia = createPinia()
  setActivePinia(pinia)
  const e = useEngine()
  e.newGame({ seed: o.seed ?? 7, testContent: [PACK], testFeatures: [PROVIDER] })
  const blocks = e.createCharacter(DRAFT)
  if (blocks.length) throw new Error(`建角被擋：${blocks.map((b) => b.reason).join('；')}`)
  e.ledger([{ op: 'cash', delta: (o.cash ?? 3000) - e.money.cash }])
  const n = o.crew ?? 0
  if (n > 0) {
    const members = CREW.slice(0, n)
    const why = e.commit({
      summary: '名冊', action: 'ui.test_roster',
      changes: members.flatMap((a) => [{ op: 'actor.add', actor: a }, { op: 'roster.join', who: a.id, since: { ...e.state.time }, reliability: 70, pay: 'fee' }, { op: 'meter', kind: 'loyalty', key: a.id, set: 60 }] as never[]),
    }, { attach: true })
    if (why) throw new Error(why)
  }
  return { pinia, e }
}

/** 轉成沒有註解的 HTML（伺服器端渲染；沒有瀏覽器） */
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
