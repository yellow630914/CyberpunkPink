<script setup lang="ts">
import { computed, ref } from 'vue'
import Hint from './Hint.vue'
import ReasonButton from './ReasonButton.vue'
import { useEngine } from '../stores/engine'
import { useUi } from '../stores/ui'
import { CAT_COLOR, CATEGORY_NAME, DOMAIN_NAME, KIND_NAME, LAYER_NAME, cardOf, gridOf, lanesOf, listTrees, richText, useLine } from '../lib/skillView'

/**
 * 技能樹的本體（UI.md 8.4 節）：讀引擎的內容與狀態（stores/engine.ts 的 skills）。
 * 左：樹的清單；中：抬頭（三個戰場的強弱、累計花費的進度條）、樹（招牌在上，每階前層後層，三條線一條一欄）、共鳴；右：詳情與「學」。
 * 只編排：能不能學、原因是哪一句都是引擎的答案。夜課、體悟、預備還沒有（引擎沒做）。
 */
const props = defineProps<{ tree?: string; skill?: string }>()
const eng = useEngine()
const ui = useUi()

const trees = computed(() => listTrees(eng.skills.paths(), eng.skills.abilities(), eng.skills.mine(), eng.skills.tierOf, eng.skills.treeXp))
const treeId = ref<string | null>(props.tree ?? null)
const tree = computed(() => trees.value.find((t) => t.id === treeId.value) ?? trees.value.find((t) => t.abilities.some((a) => a.id === props.skill)) ?? trees.value[0] ?? null)
const selId = ref<string | null>(props.skill ?? null)
const sel = computed(() => tree.value?.abilities.find((a) => a.id === selId.value) ?? (tree.value ? tree.value.abilities.find((a) => a.id === tree.value!.signature) ?? tree.value.abilities[0] ?? null : null))
const mine = computed(() => eng.skills.mine())
const path = computed(() => eng.skills.paths().find((p) => p.id === tree.value?.id))
const grid = computed(() => (tree.value ? gridOf(tree.value) : null))
const open = computed(() => tree.value?.tier ?? 1)
const lock = computed(() => eng.skills.lock())
const cardFor = (ab: Parameters<typeof cardOf>[0]) => cardOf(ab, mine.value, open.value, eng.skills.learnBlock(ab.id))
const selCard = computed(() => (sel.value ? cardFor(sel.value) : null))
const lanes = computed(() => (sel.value ? lanesOf(sel.value, path.value) : []))
const after = computed(() => (sel.value?.after ? eng.skills.abilities().find((a) => a.id === sel.value!.after) ?? null : null))
const xpMax = computed(() => eng.skills.treeXp[eng.skills.treeXp.length - 1] ?? 1)
const progress = computed(() => ({ pct: `${Math.min(100, ((tree.value?.spent ?? 0) / xpMax.value) * 100)}%`, marks: eng.skills.treeXp.slice(1).map((x) => ({ x, left: `${(x / xpMax.value) * 100}%` })) }))
const resonance = computed(() => (path.value?.resonance ?? []).map((r) => ({ ...r, on: r.tier <= open.value })))
const catColor = (c: keyof typeof CAT_COLOR) => CAT_COLOR[c]

function pickTree(id: string) {
  treeId.value = id
  selId.value = null
}
function learn() {
  if (!sel.value) return
  const name = sel.value.name
  const why = eng.skills.learn(sel.value.id)
  if (why) ui.toast(why, 'warn')
  else ui.toast(`學會了「${name}」。裝進橋在角色的「橋」分頁。`)
}
const stateName = { learned: '學會了', can: '可以學', blocked: '條件不夠', locked: '那一階還沒開' } as const
</script>

