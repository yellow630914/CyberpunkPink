import type { GridView } from '@engine/src'
import type { AuxResult, CommissionView, LinkRow, TrackNode } from '@engine/src/features/commission'

/**
 * 委託畫面（M2-ui-commission）的整理：把引擎給的檢視變成畫面要的字與樣式。
 * 只做對照與排序，沒有擲骰、算式、機率或能不能做的判斷：成功率、DC、原因一律是引擎給的。
 */

export type FaceId = 'meat' | 'net' | 'opinion'

/** 面的圖示字與樣式（現實灰、內海薄荷、輿論紫） */
export const FACE_ICON: Record<FaceId, string> = { meat: '現', net: '內', opinion: '輿' }
export const FACE_CLASS: Record<FaceId, string> = { meat: 'm', net: 'n', opinion: 'o' }
export const FACE_LABEL: Record<FaceId, string> = { meat: '現實', net: '內海', opinion: '輿論' }

const ROMAN = ['', 'I', 'II', 'III', 'IV', 'V']
/** 等級的羅馬數字（顯示用） */
export const gradeRoman = (g: number): string => ROMAN[Math.max(0, Math.min(5, Math.round(g)))] || String(g)

const SCALE_NAME: Record<string, string> = { small: '小型', medium: '中型', large: '大型' }
export const scaleName = (s: string | null | undefined): string => (s ? SCALE_NAME[s] ?? s : '？')

/** 副本直播、輿論的壓力等引擎有了再接；這裡是畫面上寫的那句話 */
export const NOT_OPEN = '還沒有開放。'

// ---- 這一段的五步 ----

export interface StepPip { label: string; state: 'done' | 'now' | 'todo' }
/**
 * 選面、輔助結算、選分支、玩這一段、里程碑（UI 7.4）：引擎的 step 是 face、branch、play、done 四個；
 * 選好面時輔助面就已經結算了（同一份報告），所以 branch 之後前兩步都算完成。
 */
export function stepPips(step: CommissionView['step']): StepPip[] {
  const at = step === 'face' ? 0 : step === 'branch' ? 2 : step === 'play' ? 3 : 4
  return ['選面', '輔助結算', '選分支', '玩這一段', '里程碑'].map((label, i) => ({ label, state: i < at ? 'done' : i === at ? 'now' : 'todo' }))
}

// ---- 分支 ----

const BRANCH_CHAR: Record<string, string> = { assault: '攻', stealth: '潛', talk: '談', linked: '連', scouted: '探' }
export const branchChar = (kind: string): string => BRANCH_CHAR[kind] ?? '？'

// ---- 連動 ----

const LINK_KIND: Record<string, { name: string; tone: 'mint' | 'violet' | 'gold' }> = {
  skip: { name: '代勞', tone: 'mint' }, ease: { name: '減壓', tone: 'violet' }, open: { name: '開路', tone: 'gold' },
}
export const linkKind = (type: string): { name: string; tone: 'mint' | 'violet' | 'gold' } => LINK_KIND[type] ?? { name: type, tone: 'gold' }

/** 一條連動寫給玩家看的來歷：第幾階段、哪一面、對哪個階段 */
export function linkWhere(l: LinkRow): string {
  return `第 ${l.from} 階段・${FACE_LABEL[l.face]}面拿到，對第 ${l.stage} 階段${l.used ? '（用掉了）' : ''}`
}

// ---- 輔助結算 ----

