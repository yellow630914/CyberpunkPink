<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import type { SurgeonKind } from '@engine/src/features/cyberware'
import Dialog from '../components/Dialog.vue'
import Hint from '../components/Hint.vue'
import Tabs from '../components/Tabs.vue'
import ItemSlot from '../components/ItemSlot.vue'
import MoneyTag from '../components/MoneyTag.vue'
import ReasonButton from '../components/ReasonButton.vue'
import QuoteCard from '../components/body/QuoteCard.vue'
import MedicalPanel from '../components/body/MedicalPanel.vue'
import SinkPanel from '../components/body/SinkPanel.vue'
import TuningPanel from '../components/body/TuningPanel.vue'
import MalwarePanel from '../components/body/MalwarePanel.vue'
import { useEngine } from '../stores/engine'
import { useUi } from '../stores/ui'
import { CATEGORY_NAME } from '../lib/skillView'
import { bridgeRows, crackRows, detoxRows, installRows, modifyRows, pctText, removeRows, repairRows, slotItemOf, spanText, SIDE_NAME, statusText, PART_UI } from '../lib/bodyView'
import type { PartId } from '@engine/src/features/cyberware'

/**
 * 診所（對話框；站在帶 clinic 的設施上才開得了，自己動刀的入口在住處；CYBERWARE 第 2、5 節、dev/adr/0019 第三節）。
 * 分頁：安裝（含換橋）、拆下、換零件、修理與解鎖、治療、戒斷、洗點（技能的歷練點退回來重學；M4-ui-creation）、清除韌體（MalwarePanel，引擎的 malware）、調校與靜室（TuningPanel，引擎的 tuning）。
 * 每一項先顯示引擎的報價（費用、成本、休養、併發症的機率、自己動刀的 DC 與成功率），按確認才送；擋住的原因逐字用引擎的。
 * 元件只編排：誰能動刀、費率、成本、休養、機率都是 stores/engine.ts 的 body（features/cyberware、medical、drugs、sink），這裡不算。
 */
const props = defineProps<{ entryId: number; stacked?: boolean; clinic?: string; black?: boolean; tab?: string; uid?: string; part?: string; pick?: string; via?: string }>()
const eng = useEngine()
const ui = useUi()
const gate = computed(() => eng.body.clinicGate())
// 開不了（不在診所、也不在能自己動刀的住處）：說原因、關掉
onMounted(() => { if (gate.value) { ui.toast(gate.value, 'warn'); ui.close(props.entryId) } })

const TABS = [
  { id: 'install', label: '安裝' }, { id: 'remove', label: '拆下' }, { id: 'modify', label: '換零件' }, { id: 'repair', label: '修理與解鎖' },
  { id: 'care', label: '治療' }, { id: 'detox', label: '戒斷' }, { id: 'respec', label: '洗點' }, { id: 'malware', label: '清除韌體' }, { id: 'tuning', label: '調校' },
]
const tab = ref(TABS.some((t) => t.id === props.tab) ? props.tab! : 'install')
const title = computed(() => props.clinic ?? eng.body.clinic()?.name ?? '住處的診療室')

// ---- 誰動刀 ----
const surgeons = computed(() => eng.body.surgeons())
const via = ref<SurgeonKind | null>((props.via as SurgeonKind | undefined) ?? null)
const current = computed(() => surgeons.value.find((s) => s.id === via.value) ?? surgeons.value.find((s) => s.block === null) ?? surgeons.value[0] ?? null)
const viaId = computed<SurgeonKind>(() => current.value?.id ?? 'clinic')
const skillName = (id: string): string => eng.body.names.skill(id)
const capName = (c: string): string => CATEGORY_NAME[c as keyof typeof CATEGORY_NAME] ?? c

function done(why: string | null, ok: string) {
  if (why) ui.toast(why, 'warn')
  else ui.toast(ok)
}
const surgeonBar = computed(() => surgeons.value)
const noSurgeon = computed(() => (surgeons.value.length === 0 ? '這裡沒有人可以動刀。' : null))

