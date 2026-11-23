// L6 功能 npcs：NPC 自己的日子與每區名單的變動（NPC_SYSTEM 第 9 節、3.2 節；dev/adr/0016 第六節；dev/work/M2-npc-life.md）。
//
// time.passed（順序 16）：每 3 天一次，跨過幾次補幾次，最多 10 次；用「id 加日子」的固定亂數（種子、人的 id、那個三天的日子），回退、重讀、中途存檔都一樣。
//   對象：名冊上的人（有人登記 in_roster 這種條件時用它問，沒有就略過這一類）、被關注的人、親密度 min_affinity 以上的人。
//   擲什麼（第 9 節那張表裡 M2 做得到的）：自己接了案（行者；錢與升一階）、受傷（3～7 天，狀況 injured，到期自己消掉）、被捕（狀況 arrested；
//   機率照他勢力的對頭的敵對值）、欠債（窮人；狀況 debt）、沉溺上升（到 80 以上狀況 near_sink）、換了義體（一項屬性 +1）。
//   不在這裡（等 M4 與事件的資料）：被挖走（名冊的忠誠）、有了一段關係、溺感邊緣之後的事件。
//   有變化的記一則近況（每人最多 6 則，丟最舊的）；有變化時交一份報告 npc.life（downtime），出事的帶 npc_life 的觸發點：{ npc, what }，what 是 injured、arrested、debt、near_sink（名單的變動另有 left、moved、died）。
// 同一個時間點每份已經建好的名單擲一次名單的變動（churn.ts）。
//
// 狀況 id 是核心共用的字彙，掛在那個人的 actor.conditions 上（還不是角色的先變成角色）。

import type { Actor, AttrId, Change, GameState, GameTime, Kernel, ReportDraft } from '../../core'
import { ATTR_IDS, DAILY_AT_MINUTE, MINUTES_PER_DAY, Rng, clone, countCrossings, crossings, fromMinutes, hash32, isRecord, isSafeInt, isValidTime, meterOf, toMinutes } from '../../core'
import type { LifeOut } from './churn'
import { churnTick, newChurn } from './churn'
import { LIFE_RULE_KIND, lifeRuleProblems, lifeRules } from './lifeRules'
import { registerMemory } from './memory'
import type { NewsItem, Npc, PathRow } from './model'
import { AFFINITY, OWNER, ensureNpcs, knows, npcOf, readNpcs } from './model'

const isText = (v: unknown): v is string => typeof v === 'string' && v.trim().length > 0
const own = (o: object, key: string): boolean => Object.hasOwn(o, key)

/** 每個人最多留幾則近況（第 9 節）。 */
export const NEWS_MAX = 6
/** 這幾種事會帶 npc_life 的觸發點（狀況的 id）。 */
export const TRIGGER_WHATS = ['injured', 'arrested', 'debt', 'near_sink'] as const

export interface LifeDeps {
  /** 把這個人變成角色要的變更（已經是角色的是空的；查不到丟錯） */
  actorOf(state: GameState, id: string): Change[]
  /** 把一筆資料變成角色（這次推演裡才新生成、還不在狀態裡的人用） */
  buildActor(npc: Npc): Actor
}

/** 這個人的近況（最舊的在前；複製）。 */
export const newsOf = (state: Pick<GameState, 'ext'>, id: string): NewsItem[] => clone(readNpcs(state).news?.[id] ?? [])

// ---- 對象 ----

const memberTest = (k: Kernel, state: GameState): ((id: string) => boolean) =>
  k.conditions.kinds().includes('in_roster')
    ? (id) => k.conditions.test({ kind: 'in_roster', who: id }, { state, stats: k.stats, timeRules: k.timeRules })
    : () => false

/**
 * 會過自己日子的人（照 id 排）：名冊上的人、被關注的人、親密度 min_affinity 以上的人。主角不算；查不到資料也不是角色的人略過。
 * 「名冊上的人」靠核心的條件 in_roster 問（名冊那個功能沒裝就是空的）。
 */
