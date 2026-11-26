<script setup lang="ts">
import { computed, ref } from 'vue'
import type { AuctionView } from '@engine/src/features/auction'
import Hint from '../Hint.vue'
import MoneyTag from '../MoneyTag.vue'
import ReasonButton from '../ReasonButton.vue'
import { useEngine } from '../../stores/engine'
import { useUi } from '../../stores/ui'
import { lookBadge, payKind, raiseLabel, roundLines } from '../../lib/auctionView'
import { fmt } from '../../lib/price'

/**
 * 拍賣廳裡（M4-ui-auction 第 5、6 項）：左邊這一件、中間現價與誰最高與倒數、右邊在場的競標者（退出的劃掉）；底下加價 1～3 階、等、退出，與離場（要確認）。
 * 頂端一直顯示這一場花了多少、那一種錢還剩多少、第幾件之幾。
 * 按鈕上的數字（加完的價錢、含佣金的總數）與灰掉的原因全是引擎的 bidOptions；這一回合每個人的動作照報告的順序一行一行出現（句子是引擎寫的）。
 * 看的是 auctionView 與 bidOptions：競標者的預算與拍品是不是仿品不在這裡。
 */
const props = defineProps<{ view: AuctionView }>()
const e = useEngine()
const ui = useUi()

const v = computed(() => props.view)
const kind = computed(() => payKind(v.value.pay))
const options = computed(() => e.auction.bidOptions())
const round = computed(() => e.auction.lastRound())
const lines = computed(() => roundLines(round.value))
const look = computed(() => lookBadge(v.value.lot))
const confirming = ref(false)
const busy = ref(false)

async function send(f: () => Promise<{ status: string; reason?: string }>, fallback: string) {
  if (busy.value) return
  busy.value = true
  try {
    const r = await f()
    if (r.status !== 'applied') ui.toast(r.reason ?? fallback, 'warn')
  } finally {
    busy.value = false
  }
}
const raise = (steps: number) => send(() => e.auction.bid({ act: 'raise', steps }), '現在不能加價。')
const wait = () => send(() => e.auction.bid({ act: 'wait' }), '現在不能等。')
const fold = () => send(() => e.auction.bid({ act: 'fold' }), '現在不能退出。')
async function leave() {
  confirming.value = false
  await send(() => e.auction.leave(), '現在離不了場。')
}
const LINE_TONE: Record<string, string> = { 'auction.hammer': 'hammer', 'auction.gavel': 'hammer', 'auction.settle': 'settle', 'auction.countdown': 'count', 'auction.announce': 'host' }
</script>

<template>
  <div class="floor">
    <header class="top panel cut pad" data-floor-top>
      <span class="chip" data-lot-no><small>第幾件</small><b>{{ v.lot_no }}／{{ v.lot_count }}</b></span>
      <span class="chip" data-spent><small>這一場花了</small><b><MoneyTag :kind="kind" :amount="v.spent" /></b></span>
      <span class="chip" data-money><small>{{ v.pay_name }}還剩</small><b><MoneyTag :kind="kind" :amount="v.money" /></b></span>
    </header>

    <div class="cols">
      <section class="panel cut pad" data-lot>
        <p class="h">這一件</p>
        <b class="nm" data-lot-name>{{ v.lot.name }}</b>
        <div class="chips"><span class="tag" data-lot-kind>{{ v.lot.kind_name }}</span><span v-if="look" class="tag" :class="`look-${look.tone}`" data-lot-looked>{{ look.name }}</span></div>
        <p v-if="v.lot.desc" class="desc">{{ v.lot.desc }}</p>
        <div class="kv"><span>鑑定書</span><b data-lot-cert>{{ v.lot.cert }}</b></div>
        <div class="kv"><span>底價</span><b>{{ fmt(v.reserve) }}</b></div>
        <div class="kv"><span>一階</span><b data-step>{{ fmt(v.step) }}</b></div>
        <p v-if="!look" class="note">這一件你沒有看過貨。</p>
      </section>

      <section class="panel cut pad mid" data-price-box>
        <p class="h">現價</p>
        <div class="price" data-price><MoneyTag :kind="kind" :amount="v.price" :size="22" /></div>
        <div class="kv"><span>最高的人</span><b data-holder :class="{ me: v.holder.id === 'pc' }">{{ v.holder.name ?? '還沒有人出價' }}</b></div>
        <div class="kv"><span>回合</span><b data-round>第 {{ v.round }} 回合（最多 {{ v.rounds_max }}）</b></div>
        <div class="kv"><span>倒數<Hint title="倒數">連續兩個回合沒有人加價就落槌；「倒數一次」是第一個沒有人加價的回合。回合滿了也以現價落槌。</Hint></span><b data-countdown :class="{ warn: v.countdown }">{{ v.countdown ? '倒數一次（下一回合沒人加價就落槌）' : v.quiet === 0 ? '還在喊' : `沒人加價 ${v.quiet} 回合` }}</b></div>
        <p class="host" data-host>{{ v.host }}</p>
      </section>

      <section class="panel cut pad" data-bidders>
        <p class="h">在場的競標者</p>
        <div v-for="b in v.bidders" :key="b.id" class="bidder" :class="{ out: b.out, top: v.holder.id === b.id }" :data-bidder="b.id" :data-out="b.out ? '1' : '0'">
          <span>{{ b.name }}</span><small v-if="b.out">退出了</small><small v-else-if="v.holder.id === b.id" class="hi">最高</small>
        </div>
        <p v-if="!v.bidders.length" class="empty-note">沒有別的競標者。</p>
      </section>
    </div>

    <section v-if="options" class="panel cut pad" data-controls>
      <p class="h">你的動作<Hint title="加價、等、退出">加價一次 1～3 階，按鈕上寫加完的價錢與含佣金的總數；你是最高的人時只能等；退出之後這一件你不能再喊（別人繼續）。灰掉的按鈕點了會說原因。</Hint></p>
      <div class="btns">
        <ReasonButton v-for="o in options.raise" :key="o.steps" :pri="o.can" :reason="o.blocks.length ? o.blocks.join('') : null" :data-raise="o.steps" @go="raise(o.steps!)">
          <span class="rl"><b>{{ raiseLabel(o) }}</b><small data-raise-price>→ {{ fmt(o.price ?? 0) }}</small><small data-raise-total>含佣金 {{ fmt(o.total ?? 0) }}</small></span>
        </ReasonButton>
        <ReasonButton :reason="options.wait.blocks.length ? options.wait.blocks.join('') : null" data-wait @go="wait">等</ReasonButton>
        <ReasonButton :reason="options.fold.blocks.length ? options.fold.blocks.join('') : null" data-fold @go="fold">退出這一件</ReasonButton>
        <button type="button" class="btn" data-leave @click="confirming = true">離場</button>
      </div>
      <div v-if="confirming" class="warnbox" data-leave-confirm>
        <p><b>要離場嗎？</b>剩下的拍品你都不喊了：程式會把它們喊完，你這一場已經得標的照付，同一場不能再進。</p>
        <div class="go"><button type="button" class="btn" @click="confirming = false">再想想</button><button type="button" class="btn pri" data-leave-yes @click="leave">離場</button></div>
      </div>
    </section>

    <section v-if="lines.length" class="panel cut pad" data-round-log>
      <p class="h">這一回合</p>
      <p v-for="(l, i) in lines" :key="`${round?.id}-${i}`" class="line" :class="LINE_TONE[l.tag]" :style="{ '--i': i }" data-round-line>{{ l.text }}</p>
    </section>

    <section v-if="v.won.length" class="panel cut pad" data-won>
      <p class="h">這一場得標的</p>
      <div v-for="w in v.won" :key="w.lot" class="kv"><span>第 {{ w.lot + 1 }} 件</span><b>{{ w.name }}・<MoneyTag :kind="kind" :amount="w.price" />＋佣金 <MoneyTag :kind="kind" :amount="w.fee" /></b></div>
    </section>
  </div>
