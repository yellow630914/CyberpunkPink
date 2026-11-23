// 這個功能註冊的通用效果（dev/adr/0015 第一節：features/abilities 註冊 buff；這一張加 branch 與 cover_temp。buff 在 mods.ts、ward 在 ward.ts）。
//
// branch：{ op: 'branch', needs?, when?, do, else? }——看這一筆落在的人（needs，條件同技能的 meat.needs）與做的人（when，條件同 meat.when），
//   成立做 do，不成立做 else（沒寫就什麼都不做）。效果自己的 if 看上一筆的結果（hit、ok……）；branch 補的是「看對象是誰」：
//   勸降對重傷的雜兵成功是投降、對精英成功是暈眩：[{ op: 'check', … }, { op: 'branch', if: 'ok', needs: { rank: ['minion'], wounded: true }, do: [{ op: 'out', how: 'surrendered' }], else: [{ op: 'status', status: 'dazed' }] }]。
//   裡面的效果落在同一個對象身上，共用同一個 last。
// pick_random：{ op: 'pick_random', key, from }——開戰前要「指定」的東西一律隨機（使用者 2026-11-23 定案）：在 from 指的那一批在場的人裡隨機挑一個，
//   記進這一串效果的 pick[key]（單位 id）；後面的效果寫 who: 'pick:<key>' 落在他身上。from：ally（隊友，不含自己）、member（我方每一個人含自己）、foe（敵人）、minion（敵方的雜兵）。
//   挑不出人（沒有隊友、沒有雜兵）就把 pick[key] 拿掉，後面落在他身上的效果自己跳過。亂數是 deriveRng(state.rng, 'battle/<戰鬥>/<技能>/<單位>/<key>')：同一個種子同一個結果，不動別的擲骰的順序。
// one_of：{ op: 'one_of', key, options: [{ key, label, do }] }——選項裡隨機挑一種做它的 do（戰前佈置：藏貨、安排人、打點）。選項裡的 pick_random 挑不出人的那一種不算（不會抽到什麼都沒發生的）；
//   都不算就什麼都不做。key 是這一筆自己的名字（亂數的用途；同一個技能裡的 one_of 不能重複）。選項裡的效果共用同一個 pick 與 last。
// cover_temp：{ op: 'cover_temp', levels, until? }——這個人那一格的遮蔽升幾級（最高到掩體），到期（預設自己的下一回合開始）時把升上去的那幾級拿回來（跑位射擊）。

import type { BattleEffectCtx, BattleRun, BattleTarget, BattleUnit, Kernel } from '../../core'
import { coverAt, deriveRng, onField, otherSide, unitTag, unitsOf } from '../../core'
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
  /** true：在自己的回合裡升的、until 是 own_turn_end：這個回合的結束不算（核心 run.skipsOwnTurnEnd 的規則），數到第一次時拿掉記號 */
  skip?: true
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
  const skipped = list.filter((t) => t.until === at && t.skip)
  for (const t of skipped) delete t.skip
  const due = list.filter((t) => t.until === at && !skipped.includes(t))
  dataOf(unit).coverTemps = list.filter((t) => !due.includes(t))
  for (const t of due) {
    const now = coverAt(run.battle, t.side, t.slot).level
    const down = Math.min(t.levels, now)
    if (down > 0) run.lowerCover(t.side, t.slot, down)
  }
}

export const RANDOM_FROM = ['ally', 'member', 'foe', 'minion'] as const
type RandomFrom = (typeof RANDOM_FROM)[number]

/** 隨機挑人的候選：在場的人（倒下與退出的不算）。 */
function candidatesOf(run: BattleRun, user: BattleUnit, from: RandomFrom): BattleUnit[] {
  const b = run.battle
  switch (from) {
    case 'ally': return unitsOf(b, user.side).filter((u) => u.id !== user.id)
    case 'member': return unitsOf(b, user.side)
    case 'foe': return unitsOf(b, otherSide(user.side))
    case 'minion': return unitsOf(b, otherSide(user.side)).filter((u) => u.rank === 'minion')
  }
}

/** 這個技能在這場戰鬥裡、這個人身上、這個用途的亂數。 */
const randomFor = (run: BattleRun, sourceId: string, user: BattleUnit, purpose: string) => deriveRng(run.state.rng, `battle/${run.battle.id}/${sourceId}/${user.id}/${purpose}`)

function pickRandom(ctx: BattleEffectCtx, e: Record<string, unknown>): void {
  const key = String(e.key)
  const list = candidatesOf(ctx.run, ctx.user, e.from as RandomFrom).filter((u) => onField(u))
  if (!list.length) {
    delete ctx.pick[key]
    return
  }
  ctx.pick[key] = randomFor(ctx.run, ctx.source.id, ctx.user, key).pick(list).id
}

interface OneOfOption { key: string; label: string; do: Array<Record<string, unknown>> }

/** 一個選項抽得到嗎：它的 do 裡每一筆 pick_random 都挑得出人。 */
const optionOpen = (run: BattleRun, user: BattleUnit, o: OneOfOption): boolean => o.do.every((e) => e.op !== 'pick_random' || candidatesOf(run, user, e.from as RandomFrom).length > 0)

