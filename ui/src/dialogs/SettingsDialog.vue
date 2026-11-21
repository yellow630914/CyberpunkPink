
<script setup lang="ts">
import { ref } from 'vue'
import Dialog from '../components/Dialog.vue'
import Tabs from '../components/Tabs.vue'
import Hint from '../components/Hint.vue'
import ReasonButton from '../components/ReasonButton.vue'
import { useSettings, type Settings } from '../stores/settings'
import { useGame } from '../stores/game'
import { useUi } from '../stores/ui'
import { useSaves } from '../stores/saves'
import { useRouter } from 'vue-router'
import RuleFields from '../components/RuleFields.vue'
import { SHORTCUTS } from '../lib/keys'

/**
 * 設定（UI.md 第 15 節，樣稿 docs/mockups/settings.html 的七個分頁）。這是簡單版：每頁放幾列，說明都收進「?」。
 * 「存檔」頁真的把這份假存檔存進瀏覽器（localStorage），讀得回來。
 */
const props = defineProps<{ entryId: number; stacked?: boolean; tab?: string }>()
void ReasonButton
const router = useRouter()
function toWorkshop(cat: string) { ui.closeAll(); router.push({ path: '/workshop', query: { cat } }) }
const st = useSettings()
const s = st.s
const g = useGame()
const ui = useUi()
const tab = ref(props.tab ?? 'game')
const TABS = [
  { id: 'src', label: 'AI 來源' }, { id: 'ai', label: 'AI 開關' }, { id: 'prompt', label: '提示詞' }, { id: 'filter', label: '內容篩選' },
  { id: 'game', label: '遊戲' }, { id: 'display', label: '顯示' }, { id: 'save', label: '存檔' },
]
type BoolKey = { [K in keyof Settings]: Settings[K] extends boolean ? K : never }[keyof Settings]
const AI_ROWS: Array<{ k: BoolKey; name: string; hint: string }> = [
  { k: 'useAi', name: '使用 AI', hint: '關掉時每一步都走程式的退路：判定照骰值與參考 DC，正文換成戰報，遊戲照樣能玩完。' },
  { k: 'judgeFree', name: '判定：自由行動', hint: '自由行動的結果交給 AI 判定；關掉時照骰值。' },
  { k: 'judgeShift', name: '判定：打工的一班', hint: '打工的一班交給 AI 判定。' },
  { k: 'judgeEvent', name: '判定：事件的「我要做別的」', hint: '事件裡自己寫的選項交給 AI 判定。' },
  { k: 'narrate', name: '敘事', hint: '交易與戰鬥的正文。' },
  { k: 'polish', name: '潤色', hint: '正文寫完後再潤一次；比較慢。' },
  { k: 'clampRequested', name: '玩家要求的結果也夾值', hint: '你在自由行動裡要求的結果，也照規則夾在允許的範圍裡。' },
  { k: 'agentMode', name: 'Agent 模式', hint: 'AI 可以自己用查詢工具。預設關；細項在 AI 工坊。' },
]
const FILTER_ROWS: Array<{ k: BoolKey; name: string; hint: string }> = [
  { k: 'filterRestraint', name: '拘束', hint: '關掉時拘束類的事件與家具用途（遊戲間）不出現。' },
  { k: 'filterDollChip', name: '人偶晶片的失憶工作', hint: '關掉時人偶館只能開清醒的店，相關打工的階段不顯示。' },
  { k: 'filterPublic', name: '公開場合', hint: '關掉時發生在公開場合的成人事件不觸發。' },
  { k: 'filterContract', name: '契約', hint: '關掉時契約面板與契約人的事件不出現。' },
  { k: 'filterIntimateBody', name: '身體的私密描寫', hint: '關掉時建角不問私處的樣子，角色的成人分頁也不顯示。' },
]
const sv = useSaves()
function save(i: number) { const err = sv.saveTo(i); ui.toast(err ?? `存到了第 ${i + 1} 格。`, err ? 'warn' : 'info') }
function load(i: number) { const err = sv.loadFrom('slots', i); ui.toast(err ?? `讀了第 ${i + 1} 格。`, err ? 'warn' : 'info') }
</script>

