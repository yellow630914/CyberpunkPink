// 內容種類 path（路數，一棵樹一筆）與 ability（技能，一個一筆）的格式，以及內容載入之後跨筆的檢查。
// 規格：dev/work/M1-abilities.md 第二節；SKILLS 1.1、1.2 節；DATA 第 2 節。

import type { Kernel } from '../../core'
import { STATUS_UNTILS } from '../../core'
import type { AbilityEntry, PathEntry } from './types'
import { CATEGORIES, DOMAIN_LEVELS, KINDS, LAYERS, OWNER } from './types'

const isRec = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)
const isInt = (v: unknown): v is number => typeof v === 'number' && Number.isInteger(v)
const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v)
const isText = (v: unknown): v is string => typeof v === 'string' && v.trim().length > 0

const MEAT_TARGETS = ['enemy', 'ally', 'self', 'ally_slot', 'enemy_slot', 'none'] as const
const MEAT_KEYS = ['target', 'attack', 'apply', 'free_move', 'cost', 'weapon_cost', 'trigger', 'evade', 'on_hit', 'give_ap', 'call', 'instinct', 'pending'] as const
export const CALL_OPTIONS = ['shot', 'cover_up', 'cover_down'] as const
const TRIGGERS = ['ally_attacked', 'ally_attacked_adjacent'] as const
const RESONANCE_KEYS = ['initiative', 'free_move', 'pending'] as const
const USE_KEYS = ['ap', 'per_turn', 'per_fight', 'first_round', 'note'] as const

/** 一個物件只能用清單裡的鍵；多出來的每一個鍵各一條訊息（訊息裡有鍵的名字）。 */
function onlyKeys(at: string, v: Record<string, unknown>, keys: readonly string[]): string[] {
  return Object.keys(v).filter((key) => !keys.includes(key)).map((key) => `${at}.${key} 不是可以用的鍵（只有 ${keys.join('、')}）`)
}

function attackProblems(a: unknown): string[] {
  if (!isRec(a)) return ['meat.attack 要是物件']
  const p = onlyKeys('meat.attack', a, ['aimed', 'hit', 'spend', 'min_mag', 'dice', 'suppress', 'at'])
  if (a.aimed !== undefined && typeof a.aimed !== 'boolean') p.push('meat.attack.aimed 要是 true 或 false')
  if (a.hit !== undefined && !isNum(a.hit)) p.push('meat.attack.hit 要是數字')
  if (a.spend !== undefined && a.spend !== 'all') p.push("meat.attack.spend 只能是 'all'")
  if (a.min_mag !== undefined && !(isInt(a.min_mag) && a.min_mag >= 1)) p.push('meat.attack.min_mag 要是 1 以上的整數')
  if (a.dice !== undefined && a.dice !== 'spent_minus_1') p.push("meat.attack.dice 只能是 'spent_minus_1'")
  if (a.at !== undefined && a.at !== 'attacker') p.push("meat.attack.at 只能是 'attacker'")
  if (a.suppress !== undefined) {
    const s = a.suppress
    if (!isRec(s)) p.push('meat.attack.suppress 要是 { dc, skill }')
    else {
      p.push(...onlyKeys('meat.attack.suppress', s, ['dc', 'skill']))
      if (!(s.dc === 'spent' || (isNum(s.dc) && s.dc > 0))) p.push("meat.attack.suppress.dc 要是 'spent' 或正數")
      if (!isText(s.skill)) p.push('meat.attack.suppress.skill 要是基本功的 id')
    }
  }
  return p
}

/** `meat` 欄：只能用封閉清單裡的鍵（工單第四節）。 */
function meatProblems(m: Record<string, unknown>): string[] {
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
    if (!isRec(m.cost) || !isText(m.cost.ability) || !(isInt(m.cost.ap) && m.cost.ap >= 0)) p.push('meat.cost 要是 { ability, ap }：ability 是技能的 id，ap 是 0 以上的整數')
    else p.push(...onlyKeys('meat.cost', m.cost, ['ability', 'ap']))
  }
  if (m.weapon_cost !== undefined) {
    if (!isRec(m.weapon_cost) || !isText(m.weapon_cost.trait) || !(isInt(m.weapon_cost.ap) && m.weapon_cost.ap >= 0)) p.push('meat.weapon_cost 要是 { trait, ap }：trait 是武器的特性，ap 是 0 以上的整數')
    else p.push(...onlyKeys('meat.weapon_cost', m.weapon_cost, ['trait', 'ap']))
  }
  if (m.trigger !== undefined && !(TRIGGERS as readonly unknown[]).includes(m.trigger)) p.push(`meat.trigger 只能是 ${TRIGGERS.join('、')}`)
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
      p.push(...onlyKeys('meat.call', c, ['options', 'per_fight', 'ap']))
      if (!(Array.isArray(c.options) && c.options.length >= 1 && c.options.every((o) => (CALL_OPTIONS as readonly unknown[]).includes(o)))) p.push(`meat.call.options 要是至少一個，只能用 ${CALL_OPTIONS.join('、')}`)
      if (c.per_fight !== 'half_tier_up') p.push("meat.call.per_fight 只能是 'half_tier_up'")
      if (!(isInt(c.ap) && c.ap >= 0)) p.push('meat.call.ap 要是 0 以上的整數')
    }
  }
  if (m.instinct !== undefined && m.instinct !== true) p.push('meat.instinct 只能是 true')
  if (m.pending !== undefined && m.pending !== true) p.push('meat.pending 只能是 true')
  return p
}

