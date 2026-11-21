import { describe, it, expect } from 'vitest'
import { RealBattle, REAL_WEAPONS, RING_KEYS, REAL_ACTIONS, type RealSetup } from './real'
import { NetBattle, SYNC } from './net'
import { OpinionWar, adj, CELLS, editPoints, fameLevel } from './opinion'
import { cover, COVER_BONUS } from './field'
import { seeded, sequence, face20, face6, d6 } from './rng'
import { REAL_ENCOUNTERS, NET_ENCOUNTERS, REAL_PARTY } from '../../data/encounters'

const mk = (o: Partial<RealSetup> = {}, rng = seeded(1)) => new RealBattle({ ...REAL_ENCOUNTERS[0].setup, ...o }, rng)
const P = (b: RealBattle, name: string) => b.units.find(u => u.side === 'P' && u.name === name)!
const E = (b: RealBattle, i: number) => b.units.filter(u => u.side === 'E')[i]

describe('先攻', () => {
  it('d20 ＋ 反應，由高到低排', () => {
    const b = mk()
    const ini = b.order.map(id => b.units[id].ini)
    expect([...ini].sort((x, y) => y - x)).toEqual(ini)
    b.units.forEach(u => { expect(u.ini - u.refl).toBeGreaterThanOrEqual(1); expect(u.ini - u.refl).toBeLessThanOrEqual(20) })
  })
  it('第一回合從上限開始；之後每回合回 3 點，不超過上限', () => {
    const b = mk()
    b.start()
    const u = b.cur()
    expect(u.ap).toBe(u.apMax)
    u.ap = 0
    b.round = 2
    b.units.forEach(x => { x.stun = false })
    b.beginTurn()
    expect(b.cur().ap).toBe(Math.min(b.cur().apMax, 3))
  })
})

describe('命中與迴避', () => {
  it('迴避 = 10 ＋ 反應 ＋ 遮蔽 − 餘韻', () => {
    const b = mk()
    const you = P(b, '你')
    expect(b.dodge(you)).toBe(10 + you.refl + COVER_BONUS[b.cov.P[you.slot].l])
    you.layers = 2
    expect(b.dodge(you)).toBe(10 + you.refl + COVER_BONUS[b.cov.P[you.slot].l] - 2)
  })
  it('命中率夾在 5%～95%，距離外每格 −2、長槍在第 1 格 −4', () => {
    const b = mk()
    const you = P(b, '你'), t = E(b, 0)
    const w = REAL_WEAPONS.rifle
    you.slot = 1
    expect(b.rangeMod(you, t, w)).toBe(-2 * (3 - 1) - 4)
    you.slot = 3
    expect(b.rangeMod(you, t, w)).toBe(0)
    const hc = b.hitChance(you, t)
    expect(hc).toBe(Math.max(5, Math.min(95, (21 - (b.dodge(t) - b.bonus(you, t, w))) * 5)))
    t.refl = 40
    expect(b.hitChance(you, t)).toBe(5)
  })
  it('自然 20 一定命中，自然 1 一定沒中', () => {
    const b = mk()
    b.rng = sequence([face20(20), face6(6)])
    const you = P(b, '你'), t = E(b, 3)
    t.refl = 50
    const hp = t.hp
    b.attack(you, t)
    expect(t.hp).toBeLessThan(hp)
    const b2 = mk()
    b2.rng = sequence([face20(1)])
    const you2 = P(b2, '你'), t2 = E(b2, 0)
    const hp2 = t2.hp
    b2.attack(you2, t2)
    expect(t2.hp).toBe(hp2)
  })
})

