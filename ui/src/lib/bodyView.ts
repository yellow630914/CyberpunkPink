/**
 * 身體分頁、診所、藥與沉溺的整理（M4-ui-body）：把引擎給的視圖與報價整理成畫面要的列。純函式，只整理與排序。
 * 不算費用、成本、休養、機率、DC，也不判斷做不做得到：這些一律由 store 問引擎（stores/engine.ts 的 body）。
 * 這裡的表只有「名字」「圖標」「欄位順序」這類顯示用的對照；規則的數字都不在這裡。
 */
import type { CyberView, PartId, PieceStatus, ViewPart, ViewPiece } from '@engine/src/features/cyberware'
import type { PassiveEffect, PassiveEntry } from '@engine/src'
import { computeDegree, formatDuration } from '@engine/src'
import type { SlotItem } from './gearView'
import type { Grade } from '../data/types'

/** 背包裡的一件義體（成品或甲板，帶 uid）：種類是畫面分頁用的（橋走換橋的手術，其餘走安裝） */
export type BodyBagKind = 'cyber' | 'bridge' | 'deck'
export interface BodyBag { uid: string; id: string; name: string; grade: number; kind: BodyBagKind; slot: string | null }
/** 引擎的被動效果的一筆（k.passives.of） */
export type BodyPassive = PassiveEntry

/** 痛覺編輯器：身上有帶這個標籤的義體時，生命值只顯示模糊的分段（CYBERWARE 第 3 節；設計圖的 tags 寫它）。 */
export const PAIN_TAG = 'pain_editor'

// ---- 部位 ----

export interface PartUi { icon: string; side: 'left' | 'right'; hint: string }
/** 十一個部位的圖標、在人形的哪一側、說明（部位的名字與槽數是引擎的 cyberView）。 */
export const PART_UI: Record<PartId, PartUi> = {
  brain: { icon: 'ic-cw_brain', side: 'left', hint: '甲板、反射加速器、記憶庫、人格面具槽、人偶晶片。' },
  eye: { icon: 'ic-cw_eye', side: 'left', hint: '義眼（瞄準、夜視、錄影）、掃描器。' },
  skin: { icon: 'ic-cw_skin', side: 'left', hint: '觸覺強化皮膚、光學迷彩、光紋刺青。' },
  arm_l: { icon: 'ic-cw_arm', side: 'left', hint: '義臂、內藏武器、駭入接頭、手術指。' },
  leg_l: { icon: 'ic-cw_leg', side: 'left', hint: '義腿、跳躍增壓、靜音足墊。' },
  ear_throat: { icon: 'ic-cw_earthroat', side: 'right', hint: '聲紋偽裝、指向收音、費洛蒙腺、獸耳。' },
  bridge: { icon: 'ic-cw_bridge', side: 'right', hint: '橋本體，在後頸。型號決定四類技能的容量。' },
  torso: { icon: 'ic-cw_torso', side: 'right', hint: '皮下裝甲、合成臟器、藥泵、備用心臟。' },
  arm_r: { icon: 'ic-cw_arm', side: 'right', hint: '義臂、內藏武器、駭入接頭、手術指。' },
  leg_r: { icon: 'ic-cw_leg', side: 'right', hint: '義腿、跳躍增壓、靜音足墊。' },
  intimate: { icon: 'ic-cw_intimate', side: 'right', hint: '感官強化、鎖具、藏匿艙。' },
}
export const PART_IDS: readonly PartId[] = ['brain', 'eye', 'skin', 'arm_l', 'leg_l', 'ear_throat', 'bridge', 'torso', 'arm_r', 'leg_r', 'intimate']

export interface PartRow { part: ViewPart; ui: PartUi; sink: number; warn: boolean }

/** 一個部位的沉溺成本合計與有沒有警示（有鎖、壞了、休養中的件）。 */
export function partRows(view: CyberView): PartRow[] {
  const order = new Map(PART_IDS.map((id, i) => [id, i]))
  return [...view.parts].sort((a, b) => (order.get(a.id) ?? 99) - (order.get(b.id) ?? 99)).map((part) => ({
    part, ui: PART_UI[part.id],
    sink: part.pieces.reduce((n, p) => n + (p?.sink ?? 0), 0),
    warn: part.pieces.some((p) => p !== null && p.status === 'off'),
  }))
}

