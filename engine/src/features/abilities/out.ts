// 戰鬥外的技能效果（dev/work/M2-abilities-m2.md）：
// - 姿態可以在戰鬥外開（meat.out；偽裝）：報告 ability.stance，記在 actor.ext.abilities.stance。開著的時候，戰鬥外帶那些標籤、用那項基本功的檢定加 meat.out.check.value
//   （偽裝：infiltrate 的表演檢定 +2）。開打時還開著就帶進戰鬥：單位的姿態就是它，meat.out.on_start 開打做一次（第一回合第一次攻擊命中 +2 照姿態的 mods；
//   這一場開打前被識破了就不生效，見 whenBlocks 的 not_spotted）。
// - 被動的 meat.out_mods：裝著的時候，戰鬥外帶那些標籤的檢定加多少（演技派、入骨：infiltrate +2、+4；豔名的「被認出來」是 lewd 的檢定修正，這裡是它的對照）。
// - 預備的 prep.out_mods：選了人的預備（讀人）預備好之後，戰鬥外對那個人（檢定的對象）的誘惑與交涉檢定加多少，預備用掉之前一直有效。
// 都是檢定修正（k.stats.addCheckModifier）：只在戰鬥外問；戰鬥裡的檢定由戰鬥的修正管。

import type { ActorId, BattleRun, BattleUnit, CheckCtx, GameState, Kernel, ReportDraft, RollPart } from '../../core'
import { clone } from '../../core'
import { abilitiesOf, reportOf } from './learn'
import type { OutMod } from './types'
import { OWNER } from './types'
import { dataOf, isRec, tierIn, unitAbilities } from './unitdata'
import { abilityEntry } from './outside'

/** 這一筆戰鬥外的修正對不對得上這一次檢定：tags 全部都要有、skill 要一樣（沒寫的不限）。 */
const matches = (m: OutMod, ctx: Pick<CheckCtx, 'tags' | 'skill'>): boolean =>
  (!m.tags || m.tags.every((t) => ctx.tags.includes(t))) && (m.skill === undefined || ctx.skill === m.skill)

/** 戰鬥外的檢定修正：開著的戰鬥外姿態、裝著的被動、預備好的（選了人的只對他）。 */
export function outParts(k: Pick<Kernel, 'content'>, state: GameState, actor: ActorId, ctx: CheckCtx): RollPart[] {
  if (state.battle || !state.actors[actor]) return []
  const mine = abilitiesOf(state, actor)
  const out: RollPart[] = []
  const push = (label: string, m: OutMod): void => {
    if (matches(m, ctx)) out.push({ label, value: m.value, source: 'skill' })
  }
  for (const id of mine.equipped) {
    const ab = abilityEntry(k, id)
    const m = ab?.meat
    if (!ab || !m || m.pending) continue
    if (ab.kind === 'stance' && mine.stance === id && m.out) push(ab.name, m.out.check)
    if (ab.kind === 'passive') for (const mod of m.out_mods ?? []) push(ab.name, mod)
  }
  for (const p of mine.prepared ?? []) {
    if (p.target === undefined || ctx.target !== p.target) continue
    const ab = abilityEntry(k, p.id)
    for (const mod of ab?.prep?.out_mods ?? []) push(ab!.name, mod)
  }
  return out
}

// ---- 戰鬥外開關姿態 ----

/** 現在開得了這個姿態嗎（戰鬥外）；開不了回傳第一個原因（給玩家看的完整句子）。關掉自己開著的不看條件。 */
export function stanceBlock(k: Pick<Kernel, 'content'>, state: GameState, actor: ActorId, id: string): string | null {
  const ab = abilityEntry(k, id)
  if (!ab) return '沒有這個技能。'
  if (!state.actors[actor]) return '沒有這個角色。'
  if (state.battle) return '戰鬥中的姿態用戰鬥裡的行動開關。'
  const mine = abilitiesOf(state, actor)
  if (mine.stance === id) return null
  if (ab.kind !== 'stance') return `${ab.name}不是姿態。`
  // 輿論的姿態（opinion.stance: true；M5-abilities-opinion）在開戰前開：開著的記在這裡，輿論戰開場問 opinion.passives 時才算
  const opinionStance = ab.opinion?.stance === true && ab.opinion.pending !== true
  if (!opinionStance && (!ab.meat?.out || ab.meat.pending)) return `${ab.name}只能在戰鬥裡開。`
  if (!mine.equipped.includes(id)) return `要先裝上${ab.name}。`
  return null
}

/**
 * 在戰鬥外開或關一個姿態（報告 ability.stance；不花時間與行動點）。這個姿態已經開著就是關掉；開另一個會把前一個關掉（同時只能開一個）。
 * 開不了丟錯（訊息是那個原因）。
 */
export function stance(k: Pick<Kernel, 'content'>, state: GameState, actor: ActorId, id: string): ReportDraft {
  const why = stanceBlock(k, state, actor, id)
  if (why) throw new Error(why)
  const mine = abilitiesOf(state, actor)
  const ab = abilityEntry(k, id)!
  const { stance: current, ...rest } = clone(mine)
  const turningOff = current === id
  const next = turningOff ? rest : { ...rest, stance: id }
  const name = state.actors[actor]!.name
  const summary = turningOff ? `${name}收起了${ab.name}。` : current ? `${name}換成了${ab.name}。` : `${name}開了${ab.name}。`
  const report = reportOf(state, actor, 'ability.stance', next, summary, turningOff ? 'off' : 'on')
  report.timeline = [{ layer: 'meat', actor, text: summary, tag: 'stance' }]
  return report
}

// ---- 帶進戰鬥 ----

/** 單位剛組好：戰鬥外開著的姿態（還裝著、是現實戰鬥）帶進來，單位的姿態就是它；記下來讓開打時做 meat.out.on_start。 */
export function carryStance(run: Pick<BattleRun, 'state' | 'battle' | 'k' | 'mode'>, unit: BattleUnit): void {
  if (!unit.actor || run.mode.layer !== 'meat' || unit.stance) return
  const id = abilitiesOf(run.state, unit.actor).stance
  if (!id || !unitAbilities(unit).equipped.includes(id)) return
  const ab = abilityEntry(run.k, id)
  if (!ab || ab.kind !== 'stance' || !ab.meat?.out || ab.meat.pending) return
  unit.stance = id
  dataOf(unit).carried = id
}

/** 開打時：戰鬥外開著帶進來的姿態，做它的 meat.out.on_start。 */
export function startOutStance(run: BattleRun): void {
  for (const u of Object.values(run.battle.units)) {
    const d = u.ext.abilities
    const id = isRec(d) && typeof d.carried === 'string' ? d.carried : undefined
    if (!id) continue
    delete (d as Record<string, unknown>).carried
    const ab = abilityEntry(run.k, id)
    const list = ab?.meat?.out?.on_start
    if (!ab || u.stance !== id || !list?.length || u.out || u.slot < 1) continue
    run.say(`${u.name}：${ab.name}（開戰）。`, 'skill', { unit: u.id, ability: ab.id, start: true }, u)
    run.effects(list, { user: u, target: null, source: { kind: 'ability', id: ab.id, name: ab.name }, n: { tier: tierIn(u, ab.path) } })
  }
}

export function registerOut(k: Kernel): void {
  k.stats.addCheckModifier(OWNER, (state, actor, ctx) => outParts(k, state, actor, ctx))
}


