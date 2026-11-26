<script setup lang="ts">
import { computed, ref } from 'vue'
import { toMinutes } from '@engine/src'
import type { PartId } from '@engine/src/features/cyberware'
import ItemSlot from '../../components/ItemSlot.vue'
import GradeBadge from '../../components/GradeBadge.vue'
import Hint from '../../components/Hint.vue'
import Icon from '../../components/Icon.vue'
import BodyFigure from '../../components/BodyFigure.vue'
import ReasonButton from '../../components/ReasonButton.vue'
import SinkPanel from '../../components/body/SinkPanel.vue'
import DrugPanel from '../../components/body/DrugPanel.vue'
import MedicalPanel from '../../components/body/MedicalPanel.vue'
import { useEngine } from '../../stores/engine'
import { useUi } from '../../stores/ui'
import { figureMarks, groupPassives, partRows, pieceEffectLines, slotItemOf, spanText, statusText } from '../../lib/bodyView'

/**
 * 角色的「身體」分頁（UI.md 8.2 節）：人形圖上十一個部位，點部位列出它的每一槽；每一件點開看組成、成本、效果、狀態；右邊／下面是沉溺、藥與傷勢。
 * 全部讀引擎（stores/engine.ts 的 body）：槽數、成本、休養、鎖、效果都是 cyberView 與被動效果，元件只編排。拆裝要在診所（診所對話框），這裡只開入口。
 */
const eng = useEngine()
const ui = useUi()
const view = computed(() => eng.body.cyber())
const rows = computed(() => (view.value ? partRows(view.value) : []))
const marks = computed(() => (view.value ? figureMarks(view.value) : { filled: {}, warn: {} }))
const part = ref<PartId>('brain')
const slotIdx = ref(0)
const now = computed(() => toMinutes(eng.state.time))
const row = computed(() => rows.value.find((r) => r.part.id === part.value) ?? null)
const sel = computed(() => row.value?.part.pieces[slotIdx.value] ?? null)
const compose = computed(() => (sel.value ? eng.body.compose(sel.value.uid) : null))
const gate = computed(() => eng.body.clinicGate())
const groups = computed(() => groupPassives(eng.body.passives(), eng.body.sourceName, eng.body.names, ['cyber', 'quirk']))
const SIDES = ['left', 'right'] as const
function pick(id: PartId, i = 0) { part.value = id; slotIdx.value = i }
function toClinic(tab: string, extra: Record<string, unknown> = {}) { ui.open('clinic', { tab, ...extra }) }
const badge = (status: string): string | null => (status === 'recovering' ? '休養' : status === 'off' ? '停用' : null)
</script>

