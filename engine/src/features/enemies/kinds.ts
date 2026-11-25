// 內容種類 enemy 與 encounter 的格式（ENEMIES 第 2 節與 13 節；dev/work/M1-enemies.md 第三節）。

import type { ContentRegistry, Kernel } from '../../core'
import { ATTR_IDS, DAMAGE_TYPES, UNIT_RANKS } from '../../core'
import { lootProblems, lootRefs } from './loot'

export const OWNER = 'enemies'
export const ENEMY_KINDS = ['human', 'unbridged', 'machine', 'vehicle', 'mech', 'mascot', 'lace', 'program'] as const
export const ENEMY_MODES = ['lethal', 'neural', 'capture'] as const
export const AI_PREFERS = ['weakest', 'overloaded', 'leader', 'nearest', 'netrunner', 'bridged'] as const
export const ENCOUNTER_KINDS = ['light', 'normal', 'heavy', 'boss'] as const
/** 天使急救的會員等級與倒下之後倒數幾回合（ENEMIES 第 5 節：白銀 4、黃金 3、白金 2）。 */
export const ANGEL_GRADES = ['none', 'silver', 'gold', 'platinum'] as const
export const ANGEL_ROUNDS: Record<string, number> = { silver: 4, gold: 3, platinum: 2 }
export const COVER_LAYOUT_IDS = ['dense', 'medium', 'sparse', 'one_sided'] as const
/** 掛在格上的一台（position.size: 'overlay'）的種類（ENEMIES 第 10 節）；砲塔是裝在場景上的，不會移動。 */
export const OVERLAY_KINDS = ['attack', 'shield', 'scout', 'medic', 'jammer', 'turret'] as const
/** 一定要帶武器的種類：不帶武器的 attack、jammer、turret 沒有東西可以做。 */
const ARMED_OVERLAY_KINDS: readonly string[] = ['attack', 'jammer', 'turret']
/** 內海的敵人（M3-lace）：同步檔位（shift 是會換檔的）與蕾絲的顏色。 */
export const NET_SYNC_VALUES = ['shallow', 'standard', 'deep', 'full', 'shift'] as const
export const LACE_COLORS = ['white', 'pink', 'black'] as const
/** 只在內海戰鬥裡的種類：蕾絲與網內的程式（寫了 constructs 的別的種類也能進內海，見 netCapable）。 */
export const NET_ONLY_KINDS: readonly string[] = ['lace', 'program']
/** 沒有橋的種類：沒有感載這一條（ENEMIES 第 2 節的欄位表）。 */
export const UNBRIDGED_KINDS: readonly string[] = ['unbridged', 'machine', 'vehicle', 'mascot']

export interface EnemyWeapon {
  class: string
  name?: string
  type?: string
  traits?: string[]
  pierce?: number
  range?: [number, number]
  mag?: number
  /** 附帶效果（命中燃燒、義體失效、卡彈、炸膛……；格式由 features/combat 查）：buildWeapons 複製到 BattleWeapon.ext.fx */
  fx?: Record<string, unknown>
}
/** 內海的武器構裝（ENEMIES 第 2 節與第 15 節；DATA 6.2 節）：class 是 weapon_class 的 id（原型：距離、遮蔽倍率、特性），傷害骰照位階與等級。 */
export interface EnemyConstruct {
  id: string
  class: string
  name?: string
  type?: string
  ram?: number
  range?: [number, number]
  traits?: string[]
}
export interface EnemyMods {
  /** 內海：防護與 RAM 上限的加減（ENEMIES 第 2 節） */
  guard?: number
  ram?: number
  hp?: number
  load?: number
  armor?: number
  evade?: number
  attack?: number
  ap?: number
  layers?: number
  sensitivity?: number
  /** 沉溺 0～120（溺感邊緣 80～99；記在 unit.ext.enemies.sink，80 以上多一個標籤 sink_edge；這一張不做別的效果） */
  sink?: number
}
/** 一件義體（變成單位的 implants）。 */
export interface EnemyCyber {
  kind: string
  name: string
  contract?: boolean
}
/** 甲板（原樣放到 unit.ext.deck；M1b-hack 讀）。 */
export interface EnemyDeck {
  grade: number
  firewall: number
  slots: string[]
  tree?: string
}
/** 機甲的機體（只收格式、不啟動；欄位照核心的 BattleHull；M6 才用）。 */
export interface EnemyHull {
  id: string
  name: string
  hp: { now: number; max: number }
  armor: number
  backlash: number
  turns?: number
  ext?: Record<string, unknown>
}
/** 掛在格上的一台的身分（position.size 是 'overlay' 的兵種才寫）。 */
export interface EnemyOverlay {
  kind: (typeof OVERLAY_KINDS)[number]
  /** 固定在那一格、不會移動（砲塔一定是） */
  fixed?: boolean
}
/** 跟著主人的附屬單位：開打時掛上去，owner 是主人、autonomous（主人倒下之後自律）。 */
export interface EnemyAttached {
  /** 一個 overlay 的兵種 id */
  enemy: string
  count?: number
  /** same（和主人同一格；放不下的挪到最近的空格）或第幾格 */
  slot?: 'same' | number
}
/** 招牌行動：技能的 id（標了 enemy 的技能），或還沒轉的敘述 { name, text }（收下、不做效果）。 */
export type EnemySignature = string | { name: string; text: string }
/** 雙形象（CYBERSPACE 8.7 節；M4-enemies-m4）：性別的五個值（DATA 第 1 節）。 */
export const ENEMY_GENDERS = ['male', 'female', 'femboy', 'trans_f', 'futa'] as const
export type EnemyGender = (typeof ENEMY_GENDERS)[number]
/** 一個形象裡某個招牌行動換掉的名字與描寫（鍵是招牌行動的技能 id）。 */
export interface EnemyFormMove {
  name: string
  text?: string
}
/**
 * 一個形象：名稱、外觀、招牌行動的名字與描寫。數字（位階、感載上限、防護、攻擊的效果）兩個形象完全相同，不在這裡。
 * points_at：這個形象的描寫指向哪幾類對象（內容篩選的 male_partner 等五個；被關掉的類，指向它的形象不能用）；neutral: true 是本來就指向誰也不指（不受篩選影響）。
 */
