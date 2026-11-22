// 被動、姿態、共鳴、預備與 buff 的修正：meat.mods 的每一筆 { kind, value, tags?, who?, when?, per_fight?, per_turn?, to? }。
// 規格：dev/work/M1b-skill-format.md 第三節。誰吃得到：被動的裝著就有；姿態的開著才有；共鳴的照階數；預備的整場有效；buff 的在期限內有效。
// who 是「修正落在誰身上」：self（預設）、adjacent（相鄰的隊友）、allies（我方在場的每個人）、behind（自己後面那一格的人）；
// when 看的是給修正的那個人自己（再加對手的 other_*）。
// buff 這個效果也由這裡註冊：在對象身上掛一段時間的修正，結束時做 on_end；任何來源都能用。

import type { BattleRun, BattleUnit, BattleView, Kernel, ModQuery, RollPart } from '../../core'
import { STATUS_UNTILS, amount, onField, unitTag, unitsOf } from '../../core'
import { whenBlocks } from './conditions'
import { modsProblems } from './format'
import type { AbilityEntry, AnyModKind, FeatureModKind, ModEntry, PathEntry, UnitBuff } from './types'
import { OWNER } from './types'
import { broughtPrep, equippedOf, isRec, setBuffs, tierIn, unitAbilities, unitBuffs } from './unitdata'

/** 一批修正的來源：哪個技能（或共鳴、預備、buff）、誰是給的人、這棵樹幾階。 */
interface Source {
  key: string
  name: string
  holder: BattleUnit
  tier: number
  mods: ModEntry[]
}

function sourcesOf(view: Pick<BattleView, 'k'>, holder: BattleUnit): Source[] {
  const out: Source[] = []
  const d = unitAbilities(holder)
  if (d.equipped.length) {
    for (const ab of equippedOf(view, holder)) {
      const m = ab.meat
      if (!m?.mods || m.pending) continue
      if (ab.kind === 'passive' || (ab.kind === 'stance' && holder.stance === ab.id)) out.push({ key: ab.id, name: ab.name, holder, tier: tierIn(holder, ab.path), mods: m.mods })
    }
    // 共鳴：這棵樹的階數到了 N，tier <= N 的共鳴都生效（要裝著這棵樹的招牌才算）
    for (const p of view.k.content.list<PathEntry>('path')) {
      if (!d.equipped.includes(p.signature)) continue
      const tier = d.tiers[p.id] ?? 1
      p.resonance.forEach((r, i) => {
        if (r.effect?.mods && r.tier <= tier) out.push({ key: `res:${p.id}:${i}`, name: p.tree, holder, tier, mods: r.effect.mods })
      })
    }
  }
  for (const b of unitBuffs(holder)) out.push({ key: `buff:${b.id}`, name: b.name, holder, tier: b.tier, mods: b.mods })
  for (const id of broughtPrep(holder)) {
    const ab = view.k.content.get<AbilityEntry>('ability', id)
    const mods = ab?.prep?.meat?.mods
    if (ab && mods) out.push({ key: `prep:${id}`, name: ab.name, holder, tier: tierIn(holder, ab.path), mods })
  }
  return out
}

const counterKey = (src: Source, i: number, perTurn: boolean): string => `${perTurn ? 'turn:' : ''}mod:${src.key}#${i}`

/** 這一筆修正的數字（公式與 by_tier 照給的人的樹階；crit_margin 的 to 換成和核心預設的差）。 */
function valueOf(view: BattleView, src: Source, e: ModEntry): number {
  if (e.to !== undefined) return e.to - view.n.critMargin
  const v = e.value
  if (typeof v === 'number') return v
  if (typeof v === 'string') return Math.round(amount({ run: view as unknown as BattleRun, user: src.holder, n: { tier: src.tier } }, v))
  if (isRec(v) && Array.isArray(v.by_tier)) return Number(v.by_tier[Math.min(4, Math.max(0, src.tier - 1))] ?? 0)
  return 0
}

interface Applied {
  src: Source
  index: number
  entry: ModEntry
  value: number
}

