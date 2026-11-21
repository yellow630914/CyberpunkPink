
<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import StatusBar from '../components/StatusBar.vue'
import GridMap, { type CellView, type MapObject, type MapToken, type MapArea } from '../components/GridMap.vue'
import Hint from '../components/Hint.vue'
import Tabs from '../components/Tabs.vue'
import ItemSlot from '../components/ItemSlot.vue'
import MoneyTag from '../components/MoneyTag.vue'
import ReasonButton from '../components/ReasonButton.vue'
import { useHome } from '../stores/home'
import { useGame } from '../stores/game'
import { useUi } from '../stores/ui'
import { FURNITURE, FURNITURE_ITEM, HOME_TIER_SIZE, RESIDENCES, SHOP_KINDS, type ShopKind } from '../data/home'
import { ITEMS } from '../data/items'
import { ROOM_USES, COMFORT_TIERS, footprint, shopWeek, type Rotation } from '../lib/home'
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
const router = useRouter()
const mode = ref<'walk' | 'build'>('walk')
const selected = ref<string | null>(null)
/** 正在擺的東西：新的（來自背包的一疊）或搬動中的那一件 */
const placing = ref<{ kind: 'new'; uid: string; def: string; rot: Rotation } | { kind: 'move'; furn: string; def: string; rot: Rotation } | null>(null)
const hover = ref<Point | null>(null)
const lastReason = ref<string | null>(null)
const ROOM_COLORS: Record<string, string> = { M: '#8E7CC3', B: '#45D6C5', C: '#F2C14E', D: '#F06AA0', F: '#F06AA0', K: '#F2C14E' }
const useName = (id: string | null) => ROOM_USES.find(u => u.id === id)?.name ?? null