export function lifeSubjects(k: Kernel, state: GameState): string[] {
  const rules = lifeRules(k).life
  const ids = new Set<string>()
  const isMember = memberTest(k, state)
  for (const id of Object.keys(state.actors)) if (id !== state.pc && isMember(id)) ids.add(id)
  const s = readNpcs(state)
  for (const [id, r] of Object.entries(s.rel)) if (r.watch) ids.add(id)
  for (const id of new Set([...Object.keys(s.rel), ...Object.keys(state.meters?.[AFFINITY] ?? {})])) if (meterOf(k, state, AFFINITY, id) >= rules.min_affinity) ids.add(id)
  if (state.pc) ids.delete(state.pc)
  return [...ids].filter((id) => own(state.actors, id) || npcOf(k, state, id) !== undefined).sort()
}

// ---- 一個人在這次推演裡的樣子（每個三天接著上一個） ----

interface Sim {
  id: string
  name: string
  npc: Npc | undefined
  runner: boolean
  wealth: number
  faction: string | undefined
  sink: number
  paths: PathRow[]
  attrs: Record<AttrId, number> | undefined
  /** 傷到什麼時候（總分鐘數）；0 是沒有受傷、Infinity 是沒有期限 */
  injured: number
  arrested: boolean
  debt: boolean
  nearSink: boolean
}

function simOf(k: Kernel, state: GameState, id: string): Sim | null {
  const a: Actor | undefined = own(state.actors, id) ? state.actors[id] : undefined
  const n = npcOf(k, state, id)
  if (!a && !n) return null
  const paths: PathRow[] = n ? n.paths : Array.isArray(a?.ext.paths) ? clone(a!.ext.paths as PathRow[]) : []
  const has = (c: string): boolean => !!a && a.conditions.some((x) => x.id === c)
  const inj = a?.conditions.find((x) => x.id === 'injured')
  return {
    id, name: a?.name ?? n!.name, npc: n, runner: n ? n.kind === 'runner' : paths.length > 0, wealth: n?.wealth ?? 3, faction: n?.faction,
    sink: a ? a.sink : n!.sink, paths, attrs: clone(a?.attrs ?? n?.attrs), injured: inj ? (inj.until ?? Infinity) : 0,
    arrested: has('arrested'), debt: has('debt'), nearSink: has('near_sink'),
  }
}

/** 他勢力的對頭裡敵對值最高的那個（勢力的資料 rivals：勢力 id 的陣列；沒寫就是 0）。 */
function rivalHostility(k: Kernel, state: GameState, faction: string | undefined): number {
  if (faction === undefined) return 0
  const rivals = k.content.get('faction', faction)?.rivals
  if (!Array.isArray(rivals)) return 0
  return rivals.filter(isText).reduce((hi, r) => Math.max(hi, meterOf(k, state, 'hostility', r)), 0)
}

const mainTier = (paths: PathRow[]): number => paths.find((p) => p.slot === 'main')?.tier ?? 0

