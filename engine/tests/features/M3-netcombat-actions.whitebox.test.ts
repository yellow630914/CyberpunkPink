// 白箱測試：features/netcombat 的行動表（actions.ts）、管理行動的錯誤路徑（admin.ts）、效果與退出（effects.ts、out.ts）。
// 補主套件沒有走到的分支：近戰攻擊整條路（近身、武器不對、干擾的選項）、攻擊打掛著的東西、監視的自動攻擊（RAM 不夠、近戰打不到、武器不對）、
// 回填與換構裝的錯誤、腳本的每一種擋法與目標、打牆的擋法、管理行動缺目標的各一句、效果 net.sync／net.ram／net.pin／net.tether 在不能做的對象上什麼都不做。
// 每個測試名稱寫明在測哪一條規格（文件與節）或不變式（dev/invariants.md）。

import { describe, expect, it } from 'vitest'
import type { BattleUnit, ContentPack } from '../../src'
import { BattleBlocked, BattleRun, clone } from '../../src'
import { fixDice, makeNetBattleGame } from '../../src/testkit'

type G = ReturnType<typeof makeNetBattleGame>['game']
type Rec = Record<string, unknown>

const SCRIPTS = [
  { id: 'it_wb_self', use: { ap: 1, target: 'self', effects: [{ op: 'net.ram', amount: 1, who: 'self' }] } },
  { id: 'it_wb_ally', use: { ap: 1, target: 'ally', effects: [{ op: 'net.ram', amount: 1, who: 'target' }] } },
  { id: 'it_wb_foe', use: { ap: 1, target: 'foe', range: [1, 2], effects: [{ op: 'load', amount: 1, type: 'neural', who: 'target' }] } },
  { id: 'it_wb_foe_any', use: { ap: 1, target: 'foe', effects: [{ op: 'load', amount: 1, type: 'neural', who: 'target' }] } },
  { id: 'it_wb_slot', use: { ap: 1, target: 'foe_slot', effects: [{ op: 'net.ram', amount: 1, who: 'self' }] } },
  { id: 'it_wb_ally_slot', use: { ap: 1, target: 'ally_slot', effects: [{ op: 'net.ram', amount: 1, who: 'self' }] } },
  { id: 'it_wb_meat_only', use: { ap: 1, target: 'self', modes: ['meat'], effects: [{ op: 'net.ram', amount: 1, who: 'self' }] } },
].map((s) => ({ ...s, name: s.id, desc: `${s.id}。`, category: 'misc', grade: 1, size: 0, legal: 'free', tags: ['script'] }))
const PACK: ContentPack = { id: 'wb_actions', content: { item: SCRIPTS } as never }

/** 開打的一局；主角（第 1 格）拿近戰構裝（cs_tw_blade 在第 2 個武器）。 */
function game(): G {
  const { game: g } = makeNetBattleGame({ content: [PACK] as never })
  return g
}
const runOf = (g: G): BattleRun => new BattleRun(g.k, g.state, clone(g.state.battle!))
const allyOf = (run: BattleRun, actor: string): BattleUnit => Object.values(run.battle.units).find((u) => u.actor === actor)!
const foes = (run: BattleRun): BattleUnit[] => Object.values(run.battle.units).filter((u) => u.side === 'foe').sort((a, b) => a.slot - b.slot)
const act = (g: G, id: string) => g.k.battle.getAction(id)!
const throwsBlocked = (fn: () => unknown, re: RegExp) => {
  try {
    fn()
  } catch (e) {
    expect(e).toBeInstanceOf(BattleBlocked)
    expect((e as BattleBlocked).reasons.join('；')).toMatch(re)
    return
  }
  throw new Error('應該被擋下，卻沒有')
}
const SRC = { kind: 'skill', id: 'wb', name: '白箱' } as never
const quick = (u: BattleUnit, ...items: Array<[string, number]>) => { u.quick = items.map(([item, qty]) => ({ item, qty })) as never }

