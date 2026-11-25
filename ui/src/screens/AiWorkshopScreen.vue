<script setup lang="ts">
import { computed, reactive, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import StatusBar from '../components/StatusBar.vue'
import Tabs from '../components/Tabs.vue'
import Hint from '../components/Hint.vue'
import ReasonButton from '../components/ReasonButton.vue'
import { useSettings, type Settings } from '../stores/settings'
import { useGame } from '../stores/game'
import { useUi } from '../stores/ui'
import { TASK_GROUPS, ALL_TASKS, SOURCES, CHAINS, VARIABLES, SETS, RECENT, defaultSource, CHAIN_FLOWS, type ChainStep } from '../data/workshop'
import ChainFlow from '../components/ChainFlow.vue'
import { useGuides } from '../lib/useGuides'
import { LORE_DEFAULTS, LORE_MODES, BUDGET_DEFAULTS, BUDGET_NAMES, IMAGE_DEFAULTS, LOCKED_NEGATIVE, IMAGE_ROUTES, budgetUse, lineDiff, loreChanges, type LoreEntry, type BudgetKey } from '../lib/lorebook'

/**
 * AI 工坊（PROMPTS 第 2 節、樣稿 docs/mockups/ai-workshop.html）。和世界編輯器同一套殼：左樹、中編輯、右預覽與用在哪。
 * 和設定共用同一個 settings store（PROMPTS 2.14 節）：設定裡也有的項目標「設定裡也有」，兩邊改的是同一個值。
 * 這個參考實作不送出任何請求；預覽只把一份請求照順序排出來。
 */
const route = useRoute()
const router = useRouter()
const st = useSettings()
const s = st.s
const g = useGame()
const ui = useUi()
useGuides().trigger('g_ai')
const top = ref('shop')
type Cat = 'task' | 'chains' | 'shared' | 'lore' | 'image' | 'route' | 'log' | 'sets'
const CAT_NAMES: Array<[Cat, string]> = [['task', '任務'], ['chains', '任務鏈'], ['shared', '共用的提示詞'], ['lore', '世界書'], ['image', '生圖'], ['route', '模型與路由'], ['log', '紀錄與回報']]
const cat = ref<Cat>('task')
const q = route.query.cat
if (q === 'sets') top.value = 'sets'
else if (typeof q === 'string' && CAT_NAMES.some(([c]) => c === q)) cat.value = q as Cat
const taskId = ref('narrate')
const task = computed(() => ALL_TASKS.find(t => t.id === taskId.value)!)

// 玩家改的提示詞塊存在這台機器（PROMPTS 第 12 節第 3 項：提示詞組存在瀏覽器，所有存檔共用）
const PKEY = 'cpp-ui-prompts-v2'
const SAMPLE = { stream_chat: { pre: '', post: '彈幕裡偶爾叫一下 {{viewer}} 的名字。', temp: 0.8 }, flavor_shop: { pre: '今天是 {{time}}，貨架照時段換。', post: '', temp: 0.8 } }
const custom = reactive<Record<string, { pre: string; post: string; temp: number }>>((() => { try { const r = localStorage.getItem(PKEY); if (r) return JSON.parse(r) } catch { /* 用樣本 */ } return structuredClone(SAMPLE) })())
watch(custom, v => { try { localStorage.setItem(PKEY, JSON.stringify(v)) } catch { /* 存不了就算了 */ } }, { deep: true })
watch(taskId, id => { if (!custom[id]) custom[id] = { pre: '', post: '', temp: 0.8 } }, { immediate: true })
const blk = computed(() => custom[taskId.value])
const src = computed({ get: () => s.taskSource[taskId.value] ?? defaultSource(task.value), set: v => { s.taskSource[taskId.value] = v } })

/** 檢查（PROMPTS 2.10 節）：字典裡沒有的變數、放錯地方（前段在快取段，每次都會變的變數讓快取失效）。 */
const checks = computed(() => {
  const out: Array<{ code: string; text: string }> = []
  for (const [tid, b] of Object.entries(custom)) {
    const name = ALL_TASKS.find(t => t.id === tid)?.name ?? tid
    for (const m of `${b.pre}\n${b.post}`.matchAll(/\{\{[^}]+\}\}/g)) if (!VARIABLES.some(v => v.v === m[0])) out.push({ code: 'VAR', text: `${name}的自訂用了 ${m[0]}，字典裡沒有這個變數。那一塊照樣存，但預覽與送出時它會換成空字串。` })
    for (const m of b.pre.matchAll(/\{\{[^}]+\}\}/g)) if (VARIABLES.find(v => v.v === m[0] && !v.cache)) out.push({ code: 'CACHE', text: `${name}的前段自訂用了 ${m[0]}：前段在快取段裡，每次都會變的變數會讓快取失效。建議移到後段自訂。` })
  }
  return out
})
const agent = ref(false)
const adultRoute = ref(false)
const recent = ref(RECENT[0])
/** 預覽：照實際的順序排出請求的每一塊，標字數、是否在快取段、來源。 */
const preview = computed(() => {
  const rows = [
    { n: '硬規則 {{hard_rules}}', len: 1180, cache: true, src: '預設・鎖住（H5、H16、H17 可改）' },
    { n: '內容界線 {{limits}}', len: 320, cache: true, src: '由篩選產生・只讀' },
    { n: '城市常駐條目', len: 1460, cache: true, src: '預設' },
    { n: `任務規則・${task.value.name}`, len: 640, cache: true, src: '預設' },
    { n: '前段自訂', len: blk.value.pre.length, cache: true, src: blk.value.pre ? '改過' : '空' },
    { n: `世界書：依區、依層、關鍵字（${lore.entries.filter(e => loreUse.value.state[e.uid] === '送' && e.mode !== 'constant').length} 條）`, len: loreUse.value.used.place + loreUse.value.used.keyword, cache: false, src: '觸發' },
    { n: '紀錄：最近五樓', len: 2100, cache: false, src: '注入配方' },
    { n: '後段自訂', len: blk.value.post.length, cache: false, src: blk.value.post ? '改過' : '空' },
    { n: `這一次：${recent.value}`, len: 260, cache: false, src: '存檔' },
  ]
  if (agent.value) rows.splice(4, 0, { n: '工具定義：查詢', len: 900, cache: true, src: '預設・鎖住' })
  if (adultRoute.value) rows.splice(3, 0, { n: '成人場景規則、戰敗規則', len: 740, cache: true, src: '預設' })
  return rows
})
type BoolKey = { [K in keyof Settings]: Settings[K] extends boolean ? K : never }[keyof Settings]
const CHAIN_TOGGLES: Array<{ k: BoolKey; name: string; inSettings: boolean }> = [
  { k: 'useAi', name: '使用 AI（總開關）', inSettings: true }, { k: 'judgeFree', name: '判定：自由行動', inSettings: true }, { k: 'judgeShift', name: '判定：打工的一班', inSettings: true },
  { k: 'judgeEvent', name: '判定：事件的「我要做別的」', inSettings: true }, { k: 'narrate', name: '敘事', inSettings: true }, { k: 'tradeProse', name: '交易要不要寫正文', inSettings: false },
  { k: 'polish', name: '潤色（一次開關全部）', inSettings: true }, { k: 'clampRequested', name: '玩家要求的結果也夾值', inSettings: true }, { k: 'agentMode', name: 'Agent 模式', inSettings: true }, { k: 'onlyQuery', name: '只開查詢', inSettings: false },
]
const RECORD_NAMES: Record<string, string> = { sexRecord: '記下性經歷', todayGoods: '今天的貨', newPeople: '新的人的細節', npcNews: 'NPC 的近況', streamGoal: '直播目標的說法', danmaku: '彈幕', footageTitle: '素材的標題' }
const HOOK_NAMES: Record<string, string> = { agent_hook: '寫完正文之後', agent_event: '走進一個街區', agent_night: '長休醒來', agent_commission: '接委託時', agent_flavor: '進店與見到新的人' }
const varValue = (v: string) => ({ '{{city}}': '緋夜城', '{{language}}': '繁體中文', '{{style}}': '霓虹黑色', '{{time}}': `第 ${g.day} 天 ${g.timeLabel}`, '{{place}}': g.placeLabel, '{{actor.name}}': g.character.name, '{{actor.attrs.charm}}': String(g.character.attrs.find(a => a.name === '魅力')?.eff), '{{cast[0].name}}': g.facility?.npcIds?.[0] ? g.npcs[g.facility.npcIds[0]].name : '（沒有）', '{{cap.cash_max}}': '120' } as Record<string, string>)[v] ?? '（只讀）'
// ---- 世界書（PROMPTS 第 9 節）：條目、注入方式、字數預算；存在這個瀏覽器（提示詞組的一部分） ----
const LKEY = 'cpp-ui-lore-v1'
const loadLS = <T,>(k: string, def: T): T => { try { const r = localStorage.getItem(k); if (r) return JSON.parse(r) } catch { /* 用預設 */ } return structuredClone(def) }
const lore = reactive<{ entries: LoreEntry[]; budgets: Record<BudgetKey, number> }>(loadLS(LKEY, { entries: LORE_DEFAULTS, budgets: BUDGET_DEFAULTS }))
watch(lore, v => { try { localStorage.setItem(LKEY, JSON.stringify(v)) } catch { /* 存不了就算了 */ } }, { deep: true })
const loreId = ref(lore.entries[0]?.uid ?? '')
const loreSel = computed(() => lore.entries.find(e => e.uid === loreId.value) ?? null)
const loreUse = computed(() => budgetUse(lore.entries, lore.budgets))
const DISTRICT_IDS = ['hive', 'ave42', 'sakura', 'crown', 'oldport', 'glass', 'rust', 'under']
function addLore() { const uid = `wb_new_${lore.entries.length + 1}`; lore.entries.push({ uid, comment: '新的條目', key: [], content: '', order: 50, mode: 'keyword' }); loreId.value = uid }
function resetLore(uid: string) { const d = LORE_DEFAULTS.find(x => x.uid === uid); const i = lore.entries.findIndex(x => x.uid === uid); if (d && i >= 0) lore.entries[i] = structuredClone(d); else if (i >= 0) { lore.entries.splice(i, 1); loreId.value = lore.entries[0]?.uid ?? '' } }
function stepBudget(k: BudgetKey, d: number) { lore.budgets[k] = Math.max(0, Math.min(40000, lore.budgets[k] + d)) }
const keysText = computed({ get: () => loreSel.value?.key.join('、') ?? '', set: v => { if (loreSel.value) loreSel.value.key = v.split(/[,，、]/).map(x => x.trim()).filter(Boolean) } })
// ---- 生圖（PROMPTS 第 10 節） ----
const IKEY = 'cpp-ui-image-v1'
const img = reactive(loadLS(IKEY, IMAGE_DEFAULTS))
watch(img, v => { try { localStorage.setItem(IKEY, JSON.stringify(v)) } catch { /* 存不了就算了 */ } }, { deep: true })
function resetImage() { Object.assign(img, structuredClone(IMAGE_DEFAULTS)); ui.toast('生圖恢復預設了。') }
// ---- 世界的固定規則（PROMPTS 2.5 節：H5 成年、H16 不寫血腥、H17 不寫懷孕；預設帶著，玩家可以改寫、刪掉、恢復預設；使用者 2026-11-25） ----
const WORLD_RULES = [
  { id: 'H5', name: '所有人物都是成年人', def: '所有登場的人物都是成年人。' },
  { id: 'H16', name: '不寫血腥', def: '受傷與倒下用狀態與動作帶過，不寫斷肢、內臟、大量出血的細節。' },
  { id: 'H17', name: '不寫懷孕', def: '不寫受孕、懷孕、孕期與生育（這個遊戲沒有這套系統）。' },
] as const
const WKEY = 'cpp-ui-world-rules-v1'
const worldRules = reactive<Record<string, string>>(loadLS(WKEY, Object.fromEntries(WORLD_RULES.map(r => [r.id, r.def]))))
watch(worldRules, v => { try { localStorage.setItem(WKEY, JSON.stringify(v)) } catch { /* 存不了就算了 */ } }, { deep: true })
function resetWorldRule(id: string) { const d = WORLD_RULES.find(r => r.id === id); if (d) { worldRules[id] = d.def; ui.toast(`${id} 恢復預設了。`) } }
// ---- 和預設比較（提示詞組與匯入） ----
const showDiff = ref(false)
const taskDiffs = computed(() => Object.entries(custom).filter(([, b]) => b.pre || b.post || b.temp !== 0.8).map(([id, b]) => ({ id, name: ALL_TASKS.find(t => t.id === id)?.name ?? id, pre: lineDiff('', b.pre), post: lineDiff('', b.post), temp: b.temp })))
const loreDiffs = computed(() => loreChanges(lore.entries))
const imageDiffs = computed(() => (['preprocess', 'storyboard', 'negative', 'negativeAdult'] as const).filter(k => img[k] !== IMAGE_DEFAULTS[k]).map(k => ({ k, lines: lineDiff(IMAGE_DEFAULTS[k], img[k]) })))
const settingDiffs = computed(() => (['useAi', 'judgeFree', 'judgeShift', 'judgeEvent', 'narrate', 'polish', 'clampRequested', 'agentMode', 'tradeProse', 'onlyQuery', 'combatProse', 'retries', 'chainRow'] as const).filter(k => !st.isDefault(k)).map(k => ({ k, now: String(s[k]), def: String(st.defaults[k]) })))
const budgetDiffs = computed(() => (Object.keys(BUDGET_DEFAULTS) as BudgetKey[]).filter(k => lore.budgets[k] !== BUDGET_DEFAULTS[k]))
const diffCount = computed(() => taskDiffs.value.length + loreDiffs.value.length + imageDiffs.value.length + settingDiffs.value.length + budgetDiffs.value.length)
// ---- 任務鏈的流程圖 ----
const chainName = ref('自由行動')
const chainSteps = computed(() => CHAIN_FLOWS[chainName.value] ?? [])
function stepOn(x: ChainStep): boolean {
  if (!x.opt) return true
  if (x.opt === 'combatProse') return s.combatProse === '每回合一小段'
  if (x.opt.startsWith('aiRecord.')) return !!s.aiRecord[x.opt.slice(9)]
  return !!(s as unknown as Record<string, unknown>)[x.opt]
}
function toggleStep(x: ChainStep) {
  if (!x.opt) return
  if (x.opt === 'combatProse') s.combatProse = s.combatProse === '每回合一小段' ? '結束時整場寫一次' : '每回合一小段'
  else if (x.opt.startsWith('aiRecord.')) { const k = x.opt.slice(9); s.aiRecord[k] = !s.aiRecord[k] }
  else (s as unknown as Record<string, boolean>)[x.opt] = !stepOn(x)
  ui.toast(`「${x.n}」${stepOn(x) ? '打開了' : '關掉了：改由程式照規則結算'}。`)
}
function stepLimit(k: 'event' | 'hook' | 'other', d: number) { const v = s.hookLimits[k] + d; if (v < 0 || v > 20) return; s.hookLimits[k] = v }
</script>

