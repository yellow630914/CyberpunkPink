// L6 功能 cyberware 的戰鬥格式：設計圖的 battle 欄位（工單 M4-cyber-battle；CYBERWARE 第 3、4 節；dev/adr/0019 P9、P10）。
// 反射加速器、熱驅動、冷卻迴路、藥泵都是資料，不替每一種寫程式：認的就是這個欄位。
//
//   battle.actions?  一次性的行動（冷卻迴路）：[{ id, name, icon, ap, uses?: { turn?, battle? }, do: 戰鬥的效果清單 }]
//   battle.toggle?   開關（反射加速器）：{ id, name, icon, levels?, upkeep_load: 整數 | { shallow, standard, deep, full }, mods: [{ mod, amount, tags?, layer? }] }
//                    開著時每個自己的回合開始感載加 upkeep_load（levels: true 時照檔位）；mods 用來源 cyber 生效；levels: true 時開的時候要選檔，另外吃同步表那一檔的檢定加減
//   battle.scaling?  照現在的感載給修正（熱驅動）：[{ mod, per_load, amount, tags? }]；tags 寫 melee 是「手上拿的是近戰武器」
//   battle.vs?       對手帶某個標籤時才有的修正（駭入接頭：裝置裡的蕾絲打進身上，感載 ×1.5）：[{ mod, amount, other_tags: 標籤（有一個就算）, tags? }]
//   battle.pump?     藥泵：true（一座放 cyber_rule.pump_doses 劑）或 { doses }
// 設計圖多讀 implant_kind?（失效與超頻用的種類：limb、eye、reflex……；沒寫用設計圖的 slot，arm 與 leg 都是 limb，甲板是 deck）。

import type { BlueprintEntry, Kernel, ProductData } from '../../core'
import { SYNC_GEARS, isRecord, isSafeInt, passiveProblems } from '../../core'
import type { SyncGear } from '../../core'

/** 同步回灌的標籤：寫在 load_taken_pct 的被動效果上（{ mod: 'load_taken_pct', amount: −10, tags: ['sync_backlash'] }），只減開關每回合加的那一份感載（緋櫻 奉公「回灌 −10%」）。 */
export const SYNC_BACKLASH = 'sync_backlash'

export interface BattleAction {
  id: string
  name: string
  icon: string
  ap: number
  /** 斷藥（狀態 pump_jam）時不能用（冷卻迴路）；藥泵自己的行動一定受它管 */
  jammable?: boolean
  uses?: { turn?: number; battle?: number }
  do: Array<Record<string, unknown>>
}

export interface BattleMod {
  mod: string
  amount: number
  tags?: string[]
  layer?: 'meat' | 'net'
}

export interface BattleToggle {
  id: string
  name: string
  icon: string
  levels: boolean
  upkeep: number | Partial<Record<SyncGear, number>>
  mods: BattleMod[]
}

export interface BattleScaling {
  mod: string
  per_load: number
  amount: number
  tags?: string[]
}

export interface BattleVs {
  mod: string
  amount: number
  other_tags: string[]
  tags?: string[]
}

export interface BattleDef {
  actions: BattleAction[]
  toggle?: BattleToggle
  scaling: BattleScaling[]
  vs: BattleVs[]
  /** 藥泵：doses 沒寫用規則表 */
  pump?: { doses?: number }
}

const isText = (v: unknown): v is string => typeof v === 'string' && v.trim().length > 0
const isTextList = (v: unknown): v is string[] => Array.isArray(v) && v.every(isText)
const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v)

// ---- 讀（寬鬆：不合格的那一項略過；載入時 battleProblems 已經擋過） ----

const readMods = (raw: unknown): BattleMod[] =>
  Array.isArray(raw)
    ? raw.flatMap((m) => (isRecord(m) && isText(m.mod) && isNum(m.amount) ? [{
      mod: m.mod, amount: m.amount, ...(isTextList(m.tags) && m.tags.length ? { tags: m.tags } : {}), ...(m.layer === 'meat' || m.layer === 'net' ? { layer: m.layer } : {}),
    }] : []))
    : []

