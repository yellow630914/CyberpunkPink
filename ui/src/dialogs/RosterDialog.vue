<script setup lang="ts">
import { computed, ref } from 'vue'
import Dialog from '../components/Dialog.vue'
import Hint from '../components/Hint.vue'
import MoneyTag from '../components/MoneyTag.vue'
import ReasonButton from '../components/ReasonButton.vue'
import TrackBar from '../components/TrackBar.vue'
import { useEngine } from '../stores/engine'
import { useUi } from '../stores/ui'
import { failText } from '../lib/lifeView'
import { SOURCE_NAME, UNOPENED, chancePct, factionOf, identityOf, memberRows, recruitIds } from '../lib/peopleView'

/**
 * 名冊（UI 第 13 節，規則 FIXER 第 6 節、NPC_SYSTEM 第 10 節）：成員（路數與階數、出場費或分紅、忠誠、現在的狀況）、容量、候選人、招募、把人拿掉。
 * 容量、出場費、有空沒有、招募的 DC 與成功率與原因都是引擎的（features/roster）；召集在委託的召集頁；派工、外包還沒有開放。
 */
defineProps<{ entryId: number; stacked?: boolean }>()
const e = useEngine()
const ui = useUi()
const FILTERS = ['全部', '有空', '出場費', '分紅'] as const
const filter = ref<(typeof FILTERS)[number]>('全部')

const view = computed(() => e.people.roster())
const members = computed(() => memberRows(view.value.members, e.people.npc, e.people.look))
const shown = computed(() => members.value.filter((m) => filter.value === '全部' || (filter.value === '有空' ? m.busy.length === 0 : filter.value === '出場費' ? m.payAmount !== null : m.payAmount === null)))
const recruits = computed(() => recruitIds(e.people.candidates(), e.people.known(), members.value.map((m) => m.id), e.people.isRunner)
  .map((id) => ({ id, npc: e.people.npc(id), info: e.people.recruitInfo(id), source: e.people.candidates().find((c) => c.who === id)?.source }))
  .filter((r) => r.npc))
const free = computed(() => view.value.cap - view.value.size)

async function recruit(id: string) {
  const r = await e.people.recruit(id)
  const why = failText(r, '現在招募不了。')
  if (why) ui.toast(why, 'warn')
}
async function remove(id: string) {
  const r = await e.people.removeMember(id)
  const why = failText(r, '現在拿不掉。')
  if (why) ui.toast(why, 'warn')
}
</script>

