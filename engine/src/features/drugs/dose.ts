// L6 功能 drugs 的「吃一劑」：核心是 doseResult（純函式：給狀態、誰、吃哪幾種各幾劑，算出 actor.ext.drugs 的新樣子與要套的變更），
// 戰鬥外吃（useDraft）、效果 drug／addiction（給事件）、戰鬥結束時寫回（battle.ts）都走它。dev/work/M4-drugs.md 第 1、3、8 點；ITEMS 4.1 節。
//
// 一劑做的事：成癮加 per_dose（最多 100）、記下最後一次與這一週用過；戒斷中的話戒斷取消、計時重來；同一種藥效還在就只把時間重算（不疊加）；
// 持續「一場戰鬥」的在 prebattle_minutes 內開打才撐得到那一場；instant 的效果當下跑（戰鬥外的效果，EVENTS 2.4 節）。
// 沒有橋（actor.ext.bridge 是 null）的人吃 needs_bridge 的藥：沒有任何效果（也沒有 instant），成癮照加。
// 抑制劑（suppressant: true）：等於付了這一週，suppressant.until 設到下一個週一；它不走成癮。

import type { ActorId, Change, Effect, EffectStepCtx, GameState, Kernel, ReportDraft, TimelineBeat } from '../../core'
import { ActionBlocked, clone, countItem, effectCtx, isSafeInt } from '../../core'
import type { DrugDef, DrugsExt } from './model'
import {
  MAX_ADDICTION, USE_ACTION, drugDef, drugRules, isLive, isUnbridged, nameOfDrug, nextMonday, nowOf, readDrugs, writeDrugs,
} from './model'

export interface DoseSpec {
  id: string
  count: number
}

export interface DoseOpts {
  /** 在戰鬥裡吃的（戰鬥結束時寫回）：持續一場戰鬥的藥直接記成被這一場接住 */
  inBattle?: boolean
  /** 另外把身上還有效的「一場戰鬥」型的藥記成被這一場接住（戰鬥結束時用） */
  flagBattle?: boolean
}

export interface DoseResult {
  /** 有沒有改到任何東西 */
  touched: boolean
  /** 要套的變更：第一筆是 actor.ext.drugs，後面是 instant 的效果 */
  changes: Change[]
  /** 給玩家看的句子（一劑一句，加 instant 的結果） */
  lines: string[]
  /** 每一種藥的成癮值（前後）：給報告的資料 */
  addiction: Record<string, { before: number; after: number }>
  /** 這幾種藥沒有橋沒效果 */
  noEffect: string[]
  ext: DrugsExt
}

/** 一串戰鬥外的效果變成變更與句子（內建的來源）。不認得的、格式不合的略過；整批格式錯誤就是空的。 */
export function resolveEffects(k: Kernel, state: GameState, actor: ActorId, effects: Effect[]): { changes: Change[]; lines: string[] } {
  if (effects.length === 0) return { changes: [], lines: [] }
  const ctx = effectCtx(k, state, { source: 'builtin', actor })
  const valid = effects.filter((e) => typeof e.kind === 'string' && k.effects.has(e.kind) && k.effects.validate([e], ctx).length === 0)
  if (valid.length === 0) return { changes: [], lines: [] }
  const res = k.effects.resolve(valid, ctx)
  return res.errors.length > 0 ? { changes: [], lines: [] } : { changes: res.changes, lines: res.lines }
}

/** 藥效的一筆（持續到什麼時候）：battle 型戰鬥外吃的最多撐 minutes（沒寫是規則表的 prebattle_minutes）。 */
function activeEntry(k: Kernel, def: DrugDef, now: number, flagged: boolean): { id: string; until: number; battle?: true } | null {
  const dur = def.duration
  if (!dur) return null
  if (dur.battle) return { id: def.id, until: now + (dur.minutes ?? drugRules(k).prebattle_minutes), ...(flagged ? { battle: true as const } : {}) }
  return { id: def.id, until: now + (dur.minutes ?? 0) }
}

/**
 * 算吃下 doses 之後 actor 的樣子。state 是吃之前的狀態（唯讀）。不丟錯：不是藥的略過。
 */
