<script setup lang="ts">
import { computed, reactive, ref } from 'vue'
import { LOOK_GROUPS } from '../../data/creation'
import { useUi } from '../../stores/ui'
import TrackBar from '../../components/TrackBar.vue'
import Hint from '../../components/Hint.vue'
import { useGame } from '../../stores/game'
import { useEngine } from '../../stores/engine'
import { LORE_SLOTS, LORE_SLOT_NAME } from '../../lib/contractView'
import { useSettings } from '../../stores/settings'
import { DISTRICTS } from '../../data/districts'
import NightClassPanel from '../../components/scene/NightClassPanel.vue'

/**
 * 角色的「成人」分頁（UI 8.2 節，LEWD_SYSTEM 第 1、5 節、3.4 節）：橋參數四項、夜課的學習（接引擎的 features/nightclass，見 NightClassPanel）、豔名各區一格、性經歷的紀錄；
 * 右欄是傾向：四條軸 0～5，標籤是膠囊，「深」的粉底加一個「深」字。潛在的標籤與被篩選關掉的標籤都不顯示。只看。
 */
const g = useGame()
const eng = useEngine()
/** 找過主角的流竄 AI（引擎的 lureView：順著、拒絕、問過幾次，揭開了哪幾格「牠的事」，沒揭開的寫問號） */
const lures = computed(() => eng.lure.view())
const loreOf = (row: { lore: Array<{ slot: string; text: string }> }, slot: string): string | null => row.lore.find((l) => l.slot === slot)?.text ?? null
const st = useSettings()
const ui = useUi()
/** 建角之後也能改私處的描述（第四版）：選項和建角第 1 步同一份，另有一格自己寫 */
const PRIVATE_OPTS = LOOK_GROUPS.flatMap(x => x.fields).find(f => f.k === 'privates')!.opts
const editing = ref(false)
const draft = reactive({ look: '', note: '' })
function startEdit() { draft.look = g.character.privates?.look ?? PRIVATE_OPTS[0]; draft.note = g.character.privates?.note ?? ''; editing.value = true }
function saveEdit() {
  g.character.privates = { look: draft.look, note: draft.note.trim() }
  editing.value = false
  ui.toast('私處的描述改好了。之後的場景與正文照新的寫。')
}
const P = computed(() => g.params)
/** 每一項參數現在的效果（LEWD_SYSTEM 第 1 節的公式）。 */
const effects = computed(() => ({
  敏感度: `受到的感載 ×${(0.75 + P.value.敏感度 / 200).toFixed(2)}；${P.value.敏感度 >= 70 ? '開得了全同步' : P.value.敏感度 >= 40 ? '開得了深同步，全要 70' : '深同步要 40'}`,
  耐受: `感載上限 +${Math.floor(P.value.耐受 / 2)}；承受層數 +${Math.floor(P.value.耐受 / 40)}`,
  慾求: P.value.慾求 > 60 ? '戰鬥開始就帶著感載；感載消退變慢' : '熱驅動類的義體照常；60 以上戰鬥開始就帶著感載',
  馴化: `抵抗控制類快駭、粉蕾絲勸降、契約指令的豁免 −${Math.floor(P.value.馴化 / 20)}`,
}))
const FILTER_TAG: Record<string, 'filterRestraint' | 'filterDollChip' | 'filterPublic'> = { 束縛: 'filterRestraint', 人偶: 'filterDollChip', 暴露: 'filterPublic' }
const AXIS_TAGS: Record<string, string[]> = {
  關係: ['溺愛', '御姐', '妹系', '奪與被奪', '群與融合', '恩與債', '束縛', '痛', '支配', '服從', '禁慾', '標記'],
  感官: ['窺視', '暴露', '聲音', '藥', '野外', '妄想', '口與吞嚥', '觸手'],
  身體: ['戀物', '獸', '變形', '性別流動', '豐滿', '人偶', '半機娘'],
  扮相: ['女僕', '偶像', '歡場', '特攻', '哥德', '街頭', '霓虹龐克', '櫻町系'],
}
const filteredOff = computed(() => Object.entries(FILTER_TAG).filter(([, k]) => !st.s[k]).map(([t]) => t))
const tagsOf = (axis: string) => AXIS_TAGS[axis].filter(t => g.tendency.tags[t] && !filteredOff.value.includes(t))
</script>