<template>
  <div v-if="!trees.length" class="empty-note pad" data-empty>還沒有技能的資料。</div>
  <div v-else class="stv">
    <nav class="trees" aria-label="樹的清單">
      <button v-for="t in trees" :key="t.id" type="button" class="tr cut-sm" :class="{ on: tree?.id === t.id, dim: t.dim }" :data-tree="t.id" @click="pickTree(t.id)">
        <span class="tn"><b>{{ t.name }}</b><small>{{ t.tree }}</small></span>
        <span class="tc" :style="{ color: catColor(t.category) }">{{ CATEGORY_NAME[t.category] }}</span>
        <span class="tx mono">{{ t.spent }}</span>
        <span class="tp"><i v-for="n in 5" :key="n" :class="{ on: n <= t.tier && !t.dim }" /></span>
      </button>
    </nav>

    <section v-if="tree && grid" class="main">
      <header class="panel cut pad hd">
        <div class="ht">
          <b class="tname">{{ tree.name }}・{{ tree.tree }}</b>
          <span class="tag" :style="{ color: catColor(tree.category) }">{{ CATEGORY_NAME[tree.category] }}</span>
          <span v-if="path" class="doms k">現實 {{ DOMAIN_NAME[path.domains.meat] }}・內海 {{ DOMAIN_NAME[path.domains.net] }}・輿論 {{ DOMAIN_NAME[path.domains.opinion] }}</span>
        </div>
        <div class="bar" role="progressbar" :aria-valuenow="tree.spent" :aria-valuemax="xpMax">
          <i class="fill" :style="{ width: progress.pct }" />
          <i v-for="m in progress.marks" :key="m.x" class="mark" :style="{ left: m.left }"><small>{{ m.x }}</small></i>
        </div>
        <p class="k acc" data-acc>累計花了 {{ tree.spent }} 點，開到第 {{ tree.tier }} 階<template v-if="tree.toNext !== null">，再 {{ tree.toNext }} 點開第 {{ tree.tier + 1 }} 階</template><template v-else>，已經開滿</template>。</p>
      </header>

      <div class="panel cut pad treebox">
        <div class="sigrow"><button v-if="grid.signature" type="button" class="card sig" :class="cardFor(grid.signature).state" :data-skill="grid.signature.id" :data-state="cardFor(grid.signature).state" :aria-pressed="sel?.id === grid.signature.id" @click="selId = grid.signature.id"><span class="ks">{{ cardFor(grid.signature).kindShort }}</span><b>{{ grid.signature.name }}</b><small>招牌・{{ cardFor(grid.signature).kind }}・容量 {{ grid.signature.cap }}</small></button></div>
        <div v-for="t in grid.tiers" :key="t.tier" class="tier" :class="{ closed: t.tier > open }" :data-tier="t.tier" :data-open="t.tier > open ? 'false' : 'true'">
          <div class="tl"><b>{{ t.tier }} 階</b><small class="mono">{{ eng.skills.treeXp[t.tier - 1] }}</small></div>
          <div class="rows">
            <div v-for="r in t.rows" :key="r.layer" class="row" :class="r.layer" :style="{ gridTemplateColumns: `repeat(${grid.columns}, minmax(0, 1fr))` }">
              <div v-for="(cell, ci) in r.cells" :key="ci" class="cell">
                <button v-for="ab in cell" :key="ab.id" type="button" class="card" :class="cardFor(ab).state" :data-skill="ab.id" :data-state="cardFor(ab).state" :aria-pressed="sel?.id === ab.id" @click="selId = ab.id">
                  <span class="ks">{{ cardFor(ab).kindShort }}</span><b>{{ ab.name }}</b><small>{{ cardFor(ab).kind }}・容量 {{ ab.cap }}</small>
                  <em v-if="cardFor(ab).state === 'can'" class="cost mono">{{ ab.xp }}</em>
                  <em v-if="cardFor(ab).state === 'learned'" class="cost">✓</em>
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>

      <div class="panel cut pad reso">
        <p class="h">共鳴<Hint title="共鳴">每開一階多一個，不佔橋的容量。開了的亮起。</Hint></p>
        <ol class="rl">
          <li v-for="r in resonance" :key="r.tier" :class="{ on: r.on }" :data-reso="r.tier" :data-on="r.on ? 'true' : 'false'"><i /><span><b>{{ r.tier }} 階</b>{{ r.text }}</span></li>
        </ol>
      </div>
    </section>

    <aside v-if="sel && selCard" class="panel cut pad det" data-detail>
      <p class="k">{{ tree?.name }}・{{ sel.tier }} 階・{{ LAYER_NAME[sel.layer] }}</p>
      <h3>{{ sel.name }}</h3>
      <p class="chips"><span class="tag">{{ KIND_NAME[sel.kind] }}</span><span class="tag" :style="{ color: catColor(sel.category) }">{{ CATEGORY_NAME[sel.category] }}　容量 {{ sel.cap }}</span><span class="tag" :data-state-tag="selCard.state">{{ stateName[selCard.state] }}</span></p>
      <p class="txt"><template v-for="(s, i) in richText(sel.text)" :key="i"><b v-if="s.bold">{{ s.text }}</b><template v-else>{{ s.text }}</template></template></p>
      <div class="kv"><span>消耗</span><b data-use>{{ useLine(sel) }}</b></div>
      <div class="kv"><span>前置</span><b data-after>{{ after ? `${after.name}${mine.learned.includes(after.id) ? ' ✓' : ''}` : '沒有' }}</b></div>
      <div class="kv"><span>花費</span><b class="mono" style="color: var(--ap)">{{ sel.xp }} 歷練點</b></div>
      <ul class="lanes">
        <li v-for="l in lanes" :key="l.key" :class="{ dim: l.dim }" :data-lane="l.key" :data-dim="l.dim ? 'true' : 'false'"><b>{{ l.label }}</b><span class="lv">{{ l.level }}</span><span class="lt">{{ l.line }}</span></li>
      </ul>
      <ReasonButton v-if="selCard.state !== 'learned'" pri :reason="selCard.why" data-act="learn" @go="learn">學</ReasonButton>
      <p v-if="selCard.state === 'learned'" class="k" data-why>已經學會了。</p>
      <p v-else-if="selCard.why" class="k why" data-why>{{ selCard.why }}</p>
      <p v-if="lock" class="k why" data-lock>{{ lock }}</p>
    </aside>
  </div>
