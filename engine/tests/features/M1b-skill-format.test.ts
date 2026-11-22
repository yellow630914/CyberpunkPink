// 驗收測試：dev/work/M1b-skill-format.md（cpp-feature）。技能格式的通則：消耗（照戰場分、錢與人情的池、每件委託、共用次數的組）、
// 條件（needs、when、range）、效果清單（do、choose、picks）、被動的修正（mods）、姿態、反應（每一種 on）、alter、buff、預備、格式檢查。
// 規格：SKILLS 1.1、1.2、1.8、1.11 節；dev/adr/0015 第一節與 E1～E4；每個技能都是測試自帶的假資料，不讀 engine/data。

import { describe, expect, it } from 'vitest'
import type { BattleActionOption, BattleInput, BattleSetup, BattleTarget, BattleUnit, ContentPack, Kernel } from '../../src'
import { BattleBlocked, BattleRun, LOSE_TURN, battleAct, pickApplies, pickProblems, readyFeatures, toMinutes } from '../../src'
import { abilitiesFeature, equipAbilities, learn, prep, prepBlock } from '../../src/features/abilities'
import { combatFeature } from '../../src/features/combat'
import { makeBattleGame, makeGame, testWeapon } from '../../src/testkit'
import type { Arena } from '../helpers/battle'
import { TEST_STATUSES, arena, duel, foe, one } from '../helpers/battle'

type Rec = Record<string, unknown>
const FEATURES = [combatFeature, abilitiesFeature]

// ---- 假資料 ----

const TREE = { id: 'tree', name: '測試路數', tree: '測試樹', category: 'meat', signature: 'sk_root', domains: { meat: 'strong', net: 'none', opinion: 'none' }, resonance: [] as Rec[] }
const ab = (id: string, kind: string, more: Rec = {}): Rec => ({
  id, name: id, path: 'tree', category: 'meat', tier: 1, layer: 'front', kind, cap: 1, xp: 20, cells: 1, after: 'sk_root', text: `${id}。`, net: null, opinion: null, meat: null, ...more,
})
const ROOT = ab('sk_root', 'passive', { layer: 'signature', after: undefined, name: '根' })
const pack = (abilities: Rec[], extra: Rec = {}, tree: Rec = TREE): ContentPack => ({
  id: 'fmt_test',
  content: { battle_status: [...TEST_STATUSES, { id: 'limb_hurt', name: '肢體受創', desc: '命中 −2。', mods: { hit: -2 }, until: 'battle_end', kind: 'wound' }], path: [tree], ability: [ROOT, ...abilities], ...extra },
} as unknown as ContentPack)

/** 裝著這幾個技能、樹開到第 3 階。 */
const equip = (...ids: string[]) => ({ abilities: { equipped: ids, tiers: { tree: 3 } } })
/** 我：有角色、行動點很多、拿手槍。 */
const me = (ids: string[], o: Rec = {}) => one({ actor: 'pc', weapon: 'pistol', ap: { now: 20, max: 20, regen: 3 }, ext: equip(...ids), ...o } as never)
/** 不動的敵人（行動點 0，輪到就結束）。 */
const idle = (o: Rec = {}) => foe('minion', { ap: { now: 0, max: 0, regen: 0 }, ...o } as never)
const dice = (...v: number[]) => [...v, ...Array(120).fill(1)]

interface PlayOpts {
  mates?: unknown[]
  foes?: unknown[]
  me?: Rec
  cover?: { ally: number[]; foe: number[] }
  more?: Partial<BattleSetup>
  game?: Rec
  extra?: Rec
  tree?: Rec
  seed?: number
}
/** 一局已經開打的遊戲：a1 是我（裝著 abilities 的每一個技能）。 */
function play(abilities: Rec[], o: PlayOpts = {}) {
  const ids = abilities.map((a) => a.id as string)
  return makeBattleGame({
    features: FEATURES, content: [pack(abilities, o.extra, o.tree)], seed: o.seed ?? 7, ...(o.game ?? {}),
    battle: duel([me(ids, o.me), ...(o.mates ?? [one({ weapon: 'pistol' }, 2), one({ weapon: 'pistol' }, 3)])], o.foes ?? [idle(), idle()], o.cover, o.more),
  }).game
}
type G = ReturnType<typeof play>
const turnTo = (g: G, id: string): BattleUnit => {
  const b = g.state.battle!
  b.turn = b.order.indexOf(id)
  const u = b.units[id]!
  u.ap.now = u.ap.max
  u.control = 'player'
  return u
}
const opt = (g: G, id: string): BattleActionOption => g.battleOptions()!.actions.find((a) => a.id === id)!
const unit = (g: G, id: string): BattleUnit => g.state.battle!.units[id]!
/** 這一步照現在的狀態成不成立（純算，不提交）；不成立回傳原因。 */
const tryAct = (g: G, input: BattleInput): string[] | null => {
  try {
    battleAct(g.k, g.state, input)
    return null
  } catch (e) {
    if (e instanceof BattleBlocked) return e.reasons
    throw e
  }
}
/** 現在 unit 這個數字的所有修正（照核心的問法）。 */
const modsOf = (g: G, kind: Parameters<BattleRun['mods']>[0], id: string, tags: string[] = [], other?: string) => {
  const run = new BattleRun(g.k, g.state, g.state.battle!)
  return run.mods(kind, run.unit(id), other ? run.unit(other) : undefined, undefined, tags)
}
const total = (parts: Array<{ value: number; source?: string }>): number => parts.filter((p) => p.source === undefined || p.source === 'skill').reduce((s, p) => s + p.value, 0)
const finish = async (g: G, outcome = 'win') => {
  g.state.battle!.result = { outcome, text: '測試用。' }
  return (await g.finishBattle()).reports[0]!
}

/** 宣告與行動本身對不對得上（和 M1-picks 同一套驗法）：回傳對不上的地方與一共驗了幾步。 */
function mismatches(g: G, a: BattleActionOption): { bad: string[]; tried: number } {
  const bad: string[] = []
  let tried = 0
  if (a.blocks.length) return { bad, tried }
  const targets: Array<BattleTarget | null> = a.target === 'none' ? [null] : a.targets.filter((t) => t.blocks.length === 0).map((t) => t.target)
  for (const target of targets) {
    const at = JSON.stringify(target)
    const input = (pick: Rec): BattleInput => ({ action: a.id, ...(target ? { target } : {}), ...(Object.keys(pick).length ? { pick } : {}) })
    const base: Rec = {}
    let possible = true
    for (const p of a.picks) {
      const usable = p.options.filter((o) => pickApplies(o, target) && o.blocks.length === 0)
      if (p.required && p.options.some((o) => pickApplies(o, target))) {
        if (usable.length) base[p.key] = usable[0]!.value
        else possible = false
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
      }
    }
  }
  return { bad, tried }
}

// ---- 不經過提交的場地（反應、修正、buff 用） ----

const quiet = { ap: { now: 0, max: 0, regen: 0 } }
/** 三對三：a1 是我（裝著全部的技能）、a2、a3 是隊友，敵人命中很高。 */
function field(abilities: Rec[], o: { allies?: unknown[]; foes?: unknown[]; cover?: { ally: number[]; foe: number[] }; extra?: Rec; tree?: Rec } = {}): Arena {
  const ids = abilities.map((a) => a.id as string)
  return arena(
    duel(o.allies ?? [me(ids), one({ weapon: 'pistol' }, 2), one({ weapon: 'pistol' }, 3)], o.foes ?? [foe('minion', { weapons: [testWeapon('pistol', 30)], ...quiet } as never), foe('minion', quiet as never)], o.cover),
    FEATURES, (k: Kernel) => {
      k.content.loadPack(pack(abilities, o.extra, o.tree))
      readyFeatures(k)
    },
  )
}
const SRC = { kind: 'ability', id: 'sk_x', name: '測試技能' } as const
/** 這一步的紀錄裡，某個技能觸發了幾次。 */
const fired = (run: BattleRun, id: string): number => run.beats.filter((b) => b.tag === 'skill' && (b.data as Rec | undefined)?.ability === id).length

// =====================================================================================

describe('格式檢查：不認得的鍵、who、on、公式，載入時擋下，訊息裡有那個字', () => {
  const load = (a: Rec, more: Rec = {}) => () => makeGame({ features: FEATURES, content: [pack([a], more)] })
  const act = (meat: Rec, more: Rec = {}) => ab('sk_x', 'active', { use: { ap: 1 }, meat: { target: 'enemy', ...meat }, ...more })
  const passive = (mods: unknown) => ab('sk_x', 'passive', { meat: { mods } })
  const reaction = (trigger: unknown, more: Rec = {}) => ab('sk_x', 'reaction', { use: { ap: 1 }, meat: { trigger, do: [{ op: 'heal', who: 'self', amount: 1 }], ...more } })

  it('合格的通用格式載得進來（對照組）', () => {
    expect(load(act({ needs: { bridged: true, rank: ['elite'] }, when: { wield: 'pistol', slot: [1, 2] }, range: [1, 3], do: [{ op: 'attack' }] }))).not.toThrow()
    expect(load(passive([{ kind: 'evade', value: { by_tier: [1, 2, 3, 4, 5] }, who: 'adjacent', when: { in_cover: true } }]))).not.toThrow()
    expect(load(reaction({ on: 'attacked', who: 'ally' }, { react: { redirect: 'overlay' } }))).not.toThrow()
    expect(load(ab('sk_x', 'prep', { prep: { slot: 1, scope: 'next_battle', meat: { mods: [{ kind: 'evade', value: 1 }] } } }))).not.toThrow()
  })

  it.each([
    ['use.cash 的公式不能擲骰', act({}, { use: { cash: '2d6' } }), /2d6/],
    ['use.favor 只有三種', act({}, { use: { favor: 'huge' } }), /huge/],
    ['use.group 要和 per_turn 一起寫', act({}, { use: { ap: 1, group: 'g' } }), /group/],
    ['use.slot 只有預備與日常', act({}, { use: { ap: 1, slot: 1 } }), /use\.slot/],
    ['use 照戰場分之後，這一層不能再放別的鍵', act({}, { use: { meat: { ap: 1 }, ap: 1 } }), /use\.ap/],
    ['use.net 裡不認得的鍵', act({}, { use: { meat: { ap: 1 }, net: { cooldown: 2 } } }), /cooldown/],
    ['needs 不認得的鍵', act({ needs: { dragon: true } }), /dragon/],
    ['needs.rank 不認得的位階', act({ needs: { rank: ['giant'] } }), /rank/],
    ['when 不認得的鍵', act({ when: { ghostwalk: true } }), /ghostwalk/],
    ['when.slot 超出 1～4', act({ when: { slot: 9 } }), /meat\.when\.slot/],
    ['mods 才有的 when（in_cover）不能放在 meat.when', act({ when: { in_cover: true } }), /in_cover/],
    ['range 近大於遠', act({ range: [3, 1] }), /meat\.range/],
    ['picks 的 kind 不在清單裡', act({ picks: [{ key: 'k', label: 'k', kind: 'planet' }] }), /planet/],
    ['do 裡不認得的 op', act({ do: [{ op: 'ghost_op' }] }), /ghost_op/],
    ['do 裡不認得的 who', act({ do: [{ op: 'attack', who: 'everyone' }] }), /everyone/],
    ['do 裡的公式寫錯', act({ do: [{ op: 'heal', who: 'self', amount: 'grade*x' }] }), /grade\*x/],
    ['choose 的 key 重複', act({ choose: [{ key: 'a', label: 'a', do: [{ op: 'attack' }] }, { key: 'a', label: 'b', do: [{ op: 'attack' }] }] }), /重複/],
    ['do_on 只有姿態用', act({ do_on: [{ op: 'attack' }] }), /do_on/],
    ['mods 的 kind 不在清單裡', passive([{ kind: 'luck', value: 1 }]), /luck/],
    ['mods 的公式寫錯', passive([{ kind: 'hit', value: 'banana' }]), /banana/],
    ['mods 的公式不能擲骰', passive([{ kind: 'hit', value: '1d6' }]), /1d6/],
    ['mods 的 who 不在清單裡', passive([{ kind: 'hit', value: 1, who: 'everyone' }]), /everyone/],
    ['mods 的 when 不認得的鍵', passive([{ kind: 'hit', value: 1, when: { moon: true } }]), /moon/],
    ['mods 的 per_fight 只有 action_ap、action_ram 用', passive([{ kind: 'hit', value: 1, per_fight: 2 }]), /per_fight/],
    ['mods 的 by_tier 要是五個數字', passive([{ kind: 'hit', value: { by_tier: [1, 2] } }]), /by_tier/],
    ['mods 只有被動與姿態用', act({ mods: [{ kind: 'hit', value: 1 }] }), /meat\.mods/],
    ['trigger 的 on 不在清單裡', reaction({ on: 'sometime', who: 'self' }), /sometime/],
    ['trigger 的 who 不能用在這個 on', reaction({ on: 'attacked', who: 'foe_by_self' }), /foe_by_self/],
    ['trigger 的 if 不能用在這個 on', reaction({ on: 'hit', who: 'self', if: 'miss' }), /miss/],
    ['react 的鍵不能用在這個 on', reaction({ on: 'hit', who: 'self' }, { react: { redirect: 'overlay' } }), /redirect/],
    ['trigger 要搭配 react 或 do', ab('sk_x', 'reaction', { use: { ap: 1 }, meat: { trigger: { on: 'attacked', who: 'self' } } }), /react 或 do/],
    ['alter 要改的技能不存在', ab('sk_x', 'passive', { meat: { alter: [{ ability: 'sk_ghost', set: { 'attack.hit': 1 } }] } }), /sk_ghost/],
    ['alter 的路徑要從 meat 的鍵開始', ab('sk_x', 'passive', { meat: { alter: [{ ability: 'sk_root', set: { 'moon.hit': 1 } }] } }), /moon/],
    ['prep.scope 不在清單裡', ab('sk_x', 'prep', { prep: { slot: 1, scope: 'someday', meat: { do: [{ op: 'heal', who: 'self', amount: 1 }] } } }), /someday/],
    ['prep.meat 只有預備技能用', ab('sk_x', 'active', { prep: { slot: 1, scope: 'next_battle', meat: { mods: [{ kind: 'hit', value: 1 }] } } }), /prep\.meat/],
    ['buff 的 turns 要是正整數', act({ do: [{ op: 'buff', id: 'b', turns: 0, mods: [{ kind: 'hit', value: 1 }] }] }), /turns/],
    ['buff 的 until 不在清單裡', act({ do: [{ op: 'buff', id: 'b', until: 'someday', mods: [{ kind: 'hit', value: 1 }] }] }), /someday/],
    ['buff 的 on_end 也查 op', act({ do: [{ op: 'buff', id: 'b', on_end: [{ op: 'ghost_op' }] }] }), /ghost_op/],
  ] as Array<[string, Rec, RegExp]>)('%s', (_name, a, re) => {
    expect(load(a)).toThrow(re)
  })

  it('舊的字串 trigger、不認得的舊鍵照舊擋下；對有橋的路數寫 none 的欄位照舊要 null', () => {
    expect(load(ab('sk_x', 'reaction', { use: { ap: 1 }, meat: { trigger: 'ally_attacked', evade: 3 } }))).not.toThrow()
    expect(load(ab('sk_x', 'reaction', { use: { ap: 1 }, meat: { trigger: 'ally_died' } }))).toThrow(/ally_died/)
    expect(load(act({ summon_dragon: 1 }))).toThrow(/summon_dragon/)
  })
})

