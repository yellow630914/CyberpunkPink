// L6 功能 npcs 的互動選單：聊天、送禮、誘惑、交涉（小、中、大）、威嚇、偷竊、快駭讀橋（M2-npc-interact）。
// 規格：NPC_SYSTEM 第 6 節（6.1 選單、6.2 基準 DC 與修正、6.3 送禮與偷竊、6.4 讀橋、6.5 誘惑）；AI_TASKS 3.1 節；dev/adr/0016 第七節。
//
// 每一種互動是資料裡一筆行動種類（`owner: 'npcs'`；名字、屬性、基本功、時間照資料），由這裡用核心的 actionKindToDef 轉成定義，再加上：
//   dc      照對象算（警覺 − ⌊親密度 ÷ 20⌋ ＋ 情境修正；請託照資料寫的檔位；讀橋 10 ＋ 防護階 × 3）
//   block   能不能做（一條一句）
//   hint    只有資料自己寫的參考範圍（'$target' 換成對象的 id）；6.1 節那張表的結果不放在這裡（原因見下面）
// 6.1 節那張表的結果（AI 關著時的結算）由 report.before 掛鉤加進這份報告的變更，用內建的來源驗與夾（親密度 −20、偷到的錢這類不受 AI 的一件事上限管，
// 區的倍率照樣算）：AI 關著時行動鏈的退路只給「參考範圍的一半」、而且當成 AI 的來源夾，給不了表上的數。AI 開著時，AI 自己交出的效果
// （照量表的上限夾）優先：同一種量表同一個鍵、現金、同一件物品、已知的事，AI 已經給了的，表不再加。
// 每天的次數記在 state.ext.npcs.today（變更 npcs.did），也由同一個掛鉤記。掛鉤要知道對象、禮物與讀橋的類別，但報告上沒有行動的輸入：
// interactInput 把它們寫在文字結尾的〔npc=… item=… category=…〕，沒帶標記的輸入 block 擋下（要核心在報告上帶行動輸入才能拿掉這個標記，見回報）。
// 資料沒有某一筆時，那個互動就不存在（interactions 裡沒有它，也不丟錯）。
//
// 讀別的功能的數字只經由 meterOf（hostility、favor、fame；沒有人定義就當 0、不加那條修正）、條件與內容；不 import 別的功能。

import type { ActionHint, ActionInput, ActionKindDef, ActionKindEntry, Change, ContentEntry, Effect, GameState, Grade, HintCtx, Kernel } from '../../core'
import { DC_TIERS, actionKindToDef, blankState, checkParts, clone, computeDegree, countItem, dcFor, deriveRng, effectCtx, isRecord, isSafeInt, meterOf, tagsAllowed } from '../../core'
import type { Npc, NpcKind } from './model'
import { AFFINITY, GENDER_TAG, doneToday, ensureNpcs, knows, knownFacts, npcOf, npcsHere } from './model'

const OWNER = 'npcs'
export const INTERACT_RULE_KIND = 'npc_interact_rule'

/** 互動的行動種類 id（資料寫 `owner: 'npcs'` 的那幾筆）。 */
export const INTERACT_KINDS = ['npc_chat', 'npc_gift', 'npc_seduce', 'npc_ask_small', 'npc_ask_mid', 'npc_ask_big', 'npc_intimidate', 'npc_steal', 'npc_read_bridge'] as const
export type InteractKind = (typeof INTERACT_KINDS)[number]
const isInteract = (id: unknown): id is InteractKind => (INTERACT_KINDS as readonly unknown[]).includes(id)
const ASK_SIZE: Partial<Record<InteractKind, 'small' | 'mid' | 'big'>> = { npc_ask_small: 'small', npc_ask_mid: 'mid', npc_ask_big: 'big' }
const SIZE_NAME = { small: '小', mid: '中', big: '大' } as const

/** 讀橋的五個類別（6.4 節）。 */
export const READ_CATEGORIES = ['tendency', 'bridge', 'contract', 'recent', 'secret'] as const
export type ReadCategory = (typeof READ_CATEGORIES)[number]
export const CATEGORY_NAME: Record<ReadCategory, string> = { tendency: '傾向', bridge: '橋參數', contract: '契約', recent: '近況', secret: '秘密的碎片' }

/** 互動用的行動輸入：ActionInput 加上禮物（item）與讀橋的類別（category）。 */
export interface NpcActionInput extends ActionInput {
  item?: string
  category?: string
}

// ---- 規則（數字的預設照設計書；內容種類 npc_interact_rule，id: default 蓋掉）----

