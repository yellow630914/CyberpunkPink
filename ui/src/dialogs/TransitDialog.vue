<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { KIND_NAME, PAY_NAME } from '@engine/src/features/transit'
import type { PayKind } from '@engine/src/features/transit'
import Dialog from '../components/Dialog.vue'
import Hint from '../components/Hint.vue'
import ReasonButton from '../components/ReasonButton.vue'
import { useEngine } from '../stores/engine'
import { useUi } from '../stores/ui'

/**
 * 搭車（UI.md 3.14 節、DISTRICTS 1.2.1 節）：在街區圖上的車站按 E 打開。選線、選方向、（可以）選目的地、選付哪種錢，上車。
 * 這一站停哪幾條線、開不開與原因、每一站的車資與分鐘、能不能上車，全部是引擎的（transitView、boardBlock）；這裡只排版。
 * 上車之後人在月台上：主畫面換成路線條，等車、坐一站、下車在那邊做。「上車並坐到目的地」是上車之後一站一站呼叫引擎。
 */
const props = defineProps<{ entryId: number; stacked?: boolean }>()
const e = useEngine()
const ui = useUi()
const view = computed(() => e.transit.view())
const station = computed(() => view.value.station)
const lineId = ref<string | null>(null)
const dir = ref<1 | -1 | null>(null)
const dest = ref<string | null>(null)
const pay = ref<PayKind | null>(null)

const line = computed(() => station.value?.lines.find(l => l.id === lineId.value) ?? station.value?.lines[0] ?? null)
const direction = computed(() => line.value?.directions.find(d => d.dir === dir.value) ?? line.value?.directions[0] ?? null)
/** 付哪種錢：選的，沒選就是付得起的第一種（引擎說付得起的），再沒有就是這條線收的第一種 */
const payKind = computed<PayKind | null>(() => pay.value ?? line.value?.affordable[0] ?? line.value?.pay[0] ?? null)
const input = computed(() => (line.value && payKind.value ? { line: line.value.id, ...(direction.value ? { dir: direction.value.dir } : {}), ...(dest.value ? { dest: dest.value } : {}), pay: payKind.value } : null))
const why = computed(() => (input.value ? e.transit.boardBlock(input.value) : '這裡沒有車可以搭。'))
watch(() => line.value?.id, () => { dir.value = null; dest.value = null; pay.value = null })
watch(() => direction.value?.dir, () => { dest.value = null })
const destName = computed(() => direction.value?.stops.find(s => s.id === dest.value)?.name ?? null)

async function board(andRide: boolean) {
  if (!input.value) return
  const r = await e.transit.board(input.value)
  if (r.status !== 'applied') { ui.toast(r.reason ?? '上不了車。', 'warn'); return }
  ui.close(props.entryId)
  if (andRide && dest.value) {
    const t = await e.transit.rideToDest()
    if (t.stopped === 'blocked' && t.reason) ui.toast(t.reason, 'warn')
    else if (t.stopped === 'dest') ui.toast(`到了${destName.value ?? '目的地'}。要下車請按「下車」。`)
  }
}
</script>

<template>
  <Dialog :entry-id="entryId" :stacked="stacked" title="搭車" :sub="station ? `${station.name}站` : ''" size="md">
    <template #header><Hint title="搭車">大眾運輸不是傳送：等車、上車、一站一站停。上車之後人在月台上，主畫面換成這一趟的路線條；「上車並坐到目的地」會一站一站坐，路上觸發了事件就停在那一站。付帳戶的會留乘客紀錄，付現金的不留。</Hint></template>
    <div v-if="!station" class="empty-note">你不在車站上。走到街區圖上的車站再按 E。</div>
    <template v-else>
      <div class="filters"><button v-for="l in station.lines" :key="l.id" type="button" :class="{ on: l.id === line?.id, 'is-unavailable': !l.open }" :title="l.reason ?? undefined" @click="lineId = l.id">{{ l.name }}</button></div>
      <section v-if="line" class="panel cut pad">
        <p class="h">{{ line.name }}<small class="kind">{{ KIND_NAME[line.kind] }}</small><Hint>每站 {{ line.minutes_per_stop }} 分鐘，等車 {{ line.wait[0] }}～{{ line.wait[1] }} 分鐘。起跳 C${{ line.fare.base }}，每站 C${{ line.fare.per_stop }}。收：{{ line.pay.map(p => PAY_NAME[p]).join('、') }}。<template v-if="line.scan > 0">進站要過掃描（強度 {{ line.scan }}）。</template></Hint></p>
        <p v-if="line.reason" class="why">{{ line.reason }}</p>
        <div v-if="line.directions.length > 1" class="filters" role="group" aria-label="方向"><button v-for="d in line.directions" :key="d.dir" type="button" :class="{ on: d.dir === direction?.dir }" @click="dir = d.dir">往{{ d.toward ?? '下一站' }}</button></div>
        <p v-else-if="direction?.reason" class="why">{{ direction.reason }}</p>
        <ol v-if="direction" class="route">
          <li v-for="s in direction.stops" :key="s.id">
            <button type="button" class="stop" :class="{ to: s.id === dest }" :aria-pressed="s.id === dest" @click="dest = s.id === dest ? null : s.id">
              <b>{{ s.name }}</b><small>{{ s.count }} 站・{{ s.minutes }} 分鐘・C${{ s.fare }}</small>
            </button>
          </li>
        </ol>
        <div v-if="line.pay.length > 1" class="filters" role="group" aria-label="付款"><button v-for="p in line.pay" :key="p" type="button" :class="{ on: p === payKind, 'is-unavailable': !line.affordable.includes(p) }" @click="pay = p">{{ PAY_NAME[p] }}</button></div>
        <div class="go">
          <ReasonButton pri :reason="why" @go="board(false)">上車</ReasonButton>
          <ReasonButton :reason="dest ? why : '先在路線上點一站當目的地。'" @go="board(true)">上車並坐到{{ destName ?? '目的地' }}</ReasonButton>
        </div>
      </section>
    </template>
  </Dialog>
</template>

<style scoped>
.kind { margin-left: 8px; color: var(--ink-3); font-size: var(--fs-fine); font-weight: 700; }
.why { color: var(--warn); font-size: var(--fs-sm); font-weight: 700; margin: 0 0 var(--space-3); }
.route { list-style: none; padding: 0; margin: 0 0 var(--space-4); display: grid; grid-template-columns: repeat(auto-fit, minmax(min(100%, 160px), 1fr)); gap: var(--space-3); }
.stop { width: 100%; display: grid; gap: 2px; text-align: left; padding: var(--space-3) var(--space-4); background: var(--bg-2); border: 0; color: var(--ink); cursor: pointer; box-shadow: inset 3px 0 0 var(--line-2); }
.stop:hover { background: var(--bg-3); }
.stop small { color: var(--ink-3); font-size: var(--fs-fine); }
.stop.to { box-shadow: inset 0 0 0 2px var(--ap); }
.go { display: flex; gap: var(--space-3); flex-wrap: wrap; margin-top: var(--space-3); }
</style>
