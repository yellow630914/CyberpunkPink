<script setup lang="ts">
import { computed } from 'vue'
import { useRouter } from 'vue-router'
import Dialog from '../components/Dialog.vue'
import Hint from '../components/Hint.vue'
import { useGame } from '../stores/game'
import { useEngine } from '../stores/engine'
import { useUi, type DialogName } from '../stores/ui'
import type { PendingItem } from '../data/weekly'

/**
 * 待處理（UI 3.3 節）：要玩家回應的事。每件一列：種類的色塊、一句標題、一兩句說明、期限（橘字）、處理或稍後。
 * 擋住行動的左邊一條紅線。推算在引擎（pendingEvents），元件只管顯示與「稍後」。
 */
defineProps<{ entryId: number; stacked?: boolean }>()
const g = useGame()
const e = useEngine()
const ui = useUi()
const router = useRouter()
const KIND_COLOR: Record<string, string> = { 帳單: 'var(--warn)', 人情: 'var(--ep)', 名冊: 'var(--ram)', 頻道: 'var(--a-hi)', 委託: 'var(--ap)', 戰敗: 'var(--hp)', 契約: 'var(--b)' }
/** 事件導演（引擎）排著的：延後的事件、排隊的通知。引擎只給件數，內容要等它發出來才看得到 */
const director = computed(() => e.event.director())
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
  <Dialog :entry-id="entryId" :stacked="stacked" title="待處理" :sub="`${g.pending.length} 件`" size="lg">
    <template #header><Hint title="待處理">指令到期、討債上門、名冊上的人出事、人情被討、頻道的事件。擋住行動的（帳單付不出來、戰敗事件）觸發時直接打開，其餘的進鈴鐺。有期限的事過期時照事件寫的後果走。</Hint></template>
    <p v-if="director.deferred || director.notices" class="dir" data-director>事件導演排著：延後的事件 {{ director.deferred }} 件、排隊的通知 {{ director.notices }} 則。時候到了會自己跳出來。</p>
    <div v-if="!list.length" class="empty-note">沒有要處理的事。</div>
    <div class="grid2">
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
.dir { margin: 0 0 var(--space-4); padding: var(--space-3) var(--space-4); background: var(--bg-2); box-shadow: inset 3px 0 0 var(--ap); font-size: var(--fs-sm); color: var(--ink-2); }
.due { color: var(--warn); font-size: var(--fs-sm); font-weight: 800; }
.acts { grid-column: 2 / -1; display: flex; gap: 6px; justify-content: flex-end; flex-wrap: wrap; }
.grow { min-width: 0; }
</style>