describe('傷害', () => {
  it('扣（護甲 − 穿透）；敵人打我方乘位階倍率（雜兵 ×0.4、精英 ×0.6），至少 1', () => {
    const b = mk()
    const you = P(b, '你'), mookU = E(b, 0), eliteU = E(b, 3)
    expect(b.damage(you, mookU, 10, REAL_WEAPONS.pistol)).toBe(10 - 1)
    expect(b.damage(you, mookU, 10, REAL_WEAPONS.rifle)).toBe(10)
    expect(b.damage(mookU, you, 10, REAL_WEAPONS.pistol)).toBe(Math.round(8 * 0.4))
    expect(b.damage(eliteU, you, 10, REAL_WEAPONS.pistol)).toBe(Math.round(8 * 0.6))
    expect(b.damage(mookU, you, 3, REAL_WEAPONS.pistol)).toBe(1)
    expect(b.damage(mookU, you, 2, REAL_WEAPONS.pistol)).toBe(0)
  })
  it('生命歸零就倒下；敵人全倒就勝利', () => {
    const b = mk({ foes: [REAL_ENCOUNTERS[0].setup.foes[0]] })
    b.start()
    b.rng = sequence([face20(20), face6(6)])
    const t = E(b, 0)
    t.hp = 1
    b.attack(P(b, '你'), t)
    expect(t.down).toBe(true)
    expect(b.end?.result).toBe('win')
  })
})

describe('遮蔽', () => {
  it('打掉耐久就降一級；沒人站的格子傷害加倍', () => {
    const b = mk()
    b.cov.E[2] = cover(2)
    b.hurtCover('E', 2, 20)
    expect(b.cov.E[2]).toEqual({ l: 2, d: 10 })
    b.hurtCover('E', 2, 12)
    expect(b.cov.E[2].l).toBe(1)
    expect(b.cov.E[2].d).toBe(13)
    E(b, 1).down = true
    const third = E(b, 2)
    b.hurtCover('E', 2, 7)
    // 第 2 格被打成暴露又沒人站：後排連同遮蔽往前補位
    expect(b.lines.some(l => l.t.includes('第 2 格的遮蔽被打成暴露'))).toBe(true)
    expect(third.slot).toBe(2)
  })
  it('前面空著又沒有遮蔽時，後排連同遮蔽往前補位', () => {
    const b = mk()
    E(b, 0).down = true
    b.cov.E[1] = { l: 0, d: 0 }
    const second = E(b, 1)
    b.compact('E')
    expect(second.slot).toBe(1)
    expect(b.cov.E[1].l).toBe(2)
  })
  it('監視：有人站上暴露的格子就自動開一槍', () => {
    const b = mk({}, seeded(3))
    const you = P(b, '你')
    you.watch = true
    b.cov.E[1] = { l: 0, d: 0 }
    const t = E(b, 0)
    const n = b.lines.length
    b.exposed(t)
    b.flushWatch()
    expect(you.watch).toBe(false)
    expect(b.lines.slice(n).some(l => l.t.includes('監視觸發'))).toBe(true)
  })
})

describe('感載與過載', () => {
  it('感載滿了過載：清空、疊一層餘韻、失去下一回合；疊滿之後再過載就倒下', () => {
    const b = mk()
    const t = E(b, 0)
    b.neural(t, t.loadMax)
    expect(t.load).toBe(0)
    expect(t.layers).toBe(1)
    expect(t.stun).toBe(true)
    b.neural(t, t.loadMax)
    expect(t.down).toBe(true)
  })
  it('制伏要近身、對方正在過載；精英要餘韻疊滿', () => {
    const b = mk()
    const nana = P(b, '奈奈'), m = E(b, 0), el = E(b, 3)
    expect(nana.slot).toBe(1)
    expect(b.canSubdue(nana, m)).toBe(false)
    m.stun = true
    expect(b.canSubdue(nana, m)).toBe(true)
    el.slot = 1; m.slot = 4
    el.stun = true; el.layers = 1
    expect(b.canSubdue(nana, el)).toBe(false)
    el.layers = 2
    expect(b.canSubdue(nana, el)).toBe(true)
  })
  it('要活的：制伏算達成，打死算沒達成', () => {
    const cap = REAL_ENCOUNTERS.find(e => e.id === 'capture')!
    const b = new RealBattle(cap.setup, seeded(4))
    expect(b.captureId).not.toBeNull()
    const t = b.units[b.captureId!]
    t.out = true
    b.fall(t, ' 被制伏。')
    b.units.filter(u => u.side === 'E').forEach(u => { if (!u.down) b.fall(u, ' 倒下。') })
    expect(b.end?.text).toContain('條件達成')
  })
})

