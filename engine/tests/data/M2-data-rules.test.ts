// 驗收測試：dev/work/M2-data-rules.md（cpp-data）。M2 的規則表（只有數字與種類表，不含內容）與行動種類。
// 規格：每一張表的出處見 data/index.ts 的 SOURCES；暫定的欄位見 PROVISIONAL。
// 資料與功能的預設要一致：每一張表逐格和功能匯出的 DEFAULT_… 比（設計書與預設對不上的地方記在回報，不在這裡自己挑一邊）。

import { describe, expect, it } from 'vitest'
import { Game } from '../../src'
import { allFeatures } from '../../src/features'
import { CORE_PACK, PROVISIONAL, SOURCES, UNWIRED } from '../../data'
import { DEFAULT_ABILITY_RULES, abilityRules } from '../../src/features/abilities/loadout'
import { DEFAULT_BILL_RULES, billRules } from '../../src/features/bills/model'
import { DEFAULT_COMMISSION_RULES, commissionRules } from '../../src/features/commission/model'
import { DEFAULT_EVENT_RULES, eventRules } from '../../src/features/director/model'
import { DEFAULT_FAVOR_RULES, favorRules } from '../../src/features/favors/model'
import { DEFAULT_FIXER_RULES, fixerRules } from '../../src/features/fixer/model'
import { DEFAULT_GEN_RULES, genRules } from '../../src/features/fixer/gen'
import { DEFAULT_LEWD_RULES, lewdRules } from '../../src/features/lewd/model'
import { DEFAULT_INTERACT_RULES, interactRules } from '../../src/features/npcs/interact'
import { DEFAULT_LIFE_RULES, lifeRules } from '../../src/features/npcs/lifeRules'
import { DEFAULT_NPC_RULES, npcRules } from '../../src/features/npcs/model'
import { DEFAULT_REST_RULES, restRules } from '../../src/features/rest/model'
import { DEFAULT_ROSTER_RULES, rosterRules } from '../../src/features/roster/model'
import { DEFAULT_SCENE_RULES, sceneRules } from '../../src/features/scene/model'
import { DEFAULT_SECURITY_RULES, securityRules } from '../../src/features/security/model'
import { DEFAULT_TRADE_RULES, tradeRules } from '../../src/features/trade/model'
import { DEFAULT_TRANSIT_RULES, transitRules } from '../../src/features/transit/model'
import { DEFAULT_WORK_RULES, workRules } from '../../src/features/work/model'
import abilities from '../../data/rules/abilities.json'
import actions from '../../data/rules/actions.json'
import scopes from '../../data/rules/event_scopes.json'
import facilityTypes from '../../data/rules/facility_types.json'
import scanLevels from '../../data/rules/scan_levels.json'
import shopTypes from '../../data/rules/shop_types.json'

const game = () => new Game({ features: allFeatures(), content: [CORE_PACK] })
type Rec = Record<string, unknown>
const raw = (g: Game, kind: string, id = 'default'): Rec => {
  const { id: _id, ...rest } = g.k.content.get(kind, id) as Rec
  return rest
}

const NEW_KINDS = [
  'event_rule', 'event_scope', 'security_rule', 'commission_rule', 'fixer_rule', 'trade_rule', 'shop_type', 'bill_rule', 'rest_rule', 'work_rule', 'scene_rule',
  'lewd_rule', 'npc_interact_rule', 'roster_rule', 'favor_rule', 'npc_rule', 'npc_life_rule', 'transit_rule', 'ability_rule', 'facility_type',
]

