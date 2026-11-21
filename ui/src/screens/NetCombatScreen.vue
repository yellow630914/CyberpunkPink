<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import StatusBar from '../components/StatusBar.vue'
import Hint from '../components/Hint.vue'
import TrackBar from '../components/TrackBar.vue'
import ActionRing, { type RingItem } from '../components/combat/ActionRing.vue'
import HoldButton from '../components/combat/HoldButton.vue'
import { NetBattle, NET_ACTIONS, NET_ADMIN, NET_WEAPONS, NET_COVER_NAMES, SYNC, type NetUnit } from '../lib/combat/net'
import { RING_KEYS, TARGET_HINT } from '../lib/combat/real'
import { COVER_DUR, type Side, type Target } from '../lib/combat/field'
import { mathRng, seeded } from '../lib/combat/rng'
import { COMBAT_ICONS } from '../data/combatIcons'
import { NET_ENCOUNTERS } from '../data/encounters'
import { useBattle } from '../lib/useBattle'
import { useGame } from '../stores/game'
import { useSettings } from '../stores/settings'
import { applyDifficulty, tableFor } from '../lib/difficulty'
import { useSubnet } from '../stores/subnet'
import '../styles/battle.css'

/**
 * 內海戰鬥（全頁，內海皮；CYBERSPACE 第 5～7 節、COMBAT_SYSTEM 第 10 節）：照 docs/mockups/net-demo.html 重做成元件。
 * 卡片上只有感載一條；遮蔽換成防火牆；RAM、同步檔位、餘韻、追蹤度（30／60／90）、潛網者的管理行動、彈幕、拔線與投降。
 * 從子網連過來：#/netcombat?enc=bluewhale&from=/subnet；子網的追蹤度帶進來，打完帶回去。
 */
const route = useRoute()
const router = useRouter()
const g = useGame()
const st = useSettings()
const sub = useSubnet()
const enc = computed(() => NET_ENCOUNTERS.find(e => e.id === route.query.enc) ?? NET_ENCOUNTERS[0])
const from = computed(() => (typeof route.query.from === 'string' ? route.query.from : enc.value.from))
const fromSubnet = computed(() => from.value.startsWith('/subnet'))
const speed = () => (route.query.fast ? 0.02 : 1)
const seed = Number(route.query.seed) || 0
const hint = ref('')
const skillOpen = ref(false)

const { b, phase, isFocused, targets, endTurn, after, restart, pick } = useBattle(
  () => {
    const setup = structuredClone(enc.value.setup)
    const minus = Number(route.query.minus) || 0
    if (minus > 0) setup.foes = setup.foes.slice(0, Math.max(1, setup.foes.length - minus))
    if (fromSubnet.value) setup.trace = Math.max(setup.trace ?? 0, sub.trace)
    setup.foes = applyDifficulty(setup.foes, tableFor(st.s.difficulty, st.s.customDiff))
    return new NetBattle(setup, seed ? seeded(seed) : mathRng)
  },
  { speed, onRing: i => act(RING_KEYS[i]) },
)
watch(() => route.query.enc, () => restart())
const cur = computed(() => b.value.cur())
const myTurn = computed(() => phase.value === 'player' && !b.value.end)
const items = computed<RingItem[]>(() => NET_ACTIONS.map(a => ({ ...a, cost: b.value.cost(a.k, cur.value), reason: myTurn.value ? b.value.reason(a.k) : '現在是敵人的回合', key: RING_KEYS.indexOf(a.k) + 1 })))
function act(k: string) {
  if (!myTurn.value) return
  const r = b.value.reason(k)
  if (r) { hint.value = `${NET_ACTIONS.find(a => a.k === k)?.n}：${r}。`; return }
  b.value.act(k)
  const a = NET_ACTIONS.find(x => x.k === k)!
  hint.value = b.value.mode && a.tg ? TARGET_HINT[a.tg] : ''
  after()
}
function admin(k: string) {
  const r = b.value.adminReason(k)
  if (r) { hint.value = `${NET_ADMIN.find(a => a.k === k)?.n}：${r}。`; return }
  b.value.admin(k)
  const a = NET_ADMIN.find(x => x.k === k)!
  hint.value = b.value.mode ? `${a.n}（RAM ${a.c}）：${a.d} 選目標（綠框）。` : ''
  after()
}
function setSync(i: number) { const r = b.value.syncReason(i); if (r) { hint.value = r + '。'; return } b.value.setSync(i) }
function clickTarget(t: Target) { if (pick(t)) hint.value = '' }
const isTarget = (t: Target) => targets.value.some(x => (x.kind === 'unit' && t.kind === 'unit' && x.id === t.id) || (x.kind === 'slot' && t.kind === 'slot' && x.side === t.side && x.slot === t.slot))

