<script setup lang="ts">
import type { GearPanel } from '../../lib/netView'

/**
 * 同步檔位（內海戰鬥，CYBERSPACE 6.2 節；UI.md 第 5 節）：四檔一排，現在的那一檔亮；開不了的灰掉，原因是引擎的句子；
 * 這一回合換過了（或不是你的回合）整排灰掉。這裡不判斷能不能換：一切讀 netBattleView 與 battleOptions 的 net_shift。
 */
defineProps<{ panel: GearPanel }>()
const emit = defineEmits<{ (e: 'shift', gear: string): void }>()
</script>

<template>
  <div class="grp" data-sync :data-unit="panel.unit" :data-locked="panel.locked ? 'true' : undefined">
    <span class="k">同步檔位・{{ panel.name }}<small>（每回合換一次；檢定／受到的感載）</small></span>
    <div class="segs" role="group" aria-label="同步檔位">
      <button v-for="c in panel.cells" :key="c.gear" type="button" :class="{ on: c.current, 'is-unavailable': !!panel.locked || !!c.reason }"
        :aria-pressed="c.current" :aria-disabled="panel.locked || c.reason ? 'true' : undefined" :title="c.reason ?? panel.locked ?? undefined"
        :data-gear="c.gear" @click="emit('shift', c.gear)">{{ c.name }}<small>{{ c.check }}・{{ c.loadPct }}%</small></button>
    </div>
    <p v-if="panel.locked" class="t-fine why" data-sync-why>{{ panel.locked }}</p>
  </div>
</template>

<style scoped>
.grp { display: grid; gap: var(--space-2); min-width: 0; }
.k small { margin-left: var(--space-2); color: var(--ink-3); font-weight: 400; }
.segs { display: flex; }
.segs button { flex: 1 1 0; min-width: 0; padding-inline: var(--space-2); min-height: 40px; }
.segs small { display: block; font: 700 var(--fs-tiny) var(--mono); opacity: .8; }
.segs button.on.is-unavailable { opacity: .7; filter: none; box-shadow: inset 0 0 0 2px var(--a) !important; }
.why { margin: 0; color: var(--warn); white-space: pre-line; }
</style>
