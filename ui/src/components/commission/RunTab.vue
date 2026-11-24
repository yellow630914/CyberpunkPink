<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import GridMap from '../GridMap.vue'
import type { CellView, MapToken } from '../GridMap.vue'
import Hint from '../Hint.vue'
import ReasonButton from '../ReasonButton.vue'
import StageTrack from '../StageTrack.vue'
import TrackBar from '../TrackBar.vue'
import { useEngine } from '../../stores/engine'
import { useUi } from '../../stores/ui'
import type { Point } from '../../data/types'
import { FACE_CLASS, FACE_ICON, FACE_LABEL, NOT_OPEN, auxLine, branchChar, gradeRoman, linkKind, linkWhere, lockedNear, mapCell, repForecastText, scaleName, stepPips } from '../../lib/commissionView'
import type { FaceId } from '../../lib/commissionView'

/**
 * 副本（UI 7.4）：階段軌、這一段的五步、面卡、輔助結算、分支、「進入這一段」之後是引擎的地圖（走路、這一格能做的事、上鎖的門）、拿到的連動、警戒條。
 * 規則全在引擎（features/commission、explore）：面與分支選不了的原因、撤退與喘口氣能不能、目標做到哪都是 commissionView 給的；這裡只畫，呼叫 chooseFace、chooseBranch、走路、這一格的事。
 */
const e = useEngine()
const ui = useUi()
const router = useRouter()

const v = computed(() => e.commission.view())
/** 這一趟是手上哪件委託（信譽預告要它的級） */
const job = computed(() => (v.value ? e.fixer.jobs().find(j => j.commission.id === v.value!.id) ?? null : null))
const grid = computed(() => e.world.grid())
const working = ref(false)
const sel = ref<string | null>(null)
const confirmRetreat = ref(false)
const typeName = computed(() => (v.value ? e.contentName('commission_type', v.value.kind) ?? v.value.kind : ''))
const nameOf = (id: string): string => e.fixer.actorName(id)
const skillName = (id: string): string => e.contentName('skill', id) ?? id
const linkName = (id: string): string => v.value?.links.find(l => l.id === id)?.name ?? id
const branchName = (id: string): string => v.value?.branches.find(b => b.id === id)?.name ?? id
const pips = computed(() => (v.value ? stepPips(v.value.step) : []))
const auxLines = computed(() => (v.value?.aux ?? []).filter(a => a.result).map(a => auxLine(a.result!, nameOf, linkName, skillName)))
const trace = computed(() => v.value?.aux.find(a => a.face === 'net')?.pressure ?? 0)
const hoursText = computed(() => (v.value ? `${v.value.stageMinutes / 60} 小時` : ''))

/** 打輸了、或走到敵人那一格開打了：換到戰鬥的畫面（打完回到這一頁） */
function toBattle(): boolean {
  if (e.inBattle || e.pendingDefeat) { router.push({ path: '/combat', query: { from: '/commission' } }); return true }
  return false
}
onMounted(() => { toBattle() })

async function run(f: () => Promise<{ status: string; reason?: string }>): Promise<boolean> {
  if (working.value) return false
  working.value = true
  const r = await f()
  working.value = false
  if (r.status === 'refused') { ui.toast(r.reason ?? '現在做不了。', 'warn'); return false }
  toBattle()
  return true
}
const chooseFace = (face: FaceId) => run(() => e.commission.chooseFace(face))
async function enter() {
  if (!sel.value) return
  if (await run(() => e.commission.chooseBranch(sel.value!))) sel.value = null
}
const breathe = () => run(() => e.commission.breathe())
async function retreat() {
  confirmRetreat.value = false
  if (await run(() => e.commission.retreat())) ui.toast('撤退：回到進副本之前。')
}

// ---- 地圖 ----
const cell = (x: number, y: number): CellView => mapCell(grid.value?.cells[y]?.[x])
const fog = (x: number, y: number) => (grid.value?.cells[y]?.[x] ? 'visible' as const : 'hidden' as const)
const tokens = computed<MapToken[]>(() => (grid.value ? [{ id: 'me', x: grid.value.at[0], y: grid.value.at[1], label: '你', kind: 'me' }] : []))
function go(to: [number, number] | 'north' | 'south' | 'east' | 'west') {
  const r = e.world.walk(to)
  if (!r.ok) ui.toast(r.reason ?? '現在走不了。', 'warn')
  toBattle()
}
const onCell = (p: Point) => go([p.x, p.y])
const onStep = (d: Point) => go(d.x > 0 ? 'east' : d.x < 0 ? 'west' : d.y > 0 ? 'south' : 'north')
const uses = computed(() => grid.value?.here.uses ?? [])
function onEnter() {
  const u = uses.value.find(x => !x.block)
  if (u) void run(() => e.commission.use(u.id))
  else ui.toast(uses.value[0]?.block ?? '這一格沒有可以做的事。', 'warn')
}
const doors = computed(() => lockedNear(grid.value))
const unlock = (at: [number, number], how: 'pick' | 'break') => run(() => e.commission.unlock(at, how))
const needText = (b: NonNullable<typeof v.value>['branches'][number]): string => {
  const n = b.need
  if (!n) return '沒有條件'
  if ('basic' in n) return `${skillName(n.basic)} ${n.level} 級`
  if ('link' in n) return `連動「${linkName(n.link)}」`
  if ('cash' in n) return `付 ${n.cash} 現金`
  return '踩點揭開的路'
}
</script>

