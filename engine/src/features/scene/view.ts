// L6 功能 scene 的畫面資料：sceneView（畫面要的全部）、sceneOptions（十種行動一次列出來，每一種現在能不能做與原因）、scenePreview（選中行動的預覽）。
// 數字都是引擎算的，畫面不算。規格：UI 第 10 節；LEWD_SYSTEM 3.5 節；dev/work/M2-scene.md 第 2、8 點。

import type { GameState, Kernel } from '../../core'
import type { SyncGear } from '../../core'
import { clone } from '../../core'
import type { ActionId, CircleRec, LinkRec, PositionEntry, SceneKind, SceneLayer, SceneRaw, Who } from './model'
import { SYNC_GEARS, ACTION_NAME, GOAL_NAME, NATURE_NAME, ROLE_NAME, TALK_PARTS, dieRange, knownPositions, knownSkills, parseDie, partName, ratingOf, sceneDefOf, sceneRawOf, tendencyTagIds } from './model'
import type { Preview, SceneInput } from './play'
import { Play, candOf, costOf, diceOf } from './play'
import { sceneWindow } from './window'

export interface PartView {
  id: string
  name: string
  /** 連著（有連接在用它） */
  linked: boolean
  /** 連接的 id */
  link: number | null
  /** 這個體位碰得到（細框）；碰不到的變暗 */
  reach: boolean
}

export interface PersonView {
  id: string
  name: string
  load: { now: number; max: number }
  /** 餘韻：層數與承受層數 */
  glow: { now: number; max: number }
  ap: { now: number; max: number }
  sensitivity: number
  /** 體位裡的位置與是不是上位 */
  role: string
  upper: boolean
  parts: PartView[]
  /** 已知的傾向標籤（主角看得到自己的；對方的畫面寫「？」，這裡是空的） */
  tags: string[]
  /** 這一場到了幾次 */
  climax: number
  /** 失神退出了這一圈（多人才有） */
  out: boolean
  /** 同步檔位 */
  gear: GearView
  /**
   * 他會的夜課技能與體位（id）：主角是學會的；對方沒寫 skills 時是場景開始當下由他的軸、標籤與性經歷推出來的（P32，同一個人每次一樣）；
   * 體位是基本的加上這些技能開放的（單人沒有體位）。內容篩選關掉的不列。
   */
  known?: { skills: string[]; positions: string[] }
}

export interface GearView {
  /** 現在的檔、名字（「深檔」）、這個人開得到的最高一檔、自己的檢定加減、受到的感載是原本的幾 % */
  now: SyncGear
  name: string
  cap: SyncGear
  cap_name: string
  check: number
  load_pct: number
  /** 這個回合換過檔了 */
  shifted: boolean
  /** 這一場開過的最高一檔 */
  max: SyncGear
  /** 四檔各自：開不開得了的原因（缺的是同步幾級、敏感度多少，現在是多少；一條一個條件，空的就是開得了）與那一檔的樣子 */
  gears: Array<{ id: SyncGear; name: string; current: boolean; check: number; load_pct: number; ap_regen: number; sink_on_overload: number; blocks: string[] }>
}

export interface LinkView {
  id: number
  /** 舊名字（'pc' 或 'partner'）；角色的 id 在 by_id、to_id */
  by: Who
  by_id: string
  to_id: string
  kind: LinkRec['kind']
  source: string
  name: string
  mine: string
  mine_name: string
  theirs: string
  theirs_name: string
  /** 每回合自動生效的數值（骰的文字與平均，已乘上倍率） */
  per_round: { target_load: string; my_load: string; fit: number; target_avg: number; my_avg: number }
  /** 這一回合新建的 */
  fresh: boolean
}

/** 每一回合的那一句；who 是說話的人的角色 id（M4-core-gaps 第 17 項：以前是 'pc'、'partner'） */
export interface LineView { round: number; who: string; text: string }

/** 主角對這一圈某個人的：契合、主動權與評價（第二版的 pairs）。離開了這一圈的人（換圈、失神退出）這一對的紀錄還在，現在不在這一圈的列在 SceneView 的 away。 */
export interface PairView { fit: number; init: number; first: boolean; rating: { id: string; name: string }; holder: Who }

