<script setup lang="ts">
import { computed, watch, watchEffect } from 'vue'
import { useRoute } from 'vue-router'
import DialogHost from './components/DialogHost.vue'
import { useGame } from './stores/game'
import { useSettings } from './stores/settings'
import { useUi, DIALOG_TITLES, type DialogName } from './stores/ui'

/** 外殼：全頁由路由切換，對話框層蓋在上面。子網的全頁換成內海皮。 */
const route = useRoute()
const g = useGame()
const settings = useSettings()
const ui = useUi()
// 換全頁時關掉所有對話框：對話框只屬於打開它的那一頁
watch(() => route.path, () => ui.closeAll())
// 直接連到對話框：#/?dialog=shop&shopId=alian（測試與截圖用，也方便引擎開發時直接打開某個對話框）
watch(() => route.query.dialog, d => {
  if (typeof d === 'string' && d in DIALOG_TITLES) {
    const { dialog: _omit, ...rest } = route.query
    void _omit
    ui.openRoot(d as DialogName, rest as Record<string, unknown>)
  }
}, { immediate: true })
settings.apply()
const skin = computed(() => (route.path === '/subnet' ? 'net' : 'real'))
watchEffect(() => {
  document.documentElement.dataset.skin = skin.value
  document.documentElement.dataset.district = route.path === '/subnet' ? 'net' : g.loc.district
})
</script>

<template>
  <RouterView />
  <DialogHost />
</template>
