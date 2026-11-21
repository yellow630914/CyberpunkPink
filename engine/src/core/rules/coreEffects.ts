// L4 規則核心：核心自己註冊的效果（EVENTS 2.4 節裡只用到核心狀態的那幾種）。
// cred、cash、time、flag、item。其餘（三條軌、沉溺、敵對值、好感、人情、豔名……）由擁有那塊狀態的功能註冊。

import type { Change, Grade } from '../types'
import { countItem } from '../state/inventory'
import { formatAmount } from '../util/money'
import { isId } from '../util/sanitize'
import type { Effect, EffectCtx, EffectDef, EffectRegistry } from './effects'

/**
 * 錢的上限（每件），照等級：EVENTS 2.4 節「I 級 120、II 級 360、III 級 1,200、IV 級 3,900、V 級 12,000」。
 * 資料檔 data/rules/effect_caps.json 載入後（內容種類 effect_cap，id 是 money）以資料為準。
 */
export const MONEY_CAP_BY_GRADE: Record<Grade, number> = { 1: 120, 2: 360, 3: 1200, 4: 3900, 5: 12000 }

export function moneyCap(ctx: Pick<EffectCtx, 'content' | 'grade'>): number {
  const data = ctx.content.get('effect_cap', 'money')?.by_grade as Record<string, number> | undefined
  return data?.[String(ctx.grade)] ?? MONEY_CAP_BY_GRADE[ctx.grade]
}

const isInt = (v: unknown): v is number => typeof v === 'number' && Number.isInteger(v)

type MoneyEffect = Effect & { amount: number }
const moneyEffect = (kind: 'cred' | 'cash', name: string): EffectDef<MoneyEffect> => ({
  kind, owner: 'core',
  validate: (raw) => (isInt(raw.amount) ? [] : ['amount 要是整數']),
  clamp: (e, ctx) => {
    const cap = moneyCap(ctx)
    if (Math.abs(e.amount) <= cap) return { effect: e }
    const to = Math.sign(e.amount) * cap
    return {
      effect: { ...e, amount: to },
      note: { from: e.amount, to, limit: cap, notice: e.amount > 0 ? `你要的比這一區給得起的多，實際拿到 ${formatAmount(to)} 元。` : `這一區一次拿不走這麼多，實際少了 ${formatAmount(-to)} 元。` },
    }
  },
  // 扣的錢不會超過手上有的（付不出來的部分由發起的功能另外處理，例如變成債）
  toChanges: (e, ctx) => {
    const delta = e.amount < 0 ? -Math.min(-e.amount, ctx.state.money[kind]) : e.amount
    return delta === 0 ? [] : [{ op: kind, delta }]
  },
  describe: (e) => `${e.amount >= 0 ? '拿到' : '失去'}：${name} ${formatAmount(Math.abs(e.amount))}`,
})

export function registerCoreEffects(reg: EffectRegistry): void {
  reg.register(moneyEffect('cred', '帳戶'))
  reg.register(moneyEffect('cash', '現金'))

  reg.register<Effect & { hours: number }>({
    kind: 'time', owner: 'core',
    validate: (raw) => (typeof raw.hours === 'number' && Number.isFinite(raw.hours) && raw.hours >= 0 ? [] : ['hours 要是 0 以上的數字']),
    toChanges: (e): Change[] => (e.hours > 0 ? [{ op: 'time', minutes: Math.round(e.hours * 60) }] : []),
    describe: (e) => `時間：過了 ${e.hours} 小時`,
  })

  reg.register<Effect & { key: string; value: boolean | number | string | null }>({
    kind: 'flag', owner: 'core',
    validate: (raw, ctx) => {
      const p: string[] = []
      if (typeof raw.key !== 'string' || !raw.key) p.push('key 要是字串')
      // AI 與玩家要來的旗標只能寫在 ai: 底下，碰不到內建劇情的旗標（EVENTS 2.2 節）
      else if (ctx.source !== 'builtin' && !raw.key.startsWith('ai:')) p.push('AI 寫的旗標要以 ai: 開頭')
      if (!(raw.value === null || ['boolean', 'number', 'string'].includes(typeof raw.value))) p.push('value 只能是布林、數字、字串或 null')
      return p
    },
    toChanges: (e): Change[] => [{ op: 'flag', key: e.key, value: e.value }],
    describe: (e) => `記下：${e.key}`,
  })

  reg.register<Effect & { id: string; qty: number }>({
    kind: 'item', owner: 'core',
    validate: (raw, ctx) => {
      if (!isId(raw.id)) return ['id 的格式不對']
      if (!isInt(raw.qty) || raw.qty === 0) return ['qty 要是不為 0 的整數']
      if (!ctx.content.hasKind('item')) return ['物品的目錄還沒有載入，不能給物品']
      if (!ctx.content.has('item', raw.id)) return [`引用了不存在的物品：${raw.id}`]
      if (raw.qty < 0 && countItem(ctx.state.inventory, raw.id) < -raw.qty) return [`背包裡的 ${raw.id} 不夠 ${-raw.qty} 個`]
      return []
    },
    // 等級不超過主角所在那一區的等級；超過的整筆拿掉
    clamp: (e, ctx) => {
      const def = ctx.content.get('item', e.id)
      const grade = typeof def?.grade === 'number' ? def.grade : 1
      if (e.qty < 0 || grade <= ctx.grade) return { effect: e }
      return { effect: null, note: { from: e, to: null, limit: ctx.grade, notice: `這一區拿不到${String(def?.name ?? e.id)}這麼好的東西，所以這一樣沒有拿到。` } }
    },
    toChanges: (e): Change[] => [{ op: 'item', id: e.id, qty: e.qty }],
    describe: (e, ctx) => `${e.qty > 0 ? '拿到' : '失去'}：${String(ctx.content.get('item', e.id)?.name ?? e.id)}${Math.abs(e.qty) > 1 ? ` ×${Math.abs(e.qty)}` : ''}`,
  })
}
