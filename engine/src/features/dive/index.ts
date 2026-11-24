// L6 功能：從接入點潛入與登出，最小版（CYBERSPACE 2.1～2.4 節、第 1 節的表、4.1、4.3 節；NETRUNNING 第 3 節；EVENTS 3.3 節；dev/adr/0018 第八節；dev/work/M3-dive.md）。
//
// 活動 dive（order 85）：在帶 dive 的設施（潛艙店這類接入點）上潛入之後開始，登出時結束。它記住身體在哪（state.ext.dive.body）、用的是哪一種接入
// （自己的甲板、租來的、訪客），並放行網內做得了的事；進去之後做什麼是別人的事：開一趟 netrun（子網、迷宮館）是 launch，在內海固定的街區上走是城市的功能（move 效果）。
// 委託副本的內海面不經過這裡（那一段的潛入與登出就是 face.net 的開始與結束）。
//
// 接上核心的地方：
//   內容  net_site（網內去得了的地方，一筆一個）；設施種類（world 的 facility_type）多讀 dive?: { fee, rental, deposit, safe }，functions 有 dive 的才讀（載入之後 ready 檢查格式）
//   活動  dive（order 85）：進行中放行 DIVE_ALLOW，加上腳下是網內時才放行的 DIVE_NET_ONLY（走格子、世界的移動、交易、對話；B024），其餘擋下，原因「你的意識在網內，身體躺在<接入點>。先登出。」
//   格子  usesOf：站在帶 dive 的設施上列「潛入」；潛入中站在身體躺的那一格列「登出」
//   掛鉤  activity.end：自己開的那一趟被定位、網內的戰敗被接受之後標成被強制斷線；report.after：標了而且手上沒有別的事，自動登出（押金沒收）。
//         熔斷場地（迷宮館）打輸沒有戰敗被接受這一步（defeat 不接手，netrun 直接收掉那一趟）：不標、不強制登出、押金照退（M3 修正批）
//   效果  只用別人登記的：deck_rental（租用與收回）、move（把人放到網內的街區、回到身體的位置；沒有人登記就不用）
//   條件  只用別人登記的：at_facility（站在哪一種設施；沒有人登記就沒有接入點）
//   狀態  state.ext.dive：{ since, body: { location, at? }, access: { facility?, type, safe, name? }, deck, paid?, over? }（只經由報告裡的 ext 變更寫）
// 讀的：k.stats（deck_grade）、actor.ext.bridge（有沒有橋）、actor.conditions（net_burn）、k.content（facility_type、block、deck）、現金。不 import 別的功能。
// 報告（kind netrun）：dive.enter、dive.go、dive.exit；觸發點 login、logout（範圍「子網與內海」）。
// 對外：diveOptions、enter、sites、go、exit、diveView（以及 enterBlock、goBlock、exitBlock、readDive）。

import type { ContentEntry, Feature, GameState, GridUse, Kernel } from '../../core'
import { ContentError, gridHere, isNetMapKind, formatAmount } from '../../core'
import type { NetSiteEntry } from './model'
import { ACT, BLOCK_KIND, DECK_KIND, FACILITY_TYPE_KIND, OWNER, SITE_KIND, accessName, diveDefProblems, netSiteProblems, readDive } from './model'
import { diveOptions } from './options'
import { afterReport, enter, enterBlock, exitBlock, onEnd } from './ops'

export { diveOptions, hasBridge, burning, ownsDeck } from './options'
export type { DiveHere, DiveOptions } from './options'
export { enter, enterBlock, exit, exitBlock, go, goBlock, sites } from './ops'
export type { SiteRow } from './ops'
export { diveView } from './view'
export type { DiveView } from './view'
export { ACT as DIVE_ACTIVITY, EXT as DIVE_EXT, SITE_KIND, diveChange, netSiteProblems, readDive } from './model'
export type { DeckSource, DiveDef, DiveState, NetSiteEntry, Need, OverKind, SiteKind } from './model'

/**
 * 潛入中一律放行的 doing 前綴（工單 M3-dive 的驗收條件守著這張清單）：這個功能自己的報告、開一趟網內的行程與它的報告、迷宮館的報告、戰鬥與戰鬥結束的結算、重來、
 * 事件、戰敗的選擇、成人場景（M3 修正批：網內放行所有成人場景，戰敗事件與流竄 AI 的場景都開得起來）、換 SKIN、自由行動。其餘（休息、車、委託的接案……）一律擋下。
 */
