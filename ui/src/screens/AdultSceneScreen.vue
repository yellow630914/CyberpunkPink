<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import type { PersonView, ScenePair, ScenePick, SceneInput } from '@engine/src/features/scene'
import type { SyncGear } from '@engine/src/core'
import StatusBar from '../components/StatusBar.vue'
import Hint from '../components/Hint.vue'
import TrackBar from '../components/TrackBar.vue'
import ScenePerson from '../components/scene/ScenePerson.vue'
import type { ChipView } from '../components/scene/ScenePerson.vue'
import SceneActions from '../components/scene/SceneActions.vue'
import SceneCircles from '../components/scene/SceneCircles.vue'
import SceneConfirm from '../components/scene/SceneConfirm.vue'
import SceneDebrief from '../components/scene/SceneDebrief.vue'
import { hidesIntimate, isGroup, isSolo, needsPick, othersOf, partLabels, partNames, partState, pickMark, reasonText, signed } from '../lib/scene/sceneView'
import { isTyping } from '../lib/keys'
import { useEngine } from '../stores/engine'
import { useSettings } from '../stores/settings'
import { useUi } from '../stores/ui'

/**
 * 成人場景（全頁，UI.md 第 10 節、LEWD_SYSTEM 第 3 節）：接引擎的 Game.sceneBegin／sceneStep／sceneFinish 與 features/scene（stores/engine.ts 的 scene 只轉接）。
 * 這一頁只做編排：確認框（引擎給的摘要；進入或略過）、參與者卡（一對一兩張、多人一圈三四張、單人一張）夾著體位／契合／主動權或節奏、別的圈一行字、連接、行動列、右欄每回合一句、結束後的戰報。
 * 感載、契合、主動權、預覽、能不能做與原因、輪到誰、誰有主動權、確認框要不要出來全是引擎給的；玩家做完一步之後呼叫對方的一步。
 * 精簡版（設定 scene_mode）不顯示部位與連接，只顯示持續效果的條數與大概數值；完整版自己選部位。內海的場景（layer 是 net）套內海皮、卡片上的部位來自化身。
 * 所有參與者都是成年人。不畫露骨的圖與字：部位是文字標籤，「身體的私密描寫」關掉時那幾個部位的名字收起來。
 * #/scene?scene=amber|rin|trio（示範的場景）&from=/ ；solo=1 在住處獨處（單人）；gate=0 跳過確認框；fast=1 讓對方的回合不等（自動測試用）。
 */
const e = useEngine()
const st = useSettings()
const ui = useUi()
const route = useRoute()
const router = useRouter()

const from = computed(() => (typeof route.query.from === 'string' && route.query.from !== '/scene' ? route.query.from : '/'))
const v = computed(() => e.scene.view())
const debrief = computed(() => e.scene.debrief())
const simple = computed(() => v.value?.mode === 'simple')
const solo = computed(() => !!v.value && isSolo(v.value))
const group = computed(() => !!v.value && isGroup(v.value))
const others = computed<PersonView[]>(() => (v.value ? othersOf(v.value) : []))
const pc = computed<PersonView | null>(() => v.value?.seats[0] ?? null)
const theirName = computed(() => (others.value.length > 0 ? others.value.map((x) => x.name).join('、') : '對方'))
/** 行動列與預覽裡稱呼對象的字：多人時指定了對象就是他，沒指定就是「對象」（引擎挑的那一個預覽時寫對象） */
const addressee = computed(() => (group.value ? (target.value ? nameOf(target.value) : '對象') : theirName.value))
const hide = computed(() => hidesIntimate(e.scene.contentOff()))
const wait = computed(() => (route.query.fast || st.s.reduceMotion ? 0 : 450))
const nameOf = (id: string): string => (id === pc.value?.id ? '你' : e.state.actors[id]?.name ?? id)
const aiLive = computed(() => e.scene.route() !== 'pure')
const net = computed(() => v.value?.layer === 'net')