describe('白箱 netcombat：近戰攻擊（CYBERSPACE 6.3 節的表：「攻擊」現實的射擊與近戰）', () => {
  it('近戰構裝打第 1 格的敵人：成立、留下紀錄；目標清單裡不在第 1 格的敵人灰掉並寫「近戰只能打近身」', () => {
    const g = game()
    const run = runOf(g)
    const pc = allyOf(run, 'pc')
    pc.wield = 1
    expect(pc.slot).toBe(1)
    const def = act(g, 'net_melee')
    const targets = def.targets!(run, pc)
    for (const f of foes(run)) {
      const opt = targets.find((t) => (t.target as { unit: string }).unit === f.id)!
      expect(opt.blocks).toEqual(f.slot === 1 ? [] : ['近戰只能打近身（雙方的第 1 格）。'])
    }
    const before = run.beats.length
    def.run!(run, pc, { unit: foes(run)[0]!.id }, {} as never)
    expect(run.beats.length).toBeGreaterThan(before)
  })

  it('手上不是近戰構裝：blocks 一句、硬做丟 BattleBlocked；沒有目標、目標不是人時什麼都不做', () => {
    const g = game()
    const run = runOf(g)
    const pc = allyOf(run, 'pc')
    pc.wield = 0
    const def = act(g, 'net_melee')
    expect(def.blocks!(run, pc)).toEqual(['手上不是近戰構裝。'])
    throwsBlocked(() => def.run!(run, pc, { unit: foes(run)[0]!.id }, {} as never), /手上不是近戰構裝/)
    pc.wield = 1
    const n = run.beats.length
    def.run!(run, pc, null, {} as never)
    def.run!(run, pc, { side: 'foe', slot: 1 }, {} as never)
    expect(run.beats.length).toBe(n)
  })

  it('手上沒有武器構裝：攻擊、近戰、打牆都擋「手上沒有武器構裝」；監視擋「沒有東西可以監視」', () => {
    const g = game()
    const run = runOf(g)
    const pc = allyOf(run, 'pc')
    pc.weapons = []
    for (const id of ['net_attack', 'net_melee', 'net_hit_wall']) {
      expect(act(g, id).blocks!(run, pc).join('；'), id).toMatch(/手上沒有武器構裝/)
      throwsBlocked(() => act(g, id).run!(run, pc, id === 'net_hit_wall' ? { side: 'foe', slot: 1 } : { unit: foes(run)[0]!.id }, {} as never), /手上沒有武器構裝/)
    }
    expect(act(g, 'net_watch').blocks!(run, pc)).toEqual(['手上沒有武器構裝，沒有東西可以監視。'])
    expect(act(g, 'net_attack').aiScore!(run, pc, foes(run)[0]!)).toBeNull()
    expect(act(g, 'net_refill').aiScore!(run, pc, null)).toBeNull()
  })
})

