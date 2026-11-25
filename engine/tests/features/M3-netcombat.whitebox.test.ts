// 白箱測試：features/netcombat（內海戰鬥：工具構裝、干擾與破損、換檔、腳本、管理行動、規則表）。
// 補主套件沒有走到的分支：工具構裝每一種 target 的目標清單、被干擾或破損時的擋法、net.fix 修哪一件與傷害骰、換檔的錯誤輸入、
// 規則表與效果的格式檢查、查詢不改狀態。
// 每個測試名稱寫明在測哪一條規格（文件與節）或不變式（dev/invariants.md）。

import { describe, expect, it } from 'vitest'
import type { BattleUnit, ContentPack } from '../../src'
import { BattleBlocked, BattleRun, battleOptions, clone } from '../../src'
import { brokenOf, constructsOf, netcombatRules, ruleProblems as netcombatRuleProblems } from '../../src/features/netcombat/model'
import { fixOne } from '../../src/features/netcombat/jam'
import { gearBlocks, capIndex } from '../../src/features/netcombat/sync'
import { netBattleView as netcombatView } from '../../src/features/netcombat'
import { makeNetBattleGame } from '../../src/testkit'

type G = ReturnType<typeof makeNetBattleGame>['game']
type Rec = Record<string, unknown>

const tool = (id: string, target: string, o: Rec = {}): Rec => ({ id, class: 'tool', name: id, grade: 1, legal: 'free', ap: 1, ram: 1, target, do: [{ op: 'load', amount: 1, type: 'neural' }], ...o })
/** 每一種 target 一件工具構裝，加一件被動的。 */
const TOOLS = [
  tool('cs_wb_self', 'self'), tool('cs_wb_ally', 'ally'), tool('cs_wb_unit', 'unit'), tool('cs_wb_foe_slot', 'foe_slot'), tool('cs_wb_ally_slot', 'ally_slot'),
  tool('cs_wb_overlay', 'overlay'), tool('cs_wb_node', 'node'), tool('cs_wb_mixed', 'mixed'), tool('cs_wb_passive', 'none', { passive: true }),
]
const TOOL_PACK: ContentPack = { id: 'wb_tools', content: { construct: TOOLS } as never }

const sys = (g: G, changes: unknown[]) => g.commit({ kind: 'system', action: 'test.set', location: {}, party: [], timeline: [], changes: changes as never, outcome: { result: 'ok', summary: 't' } })

/** 隊友一的甲板槽換成這幾件（直接寫 actor.ext.deck 的共用格式：測工具的目標，不測裝備的流程），開打。 */
function battleWith(slots: string[]): G {
  const { game } = makeNetBattleGame({ noBattle: true, content: [TOOL_PACK] as never })
  const ext = clone(game.state.actors.a_tw_n1!.ext.deck as Rec)
  sys(game, [{ op: 'actor.ext', id: 'a_tw_n1', key: 'deck', value: { ...ext, slots } }])
  game.startBattle({
    mode: 'net', grade: 1, cover: 'medium',
    allies: ['pc', 'a_tw_n1', 'a_tw_n2', 'a_tw_n3'].map((id) => ({ from: 'actor', id })),
    foes: [0, 1].map((i) => ({ from: 'enemy_pick', faction: 'f_gang', grade: 1, rank: 'minion', color: 'pink', seed: `wb/${i}` })),
    origin: { escapable: true, place: '白箱', faction: 'f_gang' },
  } as never)
  return game
}

const runOf = (g: G): BattleRun => new BattleRun(g.k, g.state, clone(g.state.battle!))
const unitOf = (run: BattleRun, actor: string): BattleUnit => Object.values(run.battle.units).find((u) => u.actor === actor)!