export function doseResult(k: Kernel, state: GameState, actor: ActorId, doses: DoseSpec[], o: DoseOpts = {}): DoseResult {
  const d = readDrugs(state, actor)
  const before = JSON.stringify(d)
  const now = nowOf(state)
  const unbridged = isUnbridged(state, actor)
  const lines: string[] = []
  const instants: Effect[] = []
  const addiction: DoseResult['addiction'] = {}
  const noEffect: string[] = []
  let anyDose = false

  for (const spec of doses) {
    const def = drugDef(k, spec.id)
    if (!def) continue
    anyDose = true
    const n = Math.max(1, Math.floor(spec.count))
    const dead = def.needs_bridge && unbridged
    // 抑制劑：等於付了這一週
    if (def.suppressant) {
      const until = nextMonday(k, now)
      d.suppressant = { ...(d.suppressant ?? {}), until: Math.max(d.suppressant?.until ?? 0, until) }
      lines.push(`${def.name}：這一週算有吃了，沉溺的下限壓低到下個週一。`)
    }
    // 成癮與戒斷
    if (def.addiction && def.addiction.per_dose > 0 && !def.suppressant) {
      const row = d.addiction[spec.id] ?? { value: 0, last: now, used_week: false }
      const from = row.value
      row.value = Math.min(MAX_ADDICTION, row.value + def.addiction.per_dose * n)
      row.last = now
      row.used_week = true
      d.addiction[spec.id] = row
      addiction[spec.id] = { before: from, after: row.value }
      if (d.withdrawal[spec.id]) {
        delete d.withdrawal[spec.id]
        lines.push(`${def.name}：再吃了一劑，戒斷壓了下去，計時重來。`)
      }
    }
    // 藥效
    if (dead) {
      noEffect.push(spec.id)
      lines.push(`${def.name}：沒有橋，這一劑沒有任何效果。`)
      continue
    }
    const old = d.active.find((a) => a.id === spec.id)
    d.active = d.active.filter((a) => a.id !== spec.id)
    d.pending = d.pending.filter((p) => !(p.kind === 'after' && p.drug === spec.id))
    const entry = activeEntry(k, def, now, !!def.duration?.battle && (o.inBattle === true || (old !== undefined && isLive(old, now) && old.battle === true)))
    if (entry) d.active.push(entry)
    for (let i = 0; i < n; i++) instants.push(...clone(def.instant))
  }
  if (o.flagBattle) {
    for (const a of d.active) {
      if (!a.battle && a.until > now && drugDef(k, a.id)?.duration?.battle) a.battle = true
    }
  }
  const touched = anyDose || JSON.stringify(d) !== before
  const fx = resolveEffects(k, state, actor, instants)
  return { touched, changes: touched ? [writeDrugs(actor, d), ...fx.changes] : [], lines: [...lines, ...fx.lines], addiction, noEffect, ext: d }
}

// ---- 戰鬥外吃一劑（物品） ----

export interface UseOpts {
  /** 吃的人（主角或隊上的人） */
  actor: ActorId
  /** 物品的 id（帶 drug 欄位） */
  item: string
}

/** 戰鬥外吃一劑現在行不行：全部的原因（一條一句）；行是空陣列。 */
export function useProblems(k: Kernel, state: GameState, o: UseOpts): string[] {
  const a = state.actors[o.actor]
  if (!a) return ['找不到這個角色。']
  const def = drugDef(k, o.item)
  if (!def) return ['這不是藥。']
  const p: string[] = []
  if (state.battle) p.push('戰鬥中不能這樣吃藥，要用戰鬥裡的行動。')
  const act = k.activity.blockOf(state, `commit:${USE_ACTION}`)
  if (act && !p.includes(act)) p.push(act)
  if (!state.party.includes(o.actor)) p.push(`${a.name}不在隊上。`)
  if (countItem(state.inventory, o.item) < 1) p.push(`背包裡沒有${def.name}。`)
  return p
}

/** 第一條原因；行是 null。 */
export const useBlock = (k: Kernel, state: GameState, o: UseOpts): string | null => useProblems(k, state, o)[0] ?? null

/**
 * 戰鬥外吃一劑。不成立丟 ActionBlocked。寫進狀態：物品少一個、actor.ext.drugs（藥效、成癮、戒斷）、instant 的效果。不花時間。報告 drug.use。
 */
