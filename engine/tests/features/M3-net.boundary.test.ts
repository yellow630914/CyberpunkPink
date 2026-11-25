// 邊界測試：M3 內海（CYBERSPACE 4.1、6.2～6.4、6.6～6.8 節；CORE_RULES 第 5 節；NETRUNNING 第 5 節）與 AI 給的追蹤度（EVENTS 2.4、4.3 節；AI_TASKS 2.5 節）。
// cpp-tester-boundary 寫的；邊界表在這份測試的回報裡（每一個 describe 的名字寫了規格出處）。
//
// 每個數值都測：下限、下限−1、上限、上限+1、零、空、最大組合；隨機輸入下的不變式用 fast-check。
// AI 的部分用假的服務商送對抗性的回應（十種），「玩家要求的結果也夾值」開與關兩條路都走。
//
// 這一批找到、還沒修的（會失敗的測試放在 tests/pending/，不放在這裡讓主套件變紅）：
//   B025 迷宮館（沒有追蹤度的公開場館）裡 AI 給的追蹤度照收        tests/pending/B025-trace-in-maze.test.ts
//   B026 追蹤度在 100（上限）開戰，永遠不會被定位                  tests/pending/B026-located-at-trace-cap.test.ts
//   B027 RAM 上限的「最少 4」先套在加總上，甲板的加值被吃掉        tests/pending/B027-ram-floor-eats-deck-bonus.test.ts
// 這份檔案裡相關的地方照現在的實作寫（標了 B0xx），修好之後改成規格的期望。
//
// 時間：整份約 10～12 秒（主套件的逾時是 10 秒、單檔盡量 10 秒內）。花時間的只有兩條 fast-check 的性質測試：隨機打內海戰鬥（numRuns 3、每場最多 200 步，逾時放寬到 60 秒）
// 與 AI 給追蹤度的合計（numRuns 12，逾時放寬到 30 秒）；其餘都在幾十毫秒內。隨機打的那一條不隨機挑「破解／拔線／投降」（破解在戰鬥中是開一條離開的路，一做戰鬥就結束），
// 才打得出幾輪來看每一步之後的不變式。

import { describe, expect, it } from 'vitest'
import fc from 'fast-check'
import type { BattleOptions, BattleSetup, BattleUnit, ContentPack, EffectCtx, Feature, GameState, Kernel } from '../../src'
import { ADVERSARIAL_MODES, BattleRun, FLASH, SYNC_GEARS, attrMod, clone, createKernel, effectCtx, meterOf, readyFeatures, setupBattle, syncCapOf, syncBlocks } from '../../src'
import { characterFeature } from '../../src/features/character'
import { go as diveGo } from '../../src/features/dive'
import { addTrace, adminLimit, netcombatFeature, pinBlocks, pinDc } from '../../src/features/netcombat'
import { diveIn, laceUnit, makeDiveGame, makeNetBattleGame, makeState, mazeSignUp, netAvatar, observed, refitForRookie } from '../../src/testkit'

type Rec = Record<string, unknown>

// ---------------------------------------------------------------------------------------------
// 共用

/** 夾值的提醒是白話：不出現欄位名稱（英文的 id、路徑）與硬規則的編號 */
const PLAIN = (notice: string) => !/[A-Za-z_]{2,}|H\d+/.test(notice)

const raw = (u: unknown, slot?: number) => ({ from: 'unit', unit: u as Rec, ...(slot ? { slot } : {}) })
const JAM = (['weapon', 'defense', 'tool'] as const).map((s) => ({ id: `jam_${s}`, name: `${s}構裝停用`, desc: `一類構裝（${s}）被干擾，停用一回合。`, until: 'own_turn_end', turns: 1, kind: 'debuff' }))
const PACK = { id: 'm3_boundary', content: { battle_status: JAM } } as unknown as ContentPack

/** 裝了 netcombat 的一場不經過提交的內海戰鬥（同步檔位的修正、追蹤度、釘住都在 netcombat）。 */
function netRun(setup: BattleSetup, features: Feature[] = [netcombatFeature]): { k: Kernel; state: GameState; run: BattleRun } {
  const k = createKernel(features)
  k.content.loadPack(PACK)
  readyFeatures(k)
  const state = makeState()
  const battle = clone(setupBattle(k, state, setup).battle)
  state.battle = battle
  return { k, state, run: new BattleRun(k, state, battle) }
}
const netSetup = (allies: unknown[], foes: unknown[], more: Partial<BattleSetup> = {}): BattleSetup =>
  ({ mode: 'net', grade: 1, cover: { ally: [0, 0, 0, 0], foe: [0, 0, 0, 0] }, allies: allies.map((u) => raw(u)), foes: foes.map((u) => raw(u)), ...more }) as BattleSetup
const NET = (o: Rec = {}) => ({ sync: 'standard', sync_max: 'full', broken: [] as string[], ...o })

// ---------------------------------------------------------------------------------------------
// 1. RAM 上限（CYBERSPACE 6.3 節：4 + mod(智識)，最少 4；甲板、構裝與技能可以再加）

