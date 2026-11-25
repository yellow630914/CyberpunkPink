<script setup lang="ts">
import { computed, ref } from 'vue'
import Dialog from '../components/Dialog.vue'
import Hint from '../components/Hint.vue'
import Tabs from '../components/Tabs.vue'
import AssemblePane from './craft/AssemblePane.vue'
import SwapPane from './craft/SwapPane.vue'
import SalvagePane from './craft/SalvagePane.vue'
import DissectPane from './craft/DissectPane.vue'
import { useEngine } from '../stores/engine'
import { useGuides } from '../lib/useGuides'

/**
 * 組裝（UI.md 第 9 節，規則 CRAFTING 第 3、4、6、10 節）：組裝、換零件、拆解，與戰後的解剖。
 * 這個對話框只編排：難度、成功率、能不能放進槽、價錢全部是引擎的預覽；按下去送引擎的草稿，結果用引擎的報告顯示。
 * 打開時可以指定分頁（tab）、成品（uid）、設計圖（blueprint）：背包的成品詳情與「這裡」的選項用它。
 */
const props = defineProps<{ entryId: number; stacked?: boolean; tab?: 'assemble' | 'swap' | 'salvage' | 'dissect'; uid?: string; blueprint?: string }>()
const eng = useEngine()
useGuides().trigger('g_craft')
const tab = ref<string>(props.tab ?? 'assemble')
const here = computed(() => eng.craft.here())
const tabs = computed(() => [
  { id: 'assemble', label: '組裝' }, { id: 'swap', label: '換零件' }, { id: 'salvage', label: '拆解' },
  { id: 'dissect', label: '解剖', dot: eng.craft.dissectOptions().length > 0 },
])
const sub = computed(() => `會的設計圖 ${eng.craft.known().length} 張${here.value ? `・${here.value.name}` : ''}`)
</script>

<template>
  <Dialog :entry-id="entryId" :stacked="stacked" title="組裝" :sub="sub" size="xl">
    <template #header>
      <Hint title="組裝">設計圖寫明一定要哪些零件、可以加哪些。設計圖的等級是零件等級的上限；高一級的零件可以硬塞（超規），難度升高。難度、成功率、價錢都是引擎算的，換零件時預覽跟著變。原廠全套有套裝加成。</Hint>
    </template>
    <Tabs v-model="tab" :tabs="tabs" />
    <div class="body-gap">
      <AssemblePane v-if="tab === 'assemble'" :blueprint="blueprint" />
      <SwapPane v-else-if="tab === 'swap'" :uid="uid" />
      <SalvagePane v-else-if="tab === 'salvage'" :uid="uid" />
      <DissectPane v-else />
    </div>
  </Dialog>
</template>

<style scoped>
.body-gap { margin-top: var(--space-4); display: grid; gap: var(--space-4); }
</style>
