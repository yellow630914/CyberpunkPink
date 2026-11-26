<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { REQUEST_MAX } from '@engine/src/features/unreg/model'
import type { OrderInput } from '@engine/src/features/unreg'
import Dialog from '../components/Dialog.vue'
import Hint from '../components/Hint.vue'
import MoneyTag from '../components/MoneyTag.vue'
import PendingParts from '../components/PendingParts.vue'
import ReasonButton from '../components/ReasonButton.vue'
import { useEngine } from '../stores/engine'
import { useUi } from '../stores/ui'
import { moveWant, toggleWant } from '../lib/partsView'

/**
 * 委託台（M4-ui-parts 第 4 項；CRAFTING 11.1 節「訂做」、SITES 13.5 節）：站在帶 unreg_desk 的設施上（同人社團的攤位）才開得起來。
 * 選類型、材質、等級；勾想要的方向並排順序（先勾的排前面）；同人眾好感夠時有兩筆怪癖二選一；選填一句描述（80 字）。
 * 價錢、幾天、能不能訂、擋住的原因（逐字）全是引擎的 orderOptions／orderBlock；進行中的訂單在右邊，時間到了、人在委託台按「取貨」（Game.unregDeliver）。
 * 這個畫面不組零件的數字與名字：框架在下單的那一刻由引擎定，名字與說明在交貨時才有。
 */
defineProps<{ entryId: number; stacked?: boolean }>()
const e = useEngine()
const ui = useUi()

const view = computed(() => e.unreg.orderView())
const types = computed(() => view.value.types)
const type = ref('')
const material = ref<'mech' | 'bio'>('mech')
const grade = ref(1)
const want = ref<string[]>([])
const quirk = ref<string>('')
const request = ref('')

watch(types, (list) => { if (!list.some((t) => t.id === type.value)) type.value = list[0]?.id ?? '' }, { immediate: true })
const typeRow = computed(() => types.value.find((t) => t.id === type.value) ?? null)
// 換類型：方向、怪癖重來；沒有生體版的退回機械
watch(type, () => {
  want.value = []
  quirk.value = ''
  if (typeRow.value && !typeRow.value.bio) material.value = 'mech'
})
const quirks = computed(() => typeRow.value?.quirks ?? [])
watch(quirks, (q) => { if (quirk.value !== '' && !q.some((x) => x.id === quirk.value)) quirk.value = '' })
const gradeRows = computed(() => view.value.grades)
watch(gradeRows, (rows) => { if (rows.length && !rows.some((g) => g.grade === grade.value)) grade.value = rows[0]!.grade }, { immediate: true })
const gradeRow = computed(() => gradeRows.value.find((g) => g.grade === grade.value) ?? null)

const input = computed<OrderInput>(() => ({
  type: type.value, grade: grade.value, ...(material.value === 'bio' ? { material: 'bio' } : {}),
  ...(want.value.length ? { want: [...want.value] } : {}), ...(quirk.value ? { quirk: quirk.value } : {}), ...(request.value.trim() ? { request: request.value.trim() } : {}),
}))
const reason = computed(() => e.unreg.orderBlock(input.value))
const dirName = (id: string): string => typeRow.value?.directions.find((d) => d.id === id)?.name ?? id

async function order() {
  const r = await e.unreg.order(input.value)
  if (r.status !== 'applied') { ui.toast(r.reason ?? '現在訂不了。', 'warn'); return }
  ui.toast(e.state.reports.at(-1)?.outcome.summary ?? '下單了。')
  want.value = []
  request.value = ''
}
</script>

