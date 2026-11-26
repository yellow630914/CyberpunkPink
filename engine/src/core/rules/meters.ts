// L4 規則核心：量表接上效果與條件（dev/adr/0016 第三節；工單 M2-core-meters）。
// 功能 `k.meters.define(def)` 定義一種量表時，這裡替它註冊同名的：
//
//   效果 { kind: <量表>, key?, amount }       和現有的 cash、cred 一樣用 amount
//   條件 { kind: <量表>, key?, min?, max? }
//
// key 省略時照 keyed：district 是現在這一區、map 是現在這張地圖的實例、none 是 _；faction、npc 一定要寫，沒寫是格式錯誤。
// 名字和現有的效果或條件撞到就丟錯（那一種量表整筆不成立）。
//
// 效果的上限與修正（EVENTS 2.4 節；dev/adr/0007）。一筆效果進來的順序是：
//   1. adjust（量表自己的修正，例：區的倍率）：先加倍再夾；所以上限比的是「修正之後」的量，AI 再怎麼被放大也不會超過 cap
//   2. 一件事合計的上限（只管 AI 的，ctx.level === 'cap'，而且量表有寫 cap）：同一種、同一個鍵的所有筆數加起來才比 cap.up、cap.down，
//      超過的從最後幾筆往回扣，被扣時給白話的提醒（用量表的 name，不出現欄位名）。內建的照寫；玩家明說要的（floor）只擋格式
//   3. 範圍：夾在 min～max（有 floor 時不低於那張量表同一個鍵的值）。這一步不提醒：數字本來就到頭了，是遊戲的常態，
//      但 effects 與結果的那一行寫的是實際動的量，已經到頭的那一筆整筆拿掉
// 往上加的規則性上限 ceilOf 在範圍夾值之前，照前面幾筆套完的狀態算（所以拆成幾筆也一樣）；效果寫 final: true（結算算好的量，只有內建的來源能寫）與玩家明說要而且設定關著的不受它管。
// 效果裡 adjusted: true 的意思是「amount 已經是修正過的量」：被合計的上限扣過的、以及 resolve 輸出的效果都是；再丟進 resolve 不會再修正一次。

import type { Change, GameState } from '../types'
import type { ContentRegistry } from '../content/registry'
import type { MeterDef, MeterRegistry } from '../state/meters'
import { clampMeter, defaultMeterKey, meterKeyLabel, meterKeyProblems, meterKeyRequired, meterValue, roundMeterAmount } from '../state/meters'
import { isSafeInt } from '../util/sanitize'

const own = (o: object | undefined, key: string): boolean => !!o && Object.hasOwn(o, key)
import type { Condition, ConditionDef, ConditionRegistry } from './conditions'
import type { Effect, EffectDef, EffectRegistry } from './effects'
import { effectLevel } from './effects'

export type MeterEffect = Effect & { key?: string; amount: number; adjusted?: boolean; final?: boolean }

/** 條件組合用的三個名字，不能拿來當量表的名字（ConditionRegistry 先處理它們，量表的條件永遠走不到）。 */
const COMBINATORS = ['all', 'any', 'not'] as const

const inRange = (v: number, c: { min?: number; max?: number }) => (c.min === undefined || v >= c.min) && (c.max === undefined || v <= c.max)

const sign = (n: number) => (n > 0 ? '+' : '−')

/** 格式裡「key」這一欄的問題：寫了就要合格；沒寫的，faction 與 npc 是錯，其餘照 keyed 在套用時定。 */
function keyFormat(def: MeterDef, raw: Record<string, unknown>): string[] {
  if (raw.key === undefined) return meterKeyRequired(def) ? [`key 要寫明（「${def.name}」是照${def.keyed === 'faction' ? '勢力' : '人'}分開記的）`] : []
  return typeof raw.key === 'string' && raw.key && raw.key !== '__proto__' ? [] : ['key 要是非空的字串']
}

/** 這一筆實際要改的量：照量表的 adjust 修正（已經修正過的不再修正）。key 找不到（不在任何一區、不在地圖上）時沒辦法修正，原樣。 */
function adjustedAmount(def: MeterDef, e: MeterEffect, state: GameState, key: string | undefined): number {
  if (e.adjusted || !def.adjust || key === undefined) return e.amount
  return roundMeterAmount(def, def.adjust(state, key, e.amount))
}

/**
 * 一種量表預設的同名效果（registerMeterRules 註冊的就是它）。量表寫了 ownEffect 的，定義它的功能用這個拿到預設的那一份、包一層再自己註冊
 * （例：敵對值的下限多收 days）。
 */
