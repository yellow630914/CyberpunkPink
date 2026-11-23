<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import type { CityDistrictView } from '../lib/worldView'
import Hint from './Hint.vue'

/**
 * 城市地圖（UI.md 3.13 節）：底圖是 docs/art/city-map.svg，每個區一個熱點；點區看街區，點街區選它（go 事件）。
 * 區與街區怎麼連、你在哪裡都是引擎給的（cityGraph、worldView），由外面整理成 districts 傳進來；這裡只畫。
 * 選了之後怎麼去由外面決定（城市地圖對話框：計程車；大眾運輸要到街區圖上的車站搭）。
 */
const props = defineProps<{ districts: CityDistrictView[]; current: string | null; currentBlock: string | null; pickedBlock?: string | null }>()
const emit = defineEmits<{ (e: 'go', d: string, block: string): void }>()
const picked = ref<string | null>(props.current ?? props.districts[0]?.id ?? null)
watch(() => props.districts.length, () => { if (!picked.value) picked.value = props.current ?? props.districts[0]?.id ?? null })
const pickedDistrict = computed(() => props.districts.find(d => d.id === picked.value) ?? null)
const base = import.meta.env.BASE_URL
</script>

<template>
  <div class="city">
    <div class="mapbox">
      <img :src="base + 'city-map.svg'" alt="緋夜城的地圖" draggable="false">
      <button v-for="d in districts" :key="d.id" type="button" class="spot" :class="{ on: d.id === picked, here: d.id === current }" :style="{ left: (d.x / 1600) * 100 + '%', top: (d.y / 1000) * 100 + '%' }" :aria-label="d.name" @click="picked = d.id">
        <span>{{ d.id === current ? '你' : '' }}</span>
      </button>
    </div>
    <div v-if="pickedDistrict" class="blocks">
      <div class="dh">
        <b>{{ pickedDistrict.name }}</b>
        <span v-if="pickedDistrict.price !== null" class="tag">物價 ×{{ pickedDistrict.price }}</span>
        <Hint v-if="pickedDistrict.security || pickedDistrict.style" title="治安與風格">{{ pickedDistrict.security }}<template v-if="pickedDistrict.style">。主場風格：{{ pickedDistrict.style }}</template>。</Hint>
      </div>
      <div class="chips">
        <button v-for="b in pickedDistrict.blocks" :key="b.id" type="button" class="blk" :class="{ here: b.id === currentBlock, sel: b.id === pickedBlock }" :aria-pressed="b.id === pickedBlock" @click="emit('go', pickedDistrict.id, b.id)">{{ b.name }}<template v-if="b.kind === 'bridge'">（橋接區）</template></button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.mapbox { position: relative; aspect-ratio: 1600 / 1000; width: 100%; overflow: hidden; border-radius: 6px; background: var(--bg-term); }
.mapbox img { width: 100%; height: 100%; display: block; user-select: none; }
.spot { position: absolute; width: 26px; height: 26px; margin: -13px 0 0 -13px; border-radius: 50%; border: 2px solid var(--ink); background: color-mix(in srgb, var(--bg-term) 80%, transparent); cursor: pointer; display: grid; place-items: center; padding: 0; }
.spot span { font: 900 var(--fs-tiny) var(--font); color: var(--on-a); }
.spot.on { border-color: var(--a); box-shadow: 0 0 0 3px color-mix(in srgb, var(--a) 35%, transparent); }
.spot.here { background: var(--a); }
.blocks { margin-top: 8px; }
.dh { display: flex; align-items: center; gap: 6px; margin-bottom: 6px; }
.chips { display: flex; flex-wrap: wrap; gap: var(--space-3); }
.blk { font-size: var(--fs-sm); font-weight: 800; padding: 5px 10px; border-radius: 999px; background: var(--bg-2); color: var(--ink-2); border: 0; cursor: pointer; }
.blk:hover { background: var(--bg-3); }
.blk.here { background: var(--a); color: var(--on-a); }
.blk.sel { box-shadow: inset 0 0 0 2px var(--ap); }
</style>