const OUTCOME_NAME: Record<string, string> = { great: '大成功', success: '成功', fail: '失敗', mishap: '出事了' }
/** 一個輔助面一行：誰擲、骰值與算式、對多少、拿到什麼（名字照引擎給的） */
export function auxLine(r: AuxResult, nameOf: (id: string) => string, linkName: (id: string) => string, skillName: (id: string) => string): string {
  // 加值的每一項（基本功、路數、人手）是引擎擲骰時記下的 parts，合計也是引擎的 total：這裡只接成一行字
  const parts = r.roll.parts.filter(p => p.value !== 0).map(p => `${p.value > 0 ? '+' : '−'} ${Math.abs(p.value)}`).join(' ')
  const head = `輔助・${FACE_LABEL[r.face]}：${nameOf(r.roller)}　${skillName(r.skill)} 骰 ${r.roll.natural}${parts ? ` ${parts}` : ''} = ${r.roll.total}，對 ${r.roll.dc}`
  const tail = r.link ? `拿到連動「${linkName(r.link)}」` : (OUTCOME_NAME[r.outcome] ?? r.outcome)
  return `${head} → ${tail}${r.injured ? `；${nameOf(r.injured)}受傷了` : ''}`
}

// ---- 階段軌 ----

/** 節點下面寫「你：現實・潛行」：選了什麼（做完的與現在的） */
export function trackChose(n: TrackNode, branchName: (id: string) => string): string {
  if (!n.chose) return ''
  return `你：${FACE_LABEL[n.chose.face]}${n.chose.branch ? `・${branchName(n.chose.branch)}` : ''}`
}

// ---- 地圖 ----

export interface MapCell { kind: string; mark?: string; title?: string }

const MARK_NAME: Record<string, string> = {
  target: '目標', data_port: '資料埠', control: '控制面板', credential: '憑證', safe: '保險箱', hostage: '人質', extract: '撤離點', entry: '入口', guard: '保全崗', camera: '監視器',
  stair_up: '往上', stair_down: '往下', lift: '電梯',
}
const MARK_CHAR: Record<string, string> = { target: 'T', data_port: 'D', control: 'C', credential: 'K', safe: '$', hostage: '&', extract: 'X', entry: 'E', guard: 'G', camera: 'S', stair_up: '<', stair_down: '>', lift: 'H' }

/** 引擎的格子種類換成 GridMap 的樣式（沒看過的是 void，迷霧另外蓋） */
export function mapCell(kind: string | null | undefined): MapCell {
  if (!kind) return { kind: 'void' }
  switch (kind) {
    case 'wall': return { kind: 'wall' }
    case 'floor': case 'ground': case 'spot': case 'vent': case 'crowd': return { kind: 'street' }
    case 'water': case 'window': case 'cover': case 'half_cover': return { kind: 'building', ...(kind === 'window' ? { title: '窗' } : {}) }
    case 'door': return { kind: 'door', title: '門' }
    case 'door_locked': return { kind: 'door', mark: '鎖', title: '上鎖的門' }
    case 'entry': return { kind: 'entrance', mark: 'E', title: MARK_NAME.entry }
    case 'guard': case 'camera': return { kind: 'trap', mark: MARK_CHAR[kind], title: MARK_NAME[kind] }
    default: return { kind: 'fac', ...(MARK_CHAR[kind] ? { mark: MARK_CHAR[kind] } : {}), ...(MARK_NAME[kind] ? { title: MARK_NAME[kind] } : {}) }
  }
}

/** 身邊（上下左右）上鎖的門：給「撬鎖」「破門」兩個按鈕用（引擎的 unlock 要門的座標） */
export function lockedNear(grid: GridView | null): Array<[number, number]> {
  if (!grid) return []
  const [x, y] = grid.at
  return ([[0, -1], [0, 1], [-1, 0], [1, 0]] as const).map(([dx, dy]) => [x + dx, y + dy] as [number, number]).filter(([px, py]) => grid.cells[py]?.[px] === 'door_locked')
}

// ---- 技能配置 ----

/** 這一趟裝的技能標籤：引擎裝著的 id 換成名字（查不到的照 id） */
export function loadoutLabels(loadout: readonly string[], abilities: ReadonlyArray<{ id: string; name?: string }>): string[] {
  const byId = new Map(abilities.map(a => [a.id, a.name ?? a.id]))
  return loadout.map(id => byId.get(id) ?? id)
}

// ---- 時間 ----

/** 一個踩點的時間範圍「14:00 起 4 小時」之類：只是把分鐘寫成小時 */
export const hoursOf = (minutes: number): string => (minutes % 60 === 0 ? `${minutes / 60} 小時` : `${minutes} 分鐘`)

