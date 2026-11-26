// L3 狀態核心：核心自己註冊的通用變更。功能要的其他種類自己註冊（kernel.changes.register）。
//
// | op | 欄位 | 做什麼 |
// |---|---|---|
// 數量一律是安全整數（isSafeInt）：套用之後的值也要是，否則不合法。這樣狀態裡不會出現大到失真的數字、Infinity 或 NaN，
// 任何一次提交之後的狀態都存得下去、讀得回來（dev/invariants.md 第 6、7 條）。
//
// | cred、cash | delta | 帳戶、現金晶片加減；不會變成負數（不夠就不合法） |
// | time | minutes | 時間往前推 |
// | flag | key, value（null 是拿掉） | 劇情旗標，只有這一種寫法 |
// | counter | key, delta | 計數器 |
// | item | id, qty（負的是拿走）, data? | 背包 |
// | location | to | 換地點 |
// | rng | advance | 亂數游標往前（每條任務鏈套用時一次） |
// | rules | patch | 改存檔規則；值照 sanitizeRules 驗（超出範圍的不合法），沒有寫到的欄位跟著調整（選了預設難度，DC 偏移跟著走） |
// | actor.add | actor | 新增一個角色；年齡低於 18 一律擋下（任何深度的 age 都看，和讀檔同一條底線） |
// | actor.remove | id | 拿掉一個角色 |
// | actor.track | id, track(hp/load/sink/afterglow), delta | 三條軌與餘韻的加減，最低 0（上限由產生變更的人先算好） |
// | actor.skill | id, skill, delta | 基本功等級加減，0～6 |
// | actor.perk | id, perk, remove? | 加上或拿掉一個特質 |
// | actor.condition | id, condition, until?, remove? | 加上或拿掉一個暫時的狀態 |
// | actor.ext | id, key, value | 角色身上某個功能自己的資料，整份換掉 |
// | pc | id | 指定主角 |
// | party | id, remove? | 進出隊伍 |
// | ext | key, value | 某個功能自己的狀態，整份換掉 |
// | chain | slot | 記下一條任務鏈的細節，並清掉五樓以前的（AI_TASKS 5.5 節） |
// | narration | report, text?, uncovered?, results? | 替一份已經提交的報告補上正文（寫正文在結果之後才有） |
// | uid | advance | 流水號往前（戰鬥、地圖實例這類要一個不重複的 id 的東西） |
// | battle | state（null 是結束）, step?, fold? | 整份換掉進行中的戰鬥；step 把這份報告記成這場戰鬥的一步；fold 在結束時把每一步的報告收掉（dev/adr/0011） |
// | map.open | instance | 開一份地圖的實例。實例可以自己帶定義（gen：生成的地圖，整份存在實例裡）：定義要過內容種類 special_map 的檢查、id 等於 def、seed 是安全整數、by 是字串，不合格整筆不收；記進紀錄時 gen 只留 seed 與 by，不留整份定義（它在 state.maps） |
// | map.close | id | 清掉一份實例（人還站在裡面就不行） |
// | map.at | to（null 是離開格子地圖） | 換位置 |
// | map.sheet | map, sheet, seen?, cells?, movers? | 改一張圖的狀態：看過的格子、改過的格子、會動的東西 |
// | map.ext | map, value | 這份實例上發起的功能自己記的東西，整份換掉 |
// | meter | kind, key, delta 或 set | 量表（state.meters；dev/adr/0016 第三節）：加減或直接設，套用時夾在那張量表的 min～max（有 floor 時不低於那張量表同一個鍵的值）。種類沒有人定義、key 不是非空字串、勢力／人／區的鍵在內容裡查不到、不分對象的 key 不是 _ 都不合法；delta 與 set 要有一個而且只有一個，是整數 |
// | snapshot.add | slot | 存一份快照（回到那一刻用的）。同一種類只留最新的一份由存的人決定：先 drop 再 add |
// | snapshot.take | kind, label, owner?, data?, replace? | 存一份「這份報告套用之前」的快照（dev/adr/0016 第二節）：一定是報告的第一筆變更；文字由 k.serialize 產生（沒注入就不合法）；replace 把同一個 owner、同一種的舊快照拿掉。記進紀錄時不留文字 |
// | snapshot.drop | id 或 kind | 丟掉一份（或一種）快照 |
// | snapshot.mark | id 或 kind、data | 在一份（或一種）快照的 data 上補幾個鍵（打輸之後標上「這一場輸了，等玩家三選一」）；找不到就不合法 |

import type { Actor, BattleState, CellPatch, ChainRecordSlot, Change, FlagValue, GameState, GridPos, MapInstance, MoverState, ReportLocation, SaveRules, SnapshotSlot } from '../types'
import { ATTR_IDS, BATTLE_SIDES, BATTLE_SLOTS } from '../types'
import type { ContentRegistry } from '../content/registry'
import { MIN_AGE } from '../util/age'
import { clone, deepEqual } from '../util/clone'
import { formatAmount } from '../util/money'
import { isId, isRecord, isSafeInt } from '../util/sanitize'
import { addMinutes, isValidTime, toMinutes } from '../util/time'
import type { ChangeDef, ChangeRegistry } from './changes'
import { addItem, countItem, findByUid, removeItem, removeItemByUid } from './inventory'
import type { MeterRegistry } from './meters'
import { meterKeyLabel, meterKeyProblems, nextMeterValue } from './meters'
import { sanitizeRules } from './saveRules'