<template>
  <section class="ad">
    <div class="stack">
      <div class="panel cut pad">
        <p class="h">橋參數<Hint>0～100，在世界裡是改造師量得出來、寫在病歷上的硬體規格。經歷慢慢推高；改造師可以直接調；藥暫時改變；治療可以降回來。</Hint></p>
        <div v-for="(v, k) in g.params" :key="k" class="param">
          <TrackBar :label="String(k)" :value="v" :max="100" :color="k === '敏感度' ? 'var(--sink)' : k === '耐受' ? 'var(--ram)' : k === '慾求' ? 'var(--a)' : 'var(--ep)'" :marks="k === '敏感度' ? [40, 70] : k === '耐受' ? [40, 80] : k === '慾求' ? [60] : []" />
          <small>{{ effects[k] }}</small>
        </div>
      </div>
      <div v-if="st.s.filterIntimateBody" class="panel cut pad" data-privates>
        <p class="h">私處<Hint>建角第 1 步寫的樣子，之後也能在這裡改（例：做過手術、換了私密義體、剃了）；成人場景與 AI 寫正文時用。所有角色都是成年人。內容篩選關掉「身體的私密描寫」時這一格不顯示。</Hint></p>
        <template v-if="!editing">
          <div class="chips"><span class="tag">{{ g.character.privates?.look ?? '（不寫）' }}</span></div>
          <p v-if="g.character.privates?.note" class="t-fine">{{ g.character.privates.note }}</p>
          <div class="go left"><button type="button" class="btn sm" data-edit-privates @click="startEdit">改描述</button></div>
        </template>
        <div v-else class="pedit">
          <label class="fld"><span class="k">樣子</span><select v-model="draft.look" class="inp" aria-label="私處的樣子"><option v-for="o in PRIVATE_OPTS" :key="o">{{ o }}</option></select></label>
          <label class="fld"><span class="k">補充（選用）</span><input v-model="draft.note" class="inp" placeholder="用自己的話寫，例：左邊大腿內側有一顆小痣" data-privates-input></label>
          <div class="go left"><button type="button" class="btn sm" @click="editing = false">取消</button><button type="button" class="btn sm pri" data-save-privates @click="saveEdit">存下來</button></div>
        </div>
      </div>
      <NightClassPanel />
      <div v-if="lures.length" class="panel cut pad" data-lures>
        <p class="h">找過你的流竄 AI<Hint>牠們靠登入、長休醒來或沉溺太高找上你。順著牠、拒絕或問牠是誰都會留下紀錄；問牠是誰會揭開一格「牠的事」。沒揭開的寫問號。累計與線索是引擎的 lureView。</Hint></p>
        <div v-for="a in lures" :key="a.id" class="ai" :data-lure="a.id">
          <div class="aih"><b>{{ a.name }}</b><span class="tag" data-follow>順著 {{ a.follow }} 次</span><span class="tag">拒絕 {{ a.refused }}</span><span class="tag">問過 {{ a.asked }}</span><span v-if="a.clue" class="tag hot" data-clue>有線索</span><span v-if="a.kiss" class="tag warn" data-kiss>身上有牠的吻</span></div>
          <div v-for="slot in LORE_SLOTS" :key="slot" class="kv" :data-lore="slot" :data-unknown="loreOf(a, slot) === null"><span>{{ LORE_SLOT_NAME[slot] }}</span><b :class="{ q: loreOf(a, slot) === null }">{{ loreOf(a, slot) ?? '？' }}</b></div>
        </div>
      </div>
      <div class="panel cut pad">
        <p class="h">豔名<Hint>每一區各自記，0～100：這一區有多少人看過你、認得你的身體。和街頭信譽分開。誘惑與表演有加值；被認出來的機率也跟著高。</Hint></p>
        <div class="fame">
          <div v-for="d in DISTRICTS" :key="d.id" class="fc" :class="{ here: g.loc.district === d.id }"><small>{{ d.name }}</small><b class="mono">{{ g.fame[d.id] ?? 0 }}</b></div>
        </div>
      </div>
      <div class="panel cut pad">
        <p class="h">紀錄<Hint>性經歷記錄：AI 在場景後記下誰和誰、哪一種、第一次、最喜歡的人。它是 AI 之後寫這個人時用的記憶。回退時這份記錄留著。</Hint></p>
        <div class="kv"><span>次數</span><b>{{ g.sexRecord.count }}</b></div>
        <div class="kv"><span>親密過幾位</span><b>{{ g.sexRecord.partners }}</b></div>
        <div class="kv"><span>第一次</span><b>{{ g.sexRecord.first }}</b></div>
        <div class="kv"><span>最喜歡的人</span><b>{{ g.sexRecord.favorite }}</b></div>
        <div class="kv"><span>契約</span><b data-contract-line>持約 {{ eng.contract.held().length }}・身上 {{ eng.contract.bound() ? 1 : 0 }}</b></div>
        <div class="kv"><span>體悟</span><b style="color: var(--a)">{{ g.character.insight }}</b></div>
        <div class="kv"><span>被篩選關掉的標籤</span><b>{{ filteredOff.length }}</b></div>
        <p class="h mt">最近</p>
        <div v-for="r in g.sexRecord.recent" :key="r.when + r.who" class="kv"><span>{{ r.when }}</span><b>{{ r.who }}・{{ r.where }}</b></div>
      </div>
    </div>
    <aside class="panel cut pad">
      <p class="h">傾向<Hint>四條軸各 0～5 級；標籤只有沒有、有、深三種狀態。傾向沒有好壞，也不影響戰鬥的數值。做了對應的事那一軸慢慢累積；「有」變成「深」靠事件。</Hint></p>
      <div v-for="(lv, axis) in g.tendency.axes" :key="axis" class="axis">
        <div class="ah"><b>{{ axis }}</b><span class="pips"><i v-for="n in 5" :key="n" :class="{ on: n <= lv }" /></span><span class="mono">{{ lv }}</span></div>
        <div class="chips">
          <span v-for="t in tagsOf(String(axis))" :key="t" class="pill" :class="{ hot: g.tendency.tags[t] === '深' }">{{ t }}<template v-if="g.tendency.tags[t] === '深'"> 深</template></span>
          <span v-if="!tagsOf(String(axis)).length" class="empty-note">沒有</span>
        </div>
      </div>
    </aside>
  </section>