describe('消耗：照戰場分、行動點以外的池（RAM、現金、人情）', () => {
  it('use 照戰場分：meat 那一組是現實的花費，net、opinion 那兩組這一張不讀', () => {
    const g = play([ab('sk_x', 'active', { use: { meat: { ap: 2 }, net: { ap: 5 }, opinion: { ap: 9 } }, meat: { target: 'enemy', do: [{ op: 'attack' }] } })])
    turnTo(g, 'a1')
    expect(opt(g, 'sk_x').cost).toEqual({ ap: 2 })
    // 直接寫一組就是每個戰場都一樣
    const h = play([ab('sk_y', 'active', { use: { ap: 3 }, meat: { target: 'enemy', do: [{ op: 'attack' }] } })])
    turnTo(h, 'a1')
    expect(opt(h, 'sk_y').cost).toEqual({ ap: 3 })
  })

  it('ram_all_min：花掉手上全部的 RAM，至少要有這麼多；花掉的數字是公式的 spent', () => {
    const g = play([ab('sk_ram', 'active', { use: { ap: 1, ram_all_min: 3 }, meat: { do: [{ op: 'heal', who: 'self', amount: 'spent' }] } })])
    turnTo(g, 'a1').hp!.now = 10
    expect(opt(g, 'sk_ram').cost).toEqual({ ap: 1, ram: 4 })
    expect(g.battleAct({ action: 'sk_ram' }).status).toBe('applied')
    expect(unit(g, 'a1').pools.ram!.now).toBe(0)
    expect(unit(g, 'a1').hp!.now).toBe(14)
    // 不到最低的 RAM：灰掉，寫出最低是多少、現在有多少
    turnTo(g, 'a1').pools.ram!.now = 2
    expect(opt(g, 'sk_ram').ok).toBe(false)
    expect(opt(g, 'sk_ram').blocks).toEqual(['要有 3 點以上的 RAM 才能用（現在 2 點）。'])
  })

  describe('use.cash（E2）', () => {
    const skill = ab('sk_pay', 'active', { use: { ap: 1, cash: 'grade*500' }, meat: { target: 'enemy', do: [{ op: 'attack' }] } })
    it('錢不夠時灰掉，原因寫出要多少與有多少；夠的時候照場景等級算', async () => {
      const g = play([skill], { game: { patch: { money: { cred: 0, cash: 300 } } } })
      turnTo(g, 'a1')
      expect(opt(g, 'sk_pay').cost).toEqual({ ap: 1, cash: 500 })
      expect(opt(g, 'sk_pay').ok).toBe(false)
      expect(opt(g, 'sk_pay').blocks.join('')).toMatch(/要 500.*現在 300/)
      expect(unit(g, 'a1').pools.cash).toEqual({ now: 300, max: 300, regen: 0 })
      // 等級 III 的場景：1500
      const h = play([skill], { game: { patch: { money: { cred: 0, cash: 1000 } } }, more: { grade: 3 } })
      turnTo(h, 'a1')
      expect(opt(h, 'sk_pay').cost).toEqual({ ap: 1, cash: 1500 })
      expect(opt(h, 'sk_pay').ok).toBe(false)
    })

    it('用了之後，戰鬥結束的報告裡有一筆扣現金的變更，金額對；現金真的少了', async () => {
      const g = play([skill], { game: { patch: { money: { cred: 0, cash: 1200 } } } })
      turnTo(g, 'a1')
      expect(g.battleAct({ action: 'sk_pay', target: { unit: 'f1' } }).status).toBe('applied')
      expect(unit(g, 'a1').pools.cash!.now).toBe(700)
      turnTo(g, 'a1')
      expect(g.battleAct({ action: 'sk_pay', target: { unit: 'f1' } }).status).toBe('applied')
      const end = await finish(g)
      expect(end.changes.filter((c) => c.op === 'cash')).toEqual([{ op: 'cash', delta: -1000 }])
      expect(g.state.money.cash).toBe(200)
    })

    it('沒有用的話沒有這一筆變更', async () => {
      const g = play([skill], { game: { patch: { money: { cred: 0, cash: 1200 } } } })
      const end = await finish(g)
      expect(end.changes.some((c) => c.op === 'cash')).toBe(false)
      expect(g.state.money.cash).toBe(1200)
    })
  })

  describe('use.favor（E2）', () => {
    const skill = ab('sk_owe', 'active', { use: { ap: 1, favor: 'mid' }, meat: { target: 'enemy', do: [{ op: 'attack' }] } })
    it('池是 0 時灰掉；有的時候用掉一個，戰鬥結束時差額寫回 actor.ext.favors', async () => {
      const none = play([skill])
      turnTo(none, 'a1')
      expect(unit(none, 'a1').pools.favor_mid).toEqual({ now: 0, max: 0, regen: 0 })
      expect(opt(none, 'sk_owe').cost).toEqual({ ap: 1, favor_mid: 1 })
      expect(opt(none, 'sk_owe').ok).toBe(false)
      expect(opt(none, 'sk_owe').blocks.join('')).toMatch(/要 1.*現在 0/)

      const g = play([skill], { game: { pc: { ext: { favors: { small: 2, mid: 1, big: 0 } } } } })
      turnTo(g, 'a1')
      expect(unit(g, 'a1').pools.favor_small!.now).toBe(2)
      expect(g.battleAct({ action: 'sk_owe', target: { unit: 'f1' } }).status).toBe('applied')
      expect(unit(g, 'a1').pools.favor_mid!.now).toBe(0)
      turnTo(g, 'a1')
      expect(opt(g, 'sk_owe').ok).toBe(false)
      await finish(g)
      expect(g.state.actors.pc!.ext.favors).toEqual({ small: 2, mid: 0, big: 0 })
    })
  })

  describe('use.per_commission（E3）', () => {
    const skill = ab('sk_once', 'active', { use: { ap: 1, per_commission: 1 }, meat: { target: 'enemy', do: [{ op: 'attack' }] } })
    const setup = (commission?: string): BattleSetup => ({
      mode: 'meat', grade: 1, cover: { ally: [0, 0, 0, 0], foe: [0, 0, 0, 0] },
      allies: [{ from: 'unit', unit: me(['sk_once']) as never }], foes: [{ from: 'unit', unit: idle() as never }, { from: 'unit', unit: idle() as never }],
      ...(commission ? { origin: { ext: { commission } } } : {}),
    })
    it('同一個 origin.ext.commission 的第二場用不了，換一個鍵又可以；沒有鍵的戰鬥各算一件', async () => {
      const g = play([skill], { more: { origin: { ext: { commission: 'c1' } } } })
      turnTo(g, 'a1')
      expect(opt(g, 'sk_once').ok).toBe(true)
      expect(g.battleAct({ action: 'sk_once', target: { unit: 'f1' } }).status).toBe('applied')
      turnTo(g, 'a1')
      expect(opt(g, 'sk_once').blocks).toEqual(['這件委託的次數用完了（每件委託 1 次）。'])
      const end = await finish(g)
      expect(g.state.actors.pc!.ext.abilities).toMatchObject({ commission: { c1: { sk_once: 1 } } })
      expect(end.changes.some((c) => c.op === 'actor.ext')).toBe(true)

      // 同一件委託的下一場：一開打就用不了
      g.startBattle(setup('c1'))
      turnTo(g, 'a1')
      expect(opt(g, 'sk_once').blocks).toEqual(['這件委託的次數用完了（每件委託 1 次）。'])
      expect(unit(g, 'a1').uses['commission:sk_once']).toBe(1)
      await finish(g)
      // 換一件委託：又可以
      g.startBattle(setup('c2'))
      turnTo(g, 'a1')
      expect(opt(g, 'sk_once').ok).toBe(true)
      await finish(g)
      // 沒有鍵的戰鬥：每一場各算一件
      g.startBattle(setup())
      turnTo(g, 'a1')
      expect(opt(g, 'sk_once').ok).toBe(true)
    })
  })

  it('use.group：同一組的兩個技能，一回合合計只能用一次；下一個自己的回合又可以', () => {
    const skills = [
      ab('sk_g1', 'active', { use: { ap: 1, per_turn: 1, group: 'quick' }, meat: { target: 'enemy', do: [{ op: 'attack' }] } }),
      ab('sk_g2', 'active', { use: { ap: 1, per_turn: 1, group: 'quick' }, meat: { target: 'enemy', do: [{ op: 'attack' }] } }),
      ab('sk_g3', 'active', { use: { ap: 1, per_turn: 1 }, meat: { target: 'enemy', do: [{ op: 'attack' }] } }),
    ]
    const g = play(skills, { me: { weapons: [{ ...testWeapon('pistol', 5), mag: { now: 9, max: 9 } }] } })
    turnTo(g, 'a1')
    expect(opt(g, 'sk_g2').ok).toBe(true)
    expect(g.battleAct({ action: 'sk_g1', target: { unit: 'f1' } }).status).toBe('applied')
    expect(opt(g, 'sk_g2').ok).toBe(false)
    expect(opt(g, 'sk_g2').blocks).toEqual(['這一回合「quick」這一組的技能已經用了 1 次，不能再用。'])
    expect(opt(g, 'sk_g1').ok).toBe(false)
    // 不在這一組的照自己算
    expect(opt(g, 'sk_g3').ok).toBe(true)
    expect(unit(g, 'a1').uses['turn:group:quick']).toBe(1)
    // 回合結束、輪回來：組的次數也清掉了（回合的次數都記在 turn: 開頭的鍵）
    expect(g.battleAct({ action: 'end_turn' }).status).toBe('applied')
    for (let i = 0; i < 80 && g.battle!.order[g.battle!.turn] !== 'a1'; i++) g.battleNext({ anyone: true })
    expect(g.battle!.order[g.battle!.turn]).toBe('a1')
    expect(opt(g, 'sk_g2').ok).toBe(true)
  })

  it('first_round、not_first_round', () => {
    const g = play([
      ab('sk_r1', 'active', { use: { ap: 1, first_round: true }, meat: { target: 'enemy', do: [{ op: 'attack' }] } }),
      ab('sk_r2', 'active', { use: { ap: 1, not_first_round: true }, meat: { target: 'enemy', do: [{ op: 'attack' }] } }),
    ])
    turnTo(g, 'a1')
    expect(opt(g, 'sk_r1').ok).toBe(true)
    expect(opt(g, 'sk_r2').blocks).toEqual(['第一回合不能用。'])
    g.state.battle!.round = 2
    expect(opt(g, 'sk_r1').blocks).toEqual(['只能在第一回合用。'])
    expect(opt(g, 'sk_r2').ok).toBe(true)
  })
})

