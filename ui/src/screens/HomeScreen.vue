
<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { useRoute } from 'vue-router'
import StatusBar from '../components/StatusBar.vue'
import GridMap, { type CellView, type MapObject, type MapToken, type MapArea } from '../components/GridMap.vue'
import Hint from '../components/Hint.vue'
import Tabs from '../components/Tabs.vue'
import ItemSlot from '../components/ItemSlot.vue'
import MoneyTag from '../components/MoneyTag.vue'
import ReasonButton from '../components/ReasonButton.vue'
import { useHome, TIER_CAPS } from '../stores/home'
import { useGame } from '../stores/game'
import { useUi } from '../stores/ui'
import { FURNITURE, FURNITURE_ITEM, HOME_TIER_SIZE } from '../data/home'
import { ITEMS } from '../data/items'
import { ROOM_USES, COMFORT_TIERS, footprint, type Rotation } from '../lib/home'
import { findPath } from '../lib/grid'
import type { Point } from '../data/types'

/**
 * 家園地圖（UI 規則 3）：和地下城同一套格子。等級決定地圖大小；房間是畫出來的區域；
 * 「走路」時點地板走過去，住戶與訪客自己走動；「擺設」時點家具選取、轉向、移動、收起，或從背包擺新的。
 * 房間的用途由裡面的家具推出來；舒適度、儲物、住戶在右欄。
 */
const h = useHome()
const g = useGame()
const ui = useUi()
const route = useRoute()
const mode = ref<'walk' | 'build'>('walk')
const selected = ref<string | null>(null)
/** 正在擺的東西：新的（來自背包的一疊）或搬動中的那一件 */
const placing = ref<{ kind: 'new'; uid: string; def: string; rot: Rotation } | { kind: 'move'; furn: string; def: string; rot: Rotation } | null>(null)
const hover = ref<Point | null>(null)
const lastReason = ref<string | null>(null)
const ROOM_COLORS: Record<string, string> = { M: '#8E7CC3', B: '#45D6C5', C: '#F2C14E', D: '#F06AA0' }
const useName = (id: string | null) => ROOM_USES.find(u => u.id === id)?.name ?? null

// ---- 走路 ----
const paths = new Map<string, Point[]>()
let ticker: ReturnType<typeof setInterval> | null = null
let wander: ReturnType<typeof setInterval> | null = null
const passable = (x: number, y: number) => h.grid.passable(x, y)
const occupiedByOther = (id: string, p: Point) => h.people.some(o => o.id !== id && o.pos.x === p.x && o.pos.y === p.y)
function walk(id: string, to: Point) {
  const p = h.people.find(x => x.id === id)!
  const path = findPath({ w: h.map.w, h: h.map.h, passable }, p.pos, to)
  if (path) paths.set(id, path.slice(1))
  return !!path
}
onMounted(() => {
  ticker = setInterval(() => {
    for (const [id, path] of paths) {
      const p = h.people.find(x => x.id === id)
      const next = path[0]
      if (!p || !next) { paths.delete(id); continue }
      if (occupiedByOther(id, next)) { if (id !== 'me') paths.delete(id); continue }
      p.pos = next
      path.shift()
      if (!path.length) paths.delete(id)
    }
  }, 160)
  wander = setInterval(() => {
    for (const p of h.people) {
      if (p.kind === 'me' || paths.has(p.id) || Math.random() < 0.4) continue
      const cand: Point[] = []
      for (let dy = -3; dy <= 3; dy++) for (let dx = -3; dx <= 3; dx++) { const x = p.pos.x + dx, y = p.pos.y + dy; if (passable(x, y) && h.map.kind(x, y) === 'room') cand.push({ x, y }) }
      if (cand.length) walk(p.id, cand[Math.floor(Math.random() * cand.length)])
    }
  }, 1800)
  window.addEventListener('keydown', onKey)
  const q = route.query.place
  if (typeof q === 'string') startNew(q)
})
onBeforeUnmount(() => { if (ticker) clearInterval(ticker); if (wander) clearInterval(wander); window.removeEventListener('keydown', onKey) })

