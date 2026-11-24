// 驗收測試：dev/work/M3-data-rules.md（cpp-data）。M3 的規則表（只有數字與種類表，不含內容）。
// 規格：每一張表的出處見 data/index.ts 的 SOURCES；暫定的格子見 PROVISIONAL_M3。
// 資料與功能的預設要一致：每一張表逐格和功能（或核心）匯出的 DEFAULT_… 比（設計書與預設對不上的地方記在回報，不在這裡自己挑一邊）。

import { describe, expect, it } from 'vitest'
import { DEFAULT_MODES, DEFAULT_STATUSES, DEFAULT_SYNC_RULE, Game, modeOf, statusRuleOf, syncRuleOf } from '../../src'
import { allFeatures } from '../../src/features'
import { CORE_PACK, PROVISIONAL_M3, SOURCES } from '../../data'
import { DEFAULT_NET_RULES, netRules } from '../../src/features/commission/model'
import { DEFAULT_FIXER_NET_RULES, fixerNetRules } from '../../src/features/fixer/model'
import { DEFAULT_DECK_RULES, deckRules } from '../../src/features/deck/model'
import { DEFAULT_NETCOMBAT_RULES, netcombatRules } from '../../src/features/netcombat/model'
import { DEFAULT_REGIONS, DEFAULT_RULES as DEFAULT_NETRUN_RULES } from '../../src/features/netrun/model'
import { netrunRules, regionOf } from '../../src/features/netrun/rules'
import { DEFAULT_REGION, DEFAULT_RULES as DEFAULT_MAZE_RULES, mazeRegion, mazeRules, tableOf } from '../../src/features/maze/model'
import eventScopes from '../../data/rules/event_scopes.json'
import statuses from '../../data/rules/battle_statuses.json'

const game = () => new Game({ features: allFeatures(), content: [CORE_PACK] })
type Rec = Record<string, unknown>
const plain = <T>(v: T): unknown => JSON.parse(JSON.stringify(v))
const raw = (g: Game, kind: string, id = 'default'): Rec => {
  const { id: _id, ...rest } = g.k.content.get(kind, id) as Rec
  return rest
}

const NEW_KINDS = ['sync_rule', 'deck_rule', 'netcombat_rule', 'netrun_rule', 'net_region', 'net_facility', 'net_enemy_rule', 'maze_rule', 'maze_table']

describe('M3-data-rules：載入與引用', () => {
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

  it('id: default 的規則表只有那一筆；net_region 有四筆；設施類型六種', () => {
    const g = game()
    for (const kind of ['sync_rule', 'deck_rule', 'netcombat_rule', 'netrun_rule', 'net_enemy_rule', 'maze_rule']) expect(g.k.content.list(kind).map((e) => e.id), kind).toEqual(['default'])
    expect(g.k.content.list('net_region').map((e) => e.id)).toEqual(['subnet', 'maze', 'wreck', 'deep'])
    expect(g.k.content.list('net_facility')).toHaveLength(6)
  })

  it('暫定的格子列出來了，而且都是那張表真的有的欄位', () => {
    const g = game()
    for (const kind of ['sync_rule', 'deck_rule', 'netcombat_rule', 'netrun_rule', 'maze_rule', 'commission_rule', 'fixer_rule']) {
      const row = raw(g, kind)
      for (const f of PROVISIONAL_M3[kind]!) expect(Object.keys(row), `${kind}.${f}`).toContain(f.split('.')[0]!)
    }
    for (const key of ['net_region/subnet', 'net_region/maze', 'net_region/wreck', 'net_region/deep']) expect(g.k.content.has('net_region', key.split('/')[1]!), key).toBe(true)
    for (const id of PROVISIONAL_M3.battle_status!) expect(g.k.content.has('battle_status', id), id).toBe(true)
    for (const id of PROVISIONAL_M3.maze_table!) expect(g.k.content.has('maze_table', id), id).toBe(true)
  })
})

