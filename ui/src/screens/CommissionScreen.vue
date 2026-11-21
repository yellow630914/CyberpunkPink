<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import StatusBar from '../components/StatusBar.vue'
import Hint from '../components/Hint.vue'
import Tabs from '../components/Tabs.vue'
import TrackBar from '../components/TrackBar.vue'
import MoneyTag from '../components/MoneyTag.vue'
import ReasonButton from '../components/ReasonButton.vue'
import PartyRow from '../components/PartyRow.vue'
import { useGame } from '../stores/game'
import { useUi } from '../stores/ui'
import { OFFERS, DEAL, MEANS, CREW, LINK_KIND, START_JOB, type Stage, type Branch } from '../data/commission'
import { TEMPLATES, templateById, facesKnownOf } from '../data/templates'
import { FACE_NAME, payOptions, negotiate, split, scoutDc, scoutRoll, chance, supportRoll, WEIGHT, LINKS, linkMods, stagePressure, branchDc, pickGoals, goalPayout, JOB_GOALS, type Face } from '../lib/commission'
import { mathRng, d20 } from '../lib/combat/rng'
import { SKILL_TREES } from '../data/content.generated'
import { fmt } from '../lib/price'

/**
 * 委託（全頁，UI.md 第 7 節、mockups/commission.html）：一件委託的四拍放在同一頁，頂端一排箭頭分頁：接案 → 踩點 → 召集 → 副本。
 * 規則在 FIXER 第 2 節、COMMISSIONS 第 2～6 節；純函式在 lib/commission.ts。副本的每一段「進入這一段」連到現實戰鬥、內海戰鬥、子網或輿論戰，
 * 打完回到這一頁推進階段（game.lastBattle）。全頁的理由：進副本之後城裡的事全部暫停，委託頁取代主畫面。
 */
const g = useGame()
const ui = useUi()
const router = useRouter()
const route = useRoute()
const job = g.job
const tab = ref<string>(typeof route.query.tab === 'string' ? route.query.tab : job.step === 'done' ? 'run' : job.step)
const STEP_ORDER = ['take', 'scout', 'call', 'run'] as const
const reached = (s: string) => STEP_ORDER.indexOf(s as never) <= STEP_ORDER.indexOf((job.step === 'done' ? 'run' : job.step) as never)
const tabs = computed(() => [
  { id: 'take', label: '1 接案' }, { id: 'scout', label: '2 踩點', disabled: !reached('scout') },
  { id: 'call', label: '3 召集', disabled: !reached('call') }, { id: 'run', label: '4 副本', disabled: !reached('run') },
])
const sel = ref(job.offer ?? 'bluewhale')
/** 夢露手上的案子：七種模板（第四版）＋信譽不夠的那一件 */
const OFFER_LIST = [...TEMPLATES.map(t => t.offer), OFFERS.find(o => o.id === 'erase')!]
const tpl = computed(() => templateById(sel.value))
const runTpl = computed(() => templateById(job.offer ?? sel.value))
const STAGES = computed(() => runTpl.value.stages)
const offer = computed(() => OFFER_LIST.find(o => o.id === sel.value) ?? tpl.value.offer)
const brief = computed(() => tpl.value.brief)
const GRADE_N: Record<string, number> = { I: 1, II: 2, III: 3, IV: 4, V: 5 }
const fixer = computed(() => g.npcs.npc_monroe)
const faceIcon: Record<Face, string> = { m: '現', n: '內', o: '輿' }
const rng = mathRng

// ---- 1 接案 ----
const pays = computed(() => payOptions(job.reward))
const negoNote = ref('')
const negoDone = ref(false)
function talk() {
  const r = negotiate(job.reward, DEAL.reward.floor, d20(rng), 4)
  job.reward = r.value
  job.talks++
  negoNote.value = r.text
  negoDone.value = r.done || job.talks >= 2
}
const offerReason = computed(() => (offer.value.need ? `門檻：${offer.value.need}。` : job.offer && job.offer !== sel.value ? '手上已經有一件進行中的委託。' : null))
/** 接案：每一型都走完四拍（第四版）。預付三成；未知清單照模板 */
function accept() {
  const t = tpl.value
  job.offer = t.id
  job.step = 'scout'
  if (t.id !== 'bluewhale') { job.reward = t.offer.reward; job.unknowns = structuredClone(t.unknowns); job.scouts = 0; job.lastScout = null; job.pressure = { alert: 0, trace: 0 } }
  const pre = Math.round(job.reward * DEAL.prepay)
  g.money.cash += pre
  g.addLog({ prose: [`你接下夢露手上的「${t.offer.name}」。她把預付款推過來，提醒你：${t.offer.cond}。`], changes: [{ text: `現金晶片 +${fmt(pre)}（預付三成）`, kind: 'plus' }] })
  tab.value = 'scout'
}
const net = computed(() => split({ reward: job.reward, cut: DEAL.cut, pay: job.pay, fees: 0, members: 0 }).base - (job.pay === 'fav' ? 0 : Math.round(payOptions(job.reward).find(p => p.id === job.pay)!.get * DEAL.cut)))

