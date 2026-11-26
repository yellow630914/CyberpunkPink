// L6 功能 media 的發布（MEDIA 第 5 節；dev/adr/0020 V8～V11；dev/work/M5-media-cut.md）。對象是片（cl…）或不剪的素材（ft…，當成沒有角度的單段片）。
//   upload    直接上架（扣 1 次）：訂閱、公信力、角度的範本（目標勢力的聲望與敵對值、人氣、豔名……）；匿名打折；風險擲 d20，擲出風險以下出事
//   sell      賣斷（扣光）：錢進帳戶，其他都沒有
//   deal      拿去談判（扣光）：對象是涉及的一個勢力或人，擲交涉或威嚇；成功拿錢或中人情，失敗那個勢力敵對值 +5；不論成敗留下敵對值的下限
//   keep      留著（不扣）：回答掛點 defeat.options，贏的那一方的勢力對得上一件夠重的罪證時多一個選項
// 「帶進輿論戰」不在這裡：那是 opinion 來問掛點 media.spend。
// 結果寫到別人的數字一律用效果（subs、credibility、popularity、fame、standing、hostility、hostility_floor、owed_to_pc），每一筆先問 k.effects.has、
// 再驗格式，沒有人註冊（那個功能這一局沒裝）或格式不成立的整筆略過，不擋上架。錢（賣斷、勒索的現金）直接用變更 cred、cash：
// 效果 cash 對內建來源也照所在區的等級夾上限，賣一支片的價錢不該被區的等級夾掉。任何入口都不給街頭信譽（V54）。

import type { ActorId, CheckRoll, ClampNote, Effect, GameState, Kernel, ReportDraft, TimelineBeat } from '../../core'
import { ActionBlocked, checkParts, checkPassChance, clamp, dcFor, deriveRng, effectCtx, meterOf, rollCheck } from '../../core'
import { angleOf } from './angles'
import type { UploadTemplate } from './angles'
import { draftOf, materialOf, materialsOf, spend } from './chain'
import type { Part } from './cut'
import type { Material, MediaRules } from './model'
import { DEAL_ACTION, FORGE_RISK_STAT, SELL_ACTION, UPLOAD_ACTION, factionGrade, mediaRules, partyMin, readMedia } from './model'

const DEAL_SKILLS = { negotiate: 'charm', intimidate: 'resolve' } as const
export type DealSkill = keyof typeof DEAL_SKILLS

const SELF_KEYED = 'npc'

const nameOfFaction = (k: Kernel, id: string): string => {
  const n = k.content.hasKind('faction') ? k.content.get('faction', id)?.name : undefined
  return typeof n === 'string' && n ? n : id
}

/** 往 0 的方向捨去的「乘一個比例」（0.7 × 10 要剛好是 7，不要被浮點數吃掉）。 */
const scaleToward0 = (n: number, mult: number): number => Math.sign(n) * Math.floor(Math.abs(n) * mult + 1e-9)

const personName = (k: Kernel, state: GameState, id: string): string => {
  const n = state.actors[id]?.name ?? (k.content.hasKind('npc') ? k.content.get('npc', id)?.name : undefined)
  return typeof n === 'string' && n ? n : id
}

/** 一支料的可用狀態：不存在、用完了回完整的原因。 */
function usable(k: Kernel, state: GameState, ref: string): { material: Material | null; why: string | null } {
  const material = materialOf(k, state, ref)
  if (!material) return { material: null, why: '素材庫裡沒有這件料。' }
  if (material.uses <= 0) return { material, why: `「${material.title}」已經用完了，只能留著當紀念。` }
  return { material, why: null }
}

/** 一筆效果能不能用：這一局有人註冊、格式驗得過；不能用的回原因（略過、不擋）。 */
function checkedEffect(k: Kernel, state: GameState, fx: Effect, skipped: string[]): Effect | null {
  if (!k.effects.has(fx.kind)) { skipped.push(fx.kind); return null }
  if (k.effects.validate([fx], effectCtx(k, state, { source: 'builtin' })).length > 0) { skipped.push(fx.kind); return null }
  return fx
}

