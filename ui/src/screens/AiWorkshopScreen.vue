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
import { TASK_GROUPS, ALL_TASKS, SOURCES, CHAINS, VARIABLES, SETS, RECENT, defaultSource } from '../data/workshop'
import { useGuides } from '../lib/useGuides'

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
    { n: '硬規則 {{hard_rules}}', len: 1180, cache: true, src: '預設・鎖住' },
    { n: '內容界線 {{limits}}', len: 320, cache: true, src: '由篩選產生・只讀' },
    { n: '城市常駐條目', len: 1460, cache: true, src: '預設' },
    { n: `任務規則・${task.value.name}`, len: 640, cache: true, src: '預設' },
    { n: '前段自訂', len: blk.value.pre.length, cache: true, src: blk.value.pre ? '改過' : '空' },
    { n: '世界書：四十二番街、露露餐館', len: 820, cache: false, src: '觸發' },
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
    <div class="lockline frame"><span class="lk">LOCK</span><b>有些東西在這裡看得到，但是不能改。</b><Hint>硬規則 H1～H15、由內容篩選產生的內容界線、輸出格式、工具定義與退路都鎖住。任務的清單與任務鏈的主幹由遊戲決定，不能新增任務。遊戲的內容在世界編輯器裡改，這裡只管它們怎麼送給 AI。</Hint></div>

    <div v-if="top === 'shop'" class="cols">
      <!-- 左：樹 -->
      <nav class="panel cut pad tree" aria-label="AI 工坊的分類">
        <button v-for="[c, n] in CAT_NAMES" :key="c" type="button" class="lrow" :class="{ on: cat === c }" @click="cat = c">{{ n }}</button>
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
          <label class="fld"><span>前段自訂<Hint>前段在快取段裡（斷點①②之前），每次都會變的變數放這裡會讓快取失效。</Hint></span><textarea v-model="blk.pre" class="inp" rows="4" /></label>
          <label class="fld"><span>後段自訂</span><textarea v-model="blk.post" class="inp" rows="4" /></label>
          <div class="setrow"><span class="nm">來源</span><select v-model="src" class="inp sel"><option v-for="o in SOURCES" :key="o.id" :value="o.id">{{ o.name }}</option></select><span class="df">設定裡也有</span></div>
          <div class="setrow"><span class="nm">溫度</span><input v-model.number="blk.temp" class="inp sel" type="number" min="0" max="2" step="0.1"><span class="df">預設 0.8</span></div>
          <div class="setrow"><span class="nm">自動重試<Hint>設定裡的那一格一次設全部；這裡改的是同一個值。</Hint></span><span class="segs"><button v-for="n in [0, 1, 2, 3]" :key="n" type="button" :class="{ on: s.retries === n }" @click="s.retries = n">{{ n }}</button></span><span class="df">設定裡也有</span></div>
          <div class="go"><button type="button" class="btn sm" @click="blk.pre = ''; blk.post = ''">恢復預設</button><ReasonButton sm reason="這個參考實作沒有 AI 呼叫。">請 AI 看一下</ReasonButton></div>
        </template>
        <template v-else-if="cat === 'chains'">
          <h3>任務鏈・總覽<Hint>「關掉」的意思是那一步改由程式照規則結算（任務鏈列上標「用了退路」或「略過」），步驟本身還在鏈上。</Hint></h3>
          <div v-for="r in CHAIN_TOGGLES" :key="r.k" class="setrow" :class="{ chg: !st.isDefault(r.k), off: r.k !== 'useAi' && !s.useAi }">
            <span class="nm">{{ r.name }}</span>
            <button type="button" class="switch" role="switch" :aria-label="r.name" :aria-checked="s[r.k]" :class="{ on: s[r.k] }" @click="s[r.k] = !s[r.k]" />
            <span class="df">{{ r.inSettings ? '設定裡也有' : '只在工坊' }}</span>
          </div>
          <div class="setrow"><span class="nm">戰鬥正文</span><span class="segs"><button v-for="v in ['結束時整場寫一次', '每回合一小段'] as const" :key="v" type="button" :class="{ on: s.combatProse === v }" @click="s.combatProse = v">{{ v }}</button></span><span class="df">只在工坊</span></div>
          <p class="setgrp">用 AI 還是照規則</p>
          <div v-for="(v, k) in s.aiRecord" :key="k" class="setrow"><span class="nm">{{ RECORD_NAMES[k] }}</span><button type="button" class="switch" role="switch" :aria-label="RECORD_NAMES[k]" :aria-checked="v" :class="{ on: v }" @click="s.aiRecord[k] = !v" /><span class="df">{{ v ? '用 AI' : '照規則' }}</span></div>
          <p class="setgrp">Agent 掛點<Hint>五種掛點各自的開關與每天的件數上限。設定裡的三格（提出事件、鉤子、其他）是同一組值。</Hint></p>
          <div v-for="(v, k) in s.hooks" :key="k" class="setrow" :class="{ off: !s.agentMode }"><span class="nm">{{ HOOK_NAMES[k] }}</span><button type="button" class="switch" role="switch" :aria-label="HOOK_NAMES[k]" :aria-checked="v" :class="{ on: v }" @click="s.hooks[k] = !v" /><span class="df mono">{{ k }}</span></div>
          <div v-for="[k, n] in ([['event', '提出事件'], ['hook', '鉤子'], ['other', '其他']] as const)" :key="k" class="setrow"><span class="nm">每天的上限・{{ n }}</span><span class="stepper"><button type="button" :aria-label="`${n}減一`" @click="stepLimit(k, -1)">−</button><b>{{ s.hookLimits[k] }}</b><button type="button" :aria-label="`${n}加一`" @click="stepLimit(k, 1)">＋</button></span><span class="df">設定裡也有</span></div>
          <p class="setgrp">二十三條鏈</p>
          <div class="chips"><span v-for="c in CHAINS" :key="c" class="tag">{{ c }}</span></div>
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
        <template v-else>
          <h3>{{ CAT_NAMES.find(c => c[0] === cat)![1] }}</h3>
          <template v-if="cat === 'shared'">
            <div class="setrow"><span class="nm">硬規則</span><span class="val">H1～H15</span><span class="df">只讀</span></div>
            <div class="setrow"><span class="nm">內容界線</span><span class="val">由內容篩選產生</span><span class="df">只讀</span></div>
            <div class="setrow"><span class="nm">文風</span><span class="val">霓虹黑色</span><span class="df">可改</span></div>
            <div class="setrow"><span class="nm">城市常駐條目</span><span class="val">城市總覽、用語、氛圍・合計 1,460／1,500 字</span><span class="df">可改</span></div>
            <div class="setrow"><span class="nm">正文正則</span><span class="val">4 條，全部開著</span><span class="df">可改</span></div>
          </template>
          <div v-else class="empty-note">{{ cat === 'lore' ? '世界書只寫散文：氣氛、歷史、用語、人物與勢力的公開面貌；規則與數字不放這裡。' : '生圖：預處理、分鏡、畫風預設、成人與非成人的路由、負面提示詞。' }}這一頁的編輯在第三版。</div>
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
        <div class="go"><button type="button" class="btn sm" @click="ui.toast('複製了一份。')">複製目前這一組</button><button type="button" class="btn sm" @click="ui.toast('和預設比較在第三版。')">和預設比較</button><button type="button" class="btn sm" @click="ui.toast('匯出時會自動拿掉 API 金鑰與服務商的私人網址。')">匯出這一組</button></div>
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
.lrow.sub { padding: 5px 8px; font-size: 12.5px; }
.lrow.sub small { font-size: 10px; color: var(--ink-3); }
.cdot { width: 6px; height: 6px; border-radius: 50%; background: var(--a); flex: none; }
.ed h3 { margin: 0 0 10px; font-size: 18px; display: flex; gap: 8px; align-items: center; }
.ed h3 small { color: var(--ink-3); font-size: 12px; }
.locked { display: flex; justify-content: space-between; padding: 10px 12px; margin: 8px 0; background: repeating-linear-gradient(135deg, var(--bg-2) 0 8px, var(--bg-1) 8px 12px); font-size: 13px; }
.fld { display: grid; gap: 4px; font-size: 12px; font-weight: 800; color: var(--ink-2); margin-bottom: 8px; }
.fld > span { display: inline-flex; gap: 4px; align-items: center; }
.inp { width: 100%; min-width: 0; background: var(--bg-term); color: var(--ink); border: 0; box-shadow: inset 0 0 0 2px var(--line); padding: 7px 9px; font: 500 13px var(--font); }
textarea.inp { font-family: var(--mono); font-size: 12px; }
.sel { max-width: 220px; }
.mt { margin-top: 8px; }
.pv { display: grid; gap: 4px; }
.pblk { display: flex; gap: 6px; align-items: center; padding: 5px 8px; background: var(--bg-2); font-size: 11.5px; }
.pblk.cache { box-shadow: inset 3px 0 0 var(--ram); }
.pblk small { color: var(--ink-3); font-size: 10px; white-space: nowrap; }
.iss { padding: 6px 8px; background: var(--bg-2); box-shadow: inset 3px 0 0 var(--warn); font-size: 12px; display: grid; gap: 2px; }
.code { font-size: 10px; font-weight: 900; color: var(--warn); }
.setrow .nm small { margin-left: 6px; font-size: 10px; }
@media (max-width: 1200px) { .cols { grid-template-columns: 220px minmax(0, 1fr); } .pv { grid-column: 1 / -1; } }
@media (max-width: 720px) { .cols { grid-template-columns: minmax(0, 1fr); padding: 8px; } .tree { max-height: 260px; overflow: auto; } }
</style>