export interface EnemyForm {
  name: string
  look: string
  moves?: Record<string, EnemyFormMove>
  points_at?: EnemyGender[]
  neutral?: boolean
}
/** 兩個形象都被篩選排除時用的中性外觀（沒寫就用資料的 name 與 desc）。 */
export interface EnemyNeutral {
  name: string
  look: string
  moves?: Record<string, EnemyFormMove>
}
export interface EnemyEntry {
  id: string
  name: string
  desc: string
  faction: string
  branch?: string
  rank: (typeof UNIT_RANKS)[number]
  grades: [number, number]
  kind: (typeof ENEMY_KINDS)[number]
  position: { prefer: number[]; cover_use?: number; size?: 1 | 'overlay' }
  /** position.size 是 'overlay' 時一定要寫：這個兵種不是一個單位，是掛在格上的一台 */
  overlay?: EnemyOverlay
  /** 跟著主人的附屬單位（會指揮的敵人：多一個行動 enemy.command） */
  attached?: EnemyAttached[]
  /** kind 是 mech 才寫：機體的資料，現在只檢查格式 */
  hull?: EnemyHull
  mode: (typeof ENEMY_MODES)[number]
  weapons: EnemyWeapon[]
  /** 內海：武器構裝（蕾絲與網內的敵人寫它，不寫 weapons） */
  constructs?: EnemyConstruct[]
  /** 內海：固定的同步檔位；shift 是會換檔的。沒寫：雜兵標準、精英深、首領 shift */
  sync?: (typeof NET_SYNC_VALUES)[number]
  /** 只有 kind: lace：白、粉、黑 */
  color?: (typeof LACE_COLORS)[number]
  /** 內海：每回合幾次管理行動（對方的潛網者） */
  admin?: number
  /** 內海：有人格（可以被說服、誘惑） */
  persona?: boolean
  ai: { prefer?: string; focus: number; flee_below: number; floor?: number; never_flee?: boolean; morale?: unknown; mode?: string; prefer_deep_sync?: boolean }
  mods?: EnemyMods
  attrs?: Record<string, number>
  skills?: Record<string, number>
  quick?: Array<{ item: string; qty: number }>
  named?: boolean
  base?: string
  strength?: number
  defeat?: string | string[]
  adult?: string[] | null
  /** false：打贏之後不能俘虜（非人形的機器、吉祥物、溺感者；ENEMIES 6.1 節）。沒寫就照種類：human 可以，機器要 humanoid，其餘不行 */
  capture?: boolean
  /** 人形的機器（機娘、人偶）：沒有感載，被電磁打到停機時制伏也算俘虜的條件（ENEMIES 6.1 節） */
  humanoid?: boolean
  signature?: EnemySignature[]
  /** 雙形象（M4-enemies-m4）：一場戰鬥開始時擲一次是 a 還是 b，整場固定；對 male 的目標一律 a */
  forms?: { a: EnemyForm; b: EnemyForm }
  neutral?: EnemyNeutral
  /** 簾後館擲文化用的標籤（M4-curtain-entry 讀；這裡只收格式） */
  culture?: string
  /** 掉落（ENEMIES 第 7 節；格式見 loot.ts）：{ item, chance, qty?, top? } 或還沒轉的 { text } */
  loot?: unknown[]
  /** 照等級掉現金晶片；false 是企業的人（身上沒有現金）。預設 true */
  cash?: boolean
  /** 一定帶著的特徵（enemy_trait 的 id；查不到的當成純標籤）；另外開戰時照 traits.ts 擲 */
  traits?: string[]
  /** 義體：每一件變成單位的 implants（cyber 是件數） */
  cyber?: EnemyCyber[]
  /** 甲板：原樣放到 unit.ext.deck */
  deck?: EnemyDeck
  /** 天使急救的會員等級：倒下時開始倒數，到了標成被帶走 */
  angel?: (typeof ANGEL_GRADES)[number]
  [field: string]: unknown
}
export interface EncounterFoe {
  enemy: string
  grade?: number
  slot?: number
  strength?: number
}
export interface EncounterEntry {
  id: string
  name: string
  grade: number
  kind?: (typeof ENCOUNTER_KINDS)[number]
  cover: string
  foes: EncounterFoe[]
  escapable?: boolean
  faction?: string
  ambush?: 'ally' | 'foe'
  field?: Record<string, boolean | number | string>
  nodes?: Array<{ kind: string; name?: string }>
  /** false：這場開戰不擲特徵（基準遭遇與具名的測試情境用；ENEMIES 第 5 節、dev/adr/0015 E10） */
  traits?: boolean
  [field: string]: unknown
}

