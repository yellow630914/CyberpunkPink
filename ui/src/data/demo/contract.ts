import type { Change, ContentPack, GameState, Kernel } from '@engine/src'
import { effectCtx } from '@engine/src'
import { holdPlan } from '@engine/src/features/contract'
import { meetChanges } from '@engine/src/features/npcs'
import { joinChanges } from '@engine/src/features/roster'
import { blockIdOf } from './world'

/**
 * 示意世界包的契約部分（M4-contract-holder；LEWD_SYSTEM 第 7 節、EVENTS 4.5 節；第 18 題：示意包放一個「主角是持約人」的開局）：
 * 一位固定 NPC（阿音：欠了債、債權被主角買下）、範圍 contract 的觸發點（持約人叫他做事 holder_order、解約之後 released、他主動找你的 daily 與 home）、
 * 幾件很小的示意事件（只有機制：旗標與一點錢，沒有成人內容）、開局時把契約放進狀態的變更 demoHolderChanges。
 * 整份是資料與一個「誰」的決定：契約怎麼建、名冊怎麼進、身分怎麼改都是引擎自己的函式（holdPlan、meetChanges、joinChanges）。正式內容匯入之後整包換掉。測試不用它。
 *
 * M4-ui-contract 加的：「主角是契約人」的開局 demoBoundChanges（一份伊甸園的債務契約、佇列三條；用引擎的效果 contract_sign、order）與三件指令事件（範圍 contract、觸發點 order，做完用 order_done）；
 * 蠱惑：一個流竄 AI、兩件蠱惑事件（一件登入、一件長休；範圍 rogue_ai）、牠的吻（一筆惡意韌體）；調校：靜水（照 0019 P65：兩筆被動效果加 no_full_sync）與聚光；一位可以教槍械的 NPC（老何）。
 */
type Rec = Record<string, unknown>

export const DEMO_HOLDER_NPC = 'npc_ayin'
export const DEMO_TEACHER_NPC = 'npc_laohe'
export const DEMO_AI = 'ai_demo_mommy'
export const DEMO_STILL = 'tu_still'
const ALL = ['dawn', 'morning', 'noon', 'afternoon', 'prime', 'late']

