// 這個功能註冊的通用效果（dev/adr/0015 第一節：features/abilities 註冊 buff；這一張加 branch 與 cover_temp。buff 在 mods.ts、ward 在 ward.ts）。
//
// branch：{ op: 'branch', needs?, when?, self?, do, else? }——看這一筆落在的人（needs，條件同技能的 meat.needs）與做的人（when，條件同 meat.when），
//   self：true 要落在做的人自己身上、false 要落在別人身上（對自己用的計時要多算一個自己的回合：到「他下一回合結束」的效果，給自己時目前這個回合的結束也會數一次）。
//   成立做 do，不成立做 else（沒寫就什麼都不做）。效果自己的 if 看上一筆的結果（hit、ok……）；branch 補的是「看對象是誰」：
//   勸降對重傷的雜兵成功是投降、對精英成功是暈眩：[{ op: 'check', … }, { op: 'branch', if: 'ok', needs: { rank: ['minion'], wounded: true }, do: [{ op: 'out', how: 'surrendered' }], else: [{ op: 'status', status: 'dazed' }] }]。
//   裡面的效果落在同一個對象身上，共用同一個 last。
// cover_temp：{ op: 'cover_temp', levels, until? }——這個人那一格的遮蔽升幾級（最高到掩體），到期（預設自己的下一回合開始）時把升上去的那幾級拿回來（跑位射擊）。

import type { BattleRun, BattleTarget, BattleUnit, Kernel } from '../../core'
import { coverAt } from '../../core'
import { needsBlocks, whenBlocks } from './conditions'
import { needsProblems, whenProblems, WHEN_MEAT } from './format'
import { OWNER } from './types'
import { dataOf, isRec } from './unitdata'

const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v)

interface TempCover {
  by: string
  side: 'ally' | 'foe'
  slot: number
  /** 實際升了幾級（已經是掩體就沒有升） */
  levels: number
  until: 'own_turn_start' | 'own_turn_end'
}
const TEMP_UNTIL = ['own_turn_start', 'own_turn_end'] as const

const tempsOf = (u: BattleUnit): TempCover[] => {
  const d = u.ext.abilities
  return isRec(d) && Array.isArray(d.coverTemps) ? (d.coverTemps as TempCover[]) : []
}

/** 到期的臨時遮蔽：升上去的拿回來（那一格現在的遮蔽不夠就拿到沒有為止）。 */
function expireTemps(run: BattleRun, unit: BattleUnit, at: TempCover['until']): void {
  const list = tempsOf(unit)
  if (!list.some((t) => t.until === at)) return
  dataOf(unit).coverTemps = list.filter((t) => t.until !== at)
  for (const t of list.filter((x) => x.until === at)) {
    const now = coverAt(run.battle, t.side, t.slot).level
    const down = Math.min(t.levels, now)
    if (down > 0) run.lowerCover(t.side, t.slot, down)
  }
}

export function registerOps(k: Kernel): void {
  k.battle.effect('branch', OWNER, (ctx, e) => {
    const needs = isRec(e.needs) ? e.needs : undefined
    const when = isRec(e.when) ? e.when : undefined
    const okNeeds = !needs || (!!ctx.unit && needsBlocks(ctx.run, ctx.unit, needs).length === 0)
    const okWhen = !when || whenBlocks(ctx.run, ctx.user, when).length === 0
    const okSelf = typeof e.self !== 'boolean' || (ctx.unit?.id === ctx.user.id) === e.self
    const list = okNeeds && okWhen && okSelf ? e.do : e.else
    if (!Array.isArray(list) || !list.length) return
    const target: BattleTarget | null = ctx.unit ? { unit: ctx.unit.id } : ctx.overlay ? { overlay: ctx.overlay.id } : ctx.target
    ctx.run.effects(list as Array<Record<string, unknown>>, {
      user: ctx.user, target, source: ctx.source, pick: ctx.pick, n: ctx.n, last: ctx.last,
      ...(ctx.attacker ? { attacker: ctx.attacker } : {}), ...(ctx.victim ? { victim: ctx.victim } : {}),
    })
  }, {
    problems: (e) => {
      const p = Object.keys(e).filter((key) => !['op', 'who', 'if', 'needs', 'when', 'self', 'do', 'else'].includes(key)).map((key) => `${key}：不認得的欄位（可以寫：needs、when、self、do、else）`)
      if (e.needs !== undefined) p.push(...needsProblems('needs', e.needs))
      if (e.when !== undefined) p.push(...whenProblems('when', e.when, WHEN_MEAT))
      if (e.self !== undefined && typeof e.self !== 'boolean') p.push('self：要是 true 或 false')
      if (e.needs === undefined && e.when === undefined && e.self === undefined) p.push('needs、when、self：至少要寫一個（不然這一筆永遠做 do）')
      if (!Array.isArray(e.do) || e.do.length === 0) p.push('do：要是效果的陣列（條件成立時做）')
      else p.push(...k.battle.effectProblems(e.do).map((m) => `do：${m}`))
      if (e.else !== undefined) p.push(...(Array.isArray(e.else) && e.else.length ? k.battle.effectProblems(e.else).map((m) => `else：${m}`) : ['else：要是效果的陣列']))
      return p
    },
  })

  k.battle.effect('cover_temp', OWNER, (ctx, e) => {
    const unit = ctx.unit
    if (!unit || ctx.run.isStandIn(unit) || unit.slot < 1) return
    const until = (typeof e.until === 'string' ? e.until : 'own_turn_start') as TempCover['until']
    const levels = Math.max(1, Math.round(isNum(e.levels) ? e.levels : 1))
    const before = coverAt(ctx.run.battle, unit.side, unit.slot).level
    ctx.run.raiseCover(unit.side, unit.slot, levels)
    const raised = coverAt(ctx.run.battle, unit.side, unit.slot).level - before
    if (raised > 0) dataOf(ctx.user).coverTemps = [...tempsOf(ctx.user), { by: ctx.user.id, side: unit.side, slot: unit.slot, levels: raised, until }]
  }, {
    problems: (e) => {
      const p = Object.keys(e).filter((key) => !['op', 'who', 'if', 'levels', 'until'].includes(key)).map((key) => `${key}：不認得的欄位（可以寫：levels、until）`)
      if (e.levels !== undefined && !(Number.isInteger(e.levels) && (e.levels as number) >= 1)) p.push('levels：要是 1 以上的整數')
      if (e.until !== undefined && !(TEMP_UNTIL as readonly unknown[]).includes(e.until)) p.push(`until：「${String(e.until)}」不在清單裡（可以寫：${TEMP_UNTIL.join('、')}）`)
      return p
    },
  })

  k.battle.on('turn.start', OWNER, ({ run, unit }) => expireTemps(run, unit, 'own_turn_start'))
  k.battle.on('turn.end', OWNER, ({ run, unit }) => expireTemps(run, unit, 'own_turn_end'))
}