<template>
  <Dialog :entry-id="entryId" :stacked="stacked" title="委託台" :sub="view.desk ? `${view.desk.name}・${view.desk.brand}` : '不在委託台'" size="xl">
    <template #header><Hint title="委託台">同人社團接訂做：選類型、材質與等級，勾想要的方向（先勾的排前面），付現金晶片，等幾天回來取貨。拿到的是世界上只有一件的未登錄零件：數字照你選的方向由引擎定，名字、說明與怪癖那一句在交貨時才有。同時只能有幾張訂單、等級有上限，都寫在下面。</Hint></template>

    <div v-for="(b, i) in view.blocks" :key="i" class="blocking mb" data-order-block>{{ b }}</div>

    <div class="od">
      <section class="panel cut pad stack" data-order-form>
        <p class="h">訂一件</p>
        <label class="pick">類型
          <select v-model="type" data-type><option v-for="t in types" :key="t.id" :value="t.id">{{ t.name }}</option></select>
        </label>
        <div class="pick"><span>材質</span>
          <div class="chips">
            <button type="button" class="btn sm" :class="{ pri: material === 'mech' }" :aria-pressed="material === 'mech'" data-material="mech" @click="material = 'mech'">機械</button>
            <button type="button" class="btn sm" :class="{ pri: material === 'bio' }" :aria-pressed="material === 'bio'" :aria-disabled="typeRow && !typeRow.bio ? 'true' : undefined" data-material="bio" @click="typeRow && !typeRow.bio ? ui.toast('這一類沒有生體版。', 'warn') : (material = 'bio')">生體</button>
          </div>
        </div>
        <div class="pick"><span>等級</span>
          <div class="grades">
            <button v-for="g in gradeRows" :key="g.grade" type="button" class="grade" :class="{ on: grade === g.grade, 'is-unavailable': !!g.block }" :aria-pressed="grade === g.grade" :data-grade="g.grade" @click="grade = g.grade">
              <b>{{ g.roman }} 級</b>
              <span data-grade-price><MoneyTag kind="cash" :amount="g.price" /></span>
              <small data-grade-days>{{ g.days }} 天</small>
              <small v-if="g.block" class="why" data-grade-block>{{ g.block }}</small>
            </button>
          </div>
        </div>
        <div class="pick"><span>想要的方向<Hint title="方向">勾幾個，勾的順序就是排的順序：先勾的排前面，引擎照順序把預算分給它們；沒勾的由社團自己看著辦。這一級放得下幾條屬性、每一條最多幾份，由引擎定。</Hint></span>
          <div v-if="typeRow && typeRow.directions.length" class="chips">
            <button v-for="d in typeRow.directions" :key="d.id" type="button" class="btn sm" :class="{ pri: want.includes(d.id) }" :aria-pressed="want.includes(d.id)" :data-dir="d.id" @click="want = toggleWant(want, d.id)">
              <template v-if="want.includes(d.id)">{{ want.indexOf(d.id) + 1 }}. </template>{{ d.name }}<small v-if="d.grade_min" class="note">　{{ d.grade_min }} 級起</small>
            </button>
          </div>
          <p v-else class="empty-note" data-no-dir>這一類沒有可以指定的方向，社團自己決定。</p>
          <div v-if="want.length > 1" class="order" data-want-order>
            <span v-for="(id, i) in want" :key="id" class="tag">{{ i + 1 }}. {{ dirName(id) }}
              <button type="button" class="mv" aria-label="往前" :disabled="i === 0" @click="want = moveWant(want, id, -1)">↑</button><button type="button" class="mv" aria-label="往後" :disabled="i === want.length - 1" @click="want = moveWant(want, id, 1)">↓</button>
            </span>
          </div>
        </div>
        <div v-if="quirks.length" class="pick" data-quirk-pick><span>怪癖（二選一）<Hint title="怪癖">同人眾對你夠熟，這一類零件的怪癖給你兩筆挑一筆；不挑就由社團隨機抽。</Hint></span>
          <div class="quirks">
            <button type="button" class="qc" :class="{ on: quirk === '' }" :aria-pressed="quirk === ''" data-quirk="" @click="quirk = ''"><b>不挑</b><small>讓社團決定</small></button>
            <button v-for="q in quirks" :key="q.id" type="button" class="qc" :class="{ on: quirk === q.id }" :aria-pressed="quirk === q.id" :data-quirk="q.id" @click="quirk = q.id"><b>{{ q.name }}</b><small>{{ q.desc }}</small></button>
          </div>
        </div>
        <label class="pick">備註（選填，{{ REQUEST_MAX }} 字內）
          <textarea v-model="request" :maxlength="REQUEST_MAX" rows="2" placeholder="例如：想要看起來很低調" data-request />
        </label>
        <div class="sum" data-order-sum>
          <div class="kv"><span>價錢</span><b data-price><MoneyTag v-if="gradeRow" kind="cash" :amount="gradeRow.price" /></b></div>
          <div class="kv"><span>等幾天</span><b data-days>{{ gradeRow?.days ?? 0 }} 天</b></div>
          <div class="kv"><span>身上的現金</span><b><MoneyTag kind="cash" :amount="view.cash" /></b></div>
          <div class="kv"><span>訂單</span><b data-open>{{ view.open }}／{{ view.max_open }} 張</b></div>
        </div>
        <div v-if="reason" class="blocking" data-order-reason>{{ reason }}</div>
        <div class="go"><ReasonButton pri :reason="reason" data-order-go @go="order">下單</ReasonButton></div>
      </section>

      <aside class="stack">
        <section class="panel cut pad" data-orders>
          <PendingParts only="orders" />
        </section>
      </aside>
    </div>
  </Dialog>
