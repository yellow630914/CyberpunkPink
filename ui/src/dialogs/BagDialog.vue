
<script setup lang="ts">
import { computed, ref } from 'vue'
import Dialog from '../components/Dialog.vue'
import ItemSlot from '../components/ItemSlot.vue'
import { dyeable } from '../lib/dye'
import GradeBadge from '../components/GradeBadge.vue'
import Hint from '../components/Hint.vue'
import MoneyTag from '../components/MoneyTag.vue'
import ReasonButton from '../components/ReasonButton.vue'
import { useGame } from '../stores/game'
import { useUi } from '../stores/ui'
import { ITEMS } from '../data/items'
import { EQUIP_SLOTS } from '../data/character'
import type { BagFilter, EquipSlotId, ItemDef, ItemStack } from '../data/types'
import { GRADE_LABEL, GRADE_COLOR_NAME } from '../lib/grade'
import { useRouter } from 'vue-router'

/**
 * 背包（UI.md 3.7 節）：篩選、物品格（等級色＋圖標）、重量、右邊是詳情與操作。
 * 從角色的「換裝」打開時帶 targetSlot：只列能裝到那一格的東西，主要按鈕變成「裝到〈欄位〉」。
 */
const props = defineProps<{ entryId: number; stacked?: boolean; targetSlot?: EquipSlotId }>()
const g = useGame()
const ui = useUi()
const router = useRouter()
const FILTERS: Array<{ id: BagFilter; name: string }> = [
  { id: 'all', name: '全部' }, { id: 'gear', name: '裝備' }, { id: 'cyberware', name: '義體' }, { id: 'part', name: '零件' }, { id: 'blueprint', name: '設計圖' },
  { id: 'consumable', name: '消耗品' }, { id: 'cargo', name: '貨物' }, { id: 'misc', name: '雜物' },
]
const filter = ref<BagFilter>('all')
const selUid = ref<string | null>(null)

const KIND_FILTER: Record<string, BagFilter> = {
  weapon: 'gear', armor: 'gear', clothing: 'gear', accessory: 'gear', cyberware: 'cyberware', part: 'part', blueprint: 'blueprint',
  drug: 'consumable', consumable: 'consumable', ammo: 'consumable', cargo: 'cargo', tool: 'misc', furniture: 'misc', misc: 'misc', construct: 'gear', skin: 'gear',
}
const fitsSlot = (d: ItemDef, s: EquipSlotId) => (Array.isArray(d.slot) ? d.slot.includes(s) : d.slot === s)
const list = computed(() => g.inventory.filter(st => {
  const d = ITEMS[st.def]
  if (props.targetSlot) return fitsSlot(d, props.targetSlot)
  return filter.value === 'all' || KIND_FILTER[d.kind] === filter.value
}))
/** 染色（EQUIPMENT 第 9 節）：要在槍店、修車廠（代染）或家裡的工作間（自己染）；假資料裡從背包直接開，照在家的價錢算 */
const dyeWhere = 'home' as const
const dyeReason = null
const sel = computed<ItemStack | null>(() => g.inventory.find(s => s.uid === selUid.value) ?? list.value[0] ?? null)
const def = computed(() => (sel.value ? ITEMS[sel.value.def] : null))
const slotName = (s: EquipSlotId) => EQUIP_SLOTS.find(x => x.id === s)!.name
const equipTarget = computed<EquipSlotId | null>(() => {
  const d = def.value
  if (!d?.slot) return null
  if (props.targetSlot) return props.targetSlot
  const slots = Array.isArray(d.slot) ? d.slot : [d.slot]
  return slots.find(s => !g.equip[s]) ?? slots[0]
})
const sellHere = computed(() => (def.value ? Math.round(def.value.price * 0.4 * (sel.value?.condition === '二手' ? 0.45 : 1)) : 0))
const weightCap = 24

function doEquip() {
  if (!sel.value || !equipTarget.value) return
  const name = def.value!.name
  g.equipItem(equipTarget.value, sel.value.uid)
  ui.toast(`${name} 裝到了${slotName(equipTarget.value)}。`)
  selUid.value = null
  if (props.targetSlot) ui.close(props.entryId)
}
function drop() {
  if (!sel.value) return
  const name = def.value!.name
  g.removeItem(sel.value.uid, 1)
  ui.toast(`丟掉了一件${name}。`)
}
function useIt() {
  if (!sel.value || !def.value) return
  g.removeItem(sel.value.uid, 1)
  g.addLog({ prose: [`你用掉了一件${def.value.name}。`] })
  ui.toast(`用掉了一件${def.value.name}。`)
}
const reasonEquip = computed(() => (def.value?.kind === 'cyberware' ? '義體要在診所裝，背包裡裝不上去。' : null))
</script>

