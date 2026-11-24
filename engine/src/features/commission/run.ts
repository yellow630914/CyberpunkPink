// L6 功能 commission 的流程：進去、選面、選分支、玩這一段（現實面）、里程碑、喘口氣、撤退、做完。
// 每個入口都是純函式：讀狀態、回傳報告草稿；不成立丟 ActionBlocked（原因是給玩家看的完整句子，一條一個條件）。
// 規格：COMMISSIONS 2.3、第 3、5 節、6.2 節；SITES 12.5 節；SERIES 第 6 節；dev/adr/0016 第一、二、五、六節與 G2、G9、G12；dev/work/M2-commission-run.md。
//
// 一段副本的狀態整份放在 state.ext.commission（model.ts 的 Run）：進去時存 entry 快照、每個階段選面時存 stage 快照（只留最新一份）。
// 現實面的一段：照分支的入口開一份地圖實例，把守備（遭遇的位階變成 enemy_pick）、增援、DC、警戒寫在實例的 ext 上，探索的功能照那份 ext 運作；
// 這個功能不知道探索與敵人的內部：只靠 ext 的慣用鍵、量表 alert 與單位來源 enemy_pick 的 UnitRef。

import type { Change, GameState, Kernel, Launch, MarkerDef, Origin, ReportDraft, UnitRef } from '../../core'
import {
  ActionBlocked, DEGREE_NAME, attachActivityEnd, clone, endActivity, formatAmount, gridHere, mapDef, meterOf, openMap, pointKey, restDone, rollCheck, Sheet,
} from '../../core'
import { settleAux } from './aux'
import { RETREAT_REWIND, resultOf, retreatEnd, settleDone } from './close'
import type { BranchDef, BranchKind, CommissionEntry, Face, FaceDef, GoalDef, Rank, Run, RouteEntry } from './model'
import {
  ACTIVITY, FAILED_EXT, FACE_ACTIVITY, FACE_NAME, KIND, branchName, clamp, commissionMapProblems, commissionProblems, commissionRules, dcBaseOf, effectsFor, encounterAfter, faceOf, gradeOf,
  isLast, netFx, normalSetup, readRun, runChange, stageName, stagesOf,
} from './model'

declare module '../../core' {
  interface HookMap {
    /**
     * 剛進一張地圖：問有沒有事要先處理（入口那一格就被保全看到）。回答的人回傳一份要接著提交的報告草稿（可以帶 launch 開戰）。
     * 副本的功能在每一段開了地圖、那份報告套用之後問一次；探索回答它（探索的 arrive）。沒有人回答就當沒事。
     */
    'map.arrive': [{ state: GameState; map: string }, ReportDraft | void]
  }
}

const isText = (v: unknown): v is string => typeof v === 'string' && v.trim().length > 0

function draft(state: GameState, action: string, result: string, summary: string, changes: Change[], extra: Partial<ReportDraft> = {}): ReportDraft {
  return {
    kind: 'gig', action, location: clone(state.location), ...(state.pc ? { actor: state.pc } : {}), party: [], timeline: [], changes,
    outcome: { result, summary }, ...extra,
  }
}

export function needRun(state: GameState): Run {
  const run = readRun(state)
  if (!run) throw new ActionBlocked('現在沒有在委託的副本裡。')
  return run
}

const STEP_TEXT: Record<Run['step'], string> = {
  face: '現在要先選這個階段玩哪一面。',
  branch: '這個階段的面選好了，現在要選分支。',
  play: '這一段已經開始了，先把它玩完。',
  done: '副本已經做完了。',
}

// ---- 面 ----

export interface FaceView {
  face: Face
  name: string
  /** 這個階段有沒有開這一面 */
  open: boolean
  /** 選不了的原因（完整的句子）；選得了是 null */
  block: string | null
  /** 玩家選了這一面 */
  chosen: boolean
  /** 隔離區的原因（沒拿到 locked_by 的連動；這時 block 也是這一句）；不是隔離區或已經打開就沒有這個欄位 */
  locked?: string
}

/** 隔離區的原因：這個階段的內海面寫了 locked_by，而這件委託還沒拿到那個連動。 */
export const AIRGAP_TEXT = '隔離區還沒有打開：要先在現實面插上資料埠。'
function lockOf(run: Run, face: Face): string | null {
  const lock = face === 'net' ? run.def.stages[run.stage - 1]?.faces.net?.locked_by : undefined
  return typeof lock === 'string' && !run.links.some((l) => l.id === lock) ? AIRGAP_TEXT : null
}

/** probing 是進副本時的檢查（每個階段都要有選得了的面）：隔離區不算擋（格式檢查保證更早的階段會給它的連動）。 */
function faceBlock(k: Kernel, run: Run, face: Face, probing = false): string | null {
  if (!run.def.stages[run.stage - 1]?.faces[face]) return '這個階段沒有開這一面。'
  if (isLast(run) && face !== run.def.main) return '決定性的一步只能在主面完成。'
  const locked = lockOf(run, face)
  if (locked && !probing) return locked
  if (face !== 'meat' && !k.activity.get(FACE_ACTIVITY[face])) return '這一面還沒有開放。'
  return null
}

