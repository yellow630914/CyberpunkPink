// 被動、姿態、共鳴、預備與 buff 的修正：meat.mods 的每一筆 { kind, value, tags?, who?, when?, per_fight?, per_turn?, to? }。
// 規格：dev/work/M1b-skill-format.md 第三節。誰吃得到：被動的裝著就有；姿態的開著才有；共鳴的照階數；預備的整場有效；buff 的在期限內有效。
// who 是「修正落在誰身上」：self（預設）、adjacent（相鄰的隊友）、allies（我方在場的每個人）、behind（自己後面那一格的人）；
// when 看的是給修正的那個人自己（再加對手的 other_*）。
// buff 這個效果也由這裡註冊：在對象身上掛一段時間的修正，結束時做 on_end；任何來源都能用。

import type { BattleRun, BattleUnit, BattleView, Kernel, ModQuery, RollPart } from '../../core'
import { STATUS_UNTILS, amount, onField, statusRuleOf, unitTag, unitsOf } from '../../core'
import { colIn, layerOf } from './column'
import { whenBlocks } from './conditions'
import { modsProblems } from './format'
import type { AbilityEntry, AnyModKind, FeatureModKind, ModEntry, PathEntry, UnitBuff } from './types'
import { OWNER } from './types'
import { broughtPrep, broughtTargets, equippedOf, isPerson, isRec, setBuffs, tierIn, unitAbilities, unitBuffs } from './unitdata'

/** 一批修正的來源：哪個技能（或共鳴、預備、buff）、誰是給的人、這棵樹幾階。 */
interface Source {
  key: string
  name: string
  holder: BattleUnit
  tier: number
  mods: ModEntry[]
  /** buff 的給的人（vs_source 的修正認它） */
  by?: string
  /** 只對這個人有效（預備選了人：讀人）：問修正時的對手要是他 */
  vs?: string
}

