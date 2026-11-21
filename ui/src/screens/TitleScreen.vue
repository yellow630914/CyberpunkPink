<script setup lang="ts">
import { onBeforeUnmount, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import Logo from '../components/Logo.vue'
import Hint from '../components/Hint.vue'
import { useGame } from '../stores/game'
import { useSaves } from '../stores/saves'
import { useSettings } from '../stores/settings'
import { useUi } from '../stores/ui'

/**
 * 標題畫面（樣稿 docs/mockups/title.html 的「標題」）：繼續、新遊戲、讀檔、匯入存檔、世界編輯器、設定；右邊是上一次玩到哪裡。
 * 讀檔與設定是疊在標題上的對話框；新遊戲與世界編輯器換全頁。
 */
const router = useRouter()
const g = useGame()
const sv = useSaves()
const st = useSettings()
const ui = useUi()
const nSaves = () => sv.slots.filter(Boolean).length
const nAuto = () => sv.autos.filter(Boolean).length
/** Enter 繼續（沒有對話框開著、焦點不在別的按鈕上時）。 */
function onKey(e: KeyboardEvent) {
  if (e.key !== 'Enter' || ui.stack.length) return
  const t = e.target as HTMLElement
  if (t && t.closest('button, input, select, textarea, a')) return
  router.push('/')
}
onMounted(() => window.addEventListener('keydown', onKey))
onBeforeUnmount(() => window.removeEventListener('keydown', onKey))
</script>

<template>
  <div class="title">
    <div class="bg" aria-hidden="true" />
    <main class="tm">
      <section class="hero">
        <div class="brand"><Logo /><span>CYBERPUNK PINK</span></div>
        <h1>緋　夜　城</h1>
        <p class="yr mono">2069 · 自由市</p>
        <nav class="menu" aria-label="標題選單">
          <button type="button" class="mi pri" @click="router.push('/')"><b>繼續</b><small>夜班之後・第 {{ g.day }} 天 {{ g.timeLabel }}・{{ g.district.name }}</small><kbd>ENTER</kbd></button>
          <button type="button" class="mi" @click="router.push('/newgame')"><b>新遊戲</b><small>選世界與內容篩選，再建角；難度在建角的最後一步</small></button>
          <button type="button" class="mi" @click="ui.openRoot('saves')"><b>讀檔</b><small>{{ nSaves() }} 個存檔、{{ nAuto() }} 個自動存檔</small></button>
          <button type="button" class="mi" @click="ui.openRoot('saves', { tab: 'io' })"><b>匯入存檔</b><small>讀一個從別台機器匯出的檔案</small></button>
          <button type="button" class="mi" @click="router.push('/editor')"><b>世界編輯器</b><small>做自己的世界包</small></button>
          <button type="button" class="mi" @click="ui.openRoot('settings')"><b>設定</b><small>AI 來源、內容篩選與顯示</small></button>
        </nav>
        <p class="notice">本作含成人內容，只供年滿 18 歲的玩家遊玩。<b>遊戲裡所有的角色都是成年人。</b></p>
        <p class="ver mono">v0.1 · 存檔格式 2 · 基本世界 2026-11-20</p>
      </section>
      <aside class="panel cut pad last">
        <p class="h">上一次玩到這裡<Hint>這是瀏覽器裡現在這一局。讀檔會換成別的存檔。</Hint></p>
        <p class="place">{{ g.district.name }}</p>
        <h2>夜班之後</h2>
        <div class="kv"><span>主角</span><b>{{ g.character.origin }}・{{ g.character.trees.join('／') }}</b></div>
        <div class="kv"><span>時間</span><b>第 {{ g.day }} 天 {{ g.weekday }} {{ g.timeLabel }}</b></div>
        <div class="kv"><span>手上的委託</span><b>藍鯨的帳本・階段 ②</b></div>
        <div class="kv"><span>難度</span><b>{{ st.s.difficulty }}</b></div>
        <div class="go"><button type="button" class="btn pri" @click="router.push('/')">繼續</button></div>
      </aside>
    </main>
  </div>
</template>

<style scoped>
.title { min-height: 100vh; min-height: 100dvh; position: relative; overflow: hidden; display: grid; }
.bg { position: absolute; inset: 0; background: radial-gradient(ellipse at 70% 20%, color-mix(in srgb, var(--a) 22%, transparent), transparent 60%), radial-gradient(ellipse at 10% 90%, color-mix(in srgb, var(--b) 25%, transparent), transparent 55%); pointer-events: none; }
.tm { position: relative; display: grid; grid-template-columns: minmax(0, 1fr) 340px; gap: 32px; align-items: center; padding: 48px clamp(16px, 6vw, 96px); max-width: 1280px; margin: 0 auto; width: 100%; }
.brand { display: flex; gap: 10px; align-items: center; font-weight: 900; letter-spacing: 3px; color: var(--ink-2); }
h1 { font-size: clamp(40px, 7vw, 76px); margin: 12px 0 0; letter-spacing: 6px; color: var(--ink); text-shadow: 0 0 24px color-mix(in srgb, var(--a) 60%, transparent); }
.yr { color: var(--a-hi); margin: 4px 0 24px; letter-spacing: 4px; }
.menu { display: grid; gap: 6px; max-width: 520px; }
.mi { display: grid; grid-template-columns: 1fr auto; text-align: left; padding: 12px 16px; background: var(--bg-1); border: 0; color: var(--ink); cursor: pointer; box-shadow: inset 0 0 0 2px var(--line); clip-path: polygon(0 0, calc(100% - 10px) 0, 100% 10px, 100% 100%, 10px 100%, 0 calc(100% - 10px)); }
.mi b { font-size: var(--fs-lg); }
.mi small { grid-column: 1; color: var(--ink-3); font-size: var(--fs-sm); }
.mi kbd { grid-row: 1 / span 2; grid-column: 2; align-self: center; font: 800 var(--fs-tiny) var(--mono); color: var(--ink-3); }
.mi:hover, .mi:focus-visible { box-shadow: inset 0 0 0 2px var(--a); }
.mi.pri { background: var(--a); color: #fff; box-shadow: none; }
.mi.pri small, .mi.pri kbd { color: #ffe3ef; }
.notice { font-size: var(--fs-sm); color: var(--ink-3); margin-top: 24px; max-width: 520px; }
.notice b { color: var(--ink-2); }
.ver { font-size: var(--fs-fine); color: var(--ink-3); }
.last h2 { margin: 0 0 8px; font-size: var(--fs-page); }
.place { margin: 0; color: var(--a-hi); font-weight: 800; font-size: var(--fs-sm); letter-spacing: 2px; }
@media (max-width: 900px) { .tm { grid-template-columns: 1fr; padding: 32px 16px; } }
</style>
