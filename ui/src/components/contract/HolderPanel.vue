<script setup lang="ts">
import { computed, ref } from 'vue'
import type { AdjustPatch, HolderEventKind } from '@engine/src/features/contract'
import Hint from '../Hint.vue'
import ReasonButton from '../ReasonButton.vue'
import Tabs from '../Tabs.vue'
import TrackBar from '../TrackBar.vue'
import { useEngine } from '../../stores/engine'
import { useUi } from '../../stores/ui'
import { fmt } from '../../lib/price'
import { PARAM_LABEL, PARAM_ORDER, RULE_KINDS, RULE_NAME, adjustOf, eventRows, ruleText, termText } from '../../lib/contractView'

/**
 * 持約人這一面（從名冊上那個人打開；LEWD_SYSTEM 7.5 節）：事件頁（五種事能不能做、原因、他可能抗命）、契約頁（契約上寫的每一欄、能調的每一項、解約）、身上被裝了什麼。
 * 面板不直接改任何人的數值：只有「觸發事件」與「調整契約」兩種入口，結果由引擎與事件決定；擋住的原因逐字用引擎的。
 */
const props = defineProps<{ npc: string; page?: 'events' | 'paper' }>()
const eng = useEngine()
const ui = useUi()
const page = ref<'events' | 'paper'>(props.page ?? 'events')
const v = computed(() => eng.contract.holder(props.npc))
const events = computed(() => eventRows(eng.contract.events(props.npc)))
const body = computed(() => eng.contract.cyberOf(props.npc))
const pieces = computed(() => (body.value ? body.value.parts.flatMap((p) => p.pieces.flatMap((x) => (x ? [{ ...x, partName: p.name, partId: p.id }] : []))) : []))
/** 剛剛這一步的報告（他抗命時就是那一份） */
const lastLines = ref<string[]>([])

function done(why: string | null, ok?: string) {
  if (why) ui.toast(why, 'warn')
  else if (ok) ui.toast(ok)
}
function trigger(kind: HolderEventKind) {
  const before = eng.state.reports.length
  const why = eng.contract.trigger(props.npc, kind)
  if (why) return void ui.toast(why, 'warn')
  lastLines.value = eng.state.reports.slice(before).filter((r) => (r.action ?? '').startsWith('contract.')).map((r) => r.outcome.summary)
}
function adjust(patch: AdjustPatch, ok: string) { done(eng.contract.adjust(props.npc, patch), ok) }

// ---- 規矩 ----
const ruleKind = ref<(typeof RULE_KINDS)[number]>('zone')
const ruleValue = ref('')
const ruleAdd = computed<AdjustPatch>(() => ({ rules_add: [{ kind: ruleKind.value, value: ruleValue.value.trim() }] }))
const ruleAddReason = computed(() => (ruleValue.value.trim() ? eng.contract.adjustBlock(props.npc, ruleAdd.value) : '先寫規矩的內容。'))
function addRule() { adjust(ruleAdd.value, '規矩加上去了。'); ruleValue.value = '' }

// ---- 工作與分帳 ----
const job = ref('')
const jobSet = computed<AdjustPatch>(() => ({ job: job.value.trim() }))
const jobReason = computed(() => (job.value.trim() ? eng.contract.adjustBlock(props.npc, jobSet.value) : '先寫工作的安排。'))
const jobClear = computed<AdjustPatch>(() => ({ job: null }))
const split = ref<number | null>(null)
const splitNow = computed(() => split.value ?? Math.round((v.value?.split ?? 0) * 100))
const splitPatch = computed<AdjustPatch>(() => ({ split: splitNow.value / 100 }))

// ---- 出借 ----
const lendTo = ref('')
const lendHours = ref<number | null>(null)
const lendPatch = computed<AdjustPatch>(() => ({ lend: { to: lendTo.value.trim(), ...(lendHours.value ? { hours: lendHours.value } : {}) } }))
const lendReason = computed(() => (v.value?.lent ? null : lendTo.value.trim() ? eng.contract.adjustBlock(props.npc, lendPatch.value) : '先寫借給誰。'))

// ---- 解約（要確認） ----
const confirming = ref(false)
const stay = ref(true)
function release() {
  const why = eng.contract.release(props.npc, stay.value)
  if (why) ui.toast(why, 'warn')
  else { confirming.value = false; ui.toast(stay.value ? '解約了，他留在名冊上。' : '解約了。') }
}
const item = (k: Parameters<typeof adjustOf>[1]) => (v.value ? adjustOf(v.value, k) : undefined)
</script>