export interface SceneView {
  id: string
  mode: SceneRaw['mode']
  /** 第二版新增：這一場是一對一、多人還是單人；在現實還是內海 */
  kind: SceneKind
  layer: SceneLayer
  round: number
  turn: Who
  step: number
  nature: SceneRaw['nature']
  nature_name: string
  role: SceneRaw['role']
  role_name: string
  place?: string
  goal: { id: string; name: string; progress: number; done_at: number; done: boolean } | null
  /** mult 與 roles 的鍵是每個座位的角色 id（M4-core-gaps 第 17 項：以前是 'pc'、'partner'）；upper 還是 'pc'、'partner'（一對一的舊寫法；每個人的上下位看 seats[].upper） */
  position: { id: string; name: string; text?: string; upper: Who | null; mult: Record<string, number>; roles: Record<string, string> }
  fit: number
  rating: { id: string; name: string }
  /** 契合條的刻度（30、60、85） */
  fit_marks: number[]
  /** 主動權 0～100：50 以上在你手上 */
  init: number
  holder: Who
  /** 這一圈的每個人（第一個是主角；一對一時第二個就是對方）。以前的 people（pc、partner）拿掉了（M4-core-gaps 第 17 項） */
  seats: PersonView[]
  /** 主角對這一圈每個人（不含主角）的契合與主動權，照對象的 id */
  pairs: Record<string, PairView>
  /** 別的圈（不展開） */
  circles: CircleRec[]
  links: LinkView[]
  /** 精簡版只顯示這個：現在有幾條持續效果與大概的數值（每回合；已乘上倍率） */
  effects: { count: number; target_load: number; my_load: number; fit: number }
  /** 體位由誰決定（P34）：角色的 id */
  decider: string
  /** pairs 裡現在不在主角這一圈的人（換圈離開的、失神退出的） */
  away: string[]
  /** 現在換得到的體位（你會的；原因寫在 blocks）；單人是五個單人姿勢 */
  positions: Array<{ id: string; name: string; blocks: string[] }>
  /**
   * 單人才有（kind 是 solo）：節奏 0～100、這一場有沒有人在看。單人沒有對象：seats 只有主角、
   * position 的 mult 與 roles 也只有主角一格、pairs 與 away 是空的、init 固定 50、fit 與 rating 讀的是節奏。
   */
  pace?: number
  audience?: boolean
  /** 每一回合的那一句 */
  lines: LineView[]
  /** 精簡版遇到多人的設定：只展開一個對象，其餘的人收在旁邊照規則算；這一句是引擎給畫面的說明（不是這種情形沒有這個欄位） */
  simple_note?: string
  /** 選中行動的預覽與原因（sceneView 的第三個參數給了才有） */
  selected?: { input: SceneInput; blocks: string[]; preview: Preview }
}

const round1 = (n: number): number => Math.round(n * 10) / 10

function playOf(k: Kernel, state: GameState, scene: SceneRaw): Play {
  return new Play(k, state, scene, diceOf(state, scene))
}

function linkView(p: Play, l: LinkRec): LinkView {
  const t = l.to
  const their = parseDie(l.link.their_load)!
  const mine = parseDie(l.link.my_load)!
  const mult = (id: string, part: string): number => (p.rules.load_base + p.sensAt(id, part) / p.rules.load_div) * p.mult(id) * p.boost(l.by) * p.gearMult(id)
  const avg = (d: typeof their, id: string, part: string): number => round1(dieRange(d).avg * (d.sign > 0 ? mult(id, part) : 1))
  const text = (d: typeof their): string => (d.n === 0 && d.flat === 0 ? '0' : (d.sign < 0 ? '−' : '') + (d.n > 0 ? `${d.n}d${d.sides}` : String(d.flat)))
  return {
    id: l.id, by: p.who(l.by), by_id: l.by, to_id: l.to, kind: l.kind, source: l.source, name: l.name, mine: l.mine, mine_name: partName(l.mine), theirs: l.theirs, theirs_name: partName(l.theirs),
    per_round: { target_load: text(their), my_load: text(mine), fit: l.link.fit, target_avg: avg(their, t, l.theirs), my_avg: avg(mine, l.by, l.mine) }, fresh: l.round === p.s.round,
  }
}

