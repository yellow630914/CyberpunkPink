<script setup lang="ts">
import { computed, ref } from 'vue'
import GradeBadge from '../../components/GradeBadge.vue'
import Hint from '../../components/Hint.vue'
import ItemSlot from '../../components/ItemSlot.vue'
import ReasonButton from '../../components/ReasonButton.vue'
import { useEngine } from '../../stores/engine'
import { useUi } from '../../stores/ui'
import { bagEntries, carriedItem, compositionOf, gearGroups, quickCells, quickClear, quickPut, slotCandidates, weaponLines } from '../../lib/gearView'
import type { GearCell, GearGroupId } from '../../lib/gearView'

/**
 * 角色詳情的「裝備」分頁（UI.md 8.2 節）：穿著 10、飾品 5、攜帶 3、快取格；右欄是外套、護甲、藏匿、掃描。
 * 這裡只編排：讀 store 的 gear、呼叫它的動作；能不能穿、數字多少都是引擎的答案，原因直接顯示引擎寫的那一句。
 */
const props = defineProps<{ select?: { group: GearGroupId; slot: string } | { quick: number } }>()
const eng = useEngine()
const ui = useUi()

type Sel = { kind: 'slot'; group: GearGroupId; slot: string } | { kind: 'quick'; index: number } | null
const sel = ref<Sel>(
  props.select ? ('quick' in props.select ? { kind: 'quick', index: props.select.quick } : { kind: 'slot', group: props.select.group, slot: props.select.slot }) : null,
)

const look = eng.gear.look
const gear = computed(() => eng.gear.of())
const inventory = computed(() => eng.gear.inventory())
const lock = computed(() => eng.gear.lock())
const groups = computed(() => gearGroups(look, inventory.value, gear.value))
const cap = computed(() => eng.gear.quickCapacity())
const quick = computed(() => quickCells(look, gear.value, cap.value))
const quickUsed = computed(() => quick.value.filter((c) => c.item).length)

function say(why: string | null, ok?: string) {
  if (why) ui.toast(why, 'warn')
  else if (ok) ui.toast(ok)
}

// ---- 選到的格 ----
const selCell = computed<GearCell | null>(() => {
  const s = sel.value
  if (!s || s.kind !== 'slot') return null
  return groups.value.find((g) => g.id === s.group)?.cells.find((c) => c.slot === s.slot) ?? null
})
const selEntry = computed(() => (selCell.value?.uid ? carriedItem(look, inventory.value, selCell.value.group, selCell.value.uid) : null))
const selWeapon = computed(() => (selEntry.value?.category === 'weapon' && selEntry.value.what ? eng.gear.weapon(selEntry.value.what) : null))
const candidates = computed(() => {
  const s = sel.value
  if (!s || s.kind !== 'slot') return []
  return slotCandidates(look, inventory.value, s.group, s.slot).map((e) => ({ e, block: eng.gear.equipBlock(e.what!, s.slot) }))
})

function pickCell(c: GearCell) {
  sel.value = { kind: 'slot', group: c.group, slot: c.slot }
}
function wear(what: string, slot: string) {
  const why = eng.gear.equip(what, slot)
  say(why)
}
function takeOff() {
  const what = selEntry.value?.what
  if (!what) return
  say(lock.value ?? eng.gear.unequip(what))
}

// ---- 快取格 ----
const selQuick = computed(() => (sel.value?.kind === 'quick' ? quick.value[sel.value.index] ?? null : null))
const quickChoices = computed(() => bagEntries(look, inventory.value).filter((e) => e.quickable))
function putQuick(itemId: string) {
  if (sel.value?.kind !== 'quick') return
  say(lock.value ?? eng.gear.setQuick(quickPut(gear.value, sel.value.index, itemId)))
}
function clearQuick() {
  if (sel.value?.kind !== 'quick') return
  say(lock.value ?? eng.gear.setQuick(quickClear(gear.value, sel.value.index)))
}

