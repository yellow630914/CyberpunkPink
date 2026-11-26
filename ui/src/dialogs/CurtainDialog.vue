<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { fromMinutes } from '@engine/src'
import Dialog from '../components/Dialog.vue'
import Hint from '../components/Hint.vue'
import MoneyTag from '../components/MoneyTag.vue'
import ReasonButton from '../components/ReasonButton.vue'
import Tabs from '../components/Tabs.vue'
import FallPanel from '../components/curtain/FallPanel.vue'
import { useEngine } from '../stores/engine'
import { useUi } from '../stores/ui'
import { INTERVIEW_SKILLS, interviewTier, memberLine, roman, tasteGroups, tierRep, toggleParty, toggleTag, tapeLine } from '../lib/curtainView'

/**
 * 簾後館（CYBERSPACE 8.8 節；dev/work/M4-ui-curtain.md 第 1、2 項）：沒有會員證時是面談（邀請函剩幾天、席次與檢定的 DC、不收的原因），有的時候是會員頁
 * （席次、會費繳到哪、這一週的主打、今晚還能報幾場、口味單）；報名選席次與夜（或擲）、隊伍、保證金與同伴券；帳與母帶。
 * 全部讀引擎的 memberView、tasteOptions、nightPool、enterQuote、enterBlocks、fallView；做事是 store 的 curtain 動作。擋住的原因逐字是引擎的。這裡沒有規則。
 */
const props = defineProps<{ entryId: number; stacked?: boolean; initial?: 'member' | 'taste' | 'enter' | 'account' }>()
const e = useEngine()
const ui = useUi()

const m = computed(() => e.curtain.member())
const fall = computed(() => e.curtain.fall())
const active = computed(() => !!m.value?.member && !m.value.member.suspended)
const tab = ref<'member' | 'taste' | 'enter' | 'account'>(props.initial ?? 'member')
const tabs = computed(() => [
  { id: 'member', label: active.value ? '會員' : '面談' }, { id: 'taste', label: '口味單' },
  { id: 'enter', label: '報名', disabled: !active.value }, { id: 'account', label: '帳與母帶', dot: !!fall.value || (m.value?.member?.overdue ?? 0) > 0 },
])
const dayOf = (minutes: number): number => fromMinutes(minutes).day

async function run(f: () => Promise<{ status: string; reason?: string }>, fallback: string, okText?: string): Promise<boolean> {
  const r = await f()
  if (r.status !== 'applied') { ui.toast(r.reason ?? fallback, 'warn'); return false }
  const s = okText ?? e.state.reports.at(-1)?.outcome.summary
  if (s) ui.toast(s)
  return true
}

// ---- 面談 ----
const skill = ref<'negotiate' | 'perform'>('negotiate')
const tierNow = computed(() => (m.value ? interviewTier(m.value) : null))
const interviewReason = (tier: string): string | null => e.curtain.interviewBlock({ tier: tier as never, skill: skill.value })
const interview = (tier: string) => run(() => e.curtain.interview({ tier: tier as never, skill: skill.value }), '現在談不了。')
const giveInvite = () => { const why = e.curtain.invite(); ui.toast(why ?? '你拿到一張簾後館的邀請函。', why ? 'warn' : 'info') }

// ---- 口味單 ----
const tasteOpts = computed(() => e.curtain.tasteOptions())
const tags = ref<string[]>(tasteOpts.value.filter((o) => o.on).map((o) => o.id))
watch(() => m.value?.taste.join(','), () => { tags.value = tasteOpts.value.filter((o) => o.on).map((o) => o.id) })
const groups = computed(() => tasteGroups(tasteOpts.value))
const tasteReason = computed(() => e.curtain.tasteBlock(tags.value))
const pool = computed(() => e.curtain.pool())
const saveTaste = () => run(() => e.curtain.taste(tags.value), '現在改不了。')

// ---- 報名 ----
const pc = computed(() => e.state.pc ?? '')
const party = ref<string[]>([])
watch(pc, (id) => { if (id && !party.value.includes(id)) party.value = [id, ...party.value] }, { immediate: true })
const mates = computed(() => e.state.party.map((id) => ({ id, name: e.state.actors[id]?.name ?? id })))
const tierPick = ref<string>('')
const nightPick = ref<string>('')
const tierIds = computed(() => {
  const ts = m.value?.tiers ?? []
  const i = ts.findIndex((t) => t.current)
  return ts.slice(0, i < 0 ? 1 : i + 1)
})
watch(() => m.value?.member?.tier, (t) => { if (t && !tierIds.value.some((x) => x.id === tierPick.value)) tierPick.value = t }, { immediate: true })
const opts = computed(() => ({ party: party.value, ...(tierPick.value ? { tier: tierPick.value as never } : {}), ...(nightPick.value ? { night: nightPick.value } : {}) }))
const quote = computed(() => e.curtain.quote(opts.value))
const blocks = computed(() => e.curtain.enterBlocks(opts.value))
const enterReason = computed(() => (blocks.value.length ? blocks.value.join('') : null))
async function enter() { if (await run(() => e.curtain.enter(opts.value), '現在報不了名。')) ui.close() }