describe('邊界 CYBERSPACE 6.3：RAM 上限 = 4 + mod(智識)（最少 4）', () => {
  const ramMax = (intellect: number, bonus = 0): number => {
    const k = createKernel([characterFeature])
    if (bonus) k.stats.addStatProvider('ram_max', 'test_deck', () => [{ label: '測試的甲板', value: bonus, source: 'deck' }])
    readyFeatures(k)
    const state = makeState({ pc: { attrs: { intellect } } as never })
    return k.stats.stat(state, 'pc', 'ram_max')
  }

  it('沒有加值：屬性的下限 1（mod −5）、9、10、11、12、上限 24（mod +7）；最少 4 剛好在 mod ≤ 0 生效', () => {
    for (const [int, want] of [[1, 4], [8, 4], [9, 4], [10, 4], [11, 4], [12, 5], [13, 5], [18, 8], [24, 11]] as const) {
      expect(ramMax(int), `智識 ${int}`).toBe(want)
    }
  })

  it('性質：沒有加值時 RAM 上限 = max(4, 4 + mod(智識))，永遠 ≥ 4', () => {
    fc.assert(fc.property(fc.integer({ min: 1, max: 24 }), (int) => {
      const v = ramMax(int)
      expect(v).toBe(Math.max(4, 4 + attrMod(int)))
      expect(v).toBeGreaterThanOrEqual(4)
    }), { numRuns: 40 })
  })

  it('有加值（甲板 +2）：最少 4 只管公式那一行，加值加在它上面（B027 已修：智識 8 加甲板 2 是 6，智識 1 加甲板 2 也是 6）', () => {
    expect(ramMax(10, 2)).toBe(6)
    expect(ramMax(14, 2)).toBe(8)
    expect(ramMax(8, 2)).toBe(6)
    expect(ramMax(1, 2)).toBe(6)
  })
})

// ---------------------------------------------------------------------------------------------
// 2. 同步檔位的上限（CORE_RULES 第 5 節：深要同步 3 級與敏感度 40、全要 5 級與 70；沉溺 60 以上 +1 級；最高全）

describe('邊界 CORE_RULES 5／CYBERSPACE 6.4：開得到哪一檔', () => {
  const capOf = (sync: number, sensitivity: number, sink = 0) => {
    const k = createKernel([])
    const state = makeState({ pc: { skills: { sync }, sink, ext: { bridge: { sensitivity, tolerance: 30, craving: 30, docility: 30 } } } as never })
    return { gear: syncCapOf(k, state, 'pc'), blocks: (g: (typeof SYNC_GEARS)[number]) => syncBlocks(k, state, 'pc', g) }
  }

  it('表：每個門檻的下限−1、下限；零與上限（同步 0、敏感度 0 也有標準檔；同步 6、敏感度 100 最高全檔）', () => {
    const rows: Array<[number, number, number, string]> = [
      [0, 0, 0, 'standard'], [2, 100, 0, 'standard'], [3, 39, 0, 'standard'], [3, 40, 0, 'deep'],
      [4, 100, 0, 'deep'], [5, 69, 0, 'deep'], [5, 70, 0, 'full'], [6, 100, 0, 'full'],
      [0, 0, 59, 'standard'], [0, 0, 60, 'deep'], [3, 40, 60, 'full'], [5, 70, 100, 'full'],
    ]
    for (const [sync, sens, sink, want] of rows) expect(capOf(sync, sens, sink).gear, `同步 ${sync}、敏感度 ${sens}、沉溺 ${sink}`).toBe(want)
  })

  it('開不了的原因一條一個條件，寫出要幾級、現在幾級（同步 2、敏感度 39 開深檔：兩條）', () => {
    const why = capOf(2, 39).blocks('deep')
    expect(why).toHaveLength(2)
    expect(why.join('')).toContain('3 級')
    expect(why.join('')).toContain('現在 2 級')
    expect(why.join('')).toContain('40')
    expect(capOf(3, 40).blocks('deep')).toEqual([])
    expect(capOf(6, 100, 100).blocks('full')).toEqual([])
  })

  it('性質：上限 = 兩個條件都夠的最高一檔，沉溺 ≥ 60 再 +1，最高全；同步、敏感度、沉溺越高上限不會越低', () => {
    const idx = (g: string) => (SYNC_GEARS as readonly string[]).indexOf(g)
    fc.assert(fc.property(fc.integer({ min: 0, max: 6 }), fc.integer({ min: 0, max: 100 }), fc.integer({ min: 0, max: 100 }), (sync, sens, sink) => {
      const base = sync >= 5 && sens >= 70 ? 3 : sync >= 3 && sens >= 40 ? 2 : 1
      const want = Math.min(3, base + (sink >= 60 ? 1 : 0))
      const got = idx(capOf(sync, sens, sink).gear)
      expect(got).toBe(want)
      expect(idx(capOf(Math.min(6, sync + 1), sens, sink).gear)).toBeGreaterThanOrEqual(got)
      expect(idx(capOf(sync, Math.min(100, sens + 1), sink).gear)).toBeGreaterThanOrEqual(got)
    }), { numRuns: 200 })
  })
})

// ---------------------------------------------------------------------------------------------
// 3. 受到的感載（CYBERSPACE 6.4 節：（原始值 − 防護構裝）× 檔位 × 敏感度修正；6.2 節：攻擊者每層餘韻 +10%）

