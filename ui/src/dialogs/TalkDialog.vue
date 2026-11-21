
<script setup lang="ts">
import { computed, ref } from 'vue'
import Dialog from '../components/Dialog.vue'
import Hint from '../components/Hint.vue'
import Tabs from '../components/Tabs.vue'
import LogView from '../components/LogView.vue'
import ItemSlot from '../components/ItemSlot.vue'
import MoneyTag from '../components/MoneyTag.vue'
import ReasonButton from '../components/ReasonButton.vue'
import { useGame, type LogEntry } from '../stores/game'
import { useUi } from '../stores/ui'
import { ITEMS } from '../data/items'
import { XIAOMAI_TOPICS, XIAOMAI_INVITES, RELATION_LINE } from '../data/npcs'
import { useRouter } from 'vue-router'

/**
 * 和 NPC 說話（UI.md 3.9 節，樣稿 docs/mockups/dialogue.html，範例是小麥）。
 * 左：人物、親密度、忠誠、關係線、已知的事；中：對話紀錄與互動（說話、送禮、邀約、自由輸入）；右：共同記憶。
 * 公式與門檻都收進「?」。
 */
const props = defineProps<{ entryId: number; stacked?: boolean; npcId: string }>()
const g = useGame()
const ui = useUi()
const router = useRouter()
const npc = computed(() => g.npcs[props.npcId])
const topics = computed(() => (props.npcId === 'npc_xiaomai' ? XIAOMAI_TOPICS : []))
const pane = ref('talk')
const gift = ref<string | null>(null)
const free = ref('')
const usedToday = ref<Set<string>>(new Set())
const giftedToday = ref(false)
const convo = ref<LogEntry[]>([
  { id: 1, time: '第 14 天 17:12', place: '蜂巢 · 四號塔 · 屋頂的晾衣場',
    prose: ['小麥坐在水塔的鐵架上，郵差包擱在腿邊，正在把今天沒送完的信照樓層排好。看到你從樓梯口上來，她把一疊信塞回包裡，往旁邊挪出一個位子。'],
    quotes: ['「你今天怎麼有空上來？我還以為你被藍鯨那件事纏住了。」'] },
])
let seq = 2
const baseDc = computed(() => 13 - Math.floor(npc.value.affinity / 20))
const gifts = computed(() => g.inventory.filter(s => ITEMS[s.def].gift))

function roll(skill: string, mod: number, dc: number) {
  const die = 1 + Math.floor(Math.random() * 20)
  const total = die + mod
  const result = die === 20 ? '大成功' : die === 1 ? '大失敗' : total >= dc ? '成功' : '失敗'
  return { skill, die, mod, dc, result: result as '成功' }
}
function push(e: Omit<LogEntry, 'id' | 'time' | 'place'>) {
  g.advance(10)
  convo.value.push({ id: seq++, time: `${g.timeLabel} · ${pane.value === 'gift' ? '送禮' : '聊天'}`, place: npc.value.name, ...e })
}
function sayTopic(id: string) {
  const t = topics.value.find(x => x.id === id)!
  const r = roll(t.skill, t.mod, t.dc)
  const ok = r.result.includes('成功')
  const delta = ok ? t.affinity : 0
  if (delta) g.changeAffinity(npc.value.id, delta)
  usedToday.value.add(id)
  push({ prose: ['你問她：' + t.name + '。', ...(ok ? t.lines : ['她想了一下，說改天再告訴你。'])], quotes: ok ? [t.quote] : [], roll: r,
    changes: ok ? t.changes.map(c => ({ text: c, kind: 'plus' as const })) : [{ text: '沒有變化' }] })
}
function sendGift() {
  const st = g.inventory.find(s => s.uid === gift.value)
  if (!st) return
  const d = ITEMS[st.def]
  const r = roll('交涉', 5, 10)
  const v = d.gift!.value
  const delta = r.result.includes('成功') ? v : Math.min(0, v)
  g.removeItem(st.uid, 1)
  g.changeAffinity(npc.value.id, delta)
  giftedToday.value = true
  gift.value = null
  push({ prose: [`你把${d.name}遞給她。`, delta > 0 ? '她接過去，笑得眼睛瞇起來。' : delta < 0 ? '她的表情僵了一下，把東西推回來。' : '她說謝謝，放進郵差包裡。'], roll: r,
    changes: [{ text: `親密度 ${delta >= 0 ? '+' : ''}${delta}`, kind: delta >= 0 ? 'plus' : 'minus' }] })
}
function freeSay() {
  const t = free.value.trim()
  if (!t) { ui.toast('先寫下想說或想做的事。', 'warn'); return }
  push({ prose: [`你：${t}`, 'AI 關著：判定照骰值與參考 DC，正文換成戰報。'], roll: roll('交涉', 5, baseDc.value) })
  free.value = ''
}
function invite(name: string) {
  if (name === '帶她回據點') { ui.closeAll(); router.push('/home'); return }
  ui.toast(`「${name}」的畫面在第三版做。`)
}
</script>

