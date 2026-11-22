<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { END_TURN } from '@engine/src'
import type { BattleActionOption, BattleInput, BattleStepResult, BattleTarget, BattleTargetOption } from '@engine/src'
import StatusBar from '../components/StatusBar.vue'
import Hint from '../components/Hint.vue'
import ActionRing, { type RingItem } from '../components/combat/ActionRing.vue'
import HoldButton from '../components/combat/HoldButton.vue'
import LiveWindow from '../components/combat/LiveWindow.vue'
import Danmaku from '../components/combat/Danmaku.vue'
import { COMBAT_ICONS } from '../data/combatIcons'
import type { LiveEvent } from '../data/media'
import { RING_KEYS, battleView, disabledReason, ringOf, slotLayout, type BattleCell, type SlotPos } from '../lib/battleView'
import { combatKey, isTyping } from '../lib/keys'
import { danmakuOf, liveEventsOf } from '../lib/liveEvents'
import { useEngine } from '../stores/engine'
import { useUi } from '../stores/ui'
import '../styles/battle.css'

/**
 * 現實戰鬥（全頁，COMBAT_SYSTEM 第 10 節）：畫面只編排。狀態、能不能做、為什麼不能、命中率、花幾點、誰先動，
 * 都讀引擎（store 的 battle、battleOptions）；這裡不寫規則。規則見 dev/work/M1-ui-combat.md。
 * 從子網、地下城、委託連過來：#/combat?enc=<遭遇的 id>&from=/dungeon。?fast=1 讓敵人的回合不等（測試用）。
 */
const route = useRoute()
const router = useRouter()
const engine = useEngine()
const ui = useUi()

const from = computed(() => (typeof route.query.from === 'string' ? route.query.from : '/'))
const fast = computed(() => !!route.query.fast)
const hint = ref('')
const skillOpen = ref(false)
const liveOn = ref(false)
const live = ref({ on: false, viewers: 0 })
const dm = ref<InstanceType<typeof Danmaku> | null>(null)
const liveWin = ref<InstanceType<typeof LiveWindow> | null>(null)
const liveEvents = ref<LiveEvent[]>([])
const lines = ref<Array<{ t: string; c: string }>>([])
const settling = ref(false)

// ---- 版面：桌面一列八格，手機敵上我下（兩排的第 1 格都在左邊） ----
const mq = typeof window !== 'undefined' && window.matchMedia ? window.matchMedia('(max-width: 720px)') : null
const mobile = ref(!!mq?.matches)
const onMq = (e: MediaQueryListEvent) => { mobile.value = e.matches }
const layout = computed(() => slotLayout(mobile.value ? 'mobile' : 'desktop'))

// ---- 引擎給的東西 ----
const battle = computed(() => engine.battle)
const options = computed(() => (engine.battle ? engine.battleOptions() : null))
const view = computed(() => (battle.value && options.value ? battleView(battle.value, options.value, engine.contentName) : null))
const myTurn = computed(() => options.value?.waiting === 'player')
const over = computed(() => options.value?.waiting === 'over')
const cur = computed(() => (battle.value && options.value?.current ? battle.value.units[options.value.current] ?? null : null))
const ring = computed(() => (options.value ? ringOf(options.value) : null))
const keys = computed(() => (options.value ? RING_KEYS(options.value) : []))
const place = computed(() => battle.value?.origin.place ?? '現實戰鬥')
const cellOf = (p: SlotPos): BattleCell | undefined => view.value?.cells.find((c) => c.side === p.side && c.slot === p.slot)

