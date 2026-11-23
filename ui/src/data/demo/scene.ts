import type { Actor, Change, ContentEntry } from '@engine/src'

/**
 * 示意世界包的成人場景那一塊（M2-ui-scene）：三個基本體位、兩個要學的體位、幾個示意的夜課技能、兩件道具、傾向的標籤，
 * 以及兩場示範的場景（琥珀、小麥）。格式是引擎 features/scene 收的內容種類：position、night_skill、item（多一個 scene 欄位）。
 * 不放進 engine/data；正式內容匯入時整包換掉。測試自帶更小的一份，不用這裡。
 * 所有參與者都是成年人。技能名與部位都是中性的標籤；場景的描寫是結束之後 AI 的事。
 */
type Rec = Record<string, unknown>

const ROLES_UPPER_A = [{ id: 'a', upper: true }, { id: 'b', upper: false }]
const ROLES_UPPER_B = [{ id: 'a', upper: false }, { id: 'b', upper: true }]
const ROLES_FLAT = [{ id: 'a', upper: false }, { id: 'b', upper: false }]
const HANDS = ['hand_l', 'hand_r']
const handsTo = (parts: string[]): Rec[] => HANDS.flatMap((h) => parts.map((p) => ({ from: ['a', h], to: ['b', p] })))
const link = (a: string, b: string): Rec => ({ from: ['a', a], to: ['b', b] })

export const POSITION_ENTRIES: Rec[] = [
  {
    id: 'pos_side', name: '並躺', people: 2, roles: ROLES_FLAT, mult: { a: 1, b: 1 }, initiative_drift: 0, unlocked_by: null, text: '兩個人並排躺著。',
    links: [link('mouth', 'mouth'), link('mouth', 'chest'), ...handsTo(['chest', 'front', 'back', 'legs']), link('legs', 'legs'), link('front', 'front')],
  },
  {
    id: 'pos_face', name: '面對面', people: 2, roles: ROLES_UPPER_A, mult: { a: 1, b: 1.2 }, initiative_drift: 3, unlocked_by: null, text: '兩個人面對面。',
    links: [link('mouth', 'mouth'), link('mouth', 'chest'), ...handsTo(['chest', 'front', 'back']), link('front', 'front'), link('chest', 'chest')],
  },
  {
    id: 'pos_behind', name: '從後面', people: 2, roles: ROLES_UPPER_A, mult: { a: 1, b: 1.3 }, initiative_drift: 3, unlocked_by: null, text: '一個人貼在另一個人身後。',
    links: [link('mouth', 'back'), ...handsTo(['chest', 'front']), link('front', 'front'), link('front', 'back'), link('tail', 'front')],
  },
  {
    id: 'pos_ride', name: '騎乘', people: 2, roles: ROLES_UPPER_B, mult: { a: 1.3, b: 1 }, initiative_drift: 3, tag: 'tg_dom', unlocked_by: 'nt_ride', text: '一個人坐在另一個人身上。',
    links: [link('mouth', 'mouth'), ...handsTo(['chest', 'front', 'back']), link('front', 'front'), link('chest', 'mouth')],
  },
  {
    id: 'pos_kneel', name: '跪姿', people: 2, roles: ROLES_UPPER_B, mult: { a: 1.2, b: 1.1 }, initiative_drift: 3, tag: 'tg_sub', unlocked_by: 'nt_kneel', text: '一個人跪在另一個人面前。',
    links: [link('mouth', 'front'), link('mouth', 'legs'), ...handsTo(['legs', 'front'])],
  },
]

/** 夜課技能（只有 scene 欄位是機制；其餘 M2 不看）。nt_ride、nt_kneel 只是開放體位的夜課，沒有場景裡的招式。 */
export const SKILL_ENTRIES: Rec[] = [
  { id: 'nt_ride', name: '夜課・騎乘' },
  { id: 'nt_kneel', name: '夜課・跪姿' },
  {
    id: 'nt_stroke', name: '慢慢摸',
    scene: { ap: 1, my_part: HANDS, their_part: ['chest', 'front', 'back', 'legs', 'mouth'], on_use: { their_load: '1d3', fit: 2 }, link: { their_load: '1d3', fit: 2 } },
  },
  {
    id: 'nt_kiss', name: '親吻',
    scene: { ap: 1, my_part: ['mouth'], their_part: ['mouth', 'chest'], on_use: { their_load: '1d3', my_load: '1d3', fit: 3 }, link: { their_load: '1d3', my_load: '1d3', fit: 2 } },
  },
  {
    id: 'nt_nibble', name: '輕咬',
    scene: { ap: 2, my_part: ['mouth'], their_part: ['chest', 'back', 'legs'], on_use: { their_load: '2d3', fit: 2 }, link: { their_load: '2d3', fit: 1 } },
  },
  {
    id: 'nt_press', name: '貼著磨蹭',
    scene: { ap: 1, my_part: ['front', 'legs', 'chest'], their_part: ['front', 'legs', 'chest'], on_use: { their_load: '1d3', my_load: '1d3', fit: 2 }, link: { their_load: '1d3', my_load: '1d3', fit: 2 } },
  },
  {
    id: 'nt_hold', name: '按住手腕', tag: 'tg_dom', tags: ['restraint'],
    scene: { ap: 1, my_part: HANDS, their_part: HANDS, on_use: { fit: 3 }, link: { their_load: '1d3', fit: 1 } },
  },
  {
    id: 'nt_whisper', name: '耳邊的命令', tag: 'tg_elder',
    scene: { ap: 1, my_part: ['mouth'], their_part: ['mouth'], on_use: { their_load: '1d3', fit: 3 }, link: { their_load: '1d3', fit: 1 } },
  },
]