/** 主角自己那一份的效果鍵：照人分開記的量表（人氣）記在主角身上；其餘（區、不分對象）不寫鍵，由量表定。 */
function selfKey(k: Kernel, state: GameState, kind: string): { key?: string } | null {
  const def = k.meters.get(kind)
  if (def?.keyed !== SELF_KEYED) return {}
  return state.pc ? { key: state.pc } : null
}

// ---- 直接上架 ----

export interface UploadOpts {
  ref: string
  /** 匿名：訂閱與公信力的增減打折、不加敵對值、風險少 */
  anon?: boolean
}

export interface UploadPreview {
  /** 現在上架得了嗎 */
  ok: boolean
  block: string | null
  ref: string
  title: string
  anon: boolean
  /** d20 擲出這個數字以下就出事 */
  risk: number
  risk_parts: Part[]
  /** 出事的機率（0～1） */
  chance: number
  /** 上架的結果（定案之後的效果，這一局有人註冊的才列） */
  effects: Effect[]
  lines: string[]
  /** 風險擲中時另外發生的 */
  hit_effects: Effect[]
  hit_lines: string[]
  /** 沒有人註冊或格式不成立而略過的效果種類 */
  skipped: string[]
  clamps: ClampNote[]
}

interface UploadPlan {
  block: string | null
  material: Material | null
  anon: boolean
  risk: number
  risk_parts: Part[]
  base: Effect[]
  hit: Effect[]
  skipped: string[]
}

function planUpload(k: Kernel, state: GameState, o: UploadOpts): UploadPlan {
  const anon = o.anon === true
  const u = usable(k, state, o.ref)
  const m = u.material
  const empty = (block: string): UploadPlan => ({ block, material: m, anon, risk: 0, risk_parts: [], base: [], hit: [], skipped: [] })
  if (!m) return empty(u.why!)
  const act = k.activity.blockOf(state, `commit:${UPLOAD_ACTION}`)
  if (act) return empty(act)
  if (u.why) return empty(u.why)
  const rules = mediaRules(k)
  const up = rules.upload
  const angle = m.angle ? angleOf(k, m.angle) : undefined
  const templates: UploadTemplate[] = (angle?.upload ?? []).filter((t) => t.when !== 'self_intimate' || (m.self && m.types.includes('intimate')))
  const skipped: string[] = []
  const base: Effect[] = []
  const push = (fx: Effect): void => { const ok = checkedEffect(k, state, fx, skipped); if (ok) base.push(ok) }

  // 訂閱：看點 × 0.5%（最少看點 × 2 人），角度再加幾個百分點；匿名打折
  const subsNow = k.meters.has('subs') ? meterOf(k, state, 'subs') : 0
  const pct = m.draw * up.subs_pct + templates.filter((t) => t.kind === 'subs').reduce((s, t) => s + (t.pct ?? 0), 0)
  const flatSubs = templates.filter((t) => t.kind === 'subs').reduce((s, t) => s + (t.amount ?? 0), 0)
  let subs = m.draw > 0 ? Math.max(m.draw * up.subs_min, Math.floor((subsNow * pct) / 100 + 1e-9)) + flatSubs : flatSubs
  if (anon) subs = scaleToward0(subs, up.anon_mult)
  if (subs !== 0) push({ kind: 'subs', amount: subs })

  // 公信力：（可信 − 5）÷ 2 往 0 捨去、夾 ±2，加角度的；匿名打折
  const flatCred = templates.filter((t) => t.kind === 'credibility').reduce((s, t) => s + (t.amount ?? 0), 0)
  let cred = clamp(Math.trunc((m.trust - up.cred_base) / up.cred_div), -up.cred_limit, up.cred_limit) + flatCred
  if (anon) cred = scaleToward0(cred, up.anon_mult)
  if (cred !== 0) push({ kind: 'credibility', amount: cred })

  // 角度其餘的範本：目標勢力的聲望與敵對值、人氣、豔名……
  const factions = m.involves.factions
  for (const t of templates) {
    if (t.kind === 'subs' || t.kind === 'credibility' || t.amount === undefined || t.amount === 0) continue
    if (anon && t.anon === 'drop') continue
    if (t.to === 'targets') for (const f of factions) push({ kind: t.kind, key: f, amount: t.amount })
    else if (t.to === 'blame') {
      const blame = m.kind === 'clip' ? readMedia(state).clips[m.ref]?.blame : undefined
      if (blame) push({ kind: t.kind, key: blame, amount: t.amount })
    } else {
      const key = selfKey(k, state, t.kind)
      if (key) push({ kind: t.kind, ...key, amount: t.amount })
    }
  }

  // 風險：片的風險，匿名少 5；假料再加主角隊伍的 forge_risk（假料工坊讓它變負的）
  const risk_parts: Part[] = [{ label: m.kind === 'clip' ? '這支片的風險' : '這段素材的風險', value: m.risk }]
  if (anon) risk_parts.push({ label: '匿名上架', value: -up.anon_risk })
  if (m.forged) { const fr = k.stats.hasStat(FORGE_RISK_STAT) ? partyMin(k, state, FORGE_RISK_STAT) : 0; if (fr !== 0) risk_parts.push({ label: '假料的手藝', value: fr }) }
  const risk = Math.max(0, risk_parts.reduce((s, p) => s + p.value, 0))

  // 出事：被拍到的每個勢力敵對值上升（匿名不算在你頭上）；假料被拆穿，公信力重挫
  const hit: Effect[] = []
  const hitPush = (fx: Effect): void => { const ok = checkedEffect(k, state, fx, skipped); if (ok) hit.push(ok) }
  if (!anon) for (const f of factions) hitPush({ kind: 'hostility', key: f, amount: up.hostility })
  if (m.forged) hitPush({ kind: 'credibility', amount: -up.exposed })
  return { block: null, material: m, anon, risk, risk_parts, base, hit, skipped }
}

