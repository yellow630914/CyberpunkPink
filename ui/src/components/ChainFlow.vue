<script setup lang="ts">
import { computed } from 'vue'
import { chainLayout, type ChainStep } from '../data/workshop'

/**
 * 任務鏈的流程圖（AI 工坊的任務鏈頁）：一個節點一步，顏色照種類（程式、AI、等玩家、套用），箭頭是依賴，同一層並排。
 * 可以關掉的那一步，點節點切換（on 回傳現在開著沒）；「設定裡也有」的標一個小標。手機上改用清單（外面的頁面負責）。
 */
const props = defineProps<{ steps: ChainStep[]; on: (s: ChainStep) => boolean }>()
const emit = defineEmits<{ (e: 'toggle', s: ChainStep): void }>()
const NW = 150, NH = 58, GX = 44, GY = 18, PAD = 8
const lay = computed(() => chainLayout(props.steps))
const pos = (i: number) => ({ x: PAD + lay.value.level[i] * (NW + GX), y: PAD + lay.value.rowIn[i] * (NH + GY) })
const W = computed(() => PAD * 2 + lay.value.cols * NW + (lay.value.cols - 1) * GX)
const H = computed(() => PAD * 2 + lay.value.rows * NH + (lay.value.rows - 1) * GY)
const KIND_NAME = { code: '程式', ai: 'AI', wait: '等玩家', apply: '套用' } as const
const edges = computed(() => props.steps.flatMap((s, i) => s.deps.map(d => { const a = pos(d - 1), b = pos(i); return { k: `${d}-${i}`, x1: a.x + NW, y1: a.y + NH / 2, x2: b.x - 4, y2: b.y + NH / 2 } })))
</script>

<template>
  <div class="cf">
    <svg :viewBox="`0 0 ${W} ${H}`" :style="{ maxWidth: `${W}px` }" role="img" aria-label="任務鏈的流程圖">
      <defs><marker id="cf-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0 0L10 5L0 10z" class="ah" /></marker></defs>
      <path v-for="e in edges" :key="e.k" class="edge" :d="`M${e.x1} ${e.y1} C${e.x1 + GX / 2} ${e.y1} ${e.x2 - GX / 2} ${e.y2} ${e.x2} ${e.y2}`" marker-end="url(#cf-arrow)" />
      <g v-for="(s, i) in steps" :key="i" class="node" :class="[s.kind, { opt: s.opt, off: s.opt && !on(s) }]" :transform="`translate(${pos(i).x} ${pos(i).y})`"
        :role="s.opt ? 'button' : undefined" :tabindex="s.opt ? 0 : undefined" :aria-pressed="s.opt ? on(s) : undefined" :data-step="s.n"
        @click="s.opt && emit('toggle', s)" @keydown.enter.prevent="s.opt && emit('toggle', s)">
        <title>{{ s.n }}{{ s.task ? `（${s.task}）` : '' }}{{ s.note ? `：${s.note}` : '' }}{{ s.opt ? `。點一下${on(s) ? '關掉' : '打開'}` : '' }}</title>
        <rect :width="NW" :height="NH" rx="6" />
        <text x="10" y="20" class="k">{{ i + 1 }}・{{ KIND_NAME[s.kind] }}{{ s.task ? ` ${s.task}` : '' }}</text>
        <text x="10" y="42" class="n">{{ s.n.length > 9 ? s.n.slice(0, 9) + '…' : s.n }}</text>
        <g v-if="s.opt"><rect :x="NW - 30" y="6" width="24" height="14" rx="7" class="sw" /><circle :cx="on(s) ? NW - 13 : NW - 23" cy="13" r="5" class="knob" /></g>
        <text v-if="s.inSettings" :x="NW - 8" :y="NH - 8" text-anchor="end" class="badge">設定裡也有</text>
      </g>
    </svg>
    <div class="legend"><span class="code">程式</span><span class="ai">AI 任務</span><span class="wait">等玩家</span><span class="apply">套用</span><span class="t-fine">有開關的那一步點節點切換；關掉時改由程式照規則結算。</span></div>
  </div>
</template>

<style scoped>
.cf { overflow-x: auto; max-width: 100%; }
svg { display: block; width: 100%; height: auto; min-width: 560px; }
.edge { fill: none; stroke: var(--ink-3); stroke-width: 2; }
.ah { fill: var(--ink-3); }
.node rect:first-of-type { fill: var(--bg-2); stroke: var(--kc); stroke-width: 2.5; }
.node.code { --kc: var(--ink-3); } .node.ai { --kc: var(--a); } .node.wait { --kc: var(--ap); } .node.apply { --kc: var(--ok); }
.node.opt { cursor: pointer; }
.node.off { opacity: .45; }
.node.off rect:first-of-type { stroke-dasharray: 5 4; }
.node:focus-visible { outline: none; }
.node:focus-visible rect:first-of-type { stroke: var(--focus, var(--a)); stroke-width: 4; }
text { font-family: var(--font); fill: var(--ink); }
.k { font-size: 11px; fill: var(--kc); font-weight: 800; }
.n { font-size: 14px; font-weight: 900; }
.badge { font-size: 10px; fill: var(--ink-3); font-weight: 800; }
.sw { fill: var(--bg-term); stroke: var(--line-2); }
.node:not(.off) .sw { fill: var(--a); }
.knob { fill: var(--ink); }
.legend { display: flex; gap: var(--space-3); flex-wrap: wrap; margin-top: var(--space-2); font-size: var(--fs-fine); font-weight: 800; }
.legend span:not(.t-fine) { padding: 1px 8px; border-radius: 4px; box-shadow: inset 0 0 0 2px var(--kc); }
.legend .code { --kc: var(--ink-3); } .legend .ai { --kc: var(--a); } .legend .wait { --kc: var(--ap); } .legend .apply { --kc: var(--ok); }
</style>
