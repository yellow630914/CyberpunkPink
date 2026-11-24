// L6 功能 dive：這裡能不能潛入（diveOptions）。站在哪一種接入點、要付多少、用什麼甲板、為什麼不行（一條一句）。
// 規格：CYBERSPACE 2.2 節（接入點）、2.3 節（誰能進：有橋的人都能潛入；沒有甲板是訪客，租用的甲板在這裡租）、4.1 節（倒下之後一小時內不能再潛入）。

import type { ContentEntry, GameState, Kernel } from '../../core'
import { formatAmount, isRecord, toMinutes } from '../../core'
import type { DeckSource, DiveDef } from './model'
import { BLOCK_KIND, DECK_KIND, FACILITY_TYPE_KIND, diveDefProblems, isText, readDive } from './model'

type FacilityTypeEntry = ContentEntry & { name?: unknown; functions?: unknown; dive?: unknown }
type BlockLike = ContentEntry & { facilities?: Record<string, { name?: unknown }> }

/** 現在站的這種接入點（設施的種類帶 dive）：費用、租用的甲板、押金、安全程度。 */
export interface DiveHere {
  /** 設施種類的 id 與名字 */
  type: string
  typeName: string
  /** 站的那一間的標記 id 與名字（街區的資料有寫店名就用店名，沒有用種類的名字） */
  marker?: string
  name: string
  fee: number
  deposit: number
  /** 這裡租的甲板（只有 deck_rental 這個效果有人登記時才算數） */
  rental?: { deck: string; name: string }
  safe: number
}

export interface DiveOptions {
  /** 已經潛入了 */
  diving: boolean
  here: DiveHere | null
  /** 現在潛入會用哪一種甲板（自己的、租的、訪客） */
  deck: DeckSource
  fee: number
  /** 真的會收的押金（只有租了才收） */
  deposit: number
  /** 一共付多少現金（費用加押金） */
  cost: number
  /** 為什麼不行：一條一個條件，完整的句子 */
  blocks: string[]
  /** blocks 接起來的一句（能潛入是 null） */
  block: string | null
  ok: boolean
}

/** 主角有沒有橋：actor.ext.bridge 是物件（lewd 寫的共用資料；沒有橋的人是 null 或沒有這一欄）。 */
export const hasBridge = (state: GameState, actor: string): boolean => isRecord(state.actors[actor]?.ext.bridge)

/** 倒下之後還在燒傷中的（actor.conditions 的 net_burn，沒過期）。 */
export function burning(state: GameState, actor: string): boolean {
  const now = toMinutes(state.time)
  return !!state.actors[actor]?.conditions.some((c) => c.id === 'net_burn' && (c.until === undefined || c.until > now))
}

/** 有自己的甲板嗎（衍生數值 deck_grade 大於 0；沒有人定義它就是沒有）。 */
export const ownsDeck = (k: Pick<Kernel, 'stats'>, state: GameState, actor: string): boolean => k.stats.hasStat('deck_grade') && k.stats.stat(state, actor, 'deck_grade') > 0

/** 現在站的設施是不是帶 dive 的那一種：用條件 at_facility 問（城市的功能登記的；沒有人登記就沒有接入點）。 */
export function hereOf(k: Kernel, state: GameState): DiveHere | null {
  if (!k.conditions.kinds().includes('at_facility')) return null
  const ctx = { state, stats: k.stats, timeRules: k.timeRules }
  for (const t of k.content.list<FacilityTypeEntry>(FACILITY_TYPE_KIND)) {
    if (!Array.isArray(t.functions) || !t.functions.includes('dive') || diveDefProblems(t.dive ?? {}).length > 0) continue
    if (!k.conditions.test({ kind: 'at_facility', types: [t.id] }, ctx)) continue
    const def = (isRecord(t.dive) ? t.dive : {}) as DiveDef
    const typeName = isText(t.name) ? t.name : t.id
    const marker = state.location.facility
    const block = state.location.block ? k.content.get<BlockLike>(BLOCK_KIND, state.location.block) : undefined
    const shop = marker && block && isRecord(block.facilities) ? block.facilities[marker] : undefined
    const rentalId = k.effects.has('deck_rental') && def.rental && k.content.has(DECK_KIND, def.rental) ? def.rental : undefined
    const rentalEntry = rentalId ? k.content.get<ContentEntry & { name?: unknown }>(DECK_KIND, rentalId) : undefined
    return {
      type: t.id, typeName, ...(marker ? { marker } : {}), name: isRecord(shop) && isText(shop.name) ? shop.name : typeName,
      fee: def.fee ?? 0, deposit: def.deposit ?? 0, safe: def.safe ?? 0,
      ...(rentalId ? { rental: { deck: rentalId, name: isText(rentalEntry?.name) ? rentalEntry.name : rentalId } } : {}),
    }
  }
  return null
}

/** 這裡能不能潛入、要付多少、為什麼不行。不改狀態。 */
export function diveOptions(k: Kernel, state: GameState): DiveOptions {
  const diving = !!readDive(state)
  const here = hereOf(k, state)
  const pc = state.pc && state.actors[state.pc] ? state.pc : null
  const owns = !!pc && ownsDeck(k, state, pc)
  const deck: DeckSource = owns ? 'own' : here?.rental ? 'rental' : 'none'
  const fee = here?.fee ?? 0
  const deposit = deck === 'rental' ? here!.deposit : 0
  const cost = fee + deposit
  const blocks: string[] = []
  if (diving) blocks.push('你已經潛入了：要換個接入點，先登出。')
  else {
    if (!pc) blocks.push('還沒有主角。')
    if (!here) blocks.push('這裡沒有接入點：要在潛艙店這類有接入艙的設施上才能潛入。')
    if (pc && !hasBridge(state, pc)) blocks.push('你沒有橋：沒有橋的人進不了內海。')
    if (pc && burning(state, pc)) blocks.push('你剛在網內倒下，還在燒傷中：一個小時內不能再潛入。')
    if (pc && here && state.money.cash < cost) {
      blocks.push(`現金不夠：要付 ${formatAmount(cost)}${deposit > 0 ? `（費用 ${formatAmount(fee)}，租用甲板的押金 ${formatAmount(deposit)}）` : ''}，手上只有 ${formatAmount(state.money.cash)}。`)
    }
    const act = k.activity.blockOf(state, 'commit:dive.enter')
    if (act) blocks.push(act)
  }
  return { diving, here, deck, fee, deposit, cost, blocks, block: blocks.length ? blocks.join('') : null, ok: blocks.length === 0 }
}
