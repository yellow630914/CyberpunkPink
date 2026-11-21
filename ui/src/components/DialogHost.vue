<script setup lang="ts">
import { onMounted, onBeforeUnmount, type Component } from 'vue'
import { useUi, type DialogName } from '../stores/ui'
import BagDialog from '../dialogs/BagDialog.vue'
import CharacterDialog from '../dialogs/CharacterDialog.vue'
import TalkDialog from '../dialogs/TalkDialog.vue'
import ShopDialog from '../dialogs/ShopDialog.vue'
import SettingsDialog from '../dialogs/SettingsDialog.vue'

/** 對話框層：照 ui.stack 的順序畫，Esc 關最上面那一個。 */
const REGISTRY: Record<DialogName, Component> = {
  bag: BagDialog, character: CharacterDialog, talk: TalkDialog, shop: ShopDialog, settings: SettingsDialog,
}
const ui = useUi()
function onKey(e: KeyboardEvent) {
  if (e.key === 'Escape' && ui.stack.length) { e.preventDefault(); ui.close() }
}
onMounted(() => window.addEventListener('keydown', onKey))
onBeforeUnmount(() => window.removeEventListener('keydown', onKey))
</script>

<template>
  <component :is="REGISTRY[d.name]" v-for="(d, i) in ui.stack" :key="d.id" :entry-id="d.id" :stacked="i > 0" v-bind="d.props" />
  <div class="toasts" aria-live="polite">
    <div v-for="t in ui.toasts" :key="t.id" class="toast" :class="t.kind">{{ t.text }}</div>
  </div>
</template>

<style scoped>
.toasts { position: fixed; left: 50%; bottom: 84px; transform: translateX(-50%); z-index: var(--z-toast); display: grid; gap: 6px; width: min(420px, calc(100vw - 24px)); pointer-events: none; }
.toast { background: #120D19; color: #F3E9FF; box-shadow: inset 3px 0 0 #45D6C5, 4px 4px 0 #0E0A14; padding: 10px 14px; font-size: 13px; font-weight: 700; }
.toast.warn { box-shadow: inset 3px 0 0 #FF8A5C, 4px 4px 0 #0E0A14; }
</style>
