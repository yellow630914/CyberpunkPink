
<script setup lang="ts">
import { computed, ref } from 'vue'
import Dialog from '../components/Dialog.vue'
import Tabs from '../components/Tabs.vue'
import ItemSlot from '../components/ItemSlot.vue'
import GradeBadge from '../components/GradeBadge.vue'
import Hint from '../components/Hint.vue'
import Icon from '../components/Icon.vue'
import TrackBar from '../components/TrackBar.vue'
import BodyFigure from '../components/BodyFigure.vue'
import ReasonButton from '../components/ReasonButton.vue'
import { useGame } from '../stores/game'
import { useUi } from '../stores/ui'
import { useEngine } from '../stores/engine'
import { listTrees } from '../lib/skillView'
import { ITEMS } from '../data/items'
import { BODY_PARTS } from '../data/character'
import type { BodyPartId } from '../data/types'
import NetTab from './character/NetTab.vue'
import BridgeTab from './character/BridgeTab.vue'
import AdultTab from './character/AdultTab.vue'
import GearTab from './character/GearTab.vue'
import { BASIC_SKILLS, ATTRS } from '../data/creation'
import { useGuides } from '../lib/useGuides'

/**
 * 角色與義體（UI.md 第 8 節）。左欄角色卡；右邊六個分頁：概要、身體、裝備、內海、橋、成人（後三頁在 character/）。
 * 身體：人形與十一個部位的槽（CYBERWARE 第 1 節），每一槽是一個物品格。
 * 裝備：穿著 10、飾品 5、攜帶 3＋快取格（EQUIPMENT 第 2～4 節），整個分頁讀引擎（character/GearTab.vue）。
 */
const props = defineProps<{ entryId: number; stacked?: boolean; tab?: string; gearSelect?: { group: 'worn' | 'acc' | 'carry'; slot: string } }>()
const g = useGame()
const ui = useUi()
const eng = useEngine()
const tab = ref(props.tab ?? 'body')
// 角色卡的抬頭與歷練點讀引擎（8.1 節）：已經開的樹與階（一點都沒花的不列）
const myXp = computed(() => eng.skills.mine().xp)
const openTrees = computed(() => {
  const mine = eng.skills.mine()
  return listTrees(eng.skills.paths(), eng.skills.abilities(), mine, eng.skills.tierOf, eng.skills.treeXp).filter((t) => !t.dim).map((t) => `${t.name} ${t.tier}`)
})
const TABS = [
  { id: 'sum', label: '概要' }, { id: 'body', label: '身體' }, { id: 'gear', label: '裝備' },
  { id: 'net', label: '內海' }, { id: 'bridge', label: '橋' }, { id: 'adult', label: '成人' },
]
const guides = useGuides()
if (tab.value === 'gear') guides.trigger('g_gear')

// ---- 概要：基本功（CORE_RULES 7.2 節）：升到 N 級花 N × 10；5、6 級要有人教 ----
function basicBlock(name: string) {
  const lv = g.basics[name] ?? 0
  if (lv >= 6) return '已經 6 級了。'
  if (lv >= 4) return `${name}的 ${lv + 1} 級要有人教：先找到一位 5 級以上的老師。`
  const cost = (lv + 1) * 10
  if (g.character.xp < cost) return `要 ${cost} 歷練點，你有 ${g.character.xp} 點。`
  return null
}
function raiseBasic(name: string) {
  const lv = g.basics[name] ?? 0
  g.character.xp -= (lv + 1) * 10
  g.basics[name] = lv + 1
  ui.toast(`${name}升到 ${lv + 1} 級。`)
}

// ---- 身體 ----
const part = ref<BodyPartId>('brain')
const slotIdx = ref(0)
const selCyber = computed(() => { const id = g.cyber[part.value][slotIdx.value]; return id ? ITEMS[id] : null })
const filled = computed(() => Object.fromEntries(BODY_PARTS.map(p => [p.id, g.cyber[p.id].some(Boolean)])))
const warn = computed(() => Object.fromEntries(BODY_PARTS.map(p => [p.id, g.cyber[p.id].some(id => id && ITEMS[id].cyber?.warning)])))
const partSink = (id: BodyPartId) => g.cyber[id].reduce((s, x) => s + (x ? ITEMS[x].cyber?.sink ?? 0 : 0), 0)
function pick(id: BodyPartId, i = 0) { part.value = id; slotIdx.value = i }
const sinkParts = computed(() => BODY_PARTS.flatMap(p => g.cyber[p.id].filter(Boolean).map(id => ({ name: ITEMS[id!].name, sink: ITEMS[id!].cyber!.sink })))
  .sort((a, b) => b.sink - a.sink))

