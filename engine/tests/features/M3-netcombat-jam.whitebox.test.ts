// 白箱測試：features/netcombat/jam.ts（干擾、破損、修理的效果與修正）。
// 規格：CYBERSPACE 6.5 節（干擾：命中時目標的一個構裝停用一回合；破損：輕到戰鬥結束、重到登出之後修好；雜兵不算破損）；不變式第 154 條。
// 補主套件沒有走到的分支：干擾停用的回合數與紀錄、對退出的人不做；破損指定哪一件（沒裝著、已破損的不做）、沒有構裝的人改成傷害骰少 1 顆、再中一次是重的；
// 防護被干擾或破損時的護甲修正、破損的被動工具扣回它的加成、傷害骰少的修正；三個效果的格式檢查；戰後重創寫回狀況。

import { describe, expect, it } from 'vitest'
import type { BattleUnit } from '../../src'
import { BattleRun, clone } from '../../src'
import { breakOne, fixOne, jamUnit } from '../../src/features/netcombat/jam'
import { brokenOf, isJammed } from '../../src/features/netcombat/model'
import { makeNetBattleGame } from '../../src/testkit'

type G = ReturnType<typeof makeNetBattleGame>['game']
type Rec = Record<string, unknown>

const game = (): G => makeNetBattleGame().game
const runOf = (g: G): BattleRun => new BattleRun(g.k, g.state, clone(g.state.battle!))
const pcOf = (run: BattleRun): BattleUnit => Object.values(run.battle.units).find((u) => u.actor === 'pc')!
const foeOf = (run: BattleRun): BattleUnit => Object.values(run.battle.units).find((u) => u.side === 'foe')!
const SRC = { kind: 'skill', id: 'wb', name: '白箱' } as never

describe('白箱 jam：干擾（CYBERSPACE 6.5 節）', () => {
  it('jamUnit：停用一個回合（預設）或 turns 個回合（紀錄寫「停用 2 個回合」）；對已退出的人不做、回傳 false；每一類構裝各是各的狀態', () => {
    const g = game()
    const run = runOf(g)
    const foe = foeOf(run)
    expect(jamUnit(run, foe, 'tool')).toBe(true)
    expect(isJammed(foe, 'tool')).toBe(true)
    expect(isJammed(foe, 'weapon')).toBe(false)
    expect(run.beats.at(-1)!.text).toMatch(/停用一個回合/)
    expect(jamUnit(run, foe, 'defense', undefined, 2)).toBe(true)
    expect(run.beats.at(-1)!.text).toMatch(/停用 2 個回合/)
    const gone = Object.values(run.battle.units).filter((u) => u.side === 'foe')[1]!
    gone.out = 'down' as never
    expect(jamUnit(run, gone, 'weapon')).toBe(false)
  })

  it('net.jam 效果：沒寫 slot 看 pick.jam、再沒有是武器；turns 取整、最少 1；落在替身或沒有人時不做', () => {
    const g = game()
    const run = runOf(g)
    const pc = pcOf(run)
    const foe = foeOf(run)
    run.effects([{ op: 'net.jam', who: 'target' }], { user: pc, source: SRC, target: { unit: foe.id } })
    expect(isJammed(foe, 'weapon')).toBe(true)
    run.effects([{ op: 'net.jam', who: 'target' }], { user: pc, source: SRC, target: { unit: foe.id }, pick: { jam: 'defense' } })
    expect(isJammed(foe, 'defense')).toBe(true)
    run.effects([{ op: 'net.jam', slot: 'tool', turns: 3.7, who: 'target' }], { user: pc, source: SRC, target: { unit: foe.id } })
    expect(run.beats.at(-1)!.text).toMatch(/停用 3 個回合/)
    const n = run.beats.length
    run.effects([{ op: 'net.jam', who: 'target' }], { user: pc, source: SRC, target: null })
    expect(run.beats.length).toBe(n)
  })
})