describe('玩家的行動與圓環', () => {
  it('九格對應數字鍵 1～9：內環攻擊、中環補充、外環戰術', () => {
    expect(RING_KEYS).toHaveLength(9)
    expect(RING_KEYS.map(k => REAL_ACTIONS.find(a => a.k === k)!.g)).toEqual(['atk', 'atk', 'res', 'res', 'res', 'tac', 'tac', 'tac', 'tac'])
  })
  it('做不到的說原因；射擊要先選目標', () => {
    const b = mk()
    b.start()
    while (b.cur().side !== 'P') b.endTurn()
    const u = b.cur()
    expect(b.reason('reload')).toBeTruthy()
    u.ap = 0
    expect(b.reason('shoot')).toBe('行動點不夠')
    u.ap = u.apMax
    if (!b.wp(u).melee) {
      expect(b.act('shoot')).toBe(true)
      expect(b.mode).toBe('shoot')
      const t = b.targets()[0]
      expect(b.pick(t)).toBe(true)
      expect(u.ap).toBe(u.apMax - b.cost('shoot', u))
    }
  })
  it('脫離：花 2 點擲一次；投降直接結束', () => {
    const b = mk()
    b.start()
    while (b.cur().side !== 'P') b.endTurn()
    b.rng = sequence([face20(20)])
    expect(b.flee()).toBe(true)
    expect(b.end?.result).toBe('fled')
    const b2 = mk()
    b2.surrender()
    expect(b2.end?.result).toBe('surrender')
  })
})

/** 自動打完一場：玩家每次挑第一個做得到的攻擊，否則換彈、換武器，最後結束回合 */
function autoReal(b: RealBattle) {
  let phase = b.start()
  for (let guard = 0; guard < 4000 && phase !== 'over'; guard++) {
    if (phase === 'enemy') { while (b.aiStep()); phase = b.endTurn(); continue }
    if (phase === 'skip') { phase = b.endTurn(); continue }
    const k = ['subdue', 'shoot', 'melee', 'reload', 'swap'].find(x => !b.reason(x))
    if (k && b.act(k)) { const t = b.targets()[0]; if (t) b.pick(t); continue }
    phase = b.endTurn()
  }
  return b
}

describe('整場', () => {
  it('同一個種子打出同一個結果；一定打得完', () => {
    for (const seed of [1, 2, 3, 4, 5, 6, 7, 8]) {
      const a = autoReal(new RealBattle(REAL_ENCOUNTERS[0].setup, seeded(seed)))
      const b = autoReal(new RealBattle(REAL_ENCOUNTERS[0].setup, seeded(seed)))
      expect(a.end).not.toBeNull()
      expect(a.end).toEqual(b.end)
      expect(a.round).toBeLessThan(40)
    }
  })
  it('隊伍的名字照主角與夥伴', () => {
    expect(REAL_PARTY.map(p => p.name)).toContain('你')
  })
})

