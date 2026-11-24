// 技能格式的檢查（載入內容時擋下寫壞的）：use（消耗）、meat（現實的效果）、prep（預備）、mods（被動的修正）。
// 規格：dev/work/M1-abilities.md 第四節（舊的鍵）、dev/work/M1b-skill-format.md 第一～五節（通用格式）。
// 訊息的開頭是欄位的路徑，裡面寫出那個不對的字（鍵、who、on、公式）。

import type { Kernel } from '../../core'
import { MOD_KINDS, STATUS_UNTILS, SYNC_GEARS, UNIT_RANKS, amountProblems, syncGearIndex } from '../../core'
import type { SyncGear } from '../../core'
import { FEATURE_MOD_KINDS, TRIGGER_ON } from './types'

export const isRec = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)
const isInt = (v: unknown): v is number => typeof v === 'number' && Number.isInteger(v)
const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v)
const isText = (v: unknown): v is string => typeof v === 'string' && v.trim().length > 0

/** 一個物件只能用清單裡的鍵；多出來的每一個鍵各一條訊息（訊息裡有鍵的名字）。 */
export function onlyKeys(at: string, v: Record<string, unknown>, keys: readonly string[]): string[] {
  return Object.keys(v).filter((key) => !keys.includes(key)).map((key) => `${at}.${key} 不是可以用的鍵（只有 ${keys.join('、')}）`)
}

// ---- 清單 ----

export const MEAT_TARGETS = ['enemy', 'ally', 'self', 'ally_slot', 'enemy_slot', 'none', 'ally_or_self', 'near', 'downed_near', 'foe_slot', 'own_overlay', 'foe_overlay'] as const
/** 目標是人的幾種（needs 只對它們有意思） */
export const UNIT_TARGETS: readonly string[] = ['enemy', 'ally', 'ally_or_self', 'near', 'downed_near']
export const MEAT_KEYS = [
  'target', 'attack', 'apply', 'free_move', 'cost', 'weapon_cost', 'trigger', 'evade', 'on_hit', 'give_ap', 'call', 'instinct', 'pending',
  'needs', 'when', 'range', 'picks', 'do', 'choose', 'mods', 'react', 'do_on', 'do_off', 'tags', 'action_tags', 'pool', 'alter', 'ransom', 'on_start', 'on_give_ap',
  'mask', 'tease', 'out', 'out_mods',
  // 內海（M3-abilities-net）：兩欄都可以寫
  'slots', 'admin', 'sync_cap', 'unique',
  // 內海（M3-skill-net-a）：被動的技能在這一欄多一個主動的行動（action）、技能做的快駭的追蹤度（trace）
  'action', 'trace',
  // 內海（M3-skill-net-b）：只有內海欄能寫
  'lure', 'masked', 'command', 'remote_call', 'flow', 'flow_bonus', 'link', 'song', 'on_link_overload', 'link_full', 'link_gear',
  // 給玩家看的說明（還沒有做成機制的 pending 欄用它寫原文；介面的技能卡讀它）
  'text',
] as const
export const CALL_OPTIONS = ['shot', 'cover_up', 'cover_down', 'heal', 'vent'] as const
/** 叫人的選項裡要自己寫數字的（call.heal、call.vent） */
const CALL_AMOUNT = ['heal', 'vent'] as const
export const SUPPRESS_AREAS = ['adjacent', 'row'] as const
const LEGACY_TRIGGERS = ['ally_attacked', 'ally_attacked_adjacent'] as const
export const USE_KEYS = ['ap', 'ram', 'admin', 'ram_all_min', 'cash', 'favor', 'per_turn', 'per_fight', 'per_commission', 'first_round', 'not_first_round', 'group', 'slot', 'note', 'weapon_ram'] as const
export const FAVORS = ['small', 'mid', 'big'] as const
export const WHEN_MEAT = ['wield', 'mag_min', 'hull', 'stance', 'slot', 'node_taken', 'wounded', 'sync_min', 'sync_max', 'flow_min'] as const
export const WHEN_MODS = [...WHEN_MEAT, 'first_round', 'in_cover', 'other_exposed', 'other_cyber', 'other_status', 'other_contract', 'target_near', 'first_attack', 'not_spotted'] as const
export const NEEDS_KEYS = ['bridged', 'cyber', 'status', 'no_rank', 'rank', 'wounded', 'afterglow', 'tag', 'no_tag', 'persona', 'cache_tag', 'implant_off', 'any'] as const
export const MOD_WHO = ['self', 'adjacent', 'allies', 'behind', 'linked'] as const
export const PICK_KINDS = ['foe', 'ally', 'ally_slot', 'foe_slot', 'choice', 'drone', 'foe_overlay', 'bench'] as const
export const PREP_SCOPES = ['next_battle', 'commission'] as const

/** 反應的 who（誰遇到這件事）：照 on 分。 */
export const TRIGGER_WHO: Record<string, readonly string[]> = {
  // own_overlay：自己的一台被打；with_own_overlay：被打的人（自己或隊友）那一格掛著自己的一台（reach 放寬到相鄰）；self_or_ally：自己或一名隊友（任何一個我方的人）
  attacked: ['self', 'adjacent', 'ally', 'self_or_ally', 'own_overlay', 'with_own_overlay'],
  hit: ['self', 'adjacent', 'ally', 'self_or_ally', 'own_overlay', 'with_own_overlay', 'foe_by_self'],
  after: ['self', 'adjacent', 'near', 'ally', 'self_or_ally', 'own_overlay', 'with_own_overlay', 'foe_by_self'],
  hp_half: ['self', 'near'],
  overload: ['self', 'ally', 'self_or_ally', 'foe_by_self'],
  checked: ['self', 'ally', 'self_or_ally', 'linked'],
  out_before: ['self', 'ally', 'self_or_ally', 'linked'],
}
/** 反應的 if：沒列的 on 不能寫 if（checked 的 if 是檢定的標籤，任何字都行）。 */
const TRIGGER_IF: Record<string, readonly string[]> = { hit: ['wound', 'crit'], after: ['miss', 'hit', 'crit', 'melee', 'bridged'] }
/** react 可以做的：照 on 分。 */
export const REACT_BY_ON: Record<string, readonly string[]> = {
  attacked: ['evade', 'hit', 'redirect', 'reach', 'no_wound', 'damage'],
  hit: ['negate', 'no_wound', 'pierce', 'then_move'],
  overload: ['keep_turn', 'flash', 'keep_link'],
  checked: ['dc'],
  out_before: ['prevent'],
}
const REACT_KEYS = ['evade', 'hit', 'redirect', 'reach', 'no_wound', 'negate', 'keep_turn', 'dc', 'prevent', 'pierce', 'then_move', 'damage', 'flash', 'keep_link'] as const

// ---- 公式 ----

/** 公式裡有沒有擲骰的項（NdM；N 也可以是名字）。 */
export function hasDice(expr: string): boolean {
  return expr.split('+').some((piece) => /^(\d+|tier|grade|spent|half_tier_up|half_tier_down)d\d+$/.test(piece.split('*')[0]!.trim()))
}

/** 數字或公式；不准擲骰（消耗與修正會被反覆查詢，不能每次問都動亂數）。 */
function plainFormula(at: string, v: unknown): string[] {
  if (typeof v === 'number') return Number.isFinite(v) ? [] : [`${at} 要是有限的數字`]
  const p = amountProblems(v)
  if (p.length) return p.map((m) => `${at}：${m}`)
  if (typeof v === 'string' && hasDice(v)) return [`${at}「${v}」不能擲骰（這個數字會被反覆查詢）`]
  return []
}

// ---- use ----

function useSetProblems(at: string, u: Record<string, unknown>, kind: unknown): string[] {
  const p = onlyKeys(at, u, USE_KEYS)
  if (u.ap !== undefined && !(isInt(u.ap) && u.ap >= 0)) p.push(`${at}.ap 要是 0 以上的整數`)
  if (u.ram !== undefined && !(isInt(u.ram) && u.ram >= 0)) p.push(`${at}.ram 要是 0 以上的整數`)
  if (u.admin !== undefined && !(isInt(u.admin) && u.admin >= 1)) p.push(`${at}.admin 要是 1 以上的整數（花幾次管理行動）`)
  if (u.ram_all_min !== undefined && !(isInt(u.ram_all_min) && u.ram_all_min >= 1)) p.push(`${at}.ram_all_min 要是 1 以上的整數`)
  if (u.ram !== undefined && u.ram_all_min !== undefined) p.push(`${at}.ram 與 ${at}.ram_all_min 只能寫一個`)
  if (u.cash !== undefined) p.push(...plainFormula(`${at}.cash`, u.cash))
  if (u.favor !== undefined && !(FAVORS as readonly unknown[]).includes(u.favor)) p.push(`${at}.favor 只能是 ${FAVORS.join('、')}（拿到 ${String(u.favor)}）`)
  for (const key of ['per_turn', 'per_fight', 'per_commission'] as const) {
    if (u[key] !== undefined && !(isInt(u[key]) && (u[key] as number) >= 1)) p.push(`${at}.${key} 要是 1 以上的整數`)
  }
  if (u.first_round !== undefined && typeof u.first_round !== 'boolean') p.push(`${at}.first_round 要是 true 或 false`)
  if (u.not_first_round !== undefined && typeof u.not_first_round !== 'boolean') p.push(`${at}.not_first_round 要是 true 或 false`)
  if (u.first_round === true && u.not_first_round === true) p.push(`${at}.first_round 與 ${at}.not_first_round 不能同時是 true`)
  if (u.group !== undefined) {
    if (!isText(u.group)) p.push(`${at}.group 要是組的名字（字串）`)
    else if (u.per_turn === undefined) p.push(`${at}.group「${u.group}」要和 per_turn 一起寫（同一組的技能合起來算這個次數）`)
  }
  if (u.slot !== undefined) {
    if (!(isInt(u.slot) && u.slot >= 1)) p.push(`${at}.slot 要是 1 以上的整數（幾個時段）`)
    else if (kind !== 'prep' && kind !== 'daily') p.push(`${at}.slot 只有預備與日常（kind 是 prep、daily）用`)
  }
  if (u.note !== undefined && typeof u.note !== 'string') p.push(`${at}.note 要是字串`)
  if (u.weapon_ram !== undefined && u.weapon_ram !== true) p.push(`${at}.weapon_ram 只能是 true（再加上手上武器構裝自己的 RAM 花費）`)
  return p
}

