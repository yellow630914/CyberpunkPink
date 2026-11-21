<script setup lang="ts">
import type { LogEntry } from '../stores/game'
/** 紀錄（UI.md 3.2 節）：系統行、正文、網內的段落、擲骰行、變化。 */
defineProps<{ entries: LogEntry[] }>()
</script>

<template>
  <div class="log">
    <article v-for="e in entries" :key="e.id" class="entry">
      <div class="sys">{{ e.time }} · <b>{{ e.place }}</b></div>
      <div class="prose">
        <p v-for="(p, i) in e.prose" :key="'p' + i">{{ p }}</p>
        <p v-for="(q, i) in e.quotes ?? []" :key="'q' + i" class="say">{{ q }}</p>
        <p v-for="(n, i) in e.net ?? []" :key="'n' + i" class="netp">{{ n }}</p>
      </div>
      <div v-if="e.roll" class="check">
        <div class="d">{{ e.roll.die + e.roll.mod }}</div>
        <div class="info">
          <b>{{ e.roll.skill }}</b> 1d20(<b>{{ e.roll.die }}</b>) + {{ e.roll.mod }} = {{ e.roll.die + e.roll.mod }} 對 DC {{ e.roll.dc }}
          <span class="grade" :class="{ fail: e.roll.result.includes('失敗') }">{{ e.roll.result }}</span>
          <span v-if="e.roll.twist" class="twist">✦ {{ e.roll.twist }}</span>
        </div>
      </div>
      <div v-if="e.changes?.length" class="chg">
        <span v-for="c in e.changes" :key="c.text" :class="c.kind">{{ c.text }}</span>
      </div>
    </article>
  </div>
</template>

<style scoped>
.entry { padding: 14px 0 16px; border-bottom: 2px solid var(--line); }
.sys { font-family: var(--mono); font-size: var(--fs-sm); color: var(--ink-3); margin-bottom: 8px; }
.sys b { color: var(--accent); }
.prose { line-height: var(--lh-prose); font-size: calc(17px * var(--fs-scale)); max-width: 720px; }
.prose p { margin: 0 0 10px; }
.say { color: #F58DBA; }
.netp { border-left: 3px solid var(--net); padding-left: 12px; font-family: var(--mono); font-size: var(--fs-ui); color: var(--ink-2); }
.check { display: flex; align-items: stretch; border-radius: 12px; overflow: hidden; background: var(--bg-2); max-width: 520px; margin: 10px 0; }
.check .d { background: var(--a); color: #fff; font-weight: 900; font-size: var(--fs-xl); padding: 6px 14px; display: grid; place-items: center; }
.check .info { padding: 7px 12px; font-size: var(--fs-sm); }
.grade { display: inline-block; padding: 1px 8px; border-radius: 6px; background: var(--c); color: var(--bg); font-weight: 800; margin-left: 4px; }
.grade.fail { background: var(--hp); color: #fff; }
.twist { color: var(--a); font-weight: 800; margin-left: 4px; }
.chg { display: flex; gap: 6px; flex-wrap: wrap; margin-top: 8px; }
.chg span { font-size: var(--fs-sm); font-weight: 800; padding: 3px 9px; border-radius: 999px; background: var(--bg-2); color: var(--ink-2); }
.chg .plus { color: var(--ram); } .chg .minus { color: var(--hp); }
</style>