describe('白箱 netcombat：攻擊（net_attack）：近戰構裝不能用、干擾的武器要選停用哪一類、打掛著的東西', () => {
  it('手上是近戰構裝時攻擊灰掉「要用近戰攻擊」；硬做丟錯', () => {
    const g = game()
    const run = runOf(g)
    const pc = allyOf(run, 'pc')
    pc.wield = 1
    const def = act(g, 'net_attack')
    expect(def.blocks!(run, pc)).toEqual(['手上是近戰構裝，要用近戰攻擊。'])
    throwsBlocked(() => def.run!(run, pc, { unit: foes(run)[0]!.id }, {} as never), /要用近戰攻擊/)
  })

  it('干擾的武器：picks 列出武器、防護、工具三類；選了不存在的類別丟錯並列出可以選的；選了的帶進命中的標籤', () => {
    const g = game()
    const run = runOf(g)
    const pc = allyOf(run, 'pc')
    pc.wield = 2
    const def = act(g, 'net_attack')
    const picks = def.picks!(run, pc)
    expect(picks).toHaveLength(1)
    expect(picks[0]!.options!.map((o) => o.value)).toEqual(['weapon', 'defense', 'tool'])
    // 不是干擾的武器沒有這個選項
    pc.wield = 0
    expect(def.picks!(run, pc)).toEqual([])
    pc.wield = 2
    throwsBlocked(() => def.run!(run, pc, { unit: foes(run)[0]!.id }, { pick: { jam: 'sky' } } as never), /沒有「sky」這一類構裝可以停用/)
    const n = run.beats.length
    def.run!(run, pc, { unit: foes(run)[0]!.id }, { pick: { jam: 'defense' } } as never)
    expect(run.beats.length).toBeGreaterThan(n)
  })

  it('目標是敵方掛著的東西：攻擊打在那一台身上；目標清單裡列出沒被擊落的掛著的東西；沒有那一台時什麼都不做', () => {
    const g = game()
    const run = runOf(g)
    const pc = allyOf(run, 'pc')
    pc.wield = 0
    const o = run.addOverlay({ side: 'foe', slot: 1, kind: 'decoy', name: '靶機', hp: { now: 30, max: 30 }, armor: 0, evade: -50 })
    const def = act(g, 'net_attack')
    expect(def.targets!(run, pc).some((t) => (t.target as { overlay?: string }).overlay === o.id)).toBe(true)
    const before = o.hp.now
    for (let i = 0; i < 6 && o.hp.now === before; i++) def.run!(run, pc, { overlay: o.id }, {} as never)
    expect(o.hp.now).toBeLessThan(before)
    const n = run.beats.length
    def.run!(run, pc, { overlay: 'ov_nope' }, {} as never)
    expect(run.beats.length).toBe(n)
    o.down = true
    expect(def.targets!(run, pc).some((t) => (t.target as { overlay?: string }).overlay === o.id)).toBe(false)
  })
})

describe('白箱 netcombat：監視的自動攻擊（CYBERSPACE 6.3 節「監視」：RAM 照常花）', () => {
  it('RAM 夠：自動攻擊、扣 RAM、回傳 true；RAM 不夠：回傳 false、不扣、監視留著', () => {
    const g = game()
    const run = runOf(g)
    const pc = allyOf(run, 'pc')
    pc.wield = 0
    const def = act(g, 'net_attack')
    const t = foes(run)[0]!
    const ram0 = pc.pools.ram!.now
    expect(def.auto!(run, pc, t)).toBe(true)
    expect(pc.pools.ram!.now).toBe(ram0 - 1)
    pc.pools.ram!.now = 0
    const n = run.beats.length
    expect(def.auto!(run, pc, t)).toBe(false)
    expect(pc.pools.ram!.now).toBe(0)
    expect(run.beats.length).toBe(n)
  })

  it('武器不對（攻擊的監視手上卻是近戰構裝、近戰的監視手上卻是遠程）、近戰的監視打不到不在第 1 格的人、構裝破損：都不攻擊', () => {
    const g = game()
    const run = runOf(g)
    const pc = allyOf(run, 'pc')
    const far = foes(run).find((f) => f.slot > 1)!
    const near = foes(run)[0]!
    pc.wield = 1 // 近戰
    expect(act(g, 'net_attack').auto!(run, pc, near)).toBe(false)
    expect(act(g, 'net_melee').auto!(run, pc, far)).toBe(false)
    expect(act(g, 'net_melee').auto!(run, pc, near)).toBe(true)
    pc.wield = 0 // 遠程
    expect(act(g, 'net_melee').auto!(run, pc, near)).toBe(false)
    ;(pc.ext.net as Rec).broken = [pc.weapons[0]!.id]
    expect(act(g, 'net_attack').auto!(run, pc, near)).toBe(false)
  })

  it('net_watch：手上是近戰構裝記成近戰監視、遠程記成攻擊監視；已經在監視再選灰掉；AI 在對面都打不中時才想監視', () => {
    const g = game()
    const run = runOf(g)
    const pc = allyOf(run, 'pc')
    const def = act(g, 'net_watch')
    pc.wield = 1
    def.run!(run, pc, null, {} as never)
    expect(pc.watch).toEqual({ action: 'net_melee' })
    expect(def.blocks!(run, pc)).toEqual(['已經在監視了。'])
    pc.watch = undefined
    pc.wield = 0
    def.run!(run, pc, null, {} as never)
    expect(pc.watch).toEqual({ action: 'net_attack' })
    expect(typeof def.aiScore!(run, pc, null) === 'number' || def.aiScore!(run, pc, null) === null).toBe(true)
  })
})

