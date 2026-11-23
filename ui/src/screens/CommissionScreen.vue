<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import StatusBar from '../components/StatusBar.vue'
import Tabs from '../components/Tabs.vue'
import MoneyTag from '../components/MoneyTag.vue'
import ReasonButton from '../components/ReasonButton.vue'
import TakePanel from '../components/commission/TakePanel.vue'
import ScoutTab from '../components/commission/ScoutTab.vue'
import CallTab from '../components/commission/CallTab.vue'
import RunTab from '../components/commission/RunTab.vue'
import { PAY_NAME } from '@engine/src/features/fixer'
import { useEngine } from '../stores/engine'
import { useUi } from '../stores/ui'
import { FACE_LABEL, gradeRoman, scaleName } from '../lib/commissionView'
import type { FaceId } from '../lib/commissionView'

/**
 * 委託（全頁，UI.md 第 7 節）：一件委託的四拍放在同一頁，頂端一排箭頭分頁：接案 → 踩點 → 召集 → 副本。
 * 全部接引擎（features/fixer、commission、roster、explore；stores/engine.ts 的 fixer 與 commission 只轉接）：這一頁只決定「現在在看哪一拍」，
 * 成功率、分帳、DC、原因都是引擎給的。全頁的理由：進副本之後城裡的事全部暫停，委託頁取代主畫面。
 */
const e = useEngine()
const ui = useUi()
const route = useRoute()
const router = useRouter()

const jobs = computed(() => e.fixer.jobs())
const view = computed(() => e.commission.view())
/** 現在看的是哪一件：網址指定的、副本開著的那件、最近接的 */
const jobId = computed<string | null>(() => {
  const asked = typeof route.query.job === 'string' ? route.query.job : null
  const run = view.value
  return (asked && jobs.value.some(j => j.id === asked) ? asked : null) ?? (run ? jobs.value.find(j => j.commission.id === run.id)?.id : null) ?? jobs.value[0]?.id ?? null
})
const job = computed(() => (jobId.value ? jobs.value.find(j => j.id === jobId.value) ?? null : null))
const fixerId = computed(() => {
  const asked = typeof route.query.fixer === 'string' ? route.query.fixer : ''
  return e.fixer.entry(asked) ? asked : job.value?.fixer ?? e.fixer.ids()[0] ?? ''
})

const first = (): string => (typeof route.query.tab === 'string' ? route.query.tab : view.value ? 'run' : job.value ? (job.value.scouts > 0 ? 'call' : 'scout') : 'take')
const tab = ref<string>(first())
const tabs = computed(() => [
  { id: 'take', label: '1 接案' },
  { id: 'scout', label: '2 踩點', disabled: !job.value },
  { id: 'call', label: '3 召集', disabled: !job.value },
  { id: 'run', label: '4 副本', disabled: !view.value },
])
// 出發之後換到副本；撤退或做完之後回到召集（做完了就回接案）
watch(() => view.value?.id ?? null, (now, was) => {
  if (now && !was) tab.value = 'run'
  else if (!now && was) tab.value = job.value ? 'call' : 'take'
})
// 網址換了分頁（例如從中間人的店「進行中的委託」連過來）：跟著換
watch(() => route.query.tab, t => { if (typeof t === 'string') tab.value = t })
watch(jobId, (now, was) => { if (now && !was && tab.value === 'take') tab.value = 'scout' })

function accepted(id: string) { void router.replace({ path: '/commission', query: { job: id } }); tab.value = 'scout' }
const dropReason = computed(() => e.blockOf('commit:fixer.drop'))
async function drop() {
  if (!job.value) return
  const r = await e.fixer.drop(job.value.id)
  if (r.status === 'refused') ui.toast(r.reason ?? '放棄不了。', 'warn')
  else { tab.value = 'take'; void router.replace({ path: '/commission' }) }
}
const mainFace = computed(() => (typeof job.value?.commission.main === 'string' ? (job.value.commission.main as FaceId) : null))
const typeName = computed(() => (job.value ? e.contentName('commission_type', String(job.value.commission.kind ?? '')) ?? '' : ''))
</script>