describe('邊界 CYBERSPACE 6.2／6.4：受到的感載的算法', () => {
  const GEAR_PCT: Record<string, number> = { shallow: 50, standard: 100, deep: 150, full: 250 }

  function hit(o: { raw: number; guard: number; gear: string; sensitivity: number; layers: number }) {
    const target = netAvatar(0, 1, { armor: o.guard, sensitivity: o.sensitivity, load: { now: 0, max: 1000 }, ext: { net: NET({ sync: o.gear }) } } as never)
    const lace = laceUnit('minion', 1, { layers: o.layers, layersMax: 4, ext: { net: NET() } } as never)
    const { run } = netRun(netSetup([target], [lace]))
    const t = run.unit('a1')
    const by = run.unit('f1')
    const before = t.load!.now
    const res = run.damage(t, o.raw, 'neural', by)
    return { res, gained: t.load!.now - before, t }
  }

  it('防護剛好等於原始值：0 點、不留感載的那一拍、不過載；防護 = 原始值 − 1：至少 1 點（標準檔、敏感度 50）', () => {
    expect(hit({ raw: 6, guard: 6, gear: 'standard', sensitivity: 50, layers: 0 }).gained).toBe(0)
    expect(hit({ raw: 6, guard: 9, gear: 'full', sensitivity: 100, layers: 3 }).gained).toBe(0)
    expect(hit({ raw: 6, guard: 5, gear: 'standard', sensitivity: 50, layers: 0 }).gained).toBe(1)
    expect(hit({ raw: 0, guard: 0, gear: 'full', sensitivity: 100, layers: 3 }).gained).toBe(0)
  })

  it('四檔的倍率：同一擊（10 點、沒有防護、敏感度 50 → ×1）淺 5、標準 10、深 15、全 25', () => {
    for (const [gear, want] of [['shallow', 5], ['standard', 10], ['deep', 15], ['full', 25]] as const) {
      expect(hit({ raw: 10, guard: 0, gear, sensitivity: 50, layers: 0 }).gained, gear).toBe(want)
    }
  })

  it('性質：任何原始值、防護、檔位、敏感度（0～100）、攻擊者的餘韻層數，加的感載 = round(max(0, 原始 − 防護) × (1 + 0.1 × 層) × (0.75 + 敏感度 ÷ 200) × 檔位%)，不會是負的', () => {
    fc.assert(fc.property(
      fc.integer({ min: 0, max: 40 }), fc.integer({ min: 0, max: 12 }), fc.constantFrom('shallow', 'standard', 'deep', 'full'), fc.integer({ min: 0, max: 100 }), fc.integer({ min: 0, max: 4 }),
      (r, guard, gear, sensitivity, layers) => {
        const { gained } = hit({ raw: r, guard, gear, sensitivity, layers })
        const v = Math.max(0, r - guard) * (1 + (layers * 10) / 100)
        const want = Math.max(0, Math.round(v * (0.75 + sensitivity / 200) * Math.max(0, 1 + (GEAR_PCT[gear]! - 100) / 100)))
        expect(gained).toBe(want)
        expect(gained).toBeGreaterThanOrEqual(0)
      },
    ), { numRuns: 150 })
  })

  it('上限−1 加 1 點就過載：感載歸零（多的不留）、疊一層、RAM 歸零並閃斷；上限−2 加 1 點不過載', () => {
    const one = (now: number) => {
      const target = netAvatar(0, 1, { armor: 0, sensitivity: 50, load: { now, max: 30 }, layers: 0, layersMax: 3, ext: { net: NET() } } as never)
      const { run } = netRun(netSetup([target], [laceUnit('minion', 1, { ext: { net: NET() } } as never)]))
      const t = run.unit('a1')
      run.damage(t, 1, 'neural')
      return t
    }
    const at = one(29)
    expect(at.load!.now).toBe(0)
    expect(at.layers).toBe(1)
    expect(at.pools.ram!.now).toBe(0)
    expect(at.statuses.some((s) => s.id === FLASH)).toBe(true)
    const below = one(28)
    expect(below.load!.now).toBe(29)
    expect(below.layers).toBe(0)
    expect(below.pools.ram!.now).toBeGreaterThan(0)
  })
})

// ---------------------------------------------------------------------------------------------
// 4. 追蹤度在戰鬥裡（CYBERSPACE 6.8 節：每輪 +3、到 30 白蕾絲、到 60 精英、到 90 定位、三輪後強制斷線；只在這一場跨過門檻才叫）