// ---- 擺設 ----
const furnitureInBag = computed(() => g.inventory.filter(s => FURNITURE_ITEM[s.def]))
function startNew(uid: string) {
  const st = g.stackOf(uid)
  if (!st || !FURNITURE_ITEM[st.def]) return
  mode.value = 'build'
  selected.value = null
  placing.value = { kind: 'new', uid, def: FURNITURE_ITEM[st.def], rot: 0 }
}
function startMove() {
  const f = h.placed.find(p => p.uid === selected.value)
  if (!f) return
  if (FURNITURE[f.def].fixed) { ui.toast('浴廁的固定設備不能搬。', 'warn'); return }
  placing.value = { kind: 'move', furn: f.uid, def: f.def, rot: f.rot }
}
function rotate() {
  if (placing.value) { placing.value.rot = (((placing.value.rot + 90) % 360) as Rotation); return }
  const f = h.placed.find(p => p.uid === selected.value)
  if (!f) return
  if (FURNITURE[f.def].fixed) { ui.toast('浴廁的固定設備不能轉。', 'warn'); return }
  const r = h.move(f.uid, f.x, f.y, (((f.rot + 90) % 360) as Rotation))
  lastReason.value = r.ok ? null : r.reason
  if (!r.ok) ui.toast(`轉不過去：${r.reason}`, 'warn')
}
function putAway() {
  const f = h.placed.find(p => p.uid === selected.value)
  if (!f) return
  if (FURNITURE[f.def].fixed) { ui.toast('浴廁的固定設備不能收起。', 'warn'); return }
  const item = Object.entries(FURNITURE_ITEM).find(([, d]) => d === f.def)?.[0]
  h.remove(f.uid)
  if (item) g.addItem(item)
  ui.toast(`${FURNITURE[f.def].name}收進背包了。`)
  selected.value = null
}
function onKey(e: KeyboardEvent) {
  if (mode.value !== 'build') return
  if (e.key === 'r' || e.key === 'R') rotate()
  if (e.key === 'Escape' && placing.value) { placing.value = null; lastReason.value = null }
}
const ghost = computed<MapObject | null>(() => {
  if (!placing.value || !hover.value) return null
  const d = FURNITURE[placing.value.def]
  const fp = footprint(d, placing.value.rot)
  const cand = { uid: placing.value.kind === 'move' ? placing.value.furn : 'ghost', def: d.id, x: hover.value.x, y: hover.value.y, rot: placing.value.rot }
  const r = h.check(cand)
  return { id: 'ghost', x: cand.x, y: cand.y, w: fp.w, h: fp.h, label: r.ok ? d.name : r.reason, ghost: r.ok ? 'ok' : 'bad' }
})
const ghostReason = computed(() => (ghost.value?.ghost === 'bad' ? ghost.value.label : null))

function onCell(p: Point) {
  if (mode.value === 'walk') {
    if (!walk('me', p)) ui.toast('走不到那裡。', 'warn')
    return
  }
  if (placing.value) {
    const pl = placing.value
    const r = pl.kind === 'new' ? h.place(pl.def, p.x, p.y, pl.rot) : h.move(pl.furn, p.x, p.y, pl.rot)
    if (!r.ok) { lastReason.value = r.reason; ui.toast(r.reason, 'warn'); return }
    if (pl.kind === 'new') g.removeItem(pl.uid, 1)
    ui.toast(`${FURNITURE[pl.def].name}擺好了（${h.map.layout.rooms[r.room].name}）。`)
    lastReason.value = null
    placing.value = null
    return
  }
  selected.value = h.furnitureAt(p)?.uid ?? null
}
function onObject(id: string) {
  if (mode.value === 'walk') { const f = h.placed.find(p => p.uid === id); if (f) ui.toast(`${FURNITURE[f.def].name}：切到「擺設」才能動它。`); return }
  if (placing.value) return
  selected.value = id
}

