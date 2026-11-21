<script setup lang="ts">
import { computed } from 'vue'
/** 0～上限的量條（生命、感載、沉溺、追蹤度……）。marks 畫門檻刻度。 */
const props = defineProps<{ value: number; max: number; color: string; label?: string; marks?: number[]; striped?: boolean; height?: number }>()
const pct = computed(() => Math.max(0, Math.min(100, (props.value / props.max) * 100)))
</script>

<template>
  <div class="tb">
    <div v-if="label" class="lab"><span>{{ label }}</span><span class="mono">{{ value }} / {{ max }}</span></div>
    <div class="tr" :style="{ height: (height ?? 8) + 'px' }" role="meter" :aria-valuenow="value" :aria-valuemin="0" :aria-valuemax="max" :aria-label="label">
      <b :class="{ striped }" :style="{ width: pct + '%', background: striped ? undefined : color, '--c': color }" />
      <i v-for="m in marks ?? []" :key="m" class="mark" :style="{ left: (m / max) * 100 + '%' }" />
    </div>
  </div>
</template>

<style scoped>
.lab { display: flex; justify-content: space-between; font-size: var(--fs-xs); color: var(--ink-3); font-weight: 800; margin-bottom: 3px; }
.tr { border-radius: 4px; background: #2E2339; position: relative; overflow: hidden; }
[data-skin="net"] .tr { background: var(--bg-2); box-shadow: inset 0 0 0 2px var(--o); }
.tr b { position: absolute; inset: 0 auto 0 0; border-radius: 4px; transition: width var(--dur); }
.tr b.striped { background: repeating-linear-gradient(120deg, var(--c) 0 6px, color-mix(in srgb, var(--c) 70%, #fff) 6px 9px); box-shadow: 0 0 8px var(--c); }
.mark { position: absolute; top: 0; bottom: 0; width: 2px; background: var(--ink-3); opacity: .8; }
</style>
