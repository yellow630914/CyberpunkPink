<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import type { ScenePair, ScenePick, SceneInput } from '@engine/src/features/scene'
import type { SyncGear } from '@engine/src/core'
import StatusBar from '../components/StatusBar.vue'
import Hint from '../components/Hint.vue'
import TrackBar from '../components/TrackBar.vue'
import ScenePerson from '../components/scene/ScenePerson.vue'
import type { ChipView } from '../components/scene/ScenePerson.vue'
import SceneActions from '../components/scene/SceneActions.vue'
import SceneConfirm from '../components/scene/SceneConfirm.vue'
import SceneDebrief from '../components/scene/SceneDebrief.vue'
import { hidesIntimate, needsPick, partLabels, partNames, partState, pickMark, reasonText, signed } from '../lib/scene/sceneView'
import { isTyping } from '../lib/keys'
import { useEngine } from '../stores/engine'
import { useSettings } from '../stores/settings'
import { useUi } from '../stores/ui'

/**
 * 成人場景（全頁，UI.md 第 10 節、LEWD_SYSTEM 第 3 節）：接引擎的 features/scene（stores/engine.ts 的 scene 只轉接）。
 * 這一頁只做編排：確認框（進入或略過）、兩張參與者卡夾著體位／契合／主動權、連接、行動列、右欄每回合一句、結束後的戰報。
 * 感載、契合、主動權、預覽、能不能做與原因全是引擎給的；玩家做完一步之後呼叫對方的一步。
 * 精簡版（設定 scene_mode）不顯示部位與連接，只顯示持續效果的條數與大概數值；完整版自己選部位。
 * 所有參與者都是成年人。不畫露骨的圖與字：部位是文字標籤，「身體的私密描寫」關掉時那幾個部位的名字收起來。
 * #/scene?scene=amber|rin（示範的場景）&from=/ ；gate=0 跳過確認框；fast=1 讓對方的回合不等（自動測試用）。
 */
const e = useEngine()
const st = useSettings()
const ui = useUi()
const route = useRoute()
const router = useRouter()

const from = computed(() => (typeof route.query.from === 'string' && route.query.from !== '/scene' ? route.query.from : '/'))
const v = computed(() => e.scene.view())
const opts = computed(() => e.scene.options())
const debrief = computed(() => e.scene.debrief())
const simple = computed(() => v.value?.mode === 'simple')
const theirName = computed(() => v.value?.people.partner.name ?? '對方')
const hide = computed(() => hidesIntimate(e.scene.contentOff()))
const wait = computed(() => (route.query.fast || st.s.reduceMotion ? 0 : 450))

// ---- 確認框 ----
const entered = ref<string | null>(null)
const showGate = computed(() => !!v.value && !debrief.value && v.value.step === 0 && v.value.round === 1 && entered.value !== v.value.id && route.query.gate !== '0')
const gateTitle = computed(() => {
  const d = typeof route.query.scene === 'string' ? e.scene.demoOpening(route.query.scene) : null
  return d ?? `${theirName.value}就在眼前`
})

// ---- 進行中 ----
const playing = ref(false)
const selected = ref('dominate')

async function perform(input: SceneInput): Promise<void> {
  if (playing.value) return
  playing.value = true
  try {
    const r = await e.scene.act(input)
    picking.value = null
    pickMy.value = null
    if (r.status !== 'applied') ui.toast(r.reason ?? '現在做不了。', 'warn')
    else if (e.scene.active()) await e.scene.partnerTurn(wait.value)
  } finally {
    playing.value = false
  }
}
/** 同步按鈕的原因：全是引擎的（檔位本身的 blocks，加上行動 gear 那一列的選項 blocks，例如這回合換過了、還沒輪到） */
function gearReasons(id: string, own: readonly string[]): string[] {
  const c = opts.value?.actions.find((a) => a.id === 'gear')?.choices?.find((x) => x.id === id)
  return [...new Set([...own, ...(c?.blocks ?? [])])]
}
async function shiftGear(id: string, current: boolean, own: readonly string[]): Promise<void> {
  if (playing.value || current) return
  const why = gearReasons(id, own)
  if (why.length > 0) { ui.toast(reasonText(why), 'warn'); return }
  await perform({ kind: 'gear', gear: id as SyncGear } as SceneInput)
}
async function skip(): Promise<void> {
  if (playing.value) return
  playing.value = true
  try {
    const r = await e.scene.skip()
    if (r.status !== 'applied') ui.toast(r.reason ?? '現在略過不了。', 'warn')
  } finally {
    playing.value = false
  }
}

