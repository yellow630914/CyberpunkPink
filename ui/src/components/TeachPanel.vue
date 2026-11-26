<script setup lang="ts">
import { computed, reactive } from 'vue'
import type { TeachOption, TeachPay, TutorOption } from '@engine/src/features/abilities'
import Hint from './Hint.vue'
import ReasonButton from './ReasonButton.vue'
import { useEngine } from '../stores/engine'
import { useUi } from '../stores/ui'
import { fmt } from '../lib/price'

/**
 * 請教與上課（基本功 5、6 級；CORE_RULES 7.2、7.5 節；features/abilities 的 teachOptions、lessonDraft）：
 * 向人請教（npc）列他能教的基本功；去機構上課（不給 npc 時是腳下的設施，或 facility 指定的那一種）。
 * 每一項寫要升到幾級、他最多教到幾級、上幾個時段、已經上了幾個、三種付法各自行不行與原因、上完之後升級要花的歷練點。
 * 只編排：能不能上、原因、學費、進度都是引擎的；上完要到技能樹花歷練點升級。
 */
/** tutor：互動選單的 handoff 帶 also（abilities.tutorOptions）時，也列這位老師教的工藝課 */
const props = defineProps<{ npc?: string; facility?: string; tutor?: boolean }>()
const eng = useEngine()
const ui = useUi()
const options = computed(() => eng.training.options({ ...(props.npc !== undefined ? { npc: props.npc } : {}), ...(props.facility !== undefined ? { facility: props.facility } : {}) }))
const tutorRows = computed<TutorOption[]>(() => (props.tutor && props.npc !== undefined ? eng.training.tutorOptions(props.npc) : []))
const tutorPay = reactive<Record<string, 'cred' | 'cash' | undefined>>({})
const POOL_NAME = { cred: '帳戶', cash: '現金' } as const
function goTutor(o: TutorOption) {
  const pay = tutorPay[o.skill]
  const why = eng.training.tutorLesson({ npc: o.npc, skill: o.skill, ...(pay ? { pay } : {}) })
  if (why) ui.toast(why, 'warn')
  else ui.toast(`上了一個時段的${o.name}課。`)
}
const PAY_NAME: Record<TeachPay, string> = { affinity: '靠交情（免費）', favor: '還人情（免費）', tuition: '付學費' }
const chosen = reactive<Record<string, TeachPay>>({})
const keyOf = (o: TeachOption): string => `${o.skill}@${'npc' in o.from ? o.from.npc : o.from.facility}`
const payOf = (o: TeachOption): TeachPay | undefined => chosen[keyOf(o)] ?? o.pays.find((p) => p.ok)?.pay ?? o.pays[0]?.pay
const payRow = (o: TeachOption) => o.pays.find((p) => p.pay === payOf(o))
function go(o: TeachOption) {
  const pay = payOf(o)
  const why = eng.training.lesson({ skill: o.skill, from: o.from, ...('npc' in o.from && pay ? { pay } : {}) })
  if (why) ui.toast(why, 'warn')
  else ui.toast(`上了一個時段的${o.name}課。`)
}
</script>

