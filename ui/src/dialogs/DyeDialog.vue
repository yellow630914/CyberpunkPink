<script setup lang="ts">
import { computed, reactive, ref, watch } from 'vue'
import Dialog from '../components/Dialog.vue'
import Hint from '../components/Hint.vue'
import ItemSlot from '../components/ItemSlot.vue'
import ReasonButton from '../components/ReasonButton.vue'
import MoneyTag from '../components/MoneyTag.vue'
import { useUi } from '../stores/ui'
import { useEngine } from '../stores/engine'
import { DEFAULT_SKIN_DYE, PALETTE, bpIcon, colorName, dyeOfColors, gradeOf, hexOf, minutesText, type Dye } from '../lib/craftView'

/**
 * 染色（對話框，EQUIPMENT 第 9 節）：選一件組好的武器或護甲，換主色調與副色調。純外觀，不改數值。
 * 價錢、時間、能不能染（要在店家或住處、現金與染料夠不夠）全部是引擎的 dyeDraft；顏色存在那一件的資料裡，穿上脫下都跟著。
 * 從背包的成品、槍店與修車廠的「烤漆與染色」、家裡工作間的「自己染色」打開。
 * 內海的 SKIN 也走同一個引擎草稿（uid 寫 SKIN 的 id；不要錢、不花時間、哪裡都行，顏色記在那個人身上）。
 */
const props = defineProps<{ entryId: number; stacked?: boolean; where?: 'shop' | 'home' | 'net'; place?: string; uid?: string }>()
const ui = useUi()
const eng = useEngine()

// ---- 引擎的成品與 SKIN（SKIN 的 uid 就是它的 id；引擎的 dyeOf／dyeDraft 兩種都收） ----
interface Target { uid: string; name: string; sub: string; grade: number; icon: string | undefined; skin: boolean }
const targets = computed<Target[]>(() => {
  const made = eng.craft.products().flatMap((stack) => {
    const d = eng.craft.detail(stack)
    return d && d.info.bp.kind !== 'cyberware' ? [{ uid: stack.data!.uid as string, name: d.info.bp.name, sub: d.info.bp.brand, grade: d.info.bp.grade, icon: bpIcon(d.info.bp.kind), skin: false }] : []
  })
  const skins = (eng.deck.view()?.skins ?? []).map((s) => ({ uid: s.item, name: s.name, sub: s.worn ? 'SKIN・穿著' : 'SKIN', grade: 1, icon: 'ic-skin', skin: true }))
  return props.where === 'net' ? [...skins, ...made] : [...made, ...skins]
})
const selUid = ref(props.uid ?? targets.value[0]?.uid ?? '')
const target = computed(() => targets.value.find((p) => p.uid === selUid.value) ?? null)
const by = ref<'shop' | 'self'>(props.where === 'home' ? 'self' : 'shop')
const current = computed(() => (selUid.value ? eng.dye.colorsOf(selUid.value) : undefined))
const draft = reactive<Dye>({ ...DEFAULT_SKIN_DYE })
const touched = reactive({ primary: false, secondary: false })
watch([selUid, current], () => {
  const c = dyeOfColors(current.value)
  Object.assign(draft, c ?? DEFAULT_SKIN_DYE)
  touched.primary = false
  touched.secondary = false
}, { immediate: true })
function pick(k: keyof Dye, v: string) { draft[k] = v; touched[k] = true }
const opts = computed(() => ({
  uid: selUid.value, by: by.value,
  ...(touched.primary && draft.primary !== current.value?.primary_color ? { primary_color: draft.primary } : {}),
  ...(touched.secondary && draft.secondary !== current.value?.secondary_color ? { secondary_color: draft.secondary } : {}),
}))
const quote = computed(() => (selUid.value ? eng.dye.quote(opts.value) : null))
const rules = computed(() => eng.dye.rules())
function apply() {
  const r = eng.dye.apply(opts.value)
  if (r.why) ui.toast(r.why, 'warn')
  else ui.toast(r.lines[0] ?? `${target.value?.name}換好顏色了。`)
}
function resetToFactory() {
  const r = eng.dye.apply({ uid: selUid.value, by: by.value, primary_color: null, secondary_color: null })
  if (r.why) ui.toast(r.why, 'warn')
  else ui.toast(r.lines[0] ?? '換回了出廠的顏色。')
}