describe('M3-data-rules：戰場與狀態（和核心的預設逐欄相同）', () => {
  const g = game()

  it('battle_mode：net 一筆，讀出來等於核心的預設（含 attr_as、guard_stat、leave）；meat 補了 guard_stat', () => {
    expect(g.k.content.list('battle_mode').map((e) => e.id)).toEqual(['meat', 'net'])
    expect(plain(modeOf(g.k.content, 'net'))).toEqual(plain(DEFAULT_MODES.net))
    expect(plain(modeOf(g.k.content, 'meat'))).toEqual(plain(DEFAULT_MODES.meat))
    expect(raw(g, 'battle_mode', 'net')).toMatchObject({
      layer: 'net', tracks: ['load'], overload: 'flash', flash_pool: 'ram', armor_on_load: true, attr_as: { body: 'resolve' }, guard_stat: 'net_guard', leave: { out: 'jacked_out', outcome: 'jack_out' },
    })
    expect(raw(g, 'battle_mode', 'meat')).toMatchObject({ guard_stat: 'armor' })
  })

  it('battle_status：flash 和核心內建的一致；干擾三類各一回合、own_turn_end、debuff', () => {
    expect(plain(statusRuleOf(g.k.content, 'flash'))).toEqual(plain(DEFAULT_STATUSES.flash))
    for (const id of ['jam_weapon', 'jam_defense', 'jam_tool']) {
      expect(raw(g, 'battle_status', id), id).toMatchObject({ until: 'own_turn_end', turns: 1, kind: 'debuff' })
    }
  })

  it('battle_status：focused（命中 +1、到給的人下回合開始）、pacified、drowsy（下回合行動點 −1、一次）', () => {
    expect(raw(g, 'battle_status', 'focused')).toMatchObject({ mods: { hit_against: 1 }, until: 'source_turn_start', turns: 1, kind: 'mark' })
    expect(raw(g, 'battle_status', 'pacified')).toMatchObject({ until: 'own_turn_end', turns: 1, kind: 'debuff' })
    expect(raw(g, 'battle_status', 'drowsy')).toMatchObject({ turn_start: { ap: -1 }, once: true, kind: 'debuff' })
  })

  it('舊的狀態沒動，新的九個以外沒有多的', () => {
    const ids = (statuses as Array<{ id: string }>).map((s) => s.id)
    expect(ids.slice(-7)).toEqual(['flash', 'jam_weapon', 'jam_defense', 'jam_tool', 'focused', 'pacified', 'drowsy'])
    expect(ids).toHaveLength(29)
  })

  it('event_scope：net 加登入與登出各 0.1（EVENTS 3.3），原本的 enter_floor 0.2、open 0.1 不動', () => {
    const net = (eventScopes as Array<{ id: string; triggers: Record<string, number> }>).find((s) => s.id === 'net')!
    expect(net.triggers).toEqual({ enter_floor: 0.2, open: 0.1, login: 0.1, logout: 0.1 })
    expect(g.k.content.get('event_scope', 'net')).toMatchObject({ cooldown_hours: 1, repeat_days: 3 })
  })
})