// ---- 走路 ----
const paths = new Map<string, Point[]>()
let ticker: ReturnType<typeof setInterval> | null = null
let wander: ReturnType<typeof setInterval> | null = null
const passable = (x: number, y: number) => h.grid.passable(x, y)
const occupiedByOther = (id: string, p: Point) => h.visible.some(o => o.id !== id && o.pos.x === p.x && o.pos.y === p.y)
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
      if (!path.length) {
        paths.delete(id)
        // 到了就是互動（UI.md 1.1 節）：走到大門就出門，回到街區
        if (id === 'me' && mode.value === 'walk' && h.map.kind(next.x, next.y) === 'entrance') { ui.toast('你出門了。'); router.push('/') }
      }
    }
  }, 160)
  wander = setInterval(() => {
    for (const p of h.people) {
      if (h.floor === 'shop' || p.kind === 'me' || paths.has(p.id) || Math.random() < 0.4) continue
      const cand: Point[] = []
      for (let dy = -3; dy <= 3; dy++) for (let dx = -3; dx <= 3; dx++) { const x = p.pos.x + dx, y = p.pos.y + dy; if (passable(x, y) && h.map.kind(x, y) === 'room') cand.push({ x, y }) }
      if (cand.length) walk(p.id, cand[Math.floor(Math.random() * cand.length)])
    }
  }, 1800)
  window.addEventListener('keydown', onKey, true)
  const q = route.query.place
  if (typeof q === 'string') startNew(q)
})
onBeforeUnmount(() => { if (ticker) clearInterval(ticker); if (wander) clearInterval(wander); window.removeEventListener('keydown', onKey, true) })

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
/** 擺設時 R 轉向、Esc 取消；處理掉的鍵標成 defaultPrevented，全域快捷鍵（R 名冊、Esc 選單）就不再接。 */
function onKey(e: KeyboardEvent) {
  if (mode.value !== 'build' || ui.stack.length) return
  const t = e.target as HTMLElement | null
  if (t?.closest?.('input, textarea, select')) return
  if (e.key === 'r' || e.key === 'R') { e.preventDefault(); rotate() }
  if (e.key === 'Escape' && placing.value) { e.preventDefault(); placing.value = null; lastReason.value = null }
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
/** 鍵盤：走路時方向鍵或 WASD 走一格、E 跳到側欄的行動；擺設時方向鍵移動游標、E 放下或選取。 */
function onStep(d: Point) {
  if (mode.value === 'walk') {
    const me = h.people.find(p => p.id === 'me')!
    walk('me', { x: me.pos.x + d.x, y: me.pos.y + d.y })
    return
  }
  const cur = hover.value ?? h.map.entrance()
  hover.value = { x: Math.max(0, Math.min(h.map.w - 1, cur.x + d.x)), y: Math.max(0, Math.min(h.map.h - 1, cur.y + d.y)) }
}
function onEnter() {
  if (mode.value === 'build') { if (hover.value) onCell(hover.value); return }
  (document.querySelector('.side .btn') as HTMLElement | null)?.focus()
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
const tokens = computed<MapToken[]>(() => h.visible.map(p => ({ id: p.id, x: p.pos.x, y: p.pos.y, label: p.name.slice(0, 1), kind: p.kind, title: `${p.name}・${p.role}` })))
const areas = computed<MapArea[]>(() => h.rooms.map(r => { const b = h.map.roomBox(r.id); return { id: r.id, x: b.x, y: b.y, label: r.name, sub: useName(r.use) ?? '', color: ROOM_COLORS[r.id] } }))
const selFurn = computed(() => { const f = h.placed.find(p => p.uid === selected.value); return f ? { f, d: FURNITURE[f.def] } : null })
const comfortTier = computed(() => COMFORT_TIERS.find(t => t.name === h.comfortInfo.tier))
const nextTier = computed(() => COMFORT_TIERS.find(t => t.at > h.comfortInfo.total))
const caps = computed(() => h.caps)
const upgradeCost = Math.round(3000 * 0.8)
function doUpgrade() {
  g.money.acc -= upgradeCost
  h.upgrade()
  g.addLog({ prose: ['你找何伯簽了擴建的單子：打通隔壁的空房，多兩間。'], changes: [{ text: `帳戶 −${upgradeCost.toLocaleString('en-US')}`, kind: 'minus' }] })
  ui.toast('升到二級了：地圖變大，多了第三間與第四間。')
}
// ---- 住處、安全屋、店面（DOWNTIME 7.1、7.2、7.11 節）----
const residence = computed(() => RESIDENCES.find(r => r.id === h.residence)!)
const AREA = 0.8 // 蜂巢的區倍率
const shopKind = ref<ShopKind>('酒吧')
const shopCost = computed(() => Math.round((10000 + SHOP_KINDS.find(k => k.id === shopKind.value)!.deco) * AREA))
const shopReason = computed(() => (h.tier < 2 ? '先升到二級。' : h.maxTier < 3 ? `${residence.value.name}的上限是 ${h.maxTier} 級；要開店面得搬到臨街的住處（例：高樓層的打通戶）。` : h.tier >= 3 ? '已經是三級了。' : g.money.acc < shopCost.value ? '帳戶不夠。' : null))
function openShop() {
  g.money.acc -= shopCost.value
  h.openShop(shopKind.value)
  g.addLog({ prose: [`你頂下一樓，開了一間${shopKind.value}。施工 10 天，這一版直接完成。`], changes: [{ text: `帳戶 −${shopCost.value.toLocaleString('en-US')}`, kind: 'minus' }] })
  ui.toast(`三級了：一樓是${shopKind.value}。上面的分頁切到「店面」。`)
}
function moveReason(id: string) {
  const r = RESIDENCES.find(x => x.id === id)!
  if (id === h.residence) return '你住在這裡。'
  if (!r.layout) return '這一版只有四號塔的單位與高樓層的打通戶畫了地圖；其他住處可以租成安全屋。'
  if (g.money.acc < r.rent * 2) return '押金（兩週房租）不夠。'
  return null
}
function moveHome(id: string) {
  const r = RESIDENCES.find(x => x.id === id)!
  g.money.acc -= r.rent * 2
  h.moveTo(id)
  g.advance(8 * 60)
  g.addLog({ prose: [`你搬到${r.name}。自己搬花了 8 小時，箱子裡的東西都跟著走。`], changes: [{ text: `押金 −${(r.rent * 2).toLocaleString('en-US')}`, kind: 'minus' }] })
  ui.toast(`搬到${r.name}了（${h.tier} 級，上限 ${r.tiers[1]}）。`)
}
function safeReason(id: string) {
  const r = RESIDENCES.find(x => x.id === id)!
  if (id === h.residence) return '這裡是你的家。'
  if (h.safehouses.includes(id)) return null
  if (h.safehouses.length >= 2) return '安全屋最多兩處。'
  if ((r.cash === '只收現金' ? g.money.cash : g.money.acc) < r.rent * 2) return '押金（兩週房租）不夠。'
  return null
}
function toggleSafe(id: string) {
  const r = RESIDENCES.find(x => x.id === id)!
  if (h.safehouses.includes(id)) { h.dropSafehouse(id); ui.toast(`退租了${r.name}，押金退回。`); if (r.cash === '只收現金') g.money.cash += r.rent * 2; else g.money.acc += r.rent * 2; return }
  if (r.cash === '只收現金') g.money.cash -= r.rent * 2; else g.money.acc -= r.rent * 2
  h.addSafehouse(id)
  g.addLog({ prose: [`你租下${r.name}當安全屋：只能睡、存東西、躲。隱蔽 ${r.hide}。`], changes: [{ text: `押金 −${(r.rent * 2).toLocaleString('en-US')}`, kind: 'minus' }] })
}
const weekRoll = ref<ReturnType<typeof shopWeek> | null>(null)
function runWeek() {
  const k = SHOP_KINDS.find(x => x.id === h.shop.kind)!
  const die = 1 + Math.floor(Math.random() * 20)
  const r = shopWeek(k.fit, AREA, die, h.shop.manager ? 3 : 2)
  weekRoll.value = r
  h.shop.last = `經營 1d20(${die}) + ${h.shop.manager ? 3 : 2} 對 13：${r.grade}，這週淨收 ${r.net}。`
  g.money.acc += r.net
  if (r.event) ui.toast('大失敗：觸發一件店面事件（客人鬧事）。', 'warn')
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
    <StatusBar back :title="`家園：${residence.name}`" />
    <div class="home">
      <section class="panel cut pad mapp">
        <div class="mh">
          <Tabs v-model="mode" :tabs="[{ id: 'walk', label: '走路' }, { id: 'build', label: '擺設' }]" @update:model-value="placing = null; selected = null" />
          <Tabs v-if="h.tier === 3" :model-value="h.floor" :tabs="[{ id: 'up', label: '樓上' }, { id: 'shop', label: `店面・${h.shop.kind}` }]" data-floor @update:model-value="v => { h.setFloor(v as 'up' | 'shop'); placing = null; selected = null }" />
          <span class="k">{{ h.map.w }} × {{ h.map.h }}</span>
          <Hint title="家園地圖">走路：點地板，你會照最短的路走過去；走到大門就出門。住戶與訪客自己走動。擺設：點家具選取，可以轉向（R）、移動、收起；從右欄背包裡的家具擺新的。家具不能壓牆、擋門、跨兩間房、疊在一起，也不能把路堵死。鍵盤：方向鍵或 WASD 走一格（擺設時移動游標），E 互動或放下；不必先點地圖。</Hint>
        </div>
        <GridMap :w="h.map.w" :h="h.map.h" :cell="cellView" :objects="objects" :tokens="tokens" :areas="areas" :max-cell="62" label="家園的格子地圖"
          @cell="onCell" @object="onObject" @hover="p => (hover = p)" @step="onStep" @enter="onEnter" />
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
          <div class="k">家・{{ residence.district }}{{ h.floor === 'shop' ? '・一樓店面' : '' }}</div>
          <h2>{{ residence.name }}</h2>
          <div class="chips"><span class="tag">{{ h.tier }} 級（上限 {{ h.maxTier }}）</span><span class="tag">{{ HOME_TIER_SIZE[h.tier] }}</span><span class="tag">隱蔽 {{ residence.hide }}</span><span class="tag">週租 <MoneyTag kind="acc" :amount="residence.rent" :size="11" /></span>
            <Hint title="等級與地圖大小">0 級 7 × 5（不能擺設）、1 級 11 × 8、2 級 15 × 10、3 級是樓上 15 × 10 加一樓的店面。升級時地圖往外長，原本的房間與家具不動；工期 5 天，這一版直接完成。</Hint></div>
          <div class="go left">
            <ReasonButton v-if="h.tier < 2" sm pri :reason="h.tier >= h.maxTier ? '這個住處的上限是一級；要更大得搬家。' : g.money.acc < upgradeCost ? '帳戶不夠。' : null" @go="doUpgrade">升級（二級）<MoneyTag kind="acc" :amount="upgradeCost" :size="12" /></ReasonButton>
            <button type="button" class="btn sm" @click="sideTab = 'place'">住處與安全屋</button>
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
          <Tabs v-model="sideTab" :tabs="[{ id: 'rooms', label: '房間' }, { id: 'bag', label: '家具' }, { id: 'people', label: '人' }, { id: 'place', label: '住處' }, { id: 'shop', label: '店面' }]" />
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
          <div v-else-if="sideTab === 'place'" class="ppl" data-side="place">
            <p class="h">家<Hint title="住處">一個人可以有一個家和最多兩處安全屋。家是同居、訪客、居家事件發生的地方；安全屋只能睡、存東西、躲。每一處都付房租；押金是兩週房租，退租時退。搬家自己搬 8 小時，家具與箱子裡的東西跟著走，店面的裝潢搬不走。</Hint></p>
            <div v-for="r in RESIDENCES" :key="r.id" class="res" :class="{ on: r.id === h.residence }">
              <div class="rh"><b>{{ r.name }}</b><span class="k">{{ r.district }}・{{ r.tiers[0] }}→{{ r.tiers[1] }} 級・隱蔽 {{ r.hide }}</span></div>
              <small class="t-fine">週租 {{ r.rent }}（{{ r.cash }}）{{ r.buy ? `・買斷 ${r.buy.toLocaleString('en-US')}` : '' }}・{{ r.note }}</small>
              <div class="go left">
                <ReasonButton sm :reason="moveReason(r.id)" :data-move="r.id" @go="moveHome(r.id)">{{ r.id === h.residence ? '你的家' : '搬過去' }}</ReasonButton>
                <ReasonButton sm :reason="safeReason(r.id)" :data-safe="r.id" @go="toggleSafe(r.id)">{{ h.safehouses.includes(r.id) ? '退租安全屋' : '租成安全屋' }}</ReasonButton>
              </div>
            </div>
            <p class="h" style="margin-top: 10px">安全屋 {{ h.safehouses.length }}／2</p>
            <div v-if="!h.safehouses.length" class="empty-note">沒有安全屋。</div>
            <div v-for="id in h.safehouses" :key="id" class="pp"><span class="dot" /><b>{{ RESIDENCES.find(r => r.id === id)?.name }}</b><small>只能睡、存東西、躲・週租 {{ RESIDENCES.find(r => r.id === id)?.rent }}</small></div>
          </div>
          <div v-else-if="sideTab === 'shop'" class="ppl" data-side="shop">
            <template v-if="h.tier < 3">
              <p class="h">開店面（三級）<Hint title="店面">三級據點的一樓是店面。頂讓 10,000＋裝潢，乘區倍率；工期 10 天，這一版直接完成。店面讓名冊上的人有地方待：住戶上限另 +2；三級的店面一定要有店長。</Hint></p>
              <div class="row-list">
                <button v-for="k in SHOP_KINDS" :key="k.id" type="button" class="lrow" :class="{ on: shopKind === k.id }" @click="shopKind = k.id"><span class="grow"><b>{{ k.id }}</b><small>裝潢 {{ k.deco.toLocaleString('en-US') }}・每週基礎 {{ k.fit }}・{{ k.check }}</small><small>{{ k.perk }}</small></span></button>
              </div>
              <div class="go left"><ReasonButton sm pri :reason="shopReason" data-openshop @go="openShop">開店（{{ shopCost.toLocaleString('en-US') }}）</ReasonButton></div>
            </template>
            <template v-else>
              <p class="h">{{ h.shop.kind }}<Hint title="每週營收">基礎 × 區倍率 × 經營結果 × 區域狀態 − 營運費（基礎 × 0.4）。經營結果：店長（或這週在店裡待滿 8 小時的你）擲一次 DC 13：大成功 1.5、成功 1、失敗 0.6、大失敗 0.3 並觸發一件店面事件。</Hint></p>
              <div class="kv"><span>店長</span><b>{{ h.shop.manager ?? '沒有（要找一個）' }}</b></div>
              <div class="kv"><span>附帶</span><b class="t-fine">{{ SHOP_KINDS.find(k => k.id === h.shop.kind)?.perk }}</b></div>
              <div class="kv"><span>營運費</span><b>{{ Math.round((SHOP_KINDS.find(k => k.id === h.shop.kind)?.fit ?? 0) * 0.4) }}／週</b></div>
              <p v-if="h.shop.last" class="t-fine">{{ h.shop.last }}</p>
              <div class="go left">
                <ReasonButton sm :reason="h.shop.manager ? null : null" @go="h.shop.manager = h.shop.manager ? null : '奈奈'">{{ h.shop.manager ? '換掉店長' : '請奈奈當店長' }}</ReasonButton>
                <ReasonButton sm pri :reason="h.shop.manager ? null : '三級的店面一定要有店長。'" @go="runWeek">結算這一週</ReasonButton>
              </div>
            </template>
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
h2 { margin: 2px 0 8px; font-size: var(--fs-section); }
.go.left { justify-content: flex-start; }
.stats { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 8px; }
.stat { display: grid; justify-items: start; gap: 2px; background: var(--bg-2); padding: 8px 10px; position: relative; }
.stat b { font: 900 var(--fs-page) var(--mono); }
.stat small { font-size: var(--fs-fine); color: var(--ink-3); }
.stat :deep(.hint-wrap) { position: absolute; right: 6px; top: 6px; }
.rooms { display: grid; gap: 6px; margin-top: 10px; }
.room { background: var(--bg-2); padding: 8px 10px; box-shadow: inset 3px 0 0 var(--rc); }
.rh { display: flex; justify-content: space-between; align-items: baseline; gap: 8px; }
.ru { display: flex; align-items: center; gap: 6px; margin: 6px 0; }
.sel { font: 800 var(--fs-sm) var(--font); padding: 4px 8px; background: var(--bg-term); border: 0; box-shadow: inset 0 0 0 2px var(--a); color: var(--ink); }
.fchip { font-size: var(--fs-fine); font-weight: 800; padding: 3px 8px; border-radius: 999px; background: var(--bg-1); color: var(--ink-2); border: 0; cursor: pointer; }
.fchip.on { background: var(--a); color: #fff; }
.fbag { display: grid; gap: 6px; margin-top: 10px; }
.fb { display: grid; grid-template-columns: 44px 1fr auto; gap: 10px; align-items: center; background: var(--bg-2); padding: 6px 10px; }
.fb small { display: block; font-size: var(--fs-fine); color: var(--ink-3); }
.ppl { margin-top: 10px; }
.pp { display: flex; gap: 8px; align-items: center; padding: 6px 0; border-bottom: 1px dashed var(--line); font-size: var(--fs-ui); }
.pp small { color: var(--ink-3); font-size: var(--fs-fine); display: inline-flex; gap: 4px; align-items: center; }
.dot { width: 10px; height: 10px; border-radius: 50%; background: var(--ink-3); flex: none; }
.res { padding: 8px 10px; background: var(--bg-2); margin-bottom: 6px; display: grid; gap: 4px; }
.res.on { box-shadow: inset 3px 0 0 var(--a); }
.res .rh { display: flex; justify-content: space-between; gap: 8px; flex-wrap: wrap; }
.dot.me { background: var(--a); } .dot.ally { background: var(--ram); } .dot.visitor { background: var(--ap); }
@media (max-width: 1100px) { .home { grid-template-columns: 1fr; } }
@media (max-width: 720px) { .home { padding: 8px; } .stats { grid-template-columns: 1fr 1fr 1fr; } }
</style>
