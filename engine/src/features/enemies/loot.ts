// 敵人的掉落：`loot` 的格式檢查，與打贏之後在戰鬥結束時的結算（ENEMIES 第 7 節前兩條與「機器」那一條；1.3 節；dev/adr/0011、0007；dev/work/M1b-loot.md）。
// 只在結束時擲（不在戰鬥的每一步裡）；骰子從存檔的狀態導出，用途是 battle/<這一場的 id>/loot，同一個狀態結算兩次一樣。
// 這一張不做：整件撿、拆活人、義體、生體件、授權鎖、殘響、俘虜的處置（M2、M4）；牌子與材質的隨機、整件撿武器這個格式還表達不出來。
// 內海（M3-lace；dev/adr/0018 N20）：網內的敵人不掉現金、不掉 item 的項目（零件、設計圖）；只有 { construct } 與 { credential } 兩種項目，
// 帶 needs: 'dissect' 的要我方這一場有人帶 dissect 標籤而且沒有倒下才擲。construct: 'random' 從內容的 construct 挑等級不超過這個敵人的武器、防護、工具各一類；
// 憑證是一件物品（規則表 net_enemy_rule 的 credential_item）。兩種項目在現實也照擲（企業的人身上的憑證）。

import type { BattleUnit, Change, ContentEntry, ContentRegistry, Kernel } from '../../core'
import { ITEM_MAX_PER_KIND, deriveRng, formatAmount, modeOf } from '../../core'
import type { EnemyEntry } from './kinds'
import { resolveEnemy } from './kinds'
import { credentialItem } from './lace'

/** 一筆會發東西的掉落。item 是任何一種物品類內容的 id（item、part、blueprint）。 */
export interface LootDrop {
  item: string
  chance: number
  qty?: number | [number, number]
  /** 這個兵種最高級的那一件：首領保證掉 */
  top?: boolean
  needs?: 'dissect'
}
/** 一件構裝（內海）：id 或 'random'（內容的 construct 裡挑等級不超過這個敵人的）。 */
export interface LootConstruct {
  construct: string
  chance: number
  needs?: 'dissect'
}
/** 一件憑證（規則表 net_enemy_rule 的 credential_item）。 */
export interface LootCredential {
  credential: true
  chance: number
  needs?: 'dissect'
}
/** 還沒轉成資料的敘述：收下、不發。 */
export interface LootText {
  text: string
}
export type LootEntry = LootDrop | LootConstruct | LootCredential | LootText
type AnyDrop = LootDrop | LootConstruct | LootCredential

/** 構裝掉落的類別（武器、防護、工具；不含駭入程式、構裝體、專屬構裝）。 */
export const LOOT_CONSTRUCT_CLASSES: readonly string[] = ['weapon', 'defense', 'tool']

/** 物品類的內容種類：掉落的 item 要在其中一種裡查得到。 */
export const LOOT_ITEM_KINDS = ['item', 'part', 'blueprint'] as const
/** 一個人最多掉幾件（件數：每一筆擲中的算一件，不管那一筆發幾個）。 */
export const LOOT_CAP = { minion: 1, elite: 2, boss: 3 } as const
/** 一個人至少掉幾件（ENEMIES 第 7 節「件數：雜兵 0～1、精英 1～2、首領 2～3」）：擲中的不夠就從沒擲中的補（機率高的先補），補到有東西可補為止。 */
export const LOOT_MIN = { minion: 0, elite: 1, boss: 2 } as const
/** 現金晶片的範圍，照那個人的等級（ENEMIES 第 7 節；每級約 3.2 倍）。 */
export const CASH_RANGE: Record<number, readonly [number, number]> = {
  1: [40, 120], 2: [130, 380], 3: [400, 1200], 4: [1300, 3900], 5: [4000, 12000],
}
/** 算掉落的退出方式：被打倒、昏過去、被制伏、投降。逃走與被帶走的不算。 */
const COUNTED_OUT: readonly string[] = ['down', 'burnout', 'subdued', 'surrendered']

const isRec = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)
const isInt = (v: unknown): v is number => typeof v === 'number' && Number.isInteger(v)
const isText = (v: unknown): v is string => typeof v === 'string' && v.trim().length > 0
const isItemDrop = (l: unknown): l is LootDrop => isRec(l) && isText(l.item)
const isDrop = (l: unknown): l is AnyDrop => isItemDrop(l) || (isRec(l) && (isText(l.construct) || l.credential === true))

