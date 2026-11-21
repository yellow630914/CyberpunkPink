import { defineStore } from 'pinia'
import { reactive, watch } from 'vue'
import { copyPreset, type DiffTable } from '../lib/difficulty'
import { aiSettingsFromUi, uiFromAiSettings } from '../lib/engineView'
import { useEngine } from './engine'

/**
 * 設定（UI.md 第 15 節）。「顯示」那一頁是這台機器的偏好，存在 localStorage；
 * 存檔規則與內容篩選跟著存檔走，這裡只是假資料。
 */
const KEY = 'cpp-ui-settings-v1'
/** AI 設定的儲存鍵：引擎的形狀（cpp-ai-v1，蛇形欄位、開關是 0／1）。舊鍵只在第一次讀一次，之後只讀寫這個鍵。 */
const AI_KEY = 'cpp-ai-v1'

const defaults = {
  // AI 開關
  useAi: true, judgeFree: true, judgeShift: true, judgeEvent: true, narrate: true, polish: false, clampRequested: true, agentMode: false,
  // 內容篩選（LEWD_SYSTEM 第 9 節的一部分）
  filterRestraint: true, filterDollChip: true, filterPublic: true, filterContract: true,
  /** 身體的私密描寫：建角的「私處」與角色的成人分頁（第三版） */
  filterIntimateBody: true,
  // 遊戲
  difficulty: '普通' as '故事' | '簡單' | '普通' | '困難' | '傳奇' | '自訂',
  /** 自訂難度的係數表（BALANCE 7.3 節）；選自訂時從一個預設複製 */
  customDiff: copyPreset('普通') as DiffTable,
  billRule: '標準' as '關閉' | '寬鬆' | '標準' | '嚴苛',
  /** 帳單倍率 ×0～2（FIXER 第 4 節）；選快捷檔位時一起設好 */
  billMult: 1,
  xpMult: 1,
  moneyMult: 1,
  traitPoints: 4,
  defeatView: '一律看' as '一律看' | '可以跳過' | '不看',
  defeatTakeGear: true,
  extraAccessory: false,
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
  // AI 工坊（PROMPTS 2.14 節）：設定裡也有的項目和這裡是同一個值
  tradeProse: true,
  combatProse: '結束時整場寫一次' as '結束時整場寫一次' | '每回合一小段',
  aiRecord: { sexRecord: true, todayGoods: true, newPeople: true, npcNews: true, streamGoal: true, danmaku: true, footageTitle: true } as Record<string, boolean>,
  onlyQuery: false,
  hooks: { agent_hook: true, agent_event: true, agent_night: true, agent_commission: true, agent_flavor: true } as Record<string, boolean>,
  hookLimits: { event: 3, hook: 1, other: 10 },
  retries: 1,
  chainRow: '出錯時展開' as '出錯時展開' | '一直展開' | '隱藏',
  /** 每個任務用哪個來源（AI_TASKS 第 4 節的 30 個任務） */
  taskSource: {} as Record<string, string>,
  promptSet: '預設組',
}
export type Settings = typeof defaults

function load(): Settings {
  try {
    const raw = localStorage.getItem(KEY)
    if (raw) {
      const v = { ...structuredClone(defaults), ...JSON.parse(raw) } as Settings
      // 第四版：難度照 BALANCE 的名字（原本「輕鬆」「殘酷」）
      const OLD: Record<string, Settings['difficulty']> = { 輕鬆: '簡單', 殘酷: '傳奇' }
      if (OLD[v.difficulty as string]) v.difficulty = OLD[v.difficulty as string]
      return withAi(v)
    }
  } catch { /* 私密視窗或被擋：用預設值 */ }
  return withAi(structuredClone(defaults))
}

/** AI 欄位以新鍵為準；新鍵還沒有時，用目前的值（來自舊鍵或預設）轉一次寫進去。 */
function withAi(v: Settings): Settings {
  try {
    const raw = localStorage.getItem(AI_KEY)
    if (raw) return { ...v, ...uiFromAiSettings(JSON.parse(raw)) } as Settings
    localStorage.setItem(AI_KEY, JSON.stringify(aiSettingsFromUi(v)))
  } catch { /* 存不了就算了 */ }
  return v
}

export const useSettings = defineStore('settings', () => {
  const s = reactive<Settings>(load())
  const eng = useEngine()
  // AI 開關改了就交給引擎（引擎只收設定物件）
  watch(() => aiSettingsFromUi(s), () => eng.setAi(s), { immediate: true })
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
    try {
      localStorage.setItem(KEY, JSON.stringify(s))
      localStorage.setItem(AI_KEY, JSON.stringify(aiSettingsFromUi(s)))
    } catch { /* 存不了就算了 */ }
  }, { deep: true })
  function reset() { Object.assign(s, structuredClone(defaults)) }
  function isDefault<K extends keyof Settings>(k: K) { return JSON.stringify(s[k]) === JSON.stringify(defaults[k]) }
  return { s, apply, reset, isDefault, defaults }
})
