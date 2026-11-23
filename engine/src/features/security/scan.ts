// L6 功能 security 的掃橋（LIFE 2.1～2.3 節；EQUIPMENT 6.3、6.4 節；UI 3.11 節；dev/adr/0016 第一、四節與 G17；dev/work/M2-security.md）。
//
// 掃橋是一個統一的動作：別的功能（交通的閘門、冠冕門、企業的入口……）在報告上寫 launch: [{ kind: 'scan', setup, origin }]，
// 做完從 activity.end（kind 是 scan）拿到 result: { passed, how }。順序是看身分、看那個勢力的敵對值、看身上會被掃到的東西（問 scan.carried）。
//   強度 0、或什麼都沒掃到而且沒被認出來：直接一份 scan.pass，發 activity.end（passed: true）。
//   其餘：開一件內嵌的事件（活動 event）讓玩家選照常過、用假身分（身上有才列）、掉頭；事件做完，這裡的 activity.end 處理函式
//   把結果換成 scan 的 activity.end 交回原本發起的人（併進事件結束的那一份報告）。
//   沒有人登記事件視窗時（沒裝 director）：當成照常過，直接結算。
// 活動 scan 本身沒有「進行中」：開著的那一段是事件視窗，掃橋自己的資料（點、強度、勢力）記在 state.ext.security_scan，給 scanView 與選項的條件讀。
//
// 結果的規則（設計書沒寫的先做成預設，列在回報裡）：
//   身分：強度 1 以上的點至少要市民（無籍沒有橋 ID 可掃）；need_class 另外要求；社員 > 市民＝契約人 > 無籍。身分不夠：只有掉頭走得通，假身分也沒用。
//   敵對值：記名（20）以上，用假身分的檢定 +2 難度；通緝（100）：照常過與假身分都不通，只有掉頭。
//   假身分（ADR G17）：等級（一次性 1、淺層 2、深層 3）不低於強度就過；低一級擲表演對 13 ＋ 強度 × 2（記名以上再 +2）；更低不能用。
//     一次性的用掉就沒了；擲失敗被識破：那一張被收走、那個勢力的敵對值上升、這次沒過。
//   東西：照合法性（LIFE 3.1 節）：違禁的沒收；許可類沒有執照（帶 license 標籤的物品）也沒收；自由與登記類放行。被沒收：那個勢力敵對值上升、這次沒過（拘留不做）。

import type { ActivityDef, Change, Condition, ContentEntry, GameState, Kernel, Origin, ReportDraft } from '../../core'
import { ActionBlocked, ATTR_IDS, attachActivityEnd, checkParts, clone, computeDegree, dcFor, effectCtx, endActivity, isRecord, meterOf } from '../../core'
import type { FakeId, IdentityClass, ScanSetup, TierView } from './model'
import {
  CLASS_NAME, FAKE_ATTR, FAKE_SKILL, OWNER, SCAN_EXT, STRENGTH_NOTE, hasLicense, hostilityTierOf, identityOf, fakeIdsOf, rankOf, readScanSetup, securityRules,
} from './model'
import type { SecurityRules } from './model'

export const SCAN_ACTIVITY = 'scan'
const SCAN_REF = 'scan'
/** 事件選項的 id。 */
export const OPTION_PROCEED = 'proceed'
export const OPTION_FAKE = 'fake'
export const OPTION_TURN_BACK = 'turn_back'

// ---- 掛點：身上會被掃到的東西 ----

declare module '../../core' {
  interface HookMap {
    /**
     * 掃橋時問：這個人身上有哪些東西會被這一級的掃描掃到。item 是物品（設計圖）的 id，name 給玩家看，legal 是合法性
     * （free、register、permit、banned）；有實例編號的（組好的武器）另外帶 uid。沒有人回答就當作什麼都沒有。
     */
    'scan.carried': [{ state: GameState; actor: string; strength: number }, Array<{ item: string; name: string; legal: string; uid?: string }> | void]
  }
}

const LEGALS = ['free', 'register', 'permit', 'banned'] as const
type Legal = (typeof LEGALS)[number]

