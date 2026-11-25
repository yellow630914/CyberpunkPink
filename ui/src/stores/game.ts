import { defineStore } from 'pinia'
import { ref, computed, reactive } from 'vue'
import type { DistrictId, EquipSlotId, ItemStack, Point, Condition } from '../data/types'
import { PROTAGONIST, PARTY, START_INVENTORY, START_EQUIP, START_QUICK } from '../data/character'
import { NPCS } from '../data/npcs'
import { DISTRICTS } from '../data/districts'
import { legacyFacilityAt } from '../data/demo'
import { ITEMS, itemDef } from '../data/items'
import { EQUIP_SLOTS } from '../data/character'
import { MORE_NPCS } from '../data/roster'
import { START_BASICS, START_LEARNED, START_NIGHT, START_PARAMS, START_TENDENCY, START_FAME, START_SEX, START_GUIDES } from '../data/profile'
import { START_CHANNEL } from '../data/channel'
import { HELD } from '../data/contracts'
import { PENDING } from '../data/weekly'
import { START_MEDIA } from '../data/media'
import { START_MECH, type MechState } from '../data/garage'
import { useHome } from './home'
import { useEngine } from './engine'
import { useUi } from './ui'
import { packSave, rollbackKeeping, type Snapshot } from '../lib/save'
import { sanitizeDyes, type Dye } from '../lib/craftView'

/**
 * 假存檔：主角、背包、裝備、所在地、時間、錢、紀錄（義體、沉溺、藥是引擎的：stores/engine.ts 的 body）。
 * 引擎做好之後，這個 store 換成引擎狀態的唯讀投影，動作改成呼叫引擎。
 */
export interface Roll { skill: string; die: number; mod: number; dc: number; result: '成功' | '失敗' | '大成功' | '大失敗'; twist?: string; rerolls?: number }
export interface LogEntry { id: number | string; time: string; place: string; prose: string[]; quotes?: string[]; net?: string[]; roll?: Roll; changes?: Array<{ text: string; kind?: 'plus' | 'minus' }> }

/** 存檔裡的狀態的樣子（serialize() 回傳的）。 */
export interface SaveShape {
  day: number; minutes: number; money: { fav: number }; hostility: Record<string, number>
  character: typeof PROTAGONIST; party: typeof PARTY; inventory: ItemStack[]; equip: Partial<Record<EquipSlotId, string>>
  quick: Array<string | null>; coatClosed: boolean; npcs: Record<string, import('../data/types').Npc>; loc: { district: DistrictId; block: string; pos?: Point; facility: string | null }; log: LogEntry[]
  basics: Record<string, number>; learned: string[]; nightLearned: string[]; params: typeof START_PARAMS; tendency: typeof START_TENDENCY
  fame: Record<string, number>; sexRecord: typeof START_SEX; channel: typeof START_CHANNEL; contracts: { held: typeof HELD }
  /** 舊存檔的假帳單（帳單搬進引擎之後不再使用；讀到就略過） */
  bills?: unknown
  pending: typeof PENDING; guides: typeof START_GUIDES; dungeonSeed: number; vehicles?: string[]
  media?: typeof START_MEDIA
  mech?: MechState
  /** 第 3 版：家園的 store（null 是 v2 升上來的存檔，讀的時候不動）。subnet 是舊存檔留下的欄位（子網搬進引擎之後不再使用，讀到就略過） */
  home?: Record<string, unknown> | null
  subnet?: Record<string, unknown> | null
  /** 第 4 版：染色（key 是「uid:背包那一疊」或「slot:穿著的格子」） */
  dyes?: Record<string, Dye>
}

const WEEKDAYS = ['週一', '週二', '週三', '週四', '週五', '週六', '週日']

