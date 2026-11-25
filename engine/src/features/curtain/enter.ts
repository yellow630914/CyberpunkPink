// L6 功能 curtain 的報名並開一趟（CYBERSPACE 8.8 節「一趟的結構」開頭到報名；dev/adr/0018 第六、十三節；dev/adr/0019 P57）。
//
// 一隊 1～4 人（會員本人加同伴），每個人都要有橋與自己的甲板；每晚最多兩場；報名時付保證金與同伴券（同伴沒有打賞）。
// 選夜：給了 night 就要在這一週抽得到的夜裡；沒給就擲（同一個夜一天之內擲到兩次重擲）；選到主打記 feature: true。
// 開一趟：launch 活動 netrun（setup.region 整筆放這一區的規則；origin.ext.curtain 記夜、席次、主打、純舞台）。
// 這一張只到「開一趟」：一趟裡面的節點、場熱與結算是 M4-curtain-run（curtain.patch、report.after 在那邊接手）。
//
// 報告（kind netrun）：curtain.enter。

import type { ActorId, Change, GameState, Kernel, Origin, ReportDraft } from '../../core'
import { ActionBlocked, clone, formatAmount } from '../../core'
import type { TierDef, TierId } from './model'
import { ACT_NETRUN, ENTER_ACTION, ORIGIN_BY, REGION_ID, curtainChange, curtainRules, nowOf, readCurtain, tierIndex, tierOf } from './model'
import type { NightRow } from './nights'
import { nightOf, nightPool, rollNight, weekOf } from './nights'
import { hasBridge, hasDeck } from './member'

const NOT_OPEN = '簾後館現在沒有開放。'

export interface EnterOpts {
  /** 這一趟坐哪一個席次（不能高過會員的席次；沒寫是會員自己的席次） */
  tier?: TierId
  /** 指定哪一夜（要在這一週抽得到的夜裡）；沒寫就擲 */
  night?: string
  /** 隊伍：角色的 id（含會員本人），1～4 人 */
  party: ActorId[]
  /** 固定這一趟的種子（沒寫由狀態的亂數導出） */
  seed?: number
}

export interface EnterQuote {
  tier: TierDef
  /** 保證金 */
  deposit: number
  /** 每位同伴的同伴券（C$100 × 等級） */
  companionFee: number
  /** 付同伴券的人（隊上除了會員本人） */
  companions: ActorId[]
  /** 現金一共付多少 */
  total: number
}

const partyOf = (o: EnterOpts): ActorId[] => [...new Set(o.party)]

/** 報名要付多少（不檢查能不能報）。 */
export function enterQuote(k: Kernel, state: GameState, o: EnterOpts): EnterQuote | null {
  const rules = curtainRules(k)
  const m = readCurtain(state).member
  const tier = tierOf(rules, o.tier ?? m?.tier ?? 'floor')
  if (!tier) return null
  const companions = partyOf(o).filter((id) => id !== state.pc)
  const companionFee = rules.companion_fee * tier.grade
  return { tier, deposit: tier.deposit, companionFee, companions, total: tier.deposit + companionFee * companions.length }
}

/** 現在報不了的原因（一條一個條件；能報是空的）。 */
export function enterBlocks(k: Kernel, state: GameState, o: EnterOpts): string[] {
  if (!k.activity.get(ACT_NETRUN)) return [NOT_OPEN]
  const rules = curtainRules(k)
  const cur = readCurtain(state)
  const m = cur.member
  const p: string[] = []
  if (!state.pc || !state.actors[state.pc]) return ['還沒有主角，沒有人可以報名。']
  if (!m) p.push('你還不是簾後館的會員：要先拿到邀請函，去面談。')
  else if (m.suspended) p.push('會費逾期，會員證停權了：要重新面談（邀請函也要重來）才能再來。')
  if (cur.run) p.push('你已經報了名，先把這一趟做完。')
  else if (k.activity.active(state).some((a) => a.kind === ACT_NETRUN)) p.push('已經有一趟網內的行程在進行，先把它做完。')
  const other = k.activity.blockOf(state, `commit:${ENTER_ACTION}`)
  if (other) p.push(other)

  const tierId = o.tier ?? m?.tier
  const tier = tierId ? tierOf(rules, tierId) : undefined
  if (o.tier && !tier) p.push(`沒有「${o.tier}」這個席次。`)
  if (m && tier && tierIndex(tier.id) > tierIndex(m.tier)) p.push(`你的席次是${tierOf(rules, m.tier)?.name ?? m.tier}，進不了${tier.name}。`)

  const party = partyOf(o)
  if (!party.length) p.push('隊伍裡至少要有你自己。')
  else {
    if (party.length > rules.max_party) p.push(`一隊最多 ${rules.max_party} 個人（現在報了 ${party.length} 個）。`)
    if (!party.includes(state.pc)) p.push('會員本人要在隊伍裡：同伴只能跟著會員進場。')
    for (const id of party) {
      const a = state.actors[id]
      if (!a) { p.push(`找不到角色 ${id}。`); continue }
      if (!state.party.includes(id)) p.push(`${a.name}不在你的隊上。`)
      if (!hasBridge(k, state, id)) p.push(`${a.name}沒有橋：沒有橋的人進不了簾後館。`)
      if (!hasDeck(k, state, id)) p.push(`${a.name}沒有自己的甲板：館方不租甲板，也不發比賽版構裝。`)
    }
  }
  if (m && !m.suspended) {
    const week = weekOf(k, state)
    const tonight = week.runs[String(nightOf(k, state))] ?? 0
    if (tonight >= rules.runs_per_night) p.push(`今晚已經報了 ${tonight} 場：館方規定一晚最多 ${rules.runs_per_night} 場。`)
  }
  const quote = enterQuote(k, state, o)
  if (quote && state.money.cash < quote.total) {
    p.push(`現金不夠：保證金 C$${formatAmount(quote.deposit)}${quote.companions.length ? `，加上 ${quote.companions.length} 張同伴券 C$${formatAmount(quote.companionFee * quote.companions.length)}` : ''}，一共 C$${formatAmount(quote.total)}，你只有 C$${formatAmount(state.money.cash)}。`)
  }
  const pool = nightPool(k, state, rules)
  if (!pool.rows.length) p.push('這一週口味單與內容篩選之下，沒有抽得到的夜：先到口味單多勾幾個題材。')
  else if (o.night !== undefined && !pool.rows.some((n) => n.id === o.night)) p.push(`「${o.night}」這一週不在你抽得到的夜裡（口味單與內容篩選之下，抽得到的是：${pool.rows.map((n) => n.name).join('、')}）。`)
  return p
}

