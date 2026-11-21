<script setup lang="ts">
import { computed, ref } from 'vue'
import Dialog from '../components/Dialog.vue'
import Tabs from '../components/Tabs.vue'
import Hint from '../components/Hint.vue'
import TrackBar from '../components/TrackBar.vue'
import ReasonButton from '../components/ReasonButton.vue'
import { useGame } from '../stores/game'
import { useSettings } from '../stores/settings'
import { useUi } from '../stores/ui'
import { HOLDER_EVENTS, RELATIONS, ORDER_KINDS, SAMPLE_MINE } from '../data/contracts'
import { fmt } from '../lib/price'
import { useGuides } from '../lib/useGuides'

/**
 * 契約面板（UI 第 11 節，規則 LEWD_SYSTEM 7.4～7.6 節、LIFE 3.4 節）。面板不改任何數值，只是事件的入口與契約的檢視。
 * 持約人那一面：「事件」與「契約」兩頁。契約人那一面：持約人、指令佇列、規矩、脫身。
 * 「契約支配」被內容篩選關掉時，事件頁只剩差事、工作、談一談，契約頁照常（7.8 節）。解約永遠在最下面，不藏。
 */
const props = defineProps<{ entryId: number; stacked?: boolean; npcId?: string; side?: string }>()
const g = useGame()
const st = useSettings()
const ui = useUi()
useGuides().trigger('g_contract')
const side = ref(props.side ?? 'held')
const page = ref('events')
const sample = ref(false)
const c = computed(() => g.contracts.held.find(x => x.npc === (props.npcId ?? 'xiaoqi')) ?? g.contracts.held[0])
const n = computed(() => g.npcs[c.value.npc])
const events = computed(() => HOLDER_EVENTS.filter(e => !e.filter || st.s[e.filter as 'filterContract']))
const hiddenByFilter = computed(() => HOLDER_EVENTS.filter(e => e.filter && !st.s[e.filter as 'filterContract']).length)
function relationBlock(r: string) {
  if (r === '名實相符') return null
  if (n.value.affinity < 60) return `親密度 ${n.value.affinity}：到 60 才能選「名實相符」以外的關係。`
  return null
}
function runEvent(name: string) {
  g.addLog({ prose: [`你用耳語對${n.value.name}下了一條指令：${name}。`], place: g.placeLabel })
  ui.toast(`「${name}」的事件開始了；結果由事件決定，面板不改數值。`)
}
function endContract() {
  ui.toast('解約是一個事件：你們兩個會談一次，之後她可以留下來當夥伴，也可以走。這一版先不觸發。', 'warn')
}
</script>

