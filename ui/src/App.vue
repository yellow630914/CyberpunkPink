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
const NET_PAGES = new Set(['/subnet', '/netcombat'])
const skin = computed(() => (NET_PAGES.has(route.path) ? 'net' : 'real'))
watchEffect(() => {
  document.documentElement.dataset.skin = skin.value
  document.documentElement.dataset.district = NET_PAGES.has(route.path) ? 'net' : g.loc.district
})
</script>

<template>
  <RouterView />
  <DialogHost />
</template>
