<script setup lang="ts">
import Dialog from '../components/Dialog.vue'
import CityMap from '../components/CityMap.vue'
import Hint from '../components/Hint.vue'
import { useGame } from '../stores/game'
import { useUi } from '../stores/ui'
import type { DistrictId } from '../data/types'

/**
 * 城市地圖（UI.md 3.13 節）：從主畫面開的對話框（工具列「城市」或 M）。點區看街區，點街區就過去，對話框跟著關掉。
 * 跨區時用掉的時間照搭車的方式算，這一版固定：同區 8 分鐘、跨區 20 分鐘。
 */
const props = defineProps<{ entryId: number; stacked?: boolean }>()
const g = useGame()
const ui = useUi()
function go(d: DistrictId, block: string) {
  const from = g.loc.block
  if (d !== g.loc.district || block !== g.loc.block) {
    g.advance(d === g.loc.district ? 8 : 20)
    g.moveBlock(d, block, from)
    ui.toast(`到了${g.district.name}・${block}。`)
  }
  ui.close(props.entryId)
}
</script>

<template>
  <Dialog :entry-id="entryId" :stacked="stacked" title="城市地圖" :sub="`你在 ${g.district.name}・${g.loc.block}`" size="lg">
    <template #header><Hint title="城市地圖">點一個區看它的街區，再點街區就過去，這個框跟著關掉。同區換街區 8 分鐘，跨區 20 分鐘（搭車的時間，這一版固定）。快捷鍵 M。</Hint></template>
    <CityMap :current="g.loc.district" :current-block="g.loc.block" @go="go" />
  </Dialog>
</template>
