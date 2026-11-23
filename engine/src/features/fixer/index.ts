// L6 功能：中間人與委託的前兩拍與出發（FIXER 第 1、2 節；COMMISSIONS 2.3、第 4 節；LIFE 1.1 節；CORE_RULES 第 8 節；UI 7.1、7.2 節；
// dev/adr/0016 第三節與 G18；dev/work/M2-fixer.md）。
//
// 中間人手上有今天的委託（向掛點 fixer.offers 拿，委託的生成與特殊任務回答）、簡報、三種付法、接案前的一輪交涉；接了案之後踩點（五種手段，
// 揭開未知清單）、買情報；出發時這份報告開委託副本（活動 commission），帶著踩到的東西。副本做完或失敗只把手上那一件標起來（錢、信譽在 M2-fixer-pay）。
//
// 接上核心的地方：
//   內容  fixer（中間人）、fixer_rule（id: default，蓋掉內建的規則數字）
//   量表  rep（街頭信譽：0～100、AI ±3）；同名的效果與條件核心自動有。衍生數值 rep_grade（用核心的 repTierOf 與 gradeOfRepTier）
//   掛點  fixer.offers（這個功能宣告，生成委託的功能回答）；activity.end（kind commission、origin.by 是自己）
//   變更  fixer.take、fixer.status、fixer.drop、fixer.table、fixer.scout、fixer.reveal
//   效果  scout_reveal { job?, cat?, count? }：替手上的一件委託揭開未知；job 寫委託的 id 或它的副本的 id；沒寫就是最近接的那一件
//   報告  fixer.accept、fixer.haggle、fixer.scout、fixer.buy_intel、fixer.go、fixer.drop（kind gig）
// 召集與入帳（M2-fixer-pay；hire.ts、pay.ts）：
//   變更  fixer.hire、fixer.unhire、fixer.bond_fail（請人與退人、靠交情失敗）、fixer.pend、fixer.settle（副本交回來之後等著結算的事）
//   報告  fixer.hire、fixer.unhire、fixer.payout（kind gig）
//   掛鉤  activity.end（commission）：做完或失敗記下 pending、撤退記下 retreat；report.after：有 pending 就接著提交 fixer.payout；
//         rewind.keep：撤退回到進副本之前之後，把請的人全退掉（付出去的錢回來、busy 拿掉、借來的人移除）
//   規則  fixer_rule 多：rating_bonus、rep_done、rep_fail、borrow_base、borrow_mult、boss_shares、aux_max、bond_*、trip_*（見 model.ts 的 FixerRules）
//   讀別人的：衍生數值 roster_fee（沒有人註冊當 0）、條件 in_roster、has_favor、變更 favor.spend、效果 owed、owed_to_pc、cash、cred、rep、hostility、loyalty、affinity（沒有人註冊就略過）
// 這個功能不 import 別的功能：人情、敵對值、街區只經由效果、條件、變更的登錄表（沒有人註冊就不列、不檢查）。
// 對外：board、briefOf、payOptions、haggle、accept、drop、scout、scoutView、buyIntel、intelOptions、scoutedOf、go、readFixer、jobOf、jobsOf；
//   hireOptions、hireBlocks、borrowOption、hire、unhire、splitPreview。

import type { Change, Effect, EffectCtx, Feature, GameState, Kernel, ReportDraft } from '../../core'
import { ContentError, clone, gradeOfRepTier, isRecord, isSafeInt, meterOf, repTierOf } from '../../core'
import type { AuxEntry, AuxFace, Cat, Job, PayoutRecord, PendingEnd, ScoutEntry, TableEntry } from './model'
import {
  AUX_FACES, CATS, DEGREES, EXT, HIRE_WAYS, KIND, OWNER, REP_METER, RULE_KIND, SCOUT_METHODS, auxList, fixerProblems, hiddenUnknowns, jobByRef, jobOf, latestJob, readFixer, ruleProblems,
} from './model'
import { payoutDraft } from './pay'
import { retreatRefund } from './hire'