type Pair = [number, number]
export interface InteractRules {
  /** 親密度每幾點讓 DC 少 1（6.2 節：20） */
  affinity_step: number
  /** 對方勢力的好感：high 以上 DC 加 high_mod，low 以下加 low_mod（6.2 節：60 以上 −1、20 以下 +1） */
  favor: { high: number; high_mod: number; low: number; low_mod: number }
  /** 對方勢力的敵對值 at 以上 DC 加 mod（6.2 節：40、+2） */
  hostility: { at: number; mod: number }
  /** 威嚇：對方的勢力在這裡是主場（6.2 節：+2） */
  home_mod: number
  /** 誘惑：這一區的豔名每幾點 DC 少 1（6.2 節：25） */
  fame_step: number
  /** 誘惑：知道對方的傾向、而且合（−2）／讀過、對方傾向全不合（+2）（6.2 節） */
  tendency: { known: number; none: number }
  gift: {
    /** 送禮的 DC 比基準低多少（6.1 節：−2，所以寫 −2） */
    dc: number
    /** 財富 0～5 的倍率（6.3 節：0 級 ×0.5……5 級 ×8；中間的設計書沒寫，先照 1、2、3、5） */
    wealth_mult: number[]
    /** [價值至少, 親密度加多少]（6.3 節：10→1、60→2、250→4、1000→6） */
    tiers: Pair[]
    /** 合對方的喜好再加（6.3 節：2） */
    liked: number
    /** 大成功再多加（設計書沒寫：1） */
    critical: number
    /** 冒犯（送黑帶給不碰的人、大失敗）：6.1 節 −3 */
    offend: number
    /** 窮人幾乎都喜歡的「真的食物」是哪些標籤、財富幾級以下算窮 */
    food_tags: string[]
    poor_max: number
  }
  /** 聊天：大成功、成功、大失敗的親密度（6.1 節：+4、+2、−2） */
  chat: { critical: number; success: number; fumble: number }
  /** 誘惑：大成功（設計書沒寫：+5）、成功、失敗、大失敗（6.1 節：+3、−2、−5） */
  seduce: { critical: number; success: number; fail: number; fumble: number }
  /** 交涉大失敗的親密度（6.1 節：−3） */
  ask: { fumble: number }
  /** 威嚇：成功的親密度（−3）、大失敗他所屬勢力的敵對值（+3） */
  intimidate: { success: number; fumble_hostility: number }
  steal: {
    /** 財富 0～5 偷到的現金範圍（設計書只說「依財富」：數字暫定）；大成功偷到上限 */
    cash: Pair[]
    fail: { affinity: number; hostility: number }
    fumble: { affinity: number; hostility: number }
  }
  read: {
    /** DC = base + 防護階 × per_tier（6.4 節：10、3） */
    base: number
    per_tier: number
    /** 沒有寫防護階（旗標 shield:N）的人，照身分類的預設（6.4 節：街坊 0、行者 1、職員 2） */
    tiers: Record<NpcKind, number>
    /** 成功、大成功揭開幾項（6.4 節：1、2） */
    reveal: Pair
    /** 大失敗（6.1 節）：親密度 −10、勢力敵對值 +3；夜鶯的敵對值 +2 */
    fumble: { affinity: number; hostility: number; alert_faction: string; alert_hostility: number }
  }
  /** 帶這些旗標的是中間人：不能威嚇（6.1 節） */
  fixer_flags: string[]
}

export const DEFAULT_INTERACT_RULES: InteractRules = {
  affinity_step: 20,
  favor: { high: 60, high_mod: -1, low: 20, low_mod: 1 },
  hostility: { at: 40, mod: 2 },
  home_mod: 2,
  fame_step: 25,
  tendency: { known: -2, none: 2 },
  gift: {
    dc: -2, wealth_mult: [0.5, 1, 2, 3, 5, 8], tiers: [[10, 1], [60, 2], [250, 4], [1000, 6]], liked: 2, critical: 1, offend: -3, food_tags: ['food'], poor_max: 1,
  },
  chat: { critical: 4, success: 2, fumble: -2 },
  seduce: { critical: 5, success: 3, fail: -2, fumble: -5 },
  ask: { fumble: -3 },
  intimidate: { success: -3, fumble_hostility: 3 },
  steal: {
    cash: [[5, 20], [15, 50], [40, 120], [100, 300], [250, 700], [600, 2000]],
    fail: { affinity: -10, hostility: 3 },
    fumble: { affinity: -20, hostility: 6 },
  },
  read: {
    base: 10, per_tier: 3, tiers: { citizen: 0, runner: 1, staff: 2 }, reveal: [1, 2],
    fumble: { affinity: -10, hostility: 3, alert_faction: 'nightingale', alert_hostility: 2 },
  },
  fixer_flags: ['fixer', 'broker'],
}

function merge(base: unknown, over: unknown): unknown {
  if (isRecord(base) && isRecord(over)) {
    const out: Record<string, unknown> = { ...base }
    for (const [key, v] of Object.entries(over)) out[key] = key in base ? merge(base[key], v) : v
    return out
  }
  return over === undefined ? base : over
}

/** 照預設的形狀檢查資料寫的規則：多的鍵、型別不對、陣列不是對的長度都算問題。 */
function shapeProblems(def: unknown, over: unknown, path: string): string[] {
  if (over === undefined) return []
  if (Array.isArray(def)) {
    if (!Array.isArray(over)) return [`${path} 要是陣列`]
    if ((path.endsWith('wealth_mult') || path.endsWith('.cash')) && over.length !== def.length) return [`${path} 要有 ${def.length} 項（財富 0～5）`]
    const sample = def[0]
    return over.flatMap((x, i) => {
      const at = `${path}[${i}]`
      if (Array.isArray(sample)) {
        if (!(Array.isArray(x) && x.length === 2 && x.every((n) => typeof n === 'number' && Number.isInteger(n)))) return [`${at} 要是 [整數, 整數]`]
        return path.endsWith('.cash') && (x[0] as number) > (x[1] as number) ? [`${at} 的下限不能比上限大`] : []
      }
      if (typeof sample === 'string') return typeof x === 'string' && x ? [] : [`${at} 要是字串`]
      return typeof x === 'number' && Number.isFinite(x) && x > 0 ? [] : [`${at} 要是大於 0 的數字`]
    })
  }
  if (isRecord(def)) {
    if (!isRecord(over)) return [`${path} 要是物件`]
    return Object.entries(over).flatMap(([key, v]) => (key in def ? shapeProblems(def[key], v, `${path}.${key}`) : [`${path}.${key}：沒有這一項`]))
  }
  if (typeof def === 'number') return typeof over === 'number' && Number.isFinite(over) && Number.isInteger(over) ? [] : [`${path} 要是整數`]
  return typeof over === typeof def ? [] : [`${path} 要是${typeof def === 'string' ? '字串' : '布林'}`]
}

