// 敵人的掉落：`loot` 的格式檢查，與打贏之後在戰鬥結束時的結算（ENEMIES 第 7 節前兩條與「機器」那一條；1.3 節；dev/adr/0011、0007；dev/work/M1b-loot.md）。
// 只在結束時擲（不在戰鬥的每一步裡）；骰子從存檔的狀態導出，用途是 battle/<這一場的 id>/loot，同一個狀態結算兩次一樣。
// 這一張不做：整件撿、拆活人、義體、生體件、授權鎖、殘響、俘虜的處置（M2、M4）；牌子與材質的隨機、憑證、整件撿武器這個格式還表達不出來。

import type { BattleUnit, Change, ContentRegistry, Kernel } from '../../core'
import { ITEM_MAX_PER_KIND, deriveRng, formatAmount } from '../../core'
import type { EnemyEntry } from './kinds'
import { resolveEnemy } from './kinds'

/** 一筆會發東西的掉落。item 是任何一種物品類內容的 id（item、part、blueprint）。 */
export interface LootDrop {
  item: string
  chance: number
  qty?: number | [number, number]
  /** 這個兵種最高級的那一件：首領保證掉 */
  top?: boolean
}
/** 還沒轉成資料的敘述：收下、不發。 */
export interface LootText {
  text: string
}
export type LootEntry = LootDrop | LootText

/** 物品類的內容種類：掉落的 item 要在其中一種裡查得到。 */
export const LOOT_ITEM_KINDS = ['item', 'part', 'blueprint'] as const
/** 一個人最多掉幾件（件數：每一筆擲中的算一件，不管那一筆發幾個）。 */
export const LOOT_CAP = { minion: 1, elite: 2, boss: 3 } as const
/** 現金晶片的範圍，照那個人的等級（ENEMIES 第 7 節；每級約 3.2 倍）。 */
export const CASH_RANGE: Record<number, readonly [number, number]> = {
  1: [40, 120], 2: [130, 380], 3: [400, 1200], 4: [1300, 3900], 5: [4000, 12000],
}
/** 算掉落的退出方式：被打倒、昏過去、被制伏、投降。逃走與被帶走的不算。 */
const COUNTED_OUT: readonly string[] = ['down', 'burnout', 'subdued', 'surrendered']

const isRec = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)
const isInt = (v: unknown): v is number => typeof v === 'number' && Number.isInteger(v)
const isText = (v: unknown): v is string => typeof v === 'string' && v.trim().length > 0
const isDrop = (l: unknown): l is LootDrop => isRec(l) && isText(l.item)

/** loot 與 cash 兩個欄位的格式問題（空的就是合格）。 */
export function lootProblems(e: { loot?: unknown; cash?: unknown }): string[] {
  const p: string[] = []
  if (e.cash !== undefined && typeof e.cash !== 'boolean') p.push('cash 要是 true 或 false')
  if (e.loot === undefined) return p
  if (!Array.isArray(e.loot)) return [...p, 'loot 要是陣列']
  e.loot.forEach((l: unknown, i) => {
    const at = `loot[${i}]`
    if (!isRec(l)) return void p.push(`${at} 要是物件（{ item, chance, qty? } 或 { text }）`)
    if (l.item === undefined) {
      if (!isText(l.text)) p.push(`${at} 要是 { item, chance, qty? } 或 { text }`)
      return
    }
    if (!isText(l.item)) return void p.push(`${at}.item 要是物品的 id`)
    if (!(typeof l.chance === 'number' && Number.isFinite(l.chance) && l.chance >= 0 && l.chance <= 1)) p.push(`${at}.chance 要是 0～1 的數字`)
    if (l.qty !== undefined) {
      const ok = (isInt(l.qty) && l.qty >= 1) || (Array.isArray(l.qty) && l.qty.length === 2 && l.qty.every(isInt) && l.qty[0]! >= 1 && l.qty[0]! <= l.qty[1]!)
      if (!ok) p.push(`${at}.qty 要是 1 以上的整數，或 [最少, 最多]`)
    }
    if (l.top !== undefined && typeof l.top !== 'boolean') p.push(`${at}.top 要是 true 或 false`)
  })
  return p
}

/** 掉落引用的物品：在 item、part、blueprint 其中一種裡找得到就引用那一種；都找不到引用 item（訊息裡有那個 id）。 */
export function lootRefs(content: Pick<ContentRegistry, 'has'>, e: { loot?: unknown }): Array<[string, string]> {
  if (!Array.isArray(e.loot)) return []
  return e.loot.filter(isDrop).map((l): [string, string] => [LOOT_ITEM_KINDS.find((kind) => content.has(kind, l.item)) ?? 'item', l.item])
}

const nameOf = (content: ContentRegistry, id: string): string => {
  for (const kind of LOOT_ITEM_KINDS) {
    const n = content.get(kind, id)?.name
    if (typeof n === 'string' && n) return n
  }
  return id
}

const dropsOf = (e: EnemyEntry): LootDrop[] => (Array.isArray(e.loot) ? e.loot.filter(isDrop) : [])

/** 被帶走的標記由敵人的招牌行動寫（M1b-enemy-moves）；這裡只讀。 */
function isTaken(u: BattleUnit): boolean {
  const ext = u.ext.enemies
  return isRec(ext) && !!ext.taken
}

/** 一個人掉的東西：照 loot 的順序各擲一次，擲中的收進來到位階的上限為止；首領沒掉任何 top 時補上第一件 top。 */
function rollUnit(rng: ReturnType<typeof deriveRng>, e: EnemyEntry, rank: string): Array<{ item: string; qty: number }> {
  const drops = dropsOf(e)
  const cap = LOOT_CAP[rank as keyof typeof LOOT_CAP] ?? 1
  // 先把每一筆的機率與數量都擲完：順序固定，不會因為上限擋掉而讓後面的骰子位移
  const rolled = drops.map((d) => {
    const hit = rng.next() < d.chance
    const qty = Array.isArray(d.qty) ? rng.int(d.qty[0], d.qty[1]) : (d.qty ?? 1)
    return { drop: d, hit, qty }
  })
  let got = rolled.filter((r) => r.hit).slice(0, cap)
  if (rank === 'boss' && !got.some((r) => r.drop.top)) {
    const top = rolled.find((r) => r.drop.top)
    // 補上第一件 top；已經滿了就換掉最後一件，件數不超過首領的上限
    if (top) got = [...(got.length >= cap ? got.slice(0, cap - 1) : got), top]
  }
  return got.map((r) => ({ item: r.drop.item, qty: r.qty }))
}

export function installLoot(k: Pick<Kernel, 'battle' | 'content'>, owner: string): void {
  k.battle.onEnd(owner, ({ state, battle, outcome }) => {
    if (outcome !== 'win') return
    const rng = deriveRng(state.rng, `battle/${battle.id}/loot`)
    const items = new Map<string, number>()
    let cash = 0
    for (const u of Object.values(battle.units) as BattleUnit[]) {
      if (u.side !== 'foe' || !u.enemy || !u.out || !COUNTED_OUT.includes(u.out) || isTaken(u)) continue
      if (!k.content.has('enemy', u.enemy)) continue
      const e = resolveEnemy(k.content, u.enemy)
      for (const d of rollUnit(rng, e, u.rank)) items.set(d.item, (items.get(d.item) ?? 0) + d.qty)
      if (e.cash !== false) {
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
