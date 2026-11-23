// 俘虜：打贏時，感載滿了、失去回合時被制伏的敵人可以帶走（ENEMIES 6.1 節；dev/adr/0016 G13；dev/work/M2-enemy-encounter.md 第三、四項）。
//
//   誰符合   打贏（outcome win）、現實戰鬥；敵人被「制伏」（out 是 subdued）而且當時正在失去回合：
//            有橋的人是過載之後（感載滿了、餘韻至少一層）；人形的機器（humanoid: true）沒有感載，是被電磁打到停機。
//            被生命打倒的（down）、投降的（surrendered）、昏過去的（burnout）、逃走的不算；capture: false 的不算；
//            非人形的機器、載具、機甲、吉祥物、蕾絲與程式不算（種類預設）。「制伏的那一刻」在 out.before 掛點記下（unit.ext.enemies.capturable），
//            因為退出之後失去回合的狀態就拿掉了。
//   擲骰     每個符合的人擲一次：雜兵 40%、精英 25%、首領 10%，主角的誘惑每級 +3%（百分骰 1d100 ≤ 機率）。
//            亂數是 deriveRng(state.rng, 'capture/<戰鬥 id>')，照單位 id 的順序每人抽一次：同一個狀態結果一樣。一場最多帶走一個，成功的全部列出來讓玩家挑（最多 4 個）。
//   處置     活動 event（M2-event-run）：戰鬥結束那一份報告的 launch 開一件內嵌的事件。成功的不只一個先開「挑一個」，挑完再開那個人的處置；
//            只有一個就直接開處置。處置的選項：帶走（對象非自願沒被關掉、有人登記 scene、這個兵種沒寫 adult: null 才列；adult_scene 性質是 captive）、
//            問話（威嚇或交涉，哪個對主角比較有利就用哪個；DC 10 ＋ 等級 × 2，精英 +2、首領 +4）、交出去、放走。
//   敵對值   帶走 +1、問話 +1（成功失敗都一樣）、交出去 +2（收的人好感 +1；沒寫收的人就沒有這一筆）、放走不加（ENEMIES 6.1 節的表）。
//            效果 hostility／favor／scout_reveal 沒有人註冊就略過那一筆（security、fixer 沒裝也跑得起來）；scout_reveal 只在副本裡的戰鬥才放（origin.ext.commission）。
//   狀態     state.ext.capture：這一場可以帶走的人與走到哪一步；處置完（activity.end）記下結果，capture.done 報告清掉它。
//   報告     capture.offer（戰鬥結束之後：誰可以帶走）、capture.done（處置完：做了什麼）。
// 這一張不做：帶走之後的成人場景本身、交給委託人的報酬 +10%、放走之後再遇到他（見 dev/work/M2-enemy-encounter.md 的完成回報）。

import type { ActivityEndReturn, BattleUnit, Change, GameState, HookMap, Kernel, Launch, ReportDraft, UnitRank } from '../../core'
import { attrMod, clone, compareNatural, deriveRng, losingTurn, modeOf } from '../../core'
import type { EnemyEntry } from './kinds'
import { resolveEnemy } from './kinds'
import { enemyData, isRec, peekEnemy } from './unitdata'

/** 狀態的鍵：state.ext.capture。 */
export const CAPTURE_EXT = 'capture'
/** 擲俘虜的基本機率（%），照位階。 */
export const CAPTURE_BASE: Record<UnitRank, number> = { minion: 40, elite: 25, boss: 10 }
/** 主角的誘惑每一級加幾個百分點。 */
export const CAPTURE_PER_SEDUCE = 3
/** 一次最多列幾個人讓玩家挑（事件的選項最多 4 個）。 */
export const CAPTURE_MAX_OFFER = 4
/** 問話的難度：10 ＋ 等級 × 2，精英 +2、首領 +4（ENEMIES 1.4 節「制伏與釘住的難度」同一條）。 */
export const ASK_DC = { base: 10, perGrade: 2, elite: 2, boss: 4 } as const
/** 問話用的兩種檢定：意志加威嚇，或魅力加交涉（ENEMIES 6.1 節）。 */
const ASK_CHECKS = [{ skill: 'intimidate', attr: 'resolve' }, { skill: 'negotiate', attr: 'charm' }] as const
/** 「帶走」之後進成人場景的篩選標籤（DATA 第 1 節）：關掉時不列帶走。 */
export const CAPTIVE_TAG = 'target_unwilling'

