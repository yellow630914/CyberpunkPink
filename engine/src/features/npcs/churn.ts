// L6 功能 npcs：每區名單的變動（NPC_SYSTEM 3.2 節；dev/work/M2-npc-life.md）。
// 每 3 天每份名單 25% 發生一件：搬來一個人、一個人搬走、一個人搬去另一區（他的出沒地有那一區時）、一個人被捕或死了（舊港、鏽帶、地下層的機率較高）。
// 城市的大事「契約季」進行中（旗標 city_event:contract_season，可以在規則改名）機率加倍。
// 設定「認識的人不會因為汰換而死」（預設開；玩家的設定是旗標 npcs:protect_known，寫 false 就關）：開著的時候和主角有關係條目的人只會搬走或被捕。
// 搬走或出事的如果是認識的人，記一則近況、帶 npc_life 的觸發點（長出什麼事件是事件的資料）。
// 純函式：只讀狀態、把要套的變更與報告的拍子放進 out；一次 time.passed 裡好幾個三天要接著算，所以名單的樣子在這裡自己往前推。

import type { Change, GameState, GameTime, Kernel, ReportTrigger, TimelineBeat } from '../../core'
import { Rng, hash32 } from '../../core'
import { genEntryOf, genId, generateNpc, takenNames } from './generate'
import type { LifeRules } from './lifeRules'
import type { Npc } from './model'
import { knows, npcOf, readNpcs } from './model'

/** 一次 time.passed 的結果：變更、報告的拍子、觸發點、給玩家看的句子。 */
export interface LifeOut {
  changes: Change[]
  beats: TimelineBeat[]
  triggers: ReportTrigger[]
  lines: string[]
}

/** 玩家的設定：認識的人不會因為汰換而死（旗標；沒寫就照規則的預設）。 */
export const PROTECT_FLAG = 'npcs:protect_known'

export interface ChurnCtx {
  k: Kernel
  state: GameState
  rules: LifeRules
  out: LifeOut
  /** 這個人現在是不是名冊上的人（沒有 in_roster 這種條件時永遠是 false） */
  isMember: (id: string) => boolean
  /** 需要角色（狀況掛在角色身上）：還不是角色的放進去 */
  ensureActor: (id: string, record?: Npc) => void
  /** 已經被捕的人（本來就有 arrested 狀況的，加上這一次的） */
  arrested: Set<string>
}

/** 一次 time.passed 裡推演名單用的暫存（每個三天接著上一個的結果）。 */
export interface ChurnState {
  /** 已經建好的名單（地區 → ids），推演時自己更新 */
  rosters: Map<string, string[]>
  records: Map<string, Npc>
  seqs: Map<string, number>
  taken: Set<string>
  gone: Set<string>
  /** 沒有關係條目、也沒有被丟掉的人名單變動的筆數（只寫進句子，不寫近況） */
  quiet: number
}

export function newChurn(k: Kernel, state: GameState): ChurnState {
  const s = readNpcs(state)
  const rosters = new Map<string, string[]>()
  for (const d of Object.keys(s.rosters).sort()) if (s.rosters[d]!.built) rosters.set(d, [...s.rosters[d]!.ids])
  return { rosters, records: new Map(), seqs: new Map(Object.entries(s.seq)), taken: takenNames(k, state), gone: new Set(), quiet: 0 }
}

const nameOf = (k: Kernel, state: GameState, id: string, c: ChurnState): string => state.actors[id]?.name ?? c.records.get(id)?.name ?? npcOf(k, state, id)?.name ?? id
const districtName = (k: Kernel, d: string): string => String(k.content.get('district', d)?.name ?? d)

export function protectKnown(ctx: Pick<ChurnCtx, 'state' | 'rules'>): boolean {
  const f = ctx.state.flags[PROTECT_FLAG]
  return f === undefined ? ctx.rules.roster.protect_known : f !== false
}

/** 契約季（或規則裡指定的城市大事）進行中。 */
export const seasonOn = (state: GameState, rules: LifeRules): boolean => {
  const f = state.flags[rules.roster.season_flag]
  return f !== undefined && f !== false
}

const WEIGHT_KEYS = ['join', 'leave', 'move', 'trouble'] as const

