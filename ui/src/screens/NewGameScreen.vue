<script setup lang="ts">
import { computed, reactive, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import StatusBar from '../components/StatusBar.vue'
import Hint from '../components/Hint.vue'
import ItemSlot from '../components/ItemSlot.vue'
import ReasonButton from '../components/ReasonButton.vue'
import RuleFields from '../components/RuleFields.vue'
import SkillTreeView from '../components/SkillTreeView.vue'
import MoneyTag from '../components/MoneyTag.vue'
import { useGame } from '../stores/game'
import { useEngine } from '../stores/engine'
import { useSettings } from '../stores/settings'
import { useUi } from '../stores/ui'
import { ITEMS } from '../data/items'
import { SKILL_TREES } from '../data/content.generated'
import type { AttrId } from '@engine/src'
import {
  ORIGINS, CYBER_OPTIONS, CYBER_POINTS,
  LIFE_TABLES, GEAR_CATALOG, GEAR_POINTS, SUGGESTED_KITS, LOOKS, LOOK_GROUPS, ORIGIN_STYLE, BEAST_LINES, LIFE_BY_ORIGIN, QUICK_STARTS, type CyberOption,
} from '../data/creation'
import {
  fmtMod, cyberSummary, cyberPickBlock, cyberBlock, gearPoints, gearSummary, gearAddBlock, fitKit, derivedLooks,
} from '../lib/creation'
import { GENDER_ID, PERK_CATEGORY_NAME, rulesFromUi } from '../lib/engineView'
import { skillXp, TIER_THRESHOLDS } from '../lib/skills'
import { unavailable } from '../lib/unavailable'
import type { ItemDef } from '../data/types'

/**
 * 開新局與建角（UI 第 14 節、樣稿 docs/mockups/title.html 的「新遊戲」與 workshop.html 的「建角」）。
 * 先選世界、再設內容篩選（關掉的題材不出現在建角的選項裡），再建角十步；每一步都可以回頭改，最後一頁是總覽。
 * 下拉選單為主，自由輸入為輔。年齡是硬界線：低於 18 時「下一步」不能按。
 */
const router = useRouter()
const g = useGame()
const e = useEngine()
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
const basic = reactive<Record<string, string>>({
  name: '', gender: '女', pronoun: '她', view: '第二人稱', age: '24',
  height: '160～169 公分', build: '中性', figure: '勻稱', posture: '步子大、手臂擺得穩', skin: '小麥色',
  face: '鵝蛋臉', eyeShape: '有神的雙眼皮', eyes: '褐', mark: '沒有',
  hair: '耳下的短髮', hairColor: '黑', hairTexture: '一般',
  chest: '大小適中', waist: '結實', hips: '圓而翹', legs: '修長', hands: '指節分明、手指細長', privates: '（不寫）',
  looks: '', background: '', privatesNote: '',
})
/** 外觀的一格現在用不到（例：沒有獸化時的「派別」）：灰掉、不能選（UI.md 1.1 節）。 */
const lookOff = (f: { needs?: { k: string; not: string } }) => !!f.needs && basic[f.needs.k] === f.needs.not
function randomLooks() { for (const grp of LOOK_GROUPS) for (const f of grp.fields) basic[f.k] = f.opts[Math.floor(Math.random() * f.opts.length)] }
const NAMES = ['凜', '小穗', '阿海', '影', '朔夜', '千秋', '小滿', '晴']
function randomName() { basic.name = NAMES[Math.floor(Math.random() * NAMES.length)] }

// ---- 2 出身 ----
// 引擎的資料：屬性、基本功、出身、特質（id 是引擎的；顯示用 name）。假資料只剩引擎還沒有的欄位（起始身分的說法、起始的錢、出身的附註）。
e.creation.previewRules(rulesFromUi(st.s))
watch(() => [st.s.difficulty, st.s.traitPoints], () => e.creation.previewRules(rulesFromUi(st.s)))
const lim = computed(() => e.creation.limits)
const eAttrs = e.creation.attributes
const eSkills = e.creation.skills
const eOrigins = e.creation.origins
const ePerks = e.creation.perks.filter(p => p.category !== 'origin')
const skillName = (id: string) => eSkills.find(s => s.id === id)?.name ?? id
const attrName = (id: string) => eAttrs.find(a => a.id === id)?.name ?? id
const ageBlock = (raw: string) => e.creation.ageBlock(raw)

const originId = ref('hive')
const eo = computed(() => eOrigins.find(o => o.id === originId.value)!)
const originSkillId = computed(() => Object.keys(eo.value.skill_bonus)[0] ?? '')
const origin = computed(() => {
  const legacy = ORIGINS.find(o => o.id === originId.value)!
  const perk = e.creation.perks.find(p => p.id === eo.value.perk)
  return { ...legacy, name: eo.value.name, line: eo.value.line, home: eo.value.home, favor: eo.value.favor.choose_one, partner: eo.value.roster.join('、'), trait: { name: perk?.name ?? '', effect: perk?.desc ?? '' } }
})
const corp = ref<string>('緋櫻')
const favor = ref<string>('孤星連')
function pickOrigin(id: string) { originId.value = id; favor.value = eOrigins.find(o => o.id === id)!.favor.choose_one[0]; corp.value = favor.value; picks.cyber = picks.cyber.filter(c => !c.corpOnly) }

// ---- 3 屬性 ----
const attrs = reactive<Partial<Record<AttrId, number>>>({ body: 12, reflex: 15, tech: 8, intellect: 13, resolve: 10, charm: 14 })
const attrBonus = reactive<Partial<Record<AttrId, number>>>({ resolve: 2 })
const totals = computed(() => e.creation.attrTotals(attrs, attrBonus))
const budget = computed(() => e.creation.attrBudget(attrBonus))
const freeLeft = computed(() => budget.value.left)
const attrMod = (v: number) => e.creation.attrMod(v)
/** 每一項的下拉只列還沒被別項選走的數字（加上它自己現在的值）。 */
function freeValues(self: AttrId): number[] {
  const pool = [...lim.value.attrArray]
  for (const a of eAttrs) if (a.id !== self && attrs[a.id as AttrId] !== undefined) { const i = pool.indexOf(attrs[a.id as AttrId]!); if (i >= 0) pool.splice(i, 1) }
  return pool
}
const attrStepBlock = (a: AttrId, d: 1 | -1) => e.creation.attrStepBlock(attrs, attrBonus, a, d)
/** ±：加花自由點數（或把壓下去的加回來）；減先退自由點數，再往下壓，每壓一點多一點自由點數。能不能按問引擎。 */
function bump(a: AttrId, d: 1 | -1) {
  const b = attrStepBlock(a, d)
  if (b) { ui.toast(b, 'warn'); return }
  attrBonus[a] = (attrBonus[a] ?? 0) + d
}
function setAttr(a: AttrId, raw: string) { if (raw === '') delete attrs[a]; else attrs[a] = Number(raw) }

// ---- 4 基本功 ----
const basics = reactive<Record<string, number>>({ firearms: 3, stealth: 2, negotiate: 2, streetwise: 2, athletics: 1 })
const bLeft = computed(() => e.creation.skillLeft(basics))
/** 按下去之後的那一份先問引擎。 */
const basicNext = (id: string, d: 1 | -1) => ({ ...basics, [id]: (basics[id] ?? 0) + d })
const basicStepBlock = (id: string, d: 1 | -1) => e.creation.skillBlock(basicNext(id, d))
function basicStep(id: string, d: 1 | -1) {
  const b = basicStepBlock(id, d)
  if (b) { ui.toast(b, 'warn'); return }
  basics[id] = (basics[id] ?? 0) + d
}

// ---- 5 生命軌跡 ----
const FILTER_OF: Record<string, keyof typeof st.s> = {}
const life = reactive<Record<string, string>>({ family: 'alive', incident: 'debt', friend: 'grew', enemy: '', love: '', want: 'truth', sex: '', latent: '' })
/** 生命軌跡的說法跟著出身換（data/creation.ts 的 LIFE_BY_ORIGIN）：只換文字，結果的種類不變。 */
const lifeOptions = (id: string) => LIFE_TABLES.find(t => t.id === id)!.options
  .filter(o => !o.filter || st.s[o.filter as 'filterPublic'])
  .map(o => ({ ...o, ...(LIFE_BY_ORIGIN[originId.value]?.opts?.[`${id}.${o.id}`] ?? {}) }))
const lifeFlavor = (id: string) => LIFE_BY_ORIGIN[originId.value]?.flavor[id] ?? ''
const lifeTables = computed(() => LIFE_TABLES.filter(t => lifeOptions(t.id).length))
function roll(id: string) { const o = lifeOptions(id); life[id] = o[Math.floor(Math.random() * o.length)].id }
void FILTER_OF

// ---- 6 橋與義體 ----
const picks = reactive<{ cyber: CyberOption[]; perks: string[]; gear: ItemDef[] }>({ cyber: [CYBER_OPTIONS.find(c => c.id === 'br_std')!, CYBER_OPTIONS.find(c => c.id === 'cw_eye')!], perks: [], gear: [] })
const cy = computed(() => cyberSummary(picks.cyber))
function toggleCyber(o: CyberOption) {
  const has = picks.cyber.some(c => c.id === o.id)
  if (has) { picks.cyber = picks.cyber.filter(c => c.id !== o.id); return }
  const b = cyberPickBlock(picks.cyber, o, { id: originId.value, corp: corp.value })
  if (b) { ui.toast(b, 'warn'); return }
  picks.cyber = o.kind === 'bridge' ? [...picks.cyber.filter(c => c.kind !== 'bridge'), o] : [...picks.cyber, o]
}

// ---- 7 特質 ----
const tr = computed(() => e.creation.perkSummary(picks.perks))
const perkList = computed(() => ePerks.filter(t => !t.adult || st.s.filterPublic || st.s.filterRestraint))
const perkAddBlock = (id: string) => (picks.perks.includes(id) ? null : e.creation.perkBlock([...picks.perks, id]))
function togglePerk(id: string) {
  if (picks.perks.includes(id)) { picks.perks = picks.perks.filter(x => x !== id); return }
  const b = perkAddBlock(id)
  if (b) { ui.toast(b, 'warn'); return }
  picks.perks = [...picks.perks, id]
}

// ---- 8 技能 ----
const XP_START = 200
const learned = ref<string[]>([])
const xpLeft = computed(() => XP_START - learned.value.reduce((s, id) => { const t = SKILL_TREES.find(x => id.startsWith(x.id + ':'))!; return s + skillXp(t.skills.find(k => k.id === id)!) }, 0))
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
// 起始的錢照引擎給的（全部是現金、出身不加減，CHARACTER 5.4 節）；畫面只顯示，不自己算。
const money = computed(() => e.creation.limits.startMoney)

// ---- 外觀裡推出來的三樣（第四版）：外露的義體看第 6 步、獸化看第 6 步的耳與尾、風格看第 9 步的穿著 ----
const beastLine = ref('貓')
const hasBeast = computed(() => picks.cyber.some(c => c.beast))
const derived = computed(() => derivedLooks({ cyber: picks.cyber, gear: picks.gear, pronoun: basic.pronoun, baseStyle: ORIGIN_STYLE[originId.value] ?? '工裝', line: beastLine.value }))
const stepOf = (n: number) => STEPS.findIndex(x => x.id === n)

// ---- 外觀、私處與整份草稿（交給引擎的樣子） ----
const LOOK_SKIP = new Set(['name', 'gender', 'pronoun', 'age', 'looks', 'background', 'privates', 'privatesNote'])
/** 私處還沒有正式欄位：先放在 look 的 private（選的）與 privateNote（補充）兩個鍵，受內容篩選控制。 */
const draft = computed(() => {
  const look: Record<string, string> = {}
  for (const [k, v] of Object.entries(basic)) if (!LOOK_SKIP.has(k)) look[k] = v
  if (st.s.filterIntimateBody) { look.private = String(basic.privates ?? ''); look.privateNote = String(basic.privatesNote ?? '').trim() }
  return {
    name: basic.name, gender: GENDER_ID[basic.gender] ?? basic.gender, pronoun: basic.pronoun, age: basic.age, look, lookNote: basic.looks, background: basic.background,
    origin: originId.value, originChoice: { favor: favor.value },
    attrPick: { ...attrs }, attrBonus: { ...attrBonus }, skills: { ...basics }, perks: [...picks.perks],
  }
})
const BLOCK_STEP = { basics: 1, origin: 2, attrs: 3, skills: 4, perks: 7 } as const

// ---- 每一步擋住「下一步」的原因 ----
const engineBlocks = computed(() => e.creation.blocks(draft.value))
const blockOf = (s: keyof typeof BLOCK_STEP) => engineBlocks.value.find(b => b.step === s)?.reason ?? null
const block = computed<string | null>(() => {
  switch (step.value) {
    case 1: return blockOf('basics')
    case 2: return blockOf('origin')
    case 3: return blockOf('attrs')
    case 4: return blockOf('skills')
    case 6: return cyberBlock(picks.cyber)
    case 7: return blockOf('perks')
    case 8: return xpLeft.value < 0 ? '歷練點超過了。' : null
    case 9: return gr.value.left < 0 ? '裝備點數超過了。' : null
    default: return null
  }
})
const firstBlocked = computed(() => {
  const list: Array<[number, string]> = engineBlocks.value.map(b => [stepOf(BLOCK_STEP[b.step]), b.reason])
  const cb = cyberBlock(picks.cyber)
  if (cb) list.push([stepOf(6), cb])
  list.sort((x, y) => x[0] - y[0])
  return list[0] ?? null
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

/** 開始：引擎開新局並建角（規則都在引擎）；成功之後把引擎還沒有的假資料照原本的方式寫進 useGame。存檔格不受影響。 */
function start() {
  if (firstBlocked.value) { stepIdx.value = firstBlocked.value[0]; ui.toast(firstBlocked.value[1]!, 'warn'); return }
  e.newGame({ seed: Date.now() % 2147483647, rules: rulesFromUi(st.s) })
  const blocked = e.createCharacter(draft.value)
  if (blocked.length) { stepIdx.value = stepOf(BLOCK_STEP[blocked[0].step]); ui.toast(blocked[0].reason, 'warn'); e.creation.previewRules(rulesFromUi(st.s)); return }
  g.character.name = basic.name.trim()
  g.character.privates = st.s.filterIntimateBody ? { look: String(basic.privates ?? ''), note: String(basic.privatesNote ?? '').trim() } : undefined
  g.character.origin = `${origin.value.name}出身`
  g.character.attrs = eAttrs.map(a => ({ name: a.name, base: totals.value[a.id as AttrId], eff: totals.value[a.id as AttrId] }))
  const perkOf = (id: string) => ePerks.find(p => p.id === id)!
  g.character.traits = { good: [origin.value.trait.name, ...picks.perks.map(perkOf).filter(t => !t.flaw).map(t => t.name)], bad: picks.perks.map(perkOf).filter(t => t.flaw).map(t => t.name) }
  g.character.xp = xpLeft.value
  const b: Record<string, number> = {}
  for (const sk of eSkills) b[sk.name] = (basics[sk.id] ?? 0) + (eo.value.skill_bonus[sk.id] ?? 0)
  for (const k of Object.keys(g.basics)) g.basics[k] = b[k] ?? 0
  g.learned = [...learned.value]
  g.loadout = []
  g.syncTrees()
  for (const d of picks.gear) g.addItem(d.id)
  g.addLog({ prose: [`${basic.name.trim()}，${basic.age} 歲，${origin.value.line}。故事從${origin.value.home}開始。`], place: origin.value.home })
  ui.toast('角色建好了。')
  router.push('/')
}
const attrMods = computed(() => eAttrs.map(a => `${a.name} ${totals.value[a.id as AttrId]}（${fmtMod(attrMod(totals.value[a.id as AttrId]))}）`))
</script>

<template>
  <div class="ng">
    <StatusBar back title="開新局與建角" />
    <nav class="steps" aria-label="步驟">
      <button v-for="(s, i) in STEPS" :key="String(s.id)" type="button" class="st" :class="{ on: i === stepIdx, done: i < stepIdx }" @click="go(i)">
        <span class="mono">{{ typeof s.id === 'number' ? s.id : i === 0 ? '世' : '篩' }}</span>{{ s.name }}
      </button>
    </nav>
    <div class="body" :class="{ wide: step === 8 }">
      <main class="panel cut pad page">
        <!-- 世界 -->
        <template v-if="step === 'world'">
          <h2>世界</h2>
          <p class="setgrp">世界包<Hint>基本世界本身也是一個世界包；玩家做的世界包疊在上面。匯入走同一套檢查。</Hint></p>
          <div class="grid2">
          <div v-for="p in packs" :key="p.id" class="setrow">
            <span class="nm">{{ p.name }}</span><span class="val">{{ p.sub }}</span>
            <button v-if="!p.locked" type="button" class="switch" role="switch" :aria-label="p.name" :aria-checked="p.on" :class="{ on: p.on }" @click="p.on = !p.on" />
            <span v-else class="df">一定要開</span>
          </div>
          </div>
          <p class="setgrp">快速開始<Hint>每個出身準備兩個預設角色，一個偏戰鬥、一個偏非戰鬥。選了直接填好，最後一頁還能回頭改。</Hint></p>
          <div class="grid2 quick"><button v-for="q in QUICK_STARTS" :key="q.name" type="button" class="lrow" @click="quick(q)"><span class="grow"><b>{{ q.name }}・{{ ORIGINS.find(o => o.id === q.origin)!.name }}・{{ q.role }}</b><small>{{ q.line }}</small></span></button></div>
        </template>

        <!-- 內容篩選 -->
        <template v-else-if="step === 'filter'">
          <h2>內容篩選</h2>
          <div class="lockline"><span class="lk">LOCK</span><b>所有角色皆為成年人。</b><Hint>這一條不能關。建角、匯入與世界編輯器都會擋下低於 18 的年齡。</Hint></div>
          <div class="lockline"><span class="lk">LOCK</span><b>不寫血腥，不寫懷孕。</b><Hint>這是內容的底線，不是篩選的選項，所以沒有開關。</Hint></div>
          <p class="setgrp">題材<Hint>內容篩選排在建角之前，關掉的題材不會出現在建角的選項裡（生命軌跡的性經歷與潛在性癖、特質）。篩選跟著存檔走；開新局時預設是上一次的選擇。</Hint></p>
          <div class="grid2">
          <div v-for="[k, n] in ([['filterRestraint', '拘束'], ['filterDollChip', '人偶晶片的失憶工作'], ['filterPublic', '公開場合'], ['filterContract', '契約'], ['filterIntimateBody', '身體的私密描寫']] as const)" :key="k" class="setrow">
            <span class="nm">{{ n }}</span><span />
            <button type="button" class="switch" role="switch" :aria-label="n" :aria-checked="st.s[k]" :class="{ on: st.s[k] }" @click="st.s[k] = !st.s[k]" />
          </div>
          </div>
        </template>

        <!-- 1 基本資料 -->
        <template v-else-if="step === 1">
          <h2>基本資料</h2>
          <div class="grid2 cards looks">
            <section class="lgrp cut-sm">
              <h4>身分</h4>
              <div class="form">
                <label class="fld wide"><span>名字</span><span class="row"><input v-model="basic.name" class="inp" placeholder="你取的名字"><button type="button" class="btn sm" @click="randomName">隨機</button></span></label>
                <label class="fld"><span>年齡<Hint>只收整數，低於 18 時「下一步」不能按。</Hint></span><input v-model="basic.age" class="inp" inputmode="numeric" aria-describedby="agewarn"></label>
                <label v-for="[k, n] in ([['gender', '性別'], ['pronoun', '稱呼'], ['view', '敘事視角']] as const)" :key="k" class="fld">
                  <span>{{ n }}<Hint v-if="k === 'gender'">決定戰敗事件、成人事件與 NTR 分到哪些版本。現實的身體之後可以靠義體或生技改，內海的化身可以自由變化。</Hint></span>
                  <select v-model="basic[k]" class="inp"><option v-for="o in LOOKS[k]" :key="o">{{ o }}</option></select>
                </label>
              </div>
            </section>
            <section v-for="grp in LOOK_GROUPS" :key="grp.id" class="lgrp cut-sm">
              <h4>{{ grp.name }}<Hint v-if="grp.hint" :text="grp.hint" /></h4>
              <div class="form">
                <label v-for="f in grp.fields.filter(x => !x.adult || st.s.filterIntimateBody)" :key="f.k" class="fld" :class="{ 'is-unavailable': lookOff(f) }" :title="lookOff(f) ? `先選「${grp.fields.find(x => x.k === f.needs!.k)!.name}」` : undefined">
                  <span>{{ f.name }}<Hint v-if="f.hint" :text="f.hint" /></span>
                  <select v-model="basic[f.k]" class="inp" :disabled="lookOff(f)"><option v-for="o in f.opts" :key="o">{{ o }}</option></select>
                </label>
                <label v-if="grp.id === 'detail' && st.s.filterIntimateBody" class="fld wide"><span>私處的補充（選用・成人）<Hint>用自己的話寫，例：左邊大腿內側有一顆痣。所有角色都是成年人。</Hint></span><input v-model="basic.privatesNote" class="inp" placeholder="例：剃得很乾淨，左邊大腿內側有一顆小痣" data-privates-note></label>
              </div>
            </section>
            <section class="lgrp cut-sm derived" data-derived>
              <h4>改造與風格<Hint>這三樣不在這裡選，由你身上真的有的東西推出來（NPC_SYSTEM 13.11 節的模板）：外露的義體看第 6 步裝的義體與牌子，獸化看第 6 步裝的獸耳與尾巴（系也在那裡選），風格看第 9 步的穿著（加上出身白給的那一套日常服裝）。要改，回那兩步改。</Hint></h4>
              <div class="dl"><span class="k">外露的義體</span>
                <p v-for="(t, i) in derived.cyber" :key="i">{{ t }}</p><p v-if="!derived.cyber.length" class="empty-note">看不出來：沒有裝看得見的義體。</p></div>
              <div class="dl"><span class="k">獸化</span>
                <p v-for="(t, i) in derived.beast" :key="i">{{ t }}</p><p v-if="!derived.beast.length" class="empty-note">沒有：沒有裝獸耳或尾巴。</p></div>
              <div class="dl"><span class="k">風格</span>
                <p><span v-for="[t, n] in derived.style.tags" :key="t" class="tag" :class="{ hot: t === derived.style.main }">{{ t }} {{ n }}</span></p><p>{{ derived.style.line }}</p></div>
              <div class="go left"><button type="button" class="btn sm" @click="go(stepOf(6))">改義體與獸化（第 6 步）</button><button type="button" class="btn sm" @click="go(stepOf(9))">改穿著（第 9 步）</button></div>
            </section>
          </div>
          <div class="go left"><button type="button" class="btn sm" @click="randomLooks">外觀全部隨機</button></div>
          <div class="form mt">
            <label class="fld wide"><span>外觀補充（選用）</span><input v-model="basic.looks" class="inp" placeholder="例：左耳的顏色和右耳不一樣"></label>
            <label class="fld wide"><span>背景（選用）<Hint>寫進給 AI 的角色資料裡。</Hint></span><textarea v-model="basic.background" class="inp" rows="3" /></label>
          </div>
          <div v-if="ageBlock(basic.age)" id="agewarn" class="blocking">{{ ageBlock(basic.age) }}</div>
        </template>

        <!-- 2 出身 -->
        <template v-else-if="step === 2">
          <h2>出身</h2>
          <label class="fld"><span>出身</span><select :value="originId" class="inp" @change="pickOrigin(($event.target as HTMLSelectElement).value)"><option v-for="o in eOrigins" :key="o.id" :value="o.id">{{ o.name }}・{{ o.line }}</option></select></label>
          <div class="cols2 mt">
            <div>
              <div class="kv"><span>基本功 +1</span><b>{{ skillName(originSkillId) }}</b></div>
              <div class="kv"><span>出身特質</span><b>{{ origin.trait.name }}・{{ origin.trait.effect }}</b></div>
              <div class="kv"><span>起始身分</span><b>{{ origin.status }}</b></div>
              <div class="kv"><span>起始住處</span><b>{{ origin.home }}</b></div>
              <div class="kv"><span>開場就在名冊上</span><b>{{ origin.partner }}</b></div>
            </div>
            <div>
              <label v-if="origin.id === 'corp'" class="fld"><span>原本那家企業<Hint>選的那一家決定好感給誰、買得到哪一家的橋。企業出身不帶債。</Hint></span><select v-model="corp" class="inp" @change="favor = corp"><option v-for="c in eo.favor.choose_one" :key="c">{{ c }}</option></select></label>
              <label v-else class="fld"><span>好感 25 的勢力<template v-if="origin.favor.length > 1">（選一）</template></span><select v-model="favor" class="inp"><option v-for="f in origin.favor" :key="f">{{ f }}</option></select></label>
              <p v-if="origin.extra" class="empty-note mt">{{ origin.extra }}</p>
            </div>
          </div>
        </template>

        <!-- 3 屬性 -->
        <template v-else-if="step === 3">
          <h2>屬性</h2>
          <p class="setgrp">把 {{ lim.attrArray.join('、') }} 分到六項，再加 {{ lim.attrFree }} 點<Hint>每項一個下拉，選過的數字從其他下拉消失。分完以後用 ± 調：加一點花一點自由點數（單項最高 {{ lim.attrMax }}）；也可以把任何一項往下壓，最低 {{ lim.attrMin }}（調整值 {{ fmtMod(attrMod(lim.attrMin)) }}），每壓一點多一點自由點數拿去加別的。調整值是（屬性 − 10）÷ 2，無條件捨去。屬性之後不能用歷練點升。</Hint></p>
          <div class="attrs">
            <div v-for="at in eAttrs" :key="at.id" class="at cut-sm" :class="{ neg: attrs[at.id as AttrId] !== undefined && attrMod(totals[at.id as AttrId]) < 0 }">
              <span class="an">{{ at.name }}</span>
              <select :value="attrs[at.id as AttrId] ?? ''" class="inp" :aria-label="at.name" @change="setAttr(at.id as AttrId, ($event.target as HTMLSelectElement).value)">
                <option value="">—</option><option v-for="v in freeValues(at.id as AttrId)" :key="v" :value="v">{{ v }}</option>
              </select>
              <span class="stepper">
                <button type="button" :aria-label="`${at.name}減一`" v-bind="unavailable(attrStepBlock(at.id as AttrId, -1))" @click="bump(at.id as AttrId, -1)">−</button>
                <b :class="{ 'warn-t': (attrBonus[at.id as AttrId] ?? 0) < 0 }">{{ fmtMod(attrBonus[at.id as AttrId] ?? 0) }}</b>
                <button type="button" :aria-label="`${at.name}加一`" v-bind="unavailable(attrStepBlock(at.id as AttrId, 1))" @click="bump(at.id as AttrId, 1)">＋</button>
              </span>
              <span class="tot mono">{{ attrs[at.id as AttrId] !== undefined ? totals[at.id as AttrId] : '—' }}<small v-if="attrs[at.id as AttrId] !== undefined" class="mod" :class="{ neg: attrMod(totals[at.id as AttrId]) < 0 }">{{ fmtMod(attrMod(totals[at.id as AttrId])) }}</small></span>
            </div>
          </div>
          <div class="kv"><span>自由點數<Hint>基本 {{ lim.attrFree }} 點，加上壓下去的 {{ budget.lowered }} 點。</Hint></span><b>剩 {{ freeLeft }}／{{ budget.total }}</b></div>
          <div v-if="block" class="blocking">{{ block }}</div>
        </template>

        <!-- 4 基本功 -->
        <template v-else-if="step === 4">
          <h2>基本功・剩 {{ bLeft }}／{{ lim.skillPoints }} 點</h2>
          <p class="setgrp">單項最高 {{ lim.skillMax }} 級<Hint>一點一級；出身另外給一項 +1（可以到 {{ lim.skillMax + 1 }}）。這兩個數字在設定裡可以調。</Hint></p>
          <div class="basics">
            <div v-for="b in eSkills" :key="b.id" class="brow">
              <span class="bn">{{ b.name }}<small>{{ attrName(b.attr) }}</small></span>
              <span class="pips"><i v-for="n in 4" :key="n" :class="{ on: n <= (basics[b.id] ?? 0), bonus: originSkillId === b.id && n === (basics[b.id] ?? 0) + 1 }" /></span>
              <span class="stepper"><button type="button" :aria-label="`${b.name}減一`" :aria-disabled="!basics[b.id] || undefined" @click="basicStep(b.id, -1)">−</button><b>{{ (basics[b.id] ?? 0) + (originSkillId === b.id ? 1 : 0) }}</b><button type="button" :aria-label="`${b.name}加一`" :aria-disabled="!!basicStepBlock(b.id, 1) || undefined" @click="basicStep(b.id, 1)">＋</button></span>
            </div>
          </div>
        </template>

        <!-- 5 生命軌跡 -->
        <template v-else-if="step === 5">
          <h2>生命軌跡</h2>
          <p class="setgrp">每一張可以擲、可以選、可以跳過<Hint>結果會變成遊戲裡的東西：一位 NPC、一個勢力的好感或敵對值、一筆錢或債、一個旗標、一個缺陷、一個個人目標。性經歷與潛在性癖兩張表照內容篩選過濾；所有相關的人物都是成年人。</Hint></p>
          <p class="origin-note">出身：<b>{{ origin.name }}</b>・{{ origin.line }}。每張表的說法照出身寫；結果的種類一樣。</p>
          <div class="grid2 cards">
            <div v-for="t in lifeTables" :key="t.id" class="life cut-sm">
              <div class="lh"><h4>{{ t.name }}</h4><button type="button" class="btn sm" @click="roll(t.id)">擲</button></div>
              <p class="flavor">{{ lifeFlavor(t.id) }}</p>
              <select v-model="life[t.id]" class="inp" :aria-label="t.name"><option value="">跳過</option><option v-for="o in lifeOptions(t.id)" :key="o.id" :value="o.id">{{ o.text }}</option></select>
              <small v-if="life[t.id]" class="res">→ {{ lifeOptions(t.id).find(o => o.id === life[t.id])?.result }}</small>
            </div>
          </div>
        </template>

        <!-- 6 橋與義體 -->
        <template v-else-if="step === 6">
          <h2>橋與義體・剩 {{ cy.left }}／{{ CYBER_POINTS }} 點</h2>
          <p class="setgrp">橋・選一座<Hint>橋決定四類技能的容量（現實／內海／社交／媒體）。企業出身才選得到那家企業的橋。</Hint></p>
          <div class="grid2">
          <button v-for="o in CYBER_OPTIONS.filter(x => x.kind === 'bridge')" :key="o.id" type="button" class="lrow pick" :class="{ on: picks.cyber.some(c => c.id === o.id), 'is-unavailable': !!cyberPickBlock(picks.cyber, o, { id: originId, corp }) && !picks.cyber.some(c => c.id === o.id) }" :title="(!picks.cyber.some(c => c.id === o.id) && cyberPickBlock(picks.cyber, o, { id: originId, corp })) || undefined" @click="toggleCyber(o)">
            <span class="grow"><b>{{ o.name }}</b><small>{{ o.brand }}・{{ ['', 'I', 'II'][o.grade] }}・{{ o.cap!.join('／') }}・沉溺成本 {{ o.sink }}</small><small v-if="cyberPickBlock(picks.cyber, o, { id: originId, corp }) && !picks.cyber.some(c => c.id === o.id)" class="why">{{ cyberPickBlock(picks.cyber, o, { id: originId, corp }) }}</small></span>
            <Hint :text="o.note" /><b class="pt mono">{{ o.points }}</b>
          </button>
          </div>
          <p class="setgrp">其他義體<Hint>每一件照常算沉溺的下限：開場改得越多，沉溺的起點越高。</Hint></p>
          <div class="grid2">
          <button v-for="o in CYBER_OPTIONS.filter(x => x.kind !== 'bridge')" :key="o.id" type="button" class="lrow pick" :class="{ on: picks.cyber.some(c => c.id === o.id) }" v-bind="unavailable(!picks.cyber.some(c => c.id === o.id) && cyberPickBlock(picks.cyber, o, { id: originId, corp }))" @click="toggleCyber(o)">
            <span class="grow"><b>{{ o.name }}</b><small>{{ o.part }}・{{ o.kind === 'light' ? '輕度' : '侵入' }}・沉溺成本 {{ o.sink }}</small><small v-if="!picks.cyber.some(c => c.id === o.id) && cyberPickBlock(picks.cyber, o, { id: originId, corp })" class="why">{{ cyberPickBlock(picks.cyber, o, { id: originId, corp }) }}</small></span>
            <Hint :text="o.note" /><b class="pt mono">{{ o.points }}</b>
          </button>
          </div>
          <label v-if="hasBeast" class="fld beastline"><span>獸化的系<Hint>機械派的系看外形與韌體，生體派的系看基因譜（CULTURE 第 2 節）。寫進外觀，也決定耳朵在什麼情緒下怎麼動。</Hint></span><select v-model="beastLine" class="inp"><option v-for="(_, k) in BEAST_LINES" :key="k" :value="k">{{ k }}</option></select></label>
          <div v-if="block" class="blocking">{{ block }}</div>
        </template>

        <!-- 7 特質 -->
        <template v-else-if="step === 7">
          <h2>特質與缺陷・剩 {{ tr.left }} 點</h2>
          <p class="setgrp">起始 {{ lim.perkPoints }} 點，另送出身特質「{{ origin.trait.name }}」<Hint>每個特質 1～3 點：一格（例如一項基本功 +2）是 2 點；最多 {{ lim.flawMax }} 個缺陷，每個退 1～3 點；特質總數上限 {{ lim.perkMax }} 個（不含出身特質與缺陷）。特質不佔橋的容量。</Hint></p>
          <div class="grid2 traits">
            <button v-for="t in perkList" :key="t.id" type="button" class="lrow pick" :class="{ on: picks.perks.includes(t.id), flaw: t.flaw }" v-bind="unavailable(perkAddBlock(t.id))" @click="togglePerk(t.id)">
              <span class="grow"><b>{{ t.name }}</b><small>{{ PERK_CATEGORY_NAME[t.category] ?? t.category }}・{{ t.desc }}</small></span><b class="pt mono">{{ t.flaw ? '+' : '−' }}{{ t.cost }}</b>
            </button>
          </div>
          <div class="go"><button type="button" class="btn sm" v-bind="unavailable('自訂特質要引擎先有這種資料，這一版還不能用。')">自訂</button></div>
          <div v-if="block" class="blocking">{{ block }}</div>
        </template>

        <!-- 8 技能 -->
        <template v-else-if="step === 8">
          <h2>技能・剩 {{ xpLeft }}／{{ XP_START }} 歷練點</h2>
          <p class="setgrp">在技能樹上花<Hint>和遊戲裡的技能樹是同一個畫面：學一個技能花「階 × 20」，算進那棵樹的累計；累計到 {{ TIER_THRESHOLDS[1] }} 開 2 階、{{ TIER_THRESHOLDS[2] }} 開 3 階。起始的 {{ XP_START }} 點大約能把一棵樹開到 3 階。建角時學了可以退（選中再按「退掉」）；沒花完的留著。灰掉的是現在學不了的，點開看原因。</Hint></p>
          <SkillTreeView :learned="learned" :xp="xpLeft" creation @learn="learnS" @forget="forget" />
        </template>

        <!-- 9 錢與裝備 -->
        <template v-else-if="step === 9">
          <h2>錢與裝備・剩 {{ gr.left }}／{{ GEAR_POINTS }} 點</h2>
          <p class="setgrp">只能買 I～II 級<Hint>一件的點數＝目錄價 ÷ 250，無條件進位，最少 1 點。不能買義體（義體走上一步的點數）、藥、成人道具。另外白給一套出身那一區的日常服裝、一支板子、兩個彈匣的普通彈藥、預設化身的 SKIN。</Hint></p>
          <div class="go left"><button type="button" class="btn sm pri" @click="suggest">出身的建議組合</button></div>
          <div class="gearl">
            <div>
              <template v-for="c in GEAR_CATALOG" :key="c.cat">
                <p class="h">{{ c.cat }}</p>
                <div class="ggrid">
                  <div v-for="id in c.ids" :key="id" class="gi">
                    <ItemSlot :item="ITEMS[id]" size="sm" show-name :unavailable="gearAddBlock(picks.gear, ITEMS[id])" @select="addGear(ITEMS[id])" />
                    <small class="mono">{{ gearPoints(ITEMS[id]) }} 點</small>
                  </div>
                </div>
              </template>
            </div>
            <div class="panel cut pad chosen">
              <p class="h">已選</p>
              <div v-if="!picks.gear.length" class="empty-note">還沒選。點左邊的物品加進來。</div>
              <div v-for="(d, i) in picks.gear" :key="i" class="lrow"><ItemSlot :item="d" size="sm" /><span class="grow"><b :style="{ color: `var(--g${d.grade})` }">{{ d.name }}</b><small>{{ gearPoints(d) }} 點</small></span><button type="button" class="btn sm ghost" :aria-label="`拿掉${d.name}`" @click="removeGear(i)">✕</button></div>
              <div class="kv"><span>起始的錢</span><b><MoneyTag kind="cash" :amount="money" /></b></div>
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
              <div class="kv"><span>屬性</span><b>{{ eAttrs.map(a => totals[a.id as AttrId]).join('・') }}</b></div>
              <div class="kv"><span>橋</span><b>{{ cy.bridge?.name ?? '沒有' }}</b></div>
              <div class="kv"><span>沉溺的下限</span><b>{{ cy.sinkFloor }}</b></div>
            </div>
            <div>
              <div class="kv"><span>特質</span><b>{{ [origin.trait.name, ...picks.perks.map(id => ePerks.find(p => p.id === id)?.name)].join('、') }}</b></div>
              <div class="kv"><span>技能</span><b>{{ learned.length }} 個・剩 {{ xpLeft }} 歷練點</b></div>
              <div class="kv"><span>裝備</span><b>{{ picks.gear.length }} 件</b></div>
              <div class="kv"><span>起始的錢</span><b><MoneyTag kind="cash" :amount="money" /></b></div>
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
        <div class="kv"><span>屬性</span><b class="mono">{{ eAttrs.map(a => totals[a.id as AttrId] || '—').join('・') }}</b></div>
        <div class="kv"><span>基本功</span><b>剩 {{ bLeft }} 點</b></div>
        <div class="kv"><span>橋</span><b>{{ cy.bridge?.name ?? '沒有' }}</b></div>
        <div class="kv"><span>義體點數</span><b>剩 {{ cy.left }}</b></div>
        <div class="kv"><span>沉溺的下限</span><b>{{ cy.sinkFloor }}</b></div>
        <div class="kv"><span>特質點</span><b>剩 {{ tr.left }}</b></div>
        <div class="kv"><span>歷練點</span><b>剩 {{ xpLeft }}</b></div>
        <div class="kv"><span>裝備點數</span><b>剩 {{ gr.left }}</b></div>
        <div class="kv"><span>起始的錢（現金）</span><b>{{ money }}</b></div>
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
.st { flex: none; display: flex; gap: 6px; align-items: center; font-size: var(--fs-sm); font-weight: 800; padding: 6px 10px; background: var(--bg-2); color: var(--ink-3); border: 0; cursor: pointer; }
.st .mono { width: 18px; height: 18px; border-radius: 50%; background: var(--bg-term); display: grid; place-items: center; font-size: var(--fs-tiny); }
.st.done { color: var(--ink-2); }
.st.done .mono { background: var(--b); color: #17111F; }
.st.on { background: var(--a); color: #fff; }
.body { flex: 1; display: grid; grid-template-columns: minmax(0, 1fr) 280px; gap: 12px; padding: 12px; align-items: start; max-width: 1360px; width: 100%; margin: 0 auto; }
.page h2 { margin: 0 0 12px; font-size: var(--fs-page); }
.nav { position: sticky; bottom: 0; display: flex; gap: 10px; align-items: center; padding: 10px 16px; background: var(--bg-term); border-top: 2px solid var(--line); z-index: 5; }
.grow { flex: 1; min-width: 0; }
.nav .grow { text-align: center; color: var(--ink-3); font-size: var(--fs-sm); }
.form { display: grid; grid-template-columns: repeat(auto-fill, minmax(200px, 1fr)); gap: 10px; }
.fld { display: grid; gap: 4px; font-size: var(--fs-sm); font-weight: 800; color: var(--ink-2); min-width: 0; }
.fld > span:first-child { display: inline-flex; gap: 4px; align-items: center; }
.fld.wide { grid-column: 1 / -1; }
.row { display: flex; gap: 6px; }
.inp { width: 100%; min-width: 0; background: var(--bg-term); color: var(--ink); border: 0; box-shadow: inset 0 0 0 2px var(--line); padding: 8px 10px; font: 600 var(--fs-md) var(--font); }
.inp:focus { box-shadow: inset 0 0 0 2px var(--a); outline: none; }
.mt { margin-top: 12px; }
.quick small, .pick small, .sks small, .chosen small { display: block; color: var(--ink-3); font-size: var(--fs-fine); }
.attrs { display: grid; grid-template-columns: repeat(auto-fill, minmax(min(100%, 200px), 1fr)); gap: var(--space-4); margin-bottom: var(--space-4); }
.at { display: grid; grid-template-columns: 1fr auto; gap: var(--space-3); padding: var(--space-4); background: var(--bg-2); align-items: center; }
.at .an { grid-column: 1 / -1; font-size: var(--fs-card); font-weight: var(--fw-title); }
.at.neg { box-shadow: inset 3px 0 0 var(--warn); }
.at .mod { margin-left: var(--space-3); font-size: var(--fs-lg); color: var(--ok); }
.at .mod.neg { color: var(--warn); }
.at .stepper b { min-width: 40px; }
.at .tot { grid-column: 1 / -1; font-size: var(--fs-num); font-weight: 900; line-height: 1.1; }
.basics { display: grid; grid-template-columns: repeat(auto-fill, minmax(230px, 1fr)); gap: 6px 16px; }
.brow { display: grid; grid-template-columns: minmax(0, 1fr) auto auto; gap: 8px; align-items: center; padding: 5px 8px; background: var(--bg-2); }
.bn { font-weight: 800; font-size: var(--fs-ui); }
.bn small { color: var(--ink-3); font-size: var(--fs-tiny); margin-left: 4px; }
.pips { display: flex; gap: 2px; }
.pips i { width: 12px; height: 10px; border-radius: 2px; background: var(--bg-term); }
.pips i.on { background: var(--a); }
.pips i.bonus { background: var(--ram); }
.res { grid-column: 1 / -1; color: var(--ram); font-size: var(--fs-fine); }
.setrow .inp.wide { grid-column: auto; }
.pick { margin-bottom: 4px; }
.pick .why { color: var(--warn); }
.looks { --col-min: 360px; }
.derived .dl { display: grid; gap: var(--space-2); }
.derived .dl p { margin: 0; line-height: 1.6; }
.derived .tag { margin-right: 4px; }
.beastline { max-width: 320px; margin: var(--space-4) 0; }
.lgrp { background: var(--bg-2); padding: var(--space-4) var(--space-5) var(--space-5); display: grid; gap: var(--space-4); align-content: start; }
.lgrp h4 { margin: 0; display: flex; gap: var(--space-2); align-items: center; }
.lgrp .form { grid-template-columns: repeat(auto-fill, minmax(min(100%, 150px), 1fr)); gap: var(--space-4); }
.origin-note { margin: 0 0 var(--space-4); color: var(--ink-2); }
.life { background: var(--bg-2); padding: var(--space-4); display: grid; gap: var(--space-3); align-content: start; }
.lh { display: flex; justify-content: space-between; align-items: center; gap: var(--space-3); }
.lh h4 { margin: 0; }
.flavor { margin: 0; color: var(--ink-3); font-size: var(--fs-sm); line-height: 1.6; }
.life .res { font-size: var(--fs-sm); font-weight: 700; }
.pick.flaw b:first-child { color: var(--warn); }
.pt { font-size: var(--fs-md); color: var(--ap); min-width: 26px; text-align: right; }
.custom { margin-top: 8px; display: grid; gap: 8px; }
.go.left { justify-content: flex-start; margin: 0 0 8px; }
.body.wide { grid-template-columns: minmax(0, 1fr); max-width: 1600px; }
.body.wide .sum { display: none; }
.gearl { display: grid; grid-template-columns: minmax(0, 1fr) 280px; gap: 12px; align-items: start; }
.ggrid { display: grid; grid-template-columns: repeat(auto-fill, minmax(70px, 1fr)); gap: 8px; margin-bottom: 10px; }
.gi { display: grid; gap: 2px; justify-items: center; }
.gi small { font-size: var(--fs-tiny); color: var(--ap); }
.chosen .lrow :deep(.slot) { width: 36px; flex: none; }
.warnb { margin-top: 8px; box-shadow: inset 3px 0 0 var(--warn); }
@media (max-width: 1000px) { .body { grid-template-columns: minmax(0, 1fr); } .sum { order: 2; } .gearl { grid-template-columns: 1fr; } }
@media (max-width: 720px) { .body { padding: 8px; } .sum { display: none; } }
</style>
