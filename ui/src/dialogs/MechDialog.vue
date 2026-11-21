<script setup lang="ts">
import { computed, ref } from 'vue'
import Dialog from '../components/Dialog.vue'
import Hint from '../components/Hint.vue'
import MoneyTag from '../components/MoneyTag.vue'
import ReasonButton from '../components/ReasonButton.vue'
import { useGame } from '../stores/game'
import { useUi } from '../stores/ui'
import { MECH_WEAPONS, PLATE_HP, AUX_PARTS, UPKEEP_WEEK, BACKLASH, mechMax, mechStatus, repairQuote, vehicleById } from '../data/garage'
import { chance } from '../lib/commission'
import { fmt } from '../lib/price'

/**
 * 機甲整備（對話框，CRAFTING 15.7 節、ITEMS 14.2 節；示意頁 mockups/workshop.html#mech）。從據點的整備架或修車廠打開。
 * 全身圖與要的同步、機體耐久（板材那一段、欠整備費扣掉的那一段）、三種槽（換的時候預覽）、啟動時的數值、修理的估價（自己修／送修）、
 * 大修、每週的帳、升級，最下面一列是載具。對話框：它是一個設施裡的服務，關掉回到原處。
 */
defineProps<{ entryId: number; stacked?: boolean }>()
const g = useGame()
const ui = useUi()
const m = g.mech
const GR = ['', 'I', 'II', 'III', 'IV', 'V']
const max = computed(() => mechMax(m))
const status = computed(() => mechStatus(m.hp, max.value))
const plateSum = computed(() => m.plates.reduce((s, x) => s + PLATE_HP[x], 0))
const owedCut = computed(() => Math.min(15, m.owedWeeks * 5))
const pct = (v: number) => `${Math.max(0, Math.min(100, (v / Math.max(1, m.base + plateSum.value)) * 100))}%`
const mySync = 2
const duration = computed(() => 2 + mySync + (m.aux.includes('電源') ? 1 : 0) - (status.value === '重損' ? 1 : 0))
const backlash = computed(() => BACKLASH.map(b => ({ n: b.n, p: Math.max(10, b.p - 5 - (m.aux.includes('機械神經元') ? 5 : 0)) }))) // 野馬：每檔少 5%

// ---- 換裝：選一格，從清單挑一件，預覽怎麼變 ----
type SlotSel = { kind: 'weapon' | 'plate' | 'aux'; i: number } | null
const sel = ref<SlotSel>(null)
const preview = ref<string | null>(null)
function pickSlot(kind: 'weapon' | 'plate' | 'aux', i: number) { sel.value = { kind, i }; preview.value = null }
function previewText(v: string | number | null) {
  if (!sel.value) return ''
  if (sel.value.kind === 'plate') { const g2 = Number(v); const d = PLATE_HP[g2] - PLATE_HP[m.plates[sel.value.i]]; return `機體耐久上限 ${max.value} → ${Math.min(52, max.value + d)}` }
  if (sel.value.kind === 'aux') return v ? `${v}：${AUX_PARTS[v as string]}` : '空著'
  const w = MECH_WEAPONS.find(x => x.name === v)
  return w ? `${w.name}：${w.dmg}、距離 ${w.range}、彈匣 ${w.mag}` : '空著（兩個掛點都空時只有拳頭 2d6）'
}
function apply(v: string | number | null) {
  if (!sel.value) return
  const { kind, i } = sel.value
  if (kind === 'plate') m.plates[i] = Number(v)
  else if (kind === 'aux') m.aux[i] = v as string | null
  else m.weapons[i] = v as string | null
  g.advance(kind === 'weapon' ? 120 : 60)
  ui.toast(`換好了（${kind === 'weapon' ? '2 小時' : '1 小時'}）。`)
  sel.value = null
}