/** loot 與 cash 兩個欄位的格式問題（空的就是合格）。 */
export function lootProblems(e: { loot?: unknown; cash?: unknown }): string[] {
  const p: string[] = []
  if (e.cash !== undefined && typeof e.cash !== 'boolean') p.push('cash 要是 true 或 false')
  if (e.loot === undefined) return p
  if (!Array.isArray(e.loot)) return [...p, 'loot 要是陣列']
  e.loot.forEach((l: unknown, i) => {
    const at = `loot[${i}]`
    if (!isRec(l)) return void p.push(`${at} 要是物件（{ item, chance, qty? }、{ construct, chance, needs? }、{ credential: true, chance, needs? } 或 { text }）`)
    const kinds = ['item', 'construct', 'credential'].filter((key) => l[key] !== undefined)
    if (kinds.length > 1) return void p.push(`${at} 只能寫 ${kinds.join('、')} 其中一個`)
    if (!kinds.length) {
      if (!isText(l.text)) p.push(`${at} 要是 { item, chance, qty? } 或 { text }（構裝與憑證另有 { construct, chance, needs? }、{ credential: true, chance, needs? }）`)
      return
    }
    const kind = kinds[0]!
    if (kind === 'item' && !isText(l.item)) return void p.push(`${at}.item 要是物品的 id`)
    if (kind === 'construct' && !isText(l.construct)) return void p.push(`${at}.construct 要是構裝的 id，或 'random'`)
    if (kind === 'credential' && l.credential !== true) return void p.push(`${at}.credential 只能寫 true`)
    if (!(typeof l.chance === 'number' && Number.isFinite(l.chance) && l.chance >= 0 && l.chance <= 1)) p.push(`${at}.chance 要是 0～1 的數字`)
    if (l.needs !== undefined && l.needs !== 'dissect') p.push(`${at}.needs 只能是 'dissect'（隊上有人會解剖）`)
    if (kind !== 'item') {
      for (const key of ['qty', 'top']) if (l[key] !== undefined) p.push(`${at}.${key}：構裝與憑證一次一件，不寫 ${key}`)
      return
    }
    if (l.qty !== undefined) {
      const ok = (isInt(l.qty) && l.qty >= 1) || (Array.isArray(l.qty) && l.qty.length === 2 && l.qty.every(isInt) && l.qty[0]! >= 1 && l.qty[0]! <= l.qty[1]!)
      if (!ok) p.push(`${at}.qty 要是 1 以上的整數，或 [最少, 最多]`)
    }
    if (l.top !== undefined && typeof l.top !== 'boolean') p.push(`${at}.top 要是 true 或 false`)
  })
  return p
}

/** 掉落引用的物品：在 item、part、blueprint 其中一種裡找得到就引用那一種；都找不到引用 item（訊息裡有那個 id）。 */
export function lootRefs(content: Pick<ContentRegistry, 'has'> & { hasKind?: ContentRegistry['hasKind'] }, e: { loot?: unknown }): Array<[string, string]> {
  if (!Array.isArray(e.loot)) return []
  const out = e.loot.filter(isItemDrop).map((l): [string, string] => [LOOT_ITEM_KINDS.find((kind) => content.has(kind, l.item)) ?? 'item', l.item])
  // 指名的構裝要查得到（沒有人定義 construct 這個種類時不查：那時它們只是不會掉）
  if (content.hasKind?.('construct') !== false) for (const l of e.loot) if (isRec(l) && isText(l.construct) && l.construct !== 'random') out.push(['construct', l.construct])
  return out
}

const nameOf = (content: ContentRegistry, id: string): string => {
  for (const kind of [...LOOT_ITEM_KINDS, 'construct']) {
    const n = content.get(kind, id)?.name
    if (typeof n === 'string' && n) return n
  }
  return id
}

const dropsOf = (e: EnemyEntry): AnyDrop[] => (Array.isArray(e.loot) ? e.loot.filter(isDrop) : [])
/** 這一筆掉落現在擲不擲：內海只有構裝與憑證（N20）；needs 要有人會解剖。 */
interface RollOn {
  net: boolean
  dissect: boolean
}
const rollsAt = (d: AnyDrop, on: RollOn): boolean => (!on.net || !isItemDrop(d)) && (d.needs !== 'dissect' || on.dissect)

/** 被帶走的標記由敵人的招牌行動寫（M1b-enemy-moves）；這裡只讀。 */
function isTaken(u: BattleUnit): boolean {
  const ext = u.ext.enemies
  return isRec(ext) && !!ext.taken
}

/** 擲出來的一筆。 */
type Hit = { drop: AnyDrop; qty: number }

/**
 * 一個人掉的東西：照 loot 的順序各擲一次，擲中的收進來到位階的上限為止；首領沒掉任何 top 時補上第一件 top；
 * 件數不到位階的下限（精英 1、首領 2）時，從沒擲中的補（機率高的先，同機率照 loot 的順序；機率 0 的是「不掉」，不補）。
 * 內海（on.net）沒有下限：只有 dissect 的構裝與憑證，不補。現在擲不了的項目（內海的 item、沒人會解剖的 needs）不擲。
 */