// ---- 2 踩點 ----
const MAX_SCOUT = 4
const means = ref('survey')
const who = ref<'me' | 'npc_jo'>('me')
const buyTarget = ref<string>('')
const nth = computed(() => job.scouts + 1)
const dc = computed(() => scoutDc(2, nth.value))
const meansOf = (id: string) => MEANS.find(m => m.id === id)!
const meansReason = (id: string) => (meansOf(id).need ? meansOf(id).need! : null)
const bonusOf = (id: string) => meansOf(id).bonus + (who.value === 'npc_jo' && id === 'survey' ? 1 : 0)
const openCount = computed(() => job.unknowns.filter(u => u.open).length)
const scoutReason = computed(() => {
  if (job.scouts >= MAX_SCOUT) return '踩點的次數用完了（中型 4 次）。'
  if (meansReason(means.value)) return meansReason(means.value)
  if (means.value === 'buy' && !buyTarget.value) return '先選要買哪一項。'
  if (means.value === 'buy' && g.money.cash < 600) return '現金晶片不夠。'
  if (!job.unknowns.some(u => !u.open)) return '未知清單都揭開了。'
  return null
})
function scout() {
  job.unknowns.forEach(u => { u.fresh = false })
  const m = meansOf(means.value)
  const dcNow = dc.value
  job.scouts++
  g.advance(240)
  if (who.value === 'npc_jo') g.money.acc -= 250
  if (m.id === 'buy') {
    g.money.cash -= 600
    const u = job.unknowns.find(x => x.id === buyTarget.value)!
    u.open = true; u.fresh = true
    job.lastScout = `買情報：600，直接揭開「${u.cat}」。`
    return
  }
  const r = scoutRoll(rng, bonusOf(m.id), dcNow)
  const cand = job.unknowns.filter(u => !u.open && u.by.includes(m.id))
  const pool = cand.length ? cand : job.unknowns.filter(u => !u.open)
  const got = pool.slice(0, r.reveal)
  got.forEach(u => { u.open = true; u.fresh = true })
  if (r.alarm) { job.alarm += 15; job.pressure.trace += m.id === 'hack' ? 15 : 0; job.pressure.alert += m.id === 'hack' ? 0 : 15 }
  job.lastScout = `上一次：${m.name}　1d20 ${r.die} ＋ ${bonusOf(m.id)} ＝ ${r.tot}，對 ${r.dc}，${r.alarm ? '自然 1：驚動了目標（起始的壓力 +15）。' : got.length ? `揭開${got.length === 2 ? '兩' : '一'}項：${got.map(u => u.cat).join('、')}。` : '沒有揭開什麼。'}`
}
const stageKnown = (s: Stage) => !s.hidden || !!job.unknowns.find(u => u.id === 'u_stage3')?.open || STAGES.value.indexOf(s) <= job.stage
const facesKnown = (i: number) => facesKnownOf(runTpl.value, i, job.unknowns)

// ---- 3 召集 ----
const ROSTER_ADD = ['npc_jo', 'npc_penny']
function toggleCrew(id: string) {
  const i = job.party.indexOf(id)
  if (i >= 0) { if (id !== 'me') job.party.splice(i, 1) }
  else if (job.party.length < 4) job.party.push(id)
  else ui.toast('隊伍最多 4 人。', 'warn')
}
const fees = computed(() => job.party.reduce((s, id) => s + (CREW[id]?.fav ? 0 : CREW[id]?.fee ?? 0), 0))
const sp = computed(() => split({ reward: job.reward, cut: DEAL.cut, pay: job.pay, fees: fees.value, members: job.party.length - 1 }))
const skillNames = computed(() => g.loadout.map(id => SKILL_TREES.flatMap(t => t.skills).find(s => s.id === id)?.name).filter(Boolean) as string[])
const HOW = ['付錢', '用人情', '欠人情', '靠交情'] as const
const supportPct = (f: Face) => { const s = job.support[f]; return s ? chance(s.skill + WEIGHT[s.weight], 14) : 0 }
function depart() {
  job.step = 'run'
  job.stats = { alertMax: job.pressure.alert, traceMax: job.pressure.trace, noLink: 0, opResult: null, decisiveRounds: null, downs: 0 }
  if (job.live && !job.goals?.length) job.goals = pickGoals(runTpl.value.goals, rng)
  g.inRun = true
  g.snapshots = []
  g.takeSnapshot('入口', '進入入口的那一刻')
  g.takeSnapshot('階段', '第一階段開始時')
  g.addLog({ prose: ['你們在第三倉後面的巷子集合。城裡的事暫停了。'] })
  tab.value = 'run'
}

// ---- 4 副本 ----
const stage = computed(() => STAGES.value[Math.min(job.stage, STAGES.value.length - 1)])
/** 副本直播（MEDIA 1.2 節）：開播時抽一到三個目標；委託人不同意的開播算違反「不准曝光」 */
function toggleLive() {
  job.live = !job.live
  if (job.live && !job.goals?.length) job.goals = pickGoals(runTpl.value.goals, rng)
  if (job.live && !runTpl.value.liveOk) ui.toast('委託人沒有同意直播：開播算違反「不准曝光」。', 'warn')
}
function bump(alert: number, trace: number) {
  job.pressure.alert = Math.max(0, Math.min(100, job.pressure.alert + alert))
  job.pressure.trace = Math.max(0, Math.min(100, job.pressure.trace + trace))
  if (job.stats) { job.stats.alertMax = Math.max(job.stats.alertMax, job.pressure.alert); job.stats.traceMax = Math.max(job.stats.traceMax, job.pressure.trace) }
}
function giveLink(id: string, from: string) {
  const d = LINKS[id]
  if (!d || job.links.some(l => l.id === id && !l.used)) return
  job.links.push({ id, kind: d.kind, name: d.name, from, effect: d.effect })
}
const stepNow = computed(() => (job.waiting ? 4 : !job.face ? 1 : !job.rolled ? 2 : !job.branch ? 3 : 4))
const supportFaces = computed(() => (job.face ? stage.value.faces.filter(f => f !== job.face && job.support[f]) : []))
const rolls = ref<string[]>([])
function pickFace(f: Face) {
  if (job.waiting) return
  if (!stage.value.faces.includes(f)) { ui.toast('這個階段沒有開這一面。', 'warn'); return }
  job.face = f; job.rolled = false; job.branch = null; rolls.value = []
}
function rollSupport() {
  rolls.value = []
  for (const f of supportFaces.value) {
    const s = job.support[f]!
    const r = supportRoll(rng, s.skill, s.weight, 2)
    rolls.value.push(`輔助・${FACE_NAME[f]}：${s.who}　1d20 ${r.die} ＋ ${s.skill} ＋ ${WEIGHT[s.weight]} ＝ ${r.tot}，對 ${r.dc}：${r.result}。`)
    if (r.result === '大成功' || r.result === '成功') {
      // 輔助面成功給的連動（COMMISSIONS 6.4 節）：現實切斷電力、內海接管控制節點、輿論放假消息
      giveLink(f === 'm' ? 'power_cut' : f === 'n' ? 'doors_unlocked' : 'decoy_news', `第${job.stage + 1}階段・${FACE_NAME[f]}（${s.who}）`)
    } else {
      job.links.push({ kind: '失敗', name: '沒拿到', from: `第${job.stage + 1}階段・${FACE_NAME[f]}（${s.who}）`, effect: f === 'o' ? '輿論沒有壓力條，不加' : '這一面的壓力 +10' })
      if (f === 'm') bump(10, 0)
      if (f === 'n') bump(0, 10)
    }
  }
  job.rolled = true
}
const branches = computed(() => (job.face ? stage.value.branches[job.face] ?? [] : []))
const hasLink = (id?: string) => !id || job.links.some(l => l.id === id || l.name === id)
const failedChecks = ref<string[]>([])
function branchReason(b: Branch) {
  if (b.link && !hasLink(b.link)) return `要連動：${LINKS[b.link]?.name ?? b.link}。`
  if (b.tag === '潛' && job.live) return '直播中不能走潛行的路。'
  if (failedChecks.value.includes(b.id)) return '這條路的檢定失敗了：換一條。'
  if (b.cost && g.money.cash < b.cost) return `現金不夠：要 ${fmt(b.cost)}。`
  return null
}
/** 現在這一段用得到的連動（畫面上列出來） */
const modsNow = computed(() => (job.face ? linkMods(job.links, { face: job.face, decisive: !!stage.value.key }) : null))
const checkLine = ref('')
/**
 * 進入這一段（第四版）：先套連動（不必探索、壓力減半、少一個敵人、輿論的開場……），再看分支：
 * 不擲的直接過；檢定的當場擲（基本功＋3 對標準 DC）；其他的連到戰鬥、子網、輿論戰或成人場景，打完回來推進。
 */
