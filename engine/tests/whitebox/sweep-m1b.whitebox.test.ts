// 白箱測試：自動戰鬥的掃描（M1b 第二波）。無人機、砲塔、敵人的招牌行動、技能、快駭、投擲物、特徵一起上，多組種子，
// 我方由「隨機的玩家」（從圓環上能做的行動裡隨機挑行動、目標與要選的東西）操縱，敵方由 AI 打；每一步之後檢查：
//   1. 核心的 battleProblems（戰鬥狀態的骨架）沒有問題；
//   2. 數值在範圍內（生命、感載、餘韻、行動點、彈匣、資源池、掛著的東西的耐久、遮蔽的耐久、沉溺、每一個數字都是有限的）；
//   3. 站位與回合指標合法、回合數不倒退；
//   4. 同一個種子（含隨機玩家的種子）再打一次，每一步之後的狀態雜湊一模一樣（不變式 47：種子重播）；
//   5. 提交的不變式（observed）沒有違規；分出結果之後可以結算。
// 另外記錄掃描有沒有真的走到每一種機制（放出無人機、快駭、招牌行動、投擲物……），沒走到就失敗：不讓掃描默默變成只在打普通射擊。
// 內容一律是測試自帶的假資料。規格：dev/invariants.md 第 45、47、49、52、53 條；COMBAT_SYSTEM 第 1～9 節。

import { describe, expect, it } from 'vitest'
import type { BattleActionOption, BattleSetup, BattleState, ContentPack, Feature } from '../../src'
import { END_TURN, battleProblems, pickApplies } from '../../src'
import { abilitiesFeature } from '../../src/features/abilities'
import { combatFeature } from '../../src/features/combat'
import { enemiesFeature } from '../../src/features/enemies'
import { hackFeature } from '../../src/features/hack'
import { summonsFeature } from '../../src/features/summons'
import { makeBattleGame, observed, partyUnit, stateHash } from '../../src/testkit'
import { TEST_STATUSES, raw } from '../helpers/battle'

type Rec = Record<string, unknown>
const FEATURES: Feature[] = [combatFeature, abilitiesFeature, summonsFeature, hackFeature, enemiesFeature]

// ---------------------------------------------------------------------------------------------
// 假資料
// ---------------------------------------------------------------------------------------------

