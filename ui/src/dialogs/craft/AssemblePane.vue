<script setup lang="ts">
import { computed, reactive, ref, watch } from 'vue'
import GradeBadge from '../../components/GradeBadge.vue'
import Hint from '../../components/Hint.vue'
import ItemSlot from '../../components/ItemSlot.vue'
import MoneyTag from '../../components/MoneyTag.vue'
import ReasonButton from '../../components/ReasonButton.vue'
import PartList from './PartList.vue'
import MakerPicker from './MakerPicker.vue'
import CrewPicker from './CrewPicker.vue'
import ResultNote from './ResultNote.vue'
import { useEngine } from '../../stores/engine'
import { useUi } from '../../stores/ui'
import { AFFINITY_NAME, DEGREE_LABEL, KIND_NAME, MATERIAL_NAME, POOL_NAME, QUALITY_NAME, bpIcon, gradeOf, minutesText, partIcon, partsArg, pct, removePick, statLines, statName, togglePick, weightText } from '../../lib/craftView'
import { legalName } from '../../lib/gearView'
import type { AssembleOpts } from '@engine/src/features/craft'

/**
 * 組裝（UI.md 第 9 節；CRAFTING 第 10.1 節）：左邊是會做的設計圖，中間每個槽一格，右邊是背包裡的零件，下面是預覽。
 * 預覽的每一個數字（難度的每一項、加值、成功率、等級、合法性、價錢、重量、數值、沉溺成本）都是引擎的 assemblyPreview；
 * 這裡只編排：點槽、放零件、選誰來做、送 assembleDraft。手機上是三步：設計圖 → 槽 → 零件，預覽接在下面。
 */
/** blueprint、initial（每個槽先放好的零件）、maker 是打開時的預設（測試與深連結用） */
const props = defineProps<{ blueprint?: string; initial?: Record<string, string[]>; maker?: string }>()
const eng = useEngine()
const ui = useUi()

const FAMS = [{ id: 'all', name: '全部' }, { id: 'cyberware', name: '義體' }, { id: 'weapon', name: '武器' }, { id: 'armor', name: '護甲' }]
const fam = ref('all')
const known = computed(() => eng.craft.known())
const list = computed(() => known.value.filter((b) => fam.value === 'all' || b.kind === fam.value))
const bpId = ref<string>(props.blueprint ?? '')
if (!bpId.value || !known.value.some((b) => b.id === bpId.value)) bpId.value = known.value[0]?.id ?? ''
watch(known, (k) => { if (!k.some((b) => b.id === bpId.value)) bpId.value = k[0]?.id ?? '' })

const picksBy = reactive<Record<string, Record<string, string[]>>>(props.initial && bpId.value ? { [bpId.value]: structuredClone(props.initial) } : {})
const picks = computed(() => picksBy[bpId.value] ?? {})
const slotType = ref('')
const step = ref<1 | 2 | 3>(1)
const polish = ref('')
const payWith = ref<'auto' | 'cred' | 'cash'>('auto')

const byId = ref('')
const makers = computed(() => eng.craft.makers(byId.value || undefined))
const makerId = ref<string>(props.maker ?? makers.value.find((m) => !m.block)?.id ?? 'self')
watch(makers, (ms) => { if (!ms.some((m) => m.id === makerId.value)) makerId.value = ms.find((m) => !m.block)?.id ?? 'self' })

const opts = computed<AssembleOpts>(() => ({
  blueprint: bpId.value, parts: partsArg(picks.value), maker: makerId.value as AssembleOpts['maker'],
  ...(byId.value ? { by: byId.value } : {}),
  ...(payWith.value !== 'auto' ? { pay: payWith.value } : {}),
  ...(polish.value ? { polish: polish.value } : {}),
}))
const preview = computed(() => (bpId.value ? eng.craft.preview(opts.value) : null))
watch(() => preview.value?.result?.polishable, (p) => { if (polish.value && !(p ?? []).includes(polish.value)) polish.value = '' })
watch(preview, (p) => { if (p && p.slots.length && !p.slots.some((s) => s.type === slotType.value)) slotType.value = p.slots[0]!.type }, { immediate: true })
const slot = computed(() => preview.value?.slots.find((s) => s.type === slotType.value) ?? null)
const pickedKeys = computed(() => picks.value[slotType.value] ?? [])

