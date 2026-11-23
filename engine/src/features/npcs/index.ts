// L6 功能：NPC 與關係（NPC_SYSTEM 第 1、2 節、3.1～3.3、4.1、4.4～4.7、第 5 節、第 7 節、第 12 節；DATA 第 8 節；dev/adr/0016 第三、七節；dev/work/M2-npcs.md）。
//
// 三種人：固定 NPC（內容 npc；存檔只記變動）、生成 NPC（每區一份名單，第一次走進一區時建立）、臨時 NPC（事件的路人；有了關係條目就升格進名單）。
// 主角和每個認識的人有一個關係條目（meet 之後才有）；親密度是量表 affinity，條目記已知的事、見面的時間、關注與一句話。
// 互動選單（M2-npc-interact）、共同記憶與名單的變動（M2-npc-life）、名冊（M2-roster）不在這裡。
//
// 接上核心的地方：
//   內容  npc（核心的種類，載入之後 ready 補查新欄位：kind、guard、wealth、haunts、paths……；只有 id 與名字的舊 id 表照收）、
//         npc_gen（每區一筆：人數、職業與勢力的權重、名字池、出沒表模板）、name_pool（名字池）、npc_rule（id: default，蓋掉內建的規則數字）
//   量表  affinity（−100～100、照人、AI 一件事最多 ±8）；同名的效果與條件核心自動有
//   效果  meet（{ npc }：建立關係條目，必要時把人放進 state.actors；臨時角色在這時升格）、npc_known（{ npc, fact }：把一件事記進已知的事，同一件不重複）
//   條件  knows（{ npc? }）、affinity_stage（{ npc?, min?, max? }，段寫 id 或第幾段）
//   變更  npcs.roster、npcs.gen、npcs.drop、npcs.promote、npcs.sweep、npcs.meet、npcs.known、npcs.watch、npcs.relation、npcs.patch（形狀見各自的註解）
//   掛鉤  report.before（報告的位置換到還沒有名單的一區，就建那一區的名單）、director.cast（指定的固定 NPC、主角認識的人、照當下的區新生成的人）、
//         activity.end（事件結束：臨時角色有條目的升格，沒有的清掉）
//   狀態  state.ext.npcs：{ gen, rosters, seq, rel, over }（形狀見 model.ts）
// 報告：npc.meet、npc.watch（kind 都是 social）。

import type { Actor, Change, Condition, ConditionCtx, Effect, Feature, GameState, Kernel, ReportDraft } from '../../core'
import { ActionBlocked, ContentError, Rng, clone, hash32, isRecord, isSafeInt, isValidTime, meterOf } from '../../core'
import { generateNpc, planRoster, takenNames } from './generate'
import type { Npc, NpcKind, PathRow } from './model'
import {
  AFFINITY, AXES, GEN_KIND, NPC_KIND, NPC_KINDS, OWNER, POOL_KIND, RULE_KIND, TEMP_FLAG,
  affinityStage, ensureNpcs, genProblems, isTemp, knowFactText, knows, npcOf, npcRules, npcsProblems, parseFact, poolProblems, readNpcs, relationOf, ruleProblems, stageIndex, STAGES,
} from './model'

export { genEntryOf, genId, generateNpc, planRoster } from './generate'
export type { GenOpts } from './generate'
export {
  ABSENT_CONDITIONS, AFFINITY, AXES, BODIES, BRIDGE_PARAMS, DEFAULT_NPC_RULES, GENDERS, GENDER_TAG, KIND_NAME, NPC_KINDS, STAGES, TAG_STATES, TEMP_FLAG,
  affinityStage, hauntMatches, knownFacts, knows, normalizeHaunt, npcEntryProblems, npcOf, npcRules, npcsHere, npcsProblems, parseFact, readNpcs, relationOf, rosterIds, stageIndex, whereIs,
} from './model'
export type { Axis, BridgeParam, Gender, GenEntry, Haunt, KnownFact, Look, Npc, NpcEntry, NpcKind, NpcRules, NpcsState, PathRow, PoolEntry, Relation, RosterEntry, StageDef, StageView, TagState, Tendencies } from './model'

const isText = (v: unknown): v is string => typeof v === 'string' && v.trim().length > 0
const own = (o: object, key: string): boolean => Object.hasOwn(o, key)

// ---- 變成角色 ----