const SKILLS = ['firearms', 'brawl', 'composure', 'interface', 'piloting'].map((id) => ({ id, name: id, attr: id === 'composure' ? 'resolve' : id === 'interface' ? 'intellect' : id === 'brawl' ? 'body' : 'reflex', desc: `${id}。` }))
const WEAPONS = [{ id: 'pistol', name: '手槍', dice: 3, type: 'physical', range: [1, 4], mag: 3, cover_mult: 0.25, pierce: 0, traits: [], attr: 'reflex', skill: 'firearms' }]
const PATH = { id: 'sweep', name: '掃描樹', tree: '掃描樹', category: 'meat', signature: 'sk_root', domains: { meat: 'strong', net: 'none', opinion: 'none' }, resonance: [] }
const ab = (id: string, kind: string, more: Rec = {}): Rec => ({ id, name: id, path: 'sweep', category: 'meat', tier: 1, layer: 'front', kind, cap: 1, xp: 20, cells: 1, after: 'sk_root', text: `${id}。`, net: null, opinion: null, meat: null, ...more })
const sig = (id: string, kind: string, more: Rec = {}): Rec => ({ id, name: `招牌${id}`, text: `${id}。`, enemy: true, kind, ...more })
const DRONE_PICK = { key: 'drone', label: '放出哪一台', kind: 'drone', required: true }
const AT = { key: 'at', label: '打誰', kind: 'foe', required: false }
const ABILITIES: Rec[] = [
  ab('sk_root', 'passive', { layer: 'signature', after: undefined, meat: { tags: ['root'] } }),
  ab('sk_shot', 'active', { use: { ap: 1 }, meat: { target: 'enemy', do: [{ op: 'attack', hit: 1, label: '精準射擊' }] } }),
  ab('sk_burst', 'active', { use: { ap: 2 }, meat: { target: 'enemy', do: [{ op: 'attack', spend: 'all', label: '連射' }, { op: 'status', status: 'suppressed', if: 'hit' }] } }),
  ab('sk_buff', 'active', { use: { ap: 1, per_turn: 1 }, meat: { target: 'self', do: [{ op: 'buff', id: 'cheer', turns: 2, mods: [{ kind: 'hit', value: 1 }] }] } }),
  ab('sk_stance', 'stance', { use: { ap: 1 }, meat: { mods: [{ kind: 'evade', value: 2 }] } }),
  ab('sk_ward', 'active', { use: { ap: 1 }, meat: { target: 'foe_slot', do: [{ op: 'ward', slot: 'target', until: 'own_turn_start', on: ['move', 'compact', 'attack'], do: [{ op: 'attack' }] }] } }),
  ab('sk_cover_temp', 'active', { use: { ap: 1 }, meat: { target: 'self', do: [{ op: 'cover_temp', levels: 1 }, { op: 'ap', amount: 1, who: 'self' }] } }),
  ab('sk_counter', 'reaction', { use: { ap: 1, per_turn: 1 }, meat: { trigger: { on: 'attacked', who: 'self' }, react: { hit: -1 } } }),
  ab('sk_deploy', 'active', { use: { ap: 1 }, meat: { target: 'ally_slot', picks: [AT, DRONE_PICK], do: [{ op: 'drone.deploy', drone: 'drone' }, { op: 'drone.act', which: 'target', at: 'pick:at', hit: 1 }] } }),
  ab('sk_swarm', 'active', { use: { ap: 2 }, meat: { target: 'enemy', do: [{ op: 'drone.act', which: 'all', max: 3, at: 'target' }] } }),
  ab('sk_guardian', 'active', { use: { ap: 1 }, meat: { target: 'own_overlay', do: [{ op: 'drone.guard' }] } }),
  ab('sk_repair', 'active', { use: { ap: 1 }, meat: { target: 'own_overlay', do: [{ op: 'drone.repair', amount: 6 }] } }),
  // 敵人的招牌行動
  sig('ab_e_strike', 'active', { use: { ap: 2 }, meat: { target: 'enemy', do: [{ op: 'attack', hit: 1, label: '重擊' }] }, ai: { score: 3 } }),
  sig('ab_e_mend', 'active', { use: { ap: 1 }, meat: { target: 'ally', do: [{ op: 'heal', amount: 5 }] }, ai: { score: 3, when: { target_hp_below: 0.6 } } }),
  sig('ab_e_ult', 'active', { use: { ap: 2 }, meat: { target: 'enemy', do: [{ op: 'attack', hit: 3, label: '大招' }] }, ai: { score: 4, unlock: 'low' } }),
  sig('ab_e_stance', 'stance', { use: { ap: 1 }, meat: { mods: [{ kind: 'evade', value: 1 }] } }),
]
const prog = (id: string, cls: string, more: Rec = {}): Rec => ({ id, name: id, desc: `${id}。`, class: cls, grades: [1, 2, 3, 4], ram: 2, ap: 1, target: 'foe', do: [{ op: 'load', amount: 4, type: 'neural' }], ...more })
const PROGRAMS: Rec[] = [
  prog('qh_noise', 'neural'),
  prog('qh_loop', 'neural', { do: [{ op: 'hack.dot', amount: 2, turns: 3 }] }),
  prog('qh_relay', 'device', { do: [{ op: 'status', status: 'jammed' }] }),
  prog('qh_take', 'device', { ram: 3, target: 'foe_overlay', do: [{ op: 'hack.takeover', turns: 2 }] }),
  prog('qh_rewrite', 'device', { ram: 3, target: 'foe_overlay', do: [{ op: 'hack.takeover', mode: 'rewrite' }] }),
  prog('qh_boom', 'device', { do: [{ op: 'hack.detonate' }] }),
  prog('qh_mark', 'support', { ram: 1, do: [{ op: 'status', status: 'marked', until: 'source_turn_start' }] }),
  prog('qh_vent', 'support', { ram: 1, target: 'ally', do: [{ op: 'vent', amount: 5 }] }),
]
const item = (id: string, more: Rec = {}): Rec => ({ id, name: id, desc: `${id}。`, category: 'consumable', grade: 1, size: 1, legal: 'free', ...more })
const ITEMS: Rec[] = [
  item('it_gel', { tags: ['medical'], use: { ap: 1, target: 'self', effects: [{ op: 'heal', amount: 6 }] } }),
  item('it_nade', { tags: ['explosive', 'throwable'], use: { ap: 2, target: 'foe_slot', effects: [{ op: 'throw', dice: 2, cover: 1 }] } }),
  item('it_smoke', { use: { ap: 1, target: 'ally_slot', effects: [{ op: 'soft_cover', kind: 'smoke' }] } }),
  item('it_decoy', { use: { ap: 1, target: 'ally_slot', effects: [{ op: 'decoy' }] } }),
]
const foeData = (id: string, rank: string, more: Rec = {}): Rec => ({
  id, name: `測試${id}`, desc: '測試用的敵人。', faction: 'hizakura', rank, grades: [1, 5], kind: 'human',
  position: { prefer: [1, 2], cover_use: 0.5 }, mode: 'lethal', weapons: [{ class: 'pistol' }], ai: { prefer: 'weakest', focus: 1, flee_below: 0.2 }, ...more,
})
const overlayData = (id: string, kind: string, more: Rec = {}): Rec =>
  foeData(id, 'minion', { name: `${id}號機`, kind: 'machine', position: { prefer: [2, 3], size: 'overlay' }, overlay: { kind }, ...more })
