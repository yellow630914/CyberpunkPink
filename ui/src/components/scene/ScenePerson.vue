<script setup lang="ts">
import type { PersonView } from '@engine/src/features/scene'
import TrackBar from '../TrackBar.vue'

/**
 * 成人場景的參與者卡（UI.md 第 10 節）：名字與身分、感載條、餘韻的格子、部位一排（連著的粉框、這個體位碰得到的細框、碰不到的變暗）。
 * 數字全是引擎的 sceneView 給的；選部位時每個部位的狀態與原因由畫面（照引擎宣告的選項）傳進來。精簡版不畫部位。
 */
export interface ChipView {
  id: string
  label: string
  state: 'link' | 'reach' | 'off'
  /** 選部位時：can 點得下去、no 點不下去（title 是引擎的原因）、picked 已選的 */
  pick?: 'can' | 'no' | 'picked'
  reason?: string
}
defineProps<{ who: 'pc' | 'partner'; person: PersonView; chips: ChipView[]; simple: boolean; roleText: string }>()
defineEmits<{ (e: 'part', id: string): void }>()
</script>

<template>
  <article class="panel cut pad person" :class="who" :data-actor="who">
    <div class="who"><b class="t-card">{{ person.name }}</b><small>{{ roleText ? `${roleText}・` : '' }}敏感度 {{ person.sensitivity }}</small></div>
    <TrackBar label="感載" :value="person.load.now" :max="person.load.max" color="var(--load)" striped />
    <div class="after" :aria-label="`餘韻 ${person.glow.now}／${person.glow.max}`" data-glow>
      <span class="k">餘韻</span><i v-for="n in person.glow.max" :key="n" :class="{ on: n <= person.glow.now }" />
    </div>
    <div v-if="!simple" class="parts" data-parts>
      <button v-for="c in chips" :key="c.id" type="button" class="pt" :class="[c.state, c.pick, { 'is-unavailable': c.pick === 'no' }]" :data-part="`${who}:${c.id}`" :title="c.reason" @click="$emit('part', c.id)">{{ c.label }}</button>
    </div>
    <div v-if="who === 'partner'" class="chips"><span v-for="t in person.tags" :key="t" class="tag">{{ t }}</span><span class="tag" title="還不知道的傾向">？</span></div>
  </article>
</template>

<style scoped>
.person { display: grid; gap: var(--space-3); align-content: start; min-width: 0; }
.who small { display: block; color: var(--ink-3); font-size: var(--fs-fine); }
.after { display: flex; gap: 4px; align-items: center; }
.after i { width: 18px; height: 8px; border-radius: 2px; background: var(--bg-2); }
.after i.on { background: var(--load); }
.parts { display: flex; gap: 6px; flex-wrap: wrap; }
.pt { font-size: var(--fs-label); font-weight: 800; padding: 5px 10px; border-radius: 7px; border: 0; cursor: pointer; background: var(--bg-term); color: var(--ink-3); }
.pt.reach { color: var(--ink-2); box-shadow: inset 0 0 0 1px var(--line-2); }
.pt.link { color: var(--ink); background: color-mix(in srgb, var(--a) 22%, var(--bg-2)); box-shadow: inset 0 0 0 2px var(--a); }
.pt.off { opacity: .55; }
.pt.can { opacity: 1; color: var(--ink); box-shadow: inset 0 0 0 2px var(--ap); }
.pt.picked { opacity: 1; color: var(--ink); background: color-mix(in srgb, var(--ap) 24%, var(--bg-2)); box-shadow: inset 0 0 0 2px var(--ap); }
.chips { display: flex; gap: 6px; flex-wrap: wrap; }
</style>
