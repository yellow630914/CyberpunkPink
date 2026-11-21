<script setup lang="ts">
import { computed } from 'vue'
import TrackBar from '../../components/TrackBar.vue'
import Hint from '../../components/Hint.vue'
import { useGame } from '../../stores/game'
import { useSettings } from '../../stores/settings'
import { DISTRICTS } from '../../data/districts'

/**
 * 角色的「成人」分頁（UI 8.2 節，LEWD_SYSTEM 第 1、5 節、3.4 節）：橋參數四項、豔名各區一格、性經歷的紀錄；
 * 右欄是傾向：四條軸 0～5，標籤是膠囊，「深」的粉底加一個「深」字。潛在的標籤與被篩選關掉的標籤都不顯示。只看。
 */
const g = useGame()
const st = useSettings()
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
        <div class="kv"><span>契約</span><b>持約 {{ g.contracts.held.length }}・身上 0</b></div>
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
.axis { padding: 8px 0; border-bottom: 1px dashed var(--line); }
.ah { display: flex; gap: 8px; align-items: center; margin-bottom: 6px; }
.pips { display: flex; gap: 3px; flex: 1; }
.pips i { width: 16px; height: 8px; border-radius: 3px; background: var(--bg-2); }
.pips i.on { background: var(--a); }
@media (max-width: 1100px) { .ad { grid-template-columns: 1fr; } }
@media (max-width: 480px) { .fame { grid-template-columns: repeat(2, minmax(0, 1fr)); } }
</style>