/** use：直接一組，或照戰場分 meat、net、opinion。 */
export function useProblems(u: unknown, kind: unknown): string[] {
  if (u === undefined) return []
  if (!isRec(u)) return ['use 要是 { ap?, ram?, admin?, cash?, favor?, per_turn?, per_fight?, per_commission?, ... }，或照戰場分的 { meat?, net?, opinion? }']
  if ('meat' in u || 'net' in u || 'opinion' in u) {
    const p = onlyKeys('use', u, ['meat', 'net', 'opinion'])
    for (const col of ['meat', 'net', 'opinion']) {
      if (u[col] === undefined) continue
      if (!isRec(u[col])) p.push(`use.${col} 要是一組消耗的物件`)
      else {
        p.push(...useSetProblems(`use.${col}`, u[col] as Record<string, unknown>, kind))
        // 管理行動是內海的消耗：現實與輿論那一組不能寫
        if (col !== 'net' && (u[col] as Record<string, unknown>).admin !== undefined) p.push(`use.${col}.admin 只有內海用（寫在 use.net，或直接寫的那一組）`)
        if (col !== 'net' && (u[col] as Record<string, unknown>).weapon_ram !== undefined) p.push(`use.${col}.weapon_ram 只有內海用（寫在 use.net，或直接寫的那一組）`)
      }
    }
    return p
  }
  return useSetProblems('use', u, kind)
}

// ---- when、needs、mods ----

export function whenProblems(at: string, w: unknown, allowed: readonly string[]): string[] {
  if (!isRec(w)) return [`${at} 要是物件（${allowed.join('、')}）`]
  const p = onlyKeys(at, w, allowed)
  if (w.wield !== undefined && !(isText(w.wield) || (Array.isArray(w.wield) && w.wield.length > 0 && w.wield.every(isText)))) p.push(`${at}.wield 要是武器類型（字串，或字串的陣列）`)
  if (w.mag_min !== undefined && !(isInt(w.mag_min) && w.mag_min >= 1)) p.push(`${at}.mag_min 要是 1 以上的整數`)
  if (w.hull !== undefined && typeof w.hull !== 'boolean') p.push(`${at}.hull 要是 true 或 false`)
  if (w.stance !== undefined && !isText(w.stance)) p.push(`${at}.stance 要是姿態技能的 id`)
  if (w.slot !== undefined && !((isInt(w.slot) && w.slot >= 1 && w.slot <= 4) || (Array.isArray(w.slot) && w.slot.length > 0 && w.slot.every((x) => isInt(x) && x >= 1 && x <= 4)))) p.push(`${at}.slot 要是 1～4 的整數（或整數的陣列）`)
  if (w.node_taken !== undefined && !(w.node_taken === true || isText(w.node_taken))) p.push(`${at}.node_taken 要是 true 或控制節點的種類`)
  for (const key of ['first_round', 'in_cover', 'other_exposed', 'other_cyber', 'other_contract', 'target_near', 'first_attack', 'not_spotted'] as const) {
    if (w[key] !== undefined && w[key] !== true) p.push(`${at}.${key} 只能是 true`)
  }
  if (w.other_status !== undefined && !isText(w.other_status)) p.push(`${at}.other_status 要是狀態的 id`)
  if (w.wounded !== undefined && w.wounded !== true) p.push(`${at}.wounded 只能是 true`)
  if (w.flow_min !== undefined && !(isInt(w.flow_min) && w.flow_min >= 1)) p.push(`${at}.flow_min 要是 1 以上的整數（導流階至少多少）`)
  for (const key of ['sync_min', 'sync_max'] as const) {
    if (w[key] !== undefined && !(SYNC_GEARS as readonly unknown[]).includes(w[key])) p.push(`${at}.${key} 要是同步檔位：${SYNC_GEARS.join('、')}（拿到 ${String(w[key])}）`)
  }
  if ((SYNC_GEARS as readonly unknown[]).includes(w.sync_min) && (SYNC_GEARS as readonly unknown[]).includes(w.sync_max) && syncGearIndex(w.sync_min as SyncGear) > syncGearIndex(w.sync_max as SyncGear)) p.push(`${at}.sync_min 不能比 sync_max 深（${String(w.sync_min)} > ${String(w.sync_max)}，這樣永遠不成立）`)
  return p
}

export function needsProblems(at: string, n: unknown, inAny = false): string[] {
  if (!isRec(n)) return [`${at} 要是物件（${NEEDS_KEYS.join('、')}）`]
  const p = onlyKeys(at, n, inAny ? NEEDS_KEYS.filter((x) => x !== 'any') : NEEDS_KEYS)
  if (n.any !== undefined && !inAny) {
    if (!Array.isArray(n.any) || n.any.length < 2) p.push(`${at}.any 要是兩組以上的條件（成立任何一組就算）`)
    else n.any.forEach((x, i) => p.push(...needsProblems(`${at}.any[${i}]`, x, true)))
  }
  for (const key of ['bridged', 'cyber'] as const) if (n[key] !== undefined && typeof n[key] !== 'boolean') p.push(`${at}.${key} 要是 true 或 false`)
  if (n.wounded !== undefined && n.wounded !== true) p.push(`${at}.wounded 只能是 true`)
  if (n.status !== undefined && !(isText(n.status) || (Array.isArray(n.status) && n.status.length > 0 && n.status.every(isText)))) p.push(`${at}.status 要是狀態的 id（字串，或字串的陣列）`)
  for (const key of ['no_rank', 'rank'] as const) {
    const v = n[key]
    if (v === undefined) continue
    if (!(Array.isArray(v) && v.length > 0 && v.every((x) => (UNIT_RANKS as readonly unknown[]).includes(x)))) p.push(`${at}.${key} 要是位階的陣列，只能用 ${UNIT_RANKS.join('、')}`)
  }
  if (n.afterglow !== undefined && !(isInt(n.afterglow) && n.afterglow >= 1)) p.push(`${at}.afterglow 要是 1 以上的整數（層數）`)
  if (n.tag !== undefined && !isText(n.tag)) p.push(`${at}.tag 要是標籤`)
  if (n.no_tag !== undefined && !(isText(n.no_tag) || (Array.isArray(n.no_tag) && n.no_tag.length > 0 && n.no_tag.every(isText)))) p.push(`${at}.no_tag 要是標籤（字串，或字串的陣列：帶著任何一個就不行）`)
  if (n.persona !== undefined && n.persona !== true) p.push(`${at}.persona 只能是 true（目標有人格：化身，或帶 persona 標籤的蕾絲）`)
  if (n.implant_off !== undefined && n.implant_off !== true) p.push(`${at}.implant_off 只能是 true（目標身上已經有一件被干擾的義體）`)
  if (n.cache_tag !== undefined && !isText(n.cache_tag)) p.push(`${at}.cache_tag 要是道具的標籤（目標的快取格裡有帶這個標籤的道具）`)
  return p
}