export function interactRuleProblems(e: Record<string, unknown>): string[] {
  const { id: _id, ...rest } = e
  return shapeProblems(DEFAULT_INTERACT_RULES, rest, INTERACT_RULE_KIND)
}

/** 現在生效的規則：資料 npc_interact_rule/default 蓋掉內建的預設。 */
export function interactRules(k: Pick<Kernel, 'content'>): InteractRules {
  const e = k.content.get<ContentEntry & Record<string, unknown>>(INTERACT_RULE_KIND, 'default')
  if (!e) return clone(DEFAULT_INTERACT_RULES)
  const { id: _id, ...rest } = e
  return merge(clone(DEFAULT_INTERACT_RULES), rest) as InteractRules
}

// ---- 讀對象 ----

type Cx = Pick<Kernel, 'content' | 'meters' | 'timeRules' | 'stats' | 'actions' | 'effects'>
const has = (k: Pick<Kernel, 'meters'>, kind: string): boolean => k.meters.has(kind)
const meter = (k: Pick<Kernel, 'meters'>, state: GameState, kind: string, key?: string): number => (has(k, kind) ? meterOf(k, state, kind, key) : 0)

const districtFactions = (k: Pick<Kernel, 'content'>, district: string | undefined): string[] => {
  const f = district ? k.content.get<ContentEntry & { factions?: unknown }>('district', district)?.factions : undefined
  return Array.isArray(f) ? f.filter((x): x is string => typeof x === 'string') : []
}

/** 敵對值記在對方所屬的勢力；沒有勢力的記在他那一區的主要勢力（6.1 節）。查不到勢力的內容就沒有。 */
export function factionOf(k: Pick<Kernel, 'content'>, state: GameState, n: Npc): string | undefined {
  const f = n.faction ?? districtFactions(k, n.home.district)[0] ?? districtFactions(k, state.location.district)[0]
  return f !== undefined && k.content.has('faction', f) ? f : undefined
}

const isHere = (k: Cx, state: GameState, id: string): boolean => npcsHere(k, state).some((n) => n.id === id)
const isFixer = (rules: InteractRules, n: Npc): boolean => n.flags.some((f) => rules.fixer_flags.includes(f))

/** 防護階（6.4 節）：旗標 shield:N 寫明的優先，否則照身分類。 */
export function shieldOf(rules: InteractRules, n: Npc): number {
  const f = n.flags.find((x) => /^shield:\d+$/.test(x))
  return f ? Number(f.slice(7)) : rules.read.tiers[n.kind]
}

/** 隊上有沒有人帶甲板：隊員的 ext.deck 有等級，或主角背包裡有帶 deck 標籤的東西。 */
export function hasDeck(k: Pick<Kernel, 'content'>, state: GameState): boolean {
  const onParty = state.party.some((id) => {
    const d = state.actors[id]?.ext.deck
    return isRecord(d) && typeof d.grade === 'number' && Number.isFinite(d.grade)
  })
  return onParty || state.inventory.some((s) => s.qty > 0 && (k.content.get<ContentEntry & { tags?: string[] }>('item', s.id)?.tags ?? []).includes('deck'))
}

/** 對方讀得出哪些已知的事（類別 → 還沒知道的幾項）。 */
function unknownFacts(state: GameState, n: Npc, category: ReadCategory): string[] {
  const known = new Set(knownFacts(state, n.id))
  let all: string[] = []
  switch (category) {
    case 'tendency': {
      const tags = Object.keys(n.tendencies.tags).sort()
      all = tags.length > 0 ? tags.map((t) => `tendency:${t}`) : ['tendency:none']
      break
    }
    case 'bridge': all = n.bridge ? ['bridge'] : []; break
    case 'contract': all = ['contract']; break
    case 'recent': {
      const places = n.haunts.map((h) => h.block ?? h.district).filter((p, i, a) => p && a.indexOf(p) === i && p !== state.location.block && p !== state.location.district)
      all = places.map((p) => `recent:${p}`)
      break
    }
    case 'secret': all = n.flags.filter((f) => f.startsWith('secret:') && f.length > 7); break
  }
  return all.filter((f) => !known.has(f))
}

// ---- 難度 ----

export interface DcMod {
  label: string
  value: number
}

const guardKinds: readonly InteractKind[] = ['npc_chat', 'npc_gift', 'npc_seduce', 'npc_intimidate', 'npc_steal']

/**
 * 這一次互動的 DC 與每一條來源（照 6.1、6.2 節）：回傳的 dc 是各條的合計（還沒加存檔的難度偏移）。
 * 警覺與親密度各一條、情境修正一條一條列；沒有裝的功能（敵對值、好感、豔名）那幾條當成 0、不列。
 */
