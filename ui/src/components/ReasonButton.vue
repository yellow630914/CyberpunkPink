<script setup lang="ts">
import { useUi } from '../stores/ui'
/**
 * 做不到的按鈕：不設 disabled，點了說出原因（UI.md 第 1 節原則 4）。reason 有值就是不能按。
 */
const props = defineProps<{ reason?: string | null; pri?: boolean; sm?: boolean }>()
const emit = defineEmits<{ (e: 'go'): void }>()
const ui = useUi()
function click() {
  if (props.reason) ui.toast(props.reason, 'warn')
  else emit('go')
}
</script>

<template>
  <button type="button" class="btn" :class="{ pri: pri && !reason, sm }" :aria-disabled="reason ? 'true' : undefined" :title="reason || undefined" @click="click"><slot /></button>
</template>
