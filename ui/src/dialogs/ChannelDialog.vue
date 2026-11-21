<script setup lang="ts">
import { computed, ref } from 'vue'
import Dialog from '../components/Dialog.vue'
import Tabs from '../components/Tabs.vue'
import Hint from '../components/Hint.vue'
import MoneyTag from '../components/MoneyTag.vue'
import TrackBar from '../components/TrackBar.vue'
import ReasonButton from '../components/ReasonButton.vue'
import GradeBadge from '../components/GradeBadge.vue'
import { useGame } from '../stores/game'
import { useUi } from '../stores/ui'
import { SHOWS, TIERS, GRADES, channelLevel, staffSlots, episodePreview } from '../data/channel'
import { fmt } from '../lib/price'
import { useGuides } from '../lib/useGuides'

/**
 * 頻道（UI 6.2 節，規則 OPINION 第 2 節）。三欄：頻道與預算；開一集與預覽；事件、編制、最近的集數、設備。
 * 每一集當場結算：1d20 ＋ 上鏡者的主要基本功 ＋ 設備（最多 +6）＋ 編制 ＋ 片的品質，對 12 − 推薦權重（沒有媒體型技能 +3）。
 */
defineProps<{ entryId: number; stacked?: boolean }>()
const g = useGame()
const ui = useUi()
useGuides().trigger('g_channel')
const ch = g.channel
const mtab = ref('show')
const showId = ref('live')
const tierId = ref<'all' | 'edge' | 'adult'>('all')
const mode = ref<'錄播' | '直播'>('直播')
const where = ref<'棚內' | '出門'>('出門')
const host = ref<'me' | 'npc_penny' | 'npc_xiaomai'>('me')
const bringProducer = ref(true)
const sponsorAd = ref(false)
/** 上鏡的人：主要基本功與有沒有媒體型技能。 */
const HOSTS = computed(() => ({
  me: { name: '你', skills: { 街頭直覺: g.basics.街頭直覺, 表演: g.basics.表演, 調查: g.basics.調查, 交涉: g.basics.交涉, 誘惑: g.basics.誘惑 }, media: false },
  npc_penny: { name: '潘妮', skills: { 街頭直覺: 2, 表演: 3, 調查: 4, 交涉: 2, 誘惑: 1 }, media: true },
  npc_xiaomai: { name: '小麥', skills: { 街頭直覺: 3, 表演: 2, 調查: 1, 交涉: 4, 誘惑: 2 }, media: false },
}))
const CHECKS: Record<string, string[]> = { live: ['街頭直覺', '表演'], feature: ['調查'], gossip: ['交涉', '表演'], stream: ['表演', '誘惑'], scoop: ['調查', '表演'] }
const show = computed(() => SHOWS.find(s => s.id === showId.value)!)
const tier = computed(() => TIERS.find(t => t.id === tierId.value)!)
const h = computed(() => HOSTS.value[host.value])
const skillName = computed(() => CHECKS[showId.value].reduce((a, b) => ((h.value.skills as Record<string, number>)[b] > (h.value.skills as Record<string, number>)[a] ? b : a)))
const skill = computed(() => (h.value.skills as Record<string, number>)[skillName.value])
const USES: Record<string, string[]> = { 鏡頭: ['live', 'stream', 'feature'], 收音: ['live', 'feature', 'gossip', 'stream', 'scoop'], 燈光: ['stream', 'gossip'], 剪輯機: [], 串流: [] }
const gearUsed = computed(() => ch.equipment.filter(e => {
  if (!e.grade) return false
  if (where.value === '出門' && !e.portable) return false
  if (e.cls === '剪輯機') return mode.value === '錄播'
  if (e.cls === '串流') return mode.value === '直播'
  return USES[e.cls].includes(showId.value)
}))
const gearSum = computed(() => Math.min(6, gearUsed.value.reduce((s, e) => s + e.bonus, 0)))
const pv = computed(() => episodePreview({ skill: skill.value, gear: gearSum.value, staff: bringProducer.value ? 2 : 0, quality: 0, weight: ch.weight, mediaSkill: h.value.media }))
const sponsor = computed(() => ch.budget.sponsors[0])
const publicLeft = computed(() => sponsor.value ? sponsor.value.paid - sponsor.value.used : 0)
/** 先檢查帳戶夠不夠再動：不夠就提示並整件不做（引擎不讓錢變負數，不能先加自有資金再扣帳戶）。 */
function subsidize() {
  if (g.money.acc < 500) { ui.toast('帳戶不到 500，補貼不了。', 'warn'); return }
  g.money.acc -= 500
  ch.budget.ownAcc += 500
  ui.toast('從帳戶補貼了 500。')
}
const budgetTotal = computed(() => ch.budget.ownAcc + ch.budget.ownCash + publicLeft.value)
const quota = computed(() => sponsor.value ? Math.round(sponsor.value.paid * 0.2) : 0)
const showBlock = (id: string) => {
  const s = SHOWS.find(x => x.id === id)!
  if (s.path === '主播') {
    if (!h.value.media) return '要讓有主播路數的人上鏡（潘妮）。'
    return '素材庫裡還沒有品質 3 以上的罪證或把柄。'
  }
  return null
}
const visibleShows = computed(() => SHOWS.filter(s => !s.path || g.roster.some(r => r.paths.some(p => p.tree === s.path))))
const blockReason = computed(() => {
  if (showBlock(showId.value)) return showBlock(showId.value)
  if (!h.value.media && mode.value === '直播' && (showId.value === 'feature' || (showId.value === 'stream' && tierId.value === 'adult'))) return '沒有媒體型技能的人開不出這種直播。'
  if (sponsorAd.value && tierId.value !== 'all') return '萬華鏡的贊助不接擦邊與成人檔。'
  if (show.value.cost > budgetTotal.value) return `預算不夠：製作費 ${fmt(show.value.cost)}。`
  return null
})
function rollEpisode() {
  // 製作費先扣公帳，再扣自有資金
  let cost = show.value.cost
  if (sponsor.value) { const take = Math.min(cost, publicLeft.value); sponsor.value.used += take; cost -= take }
  const takeAcc = Math.min(cost, ch.budget.ownAcc); ch.budget.ownAcc -= takeAcc; cost -= takeAcc
  ch.budget.ownCash -= cost
  const d = 1 + Math.floor(Math.random() * 20)
  const total = d + pv.value.mod
  const grade = total <= pv.value.dc - 5 ? GRADES[0] : total < pv.value.dc ? GRADES[1] : total < pv.value.dc + 5 ? GRADES[2] : GRADES[3]
  const subDelta = Math.round(ch.subs * grade.subs * (grade.subs > 0 ? tier.value.sub : 1))
  const views = Math.round(ch.subs * grade.views)
  const tips = Math.round(views * 0.02 * tier.value.tip)
  ch.subs = Math.max(100, ch.subs + subDelta)
  const credShift = (['live', 'feature'].includes(showId.value) ? grade.cred : 0) + tier.value.cred * (['live', 'feature'].includes(showId.value) ? 2 : 1) - (sponsorAd.value ? 1 : 0)
  ch.cred = Math.max(0, Math.min(100, ch.cred + credShift))
  ch.history = [...ch.history.slice(-9), ch.subs]
  const ad = Math.round(views * 0.1 * ch.cred / 50 * (tierId.value === 'all' ? 1 : 0.5))
  ch.budget.ownAcc += ad
  ch.episodes.unshift({ grade: grade.id, show: show.value.name, tier: tier.value.name, mode: mode.value, day: g.day, change: `訂閱 ${subDelta >= 0 ? '+' : '−'}${Math.abs(subDelta)}；打賞 ${tips}`, adult: tierId.value !== 'all' })
  if (host.value === 'me') g.money.acc += tips
  g.advance(show.value.id === 'feature' ? 240 : 120)
  g.addLog({ prose: [`你們開了一集${show.value.name}（${tier.value.name}・${mode.value}），${h.value.name}上鏡。`], roll: { skill: skillName.value, die: d, mod: pv.value.mod, dc: pv.value.dc, result: grade.id === 'hit' ? '大成功' : grade.id === 'flop' ? '大失敗' : grade.id === 'good' ? '成功' : '失敗' }, changes: [{ text: `評價：${grade.name}`, kind: grade.id === 'flop' ? 'minus' : 'plus' }, { text: `訂閱 ${subDelta >= 0 ? '+' : '−'}${Math.abs(subDelta)}`, kind: subDelta >= 0 ? 'plus' : 'minus' }, { text: `廣告 +${ad}（進預算）`, kind: 'plus' }] })
  ui.toast(`評價：${grade.name}。訂閱 ${subDelta >= 0 ? '+' : '−'}${Math.abs(subDelta)}。`)
}
const histMax = computed(() => Math.max(...ch.history))
const histMin = computed(() => Math.min(...ch.history))
const gradeOf = (id: string) => GRADES.find(x => x.id === id)!
</script>

