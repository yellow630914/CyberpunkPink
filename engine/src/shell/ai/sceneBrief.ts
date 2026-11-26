// L7 外殼：給成人場景的 AI 任務組輸入的零件（dev/work/M4-core-scene-ai.md；AI_TASKS 3.5～3.8 節、4.2 節）。
//
// 全部是「讀」：從狀態與功能（features/scene）匯出的純函式與 Play 算出摘要、合法行動、結算的預覽，不改任何東西。
// - 場景這一圈的摘要（briefOf）、這個人合法的行動（legalMoves）：scene_turn 的輸入。
// - 同圈每個由程式控制的人依序各一步：後一個人的輸入帶前一個人「做完之後」的狀態。
//   功能匯出了只走一個人的回合（sceneNpcTurn、sceneNpcBegin；M4-core-gaps 第 15 項），這裡一個一個呼叫它到第 n 個人（afterNpcs）；真正的結算還是功能的 sceneNext（env.moves），預演只給 AI 看。
// - 結束的預覽（settledOf）：照功能的純函式先算一次（不帶 env.closing），收尾的五個任務讀它的結果；它們交回來之後再算一次，這一次帶 env.closing。
//   亂數是 scene/<id>/<第幾步>，兩次一樣，所以兩次之間只差 env.closing 造成的不同。
// 輸入都已經照內容篩選刪過：被關掉的標籤、體位、技能不出現。

import type { ActorId, GameState, Kernel, ReportDraft, TimelineBeat } from '../../core'
import { contentAllowed, deriveRng, meterOf } from '../../core'
import type { Goal, Nature, SceneInput, SceneRaw, SinkKind, TalkEnv } from '../../features/scene'
import {
  END_NAME, GOAL_NAME, NATURE_NAME, Play, ROLE_NAME, inputCostOf, knownPositions, knownSkills, partName, ratingOf, sceneDefOf, sceneNpcBegin, sceneNpcTurn, sceneRules, sexRecordOf,
} from '../../features/scene'
import { clipBeats } from '../battle'
import { avatarTextFor, callsFor } from './people'
import type { LegalMove, SceneBrief, SceneDigest, SinkInput, TendencyInput } from './sceneTasks'

/** 每一次都用同一個種子與用途：scene/<id>/<第幾步>（和功能的 diceOf 同一個）。 */
export const diceFor = (state: GameState, scene: Pick<SceneRaw, 'id' | 'step'>) => deriveRng(state.rng, `scene/${scene.id}/${scene.step}`)

export const playOf = (k: Kernel, state: GameState, scene: SceneRaw): Play => new Play(k, state, scene, diceFor(state, scene))

const nameOf = (state: GameState, id: ActorId): string => state.actors[id]?.name ?? id

// ---- 這一圈的摘要 ----

export function briefOf(p: Play): SceneBrief {
  const s = p.s
  const nm = (id: ActorId): string => nameOf(p.state, id)
  const goal = s.goal
  return {
    kind: s.kind, layer: s.layer, round: s.round, nature: s.nature, nature_name: NATURE_NAME[s.nature], role_name: ROLE_NAME[s.role],
    goal: goal ? { id: goal, name: GOAL_NAME[goal], progress: s.goal_progress ?? 0, done_at: p.rules.goal_done_at } : null,
    ...(s.place ? { place: s.place } : {}),
    position: { id: s.position, name: p.positionName() },
    people: s.seats.map((x) => ({
      id: x.id, name: nm(x.id), load: [p.load[x.id]!, p.loadMax[x.id]!] as [number, number], glow: [p.glow[x.id]!, p.glowMax[x.id]!] as [number, number], ap: [x.ap, p.apMax[x.id]!] as [number, number],
      climax: x.climax, gear: `${p.sync.gears[x.gear].name}檔`, ...(x.out ? { out: true } : {}),
      // 玩家寫的稱呼與化身描述原樣給 AI（M4-followups-2 第 2 項）；化身只在內海那一層給
      ...callsFor(p.state, x.id), ...(s.layer === 'net' && avatarTextFor(p.state, x.id) !== undefined ? { avatar: avatarTextFor(p.state, x.id) } : {}),
    })),
    pairs: Object.fromEntries(Object.entries(s.pairs).filter(([id]) => p.inCircle(id)).map(([id, pr]) => [id, { fit: pr.fit, init: pr.init, rating: ratingOf(p.rules, pr.fit).name }])),
    links: s.links.map((l) => ({ by: nm(l.by), to: nm(l.to), name: l.name, mine: partName(l.mine), theirs: partName(l.theirs) })),
    other_circles: s.circles.map((c) => ({ id: c.id, people: c.people.map(nm), fit: c.fit })),
  }
}

