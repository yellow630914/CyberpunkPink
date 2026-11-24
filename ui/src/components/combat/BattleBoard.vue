<script setup lang="ts">
import { computed, ref } from 'vue'
import { useRouter } from 'vue-router'
import { END_TURN } from '@engine/src'
import Hint from '../Hint.vue'
import ActionRing from './ActionRing.vue'
import HoldButton from './HoldButton.vue'
import LiveWindow from './LiveWindow.vue'
import Danmaku from './Danmaku.vue'
import DefeatPanel from './DefeatPanel.vue'
import SpoilsPanel from './SpoilsPanel.vue'
import NetSync from './NetSync.vue'
import NetTrace from './NetTrace.vue'
import NetAdmin from './NetAdmin.vue'
import { COMBAT_ICONS } from '../../data/combatIcons'
import { disabledReason, type CellUnit } from '../../lib/battleView'
import { outLabel, unitMarks, type UnitMark } from '../../lib/netView'
import { useBattle } from '../../lib/useBattle'

/**
 * 戰鬥的畫面本體（現實戰鬥 CombatScreen 與內海戰鬥 NetCombatScreen 共用一組，COMBAT_SYSTEM 第 10 節、dev/adr/0018 第十二節）：
 * 先攻條、雙方四格、行動圓環、目標與 picks 的流程、紀錄、回合按鈕、戰敗與戰利品的面板。畫面只編排：狀態、能不能做、為什麼不能、命中率、花幾點、誰先動，
 * 都讀引擎（useBattle 讀 store 的 battle、battleOptions、netBattle）；這裡不寫規則。
 * 是哪一種戰場看引擎給的戰場資料（battleMode().layer），不看網址：內海多出同步檔位、追蹤度條、管理行動三塊，卡片換成感載一條加 RAM 分格，遮蔽叫防火牆。
 */
const props = defineProps<{ from: string; fast?: boolean; enc?: string; fallback?: boolean }>()
const router = useRouter()

const dm = ref<InstanceType<typeof Danmaku> | null>(null)
const liveWin = ref<InstanceType<typeof LiveWindow> | null>(null)
const bt = useBattle({ from: () => props.from, fast: () => !!props.fast, enc: () => props.enc, fallback: !!props.fallback, beforeLeave: () => liveWin.value?.stop() })
bt.bindDanmaku((text, kind) => dm.value?.push(text, kind))
const {
  engine, hint, skillOpen, liveOn, live, liveEvents, lines, settling, mobile, layout, traceBump,
  battle, options, isNet, view, net, myTurn, over, cur, ring, place, cellOf,
  iconOf, reasonOf, ringItems, systemActions, skillList, gears, trace, admin, inCommission,
  selId, selAction, flow, hit, unitHit, slotHit, stateOf, isFocused, chooseAction, activate, pickOption, submit, fire, shiftTo, chanceOf,
  resultName, retreat, lost, leave, settle, stage, retry, pct, fieldStyle, rankLabel, afterBattle,
} = bt

/** 一張卡片上的標記（引擎給的：閃斷、被停用的構裝、破損、標記、檔位）；只有內海才有 */
function marksOf(u: CellUnit): UnitMark[] {
  if (!isNet.value) return []
  return unitMarks(u, battle.value?.units[u.id], net.value?.units.find((x) => x.unit === u.id))
}
/** 卡片上其餘的狀態：已經畫成標記的不重複 */
function plainStatuses(u: CellUnit): string[] {
  const shown = new Set(marksOf(u).map((m) => m.key))
  return u.statuses.filter((_, i) => !shown.has(`st:${u.statusIds[i]}`))
}
const noBattle = computed(() => !engine.inBattle && !engine.pendingDefeat && !afterBattle.spoils.value)
</script>