function rollUnit(rng: ReturnType<typeof deriveRng>, e: EnemyEntry, rank: string, on: RollOn): Hit[] {
  const drops = dropsOf(e).filter((d) => rollsAt(d, on))
  const cap = LOOT_CAP[rank as keyof typeof LOOT_CAP] ?? 1
  // 先把每一筆的機率與數量都擲完：順序固定，不會因為上限擋掉而讓後面的骰子位移
  const rolled = drops.map((d) => {
    const hit = rng.next() < d.chance
    const q = isItemDrop(d) ? d.qty : undefined
    const qty = Array.isArray(q) ? rng.int(q[0], q[1]) : (q ?? 1)
    return { drop: d, hit, qty }
  })
  const isTop = (d: AnyDrop): boolean => isItemDrop(d) && d.top === true
  let got = rolled.filter((r) => r.hit).slice(0, cap)
  if (rank === 'boss' && !got.some((r) => isTop(r.drop))) {
    const top = rolled.find((r) => isTop(r.drop))
    // 補上第一件 top；已經滿了就換掉最後一件，件數不超過首領的上限
    if (top) got = [...(got.length >= cap ? got.slice(0, cap - 1) : got), top]
  }
  const min = on.net ? 0 : (LOOT_MIN[rank as keyof typeof LOOT_MIN] ?? 0)
  if (got.length < min) {
    const rest = rolled.filter((r) => !got.includes(r) && r.drop.chance > 0).sort((a, b) => b.drop.chance - a.drop.chance)
    got = [...got, ...rest.slice(0, min - got.length)]
  }
  return got.map((r) => ({ drop: r.drop, qty: r.qty }))
}

/** 內容裡可以掉的構裝：等級不超過這個敵人、類別是武器、防護或工具（照 id 排好）。沒有人定義 construct 就是空的。 */
function constructPool(content: ContentRegistry, grade: number): string[] {
  if (!content.hasKind('construct')) return []
  return content.list<ContentEntry & { class?: string; grade?: number }>('construct')
    .filter((c) => LOOT_CONSTRUCT_CLASSES.includes(String(c.class)) && (typeof c.grade === 'number' ? c.grade : 1) <= grade)
    .map((c) => c.id).sort()
}

/** 一筆擲中的掉落是哪一件東西：item 就是它自己；construct 指名的要查得到、'random' 從 constructPool 抽一件；憑證是規則表指的那件物品。 */
function dropId(content: ContentRegistry, rng: ReturnType<typeof deriveRng>, d: AnyDrop, grade: number, credential: string | undefined): string | undefined {
  if (isItemDrop(d)) return d.item
  if (!('construct' in d)) return credential
  if (d.construct !== 'random') return content.get('construct', d.construct) ? d.construct : undefined
  const pool = constructPool(content, grade)
  return pool.length ? rng.pick(pool) : undefined
}

export function installLoot(k: Pick<Kernel, 'battle' | 'content'>, owner: string): void {
  k.battle.onEnd(owner, ({ state, battle, outcome }) => {
    if (outcome !== 'win') return
    const rng = deriveRng(state.rng, `battle/${battle.id}/loot`)
    const items = new Map<string, number>()
    const units = Object.values(battle.units) as BattleUnit[]
    // 內海（N20）：不掉現金與 item 的項目。needs: 'dissect'：我方這一場有人帶 dissect 標籤而且沒有倒下
    const on: RollOn = {
      net: modeOf(k.content, battle.mode)?.layer === 'net',
      dissect: units.some((u) => u.side === 'ally' && !u.out && u.tags.includes('dissect')),
    }
    const credential = credentialItem(k.content)
    let cash = 0
    for (const u of units) {
      if (u.side !== 'foe' || !u.enemy || !u.out || !COUNTED_OUT.includes(u.out) || isTaken(u)) continue
      if (!k.content.has('enemy', u.enemy)) continue
      const e = resolveEnemy(k.content, u.enemy)
      for (const { drop: d, qty } of rollUnit(rng, e, u.rank, on)) {
        // 隨機的構裝在整個單位擲完之後才挑；沒有可以掉的、內容裡沒有那件構裝或憑證物品就略過
        const id = dropId(k.content, rng, d, u.grade, credential)
        if (id !== undefined) items.set(id, (items.get(id) ?? 0) + qty)
      }
      if (!on.net && e.cash !== false) {
        const [lo, hi] = CASH_RANGE[u.grade] ?? CASH_RANGE[1]!
        cash += rng.int(lo, hi)
      }
    }
    const changes: Change[] = []
    const lines: string[] = []
    for (const [id, total] of items) {
      // 物品每一種一次最多 100 個（ADR 0007）
      const qty = Math.min(total, ITEM_MAX_PER_KIND)
      changes.push({ op: 'item', id, qty })
      lines.push(`拿到 ${nameOf(k.content, id)}${qty > 1 ? ` ×${qty}` : ''}`)
    }
    // 現金晶片是現金，不是帳戶
    if (cash > 0) {
      changes.push({ op: 'cash', delta: cash })
      lines.push(`拿到現金晶片 ${formatAmount(cash)}`)
    }
    return { changes, lines }
  })
}
