<script setup lang="ts">
import { computed, ref } from 'vue'
import Dialog from '../components/Dialog.vue'
import Hint from '../components/Hint.vue'
import ReasonButton from '../components/ReasonButton.vue'
import TrackBar from '../components/TrackBar.vue'
import PartWindow from '../components/PartWindow.vue'
import { useEngine } from '../stores/engine'
import { useUi } from '../stores/ui'
import { failText } from '../lib/lifeView'
import { FILTERS, UNOPENED, affinityBar, factionOf, favorRows, filterPersons, identityOf, kindName, knownRows, memoryRows, newsRows, personRows } from '../lib/peopleView'
import type { PersonFilter } from '../lib/peopleView'

/**
 * 關係（UI 3.9 節，規則 NPC_SYSTEM 第 7、8 節、FAVORS）。左邊名單：親密度條以 0 為中線、階段的名字、人情；
 * 右邊詳情：親密度與階段、忠誠、已知的事、共同記憶（改寫、釘選、刪除）、近況、關注的開關；下面是人情（欠你的、你欠的）。
 * 階段、忠誠、人情的大小都是引擎的；關係線、傳訊息先灰掉。
 */
const props = defineProps<{ entryId: number; stacked?: boolean; npcId?: string }>()
const e = useEngine()
const ui = useUi()
const filter = ref<PersonFilter>('全部')

const members = computed(() => new Set(e.people.roster().members.map((m) => m.id)))
const favors = computed(() => e.people.favors())
const all = computed(() => personRows(e.people.known(), (id) => ({
  npc: e.people.npc(id)!, affinity: e.people.affinity(id), stageName: e.people.stage(id).name, rel: e.people.rel(id), loyalty: e.people.loyalty(id), member: members.value.has(id),
}), favors.value, e.people.look).filter((r) => e.people.npc(r.id)))
const list = computed(() => filterPersons(all.value, filter.value))
const selId = ref<string | null>(props.npcId ?? null)
const sel = computed(() => all.value.find((r) => r.id === selId.value) ?? list.value[0] ?? null)
const npc = computed(() => (sel.value ? e.people.npc(sel.value.id) : null))
const rel = computed(() => (sel.value ? e.people.rel(sel.value.id) : null))
const facts = computed(() => (npc.value ? knownRows(npc.value, rel.value?.known ?? [], e.people.look) : []))
const memories = computed(() => (sel.value ? memoryRows(e.people.memoriesOf(sel.value.id), e.people.look) : []))
const news = computed(() => (sel.value ? newsRows(e.people.news(sel.value.id)) : []))
const owedToYou = computed(() => favorRows(favors.value, 'owed_to_pc', e.people.favorName))
const youOwe = computed(() => favorRows(favors.value, 'owed_by_pc', e.people.favorName))
const hostility = computed(() => e.hostilityRows())
const editing = ref<string | null>(null)
const draft = ref('')

function say(why: string | null) { if (why) ui.toast(why, 'warn') }
async function run(p: Promise<{ status: string; reason?: string }>) { say(failText(await p, '現在做不了。')) }
const toggleWatch = () => sel.value && run(e.people.watch(sel.value.id, !sel.value.watch))
function edit(id: string, text: string) { editing.value = id; draft.value = text }
async function saveMemory(id: string) {
  const t = draft.value.trim()
  if (!t) { ui.toast('改寫的內容不能是空的。', 'warn'); return }
  await run(e.people.editMemory(id, { text: t }))
  editing.value = null
}
const pin = (id: string, on: boolean) => run(e.people.editMemory(id, { pinned: on }))
const forget = (id: string) => run(e.people.forgetMemory(id))
const useFavor = (id: string) => run(e.people.favorUse(id))
const answer = (id: string, a: 'do' | 'refuse') => run(e.people.favorAnswer(id, a))
</script>

