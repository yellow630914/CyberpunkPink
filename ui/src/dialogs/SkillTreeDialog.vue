<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import Dialog from '../components/Dialog.vue'
import Hint from '../components/Hint.vue'
import Icon from '../components/Icon.vue'
import ReasonButton from '../components/ReasonButton.vue'
import { useGame } from '../stores/game'
import { useSettings } from '../stores/settings'
import { useUi } from '../stores/ui'
import { SKILL_TREES, NIGHT_BRANCHES } from '../data/content.generated'
import type { SkillDef, NightSkillDef, TreeId } from '../data/skillTypes'
import {
  TIER_THRESHOLDS, tierOpen, toNextTier, treeSpent, skillState, learnBlock, learnPreview, skillXp, KIND_SHORT, CAT_COLOR,
  nightTierOpen, nightVisible, nightLearnBlock, nightNeedBlock, nightCost, type NightProfile,
} from '../lib/skills'
import { useGuides } from '../lib/useGuides'

/**
 * 技能樹（UI 8.4 節，規則 SKILLS 1.3、1.4、1.10、1.12 節；內容 SKILL_TREES、NIGHT_LESSONS）。學技能在這裡，裝進橋在角色的「橋」分頁。
 * 三欄：樹的清單；樹（三條線、五階、每階前層與後層，前置用直角的線接起來）；詳情。夜課換成五個分支 × 五階。
 */
const props = defineProps<{ entryId: number; stacked?: boolean; tree?: string; skill?: string }>()
const g = useGame()
const st = useSettings()
const ui = useUi()
const guides = useGuides()
guides.trigger('g_tree')
const treeId = ref<TreeId | 'night'>((props.tree as TreeId) ?? 'gun')
const learnedSet = computed(() => new Set(g.learned))
const tree = computed(() => SKILL_TREES.find(t => t.id === treeId.value) ?? SKILL_TREES[0])
const spent = computed(() => treeSpent(tree.value, learnedSet.value))
const open = computed(() => tierOpen(spent.value))
const selId = ref<string>(props.skill ?? tree.value.skills[0].id)
watch(treeId, t => {
  if (t === 'night') { selId.value = NIGHT_BRANCHES[0].skills[0].id; guides.trigger('g_night') }
  else selId.value = SKILL_TREES.find(x => x.id === t)!.skills[0].id
  nextTick(drawLinks)
})
const sel = computed<SkillDef | null>(() => (treeId.value === 'night' ? null : tree.value.skills.find(s => s.id === selId.value) ?? null))
const selNight = computed<NightSkillDef | null>(() => (treeId.value === 'night' ? NIGHT_BRANCHES.flatMap(b => b.skills).find(s => s.id === selId.value) ?? null : null))

/** 一階的兩層：前層三格照線排；後層照它的前置那條線排。 */
function tierRows(t: number) {
  const sk = tree.value.skills.filter(s => s.tier === t && s.layer !== 'sig')
  const row = (layer: 'front' | 'back') => [0, 1, 2].map(line => sk.filter(s => s.layer === layer && s.line === line))
  return { front: row('front'), back: row('back') }
}
const sig = computed(() => tree.value.skills.find(s => s.layer === 'sig')!)
const STR_COLOR: Record<string, string> = { 強: 'var(--a)', 中: 'var(--ap)', 弱: 'var(--ink-3)', 無: 'var(--line-2)' }
const lineNames = computed(() => [0, 1, 2].map(i => tree.value.skills.find(s => s.tier === 1 && s.layer === 'front' && s.line === i)?.name ?? ''))
const iconOf = (s: SkillDef) => s.icon ?? `ic-sk_${s.tree}_${s.kind}`

function learn() {
  const s = sel.value
  if (!s) return
  g.learnSkill(s.id)
  ui.toast(`學會了「${s.name}」。裝進橋在角色的「橋」分頁。`)
  nextTick(drawLinks)
}
const block = computed(() => (sel.value ? learnBlock(tree.value, sel.value, learnedSet.value, g.character.xp) : null))
const preview = computed(() => (sel.value ? learnPreview(tree.value, sel.value, learnedSet.value) : null))

