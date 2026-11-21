<script setup lang="ts">
import Dialog from '../components/Dialog.vue'
import LivePanel from '../components/LivePanel.vue'
import { useUi } from '../stores/ui'

/**
 * 直播面板的對話框版（MEDIA 1.2 節）：不在戰鬥裡時（主畫面的「直播」、頻道）開日常直播。
 * 戰鬥中的直播面板不是對話框，是疊在戰鬥畫面旁邊的一欄（戰鬥照常進行）。
 */
const props = defineProps<{ entryId: number; stacked?: boolean }>()
const ui = useUi()
</script>

<template>
  <Dialog :entry-id="props.entryId" :stacked="stacked" title="直播" sub="日常直播：一次表演檢定，成功程度決定熱度" size="md">
    <LivePanel @close="ui.close(props.entryId)" />
  </Dialog>
</template>