function pickBp(id: string) { bpId.value = id; slotType.value = ''; step.value = 2; done.value = null }
function pickSlot(type: string) { slotType.value = type; step.value = 3 }
function put(key: string) {
  const s = slot.value
  if (!s) return
  const cur = picksBy[bpId.value] ?? (picksBy[bpId.value] = {})
  cur[slotType.value] = togglePick(cur[slotType.value] ?? [], key, s.count)
}
function takeOut(type: string, key: string) {
  const cur = picksBy[bpId.value]
  if (cur) cur[type] = removePick(cur[type] ?? [], key)
}
function clearAll() { picksBy[bpId.value] = {} }

// ---- 做 ----
const done = ref<{ result: string; lines: string[] } | null>(null)
function assemble() {
  const r = eng.craft.assemble(opts.value)
  if (r.why) { ui.toast(r.why, 'warn'); return }
  done.value = { result: r.result, lines: r.lines }
  picksBy[bpId.value] = {}
  polish.value = ''
}

// ---- 授權書 ----
const licences = computed(() => eng.gear.inventory().flatMap((s) => {
  const l = s.qty > 0 ? eng.craft.licence(s.id) : null
  return l ? [{ stack: s, bp: l.name, known: l.known, name: eng.contentName('item', s.id) ?? s.id }] : []
}))
const uidArg = (s: { data?: Record<string, unknown> }): { uid?: string } => (typeof s.data?.uid === 'string' ? { uid: s.data.uid } : {})
function learn(l: (typeof licences.value)[number]) {
  const r = eng.craft.learn({ item: l.stack.id, ...uidArg(l.stack) })
  if (r.why) ui.toast(r.why, 'warn')
  else { done.value = { result: r.result, lines: r.lines }; fam.value = 'all' }
}
const bpName = computed(() => known.value.find((b) => b.id === bpId.value)?.name ?? '')
</script>