<template>
  <div class="screen">
    <StatusBar back title="委託" />
    <div class="wrap">
      <div class="head">
        <Tabs v-model="tab" class="arrows" :tabs="tabs" @blocked="ui.toast('還沒走到這一拍。', 'warn')" />
        <span class="grow" />
        <template v-if="job">
          <span class="t-fine">委託：</span><b data-head-name>{{ job.title }}</b>
          <span v-if="typeName" class="tag">{{ typeName }}</span><span v-if="mainFace" class="tag hot">主面 {{ FACE_LABEL[mainFace] }}</span><span class="tag">{{ gradeRoman(Number(job.commission.grade ?? 1)) }}</span>
        </template>
      </div>

      <div v-if="!e.hasCharacter" class="panel cut pad"><p class="empty-note">還沒有主角：先去建角。</p><div class="go left"><button type="button" class="btn pri" @click="router.push('/newgame')">去建角</button></div></div>

      <template v-else>
        <!-- 1 接案：手上有這一件就看條件，沒有就是中間人的清單 -->
        <div v-if="tab === 'take'">
          <div v-if="job" class="cols2" data-taken>
            <section class="panel cut pad stack">
              <p class="h">這件委託接下來了</p>
              <b>{{ job.title }}</b>
              <blockquote class="says">「{{ job.brief }}」</blockquote>
              <div class="kv"><span>談好的報酬</span><b><MoneyTag kind="cash" :amount="job.terms.reward" :size="14" /></b></div>
              <div class="kv"><span>怎麼付</span><b>{{ PAY_NAME[job.terms.pay] }}</b></div>
              <div class="kv"><span>中間人抽成</span><b>{{ Math.round(job.terms.cut * 100) }}%</b></div>
              <div class="kv"><span>規模</span><b>{{ scaleName(String(job.commission.scale ?? '')) }}・{{ job.commission.stages.length }} 階段</b></div>
              <div class="go"><ReasonButton :reason="dropReason ?? (view ? '副本進行中，要先做完或撤退。' : null)" data-drop @go="drop">放棄這件委託</ReasonButton><button type="button" class="btn" @click="ui.openRoot('fixer', { fixerId: job.fixer })">中間人的店</button><button type="button" class="btn pri" @click="tab = 'scout'">去踩點</button></div>
            </section>
          </div>
          <TakePanel v-else-if="fixerId" :fixer-id="fixerId" @accepted="accepted" @leave="router.push('/')" />
        </div>
        <ScoutTab v-else-if="tab === 'scout' && job" :job-id="job.id" @next="tab = 'call'" />
        <CallTab v-else-if="tab === 'call' && job" :job-id="job.id" />
        <RunTab v-else-if="tab === 'run'" />
      </template>
    </div>
  </div>
</template>

<style scoped>
.screen { min-height: 100vh; display: flex; flex-direction: column; }
.wrap { flex: 1; padding: var(--space-4); display: grid; gap: var(--space-4); align-content: start; min-width: 0; }
.head { display: flex; align-items: center; gap: var(--space-3); flex-wrap: wrap; min-width: 0; }
.head .grow { flex: 1; }
.arrows :deep(.tab) { clip-path: polygon(0 0, calc(100% - 12px) 0, 100% 50%, calc(100% - 12px) 100%, 0 100%, 10px 50%); padding: 9px 24px; }
.says { margin: 0; padding: var(--space-3) var(--space-4); background: var(--bg-term); box-shadow: inset 3px 0 0 var(--a); font-size: var(--fs-sm); color: var(--ink-2); }
.go.left { justify-content: flex-start; }
@media (max-width: 720px) { .wrap { padding: var(--space-3); } }
</style>
