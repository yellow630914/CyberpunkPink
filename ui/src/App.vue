<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, watch, watchEffect } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import DialogHost from './components/DialogHost.vue'
import { useGame } from './stores/game'
import { useEngine } from './stores/engine'
import { useSettings } from './stores/settings'
import { useUi, DIALOG_TITLES, type DialogName } from './stores/ui'
import { useSaves } from './stores/saves'
import { keyAction, isTyping } from './lib/keys'
import { freshEffects } from './lib/engineView'

/** 外殼：全頁由路由切換，對話框層蓋在上面。子網與內海戰鬥的全頁換成內海皮。 */
const route = useRoute()
const g = useGame()
const eng = useEngine()
const settings = useSettings()
const ui = useUi()
// 換全頁時關掉所有對話框：對話框只屬於打開它的那一頁
watch(() => route.path, () => ui.closeAll())
// 直接連到對話框：#/?dialog=shop&shopId=alian（測試與截圖用，也方便引擎開發時直接打開某個對話框）
watch(() => route.query.dialog, d => {
  if (typeof d === 'string' && d in DIALOG_TITLES) {
    const { dialog: _omit, ...rest } = route.query
    void _omit
    ui.openRoot(d as DialogName, rest as Record<string, unknown>)
  }
}, { immediate: true })
settings.apply()

// ---- 每週帳單（M2-ui-life）：引擎出了 bill.settle（跨過週一）就把帳單打開，bill.notice（週日晚上的提醒）顯示成通知 ----
// 看的是「這一步提交新產生的報告」（store 的 feed），不是紀錄的最後幾份：報告 id 每一局從 r1 起算，讀檔也不該把舊的再觸發一次。
watch(() => eng.feed.seq, () => {
  const fx = freshEffects(eng.feed.reports)
  if (fx.openBills) ui.open('bills', { settled: true })
  for (const t of fx.toasts) ui.toast(t, 'warn')
})

// ---- 引擎開了戰鬥（事件選項的 fight、戰敗劫囚、副本走到敵人那一格……）或有等著選的戰敗：全域換到戰鬥畫面（M2-ui-world 的 S1） ----
const BATTLE_ELSEWHERE = new Set(['/combat', '/netcombat', '/opinion', '/scene', '/title', '/newgame', '/editor', '/workshop'])
const battleRouter = useRouter()
watch(() => eng.inBattle || !!eng.pendingDefeat, (on) => {
  if (on && !BATTLE_ELSEWHERE.has(route.path)) void battleRouter.push({ path: '/combat', query: { from: route.fullPath } })
}, { immediate: true })
// 現實戰鬥與內海戰鬥是兩個網址、同一組元件：看引擎開的戰場在哪一層（battle.mode 對到的戰場 layer），不看網址參數；打到一半（讀檔、事件接戰鬥）也照這個換
const BATTLE_PAGES = { net: '/netcombat', meat: '/combat' } as const
watch(() => [eng.battleLayer(), route.path] as const, ([layer, path]) => {
  const want = layer === 'net' ? BATTLE_PAGES.net : layer ? BATTLE_PAGES.meat : null
  if (want && (path === '/combat' || path === '/netcombat') && path !== want) void battleRouter.replace({ path: want, query: route.query })
}, { immediate: true })

// ---- 引擎開了一趟網內的行程（委託副本的內海面、自己潛進去的）：畫面換到子網（M3-ui-commission-net）。照進行中的活動換，不照按鈕 ----
// 戰鬥、場景、標題與編輯器那幾頁自己管（打完戰鬥會回來）；讀檔讀到一半在網內的也一樣落到子網頁。
const NET_ELSEWHERE = new Set([...BATTLE_ELSEWHERE, '/subnet'])
const netRouter = useRouter()
watch(() => eng.net.view()?.id ?? null, (id) => {
  if (id && !NET_ELSEWHERE.has(route.path)) void netRouter.push('/subnet')
}, { immediate: true })

