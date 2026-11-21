<script setup lang="ts">
import { computed, ref } from 'vue'
import Dialog from '../components/Dialog.vue'
import Tabs from '../components/Tabs.vue'
import Hint from '../components/Hint.vue'
import ReasonButton from '../components/ReasonButton.vue'
import { useGame } from '../stores/game'
import { useSaves } from '../stores/saves'
import { useUi } from '../stores/ui'
import { snapshotUse } from '../lib/save'
import { useGuides } from '../lib/useGuides'

/**
 * 讀檔與存檔（UI 第 15 節、樣稿 docs/mockups/title.html 的「讀檔」「回退與快照」）。
 * 存檔：三個手動格、兩個自動格。匯出與匯入：一份 JSON 檔，匯入時有低於 18 的年齡整筆拒絕。
 * 委託副本的快照（SERIES 第 6 節）：每個階段開始時與每場戰鬥開打前各存一個；重來與回退一律可以。
 */
const props = defineProps<{ entryId: number; stacked?: boolean; tab?: string }>()
const g = useGame()
const sv = useSaves()
const ui = useUi()
useGuides().trigger('g_save')
const tab = ref(props.tab ?? 'slots')
const TABS = [{ id: 'slots', label: '存檔' }, { id: 'io', label: '匯出與匯入' }, { id: 'snap', label: '委託副本的快照' }, { id: 'log', label: '紀錄的回退' }]
const importError = ref<string | null>(null)

function save(i: number) { const e = sv.saveTo(i); ui.toast(e ?? `存到了第 ${i + 1} 格。`, e ? 'warn' : 'info') }
function load(list: 'slots' | 'autos', i: number) { const e = sv.loadFrom(list, i); ui.toast(e ?? '讀回來了。', e ? 'warn' : 'info') }
function exportFile() {
  const blob = new Blob([g.packed('手動')], { type: 'application/json' })
  const a = document.createElement('a')
  a.href = URL.createObjectURL(blob)
  a.download = `cyberpunkpink-第${g.day}天.json`
  a.click()
  setTimeout(() => URL.revokeObjectURL(a.href), 1000)
}
async function importFile(e: Event) {
  const f = (e.target as HTMLInputElement).files?.[0]
  if (!f) return
  const err = sv.loadRaw(await f.text())
  importError.value = err
  if (!err) ui.toast(`讀了「${f.name}」。`)
  ;(e.target as HTMLInputElement).value = ''
}
const snaps = computed(() => [...g.snapshots].reverse())
function useSnap(id: string) {
  const s = g.snapshots.find(x => x.id === id)!
  const u = snapshotUse(g.snapshots, s)
  g.rollback(id)
  ui.toast(`${u.action}：回到${s.label}。紀錄、性經歷記錄與共同記憶留著。`)
}
const fmtTime = (iso?: string) => (iso ? new Date(iso).toLocaleString('zh-TW', { hour12: false }) : '')
</script>