// ---- 安裝（含換橋） ----
const bag = computed(() => eng.body.bag().filter((b) => !props.part || b.slot === props.part || b.slot === 'arm' || b.slot === 'leg' || b.kind === 'bridge'))
const bagAll = computed(() => eng.body.bag())
const pickUid = ref<string | null>(props.pick ?? null)
const picked = computed(() => bagAll.value.find((b) => b.uid === pickUid.value) ?? null)
const side = ref<'l' | 'r'>('l')
const keepOld = ref(true)
const installOpts = computed(() => (picked.value ? { uid: picked.value.uid, via: viaId.value, ...(eng.body.needsSide(picked.value.slot) ? { side: side.value } : {}) } : null))
const installQ = computed(() => (installOpts.value && picked.value?.kind !== 'bridge' ? eng.body.installQuote(installOpts.value) : null))
const bridgeQ = computed(() => (picked.value?.kind === 'bridge' ? eng.body.bridgeQuote({ uid: picked.value.uid, via: viaId.value, keep: keepOld.value }) : null))
const installReason = computed(() => {
  if (!picked.value) return '先從背包選一件義體。'
  if (noSurgeon.value) return noSurgeon.value
  if (picked.value.kind === 'bridge') return eng.body.bridgeBlock({ uid: picked.value.uid, via: viaId.value, keep: keepOld.value })
  return eng.body.installBlock(installOpts.value!)
})
const installTable = computed(() => (bridgeQ.value ? bridgeRows(bridgeQ.value, capName) : installQ.value ? installRows(installQ.value, skillName) : []))
function install() {
  const p = picked.value!
  const why = p.kind === 'bridge' ? eng.body.swapBridge({ uid: p.uid, via: viaId.value, keep: keepOld.value }) : eng.body.install(installOpts.value!)
  done(why, `${p.name}動完手術了。`)
  if (!why) pickUid.value = null
}

// ---- 拆下 ----
const cyber = computed(() => eng.body.cyber())
const pieces = computed(() => (cyber.value ? cyber.value.parts.flatMap((p) => p.pieces.flatMap((x) => (x ? [{ ...x, partId: p.id as PartId, partName: p.name }] : []))) : []))
const removable = computed(() => pieces.value.filter((p) => p.partId !== 'bridge'))
const rmUid = ref<string | null>(props.uid ?? null)
const rmPiece = computed(() => pieces.value.find((p) => p.uid === rmUid.value) ?? null)
const rmQ = computed(() => (rmUid.value ? eng.body.removeQuote({ uid: rmUid.value, via: viaId.value }) : null))
const rmReason = computed(() => (!rmUid.value ? '先選要拆的那一件。' : noSurgeon.value ?? eng.body.removeBlock({ uid: rmUid.value, via: viaId.value })))
function remove() { done(eng.body.remove({ uid: rmUid.value!, via: viaId.value }), `${rmPiece.value?.name ?? '義體'}拆下來了。`); rmUid.value = null }

// ---- 換零件 ----
const mdUid = ref<string | null>(null)
const mdType = ref<string | null>(null)
const mdIndex = ref(0)
const mdPart = ref<string | null>(null)
const mdPiece = computed(() => pieces.value.find((p) => p.uid === mdUid.value) ?? null)
const mdSlots = computed(() => (mdPiece.value ? eng.body.slotsOf(mdPiece.value.bp) : []))
const mdCount = computed(() => mdSlots.value.find((s) => s.type === mdType.value)?.count ?? 1)
const mdCandidates = computed(() => (mdType.value ? eng.body.partsBag(mdType.value) : []))
const mdOpts = computed(() => (mdUid.value && mdType.value && mdPart.value ? { uid: mdUid.value, type: mdType.value, part: mdPart.value, via: viaId.value, index: mdIndex.value } : null))
const mdQ = computed(() => (mdOpts.value ? eng.body.modifyQuote(mdOpts.value) : null))
const mdReason = computed(() => (!mdUid.value ? '先選要換零件的那一件。' : !mdType.value ? '先選要換哪一類的零件。' : !mdPart.value ? '先從背包選一個零件。' : noSurgeon.value ?? eng.body.modifyBlock(mdOpts.value!)))
watch(mdUid, () => { mdType.value = null; mdPart.value = null; mdIndex.value = 0 })
watch(mdType, () => { mdPart.value = null; mdIndex.value = 0 })
function modify() { done(eng.body.modify(mdOpts.value!), '零件換好了。'); mdPart.value = null }

