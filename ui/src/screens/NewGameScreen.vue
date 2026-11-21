<script setup lang="ts">
import { computed, reactive, ref } from 'vue'
import { useRouter } from 'vue-router'
import StatusBar from '../components/StatusBar.vue'
import Hint from '../components/Hint.vue'
import ItemSlot from '../components/ItemSlot.vue'
import ReasonButton from '../components/ReasonButton.vue'
import RuleFields from '../components/RuleFields.vue'
import MoneyTag from '../components/MoneyTag.vue'
import { useGame } from '../stores/game'
import { useSettings } from '../stores/settings'
import { useUi } from '../stores/ui'
import { ITEMS } from '../data/items'
import { SKILL_TREES } from '../data/content.generated'
import {
  ATTRS, ATTR_ARRAY, ATTR_FREE, BASIC_SKILLS, BASIC_POINTS, BASIC_MAX, ORIGINS, CORPS, CYBER_OPTIONS, CYBER_POINTS, CYBER_POINT_MONEY,
  TRAITS, LIFE_TABLES, GEAR_CATALOG, GEAR_POINTS, GEAR_POINT_MONEY, SUGGESTED_KITS, LOOKS, QUICK_STARTS, START_MONEY, type AttrName, type CyberOption, type TraitOption,
} from '../data/creation'
import {
  ageBlock, freeValues, attrTotals, attrBlock, attrMod, basicLeft, basicStepBlock, cyberSummary, cyberPickBlock, cyberBlock,
  traitSummary, traitPickBlock, traitBlock, gearPoints, gearSummary, gearAddBlock, fitKit, type AttrPick,
} from '../lib/creation'
import { learnBlock, skillXp, treeSpent, tierOpen, TIER_THRESHOLDS } from '../lib/skills'
import type { ItemDef } from '../data/types'

/**
 * 開新局與建角（UI 第 14 節、樣稿 docs/mockups/title.html 的「新遊戲」與 workshop.html 的「建角」）。
 * 先選世界、再設內容篩選（關掉的題材不出現在建角的選項裡），再建角十步；每一步都可以回頭改，最後一頁是總覽。
 * 下拉選單為主，自由輸入為輔。年齡是硬界線：低於 18 時「下一步」不能按。
 */
const router = useRouter()
const g = useGame()
const st = useSettings()
const ui = useUi()

type StepId = 'world' | 'filter' | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10
const STEPS: Array<{ id: StepId; name: string }> = [
  { id: 'world', name: '世界' }, { id: 'filter', name: '內容篩選' },
  { id: 1, name: '基本資料' }, { id: 2, name: '出身' }, { id: 3, name: '屬性' }, { id: 4, name: '基本功' }, { id: 5, name: '生命軌跡' },
  { id: 6, name: '橋與義體' }, { id: 7, name: '特質' }, { id: 8, name: '技能' }, { id: 9, name: '錢與裝備' }, { id: 10, name: '難度與存檔規則' },
]
const stepIdx = ref(0)
const step = computed(() => STEPS[stepIdx.value].id)

// ---- 世界 ----
const packs = reactive([
  { id: 'base', name: '基本世界', sub: '緋夜城 2069・內建・一定要開', on: true, locked: true },
  { id: 'ledger', name: '帳本外傳', sub: '世界包・你自己做的・3 個事件、1 件委託', on: true },
  { id: 'rain', name: '舊港的雨季', sub: '世界包・匯入的・格式檢查通過', on: false },
])

// ---- 1 基本資料 ----
const basic = reactive({ name: '', gender: '女', pronoun: '她', view: '第二人稱', age: '24', build: '中性', height: '中等', skin: '小麥色', hair: '短髮', hairColor: '黑', eyes: '褐', beast: '沒有', cyber: '後頸的橋露在外面', looks: '', background: '' })
const NAMES = ['凜', '小穗', '阿海', '影', '朔夜', '千秋', '小滿', '晴']
function randomName() { basic.name = NAMES[Math.floor(Math.random() * NAMES.length)] }

// ---- 2 出身 ----
const originId = ref('hive')
const origin = computed(() => ORIGINS.find(o => o.id === originId.value)!)
const corp = ref<string>('緋櫻')
const favor = ref<string>('孤星連')
function pickOrigin(id: string) { originId.value = id; favor.value = ORIGINS.find(o => o.id === id)!.favor[0]; picks.cyber = picks.cyber.filter(c => !c.corpOnly) }

// ---- 3 屬性 ----
const attrs = reactive<AttrPick>({ 體格: 12, 反應: 15, 技術: 8, 智識: 13, 意志: 10, 魅力: 14 })
const attrBonus = reactive<Partial<Record<AttrName, number>>>({ 意志: 2 })
const totals = computed(() => attrTotals(attrs, attrBonus))
const freeLeft = computed(() => ATTR_FREE - ATTRS.reduce((s, a) => s + (attrBonus[a] ?? 0), 0))
function bump(a: AttrName, d: 1 | -1) {
  const v = attrBonus[a] ?? 0
  if (d > 0 && freeLeft.value <= 0) { ui.toast('自由點數用完了。', 'warn'); return }
  if (d > 0 && totals.value[a] >= 18) { ui.toast('單項最高 18。', 'warn'); return }
  if (d < 0 && v <= 0) return
  attrBonus[a] = v + d
}
function setAttr(a: AttrName, raw: string) { if (raw === '') delete attrs[a]; else attrs[a] = Number(raw) }