// ---- 右欄：外套、護甲、藏匿、掃描 ----
const armor = computed(() => eng.gear.armor())
const conceal = computed(() => eng.gear.concealment())
const strength = ref(2)
const STRENGTHS = [1, 2, 3]
const carried = computed(() =>
  (groups.value.find((g) => g.id === 'carry')?.cells ?? []).filter((c) => c.uid && c.item).map((c) => ({ uid: c.uid!, name: c.item!.name, slot: c.label })),
)
const found = computed(() => new Set(eng.gear.scanFinds(strength.value)))
const nameOfUid = (uid: string) => carried.value.find((c) => c.uid === uid)?.name ?? uid
function setCoat(coat: 'open' | 'closed') {
  if (gear.value.coat === coat) return
  say(lock.value ?? eng.gear.setCoat(coat))
}
</script>

<template>
  <section class="gear-tab">
    <div class="panel cut pad">
      <div v-if="lock" class="blocking" data-lock>{{ lock }}</div>
      <template v-for="grp in groups" :key="grp.id">
        <p class="h">{{ grp.title }}・{{ grp.cells.length }} 格</p>
        <div class="eqgrid" :data-group="grp.id">
          <ItemSlot v-for="c in grp.cells" :key="c.slot" :item="c.item" :slot-icon="c.icon" :label="c.label" show-name :covered="c.covered" :note="c.covered ? '被外套蓋住' : undefined"
            :selected="sel?.kind === 'slot' && sel.group === c.group && sel.slot === c.slot" :data-slot="c.slot" @select="pickCell(c)" />
        </div>
      </template>
      <p class="h">快取格 <span data-quick-count>{{ quickUsed }}／{{ cap }}</span><Hint title="快取格">戰鬥中只能用這裡的道具（1 點行動點）。一格放一件小東西；快取格只是記著要帶哪些，東西還在背包裡算。</Hint></p>
      <div class="eqgrid" data-group="quick">
        <ItemSlot v-for="q in quick" :key="q.index" :item="q.item" slot-icon="ic-consumable" label="快取" show-name size="sm" :selected="sel?.kind === 'quick' && sel.index === q.index" :data-quick="q.index" @select="sel = { kind: 'quick', index: q.index }" />
      </div>
    </div>

    <aside class="panel cut pad">
      <!-- 選到快取格 -->
      <template v-if="sel?.kind === 'quick'">
        <p class="h">快取格・第 {{ sel.index + 1 }} 格</p>
        <template v-if="selQuick?.item">
          <div class="dh"><ItemSlot :item="selQuick.item" size="md" inert /><div><h3 :style="{ color: `var(--g${selQuick.item.grade})` }">{{ selQuick.item.name }}</h3><GradeBadge :grade="selQuick.item.grade" /></div></div>
        </template>
        <div v-else class="empty-note">這一格是空的。</div>
        <p class="h mt">背包裡能放進來的</p>
        <div v-if="!quickChoices.length" class="empty-note">背包裡沒有消耗品。</div>
        <div class="qgrid">
          <ItemSlot v-for="e in quickChoices" :key="e.key" :item="e.slotItem" :qty="e.qty" size="sm" show-name :unavailable="lock" :data-pick="e.key" @select="putQuick(e.key)" />
        </div>
        <div class="go">
          <ReasonButton sm :reason="lock ?? (selQuick?.item ? null : '這一格是空的。')" @go="clearQuick">清空</ReasonButton>
          <button type="button" class="btn sm" @click="sel = null">回到裝備</button>
        </div>
      </template>

      <!-- 選到一格 -->
      <template v-else-if="selCell">
        <p class="h">{{ selCell.label }}</p>
        <template v-if="selEntry">
          <div class="dh">
            <ItemSlot :item="selEntry.slotItem" size="md" inert />
            <div>
              <div class="k">{{ selEntry.type }}<template v-if="selEntry.brand">・{{ selEntry.brand }}</template></div>
              <h3 :style="{ color: `var(--g${selEntry.grade})` }">{{ selEntry.name }}</h3>
              <div class="chips">
                <GradeBadge :grade="selEntry.grade" />
                <span v-if="selEntry.legal !== '自由'" class="tag warn">{{ selEntry.legal }}</span>
                <span v-if="selCell.covered" class="tag">被外套蓋住</span>
              </div>
            </div>
          </div>
          <div v-for="l in selWeapon ? weaponLines(selWeapon) : []" :key="l.label" class="kv"><span>{{ l.label }}</span><b>{{ l.value }}</b></div>
          <div v-for="(p, i) in compositionOf(look, selEntry.stack)" :key="i" class="kv"><span>{{ p.typeName }}</span><b :style="{ color: `var(--g${p.grade})` }">{{ p.name }}</b></div>
        </template>
        <div v-else class="empty-note">這一格是空的。</div>
        <div class="go"><ReasonButton sm :reason="lock ?? (selEntry ? null : '這一格沒有東西。')" @go="takeOff">脫下</ReasonButton></div>
        <p class="h mt">背包裡放得進{{ selCell.label }}的</p>
        <div v-if="!candidates.length" class="empty-note">背包裡沒有可以放進這一格的東西。</div>
        <div class="qgrid">
          <ItemSlot v-for="c in candidates" :key="c.e.key" :item="c.e.slotItem" :qty="c.e.qty" size="sm" show-name :unavailable="c.block" :data-pick="c.e.key" @select="wear(c.e.what!, selCell.slot)" />
        </div>
      </template>
      <div v-else class="empty-note">點一格看裡面的東西，或從背包換上別的。</div>

      <hr class="hr">
      <p class="h">外套<Hint title="外套">扣上時蓋住護甲、上身與內衣，藏匿量也會變。</Hint></p>
      <div class="seg" role="group" aria-label="外套">
        <button type="button" :class="{ on: gear.coat === 'open' }" data-coat="open" @click="setCoat('open')">敞開</button>
        <button type="button" :class="{ on: gear.coat === 'closed' }" data-coat="closed" @click="setCoat('closed')">扣上</button>
      </div>
      <div class="kv"><span>護甲</span><b data-armor>{{ armor }}</b></div>
      <div class="kv"><span>藏匿量</span><b data-conceal>{{ conceal.capacity }}</b></div>
      <div class="kv"><span>藏著</span><b data-hidden>{{ conceal.hidden.length ? conceal.hidden.map(nameOfUid).join('、') : '沒有' }}</b></div>
      <div class="kv"><span>露出來</span><b data-shown :class="{ 'warn-t': conceal.shown.length }">{{ conceal.shown.length ? conceal.shown.map(nameOfUid).join('、') : '沒有' }}</b></div>
      <p class="h mt">被掃到時<Hint title="掃描強度">強度 1 只掃得到大小 2 以上的；2 以上全部掃。生體件與防掃描的零件掃不到。</Hint></p>
      <div class="seg" role="group" aria-label="掃描強度">
        <button v-for="n in STRENGTHS" :key="n" type="button" :class="{ on: strength === n }" :data-strength="n" @click="strength = n">強度 {{ n }}</button>
      </div>
      <div v-if="!carried.length" class="empty-note">身上沒有帶武器。</div>
      <div v-for="w in carried" :key="w.uid" class="kv" data-scan><span>{{ w.slot }}・{{ w.name }}</span><b :class="{ 'warn-t': found.has(w.uid) }">{{ found.has(w.uid) ? '會被發現' : '掃不到' }}</b></div>
    </aside>
  </section>
