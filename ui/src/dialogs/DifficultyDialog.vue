<script setup lang="ts">
import { ref } from 'vue'
import Dialog from '../components/Dialog.vue'
import Hint from '../components/Hint.vue'
import { useSettings } from '../stores/settings'
import { useUi } from '../stores/ui'
import { DIFF_GROUPS, DIFF_PRESETS, COEF_RANGE, PR_RANGE, DC_RANGE, copyPreset, clampCoef, clampInt, type PresetName, type Coef } from '../lib/difficulty'

/**
 * 自訂難度的係數表（對話框，BALANCE 7.3 節）：從設定的「遊戲」分頁與建角第 10 步的「自訂」打開，兩邊改的是同一份（settings.customDiff）。
 * 先從一個預設的難度複製，再逐格改：首領、雜兵與精英分三段等級，各有生命、傷害、感載上限；輿論戰對手的公關點；DC 的偏移。
 */
defineProps<{ entryId: number; stacked?: boolean }>()
const st = useSettings()
const ui = useUi()
const t = st.s.customDiff
const from = ref<PresetName>('普通')
const COLS: Array<{ k: keyof Coef; n: string }> = [{ k: 'hp', n: '生命' }, { k: 'dmg', n: '傷害' }, { k: 'load', n: '感載上限' }]
function copy() { Object.assign(st.s.customDiff, copyPreset(from.value)); ui.toast(`從「${from.value}」複製了全部的數字。`) }
function setCoef(g: 'boss' | 'low12' | 'low3' | 'low45', k: keyof Coef, v: number) { t[g][k] = clampCoef(v) }
function bump(g: 'boss' | 'low12' | 'low3' | 'low45', k: keyof Coef, d: number) { setCoef(g, k, t[g][k] + d) }
const isDefault = (g: 'boss' | 'low12' | 'low3' | 'low45', k: keyof Coef) => t[g][k] === DIFF_PRESETS[from.value][g][k]
</script>

<template>
  <Dialog :entry-id="entryId" :stacked="stacked" title="自訂難度" sub="只能改敵人的係數與 DC 的偏移；其他存檔規則各自獨立" size="lg">
    <template #header><Hint title="自訂難度">敵人的係數乘在 ENEMIES 1.5 節的目標值上；傷害乘在位階的傷害倍率之後，對生命與感載都算。網內的敵人只有感載，所以網內的難度就是感載上限與傷害那兩欄。輿論戰對手每回合的公關點加減，最少 1 點。DC 的偏移加在所有寫成檔位的 DC 上。</Hint></template>
    <div class="setrow">
      <span class="nm">從預設複製</span>
      <span class="segs"><button v-for="p in (Object.keys(DIFF_PRESETS) as PresetName[])" :key="p" type="button" :class="{ on: from === p }" @click="from = p">{{ p }}</button></span>
      <button type="button" class="btn sm" data-copy @click="copy">複製</button>
    </div>
    <div class="tbl" role="table" aria-label="敵人的係數">
      <div class="tr th" role="row"><span role="columnheader">群組</span><span v-for="c in COLS" :key="c.k" role="columnheader">{{ c.n }}</span></div>
      <div v-for="g in DIFF_GROUPS" :key="g.k" class="tr" role="row">
        <span class="gn" role="rowheader">{{ g.name }}</span>
        <span v-for="c in COLS" :key="c.k" class="cell" :class="{ chg: !isDefault(g.k, c.k) }" role="cell">
          <button type="button" :aria-label="`${g.name}的${c.n}減少`" @click="bump(g.k, c.k, -0.05)">−</button>
          <label class="sr-only" :for="`d-${g.k}-${c.k}`">{{ g.name }}的{{ c.n }}</label>
          <input :id="`d-${g.k}-${c.k}`" type="number" :min="COEF_RANGE.lo" :max="COEF_RANGE.hi" :step="COEF_RANGE.step" :value="t[g.k][c.k]" @change="setCoef(g.k, c.k, Number(($event.target as HTMLInputElement).value))">
          <button type="button" :aria-label="`${g.name}的${c.n}增加`" @click="bump(g.k, c.k, 0.05)">＋</button>
        </span>
      </div>
    </div>
    <p class="t-fine">每格 {{ COEF_RANGE.lo }}～{{ COEF_RANGE.hi }}，步進 {{ COEF_RANGE.step }}（按鈕一次 0.05）。和「{{ from }}」不同的格子左邊有粉線。</p>
    <div class="grid2">
      <div class="setrow"><span class="nm">輿論戰的對手<Hint>每回合的公關點加減（強度 × 2 ＋ 這一格），最少 1 點。</Hint></span><span class="stepper"><button type="button" aria-label="公關點減少" @click="t.pr = clampInt(t.pr - 1, PR_RANGE)">−</button><b>{{ t.pr >= 0 ? '+' : '' }}{{ t.pr }}</b><button type="button" aria-label="公關點增加" @click="t.pr = clampInt(t.pr + 1, PR_RANGE)">＋</button></span><span class="df">−3～+3</span></div>
      <div class="setrow"><span class="nm">檢定的 DC 偏移<Hint>先照等級在階梯上取檔，再加偏移；照公式算出來的 DC 不加。</Hint></span><span class="stepper"><button type="button" aria-label="DC 偏移減少" @click="t.dc = clampInt(t.dc - 1, DC_RANGE)">−</button><b data-dc>{{ t.dc >= 0 ? '+' : '' }}{{ t.dc }}</b><button type="button" aria-label="DC 偏移增加" @click="t.dc = clampInt(t.dc + 1, DC_RANGE)">＋</button></span><span class="df">−4～+4</span></div>
    </div>
    <template #footer><button type="button" class="btn pri" @click="st.s.difficulty = '自訂'; ui.toast('難度：自訂。')">用這張表</button></template>
  </Dialog>
</template>

<style scoped>
.tbl { display: grid; gap: var(--space-2); margin: var(--space-4) 0 var(--space-2); }
.tr { display: grid; grid-template-columns: minmax(140px, 1.2fr) repeat(3, minmax(0, 1fr)); gap: var(--space-3); align-items: center; }
.th span { font-size: var(--fs-label); color: var(--ink-3); font-weight: var(--fw-label); }
.gn { font-weight: 800; font-size: var(--fs-sm); }
.cell { display: flex; align-items: center; gap: var(--space-1); background: var(--bg-2); padding: var(--space-2); min-width: 0; }
.cell.chg { box-shadow: inset 3px 0 0 var(--a); }
.cell button { width: 24px; height: 24px; border: 0; background: var(--bg-term); color: var(--ink); cursor: pointer; flex: none; }
.cell input { width: 100%; min-width: 0; background: transparent; border: 0; color: var(--ink); font: 800 var(--fs-sm) var(--mono); text-align: center; }
@media (max-width: 720px) {
  .tr { grid-template-columns: repeat(3, minmax(0, 1fr)); }
  .tr .gn { grid-column: 1 / -1; }
  .th span:first-child { display: none; }
}
</style>