const isRec = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)
const isInt = (v: unknown): v is number => typeof v === 'number' && Number.isInteger(v)
const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v)
const isText = (v: unknown): v is string => typeof v === 'string' && v.trim().length > 0
const isTextList = (v: unknown): v is string[] => Array.isArray(v) && v.every(isText)
const oneOf = (list: readonly unknown[], v: unknown) => list.includes(v)

/** 有 base 的那一筆：先拿 base 的整筆，再用自己寫的欄位蓋上去（淺的合併）。 */
export function mergeBase(base: Record<string, unknown>, own: Record<string, unknown>): Record<string, unknown> {
  return { ...base, ...own }
}

/** 這個兵種進得了內海的戰鬥嗎：蕾絲、網內的程式，或寫了 constructs 的（企業潛網者的化身）。 */
export function netCapable(e: { kind?: unknown; constructs?: unknown }): boolean {
  return (typeof e.kind === 'string' && NET_ONLY_KINDS.includes(e.kind)) || (Array.isArray(e.constructs) && e.constructs.length > 0)
}

/**
 * 網內的敵人資料的警告（資料檢查；M3 修正批）：蕾絲與網內的程式（白蕾絲除外）沒有寫 constructs，進內海之後手上沒有武器構裝，打不了任何人，
 * 戰鬥只能靠玩家一下一下磨完（M3 審查平衡一節：示意包的三個遊戲敵人就是這樣）。只有白蕾絲是故意不帶武器的（ENEMIES 第 9 節）。
 * 有 base 的先展開；展開失敗的不報（那是引用檢查的事）。回傳一串完整的句子。
 */
export function netEnemyWarnings(content: ContentRegistry): string[] {
  const out: string[] = []
  if (!content.hasKind('enemy')) return out
  for (const entry of content.list<EnemyEntry>('enemy')) {
    let e: EnemyEntry
    try {
      e = resolveEnemy(content, entry.id)
    } catch {
      continue
    }
    if (typeof e.kind !== 'string' || !NET_ONLY_KINDS.includes(e.kind) || e.color === 'white') continue
    if (Array.isArray(e.constructs) && e.constructs.length > 0) continue
    out.push(`敵人 ${entry.id}（${typeof e.name === 'string' ? e.name : entry.id}）是網內的${e.kind === 'lace' ? '蕾絲' : '程式'}、不是白蕾絲，但沒有寫 constructs：進內海之後手上沒有武器構裝，打不了任何人，戰鬥會拖成只能由玩家一下一下磨完。`)
  }
  return out
}

/** 這個兵種的打法：top-level 的 mode，沒寫就看 ai.mode（ENEMIES 第 15 節的樣本寫在 ai 裡）；網內的兵種都沒寫時是 neural。 */
export function enemyMode(e: Pick<EnemyEntry, 'kind' | 'ai'> & { mode?: unknown; constructs?: unknown }): (typeof ENEMY_MODES)[number] {
  if (oneOf(ENEMY_MODES, e.mode)) return e.mode as (typeof ENEMY_MODES)[number]
  const m = isRec(e.ai) ? e.ai.mode : undefined
  return oneOf(ENEMY_MODES, m) ? (m as (typeof ENEMY_MODES)[number]) : 'neural'
}

/** 一筆敵人資料，base 一層一層展開之後的樣子。找不到或繞圈就丟錯。 */
export function resolveEnemy(content: ContentRegistry, id: string, seen: string[] = []): EnemyEntry {
  const e = content.get<EnemyEntry>('enemy', id)
  if (!e) throw new Error(`沒有 ${id} 這個敵人`)
  if (typeof e.base !== 'string') return e
  if (seen.includes(id) || seen.length > 8) throw new Error(`敵人 ${id} 的 base 繞圈了：${[...seen, id].join(' → ')}`)
  const base = resolveEnemy(content, e.base, [...seen, id])
  return mergeBase(base as Record<string, unknown>, e as Record<string, unknown>) as EnemyEntry
}

/**
 * 附屬單位清單（兵種自己的 attached，或遭遇的 UnitRef.attached 蓋掉它的）的格式：陣列，每一筆 { enemy, count?, slot? }。
 * 空陣列合格（UnitRef 寫空陣列就是不帶）。at 是訊息裡的欄位路徑。
 */
export function attachedProblems(list: unknown, at: string): string[] {
  const p: string[] = []
  if (!Array.isArray(list)) return [`${at} 要是陣列（每一筆 { enemy, count?, slot? }）`]
  list.forEach((a, i) => {
    const here = `${at}[${i}]`
    if (!isRec(a)) return void p.push(`${here} 要是 { enemy, count?, slot? }`)
    if (!isText(a.enemy)) p.push(`${here}.enemy 要是一個 overlay 兵種的 id`)
    if (a.count !== undefined && !(isInt(a.count) && a.count >= 1 && a.count <= 4)) p.push(`${here}.count 要是 1～4 的整數`)
    if (a.slot !== undefined && a.slot !== 'same' && !(isInt(a.slot) && a.slot >= 1 && a.slot <= 4)) p.push(`${here}.slot 要是 'same' 或 1～4 的整數`)
    for (const key of Object.keys(a)) if (!['enemy', 'count', 'slot'].includes(key)) p.push(`${here}.${key} 不是可以用的鍵（只有 enemy、count、slot）`)
  })
  return p
}