export function modsProblems(at: string, list: unknown): string[] {
  if (!Array.isArray(list) || list.length === 0) return [`${at} 要是修正的陣列（每一筆 { kind, value }）`]
  const p: string[] = []
  list.forEach((m, i) => {
    const here = `${at}[${i}]`
    if (!isRec(m)) return void p.push(`${here} 要是 { kind, value, ... }`)
    p.push(...onlyKeys(here, m, ['kind', 'value', 'tags', 'tags_any', 'min', 'who', 'when', 'per_fight', 'per_turn', 'to', 'vs_source']))
    if (m.vs_source !== undefined && m.vs_source !== true) p.push(`${here}.vs_source 只能是 true（只對給這一段修正的人有效，buff 的 mods 用）`)
    if (!(MOD_KINDS as readonly unknown[]).includes(m.kind) && !(FEATURE_MOD_KINDS as readonly unknown[]).includes(m.kind)) p.push(`${here}.kind「${String(m.kind)}」不是修正的種類（可以寫：${[...MOD_KINDS, ...FEATURE_MOD_KINDS].join('、')}）`)
    if (m.to !== undefined) {
      if (m.kind !== 'crit_margin' && m.kind !== 'action_ap') p.push(`${here}.to 只有 crit_margin（改成超過迴避幾以上就算要害）、action_ap（這個行動改成只花幾點）用`)
      else if (!isNum(m.to)) p.push(`${here}.to 要是數字`)
      else if (m.kind === 'action_ap' && !(isInt(m.to) && m.to >= 0)) p.push(`${here}.to 要是 0 以上的整數（action_ap：改成只花幾點）`)
      if (m.value !== undefined) p.push(`${here} 的 value 與 to 只能寫一個`)
    } else if (m.value === undefined) p.push(`${here}.value 一定要寫（數字、公式，或 { by_tier: [五個數字] }）`)
    if (m.value !== undefined) {
      const v = m.value
      if (isRec(v)) {
        p.push(...onlyKeys(`${here}.value`, v, ['by_tier']))
        if (!(Array.isArray(v.by_tier) && v.by_tier.length === 5 && v.by_tier.every(isNum))) p.push(`${here}.value.by_tier 要是五個數字（照樹階 1～5 查表）`)
      } else if (m.kind === 'damage_roll' || m.kind === 'tease_bonus') p.push(...amountProblems(v).map((x) => `${here}.value：${x}`))
      else p.push(...plainFormula(`${here}.value`, v))
    }
    if (m.tags !== undefined && !(Array.isArray(m.tags) && m.tags.length > 0 && m.tags.every(isText))) p.push(`${here}.tags 要是標籤的陣列`)
    if (m.tags_any !== undefined && !(Array.isArray(m.tags_any) && m.tags_any.length > 0 && m.tags_any.every(isText))) p.push(`${here}.tags_any 要是標籤的陣列（有其中任何一個就算）`)
    if (m.min !== undefined && !isNum(m.min)) p.push(`${here}.min 要是數字（算出來的數字不低於它）`)
    if (m.who !== undefined && !(MOD_WHO as readonly unknown[]).includes(m.who)) p.push(`${here}.who「${String(m.who)}」不在清單裡（可以寫：${MOD_WHO.join('、')}）`)
    if (m.when !== undefined) p.push(...whenProblems(`${here}.when`, m.when, WHEN_MODS))
    for (const key of ['per_fight', 'per_turn'] as const) {
      if (m[key] === undefined) continue
      if (!(isInt(m[key]) && (m[key] as number) >= 1)) p.push(`${here}.${key} 要是 1 以上的整數`)
      else if (m.kind !== 'action_ap' && m.kind !== 'action_ram' && m.kind !== 'ram_free') p.push(`${here}.${key} 只有 action_ap、action_ram、ram_free 的修正用（次數在行動做完時記）`)
    }
  })
  return p
}

// ---- ai（敵人招牌行動的 AI 資料） ----

export const AI_KEYS = ['score', 'first_rounds', 'when', 'unlock'] as const

/** ai：{ score, first_rounds?, when?, unlock? }（types.ts 的 AbilityAi）。 */
export function aiProblems(ai: unknown): string[] {
  if (!isRec(ai)) return ['ai 要是 { score, first_rounds?, when?, unlock? }']
  const p = onlyKeys('ai', ai, AI_KEYS)
  if (!(isNum(ai.score) && ai.score > 0)) p.push('ai.score 要是大於 0 的數字（基準分，武器攻擊是 2）')
  if (ai.first_rounds !== undefined && !isNum(ai.first_rounds)) p.push('ai.first_rounds 要是數字（第一、二回合多加幾分）')
  if (ai.unlock !== undefined && ai.unlock !== 'low') p.push(`ai.unlock 只能是 low（拿到 ${String(ai.unlock)}）`)
  if (ai.when !== undefined) {
    p.push(...whenProblems('ai.when', ai.when, [...WHEN_MODS, 'target_hp_below']))
    const t = isRec(ai.when) ? ai.when.target_hp_below : undefined
    if (t !== undefined && !(isNum(t) && t > 0 && t <= 1)) p.push('ai.when.target_hp_below 要是 0～1 的數字（目標的生命比例低於它才列）')
  }
  return p
}

// ---- 效果清單 ----

function effectsProblems(k: Pick<Kernel, 'battle'> | undefined, at: string, list: unknown): string[] {
  if (!Array.isArray(list) || list.length === 0) return [`${at} 要是效果的陣列（每一筆 { op, ... }）`]
  if (!k) return []
  return k.battle.effectProblems(list).map((m) => `${at}：${m}`)
}

// ---- meat ----

function suppressProblems(s: unknown): string[] {
  if (!isRec(s)) return ['meat.attack.suppress 要是 { dc, skill }（可以再加 area、dc_bonus；姿態是 { auto: true, per_turn? }）']
  const p = onlyKeys('meat.attack.suppress', s, ['dc', 'skill', 'area', 'dc_bonus', 'auto', 'per_turn', 'first_round'])
  if (s.auto !== undefined) {
    if (s.auto !== true) p.push('meat.attack.suppress.auto 只能是 true')
    for (const key of ['dc', 'skill', 'area', 'dc_bonus']) if (s[key] !== undefined) p.push(`meat.attack.suppress.${key} 不能和 auto 一起寫（auto 是命中就壓制、不必檢定）`)
    if (s.per_turn !== undefined && !(isInt(s.per_turn) && s.per_turn >= 1)) p.push('meat.attack.suppress.per_turn 要是 1 以上的整數')
    if (s.first_round !== undefined && s.first_round !== true) p.push('meat.attack.suppress.first_round 只能是 true')
    return p
  }
  if (s.per_turn !== undefined) p.push('meat.attack.suppress.per_turn 只有 auto 用')
  if (s.first_round !== undefined) p.push('meat.attack.suppress.first_round 只有 auto 用')
  if (!(s.dc === 'spent' || (isNum(s.dc) && s.dc > 0))) p.push("meat.attack.suppress.dc 要是 'spent' 或正數")
  if (!isText(s.skill)) p.push('meat.attack.suppress.skill 要是基本功的 id')
  if (s.area !== undefined && !(SUPPRESS_AREAS as readonly unknown[]).includes(s.area)) p.push(`meat.attack.suppress.area「${String(s.area)}」不在清單裡（可以寫：${SUPPRESS_AREAS.join('、')}）`)
  if (s.dc_bonus !== undefined && !isNum(s.dc_bonus)) p.push('meat.attack.suppress.dc_bonus 要是數字')
  return p
}

function attackProblems(a: unknown): string[] {
  if (!isRec(a)) return ['meat.attack 要是物件']
  const p = onlyKeys('meat.attack', a, ['aimed', 'hit', 'spend', 'min_mag', 'dice', 'suppress', 'at', 'free_mag'])
  if (a.aimed !== undefined && typeof a.aimed !== 'boolean') p.push('meat.attack.aimed 要是 true 或 false')
  if (a.hit !== undefined && !isNum(a.hit)) p.push('meat.attack.hit 要是數字')
  if (a.spend !== undefined && a.spend !== 'all' && !(isInt(a.spend) && a.spend >= 1)) p.push("meat.attack.spend 只能是 'all' 或 1 以上的整數（花彈匣幾格）")
  if (a.min_mag !== undefined && !(isInt(a.min_mag) && a.min_mag >= 1)) p.push('meat.attack.min_mag 要是 1 以上的整數')
  if (a.dice !== undefined && a.dice !== 'spent_minus_1') p.push("meat.attack.dice 只能是 'spent_minus_1'")
  if (a.at !== undefined && a.at !== 'attacker') p.push("meat.attack.at 只能是 'attacker'")
  if (a.free_mag !== undefined) {
    if (a.free_mag !== true) p.push('meat.attack.free_mag 只能是 true')
    else if (a.spend === undefined) p.push('meat.attack.free_mag 要和 spend 一起寫（花掉的格數照算，只是不扣彈匣）')
  }
  if (a.suppress !== undefined) p.push(...suppressProblems(a.suppress))
  return p
}

