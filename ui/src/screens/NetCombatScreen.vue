<script setup lang="ts">
import { computed } from 'vue'
import { useRoute } from 'vue-router'
import StatusBar from '../components/StatusBar.vue'
import BattleBoard from '../components/combat/BattleBoard.vue'
import { useEngine } from '../stores/engine'
import '../styles/battle.css'

/**
 * 內海戰鬥（全頁，內海皮；CYBERSPACE 第 5～7 節、dev/adr/0018 第十二節）：外殼。和現實戰鬥是同一組戰鬥元件（components/combat/BattleBoard），
 * 引擎給的戰場資料換字（防火牆、回填、釘住、拔線），另外多同步檔位、追蹤度條、管理行動三塊（NetSync、NetTrace、NetAdmin）。
 * 網址 #/netcombat 只是深連結與內海皮：開哪一場、能做什麼都來自引擎（子網走進遭遇、委託的網內階段）。舊 Demo 的戰鬥規則已經整份拿掉。
 * 打完回哪一頁：?from=（子網與委託會帶）；沒有就回主畫面。
 */
const route = useRoute()
const engine = useEngine()
const from = computed(() => (typeof route.query.from === 'string' ? route.query.from : '/'))
const fast = computed(() => !!route.query.fast)
const enc = computed(() => (typeof route.query.enc === 'string' ? route.query.enc : undefined))
const place = computed(() => engine.battle?.origin.place ?? '')
</script>

<template>
  <div class="bt-screen net">
    <StatusBar back :title="engine.inBattle ? `內海戰鬥${place ? `：${place}` : ''}` : '內海戰鬥'" />
    <BattleBoard :from="from" :fast="fast" :enc="enc" />
  </div>
</template>

<style scoped>
.net :deep(.bt-slot) { background: var(--bg-1); box-shadow: inset 0 0 0 3px var(--line); }
.net :deep(.bt-slot.tg) { box-shadow: inset 0 0 0 3px var(--ok); }
.net :deep(.bt-slot.foc) { box-shadow: inset 0 0 0 3px var(--ok), 0 0 0 3px var(--a); }
.net :deep(.bt-u) { background: var(--bg-2); }
</style>