export const DIVE_ALLOW: readonly string[] = [
  'commit:dive.', 'netrun.start', 'commit:netrun.', 'commit:maze.', 'battle.', 'commit:battle.', 'chain:battle_end', 'battle.retry',
  'event.start', 'commit:event.', 'commit:defeat.', 'scene.start', 'commit:scene.', 'commit:deck.skin', 'chain:free_action',
]

/**
 * 潛入中「腳下是網內的地方」才放行的 doing 前綴（B024）：走格子、世界的移動、交易與對話。身體躺在接入點不動：腳下是現實的街時這些都擋下（原因是「先登出」）；
 * 站在網內生成的地圖上，或站在 net_site 登記的網內街區裡才放行。
 */
export const DIVE_NET_ONLY: readonly string[] = ['grid.', 'commit:grid.', 'commit:world.', 'commit:trade.', 'commit:npc.']

/** 腳下是網內的地方嗎：網內生成的地圖（子網、迷宮館、殘骸、深海），或 net_site 登記為 block 的網內街區。 */
export function inNet(k: Kernel, state: GameState): boolean {
  const g = gridHere(k, state)
  if (g && isNetMapKind(g.map.kind)) return true
  const block = state.location.block
  return !!block && k.content.list<NetSiteEntry>(SITE_KIND).some((s) => s.kind === 'block' && s.block === block)
}

export const diveFeature: Feature = {
  id: OWNER,
  install(kernel) {
    const k = kernel as Kernel

    k.content.defineKind<NetSiteEntry>({ kind: SITE_KIND, owner: OWNER, validate: netSiteProblems })

    k.activity.define({
      kind: ACT, owner: OWNER, order: 85,
      active: (state) => {
        const d = readDive(state)
        return d ? { id: ACT, label: `潛入中（${accessName(d)}）` } : null
      },
      allow: [...DIVE_ALLOW],
      reason: (state) => `你的意識在網內，身體躺在${(readDive(state) ? accessName(readDive(state)!) : '接入點')}。先登出。`,
      start: (kk, state) => [enter(kk as Kernel, state)],
    })
    for (const prefix of DIVE_NET_ONLY) k.activity.allow(ACT, prefix, OWNER, (state) => inNet(k, state))

    // 一趟結束：被定位、戰敗被接受之後標成被強制斷線
    k.hooks.on('activity.end', OWNER, ({ state, kind, origin, outcome, result }) => onEnd(state, kind, origin, outcome, result))
    // 手上沒有別的事了：自動登出
    k.hooks.on('report.after', OWNER, ({ state, report }) => afterReport(k, state, report.action, !!report.rewind))

    // 站在帶 dive 的設施上列「潛入」；潛入中站在身體躺的那一格列「登出」
    k.grid.usesOf(OWNER, (ctx, marker): GridUse[] => {
      if (isNetMapKind(ctx.map.kind)) return []
      const st = ctx.state
      const d = readDive(st)
      if (d) {
        const at = d.body.at
        return at === marker.id && st.location.block === d.body.location.block ? [{ id: 'dive.exit', name: '登出', block: exitBlock(k, st) }] : []
      }
      if (st.location.facility !== marker.id) return []
      const o = diveOptions(k, st)
      if (!o.here) return []
      return [{ id: 'dive.enter', name: o.cost > 0 ? `潛入（${formatAmount(o.cost)}）` : '潛入', block: enterBlock(k, st) }]
    })
  },

  ready(k) {
    const problems: string[] = []
    for (const t of k.content.list<ContentEntry & { dive?: unknown }>(FACILITY_TYPE_KIND)) {
      if (t.dive === undefined) continue
      problems.push(...diveDefProblems(t.dive).map((m) => `${FACILITY_TYPE_KIND}/${t.id}：${m}`))
      const rental = (t.dive as { rental?: unknown } | null)?.rental
      if (typeof rental === 'string' && k.content.hasKind(DECK_KIND) && !k.content.has(DECK_KIND, rental)) problems.push(`${FACILITY_TYPE_KIND}/${t.id}：dive.rental 的甲板 ${rental} 不在內容裡`)
    }
    for (const s of k.content.list<NetSiteEntry>(SITE_KIND)) {
      if (s.when) problems.push(...k.conditions.validate(s.when, 'when').map((m) => `${SITE_KIND}/${s.id}：${m}`))
      if (s.kind === 'block' && k.content.hasKind(BLOCK_KIND) && typeof s.block === 'string' && !k.content.has(BLOCK_KIND, s.block)) problems.push(`${SITE_KIND}/${s.id}：block ${s.block} 沒有這塊街區`)
    }
    if (problems.length) throw new ContentError(problems)
  },
}