<template>
  <Dialog :entry-id="entryId" :stacked="stacked" title="關係" :sub="`${all.length} 人・關注 ${all.filter((n) => n.watch).length}`" size="xl">
    <template #header><div class="filters fl"><button v-for="f in FILTERS" :key="f" type="button" :class="{ on: filter === f }" :data-filter="f" @click="filter = f">{{ f }}</button></div></template>
    <div class="rel">
      <aside class="panel cut list" data-list>
        <button v-for="n in list" :key="n.id" type="button" class="person" :class="{ on: sel?.id === n.id }" :data-person="n.id" @click="selId = n.id; editing = null">
          <span class="ava" aria-hidden="true">{{ n.name.slice(0, 1) }}</span>
          <span class="grow">
            <b>{{ n.name }}<i v-if="n.watch" class="star" aria-label="關注">★</i></b>
            <small class="ellipsis">{{ n.identity }}</small>
            <span class="aff" :aria-label="`親密度 ${n.affinity}`"><i :class="affinityBar(n.affinity).side" :style="{ width: affinityBar(n.affinity).pct + '%' }" /></span>
          </span>
          <span class="meta">
            <b class="stage" data-stage>{{ n.stageName }}<span class="num mono">{{ n.affinity }}</span></b>
            <small v-if="n.member" class="mono">忠 {{ n.loyalty }}</small>
            <small v-if="n.owedToYou || n.youOwe"><span v-if="n.owedToYou" class="ok-t">欠你 {{ n.owedToYou }}</span><span v-if="n.owedToYou && n.youOwe">・</span><span v-if="n.youOwe" class="warn-t">你欠 {{ n.youOwe }}</span></small>
          </span>
        </button>
        <div v-if="!list.length" class="empty-note pad">{{ all.length ? '沒有符合的人。' : '還沒有認識的人。到街上和人說話就會認識。' }}</div>
      </aside>

      <section v-if="sel && npc" class="panel cut pad det" data-detail>
        <div class="dh">
          <div class="ava lg" aria-hidden="true">{{ sel.name.slice(0, 1) }}</div>
          <div class="grow">
            <h3>{{ sel.name }} <small>{{ npc.age }} 歲・{{ kindName(npc) }}</small></h3>
            <div class="k">{{ identityOf(npc) }}</div>
            <div class="chips"><span v-if="npc.faction" class="tag">{{ factionOf(npc, e.people.look) }}</span></div>
          </div>
          <div class="affbig"><span class="big-num" :style="{ color: sel.affinity >= 0 ? 'var(--a)' : 'var(--danger)' }">{{ sel.affinity }}</span><small>{{ sel.stageName }}</small></div>
        </div>
        <div class="relline"><span data-relation>{{ rel?.relation || '（還沒有寫）' }}</span><Hint>和你的關係一句：AI 提議；沒有時留空。</Hint></div>
        <div class="cols2 mt">
          <div>
            <TrackBar v-if="sel.loyalty !== null" label="忠誠" :value="sel.loyalty" :max="100" color="var(--ram)" />
            <p class="h mt">已知的事</p>
            <div v-for="k in facts" :key="k.key" class="kv"><span>{{ k.label }}</span><b :class="{ unk: k.unknown }">{{ k.value }}</b></div>
            <template v-if="news.length">
              <p class="h mt">近況</p>
              <div v-for="(n, i) in news" :key="i" class="mem"><small>{{ n.when }}</small><p>{{ n.text }}</p></div>
            </template>
          </div>
          <div>
            <p class="h">共同記憶<Hint>引擎照規則記；你可以改寫內容、釘選（釘選的先被想起來）、刪掉。</Hint></p>
            <div v-if="!memories.length" class="empty-note">還沒有共同的記憶。</div>
            <div v-for="m in memories" :key="m.id" class="mem" :data-memory="m.id">
              <small>{{ m.when }}<template v-if="m.place">・{{ m.place }}</template>・{{ m.weightName }}<template v-if="m.pinned">・已釘選</template><template v-if="m.merged">・合併 {{ m.merged }} 筆</template></small>
              <template v-if="editing !== m.id"><p>{{ m.text }}</p>
                <div class="macts"><button type="button" class="btn sm ghost" @click="edit(m.id, m.text)">改寫</button><button type="button" class="btn sm ghost" :data-pin="m.id" @click="pin(m.id, !m.pinned)">{{ m.pinned ? '取消釘選' : '釘選' }}</button><button type="button" class="btn sm ghost" :data-forget="m.id" @click="forget(m.id)">刪除</button></div></template>
              <div v-else class="macts"><input v-model="draft" class="inp" aria-label="改寫這筆記憶" @keydown.enter="saveMemory(m.id)"><button type="button" class="btn sm pri" @click="saveMemory(m.id)">存</button><button type="button" class="btn sm ghost" @click="editing = null">取消</button></div>
            </div>
          </div>
        </div>
        <div class="go">
          <button type="button" class="btn sm" :aria-pressed="sel.watch" data-watch @click="toggleWatch">{{ sel.watch ? '取消關注' : '關注' }}</button>
          <ReasonButton sm :reason="UNOPENED">關係線</ReasonButton>
          <ReasonButton sm :reason="UNOPENED">傳訊息</ReasonButton>
          <button type="button" class="btn sm pri" @click="ui.open('talk', { npcId: sel.id })">說話</button>
        </div>
      </section>
      <section v-else class="panel cut pad det"><div class="empty-note">選一個人看詳情。</div></section>

      <section class="panel cut pad fav" data-favors>
        <p class="h">人情<Hint title="人情">欠你的：可以用掉；你欠的：對方來討時答應（清掉）或回絕（那一筆留著，信譽會受影響）。大小與信譽的變化都是引擎的。</Hint></p>
        <div class="fcols">
          <div>
            <p class="h2">欠你的</p>
            <div v-if="!owedToYou.length" class="empty-note">沒有人欠你。</div>
            <div v-for="f in owedToYou" :key="f.id" class="frow" :data-favor="f.id"><span class="grow"><b>{{ f.whoName }}</b><small>{{ f.size }}<template v-if="f.note">・{{ f.note }}</template></small></span><ReasonButton sm :reason="e.people.favorUseBlock(f.id)" @go="useFavor(f.id)">用掉</ReasonButton></div>
          </div>
          <div>
            <p class="h2">你欠的</p>
            <div v-if="!youOwe.length" class="empty-note">你沒有欠人。</div>
            <div v-for="f in youOwe" :key="f.id" class="frow owe" :data-owe="f.id"><span class="grow"><b class="warn-t">{{ f.whoName }}</b><small class="warn-t">{{ f.size }}<template v-if="f.note">・{{ f.note }}</template></small></span><button type="button" class="btn sm" @click="answer(f.id, 'do')">答應</button><button type="button" class="btn sm ghost" @click="answer(f.id, 'refuse')">回絕</button></div>
          </div>
        </div>
      </section>

      <PartWindow />

      <section v-if="hostility.length" class="panel cut pad fav" data-hostility>
        <p class="h">敵對值<Hint title="敵對值">下限是永久的與有期限的取較高的那個；有期限的下限到期就掉，列在後面（剩幾天）。數字都是引擎的。</Hint></p>
        <div v-for="h in hostility" :key="h.faction" class="frow" :data-hostility-row="h.faction">
          <span class="grow"><b>{{ h.name }}</b><small>{{ h.tier.name }}<template v-if="h.floor > 0">・下限 {{ h.floor }}</template></small>
            <small v-for="t in h.timed" :key="t.value + ':' + t.days" class="warn-t" data-timed-floor>有期限的下限 {{ t.value }}，剩 {{ t.days }} 天</small></span>
          <b class="mono">{{ h.value }}</b>
        </div>
      </section>
    </div>
  </Dialog>
