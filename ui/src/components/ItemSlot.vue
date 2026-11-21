<script setup lang="ts">
import { computed } from 'vue'
import type { ItemDef } from '../data/types'
import Icon from './Icon.vue'
import GradeBadge from './GradeBadge.vue'
import { gradeColorVar } from '../lib/grade'
import { useUi } from '../stores/ui'

/**
 * 物品格（UI 規則 1）：有東西時，邊框與等級標用那個等級的顏色，裡面是物品自己的圖標（第 3 層，沒有就退回第 2 層）；
 * 空格是虛線框，裡面是欄位的通用圖標（變淡）。獨特物品右上角紫色小標；登記類左上角寫「登記」；
 * 未鑑定的只顯示第 1 層（立體方塊加問號），不上等級色。
 */
const props = withDefaults(defineProps<{
  item?: ItemDef | null
  /** 空格時顯示的欄位圖標 */
  slotIcon?: string
  /** 欄位名（顯示在格子下面） */
  label?: string
  qty?: number
  size?: 'sm' | 'md' | 'lg'
  selected?: boolean
  covered?: boolean
  unknown?: boolean
  showName?: boolean
  /** 授權鎖之類的警告：黃框（只表示「警告」） */
  locked?: boolean
  /** 不能選的原因：有值就灰掉、點了說原因（UI.md 1.1 節的「做不到的灰掉」），不發 select */
  unavailable?: string | null
  /** 放在另一個按鈕裡時用 span（按鈕不能套按鈕） */
  inert?: boolean
}>(), { size: 'md', showName: false, inert: false })
const emit = defineEmits<{ (e: 'select'): void }>()
const ui = useUi()
function click() {
  if (props.inert) return
  if (props.unavailable) { ui.toast(props.unavailable, 'warn'); return }
  emit('select')
}

const iconId = computed(() => {
  if (props.unknown) return 'ic-unknown'
  const it = props.item
  if (!it) return props.slotIcon ?? 'ic-unknown'
  return it.icon ?? (it.id.startsWith('it_') ? it.id : it.l2)
})
const color = computed(() => (props.item && !props.unknown ? gradeColorVar(props.item.grade) : 'var(--line-2)'))
const name = computed(() => (props.unknown ? '包著的盒子' : props.item?.name ?? '空'))
const aria = computed(() => [props.label, name.value, props.item && !props.unknown ? `等級 ${props.item.grade}` : ''].filter(Boolean).join('，'))
</script>

<template>
  <component :is="inert ? 'span' : 'button'" :type="inert ? undefined : 'button'" class="slot" :class="[size, { empty: !item, sel: selected, covered, unknown, locked, 'is-unavailable': !!unavailable }]" :style="{ '--gc': color }" :aria-label="inert ? undefined : aria" :aria-pressed="inert ? undefined : selected" :aria-disabled="unavailable ? 'true' : undefined" :title="unavailable || undefined" @click="click">
    <span class="frame">
      <Icon :id="iconId" :size="size === 'sm' ? '74%' : '64%'" :fit="!item || iconId.startsWith('ic-')" />
      <GradeBadge v-if="item && !unknown" class="badge" :grade="item.grade" small />
      <span v-if="item?.unique && !unknown" class="uq" title="非制式的獨特物品" />
      <span v-if="item?.legality === '登記' && !unknown && size !== 'sm'" class="reg">登記</span>
      <span v-if="qty && qty > 1" class="qty">×{{ qty }}</span>
    </span>
    <span v-if="showName || label" class="nm">
      <small v-if="label">{{ label }}</small>
      <b v-if="showName">{{ name }}</b>
    </span>
  </component>
</template>

<style scoped>
.slot { display: flex; flex-direction: column; align-items: center; gap: 4px; background: none; border: 0; padding: 0; cursor: pointer; min-width: 0; width: 100%; color: inherit; }
.frame { position: relative; display: grid; place-items: center; width: 100%; aspect-ratio: 1; background: var(--bg-term); border: 2px solid var(--gc); border-radius: 8px; --o: var(--bg); }
[data-skin="net"] .frame { --o: #1E2346; }
.sm .frame { border-radius: 6px; }
.empty .frame { border-style: dashed; background: transparent; }
.empty .frame :deep(.icon) { opacity: .28; filter: grayscale(1); }
.unknown .frame { border-color: var(--line-2); }
.sel .frame { box-shadow: 0 0 0 2px var(--a), 0 0 12px color-mix(in srgb, var(--a) 40%, transparent); }
.covered .frame { opacity: .4; }
.locked .frame { border-color: var(--g4); }
.badge { position: absolute; left: 3px; bottom: 3px; }
.uq { position: absolute; right: -2px; top: -2px; width: 13px; height: 13px; background: var(--uq); clip-path: polygon(0 0, 100% 0, 100% 100%); }
.reg { position: absolute; left: 4px; top: 2px; font-size: var(--fs-micro); font-weight: 900; color: var(--ink-3); }
.qty { position: absolute; right: 4px; bottom: 2px; font: 800 var(--fs-tiny) var(--mono); color: var(--ink-2); }
.nm { display: grid; text-align: center; line-height: 1.25; min-width: 0; width: 100%; }
.nm small { font-size: var(--fs-tiny); color: var(--ink-3); font-weight: 800; }
.nm b { font-size: var(--fs-fine); color: var(--gc); overflow: hidden; text-overflow: ellipsis; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; word-break: break-all; }
.empty .nm b { color: var(--ink-3); font-weight: 700; }
.slot:hover .frame { filter: brightness(1.15); }
</style>
