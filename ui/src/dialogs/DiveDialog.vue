<script setup lang="ts">
import { computed, ref } from 'vue'
import Dialog from '../components/Dialog.vue'
import Hint from '../components/Hint.vue'
import MoneyTag from '../components/MoneyTag.vue'
import ReasonButton from '../components/ReasonButton.vue'
import { useEngine } from '../stores/engine'
import { useUi } from '../stores/ui'
import { OVER_NAME, bracketKey, bracketRule, costParts, deckLine, DECK_NAME, keptLine, roman, sortSites } from '../lib/diveView'
import { failText } from '../lib/lifeView'

/**
 * 潛入與登出（UI.md 第 5 節開頭、CYBERSPACE 2.2～2.4 節、8.2 節；dev/work/M3-ui-dive.md）：站在接入點上看到費用與用的甲板再決定潛不潛；
 * 潛入之後選去處（去不了的灰掉並寫原因）、報名迷宮館、登出。費用、押金、能不能去、評價與獎金全是引擎的（features/dive、maze）；這裡只編排。
 * 內海皮由 App.vue 照引擎的 diving 換。
 */
defineProps<{ entryId: number; stacked?: boolean }>()
const e = useEngine()
const ui = useUi()

const view = computed(() => e.dive.view())
const opts = computed(() => view.value.options)
const dive = computed(() => view.value.dive)
const sites = computed(() => sortSites(view.value.sites))
const brackets = computed(() => (view.value.diving ? e.maze.brackets() : []))
const parts = computed(() => costParts(opts.value))
const bodyAt = computed(() => (dive.value ? e.placeName(dive.value.body) : ''))
/** 自己去挖的去處（setup.site 對得上留著的子網）上次離開的日子：引擎的 keptOf，沒有留著的不寫 */
const keptOf = (id: string) => {
  const s = e.dive.view().sites.find(x => x.id === id)
  const site = (e.world.entry<{ setup?: { site?: string } }>('net_site', id)?.setup?.site) ?? null
  return s && site ? e.dive.kept(site) : null
}

function report(r: { status: string; reason?: string }, fallback: string): boolean {
  const why = failText(r, fallback)
  if (why) { ui.toast(why, 'warn'); return false }
  return true
}
async function enter() {
  if (report(await e.dive.enter(), '現在潛不進去。')) ui.toast(e.state.reports.at(-1)?.outcome.summary ?? '潛入了。')
}
async function go(id: string) { report(await e.dive.go(id), '現在去不了。') }
async function exit() {
  if (report(await e.dive.exit(), '現在登不出。')) { ui.toast(e.state.reports.at(-1)?.outcome.summary ?? '登出了。'); ui.close() }
}
const confirmOut = ref(false)
async function mazeEnter(b: { id: string; grade: number }) { report(await e.maze.enter(b.id, b.grade), '現在報不了名。') }
</script>

