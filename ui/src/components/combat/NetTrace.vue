<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import TrackBar from '../TrackBar.vue'
import Hint from '../Hint.vue'
import type { TraceBar } from '../../lib/netView'

/**
 * 追蹤度條（內海戰鬥，CYBERSPACE 6.7 節）：刻度在引擎給的三個門檻（預設 30、60、90）；被定位時寫還剩幾輪；每次變動照那一拍的 trace 事件跳一下。
 * 只讀引擎給的數字：現在的值、門檻、定位的倒數都來自 netBattleView；bump 是畫面收到的 trace 事件（n 每次加一，delta 是那一拍加減了多少）。
 */
const props = defineProps<{ bar: TraceBar; bump?: { n: number; delta: number } }>()
const color = computed(() => (props.bar.zone >= 3 ? 'var(--hp)' : props.bar.zone >= 1 ? 'var(--warn)' : 'var(--ram)'))
const pulse = ref<'up' | 'down' | null>(null)
let timer: ReturnType<typeof setTimeout> | null = null
watch(() => props.bump?.n, () => {
  if (!props.bump?.delta) return
  pulse.value = props.bump.delta > 0 ? 'up' : 'down'
  if (timer) clearTimeout(timer)
  timer = setTimeout(() => { pulse.value = null }, 700)
})
</script>

<template>
  <div class="trace" :class="[`z${bar.zone}`, pulse && `pulse-${pulse}`]" data-trace :data-value="bar.value">
    <span class="k">追蹤度</span><b class="mono" data-trace-value>{{ bar.value }}</b>
    <span v-if="bump?.delta && pulse" class="mono delta" :class="bump.delta > 0 ? 'up' : 'down'" data-trace-delta>{{ bump.delta > 0 ? '+' : '−' }}{{ Math.abs(bump.delta) }}</span>
    <div class="bar"><TrackBar :value="Math.min(100, bar.value)" :max="100" :color="color" :marks="bar.marks" /></div>
    <span v-if="bar.located !== null" class="tag warn" data-located>{{ bar.located > 0 ? `定位倒數 ${bar.located} 輪` : '已經被定位' }}</span>
    <Hint title="追蹤度">戰鬥每過一回合往上加。第一道刻度系統起疑（一隻白蕾絲加入、閘門更難破解），第二道現實的保全進入警戒、對方的潛網者或精英蕾絲加入，第三道被定位並開始倒數，倒數完全隊被強制斷線。管理行動與失敗的檢定也會加。</Hint>
  </div>
</template>

<style scoped>
.trace { display: flex; align-items: center; gap: var(--space-3); min-width: 220px; flex: 1 1 280px; max-width: 420px; }
.bar { flex: 1; min-width: 80px; }
.trace.pulse-up b, .trace.pulse-up .delta { animation: bump .7s ease-out; }
.trace.pulse-down b { animation: bump-down .7s ease-out; }
.delta.up { color: var(--hp); }
.delta.down { color: var(--ok); }
.delta { font-weight: 900; font-size: var(--fs-sm); }
@keyframes bump { 0% { transform: scale(1.7); color: var(--hp); } 100% { transform: scale(1); } }
@keyframes bump-down { 0% { transform: scale(1.4); color: var(--ok); } 100% { transform: scale(1); } }
@media (prefers-reduced-motion: reduce) { .trace b, .trace .delta { animation: none !important; } }
@media (max-width: 720px) { .trace { flex-basis: 100%; max-width: none; } }
</style>
