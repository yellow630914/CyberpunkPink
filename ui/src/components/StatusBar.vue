<script setup lang="ts">
import { useRouter } from 'vue-router'
import { useGame } from '../stores/game'
import { useUi, type DialogName } from '../stores/ui'
import MoneyTag from './MoneyTag.vue'
import Logo from './Logo.vue'
import Hint from './Hint.vue'
import { FULL_PAGES } from '../router'

/** 狀態列（UI.md 3.1 節）：時間、所在、錢、帳單倒數、敵對值最高的兩個、鈴鐺、選單。全頁共用。 */
const props = defineProps<{ title?: string; back?: boolean }>()
const g = useGame()
const ui = useUi()
const router = useRouter()
function go(path: string) { ui.menuOpen = false; router.push(path) }
const MENU_DIALOGS: Array<{ id: DialogName; name: string }> = [
  { id: 'settings', name: '設定' }, { id: 'saves', name: '讀檔與存檔' }, { id: 'pending', name: '待處理' }, { id: 'bills', name: '每週帳單' }, { id: 'memo', name: '備忘錄' },
]
void props
</script>

<template>
  <header class="status" :class="{ back }">
    <button v-if="back" type="button" class="btn sm" @click="router.push('/')">← 主畫面</button>
    <div v-else class="logo"><Logo /><span class="hide-m">CYBERPUNK PINK</span></div>
    <b v-if="title" class="ttl">{{ title }}</b>
    <div class="sep hide-m" />
    <div class="st"><b>第 {{ g.day }} 天</b><span class="hide-m">{{ g.weekday }}</span><b>{{ g.timeLabel }}</b></div>
    <div class="sep hide-m" />
    <div class="st hide-t"><span class="pill hot">{{ g.district.name }}</span>{{ g.loc.block }}<template v-if="g.facility">・{{ g.facility.name }}</template></div>
    <div class="sep hide-t" />
    <div class="st money-st"><MoneyTag kind="acc" :amount="g.money.acc" /><MoneyTag kind="cash" :amount="g.money.cash" class="hide-xs" /></div>
    <div class="st hide-m">帳單 <b>{{ g.billIn }} 天</b><Hint title="每週帳單">每週一收租日結算房租、義體訂閱、債的利息與薪水。付不起的那幾項照順序走下坡路。</Hint></div>
    <div class="st hide-t">敵對值<span v-for="[f, v] in g.topHostility" :key="f" class="hos">▲{{ f }} {{ v }}</span></div>
    <div class="grow" />
    <button type="button" class="ibtn cut-sm" :aria-label="`待處理 ${g.pending.length} 件`" title="待處理（N）" @click="ui.openRoot('pending')">
      <svg width="20" height="20" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3a6 6 0 0 0-6 6v4l-2 3h16l-2-3V9a6 6 0 0 0-6-6z" fill="#F3E9FF" /><circle cx="12" cy="19.5" r="2.2" fill="#F06AA0" /></svg>
      <span v-if="g.pending.length" class="badge">{{ g.pending.length }}</span>
    </button>
    <div class="menu-wrap">
      <button type="button" class="ibtn cut-sm" aria-label="選單" title="選單（Esc）" :aria-expanded="ui.menuOpen" @click="ui.menuOpen = !ui.menuOpen">
        <svg width="20" height="20" viewBox="0 0 24 24" aria-hidden="true"><rect x="4" y="5" width="16" height="3" rx="1.5" fill="#F3E9FF" /><rect x="4" y="10.5" width="16" height="3" rx="1.5" fill="#F3E9FF" /><rect x="4" y="16" width="10" height="3" rx="1.5" fill="#F06AA0" /></svg>
      </button>
      <div v-if="ui.menuOpen" class="menu panel" @click.self="ui.menuOpen = false">
        <p class="h">全頁</p>
        <button v-for="p in FULL_PAGES" :key="p.path" type="button" class="mi" :aria-disabled="p.pending ? 'true' : undefined" @click="p.pending ? ui.toast(p.pending, 'warn') : go(p.path)">
          <span>{{ p.name }}</span><small v-if="p.legacy">Demo</small><small v-else-if="p.pending">v3</small>
        </button>
        <p class="h">對話框</p>
        <button v-for="d in MENU_DIALOGS" :key="d.id" type="button" class="mi" @click="ui.openRoot(d.id)"><span>{{ d.name }}</span></button>
      </div>
    </div>
  </header>
</template>

<style scoped>
.status { flex: none; height: 52px; display: flex; align-items: center; gap: 12px; padding: 0 16px; background: var(--bg-term); border-bottom: 2px solid var(--line); position: relative; z-index: var(--z-sheet); min-width: 0; }
.logo { display: flex; align-items: center; gap: 8px; font-weight: 900; letter-spacing: 1px; white-space: nowrap; }
.ttl { font-size: var(--fs-md); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; min-width: 0; flex: 0 1 auto; }
.st { display: flex; align-items: center; gap: 6px; font-size: var(--fs-ui); color: var(--ink-2); white-space: nowrap; flex: none; }
.st b { color: var(--ink); font-weight: 800; }
.hos { font: 800 var(--fs-sm) var(--mono); color: var(--warn); }
.sep { width: 2px; height: 22px; background: var(--line); flex: none; }
.grow { flex: 1; }
.ibtn { width: 34px; height: 34px; display: grid; place-items: center; background: var(--bg-2); position: relative; border: 0; cursor: pointer; flex: none; }
.badge { position: absolute; top: -4px; right: -4px; min-width: 16px; height: 16px; border-radius: 8px; background: var(--a); color: #fff; font-size: var(--fs-tiny); font-weight: 900; display: grid; place-items: center; padding: 0 4px; }
.menu-wrap { position: relative; }
.menu { position: absolute; right: 0; top: 42px; width: 240px; max-height: calc(100dvh - 64px); overflow: auto; padding: 12px; display: grid; gap: 4px; background: var(--bg-1); z-index: var(--z-sheet); box-shadow: inset 0 0 0 2px var(--a), var(--shadow); }
.menu .h { margin: 6px 0 2px; }
.mi { display: flex; justify-content: space-between; align-items: center; background: var(--bg-2); border: 0; padding: 8px 10px; font-weight: 800; font-size: var(--fs-ui); cursor: pointer; color: var(--ink); text-align: left; }
.mi:hover { background: var(--a); color: #fff; }
.mi small { font: 800 var(--fs-tiny) var(--mono); color: var(--ink-3); }
[data-skin="net"] .status { background: var(--bg-1); border-bottom: 3px solid var(--o); }
[data-skin="net"] .ibtn { box-shadow: inset 0 0 0 2px var(--o); background: var(--o); }
@media (max-width: 1100px) { .hide-t { display: none; } }
@media (max-width: 720px) { .hide-m { display: none; } .status { gap: 8px; padding: 0 10px; height: 48px; } .status.back .money-st { display: none; } }
@media (max-width: 400px) { .hide-xs { display: none; } }
</style>