<template>
  <section class="body-tab" data-body-tab>
    <p v-if="!view" class="panel cut pad empty-note">還沒有主角。</p>
    <template v-else>
      <div class="bodygrid">
        <div v-for="side in SIDES" :key="side" class="parts" :class="side">
          <div v-for="r in rows.filter((x) => x.ui.side === side)" :key="r.part.id" class="part cut-sm" :class="{ on: part === r.part.id }" :data-part="r.part.id">
            <button type="button" class="ph" @click="pick(r.part.id)">
              <Icon :id="r.ui.icon" :size="26" fit />
              <b>{{ r.part.name }}</b>
              <span class="k">{{ r.part.used }}／{{ r.part.slots }} 槽</span>
              <span class="psink" title="這個部位的沉溺成本合計" data-part-sink>{{ r.sink }}</span>
            </button>
            <div class="slots">
              <div v-for="(p, i) in r.part.pieces" :key="p ? p.uid : 'e' + i" class="cell" :data-slot="`${r.part.id}:${i}`" :data-status="p?.status ?? 'empty'">
                <ItemSlot size="sm" :item="p ? slotItemOf(p, r.ui.icon) : null" :slot-icon="r.ui.icon" :selected="part === r.part.id && slotIdx === i" :locked="!!p && p.status === 'off'" @select="pick(r.part.id, i)" />
                <em v-if="p && badge(p.status)" class="mark" :data-badge="p.status">{{ badge(p.status) }}</em>
              </div>
            </div>
          </div>
        </div>
        <div class="figure"><BodyFigure :selected="part" :filled="marks.filled" :warn="marks.warn" @pick="pick" /></div>
      </div>

      <div class="lower">
        <div class="panel cut pad cdet" data-detail>
          <template v-if="sel">
            <div class="dh">
              <ItemSlot :item="slotItemOf(sel, row?.ui.icon)" size="md" inert />
              <div>
                <div class="k">{{ row?.part.name }}<template v-if="compose">・{{ compose.brand.join('、') }}</template></div>
                <h3 :style="{ color: `var(--g${sel.grade})` }" data-piece-name>{{ sel.name }}</h3>
                <div class="chips"><GradeBadge :grade="Math.min(5, Math.max(1, sel.grade)) as 1 | 2 | 3 | 4 | 5" /><span class="tag" data-status>{{ statusText(sel) }}</span><span v-if="sel.registered" class="tag">登記</span><span v-if="sel.bio" class="tag">全生體</span><span v-if="sel.deck" class="tag">甲板</span><span v-if="sel.tattoo" class="tag">刺青</span><span v-if="sel.quality" class="tag">{{ sel.quality }}</span></div>
              </div>
            </div>
            <div v-if="sel.status === 'recovering' && sel.ready_at !== undefined" class="blocking" data-recovering>休養中，還要 {{ spanText(sel.ready_at - now) }}才生效；沉溺成本照算。</div>
            <div v-if="sel.status === 'off'" class="blocking" data-off>{{ statusText(sel) }}。沉溺成本照算。</div>
            <div class="kv"><span>沉溺成本<Hint>裝上時算定的成本，墊高沉溺的下限；拆掉拿回來。休養中與停用的也照算。</Hint></span><b data-piece-sink>{{ sel.sink }}</b></div>
            <div v-if="compose" class="kv"><span>組成</span><b class="chips"><span v-for="(c, i) in compose.parts" :key="i" class="tag" data-compose>{{ c.typeName }}：{{ c.name }}</span><span v-if="!compose.parts.length" class="k">沒有零件</span></b></div>
            <div v-if="sel.effects.length" class="kv" data-piece-effects><span>效果</span><b class="chips"><span v-for="(t, i) in pieceEffectLines(sel, eng.body.names)" :key="i" class="tag" :class="{ dim: sel.status !== 'ready' }">{{ t }}</span></b></div>
            <div v-if="sel.quirks.length" class="kv"><span>怪癖</span><b class="chips"><span v-for="q in sel.quirks" :key="q.id" class="tag warn">{{ q.name }}</span></b></div>
            <div v-if="sel.lock" class="kv" data-lock><span>授權鎖<Hint>訂閱沒付就鎖住，沉溺成本照算；契約的鎖要解開或付清才能拆。</Hint></span><b style="color: var(--g4)">{{ sel.lock.kind === 'subscription' ? '訂閱' : '契約' }}<template v-if="sel.lock.holder">・{{ sel.lock.holder }}</template><template v-if="sel.lock.owed > 0">・欠 {{ sel.lock.owed }}</template></b></div>
            <div class="go"><ReasonButton sm :reason="gate" data-act="remove" @go="toClinic('remove', { uid: sel.uid })">拆下</ReasonButton><ReasonButton sm :reason="gate" data-act="repair" @go="toClinic('repair', { uid: sel.uid })">送修與解鎖</ReasonButton></div>
          </template>
          <template v-else-if="row">
            <div class="k">{{ row.part.name }}・空槽<Hint :text="row.ui.hint" /></div>
            <div class="go"><ReasonButton sm :reason="gate" data-act="install" @go="toClinic('install', { part: row.part.id })">裝一件</ReasonButton></div>
          </template>
          <p class="h mt">沉溺的下限 {{ view.sink_floor }}</p>
          <div class="chips"><span v-for="r in rows" :key="r.part.id" v-show="r.sink > 0" class="tag">{{ r.part.name }} {{ r.sink }}</span></div>
        </div>
        <SinkPanel therapy />
      </div>

      <section class="panel cut pad" data-passives>
        <p class="h">身上生效的效果<Hint>引擎的被動效果照來源分組：義體與它帶的怪癖。休養中與停用的不在這裡。</Hint></p>
        <div v-for="g in groups" :key="g.source" class="pg" :data-source="g.source">
          <b>{{ g.name }}</b>
          <span v-for="r in g.rows" :key="r.label" class="tag"><small>{{ r.label }}</small> {{ r.lines.join('；') }}</span>
        </div>
        <p v-if="!groups.length" class="empty-note">沒有義體的效果。</p>
      </section>

      <div class="lower">
        <DrugPanel />
        <MedicalPanel />
      </div>
    </template>
  </section>