describe('M3-data-rules：資料和功能的預設一致（逐格）', () => {
  const g = game()

  it('sync_rule：讀出來等於核心的預設；資料四檔都寫了', () => {
    expect(plain(syncRuleOf(g.k.content))).toEqual(plain(DEFAULT_SYNC_RULE))
    const gears = raw(g, 'sync_rule').gears as Record<string, Rec>
    expect(Object.keys(gears)).toEqual(['shallow', 'standard', 'deep', 'full'])
    for (const [gear, d] of Object.entries(DEFAULT_SYNC_RULE.gears)) {
      expect(gears[gear], gear).toEqual({
        name: d.name, check: d.check, load_pct: d.loadPct, need_skill: d.needSkill, need_sensitivity: d.needSensitivity,
        ...(d.apRegen ? { ap_regen: d.apRegen } : {}), ...(d.sinkOnOverload ? { sink_on_overload: d.sinkOnOverload } : {}),
      })
    }
    expect(raw(g, 'sync_rule')).toMatchObject({ skill: DEFAULT_SYNC_RULE.skill, sink_bonus_at: DEFAULT_SYNC_RULE.sinkBonusAt })
  })

  it('deck_rule、netcombat_rule、netrun_rule、maze_rule：資料的每一格等於預設，功能讀出來的也一樣', () => {
    const cases: Array<[string, unknown, unknown]> = [
      ['deck_rule', DEFAULT_DECK_RULES, deckRules(g.k)],
      ['netcombat_rule', DEFAULT_NETCOMBAT_RULES, netcombatRules(g.k)],
      ['netrun_rule', DEFAULT_NETRUN_RULES, netrunRules(g.k)],
      ['maze_rule', DEFAULT_MAZE_RULES, mazeRules(g.k)],
    ]
    for (const [kind, def, resolved] of cases) {
      expect(raw(g, kind), kind).toEqual(plain(def))
      expect(plain(resolved), kind).toEqual(plain(def))
    }
  })

  it('net_region：subnet 與 maze 等於功能的預設，讀出來的也一樣', () => {
    expect(raw(g, 'net_region', 'subnet')).toEqual({ ...plain(DEFAULT_REGIONS.subnet), id: undefined, name: '一般子網' })
    expect(raw(g, 'net_region', 'maze')).toEqual((() => { const { id: _id, ...rest } = DEFAULT_REGION; return plain(rest) })())
    expect(plain((regionOf(g.k, 'subnet') as { region: unknown }).region)).toEqual(plain(DEFAULT_REGIONS.subnet))
    const maze = (regionOf(g.k, 'maze') as { region: Rec }).region
    expect(maze).toMatchObject({ map_kind: 'maze', size: [9, 7], carve: [18, 24], pressure: 'none', safe: true })
    expect(plain(mazeRegion(mazeRules(g.k)))).toMatchObject({ size: [9, 7], carve: [18, 24] })
  })

  it('net_region：wreck 與 deep 只照設計書的密度與壓力條寫（格式過得了檢查）', () => {
    for (const id of ['wreck', 'deep']) expect('region' in (regionOf(g.k, id) as object), id).toBe(true)
    expect(raw(g, 'net_region', 'wreck')).toMatchObject({ size: [11, 9], carve: [30, 40], pressure: 'trace', layer: { foe: [2, 4], patrol: [0, 1], archive: [2, 3], trap: [1, 2], rest: [1, 1] } })
    expect(raw(g, 'net_region', 'deep')).toMatchObject({ size: [11, 9], carve: [24, 34], pressure: 'none', layer: { foe: [2, 3], patrol: [1, 1], archive: [1, 2] } })
  })

  it('commission_rule：內海的八個欄位等於 DEFAULT_NET_RULES；讀出來的也一樣', () => {
    const r = raw(g, 'commission_rule')
    const net = Object.fromEntries(Object.keys(DEFAULT_NET_RULES).map((k) => [k, r[k]]))
    expect(net).toEqual(plain(DEFAULT_NET_RULES))
    expect(plain(netRules(g.k))).toEqual(plain(DEFAULT_NET_RULES))
  })

  it('fixer_rule：trace_start、net_layers、net_branch_skills 等於 DEFAULT_FIXER_NET_RULES；讀出來的也一樣', () => {
    const r = raw(g, 'fixer_rule')
    expect({ trace_start: r.trace_start, net_layers: r.net_layers, net_branch_skills: r.net_branch_skills }).toEqual(plain(DEFAULT_FIXER_NET_RULES))
    expect(plain(fixerNetRules(g.k))).toEqual(plain(DEFAULT_FIXER_NET_RULES))
  })

  it('maze_table：寶箱表與獎品表各一張，maze 讀得到', () => {
    const rules = mazeRules(g.k)
    expect(tableOf(g.k, 'chest', rules)?.id).toBe('mzt_chest')
    expect(tableOf(g.k, 'prize', rules)?.id).toBe('mzt_prize')
  })
})

describe('M3-data-rules：兩邊各有一份的數字相同', () => {
  const g = game()
  it('netcombat_rule 與 netrun_rule 的三個門檻 30、60、90 與定位的回合數 3', () => {
    const c = raw(g, 'netcombat_rule').trace as Rec
    const n = raw(g, 'netrun_rule')
    expect([c.t1, c.t2, c.t3, c.locate_rounds]).toEqual([30, 60, 90, 3])
    expect([n.t1, n.t2, n.t3, n.locate_rounds]).toEqual([30, 60, 90, 3])
  })
  it('管理行動與下載的追蹤度兩邊相同（1、失敗 5）', () => {
    const a = raw(g, 'netcombat_rule').admin as Rec
    const n = raw(g, 'netrun_rule')
    expect([a.trace, a.fail_trace]).toEqual([n.admin_trace, n.fail_trace])
  })
})

