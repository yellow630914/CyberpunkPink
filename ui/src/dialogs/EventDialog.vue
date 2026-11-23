<script setup lang="ts">
import { computed, ref } from 'vue'
import type { Report } from '@engine/src'
import Dialog from '../components/Dialog.vue'
import Hint from '../components/Hint.vue'
import ScanDialog from './ScanDialog.vue'
import { useEngine } from '../stores/engine'
import { useUi } from '../stores/ui'
import { logEntryOf, type EngineLogEntry } from '../lib/engineView'

/**
 * 事件視窗（UI.md 3.1 節；EVENTS 3.6 節）：引擎有開著的事件時自動打開、擋住別的操作（沒有關閉鈕；走路、休息這類在引擎那邊就被擋下）。
 * 正文、登場的人、選項（選不了的灰掉並寫引擎的原因；有檢定的寫基本功、難度、成功率、誰擲）、永遠有一個「我要做別的」的輸入框（送自由行動）。
 * 選完顯示擲骰與結果（報告的內容）；多段的事件換下一段，做完就關。標題寫還有幾件延後的。
 * 事件是掃橋發起的時候，正文換成掃橋的框（ScanDialog）。選項、檢定、成功率、原因全部是引擎的（eventView、scanView），這裡只畫。
 */
const e = useEngine()
const ui = useUi()
const view = computed(() => e.event.view())
const scan = computed(() => e.event.scan())
const deferred = computed(() => e.event.director().deferred)
const result = ref<EngineLogEntry | null>(null)
const freeText = ref('')

const visible = computed(() => view.value !== null || result.value !== null)
const sub = computed(() => {
  const parts: string[] = []
  if (view.value && view.value.stage.count > 1) parts.push(`第 ${view.value.stage.index + 1} 段，共 ${view.value.stage.count} 段`)
  parts.push(deferred.value > 0 ? `還有 ${deferred.value} 件延後的` : '沒有延後的事件')
  return parts.join('・')
})

/** 這一步提交的報告裡的事件那一份（擲骰與結果）轉成要顯示的卡 */
function cardOf(reports: Report[] | undefined): EngineLogEntry | null {
  const r = reports?.find(x => x.action?.startsWith('event.')) ?? reports?.[0]
  return r ? logEntryOf(r) : null
}
async function choose(id: string) {
  const r = await e.event.choose(id)
  if (r.status !== 'applied') { ui.toast(r.reason ?? '現在選不了這個。', 'warn'); return }
  result.value = cardOf(r.reports)
}
async function freeAction() {
  const text = freeText.value.trim()
  if (!text) { ui.toast('先寫下想做什麼。', 'warn'); return }
  const r = await e.event.free(text)
  if (r.status === 'refused') { ui.toast(r.reason ?? '現在做不了這件事。', 'warn'); return }
  freeText.value = ''
}
const warn = (why: string) => ui.toast(why, 'warn')
</script>