export function difficulty(k: Cx, state: GameState, kind: InteractKind, n: Npc, entry: Pick<ActionKindEntry, 'dc'> | undefined): { dc: number; mods: DcMod[] } {
  const rules = interactRules(k)
  const mods: DcMod[] = []
  const add = (label: string, value: number): void => {
    if (value !== 0) mods.push({ label, value })
  }
  if (guardKinds.includes(kind)) {
    mods.push({ label: `${n.name}的警覺`, value: n.guard })
    const aff = meter(k, state, AFFINITY, n.id)
    add(`親密度 ${aff}`, -Math.floor(aff / rules.affinity_step))
    if (kind === 'npc_gift') add('送禮比較容易', rules.gift.dc)
  } else if (kind === 'npc_read_bridge') {
    mods.push({ label: '讀橋的底', value: rules.read.base })
    add(`防護階 ${shieldOf(rules, n)}`, shieldOf(rules, n) * rules.read.per_tier)
  } else {
    mods.push({ label: `請託的難度（${SIZE_NAME[ASK_SIZE[kind]!]}）`, value: entry ? DC_TIERS[entry.dc] : DC_TIERS.normal })
  }
  // 情境修正看「對方所屬勢力」：沒有勢力的人沒有這兩條（敵對值才記在那一區的主要勢力，見 factionOf）
  const faction = n.faction !== undefined && k.content.has('faction', n.faction) ? n.faction : undefined
  if (faction !== undefined && kind !== 'npc_read_bridge') {
    if (has(k, 'favor')) {
      const favor = meterOf(k, state, 'favor', faction)
      if (favor >= rules.favor.high) add(`對方勢力的好感 ${favor}`, rules.favor.high_mod)
      else if (favor <= rules.favor.low) add(`對方勢力的好感只有 ${favor}`, rules.favor.low_mod)
    }
    if (has(k, 'hostility')) {
      const hostility = meterOf(k, state, 'hostility', faction)
      if (hostility >= rules.hostility.at) add(`對方勢力的敵對值 ${hostility}`, rules.hostility.mod)
    }
  }
  if (kind === 'npc_seduce') {
    const facts = knownFacts(state, n.id)
    if (facts.includes('tendency:none')) add('知道對方沒有合得上的傾向', rules.tendency.none)
    else if (facts.some((f) => f.startsWith('tendency:'))) add('知道對方的傾向，投其所好', rules.tendency.known)
    if (has(k, 'fame')) {
      const fame = meterOf(k, state, 'fame')
      add(`這一區的豔名 ${fame}`, -Math.floor(fame / rules.fame_step))
    }
  }
  if (kind === 'npc_intimidate' && n.faction !== undefined && districtFactions(k, state.location.district).includes(n.faction)) add('對方的勢力在這裡是主場', rules.home_mod)
  return { dc: mods.reduce((s, m) => s + m.value, 0), mods }
}

// ---- 能不能做 ----

const NEED = {
  here: '他不在這裡：要在同一個地方才做得到。',
} as const

/**
 * 現在能不能對這個人做這件事：回傳擋住的原因（給玩家看的完整句子），可以做就是 null。
 * input 是 null 時是列選單用的（還沒選禮物、類別），只看對象與今天的次數。
 */
export function interactBlock(k: Cx, state: GameState, kind: InteractKind, npcId: string | undefined, input: NpcActionInput | null): string | null {
  if (npcId === undefined || npcId === '') return '要先指定對象。'
  const n = npcOf(k, state, npcId)
  if (!n || npcId === state.pc) return '查不到這個人。'
  const here = isHere(k, state, npcId)
  if (!knows(state, npcId) && !here) return `你還不認識${n.name}，他也不在這裡。`
  const rules = interactRules(k)
  const done = doneToday(state, npcId)
  const size = ASK_SIZE[kind]
  switch (kind) {
    case 'npc_gift': {
      if (done.includes('gift')) return `你今天已經送過${n.name}禮物了。`
      if (input) {
        if (typeof input.item !== 'string' || !input.item) return '要先選一件東西當禮物。'
        if (countItem(state.inventory, input.item) < 1) return `你的背包裡沒有${String(k.content.get('item', input.item)?.name ?? input.item)}。`
      }
      return null
    }
    case 'npc_seduce': {
      const tag = n.gender !== undefined ? GENDER_TAG[n.gender as keyof typeof GENDER_TAG] : undefined
      if (tag !== undefined && !tagsAllowed(state.rules, [tag])) return `你在內容篩選裡關掉了這一類對象，所以不能對${n.name}用誘惑。`
      return null
    }
    case 'npc_intimidate':
      return isFixer(rules, n) ? `${n.name}是中間人，不能威嚇。` : null
    case 'npc_steal':
      if (n.flags.includes('no_steal')) return `${n.name}的東西偷不得。`
      return here ? null : NEED.here
    case 'npc_read_bridge': {
      if (n.flags.includes('no_hack')) return `${n.name}的橋不能讀。`
      if (!n.bridge) return `${n.name}沒有橋，沒有東西可以讀。`
      if (!here) return NEED.here
      if (!hasDeck(k, state)) return '隊上沒有人帶甲板，沒辦法讀橋。'
      if (input && input.category !== undefined && !(READ_CATEGORIES as readonly unknown[]).includes(input.category)) return `讀橋的類別只有${READ_CATEGORIES.map((c) => CATEGORY_NAME[c]).join('、')}。`
      return null
    }
    default:
      if (size !== undefined) {
        if (done.includes('closed')) return `${n.name}今天不想再談了。`
        if (done.includes(`ask_${size}`)) return `你今天已經請${n.name}幫過${SIZE_NAME[size]}忙了。`
      }
      return null
  }
}