<template>
  <Dialog :entry-id="entryId" :stacked="stacked" title="讀檔與存檔" :sub="`存檔「夜班之後」・第 ${g.day} 天 ${g.timeLabel}`" size="lg">
    <template #header><Tabs v-model="tab" :tabs="TABS" /></template>
    <section class="panel cut pad">
      <template v-if="tab === 'slots'">
        <p class="setgrp">手動存檔<Hint>存檔只存在這台機器的瀏覽器裡；要換機器就用「匯出與匯入」。設定的「存檔」分頁用的是同一組格子。</Hint></p>
        <div v-for="(slot, i) in sv.slots" :key="'m' + i" class="setrow">
          <span class="nm">第 {{ i + 1 }} 格</span>
          <span class="val">{{ slot ? slot.label : '空' }}<small v-if="slot?.savedAt" class="when">{{ fmtTime(slot.savedAt) }}</small></span>
          <span class="segs">
            <button type="button" @click="save(i)">存到這裡</button>
            <ReasonButton sm :reason="slot ? null : '這一格是空的。'" @go="load('slots', i)">讀取</ReasonButton>
          </span>
        </div>
        <p class="setgrp">自動存檔<Hint>長休之後與抵達一個新的區時各存一次，留最近的兩份。</Hint></p>
        <div v-for="(slot, i) in sv.autos" :key="'a' + i" class="setrow">
          <span class="nm">自動 {{ i + 1 }}</span>
          <span class="val">{{ slot ? slot.label : '空' }}</span>
          <span class="segs"><ReasonButton sm :reason="slot ? null : '這一格是空的。'" @go="load('autos', i)">讀取</ReasonButton></span>
        </div>
        <div class="go"><button type="button" class="btn sm" @click="sv.autosave(); ui.toast('自動存了一份。')">現在自動存一次</button></div>
      </template>

      <template v-else-if="tab === 'io'">
        <p class="setgrp">匯出<Hint>匯出的檔案是一份 JSON：存檔的格式標記、版本、摘要與整份狀態。不含這台機器的設定（顯示、AI 來源與金鑰）。</Hint></p>
        <div class="setrow"><span class="nm">這一局</span><span class="val">第 {{ g.day }} 天・{{ g.placeLabel }}</span><button type="button" class="btn sm pri" @click="exportFile">匯出成檔案</button></div>
        <p class="setgrp">匯入<Hint>匯入走同一套檢查：格式不對、版本比這個新、或有任何低於 18 的年齡，整筆不讀，不自動改成 18。</Hint></p>
        <div class="setrow"><span class="nm">從別台機器來的檔案</span><label class="btn sm file">選一個檔案<input type="file" accept="application/json,.json" @change="importFile"></label><span /></div>
        <div v-if="importError" class="blocking">{{ importError }}</div>
      </template>

      <template v-else-if="tab === 'snap'">
        <p class="setgrp">委託副本的快照<Hint>每個階段開始時和每場戰鬥開打前各存一個快照。戰敗之後選「重來這場戰鬥」回到開打前；「回到這個階段開始時」委託沒有失敗，可以換一條分支或換一個面再走；撤退回到進入入口的那一刻，委託還在手上。回退時保留紀錄、性經歷記錄與共同記憶，其餘回到那個時間點。</Hint></p>
        <div v-if="!snaps.length" class="empty-note">現在不在委託副本裡。進入子網（藍鯨的帳本・潛入子網）時會存入口與階段的快照。</div>
        <div v-for="s in snaps" :key="s.id" class="setrow">
          <span class="nm"><span class="kc" :style="{ '--c': s.kind === '戰鬥' ? 'var(--hp)' : s.kind === '入口' ? 'var(--ap)' : 'var(--ram)' }">{{ s.kind }}</span>{{ s.label }}</span>
          <span class="val">{{ s.at }}</span>
          <ReasonButton sm :pri="snapshotUse(g.snapshots, s).action === '重來這場戰鬥'" :reason="snapshotUse(g.snapshots, s).reason" @go="useSnap(s.id)">{{ snapshotUse(g.snapshots, s).action }}</ReasonButton>
        </div>
        <div class="lockline"><span class="lk">固定</span><b>重來與回退一律可以。</b><Hint>不管選哪個難度，戰敗之後都可以重來這場戰鬥，或回到這個階段開始時。這一條不是存檔規則，所以設定裡沒有開關。</Hint></div>
      </template>

      <template v-else>
        <p class="setgrp">紀錄的回退・最近五樓<Hint>只有最新的一樓在套用之後還能重試：程式先用套用前的快照回退這一次，再重跑。回退一樓時，那一樓之後的樓與它們的任務鏈一起刪掉。更早的樓只留結果。</Hint></p>
        <div v-for="(e, i) in g.log.slice(0, 5)" :key="e.id" class="setrow">
          <span class="nm mono">#{{ e.id }}</span>
          <span class="val">{{ e.prose[0].slice(0, 28) }}{{ e.prose[0].length > 28 ? '…' : '' }}<small class="when">{{ e.time }}</small></span>
          <ReasonButton sm :reason="'這個參考實作沒有存每一樓的快照；引擎做好之後接上。'">{{ i === 0 ? '重試' : '回退' }}</ReasonButton>
        </div>
      </template>
    </section>
  </Dialog>
</template>

<style scoped>
.when { display: block; color: var(--ink-3); font: 600 var(--fs-fine) var(--font); }
.file { position: relative; overflow: hidden; }
.file input { position: absolute; inset: 0; opacity: 0; cursor: pointer; }
.lockline { margin-top: 12px; }
</style>