// ---- 確認框：引擎說這一場還能略過（還沒有任何行動）而且玩家還沒按「進入」才出來 ----
const entered = ref<string | null>(null)
const gate = computed(() => e.scene.gate())
const showGate = computed(() => !!v.value && !debrief.value && e.scene.skipBlock() === null && entered.value !== v.value.id && route.query.gate !== '0')
const gateTitle = computed(() => {
  const d = typeof route.query.scene === 'string' ? e.scene.demoOpening(route.query.scene) : null
  return d ?? (solo.value ? '你想一個人待一會' : `${theirName.value}就在眼前`)
})

// ---- 進行中 ----
const playing = ref(false)
const selected = ref('dominate')
/** 指定的行動對象（角色的 id）；null 是讓引擎挑 */
const target = ref<string | null>(null)
/** 行動一次列出來：多人時照指定的對象算每個行動的原因與部位（引擎的 sceneOptions 收 target） */
const opts = computed(() => e.scene.options(target.value))
watch(() => v.value?.id, () => { target.value = null })
watch(() => others.value.map((x) => x.id + x.out).join(), () => { if (target.value && !others.value.some((x) => x.id === target.value && !x.out)) target.value = null })
const TARGETED = new Set(['dominate', 'yield', 'tease', 'skill', 'item', 'talk', 'once'])
const withTarget = (input: SceneInput): SceneInput => (target.value && TARGETED.has(input.kind) ? ({ ...input, target: target.value } as SceneInput) : input)
/** 指定對象之後選中的行動的預覽與原因：引擎 sceneView(selected) 的 selected */
const focus = computed(() => {
  if (!target.value || !['dominate', 'yield', 'tease'].includes(selected.value)) return null
  const s = e.scene.view(withTarget({ kind: selected.value } as SceneInput))?.selected
  return s ? { preview: s.preview, blocks: s.blocks } : null
})

