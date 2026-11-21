<script setup lang="ts">
/** 分頁（斜切角的頁簽）。手機上可以橫向捲動，不撐開整頁。 */
defineProps<{ tabs: Array<{ id: string; label: string; dot?: boolean; disabled?: boolean }>; modelValue: string }>()
defineEmits<{ (e: 'update:modelValue', v: string): void; (e: 'blocked', id: string): void }>()
</script>

<template>
  <div class="tabs" role="tablist">
    <button v-for="t in tabs" :key="t.id" type="button" role="tab" class="tab" :class="{ on: t.id === modelValue }" :aria-selected="t.id === modelValue" :aria-disabled="t.disabled || undefined" @click="t.disabled ? $emit('blocked', t.id) : $emit('update:modelValue', t.id)">
      {{ t.label }}<i v-if="t.dot" class="dot" />
    </button>
  </div>
</template>

<style scoped>
.tabs { display: flex; gap: 4px; overflow-x: auto; scrollbar-width: thin; min-width: 0; }
.tab { flex: none; font-weight: 800; font-size: var(--fs-sm); padding: 8px 16px; background: var(--bg-2); color: var(--ink-3); border: 0; cursor: pointer; position: relative; clip-path: polygon(0 0, calc(100% - 8px) 0, 100% 8px, 100% 100%, 0 100%); }
.tab.on { background: var(--a); color: var(--on-a); }
.dot { display: inline-block; width: 8px; height: 8px; margin-left: 6px; vertical-align: 2px; border-radius: 50%; background: var(--danger); }
[data-skin="net"] .tab { box-shadow: inset 0 0 0 2px var(--o); }
</style>
