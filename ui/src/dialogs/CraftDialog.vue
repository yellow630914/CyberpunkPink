<script setup lang="ts">
import { computed, ref } from 'vue'
import Dialog from '../components/Dialog.vue'
import Hint from '../components/Hint.vue'
import ItemSlot from '../components/ItemSlot.vue'
import GradeBadge from '../components/GradeBadge.vue'
import ReasonButton from '../components/ReasonButton.vue'
import MoneyTag from '../components/MoneyTag.vue'
import { useGame } from '../stores/game'
import { useUi } from '../stores/ui'
import { ITEMS } from '../data/items'
import { BLUEPRINTS, CRAFTERS } from '../data/crafting'
import { checkSlot, checkAssembly, successChance, crafterBlock, type BlueprintSlot, type Fill } from '../lib/crafting'
import { attrMod } from '../lib/creation'
import { useGuides } from '../lib/useGuides'

/**
 * 組裝（UI 第 9 節，規則 CRAFTING 第 3、4、6、10 節）。左：會的設計圖；中：槽；右：選中那個槽能裝的零件。
 * 下面是預覽：成品的數值、合法性、難度與它的組成、誰來做與成功率。預覽由引擎的 assemblyPreview() 給，這裡的算法在 lib/crafting.ts。
 * 手機上是三步：選設計圖 → 槽的清單（底部固定一條預覽摘要）→ 點槽從下面列出零件。
 */
defineProps<{ entryId: number; stacked?: boolean }>()
const g = useGame()
const ui = useUi()
useGuides().trigger('g_craft')
const FAMS = ['全部', '義體', '武器', '護甲', '服裝'] as const
const fam = ref<typeof FAMS[number]>('全部')
const known = computed(() => BLUEPRINTS.filter(b => g.inventory.some(s => s.def === b.item)))
const list = computed(() => known.value.filter(b => fam.value === '全部' || b.family === fam.value))
const bpId = ref(BLUEPRINTS[0].item)
const bp = computed(() => BLUEPRINTS.find(b => b.item === bpId.value)!)
const bpDef = computed(() => ITEMS[bp.value.item])
const slotId = ref(bp.value.slots[0].id)
const slot = computed(() => bp.value.slots.find(s => s.id === slotId.value) ?? bp.value.slots[0])
const step = ref<1 | 2 | 3>(1)
for (const b of BLUEPRINTS) if (!g.craftFill[b.item]) g.craftFill[b.item] = {}
const fillIds = computed(() => g.craftFill[bp.value.item])
const fill = computed<Fill>(() => Object.fromEntries(Object.entries(fillIds.value).map(([k, v]) => [k, ITEMS[v]])))
const check = computed(() => checkAssembly(bp.value, fill.value, bpDef.value.legality))
/** 背包裡這個類型的零件，加上每一件能不能裝。 */
const candidates = computed(() => g.inventory.filter(s => ITEMS[s.def].part?.type === slot.value.type).map(s => ({ st: s, def: ITEMS[s.def], c: checkSlot(bp.value, slot.value, ITEMS[s.def]) })))
function pickBp(id: string) { bpId.value = id; slotId.value = BLUEPRINTS.find(b => b.item === id)!.slots[0].id; step.value = 2 }
function pickSlot(s: BlueprintSlot) { slotId.value = s.id; step.value = 3 }
function put(def: string) {
  const need = Object.values(fillIds.value).filter(v => v === def).length + 1
  const have = g.inventory.filter(s => s.def === def).reduce((a, s) => a + s.qty, 0)
  if (need > have) { ui.toast(`背包裡只有 ${have} 件。`, 'warn'); return }
  fillIds.value[slot.value.id] = def
}
function clear() { delete fillIds.value[slot.value.id] }
// ---- 誰來做 ----
const crafterId = ref('self')
const crafter = computed(() => CRAFTERS.find(c => c.id === crafterId.value)!)
const skillName = computed(() => (bp.value.family === '義體' ? '義體學' : '機械'))
const tech = computed(() => g.character.attrs.find(a => a.name === '技術')!.eff)
const selfMod = computed(() => attrMod(tech.value) + (g.basics[skillName.value] ?? 0))
const mod = computed(() => (crafter.value.id === 'self' ? selfMod.value : crafter.value.skill ?? 0))
const chance = computed(() => (crafter.value.skill === undefined ? 100 : successChance(mod.value, check.value.dc)))
const whoBlock = computed(() => crafterBlock(crafter.value, check.value))
const placeBlock = computed(() => (['myhome', 'clinic'].includes(g.loc.facility ?? '') || crafter.value.id === 'fengfeng' ? null : '組裝要在有工作台的據點、診所、槍店或同人社團的攤位。'))
const assembleBlock = computed(() => {
  if (check.value.missing.length) return `還缺必要的零件：${check.value.missing.join('、')}。`
  const bad = Object.values(check.value.bad)[0]
  if (bad) return bad
  if (whoBlock.value) return whoBlock.value
  if (crafter.value.fee > g.money.acc) return `帳戶不夠：工錢 ${crafter.value.fee}。`
  return placeBlock.value
})
function assemble() {
  const d = 1 + Math.floor(Math.random() * 20)
  const ok = crafter.value.skill === undefined || d === 20 || (d !== 1 && d + mod.value >= check.value.dc)
  for (const def of Object.values(fillIds.value)) { const st = g.inventory.find(s => s.def === def); if (st) g.removeItem(st.uid) }
  g.money.acc -= crafter.value.fee
  g.advance(crafter.value.hours * 60)
  const product = ITEMS[bp.value.product]
  g.addItem(bp.value.product, 1, ok ? (d === 20 ? '精工' : '全新') : '瑕疵')
  g.craftFill[bp.value.item] = {}
  g.addLog({ prose: [`${crafter.value.name}照「${bpDef.value.name}」的設計圖組好了一件${product.name}。`], roll: crafter.value.skill === undefined ? undefined : { skill: skillName.value, die: d, mod: mod.value, dc: check.value.dc, result: d === 20 ? '大成功' : d === 1 ? '大失敗' : ok ? '成功' : '失敗' }, changes: [{ text: `${product.name}${ok ? '' : '（帶一個瑕疵）'}`, kind: 'plus' }] })
  ui.toast(ok ? `組好了：${product.name}。` : `組好了，但帶一個瑕疵。`, ok ? 'info' : 'warn')
}
const partStats = computed(() => Object.entries(fill.value).filter(([, d]) => d).map(([k, d]) => ({ slot: bp.value.slots.find(s => s.id === k)!, d: d!, s: d!.stats?.find(x => x[0] === '效果')?.[1] ?? d!.stats?.[0]?.[1] ?? '' })))
const slotLabel = (s: BlueprintSlot) => s.label ?? s.type
const MAT = { 機: '機', 生: '生', 皆: '皆可' }
</script>