describe('白箱 jam：破損與修理（CYBERSPACE 6.5 節；ITEMS 11.4 節）', () => {
  it('breakOne 指定的那一件：沒裝著的、已經破損的回傳 null、不動；指定的是裝著的：記進 broken、紀錄寫「到戰鬥結束前用不了」；沒指定照武器、工具、防護的順序', () => {
    const g = game()
    const run = runOf(g)
    const pc = pcOf(run)
    expect(breakOne(run, pc, undefined, 'cs_nope')).toBeNull()
    expect(brokenOf(pc)).toEqual([])
    expect(breakOne(run, pc, undefined, 'cs_tw_guard')).toBe('cs_tw_guard')
    expect(run.beats.at(-1)!.text).toMatch(/到戰鬥結束前用不了/)
    expect(breakOne(run, pc, undefined, 'cs_tw_guard')).toBeNull()
    expect(brokenOf(pc)).toEqual(['cs_tw_guard'])
    // 沒指定：武器先（裝著的第一把武器）
    const first = breakOne(run, pc)
    expect(['cs_tw_gun', 'cs_tw_blade', 'cs_tw_jam']).toContain(first)
  })

  it('本來就有破損再中一次是重的（紀錄寫「重創：登出之後也沒修好」、heavy 記在單位上）；修好全部之後重創解除', () => {
    const g = game()
    const run = runOf(g)
    const pc = pcOf(run)
    breakOne(run, pc)
    expect((pc.ext.net as Rec).heavy).toBeUndefined()
    breakOne(run, pc)
    expect((pc.ext.net as Rec).heavy).toBe(true)
    expect(run.beats.at(-1)!.text).toMatch(/重創：登出之後也沒修好/)
    while (fixOne(run, pc) !== null) { /* 修到沒有 */ }
    expect((pc.ext.net as Rec).heavy).toBeUndefined()
  })

  it('沒有構裝可以挑的人（敵方沒有構裝體）：改成這一場傷害骰少 1 顆（紀錄寫「受了破損，這一場傷害骰少 1 顆」）；再中一次是重的；已經退出的、替身不做；fixOne 補回一顆、指定 id 時不補骰', () => {
    const g = game()
    const run = runOf(g)
    const foe = foeOf(run)
    ;(foe.ext.deck as Rec | undefined) && delete foe.ext.deck
    expect(breakOne(run, foe)).toBe('dice')
    expect((foe.ext.net as Rec).dice_loss).toBe(1)
    expect(run.beats.at(-1)!.text).toMatch(/這一場傷害骰少 1 顆。$/)
    expect(breakOne(run, foe)).toBe('dice')
    expect((foe.ext.net as Rec).dice_loss).toBe(2)
    expect((foe.ext.net as Rec).heavy).toBe(true)
    expect(run.beats.at(-1)!.text).toMatch(/（重創）/)
    // 傷害骰少了的修正
    expect(run.mods('dice', foe).filter((m) => m.source === 'break').map((m) => m.value)).toEqual([-2])
    expect(fixOne(run, foe, 'cs_x')).toBeNull()
    expect(fixOne(run, foe)).toBe('dice')
    expect((foe.ext.net as Rec).dice_loss).toBe(1)
    foe.out = 'down' as never
    expect(breakOne(run, foe)).toBeNull()
  })

  it('net.break、net.fix 效果：沒有落在的人不做；指定的 slot 照指定；回傳的結果記在 last.ok（沒做成是 false）', () => {
    const g = game()
    const run = runOf(g)
    const pc = pcOf(run)
    const n = run.beats.length
    run.effects([{ op: 'net.break', who: 'target' }, { op: 'net.fix', who: 'target' }], { user: pc, source: SRC, target: null })
    expect(run.beats.length).toBe(n)
    const r1 = run.effects([{ op: 'net.break', slot: 'cs_tw_probe', who: 'self' }], { user: pc, source: SRC })
    expect(r1.ok).toBe(true)
    expect(brokenOf(pc)).toEqual(['cs_tw_probe'])
    expect(run.effects([{ op: 'net.fix', slot: 'cs_tw_gun', who: 'self' }], { user: pc, source: SRC }).ok).toBe(false)
    expect(run.effects([{ op: 'net.fix', slot: 'cs_tw_probe', who: 'self' }], { user: pc, source: SRC }).ok).toBe(true)
    expect(brokenOf(pc)).toEqual([])
  })
})