/** 掛在格上的一台（overlay）、附屬單位（attached）與機甲的機體（hull）的格式。partial 時 kind 與 weapons 可能還沒展開，只檢查寫了的。 */
function overlayProblems(e: Record<string, unknown>, partial: boolean): string[] {
  const p: string[] = []
  const isOverlay = isRec(e.position) && e.position.size === 'overlay'
  if (e.overlay !== undefined) {
    const o = e.overlay
    if (!isRec(o)) p.push('overlay 要是 { kind, fixed? }')
    else {
      if (!(OVERLAY_KINDS as readonly unknown[]).includes(o.kind)) p.push(`overlay.kind 只能是 ${OVERLAY_KINDS.join('、')}`)
      if (o.fixed !== undefined && typeof o.fixed !== 'boolean') p.push('overlay.fixed 要是 true 或 false')
      for (const key of Object.keys(o)) if (key !== 'kind' && key !== 'fixed') p.push(`overlay.${key} 不是可以用的鍵（只有 kind、fixed）`)
      if (typeof o.kind === 'string' && ARMED_OVERLAY_KINDS.includes(o.kind) && Array.isArray(e.weapons) && e.weapons.length === 0) p.push(`overlay.kind 是 ${o.kind} 的一台要有武器（weapons 的第一把是它自己的武器）`)
    }
    if (!partial && !isOverlay) p.push("寫了 overlay 的兵種，position.size 要是 'overlay'")
  } else if (isOverlay && !partial) p.push("position.size 是 'overlay' 的兵種要寫 overlay: { kind, fixed? }")
  if (e.attached !== undefined) {
    if (isOverlay && Array.isArray(e.attached)) p.push('掛在格上的一台自己不能再帶附屬單位（attached）')
    p.push(...attachedProblems(e.attached, 'attached'))
  }
  if (e.hull !== undefined) {
    const h = e.hull
    if (!partial && e.kind !== 'mech') p.push("hull（機體）只有 kind 是 'mech' 的兵種可以寫")
    if (!isRec(h)) p.push('hull 要是 { id, name, hp, armor, backlash, turns?, ext? }')
    else {
      if (!isText(h.id)) p.push('hull.id 要是機體的 id')
      if (!isText(h.name)) p.push('hull.name 要是名字')
      const hp = h.hp
      if (!(isRec(hp) && isNum(hp.now) && isNum(hp.max) && hp.max >= 1 && hp.now >= 0 && hp.now <= hp.max)) p.push('hull.hp 要是 { now, max }（max 至少 1，now 在 0 到 max 之間）')
      if (!(isInt(h.armor) && h.armor >= 0)) p.push('hull.armor 要是 0 以上的整數（啟動期間加在護甲上的值）')
      if (!(isNum(h.backlash) && h.backlash >= 0 && h.backlash <= 1)) p.push('hull.backlash 要是 0～1 的數字（機體受到的傷害有多少比例回灌成機師的感載）')
      if (h.turns !== undefined && !(isInt(h.turns) && h.turns >= 1)) p.push('hull.turns 要是 1 以上的整數（還剩幾個自己的回合）')
      if (h.ext !== undefined && !isRec(h.ext)) p.push('hull.ext 要是物件')
      for (const key of Object.keys(h)) if (!['id', 'name', 'hp', 'armor', 'backlash', 'turns', 'ext'].includes(key)) p.push(`hull.${key} 不是可以用的鍵（照核心的 BattleHull：id、name、hp、armor、backlash、turns、ext）`)
    }
  }
  return p
}

/** moves：{ 招牌行動的 id: { name, text? } }。 */
function movesProblems(v: unknown, at: string): string[] {
  const p: string[] = []
  if (!isRec(v)) return [`${at} 要是 { 招牌行動的 id: { name, text? } }`]
  for (const [id, m] of Object.entries(v)) {
    if (!isRec(m) || !isText(m.name) || (m.text !== undefined && !isText(m.text))) p.push(`${at}.${id} 要是 { name, text? }（名字與描寫都要是文字）`)
    else for (const key of Object.keys(m)) if (key !== 'name' && key !== 'text') p.push(`${at}.${id}.${key} 不是可以用的鍵（只有 name、text）`)
  }
  return p
}

