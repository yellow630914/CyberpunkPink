<script setup lang="ts">
import { computed, ref } from 'vue'
import ItemSlot from '../../components/ItemSlot.vue'
import Hint from '../../components/Hint.vue'
import ReasonButton from '../../components/ReasonButton.vue'
import { useGame } from '../../stores/game'
import { useUi } from '../../stores/ui'
import { ITEMS } from '../../data/items'
import { SKILL_TREES, NIGHT_BRANCHES } from '../../data/content.generated'
import { BRIDGE_MODEL, TUNINGS } from '../../data/profile'
import { CATEGORIES, CAT_COLOR, loadoutUse, equipBlock, rearrangeBlock, tierOpen, treeSpent, type LoadoutSkill } from '../../lib/skills'
import type { CapCategory } from '../../data/skillTypes'
import { useGuides } from '../../lib/useGuides'

/**
 * 角色的「橋」分頁（UI 8.3 節，CORE_RULES 6.4 節、CYBERWARE 第 7 節、LEWD_SYSTEM 第 4 節）：只裝已經學會的技能。
 * 四條容量條一格一點；游標指著的技能裝上去之後的預覽是空心格，數字旁邊寫「→ 9」；超過的格子是紅框。
 * 共鳴與只在成人場景用的夜課容量寫 0，不能取消。換配置要在據點或調校診所；委託副本裡整頁唯讀。
 */
const g = useGame()
const ui = useUi()
useGuides().trigger('g_bridge')
const learnedSet = computed(() => new Set(g.learned))
interface Row extends LoadoutSkill { name: string; tree: string; treeName: string; tier: string; sig?: boolean; kind: string; desc: string; night?: boolean }
const rows = computed<Row[]>(() => {
  const out: Row[] = []
  for (const t of SKILL_TREES) {
    const spent = treeSpent(t, learnedSet.value)
    if (!spent) continue
    out.push({ id: `res:${t.id}`, name: `${t.name}的共鳴`, tree: t.id, treeName: t.name, tier: `${tierOpen(spent)} 階`, category: t.category, cap: 0, free: true, kind: '被動', desc: t.resonance.filter(r => r.tier <= tierOpen(spent)).map(r => r.effect).join(' ') })
    for (const s of t.skills) if (learnedSet.value.has(s.id)) out.push({ id: s.id, name: s.name, tree: t.id, treeName: t.name, tier: `${s.tier} 階`, sig: s.layer === 'sig', category: t.category, cap: s.cap, kind: s.kindName, desc: s.real !== '—' ? s.real : s.net !== '—' ? s.net : s.opinion })
  }
  for (const b of NIGHT_BRANCHES) for (const s of b.skills) if (g.nightLearned.includes(s.id)) {
    // 延伸到別的戰場的夜課要裝進橋，佔社交類；這兩個都只在成人場景用，不佔容量
    out.push({ id: s.id, name: s.name, tree: 'night', treeName: '夜課', tier: `${b.name} ${s.tier} 階`, category: '社交', cap: s.extends ? 3 : 0, free: !s.extends, kind: s.use, desc: s.effect, night: true })
  }
  return out
})
const draft = ref<string[]>([...g.loadout])
const equipped = computed(() => rows.value.filter(r => r.free || draft.value.includes(r.id)))
const used = computed(() => loadoutUse(equipped.value))
const hover = ref<Row | null>(null)
const preview = computed(() => {
  const h = hover.value
  if (!h || h.free || draft.value.includes(h.id)) return null
  return { cat: h.category, after: used.value[h.category] + h.cap }
})
const FILTERS = [{ id: 'all', n: '全部' }, ...SKILL_TREES.map(t => ({ id: t.id, n: t.name })), { id: 'night', n: '夜課' }, { id: 'on', n: '只看裝著的' }]
const filter = ref('all')
const shown = computed(() => rows.value.filter(r => filter.value === 'all' || (filter.value === 'on' ? r.free || draft.value.includes(r.id) : r.tree === filter.value)))
const roBlock = computed(() => rearrangeBlock({ atHome: g.loc.facility === 'myhome', atClinic: false, inRun: g.inRun }))
function toggle(r: Row) {
  if (r.free) { ui.toast(r.night ? '只在成人場景用的夜課不佔容量，不能取消。' : '共鳴開了一階就有，不佔容量，不能取消。', 'warn'); return }
  if (g.inRun) { ui.toast('委託副本裡不能換配置。', 'warn'); return }
  if (draft.value.includes(r.id)) { draft.value = draft.value.filter(x => x !== r.id); return }
  const b = equipBlock(BRIDGE_MODEL.cap, equipped.value, r)
  if (b) { ui.toast(b, 'warn'); return }
  draft.value = [...draft.value, r.id]
}
const changed = computed(() => draft.value.slice().sort().join() !== g.loadout.slice().sort().join())
function apply() {
  g.loadout = [...draft.value]
  g.advance(30)
  g.addLog({ prose: [`你在家裡把橋的配置換過一次，花了半小時（${BRIDGE_MODEL.name}）。`] })
  ui.toast('套用了新的配置。')
}
const blockFor = (r: Row) => (r.free || draft.value.includes(r.id) ? null : equipBlock(BRIDGE_MODEL.cap, equipped.value, r))
const cells = (c: CapCategory) => Array.from({ length: Math.max(BRIDGE_MODEL.cap[c], used.value[c], preview.value?.cat === c ? preview.value.after : 0) }, (_, i) => {
  const cap = BRIDGE_MODEL.cap[c]
  const on = i < used.value[c]
  const pv = preview.value?.cat === c && i >= used.value[c] && i < preview.value.after
  return { on, pv, over: i >= cap && (on || pv) }
})
const tuneSlots = computed(() => g.cyber.bridge.slice(1, 3))
</script>

