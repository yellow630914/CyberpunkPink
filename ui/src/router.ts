import { createRouter, createWebHashHistory } from 'vue-router'

/**
 * 全頁（UI 規則 2）。對話框不在路由裡：它們疊在目前的全頁上（stores/ui.ts）。
 * 用 hash 路由：dist/ 放在任何路徑底下、直接用靜態伺服器打開都能用。
 */
export interface FullPage { path: string; name: string; legacy?: string; pending?: string }

export const FULL_PAGES: FullPage[] = [
  { path: '/', name: '主畫面與城市地圖' },
  { path: '/home', name: '家園地圖' },
  { path: '/subnet', name: '子網地圖' },
  { path: '/dungeon', name: '地下城：垃圾滑道' },
  { path: '/demo/combat', name: '現實戰鬥', legacy: 'combat-demo.html' },
  { path: '/demo/net', name: '內海戰鬥', legacy: 'net-demo.html' },
  { path: '/demo/opinion', name: '輿論戰', legacy: 'opinion-demo.html' },
  { path: '/demo/adult', name: '成人場景', legacy: 'adult-scene.html' },
  { path: '/editor', name: '世界編輯器', pending: '世界編輯器在第二版做；先看 docs/mockups/world-editor.html。' },
  { path: '/workshop', name: 'AI 工坊', pending: 'AI 工坊在第二版做；先看 docs/mockups/ai-workshop.html。' },
  { path: '/newgame', name: '建角', pending: '建角在第二版做；先看 docs/mockups/workshop.html 的「建角」分頁。' },
]

export const router = createRouter({
  history: createWebHashHistory(),
  routes: [
    { path: '/', component: () => import('./screens/MainScreen.vue') },
    { path: '/home', component: () => import('./screens/HomeScreen.vue') },
    { path: '/subnet', component: () => import('./screens/SubnetScreen.vue') },
    { path: '/dungeon', component: () => import('./screens/DungeonScreen.vue') },
    { path: '/demo/:demo', component: () => import('./screens/LegacyScreen.vue'), props: true },
    { path: '/:rest(.*)*', redirect: '/' },
  ],
  scrollBehavior: () => ({ top: 0 }),
})
