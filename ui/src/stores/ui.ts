import { defineStore } from 'pinia'
import { ref, computed, shallowRef } from 'vue'
import type { Point } from '../data/types'

/**
 * 對話框層（UI 規則 2）：對話框疊在全頁上，關掉回到原處；Esc 關最上面那一個；最多疊一層（同時兩個）。
 * 已經疊了一層時再開第三個，取代最上面那一個。
 */
export type DialogName =
  | 'bag' | 'character' | 'talk' | 'shop' | 'settings'
  | 'roster' | 'relations' | 'skills' | 'craft' | 'channel' | 'contract' | 'bills' | 'guide' | 'memo' | 'pending' | 'saves' | 'city' | 'transit'
export interface DialogEntry { id: number; name: DialogName; props: Record<string, unknown> }

export const DIALOG_TITLES: Record<DialogName, string> = {
  bag: '背包', character: '角色與義體', talk: '和 NPC 說話', shop: '商店', settings: '設定',
  roster: '名冊', relations: '關係', skills: '技能樹', craft: '組裝', channel: '頻道', contract: '契約', bills: '每週帳單',
  guide: '指南', memo: '備忘錄', pending: '待處理', saves: '讀檔與存檔', city: '城市地圖', transit: '搭車',
}
/** 這一頁可以走的格子地圖（GridMap 掛上時登記）：全域的方向鍵、WASD、E 與螢幕上的方向鈕都送到這裡。 */
export interface Mover { step: (d: Point) => void; interact: () => void }

/** 還沒做的對話框：工具列上灰掉，點了說原因（UI.md 第 1 節原則 4）。第二版全部做了。 */
export const PENDING_DIALOGS: readonly string[] = []

export const useUi = defineStore('ui', () => {
  const stack = ref<DialogEntry[]>([])
  const toasts = ref<Array<{ id: number; text: string; kind: 'info' | 'warn' }>>([])
  let seq = 1
  /** 系統選單（狀態列右上）：Esc 在沒有對話框時打開它 */
  const menuOpen = ref(false)
  const mover = shallowRef<Mover | null>(null)
  function setMover(m: Mover | null) { mover.value = m }

  const top = computed(() => stack.value[stack.value.length - 1] ?? null)

  function open(name: DialogName, props: Record<string, unknown> = {}) {
    const entry = { id: seq++, name, props }
    if (stack.value.length >= 2) stack.value.splice(stack.value.length - 1, 1, entry)
    else stack.value.push(entry)
  }
  /** 從頭開：關掉現有的，再開這一個（工具列用） */
  function openRoot(name: DialogName, props: Record<string, unknown> = {}) {
    menuOpen.value = false
    stack.value = [{ id: seq++, name, props }]
  }
  function close(id?: number) {
    if (id === undefined) stack.value.pop()
    else stack.value = stack.value.filter(d => d.id !== id)
  }
  function closeAll() { stack.value = []; menuOpen.value = false }
  function toast(text: string, kind: 'info' | 'warn' = 'info') {
    const id = seq++
    toasts.value.push({ id, text, kind })
    setTimeout(() => { toasts.value = toasts.value.filter(t => t.id !== id) }, 2600)
  }
  return { stack, top, toasts, open, openRoot, close, closeAll, toast, menuOpen, mover, setMover }
})