<template>
  <Dialog v-if="visible" :entry-id="0" :locked="view !== null" :title="scan ? '掃橋' : '事件'" :sub="sub" size="md" @close="result = null">
    <template #header><Hint title="事件視窗">眼前有一件事要先回應：選一個選項，或在最下面寫下你要做的別的事。回應之前走路、休息、搭車都被擋下。有檢定的選項會寫基本功、難度與成功率；選完會看到擲骰與結果。延後的事件會在之後的某個時候再回來。</Hint></template>

    <section v-if="result" class="result" aria-live="polite" data-result>
      <p class="h">{{ view ? '剛才' : '結果' }}</p>
      <p v-for="(p, i) in result.prose" :key="i" class="prose">{{ p }}</p>
      <div v-if="result.roll" class="roll" data-roll>
        <span class="mono">{{ result.roll.skill }} 1d20({{ result.roll.die }}){{ result.roll.mod >= 0 ? '+' : '' }}{{ result.roll.mod }} 對 DC{{ result.roll.dc }} → {{ result.roll.result }}</span>
      </div>
      <ul v-if="result.changes.length" class="chg"><li v-for="(c, i) in result.changes" :key="i" :class="c.kind">{{ c.text }}</li></ul>
      <button v-if="!view" type="button" class="btn pri" @click="result = null">好</button>
    </section>

    <template v-if="view">
      <ScanDialog v-if="scan" :view="scan" :busy="e.busy" @choose="choose" @locked="warn" />
      <template v-else>
        <div v-if="view.cast.length" class="cast"><span v-for="c in view.cast" :key="c.role" class="tag">{{ c.name }}</span></div>
        <p v-for="(p, i) in view.text.split('\n')" :key="i" class="prose" data-text>{{ p }}</p>
        <div class="opts" role="group" aria-label="選項">
          <button v-for="o in view.options" :key="o.id" type="button" class="opt" :class="{ 'is-unavailable': !!o.locked }" :aria-disabled="o.locked ? 'true' : undefined" :title="o.locked ?? undefined" :disabled="e.busy" :data-opt="o.id" @click="o.locked ? warn(o.locked) : choose(o.id)">
            <span class="ot">{{ o.text }}</span>
            <small v-if="o.check" class="chk">{{ o.check.skill_name }}（{{ o.check.attr_name }}）對 DC {{ o.check.dc }}・成功率 {{ o.check.chance }}%・{{ o.check.roller_name }}擲<template v-if="o.check.assist">・隊友協力 +2</template></small>
            <small v-if="o.locked" class="why">{{ o.locked }}</small>
          </button>
        </div>
      </template>
      <form class="free" @submit.prevent="freeAction">
        <label class="sr-only" for="ev-free">我要做別的</label>
        <input id="ev-free" v-model="freeText" placeholder="我要做別的：寫下你想做什麼……" autocomplete="off" :disabled="e.busy">
        <button type="submit" class="btn sm" :disabled="e.busy">做別的</button>
      </form>
    </template>
  </Dialog>
</template>

<style scoped>
.cast { display: flex; gap: var(--space-3); flex-wrap: wrap; margin-bottom: var(--space-3); }
.prose { margin: 0 0 var(--space-3); line-height: var(--lh-prose); overflow-wrap: anywhere; }
.opts { display: grid; grid-template-columns: repeat(auto-fit, minmax(min(100%, 300px), 1fr)); gap: var(--space-3); margin: var(--space-4) 0; }
.opt { display: grid; gap: 2px; text-align: left; padding: var(--space-4); background: var(--bg-2); border: 0; color: var(--ink); cursor: pointer; font: inherit; min-width: 0; box-shadow: inset 3px 0 0 var(--line-2); }
.opt:hover { background: var(--bg-3); }
.opt .ot { overflow-wrap: anywhere; font-weight: 700; }
.opt small { color: var(--ink-3); font-size: var(--fs-fine); overflow-wrap: anywhere; }
.opt .why { color: var(--warn); font-weight: 700; }
.free { display: flex; gap: var(--space-3); align-items: center; padding: var(--space-3); background: var(--bg-term); box-shadow: inset 0 0 0 2px var(--line); min-width: 0; }
.free input { flex: 1; min-width: 0; background: transparent; border: 0; color: var(--ink); font: 500 var(--fs-md) var(--font); outline: none; }
.free input::placeholder { color: var(--ink-3); }
.result { margin-bottom: var(--space-4); padding: var(--space-4); background: var(--bg-2); box-shadow: inset 3px 0 0 var(--a); min-width: 0; }
.roll { border-left: 3px solid var(--a); padding-left: var(--space-3); margin: var(--space-3) 0; font-size: var(--fs-sm); overflow-wrap: anywhere; }
.chg { list-style: none; margin: 0 0 var(--space-3); padding: 0; display: flex; gap: var(--space-3); flex-wrap: wrap; font-size: var(--fs-sm); font-weight: 800; }
.chg .plus { color: var(--ok); } .chg .minus { color: var(--warn); }
/* 手機：選項直向排、不超出畫面 */
@media (max-width: 720px) {
  .opts { grid-template-columns: minmax(0, 1fr); }
  .free { flex-wrap: wrap; }
  .free input { flex-basis: 100%; }
}
</style>