<template>
  <div v-if="v" class="holder" data-holder-panel :data-npc="npc">
    <div class="who panel cut pad">
      <div class="ava" aria-hidden="true">{{ v.name.slice(0, 1) }}</div>
      <div class="grow"><b data-name>{{ v.name }}</b><small>{{ v.type_name }}・{{ v.origin }}</small></div>
      <div class="kv2"><span class="k">橋權</span><b>管理級</b></div>
      <div class="kv2"><span class="k">主僕關係</span><b data-relation>{{ v.relation_name }}</b></div>
      <Tabs v-model="page" :tabs="[{ id: 'events', label: '事件' }, { id: 'paper', label: '契約' }]" />
    </div>

    <section v-if="page === 'events'" class="panel cut pad mt" data-page="events">
      <p class="h">現在能對{{ v.name }}做的事<Hint>依他的狀態、親密度、紙上勾的種類決定。選了就發出觸發點，事件由導演挑；結果與數值的變化由事件決定，不是在這裡直接調。親密度太低或紙上劃掉的種類，他可能抗命。一個人一種事一天一次。</Hint></p>
      <div class="grid2">
        <div v-for="e in events" :key="e.kind" class="lrow ev" :class="{ 'is-unavailable': !e.available }" :data-event="e.kind" :data-available="e.available">
          <span class="grow">
            <b>{{ e.name }}</b>
            <small v-if="e.reason" class="why" data-reason>{{ e.reason }}</small>
            <small v-if="e.crossed" data-crossed>紙上劃掉了這一種：橋不會替他擋，他可能不肯。</small>
            <small v-if="e.resistText" data-resist>{{ e.resistText }}</small>
          </span>
          <ReasonButton sm :pri="e.available" :reason="e.reason || null" :data-trigger="e.kind" @go="trigger(e.kind as HolderEventKind)">開始</ReasonButton>
        </div>
      </div>
      <div v-if="lastLines.length" class="blocking last" data-last>
        <p v-for="(l, i) in lastLines" :key="i">{{ l }}</p>
      </div>
    </section>

    <section v-else-if="page === 'paper'" class="panel cut pad mt" data-page="paper">
      <div class="cols2">
        <div>
          <div class="kv"><span>契約</span><b>{{ v.type_name }}</b></div>
          <div class="kv"><span>{{ v.debt !== undefined ? '剩下的債' : '期限' }}</span><b data-term>{{ termText(v, fmt) }}</b></div>
          <div class="kv"><span>來歷</span><b>{{ v.origin }}</b></div>
          <div class="kv"><span>親密度</span><b data-affinity>{{ v.affinity }}</b></div>
          <div class="kv"><span>照做過</span><b>{{ v.complied }} 次</b></div>
          <div class="kv"><span>沉溺</span><b>{{ v.sink }}</b></div>
          <div class="kv"><span>光紋</span><b>{{ v.mark.covered ? '遮著' : '露著' }}</b></div>
          <div v-if="v.lent" class="kv" data-lent><span>借出去了</span><b>借給{{ v.lent.to }}</b></div>
          <p class="h mt">指令範圍<Hint>契約第四條的格子。紙上劃掉的格子，橋不會替他擋下來。</Hint></p>
          <div class="chips"><span v-for="o in v.orders" :key="o.kind" class="tag" :class="{ off: !o.ticked }" :data-ticked="o.ticked">{{ o.ticked ? '☑' : '☐' }} {{ o.name }}</span></div>
        </div>
        <div>
          <TrackBar label="忠誠" :value="v.loyalty" :max="100" color="var(--ram)" />
          <p class="h mt">橋參數<Hint>有效值（含義體、藥、調校的加減）；馴化是抗命的 DC 與他聽不聽話的一部分。</Hint></p>
          <template v-if="v.bridge">
            <TrackBar v-for="p in PARAM_ORDER" :key="p" :label="PARAM_LABEL[p]" :value="v.bridge[p]" :max="100" color="var(--b)" :height="6" class="mt2" />
          </template>
          <div v-else class="empty-note">他沒有橋。</div>
        </div>
      </div>

      <div data-body>
        <p class="h mt">{{ v.name }}身上被裝了什麼<Hint>他身上現在的義體，每個部位每一槽；過了休養期才生效。來自引擎的 cyberView，這裡只看不改（手術在診所）。</Hint></p>
        <template v-if="body">
          <div class="kv"><span>沉溺的下限</span><b data-floor>{{ body.sink_floor }}</b></div>
          <div class="kv"><span>沉溺</span><b>{{ body.sink }}</b></div>
          <div class="pieces" data-pieces>
            <div v-for="p in pieces" :key="p.uid" class="piece lrow" :data-piece="p.uid" :data-status="p.status">
              <span class="grow"><b>{{ p.name }}</b><small>{{ p.partName }}・{{ p.status === 'ready' ? '生效中' : p.status === 'recovering' ? '休養中' : '停用' }}<template v-if="p.lock">・上了鎖</template></small></span>
              <span class="tag">{{ p.sink }} 沉溺</span>
            </div>
            <div v-if="!pieces.length" class="empty-note" data-none>他身上沒有義體。</div>
          </div>
        </template>
        <div v-else class="empty-note">查不到他的身體。</div>
      </div>

      <p class="h mt">能調的項目<Hint>調整只改契約上寫的東西，參數只因為事件而變。每一項各自的擋住原因是引擎的；改規矩、住處、工作、分帳他都會記得。</Hint></p>
      <div class="adj" data-adjust>
        <div class="arow" data-adjust-item="rules">
          <b>規矩</b>
          <div class="grow">
            <div v-for="(r, i) in v.rules" :key="i" class="rl" data-rule><span>{{ ruleText(r) }}</span><ReasonButton sm :reason="eng.contract.adjustBlock(npc, { rules_remove: [r] })" @go="adjust({ rules_remove: [r] }, '拿掉了。')">拿掉</ReasonButton></div>
            <div v-if="!v.rules.length" class="empty-note">沒有規矩。</div>
            <div class="inl">
              <select v-model="ruleKind" class="inp" aria-label="規矩的種類"><option v-for="k in RULE_KINDS" :key="k" :value="k">{{ RULE_NAME[k] }}</option></select>
              <input v-model="ruleValue" class="inp wide" placeholder="內容（地方、時間或服裝）" aria-label="規矩的內容">
              <ReasonButton sm :reason="ruleAddReason" data-rule-add @go="addRule">加規矩</ReasonButton>
            </div>
          </div>
        </div>
        <div class="arow" data-adjust-item="home">
          <b>住處</b>
          <div class="grow segs">
            <ReasonButton v-for="o in item('home')?.options ?? []" :key="o.value" sm :pri="o.value === v.home" :reason="o.blocked" :data-home="o.value" @go="adjust({ home: o.value as 'own' | 'base' }, '住處改了。')">{{ o.name }}</ReasonButton>
          </div>
        </div>
        <div class="arow" data-adjust-item="job">
          <b>工作的安排</b>
          <div class="grow">
            <div class="empty-note" data-job-now>{{ v.job ?? '沒有安排工作。' }}</div>
            <div class="inl">
              <input v-model="job" class="inp wide" placeholder="一句話（例：麵攤洗碗）" aria-label="工作的安排">
              <ReasonButton sm :reason="jobReason" data-job-set @go="adjust(jobSet, '工作安排好了。')">安排</ReasonButton>
              <ReasonButton v-if="v.job" sm :reason="eng.contract.adjustBlock(npc, jobClear)" data-job-clear @go="adjust(jobClear, '撤掉了。')">撤掉</ReasonButton>
            </div>
          </div>
        </div>
        <div class="arow" data-adjust-item="split">
          <b>分帳</b>
          <div class="grow">
            <div class="empty-note" data-split-now>收入他拿 {{ Math.round(v.split * 100) }}%</div>
            <div class="inl">
              <input v-model.number="split" type="number" min="0" max="100" step="5" class="inp num" aria-label="他拿幾成（百分比）" :placeholder="String(Math.round(v.split * 100))">
              <span class="k">%</span>
              <ReasonButton sm :reason="eng.contract.adjustBlock(npc, splitPatch)" data-split-set @go="adjust(splitPatch, '分帳改了。')">改分帳</ReasonButton>
            </div>
          </div>
        </div>
        <div class="arow" data-adjust-item="relation">
          <b>主僕關係</b>
          <div class="grow segs">
            <ReasonButton v-for="o in item('relation')?.options ?? []" :key="o.value" sm :pri="o.value === v.relation" :reason="o.blocked" :data-relation-opt="o.value" @go="adjust({ relation: o.value as never }, '關係改了。')">{{ o.name }}</ReasonButton>
          </div>
        </div>
        <div class="arow" data-adjust-item="lend">
          <b>出借</b>
          <div class="grow">
            <template v-if="v.lent">
              <div class="empty-note">借給{{ v.lent.to }}了。</div>
              <ReasonButton sm :reason="eng.contract.adjustBlock(npc, { lend: null })" data-lend-recall @go="adjust({ lend: null }, '叫回來了。')">叫回來</ReasonButton>
            </template>
            <div v-else class="inl">
              <input v-model="lendTo" class="inp wide" placeholder="借給誰" aria-label="借給誰">
              <input v-model.number="lendHours" type="number" min="1" class="inp num" placeholder="小時" aria-label="借幾小時">
              <ReasonButton sm :reason="item('lend')?.blocked ?? lendReason" data-lend @go="adjust(lendPatch, '借出去了。')">借出去</ReasonButton>
            </div>
            <div v-if="item('lend')?.blocked && !v.lent" class="why" data-lend-why>{{ item('lend')!.blocked }}</div>
          </div>
        </div>
      </div>

      <div class="end" data-release>
        <template v-if="!confirming">
          <button type="button" class="btn sm ghost danger" data-release-open @click="confirming = true">解約</button>
          <Hint>解約永遠是選項，而且遊戲會記得。解約之後他可以留下來當夥伴，也可以走。</Hint>
        </template>
        <div v-else class="confirm" data-release-confirm>
          <p>確定要解除和{{ v.name }}的契約嗎？這件事遊戲會記得。</p>
          <label class="chk"><input v-model="stay" type="checkbox"> 讓他留在名冊上（不勾的話，之後由事件決定他走不走）</label>
          <div class="go left">
            <button type="button" class="btn sm" @click="confirming = false">不解了</button>
            <ReasonButton sm :reason="eng.contract.releaseBlock(npc, stay)" class="danger" data-release-go @go="release">確定解約</ReasonButton>
          </div>
        </div>
      </div>
    </section>

  </div>
  <div v-else class="empty-note pad" data-none>你沒有持有這個人的契約。</div>