// ---- 修理與解鎖 ----
const broken = computed(() => pieces.value.filter((p) => p.off?.why === 'broken'))
const rpUid = ref<string | null>(props.tab === 'repair' ? props.uid ?? null : null)
const rpQ = computed(() => (rpUid.value ? eng.body.repairQuote({ uid: rpUid.value, via: viaId.value }) : null))
const rpReason = computed(() => (!rpUid.value ? '先選要修的那一件。' : noSurgeon.value ?? eng.body.repairBlock({ uid: rpUid.value, via: viaId.value })))
function repair() { done(eng.body.repair({ uid: rpUid.value!, via: viaId.value }), '修好了。'); rpUid.value = null }
const locks = computed(() => eng.body.locks())
const lkUid = ref<string | null>(null)
const lk = computed(() => locks.value.find((l) => l.uid === lkUid.value) ?? null)
const crackQ = computed(() => (lkUid.value ? eng.body.crackQuote(lkUid.value) : null))
const crackReason = computed(() => (lkUid.value ? eng.body.crackBlock(lkUid.value) : '先選有鎖的那一件。'))
const payReason = computed(() => (lkUid.value ? eng.body.payBlock(lkUid.value) : '先選有鎖的那一件。'))
function crack() { done(eng.body.crack(lkUid.value!), '破解的結果在紀錄裡。') }
function pay() { done(eng.body.pay(lkUid.value!), '補繳了。') }
/** 勢力或人物的名字：勢力查內容、人物查角色（引擎給的是 id） */
const holderName = (id: string): string => eng.contentName('faction', id) ?? eng.contract.nameOf(id)

// ---- 洗點（技能；引擎的 respecQuote 與 respecBlock，要在調校診所） ----
const respecTrees = computed(() => eng.skills.paths().map((p) => ({ id: p.id, name: p.name, quote: eng.skills.respecQuote(p.id) })).filter((t) => t.quote && t.quote.abilities.length > 0))
const respecAll = computed(() => eng.skills.respecQuote())
const respecRows = (q: NonNullable<ReturnType<typeof eng.skills.respecQuote>>) => [
  { label: '洗掉的技能', value: `${q.abilities.length} 個` },
  { label: '退回的歷練點', value: `${q.xp} 點`, tone: 'ok' as const },
  { label: '費用', value: '', money: { kind: 'acc' as const, amount: q.price } },
  { label: '花的時間', value: spanText(q.minutes) },
  ...(q.unequipped.length ? [{ label: '會從橋上卸下', value: `${q.unequipped.length} 個` }] : []),
]
function respec(path?: string) { done(eng.skills.respec(path), '洗點做完了：歷練點退回來了。') }

// ---- 戒斷 ----
const drugs = computed(() => eng.body.drugs())
const detoxList = computed(() => (drugs.value?.addiction ?? []).filter((a) => a.value > 0))
function detox(id: string) { done(eng.body.detox(id), '療程做完了。') }
</script>

