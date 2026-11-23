// 冒煙 M2 的另一半：假世界（TEST_WORLD）載得進來，而且拿掉任何一個功能，核心與其餘的功能照樣載得起來、照樣玩得動
// （dev/work/M2-smoke.md 第 1 點與驗收條件；dev/adr/0016 第七節：功能之間只透過登錄表與掛鉤）。
//
// 「拿掉一個功能」：沒有人定義的內容種類整個濾掉，引用的東西跟著不見的幾筆也濾掉（testkit 的 worldFor）；其餘的內容照載。
// 下面那張表把每一個功能拿掉時濾掉了什麼寫成資料：新增功能或新增內容種類時，這張表會紅，逼人看一眼有沒有新的跨功能引用。

import { describe, expect, it } from 'vitest'
import { CORE_PACK } from '../../data'
import { Game, createKernel } from '../../src'
import { FEATURES, allFeatures } from '../../src/features'
import { arrive } from '../../src/features/world'
import { latestJob, jobOf } from '../../src/features/fixer'
import { TEST_WORLD, doStep, makeCommissionGame, makeWorldGame, passTime, testWorld, walkAcross, worldFeatures, worldFor } from '../../src/testkit'

/** 拿掉這個功能時，TEST_WORLD 濾掉的內容種類（kinds）與跟著斷掉的幾筆（entries）。沒寫的功能什麼都不濾。 */
const DROPS: Record<string, { kinds: string[]; entries?: string[] }> = {
  enemies: { kinds: ['enemy'] },
  defeat: { kinds: ['defeat_event'] },
  world: { kinds: ['facility_type', 'district', 'block'], entries: ['transit_line/tw_metro', 'shop/s_tw_stall'] },
  transit: { kinds: ['transit_line'] },
  director: { kinds: ['event_scope', 'event'] },
  work: { kinds: ['job'] },
  lewd: { kinds: ['tendency_tag'] },
  npcs: { kinds: ['name_pool', 'npc_gen'] },
  rest: { kinds: ['residence'] },
  trade: { kinds: ['shop_type', 'shop'] },
  commission: { kinds: ['commission'] },
  fixer: { kinds: ['fixer', 'commission_type', 'commission_link'] },
  scene: { kinds: ['position'] },
}

describe('TEST_WORLD：帶著全部功能載入沒有錯', () => {
  it('嚴格模式載入：每一種內容的格式都對、引用都找得到、每個功能的第二段（ready）都過', () => {
    const game = new Game({ features: worldFeatures(), content: [testWorld()], strict: true })
    expect(game.k.content.checkRefs()).toEqual([])
    expect(game.k.pendingReady).toEqual([])
    // 每一種內容種類都有人認得（不然載不進來）；被拿掉功能的那幾種在表裡
    for (const kind of Object.keys(TEST_WORLD.content)) expect(game.k.content.hasKind(kind), kind).toBe(true)
  })

  it('全部功能都在：總表裡每一個功能都裝上了', () => {
    const game = new Game({ features: worldFeatures(), content: [testWorld()], strict: true })
    for (const id of Object.keys(FEATURES)) expect(game.k.features, id).toContain(id)
  })

  it('每一種內容只放驗主幹用得到的最少幾筆；筆數固定（多了要先想過）', () => {
    const count = (kind: string): number => TEST_WORLD.content[kind]?.length ?? 0
    expect(count('district')).toBe(2)
    expect(count('block')).toBe(4) // 三塊街區加一塊橋接區
    expect(TEST_WORLD.content.block!.filter((b) => b.kind === 'bridge')).toHaveLength(1)
    expect(TEST_WORLD.content.transit_line![0]!.stops).toHaveLength(3)
    expect(count('shop')).toBe(1)
    expect(count('item')).toBe(6)
    expect(count('job')).toBe(1)
    expect((TEST_WORLD.content.job![0]!.stages as unknown[]).length).toBe(2)
    expect(count('residence')).toBe(1)
    expect(count('faction')).toBe(2)
    expect(count('npc')).toBe(3)
    expect(count('npc_gen')).toBe(1)
    expect(count('fixer')).toBe(1)
    expect(count('commission_type')).toBe(1)
    expect(count('commission')).toBe(1)
    expect((TEST_WORLD.content.commission![0]!.stages as unknown[]).length).toBe(3)
    expect(count('enemy')).toBe(3)
    expect(count('event')).toBe(2)
    expect(count('defeat_event')).toBe(2)
    expect(count('position')).toBe(3)
  })

  it('每一次拿到的是獨立的一份：改它不會動到下一次拿到的', () => {
    const a = testWorld()
    a.content.item!.length = 0
    expect(testWorld().content.item).toHaveLength(6)
  })

  it('不放規則表（*_rule）：每個功能自己帶一份預設；資料的規則表疊在前面也載得進來（後載入的假世界蓋掉同 id 的規則）', () => {
    expect(Object.keys(TEST_WORLD.content).filter((kind) => kind.endsWith('_rule'))).toEqual([])
    const k = createKernel(worldFeatures())
    const rules = Object.fromEntries(Object.entries(CORE_PACK.content).filter(([kind]) => k.content.isOverridable(kind)))
    const game = new Game({ features: worldFeatures(), content: [{ id: 'core_skill', content: { skill: CORE_PACK.content.skill! } }, { id: 'core_rules', content: rules }, withoutSkills(testWorld())], strict: true })
    expect(game.k.content.checkRefs()).toEqual([])
    // 假世界的 street 事件範圍蓋掉了資料的那一筆（多了 enter_bridge）
    expect(game.k.content.get('event_scope', 'street')!.triggers).toMatchObject({ enter_bridge: 1 })
  })
})

