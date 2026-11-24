import { ref, watch, type Ref } from 'vue'
import type { GridView, GridUse } from '@engine/src'
import type { NetrunView } from '@engine/src/features/netrun'
import type { MazeView } from '@engine/src/features/maze'
import type { HereOption } from './here'

/**
 * 子網地圖的檢視整理（M3-ui-subnet）：把引擎的 gridView 與 netrunView 排成畫面要的樣子。
 * 只做整理與排序：位置、迷霧、巡邏看不看得到、能不能做與原因、追蹤度、倒數，一律是引擎給的；這裡沒有規則。
 * 圖示與顏色是畫面自己的（顏色用設計代幣，不寫死色碼）。
 */

/** 引擎的網內格子種類（NET_LEGEND）→ 名字、圖示、顏色、說明（CYBERSPACE 8.1 節的節點表） */
export interface NodeInfo { name: string; icon: string; color: string; hint: string }
export const NODE_INFO: Record<string, NodeInfo> = {
  entry: { name: '入口', icon: 'ic-fac_gate', color: 'var(--net)', hint: '這一層的進入點。第一層的入口連著企業的前台。' },
  net_gate: { name: '閘門', icon: 'ic-net_defense', color: 'var(--b)', hint: '通往下一層（最後一層是出口）。守著它的遭遇處理過、或破解、憑證、後門鑰匙，才過得去。' },
  net_archive: { name: '檔案庫', icon: 'ic-cargo', color: 'var(--ap)', hint: '要拿的東西。打開檔案庫拿裡面的東西；要下載的目標，待在上面一次一次「繼續」，追蹤度每次往上。' },
  net_control: { name: '控制節點', icon: 'ic-fac_electro', color: 'var(--ep)', hint: '連著現實的裝置。接管之後，後面的現實階段可以用它。' },
  net_foe: { name: '遭遇', icon: 'ic-net_body', color: 'var(--a)', hint: '一場戰鬥。站不上去：走到它旁邊，選開戰或潛行繞過。' },
  net_person: { name: '人', icon: 'ic-bs_negotiate', color: 'var(--sink)', hint: '連在這座子網上的人。可以談，也可以快駭。' },
  net_alarm: { name: '警報節點', icon: 'ic-bs_investigate', color: 'var(--warn)', hint: '陷阱：踩到時追蹤度上升。' },
  net_loop: { name: '迴圈碎片', icon: 'ic-dmg_neural', color: 'var(--danger)', hint: '陷阱：踩進去要過介面或意志的檢定，失敗的話感載上升，被送回這一層的入口。' },
  net_puzzle: { name: '機關', icon: 'ic-bs_interface', color: 'var(--ep)', hint: '迷宮館的謎題。' },
  net_imprint: { name: '印記', icon: 'ic-net_unique', color: 'var(--load)', hint: '會說話的人格殘片，是一件事件。' },
  net_rest: { name: '休息點', icon: 'ic-bs_resolve', color: 'var(--ok)', hint: '短休一次，感載往下降。每一層一個。' },
  net_safe: { name: '安全點', icon: 'ic-net_tool', color: 'var(--ram)', hint: '預埋的後門：可以短休，也可以從這裡正常登出。' },
}
/** 圖例的順序 */
export const LEGEND_ORDER = ['entry', 'net_gate', 'net_archive', 'net_control', 'net_foe', 'net_person', 'net_alarm', 'net_loop', 'net_puzzle', 'net_imprint', 'net_rest', 'net_safe']
export const infoOf = (kind: string): NodeInfo | null => NODE_INFO[kind] ?? null

/** 鏈路的記號：單向（只能從一邊過去）與會斷（走過一次就斷） */
export const LINK_MARK: Record<string, { mark: string; title: string }> = {
  net_valve: { mark: '單', title: '單向的鏈路：只能從一邊走過去。' },
  net_bridge: { mark: '斷', title: '會斷的鏈路：走過一次就斷。' },
}

/** 這一層看過的標記（store 的 net.sheet().markers） */
export interface SheetMarker { id: string; name: string; mark: string; kind: string; at: [number, number]; used: boolean }