/** 這個三天（day 是這個時間點的日子、at 是時間）每份名單各擲一次。名單照區的 id 排。 */
export function churnTick(ctx: ChurnCtx, cs: ChurnState, day: number, at: GameTime): void {
  const { state, rules } = ctx
  const seed = state.rng.seed
  const chance = Math.min(1, rules.roster.chance * (seasonOn(state, rules) ? rules.roster.season_mult : 1))
  for (const district of [...cs.rosters.keys()].sort()) {
    // 先把這份名單要用的亂數都抽出來（順序固定，之後條件怎麼變都不影響下一份）
    const rng = new Rng(hash32(seed, 'npcs/roster', district, day))
    const roll = { happens: rng.next(), kind: rng.next(), pick: rng.next(), die: rng.next(), side: rng.next() }
    if (!(roll.happens < chance)) continue
    const w = rules.roster.weights
    const weights = WEIGHT_KEYS.map((key) => (key === 'trouble' ? w.trouble * (rules.roster.risky[district] ?? 1) : w[key]))
    const total = weights.reduce((a, b) => a + b, 0)
    if (total <= 0) continue
    let r = roll.kind * total
    let kind: (typeof WEIGHT_KEYS)[number] = WEIGHT_KEYS[WEIGHT_KEYS.length - 1]!
    for (let i = 0; i < weights.length; i++) {
      r -= weights[i]!
      if (r < 0) {
        kind = WEIGHT_KEYS[i]!
        break
      }
    }
    if (kind === 'join') join(ctx, cs, district, roll.side)
    else leaveMoveTrouble(ctx, cs, district, kind, roll, at)
  }
}

function join(ctx: ChurnCtx, cs: ChurnState, district: string, side: number): void {
  const { k, state, out } = ctx
  const entry = genEntryOf(k, district)
  const citizens = entry?.citizens ?? 2
  const runners = entry?.runners ?? 1
  const kind = side * (citizens + runners) < citizens ? 'citizen' : 'runner'
  const s = readNpcs(state)
  let seq = (cs.seqs.get(district) ?? 0) + 1
  const taken = (n: number): boolean => Object.hasOwn(s.gen, genId(district, n)) || cs.records.has(genId(district, n))
  while (taken(seq)) seq++
  const id = genId(district, seq)
  const npc = generateNpc(k, state, district, seq, { id, kind, taken: cs.taken })
  if (!npc) return
  out.changes.push({ op: 'npcs.life.join', district, npc, seq })
  cs.rosters.get(district)!.push(id)
  cs.records.set(id, npc)
  cs.seqs.set(district, seq)
  cs.quiet++
}

function leaveMoveTrouble(
  ctx: ChurnCtx, cs: ChurnState, district: string, kind: 'leave' | 'move' | 'trouble',
  roll: { pick: number; die: number; side: number }, at: GameTime,
): void {
  const { k, state, rules, out } = ctx
  const ids = cs.rosters.get(district)!
  const rec = (id: string): Npc | undefined => cs.records.get(id) ?? npcOf(k, state, id)
  const others = (id: string): string[] => [...new Set((rec(id)?.haunts ?? []).map((h) => h.district).filter((d) => d !== '' && d !== district))].sort()
  const cands = ids.filter((id) => {
    const n = rec(id)
    if (!n || id === state.pc || state.party.includes(id) || ctx.isMember(id) || n.kind === 'staff' || cs.gone.has(id)) return false
    if (kind === 'trouble' && ctx.arrested.has(id)) return false
    if (kind === 'move' && others(id).length === 0) return false
    return true
  })
  if (cands.length === 0) return
  const id = cands[Math.floor(roll.pick * cands.length)]!
  const n = rec(id)!
  const known = knows(state, id)
  const name = nameOf(k, state, id, cs)
  const real = state.actors[id] !== undefined
  const note = (what: string, text: string): void => {
    if (!known) {
      cs.quiet++
      return
    }
    out.changes.push({ op: 'npcs.life.news', npc: id, at, what, text })
    out.beats.push({ layer: 'meat', text: `${name}${text}`, tag: 'npc.life', data: { npc: id, what } })
    out.lines.push(`${name}${text}`)
    out.triggers.push({ point: 'npc_life', where: { npc: id, what } })
  }
  if (kind === 'leave') {
    out.changes.push({ op: 'npcs.life.leave', npc: id, district, why: 'left', drop: !known && !real && n.source === 'gen' })
    ids.splice(ids.indexOf(id), 1)
    cs.gone.add(id)
    note('left', `搬離了${districtName(k, district)}。`)
  } else if (kind === 'move') {
    const targets = others(id)
    const to = targets[Math.floor(roll.side * targets.length)]!
    out.changes.push({ op: 'npcs.life.move', npc: id, from: district, to })
    ids.splice(ids.indexOf(id), 1)
    cs.rosters.get(to)?.push(id)
    note('moved', `搬到了${districtName(k, to)}。`)
  } else {
    const die = roll.die < rules.roster.die_share && !(known && protectKnown(ctx))
    if (die) {
      out.changes.push({ op: 'npcs.life.leave', npc: id, district, why: 'died', drop: !known && !real && n.source === 'gen' })
      ids.splice(ids.indexOf(id), 1)
      cs.gone.add(id)
      note('died', '死了。')
    } else {
      ctx.ensureActor(id, cs.records.get(id))
      out.changes.push({ op: 'actor.condition', id, condition: 'arrested' })
      ctx.arrested.add(id)
      note('arrested', '被抓走了。')
    }
  }
}
