<script setup lang="ts">
import { computed } from 'vue'
import Hint from '../Hint.vue'
import MoneyTag from '../MoneyTag.vue'
import OwnedList from './OwnedList.vue'
import { useEngine } from '../../stores/engine'
import { useUi } from '../../stores/ui'
import { unavailable } from '../../lib/unavailable'
import type { CreationDraft, OwnedItem } from '@engine/src/features/creation'

/**
 * 建角第 9 步：錢與裝備（CHARACTER 5.4 節）。可以買的東西、一件幾點、擋住的原因、沒花完的點數換多少現金都是引擎的（creationSummary 與 askStep）；
 * 出身白給的與已選的列在側欄的「身上已經有的」，同類同位置的東西在清單上標「已經有」。只編排，沒有規則。
 */
const props = defineProps<{ draft: CreationDraft; gear: Array<{ id: string; qty?: number }> }>()
const emit = defineEmits<{ (e: 'update:gear', v: Array<{ id: string; qty?: number }>): void }>()
const eng = useEngine()
const ui = useUi()

const summary = computed(() => eng.creation.summary(props.draft))
const blocks = computed(() => eng.creation.stepBlocks(props.draft, 'gear'))
const owned = computed(() => summary.value.owned)

interface Card { id: string; name: string; desc: string; grade: number; kind: string; points: number; slots: string[]; category: string; /** 這個出身現在買不得的原因（引擎的目錄） */ block: string | null }
const ROMAN = ['', 'I', 'II', 'III', 'IV', 'V']
const KIND_NAME: Record<string, string> = { weapon: '武器', armor: '護甲', clothing: '服裝', accessory: '飾品', tool: '工具', consumable: '消耗品', ammo: '彈藥', construct: '構裝', skin: 'SKIN', deck: '甲板', cyberware: '甲板', blueprint: '設計圖', misc: '雜物' }
/** 買得到什麼、分四組、依等級與價錢排好：引擎的 creationCatalog（各功能回答；GEAR_GROUPS 的順序） */
const groups = computed(() => eng.creation.catalog(props.draft).gear.map((g) => ({
  cat: g.group,
  cards: g.rows.map((r): Card => ({ id: r.id, name: r.name, desc: r.desc, grade: r.grade, kind: KIND_NAME[r.category] ?? r.category, points: r.points, slots: r.slots ?? [], category: r.category, block: r.block })),
})))

const qtyOf = (id: string) => { const g = props.gear.find((x) => x.id === id); return g ? g.qty ?? 1 : 0 }
/** 同類同位置已經有的（白給的或已選的）：服裝、護甲、甲板同類只穿一件；有部位的看部位重疊 */
const WEARABLE = new Set(['clothing', 'armor', 'deck'])
function haveOf(c: Card): OwnedItem | null {
  return owned.value.find((o) => o.id !== c.id && (c.slots.length && o.slots?.length ? o.category === c.category && c.slots.some((s) => o.slots!.includes(s)) : WEARABLE.has(c.category) && o.category === c.category)) ?? null
}
const addDraft = (id: string): CreationDraft => ({ ...props.draft, gear: nextGear(id, +1) })
function nextGear(id: string, d: 1 | -1): Array<{ id: string; qty?: number }> {
  const cur = qtyOf(id)
  const now = cur + d
  if (cur === 0) return now > 0 ? [...props.gear, { id, qty: now }] : props.gear
  if (now <= 0) return props.gear.filter((g) => g.id !== id)
  return props.gear.map((g) => (g.id === id ? { id, qty: now } : g))
}
const cardById = (id: string): Card | undefined => groups.value.flatMap((g) => g.cards).find((c) => c.id === id)
const addBlock = (id: string) => cardById(id)?.block ?? eng.creation.addBlock(props.draft, addDraft(id), 'gear')
function add(id: string) {
  const why = addBlock(id)
  if (why) { ui.toast(why, 'warn'); return }
  emit('update:gear', nextGear(id, +1))
}
function remove(id: string) { emit('update:gear', nextGear(id, -1)) }