describe('條件：needs、when、range 每一種各一句灰掉的原因（完整的句子）', () => {
  /** 一個技能，看 a1 能不能用、對每個目標灰掉的原因。 */
  const conds = (meat: Rec, o: PlayOpts = {}, mutate: (g: G) => void = () => {}) => {
    const g = play([ab('sk_c', 'active', { use: { ap: 1 }, meat: { target: 'enemy', ...meat } })], o)
    turnTo(g, 'a1')
    mutate(g)
    const a = opt(g, 'sk_c')
    return { action: a.blocks, targets: a.targets.map((t) => t.blocks) }
  }
  const plain = idle({ name: '雜兵甲', load: undefined })
  it.each([
    ['needs.bridged', { needs: { bridged: true } }, [plain, idle()], ['雜兵甲要有橋才能用。']],
    ['needs.cyber', { needs: { cyber: true } }, [idle({ name: '雜兵甲' }), idle()], ['雜兵甲要有義體才能用。']],
    ['needs.status', { needs: { status: 'marked' } }, [idle({ name: '雜兵甲' }), idle()], ['雜兵甲要帶著標記才能用。']],
    ['needs.no_rank', { needs: { no_rank: ['minion'] } }, [idle({ name: '雜兵甲' }), idle()], ['不能對雜兵用（雜兵甲是雜兵）。']],
    ['needs.rank', { needs: { rank: ['elite', 'boss'] } }, [idle({ name: '雜兵甲' }), idle()], ['只能對精英或首領用（雜兵甲是雜兵）。']],
    ['needs.wounded', { needs: { wounded: true } }, [idle({ name: '雜兵甲' }), idle()], ['雜兵甲要是重傷（生命低於一半）才能用。']],
    ['needs.afterglow', { needs: { afterglow: 2 } }, [idle({ name: '雜兵甲' }), idle()], ['雜兵甲要疊著 2 層以上的餘韻才能用（現在 0 層）。']],
    ['needs.tag', { needs: { tag: 'drone' } }, [idle({ name: '雜兵甲' }), idle()], ['雜兵甲要帶著「drone」標籤才能用。']],
  ] as Array<[string, Rec, unknown[], string[]]>)('%s：目標不符時的那一句；符合的目標沒有原因', (_n, meat, foes, expected) => {
    const r = conds(meat, { foes }, (g) => {
      // 讓第二個目標符合每一種條件
      const f2 = unit(g, 'f2')
      f2.statuses.push({ id: 'marked', until: { at: 'battle_end' } })
      f2.hp!.now = 10
      f2.layers = 2
      f2.tags.push('drone')
      f2.cyber = 1
      f2.rank = 'boss'
    })
    expect(r.action).toEqual([])
    expect(r.targets).toEqual([expected, []])
  })

  it('needs.bridged 為 false 時反過來：有橋的不能用', () => {
    const r = conds({ needs: { bridged: false } }, { foes: [idle({ name: '雜兵甲' })] })
    expect(r.targets).toEqual([['雜兵甲有橋，不能對有橋的人用。']])
  })

  it('range：近身是 [1, 1]；超出的目標各寫出現在的距離', () => {
    expect(conds({ range: [1, 1] }).targets).toEqual([[], ['目標要在近身的距離（雙方都站第 1 格），現在距離 2。']])
    expect(conds({ range: [3, 5] }).targets).toEqual([['目標要在距離 3～5 以內，現在距離 1。'], ['目標要在距離 3～5 以內，現在距離 2。']])
    expect(conds({ range: [2, 2] }).targets).toEqual([['目標要正好在距離 2，現在距離 1。'], []])
  })

  it.each([
    ['when.wield', { when: { wield: 'rifle' } }, ['手上要拿著rifle類的武器才能用。']],
    ['when.wield（幾種任選一種）', { when: { wield: ['rifle', 'sniper'] } }, ['手上要拿著rifle或sniper類的武器才能用。']],
    ['when.mag_min', { when: { mag_min: 5 } }, ['彈匣裡要有 5 格以上才能用。']],
    ['when.hull（要在機甲狀態）', { when: { hull: true } }, ['要在機甲狀態才能用。']],
    ['when.stance', { when: { stance: 'sk_root' } }, ['要先開著「根」姿態才能用。']],
    ['when.slot', { when: { slot: [3, 4] } }, ['要站在第 3、4 格才能用。']],
    ['when.node_taken', { when: { node_taken: true } }, ['要先接管一個控制節點才能用。']],
    ['when.node_taken（指定種類）', { when: { node_taken: 'door' } }, ['要先接管door類的控制節點才能用。']],
  ] as Array<[string, Rec, string[]]>)('%s：自己的條件不符時，整個行動灰掉、寫那一句', (_n, meat, expected) => {
    const r = conds(meat)
    expect(r.action).toEqual(expected)
    // 條件是自己的，不是目標的：每個目標本身沒有原因
    expect(r.targets).toEqual([[], []])
  })

  it('when.hull 為 false：機甲狀態下不能用；when 符合時沒有原因', () => {
    expect(conds({ when: { hull: false } }, {}, (g) => { unit(g, 'a1').hull = { id: 'h', name: '機甲', hp: { now: 9, max: 9 }, armor: 0, backlash: 0 } }).action).toEqual(['機甲狀態下不能用。'])
    expect(conds({ when: { wield: 'pistol', slot: 1, mag_min: 2 } }).action).toEqual([])
  })

  it('每一句都是完整的句子：以句號結尾、不含欄位的名字', () => {
    const all = [
      ...conds({ needs: { bridged: true, cyber: true, status: 'marked', no_rank: ['minion'], rank: ['boss'], wounded: true, afterglow: 1, tag: 'x' }, range: [3, 4] }, { foes: [idle({ load: undefined })] }).targets.flat(),
      ...conds({ when: { wield: 'rifle', mag_min: 9, hull: true, stance: 'sk_root', slot: 4, node_taken: true } }).action,
    ]
    expect(all.length).toBeGreaterThanOrEqual(12)
    for (const s of all) {
      expect(s, s).toMatch(/。$/)
      expect(s, s).not.toMatch(/mag_min|node_taken|no_rank|wield|afterglow|needs|when/)
    }
  })

  it('目標種類：near（自己或相鄰的隊友）、downed_near（相鄰倒下的）、own_overlay、foe_overlay、ally_or_self', () => {
    const g = play([
      ab('sk_near', 'active', { use: { ap: 1 }, meat: { target: 'near', do: [{ op: 'heal', amount: 1 }] } }),
      ab('sk_down', 'active', { use: { ap: 1 }, meat: { target: 'downed_near', do: [{ op: 'revive', hp: 5 }] } }),
      ab('sk_self', 'active', { use: { ap: 1 }, meat: { target: 'ally_or_self', do: [{ op: 'heal', amount: 1 }] } }),
      ab('sk_own', 'active', { use: { ap: 1 }, meat: { target: 'own_overlay', do: [{ op: 'damage', amount: 1 }] } }),
      ab('sk_foeo', 'active', { use: { ap: 1 }, meat: { target: 'foe_overlay', range: [1, 2], do: [{ op: 'damage', amount: 1 }] } }),
    ], { mates: [one({ weapon: 'pistol' }, 2), one({ weapon: 'pistol' }, 3)] })
    const a1 = turnTo(g, 'a1')
    const run = new BattleRun(g.k, g.state, g.state.battle!)
    run.addOverlay({ side: 'ally', slot: 1, owner: 'a1', kind: 'drone', name: '我的無人機', hp: { now: 9, max: 9 }, armor: 0, evade: 0 })
    run.addOverlay({ side: 'foe', slot: 3, kind: 'turret', name: '砲塔', hp: { now: 9, max: 9 }, armor: 0, evade: 0 })
    // 相鄰的是 a2；a3 在第 3 格，不相鄰
    const near = opt(g, 'sk_near')
    expect(near.target).toBe('unit')
    expect(near.targets.map((t) => t.blocks)).toEqual([[], [], ['喬不在相鄰的格子，只能對自己或相鄰的隊友用。']])
    expect(opt(g, 'sk_self').targets.map((t) => [t.target, t.blocks])).toEqual([[{ unit: 'a1' }, []], [{ unit: 'a2' }, []], [{ unit: 'a3' }, []]])
    // 倒下的：沒有倒下的人就沒有目標；a2（相鄰）因生命歸零倒下之後就有了，不相鄰的 a3 灰掉
    expect(opt(g, 'sk_down').ok).toBe(false)
    unit(g, 'a2').out = 'down'
    unit(g, 'a2').hp!.now = 0
    unit(g, 'a3').out = 'down'
    unit(g, 'a3').hp!.now = 0
    const down = opt(g, 'sk_down')
    expect(down.targets.map((t) => [t.target, t.blocks.length])).toEqual([[{ unit: 'a2' }, 0], [{ unit: 'a3' }, 1]])
    expect(g.battleAct({ action: 'sk_down', target: { unit: 'a2' } }).status).toBe('applied')
    expect(unit(g, 'a2').out).toBeUndefined()
    expect(unit(g, 'a2').hp!.now).toBe(5)
    // 自己的一台、敵方的一台（距離也算）
    expect(opt(g, 'sk_own').targets.map((t) => t.blocks)).toEqual([[]])
    expect(opt(g, 'sk_foeo').targets.map((t) => t.blocks)).toEqual([['目標要在距離 1～2 以內，現在距離 3。']])
    expect(opt(g, 'sk_own').target).toBe('overlay')
    expect(a1.out).toBeUndefined()
  })
})

describe('do、choose、picks：效果清單、幾種用法挑一種、目標以外要選的', () => {
  const TWO = ab('sk_two', 'active', {
    name: '連打', use: { ap: 1 },
    meat: { target: 'enemy', picks: [{ key: 'also', label: '補一槍打誰', kind: 'foe', required: true }], do: [{ op: 'attack' }, { op: 'attack', who: 'pick:also', if: 'downed' }] },
  })
  const strong = { weapons: [{ ...testWeapon('pistol', 40), mag: { now: 9, max: 9 } }] }
  const sturdy = (hp: number) => idle({ hp: { now: hp, max: 200 }, armor: 0 })

  it('「打一槍，打倒的話再對另一個選好的敵人打一槍」動得起來：打倒了才補', () => {
    const g = play([TWO], { me: strong, foes: [sturdy(1), sturdy(200), sturdy(200)] })
    turnTo(g, 'a1')
    const r = g.battleAct({ action: 'sk_two', target: { unit: 'f1' }, pick: { also: 'f2' } })
    expect(r.status).toBe('applied')
    expect(unit(g, 'f1').out).toBe('down')
    expect(unit(g, 'f2').hp!.now).toBeLessThan(200)
    expect(unit(g, 'f3').hp!.now).toBe(200)
    // 第一槍沒打倒：不補
    const h = play([TWO], { me: strong, foes: [sturdy(200), sturdy(200), sturdy(200)] })
    turnTo(h, 'a1')
    expect(h.battleAct({ action: 'sk_two', target: { unit: 'f1' }, pick: { also: 'f2' } }).status).toBe('applied')
    expect(unit(h, 'f1').out).toBeUndefined()
    expect(unit(h, 'f2').hp!.now).toBe(200)
  })

  it('宣告的 picks 和 run 讀的對得上（M1-picks 那一類的逐項驗法）；少選或選了沒有的選項被擋下', () => {
    const g = play([TWO], { me: strong, foes: [sturdy(1), sturdy(200), sturdy(200)] })
    turnTo(g, 'a1')
    const a = opt(g, 'sk_two')
    expect(a.picks).toEqual([{
      key: 'also', label: '補一槍打誰', kind: 'foe', required: true,
      options: ['f1', 'f2', 'f3'].map((id) => ({ value: id, label: '保全', blocks: [], at: { unit: id } })),
    }])
    const r = mismatches(g, a)
    expect(r.bad).toEqual([])
    expect(r.tried).toBeGreaterThan(6)
    expect(tryAct(g, { action: 'sk_two', target: { unit: 'f1' } })).toEqual(['要選補一槍打誰。'])
    expect(tryAct(g, { action: 'sk_two', target: { unit: 'f1' }, pick: { also: 'f9' } })).toEqual(['補一槍打誰：沒有這個選項。'])
  })

  it('picks 的四種 kind 各列出場上的人與格子', () => {
    const g = play([ab('sk_k', 'active', {
      use: { ap: 1 },
      meat: { do: [{ op: 'heal', who: 'self', amount: 1 }], picks: [
        { key: 'f', label: '敵人', kind: 'foe' }, { key: 'a', label: '隊友', kind: 'ally', required: false }, { key: 'as', label: '我方的格', kind: 'ally_slot' }, { key: 'fs', label: '敵方的格', kind: 'foe_slot' },
      ] },
    })])
    turnTo(g, 'a1')
    const picks = opt(g, 'sk_k').picks
    expect(picks.map((p) => [p.key, p.kind, p.required, p.options.length])).toEqual([['f', 'foe', true, 2], ['a', 'ally', false, 2], ['as', 'ally_slot', true, 4], ['fs', 'foe_slot', true, 4]])
    expect(picks[2]!.options[1]).toEqual({ value: 2, label: '第 2 格', blocks: [], at: { side: 'ally', slot: 2 } })
    expect(mismatches(g, opt(g, 'sk_k')).bad).toEqual([])
  })

  it('choose：幾種用法挑一種，宣告成一個 choice；用法的條件（when）灰掉選項、目標的條件（needs）只讓適用的目標看到', () => {
    const g = play([ab('sk_ch', 'active', {
      use: { ap: 1 },
      meat: { target: 'enemy', choose: [
        { key: 'quick', label: '快射', do: [{ op: 'attack' }] },
        { key: 'daze', label: '震一下', needs: { rank: ['elite'] }, do: [{ op: 'status', status: 'dazed' }] },
        { key: 'burst', label: '連發', when: { mag_min: 5 }, do: [{ op: 'attack' }, { op: 'attack' }] },
      ] },
    })], { foes: [idle(), idle({ rank: 'elite' })], me: { weapons: [{ ...testWeapon('pistol', 20), mag: { now: 9, max: 9 } }] } })
    turnTo(g, 'a1')
    const a = opt(g, 'sk_ch')
    expect(a.picks).toEqual([{
      key: 'choice', label: '用法', kind: 'choice', required: true,
      options: [
        { value: 'quick', label: '快射', blocks: [] },
        { value: 'daze', label: '震一下', blocks: [], for: [{ unit: 'f2' }] },
        { value: 'burst', label: '連發', blocks: [] },
      ],
    }])
    expect(mismatches(g, a).bad).toEqual([])
    // 選了對這個目標不適用的用法：被擋下、寫出原因
    expect(tryAct(g, { action: 'sk_ch', target: { unit: 'f1' }, pick: { choice: 'daze' } })).toEqual(['只能對精英用（保全是雜兵）。'])
    expect(tryAct(g, { action: 'sk_ch', target: { unit: 'f1' }, pick: { choice: 'nope' } })).toEqual(['用法：沒有這個選項。'])
    expect(tryAct(g, { action: 'sk_ch', target: { unit: 'f1' } })).toEqual(['要選用法。'])
    expect(g.battleAct({ action: 'sk_ch', target: { unit: 'f2' }, pick: { choice: 'daze' } }).status).toBe('applied')
    expect(unit(g, 'f2').statuses.map((s) => s.id)).toEqual(['dazed'])
    // 彈匣不夠的用法灰掉
    unit(g, 'a1').weapons[0]!.mag!.now = 2
    expect(opt(g, 'sk_ch').picks[0]!.options[2]!.blocks).toEqual(['彈匣裡要有 5 格以上才能用。'])
  })

  it('choose 的每一種用法對某個目標的條件都不成立：那個目標灰掉、寫出原因', () => {
    const g = play([ab('sk_ch2', 'active', { use: { ap: 1 }, meat: { target: 'enemy', choose: [{ key: 'a', label: 'a', needs: { rank: ['boss'] }, do: [{ op: 'attack' }] }, { key: 'b', label: 'b', needs: { wounded: true }, do: [{ op: 'attack' }] }] } })])
    turnTo(g, 'a1')
    expect(opt(g, 'sk_ch2').targets[0]!.blocks).toEqual(['只能對首領用（保全是雜兵）。', '保全要是重傷（生命低於一半）才能用。'])
    expect(opt(g, 'sk_ch2').ok).toBe(false)
  })

  it('declared 的 choice 用 picks 寫的 key 與 label', () => {
    const g = play([ab('sk_ch3', 'active', { use: { ap: 1 }, meat: { target: 'enemy', picks: [{ key: 'how', label: '怎麼打', kind: 'choice', required: false }], choose: [{ key: 'a', label: '甲', do: [{ op: 'attack' }] }] } })])
    turnTo(g, 'a1')
    expect(opt(g, 'sk_ch3').picks.map((p) => [p.key, p.label, p.required])).toEqual([['how', '怎麼打', false]])
    expect(g.battleAct({ action: 'sk_ch3', target: { unit: 'f1' }, pick: { how: 'a' } }).status).toBe('applied')
  })
})