// ---- 4 基本功 ----
const basics = reactive<Record<string, number>>({ 槍械: 3, 隱匿: 2, 交涉: 2, 街頭直覺: 2, 運動: 1 })
const bLeft = computed(() => basicLeft(basics))
function basicStep(name: string, d: 1 | -1) {
  const b = basicStepBlock(basics, name, d)
  if (b) { ui.toast(b, 'warn'); return }
  basics[name] = (basics[name] ?? 0) + d
}

// ---- 5 生命軌跡 ----
const FILTER_OF: Record<string, keyof typeof st.s> = {}
const life = reactive<Record<string, string>>({ family: 'alive', incident: 'debt', friend: 'grew', enemy: '', love: '', want: 'truth', sex: '', latent: '' })
const lifeOptions = (id: string) => LIFE_TABLES.find(t => t.id === id)!.options.filter(o => !o.filter || st.s[o.filter as 'filterPublic'])
const lifeTables = computed(() => LIFE_TABLES.filter(t => lifeOptions(t.id).length))
function roll(id: string) { const o = lifeOptions(id); life[id] = o[Math.floor(Math.random() * o.length)].id }
void FILTER_OF

// ---- 6 橋與義體 ----
const picks = reactive<{ cyber: CyberOption[]; traits: TraitOption[]; gear: ItemDef[] }>({ cyber: [CYBER_OPTIONS.find(c => c.id === 'br_std')!, CYBER_OPTIONS.find(c => c.id === 'cw_eye')!], traits: [], gear: [] })
const cy = computed(() => cyberSummary(picks.cyber))
function toggleCyber(o: CyberOption) {
  const has = picks.cyber.some(c => c.id === o.id)
  if (has) { picks.cyber = picks.cyber.filter(c => c.id !== o.id); return }
  const b = cyberPickBlock(picks.cyber, o, { id: originId.value, corp: corp.value })
  if (b) { ui.toast(b, 'warn'); return }
  picks.cyber = o.kind === 'bridge' ? [...picks.cyber.filter(c => c.kind !== 'bridge'), o] : [...picks.cyber, o]
}

// ---- 7 特質 ----
const tr = computed(() => traitSummary(picks.traits, st.s.traitPoints))
const traitList = computed(() => TRAITS.filter(t => !t.adult || st.s.filterPublic || st.s.filterRestraint))
function toggleTrait(t: TraitOption) {
  if (picks.traits.some(x => x.id === t.id)) { picks.traits = picks.traits.filter(x => x.id !== t.id); return }
  const b = traitPickBlock(picks.traits, t, st.s.traitPoints)
  if (b) { ui.toast(b, 'warn'); return }
  picks.traits = [...picks.traits, t]
}
const custom = reactive({ open: false, name: '', desc: '', effect: '一項基本功的檢定 +2' })
const EFFECTS = [['一項基本功的檢定 +2', 2], ['現實或內海的命中 +1', 2], ['迴避 +1', 2], ['先攻 +3', 2], ['感載上限 +4', 2], ['生命值上限 +5', 2], ['RAM 上限 +1', 2], ['某個場合的收入 +15%', 2], ['條件很窄的檢定 +2', 1]] as const
function addCustom() {
  if (!custom.name.trim()) { ui.toast('先寫一個名字。', 'warn'); return }
  const cost = EFFECTS.find(e => e[0] === custom.effect)![1]
  const t: TraitOption = { id: `c_${Date.now()}`, name: custom.name.trim(), cat: '自訂', cost, effect: custom.effect }
  const b = traitPickBlock(picks.traits, t, st.s.traitPoints)
  if (b) { ui.toast(b, 'warn'); return }
  picks.traits = [...picks.traits, t]
  custom.open = false; custom.name = ''; custom.desc = ''
}

// ---- 8 技能 ----
const XP_START = 200
const learned = ref<string[]>([])
const learnedSet = computed(() => new Set(learned.value))
const xpLeft = computed(() => XP_START - learned.value.reduce((s, id) => { const t = SKILL_TREES.find(x => id.startsWith(x.id + ':'))!; return s + skillXp(t.skills.find(k => k.id === id)!) }, 0))
const skTree = ref(SKILL_TREES[0].id)
const skT = computed(() => SKILL_TREES.find(t => t.id === skTree.value)!)
function learnS(id: string) { learned.value = [...learned.value, id] }
function forget(id: string) {
  // 拿掉一個技能時，接著它的、或因此開不了階的技能也一起拿掉
  const t = SKILL_TREES.find(x => id.startsWith(x.id + ':'))!
  let keep = learned.value.filter(x => x !== id)
  let changed = true
  while (changed) {
    changed = false
    for (const x of [...keep]) {
      const s = t.skills.find(k => k.id === x)
      if (!s) continue
      const lower = t.skills.filter(k => k.tier < s.tier && keep.includes(k.id)).reduce((a, k) => a + skillXp(k), 0)
      if ((s.pre && !keep.includes(`${t.id}:${s.pre}`)) || lower < TIER_THRESHOLDS[s.tier - 1]) { keep = keep.filter(y => y !== x); changed = true }
    }
  }
  learned.value = keep
}