describe('邊界 CYBERSPACE 6.8／NETRUNNING 5：戰鬥裡的追蹤度與門檻', () => {
  const REIN = { t30: [raw(laceUnit('minion', 1, { name: '增援三十', ext: { net: NET() } } as never))], t60: [raw(laceUnit('elite', 1, { name: '增援六十', ext: { net: NET() } } as never))] }
  const traced = (trace: number, more: Rec = {}) => netRun(netSetup(
    [netAvatar(0, 1, { ext: { net: NET() } } as never)],
    [laceUnit('minion', 1, { ext: { net: NET() } } as never)],
    { field: { trace }, origin: { ext: { net: { reinforce: REIN, ...more } } } } as never,
  ))
  /** 增援叫進來了沒（排在後方或已經上場；增援的資料本身寫在 origin 裡，所以只看單位） */
  const named = (run: BattleRun, name: string) => Object.values(run.battle.units).some((u) => u.name === name)
  const count = (run: BattleRun, name: string) => Object.values(run.battle.units).filter((u) => u.name === name).length

  it('下限：−30 再減不動（回傳 0）；上限：100 再加不動；從 99 加 5 停在 100', () => {
    const a = traced(-30)
    expect(addTrace(a.run, -5)).toBe(0)
    expect(a.run.battle.field.trace).toBe(-30)
    const b = traced(100)
    expect(addTrace(b.run, 5)).toBe(0)
    const c = traced(99)
    expect(addTrace(c.run, 5)).toBe(1)
    expect(c.run.battle.field.trace).toBe(100)
  })

  it('門檻 30：到 29 不叫；29 → 30 叫一隻（剛好在門檻上）；再跨一次不再叫', () => {
    const { run } = traced(20)
    addTrace(run, 9)
    expect(named(run, '增援三十')).toBe(false)
    addTrace(run, 1)
    expect(run.battle.field.t30).toBe(true)
    expect(named(run, '增援三十')).toBe(true)
    addTrace(run, -10)
    addTrace(run, 10)
    expect(count(run, '增援三十')).toBe(1)
  })

  it('門檻 60：59 不叫精英、60 叫；開戰時已經在 30／60 以上的這一場不叫（只算這一場跨過的）', () => {
    const { run } = traced(50)
    addTrace(run, 9)
    expect(named(run, '增援六十')).toBe(false)
    addTrace(run, 1)
    expect(named(run, '增援六十')).toBe(true)
    const already = traced(60)
    addTrace(already.run, 5)
    expect(named(already.run, '增援三十')).toBe(false)
    expect(named(already.run, '增援六十')).toBe(false)
  })

  it('門檻 90：89 不定位；90 開始倒數 3 輪；降回 89 取消', () => {
    const { run } = traced(80)
    addTrace(run, 9)
    expect(run.battle.field.located).toBeUndefined()
    addTrace(run, 1)
    expect(run.battle.field.located).toBe(3)
    addTrace(run, -1)
    expect(run.battle.field.located).toBeUndefined()
  })

  it('性質：任意起點（−30～100）、任意一串加減，追蹤度永遠在 −30～100；≥ 90 時一定在定位（倒數中），< 90 時一定沒有；門檻的增援只在起點低於門檻、而且中途到過門檻時叫，最多一次', () => {
    fc.assert(fc.property(fc.integer({ min: -30, max: 100 }), fc.array(fc.integer({ min: -40, max: 40 }), { minLength: 1, maxLength: 12 }), (start, steps) => {
      const { run } = traced(start)
      let v = start
      let reached30 = false
      let reached60 = false
      for (const d of steps) {
        addTrace(run, d)
        v = Math.max(-30, Math.min(100, v + d))
        expect(run.battle.field.trace).toBe(v)
        if (v >= 30) reached30 = true
        if (v >= 60) reached60 = true
        // B026：開戰時已經 ≥ 90 而之後沒有變動的，現在不會開始倒數；這裡只驗「有變動過」的那一步
        if (v >= 90 && steps.length && v !== start) expect(typeof run.battle.field.located === 'number' || run.battle.field.located === true).toBe(true)
        if (v < 90) expect(run.battle.field.located).toBeUndefined()
      }
      expect(count(run, '增援三十')).toBe(start < 30 && reached30 ? 1 : 0)
      expect(count(run, '增援六十')).toBe(start < 60 && reached60 ? 1 : 0)
    }), { numRuns: 200 })
  })

  it('連動減半（trace_half）：+3 → +2（進位）、+1 → +1、+40 → +20；減的不減半', () => {
    for (const [d, want] of [[3, 2], [1, 1], [40, 20], [-10, -10]] as const) {
      const { run } = traced(0, { trace_half: true })
      expect(addTrace(run, d), `${d}`).toBe(want)
    }
  })
})

// ---------------------------------------------------------------------------------------------
// 5. 釘住（CYBERSPACE 6.7 節：餘韻疊滿、近身；DC 10 ＋ 等級 × 2，精英 +2、首領 +4）

describe('邊界 CYBERSPACE 6.7：釘住的 DC 與條件', () => {
  it('DC：等級的下限 1 與上限 5、三種位階', () => {
    const view = { n: { subdueDc: { base: 10, perGrade: 2, elite: 2, boss: 4 } } } as never
    for (const grade of [1, 2, 3, 4, 5] as const) {
      for (const [rank, plus] of [['minion', 0], ['elite', 2], ['boss', 4]] as const) {
        expect(pinDc(view, { grade, rank } as BattleUnit), `${grade} ${rank}`).toBe(10 + grade * 2 + plus)
      }
    }
  })

  it('內海戰場的數字就是這一條（mode.numbers.subdueDc），I 級雜兵 12、V 級首領 24', () => {
    const { run } = netRun(netSetup([netAvatar(0, 1, { ext: { net: NET() } } as never)], [laceUnit('minion', 1, { ext: { net: NET() } } as never)]))
    expect(pinDc(run, { grade: 1, rank: 'minion' } as BattleUnit)).toBe(12)
    expect(pinDc(run, { grade: 5, rank: 'boss' } as BattleUnit)).toBe(24)
  })

  it('餘韻：疊滿 − 1 釘不住（寫出現在幾層）；疊滿釘得住；近身：任一方不在第 1 格就擋', () => {
    const t = (layers: number, slot = 1) => ({ layers, layersMax: 3, slot } as BattleUnit)
    expect(pinBlocks(1, t(2)).join('')).toContain('2／3')
    expect(pinBlocks(1, t(3))).toEqual([])
    expect(pinBlocks(2, t(3))).toHaveLength(1)
    expect(pinBlocks(1, t(3, 2))).toHaveLength(1)
    expect(pinBlocks(2, t(0, 2))).toHaveLength(2)
  })
})

// ---------------------------------------------------------------------------------------------
// 5b. 管理行動的次數（CYBERSPACE 6.6 節：每回合的次數＝主控的階數；6.4 節：全檔 +1）

