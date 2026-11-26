<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import Hint from '../../components/Hint.vue'
import ItemSlot from '../../components/ItemSlot.vue'
import MoneyTag from '../../components/MoneyTag.vue'
import ReasonButton from '../../components/ReasonButton.vue'
import PartList from './PartList.vue'
import MakerPicker from './MakerPicker.vue'
import CrewPicker from './CrewPicker.vue'
import ProductList from './ProductList.vue'
import ResultNote from './ResultNote.vue'
import { partTypeName } from '@engine/src'
import { useEngine } from '../../stores/engine'
import { useUi } from '../../stores/ui'
import { DEGREE_LABEL, MATERIAL_NAME, POOL_NAME, gradeOf, minutesText, partIcon, pct, signed, statDiff, weightText } from '../../lib/craftView'
import { legalName } from '../../lib/gearView'
import type { SwapOpts } from '@engine/src/features/craft'

/**
 * 換零件（CRAFTING 第 10.3 節）：背包裡的一件成品換掉一個零件，或在空的選配槽裡裝一個。左邊選成品，中間選哪個槽，右邊選要換上去的零件；
 * 下面是引擎的 swapPreview：換之前與換之後的數字、難度與成功率、工錢。只有自己動手與店家做換零件。
 */
const props = defineProps<{ uid?: string }>()
const eng = useEngine()
const ui = useUi()

const uid = ref(props.uid ?? eng.craft.products()[0]?.data?.uid as string ?? '')
const stack = computed(() => eng.craft.products().find((s) => s.data?.uid === uid.value) ?? null)
watch(() => eng.craft.products().map((s) => s.data?.uid), (u) => { if (!u.includes(uid.value)) uid.value = (u[0] as string | undefined) ?? '' })
const detail = computed(() => (stack.value ? eng.craft.detail(stack.value) : null))

/** 這件成品的每一個位置：每個槽的每一格（有零件的列出零件，空的選配槽也列） */
const rows = computed(() => {
  const d = detail.value
  if (!d) return []
  const bp = d.info.bp
  const needs = new Map<string, { count: number; required: boolean }>()
  for (const n of bp.require ?? []) needs.set(n.type, { count: (needs.get(n.type)?.count ?? 0) + (n.count ?? 1), required: true })
  for (const n of bp.optional ?? []) if (!needs.has(n.type)) needs.set(n.type, { count: n.count ?? 1, required: false })
  return [...needs].flatMap(([type, n]) => {
    const have = d.info.parts.filter((p) => p.type === type)
    return Array.from({ length: n.count }, (_, index) => ({ key: `${type}:${index}`, type, index, required: n.required, part: have[index]?.part ?? null }))
  })
})
const rowKey = ref('')
watch(rows, (r) => { if (!r.some((x) => x.key === rowKey.value)) rowKey.value = r[0]?.key ?? '' }, { immediate: true })
const row = computed(() => rows.value.find((r) => r.key === rowKey.value) ?? null)
const next = ref('')
watch([uid, rowKey], () => { next.value = ''; done.value = null })

const byId = ref('')
const makers = computed(() => eng.craft.makers(byId.value || undefined))
const makerId = ref<string>('self')
const payWith = ref<'auto' | 'cred' | 'cash'>('auto')
const opts = computed<SwapOpts | null>(() => (row.value && next.value ? { uid: uid.value, type: row.value.type, index: row.value.index, part: next.value, maker: makerId.value as SwapOpts['maker'], ...(byId.value ? { by: byId.value } : {}), ...(payWith.value !== 'auto' ? { pay: payWith.value } : {}) } : null))
const preview = computed(() => (opts.value ? eng.craft.swapPreview(opts.value) : null))
const diff = computed(() => (preview.value?.before && preview.value.after ? statDiff(preview.value.before.stats, preview.value.after.stats) : []))

const done = ref<{ result: string; lines: string[] } | null>(null)
function swap() {
  if (!opts.value) return
  const r = eng.craft.swap(opts.value)
  if (r.why) { ui.toast(r.why, 'warn'); return }
  done.value = { result: r.result, lines: r.lines }
  next.value = ''
}
const reason = computed(() => (preview.value ? preview.value.block : '先選要換上去的零件。'))
</script>

