// abilities 功能的補充測試（驗收測試 M1-abilities.test.ts 沒走到的分支）：掩護射擊（驗收測試沒有涵蓋，這裡補）、
// 連射的壓制（骰面釘死）、指揮與叫人的各種擋、換個位子嘛的錯誤、內容檢查的每一條、學與裝的邊界、單位的資料。

import { describe, expect, it } from 'vitest'
import type { BattleSetup, BattleUnit, ContentPack, Kernel, Report } from '../../src'
import { createKernel, readyFeatures } from '../../src'
import { TREE_XP, abilitiesFeature, abilitiesOf, capacityOf, equipAbilities, learn, learnBlock, treeTier } from '../../src/features/abilities'
import { TEST_ACTIONS, TEST_COMBAT, makeBattleGame, makeGame } from '../../src/testkit'
import { TEST_STATUSES, arena, duel, foe, one } from '../helpers/battle'

const sk = (id: string, name: string, path: string, tier: number, kind: string, cap: number, more: Record<string, unknown>) => ({
  id, name, path, category: path === 'gunner' ? 'meat' : 'social', tier, layer: 'front', kind, cap, xp: tier * 20, cells: 1, text: `${name}。`, net: null, opinion: null, meat: null, ...more,
})
const PATHS = [
  { id: 'gunner', name: '槍手', tree: '戰鬥直覺', category: 'meat', signature: 'sk_gunner_instinct', domains: { meat: 'strong', net: 'none', opinion: 'none' }, resonance: [] },
  { id: 'fixer', name: '掮客', tree: '人面', category: 'social', signature: 'sk_fixer_face', domains: { meat: 'strong_support', net: 'mid', opinion: 'mid' }, resonance: [] },
]
const ABILITIES = [
  sk('sk_gunner_instinct', '戰鬥直覺', 'gunner', 1, 'passive', 3, { layer: 'signature', meat: { instinct: true } }),
  sk('sk_gunner_cover_fire', '掩護射擊', 'gunner', 1, 'reaction', 1, { after: 'sk_gunner_instinct', use: { ap: 2, per_turn: 1 }, meat: { trigger: 'ally_attacked_adjacent', attack: { at: 'attacker' }, on_hit: { hit_against_ally: -2 } } }),
  sk('sk_gunner_burst', '連射控制', 'gunner', 1, 'active', 1, { after: 'sk_gunner_instinct', use: { ap: 3 }, meat: { target: 'enemy', attack: { spend: 'all', min_mag: 2, dice: 'spent_minus_1', suppress: { dc: 'spent', skill: 'composure' } } } }),
  sk('sk_gunner_pending', '還沒做的', 'gunner', 1, 'active', 1, { after: 'sk_gunner_instinct', use: { ap: 1 }, meat: { pending: true } }),
  sk('sk_gunner_point_shot', '定點射', 'gunner', 2, 'passive', 3, { after: 'sk_gunner_instinct', meat: { cost: { ability: 'sk_gunner_burst', ap: 2, per_turn: 1 }, weapon_cost: { trait: 'aimed', ap: 2, per_turn: 1 } } }),
  sk('sk_gunner_sights', '瞄具', 'gunner', 2, 'passive', 1, { after: 'sk_gunner_instinct', meat: { weapon_cost: { trait: 'long', ap: 1 } } }),
  sk('sk_fixer_face', '人面', 'fixer', 1, 'passive', 3, { layer: 'signature', meat: { give_ap: { max: 'one_plus_half_tier' }, call: { options: ['shot', 'cover_up', 'cover_down'], per_fight: 'half_tier_up', ap: 1 } } }),
  sk('sk_fixer_swap', '換個位子嘛', 'fixer', 1, 'active', 1, { after: 'sk_fixer_face', use: { ap: 1 }, meat: { target: 'ally', free_move: { swap_adjacent_pair: true } } }),
  sk('sk_fixer_watch_out', '小心後面！', 'fixer', 1, 'reaction', 1, { after: 'sk_fixer_face', use: { ap: 1, per_turn: 1 }, meat: { trigger: 'ally_attacked', evade: 3 } }),
]
const PACK: ContentPack = { id: 'abilities_edge', content: { battle_status: TEST_STATUSES, path: PATHS, ability: ABILITIES } }
const FEATURES = [abilitiesFeature, TEST_COMBAT]
const equipped = (...ids: string[]) => ({ ext: { abilities: { equipped: ids, tiers: { gunner: 2, fixer: 2 } } } })

/** 不經過提交的戰鬥：kernel 載入內容、跑完 ready。 */
const field = (setup: BattleSetup) => arena(setup, FEATURES, (k) => {
  k.content.loadPack(PACK)
  readyFeatures(k)
})

