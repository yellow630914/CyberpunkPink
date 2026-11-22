<script setup lang="ts">
import { computed } from 'vue'
import Dialog from '../components/Dialog.vue'
import Hint from '../components/Hint.vue'
import AbilityTreeView from '../components/AbilityTreeView.vue'
import { useEngine } from '../stores/engine'
import { useGuides } from '../lib/useGuides'

/**
 * 技能樹對話框（UI 8.4 節）：外框＋讀引擎的 AbilityTreeView。學技能在這裡，裝進橋在角色的「橋」分頁。
 * 夜課、體悟、預備引擎還沒有，所以沒有畫。
 */
defineProps<{ entryId: number; stacked?: boolean; tree?: string; skill?: string }>()
const eng = useEngine()
useGuides().trigger('g_tree')
const xp = computed(() => eng.skills.mine().xp)
</script>

<template>
  <Dialog :entry-id="entryId" :stacked="stacked" title="技能樹" :sub="`歷練點 ${xp}`" size="xl">
    <template #header><Hint title="技能樹">學技能花歷練點，花的點數算進那棵樹的累計，累計夠了會開出更高的階。每開一階多一個不佔容量的共鳴。學會與裝上是兩回事：裝上看橋的容量。灰掉的是現在學不了的（點開看原因）。</Hint></template>
    <AbilityTreeView :tree="tree" :skill="skill" />
  </Dialog>
</template>
