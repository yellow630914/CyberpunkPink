<script setup lang="ts">
import { computed } from 'vue'
import type { OwnedItem } from '@engine/src/features/creation'

/**
 * 「身上已經有的」（建角第 6、9 步的側欄）：讀引擎的 creationSummary().owned——出身白給的、日常服裝、這一份草稿已選的義體與裝備。
 * 白給的列在最上面；同類同位置的東西在清單上標「已經有」是各步的清單做的（用同一份資料）。只編排，沒有規則。
 * 第 6 步與第 9 步的側欄列同一份（使用者 2026-11-25）：免得義體與裝備重複挑。
 */
const props = defineProps<{ owned: readonly OwnedItem[] }>()
const CATEGORY: Record<string, string> = {
  weapon: '武器', armor: '護甲', clothing: '服裝', accessory: '飾品', consumable: '消耗品', drug: '藥', ammo: '彈藥', tool: '工具', part: '零件', cargo: '貨物', misc: '雜物',
  cyberware: '義體', deck: '甲板', construct: '構裝', skin: 'SKIN', quickhack: '快駭程式',
}
const shown = computed(() => props.owned)
const kit = computed(() => shown.value.filter((o) => o.from === 'kit'))
const picked = computed(() => shown.value.filter((o) => o.from === 'pick'))
</script>

<template>
  <div class="owned" data-owned>
    <p class="h">身上已經有的<span class="k">（引擎照這份草稿算的）</span></p>
    <p v-if="!shown.length" class="empty-note">還沒有。</p>
    <template v-if="kit.length">
      <p class="sub">出身白給的</p>
      <div v-for="o in kit" :key="`k-${o.id}`" class="oi" data-owned-kit><b>{{ o.name }}<template v-if="o.qty > 1"> ×{{ o.qty }}</template></b><small>{{ CATEGORY[o.category] ?? o.category }}<template v-if="o.slots?.length">・{{ o.slots.join('、') }}</template></small></div>
    </template>
    <template v-if="picked.length">
      <p class="sub">這一次選的</p>
      <div v-for="(o, i) in picked" :key="`p-${i}-${o.id}`" class="oi" data-owned-pick><b>{{ o.name }}<template v-if="o.qty > 1"> ×{{ o.qty }}</template></b><small>{{ CATEGORY[o.category] ?? o.category }}<template v-if="o.slots?.length">・{{ o.slots.join('、') }}</template></small></div>
    </template>
  </div>
</template>

<style scoped>
.owned { display: grid; gap: var(--space-2); }
.sub { margin: var(--space-2) 0 0; font-size: var(--fs-fine); color: var(--ink-3); font-weight: 800; }
.oi { display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: var(--space-3); padding: var(--space-2) var(--space-3); background: var(--bg-2); font-size: var(--fs-sm); }
.oi small { color: var(--ink-3); font-size: var(--fs-fine); }
.k { font-weight: 400; color: var(--ink-3); margin-left: var(--space-2); }
</style>
