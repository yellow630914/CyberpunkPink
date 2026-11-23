<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { useUi } from '../stores/ui'

/**
 * 對話框的外框（UI.md 第 16 節的 AppDialog）：斜切角；手機上是全螢幕頁、左上「← 返回」。
 * 關掉回到打開它的地方；Esc 由 DialogHost 處理（只關最上面那一個）。
 */
const props = withDefaults(defineProps<{ entryId: number; title: string; sub?: string; size?: 'md' | 'lg' | 'xl'; stacked?: boolean; locked?: boolean }>(), { size: 'lg' })
const emit = defineEmits<{ (e: 'close'): void }>()
const ui = useUi()
const box = ref<HTMLElement | null>(null)
onMounted(() => box.value?.focus())
/** locked：擋住別的操作的視窗（事件）：沒有關閉鈕、點外面不關；要回應才會消失 */
function close() { if (props.locked) return; emit('close'); ui.close(props.entryId) }
</script>

<template>
  <div class="overlay" :class="{ stacked }" @mousedown.self="close">
    <section ref="box" class="dlg cut" :class="size" role="dialog" aria-modal="true" :aria-label="title" tabindex="-1">
      <header class="hd">
        <button v-if="!locked" type="button" class="back" aria-label="返回" @click="close">←<span> 返回</span></button>
        <div class="tt"><b>{{ title }}</b><small v-if="sub">{{ sub }}</small></div>
        <div class="extra"><slot name="header" /></div>
        <button v-if="!locked" type="button" class="x" aria-label="關閉" title="關閉（Esc）" @click="close">✕</button>
      </header>
      <div class="body"><slot /></div>
      <footer v-if="$slots.footer" class="ft"><slot name="footer" /></footer>
    </section>
  </div>
</template>

<style scoped>
.overlay { position: fixed; inset: 0; z-index: var(--z-dialog); background: color-mix(in srgb, #0b0810 72%, transparent); display: grid; place-items: center; padding: 24px; }
.overlay.stacked { background: color-mix(in srgb, #0b0810 55%, transparent); padding: 48px; }
.dlg { width: min(1180px, 100%); max-height: calc(100vh - 48px); display: flex; flex-direction: column; background: var(--bg); background-image: var(--grid); box-shadow: inset 0 0 0 2px var(--a); outline: none; min-width: 0; }
.dlg.md { width: min(760px, 100%); }
.dlg.xl { width: min(1320px, 100%); }
.stacked .dlg { box-shadow: inset 0 0 0 2px var(--a), 0 0 0 9999px transparent; }
.hd { display: flex; align-items: center; gap: 12px; padding: 12px 16px; border-bottom: 2px solid var(--line); background: var(--bg-term); min-width: 0; }
.tt { display: grid; min-width: 0; }
.tt b { font-size: var(--fs-section); font-weight: var(--fw-title); letter-spacing: 1px; }
.tt small { color: var(--ink-3); font-size: var(--fs-xs); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.extra { flex: 1; display: flex; justify-content: flex-end; gap: 8px; min-width: 0; flex-wrap: wrap; }
.back { display: none; }
.x, .back { background: var(--bg-2); border: 0; color: var(--ink-2); font: 900 var(--fs-md) var(--font); padding: 6px 10px; cursor: pointer; flex: none; }
.x:hover, .back:hover { background: var(--a); color: var(--on-a); }
.body { flex: 1; min-height: 0; overflow: auto; padding: 12px; }
.ft { border-top: 2px solid var(--line); padding: 10px 16px; display: flex; gap: 8px; justify-content: flex-end; flex-wrap: wrap; }
@media (max-width: 720px) {
  .overlay, .overlay.stacked { padding: 0; place-items: stretch; }
  .dlg, .dlg.md, .dlg.xl { width: 100%; max-height: none; height: 100dvh; clip-path: none; }
  .back { display: inline-flex; }
  .x { display: none; }
  .hd { padding: 10px 12px; flex-wrap: wrap; }
  .extra { flex-basis: 100%; justify-content: flex-start; order: 3; }
  .extra:empty { display: none; }
  .body { padding: 10px; }
}
</style>