export const useGame = defineStore('game', () => {
  // 時間、兩種錢、紀錄的真相在引擎（stores/engine.ts）；這裡是投影，舊畫面照舊讀寫 g.day、g.money.acc、g.advance()、g.addLog()。
  const eng = useEngine()
  // 還沒開過新局（引擎是空的）時，照原本假存檔的樣子放一個示範的局：第 14 天週一 17:20、帳戶 4620、現金 3700。開新局與讀檔會整個換掉它。
  if (eng.state.reports.length === 0) {
    eng.newGame({ seed: 1 })
    // 示意名冊（小麥、雷）放進同一筆帳。推進十三天，引擎會補那幾天的人事（名單的變動、名冊上的人的日子）：開局的紀錄多一則「近況」（kind: downtime）
    eng.ledger([{ op: 'cred', delta: 4620 }, { op: 'cash', delta: 3700 }, { op: 'time', minutes: 13 * 24 * 60 + 9 * 60 + 20 }, ...eng.people.demoChanges()])
  }
  const day = computed(() => eng.state.time.day)
  const minutes = computed(() => eng.state.time.hour * 60 + eng.state.time.minute)
  const fav = ref(2)
  /** 帳戶（cred）與現金（cash）讀寫引擎：改一下就是一筆帳（不進紀錄）。fav 還在這裡。 */
  // 錢不夠（引擎不讓錢變負數）時不丟錯、不改：提示一聲就算了。呼叫端要整件事一起不做的，先自己檢查再動。
  const pay = (op: 'cred' | 'cash', v: number): void => {
    const delta = v - (op === 'cred' ? eng.money.cred : eng.money.cash)
    if (delta === 0) return
    try {
      // 戰鬥中或等著選的戰敗時，引擎不收這筆帳：回傳原因，不當成成功
      const why = eng.ledger([{ op, delta }])
      if (why) useUi().toast(why, 'warn')
    } catch { useUi().toast('錢不夠。', 'warn') }
  }
  const money = reactive({
    get acc() { return eng.money.cred }, set acc(v: number) { pay('cred', v) },
    get cash() { return eng.money.cash }, set cash(v: number) { pay('cash', v) },
    get fav() { return fav.value }, set fav(v: number) { fav.value = v },
  })
  const hostility = reactive<Record<string, number>>({ 緋櫻: 62, 野良: 30, 伊甸園: 18 })
  const character = reactive(structuredClone(PROTAGONIST))
  const party = reactive(structuredClone(PARTY))
  const inventory = ref<ItemStack[]>(structuredClone(START_INVENTORY))
  const equip = reactive<Partial<Record<EquipSlotId, string>>>({ ...START_EQUIP })
  const quick = ref<Array<string | null>>([...START_QUICK])
  const coatClosed = ref(true)
  const npcs = reactive(structuredClone({ ...NPCS, ...MORE_NPCS }))
  // ---- 第二版 ----
  const basics = reactive<Record<string, number>>({ ...START_BASICS })
  const learned = ref<string[]>([...START_LEARNED])
  const nightLearned = ref<string[]>([...START_NIGHT])
  const params = reactive({ ...START_PARAMS })
  const tendency = reactive(structuredClone(START_TENDENCY))
  const fame = reactive({ ...START_FAME })
  const sexRecord = reactive(structuredClone(START_SEX))
  /** 自己的車（ITEMS 第 14 節）：有的話城市地圖可以直接開過去，不要錢。假存檔沒有車。 */
  // 第四版：假存檔有一台二手街車，上一場被打爛了（機甲整備的「載具」一列可以拖車與修）
  const vehicles = ref<string[]>(['veh_street:used'])
  const channel = reactive(structuredClone(START_CHANNEL))
  const contracts = reactive({ held: structuredClone(HELD) })
  const pending = ref(structuredClone(PENDING))
  const guides = reactive(structuredClone(START_GUIDES))
  const dungeonSeed = ref(1)
  /** 紀錄、素材、片（MEDIA 第 1～5 節） */
  const media = reactive(structuredClone(START_MEDIA))
  /** 機甲（ITEMS 14.2 節、CRAFTING 第 15 節）：假存檔有一具除役的野馬 II */
  const mech = reactive<MechState>(structuredClone(START_MECH))
  /** 最近一場戰鬥的結果：戰鬥畫面離開時寫，委託頁讀了推進階段（不進存檔） */
  const lastBattle = ref<{ kind: 'real' | 'net' | 'opinion' | 'subnet' | 'scene'; result: string; text: string; rounds?: number; crits?: number; downs?: number; lethal?: number } | null>(null)
  /** 染色（EQUIPMENT 第 9 節）：背包裡的一疊或穿著的一格染成的主色調與副色調；沒有就是預設的顏色 */
  const dyes = reactive<Record<string, Dye>>({})
  const snapshots = ref<Snapshot[]>([])
  /** 紀錄：引擎的報告轉成的（最新的在最前面） */
  const log = computed<LogEntry[]>(() => eng.log)
  let uidSeq = 100

  const timeLabel = computed(() => {
    const h = Math.floor(minutes.value / 60) % 24, m = minutes.value % 60
    return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`
  })
  // 星期與離收租日（週一）幾天：問引擎的時鐘（CORE_RULES 7.4 節）
  const clock = computed(() => eng.clock)
  const weekday = computed(() => WEEKDAYS[clock.value.weekday])
  /** 到下一個週一收租日還有幾天（今天就是週一時，顯示成 7 天後：收租日是今天已經過的那一次） */
  const billIn = computed(() => clock.value.daysToMonday === 0 ? 7 : clock.value.daysToMonday)
  // 所在地的真相在引擎（features/world 的 worldView）：這裡是投影。區的資料（治安、風格）還是舊的示意資料，由區的 id 對上。
  const where = computed(() => eng.world.view())
  const district = computed(() => DISTRICTS.find(d => d.id === where.value.district?.id) ?? DISTRICTS[0])
  /** 站的這間設施：舊的示意資料（商店、診所、住處的服務與在場的人）；還沒搬進引擎的部分用它，找不到是 null */
  const facility = computed(() => legacyFacilityAt(where.value.block?.id ?? '', where.value.facility?.marker))
  const loc = reactive({
    get district(): DistrictId { return district.value.id },
    get block(): string { return where.value.block?.name ?? '' },
    get facility(): string | null { return facility.value?.id ?? null },
  })
  const placeLabel = computed(() => [where.value.district?.name, where.value.block?.name, where.value.facility?.name].filter(Boolean).join(' · '))
  /** 狀態列的敵對值：引擎的量表（舊的 hostility 只剩舊系統自己讀寫） */
  const topHostility = computed(() => eng.hostilityTop(2))

  const carriedWeight = computed(() => {
    // 家具直接送到家裡，不算身上的重量
    let w = inventory.value.reduce((s, st) => s + (ITEMS[st.def]?.kind === 'furniture' ? 0 : ITEMS[st.def]?.weight ?? 0) * st.qty, 0)
    for (const id of Object.values(equip)) if (id) w += ITEMS[id]?.weight ?? 0
    return Math.round(w * 10) / 10
  })
  /** 快取格：每個人 2 格＋腰帶 1＋戰術背心 2（EQUIPMENT 4.1 節） */
  const quickCap = computed(() => 2 + 1 + (equip.armor === 'it_7d6ad2' ? 2 : 0))
  const coveredSlots = computed(() => new Set(coatClosed.value && equip.coat ? EQUIP_SLOTS.filter(s => s.coveredByCoat).map(s => s.id) : []))

  function advance(mins: number) {
    if (mins <= 0) return
    const why = eng.commit({ summary: '時間過去', action: 'ui.time', changes: [{ op: 'time', minutes: mins }] }, { attach: true })
    if (why) useUi().toast(why, 'warn')
  }
  /** 舊系統寫一則紀錄：正文、引言、網內的段落接成正文，變化的字放在 results，交給引擎提交成一份報告。 */
  function addLog(e: Omit<LogEntry, 'id' | 'time' | 'place'> & { place?: string }) {
    const prose = [...e.prose, ...(e.quotes ?? []), ...(e.net ?? [])]
    const why = eng.commit({ summary: e.prose[0] ?? '', prose, results: (e.changes ?? []).map(c => c.text), place: e.place ?? placeLabel.value })
    if (why) useUi().toast(why, 'warn')
  }
  function addItem(def: string, qty = 1, condition: Condition = '全新', dye?: Dye | null) {
    // 染過的那一疊不和沒染的合併
    const st = dye ? null : inventory.value.find(s => s.def === def && s.condition === condition && !s.unknown && !dyes[`uid:${s.uid}`])
    if (st) { st.qty += qty; return st.uid }
    const uid = `u${uidSeq++}`
    inventory.value.push({ uid, def, qty, condition })
    if (dye) dyes[`uid:${uid}`] = { ...dye }
    return uid
  }
  function removeItem(uid: string, qty = 1) {
    const i = inventory.value.findIndex(s => s.uid === uid)
    if (i < 0) return
    inventory.value[i].qty -= qty
    if (inventory.value[i].qty <= 0) { delete dyes[`uid:${uid}`]; inventory.value.splice(i, 1) }
  }
  function stackOf(uid: string) { return inventory.value.find(s => s.uid === uid) ?? null }

  /** 把背包裡的一件穿上；原本那一件回背包。 */
  function equipItem(slot: EquipSlotId, uid: string) {
    const st = stackOf(uid)
    if (!st) return
    const prev = equip[slot]
    const prevDye = dyes[`slot:${slot}`] ?? null
    const newDye = dyes[`uid:${uid}`] ?? null
    equip[slot] = st.def
    removeItem(uid)
    if (newDye) dyes[`slot:${slot}`] = { ...newDye }
    else delete dyes[`slot:${slot}`]
    if (prev) addItem(prev, 1, '全新', prevDye)
  }
  function unequip(slot: EquipSlotId) {
    const prev = equip[slot]
    if (!prev) return
    const d = dyes[`slot:${slot}`] ?? null
    delete equip[slot]
    delete dyes[`slot:${slot}`]
    addItem(prev, 1, '全新', d)
  }
  /** 染一疊或一格（key：「uid:…」或「slot:…」）；null 是換回預設的顏色 */
  function setDye(key: string, d: Dye | null) {
    if (d) dyes[key] = { primary: d.primary, secondary: d.secondary }
    else delete dyes[key]
  }
  function itemName(def: string) { return itemDef(def).name }

  function setQuick(i: number, def: string | null) {
    const q = [...quick.value]
    while (q.length <= i) q.push(null)
    q[i] = def
    quick.value = q
  }

  // ---- 存檔（lib/save.ts） ----
  /** 存檔裡的狀態：全部是可以 JSON 化的東西。 */
  function serialize() {
    return JSON.parse(JSON.stringify({
      money: { fav: money.fav }, hostility: { ...hostility }, character: { ...character }, party: [...party],
      inventory: inventory.value, equip: { ...equip }, quick: quick.value, coatClosed: coatClosed.value, npcs: { ...npcs }, loc: { ...loc },
      basics: { ...basics }, learned: learned.value, nightLearned: nightLearned.value, params: { ...params }, tendency: { ...tendency },
      fame: { ...fame }, sexRecord: { ...sexRecord }, channel: { ...channel }, contracts: { ...contracts },
      pending: pending.value, guides: { ...guides }, dungeonSeed: dungeonSeed.value, vehicles: vehicles.value, media: { ...media }, mech: { ...mech },
      home: useHome().serialize(), dyes: { ...dyes },
    })) as SaveShape
  }
  type SaveState = SaveShape
  /** 讀回一份狀態。v1 的存檔少了第二版的欄位：少的保留現在的值。 */
  function hydrate(d: Partial<SaveState>) {
    const put = <T extends object>(target: T, v: unknown) => { if (v && typeof v === 'object') { for (const k of Object.keys(target)) if (!(k in (v as object))) delete (target as Record<string, unknown>)[k]; Object.assign(target, structuredClone(v)) } }
    // 帳戶與現金是引擎管的，讀檔不碰（舊存檔裡的 acc、cash 忽略）；這裡只有好感點
    if (typeof d.money?.fav === 'number') money.fav = d.money.fav
    if (d.hostility) Object.assign(hostility, d.hostility)
    if (d.character) Object.assign(character, structuredClone(d.character))
    if (d.party) party.splice(0, party.length, ...structuredClone(d.party))
    if (d.inventory) inventory.value = structuredClone(d.inventory)
    if (d.equip) put(equip, d.equip)
    if (d.quick) quick.value = [...d.quick]
    if (typeof d.coatClosed === 'boolean') coatClosed.value = d.coatClosed
    if (d.npcs) Object.assign(npcs, structuredClone(d.npcs))
    // 所在地在引擎的存檔裡（loc 是舊存檔的欄位，讀的時候不碰）
    if (d.basics) Object.assign(basics, d.basics)
    if (d.learned) learned.value = [...d.learned]
    if (d.nightLearned) nightLearned.value = [...d.nightLearned]
    if (d.params) Object.assign(params, d.params)
    if (d.tendency) Object.assign(tendency, structuredClone(d.tendency))
    if (d.fame) Object.assign(fame, d.fame)
    if (d.sexRecord) Object.assign(sexRecord, structuredClone(d.sexRecord))
    if (d.channel) Object.assign(channel, structuredClone(d.channel))
    if (d.contracts) Object.assign(contracts, structuredClone(d.contracts))
    if (d.pending) pending.value = structuredClone(d.pending)
    if (d.guides) Object.assign(guides, structuredClone(d.guides))
    if (typeof d.dungeonSeed === 'number') dungeonSeed.value = d.dungeonSeed
    if (Array.isArray(d.vehicles)) vehicles.value = [...d.vehicles]
    if (d.media) Object.assign(media, structuredClone(d.media))
    if (d.mech) Object.assign(mech, structuredClone(d.mech))
    if (d.home) useHome().hydrate(d.home)
    if (d.dyes) { for (const k of Object.keys(dyes)) delete dyes[k]; Object.assign(dyes, sanitizeDyes(d.dyes)) }
  }
  function saveMeta(kind: '手動' | '自動' | '快照' = '手動') {
    return { label: `第 ${day.value} 天 ${timeLabel.value}・${placeLabel.value}`, day: day.value, time: timeLabel.value, place: placeLabel.value, savedAt: new Date().toISOString(), kind }
  }
  function packed(kind: '手動' | '自動' | '快照' = '手動') { return packSave(serialize(), saveMeta(kind)) }

  /**
   * 戰鬥開打前的快照（地下城、子網這些還沒搬進引擎的舊戰場用）：只留最新的一份。
   * 委託副本的「入口」「階段」快照在引擎裡（state.snapshots，kind entry、stage；撤退與回到階段開始時都是引擎的回退），不在這裡。
   */
  let snapSeq = 1
  function takeSnapshot(kind: '戰鬥', label: string) {
    const s: Snapshot = { id: `snap${snapSeq++}`, kind, label, at: `第 ${day.value} 天 ${timeLabel.value}`, state: JSON.stringify(serialize()), engine: eng.save() }
    snapshots.value = snapshots.value.filter(x => x.kind !== kind)
    snapshots.value.push(s)
    return s
  }
  /** 回退：保留紀錄、性經歷記錄與共同記憶。 */
  function rollback(id: string) {
    const s = snapshots.value.find(x => x.id === id)
    if (!s) return
    const now = { ...serialize(), log: [] as unknown[] }
    const snap = { ...(JSON.parse(s.state) as SaveState), log: [] as unknown[] }
    const note = { prose: [`這一段經歷被收回了：時間回到${s.label}（${s.at}）。發生過的事你還記得。`] }
    hydrate(rollbackKeeping(now as never, snap as never, note) as Partial<SaveState>)
    // 時間、錢、紀錄在引擎：引擎的時間只往前，所以用快照裡的引擎存檔讀回去（連回退的堆疊一起清掉）
    if (s.engine) eng.rewind(s.engine, note.prose[0]!)
    else addLog(note)
  }

  return {
    day, minutes, money, hostility, character, party, inventory, equip, quick, coatClosed, npcs, loc, log,
    timeLabel, weekday, billIn, district, facility, placeLabel, topHostility, carriedWeight, quickCap, coveredSlots,
    advance, addLog, addItem, removeItem, stackOf, equipItem, unequip, itemName,
    basics, learned, nightLearned, params, tendency, fame, sexRecord, channel, contracts, pending, guides, dungeonSeed, vehicles, media, mech, lastBattle, snapshots,
    dyes, setDye, setQuick, serialize, hydrate, saveMeta, packed, takeSnapshot, rollback,
  }
})