// ---- 修理 ----
const pts = ref(Math.max(0, max.value - m.hp))
const missing = computed(() => Math.max(0, max.value - m.hp))
const qSelf = computed(() => repairQuote(m, pts.value, true))
const qShop = computed(() => repairQuote(m, pts.value, false))
const selfPct = computed(() => chance(4, qSelf.value.dc))
function repair(self: boolean) {
  const q = self ? qSelf.value : qShop.value
  if (pts.value <= 0) { ui.toast('沒有要修的。', 'warn'); return }
  if (g.money.acc < q.money) { ui.toast('帳戶不夠。', 'warn'); return }
  g.money.acc -= q.money
  g.advance(q.hours * 60)
  if (self) {
    const die = 1 + Math.floor(Math.random() * 20)
    if (die + 4 < q.dc) { g.advance(480); ui.toast(`機械 1d20(${die}) + 4 對 ${q.dc}：失敗，多花 8 小時，零件照扣。`, 'warn'); return }
  }
  m.hp = Math.min(max.value, m.hp + pts.value)
  g.addLog({ prose: [`你${self ? '在自己的整備架上' : '送修車廠'}修了野馬 ${pts.value} 點。`], changes: [{ text: `帳戶 −${fmt(q.money)}`, kind: 'minus' }, { text: `板材 −${q.plates}`, kind: 'minus' }] })
  ui.toast(`修好了：機體耐久 ${m.hp}／${max.value}。`)
  pts.value = Math.max(0, max.value - m.hp)
}
const weekly = computed(() => Math.round(UPKEEP_WEEK[m.grade] * m.repairMult))
const upgradeCost = computed(() => Math.round(5040 * 3))
const cars = computed(() => g.vehicles.map(id => vehicleById(id.replace(/:used$/, ''))).filter(Boolean))
</script>