/** 這一場最近的幾拍（每人一句）：最近三回合。 */
export function recentOf(state: GameState, scene: SceneRaw): string[] {
  return scene.lines.filter((l) => l.round >= scene.round - 2).slice(-12).map((l) => `${l.who === scene.pc ? '你' : nameOf(state, l.who)}：${l.text}`)
}

// ---- 合法行動 ----

/**
 * 這個人現在合法的行動（程式算好的，給 scene_turn 選）：每一個都問過功能的 blocks（行動點、有沒有連接、部位、體位、標籤、主動權）。
 * 一個一個看，不是一串合起來的總花費：總花費與順序由功能在 env.moves 驗。最多 max 項。內容篩選關掉的技能與體位本來就不在 knownSkills、knownPositions 裡。
 * 呼叫之前 p.s.turn 要是 w（blocks 會問「輪到他了沒有」）。
 */
export function legalMoves(p: Play, w: ActorId, max = 40): LegalMove[] {
  const out: LegalMove[] = []
  const push = (i: SceneInput, name?: string): void => {
    if (out.length >= max) return
    if (p.blocks(w, i).length > 0) return
    out.push({ ...i, ap: inputCostOf(p, i, w), ...(name ? { name } : {}) } as LegalMove)
  }
  const others = p.activeOthers(w)
  for (const kind of ['dominate', 'yield', 'tease', 'restrain'] as const) push({ kind })
  for (const id of knownSkills(p.k, p.state, w)) {
    const name = sceneDefOf(p.k, 'skill', id)?.name
    if (others.length <= 1) push({ kind: 'skill', id }, name)
    else for (const t of others) push({ kind: 'skill', id, target: t }, name)
  }
  if (others.length <= 1) push({ kind: 'talk' })
  else for (const t of others) push({ kind: 'talk', target: t })
  if (!p.solo) for (const pos of knownPositions(p.k, p.state, w, p.activeIds().length)) push({ kind: 'switch', position: pos.id }, pos.name)
  // 夜課共鳴給的：每場一次的特殊動作（set_init 的值是共鳴寫的主動權 70 或 30，兩個都問 blocks）與脫下或換上一件衣服（M4-followups-2 第 12 項）
  for (const id of ['fit_floor'] as const) push({ kind: 'once', id }, '夜課的功夫（契合）')
  for (const value of [70, 30]) push({ kind: 'once', id: 'set_init', value }, `夜課的功夫（主動權 ${value}）`)
  push({ kind: 'dress' }, '換一身樣子')
  return out
}

// ---- 同圈每個人依序各一步（模擬） ----

/** 這一輪同圈由程式控制的人的行動（scene_turn 給的）與說話的判定（scene_talk 給的；每個說話的人一份：SceneEnv.talk）。 */
export interface NpcPlan {
  moves: Record<ActorId, SceneInput[]>
  talk?: Record<ActorId, TalkEnv>
}

/** 這一輪要問 AI 的人（照座位的順序）：多人是同一圈每個還在的人；一對一是現在輪到的那個人；單人沒有。 */
export function npcOrder(scene: SceneRaw): ActorId[] {
  if (scene.kind === 'group') return scene.seats.filter((x) => x.id !== scene.pc && !x.out).map((x) => x.id)
  if (scene.kind === 'pair' && scene.turn !== scene.pc) return [scene.turn]
  return []
}

/**
 * 把前 upTo 個人的回合做完（換檔、他的行動、剩下的行動點照規則走），回傳那時候的 Play。一個一個呼叫功能的 sceneNpcTurn（M4-core-gaps 第 15 項：
 * 功能自己知道多人與一對一各怎麼走，這裡不再照 groupRound 模擬）。不做回合的結算（連接的自動效果、別的圈、強制結束的檢查）：那是整輪最後的事。
 * 亂數與真正的 sceneNext 同一個序，所以做出來的和真正結算時前面的人一樣。
 */
export function afterNpcs(k: Kernel, state: GameState, scene: SceneRaw, plan: NpcPlan, upTo: number): Play {
  let p = playOf(k, state, scene)
  if (plan.talk) p.talkEnv = plan.talk
  for (const w of npcOrder(scene).slice(0, upTo)) p = sceneNpcTurn(k, state, w, { moves: { [w]: plan.moves[w] ?? [] } }, p)
  return p
}