<template>
  <section class="br">
    <header class="panel cut pad bh">
      <ItemSlot :item="ITEMS[BRIDGE_MODEL.item]" size="md" />
      <div class="grow"><b>{{ BRIDGE_MODEL.name }}</b><div class="k">晶片 {{ BRIDGE_MODEL.chip }}・{{ BRIDGE_MODEL.feature }}</div></div>
      <div class="tunes">
        <ItemSlot v-for="(id, i) in tuneSlots" :key="i" :item="id ? ITEMS[id] : null" slot-icon="ic-cw_bridge" label="調校槽" size="sm" @select="ui.toast('調校要在調校診所或有賣的人那裡裝。', 'warn')" />
        <Hint title="調校">裝在橋的調校槽裡的韌體設定檔，每人 2 槽，每個都是雙面的。<p v-for="t in TUNINGS" :key="t.name"><b>{{ t.name }}</b>：{{ t.pro }}；代價：{{ t.con }}。</p></Hint>
      </div>
    </header>
    <div class="panel cut pad caps">
      <div v-for="c in CATEGORIES" :key="c" class="cap">
        <span class="cn" :style="{ color: CAT_COLOR[c] }">{{ c }}</span>
        <span class="cells"><i v-for="(x, i) in cells(c)" :key="i" :class="{ on: x.on, pv: x.pv, over: x.over }" :style="{ '--cc': CAT_COLOR[c] }" /></span>
        <span class="mono num">{{ used[c] }}/{{ BRIDGE_MODEL.cap[c] }}<template v-if="preview?.cat === c"> → {{ preview.after }}</template></span>
      </div>
    </div>
    <div class="filters fl"><button v-for="f in FILTERS" :key="f.id" type="button" :class="{ on: filter === f.id, nightf: f.id === 'night' }" @click="filter = f.id">{{ f.n }}</button></div>
    <div class="panel cut list">
      <div v-for="r in shown" :key="r.id" class="srow2" :class="{ free: r.free, on: r.free || draft.includes(r.id) }" @mouseenter="hover = r" @mouseleave="hover = null">
        <button type="button" class="chk" role="checkbox" :aria-checked="r.free || draft.includes(r.id)" :aria-label="r.name" @click="toggle(r)" @focus="hover = r" @blur="hover = null">{{ r.free || draft.includes(r.id) ? '☑' : '☐' }}</button>
        <span class="nm"><b>{{ r.name }}</b><small>{{ r.treeName }}・{{ r.tier }}<template v-if="r.sig">・招牌</template></small></span>
        <span class="kd">{{ r.kind }}</span>
        <span class="mono cp" :style="{ color: CAT_COLOR[r.category] }">{{ r.free ? 0 : r.cap }}</span>
        <span class="why">{{ blockFor(r) ?? (r.free ? (r.night ? '只在成人場景用，不佔容量' : '開了一階就多一個，不佔容量') : '') }}</span>
        <Hint :text="r.desc" />
      </div>
      <div v-if="!shown.length" class="empty-note pad">這裡沒有學會的技能。學技能在技能樹。</div>
    </div>
    <footer class="panel cut pad ft">
      <span class="grow k">{{ roBlock ? `換配置：${roBlock}` : `換配置：在據點，${BRIDGE_MODEL.feature}。` }}</span>
      <button type="button" class="btn sm" @click="ui.open('skills')">打開技能樹</button>
      <ReasonButton sm :reason="changed ? null : '沒有改動。'" @go="draft = [...g.loadout]">還原</ReasonButton>
      <ReasonButton pri :reason="roBlock ?? (changed ? null : '沒有改動。')" @go="apply">套用</ReasonButton>
    </footer>
  </section>