const SLOTS: Array<{ side: Side; slot: number }> = [4, 3, 2, 1].map(slot => ({ side: 'P' as Side, slot })).concat([1, 2, 3, 4].map(slot => ({ side: 'E' as Side, slot })))
const slotStyle = (s: { side: Side; slot: number }) => ({ '--c': s.side === 'P' ? 5 - s.slot : 5 + s.slot, '--mc': s.slot, '--mr': s.side === 'E' ? 1 : 3 })
const unitAt = (s: { side: Side; slot: number }) => b.value.at(s.side, s.slot)
const pct = (v: number, m: number) => `${Math.max(0, Math.min(100, (v / m) * 100))}%`
const hcOf = (u: NetUnit) => (b.value.mode === 'shoot' || b.value.mode === 'melee') && u.side === 'E' && isTarget({ kind: 'unit', id: u.id }) ? b.value.hitChance(cur.value, u) : null
function statuses(u: NetUnit) {
  return [u.aim && '瞄準', u.flash && '閃斷', u.supp && '被壓制', u.watch && '監視', u.jam && '干擾', u.cut && '斷路', u.mark && '標記', !u.prot && (u.elite || u.side === 'P') && '破損', u.white && '拉警報'].filter(Boolean) as string[]
}
const AV: Record<string, string> = {
  cat: 'M4 13L7 2l5 6h4l5-6 3 11a10 10 0 1 1-20 0z',
  lace: 'M14 7a9 9 0 1 1 0 18a9 9 0 1 1 0-18zM4 10q10-11 20 0l-2 2q-8-7-16 0z',
  bot: 'M5 8h18v16H5zM14 8V3M11 3h6',
}

// ---- 彈幕：引擎丟出新的字，畫面讓它飄過戰場 ----
const floating = ref<Array<{ id: number; text: string; top: number; dur: number }>>([])
watch(() => b.value.danmaku.length, n => {
  if (!n) return
  for (const d of b.value.danmaku.splice(0)) {
    if (floating.value.length >= 6) continue
    const f = { id: d.id, text: d.text, top: 6 + Math.floor(Math.random() * 5) * 24, dur: 5 + Math.random() * 3 }
    floating.value.push(f)
    setTimeout(() => { floating.value = floating.value.filter(x => x.id !== f.id) }, (f.dur + 1) * 1000)
  }
})

const RESULT: Record<string, string> = { win: '勝利', lose: '戰敗', retreat: '撤退', surrender: '投降', located: '被定位', fled: '脫離' }
function leave() {
  const e = b.value.end!
  const zero = b.value.units.find(u => u.side === 'P' && u.name === '零')
  const m = g.party.find(p => p.id === 'zero')
  if (m && zero) { m.load[0] = Math.min(m.load[1], Math.round((zero.load / zero.loadMax) * m.load[1])); m.afterglow = Math.min(5, m.afterglow + zero.layers) }
  if (fromSubnet.value) sub.trace = Math.min(100, b.value.trace)
  g.advance(b.value.round)
  g.addLog({ prose: [`${enc.value.place}：${enc.value.name}。${e.text}`], net: [`追蹤度 ${b.value.trace}，觀看 ${b.value.view.toLocaleString('en-US')}。`], changes: [{ text: `${RESULT[e.result]}・${b.value.round} 回合`, kind: e.result === 'win' ? 'plus' : 'minus' }] })
  g.lastBattle = { kind: 'net', result: e.result, text: e.text, rounds: b.value.round, downs: b.value.units.filter(u => u.side === 'P' && u.down && !u.unp).length }
  router.push(from.value === '/commission' || !(e.result === 'located' || e.result === 'lose' || e.result === 'surrender') ? from.value : '/')
}
</script>

