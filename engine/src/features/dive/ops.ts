// L6 功能 dive 的入口：潛入（enter）、去處（sites）與選一個去處（go）、登出（exit）。
// 改狀態的入口都是「匯出一個純函式，回傳報告草稿」，不成立丟 ActionBlocked（原因一句一條）：介面交給 Game.commit。
// 規格：CYBERSPACE 2.1～2.4 節、第 1 節的表（時間一比一、倒下之後）、4.1 節、4.3 節；NETRUNNING 第 3 節；EVENTS 3.3 節（子網與內海：登入與登出）；dev/adr/0018 第八節與 N30。
//
// 報告（kind netrun）：dive.enter（潛入）、dive.go（選了一個去處）、dive.exit（登出；被強制斷線時自動接的那一份也是它）。觸發點 login、logout。

import type { Change, GameState, Kernel, Launch, ReportDraft, ReportTrigger } from '../../core'
import { ActionBlocked, attachActivityEnd, clone, effectCtx, endActivity, formatAmount, toMinutes } from '../../core'
import type { DiveState, NetSiteEntry, OverKind } from './model'
import { ACT, ACT_NETRUN, SITE_KIND, accessName, diveChange, isText, readDive } from './model'
import { diveOptions } from './options'

/** 觸發點的 where：現在在哪一區哪一塊（站在設施上就帶設施的標記）。 */
function whereOf(location: GameState['location']): Record<string, string> {
  const { district, block, facility } = location
  return { ...(district ? { district } : {}), ...(block ? { block } : {}), ...(facility ? { facility } : {}) }
}

function draftOf(
  state: GameState, action: string, changes: Change[], result: string, summary: string,
  o: { lines?: string[]; triggers?: ReportTrigger[]; launch?: Launch[]; layer?: 'meat' | 'net' } = {},
): ReportDraft {
  const lines = o.lines ?? []
  return {
    kind: 'netrun', action, location: clone(state.location), ...(state.pc ? { actor: state.pc } : {}), party: [], timeline: [
      { layer: o.layer ?? 'net', ...(state.pc ? { actor: state.pc } : {}), text: lines[0] ?? summary, tag: action },
    ],
    changes, outcome: { result, summary }, ...(lines.length ? { narration: { results: lines } } : {}),
    ...(o.triggers?.length ? { triggers: o.triggers } : {}), ...(o.launch?.length ? { launch: o.launch } : {}),
  }
}

// ---- 潛入 ----

/** 現在潛不潛得入；能是 null（原因一條一句接起來）。 */
export function enterBlock(k: Kernel, state: GameState): string | null {
  return diveOptions(k, state).block
}

/**
 * 潛入（報告 dive.enter）：付費用（有租甲板時加押金，都是現金）；自己有甲板用自己的，沒有而這裡有租的就租（效果 deck_rental），都沒有是訪客；
 * 記下身體的位置（state.ext.dive.body）；帶觸發點 login。不成立丟 ActionBlocked。
 */
export function enter(k: Kernel, state: GameState): ReportDraft {
  const o = diveOptions(k, state)
  if (o.block || !o.here) throw new ActionBlocked(o.block ?? '現在潛不進去。')
  const here = o.here
  const changes: Change[] = []
  if (o.cost > 0) changes.push({ op: 'cash', delta: -o.cost })
  if (o.deck === 'rental') {
    const res = k.effects.resolve([{ kind: 'deck_rental', deck: here.rental!.deck }], effectCtx(k, state, { source: 'builtin' }))
    if (res.errors.length > 0) throw new ActionBlocked(`接入艙租不出甲板：${res.errors.join('；')}`)
    changes.push(...res.changes)
  }
  const next: DiveState = {
    since: toMinutes(state.time),
    body: { location: clone(state.location), ...(state.location.facility ? { at: state.location.facility } : {}) },
    access: { ...(here.marker ? { facility: here.marker } : {}), type: here.type, safe: here.safe, name: here.name },
    deck: o.deck,
    ...(o.fee > 0 || o.deposit > 0 ? { paid: { fee: o.fee, deposit: o.deposit } } : {}),
  }
  changes.push(diveChange(next))
  const deckLine = o.deck === 'own' ? '用的是自己的甲板。' : o.deck === 'rental' ? `接入艙附了一副租用的甲板「${here.rental!.name}」，用完要還。` : '你沒有甲板，只能以訪客的身分進去：逛、買、玩，遇到事只能登出。'
  const paidLine = o.cost > 0 ? `付了 ${formatAmount(o.cost)}${o.deposit > 0 ? `（押金 ${formatAmount(o.deposit)} 登出時退）` : ''}。` : ''
  // 給正文用的句子不帶機制的數字：錢與押金寫在摘要裡
  const lines = [`你躺進${here.name}的接入艙，意識沉進了內海。`, deckLine]
  return draftOf(state, 'dive.enter', changes, o.deck, `你躺進${here.name}的接入艙，意識潛入了內海。${deckLine}${paidLine}`, {
    lines, triggers: [{ point: 'login', where: whereOf(state.location) }],
  })
}

