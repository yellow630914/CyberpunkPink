// L4 規則核心：核心自己註冊的效果（EVENTS 2.4 節裡只用到核心狀態的那幾種）。
// cred、cash、time、flag、item。其餘（三條軌、沉溺、敵對值、好感、人情、豔名……）由擁有那塊狀態的功能註冊。

import type { Change, Grade } from '../types'
import { countItem } from '../state/inventory'
import { formatAmount } from '../util/money'
import { isId, isSafeInt } from '../util/sanitize'
import { formatDuration } from '../util/time'
import type { Effect, EffectCtx, EffectDef, EffectRegistry } from './effects'

/**
 * 錢的上限（一件事合計，帳戶與現金加在一起算），照等級：EVENTS 2.4 節「I 級 120、II 級 360、III 級 1,200、IV 級 3,900、V 級 12,000」，
 * 也就是那一級的委託報酬下限（小型委託，BALANCE 2.8 節）× 0.5。
 * - AI 生成的（與設定開著時玩家要的）：用主角街頭信譽那一階對應的等級（ctx.repGrade），拿到與失去都算。
 * - 內建的事件：用事件所在的區或要地的等級（ctx.grade），只管拿到的；付出去的價錢、罰款與賭注的輸照價格表，不算在內。
 * 資料檔 data/rules/effect_caps.json 載入後（內容種類 effect_cap，id 是 money）以資料為準。
 */
export const MONEY_CAP_BY_GRADE: Record<Grade, number> = { 1: 120, 2: 360, 3: 1200, 4: 3900, 5: 12000 }

export function moneyCap(ctx: Pick<EffectCtx, 'content' | 'grade'>): number {
  const data = ctx.content.get('effect_cap', 'money')?.by_grade as Record<string, number> | undefined
  return data?.[String(ctx.grade)] ?? MONEY_CAP_BY_GRADE[ctx.grade]
}

/** 物品一次最多幾個（EVENTS 2.4 節的格式底線：防呆的天花板，不是平衡用的上限）。只管 AI 交出的結果。 */
export const ITEM_MAX_PER_EVENT = 100

type MoneyEffect = Effect & { amount: number }
/** 付不出來時的提醒：兩種錢各有說法（held 是手上有的） */
const SHORT_NOTICE: Record<'cred' | 'cash', (held: number) => string> = {
  cash: (held) => (held === 0 ? '你身上沒有現金，這一筆沒有扣。' : `你身上的現金只有 ${formatAmount(held)} 元，實際少了 ${formatAmount(held)} 元。`),
  cred: (held) => (held === 0 ? '你的帳戶裡沒有錢，這一筆沒有扣。' : `你的帳戶裡只有 ${formatAmount(held)} 元，實際少了 ${formatAmount(held)} 元。`),
}

const moneyEffect = (kind: 'cred' | 'cash', name: string): EffectDef<MoneyEffect> => ({
  kind, owner: 'core',
  validate: (raw) => (isSafeInt(raw.amount) ? [] : ['amount 要是整數（不能是小數、無限、非數，也不能大到失真）']),
  budget: (e, ctx) => {
    if (ctx.level === 'floor' || (ctx.level === 'builtin' && e.amount <= 0)) return null
    const cap = moneyCap({ content: ctx.content, grade: ctx.level === 'builtin' ? ctx.grade : (ctx.repGrade ?? 1) })
    return {
      group: 'money', amount: e.amount, max: cap, min: ctx.level === 'builtin' ? -Infinity : -cap,
      resize: (amount) => ({ ...e, amount }),
      notice: (to) =>
        e.amount > 0
          ? (to === 0 ? '你要的比這一區給得起的多，這一筆沒有拿到。' : `你要的比這一區給得起的多，實際拿到 ${formatAmount(to)} 元。`)
          : (to === 0 ? '這一區一次拿不走這麼多，這一筆沒有扣。' : `這一區一次拿不走這麼多，實際少了 ${formatAmount(-to)} 元。`),
    }
  },
  // 扣的錢不會超過手上有的：定案的結果寫實際扣的數字（付不出來的部分由發起的功能另外處理，例如變成債）
  clamp: (e, ctx) => {
    if (e.amount === 0) return { effect: null }
    const held = ctx.state.money[kind]
    if (e.amount > 0 || -e.amount <= held) return { effect: e }
    return {
      effect: held === 0 ? null : { ...e, amount: -held },
      note: { from: e.amount, to: -held, limit: held, notice: SHORT_NOTICE[kind](held) },
    }
  },
  toChanges: (e) => [{ op: kind, delta: e.amount }],
  describe: (e) => `${e.amount >= 0 ? '拿到' : '失去'}：${name} ${formatAmount(Math.abs(e.amount))}`,
})

const minutesOf = (e: { hours: number }): number => Math.round(e.hours * 60)

