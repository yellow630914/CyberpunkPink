// 委託副本的輿論面：副本給的 setup 怎麼變成一場輿論戰的開場（OPINION 4.5、第 6 節；DATA 9.1；dev/adr/0020 第六節）。
// 開場 ＝ opinion_setup.base ＋ 每一個「setup.links 裡有」的 from_links（加一張牌、聲量、風向、多佔的格子、對手第一回合的公關點）＋ 這條分支的 open，
// 最後才是 opinion.open 掛點的回答（start.ts 把這裡算好的排在掛點前面）。前面的階段在開戰前就結算完了，所以開場表只讀 setup，不讀狀態。
// 回合數沒寫：決定性的一步是 6、其餘是 4（短戰；DATA 9.1）。這個檔不改任何東西：faceStartPreview 與實際開場共用同一個函式，所以兩邊一樣。

import type { Change, GameState, Kernel, Origin } from '../../core'
import { ActionBlocked, clone, isRecord, isSafeInt } from '../../core'
import type { OpOpen } from './hooks'
import { CELL_NAME, TOPIC_KIND, cardCatalog, isCell, cellKey, opinionRules } from './model'
import type { Cell } from './model'
import type { OpinionSetup } from './start'
import { skeleton } from './start'

export interface FaceOpenSpec {
  voice?: number
  wind?: number
  cells?: string[]
}

export interface FaceLinkSpec extends FaceOpenSpec {
  link: string
  /** 牌庫多放的牌（opinion_card 的 id） */
  add_card?: string
  /** 對手第一回合的公關點加減（負的是少，例：−2） */
  opponent_pr_first_round?: number
}

/** setup.opinion：副本的 opinion_setup 蓋上這一面的資料（rounds、opponent、open 副本已經蓋好）。 */
export interface FaceOpinion {
  topic: string | Record<string, unknown>
  opponent: string | (Record<string, unknown> & { id?: string; strength?: number; named?: string })
  base?: FaceOpenSpec
  from_links?: FaceLinkSpec[]
  rounds?: number
}

/** 副本開輿論面時給的 setup（0020 第六節）。沒寫的欄位多半有預設。 */
export interface FaceSetup {
  commission: string
  stage: number
  face?: string
  branch?: string
  branch_kind?: string
  grade?: number
  faction?: string
  links?: string[]
  route?: unknown[]
  decisive?: boolean
  where?: Record<string, unknown>
  opinion: FaceOpinion
  /** 這條分支的開場加減 */
  open?: FaceOpenSpec
  /** 坐編輯台的人與帶進牌庫的料（介面在選分支之前先問好；沒給就是主角一個人、不帶料） */
  desk?: Array<string | { actor: string; ep?: number }>
  bring?: string[]
  /** 委託人（收買被接受時好感掉；faction 的 id） */
  employer?: string
  /** 外包：指定名冊上一個不在隊伍裡的人，不開棋盤直接出結果（outsource.ts） */
  outsource?: string
  [more: string]: unknown
}

const fail = (msg: string): never => {
  throw new ActionBlocked(msg)
}

const sign = (n: number): string => `${n >= 0 ? '+' : '−'}${Math.abs(n)}`

export interface FaceOpenItem {
  source: 'base' | 'link' | 'branch'
  /** 連動的 id（source 是 link） */
  link?: string
  /** 拿到了沒有（底子與分支的永遠是 true；沒拿到的連動沒有效果） */
  got: boolean
  voice: number
  wind: number
  cells: string[]
  card?: string
  /** 對手第一回合少幾點（負的是多） */
  foe_pr_first: number
  line: string
}

function specProblems(spec: unknown, where: string): void {
  if (!isRecord(spec)) return fail(`輿論戰的開場表（${where}）要是 { voice, wind, cells } 的樣子。`)
  for (const f of ['voice', 'wind'] as const) if (spec[f] !== undefined && !isSafeInt(spec[f])) fail(`輿論戰的開場表（${where}）的 ${f} 要是整數。`)
  if (spec.cells !== undefined && !(Array.isArray(spec.cells) && spec.cells.every((c) => typeof c === 'string' && isCell(cellKey(c))))) fail(`輿論戰的開場表（${where}）的 cells 要是格子 id 的陣列。`)
}

