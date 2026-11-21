<script setup lang="ts">
import { onBeforeUnmount, ref } from 'vue'

/**
 * 彈幕層（MEDIA 1.2 節）：疊在戰場上，字從右往左飄過整個戰場，不擋點擊。
 * 內海戰鬥與現實戰鬥共用：畫面呼叫 push(字)；分道避免疊字，同時最多 12 條。
 */
interface Fly { id: number; text: string; lane: number; dur: number; kind?: 'gift' | 'hot' }
const LANES = 8
const items = ref<Fly[]>([])
const laneFree = Array(LANES).fill(0)
let seq = 1
const timers = new Set<ReturnType<typeof setTimeout>>()

function push(text: string, kind?: Fly['kind']) {
  if (items.value.length >= 12) return
  const now = Date.now()
  // 先找已經空出來的道，沒有就找最早空的
  let lane = laneFree.findIndex(t => t <= now)
  if (lane < 0) lane = laneFree.indexOf(Math.min(...laneFree))
  const dur = 6 + Math.random() * 2.5
  laneFree[lane] = now + 1600 + text.length * 120
  const f: Fly = { id: seq++, text, lane, dur, kind }
  items.value.push(f)
  const t = setTimeout(() => { items.value = items.value.filter(x => x.id !== f.id); timers.delete(t) }, (dur + 0.5) * 1000)
  timers.add(t)
}
onBeforeUnmount(() => timers.forEach(clearTimeout))
defineExpose({ push })
</script>

<template>
  <div class="dm" aria-hidden="true" data-danmaku>
    <span v-for="f in items" :key="f.id" :class="f.kind" :style="{ top: `calc(${(f.lane / LANES) * 100}% + 6px)`, animationDuration: `${f.dur}s` }">{{ f.text }}</span>
  </div>
</template>

<style scoped>
.dm { position: absolute; inset: 0; pointer-events: none; overflow: hidden; z-index: 3; }
.dm span { position: absolute; left: 100%; white-space: nowrap; font: 900 var(--fs-md) var(--font); color: var(--ink); opacity: .92; text-shadow: 0 0 2px var(--bg-1), 0 0 4px var(--bg-1), 0 0 8px var(--bg-1); animation: fly linear forwards; will-change: transform; }
.dm span.gift { color: var(--g5, var(--a)); }
.dm span.hot { color: var(--a); font-size: var(--fs-lg); }
@keyframes fly { to { transform: translateX(calc(-100vw - 100%)); } }
@media (prefers-reduced-motion: reduce) { .dm span { animation-duration: 12s !important; } }
@media (max-width: 760px) { .dm span { font-size: var(--fs-xs); } .dm span.hot { font-size: var(--fs-md); } }
</style>
