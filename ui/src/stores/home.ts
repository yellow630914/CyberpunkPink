import { defineStore } from 'pinia'
import { ref, computed, reactive } from 'vue'
import { HomeMap, deriveRooms, comfort, storage, validatePlacement, walkGrid, cellsOf, type PlacedFurniture, type Rotation } from '../lib/home'
import { FURNITURE, START_FURNITURE, SHOP_FLOOR_LAYOUT, RESIDENCES, layoutFor, type ShopKind } from '../data/home'
import type { Point } from '../data/types'

/**
 * 家園（DOWNTIME 第 7 節，格子版）：等級決定地圖大小；房間是畫好的區域；家具有佔地、能轉、能搬；
 * 房間的用途由裡面的家具推出來；主角、住戶與訪客在地圖上走。
 * 第三版：住處（四號塔的單位 1→2、高樓層的打通戶 2→3）、三級的一樓店面（另一張圖，前場與後場）、最多兩處安全屋。
 * serialize()／hydrate() 讓存檔與委託副本的快照帶著家園（lib/save.ts 第 3 版）。
 */
export const TIER_CAPS: Record<number, { residents: number; staff: number }> = { 0: { residents: 0, staff: 0 }, 1: { residents: 1, staff: 1 }, 2: { residents: 3, staff: 2 }, 3: { residents: 5, staff: 4 } }

export interface HomePerson { id: string; name: string; kind: 'me' | 'ally' | 'visitor'; role: string; pos: Point; sleeps: boolean; room?: string }
export type Floor = 'up' | 'shop'

