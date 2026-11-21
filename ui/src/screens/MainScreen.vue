
<script setup lang="ts">
import { computed, ref } from 'vue'
import { useRouter } from 'vue-router'
import StatusBar from '../components/StatusBar.vue'
import GridMap, { type CellView, type MapToken } from '../components/GridMap.vue'
import CityMap from '../components/CityMap.vue'
import LogView from '../components/LogView.vue'
import PartyRow from '../components/PartyRow.vue'
import Hint from '../components/Hint.vue'
import Icon from '../components/Icon.vue'
import Tabs from '../components/Tabs.vue'
import MoneyTag from '../components/MoneyTag.vue'
import { useGame } from '../stores/game'
import { useUi, PENDING_DIALOGS } from '../stores/ui'
import { useWalk } from '../lib/useWalk'
import type { DistrictId, Point, Facility } from '../data/types'
import { NPCS } from '../data/npcs'

/**
 * 主畫面（UI.md 第 3 節）：左欄地圖（街區／城市）、小隊、委託條；中欄工具列、紀錄、行動列；右欄這裡的人、地點、進行中。
 * 手機：上面狀態列，下面四個分頁（地圖、紀錄、這裡、工具）。
 */
const g = useGame()
const ui = useUi()
const router = useRouter()
const mapTab = ref<'block' | 'city'>('block')
const mobileTab = ref<'map' | 'log' | 'here' | 'tools'>('log')
const freeText = ref('')

// ---- 街區格子 ----
const bm = computed(() => g.blockMap)
const passable = (x: number, y: number) => { const c = bm.value.cells[y]?.[x]; return c !== undefined && c !== '#' }
const { path, walkTo } = useWalk({
  grid: () => ({ w: bm.value.w, h: bm.value.h, passable }),
  pos: () => g.loc.pos,
  step: p => { g.loc.pos = p; g.advance(1) },
})
function cellView(x: number, y: number): CellView {
  const c = bm.value.cells[y][x]
  const k = `${x},${y}`
  const f = bm.value.facilityAt.get(k)
  if (f) return { kind: 'fac', icon: f.icon, title: f.name, tint: f.id === g.loc.facility ? 'var(--a)' : undefined }
  const ex = bm.value.exitAt.get(k)
  if (ex) return { kind: 'exit', mark: '→', title: `往${ex}` }
  return { kind: c === '#' ? 'building' : 'street' }
}
const tokens = computed<MapToken[]>(() => {
  const t: MapToken[] = [{ id: 'me', x: g.loc.pos.x, y: g.loc.pos.y, label: '你', kind: 'me' }]
  for (const [k, f] of bm.value.facilityAt) for (const id of f.npcIds ?? []) {
    const [x, y] = k.split(',').map(Number)
    if (x === g.loc.pos.x && y === g.loc.pos.y) continue
    t.push({ id, x, y, label: NPCS[id].name.slice(0, 1), kind: 'npc', title: NPCS[id].name })
  }
  return t
})
function onCell(p: Point) {
  const k = `${p.x},${p.y}`
  const f = bm.value.facilityAt.get(k)
  const ex = bm.value.exitAt.get(k)
  if (!passable(p.x, p.y)) return
  g.setFacility(null)
  const from = g.loc.block
  walkTo(p, () => {
    if (f) { g.setFacility(f.id); mobileTab.value = window.innerWidth <= 720 ? 'here' : mobileTab.value }
    else if (ex) {
      const d = g.district.blocks.includes(ex) ? g.loc.district : g.loc.district
      g.moveBlock(d, ex, from)
    }
  })
}
function goCity(d: DistrictId, block: string) {
  const from = g.loc.block
  if (d !== g.loc.district || block !== g.loc.block) { g.advance(d === g.loc.district ? 8 : 20); g.moveBlock(d, block, from) }
  mapTab.value = 'block'
}

