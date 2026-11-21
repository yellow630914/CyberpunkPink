import { ref, onBeforeUnmount } from 'vue'
import type { Point } from '../data/types'
import { findPath, type Passable } from './grid'

/**
 * 點格子移動：算最短路，然後一格一格走（每一步呼叫 step）。走到時呼叫 arrive。
 * 走路中再點別的地方，從目前的位置重新算。
 */
export function useWalk(opts: { grid: () => Passable; pos: () => Point; step: (p: Point) => void; ms?: number }) {
  const path = ref<Point[]>([])
  let timer: ReturnType<typeof setInterval> | null = null
  function stop() { if (timer) clearInterval(timer); timer = null; path.value = [] }
  function walkTo(target: Point, arrive?: () => void): boolean {
    stop()
    const p = findPath(opts.grid(), opts.pos(), target)
    if (!p) return false
    path.value = p.slice(1)
    if (!path.value.length) { arrive?.(); return true }
    timer = setInterval(() => {
      const next = path.value.shift()
      if (!next) { stop(); arrive?.(); return }
      opts.step(next)
      if (!path.value.length) { stop(); arrive?.() }
    }, opts.ms ?? 110)
    return true
  }
  onBeforeUnmount(stop)
  return { path, walkTo, stop }
}