function pathProblems(e: Record<string, unknown>): string[] {
  const p: string[] = []
  if (!isText(e.name)) p.push('要有 name（路數的名字，例如槍手）')
  if (!isText(e.tree)) p.push('要有 tree（樹的名字，例如戰鬥直覺）')
  if (!(CATEGORIES as readonly unknown[]).includes(e.category)) p.push(`category 只能是 ${CATEGORIES.join('、')}`)
  if (!isText(e.signature)) p.push('要有 signature（招牌技能的 id）')
  if (!isRec(e.domains)) p.push('要有 domains：{ meat, net, opinion }')
  else {
    p.push(...onlyKeys('domains', e.domains, ['meat', 'net', 'opinion']))
    for (const col of ['meat', 'net', 'opinion']) if (!(DOMAIN_LEVELS as readonly unknown[]).includes(e.domains[col])) p.push(`domains.${col} 只能是 ${DOMAIN_LEVELS.join('、')}`)
  }
  if (!Array.isArray(e.resonance)) p.push('resonance 要是陣列（沒有共鳴就寫空陣列）')
  else {
    e.resonance.forEach((r, i) => {
      const at = `resonance[${i}]`
      if (!isRec(r)) return void p.push(`${at} 要是 { tier, cells, text, effect? }`)
      if (!(isInt(r.tier) && r.tier >= 1 && r.tier <= 5)) p.push(`${at}.tier 要是 1～5 的整數`)
      if (!isNum(r.cells)) p.push(`${at}.cells 要是數字`)
      if (!isText(r.text)) p.push(`${at}.text 要是完整的句子`)
      if (r.effect !== undefined) {
        const f = r.effect
        if (!isRec(f)) return void p.push(`${at}.effect 要是物件`)
        p.push(...onlyKeys(`${at}.effect`, f, RESONANCE_KEYS))
        if (f.initiative !== undefined && !isNum(f.initiative)) p.push(`${at}.effect.initiative 要是數字`)
        if (f.free_move !== undefined && !(isRec(f.free_move) && isInt(f.free_move.per_fight) && f.free_move.per_fight >= 1)) p.push(`${at}.effect.free_move 要是 { per_fight: 1 以上的整數 }`)
        if (f.pending !== undefined && f.pending !== true) p.push(`${at}.effect.pending 只能是 true`)
      }
    })
  }
  return p
}

