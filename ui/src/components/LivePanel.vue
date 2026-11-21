<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import Hint from './Hint.vue'
import ReasonButton from './ReasonButton.vue'
import { useGame } from '../stores/game'
import { useUi } from '../stores/ui'
import { LIVE_GOALS, LIVE_DANMAKU, liveHighlights, liveSettle, type LiveGoal } from '../data/media'

/**
 * 直播面板（MEDIA 1.2 節、mockups/overlays.html#live）：疊在現有的玩法旁邊，玩法照常進行。
 * 觀看數、熱度、這一場的直播目標（開播時就定好）、亮點、彈幕；收播時把熱度換成訂閱與打賞，存一則錄到的紀錄。
 * 戰鬥中由戰鬥畫面傳入紀錄（lines），亮點照紀錄裡的要害、過載、打倒算；不在戰鬥時是日常直播（一次表演檢定）。
 */
const props = defineProps<{ inCombat?: boolean; lines?: Array<{ t: string }>; title?: string }>()
const emit = defineEmits<{ (e: 'close'): void }>()
const g = useGame()
const ui = useUi()
const started = ref(false)
const goals = ref<LiveGoal[]>([])
const viewers = ref(0)
const tips = ref(0)
const chat = ref<Array<{ id: number; who: string; text: string }>>([])
let seq = 1
let timer: ReturnType<typeof setInterval> | null = null
const startAt = ref(0)
const dailyRoll = ref<{ die: number; total: number; dc: number } | null>(null)

/** 開播前就抽好目標（玩家看過之後才決定要不要開） */
function draw() {
  const pool = LIVE_GOALS.filter(x => (props.inCombat ? x.kind === 'combat' : x.kind === 'daily'))
  const out: LiveGoal[] = []
  while (out.length < Math.min(3, pool.length)) { const x = pool[Math.floor(Math.random() * pool.length)]; if (!out.includes(x)) out.push(x) }
  goals.value = out
}
draw()
const myLines = computed(() => (props.lines ?? []).slice(startAt.value))
const hl = computed(() => liveHighlights(myLines.value.map(l => l.t)))
const goalDone = (x: LiveGoal) => x.check(myLines.value.map(l => l.t))
const heat = computed(() => hl.value.length + goals.value.filter(goalDone).length * 3 + (dailyRoll.value ? Math.max(0, Math.floor((dailyRoll.value.total - dailyRoll.value.dc) / 3) + 2) : 0))
function start() {
  started.value = true
  startAt.value = props.lines?.length ?? 0
  viewers.value = Math.round(g.channel.subs * 0.8)
  if (!props.inCombat) {
    const die = 1 + Math.floor(Math.random() * 20), dc = 10 + Math.floor(g.channel.subs / 1000)
    dailyRoll.value = { die, total: die + 4, dc }
  }
  timer = setInterval(() => {
    viewers.value += Math.round((heat.value + 1) * (20 + Math.random() * 60))
    if (Math.random() < 0.7) {
      const pick = LIVE_DANMAKU[Math.floor(Math.random() * LIVE_DANMAKU.length)]
      chat.value.unshift({ id: seq++, ...pick })
      if (pick.text.includes('打賞')) tips.value += 20
      if (chat.value.length > 7) chat.value.pop()
    }
  }, 1400)
}
onBeforeUnmount(() => { if (timer) clearInterval(timer) })
onMounted(() => { if (!props.inCombat) return })
function stop() {
  if (timer) clearInterval(timer)
  const r = liveSettle(heat.value, viewers.value, tips.value)
  g.channel.subs += r.subs
  g.money.acc += r.tips
  g.media.records.unshift({ id: `rec${Date.now()}`, name: props.title ?? (props.inCombat ? '戰鬥直播' : '日常直播'), day: g.day, kind: props.inCombat ? '戰鬥' : '日常', recorded: true, live: true })
  g.addLog({ prose: [`你收播了。熱度 ${heat.value}，最高 ${viewers.value.toLocaleString('en-US')} 人在看。`], changes: [{ text: `訂閱 +${r.subs}`, kind: 'plus' }, { text: `打賞 +${r.tips}`, kind: 'plus' }] })
  ui.toast(`收播：訂閱 +${r.subs}，打賞 ${r.tips} 進帳戶。`)
  started.value = false
  emit('close')
}
</script>

