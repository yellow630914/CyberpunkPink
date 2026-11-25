// 驗收測試：dev/work/M1-abilities.md（cpp-feature）。工單做完之前照預期失敗（features/abilities 還不存在）。
// 規格：SKILLS 1.1～1.4、1.8、1.9 節；CORE_RULES 6.4 節（橋的容量）；DATA 第 2 節（技能的格式）；
// SKILL_TREES 槍手 1～2 階、掮客 1～2 階（這份測試自己帶的那幾個技能照那兩棵樹的文字寫）；COMBAT_SYSTEM 第 5、6、11 節。
// 整棵樹的資料是另一張工單（dev/work/M1-data-abilities.md）。

import { describe, expect, it } from 'vitest'
import type { BattleSetup, BattleUnit, ContentPack } from '../../src'
import { END_TURN, MOVE } from '../../src'
import { TREE_XP, abilitiesFeature, abilitiesOf, capacityOf, equipAbilities, learn, learnBlock, treeTier } from '../../src/features/abilities'
import { BATTLE_SETUPS, TEST_ACTIONS, TEST_COMBAT, makeBattleGame, makeGame } from '../../src/testkit'
import { TEST_STATUSES, duel, foe, one } from '../helpers/battle'

const sk = (id: string, name: string, path: string, tier: number, kind: string, cap: number, more: Record<string, unknown>) => ({
  id, name, path, category: path === 'gunner' ? 'meat' : 'social', tier, layer: 'front', kind, cap, xp: tier * 20, cells: 1, text: `${name}。`, net: null, opinion: null, ...more,
})
const PACK: ContentPack = {
  id: 'abilities_test',
  content: {
    battle_status: TEST_STATUSES,
    path: [
      { id: 'gunner', name: '槍手', tree: '戰鬥直覺', category: 'meat', signature: 'sk_gunner_instinct', domains: { meat: 'strong', net: 'weak', opinion: 'none' },
        resonance: [{ tier: 1, cells: 1, text: '每場戰鬥開始時，你的先攻 +3。', effect: { initiative: 3 } }, { tier: 2, cells: 1, text: '每場戰鬥你第一次換位不花行動點。', effect: { free_move: { per_fight: 1 } } }] },
      { id: 'fixer', name: '掮客', tree: '人面', category: 'social', signature: 'sk_fixer_face', domains: { meat: 'strong_support', net: 'mid', opinion: 'mid' }, resonance: [] },
    ],
    ability: [
      // 招牌是被動：戰鬥直覺的分配在工單裡另外寫；這裡只要它是樹的第一個技能
      sk('sk_gunner_instinct', '戰鬥直覺', 'gunner', 1, 'passive', 3, { layer: 'signature', meat: { instinct: true } }),
      sk('sk_gunner_aimed_shot', '要害射擊', 'gunner', 1, 'active', 1, { after: 'sk_gunner_instinct', use: { ap: 3 }, meat: { target: 'enemy', attack: { aimed: true } } }),
      sk('sk_gunner_burst', '連射控制', 'gunner', 1, 'active', 1, { after: 'sk_gunner_instinct', use: { ap: 3 }, meat: { target: 'enemy', attack: { spend: 'all', min_mag: 2, dice: 'spent_minus_1', suppress: { dc: 'spent', skill: 'composure' } } } }),
      sk('sk_gunner_cover_fire', '掩護射擊', 'gunner', 1, 'reaction', 1, { after: 'sk_gunner_instinct', use: { ap: 2, per_turn: 1 }, meat: { trigger: 'ally_attacked_adjacent', attack: { at: 'attacker' }, on_hit: { hit_against_ally: -2 } } }),
      sk('sk_gunner_watch_me', '看我的！', 'gunner', 1, 'active', 1, { layer: 'back', after: 'sk_gunner_aimed_shot', use: { ap: 1, per_fight: 1, first_round: true }, meat: { target: 'enemy', attack: { hit: 1 } } }),
      sk('sk_gunner_point_shot', '定點射', 'gunner', 2, 'passive', 3, { after: 'sk_gunner_aimed_shot', meat: { cost: { ability: 'sk_gunner_aimed_shot', ap: 2, per_turn: 1 }, weapon_cost: { trait: 'aimed', ap: 2, per_turn: 1 } } }),
      sk('sk_gunner_thats_you', '就是你了', 'gunner', 2, 'active', 1, { layer: 'back', after: 'sk_gunner_point_shot', use: { ap: 1 }, meat: { target: 'enemy', apply: [{ status: 'marked', until: 'source_turn_start' }] } }),
      sk('sk_fixer_face', '人面', 'fixer', 1, 'passive', 3, { layer: 'signature', meat: { give_ap: { max: 'one_plus_half_tier' }, call: { options: ['shot', 'cover_up', 'cover_down'], per_fight: 'half_tier_up', ap: 1 } } }),
      sk('sk_fixer_focus_fire', '集火', 'fixer', 1, 'active', 1, { after: 'sk_fixer_face', use: { ap: 1 }, meat: { target: 'enemy', apply: [{ status: 'marked', until: 'source_turn_start' }] } }),
      sk('sk_fixer_watch_out', '小心後面！', 'fixer', 1, 'reaction', 1, { after: 'sk_fixer_face', use: { ap: 1, per_turn: 1 }, meat: { trigger: 'ally_attacked', evade: 3 } }),
      sk('sk_fixer_swap', '換位子', 'fixer', 1, 'active', 1, { layer: 'back', after: 'sk_fixer_focus_fire', use: { ap: 1 }, meat: { target: 'ally', free_move: { swap_adjacent_pair: true } } }),
    ],
  },
}
const FEATURES = [abilitiesFeature, TEST_COMBAT]
const BRIDGE = { capacity: { meat: 8, net: 8, social: 8, media: 8 } }