/** 現在這個階段的三個面各自能不能選（沒有開的面也列出來）。 */
export function faceViews(k: Kernel, run: Run, probing = false): FaceView[] {
  return (['meat', 'net', 'opinion'] as const).map((face) => ({
    face, name: FACE_NAME[face], open: !!run.def.stages[run.stage - 1]?.faces[face], block: faceBlock(k, run, face, probing), chosen: run.face === face,
    ...(run.def.stages[run.stage - 1]?.faces[face] && lockOf(run, face) ? { locked: AIRGAP_TEXT } : {}),
  }))
}

// ---- 分支 ----

export interface BranchView {
  id: string
  kind: BranchKind
  name: string
  /** 選不了的原因；選得了是 null */
  block: string | null
  need?: BranchDef['need']
  /** 連動開出來的路、踩點開出來的路（畫面加小標） */
  mark?: 'link' | 'scouted'
}

const scoutedBranch = (run: Run, b: BranchDef): boolean => {
  const s = run.setup.scouted?.branches ?? []
  const key = b.need && 'scouted' in b.need ? b.need.scouted : undefined
  return s.includes(b.id) || (key !== undefined && s.includes(key))
}

/** 沒踩到的 scouted 分支不列（連名字都不給看）。 */
const listed = (run: Run, b: BranchDef): boolean => b.kind !== 'scouted' || scoutedBranch(run, b)

function branchBlock(k: Kernel, state: GameState, run: Run, b: BranchDef): string | null {
  const need = b.need
  if (!need) return null
  if ('basic' in need) {
    const have = state.pc ? (state.actors[state.pc]?.skills[need.basic] ?? 0) : 0
    return have >= need.level ? null : `${k.stats.skillName(need.basic)}要 ${need.level} 級才走得了這條路（你現在 ${have} 級）。`
  }
  if ('link' in need) {
    const l = run.def.links[need.link]
    return run.links.some((x) => x.id === need.link) ? null : `還沒拿到連動「${l?.name ?? need.link}」。`
  }
  if ('cash' in need) return state.money.cash >= need.cash ? null : `要付 ${formatAmount(need.cash)} 現金，你現在只有 ${formatAmount(state.money.cash)}。`
  return null
}

/** 這一面的分支（強攻一定在；沒踩到的 scouted 不列），每條帶選不了的原因。 */
export function branchViews(k: Kernel, state: GameState, run: Run): BranchView[] {
  const face = faceOf(run)
  if (!face) return []
  return face.branches.filter((b) => listed(run, b)).map((b) => ({
    id: b.id, kind: b.kind, name: branchName(b), block: branchBlock(k, state, run, b),
    ...(b.need ? { need: clone(b.need) } : {}),
    ...(b.kind === 'linked' ? { mark: 'link' as const } : b.kind === 'scouted' ? { mark: 'scouted' as const } : {}),
  }))
}

// ---- 進去 ----

function resolveDef(k: Kernel, raw: unknown): CommissionEntry {
  if (isText(raw)) {
    const e = k.content.get<CommissionEntry>(KIND, raw)
    if (!e) throw new ActionBlocked(`沒有 ${raw} 這件委託的副本。`)
    return clone(e)
  }
  const e = raw as Record<string, unknown>
  if (!isText(e.id)) throw new ActionBlocked('整筆副本的資料要有 id。')
  const problems = [...commissionProblems(e), ...(commissionProblems(e).length === 0 ? commissionMapProblems(k, e as unknown as CommissionEntry) : [])]
  if (problems.length > 0) throw new ActionBlocked(`這件副本的資料有問題：${problems.slice(0, 3).join('；')}。`)
  return clone(e) as unknown as CommissionEntry
}

/** 開副本（活動 commission 的 start）：回傳進去的那一份報告。 */
export function enterDraft(k: Kernel, state: GameState, setup: unknown, origin: Origin): ReportDraft[] {
  const s = normalSetup(setup)
  if (typeof s === 'string') throw new ActionBlocked(s)
  if (readRun(state)) throw new ActionBlocked('已經在一件委託的副本裡了，要先做完或撤退。')
  if (!state.pc) throw new ActionBlocked('還沒有主角，進不了副本。')
  const def = resolveDef(k, s.def)
  const run: Run = {
    def, origin: clone(origin), setup: s.setup, stage: 1, step: 'face', links: [], route: [], alert: s.alert_start, peak: s.alert_start, trace: s.trace_start, net_peak: s.trace_start,
    breathed: false, started: clone(state.time),
  }
  // 每個階段都要有選得了的面：一個可選的面都沒有的階段，這件副本進去了也做不完
  for (let n = 1; n <= stagesOf(run); n++) {
    const probe = { ...run, stage: n }
    if (!faceViews(k, probe, true).some((f) => f.block === null)) {
      const names = (Object.keys(def.stages[n - 1]!.faces) as Face[]).map((f) => FACE_NAME[f]).join('、')
      throw new ActionBlocked(`${stageName(def, n)}沒有選得了的面（這個階段只開了${names}，那一面還沒有開放），這件副本現在進不去。`)
    }
  }
  const needsPick = def.stages.some((st) => st.faces.meat && (st.faces.meat.encounter?.length ?? 0) > 0)
  if (needsPick && !k.battle.getUnitSource('enemy_pick')) throw new ActionBlocked('這件副本的遭遇要照勢力挑敵人，但還沒有「enemy_pick」這種單位來源（敵人的功能沒有裝）。')
  return [draft(state, 'commission.enter', 'entered', `你進了「${def.name ?? def.id}」，共 ${stagesOf(run)} 個階段。`, [
    { op: 'snapshot.take', kind: 'entry', label: '進入副本前', owner: def.id },
    // 上一趟失敗留下的記號到這裡就沒有用了（回退之後它由 rewind.keep 帶過去，不是從快照來的）
    ...(state.ext[FAILED_EXT] !== undefined ? [{ op: 'ext', key: FAILED_EXT, value: null } as Change] : []),
    runChange(run),
  ])]
}

