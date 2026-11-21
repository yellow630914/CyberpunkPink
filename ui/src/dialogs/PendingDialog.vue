<script setup lang="ts">
import { computed } from 'vue'
import { useRouter } from 'vue-router'
import Dialog from '../components/Dialog.vue'
import Hint from '../components/Hint.vue'
import { useGame } from '../stores/game'
import { useUi, type DialogName } from '../stores/ui'
import type { PendingItem } from '../data/weekly'

/**
 * 待處理（UI 3.3 節）：要玩家回應的事。每件一列：種類的色塊、一句標題、一兩句說明、期限（橘字）、處理或稍後。
 * 擋住行動的左邊一條紅線。推算在引擎（pendingEvents），元件只管顯示與「稍後」。
 */
defineProps<{ entryId: number; stacked?: boolean }>()
const g = useGame()
const ui = useUi()
const router = useRouter()
const KIND_COLOR: Record<string, string> = { 帳單: 'var(--warn)', 人情: 'var(--ep)', 名冊: 'var(--ram)', 頻道: 'var(--a-hi)', 委託: 'var(--ap)', 戰敗: 'var(--hp)', 契約: 'var(--b)' }
const list = computed(() => [...g.pending].sort((a, b) => Number(!!b.blocking) - Number(!!a.blocking)))
function act(p: PendingItem) {
  const a = p.action
  if (!a) return
  if (a.route) { ui.closeAll(); router.push(a.route); return }
  if (a.dialog) ui.open(a.dialog as DialogName, a.props ?? {})
}
function later(p: PendingItem) {
  g.pending = g.pending.filter(x => x.id !== p.id)
  ui.toast(`「${p.title}」先放著；鈴鐺裡不再算它，期限照走。`)
}
</script>

<template>
  <Dialog :entry-id="entryId" :stacked="stacked" title="待處理" :sub="`${g.pending.length} 件`" size="md">
    <template #header><Hint title="待處理">指令到期、討債上門、名冊上的人出事、人情被討、頻道的事件。擋住行動的（帳單付不出來、戰敗事件）觸發時直接打開，其餘的進鈴鐺。有期限的事過期時照事件寫的後果走。</Hint></template>
    <div v-if="!list.length" class="empty-note">沒有要處理的事。</div>
    <div class="row-list">
      <div v-for="p in list" :key="p.id" class="pend" :class="{ block: p.blocking }">
        <span class="kc" :style="{ '--c': KIND_COLOR[p.kind] }">{{ p.kind }}</span>
        <div class="grow">
          <b>{{ p.title }}</b>
          <p>{{ p.body }}</p>
        </div>
        <span v-if="p.due" class="due mono">{{ p.due }}</span>
        <div class="acts">
          <button v-if="p.action" type="button" class="btn sm pri" @click="act(p)">{{ p.action.label }}</button>
          <button type="button" class="btn sm" @click="later(p)">稍後</button>
        </div>
      </div>
    </div>
  </Dialog>
</template>

<style scoped>
.pend { display: grid; grid-template-columns: auto minmax(0, 1fr) auto; gap: 6px 10px; align-items: start; padding: 10px 12px; background: var(--bg-2); }
.pend.block { box-shadow: inset 3px 0 0 var(--danger); }
.pend p { margin: 2px 0 0; font-size: var(--fs-sm); color: var(--ink-2); }
.due { color: var(--warn); font-size: 12px; font-weight: 800; }
.acts { grid-column: 2 / -1; display: flex; gap: 6px; justify-content: flex-end; flex-wrap: wrap; }
.grow { min-width: 0; }
</style>
