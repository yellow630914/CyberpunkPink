<script setup lang="ts">
import { computed } from 'vue'
import GradeBadge from '../../components/GradeBadge.vue'
import ItemSlot from '../../components/ItemSlot.vue'
import { useEngine } from '../../stores/engine'
import { QUALITY_NAME, STATE_NAME, bpIcon, gradeOf } from '../../lib/craftView'

/** 背包裡的成品清單（換零件與拆解共用）：名字、等級、品質、狀態；點一件選它。 */
defineProps<{ modelValue: string }>()
const emit = defineEmits<{ (e: 'update:modelValue', v: string): void }>()
const eng = useEngine()
const rows = computed(() => eng.craft.products().flatMap((stack) => {
  const d = eng.craft.detail(stack)
  return d ? [{ uid: stack.data!.uid as string, stack, bp: d.info.bp, quality: stack.data?.quality as string | undefined, state: stack.data?.state as string | undefined }] : []
}))
</script>

<template>
  <div class="prods" data-products>
    <div v-if="!rows.length" class="empty-note" data-no-product>背包裡沒有組好的成品。</div>
    <button v-for="r in rows" :key="r.uid" type="button" class="lrow" :class="{ on: r.uid === modelValue }" :data-uid="r.uid" @click="emit('update:modelValue', r.uid)">
      <ItemSlot :item="{ id: r.uid, name: r.bp.name, grade: gradeOf(r.bp.grade), icon: bpIcon(r.bp.kind) }" size="sm" inert />
      <span class="grow"><b :style="{ color: `var(--g${gradeOf(r.bp.grade)})` }">{{ r.bp.name }}</b><small>{{ r.quality ? QUALITY_NAME[r.quality] : '標準' }}・{{ r.state ? STATE_NAME[r.state] ?? r.state : '全新' }}</small></span>
      <GradeBadge :grade="gradeOf(r.bp.grade)" />
    </button>
  </div>
</template>

<style scoped>
.prods { display: grid; gap: 5px; align-content: start; }
.lrow :deep(.slot) { width: 40px; flex: none; }
</style>