/** 信譽預告的一句（數字是引擎 repGainOf 算的；0 寫「信譽不變」，評價 S 另有加成時註明） */
export function repGainText(g: { amount: number; topBonus: number }): string {
  if (g.amount === 0 && g.topBonus === 0) return '信譽不變'
  const base = g.amount === 0 ? '信譽不變' : `信譽 +${g.amount}`
  return g.topBonus > 0 ? `${base}（評價 S 再 +${g.topBonus}）` : base
}
/** 放棄一件委託的確認句（rep 是引擎的 abandonRepOf，負數；departed：這件出發過了，寫成「已經出發過」，沒出發寫「還沒出發」） */
export function abandonText(rep: number, departed = false): string {
  const when = departed ? '這件已經出發過，' : '這件還沒出發，'
  return rep === 0 ? `${when}放棄它，信譽不變。` : `${when}放棄它，信譽會${rep < 0 ? '掉' : '加'} ${Math.abs(rep)} 點。`
}
/** 副本裡做完的預告：做完的信譽（引擎的 repGainOf，照現在預估的評價）與失敗的（引擎規則 rep_failed，負數） */
export function repForecastText(g: { amount: number; topBonus: number }, failed: number): string {
  return `做完：${repGainText(g)}；失敗：${failed === 0 ? '信譽不變' : `信譽 ${failed < 0 ? '−' : '+'}${Math.abs(failed)}`}`
}
/** 結算之後實際的信譽變化（引擎入帳時記的 PayoutRecord.rep：夾值之後的 from→to；沒有紀錄不寫數字） */
export function repChangeText(rep: { from: number; to: number } | null | undefined): string {
  if (!rep) return '信譽沒有變化'
  const d = rep.to - rep.from
  if (d === 0) return `信譽不變（${rep.to}）`
  return `信譽 ${rep.from} → ${rep.to}（${d > 0 ? '+' : '−'}${Math.abs(d)}）`
}

// ---- 內海的階段（M3-ui-commission-net） ----

/** 這件委託有沒有內海的階段（主面是內海，或階段軌上看得到的階段有開內海面）：追蹤度條只有這時顯示 */
export function hasNetStage(v: Pick<CommissionView, 'main' | 'track'>): boolean {
  return v.main === 'net' || v.track.some(n => n.faces?.includes('net'))
}

/** 追蹤度的數字：整數，負數照寫（引擎夾在 −30～100） */
export const traceText = (value: number): string => String(Math.round(value))

/** 離開內海那一段之後的一行：離開時的追蹤度（引擎的 trace.value）與拿到的東西（子網裡看到的 loot）；沒有東西就只寫追蹤度 */
export function netStageLine(stage: number, trace: number, loot: ReadonlyArray<{ name: string; qty: number }>): string {
  const got = loot.length ? `；拿到 ${loot.map(l => (l.qty > 1 ? `${l.name} ×${l.qty}` : l.name)).join('、')}` : '；沒有帶東西出來'
  return `第 ${stage} 階段（內海）做完：離開時追蹤度 ${traceText(trace)}${got}。`
}

/** 路線的後果的一行（內海那一份）：走了幾個內海階段、追蹤度、目標勢力與管網路的勢力各加多少；沒有走內海是 null */
export function netFalloutLine(f: CommissionView['close']['fallout'], factionName: (id: string) => string): string | null {
  if (!f.net) return null
  const target = f.faction ? `${factionName(f.faction)}的敵對值內海這一份 +${f.net.delta}` : '沒有目標勢力'
  const watch = (f.watchers ?? []).filter(w => w.delta > 0).map(w => `${factionName(w.faction)} +${w.delta}`)
  return `內海 ${f.net.stages} 個階段、追蹤度 ${traceText(f.net.trace)}：${target}${f.net.located > 0 ? `（含被定位 +${f.net.located}）` : ''}${watch.length ? `；管網路的勢力：${watch.join('、')}` : ''}。`
}