// ---- 選部位：技能、說話、道具要選部位與對象的部位時，照引擎宣告的選項點卡上的部位（完整版） ----
interface Picking { input: SceneInput; picks: ScenePick[]; pairs: ScenePair[] }
const picking = ref<Picking | null>(null)
const pickMy = ref<string | null>(null)

function optionFor(input: SceneInput): { picks: ScenePick[]; pairs: ScenePair[] } | null {
  const o = opts.value
  if (!o) return null
  if (input.kind === 'talk') {
    const a = o.actions.find((x) => x.id === 'talk')
    return a ? { picks: a.picks, pairs: a.pairs } : null
  }
  if (input.kind === 'skill' || input.kind === 'item') {
    const c = o.actions.find((x) => x.id === input.kind)?.choices?.find((x) => x.id === input.id)
    return c ? { picks: c.picks, pairs: c.pairs } : null
  }
  return null
}
async function choose(input: SceneInput): Promise<void> {
  if (playing.value) return
  const o = optionFor(input)
  if (o && needsPick(o)) {
    picking.value = { input, ...o }
    pickMy.value = null
    return
  }
  await perform(input)
}
function cancelPick(): void {
  picking.value = null
  pickMy.value = null
}
const pickHint = computed(() => {
  if (!picking.value) return ''
  return pickMy.value ? `再點${theirName.value}的一個部位。` : '點你自己的一個部位。'
})

const names = computed(() => (v.value ? partNames(v.value) : {}))
const labels = computed(() => partLabels(Object.keys(names.value), names.value, hide.value))
const labelOf = (id: string): string => labels.value[id] ?? id

function chipsOf(w: 'pc' | 'partner'): ChipView[] {
  const view = v.value
  if (!view) return []
  return view.people[w].parts.map((pt) => ({ id: pt.id, label: labelOf(pt.id), state: partState(pt), ...(picking.value ? pickMark(picking.value.picks, picking.value.pairs, pickMy.value, w, pt.id) : {}) }))
}
async function onPart(w: 'pc' | 'partner', id: string): Promise<void> {
  const p = picking.value
  if (!p) { ui.toast('先在行動區選技能、道具或說話，再點部位。'); return }
  const mark = pickMark(p.picks, p.pairs, pickMy.value, w, id)
  if (mark.pick === 'no') { ui.toast(mark.reason ?? '這個部位不能選。', 'warn'); return }
  if (w === 'pc') { pickMy.value = id; return }
  await perform({ ...p.input, pick: { my_part: pickMy.value!, their_part: id } } as SceneInput)
}

// ---- 體位卡：主動權在手上才點得下去，原因是引擎的 ----
const posOpen = ref(false)
const switchBlocks = computed(() => opts.value?.actions.find((a) => a.id === 'switch')?.blocks ?? [])
function togglePos(): void {
  if (switchBlocks.value.length > 0) { ui.toast(reasonText(switchBlocks.value), 'warn'); return }
  posOpen.value = !posOpen.value
}
async function switchTo(id: string, blocks: readonly string[]): Promise<void> {
  if (blocks.length > 0) { ui.toast(reasonText(blocks), 'warn'); return }
  posOpen.value = false
  await perform({ kind: 'switch', position: id })
}

// ---- 連接（手機收成一行） ----
const linksOpen = ref(false)
const whoName = (w: 'pc' | 'partner'): string => (w === 'pc' ? '你' : theirName.value)
const lineWho = (w: 'pc' | 'partner'): string => whoName(w)
const lines = computed(() => [...(v.value?.lines ?? [])].reverse())
const holderText = computed(() => (v.value ? (v.value.holder === 'pc' ? '你在帶' : `${theirName.value}在帶`) : ''))
const upperText = computed(() => {
  const u = v.value?.position.upper
  return u ? (u === 'pc' ? '你在上位' : `${theirName.value}在上位`) : '沒有上位'
})
const roleText = (w: 'pc' | 'partner'): string => {
  const u = v.value?.position.upper
  return u ? (u === w ? '上位' : '下位') : ''
}

// ---- 開場與離開 ----
const startWhy = ref('')
onMounted(async () => {
  window.addEventListener('keydown', onKey, true)
  if (!e.scene.active() && !e.scene.ended && route.query.scene !== undefined) {
    const why = e.scene.startDemo(String(route.query.scene))
    if (why) startWhy.value = why
  }
  if (e.scene.active() && (e.scene.view()?.turn ?? 'pc') === 'partner') {
    playing.value = true
    try { await e.scene.partnerTurn(wait.value) } finally { playing.value = false }
  }
})
onBeforeUnmount(() => window.removeEventListener('keydown', onKey, true))
function leave(): void {
  e.scene.clearEnded()
  void router.push(from.value)
}

