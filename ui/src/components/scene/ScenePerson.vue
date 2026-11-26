<script setup lang="ts">
import { computed } from 'vue'
import type { PairView, PersonView } from '@engine/src/features/scene'
import TrackBar from '../TrackBar.vue'
import Hint from '../Hint.vue'

/**
 * 成人場景的參與者卡（UI.md 第 10 節）：名字與身分、感載條、餘韻的格子、部位一排（連著的粉框、這個體位碰得到的細框、碰不到的變暗）。
 * 多人時每個對象一張卡：卡裡多這個人和主角的契合與主動權（引擎的 pairs）、到了幾次、失神退出的變暗；單人沒有對象卡。
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
const props = defineProps<{
  who: 'pc' | 'partner'; person: PersonView; chips: ChipView[]; simple: boolean; roleText: string
  /** 多人：主角和這個人的契合與主動權（沒給就不畫；一對一的在中間那兩條） */
  pair?: PairView
  /** 契合條的刻度 */
  marks?: number[]
  /** 這個人是不是現在被選為行動的對象 */
  picked?: boolean
}>()
const emit = defineEmits<{ (e: 'part', id: string): void; (e: 'pick'): void }>()
const holder = computed(() => (props.pair ? (props.pair.holder === 'pc' ? '你在帶' : `${props.person.name}在帶`) : ''))
const skills = computed(() => props.person.known?.skills.length ?? 0)
</script>

<template>
  <article class="panel cut pad person" :class="[who, { out: person.out, picked }]" :data-actor="who" :data-actor-id="person.id">
    <div class="who">
      <b class="t-card">{{ person.name }}</b>
      <span v-if="person.out" class="tag" data-out>已經退出</span>
      <small>{{ roleText ? `${roleText}・` : '' }}敏感度 {{ person.sensitivity }}</small>
      <small data-gear-now>同步：{{ person.gear.name }}</small>
      <small v-if="person.climax > 0" data-climax>到了 {{ person.climax }} 次</small>
      <small v-if="skills > 0 && who === 'partner'" data-known>會 {{ skills }} 招夜課</small>
    </div>
    <TrackBar label="感載" :value="person.load.now" :max="person.load.max" color="var(--load)" striped />
    <div class="after" :aria-label="`餘韻 ${person.glow.now}／${person.glow.max}`" data-glow>
      <span class="k">餘韻</span><i v-for="n in person.glow.max" :key="n" :class="{ on: n <= person.glow.now }" />
    </div>
    <div v-if="pair" class="pm" :data-pair="person.id">
      <div class="mt"><span class="k">契合<Hint>你和這個人 0～100 的成績。刻度是評價的界線。</Hint></span><b class="mono" data-pair-fit>{{ pair.fit }}</b><span class="rate" data-pair-rating>{{ pair.rating.name }}</span></div>
      <div class="fit"><b :style="{ width: pair.fit + '%' }" /><i v-for="m in marks ?? []" :key="m" :style="{ left: m + '%' }" /></div>
      <div class="mt"><span class="k">主動權<Hint>50 以上在你手上。誰決定體位是引擎照主動權算的，結果寫在場景畫面上。</Hint></span><b class="mono" data-pair-init>{{ pair.init }}</b><span class="rate" data-pair-holder>{{ holder }}</span></div>
      <div class="ini"><i :style="{ left: pair.init + '%' }" /></div>
    </div>
    <div v-if="!simple" class="parts" data-parts>
      <button v-for="c in chips" :key="c.id" type="button" class="pt" :class="[c.state, c.pick, { 'is-unavailable': c.pick === 'no' }]" :data-part="`${who}:${c.id}`" :title="c.reason" @click="emit('part', c.id)">{{ c.label }}</button>
    </div>
    <div v-if="who === 'partner'" class="chips"><span v-for="t in person.tags" :key="t" class="tag">{{ t }}</span><span class="tag" title="還不知道的傾向">？</span></div>
    <button v-if="pair && !person.out" type="button" class="btn sm" :class="{ pri: picked }" :aria-pressed="picked" :data-pick-target="person.id" @click="emit('pick')">{{ picked ? '行動的對象' : '選為對象' }}</button>
  </article>
</template>

<style scoped>
.person { display: grid; gap: var(--space-3); align-content: start; min-width: 0; }
.person.out { opacity: .5; filter: saturate(.5); }
.person.picked { box-shadow: inset 0 0 0 2px var(--ap); }
.who small { display: block; color: var(--ink-3); font-size: var(--fs-fine); }
.after { display: flex; gap: 4px; align-items: center; }
.after i { width: 18px; height: 8px; border-radius: 2px; background: var(--bg-2); }
.after i.on { background: var(--load); }
.pm { display: grid; gap: 2px; }
.pm .mt { display: flex; gap: var(--space-3); align-items: baseline; flex-wrap: wrap; }
.rate { color: var(--ink-3); font-size: var(--fs-fine); font-weight: 800; }
.fit { height: 10px; border-radius: 5px; background: var(--bg-2); margin: 2px 0 6px; position: relative; overflow: hidden; }
.fit b { position: absolute; inset: 0 auto 0 0; background: linear-gradient(90deg, #8E7CC3, var(--ep)); border-radius: 5px; }
.fit i { position: absolute; top: 0; bottom: 0; width: 1px; background: var(--bg); }
.ini { height: 10px; border-radius: 5px; background: linear-gradient(90deg, var(--bg-2) 0 50%, var(--bg-3) 50%); margin-top: 4px; position: relative; }
.ini::after { content: ""; position: absolute; left: 50%; top: -3px; bottom: -3px; width: 2px; background: var(--ink-3); }
.ini i { position: absolute; top: -4px; width: 6px; height: 18px; border-radius: 3px; background: var(--ink); transform: translateX(-50%); }
.parts { display: flex; gap: 6px; flex-wrap: wrap; }
.pt { font-size: var(--fs-label); font-weight: 800; padding: 5px 10px; border-radius: 7px; border: 0; cursor: pointer; background: var(--bg-term); color: var(--ink-3); }
.pt.reach { color: var(--ink-2); box-shadow: inset 0 0 0 1px var(--line-2); }
.pt.link { color: var(--ink); background: color-mix(in srgb, var(--a) 22%, var(--bg-2)); box-shadow: inset 0 0 0 2px var(--a); }
.pt.off { opacity: .55; }
.pt.can { opacity: 1; color: var(--ink); box-shadow: inset 0 0 0 2px var(--ap); }
.pt.picked { opacity: 1; color: var(--ink); background: color-mix(in srgb, var(--ap) 24%, var(--bg-2)); box-shadow: inset 0 0 0 2px var(--ap); }
.chips { display: flex; gap: 6px; flex-wrap: wrap; }
</style>