/** 把一個人變成角色（Actor）：屬性、基本功、橋參數、傾向、路數（只有行者）。 */
export function buildActor(k: Pick<Kernel, 'content'>, n: Npc): Actor {
  const rules = npcRules(k)
  return {
    id: n.id, name: n.name, role: 'npc', age: n.age, ...(n.gender !== undefined ? { gender: n.gender } : {}),
    attrs: { ...n.attrs }, skills: { ...n.skills }, perks: [],
    hp: rules.stats.hp_base + n.attrs.body * 2, load: 0, afterglow: 0, sink: n.sink, conditions: [],
    ext: {
      bridge: n.bridge ? { ...n.bridge } : null,
      tendency: { axes: { ...n.tendencies.axes }, points: Object.fromEntries(AXES.map((a) => [a, 0])), tags: { ...n.tendencies.tags } },
      ...(n.paths.length > 0 ? { paths: clone(n.paths) as PathRow[] } : {}),
    },
  }
}

/**
 * 把這個人放進 state.actors 要的變更（屬性、基本功、ext.bridge、ext.tendency、ext.paths）；已經是角色的回傳空的。
 * 查不到這個人（不是固定的、也不是生成的）丟錯：那是呼叫的人的錯。
 */
export function actorOf(k: Pick<Kernel, 'content'>, state: Pick<GameState, 'actors' | 'ext'>, id: string): Change[] {
  if (own(state.actors, id)) return []
  const n = npcOf(k, state, id)
  if (!n) throw new Error(`查不到 ${id} 這個人（不是固定的、也不是生成的），沒辦法把他變成角色。`)
  return [{ op: 'actor.add', actor: buildActor(k, n) }]
}

// ---- 關係與升格 ----

const placeOf = (state: Pick<GameState, 'location'>): { district?: string; block?: string } => ({
  ...(state.location.district !== undefined ? { district: state.location.district } : {}), ...(state.location.block !== undefined ? { block: state.location.block } : {}),
})

/** 臨時角色沒有資料時，照他現在這一區補一筆（名字與年齡沿用角色；其餘照生成的規則）。 */
function adoptNpc(k: Kernel, state: GameState, a: Actor): Npc {
  const district = state.location.district ?? ''
  const base = generateNpc(k, state, district, `adopt:${a.id}`, { id: a.id, name: a.name, taken: takenNames(k, state) })
  const n: Npc = base ?? {
    id: a.id, name: a.name, kind: 'citizen', source: 'gen', age: a.age, guard: 13, wealth: 1, home: { district }, haunts: [{ district }],
    persona: { attrs: [], quadrants: [] }, tendencies: { axes: { relation: 0, sense: 0, body: 0, costume: 0 }, tags: {} }, bridge: null, sink: 0, paths: [], flags: [],
    attrs: { ...a.attrs }, skills: {}, look: {},
  }
  return { ...n, age: a.age }
}

/** 升格：臨時角色進他那一區的名單、拿掉臨時的記號。 */
export function promote(state: Pick<GameState, 'actors' | 'ext'>, id: string): Change[] {
  return [{ op: 'npcs.promote', npc: id }, ...(isTemp(state, id) ? [{ op: 'actor.ext', id, key: TEMP_FLAG, value: null } as Change] : [])]
}

/** 這個人現在能不能「認識」：查得到資料，或是沒有資料的臨時角色（而且主角站在某一區）。回傳原因，可以就是 null。 */
function cannotMeet(k: Kernel, state: GameState, id: string): string | null {
  if (id === state.pc) return '主角不用認識自己。'
  if (npcOf(k, state, id)) return null
  if (isTemp(state, id)) return state.location.district ? null : '你現在不在任何一區，沒辦法把這個路人留在名單上。'
  return `查不到 ${id} 這個人。`
}

/** 認識一個人要套的變更：必要時變成角色、建關係條目（已經認識的只更新最後一次見面）、臨時角色升格。 */
export function meetChanges(k: Kernel, state: GameState, id: string): Change[] {
  const out: Change[] = []
  let rec = npcOf(k, state, id)
  if (!rec) {
    rec = adoptNpc(k, state, state.actors[id]!)
    out.push({ op: 'npcs.gen', npc: rec })
  }
  if (!own(state.actors, id)) out.push({ op: 'actor.add', actor: buildActor(k, rec) })
  out.push({ op: 'npcs.meet', npc: id, time: clone(state.time), at: placeOf(state) })
  if (isTemp(state, id)) out.push(...promote(state, id))
  return out
}

