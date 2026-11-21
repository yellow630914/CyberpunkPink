import { computed, onBeforeUnmount, onMounted, ref, shallowRef, triggerRef, type Ref } from 'vue'
import { reactive } from 'vue'
import { combatKey, isTyping } from './keys'
import { sameTarget, type Phase, type Target } from './combat/field'
import { useUi } from '../stores/ui'

/**
 * 戰鬥畫面的驅動（現實與內海共用）：回合的節奏（敵人一步一步動、過載的人跳過）、選目標（Tab 換、Enter 確定）、
 * 數字鍵、空白鍵。戰鬥的規則都在 lib/combat/；這裡只管時間與按鍵。speed 是延遲的倍率（0 是立刻，測試用 ?fast=1）。
 */
export interface Drivable {
  start(): Phase
  endTurn(): Phase
  aiStep(): boolean
  end: unknown
  mode: string | null
  targets(): Target[]
  pick(t: Target): boolean
}
export function useBattle<B extends Drivable>(make: () => B, opts: { speed: () => number; onRing: (i: number) => void; canKey?: () => boolean }) {
  const ui = useUi()
  const b = shallowRef<B>(reactive(make()) as B)
  const phase = ref<Phase>('player')
  const focus = ref(0)
  let timer: ReturnType<typeof setTimeout> | null = null
  const later = (fn: () => void, ms: number) => { if (timer) clearTimeout(timer); timer = setTimeout(() => { timer = null; fn() }, ms * opts.speed()) }

  function run(p: Phase) {
    phase.value = p
    focus.value = 0
    if (p === 'enemy') later(aiTick, 550)
    else if (p === 'skip') later(() => run(b.value.endTurn()), 500)
  }
  function aiTick() {
    if (b.value.aiStep()) later(aiTick, 650)
    else run(b.value.endTurn())
  }
  function endTurn() { if (phase.value === 'player' && !b.value.end) run(b.value.endTurn()) }
  /** 玩家做完一個動作之後：戰鬥可能結束了 */
  function after() { if (b.value.end) phase.value = 'over'; focus.value = 0 }
  function restart() {
    if (timer) clearTimeout(timer)
    b.value = reactive(make()) as B
    triggerRef(b)
    run(b.value.start())
  }
  const targets = computed<Target[]>(() => b.value.targets())
  const focused = computed<Target | null>(() => { const t = targets.value; return t.length ? t[((focus.value % t.length) + t.length) % t.length] : null })
  const isFocused = (t: Target) => !!focused.value && sameTarget(focused.value, t)
  function pick(t: Target) { if (phase.value !== 'player') return false; const ok = b.value.pick(t); after(); return ok }

  function onKey(e: KeyboardEvent) {
    if (e.defaultPrevented) return
    if (opts.canKey && !opts.canKey()) return
    const el = e.target as HTMLElement | null
    // 空白鍵一律結束回合（長按的按鈕除外）；沒在選目標時，焦點在按鈕上的 Enter 交給那個按鈕
    if (e.key === ' ' && el?.closest?.('.hold, select')) return
    if (e.key === 'Enter' && !b.value.mode && el?.closest?.('button, [role="button"], a')) return
    if (e.key === 'Enter' && el?.closest?.('[data-unit], [data-slot], [data-cell]')) return
    const a = combatKey(e, { typing: isTyping(e.target), dialogOpen: ui.stack.length > 0, targeting: !!b.value.mode })
    if (!a) return
    if (a.type === 'cycle' && !b.value.mode) return
    e.preventDefault()
    if (phase.value !== 'player') return
    if (a.type === 'ring') opts.onRing(a.i)
    else if (a.type === 'end') endTurn()
    else if (a.type === 'cycle') focus.value += a.dir
    else if (a.type === 'confirm') { if (focused.value) pick(focused.value) }
    else if (a.type === 'cancel') b.value.mode = null
  }
  onMounted(() => { window.addEventListener('keydown', onKey, true); run(b.value.start()) })
  onBeforeUnmount(() => { window.removeEventListener('keydown', onKey, true); if (timer) clearTimeout(timer) })
  return { b: b as Ref<B>, phase, focus, focused, isFocused, targets, run, endTurn, after, restart, pick }
}
