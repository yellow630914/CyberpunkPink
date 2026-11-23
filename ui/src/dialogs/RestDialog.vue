<script setup lang="ts">
import { computed } from 'vue'
import Dialog from '../components/Dialog.vue'
import Hint from '../components/Hint.vue'
import MoneyTag from '../components/MoneyTag.vue'
import ReasonButton from '../components/ReasonButton.vue'
import { useEngine } from '../stores/engine'
import { useUi } from '../stores/ui'
import { fmt } from '../lib/price'
import { POOL_NAME, failText, moneyKind, ratePct } from '../lib/lifeView'

/**
 * 休息與住處（UI.md 3.12 節與第 12 節的住處抬頭）：睡一覺與喘口氣的選項照引擎的 sleepOptions（回復率、價錢、選不了的原因）；
 * 住處的抬頭（哪一間、週租、欠了幾週）、租與退。回復多少生命、距上次要隔多久、押金多少全是引擎的；這裡只送出。家園的地圖還沒有開放。
 */
defineProps<{ entryId: number; stacked?: boolean }>()
const e = useEngine()
const ui = useUi()

const home = computed(() => e.rest.home())
const options = computed(() => e.rest.options())
const sleepWhy = computed(() => e.rest.sleepBlock())
const breathWhy = computed(() => e.rest.breathBlock())
const breaths = computed(() => e.rest.breaths())
const residences = computed(() => e.rest.residences())
const leaveWhy = computed(() => e.rest.leaveBlock())

function done(r: { status: string; reason?: string }, fallback: string) {
  const why = failText(r, fallback)
  if (why) { ui.toast(why, 'warn'); return }
  ui.toast(e.state.reports.at(-1)?.outcome.summary ?? '好了。')
}
const sleep = async (spot: 'home' | 'facility' | 'wild') => done(await e.rest.sleep(spot), '現在睡不了。')
const breath = async () => done(await e.rest.breath(), '現在喘不了口氣。')
const rent = async (id: string) => done(await e.rest.rent(id), '現在租不了。')
const leave = async () => done(await e.rest.leave(), '現在退不了租。')
</script>

<template>
  <Dialog :entry-id="entryId" :stacked="stacked" title="休息與住處" :sub="home?.name ?? '沒有住處'" size="lg">
    <template #header><Hint title="休息">睡一覺花 8 小時，感載與餘韻都退，生命回上限的幾成（看睡在哪）；兩次睡一覺之間要隔一段時間。喘口氣花 1 小時，感載與餘韻都退，前幾次還會回一點生命。傷口沒處理過，睡一覺最多只回到一半。</Hint></template>
    <section class="panel cut pad" data-home>
      <p class="h">住處</p>
      <template v-if="home">
        <div class="kv"><span>住的地方</span><b>{{ home.name }}</b></div>
        <div class="kv"><span>週租</span><b><MoneyTag :kind="moneyKind(home.pool)" :amount="home.rent" /></b></div>
        <div class="kv"><span>押金</span><b><MoneyTag :kind="moneyKind(home.pool)" :amount="home.deposit" /></b></div>
        <div class="kv"><span>欠繳</span><b :class="{ 'warn-t': home.arrears > 0 }">{{ home.arrears }} 週<template v-if="home.arrears > 0">（欠到 {{ home.lockWeeks }} 週門鎖會被換掉）</template></b></div>
        <div v-if="home.locked" class="blocking" data-locked>{{ home.name }}的門鎖被換掉了，房租付清才開。</div>
        <div class="go left"><ReasonButton sm :reason="leaveWhy" data-leave @go="leave">退租</ReasonButton><ReasonButton sm reason="還沒有開放。">家園的地圖</ReasonButton></div>
      </template>
      <div v-else class="empty-note">你現在沒有租任何住處。下面挑一處租。</div>
    </section>

    <section class="panel cut pad mt" data-sleep>
      <p class="h">睡一覺</p>
      <div v-if="sleepWhy" class="blocking" data-sleep-why>{{ sleepWhy }}</div>
      <div class="opts">
        <div v-for="o in options" :key="o.id" class="opt" :class="{ cur: o.current, 'is-unavailable': !!o.block }" :data-spot="o.id">
          <b>{{ o.name }}</b><span v-if="o.current" class="tag hot">你在這裡</span><span v-if="o.treated" class="tag" data-treated>算傷口處理過</span>
          <div class="kvl"><span>回復</span><b>生命上限的 {{ ratePct(o.rate) }}</b></div>
          <div class="kvl"><span>價錢</span><MoneyTag v-if="o.cost > 0" :kind="moneyKind(o.pay ?? 'cred')" :amount="o.cost" :size="13" /><b v-else>不用錢</b></div>
          <ReasonButton sm pri :reason="o.block" :data-sleep="o.id" @go="sleep(o.id)">睡一覺</ReasonButton>
        </div>
      </div>
    </section>

    <section class="panel cut pad mt" data-breath>
      <p class="h">喘口氣</p>
      <div class="go left"><ReasonButton sm pri :reason="breathWhy" data-breath-btn @go="breath">喘口氣（1 小時）</ReasonButton></div>
      <div class="empty-note">兩次睡一覺之間，前 {{ breaths.heals }} 次喘口氣會回生命值（已經用了 {{ breaths.used }} 次）。</div>
    </section>

    <section class="panel cut pad mt" data-rent>
      <p class="h">租房</p>
      <div v-for="r in residences" :key="r.id" class="res" :class="{ 'is-unavailable': !!r.block_reason }" :data-res="r.id">
        <span class="grow"><b>{{ r.name }}</b><small>{{ r.block ?? '' }}・第 {{ r.level }} 級・收{{ r.pools.map((p) => POOL_NAME[p]).join('、') }}</small></span>
        <span class="mono">週租 {{ fmt(r.rent) }}・押金 {{ fmt(r.deposit) }}</span>
        <ReasonButton sm :reason="r.block_reason" :data-rent-btn="r.id" @go="rent(r.id)">租</ReasonButton>
      </div>
      <div v-if="!residences.length" class="empty-note">還沒有可以租的地方。</div>
    </section>
  </Dialog>
</template>

<style scoped>
.mt { margin-top: 10px; }
.warn-t { color: var(--warn); }
.go.left { justify-content: flex-start; flex-wrap: wrap; margin-top: 8px; }
.opts { display: grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); gap: 6px; }
.opt { padding: 8px 10px; background: var(--bg-2); display: grid; gap: 4px; align-content: start; min-width: 0; }
.opt.cur { box-shadow: inset 0 0 0 2px var(--a); }
.kvl { display: flex; justify-content: space-between; align-items: center; gap: 8px; font-size: var(--fs-sm); }
.kvl span { color: var(--ink-3); }
.res { display: grid; grid-template-columns: minmax(0, 1fr) auto auto; gap: 10px; align-items: center; padding: 8px 10px; background: var(--bg-2); margin-bottom: 4px; font-size: var(--fs-sm); }
.res small { display: block; color: var(--ink-3); font-size: var(--fs-fine); }
.grow { min-width: 0; }
@media (max-width: 560px) { .res { grid-template-columns: minmax(0, 1fr) auto; } .res .mono { grid-column: 1 / -1; order: 3; } }
</style>