const RANK_NAME: Record<string, string> = { minion: '雜兵', elite: '精英', boss: '首領' }

/** 一個成功被俘虜的人。 */
export interface CaptureCandidate {
  /** 這場戰鬥裡的單位 id（f1……） */
  unit: string
  enemy: string
  name: string
  rank: UnitRank
  grade: number
  /** 他的勢力；沒有勢力是 none */
  faction: string
  /** 這個兵種的成人場景標籤；null 是這個兵種沒有成人場景 */
  adult: string[] | null
  /** 這一次擲的機率（%）與骰面 */
  pct: number
  roll: number
}

export interface CaptureState {
  /** 哪一場戰鬥 */
  battle: string
  /** pick：成功的不只一個，等玩家挑一個；treat：處置那一個 */
  step: 'pick' | 'treat'
  candidates: CaptureCandidate[]
  /** 挑中的單位 id（step 是 treat 才有） */
  picked?: string
  /** capture.offer 報告記過了 */
  offered?: boolean
  /** 發起這場戰鬥的委託與委託人（origin.ext.commission、origin.ext.employer；有寫才有） */
  commission?: string
  employer?: string
  /** 處置完了：做了什麼；capture.done 報告把整份狀態清掉 */
  done?: { option: string; degree?: string; unit: string; name: string }
}

/** 現在可以處置的俘虜；沒有是 null。 */
export function captureOf(state: Pick<GameState, 'ext'>): CaptureState | null {
  const c = state.ext[CAPTURE_EXT]
  return isRec(c) && typeof c.battle === 'string' && Array.isArray(c.candidates) ? (c as unknown as CaptureState) : null
}

// ---- 誰符合、擲骰 ----

/** 這個種類的敵人有沒有可能被俘虜（不看怎麼退出的）：human 與 unbridged 可以、機器要 humanoid，其餘不行；capture: false 一律不行。 */
export function captureKindOk(e: Pick<EnemyEntry, 'kind' | 'capture' | 'humanoid'>): boolean {
  if (e.capture === false) return false
  if (e.kind === 'human') return true
  return e.kind === 'machine' && e.humanoid === true
}

/**
 * 他被制伏的這一刻算不算「感載滿了、失去回合」：有橋的（有感載的）要正在失去回合而且疊過餘韻；人形的機器要正在失去回合（被電磁打到停機）。
 * 沒有感載又不是人形的機器的人（沒有橋的人）不符合。回傳是哪一種，不符合是 null。
 */
export function captureCause(e: Pick<EnemyEntry, 'kind' | 'capture' | 'humanoid'>, u: BattleUnit): 'load' | 'stun' | null {
  if (!captureKindOk(e) || !losingTurn(u)) return null
  if (u.load) return u.layers >= 1 ? 'load' : null
  return e.kind === 'machine' && e.humanoid === true ? 'stun' : null
}

/** 這一個位階、主角的誘惑這一級，擲俘虜的機率（%）。 */
export const captureChance = (rank: UnitRank, seduce: number): number => Math.min(100, CAPTURE_BASE[rank] + CAPTURE_PER_SEDUCE * Math.max(0, seduce))

/**
 * 每個符合的人擲一次：骰 1～100，小於等於機率就成功。list 要已經照單位 id 排好（骰子照這個順序用）。
 * rng 只要有 int(min, max)：測試可以給固定的骰面。
 */
export function rollCaptures(rng: { int(min: number, max: number): number }, list: Array<{ u: BattleUnit; e: EnemyEntry }>, seduce: number): CaptureCandidate[] {
  const out: CaptureCandidate[] = []
  for (const { u, e } of list) {
    const pct = captureChance(u.rank, seduce)
    const roll = rng.int(1, 100)
    if (roll > pct) continue
    out.push({
      unit: u.id, enemy: u.enemy!, name: u.name, rank: u.rank, grade: u.grade, faction: e.faction,
      adult: e.adult === null ? null : [...(e.adult ?? [])], pct, roll,
    })
  }
  return out
}