function gearView(p: Play, w: string): GearView {
  const now = p.seat(w).gear
  const rule = p.gearRule(w)
  const cap = p.gearCap[w]!
  return {
    now, name: `${rule.name}檔`, cap, cap_name: `${p.sync.gears[cap].name}檔`, check: rule.check, load_pct: rule.loadPct, shifted: p.seat(w).shifted, max: p.seat(w).max_gear,
    gears: SYNC_GEARS.map((id) => {
      const g = p.sync.gears[id]
      return { id, name: `${g.name}檔`, current: id === now, check: g.check, load_pct: g.loadPct, ap_regen: g.apRegen ?? 0, sink_on_overload: g.sinkOnOverload ?? 0, blocks: p.gearReasons(w, id) }
    }),
  }
}

function personView(p: Play, w: string): PersonView {
  const a = p.actor(w)
  const linkOf = (part: string): LinkRec | undefined => p.occupiers(w, part)[0]
  const parts = p.partsOf(w).map((id): PartView => ({ id, name: partName(id), linked: !!linkOf(id), link: linkOf(id)?.id ?? null, reach: p.partReachable(w, id) }))
  // 道具自己算一個部位（脈衝環的 toy）：連著的時候列在後面
  for (const l of p.s.links) {
    const part = l.by === w ? l.mine : l.theirs
    if (l.by !== w && l.to !== w) continue
    if (!parts.some((x) => x.id === part)) parts.push({ id: part, name: partName(part), linked: true, link: l.id, reach: true })
  }
  return {
    id: a.id, name: a.name, load: { now: p.load[w]!, max: p.loadMax[w]! }, glow: { now: p.glow[w]!, max: p.glowMax[w]! }, ap: { now: p.seat(w).ap, max: p.apMax[w]! }, sensitivity: p.sens[w]!,
    role: p.s.roles[w] ?? '', upper: p.isUpper(w), parts, tags: p.isPc(w) ? tendencyTagIds(a) : [], climax: p.seat(w).climax, out: p.seat(w).out === true, gear: gearView(p, w),
    known: { skills: knownSkills(p.k, p.state, w), positions: p.solo ? [] : knownPositions(p.k, p.state, w, p.activeIds().length).map((x) => x.id) },
  }
}