export {
  AUX_FACES, AUX_FACE_NAME, FAVOR_SIZE_NAME, HIRE_NAME, HIRE_WAYS, RATING_KEYS, auxList,
  CATS, CAT_NAME, DEFAULT_FIXER_RULES, EXT, KIND, LOCKED_METHODS, OWNER, PAY_KINDS, PAY_NAME, REP_METER, RULE_KIND, SCOUT_METHODS,
  activeJobs, favorSizeOf, fixerProblems, fixerRules, gradeOf, hiddenUnknowns, jobByRef, jobOf, jobsOf, latestJob, methodOf, offerProblems, readFixer, repBlock, ruleProblems, scoutDc, scoutedOf, tableOf,
} from './model'
export type {
  Aux, AuxEntry, AuxFace, FavorSize, HireCost, HireWay, PayoutRecord, PendingEnd, Rating,
  Cat, CommissionDef, Degree, FixerEntry, FixerRules, FixerState, Job, JobStatus, Offer, PayKind, Reveal, ScoutEntry, ScoutMethod, Scouted, TableDay, TableEntry, Terms, UnknownItem,
} from './model'
export { accept, board, boardRow, briefOf, drop, haggle, haggledPurpose, payOptions, rawOffers, revealedStages, unknownLine } from './board'
export type { AcceptOpts, BoardRow, BoardView, BriefStageRow, BriefView, PayOption } from './board'
export { buyIntel, buyable, go, goBlock, intelOptions, scout, scoutBlock, scoutPurpose, scoutView } from './scout'
export type { IntelOption, IntelWith, MethodRow, ScoutView, UnknownRow } from './scout'
export { auxSetup, bondDc, bondPurpose, borrowOption, borrowPrice, feeOf as hireFeeOf, hire, hireBlocks, hireOptions, retreatRefund, unhire, unhireChanges } from './hire'
export type { HireInput, HireOption } from './hire'
export { WALLET_NAME, payoutDraft, splitOf, splitPreview } from './pay'
export type { Split, SplitOutside, SplitSegment, Wallet } from './pay'

const isText = (v: unknown): v is string => typeof v === 'string' && v.trim().length > 0

interface RevealEffect extends Effect { job?: string; cat?: Cat; count?: number }

function fixerState(state: GameState) {
  return readFixer(state)
}
const store = (state: GameState, f: ReturnType<typeof readFixer>): void => { state.ext[EXT] = f as unknown as Record<string, unknown> }

/** 一次揭開哪幾項：指定了 ids 就是那幾項；否則是這一類（沒寫是任何一類）裡還沒揭開的前 count 項。 */
function revealTargets(job: Pick<Job, 'unknowns' | 'revealed'>, c: { ids?: string[]; cat?: Cat; count?: number }): string[] {
  if (c.ids) return c.ids.filter((id) => !job.revealed.includes(id))
  return hiddenUnknowns(job, c.cat ? [c.cat] : undefined).slice(0, c.count ?? 1).map((u) => u.id)
}

