// L6 功能 fixer 的第一拍：中間人手上的委託、簡報、怎麼付、那一輪交涉、接案、放棄。
// 規格：FIXER 第 2 節①；COMMISSIONS 4 節最後兩條；LIFE 1.1 節；UI 7.1 節；dev/adr/0016 G18；dev/work/M2-fixer.md。
//
// 每個入口都是純函式：讀狀態、回傳報告草稿或畫面要的資料；不成立丟 ActionBlocked（原因是給玩家看的完整句子，一條一個條件）。

import type { Change, GameState, Kernel, ReportDraft } from '../../core'
import { ActionBlocked, DEGREE_NAME, clone, formatAmount, meterOf } from '../../core'
import type { Degree, FixerEntry, FixerRules, Job, Offer, PayKind, TableEntry, UnknownItem } from './model'
import { CAT_NAME, HOSTILITY_TIER_BOUNTY, KIND, PAY_KINDS, PAY_NAME, factionName, favorSizeOf, fixerRules, gradeOf, hostilityAtLeast, jobsOf, offerProblems, repBlock, rollBest, stageCount, tableOf } from './model'
import { repChanges } from './rep'

declare module '../../core' {
  interface HookMap {
    /**
     * 這個中間人今天有哪些委託（FIXER 第 2 節①）。委託的生成（M2-commission-gen）與之後的特殊任務回答；回傳的 Offer 要有 id、commission、title、brief、reward、unknowns。
     * fixer 是中間人的內容（id、npc、district、kinds、cut……），day 是現在的日子（state.time.day）。同一天問幾次要回答一樣的東西。
     */
    'fixer.offers': [{ state: GameState; fixer: FixerEntry; day: number }, Offer[] | void]
  }
}

const SIZE_NAME = { small: '小', mid: '中' } as const

function draft(state: GameState, action: string, result: string, summary: string, changes: Change[], extra: Partial<ReportDraft> = {}): ReportDraft {
  return {
    kind: 'gig', action, location: clone(state.location), ...(state.pc ? { actor: state.pc } : {}), party: [], timeline: [], changes,
    outcome: { result, summary }, ...extra,
  }
}
export { draft as fixerDraft }

export function fixerEntry(k: Pick<Kernel, 'content'>, id: string): FixerEntry {
  const f = k.content.get<FixerEntry>(KIND, id)
  if (!f) throw new ActionBlocked(`沒有 ${id} 這位中間人。`)
  return f
}

// ---- 簡報 ----

export const FACE_NAME: Record<string, string> = { meat: '現實', net: '內海', opinion: '輿論' }
const MAIN_TEXT: Record<string, string> = { meat: '這是一件要動手的委託。', net: '這是一件要進內海的委託。', opinion: '這是一件要打輿論戰的委託。' }

export interface BriefStageRow {
  n: number
  name: string
  /** 最後一個階段（主面，決定性的一步）：一定看得到 */
  last: boolean
  /** 看得到可選的面嗎（最後一個階段、或「階段」類的未知揭開了） */
  known: boolean
  /** 可選的面（id）；不知道是 null（畫面寫「？」） */
  faces: string[] | null
}

export interface BriefView {
  title: string
  brief: string
  grade: number
  scale: string | null
  stages: number
  target_faction: string | null
  target_name: string | null
  district: string | null
  main: string | null
  main_name: string | null
  /** 「這是一件要動手的委託」 */
  main_text: string | null
  conditions: string[]
  rows: BriefStageRow[]
}

