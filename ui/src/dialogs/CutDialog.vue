<script setup lang="ts">
import { computed, ref } from 'vue'
import Dialog from '../components/Dialog.vue'
import Hint from '../components/Hint.vue'
import Tabs from '../components/Tabs.vue'
import ReasonButton from '../components/ReasonButton.vue'
import { useGame } from '../stores/game'
import { useUi } from '../stores/ui'
import { ANGLES, PUBLISH, cutStats, footageQuality, type Angle, type Footage, type MediaRecord } from '../data/media'
import { d20 } from '../lib/combat/rng'

/**
 * 素材與剪片（對話框，MEDIA 第 1～5 節、mockups/overlays.html#cut）：紀錄 → 做成素材 → 剪（一到三段、一個角度）→ 發布。
 * 錄影義體開著時一直在錄；一則紀錄只能轉一次，超過一週才轉品質 −1。剪片花一個時段，在住處或轉播站做。
 * 對話框：它是頻道的一個工具，從頻道或家園的攝影間打開，做完回到原處。
 */
defineProps<{ entryId: number; stacked?: boolean }>()
const g = useGame()
const ui = useUi()
const tab = ref('cut')
const m = g.media
const parts = ref<string[]>([])
const angle = ref<Angle>('揭弊')
const forged = ref(false)
const chosen = computed(() => parts.value.map(id => m.footage.find(f => f.id === id)!).filter(Boolean) as Footage[])
const stats = computed(() => cutStats(chosen.value, angle.value, forged.value))
function convert(r: MediaRecord) {
  if (!r.recorded || r.converted) return
  r.converted = true
  m.footage.push({ id: `f${Date.now()}`, name: r.name, kind: r.kind, quality: footageQuality(r, g.day), who: ['藍鯨物流'], truth: '真的', exclusive: !r.live })
  ui.toast(`「${r.name}」做成素材了。`)
}
const recReason = (r: MediaRecord) => (!r.recorded ? '這一則沒錄到（錄影關著）。' : r.converted ? '一則紀錄只能轉一次。' : null)
function togglePart(id: string) {
  const i = parts.value.indexOf(id)
  if (i >= 0) parts.value.splice(i, 1)
  else if (parts.value.length < 3) parts.value.push(id)
  else ui.toast('一支片最多三段素材。', 'warn')
}
const cutReason = computed(() => (!parts.value.length ? '先選一到三段素材。' : null))
function cut() {
  const s = stats.value
  let note = ''
  if (forged.value) { const die = d20(Math.random); note = die + 5 >= 13 ? `偽造：介面 1d20(${die}) + 5 對 13，做得像真的。` : `偽造：介面 1d20(${die}) + 5 對 13，有破綻（風險再 +2）。` }
  m.cuts.unshift({ id: `c${Date.now()}`, name: chosen.value.map(f => f.name).join('＋'), parts: [...parts.value], angle: angle.value, looks: s.looks, cred: s.cred, risk: s.risk + (note.includes('破綻') ? 2 : 0), forged: forged.value })
  g.advance(240)
  g.addLog({ prose: [`你花了一個時段把${chosen.value.map(f => `「${f.name}」`).join('、')}剪成一支片，角度是${angle.value}。${note}`] })
  parts.value = []
  tab.value = 'publish'
}
function publish(cutId: string, how: string) {
  const c = m.cuts.find(x => x.id === cutId)!
  const p = PUBLISH.find(x => x.id === how)!
  c.published = p.name
  let res = ''
  if (how === 'upload') {
    const die = d20(Math.random)
    const subs = c.looks * 8, cred = c.angle === '揭弊' || c.angle === '英雄' ? 1 : -1
    g.channel.subs += subs
    g.channel.cred = Math.max(0, Math.min(100, g.channel.cred + cred))
    res = die <= c.risk ? `出事了（擲出 ${die} 對風險 ${c.risk}）：被拍到的勢力敵對值上升。` : `訂閱 +${subs}、公信力 ${cred >= 0 ? '+' : ''}${cred}。`
    if (die <= c.risk) g.hostility['藍鯨'] = (g.hostility['藍鯨'] ?? 0) + 3
  } else if (how === 'sell') { const v = c.looks * 120; g.money.acc += v; res = `賣斷：帳戶 +${v}。` }
  else if (how === 'card') res = `變成一張「${ANGLES.find(a => a.id === c.angle)!.card}」牌，下一場相關的輿論戰帶進牌庫。`
  else res = `${p.name}：${p.what}。`
  g.addLog({ prose: [`片「${c.name}」：${res}`] })
  ui.toast(res)
}
</script>