</script>

<template>
  <Dialog :entry-id="entryId" :stacked="stacked" title="角色與義體" :sub="[g.character.origin, ...openTrees].join('・')" size="xl">
    <template #header><Tabs v-model="tab" :tabs="TABS" @update:model-value="v => v === 'gear' && guides.trigger('g_gear')" /></template>
    <div class="ch">
      <!-- 角色卡 -->
      <aside class="panel cut pad card">
        <div class="who"><div class="ava" aria-hidden="true" /><div><b>{{ g.character.name }}</b><div class="k" data-trees>{{ openTrees.join('・') || '還沒有開的樹' }}</div></div></div>
        <div class="kv"><span>歷練點</span><b style="color: var(--ap)" data-xp>{{ myXp }}</b></div>
        <div class="kv"><span>體悟</span><b style="color: var(--a)">{{ g.character.insight }}</b></div>
        <div class="kv"><span>街頭信譽</span><b>{{ g.character.rep }}・{{ g.character.repTitle }}</b></div>
        <TrackBar label="生命" :value="g.character.hp[0]" :max="g.character.hp[1]" color="var(--hp)" class="mt" />
        <TrackBar label="感載" :value="g.character.load[0]" :max="g.character.load[1]" color="var(--load)" striped class="mt" />
        <div class="layers"><span class="k">承受層數</span><i v-for="n in g.character.layers[1]" :key="n" :class="{ on: n <= g.character.layers[0] }" /><span class="k">餘韻 {{ g.character.afterglow }}</span></div>
        <TrackBar label="沉溺" :value="g.character.sink" :max="100" color="var(--sink)" :marks="[g.sinkFloor]" class="mt" />
        <div class="k sinkk">下限 {{ g.sinkFloor }}<Hint title="沉溺的下限">裝上的義體每一件都墊高下限（沉溺成本），拆掉拿回來。抑制劑讓下限暫時 −10。下限左邊那一段是鎖住的。</Hint></div>
        <p class="h mt">特質</p>
        <div class="chips"><span v-for="t in g.character.traits.good" :key="t" class="tag" style="color: var(--ram)">{{ t }}</span><span v-for="t in g.character.traits.bad" :key="t" class="tag warn">{{ t }}</span></div>
      </aside>

      <!-- 概要 -->
      <section v-if="tab === 'sum'" class="panel cut pad">
        <p class="h">六屬性<Hint>大字是有效值，小字是基礎值；有加成的是薄荷色，來源寫在下面。</Hint></p>
        <div class="attrs">
          <div v-for="a in g.character.attrs" :key="a.name" class="at cut-sm">
            <div class="k">{{ a.name }}</div>
            <div class="v" :class="{ up: a.eff > a.base }">{{ a.eff }}<small v-if="a.eff !== a.base"> ←{{ a.base }}</small></div>
            <div class="src">{{ a.src ?? '—' }}</div>
          </div>
        </div>
        <p class="h mt">基本功<Hint>十八項，每項 0～6 級。升到 N 級花 N × 10 歷練點；0 到 4 級可以直接升，5 級與 6 級要有人教（金色細框）。基本功不佔橋的容量。</Hint></p>
        <div class="basics">
          <div v-for="a in ATTRS" :key="a" class="bgrp">
            <div class="k">{{ a }}</div>
            <div v-for="b in BASIC_SKILLS.filter(x => x.attr === a)" :key="b.name" class="brow">
              <Icon :id="b.icon" :size="18" fit />
              <span class="bn">{{ b.name }}<Hint :text="b.hint" /></span>
              <span class="bpips"><i v-for="n in 6" :key="n" :class="{ on: n <= (g.basics[b.name] ?? 0), teach: n >= 5 }" /></span>
              <span class="bc mono">{{ (g.basics[b.name] ?? 0) >= 4 ? '要老師' : `${((g.basics[b.name] ?? 0) + 1) * 10}` }}</span>
              <ReasonButton sm :reason="basicBlock(b.name)" @go="raiseBasic(b.name)">＋</ReasonButton>
            </div>
          </div>
        </div>
        <p class="h mt">沉溺 {{ g.character.sink }}・貪歡<Hint title="貪歡（40～59）">得到：承受層數 +1；自己造成的感載 +10%；聽得懂遺魂在說什麼。失去：定力 −1；每週可能發生衝動事件。再 2 點進入迷醉。</Hint></p>
      </section>

      <!-- 身體 -->
      <section v-else-if="tab === 'body'" class="body-tab">
        <div class="bodygrid">
          <div v-for="side in ['left', 'right'] as const" :key="side" class="parts" :class="side">
            <div v-for="p in BODY_PARTS.filter(x => x.side === side)" :key="p.id" class="part cut-sm" :class="{ on: part === p.id }">
              <button type="button" class="ph" @click="pick(p.id)">
                <Icon :id="p.icon" :size="26" fit />
                <b>{{ p.name }}</b>
                <span class="k">{{ p.slots }} 槽<template v-if="p.extraSlots">＋{{ p.extraName }} {{ p.extraSlots }}</template></span>
                <span class="psink" :title="`這個部位的沉溺成本合計`">{{ partSink(p.id) }}</span>
              </button>
              <div class="slots">
                <ItemSlot v-for="(id, i) in g.cyber[p.id]" :key="i" size="sm" :item="id ? ITEMS[id] : null" :slot-icon="p.icon"
                  :selected="part === p.id && slotIdx === i" :locked="!!(id && ITEMS[id].cyber?.license)" :label="p.extraSlots && i >= p.slots ? '調校' : undefined" @select="pick(p.id, i)" />
              </div>
            </div>
          </div>
          <div class="figure"><BodyFigure :selected="part" :filled="filled" :warn="warn" @pick="pick" /></div>
        </div>
        <div class="panel cut pad cdet">
          <template v-if="selCyber">
            <div class="dh"><ItemSlot :item="selCyber" size="md" /><div><div class="k">{{ BODY_PARTS.find(p => p.id === part)!.name }}・{{ selCyber.type }}・{{ selCyber.brand }}</div><h3 :style="{ color: `var(--g${selCyber.grade})` }">{{ selCyber.name }}</h3><div class="chips"><GradeBadge :grade="selCyber.grade" /><span class="tag">{{ selCyber.cyber!.material }}</span><span class="tag">{{ selCyber.cyber!.invasive }}</span><Hint v-if="selCyber.note" :text="selCyber.note" /></div></div></div>
            <div class="kv"><span>效果</span><b>{{ selCyber.cyber!.effect }}</b></div>
            <div class="kv"><span>沉溺成本<Hint>侵入度越深成本越高：表層 0～1、一般 2～4、侵入 5～8、重度 9～14、極限 15～25。裝上就墊高沉溺的下限。</Hint></span><b>{{ selCyber.cyber!.sink }}</b></div>
            <div v-if="selCyber.cyber!.license" class="kv"><span>授權<Hint>訂閱沒付就鎖住，沉溺成本照算。</Hint></span><b style="color: var(--g4)">{{ selCyber.cyber!.license }}</b></div>
            <div v-if="selCyber.cyber!.warning" class="blocking">{{ selCyber.cyber!.warning }}</div>
            <div class="go"><ReasonButton sm reason="拆裝義體要在診所。">拆下</ReasonButton><ReasonButton sm reason="送修要在診所或義體店。">送修</ReasonButton></div>
          </template>
          <template v-else>
            <div class="k">{{ BODY_PARTS.find(p => p.id === part)!.name }}・空槽<Hint :text="BODY_PARTS.find(p => p.id === part)!.hint" /></div>
            <div class="go"><ReasonButton sm reason="裝義體要在診所（縫縫診所在四號塔的地下室）。">裝一件</ReasonButton></div>
          </template>
          <p class="h mt">沉溺的下限 {{ g.sinkFloor }}</p>
          <div class="chips"><span v-for="s in sinkParts" :key="s.name" class="tag">{{ s.name }} {{ s.sink }}</span></div>
        </div>
      </section>

      <!-- 裝備：讀引擎（character/GearTab.vue） -->
      <GearTab v-else-if="tab === 'gear'" :select="gearSelect" />
      <NetTab v-else-if="tab === 'net'" />
      <BridgeTab v-else-if="tab === 'bridge'" />
      <AdultTab v-else-if="tab === 'adult'" />
    </div>
  </Dialog>
