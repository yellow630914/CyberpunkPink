<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import Hint from '../../components/Hint.vue'
import ReasonButton from '../../components/ReasonButton.vue'
import BridgePanel from '../../components/body/BridgePanel.vue'
import { useEngine } from '../../stores/engine'
import { useUi } from '../../stores/ui'
import { useGuides } from '../../lib/useGuides'
import { CAT_COLOR, CATEGORIES, CATEGORY_NAME, bridgeRows, capCells, draftUse, filterRows, listTrees, previewOf, sameList, toggleDraft } from '../../lib/skillView'
import type { BridgeRow } from '../../lib/skillView'

/**
 * 角色的「橋」分頁（UI 8.3 節）：只裝已經學會的技能。容量條與「套用」的結果都是引擎的答案（stores/engine.ts 的 skills）。
 * 勾選改的是一份暫存的清單，按「套用」才提交；被引擎擋下時，那一句原因寫在最下面一行。
 * 戰鬥中、等著選戰敗時整頁唯讀（store 給原因）。最上面是橋本身（components/body/BridgePanel.vue：型號、四類容量的組成、機能、橋參數，讀引擎）；調校槽等 M4-tuning。換配置能不能換（地點、委託副本）與要花幾分鐘都是引擎的（loadoutBlock、loadout_minutes），寫在最下面一行；委託副本裡整頁唯讀並寫原因。
 */
const eng = useEngine()
const ui = useUi()
useGuides().trigger('g_bridge')

const mine = computed(() => eng.skills.mine())
const rows = computed(() => bridgeRows(eng.skills.paths(), eng.skills.abilities(), mine.value))
const trees = computed(() => listTrees(eng.skills.paths(), eng.skills.abilities(), mine.value, eng.skills.tierOf, eng.skills.treeXp))
const draft = ref<string[]>([...mine.value.equipped])
// 引擎的裝著清單變了（套用、讀檔、回退）就重新對齊
watch(() => mine.value.equipped.join('\n'), () => { draft.value = [...mine.value.equipped] })
const cap = computed(() => eng.skills.capacity())
const used = computed(() => draftUse(rows.value, draft.value))
const hover = ref<BridgeRow | null>(null)
const preview = computed(() => previewOf(hover.value, draft.value, used.value))
const filter = ref('all')
const FILTERS = computed(() => [{ id: 'all', n: '全部' }, ...trees.value.map((t) => ({ id: t.id, n: t.name })), { id: 'on', n: '只看裝著的' }])
const shown = computed(() => filterRows(rows.value, filter.value, draft.value))
const lock = computed(() => eng.skills.lock())
const changed = computed(() => !sameList(draft.value, mine.value.equipped))
const refused = ref<string | null>(null)
/** 換配置要在住處或調校診所（引擎的 loadoutBlock）；花多久是引擎的衍生數值 loadout_minutes */
const place = computed(() => eng.skills.loadoutBlock())
const minutes = computed(() => eng.skills.loadoutMinutes())
const footer = computed(() => lock.value ?? refused.value ?? place.value ?? '可以換。')

function toggle(r: BridgeRow) {
  if (lock.value) return void ui.toast(lock.value, 'warn')
  refused.value = null
  draft.value = toggleDraft(draft.value, r.id)
}
function apply() {
  const why = eng.skills.equip(draft.value)
  refused.value = why
  if (why === null) ui.toast('套用了新的配置。')
}
function reset() {
  refused.value = null
  draft.value = [...mine.value.equipped]
}
const barOf = (c: (typeof CATEGORIES)[number]) => capCells(cap.value[c].max, used.value[c], preview.value?.category === c ? preview.value.after : null)
</script>