/** 人形圖上要用的：有義體的部位、有警示的部位。 */
export function figureMarks(view: CyberView): { filled: Partial<Record<PartId, boolean>>; warn: Partial<Record<PartId, boolean>> } {
  const filled: Partial<Record<PartId, boolean>> = {}
  const warn: Partial<Record<PartId, boolean>> = {}
  for (const r of partRows(view)) {
    filled[r.part.id] = r.part.used > 0
    warn[r.part.id] = r.warn
  }
  return { filled, warn }
}

const clampGrade = (n: number): Grade => (n >= 1 && n <= 5 ? (Math.floor(n) as Grade) : 1)

/** 物品格要的資料（圖標用部位的通用圖標）。 */
export function slotItemOf(p: ViewPiece | BodyBag, icon?: string): SlotItem {
  const grade = clampGrade(p.grade)
  const uid = 'uid' in p ? p.uid : ''
  return { id: uid, name: p.name, grade, ...(icon ? { icon } : {}) }
}

export const STATUS_NAME: Record<PieceStatus, string> = { ready: '生效中', recovering: '休養中', off: '沒有生效' }
/** 不生效的原因（off.why）。 */
export const OFF_NAME: Record<string, string> = { lock: '授權鎖鎖住', broken: '壞了' }

/** 一件的狀態文字：休養中寫到什麼時候；不生效寫原因；鎖有期限的寫到什麼時候（時間字串由呼叫的人傳進來）。 */
export function statusText(p: ViewPiece): string {
  if (p.status === 'off') return OFF_NAME[p.off?.why ?? ''] ?? `不生效（${p.off?.why ?? ''}）`
  return STATUS_NAME[p.status]
}

// ---- 被動效果 ----

/** 戰鬥修正的名字（只有名字）。沒有的用鍵本身。 */
const MOD_NAME: Record<string, string> = {
  hit: '命中', hit_against: '被命中', evade: '迴避', dice: '傷害骰', damage: '傷害', pierce: '穿甲', armor: '護甲', crit_margin: '要害門檻', save: '豁免', initiative: '先攻',
  ap_regen: '行動點回復', ram_regen: 'RAM 回復', load_dealt_pct: '造成的感載％', load_taken_pct: '受到的感載％', decay: '感載消退', move_ap: '換位行動點', action_ap: '行動點花費',
  action_ram: 'RAM 花費', heal_dealt: '造成的回復', vent_dealt: '造成的排感載', see_dark: '夜視', firewall: '防火牆', wound_grade: '重創級數', admin_uses: '管理行動次數',
  refill: '回填', trace_round: '每回合追蹤度', trace_admin: '管理行動追蹤度', sync_cap: '同步檔位上限', sync_shifts: '換檔次數',
}
/** 衍生數值的名字（只有名字）。 */
const STAT_NAME: Record<string, string> = {
  max_hp: '生命上限', armor: '護甲', load_cap: '感載上限', sink_floor: '沉溺的下限', ap_max: '行動點上限', ram_max: 'RAM 上限', ram_regen: 'RAM 回復', afterglow_cap: '承受層數',
  net_load_decay: '內海感載消退', cyber_count: '義體件數', bridge_sensitivity: '敏感度', bridge_tolerance: '耐受', bridge_craving: '慾求', bridge_docility: '馴化',
  bridge_cap_meat: '現實容量', bridge_cap_net: '內海容量', bridge_cap_social: '社交容量', bridge_cap_media: '媒體容量', surgery_sink_pct: '手術的沉溺成本％', carry_cap: '負重',
}
export const statName = (id: string): string => STAT_NAME[id] ?? id
export const modName = (id: string): string => MOD_NAME[id] ?? id

export const signed = (n: number): string => (n > 0 ? `+${n}` : String(n))

export interface EffectNames { attr(id: string): string; skill(id: string): string }