describe('M2-data-rules：載入與引用', () => {
  it('帶著全部功能載入整包資料沒有錯，引用都找得到', () => {
    expect(() => game()).not.toThrow()
    expect(game().k.content.checkRefs()).toEqual([])
  })

  it('每一種新的規則表都有資料、被一個功能認得（內容種類已註冊）、寫了出處', () => {
    const g = game()
    for (const kind of NEW_KINDS) {
      expect(g.k.content.hasKind(kind), kind).toBe(true)
      expect(g.k.content.list(kind).length, kind).toBeGreaterThan(0)
      expect(SOURCES[kind], kind).toMatch(/\S/)
    }
  })

  it('每一種「id: default」的規則表都只有那一筆', () => {
    const g = game()
    for (const kind of NEW_KINDS.filter((k) => k.endsWith('_rule'))) expect(g.k.content.list(kind).map((e) => e.id), kind).toEqual(['default'])
  })

  it('沒有人認得的種類（掃描強度）不在 CORE_PACK 裡，放在 UNWIRED；出處寫了這件事', () => {
    expect(Object.keys(CORE_PACK.content)).not.toContain('scan_level')
    expect(UNWIRED.scan_level).toBe(scanLevels)
    expect(SOURCES.scan_level).toContain('EQUIPMENT 6.3')
    expect(game().k.content.hasKind('scan_level')).toBe(false)
  })

  it('暫定的欄位有列出來，而且都是那張表真的有的欄位', () => {
    const g = game()
    for (const [kind, fields] of Object.entries(PROVISIONAL)) {
      for (const f of fields) {
        if (f.includes('（')) continue
        const head = f.split('.')[0]!
        if (kind === 'shop_type' || kind === 'facility_type') continue
        expect(Object.keys(raw(g, kind)), `${kind}.${f}`).toContain(head)
      }
    }
  })
})

describe('M2-data-rules：資料和功能的預設一致（逐格）', () => {
  const g = game()
  const cases: Array<[string, Rec, unknown]> = [
    ['event_rule', DEFAULT_EVENT_RULES as unknown as Rec, eventRules(g.k)],
    ['security_rule', DEFAULT_SECURITY_RULES as unknown as Rec, securityRules(g.k)],
    ['fixer_rule', DEFAULT_FIXER_RULES as unknown as Rec, fixerRules(g.k)],
    ['trade_rule', DEFAULT_TRADE_RULES as unknown as Rec, tradeRules(g.k)],
    ['bill_rule', DEFAULT_BILL_RULES as unknown as Rec, billRules(g.k)],
    ['rest_rule', DEFAULT_REST_RULES as unknown as Rec, restRules(g.k)],
    ['work_rule', DEFAULT_WORK_RULES as unknown as Rec, workRules(g.k)],
    ['scene_rule', DEFAULT_SCENE_RULES as unknown as Rec, sceneRules(g.k)],
    ['lewd_rule', DEFAULT_LEWD_RULES as unknown as Rec, lewdRules(g.k)],
    ['npc_interact_rule', DEFAULT_INTERACT_RULES as unknown as Rec, interactRules(g.k)],
    ['roster_rule', DEFAULT_ROSTER_RULES as unknown as Rec, rosterRules(g.k)],
    ['favor_rule', DEFAULT_FAVOR_RULES as unknown as Rec, favorRules(g.k)],
    ['npc_rule', DEFAULT_NPC_RULES as unknown as Rec, npcRules(g.k)],
    ['npc_life_rule', DEFAULT_LIFE_RULES as unknown as Rec, lifeRules(g.k)],
    ['transit_rule', DEFAULT_TRANSIT_RULES as unknown as Rec, transitRules(g.k)],
    ['ability_rule', DEFAULT_ABILITY_RULES as unknown as Rec, abilityRules(g.k)],
  ]
  for (const [kind, def, resolved] of cases) {
    it(`${kind}：資料的每一格等於預設，功能讀出來的也一樣`, () => {
      // M3 加的內海欄位（fixer_rule 的 trace_start、net_layers、net_branch_skills）由 M3-data-rules.test.ts 對 DEFAULT_FIXER_NET_RULES 驗
      const { trace_start: _t, net_layers: _l, net_branch_skills: _b, ...own } = raw(g, kind)
      // M4-scene-circles 加的多人欄位（cost.move_circle、cost.call、multi_dice_minus、other_circle）資料檔還沒有，等 M4-data-rules 補；功能讀出來的（下一行）照樣等於預設
      let dataDef: Rec = def
      if (kind === 'scene_rule') {
        // M4-scene-solo 加的單人欄位（solo、cost.faster、cost.slower）也一樣
        const { multi_dice_minus: _m, other_circle: _o, solo: _s, ...rest } = def as Rec & { cost: Rec }
        const { move_circle: _mc, call: _c, faster: _f, slower: _sl, ...cost } = (def as Rec & { cost: Rec }).cost
        dataDef = { ...rest, cost }
      }
      if (kind === 'ability_rule') {
        // M4-abilities-m4 加的四個欄位（skill_xp_per_level、skill_free_max、respec_price_per_xp、respec_minutes）資料檔還沒有，等 M4-data-rules 補；功能讀出來的（下一行）照樣等於預設
        const { skill_xp_per_level: _a, skill_free_max: _b, respec_price_per_xp: _c, respec_minutes: _d, ...rest } = def as Rec
        dataDef = rest
      }
      expect(kind === 'fixer_rule' ? own : raw(g, kind)).toEqual(JSON.parse(JSON.stringify(dataDef)))
      expect(JSON.parse(JSON.stringify(resolved))).toEqual(JSON.parse(JSON.stringify(def)))
    })
  }

  it('commission_rule：副本的欄位和生成的三個欄位在同一筆，各自等於兩邊的預設', () => {
    const r = raw(g, 'commission_rule')
    const { reward_range, scales_by_tier, encounters, net_alert: _a, net_alert_at: _b, net_hostility_step: _c, net_hostility_max: _d, net_located_hostility: _e, net_watchers: _f, net_watcher_hostility: _g, rating_trace_peak: _h, ...own } = r // 內海的八個欄位由 M3-data-rules.test.ts 驗
    expect(own).toEqual(JSON.parse(JSON.stringify(DEFAULT_COMMISSION_RULES)))
    expect({ reward_range, scales_by_tier, encounters }).toEqual(JSON.parse(JSON.stringify(DEFAULT_GEN_RULES)))
    expect(JSON.parse(JSON.stringify(commissionRules(g.k)))).toEqual(JSON.parse(JSON.stringify(DEFAULT_COMMISSION_RULES)))
    expect(JSON.parse(JSON.stringify(genRules(g.k)))).toEqual(JSON.parse(JSON.stringify(DEFAULT_GEN_RULES)))
  })
})