<template>
  <Dialog :entry-id="entryId" :stacked="stacked" title="契約" :sub="side === 'held' ? `你是持約人・${n.name}` : '你身上的契約'" size="lg">
    <template #header><Tabs v-model="side" :tabs="[{ id: 'held', label: '你是持約人' }, { id: 'mine', label: '你身上的契約' }]" /></template>

    <template v-if="side === 'held'">
      <div class="who panel cut pad">
        <div class="ava" aria-hidden="true">{{ n.name.slice(0, 1) }}</div>
        <div class="grow"><b>{{ n.name }}</b><small>{{ c.kind }}・{{ c.origin }}</small></div>
        <div class="kv2"><span class="k">橋權</span><b>{{ c.level }}級</b></div>
        <div class="kv2"><span class="k">主僕關係</span><b>{{ c.relation }}</b></div>
        <Tabs v-model="page" :tabs="[{ id: 'events', label: '事件' }, { id: 'paper', label: '契約' }]" />
      </div>
      <section v-if="page === 'events'" class="panel cut pad mt">
        <p class="h">現在能對她做的事<Hint>依她的狀態、親密度、主僕關係與你的傾向決定有哪些可選。選了就進入那個事件；結果與數值的變化由事件決定，不是在這裡直接調。她也會主動來找你。</Hint></p>
        <div class="row-list">
          <div v-for="e in events" :key="e.name" class="lrow">
            <span class="grow"><b>{{ e.name }}</b><small>{{ e.note }}</small></span>
            <span class="mono st" :class="{ 'warn-t': e.cooldown }">{{ e.state }}</span>
            <ReasonButton sm :pri="!e.cooldown" :reason="e.cooldown ? `「${e.name}」在冷卻：${e.note}。` : null" @go="runEvent(e.name)">開始</ReasonButton>
          </div>
        </div>
        <div v-if="hiddenByFilter" class="empty-note mt">有 {{ hiddenByFilter }} 項被內容篩選關掉了。</div>
      </section>
      <section v-else class="panel cut pad mt">
        <div class="cols2">
          <div>
            <div class="kv"><span>剩下的債</span><b>{{ fmt(c.debt) }}</b></div>
            <div class="kv"><span>住處</span><b>{{ c.home }}</b></div>
            <div class="kv"><span>工作</span><b>{{ c.job }}</b></div>
            <div class="kv"><span>收入分配</span><b>{{ c.split }}</b></div>
            <div class="kv"><span>親密度</span><b>{{ n.affinity }}・{{ n.stage }}</b></div>
            <div class="kv"><span>身上的義體</span><b>{{ c.cyber }} 件</b></div>
            <div class="kv"><span>規矩</span><b>{{ c.rules.join('、') || '沒有' }}</b></div>
            <p class="h mt">指令範圍<Hint>契約第四條的七個格子。紙上劃掉的格子，橋不會替契約人擋下來；契約人能做的是拿著這一頁去談判，或者把它爆出去。</Hint></p>
            <div class="chips"><span v-for="o in ORDER_KINDS" :key="o" class="tag" :class="{ off: !c.orders.includes(o) }">{{ c.orders.includes(o) ? '☑' : '☐' }} {{ o }}</span></div>
          </div>
          <div>
            <TrackBar label="忠誠" :value="n.loyalty" :max="100" color="var(--ram)" />
            <TrackBar label="馴化" :value="c.tame" :max="100" color="var(--ep)" class="mt" />
            <p class="h mt">橋參數</p>
            <TrackBar v-for="(v, k) in c.params" :key="k" :label="String(k)" :value="v" :max="100" color="var(--b)" :height="6" class="mt2" />
            <p class="h mt">主僕關係<Hint>只決定兩人相處的基調，不改變任何人的性格。親密度到 60 才能選「名實相符」以外的關係；掉到 40 以下退回去。</Hint></p>
            <div class="segs"><ReasonButton v-for="r in RELATIONS" :key="r" sm :pri="c.relation === r" :reason="relationBlock(r)" @go="c.relation = r">{{ r }}</ReasonButton></div>
          </div>
        </div>
        <div class="go">
          <button type="button" class="btn sm" @click="ui.toast('改規矩是一個事件：她會知道。')">改規矩</button>
          <button type="button" class="btn sm" @click="ui.toast('改住處：她可以住在你的據點，或她自己的地方。')">改住處</button>
          <button type="button" class="btn sm" @click="runEvent('安排工作')">改工作</button>
          <button type="button" class="btn sm" @click="ui.toast('收入分配照第六條；改了她會記得。')">改分配</button>
          <ReasonButton sm :reason="!c.orders.includes('出借') ? '紙上劃掉了「出借」：她可以拿這一頁跟你談。' : null">出借</ReasonButton>
        </div>
        <div class="end"><button type="button" class="btn sm ghost danger" @click="endContract">解約</button><Hint>解約永遠是選項，而且遊戲會記得。解約之後她可以留下來當夥伴，也可以走。</Hint></div>
      </section>
    </template>

    <template v-else>
      <section v-if="!sample" class="panel cut pad">
        <p class="h">你身上沒有管理級的契約<Hint>讀取級與限制級的橋權寫在雇用合約、貸款與保險裡，大家叫那些「合約」。只有交出管理級橋權的才算契約人，才有指令佇列。</Hint></p>
        <div class="kv"><span>讀取級</span><b>天使急救（保險）、緋櫻（訂閱的義體）</b></div>
        <div class="kv"><span>限制級</span><b>伊甸園（消費貸款）</b></div>
        <div class="go"><button type="button" class="btn sm" @click="sample = true">看契約人這一面的範例</button></div>
      </section>
      <template v-else>
        <div class="blocking">範例：不在這份存檔裡。主角是契約人時，工具列的「契約」打開這一面。</div>
        <div class="cols2 mt">
          <section class="panel cut pad">
            <p class="h">持約人</p>
            <div class="kv"><span>名字</span><b>{{ SAMPLE_MINE.holder.name }}</b></div>
            <div class="kv"><span>在哪裡</span><b>{{ SAMPLE_MINE.holder.where }}</b></div>
            <TrackBar label="滿意" :value="SAMPLE_MINE.holder.satisfaction" :max="100" color="var(--ap)" class="mt" />
            <div class="kv"><span>主僕關係</span><b>{{ SAMPLE_MINE.holder.relation }}</b></div>
            <div class="go"><button type="button" class="btn sm" @click="ui.toast('目的地設成伊甸園本店「樂園」。')">走過去</button><button type="button" class="btn sm" @click="ui.toast('談判在持約人那裡開。')">提出談判</button><button type="button" class="btn sm" @click="ui.toast('你請她派一條指令下來；主動要求的做完，滿意加得比較多。')">要一條指令</button></div>
            <p class="h mt">規矩</p>
            <div v-for="[k, v] in SAMPLE_MINE.rules" :key="k" class="kv"><span>{{ k }}</span><b>{{ v }}</b></div>
          </section>
          <section class="panel cut pad">
            <p class="h">指令佇列<Hint>抗拒要過定力檢定，難度看持約人的權限與你的馴化。抗拒失敗時，這條指令變成非做不可的事；過了期限還沒做，橋自己動手。</Hint></p>
            <div v-for="q in SAMPLE_MINE.queue" :key="q.text" class="order" :class="{ over: q.overdue }">
              <span class="kc" :style="{ '--c': q.overdue ? 'var(--danger)' : 'var(--ep)' }">{{ q.kind }}</span>
              <span class="grow"><b>{{ q.text }}</b><small>違約：{{ q.penalty }}</small></span>
              <span class="mono" :class="q.overdue ? 'warn-t' : ''">{{ q.due }}</span>
              <span class="acts2"><button type="button" class="btn sm pri" @click="ui.toast('目的地設好了。')">照做</button><button type="button" class="btn sm" @click="ui.toast(`抗拒：定力 DC ${SAMPLE_MINE.resistDc}。`)">抗拒（DC {{ SAMPLE_MINE.resistDc }}）</button></span>
            </div>
            <p class="h mt">脫身<Hint>還沒發現的路不列出來。</Hint></p>
            <div v-for="e in SAMPLE_MINE.escape" :key="e.path" class="kv"><span>{{ e.path }}</span><b>{{ e.step }}</b></div>
          </section>
        </div>
        <div class="go"><button type="button" class="btn sm" @click="sample = false">回去</button></div>
      </template>
    </template>
  </Dialog>
