import { defineStore } from 'pinia'
import { ref, computed, reactive } from 'vue'
import type { BodyPartId, DistrictId, EquipSlotId, ItemStack, Point, Condition } from '../data/types'
import { PROTAGONIST, PARTY, START_INVENTORY, START_CYBER, START_EQUIP, START_QUICK } from '../data/character'
import { NPCS, affinityStage } from '../data/npcs'
import { DISTRICTS, blockSpec, buildBlockMap } from '../data/districts'
import { ITEMS, itemDef } from '../data/items'
import { EQUIP_SLOTS } from '../data/character'

/**
 * 假存檔：主角、背包、義體、裝備、所在地、時間、錢、紀錄。
 * 引擎做好之後，這個 store 換成引擎狀態的唯讀投影，動作改成呼叫引擎。
 */
export interface Roll { skill: string; die: number; mod: number; dc: number; result: '成功' | '失敗' | '大成功' | '大失敗'; twist?: string }
export interface LogEntry { id: number; time: string; place: string; prose: string[]; quotes?: string[]; net?: string[]; roll?: Roll; changes?: Array<{ text: string; kind?: 'plus' | 'minus' }> }

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
  const npcs = reactive(structuredClone(NPCS))
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

  return {
    day, minutes, money, hostility, character, party, inventory, cyber, equip, quick, coatClosed, npcs, loc, log,
    timeLabel, weekday, billIn, district, block, blockMap, facility, placeLabel, topHostility, carriedWeight, sinkFloor, quickCap, coveredSlots,
    advance, addLog, moveBlock, setFacility, addItem, removeItem, stackOf, equipItem, unequip, cyberAt, changeAffinity, itemName,
  }
})
