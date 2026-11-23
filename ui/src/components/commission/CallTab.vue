<script setup lang="ts">
import { computed, ref } from 'vue'
import { AUX_FACES, AUX_FACE_NAME, HIRE_NAME, WALLET_NAME } from '@engine/src/features/fixer'
import type { AuxFace, HireOption } from '@engine/src/features/fixer'
import Hint from '../Hint.vue'
import MoneyTag from '../MoneyTag.vue'
import ReasonButton from '../ReasonButton.vue'
import { useEngine } from '../../stores/engine'
import { useUi } from '../../stores/ui'
import { FACE_CLASS, FACE_ICON, loadoutLabels } from '../../lib/commissionView'
import type { FaceId } from '../../lib/commissionView'

/**
 * 召集（UI 7.3）：隊伍與同行（名冊的 muster）、這一趟裝的技能（讀引擎裝著的）、分帳（引擎的 splitPreview）、輔助面派誰與四種請人的辦法、出發。
 * 加不進去的原因、請不了的原因、成功率、分帳的每一段數字都是引擎給的；這裡只畫，呼叫 muster、hire、unhire、go。
 */
const props = defineProps<{ jobId: string }>()
const emit = defineEmits<{ (e: 'went'): void }>()
const e = useEngine()
const ui = useUi()

const job = computed(() => e.fixer.job(props.jobId))
const roster = computed(() => e.fixer.roster())
const party = computed(() => e.fixer.party())
const pcId = computed(() => e.state.pc)
const others = computed(() => party.value.filter(id => id !== pcId.value))
const tagalong = computed(() => roster.value.tagalong)
const nameOf = (id: string): string => e.fixer.actorName(id)
const working = ref(false)

// ---- 隊伍與同行 ----
const addReason = (id: string, as: 'party' | 'tagalong'): string | null => {
  const nextParty = as === 'party' ? [...others.value, id] : others.value.filter(x => x !== id)
  const nextTag = as === 'tagalong' ? [...tagalong.value.filter(x => x !== id), id] : tagalong.value.filter(x => x !== id)
  const blocks = e.fixer.musterBlocks(nextParty, nextTag)
  return blocks.length ? blocks.join('') : e.blockOf('commit:roster.muster')
}
async function setCrew(party2: string[], tag2: string[]) {
  if (working.value) return
  working.value = true
  const r = await e.fixer.muster(party2, tag2)
  working.value = false
  if (r.status === 'refused') ui.toast(r.reason ?? '召集不成立。', 'warn')
}
const addToParty = (id: string) => setCrew([...others.value, id], tagalong.value.filter(x => x !== id))
const removeFromParty = (id: string) => setCrew(others.value.filter(x => x !== id), tagalong.value)
const addTagalong = (id: string) => setCrew(others.value.filter(x => x !== id), [...tagalong.value, id])
const removeTagalong = (id: string) => setCrew(others.value, tagalong.value.filter(x => x !== id))
const members = computed(() => roster.value.members)
const free = computed(() => members.value.filter(m => !party.value.includes(m.id) && !tagalong.value.includes(m.id)))
const slots = computed(() => Math.max(0, 4 - party.value.length))

// ---- 技能配置 ----
const labels = computed(() => loadoutLabels(e.skills.mine().equipped, e.skills.abilities()))

// ---- 分帳 ----
const split = computed(() => e.fixer.split(props.jobId))
const SEG_NAME: Record<string, string> = { cut: '中間人抽成', fee: '出場費', share: '分紅', boss: '你' }
const segTotal = computed(() => Math.max(1, (split.value?.segments ?? []).reduce((s, x) => s + Math.max(0, x.amount), 0)))

// ---- 輔助面 ----
const faceOpen = (f: AuxFace): boolean => !!job.value?.commission.stages.some(s => (s.faces as Record<string, unknown>)[f])
const aux = (f: AuxFace) => job.value?.aux[f] ?? []
const picked = ref<Partial<Record<AuxFace, string>>>({})
const candidates = computed(() => members.value.filter(m => !party.value.includes(m.id)))
const chanceOf = (f: AuxFace) => {
  const list = aux(f)
  return list.length ? e.fixer.auxChance(props.jobId, f, list.map(x => x.actor), list.filter(x => x.way === 'borrow').map(x => x.actor)) : null
}
const optionsFor = (f: AuxFace): HireOption[] => (picked.value[f] ? e.fixer.hireOptions(props.jobId, f, picked.value[f]!) : [])
const borrow = (f: AuxFace) => e.fixer.borrowOption(props.jobId, f)
async function hire(f: AuxFace, way: HireOption['way']) {
  if (working.value) return
  working.value = true
  const r = await e.fixer.hire(props.jobId, way === 'borrow' ? { face: f, way } : { face: f, way, actor: picked.value[f]! })
  working.value = false
  if (r.status === 'refused') ui.toast(r.reason ?? '請不到。', 'warn')
  else picked.value = { ...picked.value, [f]: '' }
}
async function unhire(actor: string) {
  const r = await e.fixer.unhire(props.jobId, actor)
  if (r.status === 'refused') ui.toast(r.reason ?? '退不掉。', 'warn')
}