</template>

<style scoped>
.who { display: flex; align-items: center; gap: 12px; flex-wrap: wrap; }
.who .grow { flex: 1; min-width: 140px; }
.who small { display: block; color: var(--ink-3); font-size: var(--fs-xs); }
.ava { width: 44px; height: 44px; border-radius: 10px; background: var(--bg-2); display: grid; place-items: center; font-weight: 900; color: var(--b); flex: none; }
.kv2 { display: grid; }
.mt { margin-top: 12px; }
.mt2 { margin-top: 6px; }
.st { font-size: 12px; }
.tag.off { opacity: .5; text-decoration: line-through; }
.end { margin-top: 18px; padding-top: 10px; border-top: 2px solid var(--line); display: flex; align-items: center; gap: 6px; }
.danger { color: var(--danger); }
.order { display: grid; grid-template-columns: auto minmax(0, 1fr) auto; gap: 6px 8px; align-items: start; padding: 8px 10px; background: var(--bg-2); margin-bottom: 5px; font-size: var(--fs-sm); }
.order.over { box-shadow: inset 3px 0 0 var(--danger); }
.order small { display: block; color: var(--ink-3); }
.acts2 { grid-column: 2 / -1; display: flex; gap: 5px; justify-content: flex-end; flex-wrap: wrap; }
</style>
