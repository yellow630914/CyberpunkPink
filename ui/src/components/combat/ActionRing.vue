<script setup lang="ts">
import { computed, ref } from 'vue'
import { COMBAT_ICONS } from '../../data/combatIcons'

/**
 * 行動圓環（COMBAT_SYSTEM 第 10 節）：中心是技能、內環攻擊、中環補充與切換、外環戰術。
 * 每格是圖示，底下是行動點，左上是數字鍵（1～9）。滑過哪一格只有那一格放大；泡泡跟著游標，寫名稱、花費、說明與做不到的原因。
 * 觸控：點一下先看泡泡，再點一次才執行。做不到的格子變暗（.is-unavailable 的同一套樣式）。
 */
/** 圓環的一格：g 是哪一圈（atk 內環、res 中環、tac 外環）；icon 是 COMBAT_ICONS 的鍵；ram 是要花的 RAM（內海才有）；reason 是做不到的原因（引擎的句子） */
export interface RingItem { k: string; n: string; c: number; g: 'atk' | 'res' | 'tac'; icon: string; d: string; w: string; ram?: string; cost: number; reason: string | null; key: number }
const props = defineProps<{ items: RingItem[]; selected: string | null; off?: boolean; skillOpen?: boolean; ramLabel?: boolean }>()
const emit = defineEmits<{ (e: 'act', k: string): void; (e: 'skill'): void }>()

const CX = 174, CY = 174
const pt = (r: number, a: number) => { const t = ((a - 90) * Math.PI) / 180; return [CX + r * Math.cos(t), CY + r * Math.sin(t)] }
const f = (p: number[]) => `${p[0].toFixed(1)},${p[1].toFixed(1)}`
function arc(r0: number, r1: number, a0: number, a1: number) {
  return `M${f(pt(r1, a0))}A${r1} ${r1} 0 0 1 ${f(pt(r1, a1))}L${f(pt(r0, a1))}A${r0} ${r0} 0 0 0 ${f(pt(r0, a0))}Z`
}
const RINGS: Record<string, [number, number, number]> = { tac: [128, 172, -45], res: [84, 126, -60], atk: [42, 82, 0] }
const segs = computed(() => {
  const out: Array<RingItem & { d0: string; ix: number; iy: number; tx: number; ty: number; kx: number; ky: number }> = []
  for (const g of ['tac', 'res', 'atk'] as const) {
    const list = props.items.filter(a => a.g === g)
    const [r0, r1, off] = RINGS[g]
    const st = 360 / list.length
    list.forEach((a, i) => {
      const a0 = off + i * st + 1, a1 = off + (i + 1) * st - 1
      const c = pt((r0 + r1) / 2, (a0 + a1) / 2)
      const k = pt(r1 - 9, a0 + 7)
      out.push({ ...a, d0: arc(r0, r1, a0, a1), ix: c[0] - 15, iy: c[1] - 21, tx: c[0], ty: c[1] + 20, kx: k[0], ky: k[1] + 4 })
    })
  }
  return out
})

const box = ref<HTMLElement | null>(null)
const hov = ref<string | null>(null)
const tip = ref<{ x: number; y: number } | null>(null)
const touch = typeof window !== 'undefined' && window.matchMedia?.('(hover: none)').matches
const hovItem = computed(() => props.items.find(a => a.k === hov.value) ?? null)
function move(e: MouseEvent, k: string) {
  hov.value = k
  const r = box.value!.getBoundingClientRect()
  tip.value = { x: e.clientX - r.left, y: e.clientY - r.top }
}
function focusIn(k: string, e: FocusEvent) {
  hov.value = k
  const r = box.value!.getBoundingClientRect(), b = (e.target as Element).getBoundingClientRect()
  tip.value = { x: b.right - r.left, y: b.top - r.top }
}
function leave() { hov.value = null; tip.value = null }
function click(a: RingItem, e: MouseEvent) {
  if (touch && hov.value !== a.k) { move(e, a.k); return }
  if (props.off || a.reason) return
  emit('act', a.k)
  if (touch) leave()
}
function key(e: KeyboardEvent, a: RingItem) {
  if (e.key !== 'Enter' && e.key !== ' ') return
  e.preventDefault()
  e.stopPropagation()
  if (!props.off && !a.reason) emit('act', a.k)
}
/** 引擎給的原因是完整的句子（可能好幾條，用換行分開）；結尾沒有標點的補一個句號（內海畫面的原因不帶句號） */
const sentence = (r: string): string => r.split('\n').map((l) => (/[。！？.!?]$/.test(l) ? l : `${l}。`)).join('\n')
const tipStyle = computed(() => {
  if (!tip.value) return {}
  const left = tip.value.x + 18 > 200 ? Math.max(0, tip.value.x - 250) : tip.value.x + 18
  return { left: `${left}px`, top: `${tip.value.y + 18}px` }
})
</script>