// ---- 帳與母帶 ----
const payTab = () => run(() => e.curtain.payTab(), '現在還不了。')
const buyback = (id: string) => run(() => e.curtain.buyback(id), '現在買不回來。')
const account = computed(() => e.curtain.account())
const tabView = computed(() => account.value.tab)
</script>

<template>
  <Dialog :entry-id="entryId" :stacked="stacked" title="簾後館" :sub="m?.member ? `${m.member.name}${m.member.suspended ? '・停權' : ''}` : '還沒有會員證'" size="lg">
    <template #header><Hint title="簾後館">暗礁裡會員制的成人地城。要有邀請函（三天有效）去面談，領會員證；每週繳會費；報名時付保證金，選一個夜（口味單範圍內擲），一趟四幕。全隊倒下是落幕，不是死亡：要付設備費與違約金。所有化身背後的人都是成年人。</Hint></template>

    <section v-if="fall" class="panel cut pad mt" data-fall-box><FallPanel :fall="fall" /></section>

    <Tabs v-model="tab" :tabs="tabs" @blocked="ui.toast('要先有會員證才能報名。', 'warn')" />

    <template v-if="m && tab === 'member'">
      <section v-if="!active" class="panel cut pad mt" data-interview>
        <p class="h">面談<Hint title="面談">一次檢定（交涉或表演，DC 照席次），失敗要等幾天才能再談。通過領一張會員證，永久有效，逾期兩週沒繳會費就停權。第一次入會只能從散座起。</Hint></p>
        <div class="kv"><span>邀請函</span><b data-invite>{{ m.invite ? `還有 ${m.invite.daysLeft} 天` : '沒有有效的邀請函' }}</b></div>
        <div v-if="m.retryDays > 0" class="kv"><span>再談</span><b data-retry>還要等 {{ m.retryDays }} 天</b></div>
        <div v-if="m.member?.suspended" class="blocking" data-suspended>{{ memberLine(m.member) }}</div>
        <div v-if="!m.invite && e.demoMode" class="go left" data-demo-only><button type="button" class="btn sm" data-demo-invite @click="giveInvite">（示意）領一張邀請函</button><small class="note">示意模式才有。誰給邀請函是內容：介紹人、試鏡、蚌殼市的老攤。</small></div>
        <label class="pick">用哪一項檢定
          <select v-model="skill" data-skill><option v-for="s in INTERVIEW_SKILLS" :key="s.id" :value="s.id">{{ s.name }}</option></select>
        </label>
        <div class="grid2">
          <div v-for="t in m.tiers" :key="t.id" class="tier" :class="{ 'is-unavailable': !t.canInterview }" :data-tier="t.id">
            <span class="grow"><b>{{ t.name }}（{{ roman(t.grade) }}）</b><small data-tier-rep>{{ tierRep(t) }}</small>
              <small>保證金 <MoneyTag kind="cash" :amount="t.deposit" />・會費 <MoneyTag kind="cash" :amount="t.fee_weekly" />／週・破關獎金 <MoneyTag kind="cash" :amount="t.prize" /></small>
              <small v-for="(b, i) in t.blocks" :key="i" class="why" data-block>{{ b }}</small></span>
            <ReasonButton sm pri :reason="interviewReason(t.id)" :data-interview="t.id" @go="interview(t.id)">面談</ReasonButton>
          </div>
        </div>
        <p v-if="tierNow" class="note" data-tier-now>這一步面談的是{{ tierNow.name }}。</p>
      </section>

      <template v-else-if="m.member">
        <section class="panel cut pad mt" data-card>
          <p class="h">會員證</p>
          <div class="kv"><span>席次</span><b data-card-tier>{{ m.member.name }}（{{ roman(m.member.grade) }}）</b></div>
          <div class="kv"><span>會費</span><b data-card-fee><MoneyTag kind="acc" :amount="m.member.fee_weekly" />／週・繳到第 {{ dayOf(m.member.paid_until) }} 天前<span v-if="m.member.overdue > 0" class="tag warn"> {{ memberLine(m.member) }}</span></b></div>
          <div class="kv"><span>破關</span><b data-card-clears>{{ m.member.clears }} 次（升席要在目前的席次破關幾次）</b></div>
          <div class="kv"><span>本週主打</span><b data-feature>{{ m.feature ? m.feature.name : '沒有可以挑的夜' }}<span v-if="m.feature" class="tag hot">打賞加成</span></b></div>
          <div class="kv"><span>今晚</span><b data-runs>已報 {{ m.runsTonight }} 場・還能報 {{ m.runsLeft }} 場</b></div>
          <div class="kv"><span>本週打賞</span><b data-week-tips><MoneyTag kind="cash" :amount="m.tips" /></b></div>
          <div v-if="tabView" class="kv" data-card-tab><span>欠款</span><b><MoneyTag kind="cash" :amount="tabView.owed" />（記帳欠簾後館的；到帳與母帶頁還）</b></div>
          <div class="kv"><span>口味單</span><b data-card-taste>{{ m.taste.length ? m.taste.map((t) => e.curtain.nameOf('tendency_tag', t)).join('、') : '還沒有勾' }}<span v-if="m.pure_stage" class="tag">純舞台</span></b></div>
          <div class="kv"><span>抽得到的夜</span><b data-nights>{{ m.nights }} 個</b></div>
        </section>
        <section class="panel cut pad mt" data-upgrade>
          <p class="h">升席<Hint title="升席">在目前的席次破關滿次數、街頭信譽夠，再面談一次（不用邀請函）。一席一席升。</Hint></p>
          <label class="pick">用哪一項檢定
            <select v-model="skill" data-skill><option v-for="s in INTERVIEW_SKILLS" :key="s.id" :value="s.id">{{ s.name }}</option></select>
          </label>
          <div class="grid2">
            <div v-for="t in m.tiers.filter((x) => !x.current)" :key="t.id" class="tier" :class="{ 'is-unavailable': !t.canInterview }" :data-tier="t.id">
              <span class="grow"><b>{{ t.name }}（{{ roman(t.grade) }}）</b><small>{{ tierRep(t) }}</small><small v-for="(b, i) in t.blocks" :key="i" class="why" data-block>{{ b }}</small></span>
              <ReasonButton sm pri :reason="interviewReason(t.id)" :data-interview="t.id" @go="interview(t.id)">面談</ReasonButton>
            </div>
          </div>
        </section>
      </template>
    </template>

    <section v-if="tab === 'taste'" class="panel cut pad mt" data-taste>
      <p class="h">口味單<Hint title="口味單">面談時勾選想要的題材：它決定這一週抽得到哪些夜、點單與補演的樣子。被你的內容篩選關掉的題材不出現。勾的題材太少，館方安排純舞台的場次。整張單子一次送出。</Hint></p>
      <div v-for="g in groups" :key="g.axis" class="grp" :data-axis="g.axis">
        <b class="gn">{{ g.name }}</b>
        <div class="chips"><button v-for="o in g.items" :key="o.id" type="button" class="btn sm" :class="{ pri: tags.includes(o.id) }" :aria-pressed="tags.includes(o.id)" :data-tag="o.id" @click="tags = toggleTag(tags, o.id)">{{ o.name }}</button></div>
      </div>
      <p v-if="!groups.length" class="empty-note">現在沒有可以勾的題材。</p>
      <div class="go left"><ReasonButton pri :reason="tasteReason" data-taste-save @go="saveTaste">送出口味單</ReasonButton></div>
      <p v-if="pool?.pure_stage" class="note" data-pure>勾的題材不夠：這一週開純舞台的場次（成人場景換成表演檢定）。</p>
      <div v-if="pool" class="nlist" data-pool>
        <p class="h">這一週抽得到的夜</p>
        <div v-for="n in pool.rows" :key="n.id" class="nrow" :data-night="n.id"><b>{{ n.name }}</b><span v-if="n.feature" class="tag hot">主打</span><small>{{ e.curtain.nameOf('faction', n.faction) }}包場・{{ n.matched.map((t) => e.curtain.nameOf('tendency_tag', t)).join('、') || '純舞台' }}</small></div>
        <p v-if="!pool.rows.length" class="empty-note">口味單與內容篩選之下沒有抽得到的夜。</p>
      </div>
    </section>

    <section v-if="tab === 'enter' && m" class="panel cut pad mt" data-enter>
      <p class="h">報名<Hint title="報名">一隊 1～4 人（會員本人加同伴），每個人都要有橋與自己的甲板；每晚最多兩場。報名時付保證金與同伴券（同伴沒有打賞）。夜可以自己選，也可以交給館方擲。簾口要站在簾口才能報名。</Hint></p>
      <label class="pick">席次
        <select v-model="tierPick" data-tier-pick><option v-for="t in tierIds" :key="t.id" :value="t.id">{{ t.name }}（{{ roman(t.grade) }}）</option></select>
      </label>
      <label class="pick">夜
        <select v-model="nightPick" data-night-pick><option value="">擲（館方抽）</option><option v-for="n in pool?.rows ?? []" :key="n.id" :value="n.id">{{ n.name }}{{ n.feature ? '（主打）' : '' }}</option></select>
      </label>
      <div class="pick"><span>隊伍</span>
        <div class="chips"><button v-for="p in mates" :key="p.id" type="button" class="btn sm" :class="{ pri: party.includes(p.id) }" :aria-pressed="party.includes(p.id)" :data-party="p.id" @click="party = toggleParty(party, p.id, pc)">{{ p.name }}<template v-if="p.id === pc">（會員）</template></button></div>
      </div>
      <div v-if="quote" class="quote" data-quote>
        <div class="kv"><span>保證金</span><b data-deposit><MoneyTag kind="cash" :amount="quote.deposit" /></b></div>
        <div v-if="quote.companions.length" class="kv"><span>同伴券</span><b data-companion>{{ quote.companions.length }} 張，每張 <MoneyTag kind="cash" :amount="quote.companionFee" /></b></div>
        <div class="kv"><span>現金一共付</span><b data-total><MoneyTag kind="cash" :amount="quote.total" /></b></div>
      </div>
      <div v-for="(b, i) in blocks" :key="i" class="blocking" data-enter-block>{{ b }}</div>
      <div class="go left"><ReasonButton pri :reason="enterReason" data-enter-go @go="enter">報名</ReasonButton></div>
    </section>

    <section v-if="tab === 'account' && m" class="panel cut pad mt" data-account>
      <p class="h">帳與母帶</p>
      <div v-if="tabView" class="kv" data-tab><span>欠簾後館的</span><b><MoneyTag kind="cash" :amount="tabView.owed" />（上限 <MoneyTag kind="cash" :amount="tabView.cap" />・每週利息 <MoneyTag kind="cash" :amount="tabView.weekly" />）</b></div>
      <div v-if="tabView" class="go left"><ReasonButton sm pri :reason="e.curtain.payTabBlock()" data-pay-tab @go="payTab">全部還清</ReasonButton></div>
       <div v-if="account.gig" class="kv" data-gig><span>檔期</span><b>到第 {{ dayOf(account.gig.until) }} 天・已缺 {{ account.gig.missed }} 週</b></div>
      <div v-for="t in account.tapes" :key="t.id" class="tape" :data-tape="t.id">
        <span class="grow"><b>母帶 {{ t.id }}</b><small>{{ tapeLine(t) }}</small><small v-if="!t.bought">買回 <MoneyTag kind="cash" :amount="t.price" /></small></span>
        <ReasonButton v-if="!t.bought" sm pri :reason="e.curtain.buybackBlock(t.id)" :data-buyback="t.id" @go="buyback(t.id)">買回</ReasonButton>
      </div>
      <p v-if="!tabView && !account.tapes.length" class="empty-note">沒有欠款，也沒有母帶。</p>
    </section>
  </Dialog>
