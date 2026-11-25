<script setup lang="ts">
import { computed } from 'vue'
import type { CurtainView } from '@engine/src/features/curtain'
import TrackBar from '../TrackBar.vue'
import Hint from '../Hint.vue'
import { bandLine, heatMarks } from '../../lib/curtainView'

/**
 * 場熱（觀眾的興致）的一條：0、贊助人、安可三個刻度與說明，打賞比例的各段（現在這一段標起來）。
 * 場熱的數字、刻度的位置、比例都是引擎的 curtainView；這裡只畫。
 */
const props = defineProps<{ view: Pick<CurtainView, 'heat' | 'tips_mult' | 'signed'> }>()
const marks = computed(() => heatMarks(props.view))
const color = computed(() => (props.view.heat.value <= 15 ? 'var(--hp)' : props.view.heat.value >= props.view.heat.encore_at ? 'var(--ap)' : 'var(--load)'))
</script>

<template>
  <div class="heat" data-heat>
    <div class="hh"><b>場熱</b><span class="hv mono" data-heat-value>{{ view.heat.value }}</span><span class="tag hot" data-tips-ratio>打賞 ×{{ view.heat.ratio }}</span>
      <Hint title="場熱">觀眾的興致，只由戰鬥與場景的結果決定，不能自己加減。到 {{ view.heat.sponsor_at }} 贊助人現身，到 {{ view.heat.encore_at }} 可以加演，掉到 0 觀眾散場。結算時照場熱那一段的比例換成打賞。</Hint></div>
    <TrackBar :value="view.heat.value" :max="100" :color="color" :marks="[view.heat.sponsor_at, view.heat.encore_at]" :height="12" label="" />
    <div class="ticks">
      <span v-for="m in marks" :key="m.at" class="tk" :title="m.text" :style="{ left: m.at + '%' }" :data-mark="m.at"><b class="mono">{{ m.at }}</b>{{ m.name }}</span>
    </div>
    <div class="bands" data-bands><span v-for="b in view.heat.bands" :key="b.from" class="tag" :class="{ hot: b.here }" :data-band="b.from">{{ bandLine(b) }}</span></div>
    <p v-if="view.tips_mult !== 1" class="note" data-tips-mult>這一趟的打賞乘 {{ view.tips_mult }}（主打的夜加成、包場的扣除，引擎算好的）。</p>
  </div>
</template>

<style scoped>
.heat { display: grid; gap: var(--space-3); }
.hh { display: flex; align-items: center; gap: var(--space-3); flex-wrap: wrap; }
.hv { font: 900 var(--fs-page) var(--mono); }
.ticks { position: relative; height: 34px; margin: 0 6px; }
.tk { position: absolute; top: 0; transform: translateX(-50%); display: grid; justify-items: center; font-size: var(--fs-tiny); color: var(--ink-3); font-weight: 700; white-space: nowrap; }
.tk:first-child { transform: none; justify-items: start; }
.tk:last-child { transform: translateX(-80%); }
.tk b { color: var(--ink-2); font-size: var(--fs-fine); }
.bands { display: flex; gap: var(--space-2); flex-wrap: wrap; }
.note { margin: 0; color: var(--ink-3); font-size: var(--fs-fine); line-height: 1.6; }
</style>