function withoutSkills(pack: ReturnType<typeof testWorld>): ReturnType<typeof testWorld> {
  delete pack.content.skill
  return pack
}

describe('拿掉任何一個功能（逐一試）：核心與其餘的功能照樣載得起來', () => {
  const ids = allFeatures().map((f) => f.id)

  it('逐一試的名單就是功能的總表（新增的功能自動進來）', () => {
    expect(ids.length).toBeGreaterThanOrEqual(28)
    expect(new Set(ids).size).toBe(ids.length)
    expect(Object.keys(DROPS).every((id) => ids.includes(id))).toBe(true)
  })

  it.each(ids)('拿掉 %s：濾掉的內容照表、其餘載得進來、引用沒有斷', (id) => {
    const features = worldFeatures([id])
    const { pack, dropped, droppedEntries } = worldFor(features)
    expect(dropped.sort()).toEqual([...(DROPS[id]?.kinds ?? [])].sort())
    expect(droppedEntries.sort()).toEqual([...(DROPS[id]?.entries ?? [])].sort())
    const game = new Game({ features, content: [pack], strict: true })
    expect(game.k.features).not.toContain(id)
    expect(game.k.content.checkRefs()).toEqual([])
    expect(game.k.pendingReady).toEqual([])
  })

  it.each(ids)('拿掉 %s：照樣開新局、自由行動、回退、存檔讀檔、時間過一個週一', async (id) => {
    // character 是基礎：資料的行動表（climb 的 hint 用 hp 效果）要它；拿掉它時不載資料的規則表
    const t = makeWorldGame({ without: [id], seed: 3, ...(id === 'character' ? { noRules: true } : {}) })
    const { game } = t
    expect(game.k.features).not.toContain(id)
    // 還有世界的話站到街上走一條街（沒有世界就只用核心的位置）
    if (game.k.features.includes('world')) {
      game.commit(arrive(game.k, game.state, 'tw_market', 'E1'))
      const reports = walkAcross(game)
      expect(reports.length).toBeGreaterThan(0)
    }
    expect((await game.act({ kind: 'free', text: '我看看四周' })).status).toBe('applied')
    passTime(game, 8 * 1440, '過了八天。') // 一定跨過一個週一（帳單、每週的消退、導演的 weekly 都有機會跑）
    expect(game.undoSteps(1)).toBe(true)
    passTime(game, 8 * 1440, '過了八天。')
    expect(game.load(game.save('manual', '2026-11-23T00:00:00Z', `without-${id}`))).toBeNull()
  })

  it('沒有拿掉任何功能時濾掉的是空的', () => {
    const { dropped, droppedEntries } = worldFor(worldFeatures())
    expect(dropped).toEqual([])
    expect(droppedEntries).toEqual([])
  })
})

// 副本與中間人只經由登錄表與掛鉤用到這幾個功能（敵對值、人情、親密度與忠誠、歷練點、傾向、導演的觸發點）：沒裝的那一邊「有人註冊才…」的地方照樣跑。
// 逐一拿掉每一個功能再把副本從接案走到入帳，我們試過全部二十八個：除了副本自己需要的（combat 沒有戰鬥的行動、enemies 沒有 enemy_pick、explore 沒有保全崗、
// world 沒有街區、roster 沒有名冊、commission 與 fixer 本身）都走得完、不變式沒有違規；下面挑出接縫最多的五個放進主套件（每個約 0.6 秒；不變式的檢查在 m2.test.ts 做，這裡不重複）。
describe('拿掉接縫另一邊的功能，副本照樣從接案走到入帳', () => {
  it.each(['security', 'favors', 'npcs', 'abilities', 'director'])('拿掉 %s', async (id) => {
    const t = makeCommissionGame({ without: [id] })
    const { game: g, job } = t
    for (const step of ['scout', 'go', 'stage', 'stage', 'stage']) await doStep(g, step)
    expect(latestJob(g.state)).toBeNull()
    expect(jobOf(g.state, job)!.status).toBe('done')
    expect(jobOf(g.state, job)!.payout).toMatchObject({ outcome: 'done' })
    expect(g.k.features).not.toContain(id)
  })
})