const nameOf = (k: Kernel, state: GameState, id: string): string => state.actors[id]?.name ?? npcOf(k, state, id)?.name ?? id

const draft = (state: GameState, action: string, text: string, changes: Change[], result: string): ReportDraft => ({
  kind: 'social', action, location: clone(state.location), ...(state.pc ? { actor: state.pc } : {}), party: [],
  timeline: [{ layer: 'meat', text, tag: action }], changes, outcome: { result, summary: text },
})

/** 認識（或又見到）一個人。報告 npc.meet。不成立丟 ActionBlocked，原因寫成一句話。 */
export function meetNpc(k: Kernel, state: GameState, id: string): ReportDraft {
  const why = cannotMeet(k, state, id)
  if (why) throw new ActionBlocked(why)
  const again = knows(state, id)
  const name = nameOf(k, state, id)
  const text = again ? `又見到了${name}。` : `認識了${name}。`
  return draft(state, 'npc.meet', text, meetChanges(k, state, id), again ? 'seen' : 'met')
}

/** 關注（或取消關注）一個認識的人：被關注的人會自己過日子（NPC_SYSTEM 第 9 節）。報告 npc.watch。 */
export function watchNpc(k: Kernel, state: GameState, id: string, on = true): ReportDraft {
  if (!knows(state, id)) throw new ActionBlocked('你還不認識這個人，沒辦法關注他。')
  const name = nameOf(k, state, id)
  const text = on ? `開始關注${name}。` : `不再關注${name}。`
  return draft(state, 'npc.watch', text, [{ op: 'npcs.watch', npc: id, on }], on ? 'watch' : 'unwatch')
}

/** 主角現在對這個人的親密度（量表 affinity）。 */
export const affinityOf = (k: Pick<Kernel, 'meters'>, state: GameState, id: string): number => meterOf(k, state, AFFINITY, id)

/** 親密度的階段（還不認識的人是 null：沒有條目就沒有階段）。 */
export function stageNow(k: Pick<Kernel, 'meters'>, state: GameState, id: string) {
  return knows(state, id) ? affinityStage(affinityOf(k, state, id)) : null
}

// ---- 變更的格式 ----

function recordProblems(n: unknown): string[] {
  if (!isRecord(n)) return ['npc 要是一筆資料']
  const p: string[] = []
  if (!isText(n.id)) p.push('npc.id 要是 id')
  if (!isText(n.name)) p.push('npc.name 要有名字')
  if (!(NPC_KINDS as readonly unknown[]).includes(n.kind)) p.push(`npc.kind 要是 ${NPC_KINDS.join('、')}`)
  if (!isSafeInt(n.age)) p.push('npc.age 要是整數')
  else if (n.age < 18) p.push(`所有 NPC 都是成年人：age 要 18 以上（拿到 ${n.age}）`)
  if (!isRecord(n.home) || typeof n.home.district !== 'string') p.push('npc.home 要是 { district }')
  if (!Array.isArray(n.haunts) || !Array.isArray(n.paths) || !Array.isArray(n.flags)) p.push('npc 的 haunts、paths、flags 要是陣列')
  if (!isRecord(n.tendencies) || !isRecord(n.attrs) || !isRecord(n.skills) || !isRecord(n.persona)) p.push('npc 的 tendencies、attrs、skills、persona 要是物件')
  return p
}

const PATCHABLE = ['name', 'nick', 'age', 'gender', 'body', 'faction', 'occupation', 'guard', 'wealth', 'home', 'haunts', 'persona', 'tendencies', 'bridge', 'sink', 'paths', 'flags', 'attrs', 'skills', 'look'] as const

function addToRoster(s: ReturnType<typeof ensureNpcs>, id: string, district: string | undefined): void {
  if (!district) return
  const r = (s.rosters[district] ??= { built: false, ids: [] })
  if (!r.ids.includes(id)) r.ids.push(id)
}