</template>

<style scoped>
.mt { margin-top: var(--space-4); }
.note { margin: var(--space-2) 0 0; color: var(--ink-3); font-size: var(--fs-fine); line-height: 1.6; }
.go.left { justify-content: flex-start; align-items: center; gap: var(--space-3); display: flex; flex-wrap: wrap; margin: var(--space-3) 0; }
.pick { display: grid; gap: var(--space-2); font-size: var(--fs-fine); color: var(--ink-3); font-weight: 700; margin: var(--space-3) 0; }
.pick select { background: var(--bg-1); color: var(--ink); border: 0; box-shadow: inset 0 0 0 2px var(--line-2); padding: 7px 9px; font: inherit; max-width: 360px; }
.tier, .tape, .nrow { display: flex; gap: var(--space-3); align-items: flex-start; padding: var(--space-3); background: var(--bg-2); box-shadow: inset 0 0 0 1px var(--line-2); }
.nrow { align-items: center; flex-wrap: wrap; margin-top: var(--space-2); }
.tier .grow, .tape .grow { flex: 1; min-width: 0; display: grid; gap: 2px; }
.tier small, .tape small, .nrow small { color: var(--ink-3); font-size: var(--fs-fine); line-height: 1.5; }
.tier small.why { color: var(--warn); }
.grp { margin: var(--space-3) 0; display: grid; gap: var(--space-2); }
.gn { font-size: var(--fs-label); color: var(--ink-2); }
.chips { display: flex; gap: var(--space-2); flex-wrap: wrap; }
.quote { margin: var(--space-3) 0; }
.nlist { margin-top: var(--space-4); }
</style>