<template>
  <div class="bt-wrap" :data-layer="isNet ? 'net' : 'meat'">
    <section v-if="!engine.hasCharacter" class="panel cut bt-end" data-nochar>
      <h3>先建好角色再來</h3>
      <p>戰鬥要有隊伍：先開新局、把主角建好。</p>
      <div class="bt-btns"><button type="button" class="btn pri" @click="router.push('/newgame')">去建角</button></div>
    </section>

    <DefeatPanel v-else-if="!engine.inBattle && engine.pendingDefeat" :note="hint" @leave="leave" @retry="retry" @stage="stage" />

    <SpoilsPanel v-else-if="!engine.inBattle && afterBattle.spoils.value" :spoils="afterBattle.spoils.value" :place="engine.placeName(engine.state.location)" @leave="leave" />

    <section v-else-if="noBattle" class="panel cut bt-end" data-nobattle>
      <h3>現在沒有進行中的戰鬥</h3>
      <p>戰鬥由引擎開：{{ props.fallback ? '從地下城、委託或街上遇到的事走進來。' : '潛入子網遇上敵人，或接了網內的委託，才會開打。' }}</p>
      <div class="bt-btns"><button type="button" class="btn pri" data-back @click="leave">回去</button></div>
    </section>

    <template v-else-if="battle && options && view">
      <section class="panel cut bt-top">
        <span class="ttl">{{ isNet ? `INNER SEA // ${place}` : place }}</span>
        <span class="tag hot" data-round>第 {{ view.round }} 回合</span>
        <NetTrace v-if="trace" :bar="trace" :bump="traceBump" />
        <span class="grow" />
        <span v-if="view.field.dark" class="tag warn" data-field="dark">黑暗<Hint>全場迴避 +2；有夜視的單位攻擊時不受影響（COMBAT_SYSTEM 2.5 節）。</Hint></span>
        <template v-for="n in view.nodes" :key="n.id">
          <button v-if="hit(`n:${n.id}`)" type="button" class="tag tgt" :class="stateOf(hit(`n:${n.id}`))" :title="hit(`n:${n.id}`)?.reason || undefined" :data-node="n.id" @click="activate(hit(`n:${n.id}`))">{{ n.name }}・{{ n.used ? '用過了' : n.taken ? '拿下了' : '沒拿下' }}</button>
          <span v-else class="tag" :class="{ hot: n.taken && !n.used }" :data-node="n.id">{{ n.name }}・{{ n.used ? '用過了' : n.taken ? '拿下了' : '沒拿下' }}</span>
        </template>
        <template v-if="!isNet">
          <span v-if="live.on" class="live mono" data-live-on>● LIVE　觀看 {{ live.viewers.toLocaleString('en-US') }}</span>
          <button v-else type="button" class="btn sm" :class="{ pri: liveOn }" @click="liveOn = !liveOn">直播</button>
        </template>
        <button type="button" class="btn sm" :disabled="live.on" :title="live.on ? '直播中不能重新開始' : undefined" data-restart @click="retry">重新開始</button>
        <Hint v-if="isNet" title="內海戰鬥">和現實同一個版面：卡片上只有感載一條，遮蔽換成防火牆。攻擊花 RAM；同步檔位每回合換一次：越深檢定越高、受到的感載越重。餘韻在內海裡是加成。感載在內海不會自己消退（基礎是 0）：只有技能與甲板的散熱、休息點與腳本會把它降下來。追蹤度隨回合往上，過了刻度對方會增援，被定位就會被強制斷線。過載的人會閃斷：RAM 斷了，到狀態結束才回復。拔線（長按）讓這個人登出；全隊都拔線就是撤退。鍵盤：1～9 按圓環的格，Tab 換目標、Enter 確定、Esc 取消，空白鍵結束回合。</Hint>
        <Hint v-else title="現實戰鬥">雙方各一排四格，面對面；格子底下是那一格的遮蔽。卡片上紅的是生命、粉的是感載，圓點是餘韻（疊滿之後再過載就倒下）。鍵盤：1～9 按圓環的格，Tab 換目標、Enter 確定、Esc 取消，空白鍵結束回合。脫離與投降要長按。手機上敵人在上排、我方在下排，兩排的第 1 格都在左邊。</Hint>
        <div class="bt-order" aria-label="先攻條" style="flex-basis: 100%">
          <span v-for="o in view.order" :key="o.id" class="bt-chip" :class="{ e: o.side === 'foe', now: o.now, gone: !!o.out, pinned: o.out === 'pinned' }" :title="o.out ? outLabel(o.out) : undefined" :data-out="o.out || undefined">{{ o.name }}<small v-if="o.out === 'pinned' || o.out === 'jacked_out'">　{{ outLabel(o.out) }}</small></span>
        </div>
      </section>

      <section class="panel cut bt-fieldp">
        <Danmaku ref="dm" />
        <div class="bt-field" :class="mobile ? 'm' : 'd'" data-field-grid :data-layout="mobile ? 'mobile' : 'desktop'">
          <template v-for="p in layout" :key="p.side + p.slot">
            <template v-if="cellOf(p)">
              <div class="bt-slot" :style="fieldStyle(p)" :class="[stateOf(slotHit(cellOf(p)!)), { foc: isFocused(`s:${p.side}:${p.slot}`) }]"
                :role="slotHit(cellOf(p)!) ? 'button' : undefined" :tabindex="slotHit(cellOf(p)!) ? 0 : undefined" :data-slot="(p.side === 'ally' ? 'P' : 'E') + p.slot" :data-cell="p.side + p.slot"
                :title="slotHit(cellOf(p)!)?.reason || undefined"
                @click="activate(slotHit(cellOf(p)!))">
                <div class="bt-sh" :aria-label="`第 ${p.slot} 格，${cellOf(p)!.cover.name}`" data-cover>
                  <template v-if="cellOf(p)!.cover.level">
                    <svg class="bt-i" viewBox="0 0 512 512" aria-hidden="true"><path :d="COMBAT_ICONS[cellOf(p)!.cover.level === 2 ? 'cov' : 'half']" /></svg>
                    <span class="bt-bar" :class="{ half: cellOf(p)!.cover.level === 1 }"><i :style="{ width: pct(cellOf(p)!.cover.hp, cellOf(p)!.cover.max), background: 'var(--sink)' }" /></span>
                    <span v-if="cellOf(p)!.cover.soft" class="t-fine">{{ cellOf(p)!.cover.soft }}</span>
                    <template v-else>{{ cellOf(p)!.cover.hp }}</template>
                  </template>
                  <span v-else class="t-fine">{{ cellOf(p)!.cover.name }}</span>
                </div>
                <div v-if="cellOf(p)!.unit" class="bt-u" :class="[{ e: p.side === 'foe', act: cellOf(p)!.unit!.id === options.current && !over }, stateOf(unitHit(cellOf(p)!)), { foc: isFocused(`u:${cellOf(p)!.unit!.id}`) }]"
                  :role="unitHit(cellOf(p)!) ? 'button' : undefined" :tabindex="unitHit(cellOf(p)!) ? 0 : undefined"
                  :data-unit="cellOf(p)!.unit!.id" :aria-label="`${cellOf(p)!.unit!.name}，${cellOf(p)!.unit!.hp ? `生命 ${cellOf(p)!.unit!.hp!.now}，` : ''}感載 ${cellOf(p)!.unit!.load?.now ?? '無'}`"
                  @click.stop="activate(unitHit(cellOf(p)!))"
                  @keydown.enter.stop.prevent="activate(unitHit(cellOf(p)!))">
                  <div class="bt-nm"><b>{{ cellOf(p)!.unit!.name }}</b><small><span v-if="chanceOf(unitHit(cellOf(p)!))" class="hc" data-chance>{{ chanceOf(unitHit(cellOf(p)!)) }}</span> {{ rankLabel(p.side, cellOf(p)!.unit!.rank) }}</small></div>
                  <div v-if="cellOf(p)!.unit!.hp" class="bt-row" style="color: var(--hp)" data-row="hp"><svg class="bt-i" viewBox="0 0 512 512" aria-label="生命"><path :d="COMBAT_ICONS.hp" /></svg><span class="bt-bar"><i :style="{ width: pct(cellOf(p)!.unit!.hp!.now, cellOf(p)!.unit!.hp!.max), background: 'var(--hp)' }" /></span><span class="num">{{ cellOf(p)!.unit!.hp!.now }}</span></div>
                  <div v-if="cellOf(p)!.unit!.load" class="bt-row" style="color: var(--load)" data-row="load"><svg class="bt-i" viewBox="0 0 512 512" aria-label="感載"><path :d="COMBAT_ICONS.load" /></svg><span class="bt-bar"><i :style="{ width: pct(cellOf(p)!.unit!.load!.now, cellOf(p)!.unit!.load!.max), background: 'var(--load)' }" /></span><span class="num">{{ cellOf(p)!.unit!.load!.now }}</span></div>
                  <div class="bt-row" :title="isNet ? '餘韻層數（每層檢定加成；疊滿之後再過載就斷線）' : '餘韻層數（疊滿之後再過載就倒下）'"><span class="bt-pips l"><i v-for="n in cellOf(p)!.unit!.layersMax" :key="n" :class="{ f: n <= cellOf(p)!.unit!.layers }" /></span></div>
                  <div class="bt-row" style="color: var(--ap)"><svg class="bt-i" viewBox="0 0 512 512" aria-label="行動點"><path :d="COMBAT_ICONS.ap" /></svg><span class="bt-pips"><i v-for="n in cellOf(p)!.unit!.ap.max" :key="n" :class="{ f: n <= cellOf(p)!.unit!.ap.now }" /></span></div>
                  <div v-if="cellOf(p)!.unit!.ram" class="bt-row" style="color: var(--ram)" data-row="ram" :title="`RAM ${cellOf(p)!.unit!.ram!.now}／${cellOf(p)!.unit!.ram!.max}`"><svg class="bt-i" viewBox="0 0 512 512" aria-label="RAM"><path :d="COMBAT_ICONS.ram" /></svg><span v-if="cellOf(p)!.unit!.ram!.max <= 12" class="bt-pips r"><i v-for="n in cellOf(p)!.unit!.ram!.max" :key="n" :class="{ f: n <= cellOf(p)!.unit!.ram!.now }" /></span><span v-else class="mono">{{ cellOf(p)!.unit!.ram!.now }}/{{ cellOf(p)!.unit!.ram!.max }}</span></div>
                  <div class="bt-row wpn">{{ cellOf(p)!.unit!.weapon }}<template v-if="cellOf(p)!.unit!.mag"><span v-if="cellOf(p)!.unit!.mag!.max <= 12" class="bt-pips m"><i v-for="n in cellOf(p)!.unit!.mag!.max" :key="n" :class="{ f: n <= cellOf(p)!.unit!.mag!.now }" /></span><span v-else class="mono">{{ cellOf(p)!.unit!.mag!.now }}/{{ cellOf(p)!.unit!.mag!.max }}</span></template></div>
                  <div class="bt-st"><span v-for="m in marksOf(cellOf(p)!.unit!)" :key="m.key" :class="`m-${m.tone}`" :title="m.title" :data-mark="m.key">{{ m.text }}</span><span v-for="t in plainStatuses(cellOf(p)!.unit!)" :key="t">{{ t }}</span></div>
                </div>
                <div v-else class="bt-down">空格</div>
                <template v-for="o in cellOf(p)!.overlays" :key="o.id">
                  <component :is="hit(`o:${o.id}`) ? 'button' : 'div'" class="bt-drone" :class="[stateOf(hit(`o:${o.id}`)), { foc: isFocused(`o:${o.id}`) }]" :data-drone="o.kind" :title="hit(`o:${o.id}`)?.reason || `${o.name}：耐久 ${o.hp.now}／${o.hp.max}；永遠暴露`"
                    @click.stop="activate(hit(`o:${o.id}`))">
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

      <section v-if="over" class="panel cut bt-end" :class="{ lose: lost }" :data-end="retreat ? 'retreat' : isNet ? 'net' : 'real'">
        <h3>{{ resultName }}</h3>
        <p data-end-text>{{ battle.result?.text }}</p>
        <div class="bt-btns">
          <button type="button" class="btn pri" :disabled="settling" data-settle @click="settle">{{ retreat ? '回去' : '結算' }}</button>
        </div>
        <div class="bt-hint" aria-live="polite">{{ hint }}</div>
      </section>

      <div class="bt-lower">
        <section class="panel cut bt-actp" :data-phase="myTurn ? 'player' : over ? 'over' : 'enemy'">
          <ActionRing :items="ringItems" :selected="selId" :off="!myTurn" :skill-open="skillOpen" ram-label @act="chooseAction" @skill="skillOpen = !skillOpen" />
          <div class="bt-side">
            <div v-if="cur" class="bt-who"><span class="k">現在</span><b>{{ cur.side === 'foe' ? '敵・' : '' }}{{ cur.name }}</b><span class="t-fine">第 {{ cur.slot }} 格</span><span v-if="myTurn" class="t-fine" data-ap>行動點 {{ cur.ap.now }}／{{ cur.ap.max }}<template v-if="cur.pools.ram">・RAM {{ cur.pools.ram.now }}／{{ cur.pools.ram.max }}</template><small class="mono" data-ap-regen title="每個回合開始回的行動點（COMBAT_SYSTEM 1.2 節）；上限另外算。">每回合回 {{ cur.ap.regen }}</small></span></div>
            <div v-if="view.distances.length" class="t-fine" data-distances>距離：{{ view.distances.map((d) => `${d.name} ${d.distance}`).join('・') }}</div>
            <NetSync v-if="gears" :panel="gears" @shift="shiftTo" />
            <NetAdmin v-if="admin" :panel="admin" :selected="selId" @pick="chooseAction" />
            <div v-if="ring" class="bt-btns">
              <template v-for="a in systemActions" :key="a.id">
                <HoldButton v-if="a.hold" :reason="!myTurn ? '現在不是你的回合。' : reasonOf(a)" :data-action="a.id" @fire="fire(a)" @hint="(t) => (hint = t)"><svg class="bt-i" viewBox="0 0 512 512" aria-hidden="true"><path :d="COMBAT_ICONS[iconOf(a)]" /></svg>{{ a.name }}<small v-if="a.cost.ap">{{ a.cost.ap }}</small></HoldButton>
                <button v-else type="button" class="btn" :class="{ pri: a.id === END_TURN, 'is-unavailable': !myTurn || !a.ok }" :aria-disabled="!myTurn || !a.ok || undefined" :data-action="a.id"
                  @click="myTurn && (a.ok ? submit({ action: a.id }) : (hint = reasonOf(a) ?? ''))"><svg class="bt-i" viewBox="0 0 512 512" aria-hidden="true"><path :d="COMBAT_ICONS[iconOf(a)]" /></svg>{{ a.name }}<kbd v-if="a.id === END_TURN">Space</kbd></button>
              </template>
            </div>
            <p v-if="isNet && inCommission" class="t-fine why" data-commission-note>這一場在委託副本裡：全員拔線會回到進副本之前。</p>
            <div class="bt-hint" aria-live="polite" data-hint>{{ myTurn ? hint || `輪到 ${cur?.name ?? ''}。選一個行動。` : over ? '' : hint || `${cur?.name ?? '敵人'}的回合……` }}</div>
            <div v-if="selAction && flow?.picks.length" class="bt-picks" data-picks>
              <div v-for="p in flow.picks" :key="p.key" class="bt-pick" :data-pick="p.key" :data-kind="p.kind">
                <b>{{ p.label }}<small v-if="!p.required" class="t-fine">（可不選）</small></b>
                <button v-for="o in p.options" :key="String(o.value)" type="button" class="btn sm" :class="{ pri: o.selected, 'is-unavailable': !!o.reason }" :aria-disabled="o.reason ? 'true' : undefined" :aria-pressed="o.selected"
                  :title="o.reason ?? undefined" :data-pick-option="String(o.value)" @click="pickOption(p, o)">{{ o.label }}</button>
              </div>
            </div>
            <div v-if="skillOpen" class="bt-skl" data-skills>
              <b>技能清單・{{ cur?.name }}</b>
              <div v-if="!skillList.length" class="t-fine">{{ cur?.name }}沒有可以在戰鬥裡用的主動技能。</div>
              <button v-for="{ a, admin: adm } in skillList" :key="a.id" type="button" class="bt-sk" :class="{ on: selId === a.id, 'is-unavailable': !a.ok }" :title="disabledReason(a) ?? a.desc" :data-skill="a.id" @click="chooseAction(a.id)">
                <svg class="bt-i" viewBox="0 0 512 512" aria-hidden="true"><path :d="COMBAT_ICONS[iconOf(a)]" /></svg><b>{{ a.name }}</b><small class="mono">{{ a.cost.ap }} 點<template v-if="a.cost.ram">・RAM {{ a.cost.ram }}</template></small><small v-if="adm" class="mono adm" data-skill-admin>管理行動 {{ adm }} 次</small><span class="t-fine sd">{{ a.desc }}</span><span v-if="!a.ok" class="t-fine sd no">{{ disabledReason(a) }}</span>
              </button>
            </div>
          </div>
        </section>
        <section class="panel cut bt-logp">
          <p class="h">戰鬥紀錄</p>
          <div class="bt-log" aria-live="polite" data-log><p v-for="(l, i) in lines.slice().reverse()" :key="lines.length - i" :class="l.c">{{ l.t }}</p></div>
        </section>
      </div>
      <LiveWindow v-if="!isNet && (liveOn || live.on)" ref="liveWin" :events="liveEvents" :title="`戰鬥直播：${place}`" :locked="over ? '戰鬥已經結束了' : null"
        @chat="(t, k) => dm?.push(t, k)" @state="(s) => (live = s)" @close="liveOn = false; live = { on: false, viewers: 0 }" />
    </template>
  </div>
