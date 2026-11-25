<script setup lang="ts">
import { computed } from 'vue'
import ItemSlot from '../../components/ItemSlot.vue'
import { useEngine } from '../../stores/engine'
import { useUi } from '../../stores/ui'
import { MATERIAL_NAME, STATE_NAME, gradeOf, partIcon, statLines } from '../../lib/craftView'

/**
 * 背包裡的零件清單（組裝與換零件共用）：放不進這個槽的灰掉，原因是引擎的 slotProblems 寫的那一句；超規的標出來。
 * 這裡只編排：能不能放、超不超規都是問引擎。
 */
const props = defineProps<{ blueprint: string; type: string; picked: readonly string[]; empty?: string }>()
const emit = defineEmits<{ (e: 'pick', key: string): void }>()
const eng = useEngine()
const ui = useUi()

const rows = computed(() => {
  const list = eng.craft.parts().map((p) => {
    const check = eng.craft.slotCheck(props.blueprint, props.type, p.stack)
    return { ...p, ...check, same: p.part.type === props.type, ok: check.problems.length === 0 }
  })
  // 放得進的在前、同一類的在前、等級高的在前
  return list.sort((a, b) => Number(b.ok) - Number(a.ok) || Number(b.same) - Number(a.same) || b.part.grade - a.part.grade || a.part.name.localeCompare(b.part.name, 'zh-Hant'))
})
const used = (key: string): number => props.picked.filter((k) => k === key).length
function click(r: (typeof rows.value)[number]) {
  if (!r.ok) { ui.toast(r.problems[0]!, 'warn'); return }
  emit('pick', r.key)
}
</script>

<template>
  <div class="plist">
    <div v-if="!rows.length" class="empty-note" data-no-parts>{{ empty ?? '背包裡沒有零件。' }}</div>
    <button v-for="r in rows" :key="r.key" type="button" class="lrow pr" :class="{ on: used(r.key) > 0, 'is-unavailable': !r.ok }" :aria-disabled="r.ok ? undefined : 'true'" :title="r.ok ? undefined : r.problems.join('')" :data-part-key="r.key" :data-ok="r.ok ? '1' : '0'" @click="click(r)">
      <ItemSlot :item="{ id: r.part.id, name: r.part.name, grade: gradeOf(r.part.grade), icon: partIcon(r.part.type) }" size="sm" :qty="r.stack.qty > 1 ? r.stack.qty : undefined" inert />
      <span class="grow">
        <b :style="{ color: `var(--g${gradeOf(r.part.grade)})` }">{{ r.part.name }}</b>
        <small>{{ r.part.brand }}・{{ MATERIAL_NAME[r.part.material] ?? r.part.material }}・{{ STATE_NAME[r.part.state] ?? r.part.state }}<template v-if="r.part.unreg">・未登錄</template></small>
        <small v-if="statLines(r.part.stats).length">{{ statLines(r.part.stats).map((s) => `${s.name} ${s.text}`).join('　') }}</small>
        <small v-if="!r.ok" class="warn-t" data-why>{{ r.problems.join('') }}</small>
        <small v-else-if="r.overspec" class="warn-t" data-overspec>超規：比設計圖高一級，難度會升高</small>
      </span>
      <span v-if="used(r.key) > 0" class="tag hot">已放{{ used(r.key) > 1 ? ` ×${used(r.key)}` : '' }}</span>
    </button>
  </div>
</template>

<style scoped>
.plist { display: grid; gap: 5px; align-content: start; }
.pr :deep(.slot) { width: 40px; flex: none; }
.warn-t { color: var(--warn) !important; }
</style>
