<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import StatusBar from '../components/StatusBar.vue'
import Hint from '../components/Hint.vue'
import ActionRing, { type RingItem } from '../components/combat/ActionRing.vue'
import HoldButton from '../components/combat/HoldButton.vue'
import LiveWindow from '../components/combat/LiveWindow.vue'
import Danmaku from '../components/combat/Danmaku.vue'
import { liveReact } from '../data/media'
import { RealBattle, REAL_ACTIONS, RING_KEYS, TARGET_HINT, REAL_WEAPONS, REAL_COVER_NAMES, type RealUnit } from '../lib/combat/real'
import { COVER_DUR, type Side, type Target } from '../lib/combat/field'
import { mathRng, seeded } from '../lib/combat/rng'
import { COMBAT_ICONS } from '../data/combatIcons'
import { REAL_ENCOUNTERS } from '../data/encounters'
import { useBattle } from '../lib/useBattle'
import { useGame } from '../stores/game'
import { useSettings } from '../stores/settings'
import { applyDifficulty, tableFor } from '../lib/difficulty'
import { SKILL_TREES } from '../data/content.generated'
import '../styles/battle.css'

/**
 * 現實戰鬥（全頁，COMBAT_SYSTEM 第 10 節）：照 docs/mockups/combat-demo.html 重做成元件。
 * 兩排四格、先攻條、行動圓環（1～9）、遮蔽、監視、制伏、長按的脫離與投降、敵人的 AI。規則在 lib/combat/real.ts。
 * 從子網、地下城、委託連過來：#/combat?enc=warehouse&from=/dungeon。?fast=1 讓敵人的回合不等（測試用）；?seed= 固定亂數。
 */
const route = useRoute()
const router = useRouter()
const g = useGame()
const st = useSettings()
const enc = computed(() => REAL_ENCOUNTERS.find(e => e.id === route.query.enc) ?? REAL_ENCOUNTERS[0])
const from = computed(() => (typeof route.query.from === 'string' ? route.query.from : enc.value.from))
const speed = () => (route.query.fast ? 0.02 : 1)
const seed = Number(route.query.seed) || 0
const hint = ref('')
const skillOpen = ref(false)
const liveOn = ref(false)
// 直播（照內海戰鬥的版面）：頂列 ● LIVE、彈幕飄過戰場、目標在可縮放的小窗
const live = ref({ on: false, viewers: 0 })
const dm = ref<InstanceType<typeof Danmaku> | null>(null)
const liveWin = ref<InstanceType<typeof LiveWindow> | null>(null)

const { b, phase, isFocused, targets, endTurn, after, restart, pick } = useBattle(
  () => {
    const setup = structuredClone(enc.value.setup)
    setup.foes = applyDifficulty(setup.foes, tableFor(st.s.difficulty, st.s.customDiff))
    // 委託的連動（第四版）：minus=N 讓這一場少 N 個敵人（從後排拿掉，至少留一個）
    const minus = Number(route.query.minus) || 0
    if (minus > 0) setup.foes = setup.foes.slice(0, Math.max(1, setup.foes.length - minus))
    // 你的主動技能照橋裡裝著的技能（SKILLS 1.3 節）：沒裝的不能用
    const loaded = g.loadout.map(id => id.split(':')[1])
    setup.party = setup.party.map(p => (p.name === '你' ? { ...p, skills: (p.skills ?? []).filter(n => loaded.includes(n)) } : p))
    return new RealBattle(setup, seed ? seeded(seed) : mathRng)
  },
  { speed, onRing: i => act(RING_KEYS[i]) },
)
// 同一個全頁換了遭遇（只有網址的參數變）：重新開始
watch(() => route.query.enc, () => { restart(); hint.value = '' })
const cur = computed(() => b.value.cur())
const lineTexts = computed(() => b.value.lines.map(l => l.t))
watch(() => b.value.lines.length, (n, o) => {
  if (!live.value.on || n <= o) return
  for (const l of b.value.lines.slice(o, n)) { const r = liveReact(l.t); if (r) dm.value?.push(r.text, r.kind) }
})
const myTurn = computed(() => phase.value === 'player' && !b.value.end)
const items = computed<RingItem[]>(() => REAL_ACTIONS.map(a => ({ ...a, cost: b.value.cost(a.k, cur.value), reason: myTurn.value ? b.value.reason(a.k) : '現在是敵人的回合', key: RING_KEYS.indexOf(a.k) + 1 })))
function act(k: string) {
  if (!myTurn.value) return
  const r = b.value.reason(k)
  if (r) { hint.value = `${REAL_ACTIONS.find(a => a.k === k)?.n}：${r}。`; return }
  b.value.act(k)
  const a = REAL_ACTIONS.find(x => x.k === k)!
  hint.value = b.value.mode && a.tg ? TARGET_HINT[a.tg] : ''
  after()
}
function clickTarget(t: Target) { if (pick(t)) hint.value = '' }
/** 行動圓環中心的技能清單（第四版）：瞄準、連射、快駭、機甲、無人機、控制節點 */
const skillList = computed(() => (myTurn.value ? b.value.skillList(cur.value) : []))
function useSkill(k: string) {
  const r = b.value.skillReason(k)
  const s = skillList.value.find(x => x.k === k)
  if (r) { hint.value = `${s?.n ?? '技能'}：${r}。`; return }
  b.value.skillAct(k)
  hint.value = b.value.mode ? (s?.tg === 'pslot' ? '選我方的一格（綠框）。' : s?.tg === 'marked' ? '選一個被標記的敵人。' : TARGET_HINT.foe) : ''
  after()
}
const dronesAt = (s: { side: Side; slot: number }) => b.value.drones.filter(d => !d.down && d.side === s.side && d.slot === s.slot)
const isTarget = (t: Target) => targets.value.some(x => (x.kind === 'unit' && t.kind === 'unit' && x.id === t.id) || (x.kind === 'slot' && t.kind === 'slot' && x.side === t.side && x.slot === t.slot))