describe('學、裝、容量與樹的階（SKILLS 1.3、1.4 節；CORE_RULES 6.4 節）', () => {
  const setup = (xp = 200) => makeGame({ features: FEATURES, content: [PACK], pc: { ext: { bridge: BRIDGE, abilities: { xp, learned: [], equipped: [], spent: {} } } } }).game

  it('學一個技能花「階 × 20」歷練點，算進那棵樹的累計；前置要先學；樹的階照累計花費開（40／120／240／400）', () => {
    expect(TREE_XP).toEqual([0, 40, 120, 240, 400])
    const g = setup(100)
    expect(learnBlock(g.k, g.state, 'pc', 'sk_gunner_aimed_shot')).toBe('要先學會戰鬥直覺。')
    expect(learnBlock(g.k, g.state, 'pc', 'sk_gunner_point_shot')).toBe('槍手這棵樹還沒開到 2 階（要在這棵樹累計花 40 點，現在 0 點）。')
    g.commit(learn(g.k, g.state, 'pc', 'sk_gunner_instinct'))
    g.commit(learn(g.k, g.state, 'pc', 'sk_gunner_aimed_shot'))
    expect(abilitiesOf(g.state, 'pc')).toMatchObject({ xp: 60, learned: ['sk_gunner_instinct', 'sk_gunner_aimed_shot'], spent: { gunner: 40 } })
    expect(treeTier(g.k, g.state, 'pc', 'gunner')).toBe(2)
    expect(treeTier(g.k, g.state, 'pc', 'fixer')).toBe(1)
    g.commit(learn(g.k, g.state, 'pc', 'sk_gunner_point_shot'))
    expect(learnBlock(g.k, g.state, 'pc', 'sk_gunner_thats_you')).toBe('歷練點不夠（要 40 點，現在 20 點）。')
    expect(learnBlock(g.k, g.state, 'pc', 'sk_gunner_instinct')).toBe('已經學會了。')
    expect(learnBlock(g.k, g.state, 'pc', 'sk_nope')).toBe('沒有這個技能。')
  })

  it('裝上才生效；每一類各算各的容量，裝不下就擋；沒學的不能裝', () => {
    const g = setup(400)
    for (const id of ['sk_gunner_instinct', 'sk_gunner_aimed_shot', 'sk_gunner_burst', 'sk_gunner_cover_fire', 'sk_gunner_watch_me', 'sk_fixer_face', 'sk_fixer_focus_fire']) g.commit(learn(g.k, g.state, 'pc', id))
    expect(capacityOf(g.k, g.state, 'pc')).toEqual({ meat: { used: 0, max: 8 }, net: { used: 0, max: 8 }, social: { used: 0, max: 8 }, media: { used: 0, max: 8 } })
    g.commit(equipAbilities(g.k, g.state, 'pc', ['sk_gunner_instinct', 'sk_gunner_aimed_shot', 'sk_gunner_burst', 'sk_fixer_face', 'sk_fixer_focus_fire']))
    expect(capacityOf(g.k, g.state, 'pc')).toMatchObject({ meat: { used: 5, max: 8 }, social: { used: 4, max: 8 } })
    expect(() => equipAbilities(g.k, g.state, 'pc', ['sk_gunner_thats_you'])).toThrow(/還沒學會就是你了/)
    // 橋的每一類最低 8（CORE_RULES 6.4 節）：寫得更低的照 8 算
    g.state.actors.pc!.ext.bridge = { capacity: { meat: 4, net: 8, social: 8, media: 8 } }
    expect(capacityOf(g.k, g.state, 'pc').meat.max).toBe(8)
  })

  it('內容的檢查：前置要存在、同一棵樹；效果只能用封閉清單裡的鍵；樹的戰場寫 none 的那一欄一定是 null', () => {
    const bad = (over: Record<string, unknown>) => () => makeGame({ features: FEATURES, content: [{ id: 'bad', content: { ...PACK.content, ability: [...PACK.content.ability!, sk('sk_bad', '壞的', 'gunner', 1, 'active', 1, { after: 'sk_gunner_instinct', use: { ap: 1 }, meat: { target: 'enemy', attack: {} }, ...over })] } }] })
    expect(bad({})).not.toThrow()
    expect(bad({ after: 'sk_ghost' })).toThrow(/sk_ghost/)
    expect(bad({ meat: { target: 'enemy', summon_dragon: 1 } })).toThrow(/summon_dragon/)
    expect(bad({ opinion: { voice: 2 } })).toThrow(/opinion.*none|輿論/)
    expect(bad({ xp: 30 })).toThrow(/xp/)
  })
})