function enter() {
  const f = job.face!
  const br = branches.value.find(b => b.id === job.branch)!
  const m = linkMods(job.links, { face: f, decisive: !!stage.value.key })
  const base = { alert: Number(br.effect.match(/警戒 \+(\d+)/)?.[1] ?? 0), trace: Number(br.effect.match(/追蹤度 \+(\d+)/)?.[1] ?? 0) }
  const p = stagePressure(base, m)
  bump(p.alert, p.trace)
  job.links.forEach(l => { if (l.id && m.used.includes(l.id)) l.used = true })
  if (br.cost) g.money.cash -= br.cost
  if (br.free || (m.skip && br.check)) { complete(`${br.name}：${br.free ? '不擲，直接過了' : '連動讓這一段不必探索'}。`); return }
  if (br.check) {
    const mod = (g.basics[br.check.skill] ?? 0) + 3, dc = branchDc(offer.value.grade, (br.check.shift ?? 0) + m.dc), die = d20(rng)
    const ok = die !== 1 && (die === 20 || die + mod >= dc)
    checkLine.value = `${br.check.skill} 1d20 ${die} ＋ ${mod} ＝ ${die + mod}，對 ${dc}：${ok ? '成功' : '失敗'}。`
    if (ok) { complete(`${br.name}：${checkLine.value}`); return }
    failedChecks.value.push(br.id)
    bump(10, f === 'n' ? 5 : 0)
    job.branch = null
    ui.toast(`檢定失敗：警戒 +10。換一條路，或強攻。`, 'warn')
    return
  }
  const go = br.go ?? stage.value.go[f]!
  job.waiting = true
  g.takeSnapshot('戰鬥', `戰鬥開打前・${stage.value.name}`)
  g.lastBattle = null
  const extra: Record<string, string> = {}
  if (m.minus) extra.minus = String(m.minus)
  if (go.path === '/opinion') { if (m.voice) extra.va = String(m.voice); if (m.cells.length) extra.cells = m.cells.join(','); if (m.inside) extra.inside = '1'; if (m.pr) extra.pr = String(m.pr) }
  if (go.path === '/scene' && m.voice) extra.goal0 = String(m.voice)
  router.push({ path: go.path, query: { ...go.query, ...extra, from: '/commission', ...(route.query.fast ? { fast: '1', seed: '4' } : {}) } })
}
/** 這一段做完：記下來、給連動、推進到下一段；決定性的一步做完就收尾 */
function complete(result: string, extraLinks: string[] = [], branchGives = true) {
  const br = branchGives ? branches.value.find(b => b.id === job.branch) : undefined
  job.done.push({ stage: stage.value.id, face: job.face!, branch: job.branch ?? '', result })
  const from = `第${job.stage + 1}階段・${FACE_NAME[job.face!]}`
  const gives = [...(br?.gives ?? []), ...extraLinks]
  gives.forEach(id => giveLink(id, from))
  if (!stage.value.key && !gives.length && job.stats) job.stats.noLink++
  job.waiting = false; job.face = null; job.branch = null; job.rolled = false; rolls.value = []; failedChecks.value = []
  tab.value = 'run'
  if (stage.value.key) { finish(true); return }
  job.stage++
  g.advance(120)
  g.takeSnapshot('階段', `第${job.stage + 1}階段開始時`)
  ui.toast(`里程碑：第${job.stage}階段完成。`)
}
/** 從戰鬥或子網回來：贏了就是里程碑，推進階段；輸了停在這一段，可以回到這個階段開始時 */
const failed = ref<string | null>(null)
onMounted(() => {
  if (!job.waiting || !g.lastBattle) return
  const lb = g.lastBattle
  g.lastBattle = null
  if (job.stats) { job.stats.downs += lb.downs ?? 0; job.stats.crits = (job.stats.crits ?? 0) + (lb.crits ?? 0); job.stats.lethal = (job.stats.lethal ?? 0) + (lb.lethal ?? 0) }
  // 輿論的結果換成連動（OPINION 第 6 節）：大勝 op_major、小勝 op_minor、敗 op_lost；平手什麼都不給
  const opLinks: string[] = []
  if (lb.kind === 'opinion') {
    const r = lb.text.includes('大勝') ? '大勝' : lb.text.includes('小勝') || lb.text.startsWith('你贏了') ? '小勝' : lb.result === 'lose' ? '敗' : '平手'
    if (stage.value.key) { if (job.stats) job.stats.opResult = r }
    else opLinks.push(...(r === '大勝' ? ['op_major'] : r === '小勝' ? ['op_minor'] : r === '敗' ? ['op_lost'] : []))
  }
  const ok = lb.result === 'win' || lb.kind === 'subnet' || (lb.kind === 'opinion' && !stage.value.key && lb.result !== 'lose') || (lb.kind === 'opinion' && lb.result === 'draw' && !stage.value.key)
  if (stage.value.key && job.stats && lb.rounds) job.stats.decisiveRounds = lb.rounds
  if (!ok && !(lb.kind === 'opinion' && !stage.value.key)) { failed.value = lb.text; job.waiting = false; tab.value = 'run'; return }
  // 短的輿論戰輸了也算走完這一段（照結果給 op_lost）；分支本來給的連動只有小勝以上才給
  const brGives = !(lb.kind === 'opinion' && !opLinks.some(x => x !== 'op_lost'))
  complete(lb.text, opLinks, brGives)
})
function finish(win: boolean) {
  const r = payOptions(job.reward).find(p => p.id === job.pay)!
  const got = sp.value.mine
  if (win) {
    if (job.pay === 'acc') g.money.acc += got; else g.money.cash += got
    if (job.pay === 'fav') g.money.fav += 1
    const changes: Array<{ text: string; kind: 'plus' | 'minus' }> = [{ text: `${r.name} +${fmt(got)}`, kind: 'plus' }]
    // 副本直播的目標（MEDIA 1.2 節）：達成的每個熱度 +3、打賞照等級
    if (job.live && job.goals?.length && job.stats) {
      const pay = goalPayout(job.goals, job.stats, GRADE_N[runTpl.value.offer.grade] ?? 2)
      goalResult.value = job.goals.map(id => `${pay.done.includes(id) ? '✓' : '✗'} ${JOB_GOALS[id]?.text ?? id}`)
      g.channel.subs += pay.heat * 6
      g.money.cash += pay.tips
      changes.push({ text: `直播目標 ${pay.done.length}／${job.goals.length}・訂閱 +${pay.heat * 6}・打賞 +${fmt(pay.tips)}`, kind: 'plus' })
    }
    g.addLog({ prose: [`收尾：${runTpl.value.offer.name}完成了。夢露清點完，把你那一份推過來。`], changes })
  }
  job.step = 'done'
  g.inRun = false
  g.snapshots = []
}
function breathe() { job.breathe = false; g.party.forEach(p => { p.load[0] = Math.max(0, p.load[0] - 5) }); g.advance(60); ui.toast('喘口氣：每個人感載 −5。') }
function retreat() {
  const s = g.snapshots.find(x => x.kind === '入口')
  if (s) g.rollback(s.id)
  Object.assign(job, structuredClone({ ...START_JOB, offer: job.offer, step: 'call', reward: job.reward, pay: job.pay, unknowns: job.unknowns, scouts: job.scouts, pressure: job.offer === 'bluewhale' ? START_JOB.pressure : { alert: 0, trace: 0 } }))
  failed.value = null
  tab.value = 'call'
  ui.toast('撤退：回到進副本之前。')
}
function retryStage() {
  const s = [...g.snapshots].reverse().find(x => x.kind === '階段')
  if (s) g.rollback(s.id)
  failed.value = null
  job.face = null; job.branch = null; job.rolled = false; job.waiting = false
}
function newJob() { Object.assign(job, structuredClone(START_JOB)); sel.value = 'bluewhale'; tab.value = 'take'; failed.value = null; goalResult.value = [] }
const goalResult = ref<string[]>([])
</script>