// ---- 選面 ----

export function chooseFace(k: Kernel, state: GameState, face: Face): ReportDraft {
  const run = needRun(state)
  if (run.step !== 'face') throw new ActionBlocked(STEP_TEXT[run.step])
  const view = faceViews(k, run).find((f) => f.face === face)
  if (!view) throw new ActionBlocked('沒有這一面。')
  if (view.block) throw new ActionBlocked(view.block)
  const n = run.stage
  // 輔助面先結算（COMMISSIONS 6.2 節：先結算輔助面，再進玩家選的那一面，所以拿到的連動這個階段就生效）
  const aux = settleAux(k, state, { ...run, step: 'branch', face })
  const next: Run = aux ? aux.run : { ...run, step: 'branch', face }
  const lines = aux?.lines ?? []
  return draft(state, 'commission.face', 'face', `第 ${n} 階段：你選了${FACE_NAME[face]}面。`, [
    // 階段開始時存一份（只留最新的一份）：第一筆變更，存的是還沒選面的狀態（戰敗的「回到這個階段開始時」回到這裡）
    { op: 'snapshot.take', kind: 'stage', label: `${stageName(run.def, n)}開始時`, owner: run.def.id, replace: true },
    ...(aux?.changes ?? []),
    runChange(next),
  ], {
    ...(aux && aux.timeline.length > 0 ? { timeline: aux.timeline } : {}),
    ...(lines.length > 0 ? { narration: { results: lines } } : {}),
    triggers: [{ point: 'stage', where: stageWhere(run, face) }],
  })
}

/** 導演篩事件用的 where：委託的類型、這一面、目標勢力、詞條（EVENTS 4.4 節）。stage 與 pressure 兩個觸發點共用。 */
const stageWhere = (run: Run, face: Face): Record<string, unknown> => ({ kind: run.def.kind, face, faction: run.def.target_faction, ...(run.def.modifiers ? { tags: clone(run.def.modifiers) } : {}) })

/**
 * 警戒漲到門檻（EVENTS 3.1 節：壓力條跨過 60）：這個階段第一次到，就接一份 commission.pressure，帶 pressure 觸發點，導演多擲一次（15%）；
 * 同一階段發過就不再發（run.pressured）；開地圖時就已經在門檻以上的不算「跨過」（chooseBranch 開地圖時就記成發過）。
 * 只看現實面、地圖還開著的時候；戰鬥中不發（戰鬥的每一步不跑回合流程，導演看不到它），打完那一份報告再發。
 */
export function pressureDraft(k: Kernel, state: GameState, run: Run): ReportDraft | undefined {
  if (run.pressured || run.step !== 'play' || run.face !== 'meat' || !run.map || !state.maps.instances[run.map] || !k.meters.get('alert')) return undefined
  if (meterOf(k, state, 'alert', run.map) < commissionRules(k).pressure_at) return undefined
  const text = '警戒升高了，附近的氣氛不對勁。'
  return draft(state, 'commission.pressure', 'pressure', text, [runChange({ ...run, pressured: true })], {
    triggers: [{ point: 'pressure', where: stageWhere(run, 'meat') }],
  })
}

// ---- 選分支 ----

const SKILL_ATTR: Record<string, string> = { stealth: 'reflex', perform: 'charm', negotiate: 'charm', seduce: 'charm', mechanics: 'tech', interface: 'intellect', athletics: 'body' }
const DEFAULT_SKILLS: Partial<Record<BranchKind, string[]>> = { stealth: ['stealth', 'perform'], talk: ['negotiate', 'seduce'] }

interface Rolled { roll: ReturnType<typeof rollCheck>; skill: string }

/** 擲一次檢定（主角）：幾種基本功都行時取合計最高的。骰面從存檔的亂數導出，報告裡的 rng 變更讓下一次換一顆。 */
function rollFor(k: Kernel, state: GameState, skills: string[], dc: number, purpose: string, tags: string[]): Rolled {
  const actor = state.pc
  if (!actor || !state.actors[actor]) throw new ActionBlocked('還沒有主角。')
  let best: Rolled | undefined
  for (const skill of skills) {
    const attr = ((k.content.get('skill', skill)?.attr as string | undefined) ?? SKILL_ATTR[skill] ?? 'charm') as never
    const roll = rollCheck(k.stats, state, { actor, attr, skill, dc, purpose, tags })
    if (!best || roll.total > best.roll.total) best = { roll, skill }
  }
  return best!
}

const passedRoll = (r: Rolled): boolean => r.roll.degree === 'critical' || r.roll.degree === 'success'

