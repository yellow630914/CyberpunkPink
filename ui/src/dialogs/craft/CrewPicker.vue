<script setup lang="ts">
import { computed } from 'vue'
import { useEngine } from '../../stores/engine'

/**
 * 動手的人：主角或隊上的隊友（引擎的 `by`）。一個人的時候不列。
 * 選了誰，預覽與送出的 `by` 就是誰；那個人會不會做、要不要自己會這張圖、擲的檢定都是引擎的預覽說的。
 */
const props = defineProps<{ modelValue: string }>()
const emit = defineEmits<{ (e: 'update:modelValue', v: string): void }>()
const eng = useEngine()
const crew = computed(() => eng.craft.crew())
const current = computed(() => props.modelValue || crew.value.find((c) => c.me)?.id || '')
</script>

<template>
  <div v-if="crew.length > 1" class="crew" role="radiogroup" aria-label="動手的人" data-crew>
    <span class="k">動手的人</span>
    <button v-for="c in crew" :key="c.id" type="button" role="radio" class="mkb" :class="{ on: c.id === current }" :aria-checked="c.id === current" :data-by="c.id" @click="emit('update:modelValue', c.me ? '' : c.id)">{{ c.me ? `${c.name}（你）` : c.name }}</button>
  </div>
</template>

<style scoped>
.crew { display: flex; gap: 5px; flex-wrap: wrap; align-items: center; margin-bottom: var(--space-2); }
.mkb { font-size: var(--fs-sm); font-weight: 800; padding: 6px 12px; background: var(--bg-2); color: var(--ink-3); border: 0; cursor: pointer; border-radius: 6px; }
.mkb.on { background: var(--a); color: var(--on-a); }
</style>
