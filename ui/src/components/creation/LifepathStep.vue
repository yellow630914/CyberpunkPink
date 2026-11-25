<script setup lang="ts">
import { computed, reactive, watch } from 'vue'
import Hint from '../Hint.vue'
import { useEngine } from '../../stores/engine'
import type { CreationDraft, LifepathTable } from '@engine/src/features/creation'

/**
 * 建角第 5 步：生命軌跡（CHARACTER 第 3 節、5.5 節）。讀引擎的 lifepathTables（看得到哪些：照出身換說法、照內容篩選過濾，整張被濾掉的表不出現）、
 * lifepathRoll（擲）、lifepathResults（每一條會變成什麼）、kinkChoices（自己挑的潛在性癖）。只編排：選的存在草稿（v-model），擲的結果就是引擎的那一個 id。
 */
const props = defineProps<{ draft: CreationDraft; lifepath: Record<string, string>; kinks: Array<{ tag: string; latent?: boolean }> }>()
const emit = defineEmits<{ (e: 'update:lifepath', v: Record<string, string>): void; (e: 'update:kinks', v: Array<{ tag: string; latent?: boolean }>): void }>()
const eng = useEngine()
const SKIP = 'skip'

const tables = computed(() => eng.creation.lifepath.tables(props.draft))
const results = computed(() => eng.creation.lifepath.results(props.draft))
const problems = computed(() => eng.creation.lifepath.problems(props.draft))
const kinkList = computed(() => eng.creation.lifepath.kinks())
const kinkMax = eng.creation.lifepath.kinkMax
const value = (t: LifepathTable) => props.lifepath[t] ?? SKIP
const resultOf = (t: LifepathTable) => results.value.find((r) => r.table === t)

/** 這張表擲過幾次（重擲就換下一個；引擎用同一份種子，同一張表第 n 次擲到的固定） */
const rerolls = reactive<Record<string, number>>({})
function set(t: LifepathTable, id: string) { emit('update:lifepath', { ...props.lifepath, [t]: id }) }
function roll(t: LifepathTable) {
  const id = eng.creation.lifepath.roll(props.draft, t, rerolls[t] ?? 0)
  rerolls[t] = (rerolls[t] ?? 0) + 1
  if (id) set(t, id)
}

// 內容篩選改了之後，選的條目不在清單裡了：那一張改成跳過（整張表被篩掉也一樣）
watch(tables, (list) => {
  const next = { ...props.lifepath }
  let changed = false
  for (const [t, id] of Object.entries(next)) {
    if (id === SKIP) continue
    const view = list.find((x) => x.table === t)
    if (!view || !view.options.some((o) => o.id === id)) { delete next[t]; changed = true }
  }
  if (changed) emit('update:lifepath', next)
}, { immediate: true })

const kinkOn = (tag: string) => props.kinks.find((k) => k.tag === tag)
function toggleKink(tag: string) {
  if (kinkOn(tag)) emit('update:kinks', props.kinks.filter((k) => k.tag !== tag))
  else if (props.kinks.length < kinkMax) emit('update:kinks', [...props.kinks, { tag, latent: true }])
}
function setLatent(tag: string, latent: boolean) { emit('update:kinks', props.kinks.map((k) => (k.tag === tag ? { ...k, latent } : k))) }
const kinkBlock = (tag: string) => (!kinkOn(tag) && props.kinks.length >= kinkMax ? `潛在性癖最多選 ${kinkMax} 個。` : null)
</script>

<template>
  <div class="lp" data-lifepath>
    <h2>生命軌跡</h2>
    <p class="setgrp">每一張可以擲、可以選、可以跳過<Hint>結果會變成遊戲裡的東西：一位 NPC、一個勢力的好感或敵對值、一筆錢或債、一個旗標、一個個人目標。性經歷與潛在性癖兩張表照內容篩選過濾，整張被篩掉的表不出現；所有相關的人物都是成年人。</Hint></p>
    <div class="grid2 cards">
      <div v-for="t in tables" :key="t.table" class="life cut-sm" :data-table="t.table">
        <div class="lh"><h4>{{ t.name }}</h4><button type="button" class="btn sm" :data-roll="t.table" @click="roll(t.table)">擲</button></div>
        <select :value="value(t.table)" class="inp" :aria-label="t.name" :data-pick="t.table" @change="set(t.table, ($event.target as HTMLSelectElement).value)">
          <option :value="SKIP">跳過</option>
          <option v-for="o in t.options" :key="o.id" :value="o.id">{{ o.text }}</option>
        </select>
        <ul v-if="resultOf(t.table)?.outcomes.length" class="res" :data-result="t.table"><li v-for="(o, i) in resultOf(t.table)!.outcomes" :key="i">→ {{ o.text }}</li></ul>
        <small v-else-if="value(t.table) !== SKIP" class="res">→ 沒有額外的結果。</small>
      </div>
    </div>
    <section v-if="kinkList.length" class="kinks" data-kinks>
      <p class="setgrp">自己挑的潛在性癖（最多 {{ kinkMax }} 個）<Hint>「潛在」是建角時只記下來，第一次碰到時才揭開；取消勾選的「潛在」就直接是「有」。題材被內容篩選關掉的不出現。</Hint></p>
      <div class="grid2">
        <div v-for="k in kinkList" :key="k.id" class="lrow pick" :class="{ on: !!kinkOn(k.id), 'is-unavailable': !!kinkBlock(k.id) }" :title="kinkBlock(k.id) ?? undefined" :data-kink="k.id">
          <button type="button" class="kbtn" :aria-pressed="!!kinkOn(k.id)" :aria-label="k.name" @click="kinkBlock(k.id) ? null : toggleKink(k.id)"><b>{{ k.name }}</b></button>
          <label v-if="kinkOn(k.id)" class="latent"><input type="checkbox" :checked="kinkOn(k.id)!.latent !== false" @change="setLatent(k.id, ($event.target as HTMLInputElement).checked)">潛在</label>
        </div>
      </div>
    </section>
    <div v-if="problems.length" class="blocking" data-lifepath-block>{{ problems[0] }}</div>
  </div>
</template>

<style scoped>
.life { background: var(--bg-2); padding: var(--space-4); display: grid; gap: var(--space-3); align-content: start; }
.lh { display: flex; justify-content: space-between; align-items: center; gap: var(--space-3); }
.lh h4 { margin: 0; }
.inp { width: 100%; min-width: 0; background: var(--bg-term); color: var(--ink); border: 0; box-shadow: inset 0 0 0 2px var(--line); padding: 8px 10px; font: 600 var(--fs-md) var(--font); }
.res { margin: 0; padding: 0; list-style: none; color: var(--ram); font-size: var(--fs-sm); font-weight: 700; display: grid; gap: var(--space-1); }
.kinks { margin-top: var(--space-5); }
.kbtn { flex: 1; text-align: left; background: none; border: 0; color: inherit; font: inherit; cursor: pointer; padding: 0; }
.latent { display: inline-flex; gap: var(--space-2); align-items: center; font-size: var(--fs-sm); color: var(--ink-2); }
</style>
