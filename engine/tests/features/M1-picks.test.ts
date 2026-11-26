// 行動的宣告：每個行動的圖示，以及「目標以外還要選的東西」（picks）和行動本身（run）對不對得上。
// dev/adr/0014；審查 dev/reviews/2026-11-22-M1a.md 的 E3（要多選一樣東西的行動在畫面上做不成，而引擎說它能做）。
// 這裡把現實戰鬥、無人機與控制節點、技能三個功能裝在一起（測試可以；功能之間還是不互相 import），內容用測試自己帶的最小假資料。

import { describe, expect, it } from 'vitest'
import type { BattleActionOption, BattleInput, BattleTarget, BattleUnit, ContentPack } from '../../src'
import { BattleBlocked, END_TURN, MOVE, battleAct, pickApplies, pickProblems } from '../../src'
import { CORE_PACK } from '../../data'
import { allFeatures } from '../../src/features'
import { abilitiesFeature } from '../../src/features/abilities'
import { combatFeature } from '../../src/features/combat'
import { summonsFeature } from '../../src/features/summons'
import { makeBattleGame, testWeapon } from '../../src/testkit'
import { TEST_STATUSES, duel, foe, one } from '../helpers/battle'

const ITEM = (id: string, name: string, more: Record<string, unknown> = {}) => ({ id, name, desc: `${name}。`, category: 'consumable', grade: 1, size: 1, legal: 'free', ...more })
const sk = (id: string, name: string, path: string, tier: number, kind: string, more: Record<string, unknown>) => ({
  id, name, path, category: path === 'gunner' ? 'meat' : 'social', tier, layer: 'front', kind, cap: 1, xp: tier * 20, cells: 1, text: `${name}。`, net: null, opinion: null, meat: null, ...more,
})
const PACK: ContentPack = {
  id: 'picks_test',
  content: {
    battle_status: [...TEST_STATUSES, { id: 'limb_hurt', name: '肢體受創', desc: '那隻手或腳的檢定 −2，到戰鬥結束。', mods: { hit: -2 }, until: 'battle_end', kind: 'wound' }],
    item: [
      ITEM('it_zip_tie', '束帶', { tags: ['restraint'] }),
      ITEM('it_medgel_1', '急救凝膠', { use: { ap: 1, ap_other: 2, target: 'ally', modes: ['meat'], effects: [{ op: 'heal', amount: 8 }] } }),
      ITEM('it_coolant_1', '冷卻劑', { use: { ap: 1, target: 'self', modes: ['meat'], effects: [{ op: 'vent', amount: 4 }] } }),
      ITEM('it_smoke_1', '煙霧彈', { use: { ap: 1, target: 'slot', modes: ['meat'], effects: [{ op: 'soft_cover', kind: 'smoke', rounds: 2 }] } }),
      // 對敵人用的道具還沒做（投擲物那一批）：列出來、寫出原因
      ITEM('it_flash_1', '閃光彈', { use: { ap: 1, target: 'foe', modes: ['meat'], effects: [{ op: 'heal', amount: 0 }] } }),
    ],
    path: [
      { id: 'gunner', name: '槍手', tree: '戰鬥直覺', category: 'meat', signature: 'sk_gunner_instinct', domains: { meat: 'strong', net: 'none', opinion: 'none' }, resonance: [] },
      { id: 'fixer', name: '掮客', tree: '人面', category: 'social', signature: 'sk_fixer_face', domains: { meat: 'strong_support', net: 'mid', opinion: 'mid' }, resonance: [] },
    ],
    ability: [
      sk('sk_gunner_instinct', '戰鬥直覺', 'gunner', 1, 'passive', { layer: 'signature', cap: 3, meat: { instinct: true } }),
      sk('sk_gunner_aimed_shot', '要害射擊', 'gunner', 1, 'active', { after: 'sk_gunner_instinct', use: { ap: 3 }, meat: { target: 'enemy', attack: { aimed: true, hit: 3 } } }),
      sk('sk_gunner_burst', '連射控制', 'gunner', 1, 'active', { after: 'sk_gunner_instinct', use: { ap: 3 }, meat: { target: 'enemy', attack: { spend: 'all', min_mag: 2, dice: 'spent_minus_1', suppress: { dc: 'spent', skill: 'composure' } } } }),
      sk('sk_fixer_face', '人面', 'fixer', 1, 'passive', { layer: 'signature', cap: 3, meat: { give_ap: { max: 'one_plus_half_tier' }, call: { options: ['shot', 'cover_up', 'cover_down'], per_fight: 'half_tier_up', ap: 1 } } }),
      sk('sk_fixer_swap', '換位子', 'fixer', 1, 'active', { after: 'sk_fixer_face', use: { ap: 1 }, meat: { target: 'ally', free_move: { swap_adjacent_pair: true } } }),
    ],
  },
}
const FEATURES = [combatFeature, summonsFeature, abilitiesFeature]
const lmg = { ...testWeapon('rifle', 6), id: 'lmg', name: '輕機槍', class: 'lmg', mag: { now: 4, max: 4 }, traits: ['sweep'] }
/** 什麼都會的一個人：三把武器（手上是能掃射的輕機槍）、快取格五種東西、三個技能、四台無人機與一台車。 */
const everything = () => one({
  weapons: [lmg, testWeapon('pistol', 6), testWeapon('knife', 6)], wield: 0,
  quick: [{ item: 'it_medgel_1', qty: 2 }, { item: 'it_coolant_1', qty: 1 }, { item: 'it_smoke_1', qty: 1 }, { item: 'it_zip_tie', qty: 1 }, { item: 'it_flash_1', qty: 1 }],
  skills: { firearms: 2, brawl: 2, sync: 6, piloting: 3, composure: 1 },
  ap: { now: 99, max: 99, regen: 3 },
  ext: {
    abilities: { equipped: ['sk_gunner_aimed_shot', 'sk_gunner_burst', 'sk_fixer_face', 'sk_fixer_swap'], tiers: { gunner: 2, fixer: 2 } },
    summons: { drones: [{ kind: 'attack', grade: 1 }, { kind: 'medic', grade: 1 }, { kind: 'shield', grade: 1 }, { kind: 'scout', grade: 1 }], vehicle: { name: '小貨車', hp: [30, 60] } },
  },
})
const start = () => makeBattleGame({
  features: FEATURES, content: [PACK], seed: 7,
  battle: duel([everything(), one({ weapon: 'pistol' }, 2), one({ weapon: 'pistol' }, 3)], [foe('elite'), foe('elite')], { ally: [1, 1, 0, 0], foe: [0, 2, 0, 0] }, { nodes: [{ kind: 'light', name: '燈' }, { kind: 'door', name: '防爆門' }] }),
}).game
type G = ReturnType<typeof start>
const turnTo = (g: G, id: string): BattleUnit => {
  const b = g.state.battle!
  b.turn = b.order.indexOf(id)
  const u = b.units[id]!
  u.ap.now = u.ap.max
  u.control = 'player'
  return u
}
const opt = (g: G, id: string): BattleActionOption => g.battleOptions()!.actions.find((a) => a.id === id)!
/** 這一步照現在的狀態成不成立（純算，不提交）。 */
const tryAct = (g: G, input: BattleInput): string[] | null => {
  try {
    battleAct(g.k, g.state, input)
    return null
  } catch (e) {
    if (e instanceof BattleBlocked) return e.reasons
    throw e
  }
}