// ---- 9 錢與裝備 ----
const gr = computed(() => gearSummary(picks.gear))
function addGear(d: ItemDef) {
  const b = gearAddBlock(picks.gear, d)
  if (b) { ui.toast(b, 'warn'); return }
  picks.gear = [...picks.gear, d]
}
function removeGear(i: number) { picks.gear = picks.gear.filter((_, k) => k !== i) }
function suggest() { picks.gear = fitKit(SUGGESTED_KITS[originId.value].map(id => ITEMS[id])) }
const money = computed(() => START_MONEY + origin.value.money + cy.value.money + gr.value.money)

// ---- 每一步擋住「下一步」的原因 ----
const block = computed<string | null>(() => {
  switch (step.value) {
    case 1: return basic.name.trim() ? ageBlock(basic.age) : '先取一個名字。'
    case 3: return attrBlock(attrs, attrBonus)
    case 4: return bLeft.value < 0 ? `超過了 ${-bLeft.value} 點。` : null
    case 6: return cyberBlock(picks.cyber)
    case 7: return traitBlock(picks.traits, st.s.traitPoints)
    case 8: return xpLeft.value < 0 ? '歷練點超過了。' : null
    case 9: return gr.value.left < 0 ? '裝備點數超過了。' : null
    default: return null
  }
})
const firstBlocked = computed(() => {
  const checks: Array<[number, string | null]> = [[2, basic.name.trim() ? ageBlock(basic.age) : '先取一個名字。'], [4, attrBlock(attrs, attrBonus)], [7, cyberBlock(picks.cyber)], [8, traitBlock(picks.traits, st.s.traitPoints)]]
  return checks.find(([, b]) => b) ?? null
})
function next() { if (stepIdx.value < STEPS.length - 1) stepIdx.value++ }
function go(i: number) {
  // 往後跳要先過前面每一步的檢查
  if (i > stepIdx.value && firstBlocked.value && firstBlocked.value[0] < i) { stepIdx.value = firstBlocked.value[0]; ui.toast(firstBlocked.value[1]!, 'warn'); return }
  stepIdx.value = i
}
function quick(q: typeof QUICK_STARTS[number]) {
  basic.name = q.name
  pickOrigin(q.origin)
  picks.gear = fitKit(SUGGESTED_KITS[q.origin].map(id => ITEMS[id]))
  stepIdx.value = STEPS.length - 1
  ui.toast(`快速開始：${q.name}。照預設填好了，可以回頭改。`)
}

/** 開始：把建好的角色寫進這個瀏覽器裡的這一局。存檔格不受影響。 */
function start() {
  if (firstBlocked.value) { stepIdx.value = firstBlocked.value[0]; ui.toast(firstBlocked.value[1]!, 'warn'); return }
  g.character.name = basic.name.trim()
  g.character.origin = `${origin.value.name}出身`
  g.character.attrs = ATTRS.map(a => ({ name: a, base: totals.value[a], eff: totals.value[a] }))
  g.character.traits = { good: [origin.value.trait.name, ...picks.traits.filter(t => !t.flaw).map(t => t.name)], bad: picks.traits.filter(t => t.flaw).map(t => t.name) }
  g.character.xp = xpLeft.value
  const b = { ...basics }
  b[origin.value.skill] = (b[origin.value.skill] ?? 0) + 1
  for (const k of Object.keys(g.basics)) g.basics[k] = b[k] ?? 0
  g.learned = [...learned.value]
  g.loadout = []
  g.syncTrees()
  g.money.acc = money.value; g.money.cash = 0
  for (const d of picks.gear) g.addItem(d.id)
  g.addLog({ prose: [`${basic.name.trim()}，${basic.age} 歲，${origin.value.line}。故事從${origin.value.home}開始。`], place: origin.value.home })
  ui.toast('角色建好了。')
  router.push('/')
}
const attrMods = computed(() => ATTRS.map(a => `${a} ${totals.value[a]}（${attrMod(totals.value[a]) >= 0 ? '+' : ''}${attrMod(totals.value[a])}）`))
</script>