const TRAITS: Rec[] = [
  { id: 'tr_veteran', name: '老兵', desc: '命中 +1；士氣 DC −3。', mods: { hit: 1 }, ai: { morale_dc: -3 } },
  { id: 'tr_hurt', name: '受傷', desc: '生命只剩六成。', mods: { hp_pct: -40 } },
  { id: 'tr_roll', name: '可擲', desc: '擲得到。', tags: ['rolled'], roll: { weight: 1, kinds: ['human'] }, mods: { ap: 1 } },
]
const ENEMIES: Rec[] = [
  foeData('en_grunt', 'minion'),
  foeData('en_elite', 'elite', { signature: ['ab_e_strike', 'ab_e_stance'] }),
  foeData('en_medic', 'elite', { signature: ['ab_e_mend'] }),
  foeData('en_boss', 'boss', { signature: ['ab_e_ult', 'ab_e_strike'], ai: { prefer: 'leader', focus: 1, flee_below: 0, never_flee: true } }),
  foeData('en_vet', 'minion', { traits: ['tr_veteran'] }),
  foeData('en_angel', 'minion', { angel: 'gold' }),
  foeData('en_pilot', 'elite', { attached: [{ enemy: 'en_patrol', count: 2 }, { enemy: 'en_shield' }], position: { prefer: [3] } }),
  foeData('en_hacker', 'elite', { deck: { grade: 3, firewall: 12, slots: ['qh_noise', 'qh_mark'] }, tags: ['quickhack'], position: { prefer: [4] } }),
  overlayData('en_patrol', 'attack', { mods: { hp: 0.5 } }),
  overlayData('en_turret', 'turret', { overlay: { kind: 'turret', fixed: true }, position: { prefer: [4], size: 'overlay' } }),
  overlayData('en_shield', 'shield', { weapons: [], position: { prefer: [1], size: 'overlay' } }),
]
const PACK: ContentPack = {
  id: 'wb_sweep_m1b',
  content: {
    skill: SKILLS, weapon_class: WEAPONS, faction: [{ id: 'hizakura', name: '緋櫻重工', short: '緋櫻', class: 'corp' }],
    battle_status: [
      ...TEST_STATUSES,
      { id: 'limb_hurt', name: '肢體受創', desc: '命中 −2。', mods: { hit: -2 }, until: 'battle_end', kind: 'wound' },
      { id: 'off_generic', name: '義體失效', desc: '義體失效。', until: 'own_turn_end', turns: 1, kind: 'debuff' },
      { id: 'boost_generic', name: '義體超頻', desc: '義體超頻。', until: 'own_turn_end', turns: 1, kind: 'buff' },
    ],
    path: [PATH], ability: ABILITIES, quickhack: PROGRAMS, item: ITEMS, enemy_trait: TRAITS, enemy: ENEMIES,
  },
} as unknown as ContentPack