/** 一筆被動效果寫成一行字（數字照引擎給的）。帶條件的後面加「（有條件）」。 */
const TRACK_NAME: Record<string, string> = { hp: '生命', load: '感載', sink: '沉溺', afterglow: '餘韻' }

/** 一筆效果的數字：固定的 amount，或「每 N 點某條軌道 ±M」（per：依軌道值縮放）。 */
function amountText(e: { amount?: number; per?: { track: string; every: number; amount: number } }): string {
  return e.per ? `每 ${e.per.every} 點${TRACK_NAME[e.per.track] ?? e.per.track} ${signed(e.per.amount)}` : signed(e.amount ?? 0)
}

export function effectText(e: PassiveEffect, names: EffectNames): string {
  let text: string
  if ('attr' in e) text = `${names.attr(e.attr)} ${amountText(e)}`
  else if ('stat' in e) text = `${statName(e.stat)} ${amountText(e)}`
  else if ('check' in e) {
    const what = [...(e.check.skills ?? []).map((s) => names.skill(s)), ...(e.check.attrs ?? []).map((a) => names.attr(a)), ...(e.check.tags ?? [])]
    text = `${what.join('、') || '檢定'}檢定 ${amountText(e)}`
  } else if ('mod' in e) text = `${modName(e.mod)} ${amountText(e)}${e.layer ? `（${e.layer === 'meat' ? '現實' : '內海'}）` : ''}`
  else text = `標籤：${e.unit_tag}`
  return e.if && e.if.length > 0 ? `${text}（有條件）` : text
}

export interface PassiveGroup { source: string; name: string; rows: Array<{ label: string; lines: string[] }> }

/**
 * 引擎的被動效果照來源分組（來源是引擎的 PASSIVE_SOURCES，名字由 store 給），同一個來源裡照 label 再分（label 是那一件的名字）。
 * only 有給就只留這幾個來源；沉溺的下限（stat sink_floor）只是成本的記帳，不列在效果的清單裡。
 */
export function groupPassives(list: readonly PassiveEntry[], sourceName: (s: string) => string, names: EffectNames, only?: readonly string[]): PassiveGroup[] {
  const groups = new Map<string, Map<string, string[]>>()
  for (const e of list) {
    if (only && !only.includes(e.source)) continue
    if ('stat' in e && e.stat === 'sink_floor') continue
    const g = groups.get(e.source) ?? new Map<string, string[]>()
    const rows = g.get(e.label) ?? []
    rows.push(effectText(e, names))
    g.set(e.label, rows)
    groups.set(e.source, g)
  }
  return [...groups].map(([source, g]) => ({ source, name: sourceName(source), rows: [...g].map(([label, lines]) => ({ label, lines })) }))
}

/** 一件義體自己的效果（設計圖、零件、板材護甲的合計）寫成幾行。 */
export const pieceEffectLines = (p: ViewPiece, names: EffectNames): string[] => p.effects.map((e) => effectText(e, names))

// ---- 沉溺 ----

/** 下限的組成（引擎的 statParts）：去掉 0、基礎放最前；加起來等於 sink_floor（沒有夾到 0 以下時）。 */
export function floorRows(parts: ReadonlyArray<{ label: string; value: number; source?: string }>): Array<{ label: string; value: number; source: string }> {
  return parts.filter((p) => p.value !== 0).map((p) => ({ label: p.label, value: p.value, source: p.source ?? '' }))
}
export const floorSum = (parts: ReadonlyArray<{ value: number }>): number => parts.reduce((n, p) => n + p.value, 0)

// ---- 成功率與時間（引擎給 DC 與加值，這裡只套引擎的判定函式） ----

/** 自己動刀、急救這類檢定的成功機率（0～100）：1d20 的每一面都用引擎的 computeDegree 判一次，成功與大成功都算。 */
export function successPct(bonus: number, dc: number): number {
  let wins = 0
  for (let n = 1; n <= 20; n++) {
    const d = computeDegree(n, n + bonus, dc)
    if (d === 'critical' || d === 'success') wins++
  }
  return wins * 5
}
/** 機率（0～1）寫成百分比字。 */
export const pctText = (p: number): string => `${Math.round(p * 1000) / 10}%`
/** 分鐘寫成「4 小時」（引擎的 formatDuration）；0 是「不用」。 */
export const spanText = (minutes: number): string => (minutes <= 0 ? '不用' : formatDuration(minutes))