const RING_G = { attack: 'atk', supply: 'res', tactic: 'tac' } as const
/** 引擎的行動沒給圖示的，照行動的 id 對圖示（只是顯示的對照） */
const ID_ICON: Record<string, string> = { shoot: 'shoot', melee: 'melee', reload: 'reload', swap: 'swap', item: 'item', move: 'move', hit_cover: 'cover', watch: 'watch', subdue: 'subdue', flee: 'flee' }
const iconOf = (a: BattleActionOption): string => (a.icon && COMBAT_ICONS[a.icon] ? a.icon : ID_ICON[a.id] ?? 'skill')
const reasonOf = (a: BattleActionOption): string | null => disabledReason(a) ?? (a.ok ? null : '現在做不到。')
const ringItems = computed<RingItem[]>(() => {
  const r = ring.value
  if (!r) return []
  return (['attack', 'supply', 'tactic'] as const).flatMap((g) => r[g].map((a): RingItem => ({
    k: a.id, n: a.name, c: a.cost.ap, g: RING_G[g], icon: iconOf(a), d: a.desc, w: '',
    cost: a.cost.ap, reason: reasonOf(a), key: keys.value.indexOf(a.id) + 1,
  })))
})
const actionOf = (id: string): BattleActionOption | undefined => options.value?.actions.find((a) => a.id === id)

// ---- 開打 ----
function startFromRoute(): void {
  if (!engine.hasCharacter || engine.inBattle || engine.defeat) return
  const wanted = typeof route.query.enc === 'string' ? route.query.enc : ''
  const list = engine.encounters()
  const id = list.find((e) => e.id === wanted)?.id ?? list.find((e) => e.grade === 1)?.id ?? list[0]?.id
  if (!id) { hint.value = '內容裡沒有任何遭遇。'; return }
  engine.startEncounter(id)
  lines.value = []
  liveEvents.value = []
}
onMounted(() => {
  mq?.addEventListener('change', onMq)
  window.addEventListener('keydown', onKey, true)
  startFromRoute()
  scheduleAi()
})
watch(() => route.query.enc, () => { if (!engine.inBattle && !settling.value) startFromRoute() })

// ---- 一步的結果：紀錄、直播、提示 ----
function after(r: BattleStepResult): void {
  const reports = r.reports ?? []
  for (const rep of reports) {
    for (const b of rep.timeline) {
      const good = b.tag === 'crit' || b.tag === 'down' || b.tag === 'subdue' || b.tag === 'overload'
      lines.value.push({ t: b.text, c: good ? 'h' : b.tag === 'wound' ? 'r' : '' })
    }
  }
  const ev = liveEventsOf(reports, engine.battle)
  liveEvents.value.push(...ev)
  if (live.value.on) for (const d of danmakuOf(ev)) dm.value?.push(d.text, d.kind)
}

// ---- 敵人的回合：等的是 AI 就每隔一小段時間走一步 ----
let timer: ReturnType<typeof setTimeout> | null = null
function scheduleAi(): void {
  if (timer || options.value?.waiting !== 'ai') return
  timer = setTimeout(() => {
    timer = null
    if (options.value?.waiting !== 'ai') return
    const r = engine.battleNext()
    if (r.status === 'refused') { hint.value = (r.reasons ?? []).join('\n'); return }
    after(r)
  }, fast.value ? 0 : 650)
}
watch(() => engine.battle, () => { selId.value = null; scheduleAi() })

// ---- 選行動、選目標 ----
const selId = ref<string | null>(null)
const pickItem = ref<string | null>(null)
const pickSweep = ref(false)
const selAction = computed(() => (selId.value ? actionOf(selId.value) ?? null : null))
const tkey = (t: BattleTarget): string => ('unit' in t ? `u:${t.unit}` : 'overlay' in t ? `o:${t.overlay}` : 'node' in t ? `n:${t.node}` : `s:${t.side}:${t.slot}`)
const tmap = computed(() => new Map((selAction.value?.targets ?? []).map((t) => [tkey(t.target), t])))
const okTargets = computed(() => (selAction.value?.targets ?? []).filter((t) => t.blocks.length === 0))
const focus = ref(0)
const focused = computed(() => (okTargets.value.length ? okTargets.value[((focus.value % okTargets.value.length) + okTargets.value.length) % okTargets.value.length]! : null))
const isFocused = (k: string): boolean => !!focused.value && tkey(focused.value.target) === k
const quick = computed(() => (cur.value?.quick ?? []).filter((q) => q.qty > 0))
const wieldedTraits = computed(() => cur.value?.weapons[cur.value.wield]?.traits ?? [])
const canSweep = computed(() => selAction.value?.id === 'shoot' && wieldedTraits.value.includes('sweep'))

