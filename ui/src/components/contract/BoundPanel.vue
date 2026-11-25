<script setup lang="ts">
import { computed, ref } from 'vue'
import type { OrderKind } from '@engine/src/features/contract'
import Hint from '../Hint.vue'
import ReasonButton from '../ReasonButton.vue'
import TrackBar from '../TrackBar.vue'
import { useEngine } from '../../stores/engine'
import { useUi } from '../../stores/ui'
import { fmt } from '../../lib/price'
import { orderRows, payoffRows, ruleText, termText } from '../../lib/contractView'

/**
 * 契約人這一面（UI 第 11 節；規則在 features/contract）：契約寫了什麼、規矩、滿意、佇列（照做與抗拒、去做、做完）、主動要一條、還清、光紋。
 * 只編排：每一欄都是引擎的 boundView，DC、成功率、逾期的處置、價錢、能不能做與原因都是引擎的；面板不直接改任何數值。
 */
const eng = useEngine()
const ui = useUi()
const v = computed(() => eng.contract.bound())
const rows = computed(() => (v.value ? orderRows(v.value, eng.contract.overdueLines()) : []))
const quote = computed(() => eng.contract.payoffQuote())
const askKind = ref<OrderKind | ''>('')
const askKinds = computed(() => (v.value ? v.value.orders.filter((o) => o.ticked).map((o) => ({ kind: o.kind, name: o.name, block: eng.contract.askBlock(o.kind) })) : []))
const askReason = computed(() => (askKind.value ? eng.contract.askBlock(askKind.value) : '先選一種指令。'))
const holderWhere = computed(() => (v.value?.holder.place ? eng.placeName(v.value.holder.place) : ''))

function done(why: string | null, ok?: string) {
  if (why) ui.toast(why, 'warn')
  else if (ok) ui.toast(ok)
}
const choose = (id: string, how: 'comply' | 'resist') => done(eng.contract.choose(id, how))
const arrive = (id: string) => done(eng.contract.arrive(id))
const complete = (id: string) => done(eng.contract.complete(id), '做完了。')
function ask() {
  if (!askKind.value) return
  done(eng.contract.askOrder(askKind.value), '你請持約人派一條指令下來。')
}
const payoff = (talk: boolean) => done(eng.contract.payoff(talk ? { talk: true } : {}))
</script>

