<script setup lang="ts">
import { computed, reactive, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import StatusBar from '../components/StatusBar.vue'
import Tabs from '../components/Tabs.vue'
import Hint from '../components/Hint.vue'
import ReasonButton from '../components/ReasonButton.vue'
import { useUi } from '../stores/ui'
import { CATEGORIES, PACK, START_ENTRIES, BUILTIN, COUNTERS, LEGEND } from '../data/editor'
import { checkWorld, planImport, type WorldEntry, type Issue } from '../lib/worldCheck'
import { useGuides } from '../lib/useGuides'

/**
 * 世界編輯器（UI 第 15 節、樣稿 docs/mockups/world-editor.html）。殼和 AI 工坊相同：左清單、中編輯、右檢查。
 * 頁簽分三級：內容／匯入與匯出 → 大類（每類標筆數，有錯的亮紅點）→ 那一類底下的種類；右邊可以切全部／只看這個世界包／只看有錯的。
 * 只擋格式錯誤與內容的底線；數值多大、物品多強都不擋。有格式錯誤也可以存，只是那件內容不會在遊戲裡出現。
 */
const router = useRouter()
const ui = useUi()
useGuides().trigger('g_editor')
const KEY = 'cpp-ui-worldpack-v2'
function loadPack(): WorldEntry[] { try { const r = localStorage.getItem(KEY); if (r) return JSON.parse(r) } catch { /* 用預設 */ } return structuredClone(START_ENTRIES) }
const entries = ref<WorldEntry[]>(loadPack())
watch(entries, v => { try { localStorage.setItem(KEY, JSON.stringify(v)) } catch { /* 存不了就算了 */ } }, { deep: true })
const issues = computed(() => checkWorld(entries.value, BUILTIN))
const errors = computed(() => issues.value.filter(i => i.blocking))
const top = ref('content')
const catId = ref('events')
const cat = computed(() => CATEGORIES.find(c => c.id === catId.value)!)
const kindId = ref('event')
watch(catId, () => { kindId.value = cat.value.kinds.find(k => k.kind)?.id ?? cat.value.kinds[0].id })
const kind = computed(() => cat.value.kinds.find(k => k.id === kindId.value) ?? cat.value.kinds[0])
const scope = ref<'all' | 'pack' | 'err'>('all')
const q = ref('')
const kindsOf = (c: typeof CATEGORIES[number]) => new Set(c.kinds.map(k => k.kind).filter(Boolean))
const countOf = (c: typeof CATEGORIES[number]) => entries.value.filter(e => kindsOf(c).has(e.kind)).length
const errIn = (c: typeof CATEGORIES[number]) => errors.value.some(i => entries.value.some(e => e.id === i.id && kindsOf(c).has(e.kind)))
const catTabs = computed(() => CATEGORIES.map(c => ({ id: c.id, label: `${c.name} ${countOf(c)}`, dot: errIn(c) })))
const kindTabs = computed(() => cat.value.kinds.map(k => ({ id: k.id, label: k.name })))
const list = computed(() => entries.value.map((e, i) => ({ e, i })).filter(({ e }) => e.kind === kind.value.kind)
  .filter(({ e }) => scope.value !== 'pack' || !e.builtin)
  .filter(({ e }) => scope.value !== 'err' || errors.value.some(x => x.id === e.id))
  .filter(({ e }) => !q.value || `${e.id}${e.name}${JSON.stringify(e)}`.includes(q.value)))
const selIdx = ref(0)
watch(kindId, () => { selIdx.value = list.value[0]?.i ?? -1 })
const sel = computed(() => entries.value[selIdx.value] ?? null)
const selIssues = computed(() => (sel.value ? issues.value.filter(i => i.id === sel.value!.id) : []))
const otherIssues = computed(() => issues.value.filter(i => !sel.value || i.id !== sel.value.id))
const mode = ref<'form' | 'json'>('form')
const right = ref('check')
const json = ref('')
const jsonErr = ref<string | null>(null)
watch([sel, mode], () => { json.value = sel.value ? JSON.stringify(sel.value, null, 2) : ''; jsonErr.value = null }, { immediate: true })
const simple = (v: unknown) => typeof v === 'string' || typeof v === 'number'
function setField(k: string, v: string) {
  if (!sel.value) return
  const old = sel.value[k]
  sel.value[k] = typeof old === 'number' ? (v === '' ? '' : Number(v)) : v
}
function saveJson() {
  try {
    const v = JSON.parse(json.value)
    if (!v || typeof v !== 'object' || Array.isArray(v)) throw new Error('要是一個物件')
    entries.value[selIdx.value] = v
    jsonErr.value = null
    ui.toast('存下來了。')
  } catch (e) { jsonErr.value = `JSON 格式錯誤：${(e as Error).message}` }
}
function addNew() {
  const k = kind.value.kind
  if (!k) { ui.toast('這一種在第三版才能新增。', 'warn'); return }
  const id = `${k}_new_${entries.value.length + 1}`
  entries.value.push({ id, kind: k, name: '新的一筆' })
  selIdx.value = entries.value.length - 1
}
function duplicate() { if (sel.value) { entries.value.push({ ...structuredClone(sel.value), id: `${sel.value.id}_copy` }); selIdx.value = entries.value.length - 1 } }
function reset() { entries.value = structuredClone(START_ENTRIES); ui.toast('還原成樣本的世界包。') }
/** 它讀的與它寫的（旗標與計數器），給「用在哪」。 */
const uses = computed(() => {
  const e = sel.value
  if (!e || e.kind !== 'event') return null
  const req = (e.requires ?? {}) as { flags?: string[]; counters?: Record<string, string> }
  const writes: string[] = []
  for (const o of (e.options as Array<Record<string, Record<string, unknown>>> | undefined) ?? []) for (const r of ['success', 'fail', 'any']) { const oc = o[r]; if (oc?.flag) writes.push(String(oc.flag)); if (oc?.counters) writes.push(...Object.entries(oc.counters as Record<string, number>).map(([c, n]) => `${c} ${n > 0 ? '+' : ''}${n}`)) }
  const readers = (f: string) => entries.value.filter(x => ((x.requires as { flags?: string[] } | undefined)?.flags ?? []).includes(f)).map(x => x.name)
  const series = entries.value.find(x => x.kind === 'series' && (x.members as string[]).includes(e.id))
  return { reads: [...(req.flags ?? []), ...Object.keys(req.counters ?? {})], writes, readers, series }
})
const ISSUE_COLOR: Record<string, string> = { FIELD: 'var(--danger)', DUP: 'var(--danger)', REF: 'var(--danger)', AGE: 'var(--hp)', FLOOR: 'var(--hp)', WARN: 'var(--warn)' }

// ---- 匯入與匯出 ----
const imp = reactive<{ name: string; plan: ReturnType<typeof planImport> | null; entries: WorldEntry[]; error: string | null }>({ name: '', plan: null, entries: [], error: null })
async function pickFile(e: Event) {
  const f = (e.target as HTMLInputElement).files?.[0]
  if (!f) return
  imp.name = f.name
  try {
    const d = JSON.parse(await f.text())
    const arr: WorldEntry[] = Array.isArray(d) ? d : Array.isArray(d.entries) ? d.entries : []
    if (!arr.length) throw new Error('裡面沒有內容')
    imp.entries = arr; imp.plan = planImport(arr, entries.value, BUILTIN); imp.error = null
  } catch (err) { imp.plan = null; imp.error = `讀不出來：${(err as Error).message}。` }
  ;(e.target as HTMLInputElement).value = ''
}
function doImport() {
  if (!imp.plan) return
  const ids = new Set(imp.plan.load.map(e => e.id))
  entries.value = [...entries.value.filter(e => !ids.has(e.id)), ...imp.plan.load]
  ui.toast(`載入了 ${imp.plan.load.length} 筆。`)
  imp.plan = null
}
function exportPack(only?: string) {
  const out = only ? entries.value.filter(e => e.series === only || e.id === only) : entries.value
  const blob = new Blob([JSON.stringify({ pack: PACK, entries: out.map(e => ({ ...e, disabled: errors.value.some(i => i.id === e.id) || undefined })) }, null, 2)], { type: 'application/json' })
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = `${PACK.name}${only ? `-${only}` : ''}.json`; a.click()
  setTimeout(() => URL.revokeObjectURL(a.href), 1000)
}
const kindCount = computed(() => Object.entries(entries.value.reduce<Record<string, number>>((m, e) => { m[e.kind] = (m[e.kind] ?? 0) + 1; return m }, {})))
const KIND_NAME: Record<string, string> = { event: '事件', npc: '人物', enemy: '敵人', item: '物品', counter: '計數器', facility: '設施', series: '系列', site: '地點' }
const issueLine = (i: Issue) => `${i.code} ${i.text}`
void issueLine
</script>

<template>
  <div class="we">
    <StatusBar back title="世界編輯器" />
    <header class="topbar">
      <b>世界包「{{ PACK.name }}」</b><span class="k">疊在{{ PACK.base }}上・改內建的內容會存成這個包裡的覆寫</span>
      <span class="grow" />
      <span class="tag" :class="{ warn: errors.length }">格式錯誤 {{ errors.filter(e => e.code !== 'AGE' && e.code !== 'FLOOR').length }}・底線 {{ errors.filter(e => e.code === 'AGE' || e.code === 'FLOOR').length }}</span>
      <button type="button" class="btn sm" @click="ui.toast('試玩用目前的世界包開一局；有錯的內容不會出現。'); router.push('/')">試玩</button>
      <button type="button" class="btn sm pri" @click="exportPack()">匯出世界包</button>
      <Tabs v-model="top" :tabs="[{ id: 'content', label: '內容' }, { id: 'io', label: '匯入與匯出' }]" />
    </header>

    <template v-if="top === 'content'">
      <div class="lv2"><Tabs v-model="catId" :tabs="catTabs" /></div>
      <div class="lv3">
        <Tabs v-model="kindId" :tabs="kindTabs" />
        <span class="grow" />
        <span class="segs"><button v-for="[v, n] in ([['all', '全部'], ['pack', '只看這個世界包'], ['err', '只看有錯的']] as const)" :key="v" type="button" :class="{ on: scope === v }" @click="scope = v">{{ n }}</button></span>
      </div>
      <div class="lockline frame"><span class="lk">LOCK</span><b>框架裡的設定不能在這裡改。</b><Hint>現實與內海兩層世界、粉牆與牆外、橋與沉溺、大潮崩、城市的基本氛圍與題材底線，是系統的骨架，改了規則就不成立，所以不開放。提示詞、世界書與用語對照在 AI 工坊調整。</Hint></div>

      <div v-if="!kind.kind" class="panel cut pad empty-wrap"><p class="empty-note">「{{ kind.name }}」在基本世界裡有內容；這一版的編輯器還不能編輯這一種（第三版）。</p></div>
      <div v-else-if="kind.id === 'counter'" class="cols">
        <section class="panel cut pad span2">
          <p class="h">劇情計數器・目前的值取自存檔「夜班之後」<Hint>遊戲裡不直接顯示這些數字，玩家只能從城市的新聞與事件看出往哪邊走。內建的四個也能在世界包裡改範圍；超出範圍的推動停在邊界。</Hint></p>
          <div v-for="c in COUNTERS" :key="c.id" class="setrow"><span class="nm mono">{{ c.id }}</span><span class="val">{{ c.name }}・{{ c.range[0] }}～{{ c.range[1] }}・現在 {{ c.value }}</span><span class="df">內建</span></div>
          <div v-for="e in entries.filter(x => x.kind === 'counter')" :key="e.id" class="setrow"><span class="nm mono">{{ e.id }}</span><span class="val">{{ e.name }}・{{ (e.range as number[])?.join('～') }}</span><span class="df">這個世界包</span></div>
          <div class="go left"><button type="button" class="btn sm" @click="addNew">新增計數器</button></div>
          <p class="h">條件怎麼寫</p>
          <div class="kv"><span>等於、大於、小於</span><b class="mono">wall >= 2</b></div>
          <div class="kv"><span>區間</span><b class="mono">hizakura in [-1, 1]</b></div>
          <div class="kv"><span>幾個條件</span><b>全部／任一</b></div>
          <div class="kv"><span>改計數器的效果</span><b class="mono">counters: {id: ±N}</b></div>
          <p class="h">傳奇的入口<Hint>一條傳奇是一個系列，開頭條件是一組計數器條件。引擎每天 08:00 檢查一次，符合時放一則通知或事件。</Hint></p>
          <div class="kv"><span>傳奇「{{ LEGEND.name }}」</span><b class="mono">series: {{ LEGEND.series }}・{{ LEGEND.cond }}</b></div>
        </section>
        <aside class="panel cut pad"><p class="h">檢查</p><div v-for="i in issues.filter(x => x.where === 'counter' || x.text.includes('計數器'))" :key="i.id + i.where" class="iss" :style="{ '--c': ISSUE_COLOR[i.code] }"><span class="code mono">{{ i.code }}</span>{{ i.text }}</div></aside>
      </div>
      <div v-else class="cols">
        <aside class="panel cut pad lst">
          <label class="sr-only" for="weq">搜尋</label>
          <input id="weq" v-model="q" class="inp" placeholder="在這一類裡找名字、id 或內文">
          <div class="go left"><button type="button" class="btn sm" @click="addNew">新增</button><ReasonButton sm reason="這個參考實作沒有 AI 呼叫。">用 AI 生成</ReasonButton></div>
          <button v-for="{ e, i } in list" :key="i" type="button" class="lrow" :class="{ on: i === selIdx }" @click="selIdx = i">
            <span class="grow"><b class="ellipsis">{{ e.name }}</b><small class="mono ellipsis">{{ e.id }}</small></span>
            <i v-if="errors.some(x => x.id === e.id)" class="rdot" aria-label="有錯" />
            <small v-if="e.builtin" class="k">內建</small>
          </button>
          <div v-if="!list.length" class="empty-note">沒有符合的內容。</div>
        </aside>
        <section class="panel cut pad ed">
          <template v-if="sel">
            <div class="edh"><div class="grow"><b>{{ sel.name }}</b><small class="mono">{{ sel.id }}・{{ KIND_NAME[sel.kind] }}<template v-if="sel.series">・系列：{{ sel.series }}</template></small></div><Tabs v-model="mode" :tabs="[{ id: 'form', label: '表單' }, { id: 'json', label: 'JSON' }]" /></div>
            <template v-if="mode === 'form'">
              <div v-for="(v, k) in sel" :key="k" class="frow" :class="{ bad: selIssues.some(i => i.where.startsWith(String(k)) && i.blocking) }">
                <span class="fk">{{ k }}</span>
                <input v-if="simple(v) && k !== 'kind'" class="inp" :value="v" :aria-label="String(k)" @change="setField(String(k), ($event.target as HTMLInputElement).value)">
                <span v-else-if="k === 'kind'" class="val mono">{{ v }}</span>
                <pre v-else class="val mono">{{ JSON.stringify(v, null, 1) }}</pre>
              </div>
              <div v-if="sel.kind === 'event'" class="frow"><span class="fk">我要做別的</span><span class="val k">每個擋住行動的事件都會自動加上這一項，交給判定，不用寫。</span></div>
            </template>
            <template v-else>
              <label class="sr-only" for="wejson">JSON</label>
              <textarea id="wejson" v-model="json" class="inp code" rows="18" spellcheck="false" />
              <div v-if="jsonErr" class="blocking">{{ jsonErr }}</div>
              <div class="go"><button type="button" class="btn sm pri" @click="saveJson">存下來</button></div>
            </template>
            <div v-for="i in selIssues.filter(x => x.blocking)" :key="i.where + i.code" class="blocking">{{ i.text }}（{{ i.where }}）</div>
            <div class="go">
              <button type="button" class="btn sm" @click="reset">還原</button>
              <button type="button" class="btn sm" @click="duplicate">複製一份</button>
              <Hint>有格式錯誤也可以存，只是這件內容不會在遊戲裡出現，匯出時也會列出來並標成停用。</Hint>
            </div>
          </template>
          <div v-else class="empty-note">選一筆內容。</div>
        </section>
        <aside class="panel cut pad chk">
          <Tabs v-model="right" :tabs="[{ id: 'check', label: '檢查' }, { id: 'uses', label: '用在哪' }]" />
          <template v-if="right === 'check'">
            <div class="cnt"><span class="mono warn-t">{{ errors.filter(e => e.code !== 'AGE' && e.code !== 'FLOOR').length }} 格式錯誤</span><span class="mono" style="color: var(--hp)">{{ errors.filter(e => e.code === 'AGE' || e.code === 'FLOOR').length }} 內容底線</span><span class="mono k">{{ issues.filter(i => !i.blocking).length }} 提醒</span></div>
            <p class="h">這一件</p>
            <div v-if="!selIssues.length" class="empty-note">沒有問題。</div>
            <div v-for="i in selIssues" :key="i.where + i.code" class="iss" :style="{ '--c': ISSUE_COLOR[i.code] }"><span class="code mono">{{ i.code }}</span>{{ i.text }}<small class="mono">{{ i.where }}</small></div>
            <p class="h">這個世界包的其他地方</p>
            <button v-for="i in otherIssues" :key="i.id + i.where + i.code" type="button" class="iss btnish" :style="{ '--c': ISSUE_COLOR[i.code] }" @click="selIdx = Math.max(0, entries.findIndex(e => e.id === i.id))"><span class="code mono">{{ i.code }}</span>{{ i.text }}</button>
            <div class="note">這裡不檢查強弱：數值多大、物品多強、價格多低都不擋。另外照樣擋的只有內容的底線：所有角色都是成年人、不寫血腥、不寫懷孕。</div>
          </template>
          <template v-else>
            <template v-if="uses">
              <p class="h">它讀的</p>
              <div v-for="r in uses.reads" :key="r" class="kv"><span class="mono">{{ r }}</span><b>{{ BUILTIN.counters.has(r) ? '內建的計數器' : '' }}</b></div>
              <p class="h">它寫的</p>
              <div v-for="w in uses.writes" :key="w" class="kv"><span class="mono">{{ w }}</span><b>{{ uses.readers(w).join('、') || '沒有人讀' }}</b></div>
              <p class="h">在系列裡的位置</p>
              <div v-if="uses.series" class="series"><span v-for="m in (uses.series.members as string[])" :key="m" class="tag" :class="{ hot: m === sel?.id }">{{ entries.find(e => e.id === m)?.name ?? m }}</span></div>
            </template>
            <div v-else class="empty-note">這一種內容的引用關係在第三版接上。</div>
          </template>
        </aside>
      </div>
    </template>

    <div v-else class="io">
      <section class="panel cut pad">
        <p class="h">匯入一個世界包<Hint>匯入走和內建內容同一套驗證。基本世界本身也是一個世界包。引用到不存在的東西的那幾筆先不載入，其餘照常載入；和現有的撞名的 id 會列出來。</Hint></p>
        <label class="btn sm file">選一個檔案<input type="file" accept="application/json,.json" @change="pickFile"></label>
        <div v-if="imp.error" class="blocking">{{ imp.error }}</div>
        <template v-if="imp.plan">
          <div class="kv"><span>{{ imp.name }}</span><b>收到 {{ imp.entries.length }} 筆</b></div>
          <div v-for="i in imp.plan.issues" :key="i.id + i.where + i.code" class="iss" :style="{ '--c': ISSUE_COLOR[i.code] }"><span class="code mono">{{ i.code }}</span>{{ i.text }}</div>
          <div v-if="imp.plan.clashes.length" class="iss" :style="{ '--c': 'var(--warn)' }"><span class="code mono">WARN</span>和現有的 id 撞名 {{ imp.plan.clashes.length }} 個：{{ imp.plan.clashes.join('、') }}；載入時覆寫現有的那一筆</div>
          <div class="go"><button type="button" class="btn sm" @click="imp.plan = null">取消</button><ReasonButton sm pri :reason="imp.plan.load.length ? null : '沒有可以載入的。'" @go="doImport">載入 {{ imp.plan.load.length }} 筆</ReasonButton></div>
        </template>
      </section>
      <section class="panel cut pad">
        <p class="h">匯出</p>
        <div class="setrow"><span class="nm">整個世界包「{{ PACK.name }}」</span><span class="val">{{ entries.length }} 筆・有 {{ new Set(errors.map(e => e.id)).size }} 筆有錯的會一起匯出，並標成停用</span><button type="button" class="btn sm pri" @click="exportPack()">匯出</button></div>
        <div class="setrow"><span class="nm">只匯出系列「帳本」</span><span class="val">一個系列可以單獨匯出成世界包的一部分</span><button type="button" class="btn sm" @click="exportPack('ledger')">匯出</button></div>
        <p class="h">這個世界包裡有</p>
        <div class="chips"><span v-for="[k, n] in kindCount" :key="k" class="tag">{{ KIND_NAME[k] ?? k }} {{ n }}</span></div>
        <div class="note">AI 相關的東西（提示詞、世界書、模型）不在這裡，它們在 AI 工坊。世界編輯器只管遊戲的內容。</div>
      </section>
    </div>
  </div>
</template>

<style scoped>
.we { min-height: 100vh; display: flex; flex-direction: column; }
.topbar { display: flex; gap: 10px; align-items: center; padding: 8px 12px; border-bottom: 2px solid var(--line); flex-wrap: wrap; }
.topbar .k { font-size: 11px; }
.grow { flex: 1; min-width: 0; }
.lv2, .lv3 { padding: 6px 12px 0; display: flex; gap: 10px; align-items: center; min-width: 0; flex-wrap: wrap; }
.lv2 > :first-child, .lv3 > :first-child { min-width: 0; max-width: 100%; }
.frame { margin: 8px 12px 0; }
.cols { display: grid; grid-template-columns: 280px minmax(0, 1fr) 320px; gap: 12px; padding: 12px; align-items: start; }
.span2 { grid-column: span 2; }
.empty-wrap { margin: 12px; }
.lst { display: grid; gap: 4px; }
.lst small { display: block; font-size: 10.5px; color: var(--ink-3); }
.inp { width: 100%; min-width: 0; background: var(--bg-term); color: var(--ink); border: 0; box-shadow: inset 0 0 0 2px var(--line); padding: 7px 9px; font: 600 13px var(--font); }
.code { font: 500 12px/1.5 var(--mono); }
.rdot { width: 8px; height: 8px; border-radius: 50%; background: var(--danger); flex: none; }
.edh { display: flex; gap: 10px; align-items: center; margin-bottom: 8px; }
.edh small { display: block; color: var(--ink-3); }
.frow { display: grid; grid-template-columns: 110px minmax(0, 1fr); gap: 8px; align-items: start; padding: 5px 0; border-bottom: 1px dashed var(--line); }
.frow.bad { box-shadow: inset 3px 0 0 var(--danger); padding-left: 6px; }
.fk { font: 800 11.5px var(--mono); color: var(--ink-3); padding-top: 7px; }
.val { font-size: 12px; margin: 0; white-space: pre-wrap; overflow-wrap: anywhere; padding-top: 6px; }
.chk { display: grid; gap: 6px; }
.cnt { display: flex; gap: 10px; flex-wrap: wrap; font-size: 12px; font-weight: 800; }
.iss { display: grid; grid-template-columns: auto 1fr; gap: 2px 8px; padding: 6px 8px; background: var(--bg-2); box-shadow: inset 3px 0 0 var(--c); font-size: 12px; text-align: left; border: 0; color: var(--ink); width: 100%; }
.iss small { grid-column: 2; color: var(--ink-3); }
.btnish { cursor: pointer; }
.code.mono { font-size: 10px; font-weight: 900; color: var(--c); }
.note { font-size: 11.5px; color: var(--ink-3); line-height: 1.6; margin-top: 6px; }
.series { display: flex; gap: 4px; flex-wrap: wrap; }
.io { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); gap: 12px; padding: 12px; align-items: start; }
.file { position: relative; overflow: hidden; margin-bottom: 8px; }
.file input { position: absolute; inset: 0; opacity: 0; cursor: pointer; }
.go.left { justify-content: flex-start; margin-top: 4px; }
@media (max-width: 1200px) { .cols { grid-template-columns: 240px minmax(0, 1fr); } .chk { grid-column: 1 / -1; } .span2 { grid-column: 1 / -1; } }
@media (max-width: 720px) { .cols, .io { grid-template-columns: minmax(0, 1fr); padding: 8px; } .frow { grid-template-columns: 1fr; } .topbar .k { display: none; } }
</style>