// ---- 痛覺編輯器：生命值只剩模糊的分段 ----

export interface HpBlur { segments: number; filled: number }
/** 生命值換成 n 段、亮幾段（至少 1 段，沒死的話；0 是 0 段）：沒有數字。n 是顯示的段數，不是規則。 */
export function hpBlur(hp: number, max: number, segments = 4): HpBlur {
  if (hp <= 0 || max <= 0) return { segments, filled: 0 }
  return { segments, filled: Math.max(1, Math.min(segments, Math.ceil((hp / max) * segments))) }
}

// ---- 安裝時的左右 ----

/** 設計圖的部位是 arm、leg 時要選左右（引擎的 side 欄位）；回傳要不要選。 */
export const needsSide = (slot: string | null): boolean => slot === 'arm' || slot === 'leg'
export const SIDE_NAME = { l: '左', r: '右' } as const

// ---- 報價的列（引擎的報價 → 一行一行的字；數字都是引擎給的，這裡只套格式） ----

export interface Row { label: string; value: string; tone?: 'warn' | 'ok' | 'minus' | 'plain'; note?: string }
export const POOL_NAME: Record<string, string> = { cred: '帳戶', cash: '現金' }
const money = (n: number, pay: string | null): string => (n > 0 ? `${n.toLocaleString('en-US')}（${pay ? POOL_NAME[pay] ?? pay : '付不起'}）` : '不收錢')
const selfRow = (self: { skill: string; dc: number; bonus: number } | undefined, skillName: (id: string) => string): Row[] =>
  self ? [{ label: '自己動刀', value: `${skillName(self.skill)}對 DC ${self.dc}・成功率 ${successPct(self.bonus, self.dc)}%`, note: `加值 ${signed(self.bonus)}` }] : []