/** 出身的建議組合：引擎的 suggestedKit（照點數裁過）；超過點數而裁掉的引擎說是哪幾件 */
const kit = computed(() => eng.creation.suggested(props.draft))
const trimmedNote = computed(() => (kit.value.trimmed.length ? `點數放不下，沒有放進去的：${kit.value.trimmed.map((id) => groups.value.flatMap((g) => g.cards).find((c) => c.id === id)?.name ?? id).join('、')}。` : ''))
function suggest() { emit('update:gear', kit.value.gear.map((g) => ({ ...g }))) }
const chosen = computed(() => props.gear.map((g) => ({ ...g, card: cardById(g.id) })).filter((g) => g.card))
</script>

<template>
  <div class="gr" data-gear-step>
    <h2>錢與裝備・剩 {{ summary.gear.left }}／{{ summary.gear.total }} 點</h2>
    <p class="setgrp">只能買 I～II 級<Hint>一件的點數、能買哪些類別、哪些出身才買得到，都由引擎算；不能買義體（義體走上一步的點數）、藥、成人道具。出身另外白給的列在右邊最上面。</Hint></p>
    <div v-if="kit.has" class="go left"><button type="button" class="btn sm pri" data-act="suggest" @click="suggest">出身的建議組合</button><small v-if="trimmedNote" class="why" data-kit-trimmed>{{ trimmedNote }}</small></div>
    <div class="cols">
      <div>
        <template v-for="g in groups" :key="g.cat">
          <p class="h">{{ g.cat }}</p>
          <div class="grid2">
            <div v-for="c in g.cards" :key="c.id" class="lrow pick" :class="{ on: qtyOf(c.id) > 0, 'is-unavailable': !!addBlock(c.id) && qtyOf(c.id) === 0 }" :title="(qtyOf(c.id) === 0 && addBlock(c.id)) || undefined" :data-gear="c.id">
              <span class="grow"><b>{{ c.name }}</b><small>{{ c.kind }}・{{ ROMAN[c.grade] }}<template v-if="qtyOf(c.id)">・已選 ×{{ qtyOf(c.id) }}</template></small>
                <small v-if="haveOf(c)" class="have" data-have>已經有：{{ haveOf(c)!.name }}（{{ haveOf(c)!.from === 'kit' ? '出身白給的' : '這一次選的' }}）</small>
                <small v-if="qtyOf(c.id) === 0 && addBlock(c.id)" class="why" data-why>{{ addBlock(c.id) }}</small></span>
              <b class="pt mono" data-points>{{ c.points }} 點</b>
              <button type="button" class="btn sm" v-bind="unavailable(qtyOf(c.id) === 0 ? addBlock(c.id) : null)" :data-add="c.id" @click="add(c.id)">買</button>
            </div>
          </div>
        </template>
      </div>
      <aside class="panel cut pad side">
        <div class="kv"><span>裝備點數</span><b data-left>剩 {{ summary.gear.left }}／{{ summary.gear.total }}</b></div>
        <div class="kv"><span>沒花完換的現金</span><b data-cash>C${{ summary.gear.cash }}</b></div>
        <div class="kv"><span>起始的錢（含義體點數換的）</span><b data-money><MoneyTag kind="cash" :amount="summary.money.total" /></b></div>
        <OwnedList :owned="owned" />
        <p class="h">已選</p>
        <div v-if="!chosen.length" class="empty-note">還沒選。點左邊的物品加進來。</div>
        <div v-for="g in chosen" :key="g.id" class="lrow" data-chosen><span class="grow"><b>{{ g.card!.name }}</b><small>{{ g.card!.points }} 點<template v-if="(g.qty ?? 1) > 1"> ×{{ g.qty }}</template></small></span><button type="button" class="btn sm ghost" :aria-label="`拿掉${g.card!.name}`" @click="remove(g.id)">✕</button></div>
      </aside>
    </div>
    <div v-if="blocks.length" class="blocking" data-gear-block>{{ blocks[0] }}</div>
  </div>
</template>

<style scoped>
.cols { display: grid; grid-template-columns: minmax(0, 1fr) 300px; gap: var(--space-5); align-items: start; }
.pick small { display: block; color: var(--ink-3); font-size: var(--fs-fine); }
.pick .have { color: var(--ram); }
.pick .why { color: var(--warn); }
.pt { font-size: var(--fs-sm); color: var(--ap); white-space: nowrap; }
.side { display: grid; gap: var(--space-2); align-content: start; }
.go.left { justify-content: flex-start; margin: 0 0 var(--space-3); }
@media (max-width: 900px) { .cols { grid-template-columns: minmax(0, 1fr); } }
</style>
