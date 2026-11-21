<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, reactive, ref, shallowRef, triggerRef, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import StatusBar from '../components/StatusBar.vue'
import Hint from '../components/Hint.vue'
import ReasonButton from '../components/ReasonButton.vue'
import TrackBar from '../components/TrackBar.vue'
import { AdultScene } from '../lib/scene/scene'
import { DEMO_SCENES, POSITIONS, SCENE_ITEMS, type PartId, type Technique, type Who, type SyncLevel } from '../lib/scene/data'
import { mathRng, seeded } from '../lib/combat/rng'
import { isTyping } from '../lib/keys'
import { useGame } from '../stores/game'
import { useSettings } from '../stores/settings'
import { useUi } from '../stores/ui'

/**
 * 成人場景（全頁，UI.md 第 10 節、LEWD_SYSTEM 第 3 節）：第四版照舊 Demo 重做成元件，規則在 lib/scene/。
 * 開場是 scene_gate 的確認框（進入或略過）；抬頭、兩張參與者卡夾著體位／契合／主動權、連接的小卡、兩列的行動區、右欄「這一場」。
 * 所有參與者都是成年人。內容篩選關掉的技能不出現；關掉「身體的私密描寫」時每回合的那一句不寫露骨的字。
 * #/scene?scene=amber|rin&from=/ ；seed= 固定亂數。鍵盤：1～7 行動、空白鍵結束回合。
 */
const route = useRoute()
const router = useRouter()
const g = useGame()
const st = useSettings()
const ui = useUi()
const setup = computed(() => DEMO_SCENES.find(s => s.id === route.query.scene) ?? DEMO_SCENES[0])
const from = computed(() => (typeof route.query.from === 'string' ? route.query.from : '/'))
const seed = Number(route.query.seed) || 0
const make = () => new AdultScene(setup.value, seed ? seeded(seed) : mathRng, {
  filters: { filterRestraint: st.s.filterRestraint, filterPublic: st.s.filterPublic, filterIntimateBody: st.s.filterIntimateBody },
})
const s = shallowRef(make())
// 委託的蜜罐：設備就位讓目的的進度從 goal0 開始（COMMISSION_TEMPLATES 蜜罐的 rig_ready）
const goal0 = Number(route.query.goal0) || 0
if (goal0 && s.value.goal !== null) s.value.goal = goal0
const tick = () => triggerRef(s)
const gate = ref(route.query.gate !== '0')
const applied = ref(false)

// ---- 選技能：技能 → 自己的部位 → 對方的部位 ----
const pick = reactive<{ tech: Technique | null; fp: PartId | null; open: '' | 'tech' | 'item' | 'pos' | 'talk' }>({ tech: null, fp: null, open: '' })
const talkText = ref('')
const hint = ref('')
function clearPick() { pick.tech = null; pick.fp = null }
function choosePart(w: Who, p: PartId) {
  if (!pick.tech) { hint.value = '先在行動區選一個技能，再點部位。'; return }
  if (w === 'me') { pick.fp = p; hint.value = `用${p}：再點${s.value.them.name}的一個部位。`; return }
  if (!pick.fp) { hint.value = '先點你自己的部位。'; return }
  const r = s.value.techReason(pick.tech, pick.fp, p)
  if (r) { ui.toast(r, 'warn'); return }
  s.value.technique(pick.tech.id, pick.fp, p)
  clearPick(); pick.open = ''; hint.value = ''
  done()
}
/** 部位的狀態：連著（粉框）、這個體位碰得到（細框）、碰不到（變暗） */
function partState(w: Who, p: PartId): 'link' | 'reach' | 'off' {
  if (s.value.linkAt(w, p)) return 'link'
  const o = w === 'me' ? 'them' : 'me'
  return s.value.parts(o).some(q => (w === 'me' ? s.value.reaches(p, q) : s.value.reaches(q, p))) ? 'reach' : 'off'
}
function partReason(w: Who, p: PartId): string | null {
  if (!pick.tech) return null
  if (w === 'me') return pick.tech.from.includes(p) ? null : `「${pick.tech.name}」用${pick.tech.from.join('、')}。`
  if (!pick.fp) return '先點你自己的部位。'
  return s.value.techReason(pick.tech, pick.fp, p)
}