export const useHome = defineStore('home', () => {
  const tier = ref<1 | 2 | 3>(1)
  const residence = ref('tower4')
  const maxTier = computed(() => RESIDENCES.find(r => r.id === residence.value)?.tiers[1] ?? 2)
  const floor = ref<Floor>('up')
  const floors = reactive<Record<Floor, PlacedFurniture[]>>({ up: structuredClone(START_FURNITURE), shop: [] })
  const placed = computed<PlacedFurniture[]>({ get: () => floors[floor.value], set: v => { floors[floor.value] = v } })
  const chosen = reactive<Record<string, string | undefined>>({ M: 'bedroom' })
  const people = ref<HomePerson[]>([
    { id: 'me', name: '你', kind: 'me', role: '屋主', pos: { x: 3, y: 4 }, sleeps: true },
    { id: 'nana', name: '奈奈', kind: 'visitor', role: '訪客・約好了 20:00', pos: { x: 6, y: 2 }, sleeps: false },
  ])
  const staff = ref([{ role: '看門的', who: '孤星連', wage: 200 }])
  /** 三級的店面（DOWNTIME 7.11 節）：種類、店長、上一週的結算 */
  const shop = reactive<{ kind: ShopKind | null; manager: string | null; last: string | null; open: boolean }>({ kind: null, manager: null, last: null, open: true })
  /** 安全屋：住處的 id（最多兩處） */
  const safehouses = ref<string[]>([])
  /** 搬家時新家擺不下、打包起來的家具（家具 id）：從「家具」分頁再擺出來 */
  const boxed = ref<string[]>([])
  let seq = 100

  const map = computed(() => new HomeMap(floor.value === 'shop' && tier.value === 3 ? SHOP_FLOOR_LAYOUT : layoutFor(residence.value, tier.value)))
  const residentRooms = computed(() => people.value.filter(p => p.kind === 'ally' && p.room).map(p => p.room!))
  const rooms = computed(() => deriveRooms(map.value, FURNITURE, placed.value, { chosen, residentRooms: residentRooms.value }))
  const sleepers = computed(() => people.value.filter(p => p.sleeps).length)
  const comfortInfo = computed(() => comfort(FURNITURE, floors.up, floor.value === 'up' ? rooms.value : deriveRooms(new HomeMap(layoutFor(residence.value, tier.value)), FURNITURE, floors.up, { chosen, residentRooms: residentRooms.value }), { sleepers: sleepers.value, built: 0, peopleBonus: 0 }))
  const storageInfo = computed(() => storage(FURNITURE, rooms.value))
  const residents = computed(() => people.value.filter(p => p.kind === 'ally'))
  /** 店面讓名冊上的人有地方待：住戶上限另 +2 */
  const caps = computed(() => ({ ...TIER_CAPS[tier.value], residents: TIER_CAPS[tier.value].residents + (tier.value === 3 && shop.kind ? 2 : 0) }))
  const grid = computed(() => walkGrid(map.value, placed.value, FURNITURE))
  /** 地圖上看得到的人：樓上是住戶與訪客；店面只有你與店長 */
  const visible = computed<HomePerson[]>(() => floor.value === 'up' ? people.value : [
    people.value.find(p => p.id === 'me')!,
    ...(shop.manager ? [{ id: 'mgr', name: shop.manager, kind: 'ally' as const, role: '店長', pos: { x: 12, y: 2 }, sleeps: false }] : []),
  ])

  function check(cand: PlacedFurniture, moverId?: string) {
    return validatePlacement(map.value, FURNITURE, placed.value, cand, {
      people: visible.value.filter(p => p.id !== moverId).map(p => p.pos),
      roomUse: Object.fromEntries(rooms.value.map(r => [r.id, r.use ?? undefined])),
    })
  }
  function place(def: string, x: number, y: number, rot: Rotation) {
    const cand = { uid: `f${seq++}`, def, x, y, rot }
    const r = check(cand)
    if (r.ok) placed.value.push(cand)
    return r
  }
  function move(uid: string, x: number, y: number, rot: Rotation) {
    const cur = placed.value.find(p => p.uid === uid)
    if (!cur) return { ok: false as const, reason: '找不到這件家具。' }
    const r = check({ ...cur, x, y, rot })
    if (r.ok) Object.assign(cur, { x, y, rot })
    return r
  }
  function remove(uid: string) { const i = placed.value.findIndex(p => p.uid === uid); if (i >= 0) placed.value.splice(i, 1) }
  function furnitureAt(p: Point) { return placed.value.find(f => cellsOf(f, FURNITURE[f.def]).some(c => c.x === p.x && c.y === p.y)) ?? null }
  /** 換樓層：你站在那一層的大門 */
  function setFloor(f: Floor) {
    if (f === 'shop' && tier.value < 3) return
    floor.value = f
    const me = people.value.find(p => p.id === 'me')
    if (me) me.pos = map.value.entrance()
  }
  function upgrade() { if (tier.value < maxTier.value) tier.value = (tier.value + 1) as 2 | 3 }
  /** 升到三級：選店面的種類（頂讓 10,000＋裝潢） */
  function openShop(kind: ShopKind) { tier.value = 3; shop.kind = kind; setFloor('shop') }
  /**
   * 搬家（DOWNTIME 7.2 節，第四版每一處都有圖）：家具與箱子裡的東西跟著走，店面的裝潢搬不走；新住處從它的起始等級開始。
   * 在新的圖上原位擺得下的家具照原位，擺不下的打包回背包（回傳它們的家具 id）；浴廁的固定設備每一處自己有。
   */
  function moveTo(id: string): string[] {
    const r = RESIDENCES.find(x => x.id === id)
    if (!r || !r.layout) return []
    residence.value = id
    tier.value = Math.max(r.tiers[0], Math.min(tier.value, r.tiers[1])) as 1 | 2 | 3
    if (tier.value < 3) { shop.kind = null; floors.shop = [] }
    floor.value = 'up'
    safehouses.value = safehouses.value.filter(s => s !== id)
    const m = new HomeMap(layoutFor(id, tier.value))
    const keep: PlacedFurniture[] = [], boxed_: string[] = []
    for (const f of floors.up) {
      if (FURNITURE[f.def].fixed) continue
      const ok = validatePlacement(m, FURNITURE, keep, f, { people: [], roomUse: {} }).ok
      if (ok) keep.push(f); else boxed_.push(f.def)
    }
    // 浴廁的淋浴間：放在新住處浴廁的第一格
    const by = m.layout.rows.findIndex(row => row.includes('B'))
    if (by >= 0) keep.push({ uid: `f${seq++}`, def: 'shower', x: m.layout.rows[by].indexOf('B'), y: by, rot: 0 })
    floors.up = keep
    boxed.value.push(...boxed_)
    const me = people.value.find(p => p.id === 'me')
    if (me) me.pos = m.entrance()
    for (const p of people.value) if (p.id !== 'me') p.pos = m.entrance()
    return boxed_
  }
  /** 把一件打包的家具擺出來 */
  function placeBoxed(i: number, x: number, y: number, rot: Rotation) {
    const def = boxed.value[i]
    if (!def) return { ok: false as const, reason: '沒有這件。' }
    const r = place(def, x, y, rot)
    if (r.ok) boxed.value.splice(i, 1)
    return r
  }
  function addSafehouse(id: string) { if (safehouses.value.length < 2 && !safehouses.value.includes(id) && id !== residence.value) safehouses.value.push(id) }
  function dropSafehouse(id: string) { safehouses.value = safehouses.value.filter(s => s !== id) }

  // ---- 存檔（第 3 版起家園跟著存檔與快照走） ----
  function serialize() {
    return JSON.parse(JSON.stringify({ tier: tier.value, residence: residence.value, floors, chosen, people: people.value, staff: staff.value, shop, safehouses: safehouses.value, boxed: boxed.value }))
  }
  function hydrate(d: Record<string, unknown> | null | undefined) {
    if (!d || typeof d !== 'object') return
    const v = d as ReturnType<typeof serialize>
    if (v.tier === 1 || v.tier === 2 || v.tier === 3) tier.value = v.tier
    if (typeof v.residence === 'string') residence.value = v.residence
    if (Array.isArray(v.boxed)) boxed.value = [...v.boxed]
    if (v.floors) { floors.up = structuredClone(v.floors.up ?? []); floors.shop = structuredClone(v.floors.shop ?? []) }
    if (v.chosen) { for (const k of Object.keys(chosen)) delete chosen[k]; Object.assign(chosen, v.chosen) }
    if (Array.isArray(v.people)) people.value = structuredClone(v.people)
    if (Array.isArray(v.staff)) staff.value = structuredClone(v.staff)
    if (v.shop) Object.assign(shop, v.shop)
    if (Array.isArray(v.safehouses)) safehouses.value = [...v.safehouses]
    if (floor.value === 'shop' && tier.value < 3) floor.value = 'up'
  }

  return {
    tier, residence, boxed, placeBoxed, maxTier, floor, floors, placed, chosen, people, staff, shop, safehouses, map, rooms, comfortInfo, storageInfo, residents, sleepers, caps, grid, visible,
    check, place, move, remove, furnitureAt, setFloor, upgrade, openShop, moveTo, addSafehouse, dropSafehouse, serialize, hydrate,
  }
})
