<script setup lang="ts">
import { computed } from 'vue'
import Dialog from '../components/Dialog.vue'
import Hint from '../components/Hint.vue'
import MoneyTag from '../components/MoneyTag.vue'
import ReasonButton from '../components/ReasonButton.vue'
import { useEngine } from '../stores/engine'
import { useUi } from '../stores/ui'
import { fmt } from '../lib/price'
import { POOL_NAME, billRows, failText, moneyKind, settledRows, slopeCells, timeText, type BillRow, type Pool } from '../lib/lifeView'

/**
 * 每週帳單（UI.md 3.10 節、DOWNTIME 第 5 節）：下一次要付的每一項、帳戶與現金夠不夠、會停在哪一項、下坡路現在在哪一格。
 * 全部是引擎的 billPreview（和真的結算用同一個算法）；每一項可以改成用現金付、或這一項不付了，送引擎的 bill.set。
 * 引擎出了 bill.settle（跨過週一）時 App.vue 把這個視窗打開，並顯示那一份報告的每一項。
 */
defineProps<{ entryId: number; stacked?: boolean; settled?: boolean }>()
const e = useEngine()
const ui = useUi()

const p = computed(() => e.bills.preview())
const rows = computed(() => billRows(p.value))
const slope = computed(() => slopeCells(p.value))
const lock = computed(() => e.bills.lock())
const last = computed(() => e.bills.lastSettle())
const lastRows = computed(() => settledRows(last.value))
const POOLS: Pool[] = ['cred', 'cash']

async function set(row: BillRow, patch: { cash?: boolean; stopped?: boolean }) {
  const r = await e.bills.set(row.id, patch)
  const why = failText(r, '現在改不了。')
  if (why) ui.toast(why, 'warn')
}
const stateText = (r: BillRow): string => ({ paid: '付得起', short: `${POOL_NAME[r.pool]}不夠`, after: '停在前面', skipped: '你停掉了', grace: '寬限中' })[r.state]
</script>

<template>
  <Dialog :entry-id="entryId" :stacked="stacked" title="每週帳單" :sub="`下一次結算：${timeText(p.at)}（第 ${p.week} 週）`" size="xl">
    <template #header>
      <span v-if="p.mult !== 1" class="tag" :class="{ warn: p.mult > 1 }">倍率 ×{{ p.mult }}</span>
      <span v-if="p.deferred" class="tag warn">有一週先記著</span>
      <Hint title="每週帳單">每週一 06:00 結算：收入先入帳，再照順序扣款；哪一種錢不夠就停在那一項，那一種錢後面的都算沒付。人在委託副本裡跨過週一，先記著，出來之後再結。</Hint>
    </template>
    <div v-if="lock" class="blocking" data-lock>{{ lock }}</div>
    <div v-if="p.mult === 0" class="blocking">帳單倍率是 ×0：這一週不結算，收入照樣入帳。</div>
    <div v-else-if="p.stopsAt" class="blocking" data-stops>會停在「{{ rows.dues.find((r) => r.id === p.stopsAt)?.name ?? p.stopsAt }}」：之後的項目這一週都付不成。</div>
    <section v-if="lastRows.length" class="panel cut pad last" data-last>
      <p class="h">{{ settled ? '剛結算的一週' : '上一次結算' }}<Hint>引擎記下的：每一項付了多少、沒付成的欠了多少。</Hint></p>
      <div v-for="r in lastRows" :key="r.id" class="bill sm" :class="{ short: r.unpaid > 0, skipped: r.skipped, inc: r.kind === 'income' }" :data-settled="r.id">
        <span class="grow"><b>{{ r.name }}</b></span>
        <span class="mono">{{ r.skipped ? '停掉' : r.kind === 'income' ? `+${fmt(r.paid)}` : `付 ${fmt(r.paid)}` }}</span>
        <b v-if="r.unpaid > 0" class="warn-t">欠 {{ fmt(r.unpaid) }}</b>
      </div>
    </section>
    <div class="bl">
      <section class="panel cut pad">
        <p class="h">支出・照結算的順序</p>
        <div v-if="!rows.dues.length" class="empty-note">這一週沒有要付的項目。</div>
        <div v-for="r in rows.dues" :key="r.id" class="bill" :class="r.state" :data-bill="r.id" :data-state="r.state">
          <span class="ord mono">{{ r.order }}</span>
          <span class="grow"><b>{{ r.name }}</b></span>
          <span class="from">
            <button type="button" class="tagbtn" :class="{ 'is-unavailable': !r.cashOk }" :aria-pressed="r.pool === 'cash'" :title="r.cashOk ? '按一下換成另一種錢付' : '這一項不收現金'" :data-cash="r.id" @click="r.cashOk ? set(r, { cash: r.pool !== 'cash' }) : ui.toast('這一項不收現金，只能用原本的錢付。', 'warn')">
              <MoneyTag :kind="moneyKind(r.pool)" icon-only :size="14" />{{ POOL_NAME[r.pool] }}
            </button>
          </span>
          <span class="amt mono">{{ r.state === 'skipped' || r.state === 'grace' ? '不付' : fmt(r.amount) }}</span>
          <span class="st"><template v-if="r.state === 'paid'">✓</template><b v-else-if="r.state === 'short'" class="warn-t">{{ stateText(r) }}（欠 {{ fmt(r.unpaid) }}）</b><span v-else class="warn-t">{{ stateText(r) }}</span></span>
          <ReasonButton sm :reason="lock" class="skip" :data-stop="r.id" @go="set(r, { stopped: r.state !== 'skipped' })">{{ r.state === 'skipped' ? '要付' : '這一項不付了' }}</ReasonButton>
        </div>
        <p class="h mt">收入・先入帳</p>
        <div v-if="!rows.incomes.length" class="empty-note">這一週沒有收入。</div>
        <div v-for="r in rows.incomes" :key="r.id" class="bill inc"><span class="ord mono">＋</span><span class="grow"><b>{{ r.name }}</b></span><MoneyTag :kind="moneyKind(r.pool)" :amount="r.amount" /></div>
      </section>
      <aside class="stack">
        <section class="panel cut pad" data-totals>
          <p class="h">合計</p>
          <template v-for="pool in POOLS" :key="pool">
            <div class="kv"><span>{{ POOL_NAME[pool] }}現有</span><b><MoneyTag :kind="moneyKind(pool)" :amount="p.money[pool].have" /></b></div>
            <div v-if="p.money[pool].income > 0" class="kv"><span>這一週收入</span><b><MoneyTag :kind="moneyKind(pool)" :amount="p.money[pool].income" /></b></div>
            <div class="kv"><span>{{ POOL_NAME[pool] }}要付</span><b><MoneyTag :kind="moneyKind(pool)" :amount="p.money[pool].due" /></b></div>
            <div class="kv"><span>差多少</span><b :class="{ 'warn-t': p.money[pool].short > 0 }">{{ p.money[pool].short > 0 ? fmt(p.money[pool].short) : '不差' }}</b></div>
          </template>
          <div class="kv"><span>欠繳</span><b>{{ p.overdue }} 週</b></div>
        </section>
        <section class="panel cut pad">
          <p class="h">下坡路<Hint>欠繳一週：訂閱件全部鎖住。兩週：討債人上門。三週：債權賣給債主。四週起：要求簽契約。付清了就回到第一格以前。</Hint></p>
          <div class="down">
            <div v-for="c in slope" :key="c.id" class="step" :class="{ now: c.now, next: c.next }" :data-slope="c.n"><span class="mono">{{ c.n }}</span>{{ c.text }}<b v-if="c.now" class="tag warn">現在</b><b v-else-if="c.next" class="tag">付不清會到這裡</b></div>
          </div>
          <div class="empty-note">{{ p.slopeIfShort ? `照現在的錢，這週付不清會走到第 ${p.slopeIfShort} 步。` : '照現在的錢，這週付得清。' }}</div>
        </section>
        <section class="panel cut pad">
          <p class="h">補上差額</p>
          <div class="go left"><ReasonButton sm reason="還沒有開放。">去洗錢</ReasonButton><button type="button" class="btn sm" @click="ui.open('bag')">賣東西</button></div>
          <div class="empty-note">賣東西照收購價，到商店去賣。洗錢還沒有開放。</div>
        </section>
      </aside>
    </div>
  </Dialog>
