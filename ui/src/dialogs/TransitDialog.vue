<script setup lang="ts">
import { computed, ref } from 'vue'
import Dialog from '../components/Dialog.vue'
import Hint from '../components/Hint.vue'
import Icon from '../components/Icon.vue'
import ReasonButton from '../components/ReasonButton.vue'
import { useGame } from '../stores/game'
import { useUi } from '../stores/ui'
import { DISTRICTS } from '../data/districts'
import { linesAt, ride, rideBlock } from '../lib/transit'
import type { LineId } from '../data/transit'

/**
 * 搭車（UI.md 3.14 節、DISTRICTS 1.2.1 節）：在街區圖上的車站按 E 打開。選線、在路線條上點一站，上車坐到那一站。
 * 這一版快轉到目的地（照每站的時間與車資）；車廂裡的人與逐站的事件（EVENTS 4.10 節）在第三版做。
 */
const props = defineProps<{ entryId: number; stacked?: boolean }>()
const g = useGame()
const ui = useUi()
const lines = computed(() => linesAt(g.loc.block))
const lineId = ref<LineId | null>(lines.value[0]?.id ?? null)
const line = computed(() => lines.value.find(l => l.id === lineId.value) ?? null)
const toIdx = ref<number | null>(null)
const money = computed(() => g.money.cash + g.money.acc)
const r = computed(() => (line.value && toIdx.value !== null ? ride(line.value, g.loc.block, toIdx.value) : null))
const why = computed(() => (line.value && toIdx.value !== null ? rideBlock(line.value, g.loc.block, toIdx.value, line.value.id === 'bus' ? g.money.cash : money.value) : '先在路線上點一站。'))
const hereIdx = computed(() => line.value?.stops.findIndex(s => s.block === g.loc.block) ?? -1)
function setLine(id: LineId) { lineId.value = id; toIdx.value = null }
function go() {
  const l = line.value!, rr = r.value!, stop = l.stops[toIdx.value!]
  if (g.money.cash >= rr.fare) g.money.cash -= rr.fare
  else g.money.acc -= rr.fare
  g.advance(rr.minutes)
  g.moveBlock(stop.district, stop.block, '@station')
  g.addLog({ prose: [`你搭${l.name}坐了 ${rr.stops} 站到${stop.name}（等車與車程 ${rr.minutes} 分鐘，車資 C$${rr.fare}）。`] })
  ui.toast(`到了${stop.name}。`)
  ui.close(props.entryId)
}
</script>

<template>
  <Dialog :entry-id="entryId" :stacked="stacked" title="搭車" :sub="`${g.district.name}・${g.loc.block}的車站`" size="md">
    <template #header><Hint title="搭車">大眾運輸不是傳送：等車、上車、一站一站停。這一版上車就快轉到你選的那一站（照每站的時間與車資）；車廂裡的人與逐站的事件在第三版做。地鐵刷帳戶會留紀錄、現金單程票不留；巴士只收現金。</Hint></template>
    <div v-if="!lines.length" class="empty-note">這裡沒有車站。</div>
    <template v-else>
      <div class="filters"><button v-for="l in lines" :key="l.id" type="button" :class="{ on: l.id === lineId }" @click="setLine(l.id)">{{ l.name }}</button></div>
      <section v-if="line" class="panel cut pad">
        <p class="h"><Icon :id="line.icon" :size="20" fit />{{ line.name }}<Hint>{{ line.note }}。每站 {{ line.perStop }} 分鐘，等車大約 {{ line.wait }} 分鐘。付款：{{ line.pay }}。</Hint></p>
        <ol class="route">
          <li v-for="(s, i) in line.stops" :key="s.name">
            <button type="button" class="stop" :class="{ here: i === hereIdx, to: i === toIdx, 'is-unavailable': i === hereIdx }" :aria-pressed="i === toIdx" :disabled="i === hereIdx" @click="toIdx = i">
              <b>{{ s.name }}</b><small>{{ DISTRICTS.find(d => d.id === s.district)!.name }}・{{ s.block }}<template v-if="i === hereIdx">・你在這裡</template></small>
            </button>
          </li>
        </ol>
        <div v-if="r" class="kv"><span>這一趟</span><b>{{ r.stops }} 站・{{ r.minutes }} 分鐘・C${{ r.fare }}</b></div>
        <div class="go"><ReasonButton pri :reason="why" @go="go">上車，坐到這一站</ReasonButton></div>
      </section>
    </template>
  </Dialog>
</template>

<style scoped>
.route { list-style: none; padding: 0; margin: 0 0 var(--space-4); display: grid; grid-template-columns: repeat(auto-fit, minmax(min(100%, 160px), 1fr)); gap: var(--space-3); }
.stop { width: 100%; display: grid; gap: 2px; text-align: left; padding: var(--space-3) var(--space-4); background: var(--bg-2); border: 0; color: var(--ink); cursor: pointer; box-shadow: inset 3px 0 0 var(--line-2); }
.stop:hover { background: var(--bg-3); }
.stop small { color: var(--ink-3); font-size: var(--fs-fine); }
.stop.here { box-shadow: inset 3px 0 0 var(--a); }
.stop.to { box-shadow: inset 0 0 0 2px var(--ap); }
</style>