/** 這場戰鬥裡可以擲俘虜的人：被制伏的那一刻符合條件（unit.ext.enemies.capturable），照單位 id 排好。 */
function eligible(k: Pick<Kernel, 'content'>, units: BattleUnit[]): Array<{ u: BattleUnit; e: EnemyEntry }> {
  const list: Array<{ u: BattleUnit; e: EnemyEntry }> = []
  for (const u of [...units].sort((a, b) => compareNatural(a.id, b.id))) {
    if (u.side !== 'foe' || !u.enemy || u.out !== 'subdued' || !peekEnemy(u).capturable) continue
    if (peekEnemy(u).taken || !k.content.has('enemy', u.enemy)) continue
    const e = resolveEnemy(k.content, u.enemy)
    if (captureKindOk(e)) list.push({ u, e })
  }
  return list
}

// ---- 處置的事件 ----

/** 這個人的問話難度。 */
export const askDc = (grade: number, rank: UnitRank): number => ASK_DC.base + grade * ASK_DC.perGrade + (rank === 'elite' ? ASK_DC.elite : rank === 'boss' ? ASK_DC.boss : 0)

/** 問話用威嚇還是交涉：主角的「屬性調整值 ＋ 基本功等級」高的那個（一樣高用威嚇）；沒有主角用威嚇。 */
function askCheck(k: Pick<Kernel, 'stats'>, state: GameState): { skill: string; attr: string } {
  const pc = state.pc ? state.actors[state.pc] : undefined
  if (!pc) return ASK_CHECKS[0]
  const score = (c: (typeof ASK_CHECKS)[number]): number => {
    let v = pc.attrs[c.attr as keyof typeof pc.attrs] ?? 10
    try { v = k.stats.effectiveAttr(state, pc.id, c.attr as never) } catch { /* 衍生數值沒註冊就用角色身上的 */ }
    return attrMod(v) + (pc.skills[c.skill] ?? 0)
  }
  return score(ASK_CHECKS[1]) > score(ASK_CHECKS[0]) ? ASK_CHECKS[1] : ASK_CHECKS[0]
}

type Fx = Record<string, unknown>
/** 一筆量表效果；沒有人註冊這種效果、或沒有對象（沒有勢力）就略過。 */
const meter = (k: Pick<Kernel, 'effects'>, kind: string, key: string | undefined, amount: number): Fx[] =>
  key && key !== 'none' && k.effects.has(kind) ? [{ kind, key, amount }] : []

/** 帶走這個選項列不列：對象非自願沒被關掉、有人登記了 scene 這種活動、這個兵種沒有寫「沒有成人場景」。 */
export function canTake(k: Pick<Kernel, 'activity'>, state: Pick<GameState, 'rules'>, c: Pick<CaptureCandidate, 'adult'>): boolean {
  return !state.rules.contentOff.includes(CAPTIVE_TAG) && !!k.activity.get('scene') && c.adult !== null
}

/**
 * 處置一個俘虜的內嵌事件（交給事件視窗開）：選項的 id 是 take、ask、handover、release。
 * 效果照 ENEMIES 6.1 節的表；檢定的難度是數字 DC（check 的第三項）。
 */
