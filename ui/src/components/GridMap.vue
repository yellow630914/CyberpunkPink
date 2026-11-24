
<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted } from 'vue'
import type { Point } from '../data/types'
import Icon from './Icon.vue'
import { useUi } from '../stores/ui'

/**
 * 共用的格子地圖（UI 規則 3、4）：街區、家園、子網、地下城都用它。
 * 地圖本身不懂規則：每一格長什麼樣子由 cell() 決定，迷霧由 fog() 決定，
 * 佔好幾格的東西（家具、設施）是 objects，會走動的人是 tokens。點格子發出 cell 事件，由畫面決定要做什麼。
 */
export interface CellView { kind: string; icon?: string; label?: string; tint?: string; title?: string; mark?: string }
export type FogState = 'hidden' | 'seen' | 'visible'
export interface MapObject { id: string; x: number; y: number; w: number; h: number; label: string; icon?: string; rot?: number; selected?: boolean; ghost?: 'ok' | 'bad'; tone?: string; title?: string }
export interface MapToken { id: string; x: number; y: number; label: string; kind: 'me' | 'npc' | 'ally' | 'enemy' | 'visitor'; title?: string }
export interface MapArea { id: string; x: number; y: number; label: string; sub?: string; color?: string }

const props = withDefaults(defineProps<{
  w: number
  h: number
  cell: (x: number, y: number) => CellView
  fog?: (x: number, y: number) => FogState
  objects?: MapObject[]
  tokens?: MapToken[]
  areas?: MapArea[]
  path?: Point[]
  maxCell?: number
  label: string
  /** 螢幕上的方向鈕（↑↓←→ 與 E）；預設顯示 */
  pad?: boolean
  /** 方向鈕中間那顆的字（預設「E」） */
  padLabel?: string
}>(), { objects: () => [], tokens: () => [], areas: () => [], path: () => [], maxCell: 56, pad: true, padLabel: 'E' })

const emit = defineEmits<{ (e: 'cell', p: Point): void; (e: 'object', id: string): void; (e: 'token', id: string): void; (e: 'hover', p: Point | null): void; (e: 'step', d: Point): void; (e: 'enter'): void }>()
/**
 * 鍵盤：這張地圖掛上時登記成這一頁的「可以走的地圖」（stores/ui 的 mover），
 * 全域的方向鍵、WASD 走一格（step），E 和腳下的東西互動（enter），不必先點地圖（App.vue 分派，lib/keys.ts）。
 */
const ui = useUi()
const mover = { step: (d: Point) => emit('step', d), interact: () => emit('enter') }
onMounted(() => ui.setMover(mover))
onBeforeUnmount(() => { if (ui.mover === mover) ui.setMover(null) })
const PAD: Array<{ d: Point; t: string; a: string; c: string }> = [
  { d: { x: 0, y: -1 }, t: '↑', a: '往上走一格（↑ 或 W）', c: 'u' },
  { d: { x: -1, y: 0 }, t: '←', a: '往左走一格（← 或 A）', c: 'l' },
  { d: { x: 1, y: 0 }, t: '→', a: '往右走一格（→ 或 D）', c: 'r' },
  { d: { x: 0, y: 1 }, t: '↓', a: '往下走一格（↓ 或 S）', c: 'dn' },
]

const cells = computed(() => {
  const out: Array<{ x: number; y: number; v: CellView; f: FogState }> = []
  for (let y = 0; y < props.h; y++) for (let x = 0; x < props.w; x++) out.push({ x, y, v: props.cell(x, y), f: props.fog ? props.fog(x, y) : 'visible' })
  return out
})
const fogAt = (x: number, y: number) => (props.fog ? props.fog(x, y) : 'visible')
const pathSet = computed(() => new Set(props.path.map(p => `${p.x},${p.y}`)))
const visObjects = computed(() => props.objects.filter(o => {
  for (let dy = 0; dy < o.h; dy++) for (let dx = 0; dx < o.w; dx++) if (fogAt(o.x + dx, o.y + dy) !== 'hidden') return true
  return false
}))
const visTokens = computed(() => props.tokens.filter(t => t.kind === 'me' || fogAt(t.x, t.y) === 'visible'))
const box = (x: number, y: number, w = 1, h = 1) => ({ left: `${(x / props.w) * 100}%`, top: `${(y / props.h) * 100}%`, width: `${(w / props.w) * 100}%`, height: `${(h / props.h) * 100}%` })

function pick(e: MouseEvent) {
  const t = (e.target as HTMLElement).closest('[data-x]') as HTMLElement | null
  if (!t) return
  emit('cell', { x: Number(t.dataset.x), y: Number(t.dataset.y) })
}
function over(e: MouseEvent) {
  const t = (e.target as HTMLElement).closest('[data-x]') as HTMLElement | null
  emit('hover', t ? { x: Number(t.dataset.x), y: Number(t.dataset.y) } : null)
}
</script>