describe('白箱 netcombat：工具構裝的目標（CYBERSPACE 6.3 節「工具構裝」；ITEMS 11.4 節）', () => {
  it('每一種 target：foe／ally／unit 列人，foe_slot／ally_slot 列四格，overlay 列敵方掛著的，node 列節點，mixed 全部，self 與被動的不列', () => {
    const g = battleWith(['cs_tw_gun', ...TOOLS.map((t) => t.id as string)])
    const run = runOf(g)
    const me = unitOf(run, 'a_tw_n1')
    // 被動的不註冊成行動
    expect(g.k.battle.getAction('net_tool:cs_wb_passive')).toBeUndefined()
    const targets = (id: string) => g.k.battle.getAction(`net_tool:${id}`)!.targets?.(run, me) ?? null
    const allies = Object.values(run.battle.units).filter((u) => u.side === 'ally' && !u.out && u.id !== me.id)
    const foes = Object.values(run.battle.units).filter((u) => u.side === 'foe' && !u.out)
    expect(targets('cs_wb_self')).toBeNull()
    expect(g.k.battle.getAction('net_tool:cs_wb_self')!.target).toBe('none')
    expect(targets('cs_wb_ally')!.map((t) => (t.target as { unit: string }).unit).sort()).toEqual(allies.map((u) => u.id).sort())
    expect(targets('cs_wb_unit')!.length).toBe(allies.length + 1 + foes.length)
    expect(targets('cs_wb_foe_slot')!.map((t) => t.target)).toEqual([1, 2, 3, 4].map((slot) => ({ side: 'foe', slot })))
    expect(targets('cs_wb_ally_slot')!.map((t) => t.target)).toEqual([1, 2, 3, 4].map((slot) => ({ side: 'ally', slot })))
    expect(targets('cs_wb_overlay')).toEqual([])
    expect(targets('cs_wb_node')).toEqual(run.battle.nodes.map((n) => ({ target: { node: n.id }, blocks: [] })))
    expect(targets('cs_wb_mixed')!.length).toBe(foes.length + allies.length + 8)
  })

  it('工具被干擾停用、構裝破損：blocks 各一句，硬做丟 BattleBlocked', () => {
    const g = battleWith(['cs_tw_gun', 'cs_wb_self'])
    const run = runOf(g)
    const me = unitOf(run, 'a_tw_n1')
    const def = g.k.battle.getAction('net_tool:cs_wb_self')!
    expect(def.blocks!(run, me)).toEqual([])
    ;(me.ext.net as { broken: string[] }).broken = ['cs_wb_self']
    expect(def.blocks!(run, me)).toEqual(['構裝「cs_wb_self」破損了，戰鬥結束前用不了。'])
    expect(() => def.run(run, me, null, { action: def.id })).toThrow(BattleBlocked)
  })

  it('has：沒有裝著這件的人沒有這個行動', () => {
    const g = battleWith(['cs_tw_gun'])
    const run = runOf(g)
    expect(g.k.battle.getAction('net_tool:cs_wb_ally')!.has!(run, unitOf(run, 'a_tw_n1'))).toBe(false)
  })
})

describe('白箱 netcombat：破損與修理（CYBERSPACE 6.5 節「破損」）', () => {
  it('fixOne：指定的那一件、最近破損的一件、指定了沒破損的回傳 null；全部修好重創解除', () => {
    const g = battleWith(['cs_tw_gun', 'cs_tw_guard'])
    const run = runOf(g)
    const me = unitOf(run, 'a_tw_n1')
    const net = me.ext.net as Rec
    net.broken = ['cs_tw_gun', 'cs_tw_guard']
    net.heavy = true
    expect(fixOne(run, me, 'cs_nope')).toBeNull()
    expect(fixOne(run, me, 'cs_tw_gun')).toBe('cs_tw_gun')
    expect(brokenOf(me)).toEqual(['cs_tw_guard'])
    expect(net.heavy).toBe(true)
    expect(fixOne(run, me)).toBe('cs_tw_guard')
    expect(net.heavy).toBeUndefined()
    expect(fixOne(run, me)).toBeNull()
  })

  it('fixOne：沒有構裝破損時補回一顆傷害骰（雜兵不算破損、多 1 顆傷害骰的那一顆）；指定 id 時不補骰', () => {
    const g = battleWith(['cs_tw_gun'])
    const run = runOf(g)
    const me = unitOf(run, 'a_tw_n1')
    const net = me.ext.net as Rec
    net.broken = []
    net.dice_loss = 2
    net.heavy = true
    expect(fixOne(run, me, 'cs_tw_gun')).toBeNull()
    expect(fixOne(run, me)).toBe('dice')
    expect(net.dice_loss).toBe(1)
    expect(net.heavy).toBe(true)
    expect(fixOne(run, me)).toBe('dice')
    expect(net.heavy).toBeUndefined()
    expect(run.beats.map((b) => b.text).join('')).toContain('傷害骰回來了')
  })

  it('fixOne：沒有 ext.net 的單位回傳 null', () => {
    const g = battleWith(['cs_tw_gun'])
    const run = runOf(g)
    const me = unitOf(run, 'a_tw_n1')
    delete (me.ext as Rec).net
    expect(fixOne(run, me)).toBeNull()
  })
})

