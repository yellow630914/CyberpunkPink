<script setup lang="ts">
import { computed, ref } from 'vue'
import Dialog from '../components/Dialog.vue'
import CityMap from '../components/CityMap.vue'
import Hint from '../components/Hint.vue'
import ReasonButton from '../components/ReasonButton.vue'
import MoneyTag from '../components/MoneyTag.vue'
import { useGame } from '../stores/game'
import { useUi } from '../stores/ui'
import { useSettings } from '../stores/settings'
import { DISTRICTS, blockSpec } from '../data/districts'
import { linesAt, taxiQuote, taxiBlock, driveBlock, driveMinutes } from '../lib/transit'
import type { DistrictId } from '../data/types'

/**
 * 城市地圖（UI.md 3.13 節）：從主畫面開的對話框（工具列「城市」或 M），主要是看自己在哪裡。
 * 點區看街區、點街區看那一塊的資料。從這裡直接過去只有兩種：叫浮空計程車（要錢）、開自己的車（要有車）。
 * 地鐵、輕軌、巴士、渡輪要走到街區圖上的車站按 E 上車（DISTRICTS 1.2.1 節）。
 */
const props = defineProps<{ entryId: number; stacked?: boolean }>()
const g = useGame()
const ui = useUi()
const st = useSettings()
const NO_FAST = '存檔規則關了快速移動：一律用走的，或在街區圖上的車站搭車。'
const target = ref<{ district: DistrictId; block: string } | null>(null)
function pick(d: DistrictId, block: string) { target.value = { district: d, block } }
const here = computed(() => ({ district: g.loc.district, block: g.loc.block }))
const tDistrict = computed(() => (target.value ? DISTRICTS.find(d => d.id === target.value!.district)! : null))
const tSpec = computed(() => (target.value ? blockSpec(target.value.district, target.value.block) : null))
const tLines = computed(() => (target.value ? linesAt(target.value.block) : []))
const quote = computed(() => (target.value ? taxiQuote(DISTRICTS, here.value, target.value) : null))
const taxiWhy = computed(() => (!st.s.fastTravel ? NO_FAST : target.value && quote.value ? taxiBlock(here.value, target.value, g.money.acc, quote.value.fare) : '先選一個街區。'))
const driveWhy = computed(() => (!st.s.fastTravel ? NO_FAST : target.value ? driveBlock(g.vehicles, here.value, target.value) : '先選一個街區。'))

function arrive(how: string, mins: number) {
  const t = target.value!
  const from = here.value
  g.advance(mins)
  g.moveBlock(t.district, t.block, '@station')
  g.addLog({ prose: [`${how}，從${DISTRICTS.find(d => d.id === from.district)!.name}的${from.block}到${tDistrict.value!.name}的${t.block}，${mins} 分鐘。`] })
  ui.toast(`到了${tDistrict.value!.name}・${t.block}。`)
  ui.close(props.entryId)
}
function taxi() {
  const q = quote.value!
  g.money.acc -= q.fare
  arrive(`你叫了一台浮空計程車（帳戶付 C$${q.fare}，乘客紀錄會留下）`, q.minutes)
}
function drive() { arrive(`你開自己的${g.vehicles[0]}過去`, driveMinutes(here.value, target.value!)) }
</script>

<template>
  <Dialog :entry-id="entryId" :stacked="stacked" title="城市地圖" :sub="`你在 ${g.district.name}・${g.loc.block}`" size="lg">
    <template #header><Hint title="城市地圖">看自己在哪裡。點一個區看它的街區，點街區看那一塊。從這裡直接過去只有浮空計程車（帳戶付車資，照距離與目的地的物價算）與自己的車（不要錢）。地鐵、輕軌、巴士、渡輪要走到街區圖上的車站，按 E 上車。快捷鍵 M。</Hint></template>
    <div class="cd">
      <CityMap :current="g.loc.district" :current-block="g.loc.block" :picked-block="target?.block ?? null" @go="pick" />
      <aside class="panel cut pad info">
        <p class="h">你在這裡</p>
        <div class="kv"><span>位置</span><b>{{ g.district.name }}・{{ g.loc.block }}</b></div>
        <div class="kv"><span>治安</span><b>{{ g.district.security }}</b></div>
        <template v-if="target && tDistrict && tSpec">
          <p class="h mt">{{ tDistrict.name }}・{{ target.block }}</p>
          <div class="kv"><span>物價</span><b>×{{ tDistrict.price }}</b></div>
          <div class="kv"><span>主場風格</span><b>{{ tDistrict.style }}</b></div>
          <div class="kv"><span>設施</span><b>{{ tSpec.facilities.map(f => f.name).slice(0, 4).join('、') }}<template v-if="tSpec.facilities.length > 4">……</template></b></div>
          <div class="kv"><span>車站<Hint>大眾運輸要到街區圖上的車站搭：走過去按 E，再選這條線的一站。</Hint></span><b>{{ tLines.length ? tLines.map(l => l.name).join('、') : '沒有' }}</b></div>
          <div class="go">
            <ReasonButton pri :reason="taxiWhy" @go="taxi">叫計程車<MoneyTag v-if="quote" kind="acc" :amount="quote.fare" :size="13" /></ReasonButton>
            <ReasonButton :reason="driveWhy" @go="drive">自己開車</ReasonButton>
          </div>
          <p v-if="taxiWhy && taxiWhy !== '你就在這裡。'" class="why">{{ taxiWhy }}</p>
          <p v-if="quote" class="t-fine">計程車 {{ quote.km }} 公里・{{ quote.minutes }} 分鐘・出發與抵達各擲一次事件</p>
        </template>
        <p v-else class="empty-note mt">點地圖上的區，再點一個街區。</p>
      </aside>
    </div>
  </Dialog>
</template>

<style scoped>
.cd { display: grid; grid-template-columns: minmax(0, 1fr) 300px; gap: var(--space-4); align-items: start; }
.mt { margin-top: var(--space-4); }
.why { color: var(--warn); font-size: var(--fs-sm); font-weight: 700; margin: var(--space-2) 0 0; }
@media (max-width: 900px) { .cd { grid-template-columns: minmax(0, 1fr); } }
</style>