/** 這一格（或這個人、這台機器、這個節點）現在是不是目標：有就回傳引擎給的那一筆（可能帶著選不了的原因） */
const tgt = (...ks: string[]): BattleTargetOption | undefined => { for (const k of ks) { const t = tmap.value.get(k); if (t) return t } return undefined }
const unitTgt = (c: BattleCell): BattleTargetOption | undefined => (c.unit ? tgt(`u:${c.unit.id}`, `s:${c.side}:${c.slot}`) : undefined)
const slotTgt = (c: BattleCell): BattleTargetOption | undefined => tgt(`s:${c.side}:${c.slot}`)
const stateOf = (t: BattleTargetOption | undefined): string => (!t ? '' : t.blocks.length ? 'tg-no' : 'tg')

function pickPayload(): BattleInput['pick'] | undefined {
  const p: Record<string, unknown> = {}
  if (selId.value === 'item' && pickItem.value) p.item = pickItem.value
  if (canSweep.value && pickSweep.value) p.sweep = true
  return Object.keys(p).length ? p : undefined
}
function submit(input: BattleInput): void {
  const r = engine.battleAct(input)
  if (r.status === 'refused') { hint.value = (r.reasons ?? []).join('\n'); return }
  hint.value = ''
  selId.value = null
  pickItem.value = null
  pickSweep.value = false
  skillOpen.value = false
  after(r)
}
function chooseAction(id: string): void {
  const a = actionOf(id)
  if (!a || !myTurn.value) return
  const why = reasonOf(a)
  if (why) { hint.value = `${a.name}：${why}`; return }
  if (selId.value === id && a.target !== 'none') { cancel(); return }
  focus.value = 0
  pickItem.value = null
  pickSweep.value = false
  if (a.id === 'item') pickItem.value = quick.value.length === 1 ? quick.value[0]!.item : null
  if (a.id === 'swap' && (cur.value?.weapons.length ?? 0) > 2) { selId.value = id; hint.value = '選要換上哪一把。'; return }
  if (a.target === 'none') { submit({ action: a.id }); return }
  selId.value = id
  hint.value = a.id === 'item' && !pickItem.value ? '先選一個道具，再選目標。' : '選一個目標（綠框）。Tab 換目標，Enter 確定，Esc 取消。'
}
function pickTarget(t: BattleTargetOption | undefined): void {
  const a = selAction.value
  if (!a || !t) return
  if (t.blocks.length) { hint.value = t.blocks.join('\n'); return }
  if (a.id === 'item' && !pickItem.value) { hint.value = '先選一個道具。'; return }
  const pick = pickPayload()
  submit({ action: a.id, target: t.target, ...(pick ? { pick } : {}) })
}
function cancel(): void { selId.value = null; hint.value = ''; pickItem.value = null; pickSweep.value = false }
function endTurn(): void {
  const a = actionOf(END_TURN)
  if (!a || !myTurn.value) return
  submit({ action: END_TURN })
}
function swapTo(i: number): void { submit({ action: 'swap', pick: { weapon: i } }) }
function fire(a: BattleActionOption): void { submit({ action: a.id }) }
/** 目標的提示：命中率（%）、制伏的檢定難度；引擎有給才顯示 */
function chanceOf(t: BattleTargetOption | undefined): string {
  const h = t?.hint
  if (!h) return ''
  if (typeof h.chance === 'number') return `${h.chance}%`
  if (typeof h.dc === 'number') return `格鬥對 ${h.dc}`
  return ''
}