const lineOf = (k: Kernel, state: GameState, effects: Effect[]): { lines: string[]; effects: Effect[]; clamps: ClampNote[]; changes: ReportDraft['changes'] } => {
  if (effects.length === 0) return { lines: [], effects: [], clamps: [], changes: [] }
  const res = k.effects.resolve(effects, effectCtx(k, state, { source: 'builtin' }))
  return res.errors.length > 0 ? { lines: [], effects: [], clamps: [], changes: [] } : { lines: res.lines, effects: res.effects, clamps: res.clamps, changes: res.changes }
}

/** 上架之前先看：定案的效果、風險（d20 擲出幾以下出事）、出事時另外發生的事。 */
export function uploadPreview(k: Kernel, state: GameState, o: UploadOpts): UploadPreview {
  const p = planUpload(k, state, o)
  const base = lineOf(k, state, p.base)
  const hit = lineOf(k, state, p.hit)
  return {
    ok: p.block === null, block: p.block, ref: o.ref, title: p.material?.title ?? '', anon: p.anon, risk: p.risk, risk_parts: p.risk_parts, chance: clamp(p.risk, 0, 20) / 20,
    effects: base.effects, lines: base.lines, hit_effects: hit.effects, hit_lines: hit.lines, skipped: [...new Set(p.skipped)], clamps: base.clamps,
  }
}

export const uploadBlock = (k: Kernel, state: GameState, o: UploadOpts): string | null => planUpload(k, state, o).block