/** 簡報（UI 7.1 節）：只看得到最後一個階段，其餘階段在「階段」類的未知揭開之前是問號。revealedStages 是揭開了的階段（1 起算）。 */
export function briefOf(k: Pick<Kernel, 'content'>, offer: Pick<Offer, 'title' | 'brief' | 'commission'>, revealedStages: readonly number[] = []): BriefView {
  const c = offer.commission
  const total = stageCount(c)
  const rows: BriefStageRow[] = c.stages.map((st, i) => {
    const n = i + 1
    const last = n === total
    const known = last || revealedStages.includes(n)
    return { n, name: st.name ?? `第 ${n} 階段`, last, known, faces: known ? Object.keys(st.faces) : null }
  })
  const target = typeof c.target_faction === 'string' && c.target_faction !== 'none' ? c.target_faction : null
  const main = typeof c.main === 'string' ? c.main : null
  return {
    title: offer.title, brief: offer.brief, grade: gradeOf(c), scale: typeof c.scale === 'string' ? c.scale : null, stages: total,
    target_faction: target, target_name: target ? factionName(k, target) : null, district: typeof c.district === 'string' ? c.district : null,
    main, main_name: main ? (FACE_NAME[main] ?? main) : null, main_text: main ? (MAIN_TEXT[main] ?? null) : null,
    conditions: Array.isArray(c.conditions) ? [...c.conditions] : [], rows,
  }
}

/** 揭開了的「階段」類未知對到哪幾個階段（簡報用）。 */
export function revealedStages(job: Pick<Job, 'unknowns' | 'revealed'>): number[] {
  const out: number[] = []
  for (const u of job.unknowns) if (job.revealed.includes(u.id) && typeof (u.reveal as { stage?: number }).stage === 'number') out.push((u.reveal as { stage: number }).stage)
  return out
}

// ---- 怎麼付 ----

export interface PayOption {
  id: PayKind
  name: string
  /** 用哪種錢 */
  wallet: 'cash' | 'cred'
  /** 到手的數字（報酬是現在談好的） */
  amount: number
  /** 換人情：多一個人情 */
  favor?: { size: 'small' | 'mid'; who: string }
  /** 匯進帳戶：入帳時目標勢力的敵對值加多少（有人註冊 hostility 才有） */
  hostility?: { faction: string; amount: number }
  /** 代價（給玩家看的完整句子） */
  cost: string
  /** 選不了的原因；選得了是 null */
  block: string | null
}

/**
 * 三種付法各自到手多少、代價是什麼（FIXER 第 2 節①的表）。沒有人註冊那一種付法要的效果就不列
 * （匯進帳戶要 cred、換人情要 owed_to_pc；人情的功能沒裝時只有現金與帳戶）。
 */
export function payOptions(k: Kernel, offer: Pick<Offer, 'commission' | 'reward'>, npc: string, rules: FixerRules = fixerRules(k)): PayOption[] {
  const reward = offer.reward
  const out: PayOption[] = []
  if (k.effects.has('cash')) {
    out.push({ id: 'cash', name: PAY_NAME.cash, wallet: 'cash', amount: reward, cost: '查不到；要付帳戶的帳單得先洗錢。', block: null })
  }
  if (k.effects.has('cred')) {
    const target = typeof offer.commission.target_faction === 'string' && offer.commission.target_faction !== 'none' ? offer.commission.target_faction : null
    const hostile = target !== null && rules.hostility_cred > 0 && k.effects.has('hostility')
    out.push({
      id: 'cred', name: PAY_NAME.cred, wallet: 'cred', amount: Math.round(reward * rules.pay_cred),
      ...(hostile ? { hostility: { faction: target!, amount: rules.hostility_cred } } : {}),
      cost: hostile ? `留下紀錄：這是一筆髒交易，${factionName(k, target!)}的敵對值入帳時 +${rules.hostility_cred}。` : '留下紀錄：這是一筆髒交易。', block: null,
    })
  }
  if (k.effects.has('owed_to_pc')) {
    const size = favorSizeOf(offer.commission)
    out.push({
      id: 'favor', name: PAY_NAME.favor, wallet: 'cash', amount: Math.round(reward * rules.pay_favor), favor: { size, who: npc },
      cost: `多一個${SIZE_NAME[size]}人情，記在中間人名下；換成人情的部分中間人不抽成。`, block: null,
    })
  }
  return out
}