export function meterEffectDef(def: MeterDef, meters: MeterRegistry): EffectDef<MeterEffect> {
  const noteFor = (amount: number, to: number): string => {
    const limit = amount > 0 ? def.cap!.up : def.cap!.down
    if (amount > 0) return to === 0 ? `一次最多讓${def.name}上升 ${limit} 點，這一筆沒有再算。` : `一次最多讓${def.name}上升 ${limit} 點，實際上升了 ${to} 點。`
    return to === 0 ? `一次最多讓${def.name}下降 ${limit} 點，這一筆沒有再算。` : `一次最多讓${def.name}下降 ${limit} 點，實際下降了 ${-to} 點。`
  }
  return {
    kind: def.kind, owner: def.owner,
    validate: (raw, ctx) => {
      const p: string[] = []
      if (!isSafeInt(raw.amount)) p.push('amount 要是整數（不能是小數、無限、非數，也不能大到失真）')
      // adjusted 是「量已經是修正過的」的內部記號：只有內建的結算能寫（AI 與玩家要的寫了就不收，不然 adjust 的規則可以繞過去）
      for (const mark of ['adjusted', 'final'] as const) {
        if (raw[mark] !== undefined && (typeof raw[mark] !== 'boolean' || effectLevel(raw as Effect, ctx) !== 'builtin')) p.push(`${mark} 是引擎內部用的記號，不能寫`)
      }
      p.push(...keyFormat(def, raw))
      // 寫明的鍵要查得到（勢力、人、區在內容裡；人另外收存檔裡的角色）
      if (raw.key !== undefined && !p.length) p.push(...meterKeyProblems(def, raw.key, ctx.state, ctx.content))
      return p
    },
    // 一件事合計的上限：只管 AI 的（level 是 cap），而且量表有寫 cap。量是修正（adjust）之後的；分組是「種類加鍵」
    budget: (e, ctx) => {
      if (ctx.level !== 'cap' || !def.cap) return null
      const key = e.key ?? defaultMeterKey(def, ctx.state)
      // 這個鍵現在不收的整筆拿掉（clamp 會寫提醒），不佔合計的量
      if (key !== undefined && ctx.level === 'cap' && def.accepts?.(ctx.state, key)) return null
      const amount = adjustedAmount(def, e, ctx.state, key)
      if (amount === 0) return null
      return {
        group: `${def.kind}:${key ?? ''}`, amount, min: -def.cap.down, max: def.cap.up,
        resize: (to) => ({ ...e, amount: to, adjusted: true }),
        notice: (to) => noteFor(amount, to),
      }
    },
    // 把這一筆定成實際要動的量：解出鍵、修正、夾在現在的範圍裡（ctx.state 已經包含這一批前面幾筆的結果）。已經到頭的整筆拿掉
    clamp: (e, ctx) => {
      const key = e.key ?? defaultMeterKey(def, ctx.state)
      if (key === undefined) {
        const where = def.keyed === 'map' ? '你現在不在任何一張地圖上' : '你現在不在任何一區'
        return { effect: null, note: { from: e.amount, to: 0, notice: `這一筆要算在你現在所在的${def.keyed === 'map' ? '地圖' : '區'}，但${where}，所以沒有記下來。` } }
      }
      // 來源不是內建的（AI、玩家要的）：這個鍵現在不收就整筆拿掉並提醒（例：警戒只在委託副本裡有、忠誠只有名冊上的人有）
      const refuse = ctx.level !== 'builtin' ? def.accepts?.(ctx.state, key) : null
      if (refuse) return { effect: null, note: { from: e.amount, to: 0, notice: `「${def.name}」這一筆沒有算：${refuse}` } }
      const amount = adjustedAmount(def, e, ctx.state, key)
      const now = meterValue(def, ctx.state, key)
      let target = clampMeter(meters, ctx.state, def, key, now + amount)
      // 規則性的往上加的上限（例：事件不能讓信譽升階）：照前面幾筆套完的狀態算；結算算好的（final）與玩家明說要而且設定關著的（floor）不受它管
      if (amount > 0 && def.ceilOf && !e.final && ctx.level !== 'floor') target = Math.min(target, Math.max(now, def.ceilOf(ctx.state, key)))
      const actual = target - now
      return { effect: actual === 0 ? null : { ...e, key, amount: actual, adjusted: true } }
    },
    toChanges: (e, ctx): Change[] => [{ op: 'meter', kind: def.kind, key: e.key ?? defaultMeterKey(def, ctx.state) ?? '', delta: e.amount }],
    describe: (e, ctx) => {
      const key = e.key ?? defaultMeterKey(def, ctx.state)
      const label = key === undefined ? '' : meterKeyLabel(def, key, ctx.state, ctx.content)
      return `${label ? `${def.name}（${label}）` : def.name}：${sign(e.amount)}${Math.abs(e.amount)}`
    },
  }
}

/** key 寫 'any' 的意思（M4-followups-2 第 11 項；本來只有夜課的學習條件展開）：這張量表的每一個鍵各試一次，有一個成立就算（豔名在任一區 20 以上）。 */
export const ANY_KEY = 'any'