export function treatEvent(k: Pick<Kernel, 'effects' | 'activity' | 'stats'>, state: GameState, c: CaptureCandidate, ctx: { commission?: string; employer?: string } = {}): Record<string, unknown> {
  const host = (n: number): Fx[] => meter(k, 'hostility', c.faction, n)
  const options: Record<string, unknown>[] = []
  if (canTake(k, state, c)) {
    options.push({
      id: 'take', text: `把${c.name}帶走。`,
      outcomes: { any: host(1) },
      adult_scene: { when: 'always', gate: 'fixed', nature: 'captive', role: 'none', goal: 'none', circles: [['$pc', '$a']], tags: [...(c.adult ?? [])] },
    })
  }
  const ask = askCheck(k, state)
  const info: Fx = { kind: 'flag', key: `capture:info:${c.faction}`, value: true }
  const credential: Fx = { kind: 'flag', key: `capture:credential:${c.faction}`, value: true }
  // 審問問出來的未知是替「這件委託」揭開的：沒有委託（副本外的戰鬥）就沒有東西可以揭開，不放這一筆
  // （scout_reveal 的格式檢查在手上沒有進行中的委託時不合格，放了整件事件開不起來、這一場戰鬥結算不了）
  const reveal: Fx[] = ctx.commission && k.effects.has('scout_reveal') ? [{ kind: 'scout_reveal', job: ctx.commission }] : []
  options.push({
    id: 'ask', text: `審問${c.name}。`,
    check: [ask.skill, ask.attr, askDc(c.grade, c.rank)],
    outcomes: {
      critical: [info, credential, ...reveal, ...host(1)],
      success: [info, ...reveal, ...host(1)],
      fail: host(1),
    },
  })
  options.push({ id: 'handover', text: `把${c.name}交出去。`, outcomes: { any: [...host(2), ...meter(k, 'favor', ctx.employer, 1)] } })
  options.push({ id: 'release', text: `放${c.name}走。`, outcomes: { any: [] } })
  return {
    id: 'capture_treat', scope: 'capture',
    text: `${c.name}被你制伏了，人還醒著，不能動。你要怎麼處置？`,
    cast: [{ role: 'a', gen: { kind: 'captive', name: c.name, enemy: c.enemy, faction: c.faction } }],
    options,
  }
}

/** 成功的不只一個時，讓玩家挑處置哪一個的內嵌事件：選項的 id 是 pick:<單位 id>。 */
export function pickEvent(cands: CaptureCandidate[]): Record<string, unknown> {
  return {
    id: 'capture_pick', scope: 'capture',
    text: `${cands.map((c) => c.name).join('、')}都被制伏了，人還醒著。只能帶走一個，要先處置哪一個？`,
    options: cands.map((c) => ({ id: `pick:${c.unit}`, text: `處置${c.name}（${RANK_NAME[c.rank] ?? c.rank}）。`, outcomes: { any: [] } })),
  }
}

type EndPayload = HookMap['activity.end'][0]

const launchOf = (setup: Record<string, unknown>, battle: string, step: CaptureState['step']): Launch => ({ kind: 'event', setup: { inline: setup }, origin: { by: 'enemies', ref: battle, ext: { step } } })

// ---- 掛上去 ----

const draft = (state: GameState, action: string, result: string, summary: string, changes: Change[]): ReportDraft => ({
  kind: 'event', action, location: clone(state.location), ...(state.pc ? { actor: state.pc } : {}), party: [], timeline: [], changes, outcome: { result, summary },
})

/** 處置的結果寫成一句話。 */
function doneLine(d: NonNullable<CaptureState['done']>): string {
  switch (d.option) {
    case 'take': return `帶走了${d.name}`
    case 'ask': return d.degree === 'critical' ? `從${d.name}口中問出了情報，還拿到一份憑證` : d.degree === 'success' ? `從${d.name}口中問出了情報` : `${d.name}什麼都沒說`
    case 'handover': return `把${d.name}交了出去`
    default: return `放走了${d.name}`
  }
}

