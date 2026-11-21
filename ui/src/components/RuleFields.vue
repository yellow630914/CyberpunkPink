<script setup lang="ts">
import { computed } from 'vue'
import Hint from './Hint.vue'
import { useSettings } from '../stores/settings'
import { useUi } from '../stores/ui'
import { PRESET_MULT, type BillPreset } from '../lib/bills'

/**
 * 存檔規則（UI 15.1 節）：難度與各項倍率、戰敗的設定。設定的「遊戲」分頁、建角的第 10 步、標題的開新局共用這一個元件，
 * 所以三邊改的是同一個值。難度只調敵人與 DC；其餘各自獨立（BALANCE 7.4 節）。
 */
const props = withDefaults(defineProps<{ showTraitPoints?: boolean; compact?: boolean }>(), { showTraitPoints: false, compact: false })
const st = useSettings()
const s = st.s
const ui = useUi()
const DIFFS = ['故事', '輕鬆', '普通', '困難', '殘酷', '自訂'] as const
const PRESETS: BillPreset[] = ['關閉', '寬鬆', '標準', '嚴苛']
function preset(p: BillPreset) { s.billRule = p; s.billMult = PRESET_MULT[p] }
const round = (n: number) => Math.round(n * 100) / 100
function step(k: 'xpMult' | 'billMult' | 'moneyMult', d: number, lo: number, hi: number) {
  const v = round(s[k] + d)
  if (v < lo || v > hi) { ui.toast(`範圍是 ×${lo}～${hi}。`, 'warn'); return }
  s[k] = v
  if (k === 'billMult') s.billRule = (Object.entries(PRESET_MULT).find(([, m]) => m === v)?.[0] as BillPreset | undefined) ?? s.billRule
}
function traitStep(d: number) {
  const v = s.traitPoints + d
  if (v < 0 || v > 8) { ui.toast('範圍是 0～8。', 'warn'); return }
  s.traitPoints = v
}
const multRows = computed(() => [
  { k: 'xpMult' as const, name: '歷練倍率', lo: 0.5, hi: 2, hint: '乘在所有的歷練點上，和難度無關（CORE_RULES 第 7 節）。' },
  { k: 'moneyMult' as const, name: '報酬與戰利品的錢', lo: 0.1, hi: 3, hint: '委託的報酬與戰利品的錢；和難度無關。' },
])
void props
</script>

