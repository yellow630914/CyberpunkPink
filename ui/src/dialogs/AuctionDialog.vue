<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import Dialog from '../components/Dialog.vue'
import Hint from '../components/Hint.vue'
import AuctionLobby from '../components/auction/AuctionLobby.vue'
import AuctionFloor from '../components/auction/AuctionFloor.vue'
import AuctionResult from '../components/auction/AuctionResult.vue'
import { useEngine } from '../stores/engine'

/**
 * 拍賣行（M4-ui-auction；LEWD_SYSTEM 6.2 節、dev/adr/0019 第十八節）：站在帶 auction 的設施上，「這裡」多一項打開它。
 * 三個畫面：會場外面（這一場的時間與階段、會員與推薦、目錄與預展看貨、進場）、拍賣廳裡（一回合一回合的競價）、這一場結束了（落槌與結算）。
 * 畫面只編排：底價、一階、佣金、能不能加價、誰退出、誰得標都是引擎的；競標者的預算與拍品是不是仿品不經過畫面。
 */
const props = defineProps<{ entryId: number; stacked?: boolean; house?: string }>()
const e = useEngine()

const view = computed(() => e.auction.view())
const houses = computed(() => e.auction.here())
const houseId = computed(() => view.value?.house ?? props.house ?? houses.value[0]?.id ?? '')
const houseName = computed(() => view.value?.house_name ?? e.auction.catalog(houseId.value)?.name ?? houses.value.find((h) => h.id === houseId.value)?.name ?? '拍賣行')
const settlement = computed(() => e.auction.settlement())
// 結束的那一刻跳到結算頁；看完按「回到會場」才回到外面
const dismissed = ref<string | null>(null)
const stamp = computed(() => (settlement.value ? `${settlement.value.end.day}:${settlement.value.end.hour}:${settlement.value.end.minute}:${settlement.value.house}` : null))
watch(view, (v, was) => { if (was && !v) dismissed.value = null })
const showResult = computed(() => !view.value && !!settlement.value && dismissed.value !== stamp.value)
const sub = computed(() => (view.value ? `第 ${view.value.lot_no}／${view.value.lot_count} 件・${view.value.pay_name}` : showResult.value ? '這一場結束了' : ''))
</script>

<template>
  <Dialog :entry-id="entryId" :stacked="stacked" :title="houseName" :sub="sub" size="xl">
    <template #header><Hint title="拍賣行">會員制的拍賣：每週一場，目錄先公布、預展可以看貨；進場後一件一件喊，一回合加 1～3 階，連續兩個回合沒人加價就落槌，成交價另收佣金。看出來的仿品不要買；沒看過就標了，拿到手的就是二手或帶瑕疵的。</Hint></template>
    <AuctionFloor v-if="view" :view="view" />
    <AuctionResult v-else-if="showResult && settlement" :settlement="settlement" @back="dismissed = stamp" />
    <AuctionLobby v-else-if="houseId" :house="houseId" />
    <p v-else class="empty-note" data-no-house>這裡不是拍賣行。</p>
  </Dialog>
</template>