<template>
  <Dialog :entry-id="entryId" :stacked="stacked" title="頻道" :sub="`「${ch.name}」・${channelLevel(ch.subs)} 級・編制 ${staffSlots(ch.subs)} 格`" size="xl">
    <template #header><Tabs v-model="mtab" class="mtabs" :tabs="[{ id: 'show', label: '開一集' }, { id: 'more', label: '事件與編制' }]" /></template>
    <div class="chg" :data-m="mtab">
      <!-- 左：頻道與預算 -->
      <aside class="stack left">
        <section class="panel cut pad">
          <p class="h">頻道</p>
          <div class="two"><div><small class="k">訂閱</small><div class="big-num">{{ fmt(ch.subs) }}</div></div><div><small class="k">公信力</small><div class="big-num">{{ ch.cred }}</div></div></div>
          <svg class="spark" viewBox="0 0 100 30" preserveAspectRatio="none" role="img" :aria-label="`最近十集的訂閱，從 ${ch.history[0]} 到 ${ch.subs}`">
            <polyline :points="ch.history.map((v, i) => `${(i / (ch.history.length - 1)) * 100},${28 - ((v - histMin) / Math.max(1, histMax - histMin)) * 26}`).join(' ')" fill="none" stroke="var(--a)" stroke-width="2" vector-effect="non-scaling-stroke" />
          </svg>
          <p class="h">推薦權重 {{ ch.weight > 0 ? '+' : '' }}{{ ch.weight }}<Hint>−3～+3。平台改演算法、限流成人內容或推薦你時，權重 ±1，持續一週。權重直接降低開一集的難度。</Hint></p>
          <div class="wt"><i v-for="n in 7" :key="n" :class="{ on: n - 4 === ch.weight, neg: n < 4, pos: n > 4 }" /></div>
          <div class="kv"><span>離下一級</span><b>{{ channelLevel(ch.subs) < 3 ? `訂閱還差 ${fmt((channelLevel(ch.subs) === 1 ? 1000 : 10000) - ch.subs)}` : '最高級' }}</b></div>
        </section>
        <section class="panel cut pad">
          <p class="h">預算<Hint>頻道有自己的錢包。開銷先扣公帳，再扣自有資金，所以你自己投的錢留到最後，隨時拿得回來。觀眾的打賞不算預算，直接進上鏡那個人的口袋。</Hint></p>
          <div class="two"><MoneyTag kind="acc" :amount="ch.budget.ownAcc" /><MoneyTag kind="cash" :amount="ch.budget.ownCash" /></div>
          <div class="kv"><span>自有資金</span><b>{{ fmt(ch.budget.ownAcc + ch.budget.ownCash) }}</b></div>
          <template v-for="sp in ch.budget.sponsors" :key="sp.faction">
            <div class="kv"><span>公帳・{{ sp.faction }}</span><b>{{ fmt(sp.paid - sp.used) }}</b></div>
            <TrackBar label="可支領額度" :value="Math.min(quota, sp.used)" :max="quota" color="var(--ep)" striped :height="6" />
            <div class="terms">{{ sp.terms }}<Hint>每一次撥款進來，額度增加撥款的 20%。超過額度拿出來，每超過 500，那個勢力的好感 −1、敵對值 +1。</Hint></div>
          </template>
          <div class="go"><ReasonButton sm :reason="g.money.acc < 500 ? '帳戶不到 500。' : null" @go="subsidize">補貼 500</ReasonButton><ReasonButton sm :reason="ch.budget.ownAcc < 500 ? '自有資金不到 500。' : null" @go="ch.budget.ownAcc -= 500; g.money.acc += 500; ui.toast('拿出來 500：自有資金沒有代價。')">拿出來 500</ReasonButton></div>
        </section>
      </aside>

      <!-- 中：開一集 -->
      <section class="stack mid">
        <div class="panel cut pad">
          <p class="h">節目</p>
          <div class="shows">
            <button v-for="s in visibleShows" :key="s.id" type="button" class="showc cut-sm" :class="{ on: showId === s.id, 'is-unavailable': !!showBlock(s.id), path: s.path }" @click="showId = s.id">
              <b>{{ s.name }}</b><small>{{ s.what }}</small><small>{{ s.check }}・{{ s.time }}</small><MoneyTag kind="acc" :amount="s.cost" :size="12" />
              <span v-if="showBlock(s.id)" class="why">{{ showBlock(s.id) }}</span>
            </button>
          </div>
          <div class="opts">
            <div class="setrow"><span class="nm">成人檔<Hint>擦邊：訂閱 ×1.3、打賞 ×1.5、上鏡者豔名 +1、公信力 −1（現場、專題 −2）。成人：訂閱 ×1.6、打賞 ×2.5、豔名 +2、公信力 −2（現場、專題 −4）、推薦權重 −1。上鏡的人要同意。</Hint></span><span class="segs"><button v-for="t in TIERS" :key="t.id" type="button" :class="{ on: tierId === t.id }" @click="tierId = t.id">{{ t.name }} ×{{ t.sub }}</button></span></div>
            <div class="setrow"><span class="nm">怎麼播</span><span class="segs"><button v-for="m in ['直播', '錄播'] as const" :key="m" type="button" :class="{ on: mode === m }" @click="mode = m">{{ m }}</button></span></div>
            <div class="setrow"><span class="nm">誰上鏡<Hint>打賞進上鏡那個人的口袋；夥伴上鏡時照 NPC_SYSTEM 10.5 節分。</Hint></span><span class="segs"><button v-for="(v, k) in HOSTS" :key="k" type="button" :class="{ on: host === k }" @click="host = k">{{ v.name }}・{{ CHECKS[showId].map(n => `${n} ${(v.skills as Record<string, number>)[n]}`).join('／') }}</button></span></div>
            <div class="setrow"><span class="nm">在哪裡<Hint>出門只帶便攜的設備；棚內的設備要放在據點或轉播站。</Hint></span><span class="segs"><button v-for="w in ['出門', '棚內'] as const" :key="w" type="button" :class="{ on: where === w }" @click="where = w">{{ w }}</button></span></div>
            <div class="setrow"><span class="nm">帶製作（潘妮）</span><button type="button" class="switch" role="switch" aria-label="帶製作" :aria-checked="bringProducer" :class="{ on: bringProducer }" @click="bringProducer = !bringProducer" /></div>
            <div class="setrow"><span class="nm">業配・萬華鏡<Hint>任何一集都可以掛一則：預算增加，公信力 −1。萬華鏡的贊助不接擦邊與成人檔。</Hint></span><button type="button" class="switch" role="switch" aria-label="掛業配" :aria-checked="sponsorAd" :class="{ on: sponsorAd }" @click="sponsorAd = !sponsorAd" /></div>
          </div>
          <p class="h">設備・這一集用到的<Hint>每類一格，沒有的變淡；加值加總，最多 +6。</Hint></p>
          <div class="gear"><span v-for="e in ch.equipment" :key="e.cls" class="tag" :class="{ dim: !gearUsed.includes(e) }"><GradeBadge v-if="e.grade" :grade="e.itemGrade" small />{{ e.cls }} {{ e.grade ? `+${e.bonus}` : '沒有' }}</span><b class="mono">合計 +{{ gearSum }}</b></div>
        </div>
        <div class="panel cut pad">
          <p class="h">預覽</p>
          <div class="formula mono">1d20 ＋ {{ skillName }} {{ skill }} ＋ 設備 {{ gearSum }} ＋ 編制 {{ bringProducer ? 2 : 0 }} 對 DC {{ pv.dc }}<span v-if="!h.media" class="warn-t">（沒有媒體型技能 +3）</span></div>
          <div class="odds">
            <div v-for="gr in GRADES" :key="gr.id" class="odd" :style="{ '--c': gr.color }"><b>{{ gr.name }}</b><span class="mono">{{ pv.odds[gr.id] }}%</span><small>觀看 ×{{ gr.views }}・訂閱 {{ gr.subs > 0 ? '+' : '' }}{{ Math.round(gr.subs * 100) }}%</small></div>
          </div>
          <div v-if="blockReason" class="blocking">{{ blockReason }}</div>
          <div class="go">
            <button type="button" class="btn sm" @click="ui.toast('存成草稿了。')">存成草稿</button>
            <ReasonButton pri :reason="blockReason" @go="rollEpisode">{{ mode === '直播' ? '開播' : '開拍' }}</ReasonButton>
          </div>
        </div>
      </section>

      <!-- 右：事件、編制、集數、設備 -->
      <aside class="stack right">
        <section class="panel cut pad">
          <p class="h">事件</p>
          <div v-for="e in ch.events" :key="e.text" class="ev"><span class="kc" :style="{ '--c': 'var(--warn)' }">{{ e.kind }}</span><span class="grow">{{ e.text }}</span><small class="warn-t">{{ e.due }}</small></div>
        </section>
        <section class="panel cut pad">
          <p class="h">編制・{{ staffSlots(ch.subs) }} 格</p>
          <div v-for="s in ch.staff" :key="s.role" class="kv"><span>{{ s.role }}</span><b>{{ s.who ? `${g.npcs[s.who].name}・名冊・忠誠 ${s.loyalty}` : '空' }}</b></div>
          <div v-if="ch.staff.length < staffSlots(ch.subs)" class="kv"><span>公關</span><b class="k">等頻道到 2 級</b></div>
          <div v-for="s in ch.staff.filter(x => !x.who)" :key="s.role + 'how'" class="empty-note">{{ s.role }}：{{ s.how }}</div>
        </section>
        <section class="panel cut pad">
          <p class="h">最近的集數</p>
          <div v-for="(e, i) in ch.episodes.slice(0, 6)" :key="i" class="ep">
            <i class="gd" :style="{ background: gradeOf(e.grade).color }" />
            <span class="grow"><b>{{ e.show }}・{{ e.tier }}・{{ e.mode }}</b><small>第 {{ e.day }} 天・{{ e.change }}</small></span>
            <i v-if="e.adult" class="pdot" aria-label="成人檔" />
          </div>
        </section>
        <section class="panel cut pad">
          <p class="h">設備</p>
          <div v-for="e in ch.equipment" :key="e.cls" class="kv"><span>{{ e.cls }}</span><b>{{ e.grade ? `${e.grade}・${e.portable ? '便攜' : '棚內'}` : '沒有' }}</b></div>
        </section>
      </aside>
    </div>
  </Dialog>