function triggerProblems(m: Record<string, unknown>): string[] {
  const t = m.trigger
  if (typeof t === 'string') {
    const p: string[] = []
    if (!(LEGACY_TRIGGERS as readonly unknown[]).includes(t)) p.push(`meat.trigger 只能是 ${LEGACY_TRIGGERS.join('、')}（舊的字串寫法），或是 { on, who, if? }（拿到「${t}」）`)
    if (m.react !== undefined) p.push('meat.react 要搭配 { on, who } 的 trigger（舊的字串寫法不用它）')
    return p
  }
  if (!isRec(t)) return [`meat.trigger 要是 { on, who, if? }（或舊的字串 ${LEGACY_TRIGGERS.join('、')}）`]
  const p = onlyKeys('meat.trigger', t, ['on', 'who', 'if', 'by', 'tag'])
  if (t.tag !== undefined) {
    if (!isText(t.tag)) p.push('meat.trigger.tag 要是標籤（這一擊帶著這個標籤才算）')
    else if (!['attacked', 'hit', 'after'].includes(t.on as string)) p.push('meat.trigger.tag 只有 attacked、hit、after 用（看這一擊的標籤）')
  }
  if (t.by !== undefined) {
    const b = t.by
    if (!isRec(b)) p.push('meat.trigger.by 要是 { needs?, range? }（做這件事的人要符合的條件）')
    else {
      p.push(...onlyKeys('meat.trigger.by', b, ['needs', 'range']))
      if (b.needs === undefined && b.range === undefined) p.push('meat.trigger.by 要寫 needs 或 range')
      if (b.needs !== undefined) p.push(...needsProblems('meat.trigger.by.needs', b.needs))
      if (b.range !== undefined && !(Array.isArray(b.range) && b.range.length === 2 && isInt(b.range[0]) && isInt(b.range[1]) && b.range[0] >= 1 && b.range[1] >= b.range[0])) p.push('meat.trigger.by.range 要是 [近, 遠]：兩個整數，近是 1 以上、遠不小於近')
    }
  }
  const on = t.on
  if (!(TRIGGER_ON as readonly unknown[]).includes(on)) {
    p.push(`meat.trigger.on「${String(on)}」不在清單裡（可以寫：${TRIGGER_ON.join('、')}）`)
    return p
  }
  const who = TRIGGER_WHO[on as string]!
  if (!who.includes(t.who as string)) p.push(`meat.trigger.who「${String(t.who)}」不能用在 ${on}（可以寫：${who.join('、')}）`)
  if (t.if !== undefined) {
    const allowed = TRIGGER_IF[on as string]
    if (on === 'checked') {
      if (!isText(t.if)) p.push('meat.trigger.if 要是檢定的標籤（例如 hack、seduce）')
    } else if (!allowed) p.push(`meat.trigger.if 不能用在 ${on}`)
    else if (!allowed.includes(t.if as string)) p.push(`meat.trigger.if「${String(t.if)}」不能用在 ${on}（可以寫：${allowed.join('、')}）`)
  }
  if (m.react !== undefined) {
    const r = m.react
    const ok = REACT_BY_ON[on as string] ?? []
    if (!isRec(r)) p.push('meat.react 要是物件')
    else {
      p.push(...onlyKeys('meat.react', r, REACT_KEYS))
      for (const key of Object.keys(r)) if ((REACT_KEYS as readonly string[]).includes(key) && !ok.includes(key)) p.push(`meat.react.${key} 不能用在 ${on}（${on} 的 react 只有 ${ok.length ? ok.join('、') : '沒有；用 do'}）`)
      for (const key of ['evade', 'hit', 'dc', 'pierce', 'damage'] as const) if (r[key] !== undefined) p.push(...plainFormula(`meat.react.${key}`, r[key]))
      if (r.flash !== undefined) {
        const f = r.flash
        if (!isRec(f)) p.push("meat.react.flash 要是 { ram?: 'half' | 'before' | 'full', end?: true }")
        else {
          p.push(...onlyKeys('meat.react.flash', f, ['ram', 'end']))
          if (f.ram !== undefined && !['half', 'before', 'full'].includes(f.ram as string)) p.push(`meat.react.flash.ram 只能是 half、before、full（拿到 ${String(f.ram)}）`)
          if (f.end !== undefined && f.end !== true) p.push('meat.react.flash.end 只能是 true')
          if (f.ram === undefined && f.end === undefined) p.push('meat.react.flash 要寫 ram 或 end')
        }
      }
      if (r.redirect !== undefined && r.redirect !== 'overlay') p.push("meat.react.redirect 只能是 'overlay'")
      if (r.reach !== undefined) {
        if (!(isInt(r.reach) && r.reach >= 0 && r.reach <= 3)) p.push('meat.react.reach 要是 0～3 的整數（擋槍的無人機和被打的人差幾格以內）')
        else if (r.redirect !== 'overlay') p.push("meat.react.reach 要和 redirect: 'overlay' 一起寫")
      }
      for (const key of ['no_wound', 'negate', 'keep_turn', 'then_move'] as const) if (r[key] !== undefined && r[key] !== true) p.push(`meat.react.${key} 只能是 true`)
      if (r.then_move === true && r.negate !== true) p.push('meat.react.then_move 要和 negate 一起寫（這一擊沒有傷害，被打的人才換位）')
      if (r.prevent !== undefined) {
        const pv = r.prevent
        if (!isRec(pv) || !(Array.isArray(pv.how) && pv.how.length > 0 && pv.how.every(isText))) p.push('meat.react.prevent 要是 { how: [退出的方式…] }（down、burnout、subdued……）')
        else p.push(...onlyKeys('meat.react.prevent', pv, ['how']))
      }
    }
  } else if (m.do === undefined) p.push('meat.trigger 要搭配 react 或 do，不然反應什麼都不做')
  return p
}

/** 資源池的加減：{ <池的 id>: { max?, regen? } }（meat.pool 與共鳴的 effect.pool 共用）。 */
export function poolProblems(at: string, pool: unknown): string[] {
  if (!isRec(pool) || Object.keys(pool).length === 0) return [`${at} 要是 { <池的 id>: { max?, regen? } }`]
  const p: string[] = []
  for (const [id, v] of Object.entries(pool)) {
    if (!isRec(v)) p.push(`${at}.${id} 要是 { max?, regen? }`)
    else {
      p.push(...onlyKeys(`${at}.${id}`, v, ['max', 'regen']))
      for (const key of ['max', 'regen']) if (v[key] !== undefined && !isInt(v[key])) p.push(`${at}.${id}.${key} 要是整數（加減幾點）`)
    }
  }
  return p
}

/** 戰鬥外的檢定修正 { tags?, skill?, value }：tags 與 skill 至少要寫一個。 */
export function outModProblems(at: string, m: unknown): string[] {
  if (!isRec(m)) return [`${at} 要是 { tags?, skill?, value }`]
  const p = onlyKeys(at, m, ['tags', 'skill', 'value'])
  if (m.tags !== undefined && !(Array.isArray(m.tags) && m.tags.length > 0 && m.tags.every(isText))) p.push(`${at}.tags 要是標籤的陣列（檢定帶著這些標籤才算）`)
  if (m.skill !== undefined && !isText(m.skill)) p.push(`${at}.skill 要是基本功的 id`)
  if (m.tags === undefined && m.skill === undefined) p.push(`${at}：tags 與 skill 至少要寫一個`)
  if (!isNum(m.value) || m.value === 0) p.push(`${at}.value 要是數字（檢定加多少，不能是 0）`)
  return p
}

export function outModListProblems(at: string, list: unknown): string[] {
  if (!Array.isArray(list) || list.length === 0) return [`${at} 要是修正的陣列（每一筆 { tags?, skill?, value }）`]
  return list.flatMap((m, i) => outModProblems(`${at}[${i}]`, m))
}

/** 誘惑攻擊的格式（meat.tease 與效果 { op: 'tease' } 共用欄位）：k 沒給就不查 on_ok、on_overload 裡的 op。 */
export function teaseFieldProblems(at: string, t: Record<string, unknown>, k?: Pick<Kernel, 'battle'>): string[] {
  const p: string[] = []
  if (t.hit !== undefined) p.push(...plainFormula(`${at}.hit`, t.hit))
  if (t.bonus !== undefined) p.push(...amountProblems(t.bonus).map((x) => `${at}.bonus：${x}`))
  if (t.targets !== undefined && t.targets !== 1 && t.targets !== 2) p.push(`${at}.targets 只能是 1 或 2（傾城對兩個目標各做一次）`)
  for (const key of ['on_ok', 'on_overload'] as const) if (t[key] !== undefined) p.push(...effectsProblems(k, `${at}.${key}`, t[key]))
  return p
}

function teaseProblems(m: Record<string, unknown>, kind: unknown, k?: Pick<Kernel, 'battle'>, key: 'tease' | 'lure' = 'tease'): string[] {
  const t = m[key]
  const at = `meat.${key}`
  if (!isRec(t)) return [`${at} 要是 { hit?, bonus?, on_ok?, on_overload?, targets? }（基本的誘惑攻擊寫 {}）`]
  const p = onlyKeys(at, t, ['hit', 'bonus', 'on_ok', 'on_overload', 'targets'])
  p.push(...teaseFieldProblems(at, t, k))
  if (kind !== 'active' && kind !== 'passive') p.push(`${at} 只有主動技能（它的行動就是一次誘惑攻擊）與被動（入戲：多一個基本的誘惑攻擊行動）用；反應寫 do: [{ op: 'tease' }]`)
  if (m.do !== undefined || m.choose !== undefined || m.attack !== undefined) p.push(`${at} 不能和 do、choose、attack 一起寫（誘惑攻擊就是這個行動做的事）`)
  if (m.target !== undefined && m.target !== 'enemy') p.push(`${at} 的 target 只能是 enemy（拿到 ${String(m.target)}）`)
  if (m.picks !== undefined) p.push(`${at} 不能自己寫 picks（targets: 2 時第二個目標由格式補）`)
  if (m.tease !== undefined && m.lure !== undefined) p.push('meat.tease 與 meat.lure 只能寫一個')
  return p
}