</template>

<style scoped>
.br { display: grid; gap: 10px; }
.bh { display: flex; gap: 12px; align-items: center; flex-wrap: wrap; }
.bh > :first-child { width: 56px; }
.grow { flex: 1; min-width: 0; }
.tunes { display: flex; gap: 8px; align-items: center; }
.tunes :deep(.slot) { width: 52px; }
.caps { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 8px 18px; }
.cap { display: grid; grid-template-columns: 34px minmax(0, 1fr) auto; gap: 8px; align-items: center; }
.cn { font-weight: 900; font-size: 12px; }
.cells { display: grid; grid-auto-flow: column; grid-auto-columns: minmax(0, 1fr); gap: 2px; }
.cells i { height: 12px; background: var(--bg-term); border-radius: 2px; }
.cells i.on { background: var(--cc); }
.cells i.pv { background: transparent; box-shadow: inset 0 0 0 2px var(--cc); }
.cells i.over { box-shadow: inset 0 0 0 2px var(--danger); }
.num { font-size: 12px; font-weight: 800; white-space: nowrap; }
.fl { margin: 0; }
.filters .nightf { box-shadow: inset 0 0 0 1px var(--a); }
.list { padding: 4px; display: grid; gap: 3px; }
.srow2 { display: grid; grid-template-columns: 28px minmax(0, 1.2fr) 64px 28px minmax(0, 1fr) auto; gap: 8px; align-items: center; padding: 6px 8px; background: var(--bg-2); font-size: 12.5px; }
.srow2.free { background: var(--bg-term); }
.srow2.on .nm b { color: var(--a-hi); }
.chk { background: none; border: 0; color: var(--ink); font-size: 16px; cursor: pointer; padding: 0; }
.nm { display: grid; min-width: 0; }
.nm small { color: var(--ink-3); font-size: 11px; }
.kd { font-size: 11px; color: var(--ink-3); }
.cp { font-weight: 900; text-align: center; }
.why { font-size: 11px; color: var(--ink-3); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.ft { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; }
@media (max-width: 720px) {
  .caps { grid-template-columns: 1fr; }
  .srow2 { grid-template-columns: 28px minmax(0, 1fr) 28px auto; }
  .srow2 .kd, .srow2 .why { display: none; }
}
</style>
