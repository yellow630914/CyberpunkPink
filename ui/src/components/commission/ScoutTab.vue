<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { CAT_NAME } from '@engine/src/features/fixer'
import type { IntelWith } from '@engine/src/features/fixer'
import Hint from '../Hint.vue'
import MoneyTag from '../MoneyTag.vue'
import ReasonButton from '../ReasonButton.vue'
import { useEngine } from '../../stores/engine'
import { useUi } from '../../stores/ui'
import { FACE_LABEL, hoursOf } from '../../lib/commissionView'
import type { FaceId } from '../../lib/commissionView'

/**
 * 踩點（UI 7.2）：未知清單、次數、副本的樣子、上一次的結果、手段、買情報。資料全部是引擎的 scoutView；
 * 手段能不能用、買情報的價錢與原因、次數用完的原因都是引擎寫的句子。派名冊的人去踩點引擎說「還沒有開放。」，照列、灰掉。
 */
const props = defineProps<{ jobId: string }>()
const emit = defineEmits<{ (e: 'next'): void }>()
const e = useEngine()
const ui = useUi()

const sv = computed(() => e.fixer.scoutView(props.jobId))
const means = ref('')
watch(sv, v => { if (!means.value || !v.methods.some(m => m.id === means.value)) means.value = v.methods.find(m => m.block === null)?.id ?? v.methods[0]?.id ?? '' }, { immediate: true })
const method = computed(() => sv.value.methods.find(m => m.id === means.value) ?? null)
const methodName = (id: string): string => sv.value.methods.find(m => m.id === id)?.name ?? id
const skillName = (id: string): string => e.contentName('skill', id) ?? id
const working = ref(false)
const buyTarget = ref('')
const buyWith = ref<IntelWith>('cash')
const hidden = computed(() => sv.value.unknowns.filter(u => !u.revealed))
watch(hidden, h => { if (!h.some(u => u.id === buyTarget.value)) buyTarget.value = h[0]?.id ?? '' }, { immediate: true })
const fresh = computed(() => new Set(sv.value.last?.revealed ?? []))
const DEGREE: Record<string, string> = { critical: '大成功', success: '成功', fail: '失敗', fumble: '大失敗' }

const gate = computed(() => e.blockOf('commit:fixer.scout'))
const scoutReason = computed(() => gate.value ?? method.value?.block ?? null)
const intel = computed(() => sv.value.intel.find(i => i.id === buyWith.value) ?? null)
const buyReason = computed(() => e.blockOf('commit:fixer.buy_intel') ?? (hidden.value.length === 0 ? '未知清單都揭開了。' : intel.value?.block ?? '買情報現在不能用。'))
/** 一個時段「從幾點到幾點」：只是把引擎給的分鐘數接在現在的時間後面 */
const span = computed(() => {
  const [h, m] = e.timeLabel.split(':').map(Number)
  const end = ((h! * 60 + m! + sv.value.minutes) % 1440 + 1440) % 1440
  return `${e.timeLabel} 起 ${hoursOf(sv.value.minutes)}，到 ${String(Math.floor(end / 60)).padStart(2, '0')}:${String(end % 60).padStart(2, '0')}`
})

async function scout() {
  if (!method.value || working.value) return
  working.value = true
  const r = await e.fixer.scout(props.jobId, method.value.id)
  working.value = false
  if (r.status === 'refused') ui.toast(r.reason ?? '現在踩不了點。', 'warn')
}
async function buy() {
  if (!buyTarget.value || working.value) return
  working.value = true
  const r = await e.fixer.buyIntel(props.jobId, buyTarget.value, buyWith.value)
  working.value = false
  if (r.status === 'refused') ui.toast(r.reason ?? '買不了。', 'warn')
}
</script>