/** 雙形象的欄位（forms、neutral、culture）的格式。partial 時 forms 可能還在 base 裡，只檢查寫了的。 */
function formProblems(e: Record<string, unknown>): string[] {
  const p: string[] = []
  if (e.forms !== undefined) {
    if (!isRec(e.forms)) p.push('forms 要是 { a: 形象, b: 形象 }')
    else {
      for (const key of Object.keys(e.forms)) if (key !== 'a' && key !== 'b') p.push(`forms.${key} 不是可以用的鍵（只有 a、b）`)
      for (const side of ['a', 'b'] as const) {
        const f = e.forms[side]
        const at = `forms.${side}`
        if (f === undefined) { p.push(`forms 要兩個形象都寫：缺 ${side}`); continue }
        if (!isRec(f)) { p.push(`${at} 要是 { name, look, moves?, points_at?, neutral? }`); continue }
        if (!isText(f.name)) p.push(`${at}.name 要是名稱`)
        if (!isText(f.look)) p.push(`${at}.look 要是外觀的描寫（一句話）`)
        if (f.moves !== undefined) p.push(...movesProblems(f.moves, `${at}.moves`))
        if (f.points_at !== undefined && !(Array.isArray(f.points_at) && f.points_at.every((g) => oneOf(ENEMY_GENDERS, g)))) p.push(`${at}.points_at 要是性別的陣列，只能用 ${ENEMY_GENDERS.join('、')}`)
        if (f.neutral !== undefined && typeof f.neutral !== 'boolean') p.push(`${at}.neutral 要是 true 或 false`)
        for (const key of Object.keys(f)) if (!['name', 'look', 'moves', 'points_at', 'neutral'].includes(key)) p.push(`${at}.${key} 不是可以用的鍵（只有 name、look、moves、points_at、neutral）`)
      }
    }
  }
  if (e.neutral !== undefined) {
    const n = e.neutral
    if (!isRec(n)) p.push('neutral 要是 { name, look, moves? }')
    else {
      if (!isText(n.name)) p.push('neutral.name 要是名稱')
      if (!isText(n.look)) p.push('neutral.look 要是外觀的描寫（一句話）')
      if (n.moves !== undefined) p.push(...movesProblems(n.moves, 'neutral.moves'))
      for (const key of Object.keys(n)) if (!['name', 'look', 'moves'].includes(key)) p.push(`neutral.${key} 不是可以用的鍵（只有 name、look、moves）`)
    }
  }
  if (e.culture !== undefined && !isText(e.culture)) p.push('culture 要是文化的標籤（文字）')
  return p
}

/** 內海的欄位（constructs、sync、color、admin、persona）的格式。 */
function netProblems(e: Record<string, unknown>): string[] {
  const p: string[] = []
  if (e.constructs !== undefined) {
    if (!Array.isArray(e.constructs)) p.push('constructs 要是陣列（每一筆 { id, class, name?, type?, ram?, range?, traits? }）')
    else {
      const seen = new Set<string>()
      e.constructs.forEach((c, i) => {
        const at = `constructs[${i}]`
        if (!isRec(c)) return void p.push(`${at} 要是 { id, class, name?, type?, ram?, range?, traits? }`)
        if (!isText(c.id)) p.push(`${at}.id 要是構裝的 id（戰鬥裡這把武器的 id）`)
        else if (seen.has(c.id)) p.push(`${at}.id：${c.id} 重複`)
        else seen.add(c.id)
        if (!isText(c.class)) p.push(`${at}.class 要是武器類型（weapon_class）的 id`)
        if (c.name !== undefined && !isText(c.name)) p.push(`${at}.name 要是名字`)
        if (c.type !== undefined && !oneOf(DAMAGE_TYPES, c.type)) p.push(`${at}.type 只能是 ${DAMAGE_TYPES.join('、')}`)
        if (c.ram !== undefined && !(isInt(c.ram) && c.ram >= 1 && c.ram <= 6)) p.push(`${at}.ram 要是 1～6 的整數（每次攻擊花的 RAM）`)
        if (c.range !== undefined && !(Array.isArray(c.range) && c.range.length === 2 && c.range.every(isInt) && c.range[0]! >= 1 && c.range[0]! <= c.range[1]! && c.range[1]! <= 7)) p.push(`${at}.range 要是 [近, 遠]，在 1～7 之間`)
        if (c.traits !== undefined && !isTextList(c.traits)) p.push(`${at}.traits 要是字串的陣列`)
        for (const key of Object.keys(c)) if (!['id', 'class', 'name', 'type', 'ram', 'range', 'traits'].includes(key)) p.push(`${at}.${key} 不是可以用的鍵（只有 id、class、name、type、ram、range、traits）`)
      })
    }
  }
  if (e.sync !== undefined && !oneOf(NET_SYNC_VALUES, e.sync)) p.push(`sync 只能是 ${NET_SYNC_VALUES.join('、')}`)
  if (e.color !== undefined) {
    if (!oneOf(LACE_COLORS, e.color)) p.push(`color 只能是 ${LACE_COLORS.join('、')}`)
    else if (e.kind !== undefined && e.kind !== 'lace') p.push("color 只有 kind 是 'lace' 的兵種可以寫")
  }
  if (e.admin !== undefined && !(isInt(e.admin) && e.admin >= 1 && e.admin <= 6)) p.push('admin 要是 1～6 的整數（每回合幾次管理行動）')
  if (e.persona !== undefined && typeof e.persona !== 'boolean') p.push('persona 要是 true 或 false')
  return p
}

/**
 * 檢查一筆敵人。partial 是「有 base 但 base 現在還找不到」（同一批內容裡還沒載入）：這時只檢查寫了的欄位的格式，不檢查必填；
 * 必填留到 base 展開之後（resolveEnemy 之後的使用處）。
 */