// ---- AI 關著時的結果（6.1 節那張表）----

const eff = (kind: string, fields: Record<string, unknown>): Effect => ({ kind, ...fields })

/** 這個人喜不喜歡這件禮物：旗標 likes:<物品 id 或標籤>；窮人幾乎都喜歡真的食物（6.3 節）。 */
export function giftLiked(k: Pick<Kernel, 'content'>, rules: InteractRules, n: Npc, itemId: string): boolean {
  const tags = k.content.get<ContentEntry & { tags?: string[] }>('item', itemId)?.tags ?? []
  if (n.flags.includes(`likes:${itemId}`) || tags.some((t) => n.flags.includes(`likes:${t}`))) return true
  return n.wealth <= rules.gift.poor_max && tags.some((t) => rules.gift.food_tags.includes(t))
}

/** 禮物的價值落在哪一級：價值先除以對方的財富倍率，再看第幾級（6.3 節）。回傳加的親密度（0 就是沒有達到最低一級）。 */
export function giftTier(rules: InteractRules, price: number, wealth: number): number {
  const mult = rules.gift.wealth_mult[Math.max(0, Math.min(rules.gift.wealth_mult.length - 1, wealth))] ?? 1
  const value = price / mult
  let bonus = 0
  for (const [min, add] of rules.gift.tiers) if (value >= min) bonus = add
  return bonus
}

/** 送這件禮物各成功程度會加多少親密度（給選單預覽用）。冒犯是負的。 */
export function giftGain(k: Pick<Kernel, 'content'>, rules: InteractRules, n: Npc, itemId: string, degree: 'critical' | 'success' | 'fail' | 'fumble'): number {
  if (degree === 'fumble') return rules.gift.offend
  if (degree === 'fail') return 0
  const item = k.content.get<ContentEntry & { price?: number; legal?: string }>('item', itemId)
  if (item?.legal === 'banned' && n.flags.includes('no_banned')) return rules.gift.offend
  const base = giftTier(rules, typeof item?.price === 'number' ? item.price : 0, n.wealth) + (giftLiked(k, rules, n, itemId) ? rules.gift.liked : 0)
  return base + (degree === 'critical' ? rules.gift.critical : 0)
}

/** 偷到多少現金：依財富（照這一次的亂數）；大成功偷到範圍的上限。 */
function stolen(state: GameState, rules: InteractRules, n: Npc, degree: string): number {
  const [lo, hi] = rules.steal.cash[Math.max(0, Math.min(rules.steal.cash.length - 1, n.wealth))] ?? [0, 0]
  if (degree === 'critical') return hi
  return deriveRng(state.rng, `npc_steal/${n.id}`, 0).int(lo, hi)
}

/** 讀橋揭開哪幾項：玩家選的類別先、不夠再照固定的順序補別的類別；每一項用這一次的亂數挑。 */
export function revealFacts(state: GameState, n: Npc, category: ReadCategory, count: number): string[] {
  const order: ReadCategory[] = [category, ...READ_CATEGORIES.filter((c) => c !== category)]
  const rng = deriveRng(state.rng, `npc_read/${n.id}`, 0)
  const out: string[] = []
  for (const c of order) {
    const pool = unknownFacts(state, n, c).filter((f) => !out.includes(f))
    while (pool.length > 0 && out.length < count) out.push(pool.splice(rng.int(0, pool.length - 1), 1)[0]!)
    if (out.length >= count) break
  }
  return out
}

type Degree = 'critical' | 'success' | 'fail' | 'fumble'

/** 6.1 節那張表：這一次互動的結果（效果的格式；沒有「認識他」這一步，那由呼叫的人先做）。 */
export function tableEffects(k: Cx, state: GameState, kind: InteractKind, n: Npc, input: NpcActionInput, degree: Degree): Effect[] {
  const rules = interactRules(k)
  const out: Effect[] = []
  const aff = (amount: number): void => void (amount !== 0 && out.push(eff(AFFINITY, { key: n.id, amount })))
  const faction = factionOf(k, state, n)
  const hostility = (amount: number): void => void (amount !== 0 && faction !== undefined && k.effects.has('hostility') && out.push(eff('hostility', { key: faction, amount })))
  const ok = degree === 'critical' || degree === 'success'
  switch (kind) {
    case 'npc_chat':
      // 每人每天只有第一次加親密度（大失敗照扣）
      if (degree === 'fumble') aff(rules.chat.fumble)
      else if (ok && !doneToday(state, n.id).includes('chat')) aff(degree === 'critical' ? rules.chat.critical : rules.chat.success)
      break
    case 'npc_gift':
      if (typeof input.item === 'string') {
        aff(giftGain(k, rules, n, input.item, degree))
        // 收下了才從背包少一件；不合意、冒犯的禮物還在手上
        if (ok) out.push(eff('item', { id: input.item, qty: -1 }))
      }
      break
    case 'npc_seduce':
      aff(rules.seduce[degree])
      break
    case 'npc_ask_small':
    case 'npc_ask_mid':
    case 'npc_ask_big':
      if (degree === 'fumble') aff(rules.ask.fumble)
      break
    case 'npc_intimidate':
      if (ok) aff(rules.intimidate.success)
      else if (degree === 'fumble') hostility(rules.intimidate.fumble_hostility)
      break
    case 'npc_steal':
      if (ok) out.push(eff('cash', { amount: stolen(state, rules, n, degree) }))
      else {
        const r = degree === 'fail' ? rules.steal.fail : rules.steal.fumble
        aff(r.affinity)
        hostility(r.hostility)
      }
      break
    case 'npc_read_bridge':
      if (ok) {
        const category = (READ_CATEGORIES as readonly unknown[]).includes(input.category) ? (input.category as ReadCategory) : 'tendency'
        for (const fact of revealFacts(state, n, category, rules.read.reveal[degree === 'critical' ? 1 : 0])) out.push(eff('npc_known', { npc: n.id, fact }))
      } else if (degree === 'fumble') {
        const f = rules.read.fumble
        aff(f.affinity)
        hostility(f.hostility)
        if (k.content.has('faction', f.alert_faction) && f.alert_faction !== faction && k.effects.has('hostility')) out.push(eff('hostility', { key: f.alert_faction, amount: f.alert_hostility }))
      }
      break
  }
  return out
}