// ---- 前置的連線：量技能卡的位置，畫直角線 ----
const treeBox = ref<HTMLElement | null>(null)
const links = ref<Array<{ d: string; kind: 'lit' | 'can' | 'dim' }>>([])
function drawLinks() {
  const box = treeBox.value
  if (!box || treeId.value === 'night') { links.value = []; return }
  const b = box.getBoundingClientRect()
  const pos = new Map<string, DOMRect>()
  box.querySelectorAll<HTMLElement>('[data-sk]').forEach(el => pos.set(el.dataset.sk!, el.getBoundingClientRect()))
  const out: typeof links.value = []
  for (const s of tree.value.skills) {
    if (!s.pre) continue
    const from = pos.get(`${s.tree}:${s.pre}`), to = pos.get(s.id)
    if (!from || !to) continue
    const x1 = from.left + from.width / 2 - b.left, y1 = from.bottom - b.top
    const x2 = to.left + to.width / 2 - b.left, y2 = to.top - b.top
    const my = Math.round(y2 - 7)
    const d = `M${x1} ${y1} V${my} H${x2} V${y2}`
    const st2 = skillState(tree.value, s, learnedSet.value)
    out.push({ d, kind: st2 === 'learned' ? 'lit' : st2 === 'can' && learnedSet.value.has(`${s.tree}:${s.pre}`) ? 'can' : 'dim' })
  }
  links.value = out
}
let ro: ResizeObserver | null = null
onMounted(() => { nextTick(drawLinks); ro = new ResizeObserver(() => drawLinks()); if (treeBox.value) ro.observe(treeBox.value) })
onBeforeUnmount(() => ro?.disconnect())

// ---- 夜課 ----
const FILTER_TAG: Record<string, 'filterRestraint' | 'filterDollChip' | 'filterPublic'> = { 束縛: 'filterRestraint', 人偶: 'filterDollChip', 暴露: 'filterPublic' }
const profile = computed<NightProfile & { params: Record<string, number> }>(() => ({
  count: g.sexRecord.count, partners: g.sexRecord.partners, axes: g.tendency.axes, tags: g.tendency.tags,
  filtered: new Set(Object.entries(FILTER_TAG).filter(([, k]) => !st.s[k]).map(([t]) => t)), params: g.params,
}))
const AXIS_OF: Record<string, '關係' | '感官' | '身體' | '扮相'> = { relation: '關係', sense: '感官', body: '身體', look: '扮相' }
const nightLearned = computed(() => new Set(g.nightLearned))
function nightCell(bId: string, t: number) {
  const br = NIGHT_BRANCHES.find(b => b.id === bId)!
  const sk = br.skills.filter(s => s.tier === t)
  const shown = sk.filter(s => nightVisible(s, profile.value) === 'show')
  const hidden = sk.filter(s => nightVisible(s, profile.value) === 'hidden-tag').length
  const openT = nightTierOpen(bId, profile.value)
  const gate = bId === 'common' ? (br.gates.find(x => x.tier === t)?.need ?? '') : `${AXIS_OF[bId]} ${t} 級`
  return { shown, hidden, open: t <= openT, gate }
}
const nightBlock = computed(() => {
  const s = selNight.value
  if (!s) return null
  return nightLearnBlock(s, nightLearned.value, profile.value, g.character.insight) ?? nightNeedBlock(s.need, profile.value)
})
function learnN() {
  const s = selNight.value
  if (!s) return
  g.learnNight(s.id, nightCost(s))
  ui.toast(`學會了「${s.name}」。`)
}
const nightAxis = (bId: string) => (bId === 'common' ? `${g.sexRecord.count} 次・${g.sexRecord.partners} 人` : `${AXIS_OF[bId]} ${g.tendency.axes[AXIS_OF[bId]]} 級`)
</script>

