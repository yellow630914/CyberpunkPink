// 內容種類 path（路數，一棵樹一筆）與 ability（技能，一個一筆）的格式，以及內容載入之後跨筆的檢查。
// 規格：dev/work/M1-abilities.md 第二節；SKILLS 1.1、1.2 節；DATA 第 2 節。

import type { Kernel } from '../../core'
import { aiProblems, applySet, meatProblems, modsProblems, onlyKeys, poolProblems, prepProblems, useProblems } from './format'
import { isActionCol } from './column'
import type { AbilityEntry, MeatDef, PathEntry } from './types'
import { CATEGORIES, DOMAIN_LEVELS, KINDS, LAYERS, OWNER } from './types'

export { CALL_OPTIONS } from './format'

const isRec = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)
const isInt = (v: unknown): v is number => typeof v === 'number' && Number.isInteger(v)
const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v)
const isText = (v: unknown): v is string => typeof v === 'string' && v.trim().length > 0

/** 主動技能的 target 對到行動的目標種類（battle.ts 的 TARGET_KIND 同一張：兩欄的行動要選同一種目標）。 */
const TARGET_KINDS: Record<string, string> = {
  enemy: 'foe', ally: 'ally', self: 'none', none: 'none', ally_slot: 'ally_slot', enemy_slot: 'foe_slot', foe_slot: 'foe_slot',
  ally_or_self: 'unit', near: 'unit', downed_near: 'unit', own_overlay: 'overlay', foe_overlay: 'overlay',
}

const RESONANCE_KEYS = ['initiative', 'free_move', 'mods', 'pool', 'load_max', 'hp_max', 'pending'] as const

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
        if (f.mods !== undefined) p.push(...modsProblems(`${at}.effect.mods`, f.mods))
        if (f.pool !== undefined) p.push(...poolProblems(`${at}.effect.pool`, f.pool))
        if (f.load_max !== undefined && !(isInt(f.load_max) && f.load_max !== 0)) p.push(`${at}.effect.load_max 要是整數（感載上限加減幾點，不能是 0）`)
        if (f.hp_max !== undefined && !(isInt(f.hp_max) && f.hp_max !== 0)) p.push(`${at}.effect.hp_max 要是整數（生命上限加減幾點，不能是 0）`)
        if (f.pending !== undefined && f.pending !== true) p.push(`${at}.effect.pending 只能是 true`)
      }
    })
  }
  return p
}

/** 敵人的招牌行動只有這四種（姿態、反應、被動不用分數：裝著就有）。 */
const ENEMY_KINDS = ['active', 'passive', 'reaction', 'stance'] as const

/**
 * use.admin（花管理行動）結算時走效果 net.admin_spend（features/netcombat 註冊）：沒有裝它時用到的技能載入就被擋。
 * 效果的格式是 { op: 'net.admin_spend', who: 'self', n }（features/netcombat 認 n；舊的寫法 amount 一起帶著，替身效果認它）；這裡只查有沒有註冊，不帶數字。
 */
function adminProblems(use: unknown, k: Pick<Kernel, 'battle'>): string[] {
  if (!isRec(use) || ![use, use.net].some((x) => isRec(x) && x.admin !== undefined)) return []
  return k.battle.effectProblems([{ op: 'net.admin_spend', who: 'self' }]).map((m) => `use.admin：${m}`)
}