// ---- 這位中間人今天的委託 ----

export interface BoardRow {
  id: string
  fixer: string
  /** 報酬已經是交涉之後的 */
  offer: Offer
  /** 門檻（委託自己的與中間人的取大；沒有是 0） */
  min_rep: number
  /** 接不了的原因；接得了是 null */
  block: string | null
  /** 交涉過沒有、結果 */
  haggled: Degree | null
  /** 不能再談的原因；還能談是 null */
  haggle_block: string | null
  brief: BriefView
  pay: PayOption[]
}

export interface BoardView {
  fixer: string
  name: string
  /** 她肯不肯見你（信譽不夠就不肯，沒有委託可以看） */
  open: boolean
  reason: string | null
  rep: number
  offers: BoardRow[]
  /** 掛點回傳的委託格式不對、或 id 重複而被略過的（一條一句） */
  problems: string[]
}

/** 掛點的原始回答（還沒扣掉接走的、被收回去的）：格式不對的略過並記下原因，同一個 id 只留第一個，每一件蓋上中間人的 id。 */
export function rawOffers(k: Kernel, state: GameState, fixer: FixerEntry): { offers: Offer[]; problems: string[] } {
  const offers: Offer[] = []
  const problems: string[] = []
  const seen = new Set<string>()
  for (const h of k.hooks.run('fixer.offers', { state, fixer: clone(fixer), day: state.time.day })) {
    const list = Array.isArray(h.result) ? h.result : []
    list.forEach((o, i) => {
      const bad = offerProblems(o)
      const label = `${h.owner} 的第 ${i + 1} 件委託`
      if (bad.length > 0) return void problems.push(`${label}：${bad.join('；')}`)
      if (seen.has(o.id)) return void problems.push(`${label}：id ${o.id} 重複，只留第一個`)
      seen.add(o.id)
      offers.push({ ...clone(o), fixer: fixer.id })
    })
  }
  return { offers, problems }
}

function rowOf(k: Kernel, fixer: FixerEntry, offer: Offer, entry: TableEntry | undefined, rep: number, rules: FixerRules): BoardRow {
  const min = Math.max(offer.min_rep ?? 0, fixer.min_rep ?? 0)
  const shown: Offer = { ...offer, reward: entry?.reward ?? offer.reward }
  const haggled = entry?.haggle ?? null
  const block = repBlock(rep, min, '接得到這件委託')
  return {
    id: offer.id, fixer: fixer.id, offer: shown, min_rep: min, block, haggled,
    haggle_block: haggled ? '這件委託已經談過一輪了。' : block,
    brief: briefOf(k, shown), pay: payOptions(k, shown, fixer.npc, rules),
  }
}

/**
 * 這位中間人今天的委託：問掛點拿（同一天問幾次都一樣），扣掉已經接走的與今天被收回去的；信譽不夠的列出來並帶門檻（block）。
 * 簡報只看得到最後一個階段。
 */
export function board(k: Kernel, state: GameState, fixerId: string): BoardView {
  const fixer = fixerEntry(k, fixerId)
  const rep = meterOf(k, state, 'rep')
  const name = fixer.name ?? fixer.id
  const gate = repBlock(rep, fixer.min_rep, `肯見你（${name}）`)
  if (gate) return { fixer: fixer.id, name, open: false, reason: gate, rep, offers: [], problems: [] }
  // 後台勢力對你的敵對值到了「懸賞」：它罩的中間人不接你（FACTIONS 6.1 節）
  if (fixer.backer !== undefined && hostilityAtLeast(k, state, fixer.backer, HOSTILITY_TIER_BOUNTY)) {
    const reason = `${factionName(k, fixer.backer)}懸賞要你，它罩的中間人（${name}）不肯接你的案子。`
    return { fixer: fixer.id, name, open: false, reason, rep, offers: [], problems: [] }
  }
  const { offers, problems } = rawOffers(k, state, fixer)
  const table = tableOf(state, fixer.id)
  const hand = new Set(jobsOf(state).map((j) => j.id))
  const rules = fixerRules(k)
  const rows = offers.filter((o) => !hand.has(o.id) && !table[o.id]?.banned).map((o) => rowOf(k, fixer, o, table[o.id], rep, rules))
  return { fixer: fixer.id, name, open: true, reason: null, rep, offers: rows, problems }
}