</template>

<style scoped>
.who { display: flex; align-items: center; gap: 12px; flex-wrap: wrap; }
.who .grow { flex: 1; min-width: 140px; }
.who small { display: block; color: var(--ink-3); font-size: var(--fs-xs); }
.ava { width: 44px; height: 44px; border-radius: 10px; background: var(--bg-2); display: grid; place-items: center; font-weight: 900; color: var(--b); flex: none; }
.kv2 { display: grid; }
.mt { margin-top: var(--space-5); }
.mt2 { margin-top: 6px; }
.tag.off { opacity: .5; text-decoration: line-through; }
.ev small { display: block; color: var(--ink-3); font-size: var(--fs-xs); }
.ev small.why, .why { color: var(--warn); font-weight: 700; font-size: var(--fs-xs); }
.last { margin-top: var(--space-4); }
.last p { margin: 0; }
.adj { display: grid; gap: var(--space-3); }
.arow { display: grid; grid-template-columns: 96px minmax(0, 1fr); gap: var(--space-3); align-items: start; padding: var(--space-3); background: var(--bg-2); }
.arow > b { font-size: var(--fs-sm); padding-top: 6px; }
.rl { display: flex; gap: var(--space-3); align-items: center; justify-content: space-between; padding: 2px 0; font-size: var(--fs-sm); }
.inl { display: flex; gap: var(--space-3); align-items: center; flex-wrap: wrap; margin-top: var(--space-2); }
.inp { background: var(--bg-term); color: var(--ink); border: 0; box-shadow: inset 0 0 0 2px var(--line); padding: 6px 10px; font: 600 var(--fs-sm) var(--font); min-width: 0; }
.inp.wide { flex: 1; min-width: 160px; }
.inp.num { width: 84px; }
.end { margin-top: var(--space-6); padding-top: var(--space-3); border-top: 2px solid var(--line); display: flex; align-items: center; gap: 6px; }
.danger { color: var(--danger); }
.confirm { display: grid; gap: var(--space-3); box-shadow: inset 3px 0 0 var(--danger); padding: var(--space-3) var(--space-4); background: var(--bg-2); width: 100%; }
.confirm p { margin: 0; font-weight: 800; }
.chk { display: flex; gap: var(--space-3); align-items: center; font-size: var(--fs-sm); }
.pieces { display: grid; gap: var(--space-2); margin-top: var(--space-4); }
.piece small { display: block; color: var(--ink-3); font-size: var(--fs-xs); }
.pad { padding: var(--space-4); }
@media (max-width: 720px) { .cols2 { grid-template-columns: minmax(0, 1fr); } .arow { grid-template-columns: minmax(0, 1fr); } .arow > b { padding-top: 0; } }
</style>
