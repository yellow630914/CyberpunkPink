<script setup lang="ts">
import { computed, ref } from 'vue'
import Dialog from '../components/Dialog.vue'
import Hint from '../components/Hint.vue'
import MoneyTag from '../components/MoneyTag.vue'
import ReasonButton from '../components/ReasonButton.vue'
import TrackBar from '../components/TrackBar.vue'
import { useGame } from '../stores/game'
import { useUi } from '../stores/ui'
import { ROSTER_CAP, type RosterEntry } from '../data/roster'

/**
 * 名冊（UI 第 13 節，規則 FIXER 第 6 節、NPC_SYSTEM 第 10 節）。一人一張卡：路數與階數、狀況、出場費或分紅、可靠度、忠誠。
 * 召集只在委託的召集頁（UI 7.3 節）；這裡能派工、外包、聯絡、打開契約面板。
 */
defineProps<{ entryId: number; stacked?: boolean }>()
const g = useGame()
const ui = useUi()
const FILTERS = ['全部', '有空', '現實強', '內海強', '輿論強', '夥伴', '行者'] as const
const filter = ref<typeof FILTERS[number]>('全部')
const list = computed(() => g.roster.filter(r => {
  switch (filter.value) {
    case '有空': return r.status === '有空'
    case '現實強': return r.strong === '現實'
    case '內海強': return r.strong === '內海'
    case '輿論強': return r.strong === '輿論'
    case '夥伴': return r.kind === '夥伴'
    case '行者': return r.kind !== '夥伴'
    default: return true
  }
}))
const STATUS_COLOR: Record<string, string> = { 有空: 'var(--ok)', 被捕: 'var(--danger)', 在派工: 'var(--ap)', 在頻道: 'var(--ep)', 受傷: 'var(--hp)', 躲風頭: 'var(--warn)' }
function dispatch(r: RosterEntry) {
  r.status = '在派工'; r.statusNote = '後天 10:00 回來'
  g.addLog({ prose: [`你把${g.npcs[r.npc].name}派去替阿蓮跑一趟貨，抽成照行規。`] })
  ui.toast(`${g.npcs[r.npc].name}出門了。`)
}
function bail(r: RosterEntry) {
  if (g.money.cash < 1200) { ui.toast('現金晶片不夠：保釋金 1,200。', 'warn'); return }
  g.money.cash -= 1200
  r.status = '有空'; r.statusNote = undefined
  g.npcs[r.npc].loyalty = Math.min(100, g.npcs[r.npc].loyalty + 10)
  g.pending = g.pending.filter(p => p.id !== 'p_joe')
  g.addLog({ prose: [`你到第七分局把${g.npcs[r.npc].name}保了出來。她點了一根菸，說下次她請。`], changes: [{ text: '現金 −1,200', kind: 'minus' }, { text: '忠誠 +10', kind: 'plus' }] })
}
function contact(r: RosterEntry) {
  if (r.npc === 'xiaomai') { ui.open('talk', { npcId: 'xiaomai' }); return }
  ui.toast(`你用耳語聯絡了${g.npcs[r.npc].name}。`)
}
const busyReason = (r: RosterEntry) => (r.status === '有空' ? null : `${g.npcs[r.npc].name}現在${r.status}。`)
</script>