const SLOTS: Array<{ side: Side; slot: number }> = [4, 3, 2, 1].map(slot => ({ side: 'P' as Side, slot })).concat([1, 2, 3, 4].map(slot => ({ side: 'E' as Side, slot })))
const slotStyle = (s: { side: Side; slot: number }) => ({ '--c': s.side === 'P' ? 5 - s.slot : 5 + s.slot, '--mc': s.slot, '--mr': s.side === 'E' ? 1 : 3 })
const unitAt = (s: { side: Side; slot: number }) => b.value.at(s.side, s.slot)
const pct = (v: number, m: number) => `${Math.max(0, Math.min(100, (v / m) * 100))}%`
const hcOf = (u: RealUnit) => (b.value.mode === 'shoot' || b.value.mode === 'melee') && u.side === 'E' && isTarget({ kind: 'unit', id: u.id }) ? b.value.hitChance(cur.value, u) : null
function statuses(u: RealUnit) {
  return [u.mechOn && `機甲 ${u.mechDur}・剩 ${u.mechLeft} 回合`, u.mark !== null && '被標記', u.aim && '瞄準', u.stun && '過載', u.supp && '被壓制', u.watch && '監視', u.bleed && '流血', u.daze && '暈眩', u.id === b.value.captureId && '要活的'].filter(Boolean) as string[]
}
const distances = computed(() => cur.value.side === 'P' ? b.value.alive('E').sort((x, y) => x.slot - y.slot).map(t => `${t.name} ${b.value.dist(cur.value, t)}`).join('・') : '')
const skills = computed(() => g.loadout.map(id => SKILL_TREES.flatMap(t => t.skills).find(s => s.id === id)?.name).filter(Boolean) as string[])

// ---- 結束 ----
const RESULT: Record<string, string> = { win: '勝利', lose: '戰敗', fled: '脫離', surrender: '投降', retreat: '撤退', located: '被定位' }
function writeBack() {
  const you = b.value.units.find(u => u.side === 'P' && u.name === '你')
  const zero = b.value.units.find(u => u.side === 'P' && u.name === '零')
  for (const [id, u] of [['me', you], ['zero', zero]] as const) {
    const m = g.party.find(p => p.id === id)
    if (!m || !u) continue
    m.hp[0] = Math.max(1, Math.round((u.hp / u.hpMax) * m.hp[1]))
    m.load[0] = Math.min(m.load[1], Math.round((u.load / u.loadMax) * m.load[1]))
    m.afterglow = Math.min(5, m.afterglow + u.layers)
  }
  const e = b.value.end!
  g.advance(b.value.round * 2)
  g.addLog({ prose: [`${enc.value.place}：${enc.value.name}。${e.text}`], changes: [{ text: `${RESULT[e.result]}・${b.value.round} 回合`, kind: e.result === 'win' || e.result === 'fled' ? 'plus' : 'minus' }] })
}
function leave() {
  liveWin.value?.stop()
  writeBack()
  const lines = b.value.lines.map(l => l.t)
  g.lastBattle = { kind: 'real', result: b.value.end!.result, text: b.value.end!.text, rounds: b.value.round, crits: lines.filter(t => /^(?!敵・).*要害/.test(t)).length, downs: b.value.units.filter(u => u.side === 'P' && u.down).length, lethal: b.value.units.filter(u => u.side === 'E' && u.down && !u.out).length }
  router.push(from.value)
}
</script>

