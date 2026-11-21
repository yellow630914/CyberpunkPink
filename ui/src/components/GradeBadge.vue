<script setup lang="ts">
import type { Grade } from '../data/types'
import { GRADE_LABEL, gradeColorVar } from '../lib/grade'
/** 等級標：羅馬數字，底色是等級色（ART_STYLE 4.1 節）。 */
defineProps<{ grade: Grade; small?: boolean }>()
</script>

<template>
  <span class="gb" :class="{ small }" :style="{ '--gc': gradeColorVar(grade) }">{{ GRADE_LABEL[grade] }}</span>
</template>

<style scoped>
.gb { display: inline-grid; place-items: center; min-width: 22px; height: 16px; padding: 0 4px; border-radius: 4px; background: var(--gc); color: #17111F; font: 900 var(--fs-tiny)/1 var(--mono); letter-spacing: 0; flex: none; }
.gb.small { min-width: 18px; height: 14px; font-size: var(--fs-micro); }
</style>