<template>
  <div class="teach" data-teach>
    <p class="h">{{ npc ? '請教' : '機構的課' }}<Hint>基本功到了 5、6 級要有人教：向比你高的人請教（他幾級就教到幾級），或去機構上課（只教到 5 級）。每升一級要上幾個時段，一個時段花幾個小時；上到一半換老師進度不留。上完之後到技能樹花歷練點升級。</Hint></p>
    <div v-for="o in options" :key="keyOf(o)" class="panel pad opt" :data-lesson="o.skill" :data-ok="o.ok">
      <div class="top">
        <b data-skill>{{ o.name }}</b>
        <span class="tag">{{ o.fromName }}</span>
        <span class="mono lv" data-level>升到 {{ o.level }} 級（他最多教到 {{ o.max }} 級）</span>
      </div>
      <div class="kv"><span>進度</span><b data-progress>{{ o.done }}／{{ o.need }} 個時段・一個時段 {{ Math.round(o.minutes / 60) }} 小時</b></div>
      <div class="kv"><span>上完之後升級</span><b>要 {{ o.xp }} 點歷練點</b></div>
      <div v-if="'npc' in o.from" class="pays" role="group" aria-label="怎麼付">
        <ReasonButton v-for="p in o.pays" :key="p.pay" sm :pri="payOf(o) === p.pay" :reason="p.reason" :data-pay="p.pay" @go="chosen[keyOf(o)] = p.pay">{{ PAY_NAME[p.pay] }}<template v-if="p.pay === 'tuition'">（C${{ fmt(p.price) }}）</template></ReasonButton>
      </div>
      <div v-else class="kv"><span>學費</span><b data-tuition>C${{ fmt(o.pays[0]?.price ?? 0) }}（第一個時段付清）</b></div>
      <div v-if="o.reason" class="why" data-reason>{{ o.reason }}</div>
      <div v-else-if="payRow(o) && !payRow(o)!.ok" class="why" data-reason>{{ payRow(o)!.reason }}</div>
      <div class="go left"><ReasonButton sm pri :reason="o.reason ?? (payRow(o) && !payRow(o)!.ok ? payRow(o)!.reason : null)" data-lesson-go @go="go(o)">上一個時段</ReasonButton></div>
    </div>
    <template v-if="tutorRows.length">
      <p class="h">工藝課<Hint>機械、義體學、醫療在 0、1 級時，可以付學費跟老師學到 2 級，不花歷練點。一位老師對一個人只教一項；上到一半換老師進度不留，學費不退。</Hint></p>
      <div v-for="o in tutorRows" :key="`tutor-${o.skill}`" class="panel pad opt" :data-tutor="o.skill" :data-ok="o.ok">
        <div class="top">
          <b data-skill>{{ o.name }}</b>
          <span class="tag">{{ o.npcName }}</span>
          <span v-if="o.where" class="k">{{ o.where }}</span>
          <span class="mono lv" data-level>升到 {{ o.level }} 級（這條路最多教到 {{ o.max }} 級）</span>
        </div>
        <div class="kv"><span>進度</span><b data-progress>{{ o.done }}／{{ o.need }} 個時段・一個時段 {{ Math.round(o.minutes / 60) }} 小時</b></div>
        <div class="kv"><span>學費</span><b data-tuition>C${{ fmt(o.price) }}<template v-if="o.price === 0 && o.done > 0">（這一級已經付過）</template><template v-else>（第一個時段付清）</template></b></div>
        <div v-if="o.sink > 0" class="kv"><span>每個時段</span><b>沉溺 +{{ o.sink }}</b></div>
        <div v-if="o.price > 0" class="pays" role="group" aria-label="學費從哪裡付">
          <button type="button" class="btn sm" :class="{ pri: !tutorPay[o.skill] }" @click="tutorPay[o.skill] = undefined">先帳戶再現金</button>
          <button v-for="(n, p) in POOL_NAME" :key="p" type="button" class="btn sm" :class="{ pri: tutorPay[o.skill] === p }" :data-tutor-pay="p" @click="tutorPay[o.skill] = p">{{ n }}</button>
        </div>
        <div v-if="o.note" class="note" data-note>{{ o.note }}</div>
        <div v-if="o.reason" class="why" data-reason>{{ o.reason }}</div>
        <div class="go left"><ReasonButton sm pri :reason="o.reason" data-tutor-go @go="goTutor(o)">上一個時段</ReasonButton></div>
      </div>
    </template>
    <div v-if="!options.length && !tutorRows.length" class="empty-note" data-none>{{ npc ? '他沒有什麼可以教你的。' : '這裡沒有開課。' }}</div>
  </div>
</template>

<style scoped>
.teach { display: grid; gap: var(--space-4); }
.opt { display: grid; gap: var(--space-2); box-shadow: inset 3px 0 0 var(--a); }
.top { display: flex; gap: var(--space-3); align-items: center; flex-wrap: wrap; }
.top b { font-size: var(--fs-card); }
.lv { color: var(--ink-3); font-size: var(--fs-sm); }
.pays { display: flex; gap: var(--space-2); flex-wrap: wrap; margin-top: var(--space-2); }
.why { color: var(--warn); font-weight: 700; font-size: var(--fs-sm); }
.note { color: var(--ink-2); font-size: var(--fs-sm); }
.go.left { justify-content: flex-start; margin-top: var(--space-2); }
</style>