// ---- 這裡 ----
const people = computed(() => (g.facility?.npcIds ?? []).map(id => g.npcs[id]))
function service(f: Facility, s: NonNullable<Facility['services']>[number]) {
  switch (s.action) {
    case 'shop': ui.openRoot('shop', { shopId: f.shopId }); break
    case 'home': router.push('/home'); break
    case 'dungeon': router.push('/dungeon'); break
    case 'rest': g.advance(60); g.addLog({ prose: [`你在${f.name}待了一個小時，感載退了一些。`], changes: [{ text: '感載 −3', kind: 'plus' }] }); g.character.load[0] = Math.max(0, g.character.load[0] - 3); break
    default: ui.toast(`「${s.name}」的畫面在第二版做。`)
  }
}

// ---- 工具列 ----
const tools = [
  { id: 'character', name: '角色', icon: 'ic-bs_resolve' },
  { id: 'bag', name: '背包', icon: 'ic-cargo' },
  { id: '名冊', name: '名冊', icon: 'ic-bs_negotiate' },
  { id: '關係', name: '關係', icon: 'ic-bs_seduce', badge: 1 },
  { id: '備忘錄', name: '備忘錄', icon: 'ic-bs_investigate' },
  { id: '組裝', name: '組裝', icon: 'ic-tool' },
  { id: '頻道', name: '頻道', icon: 'ic-footage', badge: 2 },
  { id: 'home', name: '家園', icon: 'ic-fac_home' },
  { id: '契約', name: '契約', icon: 'ic-bs_perform' },
]
function tool(id: string) {
  if (id === 'character' || id === 'bag') ui.openRoot(id)
  else if (id === 'home') router.push('/home')
  else if ((PENDING_DIALOGS as readonly string[]).includes(id)) ui.toast(`「${id}」的對話框在第二版做。`, 'warn')
}

// ---- 行動列 ----
function freeAction() {
  const text = freeText.value.trim()
  if (!text) { ui.toast('先寫下想做什麼。', 'warn'); return }
  const die = 1 + Math.floor(Math.random() * 20)
  const mod = 5, dc = 13
  const res = die === 20 ? '大成功' : die === 1 ? '大失敗' : die + mod >= dc ? '成功' : '失敗'
  g.advance(20)
  g.addLog({ prose: [`你決定：${text}`, 'AI 關著，這裡先用戰報代替正文。'], roll: { skill: '街頭直覺', die, mod, dc, result: res }, changes: res.includes('成功') ? [{ text: '傳聞 +1', kind: 'plus' }] : [] })
  freeText.value = ''
  mobileTab.value = 'log'
}

const stages = [
  { name: '踩點', face: ['m'], state: 'done' },
  { name: '潛入子網', face: ['n'], state: 'now' },
  { name: '第三倉', face: ['m', 'n'], state: '' },
  { name: '收尾', face: ['m', 'o'], state: '' },
]
</script>