/**
 * 宣告與行動本身對不對得上：對每一個可以選的目標，
 *  1. 一定要選的每一項各選第一個選得了的 → 成立；
 *  2. 每一項的每一個選得了的選項 → 成立；灰掉的選項 → 被擋下；
 *  3. 少選一個一定要選的 → 被擋下。
 * 回傳對不上的地方（空的就是都對得上）與一共驗了幾步。
 */
function mismatches(g: G, a: BattleActionOption): { bad: string[]; tried: number } {
  const bad: string[] = []
  let tried = 0
  // 行動自己的條件沒過（灰掉的）不在這裡驗：那是 blocks 的事
  if (a.blocks.length) return { bad, tried }
  const targets: Array<BattleTarget | null> = a.target === 'none' ? [null] : a.targets.filter((t) => t.blocks.length === 0).map((t) => t.target)
  for (const target of targets) {
    const at = JSON.stringify(target)
    const input = (pick: Record<string, unknown>): BattleInput => ({ action: a.id, ...(target ? { target } : {}), ...(Object.keys(pick).length ? { pick } : {}) })
    const base: Record<string, unknown> = {}
    let possible = true
    for (const p of a.picks) {
      const usable = p.options.filter((o) => pickApplies(o, target) && o.blocks.length === 0)
      if (p.required && p.options.some((o) => pickApplies(o, target))) {
        if (usable.length) base[p.key] = usable[0]!.value
        else possible = false // 一定要選、卻每個選項都灰掉：這個目標現在做不成
      }
    }
    if (!possible) continue
    tried += 1
    expect(pickProblems(a.picks, target, base)).toEqual([])
    const why = tryAct(g, input(base))
    if (why) bad.push(`${a.id} ${at} ${JSON.stringify(base)}：照宣告選齊了，卻被擋下（${why.join(' ')}）`)
    for (const p of a.picks) {
      for (const o of p.options.filter((x) => pickApplies(x, target))) {
        tried += 1
        const r = tryAct(g, input({ ...base, [p.key]: o.value }))
        if (o.blocks.length === 0 && r) bad.push(`${a.id} ${at} ${p.key}=${String(o.value)}：宣告說選得了，卻被擋下（${r.join(' ')}）`)
        if (o.blocks.length > 0 && !r) bad.push(`${a.id} ${at} ${p.key}=${String(o.value)}：宣告說選不了（${o.blocks.join(' ')}），卻做成了`)
      }
      if (p.key in base) {
        tried += 1
        const { [p.key]: _omit, ...rest } = base
        if (!tryAct(g, input(rest))) bad.push(`${a.id} ${at}：少選了「${p.label}」，卻做成了`)
        expect(pickProblems(a.picks, target, rest)).toEqual([`要選${p.label}。`])
      }
    }
  }
  return { bad, tried }
}