function registerChanges(k: Kernel): void {
  const text = (v: unknown, what: string): string[] => (isText(v) ? [] : [`${what} 要是 id`])
  const needKnown = (state: GameState, id: unknown): string[] => (isText(id) && knows(state, id) ? [] : [`還不認識 ${String(id)}：要先 meet`])

  // 一區的名單建好：ids 是名單（固定的在前），gen 是這次新生成的人（整筆）
  k.changes.register<Change & { district: string; ids: string[]; gen: Npc[]; seq: number }>({
    op: 'npcs.roster', owner: OWNER,
    validate: (state, c) => [
      ...text(c.district, 'district'),
      ...(Array.isArray(c.ids) && c.ids.every(isText) && new Set(c.ids).size === c.ids.length ? [] : ['ids 要是不重複的 id 陣列']),
      ...(Array.isArray(c.gen) ? c.gen.flatMap((n, i) => [...recordProblems(n).map((m) => `gen[${i}]：${m}`), ...(isRecord(n) && isText(n.id) && own(readNpcs(state).gen, n.id) ? [`gen[${i}]：${n.id} 已經有了`] : [])]) : ['gen 要是陣列']),
      ...(isSafeInt(c.seq) && c.seq >= 0 ? [] : ['seq 要是 0 以上的整數']),
      ...(isText(c.district) && readNpcs(state).rosters[c.district]?.built === true ? [`${c.district} 的名單已經建好了`] : []),
    ],
    apply(state, c) {
      const s = ensureNpcs(state)
      for (const n of c.gen) s.gen[n.id] = clone(n)
      s.rosters[c.district] = { built: true, ids: [...c.ids] }
      s.seq[c.district] = Math.max(s.seq[c.district] ?? 0, c.seq)
    },
  })
  // 存一筆生成的人（臨時生成的、臨時角色補的資料）；不進名單
  k.changes.register<Change & { npc: Npc }>({
    op: 'npcs.gen', owner: OWNER,
    validate: (state, c) => [...recordProblems(c.npc), ...(isRecord(c.npc) && isText(c.npc.id) && own(readNpcs(state).gen, c.npc.id) ? [`${c.npc.id} 已經有了`] : [])],
    apply(state, c) { ensureNpcs(state).gen[c.npc.id] = clone(c.npc) },
  })
  // 把沒有關係的生成人整筆拿掉（資料與名單）；有條目的不能丟
  k.changes.register<Change & { npc: string }>({
    op: 'npcs.drop', owner: OWNER,
    validate: (state, c) => [...text(c.npc, 'npc'), ...(isText(c.npc) && !own(readNpcs(state).gen, c.npc) ? [`${c.npc} 不是生成的人`] : []), ...(isText(c.npc) && knows(state, c.npc) ? [`${c.npc} 已經有關係條目，不能丟`] : [])],
    apply(state, c) {
      const s = ensureNpcs(state)
      delete s.gen[c.npc]
      for (const r of Object.values(s.rosters)) r.ids = r.ids.filter((x) => x !== c.npc)
    },
  })
  // 升格：進他那一區的名單（名單還沒建就先記下，建的時候併進去）
  k.changes.register<Change & { npc: string }>({
    op: 'npcs.promote', owner: OWNER,
    validate: (state, c) => [...text(c.npc, 'npc'), ...(isText(c.npc) && !own(readNpcs(state).gen, c.npc) && !k.content.has(NPC_KIND, c.npc) ? [`查不到 ${c.npc} 這個人`] : [])],
    apply(state, c) {
      const s = ensureNpcs(state)
      const district = own(s.gen, c.npc) ? s.gen[c.npc]!.home.district : npcOf(k, state, c.npc)?.home.district
      addToRoster(s, c.npc, district)
    },
  })
  // 事件結束時整理臨時角色（照套用到這裡的狀態：有條目的升格，沒有的清掉；隊上的不動）
  k.changes.register<Change>({
    op: 'npcs.sweep', owner: OWNER,
    validate: () => [],
    apply(state) {
      const s = ensureNpcs(state)
      for (const a of Object.values(state.actors)) {
        if (a.ext[TEMP_FLAG] !== true || a.id === state.pc || state.party.includes(a.id)) continue
        if (own(s.rel, a.id)) {
          delete a.ext[TEMP_FLAG]
          addToRoster(s, a.id, s.gen[a.id]?.home.district)
        } else {
          delete state.actors[a.id]
          delete s.gen[a.id]
          for (const r of Object.values(s.rosters)) r.ids = r.ids.filter((x) => x !== a.id)
        }
      }
    },
  })
  // 建立關係條目；已經有的只更新最後一次見面
  k.changes.register<Change & { npc: string; time: GameState['time']; at?: { district?: string; block?: string } }>({
    op: 'npcs.meet', owner: OWNER,
    validate: (state, c) => [
      ...text(c.npc, 'npc'), ...(isValidTime(c.time) ? [] : ['time 要是時間']),
      ...(isText(c.npc) && !npcOf(k, state, c.npc) ? [`查不到 ${c.npc} 這個人`] : []),
      ...(isText(c.npc) && c.npc === state.pc ? ['主角不用認識自己'] : []),
    ],
    apply(state, c) {
      const s = ensureNpcs(state)
      const cur = s.rel[c.npc]
      if (cur) cur.last = clone(c.time)
      else s.rel[c.npc] = { first: clone(c.time), last: clone(c.time), ...(c.at ? { at: clone(c.at) } : {}), known: [], watch: false, relation: '' }
    },
  })
  // 已知的事：同一件不重複
  k.changes.register<Change & { npc: string; fact: string }>({
    op: 'npcs.known', owner: OWNER,
    validate: (state, c) => [...needKnown(state, c.npc), ...(parseFact(c.fact) ? [] : ['fact 要是 tendency:<標籤>、bridge、contract 或 secret:<關鍵字>'])],
    apply(state, c) {
      const r = ensureNpcs(state).rel[c.npc]!
      if (!r.known.includes(c.fact)) r.known.push(c.fact)
    },
  })
  k.changes.register<Change & { npc: string; on: boolean }>({
    op: 'npcs.watch', owner: OWNER,
    validate: (state, c) => [...needKnown(state, c.npc), ...(typeof c.on === 'boolean' ? [] : ['on 要是 true 或 false'])],
    apply(state, c) { ensureNpcs(state).rel[c.npc]!.watch = c.on },
  })
  // 與主角的關係（一句話；AI 提議、玩家確認或改寫）
  k.changes.register<Change & { npc: string; text: string }>({
    op: 'npcs.relation', owner: OWNER,
    validate: (state, c) => [...needKnown(state, c.npc), ...(typeof c.text === 'string' && c.text.length <= 200 ? [] : ['text 要是 200 字以內的字串'])],
    apply(state, c) { ensureNpcs(state).rel[c.npc]!.relation = c.text },
  })
  // 固定 NPC 的變動（淺層蓋掉內容的欄位）；生成的人直接改那一筆
  k.changes.register<Change & { npc: string; patch: Record<string, unknown> }>({
    op: 'npcs.patch', owner: OWNER,
    validate: (state, c) => [
      ...(isText(c.npc) && !npcOf(k, state, c.npc) ? [`查不到 ${String(c.npc)} 這個人`] : []),
      ...(isRecord(c.patch) ? Object.keys(c.patch).filter((f) => !(PATCHABLE as readonly string[]).includes(f)).map((f) => `patch.${f}：這一欄不能改（可以改的：${PATCHABLE.join('、')}）`) : ['patch 要是物件']),
      ...(isRecord(c.patch) && c.patch.age !== undefined && !(isSafeInt(c.patch.age) && c.patch.age >= 18) ? ['patch.age 要是 18 以上的整數：所有 NPC 都是成年人'] : []),
    ],
    apply(state, c) {
      const s = ensureNpcs(state)
      if (own(s.gen, c.npc)) s.gen[c.npc] = { ...s.gen[c.npc]!, ...clone(c.patch) } as Npc
      else s.over[c.npc] = { ...(s.over[c.npc] ?? {}), ...clone(c.patch) } as Partial<Npc>
    },
  })
}

