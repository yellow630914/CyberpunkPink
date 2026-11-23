// L6 功能：名冊（FIXER 第 6 節；NPC_SYSTEM 第 10 節；COMMISSIONS 6.1 節；dev/adr/0016 第三、五節與 G4；dev/work/M2-roster.md）。
//
// 名冊是你認識、而且肯接你電話的人：招募、隊伍與同行、忠誠與可靠度、出場費與每週薪水的數字、戰鬥的候補。
// 成員一律是 state.actors 裡的角色（要進名冊的人由呼叫的人先變成角色；這個功能不 import 別的功能）；成員的角色帶 ext.paths（路數與階數）。
// 夥伴的技能（G4：路數那棵樹、階數以內的全部，不看容量）由 abilities 讀 ext.paths 給，這裡只保證角色帶著它。
//
// 接上核心的地方：
//   內容  roster_rule（id: default，蓋掉內建的規則數字；格式見 model.ts 的 RosterRules）；資料裡 owner 是 roster 的行動種類 npc_recruit（ready 時註冊）
//   量表  loyalty（0～100、照人、AI 一件事最多 ±10）；同名的效果與條件核心自動有
//   衍生  roster_cap（3 ＋ mod(魅力) ＋ 人面階數 × 2）、roster_fee（這個人一件委託的出場費；拿分紅的與不在名冊上的是 0）
//   變更  roster.join、roster.leave、roster.muster、roster.candidate、roster.think、roster.pay（形狀見各自的註解）
//   效果  roster_add：{ who, source? }（進候選；source 是 rescued 救過的、introduced 介紹的，決定忠誠的起始值）
//   條件  in_roster { who }、in_party { who }、in_tagalong { who }（這一趟召集時排的同行：abilities 的歷練點分得出同行與留家的）
//   掛點  bill.collect（回 weeklyPay 的每一筆：order 8、付現金）、bill.settled（沒付成的週薪：那個人忠誠 −8）：宣告在 features/bills，這裡只掛處理函式；
//         defeat.companions（同行的人：這一趟召集時排的同行，跟著主角一起被處置）：宣告在 features/defeat
//   掛鉤  time.passed（順序 14：連續沒召集的忠誠、忠誠太低的人離開）、activity.end（戰鬥裡倒下的成員忠誠 −3）、rest.done（睡一覺之後「再想想」的人可以再問）、
//         report.before（招募成功進名冊、差一點的「再想想」）
//   候補  k.battle.bench：名冊上不在這一場裡的人；沒空的列出來帶原因（blocks）
//   狀態  state.ext.roster：{ members, tagalong, candidates, thinking }（形狀見 model.ts）
// 報告：roster.join、roster.leave、roster.muster、roster.weekly（連續沒召集的忠誠）、roster.pay（改出場費或週薪）；招募走行動 npc_recruit。
// 對外：muster、join、leave、setPay、recruitInput、recruitDc、recruitBlock、feeOf、payOf、weeklyPay、rosterCap、rosterView、candidatesOf、availability。
//
// 不在這裡（NPC_SYSTEM 第 10 節）：關係線的五段、被挖走、主角沉溺到 100 時的離隊、藏著沉溺的檢定、牆報徵人、拿掉人時的親密度 −5。

import type { ActionInput, ActionKindEntry, Change, Condition, Effect, EffectCtx, Feature, GameState, Kernel } from '../../core'
import { ContentError, actionKindToDef, blankState, isRecord, isSafeInt, isValidTime, meterOf } from '../../core'
import { joinBlock, joinChanges, weeklyDrafts } from './ops'
import type { Candidate, PayKind } from './model'
import {
  EXT, OWNER, PAY_KINDS, RECRUIT_KIND, RULE_KIND, SOURCES, busyReasons, feeOf, isMember, isRunner, mainTier, nameOf, readRoster, recruitBlock, recruitDc, rosterCap, rosterRules, ruleProblems, weeklyPay, writeRoster,
} from './model'