const rollBeat = (k: Kernel, state: GameState, r: Rolled, text: string): ReportDraft['timeline'][number] => ({
  layer: 'meat', ...(state.pc ? { actor: state.pc } : {}), tag: 'commission.roll', roll: r.roll, data: { skill: r.skill, dc: r.roll.dc },
  text: `${text}（${k.stats.skillName(r.skill)}）：${DEGREE_NAME[r.roll.degree]}（骰 ${r.roll.natural}，合計 ${r.roll.total}，對 DC ${r.roll.dc}）`,
})

/**
 * 這一面的那個位階的敵人（勢力是目標勢力、等級是副本的等級；seed 用委託、階段與第幾個）。
 * attached 是這一場遭遇的附屬單位（面的 attached 欄位，詞條「獵犬」那類）：只寫在第一個敵人的 UnitRef 上（enemy_pick 會照 UnitRef.attached 蓋掉兵種自己的）。
 */
const foeRef = (def: CommissionEntry, n: number, grade: number, rank: Rank, i: number | string, attached?: unknown[]): UnitRef => ({
  from: 'enemy_pick', faction: def.target_faction, grade, rank, seed: `${def.id}/${n}/${i}`,
  ...(attached && attached.length > 0 ? { attached: attached.map((a) => ({ ...(a as object) })) } : {}),
})

interface MapPlan {
  changes: Change[]
  map: string
  start_alert: number
  frozen: boolean
  /** 給玩家看的一句話：連動怎麼幫上忙 */
  notes: string[]
}

function firstGuard(sheet: Sheet): MarkerDef | undefined {
  return (sheet.def.cells ?? []).find((c) => c.mark === 'G')
}

function sheetIdOf(k: Kernel, face: FaceDef): { map: ReturnType<typeof mapDef>; sheet: string } {
  const map = mapDef(k, String(face.map))
  return { map, sheet: face.sheet ?? map.sheets[0]!.id }
}

/** 連動 controls 的效果：true 是這張地圖每一張圖的全部控制區，清單原樣；寫成 "<圖的 id>:<區塊>"（探索認的寫法）。 */
function controlledZones(map: ReturnType<typeof mapDef>, want: true | string[] | null): string[] {
  if (want === null) return []
  const all = want === true ? map.sheets.flatMap((sh) => (sh.controls ?? []).flatMap((c) => c.zones.map((z) => `${sh.id}:${z}`))) : want
  return [...new Set(all)]
}

/**
 * 開這一段的地圖（現實面）：照連動的效果算遭遇與入口、寫好實例的 ext、把警戒放到新的實例上。
 * alertFrom 是這一段開始前的警戒；失敗的潛行再加 stealth_fail_alert。
 */
function planMeat(k: Kernel, state: GameState, run: Run, b: BranchDef, extraAlert: number, resume?: number): MapPlan {
  const rules = commissionRules(k)
  const def = run.def
  const n = run.stage
  const face = faceOf(run, n, 'meat')!
  const fx = effectsFor(run, n)
  const baseGrade = gradeOf(def.grade)!
  // resume：離開了地圖又回來，警戒照離開時的（連動的加減與失敗的加成不再算第二次）
  const start = resume !== undefined ? clamp(resume, 0, 100) : clamp(run.alert + fx.alertDelta + extraAlert, 0, 100)
  // 警戒到 100：最後一個階段的遭遇升一級（G9；最高 V）
  const hard = isLast(run) && start >= rules.hard_alert
  const grade = hard ? Math.min(5, baseGrade + rules.hard_grade_up) : baseGrade
  const base = encounterAfter((face.encounter ?? []) as Rank[], fx)
  // 目標勢力對你的敵對值到了「找麻煩」：有守備的階段多幾個雜兵（遭遇預算 +N 點；沒有守備的階段不加）
  const ranks: Rank[] = base.length > 0 ? [...base, ...Array.from({ length: run.setup.encounter_plus ?? 0 }, (): Rank => 'minion')] : base
  const { map, sheet: sheetId } = sheetIdOf(k, face)
  const sheet = new Sheet(map.sheets.find((s) => s.id === sheetId)!)
  const post = face.post !== undefined ? sheet.marker(face.post) : firstGuard(sheet)
  const guards = post && ranks.length > 0 ? { [post.id]: { foes: ranks.map((r, i) => foeRef(def, n, grade, r, i + 1, i === 0 ? face.attached as unknown[] | undefined : undefined)), faction: def.target_faction } } : {}
  const scoutedGuards = (run.setup.scouted?.guards ?? []).includes(n)
  const stealth = run.route.at(-1)?.stealth === true
  // 內海那邊接管了控制節點：連動寫明的控制區（或這張地圖全部的）進 ext.controlled，探索本來就認
  const controlled = controlledZones(map, fx.controls)
  const ext: Record<string, unknown> = {
    commission: def.id, stage: n, grade: baseGrade, dc_base: dcBaseOf(rules, baseGrade), guards,
    ...(controlled.length > 0 ? { controlled } : {}),
    reinforce: Array.from({ length: rules.reinforce_count }, (_, i) => foeRef(def, n, grade, 'minion', `r${i + 1}`)),
    // 守備沒有踩到：敵人多一次先攻的機會（G7）；踩到了就沒有
    ...(scoutedGuards ? {} : { edge: 'foe' }),
    ...(stealth ? { stealth: true } : {}),
    origin: {
      by: 'commission', commission: def.id, stage: n, face: 'meat',
      ...(def.defeat_event !== undefined ? { defeat_event: def.defeat_event } : {}),
      ...(typeof def.employer === 'string' ? { employer: def.employer } : isText((run.setup.terms as { employer?: unknown } | undefined)?.employer) ? { employer: (run.setup.terms as { employer: string }).employer } : {}),
    },
  }
  // 直接站到遭遇點：入口換成保全崗那一格
  const direct = fx.skip && post !== undefined
  const opened = openMap(k, state, String(face.map), { owner: def.id, sheet: sheetId, at: direct ? post.id : (b.entry as string), ext })
  const changes: Change[] = [...opened.changes]
  if (k.meters.get('alert')) changes.push({ op: 'meter', kind: 'alert', key: opened.id, set: start })
  const notes: string[] = []
  if (fx.from.length > 0) notes.push(`連動生效：${fx.from.map((id) => def.links[id]?.name ?? id).join('、')}。`)
  if (ranks.length < (face.encounter?.length ?? 0)) notes.push(`守備只剩 ${ranks.length} 個。`)
  if (ranks.length > base.length) notes.push('對方認得你，守備多了人。')
  if (controlled.length > 0) notes.push('內海那邊接管了控制節點，那幾區的監視器與門鎖聽你的。')
  if (direct) notes.push('不必探索，直接到了遭遇的地方。')
  if (hard) notes.push('警戒滿了，這一段的敵人高了一級。')
  return { changes, map: opened.id, start_alert: start, frozen: fx.frozen, notes }
}

