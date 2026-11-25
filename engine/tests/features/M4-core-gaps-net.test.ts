// 驗收測試：dev/work/M4-core-gaps.md 第 4、20 項的網內端（帶著全部功能的假世界：testkit 的 makeDiveGame）。
//   第 4 項：netrun 的子網追蹤度起跳與每一次上升問掛點 netrun.trace_mod（義體回答：回報後門在那一家的子網起跳 +5、每次 +1；駭入接頭上升不漲）。
//   第 20 項：被定位時問掛點 net.hacked，記憶庫被讀走：句子併進結束的報告、read 放進活動結果。
// 規格：CYBERWARE 第 2、3 節；CYBERSPACE 8.1 節；NETRUNNING 第 5 節；dev/adr/0019 實作補記：M4-core-gaps。

import { describe, expect, it } from 'vitest'
import type { ContentPack } from '../../src'
import { clone, meterOf } from '../../src'
import { closeDraft } from '../../src/features/netrun/close'
import { traceChanges } from '../../src/features/netrun/nodes'
import { readRun as readNetRun } from '../../src/features/netrun'
import { NET_FACTION, NET_REGION, diveIn, makeDiveGame } from '../../src/testkit'

type Rec = Record<string, any>

const bp = (id: string, slot: string, over: Rec = {}): Rec => ({
  id, kind: 'cyberware', name: id, desc: '一件義體。', brand: 'hz', grade: 2, legal: 'free', price: 900, require: [], optional: [], slot, invasiveness: 'light', sink_cost: 1, ...over,
})
const PACK = {
  id: 'core_gaps_net',
  content: {
    blueprint: [
      bp('bp_backdoor', 'brain', { name: '夜曲', trace_mod: [{ faction: NET_FACTION, start: 5, rise: 1 }] }),
      bp('bp_backdoor_other', 'brain', { name: '別家的夜曲', trace_mod: [{ faction: 'f_somebody_else', start: 5, rise: 1 }] }),
      bp('bp_plug', 'arm', { name: '駭入接頭', trace_mod: [{ mult: 0 }] }),
      bp('bp_memory', 'brain', { name: '記憶庫', readable: { what: 'memory' } }),
    ],
  },
} as unknown as ContentPack
const piece = (uid: string, bpId: string, slot: string): Rec => ({ uid, bp: bpId, slot, parts: {}, sink: 1, at: 0 })

/** 潛入、帶著這些義體進自己去的子網（faction 是 NET_FACTION）。 */
function enter(pieces: Rec[]) {
  const { game: g } = makeDiveGame({ content: [PACK] })
  g.state.actors.pc!.ext.cyber = { pieces: clone(pieces) }
  diveIn(g)
  g.launch('netrun', { region: NET_REGION, grade: 1, faction: NET_FACTION, encounter: [] }, { by: 'core' })
  const run = readNetRun(g.state)!
  return { g, run, trace: () => meterOf(g.k, g.state, 'trace', run.map) }
}

describe('第 4 項：netrun 的追蹤度問義體（掛點 netrun.trace_mod）', () => {
  it('起跳：沒有回報後門是 0；帶著那一家的回報後門是 5；別家的不算', () => {
    expect(enter([]).trace()).toBe(0)
    expect(enter([piece('d1', 'bp_backdoor', 'brain')]).trace()).toBe(5)
    expect(enter([piece('d1', 'bp_backdoor_other', 'brain')]).trace()).toBe(0)
  })

  it('每一次上升：下載、警報、管理行動共用的 traceChanges，量照義體加（回報後門 +1）、乘（駭入接頭 0）；減少的不問', () => {
    const plain = enter([])
    expect(traceChanges(plain.g.k, plain.g.state, plain.run, 2)).toEqual([{ op: 'meter', kind: 'trace', key: plain.run.map, delta: 2 }])
    const back = enter([piece('d1', 'bp_backdoor', 'brain')])
    expect(traceChanges(back.g.k, back.g.state, back.run, 2)).toEqual([{ op: 'meter', kind: 'trace', key: back.run.map, delta: 3 }])
    expect(traceChanges(back.g.k, back.g.state, back.run, -3)).toEqual([{ op: 'meter', kind: 'trace', key: back.run.map, delta: -3 }])
    const plug = enter([piece('g1', 'bp_plug', 'arm_l')])
    expect(traceChanges(plug.g.k, plug.g.state, plug.run, 4)).toEqual([])
  })
})

describe('第 20 項：被定位時問 net.hacked，記憶庫被讀走', () => {
  it('被定位：結束的報告多一句「某某的記憶庫被對方讀走了」，活動結果帶 read；沒有記憶庫的人沒有這一句', () => {
    const { g, run } = enter([piece('m1', 'bp_memory', 'brain')])
    let result: Rec | undefined
    g.k.hooks.on('activity.end', 'test', ({ kind, result: r }) => { if (kind === run.kind) result = r })
    const d = closeDraft(g.k, g.state, run, 'located', 'netrun.located')
    expect(d.outcome.summary).toContain('測試主角的記憶庫被對方讀走了')
    expect(d.narration?.results?.join('')).toContain('記憶庫被對方讀走')
    expect(result?.read).toEqual([{ source: 'cyber', name: '記憶庫', what: 'memory' }])
    const bare = enter([])
    let r2: Rec | undefined
    bare.g.k.hooks.on('activity.end', 'test', ({ kind, result: r }) => { if (kind === bare.run.kind) r2 = r })
    const d2 = closeDraft(bare.g.k, bare.g.state, bare.run, 'located', 'netrun.located')
    expect(d2.outcome.summary).not.toContain('讀走')
    expect(r2?.read).toBeUndefined()
  })

  it('平安登出（left）、通過（done）不算被駭：記憶庫沒有被讀走', () => {
    for (const outcome of ['left', 'done'] as const) {
      const { g, run } = enter([piece('m1', 'bp_memory', 'brain')])
      const d = closeDraft(g.k, g.state, run, outcome, outcome === 'done' ? 'netrun.end' : 'netrun.logout')
      expect(d.outcome.summary).not.toContain('讀走')
    }
  })
})
