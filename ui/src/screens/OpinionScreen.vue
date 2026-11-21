<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, reactive, ref, shallowRef, triggerRef } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import StatusBar from '../components/StatusBar.vue'
import Hint from '../components/Hint.vue'
import ReasonButton from '../components/ReasonButton.vue'
import { OpinionWar, CELLS, ROWS, TIME_SLOTS, CARDS, CARD_KIND, TOPICS, OPPONENTS } from '../lib/combat/opinion'
import { mathRng, seeded } from '../lib/combat/rng'
import { combatKey, isTyping } from '../lib/keys'
import { useGame } from '../stores/game'
import { useSettings } from '../stores/settings'
import { tableFor } from '../lib/difficulty'
import { useUi } from '../stores/ui'

/**
 * 輿論戰（全頁，OPINION 第 3～5 節、第 10 節的編輯台）：照 docs/mockups/opinion-demo.html 重做成元件。
 * 3 × 3 的棋盤、聲量與風向、編輯點、手牌、技能（帶風向、追擊）、佔領、六個時段；對手含萬華鏡、緋櫻與第一手的潔絲（pr_jess）。
 * 從委託連過來：#/opinion?topic=tape_leak&foe=pr_jess&from=/。鍵盤：1～5 出手牌，Tab 換格子、Enter 確定，空白鍵結束回合。
 */
const route = useRoute()
const router = useRouter()
const g = useGame()
const st = useSettings()
const ui = useUi()
const q = (k: string) => (typeof route.query[k] === 'string' ? (route.query[k] as string) : '')
const topic = ref(q('topic') || 'scandal')
const foe = ref(q('foe') || 'pr_2')
const from = computed(() => q('from') || '/')
const speed = () => (route.query.fast ? 0.02 : 1)
const seed = Number(route.query.seed) || 0
const hint = ref('')
const busy = ref(false)
const focus = ref(0)
const make = () => reactive(new OpinionWar({ topic: topic.value, foe: foe.value, pr: tableFor(st.s.difficulty, st.s.customDiff).pr }, seed ? seeded(seed) : mathRng)) as OpinionWar
const o = shallowRef<OpinionWar>(make())
let timer: ReturnType<typeof setTimeout> | null = null
function restart() { if (timer) clearTimeout(timer); busy.value = false; o.value = make(); triggerRef(o); hint.value = ''; focus.value = 0 }

const can = computed(() => !busy.value && !o.value.end)
const targets = computed(() => o.value.targets())
const focused = computed(() => (targets.value.length ? targets.value[((focus.value % targets.value.length) + targets.value.length) % targets.value.length] : -1))
function play(i: number) {
  if (!can.value) return
  const r = o.value.cardReason(i)
  if (r) { hint.value = `${o.value.hand[i] ? CARDS[o.value.hand[i]].n : '這張牌'}：${r}。`; return }
  o.value.play(i)
  focus.value = 0
  hint.value = o.value.mode?.k === 'guard' ? '選你的一格設防（綠框）。Tab 換格子，Enter 確定。' : ''
}
function skill(k: 's1' | 's2') { if (!can.value) return; const r = o.value.skillReason(k); if (r) { hint.value = r + '。'; return } o.value.skill(k) }
function cap() {
  if (!can.value) return
  const r = o.value.capReason()
  if (r) { hint.value = `佔領：${r}。`; return }
  o.value.toggleCap()
  focus.value = 0
  hint.value = o.value.mode ? '選一個相鄰、而且你的聲量夠的格子（綠框）。Tab 換格子，Enter 確定。' : ''
}
function cell(i: number) { if (can.value && o.value.pickCell(i)) { hint.value = ''; focus.value = 0 } }
function endTurn() {
  if (!can.value) return
  hint.value = ''
  o.value.endTurn()
  busy.value = true
  const step = () => {
    const more = o.value.foeStep()
    if (more) timer = setTimeout(step, 600 * speed())
    else busy.value = false
  }
  timer = setTimeout(step, 400 * speed())
}
function onKey(e: KeyboardEvent) {
  if (e.defaultPrevented) return
  const el = e.target as HTMLElement | null
  if (e.key === ' ' && el?.closest?.('.hold, select')) return
  if (e.key === 'Enter' && !o.value.mode && el?.closest?.('button, [role="button"], a, select')) return
  if (e.key === 'Enter' && el?.closest?.('[data-unit], [data-slot], [data-cell]')) return
  const a = combatKey(e, { typing: isTyping(e.target), dialogOpen: ui.stack.length > 0, targeting: !!o.value.mode })
  if (!a || (a.type === 'cycle' && !o.value.mode)) return
  e.preventDefault()
  if (!can.value) return
  if (a.type === 'ring') { if (a.i < 5) play(a.i) }
  else if (a.type === 'end') endTurn()
  else if (a.type === 'cycle') focus.value += a.dir
  else if (a.type === 'confirm') { if (focused.value >= 0) cell(focused.value) }
  else if (a.type === 'cancel') { o.value.mode = null; hint.value = '' }
}
onMounted(() => window.addEventListener('keydown', onKey, true))
onBeforeUnmount(() => { window.removeEventListener('keydown', onKey, true); if (timer) clearTimeout(timer) })