describe('掩護射擊：反應掛在攻擊之前（SKILL_TREES 槍手 1 階）', () => {
  // a1 是掩護的人（站第 1 格），a2 是被打的隊友（第 2 格，相鄰）；f1 是攻擊的敵人。
  const duo = (extra: Parameters<typeof one>[0] = {}) => field(duel([one({ weapon: 'pistol', ...equipped('sk_gunner_cover_fire'), ...extra }), one({ weapon: 'smg' }, 2)], [foe('minion', { weapon: 'pistol' })]))
  const rollBeats = (run: ReturnType<ReturnType<typeof field>['run']>) => run.beats.filter((b) => b.roll)

  it('隊友被攻擊時先朝攻擊者射擊：花 2 點與彈匣 1 格；這一槍命中，原本那次攻擊的命中 −2', () => {
    const a = duo()
    const run = a.run([10, 3, 3, 3, 12, 2, 2, 2])
    const hpBefore = a.foe(1).hp!.now
    run.attack(a.foe(1), a.ally(2))
    expect(a.ally(1)).toMatchObject({ ap: { now: a.ally(1).ap.max - 2 }, weapons: [{ mag: { now: 1 } }], uses: { 'turn:sk_gunner_cover_fire': 1 } })
    const [shot, orig] = rollBeats(run)
    expect(shot!.data).toMatchObject({ attacker: 'a1', target: 'f1' })
    expect(shot!.roll!.natural).toBe(10)
    expect(orig!.data).toMatchObject({ attacker: 'f1', target: 'a2' })
    expect(orig!.roll!.parts).toContainEqual(expect.objectContaining({ value: -2 }))
    expect(a.foe(1).hp!.now).toBeLessThan(hpBefore) // 這一槍照常造成傷害
    expect(run.beats.some((b) => b.tag === 'skill' && b.data?.ability === 'sk_gunner_cover_fire')).toBe(true)
    // 反應排在原本那次攻擊的前面
    expect(run.beats.findIndex((b) => b.tag === 'skill')).toBeLessThan(run.beats.findIndex((b) => b.data?.attacker === 'f1'))
  })

  it('這一槍沒命中：原本那次攻擊不變，但行動點與彈匣照花', () => {
    const a = duo()
    const run = a.run([2, 3, 3, 3, 12, 2, 2, 2])
    run.attack(a.foe(1), a.ally(2))
    const [shot, orig] = rollBeats(run)
    expect(shot!.roll!.degree).not.toBe('success')
    expect(orig!.roll!.parts.some((p) => p.value === -2)).toBe(false)
    expect(a.ally(1)).toMatchObject({ ap: { now: a.ally(1).ap.max - 2 }, weapons: [{ mag: { now: 1 } }] })
  })

  it('每回合一次；到他自己的下一回合（turn: 開頭的次數被清掉）又能觸發', () => {
    const a = duo()
    a.run([10, 3, 3, 3, 12, 2, 2, 2]).attack(a.foe(1), a.ally(2))
    const run = a.run([12, 2, 2, 2])
    run.attack(a.foe(1), a.ally(2))
    expect(rollBeats(run)).toHaveLength(1) // 只有原本那一次
    expect(a.ally(1).ap.now).toBe(a.ally(1).ap.max - 2)
    delete a.ally(1).uses['turn:sk_gunner_cover_fire']
    const again = a.run([10, 3, 3, 3, 12, 2, 2, 2])
    again.attack(a.foe(1), a.ally(2))
    expect(rollBeats(again)).toHaveLength(2)
    expect(a.ally(1).weapons[0]!.mag!.now).toBe(0)
  })

  it('不觸發：不相鄰、被打的是自己、行動點不夠、彈匣空了、拿著近戰武器、沒裝', () => {
    const far = field(duel([one({ weapon: 'pistol', ...equipped('sk_gunner_cover_fire') }), one({}, 2), one({ weapon: 'smg' }, 3)], [foe('minion', { weapon: 'pistol' })]))
    const r1 = far.run([12, 2, 2, 2])
    r1.attack(far.foe(1), far.ally(3)) // a1 在第 1 格、a3 在第 3 格：差 2
    expect(rollBeats(r1)).toHaveLength(1)

    const me = duo()
    const r2 = me.run([12, 2, 2, 2])
    r2.attack(me.foe(1), me.ally(1)) // 被打的就是掩護的人
    expect(rollBeats(r2)).toHaveLength(1)
    expect(me.ally(1).ap.now).toBe(me.ally(1).ap.max)

    const tired = duo()
    tired.ally(1).ap.now = 1
    const r3 = tired.run([12, 2, 2, 2])
    r3.attack(tired.foe(1), tired.ally(2))
    expect(rollBeats(r3)).toHaveLength(1)
    expect(tired.ally(1).ap.now).toBe(1)

    const empty = duo()
    empty.ally(1).weapons[0]!.mag!.now = 0
    const r4 = empty.run([12, 2, 2, 2])
    r4.attack(empty.foe(1), empty.ally(2))
    expect(rollBeats(r4)).toHaveLength(1)
    expect(empty.ally(1).ap.now).toBe(empty.ally(1).ap.max) // 沒有子彈就不觸發，也不花行動點

    const knife = duo({ weapon: 'knife' })
    const r5 = knife.run([12, 2, 2, 2])
    r5.attack(knife.foe(1), knife.ally(2))
    expect(rollBeats(r5)).toHaveLength(1)

    const plain = field(duel([one({ weapon: 'pistol' }), one({ weapon: 'smg' }, 2)], [foe('minion', { weapon: 'pistol' })]))
    const r6 = plain.run([12, 2, 2, 2])
    r6.attack(plain.foe(1), plain.ally(2))
    expect(rollBeats(r6)).toHaveLength(1)
  })

  it('反應的那一槍（tags 有 reaction）不再觸發別人的反應', () => {
    // 敵方也有一個相鄰的人裝著掩護射擊：我方的掩護射擊打 f1 時，f2 不會再反應
    const a = field(duel(
      [one({ weapon: 'pistol', ...equipped('sk_gunner_cover_fire') }), one({ weapon: 'smg' }, 2)],
      [foe('minion', { weapon: 'pistol' }), foe('minion', { weapon: 'pistol', ...equipped('sk_gunner_cover_fire') })],
    ))
    const run = a.run([10, 3, 3, 3, 12, 2, 2, 2])
    run.attack(a.foe(1), a.ally(2))
    expect(rollBeats(run)).toHaveLength(2)
    expect(a.foe(2).ap.now).toBe(a.foe(2).ap.max)
    // 一般的攻擊（沒有 reaction 標籤）照樣會觸發敵方的反應
    const b = field(duel(
      [one({ weapon: 'pistol' }), one({ weapon: 'smg' }, 2)],
      [foe('minion', { weapon: 'pistol' }), foe('minion', { weapon: 'pistol', ...equipped('sk_gunner_cover_fire') })],
    ))
    const run2 = b.run([10, 3, 3, 3, 12, 2, 2, 2])
    run2.attack(b.ally(1), b.foe(1))
    expect(b.foe(2).ap.now).toBe(b.foe(2).ap.max - 2)
  })

  it('這一槍把攻擊者打倒了：原本那次攻擊不發生', () => {
    const a = duo()
    a.foe(1).hp!.now = 1
    const run = a.run([10, 3, 3, 3])
    const hp = a.ally(2).hp!.now
    const r = run.attack(a.foe(1), a.ally(2))
    expect(r.aborted).toBe(true)
    expect(a.foe(1).out).toBe('down')
    expect(a.ally(2).hp!.now).toBe(hp)
    expect(rollBeats(run)).toHaveLength(1)
  })

  it('小心後面！（沒有 attack 的反應）：迴避 +3，不需要槍', () => {
    const a = field(duel([one({ weapon: 'knife', ...equipped('sk_fixer_watch_out') }), one({ weapon: 'smg' }, 2)], [foe('minion', { weapon: 'pistol' })]))
    const run = a.run([12, 2, 2, 2])
    run.attack(a.foe(1), a.ally(2))
    expect(rollBeats(run)[0]!.roll!.dc).toBe(a.ally(2).evade + 3)
    expect(a.ally(1).ap.now).toBe(a.ally(1).ap.max - 1)
  })
})

