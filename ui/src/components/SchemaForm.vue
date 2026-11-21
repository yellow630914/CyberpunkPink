<script setup lang="ts">
import { ref } from 'vue'
import Hint from './Hint.vue'
import { fieldError, type KindSchema, type FieldDef } from '../lib/schemas'

/**
 * 照欄位表畫的表單（世界編輯器的第三版種類，lib/schemas.ts）：文字、長文、整數、數字、選項、是否、清單（逗號分開）、JSON。
 * 必填標「＊」；格式不對的欄位紅框、下面寫原因（UI 規則 5 的例外：擋住操作的警告直接顯示）。說明收在「?」。
 */
const props = defineProps<{ schema: KindSchema; entry: Record<string, unknown> }>()
const jsonErr = ref<Record<string, string>>({})
const err = (f: FieldDef) => fieldError(f, props.entry[f.k])
function set(f: FieldDef, raw: string) {
  const e = props.entry
  if (f.type === 'int' || f.type === 'num') e[f.k] = raw === '' ? '' : Number(raw)
  else if (f.type === 'list') e[f.k] = raw.split(/[,，、\n]/).map(x => x.trim()).filter(Boolean)
  else if (f.type === 'json') {
    try { e[f.k] = raw.trim() ? JSON.parse(raw) : null; delete jsonErr.value[f.k] } catch (x) { jsonErr.value[f.k] = `JSON 格式錯誤：${(x as Error).message}` }
  } else e[f.k] = raw
}
const show = (f: FieldDef) => {
  const v = props.entry[f.k]
  if (f.type === 'list') return Array.isArray(v) ? v.join('、') : ''
  if (f.type === 'json') return v === undefined ? '' : JSON.stringify(v, null, 1)
  return v === undefined || v === null ? '' : String(v)
}
</script>

<template>
  <div class="sf">
    <p class="t-fine">欄位照 {{ schema.source }}（DATA.md 的格式）。＊ 是必填。</p>
    <div class="grid2" style="--col-min: 260px">
      <div v-for="f in schema.fields" :key="f.k" class="ff" :class="{ bad: err(f) || jsonErr[f.k], wide: f.type === 'longtext' || f.type === 'json' }">
        <label :for="`sf-${f.k}`" class="fl"><span>{{ f.name }}<b v-if="f.req" class="req">＊</b></span><span class="mono t-fine">{{ f.k }}</span><Hint v-if="f.hint" :text="f.hint" /></label>
        <select v-if="f.type === 'enum'" :id="`sf-${f.k}`" class="inp" :value="show(f)" @change="set(f, ($event.target as HTMLSelectElement).value)">
          <option v-for="o in f.options" :key="o" :value="o">{{ o }}</option>
        </select>
        <button v-else-if="f.type === 'bool'" :id="`sf-${f.k}`" type="button" class="switch" :class="{ on: !!entry[f.k] }" :aria-pressed="!!entry[f.k]" :aria-label="f.name" @click="entry[f.k] = !entry[f.k]" />
        <textarea v-else-if="f.type === 'longtext' || f.type === 'json'" :id="`sf-${f.k}`" class="inp" :class="{ mono: f.type === 'json' }" rows="4" spellcheck="false" :value="show(f)" @change="set(f, ($event.target as HTMLTextAreaElement).value)" />
        <input v-else :id="`sf-${f.k}`" class="inp" :type="f.type === 'int' || f.type === 'num' ? 'number' : 'text'" :min="f.min" :max="f.max" :step="f.type === 'num' ? 0.01 : 1" :value="show(f)" :readonly="f.k === 'id' && !!entry.builtin" @change="set(f, ($event.target as HTMLInputElement).value)">
        <small v-if="err(f) || jsonErr[f.k]" class="msg">{{ jsonErr[f.k] ?? err(f) }}</small>
        <small v-else-if="f.type === 'list'" class="t-fine">用逗號或頓號分開</small>
      </div>
    </div>
  </div>
</template>

<style scoped>
.sf { display: grid; gap: var(--space-3); }
.ff { display: grid; gap: var(--space-2); padding: var(--space-3); background: var(--bg-2); align-content: start; }
.ff.wide { grid-column: 1 / -1; }
.ff.bad { box-shadow: inset 3px 0 0 var(--danger); }
.fl { display: flex; align-items: center; gap: var(--space-3); font-weight: 800; font-size: var(--fs-sm); }
.req { color: var(--a); margin-left: 2px; }
.inp { width: 100%; font: 500 var(--fs-sm) var(--font); background: var(--bg-term); color: var(--ink); border: 0; box-shadow: inset 0 0 0 2px var(--line); padding: 7px 9px; min-width: 0; }
textarea.inp { resize: vertical; }
.msg { color: var(--danger); font-size: var(--fs-fine); font-weight: 800; }
</style>
