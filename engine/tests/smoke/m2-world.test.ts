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
import { ActionBlocked } from '../../src'
import { go } from '../../src/features/fixer'
import { TEST_NET_ADMIN, NET_PC, TEST_WORLD, doStep, equipParty, makeCommissionGame, makeNetCommissionGame, makeWorldGame, netInventory, passTime, testWorld, walkAcross, worldFeatures, worldFor } from '../../src/testkit'

/** 拿掉這個功能時，TEST_WORLD 濾掉的內容種類（kinds）與跟著斷掉的幾筆（entries）。沒寫的功能什麼都不濾。 */
const DROPS: Record<string, { kinds: string[]; entries?: string[] }> = {
  // M3：構裝的工具與快駭程式的效果（load）是 combat 註冊的；腳本的效果（net.ram）是 netcombat 註冊的——拿掉它們，用到那個效果的幾筆整筆濾掉
  combat: { kinds: [], entries: ['construct/cs_tw_probe', 'quickhack/qh_tw_zap'] },
  netcombat: { kinds: [], entries: ['item/it_tw_script'] },
  netrun: { kinds: ['net_region', 'net_facility'] },
  deck: { kinds: ['deck', 'construct'] },
  hack: { kinds: ['quickhack'] },
  dive: { kinds: ['net_site'] },
  maze: { kinds: ['maze_rule', 'maze_table'] },
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
    expect(count('item')).toBe(8) // 六樣店裡的東西、內海的腳本與迷宮館的獎品晶片
    expect(count('job')).toBe(1)
    expect((TEST_WORLD.content.job![0]!.stages as unknown[]).length).toBe(2)
    expect(count('residence')).toBe(1)
    expect(count('faction')).toBe(2)
    expect(count('npc')).toBe(4) // 三個固定 NPC 加掮客
    expect(count('npc_gen')).toBe(1)
    expect(count('fixer')).toBe(2) // 市場的中間人與桌上有內海委託的掮客
    expect(count('commission_type')).toBe(2) // 暗殺（現實）與竊密（主面內海）
    expect(count('commission_link')).toBe(5)
    expect(count('commission')).toBe(2) // 三階段的辦公室副本與四階段的內海副本
    expect((TEST_WORLD.content.commission![0]!.stages as unknown[]).length).toBe(3)
    expect(count('enemy')).toBe(7) // 野良的三個現實兵種加四種蕾絲
    expect(TEST_WORLD.content.enemy!.filter((e) => e.kind === 'lace' || e.kind === 'program')).toHaveLength(4)
    expect(count('event')).toBe(2)
    expect(count('defeat_event')).toBe(3) // 通用、兩段的、pinned
    expect(count('position')).toBe(3)
    // M3 內海的幾筆（src/testkit/worldNet.ts）
    expect(count('deck')).toBe(2) // II 級甲板、館方租的 I 級
    expect(count('construct')).toBe(7) // 槍、近戰、干擾、防護、工具加新手組的兩件比賽版
    expect(count('quickhack')).toBe(1)
    expect(count('net_region')).toBe(1)
    expect(count('net_facility')).toBe(1)
    expect(count('net_site')).toBe(2)
    expect(count('maze_table')).toBe(2)
    expect(count('facility_type')).toBe(5) // 商店、碼頭、車站、住處、潛艙店
  })

  it('每一次拿到的是獨立的一份：改它不會動到下一次拿到的', () => {
    const a = testWorld()
    a.content.item!.length = 0
    expect(testWorld().content.item).toHaveLength(8)
  })

  it('不放規則表（*_rule），只有一份例外（M3 的迷宮館）：每個功能自己帶一份預設；資料的規則表疊在前面也載得進來（後載入的假世界蓋掉同 id 的規則）', () => {
    // 例外：maze_rule——新手組要用假世界自己的比賽版構裝與甲板（資料的 kit 是空的），所以假世界帶一份小的（組別只有新手組、館方發甲板與構裝、一層一場遭遇）
    expect(Object.keys(TEST_WORLD.content).filter((kind) => kind.endsWith('_rule'))).toEqual(['maze_rule'])
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

// M3：內海的功能逐一拿掉（dev/work/M3-smoke.md 第 6 點）。接縫在登錄表與資料慣例：沒裝的那一邊「有人註冊才…」的地方照樣跑。
describe('拿掉內海的功能（M3）', () => {
  const FOES = [0, 1].map((i) => ({ from: 'enemy_pick', faction: 'f_gang', grade: 1, rank: 'minion', color: 'pink', seed: `s${i}` }))
  const netSetup = { mode: 'net', grade: 1, cover: 'medium', allies: [{ from: 'actor', id: 'pc' }], foes: FOES, origin: { escapable: true, place: '測試用的子網', faction: 'f_gang' } } as never
  const meatSetup = { mode: 'meat', grade: 1, cover: 'medium', allies: [{ from: 'actor', id: 'pc' }], foes: [{ from: 'enemy_pick', faction: 'f_gang', grade: 1, rank: 'minion', seed: 'm' }], origin: { escapable: true, place: '測試用的巷子', faction: 'f_gang' } } as never

  it('拿掉 netrun：現實面的委託照樣從接案走到入帳；主面是內海的委託進不去（寫出原因，委託還在手上）', async () => {
    const t = makeCommissionGame({ without: ['netrun'] })
    const { game: g, job } = t
    for (const step of ['scout', 'go', 'stage', 'stage', 'stage']) await doStep(g, step)
    expect(jobOf(g.state, job)!.status).toBe('done')
    expect(g.k.features).not.toContain('netrun')
    expect(g.k.content.hasKind('net_region')).toBe(false)
    // 沒有人登記 face.net：內海的面選不了，只開內海的階段（隔離區）整件進不去
    const n = makeNetCommissionGame({ without: ['netrun'] })
    expect(() => n.game.commit(go(n.game.k, n.game.state, n.job))).toThrow(ActionBlocked)
    expect(() => n.game.commit(go(n.game.k, n.game.state, n.job))).toThrow(/現在進不去/)
    expect(jobOf(n.game.state, n.job)!.status).toBe('active')
    expect(n.game.k.activity.get('face.net')).toBeUndefined()
  })

  it('拿掉 deck：沒有人有甲板、沒有 RAM、沒有構裝；現實的快駭回到沒有甲板的樣子（單位沒有 ext.deck，也沒有 RAM 那一池）', () => {
    for (const mode of ['net', 'meat'] as const) {
      const { game: g } = makeWorldGame({ without: ['deck'], seed: 5, pc: NET_PC, features: [TEST_NET_ADMIN] })
      g.startBattle(mode === 'net' ? netSetup : meatSetup)
      const u = g.battle!.units.a1!
      expect(u.pools.ram, mode).toBeUndefined()
      expect(u.ext.deck, mode).toBeUndefined()
      expect(mode === 'net' ? u.weapons : [], mode).toEqual([])
      expect(g.k.stats.hasStat('deck_grade')).toBe(false)
    }
    // 對照：裝著 deck 的話，兩個戰場的單位都帶著甲板與 RAM
    const { game: g } = makeWorldGame({ seed: 5, pc: NET_PC, features: [TEST_NET_ADMIN], patch: { inventory: netInventory(1) as never } })
    equipParty(g, ['pc'])
    g.startBattle(meatSetup)
    expect(g.battle!.units.a1!.pools.ram).toBeDefined()
    expect(g.battle!.units.a1!.ext.deck).toMatchObject({ grade: 2, slots: ['qh_tw_zap'] })
  })

  it('拿掉 netcombat：內海戰鬥只剩核心的兩個行動（移動、結束回合）；構裝與 RAM 還在單位身上（那是 deck 的）', () => {
    const { game: g } = makeWorldGame({ without: ['netcombat'], seed: 5, pc: NET_PC, features: [TEST_NET_ADMIN], patch: { inventory: netInventory(1) as never } })
    equipParty(g, ['pc'])
    g.startBattle(netSetup)
    expect(g.battleOptions()!.actions.map((a) => a.id)).toEqual(['move', 'end_turn'])
    expect(g.battle!.units.a1!.pools.ram).toBeDefined()
    expect(g.battle!.units.a1!.weapons.map((w) => w.id)).toEqual(['cs_tw_gun', 'cs_tw_blade', 'cs_tw_jam'])
    // 對照：裝著 netcombat 的內海戰鬥有它的整組行動
    const full = makeWorldGame({ seed: 5, pc: NET_PC, features: [TEST_NET_ADMIN], patch: { inventory: netInventory(1) as never } }).game
    equipParty(full, ['pc'])
    full.startBattle(netSetup)
    expect(full.battleOptions()!.actions.map((a) => a.id)).toEqual(expect.arrayContaining(['net_attack', 'net_refill', 'net_shift', 'net_pin', 'net_jack_out', 'net_surrender', 'adm_wall']))
  })
})
