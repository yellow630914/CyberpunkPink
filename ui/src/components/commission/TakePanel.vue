<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import type { PayKind } from '@engine/src/features/fixer'
import Hint from '../Hint.vue'
import MoneyTag from '../MoneyTag.vue'
import ReasonButton from '../ReasonButton.vue'
import { useEngine } from '../../stores/engine'
import { useUi } from '../../stores/ui'
import { FACE_CLASS, FACE_ICON, gradeRoman, repGainText, scaleName } from '../../lib/commissionView'
import type { FaceId } from '../../lib/commissionView'

/**
 * 接案（UI 7.1、第 13 節）：中間人今天的委託、簡報、那一輪交涉、怎麼付、接案。中間人的店（FixerDialog）與委託頁的第一拍共用。
 * 全部是引擎的 fixer.board：簡報（沒踩到的階段是問號）、三種付法到手的數字與代價、接不了與談不了的原因；這裡只畫，呼叫 haggle 與 accept。
 */
const props = defineProps<{ fixerId: string }>()
const emit = defineEmits<{ (e: 'accepted', jobId: string): void; (e: 'leave'): void }>()
const e = useEngine()
const ui = useUi()

const board = computed(() => e.fixer.board(props.fixerId))
const entry = computed(() => e.fixer.entry(props.fixerId))
const sel = ref<string | null>(null)
const row = computed(() => board.value.offers.find(o => o.id === sel.value) ?? board.value.offers[0] ?? null)
watch(() => props.fixerId, () => { sel.value = null })
const pay = ref<PayKind | ''>('')
const payNow = computed(() => row.value?.pay.find(p => p.id === pay.value) ?? row.value?.pay.find(p => p.block === null) ?? null)
const note = ref<string[]>([])
const working = ref(false)

const placeName = (id: string | null | undefined): string => (id ? e.contentName('district', id) ?? id : '？')
const jobsHere = computed(() => e.fixer.jobs().length)
const lastResults = (): string[] => e.state.reports.at(-1)?.narration?.results ?? []

async function haggle() {
  if (!row.value || working.value) return
  working.value = true
  const r = await e.fixer.haggle({ id: row.value.id, fixer: props.fixerId })
  working.value = false
  if (r.status === 'refused') { ui.toast(r.reason ?? '現在談不了。', 'warn'); return }
  note.value = lastResults()
}
async function accept() {
  if (!row.value || !payNow.value || working.value) return
  working.value = true
  const id = row.value.id
  const r = await e.fixer.accept({ id, fixer: props.fixerId }, payNow.value.id)
  working.value = false
  if (r.status === 'refused') { ui.toast(r.reason ?? '接不了這件委託。', 'warn'); return }
  note.value = []
  emit('accepted', id)
}
const acceptReason = computed(() => row.value?.block ?? payNow.value?.block ?? null)
</script>