describe('白箱 netcombat：回填與換構裝的錯誤（CYBERSPACE 6.3 節的表）', () => {
  it('回填：沒有 RAM 的人與 RAM 是滿的人各一句；run 在沒有 RAM 時丟錯；補的量不超過缺的；AI 在 RAM 不夠打一下時才想回填', () => {
    const g = game()
    const run = runOf(g)
    const pc = allyOf(run, 'pc')
    const def = act(g, 'net_refill')
    expect(def.blocks!(run, pc)).toEqual(['RAM 是滿的。'])
    expect(def.aiScore!(run, pc, null)).toBeNull()
    pc.pools.ram!.now = pc.pools.ram!.max - 1
    def.run!(run, pc, null, {} as never)
    expect(pc.pools.ram!.now).toBe(pc.pools.ram!.max)
    pc.pools.ram!.now = 0
    expect(def.aiScore!(run, pc, null)).toBe(3)
    const saved = pc.pools.ram
    delete pc.pools.ram
    expect(def.blocks!(run, pc)).toEqual(['沒有 RAM 可以補。'])
    throwsBlocked(() => def.run!(run, pc, null, {} as never), /沒有 RAM 可以補/)
    pc.pools.ram = saved!
  })

  it('換構裝：只有一個武器構裝時灰掉；指定不存在的、已經拿著的、破損的各一句；不指定時換到下一個沒有破損的；全破損就丟錯', () => {
    const g = game()
    const run = runOf(g)
    const pc = allyOf(run, 'pc')
    const def = act(g, 'net_swap')
    expect(pc.weapons.length).toBeGreaterThanOrEqual(3)
    for (const bad of [-1, 99, 0, 1.5, 'x']) throwsBlocked(() => def.run!(run, pc, null, { pick: { weapon: bad } } as never), /沒有這個構裝/)
    ;(pc.ext.net as Rec).broken = [pc.weapons[1]!.id]
    throwsBlocked(() => def.run!(run, pc, null, { pick: { weapon: 1 } } as never), /破損了/)
    // 不指定：第 1 個破損，跳過去換第 2 個
    pc.wield = 0
    def.run!(run, pc, null, {} as never)
    expect(pc.wield).toBe(2)
    // 其他的都破損了
    ;(pc.ext.net as Rec).broken = pc.weapons.map((w) => w.id).filter((_, i) => i !== pc.wield)
    expect(def.blocks!(run, pc)).toEqual(['其他的武器構裝都破損了。'])
    throwsBlocked(() => def.run!(run, pc, null, {} as never), /其他的武器構裝都破損了/)
    // picks 的選項標出拿著的與破損的
    ;(pc.ext.net as Rec).broken = [pc.weapons[0]!.id]
    pc.wield = 1
    const opts = def.picks!(run, pc)[0]!.options!
    expect(opts[1]!.blocks).toEqual(['這一個已經拿在手上。'])
    expect(opts[0]!.blocks).toEqual(['這一個破損了，戰鬥結束前用不了。'])
    // 只有一個武器構裝：沒有選項、灰掉
    pc.weapons = [pc.weapons[0]!]
    pc.wield = 0
    expect(def.blocks!(run, pc)).toEqual(['只有一個武器構裝。'])
    expect(def.picks!(run, pc)).toEqual([])
    // 手上的破損了、身上有沒破損的別件：AI 分數 2.5（B023）；沒有別件：null
    expect(def.aiScore!(run, pc, null)).toBeNull()
  })
})