/** 這段時間裡 time.passed 要交的報告 npc.life（沒有變化是 null）。純函式，不改狀態。 */
export function lifeDraft(k: Kernel, state: GameState, from: GameTime, to: GameTime, deps: LifeDeps): ReportDraft | null {
  const rules = lifeRules(k)
  const L = rules.life
  const toM = toMinutes(to)
  const out: LifeOut = { changes: [], beats: [], triggers: [], lines: [] }
  const queued = new Set<string>()
  const ensureActor = (id: string, record?: Npc): void => {
    if (own(state.actors, id) || queued.has(id)) return
    out.changes.push(...(record ? [{ op: 'actor.add', actor: deps.buildActor(record) } as Change] : deps.actorOf(state, id)))
    queued.add(id)
  }

  // 受傷到期自己消掉（每一次時間往前走都看）
  const healed: string[] = []
  for (const a of Object.values(state.actors)) {
    if (a.id === state.pc) continue
    if (a.conditions.some((c) => c.id === 'injured' && c.until !== undefined && c.until <= toM)) {
      out.changes.push({ op: 'actor.condition', id: a.id, condition: 'injured', remove: true })
      healed.push(a.name)
    }
  }

  const every = L.every_days * MINUTES_PER_DAY
  const rule = { every, offset: DAILY_AT_MINUTE }
  // 一次最多補 max_catchup 次：只算最近的那幾個點（（to − 補的上限 × 週期, to］剛好有那麼多個）
  const start = Math.max(toMinutes(from), toM - L.max_catchup * every)
  const ticks = countCrossings(from, to, rule) > 0 ? crossings(fromMinutes(start), to, rule) : []

  if (ticks.length > 0) {
    const sims = lifeSubjects(k, state).map((id) => simOf(k, state, id)).filter((s): s is Sim => s !== null)
    const isMember = memberTest(k, state)
    const arrested = new Set(Object.values(state.actors).filter((a) => a.conditions.some((c) => c.id === 'arrested')).map((a) => a.id))
    for (const s of sims) if (s.arrested) arrested.add(s.id)
    const cs = newChurn(k, state)
    const seed = state.rng.seed

    for (const t of ticks) {
      const tm = toMinutes(t)
      const day = Math.floor(tm / MINUTES_PER_DAY) + 1
      for (const s of sims) {
        const rng = new Rng(hash32(seed, 'npcs/life', s.id, day))
        // 順序固定：每一項都先抽好，條件成不成立都不影響下一項
        const r = {
          job: rng.next(), cash: rng.int(L.job.cash[0], L.job.cash[1]), promote: rng.next(), injured: rng.next(), days: rng.int(L.injured.days[0], L.injured.days[1]),
          arrest: rng.next(), debt: rng.next(), sink: rng.next(), gain: rng.int(L.sink.gain[0], L.sink.gain[1]), implant: rng.next(), attr: rng.int(0, ATTR_IDS.length - 1),
        }
        const note = (what: string, text: string): void => {
          out.changes.push({ op: 'npcs.life.news', npc: s.id, at: t, what, text })
          out.beats.push({ layer: 'meat', actor: s.id, text: `${s.name}${text}`, tag: 'npc.life', data: { npc: s.id, what } })
          out.lines.push(`${s.name}${text}`)
          if ((TRIGGER_WHATS as readonly string[]).includes(what)) out.triggers.push({ point: 'npc_life', where: { npc: s.id, what } })
        }

        // 自己接了案：行者 40%；錢是階數越高越多；15% 升一階（主職最高到 max_tier）
        if (s.runner && r.job < L.job.chance) {
          const cash = r.cash * Math.max(1, mainTier(s.paths))
          const main = s.paths.find((p) => p.slot === 'main')
          if (main && main.tier < L.job.max_tier && r.promote < L.job.promote_chance) {
            main.tier += 1
            ensureActor(s.id)
            const paths = clone(s.paths)
            out.changes.push({ op: 'actor.ext', id: s.id, key: 'paths', value: paths })
            if (s.npc) out.changes.push({ op: 'npcs.patch', npc: s.id, patch: { paths } })
            note('job', `接了一件案，賺了 ${cash}，主職升到 ${main.tier} 階。`)
          } else note('job', `接了一件案，賺了 ${cash}。`)
        }
        // 受傷：10%，3～7 天
        if (r.injured < L.injured.chance && s.injured <= tm) {
          const until = tm + r.days * MINUTES_PER_DAY
          // 這段時間走完之前就好了的傷只留近況，不掛狀況（掛上去只會留著一個過期的）
          if (until > toM) {
            ensureActor(s.id)
            out.changes.push({ op: 'actor.condition', id: s.id, condition: 'injured', until })
          }
          s.injured = until
          note('injured', `受傷了，要養 ${r.days} 天。`)
        }
        // 被捕：基礎 2%，他勢力的對頭的敵對值每 20 點 +2%
        if (!s.arrested && !arrested.has(s.id)) {
          const p = L.arrest.base + L.arrest.per * Math.floor(rivalHostility(k, state, s.faction) / L.arrest.step)
          if (r.arrest < p) {
            ensureActor(s.id)
            out.changes.push({ op: 'actor.condition', id: s.id, condition: 'arrested' })
            s.arrested = true
            arrested.add(s.id)
            note('arrested', '被抓走了。')
          }
        }
        // 欠債：窮人 6%
        if (!s.debt && s.wealth <= L.debt.poor_max && r.debt < L.debt.chance) {
          ensureActor(s.id)
          out.changes.push({ op: 'actor.condition', id: s.id, condition: 'debt' })
          s.debt = true
          note('debt', '手頭很緊，欠了一筆債，可能會來找你借錢。')
        }
        // 沉溺上升：沉溺 40 以上 15%；到 80 以上「溺感邊緣」
        if (s.sink >= L.sink.min && r.sink < L.sink.chance) {
          const gain = Math.min(r.gain, L.sink.max - s.sink)
          if (gain > 0) {
            ensureActor(s.id)
            out.changes.push({ op: 'actor.track', id: s.id, track: 'sink', delta: gain })
            s.sink += gain
            if (s.sink >= L.sink.edge && !s.nearSink) {
              out.changes.push({ op: 'actor.condition', id: s.id, condition: 'near_sink' })
              s.nearSink = true
              note('near_sink', '沉得很深，到了溺感的邊緣。')
            } else note('sink', '沉溺又深了一點。')
          }
        }
        // 換了義體：一項屬性 +1，外貌也跟著變一點
        if (r.implant < L.implant.chance && s.attrs) {
          const attr = ATTR_IDS[r.attr]!
          if (s.attrs[attr] < L.implant.attr_max) {
            ensureActor(s.id)
            s.attrs[attr] += 1
            out.changes.push({ op: 'npcs.life.attr', npc: s.id, attr, delta: 1 })
            if (s.npc) {
              const implants = (typeof s.npc.look.implants === 'number' ? s.npc.look.implants : 0) + 1
              s.npc = { ...s.npc, attrs: { ...s.attrs }, look: { ...s.npc.look, implants } }
              out.changes.push({ op: 'npcs.patch', npc: s.id, patch: { attrs: { ...s.attrs }, look: { ...s.npc.look } } })
            }
            note('implant', '換了義體，整個人看起來有點不一樣。')
          }
        }
      }
      churnTick({ k, state, rules, out, isMember, ensureActor, arrested }, cs, day, t)
    }
    if (out.lines.length === 0 && cs.quiet > 0) out.lines.push(`這幾天名單有 ${cs.quiet} 處變動。`)
  }

  if (healed.length > 0) out.lines.push(...healed.map((n) => `${n}的傷養好了。`))
  if (out.changes.length === 0) return null
  const summary = out.lines.length > 0 ? out.lines.join('') : '城裡的人又過了幾天。'
  return {
    kind: 'downtime', action: 'npc.life', location: clone(state.location), ...(state.pc ? { actor: state.pc } : {}), party: [],
    timeline: out.beats.length > 0 ? out.beats : [{ layer: 'meat', text: summary, tag: 'npc.life' }],
    changes: out.changes, outcome: { result: 'life', summary },
    ...(out.triggers.length > 0 ? { triggers: out.triggers } : {}),
  }
}