<template>
  <div class="bt-screen net">
    <StatusBar back :title="`內海戰鬥：${enc.name}`" />
    <div class="bt-wrap">
      <section class="panel cut bt-top">
        <span class="ttl">INNER SEA // {{ enc.place }}</span>
        <span class="tag hot">第 {{ b.round }} 回合</span>
        <span class="live mono">● LIVE　觀看 {{ b.view.toLocaleString('en-US') }}</span>
        <div class="trace"><span class="k">追蹤度</span><b class="mono">{{ b.trace }}</b><TrackBar :value="Math.min(100, b.trace)" :max="100" color="var(--hp)" :marks="[30, 60, 90]" /><span v-if="b.loc > 0" class="tag warn">定位 {{ b.loc }}</span></div>
        <div v-if="b.dl" class="dl" data-download><span class="k">下載・{{ b.dl.what }}</span><b class="mono">{{ b.dl.total - b.dl.left }}／{{ b.dl.total }}</b>
          <span class="tag" :class="b.dl.broken ? 'warn' : 'hot'">{{ b.dl.broken ? '中斷了' : `${b.units[b.dl.holder].name}守著節點` }}</span>
          <Hint title="守住節點">守著節點的人不能換位、拔線就中斷；他倒下也中斷。每回合結束下載一回合（追蹤度 +2），每兩回合一波守衛程式趕過來。撐完就從後門登出。</Hint></div>
        <span v-if="b.queue.length" class="tag warn" data-queue>線外排隊的增援 {{ b.queue.length }}</span>
        <span v-if="b.realAlert" class="tag warn">現實的保全警戒中</span>
        <span class="grow" />
        <button type="button" class="btn sm" @click="restart(); hint = ''">重新潛入</button>
        <Hint title="內海戰鬥">和現實同一個版面：卡片上只有感載一條，遮蔽換成防火牆。攻擊花 RAM；每回合回 3 點行動點與 RAM。同步檔位每回合換一次：越深檢定越高、受到的感載越重。餘韻在內海裡是加成（每層檢定 +1、傷害 +10%）。追蹤度每回合 +3：30 白蕾絲上線、60 對方的潛網者上線、90 被定位，三回合後強制斷線。拔線（長按）讓這個人登出；全隊都拔線就是撤退。</Hint>
        <div class="bt-order" aria-label="先攻條" style="flex-basis: 100%">
          <span v-for="o in b.orderView()" :key="o.u.id" class="bt-chip" :class="{ e: o.u.side === 'E', now: o.now }">{{ o.u.name }}</span>
        </div>
      </section>

      <section class="panel cut bt-fieldp">
        <div class="dm" aria-hidden="true"><span v-for="f in floating" :key="f.id" :style="{ top: `${f.top}px`, animationDuration: `${f.dur}s` }">{{ f.text }}</span></div>
        <div class="bt-field">
          <template v-for="s in SLOTS" :key="s.side + s.slot">
            <div class="bt-slot" :style="slotStyle(s)"
              :class="{ tg: isTarget({ kind: 'slot', side: s.side, slot: s.slot }), foc: isFocused({ kind: 'slot', side: s.side, slot: s.slot }) }"
              :role="isTarget({ kind: 'slot', side: s.side, slot: s.slot }) ? 'button' : undefined" :tabindex="isTarget({ kind: 'slot', side: s.side, slot: s.slot }) ? 0 : undefined"
              :data-slot="s.side + s.slot" @click="isTarget({ kind: 'slot', side: s.side, slot: s.slot }) && clickTarget({ kind: 'slot', side: s.side, slot: s.slot })">
              <div class="bt-sh" :aria-label="`第 ${s.slot} 格，${NET_COVER_NAMES[b.cov[s.side][s.slot].l]}`">
                <template v-if="b.cov[s.side][s.slot].l">
                  <svg class="bt-i" viewBox="0 0 512 512" aria-hidden="true"><path :d="COMBAT_ICONS[b.cov[s.side][s.slot].l === 2 ? 'cov' : 'half']" /></svg>
                  <span class="bt-bar" :class="{ half: b.cov[s.side][s.slot].l === 1 }"><i :style="{ width: pct(b.cov[s.side][s.slot].d, COVER_DUR[b.cov[s.side][s.slot].l]), background: 'var(--sink)' }" /></span>
                  {{ Math.max(0, b.cov[s.side][s.slot].d) }}
                </template>
                <span v-else class="t-fine">暴露</span>
              </div>
              <div v-if="unitAt(s)" class="bt-u" :class="{ e: s.side === 'E', act: unitAt(s)!.id === cur.id && !b.end, tg: isTarget({ kind: 'unit', id: unitAt(s)!.id }), foc: isFocused({ kind: 'unit', id: unitAt(s)!.id }) }"
                :role="isTarget({ kind: 'unit', id: unitAt(s)!.id }) ? 'button' : undefined" :tabindex="isTarget({ kind: 'unit', id: unitAt(s)!.id }) ? 0 : undefined"
                :data-unit="unitAt(s)!.id" :aria-label="`${unitAt(s)!.name}，感載 ${unitAt(s)!.load}`"
                @click.stop="isTarget({ kind: 'unit', id: unitAt(s)!.id }) ? clickTarget({ kind: 'unit', id: unitAt(s)!.id }) : isTarget({ kind: 'slot', side: s.side, slot: s.slot }) && clickTarget({ kind: 'slot', side: s.side, slot: s.slot })"
                @keydown.enter.stop.prevent="isTarget({ kind: 'unit', id: unitAt(s)!.id }) && clickTarget({ kind: 'unit', id: unitAt(s)!.id })">
                <div class="bt-nm"><b><svg class="av" viewBox="0 0 28 28" aria-hidden="true"><path :d="AV[unitAt(s)!.av]" /></svg>{{ unitAt(s)!.name }}</b><small><template v-if="hcOf(unitAt(s)!) !== null"><span class="hc">{{ hcOf(unitAt(s)!) }}%</span> </template>{{ unitAt(s)!.skin }}</small></div>
                <div class="bt-row" style="color: var(--load)"><svg class="bt-i" viewBox="0 0 512 512" aria-label="感載"><path :d="COMBAT_ICONS.load" /></svg><span class="bt-bar"><i :style="{ width: pct(unitAt(s)!.load, unitAt(s)!.loadMax), background: 'var(--load)' }" /></span><span class="num">{{ unitAt(s)!.load }}</span></div>
                <div class="bt-row" title="餘韻層數（每層檢定 +1、傷害 +10%；疊滿之後再過載就斷線）"><span class="bt-pips l"><i v-for="n in unitAt(s)!.layersMax" :key="n" :class="{ f: n <= unitAt(s)!.layers }" /></span></div>
                <template v-if="!unitAt(s)!.white">
                  <div class="bt-row" style="color: var(--ap)"><svg class="bt-i" viewBox="0 0 512 512" aria-label="行動點"><path :d="COMBAT_ICONS.ap" /></svg><span class="bt-pips"><i v-for="n in unitAt(s)!.apMax" :key="n" :class="{ f: n <= unitAt(s)!.ap }" /></span></div>
                  <div class="bt-row" style="color: var(--ram)"><svg class="bt-i" viewBox="0 0 512 512" aria-label="RAM"><path :d="COMBAT_ICONS.ram" /></svg><span class="bt-pips r"><i v-for="n in unitAt(s)!.ramMax" :key="n" :class="{ f: n <= unitAt(s)!.ram }" /></span></div>
                  <div class="bt-row wpn">{{ NET_WEAPONS[unitAt(s)!.ws[unitAt(s)!.wi]].n }}</div>
                </template>
                <div class="bt-st"><span class="sy" :class="`s${unitAt(s)!.sync}`">{{ SYNC[unitAt(s)!.sync].n }}檔</span><span v-for="t in statuses(unitAt(s)!)" :key="t" :class="{ w: t === '閃斷' || t === '拉警報' || t === '破損' }">{{ t }}</span></div>
              </div>
              <div v-else class="bt-down">空格</div>
            </div>
          </template>
          <div class="bt-mid">近身</div>
        </div>
        <div class="bt-dir" aria-hidden="true"><span class="p">◀ 後排　我方　前排 ▶</span><span class="e">◀ 前排　敵方　後排 ▶</span></div>
      </section>

      <section v-if="b.end" class="panel cut bt-end" :class="{ lose: b.end.result !== 'win' }" data-end="net">
        <h3>{{ RESULT[b.end.result] }}</h3>
        <p>{{ b.end.text }}</p>
        <div class="bt-btns">
          <button type="button" class="btn pri" @click="leave">{{ b.end.result === 'win' || b.end.result === 'retreat' ? (fromSubnet ? '回到子網' : '回到地圖') : '回到現實' }}</button>
          <button type="button" class="btn" @click="restart(); hint = ''">重新潛入</button>
        </div>
      </section>

      <div class="bt-lower">
        <section class="panel cut bt-actp" :data-phase="phase">
          <ActionRing :items="items" :selected="b.mode" :off="!myTurn" :skill-open="skillOpen" ram-label @act="act" @skill="skillOpen = !skillOpen" />
          <div class="bt-side">
            <div class="bt-who"><span class="k">現在</span><b>{{ cur.side === 'E' ? '敵・' : '' }}{{ cur.name }}</b><span class="t-fine">第 {{ cur.slot }} 格</span><span v-if="cur.side === 'P'" class="t-fine">行動點 {{ cur.ap }}／{{ cur.apMax }}・RAM {{ cur.ram }}／{{ cur.ramMax }}</span></div>
            <div class="grp">
              <span class="k">同步檔位（每回合換一次；檢定／受到的感載）</span>
              <div class="segs">
                <button v-for="(sy, i) in SYNC" :key="sy.n" type="button" :class="{ on: myTurn && cur.sync === i, 'is-unavailable': !myTurn || (b.syncReason(i) !== null && cur.sync !== i) }" :aria-disabled="!myTurn || (b.syncReason(i) !== null && cur.sync !== i) || undefined" @click="setSync(i)">{{ sy.n }}<small>{{ sy.c >= 0 ? '+' : '' }}{{ sy.c }} ×{{ sy.m }}</small></button>
              </div>
            </div>
            <div v-if="myTurn && cur.admin" class="grp">
              <span class="k">管理行動（剩 {{ b.adminLeft() }} 次）<Hint>只有潛網者有。花 RAM；每次追蹤度 +1，介面檢定對 12 失敗再 +5。</Hint></span>
              <div class="adm">
                <button v-for="a in NET_ADMIN" :key="a.k" type="button" class="btn sm" :class="{ pri: b.mode === `ad-${a.k}`, 'is-unavailable': !!b.adminReason(a.k) && b.mode !== `ad-${a.k}` }" :title="a.d" :data-admin="a.k" @click="admin(a.k)">{{ a.n }}<small>RAM {{ a.c }}</small></button>
              </div>
            </div>
            <div class="bt-btns">
              <button type="button" class="btn pri" :class="{ 'is-unavailable': !myTurn }" :aria-disabled="!myTurn || undefined" @click="endTurn">結束回合<kbd>Space</kbd></button>
              <HoldButton :reason="!myTurn ? '現在不是你的回合' : cur.ap < 1 ? '行動點不夠' : null" @fire="b.unplug(); after(); if (!b.end) endTurn()" @hint="t => (hint = t)">拔線<small>1</small></HoldButton>
              <HoldButton :reason="b.end ? '戰鬥已經結束' : null" @fire="b.surrender(); after()" @hint="t => (hint = t)">投降</HoldButton>
            </div>
            <div class="bt-hint" aria-live="polite">{{ myTurn ? hint || `輪到 ${cur.name}。先決定同步檔位，再選行動。` : b.end ? '' : '敵人的回合……' }}</div>
            <div v-if="skillOpen" class="bt-skl"><b>技能清單</b><p class="t-fine">網內的主動技能與專屬構裝在第四版接上；這一版先用圓環上的行動與管理行動。</p></div>
          </div>
        </section>
        <section class="panel cut bt-logp">
          <p class="h">戰鬥紀錄</p>
          <div class="bt-log" aria-live="polite"><p v-for="(l, i) in b.lines.slice().reverse()" :key="b.lines.length - i" :class="l.c">{{ l.t }}</p></div>
        </section>
      </div>
    </div>
  </div>