describe('M2-data-rules：抽查設計書的數字', () => {
  const g = game()

  it('導演（EVENTS 3.3、3.4、3.5、第 7 節）', () => {
    expect(raw(g, 'event_rule')).toMatchObject({ per_turn: { blocking: 1, notices: 2 }, city_daily_blocking: 8, category_recent: 6, category_penalty: 0.35 })
    const street = g.k.content.get('event_scope', 'street') as Rec
    // 街頭範圍多一個 transit_stop 6%（EVENTS 3.3 節的表；M2 修正批 9：以表為準）
    expect(street).toMatchObject({ triggers: { enter_block: 0.12, walk: 0.06, enter_bridge: 0.25, enter_facility: 0.08, transit_stop: 0.06 }, cooldown_hours: 2, repeat_days: 3, daily_cap: 5, lost: 'drop' })
    expect(g.k.content.get('event_scope', 'site')).toMatchObject({ triggers: { enter_floor: 0.25, open: 0.1, rest: 0.2 }, cooldown_hours: 1, repeat_days: 7 })
    expect(g.k.content.get('event_scope', 'home')).toMatchObject({ triggers: { home: 0.1, rest: 0.2 }, cooldown_hours: 6, repeat_days: 7, daily_cap: 2, lost: 'defer', defer_hours: 6 })
    expect(g.k.content.get('event_scope', 'work')).toMatchObject({ triggers: { work: 0.15 }, repeat_days: 3 })
    expect(g.k.content.get('event_scope', 'mascot')).toMatchObject({ cooldown_hours: 72, daily_cap: 1, flags_at: [3, 6, 10] })
    // 副本內：每個階段 30%、壓力條跨過 60 再擲 15%（事件寫的觸發點還是 stage）；同一件委託不重複（EVENTS 3.1、3.3 節；M2 修正批 4）
    expect(g.k.content.get('event_scope', 'commission')).toMatchObject({ in_commission: true, unique_in_commission: true, triggers: { stage: 0.3, pressure: 0.15 }, events_as: { pressure: 'stage' } })
  })

  it('十種範圍加交通都寫了；導演讀得到（範圍進得了導演的清單）', () => {
    const ids = (scopes as Array<{ id: string }>).map((s) => s.id)
    expect(ids).toEqual(['street', 'transit', 'site', 'net', 'commission', 'contract', 'home', 'adult', 'rogue_ai', 'work', 'mascot'])
    expect(g.k.content.list('event_scope').map((s) => s.id)).toEqual(ids)
  })

  it('敵對值與收買（FACTIONS 5.1、6.1、6.3）', () => {
    expect(raw(g, 'security_rule')).toMatchObject({
      decay_weekly: 5, decay_quiet: 10, bribe_per_point: 50, bribe_step: 20, bribe_max: 20,
      hostility_bands: [0, 20, 40, 60, 80, 100], favor_bands: [0, 20, 40, 60, 80],
    })
  })

  it('掃描強度四級（EQUIPMENT 6.3）', () => {
    expect((scanLevels as Array<{ strength: number }>).map((s) => s.strength)).toEqual([0, 1, 2, 3])
    expect(scanLevels[1]).toMatchObject({ scans: '只掃大小 2 以上的武器' })
    expect(scanLevels[3]).toMatchObject({ scans: '所有武器與義體；橋 ID' })
  })

  it('委託的規模、歷練點與輔助面（COMMISSIONS 2.3、6.2、6.4）', () => {
    expect(raw(g, 'commission_rule')).toMatchObject({
      xp_small: 20, xp_medium: 35, xp_large: 60, stage_minutes: 120, dc_base: 10, dc_per_grade: 2, aux_pressure: 10, aux_rest: 1,
      aux_bonus: { strong: 4, mid: 2, weak: 0, none: 0 },
    })
  })

  it('中間人（FIXER 第 2 節）：付法 1、0.85、0.7；踩點 4 小時、第 4 次起 +1', () => {
    expect(raw(g, 'fixer_rule')).toMatchObject({ pay_cred: 0.85, pay_favor: 0.7, hostility_cred: 2, scout_minutes: 240, scout_hard_from: 4, scout_hard_plus: 1 })
  })

  it('交易（TRADE 3.2、4.1、第 5、9 節）：收購 40%、貨物 90%、十三個貿易類別', () => {
    const t = raw(g, 'trade_rule')
    expect(t).toMatchObject({
      buy_ratio: 0.4, cargo_ratio: 0.9, sell_area_slope: 0.25, discount_cap: 0.3, decay_step: 0.03, decay_max: 0.5, decay_recover: 5,
      market_min: 0.5, market_max: 2.5, bargain_dc: 13, bargain_affinity_step: 25, favor_bands: [20, 40, 60, 80], favor_discounts: [0.03, 0.06, 0.1, 0.15],
      hostility_markups: [[20, 1.1], [40, 1.2]], hostility_refuse_at: 60,
      bargain_results: { critical: { mult: 0.8, affinity: 2 }, success: { mult: 0.9, affinity: 0 }, fail: { mult: 1, affinity: 0 }, fumble: { mult: 1.1, affinity: -3 } },
    })
    expect(Object.keys(t.categories as Rec)).toHaveLength(13)
  })

  it('睡處的回復率六列（DOWNTIME 2.3）：露宿 10%、潛艙 20%、旅館 25%、一級 55%、二三級 60%、病床 60%', () => {
    const r = raw(g, 'rest_rule') as { wild_rate: number; home_rates: Record<string, number> }
    const sleep = (id: string) => (facilityTypes as Array<{ id: string; sleep?: { rate: number; cost: number } }>).find((f) => f.id === id)!.sleep!
    expect([r.wild_rate, sleep('pod_shop').rate, sleep('hotel').rate, r.home_rates['1'], r.home_rates['2'], sleep('clinic').rate]).toEqual([0.1, 0.2, 0.25, 0.55, 0.6, 0.6])
    expect(r.home_rates['3']).toBe(0.6)
    expect(sleep('pod_shop').cost).toBe(10)
    expect(sleep('clinic').cost).toBe(50)
    expect(raw(g, 'rest_rule')).toMatchObject({ sleep_gap_hours: 16, hurt_ratio: 0.5, rent_order: 1 })
  })

  it('帳單（DOWNTIME 5.1、5.2）', () => {
    expect(raw(g, 'bill_rule')).toMatchObject({ debt_week: 3, debt_faction: 'eden', debt_hostility: 10, interest_order: 5, extra_order: 7, grace_max_days: 7 })
  })

  it('打工（DOWNTIME 4.1、4.2）：2、4、8 小時；大成功 1.5、成功 1、失敗 0.5、大失敗 0 與親密度 −3', () => {
    expect(raw(g, 'work_rule')).toMatchObject({ hours: [2, 4, 8], degree_mult: { critical: 1.5, success: 1, fail: 0.5, fumble: 0 }, fumble_affinity: 3 })
  })

  it('成人場景（LEWD_SYSTEM 3.5）：主導 2 點、迎合契合 +8、評價表四段', () => {
    const s = raw(g, 'scene_rule') as { cost: Record<string, number>; dominate: Rec; yield: Rec; bands: Array<{ min: number; insight: number }> }
    expect(s.cost.dominate).toBe(2)
    expect(s.dominate).toMatchObject({ their: 2, fit: 2, init: 10 })
    expect(s.yield).toMatchObject({ fit: 8, init: -10 })
    expect(s.bands.map((b) => [b.min, b.insight])).toEqual([[85, 20], [60, 15], [30, 10], [0, 5]])
    expect(raw(g, 'scene_rule')).toMatchObject({ ap_regen: 3, match_bonus: 12, quit_fit: 10, quit_rounds: 3, first_bonus: 5, skip_mult: 0.7 })
  })

  it('橋參數與傾向（CORE_RULES 4.2、LEWD_SYSTEM 第 1 節）', () => {
    expect(raw(g, 'lewd_rule')).toMatchObject({ tolerance_per_layer: 40, craving_threshold: 60 })
  })

  it('互動（NPC_SYSTEM 6.1～6.4）：聊天 +2 與 +4、送禮分級、威嚇、讀橋', () => {
    expect(raw(g, 'npc_interact_rule')).toMatchObject({
      chat: { critical: 4, success: 2, fumble: -2 }, seduce: { success: 3, fail: -2, fumble: -5 }, ask: { fumble: -3 },
      intimidate: { success: -3, fumble_hostility: 3 }, affinity_step: 20, read: { base: 10, per_tier: 3, reveal: [1, 2] },
      gift: { dc: -2, tiers: [[10, 1], [60, 2], [250, 4], [1000, 6]], liked: 2, offend: -3 },
    })
  })

  it('名冊（NPC_SYSTEM 10.0～10.5、FIXER 第 6 節）：招募 16、出場費 200', () => {
    expect(raw(g, 'roster_rule')).toMatchObject({
      recruit_base: 16, recruit_affinity_step: 10, recruit_per_tier: 2, cap_base: 3, cap_per_face: 2, party_max: 4, tagalong_max: 2,
      loyalty_start: 30, loyalty_rescued: 50, loyalty_introduced: 40, fee_base: 200, fee_spread: 0.25, fee_low_rep: 0.2, fee_low_loyalty: 0.25, leave_at: 20, leave_chance: 0.3,
    })
  })

  it('人情的作價（TRADE 4.4）：小 300、中 1,500', () => {
    expect(raw(g, 'favor_rule')).toMatchObject({ price: { small: 300, mid: 1500 } })
  })

  it('換配置統一半小時（使用者定案 2026-11-23）', () => {
    expect(raw(g, 'ability_rule')).toEqual({ loadout_minutes: 30, loadout_facility_types: ['tuning_clinic'], xp_home_share: 0.3 })
    expect((facilityTypes as Array<{ id: string }>).some((f) => f.id === 'tuning_clinic')).toBe(true)
  })
})