</template>

<style scoped>
.ad { display: grid; grid-template-columns: minmax(0, 1fr) 300px; gap: 12px; align-items: start; }
.param { margin-bottom: 10px; }
.param small { display: block; color: var(--ink-3); font-size: var(--fs-fine); margin-top: 3px; }
.fame { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 6px; }
.fc { padding: 8px; background: var(--bg-2); display: grid; }
.fc small { color: var(--ink-3); font-size: var(--fs-fine); }
.fc b { font-size: var(--fs-section); }
.fc.here { box-shadow: inset 0 0 0 2px var(--a); }
.mt { margin-top: 12px; }
.ai { padding: var(--space-3) 0; border-bottom: 1px dashed var(--line); }
.aih { display: flex; gap: var(--space-3); align-items: center; flex-wrap: wrap; margin-bottom: var(--space-2); }
.q { color: var(--ink-3); font-family: var(--mono); }
.axis { padding: 8px 0; border-bottom: 1px dashed var(--line); }
.ah { display: flex; gap: 8px; align-items: center; margin-bottom: 6px; }
.pips { display: flex; gap: 3px; flex: 1; }
.pips i { width: 16px; height: 8px; border-radius: 3px; background: var(--bg-2); }
.pips i.on { background: var(--a); }
@media (max-width: 1100px) { .ad { grid-template-columns: 1fr; } }
@media (max-width: 480px) { .fame { grid-template-columns: repeat(2, minmax(0, 1fr)); } }
.pedit { display: grid; gap: var(--space-3); }
.pedit .fld { display: grid; gap: 4px; max-width: 640px; }
.pedit .inp { width: 100%; background: var(--bg-term); color: var(--ink); border: 0; box-shadow: inset 0 0 0 2px var(--line); padding: 8px 10px; font: 600 var(--fs-md) var(--font); }
</style>