export const fixerFeature: Feature = {
  id: OWNER,
  install(k: Kernel) {
    k.content.defineKind({ kind: KIND, owner: OWNER, validate: fixerProblems })
    k.content.defineKind({ kind: RULE_KIND, owner: OWNER, validate: ruleProblems })

    // ---- 街頭信譽 ----
    k.meters.define({ kind: REP_METER, owner: OWNER, name: '街頭信譽', min: 0, max: 100, start: 0, keyed: 'none', cap: { down: 3, up: 3 } })
    k.stats.defineStat({
      id: 'rep_grade', owner: OWNER, name: '街頭信譽的等級',
      base: (state, actor) => (actor === state.pc ? gradeOfRepTier(repTierOf(meterOf(k, state, REP_METER))) : 0),
    })

    // ---- 變更 ----
    k.changes.register<Change & { job: Omit<Job, 'seq'> }>({
      op: 'fixer.take', owner: OWNER,
      validate(state, c) {
        const j = c.job as unknown
        if (!isRecord(j) || !isText(j.id) || !isText(j.fixer) || !isRecord(j.terms) || !Array.isArray(j.unknowns) || !isRecord(j.commission)) return ['job 要是一件手上的委託（id、fixer、terms、unknowns、commission）']
        if (readFixer(state).jobs.some((x) => x.id === j.id)) return [`手上已經有 ${j.id} 這件委託了`]
        return []
      },
      apply(state, c) {
        const f = fixerState(state)
        f.seq += 1
        f.jobs.push({ ...clone(c.job), seq: f.seq } as Job)
        store(state, f)
      },
      describe: (c) => `手上多了一件委託：${c.job.title}`,
    })

    k.changes.register<Change & { id: string; status: 'done' | 'failed' }>({
      op: 'fixer.status', owner: OWNER,
      validate(state, c) {
        if (c.status !== 'done' && c.status !== 'failed') return ['status 只能是 done 或 failed']
        return jobOf(state, c.id) ? [] : [`手上沒有 ${String(c.id)} 這件委託`]
      },
      apply(state, c) {
        const f = fixerState(state)
        const j = f.jobs.find((x) => x.id === c.id)!
        j.status = c.status
        store(state, f)
      },
      describe: (c, state) => `委託「${jobOf(state, c.id)?.title ?? c.id}」${c.status === 'done' ? '做完了' : '失敗了'}`,
    })

    k.changes.register<Change & { id: string }>({
      op: 'fixer.drop', owner: OWNER,
      validate: (state, c) => (jobOf(state, c.id) ? [] : [`手上沒有 ${String(c.id)} 這件委託`]),
      apply(state, c) {
        const f = fixerState(state)
        f.jobs = f.jobs.filter((x) => x.id !== c.id)
        store(state, f)
      },
      describe: (c, state) => `放下委託「${jobOf(state, c.id)?.title ?? c.id}」`,
    })

    k.changes.register<Change & { fixer: string; day: number; offer: string; patch: TableEntry }>({
      op: 'fixer.table', owner: OWNER,
      validate(_state, c) {
        const p: string[] = []
        if (!isText(c.fixer)) p.push('fixer 要是中間人的 id')
        if (!isSafeInt(c.day) || c.day < 0) p.push('day 要是日子')
        if (!isText(c.offer)) p.push('offer 要是委託的 id')
        if (!isRecord(c.patch)) p.push('patch 要是物件')
        else {
          if (c.patch.haggle !== undefined && !(DEGREES as readonly unknown[]).includes(c.patch.haggle)) p.push(`patch.haggle 只能是 ${DEGREES.join('、')}`)
          if (c.patch.reward !== undefined && !(isSafeInt(c.patch.reward) && c.patch.reward >= 0)) p.push('patch.reward 要是 0 以上的整數')
          if (c.patch.banned !== undefined && c.patch.banned !== true) p.push('patch.banned 要是 true')
        }
        return p
      },
      apply(state, c) {
        const f = fixerState(state)
        // 別天的桌面沒有用了，順便清掉
        for (const [id, d] of Object.entries(f.table)) if (d.day !== c.day) delete f.table[id]
        const day = f.table[c.fixer] ?? { day: c.day, offers: {} }
        day.offers[c.offer] = { ...day.offers[c.offer], ...clone(c.patch) }
        f.table[c.fixer] = day
        store(state, f)
      },
    })

    k.changes.register<Change & { job: string; entry: ScoutEntry }>({
      op: 'fixer.scout', owner: OWNER,
      validate(state, c) {
        const job = jobOf(state, c.job)
        if (!job) return [`手上沒有 ${String(c.job)} 這件委託`]
        const e = c.entry as unknown
        if (!isRecord(e) || !isSafeInt(e.n) || e.n !== job.scouts + 1) return [`entry.n 要是下一次踩點（第 ${job.scouts + 1} 次）`]
        if (!SCOUT_METHODS.some((m) => m.id === e.method)) return ['entry.method 要是踩點的手段']
        if (!(DEGREES as readonly unknown[]).includes(e.degree)) return [`entry.degree 只能是 ${DEGREES.join('、')}`]
        if (!Array.isArray(e.revealed) || e.revealed.some((id) => !job.unknowns.some((u) => u.id === id) || job.revealed.includes(id as string))) return ['entry.revealed 要是這件委託還沒揭開的未知的 id']
        return []
      },
      apply(state, c) {
        const f = fixerState(state)
        const j = f.jobs.find((x) => x.id === c.job)!
        j.scouts += 1
        j.revealed.push(...c.entry.revealed)
        j.alert_start = Math.min(100, j.alert_start + (c.entry.alert ?? 0))
        j.trace_start = Math.min(100, j.trace_start + (c.entry.trace ?? 0))
        j.log.push(clone(c.entry))
        store(state, f)
      },
      describe: (c, state) => `踩點：「${jobOf(state, c.job)?.title ?? c.job}」第 ${c.entry.n} 次`,
    })

    k.changes.register<Change & { job: string; ids?: string[]; cat?: Cat; count?: number }>({
      op: 'fixer.reveal', owner: OWNER,
      validate(state, c) {
        const job = jobOf(state, c.job)
        if (!job) return [`手上沒有 ${String(c.job)} 這件委託`]
        if (c.ids !== undefined && !(Array.isArray(c.ids) && c.ids.every((id) => job.unknowns.some((u) => u.id === id)))) return ['ids 要是這件委託的未知的 id']
        if (c.cat !== undefined && !(CATS as readonly unknown[]).includes(c.cat)) return [`cat 只能是 ${CATS.join('、')}`]
        if (c.count !== undefined && !(isSafeInt(c.count) && c.count >= 1 && c.count <= 20)) return ['count 要是 1～20 的整數']
        return []
      },
      apply(state, c) {
        const f = fixerState(state)
        const j = f.jobs.find((x) => x.id === c.job)!
        j.revealed.push(...revealTargets(j, c))
        store(state, f)
      },
      describe(c, state) {
        const job = jobOf(state, c.job)
        if (!job) return null
        const ids = revealTargets(job, c)
        return ids.length > 0 ? `踩點：揭開了「${job.title}」的${ids.length}項未知` : null
      },
    })

    // ---- 召集與入帳的變更（M2-fixer-pay）----
    k.changes.register<Change & { job: string; face: AuxFace; entry: AuxEntry }>({
      op: 'fixer.hire', owner: OWNER,
      validate(state, c) {
        const job = jobOf(state, c.job)
        if (!job) return [`手上沒有 ${String(c.job)} 這件委託`]
        const e = c.entry as unknown
        if (!(AUX_FACES as readonly unknown[]).includes(c.face)) return [`face 只能是 ${AUX_FACES.join('、')}`]
        if (!isRecord(e) || !isText(e.actor) || !(HIRE_WAYS as readonly unknown[]).includes(e.way) || !isRecord(e.cost)) return ['entry 要是 { actor, way, cost }']
        if (auxList(job).some((x) => x.actor === e.actor)) return [`${e.actor} 已經在這件委託裡了`]
        if ((job.aux[c.face]?.length ?? 0) >= 2) return ['每一面最多請 2 個人']
        return []
      },
      apply(state, c) {
        const f = fixerState(state)
        const j = f.jobs.find((x) => x.id === c.job)!
        j.aux[c.face] = [...(j.aux[c.face] ?? []), clone(c.entry)]
        if (c.entry.way === 'borrow') j.borrow_n += 1
        store(state, f)
      },
      describe: (c, state) => `請人：${state.actors[c.entry.actor]?.name ?? c.entry.actor} 去${c.face === 'meat' ? '現實' : c.face === 'net' ? '內海' : '輿論'}面`,
    })

    k.changes.register<Change & { job: string; actor: string }>({
      op: 'fixer.unhire', owner: OWNER,
      validate(state, c) {
        const job = jobOf(state, c.job)
        if (!job) return [`手上沒有 ${String(c.job)} 這件委託`]
        return auxList(job).some((x) => x.actor === c.actor) ? [] : [`這件委託沒有請 ${String(c.actor)}`]
      },
      apply(state, c) {
        const f = fixerState(state)
        const j = f.jobs.find((x) => x.id === c.job)!
        for (const face of AUX_FACES) {
          const left = (j.aux[face] ?? []).filter((x) => x.actor !== c.actor)
          if (left.length > 0) j.aux[face] = left
          else delete j.aux[face]
        }
        store(state, f)
      },
      describe: (c, state) => `退人：${state.actors[c.actor]?.name ?? c.actor}`,
    })

    k.changes.register<Change & { job: string; actor: string }>({
      op: 'fixer.bond_fail', owner: OWNER,
      validate: (state, c) => (!jobOf(state, c.job) ? [`手上沒有 ${String(c.job)} 這件委託`] : isText(c.actor) ? [] : ['actor 要是角色的 id']),
      apply(state, c) {
        const f = fixerState(state)
        const j = f.jobs.find((x) => x.id === c.job)!
        if (!j.bond_failed.includes(c.actor)) j.bond_failed.push(c.actor)
        store(state, f)
      },
    })

    k.changes.register<Change & { entry: PendingEnd }>({
      op: 'fixer.pend', owner: OWNER,
      validate(_state, c) {
        const e = c.entry as unknown
        return isRecord(e) && isText(e.job) && (e.outcome === 'done' || e.outcome === 'failed' || e.outcome === 'retreat') ? [] : ['entry 要是 { job, outcome: done、failed 或 retreat }']
      },
      apply(state, c) {
        const f = fixerState(state)
        f.pending.push(clone(c.entry))
        store(state, f)
      },
    })

    k.changes.register<Change & { job: string; payout?: PayoutRecord }>({
      op: 'fixer.settle', owner: OWNER,
      validate: (_state, c) => (isText(c.job) ? [] : ['job 要是委託的 id']),
      apply(state, c) {
        const f = fixerState(state)
        f.pending = f.pending.filter((x) => x.job !== c.job || x.outcome === 'retreat')
        const j = f.jobs.find((x) => x.id === c.job)
        if (j && c.payout) j.payout = clone(c.payout)
        store(state, f)
      },
    })

    // ---- 效果：替手上的一件委託揭開未知（不花時間、不算踩點的次數）----
    k.effects.register<RevealEffect>({
      kind: 'scout_reveal', owner: OWNER,
      validate(raw, ctx: EffectCtx) {
        const p: string[] = []
        if (raw.job !== undefined && !isText(raw.job)) p.push('job 要是手上委託的 id')
        if (raw.cat !== undefined && !(CATS as readonly unknown[]).includes(raw.cat)) p.push(`cat 只能是 ${CATS.join('、')}`)
        if (raw.count !== undefined && !(isSafeInt(raw.count) && raw.count >= 1 && raw.count <= 20)) p.push('count 要是 1～20 的整數')
        if (p.length > 0) return p
        if (isText(raw.job)) {
          const j = jobByRef(ctx.state, raw.job)
          return j && j.status === 'active' ? [] : [`手上沒有進行中的 ${raw.job} 這件委託`]
        }
        return latestJob(ctx.state) ? [] : ['手上沒有進行中的委託，沒有東西可以揭開']
      },
      // AI 給的一件事最多揭開一項（EVENTS 2.4 節的精神：未知清單是生成時就決定好的，這裡只是翻開）
      budget(e, ctx) {
        if (ctx.level !== 'cap') return null
        const count = e.count ?? 1
        return { group: 'scout_reveal', amount: count, min: -Infinity, max: 1, resize: (to) => ({ ...e, count: to }), notice: () => '一件事最多只替你揭開一項未知，多的沒有算。' }
      },
      toChanges(e, ctx): Change[] {
        const job = (e.job ? jobByRef(ctx.state, e.job) : latestJob(ctx.state))?.id
        if (!job) return []
        return [{ op: 'fixer.reveal', job, ...(e.cat ? { cat: e.cat } : {}), count: e.count ?? 1 }]
      },
      describe(e, ctx) {
        const job = e.job ? jobByRef(ctx.state, e.job) : latestJob(ctx.state)
        if (!job) return '踩點：沒有可以揭開的委託'
        const ids = revealTargets(job, { ...(e.cat ? { cat: e.cat } : {}), count: e.count ?? 1 })
        const lines = ids.map((id) => job.unknowns.find((u) => u.id === id)!.text)
        return lines.length > 0 ? `踩點：揭開了「${job.title}」的未知（${lines.join('；')}）` : `踩點：「${job.title}」沒有可以揭開的東西了`
      },
    })

    // ---- 副本做完、失敗或撤退：標起來並記下等著結算的事；錢在 report.after 接著提交的 fixer.payout（pay.ts）----
    k.hooks.on('activity.end', OWNER, ({ state, kind, origin, outcome, result }) => {
      if (kind !== 'commission' || origin.by !== OWNER) return
      const job = isText(origin.ref) ? jobOf(state, origin.ref) : null
      if (!job || job.status !== 'active') return
      // 撤退：狀態跟著快照回到進副本之前，請的人由 rewind.keep 退掉
      if (outcome === 'retreat') return { changes: [{ op: 'fixer.pend', entry: { job: job.id, outcome: 'retreat' } } as Change] }
      if (outcome !== 'done' && outcome !== 'failed') return
      const rating = result.rating === 'S' || result.rating === 'A' || result.rating === 'B' || result.rating === 'C' ? result.rating : undefined
      return {
        changes: [
          { op: 'fixer.status', id: job.id, status: outcome } as Change,
          { op: 'fixer.pend', entry: { job: job.id, outcome, ...(rating ? { rating } : {}) } } as Change,
        ],
        lines: [outcome === 'done' ? `委託「${job.title}」做完了。` : `委託「${job.title}」失敗了。`],
      }
    })

    // 有等著結算的事（做完或失敗）：接著提交入帳。撤退的那一份自己帶 rewind，不在這裡處理。
    k.hooks.on('report.after', OWNER, ({ state, report }): ReportDraft[] | void => {
      if (report.rewind) return
      const p = readFixer(state).pending.find((x) => x.outcome !== 'retreat')
      return p ? [payoutDraft(k, state, p)] : undefined
    })

    // 撤退回到進副本之前之後：請的人全退掉（付出去的錢回來、busy 拿掉、借來的人移除）；用掉的人情不退
    k.hooks.on('rewind.keep', OWNER, ({ current, restored }) => {
      const p = readFixer(current).pending.find((x) => x.outcome === 'retreat')
      if (!p) return
      const out = retreatRefund(k, restored, p.job)
      return out.changes.length > 0 ? out.changes : undefined
    })
  },

  ready(k: Kernel) {
    const problems: string[] = []
    for (const f of k.content.list<{ id: string; npc: string; district: string; block?: string }>(KIND)) {
      if (k.content.hasKind('npc') && !k.content.has('npc', f.npc)) problems.push(`${KIND}/${f.id}：npc ${f.npc} 查不到`)
      if (k.content.hasKind('district') && !k.content.has('district', f.district)) problems.push(`${KIND}/${f.id}：district ${f.district} 查不到`)
      if (f.block !== undefined && k.content.hasKind('block') && !k.content.has('block', f.block)) problems.push(`${KIND}/${f.id}：block ${f.block} 查不到`)
    }
    if (problems.length > 0) throw new ContentError(problems)
  },
}