describe('M3-data-rules：抽查設計書的數字', () => {
  const g = game()

  it('同步四檔（CYBERSPACE 6.4）：−2／×0.5、0／×1、+2／×1.5、+4／×2.5；全檔多 1 點行動點、過載沉溺 +2', () => {
    const gears = raw(g, 'sync_rule').gears as Record<string, Rec>
    expect([gears.shallow, gears.standard, gears.deep, gears.full].map((x) => [x!.check, x!.load_pct])).toEqual([[-2, 50], [0, 100], [2, 150], [4, 250]])
    expect(gears.full).toMatchObject({ ap_regen: 1, sink_on_overload: 2, need_skill: 5 })
    expect(gears.deep).toMatchObject({ need_skill: 3 })
  })

  it('回填 +2（6.3）；戰鬥每回合追蹤度 +3、管理行動 +1、失敗 +5、白蕾絲 +5（6.8）', () => {
    const r = raw(g, 'netcombat_rule')
    expect(r.refill).toBe(2)
    expect(r.trace).toMatchObject({ round: 3, white: 5 })
    expect(r.admin).toMatchObject({ trace: 1, fail_trace: 5 })
  })

  it('子網（8.1、8.3）：警報節點 +10、下載每回合 +2；一般子網 11 × 9、carve 30～40、遭遇 2～3；迷宮館 9 × 7、18～24', () => {
    expect(raw(g, 'netrun_rule')).toMatchObject({ download_trace: 2 })
    const subnet = raw(g, 'net_region', 'subnet')
    expect(subnet).toMatchObject({ size: [11, 9], carve: [30, 40], layer: { foe: [2, 3] } })
    expect(raw(g, 'net_region', 'maze')).toMatchObject({ size: [9, 7], carve: [18, 24] })
    expect((DEFAULT_REGIONS.subnet!.trap ?? { alarm: 10 }).alarm).toBe(10)
  })

  it('DC 照等級 10、13、16、19、22（四個區都一樣）', () => {
    for (const id of ['subnet', 'maze', 'wreck', 'deep']) expect(raw(g, 'net_region', id).dc, id).toEqual([10, 13, 16, 19, 22])
  })

  it('六種設施類型的層（8.3 設施類型 d6 表）；機房 III 級以上可能有隔離區', () => {
    const f = (id: string) => g.k.content.get('net_facility', id) as Rec
    expect(g.k.content.list('net_facility').map((e) => [e.id, (e as unknown as Rec).layers])).toEqual([
      ['nf_1_office', ['staff', 'control', 'core']],
      ['nf_2_depot', ['staff', 'core']],
      ['nf_3_lab', ['guest', 'staff', 'control', 'core']],
      ['nf_4_server', ['staff', 'control', 'core']],
      ['nf_5_venue', ['guest', 'core']],
      ['nf_6_residence', ['staff', 'core']],
    ])
    expect(f('nf_4_server').airgap_at).toBe(3)
    expect(g.k.content.list('net_facility').filter((e) => (e as unknown as Rec).airgap_at !== undefined)).toHaveLength(1)
  })

  it('構裝等級（ITEMS 11.1）：III 級多 1 顆骰、II 級命中 +1、IV 級 +2 與多 2 顆；腳本「甲板等級 ＋1」支（5.2）', () => {
    const d = raw(g, 'deck_rule')
    const gb = d.grade_bonus as Record<string, Rec>
    expect(gb['2']).toEqual({ hit: 1, dice: 0 })
    expect(gb['3']).toEqual({ hit: 1, dice: 1 })
    expect(gb['4']).toEqual({ hit: 2, dice: 2 })
    expect(d.script_extra).toBe(1)
  })

  it('迷宮館（8.2）：三層標準回合數 12、15、10；評價 1.5、1.2、1、0.7；押金 50、150、500、1,600；一枚籌碼 C$10', () => {
    const m = raw(g, 'maze_rule') as { layers: Array<{ standard: number }>; rating: Array<{ mult: number }>; brackets: Record<string, { grades: Array<{ deposit: number; prize: number }> }>; chip: number }
    expect(m.layers.map((l) => l.standard)).toEqual([12, 15, 10])
    expect(m.rating.map((x) => x.mult)).toEqual([1.5, 1.2, 1, 0.7])
    expect([m.brackets.rookie!.grades[0]!.deposit, m.brackets.open!.grades[0]!.deposit, m.brackets.unlimited!.grades[0]!.deposit, m.brackets.unlimited!.grades[1]!.deposit]).toEqual([50, 150, 500, 1600])
    expect(m.brackets.unlimited!.grades.map((x) => x.prize)).toEqual([3000, 9800])
    expect(m.chip).toBe(10)
  })

  it('追蹤度的起始與撤走（NETRUNNING 第 5 節）：記名 15、通緝 30', () => {
    expect(raw(g, 'fixer_rule').trace_start).toMatchObject({ noted: 15, wanted: 30 })
  })
})