<template>
  <div ref="box" class="ringbox" :class="{ off }" @mouseleave="leave">
    <svg class="ring" viewBox="0 0 348 348" role="group" aria-label="行動圓環">
      <circle class="hit" cx="174" cy="174" r="173" />
      <g v-for="a in segs" :key="a.k" :class="[`r-${a.g}`, { hov: hov === a.k, sel: selected === a.k, dis: off || !!a.reason }]" :data-a="a.k" role="button"
        :tabindex="off || a.reason ? -1 : 0" :aria-disabled="off || a.reason ? 'true' : undefined"
        :aria-label="`${a.key}. ${a.n}，${a.cost} 點行動點。${a.d}${a.reason ? `現在做不到：${sentence(a.reason)}` : ''}`" :aria-keyshortcuts="String(a.key)"
        @mousemove="move($event, a.k)" @focus="focusIn(a.k, $event)" @blur="leave" @click="click(a, $event)" @keydown="key($event, a)">
        <path :d="a.d0" />
        <path class="ic" :transform="`translate(${a.ix} ${a.iy}) scale(.0586)`" :d="COMBAT_ICONS[a.icon]" />
        <text class="c" :x="a.tx" :y="a.ty">{{ a.cost }}</text>
        <text class="kn" :x="a.kx" :y="a.ky">{{ a.key }}</text>
      </g>
      <g class="r-skl" :class="{ sel: skillOpen, hov: hov === 'skill' }" data-a="skill" role="button" tabindex="0" aria-label="技能清單"
        @mousemove="move($event, 'skill')" @click="emit('skill')" @keydown.enter.prevent="emit('skill')">
        <circle class="bg" cx="174" cy="174" r="40" />
        <path class="ic" transform="translate(148 148) scale(.1016)" :d="COMBAT_ICONS.skill" />
      </g>
    </svg>
    <div v-if="tip && hov" class="tip" :style="tipStyle" role="tooltip">
      <template v-if="hov === 'skill'"><b>技能</b><p>打開這個角色的技能清單。</p></template>
      <template v-else-if="hovItem">
        <b>{{ hovItem.n }}</b><i>{{ hovItem.cost }} 點</i><i v-if="ramLabel && hovItem.ram" class="rm">RAM {{ hovItem.ram }}</i><kbd>{{ hovItem.key }}</kbd>
        <p>{{ hovItem.d }}</p>
        <p v-if="hovItem.reason && !off" class="no">現在做不到：{{ sentence(hovItem.reason) }}</p>
      </template>
    </div>
  </div>
</template>

<style scoped>
.ringbox { position: relative; width: 300px; height: 300px; flex: none; }
.ring { width: 100%; height: 100%; overflow: visible; display: block; touch-action: manipulation; }
.off .ring { pointer-events: none; opacity: .45; }
.hit { fill: transparent; stroke: none; }
.ring path:not(.ic), .ring circle.bg { fill: var(--bg-2); stroke: var(--bg); stroke-width: 2.5; }
.ring path.ic { fill: var(--ink); stroke: none; pointer-events: none; }
.r-atk path:not(.ic) { fill: color-mix(in srgb, var(--hp) 24%, var(--bg-2)) !important; }
.r-res path:not(.ic) { fill: color-mix(in srgb, var(--ap) 18%, var(--bg-2)) !important; }
.r-tac path:not(.ic) { fill: color-mix(in srgb, var(--b) 32%, var(--bg-2)) !important; }
.r-skl circle.bg { fill: color-mix(in srgb, var(--a) 28%, var(--bg-2)) !important; }
g[data-a] { cursor: pointer; outline: none; transform-box: fill-box; transform-origin: center; transition: transform var(--dur) cubic-bezier(.2, .8, .2, 1); }
g.hov { transform: scale(1.3); }
g.dis { cursor: not-allowed; }
g.dis text, g.dis .ic { opacity: .28; }
g.dis path:not(.ic) { filter: grayscale(.85); }
g.hov:not(.dis) path:not(.ic), g.hov:not(.dis) circle.bg, g:focus-visible path:not(.ic), g:focus-visible circle.bg { stroke: var(--a); stroke-width: 2.5; }
g.sel path:not(.ic), g.sel circle.bg { stroke: var(--ok) !important; stroke-width: 3.5; }
text { fill: var(--ink); text-anchor: middle; pointer-events: none; font-family: var(--mono); }
text.c { fill: var(--ap); font-size: 13px; font-weight: 900; }
text.kn { fill: var(--ink-3); font-size: 11px; font-weight: 800; }
.tip { position: absolute; z-index: var(--z-hint); width: 240px; background: var(--bg-term); box-shadow: inset 0 0 0 2px var(--a), var(--shadow); padding: 8px 11px; font-size: var(--fs-xs); color: var(--ink-2); pointer-events: none; }
.tip b { color: var(--ink); font-size: var(--fs-card); }
.tip i { font-style: normal; color: var(--ap); font-weight: 800; margin-left: 8px; }
.tip i.rm { color: var(--ram); }
.tip kbd { float: right; }
.tip p { margin: 4px 0 0; }
.tip .no { color: var(--hp); font-weight: 800; white-space: pre-line; }
@media (max-width: 720px) { .ringbox { width: min(300px, calc(100vw - 48px)); height: min(300px, calc(100vw - 48px)); } }
</style>