<template>
  <Dialog :entry-id="entryId" :stacked="stacked" title="素材與剪片" :sub="`錄影義體：${m.recording ? '開著（一直在錄）' : '關著'}`" size="xl">
    <template #header>
      <Tabs v-model="tab" :tabs="[{ id: 'rec', label: '紀錄' }, { id: 'cut', label: '剪片' }, { id: 'publish', label: '發布' }]" />
      <button type="button" class="btn sm" :class="{ pri: m.recording }" :aria-pressed="m.recording" @click="m.recording = !m.recording">錄影 {{ m.recording ? '開' : '關' }}</button>
      <Hint title="錄影">錄影義體開著時一直在錄，不必操作。一直錄著有代價：被捕時紀錄是證據；有些場所與對象不准錄。這是要不要關掉它的理由。</Hint>
    </template>
    <div v-if="tab === 'rec'" class="grid2">
      <div v-for="r in m.records" :key="r.id" class="lrow">
        <span class="dot" :class="{ on: r.recorded }">●</span>
        <span class="grow"><b>{{ r.name }}</b><small>第 {{ r.day }} 天・{{ r.kind }}・{{ r.recorded ? (r.converted ? '已經轉成素材' : '錄到') : '已關閉錄影' }}{{ g.day - r.day > 7 ? '・超過一週，品質 −1' : '' }}</small></span>
        <ReasonButton sm :reason="recReason(r)" @go="convert(r)">做成素材</ReasonButton>
      </div>
    </div>
    <div v-else-if="tab === 'cut'" class="ct">
      <section class="panel cut pad stack">
        <p class="h">素材・選一到三段<Hint>類型：戰鬥、醜聞、罪證、親密、名人、日常。品質 1～5 在轉的時候就定了。獨家：別人也拍到，或直播過的就不算。</Hint></p>
        <button v-for="f in m.footage" :key="f.id" type="button" class="lrow" :class="{ on: parts.includes(f.id) }" :data-footage="f.id" @click="togglePart(f.id)">
          <span class="kc" :style="{ '--c': 'var(--ap)' }">{{ f.kind }}</span>
          <span class="grow"><b>{{ f.name }}</b><small>拍到：{{ f.who.join('、') }}・{{ f.truth }}{{ f.exclusive ? '・獨家' : '' }}</small></span>
          <span class="mono">品質 {{ f.quality }}</span>
        </button>
      </section>
      <section class="panel cut pad stack">
        <p class="h">角度</p>
        <div class="grid2" style="--col-min: 150px">
          <button v-for="a in ANGLES" :key="a.id" type="button" class="lrow ang" :class="{ on: angle === a.id }" @click="angle = a.id"><span class="grow"><b>{{ a.id }}</b><small>{{ a.card }}・{{ a.what }}</small></span></button>
        </div>
        <label class="fg"><button type="button" class="switch" :class="{ on: forged }" :aria-pressed="forged" aria-label="偽造" @click="forged = !forged" /><span>偽造：擲介面，風險 +5</span></label>
        <div class="nums">
          <div><span class="k">看點</span><b class="big-num">{{ stats.looks }}</b></div>
          <div><span class="k">可信</span><b class="big-num">{{ stats.cred }}</b></div>
          <div><span class="k">風險</span><b class="big-num" :class="{ 'warn-t': stats.risk >= 5 }">{{ stats.risk }}</b><small>d20 擲出 {{ stats.risk }} 以下出事</small></div>
        </div>
        <div class="go"><ReasonButton pri :reason="cutReason" data-cut @go="cut">剪（一個時段）</ReasonButton></div>
      </section>
    </div>
    <div v-else class="stack">
      <div v-if="!m.cuts.length" class="empty-note">還沒有剪好的片。</div>
      <section v-for="c in m.cuts" :key="c.id" class="panel cut pad">
        <div class="ch"><b class="t-card">{{ c.name }}</b><span class="tag">{{ c.angle }}</span><span class="t-fine">看點 {{ c.looks }}・可信 {{ c.cred }}・風險 {{ c.risk }}</span><span v-if="c.published" class="tag hot">{{ c.published }}</span></div>
        <div class="grid2" style="--col-min: 220px">
          <button v-for="p in PUBLISH" :key="p.id" type="button" class="lrow" :class="{ 'is-unavailable': !!c.published }" :aria-disabled="!!c.published || undefined" @click="c.published ? ui.toast('這支片已經發布過了。', 'warn') : publish(c.id, p.id)"><span class="grow"><b>{{ p.name }}</b><small>{{ p.what }}</small></span></button>
        </div>
      </section>
    </div>
  </Dialog>
</template>

<style scoped>
.ct { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); gap: var(--space-4); align-items: start; }
.lrow .grow { display: grid; }
.dot { color: var(--ink-3); } .dot.on { color: var(--hp); }
.fg { display: flex; align-items: center; gap: var(--space-3); font-size: var(--fs-sm); }
.nums { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: var(--space-3); }
.nums div { display: grid; background: var(--bg-2); padding: var(--space-3); }
.nums small { color: var(--ink-3); font-size: var(--fs-fine); }
.ch { display: flex; align-items: center; gap: var(--space-3); flex-wrap: wrap; margin-bottom: var(--space-3); }
@media (max-width: 900px) { .ct { grid-template-columns: minmax(0, 1fr); } }
</style>