describe('mods：被動的修正（who、when、per_fight、by_tier、to、tags）', () => {
  it('who: adjacent 的迴避 +1：只有相鄰的隊友吃到，自己和不相鄰的不算', () => {
    const a = field([ab('sk_adj', 'passive', { meat: { mods: [{ kind: 'evade', value: 1, who: 'adjacent' }] } })], { allies: [one({ weapon: 'pistol' }, 1), me(['sk_adj'], { actor: undefined }), one({ weapon: 'pistol' }, 3)] })
    // 持有的人在第 2 格：第 1、3 格相鄰；他自己不算
    const bonus = (id: string) => total(a.run().mods('evade', a.battle.units[id]!))
    expect([bonus('a1'), bonus('a2'), bonus('a3')]).toEqual([1, 0, 1])
    // 再往後一格：第 3 格的人相鄰，第 1 格的人不相鄰了
    const b = field([ab('sk_adj', 'passive', { meat: { mods: [{ kind: 'evade', value: 1, who: 'adjacent' }] } })], { allies: [one({ weapon: 'pistol' }, 1), one({ weapon: 'pistol' }, 2), me(['sk_adj'], { actor: undefined })] })
    expect([1, 2, 3].map((i) => total(b.run().mods('evade', b.ally(i))))).toEqual([0, 1, 0])
  })

  it('who: allies 是我方在場的每個人（含自己）；behind 是自己後面那一格的人', () => {
    const mk = (who: string) => field([ab('sk_w', 'passive', { meat: { mods: [{ kind: 'evade', value: 2, who }] } })], { allies: [one({ weapon: 'pistol' }, 1), me(['sk_w'], { actor: undefined }), one({ weapon: 'pistol' }, 3)] })
    const all = mk('allies')
    expect([1, 2, 3].map((i) => total(all.run().mods('evade', all.ally(i))))).toEqual([2, 2, 2])
    // 對方不吃我方的
    expect(total(all.run().mods('evade', all.foe(1)))).toBe(0)
    const behind = mk('behind')
    expect([1, 2, 3].map((i) => total(behind.run().mods('evade', behind.ally(i))))).toEqual([0, 0, 2])
  })

  it('when: { in_cover: true } 只在自己那一格有遮蔽時算；first_round、other_exposed、other_cyber、other_status 同理', () => {
    const skill = (when: Rec) => ab('sk_w', 'passive', { meat: { mods: [{ kind: 'hit', value: 2, when }] } })
    const hit = (a: Arena, other?: BattleUnit) => total(a.run().mods('hit', a.ally(1), other))
    // 遮蔽：第 1 格半掩體 → 算；暴露 → 不算
    expect(hit(field([skill({ in_cover: true })], { cover: { ally: [1, 0, 0, 0], foe: [0, 0, 0, 0] } }))).toBe(2)
    expect(hit(field([skill({ in_cover: true })], { cover: { ally: [0, 0, 0, 0], foe: [0, 0, 0, 0] } }))).toBe(0)
    // 第一回合
    const fr = field([skill({ first_round: true })])
    expect(hit(fr)).toBe(2)
    fr.battle.round = 2
    expect(hit(fr)).toBe(0)
    // 對手站在暴露的格子
    const ex = field([skill({ other_exposed: true })], { cover: { ally: [0, 0, 0, 0], foe: [0, 1, 0, 0] } })
    expect([hit(ex, ex.foe(1)), hit(ex, ex.foe(2)), hit(ex)]).toEqual([2, 0, 0])
    // 對手有義體、帶著某個狀態
    const cy = field([skill({ other_cyber: true })])
    cy.foe(1).cyber = 2
    expect([hit(cy, cy.foe(1)), hit(cy, cy.foe(2))]).toEqual([2, 0])
    const st = field([skill({ other_status: 'marked' })])
    st.foe(1).statuses.push({ id: 'marked', until: { at: 'battle_end' } })
    expect([hit(st, st.foe(1)), hit(st, st.foe(2))]).toEqual([2, 0])
  })

  it('tags：問的時候要帶著這些標籤才算；公式與 by_tier 照這棵樹的階數', () => {
    const a = field([ab('sk_t', 'passive', { meat: { mods: [
      { kind: 'hit', value: 2, tags: ['aimed'] }, { kind: 'damage', value: { by_tier: [1, 2, 3, 4, 5] } }, { kind: 'dice', value: 'half_tier_up' },
    ] } })])
    const run = a.run()
    expect(total(run.mods('hit', a.ally(1), a.foe(1), undefined, ['aimed']))).toBe(2)
    expect(total(run.mods('hit', a.ally(1), a.foe(1), undefined, ['burst']))).toBe(0)
    // 樹是第 3 階
    expect(total(run.mods('damage', a.ally(1)))).toBe(3)
    expect(total(run.mods('dice', a.ally(1)))).toBe(2)
  })

  it('共鳴的修正（path 的 resonance.effect.mods）：照階數，要裝著這棵樹的招牌', () => {
    const tree = { ...TREE, resonance: [
      { tier: 1, cells: 1, text: '迴避 +1。', effect: { mods: [{ kind: 'evade', value: 1 }] } },
      { tier: 3, cells: 1, text: '迴避再加 2。', effect: { mods: [{ kind: 'evade', value: 2 }] } },
      { tier: 4, cells: 1, text: '迴避再加 4。', effect: { mods: [{ kind: 'evade', value: 4 }] } },
    ] }
    const a = field([], { tree, allies: [me(['sk_root'], { actor: undefined }), one({ weapon: 'pistol' }, 2), one({ weapon: 'pistol' }, 3)] })
    expect(total(a.run().mods('evade', a.ally(1)))).toBe(3)
    expect(total(a.run().mods('evade', a.ally(2)))).toBe(0)
    expect(() => makeGame({ features: FEATURES, content: [pack([], {}, { ...TREE, resonance: [{ tier: 1, cells: 1, text: '壞的。', effect: { mods: [{ kind: 'nope', value: 1 }] } }] })] })).toThrow(/nope/)
  })

  it('per_fight: 2 的「換武器不花行動點」：前兩次免費，第三次照原價（次數在 action.done 記）', () => {
    const g = play([ab('sk_swap', 'passive', { meat: { mods: [{ kind: 'action_ap', value: -1, tags: ['swap'], per_fight: 2 }] } })], {
      me: { weapons: [testWeapon('pistol', 5), testWeapon('smg', 5), testWeapon('knife', 5)] },
    })
    const spent = (): number => {
      turnTo(g, 'a1').ap.now = 10
      expect(g.battleAct({ action: 'swap' }).status).toBe('applied')
      return 10 - unit(g, 'a1').ap.now
    }
    turnTo(g, 'a1')
    expect(opt(g, 'swap').cost).toEqual({ ap: 0 })
    expect([spent(), spent(), spent(), spent()]).toEqual([0, 0, 1, 1])
    expect(unit(g, 'a1').uses['mod:sk_swap#0']).toBe(2)
  })

  it('per_turn: 1 的減免每個回合只有第一次，下個回合又有', () => {
    const g = play([ab('sk_pt', 'passive', { meat: { mods: [{ kind: 'action_ap', value: -1, tags: ['swap'], per_turn: 1 }] } })], { me: { weapons: [testWeapon('pistol', 5), testWeapon('smg', 5), testWeapon('knife', 5)] } })
    turnTo(g, 'a1').ap.now = 10
    g.battleAct({ action: 'swap' })
    g.battleAct({ action: 'swap' })
    expect(10 - unit(g, 'a1').ap.now).toBe(1)
    expect(Object.keys(unit(g, 'a1').uses).filter((k) => k.startsWith('turn:mod:'))).toEqual(['turn:mod:sk_pt#0'])
  })

  it('to: 3 的要害門檻：超過迴避 3 就算要害（沒有它要 5）', () => {
    const base = field([], { foes: [foe('minion', { weapons: [testWeapon('pistol', 5)], ...quiet } as never), foe('minion', quiet as never)] })
    // 先量出同一個骰面下的差距，再讓它剛好是 3
    const probe = base.run(dice(10, 1, 1, 1, 1, 1)).attack(base.ally(1), base.foe(1))
    const margin = probe.total - probe.evade
    expect(probe.hit && !probe.crit && margin < 5).toBe(true)
    const a = field([ab('sk_crit', 'passive', { meat: { mods: [{ kind: 'crit_margin', to: margin }] } })], { foes: [foe('minion', { weapons: [testWeapon('pistol', 5)], ...quiet } as never), foe('minion', quiet as never)] })
    expect(total(a.run().mods('crit_margin', a.ally(1)))).toBe(margin - 5)
    expect(a.run(dice(10, 1, 1, 1, 1, 1)).attack(a.ally(1), a.foe(1)).crit).toBe(true)
  })
})

describe('姿態：開著才有修正；開第二個時第一個關掉；開關各扣行動點', () => {
  const A = ab('sk_sa', 'stance', { name: '姿態甲', use: { ap: 2 }, meat: { mods: [{ kind: 'hit', value: 2 }], do_on: [{ op: 'heal', who: 'self', amount: 3 }], do_off: [{ op: 'heal', who: 'self', amount: 5 }] } })
  const B = ab('sk_sb', 'stance', { name: '姿態乙', use: { ap: 2 }, meat: { mods: [{ kind: 'hit', value: 5 }], do_on: [{ op: 'heal', who: 'self', amount: 1 }] } })
  it('沒開的時候沒有修正；開了才有；換另一個時前一個關掉（做 do_off）；再按一次是關', () => {
    const g = play([A, B])
    turnTo(g, 'a1').hp!.now = 20
    const a1 = () => unit(g, 'a1')
    const hit = () => total(modsOf(g, 'hit', 'a1'))
    expect(hit()).toBe(0)
    expect(opt(g, 'sk_sa')).toMatchObject({ group: 'skill', target: 'none', cost: { ap: 2 } })
    expect(g.battleAct({ action: 'sk_sa' }).status).toBe('applied')
    expect([a1().stance, hit(), a1().ap.now, a1().hp!.now]).toEqual(['sk_sa', 2, 18, 23])
    // 開第二個：第一個關掉（+5 的 do_off），第二個開（+1 的 do_on）；只扣一次行動點
    expect(g.battleAct({ action: 'sk_sb' }).status).toBe('applied')
    expect([a1().stance, hit(), a1().ap.now, a1().hp!.now]).toEqual(['sk_sb', 5, 16, 29])
    // 同時只有一個：第一個的修正沒了
    expect(modsOf(g, 'hit', 'a1').filter((p) => p.source === 'skill').map((p) => p.label)).toEqual(['姿態乙'])
    // 再按一次關掉
    expect(g.battleAct({ action: 'sk_sb' }).status).toBe('applied')
    expect([a1().stance, hit(), a1().ap.now]).toEqual([undefined, 0, 14])
  })

  it('行動點不夠時開不了；姿態自己的條件（when）不符時開不了，但已經開著的可以關', () => {
    const g = play([ab('sk_sw', 'stance', { name: '姿態丙', use: { ap: 2 }, meat: { when: { wield: 'rifle' }, mods: [{ kind: 'hit', value: 1 }] } })])
    const a1 = turnTo(g, 'a1')
    expect(opt(g, 'sk_sw').blocks).toEqual(['手上要拿著rifle類的武器才能用。'])
    a1.stance = 'sk_sw'
    expect(opt(g, 'sk_sw').blocks).toEqual([])
    a1.ap.now = 1
    expect(opt(g, 'sk_sw').blocks).toEqual(['行動點不夠（要 2 點，現在 1 點）。'])
  })
})

