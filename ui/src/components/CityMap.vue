<script setup lang="ts">
import { ref } from 'vue'
import { DISTRICTS } from '../data/districts'
import type { DistrictId } from '../data/types'
import Hint from './Hint.vue'

/** 城市地圖（UI.md 3.13 節）：底圖是 docs/art/city-map.svg，八個區各一個熱點；點區看街區，點街區就過去。 */
const props = defineProps<{ current: DistrictId; currentBlock: string }>()
const emit = defineEmits<{ (e: 'go', d: DistrictId, block: string): void }>()
const picked = ref<DistrictId>(props.current)
const base = import.meta.env.BASE_URL
</script>

<template>
  <div class="city">
    <div class="mapbox">
      <img :src="base + 'city-map.svg'" alt="緋夜城的地圖" draggable="false">
      <button v-for="d in DISTRICTS" :key="d.id" type="button" class="spot" :class="{ on: d.id === picked, here: d.id === current }" :style="{ left: (d.x / 1600) * 100 + '%', top: (d.y / 1000) * 100 + '%' }" :aria-label="d.name" @click="picked = d.id">
        <span>{{ d.id === current ? '你' : '' }}</span>
      </button>
    </div>
    <div class="blocks">
      <div class="dh">
        <b>{{ DISTRICTS.find(d => d.id === picked)!.name }}</b>
        <span class="tag">物價 ×{{ DISTRICTS.find(d => d.id === picked)!.price }}</span>
        <Hint title="治安與風格">{{ DISTRICTS.find(d => d.id === picked)!.security }}。主場風格：{{ DISTRICTS.find(d => d.id === picked)!.style }}。點一個街區就走過去；跨區時用掉的時間照搭車的方式算，這一版固定 20 分鐘。</Hint>
      </div>
      <div class="chips">
        <button v-for="b in DISTRICTS.find(d => d.id === picked)!.blocks" :key="b" type="button" class="blk" :class="{ here: picked === current && b === currentBlock }" @click="emit('go', picked, b)">{{ b }}</button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.mapbox { position: relative; aspect-ratio: 1600 / 1000; width: 100%; overflow: hidden; border-radius: 6px; background: #0d0a14; }
.mapbox img { width: 100%; height: 100%; display: block; user-select: none; }
.spot { position: absolute; width: 26px; height: 26px; margin: -13px 0 0 -13px; border-radius: 50%; border: 2px solid #F3E9FF; background: #17111Fcc; cursor: pointer; display: grid; place-items: center; padding: 0; }
.spot span { font: 900 var(--fs-tiny) var(--font); color: #fff; }
.spot.on { border-color: var(--a); box-shadow: 0 0 0 3px #F06AA055; }
.spot.here { background: var(--a); }
.blocks { margin-top: 8px; }
.dh { display: flex; align-items: center; gap: 6px; margin-bottom: 6px; }
.blk { font-size: var(--fs-sm); font-weight: 800; padding: 5px 10px; border-radius: 999px; background: var(--bg-2); color: var(--ink-2); border: 0; cursor: pointer; }
.blk:hover { background: var(--bg-3); }
.blk.here { background: var(--a); color: #fff; }
</style>
