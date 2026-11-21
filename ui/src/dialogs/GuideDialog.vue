<script setup lang="ts">
import { computed, ref } from 'vue'
import Dialog from '../components/Dialog.vue'
import ReasonButton from '../components/ReasonButton.vue'
import { GUIDE_LIST, GUIDE_PAGES } from '../data/content.generated'
import { useSettings } from '../stores/settings'
import { useUi } from '../stores/ui'
import { useGuides } from '../lib/useGuides'

/**
 * 指南的跳出視窗（UI 3.6 節）：置中、不蓋滿畫面；一張一到四頁，每頁一張示意圖加兩三句話。
 * 底下一個勾選「之後不要再跳出指南」，和設定「顯示」頁的「跳出指南」是同一個值。
 */
const props = defineProps<{ entryId: number; stacked?: boolean; guideId?: string }>()
const st = useSettings()
const ui = useUi()
const { markSeen } = useGuides()
const meta = computed(() => GUIDE_LIST.find(x => x.id === props.guideId) ?? GUIDE_LIST[0])
const pages = computed(() => GUIDE_PAGES[meta.value.id] ?? [])
const i = ref(0)
markSeen(meta.value.id)
const noPopup = computed({ get: () => !st.s.guidePopups, set: v => { st.s.guidePopups = !v } })
</script>

<template>
  <Dialog :entry-id="entryId" :stacked="stacked" :title="`指南・${meta.title}`" :sub="`${meta.category}・${meta.source}`" size="md">
    <template #header><span class="sys">SYS</span><span v-if="pages.length" class="pg mono">{{ i + 1 }}／{{ pages.length }}</span></template>
    <div v-if="pages.length" class="gd">
      <figure class="fig cut-sm"><span class="mono">圖</span>{{ pages[i].image }}</figure>
      <p class="txt">{{ pages[i].text }}</p>
    </div>
    <div v-else class="gd">
      <p class="txt">這張指南的內文還沒寫：什麼時候跳出來是「{{ meta.trigger }}」，內容照 {{ meta.source }}。</p>
    </div>
    <template #footer>
      <label class="chk"><input v-model="noPopup" type="checkbox">之後不要再跳出指南（直接收進備忘錄）</label>
      <span class="grow" />
      <ReasonButton sm :reason="i === 0 ? '這是第一頁。' : null" @go="i--">上一頁</ReasonButton>
      <button v-if="i < pages.length - 1" type="button" class="btn sm" @click="i++">下一頁</button>
      <button type="button" class="btn sm pri" @click="ui.close(entryId)">知道了</button>
    </template>
  </Dialog>
</template>

<style scoped>
.sys { font: 900 10px var(--mono); padding: 2px 6px; border-radius: 4px; background: var(--bg-2); color: var(--ram); }
.pg { font-size: 12px; color: var(--ink-3); }
.gd { display: grid; gap: 12px; }
.fig { margin: 0; min-height: 140px; display: grid; place-items: center; text-align: center; padding: 18px; background: var(--bg-term); box-shadow: inset 0 0 0 2px var(--line); color: var(--ink-3); font-size: var(--fs-sm); gap: 6px; }
.fig .mono { font-size: 10px; color: var(--ram); letter-spacing: 2px; }
.txt { margin: 0; font-size: var(--fs-md); line-height: var(--lh-prose); }
.chk { display: inline-flex; align-items: center; gap: 6px; font-size: var(--fs-xs); color: var(--ink-2); cursor: pointer; }
.grow { flex: 1; }
</style>