export { DEFAULT_ROSTER_RULES, SOURCES, feeOf, mainTier, faceTier, isRunner, payOf, readRoster, recruitBlock, recruitDc, reliabilityOf, rosterCap, rosterRules, rosterSize, weeklyPay } from './model'
export type { Candidate, CandidateSource, DcMod, Member, PathRow, PayKind, RosterRules, RosterState } from './model'
export { join, joinBlock, joinChanges, leave, leaveChanges, memberOf, muster, musterBlocks, setPay, weeklyDrafts } from './ops'
export type { JoinOpts, LeaveReason, MusterInput } from './ops'

/** 週薪那一筆在帳單上的 id 前綴與順序（DOWNTIME 5.1 節那張表的第 8 項） */
const SALARY_PREFIX = 'salary:'
const SALARY_ORDER = 8

const isText = (v: unknown): v is string => typeof v === 'string' && v.trim().length > 0
const own = (o: object, key: string): boolean => Object.hasOwn(o, key)

// ---- 招募的輸入：行動的輸入就是 { kind, target, text }，報告帶著它（report.args），掛鉤從那裡讀對象 ----

/** 組出要交給 Game.act 的招募輸入。資料沒有 npc_recruit、或查不到對象丟錯（呼叫的人的錯）。 */
export function recruitInput(k: Pick<Kernel, 'actions'>, state: Pick<GameState, 'actors'>, id: string): ActionInput {
  const def = k.actions.get(RECRUIT_KIND)
  if (!def || def.owner !== OWNER) throw new Error(`資料裡沒有 ${RECRUIT_KIND} 這種行動。`)
  if (!own(state.actors, id)) throw new Error(`查不到 ${id} 這個人。`)
  return { kind: RECRUIT_KIND, target: id, text: `招募${state.actors[id]!.name}` }
}

// ---- 給介面看的 ----

export interface RosterRow {
  id: string
  name: string
  main_tier: number
  pay: PayKind
  fee: number
  weekly: number | null
  loyalty: number
  reliability: number
  fixed: boolean
  /** 現在沒空的原因，一條一個狀態；空的就是有空 */
  busy: string[]
  in_party: boolean
  tagalong: boolean
}

/** 名冊的列表（成員、容量、候選人、同行）。成員的角色不在了（被拿掉）的略過。 */
export function rosterView(k: Pick<Kernel, 'content' | 'stats' | 'meters'>, state: GameState): { cap: number; size: number; members: RosterRow[]; candidates: Candidate[]; tagalong: string[] } {
  const r = readRoster(state)
  const members = Object.keys(r.members).filter((id) => own(state.actors, id)).map((id): RosterRow => {
    const m = r.members[id]!
    return {
      id, name: state.actors[id]!.name, main_tier: mainTier(state, id), pay: m.pay, fee: feeOf(k, state, id), weekly: m.weekly ?? null,
      loyalty: meterOf(k, state, 'loyalty', id), reliability: m.reliability, fixed: m.fixed === true, busy: busyReasons(state, id),
      in_party: state.party.includes(id), tagalong: r.tagalong.includes(id),
    }
  })
  return { cap: rosterCap(k, state), size: Object.keys(r.members).length, members, candidates: r.candidates, tagalong: r.tagalong }
}

/** 候選人名單（照加進來的順序）。 */
export const candidatesOf = (state: Pick<GameState, 'ext'>): Candidate[] => readRoster(state).candidates

/** 這個成員現在有沒有空（空的是有空）。不在名冊上回傳 null。 */
export function availability(state: GameState, id: string): string[] | null {
  return isMember(state, id) ? busyReasons(state, id) : null
}

// ---- 註冊 ----

interface AddEffect extends Effect { who: string; source?: (typeof SOURCES)[number] }