/** 內海才有的鍵（M3-skill-net-b）：現實欄寫了整筆擋下；內海欄的格式在 netOnlyProblems。 */
export const NET_ONLY_KEYS = ['lure', 'masked', 'command', 'remote_call', 'flow', 'flow_bonus', 'link', 'song', 'on_link_overload', 'link_full', 'link_gear'] as const

function netOnlyProblems(m: Record<string, unknown>, kind: unknown, k?: Pick<Kernel, 'battle'>): string[] {
  const p: string[] = []
  if (m.lure !== undefined) p.push(...teaseProblems(m, kind, k, 'lure'))
  if (m.masked !== undefined) {
    if (m.masked !== true) p.push('meat.masked 只能是 true')
    else if (kind !== 'passive') p.push('meat.masked 只有被動（kind 是 passive）用：裝著就戴著面具')
  }
  if (m.command !== undefined) {
    if (!isRec(m.command) || !(isInt(m.command.max) && m.command.max >= 1)) p.push('meat.command 要是 { max: 1 以上的整數 }（每回合最多讓幾點行動點）')
    else p.push(...onlyKeys('meat.command', m.command, ['max']))
    if (kind !== 'passive') p.push('meat.command 只有被動（kind 是 passive）用：招牌多一個指揮的行動')
  }
  if (m.remote_call !== undefined) {
    const c = m.remote_call
    if (!isRec(c)) p.push('meat.remote_call 要是 { options, per_fight, ap, path }')
    else {
      p.push(...onlyKeys('meat.remote_call', c, ['options', 'per_fight', 'ap', 'path', 'vent']))
      if (!(Array.isArray(c.options) && c.options.length >= 1 && c.options.every((o) => ['hack', 'wall', 'vent'].includes(o as string)))) p.push('meat.remote_call.options 要是至少一個，只能用 hack、wall、vent')
      if (!(isInt(c.per_fight) && c.per_fight >= 1)) p.push('meat.remote_call.per_fight 要是 1 以上的整數')
      if (!(isInt(c.ap) && c.ap >= 0)) p.push('meat.remote_call.ap 要是 0 以上的整數')
      if (!isText(c.path)) p.push('meat.remote_call.path 要是路數的 id（名冊上帶這條路數的人才叫得到）')
      if (c.vent !== undefined) p.push(...amountProblems(c.vent).map((x) => `meat.remote_call.vent：${x}`))
      else if (Array.isArray(c.options) && c.options.includes('vent')) p.push('meat.remote_call.vent 一定要寫（options 有 vent：排幾點）')
    }
    if (kind !== 'passive') p.push('meat.remote_call 只有被動（kind 是 passive）用：招牌多一個遠端叫人的行動')
  }
  if (m.flow !== undefined) {
    if (!isRec(m.flow)) p.push('meat.flow 要是 { cap? }')
    else {
      p.push(...onlyKeys('meat.flow', m.flow, ['cap']))
      if (m.flow.cap !== undefined && !(isInt(m.flow.cap) && m.flow.cap >= 0)) p.push('meat.flow.cap 要是 0 以上的整數（導流階最多算幾）')
    }
  }
  if (m.flow_bonus !== undefined && !(isInt(m.flow_bonus) && m.flow_bonus !== 0)) p.push('meat.flow_bonus 要是整數（導流階加減幾，不能是 0）')
  if (m.link !== undefined) {
    if (m.link !== true) p.push('meat.link 只能是 true')
    else if (kind !== 'passive') p.push('meat.link 只有被動（kind 是 passive）用：招牌多一個接上隊友的行動')
  }
  if (m.song !== undefined) {
    if (m.song !== true) p.push('meat.song 只能是 true')
    else if (kind !== 'stance') p.push('meat.song 只有姿態（kind 是 stance）用：曲目')
  }
  for (const key of ['link_full', 'link_gear'] as const) {
    if (m[key] === undefined) continue
    if (m[key] !== true) p.push(`meat.${key} 只能是 true`)
    else if (kind !== 'stance') p.push(`meat.${key} 只有姿態（kind 是 stance）用：曲目`)
  }
  if (m.on_link_overload !== undefined) {
    p.push(...effectsProblems(k, 'meat.on_link_overload', m.on_link_overload))
    if (kind !== 'stance') p.push('meat.on_link_overload 只有姿態（kind 是 stance）用：曲目')
  }
  return p
}