<template>
  <div class="screen">
    <StatusBar />
    <div class="main" :data-mtab="mobileTab">
      <!-- 左欄 -->
      <div class="col left">
        <section class="panel cut map pad">
          <span class="tick" />
          <div class="maphd">
            <Tabs v-model="mapTab" :tabs="[{ id: 'block', label: '街區' }, { id: 'city', label: '城市' }]" />
            <Hint title="地圖">街區是 13 × 9 的格子：點設施走過去，到了右欄「這裡」換成那個設施；點邊上的箭頭換街區。城市地圖點區、再點街區就過去。</Hint>
          </div>
          <template v-if="mapTab === 'block'">
            <p class="h">{{ g.district.name }}・{{ g.loc.block }}</p>
            <GridMap :w="bm.w" :h="bm.h" :cell="cellView" :tokens="tokens" :path="path" :max-cell="30" :label="`${g.loc.block}的街區圖`" @cell="onCell" />
            <div class="legend"><span><i class="lg fac" />設施</span><span><i class="lg exit" />出口</span><span><i class="lg me" />你</span><span><i class="lg npc" />人</span></div>
          </template>
          <CityMap v-else :current="g.loc.district" :current-block="g.loc.block" @go="goCity" />
        </section>
        <section class="panel cut pad party">
          <p class="h">小隊</p>
          <PartyRow v-for="m in g.party" :key="m.id" :m="m" />
        </section>
        <section class="panel cut pad job">
          <p class="h">委託<Hint title="委託條">進行中的委託與它的階段。每一格寫階段名與可選的面（灰是現實、薄荷是內海、紫是輿論），現在的那格是粉色。點「潛入子網」進子網地圖。</Hint></p>
          <b>藍鯨的帳本</b> <span class="tag">竊取・中型</span> <span class="tag">夢露</span>
          <div class="stages">
            <button v-for="s in stages" :key="s.name" type="button" class="stage" :class="s.state" @click="s.name === '潛入子網' ? router.push('/subnet') : ui.toast(`「${s.name}」的委託頁在第二版做。`)">
              {{ s.name }}<span class="faces"><i v-for="f in s.face" :key="f" :class="f" /></span>
            </button>
          </div>
        </section>
      </div>

      <!-- 中欄 -->
      <div class="col center">
        <nav class="panel cut tools" aria-label="工具列">
          <button v-for="t in tools" :key="t.id" type="button" class="tool" :aria-disabled="(PENDING_DIALOGS as readonly string[]).includes(t.id) || undefined" @click="tool(t.id)">
            <Icon :id="t.icon" :size="18" fit />{{ t.name }}<span v-if="t.badge" class="badge">{{ t.badge }}</span>
          </button>
        </nav>
        <section class="panel cut logp"><LogView :entries="g.log" /></section>
        <section class="panel cut act">
          <form class="input" @submit.prevent="freeAction">
            <span class="die" aria-hidden="true" />
            <label class="sr-only" for="free">自由行動</label>
            <input id="free" v-model="freeText" placeholder="自由行動：想做什麼……" autocomplete="off">
            <button class="btn pri sm" type="submit">擲骰</button>
          </form>
          <div class="ctx">
            <button type="button" class="btn" @click="g.advance(60); g.addLog({ prose: ['你找個地方坐下來喘口氣。'] })">休息</button>
            <button type="button" class="btn" @click="router.push('/subnet')">潛入</button>
            <button type="button" class="btn" aria-disabled="true" @click="ui.toast('要在據點或有訊號的地方才能直播；頻道的畫面在第二版做。', 'warn')">直播</button>
          </div>
        </section>
      </div>

      <!-- 右欄 -->
      <div class="col right">
        <section class="panel cut pad here">
          <p class="h">這裡的人</p>
          <div v-if="!people.length" class="empty-note">這裡沒有認識的人。</div>
          <div v-for="n in people" :key="n.id" class="person">
            <div class="ava" aria-hidden="true" />
            <div>
              <b>{{ n.name }}</b> <span class="fac-tag">{{ n.district }}</span>
              <div class="r">{{ n.identity }}</div>
              <div class="heart">♥ {{ n.affinity }} {{ n.stage }}</div>
              <div class="acts">
                <button type="button" class="hot" @click="ui.openRoot('talk', { npcId: n.id })">談</button>
                <button type="button" @click="ui.toast('主動行動在第二版做。')">主動行動</button>
              </div>
            </div>
          </div>
        </section>
        <section class="panel cut pad">
          <p class="h">地點<template v-if="g.facility">：{{ g.facility.name }}</template></p>
          <div v-if="!g.facility" class="empty-note">在街區圖上點一個設施走過去。</div>
          <template v-else>
            <button v-for="s in g.facility.services ?? []" :key="s.name" type="button" class="svc" @click="service(g.facility!, s)">
              <span>{{ s.name }}</span><MoneyTag v-if="s.price" kind="cash" :amount="s.price" :size="13" />
            </button>
            <div v-if="!(g.facility.services ?? []).length" class="empty-note">這個設施沒有可以用的服務。</div>
          </template>
        </section>
        <section class="panel cut pad">
          <p class="h">進行中</p>
          <div class="ong"><span class="k2" style="background: var(--ap)">委託</span>藍鯨的帳本<small>第 2 階段・期限 2 天</small></div>
          <div class="ong"><span class="k2" style="background: var(--ep)">人情</span>小麥欠你 1<small>小人情</small></div>
          <div class="ong"><span class="k2" style="background: var(--warn)">帳單</span>{{ g.billIn }} 天後收租<small>帳戶要付 2,060</small></div>
        </section>
      </div>

      <!-- 手機：工具 -->
      <div class="col mtools">
        <section class="panel cut pad">
          <p class="h">工具</p>
          <div class="tgrid">
            <button v-for="t in tools" :key="t.id" type="button" class="tool" :aria-disabled="(PENDING_DIALOGS as readonly string[]).includes(t.id) || undefined" @click="tool(t.id)"><Icon :id="t.icon" :size="22" fit />{{ t.name }}</button>
            <button type="button" class="tool" @click="router.push('/subnet')"><Icon id="ic-net_hack" :size="22" fit />子網</button>
            <button type="button" class="tool" @click="router.push('/dungeon')"><Icon id="ic-fac_under" :size="22" fit />地下城</button>
            <button type="button" class="tool" @click="ui.openRoot('settings')"><Icon id="ic-tool" :size="22" fit />設定</button>
          </div>
        </section>
      </div>
    </div>
    <nav class="mtabs" aria-label="主畫面的分頁">
      <button v-for="t in [{ id: 'map', n: '地圖' }, { id: 'log', n: '紀錄' }, { id: 'here', n: '這裡' }, { id: 'tools', n: '工具' }] as const" :key="t.id" type="button" class="mtab" :class="{ on: mobileTab === t.id }" @click="mobileTab = t.id">{{ t.n }}</button>
    </nav>
  </div>