<template>
  <div class="swp">
    <div class="cr">
      <aside class="panel cut pad"><p class="h">成品</p><ProductList v-model="uid" /></aside>
      <section class="panel cut pad" data-swap-slots>
        <template v-if="detail">
          <p class="h">{{ detail.info.bp.name }}的零件<Hint title="換零件">點一個位置，再從右邊選要換上去的零件。換下來的零件回背包（生體的換下來就死）；空的選配槽也可以裝一個。</Hint></p>
          <button v-for="r in rows" :key="r.key" type="button" class="lrow sr" :class="{ on: r.key === rowKey }" :data-swap-row="r.key" @click="rowKey = r.key">
            <ItemSlot :item="r.part ? { id: r.part.id, name: r.part.name, grade: gradeOf(r.part.grade), icon: partIcon(r.type) } : null" :slot-icon="partIcon(r.type)" size="sm" inert />
            <span class="grow"><b>{{ partTypeName(r.type) }}<template v-if="r.index > 0"> 第 {{ r.index + 1 }} 個</template></b><small>{{ r.part ? `${r.part.name}・${r.part.brand}・${MATERIAL_NAME[r.part.material] ?? r.part.material}` : '空' }}</small></span>
            <span class="tag" :class="{ warn: r.required && !r.part }">{{ r.required ? '必要' : '選配' }}</span>
          </button>
        </template>
        <div v-else class="empty-note">先選一件成品。</div>
      </section>
      <aside class="panel cut pad">
        <p class="h">換上去的零件</p>
        <PartList v-if="detail && row" :blueprint="detail.info.bp.id" :type="row.type" :picked="next ? [next] : []" @pick="(k) => (next = next === k ? '' : k)" />
        <div v-else class="empty-note">先選一個位置。</div>
      </aside>
    </div>

    <section v-if="detail" class="panel cut pad pv" data-swap-preview>
      <div class="pvg">
        <div>
          <p class="h">換之前與換之後</p>
          <template v-if="preview && preview.before && preview.after">
            <div class="kv"><span>換掉</span><b data-old>{{ preview.old ? preview.old.name : '（空的槽）' }}</b></div>
            <div class="kv"><span>換上</span><b data-next>{{ preview.next?.name }}<template v-if="preview.next?.overspec">（超規）</template></b></div>
            <div v-for="r in diff" :key="r.key" class="kv" :data-diff-stat="r.key"><span>{{ r.name }}</span><b class="mono">{{ r.before }} → {{ r.after }}<template v-if="r.delta !== 0">（{{ signed(r.delta) }}）</template></b></div>
            <div class="kv"><span>價錢</span><b class="mono" data-price><MoneyTag kind="acc" :amount="preview.before.price" /> → <MoneyTag kind="acc" :amount="preview.after.price" /></b></div>
            <div class="kv"><span>重量</span><b class="mono">{{ weightText(preview.before.weight) }} → {{ weightText(preview.after.weight) }}</b></div>
            <div class="kv"><span>合法性</span><b>{{ legalName(preview.before.legal) }} → {{ legalName(preview.after.legal) }}</b></div>
            <div class="kv"><span>牌子</span><b>{{ preview.before.brands.length }} → {{ preview.after.brands.length }} 個</b></div>
          </template>
          <div v-else class="empty-note" data-swap-hint>選好位置與零件才看得到數字。</div>
        </div>
        <div>
          <p class="h">難度與誰來做</p>
          <CrewPicker v-model="byId" />
          <MakerPicker v-model="makerId" :options="makers" :only="['self', 'shop']" />
          <template v-if="preview?.difficulty">
            <div class="kv"><span>難度</span><b class="mono" data-dc>DC {{ preview.difficulty.total }}</b></div>
            <div v-for="l in preview.difficulty.lines" :key="l.id" class="kv sub" :data-diff="l.id"><span>{{ l.label }}</span><b class="mono">{{ l.value > 0 && l.id !== 'grade' ? `+${l.value}` : l.value }}</b></div>
          </template>
          <template v-if="preview?.check">
            <div class="kv"><span>{{ preview.check.skillName }}加值</span><b class="mono">{{ preview.check.bonus >= 0 ? '+' : '' }}{{ preview.check.bonus }}</b></div>
            <div class="kv"><span>成功率</span><b class="mono" data-success>{{ pct(preview.check.success) }}</b></div>
            <div class="odds"><span v-for="d in DEGREE_LABEL" :key="d.id" class="tag">{{ d.name }} {{ pct(preview.check.odds[d.id]) }}</span></div>
            <div class="k">失敗會多一個瑕疵，大失敗燒掉新的零件、成品不變。</div>
          </template>
          <template v-if="preview">
            <div class="kv"><span>工錢</span><b data-fee><template v-if="preview.fee > 0"><MoneyTag :kind="preview.pay === 'cash' ? 'cash' : 'acc'" :amount="preview.fee" />{{ preview.pay ? `（付${POOL_NAME[preview.pay]}）` : '' }}</template><template v-else>不要錢</template></b></div>
            <div v-if="preview.fee > 0" class="kv"><span>付哪一種</span><b><select v-model="payWith" class="sel" aria-label="付哪一種錢"><option value="auto">先帳戶、不夠再現金</option><option value="cred">帳戶</option><option value="cash">現金</option></select></b></div>
            <div class="kv"><span>時間</span><b>{{ minutesText(preview.minutes) }}</b></div>
          </template>
        </div>
      </div>
      <ul v-if="preview?.problems.length" class="problems" data-problems><li v-for="(p, i) in preview.problems" :key="i" class="blocking">{{ p }}</li></ul>
      <div class="go"><ReasonButton pri :reason="reason" data-swap @go="swap">換零件</ReasonButton></div>
    </section>
    <ResultNote v-if="done" :result="done.result" :lines="done.lines" />
  </div>
</template>

<style scoped>
.cr { display: grid; grid-template-columns: 260px minmax(0, 1fr) 320px; gap: var(--space-4); align-items: start; }
.sr { margin-bottom: 5px; }
.sr :deep(.slot) { width: 40px; flex: none; }
.pv { margin-top: var(--space-4); }
.pvg { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); gap: var(--space-5); }
.kv.sub { padding-left: var(--space-4); font-size: var(--fs-fine); }
.odds { display: flex; gap: 5px; flex-wrap: wrap; margin: 4px 0; }
.problems { list-style: none; margin: var(--space-3) 0 0; padding: 0; display: grid; gap: 4px; }
.sel { background: var(--bg-term); color: var(--ink); border: 0; box-shadow: inset 0 0 0 2px var(--line); padding: 5px 8px; font: 700 var(--fs-sm) var(--font); max-width: 100%; }
@media (max-width: 1100px) { .cr { grid-template-columns: 240px minmax(0, 1fr); } .cr > :last-child { grid-column: 1 / -1; } }
@media (max-width: 720px) { .cr { grid-template-columns: minmax(0, 1fr); } .pvg { grid-template-columns: 1fr; } }
</style>