<template>
  <div class="asm" :data-step="step">
    <div class="steps"><button v-for="n in [1, 2, 3] as const" :key="n" type="button" :class="{ on: step === n }" @click="step = n">{{ ['設計圖', '槽', '零件'][n - 1] }}</button></div>
    <div class="cr">
      <!-- 設計圖 -->
      <aside class="panel cut pad bps" data-bps>
        <div class="filters"><button v-for="f in FAMS" :key="f.id" type="button" :class="{ on: fam === f.id }" :data-fam="f.id" @click="fam = f.id">{{ f.name }}</button></div>
        <div v-if="!list.length" class="empty-note" data-no-bp>還沒有會做的設計圖。買一張授權書或拆一件成品就會了。</div>
        <button v-for="b in list" :key="b.id" type="button" class="lrow bpr" :class="{ on: b.id === bpId }" :data-bp="b.id" @click="pickBp(b.id)">
          <ItemSlot :item="{ id: b.id, name: b.name, grade: gradeOf(b.grade), icon: bpIcon(b.kind) }" size="sm" inert />
          <span class="grow"><b :style="{ color: `var(--g${gradeOf(b.grade)})` }">{{ b.name }}</b><small>{{ KIND_NAME[b.kind] ?? b.kind }}・{{ b.brand }}</small></span>
          <GradeBadge :grade="gradeOf(b.grade)" />
        </button>
        <template v-if="licences.length">
          <p class="h mt">背包裡的授權書<Hint title="授權書">用掉一張就學會它教的設計圖，之後這張圖永遠會做。</Hint></p>
          <div v-for="l in licences" :key="l.stack.id + (l.stack.data?.uid ?? '')" class="lrow lic" :data-licence="l.stack.id">
            <span class="grow"><b>{{ l.name }}</b><small>教：{{ l.bp }}{{ l.known ? '（已經會了）' : '' }}</small></span>
            <ReasonButton sm :reason="eng.craft.learnBlock({ item: l.stack.id, ...uidArg(l.stack) })" data-learn @go="learn(l)">學會</ReasonButton>
          </div>
        </template>
      </aside>

      <!-- 槽 -->
      <section class="panel cut pad slots" data-slots>
        <template v-if="preview && preview.blueprint">
          <div class="bph">
            <ItemSlot :item="{ id: preview.blueprint.id, name: preview.blueprint.name, grade: gradeOf(preview.blueprint.grade), icon: bpIcon(preview.blueprint.kind) }" size="md" inert />
            <div>
              <div class="k">設計圖・{{ KIND_NAME[preview.blueprint.kind] ?? preview.blueprint.kind }}・{{ preview.blueprint.brand }}</div>
              <h3 :style="{ color: `var(--g${gradeOf(preview.blueprint.grade)})` }">{{ preview.blueprint.name }}</h3>
              <div class="chips"><GradeBadge :grade="gradeOf(preview.blueprint.grade)" /><span class="tag">零件上限同級，高一級算超規</span></div>
            </div>
          </div>
          <div v-for="s in preview.slots" :key="s.type" class="slotbox" :class="{ on: s.type === slotType, bad: s.picked.some((p) => p.problems.length) || s.missing > 0 }" :data-slot="s.type">
            <button type="button" class="slotrow" @click="pickSlot(s.type)">
              <span class="req" :class="{ opt: !s.required }">{{ s.required ? '必要' : '選配' }}</span>
              <span class="sn">{{ s.name }}<template v-if="s.count > 1"> ×{{ s.count }}</template></span>
              <span class="mat">{{ MATERIAL_NAME[s.material] ?? s.material }}<template v-if="s.grade_min"> ≥{{ s.grade_min }}</template></span>
              <span v-if="!s.picked.length" class="pn k">空・點這裡從右邊選</span>
              <span v-else class="pn k">{{ s.picked.length }}／{{ s.count }}</span>
            </button>
            <div v-for="(p, i) in s.picked" :key="p.key + i" class="picked" :data-picked="p.key">
              <ItemSlot :item="{ id: p.id, name: p.name, grade: gradeOf(p.grade), icon: partIcon(s.type) }" size="sm" inert />
              <span class="grow">
                <b :style="{ color: `var(--g${gradeOf(p.grade)})` }">{{ p.name }}</b>
                <small>{{ p.brand }}・{{ MATERIAL_NAME[p.material] ?? p.material }}<template v-if="p.unreg">・未登錄</template></small>
                <small v-if="p.problems.length" class="warn-t">{{ p.problems.join('') }}</small>
                <small v-else-if="p.overspec" class="warn-t" data-overspec-tag>超規</small>
              </span>
              <button type="button" class="btn sm" :aria-label="`拿下${p.name}`" @click="takeOut(s.type, p.key)">拿下來</button>
            </div>
            <div v-if="s.missing > 0" class="warn-t miss">還缺 {{ s.missing }} 個</div>
          </div>
          <div class="go"><button type="button" class="btn sm" @click="clearAll">全部拿下來</button></div>
        </template>
        <div v-else class="empty-note">先在左邊選一張設計圖。</div>
      </section>

      <!-- 零件 -->
      <aside class="panel cut pad parts" data-parts-col>
        <p class="h">零件・{{ slot?.name ?? '' }}<Hint title="零件清單">背包裡的每一個零件。放不進這個槽的灰掉，原因是引擎寫的（類型、材質、等級、挑剔的設計圖）；比設計圖高一級的可以硬塞（超規），難度會升高。</Hint></p>
        <PartList v-if="slot && bpId" :blueprint="bpId" :type="slot.type" :picked="pickedKeys" @pick="put" />
        <div v-else class="empty-note">先選一個槽。</div>
      </aside>
    </div>

    <!-- 預覽 -->
    <section v-if="preview && preview.blueprint" class="panel cut pad pv" data-preview>
      <div class="pvg">
        <div>
          <p class="h">預覽・{{ bpName }}</p>
          <template v-if="preview.result">
            <div class="chips">
              <span v-for="l in statLines(preview.result.stats)" :key="l.key" class="tag up" :data-stat="l.key">{{ l.name }} {{ l.text }}</span>
              <span v-for="(v, k) in preview.result.affinity" :key="k" class="tag" :data-affinity="k">{{ AFFINITY_NAME[k] ?? k }}親和 {{ v > 0 ? `+${v}` : v }}</span>
            </div>
            <div class="kv"><span>等級</span><b data-grade>{{ ['', 'I', 'II', 'III', 'IV', 'V'][preview.result.grade] }}</b></div>
            <div class="kv"><span>合法性<Hint>看設計圖與每個零件裡最嚴的；全生體一律自由。</Hint></span><b data-legal :class="{ 'warn-t': preview.result.legal !== 'free' }">{{ legalName(preview.result.legal) }}</b></div>
            <div class="kv"><span>價錢<Hint>目錄價：零件合計乘上組裝的加成，原廠照精工算，自己動手要看擲出來的品質。</Hint></span><b data-price><MoneyTag kind="acc" :amount="preview.result.price" /></b></div>
            <div class="kv"><span>重量</span><b data-weight>{{ weightText(preview.result.weight) }}</b></div>
            <div class="kv"><span>牌子</span><b data-brands>{{ preview.result.brands.length }} 個{{ preview.result.fullSet ? '・原廠全套' : '' }}</b></div>
            <div v-if="preview.result.seams > 0" class="kv"><span>機械接生體的接面</span><b data-seams>{{ preview.result.seams }}</b></div>
            <div v-if="preview.result.overspec > 0" class="kv"><span>超規的零件</span><b class="warn-t" data-overspec>{{ preview.result.overspec }} 件</b></div>
            <div v-if="preview.result.sink" class="kv"><span>沉溺成本<Hint>設計圖的成本加零件與怪癖給的；裝上身體時才付。</Hint></span><b data-sink>{{ preview.result.sink.total }}（設計圖 {{ preview.result.sink.base }}{{ preview.result.sink.parts ? `，零件 ${preview.result.sink.parts > 0 ? '+' : ''}${preview.result.sink.parts}` : '' }}）</b></div>
            <div class="kv"><span>預期的品質</span><b data-quality>{{ preview.result.quality ? QUALITY_NAME[preview.result.quality] : '看檢定' }}</b></div>
            <div v-if="preview.result.polishable.length" class="kv"><span>精工加在<Hint title="精工">大成功才會用到：你指定的那一項數值 +1；不選就加成品合計最高的那一項。</Hint></span>
              <b><select v-model="polish" class="sel" aria-label="精工的項目" data-polish><option value="">自動（最高的那一項）</option><option v-for="l in preview.result.polishable" :key="l" :value="l">{{ statName(l) }}</option></select></b></div>
          </template>
          <div v-else class="empty-note" data-no-result>放進零件才看得到成品的數字。</div>
        </div>
        <div>
          <p class="h">難度與誰來做</p>
          <CrewPicker v-model="byId" />
          <MakerPicker v-model="makerId" :options="makers" />
          <template v-if="preview.difficulty">
            <div class="kv"><span>難度<Hint title="難度的每一項">設計圖等級的標準 DC，加牌子數、機械接生體的接面、超規、橋與難度偏移。數字都是引擎算的。</Hint></span><b class="mono" data-dc>DC {{ preview.difficulty.total }}</b></div>
            <div v-for="l in preview.difficulty.lines" :key="l.id" class="kv sub" :data-diff="l.id"><span>{{ l.label }}</span><b class="mono">{{ l.value > 0 && l.id !== 'grade' ? `+${l.value}` : l.value }}</b></div>
          </template>
          <template v-if="preview.check">
            <div class="kv"><span>{{ preview.check.skillName }}加值<Hint>屬性、基本功、被動效果與工坊的合計。</Hint></span><b class="mono" data-bonus>{{ preview.check.bonus >= 0 ? '+' : '' }}{{ preview.check.bonus }}</b></div>
            <div class="kv"><span>成功率</span><b class="mono" data-success>{{ pct(preview.check.success) }}</b></div>
            <div class="odds" data-odds><span v-for="d in DEGREE_LABEL" :key="d.id" class="tag" :data-degree="d.id">{{ d.name }} {{ pct(preview.check.odds[d.id]) }}</span></div>
            <div v-if="preview.check.workshop" class="k">有工坊的加成：檢定 +，超規的修正減半。</div>
          </template>
          <div v-else-if="preview.difficulty" class="k" data-sure>{{ makers.find((m) => m.id === makerId)?.name }}：不擲骰，一定成功。</div>
          <div class="kv"><span>工錢</span><b data-fee><template v-if="preview.fee > 0"><MoneyTag :kind="preview.pay === 'cash' ? 'cash' : 'acc'" :amount="preview.fee" />{{ preview.pay ? `（付${POOL_NAME[preview.pay]}）` : '' }}</template><template v-else>不要錢</template></b></div>
          <div v-if="preview.fee > 0" class="kv"><span>付哪一種</span><b><select v-model="payWith" class="sel" aria-label="付哪一種錢"><option value="auto">先帳戶、不夠再現金</option><option value="cred">帳戶</option><option value="cash">現金</option></select></b></div>
          <div class="kv"><span>時間</span><b data-minutes>{{ minutesText(preview.minutes) }}</b></div>
          <div v-if="preview.registered" class="kv"><span>登記</span><b class="warn-t">成品會登記在你名下</b></div>
        </div>
      </div>
      <ul v-if="preview.problems.length" class="problems" data-problems><li v-for="(p, i) in preview.problems" :key="i" class="blocking">{{ p }}</li></ul>
      <div class="go">
        <ReasonButton pri :reason="preview.block" data-assemble @go="assemble">組裝</ReasonButton>
      </div>
    </section>
    <ResultNote v-if="done" :result="done.result" :lines="done.lines" />
  </div>