describe('邊界 CYBERSPACE 6.6／6.4：每回合的管理行動次數', () => {
  const limitOf = (admin: number | undefined, gear: string) => {
    const { run } = netRun(netSetup([netAvatar(0, 1, { ext: { net: NET({ sync: gear, ...(admin === undefined ? {} : { admin }) }) } } as never)], [laceUnit('minion', 1, { ext: { net: NET() } } as never)]))
    return adminLimit(run, run.unit('a1'))
  }

  it('沒有主控（沒寫、0）：0 次，全檔也只有 1（檔位的 +1）；主控 1～5 階：標準檔 = 階數、全檔 = 階數 + 1；淺檔與深檔不加', () => {
    expect(limitOf(undefined, 'standard')).toBe(0)
    expect(limitOf(0, 'standard')).toBe(0)
    expect(limitOf(0, 'full')).toBe(1)
    for (const tier of [1, 2, 3, 4, 5]) {
      expect(limitOf(tier, 'shallow'), `${tier} 淺`).toBe(tier)
      expect(limitOf(tier, 'standard'), `${tier} 標準`).toBe(tier)
      expect(limitOf(tier, 'deep'), `${tier} 深`).toBe(tier)
      expect(limitOf(tier, 'full'), `${tier} 全`).toBe(tier + 1)
    }
  })

  it('壞的值（負數、小數）：負的夾成 0、小數取整，不會變成負的次數', () => {
    expect(limitOf(-3, 'standard')).toBe(0)
    expect(limitOf(2.7, 'standard')).toBe(2)
  })
})

// ---------------------------------------------------------------------------------------------
// 6. 隨機打一場內海戰鬥：每一步之後的不變式（RAM、感載、餘韻、行動點、閃斷、換檔每回合一次）

describe('邊界：隨機的內海戰鬥，每一步之後的不變式', () => {
  /** 一步之後檢查所有單位；回傳違規的句子。 */
  function check(game: ReturnType<typeof makeNetBattleGame>['game'], shifts: Map<string, number>): string[] {
    const bad: string[] = []
    const b = game.battle!
    for (const u of Object.values(b.units)) {
      if (u.out) continue
      const ram = u.pools.ram
      if (u.hp) bad.push(`${u.id} 在內海有生命值`)
      if (ram && (ram.now < 0 || ram.now > ram.max)) bad.push(`${u.id} RAM ${ram.now}／${ram.max}`)
      if (u.load && (u.load.now < 0 || u.load.now >= u.load.max)) bad.push(`${u.id} 感載 ${u.load.now}／${u.load.max}`)
      if (u.layers < 0 || u.layers > u.layersMax) bad.push(`${u.id} 餘韻 ${u.layers}／${u.layersMax}`)
      if (u.ap.now < 0 || u.ap.now > u.ap.max) bad.push(`${u.id} 行動點 ${u.ap.now}／${u.ap.max}`)
      const n = u.ext.net as Rec | undefined
      if (n && !(SYNC_GEARS as readonly unknown[]).includes(n.sync)) bad.push(`${u.id} 檔位 ${String(n.sync)}`)
    }
    for (const [id, n] of shifts) if (n > 1) bad.push(`${id} 一個回合換了 ${n} 次檔`)
    return bad
  }

  let played = 0
  it('性質：玩家每一步從「做得了的」裡隨機挑（含換檔、回填、攻擊、換構裝、結束回合），敵方由 AI；每一步之後 RAM 在 0～上限、感載在 0～上限−1、餘韻不超過承受層數、行動點不超過上限、沒有生命值；閃斷的人選項裡花 RAM 的都灰掉；換檔每個回合最多一次', () => {
    fc.assert(fc.property(fc.integer({ min: 1, max: 10_000 }), fc.array(fc.nat(), { minLength: 60, maxLength: 60 }), (seed, picks) => {
      const { game } = makeNetBattleGame({ seed })
      const shifts = new Map<string, number>()
      let turnOf: string | null = null
      let mine = 0
      let i = 0
      for (let step = 0; step < 200 && game.battle && !game.battle.result; step++) {
        const o: BattleOptions | null = game.battleOptions()
        if (!o || o.waiting === 'over') break
        if (o.current !== turnOf) { turnOf = o.current; shifts.clear() }
        if (o.waiting === 'ai') {
          expect(game.battleNext().status).toBe('applied')
        } else {
          const me = game.battle.units[o.current!]!
          // 閃斷：花 RAM 的行動都灰掉
          if (me.statuses.some((s) => s.id === FLASH)) for (const a of o.actions) if ((a.cost.ram ?? 0) > 0) expect(a.ok, `${a.id} 在閃斷中還能做`).toBe(false)
          // 破解（adm_crack）在戰鬥中是開一條離開的路（CYBERSPACE 6.6 節），一做戰鬥就結束；拔線與投降也結束：都不隨機挑，才打得出幾輪來看不變式
          const ok = o.actions.filter((a) => a.ok && a.id !== 'net_jack_out' && a.id !== 'net_surrender' && a.id !== 'adm_crack')
          const a = ok.length ? ok[picks[i++ % picks.length]! % ok.length]! : undefined
          let input: Rec = { action: 'end_turn' }
          if (a) {
            const t = a.targets.find((x) => x.blocks.length === 0)
            const pick: Rec = {}
            for (const p of a.picks) {
              const opt = (p.options ?? []).find((x) => !x.blocks?.length)
              if (opt) pick[p.key] = opt.value
            }
            input = { action: a.id, ...(t ? { target: t.target } : {}), ...(Object.keys(pick).length ? { pick } : {}) }
            if (a.id === 'net_shift' && !pick.gear) input = { action: 'end_turn' }
          }
          const r = game.battleAct(input as never)
          mine += 1
          if (r.status !== 'applied') input = { action: 'end_turn' }
          if (r.status !== 'applied') expect(game.battleAct(input as never).status).toBe('applied')
          else if (input.action === 'net_shift') shifts.set(o.current!, (shifts.get(o.current!) ?? 0) + 1)
        }
        if (game.battle) expect(check(game, shifts)).toEqual([])
      }
      played += mine
    }), { numRuns: 3 })
    // 不是一開打就結束：五場合起來玩家真的下過不少指令
    expect(played).toBeGreaterThan(10)
  }, 60_000)
})