function onKey(e: KeyboardEvent): void {
  if (e.defaultPrevented || !engine.inBattle) return
  const el = e.target as HTMLElement | null
  if (e.key === ' ' && el?.closest?.('.hold, select')) return
  if (e.key === 'Enter' && !selId.value && el?.closest?.('button, [role="button"], a')) return
  if (e.key === 'Enter' && el?.closest?.('[data-unit], [data-slot], [data-cell]')) return
  const a = combatKey(e, { typing: isTyping(e.target), dialogOpen: ui.stack.length > 0, targeting: !!selId.value })
  if (!a) return
  if (a.type === 'cycle' && !selId.value) return
  e.preventDefault()
  if (!myTurn.value) return
  if (a.type === 'ring') { const id = keys.value[a.i]; if (id) chooseAction(id) }
  else if (a.type === 'end') endTurn()
  else if (a.type === 'cycle') focus.value += a.dir
  else if (a.type === 'confirm') pickTarget(focused.value ?? undefined)
  else if (a.type === 'cancel') cancel()
}

// ---- 結束與結算 ----
const RESULT: Record<string, string> = { win: '勝利', lose: '戰敗', fled: '脫離', surrender: '投降' }
const resultName = computed(() => { const o = battle.value?.result?.outcome; return o ? RESULT[o] ?? o : '' })
const defeatStory = computed(() => (engine.log.find((r) => r.kind !== 'combat')?.prose ?? []).join('\n\n'))
function leave(): void {
  liveWin.value?.stop()
  router.push(from.value)
}
async function settle(): Promise<void> {
  if (settling.value) return
  settling.value = true
  const r = await engine.finishBattle()
  settling.value = false
  if (r.status !== 'applied') { hint.value = r.reason ?? '結算沒有成功。'; return }
  if (!engine.defeat) leave()
}
function accept(): void { engine.acceptDefeat(); leave() }
function retry(): void {
  const err = engine.retryBattle()
  if (err) { hint.value = err; return }
  lines.value = []
  liveEvents.value = []
  hint.value = ''
  scheduleAi()
}

const pct = (v: number, m: number): string => `${Math.max(0, Math.min(100, m > 0 ? (v / m) * 100 : 0))}%`
const RANK_NAME: Record<string, string> = { minion: '雜兵', elite: '精英', boss: '首領' }
const fieldStyle = (p: SlotPos): Record<string, string> => (mobile.value
  ? { gridColumn: String(p.col), gridRow: p.side === 'foe' ? '1' : '3' }
  : { gridColumn: String(p.col > 4 ? p.col + 1 : p.col), gridRow: '1' })
const rankLabel = (side: string, r: string): string => (side === 'foe' ? RANK_NAME[r] ?? '' : '')

onBeforeUnmount(() => {
  if (timer) clearTimeout(timer)
  mq?.removeEventListener('change', onMq)
  window.removeEventListener('keydown', onKey, true)
})
</script>

