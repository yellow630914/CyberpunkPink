<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import Hint from '../Hint.vue'
import ReasonButton from '../ReasonButton.vue'
import { useGame } from '../../stores/game'
import { useUi } from '../../stores/ui'
import { LIVE_GOALS, LIVE_DANMAKU, liveHighlights, liveSettle, type LiveGoal } from '../../data/media'

/**
 * 戰鬥直播的小窗（MEDIA 1.2 節）：版面照內海戰鬥——頂列一個 ● LIVE 與觀看數、彈幕直接飄過戰場；
 * 直播目標、熱度、打賞收在這個浮動的小窗，可以縮成一條、拉大小、拖著標題列移動。
 * 開播前就抽好目標（看過才決定要不要開）。收播或離開戰鬥時把熱度換成訂閱與打賞。
 */
const props = defineProps<{ lines: string[]; title?: string; locked?: string | null }>()
const emit = defineEmits<{
  (e: 'chat', text: string, kind?: 'hot' | 'gift'): void
  (e: 'state', s: { on: boolean; viewers: number }): void
  (e: 'close'): void
}>()
const g = useGame()
const ui = useUi()

const started = ref(false)
const goals = ref<LiveGoal[]>([])
const viewers = ref(0)
const tips = ref(0)
const startAt = ref(0)
let timer: ReturnType<typeof setInterval> | null = null

function draw() {
  const pool = LIVE_GOALS.filter(x => x.kind === 'combat')
  const out: LiveGoal[] = []
  while (out.length < Math.min(3, pool.length)) { const x = pool[Math.floor(Math.random() * pool.length)]; if (!out.includes(x)) out.push(x) }
  goals.value = out
}
draw()
const myLines = computed(() => props.lines.slice(startAt.value))
const hl = computed(() => liveHighlights(myLines.value))
const goalDone = (x: LiveGoal) => x.check(myLines.value)
const doneN = computed(() => goals.value.filter(goalDone).length)
const heat = computed(() => hl.value.length + doneN.value * 3)
watch([started, viewers], () => emit('state', { on: started.value, viewers: viewers.value }))
// 目標剛達成：彈幕跟著起鬨
watch(doneN, (n, o) => { if (started.value && n > o) emit('chat', `直播目標達成！熱度 +3`, 'hot') })

function start() {
  started.value = true
  startAt.value = props.lines.length
  viewers.value = Math.round(g.channel.subs * 0.8)
  emit('chat', '開台了！', 'hot')
  if (mobile) min.value = true
  timer = setInterval(() => {
    viewers.value += Math.round((heat.value + 1) * (20 + Math.random() * 60))
    if (Math.random() < 0.55) {
      const pick = LIVE_DANMAKU[Math.floor(Math.random() * LIVE_DANMAKU.length)]
      const gift = pick.text.includes('打賞')
      if (gift) tips.value += 20
      emit('chat', pick.text, gift ? 'gift' : undefined)
    }
  }, 1600)
}
function stop() {
  if (!started.value) return
  if (timer) clearInterval(timer)
  timer = null
  const r = liveSettle(heat.value, viewers.value, tips.value)
  g.channel.subs += r.subs
  g.money.acc += r.tips
  g.media.records.unshift({ id: `rec${Date.now()}`, name: props.title ?? '戰鬥直播', day: g.day, kind: '戰鬥', recorded: true, live: true })
  g.addLog({ prose: [`你收播了。熱度 ${heat.value}，最高 ${viewers.value.toLocaleString('en-US')} 人在看。`], changes: [{ text: `訂閱 +${r.subs}`, kind: 'plus' }, { text: `打賞 +${r.tips}`, kind: 'plus' }] })
  ui.toast(`收播：訂閱 +${r.subs}，打賞 ${r.tips} 進帳戶。`)
  started.value = false
  emit('close')
}
onBeforeUnmount(() => { if (timer) clearInterval(timer) })
defineExpose({ stop, started })

// ---- 小窗：縮成一條／展開、拉大小（右下角）、拖標題列移動 ----
const mobile = typeof window !== 'undefined' && window.matchMedia?.('(max-width: 760px)').matches
const min = ref(false)
const pos = ref<{ x: number; y: number } | null>(null)
let drag: { dx: number; dy: number } | null = null
const box = ref<HTMLElement | null>(null)
function down(e: PointerEvent) {
  if (mobile || (e.target as HTMLElement).closest('button')) return
  const r = box.value!.getBoundingClientRect()
  drag = { dx: e.clientX - r.left, dy: e.clientY - r.top }
  ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
}
function move(e: PointerEvent) {
  if (!drag || !box.value) return
  const w = box.value.offsetWidth, h = box.value.offsetHeight
  pos.value = { x: Math.max(0, Math.min(window.innerWidth - w, e.clientX - drag.dx)), y: Math.max(0, Math.min(window.innerHeight - h, e.clientY - drag.dy)) }
}
function up() { drag = null }
const style = computed(() => (pos.value ? { left: `${pos.value.x}px`, top: `${pos.value.y}px`, right: 'auto', bottom: 'auto' } : {}))
</script>