describe('白箱 jam：破損與干擾造成的數字（修正 armor、被動工具）', () => {
  it('防護被干擾停用：護甲修正 = −整個護甲；防護構裝破損：只扣和剩下最高的差（這裡只有一件，扣光）；沒有防護構裝時不扣', () => {
    const g = game()
    const run = runOf(g)
    const pc = pcOf(run)
    const armor0 = pc.armor
    expect(armor0).toBeGreaterThan(0)
    const parts = (kind: 'armor') => run.mods(kind, pc).filter((m) => m.source === 'jam' || m.source === 'break')
    expect(parts('armor')).toEqual([])
    jamUnit(run, pc, 'defense')
    expect(parts('armor').map((m) => m.value)).toEqual([-armor0])
    // 干擾退場後換成破損
    pc.statuses = pc.statuses.filter((s) => !String(s.id).startsWith('jam_'))
    breakOne(run, pc, undefined, 'cs_tw_guard')
    const broke = parts('armor')
    expect(broke).toHaveLength(1)
    expect(broke[0]!.value).toBeLessThan(0)
    expect(broke[0]!.value).toBeGreaterThanOrEqual(-armor0)
  })

  it('戰後重創寫回：單位身上 heavy 為 true 的我方角色得到狀況 net_broken、結果多一句「重創：…的構裝破損（要修理）」；沒有 heavy 的不寫', async () => {
    const mk = async (heavy: boolean) => {
      const g = game()
      const pcId = Object.values(g.state.battle!.units).find((u) => u.actor === 'pc')!.id
      ;(g.state.battle!.units[pcId]!.ext.net as Rec).heavy = heavy
      for (let i = 0; i < 80 && g.battle; i++) {
        const o = g.battleOptions()
        if (!o || o.waiting === 'over') break
        if (o.waiting === 'ai') { g.battleNext(); continue }
        if (o.current === pcId) break
        g.battleAct({ action: 'end_turn' } as never)
      }
      g.battleAct({ action: 'net_surrender' } as never)
      const out = await g.finishBattle()
      return { g, out }
    }
    const { g, out } = await mk(true)
    expect(g.state.actors.pc!.conditions.map((c) => c.id)).toContain('net_broken')
    expect(JSON.stringify(out.reports)).toContain('重創：測試主角的構裝破損（要修理）')
    const { g: h, out: o2 } = await mk(false)
    expect(h.state.actors.pc!.conditions.map((c) => c.id)).not.toContain('net_broken')
    expect(JSON.stringify(o2.reports)).not.toContain('重創：')
  }, 30_000)
})

describe('白箱 jam：三個效果的格式檢查（net.jam、net.break、net.fix）', () => {
  it('slot 不是三類之一、turns 不是 1 以上的整數、break／fix 的 slot 是空字串或不是字串、多出來的欄位：各一句', () => {
    const g = game()
    const problems = (e: Rec) => g.k.battle.effectProblems([e])
    expect(problems({ op: 'net.jam', slot: 'sky' }).join('；')).toMatch(/slot 只能是 weapon、defense、tool/)
    expect(problems({ op: 'net.jam', turns: 0 }).join('；')).toMatch(/turns 要是 1 以上的整數/)
    expect(problems({ op: 'net.jam', turns: 1.5 }).join('；')).toMatch(/turns 要是 1 以上的整數/)
    expect(problems({ op: 'net.jam', nope: 1 }).join('；')).toMatch(/nope 不是這個效果的欄位/)
    expect(problems({ op: 'net.jam', slot: 'tool', turns: 2 })).toEqual([])
    for (const op of ['net.break', 'net.fix']) {
      expect(problems({ op, slot: '' }).join('；'), op).toMatch(/slot 要是構裝的 id/)
      expect(problems({ op, slot: 3 }).join('；'), op).toMatch(/slot 要是構裝的 id/)
      expect(problems({ op, extra: 1 }).join('；'), op).toMatch(/extra 不是這個效果的欄位/)
      expect(problems({ op, slot: 'cs_tw_gun' }), op).toEqual([])
    }
  })
})