/**
 * 地圖實例自己帶的定義（MapInstance.gen）的形狀：是物件、map 是物件而且它的 id 等於實例的 def、seed 是安全整數、by 是非空的字串。
 * 定義本身合不合格（版面、標記……）是 L5 的 specialMapProblems：提交時問內容登錄表的 special_map 種類，存檔驗證用 core/grid 的 genMapProblems。
 */
export function genShapeProblems(gen: unknown, def: string): string[] {
  if (!isRecord(gen)) return ['gen 要是一個物件（map、seed、by）']
  const p: string[] = []
  if (!isRecord(gen.map)) p.push('gen.map 要是地圖的定義（一個物件）')
  else if (gen.map.id !== def) p.push(`gen.map.id（${String(gen.map.id)}）要等於實例的 def（${def}）`)
  if (!isSafeInt(gen.seed)) p.push('gen.seed 要是安全整數')
  if (typeof gen.by !== 'string' || !gen.by.trim()) p.push('gen.by 要是非空的字串（誰生成的）')
  return p
}

/** 只保留最近幾樓的任務鏈細節（AI_TASKS 5.5 節）。 */
export const CHAIN_FLOORS_KEPT = 5
/** 所有角色 18 歲以上（AI_TASKS 3.19 節；PROMPTS H5）。定義與掃描在 L1（內容載入也要用同一條：B038）。 */
export { MIN_AGE, underageAt } from '../util/age'
export const SKILL_MAX = 6
export const TRACKS = ['hp', 'load', 'sink', 'afterglow'] as const
export type TrackId = (typeof TRACKS)[number]

/** 這個檔裡的「整數」一律是安全整數。 */
const isInt = isSafeInt
const TOO_BIG = '數字太大，超出能記的範圍'
const actorOf = (s: GameState, id: unknown): Actor | undefined => (typeof id === 'string' ? s.actors[id] : undefined)
const needActor = (s: GameState, id: unknown): string[] => (actorOf(s, id) ? [] : [`沒有 ${String(id)} 這個角色`])

/** 一個角色的骨架合不合格式。回傳錯誤訊息。 */
export function validateActor(a: unknown): string[] {
  if (!isRecord(a)) return ['角色要是一個物件']
  const p: string[] = []
  if (!isId(a.id)) p.push('id 的格式不對')
  if (typeof a.name !== 'string' || !a.name.trim()) p.push('要有名字')
  if (!['pc', 'companion', 'npc'].includes(a.role as string)) p.push('role 只能是 pc、companion、npc')
  if (!isInt(a.age)) p.push('年齡要是整數')
  else if (a.age < MIN_AGE) p.push(`所有角色都是成年人：年齡要 ${MIN_AGE} 以上（拿到 ${a.age}）`)
  if (!isRecord(a.attrs) || ATTR_IDS.some((k) => !isInt((a.attrs as Record<string, unknown>)[k]))) p.push('六項屬性都要是整數')
  if (!isRecord(a.skills) || Object.values(a.skills).some((v) => !isInt(v) || v < 0 || v > SKILL_MAX)) p.push(`基本功等級要是 0～${SKILL_MAX} 的整數`)
  if (!Array.isArray(a.perks) || a.perks.some((x) => typeof x !== 'string')) p.push('perks 要是 id 的陣列')
  for (const t of TRACKS) if (!isInt(a[t]) || (a[t] as number) < 0) p.push(`${t} 要是 0 以上的整數`)
  if (!Array.isArray(a.conditions)) p.push('conditions 要是陣列')
  if (!isRecord(a.ext)) p.push('ext 要是物件')
  return p
}

const money = (op: 'cred' | 'cash', name: string): ChangeDef<Change & { delta: number }> => ({
  op, owner: 'core',
  validate: (s, c) => (!isInt(c.delta) ? ['delta 要是整數'] : s.money[op] + c.delta < 0 ? [`${name}不夠：有 ${s.money[op]}，要扣 ${-c.delta}`] : !isInt(s.money[op] + c.delta) ? [`${name}：${TOO_BIG}`] : []),
  apply: (s, c) => { s.money[op] += c.delta },
  describe: (c) => (c.delta ? `${name} ${c.delta > 0 ? '+' : '−'}${formatAmount(Math.abs(c.delta))}` : null),
})

/** meter 變更要問的：量表的登錄表（種類有沒有人定義、範圍）與內容（勢力、人、區的鍵查不查得到）。 */
export interface MeterEnv {
  meters: MeterRegistry
  content: ContentRegistry
}

/**
 * serialize：問 kernel 現在有沒有注入序列化函式（snapshot.take 用；它是之後才注入的，所以每次問，不在登錄時抓）。
 * 不給的話（單獨測某一種變更）就當沒注入。
 * meterEnv：meter 變更用的量表登錄表與內容；不給的話（單獨測某一種變更）meter 變更一律當作沒有人定義。
 */