/** 讀設計圖的 battle 欄位；沒寫或不是物件是 undefined。 */
export function readBattle(raw: unknown): BattleDef | undefined {
  if (!isRecord(raw)) return undefined
  const actions: BattleAction[] = Array.isArray(raw.actions)
    ? raw.actions.flatMap((a) => (isRecord(a) && isText(a.id) && isText(a.name) && isSafeInt(a.ap) && Array.isArray(a.do) ? [{
      id: a.id, name: a.name, icon: isText(a.icon) ? a.icon : a.id, ap: a.ap as number, ...(a.jammable === true ? { jammable: true } : {}),
      ...(isRecord(a.uses) ? { uses: { ...(isSafeInt(a.uses.turn) ? { turn: a.uses.turn as number } : {}), ...(isSafeInt(a.uses.battle) ? { battle: a.uses.battle as number } : {}) } } : {}),
      do: a.do.filter(isRecord) as Array<Record<string, unknown>>,
    }] : []))
    : []
  let toggle: BattleToggle | undefined
  const t = raw.toggle
  if (isRecord(t) && isText(t.id) && isText(t.name)) {
    const up = t.upkeep_load
    const upkeep: BattleToggle['upkeep'] = isNum(up) ? up : isRecord(up) ? Object.fromEntries(SYNC_GEARS.flatMap((g) => (isNum(up[g]) ? [[g, up[g] as number]] : []))) : 0
    toggle = { id: t.id, name: t.name, icon: isText(t.icon) ? t.icon : t.id, levels: t.levels === true, upkeep, mods: readMods(t.mods) }
  }
  const scaling: BattleScaling[] = Array.isArray(raw.scaling)
    ? raw.scaling.flatMap((s) => (isRecord(s) && isText(s.mod) && isSafeInt(s.per_load) && (s.per_load as number) >= 1 && isNum(s.amount) ? [{
      mod: s.mod, per_load: s.per_load as number, amount: s.amount, ...(isTextList(s.tags) && s.tags.length ? { tags: s.tags } : {}),
    }] : []))
    : []
  const vs: BattleVs[] = Array.isArray(raw.vs)
    ? raw.vs.flatMap((s) => (isRecord(s) && isText(s.mod) && isNum(s.amount) && isTextList(s.other_tags) && s.other_tags.length ? [{
      mod: s.mod, amount: s.amount, other_tags: s.other_tags, ...(isTextList(s.tags) && s.tags.length ? { tags: s.tags } : {}),
    }] : []))
    : []
  let pump: BattleDef['pump']
  if (raw.pump === true) pump = {}
  else if (isRecord(raw.pump) && isSafeInt(raw.pump.doses) && (raw.pump.doses as number) >= 1) pump = { doses: raw.pump.doses as number }
  return { actions, ...(toggle ? { toggle } : {}), scaling, vs, ...(pump ? { pump } : {}) }
}

/** 這一件的失效與超頻的種類：implant_kind，沒寫用設計圖的部位（eye……；手臂與腿都算 limb，規則表有 off_limb、boost_limb），甲板是 deck。 */
export function kindOfBlueprint(bp: Pick<BlueprintEntry, 'slot' | 'deck'> & { implant_kind?: unknown }): string {
  if (isText(bp.implant_kind)) return bp.implant_kind
  if (bp.deck) return 'deck'
  if (bp.slot === 'arm' || bp.slot === 'leg') return 'limb'
  return bp.slot ?? 'generic'
}

// ---- 載入時的檢查 ----

const ALLOWED = ['actions', 'toggle', 'scaling', 'vs', 'pump']
const ACTION_KEYS = ['id', 'name', 'icon', 'ap', 'uses', 'do', 'desc', 'jammable']
const TOGGLE_KEYS = ['id', 'name', 'icon', 'levels', 'upkeep_load', 'mods']
const SCALING_KEYS = ['mod', 'per_load', 'amount', 'tags']
const VS_KEYS = ['mod', 'amount', 'other_tags', 'tags']