<template>
  <div class="bt-screen">
    <StatusBar back :title="`現實戰鬥：${place}`" />
    <div class="bt-wrap">
      <section v-if="!engine.hasCharacter" class="panel cut bt-end" data-nochar>
        <h3>先建好角色再來</h3>
        <p>戰鬥要有隊伍：先開新局、把主角建好。</p>
        <div class="bt-btns"><button type="button" class="btn pri" @click="router.push('/newgame')">去建角</button></div>
      </section>

      <section v-else-if="!engine.inBattle && engine.defeat" class="panel cut bt-end lose" data-defeat>
        <h3>{{ engine.defeat.outcome === 'surrender' ? '投降' : '戰敗' }}</h3>
        <p v-if="defeatStory" class="story">{{ defeatStory }}</p>
        <div v-if="engine.defeat.lines.length" class="happen">
          <b>接受的話會發生什麼</b>
          <ul><li v-for="(l, i) in engine.defeat.lines" :key="i">{{ l }}</li></ul>
        </div>
        <div class="bt-btns">
          <button type="button" class="btn pri" data-defeat-accept @click="accept">接受結果</button>
          <button type="button" class="btn" data-defeat-retry @click="retry">重來這場戰鬥</button>
          <button type="button" class="btn" data-defeat-stage @click="retry">回到這個階段開始時</button>
        </div>
        <div class="bt-hint" aria-live="polite">{{ hint }}</div>
      </section>

      <template v-else-if="battle && options && view">
        <section class="panel cut bt-top">
          <span class="ttl">{{ place }}</span>
          <span class="tag hot" data-round>第 {{ view.round }} 回合</span>
          <div class="bt-order" aria-label="先攻條">
            <span v-for="o in view.order" :key="o.id" class="bt-chip" :class="{ e: o.side === 'foe', now: o.now, gone: !!o.out }" :title="o.out ? '已經退出' : undefined">{{ o.name }}</span>
          </div>
          <span class="grow" />
          <span v-if="view.field.dark" class="tag warn" data-field="dark">黑暗<Hint>全場迴避 +2；有夜視的單位攻擊時不受影響（COMBAT_SYSTEM 2.5 節）。</Hint></span>
          <template v-for="n in view.nodes" :key="n.id">
            <button v-if="tgt(`n:${n.id}`)" type="button" class="tag tgt" :class="stateOf(tgt(`n:${n.id}`))" :data-node="n.id" @click="pickTarget(tgt(`n:${n.id}`))">{{ n.name }}・{{ n.used ? '用過了' : n.taken ? '拿下了' : '沒拿下' }}</button>
            <span v-else class="tag" :class="{ hot: n.taken && !n.used }" :data-node="n.id">{{ n.name }}・{{ n.used ? '用過了' : n.taken ? '拿下了' : '沒拿下' }}</span>
          </template>
          <span v-if="live.on" class="live mono" data-live-on>● LIVE　觀看 {{ live.viewers.toLocaleString('en-US') }}</span>
          <button v-else type="button" class="btn sm" :class="{ pri: liveOn }" @click="liveOn = !liveOn">直播</button>
          <button type="button" class="btn sm" :disabled="live.on" :title="live.on ? '直播中不能重新開始' : undefined" data-restart @click="retry">重新開始</button>
          <Hint title="現實戰鬥">雙方各一排四格，面對面；格子底下是那一格的遮蔽。卡片上紅的是生命、粉的是感載，圓點是餘韻（疊滿之後再過載就倒下）。鍵盤：1～9 按圓環的格，Tab 換目標、Enter 確定、Esc 取消，空白鍵結束回合。脫離與投降要長按。手機上敵人在上排、我方在下排，兩排的第 1 格都在左邊。</Hint>
        </section>

        <section class="panel cut bt-fieldp">
          <Danmaku ref="dm" />
          <div class="bt-field" :class="mobile ? 'm' : 'd'" data-field-grid :data-layout="mobile ? 'mobile' : 'desktop'">
            <template v-for="p in layout" :key="p.side + p.slot">
              <template v-if="cellOf(p)">
                <div class="bt-slot" :style="fieldStyle(p)" :class="[stateOf(slotTgt(cellOf(p)!)), { foc: isFocused(`s:${p.side}:${p.slot}`) }]"
                  :role="slotTgt(cellOf(p)!) ? 'button' : undefined" :tabindex="slotTgt(cellOf(p)!) ? 0 : undefined" :data-slot="(p.side === 'ally' ? 'P' : 'E') + p.slot" :data-cell="p.side + p.slot"
                  :title="slotTgt(cellOf(p)!)?.blocks.join('\n') || undefined"
                  @click="slotTgt(cellOf(p)!) && pickTarget(slotTgt(cellOf(p)!))">
                  <div class="bt-sh" :aria-label="`第 ${p.slot} 格，${cellOf(p)!.cover.name}`">
                    <template v-if="cellOf(p)!.cover.level">
                      <svg class="bt-i" viewBox="0 0 512 512" aria-hidden="true"><path :d="COMBAT_ICONS[cellOf(p)!.cover.level === 2 ? 'cov' : 'half']" /></svg>
                      <span class="bt-bar" :class="{ half: cellOf(p)!.cover.level === 1 }"><i :style="{ width: pct(cellOf(p)!.cover.hp, cellOf(p)!.cover.max), background: 'var(--sink)' }" /></span>
                      <span v-if="cellOf(p)!.cover.soft" class="t-fine">{{ cellOf(p)!.cover.soft }}</span>
                      <template v-else>{{ cellOf(p)!.cover.hp }}</template>
                    </template>
                    <span v-else class="t-fine">{{ cellOf(p)!.cover.name }}</span>
                  </div>
                  <div v-if="cellOf(p)!.unit" class="bt-u" :class="[{ e: p.side === 'foe', act: cellOf(p)!.unit!.id === options.current && !over }, stateOf(unitTgt(cellOf(p)!)), { foc: isFocused(`u:${cellOf(p)!.unit!.id}`) }]"
                    :role="unitTgt(cellOf(p)!) ? 'button' : undefined" :tabindex="unitTgt(cellOf(p)!) ? 0 : undefined"
                    :data-unit="cellOf(p)!.unit!.id" :aria-label="`${cellOf(p)!.unit!.name}，生命 ${cellOf(p)!.unit!.hp?.now ?? '無'}，感載 ${cellOf(p)!.unit!.load?.now ?? '無'}`"
                    @click.stop="pickTarget(unitTgt(cellOf(p)!))"
                    @keydown.enter.stop.prevent="pickTarget(unitTgt(cellOf(p)!))">
                    <div class="bt-nm"><b>{{ cellOf(p)!.unit!.name }}</b><small><span v-if="chanceOf(unitTgt(cellOf(p)!))" class="hc" data-chance>{{ chanceOf(unitTgt(cellOf(p)!)) }}</span> {{ rankLabel(p.side, cellOf(p)!.unit!.rank) }}</small></div>
                    <div v-if="cellOf(p)!.unit!.hp" class="bt-row" style="color: var(--hp)"><svg class="bt-i" viewBox="0 0 512 512" aria-label="生命"><path :d="COMBAT_ICONS.hp" /></svg><span class="bt-bar"><i :style="{ width: pct(cellOf(p)!.unit!.hp!.now, cellOf(p)!.unit!.hp!.max), background: 'var(--hp)' }" /></span><span class="num">{{ cellOf(p)!.unit!.hp!.now }}</span></div>
                    <div v-if="cellOf(p)!.unit!.load" class="bt-row" style="color: var(--load)"><svg class="bt-i" viewBox="0 0 512 512" aria-label="感載"><path :d="COMBAT_ICONS.load" /></svg><span class="bt-bar"><i :style="{ width: pct(cellOf(p)!.unit!.load!.now, cellOf(p)!.unit!.load!.max), background: 'var(--load)' }" /></span><span class="num">{{ cellOf(p)!.unit!.load!.now }}</span></div>
                    <div class="bt-row" title="餘韻層數（疊滿之後再過載就倒下）"><span class="bt-pips l"><i v-for="n in cellOf(p)!.unit!.layersMax" :key="n" :class="{ f: n <= cellOf(p)!.unit!.layers }" /></span></div>
                    <div class="bt-row" style="color: var(--ap)"><svg class="bt-i" viewBox="0 0 512 512" aria-label="行動點"><path :d="COMBAT_ICONS.ap" /></svg><span class="bt-pips"><i v-for="n in cellOf(p)!.unit!.ap.max" :key="n" :class="{ f: n <= cellOf(p)!.unit!.ap.now }" /></span></div>
                    <div class="bt-row wpn">{{ cellOf(p)!.unit!.weapon }}<template v-if="cellOf(p)!.unit!.mag"><span v-if="cellOf(p)!.unit!.mag!.max <= 12" class="bt-pips m"><i v-for="n in cellOf(p)!.unit!.mag!.max" :key="n" :class="{ f: n <= cellOf(p)!.unit!.mag!.now }" /></span><span v-else class="mono">{{ cellOf(p)!.unit!.mag!.now }}/{{ cellOf(p)!.unit!.mag!.max }}</span></template></div>
                    <div class="bt-st"><span v-for="t in cellOf(p)!.unit!.statuses" :key="t">{{ t }}</span></div>
                  </div>
                  <div v-else class="bt-down">空格</div>
                  <template v-for="o in cellOf(p)!.overlays" :key="o.id">
                    <component :is="tgt(`o:${o.id}`) ? 'button' : 'div'" class="bt-drone" :class="stateOf(tgt(`o:${o.id}`))" :data-drone="o.kind" :title="`${o.name}：耐久 ${o.hp.now}／${o.hp.max}；永遠暴露`"
                      @click.stop="tgt(`o:${o.id}`) && pickTarget(tgt(`o:${o.id}`))">
                      <b>{{ o.name }}</b><span class="bt-bar"><i :style="{ width: pct(o.hp.now, o.hp.max), background: 'var(--ram)' }" /></span>{{ o.hp.now }}
                    </component>
                  </template>
                </div>
              </template>
            </template>
            <div class="bt-mid" :style="mobile ? { gridColumn: '1 / -1', gridRow: '2' } : { gridColumn: '5', gridRow: '1' }">近身</div>
          </div>
          <div v-if="!mobile" class="bt-dir" aria-hidden="true"><span class="p">◀ 後排　我方　前排 ▶</span><span class="e">◀ 前排　敵方　後排 ▶</span></div>
        </section>

        <section v-if="over" class="panel cut bt-end" :class="{ lose: battle.result?.outcome === 'lose' || battle.result?.outcome === 'surrender' }" data-end="real">
          <h3>{{ resultName }}</h3>
          <p>{{ battle.result?.text }}</p>
          <div class="bt-btns">
            <button type="button" class="btn pri" :disabled="settling" data-settle @click="settle">結算</button>
          </div>
          <div class="bt-hint" aria-live="polite">{{ hint }}</div>
        </section>

        <div class="bt-lower">
          <section class="panel cut bt-actp" :data-phase="myTurn ? 'player' : over ? 'over' : 'enemy'">
            <ActionRing :items="ringItems" :selected="selId" :off="!myTurn" :skill-open="skillOpen" @act="chooseAction" @skill="skillOpen = !skillOpen" />
            <div class="bt-side">
              <div v-if="cur" class="bt-who"><span class="k">現在</span><b>{{ cur.side === 'foe' ? '敵・' : '' }}{{ cur.name }}</b><span class="t-fine">第 {{ cur.slot }} 格</span><span v-if="myTurn" class="t-fine" data-ap>行動點 {{ cur.ap.now }}／{{ cur.ap.max }}</span></div>
              <div v-if="view.distances.length" class="t-fine" data-distances>距離：{{ view.distances.map((d) => `${d.name} ${d.distance}`).join('・') }}</div>
              <div v-if="ring" class="bt-btns">
                <template v-for="a in ring.system" :key="a.id">
                  <HoldButton v-if="a.hold" :reason="!myTurn ? '現在不是你的回合。' : reasonOf(a)" :data-action="a.id" @fire="fire(a)" @hint="(t) => (hint = t)">{{ a.name }}<small v-if="a.cost.ap">{{ a.cost.ap }}</small></HoldButton>
                  <button v-else type="button" class="btn" :class="{ pri: a.id === END_TURN, 'is-unavailable': !myTurn || !a.ok }" :aria-disabled="!myTurn || !a.ok || undefined" :data-action="a.id"
                    @click="myTurn && (a.ok ? submit({ action: a.id }) : (hint = reasonOf(a) ?? ''))">{{ a.name }}<kbd v-if="a.id === END_TURN">Space</kbd></button>
                </template>
              </div>
              <div class="bt-hint" aria-live="polite" data-hint>{{ myTurn ? hint || `輪到 ${cur?.name ?? ''}。選一個行動。` : over ? '' : hint || `${cur?.name ?? '敵人'}的回合……` }}</div>
              <div v-if="selAction?.id === 'item'" class="bt-pick" data-pick="item">
                <b>道具</b>
                <button v-for="q in quick" :key="q.item" type="button" class="btn sm" :class="{ pri: pickItem === q.item }" :data-item="q.item" @click="pickItem = q.item">{{ engine.contentName('item', q.item) ?? q.item }} ×{{ q.qty }}</button>
                <span v-if="!quick.length" class="t-fine">快取格是空的。</span>
              </div>
              <div v-if="selAction?.id === 'swap'" class="bt-pick" data-pick="swap">
                <b>換上</b>
                <button v-for="(w, i) in cur?.weapons ?? []" :key="w.id" type="button" class="btn sm" :class="{ 'is-unavailable': i === cur?.wield }" :aria-disabled="i === cur?.wield || undefined" :data-weapon="i" @click="i !== cur?.wield && swapTo(i)">{{ w.name }}</button>
              </div>
              <label v-if="canSweep" class="bt-pick sweep" data-pick="sweep"><input v-model="pickSweep" type="checkbox" /> 掃射（彈匣要有 2 格）</label>
              <div v-if="skillOpen" class="bt-skl" data-skills>
                <b>技能清單・{{ cur?.name }}</b>
                <div v-if="!ring?.skill.length" class="t-fine">{{ cur?.name }}沒有可以在戰鬥裡用的主動技能。</div>
                <button v-for="a in ring?.skill ?? []" :key="a.id" type="button" class="bt-sk" :class="{ on: selId === a.id, 'is-unavailable': !a.ok }" :title="disabledReason(a) ?? a.desc" :data-skill="a.id" @click="chooseAction(a.id)">
                  <b>{{ a.name }}</b><small class="mono">{{ a.cost.ap }} 點</small><span class="t-fine sd">{{ a.desc }}</span><span v-if="!a.ok" class="t-fine sd no">{{ disabledReason(a) }}</span>
                </button>
              </div>
            </div>
          </section>
          <section class="panel cut bt-logp">
            <p class="h">戰鬥紀錄</p>
            <div class="bt-log" aria-live="polite" data-log><p v-for="(l, i) in lines.slice().reverse()" :key="lines.length - i" :class="l.c">{{ l.t }}</p></div>
          </section>
        </div>
        <LiveWindow v-if="liveOn || live.on" ref="liveWin" :events="liveEvents" :title="`戰鬥直播：${place}`" :locked="over ? '戰鬥已經結束了' : null"
          @chat="(t, k) => dm?.push(t, k)" @state="(s) => (live = s)" @close="liveOn = false; live = { on: false, viewers: 0 }" />
      </template>
    </div>
  </div>