const owner = (i: number) => (o.value.own[i] === 1 ? '你的' : o.value.own[i] === 2 ? '對手的' : '沒人的')
const wind = computed(() => `${(o.value.w + 5) * 10}%`)
function leave() {
  const e = o.value.end!
  g.advance(o.value.round * 60)
  g.addLog({ prose: [`輿論戰：${o.value.topic.n}，對上${o.value.foe.name}。${e.text}`], changes: [{ text: `${e.result}・${e.a} 對 ${e.b}`, kind: e.result === '敗' ? 'minus' : 'plus' }] })
  g.lastBattle = { kind: 'opinion', result: e.result === '敗' ? 'lose' : e.result === '平手' ? 'draw' : 'win', text: e.text }
  router.push(from.value)
}
</script>

<template>
  <div class="op-screen">
    <StatusBar back title="輿論戰：編輯台" />
    <div class="op-wrap">
      <section class="panel cut top">
        <span class="ttl">{{ o.topic.n }}</span>
        <div class="slots" aria-label="時段"><i v-for="(s, i) in TIME_SLOTS.slice(0, o.rounds)" :key="s" :class="{ on: i === o.round - 1 && !o.end, done: i < o.round - 1 || !!o.end }">{{ s }}</i></div>
        <span class="grow" />
        <label class="sel"><span class="k">議題</span><select v-model="topic" @change="restart"><option v-for="t in TOPICS" :key="t.id" :value="t.id">{{ t.n }}</option></select></label>
        <label class="sel"><span class="k">對手</span><select v-model="foe" data-foe @change="restart"><option v-for="x in OPPONENTS" :key="x.id" :value="x.id">{{ x.name }}（強度 {{ x.st }}）</option></select></label>
        <button type="button" class="btn sm" @click="restart">重新開始</button>
        <Hint title="輿論戰">一場六回合（六個時段）。每回合抽 2 張、用編輯點出牌或用技能，累積聲量與風向，然後佔領一格：只能佔和自己的格子相鄰的格子，聲量要 ≥ 那一格的防守（沒人的 2；對手的 3 − 風向，最少 1）。結算時你的格子的分數加起來對上對手的；一方的格子被清空，戰役立刻結束。鍵盤：1～5 出手牌，Tab 換格子、Enter 確定，空白鍵結束回合。</Hint>
      </section>
      <section class="panel cut pad foe"><b>{{ o.foe.name }}</b><span class="t-fine">{{ o.foe.note }}</span><span v-if="busy" class="tag warn">對手的回合……</span></section>

      <div class="main">
        <section class="panel cut pad">
          <div class="board" role="grid" aria-label="棋盤">
            <template v-for="r in 3" :key="r">
              <div class="rl">{{ ROWS[r - 1] }}</div>
              <button v-for="c in 3" :key="c" type="button" class="cell" :data-cell="(r - 1) * 3 + c - 1"
                :class="{ me: o.own[(r - 1) * 3 + c - 1] === 1, foe: o.own[(r - 1) * 3 + c - 1] === 2, tg: can && targets.includes((r - 1) * 3 + c - 1), foc: can && focused === (r - 1) * 3 + c - 1, sh: o.sh[(r - 1) * 3 + c - 1] }"
                :aria-label="`${CELLS[(r - 1) * 3 + c - 1]}，${o.topic.s[(r - 1) * 3 + c - 1]} 分，${owner((r - 1) * 3 + c - 1)}`"
                @click="targets.includes((r - 1) * 3 + c - 1) ? cell((r - 1) * 3 + c - 1) : undefined">
                <b>{{ CELLS[(r - 1) * 3 + c - 1] }}</b>
                <span class="pt" :class="{ z: !o.topic.s[(r - 1) * 3 + c - 1] }">{{ o.topic.s[(r - 1) * 3 + c - 1] }}</span>
                <span class="ow">{{ owner((r - 1) * 3 + c - 1) }}{{ o.sh[(r - 1) * 3 + c - 1] ? '・設防' : '' }}</span>
                <span class="df">{{ o.own[(r - 1) * 3 + c - 1] === 1 ? `對手要 ${o.def((r - 1) * 3 + c - 1, 2)}` : `防守 ${o.def((r - 1) * 3 + c - 1, 1)}` }}</span>
              </button>
            </template>
          </div>
        </section>
        <section class="panel cut pad met">
          <div class="score"><span class="a">{{ o.score(1) }}</span><small>你的分數　對</small><span class="b">{{ o.score(2) }}</span><small>對手</small></div>
          <div class="m"><span>你的聲量</span><div class="pp"><i v-for="n in 10" :key="n" :class="{ f: n <= o.va }" /></div><b>{{ o.va }}</b></div>
          <div class="m"><span>風向<Hint>−5～+5，雙方共用一條，正的偏你：你的格子難搶、對手的格子好搶。</Hint></span><div class="wind"><i :style="{ left: wind }" /></div><b>{{ o.w > 0 ? '+' : '' }}{{ o.w }}</b></div>
          <div class="m"><span>對手聲量</span><div class="pp foe"><i v-for="n in 10" :key="n" :class="{ f: n <= o.vb }" /></div><b>{{ o.vb }}</b></div>
          <div class="m"><span>編輯點</span><div class="pp ap"><i v-for="n in o.apMax" :key="n" :class="{ f: n <= o.ap }" /></div><b>{{ o.ap }}</b></div>
          <div class="btns">
            <ReasonButton :reason="!can ? '現在不是你的回合' : o.skillReason('s1')" @go="skill('s1')">帶風向<small>1 點</small></ReasonButton>
            <ReasonButton :reason="!can ? '現在不是你的回合' : o.skillReason('s2')" @go="skill('s2')">追擊<small>2 點</small></ReasonButton>
            <ReasonButton :pri="o.mode?.k === 'cap'" :reason="!can ? '現在不是你的回合' : o.capReason()" data-cap @go="cap">佔領{{ o.caps > 1 ? `（${o.caps} 次）` : o.caps < 1 ? '（已用）' : '' }}</ReasonButton>
            <button type="button" class="btn pri" :class="{ 'is-unavailable': !can }" :aria-disabled="!can || undefined" data-endturn @click="endTurn">結束回合<kbd>Space</kbd></button>
          </div>
          <div class="hint" aria-live="polite">{{ hint || (can ? '出牌或用技能累積聲量與風向，然後佔領一格。' : '') }}</div>
        </section>
      </div>

      <section v-if="o.end" class="panel cut bt-end-op" :class="{ lose: o.end.result === '敗' }" data-end="opinion">
        <h3>{{ o.end.result }}</h3>
        <p>{{ o.end.text }}</p>
        <div class="btns"><button type="button" class="btn pri" @click="leave">回到{{ from === '/' ? '主畫面' : '地圖' }}</button><button type="button" class="btn" @click="restart">再打一次</button></div>
      </section>

      <section class="panel cut pad">
        <p class="h">手牌（{{ o.hand.length }}／5）・牌庫 {{ o.deck.length }}・棄牌 {{ o.discard.length }}</p>
        <div class="hand">
          <button v-for="(k, i) in o.hand" :key="i + k" type="button" class="card" :class="[`t${CARDS[k].t}`, { sel: o.mode?.k === 'guard' && o.mode.idx === i, 'is-unavailable': !can || !!o.cardReason(i) }]"
            :aria-disabled="!can || !!o.cardReason(i) || undefined" :data-card="i" @click="play(i)">
            <span class="kn"><kbd>{{ i + 1 }}</kbd>{{ CARD_KIND[CARDS[k].t] }}</span><b>{{ CARDS[k].n }}</b><span class="co">{{ CARDS[k].c }}</span><small>{{ CARDS[k].d }}</small>
          </button>
          <span v-if="!o.hand.length" class="empty-note">沒有手牌。</span>
        </div>
      </section>
      <section class="panel cut pad logp">
        <p class="h">紀錄</p>
        <div class="log"><p v-for="(l, i) in o.lines.slice().reverse()" :key="o.lines.length - i" :class="l.c">{{ l.t }}</p></div>
      </section>
    </div>
  </div>