<template>
  <div class="bt-screen">
    <StatusBar back :title="`現實戰鬥：${enc.name}`" />
    <div class="bt-wrap">
      <section class="panel cut bt-top">
        <span class="ttl">{{ enc.place }}</span>
        <span class="tag hot">第 {{ b.round }} 回合</span>
        <div class="bt-order" aria-label="先攻條">
          <span v-for="o in b.orderView()" :key="o.u.id" class="bt-chip" :class="{ e: o.u.side === 'E', now: o.now }">{{ o.u.name }}</span>
        </div>
        <span class="grow" />
        <span v-if="b.dark" class="tag warn" data-field="dark">黑暗<Hint>全場迴避 +2；有夜視的單位攻擊時不受影響（COMBAT_SYSTEM 2.5 節）。</Hint></span>
        <span v-for="n in b.nodes" :key="n.id" class="tag" :class="{ hot: n.taken && !n.used }" :data-node="n.kind">{{ n.name }}・{{ n.used ? '用過了' : n.taken ? '拿下了' : '沒拿下' }}</span>
        <Hint v-if="b.nodes.length" title="控制節點">潛網者用快駭拿下控制節點，之後從技能清單用：關燈（場地變成黑暗）、放下防爆門（替我方一格造出掩體）、接管砲塔（照無人機的規則掛在我方一格）。</Hint>
        <span v-if="live.on" class="live mono" data-live-on>● LIVE　觀看 {{ live.viewers.toLocaleString('en-US') }}</span>
        <button v-else type="button" class="btn sm" :class="{ pri: liveOn }" @click="liveOn = !liveOn">直播</button>
        <button type="button" class="btn sm" :disabled="live.on" :title="live.on ? '直播中不能重新開始' : undefined" @click="restart(); hint = ''">重新開始</button>
        <Hint title="現實戰鬥">雙方各一排四格，面對面；格子底下是那一格的遮蔽（掩體 +4、半掩體 +2）。每回合回 3 點行動點。卡片上紅的是生命、粉的是感載，圓點是餘韻（疊滿之後再過載就倒下）。鍵盤：1～9 按圓環的格，Tab 換目標、Enter 確定、Esc 取消，空白鍵結束回合。脫離與投降要長按。</Hint>
      </section>

      <section class="panel cut bt-fieldp">
        <Danmaku ref="dm" />
        <div class="bt-field">
          <template v-for="s in SLOTS" :key="s.side + s.slot">
            <div class="bt-slot" :style="slotStyle(s)"
              :class="{ tg: isTarget({ kind: 'slot', side: s.side, slot: s.slot }), foc: isFocused({ kind: 'slot', side: s.side, slot: s.slot }) }"
              :role="isTarget({ kind: 'slot', side: s.side, slot: s.slot }) ? 'button' : undefined"
              :tabindex="isTarget({ kind: 'slot', side: s.side, slot: s.slot }) ? 0 : undefined"
              :data-slot="s.side + s.slot"
              @click="isTarget({ kind: 'slot', side: s.side, slot: s.slot }) && clickTarget({ kind: 'slot', side: s.side, slot: s.slot })">
              <div class="bt-sh" :aria-label="`第 ${s.slot} 格，${REAL_COVER_NAMES[b.cov[s.side][s.slot].l]}`">
                <template v-if="b.cov[s.side][s.slot].l">
                  <svg class="bt-i" viewBox="0 0 512 512" aria-hidden="true"><path :d="COMBAT_ICONS[b.cov[s.side][s.slot].l === 2 ? 'cov' : 'half']" /></svg>
                  <span class="bt-bar" :class="{ half: b.cov[s.side][s.slot].l === 1 }"><i :style="{ width: pct(b.cov[s.side][s.slot].d, COVER_DUR[b.cov[s.side][s.slot].l]), background: 'var(--sink)' }" /></span>
                  {{ Math.max(0, b.cov[s.side][s.slot].d) }}
                </template>
                <span v-else class="t-fine">暴露</span>
              </div>
              <div v-if="unitAt(s)" class="bt-u" :class="{ e: s.side === 'E', act: unitAt(s)!.id === cur.id && !b.end, tg: isTarget({ kind: 'unit', id: unitAt(s)!.id }), foc: isFocused({ kind: 'unit', id: unitAt(s)!.id }) }"
                :role="isTarget({ kind: 'unit', id: unitAt(s)!.id }) ? 'button' : undefined" :tabindex="isTarget({ kind: 'unit', id: unitAt(s)!.id }) ? 0 : undefined"
                :data-unit="unitAt(s)!.id" :aria-label="`${unitAt(s)!.name}，生命 ${unitAt(s)!.hp}，感載 ${unitAt(s)!.load}`"
                @click.stop="isTarget({ kind: 'unit', id: unitAt(s)!.id }) ? clickTarget({ kind: 'unit', id: unitAt(s)!.id }) : isTarget({ kind: 'slot', side: s.side, slot: s.slot }) && clickTarget({ kind: 'slot', side: s.side, slot: s.slot })"
                @keydown.enter.stop.prevent="isTarget({ kind: 'unit', id: unitAt(s)!.id }) && clickTarget({ kind: 'unit', id: unitAt(s)!.id })">
                <div class="bt-nm"><b>{{ unitAt(s)!.name }}</b><small><template v-if="hcOf(unitAt(s)!) !== null"><span class="hc">{{ hcOf(unitAt(s)!) }}%</span> </template>{{ unitAt(s)!.role }}</small></div>
                <div class="bt-row" style="color: var(--hp)"><svg class="bt-i" viewBox="0 0 512 512" aria-label="生命"><path :d="COMBAT_ICONS.hp" /></svg><span class="bt-bar"><i :style="{ width: pct(unitAt(s)!.hp, unitAt(s)!.hpMax), background: 'var(--hp)' }" /></span><span class="num">{{ unitAt(s)!.hp }}</span></div>
                <div class="bt-row" style="color: var(--load)"><svg class="bt-i" viewBox="0 0 512 512" aria-label="感載"><path :d="COMBAT_ICONS.load" /></svg><span class="bt-bar"><i :style="{ width: pct(unitAt(s)!.load, unitAt(s)!.loadMax), background: 'var(--load)' }" /></span><span class="num">{{ unitAt(s)!.load }}</span></div>
                <div class="bt-row" title="餘韻層數（疊滿之後再過載就倒下）"><span class="bt-pips l"><i v-for="n in unitAt(s)!.layersMax" :key="n" :class="{ f: n <= unitAt(s)!.layers }" /></span></div>
                <div class="bt-row" style="color: var(--ap)"><svg class="bt-i" viewBox="0 0 512 512" aria-label="行動點"><path :d="COMBAT_ICONS.ap" /></svg><span class="bt-pips"><i v-for="n in unitAt(s)!.apMax" :key="n" :class="{ f: n <= unitAt(s)!.ap }" /></span></div>
                <div class="bt-row wpn">{{ REAL_WEAPONS[unitAt(s)!.ws[unitAt(s)!.wi].k].n }}<span v-if="REAL_WEAPONS[unitAt(s)!.ws[unitAt(s)!.wi].k].mag" class="bt-pips m"><i v-for="n in REAL_WEAPONS[unitAt(s)!.ws[unitAt(s)!.wi].k].mag" :key="n" :class="{ f: n <= unitAt(s)!.ws[unitAt(s)!.wi].mag }" /></span></div>
                <div class="bt-st"><span v-for="t in statuses(unitAt(s)!)" :key="t" :class="{ w: t === '過載' || t === '流血' || t === '要活的' }">{{ t }}</span></div>
              </div>
              <div v-else class="bt-down">空格</div>
              <div v-for="d in dronesAt(s)" :key="d.id" class="bt-drone" :data-drone="d.kind" :title="`${d.name}：耐久 ${d.hp}／${d.hpMax}，護甲 ${d.armor}；永遠暴露`">
                <b>{{ d.turret ? '砲塔' : d.kind === 'atk' ? '攻擊機' : '護盾機' }}</b><span class="bt-bar"><i :style="{ width: pct(d.hp, d.hpMax), background: 'var(--ram)' }" /></span>{{ d.hp }}<small v-if="d.kind === 'shield' && d.guard">護盾</small>
              </div>
            </div>
          </template>
          <div class="bt-mid">近身</div>
        </div>
        <div class="bt-dir" aria-hidden="true"><span class="p">◀ 後排　我方　前排 ▶</span><span class="e">◀ 前排　敵方　後排 ▶</span></div>
      </section>

      <section v-if="b.end" class="panel cut bt-end" :class="{ lose: b.end.result === 'lose' || b.end.result === 'surrender' }" data-end="real">
        <h3>{{ RESULT[b.end.result] }}</h3>
        <p>{{ b.end.text }}</p>
        <div class="bt-btns">
          <button type="button" class="btn pri" @click="leave">回到{{ from === '/' ? '主畫面' : from === '/dungeon' ? '地下城' : '地圖' }}</button>
          <button type="button" class="btn" @click="restart(); hint = ''">再打一次</button>
        </div>
      </section>

      <div class="bt-lower">
        <section class="panel cut bt-actp" :data-phase="phase">
          <ActionRing :items="items" :selected="b.mode" :off="!myTurn" :skill-open="skillOpen" @act="act" @skill="skillOpen = !skillOpen" />
          <div class="bt-side">
            <div class="bt-who"><span class="k">現在</span><b>{{ cur.side === 'E' ? '敵・' : '' }}{{ cur.name }}</b><span class="t-fine">第 {{ cur.slot }} 格</span><span v-if="cur.side === 'P'" class="t-fine">行動點 {{ cur.ap }}／{{ cur.apMax }}</span></div>
            <div v-if="distances" class="t-fine">距離：{{ distances }}</div>
            <div class="bt-btns">
              <button type="button" class="btn pri" :aria-disabled="!myTurn || undefined" :class="{ 'is-unavailable': !myTurn }" @click="endTurn">結束回合<kbd>Space</kbd></button>
              <HoldButton :reason="!myTurn ? '現在不是你的回合' : cur.ap < 2 ? '行動點不夠（要 2 點）' : null" @fire="b.flee(); after()" @hint="t => (hint = t)">脫離<small>2</small></HoldButton>
              <HoldButton :reason="b.end ? '戰鬥已經結束' : null" @fire="b.surrender(); after()" @hint="t => (hint = t)">投降</HoldButton>
            </div>
            <div class="bt-hint" aria-live="polite">{{ myTurn ? hint || `輪到 ${cur.name}。選一個行動。` : b.end ? '' : '敵人的回合……' }}</div>
            <div v-if="skillOpen" class="bt-skl" data-skills>
              <b>技能清單・{{ cur.name }}<template v-if="cur.hack">・RAM {{ cur.ram }}／{{ cur.hack.ram }}</template></b>
              <div v-if="!skillList.length" class="t-fine">{{ myTurn ? `${cur.name}沒有可以在戰鬥裡用的主動技能。` : '現在不是你的回合。' }}裝著的技能：{{ skills.join('、') || '沒有' }}。</div>
              <button v-for="sk in skillList" :key="sk.k" type="button" class="bt-sk" :class="{ on: b.mode === `sk:${sk.k}`, 'is-unavailable': !!b.skillReason(sk.k) }" :title="b.skillReason(sk.k) ?? sk.d" :data-skill="sk.k" @click="useSkill(sk.k)">
                <b>{{ sk.n }}</b><small class="mono">{{ sk.c }} 點{{ sk.ram ? `・RAM ${sk.ram}` : '' }}</small><span class="t-fine sd">{{ sk.d }}</span>
              </button>
            </div>
          </div>
        </section>
        <section class="panel cut bt-logp">
          <p class="h">戰鬥紀錄</p>
          <div class="bt-log" aria-live="polite"><p v-for="(l, i) in b.lines.slice().reverse()" :key="b.lines.length - i" :class="l.c">{{ l.t }}</p></div>
        </section>
      </div>
      <LiveWindow v-if="liveOn || live.on" ref="liveWin" :lines="lineTexts" :title="`戰鬥直播：${enc.name}`" :locked="b.end ? '戰鬥已經結束了' : null"
        @chat="(t, k) => dm?.push(t, k)" @state="s => (live = s)" @close="liveOn = false; live = { on: false, viewers: 0 }" />
    </div>
  </div>
</template>

<style scoped>
.live { color: var(--hp); font-weight: 900; font-size: var(--fs-sm); }
</style>