// ---- 出發 ----
const goReason = computed(() => e.fixer.goBlock(props.jobId))
const where = computed(() => e.contentName('district', String(job.value?.commission.district ?? '')) ?? '')
async function go() {
  if (working.value) return
  working.value = true
  const r = await e.fixer.go(props.jobId)
  working.value = false
  if (r.status === 'refused') { ui.toast(r.reason ?? '出發不了。', 'warn'); return }
  emit('went')
}
</script>

<template>
  <div class="cols3" data-call-tab>
    <section class="panel cut pad stack">
      <p class="h">隊伍・跟著你玩的那一面走（最多 4 人含你）<Hint>名冊上的行者可以進隊伍；不打仗的人只能同行（最多 2 位）。加不進去時按鈕會寫引擎的原因。</Hint></p>
      <div class="grid2" style="--col-min: 150px" data-party>
        <div v-for="id in party" :key="id" class="crew" :data-party-member="id"><b>{{ nameOf(id) }}</b><small>{{ id === pcId ? '你' : '隊伍' }}</small><button v-if="id !== pcId" type="button" class="btn sm ghost" @click="removeFromParty(id)">移除</button></div>
        <div v-for="n in slots" :key="'e' + n" class="crew empty">空格</div>
      </div>
      <p class="h">名冊（{{ roster.size }}／{{ roster.cap }}）</p>
      <div v-if="!free.length" class="empty-note">名冊上沒有別的人可以加了。</div>
      <div v-for="m in free" :key="m.id" class="crew row" :data-roster="m.id">
        <span class="grow"><b>{{ m.name }}</b><small>主職 {{ m.main_tier }} 階・忠誠 {{ m.loyalty }}・{{ m.pay === 'fee' ? `出場費 ${m.fee}` : '分紅' }}</small><small v-if="m.busy.length" class="warn-t">{{ m.busy.join('') }}</small></span>
        <ReasonButton sm :reason="m.busy.length ? m.busy.join('') : addReason(m.id, 'party')" data-add-party @go="addToParty(m.id)">進隊伍</ReasonButton>
        <ReasonButton sm :reason="addReason(m.id, 'tagalong')" @go="addTagalong(m.id)">同行</ReasonButton>
      </div>
      <p class="h">同行（{{ tagalong.length }}／2）</p>
      <div class="chips"><span v-for="id in tagalong" :key="id" class="tag">{{ nameOf(id) }}<button type="button" class="x" aria-label="移除同行" @click="removeTagalong(id)">×</button></span><span v-if="!tagalong.length" class="empty-note">沒有人同行。</span></div>
      <p class="h">技能配置・進去之後不能換</p>
      <div class="chips" data-loadout><span v-for="n in labels" :key="n" class="tag">{{ n }}</span><span v-if="!labels.length" class="empty-note">沒有裝技能。</span></div>
      <div class="go left"><button type="button" class="btn sm" @click="ui.openRoot('character', { tab: 'bridge' })">回據點換配置</button></div>
    </section>

    <section class="panel cut pad stack">
      <p class="h">分帳<Hint>每一段前面標出用哪種錢付。用人情或付過錢請來的人列在條外，不佔比例。數字是引擎的分帳預覽（評價照 B 估）。</Hint></p>
      <template v-if="split">
        <div class="split" data-split>
          <span v-for="(s, i) in split.segments" :key="i" :class="['c' + ((i % 4) + 1)]" :style="{ flex: Math.max(1, s.amount) / segTotal }" :title="`${SEG_NAME[s.kind] ?? s.kind}：${s.name}`" data-segment>{{ s.name }}</span>
        </div>
        <div v-for="(s, i) in split.segments" :key="'r' + i" class="kv" data-seg-row><span>{{ SEG_NAME[s.kind] ?? s.kind }}・{{ s.name }}（{{ WALLET_NAME[s.wallet] }}）</span><b data-seg-amount>{{ s.amount }}<template v-if="s.shares"> ・{{ s.shares }} 份</template></b></div>
        <div v-for="o in split.outside" :key="o.who" class="kv"><span>條外・{{ o.name }}</span><b>{{ HIRE_NAME[o.way] }}{{ o.prepaid ? `（預付 ${o.prepaid}）` : '' }}</b></div>
        <p v-for="(l, i) in split.lines" :key="i" class="t-fine" data-split-line>{{ l }}</p>
        <div class="kv"><span>你實拿</span><b data-pc-net><MoneyTag :kind="split.wallet === 'cred' ? 'acc' : 'cash'" :amount="split.pc_net" :size="13" /></b></div>
      </template>
      <div class="go">
        <ReasonButton pri :reason="goReason" data-go @go="go">出發</ReasonButton>
      </div>
      <p class="t-fine">委託地點：{{ where || '？' }}。進去之後城裡的事全部暫停；撤退會回到現在。</p>
    </section>

    <aside class="stack">
      <section v-for="f in AUX_FACES" :key="f" class="panel cut pad" :class="{ off: !faceOpen(f) }" :data-aux-face="f">
        <p class="h"><span class="fc" :class="FACE_CLASS[f as FaceId]">{{ FACE_ICON[f as FaceId] }}</span>輔助・{{ AUX_FACE_NAME[f] }}</p>
        <div v-for="x in aux(f)" :key="x.actor" class="kv"><span>{{ nameOf(x.actor) }}</span><b>{{ HIRE_NAME[x.way] }} <button type="button" class="btn sm ghost" @click="unhire(x.actor)">退人</button></b></div>
        <p v-if="chanceOf(f)" class="t-fine mono" data-aux-chance>1d20 + {{ chanceOf(f)!.bonus.total }} 對 {{ chanceOf(f)!.dc }}：拿到連動 {{ chanceOf(f)!.chance }}%，出事 {{ chanceOf(f)!.mishap }}%</p>
        <p v-else class="t-fine">這一面沒有人。{{ faceOpen(f) ? '' : '（這件委託沒有開這一面）' }}</p>
        <label class="buy"><span class="k">派誰</span>
          <select :value="picked[f] ?? ''" :data-pick="f" @change="picked = { ...picked, [f]: ($event.target as HTMLSelectElement).value }"><option value="">（選一位）</option><option v-for="m in candidates" :key="m.id" :value="m.id">{{ m.name }}</option></select></label>
        <div class="row-list">
          <ReasonButton v-for="o in optionsFor(f)" :key="o.way" sm :reason="o.block" :data-hire="o.way" @go="hire(f, o.way)">{{ o.name }}・{{ o.chance }}%</ReasonButton>
          <small v-for="o in optionsFor(f)" :key="'c' + o.way" class="t-fine">{{ o.name }}：{{ o.cost }}</small>
        </div>
        <ReasonButton v-if="borrow(f)" sm :reason="borrow(f)!.block" data-borrow @go="hire(f, 'borrow')">向中間人借人</ReasonButton>
        <p v-if="borrow(f)" class="t-fine">{{ borrow(f)!.cost }}</p>
      </section>
    </aside>
  </div>