/** 問 unit 的某一種數字時，現在算數的每一筆修正。 */
function applied(view: BattleView, unit: BattleUnit, kind: AnyModKind, tags: readonly string[], other?: BattleUnit): Applied[] {
  const b = view.battle
  // 替身（和人重疊的東西自己開火）不在單位清單裡，吃不到技能的修正
  if (b.units[unit.id] !== unit) return []
  const out: Applied[] = []
  const holders = new Set<BattleUnit>(unitsOf(b, unit.side))
  holders.add(unit)
  for (const holder of holders) {
    for (const src of sourcesOf(view, holder)) {
      src.mods.forEach((entry, index) => {
        if (entry.kind !== kind) return
        switch (entry.who ?? 'self') {
          case 'self': if (holder !== unit) return; break
          case 'adjacent': if (holder === unit || !onField(holder) || !onField(unit) || Math.abs(holder.slot - unit.slot) !== 1) return; break
          case 'allies': if (!onField(holder)) return; break
          case 'behind': if (!onField(holder) || !onField(unit) || unit.slot !== holder.slot + 1) return; break
        }
        if (entry.tags && !entry.tags.every((t) => tags.includes(t))) return
        if (entry.when && whenBlocks(view, holder, entry.when, other).length) return
        if (entry.per_fight !== undefined && (unit.uses[counterKey(src, index, false)] ?? 0) >= entry.per_fight) return
        if (entry.per_turn !== undefined && (unit.uses[counterKey(src, index, true)] ?? 0) >= entry.per_turn) return
        out.push({ src, index, entry, value: valueOf(view, src, entry) })
      })
    }
  }
  return out
}

/** 這個功能自己認的修正（FEATURE_MOD_KINDS）：問 unit 的這個數字，現在算數的每一筆。數字在這裡才算（damage_roll 的公式會擲骰，所以只在要用的那一刻問一次）。 */
export function featureMods(view: BattleView, unit: BattleUnit, kind: FeatureModKind, tags: readonly string[] = [], other?: BattleUnit): Array<{ label: string; value: number }> {
  return applied(view, unit, kind, tags, other).map((a) => ({ label: a.src.name, value: a.value }))
}

/** featureMods 的合計（不擲骰的修正用；damage_roll 不要用它問，它每問一次擲一次）。 */
export const featureTotal = (view: BattleView, unit: BattleUnit, kind: FeatureModKind, tags: readonly string[] = [], other?: BattleUnit): number => featureMods(view, unit, kind, tags, other).reduce((sum, p) => sum + p.value, 0)

// ---- buff ----

const isText = (v: unknown): v is string => typeof v === 'string' && v.trim().length > 0

/** 一個到期的 buff：記一拍，做 on_end（做的人是給 buff 的人，還在的話；落在 buff 的主人身上）。 */
function endBuff(run: BattleRun, holder: BattleUnit, b: UnitBuff): void {
  run.say(`${unitTag(holder)} 的${b.name}結束了。`, 'status.end', { target: holder.id, buff: b.id })
  if (b.on_end.length) {
    run.effects(b.on_end, { user: run.battle.units[b.by] ?? holder, target: { unit: holder.id }, source: b.source as never, n: { tier: b.tier } })
  }
}

/** 某個人的回合開始或結束：數所有 buff 的回合，到期的拿掉。 */
function tickBuffs(run: BattleRun, at: 'turn_start' | 'turn_end', of: BattleUnit): void {
  for (const holder of Object.values(run.battle.units)) {
    const buffs = unitBuffs(holder)
    if (!buffs.length) continue
    const kept: UnitBuff[] = []
    const ended: UnitBuff[] = []
    for (const b of buffs) {
      if (b.of !== of.id || !b.until.endsWith(`_${at}`)) {
        kept.push(b)
        continue
      }
      b.turns -= 1
      ;(b.turns <= 0 ? ended : kept).push(b)
    }
    if (!ended.length) continue
    setBuffs(holder, kept)
    for (const b of ended) endBuff(run, holder, b)
  }
}

function buffProblems(k: Pick<Kernel, 'battle'>) {
  return (e: Record<string, unknown>): string[] => {
    const p: string[] = []
    for (const key of Object.keys(e)) if (!['op', 'who', 'if', 'id', 'name', 'turns', 'until', 'mods', 'on_end'].includes(key)) p.push(`不認得的欄位 ${key}（可以寫：id、name、turns、until、mods、on_end）`)
    if (!isText(e.id)) p.push('id：一定要寫（buff 的名字，同一個 id 再掛一次是重算時間）')
    if (e.name !== undefined && !isText(e.name)) p.push('name：要是給玩家看的名字')
    if (e.turns !== undefined && !(Number.isInteger(e.turns) && (e.turns as number) >= 1)) p.push('turns：要是 1 以上的整數')
    if (e.until !== undefined && !(STATUS_UNTILS as readonly unknown[]).includes(e.until)) p.push(`until：「${String(e.until)}」不在清單裡（可以寫：${STATUS_UNTILS.join('、')}）`)
    if (e.mods === undefined && e.on_end === undefined) p.push('mods、on_end：至少要寫一個')
    if (e.mods !== undefined) p.push(...modsProblems('mods', e.mods))
    if (e.on_end !== undefined) p.push(...k.battle.effectProblems(e.on_end).map((m) => `on_end：${m}`))
    return p
  }
}

