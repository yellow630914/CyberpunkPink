import { createRouter, createWebHashHistory } from 'vue-router'

/**
 * 全頁（UI 規則 2）。對話框不在路由裡：它們疊在目前的全頁上（stores/ui.ts）。
 * 用 hash 路由：dist/ 放在任何路徑底下、直接用靜態伺服器打開都能用。
 */
export interface FullPage { path: string; name: string; legacy?: string; pending?: string }

export const FULL_PAGES: FullPage[] = [
  { path: '/title', name: '標題畫面' },
  { path: '/', name: '主畫面與城市地圖' },
  { path: '/home', name: '家園地圖' },
  { path: '/subnet', name: '子網地圖' },
  { path: '/dungeon', name: '地下城：垃圾滑道' },
  { path: '/commission', name: '委託' },
  { path: '/combat', name: '現實戰鬥' },
  { path: '/netcombat', name: '內海戰鬥' },
  { path: '/opinion', name: '輿論戰' },
  { path: '/scene', name: '成人場景' },
  { path: '/newgame', name: '開新局與建角' },
  { path: '/editor', name: '世界編輯器' },
  { path: '/workshop', name: 'AI 工坊' },
]

export const router = createRouter({
  history: createWebHashHistory(),
  routes: [
    { path: '/', component: () => import('./screens/MainScreen.vue') },
    { path: '/title', component: () => import('./screens/TitleScreen.vue') },
    { path: '/newgame', component: () => import('./screens/NewGameScreen.vue') },
    { path: '/editor', component: () => import('./screens/WorldEditorScreen.vue') },
    { path: '/workshop', component: () => import('./screens/AiWorkshopScreen.vue') },
    { path: '/home', component: () => import('./screens/HomeScreen.vue') },
    { path: '/subnet', component: () => import('./screens/SubnetScreen.vue') },
    { path: '/dungeon', component: () => import('./screens/DungeonScreen.vue') },
    { path: '/commission', component: () => import('./screens/CommissionScreen.vue') },
    { path: '/combat', component: () => import('./screens/CombatScreen.vue') },
    { path: '/netcombat', component: () => import('./screens/NetCombatScreen.vue') },
    { path: '/opinion', component: () => import('./screens/OpinionScreen.vue') },
    { path: '/scene', component: () => import('./screens/AdultSceneScreen.vue') },
    // 第三版把三個戰場、第四版把成人場景重做成元件；舊的 iframe 路由轉到新的畫面（public/legacy/ 的檔案還在，只是不再連過去）
    { path: '/demo/combat', redirect: '/combat' },
    { path: '/demo/net', redirect: '/netcombat' },
    { path: '/demo/opinion', redirect: '/opinion' },
    { path: '/demo/adult', redirect: '/scene' },
    { path: '/:rest(.*)*', redirect: '/' },
  ],
  scrollBehavior: () => ({ top: 0 }),
})
