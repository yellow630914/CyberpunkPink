<script setup lang="ts">
import type { PartyMember } from '../data/types'
/** 小隊的一列（ART_STYLE 4.2 節）：名字旁邊是沉溺的 DNA 鏈，下面生命、感載與餘韻。 */
defineProps<{ m: PartyMember }>()
</script>

<template>
  <div class="mem">
    <div class="ava" :class="{ me: m.me }" aria-hidden="true" />
    <div class="info">
      <div class="nm"><b>{{ m.name }}</b><span class="sink" :title="`沉溺 ${m.sink}`"><b :style="{ width: Math.min(100, m.sink) + '%' }" /></span><span class="sv">{{ m.sink }}</span><span class="role">{{ m.role }}</span></div>
      <div class="hb hp" :title="`生命 ${m.hp[0]}／${m.hp[1]}`"><b :style="{ width: (m.hp[0] / m.hp[1]) * 100 + '%' }" /></div>
      <div class="ldrow">
        <div class="hb ld" :title="`感載 ${m.load[0]}／${m.load[1]}`"><b :style="{ width: (m.load[0] / m.load[1]) * 100 + '%' }" /></div>
        <div class="ag" :title="`餘韻 ${m.afterglow}`"><i v-for="n in 3" :key="n" :class="{ on: n <= m.afterglow }" /></div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.mem { display: grid; grid-template-columns: 38px 1fr; gap: 10px; align-items: center; padding: 7px 0; min-width: 0; }
.info { min-width: 0; }
.ava { width: 38px; height: 38px; border-radius: 10px; background: var(--bg-2); position: relative; overflow: hidden; }
.ava::before { content: ""; position: absolute; left: 10px; top: 7px; width: 18px; height: 18px; border-radius: 50%; background: var(--b); }
.ava::after { content: ""; position: absolute; left: 4px; top: 24px; width: 30px; height: 20px; border-radius: 12px 12px 0 0; background: var(--b); }
.ava.me::before, .ava.me::after { background: var(--a); }
.nm { display: flex; align-items: center; gap: 6px; font-weight: 800; font-size: 13px; }
.role { margin-left: auto; color: var(--ink-3); font-weight: 700; font-size: 11px; }
.sink { width: 46px; height: 10px; position: relative; border-left: 1px solid #F06AA0; border-right: 1px solid #F06AA0; background: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='10'%3E%3Cg fill='none' stroke='%23F06AA0' stroke-width='1.4' stroke-linecap='round' opacity='0.22'%3E%3Cpath d='M0 5Q3 0 6 5T12 5'/%3E%3Cpath d='M3 2.6V5.4M9 7.4V4.6'/%3E%3C/g%3E%3C/svg%3E") 0 0/12px 10px repeat-x; flex: none; }
.sink b { position: absolute; inset: 0 auto 0 0; background: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='10'%3E%3Cg fill='none' stroke='%23F06AA0' stroke-width='1.4' stroke-linecap='round'%3E%3Cpath d='M0 5Q3 0 6 5T12 5'/%3E%3Cpath d='M3 2.6V5.4M9 7.4V4.6'/%3E%3C/g%3E%3C/svg%3E") 0 0/12px 10px repeat-x; animation: flow 1.1s linear infinite; filter: drop-shadow(0 0 3px #F06AA088); }
.sv { font: 800 10px var(--mono); color: #F58DBA; }
.hb { height: 8px; border-radius: 4px; background: #2E2339; margin-top: 5px; position: relative; overflow: hidden; }
.hb b { position: absolute; inset: 0 auto 0 0; border-radius: 4px 0 0 4px; }
.hb.hp b { background: linear-gradient(90deg, #FF4A4A, #FF8A5C); }
.hb.ld b { background: repeating-linear-gradient(120deg, #F06AA0 0 6px, #F58DBA 6px 9px); box-shadow: 0 0 6px #F06AA088; }
.ldrow { display: grid; grid-template-columns: 1fr auto; gap: 6px; align-items: center; }
.ag { display: flex; gap: 3px; margin-top: 5px; }
.ag i { width: 9px; height: 6px; border-radius: 2px; background: var(--bg-2); }
.ag i.on { background: var(--load); }
@keyframes flow { to { background-position: 12px 0; } }
:root[data-reduce-motion="true"] .sink b { animation: none; }
@media (prefers-reduced-motion: reduce) { .sink b { animation: none; } }
</style>
