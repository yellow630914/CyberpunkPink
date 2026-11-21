<script setup lang="ts">
import { computed, ref } from 'vue'
import Dialog from '../components/Dialog.vue'
import Hint from '../components/Hint.vue'
import TrackBar from '../components/TrackBar.vue'
import { useGame } from '../stores/game'
import { useUi } from '../stores/ui'
import { RELATION_LINE } from '../data/npcs'
import type { Npc } from '../data/types'

/**
 * 關係（UI 3.9 節，規則 NPC_SYSTEM 第 7、8、10 節）。左邊名單：親密度條以 0 為中線，正的往右粉色、負的往左紅色；
 * 右邊詳情：親密度與階段、忠誠、想要、已知的事、關係線五段、共同記憶。
 */
const props = defineProps<{ entryId: number; stacked?: boolean; npcId?: string }>()
const g = useGame()
const ui = useUi()
const FILTERS = ['全部', '夥伴', '名冊', '中間人', '熟人', '只看關注的'] as const
const filter = ref<typeof FILTERS[number]>('全部')
const FALLBACK: Record<string, Npc['group']> = { xiaomai: '夥伴', alian: '中間人', hebo: '熟人', laotie: '熟人' }
const groupOf = (n: Npc) => n.group ?? FALLBACK[n.id] ?? '熟人'
const inRoster = (id: string) => g.roster.some(r => r.npc === id)
const all = computed(() => Object.values(g.npcs).sort((a, b) => b.affinity - a.affinity))
const list = computed(() => all.value.filter(n => filter.value === '全部' || (filter.value === '只看關注的' ? n.watch : groupOf(n) === filter.value)))
const selId = ref(props.npcId ?? 'xiaomai')
const sel = computed(() => g.npcs[selId.value] ?? all.value[0])
const favorText = (n: Npc) => (n.favor ? (n.favor > 0 ? `欠你 ${n.favor}` : `你欠 ${-n.favor}`) : '')
const lineIdx = computed(() => sel.value.lineStage)
const editing = ref(false)
const draft = ref('')
function edit() { draft.value = sel.value.relation; editing.value = true }
function saveRel() { sel.value.relation = draft.value.trim() || sel.value.relation; editing.value = false }
function meet(n: Npc) {
  if (n.id === 'xiaomai') ui.open('talk', { npcId: 'xiaomai' })
  else ui.toast(`約${n.name}要先知道她在哪裡：互動選單在和她說話的畫面。`, 'warn')
}
</script>

<template>
  <Dialog :entry-id="entryId" :stacked="stacked" title="關係" :sub="`${all.length} 人・關注 ${all.filter(n => n.watch).length}`" size="xl">
    <template #header><div class="filters fl"><button v-for="f in FILTERS" :key="f" type="button" :class="{ on: filter === f }" @click="filter = f">{{ f }}</button></div></template>
    <div class="rel">
      <aside class="panel cut list">
        <button v-for="n in list" :key="n.id" type="button" class="person" :class="{ on: sel.id === n.id }" @click="selId = n.id; editing = false">
          <span class="ava" aria-hidden="true">{{ n.name.slice(0, 1) }}</span>
          <span class="grow">
            <b>{{ n.name }}<i v-if="n.watch" class="star" aria-label="關注">★</i></b>
            <small class="ellipsis">{{ n.identity }}</small>
            <span class="aff" :aria-label="`親密度 ${n.affinity}`"><i :class="n.affinity >= 0 ? 'pos' : 'neg'" :style="{ width: Math.abs(n.affinity) / 2 + '%' }" /></span>
          </span>
          <span class="meta">
            <b class="stage">{{ n.stage }}</b>
            <small v-if="inRoster(n.id)" class="mono">忠 {{ n.loyalty }}</small>
            <small v-if="n.favor" :class="n.favor < 0 ? 'warn-t' : 'ok-t'">{{ favorText(n) }}</small>
          </span>
        </button>
        <div v-if="!list.length" class="empty-note pad">沒有符合的人。</div>
      </aside>

      <section class="panel cut pad det">
        <div class="dh">
          <div class="ava lg" aria-hidden="true">{{ sel.name.slice(0, 1) }}</div>
          <div class="grow">
            <h3>{{ sel.name }} <small>{{ sel.age }} 歲・{{ sel.district }}</small></h3>
            <div class="k">{{ sel.identity }}</div>
            <div class="chips"><span v-for="t in sel.tags" :key="t" class="tag">{{ t }}</span><span v-if="sel.faction" class="tag">{{ sel.faction }}</span></div>
          </div>
          <div class="affbig"><span class="big-num" :style="{ color: sel.affinity >= 0 ? 'var(--a)' : 'var(--danger)' }">{{ sel.affinity }}</span><small>{{ sel.stage }}</small></div>
        </div>
        <div class="relline">
          <template v-if="!editing"><span>{{ sel.relation }}</span><button type="button" class="btn sm ghost" @click="edit">改這一句</button><Hint>和你的關係一句：AI 提議，你可以改。</Hint></template>
          <template v-else><input v-model="draft" class="inp" aria-label="和你的關係" @keydown.enter="saveRel"><button type="button" class="btn sm pri" @click="saveRel">存</button></template>
        </div>
        <div class="cols2 mt">
          <div>
            <template v-if="inRoster(sel.id)">
              <TrackBar label="忠誠" :value="sel.loyalty" :max="100" color="var(--ram)" :marks="[20, 40, 70]" />
              <div class="kv"><span>上次一起出委託</span><b>{{ sel.lastJob ?? '還沒有' }}</b></div>
            </template>
            <div v-if="sel.want" class="kv"><span>想要</span><b>{{ sel.want }}</b></div>
            <div v-if="sel.favor" class="kv"><span>人情</span><b :class="sel.favor < 0 ? 'warn-t' : 'ok-t'">{{ favorText(sel) }}</b></div>
            <p class="h mt">已知的事</p>
            <div v-if="!sel.known.length" class="empty-note">還不知道什麼。</div>
            <div v-for="k in sel.known" :key="k.k" class="kv"><span>{{ k.k }}</span><b :class="{ unk: k.unknown }">{{ k.v }}</b></div>
          </div>
          <div>
            <template v-if="groupOf(sel) === '夥伴'">
              <p class="h">關係線<Hint>每一段的門檻是親密度加上一件那條線的特殊任務。做完線任務只給那件任務寫的親密度，下一段要靠平常的相處慢慢累積。</Hint></p>
              <div class="line">
                <div v-for="(st, i) in RELATION_LINE" :key="st.name" class="seg" :class="{ done: i < lineIdx - 1, now: i === lineIdx - 1 }"><b>{{ st.name }}</b><small>{{ st.need }}</small></div>
              </div>
            </template>
            <p class="h mt">共同記憶</p>
            <div v-if="!sel.memories.length" class="empty-note">還沒有共同的記憶。</div>
            <div v-for="m in sel.memories" :key="m.text" class="mem"><small>{{ m.when }}</small><p>{{ m.text }}</p></div>
          </div>
        </div>
        <div class="go">
          <button type="button" class="btn sm" :aria-pressed="!!sel.watch" @click="sel.watch = !sel.watch">{{ sel.watch ? '取消關注' : '關注' }}</button>
          <button type="button" class="btn sm" @click="ui.toast(`訊息送給${sel.name}了。`)">傳訊息</button>
          <button type="button" class="btn sm pri" @click="meet(sel)">約他</button>
        </div>
      </section>
    </div>
  </Dialog>
