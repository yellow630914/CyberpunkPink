<script setup lang="ts">
import { computed } from 'vue'
import { useUi } from '../stores/ui'
import { defaultOption, type HereOption } from '../lib/here'

/**
 * 「這裡」的選單（UI.md 1.1 節的到達規則）：到了就列出來，不自動執行。預設選項黃框、帶 E 的鍵帽；
 * 做不到的灰掉，點了說原因。
 */
const props = defineProps<{ options: HereOption[]; compact?: boolean }>()
const ui = useUi()
const def = computed(() => defaultOption(props.options))
function click(o: HereOption) {
  if (o.reason) { ui.toast(o.reason, 'warn'); return }
  o.run()
}
</script>

<template>
  <div class="here-opts" :class="{ compact }">
    <button v-for="o in options" :key="o.id" type="button" class="hopt" :class="{ auto: def && o.id === def.id, 'is-unavailable': !!o.reason }"
      :aria-disabled="o.reason ? 'true' : undefined" :title="o.reason || undefined" :data-opt="o.id" :aria-keyshortcuts="def && o.id === def.id ? 'E' : undefined" @click="click(o)">
      <kbd v-if="def && o.id === def.id" class="ekey" aria-hidden="true">E</kbd>
      <span class="nm">{{ o.name }}</span><small v-if="o.sub" class="sub">{{ o.sub }}</small>
    </button>
  </div>
</template>

<style scoped>
.here-opts { display: grid; gap: var(--space-3); }
.here-opts.compact { display: flex; flex-wrap: wrap; }
.hopt { display: flex; align-items: center; gap: var(--space-3); padding: 9px 10px; background: var(--bg-2); border: 0; border-radius: 10px; font-weight: 700; font-size: var(--fs-ui); color: var(--ink); cursor: pointer; text-align: left; max-width: 880px; }
.hopt:hover { background: var(--bg-3); }
.hopt.auto { box-shadow: inset 0 0 0 2px var(--ap); background: color-mix(in srgb, var(--ap) 16%, var(--bg-2)); }
.hopt .sub { color: var(--ink-3); font-size: var(--fs-fine); font-weight: 700; }
.ekey { flex: none; min-width: 22px; height: 22px; display: grid; place-items: center; border-radius: 5px; background: var(--ap); color: #17111F; font: 900 var(--fs-label) var(--mono); box-shadow: 0 2px 0 #9b7a26; }
</style>