<template>
  <div v-if="v" class="run" data-run>
    <!-- 抬頭 -->
    <section class="panel cut pad rh">
      <div class="grow">
        <b data-run-name>{{ v.name }}</b>
        <span class="tag">{{ gradeRoman(v.grade) }}</span><span class="tag">{{ typeName }}</span><span class="tag">{{ scaleName(v.scale) }}</span><span class="tag hot">主面 {{ FACE_LABEL[v.main] }}</span>
        <span v-for="c in v.conditions" :key="c" class="tag warn-t">{{ c }}</span>
      </div>
      <div class="pres" data-alert>
        <TrackBar :value="v.alert.value" :max="100" color="var(--warn)" label="警戒" :marks="[v.alert.reinforce]" />
        <small class="t-fine">到 {{ v.alert.reinforce }} 增援加進下一場遭遇</small>
      </div>
      <div class="pres"><TrackBar :value="trace" :max="100" color="var(--net)" label="追蹤度" /></div>
      <label class="live"><input type="checkbox" disabled aria-label="副本直播" /> 副本直播<small>（{{ NOT_OPEN }}）</small></label>
      <ReasonButton :reason="v.breathe.reason" data-breathe @go="breathe">喘口氣</ReasonButton>
      <ReasonButton :reason="v.retreat.reason" data-retreat @go="confirmRetreat = true">撤退</ReasonButton>
    </section>
    <section v-if="confirmRetreat" class="panel cut pad warnbox" data-confirm>
      <p><b>要撤退嗎？</b>時間與錢會回到進副本之前，這一趟的紀錄標成被收回。你會回到召集。</p>
      <div class="go"><button type="button" class="btn" @click="confirmRetreat = false">再想想</button><button type="button" class="btn pri" data-retreat-yes @click="retreat">撤退</button></div>
    </section>

    <div class="runcols">
      <div class="stack">
        <section class="panel cut pad"><StageTrack :track="v.track" :branch-name="branchName" /></section>

        <section class="panel cut pad stack">
          <div class="sth"><b data-stage-title>第 {{ Math.min(v.stage, v.stages) }} 階段・{{ v.stageName }}</b><span class="t-fine">做完這一段，城裡過 {{ hoursText }}</span></div>
          <div class="steps" aria-label="這一段的五步"><span v-for="p in pips" :key="p.label" :class="p.state === 'done' ? 'ok' : p.state === 'now' ? 'now' : ''" :data-step="p.state">{{ p.label }}</span></div>

          <div v-if="v.step !== 'done'" class="faces3" data-faces>
            <button v-for="f in v.faces" :key="f.face" type="button" class="facec" :class="{ selectable: v.step === 'face', on: f.chosen, off: !f.open || !!f.block }" :aria-disabled="(!!f.block && !f.chosen) || undefined" :data-face="f.face" @click="v.step !== 'face' ? undefined : f.block ? ui.toast(f.block, 'warn') : chooseFace(f.face)">
              <span class="fc" :class="FACE_CLASS[f.face]">{{ FACE_ICON[f.face] }}</span>
              <b>{{ f.name }}<em v-if="f.chosen">・你在這裡</em></b>
              <small v-if="f.block" data-face-block>{{ f.block }}</small>
              <small v-else-if="v.aux.find(a => a.face === f.face)?.people.length">輔助：{{ v.aux.find(a => a.face === f.face)!.people.map(p => p.name).join('、') }}</small>
              <small v-else-if="f.chosen">你選了這一面。</small>
              <small v-else>可以選這一面。</small>
            </button>
          </div>

          <div v-if="auxLines.length" class="aux" data-aux><p v-for="(l, i) in auxLines" :key="i" class="mono">{{ l }}</p></div>

          <template v-if="v.step === 'branch'">
            <p class="h">在{{ FACE_LABEL[v.faces.find(f => f.chosen)?.face ?? 'meat'] }}怎麼走<Hint>強攻一定可以選。潛行與交涉要基本功夠；連動與踩點開出來的路另有標示；條件不夠的路變淡並寫原因。選了就不能換。</Hint></p>
            <div class="row-list" data-branches>
              <button v-for="b in v.branches" :key="b.id" type="button" class="lrow br" :class="{ on: sel === b.id, 'is-unavailable': !!b.block }" :aria-disabled="!!b.block || undefined" :data-branch="b.id" @click="b.block ? ui.toast(b.block, 'warn') : (sel = b.id)">
                <span class="bt" :class="b.mark">{{ branchChar(b.kind) }}</span>
                <span class="grow"><b>{{ b.name }}</b><small>{{ needText(b) }}</small><small v-if="b.block" class="warn-t" data-branch-block>{{ b.block }}</small></span>
                <span v-if="b.mark === 'link'" class="tag mint">連動</span><span v-else-if="b.mark === 'scouted'" class="tag gold">踩點</span>
              </button>
            </div>
            <div class="go"><ReasonButton pri :reason="sel ? e.blockOf('commit:commission.branch') : '先選一條路。'" data-enter @go="enter">進入這一段</ReasonButton></div>
          </template>

          <template v-if="v.step === 'play'">
            <div class="goal" data-goal><span><b>這一段的目標</b>：{{ v.goal?.text }}</span><span v-if="v.goal?.done" class="tag hot">達成了</span></div>
            <div v-if="grid" class="mapwrap">
              <GridMap :w="grid.size[0]" :h="grid.size[1]" :cell="cell" :fog="fog" :tokens="tokens" :max-cell="44" :label="`${grid.name}的地圖`" @cell="onCell" @step="onStep" @enter="onEnter" />
              <div class="here panel pad">
                <p class="h">這裡<Hint>走到標記上就列出能做的事，按了才做。上鎖的門要站在旁邊撬鎖或破門。</Hint></p>
                <div v-if="grid.here.marker" class="t-fine">{{ grid.here.marker.name }}</div>
                <div class="row-list">
                  <ReasonButton v-for="u in uses" :key="u.id" :reason="u.block" :data-use="u.id" @go="run(() => e.commission.use(u.id))">{{ u.name }}</ReasonButton>
                  <span v-if="!uses.length" class="empty-note">這一格沒有可以做的事。</span>
                </div>
                <template v-if="doors.length">
                  <p class="h" style="margin-top: 10px">身邊上鎖的門</p>
                  <div v-for="d in doors" :key="d.join(',')" class="doorrow" data-door>
                    <ReasonButton sm :reason="null" data-unlock="pick" @go="unlock(d, 'pick')">撬鎖</ReasonButton>
                    <ReasonButton sm :reason="null" data-unlock="break" @go="unlock(d, 'break')">破門</ReasonButton>
                  </div>
                </template>
                <div v-if="v.goal?.kind === 'check'" class="go left"><ReasonButton :reason="null" data-check @go="run(() => e.commission.check())">動手（擲一次）</ReasonButton></div>
                <div v-if="v.goal?.kind === 'scene'" class="go left"><ReasonButton :reason="null" data-scene @go="run(() => e.commission.scene())">進行這一段的場景</ReasonButton></div>
              </div>
            </div>
            <div v-else class="empty-note" data-nomap>
              這一段的地圖已經離開了。<ReasonButton sm :reason="null" data-replay @go="run(() => e.commission.replay())">回到入口再來一次</ReasonButton>
            </div>
          </template>
        </section>
        <p class="t-fine">現在做完的話預估評價 {{ v.close.rating }}，歷練點 {{ v.close.xp }}。</p>
        <p v-if="job" class="t-fine" data-rep-forecast>街頭信譽（照預估的評價）：{{ repForecastText(e.fixer.repGain(job.commission, v.close.rating), e.fixer.repFailed()) }}。</p>
      </div>

      <aside class="stack">
        <section class="panel cut pad" data-links>
          <p class="h">拿到的連動</p>
          <div v-if="!v.links.length" class="empty-note">還沒有。</div>
          <div v-for="l in v.links" :key="l.id" class="link" :class="{ used: l.used }" data-link><span class="kc" :class="linkKind(l.type).tone">{{ linkKind(l.type).name }}</span><b>{{ l.name }}</b><small>{{ linkWhere(l) }}</small></div>
        </section>
        <section class="panel cut pad"><p class="h">小隊</p><div v-for="id in e.fixer.party()" :key="id" class="kv"><span>{{ nameOf(id) }}</span><b>{{ id === e.state.pc ? '你' : '隊伍' }}</b></div></section>
        <section class="panel cut pad">
          <p class="h">輔助面的人</p>
          <template v-for="a in v.aux" :key="a.face"><div v-for="p in a.people" :key="p.id" class="kv"><span>{{ p.name }}{{ p.borrowed ? '（借的）' : '' }}</span><b>{{ a.name }}・{{ a.resting ? '休息中' : a.rolls ? '待命' : '在那裡' }}</b></div></template>
          <div v-if="!v.aux.some(a => a.people.length)" class="empty-note">沒有派人。</div>
        </section>
      </aside>
    </div>
  </div>