</template>

<style scoped>
.fl { margin: 0; }
.rel { display: grid; grid-template-columns: 340px minmax(0, 1fr); gap: 12px; align-items: start; }
.list { padding: 6px; display: grid; gap: 4px; max-height: calc(100vh - 200px); overflow: auto; }
.person { display: grid; grid-template-columns: 36px minmax(0, 1fr) auto; gap: 8px; align-items: center; padding: 8px; background: var(--bg-2); border: 0; color: var(--ink); text-align: left; cursor: pointer; }
.person.on { box-shadow: inset 0 0 0 2px var(--a); }
.person small { display: block; color: var(--ink-3); font-size: 11px; }
.ava { width: 36px; height: 36px; border-radius: 9px; background: var(--bg-1); display: grid; place-items: center; font-weight: 900; color: var(--b); flex: none; }
.ava.lg { width: 56px; height: 56px; font-size: 20px; border-radius: 12px; }
.star { color: var(--ap); font-style: normal; margin-left: 4px; font-size: 11px; }
.aff { position: relative; display: block; height: 5px; margin-top: 4px; background: var(--bg-term); border-radius: 3px; }
.aff::after { content: ""; position: absolute; left: 50%; top: -2px; bottom: -2px; width: 2px; background: var(--ink-3); }
.aff i { position: absolute; top: 0; bottom: 0; border-radius: 3px; }
.aff i.pos { left: 50%; background: var(--a); }
.aff i.neg { right: 50%; background: var(--danger); }
.meta { display: grid; justify-items: end; gap: 1px; }
.stage { font-size: 12px; color: var(--a); }
.dh { display: flex; gap: 12px; align-items: center; }
.dh h3 { margin: 0 0 2px; font-size: 18px; }
.dh h3 small { font-size: 12px; color: var(--ink-3); font-weight: 600; }
.affbig { display: grid; justify-items: center; }
.affbig small { color: var(--ink-3); font-weight: 800; }
.relline { display: flex; gap: 8px; align-items: center; margin-top: 10px; padding: 8px 10px; background: var(--bg-2); font-size: var(--fs-sm); flex-wrap: wrap; }
.relline span { flex: 1; min-width: 0; }
.inp { flex: 1; min-width: 0; background: var(--bg-term); border: 0; box-shadow: inset 0 0 0 2px var(--line); color: var(--ink); padding: 6px 8px; font: inherit; }
.mt { margin-top: 12px; }
.unk { color: var(--ink-3); }
.line { display: grid; grid-template-columns: repeat(5, minmax(0, 1fr)); gap: 4px; }
.seg { padding: 6px; background: var(--bg-2); font-size: 11px; }
.seg small { display: block; color: var(--ink-3); font-size: 10px; }
.seg.done { background: var(--a); color: #fff; }
.seg.done small { color: #fff; }
.seg.now { box-shadow: inset 0 0 0 2px var(--a); }
.mem { padding: 8px 10px; background: var(--bg-2); margin-bottom: 4px; }
.mem small { color: var(--ink-3); font-size: 11px; }
.mem p { margin: 2px 0 0; font-size: var(--fs-sm); }
@media (max-width: 900px) { .rel { grid-template-columns: 1fr; } .list { max-height: 300px; } }
</style>