<template>
  <div class="ng">
    <StatusBar back title="開新局與建角" />
    <nav class="steps" aria-label="步驟">
      <button v-for="(s, i) in STEPS" :key="String(s.id)" type="button" class="st" :class="{ on: i === stepIdx, done: i < stepIdx }" @click="go(i)">
        <span class="mono">{{ typeof s.id === 'number' ? s.id : i === 0 ? '世' : '篩' }}</span>{{ s.name }}
      </button>
    </nav>
    <div class="body">
      <main class="panel cut pad page">
        <!-- 世界 -->
        <template v-if="step === 'world'">
          <h2>世界</h2>
          <p class="setgrp">世界包<Hint>基本世界本身也是一個世界包；玩家做的世界包疊在上面。匯入走同一套檢查。</Hint></p>
          <div v-for="p in packs" :key="p.id" class="setrow">
            <span class="nm">{{ p.name }}</span><span class="val">{{ p.sub }}</span>
            <button v-if="!p.locked" type="button" class="switch" role="switch" :aria-label="p.name" :aria-checked="p.on" :class="{ on: p.on }" @click="p.on = !p.on" />
            <span v-else class="df">一定要開</span>
          </div>
          <p class="setgrp">快速開始<Hint>每個出身準備兩個預設角色，一個偏戰鬥、一個偏非戰鬥。選了直接填好，最後一頁還能回頭改。</Hint></p>
          <div class="quick"><button v-for="q in QUICK_STARTS" :key="q.name" type="button" class="lrow" @click="quick(q)"><span class="grow"><b>{{ q.name }}・{{ ORIGINS.find(o => o.id === q.origin)!.name }}・{{ q.role }}</b><small>{{ q.line }}</small></span></button></div>
        </template>

        <!-- 內容篩選 -->
        <template v-else-if="step === 'filter'">
          <h2>內容篩選</h2>
          <div class="lockline"><span class="lk">LOCK</span><b>所有角色皆為成年人。</b><Hint>這一條不能關。建角、匯入與世界編輯器都會擋下低於 18 的年齡。</Hint></div>
          <div class="lockline"><span class="lk">LOCK</span><b>不寫血腥，不寫懷孕。</b><Hint>這是內容的底線，不是篩選的選項，所以沒有開關。</Hint></div>
          <p class="setgrp">題材<Hint>內容篩選排在建角之前，關掉的題材不會出現在建角的選項裡（生命軌跡的性經歷與潛在性癖、特質）。篩選跟著存檔走；開新局時預設是上一次的選擇。</Hint></p>
          <div v-for="[k, n] in ([['filterRestraint', '拘束'], ['filterDollChip', '人偶晶片的失憶工作'], ['filterPublic', '公開場合'], ['filterContract', '契約']] as const)" :key="k" class="setrow">
            <span class="nm">{{ n }}</span><span />
            <button type="button" class="switch" role="switch" :aria-label="n" :aria-checked="st.s[k]" :class="{ on: st.s[k] }" @click="st.s[k] = !st.s[k]" />
          </div>
        </template>

        <!-- 1 基本資料 -->
        <template v-else-if="step === 1">
          <h2>基本資料</h2>
          <div class="form">
            <label class="fld"><span>名字</span><span class="row"><input v-model="basic.name" class="inp" placeholder="你取的名字"><button type="button" class="btn sm" @click="randomName">隨機</button></span></label>
            <label class="fld"><span>年齡<Hint>只收整數，低於 18 時「下一步」不能按。</Hint></span><input v-model="basic.age" class="inp" inputmode="numeric" aria-describedby="agewarn"></label>
            <label v-for="[k, n] in ([['gender', '性別'], ['pronoun', '稱呼'], ['view', '敘事視角'], ['build', '體型'], ['height', '身高'], ['skin', '膚色'], ['hair', '髮型'], ['hairColor', '髮色'], ['eyes', '眼睛'], ['beast', '獸化'], ['cyber', '明顯的義體']] as const)" :key="k" class="fld">
              <span>{{ n }}<Hint v-if="k === 'gender'">決定戰敗事件、成人事件與 NTR 分到哪些版本。現實的身體之後可以靠義體或生技改，內海的化身可以自由變化。</Hint></span>
              <select v-model="basic[k]" class="inp"><option v-for="o in LOOKS[k]" :key="o">{{ o }}</option></select>
            </label>
            <label class="fld wide"><span>外觀補充（選用）</span><input v-model="basic.looks" class="inp" placeholder="例：左耳的顏色和右耳不一樣"></label>
            <label class="fld wide"><span>背景（選用）<Hint>寫進給 AI 的角色資料裡。</Hint></span><textarea v-model="basic.background" class="inp" rows="3" /></label>
          </div>
          <div v-if="ageBlock(basic.age)" id="agewarn" class="blocking">{{ ageBlock(basic.age) }}</div>
        </template>

        <!-- 2 出身 -->
        <template v-else-if="step === 2">
          <h2>出身</h2>
          <label class="fld"><span>出身</span><select :value="originId" class="inp" @change="pickOrigin(($event.target as HTMLSelectElement).value)"><option v-for="o in ORIGINS" :key="o.id" :value="o.id">{{ o.name }}・{{ o.line }}</option></select></label>
          <div class="cols2 mt">
            <div>
              <div class="kv"><span>基本功 +1</span><b>{{ origin.skill }}</b></div>
              <div class="kv"><span>出身特質</span><b>{{ origin.trait.name }}・{{ origin.trait.effect }}</b></div>
              <div class="kv"><span>起始身分</span><b>{{ origin.status }}</b></div>
              <div class="kv"><span>起始住處</span><b>{{ origin.home }}</b></div>
              <div class="kv"><span>開場就在名冊上</span><b>{{ origin.partner }}、雷</b></div>
              <div class="kv"><span>起始的錢</span><b>{{ origin.money >= 0 ? '+' : '−' }}{{ Math.abs(origin.money) }}</b></div>
            </div>
            <div>
              <label v-if="origin.id === 'corp'" class="fld"><span>原本那家企業<Hint>選的那一家決定好感給誰、買得到哪一家的橋。企業出身不帶債。</Hint></span><select v-model="corp" class="inp"><option v-for="c in CORPS" :key="c">{{ c }}</option></select></label>
              <label v-else class="fld"><span>好感 25 的勢力<template v-if="origin.favor.length > 1">（選一）</template></span><select v-model="favor" class="inp"><option v-for="f in origin.favor" :key="f">{{ f }}</option></select></label>
              <p v-if="origin.extra" class="empty-note mt">{{ origin.extra }}</p>
            </div>
          </div>
        </template>

        <!-- 3 屬性 -->
        <template v-else-if="step === 3">
          <h2>屬性</h2>
          <p class="setgrp">把 {{ ATTR_ARRAY.join('、') }} 分到六項，再加 {{ ATTR_FREE }} 點<Hint>每項一個下拉，選過的數字從其他下拉消失；兩顆 ± 加自由點數，單項最高 18。調整值是（屬性 − 10）÷ 2，無條件捨去。屬性之後不能用歷練點升。</Hint></p>
          <div class="attrs">
            <div v-for="a in ATTRS" :key="a" class="at cut-sm">
              <span class="k">{{ a }}</span>
              <select :value="attrs[a] ?? ''" class="inp" :aria-label="a" @change="setAttr(a, ($event.target as HTMLSelectElement).value)">
                <option value="">—</option><option v-for="v in freeValues(attrs, a)" :key="v" :value="v">{{ v }}</option>
              </select>
              <span class="stepper"><button type="button" :aria-label="`${a}減一`" @click="bump(a, -1)">−</button><b>+{{ attrBonus[a] ?? 0 }}</b><button type="button" :aria-label="`${a}加一`" @click="bump(a, 1)">＋</button></span>
              <span class="tot mono">{{ totals[a] || '—' }}<small v-if="attrs[a]">（{{ attrMod(totals[a]) >= 0 ? '+' : '' }}{{ attrMod(totals[a]) }}）</small></span>
            </div>
          </div>
          <div class="kv"><span>自由點數</span><b>剩 {{ freeLeft }}</b></div>
          <div v-if="block" class="blocking">{{ block }}</div>
        </template>

        <!-- 4 基本功 -->
        <template v-else-if="step === 4">
          <h2>基本功・剩 {{ bLeft }}／{{ BASIC_POINTS }} 點</h2>
          <p class="setgrp">單項最高 {{ BASIC_MAX }} 級<Hint>一點一級；出身另外給一項 +1（可以到 4）。這兩個數字在設定裡可以調。</Hint></p>
          <div class="basics">
            <div v-for="b in BASIC_SKILLS" :key="b.name" class="brow">
              <span class="bn">{{ b.name }}<small>{{ b.attr }}</small></span>
              <span class="pips"><i v-for="n in 4" :key="n" :class="{ on: n <= (basics[b.name] ?? 0), bonus: origin.skill === b.name && n === (basics[b.name] ?? 0) + 1 }" /></span>
              <span class="stepper"><button type="button" :aria-label="`${b.name}減一`" :aria-disabled="!basics[b.name] || undefined" @click="basicStep(b.name, -1)">−</button><b>{{ (basics[b.name] ?? 0) + (origin.skill === b.name ? 1 : 0) }}</b><button type="button" :aria-label="`${b.name}加一`" :aria-disabled="!!basicStepBlock(basics, b.name, 1) || undefined" @click="basicStep(b.name, 1)">＋</button></span>
            </div>
          </div>
        </template>

        <!-- 5 生命軌跡 -->
        <template v-else-if="step === 5">
          <h2>生命軌跡</h2>
          <p class="setgrp">每一張可以擲、可以選、可以跳過<Hint>結果會變成遊戲裡的東西：一位 NPC、一個勢力的好感或敵對值、一筆錢或債、一個旗標、一個缺陷、一個個人目標。性經歷與潛在性癖兩張表照內容篩選過濾；所有相關的人物都是成年人。</Hint></p>
          <div v-for="t in lifeTables" :key="t.id" class="setrow">
            <span class="nm">{{ t.name }}</span>
            <select v-model="life[t.id]" class="inp wide" :aria-label="t.name"><option value="">跳過</option><option v-for="o in lifeOptions(t.id)" :key="o.id" :value="o.id">{{ o.text }}</option></select>
            <button type="button" class="btn sm" @click="roll(t.id)">擲</button>
            <small v-if="life[t.id]" class="res">{{ lifeOptions(t.id).find(o => o.id === life[t.id])?.result }}</small>
          </div>
        </template>

        <!-- 6 橋與義體 -->
        <template v-else-if="step === 6">
          <h2>橋與義體・剩 {{ cy.left }}／{{ CYBER_POINTS }} 點</h2>
          <p class="setgrp">橋・選一座<Hint>橋決定四類技能的容量（現實／內海／社交／媒體）。企業出身才選得到那家企業的橋。</Hint></p>
          <button v-for="o in CYBER_OPTIONS.filter(x => x.kind === 'bridge')" :key="o.id" type="button" class="lrow pick" :class="{ on: picks.cyber.some(c => c.id === o.id), no: !!cyberPickBlock(picks.cyber, o, { id: originId, corp }) && !picks.cyber.some(c => c.id === o.id) }" @click="toggleCyber(o)">
            <span class="grow"><b>{{ o.name }}</b><small>{{ o.brand }}・{{ ['', 'I', 'II'][o.grade] }}・{{ o.cap!.join('／') }}・沉溺成本 {{ o.sink }}</small><small v-if="cyberPickBlock(picks.cyber, o, { id: originId, corp }) && !picks.cyber.some(c => c.id === o.id)" class="warn-t">{{ cyberPickBlock(picks.cyber, o, { id: originId, corp }) }}</small></span>
            <Hint :text="o.note" /><b class="pt mono">{{ o.points }}</b>
          </button>
          <p class="setgrp">其他義體<Hint>每一件照常算沉溺的下限：開場改得越多，沉溺的起點越高。</Hint></p>
          <button v-for="o in CYBER_OPTIONS.filter(x => x.kind !== 'bridge')" :key="o.id" type="button" class="lrow pick" :class="{ on: picks.cyber.some(c => c.id === o.id) }" @click="toggleCyber(o)">
            <span class="grow"><b>{{ o.name }}</b><small>{{ o.part }}・{{ o.kind === 'light' ? '輕度' : '侵入' }}・沉溺成本 {{ o.sink }}</small></span>
            <Hint :text="o.note" /><b class="pt mono">{{ o.points }}</b>
          </button>
          <div class="kv"><span>沒花完的點數換錢<Hint>每點 {{ CYBER_POINT_MONEY }}。</Hint></span><b>+{{ cy.money }}</b></div>
          <div v-if="block" class="blocking">{{ block }}</div>
        </template>

        <!-- 7 特質 -->
        <template v-else-if="step === 7">
          <h2>特質與缺陷・剩 {{ tr.left }} 點</h2>
          <p class="setgrp">起始 {{ st.s.traitPoints }} 點，另送出身特質「{{ origin.trait.name }}」<Hint>每個特質 1～3 點：一格（例如一項基本功 +2）是 2 點；最多 2 個缺陷，每個退 1～3 點；特質總數上限 8 個（不含出身特質與缺陷）。特質不佔橋的容量。</Hint></p>
          <div class="traits">
            <button v-for="t in traitList" :key="t.id" type="button" class="lrow pick" :class="{ on: picks.traits.some(x => x.id === t.id), flaw: t.flaw }" @click="toggleTrait(t)">
              <span class="grow"><b>{{ t.name }}</b><small>{{ t.cat }}・{{ t.effect }}</small></span><b class="pt mono">{{ t.flaw ? '+' : '−' }}{{ t.cost }}</b>
            </button>
            <button v-for="t in picks.traits.filter(x => x.cat === '自訂')" :key="t.id" type="button" class="lrow pick on" @click="toggleTrait(t)"><span class="grow"><b>{{ t.name }}</b><small>自訂・{{ t.effect }}</small></span><b class="pt mono">−{{ t.cost }}</b></button>
          </div>
          <div class="go"><button type="button" class="btn sm" @click="custom.open = !custom.open">自訂</button></div>
          <div v-if="custom.open" class="panel cut pad custom">
            <label class="fld"><span>名字</span><input v-model="custom.name" class="inp"></label>
            <label class="fld"><span>說明</span><input v-model="custom.desc" class="inp"></label>
            <label class="fld"><span>效果<Hint>從 CHARACTER 5.2 節的表裡選；價錢照選的效果算，和現成的特質同一套。</Hint></span><select v-model="custom.effect" class="inp"><option v-for="e in EFFECTS" :key="e[0]" :value="e[0]">{{ e[0] }}（{{ e[1] }} 點）</option></select></label>
            <div class="go"><button type="button" class="btn sm pri" @click="addCustom">加上</button></div>
          </div>
          <div v-if="block" class="blocking">{{ block }}</div>
        </template>

        <!-- 8 技能 -->
        <template v-else-if="step === 8">
          <h2>技能・剩 {{ xpLeft }}／{{ XP_START }} 歷練點</h2>
          <p class="setgrp">在技能樹上花<Hint>學一個技能花「階 × 20」，算進那棵樹的累計；累計到 40 開 2 階、120 開 3 階。起始的 200 點大約能把一棵樹開到 3 階。沒花完的留著。</Hint></p>
          <div class="filters"><button v-for="t in SKILL_TREES" :key="t.id" type="button" :class="{ on: skTree === t.id }" @click="skTree = t.id">{{ t.name }}<template v-if="treeSpent(t, learnedSet)"> {{ tierOpen(treeSpent(t, learnedSet)) }}</template></button></div>
          <div class="kv"><span>{{ skT.name }}的累計</span><b>{{ treeSpent(skT, learnedSet) }}・開到 {{ tierOpen(treeSpent(skT, learnedSet)) }} 階</b></div>
          <div class="sks">
            <div v-for="s in skT.skills.filter(k => k.tier <= 3)" :key="s.id" class="lrow">
              <span class="tierb mono">{{ s.tier }}</span>
              <span class="grow"><b>{{ s.name }}</b><small>{{ s.layer === 'sig' ? '招牌' : s.layer === 'front' ? '前層' : '後層' }}・{{ s.kindName }}・容量 {{ s.cap }}<template v-if="s.pre">・前置 {{ s.pre }}</template></small></span>
              <Hint :text="s.real !== '—' ? s.real : s.net !== '—' ? s.net : s.opinion" />
              <button v-if="learnedSet.has(s.id)" type="button" class="btn sm pri" @click="forget(s.id)">✓ {{ skillXp(s) }}</button>
              <ReasonButton v-else sm :reason="learnBlock(skT, s, learnedSet, xpLeft)" @go="learnS(s.id)">學 {{ skillXp(s) }}</ReasonButton>
            </div>
          </div>
        </template>

        <!-- 9 錢與裝備 -->
        <template v-else-if="step === 9">
          <h2>錢與裝備・剩 {{ gr.left }}／{{ GEAR_POINTS }} 點</h2>
          <p class="setgrp">只能買 I～II 級<Hint>一件的點數＝目錄價 ÷ 250，無條件進位，最少 1 點。不能買義體（義體走上一步的點數）、藥、成人道具。沒花完的點數每點換 {{ GEAR_POINT_MONEY }}。另外白給一套出身那一區的日常服裝、一支板子、兩個彈匣的普通彈藥、預設化身的 SKIN。</Hint></p>
          <div class="go left"><button type="button" class="btn sm pri" @click="suggest">出身的建議組合</button></div>
          <div class="gearl">
            <div>
              <template v-for="c in GEAR_CATALOG" :key="c.cat">
                <p class="h">{{ c.cat }}</p>
                <div class="ggrid">
                  <div v-for="id in c.ids" :key="id" class="gi">
                    <ItemSlot :item="ITEMS[id]" size="sm" show-name :locked="!!gearAddBlock(picks.gear, ITEMS[id])" @select="addGear(ITEMS[id])" />
                    <small class="mono">{{ gearPoints(ITEMS[id]) }} 點</small>
                  </div>
                </div>
              </template>
            </div>
            <div class="panel cut pad chosen">
              <p class="h">已選</p>
              <div v-if="!picks.gear.length" class="empty-note">還沒選。點左邊的物品加進來。</div>
              <div v-for="(d, i) in picks.gear" :key="i" class="lrow"><ItemSlot :item="d" size="sm" /><span class="grow"><b :style="{ color: `var(--g${d.grade})` }">{{ d.name }}</b><small>{{ gearPoints(d) }} 點</small></span><button type="button" class="btn sm ghost" :aria-label="`拿掉${d.name}`" @click="removeGear(i)">✕</button></div>
              <div class="kv"><span>起始的錢</span><b><MoneyTag kind="acc" :amount="money" /></b></div>
            </div>
          </div>
          <div v-if="block" class="blocking">{{ block }}</div>
        </template>

        <!-- 10 難度與存檔規則＋總覽 -->
        <template v-else>
          <h2>難度與存檔規則</h2>
          <RuleFields show-trait-points compact />
          <p class="setgrp">總覽</p>
          <div class="cols2">
            <div>
              <div class="kv"><span>名字</span><b>{{ basic.name || '（還沒取）' }}・{{ basic.age }} 歲・{{ basic.gender }}</b></div>
              <div class="kv"><span>出身</span><b>{{ origin.name }}</b></div>
              <div class="kv"><span>屬性</span><b>{{ ATTRS.map(a => totals[a]).join('・') }}</b></div>
              <div class="kv"><span>橋</span><b>{{ cy.bridge?.name ?? '沒有' }}</b></div>
              <div class="kv"><span>沉溺的下限</span><b>{{ cy.sinkFloor }}</b></div>
            </div>
            <div>
              <div class="kv"><span>特質</span><b>{{ [origin.trait.name, ...picks.traits.map(t => t.name)].join('、') }}</b></div>
              <div class="kv"><span>技能</span><b>{{ learned.length }} 個・剩 {{ xpLeft }} 歷練點</b></div>
              <div class="kv"><span>裝備</span><b>{{ picks.gear.length }} 件</b></div>
              <div class="kv"><span>起始的錢</span><b><MoneyTag kind="acc" :amount="money" /></b></div>
            </div>
          </div>
          <div v-if="firstBlocked" class="blocking">第 {{ STEPS[firstBlocked[0]].id }} 步：{{ firstBlocked[1] }}</div>
          <div class="blocking warnb">開始會蓋掉這個瀏覽器裡現在這一局（存檔格不受影響）。</div>
        </template>
      </main>

      <aside class="panel cut pad sum">
        <p class="h">目前的角色</p>
        <div class="kv"><span>名字</span><b>{{ basic.name || '（你取的名字）' }}</b></div>
        <div class="kv"><span>年齡</span><b :class="{ 'warn-t': !!ageBlock(basic.age) }">{{ basic.age }}</b></div>
        <div class="kv"><span>出身</span><b>{{ origin.name }}</b></div>
        <div class="kv"><span>屬性</span><b class="mono">{{ ATTRS.map(a => totals[a] || '—').join('・') }}</b></div>
        <div class="kv"><span>基本功</span><b>剩 {{ bLeft }} 點</b></div>
        <div class="kv"><span>橋</span><b>{{ cy.bridge?.name ?? '沒有' }}</b></div>
        <div class="kv"><span>義體點數</span><b>剩 {{ cy.left }}</b></div>
        <div class="kv"><span>沉溺的下限</span><b>{{ cy.sinkFloor }}</b></div>
        <div class="kv"><span>特質點</span><b>剩 {{ tr.left }}</b></div>
        <div class="kv"><span>歷練點</span><b>剩 {{ xpLeft }}</b></div>
        <div class="kv"><span>裝備點數</span><b>剩 {{ gr.left }}</b></div>
        <div class="kv"><span>起始的錢</span><b>{{ money }}</b></div>
        <p class="empty-note mt">{{ attrMods.join('、') }}</p>
      </aside>
    </div>
    <footer class="nav">
      <ReasonButton :reason="stepIdx === 0 ? '這是第一步。' : null" @go="stepIdx--">上一步</ReasonButton>
      <span class="grow mono">{{ stepIdx + 1 }}／{{ STEPS.length }}・{{ STEPS[stepIdx].name }}</span>
      <ReasonButton v-if="stepIdx < STEPS.length - 1" pri :reason="block" @go="next">下一步</ReasonButton>
      <ReasonButton v-else pri :reason="firstBlocked ? firstBlocked[1] : null" @go="start">開始</ReasonButton>
    </footer>
  </div>
