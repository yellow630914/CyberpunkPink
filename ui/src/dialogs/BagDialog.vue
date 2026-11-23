<script setup lang="ts">
import { computed, ref } from 'vue'
import Dialog from '../components/Dialog.vue'
import GradeBadge from '../components/GradeBadge.vue'
import Hint from '../components/Hint.vue'
import ItemSlot from '../components/ItemSlot.vue'
import ReasonButton from '../components/ReasonButton.vue'
import { useEngine } from '../stores/engine'
import { useUi } from '../stores/ui'
import { GRADE_COLOR_NAME, GRADE_LABEL } from '../lib/grade'
import { BAG_FILTERS, EMPTY_FILTERS, bagEntries, compositionOf, quickCells, quickPut, slotName, weaponLines } from '../lib/gearView'
import type { BagFilterId } from '../lib/gearView'

/**
 * 背包（UI.md 3.7 節）：篩選、物品格（等級色＋圖標）、右邊是詳情與操作。內容全部來自引擎的 state.inventory。
 * 裝上、放進快取格都是問引擎、提交引擎的報告；做不到的灰掉，原因是引擎回的那一句。
 */
const props = defineProps<{ entryId: number; stacked?: boolean; select?: string }>()
const eng = useEngine()
const ui = useUi()
const look = eng.gear.look
const NOT_YET = '還沒有開放。'

const filter = ref<BagFilterId>('all')
const selKey = ref<string | null>(props.select ?? null)

const inventory = computed(() => eng.gear.inventory())
const lock = computed(() => eng.gear.lock())
const list = computed(() => bagEntries(look, inventory.value, filter.value))
const total = computed(() => inventory.value.reduce((n, s) => n + s.qty, 0))
const sel = computed(() => list.value.find((e) => e.key === selKey.value) ?? list.value[0] ?? null)
const weapon = computed(() => (sel.value?.category === 'weapon' && sel.value.what ? eng.gear.weapon(sel.value.what) : null))
const parts = computed(() => (sel.value ? compositionOf(look, sel.value.stack) : []))
/** 裝上會佔哪幾格（問引擎的報告草稿） */
const slots = computed(() => (sel.value?.what ? eng.gear.equipSlots(sel.value.what) : []))
const equipReason = computed(() => (sel.value?.what ? eng.gear.equipBlock(sel.value.what) : '這一件不能穿戴。'))
const equipLabel = computed(() => (slots.value.length ? `裝上（${[...new Set(slots.value.map(slotName))].join('、')}）` : '裝上'))
const emptyNote = computed(() => (EMPTY_FILTERS.includes(filter.value) ? '這一類還沒有開放。' : '背包裡沒有這一類的東西。'))

function doEquip() {
  if (!sel.value?.what) return
  const why = eng.gear.equip(sel.value.what)
  if (why) ui.toast(why, 'warn')
  else ui.toast(`${sel.value.name}裝上了。`)
}
const quickReason = computed(() => {
  if (!sel.value?.quickable) return sel.value?.quickWhy ?? '這一件不能放進快取格。'
  return lock.value
})
function doQuick() {
  if (!sel.value) return
  const g = eng.gear.of()
  const cells = quickCells(look, g, eng.gear.quickCapacity())
  // 放進第一個空格；滿了就接在最後，讓引擎擋下並說原因
  const idx = cells.find((c) => !c.item)?.index ?? cells.length
  const why = eng.gear.setQuick(quickPut(g, idx, sel.value.key))
  if (why) ui.toast(why, 'warn')
  else ui.toast(`${sel.value.name}放進快取格了。`)
}
</script>