/**
 * 別的面的玩法（活動 face.net、face.opinion）的開法：setup 帶這一段的條件，origin 是這件委託。
 * 內海面多給（dev/adr/0018 第九節）：fx（連動對這一段的效果，副本算好了給）、trace（整趟到目前為止的追蹤度）、decisive、where、defeat_event、employer；
 * 面的資料（layer、encounter、lace、facility、objective、controls）原樣帶過去。
 */
function faceLaunch(run: Run, b: BranchDef, stealth: boolean): Launch {
  const face = faceOf(run)!
  const { branches: _b, gives: _g, goal: _goal, locked_by: _l, ...rest } = face
  const net = run.face === 'net'
  const terms = run.setup.terms as { employer?: unknown } | undefined
  return {
    kind: FACE_ACTIVITY[run.face as Exclude<Face, 'meat'>],
    setup: {
      commission: run.def.id, stage: run.stage, face: run.face, branch: b.id, branch_kind: b.kind, stealth, grade: gradeOf(run.def.grade), faction: run.def.target_faction,
      links: run.links.map((l) => l.id), alert: run.alert, ...clone(rest),
      ...(net ? {
        fx: netFx(effectsFor(run, run.stage)), trace: run.trace, decisive: isLast(run), where: stageWhere(run, 'net'),
        ...(run.def.defeat_event !== undefined ? { defeat_event: run.def.defeat_event } : {}),
        ...(typeof run.def.employer === 'string' ? { employer: run.def.employer } : isText(terms?.employer) ? { employer: terms.employer } : {}),
      } : {}),
    },
    origin: { by: 'commission', ref: run.def.id, ext: { commission: run.def.id, stage: run.stage, face: run.face } },
  }
}

export function chooseBranch(k: Kernel, state: GameState, branchId: string): ReportDraft {
  const run = needRun(state)
  if (run.step !== 'branch' || !run.face) throw new ActionBlocked(STEP_TEXT[run.step])
  const face = faceOf(run)!
  const b = face.branches.find((x) => x.id === branchId && listed(run, x))
  if (!b) throw new ActionBlocked('這一面沒有這條路。')
  const block = branchBlock(k, state, run, b)
  if (block) throw new ActionBlocked(block)

  const rules = commissionRules(k)
  const n = run.stage
  const changes: Change[] = []
  const timeline: ReportDraft['timeline'] = []
  const lines: string[] = []
  let roll: RouteEntry['roll']
  // 潛行與交涉：選了擲一次（DC 基準 = 10 ＋ 等級 × 2；帶 infiltrate 標籤）。過了這一段是潛行的，沒過警戒 +10、照強攻走
  if (b.kind === 'stealth' || b.kind === 'talk') {
    const skills = b.need && 'basic' in b.need ? [b.need.basic] : DEFAULT_SKILLS[b.kind]!
    const dc = dcBaseOf(rules, gradeOf(run.def.grade)!)
    const r = rollFor(k, state, skills, dc, `commission/${run.def.id}/${n}/branch`, ['commission', 'infiltrate', b.kind])
    changes.push({ op: 'rng', advance: 1 })
    roll = passedRoll(r) ? 'pass' : 'fail'
    timeline.push(rollBeat(k, state, r, b.kind === 'stealth' ? '潛進去' : '交涉'))
  }
  if (b.need && 'cash' in b.need && b.need.cash > 0) {
    changes.push({ op: 'cash', delta: -b.need.cash })
    lines.push(`付了 ${formatAmount(b.need.cash)} 現金。`)
  }
  const entry: RouteEntry = { stage: n, face: run.face, branch: b.id, kind: b.kind, ...(roll ? { roll } : {}), ...(roll === 'pass' ? { stealth: true } : {}) }
  const next: Run = { ...run, step: 'play', branch: b.id, route: [...run.route, entry], won: false, checked: false, done: false }
  delete next.scene
  delete next.no_gives
  const how = roll === 'pass' ? '成功了，這一段是悄悄進去的。' : roll === 'fail' ? `沒有成功，警戒 +${rules.stealth_fail_alert}，只好照強攻走。` : ''
  const launch: Launch[] = []
  if (run.face === 'meat') {
    const plan = planMeat(k, state, { ...run, route: next.route }, b, roll === 'fail' ? rules.stealth_fail_alert : 0)
    changes.push(...plan.changes)
    next.map = plan.map
    next.start_alert = plan.start_alert
    next.frozen = plan.frozen
    if (plan.start_alert >= rules.pressure_at) next.pressured = true
    lines.push(...plan.notes)
  } else {
    // 別的面：把它的玩法開起來，等它的 activity.end（M3、M5）
    launch.push(faceLaunch(run, b, roll === 'pass'))
    delete next.map
  }
  changes.push(runChange(next))
  const out = draft(state, 'commission.branch', roll ?? 'chosen', `第 ${n} 階段・${FACE_NAME[run.face]}面：走「${branchName(b)}」。${how}`, changes, {
    timeline, narration: { results: lines },
    ...(launch.length ? { launch } : {}),
  })
  return out
}

