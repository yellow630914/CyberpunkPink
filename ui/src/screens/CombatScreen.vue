<script setup lang="ts">
import { computed } from 'vue'
import { useRoute } from 'vue-router'
import StatusBar from '../components/StatusBar.vue'
import BattleBoard from '../components/combat/BattleBoard.vue'
import { useEngine } from '../stores/engine'
import '../styles/battle.css'

/**
 * 現實戰鬥（全頁，COMBAT_SYSTEM 第 10 節）：外殼。戰鬥的畫面本體是 components/combat/BattleBoard（和內海戰鬥共用一組），這裡只管標題與網址。
 * 規則都在引擎（dev/work/M1-ui-combat.md）；畫面不寫規則。
 * 從子網、地下城、委託連過來：#/combat?enc=<遭遇的 id>&from=/dungeon。?fast=1 讓敵人的回合不等（測試用）。
 */
const route = useRoute()
const engine = useEngine()
const from = computed(() => (typeof route.query.from === 'string' ? route.query.from : '/'))
const fast = computed(() => !!route.query.fast)
const enc = computed(() => (typeof route.query.enc === 'string' ? route.query.enc : undefined))
const place = computed(() => engine.battle?.origin.place ?? '現實戰鬥')
</script>

<template>
  <div class="bt-screen">
    <StatusBar :back="!engine.pendingDefeat" :title="engine.inBattle ? `現實戰鬥：${place}` : '現實戰鬥'" />
    <BattleBoard :from="from" :fast="fast" :enc="enc" fallback />
  </div>
</template>