<template>
  <div class="screen">
    <StatusBar back title="委託" />
    <div class="wrap">
      <div class="head">
        <Tabs v-model="tab" class="arrows" :tabs="tabs" @blocked="ui.toast('還沒走到這一拍。', 'warn')" />
        <span class="grow" />
        <span class="t-fine">委託：</span><b>{{ offer.name }}</b><span class="tag">{{ offer.type }}</span><span v-if="offer.face" class="tag hot">主面 {{ FACE_NAME[offer.face] }}</span><span class="tag">{{ offer.grade }}</span>
      </div>

      <!-- 1 接案 -->
      <div v-if="tab === 'take'" class="cols3">
        <section class="panel cut pad">
          <p class="h">夢露手上的案子<Hint>信譽不夠的卡變淡並寫門檻。點卡看簡報。</Hint></p>
          <div class="row-list">
            <button v-for="o in OFFER_LIST" :key="o.id" type="button" class="lrow offer" :class="{ on: sel === o.id, 'is-unavailable': !!o.need }" :aria-disabled="!!o.need || undefined" :data-offer="o.id" @click="o.need ? ui.toast(`門檻：${o.need}。`, 'warn') : (sel = o.id)">
              <span class="fc" :class="o.face ?? 'x'">{{ o.face ? faceIcon[o.face] : '？' }}</span>
              <span class="grow"><b>{{ o.name }}</b><small>{{ o.grade }}・{{ o.type }}・{{ o.size }}・{{ o.cond }}</small><small v-if="o.need" class="warn-t">{{ o.need }}</small></span>
              <MoneyTag v-if="o.reward" kind="cash" :amount="o.reward" :size="13" /><span v-else class="mono">？？</span>
            </button>
          </div>
        </section>
        <section class="panel cut pad stack">
          <p class="h">簡報</p>
          <div class="grid2" style="--col-min: 180px">
            <div class="kv"><span>目標</span><b>{{ brief?.target }}</b></div><div class="kv"><span>地點</span><b>{{ brief?.place }}</b></div>
            <div class="kv"><span>主面</span><b>{{ brief?.main }}</b></div><div class="kv"><span>條件</span><b class="warn-t">{{ brief?.cond }}</b></div>
          </div>
          <blockquote class="says">「{{ brief?.says }}」</blockquote>
          <p class="t-fine">{{ brief?.spotted }}</p>
          <template v-if="sel === 'bluewhale'">
            <p class="h">後面的階段（要踩點才知道）</p>
            <div class="track"><span v-for="(s, i) in STAGES" :key="s.id" class="node" :class="{ key: s.key }">{{ s.key ? '★ ' + FACE_NAME[s.faces[0]] : `第${i + 1}階段 ？` }}</span></div>
          </template>
          <template v-else>
            <p class="h">後面的階段（要踩點才知道）<Hint>{{ tpl.ct }}：小型三階段（第 1、2、★）。決定性的一步只有主面可選。</Hint></p>
            <div class="track"><span v-for="(s, i) in tpl.stages" :key="s.id" class="node" :class="{ key: s.key }">{{ s.key ? '★ ' + FACE_NAME[s.faces[0]] : `第${i + 1}階段 ？` }}</span></div>
            <div class="kv"><span>報酬</span><b><MoneyTag kind="cash" :amount="tpl.offer.reward" :size="14" /></b></div>
            <div class="kv"><span>直播</span><b>{{ tpl.liveOk ? '委託人同意' : '委託人不同意：開播算違反不准曝光' }}</b></div>
          </template>
          <template v-if="sel === 'bluewhale'">
            <p class="h">談判<Hint title="談判">報酬、預付、裝備補助、抽成。白線是她大概的底線；壓到白線以下她會不高興。再談一輪是一次交涉（對 13），最多兩輪。</Hint></p>
            <div class="deal">
              <div class="kv"><span>報酬</span><b><MoneyTag kind="cash" :amount="job.reward" :size="14" /></b></div>
              <div class="slide"><i :style="{ width: `${(job.reward / DEAL.reward.max) * 100}%` }" /><em :style="{ left: `${(DEAL.reward.floor / DEAL.reward.max) * 100}%` }" /></div>
              <div class="kv"><span>預付 30%</span><b>接案時先拿 {{ fmt(Math.round(job.reward * DEAL.prepay)) }}</b></div>
              <div class="kv"><span>裝備補助</span><b>{{ DEAL.gear }}・只能在她的店裡用</b></div>
              <div class="kv"><span>她抽成</span><b>15%</b></div>
            </div>
            <p class="h">怎麼付</p>
            <div class="grid2" style="--col-min: 160px">
              <button v-for="p in pays" :key="p.id" type="button" class="lrow pay" :class="{ on: job.pay === p.id }" :disabled="job.step !== 'take'" @click="job.pay = p.id"><span class="grow"><b>{{ p.name }}</b><small>{{ p.cost }}</small></span><b class="mono">{{ fmt(p.get) }}</b></button>
            </div>
            <p v-if="negoNote" class="t-fine">{{ negoNote }}</p>
          </template>
          <div class="go">
            <template v-if="job.step === 'take' || job.offer !== sel">
              <button type="button" class="btn" @click="router.push('/')">不接</button>
              <ReasonButton v-if="sel === 'bluewhale'" :reason="negoDone ? '她不想再談了。' : null" @go="talk">再談一輪（交涉）</ReasonButton>
              <ReasonButton pri :reason="offerReason" data-accept @go="accept">接案</ReasonButton>
            </template>
            <span v-else class="tag hot">已經接了</span>
          </div>
        </section>
        <aside class="stack">
          <section class="panel cut pad">
            <p class="h">中間人</p>
            <b>{{ fixer?.name ?? '夢露' }}</b><div class="t-fine">{{ fixer?.identity }}・親密 {{ fixer?.affinity }}・{{ fixer?.stage }}</div>
            <div class="kv"><span>街頭信譽</span><b>38</b></div><div class="kv"><span>跟她接過的案</span><b>4 件・全數達成</b></div><div class="kv"><span>你手上進行中的</span><b>{{ job.offer ? 1 : 0 }} 件</b></div>
          </section>
          <section class="panel cut pad">
            <p class="h">這件事對你的帳</p>
            <div class="kv"><span>帳單（從帳戶扣）</span><b>{{ g.billIn }} 天後</b></div>
            <div class="kv"><span>扣掉她的抽成後（估）</span><b>{{ fmt(net) }}</b></div>
            <div class="kv"><span>會惹到的人</span><b>藍鯨・夜鶯</b></div>
            <div class="go left"><button type="button" class="btn sm" @click="ui.openRoot('fixer')">中間人的店</button></div>
          </section>
        </aside>
      </div>

      <!-- 2 踩點 -->
      <div v-else-if="tab === 'scout'" class="cols3">
        <section class="panel cut pad">
          <p class="h">未知清單・已揭開 {{ openCount }}／{{ job.unknowns.length }}</p>
          <div class="grid2" style="--col-min: 200px">
            <div v-for="u in job.unknowns" :key="u.id" class="unk" :class="{ open: u.open, fresh: u.fresh }">
              <span class="kc">{{ u.cat }}</span><b>{{ u.open ? u.text : '？？？？' }}</b><small v-if="!u.open">{{ u.by.map(id => meansOf(id).name).join('・') }}可以揭開</small>
            </div>
          </div>
          <p class="h" style="margin-top: 12px">踩點次數 {{ job.scouts }}／{{ MAX_SCOUT }}<Hint>中型 4 次。第 4 次起難度 +1。自然 1 會驚動目標（駭入：內海的追蹤度起始值 +15；其他：現實的警戒 +15）。</Hint></p>
          <div class="pips"><i v-for="n in MAX_SCOUT" :key="n" :class="{ used: n <= job.scouts, hard: n >= 4 }" /></div>
        </section>
        <section class="panel cut pad stack">
          <p class="h">揭開之後，副本長這樣</p>
          <div class="track"><span v-for="(s, i) in STAGES" :key="s.id" class="node" :class="{ key: s.key }">第{{ i + 1 }}階段：<template v-if="facesKnown(i)">{{ s.faces.map(f => FACE_NAME[f]).join('、') }}</template><template v-else>？</template></span></div>
          <div v-if="job.lastScout" class="roll mono">{{ job.lastScout }}</div>
          <div class="go"><button type="button" class="btn" @click="job.step = 'call'; tab = 'call'">不踩了，去召集</button><ReasonButton pri :reason="scoutReason" data-scout @go="scout">去踩點</ReasonButton></div>
        </section>
        <aside class="stack">
          <section class="panel cut pad">
            <p class="h">選一種手段・對 {{ dc }}（10 ＋ II × 2{{ nth >= 4 ? ' ＋ 1' : '' }}）</p>
            <div class="row-list">
              <button v-for="m in MEANS" :key="m.id" type="button" class="lrow" :class="{ on: means === m.id, 'is-unavailable': !!m.need }" :aria-disabled="!!m.need || undefined" @click="m.need ? ui.toast(m.need, 'warn') : (means = m.id)">
                <span class="grow"><b>{{ m.name }}</b><small>{{ m.skill }}・{{ m.reveals }}</small></span>
                <span class="mono">{{ m.price ? fmt(m.price) : `+${bonusOf(m.id)}・${chance(bonusOf(m.id), dc)}%` }}</span>
              </button>
            </div>
            <label v-if="means === 'buy'" class="buy"><span class="k">買哪一項</span><select v-model="buyTarget"><option value="">（選一項）</option><option v-for="u in job.unknowns.filter(x => !x.open)" :key="u.id" :value="u.id">{{ u.cat }}</option></select></label>
          </section>
          <section class="panel cut pad">
            <p class="h">誰去</p>
            <div class="segs"><button type="button" :class="{ on: who === 'me' }" @click="who = 'me'">自己去</button><button type="button" :class="{ on: who === 'npc_jo' }" @click="who = 'npc_jo'">派喬（250）</button></div>
            <p class="t-fine">{{ who === 'me' ? `花一個時段：${g.timeLabel} 起 4 小時` : '喬：隱匿 +6；出場費從帳戶付' }}</p>
          </section>
        </aside>
      </div>

      <!-- 3 召集 -->
      <div v-else-if="tab === 'call'" class="cols3">
        <section class="panel cut pad stack">
          <p class="h">隊伍・跟著你玩的那一面走（最多 4 人）</p>
          <div class="grid2" style="--col-min: 150px">
            <div v-for="id in job.party" :key="id" class="crew"><b>{{ CREW[id].name }}</b><small>{{ CREW[id].role }}・{{ CREW[id].strong }}</small><button v-if="id !== 'me'" type="button" class="btn sm ghost" @click="toggleCrew(id)">移除</button></div>
            <div v-for="n in Math.max(0, 4 - job.party.length)" :key="'e' + n" class="crew empty">空格</div>
          </div>
          <div class="go left"><button v-for="id in ROSTER_ADD.filter(x => !job.party.includes(x))" :key="id" type="button" class="btn sm" @click="toggleCrew(id)">＋ {{ CREW[id].name }}（{{ CREW[id].fav ? '用人情' : fmt(CREW[id].fee) }}）</button></div>
          <p class="h">技能配置・進去之後不能換</p>
          <div class="chips"><span v-for="n in skillNames" :key="n" class="tag">{{ n }}</span><span v-if="!skillNames.length" class="empty-note">沒有裝技能。</span></div>
        </section>
        <section class="panel cut pad stack">
          <p class="h">分帳（估）・只分報酬 {{ fmt(job.reward) }}<Hint>先扣中間人的抽成與出場費；剩下在場的人均分，你多拿一份當老闆。用人情請的人列在條外。</Hint></p>
          <div class="split"><span class="c1" :style="{ flex: sp.cut || 0.01 }">夢露 15%</span><span v-if="sp.fees" class="c2" :style="{ flex: sp.fees }">出場費</span><span class="c3" :style="{ flex: sp.mine }">你・兩份</span><span v-for="id in job.party.filter(x => x !== 'me')" :key="id" class="c4" :style="{ flex: sp.each }">{{ CREW[id].name }}</span></div>
          <p class="t-fine">先扣：夢露抽成 {{ fmt(sp.cut) }}、出場費 {{ fmt(sp.fees) }}；剩下 {{ fmt(sp.rest) }} 均分，你實拿 {{ fmt(sp.mine) }}。</p>
          <p class="h">輔助面・從名冊另外找人</p>
          <div v-for="f in (['m', 'n', 'o'] as Face[])" :key="f" class="sup">
            <span class="fc" :class="f">{{ faceIcon[f] }}</span>
            <template v-if="job.support[f]">
              <span class="grow"><b>{{ job.support[f]!.who }}</b><small>分量 {{ job.support[f]!.weight }} +{{ WEIGHT[job.support[f]!.weight] }}・1d20 ＋ {{ job.support[f]!.skill }} ＋ {{ WEIGHT[job.support[f]!.weight] }} 對 14・{{ supportPct(f) }}%</small></span>
              <div class="segs"><button v-for="h in HOW" :key="h" type="button" :class="{ on: job.support[f]!.how === h }" @click="job.support[f]!.how = h">{{ h }}</button></div>
            </template>
            <span v-else class="grow t-fine">{{ f === 'n' ? '零在隊上，打算每個階段都自己進內海的話可以不派。' : '名冊上沒有合適的人。' }}</span>
          </div>
        </section>
        <aside class="stack">
          <section class="panel cut pad">
            <p class="h">委託地點</p>
            <b>{{ runTpl.site }}</b><p class="t-fine">進去之後城裡的事全部暫停，撤退會回到現在。</p>
            <div class="go"><ReasonButton pri :reason="job.step === 'run' || job.step === 'done' ? '已經出發了。' : null" data-depart @go="depart">出發</ReasonButton></div>
          </section>
        </aside>
      </div>

      <!-- 4 副本 -->
      <div v-else class="run">
        <section class="panel cut pad rh">
          <b>{{ runTpl.site }}・{{ runTpl.offer.name }}</b><span class="tag">{{ runTpl.offer.grade }}</span><span class="tag">{{ runTpl.offer.type }}</span><span v-if="runTpl.offer.face" class="tag hot">主面 {{ FACE_NAME[runTpl.offer.face] }}</span><span class="tag warn">{{ runTpl.offer.cond }}</span>
          <button type="button" class="switch" :class="{ on: job.live }" :aria-pressed="job.live" aria-label="副本直播" data-live @click="toggleLive" /><span class="t-fine">直播</span>
          <span class="grow" />
          <div class="pres"><span class="k">警戒 {{ job.pressure.alert }}</span><TrackBar :value="job.pressure.alert" :max="100" color="var(--warn)" :marks="[60]" /></div>
          <div class="pres"><span class="k">追蹤度 {{ job.pressure.trace }}</span><TrackBar :value="job.pressure.trace" :max="100" color="var(--hp)" :marks="[30, 60, 90]" /></div>
          <ReasonButton sm :reason="job.breathe ? null : '這一趟已經喘過一次了。'" @go="breathe">喘口氣</ReasonButton>
          <button type="button" class="btn sm" @click="retreat">撤退</button>
        </section>
        <div class="runcols">
          <div class="stack">
            <section class="panel cut pad">
              <div class="strack">
                <div v-for="(s, i) in STAGES" :key="s.id" class="sn" :class="{ done: i < job.stage || job.step === 'done', now: i === job.stage && job.step !== 'done', key: s.key }">
                  <i>{{ s.key ? '★' : s.hidden && !stageKnown(s) && i > job.stage ? '?' : i + 1 }}</i>
                  <b>{{ s.hidden && !stageKnown(s) && i > job.stage ? '？？？' : s.name }}</b>
                  <span class="faces"><em v-for="f in s.faces" :key="f" :class="f" /></span>
                  <small>{{ job.done.find(d => d.stage === s.id) ? `你：${FACE_NAME[job.done.find(d => d.stage === s.id)!.face]}` : s.key ? '決定性的一步' : i === job.stage ? '現在' : '' }}</small>
                </div>
              </div>
            </section>
            <section v-if="job.step === 'done'" class="panel cut pad stack" data-job-done>
              <h3>{{ failed ? '委託失敗' : '收尾' }}</h3>
              <p>{{ failed ?? '委託完成了。收尾的報告寫進了紀錄。' }}</p>
              <div v-if="goalResult.length" class="goals"><b>直播目標</b><span v-for="x in goalResult" :key="x" class="t-fine">{{ x }}</span></div>
              <div class="go left"><button type="button" class="btn pri" @click="router.push('/')">回主畫面</button><button type="button" class="btn" @click="newJob">再接一件</button></div>
            </section>
            <section v-else class="panel cut pad stack">
              <div class="sth"><b>第{{ job.stage + 1 }}階段・{{ stage.name }}</b><span class="t-fine">城裡的時間 +2 小時</span></div>
              <div class="steps"><span v-for="(n, i) in ['選面', '輔助結算', '選分支', '玩這一段', '里程碑']" :key="n" :class="{ ok: i + 1 < stepNow, now: i + 1 === stepNow }">{{ ['①', '②', '③', '④', '⑤'][i] }} {{ n }}</span></div>
              <div v-if="failed" class="blocking">這一段沒打下來：{{ failed }}<div class="go left"><button type="button" class="btn sm pri" @click="retryStage">回到這個階段開始時</button><button type="button" class="btn sm" @click="retreat">撤退</button></div></div>
              <div class="grid2" style="--col-min: 200px">
                <button v-for="f in (['m', 'n', 'o'] as Face[])" :key="f" type="button" class="facec" :class="{ on: job.face === f, 'is-unavailable': !stage.faces.includes(f) }" :aria-disabled="!stage.faces.includes(f) || undefined" :data-face="f" @click="pickFace(f)">
                  <span class="fc" :class="f">{{ faceIcon[f] }}</span><b>{{ FACE_NAME[f] }}</b>
                  <small>{{ stage.desc[f] ?? '這個階段沒有開這一面。' }}</small>
                  <span v-if="job.face === f" class="tag hot">你在這裡</span>
                  <span v-else-if="stage.faces.includes(f) && job.support[f]" class="t-fine">輔助・{{ job.support[f]!.who }} {{ job.support[f]!.weight }} +{{ WEIGHT[job.support[f]!.weight] }}</span>
                </button>
              </div>
              <template v-if="job.face && !job.rolled">
                <div class="go left"><button type="button" class="btn pri" data-roll @click="rollSupport">輔助結算{{ supportFaces.length ? `（${supportFaces.length} 個面）` : '（沒有人去）' }}</button></div>
              </template>
              <div v-for="(r, i) in rolls" :key="i" class="roll mono">{{ r }}</div>
              <template v-if="job.face && job.rolled">
                <p class="h">在{{ FACE_NAME[job.face] }}怎麼走</p>
                <div class="row-list">
                  <button v-for="b in branches" :key="b.id" type="button" class="lrow br" :class="{ on: job.branch === b.id, 'is-unavailable': !!branchReason(b) }" :aria-disabled="!!branchReason(b) || undefined" :data-branch="b.id" @click="branchReason(b) ? ui.toast(branchReason(b)!, 'warn') : (job.branch = b.id)">
                    <span class="bt" :class="b.via">{{ b.tag }}</span><span class="grow"><b>{{ b.name }}</b><small>{{ b.need }}</small></span><span class="t-fine">{{ b.effect }}</span>
                  </button>
                </div>
                <p class="t-fine">選了就不能換；走過的分支會記到收尾。</p>
                <div v-if="modsNow && modsNow.notes.length" class="mods" data-mods><b>這一段用得到的連動</b><span v-for="n in modsNow.notes" :key="n" class="t-fine">{{ n }}</span></div>
                <div v-if="checkLine" class="roll mono">{{ checkLine }}</div>
                <div class="go"><ReasonButton pri :reason="!job.branch ? '先選一條路。' : null" data-enter @go="enter">進入這一段</ReasonButton></div>
              </template>
            </section>
          </div>
          <aside class="stack">
            <section v-if="job.live && job.goals?.length" class="panel cut pad" data-goals>
              <p class="h">直播目標<Hint>開播時從這一型的目標與共用的目標裡抽一到三個；收尾時逐條檢查，達成的每個熱度 +3，打賞照等級。直播中不能走潛行的路。</Hint></p>
              <div v-for="id in job.goals" :key="id" class="t-fine">・{{ JOB_GOALS[id]?.text ?? id }}</div>
            </section>
            <section class="panel cut pad">
              <p class="h">拿到的連動</p>
              <div v-if="!job.links.length" class="empty-note">還沒有。</div>
              <div v-for="(l, i) in job.links" :key="i" class="link" :class="{ used: l.used }"><span class="kc" :style="{ '--c': LINK_KIND[l.kind] }">{{ l.kind }}</span><b>{{ l.name }}</b><small>{{ l.from }} → {{ l.effect }}{{ l.used ? '（用掉了）' : '' }}</small></div>
            </section>
            <section class="panel cut pad"><p class="h">小隊</p><PartyRow v-for="m in g.party" :key="m.id" :m="m" /></section>
            <section class="panel cut pad"> <p class="h">輔助面的人</p><div v-for="f in (['m', 'o'] as Face[])" :key="f" class="kv"><span>{{ job.support[f]?.who ?? '—' }}</span><b>{{ FACE_NAME[f] }}・待命</b></div></section>
          </aside>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.screen { min-height: 100vh; display: flex; flex-direction: column; }