</template>

<style scoped>
.stv { display: grid; grid-template-columns: 200px minmax(0, 1fr) 300px; gap: var(--space-4); align-items: start; }
.trees { display: grid; gap: var(--space-3); }
.tr { display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: var(--space-2) var(--space-3); text-align: left; background: var(--bg-1); box-shadow: inset 0 0 0 2px var(--line); border: 0; padding: var(--space-3) var(--space-4); color: var(--ink); cursor: pointer; }
.tr.on { box-shadow: inset 0 0 0 2px var(--a); }
.tr.dim { opacity: .55; }
.tn { display: grid; min-width: 0; }
.tn small { color: var(--ink-3); font-size: var(--fs-fine); }
.tc { font-size: var(--fs-fine); font-weight: 800; text-align: right; }
.tx { font-size: var(--fs-fine); color: var(--ap); }
.tp { display: flex; gap: var(--space-1); justify-content: flex-end; }
.tp i { width: 10px; height: 8px; border-radius: 2px; background: var(--bg-3); }
.tp i.on { background: var(--a); }
.main { display: grid; gap: var(--space-4); min-width: 0; }
.hd { display: grid; gap: var(--space-3); }
.ht { display: flex; gap: var(--space-3); align-items: center; flex-wrap: wrap; }
.tname { font-size: var(--fs-section); }
.bar { position: relative; height: 10px; background: var(--bg-term); border-radius: 5px; margin-bottom: var(--space-5); }
.bar .fill { position: absolute; inset: 0 auto 0 0; background: var(--a); border-radius: 5px; }
.bar .mark { position: absolute; top: -2px; bottom: -2px; width: 2px; background: var(--ink-3); }
.bar .mark small { position: absolute; top: 100%; left: -10px; font-size: var(--fs-micro); color: var(--ink-3); font-style: normal; }
.acc { margin: 0; }
.treebox { display: grid; gap: var(--space-3); overflow-x: auto; }
.sigrow { display: grid; justify-content: center; }
.tier { display: grid; grid-template-columns: 56px minmax(0, 1fr); gap: var(--space-3); }
.tier.closed { background: repeating-linear-gradient(135deg, transparent 0 8px, var(--bg-3) 8px 10px); opacity: .55; }
.tl { display: grid; align-content: start; }
.tl small { color: var(--ink-3); }
.rows { display: grid; gap: var(--space-2); }
.row { display: grid; gap: var(--space-2); }
.row.back { padding-left: var(--space-4); }
.row.back .card { background: var(--bg-term); }
.cell { display: grid; gap: var(--space-2); align-content: start; }
.card { position: relative; display: grid; gap: var(--space-1); text-align: left; padding: var(--space-3); background: var(--bg-2); border: 0; box-shadow: inset 0 0 0 2px transparent; color: var(--ink); cursor: pointer; min-width: 0; }
.card b { font-size: var(--fs-sm); overflow-wrap: anywhere; }
.card small { color: var(--ink-3); font-size: var(--fs-fine); }
.card .ks { position: absolute; top: var(--space-2); right: var(--space-3); font-size: var(--fs-fine); color: var(--ink-3); }
.card .cost { position: absolute; bottom: var(--space-2); right: var(--space-3); font-style: normal; font-size: var(--fs-fine); color: var(--ap); font-weight: 800; }
.card.learned { background: color-mix(in srgb, var(--a) 28%, var(--bg-2)); }
.card.learned .cost { color: var(--a-hi); }
.card.can { box-shadow: inset 0 0 0 2px var(--a); }
.card.blocked { opacity: .65; }
.card.locked { opacity: .4; }
.card.sig { box-shadow: inset 0 0 0 2px var(--ap); min-width: 180px; }
.card[aria-pressed="true"] { outline: 2px solid var(--ink); outline-offset: 1px; }
.rl { list-style: none; margin: 0; padding: 0; display: grid; gap: var(--space-2); }
.rl li { display: grid; grid-template-columns: 14px minmax(0, 1fr); gap: var(--space-3); align-items: start; font-size: var(--fs-sm); color: var(--ink-3); }
.rl li i { height: 10px; margin-top: 5px; background: var(--bg-3); border-radius: 2px; }
.rl li.on { color: var(--ink); }
.rl li.on i { background: var(--a); }
.rl b { margin-right: var(--space-3); }
.det { display: grid; gap: var(--space-3); align-content: start; position: sticky; top: var(--space-3); }
.det h3 { margin: 0; font-size: var(--fs-section); }
.det .txt { margin: 0; font-size: var(--fs-sm); line-height: 1.6; }
.lanes { list-style: none; margin: 0; padding: 0; display: grid; gap: var(--space-2); }
.lanes li { display: grid; grid-template-columns: 38px 56px minmax(0, 1fr); gap: var(--space-2); font-size: var(--fs-sm); }
.lanes li.dim { opacity: .4; }
.lanes .lv { color: var(--ink-3); }
.why { color: var(--warn); margin: 0; }
@media (max-width: 900px) {
  .stv { grid-template-columns: minmax(0, 1fr); }
  .trees { display: flex; overflow-x: auto; gap: var(--space-3); padding-bottom: var(--space-2); }
  .tr { flex: none; min-width: 140px; }
  .det { position: static; }
  .card small { display: none; }
  .tier { grid-template-columns: 40px minmax(0, 1fr); }
  .row.back { padding-left: 0; }
  .card.sig { min-width: 0; }
}
</style>
