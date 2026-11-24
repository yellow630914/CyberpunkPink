<script setup lang="ts">
import { computed, reactive, ref, watch } from 'vue'
import Dialog from '../components/Dialog.vue'
import Hint from '../components/Hint.vue'
import ItemSlot from '../components/ItemSlot.vue'
import ReasonButton from '../components/ReasonButton.vue'
import MoneyTag from '../components/MoneyTag.vue'
import { useGame } from '../stores/game'
import { useUi } from '../stores/ui'
import { useEngine } from '../stores/engine'
import { ITEMS } from '../data/items'
import { EQUIP_SLOTS } from '../data/character'
import type { EquipSlotId, ItemDef } from '../data/types'
import { PALETTE, hexOf, colorName, defaultDye, currentDye, dyeCost, dyePhrase, dyeable, DYE_PRICE, type Dye, type DyeWhere } from '../lib/dye'

/**
 * 染色（對話框，EQUIPMENT 第 9 節）：選一件武器、衣服、護甲、飾品或 SKIN，換主色調與副色調。
 * 從背包的物品、角色的裝備格、槍店與修車廠的「烤漆與染色」、家裡的工作間、內海分頁的 SKIN 打開。
 * 純外觀：不改數值；顏色寫進外觀描述。
 */
const props = defineProps<{ entryId: number; stacked?: boolean; dyeKey?: string; where?: DyeWhere; place?: string }>()
const g = useGame()
const ui = useUi()
const eng = useEngine()
const where = computed<DyeWhere>(() => props.where ?? 'shop')
const WHERE_NAME: Record<DyeWhere, string> = { shop: '店家代染', home: '在家的工作台自己染', net: '內海的化身編輯' }

/** 能染的東西：穿著的每一格、背包裡的每一疊、內海的 SKIN */
interface Target { key: string; def: ItemDef; label: string }
const targets = computed<Target[]>(() => {
  if (where.value === 'net') return (eng.deck.view()?.skins ?? []).filter(s => ITEMS[s.item]).map(s => ({ key: `skin:${s.item}`, def: ITEMS[s.item], label: s.worn ? 'SKIN・穿著' : 'SKIN' }))
  const out: Target[] = []
  for (const s of EQUIP_SLOTS) { const id = g.equip[s.id as EquipSlotId]; if (id && dyeable(ITEMS[id])) out.push({ key: `slot:${s.id}`, def: ITEMS[id], label: `穿著・${s.name}` }) }
  for (const st of g.inventory) if (!st.unknown && ITEMS[st.def] && dyeable(ITEMS[st.def])) out.push({ key: `uid:${st.uid}`, def: ITEMS[st.def], label: st.qty > 1 ? `背包・${st.qty} 件一起染` : '背包' })
  return out
})
const selKey = ref(props.dyeKey ?? targets.value[0]?.key ?? '')
const target = computed(() => targets.value.find(t => t.key === selKey.value) ?? null)
const def = computed(() => (target.value ? defaultDye(target.value.def) : null))
const before = computed(() => (target.value ? currentDye(target.value.def, g.dyes[target.value.key]) : null))
const draft = reactive<Dye>({ primary: 'dye_gray', secondary: 'dye_black' })
watch(before, b => { if (b) Object.assign(draft, b) }, { immediate: true })
const cost = computed(() => (before.value && def.value ? dyeCost(before.value, draft, def.value, where.value) : 0))
const changed = computed(() => !!before.value && (draft.primary !== before.value.primary || draft.secondary !== before.value.secondary))
const reason = computed(() => (!target.value ? '先選一件。' : !changed.value ? '顏色沒有變。' : g.money.cash < cost.value ? `現金不夠：要 ${cost.value}。` : null))
const ROWS: Array<{ k: keyof Dye; name: string; hint: string }> = [
  { k: 'primary', name: '主色調', hint: '整件的主要顏色：外殼、布料、槍身。' },
  { k: 'secondary', name: '副色調', hint: '滾邊、配件、握把、扣環與接縫的顏色。' },
]
function apply() {
  const t = target.value!, d = def.value!
  g.money.cash -= cost.value
  g.setDye(t.key, draft.primary === d.primary && draft.secondary === d.secondary ? null : { ...draft })
  g.addLog({ prose: [`你把${t.def.name}染成${colorName(draft.primary)}，配${colorName(draft.secondary)}。`], changes: cost.value ? [{ text: `現金 −${cost.value}`, kind: 'minus' }] : [] })
  ui.toast(`${t.def.name}換好顏色了。`)
}
function reset() { if (def.value) Object.assign(draft, def.value) }
</script>

