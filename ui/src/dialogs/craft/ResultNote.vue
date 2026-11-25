<script setup lang="ts">
import { RESULT_NAME, RESULT_TONE } from '../../lib/craftView'

/** 做完一件事之後引擎的報告：結果（標題）與引擎寫給玩家的句子；畫面照寫，不自己拼。 */
defineProps<{ result: string; lines: readonly string[] }>()
</script>

<template>
  <section class="panel cut pad rn" :class="RESULT_TONE[result] ?? 'mid'" data-result :data-result-kind="result">
    <p class="h">結果・{{ RESULT_NAME[result] ?? result }}</p>
    <p v-for="(l, i) in lines" :key="i" class="line">{{ l }}</p>
  </section>
</template>

<style scoped>
.rn { box-shadow: inset 3px 0 0 var(--line-2); }
.rn.good { box-shadow: inset 3px 0 0 var(--ok); }
.rn.bad { box-shadow: inset 3px 0 0 var(--danger); }
.line { margin: 4px 0; font-size: var(--fs-sm); }
</style>