// ---- 行動 ----
type Act = 'lead' | 'yield' | 'tease' | 'restrain'
const ACTS: Array<{ k: Act | 'tech' | 'item' | 'talk' | 'pos'; n: string; c: string; pv: string }> = [
  { k: 'lead', n: '主導', c: '2', pv: '對方感載 +2d6、你 +1d6・契合 +2・主動權 +10' },
  { k: 'yield', n: '迎合', c: '2', pv: '對方 +1d6、你 +2d6・契合 +8・主動權 −10' },
  { k: 'tease', n: '挑逗', c: '1', pv: '雙方各 +1d6・契合 +4・主動權 +5・下一個行動多 1 顆骰' },
  { k: 'restrain', n: '克制', c: '1', pv: '自己的感載 −（2＋意志調整值）；這回合連接對自己減半' },
  { k: 'tech', n: '技能', c: '▾', pv: '選一個技能，再點你的部位與對方的部位：建立連接，之後每回合自動生效' },
  { k: 'item', n: '道具', c: '1', pv: '潤滑凝膠、冷靜貼片' },
  { k: 'talk', n: '說話', c: '1', pv: 'AI 判定：契合 −5～+10；可以推進目的（一次最多 +20）' },
  { k: 'pos', n: '換體位', c: '1', pv: '要有主動權；所有連接重置' },
]
const sel = ref<typeof ACTS[number]['k']>('lead')
const preview = computed(() => ACTS.find(a => a.k === sel.value)!.pv)
function actReason(k: typeof ACTS[number]['k']): string | null {
  const b = s.value
  if (b.end) return '場景結束了。'
  if (k === 'tech') return b.ap.me < 1 ? '行動點不夠。' : null
  if (k === 'item') return b.reason('item') ?? (Object.values(b.items).some(n => n > 0) ? null : '道具用完了。')
  if (k === 'pos') return b.reason('switch')
  if (k === 'talk') return b.reason('talk')
  return b.reason(k)
}
function act(k: typeof ACTS[number]['k']) {
  sel.value = k
  const r = actReason(k)
  if (r) { hint.value = r; return }
  hint.value = ''
  if (k === 'tech' || k === 'item' || k === 'pos' || k === 'talk') { pick.open = pick.open === k ? '' : k; if (k !== 'tech') clearPick(); return }
  s.value[k]()
  done()
}
function chooseTech(t: Technique) { pick.tech = t; pick.fp = null; hint.value = `「${t.name}」：點你的${t.from.join('或')}。` }
function useItem(id: string) { s.value.useItem(id); pick.open = ''; done() }
function switchPos(id: string) { const r = s.value.posReason(id); if (r) { ui.toast(r, 'warn'); return } s.value.switchPos(id); pick.open = ''; done() }
function talk() {
  const t = talkText.value.trim()
  if (!t) { ui.toast('先寫要說的話。', 'warn'); return }
  s.value.talk(t); talkText.value = ''; pick.open = ''; done()
}
function setSync(v: SyncLevel) { const r = s.value.setSync(v); if (r) ui.toast(r, 'warn'); tick() }
function endTurn() { if (s.value.end) return; clearPick(); pick.open = ''; s.value.endTurn(); done() }
function stop() { s.value.stop(); done() }
function skip() { gate.value = false; s.value.skip(); done() }
function done() { tick(); if (s.value.end) settle() }