export function registerBuff(k: Kernel): void {
  k.battle.effect('buff', OWNER, (ctx, e) => {
    const unit = ctx.unit
    if (!unit || ctx.run.isStandIn(unit) || unit.out) return
    const until = (typeof e.until === 'string' ? e.until : 'own_turn_end') as UnitBuff['until']
    const id = String(e.id)
    const source = ctx.source
    const ab = source.kind === 'ability' ? ctx.run.k.content.get<AbilityEntry>('ability', source.id) : undefined
    const buff: UnitBuff = {
      id, name: typeof e.name === 'string' ? e.name : id, turns: typeof e.turns === 'number' ? e.turns : 1, until,
      of: until.startsWith('source') ? ctx.user.id : unit.id, by: ctx.user.id,
      tier: ctx.n.tier ?? (ab ? tierIn(ctx.user, ab.path) : 1), source: { kind: source.kind, id: source.id, name: source.name },
      mods: structuredClone((e.mods ?? []) as ModEntry[]), on_end: structuredClone((e.on_end ?? []) as Array<Record<string, unknown>>),
    }
    setBuffs(unit, [...unitBuffs(unit).filter((b) => b.id !== id), buff])
    ctx.run.say(`${unitTag(unit)}：${buff.name}。`, 'status', { target: unit.id, buff: id, by: ctx.user.id }, ctx.user)
  }, { problems: buffProblems(k) })
}

// ---- 掛上去 ----

export function registerMods(k: Kernel): void {
  k.battle.modifier(OWNER, (q: ModQuery): RollPart[] => applied(q.view, q.unit, q.kind, q.tags, q.other).map((a) => ({ label: a.src.name, value: a.value, source: 'skill' })).filter((p) => p.value !== 0))

  // 每場、每回合只有前幾次的修正：行動做完時記一次（和定點射的減免同一個做法）。
  // 這時候次數還沒加，照同樣的條件再問一次，拿到的就是剛才算花費時用的那幾筆
  k.battle.on('action.done', OWNER, ({ run, unit, tags, base }) => {
    for (const [kind, baseValue] of [['action_ap', base.ap], ['action_ram', base.ram ?? 0]] as const) {
      if (!baseValue) continue
      for (const a of applied(run, unit, kind, tags)) {
        if (a.value === 0) continue
        if (a.entry.per_fight !== undefined) unit.uses[counterKey(a.src, a.index, false)] = (unit.uses[counterKey(a.src, a.index, false)] ?? 0) + 1
        if (a.entry.per_turn !== undefined) unit.uses[counterKey(a.src, a.index, true)] = (unit.uses[counterKey(a.src, a.index, true)] ?? 0) + 1
      }
    }
  })

  // 這個功能自己認的幾種修正（核心不問）：每一次射擊都算瞄準過的；打在他身上的重創改成一般的命中；傷害多一個公式（命中確定之後才擲）
  k.battle.on('attack.before', OWNER, ({ run, attacker, target, opts }) => {
    if (run.isStandIn(attacker) || opts.aimed) return
    if (featureTotal(run, attacker, 'aim_all', opts.tags ?? [], run.isStandIn(target) ? undefined : target) > 0) opts.aimed = true
  })
  k.battle.on('attack.hit', OWNER, ({ run, attacker, target, opts, roll, out }) => {
    if (!run.isStandIn(attacker)) for (const p of featureMods(run, attacker, 'damage_roll', opts.tags ?? [], target)) opts.damage = (opts.damage ?? 0) + p.value
    if (roll.wound && featureTotal(run, target, 'no_wound', opts.tags ?? [], attacker) > 0) out.wound = false
  })

  k.battle.on('turn.start', OWNER, ({ run, unit }) => tickBuffs(run, 'turn_start', unit))
  k.battle.on('turn.end', OWNER, ({ run, unit }) => tickBuffs(run, 'turn_end', unit))
}
