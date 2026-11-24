import type { GridView, GridUse } from '@engine/src'
import type { NetrunView } from '@engine/src/features/netrun'
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

/** 迷霧：沒看過的蓋住；看過但現在不在視野裡的變暗；巡邏現在站的格子（引擎說看得到）算看得到 */
export function fogOf(x: number, y: number, grid: GridView, visible: Set<string>, extra: Array<[number, number]> = []): 'hidden' | 'seen' | 'visible' {
  if (!grid.cells[y]?.[x]) return 'hidden'
  return visible.has(`${x},${y}`) || extra.some((p) => p[0] === x && p[1] === y) ? 'visible' : 'seen'
}

/** 巡邏的代幣：只畫引擎說看得到的 */
export function patrolTokens(view: NetrunView): Array<{ id: string; x: number; y: number; label: string; kind: 'enemy'; title: string }> {
  return view.patrols.filter((p) => p.visible).map((p) => ({ id: p.id, x: p.at[0], y: p.at[1], label: '巡', kind: 'enemy' as const, title: `巡邏${p.calm ? '（暫時平靜）' : ''}` }))
}

// ---- 追蹤度 ----

/** 追蹤度三個刻度各自會發生什麼（NETRUNNING 第 5 節；數字是引擎給的刻度） */
export function traceStages(marks: [number, number, number]): Array<{ at: number; name: string; text: string }> {
  return [
    { at: marks[0], name: '起疑', text: '系統起疑：閘門更難破解，每一層多一隊巡邏。' },
    { at: marks[1], name: '確認入侵', text: '確認入侵：現實的保全進入警戒，對方派更強的敵人。' },
    { at: marks[2], name: '定位', text: '定位：開始倒數，歸零就全隊被強制斷線。' },
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