<template>
  <Dialog :entry-id="entryId" :stacked="stacked" title="名冊" :sub="`${view.size}／${view.cap}・召集在委託的召集頁`" size="xl">
    <template #header>
      <div class="filters fl"><button v-for="f in FILTERS" :key="f" type="button" :class="{ on: filter === f }" :data-filter="f" @click="filter = f">{{ f }}</button></div>
      <Hint title="名冊">容量與出場費由引擎算：夥伴拿一份分紅；行者拿出場費。忠誠太低的人會在結帳時離開。名冊上的人要在這裡拿掉才會空出位子。</Hint>
    </template>
    <p class="cap" data-cap>名冊 <b class="mono">{{ view.size }}／{{ view.cap }}</b>・空位 {{ free }}</p>
    <div class="grid" data-members>
      <article v-for="m in shown" :key="m.id" class="card panel cut" :data-member="m.id">
        <header class="ch">
          <div class="ava" aria-hidden="true">{{ m.name.slice(0, 1) }}</div>
          <div class="who">
            <b>{{ m.name }}</b>
            <small>{{ e.people.npc(m.id) ? identityOf(e.people.npc(m.id)!) : '' }}<template v-if="e.people.npc(m.id)?.faction">・{{ factionOf(e.people.npc(m.id)!, e.people.look) }}</template></small>
          </div>
          <span class="status" :class="{ busy: m.busy.length }" data-status>{{ m.status }}</span>
        </header>
        <div class="paths"><span v-for="p in m.paths" :key="p" class="tag">{{ p }}</span><span v-if="m.inParty" class="tag hot">在隊上</span></div>
        <div v-for="b in m.busy" :key="b" class="note" data-busy>{{ b }}</div>
        <div class="kv"><span>{{ m.payText }}</span><b data-pay><MoneyTag v-if="m.payAmount !== null" kind="cash" :amount="m.payAmount" :size="13" /><template v-else>一份</template><template v-if="m.weekly"> ＋ 週薪 <MoneyTag kind="cash" :amount="m.weekly" :size="13" /></template></b></div>
        <TrackBar label="可靠" :value="m.reliability" :max="100" color="var(--b)" :height="6" />
        <TrackBar label="忠誠" :value="m.loyalty" :max="100" color="var(--ram)" :height="6" class="mt" />
        <footer class="acts">
          <ReasonButton sm reason="召集在委託的召集頁：接了委託、踩完點之後才開。">召集</ReasonButton>
          <ReasonButton sm :reason="UNOPENED">派工</ReasonButton>
          <button type="button" class="btn sm" @click="ui.open('talk', { npcId: m.id })">說話</button>
          <button type="button" class="btn sm ghost" @click="ui.open('relations', { npcId: m.id })">關係</button>
          <button type="button" class="btn sm ghost" :data-remove="m.id" @click="remove(m.id)">拿出名冊</button>
        </footer>
      </article>
      <article v-if="!shown.length" class="card empty cut"><b>{{ members.length ? '沒有符合的人' : '名冊是空的' }}</b><small>下面的候選人與認識的行者可以招募。</small></article>
    </div>

    <h3 class="sec">候選人與可以招募的行者<Hint>候選人是你救過的人或別人介紹的人（忠誠起始值較高）；認識的行者也可以招募。DC、成功率與擋下的原因（名冊滿了、說要再想想）都是引擎的。</Hint></h3>
    <div class="grid" data-recruits>
      <article v-for="r in recruits" :key="r.id" class="card panel cut" :data-recruit="r.id">
        <header class="ch">
          <div class="ava" aria-hidden="true">{{ r.npc!.name.slice(0, 1) }}</div>
          <div class="who"><b>{{ r.npc!.name }}</b><small>{{ identityOf(r.npc!) }}<template v-if="r.source">・{{ SOURCE_NAME[r.source] }}</template></small></div>
          <span class="mono dcn" :title="r.info.mods.map((m) => `${m.label} ${m.value > 0 ? '+' : ''}${m.value}`).join('；')" data-dc>DC {{ r.info.dc }}<template v-if="r.info.chance !== null">・{{ chancePct(r.info.chance) }}</template></span>
        </header>
        <div v-if="r.info.block" class="note" data-block>{{ r.info.block }}</div>
        <footer class="acts">
          <ReasonButton sm pri :reason="r.info.block" :data-recruit-go="r.id" @go="recruit(r.id)">招募</ReasonButton>
          <button type="button" class="btn sm ghost" @click="ui.open('talk', { npcId: r.id })">說話</button>
        </footer>
      </article>
      <article v-if="!recruits.length" class="card empty cut"><b>沒有可以招募的人</b><small>牆報徵人、中間人介紹、一起出過任務的人，會出現在這裡。</small></article>
    </div>
  </Dialog>
</template>

<style scoped>
.fl { margin: 0; }
.cap { margin: 0 0 10px; color: var(--ink-2); font-size: var(--fs-ui); }
.sec { margin: 18px 0 8px; font-size: var(--fs-card); display: flex; gap: 6px; align-items: center; }
.grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(250px, 1fr)); gap: 10px; }
.card { padding: 12px; display: grid; gap: 8px; align-content: start; }
.card.empty { background: transparent; box-shadow: inset 0 0 0 2px var(--line); border: 0; color: var(--ink-3); place-content: center; text-align: center; min-height: 120px; }
.card.empty small { display: block; margin-top: 4px; font-size: var(--fs-xs); }
.ch { display: flex; align-items: center; gap: 10px; }
.ava { width: 40px; height: 40px; border-radius: 10px; background: var(--bg-2); display: grid; place-items: center; font-weight: 900; color: var(--b); flex: none; }
.who { flex: 1; min-width: 0; }
.who small { display: block; color: var(--ink-3); font-size: var(--fs-xs); }
.status { font-size: var(--fs-fine); font-weight: 900; padding: 2px 8px; border-radius: 6px; background: color-mix(in srgb, var(--ok) 22%, transparent); color: var(--ok); white-space: nowrap; }
.status.busy { background: color-mix(in srgb, var(--warn) 22%, transparent); color: var(--warn); }
.dcn { font-size: var(--fs-sm); color: var(--ink-2); font-weight: 800; white-space: nowrap; }
.paths { display: flex; gap: 4px; flex-wrap: wrap; }
.note { font-size: var(--fs-xs); color: var(--warn); font-weight: 700; }
.mt { margin-top: 2px; }
.acts { display: flex; gap: 5px; flex-wrap: wrap; margin-top: 4px; }
</style>