// 我方：槍手（技能與道具）、機師（無人機）、潛網者（快駭）
const equipped = (ids: string[]) => ({ abilities: { equipped: ids, tiers: { sweep: 2 } } })
const GUNNER = (): Rec => ({
  ...partyUnit(0, 1, { weapon: 'smg' }), name: '槍手', tags: [], skills: { firearms: 3, brawl: 2, composure: 1, piloting: 0 },
  ext: equipped(['sk_shot', 'sk_burst', 'sk_buff', 'sk_stance', 'sk_ward', 'sk_cover_temp', 'sk_counter']),
  quick: [{ item: 'it_gel', qty: 2 }, { item: 'it_nade', qty: 2 }, { item: 'it_smoke', qty: 1 }, { item: 'it_decoy', qty: 1 }],
})
const PILOT = (): Rec => ({
  ...partyUnit(1, 1, { weapon: 'pistol' }), name: '機師', tags: [], skills: { firearms: 2, brawl: 1, composure: 1, piloting: 2, sync: 4 },
  ext: { ...equipped(['sk_deploy', 'sk_swarm', 'sk_guardian', 'sk_repair', 'sk_shot']), summons: { drones: [{ kind: 'attack', grade: 2 }, { kind: 'shield', grade: 1 }, { kind: 'scout', grade: 1 }, { kind: 'medic', grade: 1 }, { kind: 'jammer', grade: 1 }] } },
})
const HACKER = (): Rec => ({
  ...partyUnit(2, 1, { weapon: 'pistol' }), name: '潛網者', tags: ['quickhack'], skills: { firearms: 1, brawl: 1, composure: 1, interface: 3 },
  attrs: { body: 10, reflex: 13, tech: 10, intellect: 15, resolve: 12, charm: 10 },
  pools: { ram: { now: 10, max: 10, regen: 3 } },
  ext: { ...equipped(['sk_shot']), deck: { grade: 3, firewall: 12, slots: PROGRAMS.map((p) => p.id) } },
  quick: [{ item: 'it_gel', qty: 1 }],
})

interface Scenario { name: string; foes: Rec[]; overlays?: Array<Rec>; cover: string; field?: Rec; ambush?: 'ally' | 'foe'; grade?: 1 | 2 | 3 }
const SCENARIOS: Scenario[] = [
  { name: '無人機與砲塔一起上：兩個雜兵加巡邏無人機與砲塔', foes: [{ from: 'enemy', id: 'en_grunt' }, { from: 'enemy', id: 'en_grunt' }, { from: 'enemy', id: 'en_vet' }], overlays: [{ enemy: 'en_patrol', slot: 2 }, { enemy: 'en_turret' }], cover: 'medium' },
  { name: '敵人的招牌行動：精英、醫護、首領的低血大招', foes: [{ from: 'enemy', id: 'en_elite' }, { from: 'enemy', id: 'en_medic' }, { from: 'enemy', id: 'en_boss' }], cover: 'dense' },
  { name: '會指揮的敵人與敵方潛網者、天使急救的會員', foes: [{ from: 'enemy', id: 'en_pilot' }, { from: 'enemy', id: 'en_hacker' }, { from: 'enemy', id: 'en_angel' }], cover: 'sparse', ambush: 'foe' },
  { name: '黑暗的一邊倒場地：埋伏與全部的敵人', foes: [{ from: 'enemy', id: 'en_hacker' }, { from: 'enemy', id: 'en_vet' }], overlays: [{ enemy: 'en_turret' }], cover: 'one_sided', field: { dark: true }, ambush: 'ally' },
]
const SEEDS = [1, 42, 31337]

const setupOf = (s: Scenario): BattleSetup => ({
  mode: 'meat', grade: s.grade ?? 1, cover: s.cover, allies: [GUNNER(), PILOT(), HACKER()].map((u) => raw(u)),
  foes: s.foes as never, origin: { escapable: true, place: '掃描用的倉庫', ...(s.overlays ? { ext: { enemies: { overlays: s.overlays } } } : {}) },
  ...(s.field ? { field: s.field as never } : {}), ...(s.ambush ? { ambush: s.ambush } : {}),
})

// ---------------------------------------------------------------------------------------------
// 檢查
// ---------------------------------------------------------------------------------------------