<template>
  <section ref="box" class="lw" :class="{ min, on: started }" :style="style" aria-label="直播小窗" data-live-window>
    <header class="lw-bar" @pointerdown="down" @pointermove="move" @pointerup="up" @pointercancel="up">
      <b class="onair mono">● {{ started ? 'LIVE' : '準備開播' }}</b>
      <span v-if="started" class="mono n">{{ viewers.toLocaleString('en-US') }}</span>
      <span class="mono n">目標 {{ started ? doneN : 0 }}/{{ goals.length }}</span>
      <span v-if="started" class="mono n hot">熱度 {{ heat }}</span>
      <span class="grow" />
      <button type="button" class="ic" :aria-label="min ? '展開直播小窗' : '縮小直播小窗'" :aria-expanded="!min" @click="min = !min">{{ min ? '▢' : '—' }}</button>
      <button v-if="!started" type="button" class="ic" aria-label="關掉直播小窗" @click="emit('close')">✕</button>
    </header>
    <div v-if="!min" class="body">
      <p class="h">直播目標・開播時就定好<Hint title="戰鬥直播">彈幕直接飄過戰場，戰鬥照常進行。要害、過載、打倒敵人是亮點（熱度 +1）；達成直播目標熱度 +3。收播（或打完離開）時熱度換成訂閱與打賞，並存一則錄到的紀錄，之後可以剪成片。風險：敵人也在看，增援來得快，敵對值的增加 ×1.5；直播中不能重新開始。小窗可以縮成一條、拖標題列移動、拉右下角改大小。</Hint></p>
      <div v-for="x in goals" :key="x.id" class="goal" :class="{ done: started && goalDone(x) }"><span>{{ started && goalDone(x) ? '✓' : '○' }}</span>{{ x.name }}<small>+3</small></div>
      <template v-if="started">
        <div class="heat"><i :style="{ width: `${Math.min(100, heat * 6)}%` }" /></div>
        <div class="nums"><span>亮點 <b class="mono">{{ hl.length }}</b></span><span>打賞 <b class="mono">{{ tips }}</b></span></div>
        <div class="go"><button type="button" class="btn sm pri" @click="stop">收播</button></div>
      </template>
      <div v-else class="go">
        <button type="button" class="btn sm" @click="draw">換一組目標</button>
        <ReasonButton pri :reason="locked ?? (g.channel.equipment.find(e => e.cls === '串流')?.portable ? null : '串流設備不是便攜的，出門開不了播。')" @go="start">開播</ReasonButton>
      </div>
    </div>
  </section>
</template>

<style scoped>
.lw { position: fixed; right: 16px; bottom: 16px; z-index: 40; width: 300px; min-width: 220px; max-width: min(560px, calc(100vw - 32px)); max-height: calc(100vh - 32px); resize: both; overflow: hidden;
  background: color-mix(in srgb, var(--bg-1) 92%, transparent); box-shadow: 0 0 0 2px var(--line), 0 8px 24px rgb(0 0 0 / .45); backdrop-filter: blur(4px); display: flex; flex-direction: column; }
.lw.on { box-shadow: 0 0 0 2px var(--hp), 0 8px 24px rgb(0 0 0 / .45); }
.lw.min { resize: none; height: auto !important; width: auto !important; min-width: 0; }
.lw-bar { flex: none; display: flex; align-items: center; gap: var(--space-2); padding: var(--space-2) var(--space-3); background: var(--bg-2); cursor: move; user-select: none; touch-action: none; flex-wrap: wrap; }
.onair { color: var(--ink-3); font-weight: 900; font-size: var(--fs-xs); }
.on .onair { color: var(--hp); }
.n { font-size: var(--fs-fine); color: var(--ink-2); font-weight: 800; }
.n.hot { color: var(--a); }
.grow { flex: 1; }
.ic { width: 28px; height: 28px; display: grid; place-items: center; background: var(--bg-3); color: var(--ink); border: 0; cursor: pointer; font: 900 var(--fs-xs) var(--mono); }
.ic:hover, .ic:focus-visible { background: var(--a); color: var(--on-a); }
.body { flex: 1; min-height: 0; overflow: auto; display: grid; gap: var(--space-2); padding: var(--space-3); align-content: start; }
.h { margin: 0; display: flex; align-items: center; gap: var(--space-2); font-size: var(--fs-xs); color: var(--ink-2); }
.goal { display: flex; gap: var(--space-2); align-items: center; padding: var(--space-1) var(--space-2); background: var(--bg-2); font-size: var(--fs-xs); }
.goal small { margin-left: auto; color: var(--ink-3); font: 800 var(--fs-fine) var(--mono); }
.goal.done { box-shadow: inset 3px 0 0 var(--ok); color: var(--ok); }
.heat { height: 6px; background: var(--bg-term); border-radius: 3px; overflow: hidden; }
.heat i { display: block; height: 100%; background: var(--a); transition: width var(--dur); }
.nums { display: flex; gap: var(--space-4); font-size: var(--fs-xs); color: var(--ink-2); }
.go { display: flex; gap: var(--space-2); justify-content: flex-end; flex-wrap: wrap; margin-top: var(--space-1); }
@media (max-width: 760px) {
  .lw { left: 12px; right: 12px; bottom: 12px; width: auto; max-width: none; resize: none; max-height: 50vh; }
  .lw.min { left: auto; }
  .lw-bar { cursor: default; }
}
</style>