</template>

<style scoped>
.live { color: var(--hp); font-weight: 900; font-size: var(--fs-sm); }
.dl { display: flex; align-items: center; gap: var(--space-3); flex-wrap: wrap; }
.trace { display: flex; align-items: center; gap: var(--space-3); min-width: 220px; flex: 0 1 320px; }
.trace :deep(.track) { flex: 1; }
.trace > :nth-child(3) { flex: 1; }
.dm { position: absolute; inset: 0 0 auto 0; height: 140px; pointer-events: none; overflow: hidden; z-index: 2; }
.dm span { position: absolute; left: 100%; white-space: nowrap; font: 900 var(--fs-md) var(--font); color: var(--ink); text-shadow: 0 0 3px var(--bg-1), 0 0 6px var(--bg-1); animation: fly linear forwards; }
@keyframes fly { to { transform: translateX(calc(-100vw - 100%)); } }
.av { width: 16px; height: 16px; fill: none; stroke: currentColor; stroke-width: 2; vertical-align: -2px; margin-right: 3px; }
.grp { display: grid; gap: var(--space-2); }
.segs small { display: block; font: 700 var(--fs-tiny) var(--mono); opacity: .8; }
.adm { display: flex; gap: var(--space-2); flex-wrap: wrap; }
.adm small { font: 800 var(--fs-tiny) var(--mono); color: var(--ram); }
.sy { background: var(--bg-3) !important; }
.sy.s2 { color: var(--a) !important; }
.sy.s3 { background: var(--a) !important; color: var(--on-a) !important; }
.net :deep(.bt-slot) { background: var(--bg-1); box-shadow: inset 0 0 0 3px var(--line); }
.net :deep(.bt-slot.tg) { box-shadow: inset 0 0 0 3px var(--ok); }
.net :deep(.bt-slot.foc) { box-shadow: inset 0 0 0 3px var(--ok), 0 0 0 3px var(--a); }
.net :deep(.bt-u) { background: var(--bg-2); }
</style>