<template>
  <section class="panel cut pad live" aria-label="直播面板" data-live>
    <div class="lh">
      <b class="onair" :class="{ on: started }">● {{ started ? 'LIVE' : '準備開播' }}</b>
      <span class="t-fine">{{ inCombat ? '戰鬥直播' : '日常直播' }}・{{ g.channel.name }}</span>
      <span class="grow" />
      <Hint title="直播">直播是疊在現有玩法上的一層：戰鬥照常進行，旁邊多這個面板。要害、過載、打倒敵人、有人只剩一口氣是亮點（熱度 +1）；達成直播目標熱度 +3。收播時熱度換成訂閱與打賞，並存一則錄到的紀錄，之後可以剪成片。戰鬥直播的風險：敵人也在看，增援來得快，敵對值的增加 ×1.5。直播中不能回退。</Hint>
      <button type="button" class="btn sm ghost" aria-label="關掉直播面板" @click="started ? stop() : emit('close')">{{ started ? '收播' : '關掉' }}</button>
    </div>
    <div class="nums">
      <div><span class="k">觀看</span><b class="mono">{{ viewers.toLocaleString('en-US') }}</b></div>
      <div><span class="k">打賞</span><b class="mono">{{ tips }}</b></div>
      <div><span class="k">熱度</span><b class="mono">{{ heat }}</b></div>
    </div>
    <div class="heat"><i :style="{ width: `${Math.min(100, heat * 6)}%` }" /></div>
    <p class="h">直播目標・開播時就定好</p>
    <div v-for="x in goals" :key="x.id" class="goal" :class="{ done: started && goalDone(x) }"><span>{{ started && goalDone(x) ? '✓' : '○' }}</span>{{ x.name }}<small>+3 熱度</small></div>
    <template v-if="started">
      <p v-if="dailyRoll" class="t-fine">表演 1d20({{ dailyRoll.die }}) + 4 = {{ dailyRoll.total }} 對 {{ dailyRoll.dc }}：{{ dailyRoll.total >= dailyRoll.dc ? '成功' : '普通' }}。</p>
      <p class="h">亮點</p>
      <div v-if="!hl.length" class="empty-note">還沒有亮點。</div>
      <div v-for="(x, i) in hl.slice(-4).reverse()" :key="i" class="hl">{{ x }}<small>+1</small></div>
      <p class="h">彈幕</p>
      <div class="chat"><p v-for="c in chat" :key="c.id"><b>{{ c.who }}</b> {{ c.text }}</p></div>
      <div v-if="inCombat" class="lockline"><span class="lk">風險</span>敵人也在看：增援來得比較快，敵對值的增加 ×1.5。</div>
      <div class="go"><button type="button" class="btn pri" @click="stop">收播</button></div>
    </template>
    <div v-else class="go">
      <button type="button" class="btn sm" @click="draw">換一組目標</button>
      <ReasonButton pri :reason="g.channel.equipment.find(e => e.cls === '串流')?.portable ? null : '串流設備不是便攜的，出門開不了播。'" @go="start">開播</ReasonButton>
    </div>
  </section>
</template>

<style scoped>
.live { display: grid; gap: var(--space-2); align-content: start; }
.lh { display: flex; align-items: center; gap: var(--space-3); flex-wrap: wrap; }
.lh .grow { flex: 1; }
.onair { color: var(--ink-3); font: 900 var(--fs-sm) var(--mono); }
.onair.on { color: var(--hp); }
.nums { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: var(--space-3); }
.nums div { display: grid; background: var(--bg-2); padding: var(--space-2) var(--space-3); }
.nums b { font-size: var(--fs-section); }
.heat { height: 8px; background: var(--bg-term); border-radius: 4px; overflow: hidden; }
.heat i { display: block; height: 100%; background: var(--a); transition: width var(--dur); }
.h { margin: var(--space-3) 0 0; }
.goal { display: flex; gap: var(--space-3); align-items: center; padding: var(--space-2) var(--space-3); background: var(--bg-2); font-size: var(--fs-sm); }
.goal small, .hl small { margin-left: auto; color: var(--ink-3); font: 800 var(--fs-fine) var(--mono); }
.goal.done { box-shadow: inset 3px 0 0 var(--ok); color: var(--ok); }
.hl { display: flex; gap: var(--space-3); font-size: var(--fs-xs); color: var(--ink-2); }
.chat { background: var(--bg-term); padding: var(--space-3); min-height: 90px; }
.chat p { margin: 0 0 var(--space-1); font-size: var(--fs-xs); color: var(--ink-2); }
.chat b { color: var(--sink); }
</style>