<template>
  <div class="aw">
    <StatusBar back title="AI 工坊" />
    <header class="topbar">
      <b>提示詞組「{{ s.promptSet }}」</b>
      <span class="tag" :class="{ warn: checks.length }">檢查：錯誤 {{ checks.filter(c => c.code === 'VAR').length }}、警告 {{ checks.filter(c => c.code !== 'VAR').length }}</span>
      <span class="grow" />
      <button type="button" class="btn sm" @click="router.push('/'); ui.openRoot('settings', { tab: 'ai' })">回到設定</button>
      <button type="button" class="btn sm pri" @click="ui.toast('存下來了；提示詞組存在這個瀏覽器，所有存檔共用。')">存下來</button>
      <Tabs v-model="top" :tabs="[{ id: 'shop', label: '工坊' }, { id: 'vars', label: '變數字典' }, { id: 'sets', label: '提示詞組與匯入' }]" />
    </header>
    <div class="lockline frame"><span class="lk">LOCK</span><b>有些東西在這裡看得到，但是不能改。</b><Hint>硬規則 H1～H15（其中 H5、H16、H17 是世界的固定規則，可以在下面改）、由內容篩選產生的內容界線、輸出格式、工具定義與退路都鎖住。任務的清單與任務鏈的主幹由遊戲決定，不能新增任務。遊戲的內容在世界編輯器裡改，這裡只管它們怎麼送給 AI。</Hint></div>

    <div v-if="top === 'shop'" class="cols">
      <!-- 左：樹 -->
      <nav class="panel cut pad tree" aria-label="AI 工坊的分類">
        <button v-for="[c, n] in CAT_NAMES" :key="c" type="button" class="lrow" :class="{ on: cat === c }" @click="cat = c">{{ n }}</button>
        <template v-if="cat === 'lore'">
          <p class="h grp">條目 {{ lore.entries.length }}</p>
          <button v-for="e in [...lore.entries].sort((a, b) => a.order - b.order)" :key="e.uid" type="button" class="lrow sub" :class="{ on: loreId === e.uid, 'is-off': e.mode === 'off' }" :data-lore="e.uid" @click="loreId = e.uid">
            <span class="grow">{{ e.comment }}</span><small>{{ LORE_MODES.find(m => m.id === e.mode)?.name }}</small><small v-if="loreUse.state[e.uid] === '超出預算'" class="warn-t">超出</small>
          </button>
          <button type="button" class="btn sm" data-addlore @click="addLore">新增條目</button>
        </template>
        <template v-if="cat === 'task'">
          <template v-for="grp in TASK_GROUPS" :key="grp.name">
            <p class="h grp">{{ grp.name }}</p>
            <button v-for="t in grp.tasks" :key="t.id" type="button" class="lrow sub" :class="{ on: taskId === t.id }" @click="taskId = t.id">
              <i v-if="custom[t.id]?.pre || custom[t.id]?.post" class="cdot" aria-label="改過" /><span class="grow">{{ t.name }}</span><small class="mono">{{ t.id }}</small>
            </button>
          </template>
        </template>
      </nav>

      <!-- 中：編輯區 -->
      <section class="panel cut pad ed">
        <template v-if="cat === 'task'">
          <h3>{{ task.name }} <small class="mono">{{ task.id }}</small></h3>
          <div class="kv"><span>什麼時候跑</span><b>{{ task.when }}</b></div>
          <div class="kv"><span>模型的大小</span><b>{{ task.model }}</b></div>
          <div class="locked"><b>任務規則與硬規則</b><span class="k">鎖住：硬規則</span></div>
          <p class="setgrp">世界的固定規則<Hint title="世界的固定規則">H5、H16、H17 預設寫在每個任務的規則裡，這裡可以改寫、清空（等於刪掉）或恢復預設。只有年齡是底線：建角、匯入與世界編輯器都會擋下低於 18 的年齡。</Hint></p>
          <div v-for="r in WORLD_RULES" :key="r.id" class="fld"><span>{{ r.id }}・{{ r.name }}</span><textarea v-model="worldRules[r.id]" class="inp" rows="2" :aria-label="`${r.id} ${r.name}`" /><button type="button" class="btn sm" @click="resetWorldRule(r.id)">恢復預設</button></div>
          <label class="fld"><span>前段自訂<Hint>前段在快取段裡（斷點①②之前），每次都會變的變數放這裡會讓快取失效。</Hint></span><textarea v-model="blk.pre" class="inp" rows="4" /></label>
          <label class="fld"><span>後段自訂</span><textarea v-model="blk.post" class="inp" rows="4" /></label>
          <div class="setrow"><span class="nm">來源</span><select v-model="src" class="inp sel"><option v-for="o in SOURCES" :key="o.id" :value="o.id">{{ o.name }}</option></select><span class="df">設定裡也有</span></div>
          <div class="setrow"><span class="nm">溫度</span><input v-model.number="blk.temp" class="inp sel" type="number" min="0" max="2" step="0.1"><span class="df">預設 0.8</span></div>
          <div class="setrow"><span class="nm">自動重試<Hint>設定裡的那一格一次設全部；這裡改的是同一個值。</Hint></span><span class="segs"><button v-for="n in [0, 1, 2, 3]" :key="n" type="button" :class="{ on: s.retries === n }" @click="s.retries = n">{{ n }}</button></span><span class="df">設定裡也有</span></div>
          <div class="go"><button type="button" class="btn sm" @click="blk.pre = ''; blk.post = ''">恢復預設</button><ReasonButton sm reason="這個參考實作沒有 AI 呼叫。">請 AI 看一下</ReasonButton></div>
        </template>
        <template v-else-if="cat === 'chains'">
          <h3>任務鏈・總覽<Hint>「關掉」的意思是那一步改由程式照規則結算（任務鏈列上標「用了退路」或「略過」），步驟本身還在鏈上。</Hint></h3>
          <p class="setgrp">二十三條鏈<Hint>每一條鏈的步驟與依賴（AI_TASKS 第 3 節）。灰掉的那幾條的流程圖在第四版補上。</Hint></p>
          <div class="chips"><button v-for="c in CHAINS" :key="c" type="button" class="tag chainbtn" :class="{ hot: chainName === c, 'is-unavailable': !CHAIN_FLOWS[c] }" :aria-disabled="!CHAIN_FLOWS[c] || undefined" :data-chain="c" @click="CHAIN_FLOWS[c] ? (chainName = c) : ui.toast(`「${c}」的流程圖在第四版補上。`, 'warn')">{{ c }}</button></div>
          <div class="cflow"><ChainFlow :steps="chainSteps" :on="stepOn" @toggle="toggleStep" /></div>
          <ol class="clist">
            <li v-for="(x, i) in chainSteps" :key="i" :class="x.kind"><b>{{ x.n }}</b><small>{{ { code: '程式', ai: 'AI', wait: '等玩家', apply: '套用' }[x.kind] }}{{ x.task ? `・${x.task}` : '' }}{{ x.deps.length ? `・接在 ${x.deps.join('、')} 之後` : '' }}</small>
              <button v-if="x.opt" type="button" class="switch" :class="{ on: stepOn(x) }" :aria-pressed="stepOn(x)" :aria-label="x.n" @click="toggleStep(x)" /><span v-if="x.inSettings" class="t-fine">設定裡也有</span></li>
          </ol>
          <p class="setgrp">開關</p>
          <div class="grid2" style="--col-min: 300px">
          <div v-for="r in CHAIN_TOGGLES" :key="r.k" class="setrow" :class="{ chg: !st.isDefault(r.k), off: r.k !== 'useAi' && !s.useAi }">
            <span class="nm">{{ r.name }}</span>
            <button type="button" class="switch" role="switch" :aria-label="r.name" :aria-checked="s[r.k]" :class="{ on: s[r.k] }" @click="s[r.k] = !s[r.k]" />
            <span class="df">{{ r.inSettings ? '設定裡也有' : '只在工坊' }}</span>
          </div>
          <div class="setrow"><span class="nm">戰鬥正文</span><span class="segs"><button v-for="v in ['結束時整場寫一次', '每回合一小段'] as const" :key="v" type="button" :class="{ on: s.combatProse === v }" @click="s.combatProse = v">{{ v }}</button></span><span class="df">只在工坊</span></div>
          </div>
          <p class="setgrp">用 AI 還是照規則</p>
          <div class="grid2" style="--col-min: 300px"><div v-for="(v, k) in s.aiRecord" :key="k" class="setrow"><span class="nm">{{ RECORD_NAMES[k] }}</span><button type="button" class="switch" role="switch" :aria-label="RECORD_NAMES[k]" :aria-checked="v" :class="{ on: v }" @click="s.aiRecord[k] = !v" /><span class="df">{{ v ? '用 AI' : '照規則' }}</span></div></div>
          <p class="setgrp">Agent 掛點<Hint>五種掛點各自的開關與每天的件數上限。設定裡的三格（提出事件、鉤子、其他）是同一組值。</Hint></p>
          <div v-for="(v, k) in s.hooks" :key="k" class="setrow" :class="{ off: !s.agentMode }"><span class="nm">{{ HOOK_NAMES[k] }}</span><button type="button" class="switch" role="switch" :aria-label="HOOK_NAMES[k]" :aria-checked="v" :class="{ on: v }" @click="s.hooks[k] = !v" /><span class="df mono">{{ k }}</span></div>
          <div v-for="[k, n] in ([['event', '提出事件'], ['hook', '鉤子'], ['other', '其他']] as const)" :key="k" class="setrow"><span class="nm">每天的上限・{{ n }}</span><span class="stepper"><button type="button" :aria-label="`${n}減一`" @click="stepLimit(k, -1)">−</button><b>{{ s.hookLimits[k] }}</b><button type="button" :aria-label="`${n}加一`" @click="stepLimit(k, 1)">＋</button></span><span class="df">設定裡也有</span></div>

        </template>
        <template v-else-if="cat === 'route'">
          <h3>模型與路由</h3>
          <div v-for="o in SOURCES" :key="o.id" class="setrow"><span class="nm">{{ o.name }}</span><span class="val">{{ o.sub }}</span><span :class="o.tools ? 'ok-t' : 'warn-t'" class="mono">{{ o.tools ? '連線 ✓' : '工具調用 ✕' }}</span></div>
          <p class="setgrp">每個任務的模型<Hint>工具調用沒有通過的來源，不能用在要開 Agent 的任務上。成人路由的五個來源沒有備用模型。</Hint></p>
          <div v-for="t in ALL_TASKS" :key="t.id" class="setrow"><span class="nm">{{ t.name }}<small class="mono k">{{ t.id }}</small></span><select :value="s.taskSource[t.id] ?? defaultSource(t)" class="inp sel" :aria-label="`${t.name}的來源`" @change="s.taskSource[t.id] = ($event.target as HTMLSelectElement).value"><option v-for="o in SOURCES" :key="o.id" :value="o.id">{{ o.name }}</option></select><span class="df">{{ t.model }}</span></div>
        </template>
        <template v-else-if="cat === 'log'">
          <h3>紀錄與回報</h3>
          <div class="setrow"><span class="nm">任務鏈列</span><span class="segs"><button v-for="v in ['出錯時展開', '一直展開', '隱藏'] as const" :key="v" type="button" :class="{ on: s.chainRow === v }" @click="s.chainRow = v">{{ v }}</button></span><span class="df">設定裡也有</span></div>
          <div class="setrow"><span class="nm">自動重試（全部）</span><span class="segs"><button v-for="n in [0, 1, 2, 3]" :key="n" type="button" :class="{ on: s.retries === n }" @click="s.retries = n">{{ n }}</button></span><span class="df">設定裡也有</span></div>
          <div class="setrow"><span class="nm">逾時</span><span class="val">閒置 3 分鐘，所有任務一致</span><span class="df">只讀</span></div>
          <p class="setgrp">用量統計</p>
          <div class="empty-note">這個參考實作沒有送出過請求。</div>
        </template>
        <template v-else-if="cat === 'lore'">
          <h3>世界書<Hint title="世界書">只寫散文：氣氛、歷史、用語、人物與勢力的公開面貌、地方的樣子。規則與數字不放世界書。格式照 SillyTavern 的世界書，本遊戲的欄位放在 extensions.cpp。秘密靠 gate 保護：拆成「公開」與「揭露後」兩條，後者要旗標或沉溺才存在。</Hint></h3>
          <template v-if="loreSel">
            <label class="fld"><span>名稱（comment）</span><input v-model="loreSel.comment" class="inp"></label>
            <div class="setrow"><span class="nm">注入方式<Hint><p v-for="m in LORE_MODES" :key="m.id"><b>{{ m.name }}</b>：{{ m.when }}。</p></Hint></span><span class="segs"><button v-for="m in LORE_MODES" :key="m.id" type="button" :class="{ on: loreSel.mode === m.id }" :data-mode="m.id" @click="loreSel.mode = m.id">{{ m.name }}</button></span></div>
            <label v-if="loreSel.mode === 'keyword'" class="fld"><span>關鍵字（key）<Hint>比對前繁簡兩種寫法都比。用逗號或頓號分開。</Hint></span><input v-model="keysText" class="inp"></label>
            <div v-if="loreSel.mode === 'district'" class="setrow"><span class="nm">哪些區</span><span class="segs"><button v-for="d in DISTRICT_IDS" :key="d" type="button" :class="{ on: loreSel.districts?.includes(d) }" @click="loreSel.districts = loreSel.districts?.includes(d) ? loreSel.districts.filter(x => x !== d) : [...(loreSel.districts ?? []), d]">{{ d }}</button></span></div>
            <div v-if="loreSel.mode === 'layer'" class="setrow"><span class="nm">哪一層</span><span class="segs"><button v-for="l in (['net', 'meat'] as const)" :key="l" type="button" :class="{ on: loreSel.layer === l }" @click="loreSel.layer = l">{{ l === 'net' ? '內海' : '現實' }}</button></span></div>
            <div class="grid2" style="--col-min: 200px">
              <div class="setrow"><span class="nm">排序（order）</span><input v-model.number="loreSel.order" class="inp sel" type="number" min="0" max="999"></div>
              <div class="setrow"><span class="nm">成人向<Hint>只在成人路由送。</Hint></span><button type="button" class="switch" :class="{ on: loreSel.adult }" :aria-pressed="!!loreSel.adult" aria-label="成人向" @click="loreSel.adult = !loreSel.adult" /></div>
            </div>
            <div class="setrow" :class="{ off: loreSel.builtin }"><span class="nm">揭露條件（gate）<Hint>內建條目的 topics 與 gate 只讀；玩家新增的條目可以設。</Hint></span><span class="val">{{ loreSel.gate ? `旗標 ${(loreSel.gate.flags ?? []).join('、') || '—'}・沉溺 ${loreSel.gate.minSink ?? 0} 以上` : '沒有（一直存在）' }}</span><span class="df">{{ loreSel.builtin ? '只讀' : '可改' }}</span></div>
            <label class="fld"><span>內容（content）・{{ loreSel.content.length }} 字・{{ loreUse.state[loreSel.uid] }}</span><textarea v-model="loreSel.content" class="inp" rows="7" /></label>
            <div class="go"><button type="button" class="btn sm" @click="resetLore(loreSel.uid)">{{ LORE_DEFAULTS.some(x => x.uid === loreSel!.uid) ? '恢復預設' : '刪掉這一條' }}</button><button type="button" class="btn sm" @click="loreSel.mode = loreSel.mode === 'off' ? 'keyword' : 'off'">{{ loreSel.mode === 'off' ? '啟用' : '停用' }}</button></div>
          </template>
          <p class="setgrp">字數預算<Hint>超過時依 order 保留前面的；超出的標「超出預算」，預覽裡看得到。城市常駐超過只警告、不截。成人常駐另計，只在成人路由。</Hint></p>
          <div v-for="(n, k) in lore.budgets" :key="k" class="setrow budget" :class="{ chg: n !== BUDGET_DEFAULTS[k] }">
            <span class="nm">{{ BUDGET_NAMES[k] }}</span>
            <span class="val"><span class="bbar"><i :style="{ width: `${Math.min(100, (loreUse.used[k] / Math.max(1, n)) * 100)}%` }" :class="{ over: loreUse.used[k] > n }" /></span>{{ loreUse.used[k].toLocaleString('en-US') }}／{{ n.toLocaleString('en-US') }}</span>
            <span class="stepper"><button type="button" :aria-label="`${BUDGET_NAMES[k]}減少`" @click="stepBudget(k, -500)">−</button><button type="button" :aria-label="`${BUDGET_NAMES[k]}增加`" @click="stepBudget(k, 500)">＋</button></span>
          </div>
        </template>
        <template v-else-if="cat === 'image'">
          <h3>生圖<Hint title="生圖">照搬那邊的兩個任務（image_prompt、storyboard）。介面本身的美術不畫露骨的圖；這一頁只管玩家自己用生圖產生的紀錄插圖與立繪。</Hint></h3>
          <label class="fld"><span>預處理（image_prompt）</span><textarea v-model="img.preprocess" class="inp" rows="3" /></label>
          <div class="locked"><b>所有人物都是成年人</b><span class="k">世界的固定規則 H5：到「工坊」的任務頁改</span></div>
          <label class="fld"><span>分鏡（storyboard）</span><textarea v-model="img.storyboard" class="inp" rows="3" /></label>
          <p class="setgrp">畫風預設</p>
          <div class="row-list"><button v-for="x in img.styles" :key="x.id" type="button" class="lrow" :class="{ on: img.style === x.id }" @click="img.style = x.id"><span class="grow"><b>{{ x.name }}</b><small class="mono">{{ x.tags }}</small></span></button></div>
          <p class="setgrp">標籤對照<Hint>義體、獸化、服裝的風格、體型對應到生圖的標籤。內容篩選關掉的題材的標籤不出現在對照表裡。</Hint></p>
          <div v-for="(t, i) in img.tagMap" :key="i" class="setrow"><span class="nm">{{ t.k }}</span><input v-model="t.v" class="inp" :aria-label="`${t.k}的標籤`"></div>
          <p class="setgrp">負面提示詞</p>
          <div class="locked"><span class="mono">{{ LOCKED_NEGATIVE }}</span><span class="k">鎖住：年齡相關，只能往後加</span></div>
          <label class="fld"><span>一般（往後加）</span><input v-model="img.negative" class="inp"></label>
          <label class="fld"><span>成人（往後加）</span><input v-model="img.negativeAdult" class="inp"></label>
          <p class="setgrp">路由<Hint>只讀。</Hint></p>
          <div v-for="r in IMAGE_ROUTES" :key="r.what" class="kv"><span>{{ r.what }}</span><b>{{ r.route }}</b></div>
          <div class="go"><button type="button" class="btn sm" @click="resetImage">恢復預設</button></div>
        </template>
        <template v-else>
          <h3>{{ CAT_NAMES.find(c => c[0] === cat)![1] }}</h3>
          <template v-if="cat === 'shared'">
            <div class="setrow"><span class="nm">硬規則</span><span class="val">H1～H15</span><span class="df">只讀</span></div>
            <div class="setrow"><span class="nm">內容界線</span><span class="val">由內容篩選產生</span><span class="df">只讀</span></div>
            <div class="setrow"><span class="nm">文風</span><span class="val">霓虹黑色</span><span class="df">可改</span></div>
            <div class="setrow"><span class="nm">城市常駐條目</span><span class="val">城市總覽、用語、氛圍・合計 1,460／1,500 字</span><span class="df">可改</span></div>
            <div class="setrow"><span class="nm">正文正則</span><span class="val">4 條，全部開著</span><span class="df">可改</span></div>
          </template>

        </template>
      </section>

      <!-- 右：預覽 -->
      <aside class="panel cut pad pv">
        <p class="h">預覽<Hint>這裡只照當下的設定把請求排出來，不送出任何東西。改一個字，這裡就重排一次。</Hint></p>
        <select v-model="recent" class="inp" aria-label="選一則最近的紀錄"><option v-for="r in RECENT" :key="r">{{ r }}</option></select>
        <div class="segs mt"><button type="button" :class="{ on: !agent }" @click="agent = false">Agent 關</button><button type="button" :class="{ on: agent }" @click="agent = true">Agent 開</button><button type="button" :class="{ on: !adultRoute }" @click="adultRoute = false">一般路由</button><button type="button" :class="{ on: adultRoute }" @click="adultRoute = true">成人路由</button></div>
        <div v-for="r in preview" :key="r.n" class="pblk" :class="{ cache: r.cache }"><span class="grow">{{ r.n }}</span><small class="mono">{{ r.len }} 字</small><small>{{ r.src }}</small></div>
        <p class="h mt">檢查</p>
        <div v-if="!checks.length" class="empty-note">沒有問題。</div>
        <div v-for="c in checks" :key="c.text" class="iss"><span class="mono code">{{ c.code }}</span>{{ c.text }}</div>
      </aside>
    </div>

    <div v-else-if="top === 'vars'" class="one">
      <section class="panel cut pad">
        <p class="h">變數字典・現在的值取自存檔「夜班之後」<Hint>注入的資料欄位也列在這一頁，每一種資料展開成它的欄位與現在的值。快取段只放不會變的變數。</Hint></p>
        <div v-for="v in VARIABLES" :key="v.v" class="setrow"><span class="nm mono">{{ v.v }}</span><span class="val">{{ v.what }}・{{ varValue(v.v) }}</span><span class="df">{{ v.cache ? '可以放快取段' : '每次都會變' }}</span></div>
      </section>
    </div>

    <div v-else class="one">
      <section class="panel cut pad">
        <p class="h">提示詞組<Hint>存在這個瀏覽器，所有存檔共用；存檔只記用哪一組。</Hint></p>
        <div v-for="x in SETS" :key="x.name" class="setrow" :class="{ chg: s.promptSet === x.name }"><span class="nm">{{ x.name }}</span><span class="val">{{ x.note }}</span><ReasonButton sm :pri="s.promptSet !== x.name" :reason="s.promptSet === x.name ? '已經在用這一組。' : null" @go="s.promptSet = x.name">{{ s.promptSet === x.name ? '使用中' : '切換' }}</ReasonButton></div>
        <div class="go"><button type="button" class="btn sm" @click="ui.toast('複製了一份。')">複製目前這一組</button><button type="button" class="btn sm" :class="{ pri: showDiff }" data-diff @click="showDiff = !showDiff">和預設比較（{{ diffCount }} 處）</button><button type="button" class="btn sm" @click="ui.toast('匯出時會自動拿掉 API 金鑰與服務商的私人網址。')">匯出這一組</button></div>
        <div v-if="showDiff" class="diff" data-diffview>
          <p class="setgrp">和預設比較・{{ diffCount }} 處<Hint>綠色的 + 是這一組加的，紅色的 − 是預設有、這一組拿掉的。</Hint></p>
          <div v-if="!diffCount" class="empty-note">和預設一模一樣。</div>
          <template v-for="t in taskDiffs" :key="t.id">
            <p class="h">任務・{{ t.name }}<small class="mono k">{{ t.id }}</small></p>
            <pre class="dl"><template v-for="(l, i) in [...t.pre.map(x => ({ ...x, text: `前段：${x.text}` })), ...t.post.map(x => ({ ...x, text: `後段：${x.text}` }))]" :key="i"><span :class="l.op === '+' ? 'add' : l.op === '-' ? 'del' : ''">{{ l.op }} {{ l.text }}</span>