/** 道具：潤滑凝膠（不是消耗品，沒有部位：只有用出去的那一下）與冷靜貼片（消耗品，自己的感載少一點）。 */
export const ITEM_ENTRIES: Rec[] = [
  { id: 'it_gel', name: '潤滑凝膠', desc: '讓這一場順一點的凝膠。', category: 'tool', grade: 1, size: 0, legal: 'free', scene: { ap: 1, on_use: { their_load: '1d3', fit: 2 } } },
  { id: 'it_calm', name: '冷靜貼片', desc: '貼在後頸，讓自己慢下來。', category: 'consumable', grade: 1, size: 0, legal: 'free', consumable: true, scene: { ap: 1, on_use: { my_load: '-1d6' } } },
]

export const TAG_ENTRIES: Rec[] = [
  { id: 'tg_dom', name: '主導', axis: 'relation' },
  { id: 'tg_sub', name: '服從', axis: 'relation' },
  { id: 'tg_elder', name: '御姐', axis: 'costume' },
  { id: 'tg_beast', name: '獸', axis: 'body' },
]

export function sceneContent(): Record<string, ContentEntry[]> {
  return { position: POSITION_ENTRIES, night_skill: SKILL_ENTRIES, item: ITEM_ENTRIES, tendency_tag: TAG_ENTRIES } as unknown as Record<string, ContentEntry[]>
}

// ---- 示範的場景 ----

export interface DemoScene {
  id: string
  /** 開場的那一句（確認框的標題） */
  opening: string
  /** 對象：還沒在狀態裡就加進去 */
  partner: Actor
  /** 開場景的設定（照引擎的 SceneSetup） */
  setup: { with: string[]; nature: string; goal?: string; place: string; start_position: string }
}

const person = (id: string, name: string, age: number, ext: Rec): Actor => ({
  id, name, role: 'npc', age, perks: [], hp: 40, load: 0, afterglow: 0, sink: 0, conditions: [],
  attrs: { body: 10, reflex: 11, tech: 10, intellect: 12, resolve: 11, charm: 14 }, skills: { negotiate: 3, perform: 3 }, ext,
} as unknown as Actor)

export const DEMO_SCENES: DemoScene[] = [
  {
    id: 'amber', opening: '琥珀拉著你上了二樓',
    partner: person('npc_amber', '琥珀', 29, {
      bridge: { sensitivity: 58, tolerance: 30, craving: 30, docility: 30 }, tendency: { axes: {}, points: {}, tags: { tg_elder: 'has', tg_sub: 'has' } }, scene: { positions: ['pos_ride', 'pos_kneel'], skills: [] },
    }),
    setup: { with: ['npc_amber'], nature: 'mutual', goal: 'info', place: '櫻町「半夢」的二樓', start_position: 'pos_side' },
  },
  {
    id: 'rin', opening: '小麥把郵差包放下，往你身邊靠過來',
    partner: person('npc_xiaomai', '小麥', 26, {
      bridge: { sensitivity: 52, tolerance: 30, craving: 30, docility: 15 }, tendency: { axes: {}, points: {}, tags: { tg_beast: 'has' } }, scene: { positions: [], skills: [], parts: ['tail'] },
    }),
    setup: { with: ['npc_xiaomai'], nature: 'mutual', place: '四號塔的屋頂', start_position: 'pos_face' },
  },
]

/** 示範場景開始之前要先放好的東西：對象進狀態、主角會的體位與技能、兩件道具、一點「主導」的傾向。回傳要提交的變更。 */
export function demoSceneChanges(scene: DemoScene, has: { actor: boolean; pc: string; ext: Record<string, unknown>; items: string[] }): Change[] {
  const out: Change[] = []
  if (!has.actor) out.push({ op: 'actor.add', actor: scene.partner } as unknown as Change)
  const mine = (has.ext.scene ?? {}) as { positions?: string[]; skills?: string[] }
  const skills = [...new Set([...(mine.skills ?? []), 'nt_stroke', 'nt_kiss', 'nt_nibble', 'nt_press', 'nt_hold', 'nt_whisper'])]
  const positions = [...new Set([...(mine.positions ?? []), 'pos_ride'])]
  out.push({ op: 'actor.ext', id: has.pc, key: 'scene', value: { ...(mine as object), skills, positions } } as unknown as Change)
  if (!(has.ext.tendency as { tags?: Record<string, string> } | undefined)?.tags?.tg_dom) {
    const t = (has.ext.tendency ?? { axes: {}, points: {}, tags: {} }) as { axes: object; points: object; tags: Record<string, string> }
    out.push({ op: 'actor.ext', id: has.pc, key: 'tendency', value: { ...t, tags: { ...t.tags, tg_dom: 'has' } } } as unknown as Change)
  }
  if (!has.ext.bridge) out.push({ op: 'actor.ext', id: has.pc, key: 'bridge', value: { sensitivity: 46, tolerance: 30, craving: 30, docility: 10 } } as unknown as Change)
  for (const id of ['it_gel', 'it_calm']) if (!has.items.includes(id)) out.push({ op: 'item', id, qty: 2 } as unknown as Change)
  return out
}