describe('M2-data-rules：商店與設施的種類', () => {
  it('商店的種類：格式合格，店家倍率與脾氣照 TRADE 3.2 節、第 5 節', () => {
    const g = game()
    const row = (id: string) => g.k.content.get('shop_type', id) as Rec
    expect((shopTypes as Array<{ id: string }>).map((s) => s.id)).toEqual(['market_stall', 'maker_direct', 'bone_yard', 'cold_storage'])
    expect(row('market_stall')).toMatchObject({ shop_mult: 0.9, temper: -1, cash: true, grade_max: 1, scan_registered: false })
    expect(row('maker_direct')).toMatchObject({ shop_mult: 1.1, temper: null, cash: false, scan_registered: true, grade_max: 3 })
    expect(row('cold_storage')).toMatchObject({ cash: 'only', temper: 1, grade_max: 4 })
  })

  it('設施的種類：id 不重複、不含斜線、每一種有名字與功能；功能只用 DATA 第 12 節的十一個', () => {
    const g = game()
    const ids = g.k.content.list('facility_type').map((f) => f.id)
    expect(new Set(ids).size).toBe(ids.length)
    const FUNCTIONS = ['buy', 'sell', 'work', 'rest', 'heal', 'modify', 'info', 'job_board', 'train', 'travel', 'dive']
    for (const f of facilityTypes as Array<{ id: string; name: string; functions: string[] }>) {
      expect(f.id).not.toContain('/')
      expect(f.name).toMatch(/\S/)
      for (const fn of f.functions) expect(FUNCTIONS, `${f.id}.${fn}`).toContain(fn)
    }
    expect(ids).toHaveLength(41)
  })
})