describe('反應：每一種 on 各一個假技能（規格第四節）；行動點不夠時不觸發', () => {
  const react = (id: string, trigger: Rec, more: Rec = {}, use: Rec = { ap: 1 }) => ab(id, 'reaction', { use, meat: { trigger, ...more } })
  const hitter = { weapons: [testWeapon('pistol', 30)], ...quiet }

  it('attacked：redirect 改打反應的人掛在同一格或相鄰一格的無人機；隊友自己不受傷', () => {
    const a = field([react('sk_rd', { on: 'attacked', who: 'ally' }, { react: { redirect: 'overlay' } })])
    const run = a.run(dice(10, 1, 1, 1, 1, 1))
    const drone = run.addOverlay({ side: 'ally', slot: 2, owner: 'a1', kind: 'shield', name: '護盾機', hp: { now: 30, max: 30 }, armor: 0, evade: 0 })
    const hp = a.ally(2).hp!.now
    const r = run.attack(a.foe(1), a.ally(2))
    expect(r).toMatchObject({ redirected: true, hit: true })
    expect(a.ally(2).hp!.now).toBe(hp)
    expect(drone.hp.now).toBeLessThan(30)
    expect(a.ally(1).ap.now).toBe(a.ally(1).ap.max - 1)
    expect(fired(run, 'sk_rd')).toBe(1)
    // 相鄰一格也行；兩格以外的沒有東西可擋：不觸發、不扣行動點
    const b = field([react('sk_rd', { on: 'attacked', who: 'ally' }, { react: { redirect: 'overlay' } })])
    const rb = b.run(dice(10, 1, 1, 1, 1, 1))
    rb.addOverlay({ side: 'ally', slot: 1, owner: 'a1', kind: 'shield', name: '護盾機', hp: { now: 30, max: 30 }, armor: 0, evade: 0 })
    expect(rb.attack(b.foe(1), b.ally(2)).redirected).toBe(true)
    const c = field([react('sk_rd', { on: 'attacked', who: 'ally' }, { react: { redirect: 'overlay' } })])
    const rc = c.run(dice(10, 1, 1, 1, 1, 1))
    rc.addOverlay({ side: 'ally', slot: 1, owner: 'a1', kind: 'shield', name: '護盾機', hp: { now: 30, max: 30 }, armor: 0, evade: 0 })
    expect(rc.attack(c.foe(1), c.ally(3)).redirected).toBeUndefined()
    expect(c.ally(1).ap.now).toBe(c.ally(1).ap.max)
  })

  it('attacked 的 evade 與 hit：這一擊的迴避加減、攻擊者的命中加減；who: self 只管自己', () => {
    const a = field([react('sk_ev', { on: 'attacked', who: 'self' }, { react: { evade: 4, hit: -1 } })], { foes: [foe('minion', hitter as never), foe('minion', quiet as never)] })
    const base = field([], { foes: [foe('minion', hitter as never), foe('minion', quiet as never)] })
    const plain = base.run(dice(10, 1, 1, 1, 1, 1)).attack(base.foe(1), base.ally(1))
    const r = a.run(dice(10, 1, 1, 1, 1, 1)).attack(a.foe(1), a.ally(1))
    expect(r.evade - plain.evade).toBe(4)
    expect(r.total - plain.total).toBe(-1)
    // 隊友被打：who 是 self，不觸發
    const b = field([react('sk_ev', { on: 'attacked', who: 'self' }, { react: { evade: 4 } })], { foes: [foe('minion', hitter as never), foe('minion', quiet as never)] })
    const rb = b.run(dice(10, 1, 1, 1, 1, 1))
    expect(rb.attack(b.foe(1), b.ally(2)).evade).toBe(plain.evade)
    expect(fired(rb, 'sk_ev')).toBe(0)
  })

  it('hit：negate 讓那一擊沒有傷害，而且只在第一回合（use.first_round）', () => {
    const a = field([react('sk_ng', { on: 'hit', who: 'self' }, { react: { negate: true } }, { ap: 1, first_round: true })])
    const hp = a.ally(1).hp!.now
    const r1 = a.run(dice(10, 1, 1, 1, 1, 1)).attack(a.foe(1), a.ally(1))
    expect(r1).toMatchObject({ hit: true, negated: true, dealt: 0 })
    expect(a.ally(1).hp!.now).toBe(hp)
    expect(a.ally(1).ap.now).toBe(a.ally(1).ap.max - 1)
    // 第二回合：同樣的一擊，造成傷害，也沒有再觸發
    a.battle.round = 2
    const run2 = a.run(dice(10, 1, 1, 1, 1, 1))
    const r2 = run2.attack(a.foe(1), a.ally(1))
    expect(r2.negated).toBeUndefined()
    expect(r2.dealt).toBeGreaterThan(0)
    expect(a.ally(1).hp!.now).toBeLessThan(hp)
    expect(fired(run2, 'sk_ng')).toBe(0)
  })

  it('hit 的 if: wound：只在這一擊本來會重創時才觸發，no_wound 把重創改成一般的命中', () => {
    const mk = () => field([react('sk_nw', { on: 'hit', who: 'self', if: 'wound' }, { react: { no_wound: true } })], { foes: [foe('minion', hitter as never), foe('minion', quiet as never)] })
    // 自然 20 是重創；沒有這個技能的對照
    const plain = field([], { foes: [foe('minion', hitter as never), foe('minion', quiet as never)] })
    expect(plain.run(dice(20, 1, 1, 1, 1, 1, 1, 1)).attack(plain.foe(1), plain.ally(1)).wound).toBe(true)
    const a = mk()
    const r20 = a.run(dice(20, 1, 1, 1, 1, 1, 1, 1))
    expect(r20.attack(a.foe(1), a.ally(1)).wound).toBe(false)
    expect(fired(r20, 'sk_nw')).toBe(1)
    // 沒有重創的一擊：不觸發、不扣行動點
    const b = mk()
    const r10 = b.run(dice(10, 1, 1, 1, 1, 1))
    r10.attack(b.foe(1), b.ally(1))
    expect(fired(r10, 'sk_nw')).toBe(0)
    expect(b.ally(1).ap.now).toBe(b.ally(1).ap.max)
  })

  it('after 加 if: miss 的反擊：沒打中才觸發，反擊自己不再觸發反應', () => {
    const a = field([react('sk_cm', { on: 'after', who: 'self', if: 'miss' }, { do: [{ op: 'attack', who: 'attacker' }] })], { foes: [foe('minion', { weapons: [testWeapon('pistol', 30)], hp: { now: 80, max: 80 }, ...quiet } as never), foe('minion', quiet as never)] })
    const run = a.run(dice(1, 1, 1, 1, 10, 1, 1, 1, 1, 1, 1, 1))
    run.attack(a.foe(1), a.ally(1))
    const attacks = run.beats.filter((b) => ['hit', 'miss', 'crit'].includes(b.tag ?? ''))
    expect(attacks.map((b) => (b.data as Rec).attacker)).toEqual(['f1', 'a1'])
    expect(a.foe(1).hp!.now).toBeLessThan(80)
    expect(fired(run, 'sk_cm')).toBe(1)
    // 打中了：不反擊
    const b = field([react('sk_cm', { on: 'after', who: 'self', if: 'miss' }, { do: [{ op: 'attack', who: 'attacker' }] })])
    const rb = b.run(dice(10, 1, 1, 1, 1, 1))
    rb.attack(b.foe(1), b.ally(1))
    expect(fired(rb, 'sk_cm')).toBe(0)
  })

  it('after 的 if: hit、melee、bridged 各自成立才觸發', () => {
    const skills = [
      react('sk_ah', { on: 'after', who: 'self', if: 'hit' }, { do: [{ op: 'heal', who: 'self', amount: 1 }] }),
      react('sk_am', { on: 'after', who: 'self', if: 'melee' }, { do: [{ op: 'heal', who: 'self', amount: 1 }] }),
      react('sk_ab', { on: 'after', who: 'self', if: 'bridged' }, { do: [{ op: 'heal', who: 'self', amount: 1 }] }),
    ]
    const a = field(skills, { foes: [foe('minion', { ...hitter, load: undefined } as never), foe('minion', quiet as never)] })
    const run = a.run(dice(10, 1, 1, 1, 1, 1))
    run.attack(a.foe(1), a.ally(1))
    // 打中了、不是近戰；被打的是我（有橋）
    expect([fired(run, 'sk_ah'), fired(run, 'sk_am'), fired(run, 'sk_ab')]).toEqual([1, 0, 1])
  })

  it('hp_half：第一次低於一半生命時觸發，只觸發一次（補血之後再掉下去也不再觸發）', () => {
    const a = field([react('sk_hh', { on: 'hp_half', who: 'self' }, { do: [{ op: 'load', who: 'self', exact: true, amount: 1 }] })])
    const a1 = a.ally(1)
    a1.hp!.now = 23
    const run = a.run(dice(10, 1, 1, 1, 1, 1))
    run.attack(a.foe(1), a1)
    expect(a1.hp!.now).toBeLessThan(23)
    expect(fired(run, 'sk_hh')).toBe(1)
    a1.hp!.now = 23
    a1.ap.now = a1.ap.max
    const again = a.run(dice(10, 1, 1, 1, 1, 1))
    again.attack(a.foe(1), a1)
    expect(a1.hp!.now).toBeLessThan(23)
    expect(fired(again, 'sk_hh')).toBe(0)
    // 一開始就沒有掉到一半以下的：不觸發
    const b = field([react('sk_hh', { on: 'hp_half', who: 'self' }, { do: [{ op: 'load', who: 'self', exact: true, amount: 1 }] })])
    const rb = b.run(dice(10, 1, 1, 1, 1, 1))
    rb.attack(b.foe(1), b.ally(1))
    expect(fired(rb, 'sk_hh')).toBe(0)
  })

  it('hp_half 的 who: near：自己或相鄰的隊友第一次低於一半，不相鄰的不算', () => {
    const a = field([react('sk_hn', { on: 'hp_half', who: 'near' }, { do: [{ op: 'heal', who: 'self', amount: 1 }] })], { allies: [me(['sk_hn'], { actor: undefined }), one({ weapon: 'pistol' }, 2), one({ weapon: 'pistol' }, 3)] })
    a.ally(3).hp!.now = 23
    const far = a.run(dice(10, 1, 1, 1, 1, 1))
    far.attack(a.foe(1), a.ally(3))
    expect(fired(far, 'sk_hn')).toBe(0)
    a.ally(2).hp!.now = 23
    const near = a.run(dice(10, 1, 1, 1, 1, 1))
    near.attack(a.foe(1), a.ally(2))
    expect(fired(near, 'sk_hn')).toBe(1)
  })

  it('overload：keep_turn 不失去下一個回合；who: ally 是隊友過載，foe_by_self 是自己讓敵人過載', () => {
    const lost = (a: Arena, id: string) => a.battle.units[id]!.statuses.some((s) => s.id === LOSE_TURN)
    const mk = (who: string, more: Rec = {}) => field([react('sk_ol', { on: 'overload', who }, { react: { keep_turn: true }, ...more })])
    // 沒有反應：失去回合（對照組）
    const none = field([])
    none.run().addLoad(none.ally(1), 999, none.foe(1))
    expect(lost(none, 'a1')).toBe(true)
    // 自己過載
    const self = mk('self')
    const rs = self.run()
    rs.addLoad(self.ally(1), 999, self.foe(1))
    expect(lost(self, 'a1')).toBe(false)
    expect(self.ally(1).layers).toBe(1)
    expect(fired(rs, 'sk_ol')).toBe(1)
    // 隊友過載
    const ally = mk('ally')
    ally.run().addLoad(ally.ally(2), 999, ally.foe(1))
    expect(lost(ally, 'a2')).toBe(false)
    // 自己讓敵人過載：這裡 keep_turn 作用在被過載的敵人身上（do 另外做事）
    const mine = field([react('sk_fo', { on: 'overload', who: 'foe_by_self' }, { do: [{ op: 'heal', who: 'self', amount: 1 }] })])
    const rm = mine.run()
    mine.ally(1).hp!.now = 10
    rm.addLoad(mine.foe(1), 999, mine.ally(2))
    expect(fired(rm, 'sk_fo')).toBe(0)
    rm.addLoad(mine.foe(2), 999, mine.ally(1))
    expect(fired(rm, 'sk_fo')).toBe(1)
    expect(mine.ally(1).hp!.now).toBe(11)
  })

  it('out_before：prevent 讓隊友停在生命 1（被擋下之後做 do）；how 不在清單裡的不擋', () => {
    const a = field([react('sk_pv', { on: 'out_before', who: 'ally' }, { react: { prevent: { how: ['down'] } }, do: [{ op: 'heal', who: 'self', amount: 2 }] })])
    a.ally(1).hp!.now = 10
    const run = a.run()
    run.damage(a.ally(2), 999, 'physical', a.foe(1))
    expect(a.ally(2).out).toBeUndefined()
    expect(a.ally(2).hp!.now).toBe(1)
    expect(a.ally(1).hp!.now).toBe(12)
    expect(fired(run, 'sk_pv')).toBe(1)
    // 自己不在 who: ally 裡
    run.damage(a.ally(1), 999, 'physical', a.foe(1))
    expect(a.ally(1).out).toBe('down')
    // 被制伏（how: subdued）不在清單裡：不擋
    const b = field([react('sk_pv', { on: 'out_before', who: 'ally' }, { react: { prevent: { how: ['down'] } } })])
    expect(b.run().setOut(b.ally(2), 'subdued')).toBe(true)
  })

  it('行動點不夠時不觸發：不扣、不擋；敵人的人不吃我方的反應', () => {
    const a = field([react('sk_pv', { on: 'out_before', who: 'ally' }, { react: { prevent: { how: ['down'] } } }, { ap: 2 })])
    a.ally(1).ap.now = 1
    a.run().damage(a.ally(2), 999, 'physical', a.foe(1))
    expect(a.ally(2).out).toBe('down')
    expect(a.ally(1).ap.now).toBe(1)
    // 次數：每回合 1 次，用完之後不觸發
    const b = field([react('sk_pt', { on: 'out_before', who: 'ally' }, { react: { prevent: { how: ['down'] } } }, { ap: 1, per_turn: 1 })])
    const run = b.run()
    run.damage(b.ally(2), 999, 'physical', b.foe(1))
    run.damage(b.ally(3), 999, 'physical', b.foe(1))
    expect([b.ally(2).out, b.ally(3).out]).toEqual([undefined, 'down'])
  })

  it('checked：別人對他擲檢定之前，改這一次的 DC；if 是檢定的標籤（快駭、誘惑）；擲骰的人是 unit、他是 other（dev/adr/0015 補記）', () => {
    const a = field([react('sk_ck', { on: 'checked', who: 'self', if: 'hack' }, { react: { dc: 3 } })])
    // 敵人（擲骰的人）對我擲檢定：save(擲骰的人, …, 對誰擲的)
    const dc = (tags: string[]) => a.run(dice(10, 1, 1)).save(a.foe(1), 'intellect', undefined, 10, '快駭', [], tags, a.ally(1)).roll.dc
    expect(dc(['hack'])).toBe(13)
    expect(a.ally(1).ap.now).toBe(a.ally(1).ap.max - 1)
    expect(dc(['seduce'])).toBe(10)
    // 我自己擲、對別人擲的檢定（我是 unit、不是 other）：我的反應不會因此觸發
    expect(a.run(dice(10, 1, 1)).save(a.ally(1), 'intellect', undefined, 10, '快駭', [], ['hack'], a.foe(1)).roll.dc).toBe(10)
    // 沒有 other 的檢定（自己對自己的）不發這個掛點
    expect(a.run(dice(10, 1, 1)).save(a.ally(1), 'resolve', undefined, 10, '定力', [], ['hack']).roll.dc).toBe(10)
    // who: ally：隊友被快駭
    const b = field([react('sk_ck', { on: 'checked', who: 'ally' }, { react: { dc: -2 } })])
    expect(b.run(dice(10, 1, 1)).save(b.foe(1), 'intellect', undefined, 10, '快駭', [], ['hack'], b.ally(2)).roll.dc).toBe(8)
    expect(b.run(dice(10, 1, 1)).save(b.foe(1), 'intellect', undefined, 10, '快駭', [], ['hack'], b.ally(1)).roll.dc).toBe(10)
  })

  it('reaction 標籤的攻擊不再觸發反應：舊的掩護射擊與新的反擊不會互相連鎖', () => {
    const a = field([
      react('sk_c1', { on: 'after', who: 'self', if: 'miss' }, { do: [{ op: 'attack', who: 'attacker' }] }),
    ], { foes: [foe('minion', { weapons: [testWeapon('pistol', 30)], hp: { now: 80, max: 80 }, ...quiet } as never), foe('minion', quiet as never)] })
    const run = a.run(dice(1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1))
    // 對手的攻擊失手，我反擊（也失手：自然 1）；反擊的失手不會再讓我反擊一次
    run.attack(a.foe(1), a.ally(1))
    expect(fired(run, 'sk_c1')).toBe(1)
  })

  it('舊的字串 trigger（掩護射擊、小心後面！）照舊動，也吃每件委託與共用次數的檢查', () => {
    const a = field([ab('sk_old', 'reaction', { use: { ap: 1, per_turn: 1 }, meat: { trigger: 'ally_attacked', evade: 3 } })])
    const run = a.run(dice(10, 1, 1, 1, 1, 1))
    const r = run.attack(a.foe(1), a.ally(2))
    expect(r.evade).toBeGreaterThanOrEqual(13)
    expect(a.ally(1).ap.now).toBe(a.ally(1).ap.max - 1)
    expect(fired(run, 'sk_old')).toBe(1)
    run.attack(a.foe(1), a.ally(2))
    expect(fired(run, 'sk_old')).toBe(1)
  })
})