/**
 * 條件 key: 'any' 要試的鍵：區、勢力的量表是內容裡每一筆（加上存檔裡寫過的鍵）；人的量表是存檔裡每一個主角以外的角色與內容裡每一個人；
 * 地圖的量表是現在每一份地圖實例；不分對象的量表只有 `_`。沒有任何鍵（內容沒載入那一類）就是空的：任一個都不成立。
 */
export function anyKeysOf(def: Pick<MeterDef, 'kind' | 'keyed'>, state: GameState, content: ContentRegistry): string[] {
  const written = Object.keys(own(state.meters, def.kind) ? state.meters[def.kind]! : {})
  const listed = (kind: string): string[] => (content.hasKind(kind) ? content.list(kind).map((e) => e.id) : [])
  switch (def.keyed) {
    case 'none': return ['_']
    case 'district': return [...new Set([...listed('district'), ...written])]
    case 'faction': return [...new Set([...listed('faction'), ...written])]
    case 'npc': return [...new Set([...listed('npc'), ...Object.keys(state.actors).filter((id) => id !== state.pc), ...written])]
    case 'map': return Object.keys(state.maps?.instances ?? {})
    default: return written
  }
}

/** 量表的對象的名字：勢力、角色、地區這類內容查得到就寫名字，查不到寫 id。 */
function nameOfKey(def: MeterDef, content: ContentRegistry, key: string): string {
  const kind = def.keyed === 'faction' ? 'faction' : def.keyed === 'npc' ? 'npc' : def.keyed === 'district' ? 'district' : undefined
  const e = kind && content.hasKind(kind) ? (content.get(kind, key) as { name?: unknown; short?: unknown } | undefined) : undefined
  return typeof e?.short === 'string' && e.short ? e.short : typeof e?.name === 'string' && e.name ? e.name : key
}

function conditionDef(def: MeterDef, content: ContentRegistry): ConditionDef<Condition & { key?: string; min?: number; max?: number }> {
  return {
    kind: def.kind, owner: def.owner,
    validate: (raw) => [
      ...keyFormat(def, raw),
      ...(raw.key === undefined || raw.key === ANY_KEY || def.keyed !== 'none' || raw.key === '_' ? [] : ['這張量表不分對象，key 只能是 _']),
      ...(['min', 'max'] as const).every((k) => raw[k] === undefined || (typeof raw[k] === 'number' && !Number.isNaN(raw[k]))) ? [] : ['min、max 要是數字'],
    ],
    test: (c, { state }) => {
      if (c.key === ANY_KEY) return anyKeysOf(def, state, content).some((key) => inRange(meterValue(def, state, key), c))
      const at = c.key ?? defaultMeterKey(def, state)
      if (at === undefined && meterKeyRequired(def)) throw new Error(`條件 ${def.kind}（${def.name}）要寫明 key`)
      return inRange(at === undefined ? def.start : meterValue(def, state, at), c)
    },
    // 說明句：「<對象的名字>的<量表的名字>要在 20 以上」（對象是 key 指的勢力、角色等，查得到名字就寫名字）
    describe: (c) => {
      const key = c.key === undefined || c.key === ANY_KEY || c.key === '_' ? undefined : c.key
      const range = c.min !== undefined && c.max !== undefined ? `要在 ${c.min} 到 ${c.max} 之間` : c.min !== undefined ? `要在 ${c.min} 以上` : c.max !== undefined ? `要在 ${c.max} 以下` : '要符合條件'
      const who = key === undefined ? '' : `${nameOfKey(def, content, key)}的`
      return `${who}${def.name}${range}`
    },
  }
}

/**
 * 量表的定義進來時（MeterRegistry.onDefine 呼叫）：註冊同名的效果與條件。先確認兩邊都沒有撞名才註冊，所以丟錯時什麼都沒留下。
 */
export function registerMeterRules(def: MeterDef, meters: MeterRegistry, effects: EffectRegistry, conditions: ConditionRegistry, content: ContentRegistry): void {
  if ((COMBINATORS as readonly string[]).includes(def.kind)) throw new Error(`量表種類 ${def.kind} 是條件的組合用字（all、any、not），不能當量表的名字`)
  if (effects.has(def.kind) && !def.ownEffect) throw new Error(`量表種類 ${def.kind} 和已經註冊的效果撞名，量表（${def.owner}）沒有定義成功`)
  if (conditions.kinds().includes(def.kind)) throw new Error(`量表種類 ${def.kind} 和已經註冊的條件撞名，量表（${def.owner}）沒有定義成功`)
  if (def.ownEffect) {
    if (!effects.has(def.kind)) throw new Error(`量表種類 ${def.kind}（${def.owner}）寫了 ownEffect，要先註冊同名的效果`)
  } else effects.register(meterEffectDef(def, meters))
  conditions.register(conditionDef(def, content))
}
