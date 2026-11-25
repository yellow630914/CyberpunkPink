<script setup lang="ts">
import Dialog from '../components/Dialog.vue'
import TeachPanel from '../components/TeachPanel.vue'

/**
 * 機構的課（基本功 5 級以內；M4-training）：站在教課的設施上，主畫面的「這裡」多一項「上課」打開這一頁。
 * 列出的課、學費、時段、擋住的原因全是引擎的（teachOptions／lessonDraft），這裡只放 TeachPanel。
 */
defineProps<{ entryId: number; stacked?: boolean }>()
</script>

<template>
  <Dialog :entry-id="entryId" :stacked="stacked" title="上課" sub="機構的課・基本功" size="md">
    <TeachPanel />
  </Dialog>
</template>
