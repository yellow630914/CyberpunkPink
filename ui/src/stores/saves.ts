import { defineStore } from 'pinia'
import { ref } from 'vue'
import { useGame } from './game'
import { unpackSave } from '../lib/save'

/**
 * 存檔的格子（localStorage）。設定的「存檔」分頁與「讀檔與存檔」對話框共用這一份，所以兩邊看到的是同一組格子。
 * 鍵沿用第一版的 cpp-ui-saves-v1；第一版存的格子照樣讀得回來（lib/save.ts 認得舊格式）。
 */
const SAVE_KEY = 'cpp-ui-saves-v1'
const AUTO_KEY = 'cpp-ui-autosaves-v2'
export interface SlotEntry { slot: number; label: string; data: string; savedAt?: string }

function read(key: string, n: number): Array<SlotEntry | null> {
  try {
    const raw = localStorage.getItem(key)
    if (raw) { const a = JSON.parse(raw); if (Array.isArray(a)) return Array.from({ length: n }, (_, i) => a[i] ?? null) }
  } catch { /* 讀不到就當沒有 */ }
  return Array.from({ length: n }, () => null)
}

export const useSaves = defineStore('saves', () => {
  const g = useGame()
  const slots = ref<Array<SlotEntry | null>>(read(SAVE_KEY, 3))
  const autos = ref<Array<SlotEntry | null>>(read(AUTO_KEY, 2))
  function persist(key: string, v: unknown): boolean {
    try { localStorage.setItem(key, JSON.stringify(v)); return true } catch { return false }
  }
  function saveTo(i: number): string | null {
    const meta = g.saveMeta('手動')
    slots.value[i] = { slot: i, label: meta.label, data: g.packed('手動'), savedAt: meta.savedAt }
    return persist(SAVE_KEY, slots.value) ? null : '這個瀏覽器存不了（私密視窗或空間不夠）。'
  }
  function autosave() {
    const meta = g.saveMeta('自動')
    autos.value = [{ slot: 0, label: meta.label, data: g.packed('自動'), savedAt: meta.savedAt }, autos.value[0]]
    persist(AUTO_KEY, autos.value)
  }
  /** 讀一份存檔的文字（格子裡的或匯入的檔案）。回傳錯誤訊息，成功回傳 null。 */
  function loadRaw(raw: string): string | null {
    const r = unpackSave<ReturnType<typeof g.serialize>>(raw)
    if (!r.ok) return r.error
    g.hydrate(r.file.state)
    return null
  }
  function loadFrom(list: 'slots' | 'autos', i: number): string | null {
    const sv = (list === 'slots' ? slots : autos).value[i]
    if (!sv) return '這一格是空的。'
    return loadRaw(sv.data)
  }
  function remove(i: number) { slots.value[i] = null; persist(SAVE_KEY, slots.value) }
  return { slots, autos, saveTo, autosave, loadRaw, loadFrom, remove }
})