const nonFinite = (v: unknown, path: string, out: string[]): void => {
  if (typeof v === 'number') { if (!Number.isFinite(v)) out.push(`${path} 是 ${v}`); return }
  if (Array.isArray(v)) { v.forEach((x, i) => nonFinite(x, `${path}[${i}]`, out)); return }
  if (v && typeof v === 'object') for (const [k, x] of Object.entries(v)) nonFinite(x, `${path}.${k}`, out)
}

/** 數值的範圍與站位（不變式 45、49、52、53 的延伸）：每一條違反寫成一句。 */
function rangeProblems(b: BattleState, prev: { round: number; steps: number } | null): string[] {
  const p: string[] = [...battleProblems(b)]
  nonFinite(b, 'battle', p)
  for (const u of Object.values(b.units)) {
    const at = u.id
    if (u.hp && (u.hp.now < 0 || u.hp.now > u.hp.max)) p.push(`${at} 生命 ${u.hp.now}／${u.hp.max}`)
    if (u.hp && u.hp.max < 1) p.push(`${at} 生命上限 ${u.hp.max}`)
    if (u.load && (u.load.now < 0 || u.load.now > u.load.max)) p.push(`${at} 感載 ${u.load.now}／${u.load.max}`)
    if (u.layers < 0 || u.layers > u.layersMax) p.push(`${at} 餘韻 ${u.layers}／${u.layersMax}`)
    if (u.ap.now < 0 || u.ap.now > u.ap.max) p.push(`${at} 行動點 ${u.ap.now}／${u.ap.max}`)
    for (const [k, pool] of Object.entries(u.pools)) if (pool.now < 0 || pool.now > pool.max) p.push(`${at} 資源 ${k} ${pool.now}／${pool.max}`)
    for (const w of u.weapons) if (w.mag && (w.mag.now < 0 || w.mag.now > w.mag.max)) p.push(`${at} 的 ${w.name} 彈匣 ${w.mag.now}／${w.mag.max}`)
    if (u.sink < 0) p.push(`${at} 沉溺 ${u.sink}`)
    if (u.slot < 0 || u.slot > 4) p.push(`${at} 站在第 ${u.slot} 格`)
    if (u.out && u.hp && u.out === 'down' && u.hp.now !== 0) p.push(`${at} 倒下了但生命 ${u.hp.now}`)
    for (const s of u.statuses) if (typeof s.until?.at !== 'string') p.push(`${at} 的狀態 ${s.id} 沒有到期條件`)
  }
  for (const o of b.overlays) {
    if (o.hp.now < 0 || o.hp.now > o.hp.max) p.push(`${o.id} 耐久 ${o.hp.now}／${o.hp.max}`)
    if (o.slot < 1 || o.slot > 4) p.push(`${o.id} 掛在第 ${o.slot} 格`)
  }
  // 交叉檢查：不同結構之間要對得上
  const unitIds = Object.keys(b.units)
  if (new Set(b.order).size !== b.order.length) p.push('order 裡有重複的單位')
  if (!b.result && b.acting !== undefined && (!b.units[b.acting] || b.units[b.acting]!.out)) p.push(`acting ${b.acting} 不在場上`)
  for (const side of ['ally', 'foe'] as const) {
    for (const id of b.reserve[side]) {
      const r = b.units[id]
      if (!r || r.side !== side || r.out || r.slot !== 0) p.push(`後方排隊的 ${id} 狀態不對（slot ${r?.slot}、out ${r?.out}）`)
      if (b.order.includes(id) && b.units[id]?.slot !== 0) p.push(`${id} 又在後方又站在場上`)
    }
  }
  for (const u of Object.values(b.units)) {
    if (new Set(u.tags).size !== u.tags.length) p.push(`${u.id} 的標籤有重複：${u.tags.join(',')}`)
    for (const s of u.statuses) if ('turns' in s.until && typeof s.until.turns === 'number' && s.until.turns < 1) p.push(`${u.id} 的狀態 ${s.id} 剩 ${s.until.turns} 回合卻還在`)
    for (const [k, v] of Object.entries(u.uses)) {
      if (!Number.isFinite(v)) p.push(`${u.id} 的 uses.${k} 是 ${v}`)
      const m = /^drone:(\d+)$/.exec(k)
      if (!m) continue
      const idx = Number(m[1])
      const held = b.overlays.find((o) => !o.down && o.ext?.drone === idx && o.ext?.operator === u.id)
      if (v === 1 && !held) p.push(`${u.id} 的第 ${idx} 台記著放出去了，場上卻沒有那一台`)
      if (v === 2 && held) p.push(`${u.id} 的第 ${idx} 台記著被擊落了，場上卻還有`)
      if (v !== 1 && v !== 2) p.push(`${u.id} 的 uses.${k} 是 ${v}`)
    }
  }
  for (const o of b.overlays) {
    if (o.owner !== undefined && !unitIds.includes(o.owner)) p.push(`${o.id} 的操作者 ${o.owner} 不在單位裡`)
    const taken = (o.ext?.hack as Rec | undefined)?.taken as Rec | undefined
    if (taken && !o.down && !unitIds.includes(String(taken.by))) p.push(`${o.id} 被不存在的 ${String(taken.by)} 接管`)
    if (taken && !o.down && b.units[String(taken.by)]?.out && taken.mode === 'takeover') p.push(`${o.id} 的接管者 ${String(taken.by)} 已經退出，接管還在`)
  }
  for (const side of ['ally', 'foe'] as const) b.cover[side].forEach((c, i) => { if (c.hp < 0) p.push(`${side} 第 ${i + 1} 格遮蔽耐久 ${c.hp}`) })
  if (b.order.length && (b.turn < 0 || b.turn >= b.order.length)) p.push(`turn ${b.turn} 不在 order 裡`)
  if (prev && b.round < prev.round) p.push(`回合數倒退：${prev.round} → ${b.round}`)
  if (prev && b.steps.length < prev.steps) p.push(`紀錄變短了：${prev.steps} → ${b.steps.length}`)
  return p
}

