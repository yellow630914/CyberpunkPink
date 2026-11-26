<script setup lang="ts">
import { computed, ref } from 'vue'
import type { WindowInput, WindowOption } from '@engine/src/features/unreg'
import Hint from './Hint.vue'
import ReasonButton from './ReasonButton.vue'
import { useEngine } from '../stores/engine'
import { useUi } from '../stores/ui'
import { toggleWant } from '../lib/partsView'

/**
 * 勢力的固定窗口（M4-ui-parts 第 5 項；CRAFTING 11.1 節、FACTIONS 5.1 節）：好感滿、手上有一個那個勢力（或首領）欠你的大人情，可以換一件未登錄零件，每個勢力一次。
 * 能不能換與原因（逐條）、等級、牌子、能指定的方向都是引擎的 windowOptions／windowBlock；選類型與方向、確認要用掉一個大人情，然後 Game 提交。
 * 沒有任何勢力有窗口（沒有人註冊人情）時整段不出現。
 */
const e = useEngine()
const ui = useUi()
const rows = computed(() => e.unreg.windowOptions())
const open = ref<string | null>(null)
const type = ref('')
const material = ref<'mech' | 'bio'>('mech')
const want = ref<string[]>([])
const confirming = ref(false)

const row = computed<WindowOption | null>(() => rows.value.find((r) => r.faction === open.value) ?? null)
const typeRow = computed(() => row.value?.types.find((t) => t.id === type.value) ?? null)
function start(r: WindowOption) {
  open.value = r.faction
  type.value = r.types[0]?.id ?? ''
  material.value = 'mech'
  want.value = []
  confirming.value = false
}
function pickType(id: string) {
  type.value = id
  want.value = []
  if (typeRow.value && !typeRow.value.bio) material.value = 'mech'
}
const input = computed<WindowInput>(() => ({ faction: open.value ?? '', type: type.value, ...(material.value === 'bio' ? { material: 'bio' } : {}), ...(want.value.length ? { want: [...want.value] } : {}) }))
const reason = computed(() => (open.value ? e.unreg.windowBlock(input.value) : null))
async function go() {
  const r = await e.unreg.window(input.value)
  if (r.status !== 'applied') { ui.toast(r.reason ?? '現在換不了。', 'warn'); confirming.value = false; return }
  ui.toast(e.state.reports.at(-1)?.outcome.summary ?? '換到了。')
  open.value = null
  confirming.value = false
}
</script>

<template>
  <section v-if="rows.length" class="panel cut pad win" data-windows>
    <p class="h">勢力的窗口<Hint title="固定窗口">好感到門檻、手上有一個那個勢力（或它的首領）欠你的大人情，可以換一件未登錄零件：等級是窗口的上限，牌子是那個勢力的。每個勢力只能換一次；換了之後大人情少一個。</Hint></p>
    <div v-for="r in rows" :key="r.faction" class="wrow" :class="{ 'is-unavailable': r.blocks.length > 0 }" :data-window="r.faction">
      <div class="head">
        <span class="grow"><b>{{ r.name }}</b><small data-window-favor>好感 {{ r.favor }}／{{ r.favor_need }}・給的是 {{ r.grade }} 級（牌子 {{ r.brand }}）<template v-if="r.used">・已經換過了</template></small></span>
        <ReasonButton sm pri :reason="r.blocks.length ? r.blocks.join('') : null" data-window-open @go="start(r)">換一件未登錄零件</ReasonButton>
      </div>
      <small v-for="(b, i) in r.blocks" :key="i" class="why" data-window-block>{{ b }}</small>
      <div v-if="open === r.faction" class="form" data-window-form>
        <label class="pick">類型
          <select :value="type" data-window-type @change="pickType(($event.target as HTMLSelectElement).value)"><option v-for="t in r.types" :key="t.id" :value="t.id">{{ t.name }}</option></select>
        </label>
        <div class="pick"><span>材質</span>
          <div class="chips">
            <button type="button" class="btn sm" :class="{ pri: material === 'mech' }" :aria-pressed="material === 'mech'" @click="material = 'mech'">機械</button>
            <button type="button" class="btn sm" :class="{ pri: material === 'bio' }" :aria-pressed="material === 'bio'" :aria-disabled="typeRow && !typeRow.bio ? 'true' : undefined" @click="typeRow && !typeRow.bio ? ui.toast('這一類沒有生體版。', 'warn') : (material = 'bio')">生體</button>
          </div>
        </div>
        <div class="pick"><span>想要的方向（先勾的排前面）</span>
          <div v-if="typeRow && typeRow.directions.length" class="chips">
            <button v-for="d in typeRow.directions" :key="d.id" type="button" class="btn sm" :class="{ pri: want.includes(d.id) }" :aria-pressed="want.includes(d.id)" :data-window-dir="d.id" @click="want = toggleWant(want, d.id)"><template v-if="want.includes(d.id)">{{ want.indexOf(d.id) + 1 }}. </template>{{ d.name }}</button>
          </div>
          <p v-else class="empty-note">這一類沒有可以指定的方向，窗口自己決定。</p>
        </div>
        <div v-if="reason" class="blocking" data-window-reason>{{ reason }}</div>
        <div v-if="confirming" class="warnbox" data-window-confirm>
          <p><b>要用掉一個大人情嗎？</b>換完這一件，這個勢力的窗口就不能再用了，用掉的人情也不會回來。</p>
          <div class="go"><button type="button" class="btn" @click="confirming = false">再想想</button><button type="button" class="btn pri" data-window-yes @click="go">用掉，換這一件</button></div>
        </div>
        <div v-else class="go"><button type="button" class="btn" @click="open = null">先不要</button><ReasonButton pri :reason="reason" data-window-go @go="confirming = true">換</ReasonButton></div>
      </div>
    </div>
  </section>
</template>

<style scoped>
.win { grid-column: 1 / -1; display: grid; gap: var(--space-3); }
.wrow { display: grid; gap: var(--space-2); padding: var(--space-3); background: var(--bg-2); }
.head { display: flex; gap: var(--space-3); align-items: center; flex-wrap: wrap; }
.grow { flex: 1; min-width: 180px; display: grid; }
.grow small { color: var(--ink-3); font-size: var(--fs-xs); }
.why { color: var(--warn); font-weight: 700; font-size: var(--fs-xs); }
.form { display: grid; gap: var(--space-3); padding-top: var(--space-3); border-top: 1px dashed var(--line-2); }
.pick { display: grid; gap: var(--space-2); font-size: var(--fs-fine); color: var(--ink-3); font-weight: 700; }
.pick select { background: var(--bg-1); color: var(--ink); border: 0; box-shadow: inset 0 0 0 2px var(--line-2); padding: 7px 9px; font: inherit; max-width: 320px; }
.chips { display: flex; gap: var(--space-2); flex-wrap: wrap; }
.go { display: flex; gap: var(--space-3); flex-wrap: wrap; }
.warnbox { padding: var(--space-3); background: var(--bg-1); box-shadow: inset 3px 0 0 var(--warn); display: grid; gap: var(--space-2); }
.warnbox p { margin: 0; font-size: var(--fs-sm); }
</style>
