// 名媛：面具、誘惑攻擊、替身（M1b-skill-social；SKILL_TREES「名媛：入戲」；dev/adr/0015 E8、E13）。
//
// 面具（meat.mask、buff 的 mask）：戴著面具的人，AI 挑目標時不挑他（修正 ai_target_pct −100；核心的規則：候選全部都是 0 時當成沒有這個修正，
//   所以「她是唯一打得到的目標」時照樣被打）。例外：她這一回合已經攻擊過（含誘惑攻擊）的那個敵人照樣可以挑她——在 attack.after 與誘惑攻擊裡記
//   unit.uses['mask_hit:<被打的人>'] = 回合數。入戲（被動）：到第 rounds 回合為止（含）；換臉、千面用 buff 的 mask 重新給一段或延長。
// 誘惑攻擊（效果 { op: 'tease' }、meat.tease）：E8，一次檢定加一次快感傷害，不走武器攻擊（沒有要害與重創、不傷遮蔽）。
//   檢定用核心的 check 效果（對 'will'，帶標籤 tease：被誘惑的人的反應經由 check.before），傷害用核心的 damage 效果（快感）。
// 替身（react.then_move）：這一擊被擋下之後，被打的人換到相鄰的一格。換位要等這一擊結算完（遮蔽傷在原本的那一格），所以記下來，在 attack.after 做。
// 另外記每個單位這一場發動過幾次攻擊（偽裝的「第一次攻擊」：when.first_attack）。
// 不 import 別的功能：檢定、傷害、狀態一律經由 run.effects。

import type { BattleEffectCtx, BattleEffectLast, BattleRun, BattleUnit, BattleView, Kernel } from '../../core'
import { BATTLE_SLOTS, amount, coverAt, coverLevel, distance, isRecord, onField, unitAt, unitTag, unitsOf } from '../../core'
import { colIn, layerOf, liveCols } from './column'
import { ATTACKS_MADE, hasPersona } from './conditions'
import { teaseFieldProblems } from './format'
import { featureMods } from './mods'
import type { AbilityEntry, MeatDef } from './types'
import { OWNER } from './types'
import { equippedOf, spotted, unitBuffs } from './unitdata'

/** 誘惑攻擊的距離上限（SKILL_TREES 入戲：現實距離 2 以內、內海距離 3 以內）、基本行動的消耗。 */
export const TEASE_RANGE = 2
export const LURE_RANGE = 3
export const TEASE_AP = 2
/** 基本的誘惑攻擊與主動的誘惑技能共用每回合 1 次的那一組。 */
export const TEASE_GROUP = 'tease'

// ---- 面具 ----

const maskHitKey = (id: string): string => `mask_hit:${id}`

/**
 * 現在戴著面具嗎：裝著的被動（meat.mask，到第 rounds 回合為止）或一段 buff（mask：有 rounds 的看回合，沒有的在這一段還在時都算）。
 * 這一場開打前被識破了（origin.ext.pre.spotted），被動的面具這一場不生效（SKILL_TREES 入戲：開打前被識破的那一場）；換臉、千面這類 buff 是戰鬥中另外戴上的，不受影響。
 */
export function maskOn(view: Pick<BattleView, 'k' | 'battle' | 'mode'>, unit: BattleUnit): boolean {
  const round = view.battle.round
  if (!spotted(view.battle)) {
    for (const ab of equippedOf(view, unit)) {
      const m = colIn(view, unit, ab)
      if (ab.kind === 'passive' && m?.mask && round <= m.mask.rounds) return true
    }
  }
  return unitBuffs(unit).some((b) => b.mask && (b.mask.rounds === undefined || round <= b.mask.rounds))
}

// ---- 誘惑攻擊：把技能改寫成一般的技能行動 ----

/** 誘惑攻擊要的條件：目標有橋、距離 2 以內（技能自己寫了 needs、range 的照它的）。targets 是 2 時多一個選第二個目標。 */
function teaseMeat(m: MeatDef): MeatDef {
  const { tease, ...rest } = m
  const t = tease ?? {}
  return {
    ...rest,
    target: 'enemy',
    needs: { bridged: true, ...(m.needs ?? {}) },
    range: m.range ?? [1, TEASE_RANGE],
    do: [{ op: 'tease', ...t }],
    ...(t.targets === 2 ? { picks: [{ key: 'second', label: '第二個目標', kind: 'foe' as const, required: true, apart: true, needs: { bridged: true }, range: [1, TEASE_RANGE] as [number, number] }] } : {}),
  }
}

/**
 * 有 meat.tease 的技能改寫成一個一般的主動技能（照 skillAction 註冊）：主動技能照自己的名字與消耗；
 * 被動（入戲）是一個基本的行動「誘惑攻擊」：2 點、每回合 1 次、同一組。技能的 id 不變（裝著才有、次數記在 id 上）。
 */
