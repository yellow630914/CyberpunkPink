<script setup lang="ts">
import { computed, ref } from 'vue'
import Dialog from '../components/Dialog.vue'
import Tabs from '../components/Tabs.vue'
import Hint from '../components/Hint.vue'
import BoundPanel from '../components/contract/BoundPanel.vue'
import HolderPanel from '../components/contract/HolderPanel.vue'
import { useEngine } from '../stores/engine'
import { useGuides } from '../lib/useGuides'

/**
 * 契約面板（UI 第 11 節，規則 LEWD_SYSTEM 7.4～7.6 節、LIFE 3.4 節；全部讀引擎的 features/contract）。
 * 兩面：「你身上的契約」（主角是契約人：boundView）、「你是持約人」（從名冊上那個人打開：holderContractView、holderEvents）。
 * 兩面都不直接改數值，只有事件的入口與契約的調整；有的那一面才列頁籤，兩面都沒有時只寫一句話。
 */
const props = defineProps<{ entryId: number; stacked?: boolean; npcId?: string; side?: string; page?: string }>()
const eng = useEngine()
useGuides().trigger('g_contract')
const bound = computed(() => eng.contract.bound())
const held = computed(() => eng.contract.held())
const side = ref<'bound' | 'held'>(props.side === 'held' || props.side === 'bound' ? props.side : props.npcId ? 'held' : bound.value ? 'bound' : held.value.length ? 'held' : 'bound')
const sides = computed(() => [
  ...(bound.value ? [{ id: 'bound', label: '你身上的契約' }] : []),
  ...(held.value.length ? [{ id: 'held', label: '你是持約人' }] : []),
])
const npc = ref<string | null>(props.npcId ?? null)
const current = computed(() => (npc.value && held.value.some((h) => h.id === npc.value) ? npc.value : held.value[0]?.id ?? null))
const sub = computed(() => (side.value === 'held' && current.value ? `你是持約人・${eng.contract.nameOf(current.value)}` : bound.value ? '你身上的契約' : '沒有契約'))
</script>

<template>
  <Dialog :entry-id="entryId" :stacked="stacked" title="契約" :sub="sub" size="lg">
    <template v-if="sides.length > 1" #header><Tabs :model-value="side" :tabs="sides" @update:model-value="side = $event as 'bound' | 'held'" /></template>

    <template v-if="!bound && !held.length">
      <section class="panel cut pad" data-none>
        <p class="h">你和別人之間沒有管理級的契約<Hint>讀取級與限制級的橋權寫在雇用合約、貸款與保險裡，大家叫那些「合約」。只有交出管理級橋權的才算契約人，才有指令佇列；你把別人的契約買下來才是持約人，才有事件與契約頁。</Hint></p>
        <div class="empty-note">這份存檔裡沒有契約。</div>
      </section>
    </template>
    <template v-else-if="side === 'held' && held.length">
      <div v-if="held.length > 1" class="segs people" data-people>
        <button v-for="h in held" :key="h.id" type="button" :class="{ on: h.id === current }" :data-person="h.id" @click="npc = h.id">{{ eng.contract.nameOf(h.id) }}</button>
      </div>
      <HolderPanel v-if="current" :key="current" :npc="current" :page="page === 'paper' ? 'paper' : 'events'" />
    </template>
    <BoundPanel v-else-if="bound" />
  </Dialog>
</template>

<style scoped>
.people { margin-bottom: var(--space-4); }
</style>