function enemyProblems(e: Record<string, unknown>, partial: boolean): string[] {
  const p: string[] = []
  const need = (key: string, ok: (v: unknown) => boolean, msg: string) => {
    if (e[key] === undefined) { if (!partial) p.push(`要有 ${key}（${msg}）`); return }
    if (!ok(e[key])) p.push(`${key} ${msg}`)
  }
  const opt = (key: string, ok: (v: unknown) => boolean, msg: string) => { if (e[key] !== undefined && !ok(e[key])) p.push(`${key} ${msg}`) }

  need('name', isText, '要是名字')
  need('desc', isText, '要是外觀的完整句子')
  need('faction', isText, '要是勢力的 id，沒有勢力寫 none')
  opt('branch', (v) => typeof v === 'string', '要是字串')
  need('rank', (v) => oneOf(UNIT_RANKS, v), `只能是 ${UNIT_RANKS.join('、')}`)
  need('grades', (v) => Array.isArray(v) && v.length === 2 && v.every(isInt) && v[0]! >= 1 && v[1]! <= 5 && v[0]! <= v[1]!, '要是 [最低, 最高]，1～5，最低不超過最高')
  need('kind', (v) => oneOf(ENEMY_KINDS, v), `只能是 ${ENEMY_KINDS.join('、')}`)
  // 內海的兵種（蕾絲、程式、寫了 constructs 的）可以不寫 mode（照 ai.mode，再沒有就是 neural）與 weapons
  const net = netCapable(e)
  if (e.mode !== undefined || !net) need('mode', (v) => oneOf(ENEMY_MODES, v), `只能是 ${ENEMY_MODES.join('、')}`)

  need('position', (v) => isRec(v), '要是 { prefer, cover_use? }')
  if (isRec(e.position)) {
    const pos = e.position
    if (!(Array.isArray(pos.prefer) && pos.prefer.length >= 1 && pos.prefer.every((s) => isInt(s) && s >= 1 && s <= 4))) p.push('position.prefer 要是至少一個 1～4 的整數')
    if (pos.cover_use !== undefined && !(isNum(pos.cover_use) && pos.cover_use >= 0 && pos.cover_use <= 1)) p.push('position.cover_use 要是 0～1 的數字')
    if (pos.size !== undefined && pos.size !== 1 && pos.size !== 'overlay') p.push("position.size 只能是 1（佔一格）或 'overlay'（掛在格上、和人重疊）")
  }
  p.push(...overlayProblems(e, partial))

  if (e.weapons !== undefined || !net) need('weapons', (v) => Array.isArray(v), '要是武器的陣列（可以是空的：沒有武器的單位不攻擊，戰鬥裡手上沒有武器）')
  p.push(...netProblems(e))
  if (Array.isArray(e.weapons)) {
    e.weapons.forEach((w, i) => {
      const at = `weapons[${i}]`
      if (!isRec(w)) return void p.push(`${at} 要是物件`)
      if (!isText(w.class)) p.push(`${at}.class 要是武器類型的 id`)
      if (w.name !== undefined && !isText(w.name)) p.push(`${at}.name 要是名字`)
      if (w.type !== undefined && !oneOf(DAMAGE_TYPES, w.type)) p.push(`${at}.type 只能是 ${DAMAGE_TYPES.join('、')}`)
      if (w.traits !== undefined && !isTextList(w.traits)) p.push(`${at}.traits 要是字串的陣列`)
      if (w.pierce !== undefined && !(isInt(w.pierce) && w.pierce >= 0)) p.push(`${at}.pierce 要是 0 以上的整數（這一把最後的穿甲）`)
      if (w.range !== undefined && !(Array.isArray(w.range) && w.range.length === 2 && w.range.every(isInt) && w.range[0]! >= 1 && w.range[0]! <= w.range[1]! && w.range[1]! <= 7)) p.push(`${at}.range 要是 [近, 遠]，在 1～7 之間`)
      if (w.mag !== undefined && !(isInt(w.mag) && w.mag >= 1 && w.mag <= 4)) p.push(`${at}.mag 要是 1～4（格）`)
      // fx 的內容由 features/combat 在載入之後查（checkItems）；這裡只看是物件
      if (w.fx !== undefined && !isRec(w.fx)) p.push(`${at}.fx 要是物件（武器的附帶效果）`)
    })
  }

  need('ai', (v) => isRec(v), '要是 { prefer, focus, flee_below, … }')
  if (isRec(e.ai)) {
    const ai = e.ai
    if (ai.prefer !== undefined && !oneOf(AI_PREFERS, ai.prefer)) p.push(`ai.prefer 只能是 ${AI_PREFERS.join('、')}`)
    if (!isNum(ai.focus)) p.push('ai.focus 要是數字')
    if (!(isNum(ai.flee_below) && ai.flee_below >= 0 && ai.flee_below <= 1)) p.push('ai.flee_below 要是 0～1 的數字')
    if (ai.floor !== undefined && !isNum(ai.floor)) p.push('ai.floor 要是數字')
    if (ai.never_flee !== undefined && typeof ai.never_flee !== 'boolean') p.push('ai.never_flee 要是 true 或 false')
    if (ai.mode !== undefined && !oneOf(ENEMY_MODES, ai.mode)) p.push(`ai.mode 只能是 ${ENEMY_MODES.join('、')}`)
    if (ai.prefer_deep_sync !== undefined && typeof ai.prefer_deep_sync !== 'boolean') p.push('ai.prefer_deep_sync 要是 true 或 false（優先打同步檔位開得深的人）')
  }

  if (e.mods !== undefined) {
    if (!isRec(e.mods)) p.push('mods 要是物件')
    else {
      for (const [k, v] of Object.entries(e.mods)) {
        if (k === 'hp' || k === 'load') { if (!(isNum(v) && v >= 0.5 && v <= 1.5)) p.push(`mods.${k} 要是 0.5～1.5 的倍數`) }
        else if (k === 'armor' || k === 'evade' || k === 'attack' || k === 'ap' || k === 'layers' || k === 'guard' || k === 'ram') { if (!isInt(v)) p.push(`mods.${k} 要是整數（加減）`) }
        else if (k === 'sensitivity') { if (!(isNum(v) && v >= 0 && v <= 100)) p.push('mods.sensitivity 要是 0～100') }
        else if (k === 'sink') { if (!(isNum(v) && v >= 0 && v <= 120)) p.push('mods.sink 要是 0～120（沉溺）') }
        else p.push(`mods.${k} 不是可以修正的鍵（只有 hp、load、armor、evade、attack、ap、layers、sensitivity、sink，內海另有 guard、ram）`)
      }
    }
  }
  const numMap = (key: string, keys?: readonly string[]) => {
    if (e[key] === undefined) return
    if (!isRec(e[key])) return void p.push(`${key} 要是物件`)
    for (const [k, v] of Object.entries(e[key] as Record<string, unknown>)) {
      if (keys && !keys.includes(k)) p.push(`${key}.${k} 不是屬性的 id`)
      else if (!isNum(v)) p.push(`${key}.${k} 要是數字`)
    }
  }
  numMap('attrs', ATTR_IDS)
  numMap('skills')
  if (e.quick !== undefined) {
    if (!(Array.isArray(e.quick) && e.quick.every((q) => isRec(q) && isText(q.item) && isInt(q.qty) && q.qty >= 1))) p.push('quick 要是 [{ item, qty }]，qty 是 1 以上的整數')
  }
  opt('named', (v) => typeof v === 'boolean', '要是 true 或 false')
  opt('base', isText, '要是制式兵種的 id')
  opt('strength', (v) => isNum(v) && v > 0 && v <= 2, '（強度係數）要是 0 到 2 之間的數字')
  opt('defeat', (v) => typeof v === 'string' || isTextList(v), '要是字串或字串的陣列')
  opt('adult', (v) => v === null || isTextList(v), '要是字串的陣列或 null')
  opt('capture', (v) => typeof v === 'boolean', '要是 true 或 false（false：打贏之後不能俘虜）')
  opt('humanoid', (v) => typeof v === 'boolean', '要是 true 或 false（人形的機器：被電磁打到停機時制伏也算俘虜）')
  opt('signature', Array.isArray, '要是陣列')
  if (Array.isArray(e.signature)) {
    e.signature.forEach((s, i) => {
      if (isText(s)) return
      if (isRec(s) && isText(s.name) && isText(s.text) && Object.keys(s).every((x) => x === 'name' || x === 'text')) return
      p.push(`signature[${i}] 要是技能的 id（字串），或還沒轉的敘述 { name, text }`)
    })
  }
  p.push(...formProblems(e))
  p.push(...lootProblems(e))
  opt('traits', isTextList, '要是字串的陣列')
  if (e.cyber !== undefined) {
    if (!Array.isArray(e.cyber)) p.push('cyber 要是陣列')
    else {
      e.cyber.forEach((c, i) => {
        const at = `cyber[${i}]`
        if (!isRec(c)) return void p.push(`${at} 要是 { kind, name, contract? }`)
        if (!isText(c.kind)) p.push(`${at}.kind 要是義體的種類（eye、arm、leg……）`)
        if (!isText(c.name)) p.push(`${at}.name 要是名字`)
        if (c.contract !== undefined && typeof c.contract !== 'boolean') p.push(`${at}.contract 要是 true 或 false`)
        for (const key of Object.keys(c)) if (!['kind', 'name', 'contract'].includes(key)) p.push(`${at}.${key} 不是可以用的鍵（只有 kind、name、contract）`)
      })
    }
  }
  if (e.deck !== undefined) {
    const d = e.deck
    if (!isRec(d)) p.push('deck 要是 { grade, firewall, slots }')
    else {
      if (!(isInt(d.grade) && d.grade >= 1 && d.grade <= 4)) p.push('deck.grade 要是 1～4 的整數（甲板的等級）')
      if (!isNum(d.firewall)) p.push('deck.firewall 要是數字（防火牆）')
      if (!isTextList(d.slots)) p.push('deck.slots 要是快駭程式 id 的陣列（可以是空的）')
      if (d.tree !== undefined && !isText(d.tree)) p.push('deck.tree 要是路數的 id')
      for (const key of Object.keys(d)) if (!['grade', 'firewall', 'slots', 'tree'].includes(key)) p.push(`deck.${key} 不是可以用的鍵（只有 grade、firewall、slots、tree）`)
    }
  }
  opt('angel', (v) => typeof v === 'string', `要是字串（${ANGEL_GRADES.join('、')}）`)
  if (typeof e.angel === 'string' && !(ANGEL_GRADES as readonly string[]).includes(e.angel)) p.push(`angel 只能是 ${ANGEL_GRADES.join('、')}（拿到 ${e.angel}）`)
  return p
}

