<script setup lang="ts">
import Dialog from '../components/Dialog.vue'
import Hint from '../components/Hint.vue'
import SkillTreeView from '../components/SkillTreeView.vue'
import { useGame } from '../stores/game'
import { useUi } from '../stores/ui'
import { useGuides } from '../lib/useGuides'
import { SKILL_TREES } from '../data/content.generated'

/**
 * 技能樹對話框（UI 8.4 節）：外框＋共用的 SkillTreeView（建角第 8 步用同一個元件，預算換成起始的 200 點）。
 * 學技能在這裡，裝進橋在角色的「橋」分頁。
 */
defineProps<{ entryId: number; stacked?: boolean; tree?: string; skill?: string }>()
const g = useGame()
const ui = useUi()
useGuides().trigger('g_tree')
function learn(id: string) {
  g.learnSkill(id)
  const s = SKILL_TREES.flatMap(t => t.skills).find(k => k.id === id)
  ui.toast(`學會了「${s?.name ?? id}」。裝進橋在角色的「橋」分頁。`)
}
</script>

<template>
  <Dialog :entry-id="entryId" :stacked="stacked" title="技能樹" :sub="`歷練點 ${g.character.xp}・體悟 ${g.character.insight}`" size="xl">
    <template #header><Hint title="技能樹">學一個技能花「階 × 20」歷練點，算進那棵樹的累計；累計到 40、120、240、400 開 2～5 階。要先學會前置。每開一階多一個不佔容量的共鳴。學會與裝上是兩回事：裝上看橋的容量。灰掉的是現在學不了的（點開看原因）。</Hint></template>
    <SkillTreeView :learned="g.learned" :xp="g.character.xp" :tree="tree" :skill="skill" @learn="learn" />
  </Dialog>
</template>
