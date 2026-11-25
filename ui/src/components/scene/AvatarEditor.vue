<script setup lang="ts">
import { computed, ref } from 'vue'
import Hint from '../Hint.vue'
import ReasonButton from '../ReasonButton.vue'
import { useEngine } from '../../stores/engine'
import { useUi } from '../../stores/ui'
import { INTIMATE_PARTS, hidesIntimate } from '../../lib/scene/sceneView'

/**
 * 化身（角色的內海分頁，M4-scene-net；CYBERSPACE 第 4 節）：內海的成人場景裡的樣子。性別、三個可以自由開關的部位（加裝、尾、觸手）、存幾套。
 * 外觀不改任何數值。改化身要在接入點（潛艙店、據點或住處），戰鬥與場景進行中不能改；能不能改與原因、最多存幾套都是引擎的（stores/engine.ts 的 deck.avatar 只轉接）。
 * 部位的名字是畫面的中性文字標籤；內容篩選關掉「身體的私密描寫」時尾與觸手的名字收起來換成編號。
 */
const e = useEngine()
const ui = useUi()
const av = computed(() => e.deck.avatar.get())
const PART_NAME: Record<string, string> = { extra: '加裝', tail: '尾', tentacle: '觸手' }
const GENDER_NAME: Record<string, string> = { male: '男', female: '女', femboy: '偽娘（含男娘）', trans_f: 'TS', futa: '扶他' }
const name = ref('')
const hidden = computed(() => hidesIntimate(e.scene.contentOff()))
const partsAfter = (id: string): string[] => {
  const cur = av.value?.parts ?? []
  return cur.includes(id as never) ? cur.filter((p) => p !== id) : [...cur, id]
}
const toggleWhy = (id: string): string | null => e.deck.avatar.block({ parts: partsAfter(id) })
const genderWhy = (g: string | null): string | null => e.deck.avatar.block({ gender: g })
const say = (why: string | null, ok: string): void => { if (why) ui.toast(why, 'warn'); else ui.toast(ok) }
const toggle = (id: string): void => {
  const on = !(av.value?.parts ?? []).includes(id as never)
  say(e.deck.avatar.set({ parts: partsAfter(id) }), `${labelOf(id)}：${on ? '開了' : '關了'}。`)
}
const setGender = (g: string | null): void => say(e.deck.avatar.set({ gender: g }), '化身的性別改好了。')
const saveWhy = computed(() => (name.value.trim() ? e.deck.avatar.block({ save: name.value.trim() }) : '先替這一套取個名字。'))
const save = (): void => { say(e.deck.avatar.set({ save: name.value.trim() }), `存成「${name.value.trim()}」。`); name.value = '' }
const load = (n: string): void => say(e.deck.avatar.set({ load: n }), `換上「${n}」。`)
const labelOf = (id: string): string => (hidden.value && INTIMATE_PARTS.includes(id) ? `部位${e.deck.avatar.parts.indexOf(id) + 1}` : PART_NAME[id] ?? id)
</script>

<template>
  <div v-if="av" class="panel cut pad avatar" data-avatar>
    <p class="h">化身<Hint>內海的場景裡的樣子：性別、三個可以自由開關的部位（只有內海的場景用得到）。外觀不改任何數值。要在接入點才能改；戰鬥與場景進行中不能改。最多存 {{ e.deck.avatar.savesMax }} 套。</Hint></p>
    <div class="grp"><span class="k">性別</span>
      <span class="seg"><button type="button" :class="{ on: av.gender === undefined, 'is-unavailable': !!genderWhy(null) && av.gender !== undefined }" :title="av.gender !== undefined ? genderWhy(null) ?? undefined : undefined" data-gender="self" @click="setGender(null)">照角色的</button>
        <button v-for="g in e.deck.avatar.genders" :key="g" type="button" :class="{ on: av.gender === g, 'is-unavailable': av.gender !== g && !!genderWhy(g) }" :title="av.gender !== g ? genderWhy(g) ?? undefined : undefined" :data-gender="g" @click="setGender(g)">{{ GENDER_NAME[g] ?? g }}</button></span>
    </div>
    <div class="grp"><span class="k">部位</span>
      <span class="seg"><button v-for="p in e.deck.avatar.parts" :key="p" type="button" :class="{ on: av.parts.includes(p as never), 'is-unavailable': !!toggleWhy(p) }" :title="toggleWhy(p) ?? undefined" :data-avatar-part="p" @click="toggle(p)">{{ labelOf(p) }}</button></span>
    </div>
    <div class="grp"><span class="k">存幾套（{{ av.saved.length }}／{{ e.deck.avatar.savesMax }}）</span>
      <span v-for="s in av.saved" :key="s.name" class="sv"><b>{{ s.name }}</b><button type="button" class="btn sm" :data-avatar-load="s.name" @click="load(s.name)">換上</button></span>
      <span class="sv"><input v-model="name" class="inp" maxlength="30" placeholder="這一套的名字" aria-label="這一套化身的名字" data-avatar-name><ReasonButton sm :reason="saveWhy" data-avatar-save @go="save">存起來</ReasonButton></span>
    </div>
  </div>
</template>

<style scoped>
.avatar { display: grid; gap: var(--space-3); min-width: 0; }
.grp { display: flex; gap: var(--space-3); align-items: center; flex-wrap: wrap; }
.seg { display: inline-flex; gap: 3px; flex-wrap: wrap; }
.seg button { font-size: var(--fs-sm); font-weight: 800; padding: 6px 11px; background: var(--bg-term); color: var(--ink-3); border: 0; cursor: pointer; white-space: nowrap; }
.seg button.on { background: var(--a); color: #fff; }
.sv { display: inline-flex; gap: var(--space-2); align-items: center; }
.inp { background: var(--bg-term); color: var(--ink); border: 0; box-shadow: inset 0 0 0 2px var(--line); padding: 6px 8px; font: 600 var(--fs-md) var(--font); width: 160px; max-width: 100%; }
</style>