</template>

<style scoped>
.body-tab { display: grid; gap: var(--space-4); }
.bodygrid { display: grid; grid-template-columns: minmax(0, 1fr) minmax(160px, 240px) minmax(0, 1fr); gap: var(--space-3); align-items: start; }
.figure { grid-column: 2; grid-row: 1; background: var(--bg-term); padding: var(--space-3); border-radius: 8px; align-self: stretch; display: grid; place-items: center; }
.parts { display: grid; gap: var(--space-3); }
.parts.left { grid-column: 1; grid-row: 1; }
.parts.right { grid-column: 3; grid-row: 1; }
.part { background: var(--bg-1); box-shadow: inset 0 0 0 2px var(--line); padding: var(--space-3) var(--space-4); }
.part.on { box-shadow: inset 0 0 0 2px var(--a); }
.ph { display: flex; align-items: center; gap: var(--space-3); width: 100%; background: none; border: 0; padding: 0; cursor: pointer; color: inherit; text-align: left; }
.ph b { font-size: var(--fs-md); }
.ph .k { flex: 1; }
.psink { font: 800 var(--fs-fine) var(--mono); color: var(--sink); }
.slots { display: grid; grid-template-columns: repeat(auto-fill, minmax(40px, 48px)); gap: var(--space-3); margin-top: var(--space-3); }
.cell { position: relative; }
.mark { position: absolute; left: 0; right: 0; bottom: -2px; text-align: center; font: 800 var(--fs-micro) var(--font); font-style: normal; background: var(--bg-term); color: var(--warn); pointer-events: none; }
.cell[data-status="recovering"] :deep(.frame) { opacity: .6; }
.lower { display: grid; grid-template-columns: repeat(auto-fit, minmax(320px, 1fr)); gap: var(--space-4); align-items: start; }
.dh { display: grid; grid-template-columns: 64px 1fr; gap: var(--space-4); align-items: center; margin-bottom: var(--space-3); }
.dh h3 { margin: 2px 0 4px; font-size: var(--fs-section); }
.mt { margin-top: var(--space-4); }
.tag.dim { opacity: .55; }
.tag small { color: var(--ink-3); margin-right: var(--space-2); }
.pg { display: flex; gap: var(--space-3); flex-wrap: wrap; align-items: center; margin-bottom: var(--space-3); }
@media (max-width: 960px) {
  .bodygrid { grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); }
  .figure { grid-column: 1 / -1; grid-row: 1; max-height: 340px; }
  .figure :deep(.fig) { max-height: 320px; }
  .parts.left { grid-column: 1; grid-row: 2; }
  .parts.right { grid-column: 2; grid-row: 2; }
}
@media (max-width: 720px) { .slots { grid-template-columns: repeat(3, minmax(0, 44px)); } .lower { grid-template-columns: minmax(0, 1fr); } }
</style>