<template>
  <Dialog :entry-id="entryId" :stacked="stacked" title="設定" :sub="`存檔「夜班之後」・第 ${g.day} 天`" size="lg">
    <template #header><Tabs v-model="tab" :tabs="TABS" /></template>
    <section class="panel cut pad">
      <template v-if="tab === 'src'">
        <p class="sgrp">模型來源・3／8<Hint>連線測試除了送一句話，還測結構化輸出與工具調用。工具調用沒有通過的來源，不能用在要開 Agent 的任務上。全部 30 個任務的模型與參數在 AI 工坊。</Hint></p>
        <div class="src"><b>主力</b><small>Anthropic・金鑰只存在這台機器</small><span class="ok">連線 ✓</span></div>
        <div class="src"><b>便宜的小模型</b><small>相容 OpenAI 的服務・本機的伺服器</small><span class="ok">連線 ✓</span></div>
        <div class="src"><b>成人路由</b><small>相容 OpenAI 的服務</small><span class="bad">工具調用 ✕</span></div>
        <div class="go"><ReasonButton sm reason="這個參考實作沒有 AI 呼叫，來源只是假資料。">新增來源</ReasonButton><ReasonButton sm reason="這個參考實作沒有 AI 呼叫，連不出去。">全部測一次</ReasonButton><button type="button" class="btn sm" @click="toWorkshop('route')">更細的在 AI 工坊</button></div>
      </template>

      <template v-else-if="tab === 'ai'">
        <p class="sgrp">AI 開關<Hint>更細的在 AI 工坊：每一條任務鏈的每一步、每種掛點各自的上限。這一頁改的和那裡是同一份設定。</Hint></p>
        <div class="grid2">
        <div v-for="r in AI_ROWS" :key="r.k" class="srow" :class="{ chg: !st.isDefault(r.k), off: r.k !== 'useAi' && !s.useAi }">
          <span class="nm2">{{ r.name }}<Hint :text="r.hint" /></span>
          <button type="button" class="sw" role="switch" :aria-checked="s[r.k]" :aria-label="r.name" :class="{ on: s[r.k] }" @click="s[r.k] = !s[r.k]" />
          <span class="df">預設 <b>{{ st.defaults[r.k] ? '開' : '關' }}</b></span>
        </div>
        </div>
        <div class="srow"><span class="nm2">自動重試<Hint>每個任務出錯時自動重試幾次；這一格一次設全部，AI 工坊裡可以每個任務各自設。</Hint></span><span class="val">{{ s.retries }} 次</span><span class="seg"><button v-for="n in [0, 1, 2, 3]" :key="n" type="button" :class="{ on: s.retries === n }" @click="s.retries = n">{{ n }}</button></span></div>
        <div class="go"><button type="button" class="btn sm" @click="toWorkshop('chains')">更細的在 AI 工坊</button></div>
        <div class="srow"><span class="nm2">逾時<Hint>收到文字、思考或工具呼叫就重新計時。這一項不能調。</Hint></span><span class="val">閒置 3 分鐘</span><span class="df">固定</span></div>
      </template>

      <template v-else-if="tab === 'prompt'">
        <p class="sgrp">提示詞都在 AI 工坊</p>
        <div class="srow"><span class="nm2">目前的提示詞組</span><span class="val">{{ s.promptSet }}</span><button type="button" class="btn sm" @click="toWorkshop('sets')">切換</button></div>
        <div class="srow"><span class="nm2">文風</span><span class="val">霓虹黑色</span><button type="button" class="btn sm" @click="toWorkshop('shared')">編輯</button></div>
        <div class="srow"><span class="nm2">正文正則</span><span class="val">4 條，全部開著</span><button type="button" class="btn sm" @click="toWorkshop('shared')">編輯</button></div>
      </template>

      <template v-else-if="tab === 'filter'">
        <div class="lock"><span class="lk">LOCK</span><b>所有角色皆為成年人。</b><Hint>這一條不能關。生成的人年齡下限是 18；建角、匯入與世界編輯器都會擋下低於 18 的年齡。</Hint></div>
        <div class="lock"><span class="lk">LOCK</span><b>不寫血腥，不寫懷孕。</b><Hint>這是內容的底線，不是篩選的選項，所以沒有開關。</Hint></div>
        <p class="sgrp">題材<Hint>內容篩選存在存檔裡。關掉一項時，相關的事件不觸發，戰敗事件改走不含那個題材的分支。感載與橋參數同時是戰鬥與竄網的規則，不受篩選影響。</Hint></p>
        <div class="grid2">
        <div v-for="r in FILTER_ROWS" :key="r.k" class="srow" :class="{ chg: !st.isDefault(r.k) }">
          <span class="nm2">{{ r.name }}<Hint :text="r.hint" /></span>
          <button type="button" class="sw" role="switch" :aria-checked="s[r.k]" :aria-label="r.name" :class="{ on: s[r.k] }" @click="s[r.k] = !s[r.k]" />
          <span class="df">預設 <b>開</b></span>
        </div>
        </div>
      </template>

      <template v-else-if="tab === 'game'">
        <RuleFields />
      </template>

      <template v-else-if="tab === 'display'">
        <p class="sgrp">顯示<Hint>這一頁是這台機器的偏好，所有存檔共用。</Hint></p>
        <div class="grid2">
        <div class="srow" :class="{ chg: !st.isDefault('fontSize') }">
          <span class="nm2">字級</span>
          <span class="seg"><button v-for="[v, n] in [['small', '小'], ['normal', '中'], ['large', '大']] as const" :key="v" type="button" :class="{ on: s.fontSize === v }" @click="s.fontSize = v">{{ n }}</button></span>
          <span class="df">預設 <b>中</b></span>
        </div>
        <div class="srow" :class="{ chg: !st.isDefault('proseFont') }">
          <span class="nm2">正文字型</span>
          <span class="seg"><button v-for="v in ['黑體', '宋體'] as const" :key="v" type="button" :class="{ on: s.proseFont === v }" @click="s.proseFont = v">{{ v }}</button></span>
          <span class="df">預設 <b>黑體</b></span>
        </div>
        <div class="srow" :class="{ chg: !st.isDefault('neon') }">
          <span class="nm2">霓虹強度<Hint>面板的呼吸燈與發光。關掉時只留粉色的焦點。</Hint></span>
          <span class="seg"><button v-for="v in ['關', '弱', '標準'] as const" :key="v" type="button" :class="{ on: s.neon === v }" @click="s.neon = v">{{ v }}</button></span>
          <span class="df">預設 <b>標準</b></span>
        </div>
        <div v-for="[k, n, h] in ([['reduceMotion', '減少動態', '關掉 DNA 鏈的流動、量條的波浪與走路的動畫。'], ['districtAccent', '區的強調色', '進入一個區時，介面的強調色換成那一區的顏色。關掉時全程用紫。'], ['foldAdult', '成人報告卡摺疊', '紀錄裡的成人場景摺成一行，點開才顯示。'], ['guidePopups', '跳出指南', '第一次遇到一個系統時跳出指南。']] as Array<[BoolKey, string, string]>)" :key="k" class="srow" :class="{ chg: !st.isDefault(k) }">
          <span class="nm2">{{ n }}<Hint :text="h" /></span>
          <button type="button" class="sw" role="switch" :aria-checked="s[k]" :aria-label="n" :class="{ on: s[k] }" @click="s[k] = !s[k]" />
          <span class="df">預設 <b>{{ st.defaults[k] ? '開' : '關' }}</b></span>
        </div>
        </div>
        <div class="go"><button type="button" class="btn sm" @click="st.reset()">全部恢復預設</button></div>
        <p class="sgrp">快捷鍵<Hint>在主畫面、家園、子網、地下城有用；打字時與對話框開著時，移動與字母鍵不作用（Esc 照樣關對話框）。這一版不能改鍵。</Hint></p>
        <div class="grid2 keys">
          <div v-for="k in SHORTCUTS" :key="k.name" class="krow"><span class="kk"><kbd v-for="x in k.keys" :key="x">{{ x }}</kbd></span><span>{{ k.name }}</span></div>
        </div>
      </template>

      <template v-else>
        <p class="sgrp">讀檔與存檔<Hint>存檔只存在這台機器的瀏覽器裡（localStorage）；要換機器就用「讀檔與存檔」裡的匯出。委託副本的快照與回退也在那裡。</Hint></p>
        <div class="grid2">
        <div v-for="(slot, i) in sv.slots" :key="i" class="srow">
          <span class="nm2">第 {{ i + 1 }} 格</span>
          <span class="val">{{ slot ? slot.label : '空' }}</span>
          <span class="seg"><button type="button" @click="save(i)">存到這裡</button><button type="button" :class="{ 'is-unavailable': !slot }" :aria-disabled="!slot || undefined" :title="slot ? undefined : '這一格是空的。'" @click="slot ? load(i) : ui.toast('這一格是空的。', 'warn')">讀取</button></span>
        </div>
        </div>
        <div class="go"><button type="button" class="btn sm pri" @click="ui.open('saves')">打開讀檔與存檔</button></div>
      </template>
    </section>
  </Dialog>
