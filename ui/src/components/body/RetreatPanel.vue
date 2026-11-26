<script setup lang="ts">
import { computed } from 'vue'
import Hint from '../Hint.vue'
import TrackBar from '../TrackBar.vue'
import ReasonButton from '../ReasonButton.vue'
import { useEngine } from '../../stores/engine'
import { useUi } from '../../stores/ui'

/**
 * 斷線靜修進行中（DOWNTIME 3.3 節；引擎的活動 retreat）：哪一間、還剩幾天、結束時最多降多少，兩個按鈕「待下去」與「提早離開」。
 * 進行中橋是關著的、不能潛入，也做不了別的事；時間到了引擎自己結算（沉溺降多少是它的算法）。
 * 數字與擋住的原因全是引擎的（store 的 body.retreat、stayBlock、leaveBlock）；沒有在靜修時整塊不出現。
 */
const eng = useEngine()
const ui = useUi()
const v = computed(() => eng.body.retreat())
const stayWhy = computed(() => (v.value ? eng.body.stayBlock() : null))
const leaveWhy = computed(() => (v.value ? eng.body.leaveBlock() : null))
const total = computed(() => (v.value ? Math.max(1, v.value.until - v.value.since) : 1))
const spent = computed(() => (v.value ? total.value - v.value.minutes_left : 0))
function stay() {
  const why = eng.body.stay()
  if (why) ui.toast(why, 'warn')
}
function leave() {
  const why = eng.body.leave()
  if (why) ui.toast(why, 'warn')
}
</script>

<template>
  <section v-if="v" class="panel cut pad retreat" data-retreat-panel>
    <p class="h">斷線靜修中<Hint title="斷線靜修">在{{ v.facility }}把橋關起來待著。期間不能潛入，也做不了別的事；待下去一次過一天，時間到了自動結算，沉溺往下降（降不過下限）。提早離開不結算，已經過去的時間不退。</Hint></p>
    <p v-if="eng.body.bridgeClosed()" class="t-fine" data-bridge-closed>橋關著：這段時間技能不算數、容量是 0，已經學會與裝著的都不會丟，橋回來就恢復。</p>
    <div class="kv" data-retreat-where><span>地方</span><b>{{ v.facility }}</b></div>
    <TrackBar :value="spent" :max="total" color="var(--ok)" :height="8" label="" />
    <div class="kv" data-retreat-left><span>還剩</span><b class="mono">{{ v.days_left }} 天</b></div>
    <div class="kv" data-retreat-amount><span>結束時最多降</span><b class="ok-t mono">{{ v.amount }}</b></div>
    <div class="kv" data-retreat-from><span>進來時的沉溺</span><b class="mono">{{ v.from }}</b></div>
    <div v-if="stayWhy" class="blocking" data-reason>{{ stayWhy }}</div>
    <div class="go left">
      <ReasonButton pri :reason="stayWhy" data-act="retreat-stay" @go="stay">待下去</ReasonButton>
      <ReasonButton :reason="leaveWhy" data-act="retreat-leave" @go="leave">提早離開</ReasonButton>
    </div>
  </section>
</template>

<style scoped>
.retreat { display: grid; gap: var(--space-2); align-content: start; }
.go.left { justify-content: flex-start; display: flex; gap: var(--space-3); flex-wrap: wrap; }
</style>