// ---- 簾後館落幕之後（M4-ui-curtain）：引擎有等著處理的一筆（補演的確認、三條路）就把簾後館的對話框打開；戰鬥、場景、標題那幾頁自己管（回到主畫面時再開） ----
watch(() => [eng.curtain.fall()?.step ?? null, route.path] as const, ([step, path]) => {
  if (step && !BATTLE_ELSEWHERE.has(path) && !eng.inBattle && !eng.scene.active() && ui.top?.name !== 'curtain') ui.openRoot('curtain')
}, { immediate: true, flush: 'post' })

// ---- 成人場景進行中：畫面換到場景，別的全頁的入口被擋（引擎也不收別的報告；這裡只是不讓人停在別的畫面上） ----
const sceneRouter = useRouter()
watch(() => eng.scene.active(), (on) => {
  if (on && route.path !== '/scene') void sceneRouter.push({ path: '/scene', query: { from: route.fullPath } })
}, { immediate: true })
sceneRouter.beforeEach((to, from) => {
  if (!eng.scene.active() || to.path === '/scene' || to.path === '/title' || to.path === '/newgame') return true
  return { path: '/scene', query: { from: from.path === '/scene' ? (from.query.from as string | undefined) ?? '/' : from.fullPath } }
})

// ---- 全域快捷鍵（UI.md 1.1 節、lib/keys.ts）：不必先點地圖；打字時與對話框開著時不走 ----
const router = useRouter()
const IN_GAME = new Set(['/', '/home', '/subnet', '/dungeon'])
function onKey(e: KeyboardEvent) {
  if (e.defaultPrevented) return // 畫面自己處理掉的（例：家園擺設時的 R 與 Esc）
  const a = keyAction(e, {
    typing: isTyping(e.target), dialogOpen: ui.stack.length > 0 || eng.event.view() !== null, canMove: !!ui.mover && !ui.menuOpen,
    inGame: IN_GAME.has(route.path), onMain: route.path === '/',
  })
  if (!a) return
  e.preventDefault()
  switch (a.type) {
    case 'escape':
      if (ui.menuOpen) ui.menuOpen = false
      else if (ui.stack.length) ui.close()
      else if (route.path !== '/title') ui.menuOpen = true
      break
    case 'move': ui.mover?.step({ x: a.dx, y: a.dy }); break
    case 'interact': ui.mover?.interact(); break
    case 'city': ui.openRoot('city'); break
    case 'home': if (route.path !== '/home') router.push('/home'); break
    case 'dialog': ui.openRoot(a.name); break
    case 'quicksave': { useSaves().autosave(); ui.toast('快速存檔：存進了自動格。'); break }
    case 'quickload': { const err = useSaves().loadFrom('autos', 0); ui.toast(err ?? '快速讀檔：讀回最新的自動格。', err ? 'warn' : 'info'); break }
  }
}
onMounted(() => window.addEventListener('keydown', onKey))
onBeforeUnmount(() => window.removeEventListener('keydown', onKey))
// 內海皮：子網、內海戰鬥的頁面、內海的成人場景（引擎的場景資料 layer 是 net）；戰鬥頁看引擎開的是哪一層的戰場（現實戰鬥頁上打的若是內海的戰鬥，也是內海皮）
const NET_PAGES = new Set(['/subnet', '/netcombat'])
// 潛入中（意識在內海，身體躺在接入艙）：主畫面等現實的頁面也套內海皮（M3-ui-dive）；登出就換回來
const diving = computed(() => eng.dive.view().diving)
const netSkin = computed(() => (route.path === '/combat' || route.path === '/netcombat' ? (eng.inBattle ? eng.battleLayer() === 'net' : route.path === '/netcombat') : route.path === '/scene' ? eng.scene.view()?.layer === 'net' : NET_PAGES.has(route.path) || (diving.value && route.path !== '/title' && route.path !== '/newgame')))
const skin = computed(() => (netSkin.value ? 'net' : 'real'))
watchEffect(() => {
  document.documentElement.dataset.skin = skin.value
  document.documentElement.dataset.district = netSkin.value ? 'net' : g.loc.district
})
</script>

<template>
  <RouterView />
  <DialogHost />
</template>