// ---- 目標 ----

export interface GoalView {
  kind: GoalKind2
  /** 給玩家看的一句話 */
  text: string
  done: boolean
}
type GoalKind2 = GoalDef['kind'] | 'face'

function markerFor(k: Kernel, run: Run, id: string): { sheet: string; marker: MarkerDef } | undefined {
  const face = faceOf(run, run.stage, 'meat')
  if (!face || !isText(face.map)) return undefined
  const map = mapDef(k, face.map)
  const first = face.sheet ?? map.sheets[0]!.id
  for (const sh of [map.sheets.find((s) => s.id === first), ...map.sheets.filter((s) => s.id !== first)]) {
    const m = sh?.cells?.find((c) => c.id === id)
    if (sh && m) return { sheet: sh.id, marker: m }
  }
  return undefined
}

/** 遭遇放的保全崗（G 標記）：寫了 post 用寫的，沒寫是版面上第一個 G。 */
function postOf(k: Kernel, run: Run): { sheet: string; marker: MarkerDef } | undefined {
  const face = faceOf(run, run.stage, 'meat')
  if (!face || !isText(face.map)) return undefined
  if (face.post !== undefined) return markerFor(k, run, face.post)
  const map = mapDef(k, face.map)
  const sh = map.sheets.find((x) => x.id === (face.sheet ?? map.sheets[0]!.id))
  const m = sh?.cells?.find((c) => c.mark === 'G')
  return sh && m ? { sheet: sh.id, marker: m } : undefined
}

const usedAt = (state: GameState, map: string, sheet: string, m: MarkerDef): boolean => !!state.maps.instances[map]?.sheets[sheet]?.cells[pointKey(m.at[0], m.at[1])]?.used
const standingAt = (state: GameState, map: string, sheet: string, m: MarkerDef): boolean => {
  const at = state.maps.at
  return !!at && at.map === map && at.sheet === sheet && at.x === m.at[0] && at.y === m.at[1]
}

/** 這一段的目標現在做到哪：現實面看標記與位置，別的面看它的玩法交回的結果。 */
export function goalView(k: Kernel, state: GameState, run: Run): GoalView {
  if (run.face !== 'meat') return { kind: 'face', text: `完成${run.face ? FACE_NAME[run.face] : ''}面這一段。`, done: run.done === true }
  const face = faceOf(run)
  const goal: GoalDef = face?.goal ?? { kind: 'fight' }
  const map = run.map
  const live = !!map && !!state.maps.instances[map]
  switch (goal.kind) {
    case 'fight': {
      // 潛行過了的一段不開打：走到遭遇的地方（保全崗那一格）就算過了這一場
      const post = run.route.at(-1)?.stealth === true && live ? postOf(k, run) : undefined
      const bypass = !!post && standingAt(state, map!, post.sheet, post.marker)
      return { kind: 'fight', text: '打贏這一段的遭遇（潛行的話，走到遭遇的地方就算過了）。', done: run.won === true || bypass }
    }
    case 'reach': {
      const m = markerFor(k, run, goal.at)
      return { kind: 'reach', text: `走到${m?.marker.name ?? goal.at}。`, done: live && !!m && standingAt(state, map!, m.sheet, m.marker) }
    }
    case 'take': {
      const m = markerFor(k, run, goal.at)
      const here = live ? gridHere(k, state) : null
      const onExit = !!here && here.at.map === map && here.sheet.markerAt(here.at.x, here.at.y)?.mark === 'X'
      const got = live && !!m && usedAt(state, map!, m.sheet, m.marker)
      return { kind: 'take', text: got ? '東西拿到了，帶著它走到撤離點。' : `拿到${m?.marker.name ?? goal.at}的東西，再走到撤離點。`, done: got && onExit }
    }
    case 'check':
      return { kind: 'check', text: `在${markerFor(k, run, goal.at)?.marker.name ?? goal.at}動手（要擲一次）。`, done: run.checked === true }
    case 'scene':
      return { kind: 'scene', text: run.scene === 'failed' ? '場景沒有達到目的，可以再來一次。' : '進行一場有目的的場景。', done: run.scene === 'done' }
  }
}

