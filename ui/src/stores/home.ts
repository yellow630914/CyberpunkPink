import { defineStore } from 'pinia'
import { ref, computed, reactive } from 'vue'
import { HomeMap, deriveRooms, comfort, storage, validatePlacement, walkGrid, cellsOf, type PlacedFurniture, type Rotation } from '../lib/home'
import { FURNITURE, TOWER4_LAYOUTS, START_FURNITURE } from '../data/home'
import type { Point } from '../data/types'

/**
 * 家園（DOWNTIME 第 7 節，格子版）：等級決定地圖大小；房間是畫好的區域；家具有佔地、能轉、能搬；
 * 房間的用途由裡面的家具推出來；主角、住戶與訪客在地圖上走。
 */
export const TIER_CAPS: Record<number, { residents: number; staff: number }> = { 0: { residents: 0, staff: 0 }, 1: { residents: 1, staff: 1 }, 2: { residents: 3, staff: 2 }, 3: { residents: 5, staff: 4 } }

export interface HomePerson { id: string; name: string; kind: 'me' | 'ally' | 'visitor'; role: string; pos: Point; sleeps: boolean; room?: string }

export const useHome = defineStore('home', () => {
  const tier = ref<1 | 2>(1)
  const maxTier = 2
  const placed = ref<PlacedFurniture[]>(structuredClone(START_FURNITURE))
  const chosen = reactive<Record<string, string | undefined>>({ M: 'bedroom' })
  const people = ref<HomePerson[]>([
    { id: 'me', name: '你', kind: 'me', role: '屋主', pos: { x: 3, y: 4 }, sleeps: true },
    { id: 'nana', name: '奈奈', kind: 'visitor', role: '訪客・約好了 20:00', pos: { x: 6, y: 2 }, sleeps: false },
  ])
  const staff = ref([{ role: '看門的', who: '孤星連', wage: 200 }])
  let seq = 100

  const map = computed(() => new HomeMap(TOWER4_LAYOUTS[tier.value]))
  const residentRooms = computed(() => people.value.filter(p => p.kind === 'ally' && p.room).map(p => p.room!))
  const rooms = computed(() => deriveRooms(map.value, FURNITURE, placed.value, { chosen, residentRooms: residentRooms.value }))
  const sleepers = computed(() => people.value.filter(p => p.sleeps).length)
  const comfortInfo = computed(() => comfort(FURNITURE, placed.value, rooms.value, { sleepers: sleepers.value, built: 0, peopleBonus: 0 }))
  const storageInfo = computed(() => storage(FURNITURE, rooms.value))
  const residents = computed(() => people.value.filter(p => p.kind === 'ally'))
  const grid = computed(() => {
    const g = walkGrid(map.value, placed.value, FURNITURE)
    return g
  })

  function check(cand: PlacedFurniture, moverId?: string) {
    return validatePlacement(map.value, FURNITURE, placed.value, cand, {
      people: people.value.filter(p => p.id !== moverId).map(p => p.pos),
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
  function remove(uid: string) { placed.value = placed.value.filter(p => p.uid !== uid) }
  function furnitureAt(p: Point) { return placed.value.find(f => cellsOf(f, FURNITURE[f.def]).some(c => c.x === p.x && c.y === p.y)) ?? null }
  function upgrade() { if (tier.value < maxTier) tier.value = 2 }

  return { tier, maxTier, placed, chosen, people, staff, map, rooms, comfortInfo, storageInfo, residents, sleepers, grid, check, place, move, remove, furnitureAt, upgrade }
})