export interface Carried {
  item: string
  name: string
  legal: Legal
  /** 被掃到會怎樣：沒收（違禁、或許可類沒有執照）；否則放行 */
  seized: boolean
  /** 一句話：為什麼放行或沒收 */
  note: string
}

function carriedOf(k: Kernel, state: GameState, actor: string, strength: number): Carried[] {
  if (strength < 1) return []
  const out: Carried[] = []
  for (const { result } of k.hooks.run('scan.carried', { state, actor, strength })) {
    for (const r of result) {
      if (!isRecord(r) || typeof r.item !== 'string' || !r.item) continue
      const legal = (LEGALS as readonly unknown[]).includes(r.legal) ? (r.legal as Legal) : 'free'
      const name = typeof r.name === 'string' && r.name ? r.name : r.item
      const seized = legal === 'banned' || (legal === 'permit' && !hasLicense(k, state, r.item))
      const note = legal === 'banned' ? '違禁，會被沒收。' : legal === 'permit' ? (seized ? '許可類，你沒有執照，會被沒收。' : '許可類，你有執照。') : legal === 'register' ? '登記類，放行。' : '自由，放行。'
      out.push({ item: r.item, name, legal, seized, note })
    }
  }
  return out
}

// ---- 這一次掃橋的全貌（純函式，唯讀） ----

export type FakePlan =
  | { kind: 'none' }
  /** auto 等級夠，自動過；roll 低一級，要擲；low 等級太低，不能用 */
  | { kind: 'auto' | 'roll' | 'low'; id: FakeId; dc?: number }

export interface ScanPlan {
  setup: ScanSetup
  actor: string | null
  cls: IdentityClass
  classOk: boolean
  /** 身分不夠時的一句話 */
  classReason: string | null
  /** 掃的那個勢力的敵對值；沒有勢力是 0 */
  hostility: number
  tier: TierView | null
  /** 記名（含）以上：認得你的臉 */
  recorded: boolean
  wanted: boolean
  found: Carried[]
  fake: FakePlan
  rules: SecurityRules
}

const factionName = (k: Pick<Kernel, 'content'>, id: string): string => {
  const f = k.content.get<ContentEntry & { short?: string; name?: string }>('faction', id)
  return f?.short ?? f?.name ?? id
}

function classProblem(setup: ScanSetup, cls: IdentityClass): string | null {
  const need = setup.need_class
  const needRank = Math.max(need ? rankOf(need) : 0, setup.strength >= 1 ? rankOf('citizen') : 0)
  if (rankOf(cls) >= needRank) return null
  if (need && rankOf(need) > rankOf(cls)) return `這裡要${CLASS_NAME[need]}${need === 'member' ? '' : '以上'}的身分才進得去，你是${CLASS_NAME[cls]}，被攔了下來。`
  return `你是${CLASS_NAME[cls]}，沒有橋 ID 可以掃，進不了要掃橋的地方。`
}

function chooseFake(rules: SecurityRules, fakes: FakeId[], strength: number, recorded: boolean): FakePlan {
  if (fakes.length === 0) return { kind: 'none' }
  // 等級夠的挑最低的（不浪費好的）；沒有就挑低一級裡最好的（要擲）；再沒有就是等級太低
  const enough = fakes.find((f) => f.grade >= strength)
  if (enough) return { kind: 'auto', id: enough }
  const oneLess = [...fakes].reverse().find((f) => f.grade === strength - 1)
  if (oneLess) return { kind: 'roll', id: oneLess, dc: rules.fake_dc_base + strength * rules.fake_dc_per_strength + (recorded ? rules.fake_recorded_bonus : 0) }
  return { kind: 'low', id: fakes[fakes.length - 1]! }
}