type InstallQ = { price: number; fee: number; pay: string | null; sink: number; minutes: number; recovery_minutes: number; complication: number; registered: boolean; via: string; self?: { skill: string; dc: number; bonus: number } }
/** 安裝（也給換橋用）的報價列。 */
export function installRows(q: InstallQ, skillName: (id: string) => string): Row[] {
  return [
    { label: '目錄價', value: q.price.toLocaleString('en-US') },
    { label: '手術費', value: money(q.fee, q.pay) },
    { label: '沉溺成本', value: `+${q.sink}`, tone: 'warn' },
    { label: '手術時間', value: spanText(q.minutes) },
    { label: '休養', value: spanText(q.recovery_minutes) },
    ...(q.via === 'self' ? [] : [{ label: '併發症', value: pctText(q.complication), tone: q.complication > 0 ? 'warn' as const : 'plain' as const }]),
    { label: '登記', value: q.registered ? '登記在橋 ID 上' : '不登記' },
    ...selfRow(q.self, skillName),
  ]
}
type RemoveQ = { fee: number; pay: string | null; minutes: number; vanishes: boolean; via: string; self?: { skill: string; dc: number; bonus: number } }
export function removeRows(q: RemoveQ, skillName: (id: string) => string): Row[] {
  return [
    { label: '手術費', value: money(q.fee, q.pay) },
    { label: '手術時間', value: spanText(q.minutes) },
    ...(q.vanishes ? [{ label: '拆下之後', value: '這一件沒有了', tone: 'warn' as const }] : [{ label: '拆下之後', value: '收進背包（二手）' }]),
    ...selfRow(q.self, skillName),
  ]
}
type CapQ = { split: Record<string, number> }
type BridgeQ = InstallQ & { install_fee: number; replaces: { name: string; sink: number } | null; temp_sink: { amount: number; days: number } | null; keeps: boolean; before: CapQ; after: CapQ }
export function bridgeRows(q: BridgeQ, capName: (c: string) => string): Row[] {
  return [
    { label: '目錄價', value: q.price.toLocaleString('en-US') },
    { label: '安裝費', value: q.install_fee.toLocaleString('en-US') },
    { label: '實收', value: money(q.fee, q.pay), note: q.replaces ? '換橋是大手術，收安裝費的倍數' : undefined },
    { label: '沉溺成本', value: `+${q.sink}`, tone: 'warn', note: q.replaces ? `舊橋的 ${q.replaces.sink} 會拿回來` : undefined },
    ...(q.temp_sink ? [{ label: '暫時的沉溺', value: `+${q.temp_sink.amount}・${q.temp_sink.days} 天`, tone: 'warn' as const }] : []),
    { label: '手術時間', value: spanText(q.minutes) },
    { label: '休養', value: spanText(q.recovery_minutes) },
    ...(q.via === 'self' ? [] : [{ label: '併發症', value: pctText(q.complication), tone: q.complication > 0 ? 'warn' as const : 'plain' as const }]),
    ...Object.keys(q.after.split).map((c) => ({ label: `${capName(c)}容量`, value: `${q.before.split[c] ?? 0} → ${q.after.split[c]}` })),
    ...(q.replaces ? [{ label: '舊橋', value: q.keeps ? `${q.replaces.name}回到背包` : `${q.replaces.name}不留` }] : []),
  ]
}
type ModifyQ = { fee: number; pay: string | null; minutes: number; sink_before: number; sink_after: number; recovery_minutes: number; complication: number; via: string; old: { name: string } | null; next: { name: string } | null; self?: { skill: string; dc: number; bonus: number } }
export function modifyRows(q: ModifyQ, skillName: (id: string) => string): Row[] {
  return [
    { label: '換零件', value: `${q.old?.name ?? '（空的槽）'} → ${q.next?.name ?? '？'}` },
    { label: '手術費', value: money(q.fee, q.pay) },
    { label: '手術時間', value: spanText(q.minutes) },
    { label: '沉溺成本', value: `${q.sink_before} → ${q.sink_after}`, tone: q.sink_after > q.sink_before ? 'warn' : 'ok' },
    ...(q.recovery_minutes > 0 ? [{ label: '休養', value: spanText(q.recovery_minutes) }] : []),
    ...(q.via === 'self' ? [] : [{ label: '併發症', value: pctText(q.complication), tone: q.complication > 0 ? 'warn' as const : 'plain' as const }]),
    ...selfRow(q.self, skillName),
  ]
}
type RepairQ = { price: number; fee: number; pay: string | null; minutes: number; self?: { skill: string; dc: number; bonus: number } }
export function repairRows(q: RepairQ, skillName: (id: string) => string): Row[] {
  return [
    { label: '成品價', value: q.price.toLocaleString('en-US') },
    { label: '修理費', value: money(q.fee, q.pay) },
    { label: '花的時間', value: spanText(q.minutes) },
    ...selfRow(q.self, skillName),
  ]
}
type CrackQ = { dc: number; bonus: number; unlocker: boolean; holder?: string; faction?: string; minutes: number }
export function crackRows(q: CrackQ, holderName: (id: string) => string): Row[] {
  return [
    { label: '破解', value: `對 DC ${q.dc}・成功率 ${successPct(q.bonus, q.dc)}%`, note: `加值 ${signed(q.bonus)}${q.unlocker ? '（解鎖匠）' : ''}` },
    { label: '花的時間', value: spanText(q.minutes) },
    ...(q.faction ? [{ label: '失敗的代價', value: `${holderName(q.faction)}的敵對值上升`, tone: 'warn' as const }] : []),
  ]
}
type DetoxQ = { place: string; free: boolean; value: number; after: number; price: number; minutes: number; pay: string | null }
export function detoxRows(q: DetoxQ): Row[] {
  return [
    { label: '地方', value: q.place },
    { label: '成癮值', value: `${q.value} → ${q.after}`, tone: 'ok' },
    { label: '費用', value: q.free ? '不收錢' : money(q.price, q.pay) },
    { label: '花的時間', value: spanText(q.minutes) },
  ]
}
