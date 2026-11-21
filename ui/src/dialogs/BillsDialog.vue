<script setup lang="ts">
import { computed } from 'vue'
import Dialog from '../components/Dialog.vue'
import Hint from '../components/Hint.vue'
import MoneyTag from '../components/MoneyTag.vue'
import ReasonButton from '../components/ReasonButton.vue'
import { useGame } from '../stores/game'
import { useSettings } from '../stores/settings'
import { useUi } from '../stores/ui'
import { INCOMES, LAUNDER } from '../data/weekly'
import { settleBills, billMultiplier, downhillStage, launderNeeded, DOWNHILL, PRESET_PACE, type BillItem } from '../lib/bills'
import { fmt } from '../lib/price'
import { useGuides } from '../lib/useGuides'

/**
 * 每週帳單（UI 3.10 節，規則 FIXER 第 4 節、DOWNTIME 第 5 節）。週一收租日跳出來（擋住行動），之後從待處理或錢包再打開。
 * 這裡是下週一的預覽：照存檔規則的帳單倍率，帳戶與現金照現在的算。
 */
defineProps<{ entryId: number; stacked?: boolean }>()
const g = useGame()
const st = useSettings()
const ui = useUi()
useGuides().trigger('g_bill')
const mult = computed(() => billMultiplier(st.s.billRule, st.s.billMult))
const res = computed(() => settleBills(g.bills.items, INCOMES, { acc: g.money.acc, cash: g.money.cash }, mult.value))
const stage = computed(() => downhillStage(res.value.owing, g.bills.overdueWeeks, st.s.billRule))
const week = computed(() => Math.floor(g.day / 7) + 1)
const need = computed(() => res.value.firstShort ? launderNeeded(res.value.firstShort.amount - (res.value.firstShort.from === '帳戶' ? res.value.accAfter : res.value.cashAfter), LAUNDER.rate) : 0)
function toggleSkip(it: BillItem) { it.skipped = !it.skipped }
function toggleCash(it: BillItem) {
  if (!it.cashOk) { ui.toast('這一項只收帳戶。', 'warn'); return }
  it.from = it.from === '帳戶' ? '現金' : '帳戶'
}
const preset = computed(() => st.s.billRule)
</script>

