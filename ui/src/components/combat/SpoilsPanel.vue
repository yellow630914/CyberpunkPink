<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import MoneyTag from '../MoneyTag.vue'
import ReasonButton from '../ReasonButton.vue'
import EventBody from '../EventBody.vue'
import SceneGate from './SceneGate.vue'
import { itemName, type Spoils } from '../../lib/afterBattleView'
import { useAfterBattle } from '../../lib/useAfterBattle'
import type { EngineLogEntry } from '../../lib/engineView'
import { useEngine } from '../../stores/engine'

/**
 * 打贏之後（UI.md 第 4 節、COMBAT_SYSTEM 8 節；dev/work/M2-ui-battle-after.md）：戰利品是戰鬥結束那一份報告的內容（拿到的每一樣、現金、結果的每一行，原樣）；
 * 有俘虜可以處置時，接著是事件視窗的選項（帶走、問話、交出去、放走：名字、檢定、原因都是引擎的），嵌在面板裡；選完按「好」，面板關掉。
 */
const props = defineProps<{ spoils: Spoils; place?: string }>()
const emit = defineEmits<{ (e: 'leave'): void }>()
const engine = useEngine()
const after = useAfterBattle()
const evResult = ref<EngineLogEntry | null>(null)
const captive = computed(() => engine.event.view() !== null || evResult.value !== null)
const tiles = computed(() => props.spoils.items.map((i) => ({ ...i, name: itemName(engine.contentName, i.id) })))
onMounted(() => engine.hostEvent(true))
onBeforeUnmount(() => engine.hostEvent(false))
/** 事件做完、結果按了「好」：沒有別的擋著就關面板 */
function dismissed(): void { if (after.holdReason.value === null) emit('leave') }
</script>

<template>
  <section class="panel cut bt-end sp" data-spoils>
    <header class="sp-head">
      <h3>勝利</h3>
      <span v-if="place" class="tag">{{ place }}</span>
    </header>

    <div class="sp-loot" data-loot>
      <b class="h">戰利品</b>
      <div v-if="tiles.length || spoils.cash" class="tiles">
        <span v-for="t in tiles" :key="t.id" class="tile" data-loot-item>{{ t.name }}<small v-if="t.qty > 1"> ×{{ t.qty }}</small></span>
        <span v-if="spoils.cash" class="tile" data-loot-cash><MoneyTag kind="cash" :amount="spoils.cash" /></span>
      </div>
      <p v-else class="t-fine">這一場沒有拿到東西。</p>
    </div>

    <div v-if="spoils.lines.length" class="sp-lines" data-loot-lines>
      <b class="h">戰報</b>
      <ul><li v-for="(l, i) in spoils.lines" :key="i" data-loot-line>{{ l }}</li></ul>
    </div>

    <div v-if="captive" class="sp-captive" data-captive>
      <b class="h">俘虜</b>
      <EventBody v-model:result="evResult" @dismiss="dismissed" />
    </div>
    <SceneGate />

    <div class="bt-btns">
      <ReasonButton :reason="after.holdReason.value" pri data-spoils-leave @go="emit('leave')">離開</ReasonButton>
    </div>
    <p v-if="after.holdReason.value" class="t-fine why" data-hold-reason>{{ after.holdReason.value }}</p>
  </section>
</template>

<style scoped>
.sp { min-width: 0; }
.sp-head { display: flex; align-items: center; gap: var(--space-3); flex-wrap: wrap; }
.sp-loot, .sp-lines, .sp-captive { display: grid; gap: var(--space-3); min-width: 0; }
.h { font-size: var(--fs-label); color: var(--ink-3); letter-spacing: 1px; }
.tiles { display: flex; gap: var(--space-3); flex-wrap: wrap; }
.tile { padding: var(--space-3) var(--space-4); background: var(--bg-2); box-shadow: inset 3px 0 0 var(--ok); font-weight: 800; overflow-wrap: anywhere; }
.tile small { color: var(--ink-2); font-weight: 700; }
.sp-lines ul { margin: 0; padding-left: 1.4em; display: grid; gap: var(--space-2); color: var(--ink-2); font-size: var(--fs-sm); }
.sp-captive { padding: var(--space-4); background: var(--bg-1); box-shadow: inset 3px 0 0 var(--warn); }
.why { color: var(--warn); margin: 0; }
</style>
