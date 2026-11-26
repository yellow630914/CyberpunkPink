
<script setup lang="ts">
import { computed, ref } from 'vue'
import Dialog from '../components/Dialog.vue'
import Tabs from '../components/Tabs.vue'
import Hint from '../components/Hint.vue'
import Icon from '../components/Icon.vue'
import TrackBar from '../components/TrackBar.vue'
import HpBar from '../components/body/HpBar.vue'
import ReasonButton from '../components/ReasonButton.vue'
import { useGame } from '../stores/game'
import { useUi } from '../stores/ui'
import { useEngine } from '../stores/engine'
import { listTrees } from '../lib/skillView'
import BodyTab from './character/BodyTab.vue'
import NetTab from './character/NetTab.vue'
import BridgeTab from './character/BridgeTab.vue'
import AdultTab from './character/AdultTab.vue'
import GearTab from './character/GearTab.vue'
import { BASIC_SKILLS, ATTRS } from '../data/creation'
import { useGuides } from '../lib/useGuides'

/**
 * 角色與義體（UI.md 第 8 節）。左欄角色卡；右邊六個分頁：概要、身體、裝備、內海、橋、成人（後三頁在 character/）。
 * 身體：人形與十一個部位的槽（CYBERWARE 第 1 節；character/BodyTab.vue，讀引擎的 cyberView），沉溺、藥與傷勢也在那一頁。這個檔案只有接線。
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

// ---- 概要：基本功（CORE_RULES 7.2 節）：級數、花多少歷練點、能不能升、5～6 級要有人教的那一句都是引擎的（stores/engine.ts 的 skills.basic*） ----
const basicRows = computed(() => eng.creation.skills.map((sk) => {
  const meta = BASIC_SKILLS.find((b) => b.name === sk.name)
  return { id: sk.id, name: sk.name, attr: eng.creation.attributes.find((a) => a.id === sk.attr)?.name ?? '', icon: meta?.icon ?? 'ic-bs_streetwise', hint: meta?.hint ?? '' }
}))
function raiseBasic(id: string, name: string) {
  const why = eng.skills.basicUp(id)
  if (why) ui.toast(why, 'warn')
  else ui.toast(`${name}升到 ${eng.skills.basicLevel(id)} 級。`)
}

// ---- 角色卡的生命與沉溺：讀引擎（痛覺編輯器讓生命值只剩模糊的分段） ----
const me = computed(() => eng.partyRows().find((m) => m.me) ?? null)
/** 體悟：和成人分頁的夜課同一份（引擎的 nightList） */
const insight = computed(() => eng.night.list()?.insight ?? 0)
const sinkNow = computed(() => eng.body.sink())
</script>

<template>
  <Dialog :entry-id="entryId" :stacked="stacked" title="角色與義體" :sub="[g.character.origin, ...openTrees].join('・')" size="xl">
    <template #header><Tabs v-model="tab" :tabs="TABS" @update:model-value="v => v === 'gear' && guides.trigger('g_gear')" /></template>
    <div class="ch">
      <!-- 角色卡 -->
      <aside class="panel cut pad card">
        <div class="who"><div class="ava" aria-hidden="true" /><div><b>{{ g.character.name }}</b><div class="k" data-trees>{{ openTrees.join('・') || '還沒有開的樹' }}</div></div></div>
        <div class="kv"><span>歷練點</span><b style="color: var(--ap)" data-xp>{{ myXp }}</b></div>
        <div class="kv"><span>體悟</span><b style="color: var(--a)" data-card-insight>{{ insight }}</b></div>
        <div class="kv"><span>街頭信譽</span><b>{{ g.character.rep }}・{{ g.character.repTitle }}</b></div>
        <HpBar v-if="me" label="生命" :hp="me.hp[0]" :max="me.hp[1]" :blur="eng.body.painBlind()" class="mt" data-card-hp />
        <TrackBar v-else label="生命" :value="g.character.hp[0]" :max="g.character.hp[1]" color="var(--hp)" class="mt" />
        <TrackBar label="感載" :value="me?.load[0] ?? 0" :max="me?.load[1] ?? 1" color="var(--load)" striped class="mt" data-card-load />
        <div class="layers" data-card-layers><span class="k">承受層數</span><i v-for="n in (me?.afterglowCap ?? 0)" :key="n" :class="{ on: n <= (me?.afterglow ?? 0) }" /><span class="k" data-card-afterglow>餘韻 {{ me?.afterglow ?? 0 }}</span></div>
        <TrackBar label="沉溺" :value="sinkNow?.value ?? 0" :max="100" color="var(--sink)" :marks="[sinkNow?.floor ?? 0]" class="mt" data-card-sink />
        <div class="k sinkk" data-card-floor>下限 {{ sinkNow?.floor ?? 0 }}<Hint title="沉溺的下限">裝上的義體每一件都墊高下限（沉溺成本），拆掉拿回來。抑制劑讓下限暫時降低。下限左邊那一段是鎖住的。</Hint></div>
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
        <p class="h mt">基本功<Hint>十八項，每項 0～6 級。花多少歷練點、能不能直接升、5 級與 6 級要有人教（金色細框）都是引擎說的。基本功不佔橋的容量。</Hint></p>
        <div class="basics">
          <div v-for="a in ATTRS" :key="a" class="bgrp">
            <div class="k">{{ a }}</div>
            <div v-for="b in basicRows.filter(x => x.attr === a)" :key="b.id" class="brow" :data-basic="b.id">
              <Icon :id="b.icon" :size="18" fit />
              <span class="bn">{{ b.name }}<Hint v-if="b.hint" :text="b.hint" /></span>
              <span class="bpips"><i v-for="n in 6" :key="n" :class="{ on: n <= eng.skills.basicLevel(b.id), teach: n >= 5 }" /></span>
              <span class="bc mono" data-basic-cost>{{ eng.skills.basicLevel(b.id) >= 6 ? '—' : eng.skills.basicCost(b.id) }}</span>
              <ReasonButton sm :reason="eng.skills.basicBlock(b.id)" data-act="basic-up" @go="raiseBasic(b.id, b.name)">＋</ReasonButton>
            </div>
          </div>
        </div>
        <p class="h mt" data-sink-band>沉溺 {{ sinkNow?.value ?? 0 }}・{{ sinkNow?.band.name ?? '' }}<Hint title="這一段">這一段與前面每一段的得失在身體分頁的沉溺一欄，數字與名字都是引擎的。</Hint></p>
      </section>

      <!-- 身體：讀引擎（character/BodyTab.vue） -->
      <BodyTab v-else-if="tab === 'body'" />

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
.basics { display: grid; grid-template-columns: repeat(auto-fill, minmax(260px, 1fr)); gap: 8px 16px; }
.bgrp .k { margin: 4px 0 2px; }
.brow { display: grid; grid-template-columns: 20px minmax(0, 1fr) auto 44px auto; gap: 6px; align-items: center; padding: 3px 0; font-size: var(--fs-sm); }
.bn { display: inline-flex; gap: 4px; align-items: center; font-weight: 700; }
.bpips { display: flex; gap: 2px; }
.bpips i { width: 12px; height: 10px; border-radius: 2px; background: var(--bg-2); }
.bpips i.on { background: var(--a); }
.bpips i.teach { box-shadow: inset 0 0 0 1px var(--g4); }
.bc { font-size: var(--fs-fine); color: var(--ap); text-align: right; }
@media (max-width: 900px) { .ch { grid-template-columns: 1fr; } }
</style>