// ---- 鍵盤：1～9 行動、空白鍵結束回合、Esc 取消選部位 ----
const bar = ref<InstanceType<typeof SceneActions> | null>(null)
function onKey(ev: KeyboardEvent): void {
  if (showGate.value || debrief.value || isTyping(ev.target) || ui.stack.length || ev.ctrlKey || ev.metaKey || ev.altKey) return
  if (/^[1-9]$/.test(ev.key)) {
    const a = opts.value?.actions.filter((x) => x.id !== 'gear')[Number(ev.key) - 1]
    if (a) { ev.preventDefault(); bar.value?.press(a.id) }
  } else if (ev.key === ' ') {
    ev.preventDefault()
    bar.value?.endTurn()
  } else if (ev.key === 'Escape' && picking.value) {
    ev.preventDefault()
    ev.stopPropagation()
    cancelPick()
  }
}
</script>

<template>
  <div class="scene-screen">
    <StatusBar :back="!v" title="成人場景" />

    <SceneConfirm v-if="showGate && v" :view="v" :title="gateTitle" :busy="playing" @enter="entered = v.id" @skip="skip" />

    <div v-if="v && opts" class="sc" data-scene>
      <header class="panel cut pad head">
        <b class="t-card">成人場景・第 {{ v.round }} 回合</b>
        <span v-if="v.place" class="tag">{{ v.place }}</span><span class="tag" data-nature>{{ v.nature_name }}</span>
        <div v-if="v.goal" class="goal" data-goal>
          <span class="k">目的：{{ v.goal.name }}{{ v.goal.done ? '・已達成' : '' }}</span>
          <TrackBar :value="v.goal.progress" :max="100" color="var(--ap)" :height="8" :marks="[v.goal.done_at]" />
        </div>
        <span class="grow" />
        <div class="seg" aria-label="同步檔位" data-sync>
          <span class="k">同步<Hint>同步檔位：換檔不花行動點，但每個回合只能換一次。開不了的檔會寫原因。</Hint></span>
          <button v-for="g in v.people.pc.gear.gears" :key="g.id" type="button" :class="{ on: g.current, 'is-unavailable': !g.current && gearReasons(g.id, g.blocks).length > 0 }" :title="g.current ? '現在的檔位。' : gearReasons(g.id, g.blocks).length ? reasonText(gearReasons(g.id, g.blocks)) : undefined" :data-gear="g.id" @click="shiftGear(g.id, g.current, g.blocks)">{{ g.name }}</button>
        </div>
        <span class="tag" title="還沒有開放。">直播：關<Hint>場景裡的直播還沒有開放。</Hint></span>
      </header>

      <section class="stage">
        <ScenePerson who="pc" :person="v.people.pc" :chips="chipsOf('pc')" :simple="simple" :role-text="roleText('pc')" @part="onPart('pc', $event)" />
        <div class="mid">
          <button type="button" class="panel cut pad pos" :class="{ 'is-unavailable': switchBlocks.length > 0 }" :title="switchBlocks.length ? reasonText(switchBlocks) : '點開可以換體位。'" data-position @click="togglePos">
            <span class="k">體位</span><b class="t-card" data-position-name>{{ v.position.name }}</b>
            <small>{{ upperText }}・你 ×{{ v.position.mult.pc }}・{{ theirName }} ×{{ v.position.mult.partner }}</small>
            <small v-if="v.position.text">{{ v.position.text }}</small>
          </button>
          <div v-if="posOpen" class="pospop" data-position-list>
            <button v-for="p in v.positions" :key="p.id" type="button" class="opt" :class="{ 'is-unavailable': p.blocks.length > 0 }" :title="p.blocks.length ? reasonText(p.blocks) : undefined" :data-pos="p.id" @click="switchTo(p.id, p.blocks)">{{ p.name }}</button>
          </div>
          <div class="panel cut pad meter">
            <div class="mt"><span class="k">契合<Hint>0～100，這一場的成績。刻度是評價的界線。</Hint></span><b class="mono" data-fit>{{ v.fit }}</b><span class="rate" data-rating>{{ v.rating.name }}</span></div>
            <div class="fit"><b :style="{ width: v.fit + '%' }" /><i v-for="m in v.fit_marks" :key="m" :style="{ left: m + '%' }" /></div>
          </div>
          <div class="panel cut pad meter">
            <div class="mt"><span class="k">主動權<Hint>50 以上在你手上：有主動權才能換體位。</Hint></span><b class="mono" data-init>{{ v.init }}</b><span class="rate" data-holder>{{ holderText }}</span></div>
            <div class="ini"><i :style="{ left: v.init + '%' }" /></div>
          </div>
        </div>
        <ScenePerson who="partner" :person="v.people.partner" :chips="chipsOf('partner')" :simple="simple" :role-text="roleText('partner')" @part="onPart('partner', $event)" />
      </section>

      <section class="panel cut pad links" data-links>
        <template v-if="simple">
          <p class="h" data-effects>持續效果：{{ v.effects.count }} 條<Hint>精簡版由系統挑部位、自動接線。持續效果每回合自動生效一次；數字是引擎算好的大概值。</Hint></p>
          <p v-if="v.effects.count === 0" class="empty-note">還沒有持續效果：用技能、道具或說話建立一條。</p>
          <p v-else class="t-fine">每回合約：{{ theirName }}的感載 +{{ v.effects.target_load }}、你 +{{ v.effects.my_load }}、契合 {{ signed(v.effects.fit) }}。</p>
        </template>
        <template v-else>
          <p class="h">
            <button type="button" class="lk-toggle" :aria-expanded="linksOpen" @click="linksOpen = !linksOpen">連著 {{ v.links.length }} 條</button>
            <span class="lk-long">連接・每條每回合自動生效一次</span><Hint>連接是「我的某個部位」接著「對象的某個部位」，建立之後一直持續。同一個部位換事做，舊的就斷；換體位全部重來。</Hint>
          </p>
          <div v-if="!v.links.length" class="empty-note">還沒有連接：用技能、道具或說話建立一條。</div>
          <div class="lks" :class="{ open: linksOpen }">
            <div v-for="l in v.links" :key="l.id" class="lk" :class="{ new: l.fresh }" data-link>
              <b>{{ whoName(l.by) }} {{ labelOf(l.mine) }}</b><span class="ar">{{ l.kind === 'talk' ? '↔' : '→' }}</span><b>{{ whoName(l.by === 'pc' ? 'partner' : 'pc') }} {{ labelOf(l.theirs) }}</b>
              <span class="per">{{ l.name }}・每回合：對方 +{{ l.per_round.target_load }}（約 {{ l.per_round.target_avg }}）、自己 +{{ l.per_round.my_load }}（約 {{ l.per_round.my_avg }}）、契合 {{ signed(l.per_round.fit) }}</span>
            </div>
          </div>
        </template>
      </section>

      <div v-if="picking" class="pickbar" data-pickbar role="status">
        <span>{{ pickHint }}</span><button type="button" class="btn sm" data-pick-cancel @click="cancelPick">取消</button>
      </div>

      <SceneActions ref="bar" :opts="opts" :playing="playing" :their-name="theirName" :selected="selected" @select="selected = $event" @choose="choose" @end-turn="perform({ kind: 'end_turn' })" />

      <aside class="side">
        <section class="panel cut pad log" data-lines>
          <p class="h">這一場・每回合一句</p>
          <p v-for="(l, i) in lines" :key="i" class="ln"><small>第 {{ l.round }} 回合・{{ lineWho(l.who) }}</small>{{ l.text }}</p>
          <p class="empty-note">完整的文字等你按「停下」之後一次寫。</p>
        </section>
      </aside>
    </div>

    <div v-else-if="!debrief" class="sc none" data-none>
      <section class="panel cut pad">
        <p v-if="!e.hasCharacter" class="empty-note">還沒有主角：先去建角。</p>
        <p v-else-if="startWhy" class="empty-note" data-start-why>{{ startWhy }}</p>
        <p v-else class="empty-note">現在沒有進行中的成人場景。</p>
        <div class="go left"><button type="button" class="btn sm" @click="router.push(e.hasCharacter ? '/' : '/newgame')">{{ e.hasCharacter ? '回主畫面' : '去建角' }}</button></div>
      </section>
    </div>

    <SceneDebrief v-if="debrief" :debrief="debrief" :fold="st.s.foldAdult" :leave-text="from === '/' ? '回去' : '回到剛才'" @leave="leave" />
  </div>