describe('內海戰鬥', () => {
  const mkNet = (seed = 1) => new NetBattle(NET_ENCOUNTERS[0].setup, seeded(seed))
  it('同步檔位：檢定加值與受到的感載倍率；每回合換一次', () => {
    const b = mkNet()
    b.start()
    while (b.cur().side !== 'P') b.endTurn()
    const u = b.cur()
    const before = b.bonus(u, b.alive('E')[0], b.wp(u))
    expect(b.setSync(0)).toBe(true)
    expect(b.bonus(u, b.alive('E')[0], b.wp(u))).toBe(before + SYNC[0].c - SYNC[1].c)
    expect(b.setSync(2)).toBe(false)
    expect(b.syncReason(2)).toBe('這一回合已經換過檔')
  })
  it('感載乘目標的檔位倍率與攻擊者的餘韻', () => {
    const b = mkNet()
    const a = b.units[0], t = b.units.find(u => u.side === 'E')!
    t.sync = 2; t.prot = 0
    a.layers = 2
    expect(b.netLoad(a, t, 10, { n: 'x', dice: 1, r: [1, 1], cost: 1, pen: 0, cm: 0 })).toBe(Math.round(10 * 1.2 * 1.5))
  })
  it('過載閃斷 RAM 歸零；追蹤度 30 白蕾絲上線、90 定位', () => {
    const b = mkNet()
    const t = b.units.find(u => u.side === 'E')!
    b.addLoad(t, t.loadMax)
    expect(t.ram).toBe(0)
    expect(t.flash).toBe(true)
    b.units.filter(u => u.side === 'E')[3].down = true
    const n = b.units.length
    b.trace = 30
    b.traceCheck()
    expect(b.units.length).toBe(n + 1)
    expect(b.units[n].white).toBe(true)
    b.trace = 95
    b.traceCheck()
    expect(b.loc).toBe(3)
  })
  it('管理行動：只有潛網者、次數有限、每次追蹤度至少 +1', () => {
    const b = mkNet(2)
    b.start()
    const zero = b.units.find(u => u.name === '零')!
    b.idx = b.order.indexOf(zero.id)
    const tr = b.trace
    expect(b.adminReason('wipe')).toBeNull()
    b.admin('wipe')
    expect(zero.adm).toBe(1)
    expect(b.trace).not.toBe(tr)
    zero.adm = zero.admin
    expect(b.adminReason('wipe')).toBe('這一回合的管理行動用完了')
    const you = b.units.find(u => u.name === '你')!
    b.idx = b.order.indexOf(you.id)
    expect(b.adminReason('wall')).toBe('只有潛網者有管理行動')
  })
  it('自動打完一場', () => {
    for (const seed of [1, 2, 3, 4]) {
      const b = mkNet(seed)
      let phase = b.start()
      for (let g = 0; g < 4000 && phase !== 'over'; g++) {
        if (phase !== 'player') { if (phase === 'enemy') while (b.aiStep()); phase = b.endTurn(); continue }
        const k = ['subdue', 'shoot', 'melee', 'reload', 'swap'].find(x => !b.reason(x))
        if (k && b.act(k)) { const t = b.targets()[0]; if (t) b.pick(t); continue }
        phase = b.endTurn()
      }
      expect(b.end).not.toBeNull()
    }
  })
  it('全隊拔線等於撤退', () => {
    const b = mkNet()
    b.start()
    for (let g = 0; g < 50 && !b.end; g++) { if (b.cur().side === 'P') b.unplug(); if (!b.end) b.endTurn() }
    expect(b.end?.result).toBe('retreat')
  })
})