// ---- 畫面資料 ----
function cellView(x: number, y: number): CellView {
  const k = h.map.kind(x, y)
  const room = h.map.roomAt(x, y)
  if (k === 'room') return { kind: 'floor', tint: ROOM_COLORS[room!] }
  if (k === 'entrance') return { kind: 'entrance', title: '大門' }
  if (k === 'door') return { kind: 'door', title: '門' }
  if (k === 'hall') return { kind: 'hall' }
  if (k === 'wall') return { kind: 'wall' }
  return { kind: 'void' }
}
const objects = computed<MapObject[]>(() => {
  const out: MapObject[] = h.placed
    .filter(f => !(placing.value?.kind === 'move' && placing.value.furn === f.uid))
    .map(f => { const d = FURNITURE[f.def]; const fp = footprint(d, f.rot); return { id: f.uid, x: f.x, y: f.y, w: fp.w, h: fp.h, label: d.name, icon: d.icon, rot: f.rot, selected: selected.value === f.uid, tone: d.fixed ? '#45D6C5' : undefined } })
  if (ghost.value) out.push(ghost.value)
  return out
})
const tokens = computed<MapToken[]>(() => h.people.map(p => ({ id: p.id, x: p.pos.x, y: p.pos.y, label: p.name.slice(0, 1), kind: p.kind, title: `${p.name}・${p.role}` })))
const areas = computed<MapArea[]>(() => h.rooms.map(r => { const b = h.map.roomBox(r.id); return { id: r.id, x: b.x, y: b.y, label: r.name, sub: useName(r.use) ?? '', color: ROOM_COLORS[r.id] } }))
const selFurn = computed(() => { const f = h.placed.find(p => p.uid === selected.value); return f ? { f, d: FURNITURE[f.def] } : null })
const comfortTier = computed(() => COMFORT_TIERS.find(t => t.name === h.comfortInfo.tier))
const nextTier = computed(() => COMFORT_TIERS.find(t => t.at > h.comfortInfo.total))
const caps = computed(() => TIER_CAPS[h.tier])
const upgradeCost = Math.round(3000 * 0.8)
function doUpgrade() {
  g.money.acc -= upgradeCost
  h.upgrade()
  g.addLog({ prose: ['你找何伯簽了擴建的單子：打通隔壁的空房，多兩間。'], changes: [{ text: `帳戶 −${upgradeCost.toLocaleString('en-US')}`, kind: 'minus' }] })
  ui.toast('升到二級了：地圖變大，多了第三間與第四間。')
}
function inviteZero() {
  if (h.people.some(p => p.id === 'zero')) return
  const bedRoom = h.rooms.find(r => r.id !== 'M' && r.furniture.some(f => FURNITURE[f.def].beds))
  h.people.push({ id: 'zero', name: '零', kind: 'ally', role: '留宿・忠誠 +1／週', pos: h.map.entrance(), sleeps: true, room: bedRoom?.id })
  ui.toast('零搬進來留宿了。')
}
const zeroReason = computed(() => (h.tier < 2 ? '留宿要二級以上的據點。' : h.residents.length >= caps.value.residents ? '住戶滿了。' : null))
const sideTab = ref('rooms')
</script>

