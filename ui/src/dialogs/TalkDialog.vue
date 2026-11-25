<script setup lang="ts">
import { computed, ref } from 'vue'
import Dialog from '../components/Dialog.vue'
import Hint from '../components/Hint.vue'
import LogView from '../components/LogView.vue'
import ReasonButton from '../components/ReasonButton.vue'
import TrackBar from '../components/TrackBar.vue'
import TeachPanel from '../components/TeachPanel.vue'
import { useEngine } from '../stores/engine'
import { useUi } from '../stores/ui'
import { failText } from '../lib/lifeView'
import { CATEGORY_NAME, READ_CATEGORIES, UNOPENED, UNOPENED_ACTIONS, affinityBar, factionOf, identityOf, interactRows, kindName, knownRows, memoryRows, newsRows, stageList } from '../lib/peopleView'
import type { InteractRow, ReadCategory } from '../lib/peopleView'

/**
 * 和 NPC 說話（UI.md 3.9 節）：左邊親密度與階段、忠誠（名冊上的人）、已知的事（沒揭開的寫問號）；
 * 中間紀錄與互動選單（每一種的 DC、成功率、不能做的原因都是引擎的 interactions）；右邊共同記憶（引擎的 recall）。
 * 互動送出去走主動行動（先擲骰再判定）；這裡只編排，不寫規則。
 */
const props = defineProps<{ entryId: number; stacked?: boolean; npcId: string }>()
const e = useEngine()
const ui = useUi()

const npc = computed(() => e.people.npc(props.npcId))
const rel = computed(() => e.people.rel(props.npcId))
const affinity = computed(() => e.people.affinity(props.npcId))
const stage = computed(() => e.people.stage(props.npcId))
const loyalty = computed(() => e.people.loyalty(props.npcId))
const known = computed(() => (npc.value ? e.people.known().includes(props.npcId) : false))
const bar = computed(() => affinityBar(affinity.value))
const facts = computed(() => knownRows(npc.value!, rel.value?.known ?? [], e.people.look))
const rows = computed<InteractRow[]>(() => interactRows(e.people.interactions(props.npcId)))
const log = computed(() => e.people.talkLog(props.npcId))
const memories = computed(() => memoryRows(e.people.recall(props.npcId), e.people.look))
const news = computed(() => newsRows(e.people.news(props.npcId)))
const stack = computed(() => e.gear.inventory())
const stages = stageList()

const pane = ref<'talk' | 'gift' | 'read' | 'consult'>('talk')
/** 主角持約的人：說話面板多一個「契約」鈕（M4-ui-contract） */
const isHeld = computed(() => e.contract.held().some((h) => h.id === props.npcId))
const gift = ref<string | null>(null)
const category = ref<ReadCategory | null>(null)
const free = ref('')

async function send(kind: string, extra: { item?: string; category?: ReadCategory } = {}) {
  const r = await e.people.interact(kind as never, props.npcId, extra)
  const why = failText(r, '現在做不了。')
  if (why) ui.toast(why, 'warn')
}
function pick(r: InteractRow) {
  if (r.needs === 'item') { pane.value = 'gift'; return }
  if (r.needs === 'category') { pane.value = 'read'; return }
  if (r.handoff) { pane.value = 'consult'; return }
  void send(r.kind)
}
async function sendGift() {
  if (!gift.value) return
  const id = gift.value
  await send('npc_gift', { item: id })
  gift.value = null
}
async function sendRead() {
  if (!category.value) return
  await send('npc_read_bridge', { category: category.value })
}
async function freeSay() {
  const t = free.value.trim()
  if (!t) { ui.toast('先寫下想說或想做的事。', 'warn'); return }
  free.value = ''
  const r = await e.act({ kind: 'free', text: t, target: props.npcId })
  const why = failText(r, '現在做不了。')
  if (why) { ui.toast(why, 'warn'); free.value = t }
}
async function meet() {
  const r = await e.people.meet(props.npcId)
  const why = failText(r, '現在認識不了他。')
  if (why) ui.toast(why, 'warn')
}
const giftRow = computed(() => rows.value.find((r) => r.needs === 'item'))
const readRow = computed(() => rows.value.find((r) => r.needs === 'category'))
</script>

