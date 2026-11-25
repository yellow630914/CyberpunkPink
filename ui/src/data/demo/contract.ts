import type { Change, ContentPack, GameState, Kernel } from '@engine/src'
import { holdPlan } from '@engine/src/features/contract'
import { meetChanges } from '@engine/src/features/npcs'
import { joinChanges } from '@engine/src/features/roster'
import { blockIdOf } from './world'

/**
 * 示意世界包的契約部分（M4-contract-holder；LEWD_SYSTEM 第 7 節、EVENTS 4.5 節；第 18 題：示意包放一個「主角是持約人」的開局）：
 * 一位固定 NPC（阿音：欠了債、債權被主角買下）、範圍 contract 的觸發點（持約人叫他做事 holder_order、解約之後 released、他主動找你的 daily 與 home）、
 * 幾件很小的示意事件（只有機制：旗標與一點錢，沒有成人內容）、開局時把契約放進狀態的變更 demoHolderChanges。
 * 整份是資料與一個「誰」的決定：契約怎麼建、名冊怎麼進、身分怎麼改都是引擎自己的函式（holdPlan、meetChanges、joinChanges）。正式內容匯入之後整包換掉。測試不用它。
 */
type Rec = Record<string, unknown>

export const DEMO_HOLDER_NPC = 'npc_ayin'
const ALL = ['dawn', 'morning', 'noon', 'afternoon', 'prime', 'late']

const NPCS: Rec[] = [
  {
    id: DEMO_HOLDER_NPC, name: '阿音', kind: 'citizen', age: 26, gender: 'female', occupation: '欠了債的駐唱歌手', guard: 12, wealth: 1,
    haunts: [{ district: 'hive', block: blockIdOf('hive', '四號塔'), time: ALL }],
    persona: { attrs: ['老派'], quadrants: ['按部就班', '護短'] },
    bridge: { sensitivity: 40, tolerance: 25, craving: 30, docility: 35 }, sink: 10,
    attrs: { charm: 13, resolve: 9 }, skills: {},
  },
]

const flag = (key: string) => ({ kind: 'flag', key, value: true })
const cash = (amount: number) => ({ kind: 'cash', amount })
const BASE = { scope: 'contract', repeat_days: 0 }

const EVENTS: Rec[] = [
  {
    ...BASE, id: 'ct_demo_errand', triggers: ['holder_order'], where: { order: 'errand' }, category: 'favor',
    text: '你交代下去的差事有了結果：她把東西送到了，還帶回一點跑腿的零錢。',
    options: [
      { id: 'take', text: '收下零錢。', outcomes: { any: [cash(20), flag('demo_holder_errand')] } },
      { id: 'keep', text: '讓她自己留著。', outcomes: { any: [flag('demo_holder_errand')] } },
    ],
  },
  {
    ...BASE, id: 'ct_demo_talk', triggers: ['holder_order'], where: { order: 'talk' }, category: 'rumor',
    text: '你找她坐下來談了一談。她說起這幾天聽來的事，也問了你一件她一直想問的事。',
    options: [
      { id: 'listen', text: '好好聽她說完。', outcomes: { any: [flag('demo_holder_talk')] } },
      { id: 'cut', text: '點個頭，把話題帶開。', outcomes: { any: [] } },
    ],
  },
  {
    ...BASE, id: 'ct_demo_work', triggers: ['holder_order'], where: { order: 'work' }, category: 'opportunity',
    text: '你替她安排的工作有了回音：店家說她手腳俐落，下個禮拜還想請她。',
    options: [{ id: 'ok', text: '知道了。', outcomes: { any: [flag('demo_holder_work')] } }],
  },
  {
    ...BASE, id: 'ct_demo_modify', triggers: ['holder_order'], where: { order: 'modify' }, category: 'trouble',
    text: '你送她去的診所來了訊息：手續辦完了，她正在休息，請你有空來接。',
    options: [{ id: 'ok', text: '晚點去接她。', outcomes: { any: [flag('demo_holder_modify')] } }],
  },
  {
    ...BASE, id: 'ct_demo_serve', triggers: ['holder_order'], where: { order: 'serve' }, category: 'favor',
    text: '她來了，在門口站著，等你先開口。',
    options: [
      { id: 'sit', text: '請她坐下。', outcomes: { any: [flag('demo_holder_serve')] } },
      { id: 'send', text: '說沒事了，讓她回去。', outcomes: { any: [] } },
    ],
  },
  {
    ...BASE, id: 'ct_demo_released', triggers: ['released'], category: 'favor',
    text: '契約解除了。她站在原地，不太確定自己現在可以去哪裡。',
    options: [
      { id: 'stay', text: '告訴她：想留下的話，名冊上還有她的位子。', outcomes: { any: [flag('demo_holder_stay')] } },
      { id: 'go', text: '告訴她：想走就走，路上小心。', outcomes: { any: [flag('demo_holder_go')] } },
    ],
  },
  {
    // 他主動找你（持約人的家、每天）：事件資料用條件挑；沒有契約的人看不到
    scope: 'contract', repeat_days: 3, id: 'ct_demo_visit', triggers: ['home', 'daily'], category: 'favor', requires: { kind: 'contract', side: 'holder' },
    text: '她主動來找你，說這幾天一直想跟你說一聲謝謝，雖然她也不確定該不該謝。',
    options: [
      { id: 'smile', text: '笑一笑，說不用客氣。', outcomes: { any: [flag('demo_holder_visit')] } },
      { id: 'nod', text: '點點頭。', outcomes: { any: [] } },
    ],
  },
]