export function teaseEntry(ab: AbilityEntry): AbilityEntry {
  const meat = teaseOf(ab.meat) ? teaseMeat(ab.meat!) : ab.meat
  const net = teaseOf(ab.net) ? teaseMeat(ab.net!, true) : ab.net
  if (ab.kind !== 'passive') return { ...ab, meat, net }
  return {
    ...ab, kind: 'active', name: '誘惑攻擊', text: '對距離 2 以內（內海 3 以內）一名有橋的目標做一次誘惑攻擊：擲魅力與誘惑對他的意志與定力，過了造成快感傷害。',
    use: { ap: TEASE_AP, per_turn: 1, group: TEASE_GROUP }, meat, net,
  }
}

// ---- 誘惑攻擊：效果 ----

/** 記一次「攻擊過他」：面具的例外（這一回合已經攻擊過的敵人照樣可以挑她）。 */
function markAttacked(run: BattleRun, by: BattleUnit, target: BattleUnit): void {
  if (!run.isStandIn(by) && !run.isStandIn(target)) by.uses[maskHitKey(target.id)] = run.battle.round
}

function pickedUnit(ctx: BattleEffectCtx, key: string): BattleUnit | undefined {
  const v = ctx.pick[key]
  const id = typeof v === 'string' ? v : isRecord(v) && typeof v.unit === 'string' ? v.unit : undefined
  return id ? ctx.run.battle.units[id] : undefined
}

/** 對一個人做一次誘惑攻擊。 */
function teaseOne(ctx: BattleEffectCtx, e: Record<string, unknown>, t: BattleUnit): void {
  const { run, user } = ctx
  if (t.out || !onField(t) || run.isStandIn(t)) return
  const net = run.mode.layer === 'net'
  const reach = net ? LURE_RANGE : TEASE_RANGE
  if (!t.load) {
    run.say(`${unitTag(t)} 沒有橋，誘惑攻擊對他無效。`, 'tease', { unit: user.id, target: t.id, blocked: 'bridge' }, user)
    ctx.last.ok = false
    return
  }
  if (net && !hasPersona(t)) {
    run.say(`${unitTag(t)} 沒有人格，誘惑攻擊對它無效（內海只有化身與帶人格的蕾絲打得到）。`, 'tease', { unit: user.id, target: t.id, blocked: 'persona' }, user)
    ctx.last.ok = false
    return
  }
  if (distance(user, t) > reach) {
    run.say(`${unitTag(t)} 太遠了（距離 ${distance(user, t)}），誘惑攻擊只打得到距離 ${reach} 以內的人。`, 'tease', { unit: user.id, target: t.id, blocked: 'range' }, user)
    ctx.last.ok = false
    return
  }
  markAttacked(run, user, t)
  const input = { user, target: { unit: t.id }, source: ctx.source, pick: ctx.pick, n: ctx.n }

  // 檢定：1d20 ＋ mod(魅力) ＋ 誘惑（＋ hit ＋ tease_hit 的修正 ＋ 標籤 tease 的檢定修正），對 10 ＋ 他的 mod(意志) ＋ 定力
  const bonus: Array<{ label: string; value: number }> = []
  const hit = e.hit === undefined ? 0 : Math.round(amount(ctx, e.hit as number | string))
  if (hit) bonus.push({ label: ctx.source.name, value: hit })
  for (const p of featureMods(run, user, 'tease_hit', ['tease'], t)) if (p.value) bonus.push({ label: p.label, value: p.value })
  const checked: BattleEffectLast = {}
  run.effects([{ op: 'check', attr: 'charm', skill: 'seduce', vs: 'will', tags: ['tease'], label: '誘惑攻擊', ...(bonus.length ? { bonus } : {}) }], { ...input, last: checked })
  const ok = checked.ok === true
  ctx.last.ok = ok
  ctx.last.overloaded = false
  if (!ok) return

  // 傷害：2d6（＋ bonus ＋ tease_bonus 的修正）快感傷害，不看護甲與遮蔽；內海照網內的規則再加魅力的調整值
  let raw = amount(ctx, net ? '2d6+mod:charm' : '2d6')
  if (e.bonus !== undefined) raw += amount(ctx, e.bonus as number | string)
  for (const p of featureMods(run, user, 'tease_bonus', ['tease'], t)) raw += p.value
  const before = { layers: t.layers, out: t.out }
  const dealt: BattleEffectLast = {}
  run.effects([{ op: 'damage', amount: Math.max(0, raw), type: 'pleasure' }], { ...input, last: dealt })
  // 這一下讓他過載：餘韻多了一層，或餘韻疊滿之後昏過去
  const overloaded = t.layers > before.layers || (!before.out && t.out === 'burnout')
  ctx.last.overloaded = overloaded
  ctx.last.dealt = dealt.dealt ?? 0

  // 過了之後的效果；過載了再做 on_overload
  const after: BattleEffectLast = { ok: true, overloaded, ...(dealt.dealt !== undefined ? { dealt: dealt.dealt } : {}) }
  if (Array.isArray(e.on_ok) && e.on_ok.length) run.effects(e.on_ok as Array<Record<string, unknown>>, { ...input, last: after })
  if (overloaded && Array.isArray(e.on_overload) && e.on_overload.length) run.effects(e.on_overload as Array<Record<string, unknown>>, { ...input, last: after })
}