<template>
  <div class="take cols3" data-take>
    <section class="panel cut pad">
      <p class="h">{{ board.name }}手上的案子<Hint>信譽不夠的卡變淡並寫門檻。點卡看簡報。中間人每天給的案子不一樣。</Hint></p>
      <div v-if="!board.open" class="empty-note" data-closed>{{ board.reason }}</div>
      <div v-else-if="!board.offers.length" class="empty-note">今天沒有可以接的案子。</div>
      <div class="row-list">
        <button v-for="o in board.offers" :key="o.id" type="button" class="lrow offer" :class="{ on: row?.id === o.id, 'is-unavailable': !!o.block }" :aria-disabled="!!o.block || undefined" :data-offer="o.id" @click="o.block ? ui.toast(o.block, 'warn') : (sel = o.id)">
          <span class="fc" :class="o.brief.main ? FACE_CLASS[o.brief.main as FaceId] : 'x'">{{ o.brief.main ? FACE_ICON[o.brief.main as FaceId] : '？' }}</span>
          <span class="grow"><b>{{ o.offer.title }}</b><small>{{ gradeRoman(o.brief.grade) }}・{{ scaleName(o.brief.scale) }}・{{ o.brief.stages }} 階段<template v-if="o.brief.conditions.length">・{{ o.brief.conditions.join('、') }}</template></small><small v-if="o.brief.extra_label" data-extra-card>另外：{{ o.brief.extra_label }}</small><small v-if="o.block" class="warn-t">{{ o.block }}</small></span>
          <MoneyTag kind="cash" :amount="o.offer.reward" :size="13" />
        </button>
      </div>
    </section>

    <section class="panel cut pad stack">
      <template v-if="row">
        <p class="h">簡報</p>
        <div class="grid2" style="--col-min: 180px">
          <div class="kv"><span>目標</span><b>{{ row.brief.target_name ?? '沒有特定的勢力' }}</b></div>
          <div class="kv"><span>地點</span><b>{{ placeName(row.brief.district) }}</b></div>
          <div class="kv"><span>主面</span><b>{{ row.brief.main_name ?? '？' }}</b></div>
          <div class="kv"><span>條件</span><b class="warn-t">{{ row.brief.conditions.length ? row.brief.conditions.join('、') : '沒有附帶條件' }}</b></div>
        </div>
        <blockquote class="says">「{{ row.brief.brief }}」<small v-if="row.brief.main_text"> {{ row.brief.main_text }}</small></blockquote>
        <div v-if="row.net" class="netnote" data-net-note>
          <b>這是一件要潛進去的委託</b>
          <span>{{ row.net.text }}</span>
          <span v-if="row.net.deck_warn" class="warn-t" data-deck-warn>{{ row.net.deck_warn }}</span>
        </div>
        <p class="h">後面的階段（要踩點才知道）</p>
        <div class="track">
          <span v-for="s in row.brief.rows" :key="s.n" class="node" :class="{ key: s.last }" :data-stage-row="s.n">
            <template v-if="s.last">★ </template>第 {{ s.n }} 階段
            <template v-if="s.known && s.faces">：{{ s.faces.map(f => FACE_ICON[f as FaceId] ?? f).join(' ') }}</template><template v-else>：？</template>
          </span>
        </div>
        <p class="h">談判<Hint title="談判">接案前可以再談一輪（交涉）：談成了報酬多一點，大失敗她今天不再給你這一件。每件委託一次。</Hint></p>
        <div class="kv"><span>報酬（她抽成 {{ Math.round((entry?.cut ?? 0) * 100) }}%）</span><b><MoneyTag kind="cash" :amount="row.offer.reward" :size="14" /></b></div>
        <div v-if="row.brief.extra_label" class="kv" data-extra><span>另外多一樣<Hint title="報酬的另一樣東西">這件委託除了現金，還給一樣東西；現金已經是引擎算過的（報酬欄寫的就是談出來的數字），交涉與三種付法都算在這個數字上。東西在做完、結算的時候給。</Hint></span><b>{{ row.brief.extra_label }}</b></div>
        <p v-if="row.haggled" class="t-fine" data-haggled>這件委託已經談過一輪了。</p>
        <p v-if="note.length" class="roll" data-note>{{ note.join(' ') }}</p>
        <p class="h">怎麼付<Hint>三種付法各自到手多少、代價是什麼，都是引擎算的。</Hint></p>
        <div class="grid2" style="--col-min: 190px">
          <button v-for="p in row.pay" :key="p.id" type="button" class="lrow pay" :class="{ on: payNow?.id === p.id, 'is-unavailable': !!p.block }" :aria-disabled="!!p.block || undefined" :data-pay="p.id" @click="p.block ? ui.toast(p.block, 'warn') : (pay = p.id)">
            <span class="grow"><b>{{ p.name }}</b><small>{{ p.cost }}</small><small v-if="p.block" class="warn-t">{{ p.block }}</small></span>
            <b class="mono" data-pay-amount><MoneyTag :kind="p.wallet === 'cred' ? 'acc' : 'cash'" :amount="p.amount" :size="13" /><template v-if="p.favor"> ＋<MoneyTag kind="fav" icon-only :size="13" /></template></b>
          </button>
        </div>
        <p class="t-fine" data-rep-gain>完成這件：{{ repGainText(e.fixer.repGain(row.offer.commission)) }}</p>
        <div class="go">
          <button type="button" class="btn" @click="emit('leave')">不接</button>
          <ReasonButton :reason="row.haggle_block" data-haggle @go="haggle">再談一輪（交涉）</ReasonButton>
          <ReasonButton pri :reason="acceptReason" data-accept @go="accept">接案</ReasonButton>
        </div>
      </template>
      <div v-else class="empty-note">{{ board.open ? '左邊沒有可以看的簡報。' : '她不肯見你。' }}</div>
    </section>

    <aside class="stack">
      <section class="panel cut pad">
        <p class="h">中間人</p>
        <b>{{ board.name }}</b><div class="t-fine">{{ e.contentName('npc', entry?.npc ?? '') ?? '' }}・{{ placeName(entry?.district) }}</div>
        <div class="kv"><span>街頭信譽</span><b data-rep>{{ board.rep }}</b></div>
        <div class="kv"><span>你手上進行中的</span><b>{{ jobsHere }} 件</b></div>
      </section>
      <section class="panel cut pad" v-if="row">
        <p class="h">這件事對你的帳</p>
        <div class="kv"><span>會惹到的勢力</span><b>{{ row.brief.target_name ?? '沒有' }}</b></div>
        <div class="kv"><span>選的付法到手</span><b v-if="payNow"><MoneyTag :kind="payNow.wallet === 'cred' ? 'acc' : 'cash'" :amount="payNow.amount" :size="13" /></b><b v-else>—</b></div>
        <p v-if="payNow?.hostility" class="t-fine warn-t">{{ payNow.cost }}</p>
      </section>
    </aside>
  </div>
</template>

<style scoped>
.offer .grow, .pay .grow { display: grid; }
.pay small { white-space: normal; }
.fc { width: 28px; height: 28px; display: grid; place-items: center; font-weight: 900; font-size: var(--fs-sm); border-radius: 6px; flex: none; background: var(--bg-3); color: var(--ink); box-shadow: inset 0 0 0 2px var(--ap); }
.fc.m { background: var(--ink-2); color: var(--bg); } .fc.n { background: var(--net); color: var(--bg); } .fc.o { background: var(--ep); color: var(--bg); }
.says { margin: 0; padding: var(--space-3) var(--space-4); background: var(--bg-term); box-shadow: inset 3px 0 0 var(--a); font-size: var(--fs-sm); color: var(--ink-2); }
.says small { color: var(--ink-3); }
.track { display: flex; gap: var(--space-2); flex-wrap: wrap; }
.node { padding: var(--space-2) var(--space-3); background: var(--bg-2); font-size: var(--fs-xs); font-weight: 800; color: var(--ink-2); }
.node.key { box-shadow: inset 0 0 0 2px var(--ap); color: var(--ap); }
.netnote { display: grid; gap: 2px; padding: var(--space-3); background: var(--bg-term); box-shadow: inset 3px 0 0 var(--net); font-size: var(--fs-xs); color: var(--ink-2); }
.roll { padding: var(--space-3); background: var(--bg-term); box-shadow: inset 3px 0 0 var(--a); font-size: var(--fs-xs); color: var(--ink-2); }
</style>
