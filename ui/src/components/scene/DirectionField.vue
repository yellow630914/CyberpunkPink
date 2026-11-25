<script setup lang="ts">
import { computed } from 'vue'
import Hint from '../Hint.vue'
import { DIRECTION_LIMIT, directionCount } from '../../lib/scene/sceneView'

/**
 * 「想怎麼發生（選填）」：玩家寫給 AI 的寫法指令（略過的場景、戰鬥結束、戰敗事件各一格）。
 * 最多 200 字、即時字數。玩家寫的字原樣送出：這裡不篩選、不改寫、不提示內容。
 * AI 關著（沒有人會用到）時灰掉並說明；字還是留在格子裡，開 AI 之後就能用。只影響經過與文風，不改結果與數字。
 */
const props = withDefaults(defineProps<{ modelValue: string; live: boolean; label?: string; placeholder?: string; hint?: string }>(), {
  label: '想怎麼發生（選填）', placeholder: '想怎麼寫就怎麼寫，最多 200 字', hint: '寫給 AI 的寫法指令：照它寫經過與文風。它不會改變結果與任何數字。',
})
const emit = defineEmits<{ (e: 'update:modelValue', v: string): void }>()
const count = computed(() => directionCount(props.modelValue))
function onInput(ev: Event): void {
  // 直接把格子裡的字原樣交出去；超過上限的部分由瀏覽器的 maxlength 擋在格子外（貼上時也一樣），引擎再截一次
  emit('update:modelValue', (ev.target as HTMLTextAreaElement).value)
}
</script>

<template>
  <label class="dir" :class="{ 'is-unavailable': !live }" data-direction>
    <span class="k">{{ label }}<Hint>{{ hint }}</Hint></span>
    <textarea
      class="inp" rows="2" :maxlength="DIRECTION_LIMIT" :value="modelValue" :placeholder="placeholder" :disabled="!live"
      :aria-label="label" data-direction-input @input="onInput"
    />
    <span class="row">
      <small class="cnt mono" :class="{ full: count.left <= 0 }" data-direction-count>{{ count.used }}／{{ DIRECTION_LIMIT }}</small>
      <small v-if="!live" class="why" data-direction-why>AI 關著，這一格不會用到。</small>
    </span>
  </label>
</template>

<style scoped>
.dir { display: grid; gap: 4px; min-width: 0; }
.inp { width: 100%; resize: vertical; background: var(--bg-term); color: var(--ink); border: 0; box-shadow: inset 0 0 0 2px var(--line); padding: 8px 10px; font: 600 var(--fs-md) var(--font); min-height: 3.2em; }
.row { display: flex; gap: var(--space-3); align-items: baseline; flex-wrap: wrap; }
.cnt { color: var(--ink-3); font-size: var(--fs-fine); }
.cnt.full { color: var(--warn); }
.why { color: var(--warn); font-size: var(--fs-fine); }
</style>