<template>
  <Dialog :entry-id="entryId" :stacked="stacked" title="機甲整備" :sub="`${m.where}・${m.brand} ${m.model} ${GR[m.grade]}`" size="xl">
    <template #header><Hint title="機甲整備">機體耐久在戰鬥之間不會回復；修不起的機甲下一場就帶著傷上場。修理費 = 等級基準 × 0.08 × 修理係數；每週的整備費 = 那一級每週的固定開銷 × 0.25 × 修理係數，欠一週耐久上限 −5（最多 −15）。換一件武器 2 小時，換板材或輔助零件 1 小時。</Hint></template>
    <div class="mech">
      <section class="panel cut pad stack">
        <div class="fig" aria-hidden="true">
          <svg viewBox="0 0 120 140"><path d="M60 8l14 10v16l-14 8l-14-8V18z" /><path d="M36 46h48l8 40H28z" /><path d="M28 50l-16 30l8 6l14-24M92 50l16 30l-8 6l-14-24" /><path d="M40 88l-6 44h14l6-36h12l6 36h14l-6-44z" /></svg>
        </div>
        <b class="t-card">{{ m.brand }} {{ m.model }} {{ GR[m.grade] }}</b>
        <div class="kv"><span>要的同步</span><b>{{ m.sync }} 級・你 {{ mySync }} 級<span :class="mySync >= m.sync ? 'ok-t' : 'warn-t'">（{{ mySync >= m.sync ? '夠' : '不夠' }}）</span></b></div>
        <div class="kv"><span>修理係數</span><b>×{{ m.repairMult }}</b></div>
        <p class="t-fine">{{ m.brandNote }}</p>
      </section>
      <section class="panel cut pad stack">
        <div class="hp"><span class="k">機體耐久</span><b class="big-num">{{ m.hp }}</b><span class="mono">／{{ max }}</span><span class="tag" :class="{ warn: status !== '完好' }">{{ status }}</span></div>
        <div class="dur"><i class="base" :style="{ width: pct(Math.min(m.hp, m.base)) }" /><i class="plate" :style="{ left: pct(m.base), width: pct(Math.max(0, m.hp - m.base)) }" /><em :style="{ left: pct(m.base) }" /></div>
        <p class="t-fine">骨架 {{ m.base }}＋板材 {{ plateSum }}（上限是同級精英生命 × 0.4 ＝ 52）{{ owedCut ? `−欠整備費 ${owedCut}` : '' }}</p>

        <p class="h">武器掛點</p>
        <div class="slots"><button v-for="(w, i) in m.weapons" :key="'w' + i" type="button" class="ms" :class="{ on: sel?.kind === 'weapon' && sel.i === i, empty: !w }" @click="pickSlot('weapon', i)"><small>{{ i === 0 ? '主武器' : '副武器' }}</small>{{ w ?? '空' }}</button></div>
        <p class="h">板槽</p>
        <div class="slots"><button v-for="(p, i) in m.plates" :key="'p' + i" type="button" class="ms" :class="{ on: sel?.kind === 'plate' && sel.i === i, empty: !p }" @click="pickSlot('plate', i)"><small>板材</small>{{ p ? `板材 ${GR[p]}（+${PLATE_HP[p]}）` : '空' }}</button></div>
        <p class="h">輔助槽</p>
        <div class="slots"><button v-for="(a, i) in m.aux" :key="'a' + i" type="button" class="ms" :class="{ on: sel?.kind === 'aux' && sel.i === i, empty: !a }" @click="pickSlot('aux', i)"><small>輔助</small>{{ a ?? '空' }}</button></div>
        <div v-if="sel" class="swap">
          <p class="h">換成</p>
          <div class="row-list">
            <template v-if="sel.kind === 'weapon'"><button v-for="w in [null, ...MECH_WEAPONS.map(x => x.name)]" :key="String(w)" type="button" class="lrow" @mouseenter="preview = previewText(w)" @focus="preview = previewText(w)" @click="apply(w)">{{ w ?? '拆下（空著）' }}</button></template>
            <template v-else-if="sel.kind === 'plate'"><button v-for="n in [0, 1, 2]" :key="n" type="button" class="lrow" @mouseenter="preview = previewText(n)" @focus="preview = previewText(n)" @click="apply(n)">{{ n ? `板材 ${GR[n]}（+${PLATE_HP[n]}）` : '拆下（空著）' }}</button></template>
            <template v-else><button v-for="a in [null, ...Object.keys(AUX_PARTS)]" :key="String(a)" type="button" class="lrow" @mouseenter="preview = previewText(a)" @focus="preview = previewText(a)" @click="apply(a)">{{ a ?? '拆下（空著）' }}</button></template>
          </div>
          <p class="t-fine">{{ preview ?? '滑過一件看預覽。' }}</p>
        </div>
      </section>
      <aside class="stack">
        <section class="panel cut pad">
          <p class="h">啟動時<Hint>護甲加值、行動點加值、持續回合（照你的同步算好），四個檔位的回灌（機體傷害的百分比回到機師身上）。野馬每檔少 5%。</Hint></p>
          <div class="kv"><span>護甲</span><b>+4</b></div><div class="kv"><span>行動點</span><b>+2／回合</b></div><div class="kv"><span>持續</span><b>{{ duration }} 回合</b></div>
          <div class="bl"><span v-for="b in backlash" :key="b.n">{{ b.n }} {{ b.p }}%</span></div>
        </section>
        <section class="panel cut pad">
          <p class="h">修理的估價</p>
          <div class="stepper"><button type="button" aria-label="少修 5 點" @click="pts = Math.max(0, pts - 5)">−</button><b>{{ pts }}</b><button type="button" aria-label="多修 5 點" @click="pts = Math.min(missing, pts + 5)">＋</button><span class="t-fine">／缺 {{ missing }} 點</span></div>
          <div class="grid2" style="--col-min: 120px; margin-top: 8px">
            <div class="q"><b>自己修</b><small>材料 {{ fmt(qSelf.money) }}・板材 {{ qSelf.plates }}・{{ qSelf.hours }} 小時</small><small>機械 DC {{ qSelf.dc }}・{{ selfPct }}%</small><ReasonButton sm :reason="missing ? null : '已經是滿的。'" @go="repair(true)">自己修</ReasonButton></div>
            <div class="q"><b>送修</b><small>{{ fmt(qShop.money) }}・板材 {{ qShop.plates }}・{{ qShop.hours }} 小時</small><small>不用擲</small><ReasonButton sm pri :reason="missing ? null : '已經是滿的。'" data-repair @go="repair(false)">送修</ReasonButton></div>
          </div>
        </section>
        <section class="panel cut pad">
          <p class="h">每週的帳</p>
          <div class="kv"><span>整備費</span><b><MoneyTag kind="acc" :amount="weekly" :size="12" /></b></div>
          <div class="kv"><span>欠了</span><b>{{ m.owedWeeks }} 週</b></div>
          <p class="h">升級</p>
          <p class="t-fine">野馬 III：下一級的骨架價 × 3 ＝ {{ fmt(upgradeCost) }}；板材、致動器、電源各一件（III）；修車廠 3 天；要同步 3 級。</p>
          <ReasonButton sm :reason="mySync < 3 ? '升上去之後要同步 3 級才開得動。' : null" @go="ui.toast('升級在第四版接上。')">升級</ReasonButton>
        </section>
      </aside>
    </div>
    <section class="panel cut pad cars">
      <p class="h">載具</p>
      <div v-if="!cars.length" class="empty-note">沒有車。修車廠買得到。</div>
      <div v-for="c in cars" :key="c!.id" class="kv"><span>{{ c!.name }}</span><b>掩體 {{ c!.cover }}・完好・養車費 {{ c!.upkeep }}／週</b></div>
    </section>
  </Dialog>
