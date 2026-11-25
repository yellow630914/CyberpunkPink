<script setup lang="ts">
import { computed } from 'vue'
import type { FallView } from '@engine/src/features/curtain'
import Hint from '../Hint.vue'
import MoneyTag from '../MoneyTag.vue'
import ReasonButton from '../ReasonButton.vue'
import { useEngine } from '../../stores/engine'
import { useUi } from '../../stores/ui'
import { BAND_NAME, fallStepName, sortPaths } from '../../lib/curtainView'

/**
 * 落幕之後（CYBERSPACE 8.8 節「打輸會怎樣」）：先是補演的確認（可以喊停），之後是三條路（付清、記帳、簽檔期）。
 * 每一條路的數字、能不能選與原因、補演的結果全是引擎的 fallView；這裡只編排：開演、喊停、選路都是 store 的 curtain 動作。
 */
const props = defineProps<{ fall: FallView }>()
const e = useEngine()
const ui = useUi()
const paths = computed(() => sortPaths(props.fall.paths))

async function run(f: () => Promise<{ status: string; reason?: string }>, fallback: string): Promise<void> {
  const r = await f()
  if (r.status !== 'applied') ui.toast(r.reason ?? fallback, 'warn')
  else { const s = e.state.reports.at(-1)?.outcome.summary; if (s) ui.toast(s) }
}
const replay = () => run(() => e.curtain.replay(), '現在開演不了。')
const callOff = () => run(() => e.curtain.callOff(), '現在喊不了停。')
const settle = (how: 'pay' | 'tab' | 'gig') => run(() => e.curtain.settle(how), '現在選不了。')
</script>

<template>
  <section class="fall" data-fall :data-step="fall.step">
    <h3 data-fall-title>落幕<small>{{ fallStepName(fall) }}</small></h3>
    <div class="kv"><span>輸在</span><b data-fall-act>第 {{ fall.act.number }} 幕・{{ fall.act.name }}</b></div>
    <div class="kv"><span>場熱</span><b data-fall-heat>{{ fall.heat }}</b></div>
    <div class="kv"><span>打賞</span><b data-fall-tips><MoneyTag kind="cash" :amount="fall.tips" /><small v-if="fall.tips !== fall.full">（沒減半是 <MoneyTag kind="cash" :amount="fall.full" />）</small></b></div>
    <div class="kv"><span>保證金</span><b data-fall-deposit><MoneyTag kind="cash" :amount="fall.deposit" />（沒收）</b></div>
    <div class="kv"><span>設備費與違約金</span><b data-fall-fine><MoneyTag kind="cash" :amount="fall.fine" /></b></div>

    <template v-if="fall.step === 'replay'">
      <div class="panel cut pad box" data-replay>
        <p class="h">補演<Hint title="補演">落幕之後，館方安排一場補演：照你和對象的契合換回打賞的一部分，也有沉溺的變化。你可以喊停：不演、打賞維持減半，直接去處理設備費與違約金。</Hint></p>
        <p v-if="fall.replay.started" class="note" data-replay-started>補演正在進行。</p>
        <p v-else class="note">館方問要不要演補演。要演就上台；喊停不扣別的，直接進到下一步。</p>
        <div class="acts">
          <ReasonButton pri :reason="fall.replay.start_block" data-replay-start @go="replay">開演</ReasonButton>
          <ReasonButton :reason="fall.replay.call_off_block" data-call-off @go="callOff">喊停</ReasonButton>
        </div>
        <p v-if="fall.replay.start_block" class="why" data-replay-why>{{ fall.replay.start_block }}</p>
      </div>
    </template>

    <template v-else>
      <p v-if="fall.called_off" class="note" data-called-off>你喊了停，沒有演補演。</p>
      <div v-if="fall.replayed" class="kv" data-replayed><span>補演結果</span><b>契合 {{ fall.replayed.fit }}（{{ BAND_NAME[fall.replayed.band] }}）・打賞 <MoneyTag kind="cash" :amount="fall.replayed.from" /> → <MoneyTag kind="cash" :amount="fall.replayed.to" /><template v-if="fall.replayed.kept !== 0"> ・沉溺 {{ fall.replayed.kept > 0 ? '+' : '' }}{{ fall.replayed.kept }}</template></b></div>
      <div class="panel cut pad box" data-paths>
        <p class="h">三條路<Hint title="三條路">設備費與違約金要處理：付清（現金）、記帳（欠簾後館，每週利息，有上限）、簽檔期（一段時間內每週至少上一場，用收入分帳抵）。選不了的灰掉，寫原因。</Hint></p>
        <div class="grid2">
          <div v-for="p in paths" :key="p.id" class="path" :class="{ 'is-unavailable': !p.can }" :data-path="p.id">
            <span class="grow"><b data-path-name>{{ p.name }}</b><small data-path-desc>{{ p.desc }}</small>
              <small v-if="p.amount > 0" data-path-amount>要 <MoneyTag kind="cash" :amount="p.amount" /></small>
              <small v-if="p.why" class="why" data-path-why>{{ p.why }}</small></span>
            <ReasonButton sm pri :reason="p.why" :data-pick="p.id" @go="settle(p.id)">選這條</ReasonButton>
          </div>
        </div>
      </div>
    </template>
  </section>
</template>

<style scoped>
.fall { display: grid; gap: var(--space-2); }
h3 { margin: 0 0 var(--space-2); font-size: var(--fs-section); display: flex; align-items: baseline; gap: var(--space-3); flex-wrap: wrap; }
h3 small { color: var(--ink-3); font-size: var(--fs-fine); font-weight: 700; }
.box { margin-top: var(--space-3); display: grid; gap: var(--space-3); }
.note { margin: 0; color: var(--ink-3); font-size: var(--fs-sm); line-height: 1.6; }
.why { margin: 0; color: var(--warn); font-size: var(--fs-fine); line-height: 1.5; }
.acts { display: flex; gap: var(--space-3); flex-wrap: wrap; }
.path { display: flex; gap: var(--space-3); align-items: flex-start; padding: var(--space-3); background: var(--bg-2); box-shadow: inset 0 0 0 1px var(--line-2); }
.path .grow { flex: 1; min-width: 0; display: grid; gap: 2px; }
.path small { color: var(--ink-3); font-size: var(--fs-fine); line-height: 1.5; }
.path small.why { color: var(--warn); }
</style>