/** 欄的格式（meat 與 net 同一套；訊息的前綴先寫 meat，meatProblems 對 net 欄換成 net）。k 沒給就不查 do 裡的 op（只有單獨驗格式時）。 */
function columnProblems(m: Record<string, unknown>, kind: unknown, k?: Pick<Kernel, 'battle'>): string[] {
  const p = onlyKeys('meat', m, MEAT_KEYS)
  if (m.target !== undefined && !(MEAT_TARGETS as readonly unknown[]).includes(m.target)) p.push(`meat.target 只能是 ${MEAT_TARGETS.join('、')}`)
  if (m.attack !== undefined) p.push(...attackProblems(m.attack))
  if (m.apply !== undefined) {
    if (!Array.isArray(m.apply)) p.push('meat.apply 要是 [{ status, until? }]')
    else {
      m.apply.forEach((x, i) => {
        if (!isRec(x) || !isText(x.status)) return void p.push(`meat.apply[${i}] 要是 { status, until? }，status 是狀態的 id`)
        p.push(...onlyKeys(`meat.apply[${i}]`, x, ['status', 'until']))
        if (x.until !== undefined && !(STATUS_UNTILS as readonly unknown[]).includes(x.until)) p.push(`meat.apply[${i}].until 只能是 ${STATUS_UNTILS.join('、')}`)
      })
    }
  }
  if (m.free_move !== undefined) {
    if (!isRec(m.free_move)) p.push('meat.free_move 要是 { swap_adjacent_pair: true }')
    else {
      p.push(...onlyKeys('meat.free_move', m.free_move, ['swap_adjacent_pair']))
      if (m.free_move.swap_adjacent_pair !== undefined && typeof m.free_move.swap_adjacent_pair !== 'boolean') p.push('meat.free_move.swap_adjacent_pair 要是 true 或 false')
    }
  }
  if (m.cost !== undefined) {
    if (!isRec(m.cost) || !isText(m.cost.ability) || !(isInt(m.cost.ap) && m.cost.ap >= 0)) p.push('meat.cost 要是 { ability, ap, per_turn? }：ability 是技能的 id，ap 是 0 以上的整數')
    else {
      p.push(...onlyKeys('meat.cost', m.cost, ['ability', 'ap', 'per_turn']))
      if (m.cost.per_turn !== undefined && !(isInt(m.cost.per_turn) && m.cost.per_turn >= 1)) p.push('meat.cost.per_turn 要是 1 以上的整數')
    }
  }
  if (m.weapon_cost !== undefined) {
    if (!isRec(m.weapon_cost) || !isText(m.weapon_cost.trait) || !(isInt(m.weapon_cost.ap) && m.weapon_cost.ap >= 0)) p.push('meat.weapon_cost 要是 { trait, ap, per_turn? }：trait 是武器的特性，ap 是 0 以上的整數')
    else {
      p.push(...onlyKeys('meat.weapon_cost', m.weapon_cost, ['trait', 'ap', 'per_turn']))
      if (m.weapon_cost.per_turn !== undefined && !(isInt(m.weapon_cost.per_turn) && m.weapon_cost.per_turn >= 1)) p.push('meat.weapon_cost.per_turn 要是 1 以上的整數')
    }
  }
  // 兩邊共用同一個回合計數：兩邊都寫 per_turn 就要一樣，只有一邊寫的話另一邊是每次都照那個行動點
  if (isRec(m.cost) && isRec(m.weapon_cost) && m.cost.per_turn !== undefined && m.weapon_cost.per_turn !== undefined && m.cost.per_turn !== m.weapon_cost.per_turn) p.push('meat.cost.per_turn 與 meat.weapon_cost.per_turn 共用同一個回合計數，兩邊要寫一樣的數字')
  if (m.trigger !== undefined) p.push(...triggerProblems(m))
  else if (m.react !== undefined) p.push('meat.react 要搭配 trigger')
  if (m.evade !== undefined && !isNum(m.evade)) p.push('meat.evade 要是數字')
  if (m.on_hit !== undefined) {
    if (!isRec(m.on_hit)) p.push('meat.on_hit 要是 { hit_against_ally }')
    else {
      p.push(...onlyKeys('meat.on_hit', m.on_hit, ['hit_against_ally']))
      if (m.on_hit.hit_against_ally !== undefined && !isNum(m.on_hit.hit_against_ally)) p.push('meat.on_hit.hit_against_ally 要是數字')
    }
  }
  if (m.give_ap !== undefined) {
    if (!isRec(m.give_ap) || m.give_ap.max !== 'one_plus_half_tier') p.push("meat.give_ap 要是 { max: 'one_plus_half_tier' }")
    else p.push(...onlyKeys('meat.give_ap', m.give_ap, ['max']))
  }
  if (m.call !== undefined) {
    const c = m.call
    if (!isRec(c)) p.push('meat.call 要是 { options, per_fight, ap }')
    else {
      p.push(...onlyKeys('meat.call', c, ['options', 'per_fight', 'ap', 'heal', 'vent']))
      if (!(Array.isArray(c.options) && c.options.length >= 1 && c.options.every((o) => (CALL_OPTIONS as readonly unknown[]).includes(o)))) p.push(`meat.call.options 要是至少一個，只能用 ${CALL_OPTIONS.join('、')}`)
      if (c.per_fight !== 'half_tier_up') p.push("meat.call.per_fight 只能是 'half_tier_up'")
      if (!(isInt(c.ap) && c.ap >= 0)) p.push('meat.call.ap 要是 0 以上的整數')
      for (const key of CALL_AMOUNT) {
        if (c[key] !== undefined) p.push(...amountProblems(c[key]).map((x) => `meat.call.${key}：${x}`))
        else if (Array.isArray(c.options) && c.options.includes(key)) p.push(`meat.call.${key} 一定要寫（options 有 ${key}：回復或排幾點，可以寫公式）`)
      }
    }
  }
  if (m.instinct !== undefined && m.instinct !== true) {
    const i = m.instinct
    if (!isRec(i)) p.push('meat.instinct 只能是 true（現實欄），或 { div, only, fixed: true }（內海欄）')
    else {
      p.push(...onlyKeys('meat.instinct', i, ['div', 'only', 'fixed']))
      if (!(isInt(i.div) && i.div >= 1)) p.push('meat.instinct.div 要是 1 以上的整數（點數 = 樹階 ÷ div 進位）')
      if (!(Array.isArray(i.only) && i.only.length > 0 && i.only.every((x) => ['initiative', 'hit', 'evade'].includes(x as string)))) p.push('meat.instinct.only 要是 initiative、hit、evade 裡的幾項（只能分到這幾項）')
      if (i.fixed !== true) p.push('meat.instinct.fixed 只能是 true（整場不能重分配）')
    }
  }
  if (m.action !== undefined) {
    if (m.action !== true) p.push('meat.action 只能是 true')
    else if (kind !== 'passive') p.push('meat.action 只有被動（kind 是 passive）用：被動的技能在這一欄多一個主動的行動；主動技能本來就是行動')
    else if (!(m.target || m.do || m.choose)) p.push('meat.action 要有 target、do 或 choose（那個行動做什麼）')
  }
  if (m.trace !== undefined && !(isInt(m.trace) && m.trace >= 1)) p.push('meat.trace 要是 1 以上的整數（快駭的追蹤度）')
  p.push(...netOnlyProblems(m, kind, k))
  if (m.pending !== undefined && m.pending !== true) p.push('meat.pending 只能是 true')
  if (m.text !== undefined && typeof m.text !== 'string') p.push('meat.text 要是字串（給玩家看的說明）')

  // ---- 名媛 ----
  if (m.mask !== undefined) {
    if (kind !== 'passive') p.push('meat.mask 只有被動（kind 是 passive）用：裝著就戴著面具；換臉、千面用 buff 的 mask')
    if (!isRec(m.mask)) p.push('meat.mask 要是 { rounds }')
    else {
      p.push(...onlyKeys('meat.mask', m.mask, ['rounds']))
      if (!(isInt(m.mask.rounds) && m.mask.rounds >= 1)) p.push('meat.mask.rounds 要是 1 以上的整數（到第幾回合為止，含）')
    }
  }
  if (m.tease !== undefined) p.push(...teaseProblems(m, kind, k))

  // ---- 戰鬥外（偽裝、我演得很像吧、入骨） ----
  if (m.out !== undefined) {
    if (kind !== 'stance') p.push('meat.out 只有姿態（kind 是 stance）用：戰鬥外也開得了的姿態')
    if (!isRec(m.out)) p.push('meat.out 要是 { check, on_start? }')
    else {
      p.push(...onlyKeys('meat.out', m.out, ['check', 'on_start']))
      if (m.out.check === undefined) p.push('meat.out.check 一定要寫（{ tags, skill, value }：開著的時候戰鬥外的檢定加多少）')
      else p.push(...outModProblems('meat.out.check', m.out.check))
      if (m.out.on_start !== undefined) p.push(...effectsProblems(k, 'meat.out.on_start', m.out.on_start))
    }
  }
  if (m.out_mods !== undefined) {
    if (kind !== 'passive') p.push('meat.out_mods 只有被動（kind 是 passive）用：裝著的時候戰鬥外的檢定加多少')
    p.push(...outModListProblems('meat.out_mods', m.out_mods))
  }

  // ---- 通用格式 ----
  if (m.needs !== undefined) {
    p.push(...needsProblems('meat.needs', m.needs))
    if (m.target === undefined) p.push('meat.needs 要先寫 target')
    else if (!UNIT_TARGETS.includes(m.target as string)) p.push(`meat.needs 只對目標是人的技能有意思（target 是 ${UNIT_TARGETS.join('、')}），這個技能的 target 是 ${String(m.target)}`)
  }
  if (m.when !== undefined) p.push(...whenProblems('meat.when', m.when, WHEN_MEAT))
  if (m.range !== undefined) {
    const r = m.range
    if (!(Array.isArray(r) && r.length === 2 && isInt(r[0]) && isInt(r[1]) && r[0] >= 1 && r[1] >= r[0])) p.push('meat.range 要是 [近, 遠]：兩個整數，近是 1 以上、遠不小於近')
    else if (m.target === undefined || m.target === 'self' || m.target === 'none') p.push('meat.range 要先寫 target（目標要是人、一格或一台）')
  }
  const pickKeys = new Set<string>()
  if (m.picks !== undefined) {
    if (!Array.isArray(m.picks) || m.picks.length === 0) p.push('meat.picks 要是 [{ key, label, kind, required }]')
    else {
      m.picks.forEach((x, i) => {
        const at = `meat.picks[${i}]`
        if (!isRec(x)) return void p.push(`${at} 要是 { key, label, kind, required }`)
        p.push(...onlyKeys(at, x, ['key', 'label', 'kind', 'required', 'adjacent', 'apart', 'needs', 'range']))
        if (x.needs !== undefined) {
          if (x.kind !== 'foe' && x.kind !== 'ally') p.push(`${at}.needs 只有 kind 是 foe、ally 的用`)
          else p.push(...needsProblems(`${at}.needs`, x.needs))
        }
        if (x.range !== undefined) {
          if (x.kind !== 'foe' && x.kind !== 'ally') p.push(`${at}.range 只有 kind 是 foe、ally 的用`)
          else if (!(Array.isArray(x.range) && x.range.length === 2 && isInt(x.range[0]) && isInt(x.range[1]) && x.range[0] >= 1 && x.range[1] >= x.range[0])) p.push(`${at}.range 要是 [近, 遠]：兩個整數，近是 1 以上、遠不小於近`)
        }
        if (x.adjacent !== undefined && (x.adjacent !== true || x.kind !== 'ally')) p.push(`${at}.adjacent 只能是 true，而且只有 kind 是 ally 的用`)
        if (x.apart !== undefined && (x.apart !== true || (x.kind !== 'ally' && x.kind !== 'foe'))) p.push(`${at}.apart 只能是 true，而且只有 kind 是 foe、ally 的用`)
        if (!isText(x.key)) p.push(`${at}.key 要是 pick 的鍵（字串）`)
        else if (pickKeys.has(x.key)) p.push(`${at}.key「${x.key}」重複了`)
        else pickKeys.add(x.key)
        if (!isText(x.label)) p.push(`${at}.label 要是給玩家看的名字`)
        if (!(PICK_KINDS as readonly unknown[]).includes(x.kind)) p.push(`${at}.kind「${String(x.kind)}」不在清單裡（可以寫：${PICK_KINDS.join('、')}）`)
        if (x.required !== undefined && typeof x.required !== 'boolean') p.push(`${at}.required 要是 true 或 false`)
        if (x.kind === 'foe_overlay' && x.key !== 'overlay') p.push(`${at}.key 在 kind 是 foe_overlay 時要叫 overlay（效果的 who: 'foe_overlay' 讀的是 pick.overlay）`)
        if (x.kind === 'choice' && !Array.isArray(m.choose)) p.push(`${at}.kind 是 choice 時要有 meat.choose（選項從 choose 來）`)
      })
      if (m.picks.filter((x) => isRec(x) && x.kind === 'choice').length > 1) p.push('meat.picks 最多只能有一個 choice')
    }
  }
  if (m.do !== undefined) p.push(...effectsProblems(k, 'meat.do', m.do))
  if (m.do_on !== undefined || m.do_off !== undefined) {
    if (kind !== 'stance') p.push('meat.do_on、meat.do_off 只有姿態（kind 是 stance）用')
    for (const key of ['do_on', 'do_off'] as const) if (m[key] !== undefined) p.push(...effectsProblems(k, `meat.${key}`, m[key]))
  }
  if (m.choose !== undefined) {
    if (!Array.isArray(m.choose) || m.choose.length === 0) p.push('meat.choose 要是 [{ key, label, do, when?, needs? }]')
    else {
      const keys = new Set<string>()
      m.choose.forEach((x, i) => {
        const at = `meat.choose[${i}]`
        if (!isRec(x)) return void p.push(`${at} 要是 { key, label, do, when?, needs? }`)
        p.push(...onlyKeys(at, x, ['key', 'label', 'do', 'when', 'needs']))
        if (!isText(x.key)) p.push(`${at}.key 要是選項的鍵（字串）`)
        else if (keys.has(x.key)) p.push(`${at}.key「${x.key}」重複了`)
        else keys.add(x.key)
        if (!isText(x.label)) p.push(`${at}.label 要是給玩家看的名字`)
        p.push(...effectsProblems(k, `${at}.do`, x.do))
        if (x.when !== undefined) p.push(...whenProblems(`${at}.when`, x.when, WHEN_MEAT))
        if (x.needs !== undefined) {
          p.push(...needsProblems(`${at}.needs`, x.needs))
          if (m.target !== undefined && !UNIT_TARGETS.includes(m.target as string)) p.push(`${at}.needs 只對目標是人的技能有意思，這個技能的 target 是 ${String(m.target)}`)
        }
      })
    }
  }
  if (m.mods !== undefined) {
    if (kind !== 'passive' && kind !== 'stance') p.push('meat.mods 只有被動與姿態（kind 是 passive、stance）用')
    p.push(...modsProblems('meat.mods', m.mods))
  }
  if (m.tags !== undefined && !(Array.isArray(m.tags) && m.tags.length > 0 && m.tags.every(isText))) p.push('meat.tags 要是標籤的陣列')
  if (m.action_tags !== undefined && !(Array.isArray(m.action_tags) && m.action_tags.length > 0 && m.action_tags.every(isText))) p.push('meat.action_tags 要是標籤的陣列（這個技能的行動多帶的標籤，例如 heal）')
  if (m.pool !== undefined) p.push(...poolProblems('meat.pool', m.pool))
  if (m.ransom !== undefined) {
    if (!isRec(m.ransom)) p.push('meat.ransom 要是 { cash }')
    else {
      p.push(...onlyKeys('meat.ransom', m.ransom, ['cash']))
      if (m.ransom.cash === undefined) p.push('meat.ransom.cash 一定要寫（贖金，公式，例 grade*1000）')
      else p.push(...plainFormula('meat.ransom.cash', m.ransom.cash))
    }
  }
  for (const key of ['on_start', 'on_give_ap'] as const) if (m[key] !== undefined) p.push(...effectsProblems(k, `meat.${key}`, m[key]))
  if (m.alter !== undefined) {
    if (!Array.isArray(m.alter) || m.alter.length === 0) p.push('meat.alter 要是 [{ ability, set, as_pick? }]')
    else {
      m.alter.forEach((x, i) => {
        const at = `meat.alter[${i}]`
        if (!isRec(x)) return void p.push(`${at} 要是 { ability, set, as_pick? }`)
        p.push(...onlyKeys(at, x, ['ability', 'set', 'as_pick', 'when']))
        if (x.when !== undefined) p.push(...whenProblems(`${at}.when`, x.when, WHEN_MEAT))
        if (!isText(x.ability)) p.push(`${at}.ability 要是被改的技能的 id`)
        if (!isRec(x.set) || Object.keys(x.set).length === 0) p.push(`${at}.set 要是 { '路徑': 值 }（路徑是那個技能 meat 裡的，例如 'attack.spend'）`)
        else for (const path of Object.keys(x.set)) if (!(MEAT_KEYS as readonly string[]).includes(path.split('.')[0]!)) p.push(`${at}.set 的路徑「${path}」不對：開頭要是 meat 的鍵（${MEAT_KEYS.join('、')}）`)
        if (x.as_pick !== undefined) {
          if (!isRec(x.as_pick) || !isText(x.as_pick.key) || !isText(x.as_pick.label)) p.push(`${at}.as_pick 要是 { key, label }`)
          else p.push(...onlyKeys(`${at}.as_pick`, x.as_pick, ['key', 'label']))
        }
      })
    }
  }
  // ---- 內海（M3-abilities-net）：兩欄都可以寫 ----
  for (const key of ['slots', 'sync_cap'] as const) {
    if (m[key] !== undefined && !(isInt(m[key]) && m[key] !== 0)) p.push(`meat.${key} 要是整數（${key === 'slots' ? '構裝槽' : '同步檔位的上限'}加減幾，不能是 0）`)
  }
  if (m.admin !== undefined && m.admin !== 'tier' && !(isInt(m.admin) && m.admin >= 1)) p.push("meat.admin 要是 'tier'（這棵樹的階數）或 1 以上的整數（管理行動的基數）")
  if (m.unique !== undefined && m.unique !== true) p.push('meat.unique 只能是 true（這一欄是招牌的專屬構裝：佔一個槽、淺檔不生效）')
  if (Array.isArray(m.tags) && m.tags.includes('overclock') && kind !== 'active') p.push('meat.tags 的 overclock 只有主動技能（kind 是 active）用：帶這個標籤的行動淺檔做不了')
  return p
}

