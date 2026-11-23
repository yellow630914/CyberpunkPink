<script setup lang="ts">
import { computed } from 'vue'
import type { RideView } from '@engine/src/features/transit'
import { KIND_NAME, PAY_NAME } from '@engine/src/features/transit'
import Hint from './Hint.vue'
import ReasonButton from './ReasonButton.vue'
import { useEngine } from '../stores/engine'
import { useUi } from '../stores/ui'
import { PERIOD_NAME, stripClass } from '../lib/worldView'

/**
 * 搭車中（UI.md 3.14 節）：上車之後，主畫面的地圖區換成這一趟：哪條線往哪個方向、時刻、每站幾分鐘、付款有沒有留紀錄、路線條、
 * 到目的地還有幾站。等車、坐一站、坐到目的地、下車都是引擎的步驟，這裡一個按鈕一個步驟；坐到目的地是一站一站呼叫引擎，路上開了事件就停。
 * 車廂裡的人、車上能做的事、點一站改目的地，引擎還沒有，先不顯示。
 */
const props = defineProps<{ ride: RideView }>()
const e = useEngine()
const ui = useUi()
const platform = computed(() => props.ride.phase === 'platform')
const here = computed(() => props.ride.stops[props.ride.at])

async function step(f: () => Promise<{ status: string; reason?: string }>) {
  const r = await f()
  if (r.status !== 'applied' && r.reason) ui.toast(r.reason, 'warn')
}
async function toDest() {
  const r = await e.transit.rideToDest()
  if (r.stopped === 'event') ui.toast('路上出了事，先處理它。')
  else if (r.stopped === 'blocked' && r.reason) ui.toast(r.reason, 'warn')
  else if (r.stopped === 'dest') ui.toast('到站了。要下車請按「下車」。')
}
const destWhy = computed(() => (props.ride.dest === null ? '上車時沒有選目的地。' : props.ride.toDest === null ? '你已經在目的地了。' : platform.value ? props.ride.actions.wait : props.ride.actions.advance))
</script>

<template>
  <section class="panel cut map pad ride" aria-label="搭車中">
    <span class="tick" />
    <div class="maphd">
      <p class="h">{{ ride.line.name }}<small>{{ KIND_NAME[ride.line.kind] }}</small></p>
      <span class="grow" />
      <Hint title="搭車">大眾運輸不是傳送：等車、上車、一站一站停。「坐到目的地」會一站一站坐，路上觸發了事件就停在那一站，到了目的地也停下來等你按「下車」。付帳戶的會留乘客紀錄，付現金的不留。</Hint>
    </div>
    <p class="sub">
      <template v-if="platform">在{{ here.name }}站的月台等車</template>
      <template v-else>停在{{ here.name }}站</template>
      <template v-if="ride.toward">・往{{ ride.toward }}</template><template v-else>・環線</template>
      ・{{ PERIOD_NAME[ride.period] ?? ride.period }}・每站 {{ ride.minutes_per_stop }} 分鐘・{{ PAY_NAME[ride.pay] }}（{{ ride.recorded ? '留紀錄' : '不留紀錄' }}）
    </p>
    <ol class="strip" aria-label="路線條">
      <li v-for="(s, i) in ride.stops" :key="s.id" :class="stripClass(s)" :aria-current="i === ride.at ? 'true' : undefined">
        <b>{{ s.name }}</b>
        <small v-if="s.dest">目的地</small>
        <small v-else-if="s.state === 'here'">現在</small>
        <small v-if="s.transfers.length">可轉乘</small>
      </li>
    </ol>
    <div class="kv"><span>坐了</span><b>{{ ride.rode }} 站，付了 C${{ ride.paid }}</b></div>
    <div v-if="ride.toDest" class="kv"><span>到{{ ride.dest?.name }}</span><b>還有 {{ ride.toDest.stops }} 站、{{ ride.toDest.minutes }} 分鐘</b></div>
    <div v-else-if="ride.dest" class="kv"><span>目的地</span><b>{{ ride.dest.name }}</b></div>
    <div v-if="ride.toTerminal !== null" class="kv"><span>到終點</span><b>還有 {{ ride.toTerminal }} 站</b></div>
    <div class="acts">
      <ReasonButton v-if="platform" pri :reason="ride.actions.wait" @go="step(e.transit.wait)">等車</ReasonButton>
      <ReasonButton v-else pri :reason="ride.actions.advance" @go="step(e.transit.advance)">坐一站</ReasonButton>
      <ReasonButton :reason="destWhy" @go="toDest">坐到目的地</ReasonButton>
      <ReasonButton @go="step(e.transit.alight)">下車</ReasonButton>
    </div>
  </section>
</template>

<style scoped>
.maphd { display: flex; align-items: center; gap: 8px; margin-bottom: 8px; }
.maphd .h { margin: 0; }
.maphd .h small { margin-left: 8px; color: var(--ink-3); font-size: var(--fs-fine); font-weight: 700; }
.maphd .grow { flex: 1; }
.sub { margin: 0 0 var(--space-4); color: var(--ink-2); font-size: var(--fs-sm); }
.strip { list-style: none; margin: 0 0 var(--space-4); padding: 0; display: grid; grid-template-columns: repeat(auto-fit, minmax(min(100%, 92px), 1fr)); gap: var(--space-3); }
.strip li { display: grid; gap: 2px; padding: var(--space-3); background: var(--bg-2); box-shadow: inset 3px 0 0 var(--line-2); min-width: 0; }
.strip li b { overflow-wrap: anywhere; }
.strip li small { color: var(--ink-3); font-size: var(--fs-fine); }
.strip li.past { opacity: .45; }
.strip li.here { box-shadow: inset 3px 0 0 var(--a), inset 0 0 0 2px var(--a); }
.strip li.dest { box-shadow: inset 0 0 0 2px var(--ap); }
.acts { display: flex; gap: var(--space-3); flex-wrap: wrap; margin-top: var(--space-4); }
</style>