</template><span v-if="t.temp !== 0.8" class="add">+ 溫度：0.8 → {{ t.temp }}</span></pre>
          </template>
          <template v-if="loreDiffs.length">
            <p class="h">世界書</p>
            <div v-for="c in loreDiffs" :key="c.uid" class="kv"><span>{{ c.name }}</span><b :class="c.kind === '刪除' ? 'warn-t' : c.kind === '新增' ? 'ok-t' : ''">{{ c.kind }}{{ c.fields.length ? `：${c.fields.join('、')}` : '' }}</b></div>
          </template>
          <div v-for="k in budgetDiffs" :key="k" class="kv"><span>預算・{{ BUDGET_NAMES[k] }}</span><b>{{ BUDGET_DEFAULTS[k] }} → {{ lore.budgets[k] }}</b></div>
          <template v-for="d in imageDiffs" :key="d.k">
            <p class="h">生圖・{{ d.k }}</p>
            <pre class="dl"><span v-for="(l, i) in d.lines" :key="i" :class="l.op === '+' ? 'add' : l.op === '-' ? 'del' : ''">{{ l.op }} {{ l.text }}
</span></pre>
          </template>
          <template v-if="settingDiffs.length">
            <p class="h">任務鏈的開關（和設定共用）</p>
            <div v-for="d in settingDiffs" :key="d.k" class="kv"><span class="mono">{{ d.k }}</span><b>{{ d.def }} → {{ d.now }}</b></div>
          </template>
        </div>
        <p class="setgrp">匯入 SillyTavern 的預設<Hint>只匯入預設裡的提示詞條目、取樣參數與正則。酒館助手的腳本與其他擴充的腳本不能在這款遊戲裡執行，匯入時會被略過。和本遊戲硬規則、內容界線衝突的寫法不會生效。</Hint></p>
        <div class="kv"><span>提示詞條目</span><b>變成前段或後段的自訂，標「匯入」</b></div>
        <div class="kv"><span>取樣參數</span><b>放進模型與路由</b></div>
        <div class="kv"><span>預設自帶的正則</span><b>放進正文正則，預設停用</b></div>
        <div class="kv"><span>酒館助手腳本</span><b>略過，列出名稱</b></div>
        <div class="go"><ReasonButton sm reason="這個參考實作還不讀 SillyTavern 的檔案。">選一個檔案</ReasonButton></div>
      </section>
    </div>
  </div>