</template>

<style scoped>
.ng { min-height: 100vh; min-height: 100dvh; display: flex; flex-direction: column; }
.steps { display: flex; gap: 4px; overflow-x: auto; padding: 8px 12px; border-bottom: 2px solid var(--line); flex: none; }
.st { flex: none; display: flex; gap: 6px; align-items: center; font-size: 12px; font-weight: 800; padding: 6px 10px; background: var(--bg-2); color: var(--ink-3); border: 0; cursor: pointer; }
.st .mono { width: 18px; height: 18px; border-radius: 50%; background: var(--bg-term); display: grid; place-items: center; font-size: 10px; }
.st.done { color: var(--ink-2); }
.st.done .mono { background: var(--b); color: #17111F; }
.st.on { background: var(--a); color: #fff; }
.body { flex: 1; display: grid; grid-template-columns: minmax(0, 1fr) 280px; gap: 12px; padding: 12px; align-items: start; max-width: 1360px; width: 100%; margin: 0 auto; }
.page h2 { margin: 0 0 10px; font-size: 20px; }
.nav { position: sticky; bottom: 0; display: flex; gap: 10px; align-items: center; padding: 10px 16px; background: var(--bg-term); border-top: 2px solid var(--line); z-index: 5; }
.grow { flex: 1; min-width: 0; }
.nav .grow { text-align: center; color: var(--ink-3); font-size: 12px; }
.form { display: grid; grid-template-columns: repeat(auto-fill, minmax(200px, 1fr)); gap: 10px; }
.fld { display: grid; gap: 4px; font-size: 12px; font-weight: 800; color: var(--ink-2); min-width: 0; }
.fld > span:first-child { display: inline-flex; gap: 4px; align-items: center; }
.fld.wide { grid-column: 1 / -1; }
.row { display: flex; gap: 6px; }
.inp { width: 100%; min-width: 0; background: var(--bg-term); color: var(--ink); border: 0; box-shadow: inset 0 0 0 2px var(--line); padding: 8px 10px; font: 600 14px var(--font); }
.inp:focus { box-shadow: inset 0 0 0 2px var(--a); outline: none; }
.mt { margin-top: 12px; }
.quick { display: grid; gap: 5px; }
.quick small, .pick small, .sks small, .chosen small { display: block; color: var(--ink-3); font-size: 11px; }
.attrs { display: grid; grid-template-columns: repeat(auto-fill, minmax(180px, 1fr)); gap: 8px; margin-bottom: 8px; }
.at { display: grid; grid-template-columns: 1fr auto; gap: 6px; padding: 10px; background: var(--bg-2); align-items: center; }
.at .k { grid-column: 1 / -1; }
.at .tot { grid-column: 1 / -1; font-size: 22px; font-weight: 900; }
.at .tot small { font-size: 12px; color: var(--ink-3); }
.basics { display: grid; grid-template-columns: repeat(auto-fill, minmax(230px, 1fr)); gap: 6px 16px; }
.brow { display: grid; grid-template-columns: minmax(0, 1fr) auto auto; gap: 8px; align-items: center; padding: 5px 8px; background: var(--bg-2); }
.bn { font-weight: 800; font-size: 13px; }
.bn small { color: var(--ink-3); font-size: 10px; margin-left: 4px; }
.pips { display: flex; gap: 2px; }
.pips i { width: 12px; height: 10px; border-radius: 2px; background: var(--bg-term); }
.pips i.on { background: var(--a); }
.pips i.bonus { background: var(--ram); }
.res { grid-column: 1 / -1; color: var(--ram); font-size: 11.5px; }
.setrow .inp.wide { grid-column: auto; }
.pick { margin-bottom: 4px; }
.pick.no { opacity: .55; }
.pick.flaw b:first-child { color: var(--warn); }
.pt { font-size: 14px; color: var(--ap); min-width: 26px; text-align: right; }
.traits { display: grid; grid-template-columns: repeat(auto-fill, minmax(240px, 1fr)); gap: 4px 8px; }
.custom { margin-top: 8px; display: grid; gap: 8px; }
.sks { display: grid; gap: 4px; }
.tierb { width: 22px; height: 22px; display: grid; place-items: center; background: var(--bg-term); border-radius: 5px; font-size: 11px; flex: none; }
.go.left { justify-content: flex-start; margin: 0 0 8px; }
.gearl { display: grid; grid-template-columns: minmax(0, 1fr) 280px; gap: 12px; align-items: start; }
.ggrid { display: grid; grid-template-columns: repeat(auto-fill, minmax(70px, 1fr)); gap: 8px; margin-bottom: 10px; }
.gi { display: grid; gap: 2px; justify-items: center; }
.gi small { font-size: 10px; color: var(--ap); }
.chosen .lrow :deep(.slot) { width: 36px; flex: none; }
.warnb { margin-top: 8px; box-shadow: inset 3px 0 0 var(--warn); }
@media (max-width: 1000px) { .body { grid-template-columns: minmax(0, 1fr); } .sum { order: 2; } .gearl { grid-template-columns: 1fr; } }
@media (max-width: 720px) { .body { padding: 8px; } .sum { display: none; } }
</style>
