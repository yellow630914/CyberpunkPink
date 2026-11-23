<script setup lang="ts">
import { computed, ref } from 'vue'
import Dialog from '../components/Dialog.vue'
import Tabs from '../components/Tabs.vue'
import Hint from '../components/Hint.vue'
import { GUIDE_LIST, GUIDE_PAGES } from '../data/content.generated'
import { useGame } from '../stores/game'
import { useEngine } from '../stores/engine'
import { favorRows } from '../lib/peopleView'
import { useUi } from '../stores/ui'

/**
 * 備忘錄（UI 3.6 節）：角色寫的筆記，加上「指南」分頁。指南只列收進來的（所以也是「你碰過哪些系統」的清單），
 * 照類分組；沒看過的有紅點。指南是介面的說明，用系統的樣式（等寬字、SYS 標籤），和筆記分開。
 */
const props = defineProps<{ entryId: number; stacked?: boolean; tab?: string }>()
const g = useGame()
const ui = useUi()
const eng = useEngine()
// 人情是引擎的（features/favors）：欠你的與你欠的
const favors = computed(() => [...favorRows(eng.people.favors(), 'owed_to_pc', eng.people.favorName), ...favorRows(eng.people.favors(), 'owed_by_pc', eng.people.favorName)])
const unseen = computed(() => g.guides.collected.filter(id => !g.guides.seen.includes(id)))
const tab = ref(props.tab ?? (unseen.value.length ? 'guides' : 'notes'))
const tabs = computed(() => [{ id: 'notes', label: '筆記' }, { id: 'guides', label: '指南', dot: unseen.value.length > 0 }])
const CATS = ['基礎', '角色', '委託', '戰鬥', '內海', '媒體', '日常', '成人', '系統']
const groups = computed(() => CATS.map(c => ({ cat: c, items: GUIDE_LIST.filter(x => x.category === c && g.guides.collected.includes(x.id)) })).filter(x => x.items.length))
const NOTES = [
  { t: '藍鯨的帳本', b: '小麥說倉管的信都寄到舊港的第三倉。帳本可能在那裡，不在藍鯨的子網裡。' },
  { t: '七號塔的公告', b: '緋櫻警備局要清查沒登記的義體。小麥覺得他們在找人。' },
  { t: '九號塔的封鎖線', b: '那封不能經過郵局的信，收件人在封鎖線外面。' },
]
</script>

<template>
  <Dialog :entry-id="entryId" :stacked="stacked" title="備忘錄" :sub="`筆記 ${NOTES.length}・指南 ${g.guides.collected.length}／${GUIDE_LIST.length}`" size="lg">
    <template #header><Tabs v-model="tab" :tabs="tabs" /></template>
    <section v-if="tab === 'notes'" class="row-list">
      <div class="grid2"><div v-for="n in NOTES" :key="n.t" class="lrow note"><div class="grow"><b>{{ n.t }}</b><small>{{ n.b }}</small></div></div></div>
      <p class="h mt">人情</p>
      <div class="grid2"><div v-for="f in favors" :key="f.id" class="lrow"><span class="grow"><b>{{ f.whoName }}</b><small>{{ f.note || f.when }}</small></span><span :class="f.dir === 'owed_by_pc' ? 'warn-t' : 'ok-t'" class="mono">{{ f.dir === 'owed_by_pc' ? '你欠' : '欠你' }}・{{ f.size }}</span></div><div v-if="!favors.length" class="empty-note">沒有人情的往來。</div></div>
    </section>
    <section v-else class="guides">
      <p class="h">還沒碰過的系統不列出來<Hint>紅點是收進來但還沒看的。關掉「跳出指南」之後，新的指南直接收到這裡。</Hint></p>
      <template v-for="grp in groups" :key="grp.cat">
        <p class="cat">{{ grp.cat }}</p>
        <div class="grid2"><button v-for="x in grp.items" :key="x.id" type="button" class="lrow gl" @click="ui.open('guide', { guideId: x.id })">
          <span class="sys">SYS</span>
          <span class="grow"><b>{{ x.title }}</b><small>{{ GUIDE_PAGES[x.id] ? `${GUIDE_PAGES[x.id].length} 頁` : '內文還沒寫' }}</small></span>
          <i v-if="!g.guides.seen.includes(x.id)" class="dot" aria-label="沒看過" />
        </button></div>
      </template>
    </section>
  </Dialog>
</template>

<style scoped>
.mt { margin-top: 12px; }
.note small { font-size: var(--fs-sm); line-height: 1.6; color: var(--ink-2); }
.cat { font: 900 var(--fs-fine) var(--mono); color: var(--ram); letter-spacing: 2px; margin: 12px 0 6px; }
.gl { margin-bottom: 5px; font-family: var(--mono); }
.sys { font: 900 var(--fs-tiny) var(--mono); padding: 2px 6px; border-radius: 4px; background: var(--bg-term); color: var(--ram); flex: none; }
.dot { width: 8px; height: 8px; border-radius: 50%; background: var(--danger); flex: none; }
</style>