export function registerKinds(k: Pick<Kernel, 'content'>): void {
  k.content.defineKind<EnemyEntry>({
    kind: 'enemy', owner: OWNER,
    validate(e) {
      if (typeof e.base === 'string') {
        // base 找得到就合併之後完整檢查；找不到（同一批裡還沒載入）只檢查寫了的欄位
        let merged: EnemyEntry | undefined
        try { if (k.content.has('enemy', e.base)) merged = mergeBase(resolveEnemy(k.content, e.base) as Record<string, unknown>, e) as EnemyEntry } catch { merged = undefined }
        return enemyProblems(merged ?? e, !merged)
      }
      return enemyProblems(e, false)
    },
    refs: (e) => [
      ...(e.faction && e.faction !== 'none' ? [['faction', e.faction] as [string, string]] : []),
      ...(Array.isArray(e.weapons) ? e.weapons.map((w) => ['weapon_class', w.class] as [string, string]) : []),
      ...(Array.isArray(e.constructs) ? e.constructs.filter((c) => isRec(c) && typeof c.class === 'string').map((c) => ['weapon_class', c.class] as [string, string]) : []),
      ...(e.base ? [['enemy', e.base] as [string, string]] : []),
      // 附屬單位：要查得到（是不是 overlay 的兵種由 ready 的檢查看）
      ...(Array.isArray(e.attached) ? e.attached.filter((a) => isRec(a) && typeof a.enemy === 'string').map((a) => ['enemy', a.enemy] as [string, string]) : []),
      // 招牌行動寫技能的 id 的：要查得到（標了 enemy 由 ready 的檢查看）
      ...(Array.isArray(e.signature) ? e.signature.filter((s): s is string => typeof s === 'string').map((s) => ['ability', s] as [string, string]) : []),
      ...(Array.isArray(e.quick) ? e.quick.map((q) => ['item', q.item] as [string, string]) : []),
      ...lootRefs(k.content, e),
    ],
  })

  k.content.defineKind<EncounterEntry>({
    kind: 'encounter', owner: OWNER,
    validate(e) {
      const p: string[] = []
      if (!isText(e.name)) p.push('要有 name（地點或場合）')
      if (!(isInt(e.grade) && e.grade >= 1 && e.grade <= 5)) p.push('grade 要是 1～5 的整數')
      if (e.kind !== undefined && !oneOf(ENCOUNTER_KINDS, e.kind)) p.push(`kind 只能是 ${ENCOUNTER_KINDS.join('、')}`)
      if (!oneOf(COVER_LAYOUT_IDS, e.cover)) p.push(`cover 只能是 ${COVER_LAYOUT_IDS.join('、')}`)
      if (!(Array.isArray(e.foes) && e.foes.length >= 1)) p.push('foes 要有至少一筆')
      else {
        e.foes.forEach((f, i) => {
          const at = `foes[${i}]`
          if (!isRec(f)) return void p.push(`${at} 要是物件`)
          if (!isText(f.enemy)) p.push(`${at}.enemy 要是敵人的 id`)
          if (f.grade !== undefined && !(isInt(f.grade) && f.grade >= 1 && f.grade <= 5)) p.push(`${at}.grade 要是 1～5 的整數`)
          if (f.slot !== undefined && !(isInt(f.slot) && f.slot >= 1 && f.slot <= 4)) p.push(`${at}.slot 要是 1～4 的整數`)
          if (f.strength !== undefined && !(isNum(f.strength) && f.strength > 0 && f.strength <= 2)) p.push(`${at}.strength 要是 0 到 2 之間的數字`)
        })
      }
      if (e.escapable !== undefined && typeof e.escapable !== 'boolean') p.push('escapable 要是 true 或 false')
      if (e.faction !== undefined && !isText(e.faction)) p.push('faction 要是勢力的 id')
      if (e.ambush !== undefined && e.ambush !== 'ally' && e.ambush !== 'foe') p.push('ambush 只能是 ally 或 foe')
      if (e.field !== undefined && !(isRec(e.field) && Object.values(e.field).every((v) => ['boolean', 'number', 'string'].includes(typeof v)))) p.push('field 要是 { 名字: 布林、數字或字串 }')
      if (e.traits !== undefined && typeof e.traits !== 'boolean') p.push('traits 要是 true 或 false（false：這場開戰不擲特徵）')
      if (e.nodes !== undefined && !(Array.isArray(e.nodes) && e.nodes.every((n) => isRec(n) && isText(n.kind) && (n.name === undefined || isText(n.name))))) p.push('nodes 要是 [{ kind, name? }]')
      return p
    },
    refs: (e) => [
      ...(Array.isArray(e.foes) ? e.foes.map((f) => ['enemy', f.enemy] as [string, string]) : []),
      ...(e.faction && e.faction !== 'none' ? [['faction', e.faction] as [string, string]] : []),
    ],
  })
}