/** 這個人這一回合開始的狀態（前面的人已經做完）：把輪到他、回合開頭的處理做完，才問得出合法的行動。 */
export function turnPlayOf(k: Kernel, state: GameState, scene: SceneRaw, plan: NpcPlan, index: number): { p: Play; who: ActorId } | null {
  const who = npcOrder(scene)[index]
  if (who === undefined) return null
  const p = sceneNpcBegin(k, state, who, {}, afterNpcs(k, state, scene, plan, index))
  return { p, who }
}

/** 前面的人做了什麼（一行一個人）：給後一個人的輸入。 */
export function earlierLines(state: GameState, scene: SceneRaw, plan: NpcPlan, index: number): string[] {
  const order = npcOrder(scene)
  const out: string[] = []
  for (let i = 0; i < index; i++) {
    const w = order[i]!
    const n = plan.moves[w]?.length ?? 0
    out.push(`${nameOf(state, w)}：這一回合做了 ${n} 個行動${n === 0 ? '（照規則走）' : ''}。`)
  }
  return out
}

// ---- 結束的預覽 ----

/** 一場結束之後給收尾任務讀的摘要（都是 JSON；放在任務鏈那一步的結果裡，所以要小）。 */
export interface Settled {
  /** 這一步有沒有讓場景結束 */
  ended: boolean
  /** 結束的原因（EndReason）與給人看的名字 */
  reason?: string
  reason_name?: string
  nature: Nature
  nature_name: string
  place?: string
  goal: { id: Goal; name: string; done: boolean } | null
  /** 整場的評價（名字）與契合（多個對象時是平均） */
  rating: string
  fit: number
  /** 主角對每個對象：契合、評價、親密度可以動的範圍（relate_range） */
  pairs: Array<{ id: string; name: string; fit: number; band_id: string; band: string; range: [number, number] }>
  /** 在場的每一個人（含別的圈）：記性經歷的 with 只能是他們 */
  present: Array<{ id: string; name: string }>
  touched: Array<{ id: string; name: string; axis: string }>
  firsts: { people: string[]; positions: string[]; tags: string[] }
  log: string[]
  relations: Array<{ id: string; name: string; affinity: number }>
  sink_now: number
  sink_rule: { kind: SinkKind; amount: number }
  /** 一場最多讓沉溺動幾點（規則表 sink_cap） */
  sink_cap: number
  /** 功能結算的白話結果（不含成人的細節；給收尾的算回報與算關係的摘要用） */
  results: string[]
}

/** 內容篩選之後這一場碰到的標籤（有名字與軸）。 */
export function touchedList(k: Kernel, state: GameState, tags: readonly string[]): Settled['touched'] {
  return [...new Set(tags)].filter((t) => contentAllowed(state.rules, t) && k.content.get('tendency_tag', t) !== undefined).map((t) => {
    const e = k.content.get('tendency_tag', t)!
    return { id: t, name: typeof e.name === 'string' ? e.name : t, axis: String(e.axis ?? '') }
  })
}

/** 規則的沉溺退路（CORE_RULES 4.3 節；和 features/scene 的 planSink 同一個規則，只算參考，不含過載累積）。 */
export function sinkRuleOf(k: Kernel, state: GameState, scene: SceneRaw, pairIds: readonly string[]): { kind: SinkKind; amount: number } {
  const rules = sceneRules(k).sink
  if (scene.kind === 'solo') return { kind: 'other', amount: 0 }
  if (scene.nature === 'forced') return { kind: 'forced', amount: rules.forced }
  if (scene.nature === 'trade' || scene.nature === 'work') return { kind: 'trade', amount: 0 }
  const avg = pairIds.length > 0 ? pairIds.reduce((a, id) => a + meterOf(k, state, 'affinity', id), 0) / pairIds.length : 0
  if (scene.nature === 'mutual' && pairIds.length > 0 && avg >= rules.anchor_affinity) return { kind: 'anchor', amount: rules.anchor }
  return { kind: 'other', amount: 0 }
}

/** 場景的紀錄（每一拍一句）；不要 round 與 scene.dropped 那幾拍。 */
export const logOf = (beats: readonly TimelineBeat[]): string[] => clipBeats(beats.filter((b) => b.tag !== 'round' && b.tag !== 'scene.dropped').map((b) => b.text))

/**
 * 結束的預覽：d 是功能算的那一份草稿（不帶 env.closing）；touched 是這一場碰到的全部標籤（含最後一步）。
 * 不是結束（scene.end 以外）回傳 { ended: false }。
 */