</template>

<style scoped>
.op-screen { min-height: 100vh; min-height: 100dvh; display: flex; flex-direction: column; }
.op-wrap { flex: 1; display: grid; gap: var(--space-4); padding: var(--space-4); align-content: start; min-width: 0; }
.top { display: flex; align-items: center; gap: var(--space-3) var(--space-4); flex-wrap: wrap; padding: var(--space-3) var(--space-4); }
.ttl { font-size: var(--fs-section); font-weight: var(--fw-title); }
.grow { flex: 1; }
.slots { display: flex; gap: 3px; flex-wrap: wrap; }
.slots i { font-style: normal; font-size: var(--fs-fine); font-weight: 800; padding: 2px 8px; background: var(--bg-2); color: var(--ink-3); }
.slots i.on { background: var(--a); color: var(--on-a); }
.slots i.done { color: var(--ink-2); text-decoration: line-through; }
.sel { display: inline-flex; align-items: center; gap: var(--space-2); min-width: 0; }
.sel select { font: 800 var(--fs-sm) var(--font); padding: 5px 8px; background: var(--bg-term); border: 0; box-shadow: inset 0 0 0 2px var(--line); color: var(--ink); max-width: 220px; }
.foe { display: flex; gap: var(--space-3); align-items: baseline; flex-wrap: wrap; }
.main { display: grid; grid-template-columns: minmax(0, 1.25fr) minmax(0, 1fr); gap: var(--space-4); align-items: start; }
.board { display: grid; grid-template-columns: auto repeat(3, minmax(0, 1fr)); gap: var(--space-3); }
.rl { writing-mode: vertical-rl; font-size: var(--fs-fine); color: var(--ink-3); letter-spacing: 3px; display: flex; align-items: center; justify-content: center; }
.cell { background: var(--bg-term); box-shadow: inset 0 0 0 2px var(--line); min-height: 100px; padding: var(--space-3); display: flex; flex-direction: column; gap: 2px; position: relative; text-align: left; font: inherit; color: var(--ink); border: 0; cursor: default; min-width: 0; }
.cell b { font-size: var(--fs-card); }
.cell.me { box-shadow: inset 0 0 0 3px var(--sink); background: color-mix(in srgb, var(--sink) 14%, var(--bg-term)); }
.cell.foe { box-shadow: inset 0 0 0 3px var(--hp); background: color-mix(in srgb, var(--hp) 12%, var(--bg-term)); }
.cell.tg { box-shadow: inset 0 0 0 3px var(--ok); cursor: pointer; }
.cell.foc { outline: 3px solid var(--a); outline-offset: 1px; }
.cell.sh::after { content: "設防"; position: absolute; right: 6px; bottom: 6px; font-size: var(--fs-tiny); font-weight: 900; color: var(--ap); }
.pt { position: absolute; right: 8px; top: 6px; font: 900 var(--fs-section) var(--mono); color: var(--ap); }
.pt.z { color: var(--ink-3); }
.ow, .df { font-size: var(--fs-fine); color: var(--ink-2); }
.met { display: grid; gap: var(--space-3); }
.score { display: flex; gap: var(--space-3); font: 900 var(--fs-num) var(--mono); align-items: baseline; flex-wrap: wrap; }
.score small { font: 700 var(--fs-xs) var(--font); color: var(--ink-3); }
.score .a { color: var(--sink); } .score .b { color: var(--hp); }
.m { display: grid; grid-template-columns: 84px minmax(0, 1fr) 30px; gap: var(--space-3); align-items: center; font-size: var(--fs-xs); color: var(--ink-2); }
.m b { font-family: var(--mono); text-align: right; }
.pp { display: flex; gap: 2px; }
.pp i { flex: 1; height: 10px; background: var(--bg-term); box-shadow: inset 0 0 0 1px var(--line-2); max-width: 22px; }
.pp i.f { background: var(--sink); box-shadow: none; }
.pp.foe i.f { background: var(--hp); }
.pp.ap i.f { background: var(--ep); }
.wind { height: 12px; background: linear-gradient(90deg, var(--hp), var(--bg-2) 50%, var(--sink)); position: relative; }
.wind i { position: absolute; top: -4px; width: 4px; height: 20px; background: var(--ink); transform: translateX(-2px); transition: left var(--dur); }
.btns { display: flex; gap: var(--space-2); flex-wrap: wrap; }
.btns small { font: 800 var(--fs-tiny) var(--mono); opacity: .8; }
.hint { color: var(--ink-2); font-size: var(--fs-sm); min-height: 1.5em; }
.hand { display: grid; grid-template-columns: repeat(auto-fill, minmax(150px, 1fr)); gap: var(--space-3); }
.card { font: inherit; text-align: left; min-height: 104px; background: var(--bg-2); color: var(--ink); padding: var(--space-3); cursor: pointer; display: flex; flex-direction: column; gap: 2px; position: relative; border: 0; box-shadow: inset 3px 0 0 var(--tc, var(--ink-3)); }
.card.t1 { --tc: var(--ap); } .card.t2 { --tc: var(--sink); } .card.t3 { --tc: var(--ep); }
.card.sel { box-shadow: inset 0 0 0 3px var(--ok); }
.card b { font-size: var(--fs-card); }
.card small { color: var(--ink-2); font-size: var(--fs-fine); }
.card .kn { font-size: var(--fs-tiny); color: var(--tc); font-weight: 900; display: flex; gap: var(--space-2); align-items: center; }
.co { position: absolute; right: 8px; top: 6px; font: 900 var(--fs-card) var(--mono); color: var(--ep); }
.logp { max-height: 300px; overflow: auto; }
.log p { margin: 0 0 var(--space-2); font: var(--fs-xs)/1.6 var(--mono); color: var(--ink-2); }
.log p.h { color: var(--ap); font-weight: 800; } .log p.r { color: var(--hp); } .log p.g { color: var(--ok); }
.bt-end-op { padding: var(--space-5); box-shadow: inset 4px 0 0 var(--a), inset 0 0 0 2px var(--line); display: grid; gap: var(--space-3); }
.bt-end-op.lose { box-shadow: inset 4px 0 0 var(--hp), inset 0 0 0 2px var(--line); }
.bt-end-op h3, .bt-end-op p { margin: 0; }
@media (max-width: 1000px) { .main { grid-template-columns: minmax(0, 1fr); } }
@media (max-width: 720px) {
  .op-wrap { padding: var(--space-3); gap: var(--space-3); }
  .cell { min-height: 84px; padding: var(--space-2); }
  .cell b { font-size: var(--fs-sm); }
  .pt { font-size: var(--fs-md); }
  .sel select { max-width: 150px; }
  .hand { grid-template-columns: repeat(2, minmax(0, 1fr)); }
}
</style>