<template>
  <Dialog :entry-id="entryId" :stacked="stacked" :title="`和${npc.name}說話`" :sub="g.placeLabel" size="xl">
    <div class="talk-grid">
      <aside class="panel cut pad who">
        <div class="por"><span class="mood">{{ npc.mood }}</span><svg viewBox="0 0 120 150" aria-hidden="true"><circle cx="60" cy="52" r="30" fill="var(--b)" /><path d="M14 150c0-34 20-56 46-56s46 22 46 56z" fill="var(--b)" /><rect x="52" y="118" width="16" height="6" rx="3" fill="var(--a)" /></svg></div>
        <b class="nm">{{ npc.name }}</b> <span class="tag">{{ npc.district }}</span>
        <div class="k">{{ npc.age }} 歲・{{ npc.identity }}</div>
        <div class="chips mt"><span v-for="t in npc.tags" :key="t" class="tag">{{ t }}</span></div>
        <div class="rel">和你的關係：{{ npc.relation }} <Hint>這一句由 AI 提議，你可以改寫。</Hint></div>
        <div class="mtr">
          <div class="top"><span>親密度<Hint title="親密度">−100～100，0 是中線。階段：仇、嫌、生、熟（20）、交心（40）、親近（60）、羈絆（80）。</Hint></span><b>{{ npc.affinity }}<small>{{ npc.stage }}</small></b></div>
          <div class="cbar"><b :style="npc.affinity >= 0 ? { left: '50%', width: npc.affinity / 2 + '%' } : { left: 50 + npc.affinity / 2 + '%', width: -npc.affinity / 2 + '%', background: 'var(--hp)' }" /></div>
        </div>
        <div class="mtr">
          <div class="top"><span>忠誠<Hint>70 以上：危險的委託也肯來，被挖角不會走。</Hint></span><b>{{ npc.loyalty }}</b></div>
          <div class="lb"><b :style="{ width: npc.loyalty + '%' }" /></div>
        </div>
        <p class="h mt">關係線・第 {{ npc.lineStage + 1 }} 段</p>
        <div class="line5"><span v-for="(s, i) in RELATION_LINE" :key="s.name" :class="{ done: i < npc.lineStage, now: i === npc.lineStage }" :title="s.need">{{ s.name }}<small>{{ s.need }}</small></span></div>
        <p class="h mt">已知的事</p>
        <div v-for="k in npc.known" :key="k.k" class="kn"><span>{{ k.k }}</span><b :class="{ q: k.unknown }">{{ k.v }}<Hint v-if="k.unknown" text="讀橋或聊天可以揭開。" /></b></div>
      </aside>

      <section class="panel cut talkp">
        <div class="hd"><b>和{{ npc.name }}說話</b><span class="k">基準 DC {{ baseDc }}</span><Hint title="基準 DC">DC ＝ 對方的警覺 13 − 親密度 ÷ 20（取整）。AI 判定開著時，判定交給 AI，這個數字是參考。</Hint></div>
        <div class="conv"><LogView :entries="convo" /></div>
        <div class="dock">
          <Tabs v-model="pane" :tabs="[{ id: 'talk', label: '說話' }, { id: 'gift', label: '送禮' }, { id: 'invite', label: '邀約' }]" />
          <div v-if="pane === 'talk'" class="topic">
            <button v-for="t in topics" :key="t.id" type="button" :class="{ new: t.isNew, used: usedToday.has(t.id) }" @click="sayTopic(t.id)">{{ t.name }}</button>
            <span v-if="!topics.length" class="empty-note">沒有新的話題。</span>
          </div>
          <div v-else-if="pane === 'gift'" class="gifts">
            <div v-for="s in gifts" :key="s.uid" class="gift" role="button" tabindex="0" :aria-pressed="gift === s.uid" :class="{ on: gift === s.uid }" @click="gift = s.uid" @keydown.enter="gift = s.uid">
              <ItemSlot :item="ITEMS[s.def]" size="sm" tabindex="-1" />
              <span class="gn"><b :style="{ color: `var(--g${ITEMS[s.def].grade})` }">{{ ITEMS[s.def].name }}</b><MoneyTag kind="cash" :amount="ITEMS[s.def].price" :size="12" /></span>
              <span class="pv" :class="{ bad: ITEMS[s.def].gift!.value < 0 }">{{ ITEMS[s.def].gift!.value > 0 ? '+' : '' }}{{ ITEMS[s.def].gift!.value < 0 ? '？' : ITEMS[s.def].gift!.value }}</span>
              <Hint :text="ITEMS[s.def].gift!.preview" />
            </div>
            <div class="go"><span class="k">交涉 DC 10<Hint>送禮的 DC 是基準 −2；每人每天一次。價值不到 10 不加親密度。</Hint></span>
              <ReasonButton sm pri :reason="giftedToday ? '今天已經送過了。' : gift ? null : '先選一件禮物。'" @go="sendGift">送出</ReasonButton></div>
          </div>
          <div v-else class="invites">
            <div v-for="iv in XIAOMAI_INVITES" :key="iv.name" class="iv">
              <span><b>{{ iv.name }}</b><Hint :text="iv.note" /></span>
              <MoneyTag v-if="iv.cost" kind="cash" :amount="iv.cost" :size="12" />
              <ReasonButton sm :reason="iv.ok ? null : iv.reason" @go="invite(iv.name)">選</ReasonButton>
            </div>
          </div>
          <form class="free" @submit.prevent="freeSay">
            <span class="die" aria-hidden="true" />
            <label class="sr-only" :for="`free-${entryId}`">我要做別的</label>
            <input :id="`free-${entryId}`" v-model="free" placeholder="我要做別的……" autocomplete="off">
            <button type="submit" class="btn sm pri">說</button>
          </form>
        </div>
      </section>

      <aside class="panel cut pad mem">
        <p class="h">共同記憶</p>
        <div v-for="m in npc.memories" :key="m.text" class="memo"><small>{{ m.when }}<span class="imp"><i v-for="n in 3" :key="n" :class="{ on: n <= m.weight }" /></span></small>{{ m.text }}</div>
        <div v-if="!npc.memories.length" class="empty-note">還沒有共同記憶。</div>
      </aside>
    </div>
  </Dialog>
