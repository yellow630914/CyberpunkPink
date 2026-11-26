// L6 功能 channel 的效果、條件與量表（dev/adr/0020 第二節、第十三節；dev/work/M5-channel.md「新的格式與鍵」）。
//   量表  subs（訂閱）、credibility（公信力）、reco（推薦權重）：都不分對象；同名的效果與條件自動有。AI 一件事的上限：公信力 ±5、推薦權重 ±1，
//         訂閱是現值的 2%（最少 20；規則表 ai_subs）。訂閱與推薦權重還沒開頻道時，不是內建的來源動不了（沒有頻道就沒有觀眾）。
//   效果  aired { what: 'live' | 'show' }：這一週開過（直播或節目）。
//         channel_fund { pool, amount, purse? }：撥款（正）或罰款（負，扣到 0 為止）；pool 是 own 或勢力 id，purse 只有自有資金能選現金。勢力的撥款額度跟著加。
//         sponsor { faction, every_weeks, amount, plug_every?, plug_pay?, no_report?, tiers_off? }：帶來一份贊助（同一個勢力已經有的換成新的）。
//         三個都只有內建的事件資料與程式的結算能用（ai: false）：預算不是 AI 說了算的東西。沒有頻道時整筆拿掉並提醒。
//   條件  channel_open、channel_level { min?, max? }、has_sponsor { faction?, plug_due? }。

import type { Condition, ConditionCtx, Effect, EffectStepCtx, Kernel, MeterDef } from '../../core'
import { isRecord, isSafeInt, meterEffectDef, meterOf, rangeText, toMinutes } from '../../core'
import type { Sponsor } from './model'
import { CREDIBILITY, OWN, OWNER, RECO, SUBS, channelRules, isText, levelOf, readChannel } from './model'
import { poolName } from './budget'

const NOT_OPEN_NOTE = '你還沒有頻道，這一筆沒有算。'
const money = (n: number): string => n.toLocaleString('en-US')

const unknownFields = (raw: Record<string, unknown>, allowed: readonly string[]): string[] =>
  Object.keys(raw).filter((f) => f !== 'kind' && f !== 'asked' && !allowed.includes(f)).map((f) => `${f}：沒有這個欄位（可以寫：${allowed.join('、')}）`)

const openOrNot = (state: Parameters<typeof readChannel>[0]): string | null => (readChannel(state).open ? null : '還沒有開頻道。')

/** 三張量表。訂閱的同名效果自己註冊（AI 的上限看現值，量表的 cap 是固定數字）：要在 k.meters.define 之前。 */
export function defineMeters(k: Kernel): void {
  const subs: MeterDef = {
    kind: SUBS, owner: OWNER, name: '訂閱', min: 0, max: Infinity, start: 0, keyed: 'none', cap: { down: 20, up: 20 }, ownEffect: true,
    accepts: (state) => openOrNot(state),
  }
  const base = meterEffectDef(subs, k.meters)
  // AI 一件事合計最多現值的 ai_subs.pct %（最少 ai_subs.min）：用基本的合計分組，只把上下限與提醒換成看現值算的
  k.effects.register({
    ...base,
    owner: OWNER,
    budget(e, ctx) {
      const b = base.budget?.(e, ctx)
      if (!b) return null
      const rules = channelRules(k)
      const cap = Math.max(rules.ai_subs.min, Math.floor((meterOf(k, ctx.state, SUBS) * rules.ai_subs.pct) / 100))
      return {
        ...b, min: -cap, max: cap,
        notice: (to) => (b.amount > 0
          ? (to === 0 ? `一次最多讓訂閱增加 ${money(cap)} 位，這一筆沒有再算。` : `一次最多讓訂閱增加 ${money(cap)} 位，實際增加了 ${money(to)} 位。`)
          : (to === 0 ? `一次最多讓訂閱減少 ${money(cap)} 位，這一筆沒有再算。` : `一次最多讓訂閱減少 ${money(cap)} 位，實際減少了 ${money(-to)} 位。`)),
      }
    },
  })
  k.meters.define(subs)
  k.meters.define({ kind: CREDIBILITY, owner: OWNER, name: '公信力', min: 0, max: 100, start: 50, keyed: 'none', cap: { down: 5, up: 5 } })
  k.meters.define({ kind: RECO, owner: OWNER, name: '推薦權重', min: -3, max: 3, start: 0, keyed: 'none', cap: { down: 1, up: 1 }, accepts: (state) => openOrNot(state) })
}

