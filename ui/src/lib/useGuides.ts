import { computed } from 'vue'
import { useGame } from '../stores/game'
import { useSettings } from '../stores/settings'
import { useUi } from '../stores/ui'
import { GUIDE_LIST, GUIDE_PAGES } from '../data/content.generated'

/**
 * 指南（UI 3.6 節）：第一次碰到一個系統時收進備忘錄；有內文、而且「跳出指南」開著時跳出來。
 * 內文還沒寫的（GUIDES 只有六張樣板）只收進備忘錄、亮紅點，不跳出空白的指南。
 * 成人的指南只在內容篩選開著對應內容時出現（這一版的篩選沒有成人總開關，所以一律出現）。
 */
export function useGuides() {
  const g = useGame()
  const st = useSettings()
  const ui = useUi()
  const unseen = computed(() => g.guides.collected.filter(id => !g.guides.seen.includes(id)))
  function trigger(id: string) {
    if (!GUIDE_LIST.some(x => x.id === id)) return
    const first = !g.guides.collected.includes(id)
    if (first) g.guides.collected.push(id)
    if (first && st.s.guidePopups && GUIDE_PAGES[id]) ui.open('guide', { guideId: id })
  }
  function markSeen(id: string) { if (!g.guides.seen.includes(id)) g.guides.seen.push(id) }
  return { unseen, trigger, markSeen }
}
