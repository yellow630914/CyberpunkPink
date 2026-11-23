import { computed, ref } from 'vue'
import { useEngine } from '../stores/engine'
import { spoilsOf, type Spoils } from './afterBattleView'

/**
 * 打贏之後的面板（戰利品與俘虜）：結算之後 show，看完（俘虜處置完、按離開）dismiss。
 * 只管「面板開不開」；拿到什麼是戰鬥結束那一份報告的內容（spoilsOf），俘虜的選項是事件視窗的（引擎的 eventView）。
 */
export function useAfterBattle() {
  const engine = useEngine()
  const spoils = ref<Spoils | null>(null)
  /** 結算之後呼叫：打贏而且有東西可看（戰報有字、拿到東西、或有事件開著）才開面板。回傳開了沒有 */
  function show(): boolean {
    const s = spoilsOf(engine.state.reports)
    if (!s || s.outcome !== 'win') return false
    if (s.lines.length === 0 && s.items.length === 0 && s.cash === 0 && engine.event.view() === null) return false
    spoils.value = s
    return true
  }
  function dismiss(): void { spoils.value = null }
  /** 現在還不能離開的原因（引擎的事件還開著、成人場景還沒結束）；可以離開是 null */
  const holdReason = computed<string | null>(() => {
    if (engine.event.view() !== null) return '眼前的事還沒處理完。'
    if (engine.sceneGate.active()) return '成人場景還沒結束。'
    return null
  })
  return { spoils, show, dismiss, holdReason }
}