<template>
  <div v-if="v" class="bound" data-bound>
    <div class="cols2">
      <section class="panel cut pad" data-holder>
        <p class="h">持約人</p>
        <div class="kv"><span>名字</span><b data-holder-name>{{ v.holder.name }}</b></div>
        <div v-if="holderWhere" class="kv"><span>在哪裡</span><b data-holder-where>{{ holderWhere }}</b></div>
        <div class="kv"><span>契約</span><b data-type>{{ v.type_name }}</b></div>
        <div class="kv"><span>{{ v.debt !== undefined ? '債' : '期限' }}</span><b data-term>{{ termText(v, fmt) }}</b></div>
        <div class="kv"><span>主僕關係</span><b data-relation>{{ v.relation_name }}</b></div>
        <TrackBar label="滿意" :value="v.satisfaction" :max="100" color="var(--ap)" class="mt" data-satisfaction />
        <div class="kv"><span>馴化（有效值）</span><b data-docility>{{ v.docility }}</b></div>
        <div class="kv"><span>照做過</span><b data-complied>{{ v.complied }} 次</b></div>
        <p class="h mt">紙上勾的指令<Hint>契約第四條的格子。紙上劃掉的格子，橋不會替契約人擋下來；契約人能做的是拿著這一頁去談判，或者把它爆出去。</Hint></p>
        <div class="chips"><span v-for="o in v.orders" :key="o.kind" class="tag" :class="{ off: !o.ticked }" :data-order-kind="o.kind" :data-ticked="o.ticked">{{ o.ticked ? '☑' : '☐' }} {{ o.name }}</span></div>
        <p class="h mt">規矩</p>
        <div v-for="(r, i) in v.rules" :key="i" class="kv" data-rule><span>{{ ruleText(r).split('：')[0] }}</span><b>{{ ruleText(r).split('：').slice(1).join('：') }}</b></div>
        <div v-if="!v.rules.length" class="empty-note">沒有規矩。</div>
        <p class="h mt">光紋<Hint>後頸的記號。契約上寫著不准遮；遮了被看出來不會有好下場，遮不遮由你決定（遮要有遮標頸環、遮瑕貼這類的東西）。</Hint></p>
        <div class="go left">
          <span class="grow" data-mark>{{ v.mark.covered ? '遮著' : '露著' }}</span>
          <ReasonButton sm :reason="eng.contract.coverBlock(!v.mark.covered)" data-cover @go="done(eng.contract.cover(!v.mark.covered))">{{ v.mark.covered ? '露出來' : '遮起來' }}</ReasonButton>
        </div>
        <template v-if="v.rights.length">
          <p class="h mt">另外的橋權</p>
          <div v-for="(r, i) in v.rights" :key="i" class="kv"><span>{{ r.level === 'limit' ? '限制級' : '讀取級' }}</span><b>{{ r.holder.name }}・{{ r.source }}</b></div>
        </template>
      </section>

      <section class="panel cut pad" data-queue>
        <p class="h">指令佇列<Hint>抗拒要過定力檢定，DC 與成功率都是引擎算的（看馴化、沉溺與主僕關係）。抗拒失敗時，這條指令變成非做不可的事；過了期限還沒做，橋自己動手。</Hint></p>
        <div class="empty-note" data-daily>每天 08:00 持約人會擲一次要不要下新指令，機率 {{ Math.round(v.daily_chance * 100) }}%（佇列最多 {{ v.queue_max }} 條）。</div>
        <div v-for="o in rows" :key="o.id" class="order" :class="{ over: o.overdue, closed: !o.live }" :data-order="o.id" :data-state="o.stateName" :data-overdue="o.overdue">
          <span class="kc">{{ o.name }}</span>
          <span class="grow">
            <b>{{ o.stateName }}<template v-if="o.asked">・你要的</template></b>
            <small v-if="o.place" data-place>地點：{{ o.place }}<template v-if="o.arrived">・已經到過</template></small>
            <small v-if="o.penalty" data-penalty>{{ o.live ? '逾期會：' : '處置：' }}{{ o.penalty }}</small>
          </span>
          <span v-if="o.live" class="mono lf" :class="{ 'warn-t': o.overdue }" data-left>{{ o.left }}</span>
          <span v-if="o.live" class="acts2">
            <template v-if="o.sent">
              <ReasonButton sm pri :reason="eng.contract.chooseBlock(o.id, 'comply')" data-comply @go="choose(o.id, 'comply')">照做</ReasonButton>
              <ReasonButton sm :reason="eng.contract.chooseBlock(o.id, 'resist')" data-resist :title="o.resistTitle" @go="choose(o.id, 'resist')">抗拒<small class="rs" data-resist-text>{{ o.resistText }}</small></ReasonButton>
            </template>
            <template v-else>
              <ReasonButton v-if="o.place && !o.arrived" sm :reason="eng.contract.arriveBlock(o.id)" data-arrive @go="arrive(o.id)">到了，去做</ReasonButton>
              <ReasonButton sm pri :reason="eng.contract.completeBlock(o.id)" data-complete @go="complete(o.id)">做完了</ReasonButton>
            </template>
          </span>
        </div>
        <div v-if="!rows.length" class="empty-note" data-empty>佇列是空的。</div>

        <p class="h mt">主動要一條指令<Hint>主動要求的指令直接變成照做中；做完滿意加得比較多。只能要紙上勾了的種類。</Hint></p>
        <div class="askrow">
          <select v-model="askKind" class="inp" aria-label="指令的種類" data-ask-kind>
            <option value="">選一種……</option>
            <option v-for="k in askKinds" :key="k.kind" :value="k.kind">{{ k.name }}{{ k.block ? '（不行）' : '' }}</option>
          </select>
          <ReasonButton sm :reason="askReason" data-ask @go="ask">要一條</ReasonButton>
        </div>

        <p class="h mt">脫身<Hint>還沒發現的路不列出來。目前引擎只做了還清。</Hint></p>
        <template v-if="quote">
          <div v-for="r in payoffRows(quote, fmt)" :key="r.label" class="kv" :data-payoff-row="r.label"><span>{{ r.label }}</span><b>{{ r.value }}</b></div>
          <div class="go left">
            <ReasonButton sm pri :reason="eng.contract.payoffBlock()" data-payoff @go="payoff(false)">還清（C${{ fmt(quote.price) }}）</ReasonButton>
            <ReasonButton v-if="quote.can_talk" sm :reason="eng.contract.payoffBlock({ talk: true })" data-payoff-talk @go="payoff(true)">先談價</ReasonButton>
          </div>
          <div v-if="!quote.can_talk" class="empty-note">持約人對你的滿意夠高才能談價。</div>
        </template>
        <div v-else class="empty-note" data-escape-none>這份契約沒有欠債可以還清；其他脫身的路還沒有開放。</div>
      </section>
    </div>
  </div>
</template>

<style scoped>
.mt { margin-top: var(--space-5); }
.tag.off { opacity: .5; text-decoration: line-through; }
.go.left { justify-content: flex-start; align-items: center; margin-top: var(--space-3); }
.go .grow { flex: 1; min-width: 0; color: var(--ink-2); font-size: var(--fs-sm); }
.order { display: grid; grid-template-columns: auto minmax(0, 1fr) auto; gap: 6px 8px; align-items: start; padding: 8px 10px; background: var(--bg-2); margin-top: 5px; font-size: var(--fs-sm); }
.order.over { box-shadow: inset 3px 0 0 var(--danger); }
.order.closed { opacity: .6; }
.order.over.closed { opacity: 1; }
.order small { display: block; color: var(--ink-3); font-size: var(--fs-fine); }
.order .kc { font-weight: 900; padding: 2px 8px; border-radius: 6px; background: var(--bg-3); color: var(--ep); }
.order.over .kc { color: var(--danger); }
.lf { font-size: var(--fs-sm); white-space: nowrap; }
.acts2 { grid-column: 2 / -1; display: flex; gap: 5px; justify-content: flex-end; flex-wrap: wrap; }
.rs { display: block; font-weight: 600; font-size: var(--fs-fine); }
.askrow { display: flex; gap: var(--space-3); align-items: center; flex-wrap: wrap; margin-top: var(--space-3); }
.inp { background: var(--bg-term); color: var(--ink); border: 0; box-shadow: inset 0 0 0 2px var(--line); padding: 6px 10px; font: 600 var(--fs-sm) var(--font); min-width: 0; }
@media (max-width: 720px) { .cols2 { grid-template-columns: minmax(0, 1fr); } .order { grid-template-columns: auto minmax(0, 1fr); } .lf { grid-column: 2; } }
</style>