export interface CellOut { kind: string; icon?: string; tint?: string; title?: string; mark?: string }

/**
 * 一格長什麼樣子。沒看過的格子是空的（迷霧由 fogOf 決定）；牆不畫；節點畫圖示與名字，處理過的打勾；目標的節點加星（做完是勾）。
 * 處理過的遭遇節點在引擎那邊已經改成鏈路，所以用標記表找回它原本是什麼。
 */
export function cellOf(x: number, y: number, grid: GridView, markers: SheetMarker[], goalId: string | null): CellOut {
  const kind = grid.cells[y]?.[x]
  if (!kind) return { kind: 'void' }
  if (kind === 'wall') return { kind: 'wall' }
  const m = markers.find((k) => k.at[0] === x && k.at[1] === y)
  const link = LINK_MARK[kind]
  if (link) return { kind: kind === 'net_valve' ? 'valve' : 'bridge', mark: link.mark, title: link.title }
  const info = infoOf(kind === 'floor' && m ? m.kind : kind)
  if (!info) return { kind: 'link' }
  const isGoal = !!m && goalId === m.id
  const done = !!m && m.used
  return {
    kind: 'node', icon: info.icon, tint: info.color,
    title: `${info.name}${m ? `・${m.name}` : ''}${done ? '（處理過了）' : ''}${isGoal ? '（這一趟的目標）' : ''}`,
    ...(done ? { mark: '✓' } : isGoal ? { mark: '★' } : {}),
  }
}

/** 迷霧：沒看過的蓋住；看過但現在不在視野裡的變暗；巡邏現在站的格子（引擎說看得到）一定算看得到（視野的算法以引擎為準） */
export function fogOf(x: number, y: number, grid: GridView, visible: Set<string>, extra: Array<[number, number]> = []): 'hidden' | 'seen' | 'visible' {
  if (extra.some((p) => p[0] === x && p[1] === y)) return 'visible'
  if (!grid.cells[y]?.[x]) return 'hidden'
  return visible.has(`${x},${y}`) ? 'visible' : 'seen'
}

/** 巡邏的代幣：只畫引擎說看得到的 */
export function patrolTokens(view: NetrunView): Array<{ id: string; x: number; y: number; label: string; kind: 'enemy'; title: string }> {
  return view.patrols.filter((p) => p.visible).map((p) => ({ id: p.id, x: p.at[0], y: p.at[1], label: '巡', kind: 'enemy' as const, title: `巡邏${p.calm ? '（暫時平靜）' : ''}` }))
}

// ---- 追蹤度 ----

/** 追蹤度三個刻度各自會發生什麼（NETRUNNING 第 5 節；數字是引擎給的刻度） */
export function traceStages(marks: [number, number, number]): Array<{ at: number; name: string; text: string }> {
  return [
    { at: marks[0], name: '起疑', text: '系統起疑：一隻白蕾絲加入（牠不打人，在場時追蹤度每回合再往上加），閘門更難破解。' },
    { at: marks[1], name: '確認入侵', text: '確認入侵：現實的保全進入警戒，對方的潛網者或一隻精英蕾絲加入。' },
    { at: marks[2], name: '定位', text: '定位：對方知道你的身體在哪，現實的增援往接入點去；倒數歸零全隊被強制斷線。' },
  ]
}
export const STAGE_NAME: Record<string, string> = { quiet: '沒人知道', suspect: '起疑', alert: '確認入侵', located: '已被定位' }

// ---- 能做的事 ----

const toOption = (u: GridUse, run: () => void, extra: Partial<HereOption> = {}): HereOption => ({ id: u.id, name: u.name, reason: u.block, run, ...extra })

/**
 * 「這裡」與按 E 用的選項：站的這一格能做的事，加上旁邊的遭遇節點能做的事（名字前面寫是哪個節點）。
 * 順序是引擎給的；E 做第一個。管理行動（擦痕跡）不在這裡：那一個不該被 E 順手按到。
 */