describe('連射的壓制（骰面釘死）', () => {
  const burst = (fixed: number[]) => {
    const a = field(duel([one({ weapon: 'rifle', ...equipped('sk_gunner_burst') })], [foe('boss', { skills: { composure: -40 } })]))
    const def = a.k.battle.getAction('sk_gunner_burst')!
    const run = a.run(fixed)
    a.ally(1).ap.now -= 3
    def.run(run, a.ally(1), { unit: 'f1' }, { action: 'sk_gunner_burst', target: { unit: 'f1' } })
    return { a, run }
  }

  it('定力沒過：被壓制；DC 是 10 ＋ 花掉的格數 × 2，傷害骰多「格數 − 1」顆', () => {
    // 步槍彈匣 3 格：命中 d20 ＋ 傷害骰 4 ＋ 2 顆 = 6 顆 d6，再來定力 d20
    const { a, run } = burst([10, 1, 1, 1, 1, 1, 1, 5])
    expect(run.beats.filter((b) => b.roll).at(-1)!.roll).toMatchObject({ dc: 16, skill: 'composure', natural: 5 })
    expect(a.foe(1).statuses.map((s) => s.id)).toContain('suppressed')
    expect(a.ally(1).weapons[0]!.mag!.now).toBe(0)
  })

  it('定力自然 20 一定過（CORE_RULES 3 節），不被壓制', () => {
    const { a } = burst([10, 1, 1, 1, 1, 1, 1, 20])
    expect(a.foe(1).statuses.map((s) => s.id)).not.toContain('suppressed')
  })

  it('不管有沒有打中都要過定力；目標被打倒就不擲', () => {
    const miss = burst([2, 1, 1, 1, 1, 1, 1, 5])
    expect(miss.run.beats.filter((b) => b.roll)).toHaveLength(2)
    expect(miss.a.foe(1).statuses.map((s) => s.id)).toContain('suppressed')

    const a = field(duel([one({ weapon: 'pistol', ...equipped('sk_gunner_burst') })], [foe('elite')]))
    a.foe(1).hp!.now = 1
    const run = a.run([10, 6, 6, 6, 6])
    a.k.battle.getAction('sk_gunner_burst')!.run(run, a.ally(1), { unit: 'f1' }, { action: 'sk_gunner_burst', target: { unit: 'f1' } })
    expect(a.foe(1).out).toBe('down')
    expect(run.beats.filter((b) => b.roll)).toHaveLength(1)
  })
})

