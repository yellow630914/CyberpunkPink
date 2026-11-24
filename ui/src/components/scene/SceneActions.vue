<script setup lang="ts">
import { computed, ref } from 'vue'
import type { ActionOption, ChoiceOption, SceneInput, SceneOptions } from '@engine/src/features/scene'
import { previewLines, reasonText } from '../../lib/scene/sceneView'
import { useUi } from '../../stores/ui'

/**
 * 成人場景的行動列（UI.md 第 10 節）：行動點、九種行動、結束回合。做不到的灰掉，原因是引擎的（title 與點下去的提示）。
 * 技能、道具、切換體位點開是清單，每一項各自的花費、原因與預覽也是引擎的；說話開文字框。
 * 這裡不判斷能不能做、不算數字：選好了就把輸入交給畫面（畫面決定要不要先選部位）。
 */
const props = defineProps<{ opts: SceneOptions; playing: boolean; theirName: string; selected: string }>()
const emit = defineEmits<{ (e: 'choose', input: SceneInput): void; (e: 'select', id: string): void; (e: 'end-turn'): void }>()
const ui = useUi()
const open = ref<'' | 'skill' | 'item' | 'switch' | 'talk'>('')
const talkText = ref('')

const GROUPS = ['skill', 'item', 'switch'] as const
const isGroup = (id: string): id is (typeof GROUPS)[number] => (GROUPS as readonly string[]).includes(id)
/** 換檔在畫面上方的「同步」按鈕，行動列不重複放 */
const shown = computed(() => props.opts.actions.filter((a) => a.id !== 'gear'))
const yours = computed(() => props.opts.turn === 'pc')

function why(blocks: readonly string[]): void { ui.toast(reasonText(blocks), 'warn') }

function press(a: ActionOption): void {
  if (props.playing) return
  emit('select', a.id)
  if (a.blocks.length > 0) { open.value = ''; why(a.blocks); return }
  if (isGroup(a.id) || a.id === 'talk') { open.value = open.value === a.id ? '' : (a.id as typeof open.value); return }
  open.value = ''
  emit('choose', { kind: a.id } as SceneInput)
}
function pickChoice(a: ActionOption, c: ChoiceOption): void {
  if (props.playing) return
  if (c.blocks.length > 0) { why(c.blocks); return }
  open.value = ''
  emit('choose', a.id === 'switch' ? { kind: 'switch', position: c.id } : ({ kind: a.id, id: c.id } as SceneInput))
}
function say(): void {
  if (props.playing) return
  const talk = props.opts.actions.find((a) => a.id === 'talk')
  if (talk && talk.blocks.length > 0) { why(talk.blocks); return }
  const text = talkText.value.trim()
  open.value = ''
  talkText.value = ''
  emit('choose', text ? { kind: 'talk', text } : { kind: 'talk' })
}
const group = computed(() => props.opts.actions.find((a) => a.id === open.value && isGroup(a.id)) ?? null)
const current = computed(() => props.opts.actions.find((a) => a.id === props.selected) ?? null)
const lines = computed(() => previewLines(current.value?.preview, props.theirName))
const endWhy = computed(() => props.opts.end_turn.blocks)
function endTurn(): void { if (props.playing) return; if (endWhy.value.length > 0) why(endWhy.value); else emit('end-turn') }
/** 鍵盤的 1～9 與空白鍵 */
function pressId(id: string): void { const a = shown.value.find((x) => x.id === id); if (a) press(a) }
defineExpose({ press: pressId, endTurn })
const choiceLines = (c: ChoiceOption): string => previewLines(c.preview, props.theirName).join('・')
</script>

