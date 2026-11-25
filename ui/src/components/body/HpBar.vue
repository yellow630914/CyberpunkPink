<script setup lang="ts">
import { computed } from 'vue'
import TrackBar from '../TrackBar.vue'
import { hpBlur } from '../../lib/bodyView'

/**
 * 生命值的顯示：一般是量條加數字；有痛覺編輯器（blur）時不知道自己快死了，只剩幾格模糊的分段、沒有數字（CYBERWARE 第 3 節）。
 * 分段怎麼分是 lib/bodyView 的 hpBlur（顯示用）。
 */
const props = defineProps<{ hp: number; max: number; blur?: boolean; label?: string }>()
const b = computed(() => hpBlur(props.hp, props.max))
</script>

<template>
  <div v-if="blur" class="hb" data-hp-blur role="img" aria-label="生命值（模糊）" :title="label ?? '生命值：痛覺編輯器讓你只感覺得到大概'">
    <span v-if="label" class="k">{{ label }}</span>
    <i v-for="n in b.segments" :key="n" :class="{ on: n <= b.filled }" />
  </div>
  <TrackBar v-else :value="hp" :max="Math.max(1, max)" color="var(--hp)" :label="label" class="hbar" data-hp />
</template>

<style scoped>
.hb { display: flex; gap: var(--space-2); align-items: center; min-width: 120px; }
.hb i { flex: 1; height: 10px; background: var(--bg-3); border-radius: 3px; filter: blur(1.5px); }
.hb i.on { background: var(--hp); }
.hbar { min-width: 120px; flex: 1; }
</style>