function sourcesOf(view: Pick<BattleView, 'k' | 'mode'>, holder: BattleUnit): Source[] {
  const out: Source[] = []
  const d = unitAbilities(holder)
  if (d.equipped.length) {
    for (const ab of equippedOf(view, holder)) {
      // 這一層的那一欄（照戰場；淺檔的專屬構裝整欄不算）
      const m = colIn(view, holder, ab)
      if (!m?.mods) continue
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
  for (const b of unitBuffs(holder)) out.push({ key: `buff:${b.id}`, name: b.name, holder, tier: b.tier, mods: b.mods, by: b.by })
  const targets = broughtTargets(holder)
  for (const id of broughtPrep(holder)) {
    const ab = view.k.content.get<AbilityEntry>('ability', id)
    const mods = layerOf(view) === 'net' ? ab?.prep?.net?.mods : ab?.prep?.meat?.mods
    if (ab && mods) out.push({ key: `prep:${id}`, name: ab.name, holder, tier: tierIn(holder, ab.path), mods, ...(ab.prep?.target === 'person' ? { vs: targets[id] ?? '' } : {}) })
  }
  return out
}

const counterKey = (src: Source, i: number, perTurn: boolean): string => `${perTurn ? 'turn:' : ''}mod:${src.key}#${i}`

/**
 * 這一筆修正的數字（公式與 by_tier 照給的人的樹階；crit_margin 的 to 換成和核心預設的差；action_ap 的 to 換成「改成只花 to 點」的差：
 * 原價比 to 少就是 0，沒有原價（沒人問花費）也是 0）。寫了 min 的不低於它。
 */
function valueOf(view: BattleView, src: Source, e: ModEntry, base?: number): number {
  const v = e.value
  let n = 0
  if (e.to !== undefined) n = e.kind === 'action_ap' ? (base === undefined ? 0 : Math.min(0, e.to - base)) : e.to - view.n.critMargin
  else if (typeof v === 'number') n = v
  else if (typeof v === 'string') n = Math.round(amount({ run: view as unknown as BattleRun, user: src.holder, n: { tier: src.tier } }, v))
  else if (isRec(v) && Array.isArray(v.by_tier)) n = Number(v.by_tier[Math.min(4, Math.max(0, src.tier - 1))] ?? 0)
  return e.min !== undefined ? Math.max(e.min, n) : n
}

interface Applied {
  src: Source
  index: number
  entry: ModEntry
  value: number
}

/** 問 unit 的某一種數字時，現在算數的每一筆修正。base 是問 action_ap 時行動自己算的原價（to 要用）。 */
function applied(view: BattleView, unit: BattleUnit, kind: AnyModKind, tags: readonly string[], other?: BattleUnit, base?: number): Applied[] {
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
        if (entry.tags_any && !entry.tags_any.some((t) => tags.includes(t))) return
        if (entry.when && whenBlocks(view, holder, entry.when, other).length) return
        if (entry.vs_source && !(other && src.by !== undefined && other.id === src.by)) return
        if (src.vs !== undefined && !(other && src.vs !== '' && isPerson(other, src.vs))) return
        if (entry.per_fight !== undefined && (unit.uses[counterKey(src, index, false)] ?? 0) >= entry.per_fight) return
        if (entry.per_turn !== undefined && (unit.uses[counterKey(src, index, true)] ?? 0) >= entry.per_turn) return
        out.push({ src, index, entry, value: valueOf(view, src, entry, base) })
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
      // 他在自己的回合裡給自己的 own_turn_end：這個回合的結束不算（registerBuff 標的 skip），數到第一次只拿掉記號
      if (b.skip) {
        delete b.skip
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
    for (const key of Object.keys(e)) if (!['op', 'who', 'if', 'id', 'name', 'turns', 'until', 'mods', 'on_end', 'mask'].includes(key)) p.push(`不認得的欄位 ${key}（可以寫：id、name、turns、until、mods、on_end、mask）`)
    if (!isText(e.id)) p.push('id：一定要寫（buff 的名字，同一個 id 再掛一次是重算時間）')
    if (e.name !== undefined && !isText(e.name)) p.push('name：要是給玩家看的名字')
    if (e.turns !== undefined && !(Number.isInteger(e.turns) && (e.turns as number) >= 1)) p.push('turns：要是 1 以上的整數')
    if (e.until !== undefined && !(STATUS_UNTILS as readonly unknown[]).includes(e.until)) p.push(`until：「${String(e.until)}」不在清單裡（可以寫：${STATUS_UNTILS.join('、')}）`)
    if (e.mask !== undefined) {
      if (e.mask !== true && !(isRec(e.mask) && Object.keys(e.mask).every((key) => key === 'rounds') && (e.mask.rounds === undefined || (Number.isInteger(e.mask.rounds) && (e.mask.rounds as number) >= 1)))) p.push('mask：要是 true，或 { rounds }（到第幾回合為止，含；1 以上的整數）。面具：AI 挑目標時不挑戴著的人（入戲）')
    }
    if (e.mods === undefined && e.on_end === undefined && e.mask === undefined) p.push('mods、on_end、mask：至少要寫一個')
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
      // 到「他」的下一個回合結束：給自己、又在自己的回合裡給，這個回合的結束不算（同核心狀態的規則）
      ...(until === 'own_turn_end' && ctx.run.skipsOwnTurnEnd(unit, ctx.user) ? { skip: true as const } : {}),
      ...(e.mask === true ? { mask: {} } : isRec(e.mask) ? { mask: structuredClone(e.mask) as { rounds?: number } } : {}),
    }
    setBuffs(unit, [...unitBuffs(unit).filter((b) => b.id !== id), buff])
    ctx.run.say(`${unitTag(unit)}：${buff.name}。`, 'status', { target: unit.id, buff: id, by: ctx.user.id }, ctx.user)
  }, { problems: buffProblems(k) })
}

// ---- 掛上去 ----