export function installCapture(k: Kernel, owner: string): void {
  // 制伏的那一刻：記下他是不是「感載滿了、失去回合」（退出之後失去回合的狀態就拿掉了）
  k.battle.on('out.before', owner, ({ unit, how }) => {
    if (how !== 'subdued' || unit.side !== 'foe' || !unit.enemy || !k.content.has('enemy', unit.enemy)) return
    const cause = captureCause(resolveEnemy(k.content, unit.enemy), unit)
    if (cause) enemyData(unit).capturable = cause
    else delete enemyData(unit).capturable
  })

  k.hooks.on('activity.end', owner, (p): ActivityEndReturn | void => {
    if (p.kind === 'battle') return onBattleEnd(k, p)
    if (p.kind === 'event' && p.origin.by === owner) return onTreatEnd(k, p)
  })

  // capture.offer：戰鬥結束那一份套用之後，記一筆誰可以帶走；capture.done：處置完，記一筆結果並把狀態清掉
  k.hooks.on('report.after', owner, ({ state, report }) => {
    const cap = captureOf(state)
    if (!cap) return
    if (cap.done) {
      return [draft(state, 'capture.done', cap.done.option, `${doneLine(cap.done)}。`, [{ op: 'ext', key: CAPTURE_EXT, value: null }])]
    }
    if (report.action === 'battle.end' && !cap.offered) {
      const names = cap.candidates.map((c) => c.name).join('、')
      return [draft(state, 'capture.offer', 'offer', `${names}被制伏後還醒著，可以處置。`, [{ op: 'ext', key: CAPTURE_EXT, value: { ...cap, offered: true } }])]
    }
  })
}

function onBattleEnd(k: Kernel, p: EndPayload): ActivityEndReturn | void {
  const { state } = p
  const b = state.battle
  if (p.outcome !== 'win' || !b) return
  // 沒有事件視窗可以處置時不擲、不留狀態（沒開那個功能的遊戲照樣打得完）
  if (!k.activity.get('event')) return
  const mode = modeOf(k.content, b.mode)
  if (mode && mode.layer !== 'meat') return
  const list = eligible(k, Object.values(b.units))
  if (!list.length) return
  const pc = state.pc ? state.actors[state.pc] : undefined
  const rng = deriveRng(state.rng, `capture/${b.id}`)
  const cands = rollCaptures(rng, list, pc?.skills.seduce ?? 0).slice(0, CAPTURE_MAX_OFFER)
  if (!cands.length) return
  const ctx = {
    ...(typeof b.origin.ext?.commission === 'string' ? { commission: b.origin.ext.commission } : {}),
    ...(typeof b.origin.ext?.employer === 'string' ? { employer: b.origin.ext.employer } : {}),
  }
  const one = cands.length === 1
  const cap: CaptureState = { battle: b.id, step: one ? 'treat' : 'pick', candidates: cands, ...(one ? { picked: cands[0]!.unit } : {}), ...ctx }
  return {
    changes: [{ op: 'ext', key: CAPTURE_EXT, value: cap }],
    lines: [`${cands.map((c) => c.name).join('、')}被制伏後還醒著，可以處置`],
    launch: [one ? launchOf(treatEvent(k, state, cands[0]!, ctx), b.id, 'treat') : launchOf(pickEvent(cands), b.id, 'pick')],
  }
}

function onTreatEnd(k: Kernel, p: EndPayload): ActivityEndReturn | void {
  const cap = captureOf(p.state)
  if (!cap) return
  const option = typeof p.result.option === 'string' ? p.result.option : ''
  if (cap.step === 'pick') {
    const chosen = cap.candidates.find((c) => option === `pick:${c.unit}`)
    // 沒挑（選了「我要做別的」）：全部放走，什麼都不加
    if (!chosen) return finish(cap, { option: 'release', unit: cap.candidates[0]!.unit, name: cap.candidates.map((c) => c.name).join('、') })
    const next: CaptureState = { ...cap, step: 'treat', picked: chosen.unit }
    return { changes: [{ op: 'ext', key: CAPTURE_EXT, value: next }], launch: [launchOf(treatEvent(k, p.state, chosen, cap), cap.battle, 'treat')] }
  }
  const chosen = cap.candidates.find((c) => c.unit === cap.picked) ?? cap.candidates[0]!
  const known = ['take', 'ask', 'handover', 'release'].includes(option) ? option : 'release'
  return finish(cap, { option: known, ...(typeof p.result.degree === 'string' ? { degree: p.result.degree } : {}), unit: chosen.unit, name: chosen.name })
}

/** 處置完：記下結果（capture.done 報告看到它就清掉整份狀態）。 */
function finish(cap: CaptureState, done: NonNullable<CaptureState['done']>): ActivityEndReturn {
  return { changes: [{ op: 'ext', key: CAPTURE_EXT, value: { ...cap, done } }], lines: [doneLine(done)] }
}