/** 結算進存檔（3.4 節）：體悟、關係、一筆紀錄；整場的正文由 AI 在之後寫，這裡先放戰報 */
function settle() {
  if (applied.value || !s.value.end) return
  applied.value = true
  const e = s.value.end
  g.character.insight += e.insight
  const npc = setup.value.npcId ?? null
  if (npc) g.changeAffinity(npc, e.affinity)
  g.addLog({ prose: [`在${setup.value.place}和${s.value.them.name}的那一場結束了（${e.reason}）。契合 ${e.fit}，${e.rating}。`, '完整的文字等 AI 寫：成人分流。'], changes: [{ text: `體悟 +${e.insight}`, kind: 'plus' }, ...(npc ? [{ text: `${s.value.them.name}的親密度 ${e.affinity >= 0 ? '+' : ''}${e.affinity}`, kind: (e.affinity >= 0 ? 'plus' : 'minus') as 'plus' | 'minus' }] : [])] })
}
function leave() {
  // 從委託來的（蜜罐、接待）：目的到 40 算達成（把柄的品質 2）
  if (from.value === '/commission' && s.value.end) { const e = s.value.end; const ok = (e.goal ?? e.fit) >= 40 && e.reason !== '你失神了'; g.lastBattle = { kind: 'scene', result: ok ? 'win' : 'lose', text: ok ? `把柄到手了（目的 ${e.goal ?? e.fit}）。` : `沒套出來（目的 ${e.goal ?? e.fit}）。` } }
  router.push(from.value)
}
function restart() { s.value = make(); if (goal0 && s.value.goal !== null) s.value.goal = goal0; applied.value = false; gate.value = route.query.gate !== '0'; clearPick(); pick.open = '' }

// ---- 鍵盤：1～8 行動、空白鍵結束回合 ----
function onKey(e: KeyboardEvent) {
  if (gate.value || isTyping(e.target) || ui.stack.length || e.ctrlKey || e.metaKey || e.altKey) return
  if (/^[1-8]$/.test(e.key)) { e.preventDefault(); act(ACTS[Number(e.key) - 1].k) }
  else if (e.key === ' ') { e.preventDefault(); endTurn() }
  else if (e.key === 'Escape' && (pick.open || pick.tech)) { e.preventDefault(); e.stopPropagation(); clearPick(); pick.open = ''; hint.value = '' }
}
onMounted(() => window.addEventListener('keydown', onKey, true))
onBeforeUnmount(() => window.removeEventListener('keydown', onKey, true))
// 同一個全頁換了場景（只有網址的參數變）：重新開始
watch(() => [route.query.scene, route.query.gate], () => restart())
const initWho = computed(() => (s.value.myLead ? '你在帶' : `${s.value.them.name}在帶`))
const lines = computed(() => [...s.value.lines].reverse())
</script>

