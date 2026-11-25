<script setup lang="ts">
import { computed } from 'vue'
import Dialog from '../components/Dialog.vue'
import Hint from '../components/Hint.vue'
import MoneyTag from '../components/MoneyTag.vue'
import ReasonButton from '../components/ReasonButton.vue'
import { useEngine } from '../stores/engine'
import { useUi } from '../stores/ui'
import { fmt } from '../lib/price'
import { DEGREE_NAME, failText, moneyKind, needLack, needRows, pctText, timeText } from '../lib/lifeView'
import type { Degree } from '@engine/src'

/**
 * 打工（UI.md 3.12 節、DOWNTIME 第 4 節）：這個設施的工作、階段（時薪、升上去的條件與進度；被內容篩選關掉的階段引擎不給）、
 * 做多久、預計的錢與成功率、上一班的結果。全部是引擎的 jobsHere；「上班」送引擎的 work.shift。升階的詢問是事件視窗，做完班自己打開。
 */
defineProps<{ entryId: number; stacked?: boolean }>()
const e = useEngine()
const ui = useUi()

const jobs = computed(() => e.work.here())
const lock = computed(() => e.work.lock())
/** 內容裡的名字（屬性、基本功；顯示用） */
const nm = (kind: string, id: string): string => e.contentName(kind, id) ?? id
const DEGREES: Degree[] = ['critical', 'success', 'fail', 'fumble']

async function shift(job: string, hours: number) {
  const r = await e.work.shift(job, hours)
  const why = failText(r, '現在做不了這份工。')
  if (why) { ui.toast(why, 'warn'); return }
  ui.toast(e.state.reports.at(-1)?.outcome.summary ?? '這一班做完了。')
}
</script>

<template>
  <Dialog :entry-id="entryId" :stacked="stacked" title="打工" :sub="jobs[0]?.facility ?? ''" size="lg">
    <template #header><Hint title="打工">一班 2、4、6 或 8 小時，花的是遊戲裡的時間。有檢定的工作照成功程度領錢：大成功多一半、失敗只有一半、大失敗領不到還會讓雇主不高興。做滿班數、雇主親密度到了就會問你要不要升階。</Hint></template>
    <div v-if="lock" class="blocking" data-lock>{{ lock }}</div>
    <div v-if="!jobs.length" class="empty-note">這裡沒有可以打的工。</div>
    <section v-for="j in jobs" :key="j.id" class="panel cut pad job" :data-job="j.id">
      <header class="jh">
        <b class="jn">{{ j.name }}</b>
        <span v-if="j.employer" class="tag">雇主：{{ j.employer.name }}・親密度 {{ j.employer.affinity }}</span>
        <span class="tag">付<MoneyTag :kind="moneyKind(j.pay)" icon-only :size="12" /></span>
        <span class="tag">累計 {{ j.hours }} 小時（{{ j.shifts }} 班）</span>
        <span v-if="j.check" class="tag" data-check>檢定：{{ nm('attribute', j.check.attr) }}<template v-if="j.check.skill">・{{ nm('skill', j.check.skill) }}</template> DC {{ j.check.dc }}（加值 {{ j.check.bonus >= 0 ? '+' : '' }}{{ j.check.bonus }}）</span>
        <span v-else class="tag">不用檢定</span>
      </header>
      <div v-if="j.block" class="blocking" data-block>{{ j.block }}</div>

      <p class="h">階段</p>
      <div class="stages">
        <div v-for="s in j.stages" :key="s.number" class="stage" :class="{ now: s.current, off: !s.reached }" :data-stage="s.number">
          <b>{{ s.number }}・{{ s.name }}</b><span v-if="s.current" class="tag hot">現在</span><span v-if="s.adult" class="tag warn">成人</span>
          <div class="kvl"><span>時薪</span><b class="mono">{{ fmt(s.wage) }}</b></div>
          <div v-for="pk in s.perks" :key="pk" class="pk">{{ pk }}</div>
          <template v-if="s.need && !s.reached">
            <div v-for="n in needRows(s.need)" :key="n.label" class="need" :class="{ ok: n.ok }">{{ n.ok ? '✓' : '○' }} {{ n.label }} {{ n.have }}／{{ n.need }}</div>
            <div v-if="s.need.extra !== null" class="need" :class="{ ok: s.need.extra }">{{ s.need.extra ? '✓' : '○' }} 另外的條件</div>
            <small v-if="j.next?.number === s.number && needLack(s.need)" class="lack" data-lack>{{ needLack(s.need) }}</small>
          </template>
        </div>
      </div>

      <p class="h mt">做多久</p>
      <div class="opts">
        <div v-for="o in j.options" :key="o.hours" class="opt" :data-hours="o.hours">
          <b>{{ o.hours }} 小時</b>
          <small>{{ timeText(o.from) }} → {{ timeText(o.to) }}</small>
          <div class="kvl"><span>預計</span><MoneyTag :kind="moneyKind(j.pay)" :amount="o.expected" :size="13" /></div>
          <div v-if="j.check" class="degs">
            <span v-for="d in DEGREES" :key="d">{{ DEGREE_NAME[d] }} {{ pctText(j.check.chances[d]) }}・{{ fmt(o.by_degree[d]) }}</span>
          </div>
          <ReasonButton sm pri :reason="j.block ?? lock" :data-shift="o.hours" @go="shift(j.id, o.hours)">上班</ReasonButton>
        </div>
      </div>

      <p v-if="j.last" class="last" data-last>上一班：{{ j.last.hours }} 小時・{{ j.last.degree ? DEGREE_NAME[j.last.degree] : '照常' }}・第 {{ j.last.stage }} 階段・領了 <MoneyTag :kind="moneyKind(j.last.pay)" :amount="j.last.amount" :size="13" /></p>
    </section>
  </Dialog>
</template>

<style scoped>
.job { margin-bottom: 12px; }
.jh { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; margin-bottom: 8px; }
.jn { font-size: var(--fs-card); }
.stages { display: grid; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); gap: 6px; }
.stage { padding: 8px 10px; background: var(--bg-2); display: grid; gap: 3px; align-content: start; min-width: 0; }
.stage.now { box-shadow: inset 0 0 0 2px var(--a); }
.stage.off { opacity: .85; }
.kvl { display: flex; justify-content: space-between; align-items: center; gap: 8px; font-size: var(--fs-sm); }
.kvl span { color: var(--ink-3); }
.pk { font-size: var(--fs-fine); color: var(--ink-2); }
.need { font-size: var(--fs-fine); color: var(--ink-3); }
.need.ok { color: var(--ram); }
.lack { color: var(--warn); font-size: var(--fs-fine); }
.mt { margin-top: 12px; }
.opts { display: grid; grid-template-columns: repeat(auto-fit, minmax(210px, 1fr)); gap: 6px; }
.opt { padding: 8px 10px; background: var(--bg-2); display: grid; gap: 4px; align-content: start; min-width: 0; }
.opt small { color: var(--ink-3); font-size: var(--fs-fine); }
.degs { display: grid; gap: 1px; font-size: var(--fs-fine); color: var(--ink-2); }
.last { margin-top: 10px; font-size: var(--fs-sm); color: var(--ink-2); display: flex; gap: 4px; align-items: center; flex-wrap: wrap; }
</style>