describe('每個行動都有圖示的鍵（COMBAT_SYSTEM 第 10 節；dev/adr/0014 的對照表）', () => {
  it('整組功能加正式的規則資料：每個註冊的行動都自己寫了圖示；用到的鍵就是對照表上的那些', () => {
    const { game } = makeBattleGame({ features: allFeatures(), content: [CORE_PACK] })
    const defs = game.k.battle.actionsFor('meat')
    expect(defs.length).toBeGreaterThan(20)
    for (const d of defs) expect(typeof d.icon, d.id).toBe('string')
    const byOwner = (owner: string) => Object.fromEntries(defs.filter((d) => d.owner === owner).map((d) => [d.id, d.icon]))
    expect(byOwner('core')).toEqual({ [END_TURN]: 'end', [MOVE]: 'move' })
    expect(byOwner('combat')).toEqual({ shoot: 'shoot', melee: 'melee', reload: 'reload', swap: 'swap', item: 'item', hit_cover: 'cover', watch: 'watch', subdue: 'subdue', flee: 'flee', surrender: 'surrender' })
    expect(byOwner('summons')).toEqual({ 'drone.deploy': 'drone_deploy', 'drone.command': 'drone_command', 'drone.move': 'drone_move', 'drone.recall': 'drone_recall', 'vehicle.call': 'vehicle', 'node.use': 'node' })
    // 技能：瞄準過的一槍是 aim、把彈匣打光的是 burst，其餘是 skill
    const skills = byOwner('abilities')
    expect(new Set(Object.values(skills))).toEqual(new Set(['aim', 'burst', 'skill']))
    expect(skills).toMatchObject({ sk_gunner_aimed_shot: 'aim', sk_gunner_burst: 'burst', 'sk_fixer_face.give_ap': 'skill', 'sk_fixer_face.call': 'skill' })
    // 現在有圖的（ui/src/data/combatIcons.ts）：aim、burst、cover、flee、item、melee、move、reload、shoot、skill、subdue、swap、watch。
    // 還沒有圖的鍵列在這裡：多了一個就要在 dev/adr/0014 的表補上、並通知介面
    const DRAWN = ['aim', 'burst', 'cover', 'flee', 'item', 'melee', 'move', 'reload', 'shoot', 'skill', 'subdue', 'swap', 'watch']
    const missing = [...new Set(defs.map((d) => d.icon!))].filter((key) => !DRAWN.includes(key)).sort()
    expect(missing).toEqual(['drone_command', 'drone_deploy', 'drone_move', 'drone_recall', 'end', 'node', 'pump', 'surrender', 'vehicle'])
  })
})