function abilityProblems(e: Record<string, unknown>): string[] {
  const p: string[] = []
  if (!isText(e.name)) p.push('要有 name')
  if (!isText(e.text)) p.push('要有 text（給玩家看的完整說明）')
  if (!isText(e.path)) p.push('要有 path（路數的 id）')
  if (!(CATEGORIES as readonly unknown[]).includes(e.category)) p.push(`category 只能是 ${CATEGORIES.join('、')}`)
  if (!(isInt(e.tier) && e.tier >= 1 && e.tier <= 5)) p.push('tier 要是 1～5 的整數')
  if (!(LAYERS as readonly unknown[]).includes(e.layer)) p.push(`layer 只能是 ${LAYERS.join('、')}`)
  if (!(KINDS as readonly unknown[]).includes(e.kind)) p.push(`kind 只能是 ${KINDS.join('、')}`)
  if (!(isInt(e.cap) && e.cap >= 1 && e.cap <= 6)) p.push('cap 要是 1～6 的整數')
  if (!isInt(e.xp)) p.push('xp 要是整數（階 × 20）')
  else if (isInt(e.tier) && e.xp !== e.tier * 20) p.push(`xp 一定是 tier × 20（tier ${e.tier} 是 ${e.tier * 20}，拿到 ${e.xp}）`)
  if (!isNum(e.cells)) p.push('cells 要是數字（份量）')
  if (e.layer !== 'signature' && !isText(e.after)) p.push('招牌以外的技能要有 after（前置技能的 id）')
  else if (e.after !== undefined && !isText(e.after)) p.push('after 要是前置技能的 id')

  if (e.use !== undefined) {
    const u = e.use
    if (!isRec(u)) p.push('use 要是 { ap?, per_turn?, per_fight?, first_round?, note? }')
    else {
      p.push(...onlyKeys('use', u, USE_KEYS))
      if (u.ap !== undefined && !(isInt(u.ap) && u.ap >= 0)) p.push('use.ap 要是 0 以上的整數')
      if (u.per_turn !== undefined && !(isInt(u.per_turn) && u.per_turn >= 1)) p.push('use.per_turn 要是 1 以上的整數')
      if (u.per_fight !== undefined && !(isInt(u.per_fight) && u.per_fight >= 1)) p.push('use.per_fight 要是 1 以上的整數')
      if (u.first_round !== undefined && typeof u.first_round !== 'boolean') p.push('use.first_round 要是 true 或 false')
      if (u.note !== undefined && typeof u.note !== 'string') p.push('use.note 要是字串')
    }
  }

  for (const col of ['meat', 'net', 'opinion'] as const) {
    const v = e[col]
    if (v === undefined) p.push(`要有 ${col}（沒有效果就寫 null）`)
    else if (v !== null && !isRec(v)) p.push(`${col} 要是物件或 null`)
  }
  if (isRec(e.meat)) p.push(...meatProblems(e.meat))
  for (const col of ['prep', 'daily'] as const) if (e[col] !== undefined && e[col] !== null && !isRec(e[col])) p.push(`${col} 要是物件或 null`)
  return p
}

export function registerKinds(k: Pick<Kernel, 'content'>): void {
  k.content.defineKind<PathEntry>({
    kind: 'path', owner: OWNER,
    validate: pathProblems,
    refs: (e) => (typeof e.signature === 'string' ? [['ability', e.signature]] : []),
  })
  k.content.defineKind<AbilityEntry>({
    kind: 'ability', owner: OWNER,
    validate: abilityProblems,
    refs: (e) => (typeof e.path === 'string' ? [['path', e.path]] : []),
  })
}

const DOMAIN_COLUMNS = [['meat', '現實'], ['net', '內海'], ['opinion', '輿論']] as const

/** 內容載入之後跑一次：要看別筆才知道對不對的檢查。有錯就丟，訊息一條一條列。 */
export function checkAbilities(k: Pick<Kernel, 'content'>): void {
  const problems: string[] = []
  const paths = new Map(k.content.list<PathEntry>('path').map((x) => [x.id, x]))
  const abilities = new Map(k.content.list<AbilityEntry>('ability').map((x) => [x.id, x]))

  for (const path of paths.values()) {
    const sig = abilities.get(path.signature)
    if (!sig) problems.push(`${path.id}：招牌技能 ${path.signature} 不存在`)
    else if (sig.path !== path.id) problems.push(`${path.id}：招牌技能 ${path.signature} 不在這棵樹（它屬於 ${sig.path}）`)
  }

  for (const a of abilities.values()) {
    const path = paths.get(a.path)
    if (!path) {
      problems.push(`${a.id}：沒有 ${a.path} 這棵樹`)
      continue
    }
    if (a.category !== path.category) problems.push(`${a.id}：category（${a.category}）要和${path.tree}的 category（${path.category}）一樣`)
    if (a.after !== undefined) {
      const pre = abilities.get(a.after)
      if (!pre) problems.push(`${a.id}：前置 ${a.after} 不存在`)
      else if (pre.path !== a.path) problems.push(`${a.id}：前置 ${a.after} 不在同一棵樹（${a.id} 在 ${a.path}，${a.after} 在 ${pre.path}）`)
    }
    for (const [col, name] of DOMAIN_COLUMNS) {
      if (path.domains[col] === 'none' && a[col] !== null) problems.push(`${a.id}：${path.tree}在${name}沒有效果（domains.${col} 是 none），${col} 要是 null`)
    }
    const cost = a.meat?.cost
    if (cost && !abilities.has(cost.ability)) problems.push(`${a.id}：meat.cost.ability 的 ${cost.ability} 不存在`)
  }
  if (problems.length) throw new Error(`技能內容的檢查沒過（${problems.length} 個）：\n${problems.slice(0, 20).join('\n')}`)
}