</template>

<style scoped>
.steps { display: none; gap: 4px; margin-bottom: var(--space-3); }
.steps button { font-size: var(--fs-sm); font-weight: 800; padding: 6px 10px; background: var(--bg-2); color: var(--ink-3); border: 0; cursor: pointer; }
.steps button.on { background: var(--a); color: var(--on-a); }
.cr { display: grid; grid-template-columns: 260px minmax(0, 1fr) 320px; gap: var(--space-4); align-items: start; }
.bps, .parts { display: grid; gap: 5px; align-content: start; }
.bpr small { display: block; color: var(--ink-3); font-size: var(--fs-fine); }
.lrow :deep(.slot) { width: 40px; flex: none; }
.mt { margin-top: var(--space-4); }
.bph { display: grid; grid-template-columns: 64px 1fr; gap: var(--space-4); align-items: center; margin-bottom: var(--space-4); }
.bph h3 { margin: 2px 0 4px; font-size: var(--fs-section); }
.slotbox { margin-bottom: var(--space-3); background: var(--bg-2); }
.slotbox.on { box-shadow: inset 0 0 0 2px var(--a); }
.slotbox.bad { box-shadow: inset 3px 0 0 var(--danger); }
.slotbox.on.bad { box-shadow: inset 0 0 0 2px var(--a), inset 3px 0 0 var(--danger); }
.slotrow { display: grid; grid-template-columns: 44px minmax(0, 1fr) auto auto; gap: var(--space-3); align-items: center; width: 100%; padding: 8px; background: none; border: 0; color: var(--ink); cursor: pointer; text-align: left; }
.req { font-size: var(--fs-fine); font-weight: 900; padding: 2px 5px; border-radius: 4px; background: var(--b); color: #17111F; text-align: center; }
.req.opt { background: var(--bg-3); color: var(--ink-2); }
.sn { font-weight: 800; }
.mat { font: 800 var(--fs-fine) var(--mono); color: var(--ink-3); }
.picked { display: flex; align-items: center; gap: var(--space-3); padding: 4px 8px 8px; }
.picked :deep(.slot) { width: 40px; flex: none; }
.picked small { display: block; color: var(--ink-3); font-size: var(--fs-fine); }
.grow { flex: 1; min-width: 0; }
.miss { padding: 0 8px 8px; font-size: var(--fs-sm); }
.pv { margin-top: var(--space-4); }
.pvg { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); gap: var(--space-5); }
.tag.up { color: var(--ram); }
.kv.sub { padding-left: var(--space-4); font-size: var(--fs-fine); }
.odds { display: flex; gap: 5px; flex-wrap: wrap; margin: 4px 0; }
.problems { list-style: none; margin: var(--space-3) 0 0; padding: 0; display: grid; gap: 4px; }
.sel { background: var(--bg-term); color: var(--ink); border: 0; box-shadow: inset 0 0 0 2px var(--line); padding: 5px 8px; font: 700 var(--fs-sm) var(--font); max-width: 100%; }
.warn-t { color: var(--warn); }
@media (max-width: 1180px) { .cr { grid-template-columns: 240px minmax(0, 1fr); } .parts { grid-column: 1 / -1; } }
@media (max-width: 720px) {
  .steps { display: flex; }
  .cr { grid-template-columns: minmax(0, 1fr); }
  .cr > * { display: none; }
  .asm[data-step="1"] .bps, .asm[data-step="2"] .slots, .asm[data-step="3"] .parts { display: grid; }
  .asm[data-step="2"] .slots { display: block; }
  .pvg { grid-template-columns: 1fr; }
  .slotrow { grid-template-columns: 44px minmax(0, 1fr) auto; }
  .slotrow .pn { display: none; }
}
</style>