export function registerMods(k: Kernel): void {
  k.battle.modifier(OWNER, (q: ModQuery): RollPart[] => {
    return applied(q.view, q.unit, q.kind, q.tags, q.other, q.base).map((a) => ({ label: a.src.name, value: a.value, source: 'skill' as const })).filter((p) => p.value !== 0)
  })

  // 每場、每回合只有前幾次的修正：行動做完時記一次（和定點射的減免同一個做法）。
  // 這時候次數還沒加，照同樣的條件再問一次，拿到的就是剛才算花費時用的那幾筆
  k.battle.on('action.done', OWNER, ({ run, unit, tags, base }) => {
    for (const [kind, baseValue] of [['action_ap', base.ap], ['action_ram', base.ram ?? 0]] as const) {
      if (!baseValue) continue
      for (const a of applied(run, unit, kind, tags, undefined, baseValue)) {
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

  // 超頻的「下一次攻擊」（SKILL_TREES 超頻：義肢或智慧槍「他下一次攻擊命中 +2」）：規則表的 boost_limb、boost_smartgun 只寫得出「到他下一回合結束」的 +2，
  // 所以這裡補上「用掉」：帶著 boost_ 開頭、而且有命中加值的狀態的人，打完一次攻擊（擲過命中；卡彈、被取消的不算）就把那個狀態拿掉。
  // 「一次攻擊」是一次 run.attack：連射、掃射是一次，反應裡的攻擊也算；沒有命中加值的超頻（皮下裝甲的護甲、其他種類）不受影響，照樣到回合結束
  k.battle.on('attack.after', OWNER, ({ run, attacker, result }) => {
    if (run.isStandIn(attacker) || result.aborted) return
    for (const st of [...attacker.statuses]) {
      if (st.id.startsWith('boost_') && (statusRuleOf(run.k.content, st.id)?.mods?.hit ?? 0) > 0) run.removeStatus(attacker, st.id)
    }
  })

  k.battle.on('turn.start', OWNER, ({ run, unit }) => tickBuffs(run, 'turn_start', unit))
  k.battle.on('turn.end', OWNER, ({ run, unit }) => tickBuffs(run, 'turn_end', unit))

  // 給的人退出（倒下、制伏、逃走……）：他再也沒有回合，「到他的回合開始／結束」的 buff 沒有人會數，現在結束（W012：和核心的狀態、守著一樣）。
  // 他自己身上的 buff 不在這裡處理：沒有人會再用到，救回來時清（revive）
  k.battle.on('out', OWNER, ({ run, unit }) => {
    for (const holder of Object.values(run.battle.units)) {
      if (holder === unit) continue
      const buffs = unitBuffs(holder)
      const ended = buffs.filter((b) => b.of === unit.id && b.until.startsWith('source_'))
      if (!ended.length) continue
      setBuffs(holder, buffs.filter((b) => !ended.includes(b)))
      for (const b of ended) endBuff(run, holder, b)
    }
  })

  // 救回來：狀態清空，buff 也是（W013；dev/adr/0015 revive「狀態清空」）。不做 on_end：被清掉的不是「到期」
  k.battle.on('revive', OWNER, ({ unit }) => {
    if (unitBuffs(unit).length) setBuffs(unit, [])
  })

  // 到下次過載（until: next_overload）：過載的那一刻結束；沒有過載就留到戰鬥結束（不變式第 69 條）
  // 一般的過載發 overload；餘韻疊滿再過載（昏過去）不論有沒有人擋下都先發 out.before { how: 'burnout' }，擋下的那一次沒有 overload（dev/adr/0015 補記 M1b-review-core）
  const endOnOverload = (run: BattleRun, unit: BattleUnit): void => {
    const buffs = unitBuffs(unit)
    const ended = buffs.filter((b) => b.until === 'next_overload')
    if (!ended.length) return
    setBuffs(unit, buffs.filter((b) => !ended.includes(b)))
    for (const b of ended) endBuff(run, unit, b)
  }
  k.battle.on('overload', OWNER, ({ run, unit }) => endOnOverload(run, unit))
  k.battle.on('out.before', OWNER, ({ run, unit, how }) => {
    if (how === 'burnout') endOnOverload(run, unit)
  })
}