describe('行動的條件與錯誤', () => {
  const game = (allies: unknown[], foes: unknown[] = [foe('elite')], more: Partial<BattleSetup> = {}, seed = 7) => makeBattleGame({ features: FEATURES, content: [PACK], battle: duel(allies, foes, { ally: [1, 1, 1, 1], foe: [0, 0, 0, 0] }, more), seed }).game
  type G = ReturnType<typeof game>
  const turnTo = (g: G, id: string): BattleUnit => {
    const b = g.state.battle!
    b.turn = b.order.indexOf(id)
    const u = b.units[id]!
    u.ap.now = u.ap.max
    u.control = 'player'
    return u
  }
  const opt = (g: G, id: string) => g.battleOptions()!.actions.find((a) => a.id === id)

  it('pending 的技能不註冊行動；近戰武器與空彈匣有各自的原因', () => {
    const g = game([one({ weapon: 'knife', ...equipped('sk_gunner_burst', 'sk_gunner_pending') }), one({ weapon: 'rifle' }, 2)])
    turnTo(g, 'a1')
    expect(opt(g, 'sk_gunner_pending')).toBeUndefined()
    expect(g.k.battle.getAction('sk_gunner_pending')).toBeUndefined()
    expect(opt(g, 'sk_gunner_burst')!.blocks).toEqual(['要拿著槍才能用。'])
    const h = game([one({ weapon: 'pistol', ...equipped('sk_gunner_burst') })])
    turnTo(h, 'a1')
    expect(opt(h, 'sk_gunner_burst')!.blocks).toEqual([]) // 手槍彈匣 2 格，剛好
    h.state.battle!.units.a1!.weapons[0]!.mag!.now = 1
    expect(opt(h, 'sk_gunner_burst')!.blocks).toEqual(['彈匣裡要有 2 格以上才能連射。'])
  })

  it('空彈匣、沒有 min_mag 的技能：彈匣空了，要先換彈', () => {
    const ab = [...ABILITIES, sk('sk_gunner_snap', '快槍', 'gunner', 1, 'active', 1, { after: 'sk_gunner_instinct', use: { ap: 1 }, meat: { target: 'enemy', attack: {} } })]
    const g = makeBattleGame({ features: FEATURES, content: [{ id: 'snap', content: { ...PACK.content, ability: ab } }], battle: duel([one({ weapon: 'pistol', ...equipped('sk_gunner_snap') })], [foe('elite')]), seed: 7 }).game
    turnTo(g, 'a1')
    g.state.battle!.units.a1!.weapons[0]!.mag!.now = 0
    expect(opt(g, 'sk_gunner_snap')!.blocks).toEqual(['彈匣空了，要先換彈。'])
  })

  it('指揮：讓給的是自己的行動點；自己不能是目標；沒有人能讓時灰掉', () => {
    const g = game([one({ weapon: 'pistol', ...equipped('sk_fixer_face') }), one({ weapon: 'rifle' }, 2)])
    turnTo(g, 'a1')
    expect(opt(g, 'sk_fixer_face.give_ap')!.targets.map((t) => t.target)).toEqual([{ unit: 'a2' }])
    const solo = game([one({ weapon: 'pistol', ...equipped('sk_fixer_face') })])
    turnTo(solo, 'a1')
    expect(opt(solo, 'sk_fixer_face.give_ap')).toMatchObject({ ok: false, blocks: ['沒有可以選的目標。'] })
  })

  it('叫人：補遮蔽、拆遮蔽、支援射擊各自的目標檢查；選項不對、目標對不上都擋下', () => {
    const g = game([one({ weapon: 'pistol', ...equipped('sk_fixer_face') })], [foe('elite'), foe('minion')], { cover: { ally: [0, 0, 0, 0], foe: [0, 1, 0, 0] } })
    turnTo(g, 'a1')
    const ids = { cu: 'sk_fixer_face.call' }
    // 目標對不上
    expect(g.battleAct({ action: ids.cu, target: { side: 'foe', slot: 1 }, pick: { option: 'cover_up' } })).toMatchObject({ status: 'refused' })
    // 敵方第 1 格沒有遮蔽：這個目標本身就選不了（核心照行動列的目標擋，原因寫出來）
    expect(g.battleAct({ action: ids.cu, target: { side: 'foe', slot: 1 }, pick: { option: 'cover_down' } })).toMatchObject({ status: 'refused', reasons: ['這一格沒有遮蔽可以拆。'] })
    // 有遮蔽的格、選的卻是補遮蔽：行動自己擋
    expect(g.battleAct({ action: ids.cu, target: { side: 'foe', slot: 2 }, pick: { option: 'cover_up' } })).toMatchObject({ status: 'refused', reasons: ['叫人要選一件事：補遮蔽、拆遮蔽，或支援射擊。'] })
    // 不在場上的單位 id：不是當掉，是擋下（核心照行動列的目標驗）
    expect(g.battleAct({ action: ids.cu, target: { unit: 'f9' }, pick: { option: 'shot' } })).toMatchObject({ status: 'refused', reasons: ['這個目標不能選。'] })
    expect(g.battleAct({ action: ids.cu, target: { side: 'ally', slot: 1 }, pick: { option: 'shot' } })).toMatchObject({ status: 'refused' })
    expect(g.battleAct({ action: ids.cu, target: { unit: 'a1' }, pick: { option: 'shot' } })).toMatchObject({ status: 'refused' })
    // 選項不在清單裡、沒有選項、沒有目標
    expect(g.battleAct({ action: ids.cu, target: { side: 'ally', slot: 1 }, pick: { option: 'summon' } })).toMatchObject({ status: 'refused' })
    expect(g.battleAct({ action: ids.cu, target: { side: 'ally', slot: 1 } })).toMatchObject({ status: 'refused' })
    expect(g.battleAct({ action: ids.cu, pick: { option: 'cover_up' } })).toMatchObject({ status: 'refused' })
    expect(g.battle!.units.a1!.uses[ids.cu]).toBeUndefined() // 被擋下的不算次數、不花行動點
    expect(g.battle!.units.a1!.ap.now).toBe(g.battle!.units.a1!.ap.max)
    // 拆遮蔽：敵方第 2 格有半掩體
    expect(g.battleAct({ action: ids.cu, target: { side: 'foe', slot: 2 }, pick: { option: 'cover_down' } }).status).toBe('applied')
    expect(g.battle!.cover.foe[1]!.level).toBe(0)
  })

  it('叫人的支援射擊：d20 ＋ 4 ＋ 等級 × 2 對迴避；打中造成 3 顆 d6（I 級）的物理傷害（要害多一顆；細節在 M1-review-fix.test.ts）', () => {
    const a = field(duel([one({ weapon: 'pistol', ...equipped('sk_fixer_face') })], [foe('elite')]))
    const def = a.k.battle.getAction('sk_fixer_face.call')!
    const hp = a.foe(1).hp!.now
    const run = a.run([13, 6, 6, 6, 6]) // 13 + 4 + 2 = 19 對迴避 10：高 9，是要害，要 4 顆
    def.run(run, a.ally(1), null, { action: def.id, target: { unit: 'f1' }, pick: { option: 'shot' } })
    expect(a.foe(1).hp!.now).toBe(hp - Math.max(0, 24 - a.foe(1).armor))
    const beat = run.beats.find((b) => b.tag === 'crit')!
    expect(beat.roll).toMatchObject({ natural: 13, total: 19, dc: a.foe(1).evade })
    expect(run.beats.find((b) => b.tag === 'support')!.data).toMatchObject({ unit: 'a1', option: 'shot' })
    // 沒打中：不扣血
    const b = field(duel([one({ weapon: 'pistol', ...equipped('sk_fixer_face') })], [foe('elite')]))
    const run2 = b.run([1, 6, 6, 6])
    b.k.battle.getAction('sk_fixer_face.call')!.run(run2, b.ally(1), null, { action: def.id, target: { unit: 'f1' }, pick: { option: 'shot' } })
    expect(b.foe(1).hp!.now).toBe(hp)
  })

  it('換個位子嘛：另一個人要是相鄰的隊友，否則擋下並說明；技能不花他們的行動點', () => {
    const g = game([one({ weapon: 'pistol', ...equipped('sk_fixer_swap') }), one({ weapon: 'rifle' }, 2), one({ weapon: 'smg' }, 3), one({ weapon: 'pistol' }, 4)])
    turnTo(g, 'a1')
    const why = ['要選兩名相鄰的隊友。']
    expect(g.battleAct({ action: 'sk_fixer_swap', target: { unit: 'a2' }, pick: { with: 'a4' } })).toMatchObject({ status: 'refused', reasons: why }) // 差 2 格
    expect(g.battleAct({ action: 'sk_fixer_swap', target: { unit: 'a2' } })).toMatchObject({ status: 'refused', reasons: why })
    expect(g.battleAct({ action: 'sk_fixer_swap', target: { unit: 'a2' }, pick: { with: 'f1' } })).toMatchObject({ status: 'refused', reasons: why })
    expect(g.battleAct({ action: 'sk_fixer_swap', target: { unit: 'a2' }, pick: { with: 'a1' } })).toMatchObject({ status: 'refused', reasons: why }) // 不是自己
    expect(g.battleAct({ action: 'sk_fixer_swap', target: { unit: 'a2' }, pick: { with: 'a2' } })).toMatchObject({ status: 'refused', reasons: why })
    expect(g.battle!.units.a1!.ap.now).toBe(g.battle!.units.a1!.ap.max)
    expect(g.battleAct({ action: 'sk_fixer_swap', target: { unit: 'a3' }, pick: { with: 'a4' } }).status).toBe('applied')
    expect(g.battle!.units).toMatchObject({ a3: { slot: 4 }, a4: { slot: 3 } })
  })

  it('每場第一次換位不花行動點只算輪到的人自己換的；別人替他換位不用掉', () => {
    const PATH2 = { ...PATHS[0]!, resonance: [{ tier: 2, cells: 1, text: '每場戰鬥你第一次換位不花行動點。', effect: { free_move: { per_fight: 1 } } }] }
    const g = makeBattleGame({ features: FEATURES, content: [{ id: 'free', content: { ...PACK.content, path: [PATH2, PATHS[1]!] } }], battle: duel([one({ weapon: 'pistol', ...equipped('sk_gunner_instinct', 'sk_fixer_face') }), one({ weapon: 'rifle', ...equipped('sk_gunner_instinct') }, 2), one({ weapon: 'smg' }, 3)], [foe('elite')]), seed: 7 }).game
    turnTo(g, 'a1')
    // a1 裝著換個位子嘛的話才能替人換位；這裡直接用核心的換位，另一個單位的共鳴不受影響
    expect(opt(g, 'move')!.cost.ap).toBe(0)
    g.state.battle!.units.a2!.uses.free_move = 1
    turnTo(g, 'a2')
    expect(opt(g, 'move')!.cost.ap).toBe(1) // a2 這一場已經用過
    // 階數不到 2 的人沒有這條共鳴
    g.state.battle!.units.a1!.ext.abilities = { equipped: ['sk_gunner_instinct'], tiers: { gunner: 1 } }
    turnTo(g, 'a1')
    expect(opt(g, 'move')!.cost.ap).toBe(1)
  })
})

