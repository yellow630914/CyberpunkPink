<script setup lang="ts">
import { computed, ref } from 'vue'
import Dialog from '../components/Dialog.vue'
import Hint from '../components/Hint.vue'
import EventBody from '../components/EventBody.vue'
import { useEngine } from '../stores/engine'
import type { EngineLogEntry } from '../lib/engineView'

/**
 * 事件視窗（UI.md 3.1 節；EVENTS 3.6 節）：引擎有開著的事件時自動打開、擋住別的操作（沒有關閉鈕；走路、休息這類在引擎那邊就被擋下）。
 * 內容（正文、選項、檢定、「我要做別的」、擲骰與結果）是 EventBody；掃橋發起的時候換成 ScanDialog。標題寫還有幾件延後的。
 * 戰敗與戰鬥之後的面板把事件嵌在自己裡面（e.eventInline 大於 0）：這時候對話框讓出來，不重複開。
 */
const e = useEngine()
const view = computed(() => e.event.view())
const scan = computed(() => e.event.scan())
const deferred = computed(() => e.event.director().deferred)
const result = ref<EngineLogEntry | null>(null)

const visible = computed(() => e.eventInline === 0 && (view.value !== null || result.value !== null))
const sub = computed(() => {
  const parts: string[] = []
  if (view.value && view.value.stage.count > 1) parts.push(`第 ${view.value.stage.index + 1} 段，共 ${view.value.stage.count} 段`)
  parts.push(deferred.value > 0 ? `還有 ${deferred.value} 件延後的` : '沒有延後的事件')
  return parts.join('・')
})
</script>

<template>
  <Dialog v-if="visible" :entry-id="0" :locked="view !== null" :title="scan ? '掃橋' : '事件'" :sub="sub" size="md" @close="result = null">
    <template #header><Hint title="事件視窗">眼前有一件事要先回應：選一個選項，或在最下面寫下你要做的別的事。回應之前走路、休息、搭車都被擋下。有檢定的選項會寫基本功、難度與成功率；選完會看到擲骰與結果。延後的事件會在之後的某個時候再回來。</Hint></template>
    <EventBody v-model:result="result" />
  </Dialog>
</template>