</template>

<style scoped>
.run { display: grid; gap: var(--space-4); }
.rh { display: flex; align-items: center; gap: var(--space-3); flex-wrap: wrap; }
.rh .grow { flex: 1; min-width: 200px; display: flex; flex-wrap: wrap; gap: var(--space-2); align-items: center; }
.pres { display: grid; gap: 2px; min-width: 140px; }
.live { display: inline-flex; gap: 6px; align-items: center; font-size: var(--fs-xs); color: var(--ink-3); }
.warnbox { box-shadow: inset 3px 0 0 var(--warn); }
.runcols { display: grid; grid-template-columns: minmax(0, 1fr) 320px; gap: var(--space-4); align-items: start; }
.sth { display: flex; gap: var(--space-3); align-items: baseline; flex-wrap: wrap; }
.steps { display: flex; gap: var(--space-2); flex-wrap: wrap; font-size: var(--fs-fine); font-weight: 800; }
.steps span { padding: 3px 8px; background: var(--bg-2); color: var(--ink-3); }
.steps span.ok { color: var(--ok); } .steps span.now { background: var(--a); color: var(--on-a); }
.faces3 { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: var(--space-3); }
.facec { display: grid; cursor: default; gap: var(--space-2); justify-items: start; text-align: left; padding: var(--space-4); background: var(--bg-2); border: 0; color: var(--ink); font: inherit; cursor: pointer; }
.facec.selectable { cursor: pointer; }
.facec.on { box-shadow: inset 0 0 0 3px var(--a); }
.facec.off { opacity: .55; background-image: repeating-linear-gradient(135deg, transparent 0 6px, color-mix(in srgb, var(--ink) 6%, transparent) 6px 8px); }
.facec small { color: var(--ink-2); font-size: var(--fs-xs); }
.facec em { font-style: normal; color: var(--a); }
.fc { width: 30px; height: 30px; display: grid; place-items: center; font-weight: 900; border-radius: 6px; background: var(--bg-3); }
.fc.m { background: var(--ink-2); color: var(--bg); } .fc.n { background: var(--net); color: var(--bg); } .fc.o { background: var(--ep); color: var(--bg); }
.aux { padding: var(--space-3); background: var(--bg-term); box-shadow: inset 3px 0 0 var(--ram); font-size: var(--fs-xs); color: var(--ink-2); display: grid; gap: 2px; }
.br .bt { width: 26px; height: 26px; display: grid; place-items: center; font-weight: 900; background: var(--bg-3); flex: none; }
.br .bt.link { background: var(--ram); color: var(--bg); } .br .bt.scouted { background: var(--ap); color: var(--bg); }
.lrow .grow { display: grid; }
.tag.mint { background: var(--ram); color: var(--bg); } .tag.gold { background: var(--ap); color: var(--bg); }
.goal { padding: var(--space-3); background: var(--bg-term); box-shadow: inset 3px 0 0 var(--a); display: flex; gap: var(--space-3); align-items: center; flex-wrap: wrap; }
.mapwrap { display: grid; grid-template-columns: minmax(0, 1fr) 260px; gap: var(--space-4); align-items: start; }
.doorrow { display: flex; gap: var(--space-2); margin-bottom: var(--space-2); }
.link { display: grid; grid-template-columns: auto 1fr; gap: 2px var(--space-3); padding: var(--space-2) 0; border-bottom: 1px dashed var(--line); }
.link small { grid-column: 1 / -1; color: var(--ink-3); font-size: var(--fs-fine); }
.link.used { opacity: .55; }
.kc { font-size: var(--fs-fine); font-weight: 800; padding: 1px 6px; border-radius: 4px; color: var(--bg); background: var(--ap); }
.kc.mint { background: var(--ram); } .kc.violet { background: var(--ep); } .kc.gold { background: var(--ap); }
.go.left { justify-content: flex-start; }
@media (max-width: 1100px) { .runcols { grid-template-columns: minmax(0, 1fr); } }
@media (max-width: 860px) { .mapwrap { grid-template-columns: minmax(0, 1fr); } }
@media (max-width: 720px) {
  .faces3 { grid-template-columns: minmax(0, 1fr); }
  .facec.off { display: none; }
  .rh { gap: var(--space-2); }
}
</style>