/** 這一趟選到的夜（報名時才擲；沒給 night 的話）。 */
function pickNight(k: Kernel, state: GameState, o: EnterOpts, rows: NightRow[]): { night: NightRow; rolled: boolean } {
  if (o.night !== undefined) return { night: rows.find((n) => n.id === o.night)!, rolled: false }
  return { night: rollNight(k, state, rows, nightOf(k, state)), rolled: true }
}

/**
 * 報名（報告 curtain.enter）：付保證金與同伴券（現金），選夜，開一趟 netrun。不成立丟 ActionBlocked。
 * 開不起來（netrun 的生成不合格）整步不成立，錢不會收。
 */
export function enterDraft(k: Kernel, state: GameState, o: EnterOpts): ReportDraft {
  const blocks = enterBlocks(k, state, o)
  if (blocks.length) throw new ActionBlocked(blocks.join(''))
  const rules = curtainRules(k)
  const quote = enterQuote(k, state, o)!
  const tier = quote.tier
  const pool = nightPool(k, state, rules)
  const { night, rolled } = pickNight(k, state, o, pool.rows)
  const party = state.party.filter((id) => partyOf(o).includes(id))
  const day = nightOf(k, state)
  const id = `q${state.seq.uid + 1}`
  const cur = readCurtain(state)
  const week = weekOf(k, state)
  week.runs[String(day)] = (week.runs[String(day)] ?? 0) + 1
  week.drawn[String(day)] = [...(week.drawn[String(day)] ?? []), night.id]
  cur.week = week
  cur.run = { id, night: night.id, tier: tier.id, grade: tier.grade, deposit: quote.deposit, feature: night.feature, pure_stage: pool.pure_stage, party, companions: quote.companions.filter((c) => party.includes(c)), at: nowOf(state), day, act: 0, orders: [], tips_mult: 1 }
  // 上一趟留下的加演資格作廢（報了新的一趟）
  delete cur.encore
  const changes: Change[] = [{ op: 'uid', advance: 1 }]
  if (quote.total > 0) changes.push({ op: 'cash', delta: -quote.total })
  if (rolled) changes.push({ op: 'rng', advance: 1 })
  changes.push(curtainChange(cur))

  const extra = { night: night.id, tier: tier.id, feature: night.feature, pure_stage: pool.pure_stage }
  const origin: Origin = { by: ORIGIN_BY, ref: night.id, ext: { curtain: extra } }
  const setup: Record<string, unknown> = {
    region: { ...clone(rules.region), id: REGION_ID, safe: true, pressure: 'none' }, grade: tier.grade, faction: 'none', layers: [...rules.acts], party,
    // 散座的終幕由中頭目守（首領「主持」只在包廂與貴賓席）：每一層守閘門的都用精英的組合
    ...(tier.id === 'floor' ? { encounter: ['elite', 'elite', 'minion'] } : {}),
    ...(o.seed !== undefined ? { seed: o.seed } : {}),
  }
  const lines = [
    `你在簾後館報名了${night.name}，坐${tier.name}，付了保證金 C$${formatAmount(quote.deposit)}。`,
    ...(quote.companions.length ? [`${quote.companions.length} 位同伴各付了同伴券 C$${formatAmount(quote.companionFee)}（同伴沒有打賞）。`] : []),
    ...(night.feature ? [`這是這一週的主打：打賞加成 ×${rules.feature_bonus}。`] : []),
    ...(pool.pure_stage ? ['口味單的題材不多，今晚是純舞台的場次。'] : []),
  ]
  return {
    kind: 'netrun', action: ENTER_ACTION, location: clone(state.location), actor: state.pc!, party: [],
    timeline: [{ layer: 'net', actor: state.pc!, text: lines[0]!, tag: ENTER_ACTION, data: { ...extra, deposit: quote.deposit, companions: quote.companions.length } }],
    changes, outcome: { result: 'entered', summary: lines.join('') }, narration: { results: lines }, launch: [{ kind: ACT_NETRUN, setup, origin }],
  }
}
