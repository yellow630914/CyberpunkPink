<script setup lang="ts">
import { computed } from 'vue'
import Hint from '../Hint.vue'
import AbilityTreeView from '../AbilityTreeView.vue'
import { useEngine } from '../../stores/engine'
import { CATEGORY_NAME, CAT_COLOR } from '../../lib/skillView'
import type { AbilitySource, Category } from '../../lib/skillView'
import type { CreationDraft } from '@engine/src/features/creation'

/**
 * 建角第 8 步：技能（CHARACTER 第 1 節、SKILLS 1.3 節）。和遊戲裡的技能樹是同一個畫面（AbilityTreeView），只是讀建角草稿：
 * 歷練點、能不能學、原因、每棵樹開到第幾階都是引擎的（creation.step 的 abilities 回答）；學的順序就是裝進橋的順序，容量不夠的標出來「學了但還裝不下」。
 * 選了「沒有橋」時整頁是引擎給的那一句。只編排，沒有規則。
 */
const props = defineProps<{ draft: CreationDraft; abilities: string[] }>()
const emit = defineEmits<{ (e: 'update:abilities', v: string[]): void; (e: 'goStep', n: number): void }>()
const eng = useEngine()

const noBridge = computed(() => props.draft.bridge === null)
const summary = computed(() => eng.creation.summary(props.draft))
const mine = computed(() => eng.creation.abilityState(props.draft))
const blocks = computed(() => eng.creation.stepBlocks(props.draft, 'abilities'))
const withList = (list: string[]): CreationDraft => ({ ...props.draft, abilities: list })

const source: AbilitySource = {
  paths: () => eng.skills.paths(),
  abilities: () => eng.skills.abilities(),
  mine: () => mine.value,
  tierOf: (path) => eng.creation.treeTier(mine.value.spent[path] ?? 0),
  treeXp: eng.skills.treeXp,
  resonanceOn: () => false,
  lock: () => null,
  learnBlock: (id) => {
    if (mine.value.learned.includes(id)) return '已經學會了。'
    return eng.creation.addBlock(props.draft, withList([...props.abilities, id]), 'abilities')
  },
  learn: (id) => {
    const why = source.learnBlock(id)
    if (why) return why
    emit('update:abilities', [...props.abilities, id])
    return null
  },
  // 退掉一個：後面的技能照順序重新問引擎，接不上的（階或前置不夠了）一起退掉
  forget: (id) => {
    const rest = props.abilities.filter((x) => x !== id)
    emit('update:abilities', eng.creation.abilityState(withList(rest)).learned)
  },
}

/** 學的順序就是裝的順序：每一類的容量用完了，後面那一類的放不下（建角之後引擎照順序裝，裝不下的跳過；這裡只加起來給玩家預覽） */
const CATS: Category[] = ['meat', 'net', 'social', 'media']
const fit = computed(() => {
  const cap = summary.value.capacity
  const used: Record<Category, number> = { meat: 0, net: 0, social: 0, media: 0 }
  const rows = mine.value.learned.map((id) => {
    const ab = eng.skills.abilities().find((a) => a.id === id)
    if (!ab) return { id, name: id, cap: 0, category: 'meat' as Category, fits: true }
    const fits = used[ab.category] + ab.cap <= cap[ab.category]
    if (fits) used[ab.category] += ab.cap
    return { id, name: ab.name, cap: ab.cap, category: ab.category, fits }
  })
  return { rows, used, cap }
})
</script>

<template>
  <div class="ab" data-abilities-step>
    <h2>技能・剩 {{ summary.xp.left }}／{{ summary.xp.total }} 歷練點</h2>
    <div v-if="noBridge" class="blocking" data-nobridge>
      <p>{{ eng.creation.noBridgeAbility }}</p>
      <button type="button" class="btn sm" data-act="to-cyber" @click="emit('goStep', 6)">回第 6 步選橋</button>
    </div>
    <template v-else>
      <p class="setgrp">在技能樹上花<Hint>和遊戲裡的技能樹是同一個畫面：學一個技能花它標的歷練點，算進那棵樹的累計；累計夠了開更高的階。建角時學了可以退（選中再按「退掉」）；沒花完的留著。灰掉的是現在學不了的，點開看原因。學的順序就是裝進橋的順序。</Hint></p>
      <AbilityTreeView :source="source" />
      <section class="panel cut pad fit" data-fit>
        <p class="h">照學的順序裝進橋<Hint>建角一結束，引擎照這個順序把技能裝進橋，容量放不下的跳過、後面放得下的繼續裝。這裡的容量是你選的橋的；沒有選橋時是 0。</Hint></p>
        <div class="caps"><span v-for="c in CATS" :key="c" class="tag" :style="{ color: CAT_COLOR[c] }">{{ CATEGORY_NAME[c] }} {{ fit.used[c] }}／{{ fit.cap[c] }}</span></div>
        <p v-if="!fit.rows.length" class="empty-note">還沒學任何技能。</p>
        <ol v-else class="rows"><li v-for="r in fit.rows" :key="r.id" :class="{ no: !r.fits }" :data-fit-row="r.id"><b>{{ r.name }}</b><small>{{ CATEGORY_NAME[r.category] }}　容量 {{ r.cap }}</small><em v-if="!r.fits" class="why">學了但還裝不下</em></li></ol>
      </section>
      <div v-if="blocks.length" class="blocking" data-abilities-block>{{ blocks[0] }}</div>
    </template>
  </div>
</template>

<style scoped>
.fit { margin-top: var(--space-4); display: grid; gap: var(--space-3); }
.caps { display: flex; gap: var(--space-3); flex-wrap: wrap; }
.rows { margin: 0; padding-left: var(--space-5); display: grid; gap: var(--space-2); }
.rows li { font-size: var(--fs-sm); }
.rows small { color: var(--ink-3); margin-left: var(--space-3); }
.rows li.no b { color: var(--ink-3); }
.why { color: var(--warn); font-style: normal; font-weight: 800; margin-left: var(--space-3); }
</style>