describe('輿論戰', () => {
  it('相鄰只有上下左右；萬華鏡在正中央，和四邊相鄰', () => {
    expect(adj(4).sort()).toEqual([1, 3, 5, 7])
    expect(adj(0).sort()).toEqual([1, 3])
    expect(CELLS[4]).toBe('萬華鏡')
  })
  it('防守：沒人的 2；對手的 3 − 風向（最少 0，OPINION 3.3 節）；對手搶你的 3 ＋ 風向', () => {
    const o = new OpinionWar({ topic: 'scandal', foe: 'pr_2' }, seeded(1))
    const empty = o.own.indexOf(0), foe = o.own.indexOf(2), mine = o.own.indexOf(1)
    expect(o.def(empty, 1)).toBe(2)
    o.w = 1
    expect(o.def(foe, 1)).toBe(2)
    expect(o.def(mine, 2)).toBe(4)
    o.w = 5
    expect(o.def(foe, 1)).toBe(0)
    o.w = -5
    expect(o.def(mine, 2)).toBe(0)
  })
  it('豔名：每 30 點一級、最多 2 級，只減看臉的三格（OPINION 4.3c 節）', () => {
    expect(fameLevel(29)).toBe(0); expect(fameLevel(31)).toBe(1); expect(fameLevel(95)).toBe(2)
    const o = new OpinionWar({ topic: 'scandal', foe: 'pr_2', fame: 60 }, seeded(1))
    o.own[1] = 0; o.own[3] = 0
    expect(o.def(1, 1)).toBe(0)
    expect(o.def(3, 1)).toBe(2)
    expect(o.def(1, 2)).toBe(2)
  })
  it('編輯點照 OPINION 4.3b 節：任何人 2，主播與偶像加階數的一半進位，名媛與掮客捨去，製作 +1', () => {
    expect(editPoints([])).toBe(2)
    expect(editPoints(['槍手 3', '掮客 2'])).toBe(3)
    expect(editPoints(['主播 3'])).toBe(4)
    expect(editPoints(['名媛 3'], true)).toBe(4)
  })
  it('萬華鏡從中央開場；其他對手從你的對面', () => {
    const k = new OpinionWar({ topic: 'scandal', foe: 'pr_kaleido' }, seeded(2))
    expect(k.own[4]).toBe(2)
    const g = new OpinionWar({ topic: 'scandal', foe: 'pr_2' }, seeded(2))
    const me = g.own.indexOf(1)
    expect(g.own[8 - me]).toBe(2)
  })
  it('開場 3 張再抽 2 張；編輯點照給的（沒給是 2）；出牌加聲量', () => {
    expect(new OpinionWar({ topic: 'scandal', foe: 'pr_1' }, seeded(5)).ap).toBe(2)
    const o = new OpinionWar({ topic: 'scandal', foe: 'pr_1', edit: 4 }, seeded(5))
    expect(o.hand).toHaveLength(5)
    expect(o.ap).toBe(4)
    const i = o.hand.findIndex(k => k === 'clip' || k === 'tape')
    if (i >= 0) { const va = o.va; o.play(i); expect(o.va).toBe(va + 2) }
  })
  it('潔絲第一回合先搶萬華鏡；III 級的料牌 +1', () => {
    const o = new OpinionWar({ topic: 'scandal', foe: 'pr_jess' }, seeded(3))
    o.endTurn()
    o.foeStep()
    expect(o.own[4]).toBe(2)
    expect(o.cardV({ n: '', t: 1, c: 1, d: '', v: 2 })).toBe(3)
  })
  it('六回合打得完，結果分四級', () => {
    for (const foe of ['pr_1', 'pr_2', 'pr_3', 'pr_kaleido', 'pr_hizakura', 'pr_jess']) {
      const o = new OpinionWar({ topic: 'idol', foe }, seeded(7))
      for (let g = 0; g < 200 && !o.end; g++) {
        for (let i = o.hand.length - 1; i >= 0; i--) if (!o.cardReason(i) && !o.mode) { o.play(i); if (o.mode) o.mode = null }
        if (!o.capReason()) { o.toggleCap(); o.pickCell(o.targets()[0]) }
        if (o.end) break
        o.endTurn()
        while (o.foeStep());
      }
      expect(o.end).not.toBeNull()
      expect(['大勝', '小勝', '平手', '敗']).toContain(o.end!.result)
    }
  })
})

describe('擲骰', () => {
  it('有種子的亂數可以重現', () => {
    const a = seeded(9), b = seeded(9)
    expect(d6(a, 10)).toBe(d6(b, 10))
  })
})