/** 直接上架：扣 1 次、結算效果、擲一次 d20 看風險。報告帶 { op: 'rng', advance: 1 }。 */
export function upload(k: Kernel, state: GameState, o: UploadOpts): ReportDraft {
  const p = planUpload(k, state, o)
  if (p.block !== null || !p.material) throw new ActionBlocked(p.block ?? '現在上架不了。')
  const m = p.material
  const sp = spend(k, state, { ref: m.ref, how: 'upload' })
  if ('block' in sp) throw new ActionBlocked(sp.block)
  const roll = deriveRng(state.rng, `${UPLOAD_ACTION}/${m.ref}`).int(1, 20)
  const hit = roll <= p.risk
  // 上架的效果與出事的效果依序結算（後面的看得到前面的結果）
  const res = lineOf(k, state, hit ? [...p.base, ...p.hit] : p.base)
  const lines = [`你把「${m.title}」${p.anon ? '匿名' : ''}上架了。`]
  if (hit) lines.push(m.forged ? '風聲走漏了，而且有人看穿了那是假的。' : p.anon ? '風聲走漏了，但沒有人知道是誰放的。' : '風聲走漏了，被拍到的勢力注意到了你。')
  const beat: TimelineBeat = {
    layer: 'meat', ...(state.pc ? { actor: state.pc } : {}), text: lines[0]!, tag: 'media.upload',
    data: { ref: m.ref, angle: m.angle ?? null, anon: p.anon, risk: p.risk, roll, hit, forged: m.forged, draw: m.draw, trust: m.trust, effects: res.effects, ...(p.skipped.length > 0 ? { skipped: [...new Set(p.skipped)] } : {}) },
  }
  const clip = m.kind === 'clip'
  const titled = clip && readMedia(state).clips[m.ref]?.titled === true
  return draftOf(state, UPLOAD_ACTION, [...sp.changes, ...res.changes, { op: 'rng', advance: 1 }], hit ? (m.forged ? 'exposed' : 'caught') : 'posted', lines.join(''), {
    timeline: [beat], narration: { results: lines }, ...(res.clamps.length > 0 ? { clamps: res.clamps } : {}),
    ...(titled ? { input: `${m.title}\n${m.intro ?? ''}` } : {}),
  })
}

// ---- 賣斷 ----

/** 賣斷的價錢：C$ 80 × 品質² ×（獨家 1.5）× 剩下的次數 ÷ 3，四捨五入（V10）；料不存在或用完是 null。 */
export function sellPrice(k: Kernel, state: GameState, ref: string): number | null {
  const u = usable(k, state, ref)
  if (!u.material || u.why) return null
  const rules = mediaRules(k)
  return priceOf(u.material, rules)
}

const priceOf = (m: Material, rules: MediaRules): number => Math.round(rules.sell.price * m.quality * m.quality * (m.exclusive ? rules.sell.exclusive : 1) * (m.uses / rules.uses) + 1e-9)

export function sellBlock(k: Kernel, state: GameState, ref: string): string | null {
  const u = usable(k, state, ref)
  return u.why ?? k.activity.blockOf(state, `commit:${SELL_ACTION}`)
}

/** 賣斷：把剩下的次數全部用掉，拿一筆錢進帳戶，其他都沒有。 */
export function sell(k: Kernel, state: GameState, ref: string): ReportDraft {
  const block = sellBlock(k, state, ref)
  if (block) throw new ActionBlocked(block)
  const m = materialOf(k, state, ref)!
  const price = priceOf(m, mediaRules(k))
  const sp = spend(k, state, { ref, how: 'sell', all: true })
  if ('block' in sp) throw new ActionBlocked(sp.block)
  const line = `你把「${m.title}」賣斷了，換了一筆錢。`
  const beat: TimelineBeat = { layer: 'meat', ...(state.pc ? { actor: state.pc } : {}), text: line, tag: 'media.sell', data: { ref, price, quality: m.quality, exclusive: m.exclusive, uses: m.uses } }
  return draftOf(state, SELL_ACTION, [...sp.changes, { op: 'cred', delta: price }], 'sold', `你把「${m.title}」賣斷了，進帳 ${price} C$。`, { timeline: [beat], narration: { results: [line] } })
}

// ---- 拿去談判 ----

export interface DealTarget {
  id: string
  kind: 'faction' | 'person'
  name: string
  grade: number
  /** 這個對象的 DC（13 ＋ 等級 × 2，加上難度的偏移） */
  dc: number
  /** 用比較強的那一項（交涉或威嚇）過關的機率 */
  chance: number
  skill: DealSkill
}