<template>
  <Dialog :entry-id="entryId" :stacked="stacked" title="每週帳單" :sub="`第 ${week} 週・下週一 06:00 結算・存檔規則：${preset}（×${mult}）`" size="lg">
    <template #header><Hint title="每週帳單">收入先入帳，再照順序扣款；錢不夠就停在那一項，後面的都不付。每一項可以事先設「用現金付」（收現金的才行）或「這一項不付了」（主動停掉的不算欠款）。帳單倍率在設定的「遊戲」分頁改，和難度無關。</Hint></template>
    <div v-if="mult === 0" class="blocking">帳單倍率是 ×0：這一週不結算，收入照樣入帳。</div>
    <div v-else-if="res.firstShort" class="blocking">{{ res.firstShort.from }}不夠：停在「{{ res.firstShort.name }}」，還差 {{ fmt(res.firstShort.amount - (res.firstShort.from === '帳戶' ? res.accAfter : res.cashAfter)) }}。</div>
    <div class="bl">
      <section class="panel cut pad">
        <p class="h">支出・照結算的順序</p>
        <div v-for="l in res.lines" :key="l.id" class="bill" :class="[l.state]">
          <span class="ord mono">{{ l.order }}</span>
          <span class="grow"><b>{{ l.name }}</b><small>{{ l.note }}</small></span>
          <span class="from"><button type="button" class="tagbtn" :aria-pressed="l.from === '現金'" @click="toggleCash(g.bills.items.find(x => x.id === l.id)!)"><MoneyTag :kind="l.from === '帳戶' ? 'acc' : 'cash'" icon-only :size="14" />{{ l.from }}</button></span>
          <span class="amt mono">{{ l.state === 'skipped' ? '不付' : fmt(l.amount) }}</span>
          <span class="st">
            <template v-if="l.state === 'paid'">✓</template>
            <template v-else-if="l.state === 'short'"><b class="warn-t">{{ l.from }}不夠</b></template>
            <template v-else-if="l.state === 'unpaid'"><span class="warn-t">停在前面</span></template>
          </span>
          <button type="button" class="btn sm ghost skip" @click="toggleSkip(g.bills.items.find(x => x.id === l.id)!)">{{ l.state === 'skipped' ? '要付' : '這一項不付了' }}</button>
          <Hint :text="`沒付的話：${l.ifUnpaid}。`" />
        </div>
        <p class="h mt">收入・先入帳</p>
        <div v-for="i in INCOMES" :key="i.id" class="bill inc"><span class="ord mono">＋</span><span class="grow"><b>{{ i.name }}</b></span><MoneyTag :kind="i.to === '帳戶' ? 'acc' : 'cash'" :amount="i.amount" /></div>
      </section>
      <aside class="stack">
        <section class="panel cut pad">
          <p class="h">合計</p>
          <div class="kv"><span>帳戶要付</span><b><MoneyTag kind="acc" :amount="res.dueAcc" /></b></div>
          <div class="kv"><span>現金要付</span><b><MoneyTag kind="cash" :amount="res.dueCash" /></b></div>
          <div class="kv"><span>帳戶付完剩</span><b><MoneyTag kind="acc" :amount="res.accAfter" /></b></div>
          <div class="kv"><span>現金付完剩</span><b><MoneyTag kind="cash" :amount="res.cashAfter" /></b></div>
          <div class="kv"><span>欠繳</span><b>{{ g.bills.overdueWeeks }} 週</b></div>
        </section>
        <section class="panel cut pad">
          <p class="h">補上差額<Hint>洗錢攤抽一到兩成；賣東西照收購價；人情買得到錢買不到的東西。</Hint></p>
          <div class="kv"><span>洗錢攤</span><b>{{ LAUNDER.where }}・抽 {{ LAUNDER.rate * 100 }}%</b></div>
          <div class="kv"><span>要洗的現金</span><b>{{ need ? fmt(need) : '不用' }}</b></div>
          <div class="go">
            <ReasonButton sm :reason="need ? '洗錢攤在天井市場：走過去才能洗。' : '這週不用補。'">去洗錢</ReasonButton>
            <button type="button" class="btn sm" @click="ui.open('bag')">賣東西</button>
            <button type="button" class="btn sm" @click="ui.open('memo')">用人情</button>
          </div>
        </section>
        <section class="panel cut pad">
          <p class="h">下坡路<Hint>欠繳一週：訂閱件全部鎖住。兩週：討債人上門。三週：債權賣給伊甸園。四週起：要求簽契約。寬鬆最多走到第一步；嚴苛每一步間隔 4 天。</Hint></p>
          <div class="down">
            <div v-for="(d, i) in DOWNHILL" :key="d" class="step" :class="{ now: stage === i + 1, off: preset && i + 1 > PRESET_PACE[preset].maxStage }">
              <span class="mono">{{ i + 1 }}</span>{{ d }}
            </div>
          </div>
          <div class="empty-note">{{ stage ? `這週付不出來會走到第 ${stage} 步。` : '照現在的錢，這週付得清。' }}</div>
        </section>
      </aside>
    </div>
    <template #footer>
      <ReasonButton :reason="mult === 0 ? '這一週不結算。' : '收租日是週一 06:00，到時候自動結算。'">先付付得起的</ReasonButton>
      <ReasonButton pri :reason="res.firstShort ? `${res.firstShort.from}不夠。` : '收租日是週一 06:00，到時候自動結算。'">全部付清</ReasonButton>
    </template>
  </Dialog>
</template>

<style scoped>
.bl { display: grid; grid-template-columns: minmax(0, 1fr) 300px; gap: 12px; align-items: start; margin-top: 10px; }
.bill { display: grid; grid-template-columns: 22px minmax(0, 1fr) auto 70px 64px auto auto; gap: 8px; align-items: center; padding: 8px 10px; background: var(--bg-2); margin-bottom: 4px; font-size: var(--fs-sm); }
.bill.inc { grid-template-columns: 22px minmax(0, 1fr) auto; }
.bill.short { box-shadow: inset 3px 0 0 var(--danger); }
.bill.unpaid { opacity: .65; filter: grayscale(.6); }
.bill.skipped { opacity: .5; }
.bill small { display: block; color: var(--ink-3); font-size: var(--fs-xs); }
.ord { color: var(--ink-3); font-size: var(--fs-fine); }
.amt { text-align: right; font-weight: 800; }
.st { font-size: var(--fs-sm); text-align: center; }
.tagbtn { display: inline-flex; align-items: center; gap: 4px; background: var(--bg-term); border: 0; padding: 3px 7px; color: var(--ink-2); font-size: var(--fs-fine); font-weight: 800; cursor: pointer; }
.mt { margin-top: 14px; }
.down { display: grid; gap: 4px; margin-bottom: 8px; }
.step { padding: 6px 10px; background: var(--bg-2); font-size: var(--fs-sm); display: flex; gap: 8px; align-items: center; }
.step.now { box-shadow: inset 0 0 0 2px var(--danger); }
.step.off { opacity: .4; }
.step .mono { color: var(--ink-3); }
@media (max-width: 1000px) { .bl { grid-template-columns: 1fr; } }
@media (max-width: 720px) {
  .bill { grid-template-columns: 22px minmax(0, 1fr) auto; }
  .bill .from, .bill .st { display: none; }
  .bill .skip { grid-column: 2 / 3; justify-self: start; }
}
</style>