<template>
  <Dialog :entry-id="entryId" :stacked="stacked" title="染色" :sub="`${place ?? WHERE_NAME[where]}・主色調與副色調`" size="lg">
    <template #header>
      <Hint title="染色">武器、衣服、護甲、飾品與內海的 SKIN 都可以染兩個顏色：主色調與副色調。純外觀，不改任何數值；顏色寫進外觀描述，正文會提到。店家代染每改一個顏色 {{ DYE_PRICE.shop }}，在家的工作台自己染每個顏色一份染料 {{ DYE_PRICE.home }}，內海的 SKIN 不要錢；換回目錄上的預設顏色不要錢。</Hint>
    </template>
    <div v-if="!targets.length" class="empty-note">身上與背包裡沒有可以染的東西。</div>
    <div v-else class="dye">
      <div class="pick">
        <p class="h">選一件</p>
        <div class="tgrid">
          <button v-for="t in targets" :key="t.key" type="button" class="tg" :class="{ on: t.key === selKey }" :data-dye-target="t.key" @click="selKey = t.key">
            <ItemSlot :item="t.def" size="sm" inert :dye="g.dyes[t.key] ?? null" />
            <span class="grow"><b>{{ t.def.name }}</b><small>{{ t.label }}</small></span>
          </button>
        </div>
      </div>
      <section v-if="target && before && def" class="panel cut pad edit">
        <div class="prev">
          <ItemSlot :item="target.def" size="lg" inert :dye="draft" />
          <div>
            <div class="k">{{ target.def.type }}・{{ target.def.brand }}</div>
            <h3>{{ target.def.name }}</h3>
            <p class="t-fine">外觀描述：{{ dyePhrase(target.def.name, draft) }}。</p>
          </div>
        </div>
        <div v-for="r in ROWS" :key="r.k" class="row">
          <p class="h">{{ r.name }}<Hint :text="r.hint" /><span class="cur"><i :style="{ background: hexOf(draft[r.k]) }" />{{ colorName(draft[r.k]) }}</span></p>
          <div class="sw" role="radiogroup" :aria-label="r.name">
            <button v-for="s in PALETTE" :key="s.id" type="button" role="radio" class="swatch" :class="{ on: draft[r.k] === s.id }" :aria-checked="draft[r.k] === s.id" :title="s.name" :aria-label="`${r.name}：${s.name}`" :style="{ background: s.hex }" :data-swatch="`${r.k}:${s.id}`" @click="draft[r.k] = s.id" />
            <label class="custom" :title="`${r.name}：自訂顏色`"><input type="color" :value="hexOf(draft[r.k]).toLowerCase()" :aria-label="`${r.name}：自訂顏色`" @input="draft[r.k] = (($event.target as HTMLInputElement).value).toUpperCase()"><span>自訂</span></label>
          </div>
        </div>
        <div class="kv"><span>目錄上的預設</span><b><i class="dot" :style="{ background: hexOf(def.primary) }" />{{ colorName(def.primary) }}・<i class="dot" :style="{ background: hexOf(def.secondary) }" />{{ colorName(def.secondary) }}</b></div>
        <div class="kv"><span>要付</span><b><MoneyTag kind="cash" :amount="cost" /></b></div>
        <div class="go">
          <button type="button" class="btn sm" @click="reset">換回預設</button>
          <ReasonButton sm pri :reason="reason" data-dye-apply @go="apply">染</ReasonButton>
        </div>
      </section>
    </div>
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
.row .h { margin-bottom: var(--space-2); }
.cur { display: inline-flex; align-items: center; gap: 6px; margin-left: var(--space-3); font-size: var(--fs-label); color: var(--ink-2); font-weight: 800; }
.cur i, .dot { display: inline-block; width: 14px; height: 14px; border-radius: 4px; box-shadow: inset 0 0 0 1px #0006; vertical-align: -2px; margin-right: 4px; }
.sw { display: flex; flex-wrap: wrap; gap: 6px; align-items: center; }
.swatch { width: 30px; height: 30px; border-radius: 6px; border: 0; cursor: pointer; box-shadow: inset 0 0 0 1px #0006; }
.swatch.on { box-shadow: 0 0 0 2px var(--bg-1), 0 0 0 4px var(--a); }
.custom { display: inline-flex; align-items: center; gap: 4px; font-size: var(--fs-label); font-weight: 800; color: var(--ink-2); cursor: pointer; }
.custom input { width: 34px; height: 30px; padding: 0; border: 0; background: none; cursor: pointer; }
@media (max-width: 900px) { .dye { grid-template-columns: 1fr; } }
</style>