<template>
  <div class="cols3" data-scout-tab>
    <section class="panel cut pad stack">
      <p class="h">未知清單・已揭開 {{ sv.unknowns.filter(u => u.revealed).length }}／{{ sv.unknowns.length }}</p>
      <div class="grid2" style="--col-min: 200px">
        <div v-for="u in sv.unknowns" :key="u.id" class="unk" :class="{ open: u.revealed, fresh: fresh.has(u.id), net: u.face === 'net' }" :data-unknown="u.id" :data-face="u.face ?? undefined">
          <span class="kc">{{ u.cat_name }}<em v-if="u.face === 'net'" class="fm" data-face-mark>內海</em></span><b>{{ u.revealed ? u.text : '？？？？' }}</b>
          <small v-if="!u.revealed">{{ u.methods.map(methodName).join('・') }}可以揭開</small>
        </div>
      </div>
      <p class="h" style="margin-top: 12px">踩點次數 <span data-scouts>{{ sv.done }}／{{ sv.max }}</span><Hint>最多踩階段數那麼多次。第 {{ sv.hard_from }} 次起難度 +1（橘框）。大失敗（含自然 1）會驚動目標（駭入：內海的追蹤度起始值加；其他：現實的警戒起始值加）。</Hint></p>
      <div class="pips"><i v-for="n in sv.max" :key="n" :class="{ used: n <= sv.done, hard: n >= sv.hard_from }" /></div>
      <p v-if="sv.trace_depart > 0" class="t-fine" data-trace-depart>現在出發的話，追蹤度從 {{ sv.trace_depart }} 開始（目標勢力對你的敵對值與踩點驚動，取高的）。</p>
      <p v-if="sv.alert_start > 0 || sv.trace_start > 0" class="t-fine warn-t" data-alarm>驚動了目標：進去的時候{{ sv.alert_start > 0 ? `警戒起始 +${sv.alert_start}` : '' }}{{ sv.trace_start > 0 ? `　追蹤度起始 +${sv.trace_start}` : '' }}。</p>
    </section>

    <section class="panel cut pad stack">
      <p class="h">揭開之後，副本長這樣</p>
      <div class="track"><span v-for="s in sv.brief.rows" :key="s.n" class="node" :class="{ key: s.last }">{{ s.last ? '★ ' : '' }}第 {{ s.n }} 階段：<template v-if="s.known && s.faces">{{ s.faces.map(f => FACE_LABEL[f as FaceId] ?? f).join('、') }}</template><template v-else>？</template></span></div>
      <div v-if="sv.last" class="roll mono" data-last>
        上一次：{{ methodName(sv.last.method) }}（{{ skillName(sv.last.skill) }}）　1d20 {{ sv.last.natural }} → 合計 {{ sv.last.total }}，對 {{ sv.last.dc }}：{{ DEGREE[sv.last.degree] ?? sv.last.degree }}。
        <template v-if="sv.last.revealed.length">揭開了 {{ sv.last.revealed.length }} 項。</template>
        <b v-if="sv.last.degree === 'fumble'" class="warn-t" data-fumble>大失敗驚動了目標{{ sv.last.natural === 1 ? '（自然 1）' : '' }}：{{ sv.last.trace ? `追蹤度起始 +${sv.last.trace}` : `警戒起始 +${sv.last.alert ?? 0}` }}。</b>
      </div>
      <p class="t-fine">下一次：對 {{ sv.next_dc }}，花一個時段（{{ span }}）。大失敗（含自然 1）會驚動目標。</p>
      <div class="go"><button type="button" class="btn" @click="emit('next')">不踩了，去召集</button><ReasonButton pri :reason="scoutReason" data-scout @go="scout">去踩點</ReasonButton></div>
    </section>

    <aside class="stack">
      <section class="panel cut pad">
        <p class="h">選一種手段・對 {{ sv.next_dc }}</p>
        <div class="row-list">
          <button v-for="m in sv.methods" :key="m.id" type="button" class="lrow" :class="{ on: means === m.id, 'is-unavailable': !!m.block }" :aria-disabled="!!m.block || undefined" :data-method="m.id" @click="m.block ? ui.toast(m.block, 'warn') : (means = m.id)">
            <span class="grow"><b>{{ m.name }}</b><small>{{ m.skills.map(skillName).join('或') }}・{{ m.cats.map(c => CAT_NAME[c]).join('、') }}</small><small v-if="m.block" class="warn-t">{{ m.block }}</small></span>
            <span class="mono">對 {{ m.dc }}</span>
          </button>
          <div v-for="l in sv.locked" :key="l.id" class="lrow is-unavailable" :data-locked="l.id"><span class="grow"><b>{{ l.name }}</b><small>{{ l.block }}</small></span></div>
        </div>
      </section>
      <section class="panel cut pad">
        <p class="h">買情報<Hint>指定一項，付錢或用掉一個人情就直接揭開；不擲骰，不花時間，也不算踩點的次數。</Hint></p>
        <label class="buy"><span class="k">買哪一項</span>
          <select v-model="buyTarget" data-buy-target><option v-for="u in hidden" :key="u.id" :value="u.id">{{ u.cat_name }}</option></select></label>
        <div class="row-list">
          <button v-for="o in sv.intel" :key="o.id" type="button" class="lrow" :class="{ on: buyWith === o.id, 'is-unavailable': !!o.block }" :aria-disabled="!!o.block || undefined" :data-intel="o.id" @click="buyWith = o.id">
            <span class="grow"><b>{{ o.name }}</b><small>{{ o.cost }}</small><small v-if="o.block" class="warn-t">{{ o.block }}</small></span>
            <MoneyTag v-if="o.id === 'cash'" kind="cash" :amount="o.price" :size="13" /><MoneyTag v-else kind="fav" icon-only :size="13" />
          </button>
        </div>
        <div class="go"><ReasonButton :reason="buyReason" data-buy @go="buy">買下去</ReasonButton></div>
      </section>
      <section class="panel cut pad"><p class="h">誰去</p><p class="t-fine">自己去：{{ span }}。派名冊的人去踩點：{{ sv.locked.find(l => l.id === 'dispatch')?.block ?? '還沒有開放。' }}</p></section>
    </aside>
  </div>
