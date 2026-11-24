<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import ReasonButton from '../ReasonButton.vue'
import EventBody from '../EventBody.vue'
import SceneGate from './SceneGate.vue'
import { DEFEAT_NAME, TIER_NAME, asking, choiceGroups, consequences, defeatStory } from '../../lib/afterBattleView'
import type { EngineLogEntry } from '../../lib/engineView'
import { defeatNetRows } from '../../lib/netView'
import { useEngine } from '../../stores/engine'

/**
 * 戰敗事件（UI.md 4.1 節；COMBAT_SYSTEM 8.3、8.4 節；dev/work/M2-ui-battle-after.md）：全隊倒下或投降時取代戰鬥畫面。
 * 抬頭（在哪裡、誰贏了、哪一件事件）、開頭的敘事（橘色左線）；引擎先問要不要看時兩個按鈕；事件演的時候用事件視窗的內容嵌在面板裡；
 * 事件做完之後才亮「接受結果」（灰的時候寫引擎的原因）；「重來這場戰鬥」「回到這個階段開始時」一直在；
 * 別的功能多給的選項（被贖回）照引擎回的列出來（名字、說明、選不了的原因）。後果兩格全是引擎 defeatView 的欄位。
 * 這裡不算接受之後會怎樣、不判斷能不能做：一切讀 store 的 defeatFlow。
 * 事件結束或選項選完要離開、重來、回到階段時，發 leave、retry、stage 給戰鬥畫面（它管紀錄與換頁）。
 */
defineProps<{ /** 戰鬥畫面回報的原因（重來、回到階段被擋下時） */ note?: string }>()
const emit = defineEmits<{ (e: 'leave'): void; (e: 'retry'): void; (e: 'stage'): void }>()
const engine = useEngine()
const hint = ref('')
const evResult = ref<EngineLogEntry | null>(null)

const v = computed(() => engine.defeatFlow.view())
const groups = computed(() => (v.value ? choiceGroups(v.value) : null))
const story = computed(() => defeatStory(engine.state.reports))
const cons = computed(() => (v.value ? consequences(v.value, engine.defeatFlow.commission()) : null))
const place = computed(() => engine.placeName(engine.state.location))
/** 內海的戰敗多顯示被定位、被扣線（引擎的 defeatView；現實是空的） */
const netRows = computed(() => (v.value ? defeatNetRows(v.value) : []))
const winner = computed(() => {
  const f = engine.defeat?.faction
  return f ? engine.contentName('faction', f) ?? f : '對方'
})
const accept = computed(() => groups.value?.final.find((c) => c.id === 'accept'))
const retryBtn = computed(() => groups.value?.final.find((c) => c.id === 'retry'))
const stageBtn = computed(() => groups.value?.final.find((c) => c.id === 'stage'))
/** 事件的內容（演的時候與演完的結果）要不要放：不演（只列結果）時不放 */
const showEvent = computed(() => !!v.value && !v.value.skipped && v.value.step !== 'ask')
const showStory = computed(() => !!story.value && v.value?.step !== 'playing')

onMounted(() => engine.hostEvent(true))
onBeforeUnmount(() => engine.hostEvent(false))

function say(why: string | null): boolean { hint.value = why ?? ''; return why === null }
const watchIt = (): void => void say(engine.defeatFlow.watch())
const skipIt = (): void => void say(engine.defeatFlow.skip())
function choose(id: string): void { if (say(engine.defeatFlow.choose(id))) emit('leave') }
function acceptIt(): void { if (say(engine.defeatFlow.accept())) emit('leave') }
</script>

