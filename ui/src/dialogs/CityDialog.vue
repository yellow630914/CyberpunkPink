<script setup lang="ts">
import { computed, ref } from 'vue'
import Dialog from '../components/Dialog.vue'
import CityMap from '../components/CityMap.vue'
import Hint from '../components/Hint.vue'
import ReasonButton from '../components/ReasonButton.vue'
import MoneyTag from '../components/MoneyTag.vue'
import { useEngine } from '../stores/engine'
import { useUi } from '../stores/ui'
import { cityMapView, taxiTargetsIn } from '../lib/worldView'

/**
 * 城市地圖（UI.md 3.13 節）：從主畫面開的對話框（工具列「城市」或 M），主要是看自己在哪裡。
 * 區與街區怎麼連、你在哪裡是引擎的（cityGraph、worldView）。點區看街區、點街區看那一塊。
 * 從這裡直接過去只有浮空計程車：能不能叫、車資、公里、時間與做不到的原因都是引擎的（transitView.taxi）；計程車只去車站。
 * 地鐵、輕軌、巴士、渡輪要走到街區圖上的車站，按 E 上車（DISTRICTS 1.2.1 節）。自己的車引擎還沒有，先不能按。
 */
/** block：直接選好一塊街區（連結 #/?dialog=city&block=b_x、測試與截圖用） */
const props = defineProps<{ entryId: number; stacked?: boolean; block?: string }>()
const e = useEngine()
const ui = useUi()
const w = computed(() => e.world.view())
const districts = computed(() => cityMapView(e.world.graph(), (kind, id) => e.world.entry<Record<string, unknown>>(kind, id)))
const target = ref<{ district: string; block: string } | null>(null)
function pick(d: string, block: string) { target.value = { district: d, block } }
const preset = districts.value.find(d => d.blocks.some(b => b.id === props.block))
if (preset && props.block) pick(preset.id, props.block)
const tDistrict = computed(() => districts.value.find(d => d.id === target.value?.district) ?? null)
const tBlock = computed(() => tDistrict.value?.blocks.find(b => b.id === target.value?.block) ?? null)
const taxi = computed(() => e.transit.view().taxi)
const stations = computed(() => (target.value ? taxiTargetsIn(e.transit.view(), target.value.block) : []))
const hereDistrict = computed(() => districts.value.find(d => d.id === w.value.district?.id) ?? null)
const NO_CAR = '自己的車還沒有接上引擎。'

async function callTaxi(key: string) {
  const r = await e.transit.taxi(key)
  if (r.status !== 'applied') { ui.toast(r.reason ?? '叫不到車。', 'warn'); return }
  ui.close(props.entryId)
}
</script>

<template>
  <Dialog :entry-id="entryId" :stacked="stacked" title="城市地圖" :sub="`你在 ${w.district?.name ?? '?'}・${w.block?.name ?? '?'}`" size="lg">
    <template #header><Hint title="城市地圖">看自己在哪裡。點一個區看它的街區，點街區看那一塊。從這裡直接過去只有浮空計程車（帳戶付車資，照距離與目的地的物價算；只去去過的車站）。地鐵、輕軌、巴士、渡輪要走到街區圖上的車站，按 E 上車。快捷鍵 M。</Hint></template>
    <div class="cd">
      <CityMap :districts="districts" :current="w.district?.id ?? null" :current-block="w.block?.id ?? null" :picked-block="target?.block ?? null" :picked-district="preset?.id ?? null" @go="pick" />
      <aside class="panel cut pad info">
        <p class="h">你在這裡</p>
        <div class="kv"><span>位置</span><b>{{ w.district?.name }}・{{ w.block?.name }}</b></div>
        <div v-if="hereDistrict?.security" class="kv"><span>治安</span><b>{{ hereDistrict.security }}</b></div>
        <div class="kv"><span>去過的街區</span><b>{{ w.visited.length }} 塊</b></div>
        <template v-if="target && tDistrict && tBlock">
          <p class="h mt">{{ tDistrict.name }}・{{ tBlock.name }}</p>
          <div v-if="tDistrict.price !== null" class="kv"><span>物價</span><b>×{{ tDistrict.price }}</b></div>
          <div v-if="tDistrict.style" class="kv"><span>主場風格</span><b>{{ tDistrict.style }}</b></div>
          <div class="kv"><span>車站<Hint>大眾運輸要到街區圖上的車站搭：走過去按 E，再選這條線的一站。浮空計程車只載你去去過的車站。</Hint></span><b>{{ stations.length ? stations.map(s => s.name).join('、') : '沒有' }}</b></div>
          <div v-for="s in stations" :key="s.key" class="taxi">
            <ReasonButton pri :reason="s.reason" @go="callTaxi(s.key)">叫計程車到{{ s.name }}站<MoneyTag kind="acc" :amount="s.fare" :size="13" /></ReasonButton>
            <p v-if="s.reason" class="why">{{ s.reason }}</p>
            <p class="t-fine">{{ s.km }} 公里・{{ taxi.minutes }} 分鐘・出發與抵達各擲一次事件</p>
          </div>
          <p v-if="!stations.length" class="why">這塊街區沒有車站，浮空計程車只載你去車站。</p>
          <div class="go"><ReasonButton :reason="NO_CAR">自己開車</ReasonButton></div>
        </template>
        <p v-else class="empty-note mt">點地圖上的區，再點一個街區。</p>
      </aside>
    </div>
  </Dialog>
</template>

<style scoped>
.cd { display: grid; grid-template-columns: minmax(0, 1fr) 300px; gap: var(--space-4); align-items: start; }
.mt { margin-top: var(--space-4); }
.taxi { margin-top: var(--space-3); }
.why { color: var(--warn); font-size: var(--fs-sm); font-weight: 700; margin: var(--space-2) 0 0; }
.go { margin-top: var(--space-3); }
@media (max-width: 900px) { .cd { grid-template-columns: minmax(0, 1fr); } }
</style>