<template>
  <Dialog :entry-id="entryId" :stacked="stacked" title="技能樹" :sub="`歷練點 ${g.character.xp}・體悟 ${g.character.insight}`" size="xl">
    <template #header><Hint title="技能樹">學一個技能花「階 × 20」歷練點，算進那棵樹的累計；累計到 40、120、240、400 開 2～5 階。要先學會前置。每開一階多一個不佔容量的共鳴。學會與裝上是兩回事：裝上看橋的容量。</Hint></template>
    <div class="sk">
      <!-- 樹的清單 -->
      <nav class="trees" aria-label="技能樹">
        <button v-for="t in SKILL_TREES" :key="t.id" type="button" class="tr cut-sm" :class="{ on: treeId === t.id, dim: !treeSpent(t, learnedSet) }" @click="treeId = t.id">
          <span class="tn"><b>{{ t.name }}</b><small :style="{ color: CAT_COLOR[t.category] }">{{ t.category }}</small></span>
          <small class="sg">{{ t.signature }}・{{ treeSpent(t, learnedSet) }} 點</small>
          <span class="pips"><i v-for="n in 5" :key="n" :class="{ on: n <= tierOpen(treeSpent(t, learnedSet)) && treeSpent(t, learnedSet) > 0 }" /></span>
        </button>
        <button type="button" class="tr cut-sm night" :class="{ on: treeId === 'night' }" @click="treeId = 'night'">
          <span class="tn"><b>夜課</b><small>體悟 {{ g.character.insight }}</small></span>
          <small class="sg">五個分支・只在成人場景</small>
        </button>
      </nav>

      <!-- 樹 -->
      <section v-if="treeId !== 'night'" class="panel cut pad main">
        <header class="th">
          <div class="str"><span v-for="[k, n] in [['real', '現實'], ['net', '內海'], ['opinion', '輿論']] as const" :key="k" class="tag" :style="{ color: STR_COLOR[tree.strength[k]] }">{{ n }} {{ tree.strength[k] }}</span></div>
          <h3>{{ tree.name }}<small>{{ tree.signature }}</small><Hint :text="tree.intro" /></h3>
          <div class="prog">
            <div class="bar"><b :style="{ width: Math.min(100, (spent / 400) * 100) + '%' }" /><i v-for="th in TIER_THRESHOLDS.slice(1)" :key="th" :style="{ left: (th / 400) * 100 + '%' }" /></div>
            <small class="k">累計 {{ spent }}・開到 {{ open }} 階<template v-if="toNextTier(spent)">・再 {{ toNextTier(spent) }} 點開 {{ open + 1 }} 階</template></small>
          </div>
        </header>
        <div ref="treeBox" class="tree">
          <svg class="links" aria-hidden="true"><path v-for="(l, i) in links" :key="i" :d="l.d" :class="l.kind" /></svg>
          <div class="lines"><span v-for="(n, i) in lineNames" :key="i" class="k">{{ n }}線</span></div>
          <div class="sigrow">
            <button type="button" class="card sigc" :data-sk="sig.id" :class="[skillState(tree, sig, learnedSet), { sel: selId === sig.id }]" @click="selId = sig.id">
              <Icon :id="iconOf(sig)" :size="26" fit /><span class="cn"><b>{{ sig.name }}</b><small>招牌・{{ sig.kindName }}・{{ sig.cap }}</small></span>
            </button>
          </div>
          <div v-for="t in 5" :key="t" class="tier" :class="{ locked: t > open }">
            <div class="tl"><b>{{ t }} 階</b><small>{{ TIER_THRESHOLDS[t - 1] }}</small></div>
            <div v-for="layer in ['front', 'back'] as const" :key="layer" class="layer" :class="layer">
              <div v-for="(cell, li) in tierRows(t)[layer]" :key="li" class="cell">
                <button v-for="s in cell" :key="s.id" type="button" class="card" :data-sk="s.id" :class="[skillState(tree, s, learnedSet), { sel: selId === s.id }]" :aria-pressed="selId === s.id" @click="selId = s.id">
                  <span class="kd">{{ KIND_SHORT[s.kind] }}</span>
                  <span class="cn"><b>{{ s.name }}</b><small>{{ s.kindName }}・容量 {{ s.cap }}</small></span>
                  <span v-if="skillState(tree, s, learnedSet) === 'can'" class="cost mono">{{ skillXp(s) }}</span>
                  <span v-else-if="skillState(tree, s, learnedSet) === 'learned'" class="ck">✓</span>
                </button>
              </div>
            </div>
          </div>
        </div>
        <p class="h">共鳴<Hint>每開一階多一個共鳴被動，不佔容量，開了就生效。</Hint></p>
        <div class="res">
          <div v-for="r in tree.resonance" :key="r.tier" class="rc" :class="{ on: r.tier <= open && spent > 0 }"><b>{{ r.tier }}</b><span>{{ r.effect }}</span></div>
        </div>
      </section>

      <!-- 夜課 -->
      <section v-else class="panel cut pad main">
        <header class="th"><h3>夜課<small>學技能花體悟；在成人場景裡用的不佔橋的容量</small><Hint>共通看性經歷的次數或人數開階，其他四個分支看那一條軸的等級。掛在你沒有的標籤上的技能不顯示；被內容篩選關掉的標籤，技能整個不出現，也不算進數字。標籤是「深」的技能效果 +1 級。延伸到成人場景以外的技能要裝進橋，佔社交類的容量。</Hint></h3></header>
        <div class="ngrid">
          <div class="nh" />
          <div v-for="b in NIGHT_BRANCHES" :key="b.id" class="nh"><b>{{ b.name }}</b><small>{{ nightAxis(b.id) }}</small></div>
          <template v-for="t in 5" :key="t">
            <div class="ntl"><b>{{ t }} 階</b><small>體悟 {{ t * 10 }}</small></div>
            <div v-for="b in NIGHT_BRANCHES" :key="b.id + t" class="ncell" :class="{ open: nightCell(b.id, t).open }">
              <small class="gate">{{ nightCell(b.id, t).gate }}</small>
              <button v-for="s in nightCell(b.id, t).shown" :key="s.id" type="button" class="card ncard" :class="{ learned: nightLearned.has(s.id), sel: selId === s.id, deep: g.tendency.tags[s.tag] === '深', locked: !nightCell(b.id, t).open }" @click="selId = s.id">
                <span class="kd">{{ KIND_SHORT[s.kind] }}</span><span class="cn"><b>{{ s.name }}</b></span><span v-if="nightLearned.has(s.id)" class="ck">✓</span>
              </button>
              <small v-if="nightCell(b.id, t).hidden" class="hid">{{ nightCell(b.id, t).hidden }} 個掛在你沒有的標籤上</small>
            </div>
          </template>
        </div>
      </section>

      <!-- 詳情 -->
      <aside class="panel cut pad det">
        <template v-if="sel">
          <div class="dh"><span class="di"><Icon :id="iconOf(sel)" :size="40" fit /></span><div><div class="k">{{ tree.name }}・{{ sel.tier }} 階・{{ sel.layer === 'sig' ? '招牌' : sel.layer === 'front' ? '前層' : '後層' }}</div><h3>{{ sel.name }}</h3><div class="chips"><span class="tag">{{ sel.kindName }}</span><span class="tag" :style="{ color: CAT_COLOR[tree.category] }">{{ tree.category }} {{ sel.cap }}</span><span v-if="sel.cost" class="tag">{{ sel.cost }}</span></div></div></div>
          <div class="kv"><span>前置</span><b>{{ sel.pre ? `${learnedSet.has(`${sel.tree}:${sel.pre}`) ? '✓ ' : ''}${sel.pre}` : '—' }}</b></div>
          <div class="kv"><span>花費</span><b>{{ skillXp(sel) }} 歷練點</b></div>
          <div class="kv"><span>線</span><b>{{ sel.line >= 0 ? `${lineNames[sel.line]}線` : '招牌' }}</b></div>
          <div v-for="[k, n] in [['real', '現實'], ['net', '內海'], ['opinion', '輿論']] as const" :key="k" class="field" :class="{ none: sel[k] === '—' }">
            <b>{{ n }}<span :style="{ color: STR_COLOR[tree.strength[k]] }">・{{ tree.strength[k] }}</span></b><p>{{ sel[k] }}</p>
          </div>
          <div v-if="preview && !learnedSet.has(sel.id)" class="pvw">
            <div class="kv"><span>學了之後</span><b>累計 {{ preview.after }}・{{ preview.tierAfter }} 階</b></div>
            <div v-if="preview.tierAfter > preview.tierBefore" class="kv"><span>開出</span><b class="ok-t">{{ preview.tierAfter }} 階</b></div>
            <div v-if="preview.opens.length" class="kv"><span>能學的多了</span><b>{{ preview.opens.map(s => s.name).join('、') }}</b></div>
          </div>
          <div class="go"><ReasonButton pri :reason="block" @go="learn">{{ learnedSet.has(sel.id) ? '已經學會' : `學（${skillXp(sel)}）` }}</ReasonButton></div>
          <div v-if="block && !learnedSet.has(sel.id)" class="why">{{ block }}</div>
        </template>
        <template v-else-if="selNight">
          <div class="dh"><span class="di"><Icon :id="selNight.icon ?? `ic-sk_night_${selNight.kind === 'pose' ? 'active' : selNight.kind}`" :size="40" fit /></span><div><div class="k">夜課・{{ NIGHT_BRANCHES.find(b => b.id === selNight!.branch)!.name }}・{{ selNight.tier }} 階</div><h3>{{ selNight.name }}</h3><div class="chips"><span class="tag">{{ selNight.use }}</span><span class="tag">掛在 {{ selNight.tag }}</span><span v-if="selNight.extends" class="tag" :style="{ color: CAT_COLOR['社交'] }">延伸・佔社交</span></div></div></div>
          <div v-if="g.tendency.tags[selNight.tag] === '深'" class="kv"><span>標籤深</span><b class="ok-t">效果 +1 級：{{ selNight.deep }}</b></div>
          <div class="field"><b>怎麼做</b><p>{{ selNight.how }}</p></div>
          <div class="field"><b>效果</b><p>{{ selNight.effect }}</p></div>
          <div v-if="selNight.parts" class="kv"><span>部位</span><b>{{ selNight.parts }}</b></div>
          <div class="kv"><span>學習條件</span><b>{{ selNight.need || '—' }}</b></div>
          <div class="go"><ReasonButton pri :reason="nightBlock" @go="learnN">{{ nightLearned.has(selNight.id) ? '已經學會' : `學（體悟 ${nightCost(selNight)}）` }}</ReasonButton></div>
          <div v-if="nightBlock && !nightLearned.has(selNight.id)" class="why">{{ nightBlock }}</div>
          <div class="empty-note">體悟從成人場景與成人事件來，不能用歷練點換。</div>
        </template>
      </aside>
    </div>
  </Dialog>