export function hereOptions(view: NetrunView, use: (id: string, at?: string) => void): HereOption[] {
  return [
    ...view.here.uses.map((u) => toOption(u, () => use(u.id))),
    ...view.near.flatMap((n) => n.uses.map((u) => toOption({ ...u, name: `${u.name}：${n.name}` }, () => use(u.id, n.id), { id: `${u.id}@${n.id}` }))),
  ]
}

/** 目標做到哪的一行：下載與放東西寫幾次（進度／次數），其餘寫做完了沒有 */
export function goalLine(view: NetrunView): string {
  const g = view.goal
  if (g.done) return '做到了。'
  if (g.progress !== null && g.turns !== null && g.turns > 0) return `進度 ${g.progress}／${g.turns}`
  if (g.kind === 'extract') return g.got ? '東西在手上。' : '還沒拿到。'
  return '還沒做到。'
}

/** 這一趟結束了，離開這一頁去哪：委託的那一段回副本頁，其餘（自己潛進去的）回主畫面。kind 是離開前最後看到的行程種類 */
export const leaveTo = (kind: string | null): string => (kind === 'face.net' ? '/commission' : '/')

/**
 * 內海戰鬥結束離開時去哪（P1）：照引擎的狀態，不照戰鬥開始時的 from。
 * 行程還在回 from（子網）；行程沒了而副本還在、或手上還有委託回副本頁；其餘回主畫面。
 */
export function netBattleLeaveTo(from: string, st: { run: boolean; commission: boolean; jobs: boolean }): string {
  if (!from.startsWith('/subnet')) return from
  if (st.run) return from
  return st.commission || st.jobs ? '/commission' : '/'
}

/**
 * 這一趟結束（引擎沒有進行中的行程了）就離開這一頁：go 收到要去的路徑，done 在離開前叫一次（提示這一趟的結果）。
 * 一開始就沒有行程不算「結束」（那一頁自己顯示一句話）。回傳停止監看的函式。
 */
export function watchRunEnd(view: Ref<{ kind: string } | null>, go: (path: string) => void, done: () => void) {
  let seen: string | null = view.value ? view.value.kind : null
  return watch(view, (v, old) => {
    if (v) seen = v.kind
    else if (old) { done(); go(leaveTo(seen)) }
  })
}


/** 迷宮館的機關與寶箱（引擎的 mazeView.near）：站在旁邊的機關列解的辦法、腳下的寶箱列開箱；名字前面寫是哪個節點，順序是引擎給的 */
export function mazeOptions(view: MazeView, use: (id: string, at: string) => void): HereOption[] {
  return view.near.flatMap((n) => n.uses.map((u) => toOption({ ...u, name: `${u.name}：${n.marker.name}` }, () => use(u.id, n.marker.id), { id: `${u.id}@${n.marker.id}` })))
}

/** 迷宮館的回合數對標準的比例條（0～1.5 夾在 0～100%）：只換算畫面的長度，標準與評價是引擎的 */
export const ratioWidth = (ratio: number): number => Math.max(0, Math.min(100, Math.round((ratio / 1.5) * 100)))

/**
 * 登出的確認流程（子網頁用）：按登出只開確認框，取消不送，確認才呼叫引擎的 logout。被擋下（block）直接顯示原因、不開框。
 * 能不能登出與那一句說明都是引擎給的（view().logout）；這裡只管框開不開。
 */
export function logoutFlow(deps: { block: () => string | null; logout: () => Promise<{ status: string; reason?: string }>; toast: (s: string) => void }) {
  const confirm = ref(false)
  return {
    confirm,
    ask(): void {
      const b = deps.block()
      if (b) { deps.toast(b); return }
      confirm.value = true
    },
    cancel(): void { confirm.value = false },
    async ok(): Promise<void> {
      confirm.value = false
      const r = await deps.logout()
      if (r.status !== 'applied' && r.reason) deps.toast(r.reason)
    },
  }
}

/** 離開結算：清掉結算、換完頁，才回到去處（換頁會關掉所有對話框，所以對話框要等換完頁再開） */
export async function leaveSettlement(deps: { clear: () => void; go: (path: string) => Promise<unknown>; diving: boolean; openDive: () => void }): Promise<void> {
  deps.clear()
  await deps.go('/')
  if (deps.diving) deps.openDive()
}