<template>
  <div class="scene-screen">
    <StatusBar back title="成人場景" />
    <!-- scene_gate：開始前的確認框（LEWD_SYSTEM 3.1 節） -->
    <div v-if="gate" class="gate" role="dialog" aria-modal="true" aria-label="成人場景的確認" data-gate>
      <div class="box panel cut pad">
        <h3>{{ setup.opening }}</h3>
        <p>接下來可能是一場成人場景。你可以自己操作，或略過，讓這一段寫成敘事並自動結算。所有參與者都是成年人。</p>
        <div class="kv"><span>和誰</span><b>{{ s.them.name }}・{{ s.them.role }}</b></div>
        <div class="kv"><span>在哪裡</span><b>{{ setup.place }}</b></div>
        <div class="kv"><span>性質</span><b>{{ setup.nature }}</b></div>
        <div class="kv"><span>目的</span><b>{{ setup.goal ?? '沒有' }}</b></div>
        <div class="kv"><span>略過時</span><b>照雙方的數值算契合，體悟打七折</b></div>
        <div class="go"><button type="button" class="btn sm" data-skip @click="skip">略過</button><button type="button" class="btn sm pri" data-enter @click="gate = false">進入場景</button></div>
      </div>
    </div>

    <div class="sc">
      <header class="panel cut pad head">
        <b class="t-card">成人場景・第 {{ s.round }} 回合</b>
        <span class="tag">{{ setup.place }}</span><span class="tag">{{ setup.nature }}</span>
        <div v-if="s.goal !== null" class="goal"><span class="k">目的：{{ setup.goal }}・{{ s.goal }}</span><TrackBar :value="s.goal" :max="100" color="var(--ap)" :height="8" /></div>
        <span class="grow" />
        <div class="seg" aria-label="同步檔位"><span class="k">同步<Hint>每回合換一次，不花行動點。受到的感載：淺 ×0.5、標準 ×1、深 ×1.5、全 ×2.5（CORE_RULES 第 5 節）。</Hint></span>
          <button v-for="v in (['淺', '標準', '深', '全'] as const)" :key="v" type="button" :class="{ on: s.sync === v, 'is-unavailable': v === '全' }" @click="setSync(v)">{{ v }}</button></div>
        <span class="tag">直播：關<Hint>開播的話右欄換成直播面板（觀看數、熱度、彈幕、直播目標）。對方要同意。</Hint></span>
      </header>

      <section class="stage">
        <article v-for="w in (['me', 'them'] as Who[])" :key="w" class="panel cut pad pc" :class="w" :data-actor="w">
          <div class="who"><b class="t-card">{{ s.actor(w).name }}</b><small>{{ s.actor(w).role }}・敏感度 {{ s.actor(w).sens }}</small></div>
          <TrackBar label="感載" :value="s.actor(w).load" :max="s.actor(w).loadMax" color="var(--load)" striped />
          <div class="after" :aria-label="`餘韻 ${s.actor(w).after}／${s.actor(w).layers}`"><span class="k">餘韻</span><i v-for="n in s.actor(w).layers" :key="n" :class="{ on: n <= s.actor(w).after }" /></div>
          <div class="parts">
            <button v-for="p in s.parts(w)" :key="p" type="button" class="pt" :class="[partState(w, p), { picked: w === 'me' && pick.fp === p, 'is-unavailable': !!partReason(w, p) && !!pick.tech }]"
              :data-part="`${w}:${p}`" :title="partReason(w, p) ?? undefined" @click="choosePart(w, p)">{{ p }}</button>
          </div>
          <div v-if="w === 'them'" class="chips"><span v-for="t in s.them.tags" :key="t" class="tag">{{ t }}</span><span class="tag">？</span></div>
        </article>
        <div class="mid">
          <div class="panel cut pad pos"><span class="k">體位</span><b class="t-card">{{ s.pos.name }}</b>
            <small>{{ s.pos.top ? (s.pos.top === 'me' ? '你在上位' : `${s.them.name}在上位`) : '沒有上位' }}・你 ×{{ s.pos.mult.me }}・{{ s.them.name }} ×{{ s.pos.mult.them }}</small>
            <small>你會的：{{ s.me.knows.map(id => POSITIONS.find(p => p.id === id)!.name).join('、') }}</small></div>
          <div class="panel cut pad meter"><div class="mt"><span class="k">契合<Hint>0～100，這一場的成績。30、60、85 是四級評價的界線：不合、普通、合拍、難忘。</Hint></span><b class="mono">{{ s.fit }}</b></div>
            <div class="fit"><b :style="{ width: s.fit + '%' }" /><i style="left: 30%" /><i style="left: 60%" /><i style="left: 85%" /></div></div>
          <div class="panel cut pad meter"><div class="mt"><span class="k">主動權<Hint>50 以上在你手上：有主動權才能換體位。主導 +10、挑逗 +5、迎合 −10；自己高潮 −15、讓對方高潮 +10；上位每回合 +3。</Hint></span><b class="mono">{{ s.init }}・{{ initWho }}</b></div>
            <div class="ini"><i :style="{ left: s.init + '%' }" /></div></div>
        </div>
      </section>

      <section class="panel cut pad links">
        <p class="h">連接・每條每回合自動生效一次<Hint>連接是「我的某個部位」接著「對象的某個部位」，建立之後一直持續。同一個部位換事做、或換部位接同一個位置，舊的就斷；換體位全部重來。</Hint></p>
        <div v-if="!s.links.length" class="empty-note">還沒有連接：用技能或說話建立一條。</div>
        <div class="lks">
          <div v-for="l in s.links" :key="l.id" class="lk" :class="{ new: l.isNew }" data-link>
            <b>{{ l.from === 'me' ? '你' : s.them.name }} {{ l.fromPart }}</b><span class="ar">{{ l.tech === 'talk' ? '↔' : '→' }}</span><b>{{ l.to === 'me' ? '你' : s.them.name }} {{ l.toPart }}</b>
            <span class="per">{{ l.label }}</span>
          </div>
        </div>
      </section>

      <section class="panel cut pad acts">
        <div class="aph"><span class="k">行動點</span><span class="ap"><i v-for="n in 5" :key="n" :class="{ on: n <= s.ap.me }" /></span><span class="k">對象：{{ s.them.name }}（連著 {{ s.links.length }} 條）</span>
          <span class="grow" /><button type="button" class="btn sm" :aria-disabled="!!s.end || undefined" data-end-turn @click="endTurn">結束回合<kbd>Space</kbd></button>
          <button type="button" class="btn sm ghost" data-stop @click="stop">停下</button></div>
        <div class="abtns">
          <button v-for="(a, i) in ACTS" :key="a.k" type="button" class="ab" :class="{ on: sel === a.k, 'is-unavailable': !!actReason(a.k) }" :title="actReason(a.k) ?? undefined" :data-act="a.k" @click="act(a.k)">
            <span class="kn mono">{{ i + 1 }}</span>{{ a.n }}<small>{{ a.c }}</small></button>
        </div>
        <div v-if="pick.open === 'tech'" class="pop" data-pop="tech">
          <button v-for="t in s.techniques()" :key="t.id" type="button" class="opt" :class="{ on: pick.tech?.id === t.id, 'is-unavailable': s.ap.me < t.ap }" :data-tech="t.id" @click="chooseTech(t)">
            <b>{{ t.name }}</b><small>{{ t.ap }} 點・{{ t.from.join('／') }} → {{ t.to.join('／') }}{{ t.tag ? `・${t.tag}` : '' }}</small></button>
        </div>
        <div v-else-if="pick.open === 'item'" class="pop">
          <ReasonButton v-for="it in SCENE_ITEMS" :key="it.id" sm :reason="s.items[it.id] ? null : '用完了。'" :title="it.note" @go="useItem(it.id)">{{ it.name }}（{{ s.items[it.id] }}）</ReasonButton><span class="t-fine">{{ SCENE_ITEMS.map(i => `${i.name}：${i.note}`).join(' ') }}</span>
        </div>
        <div v-else-if="pick.open === 'pos'" class="pop">
          <ReasonButton v-for="p in POSITIONS" :key="p.id" sm :reason="s.posReason(p.id)" :data-pos="p.id" @go="switchPos(p.id)">{{ p.name }}</ReasonButton>
        </div>
        <form v-else-if="pick.open === 'talk'" class="pop talk" @submit.prevent="talk">
          <input v-model="talkText" class="inp" placeholder="想說的話（AI 判定；關著時用骰子代替）" data-talk-input><button class="btn sm pri" type="submit">說</button>
        </form>
        <div class="pv"><b>{{ ACTS.find(a => a.k === sel)!.n }}：</b>{{ preview }}<span v-if="hint" class="warn-t">・{{ hint }}</span></div>
      </section>

      <aside class="side">
        <section class="panel cut pad log">
          <p class="h">這一場・每回合一句</p>
          <p v-for="(l, i) in lines" :key="i" class="ln"><small>第 {{ l.round }} 回合・{{ l.who === 'me' ? '你' : s.them.name }}</small>{{ l.text }}</p>
          <p class="empty-note">完整的文字等你按「停下」之後一次寫。</p>
        </section>
      </aside>
    </div>

    <!-- 戰報 -->
    <div v-if="s.end" class="gate" role="dialog" aria-modal="true" aria-label="成人場景的戰報" data-report>
      <div class="box panel cut pad">
        <h3>這一場結束了：{{ s.end.reason }}</h3>
        <div class="kv"><span>契合</span><b>{{ s.end.fit }}・{{ s.end.rating }}</b></div>
        <div class="kv"><span>關係</span><b>{{ s.end.relation }}</b></div>
        <div class="kv"><span>體悟</span><b>+{{ s.end.insight }}</b></div>
        <p class="t-fine">{{ s.end.insightNotes.join('；') }}。</p>
        <div v-if="s.end.goal !== null" class="kv"><span>目的</span><b>{{ setup.goal }}・{{ s.end.goal }}</b></div>
        <div class="kv"><span>你的餘韻</span><b>{{ s.end.afterMe }} 層（帶著走，要休息）</b></div>
        <p class="t-fine">沉溺、橋參數、傾向與性經歷由 AI 讀場景紀錄判定，程式夾住範圍；完整的文字走成人分流，寫進紀錄的報告卡。</p>
        <div class="go"><button type="button" class="btn sm" @click="restart">再來一次</button><button type="button" class="btn sm pri" data-leave @click="leave">回去</button></div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.scene-screen { min-height: 100vh; min-height: 100dvh; display: flex; flex-direction: column; }