// ---- 登場角色（director.cast） ----

/** 內容裡住在這一區的固定 NPC（照 id 排，名單與名額用）。 */
export function fixedHomed(k: Kernel, state: GameState, district: string): Npc[] {
  return k.content.list(NPC_KIND)
    .map((e) => npcOf(k, state, e.id)!)
    .filter((n) => n.home.district === district)
    .sort((a, b) => (a.id < b.id ? -1 : 1))
}

const castOf = (k: Kernel, state: GameState, id: string): { actor: string; changes?: Change[] } => {
  const changes = actorOf(k, state, id)
  return changes.length > 0 ? { actor: id, changes } : { actor: id }
}

function castKnown(k: Kernel, state: GameState, event: string, role: string, spec: Record<string, unknown>): { actor: string; changes?: Change[] } | undefined {
  const minStage = spec.stage === undefined ? 0 : (stageIndex(spec.stage) ?? 0)
  const kinds = spec.kind === undefined ? null : (Array.isArray(spec.kind) ? spec.kind : [spec.kind])
  const requires = spec.requires === undefined ? [] : (Array.isArray(spec.requires) ? spec.requires : [spec.requires])
  const ok: string[] = []
  for (const id of Object.keys(readNpcs(state).rel).sort()) {
    const n = npcOf(k, state, id)
    if (!n || id === state.pc) continue
    if (kinds && !kinds.includes(n.kind)) continue
    if (spec.district !== undefined && n.home.district !== spec.district) continue
    if (spec.faction !== undefined && n.faction !== spec.faction) continue
    if (affinityStage(meterOf(k, state, AFFINITY, id)).index < minStage) continue
    // 其餘的條件照每個候選人各測一次（ctx.actor 是候選人）
    const ctx = { state, stats: k.stats, timeRules: k.timeRules, actor: id }
    if (!requires.every((c) => isRecord(c) && k.conditions.test(c as Condition, ctx))) continue
    ok.push(id)
  }
  if (ok.length === 0) return undefined
  const id = new Rng(hash32(state.rng.seed, 'npcs/cast', event, role, state.time.day)).pick(ok)
  return castOf(k, state, id)
}