/** 資料自己寫的參考範圍：'$target' 換成對象的 id；這張表管的那幾種效果不收（免得算兩次）。 */
const TABLE_KINDS = new Set([AFFINITY, 'hostility', 'cash', 'item', 'npc_known', 'meet'])
function dataHint(list: Effect[], target: string): Effect[] {
  return list.map((e) => JSON.parse(JSON.stringify(e).split('$target').join(target)) as Effect).filter((e) => !TABLE_KINDS.has(e.kind))
}

// ---- 成功率 ----

/** 成功（含大成功）的機率：1d20 的每一面都算一次。 */
export function successChance(k: Cx, state: GameState, def: ActionKindDef, input: ActionInput, dc: number): number | null {
  if (!state.pc || !state.actors[state.pc]) return null
  const attr = input.attr ?? def.attr
  const skill = input.skill ?? def.skill
  const mod = checkParts(k.stats, state, state.pc, { attr, skill, tags: def.tags ?? [], target: input.target }, input.situation).reduce((s, p) => s + p.value, 0)
  let wins = 0
  for (let n = 1; n <= 20; n++) {
    const d = computeDegree(n, n + mod, dc)
    if (d === 'critical' || d === 'success') wins++
  }
  return wins / 20
}

// ---- 註冊 ----

function entryProblems(k: Kernel, e: ActionKindEntry): string[] {
  const p: string[] = []
  if (e.skill && !k.content.has('skill', e.skill)) p.push(`沒有 ${e.skill} 這項基本功`)
  if (e.requires !== undefined) p.push(...k.conditions.validate(e.requires, 'requires'))
  const ctx = { state: blankState(0), actor: 'pc', grade: 1 as Grade, source: 'builtin', clampAsked: true, content: k.content } as Parameters<Kernel['effects']['validate']>[1]
  const tables: Array<[string, ActionHint | undefined]> = [['hint', e.hint], ...Object.entries(e.hint_by_grade ?? {}).map(([g, t]): [string, ActionHint] => [`hint_by_grade.${g}`, t])]
  for (const [name, table] of tables) {
    for (const [degree, list] of Object.entries(table ?? {})) {
      // '$target' 在執行時才換成對象：格式檢查時先換成任一個 id
      const probe = JSON.parse(JSON.stringify(list).split('$target').join('npc_probe')) as unknown[]
      p.push(...k.effects.validate(probe.filter((x) => !(isRecord(x) && typeof x.kind === 'string' && k.meters.has(x.kind))), ctx, `${name}.${degree}`))
    }
  }
  return p.map((m) => `行動 ${e.id}：${m}`)
}

function buildDef(k: Kernel, e: ActionKindEntry & { id: InteractKind }): ActionKindDef {
  const def = actionKindToDef(e, k, OWNER)
  const base = def.hint
  const dataReq = def.block
  def.reportKind = 'social'
  def.block = (state, input) => {
    const own = interactBlock(k, state, e.id, input.target, input as NpcActionInput)
    if (own) return own
    // 對象、禮物、讀橋的類別要寫在文字結尾的標記裡（interactInput 組的）：掛鉤只看得到報告
    const m = markOf(input.text)
    if (!m || m.npc !== input.target || m.item !== (input as NpcActionInput).item || m.category !== (input as NpcActionInput).category) return '互動的輸入要用 interactInput 組出來（文字結尾要帶對象的標記）。'
    return dataReq?.(state, input) ?? null
  }
  def.dc = (state, input) => {
    const n = typeof input.target === 'string' ? npcOf(k, state, input.target) : undefined
    return n ? difficulty(k, state, e.id, n, e).dc : DC_TIERS.normal
  }
  def.hint = base
    ? (ctx: HintCtx) => {
        const n = typeof ctx.input.target === 'string' ? npcOf(k, ctx.state, ctx.input.target) : undefined
        return n ? dataHint(base(ctx), n.id) : []
      }
    : undefined
  return def
}