<template>
  <section v-if="v && groups && cons" class="panel cut bt-end lose da" data-defeat :data-step="v.step">
    <header class="da-head">
      <h3>{{ DEFEAT_NAME[v.outcome] ?? v.outcome }}</h3>
      <span v-if="place" class="tag" data-defeat-place>{{ place }}</span>
      <span class="tag" data-defeat-winner>{{ winner }}得勝</span>
      <span class="tag hot" data-defeat-event>{{ v.event.name }}</span>
      <span v-if="v.event.tier" class="tag" data-defeat-tier>{{ TIER_NAME[v.event.tier] ?? v.event.tier }}</span>
      <span v-if="v.event.adult" class="tag warn">成人向</span>
    </header>

    <div class="da-main">
      <div class="da-left">
        <p v-if="showStory" class="story" data-defeat-story>{{ story }}</p>

        <section v-if="asking(v)" class="da-ask" data-defeat-ask>
          <b class="h">要看戰敗事件嗎？</b>
          <div class="bt-btns">
            <ReasonButton v-for="c in groups.ask" :key="c.id" :reason="c.why" :pri="c.id === 'watch'" :data-defeat-choice="c.id" @go="c.id === 'watch' ? watchIt() : skipIt()">{{ c.name }}</ReasonButton>
          </div>
          <p v-for="c in groups.ask.filter((x) => x.why)" :key="c.id" class="t-fine why" :data-why="c.id">{{ c.name }}：{{ c.why }}</p>
        </section>

        <section v-if="showEvent" class="da-event" data-defeat-event-body>
          <EventBody v-model:result="evResult" />
        </section>
        <SceneGate />

        <section v-if="groups.extra.length" class="da-extra" data-defeat-extra>
          <b class="h">別的辦法</b>
          <div class="extras">
            <div v-for="c in groups.extra" :key="c.id" class="extra" :class="{ 'is-unavailable': !c.can }" :data-defeat-option="c.id">
              <b>{{ c.name }}</b>
              <small v-if="c.desc">{{ c.desc }}</small>
              <small v-if="c.why" class="why" data-defeat-option-why>{{ c.why }}</small>
              <ReasonButton sm :reason="c.why" @go="choose(c.id)">{{ c.name }}</ReasonButton>
            </div>
          </div>
        </section>
      </div>

      <div class="da-right" data-defeat-consequences>
        <section class="cell" data-cell="now">
          <b class="h">{{ cons.now.title }}</b>
          <dl class="rows"><template v-for="r in [...cons.now.rows, ...netRows]" :key="r.k + r.v"><dt>{{ r.k }}</dt><dd :class="r.tone">{{ r.v }}</dd></template></dl>
          <template v-if="cons.now.lines.length">
            <small class="t-fine">接受的話會發生</small>
            <ul class="lines" data-defeat-lines><li v-for="(l, i) in cons.now.lines" :key="i">{{ l }}</li></ul>
          </template>
        </section>
        <section class="cell" data-cell="kept">
          <b class="h">{{ cons.kept.title }}</b>
          <dl class="rows"><template v-for="r in cons.kept.rows" :key="r.k"><dt>{{ r.k }}</dt><dd :class="r.tone">{{ r.v }}</dd></template></dl>
        </section>
      </div>
    </div>

    <div class="da-final" data-defeat-final>
      <div class="bt-btns">
        <ReasonButton pri :reason="accept?.why" data-defeat-accept @go="acceptIt">{{ accept?.name ?? '接受結果' }}</ReasonButton>
        <button v-if="retryBtn" type="button" class="btn" data-defeat-retry @click="emit('retry')">{{ retryBtn.name }}</button>
        <button v-if="stageBtn" type="button" class="btn" data-defeat-stage @click="emit('stage')">{{ stageBtn.name }}</button>
      </div>
      <p v-if="accept?.why" class="t-fine why" data-accept-why>{{ accept.why }}</p>
      <div class="bt-hint" aria-live="polite" data-defeat-hint>{{ hint || note }}</div>
    </div>
  </section>
</template>

<style scoped>
.da { min-width: 0; }
.da-head { display: flex; align-items: center; gap: var(--space-3); flex-wrap: wrap; }
.da-main { display: grid; grid-template-columns: minmax(0, 1.5fr) minmax(0, 1fr); gap: var(--space-5); align-items: start; }
.da-left, .da-right { display: grid; gap: var(--space-4); min-width: 0; }
.story { margin: 0; padding: var(--space-3) var(--space-4); border-left: 3px solid var(--warn); background: var(--bg-1); }
.da-ask, .da-extra { display: grid; gap: var(--space-3); }
.da-event { padding: var(--space-4); background: var(--bg-1); box-shadow: inset 3px 0 0 var(--warn); min-width: 0; }
.h { font-size: var(--fs-label); color: var(--ink-3); letter-spacing: 1px; }
.why { color: var(--warn); margin: 0; overflow-wrap: anywhere; }
.extras { display: grid; grid-template-columns: repeat(auto-fit, minmax(min(100%, 260px), 1fr)); gap: var(--space-3); }
.extra { display: grid; gap: var(--space-2); padding: var(--space-4); background: var(--bg-2); box-shadow: inset 3px 0 0 var(--line-2); min-width: 0; align-content: start; justify-items: start; }
.extra small { color: var(--ink-3); overflow-wrap: anywhere; }
.extra small.why { color: var(--warn); font-weight: 700; }
.cell { display: grid; gap: var(--space-3); padding: var(--space-4); background: var(--bg-2); min-width: 0; }
.rows { display: grid; grid-template-columns: max-content minmax(0, 1fr); gap: var(--space-2) var(--space-4); margin: 0; }
.rows dt { color: var(--ink-3); font-size: var(--fs-sm); }
.rows dd { margin: 0; font-weight: 700; overflow-wrap: anywhere; }
.rows dd.bad { color: var(--hp); }
.rows dd.ok { color: var(--ok); }
.lines { margin: 0; padding-left: 1.4em; display: grid; gap: var(--space-2); font-size: var(--fs-sm); }
.da-final { display: grid; gap: var(--space-2); }
/* 手機：面板直向排，三選一固定在底部 */
@media (max-width: 720px) {
  .da-main { grid-template-columns: minmax(0, 1fr); gap: var(--space-4); }
  .da-final { position: sticky; bottom: 0; z-index: 2; padding: var(--space-3) 0; background: var(--bg); box-shadow: 0 -2px 0 var(--line); }
  .da-final .bt-btns { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); }
  .da-final .btn { min-height: 44px; padding-inline: var(--space-2); font-size: var(--fs-xs); white-space: normal; line-height: 1.25; }
}
</style>
