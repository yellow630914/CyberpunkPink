<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import Hint from '../../components/Hint.vue'
import ReasonButton from '../../components/ReasonButton.vue'
import ProductList from './ProductList.vue'
import ResultNote from './ResultNote.vue'
import { partTypeName } from '@engine/src'
import { useEngine } from '../../stores/engine'
import { useUi } from '../../stores/ui'
import { minutesText, pct } from '../../lib/craftView'

/**
 * 拆解（CRAFTING 第 10.4 節）：背包裡的一件成品拆成零件。先顯示每個零件完好拆下來的機率（引擎的 salvagePreview）；
 * 生體的零件拆了就死；零件全部完好而且還不會做那張設計圖，就學會它。
 */
const props = defineProps<{ uid?: string }>()
const eng = useEngine()
const ui = useUi()
const uid = ref(props.uid ?? (eng.craft.products()[0]?.data?.uid as string | undefined) ?? '')
watch(() => eng.craft.products().map((s) => s.data?.uid), (u) => { if (!u.includes(uid.value)) uid.value = (u[0] as string | undefined) ?? '' })
const preview = computed(() => (uid.value ? eng.craft.salvagePreview({ uid: uid.value }) : null))
const done = ref<{ result: string; lines: string[] } | null>(null)
watch(uid, () => { done.value = null })
function salvage() {
  const r = eng.craft.salvage({ uid: uid.value })
  if (r.why) { ui.toast(r.why, 'warn'); return }
  done.value = { result: r.result, lines: r.lines }
}
const FATE: Record<string, string> = { bio: '生體的零件，拆了就死', lost: '內容裡查不到，沒有東西可以拆' }
</script>

<template>
  <div class="slv">
    <div class="cr">
      <aside class="panel cut pad"><p class="h">成品</p><ProductList v-model="uid" /></aside>
      <section class="panel cut pad" data-salvage-preview>
        <template v-if="preview && preview.blueprint">
          <p class="h">拆{{ preview.blueprint.name }}<Hint title="拆解">每個零件各擲一次：完好的回背包（二手），沒過的報廢。機率是動手的人那一項基本功決定的。有授權鎖的要先解鎖，穿戴中的要先脫下來。</Hint></p>
          <div class="kv"><span>{{ preview.skillName }}</span><b class="mono">{{ preview.level }} 級</b></div>
          <div v-for="(l, i) in preview.parts" :key="l.type + i" class="kv" :data-part-line="l.id">
            <span>{{ partTypeName(l.type) }}・{{ l.name }}<template v-if="l.unreg">（未登錄）</template></span>
            <b v-if="l.fate === 'roll'" class="mono" data-chance>完好 {{ pct(l.chance) }}</b>
            <b v-else class="warn-t">{{ FATE[l.fate] }}</b>
          </div>
          <div class="kv"><span>時間</span><b>{{ minutesText(preview.minutes) }}</b></div>
          <div v-if="preview.teaches" class="kv"><span>全部完好的話</span><b class="ok-t" data-teaches>會把設計圖畫出來，學會{{ preview.blueprint.name }}</b></div>
          <ul v-if="preview.problems.length" class="problems" data-problems><li v-for="(p, i) in preview.problems" :key="i" class="blocking">{{ p }}</li></ul>
          <div class="go"><ReasonButton pri :reason="preview.block" data-salvage @go="salvage">拆解</ReasonButton></div>
        </template>
        <div v-else class="empty-note">先選一件成品。</div>
      </section>
    </div>
    <ResultNote v-if="done" :result="done.result" :lines="done.lines" />
  </div>
</template>

<style scoped>
.cr { display: grid; grid-template-columns: 280px minmax(0, 1fr); gap: var(--space-4); align-items: start; }
.problems { list-style: none; margin: var(--space-3) 0 0; padding: 0; display: grid; gap: 4px; }
.warn-t { color: var(--warn); }
.ok-t { color: var(--ok); }
@media (max-width: 720px) { .cr { grid-template-columns: minmax(0, 1fr); } }
</style>