</template>

<style scoped>
.screen { height: 100vh; height: 100dvh; display: flex; flex-direction: column; }
.main { flex: 1; min-height: 0; display: grid; grid-template-columns: 360px minmax(0, 1fr) 330px; gap: 12px; padding: 12px; }
.col { display: flex; flex-direction: column; gap: 12px; min-height: 0; min-width: 0; overflow: auto; }
.mtools { display: none; }
.maphd { display: flex; align-items: center; justify-content: space-between; gap: 8px; margin-bottom: 8px; }
.legend { display: flex; gap: 10px; flex-wrap: wrap; margin-top: 8px; font-size: 11px; color: var(--ink-3); }
.lg { display: inline-block; width: 10px; height: 10px; border-radius: 2px; margin-right: 4px; vertical-align: -1px; }
.lg.fac { background: var(--tile-fac); } .lg.exit { box-shadow: inset 0 0 0 2px var(--b); } .lg.me { background: var(--a); border-radius: 50%; } .lg.npc { background: var(--c); border-radius: 50%; }
.stages { display: flex; gap: 6px; margin-top: 8px; }
.stage { flex: 1; padding: 6px 6px 7px; background: var(--bg-2); font-size: 11px; color: var(--ink-3); font-weight: 700; border: 0; text-align: left; cursor: pointer; min-width: 0; }
.stage.done { background: #3A2B47; color: var(--ink-2); }
.stage.now { background: var(--a); color: #fff; }
.faces { display: flex; gap: 4px; margin-top: 4px; }
.faces i { width: 16px; height: 5px; border-radius: 2px; background: #ffffff22; }
.faces i.m { background: var(--ink-2); } .faces i.n { background: var(--net); } .faces i.o { background: var(--ep); }
.tools { display: flex; gap: 6px; padding: 8px; flex-wrap: wrap; flex: none; }
.tool { display: flex; align-items: center; gap: 6px; padding: 7px 12px; background: var(--bg-2); font-weight: 800; font-size: 13px; color: var(--ink-2); position: relative; border: 0; cursor: pointer; clip-path: polygon(0 0, calc(100% - 7px) 0, 100% 7px, 100% 100%, 7px 100%, 0 calc(100% - 7px)); }
.tool:hover { background: var(--bg-3); color: var(--ink); }
.tool[aria-disabled="true"] { opacity: .5; }
.tool .badge { min-width: 16px; height: 16px; border-radius: 8px; background: var(--a); color: #fff; font-size: 10px; font-weight: 900; display: grid; place-items: center; padding: 0 4px; }
.logp { flex: 1; min-height: 0; overflow: auto; padding: 4px 18px 10px; }
.act { padding: 10px; display: grid; grid-template-columns: 1fr auto; gap: 10px; align-items: center; flex: none; }
.input { display: flex; align-items: center; gap: 10px; padding: 8px 10px; background: var(--bg-term); box-shadow: inset 0 0 0 2px var(--line); min-width: 0; }
.input input { flex: 1; min-width: 0; background: transparent; border: 0; color: var(--ink); font: 500 15px var(--font); outline: none; }
.input input::placeholder { color: var(--ink-3); }
.die { width: 24px; height: 24px; flex: none; background: var(--a); clip-path: polygon(50% 0, 100% 25%, 100% 75%, 50% 100%, 0 75%, 0 25%); }
.ctx { display: flex; gap: 6px; }
.person { display: grid; grid-template-columns: 44px 1fr; gap: 10px; align-items: start; padding: 8px; background: var(--bg-2); border-radius: 12px; margin-bottom: 8px; }
.person .ava { width: 44px; height: 44px; border-radius: 10px; background: var(--bg-1); position: relative; overflow: hidden; }
.person .ava::before { content: ""; position: absolute; left: 12px; top: 8px; width: 20px; height: 20px; border-radius: 50%; background: var(--b); }
.person .ava::after { content: ""; position: absolute; left: 5px; top: 28px; width: 34px; height: 22px; border-radius: 12px 12px 0 0; background: var(--b); }
.person .r { font-size: 11px; color: var(--ink-3); }
.heart { color: var(--a); font-size: 11px; font-weight: 800; }
.fac-tag { font-size: 10px; font-weight: 800; padding: 1px 6px; border-radius: 5px; background: #3A2B47; color: var(--ink-2); }
.acts { display: flex; gap: 5px; margin-top: 6px; flex-wrap: wrap; }
.acts button { font-size: 11px; font-weight: 800; padding: 4px 9px; border-radius: 7px; background: var(--bg-1); color: var(--ink-2); border: 0; cursor: pointer; }
.acts button.hot { background: var(--a); color: #fff; }
.svc { display: flex; justify-content: space-between; align-items: center; width: 100%; padding: 9px 10px; background: var(--bg-2); border-radius: 10px; margin-bottom: 6px; font-weight: 700; border: 0; cursor: pointer; color: var(--ink); font-size: 13px; }
.svc:hover { background: var(--bg-3); }
.ong { padding: 8px 10px; background: var(--bg-2); border-radius: 10px; margin-bottom: 6px; font-size: 13px; }
.ong small { display: block; color: var(--ink-3); font-size: 11px; margin-top: 2px; }
.k2 { font-size: 10px; font-weight: 900; padding: 1px 6px; border-radius: 5px; margin-right: 6px; color: #17111F; }
.mtabs { display: none; }
.tgrid { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 6px; }
.tgrid .tool { flex-direction: column; padding: 12px 6px; justify-content: center; }

@media (max-width: 1380px) { .main { grid-template-columns: 320px minmax(0, 1fr) 300px; } }
@media (max-width: 1180px) and (min-width: 721px) {
  .main { grid-template-columns: 300px minmax(0, 1fr); grid-template-rows: minmax(0, 1fr) auto; }
  .left { grid-row: 1 / span 2; }
  .right { grid-column: 2; grid-row: 2; flex-direction: row; max-height: 34vh; }
  .right > section { flex: 1; overflow: auto; }
}
@media (max-width: 720px) {
  .main { display: block; padding: 8px; overflow: auto; }
  .col { display: none; overflow: visible; }
  .main[data-mtab="map"] .left, .main[data-mtab="log"] .center, .main[data-mtab="here"] .right, .main[data-mtab="tools"] .mtools { display: flex; }
  .center .tools { display: none; }
  .logp { overflow: visible; }
  .act { grid-template-columns: 1fr; }
  .ctx .btn { flex: 1; justify-content: center; }
  .mtabs { display: grid; grid-template-columns: repeat(4, 1fr); background: var(--bg-term); border-top: 2px solid var(--line); flex: none; }
  .mtab { display: grid; place-items: center; padding: 12px 0 14px; font-size: 13px; font-weight: 800; color: var(--ink-3); position: relative; border: 0; background: none; cursor: pointer; }
  .mtab.on { color: var(--a); }
  .mtab.on::before { content: ""; position: absolute; top: 0; left: 30%; right: 30%; height: 3px; background: var(--a); border-radius: 0 0 3px 3px; }
}
</style>