describe('白箱 netcombat：換檔（CYBERSPACE 6.4 節；不變式第 144 條）', () => {
  it('換檔的行動：沒選檔位、同一檔、超過上限、這回合換過了，各一句', () => {
    const g = battleWith(['cs_tw_gun'])
    const run = runOf(g)
    const pc = unitOf(run, 'pc')
    const def = g.k.battle.getAction('net_shift')!
    expect(() => def.run(run, pc, null, { action: def.id, pick: {} })).toThrow('要選換到哪一檔。')
    const cur = (pc.ext.net as { sync: string }).sync
    expect(gearBlocks(run, pc, cur as never)[0]).toMatch(/^已經是.*檔了。$/)
    // 上限：主角同步 3 級、敏感度看橋；全檔要 5 級
    expect(gearBlocks(run, pc, 'full').length).toBeGreaterThan(0)
    pc.uses['turn:shift'] = 9
    expect(def.blocks!(run, pc)).toEqual(['這個回合已經換過檔了。'])
    expect(() => def.run(run, pc, null, { action: def.id, pick: { gear: 'shallow' } })).toThrow('這個回合已經換過檔了。')
  })

  it('沒有 ext.net 的單位：換檔擋「沒有同步檔位可以換」；capIndex 照標準', () => {
    const g = battleWith(['cs_tw_gun'])
    const run = runOf(g)
    const pc = unitOf(run, 'pc')
    delete (pc.ext as Rec).net
    expect(g.k.battle.getAction('net_shift')!.blocks!(run, pc)).toEqual(['沒有同步檔位可以換。'])
    expect(gearBlocks(run, pc, 'deep')).toEqual(['沒有同步檔位可以換。'])
    expect(capIndex(run, pc)).toBe(1)
  })
})

describe('白箱 netcombat：規則表與畫面（CYBERSPACE 6.3、6.6 節；DATA 第 10 節）', () => {
  it('netcombat_rule：多的欄位、jam_wall_mult、shift_split、ap 的形狀與鍵', () => {
    const p = netcombatRuleProblems({ id: 'default', zzz: 1, jam_wall_mult: -1, shift_split: 0, ap: 3 } as never)
    expect(p.some((m) => m.startsWith('zzz：沒有這個欄位'))).toBe(true)
    expect(p).toContain('jam_wall_mult 要是 0 以上的數字')
    expect(p).toContain('shift_split 要是 0～1 之間的數字（不含 0）')
    expect(p.some((m) => m.startsWith('ap 要是 {'))).toBe(true)
    expect(netcombatRuleProblems({ id: 'default', ap: { dance: 1 } } as never).some((m) => m.startsWith('ap.dance：沒有這個行動'))).toBe(true)
  })

  it('netcombatRules：沒有規則表的世界用內建的預設', () => {
    const rules = netcombatRules({ content: { hasKind: () => false } } as never)
    expect(rules).toBeTruthy()
  })

  it('constructsOf：槽裡寫壞的筆略過；沒寫 class、grade 的照內容補', () => {
    const g = battleWith(['cs_tw_gun'])
    const run = runOf(g)
    const me = unitOf(run, 'a_tw_n1')
    ;(me.ext.deck as Rec).constructs = [3, { id: '' }, { id: 'cs_tw_guard' }, { id: 'cs_unknown' }, { id: 'cs_tw_gun', class: 'weapon', grade: 2 }]
    expect(constructsOf(g.k, me)).toEqual([
      { id: 'cs_tw_guard', class: 'defense', grade: 1 }, { id: 'cs_unknown', class: 'unknown', grade: 1 }, { id: 'cs_tw_gun', class: 'weapon', grade: 2 },
    ])
  })

  it('netcombatView：不在打是 null；現實的戰鬥是 null；凍結的狀態上照常（不變式第 1 條）', () => {
    const g = battleWith(['cs_tw_gun'])
    const st = clone(g.state)
    const freeze = <T>(o: T): T => { if (o && typeof o === 'object' && !Object.isFrozen(o)) { Object.freeze(o); for (const v of Object.values(o as Rec)) freeze(v) } return o }
    expect(() => { netcombatView(g.k, freeze(st)); battleOptions(g.k, st) }).not.toThrow()
    expect(netcombatView(g.k, { ...clone(g.state), battle: undefined } as never)).toBeNull()
  })
})
