<script setup lang="ts">
import type { BodyPartId } from '../data/types'

/**
 * 人形剪影與部位的熱點（docs/art/body-slots.svg 的人形，座標照原圖）。
 * 有義體的熱點是紫色，選中的是粉色並發光，有警示的右上角一個橘點。
 */
defineProps<{ selected: BodyPartId | null; filled: Partial<Record<BodyPartId, boolean>>; warn: Partial<Record<BodyPartId, boolean>> }>()
defineEmits<{ (e: 'pick', id: BodyPartId): void }>()
const SPOTS: Array<{ id: BodyPartId; x: number; y: number; t: string }> = [
  { id: 'brain', x: 600, y: 112, t: '腦' }, { id: 'eye', x: 582, y: 152, t: '眼' }, { id: 'earthroat', x: 648, y: 154, t: '耳' },
  { id: 'bridge', x: 624, y: 222, t: '橋' }, { id: 'skin', x: 546, y: 290, t: '皮' }, { id: 'torso', x: 600, y: 340, t: '軀' },
  { id: 'armL', x: 470, y: 470, t: '左' }, { id: 'armR', x: 730, y: 470, t: '右' }, { id: 'intimate', x: 600, y: 506, t: '私' },
  { id: 'legL', x: 560, y: 680, t: '腿' }, { id: 'legR', x: 640, y: 680, t: '腿' },
]
</script>

<template>
  <svg class="fig" viewBox="420 40 360 900" role="group" aria-label="身體的部位">
    <ellipse cx="600" cy="930" rx="120" ry="12" fill="#000" fill-opacity=".35" />
    <g class="body" stroke-width="2.5" stroke-linejoin="round"><path d="M512 262Q488 266 482 300L464 430L450 540Q448 568 464 570Q478 570 480 544L498 432L516 330Z"/><path d="M512 262Q488 266 482 300L464 430L450 540Q448 568 464 570Q478 570 480 544L498 432L516 330Z" transform="matrix(-1 0 0 1 1200 0)"/><path d="M514 512H596L590 700L584 900Q584 920 566 920H548Q534 920 538 900L532 700Z"/><path d="M514 512H596L590 700L584 900Q584 920 566 920H548Q534 920 538 900L532 700Z" transform="matrix(-1 0 0 1 1200 0)"/><path d="M584 196H616L620 240H580Z"/><path d="M520 248Q600 226 680 248Q702 256 700 292L690 360Q676 420 684 470L692 520Q600 540 508 520L516 470Q524 420 510 360L500 292Q498 256 520 248Z"/><ellipse cx="600" cy="140" rx="46" ry="58"/></g>
    <g fill="none" class="seam" stroke-width="1.5" stroke-opacity=".8"><path d="M532 300Q600 316 668 300"/><path d="M520 470Q600 488 680 470"/><path d="M478 430H500M700 430H722M538 700H590M610 700H662"/></g>
    <g v-for="s in SPOTS" :key="s.id" class="spot" :class="{ on: selected === s.id, filled: filled[s.id] }" role="button" tabindex="0" :aria-label="s.t" @click="$emit('pick', s.id)" @keydown.enter="$emit('pick', s.id)">
      <circle :cx="s.x" :cy="s.y" r="17" />
      <text :x="s.x" :y="s.y + 5" text-anchor="middle">{{ s.t }}</text>
      <circle v-if="warn[s.id]" class="warn" :cx="s.x + 13" :cy="s.y - 13" r="6" />
    </g>
  </svg>
</template>

<style scoped>
.fig { width: 100%; height: 100%; max-height: 560px; display: block; }
.fig :deep(.body) { fill: #2C2136; stroke: #5B4675; }
.fig :deep(.seam) { stroke: #5B4675; }
.spot { cursor: pointer; }
.spot circle { fill: #45375A; stroke: #17111F; stroke-width: 3; }
.spot text { font: 900 14px var(--font); fill: #F3E9FF; pointer-events: none; }
.spot.filled circle { fill: #8E7CC3; }
.spot.on circle { fill: #F06AA0; filter: drop-shadow(0 0 8px #F06AA0); }
.spot circle.warn { fill: #FF8A5C; stroke-width: 2; }
.spot:focus-visible circle { stroke: #F06AA0; }
</style>