<template>
  <Dialog :entry-id="entryId" :stacked="stacked" title="背包" :sub="`共 ${total} 件`">
    <div v-if="lock" class="blocking" data-lock>{{ lock }}</div>
    <div class="bag">
      <section class="panel cut pad list">
        <div class="filters" role="toolbar" aria-label="篩選">
          <button v-for="f in BAG_FILTERS" :key="f.id" type="button" :class="{ on: filter === f.id }" :data-filter="f.id" @click="filter = f.id; selKey = null">{{ f.name }}</button>
        </div>
        <div v-if="!list.length" class="empty-note" data-empty>{{ emptyNote }}</div>
        <div class="items">
          <ItemSlot v-for="e in list" :key="e.key" :item="e.slotItem" :qty="e.qty" show-name size="lg" :selected="sel?.key === e.key" :data-key="e.key" @select="selKey = e.key" />
        </div>
        <div class="legendg">
          <span v-for="n in [1, 2, 3, 4, 5] as const" :key="n"><i :style="{ borderColor: `var(--g${n})` }" />{{ GRADE_LABEL[n] }}</span>
          <Hint title="等級色">物品的邊框、名字與等級標用等級的顏色：I {{ GRADE_COLOR_NAME[1] }}、II {{ GRADE_COLOR_NAME[2] }}、III {{ GRADE_COLOR_NAME[3] }}、IV {{ GRADE_COLOR_NAME[4] }}、V {{ GRADE_COLOR_NAME[5] }}。等級色只用在物品上，金色的 IV 級不代表錢。</Hint>
        </div>
      </section>
      <aside v-if="sel" class="panel cut pad det" :style="{ '--gc': `var(--g${sel.grade})` }" data-detail>
        <div class="head">
          <ItemSlot :item="sel.slotItem" size="lg" inert />
          <div>
            <div class="k"><span data-type>{{ sel.type }}</span><template v-if="sel.brand">・{{ sel.brand }}</template></div>
            <h3>{{ sel.name }}</h3>
            <div class="chips">
              <GradeBadge :grade="sel.grade" />
              <span v-if="sel.legal !== '自由'" class="tag warn">{{ sel.legal }}</span>
              <span v-if="sel.qty > 1" class="tag">×{{ sel.qty }}</span>
            </div>
          </div>
        </div>
        <hr class="hr">
        <div v-if="sel.size !== undefined" class="kv"><span>大小</span><b>{{ sel.size }}</b></div>
        <div v-for="l in weapon ? weaponLines(weapon) : []" :key="l.label" class="kv" :data-stat="l.label"><span>{{ l.label }}</span><b>{{ l.value }}</b></div>
        <template v-if="parts.length">
          <p class="h mt">組成</p>
          <div v-for="(p, i) in parts" :key="i" class="kv" data-part><span>{{ p.typeName }}</span><b :style="{ color: `var(--g${p.grade})` }">{{ p.name }}</b></div>
        </template>
        <div class="go">
          <ReasonButton v-if="sel.what" sm pri :reason="equipReason" data-act="equip" @go="doEquip">{{ equipLabel }}</ReasonButton>
          <ReasonButton v-if="sel.quickable" sm :reason="quickReason" data-act="quick" @go="doQuick">放進快取格</ReasonButton>
          <ReasonButton sm :reason="NOT_YET">拆解</ReasonButton>
          <ReasonButton sm :reason="NOT_YET">丟掉</ReasonButton>
        </div>
      </aside>
    </div>
  </Dialog>
</template>

<style scoped>
.bag { display: grid; grid-template-columns: minmax(0, 1fr) 320px; gap: var(--space-4); min-height: 0; }
.items { display: grid; grid-template-columns: repeat(auto-fill, minmax(92px, 1fr)); gap: var(--space-3); }
.legendg { display: flex; gap: var(--space-3); flex-wrap: wrap; align-items: center; font-size: var(--fs-fine); color: var(--ink-3); margin-top: var(--space-3); }
.legendg i { display: inline-block; width: 10px; height: 10px; border-radius: 3px; margin-right: var(--space-2); vertical-align: -1px; border: 2px solid; }
.det h3 { margin: var(--space-1) 0 6px; font-size: var(--fs-section); color: var(--gc); }
.head { display: grid; grid-template-columns: 72px 1fr; gap: var(--space-4); align-items: center; }
.mt { margin-top: var(--space-4); }
@media (max-width: 860px) { .bag { grid-template-columns: 1fr; } .items { grid-template-columns: repeat(auto-fill, minmax(78px, 1fr)); } }
</style>