</template>

<style scoped>
.mech { display: grid; grid-template-columns: 240px minmax(0, 1fr) 300px; gap: var(--space-4); align-items: start; }
.fig svg { width: 100%; max-width: 160px; display: block; margin: 0 auto; fill: var(--bg-3); stroke: var(--b); stroke-width: 2; }
.hp { display: flex; align-items: baseline; gap: var(--space-3); flex-wrap: wrap; }
.dur { height: 14px; background: var(--bg-term); position: relative; }
.dur i { position: absolute; top: 0; bottom: 0; display: block; }
.dur .base { left: 0; background: var(--ok); }
.dur .plate { background: var(--sink); }
.dur em { position: absolute; top: -3px; width: 2px; height: 20px; background: var(--ink); }
.slots { display: flex; gap: var(--space-2); flex-wrap: wrap; }
.ms { display: grid; text-align: left; min-width: 130px; padding: var(--space-3); background: var(--bg-2); border: 0; color: var(--ink); font: 800 var(--fs-sm) var(--font); cursor: pointer; box-shadow: inset 0 0 0 2px var(--g3); }
.ms.empty { box-shadow: none; outline: 2px dashed var(--line-2); outline-offset: -4px; color: var(--ink-3); }
.ms.on { box-shadow: inset 0 0 0 3px var(--a); }
.ms small { color: var(--ink-3); font-size: var(--fs-tiny); }
.bl { display: flex; gap: var(--space-2); flex-wrap: wrap; margin-top: var(--space-2); }
.bl span { font: 800 var(--fs-xs) var(--mono); padding: 2px 8px; background: var(--bg-2); }
.q { display: grid; gap: 2px; background: var(--bg-2); padding: var(--space-3); justify-items: start; }
.q small { color: var(--ink-3); font-size: var(--fs-fine); }
.cars { margin-top: var(--space-4); }
@media (max-width: 1100px) { .mech { grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); } .mech > :first-child { grid-column: 1 / -1; } }
@media (max-width: 720px) { .mech { grid-template-columns: minmax(0, 1fr); } }
</style>
