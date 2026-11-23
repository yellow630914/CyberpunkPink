<script setup lang="ts">
import { computed, ref } from 'vue'
import { useRouter } from 'vue-router'
import Dialog from '../components/Dialog.vue'
import Hint from '../components/Hint.vue'
import MoneyTag from '../components/MoneyTag.vue'
import ReasonButton from '../components/ReasonButton.vue'
import { useGame } from '../stores/game'
import { useSettings } from '../stores/settings'
import { useUi } from '../stores/ui'
import TakePanel from '../components/commission/TakePanel.vue'
import { useEngine } from '../stores/engine'
import { gradeRoman } from '../lib/commissionView'
import { settleBills, billMultiplier, downhillStage, DOWNHILL } from '../lib/bills'
import { fmt } from '../lib/price'

/**
 * 中間人的店（對話框，UI.md 第 13 節、FIXER 第 1、2、4、8 節）：走進中間人所在的設施打開。
 * 委託清單（點開是委託頁的接案）、進行中的委託（四拍走到哪）、人情（欠你的、你欠的；用掉一個）、這週的帳單預覽。
 * 對話框而不是全頁：它是一個設施的服務，看完就回到街區；接案之後才換成委託頁（全頁）。
 */
const props = defineProps<{ entryId: number; stacked?: boolean; fixerId?: string }>()
const g = useGame()
const st = useSettings()
const ui = useUi()
const router = useRouter()
const e = useEngine()
// 設施寫的 fixerId 是引擎內容裡中間人的 id；沒寫（或查不到）用第一位
const fixerId = computed(() => (props.fixerId && e.fixer.entry(props.fixerId) ? props.fixerId : e.fixer.ids()[0] ?? ''))
const fixerEntry = computed(() => e.fixer.entry(fixerId.value))
const fixer = computed(() => g.npcs[fixerEntry.value?.npc ?? ''] ?? g.npcs.npc_monroe)
const jobs = computed(() => e.fixer.jobs())
/** 四拍走到哪（引擎的狀態：副本開著是副本，踩過點是踩點，其餘是召集前） */
const beatOf = (jobId: string): string => {
  const run = e.commission.view()
  const j = e.fixer.job(jobId)
  if (run && j && run.id === j.commission.id) return `副本・第 ${run.stage} 階段`
  return j && j.scouts > 0 ? `踩點 ${j.scouts} 次` : '接案了、還沒踩點'
}
const owes = computed(() => Object.values(g.npcs).filter(n => n.favor).map(n => ({ id: n.id, name: n.name, favor: n.favor!, why: n.relation })))
const bills = computed(() => settleBills(g.bills.items, [], { acc: g.money.acc, cash: g.money.cash }, billMultiplier(st.s.billRule, st.s.billMult)))
const stage = computed(() => downhillStage(bills.value.owing, g.bills.overdueWeeks, st.s.billRule))
const useMenu = ref<string | null>(null)
const FAVOR_USES = ['請一位行者幫一次忙（不付出場費）', '委託的分帳換一份不抽成', '踩點時直接揭開一項', '戰敗時把戰敗事件換成比較輕的']
function useFavor(id: string, what: string) {
  const n = g.npcs[id]
  if (!n || !n.favor || n.favor <= 0) return
  n.favor--
  g.addLog({ prose: [`你向${n.name}討了一個人情：${what}。`] })
  ui.toast(`用掉${n.name}的一個人情。`)
  useMenu.value = null
}
function open(jobId?: string) {
  ui.closeAll()
  router.push({ path: '/commission', query: jobId ? { job: jobId } : {} })
}
function accepted(jobId: string) { open(jobId) }
</script>

<template>
  <Dialog :entry-id="entryId" :stacked="stacked" title="中間人的店" :sub="`${fixer.name}・${fixer.identity}`" size="xl">
    <template #header><Hint title="中間人">中間人賣的是信任：保證雇主付錢、保證做事的人不亂說。每個中間人有自己的地盤、門路、後台與脾氣。信譽越高，肯見你的中間人越多；信譽不夠的委託變淡並寫門檻。</Hint></template>
    <div class="fx">
      <TakePanel v-if="fixerId" :fixer-id="fixerId" @accepted="accepted" @leave="ui.closeAll()" />
      <div class="fx2">
        <section class="panel cut pad stack" data-jobs>
          <p class="h">進行中的委託</p>
          <div v-if="!jobs.length" class="empty-note">手上沒有進行中的委託。</div>
          <button v-for="j in jobs" :key="j.id" type="button" class="lrow" :data-job="j.id" @click="open(j.id)">
            <span class="grow"><b>{{ j.title }}</b><small>{{ gradeRoman(Number(j.commission.grade ?? 1)) }}・走到「{{ beatOf(j.id) }}」・踩點 {{ j.scouts }}／{{ j.commission.stages.length }}</small></span>
            <span class="tag hot">打開</span>
          </button>
        </section>
        <section class="panel cut pad">
          <p class="h">人情<Hint>欠你的（金色）與你欠的（橘色）。勢力的人情寫明要找誰兌。用掉一個人情開一個選單。</Hint></p>
          <div v-if="!owes.length" class="empty-note">沒有人情往來。</div>
          <div v-for="o in owes" :key="o.id" class="fav" :class="{ mine: o.favor < 0 }">
            <span class="grow"><b>{{ o.name }}</b><small>{{ o.favor > 0 ? `欠你 ${o.favor}` : `你欠 ${-o.favor}` }}・{{ o.why }}</small></span>
            <ReasonButton v-if="o.favor > 0" sm :reason="null" @go="useMenu = useMenu === o.id ? null : o.id">用掉一個</ReasonButton>
            <div v-if="useMenu === o.id" class="menu"><button v-for="w in FAVOR_USES" :key="w" type="button" class="lrow" @click="useFavor(o.id, w)">{{ w }}</button></div>
          </div>
          <div class="kv"><span>手上的人情（小）</span><b><MoneyTag kind="fav" :amount="g.money.fav" :size="12" /></b></div>
        </section>
        <section class="panel cut pad">
          <p class="h">這週的帳單</p>
          <div class="kv"><span>收租日</span><b>{{ g.billIn }} 天後</b></div>
          <div class="kv"><span>帳戶要付</span><b>{{ fmt(bills.dueAcc) }}</b></div>
          <div class="kv"><span>現金要付</span><b>{{ fmt(bills.dueCash) }}</b></div>
          <div class="kv"><span>下坡路</span><b :class="{ 'warn-t': stage > 0 }">{{ stage > 0 ? DOWNHILL[stage - 1] : '沒事' }}</b></div>
          <div class="go left"><button type="button" class="btn sm" @click="ui.open('bills')">看帳單</button></div>
        </section>
      </div>
    </div>
  </Dialog>
</template>

<style scoped>
.fx { display: grid; gap: var(--space-4); }
.fx2 { display: grid; grid-template-columns: repeat(auto-fit, minmax(min(100%, 280px), 1fr)); gap: var(--space-4); align-items: start; }
.fav .grow, .lrow .grow { display: grid; }
.fav { display: flex; flex-wrap: wrap; align-items: center; gap: var(--space-3); padding: var(--space-2) var(--space-3); margin-bottom: var(--space-2); background: var(--bg-2); box-shadow: inset 3px 0 0 var(--money-fav); }
.fav.mine { box-shadow: inset 3px 0 0 var(--warn); }
.fav small { color: var(--ink-3); font-size: var(--fs-fine); }
.menu { flex-basis: 100%; display: grid; gap: var(--space-1); }
.go.left { justify-content: flex-start; }
</style>