<template>
  <Dialog :entry-id="entryId" :stacked="stacked" title="組裝" :sub="`會的設計圖 ${known.length} 張・${g.facility?.name ?? g.loc.block}`" size="xl">
    <template #header>
      <div class="steps"><button v-for="n in [1, 2, 3] as const" :key="n" type="button" :class="{ on: step === n }" @click="step = n">{{ ['設計圖', '槽', '零件'][n - 1] }}</button></div>
      <Hint title="組裝">設計圖寫明一定要哪些零件、可以加哪些。設計圖的等級是零件等級的上限；高一級的零件可以硬塞（超規），難度 +3。難度＝等級的標準 DC＋多一個牌子 +1＋機械接生體的接面每處 +1＋超規。原廠全套有套裝加成。</Hint>
    </template>
    <div class="cr" :data-step="step">
      <!-- 設計圖 -->
      <aside class="panel cut pad bps">
        <div class="filters"><button v-for="f in FAMS" :key="f" type="button" :class="{ on: fam === f }" @click="fam = f">{{ f }}</button></div>
        <button v-for="b in list" :key="b.item" type="button" class="lrow bpr" :class="{ on: b.item === bpId }" @click="pickBp(b.item)">
          <ItemSlot :item="ITEMS[b.item]" size="sm" inert />
          <span class="grow"><b :style="{ color: `var(--g${b.grade})` }">{{ ITEMS[b.item].name }}</b><small>{{ b.family }}・{{ b.brand }}</small></span>
          <GradeBadge :grade="b.grade" />
        </button>
        <div class="empty-note">只列會的設計圖；訂做在店裡。</div>
      </aside>

      <!-- 槽 -->
      <section class="panel cut pad slots">
        <div class="bph"><ItemSlot :item="bpDef" size="md" /><div><div class="k">設計圖・{{ bp.family }}・{{ bp.brand }}</div><h3 :style="{ color: `var(--g${bp.grade})` }">{{ bpDef.name }}</h3><div class="chips"><GradeBadge :grade="bp.grade" /><span class="tag">零件上限 {{ ['', 'I', 'II', 'III', 'IV', 'V'][bp.grade] }}</span><Hint v-if="bpDef.note" :text="bpDef.note" /></div></div></div>
        <button v-for="s in bp.slots" :key="s.id" type="button" class="slotrow" :class="{ on: s.id === slot.id, bad: check.bad[s.id] }" @click="pickSlot(s)">
          <span class="req" :class="{ opt: !s.required }">{{ s.required ? '必要' : '選配' }}</span>
          <span class="sn">{{ slotLabel(s) }}</span>
           <span class="si"><ItemSlot inert :item="fill[s.id] ?? null" size="sm" :slot-icon="`ic-part_${({ 晶片: 'chip', 機械神經元: 'neuron', 軟體: 'software', 板材: 'plate', 致動器: 'actuator', 感測器: 'sensor', 電源: 'power', 外皮: 'skin', 槍管: 'barrel', 機構: 'mech', 刃: 'blade', 纖維: 'fiber' } as Record<string, string>)[s.type]}`" /></span>
          <span class="pn"><b v-if="fill[s.id]" :style="{ color: `var(--g${fill[s.id]!.grade})` }">{{ fill[s.id]!.name }}</b><span v-else class="k">空・點這裡從右邊選</span><small v-if="check.bad[s.id]" class="warn-t">{{ check.bad[s.id] }}</small></span>
          <span class="mat">{{ MAT[s.material] }}</span>
        </button>
      </section>

      <!-- 零件 -->
      <aside class="panel cut pad parts">
        <p class="h">零件・{{ slotLabel(slot) }}<Hint>背包裡這個類型的零件。不收的灰掉並寫原因（材質、等級、挑剔的設計圖）；超規的標出檢定。</Hint></p>
        <div v-if="!candidates.length" class="empty-note">背包裡沒有{{ slot.type }}。</div>
        <button v-for="c in candidates" :key="c.st.uid" type="button" class="lrow pr" :class="{ on: fillIds[slot.id] === c.def.id, 'is-unavailable': !c.c.ok }" :title="c.c.ok ? undefined : c.c.reason ?? undefined" @click="c.c.ok ? put(c.def.id) : ui.toast(c.c.reason!, 'warn')">
          <ItemSlot :item="c.def" size="sm" :qty="c.st.qty" inert />
          <span class="grow">
            <b :style="{ color: `var(--g${c.def.grade})` }">{{ c.def.name }}</b>
            <small>{{ c.def.brand }}・{{ c.st.condition }}・{{ c.def.part!.material }}</small>
            <small v-if="!c.c.ok" class="warn-t">{{ c.c.reason }}</small>
            <small v-else-if="c.c.overspec" class="warn-t">超規：{{ skillName }} DC +3</small>
            <small v-else>{{ c.def.stats?.[0]?.[1] }}</small>
          </span>
        </button>
        <div class="go"><ReasonButton sm :reason="fillIds[slot.id] ? null : '這個槽是空的。'" @go="clear">拿下來</ReasonButton></div>
      </aside>
    </div>

    <!-- 預覽 -->
    <section class="panel cut pad pv">
      <div class="pvg">
        <div>
          <p class="h">預覽・{{ ITEMS[bp.product].name }}</p>
          <div class="chips">
            <span v-for="[k, v] in bp.base" :key="k" class="tag">{{ k }} {{ v }}</span>
            <span v-for="p in partStats" :key="p.slot.id" class="tag up">{{ slotLabel(p.slot) }}：{{ p.s }}</span>
          </div>
          <div class="kv"><span>合法性<Hint>看最高的那個零件。</Hint></span><b :class="{ 'warn-t': check.legality !== '自由' }">{{ check.legality }}</b></div>
          <div class="kv"><span>牌子</span><b>{{ check.brands }} 個{{ check.fullSet ? '・原廠全套' : '' }}</b></div>
          <div v-if="check.fullSet && bp.setBonus" class="kv"><span>套裝加成</span><b class="ok-t">{{ bp.setBonus }}</b></div>
        </div>
        <div>
          <p class="h">難度與誰來做</p>
          <div class="kv"><span>{{ skillName }} DC</span><b class="mono">{{ check.dc }}（{{ check.dcParts.map(([k, v]) => `${k} ${v}`).join('・') }}）</b></div>
          <div class="who">
            <label class="sr-only" for="crafter">誰來做</label>
            <select id="crafter" v-model="crafterId" class="sel">
              <option v-for="c in CRAFTERS" :key="c.id" :value="c.id">{{ c.name }}{{ c.fee ? `・工錢 ${c.fee}` : '' }}・{{ c.hours }} 小時</option>
            </select>
            <Hint v-if="crafter.quality" :text="crafter.quality" />
          </div>
          <div class="kv"><span>成功</span><b class="mono">{{ crafter.skill === undefined ? '穩定成功' : `${chance}%（${skillName} ${mod >= 0 ? '+' : ''}${mod}）` }}</b></div>
          <div class="kv"><span>費用</span><b><MoneyTag kind="acc" :amount="crafter.fee" /></b></div>
        </div>
      </div>
      <div v-if="assembleBlock" class="blocking">{{ assembleBlock }}</div>
      <div class="go">
        <ReasonButton reason="背包裡沒有這張設計圖的成品可以拆。">拆解</ReasonButton>
        <ReasonButton reason="換零件要先有成品：先組一件。">換零件</ReasonButton>
        <ReasonButton pri :reason="assembleBlock" @go="assemble">組裝</ReasonButton>
      </div>
    </section>
  </Dialog>
