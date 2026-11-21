<script setup lang="ts">
import { computed, ref } from 'vue'
import Dialog from '../components/Dialog.vue'
import Hint from '../components/Hint.vue'
import MoneyTag from '../components/MoneyTag.vue'
import ReasonButton from '../components/ReasonButton.vue'
import GradeBadge from '../components/GradeBadge.vue'
import { useGame } from '../stores/game'
import { useUi } from '../stores/ui'
import { VEHICLES, vehicleById, type VehicleDef } from '../data/garage'
import { fmt } from '../lib/price'
import type { Grade } from '../data/types'

/**
 * 修車廠（對話框，ITEMS 14.3 節、CRAFTING 15.6 節）：買載具、看自己的車。買了之後城市地圖的「自己開車」就能用（game.vehicles）。
 * 載具一律登記，車牌綁在橋 ID 上；付帳戶。每週的養車費在週一和帳單一起付。
 */
const props = defineProps<{ entryId: number; stacked?: boolean; place?: string }>()
const g = useGame()
const ui = useUi()
const kind = ref<'all' | VehicleDef['kind']>('all')
const list = computed(() => VEHICLES.filter(v => kind.value === 'all' || v.kind === kind.value))
const owned = computed(() => g.vehicles.map(id => vehicleById(id.replace(/:used$/, ''))).filter(Boolean) as VehicleDef[])
function reason(v: VehicleDef, used: boolean) {
  const p = used ? v.used! : v.price
  if (g.vehicles.some(id => id.replace(/:used$/, '') === v.id)) return '你已經有一台了。'
  if (g.money.acc < p) return `帳戶不夠：要 ${fmt(p)}。`
  return null
}
function buy(v: VehicleDef, used: boolean) {
  const p = used ? v.used! : v.price
  g.money.acc -= p
  g.vehicles.push(used ? `${v.id}:used` : v.id)
  g.addLog({ prose: [`你在${props.place ?? '修車廠'}買下一台${used ? '二手的' : ''}${v.name}。車牌登記在你的橋 ID 上。`], changes: [{ text: `帳戶 −${fmt(p)}`, kind: 'minus' }, { text: `每週養車費 ${v.upkeep}`, kind: 'minus' }] })
  ui.toast(`${v.name}是你的了。城市地圖可以自己開車過去。`)
}
</script>

<template>
  <Dialog :entry-id="entryId" :stacked="stacked" title="修車廠" :sub="`${place ?? '薔薇驛・修車廠'}・載具一律登記`" size="lg">
    <template #header>
      <Hint title="載具">自己的車：哪裡有路就到哪裡，最快，要養、要停（每週的養車費：機車 40、汽車 100、浮空車 300）。在戰鬥裡是叫來的掩體：開打時停在我方第 4 格，那一格算掩體，耐久照表。價格 = 載具基準 × 牌子係數；二手 ×0.65。</Hint>
      <button type="button" class="btn sm" @click="ui.open('mech')">機甲整備</button>
    </template>
    <div class="filters">
      <button v-for="k in (['all', '機車', '汽車', '浮空車'] as const)" :key="k" type="button" :class="{ on: kind === k }" @click="kind = k">{{ k === 'all' ? '全部' : k }}</button>
    </div>
    <div class="grid2 cards">
      <article v-for="v in list" :key="v.id" class="panel cut pad veh" :data-vehicle="v.id">
        <div class="vh"><GradeBadge :grade="(v.grade as Grade)" /><b class="t-card">{{ v.name }}</b><span class="tag">{{ v.brand }}</span><span class="tag">{{ v.kind }}</span></div>
        <p class="t-fine">{{ v.trait }}</p>
        <div class="grid2" style="--col-min: 130px">
          <div class="kv"><span>座位</span><b>{{ v.seats }}</b></div><div class="kv"><span>載貨</span><b>{{ v.cargo }}</b></div>
          <div class="kv"><span>掩體耐久</span><b>{{ v.cover }}</b></div><div class="kv"><span>叫來</span><b>{{ v.call }} 點</b></div>
          <div class="kv"><span>一段路</span><b>{{ v.leg }}</b></div><div class="kv"><span>追逐</span><b>{{ v.chase }}</b></div>
        </div>
        <div class="go">
          <ReasonButton v-if="v.used" sm :reason="reason(v, true)" @go="buy(v, true)">買二手 <MoneyTag kind="acc" :amount="v.used" :size="12" /></ReasonButton>
          <ReasonButton sm pri :reason="reason(v, false)" :data-buy="v.id" @go="buy(v, false)">買 <MoneyTag kind="acc" :amount="v.price" :size="12" /></ReasonButton>
        </div>
      </article>
    </div>
    <p class="h" style="margin-top: 16px">你的車</p>
    <div v-if="!owned.length" class="empty-note">還沒有車。城市地圖的「自己開車」要有車才能用。</div>
    <div class="grid2">
      <div v-for="v in owned" :key="v.id" class="lrow"><span class="grow"><b>{{ v.name }}</b><small>掩體 {{ v.cover }}・養車費 {{ v.upkeep }}／週・停在{{ g.district.name }}</small></span><span class="tag hot">可以開</span></div>
    </div>
  </Dialog>
</template>

<style scoped>
.veh { display: grid; gap: var(--space-3); align-content: start; }
.vh { display: flex; align-items: center; gap: var(--space-3); flex-wrap: wrap; }
.veh .go { margin-top: 0; }
</style>