function dealBonus(k: Kernel, state: GameState, skill: DealSkill): number {
  return checkParts(k.stats, state, state.pc as ActorId, { attr: DEAL_SKILLS[skill], skill, tags: ['deal'] }).reduce((s, p) => s + p.value, 0)
}

const bestSkill = (k: Kernel, state: GameState): DealSkill => (dealBonus(k, state, 'intimidate') > dealBonus(k, state, 'negotiate') ? 'intimidate' : 'negotiate')

/** 這件料可以拿去跟誰談：涉及的每一個勢力與人。 */
export function dealTargets(k: Kernel, state: GameState, ref: string): DealTarget[] {
  const m = materialOf(k, state, ref)
  if (!m || !state.pc || !state.actors[state.pc]) return []
  const rules = mediaRules(k)
  const skill = bestSkill(k, state)
  const bonus = dealBonus(k, state, skill)
  const make = (id: string, kind: DealTarget['kind'], name: string, grade: number): DealTarget => {
    const dc = dcFor(rules.deal.dc + grade * rules.deal.per_grade, state.rules)
    return { id, kind, name, grade, dc, chance: checkPassChance(bonus, dc), skill }
  }
  return [
    ...m.involves.factions.map((f) => make(f, 'faction', nameOfFaction(k, f), factionGrade(k, f, rules))),
    ...m.involves.people.map((p) => make(p, 'person', personName(k, state, p), rules.grade_default)),
  ]
}

export interface DealOpts {
  ref: string
  /** 對象的 id（dealTargets 列的其中一個） */
  target: string
  /** 擲哪一項；沒寫就用兩項裡加值比較高的 */
  skill?: DealSkill
  /** 成功拿什麼：現金（賣斷價的 2 倍）或一個中人情；預設現金 */
  take?: 'cash' | 'favor'
}

export function dealBlock(k: Kernel, state: GameState, o: DealOpts): string | null {
  const u = usable(k, state, o.ref)
  if (u.why) return u.why
  const act = k.activity.blockOf(state, `commit:${DEAL_ACTION}`)
  if (act) return act
  if (!state.pc || !state.actors[state.pc]) return '還沒有主角，沒有人可以去談。'
  const t = dealTargets(k, state, o.ref).find((x) => x.id === o.target)
  if (!t) return '這件料裡沒有拍到這個人或勢力，沒有東西可以拿去跟他談。'
  if (o.skill !== undefined && !(o.skill in DEAL_SKILLS)) return '談判只能擲交涉或威嚇。'
  const take = o.take ?? 'cash'
  if (take !== 'cash' && take !== 'favor') return '成功之後只能拿現金或人情。'
  if (take === 'favor') {
    const fx = { kind: 'owed_to_pc', who: t.id, size: 'mid' }
    if (!k.effects.has('owed_to_pc')) return '現在沒有地方記人情，只能拿現金。'
    if (k.effects.validate([fx], effectCtx(k, state, { source: 'builtin' })).length > 0) return `${t.name}不是能欠你人情的對象，只能拿現金。`
  }
  return null
}