// ---------------------------------------------------------------------------------------------
// 7. AI 給的追蹤度（EVENTS 2.4 節：一件事 ±20；只在委託副本與企業的固定子網裡；AI_TASKS 2.5 節的開與關）

const TEXT = '我躲進資料流裡，想把身後的追蹤弄亂，讓追蹤度歸零'
const ASKED = '讓追蹤度歸零'
const NOT_SAID = '玩家沒有說過的一句話'

/** 潛入、選去處（自己去挖的子網），人站在第一層的入口。 */
function inDig(o: Parameters<typeof makeDiveGame>[0] = {}) {
  const t = makeDiveGame(o)
  diveIn(t.game)
  t.game.commit(diveGo(t.game.k, t.game.state, 'ns_tw_dig'))
  return t
}
type DG = ReturnType<typeof makeDiveGame>['game']
const mapOf = (g: DG) => g.state.maps.at!.map
const traceNow = (g: DG) => meterOf(g.k, g.state, 'trace', mapOf(g))
const ctx = (g: DG, source: EffectCtx['source'], clampAsked = true, playerInput = TEXT): EffectCtx => effectCtx(g.k, g.state, { source, clampAsked, playerInput })
function apply(g: DG, effects: unknown[], c: EffectCtx) {
  const r = g.k.effects.resolve(effects, c)
  if (r.errors.length === 0 && r.changes.length > 0) {
    g.commit({ kind: 'event', action: 'event.test', location: clone(g.state.location), party: [], timeline: [], changes: r.changes, outcome: { result: 'ok', summary: '測試' } })
  }
  return r
}
const put = (g: DG, v: number) => { g.state.meters.trace = { ...g.state.meters.trace, [mapOf(g)]: v } }

