<script setup lang="ts">
import { ref, nextTick, onBeforeUnmount } from 'vue'

/**
 * 「?」提示（UI 規則 5）：畫面上只放名字、數字與狀態，說明都收在這裡。
 * 桌面滑過就出現，手機點一下打開、再點或點外面關掉。內容用 slot 或 text。
 * 擋住操作的警告（格式錯誤、「這一步會失去夥伴」）不放這裡，直接顯示。
 */
const props = defineProps<{ text?: string; title?: string }>()
const open = ref(false)
const pinned = ref(false)
const btn = ref<HTMLButtonElement | null>(null)
const pop = ref<HTMLDivElement | null>(null)
const pos = ref({ left: 0, top: 0, width: 280 })
const id = `hint-${Math.random().toString(36).slice(2, 8)}`

async function place() {
  const b = btn.value?.getBoundingClientRect()
  if (!b) return
  const vw = window.innerWidth, vh = window.innerHeight
  const width = Math.min(300, vw - 24)
  let left = b.left + b.width / 2 - width / 2
  left = Math.max(12, Math.min(left, vw - width - 12))
  pos.value = { left, top: b.bottom + 8, width }
  await nextTick()
  const h = pop.value?.offsetHeight ?? 0
  if (b.bottom + 8 + h > vh - 8 && b.top - 8 - h > 8) pos.value = { left, top: b.top - 8 - h, width }
}
function show() { open.value = true; place() }
function hide() { if (!pinned.value) open.value = false }
const fine = typeof window !== 'undefined' && window.matchMedia?.('(hover: hover) and (pointer: fine)').matches
function enter() { if (fine) show() }
function leave() { if (fine) hide() }
function toggle(e: Event) {
  e.stopPropagation()
  if (pinned.value) { pinned.value = false; open.value = false; return }
  pinned.value = true
  show()
  setTimeout(() => document.addEventListener('pointerdown', outside, { once: true }), 0)
}
function outside(e: Event) {
  if (pop.value?.contains(e.target as Node) || btn.value?.contains(e.target as Node)) {
    document.addEventListener('pointerdown', outside, { once: true }); return
  }
  pinned.value = false; open.value = false
}
function key(e: KeyboardEvent) { if (e.key === 'Escape' && open.value) { e.stopPropagation(); pinned.value = false; open.value = false } }
onBeforeUnmount(() => document.removeEventListener('pointerdown', outside))
void props
</script>

<template>
  <span class="hint-wrap" @mouseenter="enter" @mouseleave="leave">
    <button ref="btn" type="button" class="hint" :aria-expanded="open" :aria-describedby="open ? id : undefined" aria-label="說明" @click="toggle" @focus="show" @blur="hide" @keydown="key">?</button>
    <Teleport to="body">
      <div v-if="open" :id="id" ref="pop" role="tooltip" class="hint-pop" :style="{ left: pos.left + 'px', top: pos.top + 'px', width: pos.width + 'px' }">
        <b v-if="title">{{ title }}</b>
        <slot>{{ text }}</slot>
      </div>
    </Teleport>
  </span>
</template>

<style scoped>
.hint-wrap { display: inline-flex; vertical-align: middle; }
.hint { width: 18px; height: 18px; border-radius: 50%; border: 0; background: var(--bg-3, #3A2B47); color: var(--ink-2); font: 900 var(--fs-fine)/18px var(--font); padding: 0; cursor: help; flex: none; }
.hint:hover, .hint[aria-expanded="true"] { background: var(--a); color: var(--on-a); }
[data-skin="net"] .hint { box-shadow: inset 0 0 0 2px var(--o); }
</style>
<style>
.hint-pop { position: fixed; z-index: var(--z-hint); background: #120D19; color: #F3E9FF; box-shadow: inset 0 0 0 2px #45375A, 4px 4px 0 #0E0A14; padding: 10px 12px; font-size: var(--fs-sm); line-height: 1.7; font-weight: 500; letter-spacing: 0; text-align: left; white-space: normal; border-radius: 6px; pointer-events: auto; }
.hint-pop b { display: block; color: #F58DBA; margin-bottom: 2px; }
.hint-pop p { margin: 0 0 6px; } .hint-pop p:last-child { margin: 0; }
</style>