.sc { flex: 1; display: grid; grid-template-columns: minmax(0, 1fr) 300px; grid-template-areas: "head head" "stage side" "links side" "acts side"; gap: var(--space-4); padding: var(--space-4); align-content: start; }
.head { grid-area: head; display: flex; align-items: center; gap: var(--space-3); flex-wrap: wrap; }
.goal { display: grid; gap: 2px; min-width: 180px; }
.grow { flex: 1; }
.seg { display: inline-flex; gap: 4px; align-items: center; flex-wrap: wrap; }
.seg button { font-size: var(--fs-sm); font-weight: 800; padding: 6px 10px; background: var(--bg-2); color: var(--ink-2); border: 0; cursor: pointer; }
.seg button.on { background: var(--ink-2); color: var(--bg); }
.stage { grid-area: stage; display: grid; grid-template-columns: minmax(0, 1fr) minmax(200px, 240px) minmax(0, 1fr); gap: var(--space-4); }
.stage .them { order: 3; }
.mid { order: 2; display: grid; gap: var(--space-3); align-content: center; }
.pc { display: grid; gap: var(--space-3); align-content: start; }
.who small { display: block; color: var(--ink-3); font-size: var(--fs-fine); }
.after { display: flex; gap: 4px; align-items: center; }
.after i { width: 18px; height: 8px; border-radius: 2px; background: var(--bg-2); }
.after i.on { background: var(--load); }
.parts { display: flex; gap: 6px; flex-wrap: wrap; }
.pt { font-size: var(--fs-label); font-weight: 800; padding: 5px 10px; border-radius: 7px; border: 0; cursor: pointer; background: var(--bg-term); color: var(--ink-3); }
.pt.reach { color: var(--ink-2); box-shadow: inset 0 0 0 1px var(--line-2); }
.pt.link { color: var(--ink); background: color-mix(in srgb, var(--a) 22%, var(--bg-2)); box-shadow: inset 0 0 0 2px var(--a); }
.pt.off { opacity: .55; }
.pt.picked { box-shadow: inset 0 0 0 2px var(--ap); }
.pos { display: grid; gap: 2px; text-align: center; }
.pos small { color: var(--ink-3); font-size: var(--fs-fine); }
.meter .mt { display: flex; gap: var(--space-3); align-items: baseline; }
.meter .mt b { font-size: var(--fs-md); }
.fit { height: 10px; border-radius: 5px; background: var(--bg-2); margin-top: 6px; position: relative; overflow: hidden; }
.fit b { position: absolute; inset: 0 auto 0 0; background: linear-gradient(90deg, #8E7CC3, var(--ep)); border-radius: 5px; }
.fit i { position: absolute; top: 0; bottom: 0; width: 1px; background: var(--bg); }
.ini { height: 10px; border-radius: 5px; background: linear-gradient(90deg, var(--bg-2) 0 50%, var(--bg-3) 50%); margin-top: 6px; position: relative; }
.ini::after { content: ""; position: absolute; left: 50%; top: -3px; bottom: -3px; width: 2px; background: var(--ink-3); }
.ini i { position: absolute; top: -4px; width: 6px; height: 18px; border-radius: 3px; background: var(--ink); transform: translateX(-50%); }
.links { grid-area: links; }
.lks { display: grid; grid-template-columns: repeat(auto-fill, minmax(min(100%, 280px), 1fr)); gap: var(--space-3); max-width: 880px; }
.lk { display: flex; flex-wrap: wrap; gap: 4px 8px; align-items: baseline; padding: 7px 10px; background: var(--bg-2); font-size: var(--fs-sm); }
.lk .ar { font: 900 var(--fs-md) var(--mono); color: var(--a); }
.lk .per { flex-basis: 100%; color: var(--ink-2); font-size: var(--fs-fine); }
.lk.new { box-shadow: inset 3px 0 0 var(--ram); }
.acts { grid-area: acts; display: grid; gap: var(--space-3); }
.aph { display: flex; align-items: center; gap: var(--space-3); flex-wrap: wrap; }
.ap { display: flex; gap: 4px; }
.ap i { width: 16px; height: 16px; clip-path: polygon(50% 0, 100% 50%, 50% 100%, 0 50%); background: var(--bg-3); }
.ap i.on { background: var(--ap); }
.abtns { display: grid; grid-template-columns: repeat(auto-fill, minmax(120px, 1fr)); grid-auto-rows: minmax(58px, auto); gap: var(--space-3); min-height: 124px; }
.ab { position: relative; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 2px; padding: 8px; background: var(--bg-2); border: 0; font-weight: 900; font-size: var(--fs-md); cursor: pointer; color: var(--ink); }
.ab small { font: 700 var(--fs-fine) var(--mono); color: var(--ink-3); }
.ab.on { box-shadow: inset 0 0 0 2px var(--ink-2); }
.ab .kn { position: absolute; left: 6px; top: 4px; font-size: var(--fs-tiny); color: var(--ink-3); }
.pop { display: flex; flex-wrap: wrap; gap: var(--space-3); }
.opt { display: grid; text-align: left; padding: 6px 10px; background: var(--bg-2); border: 0; cursor: pointer; color: var(--ink); }
.opt small { color: var(--ink-3); font-size: var(--fs-fine); }
.opt.on { box-shadow: inset 0 0 0 2px var(--ap); }
.talk .inp { flex: 1; min-width: 0; background: var(--bg-term); color: var(--ink); border: 0; box-shadow: inset 0 0 0 2px var(--line); padding: 8px 10px; font: 600 var(--fs-md) var(--font); }
.pv { padding: 8px 12px; background: var(--bg-term); font-size: var(--fs-sm); color: var(--ink-2); }
.side { grid-area: side; display: grid; gap: var(--space-4); align-content: start; }
.log .ln { margin: 0; padding: 6px 0; border-bottom: 1px dashed var(--line); font-size: var(--fs-sm); line-height: 1.7; }
.log .ln small { display: block; color: var(--ink-3); font-size: var(--fs-fine); }
.gate { position: fixed; inset: 0; background: #000a; display: grid; place-items: center; z-index: var(--z-sheet); padding: var(--space-4); }
.gate .box { width: min(480px, 100%); display: grid; gap: var(--space-2); background: var(--bg-1); }
.gate h3 { margin: 0; }
.gate p { margin: 4px 0; color: var(--ink-2); line-height: 1.7; }
@media (max-width: 1100px) { .sc { grid-template-columns: minmax(0, 1fr); grid-template-areas: "head" "stage" "links" "acts" "side"; } }
@media (max-width: 720px) {
  .sc { padding: var(--space-3); }
  .stage { grid-template-columns: 1fr; }
  .stage .them { order: 1; } .mid { order: 2; } .stage .me { order: 3; }
  .abtns { grid-template-columns: repeat(4, minmax(0, 1fr)); }
  .ab { font-size: var(--fs-sm); }
}
</style>
