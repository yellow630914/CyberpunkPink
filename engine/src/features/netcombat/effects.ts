// L6 功能 netcombat：同步與 RAM 的效果（資料、技能、招牌行動、構裝的 do 用）。
//   net.sync { to }      把落在的人的檔位改成某一檔（粉蕾絲的勸降）：不看上限與每回合一次的限制
//   net.ram { amount }   加減落在的人的 RAM（數字或公式）：加的不超過上限，減的不低於 0
//   net.pin              做效果的人對落在的人釘住一次（照釘住的規則：餘韻疊滿、近身、檢定；不花費；招牌行動用）
//   net.tether           落在的人這一場倒下之後不能斷線（unit.ext.net.tethered）
//   net.trace { amount } 追蹤度加減（數字或公式）；沒有追蹤度的場地（battle.field.trace 不是數字）不做
// 干擾與破損的三個效果（net.jam、net.break、net.fix）在 jam.ts。

import type { BattleEffectCtx, Kernel } from '../../core'
import { SYNC_GEARS, amount, amountProblems, isSyncGear, unitTag } from '../../core'
import { OWNER, ensureNet } from './model'
import { addTrace, pinUnit, traceOf } from './out'
import { gearName, setGear } from './sync'

const only = (e: Record<string, unknown>, keys: string[]): string[] => Object.keys(e).filter((x) => !['op', 'who', 'if', ...keys].includes(x)).map((x) => `${x} 不是這個效果的欄位`)

export function installEffects(k: Kernel): void {
  k.battle.effect('net.sync', OWNER, (ctx: BattleEffectCtx, e) => {
    const t = ctx.unit
    if (!t || ctx.run.isStandIn(t) || !isSyncGear(e.to)) return
    ctx.last.ok = setGear(ctx.run, t, e.to, { by: ctx.user, text: `${unitTag(t)} 被拉到${gearName(ctx.run, e.to)}。` })
  }, {
    problems: (e) => [...only(e, ['to']), ...(!isSyncGear(e.to) ? [`to 要是檔位：${SYNC_GEARS.join('、')}`] : [])],
  })

  k.battle.effect('net.ram', OWNER, (ctx: BattleEffectCtx, e) => {
    const t = ctx.unit
    const pool = t?.pools.ram
    if (!t || !pool || ctx.run.isStandIn(t) || t.out) return
    const delta = Math.round(amount(ctx, e.amount as number | string))
    const next = delta < 0 ? Math.max(0, pool.now + delta) : Math.max(pool.now, Math.min(pool.max, pool.now + delta))
    if (next === pool.now) return
    const diff = next - pool.now
    pool.now = next
    ctx.run.say(`${unitTag(t)} 的 RAM ${diff > 0 ? '+' : '−'}${Math.abs(diff)}。`, 'support', { unit: t.id, ram: diff }, ctx.user)
  }, {
    problems: (e) => [...only(e, ['amount']), ...(e.amount === undefined ? ['要寫 amount'] : amountProblems(e.amount))],
  })

  k.battle.effect('net.pin', OWNER, (ctx: BattleEffectCtx) => {
    const t = ctx.unit
    if (!t) return
    ctx.last.ok = pinUnit(ctx.run, ctx.user, t)
  }, { problems: (e) => only(e, []) })

  k.battle.effect('net.tether', OWNER, (ctx: BattleEffectCtx) => {
    const t = ctx.unit
    if (!t || ctx.run.isStandIn(t)) return
    ensureNet(t).tethered = true
    ctx.run.say(`${unitTag(t)} 被扣住了線：這一場倒下之後，意識會留在網內。`, 'tether', { target: t.id }, ctx.user)
    ctx.last.ok = true
  }, { problems: (e) => only(e, []) })

  k.battle.effect('net.trace', OWNER, (ctx: BattleEffectCtx, e) => {
    if (traceOf(ctx.run.battle) === undefined) return
    const diff = addTrace(ctx.run, Math.round(amount(ctx, e.amount as number | string)), { by: ctx.user })
    ctx.last.ok = diff !== 0
  }, {
    problems: (e) => [...only(e, ['amount']), ...(e.amount === undefined ? ['要寫 amount'] : amountProblems(e.amount))],
  })
}