<template>
  <Dialog v-if="npc" :entry-id="entryId" :stacked="stacked" :title="`和${npc.name}說話`" :sub="e.placeName(e.state.location)" size="xl">
    <div class="talk-grid" data-talk>
      <aside class="panel cut pad who">
        <div class="por"><svg viewBox="0 0 120 150" aria-hidden="true"><circle cx="60" cy="52" r="30" fill="var(--b)" /><path d="M14 150c0-34 20-56 46-56s46 22 46 56z" fill="var(--b)" /><rect x="52" y="118" width="16" height="6" rx="3" fill="var(--a)" /></svg></div>
        <b class="nm" data-name>{{ npc.name }}</b> <span class="tag">{{ kindName(npc) }}</span>
        <div class="k">{{ npc.age }} 歲・{{ identityOf(npc) }}</div>
        <div class="chips mt"><span v-if="npc.faction" class="tag">{{ factionOf(npc, e.people.look) }}</span></div>
        <div v-if="isHeld" class="mt"><button type="button" class="btn sm pri" data-open-contract @click="ui.open('contract', { npcId, side: 'held' })">契約（你是持約人）</button></div>
        <div class="rel" data-relation>和你的關係：<span>{{ rel?.relation ?? '' }}</span> <Hint>這一句由 AI 提議，沒有時留空；到「關係」可以自己寫。</Hint></div>
        <div v-if="known" class="mtr">
          <div class="top"><span>親密度<Hint title="親密度">−100～100，0 是中線。階段：{{ stages.map((s) => `${s.name}（${s.min}）`).join('、') }}。</Hint></span><b data-affinity>{{ affinity }}<small data-stage>{{ stage.name }}</small></b></div>
          <div class="cbar"><b :class="bar.side" :style="bar.side === 'pos' ? { left: '50%', width: bar.pct + '%' } : { right: '50%', width: bar.pct + '%' }" /></div>
        </div>
        <div v-else class="empty-note mt" data-stranger>還不認識他。<button type="button" class="btn sm" @click="meet">認識他</button></div>
        <div v-if="loyalty !== null" class="mtr" data-loyalty>
          <TrackBar label="忠誠" :value="loyalty" :max="100" color="var(--ram)" :height="8" />
        </div>
        <p class="h mt">已知的事</p>
        <div v-for="k in facts" :key="k.key" class="kn" :data-fact="k.key"><span>{{ k.label }}</span><b :class="{ q: k.unknown }" :data-unknown="k.unknown">{{ k.value }}<Hint v-if="k.unknown" text="讀橋或聊天可以揭開。" /></b></div>
      </aside>

      <section class="panel cut talkp">
        <div class="hd"><b>和{{ npc.name }}說話</b></div>
        <div class="conv" data-log><LogView :entries="log" /><div v-if="!log.length" class="empty-note pad">還沒有和他互動過。</div></div>
        <div class="dock">
          <div v-if="pane === 'talk'" class="menu" data-menu>
            <div v-for="r in rows" :key="r.kind" class="irow" :data-kind="r.kind">
              <span class="in"><b>{{ r.name }}</b><small v-if="r.reason" class="why" data-reason>{{ r.reason }}</small><small v-else-if="r.note" data-again>{{ r.note }}</small></span>
              <span v-if="r.dcText" class="dc mono" :title="r.dcTitle" data-dc>{{ r.dcText }}</span>
              <span v-if="r.chanceText" class="ch mono" data-chance>{{ r.chanceText }}</span>
              <ReasonButton sm pri :reason="r.reason" :data-do="r.kind" @go="pick(r)">{{ r.needs === 'item' ? '選禮物' : r.needs === 'category' ? '選類別' : r.handoff ? '看課' : '做' }}</ReasonButton>
            </div>
            <div v-for="n in UNOPENED_ACTIONS" :key="n" class="irow off"><span class="in"><b>{{ n }}</b><small class="why">{{ UNOPENED }}</small></span><ReasonButton sm :reason="UNOPENED">做</ReasonButton></div>
          </div>
          <div v-else-if="pane === 'gift'" class="gifts" data-gifts>
            <div v-for="s in stack" :key="s.id" class="gift" role="button" tabindex="0" :aria-pressed="gift === s.id" :class="{ on: gift === s.id }" :data-item="s.id" @click="gift = s.id" @keydown.enter="gift = s.id">
              <b>{{ e.people.look.item(s.id) }}</b><span class="mono">×{{ s.qty }}</span>
            </div>
            <div v-if="!stack.length" class="empty-note">背包裡沒有東西可以送。</div>
            <div class="go">
              <span v-if="giftRow" class="k"><template v-if="giftRow.dcText">{{ giftRow.dcText }}・</template>{{ giftRow.chanceText }}</span>
              <button type="button" class="btn sm" @click="pane = 'talk'">返回</button>
              <ReasonButton sm pri :reason="giftRow?.reason ?? (gift ? null : '先選一件禮物。')" data-do="gift-send" @go="sendGift">送出</ReasonButton>
            </div>
          </div>
          <div v-else-if="pane === 'consult'" class="gifts" data-consult>
            <TeachPanel :npc="npcId" />
            <div class="go"><button type="button" class="btn sm" @click="pane = 'talk'">返回</button></div>
          </div>
          <div v-else class="gifts" data-read>
            <div v-for="c in READ_CATEGORIES" :key="c" class="gift" role="button" tabindex="0" :aria-pressed="category === c" :class="{ on: category === c }" :data-category="c" @click="category = c" @keydown.enter="category = c"><b>{{ CATEGORY_NAME[c] }}</b></div>
            <div class="go">
              <span v-if="readRow" class="k"><template v-if="readRow.dcText">{{ readRow.dcText }}・</template>{{ readRow.chanceText }}</span>
              <button type="button" class="btn sm" @click="pane = 'talk'">返回</button>
              <ReasonButton sm pri :reason="readRow?.reason ?? (category ? null : '先選一個類別。')" data-do="read-send" @go="sendRead">讀</ReasonButton>
            </div>
          </div>
          <form class="free" @submit.prevent="freeSay">
            <span class="die" aria-hidden="true" />
            <label class="sr-only" :for="`free-${entryId}`">我要做別的</label>
            <input :id="`free-${entryId}`" v-model="free" placeholder="我要做別的……" autocomplete="off" :disabled="e.busy">
            <button type="submit" class="btn sm pri" :disabled="e.busy">說</button>
          </form>
        </div>
      </section>

      <aside class="panel cut pad mem" data-memories>
        <p class="h">共同記憶</p>
        <div v-for="m in memories" :key="m.id" class="memo"><small>{{ m.when }}<template v-if="m.place">・{{ m.place }}</template>・{{ m.weightName }}<template v-if="m.pinned">・釘選</template><span class="imp"><i v-for="n in 3" :key="n" :class="{ on: n <= m.weight }" /></span></small>{{ m.text }}</div>
        <div v-if="!memories.length" class="empty-note">還沒有共同記憶。</div>
        <template v-if="news.length">
          <p class="h mt">近況</p>
          <div v-for="(n, i) in news" :key="i" class="memo"><small>{{ n.when }}</small>{{ n.text }}</div>
        </template>
      </aside>
    </div>
  </Dialog>
  <Dialog v-else :entry-id="entryId" :stacked="stacked" title="和 NPC 說話" size="md"><div class="empty-note pad">查不到這個人。</div></Dialog>