const ROWS: Array<{ k: keyof Dye; name: string; hint: string }> = [
  { k: 'primary', name: '主色調', hint: '整件的主要顏色：外殼、布料、槍身。' },
  { k: 'secondary', name: '副色調', hint: '滾邊、配件、握把、扣環與接縫的顏色。' },
]
const dyeShown = computed<Dye | null>(() => dyeOfColors(current.value))
</script>

<template>
  <Dialog :entry-id="entryId" :stacked="stacked" title="染色" :sub="`${place ?? (target?.skin ? '內海的化身編輯' : by === 'self' ? '在家的工作台自己染' : '店家代染')}・主色調與副色調`" size="lg">
    <template #header>
      <Hint title="染色">組好的武器與護甲可以染兩個顏色：主色調與副色調。純外觀，不改任何數值；顏色寫進外觀描述，正文會提到。店家代染每改一個顏色 {{ rules.shopPrice }}（現金）、要等 {{ minutesText(rules.shopMinutes) }}，要站在槍店、修車廠或服飾店；自己染要在住處，每個顏色用掉一份染料、花 {{ minutesText(rules.selfMinutes) }}。換回出廠的顏色不要錢、哪裡都行。內海的 SKIN 不要錢、哪裡都能染。</Hint>
    </template>

    <template v-if="true">
      <div v-if="!targets.length" class="empty-note" data-no-dye>背包裡沒有組好的武器、護甲或 SKIN 可以染。</div>
      <div v-else class="dye">
        <div class="pick">
          <p class="h">選一件</p>
          <div class="tgrid">
            <button v-for="t in targets" :key="t.uid" type="button" class="tg" :class="{ on: t.uid === selUid }" :data-dye-target="t.uid" @click="selUid = t.uid">
              <ItemSlot :item="{ id: t.uid, name: t.name, grade: gradeOf(t.grade), ...(t.icon ? { icon: t.icon } : {}) }" size="sm" inert :dye="dyeOfColors(eng.dye.colorsOf(t.uid))" />
              <span class="grow"><b>{{ t.name }}</b><small>{{ t.sub }}</small></span>
            </button>
          </div>
        </div>
        <section v-if="target" class="panel cut pad edit" data-dye-edit>
          <div class="prev">
            <ItemSlot :item="{ id: target.uid, name: target.name, grade: gradeOf(target.grade), ...(target.icon ? { icon: target.icon } : {}) }" size="lg" inert :dye="draft" />
            <div><div class="k">{{ target.sub }}</div><h3>{{ target.name }}</h3><p v-if="dyeShown" class="t-fine" data-current>現在：{{ colorName(dyeShown.primary) }}，配{{ colorName(dyeShown.secondary) }}。</p><p v-else class="t-fine">還沒染過，是出廠的顏色。</p></div>
          </div>
          <div v-if="!target.skin" class="who" role="radiogroup" aria-label="誰來染">
            <button type="button" role="radio" class="wb" :class="{ on: by === 'shop' }" :aria-checked="by === 'shop'" data-by="shop" @click="by = 'shop'">店家代染</button>
            <button type="button" role="radio" class="wb" :class="{ on: by === 'self' }" :aria-checked="by === 'self'" data-by="self" @click="by = 'self'">自己染</button>
          </div>
          <div v-for="r in ROWS" :key="r.k" class="row">
            <p class="h">{{ r.name }}<Hint :text="r.hint" /><span class="cur"><i :style="{ background: hexOf(draft[r.k]) }" />{{ colorName(draft[r.k]) }}</span></p>
            <div class="sw" role="radiogroup" :aria-label="r.name">
              <button v-for="s in PALETTE" :key="s.id" type="button" role="radio" class="swatch" :class="{ on: draft[r.k] === s.id }" :aria-checked="draft[r.k] === s.id" :title="s.name" :aria-label="`${r.name}：${s.name}`" :style="{ background: s.hex }" :data-swatch="`${r.k}:${s.id}`" @click="pick(r.k, s.id)" />
              <label class="custom" :title="`${r.name}：自訂顏色`"><input type="color" :value="hexOf(draft[r.k]).toLowerCase()" :aria-label="`${r.name}：自訂顏色`" @input="pick(r.k, (($event.target as HTMLInputElement).value).toUpperCase())"><span>自訂</span></label>
            </div>
          </div>
          <div v-if="quote && !quote.block" class="kv"><span>要付</span><b data-dye-cost><MoneyTag v-if="quote.cash > 0" kind="cash" :amount="quote.cash" /><template v-else>不要錢</template><template v-for="u in quote.uses" :key="u.item">・{{ eng.contentName('item', u.item) ?? u.item }} ×{{ u.qty }}</template></b></div>
          <div v-if="quote && !quote.block" class="kv"><span>時間</span><b data-dye-minutes>{{ minutesText(quote.minutes) }}</b></div>
          <div v-if="quote?.block" class="blocking" data-dye-block>{{ quote.block }}</div>
          <div class="go">
            <button type="button" class="btn sm" data-dye-reset @click="resetToFactory">換回出廠的顏色</button>
            <ReasonButton sm pri :reason="quote?.block ?? null" data-dye-apply @go="apply">染</ReasonButton>
          </div>
        </section>
      </div>
    </template>
  </Dialog>