function toastNotices(r: { notices?: string[] }): void {
  for (const n of r.notices ?? []) ui.toast(n)
}
async function perform(input: SceneInput): Promise<void> {
  if (playing.value) return
  playing.value = true
  try {
    const r = await e.scene.act(withTarget(input))
    picking.value = null
    pickMy.value = null
    toastNotices(r)
    if (r.status !== 'applied') ui.toast(r.reason ?? '現在做不了。', 'warn')
    else await catchUp()
  } finally {
    playing.value = false
  }
}
/** 輪到別人的時候一步一步走完（引擎說輪到誰就看誰，畫面不自己數第幾步） */
async function catchUp(): Promise<void> {
  const t = e.scene.turn()
  if (t && t.turn !== t.pc) await e.scene.partnerTurn(wait.value)
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
async function skip(direction: string): Promise<void> {
  if (playing.value) return
  playing.value = true
  try {
    const r = await e.scene.skip(direction)
    toastNotices(r)
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
  return pickMy.value ? (group.value ? '再點在場的一個人的一個部位（點到誰就作用在誰）。' : `再點${theirName.value}的一個部位。`) : '點你自己的一個部位。'
})

const names = computed(() => (v.value ? partNames(v.value) : {}))
const labels = computed(() => partLabels(Object.keys(names.value), names.value, hide.value))
const labelOf = (id: string): string => labels.value[id] ?? id

function chipsOf(who: 'pc' | 'partner', person: PersonView | null): ChipView[] {
  if (!person) return []
  return person.parts.map((pt) => ({ id: pt.id, label: labelOf(pt.id), state: partState(pt), ...(picking.value ? pickMark(picking.value.picks, picking.value.pairs, pickMy.value, who, pt.id) : {}) }))
}
async function onPart(who: 'pc' | 'partner', person: PersonView, id: string): Promise<void> {
  const p = picking.value
  if (!p) { ui.toast('先在行動區選技能、道具或說話，再點部位。'); return }
  const mark = pickMark(p.picks, p.pairs, pickMy.value, who, id)
  if (mark.pick === 'no') { ui.toast(mark.reason ?? '這個部位不能選。', 'warn'); return }
  if (who === 'pc') { pickMy.value = id; return }
  // 多人：點到哪一個人的部位，行動就作用在他身上（引擎驗過才算）
  if (group.value) target.value = person.id
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
const lines = computed(() => [...e.scene.lines()].reverse())
const holderText = computed(() => (v.value ? (v.value.holder === 'pc' ? '你在帶' : `${theirName.value}在帶`) : ''))
/** 在上位的人（引擎的 PersonView.upper；多人時可能有幾個） */
const upperText = computed(() => {
  const up = (v.value?.seats ?? []).filter((x) => x.upper)
  return up.length > 0 ? `${up.map((x) => (x.id === pc.value?.id ? '你' : x.name)).join('、')}在上位` : '沒有上位'
})
const roleText = (p: PersonView): string => (p.role ? (p.upper ? '上位' : '下位') : '')
const multText = computed(() => {
  const m = v.value?.position.mult
  const seats = v.value?.seats ?? []
  if (!m || solo.value || group.value || seats.length < 2) return ''
  return `・你 ×${m[seats[0]!.id]}・${theirName.value} ×${m[seats[1]!.id]}`
})

// ---- 開場與離開 ----
const startWhy = ref('')
onMounted(async () => {
  window.addEventListener('keydown', onKey, true)
  if (!e.scene.active() && !e.scene.ended && (route.query.scene !== undefined || route.query.solo !== undefined)) {
    const why = route.query.solo !== undefined ? await e.scene.soloAtHome() : await e.scene.startDemo(String(route.query.scene))
    if (why) startWhy.value = why
  }
  if (e.scene.active()) {
    playing.value = true
    try { await catchUp() } finally { playing.value = false }
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
  <div class="scene-screen" :data-layer="v?.layer ?? 'meat'" :data-kind="v?.kind ?? ''">
    <StatusBar :back="!v" title="成人場景" />

    <SceneConfirm v-if="showGate && v" :view="v" :summary="gate" :title="gateTitle" :busy="playing" :ai-live="aiLive" @enter="entered = v.id" @skip="skip" />

    <div v-if="v && opts && pc" class="sc" data-scene>
      <header class="panel cut pad head">
        <b class="t-card">成人場景・第 {{ v.round }} 回合</b>
        <span v-if="v.place" class="tag">{{ v.place }}</span><span class="tag" data-nature>{{ v.nature_name }}</span>
        <span v-if="net" class="tag" data-net>內海</span>
        <span v-if="solo" class="tag" data-solo>單人</span><span v-if="solo" class="tag" data-audience>{{ v.audience ? '有人在看' : '沒有人在看' }}</span>
        <span v-if="group" class="tag" data-group>{{ others.length + 1 }} 人一圈</span>
        <div v-if="v.goal" class="goal" data-goal>
          <span class="k">目的：{{ v.goal.name }}{{ v.goal.done ? '・已達成' : '' }}</span>
          <TrackBar :value="v.goal.progress" :max="100" color="var(--ap)" :height="8" :marks="[v.goal.done_at]" />
        </div>
        <span class="grow" />
        <div class="seg" aria-label="同步檔位" data-sync>
          <span class="k">同步<Hint>同步檔位：換檔不花行動點，但每個回合只能換一次。開不了的檔會寫原因。</Hint></span>
          <button v-for="g in pc.gear.gears" :key="g.id" type="button" :class="{ on: g.current, 'is-unavailable': !g.current && gearReasons(g.id, g.blocks).length > 0 }" :title="g.current ? '現在的檔位。' : gearReasons(g.id, g.blocks).length ? reasonText(gearReasons(g.id, g.blocks)) : undefined" :data-gear="g.id" @click="shiftGear(g.id, g.current, g.blocks)">{{ g.name }}</button>
        </div>
        <span class="tag" title="還沒有開放。">直播：關<Hint>場景裡的直播還沒有開放。</Hint></span>
      </header>

      <section class="stage" :class="{ solo, group }">
        <ScenePerson who="pc" :person="pc" :chips="chipsOf('pc', pc)" :simple="simple" :role-text="solo ? '' : roleText(pc)" @part="onPart('pc', pc, $event)" />
        <div class="mid">
          <button type="button" class="panel cut pad pos" :class="{ 'is-unavailable': switchBlocks.length > 0 }" :title="switchBlocks.length ? reasonText(switchBlocks) : solo ? '點開可以換姿勢。' : '點開可以換體位。'" data-position @click="togglePos">
            <span class="k">{{ solo ? '姿勢' : '體位' }}</span><b class="t-card" data-position-name>{{ v.position.name }}</b>
            <small v-if="!solo">{{ upperText }}{{ multText }}</small>
            <small v-if="v.position.text">{{ v.position.text }}</small>
          </button>
          <div v-if="posOpen" class="pospop" data-position-list>
            <button v-for="p in v.positions" :key="p.id" type="button" class="opt" :class="{ 'is-unavailable': p.blocks.length > 0 }" :title="p.blocks.length ? reasonText(p.blocks) : undefined" :data-pos="p.id" @click="switchTo(p.id, p.blocks)">{{ p.name }}</button>
          </div>
          <div v-if="!group" class="panel cut pad meter">
            <div class="mt">
              <span class="k">{{ solo ? '節奏' : '契合' }}<Hint>{{ solo ? '0～100，單人的成績：節奏掉到太低就沒了興致。刻度是評價的界線。' : '0～100，這一場的成績。刻度是評價的界線。' }}</Hint></span>
              <b class="mono" :data-fit="solo ? undefined : ''" :data-pace="solo ? '' : undefined">{{ solo ? v.pace : v.fit }}</b><span class="rate" data-rating>{{ v.rating.name }}</span>
            </div>
            <div class="fit"><b :style="{ width: (solo ? v.pace ?? 0 : v.fit) + '%' }" /><i v-for="m in v.fit_marks" :key="m" :style="{ left: m + '%' }" /></div>
          </div>
          <div v-if="!solo && !group" class="panel cut pad meter">
            <div class="mt"><span class="k">主動權<Hint>50 以上在你手上：有主動權才能換體位。</Hint></span><b class="mono" data-init>{{ v.init }}</b><span class="rate" data-holder>{{ holderText }}</span></div>
            <div class="ini"><i :style="{ left: v.init + '%' }" /></div>
          </div>
        </div>
        <div v-if="!solo" class="others">
          <ScenePerson
            v-for="x in others" :key="x.id" who="partner" :person="x" :chips="chipsOf('partner', x)" :simple="simple" :role-text="roleText(x)"
            :pair="group ? v.pairs[x.id] : undefined" :marks="v.fit_marks" :picked="target === x.id" @part="onPart('partner', x, $event)" @pick="target = target === x.id ? null : x.id"
          />
        </div>
      </section>

      <SceneCircles :circles="v.circles" :name-of="nameOf" :rating-of="e.scene.rating" />

      <section class="panel cut pad links" data-links>
        <template v-if="simple">
          <p class="h" data-effects>持續效果：{{ v.effects.count }} 條<Hint>精簡版由系統挑部位、自動接線。持續效果每回合自動生效一次；數字是引擎算好的大概值。</Hint></p>
          <p v-if="v.effects.count === 0" class="empty-note">還沒有持續效果：用技能、道具或說話建立一條。</p>
          <p v-else class="t-fine">每回合約：{{ solo ? '自己' : `${theirName}的感載 +${v.effects.target_load}、你` }} +{{ v.effects.my_load }}、{{ solo ? '節奏' : '契合' }} {{ signed(v.effects.fit) }}。</p>
        </template>
        <template v-else>
          <p class="h">
            <button type="button" class="lk-toggle" :aria-expanded="linksOpen" @click="linksOpen = !linksOpen">連著 {{ v.links.length }} 條</button>
            <span class="lk-long">連接・每條每回合自動生效一次</span><Hint>連接是「我的某個部位」接著「對象的某個部位」，建立之後一直持續。同一個部位換事做，舊的就斷；換體位全部重來。</Hint>
          </p>
          <div v-if="!v.links.length" class="empty-note">還沒有連接：用技能、道具或說話建立一條。</div>
          <div class="lks" :class="{ open: linksOpen }">
            <div v-for="l in v.links" :key="l.id" class="lk" :class="{ new: l.fresh }" data-link>
              <b>{{ nameOf(l.by_id) }} {{ labelOf(l.mine) }}</b><span class="ar">{{ l.kind === 'talk' ? '↔' : '→' }}</span><b>{{ nameOf(l.to_id) }} {{ labelOf(l.theirs) }}</b>
              <span class="per">{{ l.name }}・每回合：{{ solo ? '' : `對方 +${l.per_round.target_load}（約 ${l.per_round.target_avg}）、` }}自己 +{{ l.per_round.my_load }}（約 {{ l.per_round.my_avg }}）、{{ solo ? '節奏' : '契合' }} {{ signed(l.per_round.fit) }}</span>
            </div>
          </div>
        </template>
      </section>

      <div v-if="picking" class="pickbar" data-pickbar role="status">
        <span>{{ pickHint }}</span><button type="button" class="btn sm" data-pick-cancel @click="cancelPick">取消</button>
      </div>

      <SceneActions ref="bar" :opts="opts" :playing="playing" :their-name="addressee" :selected="selected" :target="target" :focus="focus" @select="selected = $event" @choose="choose" @target="target = $event" @end-turn="perform({ kind: 'end_turn' })" />

      <aside class="side">
        <section class="panel cut pad log" data-lines>
          <p class="h">這一場・每回合一句</p>
          <p v-for="(l, i) in lines" :key="i" class="ln"><small>第 {{ l.round }} 回合・{{ l.name }}</small>{{ l.text }}</p>
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
.sc { flex: 1; display: grid; grid-template-columns: minmax(0, 1fr) 300px; grid-template-areas: "head head" "stage side" "circles side" "links side" "pick side" "acts side"; gap: var(--space-4); padding: var(--space-4); align-content: start; }
.sc > :deep(.acts) { grid-area: acts; }
.head { grid-area: head; display: flex; align-items: center; gap: var(--space-3); flex-wrap: wrap; }
.goal { display: grid; gap: 2px; min-width: 180px; }
.grow { flex: 1; }
.seg { display: inline-flex; gap: 4px; align-items: center; flex-wrap: wrap; }
.seg button { font-size: var(--fs-sm); font-weight: 800; padding: 6px 10px; background: var(--bg-2); color: var(--ink-2); border: 0; cursor: pointer; }
.seg button.on { background: var(--ink-2); color: var(--bg); }
.stage { grid-area: stage; display: grid; grid-template-columns: minmax(0, 1fr) minmax(200px, 240px) minmax(0, 1fr); gap: var(--space-4); }
.stage.solo { grid-template-columns: minmax(0, 1fr) minmax(200px, 320px); }
.others { display: grid; gap: var(--space-4); align-content: start; min-width: 0; }
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
.sc > :deep([data-circles]) { grid-area: circles; }
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
@media (max-width: 1100px) { .sc { grid-template-columns: minmax(0, 1fr); grid-template-areas: "head" "stage" "circles" "links" "pick" "acts" "side"; } }
@media (max-width: 720px) {
  .sc { padding: var(--space-3); gap: var(--space-3); }
  .stage, .stage.solo { grid-template-columns: minmax(0, 1fr); gap: var(--space-3); }
  .stage > :nth-child(1) { order: 3; } .mid { order: 2; } .others { order: 1; }
  .lk-toggle { display: inline-block; }
  .lk-long { display: none; }
  .lks { display: none; }
  .lks.open { display: grid; }
}
</style>