.wrap { flex: 1; padding: var(--space-4); display: grid; gap: var(--space-4); align-content: start; min-width: 0; }
.head { display: flex; align-items: center; gap: var(--space-3); flex-wrap: wrap; min-width: 0; }
.head .grow { flex: 1; }
.arrows :deep(.tab) { clip-path: polygon(0 0, calc(100% - 12px) 0, 100% 50%, calc(100% - 12px) 100%, 0 100%, 10px 50%); padding: 9px 24px; }
.offer .grow, .lrow .grow { display: grid; }
.fc { width: 28px; height: 28px; display: grid; place-items: center; font-weight: 900; font-size: var(--fs-sm); border-radius: 6px; flex: none; background: var(--bg-3); color: var(--ink); box-shadow: inset 0 0 0 2px var(--ap); }
.fc.m { background: var(--ink-2); color: var(--bg); } .fc.n { background: var(--net); color: var(--bg); } .fc.o { background: var(--ep); color: var(--bg); }
.says { margin: 0; padding: var(--space-3) var(--space-4); background: var(--bg-term); box-shadow: inset 3px 0 0 var(--a); font-size: var(--fs-sm); color: var(--ink-2); }
.track { display: flex; gap: var(--space-2); flex-wrap: wrap; }
.node { padding: var(--space-2) var(--space-3); background: var(--bg-2); font-size: var(--fs-xs); font-weight: 800; color: var(--ink-2); }
.node.key { box-shadow: inset 0 0 0 2px var(--ap); color: var(--ap); }
.slide { height: 10px; background: var(--bg-term); position: relative; margin: 4px 0 8px; }
.slide i { position: absolute; inset: 0 auto 0 0; background: var(--a); }
.slide em { position: absolute; top: -4px; width: 3px; height: 18px; background: var(--ink); }
.pay small { white-space: normal; }
.unk { background: var(--bg-2); padding: var(--space-3); display: grid; gap: 2px; background-image: repeating-linear-gradient(135deg, transparent 0 6px, color-mix(in srgb, var(--ink) 5%, transparent) 6px 8px); }
.unk.open { background-image: none; }
.unk.fresh { box-shadow: inset 0 0 0 2px var(--a); }
.unk small { color: var(--ink-3); font-size: var(--fs-fine); }
.pips { display: flex; gap: 4px; }
.pips i { width: 26px; height: 12px; background: var(--bg-2); }
.pips i.used { background: var(--a); }
.pips i.hard { box-shadow: inset 0 0 0 2px var(--warn); }
.roll { padding: var(--space-3); background: var(--bg-term); box-shadow: inset 3px 0 0 var(--a); font-size: var(--fs-xs); color: var(--ink-2); }
.buy { display: flex; gap: var(--space-3); align-items: center; margin-top: var(--space-3); }
.buy select { font: 800 var(--fs-sm) var(--font); background: var(--bg-term); color: var(--ink); border: 0; padding: 5px; }
.crew { background: var(--bg-2); padding: var(--space-3); display: grid; gap: 2px; justify-items: start; }
.crew small { color: var(--ink-3); font-size: var(--fs-fine); }
.crew.empty { box-shadow: inset 0 0 0 2px var(--line); background: transparent; color: var(--ink-3); outline: 2px dashed var(--line); outline-offset: -6px; min-height: 64px; place-items: center; }
.split { display: flex; height: 30px; gap: 2px; font-size: var(--fs-fine); font-weight: 800; }
.split span { display: grid; place-items: center; overflow: hidden; white-space: nowrap; color: var(--bg); min-width: 0; }
.c1 { background: var(--ap); } .c2 { background: var(--warn); } .c3 { background: var(--a); color: var(--on-a) !important; } .c4 { background: var(--sink); }
.sup { display: flex; align-items: center; gap: var(--space-3); flex-wrap: wrap; padding: var(--space-3); background: var(--bg-2); }
.sup .grow { flex: 1; display: grid; min-width: 160px; }
.sup small { color: var(--ink-3); font-size: var(--fs-fine); }
.run { display: grid; gap: var(--space-4); }
.rh { display: flex; align-items: center; gap: var(--space-3); flex-wrap: wrap; }
.rh .grow { flex: 1; }
.pres { display: grid; gap: 2px; min-width: 140px; }
.runcols { display: grid; grid-template-columns: minmax(0, 1fr) 320px; gap: var(--space-4); align-items: start; }
.strack { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: var(--space-3); }
.sn { display: grid; gap: 2px; justify-items: center; text-align: center; padding: var(--space-3); background: var(--bg-2); }
.sn i { width: 30px; height: 30px; display: grid; place-items: center; transform: rotate(45deg); background: var(--bg-3); font-style: normal; font-weight: 900; }
.sn.done i { background: var(--b); } .sn.now i { background: var(--a); color: var(--on-a); } .sn.key i { box-shadow: 0 0 0 2px var(--ap); color: var(--ap); }
.sn b { margin-top: 6px; }
.sn small { color: var(--ink-3); font-size: var(--fs-fine); }
.faces { display: flex; gap: 3px; }
.faces em { width: 16px; height: 5px; border-radius: 2px; }
.faces em.m { background: var(--ink-2); } .faces em.n { background: var(--net); } .faces em.o { background: var(--ep); }
.sth { display: flex; gap: var(--space-3); align-items: baseline; }
.steps { display: flex; gap: var(--space-2); flex-wrap: wrap; font-size: var(--fs-fine); font-weight: 800; }
.steps span { padding: 3px 8px; background: var(--bg-2); color: var(--ink-3); }
.steps span.ok { color: var(--ok); } .steps span.now { background: var(--a); color: var(--on-a); }
.facec { display: grid; gap: var(--space-2); justify-items: start; text-align: left; padding: var(--space-4); background: var(--bg-2); border: 0; color: var(--ink); font: inherit; cursor: pointer; }
.facec.on { box-shadow: inset 0 0 0 3px var(--a); }
.facec small { color: var(--ink-2); font-size: var(--fs-xs); }
.br .bt { width: 26px; height: 26px; display: grid; place-items: center; font-weight: 900; background: var(--bg-3); flex: none; }
.br .bt.link { background: var(--ram); color: var(--bg); } .br .bt.scout { background: var(--ap); color: var(--bg); }
.br > .t-fine { max-width: 40%; text-align: right; }
.link { display: grid; grid-template-columns: auto 1fr; gap: 2px var(--space-3); padding: var(--space-2) 0; border-bottom: 1px dashed var(--line); }
.link small { grid-column: 1 / -1; color: var(--ink-3); font-size: var(--fs-fine); }
.go.left { justify-content: flex-start; }
@media (max-width: 1100px) { .runcols { grid-template-columns: minmax(0, 1fr); } }
@media (max-width: 720px) {
  .wrap { padding: var(--space-3); }
  .strack { grid-template-columns: repeat(2, minmax(0, 1fr)); }
  .br { flex-wrap: wrap; }
  .br > .t-fine { max-width: none; text-align: left; flex-basis: 100%; }
}
.mods, .goals { display: grid; gap: 2px; padding: 8px 12px; background: var(--bg-term); box-shadow: inset 3px 0 0 var(--ram); }
.link.used { opacity: .55; }
</style>