<template>
  <Dialog :entry-id="entryId" :stacked="stacked" title="診所" :sub="`${title}・義體手術與治療`" size="xl">
    <template #header>
      <Tabs v-model="tab" :tabs="TABS" />
      <Hint title="診所">站在診所上請診所動刀，或在住處自己動刀（要學過手術）。每一項先看報價，確認才送；擋住的原因是引擎的。</Hint>
    </template>
    <div v-if="gate" class="panel pad blocking" data-gate>{{ gate }}</div>
    <template v-else>
      <div class="surgeons" data-surgeons>
        <span class="k">誰來做<Hint title="動刀的人">診所穩定（會登記）；無照與黑診所便宜但有併發症的機率；自己動刀不收錢，要過檢定。這裡有哪幾種、費率與機率都是引擎的。</Hint></span>
        <div class="segs">
          <button v-for="s in surgeonBar" :key="s.id" type="button" :class="{ on: current?.id === s.id, 'is-unavailable': !!s.block }" :data-surgeon="s.id" :title="s.block ?? undefined" @click="s.block ? ui.toast(s.block, 'warn') : (via = s.id)">{{ s.name }}</button>
        </div>
        <span v-if="current" class="k" data-surgeon-note>手術費 {{ pctText(current.fee) }}・{{ current.id === 'self' ? '要過檢定' : `併發症 ${pctText(current.complication)}` }}{{ current.registered ? '・登記' : '' }}</span>
        <span v-else class="k">這裡沒有人可以動刀。</span>
      </div>

      <!-- 安裝 -->
      <div v-if="tab === 'install'" class="cl" data-tab="install">
        <section class="panel cut pad stack">
          <p class="h">背包裡的義體</p>
          <div v-if="!bag.length" class="empty-note">背包裡沒有可以裝的義體。</div>
          <button v-for="b in bag" :key="b.uid" type="button" class="lrow" :class="{ on: pickUid === b.uid }" :data-bag="b.uid" @click="pickUid = b.uid">
            <ItemSlot :item="slotItemOf(b, b.slot && b.slot in PART_UI ? PART_UI[b.slot as PartId].icon : undefined)" size="sm" inert />
            <span class="grow"><b>{{ b.name }}</b><small>{{ b.kind === 'bridge' ? '橋（換橋）' : b.kind === 'deck' ? '甲板（腦部）' : b.slot }}</small></span>
          </button>
        </section>
        <section class="stack">
          <div v-if="picked && eng.body.needsSide(picked.slot)" class="segs" data-side>
            <button v-for="s in (['l', 'r'] as const)" :key="s" type="button" :class="{ on: side === s }" :data-side-pick="s" @click="side = s">{{ SIDE_NAME[s] }}{{ picked.slot === 'arm' ? '臂' : '腿' }}</button>
          </div>
          <label v-if="picked?.kind === 'bridge'" class="chk"><input v-model="keepOld" type="checkbox" data-keep> 舊的那一座收回背包（二手）</label>
          <QuoteCard v-if="picked" :title="picked.kind === 'bridge' ? '換橋的報價' : '手術的報價'" :rows="installTable" :reason="installReason" action="動手術" data-install @go="install" />
          <p v-else class="empty-note">從左邊選一件義體，這裡會寫出報價。</p>
        </section>
      </div>

      <!-- 拆下 -->
      <div v-else-if="tab === 'remove'" class="cl" data-tab="remove">
        <section class="panel cut pad stack">
          <p class="h">身上的義體<Hint>橋要用換橋的手術換，不能這樣拆。有授權鎖的要先解鎖。</Hint></p>
          <div v-if="!removable.length" class="empty-note">身上沒有可以拆的義體。</div>
          <button v-for="p in removable" :key="p.uid" type="button" class="lrow" :class="{ on: rmUid === p.uid }" :data-piece="p.uid" @click="rmUid = p.uid">
            <ItemSlot :item="slotItemOf(p, PART_UI[p.partId].icon)" size="sm" inert :locked="p.status === 'off'" />
            <span class="grow"><b>{{ p.name }}</b><small>{{ p.partName }}・{{ statusText(p) }}・沉溺成本 {{ p.sink }}</small></span>
          </button>
        </section>
        <section class="stack">
          <QuoteCard v-if="rmUid" :title="`拆下${rmPiece?.name ?? ''}`" :rows="rmQ ? removeRows(rmQ, skillName) : []" :reason="rmReason" action="拆下" data-remove @go="remove" />
          <p v-else class="empty-note">選一件，這裡會寫出報價。</p>
        </section>
      </div>

      <!-- 換零件 -->
      <div v-else-if="tab === 'modify'" class="cl" data-tab="modify">
        <section class="panel cut pad stack">
          <p class="h">換哪一件<Hint>小手術：換掉成品裡的一個零件。橋與有授權鎖的不行或要先處理，原因是引擎的。</Hint></p>
          <button v-for="p in pieces.filter((x) => !x.deck)" :key="p.uid" type="button" class="lrow" :class="{ on: mdUid === p.uid }" :data-md-piece="p.uid" @click="mdUid = p.uid">
            <span class="grow"><b>{{ p.name }}</b><small>{{ p.partName }}</small></span>
          </button>
          <template v-if="mdPiece">
            <p class="h">哪一類的零件</p>
            <div class="segs"><button v-for="s in mdSlots" :key="s.type" type="button" :class="{ on: mdType === s.type }" :data-md-type="s.type" @click="mdType = s.type">{{ eng.body.typeName(s.type) }}{{ s.count > 1 ? `×${s.count}` : '' }}</button></div>
            <div v-if="mdType && mdCount > 1" class="segs"><button v-for="n in mdCount" :key="n" type="button" :class="{ on: mdIndex === n - 1 }" @click="mdIndex = n - 1">第 {{ n }} 個</button></div>
            <template v-if="mdType">
              <p class="h">背包裡的零件</p>
              <div v-if="!mdCandidates.length" class="empty-note">背包裡沒有這一類的零件。</div>
              <button v-for="c in mdCandidates" :key="c.key" type="button" class="lrow" :class="{ on: mdPart === c.key }" :data-md-part="c.key" @click="mdPart = c.key">
                <span class="grow"><b>{{ c.name }}</b><small>{{ c.material === 'bio' ? '生體' : '機械' }}・{{ c.state }}</small></span>
              </button>
            </template>
          </template>
        </section>
        <section class="stack">
          <QuoteCard v-if="mdUid" title="換零件的報價" :rows="mdQ ? modifyRows(mdQ, skillName) : []" :reason="mdReason" action="動手術" data-modify @go="modify" />
          <p v-else class="empty-note">先選一件義體。</p>
        </section>
      </div>

      <!-- 修理與解鎖 -->
      <div v-else-if="tab === 'repair'" class="cl" data-tab="repair">
        <section class="panel cut pad stack">
          <p class="h">壞了的義體<Hint>壞掉的義體不生效，沉溺成本照算。診所修，或自己在有工作台的住處修。</Hint></p>
          <div v-if="!broken.length" class="empty-note">沒有壞掉的義體。</div>
          <button v-for="p in broken" :key="p.uid" type="button" class="lrow" :class="{ on: rpUid === p.uid }" :data-broken="p.uid" @click="rpUid = p.uid">
            <span class="grow"><b>{{ p.name }}</b><small>{{ p.partName }}・{{ statusText(p) }}</small></span>
          </button>
          <QuoteCard v-if="rpUid" title="修理的報價" :rows="rpQ ? repairRows(rpQ, skillName) : []" :reason="rpReason" action="修理" data-repair @go="repair" />
        </section>
        <section class="panel cut pad stack">
          <p class="h">授權鎖<Hint>訂閱沒付就鎖住；補繳付清才解開，或破解（失敗會惹勢力生氣）。契約的鎖還要看持約人。</Hint></p>
          <div v-if="!locks.length" class="empty-note">身上沒有帶授權鎖的義體。</div>
          <button v-for="l in locks" :key="l.uid" type="button" class="lrow" :class="{ on: lkUid === l.uid }" :data-lock="l.uid" @click="lkUid = l.uid">
            <span class="grow"><b>{{ l.name }}</b><small>{{ l.kind === 'subscription' ? '訂閱' : l.kind === 'contract' ? '契約' : '鎖' }}<template v-if="l.holder">・{{ holderName(l.holder) }}</template>・每週 {{ l.weekly }}<template v-if="l.owed > 0">・欠 {{ l.owed }}</template>・{{ l.locked ? '鎖住了' : '沒鎖住' }}<template v-if="l.until !== undefined">・有期限</template></small></span>
          </button>
          <template v-if="lk">
            <div class="kv"><span>欠的</span><b><MoneyTag kind="acc" :amount="lk.owed" :size="12" /></b></div>
            <div class="go left"><ReasonButton sm :reason="payReason" data-act="pay" @go="pay">補繳</ReasonButton></div>
            <QuoteCard title="破解的報價" :rows="crackQ ? crackRows(crackQ, holderName) : []" :reason="crackReason" action="破解" data-crack @go="crack" />
          </template>
        </section>
      </div>

      <!-- 治療 -->
      <div v-else-if="tab === 'care'" class="cl" data-tab="care">
        <MedicalPanel clinic />
        <SinkPanel therapy />
      </div>

      <!-- 戒斷 -->
      <div v-else-if="tab === 'detox'" class="cl one" data-tab="detox">
        <section class="panel cut pad stack">
          <p class="h">戒斷療程<Hint>在提供療程的地方做：成癮值下降、要花幾天。費用與時間是引擎的報價。</Hint></p>
          <p class="k" data-detox-here>{{ drugs?.detox_here ? `這裡：${drugs.detox_here.name}${drugs.detox_here.free ? '（不收錢）' : ''}` : '這裡沒有提供戒斷療程。' }}</p>
          <div v-if="!detoxList.length" class="empty-note">沒有成癮的藥。</div>
          <article v-for="a in detoxList" :key="a.id" class="item" :data-detox="a.id">
            <b>{{ a.name }}・成癮 {{ a.value }}</b>
            <QuoteCard :rows="a.detox.quote ? detoxRows(a.detox.quote) : []" :reason="a.detox.block" action="做療程" @go="detox(a.id)" />
          </article>
        </section>
      </div>

      <!-- 洗點 -->
      <div v-else-if="tab === 'respec'" class="cl one" data-tab="respec">
        <section class="panel cut pad stack">
          <p class="h">洗點<Hint>洗掉一棵樹（或全部）學會的技能：歷練點退回來、樹的累計跟著扣、裝著的卸下，要付錢、過一天。基本功不能退，夜課不在這裡洗。費用、時間、原因都是引擎的。</Hint></p>
          <div v-if="!respecTrees.length" class="empty-note" data-empty>還沒有學會任何技能，沒有可以洗的。</div>
          <article v-for="t in respecTrees" :key="t.id" class="item" :data-respec="t.id">
            <b>{{ t.name }}</b>
            <QuoteCard :rows="respecRows(t.quote!)" :reason="eng.skills.respecBlock(t.id)" action="洗掉這一棵" @go="respec(t.id)" />
          </article>
          <article v-if="respecTrees.length > 1 && respecAll" class="item" data-respec="all">
            <b>全部的樹</b>
            <QuoteCard :rows="respecRows(respecAll)" :reason="eng.skills.respecBlock()" action="全部洗掉" :pri="false" @go="respec()" />
          </article>
        </section>
      </div>

      <!-- 清除韌體、調校與靜室：引擎的 malware、tuning（價錢、成功率、擋住的原因都是引擎的） -->
      <div v-else-if="tab === 'malware'" class="cl one" data-tab="malware"><MalwarePanel /></div>
      <div v-else class="cl one" data-tab="tuning"><TuningPanel /></div>
    </template>
  </Dialog>
</template>

<style scoped>
.surgeons { display: flex; gap: var(--space-4); align-items: center; flex-wrap: wrap; margin-bottom: var(--space-4); }
.cl { display: grid; grid-template-columns: minmax(0, 1.2fr) minmax(0, 1fr); gap: var(--space-4); align-items: start; }
.cl.one { grid-template-columns: minmax(0, 1fr); }
.item { display: grid; gap: var(--space-2); }
.chk { display: flex; gap: var(--space-3); align-items: center; font-size: var(--fs-sm); }
.go.left { justify-content: flex-start; margin-top: 0; }
@media (max-width: 900px) { .cl { grid-template-columns: minmax(0, 1fr); } }
</style>