<template>
  <div class="gm-wrap" :style="{ maxWidth: w * maxCell + 'px' }" aria-keyshortcuts="ArrowUp ArrowDown ArrowLeft ArrowRight W A S D E" :aria-label="`${label}：方向鍵或 WASD 走一格，E 互動`">
    <div class="gm" role="grid" :aria-label="label" :style="{ aspectRatio: `${w} / ${h}`, gridTemplateColumns: `repeat(${w}, minmax(0, 1fr))`, gridTemplateRows: `repeat(${h}, minmax(0, 1fr))` }" @click="pick" @mousemove="over" @mouseleave="emit('hover', null)">
      <div v-for="c in cells" :key="c.x + ',' + c.y" class="c" role="gridcell" :class="['k-' + c.v.kind, 'f-' + c.f, { path: pathSet.has(c.x + ',' + c.y) }]" :style="c.v.tint && c.f !== 'hidden' ? { '--tint': c.v.tint } : undefined" :data-x="c.x" :data-y="c.y" :title="c.f !== 'hidden' ? c.v.title : undefined">
        <template v-if="c.f !== 'hidden'">
          <Icon v-if="c.v.icon" :id="c.v.icon" size="78%" fit class="ci" />
          <span v-if="c.v.mark" class="mk">{{ c.v.mark }}</span>
        </template>
      </div>
      <div class="ov">
        <div v-for="a in areas" :key="a.id" class="area" :style="{ left: box(a.x, a.y).left, top: box(a.x, a.y).top, '--ac': a.color }">{{ a.label }}<small v-if="a.sub">{{ a.sub }}</small></div>
        <button v-for="o in visObjects" :key="o.id" type="button" class="obj" :class="[{ sel: o.selected }, o.ghost ? 'ghost-' + o.ghost : '', 'rot' + (o.rot ?? 0)]" :style="{ ...box(o.x, o.y, o.w, o.h), '--tone': o.tone }" :title="o.title ?? o.label" :aria-label="o.label" @click.stop="emit('object', o.id)">
          <Icon v-if="o.icon" :id="o.icon" size="min(70%, 26px)" fit />
          <span class="ol">{{ o.label }}</span>
        </button>
        <button v-for="t in visTokens" :key="t.id" type="button" class="tok" :class="'t-' + t.kind" :style="box(t.x, t.y)" :title="t.title ?? t.label" :aria-label="t.title ?? t.label" @click.stop="emit('token', t.id)"><span>{{ t.label }}</span></button>
      </div>
    </div>
    <div v-if="pad" class="pad" role="group" aria-label="移動">
      <button v-for="b in PAD" :key="b.c" type="button" class="pb" :class="b.c" :aria-label="b.a" :title="b.a" @click="emit('step', b.d)">{{ b.t }}</button>
      <button type="button" class="pb mid" :aria-label="`互動（E）`" title="和腳下的東西互動（E）" @click="emit('enter')">{{ padLabel }}</button>
      <slot name="pad-side" />
    </div>
  </div>
</template>