export function planScan(k: Kernel, state: GameState, setup: ScanSetup): ScanPlan {
  const rules = securityRules(k)
  const actor = state.pc
  const cls = identityOf(state, actor)
  const classReason = classProblem(setup, cls)
  const hostility = setup.faction !== undefined && setup.strength >= 1 ? meterOf(k, state, 'hostility', setup.faction) : 0
  const tier = setup.faction !== undefined ? hostilityTierOf(rules, hostility) : null
  const recorded = !!tier && tier.index >= 1
  const wanted = !!tier && tier.index >= rules.hostility_bands.length - 1
  const found = actor ? carriedOf(k, state, actor, setup.strength) : []
  return {
    setup, actor, cls, classOk: classReason === null, classReason, hostility, tier, recorded, wanted, found,
    fake: chooseFake(rules, fakeIdsOf(k, state), setup.strength, recorded), rules,
  }
}

/** 不用跳事件：強度 0，或什麼都沒掃到、身分沒問題、而且沒被認出來。 */
const clearPass = (p: ScanPlan): boolean => p.setup.strength === 0 || (p.classOk && !p.recorded && p.found.length === 0)

/** 每個選項現在走不走得通：null 是走得通，否則是一句話的原因。 */
export function lockOf(k: Pick<Kernel, 'content'>, p: ScanPlan): { proceed: string | null; fake: string | null } {
  const stop = p.classReason ?? (p.wanted ? `${factionName(k, p.setup.faction!)}通緝著你，它的檢查哨一律攔你，只有掉頭走得通。` : null)
  return {
    proceed: stop,
    fake: stop ?? (p.fake.kind === 'low' ? `身上最好的假身分（${p.fake.id.name}）等級太低，過不了這一級的掃描。` : p.fake.kind === 'none' ? '身上沒有假身分。' : null),
  }
}

// ---- 結算 ----

export interface Resolution {
  passed: boolean
  how: string
  changes: Change[]
  lines: string[]
}

type Degree = 'critical' | 'success' | 'fail' | 'fumble'

/** 敵對值上升：經效果（區的倍率、夾值都在量表裡）；沒有勢力或結算不成立就沒有。 */
function hostilityUp(k: Kernel, state: GameState, faction: string | undefined, amount: number): { changes: Change[]; lines: string[] } {
  if (!faction || amount <= 0) return { changes: [], lines: [] }
  const res = k.effects.resolve([{ kind: 'hostility', key: faction, amount }], effectCtx(k, state, { source: 'builtin' }))
  return res.errors.length > 0 ? { changes: [], lines: [] } : { changes: res.changes, lines: res.lines }
}

/** 東西那一關：沒收的拿走、那個勢力的敵對值上升（一次掃橋算一次事，取最重的那一件）。 */
function itemsStep(k: Kernel, state: GameState, p: ScanPlan, via: 'proceed' | 'fake', spent: Change[]): Resolution {
  const seized = p.found.filter((c) => c.seized)
  if (seized.length === 0) return { passed: true, how: via, changes: spent, lines: [via === 'fake' ? `你用假身分過了${p.setup.name}` : `你過了${p.setup.name}`] }
  const amount = Math.max(...seized.map((c) => (c.legal === 'banned' ? p.rules.found_banned : p.rules.found_permit)))
  const up = hostilityUp(k, state, p.setup.faction, amount)
  return {
    passed: false, how: 'confiscated',
    changes: [...spent, ...seized.map((c): Change => ({ op: 'item', id: c.item, qty: -1 })), ...up.changes],
    lines: [`${p.setup.name}的掃描器掃到了${seized.map((c) => c.name).join('、')}，被沒收了`, ...up.lines],
  }
}

/**
 * 玩家選的那一條路的結果。option 是事件選項的 id（或 free），degree 是假身分那一擲的成功程度。
 * 走不通的選項（選項本身會擋，這裡是最後一道）當成掉頭。
 */
