import { defineStore } from 'pinia'
import { ref, computed } from 'vue'

/**
 * 對話框層（UI 規則 2）：對話框疊在全頁上，關掉回到原處；Esc 關最上面那一個；最多疊一層（同時兩個）。
 * 已經疊了一層時再開第三個，取代最上面那一個。
 */
export type DialogName = 'bag' | 'character' | 'talk' | 'shop' | 'settings'
export interface DialogEntry { id: number; name: DialogName; props: Record<string, unknown> }

export const DIALOG_TITLES: Record<DialogName, string> = {
  bag: '背包', character: '角色與義體', talk: '和 NPC 說話', shop: '商店', settings: '設定',
}

/** 還沒做的對話框：工具列上灰掉，點了說原因（UI.md 第 1 節原則 4） */
export const PENDING_DIALOGS = ['名冊', '關係', '技能樹', '組裝', '頻道', '契約', '帳單', '指南', '讀檔與存檔', '備忘錄'] as const

export const useUi = defineStore('ui', () => {
  const stack = ref<DialogEntry[]>([])
  const toasts = ref<Array<{ id: number; text: string; kind: 'info' | 'warn' }>>([])
  let seq = 1

  const top = computed(() => stack.value[stack.value.length - 1] ?? null)

  function open(name: DialogName, props: Record<string, unknown> = {}) {
    const entry = { id: seq++, name, props }
    if (stack.value.length >= 2) stack.value.splice(stack.value.length - 1, 1, entry)
    else stack.value.push(entry)
  }
  /** 從頭開：關掉現有的，再開這一個（工具列用） */
  function openRoot(name: DialogName, props: Record<string, unknown> = {}) {
    stack.value = [{ id: seq++, name, props }]
  }
  function close(id?: number) {
    if (id === undefined) stack.value.pop()
    else stack.value = stack.value.filter(d => d.id !== id)
  }
  function closeAll() { stack.value = [] }
  function toast(text: string, kind: 'info' | 'warn' = 'info') {
    const id = seq++
    toasts.value.push({ id, text, kind })
    setTimeout(() => { toasts.value = toasts.value.filter(t => t.id !== id) }, 2600)
  }
  return { stack, top, toasts, open, openRoot, close, closeAll, toast }
})