export function settledOf(k: Kernel, state: GameState, scene: SceneRaw, d: ReportDraft, touched: readonly string[]): Settled | { ended: false } {
  if (d.action !== 'scene.end') return { ended: false }
  const rules = sceneRules(k)
  const end = [...d.timeline].reverse().find((b) => b.tag === 'scene.end')
  const data = (end?.data ?? {}) as { reason?: string; fit?: number; pairs?: Record<string, { fit: number; rating_id: string; rating: string }> }
  const pairIds = Object.keys(scene.pairs)
  const results = d.narration?.results ?? []
  const goalLine = results.find((l) => l.startsWith('目的「'))
  const present = [...new Set([scene.pc, ...scene.seats.map((x) => x.id), ...scene.circles.flatMap((c) => [...c.people, ...(c.out ?? [])])])].filter((id) => !!state.actors[id])
  const rec = sexRecordOf(state.actors[scene.pc])
  const skip = data.reason === 'skip'
  const fit = typeof data.fit === 'number' ? data.fit : 0
  const band = ratingOf(rules, fit)
  const pairs = pairIds.map((id) => {
    const f = data.pairs?.[id]?.fit ?? scene.pairs[id]!.fit
    const b = ratingOf(rules, f)
    return { id, name: nameOf(state, id), fit: f, band_id: b.id, band: b.name, range: (rules.relate_range[b.id] ?? [b.affinity, b.affinity]) as [number, number] }
  })
  return {
    ended: true, reason: data.reason, reason_name: data.reason ? END_NAME[data.reason as keyof typeof END_NAME] : undefined,
    nature: scene.nature, nature_name: NATURE_NAME[scene.nature], ...(scene.place ? { place: scene.place } : {}),
    goal: scene.goal ? { id: scene.goal, name: GOAL_NAME[scene.goal], done: !!goalLine && goalLine.includes('達成了') && !goalLine.includes('沒有達成') } : null,
    rating: band.name, fit, pairs, present: present.map((id) => ({ id, name: nameOf(state, id) })),
    touched: touchedList(k, state, skip ? scene.tags : [...scene.tags, ...touched]),
    firsts: {
      people: pairIds.filter((id) => scene.pairs[id]!.first), positions: skip ? [] : scene.used_positions.filter((x) => !rec.positions.includes(x)),
      tags: touchedList(k, state, skip ? scene.tags : [...scene.tags, ...touched]).map((t) => t.id).filter((t) => !rec.tags.includes(t)),
    },
    log: logOf(d.timeline), relations: pairIds.map((id) => ({ id, name: nameOf(state, id), affinity: meterOf(k, state, 'affinity', id) })), sink_now: state.actors[scene.pc]?.sink ?? 0,
    sink_rule: sinkRuleOf(k, state, scene, pairIds), sink_cap: rules.sink_cap, results,
  }
}

/** 收尾的算回報與算關係讀的摘要版：成人的細節換成一句「這一段是私下的時間」（PROMPTS 7.2 節）。 */
export function digestOf(scene: SceneRaw, st: Settled): SceneDigest {
  return {
    nature: st.nature, nature_name: st.nature_name, role_name: ROLE_NAME[scene.role], goal: st.goal, ended: st.reason_name ?? '', rating: st.rating,
    people: st.pairs.map((p) => ({ id: p.id, name: p.name })), ...(st.place ? { place: st.place } : {}),
    lines: [
      '這一段是私下的時間。',
      `${st.nature_name}的一場，結束的方式：${st.reason_name ?? ''}，整場的評價：${st.rating}。`,
      ...(st.goal ? [`目的「${st.goal.name}」：${st.goal.done ? '達成了' : '沒有達成'}。`] : []),
    ],
  }
}

/** 算沉溺的輸入：玩家的寫法指令不給它（沉溺不受指令影響）。「被迫」這一種只在這一場的性質是被迫時才列。 */
export function sinkInputOf(st: Settled): SinkInput {
  return {
    nature: st.nature, nature_name: st.nature_name, kinds: st.nature === 'forced' ? ['anchor', 'trade', 'forced', 'other'] : ['anchor', 'trade', 'other'], rule: st.sink_rule, range: [-st.sink_cap, st.sink_cap],
    sink_now: st.sink_now, relations: st.relations, log: st.log,
  }
}

export function tendencyInputOf(st: Settled, direction?: string): TendencyInput {
  return { touched: st.touched, log: st.log, ...(direction ? { direction } : {}) }
}