</template>

<style scoped>
.steps { display: none; gap: 4px; }
.steps button { font-size: var(--fs-sm); font-weight: 800; padding: 6px 10px; background: var(--bg-2); color: var(--ink-3); border: 0; cursor: pointer; }
.steps button.on { background: var(--a); color: #fff; }
.cr { display: grid; grid-template-columns: 260px minmax(0, 1fr) 300px; gap: 12px; align-items: start; }
.bps, .parts { display: grid; gap: 5px; align-content: start; }
.bpr small, .pr small { display: block; color: var(--ink-3); font-size: var(--fs-fine); }
.lrow :deep(.slot) { width: 40px; flex: none; }
.bph { display: grid; grid-template-columns: 64px 1fr; gap: 12px; align-items: center; margin-bottom: 10px; }
.bph h3 { margin: 2px 0 4px; font-size: var(--fs-section); }
.slotrow { display: grid; grid-template-columns: 44px 96px 44px minmax(0, 1fr) 36px; gap: 8px; align-items: center; width: 100%; padding: 6px 8px; background: var(--bg-2); border: 0; color: var(--ink); margin-bottom: 5px; cursor: pointer; text-align: left; }
.slotrow.on { box-shadow: inset 0 0 0 2px var(--a); }
.slotrow.bad { box-shadow: inset 3px 0 0 var(--danger); }
.slotrow .pn small { display: block; }
.req { font-size: var(--fs-tiny); font-weight: 900; padding: 2px 5px; border-radius: 4px; background: var(--b); color: #17111F; text-align: center; }
.req.opt { background: var(--bg-3); color: var(--ink-2); }
.sn { font-weight: 800; font-size: var(--fs-ui); }
.mat { font: 800 var(--fs-fine) var(--mono); color: var(--ink-3); text-align: right; }
.pv { margin-top: 12px; }
.pvg { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); gap: 16px; }
.tag.up { color: var(--ram); }
.who { display: flex; align-items: center; gap: 6px; margin: 6px 0; }
.sel { flex: 1; min-width: 0; background: var(--bg-term); color: var(--ink); border: 0; box-shadow: inset 0 0 0 2px var(--line); padding: 7px 8px; font: 700 var(--fs-ui) var(--font); }
@media (max-width: 1100px) { .cr { grid-template-columns: 240px minmax(0, 1fr); } .parts { grid-column: 1 / -1; } }
@media (max-width: 720px) {
  .steps { display: flex; }
  .cr { grid-template-columns: minmax(0, 1fr); }
  .cr > * { display: none; }
  .cr[data-step="1"] .bps, .cr[data-step="2"] .slots, .cr[data-step="3"] .parts { display: grid; }
  .cr[data-step="3"] .slots { display: block; }
  .slotrow { grid-template-columns: 40px 40px minmax(0, 1fr) 32px; }
  .slotrow .sn { display: none; }
  .pvg { grid-template-columns: 1fr; }
  .pv { position: sticky; bottom: 0; }
}
</style>