</template>

<style scoped>
.sgrp { font-size: var(--fs-sm); font-weight: 900; letter-spacing: 2px; color: var(--ink-2); margin: 16px 0 8px; display: flex; align-items: center; gap: 8px; }
.sgrp::after { content: ""; flex: 1; height: 2px; background: var(--line); }
.sgrp:first-child { margin-top: 0; }
.grid2 > .srow { margin-bottom: 0; }
.keys { --col-min: 260px; }
.krow { display: flex; gap: var(--space-4); align-items: center; padding: var(--space-3) var(--space-4); background: var(--bg-2); font-size: var(--fs-sm); }
.kk { display: inline-flex; gap: 3px; min-width: 112px; flex-wrap: wrap; }
.srow { display: grid; grid-template-columns: minmax(120px, 1fr) auto auto; gap: 6px 14px; align-items: center; padding: 10px 12px; background: var(--bg-2); margin-bottom: 5px; font-size: var(--fs-sm); }
.srow.chg { box-shadow: inset 3px 0 0 var(--a); }
.srow.off { opacity: .42; filter: grayscale(.85); }
.nm2 { font-weight: 800; font-size: var(--fs-ui); display: flex; align-items: center; gap: 6px; }
.df { font-size: var(--fs-fine); color: var(--ink-3); text-align: right; }
.df b { color: var(--ink-2); }
.val { font: 800 var(--fs-sm) var(--mono); color: var(--ink); min-width: 0; overflow-wrap: anywhere; }
.seg { display: inline-flex; gap: 3px; flex-wrap: wrap; }
.seg button { font-size: var(--fs-sm); font-weight: 800; padding: 6px 11px; background: var(--bg-term); color: var(--ink-3); border: 0; cursor: pointer; white-space: nowrap; }
.seg button.on { background: var(--a); color: #fff; }
.sw { width: 42px; height: 22px; border-radius: 11px; background: var(--bg-term); box-shadow: inset 0 0 0 2px var(--line); position: relative; cursor: pointer; border: 0; padding: 0; }
.sw::after { content: ""; position: absolute; top: 4px; left: 4px; width: 14px; height: 14px; border-radius: 50%; background: var(--ink-3); transition: left var(--dur-fast); }
.sw.on { background: var(--a); box-shadow: none; }
.sw.on::after { left: 24px; background: #fff; }
.src { display: grid; grid-template-columns: 1fr auto; gap: 2px 10px; padding: 10px 12px; background: var(--bg-2); margin-bottom: 6px; font-size: var(--fs-sm); }
.src small { grid-column: 1; color: var(--ink-3); }
.src .ok, .src .bad { grid-row: 1 / span 2; grid-column: 2; align-self: center; font: 800 var(--fs-fine) var(--mono); }
.src .ok { color: var(--ram); } .src .bad { color: var(--warn); }
.lock { display: flex; gap: 10px; align-items: center; padding: 10px 12px; background: #2A1A2A; box-shadow: inset 3px 0 0 var(--hp); font-size: var(--fs-ui); margin-bottom: 6px; }
.lk { font: 900 var(--fs-tiny) var(--mono); color: var(--hp); border: 1px solid var(--hp); padding: 1px 5px; border-radius: 4px; }
.diffs { display: grid; grid-template-columns: repeat(6, minmax(0, 1fr)); gap: 6px; }
.dcard { padding: 12px 6px; background: var(--bg-2); border: 0; color: var(--ink); font-weight: 800; cursor: pointer; }
.dcard.on { background: var(--bg-3); box-shadow: inset 0 0 0 2px var(--a); }
@media (max-width: 720px) {
  .srow { grid-template-columns: 1fr auto; }
  .srow .df { display: none; }
  .srow .seg { grid-column: 1 / -1; }
  .diffs { grid-template-columns: repeat(3, minmax(0, 1fr)); }
}
</style>
