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
// 效果裡 adjusted: true 的意思是「amount 已經是修正過的量」：被合計的上限扣過的、以及 resolve 輸出的效果都是；再丟進 resolve 不會再修正一次。

import type { Change, GameState } from '../types'
import type { MeterDef, MeterRegistry } from '../state/meters'
import { clampMeter, defaultMeterKey, meterKeyLabel, meterKeyProblems, meterKeyRequired, meterValue, roundMeterAmount } from '../state/meters'
import { isSafeInt } from '../util/sanitize'
import type { Condition, ConditionDef, ConditionRegistry } from './conditions'
import type { Effect, EffectDef, EffectRegistry } from './effects'

type MeterEffect = Effect & { key?: string; amount: number; adjusted?: boolean }

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

function effectDef(def: MeterDef, meters: MeterRegistry): EffectDef<MeterEffect> {
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
      p.push(...keyFormat(def, raw))
      // 寫明的鍵要查得到（勢力、人、區在內容裡；人另外收存檔裡的角色）
      if (raw.key !== undefined && !p.length) p.push(...meterKeyProblems(def, raw.key, ctx.state, ctx.content))
      return p
    },
    // 一件事合計的上限：只管 AI 的（level 是 cap），而且量表有寫 cap。量是修正（adjust）之後的；分組是「種類加鍵」
    budget: (e, ctx) => {
      if (ctx.level !== 'cap' || !def.cap) return null
      const key = e.key ?? defaultMeterKey(def, ctx.state)
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
      const amount = adjustedAmount(def, e, ctx.state, key)
      const now = meterValue(def, ctx.state, key)
      const actual = clampMeter(meters, ctx.state, def, key, now + amount) - now
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

function conditionDef(def: MeterDef): ConditionDef<Condition & { key?: string; min?: number; max?: number }> {
  return {
    kind: def.kind, owner: def.owner,
    validate: (raw) => [
      ...keyFormat(def, raw),
      ...(raw.key === undefined || def.keyed !== 'none' || raw.key === '_' ? [] : ['這張量表不分對象，key 只能是 _']),
      ...(['min', 'max'] as const).every((k) => raw[k] === undefined || (typeof raw[k] === 'number' && !Number.isNaN(raw[k]))) ? [] : ['min、max 要是數字'],
    ],
    test: (c, { state }) => {
      const at = c.key ?? defaultMeterKey(def, state)
      if (at === undefined && meterKeyRequired(def)) throw new Error(`條件 ${def.kind}（${def.name}）要寫明 key`)
      return inRange(at === undefined ? def.start : meterValue(def, state, at), c)
    },
  }
}

/**
 * 量表的定義進來時（MeterRegistry.onDefine 呼叫）：註冊同名的效果與條件。先確認兩邊都沒有撞名才註冊，所以丟錯時什麼都沒留下。
 */
export function registerMeterRules(def: MeterDef, meters: MeterRegistry, effects: EffectRegistry, conditions: ConditionRegistry): void {
  if ((COMBINATORS as readonly string[]).includes(def.kind)) throw new Error(`量表種類 ${def.kind} 是條件的組合用字（all、any、not），不能當量表的名字`)
  if (effects.has(def.kind)) throw new Error(`量表種類 ${def.kind} 和已經註冊的效果撞名，量表（${def.owner}）沒有定義成功`)
  if (conditions.kinds().includes(def.kind)) throw new Error(`量表種類 ${def.kind} 和已經註冊的條件撞名，量表（${def.owner}）沒有定義成功`)
  effects.register(effectDef(def, meters))
  conditions.register(conditionDef(def))
}