<style scoped>
.gm-wrap { width: 100%; margin: 0 auto; border-radius: 4px; }
/* 方向鈕只在手機與觸控（窄螢幕或粗指標）顯示；桌面用鍵盤 */
.pad { display: none; }
@media (max-width: 720px), (pointer: coarse) { .pad { display: grid; } }
.pad { grid-template-columns: repeat(3, 40px); grid-template-rows: repeat(3, 34px); gap: 4px; justify-content: center; margin-top: var(--space-3); }
.pb { border: 0; background: var(--bg-2); color: var(--ink); font: 900 var(--fs-md) var(--font); cursor: pointer; padding: 0; border-radius: 6px; box-shadow: inset 0 0 0 1px var(--line-2); touch-action: manipulation; }
.pb:hover { background: var(--bg-3); }
.pb:active { background: var(--a); color: var(--on-a); }
.pb.u { grid-area: 1 / 2; } .pb.l { grid-area: 2 / 1; } .pb.mid { grid-area: 2 / 2; background: var(--a); color: var(--on-a); font-size: var(--fs-sm); } .pb.r { grid-area: 2 / 3; } .pb.dn { grid-area: 3 / 2; }
[data-skin="net"] .pb { box-shadow: inset 0 0 0 2px var(--o); }
@media (max-width: 720px) { .pad { grid-template-columns: repeat(3, 52px); grid-template-rows: repeat(3, 44px); } }
.gm { position: relative; display: grid; gap: 2px; width: 100%; user-select: none; cursor: pointer; }
.c { position: relative; border-radius: 3px; background: var(--tile-floor); min-width: 0; min-height: 0; overflow: hidden; display: grid; place-items: center; }
.c::before { content: ""; position: absolute; inset: 0; border-radius: inherit; background: var(--tint, transparent); opacity: .22; pointer-events: none; }
.k-void { background: transparent; cursor: default; }
.k-wall { background: var(--tile-wall); box-shadow: inset 0 0 0 1px #ffffff08; }
[data-skin="net"] .k-wall { background: transparent; box-shadow: none; }
.k-door { background: var(--tile-door); }
.k-entrance { background: var(--tile-door); box-shadow: inset 0 0 0 2px var(--a); }
.k-street { background: var(--tile-street); }
.k-building { background: var(--tile-building); cursor: default; }
.k-hall { background: color-mix(in srgb, var(--tile-floor) 70%, var(--tile-street)); }
.k-fac { background: var(--tile-fac); box-shadow: inset 0 -3px 0 var(--b); }
.k-exit { background: var(--tile-street); box-shadow: inset 0 0 0 2px var(--b); }
.k-link { background: var(--tile-floor); }
[data-skin="net"] .k-link, [data-skin="net"] .k-node { box-shadow: inset 0 0 0 2px var(--o); }
.k-node { background: var(--tile-fac); }
.k-node.f-visible { box-shadow: inset 0 0 0 2px var(--o), 0 0 0 1px var(--tint, transparent); }
.k-valve { background: var(--tile-floor); box-shadow: inset 0 0 0 2px var(--o), inset 0 0 0 4px var(--warn); }
.k-bridge { background: var(--tile-floor); box-shadow: inset 0 0 0 2px var(--o); border: 2px dashed var(--warn); }
.k-valve .mk, .k-bridge .mk { position: static; color: var(--warn); font-size: var(--fs-tiny); }
.k-trap { background: color-mix(in srgb, var(--tile-floor) 80%, var(--warn)); }
.c.path::after { content: ""; position: absolute; inset: 34%; border-radius: 50%; background: var(--a); opacity: .7; }
.ci { position: relative; z-index: 1; --o: var(--bg-term); }
[data-skin="net"] .ci { --o: #1E2346; }
.mk { position: absolute; right: 2px; top: 0; font: 900 var(--fs-micro) var(--mono); color: var(--ink-2); z-index: 1; }
.f-hidden { background: var(--fog) !important; box-shadow: none !important; cursor: default; }
.f-hidden::before { display: none; }
.f-seen { filter: saturate(.35) brightness(.62); }
[data-skin="net"] .f-seen { filter: saturate(.4) opacity(.6); }
.ov { position: absolute; inset: 0; pointer-events: none; }
.area { position: absolute; margin: 2px; padding: 1px 5px; font-size: clamp(9px, 1.1vw, 11px); font-weight: 900; color: var(--ac, var(--ink-2)); white-space: nowrap; z-index: 6; display: flex; gap: 4px; align-items: baseline; line-height: 1.3; background: color-mix(in srgb, var(--bg-term) 82%, transparent); border-radius: 3px; pointer-events: none; }
.area small { font-weight: 800; color: var(--ink-2); }
.obj { position: absolute; pointer-events: auto; border: 0; padding: 2px; margin: 0; background: color-mix(in srgb, var(--tone, var(--b)) 55%, var(--bg-1)); box-shadow: inset 0 0 0 2px var(--tone, var(--b)); border-radius: 4px; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 1px; overflow: hidden; cursor: pointer; z-index: 2; color: var(--ink); --o: var(--bg-term); }
.obj .ol { font-size: clamp(8px, .9vw, 10px); font-weight: 800; line-height: 1.1; text-align: center; max-width: 100%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.obj.sel { box-shadow: inset 0 0 0 2px var(--a), 0 0 10px var(--a); z-index: 3; }
.obj.ghost-ok { background: color-mix(in srgb, var(--ok) 35%, transparent); box-shadow: inset 0 0 0 2px var(--ok); z-index: 4; pointer-events: none; }
.obj.ghost-bad { background: color-mix(in srgb, var(--danger) 35%, transparent); box-shadow: inset 0 0 0 2px var(--danger); z-index: 4; pointer-events: none; }
.obj.rot0 { border-bottom: 3px solid var(--a-hi); } .obj.rot90 { border-left: 3px solid var(--a-hi); } .obj.rot180 { border-top: 3px solid var(--a-hi); } .obj.rot270 { border-right: 3px solid var(--a-hi); }
.tok { position: absolute; pointer-events: auto; border: 0; padding: 0; background: transparent; display: grid; place-items: center; z-index: 5; cursor: pointer; transition: left var(--dur-fast) linear, top var(--dur-fast) linear; }
.tok span { width: 78%; height: 78%; border-radius: 50%; display: grid; place-items: center; font: 900 clamp(9px, 1.2vw, 13px) var(--font); color: #17111F; background: var(--c); box-shadow: 0 0 0 2px var(--bg-term); }
.t-npc { pointer-events: none; place-items: start end; }
.t-npc span { width: 52%; height: 52%; font-size: clamp(8px, .9vw, 10px); }
.t-me span { background: var(--a); color: #fff; box-shadow: 0 0 0 2px var(--bg-term), 0 0 10px var(--a); }
.t-ally span { background: var(--ram); }
.t-visitor span { background: var(--ap); }
.t-enemy span { background: var(--hp); color: #fff; }
[data-skin="net"] .tok span { box-shadow: 0 0 0 2px var(--o); }
</style>
