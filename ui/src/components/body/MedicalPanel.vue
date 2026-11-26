<script setup lang="ts">
import { computed, ref } from 'vue'
import { toMinutes } from '@engine/src'
import { WOUND_NAME } from '@engine/src/features/medical'
import Hint from '../Hint.vue'
import HpBar from './HpBar.vue'
import QuoteCard from './QuoteCard.vue'
import type { QuoteRow } from './QuoteCard.vue'
import { useEngine } from '../../stores/engine'
import { useUi } from '../../stores/ui'
import { spanText, chanceText, signed } from '../../lib/bodyView'

/**
 * 治療（DOWNTIME；ITEMS 4.3 節）：隊上每個人的生命值、急救（選誰來做、對誰）、診所治療、重創的清單與手術。clinic 為 true 時列診所治療與重創的手術（要站在診所才做得了；
 * 做不了的原因是引擎的）。每一項先寫引擎的報價，再按確認才送。元件不算 DC、費用，也不判斷做不做得到。
 */
const props = defineProps<{ clinic?: boolean }>()
const eng = useEngine()
const ui = useUi()
const by = ref<string | null>(null)
const view = computed(() => eng.body.medical(by.value ?? undefined))
const now = computed(() => toMinutes(eng.state.time))
const members = computed(() => view.value?.members ?? [])
const doers = computed(() => members.value.map((m) => ({ id: m.id, name: m.name })))
const open = ref<string | null>(null)
const woundName = (p: string): string => (WOUND_NAME as Record<string, string>)[p] ?? p
function done(why: string | null, ok: string) {
  if (why) ui.toast(why, 'warn')
  else ui.toast(ok)
}
function aid(m: { id: string; aid: { by: string } }) { done(eng.body.aid(m.aid.by, m.id), '急救做完了。') }
function heal(id: string) { done(eng.body.heal(id), '治療做完了。') }
function wound(target: string, part: 'limb' | 'head' | 'torso', via: 'clinic' | 'self', doer: string) { done(eng.body.woundSurgery({ target, part, via, ...(via === 'self' ? { by: doer } : {}) }), '手術做完了。') }
function aidRows(q: NonNullable<NonNullable<typeof members.value[number]>['aid']['quote']>): QuoteRow[] {
  return [
    { label: '對 DC', value: `${q.dc}${chanceText(q)}` },
    { label: '加值', value: signed(q.bonus), note: q.parts.map((p) => `${p.label} ${signed(p.value)}`).join('、') },
    { label: '花的時間', value: spanText(q.minutes) },
    ...(q.kit ? [{ label: '用掉', value: '一份醫療包' }] : []),
  ]
}
</script>

<template>
  <section class="panel cut pad medical" data-medical-panel>
    <p class="h">治療與傷勢<Hint title="急救與診所">急救在任何地方都能做（成功率看動手的人，醫療包有加成）。診所治療與重創的手術要站在診所上；重創要動手術才會好。</Hint></p>
    <div class="who">
      <span class="k">誰來做急救</span>
      <div class="segs"><button v-for="d in doers" :key="d.id" type="button" :class="{ on: (by ?? view?.members[0]?.aid.by) === d.id }" :data-by="d.id" @click="by = d.id">{{ d.name }}</button></div>
    </div>
    <p v-if="clinic" class="k" data-clinic-here>{{ view?.clinic ? `診所：${view.clinic.name}` : '現在不在診所。' }}</p>
    <article v-for="m in members" :key="m.id" class="mem" :data-member="m.id">
      <header>
        <b>{{ m.name }}</b>
        <HpBar :hp="m.hp" :max="m.max_hp" :blur="eng.body.painBlind(m.id)" />
        <span v-if="m.aided" class="tag">已急救</span><span v-if="m.treated" class="tag">處理過</span>
        <span v-if="m.recovering_until !== null" class="tag warn" data-recovering>手術休養中，還有 {{ spanText(m.recovering_until - now) }}</span>
      </header>
      <div class="acts">
        <button type="button" class="btn sm" :class="{ on: open === m.id + ':aid' }" data-open="aid" @click="open = open === m.id + ':aid' ? null : m.id + ':aid'">急救</button>
        <button v-if="clinic" type="button" class="btn sm" :class="{ on: open === m.id + ':heal' }" data-open="heal" @click="open = open === m.id + ':heal' ? null : m.id + ':heal'">診所治療</button>
      </div>
      <QuoteCard v-if="open === m.id + ':aid' && m.aid.quote" title="急救" :rows="aidRows(m.aid.quote)" :reason="m.aid.block" action="動手急救" @go="aid(m)" />
      <QuoteCard v-else-if="open === m.id + ':aid'" title="急救" :rows="[]" :reason="m.aid.block" action="動手急救" @go="aid(m)" />
      <QuoteCard
        v-if="clinic && open === m.id + ':heal'" title="診所治療" :reason="m.heal.block" action="治療"
        :rows="m.heal.quote ? [{ label: '每點生命值', value: String(m.heal.quote.price) }, { label: '缺', value: `${m.heal.quote.missing} 點` }, { label: '這一次治', value: `${m.heal.quote.points} 點${m.heal.quote.full ? '' : '（錢只夠這些）'}` }, { label: '費用', value: String(m.heal.quote.cost) }, { label: '花的時間', value: spanText(m.heal.quote.minutes) }] : []"
        @go="heal(m.id)"
      />
      <div v-if="m.wounds.length" class="wounds" data-wounds>
        <p class="k">重創</p>
        <div v-for="w in m.wounds" :key="w.part" class="wound" :data-wound="w.part">
          <b>{{ woundName(w.part) }}重創</b>
          <template v-if="clinic">
            <QuoteCard
              v-for="o in w.options" :key="o.via" :title="o.via === 'clinic' ? '診所動手術' : '自己動手術'" :reason="o.block" action="動手術"
              :rows="o.quote ? [{ label: '手術費', value: o.quote.fee > 0 ? String(o.quote.fee) : '不收錢' }, { label: '花的時間', value: spanText(o.quote.minutes) }, { label: '休養', value: spanText(o.quote.recovery_minutes) }] : []"
              @go="wound(m.id, w.part, o.via, view?.members[0]?.aid.by ?? m.id)"
            />
          </template>
          <small v-else class="k">要在診所動手術。</small>
        </div>
      </div>
    </article>
    <p v-if="!members.length" class="empty-note">還沒有主角。</p>
  </section>
</template>

<style scoped>
.medical { display: grid; gap: var(--space-3); align-content: start; }
.who { display: flex; gap: var(--space-3); align-items: center; flex-wrap: wrap; }
.mem { background: var(--bg-2); padding: var(--space-3); display: grid; gap: var(--space-3); }
.mem header { display: flex; gap: var(--space-3); align-items: center; flex-wrap: wrap; }
.acts { display: flex; gap: var(--space-2); flex-wrap: wrap; }
.acts .btn.on { box-shadow: inset 0 0 0 2px var(--a); }
.wounds { display: grid; gap: var(--space-2); }
.wound { display: grid; gap: var(--space-2); }
</style>