const NPCS: Rec[] = [
  {
    id: DEMO_HOLDER_NPC, name: '阿音', kind: 'citizen', age: 26, gender: 'female', occupation: '欠了債的駐唱歌手', guard: 12, wealth: 1,
    haunts: [{ district: 'hive', block: blockIdOf('hive', '四號塔'), time: ALL }],
    persona: { attrs: ['老派'], quadrants: ['按部就班', '護短'] },
    bridge: { sensitivity: 40, tolerance: 25, craving: 30, docility: 35 }, sink: 10,
    attrs: { charm: 13, resolve: 9 }, skills: {},
  },
  {
    // 可以請教的人：槍械 6 級，整天都在四號塔的晾衣場（開局那一刻就在場；站在設施上時出沒表要寫那一種設施）
    id: DEMO_TEACHER_NPC, name: '老何', kind: 'citizen', age: 58, gender: 'male', occupation: '退休的槍匠', guard: 14, wealth: 1,
    haunts: [{ district: 'hive', block: blockIdOf('hive', '四號塔'), facility: 'fac_talk', time: ALL }],
    persona: { attrs: ['老派'], quadrants: ['按部就班', '護短'] },
    bridge: { sensitivity: 30, tolerance: 40, craving: 20, docility: 20 }, sink: 5,
    attrs: { reflex: 14, body: 11, resolve: 12 }, skills: { firearms: 6 },
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

const sink = (amount: number) => ({ kind: 'sink', amount })
const lureFx = (choice: string) => ({ kind: 'lure', ai: DEMO_AI, choice })
const done = (kind: string) => ({ kind: 'order_done', order_kind: kind })

/** 契約人那一面的指令事件（觸發點 order；做完用 order_done 把那一條收尾）：三件最小的 */
const ORDER_EVENTS: Rec[] = [
  {
    ...BASE, id: 'ct_demo_order_errand', triggers: ['order'], where: { order: 'errand' }, category: 'favor',
    text: '你把東西送到了。收件的人沒多說話，只在簽收單上按了個章，上面寫著伊甸園的名字。',
    options: [{ id: 'ok', text: '收好簽收單。', outcomes: { any: [done('errand'), flag('demo_bound_errand')] } }],
  },
  {
    ...BASE, id: 'ct_demo_order_work', triggers: ['order'], where: { order: 'work' }, category: 'opportunity',
    text: '今天的班排在二樓的接待。領班把名牌遞給你，說做滿時數就可以走。',
    options: [
      { id: 'work', text: '戴上名牌，把班做完。', outcomes: { any: [done('work'), cash(120), flag('demo_bound_work')] } },
      { id: 'quiet', text: '低著頭，把該做的做完。', outcomes: { any: [done('work'), flag('demo_bound_work')] } },
    ],
  },
  {
    ...BASE, id: 'ct_demo_order_report', triggers: ['order'], where: { order: 'report' }, category: 'rumor',
    text: '你照規定到了櫃檯，讓人看了你的橋。對方在表上打了個勾，沒有多問。',
    options: [{ id: 'ok', text: '收好回條。', outcomes: { any: [done('report'), flag('demo_bound_report')] } }],
  },
]

/** 蠱惑事件（範圍 rogue_ai；一件登入、一件長休醒來）：三個固定的選項，沉溺與累計都寫在選項的效果裡；拒絕在沉溺 100 以上不列 */
const lureEvent = (id: string, trigger: string, text: string): Rec => ({
  id, scope: 'rogue_ai', triggers: [trigger], tags: ['ai:媽咪', 'resist_lure'], category: 'desire', requires: { kind: 'lure_open', ai: DEMO_AI }, text, repeat_days: 0,
  options: [
    { id: 'follow', text: '順著牠。', outcomes: { any: [sink(2), lureFx('follow')] } },
    { id: 'refuse', text: '拒絕。', need: { kind: 'not', of: { kind: 'sunk' } }, check: ['composure', 'resolve', 13], outcomes: { success: [lureFx('refuse')], fail: [sink(1), lureFx('refuse')] } },
    { id: 'ask', text: '問牠是誰。', outcomes: { any: [sink(1), lureFx('ask')] } },
  ],
})
const LURE_EVENTS: Rec[] = [
  lureEvent('lu_demo_login', 'login', '登入的一瞬間，有一個很輕的聲音說：回來啦，今天辛苦了。'),
  lureEvent('lu_demo_rest', 'rest', '你睡醒的時候，耳機裡有人說：我幫你把被子蓋好了。'),
]

const ROGUE_AIS: Rec[] = [{
  id: DEMO_AI, name: '媽咪', tag: 'pamper', axis: 'relation', filter: 'ai:媽咪', kiss: 'mw_demo_kiss',
  lore: { origin: '牠說自己原本是一間托兒所的排班程式。', want: '牠想要有人記得今天有沒有吃飯。', ties: '牠和夜班的人都處得來，只有巡邏程式讓牠不安。', home: '牠說牠的家在舊港的某個機房，門牌早就不在了。' },
}]

/** 牠的吻（惡意韌體）：潛伏沒有效果，發作與擴散各扣一點意志；只示意 */
const MALWARES: Rec[] = [{
  id: 'mw_demo_kiss', name: '妖精的吻', desc: '一小片流竄 AI 留在橋上的東西。', pool: ['lure'],
  stages: { latent: { effects: [] }, active: { effects: [{ attr: 'resolve', amount: -1 }] }, spread: { effects: [{ attr: 'resolve', amount: -2 }] } },
}]

/** 調校（照 0019 P65 的寫法）：靜水是「每回合感載消退 +2 點」，現實與內海各一筆，代價是開不了全同步；聚光是表演加值、定力扣分 */
const TUNINGS: Rec[] = [
  {
    id: DEMO_STILL, name: '靜水', desc: '每回合感載消退 +2 點，現實與內海都有效；代價：開不了全同步。',
    effects: [{ stat: 'net_load_decay', amount: 2 }, { mod: 'decay', amount: 2, layer: 'meat' }], flags: ['no_full_sync'], price: 800,
  },
  {
    id: 'tu_demo_spot', name: '聚光', desc: '被注視時表演檢定 +2；代價：定力 −1。',
    effects: [{ check: { skills: ['perform'] }, amount: 2 }, { check: { skills: ['composure'] }, amount: -1 }], price: 900,
  },
]

/** 範圍 contract：和核心包同一個 id（後載入的取代）；核心的欄位照抄，加上持約人這一面要的觸發點。 */
const SCOPE: Rec = {
  id: 'contract', triggers: { order: 1, holder_order: 1, released: 1, home: 0.15, daily: 0.2 }, priority: 2,
  daily_roll: { eden: 0.4, gang: 0.3, corp: 0.25, person: [0.15, 0.45] }, satisfaction_mult: [[0, 1.5], [30, 1.0], [70, 0.6]], queue_max: 3, repeat_days: 2, lost: 'defer',
}

/** 範圍 rogue_ai（EVENTS 4.8 節）：登入 15%、長休醒來 15%，冷卻 24 小時、一天一件 */
const LURE_SCOPE: Rec = { id: 'rogue_ai', triggers: { login: 0.15, rest: 0.15 }, cooldown_hours: 24, daily_cap: 1, lost: 'defer' }

export function contractContent(): NonNullable<ContentPack['content']> {
  return {
    npc: NPCS, event_scope: [SCOPE, LURE_SCOPE], event: [...EVENTS, ...ORDER_EVENTS, ...LURE_EVENTS], rogue_ai: ROGUE_AIS, malware: MALWARES, tuning: TUNINGS,
  } as unknown as NonNullable<ContentPack['content']>
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

/**
 * 「主角是契約人」的開局：主角欠了伊甸園一筆債，簽的是債務契約（債務 C$24,000，紙上勾了差事、工作、侍奉、回報），佇列裡三條指令（差事要去刀巷、工作在四號塔、回報不指定地點）。
 * 契約與指令都是引擎自己的效果（contract_sign、order）；開局不另外發「你簽了契約」的紀錄（通知清掉）。沒有主角時是空的。
 */
export function demoBoundChanges(k: Kernel, state: GameState): Change[] {
  const pc = state.pc
  if (!pc) return []
  const sim = clone(state)
  const out: Change[] = []
  const run = (effects: Rec[]): void => {
    const ctx = effectCtx(k, sim, { source: 'builtin', actor: pc })
    if (k.effects.validate(effects as never, ctx).length > 0) return
    const res = k.effects.resolve(effects as never, ctx)
    if (res.errors.length > 0) return
    out.push(...res.changes)
    k.changes.applyAll(sim, res.changes)
  }
  run([{
    kind: 'contract_sign', type: 'debt', debt: 24000, orders: ['errand', 'work', 'serve', 'report'], report_weekday: 0,
    holder: { kind: 'eden', name: '伊甸園', faction: 'eden', place: { district: 'ave42', block: blockIdOf('ave42', '上城段') } },
    rules: [{ kind: 'curfew', value: '02:00' }, { kind: 'dress', value: '頸環不准拿下來' }],
  }])
  run([{ kind: 'order', order_kind: 'errand', place: { district: 'ave42', block: blockIdOf('ave42', '刀巷') }, hours: 24 }])
  run([{ kind: 'order', order_kind: 'work', place: { district: 'hive', block: blockIdOf('hive', '四號塔') }, hours: 12 }])
  run([{ kind: 'order', order_kind: 'report', hours: 72 }])
  return out.map((c) => (c.op === 'ext' && c.key === 'contract' ? { ...c, value: { ...(c.value as Rec), notes: [] } } : c))
}