</template>

<style scoped>
.sk { display: grid; grid-template-columns: 200px minmax(0, 1fr) 300px; gap: 12px; align-items: start; }
.trees { display: grid; gap: 5px; }
.tr { display: grid; gap: 3px; padding: 8px 10px; background: var(--bg-2); border: 0; color: var(--ink); text-align: left; cursor: pointer; }
.tr.on { box-shadow: inset 0 0 0 2px var(--a); }
.tr.dim { opacity: .55; }
.tr.night { margin-top: 8px; box-shadow: inset 0 0 0 1px var(--a); }
.tr.night.on { box-shadow: inset 0 0 0 2px var(--a); }
.tn { display: flex; justify-content: space-between; gap: 6px; }
.tn small { font-size: var(--fs-fine); font-weight: 800; }
.sg { font-size: var(--fs-fine); color: var(--ink-3); }
.pips { display: flex; gap: 3px; }
.pips i { flex: 1; height: 4px; border-radius: 2px; background: var(--bg-term); }
.pips i.on { background: var(--a); }
.main { min-width: 0; }
.th h3 { margin: 4px 0 8px; font-size: var(--fs-section); display: flex; gap: 8px; align-items: baseline; flex-wrap: wrap; }
.th h3 small { font-size: var(--fs-sm); color: var(--ap); font-weight: 800; }
.str { display: flex; gap: 4px; flex-wrap: wrap; }
.prog { margin-bottom: 10px; }
.bar { position: relative; height: 8px; background: var(--bg-term); border-radius: 4px; margin-bottom: 4px; }
.bar b { position: absolute; inset: 0 auto 0 0; background: var(--a); border-radius: 4px; }
.bar i { position: absolute; top: -3px; bottom: -3px; width: 2px; background: var(--ink-3); }
.tree { position: relative; padding-bottom: 6px; }
.links { position: absolute; inset: 0; width: 100%; height: 100%; pointer-events: none; overflow: visible; }
.links path { fill: none; stroke: var(--line-2); stroke-width: 2; }
.links path.lit { stroke: var(--a); filter: drop-shadow(0 0 3px var(--a)); }
.links path.can { stroke: var(--a); stroke-dasharray: 4 3; }
.lines { display: grid; grid-template-columns: 44px repeat(3, minmax(0, 1fr)); gap: 8px; margin-left: 0; text-align: center; }
.lines span:first-child { grid-column: 2; }
.sigrow { display: flex; justify-content: center; margin: 6px 0 14px; }
.tier { display: grid; grid-template-columns: 44px minmax(0, 1fr); grid-template-rows: auto auto; column-gap: 8px; row-gap: 14px; margin-bottom: 16px; position: relative; }
.tier.locked .layer { background: repeating-linear-gradient(135deg, transparent 0 6px, color-mix(in srgb, var(--line) 50%, transparent) 6px 8px); opacity: .6; }
.tl { grid-row: 1 / span 2; display: grid; align-content: start; }
.tl small { color: var(--ink-3); font: 800 var(--fs-tiny) var(--mono); }
.layer { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 8px; grid-column: 2; }
.layer.back { padding-left: 14px; }
.cell { display: grid; gap: 14px; align-content: start; }
.card { position: relative; z-index: 1; display: flex; gap: 6px; align-items: center; padding: 6px 8px; background: var(--bg-2); border: 0; color: var(--ink); text-align: left; cursor: pointer; min-width: 0; width: 100%; box-shadow: inset 0 0 0 1px var(--line); }
.back .card { background: var(--bg-1); }
.card .cn { min-width: 0; flex: 1; display: grid; }
.card .cn b { font-size: var(--fs-sm); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.card .cn small { font-size: var(--fs-tiny); color: var(--ink-3); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.kd { width: 20px; height: 20px; border-radius: 5px; display: grid; place-items: center; font-size: var(--fs-fine); font-weight: 900; background: var(--bg-term); color: var(--ink-2); flex: none; }
.card.learned { background: var(--a); color: #fff; box-shadow: none; }
.card.learned .cn small { color: #ffe3ef; }
.card.learned .kd { background: #ffffff33; color: #fff; }
.card.can { box-shadow: inset 0 0 0 2px var(--a); }
.card.need-pre { opacity: .55; }
.card.locked { opacity: .35; }
.card.sel { outline: 2px solid var(--ap); outline-offset: 2px; }
.cost { position: absolute; right: 4px; top: -8px; font-size: var(--fs-tiny); font-weight: 900; background: var(--a); color: #fff; padding: 0 4px; border-radius: 4px; }
.ck { font-weight: 900; }
.sigc { width: min(260px, 100%); box-shadow: inset 0 0 0 2px var(--g4); }
.sigc.learned { background: color-mix(in srgb, var(--g4) 30%, var(--a)); }
.res { display: grid; grid-template-columns: repeat(5, minmax(0, 1fr)); gap: 6px; }
.rc { padding: 8px; background: var(--bg-2); font-size: var(--fs-fine); color: var(--ink-3); display: grid; gap: 3px; }
.rc.on { color: var(--ink); box-shadow: inset 0 3px 0 var(--a); }
.det { position: sticky; top: 0; }
.dh { display: flex; gap: 10px; align-items: center; margin-bottom: 8px; }
.di { width: 56px; height: 56px; display: grid; place-items: center; background: var(--bg-term); border-radius: 10px; flex: none; }
.dh h3 { margin: 2px 0 4px; font-size: var(--fs-section); }
.field { padding: 8px 0; border-bottom: 1px dashed var(--line); }
.field b { font-size: var(--fs-sm); }
.field p { margin: 3px 0 0; font-size: var(--fs-sm); line-height: 1.65; color: var(--ink-2); }
.field.none { opacity: .45; }
.pvw { margin-top: 6px; }
.why { font-size: var(--fs-sm); color: var(--warn); font-weight: 700; margin-top: 6px; text-align: right; }
.ngrid { display: grid; grid-template-columns: 52px repeat(5, minmax(0, 1fr)); gap: 6px; }
.nh { display: grid; text-align: center; padding: 4px; }
.nh small { font-size: var(--fs-tiny); color: var(--a); font-weight: 800; }
.ntl { display: grid; align-content: start; }
.ntl small { font: 800 var(--fs-tiny) var(--mono); color: var(--ink-3); }
.ncell { background: var(--bg-1); padding: 6px; display: grid; gap: 5px; align-content: start; min-width: 0; box-shadow: inset 0 0 0 1px var(--line); }
.ncell.open { box-shadow: inset 0 0 0 2px var(--a); }
.gate { font-size: var(--fs-tiny); color: var(--ink-3); font-weight: 800; }
.ncard { padding: 5px 6px; }
.ncard.deep { box-shadow: inset 0 0 0 2px var(--a-hi); }
.hid { font-size: var(--fs-tiny); color: var(--ink-3); }
@media (max-width: 1200px) { .sk { grid-template-columns: 180px minmax(0, 1fr); } .det { grid-column: 1 / -1; position: static; } }
@media (max-width: 720px) {
  .sk { grid-template-columns: minmax(0, 1fr); }
  .trees { display: flex; overflow-x: auto; gap: 6px; padding-bottom: 4px; }
  .tr { flex: 0 0 130px; }
  .card .cn small, .kd, .cost { display: none; }
  .card { padding: 6px 5px; }
  .card .cn b { font-size: var(--fs-fine); white-space: normal; }
  .layer.back { padding-left: 6px; }
  .tier { grid-template-columns: 30px minmax(0, 1fr); column-gap: 4px; }
  .lines { grid-template-columns: 30px repeat(3, minmax(0, 1fr)); font-size: var(--fs-tiny); }
  .res { grid-template-columns: repeat(2, minmax(0, 1fr)); }
  .ngrid { grid-template-columns: 36px repeat(5, minmax(84px, 1fr)); }
  .main { overflow-x: auto; }
}
</style>
