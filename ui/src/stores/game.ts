import { defineStore } from 'pinia'
import { ref, computed, reactive } from 'vue'
import type { BodyPartId, DistrictId, EquipSlotId, ItemStack, Point, Condition } from '../data/types'
import { PROTAGONIST, PARTY, START_INVENTORY, START_CYBER, START_EQUIP, START_QUICK } from '../data/character'
import { NPCS, affinityStage } from '../data/npcs'
import { DISTRICTS, blockSpec, buildBlockMap } from '../data/districts'
import { ITEMS, itemDef } from '../data/items'
import { EQUIP_SLOTS } from '../data/character'
import { MORE_NPCS, ROSTER } from '../data/roster'
import { START_BASICS, START_LEARNED, START_LOADOUT, START_NIGHT, START_PARAMS, START_TENDENCY, START_FAME, START_SEX, START_DECK, START_GUIDES } from '../data/profile'
import { START_CHANNEL } from '../data/channel'
import { HELD } from '../data/contracts'
import { BILL_ITEMS, PENDING } from '../data/weekly'
import { START_FILL } from '../data/crafting'
import { SKILL_TREES } from '../data/content.generated'
import { skillXp } from '../lib/skills'
import { packSave, rollbackKeeping, type Snapshot, type SnapshotKind } from '../lib/save'

/**
 * 假存檔：主角、背包、義體、裝備、所在地、時間、錢、紀錄。
 * 引擎做好之後，這個 store 換成引擎狀態的唯讀投影，動作改成呼叫引擎。
 */
export interface Roll { skill: string; die: number; mod: number; dc: number; result: '成功' | '失敗' | '大成功' | '大失敗'; twist?: string }
export interface LogEntry { id: number; time: string; place: string; prose: string[]; quotes?: string[]; net?: string[]; roll?: Roll; changes?: Array<{ text: string; kind?: 'plus' | 'minus' }> }

/** 存檔裡的狀態的樣子（serialize() 回傳的）。 */
export interface SaveShape {
  day: number; minutes: number; money: { acc: number; cash: number; fav: number }; hostility: Record<string, number>
  character: typeof PROTAGONIST; party: typeof PARTY; inventory: ItemStack[]; cyber: typeof START_CYBER; equip: Partial<Record<EquipSlotId, string>>
  quick: Array<string | null>; coatClosed: boolean; npcs: Record<string, import('../data/types').Npc>; loc: { district: DistrictId; block: string; pos: Point; facility: string | null }; log: LogEntry[]
  basics: Record<string, number>; learned: string[]; loadout: string[]; nightLearned: string[]; params: typeof START_PARAMS; tendency: typeof START_TENDENCY
  fame: Record<string, number>; sexRecord: typeof START_SEX; deck: typeof START_DECK; roster: typeof ROSTER; channel: typeof START_CHANNEL; contracts: { held: typeof HELD }
  bills: { items: typeof BILL_ITEMS; overdueWeeks: number }; pending: typeof PENDING; craftFill: Record<string, Record<string, string>>; guides: typeof START_GUIDES; dungeonSeed: number
}

const WEEKDAYS = ['週一', '週二', '週三', '週四', '週五', '週六', '週日']