</template>

<style scoped>
.unk { background: var(--bg-2); padding: var(--space-3); display: grid; gap: 2px; background-image: repeating-linear-gradient(135deg, transparent 0 6px, color-mix(in srgb, var(--ink) 5%, transparent) 6px 8px); }
.unk.open { background-image: none; }
.unk.net { box-shadow: inset 3px 0 0 var(--net); }
.unk .fm { font-style: normal; margin-left: 6px; padding: 0 5px; border-radius: 4px; background: var(--net); color: var(--bg); }
.unk.fresh { box-shadow: inset 0 0 0 2px var(--a); }
.unk small { color: var(--ink-3); font-size: var(--fs-fine); }
.kc { font-size: var(--fs-fine); font-weight: 800; color: var(--ink-3); }
.pips { display: flex; gap: 4px; flex-wrap: wrap; }
.pips i { width: 26px; height: 12px; background: var(--bg-2); }
.pips i.used { background: var(--a); }
.pips i.hard { box-shadow: inset 0 0 0 2px var(--warn); }
.track { display: flex; gap: var(--space-2); flex-wrap: wrap; }
.node { padding: var(--space-2) var(--space-3); background: var(--bg-2); font-size: var(--fs-xs); font-weight: 800; color: var(--ink-2); }
.node.key { box-shadow: inset 0 0 0 2px var(--ap); color: var(--ap); }
.roll { padding: var(--space-3); background: var(--bg-term); box-shadow: inset 3px 0 0 var(--a); font-size: var(--fs-xs); color: var(--ink-2); }
.buy { display: flex; gap: var(--space-3); align-items: center; margin-bottom: var(--space-3); }
.buy select { font: 800 var(--fs-sm) var(--font); background: var(--bg-term); color: var(--ink); border: 0; padding: 5px; max-width: 100%; }
.lrow .grow { display: grid; }
</style>
