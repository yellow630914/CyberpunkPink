<script setup lang="ts">
import { onBeforeUnmount, ref } from 'vue'

/**
 * 要長按才生效的按鈕（COMBAT_SYSTEM 第 10 節：脫離、投降、拔線）：按住約 0.6 秒，按鈕上跑一條進度，放開就取消。
 * 點一下不生效，提示「要長按」。做不到時 reason 有值：灰掉（.is-unavailable），點了說原因。
 */
const props = defineProps<{ reason?: string | null; ms?: number }>()
const emit = defineEmits<{ (e: 'fire'): void; (e: 'hint', text: string): void }>()
const on = ref(false)
let t: ReturnType<typeof setTimeout> | null = null
let fired = false
function go() {
  if (props.reason) return
  on.value = true
  t = setTimeout(() => { t = null; fired = true; on.value = false; emit('fire') }, props.ms ?? 600)
}
function stop() { if (t) { clearTimeout(t); t = null } on.value = false }
function click() {
  if (fired) { fired = false; return }
  emit('hint', props.reason ? `現在做不到：${props.reason}。` : '這個要長按，免得誤觸。')
}
function kd(e: KeyboardEvent) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); e.stopPropagation(); if (!e.repeat) go() } }
function ku(e: KeyboardEvent) { if (e.key === 'Enter' || e.key === ' ') { e.stopPropagation(); stop() } }
onBeforeUnmount(stop)
</script>

<template>
  <button type="button" class="btn hold" :class="{ on }" :aria-disabled="reason ? 'true' : undefined" :title="reason || '長按約 0.6 秒'"
    @pointerdown.prevent="go" @pointerup="stop" @pointerleave="stop" @pointercancel="stop" @contextmenu.prevent @click="click" @keydown="kd" @keyup="ku">
    <slot /><i :style="{ transitionDuration: `${props.ms ?? 600}ms` }" />
  </button>
</template>

<style scoped>
.hold { position: relative; overflow: hidden; color: var(--hp); box-shadow: inset 0 0 0 2px var(--hp); background: transparent; user-select: none; -webkit-user-select: none; touch-action: none; -webkit-touch-callout: none; }
.hold i { position: absolute; left: 0; bottom: 0; height: 4px; width: 0; background: var(--hp); display: block; transition-property: none; }
.hold.on i { width: 100%; transition-property: width; transition-timing-function: linear; }
</style>