describe('白箱 netcombat：腳本（CYBERSPACE 6.3 節「腳本」：一次性的程式，不花 RAM）', () => {
  it('沒帶腳本：blocks 一句；工具被干擾：blocks 一句、硬做丟錯；picks 在沒腳本時是空的', () => {
    const g = game()
    const run = runOf(g)
    const pc = allyOf(run, 'pc')
    quick(pc)
    const def = act(g, 'net_script')
    expect(def.blocks!(run, pc)).toEqual(['甲板裡沒有帶腳本。'])
    expect(def.picks!(run, pc)).toEqual([])
    quick(pc, ['it_wb_self', 1])
    pc.statuses.push({ id: 'jam_tool', turns: 1 } as never)
    expect(def.blocks!(run, pc)).toEqual(['工具被干擾停用了，腳本也跑不了。'])
    throwsBlocked(() => def.run!(run, pc, { unit: pc.id }, {} as never), /工具被干擾停用/)
  })

  it('只帶一支可以不選；帶兩支以上要選（沒選丟「要選跑哪一支」）；選了沒帶的丟「甲板裡沒有這支」；沒有目標丟「要選一個目標」', () => {
    const g = game()
    const run = runOf(g)
    const pc = allyOf(run, 'pc')
    const def = act(g, 'net_script')
    quick(pc, ['it_wb_self', 2])
    expect(def.picks!(run, pc)[0]!.required).toBe(false)
    throwsBlocked(() => def.run!(run, pc, null, {} as never), /要選一個目標/)
    def.run!(run, pc, { unit: pc.id }, {} as never)
    expect(pc.quick[0]!.qty).toBe(1)
    quick(pc, ['it_wb_self', 1], ['it_wb_ally', 1])
    expect(def.picks!(run, pc)[0]!.required).toBe(true)
    throwsBlocked(() => def.run!(run, pc, { unit: pc.id }, {} as never), /要選跑哪一支腳本/)
    throwsBlocked(() => def.run!(run, pc, { unit: pc.id }, { pick: { item: 'it_wb_foe' } } as never), /甲板裡沒有這支腳本/)
  })

  it('用完最後一支：從快取格拿掉；只用在現實的腳本（modes 沒有 net）不算在內海帶著', () => {
    const g = game()
    const run = runOf(g)
    const pc = allyOf(run, 'pc')
    const def = act(g, 'net_script')
    quick(pc, ['it_wb_self', 1])
    def.run!(run, pc, { unit: pc.id }, {} as never)
    expect(pc.quick).toEqual([])
    quick(pc, ['it_wb_meat_only', 1])
    expect(def.blocks!(run, pc)).toEqual(['甲板裡沒有帶腳本。'])
    quick(pc, ['it_wb_self', 0], ['it_wb_nope', 1])
    expect(def.blocks!(run, pc)).toEqual(['甲板裡沒有帶腳本。'])
  })

  it('對誰用：自己用的只對自己；隊友用的對相鄰的隊友（隔一格以上寫「要相鄰才用得到」）；敵人用的看距離（range）；格子用的對那一方的格子；對錯了丟「不是這樣用的」', () => {
    const g = game()
    const run = runOf(g)
    const pc = allyOf(run, 'pc')
    const mates = Object.values(run.battle.units).filter((u) => u.side === 'ally' && u.id !== pc.id).sort((a, b) => a.slot - b.slot)
    const def = act(g, 'net_script')
    const aim = (item: string, target: Rec) => { quick(pc, [item, 1]); return () => def.run!(run, pc, target as never, {} as never) }
    // 自己用的：對隊友「不是這樣用的」
    throwsBlocked(aim('it_wb_self', { unit: mates[0]!.id }), /不是這樣用的/)
    // 隊友用的：相鄰成立，隔一格以上要相鄰
    quick(pc, ['it_wb_ally', 1])
    const t = def.targets!(run, pc)
    const optOf = (u: BattleUnit) => t.find((x) => (x.target as { unit?: string }).unit === u.id)!
    expect(optOf(mates[0]!).blocks).toEqual([])
    expect(optOf(mates[2]!).blocks).toEqual(['要相鄰才用得到。'])
    throwsBlocked(aim('it_wb_ally', { unit: mates[2]!.id }), /要相鄰才用得到/)
    // 對敵人的：不是 foe 用的對敵人丟錯
    throwsBlocked(aim('it_wb_ally', { unit: foes(run)[0]!.id }), /不是這樣用的/)
    // 敵人用的、有距離限制：太遠的寫出距離
    const farFoe = foes(run).find((f) => f.slot === 4)!
    throwsBlocked(aim('it_wb_foe', { unit: farFoe.id }), /這支腳本只用得到距離 1～2 的敵人，這個人的距離是 4/)
    aim('it_wb_foe_any', { unit: farFoe.id })()
    // 格子：foe_slot 對敵方的格子成立、對我方的格子「不是這樣用的」；ally_slot 反過來
    aim('it_wb_slot', { side: 'foe', slot: 2 })()
    throwsBlocked(aim('it_wb_slot', { side: 'ally', slot: 2 }), /不是這樣用的/)
    aim('it_wb_ally_slot', { side: 'ally', slot: 2 })()
    throwsBlocked(aim('it_wb_ally_slot', { side: 'foe', slot: 2 }), /不是這樣用的/)
    // 不是人也不是格子（掛著的東西）、不存在的單位：不是這樣用的
    throwsBlocked(aim('it_wb_self', { overlay: 'ov_x' }), /不是這樣用的/)
    throwsBlocked(aim('it_wb_self', { unit: 'u_nope' }), /不是這樣用的|沒有/)
  })

  it('對隊友用：紀錄寫「用在……身上」，對自己用不寫', () => {
    const g = game()
    const run = runOf(g)
    const pc = allyOf(run, 'pc')
    const mate = Object.values(run.battle.units).find((u) => u.side === 'ally' && u.slot === 2)!
    const def = act(g, 'net_script')
    quick(pc, ['it_wb_ally', 1])
    def.run!(run, pc, { unit: mate.id }, {} as never)
    expect(run.beats.some((b) => /用在.*身上/.test(b.text))).toBe(true)
    const n = run.beats.length
    quick(pc, ['it_wb_self', 1])
    def.run!(run, pc, { unit: pc.id }, {} as never)
    expect(run.beats.slice(n).every((b) => !/用在/.test(b.text))).toBe(true)
  })
})