/** battle 欄位的格式問題（每一條寫出是第幾筆、哪個欄位）；空的就是合格。效果清單用 k.battle.effectProblems 查，被動效果用 passiveProblems 查。 */
export function battleProblems(k: Pick<Kernel, 'battle' | 'conditions' | 'passives'>, raw: unknown): string[] {
  if (!isRecord(raw)) return ['battle 要是一個物件']
  const p: string[] = []
  for (const key of Object.keys(raw)) if (!ALLOWED.includes(key)) p.push(`battle.${key}：沒有這個欄位（可以寫：${ALLOWED.join('、')}）`)
  const unknownKeys = (at: string, o: Record<string, unknown>, keys: string[]): void => {
    for (const key of Object.keys(o)) if (!keys.includes(key)) p.push(`${at}.${key}：沒有這個欄位（可以寫：${keys.join('、')}）`)
  }
  const modKinds = k.passives.modKinds()
  const modOk = (at: string, m: unknown): void => {
    if (!isText(m)) p.push(`${at}.mod 要是戰鬥修正的種類`)
    else if (modKinds && !modKinds.includes(m)) p.push(`${at}.mod：「${m}」不是戰鬥修正的種類（可以寫：${modKinds.join('、')}）`)
  }

  if (raw.actions !== undefined) {
    if (!Array.isArray(raw.actions)) p.push('battle.actions 要是陣列')
    else raw.actions.forEach((a, i) => {
      const at = `battle.actions[${i}]`
      if (!isRecord(a)) { p.push(`${at} 要是 { id, name, icon, ap, do }`); return }
      unknownKeys(at, a, ACTION_KEYS)
      if (!isText(a.id)) p.push(`${at}.id 要是行動的 id`)
      if (!isText(a.name)) p.push(`${at}.name 要有名字`)
      if (!isText(a.icon)) p.push(`${at}.icon 要有圖示的鍵`)
      if (a.jammable !== undefined && typeof a.jammable !== 'boolean') p.push(`${at}.jammable 要是 true 或 false`)
      if (!(isSafeInt(a.ap) && (a.ap as number) >= 0 && (a.ap as number) <= 10)) p.push(`${at}.ap 要是 0～10 的整數`)
      if (a.uses !== undefined) {
        if (!isRecord(a.uses)) p.push(`${at}.uses 要是 { turn?, battle? }`)
        else {
          unknownKeys(`${at}.uses`, a.uses, ['turn', 'battle'])
          for (const key of ['turn', 'battle'] as const) if (a.uses[key] !== undefined && !(isSafeInt(a.uses[key]) && (a.uses[key] as number) >= 1)) p.push(`${at}.uses.${key} 要是 1 以上的整數`)
        }
      }
      if (!Array.isArray(a.do) || a.do.length === 0) p.push(`${at}.do 要是至少一筆效果的陣列`)
      else p.push(...k.battle.effectProblems(a.do).map((m) => `${at}.do：${m}`))
    })
  }

  if (raw.toggle !== undefined) {
    const t = raw.toggle
    const at = 'battle.toggle'
    if (!isRecord(t)) p.push(`${at} 要是 { id, name, icon, upkeep_load, mods }`)
    else {
      unknownKeys(at, t, TOGGLE_KEYS)
      if (!isText(t.id)) p.push(`${at}.id 要是行動的 id`)
      if (!isText(t.name)) p.push(`${at}.name 要有名字`)
      if (!isText(t.icon)) p.push(`${at}.icon 要有圖示的鍵`)
      if (t.levels !== undefined && typeof t.levels !== 'boolean') p.push(`${at}.levels 要是 true 或 false`)
      const up = t.upkeep_load
      const upOk = (v: unknown): boolean => isSafeInt(v) && (v as number) >= 0 && (v as number) <= 50
      if (up === undefined) p.push(`${at}.upkeep_load 要寫（沒有回灌寫 0）`)
      else if (isRecord(up)) {
        unknownKeys(`${at}.upkeep_load`, up, [...SYNC_GEARS])
        for (const g of SYNC_GEARS) if (up[g] !== undefined && !upOk(up[g])) p.push(`${at}.upkeep_load.${g} 要是 0～50 的整數`)
        if (t.levels === true) for (const g of SYNC_GEARS) if (up[g] === undefined) p.push(`${at}.upkeep_load.${g}：levels 是 true，四檔都要寫`)
      } else if (!upOk(up)) p.push(`${at}.upkeep_load 要是 0～50 的整數，或 { ${SYNC_GEARS.join('、')} }`)
      if (t.mods !== undefined) {
        if (!Array.isArray(t.mods)) p.push(`${at}.mods 要是陣列`)
        else {
          t.mods.forEach((m, i) => { if (!isRecord(m) || m.mod === undefined) p.push(`${at}.mods[${i}] 要是戰鬥的修正 { mod, amount, tags? }`) })
          p.push(...passiveProblems(k, t.mods, `${at}.mods`, 'cyber'))
        }
      }
    }
  }

  if (raw.scaling !== undefined) {
    if (!Array.isArray(raw.scaling)) p.push('battle.scaling 要是陣列')
    else raw.scaling.forEach((s, i) => {
      const at = `battle.scaling[${i}]`
      if (!isRecord(s)) { p.push(`${at} 要是 { mod, per_load, amount }`); return }
      unknownKeys(at, s, SCALING_KEYS)
      modOk(at, s.mod)
      if (!(isSafeInt(s.per_load) && (s.per_load as number) >= 1)) p.push(`${at}.per_load 要是 1 以上的整數（每幾點感載）`)
      if (!isNum(s.amount) || s.amount === 0) p.push(`${at}.amount 要是不為 0 的數字`)
      if (s.tags !== undefined && !isTextList(s.tags)) p.push(`${at}.tags 要是字串的陣列`)
    })
  }

  if (raw.vs !== undefined) {
    if (!Array.isArray(raw.vs)) p.push('battle.vs 要是陣列')
    else raw.vs.forEach((s, i) => {
      const at = `battle.vs[${i}]`
      if (!isRecord(s)) { p.push(`${at} 要是 { mod, amount, other_tags }`); return }
      unknownKeys(at, s, VS_KEYS)
      modOk(at, s.mod)
      if (!isNum(s.amount) || s.amount === 0) p.push(`${at}.amount 要是不為 0 的數字`)
      if (!isTextList(s.other_tags) || s.other_tags.length === 0) p.push(`${at}.other_tags 要是至少一個標籤的陣列`)
      if (s.tags !== undefined && !isTextList(s.tags)) p.push(`${at}.tags 要是字串的陣列`)
    })
  }

  if (raw.pump !== undefined && raw.pump !== true) {
    if (!isRecord(raw.pump) || !(isSafeInt(raw.pump.doses) && (raw.pump.doses as number) >= 1 && (raw.pump.doses as number) <= 9)) p.push('battle.pump 要是 true 或 { doses: 1～9 的整數 }')
  }
  return p
}

/** 型別用：成品資料裡要放的幾個鍵（戰地手術帶進戰鬥的整筆）。 */
export type FieldData = ProductData
