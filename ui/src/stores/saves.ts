import { defineStore } from 'pinia'
import { ref } from 'vue'
import { useGame } from './game'
import { useEngine } from './engine'
import { packBundle, unpackBundle } from '../lib/engineSave'

/**
 * 存檔的格子（localStorage）。設定的「存檔」分頁與「讀檔與存檔」對話框共用這一份，所以兩邊看到的是同一組格子。
 * 存的是引擎存檔加上還沒搬進引擎的資料（lib/engineSave.ts）。換到引擎存檔之後用新的鍵；舊的假存檔格子（cpp-ui-saves-v1、cpp-ui-autosaves-v2）
 * 作廢：不讀、也不刪（資料還在瀏覽器裡）。
 */
const SAVE_KEY = 'cpp-engine-saves-v1'
const AUTO_KEY = 'cpp-engine-autosaves-v1'
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
  const e = useEngine()
  /** 這一局打包成一份存檔的文字 */
  const pack = (kind: '手動' | '自動'): { raw: string; label: string; savedAt: string } => {
    const meta = g.saveMeta(kind)
    return { raw: packBundle(e.save(), g.serialize() as unknown as Record<string, unknown>, meta), label: meta.label, savedAt: meta.savedAt }
  }
  const slots = ref<Array<SlotEntry | null>>(read(SAVE_KEY, 3))
  const autos = ref<Array<SlotEntry | null>>(read(AUTO_KEY, 2))
  function persist(key: string, v: unknown): boolean {
    try { localStorage.setItem(key, JSON.stringify(v)); return true } catch { return false }
  }
  function saveTo(i: number): string | null {
    const p = pack('手動')
    slots.value[i] = { slot: i, label: p.label, data: p.raw, savedAt: p.savedAt }
    return persist(SAVE_KEY, slots.value) ? null : '這個瀏覽器存不了（私密視窗或空間不夠）。'
  }
  function autosave() {
    const p = pack('自動')
    autos.value = [{ slot: 0, label: p.label, data: p.raw, savedAt: p.savedAt }, autos.value[0]]
    persist(AUTO_KEY, autos.value)
  }
  /** 讀一份存檔的文字（格子裡的或匯入的檔案）。回傳錯誤訊息，成功回傳 null。 */
  function loadRaw(raw: string): string | null {
    const r = unpackBundle(raw)
    if (!r.ok) return r.error
    const err = e.load(r.bundle.engine)
    if (err) return err
    g.hydrate(r.bundle.legacy as unknown as Parameters<typeof g.hydrate>[0])
    return null
  }
  function loadFrom(list: 'slots' | 'autos', i: number): string | null {
    const sv = (list === 'slots' ? slots : autos).value[i]
    if (!sv) return '這一格是空的。'
    return loadRaw(sv.data)
  }
  function remove(i: number) { slots.value[i] = null; persist(SAVE_KEY, slots.value) }
  return { slots, autos, pack, saveTo, autosave, loadRaw, loadFrom, remove }
})