function teaseOp(ctx: BattleEffectCtx, e: Record<string, unknown>): void {
  const first = ctx.unit
  if (!first || ctx.run.isStandIn(first) || ctx.overlay) return
  teaseOne(ctx, e, first)
  // 傾城：第二個目標（pick.second）各擲各的；選錯的（同一個人、自己人、沒有橋、太遠）不做
  if (e.targets === 2 && !ctx.user.out) {
    const second = pickedUnit(ctx, 'second')
    if (second && second.id !== first.id && second.side !== ctx.user.side && !!second.load && distance(ctx.user, second) <= (ctx.run.mode.layer === 'net' ? LURE_RANGE : TEASE_RANGE)) teaseOne(ctx, e, second)
  }
}

// ---- 替身：這一擊結算完之後換位 ----

const pendingMove = new WeakSet<BattleUnit>()
/** 要求這個人在這一擊結算完之後換到相鄰的一格（替身的 react.then_move）。 */
export const requestMove = (u: BattleUnit): void => void pendingMove.add(u)

/**
 * 有空格先去空格，沒有就和相鄰的隊友交換（都先往後）。不花行動點、不看「不能換位」的狀態。
 * 空格只有真的留得住的才算：往後一格的空格，要她原本那一格有遮蔽（沒有的話補位會把她拉回來，等於沒換）；往前的空格本來就是被遮蔽撐著的。
 */
function moveAside(run: BattleRun, u: BattleUnit): void {
  if (!pendingMove.delete(u) || u.out || !onField(u) || run.isStandIn(u)) return
  const near = [u.slot + 1, u.slot - 1].filter((s) => s >= 1 && s <= BATTLE_SLOTS)
  const sticks = (s: number): boolean => s < u.slot || coverLevel(coverAt(run.battle, u.side, u.slot)) > 0
  const to = near.find((s) => !unitAt(run.battle, u.side, s) && sticks(s)) ?? near.find((s) => !!unitAt(run.battle, u.side, s))
  if (to !== undefined) run.move(u, to)
}

export function registerSocial(k: Kernel): void {
  k.battle.effect('tease', OWNER, teaseOp, {
    problems: (e) => {
      const p = Object.keys(e).filter((key) => !['op', 'who', 'if', 'hit', 'bonus', 'on_ok', 'on_overload', 'targets'].includes(key)).map((key) => `不認得的欄位 ${key}（可以寫：hit、bonus、on_ok、on_overload、targets）`)
      p.push(...teaseFieldProblems('tease', e, k))
      return p
    },
  })

  // 面具：AI 挑目標時不挑戴著的人；她這一回合已經攻擊過的那個敵人照樣可以挑
  k.battle.modifier(OWNER, (q) => {
    if (q.kind !== 'ai_target_pct' || !q.other) return []
    const u = q.unit
    if (q.view.battle.units[u.id] !== u || !maskOn(q.view, u)) return []
    if (u.uses[maskHitKey(q.other.id)] === q.view.battle.round) return []
    return [{ label: '面具', value: -100, source: 'skill' }]
  })

  // 內海版的面具：分出結果的那一刻，戴著面具的化身在報告裡標 data.masked（敵對值與豔名不連到本人；「留下痕跡」的變更這一批沒有來源）
  k.battle.on('battle.result', OWNER, ({ run }) => {
    if (run.mode.layer !== 'net') return
    for (const u of unitsOf(run.battle, 'ally')) {
      if (!netMasked(run, u)) continue
      run.say(`${u.name} 戴著面具：這一場的敵對值與豔名不連到本人。`, 'skill', { unit: u.id, masked: true }, u)
    }
  })

  // 每一次攻擊：記攻擊過幾次、攻擊過誰（面具的例外）；替身的換位
  k.battle.on('attack.after', OWNER, ({ run, attacker, target, result }) => {
    if (!run.isStandIn(attacker) && !result.aborted) {
      attacker.uses[ATTACKS_MADE] = (attacker.uses[ATTACKS_MADE] ?? 0) + 1
      markAttacked(run, attacker, target)
    }
    moveAside(run, target)
  })
}