describe('alter：改別的技能；as_pick 讓被改的技能多一個可以開的選項，開了才照 set 算', () => {
  const shot = ab('sk_shot', 'active', { name: '點射', use: { ap: 1 }, meat: { target: 'enemy', attack: { hit: 1 } } })
  const focus = ab('sk_focus', 'passive', { name: '專注', meat: { alter: [{ ability: 'sk_shot', set: { 'attack.hit': 6 }, as_pick: { key: 'focus', label: '專注' } }] } })
  const always = ab('sk_always', 'passive', { name: '常駐', meat: { alter: [{ ability: 'sk_shot', set: { 'attack.hit': 9 } }] } })
  const hitPart = (g: G, input: BattleInput): number => {
    const r = g.battleAct(input)
    expect(r.status).toBe('applied')
    return (r.reports[0]!.timeline.find((b) => b.roll)!.roll!.parts.find((p) => p.label === '點射')?.value ?? 0)
  }

  it('被改的技能多一個 toggle 選項；沒開照原樣，開了才照 set 算；沒裝改它的技能就沒有這個選項', () => {
    const g = play([shot, focus], { me: { weapons: [{ ...testWeapon('pistol', 10), mag: { now: 9, max: 9 } }] } })
    turnTo(g, 'a1')
    expect(opt(g, 'sk_shot').picks).toEqual([{ key: 'focus', label: '專注', kind: 'toggle', required: false, options: [{ value: true, label: '專注', blocks: [] }] }])
    expect(hitPart(g, { action: 'sk_shot', target: { unit: 'f1' } })).toBe(1)
    turnTo(g, 'a1')
    expect(hitPart(g, { action: 'sk_shot', target: { unit: 'f1' }, pick: { focus: true } })).toBe(6)
    expect(mismatches(g, opt(turnTo(g, 'a1') && g, 'sk_shot')).bad).toEqual([])
    // 只裝被改的技能：沒有選項
    const h = play([shot])
    turnTo(h, 'a1')
    expect(opt(h, 'sk_shot').picks).toEqual([])
  })

  it('沒有 as_pick 的 alter 只要裝著就照 set 算', () => {
    const g = play([shot, always], { me: { weapons: [{ ...testWeapon('pistol', 10), mag: { now: 9, max: 9 } }] } })
    turnTo(g, 'a1')
    expect(opt(g, 'sk_shot').picks).toEqual([])
    expect(hitPart(g, { action: 'sk_shot', target: { unit: 'f1' } })).toBe(9)
  })

  it('alter 改過之後的 meat 也要合格：改出壞的格式，載入時擋下', () => {
    const bad = ab('sk_bad', 'passive', { meat: { alter: [{ ability: 'sk_shot', set: { 'attack.teleport': 1 } }] } })
    expect(() => makeGame({ features: FEATURES, content: [pack([shot, bad])] })).toThrow(/teleport/)
  })
})

describe('buff：在對象身上掛一段時間的修正，結束時做 on_end', () => {
  it('三回合的命中 +1，到期時做 on_end（感載 +10）；同一個 id 再掛一次只重算時間', () => {
    const a = field([])
    const run = a.run()
    const a1 = a.ally(1)
    const use = { user: a1, target: { unit: 'a1' } as BattleTarget, source: SRC }
    run.effects([{ op: 'buff', id: 'focus', name: '專注', turns: 3, until: 'own_turn_end', mods: [{ kind: 'hit', value: 1 }], on_end: [{ op: 'load', exact: true, amount: 10 }] }], use)
    const hit = () => total(run.mods('hit', a1))
    expect(hit()).toBe(1)
    expect(a1.ext.abilities).toMatchObject({ buffs: [{ id: 'focus', turns: 3 }] })
    const endTurn = () => a.k.battle.emit('turn.end', { run, unit: a1 })
    endTurn()
    endTurn()
    expect([hit(), a1.load!.now]).toEqual([1, 0])
    // 再掛一次：時間重算，不疊兩份
    run.effects([{ op: 'buff', id: 'focus', name: '專注', turns: 3, until: 'own_turn_end', mods: [{ kind: 'hit', value: 1 }], on_end: [{ op: 'load', exact: true, amount: 10 }] }], use)
    expect(hit()).toBe(1)
    endTurn()
    endTurn()
    expect(hit()).toBe(1)
    endTurn()
    expect([hit(), a1.load!.now]).toEqual([0, 10])
    expect(run.beats.filter((b) => b.tag === 'status.end').length).toBe(1)
  })

  it('who 與 if 照核心的解析：落在每個隊友身上；until: source_turn_start 數給的人的回合；on_end 的做的人是給的人', () => {
    const a = field([])
    const run = a.run()
    run.effects([{ op: 'buff', id: 'b', who: 'allies', turns: 1, until: 'source_turn_start', mods: [{ kind: 'evade', value: 2 }], on_end: [{ op: 'heal', amount: 3 }] }], { user: a.ally(1), source: SRC })
    expect([1, 2, 3].map((i) => total(run.mods('evade', a.ally(i))))).toEqual([2, 2, 2])
    a.ally(2).hp!.now = 10
    // 別人的回合開始不算；給的人（a1）的回合開始才算
    a.k.battle.emit('turn.start', { run, unit: a.ally(2) })
    expect(total(run.mods('evade', a.ally(3)))).toBe(2)
    a.k.battle.emit('turn.start', { run, unit: a.ally(1) })
    expect([1, 2, 3].map((i) => total(run.mods('evade', a.ally(i))))).toEqual([0, 0, 0])
    expect(a.ally(2).hp!.now).toBe(13)
  })

  it('掛在和人重疊的東西、已經退出的人身上不做；buff 的 mods 吃同一套 when、tags', () => {
    const a = field([])
    const run = a.run()
    a.ally(2).out = 'down'
    run.effects([{ op: 'buff', id: 'b', who: 'allies', mods: [{ kind: 'hit', value: 4, tags: ['aimed'] }] }], { user: a.ally(1), source: SRC })
    expect(a.ally(2).ext.abilities).toBeUndefined()
    expect(total(run.mods('hit', a.ally(1), undefined, undefined, ['aimed']))).toBe(4)
    expect(total(run.mods('hit', a.ally(1), undefined, undefined, []))).toBe(0)
  })
})

describe('tags 與 pool：裝著的被動，開打時多這些標籤、某一池的上限與回復加減', () => {
  it('meat.tags 與 meat.pool（RAM 上限 +3、每回合回復 +1）', () => {
    const a = field([ab('sk_tp', 'passive', { meat: { tags: ['drone_link', 'quickhack'], pool: { ram: { max: 3, regen: 1 } } } })])
    const a1 = a.ally(1)
    expect(a1.tags).toEqual(expect.arrayContaining(['drone_link', 'quickhack']))
    expect(a1.pools.ram).toEqual({ now: 7, max: 7, regen: 3 })
    // 沒裝的人不受影響
    expect(a.ally(2).tags).toEqual([])
    expect(a.ally(2).pools.ram).toEqual({ now: 4, max: 4, regen: 2 })
  })
})

describe('壓制的檢定帶 resist:suppressed 標籤（M1b-core-effects 補充）', () => {
  it('技能的壓制檢定帶這個標籤：只對抵抗壓制加值的修正算得到；別的檢定不算', () => {
    const burst = ab('sk_burst', 'active', { use: { ap: 3 }, meat: { target: 'enemy', attack: { spend: 'all', min_mag: 2, dice: 'spent_minus_1', suppress: { dc: 'spent', skill: 'composure' } } } })
    const guard = ab('sk_guard', 'passive', { name: '穩住', meat: { mods: [{ kind: 'save', value: 3, tags: ['resist:suppressed'] }] } })
    const other = ab('sk_other', 'passive', { name: '別的', meat: { mods: [{ kind: 'save', value: 4, tags: ['hack'] }] } })
    // 敵人身上裝著兩個被動：一個只對抵抗壓制加值，一個只對快駭加值
    const h = makeBattleGame({
      features: FEATURES, content: [pack([burst, guard, other])], seed: 7,
      battle: duel([me(['sk_burst'], { weapons: [{ ...testWeapon('smg', 20), mag: { now: 3, max: 3 } }] }), one({ weapon: 'pistol' }, 2)], [idle({ hp: { now: 300, max: 300 }, ext: equip('sk_guard', 'sk_other') }), idle()]),
    }).game
    turnTo(h, 'a1')
    const r = h.battleAct({ action: 'sk_burst', target: { unit: 'f1' } })
    expect(r.status).toBe('applied')
    const save = r.reports[0]!.timeline.map((b) => b.roll).find((roll) => roll?.skill === 'composure')!
    expect(save.dc).toBe(16)
    expect(save.parts.find((p) => p.label === '穩住')?.value).toBe(3)
    expect(save.parts.some((p) => p.label === '別的')).toBe(false)
  })
})

