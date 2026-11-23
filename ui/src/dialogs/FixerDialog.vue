<script setup lang="ts">
import { computed } from 'vue'
import { useRouter } from 'vue-router'
import Dialog from '../components/Dialog.vue'
import Hint from '../components/Hint.vue'
import ReasonButton from '../components/ReasonButton.vue'
import { useGame } from '../stores/game'
import { useUi } from '../stores/ui'
import TakePanel from '../components/commission/TakePanel.vue'
import { useEngine } from '../stores/engine'
import { gradeRoman } from '../lib/commissionView'
import { STEP_TEXT, STEPS } from '@engine/src/features/bills'
import { fmt } from '../lib/price'
import { favorRows, identityOf } from '../lib/peopleView'
import { failText } from '../lib/lifeView'

/**
 * 中間人的店（對話框，UI.md 第 13 節、FIXER 第 1、2、4、8 節）：走進中間人所在的設施打開。
 * 委託清單（點開是委託頁的接案）、進行中的委託（四拍走到哪）、人情（欠你的、你欠的；用掉一個）、這週的帳單預覽。
 * 對話框而不是全頁：它是一個設施的服務，看完就回到街區；接案之後才換成委託頁（全頁）。
 */
const props = defineProps<{ entryId: number; stacked?: boolean; fixerId?: string }>()
const g = useGame()
const ui = useUi()
const router = useRouter()
const e = useEngine()
// 設施寫的 fixerId 是引擎內容裡中間人的 id；沒寫（或查不到）用第一位
const fixerId = computed(() => (props.fixerId && e.fixer.entry(props.fixerId) ? props.fixerId : e.fixer.ids()[0] ?? ''))
const fixerEntry = computed(() => e.fixer.entry(fixerId.value))
// 中間人本人是引擎的 npc；店名取中間人的名字，身分是 npc 的職業
const fixerNpc = computed(() => (fixerEntry.value ? e.people.npc(fixerEntry.value.npc) : null))
const fixerSub = computed(() => [fixerNpc.value?.name ?? fixerEntry.value?.name ?? '', fixerNpc.value ? identityOf(fixerNpc.value) : ''].filter(Boolean).join('・'))
const jobs = computed(() => e.fixer.jobs())
/** 四拍走到哪（引擎的狀態：副本開著是副本，踩過點是踩點，其餘是召集前） */
const beatOf = (jobId: string): string => {
  const run = e.commission.view()
  const j = e.fixer.job(jobId)
  if (run && j && run.id === j.commission.id) return `副本・第 ${run.stage} 階段`
  return j && j.scouts > 0 ? `踩點 ${j.scouts} 次` : '接案了、還沒踩點'
}
// 人情是引擎的（favors）：欠你的可以用掉，你欠的在「關係」答應或回絕
const favors = computed(() => e.people.favors())
const owedToYou = computed(() => favorRows(favors.value, 'owed_to_pc', e.people.favorName))
const youOwe = computed(() => favorRows(favors.value, 'owed_by_pc', e.people.favorName))
// 這週的帳單：引擎的預覽（和真的結算同一個算法）
const bills = computed(() => e.bills.preview())
const stage = computed(() => bills.value.slope)
async function useFavor(id: string) {
  const why = failText(await e.people.favorUse(id), '現在用不了這個人情。')
  if (why) ui.toast(why, 'warn')
}
function open(jobId?: string) {
  ui.closeAll()
  router.push({ path: '/commission', query: jobId ? { job: jobId } : {} })
}
function accepted(jobId: string) { open(jobId) }
</script>

<template>
  <Dialog :entry-id="entryId" :stacked="stacked" title="中間人的店" :sub="fixerSub" size="xl">
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
        <section class="panel cut pad" data-favors>
          <p class="h">人情<Hint>欠你的（金色）與你欠的（橘色）。用掉一個是引擎的人情帳（不能用的寫原因）；你欠的在「關係」答應或回絕。</Hint></p>
          <div v-if="!owedToYou.length && !youOwe.length" class="empty-note">沒有人情往來。</div>
          <div v-for="o in owedToYou" :key="o.id" class="fav" :data-favor="o.id">
            <span class="grow"><b>{{ o.whoName }}</b><small>欠你・{{ o.size }}<template v-if="o.note">・{{ o.note }}</template></small></span>
            <ReasonButton sm :reason="e.people.favorUseBlock(o.id)" @go="useFavor(o.id)">用掉一個</ReasonButton>
          </div>
          <div v-for="o in youOwe" :key="o.id" class="fav mine" :data-owe="o.id">
            <span class="grow"><b>{{ o.whoName }}</b><small>你欠・{{ o.size }}<template v-if="o.note">・{{ o.note }}</template></small></span>
            <button type="button" class="btn sm" @click="ui.openRoot('relations')">去答覆</button>
          </div>
        </section>
        <section class="panel cut pad">
          <p class="h">這週的帳單</p>
          <div class="kv"><span>收租日</span><b>{{ g.billIn }} 天後</b></div>
          <div class="kv"><span>帳戶要付</span><b>{{ fmt(bills.money.cred.due) }}</b></div>
          <div class="kv"><span>現金要付</span><b>{{ fmt(bills.money.cash.due) }}</b></div>
          <div class="kv"><span>下坡路</span><b :class="{ 'warn-t': stage > 0 }">{{ stage > 0 ? STEP_TEXT[STEPS[stage - 1]!] : '沒事' }}</b></div>
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
.go.left { justify-content: flex-start; }
</style>