export const rosterFeature: Feature = {
  id: OWNER,
  install(k: Kernel) {
    k.content.defineKind({ kind: RULE_KIND, owner: OWNER, overridable: true, validate: ruleProblems })

    // ---- 量表：忠誠 ----
    k.meters.define({ kind: 'loyalty', owner: OWNER, name: '忠誠', min: 0, max: 100, start: 30, keyed: 'npc', cap: { down: 10, up: 10 } })

    // ---- 衍生數值 ----
    k.stats.defineStat({ id: 'roster_cap', owner: OWNER, name: '名冊容量', min: 0, base: (state, actor) => rosterCap(k, state, actor) })
    k.stats.defineStat({ id: 'roster_fee', owner: OWNER, name: '出場費', min: 0, base: (state, actor) => feeOf(k, state, actor) })

    // ---- 變更 ----
    const timeOk = (v: unknown): boolean => isValidTime(v)
    const needActor = (state: GameState, id: unknown): string[] => (isText(id) && own(state.actors, id) ? [] : [`角色 ${String(id)} 不存在`])

    k.changes.register<Change & { who: string; since: unknown; reliability: number; pay: PayKind; fixed?: true; weekly?: number }>({
      op: 'roster.join', owner: OWNER,
      validate(state, c) {
        const p = needActor(state, c.who)
        if (p.length) return p
        if (c.who === state.pc) p.push('主角不用進自己的名冊')
        if (isMember(state, c.who)) p.push(`${c.who} 已經在名冊上了`)
        if (!timeOk(c.since)) p.push('since 要是 { day, hour, minute }')
        if (!(typeof c.reliability === 'number' && Number.isFinite(c.reliability) && c.reliability >= 0 && c.reliability <= 100)) p.push('reliability 要是 0～100 的數字')
        if (!(PAY_KINDS as readonly unknown[]).includes(c.pay)) p.push(`pay 只能是 ${PAY_KINDS.join('、')}`)
        if (c.weekly !== undefined && !(isSafeInt(c.weekly) && c.weekly > 0)) p.push('weekly 要是大於 0 的整數')
        return p
      },
      apply(state, c) {
        const r = readRoster(state)
        const since = { ...(c.since as { day: number; hour: number; minute: number }) }
        r.members[c.who] = { since, last_called: { ...since }, reliability: c.reliability, pay: c.pay, ...(c.fixed ? { fixed: true as const } : {}), ...(c.weekly !== undefined ? { weekly: c.weekly } : {}) }
        r.candidates = r.candidates.filter((x) => x.who !== c.who)
        r.thinking = r.thinking.filter((x) => x !== c.who)
        writeRoster(state, r)
      },
      describe: (c, state) => `名冊：${nameOf(state, c.who)}進來了`,
    })

    k.changes.register<Change & { who: string }>({
      op: 'roster.leave', owner: OWNER,
      validate: (state, c) => (isMember(state, c.who) ? [] : [`${String(c.who)} 不在名冊上`]),
      apply(state, c) {
        const r = readRoster(state)
        delete r.members[c.who]
        r.tagalong = r.tagalong.filter((x) => x !== c.who)
        r.thinking = r.thinking.filter((x) => x !== c.who)
        writeRoster(state, r)
      },
      describe: (c, state) => `名冊：${nameOf(state, c.who)}離開了`,
    })

    k.changes.register<Change & { party: string[]; tagalong: string[]; at: unknown }>({
      op: 'roster.muster', owner: OWNER,
      validate(state, c) {
        const p: string[] = []
        if (!(Array.isArray(c.party) && c.party.every(isText)) || !(Array.isArray(c.tagalong) && c.tagalong.every(isText))) return ['party 與 tagalong 要是角色 id 的陣列']
        if (!timeOk(c.at)) p.push('at 要是 { day, hour, minute }')
        for (const id of [...c.party, ...c.tagalong]) p.push(...needActor(state, id))
        return p
      },
      apply(state, c) {
        const r = readRoster(state)
        r.tagalong = [...new Set(c.tagalong)]
        for (const id of [...c.party, ...c.tagalong]) if (own(r.members, id)) r.members[id]!.last_called = { ...(c.at as { day: number; hour: number; minute: number }) }
        writeRoster(state, r)
      },
      describe: (c, state) => `召集：${c.party.length > 0 ? c.party.map((id) => nameOf(state, id)).join('、') : '只有你'}${c.tagalong.length > 0 ? `；同行${c.tagalong.map((id) => nameOf(state, id)).join('、')}` : ''}`,
    })

    k.changes.register<Change & { who: string; at: unknown; source?: string }>({
      op: 'roster.candidate', owner: OWNER,
      validate(state, c) {
        const p: string[] = []
        if (!isText(c.who)) p.push('who 要是角色的 id')
        else if (c.who === state.pc) p.push('主角不能是自己的候選人')
        if (!timeOk(c.at)) p.push('at 要是 { day, hour, minute }')
        if (c.source !== undefined && !(SOURCES as readonly unknown[]).includes(c.source)) p.push(`source 只能是 ${SOURCES.join('、')}`)
        return p
      },
      apply(state, c) {
        const r = readRoster(state)
        if (own(r.members, c.who) || r.candidates.some((x) => x.who === c.who)) return
        r.candidates.push({ who: c.who, at: { ...(c.at as { day: number; hour: number; minute: number }) }, ...(c.source !== undefined ? { source: c.source as (typeof SOURCES)[number] } : {}) })
        writeRoster(state, r)
      },
      describe: (c, state) => `名冊候選：${nameOf(state, c.who)}`,
    })

    k.changes.register<Change & { who?: string; remove?: boolean; clear?: boolean }>({
      op: 'roster.think', owner: OWNER,
      validate: (_state, c) => (c.clear === true || isText(c.who) ? [] : ['要寫 who（誰說要再想想），或 clear: true（全部清掉）']),
      apply(state, c) {
        const r = readRoster(state)
        if (c.clear) r.thinking = []
        else if (c.remove) r.thinking = r.thinking.filter((x) => x !== c.who)
        else if (!r.thinking.includes(c.who!)) r.thinking.push(c.who!)
        writeRoster(state, r)
      },
      describe: (c, state) => (c.clear || c.remove ? null : `${nameOf(state, c.who!)}說要再想想`),
    })

    k.changes.register<Change & { who: string; pay?: PayKind; weekly?: number | null }>({
      op: 'roster.pay', owner: OWNER,
      validate(state, c) {
        if (!isMember(state, c.who)) return [`${String(c.who)} 不在名冊上`]
        const p: string[] = []
        if (c.pay !== undefined && !(PAY_KINDS as readonly unknown[]).includes(c.pay)) p.push(`pay 只能是 ${PAY_KINDS.join('、')}`)
        if (c.weekly !== undefined && c.weekly !== null && !(isSafeInt(c.weekly) && c.weekly > 0)) p.push('weekly 要是大於 0 的整數，或 null（不給週薪）')
        return p
      },
      apply(state, c) {
        const r = readRoster(state)
        const m = r.members[c.who]!
        if (c.pay !== undefined) m.pay = c.pay
        if (c.weekly === null) delete m.weekly
        else if (c.weekly !== undefined) m.weekly = c.weekly
        if (m.pay === 'share') delete m.weekly
        writeRoster(state, r)
      },
      describe: (c, state) => `名冊：${nameOf(state, c.who)}的薪水改了`,
    })

    // ---- 效果與條件 ----
    k.effects.register<AddEffect>({
      kind: 'roster_add', owner: OWNER,
      validate(raw, ctx: EffectCtx) {
        const p: string[] = []
        if (!isText(raw.who)) p.push('who 要是角色的 id')
        else if (raw.who === ctx.state.pc) p.push('who：主角不能是自己的候選人')
        if (raw.source !== undefined && !(SOURCES as readonly unknown[]).includes(raw.source)) p.push(`source 只能是 ${SOURCES.join('、')}`)
        return p
      },
      // 一件事最多帶進一位候選人（AI 給的才算）
      budget: (e, ctx) => (ctx.level === 'cap' ? { group: 'roster_add', amount: 1, min: -Infinity, max: 1, resize: () => e, notice: () => '一件事最多只會帶出一位名冊候選人，多的沒有算。' } : null),
      // 已經是成員或已經在候選名單的不重複加（也不留空的變更）
      toChanges(e, ctx): Change[] {
        const r = readRoster(ctx.state)
        if (own(r.members, e.who) || r.candidates.some((x) => x.who === e.who)) return []
        return [{ op: 'roster.candidate', who: e.who, at: { ...ctx.state.time }, ...(e.source !== undefined ? { source: e.source } : {}) }]
      },
      describe: (e, ctx) => `名冊候選：${nameOf(ctx.state, e.who)}`,
    })

    k.conditions.register<Condition & { who: string }>({
      kind: 'in_roster', owner: OWNER,
      validate: (raw) => (isText(raw.who) ? [] : ['who 要是角色的 id']),
      test: (c, ctx) => isMember(ctx.state, c.who),
    })
    // 這一趟召集時排的同行（不上場、跟著主角一起出門；NPC_SYSTEM 10.0）。abilities 的歷練點靠它分得出同行與留家的
    k.conditions.register<Condition & { who: string }>({
      kind: 'in_tagalong', owner: OWNER,
      validate: (raw) => (isText(raw.who) ? [] : ['who 要是角色的 id']),
      test: (c, ctx) => isMember(ctx.state, c.who) && readRoster(ctx.state).tagalong.includes(c.who),
    })
    k.conditions.register<Condition & { who: string }>({
      kind: 'in_party', owner: OWNER,
      validate: (raw) => (isText(raw.who) ? [] : ['who 要是角色的 id']),
      test: (c, ctx) => ctx.state.party.includes(c.who),
    })

    // ---- 招募：成功進名冊，差一點的「再想想」 ----
    k.hooks.on('report.before', OWNER, ({ state, draft }) => {
      if (draft.action !== RECRUIT_KIND) return
      const id = draft.args?.target
      if (typeof id !== 'string' || !own(state.actors, id)) return
      if (draft.changes.some((c) => c.op === 'roster.join' && c.who === id)) return
      const degree = draft.outcome.result
      if (degree === 'critical' || degree === 'success') return joinBlock(k, state, id) === null ? joinChanges(k, state, id) : undefined
      const margin = draft.timeline.find((b) => b.roll)?.roll?.margin
      if (degree === 'fail' && typeof margin === 'number' && -margin < rosterRules(k).recruit_think_margin && !readRoster(state).thinking.includes(id)) return [{ op: 'roster.think', who: id }]
      return undefined
    })

    // 睡一覺之後，「再想想」的人可以再問
    k.hooks.on('rest.done', OWNER, ({ state, kind }) => (kind === 'sleep' && readRoster(state).thinking.length > 0 ? [{ op: 'roster.think', clear: true }] : undefined))

    // ---- 忠誠 ----
    k.hooks.on('time.passed', OWNER, ({ state, from, to }) => {
      const last = state.reports[state.reports.length - 1]
      if (!last || last.rewind) return
      const drafts = weeklyDrafts(k, state, from, to)
      return drafts.length > 0 ? drafts : undefined
    }, 14)

    // 戰鬥裡倒下（NPC_SYSTEM 10.4：讓他倒下、受重傷 −3）
    k.hooks.on('activity.end', OWNER, ({ state, kind }) => {
      if (kind !== 'battle' || !state.battle) return
      const r = readRoster(state)
      const down = new Set<string>()
      for (const u of Object.values(state.battle.units)) {
        if (u.side === 'ally' && u.actor && own(r.members, u.actor) && (u.out === 'down' || u.out === 'burnout')) down.add(u.actor)
      }
      if (down.size === 0) return
      const delta = rosterRules(k).down_delta
      if (delta === 0) return
      return {
        changes: [...down].sort().map((id): Change => ({ op: 'meter', kind: 'loyalty', key: id, delta })),
        lines: [...down].sort().map((id) => `${nameOf(state, id)}在戰鬥裡倒下，忠誠 ${delta}`),
      }
    })

    // ---- 每週薪水（DOWNTIME 5.1 節第 8 項：小隊的薪水，付現金；沒付成的人忠誠 −8）：接上每週帳單的兩個掛點 ----
    k.hooks.on('bill.collect', OWNER, ({ state }) => {
      const lines = weeklyPay(state).filter((p) => own(state.actors, p.who)).map((p) => ({
        id: `${SALARY_PREFIX}${p.who}`, owner: OWNER, name: `${p.name}的週薪`, kind: 'due' as const, amount: p.amount, order: SALARY_ORDER, pay: 'cash' as const,
      }))
      return lines.length > 0 ? lines : undefined
    })
    k.hooks.on('bill.settled', OWNER, ({ state, lines }) => {
      const delta = rosterRules(k).unpaid_delta
      if (delta === 0) return
      const changes: Change[] = []
      for (const l of lines) {
        if (l.owner !== OWNER || l.kind !== 'due' || l.unpaid <= 0 || l.skipped || !l.id.startsWith(SALARY_PREFIX)) continue
        const who = l.id.slice(SALARY_PREFIX.length)
        if (isMember(state, who) && own(state.actors, who)) changes.push({ op: 'meter', kind: 'loyalty', key: who, delta })
      }
      return changes.length > 0 ? changes : undefined
    })

    // ---- 同行的人在戰敗時跟著主角一起被處置（NPC_SYSTEM 10.0）：這一趟召集時排的同行，還在名冊上、角色還在的 ----
    k.hooks.on('defeat.companions', OWNER, ({ state }) => {
      const r = readRoster(state)
      const ids = r.tagalong.filter((id) => own(r.members, id) && own(state.actors, id))
      return ids.length > 0 ? ids : undefined
    })

    // ---- 戰鬥的候補：名冊上不在這一場裡的人，沒空的列出來帶原因 ----
    k.battle.bench(OWNER, (state, _battle, side) => {
      if (side !== 'ally') return []
      const r = readRoster(state)
      const out = []
      for (const id of Object.keys(r.members)) {
        if (!own(state.actors, id) || state.party.includes(id)) continue
        const name = state.actors[id]!.name
        const blocks = busyReasons(state, id)
        if (!isRunner(state, id)) blocks.push(`${name}不是行者，不能上場。`)
        if (r.tagalong.includes(id)) blocks.push(`${name}這趟是同行的，不會上場。`)
        out.push({ id, ref: { from: 'actor' as const, id }, name, blocks })
      }
      return out
    })
  },

  ready(k: Kernel) {
    // 招募：資料裡 owner 是 roster 的那一筆；沒有就沒有這個行動，不丟錯
    const e = k.content.get<ActionKindEntry>('action_kind', RECRUIT_KIND)
    if (!e || e.owner !== OWNER) return
    const problems: string[] = []
    if (e.skill && !k.content.has('skill', e.skill)) problems.push(`行動 ${e.id}：沒有 ${e.skill} 這項基本功`)
    if (e.requires !== undefined) problems.push(...k.conditions.validate(e.requires, 'requires').map((m) => `行動 ${e.id}：${m}`))
    const ctx = { state: blankState(0), actor: 'pc', grade: 1, source: 'builtin', clampAsked: true, content: k.content } as Parameters<Kernel['effects']['validate']>[1]
    for (const [name, table] of [['hint', e.hint] as const, ...Object.entries(e.hint_by_grade ?? {}).map(([g, t]) => [`hint_by_grade.${g}`, t] as const)]) {
      for (const [degree, list] of Object.entries(table ?? {})) {
        const probe = JSON.parse(JSON.stringify(list).split('$target').join('npc_probe')) as unknown[]
        problems.push(...k.effects.validate(probe.filter((x) => !(isRecord(x) && typeof x.kind === 'string' && k.meters.has(x.kind))), ctx, `${name}.${degree}`).map((m) => `行動 ${e.id}：${m}`))
      }
    }
    if (problems.length > 0) throw new ContentError(problems)
    const def = actionKindToDef(e, k, OWNER)
    const dataReq = def.block
    def.reportKind = 'social'
    def.dc = (state, input) => (typeof input.target === 'string' ? recruitDc(k, state, input.target).dc : 16)
    def.block = (state, input) => recruitBlock(k, state, input.target) ?? dataReq?.(state, input) ?? null
    k.actions.register(def)
  },
}

export { EXT as ROSTER_EXT, OWNER as ROSTER_OWNER, RECRUIT_KIND, RULE_KIND as ROSTER_RULE_KIND }