<template>
  <section class="br">
    <BridgePanel />
    <div class="panel cut pad caps" data-caps>
      <div v-for="c in CATEGORIES" :key="c" class="cap" :data-cap="c">
        <span class="cn" :style="{ color: CAT_COLOR[c] }">{{ CATEGORY_NAME[c] }}</span>
        <span class="cells"><i v-for="(x, i) in barOf(c)" :key="i" :class="{ on: x.on, pv: x.preview, over: x.over }" :style="{ '--cc': CAT_COLOR[c] }" /></span>
        <span class="mono num" data-num>{{ used[c] }}/{{ cap[c].max }}<template v-if="preview?.category === c"> → {{ preview.after }}</template></span>
      </div>
    </div>
    <div class="filters fl"><button v-for="f in FILTERS" :key="f.id" type="button" :class="{ on: filter === f.id }" :data-filter="f.id" @click="filter = f.id">{{ f.n }}</button></div>
    <div class="panel cut list">
      <div v-for="r in shown" :key="r.id" class="srow2" :class="{ on: draft.includes(r.id) }" :data-row="r.id" @mouseenter="hover = r" @mouseleave="hover = null">
        <button type="button" class="chk" role="checkbox" :aria-checked="draft.includes(r.id)" :aria-label="r.name" @click="toggle(r)" @focus="hover = r" @blur="hover = null">{{ draft.includes(r.id) ? '☑' : '☐' }}</button>
        <span class="nm"><b>{{ r.name }}</b><small>{{ r.treeName }}・{{ r.tier }} 階<template v-if="r.signature">・招牌</template></small></span>
        <span class="kd">{{ r.kind }}</span>
        <span class="mono cp" :style="{ color: CAT_COLOR[r.category] }">{{ r.cap }}</span>
        <Hint :text="r.text" />
      </div>
      <div v-if="!shown.length" class="empty-note pad" data-empty>這裡沒有學會的技能。學技能在技能樹。</div>
    </div>
    <footer class="panel cut pad ft">
      <span class="grow k" :class="{ why: !!(lock || refused || place) }" data-footer>{{ footer }}</span>
      <span v-if="minutes > 0" class="k mono" data-minutes>套用要花 {{ minutes }} 分鐘</span>
      <button type="button" class="btn sm" @click="ui.open('skills')">打開技能樹</button>
      <ReasonButton sm :reason="lock ?? (changed ? null : '沒有改動。')" @go="reset">還原</ReasonButton>
      <ReasonButton pri :reason="lock ?? place ?? (changed ? null : '沒有改動。')" data-act="apply" @go="apply">套用</ReasonButton>
    </footer>
  </section>
</template>

<style scoped>
.br { display: grid; gap: var(--space-4); }
.grow { flex: 1; min-width: 0; }
.caps { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: var(--space-3) var(--space-6); }
.cap { display: grid; grid-template-columns: 56px minmax(0, 1fr) auto; gap: var(--space-3); align-items: center; }
.cn { font-weight: 900; font-size: var(--fs-sm); }
.cells { display: grid; grid-auto-flow: column; grid-auto-columns: minmax(0, 1fr); gap: var(--space-1); }
.cells i { height: 12px; background: var(--bg-term); border-radius: 2px; }
.cells i.on { background: var(--cc); }
.cells i.pv { background: transparent; box-shadow: inset 0 0 0 2px var(--cc); }
.cells i.over { box-shadow: inset 0 0 0 2px var(--danger); }
.num { font-size: var(--fs-sm); font-weight: 800; white-space: nowrap; }
.fl { margin: 0; }
.list { padding: var(--space-2); display: grid; gap: var(--space-2); }
.srow2 { display: grid; grid-template-columns: 28px minmax(0, 1.2fr) 64px 28px auto; gap: var(--space-3); align-items: center; padding: var(--space-3); background: var(--bg-2); font-size: var(--fs-sm); }
.srow2.on .nm b { color: var(--a-hi); }
.chk { background: none; border: 0; color: var(--ink); font-size: var(--fs-lg); cursor: pointer; padding: 0; }
.nm { display: grid; min-width: 0; }
.nm small { color: var(--ink-3); font-size: var(--fs-fine); }
.kd { font-size: var(--fs-fine); color: var(--ink-3); }
.cp { font-weight: 900; text-align: center; }
.ft { display: flex; gap: var(--space-3); align-items: center; flex-wrap: wrap; }
.why { color: var(--warn); }
@media (max-width: 720px) {
  .caps { grid-template-columns: 1fr; }
  .srow2 { grid-template-columns: 28px minmax(0, 1fr) 28px auto; }
  .srow2 .kd { display: none; }
}
</style>