// ---- 內海欄：現實才有意義的鍵擋掉 ----

/** 內海欄不能寫的鍵與原因（現實的東西：彈匣、重創、義體、名冊支援、戰敗事件、戰鬥外）。 */
const NET_BLOCKED_KEYS: Record<string, string> = {
  call: '叫人是現實戰鬥的名冊支援',
  give_ap: '指揮是現實戰鬥的隊伍行動點',
  tease: '誘惑攻擊打的是快感，內海沒有成人場景',
  mask: '面具是現實裡被認出來的機制',
  ransom: '保釋是現實戰敗的事件',
  out: '戰鬥外的姿態只有現實',
  out_mods: '戰鬥外的檢定修正只有現實',
  on_hit: '那是舊的 ally_attacked 寫法的附屬',
  evade: '那是舊的 ally_attacked 寫法的附屬',
}
const NET_BLOCKED_ATTACK = ['spend', 'min_mag', 'dice', 'free_mag', 'suppress']
/** 花掉全部 RAM 的技能（use.ram_all_min：超頻、黑冰）內海欄的 attack 才能寫 spend: 'all'、dice、suppress：花掉的 RAM 就是那個「花掉的格數」 */
const NET_ALL_RAM_BLOCKED_ATTACK = ['min_mag', 'free_mag']
const NET_BLOCKED_WHEN = ['mag_min', 'hull', 'node_taken', 'wounded', 'other_cyber', 'other_contract', 'not_spotted']
const NET_BLOCKED_NEEDS = ['cyber', 'implant_off', 'cache_tag', 'wounded']
const NET_BLOCKED_MODS = ['instinct_points', 'instinct_cap', 'instinct_free', 'call_uses', 'call_hit', 'no_wound']

function blockedIn(at: string, v: unknown, keys: readonly string[], why: string): string[] {
  return isRec(v) ? keys.filter((key) => v[key] !== undefined).map((key) => `${at}.${key} 在內海沒有意義（${why}）`) : []
}
const blockedWhen = (at: string, w: unknown): string[] => blockedIn(at, w, NET_BLOCKED_WHEN, '彈匣、機甲、重傷、義體、控制節點、被識破都是現實的條件')
function blockedNeeds(at: string, n: unknown): string[] {
  const p = blockedIn(at, n, NET_BLOCKED_NEEDS, '義體、快取格、重傷是現實的條件')
  if (isRec(n) && Array.isArray(n.any)) n.any.forEach((x, i) => p.push(...blockedNeeds(`${at}.any[${i}]`, x)))
  return p
}

/** 這個技能在內海花不花掉全部的 RAM（use 直接寫一組，或照戰場分的 net 那一組）。 */
const allRam = (use: unknown): boolean => {
  if (!isRec(use)) return false
  const u = 'meat' in use || 'net' in use || 'opinion' in use ? use.net : use
  return isRec(u) && u.ram_all_min !== undefined
}