<template>
  <section class="panel cut pad acts" data-actions>
    <div class="aph">
      <span class="k">行動點</span>
      <span class="ap" :aria-label="`行動點 ${opts.ap.now}／${opts.ap.max}`" data-ap><i v-for="n in opts.ap.max" :key="n" :class="{ on: n <= opts.ap.now }" /></span>
      <span class="k">{{ yours && !playing ? '輪到你' : `輪到${theirName}` }}</span>
      <span class="grow" />
      <button type="button" class="btn sm" :class="{ 'is-unavailable': endWhy.length > 0 || playing }" :title="endWhy.length ? reasonText(endWhy) : undefined" data-end-turn @click="endTurn">結束回合</button>
    </div>
    <div class="abtns">
      <button
        v-for="(a, i) in shown" :key="a.id" type="button" class="ab"
        :class="{ on: selected === a.id, 'is-unavailable': a.blocks.length > 0 || playing, stop: a.id === 'stop' }"
        :title="a.blocks.length ? reasonText(a.blocks) : undefined" :data-act="a.id" @click="press(a)"
      ><span class="kn mono">{{ i + 1 }}</span>{{ a.name }}<small>{{ a.id === 'stop' ? '' : a.ap > 0 || !isGroup(a.id) ? `${a.ap} 點` : '▾' }}</small></button>
    </div>
    <div v-if="group" class="pop" :data-pop="group.id">
      <button
        v-for="c in group.choices" :key="c.id" type="button" class="opt" :class="{ 'is-unavailable': c.blocks.length > 0 }"
        :title="c.blocks.length ? reasonText(c.blocks) : undefined" :data-choice="c.id" @click="pickChoice(group, c)"
      ><b>{{ c.name }}</b><small>{{ c.ap }} 點{{ choiceLines(c) ? `・${choiceLines(c)}` : '' }}</small></button>
      <span v-if="!group.choices?.length" class="t-fine">沒有可以用的。</span>
    </div>
    <form v-else-if="open === 'talk'" class="pop talk" data-pop="talk" @submit.prevent="say">
      <input v-model="talkText" class="inp" placeholder="想說的話（AI 關著時用骰子判定）" data-talk-input>
      <button class="btn sm pri" type="submit" data-talk-go>說</button>
    </form>
    <div class="pv" data-preview>
      <b>{{ current?.name ?? '' }}</b><template v-if="lines.length">：{{ lines.join('・') }}</template><template v-else-if="current && current.blocks.length">：{{ reasonText(current.blocks) }}</template>
    </div>
  </section>
</template>

<style scoped>
.acts { display: grid; gap: var(--space-3); min-width: 0; }
.aph { display: flex; align-items: center; gap: var(--space-3); flex-wrap: wrap; }
.grow { flex: 1; }
.ap { display: flex; gap: 4px; }
.ap i { width: 16px; height: 16px; clip-path: polygon(50% 0, 100% 50%, 50% 100%, 0 50%); background: var(--bg-3); }
.ap i.on { background: var(--ap); }
.abtns { display: grid; grid-template-columns: repeat(auto-fill, minmax(112px, 1fr)); gap: var(--space-3); }
.ab { position: relative; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 2px; min-height: 58px; padding: 8px; background: var(--bg-2); border: 0; font-weight: 900; font-size: var(--fs-md); cursor: pointer; color: var(--ink); }
.ab small { font: 700 var(--fs-fine) var(--mono); color: var(--ink-3); min-height: 1em; }
.ab.on { box-shadow: inset 0 0 0 2px var(--ink-2); }
.ab .kn { position: absolute; left: 6px; top: 4px; font-size: var(--fs-tiny); color: var(--ink-3); }
.pop { display: flex; flex-wrap: wrap; gap: var(--space-3); }
.opt { display: grid; text-align: left; padding: 6px 10px; background: var(--bg-2); border: 0; cursor: pointer; color: var(--ink); max-width: 100%; }
.opt small { color: var(--ink-3); font-size: var(--fs-fine); overflow-wrap: anywhere; }
.talk .inp { flex: 1; min-width: 0; background: var(--bg-term); color: var(--ink); border: 0; box-shadow: inset 0 0 0 2px var(--line); padding: 8px 10px; font: 600 var(--fs-md) var(--font); }
.pv { padding: 8px 12px; background: var(--bg-term); font-size: var(--fs-sm); color: var(--ink-2); min-height: 2.4em; overflow-wrap: anywhere; }
@media (max-width: 720px) {
  .abtns { grid-template-columns: repeat(5, minmax(0, 1fr)); gap: var(--space-2); }
  .ab { min-height: 54px; padding: 6px 2px; font-size: var(--fs-sm); }
  .ab .kn { display: none; }
}
</style>
