<script setup lang="ts">
import { computed, ref } from 'vue'
import Hint from '../Hint.vue'
import OwnedList from './OwnedList.vue'
import { useEngine } from '../../stores/engine'
import { useUi } from '../../stores/ui'
import { CATEGORY_NAME, CAT_COLOR } from '../../lib/skillView'
import type { Category } from '../../lib/skillView'
import { unavailable } from '../../lib/unavailable'
import type { CreationDraft } from '@engine/src/features/creation'
import type { CatalogRow } from '@engine/src/features/creation'

/**
 * 建角第 6 步：橋與義體（CHARACTER 2.1 節）。列出買得到的橋（含「沒有橋」，選它之前先跳一個說明後果的確認）與義體，
 * 每一件的點數、沉溺成本、部位、擋住的原因都是引擎的（creationSummary 與 askStep 經 stores/engine.ts 的 creation）；
 * 右邊是點數、沉溺的起點、四類容量與「身上已經有的」。只編排，沒有規則。
 */
const props = defineProps<{ draft: CreationDraft; bridge: string | null | undefined; cyber: Array<{ blueprint: string; side?: 'l' | 'r' }>; beastLine: string; hasBeast: boolean }>()
const emit = defineEmits<{
  (e: 'update:bridge', v: string | null | undefined): void
  (e: 'update:cyber', v: Array<{ blueprint: string; side?: 'l' | 'r' }>): void
  (e: 'update:beastLine', v: string): void
}>()
const eng = useEngine()
const ui = useUi()

const summary = computed(() => eng.creation.summary(props.draft))
const blocks = computed(() => eng.creation.stepBlocks(props.draft, 'cyber'))
const owned = computed(() => summary.value.owned)

interface Card { id: string; name: string; brand: string; grade: number; desc: string; part: string; needsSide: boolean; points: number; sink: number; /** 這個出身現在買不得的原因（引擎的目錄） */ block: string | null }
const ROMAN = ['', 'I', 'II', 'III', 'IV', 'V']
/** 買得到什麼是引擎的 creationCatalog（各功能回答、依等級與價錢排好）；沉溺成本與左右是引擎的報價與設計圖 */
const catalog = computed(() => eng.creation.catalog(props.draft))
const cardOf = (row: CatalogRow, isBridge: boolean): Card | null => {
  const bp = eng.creation.blueprint(row.id)
  if (!bp) return null
  const one = eng.creation.lone(props.draft, 'cyber', { blueprint: row.id, ...(bp.needsSide ? { side: 'l' as const } : {}), ...(isBridge ? { bridge: true } : {}) })
  return { id: row.id, name: row.name, brand: row.brand, grade: row.grade, desc: row.desc, part: isBridge ? '橋' : eng.creation.partName(bp.slot, 'l').replace(/^左/, ''), needsSide: bp.needsSide, points: one.points, sink: one.sink, block: row.block }
}
const bridges = computed(() => catalog.value.bridges.map((r) => cardOf(r, true)).filter((c): c is Card => c !== null))
const others = computed(() => catalog.value.cyber.map((r) => cardOf(r, false)).filter((c): c is Card => c !== null))
/** 出身的建議組合（引擎的 suggestedKit）：換成建議的橋與義體；超過點數而裁掉的引擎說是哪幾件 */
const kit = computed(() => eng.creation.suggested(props.draft))
const trimmedNote = ref('')
function useKit() {
  const k = kit.value
  if (!k.has) return
  if (k.bridge !== undefined) emit('update:bridge', k.bridge)
  emit('update:cyber', k.cyber.map((c) => ({ ...c })))
  trimmedNote.value = k.trimmed.length ? `點數放不下，沒有放進去的：${k.trimmed.map((id) => eng.creation.blueprint(id)?.name ?? id).join('、')}。` : ''
}
const beastLines = computed(() => eng.creation.beastLines())

const bridgeOn = (id: string) => props.bridge === id
const sides = (c: Card): Array<'l' | 'r' | undefined> => (c.needsSide ? ['l', 'r'] : [undefined])
const sideName = (s: 'l' | 'r' | undefined) => (s === 'l' ? '左' : s === 'r' ? '右' : '')
const cyberOn = (id: string, side?: 'l' | 'r') => props.cyber.some((c) => c.blueprint === id && (c.side ?? undefined) === side)
const pickOf = (id: string, side?: 'l' | 'r') => ({ blueprint: id, ...(side ? { side } : {}) })