export function resolveScan(k: Kernel, state: GameState, p: ScanPlan, option: string, degree?: string): Resolution {
  const turned = (how: string, line: string): Resolution => ({ passed: false, how, changes: [], lines: [line] })
  const lock = lockOf(k, p)
  if (option === 'free') return turned('free', `你沒有過${p.setup.name}，去做了別的事`)
  if (option === OPTION_PROCEED && lock.proceed === null) return itemsStep(k, state, p, 'proceed', [])
  if (option === OPTION_FAKE && lock.fake === null && (p.fake.kind === 'auto' || p.fake.kind === 'roll')) {
    const id = p.fake.id
    if (p.fake.kind === 'roll' && degree !== 'success' && degree !== 'critical') {
      // 擲失敗：被識破，那一張被收走，那個勢力記一筆
      const up = hostilityUp(k, state, p.setup.faction, p.rules.caught_hostility)
      return {
        passed: false, how: 'fake_failed', changes: [{ op: 'item', id: id.item, qty: -1 }, ...up.changes],
        lines: [`${p.setup.name}的人看穿了你的${id.name}，被收走了`, ...up.lines],
      }
    }
    // 一次性的用掉就沒了；淺層、深層留著
    return itemsStep(k, state, p, 'fake', id.grade === 1 ? [{ op: 'item', id: id.item, qty: -1 }] : [])
  }
  return turned('turned_back', `你在${p.setup.name}掉頭走了`)
}

// ---- 開始 ----

/** 掃橋的結果寫成一份報告（強度 0、沒掃到什麼的 scan.pass；沒有事件視窗時的直接結算），並發 activity.end 併進去。 */
function finishDraft(k: Kernel, state: GameState, setup: ScanSetup, origin: Origin, res: Resolution): ReportDraft {
  const id = `sc${state.seq.uid + 1}`
  const end = endActivity(k, { state, kind: SCAN_ACTIVITY, id, origin, outcome: res.passed ? 'pass' : 'stop', result: { passed: res.passed, how: res.how } })
  const lines = [...res.lines, ...end.lines]
  const text = res.how === 'no_scan' ? `${setup.name}不掃橋，你直接過去了。` : res.how === 'clear' ? `${setup.name}的掃描器沒有發現什麼，你過去了。` : `${lines[0]}。`
  const draft: ReportDraft = {
    kind: 'action', action: res.passed ? 'scan.pass' : 'scan.stop', location: clone(state.location), ...(state.pc ? { actor: state.pc } : {}), party: [],
    timeline: [{ layer: 'meat', ...(state.pc ? { actor: state.pc } : {}), text, tag: res.passed ? 'scan.pass' : 'scan.stop', data: { point: setup.point, strength: setup.strength, how: res.how } }],
    changes: [{ op: 'uid', advance: 1 }, ...res.changes, ...end.changes],
    outcome: { result: res.passed ? 'pass' : 'stop', summary: res.how === 'no_scan' || res.how === 'clear' ? text : `${lines.map((x) => `${x}。`).join('')}` },
    ...(lines.length > 0 ? { narration: { results: lines } } : {}),
  }
  return attachActivityEnd(draft, end)
}

const joinNames = (list: Carried[]): string => list.map((c) => c.name).join('、')

/** 事件的正文。 */
function eventText(k: Kernel, p: ScanPlan): string {
  const s = p.setup
  const parts = [`你走到「${s.name}」。${STRENGTH_NOTE[s.strength]}`]
  if (p.wanted) parts.push(`${factionName(k, s.faction!)}的人一眼認出了你，通緝令還沒撤。`)
  else if (p.recorded) parts.push(`${factionName(k, s.faction!)}的人認得你的臉。`)
  if (p.classReason) parts.push(p.classReason)
  if (p.found.length > 0) parts.push(`掃描器對你身上的${joinNames(p.found)}有反應。`)
  return parts.join('')
}