</template>

<style scoped>
.floor { display: grid; gap: var(--space-4); }
.top { display: flex; gap: var(--space-5); flex-wrap: wrap; align-items: center; }
.chip { display: grid; gap: 1px; }
.chip small { color: var(--ink-3); font-size: var(--fs-xs); }
.chip b { font-size: var(--fs-card); }
.cols { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1.1fr) minmax(0, 0.8fr); gap: var(--space-4); align-items: start; }
.nm { font-size: var(--fs-card); display: block; margin-bottom: var(--space-2); }
.chips { display: flex; gap: var(--space-2); flex-wrap: wrap; margin-bottom: var(--space-3); }
.desc { margin: 0 0 var(--space-3); color: var(--ink-2); font-size: var(--fs-sm); line-height: 1.6; }
.note { margin: var(--space-2) 0 0; color: var(--ink-3); font-size: var(--fs-fine); }
.look-ok { color: var(--ok); } .look-bad { color: var(--warn); } .look-mid { color: var(--ink-3); }
.price { margin: 0 0 var(--space-3); font-size: var(--fs-num); }
.me { color: var(--a); }
.warn { color: var(--warn); }
.host { margin: var(--space-3) 0 0; padding: var(--space-3); background: var(--bg-2); color: var(--ink-2); font-size: var(--fs-sm); line-height: 1.6; box-shadow: inset 3px 0 0 var(--ap); }
.bidder { display: flex; gap: var(--space-3); align-items: baseline; padding: var(--space-2) var(--space-3); background: var(--bg-2); margin-bottom: var(--space-2); }
.bidder.out span { text-decoration: line-through; color: var(--ink-3); }
.bidder small { color: var(--ink-3); font-size: var(--fs-xs); }
.bidder .hi { color: var(--ap); font-weight: 800; }
.bidder.top { box-shadow: inset 3px 0 0 var(--ap); }
.btns { display: flex; gap: var(--space-3); flex-wrap: wrap; align-items: stretch; }
.rl { display: grid; gap: 1px; justify-items: start; text-align: left; }
.rl small { font-size: var(--fs-xs); font-weight: 600; opacity: .85; font-family: var(--mono); }
.warnbox { margin-top: var(--space-3); padding: var(--space-3); background: var(--bg-1); box-shadow: inset 3px 0 0 var(--warn); display: grid; gap: var(--space-2); }
.warnbox p { margin: 0; font-size: var(--fs-sm); }
.go { display: flex; gap: var(--space-3); flex-wrap: wrap; }
.line { margin: 0 0 var(--space-2); font-size: var(--fs-sm); line-height: 1.6; animation: rise var(--dur) both; animation-delay: calc(var(--i) * var(--dur)); }
.line.hammer { color: var(--ap); font-weight: 800; } .line.settle { color: var(--ok); } .line.count { color: var(--warn); } .line.host { color: var(--ink-2); }
@keyframes rise { from { opacity: 0; transform: translateY(4px); } to { opacity: 1; transform: none; } }
@media (max-width: 860px) { .cols { grid-template-columns: 1fr; } }
</style>