/** 找今天桌上的一件委託（交涉、接案用）；找不到丟 ActionBlocked。 */
export function boardRow(k: Kernel, state: GameState, offer: Pick<Offer, 'id' | 'fixer'>): BoardRow {
  if (!offer.fixer) throw new ActionBlocked('這件委託沒有寫是哪位中間人給的。')
  const view = board(k, state, offer.fixer)
  if (!view.open) throw new ActionBlocked(view.reason!)
  const row = view.offers.find((r) => r.id === offer.id)
  if (!row) throw new ActionBlocked('這件委託現在不在這位中間人手上（已經接走、今天被收回去，或今天沒有這一件）。')
  return row
}

// ---- 那一輪交涉（G18） ----

const HAGGLE_SKILLS = ['negotiate']

/** 交涉擲骰的用途（同一件委託骰面一定一樣）。測試用它找骰面。 */
export const haggledPurpose = (fixer: string, offer: string): string => `fixer/${fixer}/${offer}/haggle`

/**
 * 接案前的那一輪交涉（0016 G18）：每件委託一次，對 13 ＋ 等級；成功報酬 +5%、大成功 +10%、大失敗這位中間人今天不再給這一件。
 * 結果記在中間人今天的桌面上，接案時照現在的報酬談。
 */
export function haggle(k: Kernel, state: GameState, offer: Pick<Offer, 'id' | 'fixer'>): ReportDraft {
  const row = boardRow(k, state, offer)
  if (row.block) throw new ActionBlocked(row.block)
  if (row.haggled) throw new ActionBlocked(row.haggle_block!)
  const rules = fixerRules(k)
  const fixer = fixerEntry(k, row.fixer)
  const base = (rawOffers(k, state, fixer).offers.find((o) => o.id === row.id) ?? row.offer).reward
  const dc = rules.haggle_dc_base + gradeOf(row.offer.commission)
  const r = rollBest(k, state, HAGGLE_SKILLS, dc, haggledPurpose(fixer.id, row.id), ['fixer', 'haggle'])
  const degree = r.roll.degree
  const raise = degree === 'critical' ? rules.haggle_critical : degree === 'success' ? rules.haggle_success : 0
  const reward = Math.round(base * (1 + raise))
  const patch: TableEntry = { haggle: degree, ...(raise > 0 ? { reward } : {}), ...(degree === 'fumble' ? { banned: true as const } : {}) }
  const lines: string[] = [
    degree === 'critical' ? `談得很漂亮，報酬加了一成：${formatAmount(base)} → ${formatAmount(reward)}。`
      : degree === 'success' ? `談成了，報酬多了一點：${formatAmount(base)} → ${formatAmount(reward)}。`
        : degree === 'fail' ? '沒談動，報酬照原來的。這件委託已經談過一輪了。'
          : `你惹毛了${fixer.name ?? fixer.id}，她今天不會再給你這一件。`,
  ]
  return draft(state, 'fixer.haggle', degree, `和${fixer.name ?? fixer.id}談「${row.offer.title}」的報酬：${DEGREE_NAME[degree]}。`, [
    { op: 'rng', advance: 1 },
    { op: 'fixer.table', fixer: fixer.id, day: state.time.day, offer: row.id, patch },
  ], {
    timeline: [{
      layer: 'meat', ...(state.pc ? { actor: state.pc } : {}), tag: 'fixer.haggle', roll: r.roll, data: { skill: r.skill, dc },
      text: `交涉（${k.stats.skillName(r.skill)}）：${DEGREE_NAME[degree]}（骰 ${r.roll.natural}，合計 ${r.roll.total}，對 DC ${dc}）`,
    }],
    narration: { results: lines },
  })
}