/** 一段做完了嗎（里程碑的條件）。 */
export const achieved = (k: Kernel, state: GameState, run: Run): boolean => run.step === 'play' && goalView(k, state, run).done

// ---- 里程碑 ----

/** 這一段做完：時間 +2 小時（G2）、給連動、把這張地圖的警戒收回狀態、關地圖、進下一個階段（最後一個是 done，接著 finish）。 */
export function milestone(k: Kernel, state: GameState): ReportDraft {
  const run = needRun(state)
  if (run.step !== 'play') throw new ActionBlocked(STEP_TEXT[run.step])
  if (!achieved(k, state, run)) throw new ActionBlocked('這一段的目標還沒有達成。')
  const rules = commissionRules(k)
  const n = run.stage
  const face = faceOf(run)
  const changes: Change[] = []
  const lines: string[] = []
  if (rules.stage_minutes > 0) changes.push({ op: 'time', minutes: rules.stage_minutes })

  // 警戒：收回這張地圖的；連動「警戒不漲」是回到這一段開始的樣子
  let alert = run.alert
  if (run.face === 'meat' && run.map) {
    alert = clamp(run.frozen ? (run.start_alert ?? run.alert) : meterOf(k, state, 'alert', run.map), 0, 100)
    if (state.maps.at?.map === run.map) changes.push({ op: 'map.at', to: null })
    if (state.maps.instances[run.map]) changes.push({ op: 'map.close', id: run.map })
  }
  const links = [...run.links]
  if (face?.gives && run.no_gives) lines.push(`內海那一段沒有接管任何控制節點，連動「${run.def.links[face.gives]?.name ?? face.gives}」沒有拿到。`)
  else if (face?.gives && !links.some((l) => l.id === face.gives)) {
    links.push({ id: face.gives, from: n, face: run.face! })
    lines.push(`拿到連動「${run.def.links[face.gives]?.name ?? face.gives}」。`)
  }
  const last = isLast(run)
  const next: Run = { ...run, stage: n + 1, step: last ? 'done' : 'face', links, alert, peak: Math.max(run.peak, alert), breathed: false }
  for (const key of ['face', 'branch', 'map', 'start_alert', 'frozen', 'won', 'checked', 'scene', 'done', 'pressured', 'no_gives'] as const) delete next[key]
  changes.push(runChange(next))
  return draft(state, 'commission.milestone', last ? 'decisive' : 'milestone', `${stageName(run.def, n)}完成，城裡過了 ${rules.stage_minutes / 60} 小時。${last ? '決定性的一步做到了。' : ''}`, changes, { narration: { results: lines } })
}

// ---- 一次動手的檢定、場景、再來一次 ----

/** 目標是 check：站在標記上擲 basic 對 DC 基準；過了就達成，沒過警戒 +check_fail_alert 可以再試。 */
export function checkGoal(k: Kernel, state: GameState): ReportDraft {
  const run = needRun(state)
  if (run.step !== 'play') throw new ActionBlocked(STEP_TEXT[run.step])
  const goal = faceOf(run)?.goal
  if (run.face !== 'meat' || !goal || goal.kind !== 'check') throw new ActionBlocked('這一段的目標不是動手的檢定。')
  if (run.checked) throw new ActionBlocked('這一次動手已經成功了。')
  const m = markerFor(k, run, goal.at)
  if (!run.map || !state.maps.instances[run.map] || !m || !standingAt(state, run.map, m.sheet, m.marker)) throw new ActionBlocked(`要先走到${m?.marker.name ?? goal.at}才能動手。`)
  const rules = commissionRules(k)
  const r = rollFor(k, state, [goal.basic], dcBaseOf(rules, gradeOf(run.def.grade)!), `commission/${run.def.id}/${run.stage}/check`, ['commission', 'check'])
  const ok = passedRoll(r)
  const changes: Change[] = [{ op: 'rng', advance: 1 }]
  if (ok) {
    changes.push({ op: 'map.sheet', map: run.map, sheet: m.sheet, cells: { [pointKey(m.marker.at[0], m.marker.at[1])]: { used: true } } })
    changes.push(runChange({ ...run, checked: true }))
  } else if (rules.check_fail_alert > 0 && k.meters.get('alert')) changes.push({ op: 'meter', kind: 'alert', key: run.map, delta: rules.check_fail_alert })
  const summary = ok ? `在${m.marker.name}動手成功了。` : `在${m.marker.name}動手沒有成功${rules.check_fail_alert > 0 ? `，警戒 +${rules.check_fail_alert}` : ''}，可以再試。`
  return draft(state, 'commission.check', ok ? 'done' : 'failed', summary, changes, { timeline: [rollBeat(k, state, r, `在${m.marker.name}動手`)] })
}