/** 畫面要的全部（沒有場景是 null）。selected 給一個行動就多一份它的原因與預覽。 */
export function sceneView(k: Kernel, state: GameState, selected?: SceneInput): SceneView | null {
  const s = sceneRawOf(state)
  if (!s) return null
  const p = playOf(k, state, s)
  const solo = p.solo
  const fit = solo ? s.pace ?? 0 : p.pair.fit
  const band = ratingOf(p.rules, fit)
  const links = s.links.map((l) => linkView(p, l))
  const effects = links.reduce((a, l) => ({ count: a.count + 1, target_load: round1(a.target_load + l.per_round.target_avg), my_load: round1(a.my_load + l.per_round.my_avg), fit: a.fit + l.per_round.fit }), { count: 0, target_load: 0, my_load: 0, fit: 0 })
  const pcId = s.pc
  const partnerId = p.partnerId
  const upperWho = solo ? null : (['pc', 'partner'] as const).find((w) => p.isUpper(w === 'pc' ? pcId : partnerId)) ?? null
  // 單人沒有對象：位置與倍率只有主角一格；其餘每個座位各一格（鍵是角色 id）
  const position: SceneView['position'] = solo
    ? { id: s.position, name: p.positionName(), upper: null, mult: { [pcId]: p.mult(pcId) }, roles: { [pcId]: '' } }
    : {
      id: p.pos.id, name: p.pos.name, ...(p.pos.text ? { text: p.pos.text } : {}), upper: upperWho,
      mult: Object.fromEntries(s.seats.map((x) => [x.id, p.mult(x.id)])), roles: Object.fromEntries(s.seats.map((x) => [x.id, s.roles[x.id] ?? ''])),
    }
  const pairs: Record<string, PairView> = {}
  for (const [id, pr] of Object.entries(s.pairs)) {
    const b = ratingOf(p.rules, pr.fit)
    pairs[id] = { fit: pr.fit, init: pr.init, first: pr.first, rating: { id: b.id, name: b.name }, holder: pr.init >= 50 ? 'pc' : 'partner' }
  }
  const seats = s.seats.map((x) => personView(p, x.id))
  const view: SceneView = {
    id: s.id, mode: s.mode, kind: s.kind, layer: s.layer, round: s.round, turn: p.who(s.turn), step: s.step, nature: s.nature, nature_name: NATURE_NAME[s.nature], role: s.role, role_name: ROLE_NAME[s.role],
    ...(s.place ? { place: s.place } : {}),
    goal: s.goal ? { id: s.goal, name: GOAL_NAME[s.goal], progress: solo ? Math.max(s.goal_progress ?? 0, fit) : s.goal_progress ?? 0, done_at: p.rules.goal_done_at, done: (solo ? Math.max(s.goal_progress ?? 0, fit) : s.goal_progress ?? 0) >= p.rules.goal_done_at } : null,
    position,
    fit, rating: { id: band.id, name: band.name }, fit_marks: p.rules.bands.map((b) => b.min).filter((m) => m > 0).sort((a, b) => a - b), init: solo ? 50 : p.pair.init, holder: solo ? 'pc' : p.who(p.holder()),
    seats, pairs, circles: clone(s.circles), links, effects, decider: p.decider(), away: Object.keys(s.pairs).filter((id) => !p.inCircle(id)),
    positions: solo
      ? p.poses.map((x) => ({ id: x.id, name: x.name, blocks: p.blocks(pcId, { kind: 'switch', position: x.id }, true) }))
      : knownPositions(k, state, s.pc, p.activeIds().length).map((x) => ({ id: x.id, name: x.name, blocks: p.blocks(pcId, { kind: 'switch', position: x.id }, true) })),
    lines: s.lines.map((l) => ({ round: l.round, who: l.who, text: l.text })),
    ...(solo ? { pace: s.pace ?? 0, audience: s.audience === true } : {}),
  }
  const folded = s.circles.flatMap((c) => c.people)
  if (s.mode === 'simple' && !solo && folded.length > 0) {
    const names = (ids: string[]): string => ids.map((id) => state.actors[id]?.name ?? id).join('、')
    view.simple_note = `精簡版一次只展開一個對象（${names(seats.slice(1).map((x) => x.id))}）：其他的人（${names(folded)}）收在旁邊照規則算，叫不過來、也不能換過去。要和大家一起玩，請在設定裡把成人場景切到完整版（下一場開始時生效）。`
  }
  if (selected) view.selected = { input: selected, blocks: p.blocks(pcId, selected, true), preview: p.preview(pcId, selected) }
  return view
}

/** 選中行動的預覽（雙方的感載、契合、主動權、倍率）。沒有場景是 null。 */
export function scenePreview(k: Kernel, state: GameState, input: SceneInput): Preview | null {
  const s = sceneRawOf(state)
  return s ? playOf(k, state, s).preview(s.pc, input) : null
}

// ---- 十種行動 ----

export interface ScenePickOption {
  value: string
  label: string
  /** 現在選不了的原因，一條一句；空的就是可以選 */
  blocks: string[]
}

/** 要玩家選的部位（照戰鬥 picks 的樣子：key、label、kind、required、options）。 */
export interface ScenePick {
  key: 'my_part' | 'their_part'
  label: string
  kind: 'choice'
  /** 完整版要選；精簡版由引擎挑，不用選 */
  required: boolean
  options: ScenePickOption[]
}

/** 一組部位的組合與原因：空的 blocks 才點得下去（畫面不必自己算哪兩個部位接得起來）。 */
export interface ScenePair { my_part: string; their_part: string; blocks: string[] }

