<script setup lang="ts">
import { computed, reactive } from 'vue'
import type { TeachOption, TeachPay } from '@engine/src/features/abilities'
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
const props = defineProps<{ npc?: string; facility?: string }>()
const eng = useEngine()
const ui = useUi()
const options = computed(() => eng.training.options({ ...(props.npc !== undefined ? { npc: props.npc } : {}), ...(props.facility !== undefined ? { facility: props.facility } : {}) }))
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
    <div v-if="!options.length" class="empty-note" data-none>{{ npc ? '他沒有什麼可以教你的。' : '這裡沒有開課。' }}</div>
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
.go.left { justify-content: flex-start; margin-top: var(--space-2); }
</style>