function oneOf(ctx: BattleEffectCtx, e: Record<string, unknown>): void {
  const options = (e.options as OneOfOption[]).filter((o) => optionOpen(ctx.run, ctx.user, o))
  if (!options.length) return
  const chosen = randomFor(ctx.run, ctx.source.id, ctx.user, String(e.key)).pick(options)
  ctx.run.say(`${unitTag(ctx.user)}：${ctx.source.name}，這一場是「${chosen.label}」。`, 'skill', { unit: ctx.user.id, ability: ctx.source.id, choice: chosen.key })
  ctx.run.effects(chosen.do, {
    user: ctx.user, target: ctx.target, source: ctx.source, pick: ctx.pick, n: ctx.n, last: ctx.last,
    ...(ctx.attacker ? { attacker: ctx.attacker } : {}), ...(ctx.victim ? { victim: ctx.victim } : {}),
  })
}

const isText = (v: unknown): v is string => typeof v === 'string' && v.length > 0

export function registerOps(k: Kernel): void {
  k.battle.effect('pick_random', OWNER, pickRandom, {
    problems: (e) => {
      const p = Object.keys(e).filter((key) => !['op', 'who', 'if', 'key', 'from'].includes(key)).map((key) => `${key}：不認得的欄位（可以寫：key、from）`)
      if (!isText(e.key)) p.push('key：一定要寫（後面的效果用 who: "pick:<key>" 落在他身上）')
      if (!(RANDOM_FROM as readonly unknown[]).includes(e.from)) p.push(`from：「${String(e.from)}」不在清單裡（可以寫：${RANDOM_FROM.join('、')}）`)
      return p
    },
  })

  k.battle.effect('one_of', OWNER, oneOf, {
    problems: (e) => {
      const p = Object.keys(e).filter((key) => !['op', 'who', 'if', 'key', 'options'].includes(key)).map((key) => `${key}：不認得的欄位（可以寫：key、options）`)
      if (!isText(e.key)) p.push('key：一定要寫（這一筆的名字，亂數的用途）')
      if (!Array.isArray(e.options) || e.options.length < 2) return [...p, 'options：要是兩個以上的選項 [{ key, label, do }]']
      const seen = new Set<string>()
      e.options.forEach((o: unknown, i: number) => {
        const at = `options[${i}]`
        if (!isRec(o)) { p.push(`${at}：要是 { key, label, do }`); return }
        for (const key of Object.keys(o)) if (!['key', 'label', 'do'].includes(key)) p.push(`${at}.${key}：不認得的欄位（可以寫：key、label、do）`)
        if (!isText(o.key)) p.push(`${at}.key：一定要寫`)
        else if (seen.has(o.key)) p.push(`${at}.key：「${o.key}」重複了`)
        else seen.add(o.key)
        if (!isText(o.label)) p.push(`${at}.label：一定要寫（給玩家看的名字）`)
        if (!Array.isArray(o.do) || o.do.length === 0) p.push(`${at}.do：要是效果的陣列`)
        else p.push(...k.battle.effectProblems(o.do).map((m) => `${at}.do：${m}`))
      })
      return p
    },
  })

  k.battle.effect('branch', OWNER, (ctx, e) => {
    const needs = isRec(e.needs) ? e.needs : undefined
    const when = isRec(e.when) ? e.when : undefined
    const okNeeds = !needs || (!!ctx.unit && needsBlocks(ctx.run, ctx.unit, needs).length === 0)
    const okWhen = !when || whenBlocks(ctx.run, ctx.user, when).length === 0
    const list = okNeeds && okWhen ? e.do : e.else
    if (!Array.isArray(list) || !list.length) return
    const target: BattleTarget | null = ctx.unit ? { unit: ctx.unit.id } : ctx.overlay ? { overlay: ctx.overlay.id } : ctx.target
    ctx.run.effects(list as Array<Record<string, unknown>>, {
      user: ctx.user, target, source: ctx.source, pick: ctx.pick, n: ctx.n, last: ctx.last,
      ...(ctx.attacker ? { attacker: ctx.attacker } : {}), ...(ctx.victim ? { victim: ctx.victim } : {}),
    })
  }, {
    problems: (e) => {
      const p = Object.keys(e).filter((key) => !['op', 'who', 'if', 'needs', 'when', 'do', 'else'].includes(key)).map((key) => `${key}：不認得的欄位（可以寫：needs、when、do、else）`)
      if (e.needs !== undefined) p.push(...needsProblems('needs', e.needs))
      if (e.when !== undefined) p.push(...whenProblems('when', e.when, WHEN_MEAT))
      if (e.needs === undefined && e.when === undefined) p.push('needs、when：至少要寫一個（不然這一筆永遠做 do）')
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
    if (raised > 0) dataOf(ctx.user).coverTemps = [...tempsOf(ctx.user), { by: ctx.user.id, side: unit.side, slot: unit.slot, levels: raised, until, ...(until === 'own_turn_end' && ctx.run.skipsOwnTurnEnd(ctx.user, ctx.user) ? { skip: true as const } : {}) }]
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