</template>

<style scoped>
.crew { background: var(--bg-2); padding: var(--space-3); display: grid; gap: 2px; justify-items: start; }
.crew.row { display: flex; align-items: center; gap: var(--space-2); flex-wrap: wrap; justify-items: initial; }
.crew.row .grow { flex: 1; display: grid; min-width: 140px; }
.crew small { color: var(--ink-3); font-size: var(--fs-fine); }
.crew.empty { background: transparent; color: var(--ink-3); outline: 2px dashed var(--line); outline-offset: -6px; min-height: 64px; place-items: center; justify-items: center; }
.split { display: flex; height: 30px; gap: 2px; font-size: var(--fs-fine); font-weight: 800; }
.split span { display: grid; place-items: center; overflow: hidden; white-space: nowrap; color: var(--bg); min-width: 0; }
.c1 { background: var(--ap); } .c2 { background: var(--warn); } .c3 { background: var(--a); color: var(--on-a) !important; } .c4 { background: var(--sink); }
.chips { display: flex; gap: var(--space-2); flex-wrap: wrap; }
.chips .x { margin-left: 6px; background: none; border: 0; color: inherit; cursor: pointer; }
.fc { width: 24px; height: 24px; display: inline-grid; place-items: center; font-weight: 900; font-size: var(--fs-fine); border-radius: 6px; background: var(--bg-3); }
.fc.m { background: var(--ink-2); color: var(--bg); } .fc.n { background: var(--net); color: var(--bg); } .fc.o { background: var(--ep); color: var(--bg); }
.off { opacity: .6; }
.buy { display: flex; gap: var(--space-3); align-items: center; margin: var(--space-2) 0; }
.buy select { font: 800 var(--fs-sm) var(--font); background: var(--bg-term); color: var(--ink); border: 0; padding: 5px; max-width: 100%; }
.go.left { justify-content: flex-start; }
.row-list small { display: block; }
</style>