/** 目標是 scene：開那場成人場景（活動 scene）；沒有人登記它就做不了。做完從 activity.end 拿到目的有沒有達成。 */
export function playScene(k: Kernel, state: GameState): ReportDraft {
  const run = needRun(state)
  if (run.step !== 'play') throw new ActionBlocked(STEP_TEXT[run.step])
  const goal = faceOf(run)?.goal
  if (run.face !== 'meat' || !goal || goal.kind !== 'scene') throw new ActionBlocked('這一段的目標不是場景。')
  if (run.scene === 'done') throw new ActionBlocked('這一場已經達成目的了。')
  if (!k.activity.get('scene')) throw new ActionBlocked('這一段的場景還沒有開放。')
  return draft(state, 'commission.scene', 'launch', '你要進行這一段的場景。', [], {
    launch: [{
      kind: 'scene', setup: { with: [goal.with], nature: goal.nature ?? 'work', goal: goal.goal },
      origin: { by: 'commission', ref: run.def.id, ext: { commission: run.def.id, stage: run.stage, face: 'meat' } },
    }],
  })
}

/**
 * 再來一次：這一段的地圖已經離開了（走到撤離點、卻還沒做完目標），或別的面的玩法結束了卻沒有達成。
 * 現實面：回到這一條路的入口重開一份地圖（警戒照離開時的；打過的保全崗不記得）；別的面：把那個玩法再開一次。
 */
export function replay(k: Kernel, state: GameState): ReportDraft {
  const run = needRun(state)
  if (run.step !== 'play' || !run.branch || !run.face) throw new ActionBlocked(STEP_TEXT[run.step])
  const b = faceOf(run)!.branches.find((x) => x.id === run.branch)
  if (!b) throw new ActionBlocked('找不到這一段選的那條路。')
  if (run.face !== 'meat') {
    if (run.done) throw new ActionBlocked('這一面已經做完了。')
    return draft(state, 'commission.replay', 'launch', `再來一次：${FACE_NAME[run.face]}面。`, [], { launch: [faceLaunch(run, b, run.route.at(-1)?.stealth === true)] })
  }
  if (run.map && state.maps.instances[run.map]) throw new ActionBlocked('這一段的地圖還開著，不用再進去。')
  const left = run.map ? meterOf(k, state, 'alert', run.map) : (run.start_alert ?? run.alert)
  const plan = planMeat(k, state, run, b, 0, left)
  return draft(state, 'commission.replay', 'replay', `你回到這一段的入口，再試一次（警戒 ${left}）。`, [...plan.changes, runChange({ ...run, map: plan.map, start_alert: plan.start_alert, won: false })], { narration: { results: plan.notes } })
}

// ---- 喘口氣 ----

export function breatheBlock(state: GameState, run: Run): string | null {
  if (state.battle) return '戰鬥中不能喘口氣。'
  if (run.step !== 'face' || run.stage < 2) return '要做完一個階段之後、下一個階段開始之前，才能喘一口氣。'
  if (run.breathed) return '這兩個階段之間已經喘過一口氣了。'
  return null
}

/** 階段之間喘一口氣（每兩個階段之間一次，不花時間）：發 rest.done（stage），「每次休息回滿」的東西聽它。 */
export function breathe(k: Kernel, state: GameState): ReportDraft {
  const run = needRun(state)
  const block = breatheBlock(state, run)
  if (block) throw new ActionBlocked(block)
  const changes = [...restDone(k, state, 'stage'), runChange({ ...run, breathed: true })]
  return draft(state, 'commission.breathe', 'breathed', '你在兩個階段之間喘了一口氣，彈匣補滿，感載與餘韻帶著走。', changes)
}

// ---- 撤退與做完 ----

/** 撤退：回到進去之前（時間、錢、背包、警戒、旗標、階段進度全部回去；紀錄留著並標成被收回），委託的活動結束。戰鬥中不能撤退。 */
export function retreat(k: Kernel, state: GameState): ReportDraft {
  const run = needRun(state)
  if (state.battle) throw new ActionBlocked('戰鬥中不能撤退，先把這一場打完。')
  const end = retreatEnd(k, state, run)
  return attachActivityEnd(draft(state, 'commission.retreat', 'retreat', '你撤退了。', end.changes, {
    narration: { results: end.lines },
    rewind: { ...RETREAT_REWIND },
  }), end)
}

/** 最後一個階段做完之後：發 activity.end（outcome: done），清掉狀態與入口、階段的快照。 */
export function finish(k: Kernel, state: GameState): ReportDraft {
  const run = needRun(state)
  if (run.step !== 'done') throw new ActionBlocked(run.step === 'play' ? '最後一個階段還沒有做完。' : STEP_TEXT[run.step])
  // 評價、路線留下的後果（敵對值）、歷練點（close.ts）：變更接在清掉狀態的後面，結果（rating、xp、terms……）交給 activity.end
  const settled = settleDone(k, state, run)
  const end = endActivity(k, { state, kind: ACTIVITY, id: run.def.id, origin: run.origin, outcome: 'done', result: resultOf(run, settled.result) })
  const mine = state.snapshots.filter((s) => s.owner === run.def.id && (s.kind === 'entry' || s.kind === 'stage'))
  const changes: Change[] = [{ op: 'ext', key: 'commission', value: null }, ...mine.map((s) => ({ op: 'snapshot.drop', id: s.id }) as Change), ...settled.changes, ...end.changes]
  return attachActivityEnd(draft(state, 'commission.finish', 'done', `「${run.def.name ?? run.def.id}」做完了。`, changes, { narration: { results: [...settled.lines, ...end.lines] } }), end)
}