</template>

<style scoped>
.live { color: var(--hp); font-weight: 900; font-size: var(--fs-sm); }
.bt-chip.gone { opacity: .45; text-decoration: line-through; }
.bt-chip.pinned { opacity: .8; color: var(--warn); box-shadow: inset 0 0 0 2px var(--warn); }
.bt-chip small { font-weight: 700; }
.bt-field.d { grid-template-columns: repeat(4, minmax(0, 1fr)) 26px repeat(4, minmax(0, 1fr)); }
.bt-field.m { grid-template-columns: repeat(4, minmax(0, 1fr)); grid-template-rows: auto auto auto; }
/* 目標：能選的是綠框，選不了的（有原因）是灰框 */
.bt-slot.tg-no, .bt-u.tg-no, .bt-drone.tg-no, .tag.tg-no { box-shadow: inset 0 0 0 2px var(--ink-3); opacity: .75; cursor: help; }
.bt-slot.tg-no .bt-u.tg-no { box-shadow: inset 0 0 0 2px var(--ink-3); }
button.bt-drone { border: 0; color: inherit; font: inherit; cursor: pointer; text-align: left; }
button.tag.tgt { border: 0; cursor: pointer; font: inherit; }
button.tag.tg { box-shadow: inset 0 0 0 3px var(--ok); }
.bt-pick { display: flex; gap: var(--space-2); flex-wrap: wrap; align-items: center; font-size: var(--fs-sm); }
.bt-picks { display: grid; gap: var(--space-3); }
.bt-pick > b { margin-right: var(--space-2); }
.bt-pick > b small { margin-left: var(--space-1); font-weight: 400; }
.bt-btns .btn .bt-i, .bt-sk .bt-i { display: inline-block; vertical-align: -3px; margin-right: var(--space-2); }
.bt-sk .bt-i { width: 18px; height: 18px; }
[data-ap-regen] { margin-left: var(--space-2); color: var(--ink-3); }
.bt-pick .btn[aria-pressed='true'] { box-shadow: inset 0 0 0 2px var(--ok); }
.bt-sk .no { color: var(--hp); white-space: pre-line; }
.bt-sk .adm { color: var(--ram); }
.bt-hint { white-space: pre-line; }
.why { margin: 0; color: var(--warn); }
.bt-st span.m-bad { color: var(--hp); box-shadow: inset 0 0 0 1px var(--hp); }
.bt-st span.m-warn { color: var(--warn); }
.bt-st span.m-info { color: var(--ram); }
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