</template>

<style scoped>
.dye { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1.2fr); gap: var(--space-4); align-items: start; }
.tgrid { display: grid; grid-template-columns: repeat(auto-fit, minmax(min(100%, 220px), 1fr)); gap: var(--space-3); }
.tg { display: flex; gap: var(--space-3); align-items: center; padding: 6px 8px; background: var(--bg-2); border: 0; border-radius: 10px; cursor: pointer; text-align: left; color: var(--ink); max-width: 880px; }
.tg :deep(.slot) { width: 44px; flex: none; }
.tg.on { box-shadow: inset 0 0 0 2px var(--a); }
.tg small { display: block; color: var(--ink-3); font-size: var(--fs-fine); }
.grow { flex: 1; min-width: 0; }
.edit { display: grid; gap: var(--space-4); }
.prev { display: grid; grid-template-columns: 112px minmax(0, 1fr); gap: var(--space-4); align-items: center; }
.prev h3 { margin: 2px 0 4px; }
.who { display: flex; gap: 5px; }
.wb { font-size: var(--fs-sm); font-weight: 800; padding: 6px 12px; background: var(--bg-2); color: var(--ink-3); border: 0; cursor: pointer; border-radius: 6px; }
.wb.on { background: var(--a); color: var(--on-a); }
.row .h { margin-bottom: var(--space-2); }
.cur { display: inline-flex; align-items: center; gap: 6px; margin-left: var(--space-3); font-size: var(--fs-label); color: var(--ink-2); font-weight: 800; }
.cur i { display: inline-block; width: 14px; height: 14px; border-radius: 4px; box-shadow: inset 0 0 0 1px #0006; vertical-align: -2px; }
.sw { display: flex; flex-wrap: wrap; gap: 6px; align-items: center; }
.swatch { width: 30px; height: 30px; border-radius: 6px; border: 0; cursor: pointer; box-shadow: inset 0 0 0 1px #0006; }
.swatch.on { box-shadow: 0 0 0 2px var(--bg-1), 0 0 0 4px var(--a); }
.custom { display: inline-flex; align-items: center; gap: 4px; font-size: var(--fs-label); font-weight: 800; color: var(--ink-2); cursor: pointer; }
.custom input { width: 34px; height: 30px; padding: 0; border: 0; background: none; cursor: pointer; }
@media (max-width: 960px) { .dye { grid-template-columns: 1fr; } }
</style>