</template>

<style scoped>
.bl { display: grid; grid-template-columns: minmax(0, 1fr) 320px; gap: 12px; align-items: start; margin-top: 10px; }
.last { margin-top: 10px; }
.bill { display: grid; grid-template-columns: 22px minmax(0, 1fr) auto 70px minmax(64px, auto) auto; gap: 8px; align-items: center; padding: 8px 10px; background: var(--bg-2); margin-bottom: 4px; font-size: var(--fs-sm); }
.bill.inc { grid-template-columns: 22px minmax(0, 1fr) auto; }
.bill.sm { grid-template-columns: minmax(0, 1fr) auto auto; }
.bill.short { box-shadow: inset 3px 0 0 var(--danger); }
.bill.after { opacity: .65; filter: grayscale(.6); }
.bill.skipped, .bill.grace { opacity: .55; }
.ord { color: var(--ink-3); font-size: var(--fs-fine); }
.amt { text-align: right; font-weight: 800; }
.st { font-size: var(--fs-sm); text-align: center; }
.warn-t { color: var(--warn); }
.grow { min-width: 0; }
.tagbtn { display: inline-flex; align-items: center; gap: 4px; background: var(--bg-term); border: 0; padding: 3px 7px; color: var(--ink-2); font-size: var(--fs-fine); font-weight: 800; cursor: pointer; }
.go.left { justify-content: flex-start; flex-wrap: wrap; }
.mt { margin-top: 14px; }
.down { display: grid; gap: 4px; margin-bottom: 8px; }
.step { padding: 6px 10px; background: var(--bg-2); font-size: var(--fs-sm); display: flex; gap: 8px; align-items: center; flex-wrap: wrap; }
.step.now { box-shadow: inset 0 0 0 2px var(--danger); }
.step.next { box-shadow: inset 0 0 0 2px var(--warn); }
.step .mono { color: var(--ink-3); }
@media (max-width: 1000px) { .bl { grid-template-columns: 1fr; } }
@media (max-width: 720px) {
  .bill { grid-template-columns: 22px minmax(0, 1fr) auto; }
  .bill .from { grid-column: 2 / 3; justify-self: start; }
  .bill .st { grid-column: 2 / -1; text-align: left; }
  .bill .skip { grid-column: 2 / 3; justify-self: start; }
}
</style>
