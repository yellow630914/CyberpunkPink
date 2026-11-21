<script setup lang="ts">
import { computed } from 'vue'
import centers from '../data/icon-centers.json'

/**
 * 圖標：第 1、2 層與技能的備用圖標在 icons-sprite.svg（id 以 ic- 開頭），
 * 第 3 層（每件物品、每個技能，id 以 it_、sk_ 開頭）在 icons-items.svg：scripts/build-icons.mjs 從
 * docs/art/style/icons-l3-sprite.svg 抽出資料用到的那些並攤平（外部 sprite 裡的巢狀 <use> 瀏覽器不畫）。
 * 配色吃 --o（輪廓）、--a（粉的那一筆）、--b、--c（主體），跟著皮換。
 * fit：照 icon-centers.json 的外框裁掉留白（小尺寸用）。
 */
const props = withDefaults(defineProps<{ id: string; size?: number | string; fit?: boolean; label?: string }>(), { size: 24, fit: false })
const base = import.meta.env.BASE_URL
const href = computed(() => {
  const l3 = props.id.startsWith('it_') || props.id.startsWith('sk_')
  return `${base}${l3 ? 'icons-items.svg' : 'icons-sprite.svg'}#${props.id}`
})
const viewBox = computed(() => {
  if (!props.fit) return '0 0 200 200'
  const c = (centers as Record<string, number[]>)[props.id.replace(/^ic-/, '')]
  if (!c) return '0 0 200 200'
  const [cx, cy, w, h] = c
  const s = Math.max(w, h) + 24
  return `${cx - s / 2} ${cy - s / 2} ${s} ${s}`
})
const px = computed(() => (typeof props.size === 'number' ? `${props.size}px` : props.size))
</script>

<template>
  <svg class="icon" :viewBox="viewBox" :style="{ width: px, height: px }" :role="label ? 'img' : undefined" :aria-label="label" :aria-hidden="label ? undefined : 'true'">
    <use :href="href" x="0" y="0" width="200" height="200" />
  </svg>
</template>

<style scoped>
.icon { display: block; flex: none; overflow: visible; }
</style>