</template>

<style scoped>
.aw { min-height: 100vh; display: flex; flex-direction: column; }
.topbar { display: flex; gap: 10px; align-items: center; padding: 8px 12px; border-bottom: 2px solid var(--line); flex-wrap: wrap; }
.grow { flex: 1; min-width: 0; }
.frame { margin: 8px 12px 0; }
.cols { display: grid; grid-template-columns: 250px minmax(0, 1fr) 320px; gap: 12px; padding: 12px; align-items: start; }
.one { padding: 12px; max-width: 1000px; }
.tree { display: grid; gap: 3px; }
.tree .grp { margin: 10px 0 2px; }
.lrow.sub { padding: 5px 8px; font-size: var(--fs-sm); }
.lrow.sub small { font-size: var(--fs-tiny); color: var(--ink-3); }
.cdot { width: 6px; height: 6px; border-radius: 50%; background: var(--a); flex: none; }
.ed h3 { margin: 0 0 10px; font-size: var(--fs-section); display: flex; gap: 8px; align-items: center; }
.ed h3 small { color: var(--ink-3); font-size: var(--fs-sm); }
.locked { display: flex; justify-content: space-between; max-width: 880px; padding: 10px 12px; margin: 8px 0; background: repeating-linear-gradient(135deg, var(--bg-2) 0 8px, var(--bg-1) 8px 12px); font-size: var(--fs-ui); }
.fld { display: grid; gap: 4px; font-size: var(--fs-sm); font-weight: 800; color: var(--ink-2); margin-bottom: 8px; }
.fld > span { display: inline-flex; gap: 4px; align-items: center; }
.inp { width: 100%; min-width: 0; background: var(--bg-term); color: var(--ink); border: 0; box-shadow: inset 0 0 0 2px var(--line); padding: 7px 9px; font: 500 var(--fs-ui) var(--font); }
textarea.inp { font-family: var(--mono); font-size: var(--fs-sm); }
.sel { max-width: 220px; }
.mt { margin-top: 8px; }
.pv { display: grid; gap: 4px; }
.pblk { display: flex; gap: 6px; align-items: center; padding: 5px 8px; background: var(--bg-2); font-size: var(--fs-fine); }
.pblk.cache { box-shadow: inset 3px 0 0 var(--ram); }
.pblk small { color: var(--ink-3); font-size: var(--fs-tiny); white-space: nowrap; }
.iss { padding: 6px 8px; background: var(--bg-2); box-shadow: inset 3px 0 0 var(--warn); font-size: var(--fs-sm); display: grid; gap: 2px; }
.code { font-size: var(--fs-tiny); font-weight: 900; color: var(--warn); }
.setrow .nm small { margin-left: 6px; font-size: var(--fs-tiny); }
.is-off { opacity: .55; }
.chainbtn { border: 0; cursor: pointer; }
.cflow { margin-top: 10px; }
.clist { display: none; margin: 10px 0 0; padding-left: 20px; }
.clist li { margin-bottom: 6px; display: flex; flex-wrap: wrap; gap: 6px; align-items: center; }
.clist li small { color: var(--ink-3); font-size: var(--fs-fine); }
.clist li.ai b { color: var(--a); } .clist li.apply b { color: var(--ok); } .clist li.wait b { color: var(--ap); }
@media (max-width: 720px) { .cflow { display: none; } .clist { display: block; } }
.budget .val { display: flex; align-items: center; gap: 8px; }
.bbar { flex: 1; height: 8px; background: var(--bg-term); position: relative; min-width: 60px; }
.bbar i { position: absolute; inset: 0 auto 0 0; background: var(--ram); }
.bbar i.over { background: var(--warn); }
.diff { margin-top: 12px; }
.dl { margin: 4px 0 8px; padding: 8px 10px; background: var(--bg-term); font: var(--fs-xs)/1.6 var(--mono); white-space: pre-wrap; overflow-wrap: anywhere; }
.dl .add { color: var(--ok); } .dl .del { color: var(--danger); text-decoration: line-through; }
@media (max-width: 1200px) { .cols { grid-template-columns: 220px minmax(0, 1fr); } .pv { grid-column: 1 / -1; } }
@media (max-width: 720px) { .cols { grid-template-columns: minmax(0, 1fr); padding: 8px; } .tree { max-height: 260px; overflow: auto; } }
</style>