/** 選了或拿掉之後的草稿，問引擎這一次多了什麼原因（已經選的不問：點它是拿掉） */
const bridgeBlock = (id: string) => (bridgeOn(id) ? null : (bridges.value.find((c) => c.id === id)?.block ?? eng.creation.addBlock(props.draft, { ...props.draft, bridge: id }, 'cyber')))
const cyberBlock = (id: string, side?: 'l' | 'r') => (cyberOn(id, side) ? null : (others.value.find((c) => c.id === id)?.block ?? eng.creation.addBlock(props.draft, { ...props.draft, cyber: [...props.cyber, pickOf(id, side)] }, 'cyber')))

function pickBridge(id: string) {
  const why = bridgeBlock(id)
  if (why) { ui.toast(why, 'warn'); return }
  emit('update:bridge', bridgeOn(id) ? undefined : id)
}
function pickCyber(id: string, side?: 'l' | 'r') {
  const why = cyberBlock(id, side)
  if (why) { ui.toast(why, 'warn'); return }
  emit('update:cyber', cyberOn(id, side) ? props.cyber.filter((c) => !(c.blueprint === id && (c.side ?? undefined) === side)) : [...props.cyber, pickOf(id, side)])
}

// ---- 沒有橋：先說後果，再確認 ----
const confirming = ref(false)
const noBridgeNotes = computed(() => eng.creation.noBridgeNotes(props.draft))
function askNoBridge() { if (props.bridge === null) emit('update:bridge', undefined); else confirming.value = true }
function confirmNoBridge() { confirming.value = false; emit('update:bridge', null) }

const CATS: Category[] = ['meat', 'net', 'social', 'media']
const capacity = computed(() => summary.value.capacity)
</script>