describe('單位的資料與開場的效果', () => {
  /** 把回合轉到某個人、行動點補滿，看他那個行動現在要花幾點。 */
  const apOf = (g: ReturnType<typeof makeBattleGame>['game'], id: string, action: string): number => {
    const b = g.state.battle!
    b.turn = b.order.indexOf(id)
    b.units[id]!.ap.now = b.units[id]!.ap.max
    b.units[id]!.control = 'player'
    return g.battleOptions()!.actions.find((a) => a.id === action)!.cost.ap
  }

  it('weapon_cost 是花費的修正：用帶那個特性的武器攻擊一次改花指定的行動點；武器本身不被改；已經有資料的單位不被覆寫', () => {
    const g = makeBattleGame({ features: FEATURES, content: [PACK], battle: duel([one({ weapon: 'sniper', ...equipped('sk_gunner_sights') }), one({ weapon: 'rifle', ...equipped('sk_gunner_sights') }, 2), one({ weapon: 'sniper' }, 3)], [foe('elite')]), seed: 7 }).game
    expect(apOf(g, 'a1', TEST_ACTIONS.ATTACK)).toBe(1) // 狙擊槍帶 long：3 點改成 1 點
    expect(apOf(g, 'a2', TEST_ACTIONS.ATTACK)).toBe(1) // 步槍也帶 long：2 點改成 1 點
    expect(apOf(g, 'a3', TEST_ACTIONS.ATTACK)).toBe(3) // 沒裝的人不變
    // 不帶 weapon_attack 標籤的行動（換彈）不受影響
    g.state.battle!.units.a1!.weapons[0]!.mag!.now = 0
    expect(apOf(g, 'a1', TEST_ACTIONS.RELOAD)).toBe(1)
    const u = g.battle!.units
    // 武器的 ap 沒有被動過：狙擊槍還是寫 3，步槍還是沒寫（dev/adr/0014）
    expect([u.a1!.weapons[0]!.ap, u.a2!.weapons[0]!.ap, u.a3!.weapons[0]!.ap]).toEqual([3, undefined, 3])
    expect(u.a1!.ext.abilities).toEqual({ equipped: ['sk_gunner_sights'], tiers: { gunner: 2, fixer: 2 } })
  })

  it('每回合第幾次的 weapon_cost：不改武器、不在 uses 裡記原價；用掉幾次只記在 turn:<技能>.discount，下一回合由核心清掉', () => {
    const g = makeBattleGame({ features: FEATURES, content: [PACK], battle: duel([one({ weapon: 'sniper', ...equipped('sk_gunner_point_shot') }), one({ weapon: 'rifle', ...equipped('sk_gunner_point_shot') }, 2)], [foe('boss')]), seed: 7 }).game
    const u = () => g.battle!.units
    expect(apOf(g, 'a1', TEST_ACTIONS.ATTACK)).toBe(2) // 狙擊槍帶 aimed：這回合的第一槍 3 點變 2 點
    expect(apOf(g, 'a2', TEST_ACTIONS.ATTACK)).toBe(2) // 步槍沒有 aimed：本來就是 2 點
    expect(u().a1!.weapons[0]!.ap).toBe(3)
    expect(u().a2!.weapons[0]!.ap).toBeUndefined()
    expect(Object.keys(u().a1!.uses).filter((key) => key.startsWith('wbase'))).toEqual([])
    apOf(g, 'a1', TEST_ACTIONS.ATTACK)
    expect(g.battleAct({ action: TEST_ACTIONS.ATTACK, target: { unit: 'f1' } }).status).toBe('applied')
    expect(u().a1!.uses['turn:sk_gunner_point_shot.discount']).toBe(1)
    expect(u().a1!.weapons[0]!.ap).toBe(3)
    // 步槍那一槍沒有比較便宜（2 點對 2 點）：不算用掉
    apOf(g, 'a2', TEST_ACTIONS.ATTACK)
    expect(g.battleAct({ action: TEST_ACTIONS.ATTACK, target: { unit: 'f1' } }).status).toBe('applied')
    expect(u().a2!.uses['turn:sk_gunner_point_shot.discount']).toBeUndefined()
  })

  it('有角色的單位：照開打那一刻的 equipped 與 spent；沒裝東西的角色得到空的資料；沒有角色的單位不填', () => {
    const t = makeGame({ features: FEATURES, content: [PACK], pc: { ext: { abilities: { xp: 0, learned: [], equipped: [], spent: { gunner: 130, fixer: 39 } } } } })
    t.game.startBattle({ mode: 'meat', grade: 1, cover: 'medium', allies: [{ from: 'actor', id: 'pc' }, { from: 'unit', unit: one({}, 2) as unknown as Record<string, unknown> }], foes: [{ from: 'unit', unit: foe('minion') as unknown as Record<string, unknown> }] })
    const u = t.game.battle!.units
    expect(u.a1!.ext.abilities).toEqual({ equipped: [], tiers: { gunner: 3, fixer: 1 } })
    expect(u.a2!.ext.abilities).toBeUndefined()
    expect(u.f1!.ext.abilities).toBeUndefined()
  })
})