// ---- 接案 ----

export interface AcceptOpts {
  pay: PayKind
}

/** 接案：照選的付法記下條件（報酬、付法、抽成），把委託放進手上。報酬照現在談好的；信譽不夠、付法現在沒有都接不了。 */
export function accept(k: Kernel, state: GameState, offer: Pick<Offer, 'id' | 'fixer'>, opts: AcceptOpts): ReportDraft {
  const row = boardRow(k, state, offer)
  if (row.block) throw new ActionBlocked(row.block)
  if (!state.pc) throw new ActionBlocked('還沒有主角，接不了委託。')
  if (!(PAY_KINDS as readonly string[]).includes(opts?.pay)) throw new ActionBlocked(`付法只能是 ${PAY_KINDS.join('、')}。`)
  const option = row.pay.find((p) => p.id === opts.pay)
  if (!option) throw new ActionBlocked(`「${PAY_NAME[opts.pay]}」這種付法現在沒有開放。`)
  if (option.block) throw new ActionBlocked(option.block)
  const fixer = fixerEntry(k, row.fixer)
  const o = row.offer
  const job: Omit<Job, 'seq'> = {
    id: o.id, fixer: fixer.id, npc: fixer.npc, title: o.title, brief: o.brief, commission: clone(o.commission), unknowns: clone(o.unknowns),
    terms: { reward: o.reward, pay: option.id, cut: fixer.cut }, haggled: row.haggled, status: 'active', day: state.time.day,
    revealed: [], scouts: 0, alert_start: 0, trace_start: 0, log: [], aux: {}, bond_failed: [], borrow_n: 0, payout: null,
  }
  const lines = [`接了「${o.title}」：報酬 ${formatAmount(o.reward)}，${option.name}，到手 ${formatAmount(option.amount)}${option.favor ? `，另外多一個${SIZE_NAME[option.favor.size]}人情` : ''}。`, option.cost]
  return draft(state, 'fixer.accept', 'accepted', `接了「${o.title}」。`, [{ op: 'fixer.take', job }], { narration: { results: lines } })
}

/**
 * 放棄手上的一件委託（接了又不做）：從手上拿掉，這位中間人今天不再給這一件；街頭信譽 −5（LIFE 第 9 節「接了就做完」，數字是暫定，fixer_rule.rep_abandon）。
 * 撤退（commission.retreat）不是放棄：那是回到進去之前，委託還在手上。
 */
export function drop(k: Kernel, state: GameState, jobId: string): ReportDraft {
  const job = jobsOf(state).find((j) => j.id === jobId)
  if (!job) throw new ActionBlocked(`手上沒有 ${jobId} 這件委託。`)
  if (job.status !== 'active') throw new ActionBlocked(`「${job.title}」已經${job.status === 'done' ? '做完' : '失敗'}了，沒有什麼好放棄的。`)
  const rep = repChanges(k, state, fixerRules(k).rep_abandon)
  return draft(state, 'fixer.drop', 'dropped', `放棄了「${job.title}」。`, [
    { op: 'fixer.drop', id: job.id },
    { op: 'fixer.table', fixer: job.fixer, day: state.time.day, offer: job.id, patch: { banned: true } },
    ...rep.changes,
  ], { narration: { results: [`你把「${job.title}」還給了中間人。`, ...rep.lines] } })
}

/** 一項未知給畫面看的一行：揭開了寫內容，沒揭開是問號。 */
export function unknownLine(u: UnknownItem, revealed: boolean): string {
  return `${CAT_NAME[u.cat]}：${revealed ? u.text : '？？？？'}`
}