/** 範圍 contract：和核心包同一個 id（後載入的取代）；核心的欄位照抄，加上持約人這一面要的觸發點。 */
const SCOPE: Rec = {
  id: 'contract', triggers: { order: 1, holder_order: 1, released: 1, home: 0.15, daily: 0.2 }, priority: 2,
  daily_roll: { eden: 0.4, gang: 0.3, corp: 0.25, person: [0.15, 0.45] }, satisfaction_mult: [[0, 1.5], [30, 1.0], [70, 0.6]], queue_max: 3, repeat_days: 2, lost: 'defer',
}

export function contractContent(): NonNullable<ContentPack['content']> {
  return { npc: NPCS, event_scope: [SCOPE], event: EVENTS } as unknown as NonNullable<ContentPack['content']>
}

const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T

/**
 * 「主角是持約人」的開局（第 18 題）：主角在拍賣會上買下了阿音的債（債務契約，剩 C$6,000）。
 * 阿音先認識（變成在場的角色）、對主角的親密度 45、成為名冊的成員，再由引擎的 holdPlan 建契約、把她的身分改成契約人；
 * 開局不另外發一份「你成了她的持約人」的紀錄（通知清掉）。沒有主角時是空的。
 */
export function demoHolderChanges(k: Kernel, state: GameState): Change[] {
  const pc = state.pc
  if (!pc) return []
  const sim = clone(state)
  const out: Change[] = []
  const apply = (changes: Change[]): void => {
    out.push(...changes)
    k.changes.applyAll(sim, changes)
  }
  apply(meetChanges(k, sim, DEMO_HOLDER_NPC))
  apply([{ op: 'meter', kind: 'affinity', key: DEMO_HOLDER_NPC, set: 45 }])
  apply(joinChanges(k, sim, DEMO_HOLDER_NPC, { pay: 'share', fixed: true }))
  const plan = holdPlan(k, sim, pc, { npc: DEMO_HOLDER_NPC, type: 'debt', debt: 6000, origin: '你在拍賣會上買下了她的債' })
  if (plan) {
    apply(plan.changes.map((c) => (c.op === 'ext' && c.key === 'contract' ? { ...c, value: { ...(c.value as Rec), notes: [] } } : c)))
  }
  return out
}