export function useDraft(k: Kernel, state: GameState, o: UseOpts): ReportDraft {
  const problems = useProblems(k, state, o)
  if (problems.length > 0) throw new ActionBlocked(problems[0]!)
  const def = drugDef(k, o.item)!
  const who = state.actors[o.actor]!
  const dose = doseResult(k, state, o.actor, [{ id: o.item, count: 1 }])
  const changes: Change[] = [{ op: 'item', id: o.item, qty: -1 }, ...dose.changes]
  const first = dose.noEffect.includes(o.item) ? `${who.name}吃了一劑${def.name}，可是沒有橋，沒有任何效果。` : `${who.name}吃了一劑${def.name}。`
  const lines = [first, ...dose.lines.filter((l) => !(dose.noEffect.includes(o.item) && l.startsWith(`${def.name}：沒有橋`)))]
  const row = dose.addiction[o.item]
  const data: Record<string, unknown> = {
    actor: o.actor, item: o.item,
    ...(row ? { addiction: { ...row } } : {}),
    ...(dose.noEffect.includes(o.item) ? { no_effect: true } : {}),
    until: dose.ext.active.find((a) => a.id === o.item)?.until ?? null,
  }
  const beats: TimelineBeat[] = lines.map((text, i) => ({ layer: 'meat', actor: o.actor, text, tag: i === 0 ? USE_ACTION : 'drug.note', ...(i === 0 ? { data } : {}) }))
  return {
    kind: 'action', action: USE_ACTION, location: clone(state.location), actor: o.actor, party: [], timeline: beats, changes,
    outcome: { result: dose.noEffect.includes(o.item) ? 'no_effect' : 'used', summary: lines.join('') },
    narration: { results: lines },
  }
}

// ---- 效果 drug、addiction（給事件：被下藥、藥的後遺症；只有內建的來源能用） ----

export interface DrugEffect extends Effect {
  kind: 'drug'
  id: string
}
export interface AddictionEffect extends Effect {
  kind: 'addiction'
  id: string
  amount: number
}

export function registerEffects(k: Kernel, owner: string): void {
  k.effects.register<DrugEffect>({
    kind: 'drug', owner, ai: false,
    validate: (raw) => (typeof raw.id === 'string' && drugDef(k, raw.id) ? (Object.keys(raw).every((f) => ['kind', 'id', 'asked'].includes(f)) ? [] : ['只有 id 這個欄位']) : ['id 要是一種藥（帶 drug 欄位的物品）']),
    toChanges: (e, ctx: EffectStepCtx) => doseResult(k, ctx.state, ctx.actor, [{ id: e.id, count: 1 }]).changes,
    describe: (e, ctx) => `${ctx.state.actors[ctx.actor]?.name ?? ctx.actor}服了${nameOfDrug(k, e.id)}`,
  })

  const planOf = (e: AddictionEffect, ctx: EffectStepCtx): { row: { value: number; last: number; used_week: boolean } | null; to: number } => {
    const cur = readDrugs(ctx.state, ctx.actor).addiction[e.id]
    const to = Math.max(0, Math.min(MAX_ADDICTION, (cur?.value ?? 0) + e.amount))
    return { row: cur ?? null, to }
  }
  k.effects.register<AddictionEffect>({
    kind: 'addiction', owner, ai: false,
    validate: (raw) => {
      const p: string[] = []
      if (typeof raw.id !== 'string' || !drugDef(k, raw.id)?.addiction) p.push('id 要是一種會成癮的藥')
      if (!(isSafeInt(raw.amount) && raw.amount !== 0 && Math.abs(raw.amount) <= MAX_ADDICTION)) p.push('amount 要是 -100～100 之間、不是 0 的整數')
      for (const f of Object.keys(raw)) if (!['kind', 'id', 'amount', 'asked'].includes(f)) p.push(`${f}：沒有這個欄位（id、amount）`)
      return p
    },
    clamp: (e, ctx) => {
      const { to, row } = planOf(e, ctx)
      const from = row?.value ?? 0
      if (to === from) return { effect: null, note: { from: e.amount, to: null, limit: 'addiction', notice: e.amount > 0 ? '成癮已經到頂了，這一筆沒有算。' : '身上本來就沒有這種成癮，這一筆沒有算。' } }
      return { effect: { ...e, amount: to - from } }
    },
    toChanges: (e, ctx) => {
      const d = readDrugs(ctx.state, ctx.actor)
      const now = nowOf(ctx.state)
      const cur = d.addiction[e.id]
      const value = Math.max(0, Math.min(MAX_ADDICTION, (cur?.value ?? 0) + e.amount))
      if (value <= 0) {
        delete d.addiction[e.id]
        delete d.withdrawal[e.id]
      } else {
        d.addiction[e.id] = { value, last: e.amount > 0 ? now : (cur?.last ?? now), used_week: e.amount > 0 ? true : (cur?.used_week ?? false) }
      }
      return [writeDrugs(ctx.actor, d)]
    },
    describe: (e, ctx) => `${ctx.state.actors[ctx.actor]?.name ?? ctx.actor}的${nameOfDrug(k, e.id)}成癮 ${e.amount > 0 ? '+' : ''}${e.amount}`,
  })
}

/** 一個人身上這種藥的成癮值（沒有是 0）。 */
export const addictionOf = (state: Pick<GameState, 'actors'>, actor: ActorId, id: string): number => readDrugs(state, actor).addiction[id]?.value ?? 0