function castGen(k: Kernel, state: GameState, event: string, role: string, spec: Record<string, unknown>): { actor: string; changes?: Change[] } | undefined {
  const district = typeof spec.district === 'string' ? spec.district : state.location.district
  if (!district) return undefined
  const uid = state.seq.uid + 1
  const id = `tmp_${uid}_${role}`
  const kind: NpcKind = (NPC_KINDS as readonly unknown[]).includes(spec.kind) ? (spec.kind as NpcKind) : 'citizen'
  const n = generateNpc(k, state, district, `tmp:${event}:${role}:${uid}`, {
    id, kind, taken: takenNames(k, state),
    ...(typeof spec.faction === 'string' ? { faction: spec.faction } : {}), ...(isText(spec.name) ? { name: spec.name } : {}),
  })
  if (!n) return undefined
  const a = buildActor(k, n)
  a.ext[TEMP_FLAG] = true
  return { actor: id, changes: [{ op: 'npcs.gen', npc: n }, { op: 'actor.add', actor: a }] }
}

// ---- 功能 ----

export const npcsFeature: Feature = {
  id: OWNER,
  install(k: Kernel) {
    k.content.defineKind({ kind: GEN_KIND, owner: OWNER, validate: genProblems })
    k.content.defineKind({ kind: POOL_KIND, owner: OWNER, validate: poolProblems })
    k.content.defineKind({ kind: RULE_KIND, owner: OWNER, validate: ruleProblems })

    // ---- 量表：個人的親密度（NPC_SYSTEM 第 7 節；效果與條件核心自動有，key 是人的 id） ----
    k.meters.define({ kind: AFFINITY, owner: OWNER, name: '親密度', min: -100, max: 100, start: 0, keyed: 'npc', cap: { down: 8, up: 8 } })

    registerChanges(k)

    // ---- 效果 ----
    interface MeetEffect extends Effect { npc: string }
    k.effects.register<MeetEffect>({
      kind: 'meet', owner: OWNER,
      validate: (raw) => (isText(raw.npc) ? [] : ['npc 要是人的 id']),
      clamp(e, ctx) {
        const why = cannotMeet(k, ctx.state, e.npc)
        return why ? { effect: null, note: { from: e.npc, to: null, limit: 'meet', notice: `${why}沒有算認識。` } } : { effect: e }
      },
      toChanges: (e, ctx) => meetChanges(k, ctx.state, e.npc),
      describe: (e, ctx) => (knows(ctx.state, e.npc) ? `又見到了：${nameOf(k, ctx.state, e.npc)}` : `認識了：${nameOf(k, ctx.state, e.npc)}`),
    })
    interface KnownEffect extends Effect { npc: string; fact: string }
    k.effects.register<KnownEffect>({
      kind: 'npc_known', owner: OWNER,
      validate: (raw) => [...(isText(raw.npc) ? [] : ['npc 要是人的 id']), ...(parseFact(raw.fact) ? [] : ['fact 要是 tendency:<標籤>、bridge、contract 或 secret:<關鍵字>'])],
      clamp(e, ctx) {
        if (!knows(ctx.state, e.npc)) return { effect: null, note: { from: e.fact, to: null, limit: 'npc_known', notice: '你還不認識這個人，這件事沒有記下來。' } }
        // 同一件不重複：已經記過的整筆拿掉，不提醒
        return relationOf(ctx.state, e.npc)!.known.includes(e.fact) ? { effect: null } : { effect: e }
      },
      toChanges: (e): Change[] => [{ op: 'npcs.known', npc: e.npc, fact: e.fact }],
      describe(e, ctx) {
        const tagName = (t: string): string => String(k.content.get('tendency_tag', t)?.name ?? t)
        return `記下了：${nameOf(k, ctx.state, e.npc)}${knowFactText(e.fact, tagName)}`
      },
    })

    // ---- 條件 ----
    const whose = (c: { npc?: unknown }, ctx: ConditionCtx): string => (typeof c.npc === 'string' ? c.npc : (ctx.actor ?? ''))
    k.conditions.register<Condition & { npc?: string }>({
      kind: 'knows', owner: OWNER,
      validate: (raw) => (raw.npc === undefined || isText(raw.npc) ? [] : ['npc 要是人的 id']),
      test: (c, ctx) => knows(ctx.state, whose(c, ctx)),
    })
    k.conditions.register<Condition & { npc?: string; min?: string | number; max?: string | number }>({
      kind: 'affinity_stage', owner: OWNER,
      validate: (raw) => [
        ...(raw.npc === undefined || isText(raw.npc) ? [] : ['npc 要是人的 id']),
        ...(['min', 'max'] as const).filter((f) => raw[f] !== undefined && stageIndex(raw[f]) === null).map((f) => `${f} 要寫段的 id（${STAGES.map((s) => s.id).join('、')}）或第幾段（0～${STAGES.length - 1}）`),
        ...(raw.min === undefined && raw.max === undefined ? ['要寫 min 或 max'] : []),
      ],
      // 還不認識的人沒有條目，也就沒有階段：不成立
      test(c, ctx) {
        const id = whose(c, ctx)
        if (!id || !knows(ctx.state, id)) return false
        const at = affinityStage(meterOf(k, ctx.state, AFFINITY, id)).index
        return at >= (c.min === undefined ? 0 : (stageIndex(c.min) ?? 0)) && at <= (c.max === undefined ? STAGES.length - 1 : (stageIndex(c.max) ?? STAGES.length - 1))
      },
    })

    // ---- 第一次走進一區就建那一區的名單：報告走到哪一區（location 變更的最後一筆，沒有就是現在的位置）----
    k.hooks.on('report.before', OWNER, ({ state, draft: d }) => {
      let district = state.location.district
      for (const c of d.changes) if (c.op === 'location' && isRecord(c.to) && typeof c.to.district === 'string') district = c.to.district
      if (!district || readNpcs(state).rosters[district]?.built) return
      const change = planRoster(k, state, district, fixedHomed(k, state, district))
      return change ? [change] : undefined
    })

    // ---- 事件結束：臨時角色有條目的升格、沒有的清掉。要等這一份報告的變更都套上去才知道有沒有條目（結局的效果可能正好 meet），所以是一筆照套用時的狀態整理的變更 ----
    k.hooks.on('activity.end', OWNER, ({ state, kind }) => {
      if (kind !== 'event') return
      return Object.values(state.actors).some((a) => a.ext[TEMP_FLAG] === true) ? { changes: [{ op: 'npcs.sweep' }] } : undefined
    })

    // ---- 登場角色：指定的固定 NPC、主角認識的人（照條件挑）、照當下的區新生成的人 ----
    k.hooks.on('director.cast', OWNER, ({ state, event, role, spec }) => {
      if (typeof spec.npc === 'string') return npcOf(k, state, spec.npc) && spec.npc !== state.pc ? castOf(k, state, spec.npc) : undefined
      if (isRecord(spec.known)) return castKnown(k, state, event, role, spec.known)
      if (isRecord(spec.gen)) return castGen(k, state, event, role, spec.gen)
    })
  },

  ready(k: Kernel) {
    const problems = npcsProblems(k)
    if (problems.length > 0) throw new ContentError(problems)
  },
}
