<script setup lang="ts">
import { computed, ref } from 'vue'
import { useEngine } from '../../stores/engine'
import { useUi } from '../../stores/ui'

/**
 * 成人場景的入口（戰敗事件的選項、俘虜的「帶走」會開場景）：場景的畫面是 M2-ui-scene，還沒做之前只有「略過」——
 * 引擎直接算出結果（sceneSkip），這裡把結果那一份報告的字列出來。M2-ui-scene 接上之後這個元件換成場景的畫面。
 */
const engine = useEngine()
const ui = useUi()
const active = computed(() => engine.sceneGate.active())
const result = ref<{ summary: string; lines: string[] } | null>(null)
function skip(): void {
  const why = engine.sceneGate.skip()
  if (why) { ui.toast(why, 'warn'); return }
  const rs = engine.state.reports
  for (let i = rs.length - 1; i >= 0; i--) {
    const r = rs[i]!
    if (r.action === 'scene.end') { result.value = { summary: r.outcome.summary, lines: [...(r.narration?.results ?? [])] }; return }
  }
}
</script>

<template>
  <section v-if="active" class="gate" data-scene-gate>
    <b>成人場景</b>
    <p>場景的畫面還沒做好：先略過，直接算出結果。</p>
    <button type="button" class="btn pri" data-scene-skip @click="skip">略過</button>
  </section>
  <section v-else-if="result" class="gate done" data-scene-result>
    <b>略過的結果</b>
    <p>{{ result.summary }}</p>
    <ul v-if="result.lines.length"><li v-for="(l, i) in result.lines" :key="i">{{ l }}</li></ul>
  </section>
</template>

<style scoped>
.gate { display: grid; gap: var(--space-3); padding: var(--space-4); background: var(--bg-2); box-shadow: inset 3px 0 0 var(--warn); min-width: 0; justify-items: start; }
.gate p { margin: 0; overflow-wrap: anywhere; }
.gate ul { margin: 0; padding-left: 1.4em; display: grid; gap: var(--space-2); }
.gate.done { box-shadow: inset 3px 0 0 var(--line-2); }
</style>