// ---- 去處 ----

export interface SiteRow {
  id: string
  name: string
  kind: NetSiteEntry['kind']
  need: NetSiteEntry['need']
  desc?: string
  /** 現在去不了的原因（完整的句子）；去得了是 null */
  block: string | null
}

/** 這個條件成不成立（沒寫就成立）。 */
function whenOk(k: Kernel, state: GameState, site: NetSiteEntry): boolean {
  return !site.when || k.conditions.test(site.when, { state, stats: k.stats, timeRules: k.timeRules })
}

function needBlock(need: NetSiteEntry['need'], deck: DiveState['deck']): string | null {
  if (need === 'any') return null
  if (need === 'rental') return deck === 'none' ? '這裡要有甲板才進得去：你是訪客，沒有甲板。' : null
  return deck === 'own' ? null : deck === 'rental' ? '這裡只有自己的甲板進得去：租來的甲板不行。' : '這裡只有自己的甲板進得去：你是訪客，沒有甲板。'
}

function siteBlock(k: Kernel, state: GameState, d: DiveState, site: NetSiteEntry): string | null {
  if (d.over) return '你被強制斷線了：先登出。'
  const need = needBlock(site.need, d.deck)
  if (need) return need
  if (site.kind === 'netrun' && !k.activity.get(ACT_NETRUN)) return '這個地方的入口還沒有接上。'
  if (site.kind === 'block' && !k.effects.has('move')) return '這個地方還走不進去：城市的功能還沒有接上。'
  return k.activity.blockOf(state, 'commit:dive.go')
}

/** 去得了的地方與去不了的原因（沒有潛入是空的；when 不成立的不列）。 */
export function sites(k: Kernel, state: GameState): SiteRow[] {
  const d = readDive(state)
  if (!d) return []
  return k.content.list<NetSiteEntry>(SITE_KIND).filter((s) => whenOk(k, state, s)).map((s) => ({
    id: s.id, name: s.name, kind: s.kind, need: s.need, ...(isText(s.desc) ? { desc: s.desc } : {}), block: siteBlock(k, state, d, s),
  }))
}

/** 現在去不去得了這個地方；去得了是 null。 */
export function goBlock(k: Kernel, state: GameState, siteId: string): string | null {
  const d = readDive(state)
  if (!d) return '你還沒有潛入。'
  const site = k.content.get<NetSiteEntry>(SITE_KIND, siteId)
  if (!site || !whenOk(k, state, site)) return '沒有這個地方，或現在不在你去得了的地方裡。'
  return siteBlock(k, state, d, site)
}

/**
 * 選一個去處（報告 dive.go）。kind 是 netrun 的：帶一個 launch 開那一趟（origin.by 是 dive；資料的 setup.by 寫了別的功能就用那個，讓它接手）；
 * kind 是 block 的：用效果 move 把人放到那一塊（沒有人登記 move 就去不了）。
 */
export function go(k: Kernel, state: GameState, siteId: string): ReportDraft {
  const block = goBlock(k, state, siteId)
  if (block) throw new ActionBlocked(block)
  const site = k.content.get<NetSiteEntry>(SITE_KIND, siteId)!
  if (site.kind === 'netrun') {
    const setup = clone(site.setup ?? {})
    const by = isText(setup.by) ? setup.by : ACT
    return draftOf(state, 'dive.go', [], 'launched', `你選了「${site.name}」，開始了一趟。`, {
      lines: [`你選了「${site.name}」，朝那裡潛了過去。`],
      launch: [{ kind: ACT_NETRUN, setup, origin: { by, ref: site.id, ext: { dive: true, site: site.id } } }],
    })
  }
  const res = k.effects.resolve([{ kind: 'move', block: site.block, ...(site.marker ? { at: site.marker } : {}) }], effectCtx(k, state, { source: 'builtin' }))
  if (res.errors.length > 0) throw new ActionBlocked(`「${site.name}」走不進去：${res.errors.join('；')}`)
  return draftOf(state, 'dive.go', res.changes, 'moved', `你走進了「${site.name}」。`, { lines: [`你走進了「${site.name}」。`] })
}

// ---- 登出 ----

/** 現在登不登得出；能是 null。不在一趟行程裡才行（探索、戰鬥、事件……要先做完或從那一趟登出）。 */
export function exitBlock(k: Kernel, state: GameState): string | null {
  if (!readDive(state)) return '你沒有潛入。'
  if (state.battle) return '正在戰鬥：戰鬥裡要用「拔線」離開，打完才能登出。'
  const other = k.activity.active(state).find((a) => a.kind !== ACT)
  if (other) return `還在「${other.label}」裡：先把它做完，或從那一趟登出。`
  return null
}