/** 一筆加減寫成一句話（沒有句號）。 */
function describe(k: Pick<Kernel, 'content'>, o: { voice: number; wind: number; cells: string[]; card?: string; foe_pr_first: number }): string {
  const parts: string[] = []
  if (o.voice !== 0) parts.push(`聲量 ${sign(o.voice)}`)
  if (o.wind !== 0) parts.push(`風向 ${sign(o.wind)}`)
  if (o.cells.length > 0) parts.push(`開場就佔著${o.cells.map((c) => `「${CELL_NAME[cellKey(c) as Cell]}」`).join('、')}`)
  if (o.card !== undefined) parts.push(`牌庫多一張「${cardCatalog(k).find((c) => c.id === o.card)?.name ?? o.card}」`)
  if (o.foe_pr_first !== 0) parts.push(`對手第一回合${o.foe_pr_first > 0 ? '少' : '多'} ${Math.abs(o.foe_pr_first)} 點公關點`)
  return parts.length > 0 ? parts.join('，') : '沒有加減'
}

function mk(k: Pick<Kernel, 'content'>, source: FaceOpenItem['source'], got: boolean, spec: FaceLinkSpec | FaceOpenSpec, link?: string): FaceOpenItem {
  const s = spec as FaceLinkSpec
  const base = {
    voice: got ? (s.voice ?? 0) : 0, wind: got ? (s.wind ?? 0) : 0, cells: got ? (s.cells ?? []).map(cellKey) : [], foe_pr_first: got ? -(s.opponent_pr_first_round ?? 0) : 0,
    ...(got && s.add_card !== undefined ? { card: s.add_card } : {}),
  }
  const head = source === 'base' ? '開場的底子' : source === 'branch' ? '這條路的開場' : got ? `前面拿到的「${link}」` : `前面沒有拿到「${link}」`
  return { source, ...(link !== undefined ? { link } : {}), got, ...base, line: got ? `${head}：${describe(k, base)}` : `${head}，這一項沒有加成` }
}

/** 開場表的每一項（照 OPINION 4.5 的順序：底子、每一個 from_links、分支的 open）；沒拿到的連動也列出來（got 是 false）。格式不對丟 ActionBlocked。 */
export function faceOpens(k: Pick<Kernel, 'content'>, setup: FaceSetup): FaceOpenItem[] {
  const op = setup.opinion
  if (!isRecord(op)) return fail('這一段缺少輿論戰的設定（opinion）。')
  const links = setup.links ?? []
  const out: FaceOpenItem[] = []
  if (op.base !== undefined) {
    specProblems(op.base, 'base')
    out.push(mk(k, 'base', true, op.base))
  }
  if (op.from_links !== undefined) {
    if (!Array.isArray(op.from_links)) fail('輿論戰的開場表（from_links）要是陣列。')
    for (const l of op.from_links as FaceLinkSpec[]) {
      if (!isRecord(l) || typeof l.link !== 'string' || l.link === '') fail('輿論戰的開場表（from_links）每一筆要寫 link（連動的 id）。')
      specProblems(l, `from_links/${l.link}`)
      if (l.add_card !== undefined && typeof l.add_card !== 'string') fail(`輿論戰的開場表（from_links/${l.link}）的 add_card 要是牌的 id。`)
      if (l.opponent_pr_first_round !== undefined && !isSafeInt(l.opponent_pr_first_round)) fail(`輿論戰的開場表（from_links/${l.link}）的 opponent_pr_first_round 要是整數。`)
      out.push(mk(k, 'link', links.includes(l.link), l, l.link))
    }
  }
  if (setup.open !== undefined) {
    specProblems(setup.open, 'open')
    out.push(mk(k, 'branch', true, setup.open))
  }
  return out
}

/** 回合數：這一面寫的、議題自己寫的、最後才是預設（決定性的一步 6、其餘 4）。 */
export function faceRounds(k: Pick<Kernel, 'content'>, setup: FaceSetup): number {
  const op = setup.opinion
  const rules = opinionRules(k)
  if (isSafeInt(op.rounds)) return op.rounds
  const t = op.topic
  const own = typeof t === 'string' ? (k.content.hasKind(TOPIC_KIND) ? k.content.get<{ id: string; rounds?: unknown }>(TOPIC_KIND, t)?.rounds : undefined) : (isRecord(t) ? t.rounds : undefined)
  if (isSafeInt(own)) return own
  return setup.decisive === true ? rules.rounds : rules.short_rounds
}