/** 內嵌的事件：照常過、用假身分（身上有才列）、掉頭。能不能選照 scan_option 條件（讀 state.ext.security_scan），原因寫在 show_locked。 */
function buildEvent(k: Kernel, p: ScanPlan): Record<string, unknown> {
  const lock = lockOf(k, p)
  const seized = p.found.filter((c) => c.seized)
  const canRoll = k.content.list('skill').length === 0 || k.content.has('skill', FAKE_SKILL)
  const options: Array<Record<string, unknown>> = [{
    id: OPTION_PROCEED, need: { kind: 'scan_option', option: OPTION_PROCEED }, show_locked: lock.proceed ?? '現在不能這樣過。',
    text: seized.length > 0 ? `照常過（${joinNames(seized)}會被沒收${p.setup.faction ? `，${factionName(k, p.setup.faction)}對你的敵對值會上升` : ''}）。` : '照常過。',
    outcomes: { any: [] },
  }]
  if (p.fake.kind !== 'none') {
    const rolls = p.fake.kind === 'roll' && canRoll
    const f = p.fake
    const usable = f.kind === 'auto' || (f.kind === 'roll' && canRoll)
    options.push({
      id: OPTION_FAKE, need: { kind: 'scan_option', option: OPTION_FAKE }, show_locked: lock.fake ?? (usable ? '現在不能這樣過。' : `你擲不了${FAKE_SKILL}，這個假身分用不上。`),
      text: `用假身分（${f.id.name}）${rolls ? `，要擲表演，難度 ${f.dc}` : f.kind === 'auto' ? '，等級夠，直接過' : ''}。`,
      ...(rolls ? { check: [FAKE_SKILL, k.content.get<ContentEntry & { attr?: string }>('skill', FAKE_SKILL)?.attr ?? FAKE_ATTR, f.dc], outcomes: { success: [], fail: [] } } : { outcomes: { any: [] } }),
    })
  }
  options.push({ id: OPTION_TURN_BACK, text: '掉頭，不過了。', outcomes: { any: [] } })
  return { id: `scan_${p.setup.point}`, text: eventText(k, p), options }
}

function startScan(k: Kernel, state: GameState, setup: unknown, origin: Origin): ReportDraft[] {
  const s = readScanSetup(k, setup)
  if (typeof s === 'string') throw new ActionBlocked(s)
  if (!state.pc) throw new ActionBlocked('還沒有主角，沒有人可以掃。')
  const plan = planScan(k, state, s)
  if (clearPass(plan)) return [finishDraft(k, state, s, origin, { passed: true, how: s.strength === 0 ? 'no_scan' : 'clear', changes: [], lines: [] })]
  // 沒有事件視窗可以讓玩家選：當成照常過
  if (!k.activity.get('event')) return [finishDraft(k, state, s, origin, resolveScan(k, state, plan, plan.classOk && !plan.wanted ? OPTION_PROCEED : OPTION_TURN_BACK))]
  const drafts = k.activity.start(k, state, 'event', { inline: buildEvent(k, plan) }, { by: OWNER, ref: SCAN_REF, ext: { setup: clone(s), caller: clone(origin) } })
  if (drafts.length === 0) throw new Error('事件視窗沒有回傳開始的報告。')
  drafts[0]!.changes.push({ op: 'ext', key: SCAN_EXT, value: { setup: clone(s) } })
  return drafts
}

export const scanActivity: ActivityDef = {
  kind: SCAN_ACTIVITY, owner: OWNER, order: 35,
  // 掃橋自己沒有「進行中」：開著的那一段是事件視窗（它自己擋別的事、放行自己的報告）
  active: () => null,
  allow: [],
  reason: () => '眼前的掃描要先處理完。',
  start: startScan,
}

// ---- 事件做完：換成 scan 的 activity.end ----

function scanOfOrigin(k: Kernel, origin: Origin): { setup: ScanSetup; caller: Origin } | null {
  if (origin.by !== OWNER || origin.ref !== SCAN_REF || !isRecord(origin.ext)) return null
  const setup = readScanSetup(k, origin.ext.setup)
  const c = origin.ext.caller
  if (typeof setup === 'string' || !isRecord(c) || typeof c.by !== 'string') return null
  return { setup, caller: c as unknown as Origin }
}