</template>

<style scoped>
.ch { display: grid; grid-template-columns: 250px minmax(0, 1fr); gap: 12px; align-items: start; }
.card .who { display: flex; gap: 10px; align-items: center; margin-bottom: 8px; }
.card .ava { width: 48px; height: 48px; border-radius: 12px; background: var(--bg-2); position: relative; overflow: hidden; flex: none; }
.card .ava::before { content: ""; position: absolute; left: 13px; top: 8px; width: 22px; height: 22px; border-radius: 50%; background: var(--a); }
.card .ava::after { content: ""; position: absolute; left: 6px; top: 32px; width: 36px; height: 24px; border-radius: 14px 14px 0 0; background: var(--a); }
.mt { margin-top: 10px; }
.layers { display: flex; gap: 4px; align-items: center; margin-top: 6px; }
.layers i { width: 16px; height: 8px; border-radius: 3px; background: var(--bg-2); }
.layers i.on { background: var(--load); }
.sinkk { display: flex; align-items: center; gap: 4px; margin-top: 4px; }
.attrs { display: grid; grid-template-columns: repeat(auto-fill, minmax(120px, 1fr)); gap: 8px; }
.at { background: var(--bg-2); padding: 10px; }
.at .v { font: 900 var(--fs-num) var(--mono); }
.at .v.up { color: var(--ram); }
.at .v small { font-size: var(--fs-sm); color: var(--ink-3); }
.at .src { font-size: var(--fs-fine); color: var(--ink-3); }
.bodygrid { display: grid; grid-template-columns: minmax(0, 1fr) minmax(160px, 240px) minmax(0, 1fr); gap: 10px; align-items: start; }
.figure { grid-column: 2; grid-row: 1; background: var(--bg-term); padding: 8px; border-radius: 8px; align-self: stretch; display: grid; place-items: center; }
.parts { display: grid; gap: 8px; }
.parts.left { grid-column: 1; grid-row: 1; }
.parts.right { grid-column: 3; grid-row: 1; }
.part { background: var(--bg-1); box-shadow: inset 0 0 0 2px var(--line); padding: 8px 10px; }
.part.on { box-shadow: inset 0 0 0 2px var(--a); }
.ph { display: flex; align-items: center; gap: 8px; width: 100%; background: none; border: 0; padding: 0; cursor: pointer; color: inherit; text-align: left; }
.ph b { font-size: var(--fs-md); }
.ph .k { flex: 1; }
.psink { font: 800 var(--fs-fine) var(--mono); color: var(--sink); }
.slots { display: grid; grid-template-columns: repeat(auto-fill, minmax(40px, 48px)); gap: 6px; margin-top: 6px; }
.cdet { margin-top: 12px; }
.dh { display: grid; grid-template-columns: 64px 1fr; gap: 12px; align-items: center; margin-bottom: 8px; }
.dh h3 { margin: 2px 0 4px; font-size: var(--fs-section); }
.basics { display: grid; grid-template-columns: repeat(auto-fill, minmax(260px, 1fr)); gap: 8px 16px; }
.bgrp .k { margin: 4px 0 2px; }
.brow { display: grid; grid-template-columns: 20px minmax(0, 1fr) auto 44px auto; gap: 6px; align-items: center; padding: 3px 0; font-size: var(--fs-sm); }
.bn { display: inline-flex; gap: 4px; align-items: center; font-weight: 700; }
.bpips { display: flex; gap: 2px; }
.bpips i { width: 12px; height: 10px; border-radius: 2px; background: var(--bg-2); }
.bpips i.on { background: var(--a); }
.bpips i.teach { box-shadow: inset 0 0 0 1px var(--g4); }
.bc { font-size: var(--fs-fine); color: var(--ap); text-align: right; }
@media (max-width: 900px) {
  .ch { grid-template-columns: 1fr; }
  .bodygrid { grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); }
  .figure { grid-column: 1 / -1; grid-row: 1; max-height: 340px; }
  .figure :deep(.fig) { max-height: 320px; }
  .parts.left { grid-column: 1; grid-row: 2; }
  .parts.right { grid-column: 2; grid-row: 2; }
}
@media (max-width: 480px) { .slots { grid-template-columns: repeat(3, minmax(0, 44px)); } }
</style>