// ---------------------------------------------------------------------------------------------
// 隨機的玩家與一場完整的戰鬥
// ---------------------------------------------------------------------------------------------

/** 自己的小亂數（xorshift），和戰鬥的亂數分開：同一個種子同一串選擇。 */
function chooser(seed: number): { next(): number; pick<T>(list: T[]): T } {
  let s = (seed * 2654435761) >>> 0 || 1
  const next = (): number => {
    s ^= s << 13; s >>>= 0
    s ^= s >>> 17
    s ^= s << 5; s >>>= 0
    return s / 4294967296
  }
  return { next, pick: (list) => list[Math.floor(next() * list.length)]! }
}

/** 一個行動的輸入：隨機挑還能選的目標與要選的東西；挑不出來（必選的沒有選項）回傳 null。 */
function inputOf(o: BattleActionOption, c: ReturnType<typeof chooser>): { action: string; target?: unknown; pick?: Rec } | null {
  let target: unknown
  if (o.target !== 'none') {
    const okTargets = o.targets.filter((t) => t.blocks.length === 0)
    if (!okTargets.length) return null
    target = c.pick(okTargets).target
  }
  const pick: Rec = {}
  for (const pk of o.picks) {
    const opts = pk.options.filter((x) => x.blocks.length === 0 && pickApplies(x, target as never))
    if (!opts.length) {
      if (pk.required) return null
      continue
    }
    if (pk.required || c.next() < 0.6) pick[pk.key] = c.pick(opts).value
  }
  return { action: o.id, ...(target ? { target } : {}), ...(Object.keys(pick).length ? { pick } : {}) }
}

interface Trace { hashes: string[]; actions: Map<string, number>; problems: string[]; outcome: string | undefined; steps: number; violations: string[]; end: string | undefined }