export function installScan(k: Kernel): void {
  k.activity.define(scanActivity)

  // 選項走不走得通：照現在的狀態重算一次（同一個狀態一定一樣）
  k.conditions.register<Condition & { option: string }>({
    kind: 'scan_option', owner: OWNER,
    validate: (raw) => (raw.option === OPTION_PROCEED || raw.option === OPTION_FAKE ? [] : [`option 只能是 ${OPTION_PROCEED}、${OPTION_FAKE}`]),
    test: (c, ctx) => {
      const raw = ctx.state.ext[SCAN_EXT]
      const setup = isRecord(raw) ? readScanSetup(k, raw.setup) : null
      if (!setup || typeof setup === 'string') return false
      const lock = lockOf(k, planScan(k, ctx.state, setup))
      return (c.option === OPTION_PROCEED ? lock.proceed : lock.fake) === null
    },
  })

  k.hooks.on('activity.end', OWNER, (p) => {
    if (p.kind !== 'event') return
    const found = scanOfOrigin(k, p.origin)
    if (!found) return
    const plan = planScan(k, p.state, found.setup)
    const res = resolveScan(k, p.state, plan, String(p.result.option ?? ''), typeof p.result.degree === 'string' ? (p.result.degree as Degree) : undefined)
    // 把結果交回原本發起的人（kind 是 scan，id 沿用事件視窗的）
    const end = endActivity(k, { state: p.state, kind: SCAN_ACTIVITY, id: p.id, origin: found.caller, outcome: res.passed ? 'pass' : 'stop', result: { passed: res.passed, how: res.how } })
    return {
      changes: [{ op: 'ext', key: SCAN_EXT, value: null }, ...res.changes, ...end.changes],
      lines: [...res.lines, ...end.lines],
      ...(end.launch.length > 0 ? { launch: end.launch } : {}),
      ...(end.rewind ? { rewind: end.rewind } : {}),
    }
  })
}

// ---- 對外：給介面畫掃橋的框（UI 3.11 節） ----

export interface ScanStepView {
  id: 'identity' | 'hostility' | 'fake' | 'bridge'
  name: string
  /** 過、注意、不適用 */
  state: 'pass' | 'attention' | 'na'
  note: string
}

export interface ScanItemView {
  item: string
  name: string
  legal: string
  /** 會被沒收 */
  seized: boolean
  note: string
}

export interface ScanOptionView {
  id: string
  text: string
  /** 走不通的原因（完整的句子）；走得通是 null */
  locked: string | null
  /** 要擲的才有：難度（含存檔規則的偏移）與成功率（%） */
  check?: { skill: string; dc: number; chance: number }
}

export interface ScanView {
  point: string
  name: string
  strength: number
  /** 這一級掃什麼 */
  scans: string
  faction?: { id: string; name: string }
  /** 四步，照順序：身分、那個勢力的敵對值、假身分、沉溺與契約 */
  steps: ScanStepView[]
  /** 身上會被這一級掃到的每一樣東西 */
  carried: ScanItemView[]
  /** 怎麼過：照常過、用假身分（身上有才列）、掉頭 */
  options: ScanOptionView[]
}

function chanceOf(k: Kernel, state: GameState, actor: string, attr: string, dc: number): number {
  const a = (ATTR_IDS as readonly string[]).includes(attr) ? (attr as (typeof ATTR_IDS)[number]) : 'charm'
  const bonus = checkParts(k.stats, state, actor, { attr: a, skill: FAKE_SKILL, tags: ['event'] }).reduce((s, x) => s + x.value, 0)
  const real = dcFor(dc, state.rules)
  let ok = 0
  for (let n = 1; n <= 20; n++) {
    const d = computeDegree(n, n + bonus, real)
    if (d === 'success' || d === 'critical') ok += 1
  }
  return Math.round((ok / 20) * 100)
}