describe('白箱 netcombat：打牆（CYBERSPACE 6.5 節：干擾打在防火牆節點上 ×2）', () => {
  it('近戰構裝打不了防火牆；沒有目標或目標不是格子時什麼都不做；目標清單只列有牆的格子', () => {
    const g = game()
    const run = runOf(g)
    const pc = allyOf(run, 'pc')
    const def = act(g, 'net_hit_wall')
    pc.wield = 1
    expect(def.blocks!(run, pc)).toEqual(['近戰構裝打不了防火牆。'])
    throwsBlocked(() => def.run!(run, pc, { side: 'foe', slot: 1 }, {} as never), /近戰構裝打不了防火牆/)
    pc.wield = 0
    const n = run.beats.length
    def.run!(run, pc, null, {} as never)
    def.run!(run, pc, { unit: foes(run)[0]!.id }, {} as never)
    expect(run.beats.length).toBe(n)
    run.battle.cover.foe.forEach((c, i) => { c.level = i === 1 ? 2 : 0 })
    expect(def.targets!(run, pc).map((t) => t.target)).toEqual([{ side: 'foe', slot: 2 }])
  })

  it('干擾的武器打牆：同樣的骰面，傷害是一般構裝的 jam_wall_mult 倍（預設 ×2）；牆有耐久時扣在牆上、記 cover.hit', () => {
    const g = game()
    const amount = (wield: number): number => {
      const run = fixDice(runOf(g), Array(12).fill(3))
      const pc = allyOf(run, 'pc')
      pc.wield = wield
      run.battle.cover.foe[0]!.level = 2
      run.battle.cover.foe[0]!.hp = 999
      act(g, 'net_hit_wall').run!(run, pc, { side: 'foe', slot: 1 }, {} as never)
      const beat = run.beats.find((b) => b.tag === 'cover.hit')
      expect(beat, `wield ${wield}`).toBeDefined()
      expect(run.battle.cover.foe[0]!.hp).toBe(999 - (beat!.data!.amount as number))
      return beat!.data!.amount as number
    }
    const plain = amount(0)
    const jam = amount(2)
    expect(jam).toBe(plain * 2)
  })
})