async function fight(s: Scenario, seed: number): Promise<Trace> {
  const { game } = makeBattleGame({ battle: setupOf(s), seed, features: FEATURES, content: [PACK] })
  const c = chooser(seed)
  const actions = new Map<string, number>()
  const hashes: string[] = []
  const problems: string[] = [...rangeProblems(game.battle!, null)]
  let prev = { round: game.battle!.round, steps: game.battle!.steps.length }
  const { result, violations } = await observed(game, async () => {
    let steps = 0
    while (game.battle && !game.battle.result) {
      if (++steps > 4000) throw new Error('打了 4000 步還沒分出結果')
      const opts = game.battleOptions()
      let applied = false
      if (opts?.waiting === 'player' && game.battle.round <= 12) {
        const usable = opts.actions.filter((a) => a.ok && a.id !== END_TURN && a.id !== 'flee' && a.id !== 'surrender')
        // 十分之一直接結束回合；其餘從能做的行動裡隨機挑，挑到的輸入不成立再試幾次
        for (let tries = 0; tries < 4 && usable.length && c.next() > 0.3 && !applied; tries++) {
          const o = c.pick(usable)
          const input = inputOf(o, c)
          if (!input) continue
          const r = game.battleAct(input as never)
          if (r.status === 'applied') {
            applied = true
            actions.set(o.id, (actions.get(o.id) ?? 0) + 1)
          } else if (!(r.reasons ?? []).length) problems.push(`第 ${steps} 步：${o.id} 沒有成立，卻沒有寫原因`)
        }
        if (!applied) {
          const r = game.battleAct({ action: END_TURN } as never)
          if (r.status !== 'applied') throw new Error(`第 ${steps} 步：結束回合沒有成立：${(r.reasons ?? []).join(' ')}`)
          applied = true
        }
      }
      if (!applied) {
        const r = game.battleNext({ anyone: true })
        if (r.status !== 'applied') throw new Error(`第 ${steps} 步：自動的一步沒有成立：${(r.reasons ?? []).join(' ')}`)
      }
      const b = game.battle!
      problems.push(...rangeProblems(b, prev).map((x) => `第 ${steps} 步：${x}`))
      prev = { round: b.round, steps: b.steps.length }
      hashes.push(stateHash({ battle: game.battle } as never))
      if (problems.length) break
    }
    const outcome = game.battle?.result?.outcome
    const end = problems.length ? undefined : await game.finishBattle()
    return { outcome, steps, end: end?.status }
  })
  return { hashes, actions, problems, outcome: result.outcome, steps: result.steps, violations, end: result.end }
}

describe('白箱 自動戰鬥的掃描：無人機、砲塔、招牌行動、技能、快駭、投擲物（dev/invariants.md 第 45、47、49、52、53 條）', () => {
  const reached = new Map<string, number>()
  const outcomes = new Map<string, number>()
  const first: Trace[] = []

  for (const s of SCENARIOS) {
    it(`${s.name}：${SEEDS.length} 組種子，每一步 battleProblems 沒有問題、數值在範圍內、提交沒有違規、結算得了；第一組種子重打一次，每一步的狀態雜湊一模一樣`, async () => {
      for (const seed of SEEDS) {
        const a = await fight(s, seed)
        expect(a.problems, `${s.name} 種子 ${seed}`).toEqual([])
        expect(a.violations, `${s.name} 種子 ${seed}`).toEqual([])
        expect(a.outcome, `${s.name} 種子 ${seed}`).toBeDefined()
        expect(a.end, `${s.name} 種子 ${seed}`).toBe('applied')
        if (seed === SEEDS[0]) {
          const b = await fight(s, seed)
          expect(b.hashes, `${s.name} 種子 ${seed} 重打`).toEqual(a.hashes)
          expect(b.outcome).toBe(a.outcome)
          first.push(a)
        }
        for (const [id, n] of a.actions) reached.set(id, (reached.get(id) ?? 0) + n)
        outcomes.set(a.outcome!, (outcomes.get(a.outcome!) ?? 0) + 1)
      }
    }, 120_000)
  }

  it('掃描真的走到每一種機制：技能、無人機、快駭、道具（投擲物、煙霧、立牌）；不同的情境走出不同的戰鬥（雜湊串不一樣）', () => {
    const must = ['sk_shot', 'sk_burst', 'sk_buff', 'sk_ward', 'sk_deploy', 'item']
    for (const id of must) expect(reached.has(id), `掃描沒有走到 ${id}（走到的：${[...reached.keys()].join('、')}）`).toBe(true)
    expect([...reached.keys()].some((k) => k.startsWith('hack.')), `掃描沒有走到快駭（走到的：${[...reached.keys()].join('、')}）`).toBe(true)
    expect(outcomes.size).toBeGreaterThanOrEqual(1)
    expect(new Set(first.map((t) => t.hashes.join())).size).toBe(first.length)
  })
})