<template>
  <Dialog :entry-id="entryId" :stacked="stacked" title="潛入與登出" :sub="dive ? `潛入中・${dive.name}` : opts.here?.name ?? '這裡沒有接入點'" size="lg">
    <template #header><Hint title="潛入">站在潛艙店這類有接入艙的設施上才能潛入。有自己的甲板用自己的；沒有就租這裡的（要押金，登出時退）；都沒有只能以訪客的身分進去。進去之後身體留在接入艙裡，現實的事（休息、搭車、接案）要先登出。被定位或戰敗會被強制斷線，押金沒收。</Hint></template>

    <section v-if="!view.diving" class="panel cut pad" data-enter>
      <p class="h">接入點</p>
      <template v-if="opts.here">
        <div class="kv"><span>在哪</span><b data-here-name>{{ opts.here.name }}</b></div>
        <div class="kv"><span>用的甲板</span><b data-deck>{{ deckLine(opts) }}</b></div>
        <div v-for="p in parts" :key="p.label" class="kv" data-cost-row><span>{{ p.label }}</span><b><MoneyTag kind="cash" :amount="p.amount" /></b></div>
        <div class="kv"><span>一共付</span><b data-total><MoneyTag kind="cash" :amount="opts.cost" /></b></div>
      </template>
      <div v-if="opts.block" class="blocking" data-enter-why>{{ opts.block }}</div>
      <div class="go left"><ReasonButton pri :reason="opts.block" data-dive-enter @go="enter">潛入</ReasonButton></div>
    </section>

    <template v-else-if="dive">
      <section class="panel cut pad mt" data-status>
        <p class="h">身體</p>
        <div class="kv"><span>躺在</span><b data-body>{{ dive.name }}<small v-if="bodyAt">（{{ bodyAt }}）</small></b></div>
        <div class="kv"><span>用的甲板</span><b>{{ DECK_NAME[dive.deck] }}</b></div>
        <div v-if="dive.paid.fee > 0 || dive.paid.deposit > 0" class="kv"><span>付了</span><b>費用 <MoneyTag kind="cash" :amount="dive.paid.fee" /><template v-if="dive.paid.deposit > 0">・押金 <MoneyTag kind="cash" :amount="dive.paid.deposit" /></template></b></div>
        <div v-if="dive.over" class="blocking" data-over>{{ OVER_NAME[dive.over] }}：先登出。</div>
      </section>

      <section class="panel cut pad mt" data-sites>
        <p class="h">去處<Hint>自己去挖的子網要有甲板（租的也行）；訪客只能去不需要甲板的地方。去不了的灰掉，點了說原因。</Hint></p>
        <div v-if="!sites.length" class="empty-note">現在沒有去處。</div>
        <div class="grid2">
          <div v-for="s in sites" :key="s.id" class="site" :class="{ 'is-unavailable': !!s.block }" :data-site="s.id">
            <span class="grow"><b>{{ s.name }}</b><small v-if="s.desc">{{ s.desc }}</small>
              <small v-if="keptOf(s.id)" class="kept" data-kept>{{ keptLine(keptOf(s.id)!) }}</small></span>
            <ReasonButton sm pri :reason="s.block" :data-go="s.id" @go="go(s.id)">前往</ReasonButton>
          </div>
        </div>
      </section>

      <section class="panel cut pad mt" data-maze>
        <p class="h">迷宮館<Hint title="迷宮館">合法的地下城：報名付押金，三層、機關與寶箱，照回合數與倒下的人數評價。破關拿獎金並退押金；沒闖過押金沒收。新手組一律用館方發的比賽甲板與比賽版構裝。</Hint></p>
        <div class="grid2">
          <div v-for="b in brackets" :key="bracketKey(b)" class="site" :class="{ 'is-unavailable': !!b.block }" :data-bracket="bracketKey(b)">
            <span class="grow"><b>{{ b.name }}（{{ roman(b.grade) }}）</b>
              <small>押金 <MoneyTag kind="cash" :amount="b.deposit" />・破關獎金 <MoneyTag kind="cash" :amount="b.prize" />（乘評價）</small>
              <small data-rule>{{ bracketRule(b) }}</small>
              <small v-if="b.block" class="why" data-why>{{ b.block }}</small></span>
            <ReasonButton sm pri :reason="b.block" :data-enroll="bracketKey(b)" @go="mazeEnter(b)">報名</ReasonButton>
          </div>
        </div>
      </section>

      <section class="panel cut pad mt" data-exit>
        <p class="h">登出</p>
        <p class="note" data-exit-note>{{ view.exit?.note }}</p>
        <div v-if="view.exit?.block" class="blocking" data-exit-why>{{ view.exit.block }}</div>
        <div class="go left">
          <template v-if="!confirmOut"><ReasonButton :reason="view.exit?.block" data-exit-btn @go="confirmOut = true">登出</ReasonButton></template>
          <template v-else><button type="button" class="btn sm" data-exit-cancel @click="confirmOut = false">取消</button><button type="button" class="btn sm pri" data-exit-ok @click="exit">確定登出<template v-if="view.exit && view.exit.refund > 0">（退押金）</template></button></template>
        </div>
      </section>
    </template>
  </Dialog>
</template>

<style scoped>
.mt { margin-top: var(--space-4); }
.note { margin: 0 0 var(--space-3); color: var(--ink-3); font-size: var(--fs-fine); line-height: 1.6; }
.site { display: flex; gap: var(--space-3); align-items: flex-start; padding: var(--space-3); background: var(--bg-2); box-shadow: inset 0 0 0 1px var(--line-2); }
.site .grow { flex: 1; min-width: 0; display: grid; gap: 2px; }
.site small { color: var(--ink-3); font-size: var(--fs-fine); line-height: 1.5; }
.site .kept { color: var(--ram); }
.site .why { color: var(--warn); }
.go.left { justify-content: flex-start; }
</style>