describe('E3：要多選一樣東西的行動，選項由引擎列出來（picks）；宣告與行動本身對得上', () => {
  it('現實戰鬥：射擊的掃射、換武器、使用道具', () => {
    const g = start()
    turnTo(g, 'a1')
    // 掃射：手上的武器能掃射才有這一項；只能打人
    expect(opt(g, 'shoot').picks).toEqual([{ key: 'sweep', label: '掃射', kind: 'toggle', required: false, options: [{ value: true, label: expect.stringMatching(/^掃射：花彈匣 2 格/), blocks: [], for: [{ unit: 'f1' }, { unit: 'f2' }] }] }])
    // 換武器：三把都列，手上那一把灰掉、寫出原因
    expect(opt(g, 'swap').picks[0]).toMatchObject({ key: 'weapon', kind: 'choice', required: false })
    expect(opt(g, 'swap').picks[0]!.options).toEqual([{ value: 0, label: '輕機槍', blocks: ['這一把已經拿在手上。'] }, { value: 1, label: '手槍', blocks: [] }, { value: 2, label: '刀', blocks: [] }])
    // 道具：只列能用的（束帶不是這樣用的，不列）；每一種各自適用的目標寫在 for（對一個敵人用的是場上每一個敵人：M1b-core-closeout）
    const item = opt(g, 'item').picks[0]!
    expect(item).toMatchObject({ key: 'item', kind: 'choice', required: true })
    expect(item.options.map((o) => [o.value, o.label, o.blocks, o.for])).toEqual([
      ['it_medgel_1', '急救凝膠 ×2', [], [{ unit: 'a1' }, { unit: 'a2' }, { unit: 'a3' }]],
      ['it_coolant_1', '冷卻劑 ×1', [], [{ unit: 'a1' }]],
      ['it_smoke_1', '煙霧彈 ×1', [], [...[1, 2, 3, 4].map((slot) => ({ side: 'ally', slot })), ...[1, 2, 3, 4].map((slot) => ({ side: 'foe', slot }))]],
      ['it_flash_1', '閃光彈 ×1', [], [{ unit: 'f1' }, { unit: 'f2' }]],
    ])
    expect(item.options[0]!.hint).toEqual({ ap: 1, ap_other: 2, qty: 2 })
    for (const id of ['shoot', 'swap', 'item']) {
      const r = mismatches(g, opt(g, id))
      expect(r.bad, id).toEqual([])
      expect(r.tried, id).toBeGreaterThan(2)
    }
    // 彈匣只剩一格：掃射灰掉、寫出原因；換成不能掃射的槍：沒有這一項
    g.state.battle!.units.a1!.weapons[0]!.mag!.now = 1
    expect(opt(g, 'shoot').picks[0]!.options[0]!.blocks).toEqual(['掃射要彈匣裡有 2 格。'])
    expect(mismatches(g, opt(g, 'shoot')).bad).toEqual([])
    g.state.battle!.units.a1!.wield = 1
    expect(opt(g, 'shoot').picks).toEqual([])
    // 只剩一種能用的道具：可以不選
    g.state.battle!.units.a1!.quick = [{ item: 'it_coolant_1', qty: 1 }, { item: 'it_zip_tie', qty: 1 }]
    expect(opt(g, 'item').picks[0]).toMatchObject({ required: false })
    // 冷卻劑只能自己用：隊友那個目標灰掉、寫出原因（不是按下去才被擋）
    expect(opt(g, 'item').targets.map((t) => [t.target, t.blocks])).toEqual([[{ unit: 'a1' }, []], [{ unit: 'a2' }, ['快取格裡沒有可以用在別人身上的道具。']], [{ unit: 'a3' }, ['要相鄰才用得到。', '快取格裡沒有可以用在別人身上的道具。']]])
    expect(mismatches(g, opt(g, 'item')).bad).toEqual([])
  })

  it('無人機與控制節點：放出哪一台、指揮時對誰、移到哪一格、防爆門放在哪一格', () => {
    const g = start()
    g.state.battle!.nodes.forEach((n) => { n.taken = true })
    turnTo(g, 'a1')
    // 放出：四台都在手上
    expect(opt(g, 'drone.deploy').picks).toEqual([{ key: 'drone', label: '放出哪一台', kind: 'choice', required: true, options: ['攻擊無人機', '醫療無人機', '護盾無人機', '偵察無人機'].map((label, i) => ({ value: i, label, blocks: [] })) }])
    expect(mismatches(g, opt(g, 'drone.deploy')).bad).toEqual([])
    // 放出三台：攻擊型掛第 1 格、醫療型第 2 格、護盾型第 4 格
    for (const [drone, slot] of [[0, 1], [1, 2], [2, 4]]) expect(g.battleAct({ action: 'drone.deploy', target: { side: 'ally', slot: slot! }, pick: { drone } }).status).toBe('applied')
    turnTo(g, 'a1')
    const [atk, med, shd] = g.battle!.overlays.map((o) => o.id)
    expect(opt(g, 'drone.deploy').picks[0]!.options.map((o) => o.blocks)).toEqual([['這一台已經放出去了。'], ['這一台已經放出去了。'], ['這一台已經放出去了。'], []])
    expect(mismatches(g, opt(g, 'drone.deploy')).bad).toEqual([])
    // 指揮：只有攻擊型要選敵人（for 是那一台）；醫療型、護盾型不用選（護盾型指揮 = 守著同一格的人）
    const command = opt(g, 'drone.command')
    expect(command.picks).toEqual([{ key: 'at', label: '對誰', kind: 'foe', required: true, options: ['f1', 'f2'].map((id) => ({ value: id, label: '小隊長', blocks: [], at: { unit: id }, for: [{ overlay: atk }] })) }])
    expect(command.targets.map((t) => [t.target, t.blocks])).toEqual([[{ overlay: atk }, []], [{ overlay: med }, []], [{ overlay: shd }, []]])
    expect(pickProblems(command.picks, { overlay: med }, undefined)).toEqual([])
    expect(pickProblems(command.picks, { overlay: atk }, undefined)).toEqual(['要選對誰。'])
    expect(mismatches(g, command).bad).toEqual([])
    // 移動：每一格只對換得過去的那幾台適用；相鄰的格都掛著別台的那一台，目標灰掉
    const move = opt(g, 'drone.move')
    expect(move.picks[0]).toMatchObject({ key: 'slot', kind: 'ally_slot', required: true })
    expect(move.picks[0]!.options).toEqual([
      { value: 3, label: '第 3 格', blocks: [], at: { side: 'ally', slot: 3 }, for: [{ overlay: med }, { overlay: shd }] },
    ])
    expect(move.targets.map((t) => [t.target, t.blocks])).toEqual([[{ overlay: atk }, ['相鄰的格都掛著別台了。']], [{ overlay: med }, []], [{ overlay: shd }, []]])
    expect(mismatches(g, move).bad).toEqual([])
    // 收回、叫車不用多選
    expect(opt(g, 'drone.recall').picks).toEqual([])
    expect(opt(g, 'vehicle.call').picks).toEqual([])
    // 控制節點：防爆門要選放在哪一格，關燈不用
    const node = opt(g, 'node.use')
    expect(node.picks).toEqual([{ key: 'slot', label: '放在哪一格', kind: 'ally_slot', required: true, options: [1, 2, 3, 4].map((slot) => ({ value: slot, label: `第 ${slot} 格`, blocks: [], at: { side: 'ally', slot }, for: [{ node: 'n2' }] })) }])
    expect(pickProblems(node.picks, { node: 'n1' }, undefined)).toEqual([])
    expect(mismatches(g, node).bad).toEqual([])
  })

  it('技能：瞄準過的一槍可以指定部位、換位子要選另一名相鄰的隊友、叫人要選做哪一件事', () => {
    const g = start()
    turnTo(g, 'a1')
    // 要害射擊：部位可以不選（照擲的）；四個部位是核心的語彙
    expect(opt(g, 'sk_gunner_aimed_shot').picks).toEqual([{ key: 'part', label: '瞄準哪個部位', kind: 'choice', required: false, options: [['limb', '肢體'], ['head', '頭'], ['torso', '軀幹'], ['bridge', '橋']].map(([value, label]) => ({ value, label, blocks: [] })) }])
    // 連射不是瞄準過的射擊：不用多選
    expect(opt(g, 'sk_gunner_burst').picks).toEqual([])
    // 換位子：a2、a3 相鄰，選了 a2 就只能和 a3 換，反過來也是
    expect(opt(g, 'sk_fixer_swap').picks).toEqual([{ key: 'with', label: '和誰交換', kind: 'ally', required: true, options: [
      { value: 'a2', label: '零', blocks: [], at: { unit: 'a2' }, for: [{ unit: 'a3' }] },
      { value: 'a3', label: '喬', blocks: [], at: { unit: 'a3' }, for: [{ unit: 'a2' }] },
    ] }])
    // 叫人：目標有三種，各自適用的寫在 for；敵方沒有遮蔽的格選不了
    const call = opt(g, 'sk_fixer_face.call')
    expect(call.target).toBe('mixed')
    expect(call.ok).toBe(true)
    expect(call.picks[0]).toMatchObject({ key: 'option', kind: 'choice', required: true })
    expect(call.picks[0]!.options.map((o) => [o.value, o.for])).toEqual([
      ['shot', [{ unit: 'f1' }, { unit: 'f2' }]],
      ['cover_up', [1, 2, 3, 4].map((slot) => ({ side: 'ally', slot }))],
      ['cover_down', [{ side: 'foe', slot: 2 }]],
    ])
    expect(call.targets.filter((t) => t.blocks.length).map((t) => [t.target, t.blocks])).toEqual([1, 3, 4].map((slot) => [{ side: 'foe', slot }, ['這一格沒有遮蔽可以拆。']]))
    for (const id of ['sk_gunner_aimed_shot', 'sk_fixer_swap', 'sk_fixer_face.call', 'sk_fixer_face.give_ap']) {
      const r = mismatches(g, opt(g, id))
      expect(r.bad, id).toEqual([])
    }
    // 指定的部位真的用上了：瞄準過的一槍打出重創時照選的部位
    expect(g.battleAct({ action: 'sk_fixer_swap', target: { unit: 'a2' }, pick: { with: 'a3' } }).status).toBe('applied')
    expect([g.battle!.units.a2!.slot, g.battle!.units.a3!.slot]).toEqual([3, 2])
  })

  it('整張行動表掃一遍：每個帶 picks 的行動都對得上；不用多選的行動 picks 是空的', () => {
    const g = start()
    g.state.battle!.nodes.forEach((n) => { n.taken = true })
    turnTo(g, 'a1')
    for (const [drone, slot] of [[0, 1], [3, 3]]) g.battleAct({ action: 'drone.deploy', target: { side: 'ally', slot: slot! }, pick: { drone } })
    turnTo(g, 'a1')
    const actions = g.battleOptions()!.actions
    const withPicks = actions.filter((a) => a.picks.length > 0).map((a) => a.id).sort()
    expect(withPicks).toEqual(['drone.command', 'drone.deploy', 'drone.move', 'item', 'node.use', 'shoot', 'sk_fixer_face.call', 'sk_fixer_swap', 'sk_gunner_aimed_shot', 'swap'])
    let tried = 0
    for (const a of actions) {
      const r = mismatches(g, a)
      expect(r.bad, a.id).toEqual([])
      tried += r.tried
    }
    expect(tried).toBeGreaterThan(60)
  })
})