interface AiredEffect extends Effect { what: 'live' | 'show' }
interface FundEffect extends Effect { pool: string; amount: number; purse?: 'cred' | 'cash' }
interface SponsorEffect extends Effect {
  faction: string; every_weeks: number; amount: number; plug_every?: number; plug_pay?: number; no_report?: { faction?: string; npc?: string }; tiers_off?: string[]
}

const PURSE_NAME = { cred: '帳戶', cash: '現金' } as const

export function installEffects(k: Kernel): void {
  const noChannel = <E extends Effect>(e: E, state: Parameters<typeof readChannel>[0]): { effect: null; note: { from: unknown; to: unknown; notice: string } } | null =>
    (readChannel(state).open ? null : { effect: null, note: { from: e.amount ?? e.what ?? 1, to: 0, notice: NOT_OPEN_NOTE } })

  k.effects.register<AiredEffect>({
    kind: 'aired', owner: OWNER, ai: false,
    validate: (raw) => [...unknownFields(raw, ['what']), ...(raw.what === 'live' || raw.what === 'show' ? [] : ['what 要是 live 或 show'])],
    clamp: (e, ctx) => noChannel(e, ctx.state) ?? { effect: e },
    toChanges: (e) => [{ op: 'channel.week', ...(e.what === 'live' ? { lives: 1 } : { episodes: 1 }) }],
    describe: (e) => (e.what === 'live' ? '這一週開過直播。' : '這一週開過節目。'),
  })

  k.effects.register<FundEffect>({
    kind: 'channel_fund', owner: OWNER, ai: false,
    validate(raw, ctx) {
      const p = unknownFields(raw, ['pool', 'amount', 'purse'])
      if (!isText(raw.pool)) p.push('pool 要是 own 或勢力的 id')
      else if (raw.pool !== OWN && ctx.content.hasKind('faction') && !ctx.content.has('faction', raw.pool)) p.push(`pool 查不到勢力 ${raw.pool}`)
      if (!isSafeInt(raw.amount) || raw.amount === 0) p.push('amount 要是不為 0 的整數（正的撥款、負的罰款）')
      if (raw.purse !== undefined && raw.purse !== 'cred' && raw.purse !== 'cash') p.push('purse 要是 cred 或 cash')
      if (raw.purse === 'cash' && raw.pool !== OWN) p.push('公帳只有帳戶，purse 只有自有資金（own）能選 cash')
      return p
    },
    // 罰款扣到 0 為止：實際扣的量不超過那一格現有的
    clamp(e, ctx) {
      const no = noChannel(e, ctx.state)
      if (no) return no
      if (e.amount > 0) return { effect: e }
      const ch = readChannel(ctx.state)
      const purse = e.purse ?? 'cred'
      const have = e.pool === OWN ? ch.budget.own[purse] : ch.budget.pools[e.pool]?.cred ?? 0
      const take = Math.min(have, -e.amount)
      return take === 0 ? { effect: null } : { effect: take === -e.amount ? e : { ...e, amount: -take } }
    },
    toChanges(e) {
      const purse = e.purse ?? 'cred'
      if (e.pool === OWN) return [{ op: 'channel.budget', pool: OWN, [purse]: e.amount }]
      // 勢力撥款進來，額度加撥款的 quota_pct %（MEDIA 4.2）；罰款不動額度
      const quota = e.amount > 0 ? Math.floor((e.amount * channelRules(k).quota_pct) / 100) : 0
      return [{ op: 'channel.budget', pool: e.pool, cred: e.amount, ...(quota > 0 ? { quota } : {}) }]
    },
    describe: (e) => {
      const where = e.pool === OWN ? `自有的${PURSE_NAME[e.purse ?? 'cred']}` : `${poolName(k, e.pool)}的公帳`
      return e.amount > 0 ? `頻道的預算（${where}）：撥入 ${money(e.amount)}` : `頻道的預算（${where}）：罰款 ${money(-e.amount)}`
    },
  })

  k.effects.register<SponsorEffect>({
    kind: 'sponsor', owner: OWNER, ai: false,
    validate(raw, ctx) {
      const p = unknownFields(raw, ['faction', 'every_weeks', 'amount', 'plug_every', 'plug_pay', 'no_report', 'tiers_off'])
      if (!isText(raw.faction)) p.push('faction 要是勢力的 id')
      else if (ctx.content.hasKind('faction') && !ctx.content.has('faction', raw.faction)) p.push(`faction 查不到勢力 ${raw.faction}`)
      if (!isSafeInt(raw.every_weeks) || raw.every_weeks < 1 || raw.every_weeks > 52) p.push('every_weeks 要是 1～52 的整數')
      if (!isSafeInt(raw.amount) || raw.amount < 1) p.push('amount 要是 1 以上的整數')
      if (raw.plug_every !== undefined && !(isSafeInt(raw.plug_every) && raw.plug_every >= 1)) p.push('plug_every 要是 1 以上的整數')
      if (raw.plug_pay !== undefined && !(isSafeInt(raw.plug_pay) && raw.plug_pay >= 0)) p.push('plug_pay 要是 0 以上的整數')
      if (raw.no_report !== undefined) {
        const nr = raw.no_report
        if (!isRecord(nr) || Object.keys(nr).some((f) => f !== 'faction' && f !== 'npc') || (nr.faction !== undefined && !isText(nr.faction)) || (nr.npc !== undefined && !isText(nr.npc))) p.push('no_report 要是 { faction?, npc? }（各是 id）')
      }
      if (raw.tiers_off !== undefined && !(Array.isArray(raw.tiers_off) && raw.tiers_off.every(isText))) p.push('tiers_off 要是字串的陣列')
      return p
    },
    clamp: (e, ctx) => noChannel(e, ctx.state) ?? { effect: e },
    toChanges(e, ctx: EffectStepCtx) {
      const sponsor: Sponsor = {
        faction: e.faction, every_weeks: e.every_weeks, amount: e.amount,
        ...(e.plug_every !== undefined ? { plug_every: e.plug_every } : {}), ...(e.plug_pay !== undefined ? { plug_pay: e.plug_pay } : {}),
        ...(e.no_report !== undefined ? { no_report: { ...e.no_report } } : {}), ...(e.tiers_off !== undefined ? { tiers_off: [...e.tiers_off] } : {}),
        since: toMinutes(ctx.state.time), weeks_left_to_pay: e.every_weeks, eps_since_plug: 0,
      }
      return [{ op: 'channel.sponsor', sponsor }]
    },
    describe: (e) => `${poolName(k, e.faction)}成了頻道的金主：每 ${e.every_weeks} 週撥款 ${money(e.amount)}。`,
  })
}