export interface ChoiceOption {
  /** 技能或道具的 id、體位的 id */
  id: string
  name: string
  ap: number
  blocks: string[]
  picks: ScenePick[]
  pairs: ScenePair[]
  preview: Preview
  /**
   * 選了它要送出去的輸入（不含部位的選擇：需要選部位的技能與道具，畫面把選好的 pick 加在這一份上）。
   * 技能、道具是 { kind, id }；體位、姿勢是 { kind: 'switch', position }；換圈、叫人、換檔、夜課的功夫各自是它們的樣子（once 帶 value）；
   * 有指定對象的場景（target）已經加在上面。畫面直接送這一份，不從選項 id 拆字串（M4 收尾修正批）。
   */
  input: SceneInput
}

interface ActionOptionRaw {
  id: ActionId
  name: string
  ap: number
  /** 現在不能做的原因，一條一句；空的就是可以做。技能、道具：每一個要用的東西各自的原因在 choices 裡 */
  blocks: string[]
  picks: ScenePick[]
  pairs: ScenePair[]
  /** 技能、道具、切換體位：要選哪一個 */
  choices?: ChoiceOption[]
  preview: Preview | null
}

export interface ActionOption extends ActionOptionRaw {
  /**
   * 這個行動會照「行動的對象」算：多人時畫面要列「對象」那一排的行動才是 true（主導、迎合、挑逗、克制、技能、說話、道具、夜課的功夫）。
   * 停下、換圈、叫人、換檔、換體位、脫換衣服與單人場景（沒有對象）都是 false。sceneOptions 的第二個參數 target 對 true 的行動才有作用。
   */
  targeted: boolean
}

/** 行動的輸入帶 target 的種類（sceneOptions 的 aimed 對這些才加）。 */
const TARGETED_ACTIONS: ReadonlySet<ActionId> = new Set<ActionId>(['dominate', 'yield', 'tease', 'restrain', 'skill', 'talk', 'item', 'once'])

export interface SceneOptions {
  turn: Who
  round: number
  /** 這一圈現在還在的別人（技能、道具、說話要給 target 時從這裡選；一對一只有一個） */
  targets: Array<{ id: string; name: string }>
  ap: { now: number; max: number }
  actions: ActionOption[]
  /** 回合交給對方（沒用完的行動點留到下回合） */
  end_turn: { blocks: string[] }
  /** 別的功能在這個視窗插進來的選項（掛點 scene.window；妖精的吻擴散階段）：選了就送出 input；blocks 是現在做不到的原因（空的是能做） */
  inserted: Array<{ id: string; owner: string; name: string; ap: number; blocks: string[]; input: SceneInput }>
}

function pairsOf(p: Play, w: string, input: SceneInput, mine: string[], theirs: string[]): ScenePair[] {
  const out: ScenePair[] = []
  for (const m of mine) {
    for (const t of theirs) {
      const probe = { ...input, pick: { my_part: m, their_part: t } } as SceneInput
      out.push({ my_part: m, their_part: t, blocks: p.blocks(w, probe, true) })
    }
  }
  return out
}

/** 每個部位選項的原因：只要有一個組合接得起來就能選；一個都沒有就列出組合的原因（取第一個）。 */
function picksOf(p: Play, mine: string[], theirs: string[], pairs: ScenePair[]): ScenePick[] {
  const optionOf = (key: 'my_part' | 'their_part', value: string): ScenePickOption => {
    const mine = pairs.filter((x) => x[key] === value)
    const ok = mine.some((x) => x.blocks.length === 0)
    return { value, label: partName(value), blocks: ok ? [] : [...new Set(mine.flatMap((x) => x.blocks).slice(0, 1))] }
  }
  const required = p.s.mode === 'full'
  return [
    { key: 'my_part', label: '用你的哪個部位', kind: 'choice', required, options: mine.map((m) => optionOf('my_part', m)) },
    { key: 'their_part', label: p.solo ? '接自己的哪個部位' : '接對方的哪個部位', kind: 'choice', required, options: theirs.map((t) => optionOf('their_part', t)) },
  ]
}