/** 內海欄裡現實才有意義的東西（回傳的訊息已經是 net. 開頭）。use 是技能的 use（花掉全部 RAM 的技能才能寫彈匣的花法與壓制）。 */
function netBlockedProblems(m: Record<string, unknown>, use?: unknown): string[] {
  const p: string[] = []
  for (const [key, why] of Object.entries(NET_BLOCKED_KEYS)) if (m[key] !== undefined) p.push(`net.${key} 在內海沒有意義（${why}）`)
  if (m.instinct === true) p.push('net.instinct 在內海沒有意義（戰鬥直覺是現實戰鬥的點數分配；內海欄要寫 { div, only, fixed: true }）')
  if (typeof m.trigger === 'string') p.push(`net.trigger 不能用舊的字串寫法「${m.trigger}」（那是現實的隊友掩護）；寫成 { on, who, if? }`)
  if (isRec(m.attack)) {
    const a = m.attack
    if (allRam(use)) {
      p.push(...blockedIn('net.attack', a, NET_ALL_RAM_BLOCKED_ATTACK, '內海的構裝沒有彈匣'))
      if (a.spend !== undefined && a.spend !== 'all') p.push('net.attack.spend 在內海沒有意義（花 RAM 的技能只能寫 \'all\'：花掉手上全部的 RAM）')
    } else {
      // 壓制姿態（auto）不花彈匣、不檢定：內海也成立（只在第一回合）；其餘的壓制要花掉全部 RAM 的技能才有
      const keys = isRec(a.suppress) && a.suppress.auto === true ? NET_BLOCKED_ATTACK.filter((x) => x !== 'suppress') : NET_BLOCKED_ATTACK
      p.push(...blockedIn('net.attack', a, keys, '內海的構裝沒有彈匣，也沒有壓制（花掉全部 RAM 的技能與壓制姿態除外）'))
    }
  }
  p.push(...blockedWhen('net.when', m.when), ...blockedNeeds('net.needs', m.needs))
  if (isRec(m.trigger) && isRec(m.trigger.by)) p.push(...blockedNeeds('net.trigger.by.needs', m.trigger.by.needs))
  if (Array.isArray(m.mods)) {
    m.mods.forEach((e, i) => {
      if (!isRec(e)) return
      if (NET_BLOCKED_MODS.includes(e.kind as string)) p.push(`net.mods[${i}].kind「${String(e.kind)}」在內海沒有意義（那是現實戰鬥的機制）`)
      p.push(...blockedWhen(`net.mods[${i}].when`, e.when))
    })
  }
  if (Array.isArray(m.choose)) m.choose.forEach((x, i) => p.push(...blockedWhen(`net.choose[${i}].when`, isRec(x) ? x.when : undefined), ...blockedNeeds(`net.choose[${i}].needs`, isRec(x) ? x.needs : undefined)))
  if (Array.isArray(m.picks)) m.picks.forEach((x, i) => p.push(...blockedNeeds(`net.picks[${i}].needs`, isRec(x) ? x.needs : undefined)))
  if (Array.isArray(m.alter)) m.alter.forEach((x, i) => p.push(...blockedWhen(`net.alter[${i}].when`, isRec(x) ? x.when : undefined)))
  return p
}

/**
 * 一欄的格式檢查：只能用封閉清單裡的鍵。col 是 meat（預設）或 net，兩欄同一套，內海欄再擋掉現實才有意義的鍵（NET_BLOCKED_*），訊息的前綴是欄名。
 * k 沒給就不查 do 裡的 op（只有單獨驗格式時）。
 */
export function meatProblems(m: Record<string, unknown>, kind: unknown, k?: Pick<Kernel, 'battle'>, col: 'meat' | 'net' = 'meat', use?: unknown): string[] {
  const p = columnProblems(m, kind, k)
  if (col === 'meat') {
    const only = NET_ONLY_KEYS.filter((key) => m[key] !== undefined).map((key) => `meat.${key} 只有內海欄能寫（現實欄沒有這個機制）`)
    return [...p, ...only, ...(isRec(m.instinct) ? ['meat.instinct 的物件寫法是內海欄的（現實欄寫 true）'] : [])]
  }
  return [...p.map((x) => x.replaceAll('meat.', 'net.')), ...netBlockedProblems(m, use)]
}

// ---- prep ----

export function prepProblems(prep: unknown, kind: unknown, k?: Pick<Kernel, 'battle'>): string[] {
  if (prep === undefined || prep === null) return []
  if (!isRec(prep)) return ['prep 要是物件或 null']
  const p = onlyKeys('prep', prep, ['text', 'slot', 'scope', 'meat', 'net', 'effects', 'target', 'out_mods'])
  if (prep.text !== undefined && typeof prep.text !== 'string') p.push('prep.text 要是字串')
  if (prep.slot !== undefined && !(isInt(prep.slot) && prep.slot >= 0)) p.push('prep.slot 要是 0 以上的整數（幾個時段；0 是不花時段，戰前佈置、情報網）')
  if (prep.scope !== undefined && !(PREP_SCOPES as readonly unknown[]).includes(prep.scope)) p.push(`prep.scope「${String(prep.scope)}」不在清單裡（可以寫：${PREP_SCOPES.join('、')}）`)
  if (prep.meat !== undefined) {
    const m = prep.meat
    if (kind !== 'prep') p.push('prep.meat 只有預備技能（kind 是 prep）用')
    if (prep.slot === undefined) p.push('prep.slot 一定要寫（預備花幾個時段）')
    if (prep.scope === undefined) p.push('prep.scope 一定要寫（next_battle 或 commission）')
    if (!isRec(m)) p.push('prep.meat 要是 { mods?, do? }')
    else {
      p.push(...onlyKeys('prep.meat', m, ['mods', 'do']))
      if (m.mods === undefined && m.do === undefined) p.push('prep.meat 要寫 mods 或 do')
      if (m.mods !== undefined) p.push(...modsProblems('prep.meat.mods', m.mods))
      if (m.do !== undefined) p.push(...effectsProblems(k, 'prep.meat.do', m.do))
    }
  }
  if (prep.net !== undefined) {
    const m = prep.net
    if (kind !== 'prep') p.push('prep.net 只有預備技能（kind 是 prep）用')
    if (prep.slot === undefined) p.push('prep.slot 一定要寫（預備花幾個時段）')
    if (prep.scope === undefined) p.push('prep.scope 一定要寫（next_battle 或 commission）')
    if (!isRec(m)) p.push('prep.net 要是 { mods?, do?, trace_start? }')
    else {
      p.push(...onlyKeys('prep.net', m, ['mods', 'do', 'trace_start']))
      if (m.mods === undefined && m.do === undefined && m.trace_start === undefined) p.push('prep.net 要寫 mods、do 或 trace_start')
      if (m.mods !== undefined) p.push(...modsProblems('prep.net.mods', m.mods))
      if (m.do !== undefined) p.push(...effectsProblems(k, 'prep.net.do', m.do))
      if (m.trace_start !== undefined) {
        if (!(isInt(m.trace_start) && m.trace_start !== 0 && m.trace_start >= -100 && m.trace_start <= 100)) p.push('prep.net.trace_start 要是 −100～100 的整數（這件委託內海階段追蹤度起始值的加減，不能是 0）')
        else if (prep.scope !== undefined && prep.scope !== 'commission') p.push("prep.net.trace_start 只有 scope 是 commission 的預備用（綁在一件委託上）")
      }
    }
  }
  // 預備當下結算的效果（走 k.effects，種類登記了沒有要到執行時才知道：只查形狀）、要選一個人、戰鬥外的檢定修正
  if (prep.effects !== undefined) {
    if (kind !== 'prep') p.push('prep.effects 只有預備技能（kind 是 prep）用')
    if (!Array.isArray(prep.effects) || prep.effects.length === 0) p.push('prep.effects 要是效果的陣列（每一筆 { kind, ... }；字串裡可以寫 $target、$commission、$tendency）')
    else prep.effects.forEach((e, i) => { if (!isRec(e) || !isText(e.kind)) p.push(`prep.effects[${i}] 要是 { kind, ... }（kind 是效果的種類）`) })
  }
  if (prep.meat === undefined && prep.net === undefined && (prep.effects !== undefined || prep.out_mods !== undefined)) {
    if (prep.slot === undefined) p.push('prep.slot 一定要寫（預備花幾個時段）')
    if (prep.scope === undefined) p.push('prep.scope 一定要寫（next_battle 或 commission）')
  }
  if (prep.target !== undefined && prep.target !== 'person') p.push("prep.target 只能是 'person'（預備時要選一個人）")
  if (prep.out_mods !== undefined) {
    p.push(...outModListProblems('prep.out_mods', prep.out_mods))
    if (prep.target !== 'person') p.push("prep.out_mods 要和 target: 'person' 一起寫（只對選的那個人有效）")
  }
  return p
}

// ---- alter：把改動套在那個技能的 meat 上 ----

/** 把 { '路徑': 值 } 套在一份 meat 的複本上（路徑用點分隔，中間缺的物件補出來；值是 null 就拿掉那一項）。 */
export function applySet(meat: Record<string, unknown>, set: Record<string, unknown>): Record<string, unknown> {
  const out = structuredClone(meat)
  for (const [path, value] of Object.entries(set)) {
    const keys = path.split('.')
    let at: Record<string, unknown> = out
    for (const key of keys.slice(0, -1)) {
      if (!isRec(at[key])) at[key] = {}
      at = at[key] as Record<string, unknown>
    }
    const last = keys[keys.length - 1]!
    if (value === null) delete at[last]
    else at[last] = structuredClone(value)
  }
  return out
}