<template>
  <Dialog :entry-id="entryId" :stacked="stacked" title="名冊" :sub="`${g.roster.length}／${ROSTER_CAP}・召集在委託的召集頁`" size="xl">
    <template #header>
      <div class="filters fl"><button v-for="f in FILTERS" :key="f" type="button" :class="{ on: filter === f }" @click="filter = f">{{ f }}</button></div>
      <Hint title="名冊">名冊的容量看魅力與掮客的共鳴。夥伴拿一份分紅；生成的行者拿出場費或一份分紅。忠誠 20 以下的人，每週結帳時有三成會離開名冊。</Hint>
    </template>
    <div class="grid">
      <article v-for="r in list" :key="r.npc" class="card panel cut">
        <header class="ch">
          <div class="ava" aria-hidden="true">{{ g.npcs[r.npc].name.slice(0, 1) }}</div>
          <div class="who">
            <b>{{ g.npcs[r.npc].name }}</b>
            <small>{{ r.kind }}<template v-if="g.npcs[r.npc].faction">・{{ g.npcs[r.npc].faction }}</template></small>
          </div>
          <span class="status" :style="{ '--c': STATUS_COLOR[r.status] ?? 'var(--ink-3)' }">{{ r.status }}</span>
        </header>
        <div class="paths"><span v-for="p in r.paths" :key="p.tree" class="tag">{{ p.tree }} {{ p.tier }}</span><span class="tag hot">{{ r.strong }} 強</span></div>
        <div v-if="r.statusNote" class="note">{{ r.statusNote }}</div>
        <div class="kv"><span>{{ r.pay.kind }}</span><b><MoneyTag v-if="r.pay.amount" kind="cash" :amount="r.pay.amount" :size="13" /><template v-else>一份</template></b></div>
        <TrackBar label="可靠" :value="r.reliability" :max="100" color="var(--b)" :height="6" />
        <TrackBar label="忠誠" :value="g.npcs[r.npc].loyalty" :max="100" color="var(--ram)" :marks="[20, 40, 70]" :height="6" class="mt" />
        <footer class="acts">
          <ReasonButton sm reason="召集在委託的召集頁：接了委託、踩完點之後才開。">召集</ReasonButton>
          <template v-if="r.status === '被捕'"><ReasonButton sm pri :reason="g.money.cash < 1200 ? '現金晶片不夠：保釋金 1,200。' : null" @go="bail(r)">保他出來</ReasonButton></template>
          <template v-else>
            <ReasonButton sm :reason="busyReason(r)" @go="dispatch(r)">派工</ReasonButton>
            <ReasonButton sm :reason="busyReason(r) ?? '外包單項要在委託的階段裡選。'">外包</ReasonButton>
          </template>
          <button type="button" class="btn sm" @click="contact(r)">聯絡</button>
          <button v-if="r.contract" type="button" class="btn sm pri" @click="ui.open('contract', { npcId: r.npc })">契約面板</button>
          <button type="button" class="btn sm ghost" @click="ui.open('relations', { npcId: r.npc })">關係</button>
        </footer>
      </article>
      <article v-if="filter === '全部'" class="card empty cut">
        <b>空位 {{ ROSTER_CAP - g.roster.length }}</b>
        <small>牆報徵人、中間人介紹、夜店「過載」，或一起出過任務的人。</small>
      </article>
    </div>
  </Dialog>
</template>

<style scoped>
.fl { margin: 0; }
.grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(250px, 1fr)); gap: 10px; }
.card { padding: 12px; display: grid; gap: 8px; align-content: start; }
.card.empty { background: transparent; box-shadow: inset 0 0 0 2px var(--line); border: 0; color: var(--ink-3); place-content: center; text-align: center; min-height: 160px; }
.card.empty small { display: block; margin-top: 4px; font-size: var(--fs-xs); }
.ch { display: flex; align-items: center; gap: 10px; }
.ava { width: 40px; height: 40px; border-radius: 10px; background: var(--bg-2); display: grid; place-items: center; font-weight: 900; color: var(--b); flex: none; }
.who { flex: 1; min-width: 0; }
.who small { display: block; color: var(--ink-3); font-size: var(--fs-xs); }
.status { font-size: 11px; font-weight: 900; padding: 2px 8px; border-radius: 6px; background: color-mix(in srgb, var(--c) 22%, transparent); color: var(--c); white-space: nowrap; }
.paths { display: flex; gap: 4px; flex-wrap: wrap; }
.note { font-size: var(--fs-xs); color: var(--warn); font-weight: 700; }
.mt { margin-top: 2px; }
.acts { display: flex; gap: 5px; flex-wrap: wrap; margin-top: 4px; }
</style>