export const useGame = defineStore('game', () => {
  const day = ref(14)
  const minutes = ref(17 * 60 + 20)
  // 第 14 天週一 17:20；收租日已經過了，下一次在第 21 天
  const money = reactive({ acc: 4620, cash: 3700, fav: 2 })
  const hostility = reactive<Record<string, number>>({ 緋櫻: 62, 野良: 30, 伊甸園: 18 })
  const character = reactive(structuredClone(PROTAGONIST))
  const party = reactive(structuredClone(PARTY))
  const inventory = ref<ItemStack[]>(structuredClone(START_INVENTORY))
  const cyber = reactive(structuredClone(START_CYBER))
  const equip = reactive<Partial<Record<EquipSlotId, string>>>({ ...START_EQUIP })
  const quick = ref<Array<string | null>>([...START_QUICK])
  const coatClosed = ref(true)
  const npcs = reactive(structuredClone({ ...NPCS, ...MORE_NPCS }))
  // ---- 第二版 ----
  const basics = reactive<Record<string, number>>({ ...START_BASICS })
  const learned = ref<string[]>([...START_LEARNED])
  const loadout = ref<string[]>([...START_LOADOUT])
  const nightLearned = ref<string[]>([...START_NIGHT])
  const params = reactive({ ...START_PARAMS })
  const tendency = reactive(structuredClone(START_TENDENCY))
  const fame = reactive({ ...START_FAME })
  const sexRecord = reactive(structuredClone(START_SEX))
  const deck = reactive(structuredClone(START_DECK))
  const roster = ref(structuredClone(ROSTER))
  const channel = reactive(structuredClone(START_CHANNEL))
  const contracts = reactive({ held: structuredClone(HELD) })
  const bills = reactive({ items: structuredClone(BILL_ITEMS), overdueWeeks: 0 })
  const pending = ref(structuredClone(PENDING))
  const craftFill = reactive<Record<string, Record<string, string>>>(structuredClone(START_FILL))
  const guides = reactive(structuredClone(START_GUIDES))
  const dungeonSeed = ref(1)
  const snapshots = ref<Snapshot[]>([])
  const inRun = ref(false)
  const loc = reactive<{ district: DistrictId; block: string; pos: Point; facility: string | null }>({ district: 'hive', block: '四號塔', pos: { x: 3, y: 1 }, facility: 'rooftop' })
  const log = ref<LogEntry[]>([
    { id: 1, time: '第 14 天 17:12', place: '蜂巢 · 四號塔 · 屋頂的晾衣場',
      prose: ['小麥坐在水塔的鐵架上，郵差包擱在腿邊，正在把今天沒送完的信照樓層排好。看到你從樓梯口上來，她把一疊信塞回包裡，往旁邊挪出一個位子。'],
      quotes: ['「你今天怎麼有空上來？我還以為你被藍鯨那件事纏住了。」'] },
    { id: 2, time: '第 14 天 16:40', place: '蜂巢 · 天井市場',
      prose: ['雨從頂棚的縫裡滴下來，阿蓮的雜貨店還亮著。她抬頭看你一眼，把一碗麵推到櫃檯的這一邊。'],
      net: ['你順手掃了一下市場的子網：三台收租無人機、一面牆報板，沒有人在看你。'],
      roll: { skill: '街頭直覺', die: 14, mod: 5, dc: 13, result: '成功', twist: '而且阿蓮多給了你一顆蛋' },
      changes: [{ text: '街頭信譽 +1', kind: 'plus' }, { text: '現金 −5', kind: 'minus' }] },
  ])
  let logSeq = 3
  let uidSeq = 100

  const timeLabel = computed(() => {
    const h = Math.floor(minutes.value / 60) % 24, m = minutes.value % 60
    return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`
  })
  const weekday = computed(() => WEEKDAYS[day.value % 7]) // 第 14 天是週一（收租日）
  /** 到下一個週一收租日還有幾天 */
  const billIn = computed(() => { const d = (7 - (day.value % 7)) % 7; return d === 0 ? 7 : d })
  const district = computed(() => DISTRICTS.find(d => d.id === loc.district)!)
  const block = computed(() => blockSpec(loc.district, loc.block))
  const blockMap = computed(() => buildBlockMap(block.value))
  const facility = computed(() => block.value.facilities.find(f => f.id === loc.facility) ?? null)
  const placeLabel = computed(() => [district.value.name, loc.block, facility.value?.name].filter(Boolean).join(' · '))
  const topHostility = computed(() => Object.entries(hostility).sort((a, b) => b[1] - a[1]).slice(0, 2))

  const carriedWeight = computed(() => {
    // 家具直接送到家裡，不算身上的重量
    let w = inventory.value.reduce((s, st) => s + (ITEMS[st.def]?.kind === 'furniture' ? 0 : ITEMS[st.def]?.weight ?? 0) * st.qty, 0)
    for (const id of Object.values(equip)) if (id) w += ITEMS[id]?.weight ?? 0
    return Math.round(w * 10) / 10
  })
  const sinkFloor = computed(() => Object.values(cyber).flat().reduce((s, id) => s + (id ? ITEMS[id]?.cyber?.sink ?? 0 : 0), 0))
  /** 快取格：每個人 2 格＋腰帶 1＋戰術背心 2（EQUIPMENT 4.1 節） */
  const quickCap = computed(() => 2 + 1 + (equip.armor === 'it_7d6ad2' ? 2 : 0))
  const coveredSlots = computed(() => new Set(coatClosed.value && equip.coat ? EQUIP_SLOTS.filter(s => s.coveredByCoat).map(s => s.id) : []))

  function advance(mins: number) {
    minutes.value += mins
    while (minutes.value >= 24 * 60) { minutes.value -= 24 * 60; day.value++ }
  }
  function addLog(e: Omit<LogEntry, 'id' | 'time' | 'place'> & { place?: string }) {
    log.value.unshift({ id: logSeq++, time: `第 ${day.value} 天 ${timeLabel.value}`, place: e.place ?? placeLabel.value, ...e })
  }
  function moveBlock(d: DistrictId, block: string, viaExit?: string) {
    const changed = loc.block !== block || loc.district !== d
    loc.district = d
    loc.block = block
    loc.facility = null
    const m = buildBlockMap(blockSpec(d, block))
    // 從哪個出口來，就站在那個出口；不然站在第一個出口
    let start: Point | null = null
    for (const [k, to] of m.exitAt) if (to === viaExit) { const [x, y] = k.split(',').map(Number); start = { x, y } }
    if (!start) { const k = [...m.exitAt.keys()][0] ?? '6,2'; const [x, y] = k.split(',').map(Number); start = { x, y } }
    loc.pos = start
    if (changed) addLog({ prose: [`你走到${district.value.name}的${block}。`], place: `${district.value.name} · ${block}` })
  }
  function setFacility(id: string | null) { loc.facility = id }

  function addItem(def: string, qty = 1, condition: Condition = '全新') {
    const st = inventory.value.find(s => s.def === def && s.condition === condition && !s.unknown)
    if (st) st.qty += qty
    else inventory.value.push({ uid: `u${uidSeq++}`, def, qty, condition })
  }
  function removeItem(uid: string, qty = 1) {
    const i = inventory.value.findIndex(s => s.uid === uid)
    if (i < 0) return
    inventory.value[i].qty -= qty
    if (inventory.value[i].qty <= 0) inventory.value.splice(i, 1)
  }
  function stackOf(uid: string) { return inventory.value.find(s => s.uid === uid) ?? null }

  /** 把背包裡的一件穿上；原本那一件回背包。 */
  function equipItem(slot: EquipSlotId, uid: string) {
    const st = stackOf(uid)
    if (!st) return
    const prev = equip[slot]
    equip[slot] = st.def
    removeItem(uid)
    if (prev) addItem(prev)
  }
  function unequip(slot: EquipSlotId) {
    const prev = equip[slot]
    if (!prev) return
    delete equip[slot]
    addItem(prev)
  }
  /** 義體要在診所拆裝；這裡只給「拆下」的預覽，不真的動 */
  function cyberAt(part: BodyPartId) { return cyber[part] }

  function changeAffinity(npcId: string, delta: number) {
    const n = npcs[npcId]
    if (!n) return
    n.affinity = Math.max(-100, Math.min(100, n.affinity + delta))
    n.stage = affinityStage(n.affinity)
  }

  function itemName(def: string) { return itemDef(def).name }

  // ---- 技能（SKILLS 1.3 節） ----
  function learnSkill(id: string) {
    const [tree] = id.split(':')
    const sk = SKILL_TREES.find(t => t.id === tree)?.skills.find(k => k.id === id)
    if (!sk || learned.value.includes(id)) return
    character.xp -= skillXp(sk)
    learned.value.push(id)
    syncTrees()
  }
  /** 角色卡上的「槍手 3」照學會的技能重算。 */
  function syncTrees() {
    const out: string[] = []
    for (const t of SKILL_TREES) {
      const spent = t.skills.reduce((a, k) => a + (learned.value.includes(k.id) ? skillXp(k) : 0), 0)
      if (!spent) continue
      const tier = [0, 40, 120, 240, 400].filter(n => spent >= n).length
      out.push(`${t.name} ${tier}`)
    }
    character.trees = out
  }
  function learnNight(id: string, cost: number) {
    if (nightLearned.value.includes(id)) return
    character.insight -= cost
    nightLearned.value.push(id)
  }
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
      day: day.value, minutes: minutes.value, money: { ...money }, hostility: { ...hostility }, character: { ...character }, party: [...party],
      inventory: inventory.value, cyber: { ...cyber }, equip: { ...equip }, quick: quick.value, coatClosed: coatClosed.value, npcs: { ...npcs }, loc: { ...loc }, log: log.value,
      basics: { ...basics }, learned: learned.value, loadout: loadout.value, nightLearned: nightLearned.value, params: { ...params }, tendency: { ...tendency },
      fame: { ...fame }, sexRecord: { ...sexRecord }, deck: { ...deck }, roster: roster.value, channel: { ...channel }, contracts: { ...contracts }, bills: { ...bills },
      pending: pending.value, craftFill: { ...craftFill }, guides: { ...guides }, dungeonSeed: dungeonSeed.value,
    })) as SaveShape
  }
  type SaveState = SaveShape
  /** 讀回一份狀態。v1 的存檔少了第二版的欄位：少的保留現在的值。 */
  function hydrate(d: Partial<SaveState>) {
    const put = <T extends object>(target: T, v: unknown) => { if (v && typeof v === 'object') { for (const k of Object.keys(target)) if (!(k in (v as object))) delete (target as Record<string, unknown>)[k]; Object.assign(target, structuredClone(v)) } }
    if (typeof d.day === 'number') day.value = d.day
    if (typeof d.minutes === 'number') minutes.value = d.minutes
    if (d.money) Object.assign(money, d.money)
    if (d.hostility) Object.assign(hostility, d.hostility)
    if (d.character) Object.assign(character, structuredClone(d.character))
    if (d.party) party.splice(0, party.length, ...structuredClone(d.party))
    if (d.inventory) inventory.value = structuredClone(d.inventory)
    if (d.cyber) Object.assign(cyber, structuredClone(d.cyber))
    if (d.equip) put(equip, d.equip)
    if (d.quick) quick.value = [...d.quick]
    if (typeof d.coatClosed === 'boolean') coatClosed.value = d.coatClosed
    if (d.npcs) Object.assign(npcs, structuredClone(d.npcs))
    if (d.loc) Object.assign(loc, structuredClone(d.loc))
    if (d.log) log.value = structuredClone(d.log)
    if (d.basics) Object.assign(basics, d.basics)
    if (d.learned) learned.value = [...d.learned]
    if (d.loadout) loadout.value = [...d.loadout]
    if (d.nightLearned) nightLearned.value = [...d.nightLearned]
    if (d.params) Object.assign(params, d.params)
    if (d.tendency) Object.assign(tendency, structuredClone(d.tendency))
    if (d.fame) Object.assign(fame, d.fame)
    if (d.sexRecord) Object.assign(sexRecord, structuredClone(d.sexRecord))
    if (d.deck) Object.assign(deck, structuredClone(d.deck))
    if (d.roster) roster.value = structuredClone(d.roster)
    if (d.channel) Object.assign(channel, structuredClone(d.channel))
    if (d.contracts) Object.assign(contracts, structuredClone(d.contracts))
    if (d.bills) Object.assign(bills, structuredClone(d.bills))
    if (d.pending) pending.value = structuredClone(d.pending)
    if (d.craftFill) put(craftFill, d.craftFill)
    if (d.guides) Object.assign(guides, structuredClone(d.guides))
    if (typeof d.dungeonSeed === 'number') dungeonSeed.value = d.dungeonSeed
    logSeq = Math.max(logSeq, ...log.value.map(e => e.id + 1))
  }
  function saveMeta(kind: '手動' | '自動' | '快照' = '手動') {
    return { label: `第 ${day.value} 天 ${timeLabel.value}・${placeLabel.value}`, day: day.value, time: timeLabel.value, place: placeLabel.value, savedAt: new Date().toISOString(), kind }
  }
  function packed(kind: '手動' | '自動' | '快照' = '手動') { return packSave(serialize(), saveMeta(kind)) }

  /** 委託副本的快照：每個階段開始時與每場戰鬥開打前各存一個（SERIES 第 6 節）。 */
  let snapSeq = 1
  function takeSnapshot(kind: SnapshotKind, label: string) {
    const s: Snapshot = { id: `snap${snapSeq++}`, kind, label, at: `第 ${day.value} 天 ${timeLabel.value}`, state: JSON.stringify(serialize()) }
    if (kind === '戰鬥') snapshots.value = snapshots.value.filter(x => x.kind !== '戰鬥')
    snapshots.value.push(s)
    return s
  }
  /** 回退：保留紀錄、性經歷記錄與共同記憶。 */
  function rollback(id: string) {
    const s = snapshots.value.find(x => x.id === id)
    if (!s) return
    const now = serialize()
    const snap = JSON.parse(s.state) as SaveState
    const note = { id: logSeq++, time: `第 ${day.value} 天 ${timeLabel.value}`, place: placeLabel.value, prose: [`這一段經歷被收回了：時間回到${s.label}（${s.at}）。發生過的事你還記得。`] }
    hydrate(rollbackKeeping(now as never, snap as never, note) as Partial<SaveState>)
    if (s.kind === '入口') { snapshots.value = []; inRun.value = false }
    else if (s.kind === '階段') snapshots.value = snapshots.value.filter(x => x.kind !== '戰鬥' || snapshots.value.indexOf(x) < snapshots.value.indexOf(s))
  }

  return {
    day, minutes, money, hostility, character, party, inventory, cyber, equip, quick, coatClosed, npcs, loc, log,
    timeLabel, weekday, billIn, district, block, blockMap, facility, placeLabel, topHostility, carriedWeight, sinkFloor, quickCap, coveredSlots,
    advance, addLog, moveBlock, setFacility, addItem, removeItem, stackOf, equipItem, unequip, cyberAt, changeAffinity, itemName,
    basics, learned, loadout, nightLearned, params, tendency, fame, sexRecord, deck, roster, channel, contracts, bills, pending, craftFill, guides, dungeonSeed, snapshots, inRun,
    learnSkill, syncTrees, learnNight, setQuick, serialize, hydrate, saveMeta, packed, takeSnapshot, rollback,
  }
})