describe('戰鬥裡的技能（SKILL_TREES 槍手、掮客 1～2 階）', () => {
  const unit = (ids: string[], o: Parameters<typeof one>[0] = {}, i = 1) => one({ ...o, ext: { abilities: { equipped: ids, tiers: { gunner: 2, fixer: 2 } } } }, i)
  const game = (allies: unknown[], foes: unknown[] = [foe('elite'), foe('elite')], more: Partial<BattleSetup> = {}, seed = 7) => makeBattleGame({ features: FEATURES, content: [PACK], battle: duel(allies, foes, { ally: [1, 1, 1, 1], foe: [0, 0, 0, 0] }, more), seed }).game
  type G = ReturnType<typeof game>
  const turnTo = (g: G, id: string, control: 'player' | 'ai' = 'player'): BattleUnit => {
    const b = g.state.battle!
    b.turn = b.order.indexOf(id)
    const u = b.units[id]!
    u.ap.now = u.ap.max
    u.control = control
    return u
  }
  const opt = (g: G, id: string) => g.battleOptions()!.actions.find((a) => a.id === id)
  const beats = (r: { reports: Array<{ timeline: Array<{ tag?: string; roll?: { parts: Array<{ label: string; value: number }>; dc: number; skill?: string } }> }> }) => r.reports.flatMap((x) => x.timeline)

  it('技能清單只列裝著的主動技能（圓環中心）；沒裝的人沒有', () => {
    const g = game([unit(['sk_gunner_instinct', 'sk_gunner_aimed_shot', 'sk_gunner_burst'], { weapon: 'rifle' }), one({ weapon: 'pistol' }, 2)])
    turnTo(g, 'a1')
    const skills = g.battleOptions()!.actions.filter((a) => a.group === 'skill')
    // 戰鬥直覺（被動）多一個行動「重分配」（M1b-skill-gunner-broker）
    expect(skills.map((a) => [a.id, a.name, a.cost.ap])).toEqual([['sk_gunner_instinct.realloc', '重分配', 1], ['sk_gunner_aimed_shot', '要害射擊', 3], ['sk_gunner_burst', '連射控制', 3]])
    // 技能排在圓環的最前面（中心），其餘照原本的圈
    expect(g.battleOptions()!.actions.map((a) => a.id)).toEqual(['sk_gunner_instinct.realloc', 'sk_gunner_aimed_shot', 'sk_gunner_burst', TEST_ACTIONS.ATTACK, TEST_ACTIONS.RELOAD, MOVE, TEST_ACTIONS.WATCH, END_TURN])
    turnTo(g, 'a2')
    expect(g.battleOptions()!.actions.some((a) => a.group === 'skill')).toBe(false)
  })

  it('要害射擊：3 點、花彈匣 1 格，算瞄準過的射擊（命中 +3）；裝了定點射每回合第一次只花 2 點，第二次 3 點', () => {
    const g = game([unit(['sk_gunner_aimed_shot'], { weapon: 'rifle' }), unit(['sk_gunner_aimed_shot', 'sk_gunner_point_shot'], { weapon: 'rifle' }, 2)])
    const me = turnTo(g, 'a1')
    const r = g.battleAct({ action: 'sk_gunner_aimed_shot', target: { unit: 'f1' } })
    expect(r.status).toBe('applied')
    expect(beats(r).find((b) => b.roll)!.roll!.parts).toContainEqual(expect.objectContaining({ label: '瞄準', value: 3 }))
    expect(g.battle!.units.a1!).toMatchObject({ ap: { now: me.ap.max - 3 }, weapons: [{ mag: { now: 2 } }] })
    expect(beats(r).some((b) => b.tag === 'skill')).toBe(true)
    expect(opt(g, 'sk_gunner_aimed_shot')!.cost.ap).toBe(3) // 沒裝定點射：每次都 3 點
    const you = turnTo(g, 'a2')
    expect(opt(g, 'sk_gunner_aimed_shot')!.cost.ap).toBe(2)
    expect(g.battleAct({ action: 'sk_gunner_aimed_shot', target: { unit: 'f1' } }).status).toBe('applied')
    expect(g.battle!.units.a2!.ap.now).toBe(you.ap.max - 2)
    expect(opt(g, 'sk_gunner_aimed_shot')!.cost.ap).toBe(3) // 這回合的第一次用掉了：第二次照原價
    expect(g.battleAct({ action: 'sk_gunner_aimed_shot', target: { unit: 'f1' } }).status).toBe('applied')
    expect(g.battle!.units.a2!.ap.now).toBe(you.ap.max - 2 - 3)
  })

  it('連射：花掉彈匣裡剩下的全部（至少 2 格），傷害骰多「格數 − 1」顆；不管有沒有打中，目標過定力（DC 10 ＋ 格數 × 2），失敗被壓制', () => {
    // 種子 8：種子 7 的定力擲到自然 20（一定過，CORE_RULES 第 3 節）
    const g = game([unit(['sk_gunner_burst'], { weapon: 'rifle' })], [foe('boss', { skills: { composure: -40 } })], {}, 8)
    turnTo(g, 'a1')
    const r = g.battleAct({ action: 'sk_gunner_burst', target: { unit: 'f1' } })
    expect(r.status).toBe('applied')
    expect(g.battle!.units.a1!.weapons[0]!.mag!.now).toBe(0)
    const save = beats(r).filter((b) => b.roll).at(-1)!.roll!
    expect(save).toMatchObject({ dc: 10 + 3 * 2, skill: 'composure' })
    expect(g.battle!.units.f1!.statuses.map((s) => s.id)).toContain('suppressed')
    turnTo(g, 'a1') // 行動點補滿：只剩「彈匣不夠」這一條
    expect(opt(g, 'sk_gunner_burst')).toMatchObject({ ok: false, blocks: ['彈匣裡要有 2 格以上才能連射。'] })
    // 彈匣容量 1 的武器（狙擊槍）不能連射
    const s = game([unit(['sk_gunner_burst'], { weapon: 'sniper' })])
    turnTo(s, 'a1')
    expect(opt(s, 'sk_gunner_burst')!.ok).toBe(false)
  })

  describe('定點射：每回合第一次（要害射擊與狙擊槍的一槍共用一個計數）', () => {
    const point = (weapon: string, ids = ['sk_gunner_aimed_shot', 'sk_gunner_point_shot']) => game([unit(ids, { weapon })], [foe('boss')])
    const shoot = (g: G) => g.battleAct({ action: TEST_ACTIONS.ATTACK, target: { unit: 'f1' } })
    const aim = (g: G) => g.battleAct({ action: 'sk_gunner_aimed_shot', target: { unit: 'f1' } })
    const reload = (g: G) => g.battleAct({ action: TEST_ACTIONS.RELOAD })
    const costs = (g: G) => [opt(g, 'sk_gunner_aimed_shot')!.cost.ap, opt(g, TEST_ACTIONS.ATTACK)!.cost.ap]

    // 每一步之後狀態都是新的副本：每次重新拿
    const ap = (g: G) => g.battle!.units.a1!.ap.now
    const full = (g: G) => g.battle!.units.a1!.ap.max

    it('狙擊槍的一槍：每回合第一槍 2 點（本來 3 點），用掉之後第二槍回到 3 點；沒裝定點射的人每槍都 3 點', () => {
      const g = point('sniper')
      turnTo(g, 'a1')
      expect(costs(g)).toEqual([2, 2]) // 射擊前：兩種瞄準過的射擊都顯示 2 點
      expect(shoot(g).status).toBe('applied')
      expect(ap(g)).toBe(full(g) - 2)
      expect(costs(g)).toEqual([3, 3]) // 射擊後：兩種都回到原價
      expect(reload(g).status).toBe('applied')
      expect(shoot(g)).toMatchObject({ status: 'refused', reasons: [`行動點不夠（要 3 點，現在 ${full(g) - 2 - 1} 點）。`] }) // 剩 2 點：第二槍要 3 點，不夠
      g.battle!.units.a1!.ap.now = full(g)
      expect(shoot(g).status).toBe('applied')
      expect(ap(g)).toBe(full(g) - 3)
      const plain = game([unit(['sk_gunner_aimed_shot'], { weapon: 'sniper' })])
      turnTo(plain, 'a1')
      expect(costs(plain)).toEqual([3, 3])
    })

    it('要害射擊與狙擊槍的一槍共用同一個計數：同一回合兩種合起來只省一次（先用哪個都一樣）', () => {
      const run = (a: (g: G) => unknown, b: (g: G) => unknown) => {
        const g = point('sniper')
        turnTo(g, 'a1')
        a(g)
        expect(ap(g)).toBe(full(g) - 2)
        expect(costs(g)).toEqual([3, 3])
        reload(g)
        g.battle!.units.a1!.ap.now = full(g) // 只看第二槍的價錢
        b(g)
        expect(ap(g)).toBe(full(g) - 3)
      }
      run(aim, shoot) // 先要害射擊（2 點），再狙擊槍的一槍（3 點）
      run(shoot, aim) // 先狙擊槍的一槍（2 點），再要害射擊（3 點）
    })

    it('下一個回合又有一次；沒用掉的次數不累積', () => {
      const g = point('sniper')
      turnTo(g, 'a1')
      shoot(g)
      expect(costs(g)).toEqual([3, 3])
      expect(g.battleAct({ action: END_TURN }).status).toBe('applied')
      for (let i = 0; i < 20 && g.battle!.order[g.battle!.turn] !== 'a1'; i++) g.battleNext()
      expect(g.battle!.order[g.battle!.turn]).toBe('a1')
      expect(costs(g)).toEqual([2, 2]) // 下一回合：又是 2 點
      reload(g)
      shoot(g)
      expect(costs(g)).toEqual([3, 3])
    })

    it('不是用武器的行動點打的槍不用掉次數：監視的自動射擊、看我的！', () => {
      const g = game([unit(['sk_gunner_aimed_shot', 'sk_gunner_point_shot', 'sk_gunner_watch_me'], { weapon: 'sniper' })], [foe('boss')])
      turnTo(g, 'a1')
      expect(opt(g, 'sk_gunner_watch_me')!.cost.ap).toBe(1)
      expect(g.battleAct({ action: 'sk_gunner_watch_me', target: { unit: 'f1' } }).status).toBe('applied') // 技能自己的 1 點，不算狙擊槍的減免
      expect(costs(g)).toEqual([2, 2])
    })

    it('步槍沒有 aimed 特性，射擊的價錢不變；要害射擊還是每回合第一次 2 點', () => {
      const g = point('rifle')
      turnTo(g, 'a1')
      expect(costs(g)).toEqual([2, 2]) // 步槍沒寫 ap：射擊本來就是 2 點
      aim(g)
      expect(costs(g)).toEqual([3, 2])
    })
  })

  it('看我的！：只能在第一回合、每場一次；射擊一次只花 1 點、命中 +1', () => {
    const g = game([unit(['sk_gunner_watch_me'], { weapon: 'rifle' })])
    turnTo(g, 'a1')
    expect(opt(g, 'sk_gunner_watch_me')).toMatchObject({ ok: true, cost: { ap: 1 } })
    const r = g.battleAct({ action: 'sk_gunner_watch_me', target: { unit: 'f1' } })
    expect(beats(r).find((b) => b.roll)!.roll!.parts).toContainEqual(expect.objectContaining({ value: 1, label: '看我的！' }))
    expect(opt(g, 'sk_gunner_watch_me')!.blocks).toEqual(['這一場已經用過了。'])
    const late = game([unit(['sk_gunner_watch_me'], { weapon: 'rifle' })])
    late.state.battle!.round = 2
    turnTo(late, 'a1')
    expect(opt(late, 'sk_gunner_watch_me')!.blocks).toEqual(['只能在第一回合用。'])
  })

  it('集火／就是你了：標記一個敵人，到你的下一回合開始前全隊打他命中 +2', () => {
    const g = game([unit(['sk_fixer_focus_fire'], { weapon: 'pistol' }), one({ weapon: 'rifle' }, 2)])
    turnTo(g, 'a1')
    expect(g.battleAct({ action: 'sk_fixer_focus_fire', target: { unit: 'f1' } }).status).toBe('applied')
    expect(g.battle!.units.f1!.statuses).toEqual([{ id: 'marked', by: 'a1', until: { at: 'turn_start', of: 'a1', turns: 1 } }])
    turnTo(g, 'a2')
    const r = g.battleAct({ action: TEST_ACTIONS.ATTACK, target: { unit: 'f1' } })
    expect(beats(r).find((b) => b.roll)!.roll!.parts).toContainEqual(expect.objectContaining({ label: '標記', value: 2 }))
  })

  it('人面・指揮：把自己的行動點讓給一名隊友，1 點換 1 點，每回合最多 1 ＋ 階數的一半；對方不能超過上限', () => {
    const g = game([unit(['sk_fixer_face'], { weapon: 'pistol' }), one({ weapon: 'rifle' }, 2)])
    const me = turnTo(g, 'a1')
    g.state.battle!.units.a2!.ap.now = 1
    const give = opt(g, 'sk_fixer_face.give_ap')!
    expect(give).toMatchObject({ name: '指揮', group: 'skill', ok: true, cost: { ap: 1 } })
    expect(g.battleAct({ action: 'sk_fixer_face.give_ap', target: { unit: 'a2' } }).status).toBe('applied')
    expect(g.battleAct({ action: 'sk_fixer_face.give_ap', target: { unit: 'a2' } }).status).toBe('applied')
    expect(g.battle!.units).toMatchObject({ a1: { ap: { now: me.ap.max - 2 } }, a2: { ap: { now: 3 } } })
    // 人面 2 階：每回合最多 1 ＋ 1 = 2 點
    expect(opt(g, 'sk_fixer_face.give_ap')!.blocks).toEqual(['這一回合已經讓了 2 點，不能再讓。'])
    g.state.battle!.units.a2!.ap.now = g.state.battle!.units.a2!.ap.max
    g.state.battle!.units.a1!.uses = {}
    expect(opt(g, 'sk_fixer_face.give_ap')!.targets.find((t) => 'unit' in t.target && t.target.unit === 'a2')!.blocks).toEqual(['他的行動點已經滿了。'])
  })

  it('人面・叫人：花 1 點，三選一（替我方一格補一級遮蔽、拆掉敵方一格一級遮蔽、支援射擊）；每場次數是階數的一半（無條件進位）', () => {
    const g = game([unit(['sk_fixer_face'], { weapon: 'pistol' })], [foe('elite')], { cover: { ally: [0, 0, 0, 0], foe: [2, 0, 0, 0] } })
    turnTo(g, 'a1')
    const up = g.battleAct({ action: 'sk_fixer_face.call', target: { side: 'ally', slot: 1 }, pick: { option: 'cover_up' } })
    expect(up.status).toBe('applied')
    expect(g.battle!.cover.ally[0]).toMatchObject({ level: 1, hp: 15 })
    expect(beats(up).some((b) => b.tag === 'support')).toBe(true)
    // 人面 2 階：每場 1 次
    expect(opt(g, 'sk_fixer_face.call')!.blocks).toEqual(['這一場叫人的次數用完了（1 次）。'])
    expect(g.battle!.units.a1!.uses['sk_fixer_face.call']).toBe(1)
  })

  it('換位子：讓兩名相鄰的隊友交換位置，不花他們的行動點', () => {
    const g = game([unit(['sk_fixer_swap'], { weapon: 'pistol' }), one({ weapon: 'rifle' }, 2), one({ weapon: 'smg' }, 3)])
    turnTo(g, 'a1')
    const ap = [g.state.battle!.units.a2!.ap.now, g.state.battle!.units.a3!.ap.now]
    expect(g.battleAct({ action: 'sk_fixer_swap', target: { unit: 'a2' }, pick: { with: 'a3' } }).status).toBe('applied')
    expect(g.battle!.units).toMatchObject({ a2: { slot: 3, ap: { now: ap[0] } }, a3: { slot: 2, ap: { now: ap[1] } } })
  })

  it('反應：小心後面！——隊友被攻擊、擲命中之前，他這一次的迴避 +3；花上回合留下的 1 點，每回合一次；沒有留就不觸發', () => {
    const g = game([unit(['sk_fixer_watch_out'], { weapon: 'pistol' }), one({ weapon: 'rifle' }, 2)], [foe('minion')], {}, 3)
    g.state.battle!.units.a1!.ap.now = 1
    turnTo(g, 'f1', 'player')
    g.state.battle!.units.a1!.ap.now = 1
    const r = g.battleAct({ action: TEST_ACTIONS.ATTACK, target: { unit: 'a2' } })
    const roll = beats(r).find((b) => b.roll)!.roll!
    expect(roll.dc).toBe(12 + 2 + 3) // 迴避 12 ＋ 半掩體 2 ＋ 掩護 3
    expect(g.battle!.units.a1!.ap.now).toBe(0)
    expect(beats(r).some((b) => b.tag === 'skill')).toBe(true)
    // 同一回合的第二次不觸發；行動點用完了也不觸發
    turnTo(g, 'f1', 'player')
    const again = g.battleAct({ action: TEST_ACTIONS.ATTACK, target: { unit: 'a2' } })
    expect(beats(again).find((b) => b.roll)!.roll!.dc).toBe(12 + 2)
  })

  it('共鳴：槍手 1 階先攻 +3；2 階每場第一次換位不花行動點', () => {
    const g = game([unit(['sk_gunner_instinct'], { weapon: 'rifle' }), one({ weapon: 'rifle' }, 2)])
    const [me, mate] = [g.battle!.units.a1!, g.battle!.units.a2!]
    expect(me.initiative - mate.initiative).toBeGreaterThanOrEqual(3 - 19)
    expect(me.initBonus).toBe(mate.initBonus) // 加值寫在修正裡，不改單位的基礎
    turnTo(g, 'a1')
    expect(opt(g, MOVE)!.cost.ap).toBe(0)
    expect(g.battleAct({ action: MOVE, target: { side: 'ally', slot: 2 } }).status).toBe('applied')
    expect(opt(g, MOVE)!.cost.ap).toBe(1)
  })

  it('角色帶進戰鬥：裝著的技能與每棵樹開到幾階寫在單位上（照開打那一刻）', () => {
    const g = makeGame({ features: FEATURES, content: [PACK], pc: { ext: { bridge: BRIDGE, abilities: { xp: 0, learned: ['sk_fixer_face', 'sk_fixer_focus_fire'], equipped: ['sk_fixer_face', 'sk_fixer_focus_fire'], spent: { fixer: 40 } } } } }).game
    g.startBattle({ ...BATTLE_SETUPS.encounter(), allies: [{ from: 'actor', id: 'pc' }] })
    expect(g.battle!.units.a1!.ext.abilities).toEqual({ equipped: ['sk_fixer_face', 'sk_fixer_focus_fire'], tiers: { fixer: 2 } })
  })
})