</template>

<style scoped>
.mtabs { display: none; }
.chg { display: grid; grid-template-columns: 270px minmax(0, 1fr) 290px; gap: 12px; align-items: start; }
.two { display: flex; gap: 18px; align-items: end; flex-wrap: wrap; }
.spark { width: 100%; height: 38px; margin: 8px 0; background: var(--bg-term); }
.wt { display: grid; grid-template-columns: repeat(7, 1fr); gap: 3px; margin-bottom: 6px; }
.wt i { height: 10px; background: var(--bg-2); border-radius: 2px; }
.wt i.on { background: var(--a); }
.terms { font-size: var(--fs-xs); color: var(--ink-3); margin: 4px 0; display: flex; gap: 4px; align-items: start; }
.shows { display: grid; grid-template-columns: repeat(auto-fill, minmax(130px, 1fr)); gap: 6px; margin-bottom: 10px; }
.showc { display: grid; gap: 2px; text-align: left; padding: 10px; background: var(--bg-2); border: 0; color: var(--ink); cursor: pointer; align-content: start; }
.showc small { color: var(--ink-3); font-size: var(--fs-fine); }
.showc.on { box-shadow: inset 0 0 0 2px var(--a); }
.showc.path { box-shadow: inset 0 0 0 1px var(--ep); }
.showc.on.path { box-shadow: inset 0 0 0 2px var(--a); }
.showc.is-unavailable { cursor: pointer !important; } /* 點得開，看原因 */
.showc .why { font-size: var(--fs-tiny); color: var(--warn); font-weight: 700; }
.opts { margin-bottom: 8px; }
.gear { display: flex; gap: 5px; flex-wrap: wrap; align-items: center; }
.gear .dim { opacity: .4; }
.formula { font-size: var(--fs-sm); padding: 8px 10px; background: var(--bg-term); margin-bottom: 8px; overflow-wrap: anywhere; }
.odds { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 6px; margin-bottom: 8px; }
.odd { padding: 8px; background: var(--bg-2); box-shadow: inset 0 3px 0 var(--c); display: grid; gap: 2px; }
.odd span { font-size: var(--fs-section); font-weight: 900; }
.odd small { font-size: var(--fs-tiny); color: var(--ink-3); }
.ev { display: flex; gap: 8px; align-items: start; padding: 6px 8px; background: var(--bg-2); box-shadow: inset 3px 0 0 var(--warn); margin-bottom: 4px; font-size: var(--fs-sm); }
.ep { display: flex; gap: 8px; align-items: center; padding: 6px 0; border-bottom: 1px dashed var(--line); font-size: var(--fs-sm); }
.ep small { display: block; color: var(--ink-3); font-size: var(--fs-fine); }
.gd { width: 10px; height: 26px; border-radius: 2px; flex: none; }
.pdot { width: 7px; height: 7px; border-radius: 50%; background: var(--a); flex: none; }
.grow { flex: 1; min-width: 0; }
@media (max-width: 1200px) { .chg { grid-template-columns: 250px minmax(0, 1fr); } .right { grid-column: 1 / -1; grid-template-columns: repeat(auto-fit, minmax(240px, 1fr)); } }
@media (max-width: 720px) {
  .mtabs { display: flex; }
  .chg { grid-template-columns: minmax(0, 1fr); }
  .chg[data-m="show"] .right { display: none; }
  .chg[data-m="more"] .left, .chg[data-m="more"] .mid { display: none; }
  .right { grid-template-columns: minmax(0, 1fr); }
  .odds { grid-template-columns: repeat(2, minmax(0, 1fr)); }
}
</style>