/** 標了 enemy 的招牌行動：不必寫 path、tier、layer、cap、xp、after、category；kind、use、meat、text 照一般的技能。 */
function enemyAbilityProblems(e: Record<string, unknown>, k: Pick<Kernel, 'battle'>): string[] {
  const p: string[] = []
  if (!isText(e.name)) p.push('要有 name')
  if (!isText(e.text)) p.push('要有 text（說明）')
  if (!(ENEMY_KINDS as readonly unknown[]).includes(e.kind)) p.push(`敵人的招牌行動 kind 只能是 ${ENEMY_KINDS.join('、')}`)
  if (e.cells !== undefined && !isNum(e.cells)) p.push('cells 要是數字（份量）')
  p.push(...useProblems(e.use, e.kind), ...adminProblems(e.use, k))
  // 現實與內海各一欄：照戰場選（只寫 meat 的招牌在內海沒有，寫了 net 的才有）；至少要有一欄
  if (!isRec(e.meat) && !isRec(e.net)) p.push('敵人的招牌行動要有 meat 或 net（物件）：效果寫在這裡')
  if (e.meat !== undefined && e.meat !== null && !isRec(e.meat)) p.push('meat 要是物件或 null')
  if (e.net !== undefined && e.net !== null && !isRec(e.net)) p.push('net 要是物件或 null')
  if (isRec(e.meat)) p.push(...meatProblems(e.meat, e.kind, k))
  if (isRec(e.net)) p.push(...meatProblems(e.net, e.kind, k, 'net', e.use))
  if (e.opinion !== undefined && e.opinion !== null && !isRec(e.opinion)) p.push('opinion 要是物件或 null')
  return p
}

function abilityProblems(e: Record<string, unknown>, k: Pick<Kernel, 'battle'>): string[] {
  if (e.enemy !== undefined && e.enemy !== true) return ['enemy 只能是 true（標示這是敵人的招牌行動）']
  const p: string[] = e.enemy === true ? [...enemyAbilityProblems(e, k)] : [...playerAbilityProblems(e, k)]
  if (e.ai !== undefined) p.push(...aiProblems(e.ai))
  return p
}

function playerAbilityProblems(e: Record<string, unknown>, k: Pick<Kernel, 'battle'>): string[] {
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

  p.push(...useProblems(e.use, e.kind), ...adminProblems(e.use, k))

  for (const col of ['meat', 'net', 'opinion'] as const) {
    const v = e[col]
    if (v === undefined) p.push(`要有 ${col}（沒有效果就寫 null）`)
    else if (v !== null && !isRec(v)) p.push(`${col} 要是物件或 null`)
  }
  if (isRec(e.meat)) p.push(...meatProblems(e.meat, e.kind, k))
  if (isRec(e.net)) p.push(...meatProblems(e.net, e.kind, k, 'net', e.use))
  p.push(...prepProblems(e.prep, e.kind, k))
  if (e.daily !== undefined && e.daily !== null && !isRec(e.daily)) p.push('daily 要是物件或 null')
  return p
}

export function registerKinds(k: Pick<Kernel, 'content' | 'battle'>): void {
  k.content.defineKind<PathEntry>({
    kind: 'path', owner: OWNER,
    validate: pathProblems,
    refs: (e) => (typeof e.signature === 'string' ? [['ability', e.signature]] : []),
  })
  k.content.defineKind<AbilityEntry>({
    kind: 'ability', owner: OWNER,
    validate: (e) => abilityProblems(e, k),
    refs: (e) => (e.enemy !== true && typeof e.path === 'string' ? [['path', e.path]] : []),
  })
}

const DOMAIN_COLUMNS = [['meat', '現實'], ['net', '內海'], ['opinion', '輿論']] as const