<template>
  <div class="rules" :class="{ compact }">
    <p class="setgrp">難度<Hint>難度只調兩件事：敵人的生命、傷害與感載上限，以及寫成檔位的檢定 DC。下面的設定和難度分開，換難度不會動到它們。</Hint></p>
    <div class="diffs">
      <button v-for="d in DIFFS" :key="d" type="button" class="dcard" :class="{ on: s.difficulty === d }" :aria-pressed="s.difficulty === d" @click="s.difficulty = d; if (d === '自訂') ui.open('difficulty')">{{ d }}</button>
    </div>
    <div v-if="s.difficulty === '自訂'" class="go left"><button type="button" class="btn sm" @click="ui.open('difficulty')">編輯自訂的係數表</button><span class="t-fine">首領 生命 ×{{ s.customDiff.boss.hp }}・DC {{ s.customDiff.dc >= 0 ? '+' : '' }}{{ s.customDiff.dc }}・公關點 {{ s.customDiff.pr >= 0 ? '+' : '' }}{{ s.customDiff.pr }}</span></div>
    <p class="setgrp">倍率</p>
    <div class="grid2">
    <div v-for="r in multRows" :key="r.k" class="setrow" :class="{ chg: !st.isDefault(r.k) }">
      <span class="nm">{{ r.name }}<Hint :text="r.hint" /></span>
      <span class="stepper"><button type="button" :aria-label="`${r.name}減少`" @click="step(r.k, -0.1, r.lo, r.hi)">−</button><b>×{{ s[r.k] }}</b><button type="button" :aria-label="`${r.name}增加`" @click="step(r.k, 0.1, r.lo, r.hi)">＋</button></span>
      <span class="df">預設 <b>×1</b></span>
    </div>
    </div>
    <div class="setrow" :class="{ chg: !st.isDefault('billMult') || !st.isDefault('billRule') }">
      <span class="nm">每週帳單<Hint>四個快捷的檔位一次設好倍率與下坡的節奏：關閉不結算；寬鬆金額 ×0.5、付不出來只到鎖義體為止；標準每一步間隔 7 天；嚴苛金額 ×1.5、每一步間隔 4 天。選了以後倍率還可以細調（×0～2）。</Hint></span>
      <span class="segs"><button v-for="p in PRESETS" :key="p" type="button" :class="{ on: s.billRule === p }" @click="preset(p)">{{ p }}</button></span>
      <span class="stepper"><button type="button" aria-label="帳單倍率減少" @click="step('billMult', -0.1, 0, 2)">−</button><b>×{{ s.billMult }}</b><button type="button" aria-label="帳單倍率增加" @click="step('billMult', 0.1, 0, 2)">＋</button></span>
    </div>
    <p class="setgrp">戰敗<Hint>重來與回退一律可以：任何難度下，戰敗之後都可以重來這場戰鬥，或回到這個階段開始時。這一條不是設定，所以這裡不放開關。</Hint></p>
    <div class="grid2">
    <div class="setrow" :class="{ chg: !st.isDefault('defeatView') }">
      <span class="nm">戰敗事件要不要看</span>
      <span class="segs"><button v-for="v in ['一律看', '可以跳過', '不看'] as const" :key="v" type="button" :class="{ on: s.defeatView === v }" @click="s.defeatView = v">{{ v }}</button></span>
      <span class="df">預設 <b>一律看</b></span>
    </div>
    <div class="setrow" :class="{ chg: !st.isDefault('defeatTakeGear') }">
      <span class="nm">戰敗拿走義體與裝備</span>
      <button type="button" class="switch" role="switch" aria-label="戰敗拿走義體與裝備" :aria-checked="s.defeatTakeGear" :class="{ on: s.defeatTakeGear }" @click="s.defeatTakeGear = !s.defeatTakeGear" />
      <span class="df">預設 <b>開</b></span>
    </div>
    <div class="setrow" :class="{ chg: !st.isDefault('rosterDeath') }">
      <span class="nm">名冊 NPC 會死（硬派）<Hint>只有打開時，名冊上生成的行者才會死在戰鬥裡。主角與固定的人在任何設定下都不會。</Hint></span>
      <button type="button" class="switch" role="switch" aria-label="名冊 NPC 會死" :aria-checked="s.rosterDeath" :class="{ on: s.rosterDeath }" @click="s.rosterDeath = !s.rosterDeath" />
      <span class="df">預設 <b>關</b></span>
    </div>
    </div>
    <template v-if="!compact">
      <p class="setgrp">其他</p>
      <div class="grid2">
      <div class="setrow" :class="{ chg: !st.isDefault('fastTravel') }">
        <span class="nm">快速移動<Hint>城市地圖上叫計程車或開自己的車直接過去。關掉時一律用走的或在車站搭車。</Hint></span>
        <button type="button" class="switch" role="switch" aria-label="快速移動" :aria-checked="s.fastTravel" :class="{ on: s.fastTravel }" @click="s.fastTravel = !s.fastTravel" />
        <span class="df">預設 <b>開</b></span>
      </div>
      <div class="setrow" :class="{ chg: !st.isDefault('extraAccessory') }">
        <span class="nm">額外飾品格</span>
        <button type="button" class="switch" role="switch" aria-label="額外飾品格" :aria-checked="s.extraAccessory" :class="{ on: s.extraAccessory }" @click="s.extraAccessory = !s.extraAccessory" />
        <span class="df">預設 <b>關</b></span>
      </div>
      </div>
    </template>
    <div v-if="showTraitPoints" class="setrow" :class="{ chg: !st.isDefault('traitPoints') }">
      <span class="nm">建角的特質點<Hint>建角第 7 步用這些點買特質。出身另外送一個出身特質。角色建好之後就用不到了。</Hint></span>
      <span class="stepper"><button type="button" aria-label="特質點減少" @click="traitStep(-1)">−</button><b>{{ s.traitPoints }}</b><button type="button" aria-label="特質點增加" @click="traitStep(1)">＋</button></span>
      <span class="df">預設 <b>4</b></span>
    </div>
  </div>
</template>

<style scoped>
.diffs { display: grid; grid-template-columns: repeat(6, minmax(0, 1fr)); gap: 6px; }
.dcard { padding: 12px 6px; background: var(--bg-2); border: 0; color: var(--ink); font-weight: 800; cursor: pointer; }
.dcard.on { background: var(--bg-3); box-shadow: inset 0 0 0 2px var(--a); }
@media (max-width: 720px) { .diffs { grid-template-columns: repeat(3, minmax(0, 1fr)); } }
</style>