</template>

<style scoped>
.fl { margin: 0; }
.rel { display: grid; grid-template-columns: 340px minmax(0, 1fr); gap: 12px; align-items: start; }
.fav { grid-column: 1 / -1; }
.fcols { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 12px; }
.h2 { margin: 0 0 4px; font-size: var(--fs-sm); color: var(--ink-3); font-weight: 800; }
.frow { display: flex; gap: 8px; align-items: center; padding: 6px 8px; background: var(--bg-2); margin-bottom: 4px; font-size: var(--fs-sm); }
.frow small { display: block; color: var(--ink-3); font-size: var(--fs-fine); }
.grow { flex: 1; min-width: 0; }
.warn-t { color: var(--warn); } .ok-t { color: var(--ok); }
.list { padding: 6px; display: grid; gap: 4px; max-height: calc(100vh - 260px); overflow: auto; }
.person { display: grid; grid-template-columns: 36px minmax(0, 1fr) auto; gap: 8px; align-items: center; padding: 8px; background: var(--bg-2); border: 0; color: var(--ink); text-align: left; cursor: pointer; }
.person.on { box-shadow: inset 0 0 0 2px var(--a); }
.person small { display: block; color: var(--ink-3); font-size: var(--fs-fine); }
.ava { width: 36px; height: 36px; border-radius: 9px; background: var(--bg-1); display: grid; place-items: center; font-weight: 900; color: var(--b); flex: none; }
.ava.lg { width: 56px; height: 56px; font-size: var(--fs-xl); border-radius: 12px; }
.star { color: var(--ap); font-style: normal; margin-left: 4px; font-size: var(--fs-fine); }
.aff { position: relative; display: block; height: 5px; margin-top: 4px; background: var(--bg-term); border-radius: 3px; }
.aff::after { content: ""; position: absolute; left: 50%; top: -2px; bottom: -2px; width: 2px; background: var(--ink-3); }
.aff i { position: absolute; top: 0; bottom: 0; border-radius: 3px; }
.aff i.pos { left: 50%; background: var(--a); }
.aff i.neg { right: 50%; background: var(--danger); }
.meta { display: grid; justify-items: end; gap: 1px; }
.stage { font-size: var(--fs-sm); color: var(--a); }
.stage .num { margin-left: 5px; color: var(--ink-3); font-size: var(--fs-fine); }
.dh { display: flex; gap: 12px; align-items: center; }
.dh h3 { margin: 0 0 2px; font-size: var(--fs-section); }
.dh h3 small { font-size: var(--fs-sm); color: var(--ink-3); font-weight: 600; }
.affbig { display: grid; justify-items: center; }
.affbig small { color: var(--ink-3); font-weight: 800; }
.relline { display: flex; gap: 8px; align-items: center; margin-top: 10px; padding: 8px 10px; background: var(--bg-2); font-size: var(--fs-sm); flex-wrap: wrap; }
.relline span { flex: 1; min-width: 0; }
.inp { flex: 1; min-width: 0; background: var(--bg-term); border: 0; box-shadow: inset 0 0 0 2px var(--line); color: var(--ink); padding: 6px 8px; font: inherit; }
.mt { margin-top: 12px; }
.unk { color: var(--ink-3); }
.mem { padding: 8px 10px; background: var(--bg-2); margin-bottom: 4px; }
.mem small { color: var(--ink-3); font-size: var(--fs-fine); }
.mem p { margin: 2px 0 0; font-size: var(--fs-sm); }
.macts { display: flex; gap: 4px; flex-wrap: wrap; margin-top: 4px; }
.go { display: flex; gap: 6px; flex-wrap: wrap; margin-top: 12px; justify-content: flex-end; }
@media (max-width: 900px) { .rel { grid-template-columns: 1fr; } .list { max-height: 300px; } .fcols { grid-template-columns: 1fr; } }
</style>