describe('預備（E4）：ability.prep 讓時間前進、效果帶進下一場現實戰鬥、用掉就清', () => {
  const PREP = ab('sk_scout', 'prep', {
    name: '踩點', use: { slot: 1 },
    prep: { slot: 1, scope: 'next_battle', meat: { mods: [{ kind: 'evade', value: 2 }], do: [{ op: 'heal', who: 'self', amount: 5 }] } },
  })
  const owner = (equipped: string[] = ['sk_scout'], learned: string[] = ['sk_root', 'sk_scout']) => ({ pc: { ext: { abilities: { xp: 0, learned, equipped, spent: { tree: 40 } } } } })
  const battleOf = (hp = 20): BattleSetup => ({
    mode: 'meat', grade: 1, cover: { ally: [0, 0, 0, 0], foe: [0, 0, 0, 0] },
    allies: [{ from: 'unit', unit: one({ actor: 'pc', weapon: 'pistol', hp: { now: hp, max: 46 } } as never) as never }], foes: [{ from: 'unit', unit: idle() as never }],
  })
  const start = () => {
    const g = makeGame({ features: FEATURES, content: [pack([PREP])], ...owner() }).game
    return g
  }

  it('prepBlock：沒學、沒裝、不是預備技能、戰鬥中都預備不了，各一句原因', () => {
    const g = makeGame({ features: FEATURES, content: [pack([PREP, ab('sk_act', 'active', { meat: { target: 'enemy', do: [{ op: 'attack' }] } })])], ...owner(['sk_root'], ['sk_root']) }).game
    expect(prepBlock(g.k, g.state, 'pc', 'sk_scout')).toBe('還沒學會踩點。')
    expect(prepBlock(g.k, g.state, 'pc', 'sk_nope')).toBe('沒有這個技能。')
    expect(prepBlock(g.k, g.state, 'pc', 'sk_act')).toBe('sk_act不是預備技能。')
    g.state.actors.pc!.ext.abilities = { xp: 0, learned: ['sk_scout'], equipped: [], spent: {} }
    expect(prepBlock(g.k, g.state, 'pc', 'sk_scout')).toBe('要先裝上踩點。')
    expect(() => prep(g.k, g.state, 'pc', 'sk_scout')).toThrow('要先裝上踩點。')
    g.state.actors.pc!.ext.abilities = { xp: 0, learned: ['sk_scout'], equipped: ['sk_scout'], spent: {} }
    expect(prepBlock(g.k, g.state, 'pc', 'sk_scout')).toBeNull()
    g.startBattle(battleOf())
    expect(prepBlock(g.k, g.state, 'pc', 'sk_scout')).toBe('戰鬥中不能預備。')
  })

  it('prep 的報告讓時間前進一個時段（4 小時）；下一場開打時效果在，再下一場沒有', async () => {
    const g = start()
    expect(prepBlock(g.k, g.state, 'pc', 'sk_scout')).toBeNull()
    const before = toMinutes(g.state.time)
    const draft = prep(g.k, g.state, 'pc', 'sk_scout')
    expect(draft.action).toBe('ability.prep')
    g.commit(draft)
    expect(toMinutes(g.state.time) - before).toBe(240)
    expect(g.state.actors.pc!.ext.abilities).toMatchObject({ prepared: [{ id: 'sk_scout', scope: 'next_battle' }], learned: ['sk_root', 'sk_scout'] })

    // 下一場現實戰鬥：mods 整場有效、do 在開打時做一次（生命 20 → 25）
    g.startBattle(battleOf(20))
    const a1 = unit(g, 'a1')
    expect(a1.hp!.now).toBe(25)
    expect(total(modsOf(g, 'evade', 'a1'))).toBe(2)
    expect(modsOf(g, 'evade', 'a1').map((p) => p.label)).toEqual(['踩點'])
    await finish(g)
    // 用掉就清
    expect((g.state.actors.pc!.ext.abilities as Rec).prepared).toEqual([])
    g.startBattle(battleOf(20))
    expect(unit(g, 'a1').hp!.now).toBe(20)
    expect(total(modsOf(g, 'evade', 'a1'))).toBe(0)
  })

  it('預備兩次是同一筆（不疊）；打輸重來（戰鬥中止）不會用掉預備', async () => {
    const g = start()
    g.commit(prep(g.k, g.state, 'pc', 'sk_scout'))
    g.commit(prep(g.k, g.state, 'pc', 'sk_scout'))
    expect((g.state.actors.pc!.ext.abilities as { prepared: unknown[] }).prepared).toHaveLength(1)
    g.startBattle(battleOf(20))
    expect(g.retryBattle()).toBeNull()
    expect((g.state.actors.pc!.ext.abilities as { prepared: unknown[] }).prepared).toHaveLength(1)
  })

  it('scope: commission：同一件委託的每一場都有，換一件委託就沒有；第一次用到時才綁定那件委託', async () => {
    const commission = ab('sk_plan', 'prep', { name: '安排', prep: { slot: 2, scope: 'commission', meat: { mods: [{ kind: 'evade', value: 1 }] } } })
    const g = makeGame({ features: FEATURES, content: [pack([commission])], ...owner(['sk_plan'], ['sk_root', 'sk_plan']) }).game
    const before = toMinutes(g.state.time)
    g.commit(prep(g.k, g.state, 'pc', 'sk_plan'))
    expect(toMinutes(g.state.time) - before).toBe(480)
    const withKey = (key: string): BattleSetup => ({ ...battleOf(), origin: { ext: { commission: key } } })
    g.startBattle(withKey('c1'))
    expect(total(modsOf(g, 'evade', 'a1'))).toBe(1)
    await finish(g)
    expect((g.state.actors.pc!.ext.abilities as { prepared: unknown[] }).prepared).toEqual([{ id: 'sk_plan', scope: 'commission', key: 'c1' }])
    g.startBattle(withKey('c1'))
    expect(total(modsOf(g, 'evade', 'a1'))).toBe(1)
    await finish(g)
    g.startBattle(withKey('c2'))
    expect(total(modsOf(g, 'evade', 'a1'))).toBe(0)
  })
})

describe('其他格式的小處', () => {
  it('公式的 tier 是這棵樹的階數、grade 是場景的等級；use.ram 是固定的 RAM', () => {
    const g = play([ab('sk_f', 'active', { use: { ap: 1, ram: 2 }, meat: { do: [{ op: 'heal', who: 'self', amount: 'tier*2+grade' }] } })])
    turnTo(g, 'a1').hp!.now = 10
    expect(opt(g, 'sk_f').cost).toEqual({ ap: 1, ram: 2 })
    expect(g.battleAct({ action: 'sk_f' }).status).toBe('applied')
    expect(unit(g, 'a1').hp!.now).toBe(17)
    expect(unit(g, 'a1').pools.ram!.now).toBe(2)
  })

  it('attacked 的 no_wound：這一擊不擲重創（自然 20 也只是一般的命中）', () => {
    const mk = (skills: Rec[]) => field(skills, { foes: [foe('minion', { weapons: [testWeapon('pistol', 30)], ...quiet } as never), foe('minion', quiet as never)] })
    const plain = mk([])
    expect(plain.run(dice(20, 1, 1, 1, 1, 1, 1, 1)).attack(plain.foe(1), plain.ally(1)).wound).toBe(true)
    const a = mk([ab('sk_nw', 'reaction', { use: { ap: 1 }, meat: { trigger: { on: 'attacked', who: 'self' }, react: { no_wound: true } } })])
    expect(a.run(dice(20, 1, 1, 1, 1, 1, 1, 1)).attack(a.foe(1), a.ally(1)).wound).toBe(false)
  })

  it('after 的 who: own_overlay：自己的無人機被打（別人的不算）', () => {
    const a = field([ab('sk_oo', 'reaction', { use: { ap: 1 }, meat: { trigger: { on: 'after', who: 'own_overlay' }, do: [{ op: 'load', who: 'self', exact: true, amount: 1 }] } })])
    const run = a.run(dice(10, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1))
    const mine = run.addOverlay({ side: 'ally', slot: 1, owner: 'a1', kind: 'drone', name: '我的', hp: { now: 30, max: 30 }, armor: 0, evade: 0 })
    const theirs = run.addOverlay({ side: 'ally', slot: 3, owner: 'a2', kind: 'drone', name: '別人的', hp: { now: 30, max: 30 }, armor: 0, evade: 0 })
    run.attackOverlay(a.foe(1), theirs)
    expect(fired(run, 'sk_oo')).toBe(0)
    run.attackOverlay(a.foe(1), mine)
    expect(fired(run, 'sk_oo')).toBe(1)
  })

  it('沒有人裝 hp_half 的反應時，單位身上不留記號（不改別的戰鬥的資料）', () => {
    const a = field([])
    a.ally(1).hp!.now = 20
    a.run(dice(10, 1, 1, 1, 1, 1)).attack(a.foe(1), a.ally(1))
    expect(a.ally(1).uses.hp_half).toBeUndefined()
  })

  it('學技能、裝技能不會丟掉每件委託的次數與預備好的', () => {
    const g = makeGame({ features: FEATURES, content: [pack([ab('sk_a', 'active', { meat: { target: 'enemy', do: [{ op: 'attack' }] } })])], pc: { ext: { bridge: { capacity: { meat: 8, net: 8, social: 8, media: 8 } }, abilities: { xp: 100, learned: [], equipped: [], spent: {}, commission: { c1: { sk_a: 1 } }, prepared: [{ id: 'sk_p', scope: 'next_battle' }] } } } }).game
    g.commit(learn(g.k, g.state, 'pc', 'sk_root'))
    g.commit(equipAbilities(g.k, g.state, 'pc', ['sk_root']))
    expect(g.state.actors.pc!.ext.abilities).toMatchObject({ learned: ['sk_root'], equipped: ['sk_root'], commission: { c1: { sk_a: 1 } }, prepared: [{ id: 'sk_p', scope: 'next_battle' }] })
  })
})


describe('不動核心、不拿掉舊的鍵', () => {
  it('舊的主動技能（attack、apply、free_move、cost、weapon_cost、trigger 字串）和新的 do 可以並存在同一個技能裡', () => {
    const g = play([ab('sk_mix', 'active', { use: { ap: 1 }, meat: { target: 'enemy', apply: [{ status: 'marked', until: 'source_turn_start' }], do: [{ op: 'status', status: 'dazed' }] } })])
    turnTo(g, 'a1')
    expect(g.battleAct({ action: 'sk_mix', target: { unit: 'f1' } }).status).toBe('applied')
    expect(unit(g, 'f1').statuses.map((s) => s.id).sort()).toEqual(['dazed', 'marked'])
  })

  it('沒有角色的單位（敵人、測試用的）沒有現金與人情的池；有角色的有', () => {
    const g = play([])
    expect(Object.keys(unit(g, 'a1').pools).sort()).toEqual(['cash', 'favor_big', 'favor_mid', 'favor_small', 'ram'])
    expect(Object.keys(unit(g, 'a2').pools)).toEqual(['ram'])
    expect(Object.keys(unit(g, 'f1').pools)).toEqual([])
  })
})

// =====================================================================================
// M1b-core-fix2 第 4 項：格式補的四個小東西（trigger.who 的 self_or_ally、共鳴的池與感載上限、needs.cache_tag）；
// 效果的 who: foe_overlays 在核心（tests/core/battle-m1b-effects.test.ts）。