</template>

<style scoped>
.talk-grid { display: grid; grid-template-columns: 270px minmax(0, 1fr) 250px; gap: 12px; align-items: stretch; min-height: min(640px, calc(100vh - 140px)); }
.por { position: relative; height: 170px; background: linear-gradient(180deg, #2A1E36, #1A1322); display: grid; place-items: end center; margin-bottom: 10px; border-radius: 6px; overflow: hidden; }
.por svg { height: 150px; }
.mood { position: absolute; right: 8px; top: 8px; font-size: var(--fs-fine); font-weight: 800; padding: 2px 8px; border-radius: 999px; background: var(--ram); color: #17111F; }
.nm { font-size: var(--fs-section); }
.mt { margin-top: 8px; }
.rel { font-size: var(--fs-sm); color: var(--ink-2); margin-top: 8px; }
.mtr { margin-top: 12px; }
.mtr .top { display: flex; justify-content: space-between; align-items: baseline; font-size: var(--fs-sm); color: var(--ink-3); font-weight: 800; }
.mtr .top span { display: inline-flex; gap: 4px; align-items: center; }
.mtr .top b { font: 900 var(--fs-xl) var(--mono); color: var(--ink); }
.mtr .top b small { font-size: var(--fs-sm); color: var(--a); margin-left: 6px; font-family: var(--font); }
.cbar { height: 10px; background: #2E2339; position: relative; margin-top: 5px; border-radius: 5px; overflow: hidden; }
.cbar::after { content: ""; position: absolute; left: 50%; top: -2px; bottom: -2px; width: 2px; background: var(--ink-3); }
.cbar b { position: absolute; top: 0; bottom: 0; background: repeating-linear-gradient(120deg, #F06AA0 0 6px, #F58DBA 6px 9px); }
.lb { height: 8px; border-radius: 4px; background: #2E2339; margin-top: 5px; overflow: hidden; }
.lb b { display: block; height: 100%; background: var(--ram); }
.line5 { display: grid; grid-template-columns: repeat(5, 1fr); gap: 3px; }
.line5 span { font-size: var(--fs-tiny); font-weight: 800; padding: 5px 2px; background: var(--bg-term); color: var(--ink-3); text-align: center; line-height: 1.35; }
.line5 span small { display: block; font: 700 var(--fs-micro) var(--mono); }
.line5 .done { background: var(--a); color: #fff; } .line5 .done small { color: #fff; }
.line5 .now { box-shadow: inset 0 0 0 2px var(--a); color: var(--ink); }
.kn { display: grid; grid-template-columns: 54px 1fr; gap: 6px; padding: 6px 0; border-bottom: 1px dashed var(--line); font-size: var(--fs-sm); }
.kn span { color: var(--ink-3); }
.kn b { font-weight: 600; display: flex; align-items: center; gap: 4px; }
.kn .q { color: var(--ink-3); font-family: var(--mono); }
.talkp { display: flex; flex-direction: column; min-height: 0; }
.talkp .hd { display: flex; align-items: center; gap: 10px; padding: 12px 16px; border-bottom: 2px solid var(--line); }
.conv { flex: 1; overflow: auto; padding: 0 18px 10px; min-height: 200px; max-height: 52vh; }
.dock { border-top: 2px solid var(--line); padding: 10px 12px; display: grid; gap: 8px; }
.topic { display: flex; gap: 6px; flex-wrap: wrap; }
.topic button { font-size: var(--fs-sm); font-weight: 800; padding: 6px 12px; border-radius: 999px; background: var(--bg-term); color: var(--ink-2); cursor: pointer; border: 0; box-shadow: inset 0 0 0 1px var(--line); }
.topic button.new { box-shadow: inset 0 0 0 1px var(--a); color: #F58DBA; }
.topic button.used { opacity: .5; }
.gifts { display: grid; gap: 5px; }
.gift { display: grid; grid-template-columns: 40px 1fr auto auto; gap: 10px; align-items: center; padding: 6px 10px; background: var(--bg-2); border: 0; cursor: pointer; color: inherit; text-align: left; }
.gift.on { box-shadow: inset 0 0 0 2px var(--a); }
.gn { display: grid; gap: 2px; font-size: var(--fs-sm); }
.pv { font: 900 var(--fs-ui) var(--mono); color: var(--ram); }
.pv.bad { color: var(--hp); }
.invites { display: grid; gap: 5px; }
.iv { display: grid; grid-template-columns: 1fr auto auto; gap: 10px; align-items: center; padding: 8px 10px; background: var(--bg-2); font-size: var(--fs-ui); }
.iv span { display: inline-flex; align-items: center; gap: 6px; }
.free { display: flex; align-items: center; gap: 10px; padding: 8px 10px; background: var(--bg-term); box-shadow: inset 0 0 0 2px var(--line); }
.free input { flex: 1; min-width: 0; background: transparent; border: 0; color: var(--ink); font: 500 var(--fs-md) var(--font); outline: none; }
.die { width: 22px; height: 22px; flex: none; background: var(--a); clip-path: polygon(50% 0, 100% 25%, 100% 75%, 50% 100%, 0 75%, 0 25%); }
.memo { padding: 8px 10px; background: var(--bg-2); margin-bottom: 5px; font-size: var(--fs-sm); line-height: 1.65; }
.memo small { display: flex; gap: 6px; align-items: center; font: 700 var(--fs-tiny) var(--mono); color: var(--ink-3); }
.imp { display: inline-flex; gap: 2px; } .imp i { width: 6px; height: 6px; border-radius: 50%; background: #45375A; } .imp i.on { background: var(--a); }
@media (max-width: 1100px) { .talk-grid { grid-template-columns: 250px minmax(0, 1fr); } .mem { grid-column: 1 / -1; } }
@media (max-width: 720px) { .talk-grid { grid-template-columns: 1fr; min-height: 0; } .conv { max-height: none; } .por { height: 130px; } .por svg { height: 115px; } }
</style>