export function registerCoreEffects(reg: EffectRegistry): void {
  reg.register(moneyEffect('cred', '帳戶'))
  reg.register(moneyEffect('cash', '現金'))

  reg.register<Effect & { hours: number }>({
    kind: 'time', owner: 'core',
    validate: (raw) => (typeof raw.hours === 'number' && Number.isFinite(raw.hours) && raw.hours >= 0 && isSafeInt(Math.round(raw.hours * 60)) ? [] : ['hours 要是 0 以上的數字（換算成分鐘之後不能大到失真）']),
    // time 自己沒有上限；但一次行動總共花的時間（判定的時間加上結算裡的 time）合計後受行動種類的時間上限管（EVENTS 2.4 節）
    budget: (e, ctx) => {
      const action = ctx.action
      if (ctx.level !== 'cap' || !action) return null
      return {
        group: 'time', amount: minutesOf(e), min: -Infinity, max: Math.max(0, action.maxMinutes - action.minutes),
        resize: (minutes) => ({ ...e, hours: minutes / 60 }),
        notice: (to) => (to === 0 ? `這件事最多花 ${formatDuration(action.maxMinutes)}，沒有再多花時間。` : `這件事最多花 ${formatDuration(action.maxMinutes)}，所以只再多花了 ${formatDuration(to)}。`),
      }
    },
    clamp: (e) => ({ effect: minutesOf(e) > 0 ? e : null }),
    toChanges: (e): Change[] => [{ op: 'time', minutes: minutesOf(e) }],
    describe: (e) => `時間：過了 ${formatDuration(minutesOf(e))}`,
  })

  reg.register<Effect & { key: string; value: boolean | number | string | null }>({
    kind: 'flag', owner: 'core',
    validate: (raw, ctx) => {
      const p: string[] = []
      if (typeof raw.key !== 'string' || !raw.key) p.push('key 要是字串')
      // AI 與玩家要來的旗標只能寫在 ai: 底下，碰不到內建劇情的旗標（EVENTS 2.2 節）
      else if (ctx.source !== 'builtin' && !raw.key.startsWith('ai:')) p.push('AI 寫的旗標要以 ai: 開頭')
      if (!(raw.value === null || ['boolean', 'number', 'string'].includes(typeof raw.value))) p.push('value 只能是布林、數字、字串或 null')
      else if (typeof raw.value === 'number' && !Number.isFinite(raw.value)) p.push('value 是數字時要是有限的數字')
      return p
    },
    toChanges: (e): Change[] => [{ op: 'flag', key: e.key, value: e.value }],
    describe: (e) => `記下：${e.key}`,
  })

  reg.register<Effect & { id: string; qty: number }>({
    kind: 'item', owner: 'core',
    validate: (raw, ctx) => {
      if (!isId(raw.id)) return ['id 的格式不對']
      if (!isSafeInt(raw.qty) || raw.qty === 0) return ['qty 要是不為 0 的整數（不能大到失真）']
      if (!ctx.content.hasKind('item')) return ['物品的目錄還沒有載入，不能給物品']
      if (!ctx.content.has('item', raw.id)) return [`引用了不存在的物品：${raw.id}`]
      if (raw.qty < 0 && countItem(ctx.state.inventory, raw.id) < -raw.qty) return [`背包裡的 ${raw.id} 不夠 ${-raw.qty} 個`]
      return []
    },
    // 格式的底線：AI 交出的結果，一件事拿到的物品加起來最多 100 個（設定關著也照擋；內建的照寫的算）
    budget: (e, ctx) => {
      if (ctx.level === 'builtin' || e.qty <= 0) return null
      const name = String(ctx.content.get('item', e.id)?.name ?? e.id)
      return {
        group: 'item', amount: e.qty, min: -Infinity, max: ITEM_MAX_PER_EVENT,
        resize: (qty) => ({ ...e, qty }),
        notice: (to) => (to === 0 ? `一次最多拿 ${ITEM_MAX_PER_EVENT} 個東西，${name}沒有拿到。` : `一次最多拿 ${ITEM_MAX_PER_EVENT} 個東西，${name}實際拿到 ${to} 個。`),
      }
    },
    // 等級不超過主角所在那一區的等級；超過的整筆拿掉
    clamp: (e, ctx) => {
      const def = ctx.content.get('item', e.id)
      const grade = typeof def?.grade === 'number' ? def.grade : 1
      if (ctx.level !== 'cap' || e.qty < 0 || grade <= ctx.grade) return { effect: e }
      return { effect: null, note: { from: e, to: null, limit: ctx.grade, notice: `這一區拿不到${String(def?.name ?? e.id)}這麼好的東西，所以這一樣沒有拿到。` } }
    },
    toChanges: (e): Change[] => [{ op: 'item', id: e.id, qty: e.qty }],
    describe: (e, ctx) => `${e.qty > 0 ? '拿到' : '失去'}：${String(ctx.content.get('item', e.id)?.name ?? e.id)}${Math.abs(e.qty) > 1 ? ` ×${Math.abs(e.qty)}` : ''}`,
  })
}