describe('學與裝的邊界', () => {
  const state = (xp: number, extra: Record<string, unknown> = {}) => makeGame({ features: FEATURES, content: [PACK], pc: { ext: { bridge: { capacity: { meat: 4, net: 0, social: 4, media: 0 } }, abilities: { xp, learned: [], equipped: [], spent: {}, ...extra } } } }).game

  it('樹的階：累計 39 還是 1 階、40 是 2 階、120 是 3 階、240 是 4 階、400 是 5 階', () => {
    const g = state(0)
    const at = (n: number) => { g.state.actors.pc!.ext.abilities = { xp: 0, learned: [], equipped: [], spent: { gunner: n } }; return treeTier(g.k, g.state, 'pc', 'gunner') }
    expect([0, 39, 40, 119, 120, 239, 240, 399, 400, 9999].map(at)).toEqual([1, 1, 2, 2, 3, 3, 4, 4, 5, 5])
    expect(TREE_XP).toEqual([0, 40, 120, 240, 400])
  })

  it('沒有技能資料的角色：abilitiesOf 回傳空的；沒有的人也一樣；學的第一個技能才開始記', () => {
    const g = makeGame({ features: FEATURES, content: [PACK] }).game
    expect(abilitiesOf(g.state, 'pc')).toEqual({ xp: 0, learned: [], equipped: [], spent: {} })
    expect(abilitiesOf(g.state, 'nobody')).toEqual({ xp: 0, learned: [], equipped: [], spent: {} })
    expect(learnBlock(g.k, g.state, 'pc', 'sk_gunner_instinct')).toBe('歷練點不夠（要 20 點，現在 0 點）。')
    expect(() => learn(g.k, g.state, 'pc', 'sk_gunner_instinct')).toThrow('歷練點不夠（要 20 點，現在 0 點）。')
  })

  it('學的報告：一筆 actor.ext 變更、不花時間；不能學就丟錯、狀態不變', () => {
    const g = state(100)
    const before = g.state.time
    const [r] = g.commit(learn(g.k, g.state, 'pc', 'sk_gunner_instinct')) as [Report]
    expect(r).toMatchObject({ kind: 'action', action: 'ability.learn', actor: 'pc' })
    expect(r.changes).toHaveLength(1)
    expect(r.changes[0]).toMatchObject({ op: 'actor.ext', id: 'pc', key: 'abilities' })
    expect(g.state.time).toEqual(before)
    expect(() => learn(g.k, g.state, 'pc', 'sk_gunner_instinct')).toThrow('已經學會了。')
    expect(abilitiesOf(g.state, 'pc').xp).toBe(80)
  })

  it('檢查的順序：沒有這個技能 → 已學會 → 樹的階 → 前置 → 歷練點', () => {
    // 2 階的瞄具：階數不夠時先說階數，前置也沒學也一樣先說階數
    const g = state(0)
    expect(learnBlock(g.k, g.state, 'pc', 'sk_gunner_sights')).toBe('槍手這棵樹還沒開到 2 階（要在這棵樹累計花 40 點，現在 0 點）。')
    // 階數夠、前置沒學：先說前置，不說歷練點
    g.state.actors.pc!.ext.abilities = { xp: 0, learned: [], equipped: [], spent: { gunner: 40 } }
    expect(learnBlock(g.k, g.state, 'pc', 'sk_gunner_sights')).toBe('要先學會戰鬥直覺。')
    g.state.actors.pc!.ext.abilities = { xp: 0, learned: ['sk_gunner_instinct'], equipped: [], spent: { gunner: 40 } }
    expect(learnBlock(g.k, g.state, 'pc', 'sk_gunner_sights')).toBe('歷練點不夠（要 40 點，現在 0 點）。')
    g.state.actors.pc!.ext.abilities = { xp: 40, learned: ['sk_gunner_instinct'], equipped: [], spent: { gunner: 40 } }
    expect(learnBlock(g.k, g.state, 'pc', 'sk_gunner_sights')).toBeNull()
  })

  it('裝：整份換掉；重複的 id 只算一次；容量沒有的那一類（橋沒有）裝不下；沒學與不存在的技能擋下且不動狀態', () => {
    const g = state(0, { learned: ['sk_gunner_instinct', 'sk_gunner_burst', 'sk_gunner_cover_fire', 'sk_fixer_face'], equipped: ['sk_gunner_burst'] })
    g.commit(equipAbilities(g.k, g.state, 'pc', ['sk_gunner_instinct', 'sk_gunner_instinct']))
    expect(abilitiesOf(g.state, 'pc').equipped).toEqual(['sk_gunner_instinct'])
    expect(capacityOf(g.k, g.state, 'pc').meat).toEqual({ used: 3, max: 4 })
    expect(() => equipAbilities(g.k, g.state, 'pc', ['sk_gunner_instinct', 'sk_gunner_burst', 'sk_gunner_cover_fire', 'sk_fixer_face'])).toThrow('現實型的容量不夠（要 5，橋只有 4）。')
    expect(() => equipAbilities(g.k, g.state, 'pc', ['sk_nope'])).toThrow('還沒學會sk_nope。')
    expect(() => equipAbilities(g.k, g.state, 'pc', ['sk_gunner_sights'])).toThrow('還沒學會瞄具。')
    expect(abilitiesOf(g.state, 'pc').equipped).toEqual(['sk_gunner_instinct'])
    g.commit(equipAbilities(g.k, g.state, 'pc', []))
    expect(abilitiesOf(g.state, 'pc').equipped).toEqual([])
    // 沒有橋的角色：容量全是 0
    const bare = makeGame({ features: FEATURES, content: [PACK], pc: { ext: { abilities: { xp: 0, learned: ['sk_gunner_instinct'], equipped: [], spent: {} } } } }).game
    expect(() => equipAbilities(bare.k, bare.state, 'pc', ['sk_gunner_instinct'])).toThrow('現實型的容量不夠（要 3，橋只有 0）。')
    expect(capacityOf(bare.k, bare.state, 'pc').media).toEqual({ used: 0, max: 0 })
  })
})