export function registerCoreChanges(reg: ChangeRegistry, serialize: () => ((state: GameState) => string) | undefined = () => undefined, meterEnv?: MeterEnv): void {
  reg.register(money('cred', '帳戶'))
  reg.register(money('cash', '現金'))

  reg.register<Change & { minutes: number }>({
    op: 'time', owner: 'core',
    validate: (s, c) => (!(isInt(c.minutes) && c.minutes >= 0) ? ['minutes 要是 0 以上的整數（時間只往前走）'] : !isInt(toMinutes(s.time) + c.minutes) ? [`時間：${TOO_BIG}`] : []),
    apply: (s, c) => { s.time = addMinutes(s.time, c.minutes) },
  })

  reg.register<Change & { key: string; value: FlagValue | null }>({
    op: 'flag', owner: 'core',
    validate: (_s, c) => [
      ...(typeof c.key === 'string' && c.key ? [] : ['key 要是字串']),
      ...(c.value === null || ['boolean', 'number', 'string'].includes(typeof c.value) ? [] : ['value 只能是布林、數字、字串或 null']),
      ...(typeof c.value === 'number' && !Number.isFinite(c.value) ? ['value 是數字時要是有限的數字'] : []),
    ],
    apply: (s, c) => {
      if (c.value === null) delete s.flags[c.key]
      else s.flags[c.key] = c.value
    },
  })

  reg.register<Change & { key: string; delta: number }>({
    op: 'counter', owner: 'core',
    validate: (s, c) => (!(typeof c.key === 'string' && c.key && isInt(c.delta)) ? ['要有 key 與整數的 delta'] : !isInt((s.counters[c.key] ?? 0) + c.delta) ? [`計數器 ${c.key}：${TOO_BIG}`] : []),
    apply: (s, c) => { s.counters[c.key] = (s.counters[c.key] ?? 0) + c.delta },
  })

  // 拿走（qty < 0）時寫 data: { uid } 就是拿走那一件指名的（背包裡 id 與 data.uid 都對得上的那一疊；找不到、不夠都不合法）；
  // 沒寫就照舊：先拿沒有實例資料的那幾疊（沒收、賣的時候，同一種物品有帶資料的也有不帶的，不會拿錯）。得到（qty > 0）時 data 就是新那一疊的實例資料。
  const uidOf = (c: { qty: number; data?: Record<string, unknown> }): unknown => (c.qty < 0 && isRecord(c.data) ? c.data.uid : undefined)
  reg.register<Change & { id: string; qty: number; data?: Record<string, unknown> }>({
    op: 'item', owner: 'core',
    validate: (s, c) => {
      if (!isId(c.id)) return ['物品的 id 格式不對']
      if (!isInt(c.qty) || c.qty === 0) return ['qty 要是不為 0 的整數']
      if (c.qty < 0 && uidOf(c) !== undefined) {
        const stack = findByUid(s.inventory, c.id, uidOf(c))
        if (!stack) return [`背包裡沒有 ${c.id}（uid ${String(uidOf(c))}）這一件`]
        return stack.qty < -c.qty ? [`背包裡的 ${c.id}（uid ${String(uidOf(c))}）不夠 ${-c.qty} 個`] : []
      }
      if (c.qty < 0 && countItem(s.inventory, c.id) < -c.qty) return [`背包裡的 ${c.id} 不夠 ${-c.qty} 個`]
      if (!isInt(countItem(s.inventory, c.id) + c.qty)) return [`${c.id}：${TOO_BIG}`]
      return []
    },
    apply: (s, c) => {
      if (c.qty > 0) addItem(s.inventory, c.id, c.qty, c.data ? clone(c.data) : undefined)
      else if (uidOf(c) !== undefined) removeItemByUid(s.inventory, c.id, uidOf(c), -c.qty)
      else removeItem(s.inventory, c.id, -c.qty)
    },
    describe: (c) => `${c.qty > 0 ? '得到' : '失去'} ${c.id} ×${Math.abs(c.qty)}`,
  })

  reg.register<Change & { to: ReportLocation }>({
    op: 'location', owner: 'core',
    validate: (_s, c) => (isRecord(c.to) ? [] : ['to 要是地點']),
    apply: (s, c) => { s.location = clone(c.to) },
  })

  reg.register<Change & { advance: number }>({
    op: 'rng', owner: 'core',
    validate: (s, c) => (isInt(c.advance) && c.advance > 0 && isInt(s.rng.cursor + c.advance) ? [] : ['advance 要是正整數']),
    apply: (s, c) => { s.rng.cursor += c.advance },
  })

  reg.register<Change & { patch: Partial<SaveRules> }>({
    op: 'rules', owner: 'core',
    // 你要改的那幾個值，存進去的就要是那幾個值（清過之後不一樣＝超出範圍，不合法）；沒寫到的欄位可以跟著調整
    validate: (s, c) => {
      if (!isRecord(c.patch) || !Object.keys(c.patch).every((k) => k in s.rules)) return ['patch 只能改存檔規則裡有的欄位']
      const next = sanitizeRules({ ...s.rules, ...c.patch }) as unknown as Record<string, unknown>
      const bad = Object.keys(c.patch).filter((k) => !deepEqual(next[k], (c.patch as Record<string, unknown>)[k]))
      return bad.length ? [`存檔規則的值超出範圍或格式不對：${bad.join('、')}`] : []
    },
    apply: (s, c) => { s.rules = sanitizeRules({ ...s.rules, ...clone(c.patch) }) },
  })

  reg.register<Change & { actor: Actor }>({
    op: 'actor.add', owner: 'core',
    validate: (s, c) => {
      const p = validateActor(c.actor)
      if (!p.length && s.actors[c.actor.id]) p.push(`角色的 id 重複：${c.actor.id}`)
      return p
    },
    apply: (s, c) => { s.actors[c.actor.id] = clone(c.actor) },
  })

  reg.register<Change & { id: string }>({
    op: 'actor.remove', owner: 'core',
    validate: (s, c) => [...needActor(s, c.id), ...(s.pc === c.id ? ['不能拿掉主角'] : [])],
    apply: (s, c) => {
      delete s.actors[c.id]
      s.party = s.party.filter((x) => x !== c.id)
    },
  })

  reg.register<Change & { id: string; track: TrackId; delta: number }>({
    op: 'actor.track', owner: 'core',
    validate: (s, c) => {
      const p = [...needActor(s, c.id), ...(TRACKS.includes(c.track) ? [] : ['track 只能是 hp、load、sink、afterglow']), ...(isInt(c.delta) ? [] : ['delta 要是整數'])]
      if (!p.length && !isInt(s.actors[c.id]![c.track] + c.delta)) p.push(`${c.track}：${TOO_BIG}`)
      return p
    },
    apply: (s, c) => {
      const a = s.actors[c.id]!
      a[c.track] = Math.max(0, a[c.track] + c.delta)
    },
  })

  reg.register<Change & { id: string; skill: string; delta: number }>({
    op: 'actor.skill', owner: 'core',
    validate: (s, c) => {
      const a = actorOf(s, c.id)
      if (!a) return needActor(s, c.id)
      if (!isId(c.skill) || !isInt(c.delta)) return ['要有 skill 與整數的 delta']
      const v = (a.skills[c.skill] ?? 0) + c.delta
      return v < 0 || v > SKILL_MAX ? [`基本功等級要在 0～${SKILL_MAX}（會變成 ${v}）`] : []
    },
    apply: (s, c) => {
      const a = s.actors[c.id]!
      a.skills[c.skill] = (a.skills[c.skill] ?? 0) + c.delta
    },
  })

  reg.register<Change & { id: string; perk: string; remove?: boolean }>({
    op: 'actor.perk', owner: 'core',
    validate: (s, c) => {
      const a = actorOf(s, c.id)
      if (!a) return needActor(s, c.id)
      if (!isId(c.perk)) return ['perk 的 id 格式不對']
      if (c.remove) return a.perks.includes(c.perk) ? [] : [`${c.id} 沒有 ${c.perk} 這個特質`]
      return a.perks.includes(c.perk) ? [`${c.id} 已經有 ${c.perk} 了`] : []
    },
    apply: (s, c) => {
      const a = s.actors[c.id]!
      if (c.remove) a.perks = a.perks.filter((x) => x !== c.perk)
      else a.perks.push(c.perk)
    },
  })

  reg.register<Change & { id: string; condition: string; until?: number; remove?: boolean }>({
    op: 'actor.condition', owner: 'core',
    validate: (s, c) => [...needActor(s, c.id), ...(isId(c.condition) ? [] : ['condition 的 id 格式不對']), ...(c.until === undefined || isInt(c.until) ? [] : ['until 要是整數（總分鐘數）'])],
    apply: (s, c) => {
      const a = s.actors[c.id]!
      a.conditions = a.conditions.filter((x) => x.id !== c.condition)
      if (!c.remove) a.conditions.push(c.until === undefined ? { id: c.condition } : { id: c.condition, until: c.until })
    },
  })

  reg.register<Change & { id: string; key: string; value: unknown }>({
    op: 'actor.ext', owner: 'core',
    validate: (s, c) => [...needActor(s, c.id), ...(typeof c.key === 'string' && c.key ? [] : ['key 要是字串'])],
    apply: (s, c) => {
      const a = s.actors[c.id]!
      if (c.value === null || c.value === undefined) delete a.ext[c.key]
      else a.ext[c.key] = clone(c.value)
    },
  })

  reg.register<Change & { id: string }>({
    op: 'pc', owner: 'core',
    validate: (s, c) => {
      const a = actorOf(s, c.id)
      return !a ? needActor(s, c.id) : a.role === 'pc' ? [] : ['主角的 role 要是 pc']
    },
    apply: (s, c) => {
      s.pc = c.id
      if (!s.party.includes(c.id)) s.party.unshift(c.id)
    },
  })

  reg.register<Change & { id: string; remove?: boolean }>({
    op: 'party', owner: 'core',
    validate: (s, c) => [...needActor(s, c.id), ...(c.remove && s.pc === c.id ? ['主角不能離隊'] : [])],
    apply: (s, c) => {
      s.party = s.party.filter((x) => x !== c.id)
      if (!c.remove) s.party.push(c.id)
    },
  })

  reg.register<Change & { key: string; value: unknown }>({
    op: 'ext', owner: 'core',
    validate: (_s, c) => (typeof c.key === 'string' && c.key ? [] : ['key 要是字串']),
    apply: (s, c) => {
      if (c.value === null || c.value === undefined) delete s.ext[c.key]
      else s.ext[c.key] = clone(c.value)
    },
  })

  reg.register<Change & { slot: ChainRecordSlot }>({
    op: 'chain', owner: 'core',
    validate: (_s, c) => (isRecord(c.slot) && typeof c.slot.id === 'string' && isInt(c.slot.floor) ? [] : ['slot 要有 id 與 floor']),
    forLog: (c) => ({ op: 'chain', slot: { id: c.slot.id, floor: c.slot.floor } }),
    apply: (s, c) => {
      if (!s.chains.some((x) => x.id === c.slot.id)) s.seq.chain += 1
      s.chains = s.chains.filter((x) => x.id !== c.slot.id)
      s.chains.push(clone(c.slot))
      s.seq.floor = Math.max(s.seq.floor, c.slot.floor)
      const keepFrom = s.seq.floor - CHAIN_FLOORS_KEPT + 1
      for (const slot of s.chains) {
        if (slot.floor < keepFrom && !slot.cleaned) {
          slot.cleaned = true
          delete slot.detail
        }
      }
    },
  })

  reg.register<Change & { report: string; text?: string; results?: string[]; uncovered?: number[] }>({
    op: 'narration', owner: 'core',
    validate: (s, c) => (s.reports.some((r) => r.id === c.report) ? [] : [`沒有 ${String(c.report)} 這份報告`]),
    apply: (s, c) => {
      const r = s.reports.find((x) => x.id === c.report)!
      r.narration = { ...r.narration, ...(c.text !== undefined ? { text: c.text } : {}), ...(c.results ? { results: [...c.results] } : {}), ...(c.uncovered ? { uncovered: [...c.uncovered] } : {}) }
    },
  })

  reg.register<Change & { advance: number }>({
    op: 'uid', owner: 'core',
    validate: (s, c) => (isInt(c.advance) && c.advance > 0 && isInt(s.seq.uid + c.advance) ? [] : ['advance 要是正整數']),
    apply: (s, c) => { s.seq.uid += c.advance },
  })

  // 進行中的戰鬥（dev/adr/0010、0011）。戰鬥狀態怎麼算是 L5 的事；這裡只管「整份換掉」與骨架的檢查。
  reg.register<Change & { state: BattleState | null; step?: boolean; fold?: boolean }>({
    op: 'battle', owner: 'core',
    validate: (s, c) => {
      if (c.state === null) return s.battle ? [] : ['現在沒有在戰鬥，沒有東西可以結束']
      const p = battleProblems(c.state)
      if (!p.length && s.battle && s.battle.id !== c.state.id) p.push(`已經有一場戰鬥在進行（${s.battle.id}），不能換成另一場`)
      if (c.fold) p.push('fold 只能和 state: null 一起用（戰鬥結束時）')
      return p
    },
    // 記進紀錄時不留整份戰鬥狀態（它在 state.battle；每一步的經過在報告的 timeline）
    forLog: (c) => ({ op: 'battle', ...(c.state ? { id: c.state.id, round: c.state.round } : { state: null }), ...(c.step ? { step: true } : {}), ...(c.fold ? { fold: true } : {}) }),
    apply: (s, c) => {
      if (c.state === null) {
        // 結束：這場戰鬥每一步的報告收掉（它們的經過已經接進結束那一份報告的 timeline）
        if (c.fold && s.battle) {
          const ids = new Set(s.battle.steps)
          s.reports = s.reports.filter((r) => !ids.has(r.id))
        }
        s.battle = null
        return
      }
      s.battle = clone(c.state)
      // 這份報告是這場戰鬥的一步：記下它的 id（正在套用的這一份是 r<流水號 + 1>）
      if (c.step) s.battle.steps.push(`r${s.seq.report + 1}`)
    },
  })

  const instanceOf = (s: GameState, id: unknown): MapInstance | undefined => (typeof id === 'string' ? s.maps.instances[id] : undefined)

  reg.register<Change & { instance: MapInstance }>({
    op: 'map.open', owner: 'core',
    validate: (s, c) => {
      const m = c.instance
      if (!isRecord(m) || !isId(m.id) || !isId(m.def) || !isRecord(m.sheets)) return ['instance 要有 id、def、sheets']
      const p: string[] = []
      if (s.maps.instances[m.id]) p.push(`地圖實例的 id 重複：${m.id}`)
      if (m.gen !== undefined) {
        // 生成的地圖：定義整份在實例裡，不合格整筆不收（訊息寫出問題）。版面的檢查是 L5 的（special_map 種類的 validate），問內容登錄表
        const shape = genShapeProblems(m.gen, m.def)
        p.push(...shape)
        if (!shape.length) {
          const content = meterEnv?.content
          if (!content?.hasKind('special_map')) p.push('沒有地圖定義的檢查（special_map 這個內容種類），收不了生成的地圖')
          else p.push(...content.validate('special_map', [(m.gen as { map: unknown }).map]).map((x) => `生成的地圖不合格：${x}`))
        }
      }
      return p
    },
    // 記進紀錄時 gen 不留整份定義（它在 state.maps），只留種子與是誰生成的
    forLog: (c) => (c.instance.gen ? { op: 'map.open', instance: { ...c.instance, gen: { seed: c.instance.gen.seed, by: c.instance.gen.by } } } : c),
    apply: (s, c) => {
      s.maps.instances[c.instance.id] = clone(c.instance)
      s.maps.seq += 1
    },
  })

  reg.register<Change & { id: string }>({
    op: 'map.close', owner: 'core',
    validate: (s, c) => (!instanceOf(s, c.id) ? [`沒有 ${String(c.id)} 這份地圖`] : s.maps.at?.map === c.id ? ['人還站在這張地圖裡，不能清掉'] : []),
    apply: (s, c) => { delete s.maps.instances[c.id] },
  })

  reg.register<Change & { to: GridPos | null }>({
    op: 'map.at', owner: 'core',
    validate: (s, c) => {
      if (c.to === null) return []
      const t = c.to
      if (!isRecord(t) || typeof t.sheet !== 'string' || !isInt(t.x) || !isInt(t.y) || t.x < 0 || t.y < 0) return ['to 要有 map、sheet 與不是負數的 x、y']
      return instanceOf(s, t.map) ? [] : [`沒有 ${String(t.map)} 這份地圖`]
    },
    apply: (s, c) => { s.maps.at = c.to ? { map: c.to.map, sheet: c.to.sheet, x: c.to.x, y: c.to.y } : null },
  })

  reg.register<Change & { map: string; sheet: string; seen?: string[]; cells?: Record<string, CellPatch | null>; movers?: Record<string, MoverState | null> }>({
    op: 'map.sheet', owner: 'core',
    validate: (s, c) => {
      if (!instanceOf(s, c.map)) return [`沒有 ${String(c.map)} 這份地圖`]
      const p: string[] = []
      if (typeof c.sheet !== 'string' || !c.sheet) p.push('要有 sheet（圖的 id）')
      if (c.seen !== undefined && !(Array.isArray(c.seen) && c.seen.every((row) => typeof row === 'string' && /^[01]*$/.test(row)))) p.push('seen 要是只有 0 與 1 的字串陣列')
      for (const key of ['cells', 'movers'] as const) if (c[key] !== undefined && !isRecord(c[key])) p.push(`${key} 要是一個物件`)
      return p
    },
    apply: (s, c) => {
      const m = s.maps.instances[c.map]!
      const sheet = (m.sheets[c.sheet] ??= { seen: [], cells: {}, movers: {} })
      if (c.seen) sheet.seen = [...c.seen]
      for (const [key, v] of Object.entries(c.cells ?? {})) {
        if (v === null) delete sheet.cells[key]
        else sheet.cells[key] = { ...sheet.cells[key], ...clone(v) }
      }
      for (const [key, v] of Object.entries(c.movers ?? {})) {
        if (v === null) delete sheet.movers[key]
        else sheet.movers[key] = clone(v)
      }
    },
  })

  reg.register<Change & { slot: SnapshotSlot }>({
    op: 'snapshot.add', owner: 'core',
    validate: (s, c) => {
      const x = c.slot
      if (!isRecord(x) || !isId(x.id) || !isId(x.kind) || typeof x.label !== 'string' || typeof x.raw !== 'string' || !x.raw) return ['slot 要有 id、kind、label 與 raw（存檔的文字）']
      return s.snapshots.some((y) => y.id === x.id) ? [`快照的 id 重複：${x.id}`] : []
    },
    // 記進紀錄時不留存檔的文字（它在 state.snapshots）
    forLog: (c) => ({ op: 'snapshot.add', slot: { id: c.slot.id, kind: c.slot.kind, label: c.slot.label } }),
    apply: (s, c) => { s.snapshots.push(clone(c.slot)) },
  })

  reg.register<Change & { kind: string; label: string; owner?: string; data?: Record<string, unknown>; replace?: boolean }>({
    op: 'snapshot.take', owner: 'core',
    validate: (_s, c, at) => {
      const p: string[] = []
      // 存的是「這份報告套用之前」的狀態：放在別的變更後面，存到的就是套了一半的狀態
      if (at && at.index !== 0) p.push('snapshot.take 要放在報告的第一筆變更（它存的是這份報告套用之前的狀態）')
      if (!serialize()) p.push('沒有注入存快照的序列化函式（k.serialize）：Game 建好時會注入；只有核心、沒有外殼的測試用 testkit 的 makeKernel')
      if (!isId(c.kind)) p.push('kind 的格式不對')
      if (typeof c.label !== 'string') p.push('label 要是字串（給玩家看的名字）')
      if (c.owner !== undefined && !(typeof c.owner === 'string' && c.owner)) p.push('owner 要是非空的字串')
      if (c.data !== undefined && !isRecord(c.data)) p.push('data 要是一個物件')
      if (c.replace !== undefined && typeof c.replace !== 'boolean') p.push('replace 要是布林值')
      return p
    },
    // 記進紀錄時不留存檔的文字與 data（它們在 state.snapshots）；也沒有 id（id 由套用時定）
    forLog: (c) => ({ op: 'snapshot.take', kind: c.kind, label: c.label, ...(c.owner !== undefined ? { owner: c.owner } : {}), ...(c.replace ? { replace: true } : {}) }),
    describe: () => null,
    apply: (s, c) => {
      // 傳進去的是 snapshots 放空的淺拷貝：快照裡不再包快照（不變式第 57 條），序列化的函式不必知道這件事
      const raw = serialize()!({ ...s, snapshots: [] })
      if (typeof raw !== 'string' || !raw) throw new Error('k.serialize 要回傳存檔的文字（非空的字串）')
      // id 照流水號（和戰鬥開打前的快照同一套 s<流水號>），並把流水號用掉：之後的 s<流水號 + 1> 不會撞上；已經有人用的號碼跳過
      let n = s.seq.uid + 1
      while (s.snapshots.some((x) => x.id === `s${n}`)) n++
      s.seq.uid = n
      if (c.replace) s.snapshots = s.snapshots.filter((x) => !(x.kind === c.kind && x.owner === c.owner))
      s.snapshots.push({ id: `s${n}`, kind: c.kind, label: c.label, raw, ...(c.owner !== undefined ? { owner: c.owner } : {}), ...(c.data ? { data: clone(c.data) } : {}) })
    },
  })

  reg.register<Change & { id?: string; kind?: string }>({
    op: 'snapshot.drop', owner: 'core',
    validate: (_s, c) => (typeof c.id === 'string' || typeof c.kind === 'string' ? [] : ['要寫 id 或 kind']),
    apply: (s, c) => { s.snapshots = s.snapshots.filter((x) => !(c.id !== undefined ? x.id === c.id : x.kind === c.kind)) },
  })

  reg.register<Change & { id?: string; kind?: string; data: Record<string, unknown> }>({
    op: 'snapshot.mark', owner: 'core',
    validate: (s, c) => {
      if (typeof c.id !== 'string' && typeof c.kind !== 'string') return ['要寫 id 或 kind']
      if (!isRecord(c.data)) return ['data 要是一個物件']
      return s.snapshots.some((x) => (c.id !== undefined ? x.id === c.id : x.kind === c.kind)) ? [] : ['沒有這份快照']
    },
    apply: (s, c) => {
      for (const x of s.snapshots) if (c.id !== undefined ? x.id === c.id : x.kind === c.kind) x.data = { ...(x.data ?? {}), ...clone(c.data) }
    },
  })

  reg.register<Change & { map: string; value: Record<string, unknown> | null }>({
    op: 'map.ext', owner: 'core',
    validate: (s, c) => (!instanceOf(s, c.map) ? [`沒有 ${String(c.map)} 這份地圖`] : c.value === null || isRecord(c.value) ? [] : ['value 要是一個物件或 null']),
    apply: (s, c) => {
      const m = s.maps.instances[c.map]!
      if (c.value === null) delete m.ext
      else m.ext = clone(c.value)
    },
  })

  // 量表：種類由功能定義（k.meters.define）；沒有人定義的種類擋下並寫出是哪一種。範圍與下限在套用時夾，所以同一份狀態、同一筆變更一定得到同一個結果
  reg.register<Change & { kind: string; key: string; delta?: number; set?: number }>({
    op: 'meter', owner: 'core',
    validate: (s, c) => {
      const def = typeof c.kind === 'string' ? meterEnv?.meters.get(c.kind) : undefined
      if (!def) return [`沒有人定義過「${String(c.kind)}」這種量表（那個功能這一局沒裝）`]
      const p = meterKeyProblems(def, c.key, s, meterEnv!.content)
      const hasDelta = c.delta !== undefined, hasSet = c.set !== undefined
      if (hasDelta === hasSet) p.push('要寫 delta 或 set，而且只能寫一個')
      else if (!isInt(hasDelta ? c.delta : c.set)) p.push(`${hasDelta ? 'delta' : 'set'} 要是整數（不能是小數、無限、非數，也不能大到失真）`)
      return p
    },
    apply: (s, c) => {
      const def = meterEnv!.meters.get(c.kind)!
      const next = nextMeterValue(meterEnv!.meters, s, def, c.key, c)
      // 沒寫過的種類在這裡才開一列；用 Object.hasOwn 看，不吃原型鏈上的東西
      if (!Object.hasOwn(s.meters, c.kind)) s.meters[c.kind] = {}
      s.meters[c.kind]![c.key] = next
    },
    describe: (c, s) => {
      const def = meterEnv?.meters.get(c.kind)
      if (!def) return null
      const label = meterKeyLabel(def, c.key, s, meterEnv!.content)
      const name = label ? `${def.name}（${label}）` : def.name
      if (c.set !== undefined) return `${name} 設為 ${c.set}`
      return c.delta ? `${name} ${c.delta > 0 ? '+' : '−'}${Math.abs(c.delta)}` : null
    },
  })
}

