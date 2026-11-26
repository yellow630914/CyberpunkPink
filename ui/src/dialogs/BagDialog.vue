<script setup lang="ts">
import { computed, ref } from 'vue'
import Dialog from '../components/Dialog.vue'
import GradeBadge from '../components/GradeBadge.vue'
import Hint from '../components/Hint.vue'
import ItemSlot from '../components/ItemSlot.vue'
import ReasonButton from '../components/ReasonButton.vue'
import MoneyTag from '../components/MoneyTag.vue'
import PendingParts from '../components/PendingParts.vue'
import { partTypeName } from '@engine/src'
import { useEngine } from '../stores/engine'
import { useUi } from '../stores/ui'
import { GRADE_COLOR_NAME, GRADE_LABEL } from '../lib/grade'
import { BAG_FILTERS, EMPTY_FILTERS, bagEntries, legalName, quickCells, quickPut, slotName, weaponLines } from '../lib/gearView'
import { MATERIAL_NAME, QUALITY_NAME, STATE_NAME, dyeOfColors, gradeOf, statLines, weightText } from '../lib/craftView'
import type { BagFilterId } from '../lib/gearView'
import { partStatRows, partTags, quirkLine } from '../lib/partsView'

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
/** 組好的成品：設計圖、每個槽的零件、品質、怪癖、狀態、數值與目錄價（引擎的 productOf 與 productPrice） */
const product = computed(() => (sel.value?.crafted ? eng.craft.detail(sel.value.stack) : null))
const dye = computed(() => (sel.value?.crafted ? dyeOfColors(eng.dye.colorsOf(sel.value.key)) : null))
/** 授權書：用掉就學會它教的設計圖 */
const licence = computed(() => (sel.value && !sel.value.crafted ? eng.craft.licence(sel.value.stack.id) : null))
const uidOf = computed(() => (typeof sel.value?.stack.data?.uid === 'string' ? sel.value.stack.data.uid : undefined))
/** 賣給腳下的店：每一間收這一類的店各一列（引擎的 sellHere：價錢與擋住的原因） */
const sellRows = computed(() => (sel.value ? eng.trade.sellHere(sel.value.stack.id, uidOf.value) : []))
const learnReason = computed(() => (sel.value ? eng.craft.learnBlock({ item: sel.value.stack.id, ...(uidOf.value ? { uid: uidOf.value } : {}) }) : null))
function doLearn() {
  if (!sel.value) return
  const r = eng.craft.learn({ item: sel.value.stack.id, ...(uidOf.value ? { uid: uidOf.value } : {}) })
  if (r.why) ui.toast(r.why, 'warn')
  else ui.toast(r.lines[0] ?? '學會了。')
}
/** 藥：引擎的 drugView.usable 有這一項才列「使用」，擋住的原因是引擎的 */
const drugRow = computed(() => (sel.value && !sel.value.crafted ? eng.body.drugs()?.usable.find((u) => u.item === sel.value!.stack.id) ?? null : null))
function doUse() {
  if (!sel.value || !drugRow.value) return
  const why = eng.body.useDrug(drugRow.value.item)
  if (why) ui.toast(why, 'warn')
  else ui.toast(eng.state.reports.at(-1)?.outcome.summary ?? `用了${sel.value.name}。`)
}
const openCraft = (tab: 'swap' | 'salvage') => ui.open('craft', { tab, uid: sel.value?.key })
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
          <ItemSlot v-for="e in list" :key="e.key" :item="e.slotItem" :qty="e.qty" show-name size="lg" :selected="sel?.key === e.key" :dye="e.crafted ? dyeOfColors(eng.dye.colorsOf(e.key)) : null" :data-key="e.key" @select="selKey = e.key" />
        </div>
        <div class="legendg">
          <span v-for="n in [1, 2, 3, 4, 5] as const" :key="n"><i :style="{ borderColor: `var(--g${n})` }" />{{ GRADE_LABEL[n] }}</span>
          <Hint title="等級色">物品的邊框、名字與等級標用等級的顏色：I {{ GRADE_COLOR_NAME[1] }}、II {{ GRADE_COLOR_NAME[2] }}、III {{ GRADE_COLOR_NAME[3] }}、IV {{ GRADE_COLOR_NAME[4] }}、V {{ GRADE_COLOR_NAME[5] }}。等級色只用在物品上，金色的 IV 級不代表錢。</Hint>
        </div>
        <PendingParts v-if="eng.unreg.pending().length" class="mt" data-bag-pending />
      </section>
      <aside v-if="sel" class="panel cut pad det" :style="{ '--gc': `var(--g${sel.grade})` }" data-detail>
        <div class="head">
          <ItemSlot :item="sel.slotItem" size="lg" inert :dye="dye" />
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
        <template v-if="product">
          <div class="kv" data-product-bp><span>設計圖</span><b>{{ product.info.bp.name }}・{{ product.info.bp.brand }}</b></div>
          <div class="kv"><span>品質</span><b data-quality>{{ QUALITY_NAME[String(sel.stack.data?.quality ?? 'standard')] ?? '標準' }}</b></div>
          <div class="kv"><span>狀態</span><b data-state>{{ STATE_NAME[String(sel.stack.data?.state ?? 'new')] ?? '全新' }}</b></div>
          <div class="kv"><span>價錢<Hint>引擎的目錄價；賣給店家時照店家的收購比例。</Hint></span><b data-price><MoneyTag kind="acc" :amount="product.price" /></b></div>
          <div class="kv"><span>重量</span><b>{{ weightText(product.info.weight) }}</b></div>
          <div class="kv"><span>合法性</span><b>{{ legalName(product.info.legal) }}</b></div>
          <div v-if="statLines(product.info.stats).length" class="chips mt"><span v-for="l in statLines(product.info.stats)" :key="l.key" class="tag" :data-stat="l.key">{{ l.name }} {{ l.text }}</span></div>
          <p class="h mt">組成</p>
          <div v-for="(p, i) in product.info.parts" :key="i" class="kv" data-part :data-part-id="p.part.id"><span>{{ partTypeName(p.type) }}</span><b :style="{ color: `var(--g${gradeOf(p.part.grade)})` }">{{ p.part.name }}<small class="sub">　{{ MATERIAL_NAME[p.part.material] ?? p.part.material }}<template v-if="p.part.state === 'used'">・二手</template><template v-if="p.part.unreg">・未登錄</template></small></b></div>
          <template v-if="product.info.quirks.length">
            <p class="h mt">怪癖與瑕疵</p>
            <div v-for="q in product.info.quirks" :key="q.id" class="kv" data-quirk><span>{{ q.name }}</span><b class="sub">{{ q.desc }}</b></div>
          </template>
        </template>
        <template v-else-if="sel.part">
          <p v-if="sel.part.desc" class="desc" data-part-desc>{{ sel.part.desc }}</p>
          <div class="chips"><span v-for="t in partTags(sel.part)" :key="t" class="tag" :class="{ hot: t === '未登錄' }" data-part-tag>{{ t }}</span></div>
          <div v-if="sel.part.from" class="kv" data-part-from><span>來源</span><b>{{ sel.part.from }}</b></div>
          <div v-for="l in partStatRows(sel.part)" :key="l.key" class="kv" data-part-stat :data-stat-key="l.key"><span>{{ l.name }}</span><b>{{ l.text }}</b></div>
          <div v-if="sel.part.quirk" class="kv" data-part-quirk><span>怪癖</span><b>{{ quirkLine(eng.contentName('quirk', sel.part.quirk) ?? sel.part.quirk, sel.part.quirk_text) }}</b></div>
        </template>
        <div v-else-if="licence" class="kv" data-licence><span>授權書</span><b>教：{{ licence.name }}{{ licence.known ? '（已經會了）' : '' }}</b></div>
        <template v-if="sellRows.length">
          <p class="h mt">賣給這裡</p>
          <div v-for="r in sellRows" :key="r.shop" class="kv" :class="{ 'is-unavailable': !!r.block }" :title="r.block ?? undefined" data-sell-here :data-shop="r.shop"><span>{{ r.name }}</span><b><MoneyTag kind="acc" :amount="r.price" /><small v-if="r.block" class="sub">　{{ r.block }}</small></b></div>
        </template>
        <div class="go">
          <ReasonButton v-if="sel.what" sm pri :reason="equipReason" data-act="equip" @go="doEquip">{{ equipLabel }}</ReasonButton>
          <ReasonButton v-if="sel.quickable" sm :reason="quickReason" data-act="quick" @go="doQuick">放進快取格</ReasonButton>
          <ReasonButton v-if="drugRow" sm pri :reason="drugRow.block" data-act="use" @go="doUse">使用</ReasonButton>
          <ReasonButton v-if="licence" sm pri :reason="learnReason" data-act="learn" @go="doLearn">學會</ReasonButton>
          <template v-if="product">
            <ReasonButton sm data-act="swap" :reason="null" @go="openCraft('swap')">換零件</ReasonButton>
            <ReasonButton sm data-act="salvage" :reason="null" @go="openCraft('salvage')">拆解</ReasonButton>
            <ReasonButton v-if="sel.category !== 'cyberware'" sm data-act="dye" :reason="null" @go="ui.open('dye', { uid: sel.key })">染色</ReasonButton>
          </template>
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
.desc { margin: 0 0 var(--space-3); color: var(--ink-2); font-size: var(--fs-sm); line-height: 1.6; }
.sub { color: var(--ink-3); font-weight: 400; font-size: var(--fs-fine); }
@media (max-width: 860px) { .bag { grid-template-columns: 1fr; } .items { grid-template-columns: repeat(auto-fill, minmax(78px, 1fr)); } }
</style>