describe('trigger.who：self_or_ally（你或一名隊友）', () => {
  const react = (id: string, trigger: Rec, more: Rec = {}, use: Rec = { ap: 1 }) => ab(id, 'reaction', { use, meat: { trigger, ...more } })
  const load = (a: Rec) => () => makeGame({ features: FEATURES, content: [pack([a])] })

  it('格式：attacked、hit、after、overload、checked、out_before 收；hp_half 不收（寫出訊息裡有那個字）', () => {
    for (const on of ['attacked', 'hit', 'after', 'overload', 'checked', 'out_before']) {
      expect(load(react('sk_x', { on, who: 'self_or_ally' }, { do: [{ op: 'heal', who: 'self', amount: 1 }] })), on).not.toThrow()
    }
    expect(load(react('sk_x', { on: 'hp_half', who: 'self_or_ally' }, { do: [{ op: 'heal', who: 'self', amount: 1 }] }))).toThrow(/self_or_ally/)
  })

  it('checked：自己或隊友被擲檢定都觸發（偷看是不行的喔）；敵人被擲檢定不觸發；ally 不含自己、self 不含隊友（對照）', () => {
    const a = field([react('sk_ck', { on: 'checked', who: 'self_or_ally', if: 'hack' }, { react: { dc: 2 } }, { ram: 0 })])
    const dc = (target: 'a1' | 'a2' | 'a3' | 'f1', roller: 'a1' | 'f1' | 'f2') => {
      const t = a.battle.units[target]!
      return a.run(dice(10, 1, 1)).save(a.battle.units[roller]!, 'intellect', undefined, 10, '快駭', [], ['hack'], t).roll.dc
    }
    expect(dc('a1', 'f1')).toBe(12)
    expect(dc('a2', 'f1')).toBe(12)
    expect(dc('a3', 'f2')).toBe(12)
    // 敵人被我方擲檢定：是敵方，不觸發
    expect(dc('f1', 'a1')).toBe(10)
    // 對照：ally 不含自己
    const b = field([react('sk_ck', { on: 'checked', who: 'ally', if: 'hack' }, { react: { dc: 2 } }, { ram: 0 })])
    const bdc = (target: 'a1' | 'a2') => b.run(dice(10, 1, 1)).save(b.foe(1), 'intellect', undefined, 10, '快駭', [], ['hack'], b.battle.units[target]!).roll.dc
    expect([bdc('a1'), bdc('a2')]).toEqual([10, 12])
  })

  it('attacked：自己或隊友被攻擊都觸發（evade 加在這一擊上）；打敵人的攻擊不觸發', () => {
    const a = field([react('sk_ev', { on: 'attacked', who: 'self_or_ally' }, { react: { evade: 4 } })], { foes: [foe('minion', { weapons: [testWeapon('pistol', 30)], ...quiet } as never), foe('minion', quiet as never)] })
    const run = a.run(dice(10, 1, 1, 1, 1, 1, 10, 1, 1, 1, 1, 1))
    run.attack(a.foe(1), a.ally(1))
    run.attack(a.foe(1), a.ally(2))
    expect(fired(run, 'sk_ev')).toBe(2)
    const b = field([react('sk_ev', { on: 'attacked', who: 'self_or_ally' }, { react: { evade: 4 } })], { allies: [me(['sk_ev']), one({ weapon: 'pistol' }, 2)] })
    const rb = b.run(dice(10, 1, 1, 1, 1, 1))
    rb.attack(b.ally(2), b.foe(1))
    expect(fired(rb, 'sk_ev')).toBe(0)
  })

  it('out_before：自己或隊友即將退出都能擋下（各一次、行動點用反應的人的）', () => {
    const a = field([react('sk_pt', { on: 'out_before', who: 'self_or_ally' }, { react: { prevent: { how: ['down'] } } }, { ap: 1, per_turn: 1 })])
    const run = a.run()
    run.damage(a.ally(1), 999, 'physical', a.foe(1))
    expect(a.ally(1).out).toBeUndefined()
    // 一回合一次：第二個隊友擋不下
    run.damage(a.ally(2), 999, 'physical', a.foe(1))
    expect(a.ally(2).out).toBe('down')
    const b = field([react('sk_pt', { on: 'out_before', who: 'self_or_ally' }, { react: { prevent: { how: ['down'] } } }, { ap: 1, per_turn: 1 })])
    b.run().damage(b.ally(3), 999, 'physical', b.foe(1))
    expect(b.ally(3).out).toBeUndefined()
  })
})

describe('共鳴的 effect.pool 與 effect.load_max（RAM 上限、感載上限）', () => {
  const tree = (resonance: Rec[]) => ({ ...TREE, resonance })
  const RES = [
    { tier: 1, cells: 1, text: 'RAM 上限 +2。', effect: { pool: { ram: { max: 2 } } } },
    { tier: 3, cells: 1, text: 'RAM 上限再 +1、每回合回復 +1，感載上限 +4。', effect: { pool: { ram: { max: 1, regen: 1 } }, load_max: 4 } },
    { tier: 4, cells: 1, text: '感載上限 +10。', effect: { load_max: 10 } },
    { tier: 5, cells: 1, text: '開一個新的池。', effect: { pool: { focus: { max: 3, regen: 1 } } } },
  ]
  const mk = (res: Rec[], o: { ids?: string[]; tier?: number; me?: Rec } = {}) => {
    const ids = o.ids ?? ['sk_root']
    return field([], { tree: tree(res), allies: [me(ids, { actor: undefined, ext: { abilities: { equipped: ids, tiers: { tree: o.tier ?? 3 } } }, ...(o.me ?? {}) }), one({ weapon: 'pistol' }, 2), one({ weapon: 'pistol' }, 3)] })
  }

  it('到了階數的共鳴才算：第 3 階時 1、3 階的生效、4、5 階的不生效；沒有裝這棵樹的招牌的人不吃', () => {
    const a = mk(RES)
    const mate = a.ally(2)
    expect(a.ally(1).pools.ram).toMatchObject({ max: mate.pools.ram!.max + 3, regen: mate.pools.ram!.regen + 1 })
    expect(a.ally(1).load!.max).toBe(mate.load!.max + 4)
    expect(a.ally(1).pools.focus).toBeUndefined()
    // 現在的 RAM 也跟著加（開打時是滿的）
    expect(a.ally(1).pools.ram!.now).toBe(mate.pools.ram!.now + 3)
    // 第 5 階：四筆都生效，連新開的池
    const b = mk(RES, { tier: 5 })
    expect(b.ally(1).pools.ram!.max).toBe(b.ally(2).pools.ram!.max + 3)
    expect(b.ally(1).load!.max).toBe(b.ally(2).load!.max + 14)
    expect(b.ally(1).pools.focus).toEqual({ now: 3, max: 3, regen: 1 })
    // 沒有裝招牌：不算
    const c = mk(RES, { ids: [] })
    expect(c.ally(1).pools.ram!.max).toBe(c.ally(2).pools.ram!.max)
    expect(c.ally(1).load!.max).toBe(c.ally(2).load!.max)
  })

  it('沒有橋的人（沒有感載）吃不到 load_max，也不會被補出感載；負數的 load_max 最少剩 1', () => {
    const a = mk(RES, { me: { load: undefined } })
    expect(a.ally(1).load).toBeUndefined()
    expect(a.ally(1).pools.ram!.max).toBe(a.ally(2).pools.ram!.max + 3)
    const b = mk([{ tier: 1, cells: 1, text: '感載上限大減。', effect: { load_max: -9999 } }])
    expect(b.ally(1).load!.max).toBe(1)
  })

  it('格式：pool 的每一項要是整數（和 meat.pool 同一個檢查）、load_max 要是不為 0 的整數；寫壞的載入時擋下並寫出那個字', () => {
    const bad = (effect: Rec) => () => makeGame({ features: FEATURES, content: [pack([], {}, tree([{ tier: 1, cells: 1, text: '壞的。', effect }]))] })
    expect(bad({ pool: { ram: { max: 1 } }, load_max: 4 })).not.toThrow()
    expect(bad({ pool: { ram: { max: 1.5 } } })).toThrow(/pool\.ram\.max/)
    expect(bad({ pool: { ram: { size: 1 } } })).toThrow(/size/)
    expect(bad({ pool: {} })).toThrow(/pool/)
    expect(bad({ load_max: 0 })).toThrow(/load_max/)
    expect(bad({ load_max: 2.5 })).toThrow(/load_max/)
    expect(bad({ load_max: '4' })).toThrow(/load_max/)
    expect(bad({ cap: 1 })).toThrow(/cap/)
  })
})

describe('needs.cache_tag：目標的快取格裡有帶某標籤的道具', () => {
  const ITEMS = [
    { id: 'it_nade', name: '破片手雷', desc: '手雷。', category: 'consumable', grade: 1, size: 1, legal: 'free', tags: ['explosive', 'throwable'] },
    { id: 'it_gel', name: '急救凝膠', desc: '凝膠。', category: 'consumable', grade: 1, size: 1, legal: 'free', tags: ['medical'] },
  ]
  const conds = (meat: Rec, mutate: (g: G) => void) => {
    const g = play([ab('sk_c', 'active', { use: { ap: 1 }, meat: { target: 'enemy', ...meat } })], { foes: [idle({ name: '雜兵甲' }), idle({ name: '雜兵乙' })], extra: { item: ITEMS } })
    turnTo(g, 'a1')
    mutate(g)
    const a = opt(g, 'sk_c')
    return { action: a.blocks, targets: a.targets.map((t) => t.blocks) }
  }

  it('快取格裡有帶這個標籤的道具才選得了；沒有的那一句寫出標籤；數量是 0 的、標籤不對的不算', () => {
    const r = conds({ needs: { cache_tag: 'explosive' } }, (g) => {
      unit(g, 'f1').quick = [{ item: 'it_gel', qty: 2 }, { item: 'it_nade', qty: 0 }]
      unit(g, 'f2').quick = [{ item: 'it_gel', qty: 1 }, { item: 'it_nade', qty: 1 }]
    })
    expect(r.action).toEqual([])
    expect(r.targets).toEqual([['雜兵甲的快取格裡要有帶「explosive」標籤的道具才能用。'], []])
  })

  it('空的快取格、查不到的道具也是不成立；可以和別的 needs 同時寫、放進 any 的一組、放進 choose 的用法', () => {
    const r = conds({ needs: { cache_tag: 'explosive', bridged: true } }, (g) => {
      unit(g, 'f1').quick = []
      unit(g, 'f2').quick = [{ item: 'it_ghost', qty: 1 }]
    })
    expect(r.targets.map((t) => t.length)).toEqual([1, 1])
    const any = conds({ needs: { any: [{ wounded: true }, { cache_tag: 'explosive' }] } }, (g) => {
      unit(g, 'f2').quick = [{ item: 'it_nade', qty: 1 }]
    })
    expect(any.targets).toEqual([[expect.stringContaining('重傷')], []])
    const g = play([ab('sk_ch', 'active', { use: { ap: 1 }, meat: { target: 'enemy', picks: [{ key: 'way', label: '用法', kind: 'choice', required: true }], choose: [{ key: 'boom', label: '引爆', needs: { cache_tag: 'explosive' }, do: [{ op: 'damage', amount: 3, type: 'physical' }] }, { key: 'plain', label: '普通', do: [{ op: 'damage', amount: 1, type: 'physical' }] }] } })], { extra: { item: ITEMS } })
    turnTo(g, 'a1')
    unit(g, 'f2').quick = [{ item: 'it_nade', qty: 1 }]
    const pick = opt(g, 'sk_ch').picks[0]!
    const boom = pick.options.find((o) => o.value === 'boom')!
    expect(pickApplies(boom, { unit: 'f1' })).toBe(false)
    expect(pickApplies(boom, { unit: 'f2' })).toBe(true)
    expect(tryAct(g, { action: 'sk_ch', target: { unit: 'f1' }, pick: { way: 'boom' } })).not.toBeNull()
    expect(tryAct(g, { action: 'sk_ch', target: { unit: 'f2' }, pick: { way: 'boom' } })).toBeNull()
  })

  it('格式：cache_tag 要是標籤（字串）；target 不是人的技能不能寫 needs（照舊）', () => {
    const load = (meat: Rec) => () => makeGame({ features: FEATURES, content: [pack([ab('sk_x', 'active', { use: { ap: 1 }, meat })])] })
    expect(load({ target: 'enemy', needs: { cache_tag: 'explosive' }, do: [{ op: 'attack' }] })).not.toThrow()
    expect(load({ target: 'enemy', needs: { cache_tag: 3 }, do: [{ op: 'attack' }] })).toThrow(/cache_tag/)
    expect(load({ target: 'enemy', needs: { cache_tag: '' }, do: [{ op: 'attack' }] })).toThrow(/cache_tag/)
    expect(load({ target: 'foe_slot', needs: { cache_tag: 'explosive' }, do: [{ op: 'attack' }] })).toThrow(/needs/)
  })
})

describe('效果的 who: foe_overlays 在技能裡用', () => {
  it('格式收：do 裡寫 who: foe_overlays 載得進來；不認得的 who 照樣擋', () => {
    const load = (who: string) => () => makeGame({ features: FEATURES, content: [pack([ab('sk_x', 'active', { use: { ap: 1 }, meat: { target: 'none', do: [{ op: 'damage', amount: 2, type: 'physical', who }] } })])] })
    expect(load('foe_overlays')).not.toThrow()
    expect(load('foe_drones')).toThrow(/foe_drones/)
  })

  it('目標是「無」的技能對敵方每一台各做一次；一台都沒有時這一筆不做、別的效果照做', () => {
    const g = play([ab('sk_all', 'active', { use: { ap: 1 }, meat: { target: 'none', do: [{ op: 'damage', amount: 2, type: 'physical', who: 'foe_overlays' }, { op: 'field', key: 'dark' }] } })])
    turnTo(g, 'a1')
    // 一台都沒有：燈照樣關
    expect(g.battleAct({ action: 'sk_all' }).status).toBe('applied')
    expect(g.state.battle!.field.dark).toBe(true)
    g.state.battle!.field.dark = false
    const run = new BattleRun(g.k, g.state, g.state.battle!)
    for (const slot of [1, 2]) run.addOverlay({ side: 'foe', slot, kind: 'turret', name: `砲塔${slot}`, hp: { now: 20, max: 20 }, armor: 0, evade: 0 } as never)
    run.addOverlay({ side: 'ally', slot: 1, kind: 'turret', name: '我方砲塔', hp: { now: 20, max: 20 }, armor: 0, evade: 0 } as never)
    turnTo(g, 'a1')
    expect(g.battleAct({ action: 'sk_all' }).status).toBe('applied')
    expect(g.state.battle!.overlays.map((o) => [o.side, o.hp.now])).toEqual([['foe', 18], ['foe', 18], ['ally', 20]])
  })
})
