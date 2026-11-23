import type { Change, ContentPack, GameState, Kernel } from '@engine/src'
import { meetChanges } from '@engine/src/features/npcs'
import { joinChanges } from '@engine/src/features/roster'
import { blockIdOf } from './world'
import { DISTRICTS } from '../districts'

/**
 * 示意世界包的人（dev/work/M2-ui-people.md 第 7 項）：把 ui/src/data/npcs.ts、roster.ts 的示意人物整理成引擎的內容。
 * 格式是引擎的內容種類（npc、npc_gen、name_pool），整份是資料，沒有規則；正式內容匯入之後整包換掉。
 *
 * - 固定 NPC 用 engine/data 已經有的 id（那邊只有 id 與名字）。`npc` 是可覆寫的內容（dev/adr/0017 M2 修正批第 14 項），
 *   載入順序在後的這個包整筆取代核心包同 id 的那幾筆，不必先濾掉。
 * - 每區一筆生成規則（npc_gen）加一份名字池：第一次走進一區時引擎照它生成街坊與行者，種子相同名單就相同。
 * - 開局的名冊：建角的開新局，成員由引擎照出身的名冊放進去（`creation.commit` 的後續），這裡只給候選人（奈奈、喬）；
 *   沒有主角的示意局（建角之前，people.demoChanges）沒有出身，成員（小麥、雷）也由 `demoPeopleChanges` 給。
 *   成員要在 state 有角色、帶路數才進得了隊伍。
 */

type Rec = Record<string, unknown>

const DAY = ['morning', 'noon', 'afternoon']
const EVENING = ['prime', 'late']
const AFTERNOON_ON = ['afternoon', 'prime', 'late']
const ALL = ['dawn', 'morning', 'noon', 'afternoon', 'prime', 'late']

const bridge = (sensitivity: number, tolerance: number, craving: number, docility: number) => ({ sensitivity, tolerance, craving, docility })