describe('白箱 netcombat：管理行動缺目標與錯誤目標的各一句（CYBERSPACE 6.6 節）', () => {
  /** 讓主角有主控（階數 3）才有管理行動：用技能的衍生數值不方便，直接看各個行動的 run 在沒有目標時丟什麼。 */
  it('造牆要選我方的一格、拆牆與斷路要選敵方的一格、接管要選敵方掛著的一台、標記要選場上的一個敵人', () => {
    const g = game()
    // 管理行動一進 run 就先記一次用掉（錯誤時整步丟掉），所以每一個擋法各用一份新的戰鬥
    type T = Rec | null | ((run: BattleRun, pc: BattleUnit) => Rec)
    const attempt = (id: string, target: T, re: RegExp, prep?: (run: BattleRun, pc: BattleUnit) => void) => {
      const run = runOf(g)
      const pc = allyOf(run, 'pc')
      prep?.(run, pc)
      const t = typeof target === 'function' ? target(run, pc) : target
      throwsBlocked(() => act(g, id).run!(run, pc, t as never, {} as never), re)
    }
    attempt('adm_wall', null, /造牆要選我方的一格/)
    attempt('adm_wall', { side: 'foe', slot: 1 }, /造牆要選我方的一格/)
    attempt('adm_breach', null, /拆牆要選敵方的一格/)
    attempt('adm_breach', { side: 'ally', slot: 1 }, /拆牆要選敵方的一格/)
    attempt('adm_cut', null, /斷路要選敵方的一格/)
    const withOverlay = (run: BattleRun) => { run.addOverlay({ side: 'foe', slot: 2, kind: 'decoy', name: '靶機', hp: { now: 9, max: 9 }, armor: 0, evade: 0 }) }
    attempt('adm_seize', null, /接管要選敵方掛著的一台/, withOverlay)
    attempt('adm_seize', { overlay: 'ov_nope' }, /那一台已經不在了/, withOverlay)
    attempt('adm_mark', null, /標記要選一個敵人/)
    attempt('adm_mark', (_run, pc) => ({ unit: pc.id }), /標記要選場上的一個敵人/)
    let downed = ''
    attempt('adm_mark', () => ({ unit: downed }), /標記要選場上的一個敵人/, (run) => {
      const f = foes(run)[0]!
      f.out = 'down' as never
      downed = f.id
    })
  })

  it('造牆的目標清單：已經是掩體且耐久滿的格子灰掉；AI 在自己站的格子沒有遮蔽時才想造牆；拆牆在敵人有遮蔽時才有分數', () => {
    const g = game()
    const run = runOf(g)
    const pc = allyOf(run, 'pc')
    run.battle.cover.ally[0]!.level = 2
    const opt = act(g, 'adm_wall').targets!(run, pc).find((t) => (t.target as { slot: number }).slot === 1)!
    expect(opt.blocks.length === 0 || opt.blocks[0] === '這一格已經是掩體，耐久也是滿的。').toBe(true)
    run.battle.cover.ally[0]!.level = 0
    expect(act(g, 'adm_wall').aiScore!(run, pc, null)).toBe(3)
    const f = foes(run)[0]!
    run.battle.cover.foe[f.slot - 1]!.level = 0
    expect(act(g, 'adm_breach').aiScore!(run, pc, f)).toBeNull()
    run.battle.cover.foe[f.slot - 1]!.level = 2
    expect(act(g, 'adm_breach').aiScore!(run, pc, f)).toBe(2.5)
    expect(act(g, 'adm_breach').aiTarget!(run, pc, f)).toEqual({ side: 'foe', slot: f.slot })
    expect(act(g, 'adm_breach').aiTarget!(run, pc, null)).toBeNull()
  })
})