</template>

<style scoped>
.talk-grid { display: grid; grid-template-columns: 270px minmax(0, 1fr) 250px; gap: 12px; align-items: stretch; min-height: min(640px, calc(100vh - 140px)); }
.por { position: relative; height: 150px; background: linear-gradient(180deg, #2A1E36, #1A1322); display: grid; place-items: end center; margin-bottom: 10px; border-radius: 6px; overflow: hidden; }
.por svg { height: 130px; }
.nm { font-size: var(--fs-section); }
.mt { margin-top: 8px; }
.rel { font-size: var(--fs-sm); color: var(--ink-2); margin-top: 8px; }
.mtr { margin-top: 12px; }
.mtr .top { display: flex; justify-content: space-between; align-items: baseline; font-size: var(--fs-sm); color: var(--ink-3); font-weight: 800; }
.mtr .top span { display: inline-flex; gap: 4px; align-items: center; }
.mtr .top b { font: 900 var(--fs-xl) var(--mono); color: var(--ink); }
.mtr .top b small { font-size: var(--fs-sm); color: var(--a); margin-left: 6px; font-family: var(--font); }
.cbar { height: 10px; background: #2E2339; position: relative; margin-top: 5px; border-radius: 5px; overflow: hidden; }
.cbar::after { content: ""; position: absolute; left: 50%; top: -2px; bottom: -2px; width: 2px; background: var(--ink-3); }
.cbar b { position: absolute; top: 0; bottom: 0; background: var(--a); }
.cbar b.neg { background: var(--danger); }
.kn { display: grid; grid-template-columns: 54px 1fr; gap: 6px; padding: 6px 0; border-bottom: 1px dashed var(--line); font-size: var(--fs-sm); }
.kn span { color: var(--ink-3); }
.kn b { font-weight: 600; display: flex; align-items: center; gap: 4px; flex-wrap: wrap; min-width: 0; }
.kn .q { color: var(--ink-3); font-family: var(--mono); }
.talkp { display: flex; flex-direction: column; min-height: 0; min-width: 0; }
.talkp .hd { display: flex; align-items: center; gap: 10px; padding: 12px 16px; border-bottom: 2px solid var(--line); }
.conv { flex: 1; overflow: auto; padding: 0 18px 10px; min-height: 160px; max-height: 40vh; }
.dock { border-top: 2px solid var(--line); padding: 10px 12px; display: grid; gap: 8px; }
.menu { display: grid; gap: 5px; }
.irow { display: grid; grid-template-columns: minmax(0, 1fr) auto auto auto; gap: 10px; align-items: center; padding: 6px 10px; background: var(--bg-2); font-size: var(--fs-ui); }
.irow.off { opacity: .6; }
.in { display: grid; gap: 2px; min-width: 0; }
.in small { color: var(--ink-3); font-size: var(--fs-fine); }
.in small.why { color: var(--warn); }
.dc, .ch { font-size: var(--fs-sm); color: var(--ink-2); font-weight: 800; }
.ch { color: var(--ram); min-width: 3ch; text-align: right; }
.gifts { display: grid; gap: 5px; }
.gift { display: flex; justify-content: space-between; gap: 10px; padding: 8px 10px; background: var(--bg-2); border: 0; cursor: pointer; color: inherit; font-size: var(--fs-ui); }
.gift.on { box-shadow: inset 0 0 0 2px var(--a); }
.go { display: flex; gap: 8px; align-items: center; justify-content: flex-end; }
.go .k { flex: 1; color: var(--ink-3); font-size: var(--fs-sm); }
.free { display: flex; align-items: center; gap: 10px; padding: 8px 10px; background: var(--bg-term); box-shadow: inset 0 0 0 2px var(--line); }
.free input { flex: 1; min-width: 0; background: transparent; border: 0; color: var(--ink); font: 500 var(--fs-md) var(--font); outline: none; }
.die { width: 22px; height: 22px; flex: none; background: var(--a); clip-path: polygon(50% 0, 100% 25%, 100% 75%, 50% 100%, 0 75%, 0 25%); }
.memo { padding: 8px 10px; background: var(--bg-2); margin-bottom: 5px; font-size: var(--fs-sm); line-height: 1.65; }
.memo small { display: flex; gap: 6px; align-items: center; flex-wrap: wrap; font: 700 var(--fs-tiny) var(--mono); color: var(--ink-3); }
.imp { display: inline-flex; gap: 2px; } .imp i { width: 6px; height: 6px; border-radius: 50%; background: #45375A; } .imp i.on { background: var(--a); }
@media (max-width: 1100px) { .talk-grid { grid-template-columns: 250px minmax(0, 1fr); } .mem { grid-column: 1 / -1; } }
@media (max-width: 720px) { .talk-grid { grid-template-columns: 1fr; min-height: 0; } .talkp { order: -1; } .conv { max-height: 34vh; } .por { height: 110px; } .por svg { height: 100px; } .irow { grid-template-columns: minmax(0, 1fr) auto auto; } .irow .dc { display: none; } }
</style>