/** 資料自己寫的 requires 不成立時的句子（沒有寫就是 null）。 */
function dataBlock(k: Pick<Kernel, 'conditions' | 'stats' | 'timeRules'>, state: GameState, e: ActionKindEntry | undefined): string | null {
  if (!e?.requires) return null
  return k.conditions.test(e.requires as never, { state, stats: k.stats, timeRules: k.timeRules }) ? null : (e.blocked_text ?? '現在做不了這件事。')
}

/** 資料裡 owner 是 npcs 的那幾筆互動：照格式檢查後註冊成行動種類。沒有的那一種互動就不存在。 */
export function registerInteractions(k: Kernel): void {
  const problems: string[] = []
  const entries = k.content.list<ActionKindEntry>('action_kind').filter((e) => e.owner === OWNER && isInteract(e.id))
  for (const e of entries) problems.push(...entryProblems(k, e))
  if (problems.length > 0) throw new Error(problems.join('；'))
  for (const e of entries) k.actions.register(buildDef(k, e as ActionKindEntry & { id: InteractKind }))
}

// ---- 對外：選單與輸入 ----

export interface InteractionView {
  kind: InteractKind
  name: string
  ok: boolean
  /** 做不了的原因（給玩家看的完整句子）；做得了是 null */
  reason: string | null
  /** 這一次的 DC（含存檔的難度偏移）；對象查不到時是 null */
  dc: number | null
  /** DC 的每一條來源（合計加上難度偏移就是 dc） */
  mods: DcMod[]
  /** 成功（含大成功）的機率，0～1 */
  chance: number | null
  attr: string
  skill: string | null
  /** 還要玩家選的：禮物（item）、讀橋的類別（category） */
  needs: 'item' | 'category' | null
}

/** 這一刻對這個人，每一種互動能不能做、原因、DC 與成功率（只列資料有的那幾種）。 */
export function interactions(k: Kernel, state: GameState, npc: string): InteractionView[] {
  const n = npcOf(k, state, npc)
  const out: InteractionView[] = []
  for (const id of INTERACT_KINDS) {
    const def = k.actions.get(id)
    if (!def || def.owner !== OWNER) continue
    const entry = k.content.get<ActionKindEntry>('action_kind', id)
    // 列選單時還沒選禮物、類別：只看對象與今天的次數；資料自己的 requires 照樣算
    const listing = interactBlock(k, state, id, npc, null) ?? dataBlock(k, state, entry)
    let dc: number | null = null
    let mods: DcMod[] = []
    let chance: number | null = null
    if (n) {
      const d = difficulty(k, state, id, n, entry)
      const offset = dcFor(0, state.rules)
      mods = offset !== 0 ? [...d.mods, { label: '難度設定', value: offset }] : d.mods
      dc = d.dc + offset
      chance = successChance(k, state, def, { kind: id, target: npc }, dc)
    }
    out.push({
      kind: id, name: def.name, ok: listing === null, reason: listing, dc, mods, chance, attr: def.attr, skill: def.skill ?? null,
      needs: id === 'npc_gift' ? 'item' : id === 'npc_read_bridge' ? 'category' : null,
    })
  }
  return out
}

export interface InteractExtra {
  /** 送禮：背包裡的哪一件 */
  item?: string
  /** 讀橋：要揭開哪一類 */
  category?: ReadCategory
  /** 玩家自己寫的話（不寫就用預設的一句）；對象的標記一律接在結尾 */
  text?: string
}

/** 組出要交給 Game.act 的輸入。資料沒有這一種互動、或查不到對象丟錯（呼叫的人的錯）。 */
export function interactInput(k: Kernel, state: GameState, kind: InteractKind, npc: string, extra: InteractExtra = {}): NpcActionInput {
  const def = k.actions.get(kind)
  if (!isInteract(kind) || !def || def.owner !== OWNER) throw new Error(`資料裡沒有 ${kind} 這種互動。`)
  const n = npcOf(k, state, npc)
  if (!n) throw new Error(`查不到 ${npc} 這個人。`)
  const itemName = extra.item !== undefined ? String(k.content.get('item', extra.item)?.name ?? extra.item) : ''
  const verb: Record<InteractKind, string> = {
    npc_chat: `和${n.name}聊天`, npc_gift: `送「${itemName}」給${n.name}`, npc_seduce: `對${n.name}用誘惑`,
    npc_ask_small: `請${n.name}幫一個小忙`, npc_ask_mid: `請${n.name}幫一個中等的忙`, npc_ask_big: `請${n.name}幫一個大忙`,
    npc_intimidate: `威嚇${n.name}`, npc_steal: `對${n.name}下手偷東西`, npc_read_bridge: `快駭讀${n.name}的橋`,
  }
  return {
    kind, target: npc, text: `${extra.text ?? verb[kind]}${markText({ npc, ...(extra.item !== undefined ? { item: extra.item } : {}), ...(extra.category !== undefined ? { category: extra.category } : {}) })}`,
    ...(extra.item !== undefined ? { item: extra.item } : {}),
    ...(extra.category !== undefined ? { category: extra.category } : {}),
  }
}

// ---- 報告上的標記、表的結果、每天的次數與旗標：都在互動那份報告提交前一起加 ----

export interface Mark {
  npc: string
  item?: string
  category?: string
}
const MARK = /〔npc=([A-Za-z0-9_:.-]+)(?: item=([A-Za-z0-9_:.-]+))?(?: category=([a-z_]+))?〕$/