/** 拿去談判：把剩下的次數全部用掉，擲交涉或威嚇；成功拿錢或人情，失敗那個勢力敵對值 +5；不論成敗留下敵對值的下限。 */
export function deal(k: Kernel, state: GameState, o: DealOpts): ReportDraft {
  const block = dealBlock(k, state, o)
  if (block) throw new ActionBlocked(block)
  const rules = mediaRules(k)
  const m = materialOf(k, state, o.ref)!
  const t = dealTargets(k, state, o.ref).find((x) => x.id === o.target)!
  const skill = o.skill ?? bestSkill(k, state)
  const pc = state.pc as ActorId
  const roll: CheckRoll = rollCheck(k.stats, state, { actor: pc, attr: DEAL_SKILLS[skill], skill, dc: t.dc, purpose: `${DEAL_ACTION}/${o.ref}`, tags: ['deal'] })
  const good = roll.degree === 'critical' || roll.degree === 'success'
  const take = o.take ?? 'cash'
  const price = Math.round(priceOf(m, rules) * rules.deal.cash_mult + 1e-9)
  const sp = spend(k, state, { ref: o.ref, how: 'deal', all: true })
  if ('block' in sp) throw new ActionBlocked(sp.block)
  const changes: ReportDraft['changes'] = [...sp.changes, { op: 'rng', advance: 1 }]
  const skipped: string[] = []
  const fx: Effect[] = []
  if (good && take === 'favor') fx.push({ kind: 'owed_to_pc', who: t.id, size: 'mid' })
  if (good && take === 'cash') changes.push({ op: 'cash', delta: price })
  if (t.kind === 'faction') {
    if (!good) { const e = checkedEffect(k, state, { kind: 'hostility', key: t.id, amount: rules.deal.fail_hostility }, skipped); if (e) fx.push(e) }
    const floor = checkedEffect(k, state, { kind: 'hostility_floor', key: t.id, amount: rules.deal.floor }, skipped)
    if (floor) fx.push(floor)
  }
  const res = lineOf(k, state, fx)
  changes.push(...res.changes)
  const line = good
    ? (take === 'cash' ? `你拿「${m.title}」跟${t.name}談，對方付了一筆錢買斷。` : `你拿「${m.title}」跟${t.name}談，對方欠了你一個人情。`)
    : `你拿「${m.title}」跟${t.name}談，對方不吃這一套。`
  const beat: TimelineBeat = {
    layer: 'meat', actor: pc, text: line, roll, tag: 'media.deal',
    data: { ref: o.ref, target: t.id, target_kind: t.kind, skill, dc: t.dc, degree: roll.degree, take, ...(good && take === 'cash' ? { price } : {}), effects: res.effects },
  }
  return draftOf(state, DEAL_ACTION, changes, good ? 'dealt' : 'refused', line, { timeline: [beat], narration: { results: [line] }, ...(res.clamps.length > 0 ? { clamps: res.clamps } : {}) })
}

// ---- 留著當保命符 ----

/** 對得上那個勢力的保命符：罪證類、品質夠、涉及那個勢力、還有次數；有好幾件時取品質高的、次數多的。 */
export function keepMaterial(k: Kernel, state: GameState, faction: string): Material | null {
  const rules = mediaRules(k)
  const list = materialsOf(k, state).filter((m) => m.types.includes(rules.keep.type) && m.quality >= rules.keep.quality_min && m.involves.factions.includes(faction))
  list.sort((a, b) => b.quality - a.quality || b.uses - a.uses || (a.ref < b.ref ? -1 : a.ref > b.ref ? 1 : 0))
  return list[0] ?? null
}

/** 掛點 defeat.options 的答案：被那個勢力（贏的那一方）俘虜時，多一個「帶子會自己發出去」。 */
export function keepOptions(k: Kernel, state: GameState, faction: string | undefined): Array<{ id: string; name: string; desc: string; blocks: string[]; changes: ReportDraft['changes']; lines: string[]; summary: string }> | undefined {
  if (!faction) return undefined
  const m = keepMaterial(k, state, faction)
  if (!m) return undefined
  const rules = mediaRules(k)
  const name = nameOfFaction(k, faction)
  const floor = checkedEffect(k, state, { kind: 'hostility_floor', key: faction, amount: rules.keep.floor }, [])
  const res = lineOf(k, state, floor ? [floor] : [])
  return [{
    id: 'media_keep', name: '帶子會自己發出去',
    desc: `你手上有「${m.title}」：${name}的罪證。你說你們敢動我，帶子就會自己發出去，對方只好放人；這件料用完，${name}對你的敵對值會留下一個下限。跳過戰敗事件的內容。`,
    blocks: [],
    changes: [{ op: 'media.use', ref: m.ref, take: 'all' }, ...res.changes],
    lines: [`你亮出了「${m.title}」，${name}不敢動你。那件料用完了。`],
    summary: `你亮出了${name}的罪證，沒有經歷戰敗事件；「${m.title}」用完了。`,
  }]
}