</template>

<style scoped>
.gear-tab { display: grid; grid-template-columns: minmax(0, 1fr) 300px; gap: var(--space-4); align-items: start; }
.eqgrid { display: grid; grid-template-columns: repeat(auto-fill, minmax(84px, 1fr)); gap: var(--space-3); margin-bottom: var(--space-5); }
.qgrid { display: grid; grid-template-columns: repeat(auto-fill, minmax(64px, 1fr)); gap: var(--space-3); }
.dh { display: grid; grid-template-columns: 64px 1fr; gap: var(--space-4); align-items: center; margin-bottom: var(--space-3); }
.dh h3 { margin: var(--space-1) 0 var(--space-2); font-size: var(--fs-section); }
.mt { margin-top: var(--space-4); }
.seg { display: inline-flex; gap: 3px; margin-bottom: var(--space-3); }
.seg button { font-size: var(--fs-sm); font-weight: 800; padding: 6px var(--space-4); background: var(--bg-term); color: var(--ink-3); border: 0; cursor: pointer; }
.seg button.on { background: var(--a); color: var(--on-a); }
.warn-t { color: var(--warn); }
@media (max-width: 1100px) { .gear-tab { grid-template-columns: 1fr; } }
@media (max-width: 720px) {
  .eqgrid { grid-template-columns: repeat(3, minmax(0, 1fr)); }
  .qgrid { grid-template-columns: repeat(3, minmax(0, 1fr)); }
}
</style>
