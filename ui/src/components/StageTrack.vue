<script setup lang="ts">
import type { TrackNode } from '@engine/src/features/commission'
import { FACE_CLASS, FACE_ICON, trackChose } from '../lib/commissionView'

/**
 * 階段軌（UI 7.4、第 16 節）：一排菱形節點。做完的暗紫、現在的粉色並緩慢脈動、沒揭開的「?」、最後一個金色星號寫「決定性的一步」。
 * 節點下面是可選的面（面的色塊）與當時選了什麼；走過的那段連線是發光的粉色。點做完的節點發出 pick（看那一段的紀錄）。
 * 全部資料是引擎的 commissionView().track：這裡只畫。
 */
const props = defineProps<{ track: TrackNode[]; branchName?: (id: string) => string }>()
const emit = defineEmits<{ (e: 'pick', index: number): void }>()
const nameOf = (id: string): string => props.branchName?.(id) ?? id
</script>

<template>
  <ol class="st" aria-label="階段軌">
    <li v-for="(n, i) in track" :key="n.index" class="nd" :class="[n.state, { key: n.decisive, unknown: !n.known }]" :data-stage="n.index" :aria-current="n.state === 'current' ? 'step' : undefined">
      <i v-if="i > 0" class="line" :class="{ lit: track[i - 1]!.state === 'done' }" aria-hidden="true" />
      <button type="button" class="dia" :disabled="n.state !== 'done'" :aria-label="`第 ${n.index} 階段${n.known ? `：${n.name}` : '（還沒揭開）'}`" @click="emit('pick', n.index)"><span>{{ n.decisive ? '★' : n.known ? n.index : '?' }}</span></button>
      <b class="nm">{{ n.known ? n.name : '？？？' }}</b>
      <small v-if="n.decisive" class="key-t">決定性的一步</small>
      <small v-else-if="!n.known" class="muted">沒踩到點</small>
      <span v-if="n.known && n.faces" class="faces"><em v-for="f in n.faces" :key="f" :class="FACE_CLASS[f]" :title="f">{{ FACE_ICON[f] }}</em></span>
      <small v-if="n.chose" class="chose">{{ trackChose(n, nameOf) }}</small>
    </li>
  </ol>
</template>

<style scoped>
.st { list-style: none; margin: 0; padding: 0; display: grid; grid-auto-flow: column; grid-auto-columns: minmax(0, 1fr); gap: 0; }
.nd { position: relative; display: grid; justify-items: center; gap: 3px; padding: 0 4px; text-align: center; min-width: 0; }
.line { position: absolute; top: 17px; right: 50%; width: 100%; height: 3px; background: var(--bg-3); z-index: 0; }
.line.lit { background: var(--a); box-shadow: 0 0 8px var(--a); }
.dia { position: relative; z-index: 1; width: 34px; height: 34px; padding: 0; border: 0; display: grid; place-items: center; transform: rotate(45deg); background: var(--bg-3); color: var(--ink-3); font: 900 var(--fs-sm) var(--font); cursor: default; }
.dia span { transform: rotate(-45deg); }
.nd.done .dia { background: var(--b); color: var(--c); cursor: pointer; }
.nd.current .dia { background: var(--a); color: var(--on-a); animation: pulse 2.4s ease-in-out infinite; }
.nd.key .dia { box-shadow: 0 0 0 2px var(--ap); color: var(--ap); }
.nd.key.current .dia { color: var(--on-a); }
.nm { font-size: var(--fs-xs); font-weight: 800; overflow-wrap: anywhere; }
.nd.unknown .nm { color: var(--ink-3); }
small { font-size: var(--fs-fine); color: var(--ink-3); overflow-wrap: anywhere; }
.key-t { color: var(--ap); font-weight: 800; }
.chose { color: var(--ink-2); }
.faces { display: flex; gap: 3px; justify-content: center; }
.faces em { font-style: normal; font: 900 var(--fs-micro) var(--mono); min-width: 18px; padding: 1px 3px; border-radius: 3px; color: var(--bg); }
.faces em.m { background: var(--ink-2); } .faces em.n { background: var(--net); } .faces em.o { background: var(--ep); }
@keyframes pulse { 0%, 100% { box-shadow: 0 0 0 0 color-mix(in srgb, var(--a) 60%, transparent); } 50% { box-shadow: 0 0 0 8px color-mix(in srgb, var(--a) 0%, transparent); } }
@media (prefers-reduced-motion: reduce) { .nd.current .dia { animation: none; } }
@media (max-width: 720px) {
  .dia { width: 26px; height: 26px; }
  .line { top: 13px; }
  .chose, .faces { display: none; }
  .nm { font-size: var(--fs-fine); }
}
</style>