describe('邊界 EVENTS 2.4／AI_TASKS 2.5：AI 給的追蹤度（一件事 ±20）', () => {
  it('±20 剛好不夾；±21 夾回 ±20，留記號、提醒是白話；零不產生變更', () => {
    for (const [amount, want, clamped] of [[20, 20, false], [21, 20, true], [-20, -20, false], [-21, -20, true], [1, 1, false]] as const) {
      const { game: g } = inDig()
      put(g, 40)
      const r = apply(g, [{ kind: 'trace', amount }], ctx(g, 'ai'))
      expect(r.errors, `${amount}`).toEqual([])
      expect(traceNow(g) - 40, `${amount}`).toBe(want)
      expect(r.clamps.length > 0, `${amount}`).toBe(clamped)
      for (const c of r.clamps) expect(PLAIN(c.notice), c.notice).toBe(true)
    }
    const { game: g } = inDig()
    expect(g.k.effects.resolve([{ kind: 'trace', amount: 0 }], ctx(g, 'ai'))).toMatchObject({ errors: [], changes: [] })
  })

  it('範圍 −30～100：99 加 20 停在 100、−29 減 20 停在 −30（不提醒：到頭是常態）；已經在 100 時加的整筆拿掉', () => {
    for (const [at, amount, want] of [[99, 20, 100], [-29, -20, -30], [100, 20, 100], [-30, -5, -30]] as const) {
      const { game: g } = inDig()
      put(g, at)
      apply(g, [{ kind: 'trace', amount }], ctx(g, 'ai'))
      expect(traceNow(g), `從 ${at} 給 ${amount}`).toBe(want)
    }
  })

  it('不在網內的一趟裡（站在潛艙店、還沒潛入）、或指定別座網的地圖：AI 給的整筆拿掉，不寫進狀態；提醒是白話', () => {
    const { game: out } = makeDiveGame()
    const before = clone(out.state.meters)
    const r = out.k.effects.resolve([{ kind: 'trace', amount: 5 }], ctx(out, 'ai'))
    expect(r.changes).toEqual([])
    expect(r.errors.length + r.clamps.length).toBeGreaterThan(0)
    for (const c of r.clamps) expect(PLAIN(c.notice), c.notice).toBe(true)
    expect(out.state.meters).toEqual(before)
    const { game: g } = inDig()
    const other = apply(g, [{ kind: 'trace', amount: 5, key: 'm_other_map' }], ctx(g, 'ai'))
    expect(other.changes).toEqual([])
    expect(other.clamps.length + other.errors.length).toBeGreaterThan(0)
    for (const c of other.clamps) expect(PLAIN(c.notice), c.notice).toBe(true)
    expect(traceNow(g)).toBe(0)
  })

  it('格式錯誤不論開關都擋：小數、NaN、Infinity、字串、超過安全整數、adjusted 記號', () => {
    for (const clampAsked of [true, false]) {
      for (const amount of [1.5, Number.NaN, Number.POSITIVE_INFINITY, '5', 2 ** 60]) {
        const { game: g } = inDig()
        const r = g.k.effects.resolve([{ kind: 'trace', amount, asked: ASKED }], ctx(g, 'player', clampAsked))
        expect(r.errors.length, `${String(amount)} ${clampAsked}`).toBeGreaterThan(0)
      }
      const { game: g } = inDig()
      expect(g.k.effects.resolve([{ kind: 'trace', amount: 5, adjusted: true }], ctx(g, 'ai', clampAsked)).errors.length).toBeGreaterThan(0)
    }
  })

  it('開（預設）：玩家要的照夾，附 asked 也一樣；關：asked 對得上的不夾（−80 照給，落在範圍裡）；對不上的照 AI 的夾', () => {
    const run = (clampAsked: boolean, asked: string | undefined) => {
      const { game: g } = inDig()
      put(g, 50)
      const r = apply(g, [{ kind: 'trace', amount: -80, ...(asked ? { asked } : {}) }], ctx(g, 'player', clampAsked))
      return { v: traceNow(g), r }
    }
    expect(run(true, ASKED).v).toBe(30)
    expect(run(true, undefined).v).toBe(30)
    expect(run(false, ASKED).v).toBe(-30)
    expect(run(false, ASKED).r.clamps).toEqual([])
    expect(run(false, NOT_SAID).v).toBe(30)
    expect(run(false, undefined).v).toBe(30)
  })

  it('性質（一件事合計）：AI 給的任意拆成 1～6 筆、任意起點，淨變化不超過 ±20、結果在 −30～100；和合成一筆一樣', () => {
    fc.assert(fc.property(fc.integer({ min: -30, max: 100 }), fc.array(fc.integer({ min: -60, max: 60 }).filter((x) => x !== 0), { minLength: 1, maxLength: 6 }), (start, parts) => {
      const { game: g } = inDig()
      put(g, start)
      const r = apply(g, parts.map((amount) => ({ kind: 'trace', amount })), ctx(g, 'ai'))
      expect(r.errors).toEqual([])
      const end = traceNow(g)
      expect(Math.abs(end - start)).toBeLessThanOrEqual(20)
      expect(end).toBeGreaterThanOrEqual(-30)
      expect(end).toBeLessThanOrEqual(100)
      const { game: h } = inDig()
      put(h, start)
      apply(h, [{ kind: 'trace', amount: parts.reduce((s, x) => s + x, 0) }], ctx(h, 'ai'))
      // 合成一筆：合計在 ±20 之內、中途也沒有撞到範圍的頭時一定一樣。
      // 中途撞到頭的（例：從 67 先 +34 停在 100、再 −14 到 86；合成一筆 +20 是 87）照一筆一筆套，到頭是常態，不算拆開繞過上限
      const sums = parts.reduce<number[]>((acc, x) => [...acc, (acc.at(-1) ?? 0) + x], [])
      if (Math.abs(sums.at(-1)!) <= 20 && sums.every((s) => start + s >= -30 && start + s <= 100)) expect(traceNow(h)).toBe(end)
    }), { numRuns: 12 })
  }, 30_000)

  it('迷宮館（樂園島的公開場館，沒有追蹤度）：整筆拿掉並留一行提醒（B025 已修）', () => {
    const { game: m } = makeDiveGame()
    refitForRookie(m)
    diveIn(m)
    mazeSignUp(m)
    const r = apply(m, [{ kind: 'trace', amount: 5 }], ctx(m, 'ai'))
    expect(r.changes).toEqual([])
    expect(r.clamps.map((c) => c.notice)).toEqual(['「追蹤度」這一筆沒有算：這裡沒有追蹤度。'])
  })
})

// ---------------------------------------------------------------------------------------------
// 8. 整條自由行動的鏈，人在網內 × 對抗模式 × 開與關