</template>

<style scoped>
.live { color: var(--hp); font-weight: 900; font-size: var(--fs-sm); }
.bt-chip.gone { opacity: .45; text-decoration: line-through; }
.bt-field.d { grid-template-columns: repeat(4, minmax(0, 1fr)) 26px repeat(4, minmax(0, 1fr)); }
.bt-field.m { grid-template-columns: repeat(4, minmax(0, 1fr)); grid-template-rows: auto auto auto; }
/* 目標：能選的是綠框，選不了的（有原因）是灰框 */
.bt-slot.tg-no, .bt-u.tg-no, .bt-drone.tg-no, .tag.tg-no { box-shadow: inset 0 0 0 2px var(--ink-3); opacity: .75; cursor: help; }
.bt-slot.tg-no .bt-u.tg-no { box-shadow: inset 0 0 0 2px var(--ink-3); }
button.bt-drone { border: 0; color: inherit; font: inherit; cursor: pointer; text-align: left; }
button.tag.tgt { border: 0; cursor: pointer; font: inherit; }
button.tag.tg { box-shadow: inset 0 0 0 3px var(--ok); }
.bt-pick { display: flex; gap: var(--space-2); flex-wrap: wrap; align-items: center; font-size: var(--fs-sm); }
.bt-pick.sweep { gap: var(--space-3); }
.bt-sk .no { color: var(--hp); white-space: pre-line; }
.bt-hint { white-space: pre-line; }
.bt-end .story { white-space: pre-line; line-height: var(--lh-prose); max-width: 70ch; }
.bt-end .happen ul { margin: var(--space-2) 0 0; padding-left: 1.4em; display: grid; gap: var(--space-2); }
@media (max-width: 720px) {
  .bt-chip { font-size: var(--fs-fine); padding: 1px 6px; }
  .bt-top { gap: var(--space-2) var(--space-3); }
  .bt-field.m .bt-row .num { display: inline; font-size: var(--fs-tiny); min-width: 0; }
  .bt-field.m .bt-nm b { font-size: var(--fs-xs); }
  .bt-lower .bt-btns .btn, .bt-pick .btn { min-height: 40px; }
}
</style>