</template>

<style scoped>
.mb { margin-bottom: var(--space-3); }
.od { display: grid; grid-template-columns: minmax(0, 1.4fr) minmax(0, 1fr); gap: var(--space-4); align-items: start; }
.stack { display: grid; gap: var(--space-4); }
.panel.stack { gap: var(--space-3); }
.pick { display: grid; gap: var(--space-2); font-size: var(--fs-fine); color: var(--ink-3); font-weight: 700; }
.pick > span { display: inline-flex; align-items: center; gap: var(--space-2); }
.pick select, .pick textarea { background: var(--bg-1); color: var(--ink); border: 0; box-shadow: inset 0 0 0 2px var(--line-2); padding: 7px 9px; font: inherit; max-width: 420px; }
.chips { display: flex; gap: var(--space-2); flex-wrap: wrap; }
.note { color: var(--ink-3); font-weight: 400; }
.grades { display: flex; gap: var(--space-3); flex-wrap: wrap; }
.grade { display: grid; gap: 2px; justify-items: start; min-width: 124px; padding: var(--space-3); background: var(--bg-2); border: 0; color: var(--ink); font: inherit; text-align: left; cursor: pointer; box-shadow: inset 0 0 0 2px var(--line-2); }
.grade.on { box-shadow: inset 0 0 0 2px var(--a); }
.grade small { color: var(--ink-3); font-size: var(--fs-xs); }
.grade .why { color: var(--warn); font-weight: 700; max-width: 220px; }
.order { display: flex; gap: var(--space-2); flex-wrap: wrap; }
.mv { background: var(--bg-3); border: 0; color: var(--ink-2); font: inherit; padding: 0 5px; cursor: pointer; margin-left: 2px; }
.mv:disabled { opacity: .4; cursor: default; }
.quirks { display: grid; grid-template-columns: repeat(auto-fit, minmax(min(100%, 190px), 1fr)); gap: var(--space-3); }
.qc { display: grid; gap: 2px; padding: var(--space-3); background: var(--bg-2); border: 0; color: var(--ink); font: inherit; text-align: left; cursor: pointer; box-shadow: inset 0 0 0 2px var(--line-2); }
.qc.on { box-shadow: inset 0 0 0 2px var(--a); }
.qc small { color: var(--ink-3); font-size: var(--fs-xs); line-height: 1.5; }
.go { display: flex; gap: var(--space-3); }
@media (max-width: 860px) { .od { grid-template-columns: 1fr; } }
</style>