<template>
  <Dialog :entry-id="entryId" :stacked="stacked" :title="targetSlot ? `背包：換${slotName(targetSlot)}` : '背包'" :sub="`身上 ${g.carriedWeight}／${weightCap} kg`">
    <div class="bag">
      <section class="panel cut pad list">
        <div v-if="!targetSlot" class="filters" role="toolbar" aria-label="篩選">
          <button v-for="f in FILTERS" :key="f.id" type="button" :class="{ on: filter === f.id }" @click="filter = f.id; selUid = null">{{ f.name }}</button>
        </div>
        <div v-if="!list.length" class="empty-note">沒有可以放進這一格的東西。</div>
        <div class="items">
          <ItemSlot v-for="st in list" :key="st.uid" :item="ITEMS[st.def]" :qty="st.qty" :unknown="st.unknown" :dye="g.dyes[`uid:${st.uid}`] ?? null" show-name size="lg" :selected="sel?.uid === st.uid" @select="selUid = st.uid" />
        </div>
        <div class="legendg">
          <span v-for="n in [1, 2, 3, 4, 5] as const" :key="n"><i :style="{ borderColor: `var(--g${n})` }" />{{ GRADE_LABEL[n] }}</span>
          <span><i class="uqi" />獨特</span>
          <Hint title="等級色">物品的邊框、名字與等級標用等級的顏色：I {{ GRADE_COLOR_NAME[1] }}、II {{ GRADE_COLOR_NAME[2] }}、III {{ GRADE_COLOR_NAME[3] }}、IV {{ GRADE_COLOR_NAME[4] }}、V {{ GRADE_COLOR_NAME[5] }}。非制式的獨特物品右上角多一個紫色小標。等級色只用在物品上，金色的 IV 級不代表錢。</Hint>
        </div>
        <hr class="hr">
        <div class="kv"><span>身上的重量<Hint>重量照 EQUIPMENT 第 7 節加總，超過上限時移動與迴避變差。</Hint></span><b class="mono">{{ g.carriedWeight }}／{{ weightCap }} kg</b></div>
        <div class="bar"><b :style="{ width: Math.min(100, (g.carriedWeight / weightCap) * 100) + '%', background: 'var(--ram)' }" /></div>
        <div class="kv"><span>放在家裡</span><b>倉庫 31 件・保險箱 3 件</b></div>
      </section>
      <aside v-if="sel && def" class="panel cut pad det" :style="{ '--gc': sel.unknown ? 'var(--ink-3)' : `var(--g${def.grade})` }">
        <template v-if="sel.unknown">
          <div class="k">未知</div>
          <h3>包著的盒子</h3>
          <div class="chips"><span class="tag">{{ sel.condition }}</span></div>
          <hr class="hr">
          <div class="kv"><span>重量</span><b>{{ def.weight }} kg</b></div>
          <div class="go">
            <ReasonButton sm reason="要在家裡或有鑑定儀的店才能打開。">打開</ReasonButton>
            <ReasonButton sm reason="鑑定要去當舖或鑑定攤。">請人鑑定</ReasonButton>
          </div>
        </template>
        <template v-else>
          <div class="head">
            <ItemSlot :item="def" size="lg" :dye="g.dyes[`uid:${sel.uid}`] ?? null" />
            <div>
              <div class="k">{{ def.type }}・{{ def.brand }}</div>
              <h3>{{ def.name }}</h3>
              <div class="chips">
                <GradeBadge :grade="def.grade" />
                <span class="tag">{{ sel.condition }}</span>
                <span v-if="def.legality !== '自由'" class="tag warn">{{ def.legality }}</span>
                <span v-if="def.unique" class="tag" style="color: var(--uq)">獨特</span>
                <Hint v-if="def.note" :text="def.note" />
              </div>
            </div>
          </div>
          <hr class="hr">
          <div v-for="[k, v] in def.stats ?? []" :key="k" class="kv"><span>{{ k }}</span><b>{{ v }}</b></div>
          <div v-if="def.cyber" class="kv"><span>沉溺成本</span><b>{{ def.cyber.sink }}</b></div>
          <div class="kv"><span>重量</span><b>{{ def.weight }} kg</b></div>
          <div class="kv"><span>目錄價<Hint>全新、四十二番街的價（ITEMS 1.1 節）。實際的售價照區、行情、狀態與折扣算。</Hint></span><MoneyTag kind="acc" :amount="def.price" /></div>
          <div class="kv"><span>這裡賣得到</span><b class="mono">約 {{ sellHere.toLocaleString('en-US') }}</b></div>
          <div class="go">
            <template v-if="def.kind === 'furniture'">
              <button type="button" class="btn sm pri" @click="ui.closeAll(); router.push({ path: '/home', query: { place: sel.uid } })">到家園擺設</button>
            </template>
            <ReasonButton v-else-if="equipTarget" sm pri :reason="reasonEquip" @go="doEquip">裝到{{ slotName(equipTarget) }}</ReasonButton>
            <ReasonButton v-if="['drug', 'consumable'].includes(def.kind)" sm pri @go="useIt">用掉</ReasonButton>
            <ReasonButton v-if="def.kind === 'part' || def.kind === 'weapon'" sm reason="拆解要有工作台：在家的工作間，或組裝店。">拆解</ReasonButton>
            <ReasonButton v-if="dyeable(def)" sm :reason="dyeReason" data-open-dye @go="ui.open('dye', { dyeKey: `uid:${sel.uid}`, where: dyeWhere })">染色</ReasonButton>
            <ReasonButton sm @go="drop">丟掉</ReasonButton>
          </div>
        </template>
      </aside>
    </div>
  </Dialog>
</template>

<style scoped>
.bag { display: grid; grid-template-columns: minmax(0, 1fr) 320px; gap: 12px; min-height: 0; }
.items { display: grid; grid-template-columns: repeat(auto-fill, minmax(92px, 1fr)); gap: 10px; }
.legendg { display: flex; gap: 10px; flex-wrap: wrap; align-items: center; font-size: var(--fs-fine); color: var(--ink-3); margin-top: 10px; }
.legendg i { display: inline-block; width: 10px; height: 10px; border-radius: 3px; margin-right: 4px; vertical-align: -1px; border: 2px solid; }
.legendg .uqi { border-color: var(--uq); background: var(--uq); }
.det h3 { margin: 2px 0 6px; font-size: var(--fs-section); color: var(--gc); }
.head { display: grid; grid-template-columns: 72px 1fr; gap: 12px; align-items: center; }
@media (max-width: 860px) { .bag { grid-template-columns: 1fr; } .items { grid-template-columns: repeat(auto-fill, minmax(78px, 1fr)); } }
</style>