/** 內容載入之後跑一次：要看別筆才知道對不對的檢查。有錯就丟，訊息一條一條列。 */
export function checkAbilities(k: Pick<Kernel, 'content' | 'battle'>): void {
  const problems: string[] = []
  const paths = new Map(k.content.list<PathEntry>('path').map((x) => [x.id, x]))
  const abilities = new Map(k.content.list<AbilityEntry>('ability').map((x) => [x.id, x]))

  for (const path of paths.values()) {
    const sig = abilities.get(path.signature)
    if (!sig) problems.push(`${path.id}：招牌技能 ${path.signature} 不存在`)
    else if (sig.path !== path.id) problems.push(`${path.id}：招牌技能 ${path.signature} 不在這棵樹（它屬於 ${sig.path}）`)
  }

  // 現實裡沒有效果的樹（媒體型：主播、偶像；SKILLS 1.6 節「無：不生效，裝著也一樣」）：共鳴也不能有現實的效果，不然會變成戰鬥裡的修正與池
  for (const path of paths.values()) {
    if (path.domains.meat !== 'none') continue
    path.resonance.forEach((r, i) => {
      const keys = Object.keys(r.effect ?? {}).filter((key) => key !== 'pending')
      if (keys.length) problems.push(`${path.id}：${path.tree}在現實沒有效果（domains.meat 是 none），resonance[${i}].effect 不能有 ${keys.join('、')}（現實的共鳴效果）`)
    })
  }

  for (const a of abilities.values()) {
    // 敵人的招牌行動沒有樹：只查花費的引用與 alter
    const path = a.enemy === true ? undefined : paths.get(a.path)
    if (a.enemy !== true && !path) {
      problems.push(`${a.id}：沒有 ${a.path} 這棵樹`)
      continue
    }
    if (path && a.category !== path.category) problems.push(`${a.id}：category（${a.category}）要和${path.tree}的 category（${path.category}）一樣`)
    if (path && a.after !== undefined) {
      const pre = abilities.get(a.after)
      if (!pre) problems.push(`${a.id}：前置 ${a.after} 不存在`)
      else if (pre.path !== a.path) problems.push(`${a.id}：前置 ${a.after} 不在同一棵樹（${a.id} 在 ${a.path}，${a.after} 在 ${pre.path}）`)
    }
    for (const [col, name] of DOMAIN_COLUMNS) {
      if (path && path.domains[col] === 'none' && a[col] !== null) problems.push(`${a.id}：${path.tree}在${name}沒有效果（domains.${col} 是 none），${col} 要是 null`)
    }
    // 兩欄各自的：cost 引用的技能要存在、alter 要改的技能要存在，而且改完的那一欄還要是合格的格式
    for (const col of ['meat', 'net'] as const) {
      const m = a[col]
      const cost = m?.cost
      if (cost && !abilities.has(cost.ability)) problems.push(`${a.id}：${col}.cost.ability 的 ${cost.ability} 不存在`)
      else if (cost?.per_turn !== undefined && abilities.get(cost.ability)!.kind !== 'active') problems.push(`${a.id}：${col}.cost.per_turn 的 ${cost.ability} 不是主動技能，每回合第幾次的減免沒有行動可以套`)
      for (const [i, alt] of (m?.alter ?? []).entries()) {
        const target = abilities.get(alt.ability)
        if (!target) {
          problems.push(`${a.id}：${col}.alter[${i}].ability 的 ${alt.ability} 不存在`)
          continue
        }
        const targetCol = target[col]
        if (!targetCol) {
          problems.push(`${a.id}：${col}.alter[${i}] 要改的 ${alt.ability} 沒有 ${col}`)
          continue
        }
        const changed = meatProblems(applySet(targetCol as Record<string, unknown>, alt.set), target.kind, k, col, target.use)
        for (const msg of changed) problems.push(`${a.id}：${col}.alter[${i}] 改過 ${alt.ability} 之後不合格：${msg}`)
      }
    }
    // 兩欄都有主動的行動時是同一個行動（照戰場選欄）：目標的種類要一樣，圓環才對得上
    if (a.kind === 'active' && isActionCol(a.meat) && isActionCol(a.net)) {
      const kindOf = (m: MeatDef): string => TARGET_KINDS[m.tease ? 'enemy' : (m.target ?? 'none')] ?? 'none'
      if (kindOf(a.meat) !== kindOf(a.net)) problems.push(`${a.id}：meat 與 net 兩欄都是主動的行動，目標的種類要一樣（meat 是 ${kindOf(a.meat)}、net 是 ${kindOf(a.net)}）；目標不同的寫成兩個技能`)
    }
  }
  if (problems.length) throw new Error(`技能內容的檢查沒過（${problems.length} 個）：\n${problems.slice(0, 20).join('\n')}`)
}