/**
 * 十種行動一次列出來（工單第 2 點；換檔的四檔在 choices，開不了的帶核心 syncBlocks 的原因）：花費、現在能不能做與原因、要選的部位（照戰鬥 picks 的樣子宣告）、技能與道具與體位各自的選項、預覽。
 * 沒有場景是 null。一直問的是主角（玩家）。
 */
export function sceneOptions(k: Kernel, state: GameState, o: { target?: string } = {}): SceneOptions | null {
  const s = sceneRawOf(state)
  if (!s) return null
  const p = playOf(k, state, s)
  const w = s.pc
  // 指定對象（M4-core-gaps 第 17 項）：多人時玩家先選了對象，每個行動的原因、部位的組合與預覽都照他算；沒給（或不在這一圈）一對一是對方、多人是引擎挑的那一個
  const at = o.target !== undefined && p.activeOthers(w).includes(o.target) ? o.target : undefined
  const aimed = <T extends SceneInput>(input: T): T => (at !== undefined && input.kind !== 'stop' && input.kind !== 'end_turn' && input.kind !== 'move_circle' && input.kind !== 'call' && input.kind !== 'gear' && input.kind !== 'switch' ? { ...input, target: at } : input)
  const simple = (id: 'dominate' | 'yield' | 'tease' | 'restrain' | 'stop' | 'faster' | 'slower'): ActionOptionRaw => {
    const input: SceneInput = aimed({ kind: id })
    return { id, name: ACTION_NAME[id], ap: id === 'stop' ? 0 : costOf(p, input, w), blocks: p.blocks(w, input, true), picks: [], pairs: [], preview: id === 'stop' ? null : p.preview(w, input) }
  }
  const choice = (raw: SceneInput, id: string, name: string, ap: number, mine: string[], theirs: string[]): ChoiceOption => {
    const input = aimed(raw)
    const pairs = mine.length > 0 ? pairsOf(p, w, input, mine, theirs) : []
    return { id, name, ap, blocks: p.blocks(w, input, true), picks: mine.length > 0 ? picksOf(p, mine, theirs, pairs) : [], pairs, preview: p.preview(w, input), input }
  }
  const talkInput: SceneInput = aimed({ kind: 'talk' })
  const solo = p.solo
  // 單人說話不選部位（對看著的人說，不建立連接）
  const talkTheirs = solo ? [] : p.partsOf(p.autoTarget(w, talkInput))
  const talkPairs = solo ? [] : pairsOf(p, w, talkInput, [...TALK_PARTS], talkTheirs)
  const skills = knownSkills(k, state, s.pc).map((id) => {
    const info = sceneDefOf(k, 'skill', id)!
    const cand = candOf(info.def, info.tag)!
    return choice({ kind: 'skill', id }, id, info.name, info.def.ap, cand.mine, cand.theirs)
  })
  const items: ChoiceOption[] = []
  for (const stack of state.inventory) {
    if (items.some((x) => x.id === stack.id)) continue
    const info = sceneDefOf(k, 'item', stack.id)
    if (!info) continue
    const cand = candOf(info.def, info.tag)
    items.push(choice({ kind: 'item', id: stack.id }, stack.id, info.name, info.def.ap, cand?.mine ?? [], cand?.theirs ?? []))
  }
  const switchOf = (pos: { id: string; name: string }): ChoiceOption => {
    const input: SceneInput = { kind: 'switch', position: pos.id }
    return { id: pos.id, name: pos.name, ap: costOf(p, { kind: 'switch', position: '' }, w), blocks: p.blocks(w, input, true), picks: [], pairs: [], preview: p.preview(w, input), input }
  }
  // 單人：換的是五個單人姿勢
  const switches = solo ? p.poses.map(switchOf) : knownPositions(k, state, s.pc, p.activeIds().length).map((pos: PositionEntry) => switchOf(pos))
  const gears = SYNC_GEARS.map((g: SyncGear): ChoiceOption => {
    const input: SceneInput = { kind: 'gear', gear: g }
    return { id: g, name: `${p.sync.gears[g].name}檔`, ap: 0, blocks: p.blocks(w, input, true), picks: [], pairs: [], preview: p.preview(w, input), input }
  })
  const turn = p.blocks(w, { kind: 'restrain' }, true).filter((x) => x.startsWith('還沒輪到'))
  const minAp = (list: ChoiceOption[]): number => (list.length > 0 ? Math.min(...list.map((x) => x.ap)) : 0)
  const group = (list: ChoiceOption[], none: string): string[] => (turn.length > 0 ? turn : list.length === 0 ? [none] : list.every((x) => x.blocks.length > 0) ? [list[0]!.blocks[0]!] : [])
  // 換圈與叫人過來：有別的圈的時候才列（精簡版與沒有別的圈的場景不列）
  const plain = (input: SceneInput, id: string, name: string, ap: number): ChoiceOption => ({ id, name, ap, blocks: p.blocks(w, input, true), picks: [], pairs: [], preview: p.preview(w, input), input })
  const names = (ids: string[]): string => ids.map((x) => state.actors[x]?.name ?? x).join('、')
  const moves = s.circles.map((c) => plain({ kind: 'move_circle', circle: c.id }, c.id, names(c.people), p.rulesFor(w).cost.move_circle))
  const calls = s.circles.flatMap((c) => c.people.map((id) => plain({ kind: 'call', who: id }, id, state.actors[id]?.name ?? id, p.rulesFor(w).cost.call)))
  const circleActions: ActionOptionRaw[] = s.mode === 'full' && s.circles.length > 0
    ? [
      { id: 'move_circle', name: ACTION_NAME.move_circle, ap: p.rulesFor(w).cost.move_circle, blocks: group(moves, '沒有別的圈可以去。'), picks: [], pairs: [], choices: moves, preview: null },
      { id: 'call', name: ACTION_NAME.call, ap: p.rulesFor(w).cost.call, blocks: group(calls, '別的圈裡沒有人可以叫。'), picks: [], pairs: [], choices: calls, preview: null },
    ]
    : []
  const talkAction: ActionOptionRaw = {
    id: 'talk', name: ACTION_NAME.talk, ap: p.rulesFor(w).cost.talk, blocks: p.blocks(w, talkInput, true), picks: solo ? [] : picksOf(p, [...TALK_PARTS], talkTheirs, talkPairs), pairs: talkPairs,
    preview: p.preview(w, talkInput),
  }
  const skillAction: ActionOptionRaw = { id: 'skill', name: ACTION_NAME.skill, ap: minAp(skills), blocks: group(skills, '你還沒有學會任何在場景裡用得出來的技能。'), picks: [], pairs: [], choices: skills, preview: null }
  const itemAction: ActionOptionRaw = { id: 'item', name: ACTION_NAME.item, ap: minAp(items), blocks: group(items, '你身上沒有在場景裡用得出來的東西。'), picks: [], pairs: [], choices: items, preview: null }
  const switchAction: ActionOptionRaw = { id: 'switch', name: ACTION_NAME.switch, ap: costOf(p, { kind: 'switch', position: '' }, w), blocks: group(switches.filter((x) => x.id !== s.position), solo ? '沒有別的姿勢可以換。' : '沒有別的體位可以換。'), picks: [], pairs: [], choices: switches, preview: null }
  const gearAction: ActionOptionRaw = { id: 'gear', name: ACTION_NAME.gear, ap: 0, blocks: group(gears.filter((x) => x.id !== p.seat(w).gear), '沒有別的檔位可以換。'), picks: [], pairs: [], choices: gears, preview: null }
  // 共鳴給的行動（M4-night-resonance）：有那個共鳴才列。夜課的功夫（每場一次：主動權設成共鳴寫的數、契合拉到共鳴寫的數）、脫換衣服
  const granted: ActionOptionRaw[] = []
  const dressCost = costOf(p, { kind: 'dress' }, w)
  if (p.onceOf(w, 'free_dress') !== null) granted.push({ id: 'dress', name: ACTION_NAME.dress, ap: dressCost, blocks: p.blocks(w, { kind: 'dress' }, true), picks: [], pairs: [], preview: p.preview(w, { kind: 'dress' }) })
  const oncePicks: ChoiceOption[] = []
  const initOnce = p.onceOf(w, 'set_init')
  for (const v of initOnce?.values ?? []) {
    const input = aimed({ kind: 'once', id: 'set_init', value: v } as SceneInput)
    oncePicks.push({ id: `set_init:${v}`, name: `主動權設成 ${v}`, ap: initOnce!.ap, blocks: p.blocks(w, input, true), picks: [], pairs: [], preview: p.preview(w, input), input })
  }
  const floorOnce = p.onceOf(w, 'fit_floor')
  if (floorOnce) {
    const input = aimed({ kind: 'once', id: 'fit_floor' } as SceneInput)
    oncePicks.push({ id: 'fit_floor', name: `契合拉到 ${floorOnce.value}`, ap: floorOnce.ap, blocks: p.blocks(w, input, true), picks: [], pairs: [], preview: p.preview(w, input), input })
  }
  if (!solo && oncePicks.length > 0) granted.push({ id: 'once', name: ACTION_NAME.once, ap: Math.min(...oncePicks.map((x) => x.ap)), blocks: group(oncePicks, '現在沒有夜課的功夫可以用。'), picks: [], pairs: [], choices: oncePicks, preview: null })
  // 單人：加快、放慢取代主導、迎合，沒有挑逗、沒有圈；切換的是姿勢
  const soloActions: ActionOptionRaw[] = [simple('faster'), simple('slower'), simple('restrain'), skillAction, talkAction, itemAction, switchAction, gearAction, ...granted, simple('stop')]
  const actions: ActionOptionRaw[] = solo ? soloActions : [
    simple('dominate'), simple('yield'), simple('tease'), simple('restrain'),
    { id: 'skill', name: ACTION_NAME.skill, ap: minAp(skills), blocks: group(skills, '你還沒有學會任何在場景裡用得出來的技能。'), picks: [], pairs: [], choices: skills, preview: null },
    {
      id: 'talk', name: ACTION_NAME.talk, ap: p.rulesFor(w).cost.talk, blocks: p.blocks(w, talkInput, true), picks: picksOf(p, [...TALK_PARTS], talkTheirs, talkPairs), pairs: talkPairs,
      preview: p.preview(w, talkInput),
    },
    { id: 'item', name: ACTION_NAME.item, ap: minAp(items), blocks: group(items, '你身上沒有在場景裡用得出來的東西。'), picks: [], pairs: [], choices: items, preview: null },
    { id: 'switch', name: ACTION_NAME.switch, ap: costOf(p, { kind: 'switch', position: '' }, w), blocks: group(switches.filter((x) => x.id !== s.position), '沒有別的體位可以換。'), picks: [], pairs: [], choices: switches, preview: null },
    { id: 'gear', name: ACTION_NAME.gear, ap: 0, blocks: group(gears.filter((x) => x.id !== p.seat(w).gear), '沒有別的檔位可以換。'), picks: [], pairs: [], choices: gears, preview: null },
    ...circleActions,
    ...granted,
    simple('stop'),
  ]
  // 別的功能插進來的選項（掛點 scene.window）：每一個帶現在做不做得到的原因
  const inserted = sceneWindow(k, state, p).options.map((o) => ({ id: o.id, owner: o.owner, name: o.label, ap: costOf(p, o.input, w), blocks: p.blocks(w, o.input, true), input: o.input }))
  const listed: ActionOption[] = actions.map((a) => ({ ...a, targeted: !solo && TARGETED_ACTIONS.has(a.id) }))
  return { turn: p.who(s.turn), round: s.round, targets: p.activeOthers(w).map((id) => ({ id, name: state.actors[id]?.name ?? id })), ap: { now: p.seat(w).ap, max: p.apMax[w]! }, actions: listed, end_turn: { blocks: turn }, inserted }
}