/** 身體回去的位置：能用 move 就用（人站回接入點那一格，地圖也跟著回來）；沒有人登記 move 或放不上去，位置不一樣就直接改位置。 */
function bodyChanges(k: Kernel, state: GameState, d: DiveState): Change[] {
  const loc = d.body.location
  if (loc.block && k.effects.has('move')) {
    const res = k.effects.resolve([{ kind: 'move', block: loc.block, ...(d.body.at ? { at: d.body.at } : {}) }], effectCtx(k, state, { source: 'builtin' }))
    if (res.errors.length === 0) return res.changes
  }
  return JSON.stringify(state.location) === JSON.stringify(loc) ? [] : [{ op: 'location', to: clone(loc) }]
}

/** 登出的報告（手動與被強制斷線之後自動接的都走這裡；不問能不能登出，呼叫的人先問 exitBlock）。 */
function exitDraft(k: Kernel, state: GameState): ReportDraft {
  const d = readDive(state)!
  const name = accessName(d)
  const changes: Change[] = []
  changes.push(...bodyChanges(k, state, d))
  // 租用的甲板收回
  if (d.deck === 'rental' && k.effects.has('deck_rental')) {
    const res = k.effects.resolve([{ kind: 'deck_rental', deck: null }], effectCtx(k, state, { source: 'builtin' }))
    if (res.errors.length === 0) changes.push(...res.changes)
  }
  // 押金：沒被沒收的話退回
  const deposit = d.paid?.deposit ?? 0
  const refund = d.over ? 0 : deposit
  if (refund > 0) changes.push({ op: 'cash', delta: refund })
  const outcome = d.over ? 'forced' : 'logout'
  const end = endActivity(k, {
    state, kind: ACT, id: ACT, origin: { by: ACT }, outcome,
    result: { type: d.access.type, deck: d.deck, forced: !!d.over, ...(d.over ? { over: d.over } : {}), refund, forfeited: d.over ? deposit : 0, since: d.since },
  })
  changes.push(...end.changes, diveChange(null))
  const lines = [
    d.over === 'located' ? '現實的增援找到了接入點，你被強制斷線，意識猛地回到身體裡。' : d.over === 'defeat' ? '你在網內倒下，被強制斷線，意識猛地回到身體裡。' : `你登出了，意識回到${name}的身體裡。`,
    ...(d.deck === 'rental' ? ['租用的甲板收回去了。'] : []),
    ...end.lines,
  ]
  const money = deposit > 0 ? (d.over ? `租用甲板的押金 ${formatAmount(deposit)} 被沒收了。` : `押金 ${formatAmount(deposit)} 退回來了。`) : ''
  return attachActivityEnd(draftOf(state, 'dive.exit', changes, outcome, `${lines.join('')}${money}`, {
    lines, layer: 'meat', triggers: [{ point: 'logout', where: whereOf(d.body.location) }],
  }), end)
}

/** 登出（報告 dive.exit）：人回到身體的位置、收回租用的甲板、退押金（沒被沒收的話）、帶觸發點 logout。不成立丟 ActionBlocked。 */
export function exit(k: Kernel, state: GameState): ReportDraft {
  const block = exitBlock(k, state)
  if (block) throw new ActionBlocked(block)
  return exitDraft(k, state)
}

// ---- 被強制斷線之後自動登出 ----

/** 一份報告套用之後（掛點 report.after）：被強制斷線了（over）而且手上沒有別的事，自動登出。 */
export function afterReport(k: Kernel, state: GameState, reportAction: string | undefined, rewound: boolean): ReportDraft[] | undefined {
  if (rewound || reportAction === 'rewind') return undefined
  const d = readDive(state)
  if (!d?.over || state.battle || k.activity.active(state).some((a) => a.kind !== ACT)) return undefined
  return [exitDraft(k, state)]
}

/** 一趟網內的行程結束了（掛點 activity.end）：被定位或戰敗被接受之後標成被強制斷線（等著自動登出）。 */
export function onEnd(state: GameState, kind: string, origin: { by: string }, outcome: string, result: Record<string, unknown>): { changes: Change[] } | undefined {
  const d = readDive(state)
  if (!d || d.over) return undefined
  let over: OverKind | null = null
  // 這一趟是從這裡開的、被定位
  if (kind === ACT_NETRUN && origin.by === ACT && outcome === 'located') over = 'located'
  // 網內的戰敗被接受（戰敗是核心的活動，origin 是開戰的人，認不出是哪裡開的：潛入中網內倒下都算）
  else if (kind === 'defeat' && outcome === 'accept' && result.net === true) over = result.located === true ? 'located' : 'defeat'
  return over ? { changes: [diveChange({ ...d, over })] } : undefined
}
