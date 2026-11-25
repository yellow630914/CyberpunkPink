<script setup lang="ts">
import { computed } from 'vue'
import Hint from '../../components/Hint.vue'
import { useUi } from '../../stores/ui'
import type { MakerOption } from '@engine/src/features/craft'

/**
 * 誰來做：引擎的 makers() 列出來的每一種（自己動手一直在；站的設施帶 craft 的多一種）。
 * 選不了的標出引擎寫的原因；工錢、限制在預覽裡（引擎的 fee、problems）。
 */
const props = defineProps<{ options: MakerOption[]; modelValue: string; only?: readonly string[] }>()
const emit = defineEmits<{ (e: 'update:modelValue', v: string): void }>()
const ui = useUi()
const shown = computed(() => props.options.filter((o) => !props.only || props.only.includes(o.id)))
function pick(o: MakerOption) {
  emit('update:modelValue', o.id)
  if (o.block) ui.toast(o.block, 'warn')
}
</script>

<template>
  <div class="mk" role="radiogroup" aria-label="誰來做">
    <button v-for="o in shown" :key="o.id" type="button" role="radio" class="mkb" :class="{ on: o.id === modelValue, 'is-unavailable': !!o.block }" :aria-checked="o.id === modelValue" :title="o.block ?? undefined" :data-maker="o.id" @click="pick(o)">
      {{ o.name }}<template v-if="o.brand"> ・{{ o.brand }}</template>
    </button>
    <Hint v-if="shown.some((o) => o.block)" title="誰來做">灰掉的是這裡做不了的：自己動手要在有工作台的住處（二級以上）或有工作台的店面；店家、同人社團、原廠要站在那種設施上。</Hint>
  </div>
</template>

<style scoped>
.mk { display: flex; gap: 5px; flex-wrap: wrap; align-items: center; }
.mkb { font-size: var(--fs-sm); font-weight: 800; padding: 6px 12px; background: var(--bg-2); color: var(--ink-3); border: 0; cursor: pointer; border-radius: 6px; }
.mkb.on { background: var(--a); color: var(--on-a); }
</style>