<template>
  <div class="screen">
    <StatusBar back title="家園：四號塔的單位" />
    <div class="home">
      <section class="panel cut pad mapp">
        <div class="mh">
          <Tabs v-model="mode" :tabs="[{ id: 'walk', label: '走路' }, { id: 'build', label: '擺設' }]" @update:model-value="placing = null; selected = null" />
          <span class="k">{{ h.map.w }} × {{ h.map.h }}</span>
          <Hint title="家園地圖">走路：點地板，你會照最短的路走過去；住戶與訪客自己走動。擺設：點家具選取，可以轉向（R）、移動、收起；從右欄背包裡的家具擺新的。家具不能壓牆、擋門、跨兩間房、疊在一起，也不能把路堵死。</Hint>
        </div>
        <GridMap :w="h.map.w" :h="h.map.h" :cell="cellView" :objects="objects" :tokens="tokens" :areas="areas" :max-cell="62" label="家園的格子地圖"
          @cell="onCell" @object="onObject" @hover="p => (hover = p)" />
        <div v-if="mode === 'build'" class="buildbar">
          <template v-if="placing">
            <span class="tag hot">擺放：{{ FURNITURE[placing.def].name }}</span>
            <button type="button" class="btn sm" @click="rotate">轉向（R）</button>
            <button type="button" class="btn sm" @click="placing = null; lastReason = null">取消</button>
            <span v-if="ghostReason || lastReason" class="blocking">{{ ghostReason || lastReason }}</span>
          </template>
          <template v-else-if="selFurn">
            <span class="tag hot">{{ selFurn.d.name }}</span>
            <button type="button" class="btn sm" @click="rotate">轉向（R）</button>
            <button type="button" class="btn sm" @click="startMove">移動</button>
            <button type="button" class="btn sm" @click="putAway">收起</button>
            <span v-if="lastReason" class="blocking">{{ lastReason }}</span>
          </template>
          <span v-else class="k">點一件家具選取，或從右欄擺一件新的。</span>
        </div>
      </section>

      <aside class="side">
        <section class="panel cut pad">
          <div class="k">家・蜂巢・四號塔 7 樓</div>
          <h2>四號塔的單位</h2>
          <div class="chips"><span class="tag">{{ h.tier }} 級（上限 {{ h.maxTier }}）</span><span class="tag">{{ HOME_TIER_SIZE[h.tier] }}</span><span class="tag">隱蔽 1</span><span class="tag">週租 <MoneyTag kind="acc" :amount="150" :size="11" /></span>
            <Hint title="等級與地圖大小">0 級 7 × 5（不能擺設）、1 級 11 × 8、2 級 15 × 10、3 級是樓上 15 × 10 加一樓的店面。升級時地圖往外長，原本的房間與家具不動；工期 5 天，這一版直接完成。</Hint></div>
          <div class="go left">
            <ReasonButton sm pri :reason="h.tier >= h.maxTier ? '這個住處的上限是二級；要更大得搬家。' : g.money.acc < upgradeCost ? '帳戶不夠。' : null" @go="doUpgrade">升級（二級）<MoneyTag kind="acc" :amount="upgradeCost" :size="12" /></ReasonButton>
            <ReasonButton sm reason="搬家的畫面在第二版做。">搬家</ReasonButton>
          </div>
        </section>
        <section class="panel cut pad stats">
          <div class="stat"><span class="k">舒適度</span><b>{{ h.comfortInfo.total }}</b><small>{{ h.comfortInfo.tier ?? '—' }}</small>
            <Hint title="舒適度">
              <p>家具 {{ h.comfortInfo.furniture }}＋套組 {{ h.comfortInfo.sets }}＋臥室 {{ h.comfortInfo.bedrooms }}＋住處自帶 {{ h.comfortInfo.built }}＋住戶與家務 {{ h.comfortInfo.people }}−擁擠 {{ h.comfortInfo.crowding }}＝{{ h.comfortInfo.total }}。</p>
              <p>6 睡得好、12 精神飽滿、20 安穩，睡一覺之後取最高的那一段。{{ comfortTier ? `現在：${comfortTier.effect}。` : '' }}{{ nextTier ? `到 ${nextTier.at} 是${nextTier.name}。` : '' }}</p>
            </Hint></div>
          <div class="stat"><span class="k">儲物</span><b>{{ h.storageInfo.kinds }}</b><small>種＋保險箱 {{ h.storageInfo.safe }}</small><Hint title="儲物">容量以「種」算：不同名稱或狀態各算一種，數量不限。倉庫用途的房間容量 +25%。家被闖時，只有保險箱與暗格裡的東西安全。</Hint></div>
          <div class="stat"><span class="k">住戶</span><b>{{ h.residents.length }}／{{ caps.residents }}</b><small>床 {{ h.comfortInfo.beds }}・睡的人 {{ h.sleepers }}</small><Hint title="住戶">住戶要有床。住的人比床位多，每多一人舒適 −2。</Hint></div>
        </section>
        <section class="panel cut pad">
          <Tabs v-model="sideTab" :tabs="[{ id: 'rooms', label: '房間' }, { id: 'bag', label: '家具' }, { id: 'people', label: '人' }]" />
          <div v-if="sideTab === 'rooms'" class="rooms">
            <div v-for="r in h.rooms" :key="r.id" class="room" :style="{ '--rc': ROOM_COLORS[r.id] }">
              <div class="rh"><b>{{ r.name }}</b><span class="k">{{ r.cells }} 格・家具 {{ r.furniture.filter(f => !FURNITURE[f.def].fixed).length }}／{{ r.cap }}</span></div>
              <div class="ru">
                <template v-if="r.fixedUse"><span class="tag">{{ r.fixedUse }}</span></template>
                <template v-else-if="r.qualified.length > 1">
                  <label class="sr-only" :for="`use-${r.id}`">{{ r.name }}的用途</label>
                  <select :id="`use-${r.id}`" class="sel" :value="r.use ?? ''" @change="h.chosen[r.id] = ($event.target as HTMLSelectElement).value">
                    <option v-for="u in r.qualified" :key="u" :value="u">{{ useName(u) }}</option>
                  </select>
                </template>
                <span v-else-if="r.use" class="tag hot">{{ useName(r.use) }}</span>
                <span v-else class="tag">沒有用途</span>
                <Hint v-if="r.use" :title="useName(r.use)!" :text="`條件：${ROOM_USES.find(u => u.id === r.use)!.need}。效果：${ROOM_USES.find(u => u.id === r.use)!.effect}。`" />
                <Hint v-else-if="!r.fixedUse" title="用途從家具來">床→臥室、工作台→工作間、接入艙→接入室、手術椅→診療室、直播桌→攝影間、兩件儲物家具→倉庫。條件同時滿足好幾種時，自己選一種。</Hint>
              </div>
              <div class="chips"><button v-for="f in r.furniture" :key="f.uid" type="button" class="fchip" :class="{ on: selected === f.uid }" @click="mode = 'build'; selected = f.uid; placing = null">{{ FURNITURE[f.def].name }}</button></div>
            </div>
          </div>
          <div v-else-if="sideTab === 'bag'" class="fbag">
            <div v-if="!furnitureInBag.length" class="empty-note">背包裡沒有家具。</div>
            <div v-for="st in furnitureInBag" :key="st.uid" class="fb">
              <ItemSlot :item="ITEMS[st.def]" :qty="st.qty" size="sm" @select="startNew(st.uid)" />
              <div><b>{{ ITEMS[st.def].name }}</b><small>{{ FURNITURE[FURNITURE_ITEM[st.def]].w }} × {{ FURNITURE[FURNITURE_ITEM[st.def]].h }}・舒適 {{ FURNITURE[FURNITURE_ITEM[st.def]].comfort }}</small></div>
              <button type="button" class="btn sm" @click="startNew(st.uid)">擺放</button>
            </div>
          </div>
          <div v-else class="ppl">
            <div v-for="p in h.people" :key="p.id" class="pp"><span class="dot" :class="p.kind" /><b>{{ p.name }}</b><small>{{ p.role }}</small></div>
            <div class="go left"><ReasonButton sm :reason="zeroReason" @go="inviteZero">請零來留宿</ReasonButton><Hint>留宿的名冊成員：二級以上、忠誠 40 以上就肯。召集時不必去找他；每週忠誠 +1。</Hint></div>
            <p class="h" style="margin-top: 10px">家務 {{ h.staff.length }}／{{ caps.staff }}</p>
            <div v-for="s in h.staff" :key="s.role" class="pp"><span class="dot" /><b>{{ s.role }}</b><small>{{ s.who }}・<MoneyTag kind="acc" :amount="s.wage" :size="11" />／週</small></div>
          </div>
        </section>
      </aside>
    </div>
  </div>