const NPCS: Rec[] = [
  {
    id: 'npc_xiaomai', name: '小麥', kind: 'runner', age: 22, gender: 'female', occupation: '蜂巢的信差', guard: 13, wealth: 1,
    haunts: [
      // 下午到夜裡在四號塔的晾衣場（開局那一刻就在那裡）；早上與中午在街上跑信
      { district: 'hive', block: blockIdOf('hive', '四號塔'), facility: 'fac_talk', time: AFTERNOON_ON },
      { district: 'hive', block: blockIdOf('hive', '四號塔'), time: ['morning', 'noon'], weight: 2 },
      { district: 'hive', block: blockIdOf('hive', '天井市場'), time: ['morning', 'noon'], weight: 1 },
    ],
    persona: { attrs: ['嘴甜'], quadrants: ['愛熱鬧', '護短'] },
    tendencies: { axes: { relation: 1, sense: 0, body: 0, costume: 0 }, tags: { tg_sub: 'has' } },
    bridge: bridge(45, 30, 20, 35), sink: 12,
    paths: [{ path: 'fixer', slot: 'main', tier: 3 }],
    flags: ['likes:food'], attrs: { body: 11, reflex: 13, tech: 10, intellect: 11, resolve: 10, charm: 14 }, skills: { negotiate: 3, streetwise: 3 },
  },
  {
    id: 'npc_lian', name: '阿蓮', kind: 'citizen', age: 37, gender: 'female', occupation: '阿蓮雜貨的老闆', guard: 15, wealth: 3,
    haunts: [{ district: 'hive', block: blockIdOf('hive', '天井市場'), facility: 'fac_shop', time: ['morning', 'noon', 'afternoon', 'prime'] }],
    persona: { attrs: ['老派'], quadrants: ['按部就班', '記仇'] },
    flags: ['fixer'], attrs: { charm: 13, intellect: 13 }, skills: { negotiate: 3 },
  },
  {
    id: 'npc_hebo', name: '何伯', kind: 'citizen', age: 71, gender: 'male', occupation: '四號塔的樓長', guard: 12, wealth: 1,
    haunts: [{ district: 'hive', block: blockIdOf('hive', '四號塔'), time: ALL }],
    persona: { attrs: ['老派'], quadrants: ['按部就班'] },
    flags: ['no_steal'], attrs: { body: 8 },
  },
  {
    id: 'npc_fengfeng', name: '縫縫', kind: 'staff', age: 35, gender: 'female', occupation: '地下室診所的無照改造師', guard: 14, wealth: 2,
    haunts: [{ district: 'hive', block: blockIdOf('hive', '四號塔'), facility: 'fac_clinic', time: ['morning', 'noon', 'afternoon', 'prime', 'late'] }],
    persona: { attrs: ['三無'], quadrants: ['獨來獨往'] },
    attrs: { tech: 15, intellect: 13 }, skills: { mechanics: 3, cyberware: 3 },
  },
  {
    id: 'npc_ray', name: '雷', kind: 'runner', age: 27, gender: 'male', occupation: '跑酒吧與賭場的掮客', guard: 14, wealth: 2,
    haunts: [
      { district: 'ave42', block: blockIdOf('ave42', '中城段・北'), time: EVENING, weight: 3 },
      { district: 'ave42', block: blockIdOf('ave42', '上城段'), time: DAY, weight: 1 },
    ],
    persona: { attrs: ['小惡魔'], quadrants: ['愛熱鬧', '見機行事'] },
    tendencies: { axes: { relation: 2, sense: 0, body: 0, costume: 0 }, tags: { tg_dom: 'has' } },
    bridge: bridge(30, 45, 35, 15), sink: 24,
    paths: [{ path: 'fixer', slot: 'main', tier: 3 }, { path: 'gunner', slot: 'sub', tier: 2 }],
    attrs: { body: 12, reflex: 13, tech: 10, intellect: 12, resolve: 11, charm: 14 }, skills: { negotiate: 3, firearms: 2 },
  },
  {
    id: 'npc_monroe', name: '夢露', kind: 'citizen', age: 39, gender: 'female', occupation: '四十二番街的中間人', guard: 16, wealth: 4,
    haunts: [{ district: 'ave42', block: blockIdOf('ave42', '中城段・北'), time: ['afternoon', 'prime', 'late'] }],
    persona: { attrs: ['嘴甜'], quadrants: ['記仇', '見機行事'] },
    flags: ['fixer'], attrs: { charm: 15, intellect: 13 }, skills: { negotiate: 4 },
  },
  {
    id: 'npc_nana', name: '奈奈', kind: 'runner', age: 23, gender: 'female', faction: 'rouge', occupation: '胭脂堂的跑腿，代號「九」', guard: 15, wealth: 2,
    haunts: [{ district: 'oldport', block: blockIdOf('oldport', '碼頭'), time: [...DAY, 'prime'] }],
    persona: { attrs: ['小惡魔'], quadrants: ['見機行事', '護短'] },
    bridge: bridge(35, 30, 25, 30), sink: 8,
    paths: [{ path: 'fixer', slot: 'main', tier: 2 }, { path: 'gunner', slot: 'sub', tier: 1 }],
    attrs: { body: 11, reflex: 13, charm: 13 }, skills: { negotiate: 2, firearms: 1 },
  },
  {
    id: 'npc_jo', name: '喬', kind: 'runner', age: 42, gender: 'male', faction: 'lonestar', occupation: '獨立接委託的退伍兵', guard: 16, wealth: 1,
    haunts: [{ district: 'hive', block: blockIdOf('hive', '東側'), time: ['afternoon', 'prime', 'late'] }],
    persona: { attrs: ['三無'], quadrants: ['獨來獨往', '按部就班'] },
    bridge: bridge(20, 55, 15, 10), sink: 4,
    paths: [{ path: 'gunner', slot: 'main', tier: 3 }],
    attrs: { body: 14, reflex: 13, resolve: 13 }, skills: { firearms: 4 },
  },
]

const POOLS: Rec[] = [
  { id: 'np_demo_zh', family: ['陸', '周', '王', '李', '張', '林', '黃', '吳', '蔡', '許', '鄭', '謝'], given: ['守仁', '曉雯', '志明', '小芬', '大偉', '佳怡', '建國', '淑惠', '俊傑', '雅婷', '子涵', '明哲', '欣怡', '冠宇'] },
  { id: 'np_demo_jp', family: ['佐藤', '鈴木', '高橋', '田中', '伊藤', '山本', '中村', '小林'], given: ['遙', '千尋', '美咲', '健太', '葵', '蓮', '紗良', '拓海'] },
  { id: 'np_demo_en', order: 'given_first', family: ['瑞德', '柯爾', '瓦爾加', '史密斯', '莫雷蒂'], given: ['黛比', '薇薇安', '傑克', '娜塔莉', '艾略特'] },
]