/** 文字結尾的標記（interactInput 接上去的）。 */
export const markText = (m: Mark): string => `〔npc=${m.npc}${m.item !== undefined ? ` item=${m.item}` : ''}${m.category !== undefined ? ` category=${m.category}` : ''}〕`

/** 讀文字結尾的標記；沒有就是 null。 */
export function markOf(text: string | undefined): Mark | null {
  const m = text ? MARK.exec(text) : null
  return m ? { npc: m[1]!, ...(m[2] !== undefined ? { item: m[2] } : {}), ...(m[3] !== undefined ? { category: m[3] } : {}) } : null
}

/** 這個效果算的是哪一件事（AI 已經給了同一件，表就不再加）。 */
function familyOf(e: Effect): string {
  switch (e.kind) {
    case 'item': return `item:${String(e.id)}`
    case 'npc_known': return `known:${String(e.npc)}`
    case 'cash': return 'cash'
    default: return `meter:${e.kind}:${String(e.key ?? '')}`
  }
}
function familiesOf(changes: Change[]): Set<string> {
  const out = new Set<string>()
  for (const c of changes) {
    if (c.op === 'meter') out.add(`meter:${String(c.kind)}:${String(c.key)}`)
    else if (c.op === 'cash') out.add('cash')
    else if (c.op === 'item') out.add(`item:${String(c.id)}`)
    else if (c.op === 'npcs.known') out.add(`known:${String(c.npc)}`)
  }
  return out
}

export interface InteractDeps {
  /** 認識一個人要套的變更（index.ts 的 meetChanges；interact.ts 不能 import 它） */
  meetChanges(k: Kernel, state: GameState, id: string): Change[]
}

export function installInteract(k: Kernel, deps: InteractDeps): void {
  k.content.defineKind({ kind: INTERACT_RULE_KIND, owner: OWNER, validate: interactRuleProblems })

  // 每個人今天做過哪些互動
  k.changes.register<Change & { npc: string; what: string; day: number }>({
    op: 'npcs.did', owner: OWNER,
    validate: (_s, c) => [
      ...(typeof c.npc === 'string' && c.npc ? [] : ['npc 要是人的 id']),
      ...(typeof c.what === 'string' && ['chat', 'gift', 'ask_small', 'ask_mid', 'ask_big', 'closed'].includes(c.what) ? [] : ['what 要是 chat、gift、ask_small、ask_mid、ask_big 或 closed']),
      ...(isSafeInt(c.day) ? [] : ['day 要是整數']),
    ],
    apply(state, c) {
      const s = ensureNpcs(state)
      if (!s.today || s.today.day !== c.day) s.today = { day: c.day, done: {} }
      const list = (s.today.done[c.npc] ??= [])
      if (!list.includes(c.what)) list.push(c.what)
    },
  })

  k.hooks.on('report.before', OWNER, ({ state, draft }) => {
    const kind = draft.action
    if (!isInteract(kind)) return
    const mark = markOf(draft.input)
    const n = mark ? npcOf(k, state, mark.npc) : undefined
    if (!mark || !n) return
    const id = n.id
    const degree = draft.outcome.result as Degree
    const ok = degree === 'critical' || degree === 'success'
    const day = state.time.day
    const rules = interactRules(k)
    const out: Change[] = []

    // 6.1 節那張表：先認識他（還不認識的人），再照表算效果；AI 已經給了的那幾件不再加
    const work = clone(state)
    const meet = knows(state, id) ? [] : deps.meetChanges(k, state, id)
    if (meet.length > 0) k.changes.applyAll(work, meet)
    const have = familiesOf(draft.changes)
    const table = tableEffects(k, work, kind, n, { kind, target: id, ...(mark.item !== undefined ? { item: mark.item } : {}), ...(mark.category !== undefined ? { category: mark.category } : {}) }, degree)
      .filter((e) => !have.has(familyOf(e)))
    const resolved = k.effects.resolve(table, effectCtx(k, work, { source: 'builtin' }))
    out.push(...meet, ...(resolved.errors.length === 0 ? resolved.changes : []))

    // 每天的次數、旗標
    const did = (what: string): void => void out.push({ op: 'npcs.did', npc: id, what, day })
    const flag = (key: string): void => void out.push({ op: 'flag', key, value: day })
    switch (kind) {
      case 'npc_chat': did('chat'); break
      case 'npc_gift': did('gift'); break
      case 'npc_seduce': if (degree === 'fumble') flag(`npc_trouble:${id}`); break
      case 'npc_ask_small':
      case 'npc_ask_mid':
      case 'npc_ask_big': {
        const size = ASK_SIZE[kind]!
        did(`ask_${size}`)
        if (degree === 'fumble') did('closed')
        // 答應的內容（一則情報、折扣、引薦）M2 只記成旗標，等對應的系統接
        if (ok) flag(`npc_ask:${id}:${size}`)
        break
      }
      case 'npc_intimidate':
        if (ok) flag(`npc_obeyed:${id}`)
        else if (degree === 'fumble') flag(`npc_standoff:${id}`)
        break
      case 'npc_steal':
        if (isFixer(rules, n)) flag(`npc_fixer_rule:${id}`)
        if (degree === 'fumble' && n.kind === 'runner') flag(`npc_hostile:${id}`)
        break
      default: break
    }
    return out.length > 0 ? out : undefined
  })
}