// ---- 變更 ----

function registerLifeChanges(k: Kernel): void {
  const text = (v: unknown, what: string): string[] => (isText(v) ? [] : [`${what} 要是 id`])

  // 搬來一個人：新生成的人放進這一區的名單
  k.changes.register<Change & { district: string; npc: Npc; seq: number }>({
    op: 'npcs.life.join', owner: OWNER,
    validate: (state, c) => [
      ...text(c.district, 'district'),
      ...(isRecord(c.npc) && isText(c.npc.id) && !own(readNpcs(state).gen, c.npc.id) ? [] : ['npc 要是新的生成的人']),
      ...(isRecord(c.npc) && isSafeInt(c.npc.age) && c.npc.age >= 18 ? [] : ['所有 NPC 都是成年人：age 要 18 以上']),
      ...(isSafeInt(c.seq) && c.seq >= 0 ? [] : ['seq 要是 0 以上的整數']),
    ],
    apply(state, c) {
      const s = ensureNpcs(state)
      s.gen[c.npc.id] = clone(c.npc)
      const r = (s.rosters[c.district] ??= { built: false, ids: [] })
      if (!r.ids.includes(c.npc.id)) r.ids.push(c.npc.id)
      s.seq[c.district] = Math.max(s.seq[c.district] ?? 0, c.seq)
    },
  })

  // 搬走或死了：離開這一區的名單；沒有關係、不是角色的生成的人整筆丟掉；死了的在資料上記 dead
  k.changes.register<Change & { npc: string; district: string; why: 'left' | 'died'; drop: boolean }>({
    op: 'npcs.life.leave', owner: OWNER,
    validate: (state, c) => [
      ...text(c.npc, 'npc'), ...text(c.district, 'district'),
      ...(c.why === 'left' || c.why === 'died' ? [] : ['why 要是 left 或 died']),
      ...(typeof c.drop === 'boolean' ? [] : ['drop 要是 true 或 false']),
      ...(isText(c.npc) && !npcOf(k, state, c.npc) ? [`查不到 ${c.npc} 這個人`] : []),
      ...(c.drop === true && isText(c.npc) && (!own(readNpcs(state).gen, c.npc) || knows(state, c.npc) || own(state.actors, c.npc)) ? [`${String(c.npc)} 有關係條目或已經是角色，不能整筆丟掉`] : []),
    ],
    apply(state, c) {
      const s = ensureNpcs(state)
      const cur = npcOf(k, state, c.npc)
      if (s.rosters[c.district]) s.rosters[c.district]!.ids = s.rosters[c.district]!.ids.filter((x) => x !== c.npc)
      if (c.drop) {
        delete s.gen[c.npc]
        for (const r of Object.values(s.rosters)) r.ids = r.ids.filter((x) => x !== c.npc)
      } else if (c.why === 'died' && cur) {
        const flags = [...cur.flags.filter((f) => f !== 'dead'), 'dead']
        if (own(s.gen, c.npc)) s.gen[c.npc] = { ...s.gen[c.npc]!, flags }
        else s.over[c.npc] = { ...(s.over[c.npc] ?? {}), flags }
      }
    },
  })

  // 搬去另一區：換名單、住處改成那一區
  k.changes.register<Change & { npc: string; from: string; to: string }>({
    op: 'npcs.life.move', owner: OWNER,
    validate: (state, c) => [
      ...text(c.npc, 'npc'), ...text(c.from, 'from'), ...text(c.to, 'to'),
      ...(c.from === c.to ? ['from 與 to 不能是同一區'] : []),
      ...(isText(c.npc) && !npcOf(k, state, c.npc) ? [`查不到 ${c.npc} 這個人`] : []),
    ],
    apply(state, c) {
      const s = ensureNpcs(state)
      const cur = npcOf(k, state, c.npc)!
      if (s.rosters[c.from]) s.rosters[c.from]!.ids = s.rosters[c.from]!.ids.filter((x) => x !== c.npc)
      const r = (s.rosters[c.to] ??= { built: false, ids: [] })
      if (!r.ids.includes(c.npc)) r.ids.push(c.npc)
      const block = cur.haunts.find((h) => h.district === c.to && h.block !== undefined)?.block
      const home = { district: c.to, ...(block !== undefined ? { block } : {}) }
      if (own(s.gen, c.npc)) s.gen[c.npc] = { ...s.gen[c.npc]!, home }
      else s.over[c.npc] = { ...(s.over[c.npc] ?? {}), home }
    },
  })

  // 一則近況：每個人最多 NEWS_MAX 則，超過的丟最舊的
  k.changes.register<Change & { npc: string; at: GameTime; what: string; text: string }>({
    op: 'npcs.life.news', owner: OWNER,
    validate: (_s, c) => [...text(c.npc, 'npc'), ...(isValidTime(c.at) ? [] : ['at 要是時間']), ...text(c.what, 'what'), ...(isText(c.text) && c.text.length <= 200 ? [] : ['text 要是 200 字以內的字串'])],
    apply(state, c) {
      const s = ensureNpcs(state)
      const all = (s.news ??= {})
      const list = (all[c.npc] ??= [])
      list.push({ at: clone(c.at), what: c.what, text: c.text })
      while (list.length > NEWS_MAX) list.shift()
    },
  })

  // 換了義體：角色身上的一項屬性（資料上的屬性由 npcs.patch 另外改）
  k.changes.register<Change & { npc: string; attr: AttrId; delta: number }>({
    op: 'npcs.life.attr', owner: OWNER,
    validate: (state, c) => [
      ...(isText(c.npc) && own(state.actors, c.npc) ? [] : [`${String(c.npc)} 還不是角色`]),
      ...((ATTR_IDS as readonly unknown[]).includes(c.attr) ? [] : [`attr 要是 ${ATTR_IDS.join('、')}`]),
      ...(isSafeInt(c.delta) ? [] : ['delta 要是整數']),
    ],
    apply(state, c) {
      const a = state.actors[c.npc]!
      a.attrs[c.attr] = Math.max(1, a.attrs[c.attr] + c.delta)
    },
  })
}

// ---- 安裝 ----

export function installLife(k: Kernel, deps: LifeDeps): void {
  k.content.defineKind({ kind: LIFE_RULE_KIND, owner: OWNER, overridable: true, validate: lifeRuleProblems })
  registerLifeChanges(k)
  registerMemory(k)
  k.hooks.on('time.passed', OWNER, ({ state, from, to }) => {
    const draft = lifeDraft(k, state, from, to, deps)
    return draft ? [draft] : undefined
  }, 16)
}