</template>

<style scoped>
.scene-screen { min-height: 100vh; min-height: 100dvh; display: flex; flex-direction: column; }
.sc { flex: 1; display: grid; grid-template-columns: minmax(0, 1fr) 300px; grid-template-areas: "head head" "stage side" "links side" "pick side" "acts side"; gap: var(--space-4); padding: var(--space-4); align-content: start; }
.sc > :deep(.acts) { grid-area: acts; }
.head { grid-area: head; display: flex; align-items: center; gap: var(--space-3); flex-wrap: wrap; }
.goal { display: grid; gap: 2px; min-width: 180px; }
.grow { flex: 1; }
.seg { display: inline-flex; gap: 4px; align-items: center; flex-wrap: wrap; }
.seg button { font-size: var(--fs-sm); font-weight: 800; padding: 6px 10px; background: var(--bg-2); color: var(--ink-2); border: 0; cursor: pointer; }
.seg button.on { background: var(--ink-2); color: var(--bg); }
.stage { grid-area: stage; display: grid; grid-template-columns: minmax(0, 1fr) minmax(200px, 240px) minmax(0, 1fr); gap: var(--space-4); }
.mid { display: grid; gap: var(--space-3); align-content: center; min-width: 0; }
.pos { display: grid; gap: 2px; text-align: center; width: 100%; border: 0; color: var(--ink); cursor: pointer; }
.pos small { color: var(--ink-3); font-size: var(--fs-fine); }
.pospop { display: flex; flex-wrap: wrap; gap: var(--space-2); justify-content: center; }
.opt { padding: 6px 10px; background: var(--bg-2); border: 0; cursor: pointer; color: var(--ink); font-weight: 800; }
.meter .mt { display: flex; gap: var(--space-3); align-items: baseline; flex-wrap: wrap; }
.meter .mt b { font-size: var(--fs-md); }
.rate { color: var(--ink-3); font-size: var(--fs-fine); font-weight: 800; }
.fit { height: 10px; border-radius: 5px; background: var(--bg-2); margin-top: 6px; position: relative; overflow: hidden; }
.fit b { position: absolute; inset: 0 auto 0 0; background: linear-gradient(90deg, #8E7CC3, var(--ep)); border-radius: 5px; }
.fit i { position: absolute; top: 0; bottom: 0; width: 1px; background: var(--bg); }
.ini { height: 10px; border-radius: 5px; background: linear-gradient(90deg, var(--bg-2) 0 50%, var(--bg-3) 50%); margin-top: 6px; position: relative; }
.ini::after { content: ""; position: absolute; left: 50%; top: -3px; bottom: -3px; width: 2px; background: var(--ink-3); }
.ini i { position: absolute; top: -4px; width: 6px; height: 18px; border-radius: 3px; background: var(--ink); transform: translateX(-50%); }
.links { grid-area: links; min-width: 0; }
.lk-toggle { display: none; white-space: nowrap; background: var(--bg-2); color: var(--ink); border: 0; padding: 6px 12px; font-weight: 800; cursor: pointer; }
.lks { display: grid; grid-template-columns: repeat(auto-fill, minmax(min(100%, 280px), 1fr)); gap: var(--space-3); max-width: 880px; }
.lk { display: flex; flex-wrap: wrap; gap: 4px 8px; align-items: baseline; padding: 7px 10px; background: var(--bg-2); font-size: var(--fs-sm); min-width: 0; }
.lk .ar { font: 900 var(--fs-md) var(--mono); color: var(--a); }
.lk .per { flex-basis: 100%; color: var(--ink-2); font-size: var(--fs-fine); overflow-wrap: anywhere; }
.lk.new { box-shadow: inset 3px 0 0 var(--ram); }
.pickbar { grid-area: pick; display: flex; align-items: center; gap: var(--space-3); padding: 8px 12px; background: color-mix(in srgb, var(--ap) 18%, var(--bg-2)); font-weight: 800; }
.side { grid-area: side; display: grid; gap: var(--space-4); align-content: start; min-width: 0; }
.log .ln { margin: 0; padding: 6px 0; border-bottom: 1px dashed var(--line); font-size: var(--fs-sm); line-height: 1.7; }
.log .ln small { display: block; color: var(--ink-3); font-size: var(--fs-fine); }
.none { grid-template-columns: minmax(0, 1fr); grid-template-areas: none; }
@media (max-width: 1100px) { .sc { grid-template-columns: minmax(0, 1fr); grid-template-areas: "head" "stage" "links" "pick" "acts" "side"; } }
@media (max-width: 720px) {
  .sc { padding: var(--space-3); gap: var(--space-3); }
  .stage { grid-template-columns: minmax(0, 1fr); gap: var(--space-3); }
  .stage > :nth-child(1) { order: 3; } .mid { order: 2; } .stage > :nth-child(3) { order: 1; }
  .lk-toggle { display: inline-block; }
  .lk-long { display: none; }
  .lks { display: none; }
  .lks.open { display: grid; }
}
</style>