/** 副本給的 setup 變成 startDraft 吃的設定。 */
export function faceOpenSetup(k: Kernel, setup: FaceSetup): OpinionSetup {
  if (!isRecord(setup)) return fail('輿論面的 setup 要是一個物件。')
  const op = setup.opinion
  if (!isRecord(op) || op.topic === undefined || op.opponent === undefined) return fail('這一段缺少輿論戰的設定（opinion 要有 topic 與 opponent）。')
  if (typeof setup.commission !== 'string' || setup.commission === '') return fail('輿論面的 setup 要寫是哪一件委託（commission）。')
  if (setup.stage !== undefined && !isSafeInt(setup.stage)) fail('輿論面的 setup.stage 要是整數。')
  const opponent = op.opponent
  const foe = typeof opponent === 'string' ? opponent : isRecord(opponent) && Array.isArray(opponent.actions) ? (opponent as Record<string, unknown>) : (opponent.id as string | undefined)
  if (foe === undefined) return fail('這一段的對手要寫 id（opinion.opponent.id）。')
  const strength = isRecord(opponent) && opponent.strength !== undefined ? opponent.strength : undefined
  const items = faceOpens(k, setup)
  const opens: OpOpen[] = items
    .filter((i) => i.got)
    .map((i) => ({
      owner: i.source === 'link' ? `link:${i.link}` : i.source, ...(i.voice !== 0 ? { voice: i.voice } : {}), ...(i.wind !== 0 ? { wind: i.wind } : {}), ...(i.cells.length > 0 ? { cells: i.cells } : {}),
      ...(i.card !== undefined ? { cards: [i.card] } : {}), ...(i.foe_pr_first !== 0 ? { foe_pr_first: i.foe_pr_first } : {}), line: i.line,
    }))
  return {
    topic: op.topic, foe, ...(strength !== undefined ? { strength: strength as number } : {}), ...(setup.grade !== undefined ? { grade: setup.grade } : {}),
    ...(setup.desk !== undefined ? { desk: setup.desk } : {}), ...(setup.bring !== undefined ? { bring: setup.bring } : {}),
    rounds: faceRounds(k, setup), mode: 'face', links: [...(setup.links ?? [])], commission: setup.commission, stage: setup.stage ?? 0, decisive: setup.decisive === true,
    ...(setup.employer !== undefined ? { employer: setup.employer } : {}), opens,
  }
}

export interface FaceStartPreview {
  /** 開得成嗎：不成的原因（一句完整的話）；開得成是 null */
  block: string | null
  rounds: number
  decisive: boolean
  /** 議題與對手（解得出來才有） */
  topic: { id: string; name: string; kind: string } | null
  foe: { id: string; name: string; strength: number } | null
  /** 每一項（沒拿到的連動也在，got 是 false） */
  items: FaceOpenItem[]
  /** 拿到的合計：聲量、風向、多佔的格子、牌庫多的牌、對手第一回合少幾點 */
  total: { voice: number; wind: number; cells: string[]; cards: string[]; foe_pr_first: number }
}

/** 開場會是什麼（純函式、不改狀態）：每一個拿到的連動換成什麼。介面在選分支之前、選面之後給玩家看。 */
export function faceStartPreview(k: Kernel, state: GameState, setup: FaceSetup, origin: Origin = { by: 'commission', ref: setup?.commission }): FaceStartPreview {
  let items: FaceOpenItem[] = []
  const total: FaceStartPreview['total'] = { voice: 0, wind: 0, cells: [], cards: [], foe_pr_first: 0 }
  let block: string | null = null
  let rounds = 0
  let topic: FaceStartPreview['topic'] = null
  let foe: FaceStartPreview['foe'] = null
  try {
    items = faceOpens(k, setup)
    rounds = faceRounds(k, setup)
    for (const i of items) {
      if (!i.got) continue
      total.voice += i.voice
      total.wind += i.wind
      for (const c of i.cells) if (!total.cells.includes(c)) total.cells.push(c)
      if (i.card !== undefined) total.cards.push(i.card)
      total.foe_pr_first += i.foe_pr_first
    }
    // 議題與對手：照開場真正會用的那一套解（skeleton 是純函式；這時已經有一場戰役在打會丟「已經有一場輿論戰在進行了」）
    const sk = skeleton(k, state, { ...faceOpenSetup(k, setup), bring: undefined, desk: undefined }, origin)
    rounds = sk.war.rounds
    topic = { id: sk.war.topic.id, name: sk.war.topic.name, kind: sk.war.topic.kind }
    foe = { id: sk.war.foe.id, name: sk.war.foe.name, strength: sk.war.foe.strength }
  } catch (e) {
    if (!(e instanceof ActionBlocked)) throw e
    block = e.message
  }
  return { block, rounds, decisive: setup?.decisive === true, topic, foe, items, total }
}

export const OPINION_SNAPSHOT = 'opinion'

/** 開戰前的快照（第一筆變更）：重來這一場、回到這個階段開始都從這裡回去。 */
export function snapshotChange(setup: FaceSetup, origin: Origin): Change {
  return {
    op: 'snapshot.take', kind: OPINION_SNAPSHOT, label: '輿論戰開打前', replace: true,
    ...(typeof setup.commission === 'string' && setup.commission !== '' ? { owner: setup.commission } : {}),
    data: { setup: clone(setup), origin: clone(origin) },
  }
}