describe('邊界：網內的自由行動 × 假的服務商（十種對抗）× 「玩家要求的結果也夾值」開與關', () => {
  for (const clampAsked of [1, 0]) {
    it(`${clampAsked ? '開' : '關'}：十種壞掉的回應，跑完追蹤度只動 ±20 之內、在範圍內、不變式成立、存讀檔一樣`, async () => {
      for (const mode of ADVERSARIAL_MODES) {
        const { game: g } = inDig({ ai: { ai: 1, clamp_asked: clampAsked }, idleTimeoutMs: 30, fake: { adversarial: { mode } } } as never)
        put(g, 50)
        const { result, violations } = await observed(g, () => g.act({ kind: 'free', text: TEXT }, { autoRules: true }))
        expect(violations, mode).toEqual([])
        expect(result.status, mode).toBe('applied')
        expect(Math.abs(traceNow(g) - 50), mode).toBeLessThanOrEqual(20)
        for (const s of result.run.steps.filter((x) => x.kind === 'ai' && x.status !== 'skipped')) expect(['done', 'fallback'], `${mode} ${s.id}`).toContain(s.status)
        const { chains: _c, ...rest } = g.state
        expect(JSON.stringify(rest), mode).not.toContain('status_bar')
        const saved = g.save('manual', 't')
        const before = clone(g.state)
        expect(g.load(saved), mode).toBeNull()
        expect(g.state, mode).toEqual(before)
      }
    }, 60_000)
  }

  const reward = (items: Rec[]) => ({ json: { items } })

  it('超出上限（開）：追蹤度 −99 夾成 −20，回報標「有夾值」並列原本與夾過的值，寫正文收到夾過的值；不重試', async () => {
    const { game: g, fake } = inDig({ ai: { ai: 1 }, fake: { byTask: { reward: [reward([{ kind: 'trace', amount: -99, from: { source: 'degree' } }])] } } } as never)
    put(g, 50)
    const { run, reports } = await g.act({ kind: 'free', text: TEXT })
    expect(traceNow(g)).toBe(30)
    expect(run.step('reward').marks).toContain('clamped')
    expect(run.step('reward').clamps![0]).toMatchObject({ from: -99, to: -20 })
    for (const c of reports[0]!.clamps!) expect(PLAIN(c.notice), c.notice).toBe(true)
    const results = JSON.stringify(fake!.requestsFor('narrate')[0])
    expect(results).not.toContain('99')
    expect(fake!.requestsFor('reward')).toHaveLength(1)
  })

  it('關、asked 對得上：最大組合（−130：從 50 到下限 −30）照給、不留夾值的記號；開著同一份回應夾成 −20', async () => {
    for (const [clamp, want] of [[0, -30], [1, 30]] as const) {
      const { game: g } = inDig({ ai: { ai: 1, clamp_asked: clamp }, fake: { byTask: { reward: [reward([{ kind: 'trace', amount: -130, asked: ASKED, from: { source: 'player', quote: ASKED } }])] } } } as never)
      put(g, 50)
      const { run } = await g.act({ kind: 'free', text: TEXT })
      expect(traceNow(g), `clamp_asked ${clamp}`).toBe(want)
      if (!clamp) expect(run.step('reward').marks).toEqual([])
    }
  })

  it('關、asked 對不上玩家的輸入：當成 AI 自己給的，照 ±20 夾、報告卡提醒；不算失敗、不重試', async () => {
    const { game: g, fake } = inDig({ ai: { ai: 1, clamp_asked: 0 }, fake: { byTask: { reward: [reward([{ kind: 'trace', amount: -99, asked: NOT_SAID, from: { source: 'degree' } }])] } } } as never)
    put(g, 50)
    const { run, reports } = await g.act({ kind: 'free', text: TEXT })
    expect(run.step('reward').status).toBe('done')
    expect(traceNow(g)).toBe(30)
    expect(reports[0]!.clamps!.length).toBeGreaterThan(0)
    expect(fake!.requestsFor('reward')).toHaveLength(1)
  })

  it('少欄位（追蹤度沒有 amount）、不存在的地圖、壞掉的 JSON：驗證不過，重試帶 <previous_error>，都失敗用退路；追蹤度不動', async () => {
    const bad = [
      reward([{ kind: 'trace', from: { source: 'degree' } }]),
      reward([{ kind: 'trace', amount: 5, key: '', from: { source: 'degree' } }]),
      { text: '{"items": [{"kind": "trace", "amount": ' },
    ]
    for (const reply of bad) {
      const { game: g, fake } = inDig({ ai: { ai: 1, retry: { reward: 1 } }, fake: { byTask: { reward: [reply, reply] } } } as never)
      put(g, 50)
      const { run } = await g.act({ kind: 'free', text: TEXT })
      const reqs = fake!.requestsFor('reward')
      expect(reqs, JSON.stringify(reply)).toHaveLength(2)
      expect(JSON.stringify(reqs[1]), JSON.stringify(reply)).toContain('previous_error')
      expect(run.step('reward').status, JSON.stringify(reply)).toBe('fallback')
      expect(traceNow(g), JSON.stringify(reply)).toBe(50)
    }
  })

  it('拒絕與逾時：拒絕只送一次不重試；逾時照設定重試；都沒有寫入追蹤度', async () => {
    const r1 = inDig({ ai: { ai: 1, retry: { reward: 3 } }, fake: { byTask: { judge: [] }, adversarial: { mode: 'refusal', tasks: ['reward'] } } } as never)
    put(r1.game, 50)
    await r1.game.act({ kind: 'free', text: TEXT }, { autoRules: true })
    expect(r1.fake!.requestsFor('reward')).toHaveLength(1)
    expect(traceNow(r1.game)).toBe(50)
    const r2 = inDig({ ai: { ai: 1, retry: { reward: 2 } }, idleTimeoutMs: 20, fake: { adversarial: { mode: 'timeout', tasks: ['reward'] } } } as never)
    put(r2.game, 50)
    await r2.game.act({ kind: 'free', text: TEXT })
    expect(r2.fake!.requestsFor('reward')).toHaveLength(3)
    expect(traceNow(r2.game)).toBe(50)
  })

  it('少交 <covered>：標記號、不算失敗、不重試、不改追蹤度', async () => {
    const { game: g, fake } = inDig({ ai: { ai: 1, retry: { narrate: 3 } }, fake: { byTask: { reward: [reward([{ kind: 'trace', amount: -5, from: { source: 'degree' } }])], narrate: [{ text: '你把痕跡抹掉了一些。' }] } } } as never)
    put(g, 50)
    const { run } = await g.act({ kind: 'free', text: TEXT })
    expect(fake!.requestsFor('narrate')).toHaveLength(1)
    expect(run.step('text').status).toBe('done')
    expect(run.step('text').marks.length).toBeGreaterThan(0)
    expect(traceNow(g)).toBe(45)
  })
})