const GENERIC = (id: string) => `ng_${id}`
/** 每區一筆：[區, 街坊, 行者, 職業, 勢力, 名字池, 出沒的街區（第幾塊）] */
const GEN: Array<[string, number, number, Array<[string, number]>, Array<[string, number]>, string[], number[]]> = [
  ['hive', 6, 3, [['攤販', 3], ['信差', 2], ['拾荒者', 2], ['社畜', 1]], [['none', 5], ['lonestar', 1]], ['np_demo_zh'], [0, 1, 2]],
  ['ave42', 6, 3, [['酒保', 3], ['賭場荷官', 2], ['舞者', 2], ['掮客助手', 1]], [['none', 4], ['strippers', 1], ['guard', 1]], ['np_demo_zh', 'np_demo_en'], [0, 1, 2]],
  ['sakura', 5, 2, [['店員', 3], ['劇場工作人員', 2], ['技師', 1]], [['none', 4], ['hizakura', 1]], ['np_demo_jp', 'np_demo_zh'], [0, 1, 2]],
  ['crown', 5, 2, [['企業職員', 4], ['管家', 1]], [['none', 3], ['starbelle', 1], ['kunlun', 1]], ['np_demo_en', 'np_demo_zh'], [0, 1, 2]],
  ['oldport', 6, 3, [['搬運工', 3], ['船員', 2], ['攤販', 2]], [['none', 4], ['nora', 1], ['tokko', 1]], ['np_demo_zh', 'np_demo_jp'], [0, 1, 2]],
  ['glass', 4, 2, [['會員', 3], ['侍者', 2]], [['none', 3], ['eden', 1]], ['np_demo_en', 'np_demo_jp'], [0, 1, 2]],
  ['rust', 5, 3, [['工人', 3], ['拾荒者', 2], ['私兵', 1]], [['none', 4], ['blackspring', 2]], ['np_demo_zh'], [0, 1, 2]],
  ['under', 5, 3, [['攤販', 2], ['技師', 2], ['潛網者', 1]], [['none', 4], ['nora', 1]], ['np_demo_zh', 'np_demo_jp'], [0, 1, 2]],
]

const genEntries = (): Rec[] => GEN.map(([district, citizens, runners, occupations, factions, names, blocks]) => ({
  id: GENERIC(district), district, citizens, runners, occupations, factions, names,
  paths: [['gunner', 2], ['fixer', 2]],
  haunts: blocks.map((i, n) => ({ block: blockIdOf(district as never, nameAt(district, i)), time: n === 0 ? ALL : n === 1 ? [...DAY, 'prime'] : EVENING })),
}))

const nameAt = (district: string, i: number): string => DISTRICTS.find(d => d.id === district)!.blocks[i]!

/** 傾向標籤：scene.ts 裡有（tg_dom、tg_sub……）；這裡只用到它們 */
export function peopleContent(): NonNullable<ContentPack['content']> {
  return { npc: NPCS, name_pool: POOLS, npc_gen: genEntries() } as unknown as NonNullable<ContentPack['content']>
}

/** 開局的名冊：成員、候選人與他們的親密度（示意數字；老朋友從 34～52 開始） */
const START_MEMBERS: Array<{ id: string; affinity: number; pay: 'share'; fixed: true }> = [
  { id: 'npc_xiaomai', affinity: 34, pay: 'share', fixed: true },
  { id: 'npc_ray', affinity: 52, pay: 'share', fixed: true },
]
const START_CANDIDATES = ['npc_nana', 'npc_jo']

/**
 * 開局的名冊（成員先認識、變成角色、進名冊）與候選人。
 * 全部走引擎自己的函式（meetChanges、joinChanges、roster.candidate）；這裡只決定「誰」。
 */
export function demoPeopleChanges(k: Kernel, state: GameState, opts: { origin?: readonly string[] } = {}): Change[] {
  // origin 有給（建角的開新局）：成員是引擎照出身的名冊放的，這裡不重複；已經在出身名冊上的人也不當候選人
  const fromOrigin = opts.origin !== undefined
  const out: Change[] = []
  const seen = new Set<string>()
  const meet = (id: string): void => {
    if (seen.has(id)) return
    seen.add(id)
    out.push(...meetChanges(k, state, id))
  }
  // 老朋友的起始親密度（示意數字）：建角時只給出身名冊上的那幾位，先認識、再由引擎把他們放進名冊
  for (const m of START_MEMBERS) {
    if (fromOrigin && !opts.origin!.includes(m.id)) continue
    meet(m.id)
    out.push({ op: 'meter', kind: 'affinity', key: m.id, set: m.affinity })
  }
  if (!fromOrigin) {
    for (const m of START_MEMBERS) out.push(...joinChanges(k, state, m.id, { pay: m.pay, fixed: m.fixed }))
  }
  for (const id of START_CANDIDATES) {
    if (opts.origin?.includes(id)) continue
    meet(id)
    out.push({ op: 'roster.candidate', who: id, at: { ...state.time } })
  }
  return out
}