</template>

<style scoped>
.screen { min-height: 100vh; display: flex; flex-direction: column; }
.home { flex: 1; display: grid; grid-template-columns: minmax(0, 1fr) 360px; gap: 12px; padding: 12px; align-items: start; }
.mh { display: flex; align-items: center; gap: 10px; margin-bottom: 10px; }
.mh .k { margin-left: auto; }
.buildbar { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; margin-top: 10px; min-height: 34px; }
.side { display: grid; gap: 12px; min-width: 0; }
h2 { margin: 2px 0 8px; font-size: 18px; }
.go.left { justify-content: flex-start; }
.stats { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 8px; }
.stat { display: grid; justify-items: start; gap: 2px; background: var(--bg-2); padding: 8px 10px; position: relative; }
.stat b { font: 900 22px var(--mono); }
.stat small { font-size: 11px; color: var(--ink-3); }
.stat :deep(.hint-wrap) { position: absolute; right: 6px; top: 6px; }
.rooms { display: grid; gap: 6px; margin-top: 10px; }
.room { background: var(--bg-2); padding: 8px 10px; box-shadow: inset 3px 0 0 var(--rc); }
.rh { display: flex; justify-content: space-between; align-items: baseline; gap: 8px; }
.ru { display: flex; align-items: center; gap: 6px; margin: 6px 0; }
.sel { font: 800 12.5px var(--font); padding: 4px 8px; background: var(--bg-term); border: 0; box-shadow: inset 0 0 0 2px var(--a); color: var(--ink); }
.fchip { font-size: 11px; font-weight: 800; padding: 3px 8px; border-radius: 999px; background: var(--bg-1); color: var(--ink-2); border: 0; cursor: pointer; }
.fchip.on { background: var(--a); color: #fff; }
.fbag { display: grid; gap: 6px; margin-top: 10px; }
.fb { display: grid; grid-template-columns: 44px 1fr auto; gap: 10px; align-items: center; background: var(--bg-2); padding: 6px 10px; }
.fb small { display: block; font-size: 11px; color: var(--ink-3); }
.ppl { margin-top: 10px; }
.pp { display: flex; gap: 8px; align-items: center; padding: 6px 0; border-bottom: 1px dashed var(--line); font-size: 13px; }
.pp small { color: var(--ink-3); font-size: 11px; display: inline-flex; gap: 4px; align-items: center; }
.dot { width: 10px; height: 10px; border-radius: 50%; background: var(--ink-3); flex: none; }
.dot.me { background: var(--a); } .dot.ally { background: var(--ram); } .dot.visitor { background: var(--ap); }
@media (max-width: 1100px) { .home { grid-template-columns: 1fr; } }
@media (max-width: 720px) { .home { padding: 8px; } .stats { grid-template-columns: 1fr 1fr 1fr; } }
</style>