describe('M2-data-rules：行動種類', () => {
  const NEW = [
    ['npc_chat', 'npcs'], ['npc_gift', 'npcs'], ['npc_seduce', 'npcs'], ['npc_ask_small', 'npcs'], ['npc_ask_mid', 'npcs'], ['npc_ask_big', 'npcs'],
    ['npc_intimidate', 'npcs'], ['npc_steal', 'npcs'], ['npc_read_bridge', 'npcs'], ['npc_recruit', 'roster'], ['bargain', 'trade'],
  ] as const

  it('新加的十一筆載得進來，而且是「只加」：原本的十九筆原樣在前面', () => {
    const g = game()
    const ids = (actions as Array<{ id: string }>).map((a) => a.id)
    expect(ids).toHaveLength(19 + 11)
    expect(ids.slice(0, 19)).toEqual(['free', 'beg', 'rumor', 'search', 'scavenge', 'tail', 'pickpocket', 'sneak', 'lockpick', 'hack', 'climb', 'escape', 'persuade', 'deceive', 'threaten', 'busk', 'repair', 'first_aid', 'flirt'])
    for (const [id, owner] of NEW) expect(g.k.content.get('action_kind', id), id).toMatchObject({ owner })
  })

  it('寫了 owner 的不會被 features/actions 註冊，而由那個功能註冊成可以做的行動', () => {
    const g = game()
    for (const [id, owner] of NEW) {
      const def = g.k.actions.get(id)
      expect(def, id).toBeTruthy()
      expect(def!.owner, id).toBe(owner)
    }
    // 沒有寫 owner 的照舊由 features/actions 註冊
    expect(g.k.actions.get('persuade')!.owner).not.toBe('npcs')
  })

  it('名字、屬性、基本功、時間照 AI_TASKS 3.1 節與 NPC_SYSTEM 第 6、10.2 節；DC 寫基準的那一檔', () => {
    const row = (id: string) => (actions as Array<Rec & { id: string }>).find((a) => a.id === id)!
    expect(row('npc_chat')).toMatchObject({ attr: 'charm', skill: 'negotiate', dc: 'normal', minutes: 30, max_minutes: 120 })
    expect(row('npc_seduce')).toMatchObject({ attr: 'charm', skill: 'seduce', dc: 'normal' })
    expect([row('npc_ask_small').dc, row('npc_ask_mid').dc, row('npc_ask_big').dc]).toEqual(['normal', 'hard', 'extreme'])
    expect(row('npc_intimidate')).toMatchObject({ attr: 'resolve', skill: 'intimidate', minutes: 15, max_minutes: 60 })
    expect(row('npc_steal')).toMatchObject({ attr: 'reflex', skill: 'stealth' })
    expect(row('npc_read_bridge')).toMatchObject({ attr: 'intellect', skill: 'interface', dc: 'easy' })
    expect(row('npc_recruit')).toMatchObject({ attr: 'charm', skill: 'negotiate', dc: 'hard' })
    expect(row('bargain')).toMatchObject({ minutes: 15, max_minutes: 60, owner: 'trade' })
  })
})

describe('M2-data-rules：補（M2-abilities-m2 的回報）', () => {
  const ab = (id: string) => (abilities as Array<Rec & { id: string }>).find((a) => a.id === id)!

  it('ability_rule 有一筆 default', () => {
    expect(game().k.content.get('ability_rule', 'default')).toBeTruthy()
  })

  it('sk_fixer_reinforce：meat 改成選候補加 call_in，拿掉 pending', () => {
    const m = ab('sk_fixer_reinforce').meat as Rec
    expect(m.pending).toBeUndefined()
    expect(m.picks).toEqual([expect.objectContaining({ kind: 'bench' })])
    expect(m.do).toEqual([{ op: 'call_in' }])
    expect(ab('sk_fixer_reinforce').net).toMatchObject({ pending: true })
  })

  it('sk_fixer_intel_net：每件委託 1 次；預備多一個 scout_reveal', () => {
    expect(ab('sk_fixer_intel_net').use).toEqual({ per_commission: 1 })
    expect((ab('sk_fixer_intel_net').prep as Rec).effects).toEqual([{ kind: 'scout_reveal', job: '$commission' }])
  })
})