/** 戰鬥狀態的骨架合不合格式（存進去的每一個數字都要是有限的數字；提交時另外擋 NaN 與 Infinity）。回傳錯誤訊息。 */
export function battleProblems(b: unknown): string[] {
  if (!isRecord(b)) return ['戰鬥狀態要是一個物件']
  const p: string[] = []
  if (typeof b.id !== 'string' || !b.id) p.push('要有 id')
  if (typeof b.mode !== 'string' || !b.mode) p.push('要有 mode（戰場）')
  if (!isInt(b.round) || (b.round as number) < 1) p.push('round 要是 1 以上的整數')
  if (!Array.isArray(b.order) || !isRecord(b.units)) return [...p, '要有 order 與 units']
  const units = b.units as Record<string, unknown>
  if (b.order.some((id) => typeof id !== 'string' || !units[id])) p.push('order 裡有不存在的單位')
  if (!isInt(b.turn) || (b.turn as number) < 0 || (b.order.length > 0 && (b.turn as number) >= b.order.length)) p.push('turn 要指到 order 裡的一個人')
  if (!isRecord(b.cover) || BATTLE_SIDES.some((side) => !Array.isArray((b.cover as Record<string, unknown>)[side]) || ((b.cover as Record<string, unknown[]>)[side]!).length !== BATTLE_SLOTS)) p.push(`cover 要有雙方各 ${BATTLE_SLOTS} 格`)
  if (!Array.isArray(b.steps) || !Array.isArray(b.overlays) || !Array.isArray(b.nodes) || !isRecord(b.reserve) || !isRecord(b.origin)) p.push('要有 steps、overlays、nodes、reserve、origin')
  const seen = new Map<string, string>()
  for (const [id, raw] of Object.entries(units)) {
    if (!isRecord(raw) || raw.id !== id) { p.push(`units.${id}：id 和鍵不一樣`); continue }
    if (!BATTLE_SIDES.includes(raw.side as never)) p.push(`units.${id}：side 只能是 ${BATTLE_SIDES.join('、')}`)
    if (!isInt(raw.slot) || (raw.slot as number) < 0 || (raw.slot as number) > BATTLE_SLOTS) p.push(`units.${id}：slot 要是 0～${BATTLE_SLOTS}`)
    const ap = raw.ap as Record<string, unknown> | undefined
    if (!isRecord(ap) || !isInt(ap.now) || (ap.now as number) < 0) p.push(`units.${id}：行動點要是 0 以上的整數`)
    for (const track of ['hp', 'load'] as const) {
      const m = raw[track]
      if (m !== undefined && !(isRecord(m) && isInt(m.now) && isInt(m.max) && (m.now as number) >= 0)) p.push(`units.${id}：${track} 要是 0 以上的整數`)
    }
    if (!isInt(raw.layers) || (raw.layers as number) < 0) p.push(`units.${id}：餘韻的層數要是 0 以上的整數`)
    if (!Array.isArray(raw.weapons) || !Array.isArray(raw.statuses) || !isRecord(raw.uses)) p.push(`units.${id}：要有 weapons、statuses、uses`)
    // 義體的清單：每一件要有種類與名字（失效與超頻照種類找狀態）；contract 要是布林值
    if (raw.implants !== undefined) {
      if (!Array.isArray(raw.implants)) p.push(`units.${id}：implants 要是義體的陣列`)
      else raw.implants.forEach((x, i) => {
        if (!isRecord(x) || typeof x.kind !== 'string' || !x.kind || typeof x.name !== 'string' || !x.name || (x.contract !== undefined && typeof x.contract !== 'boolean')) p.push(`units.${id}：implants[${i}] 要有 kind、name（字串），contract 要是布林值`)
      })
    }
    // 一格一個單位：還在場上的人不能站在同一格
    if (!raw.out && (raw.slot as number) >= 1) {
      const key = `${String(raw.side)}:${String(raw.slot)}`
      if (seen.has(key)) p.push(`units.${id}：和 ${seen.get(key)} 站在同一格（一格一個單位）`)
      seen.set(key, id)
    }
  }
  // 和人重疊的東西（無人機、砲塔）：每一方每一格最多一台沒被擊落的（COMBAT_SYSTEM 第 2 節、9.1 節）
  if (Array.isArray(b.overlays)) {
    const hung = new Map<string, string>()
    for (const raw of b.overlays as unknown[]) {
      if (!isRecord(raw) || typeof raw.id !== 'string' || !raw.id) { p.push('overlays：每一台要有 id'); continue }
      if (!BATTLE_SIDES.includes(raw.side as never) || !isInt(raw.slot) || (raw.slot as number) < 1 || (raw.slot as number) > BATTLE_SLOTS) { p.push(`overlays.${raw.id}：要掛在某一方的第 1～${BATTLE_SLOTS} 格`); continue }
      // 操作者可以沒有（裝在場景上的、巡邏用的、自律之後的）；有的話要查得到
      if (raw.owner !== undefined && !(typeof raw.owner === 'string' && Object.prototype.hasOwnProperty.call(units, raw.owner))) p.push(`overlays.${raw.id}：操作者 ${String(raw.owner)} 不在這場戰鬥裡`)
      for (const f of ['auto', 'autonomous'] as const) if (raw[f] !== undefined && typeof raw[f] !== 'boolean') p.push(`overlays.${raw.id}：${f} 要是布林值`)
      if (raw.weapon !== undefined && !isRecord(raw.weapon)) p.push(`overlays.${raw.id}：weapon 要是一把武器`)
      if (raw.down) continue
      const key = `${String(raw.side)}:${String(raw.slot)}`
      if (hung.has(key)) p.push(`overlays.${raw.id}：和 ${hung.get(key)} 掛在同一格（每格最多一台）`)
      hung.set(key, raw.id)
    }
  }
  // 叫來還沒進場的人（run.callIn）：每一個都要在自己那一方的後方排著（slot 是 0、沒有退出、在 reserve 裡），不重複
  if (b.called !== undefined) {
    if (!Array.isArray(b.called)) p.push('called 要是單位 id 的陣列')
    else {
      const reserve = isRecord(b.reserve) ? b.reserve : {}
      const dup = new Set<unknown>()
      for (const id of b.called) {
        const u = typeof id === 'string' ? units[id] : undefined
        const queue = isRecord(u) ? reserve[u.side as string] : undefined
        if (!isRecord(u)) p.push(`called：${String(id)} 不是這場戰鬥的單位`)
        else if (dup.has(id)) p.push(`called：${String(id)} 重複了`)
        else if (u.out || u.slot !== 0 || !Array.isArray(queue) || !queue.includes(id)) p.push(`called：${String(id)} 要在後方排隊（沒有退出、slot 是 0、在自己那一方的 reserve 裡）`)
        dup.add(id)
      }
    }
  }
  // 還沒分出結果的戰鬥，輪到的那個人要在場上（讀進一份「沒有人能動」的戰鬥會卡死）
  if (!b.result && b.order.length > 0 && isInt(b.turn) && (b.turn as number) >= 0 && (b.turn as number) < b.order.length) {
    const cur = units[b.order[b.turn as number] as string]
    if (isRecord(cur) && (cur.out || !((cur.slot as number) >= 1))) p.push('輪到的那個人不在場上（已經退出，或還在後方）')
  }
  if (!b.result && b.order.length === 0) p.push('order 是空的：沒有人可以行動')
  return p
}

export { isValidTime }
