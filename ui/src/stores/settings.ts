import { defineStore } from 'pinia'
import { reactive, watch } from 'vue'

/**
 * 設定（UI.md 第 15 節）。「顯示」那一頁是這台機器的偏好，存在 localStorage；
 * 存檔規則與內容篩選跟著存檔走，這裡只是假資料。
 */
const KEY = 'cpp-ui-settings-v1'

const defaults = {
  // AI 開關
  useAi: true, judgeFree: true, judgeShift: true, judgeEvent: true, narrate: true, polish: false, clampRequested: true, agentMode: false,
  // 內容篩選（LEWD_SYSTEM 第 9 節的一部分）
  filterRestraint: true, filterDollChip: true, filterPublic: true, filterContract: true,
  // 遊戲
  difficulty: '普通' as '故事' | '輕鬆' | '普通' | '困難' | '殘酷' | '自訂',
  billRule: '標準' as '寬鬆' | '標準' | '嚴苛',
  rosterDeath: false,
  fastTravel: true,
  // 顯示
  fontSize: 'normal' as 'small' | 'normal' | 'large',
  proseFont: '黑體' as '黑體' | '宋體',
  reduceMotion: false,
  neon: '標準' as '關' | '弱' | '標準',
  districtAccent: true,
  foldAdult: false,
  guidePopups: true,
}
export type Settings = typeof defaults

function load(): Settings {
  try {
    const raw = localStorage.getItem(KEY)
    if (raw) return { ...defaults, ...JSON.parse(raw) }
  } catch { /* 私密視窗或被擋：用預設值 */ }
  return { ...defaults }
}

export const useSettings = defineStore('settings', () => {
  const s = reactive<Settings>(load())
  function apply() {
    const root = document.documentElement
    root.dataset.fontSize = s.fontSize
    root.dataset.reduceMotion = String(s.reduceMotion)
    root.dataset.accent = s.districtAccent ? 'on' : 'off'
    root.dataset.neon = s.neon
    root.dataset.proseFont = s.proseFont === '宋體' ? 'serif' : 'sans'
  }
  watch(s, () => {
    apply()
    try { localStorage.setItem(KEY, JSON.stringify(s)) } catch { /* 存不了就算了 */ }
  }, { deep: true })
  function reset() { Object.assign(s, defaults) }
  function isDefault<K extends keyof Settings>(k: K) { return s[k] === defaults[k] }
  return { s, apply, reset, isDefault, defaults }
})