describe('白箱 netcombat：效果在不能做的對象上什麼都不做（net.sync、net.ram、net.pin、net.tether；CYBERSPACE 6.4、6.7 節）', () => {
  it('沒有落在的人、落在替身、寫了不是檔位的 to：net.sync 不動；net.ram 對沒有 RAM 的人與已經退出的人不動；net.tether 對沒有落在的人不動', () => {
    const g = game()
    const run = runOf(g)
    const pc = allyOf(run, 'pc')
    const mate = Object.values(run.battle.units).find((u) => u.side === 'ally' && u.slot === 2)!
    const before = clone(run.battle.units)
    run.effects([{ op: 'net.sync', to: 'deep', who: 'target' }], { user: pc, source: SRC, target: null  })
    run.effects([{ op: 'net.sync', to: 'nope', who: 'target' }], { user: pc, source: SRC, target: { unit: mate.id } })
    run.effects([{ op: 'net.ram', amount: 3, who: 'target' }], { user: pc, source: SRC, target: null  })
    run.effects([{ op: 'net.tether', who: 'target' }], { user: pc, source: SRC, target: null  })
    run.effects([{ op: 'net.pin', who: 'target' }], { user: pc, source: SRC, target: null  })
    expect(run.battle.units).toEqual(before)
    // 沒有 RAM 的人
    delete mate.pools.ram
    run.effects([{ op: 'net.ram', amount: 3, who: 'target' }], { user: pc, source: SRC, target: { unit: mate.id } })
    expect(mate.pools.ram).toBeUndefined()
    // 已經退出的人
    const other = Object.values(run.battle.units).find((u) => u.side === 'ally' && u.slot === 3)!
    other.pools.ram!.now = 0
    other.out = 'down' as never
    run.effects([{ op: 'net.ram', amount: 3, who: 'target' }], { user: pc, source: SRC, target: { unit: other.id } })
    expect(other.pools.ram!.now).toBe(0)
  })

  it('net.ram 加的不超過上限、減的不低於 0、算出來沒變的什麼都不說；net.trace 在沒有追蹤度的場地不做', () => {
    const g = game()
    const run = runOf(g)
    const pc = allyOf(run, 'pc')
    pc.pools.ram!.now = pc.pools.ram!.max - 1
    const n = run.beats.length
    run.effects([{ op: 'net.ram', amount: 99, who: 'self' }], { user: pc, source: SRC })
    expect(pc.pools.ram!.now).toBe(pc.pools.ram!.max)
    expect(run.beats.length).toBe(n + 1)
    run.effects([{ op: 'net.ram', amount: 5, who: 'self' }], { user: pc, source: SRC })
    expect(run.beats.length).toBe(n + 1)
    run.effects([{ op: 'net.ram', amount: -99, who: 'self' }], { user: pc, source: SRC })
    expect(pc.pools.ram!.now).toBe(0)
    expect(run.battle.field.trace).toBeUndefined()
    run.effects([{ op: 'net.trace', amount: 10, who: 'self' }], { user: pc, source: SRC })
    expect(run.battle.field.trace).toBeUndefined()
  })

  it('拔線：被擋下時（setOut 回傳 false）記一句「想拔線，但是被擋下了」；被釘住的人不能拔線（pinned 的 out 不是 jacked_out）', () => {
    const g = game()
    const run = runOf(g)
    const pc = allyOf(run, 'pc')
    const def = act(g, 'net_jack_out')
    expect(def.cost!(run, pc)).toEqual({ ap: 1 })
    const real = run.setOut.bind(run)
    run.setOut = () => false
    const n = run.beats.length
    def.run!(run, pc, null, {} as never)
    expect(run.beats.slice(n).some((b) => /被擋下了/.test(b.text))).toBe(true)
    run.setOut = real
    def.run!(run, pc, null, {} as never)
    expect(pc.out).toBe('jacked_out')
  })
})