/** 掃橋的事件開著時：這個點的名字與強度、四步、身上會被掃到的東西、怎麼過。沒有掃橋開著是 null。 */
export function scanView(k: Kernel, state: GameState): ScanView | null {
  if (!k.activity.active(state).some((a) => a.kind === 'event')) return null
  const raw = state.ext[SCAN_EXT]
  const setup = isRecord(raw) ? readScanSetup(k, raw.setup) : null
  if (!setup || typeof setup === 'string') return null
  const p = planScan(k, state, setup)
  const lock = lockOf(k, p)
  const fname = setup.faction ? factionName(k, setup.faction) : null

  const identity: ScanStepView = {
    id: 'identity', name: '身分', state: p.classOk ? 'pass' : 'attention',
    note: p.classReason ?? `你是${CLASS_NAME[p.cls]}${setup.need_class ? `，這裡要${CLASS_NAME[setup.need_class]}${setup.need_class === 'member' ? '' : '以上'}，符合。` : '，進得去。'}`,
  }
  const hostility: ScanStepView = !setup.faction
    ? { id: 'hostility', name: '敵對值', state: 'na', note: '這個點沒有哪個勢力在看你。' }
    : p.wanted ? { id: 'hostility', name: '敵對值', state: 'attention', note: `${fname}通緝著你（${p.hostility}），它的檢查哨一律攔你。` }
    : p.recorded ? { id: 'hostility', name: '敵對值', state: 'attention', note: `${fname}對你的敵對值是 ${p.hostility}（${p.tier!.name}）：它的人認得你，用假身分的檢定難度 +${p.rules.fake_recorded_bonus}。` }
    : { id: 'hostility', name: '敵對值', state: 'pass', note: `${fname}對你的敵對值是 ${p.hostility}，沒有認出你。` }
  const fake: ScanStepView = p.fake.kind === 'none'
    ? { id: 'fake', name: '假身分', state: 'na', note: '你身上沒有假身分，用的是自己的橋 ID。' }
    : p.fake.kind === 'auto' ? { id: 'fake', name: '假身分', state: 'pass', note: `${p.fake.id.name}的等級夠，過得了這一級的掃描。` }
    : p.fake.kind === 'roll' ? { id: 'fake', name: '假身分', state: 'attention', note: `${p.fake.id.name}低一級，要擲表演，難度 ${p.fake.dc}。` }
    : { id: 'fake', name: '假身分', state: 'attention', note: `${p.fake.id.name}的等級太低，用不上。` }
  const bridge: ScanStepView = { id: 'bridge', name: '沉溺與契約', state: 'na', note: '只有鎮溺隊、貞網局、伊甸園的掃描器會看這一步；沉溺與契約這一版還沒有開放。' }

  const options: ScanOptionView[] = [{
    id: OPTION_PROCEED, locked: lock.proceed,
    text: p.found.some((c) => c.seized) ? `照常過：${joinNames(p.found.filter((c) => c.seized))}會被沒收，${fname ? `${fname}對你的敵對值會上升` : '這次過不了'}。` : '照常過。',
  }]
  if (p.fake.kind !== 'none') {
    const f = p.fake
    const attr = k.content.get<ContentEntry & { attr?: string }>('skill', FAKE_SKILL)?.attr ?? FAKE_ATTR
    const hasRoll = f.kind === 'roll' && f.dc !== undefined && !!p.actor && (k.content.list('skill').length === 0 || k.content.has('skill', FAKE_SKILL))
    options.push({
      id: OPTION_FAKE, locked: lock.fake,
      text: `用假身分（${f.id.name}）${f.kind === 'roll' ? `：要擲表演，難度 ${f.dc}` : f.kind === 'auto' ? '：等級夠，直接過' : ''}。`,
      ...(hasRoll ? { check: { skill: FAKE_SKILL, dc: dcFor(f.dc!, state.rules), chance: chanceOf(k, state, p.actor!, attr, f.dc!) } } : {}),
    })
  }
  options.push({ id: OPTION_TURN_BACK, locked: null, text: '掉頭，不過了。' })

  return {
    point: setup.point, name: setup.name, strength: setup.strength, scans: STRENGTH_NOTE[setup.strength]!,
    ...(setup.faction ? { faction: { id: setup.faction, name: fname! } } : {}),
    steps: [identity, hostility, fake, bridge],
    carried: p.found.map((c) => ({ item: c.item, name: c.name, legal: c.legal, seized: c.seized, note: c.note })),
    options,
  }
}
