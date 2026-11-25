<script setup lang="ts">
import { computed } from 'vue'
import type { ScanView } from '@engine/src/features/security'
import { personRows } from '../lib/contractView'

/**
 * 掃橋（UI.md 3.11 節；規則在 LIFE 2.1 節與 features/security）：事件是掃橋發起的時候，事件視窗換成這個樣子。
 * 抬頭（這個點與掃描強度、這一級掃什麼）、四步各一列（過、注意、不適用；每一步的說明是引擎的 scanView）、
 * 身上會被掃到的每一樣東西、怎麼過（照常過、用假身分、掉頭；選不了的灰掉並寫引擎的原因、有檢定的寫成功率）。
 * 讀到這個人的東西（scanView.person）時多一塊「讀到你身上的」：義體（件數；強度夠時逐件與處置）、沉溺（讀到多少、有沒有被看穿）、契約（誰持有、哪一級；被遮住時不列）。
 * 這個元件只畫引擎給的 scanView；選一條路由外面（EventDialog）送給引擎。
 */
const props = defineProps<{ view: ScanView; busy?: boolean }>()
const emit = defineEmits<{ (e: 'choose', id: string): void; (e: 'locked', reason: string): void }>()
const STATE_NAME = { pass: '過', attention: '注意', na: '不適用' } as const
/** 這一道讀這個人讀到了什麼（義體、沉溺、契約、看穿）：引擎的 scanView.person，只整理成一列一列 */
const person = computed(() => personRows(props.view.person))
</script>

<template>
  <div class="scan">
    <header class="hd">
      <b class="nm">{{ view.name }}</b>
      <span class="tag">掃描強度 {{ view.strength }}</span>
      <span v-if="view.faction" class="tag">{{ view.faction.name }}</span>
    </header>
    <p class="scans">{{ view.scans }}</p>

    <ol class="steps" aria-label="四步檢查">
      <li v-for="s in view.steps" :key="s.id" class="step" :class="s.state" :data-step="s.id" :data-state="s.state">
        <span class="st">{{ STATE_NAME[s.state] }}</span>
        <b>{{ s.name }}</b>
        <small>{{ s.note }}</small>
      </li>
    </ol>

    <div class="carried">
      <p class="h">身上會被掃到的東西</p>
      <div v-if="!view.carried.length" class="empty-note">這一級掃不到你身上的東西。</div>
      <ul v-else class="tags">
        <li v-for="c in view.carried" :key="c.item" class="ct" :class="{ seized: c.seized }" :data-item="c.item" :title="c.note"><b>{{ c.name }}</b><small>{{ c.note }}</small></li>
      </ul>
    </div>

    <div v-if="person.length" class="person" data-person>
      <p class="h">讀到你身上的</p>
      <ul class="prows">
        <li v-for="r in person" :key="r.key" class="prow" :class="r.tone" :data-person-row="r.key"><b>{{ r.label }}</b><small>{{ r.value }}</small></li>
      </ul>
      <p v-for="(s, i) in view.person?.sentences ?? []" :key="i" class="psay" data-person-say>{{ s }}</p>
    </div>

    <p class="h">怎麼過</p>
    <div class="opts" role="group" aria-label="怎麼過">
      <button v-for="o in view.options" :key="o.id" type="button" class="opt" :class="{ 'is-unavailable': !!o.locked }" :aria-disabled="o.locked ? 'true' : undefined" :title="o.locked ?? undefined" :disabled="busy" :data-opt="o.id" @click="o.locked ? emit('locked', o.locked) : emit('choose', o.id)">
        <span class="ot">{{ o.text }}</span>
        <small v-if="o.check">表演檢定 DC {{ o.check.dc }}・成功率 {{ o.check.chance }}%</small>
        <small v-if="o.locked" class="why">{{ o.locked }}</small>
      </button>
    </div>
  </div>
</template>

<style scoped>
.scan { display: grid; gap: var(--space-4); min-width: 0; margin-bottom: var(--space-4); }
.hd { display: flex; gap: var(--space-3); align-items: center; flex-wrap: wrap; }
.nm { font-size: var(--fs-card); }
.scans { margin: 0; color: var(--ink-2); font-size: var(--fs-sm); }
.steps { list-style: none; margin: 0; padding: 0; display: grid; gap: var(--space-3); }
.step { display: grid; grid-template-columns: auto minmax(0, 1fr); gap: 2px var(--space-3); align-items: baseline; padding: var(--space-3) var(--space-4); background: var(--bg-2); box-shadow: inset 3px 0 0 var(--line-2); min-width: 0; }
.step small { grid-column: 2; color: var(--ink-3); font-size: var(--fs-fine); overflow-wrap: anywhere; }
.step .st { font-size: var(--fs-fine); font-weight: 900; padding: 1px 8px; border-radius: 5px; background: var(--bg-3); color: var(--ink-2); }
.step.pass { box-shadow: inset 3px 0 0 var(--ok); } .step.pass .st { background: var(--ok); color: var(--bg-term); }
.step.attention { box-shadow: inset 3px 0 0 var(--warn); } .step.attention .st { background: var(--warn); color: var(--bg-term); }
.step.na { opacity: .55; }
.tags { list-style: none; margin: 0; padding: 0; display: flex; flex-wrap: wrap; gap: var(--space-3); }
.ct { display: grid; gap: 2px; padding: var(--space-2) var(--space-3); background: var(--bg-2); box-shadow: inset 0 0 0 1px var(--line-2); color: var(--ok); min-width: 0; }
.ct small { color: var(--ink-3); font-size: var(--fs-fine); }
.ct.seized { box-shadow: inset 0 0 0 2px var(--warn); color: var(--warn); }
.prows { list-style: none; margin: 0; padding: 0; display: grid; gap: var(--space-2); }
.prow { display: grid; grid-template-columns: minmax(0, 8em) minmax(0, 1fr); gap: var(--space-3); padding: var(--space-3) var(--space-4); background: var(--bg-2); box-shadow: inset 3px 0 0 var(--line-2); font-size: var(--fs-sm); align-items: baseline; }
.prow.warn { box-shadow: inset 3px 0 0 var(--warn); }
.prow.ok { box-shadow: inset 3px 0 0 var(--ok); }
.prow small { color: var(--ink-2); font-size: var(--fs-fine); overflow-wrap: anywhere; }
.psay { margin: var(--space-2) 0 0; color: var(--ink-3); font-size: var(--fs-fine); }
.opts { display: grid; grid-template-columns: repeat(auto-fit, minmax(min(100%, 280px), 1fr)); gap: var(--space-3); }
.opt { display: grid; gap: 2px; text-align: left; padding: var(--space-4); background: var(--bg-2); border: 0; color: var(--ink); cursor: pointer; font: inherit; min-width: 0; }
.opt:hover { background: var(--bg-3); }
.opt small { color: var(--ink-3); font-size: var(--fs-fine); }
.opt .why { color: var(--warn); font-weight: 700; }
.ot { overflow-wrap: anywhere; font-weight: 700; }
@media (max-width: 720px) {
  .opts { grid-template-columns: minmax(0, 1fr); }
}
</style>