<template>
  <div class="cy" data-cyber-step>
    <h2>橋與義體・剩 {{ summary.cyber.left }}／{{ summary.cyber.total }} 點</h2>
    <div class="cols">
      <div>
        <div v-if="kit.has" class="go left"><button type="button" class="btn sm pri" data-act="suggest-cyber" @click="useKit">出身的建議組合</button><small v-if="trimmedNote" class="note-line" data-kit-trimmed>{{ trimmedNote }}</small></div>
        <p class="setgrp">橋・選一座<Hint>橋決定四類技能的容量（現實／內海／社交／媒體）。企業出身才選得到那家企業的橋；也可以不要橋，但要先看過後果。</Hint></p>
        <div class="grid2">
          <button v-for="c in bridges" :key="c.id" type="button" class="lrow pick" :class="{ on: bridgeOn(c.id), 'is-unavailable': !!bridgeBlock(c.id) }" :title="bridgeBlock(c.id) ?? undefined" :data-bridge="c.id" :aria-pressed="bridgeOn(c.id)" @click="pickBridge(c.id)">
            <span class="grow"><b>{{ c.name }}</b><small>{{ c.brand }}・{{ ROMAN[c.grade] }}・沉溺成本 {{ c.sink }}</small><small v-if="c.desc">{{ c.desc }}</small><small v-if="bridgeBlock(c.id)" class="why" data-why>{{ bridgeBlock(c.id) }}</small></span>
            <b class="pt mono" data-points>{{ c.points }}</b>
          </button>
          <button type="button" class="lrow pick" :class="{ on: props.bridge === null }" data-bridge="none" :aria-pressed="props.bridge === null" @click="askNoBridge">
            <span class="grow"><b>沒有橋</b><small>不裝橋：選之前會先說明後果。</small></span><b class="pt mono">0</b>
          </button>
        </div>
        <div v-if="confirming" class="confirm blocking" role="alertdialog" data-confirm-nobridge>
          <p v-for="(n, i) in noBridgeNotes" :key="i">{{ n }}</p>
          <p v-if="!noBridgeNotes.length">沒有橋，就沒有技能的容量。</p>
          <div class="go"><button type="button" class="btn sm" @click="confirming = false">再想想</button><button type="button" class="btn sm pri" data-act="confirm-nobridge" @click="confirmNoBridge">我確定不要橋</button></div>
        </div>

        <p class="setgrp">其他義體<Hint>每一件照常算沉溺的下限：開場改得越多，沉溺的起點越高。手臂與腿要選左右。</Hint></p>
        <div class="grid2">
          <div v-for="c in others" :key="c.id" class="lrow pick" :class="{ on: sides(c).some((s) => cyberOn(c.id, s)) }" :data-cyber="c.id">
            <span class="grow"><b>{{ c.name }}</b><small>{{ c.part }}・{{ c.brand }}・{{ ROMAN[c.grade] }}・沉溺成本 {{ c.sink }}</small><small v-if="c.desc">{{ c.desc }}</small></span>
            <span class="sidebtns">
              <button v-for="s in sides(c)" :key="s ?? 'x'" type="button" class="btn sm" :class="{ pri: cyberOn(c.id, s), 'is-unavailable': !!cyberBlock(c.id, s) }" v-bind="unavailable(cyberBlock(c.id, s))" :data-pick="`${c.id}${s ? ':' + s : ''}`" :aria-pressed="cyberOn(c.id, s)" @click="pickCyber(c.id, s)">{{ cyberOn(c.id, s) ? '拿掉' : '選' }}{{ sideName(s) }}</button>
            </span>
            <b class="pt mono" data-points>{{ c.points }}</b>
          </div>
        </div>
        <label v-if="hasBeast" class="fld beastline"><span>獸化的系<Hint>機械派的系看外形與韌體，生體派的系看基因譜（CULTURE 第 2 節）。寫進外觀，也決定耳朵在什麼情緒下怎麼動。</Hint></span><select :value="beastLine" class="inp" @change="emit('update:beastLine', ($event.target as HTMLSelectElement).value)"><option v-for="k in beastLines" :key="k" :value="k">{{ k }}</option></select></label>
        <div v-if="blocks.length" class="blocking" data-cyber-block>{{ blocks[0] }}</div>
      </div>

      <aside class="panel cut pad side">
        <div class="kv"><span>義體點數</span><b data-left>剩 {{ summary.cyber.left }}／{{ summary.cyber.total }}</b></div>
        <div class="kv"><span>沒花完換的現金</span><b data-cash>C${{ summary.cyber.cash }}</b></div>
        <div class="kv"><span>沉溺的起點<Hint>選的義體的沉溺成本合計；沉溺的下限也是這個數字。</Hint></span><b data-sink>{{ summary.sink }}</b></div>
        <p class="h">橋的容量</p>
        <div class="kv" v-for="c in CATS" :key="c"><span :style="{ color: CAT_COLOR[c] }">{{ CATEGORY_NAME[c] }}</span><b class="mono" :data-cap="c">{{ capacity[c] }}</b></div>
        <p v-if="props.bridge === undefined" class="empty-note">選了橋就看得到四類的容量。</p>
        <p v-for="(n, i) in summary.notes.cyber" :key="i" class="note-line" data-note>{{ n }}</p>
        <OwnedList :owned="owned" />
      </aside>
    </div>
  </div>
</template>

<style scoped>
.cols { display: grid; grid-template-columns: minmax(0, 1fr) 280px; gap: var(--space-5); align-items: start; }
.pick { margin-bottom: 4px; }
.pick small { display: block; color: var(--ink-3); font-size: var(--fs-fine); }
.pick .why { color: var(--warn); }
.pt { font-size: var(--fs-md); color: var(--ap); min-width: 26px; text-align: right; }
.sidebtns { display: inline-flex; gap: var(--space-2); flex: none; }
.confirm { margin: var(--space-4) 0; display: grid; gap: var(--space-3); }
.confirm p { margin: 0; }
.go { display: flex; gap: var(--space-3); flex-wrap: wrap; }
.side { display: grid; gap: var(--space-2); align-content: start; }
.note-line { margin: 0; color: var(--warn); font-size: var(--fs-sm); }
.fld { display: grid; gap: 4px; font-size: var(--fs-sm); font-weight: 800; color: var(--ink-2); }
.beastline { max-width: 320px; margin: var(--space-4) 0; }
.inp { width: 100%; min-width: 0; background: var(--bg-term); color: var(--ink); border: 0; box-shadow: inset 0 0 0 2px var(--line); padding: 8px 10px; font: 600 var(--fs-md) var(--font); }
@media (max-width: 960px) { .cols { grid-template-columns: minmax(0, 1fr); } }
</style>