interface LevelCond extends Condition { min?: number; max?: number }
interface SponsorCond extends Condition { faction?: string; plug_due?: boolean }

export function installConditions(k: Kernel): void {
  k.conditions.register<Condition>({
    kind: 'channel_open', owner: OWNER,
    validate: (raw) => unknownFields(raw, []),
    test: (_c, ctx: ConditionCtx) => readChannel(ctx.state).open,
    describe: () => '要開著頻道',
  })

  k.conditions.register<LevelCond>({
    kind: 'channel_level', owner: OWNER,
    validate(raw) {
      const p = unknownFields(raw, ['min', 'max'])
      for (const f of ['min', 'max'] as const) if (raw[f] !== undefined && !(isSafeInt(raw[f]) && (raw[f] as number) >= 1)) p.push(`${f} 要是 1 以上的整數`)
      return p
    },
    // 沒有頻道不算任何一級
    test(c, ctx) {
      const ch = readChannel(ctx.state)
      if (!ch.open) return false
      const lv = levelOf(channelRules(k), meterOf(k, ctx.state, SUBS))
      return (c.min === undefined || lv >= c.min) && (c.max === undefined || lv <= c.max)
    },
    describe: (c) => `頻道的等級${rangeText(c)}`,
  })

  k.conditions.register<SponsorCond>({
    kind: 'has_sponsor', owner: OWNER,
    validate(raw) {
      const p = unknownFields(raw, ['faction', 'plug_due'])
      if (raw.faction !== undefined && !isText(raw.faction)) p.push('faction 要是勢力的 id')
      if (raw.plug_due !== undefined && typeof raw.plug_due !== 'boolean') p.push('plug_due 要是 true 或 false')
      return p
    },
    // plug_due：離上次掛業配已經滿 plug_every 集（沒寫 plug_every 的贊助不要求，不算）。沒掛滿的後果是事件的內容，引擎只給條件（V19）
    test: (c, ctx) => readChannel(ctx.state).sponsors.some((s) =>
      (c.faction === undefined || s.faction === c.faction) && (c.plug_due !== true || (s.plug_every !== undefined && s.eps_since_plug >= s.plug_every))),
    describe: (c) => {
      const who = c.faction !== undefined ? `${poolName(k, c.faction)}的` : ''
      return `要有${who}金主${c.plug_due === true ? '，而且該掛它的業配了' : ''}`
    },
  })
}