describe('內容的檢查', () => {
  const kernel = (over: { ability?: unknown[]; path?: unknown[] }): Kernel => {
    const k = createKernel([abilitiesFeature])
    k.content.loadPack({ id: 'c', content: { path: over.path ?? PATHS, ability: over.ability ?? ABILITIES } } as ContentPack)
    return k
  }
  const bad = (id: string, more: Record<string, unknown>, path = 'gunner') => () => {
    const k = kernel({ ability: [...ABILITIES, sk(id, '壞的', path, 1, 'active', 1, { after: 'sk_gunner_instinct', use: { ap: 1 }, meat: { target: 'enemy' }, ...more })] })
    readyFeatures(k)
  }

  it('合格的內容不丟錯', () => {
    expect(bad('sk_ok', {})).not.toThrow()
  })

  it('格式：欄位型別、cap、tier、layer、kind、use、meat 的子鍵', () => {
    const fmt = (more: Record<string, unknown>) => () => kernel({ ability: [...ABILITIES, sk('sk_bad', '壞的', 'gunner', 1, 'active', 1, { after: 'sk_gunner_instinct', ...more })] })
    expect(fmt({ cap: 7 })).toThrow(/cap/)
    expect(fmt({ tier: 6 })).toThrow(/tier/)
    expect(fmt({ layer: 'middle' })).toThrow(/layer/)
    expect(fmt({ kind: 'toggle' })).toThrow(/kind/)
    expect(fmt({ use: { ap: 1, cooldown: 3 } })).toThrow(/cooldown/)
    expect(fmt({ use: { per_turn: 0 } })).toThrow(/per_turn/)
    expect(fmt({ meat: { target: 'enemy', attack: { teleport: true } } })).toThrow(/teleport/)
    expect(fmt({ meat: { target: 'everyone' } })).toThrow(/meat\.target/)
    expect(fmt({ meat: { call: { options: ['summon'], per_fight: 'half_tier_up', ap: 1 } } })).toThrow(/options/)
    expect(fmt({ meat: { apply: [{ status: 'marked', until: 'someday' }] } })).toThrow(/until/)
    expect(fmt({ meat: { cost: { ability: 'sk_gunner_burst', ap: 1, per_turn: 0 } } })).toThrow(/meat\.cost\.per_turn/)
    expect(fmt({ meat: { cost: { ability: 'sk_gunner_burst', ap: 1, per_fight: 1 } } })).toThrow(/per_fight/)
    expect(fmt({ meat: { weapon_cost: { trait: 'aimed', ap: 1, per_turn: 1.5 } } })).toThrow(/meat\.weapon_cost\.per_turn/)
    expect(fmt({ meat: { cost: { ability: 'sk_gunner_burst', ap: 1, per_turn: 1 }, weapon_cost: { trait: 'aimed', ap: 1, per_turn: 2 } } })).toThrow(/共用同一個回合計數/)
    expect(fmt({ meat: { cost: { ability: 'sk_gunner_burst', ap: 1, per_turn: 1 }, weapon_cost: { trait: 'aimed', ap: 1, per_turn: 1 } } })).not.toThrow()
    expect(fmt({ meat: 5 })).toThrow(/meat/)
    expect(fmt({ net: undefined })).toThrow(/net/)
    expect(fmt({ after: undefined })).toThrow(/after/)
    expect(fmt({ prep: 3 })).toThrow(/prep/)
  })

  it('招牌不用 after；path 的格式：共鳴的 effect 只能用封閉清單', () => {
    expect(() => kernel({})).not.toThrow()
    const withEffect = (effect: unknown) => () => kernel({ path: [{ ...PATHS[0]!, resonance: [{ tier: 1, cells: 1, text: '一句話。', effect }] }, PATHS[1]!] })
    expect(withEffect({ initiative: 3 })).not.toThrow()
    expect(withEffect({ pending: true })).not.toThrow()
    expect(withEffect({ heal: 3 })).toThrow(/heal/)
    expect(withEffect({ free_move: { per_fight: 0 } })).toThrow(/free_move/)
    expect(() => kernel({ path: [{ ...PATHS[0]!, domains: { meat: 'huge', net: 'none', opinion: 'none' } }, PATHS[1]!] })).toThrow(/domains\.meat/)
    expect(() => kernel({ path: [{ ...PATHS[0]!, category: 'psychic' }, PATHS[1]!] })).toThrow(/category/)
  })

  it('跨筆的檢查在 ready：前置在別棵樹、category 和樹不同、樹的 signature 不存在或不在那棵樹、cost.ability 不存在', () => {
    expect(bad('sk_x1', { after: 'sk_fixer_face' })).toThrow(/sk_fixer_face/)
    expect(bad('sk_x2', { category: 'social' })).toThrow(/category/)
    expect(bad('sk_x3', { meat: { cost: { ability: 'sk_ghost', ap: 1 } } })).toThrow(/sk_ghost/)
    // 每回合第幾次的減免要套在主動技能上；被動技能沒有行動可以套
    expect(bad('sk_x4', { meat: { cost: { ability: 'sk_gunner_burst', ap: 2, per_turn: 1 } } })).not.toThrow()
    expect(bad('sk_x5', { meat: { cost: { ability: 'sk_gunner_instinct', ap: 2, per_turn: 1 } } })).toThrow(/sk_gunner_instinct.*不是主動技能/)
    expect(bad('sk_x6', { meat: { cost: { ability: 'sk_gunner_instinct', ap: 2 } } })).not.toThrow()
    expect(() => readyFeatures(kernel({ path: [{ ...PATHS[0]!, signature: 'sk_fixer_face' }, PATHS[1]!] }))).toThrow(/sk_fixer_face/)
    // 引用不存在的樹 / 招牌：載入時就擋（內容的引用檢查）
    const k = kernel({ ability: [...ABILITIES, sk('sk_lost', '迷路', 'ghost', 1, 'passive', 1, { after: 'sk_gunner_instinct' })] })
    expect(k.content.checkRefs().join()).toContain('ghost')
    const k2 = kernel({ path: [{ ...PATHS[0]!, signature: 'sk_none' }, PATHS[1]!] })
    expect(k2.content.checkRefs().join()).toContain('sk_none')
  })

  it('樹的戰場寫 none 的那一欄一定是 null：內海與現實同理，訊息有技能的 id 與樹的名字', () => {
    expect(bad('sk_n1', { net: { overclock: 1 } })).toThrow('sk_n1：戰鬥直覺在內海沒有效果（domains.net 是 none），net 要是 null')
    expect(bad('sk_n2', { opinion: { voice: 1 } })).toThrow('sk_n2：戰鬥直覺在輿論沒有效果（domains.opinion 是 none），opinion 要是 null')
    const noMeat = [{ ...PATHS[0]!, domains: { meat: 'none', net: 'weak', opinion: 'none' } }, PATHS[1]!]
    const k = kernel({ path: noMeat, ability: [...ABILITIES.filter((a) => a.path === 'fixer'), sk('sk_gunner_instinct', '戰鬥直覺', 'gunner', 1, 'passive', 3, { layer: 'signature', meat: { instinct: true } })] })
    expect(() => readyFeatures(k)).toThrow(/在現實沒有效果.*meat 要是 null/)
  })

  it('每個行動只註冊一次：active 有 target 的、招牌的指揮與叫人；其他種類不註冊', () => {
    const k = kernel({})
    readyFeatures(k)
    const has = (id: string) => !!k.battle.getAction(id)
    expect([has('sk_gunner_burst'), has('sk_fixer_swap'), has('sk_fixer_face.give_ap'), has('sk_fixer_face.call')]).toEqual([true, true, true, true])
    expect([has('sk_gunner_cover_fire'), has('sk_fixer_watch_out'), has('sk_gunner_instinct'), has('sk_gunner_sights'), has('sk_gunner_pending')]).toEqual([false, false, false, false, false])
    // 順序照內容裡的順序
    expect(k.battle.actionsFor('meat').filter((a) => a.group === 'skill').map((a) => a.id)).toEqual(['sk_gunner_burst', 'sk_fixer_face.give_ap', 'sk_fixer_face.call', 'sk_fixer_swap'])
    // 只有現實戰場
    expect(k.battle.actionsFor('net').some((a) => a.group === 'skill')).toBe(false)
  })
})

