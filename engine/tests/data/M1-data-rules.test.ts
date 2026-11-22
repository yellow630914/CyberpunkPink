// 驗收測試：dev/work/M1-data-rules.md（cpp-data）。工單做完之前照預期失敗（CORE_PACK 還沒有這幾種資料）。
// 規格：COMBAT_SYSTEM 第 1～7 節；ITEMS 5.1、5.2 節；DATA 9.3 節；COMMISSION_MAPS 第 1、2、8 節；SITES 12.1 節。

import { describe, expect, it } from 'vitest'
import type { BattleStatusEntry, ItemEntry, SpecialMapEntry, WeaponClassEntry } from '../../src'
import { DEFAULT_DAMAGE_TYPES, DEFAULT_MODES, Game, Sheet, damageTypeOf, markersInLayout, modeOf, statusRuleOf, weaponFromClass } from '../../src'
import { allFeatures } from '../../src/features'
import { CORE_PACK, SOURCES } from '../../data'

// 整包內容含功能自己註冊的種類（敵人、遭遇、戰敗事件），要裝上功能才載得進去（M1-data-enemies）
const kernel = () => new Game({ features: allFeatures(), content: [CORE_PACK] }).k

describe('M1-data-rules：戰鬥的規則數值', () => {
  it('整包載得進去，引用都找得到；每一種資料寫了出處', () => {
    const k = kernel()
    expect(k.content.checkRefs()).toEqual([])
    for (const kind of ['battle_mode', 'damage_type', 'battle_status', 'weapon_class', 'item', 'special_map']) {
      expect(k.content.list(kind).length, kind).toBeGreaterThan(0)
      expect(SOURCES[kind], kind).toBeTruthy()
    }
    expect(() => new Game({ features: allFeatures(), content: [CORE_PACK] })).not.toThrow()
  })

  it('戰場 meat（現實）：數字逐項照 COMBAT_SYSTEM；資料寫的和核心的預設一樣（預設就是照設計書寫的）', () => {
    const k = kernel()
    expect(k.content.list('battle_mode').map((e) => e.id)).toEqual(['meat'])
    const m = modeOf(k.content, 'meat')!
    expect(m).toEqual(DEFAULT_MODES.meat)
    // 資料裡要逐項寫出來（不是靠預設值補）：這份資料是 COMBAT_SYSTEM 的數字在引擎裡的那一份
    const raw = k.content.get('battle_mode', 'meat')!
    expect(raw).toMatchObject({
      name: '現實', layer: 'meat', tracks: ['hp', 'load'], overload: 'lose_turn', afterglow: { roll: -1, load_dealt_pct: 10 }, armor_on_load: false,
      cover_names: ['暴露', '半掩體', '掩體'], cover_word: '遮蔽',
      numbers: {
        apRegen: 3, apAmbushed: -2, aiMaxSteps: 6, evadeBase: 10, critMargin: 5, rangeStep: -2, longAtFront: -4, aimedHit: 3,
        coverBonus: [0, 2, 4], coverHp: { half: [15, 15, 20, 25, 30], full: [30, 30, 40, 50, 60] }, emptyCoverMult: 2, aimCover: { mult: 2, min: 1 },
        darkEvade: 2, decayBase: 2, pierceOverflow: false, rankDamage: { minion: 0.4, elite: 0.6, boss: 1 },
        subdueDc: { base: 10, perGrade: 2, elite: 2, boss: 4 }, fleeDc: { base: 10, perGrade: 2 },
      },
    })
  })

  it('五種傷害類型（COMBAT_SYSTEM 第 5 節的表）', () => {
    const k = kernel()
    expect(k.content.list('damage_type').map((e) => e.id).sort()).toEqual(['em', 'neural', 'physical', 'pleasure', 'thermal'])
    for (const id of ['physical', 'thermal', 'em', 'neural', 'pleasure'] as const) expect(damageTypeOf(k.content, id)).toEqual(DEFAULT_DAMAGE_TYPES[id])
    expect(k.content.get('damage_type', 'thermal')).toMatchObject({ name: '熱能', track: 'hp', armor: 0.5, on_hit: [{ status: 'burning', turns: 2 }] })
    expect(k.content.get('damage_type', 'em')).toMatchObject({ name: '電磁', track: 'hp', armor: 0, vs: { machine: 2 }, on_hit: [{ status: 'jammed', turns: 1 }] })
    expect(k.content.get('damage_type', 'pleasure')).toMatchObject({ name: '快感', track: 'load', needs_bridge: true, sink: 1 })
  })

  it('武器的類型（COMBAT_SYSTEM 第 5 節的表）：十種，骰、適用距離、彈匣、遮蔽倍率、特性逐項照表', () => {
    const k = kernel()
    const rows = Object.fromEntries(k.content.list<WeaponClassEntry>('weapon_class').map((e) => [e.id, e]))
    expect(Object.keys(rows).sort()).toEqual(['heavy', 'lmg', 'melee', 'neural_gun', 'neural_melee', 'pistol', 'rifle', 'shotgun', 'smg', 'sniper'])
    const row = (id: string) => { const { id: _id, name: _n, ...rest } = rows[id]!; return rest }
    expect(row('melee')).toEqual({ dice: 3, type: 'physical', range: [1, 1], cover_mult: 0, pierce: 0, traits: ['melee', 'silent'], attr: 'body', skill: 'brawl' })
    expect(row('shotgun')).toEqual({ dice: 5, far: { beyond: 2, dice: 3 }, type: 'physical', range: [1, 3], mag: 2, cover_mult: 1.5, pierce: 0, traits: ['push'], attr: 'reflex', skill: 'firearms' })
    expect(row('pistol')).toEqual({ dice: 3, type: 'physical', range: [1, 4], mag: 2, cover_mult: 0.25, pierce: 0, traits: ['concealable'], attr: 'reflex', skill: 'firearms' })
    expect(row('smg')).toEqual({ dice: 3, type: 'physical', range: [2, 5], mag: 3, cover_mult: 0.5, pierce: 0, traits: [], attr: 'reflex', skill: 'firearms' })
    expect(row('rifle')).toEqual({ dice: 4, type: 'physical', range: [3, 7], mag: 3, cover_mult: 0.5, pierce: 2, traits: ['long'], attr: 'reflex', skill: 'firearms' })
    expect(row('sniper')).toEqual({ dice: 6, type: 'physical', range: [5, 7], mag: 1, cover_mult: 0.25, pierce: 4, traits: ['long', 'aimed'], attr: 'reflex', skill: 'firearms', ap: 3 })
    expect(row('lmg')).toEqual({ dice: 4, type: 'physical', range: [3, 6], mag: 4, cover_mult: 1, pierce: 0, traits: ['sweep', 'heavy'], attr: 'body', skill: 'heavy' })
    expect(row('heavy')).toEqual({ dice: 7, type: 'physical', range: [3, 7], mag: 1, cover_mult: 2, pierce: 0, traits: ['blast', 'heavy'], attr: 'body', skill: 'heavy' })
    expect(row('neural_gun')).toEqual({ dice: 3, type: 'neural', range: [2, 5], mag: 2, cover_mult: 0, pierce: 0, traits: [], attr: 'reflex', skill: 'firearms' })
    expect(row('neural_melee')).toEqual({ dice: 2, type: 'neural', range: [1, 2], cover_mult: 0, pierce: 0, traits: [], attr: 'body', skill: 'brawl' })
    expect(rows.pistol!.name).toBe('手槍')
    // 組得出戰鬥裡的武器
    expect(weaponFromClass(k.content, 'rifle', { hit: 4 })).toMatchObject({ class: 'rifle', dice: 4, mag: { now: 3, max: 3 }, coverMult: 0.5, pierce: 2 })
  })

  it('戰鬥中的狀態：壓制、暈眩、流血、燃燒、標記、失效、肢體受創、被壓住、失去回合', () => {
    const k = kernel()
    const s = (id: string) => k.content.get<BattleStatusEntry>('battle_status', id)!
    expect(k.content.list('battle_status').map((e) => e.id)).toEqual(expect.arrayContaining(['bleeding', 'burning', 'dazed', 'jammed', 'limb_hurt', 'lose_turn', 'marked', 'pinned_down', 'suppressed'])) // M1b-data-rules 之後多了義體失效等十二個，見 M1b-data-rules.test.ts
    // 壓制：到他下一回合結束前不能換位，攻擊 −2（COMBAT_SYSTEM 第 5 節）
    expect(s('suppressed')).toMatchObject({ name: '壓制', mods: { hit: -2 }, no_move: true, until: 'own_turn_end', kind: 'debuff' })
    // 重創的輕的那一級（第 6 節）：頭是暈眩（下回合行動點 −2）、軀幹是流血（每回合 −2，急救可停）、肢體是相關檢定 −2 到戰鬥結束
    expect(s('dazed')).toMatchObject({ name: '暈眩', turn_start: { ap: -2 }, once: true, kind: 'wound' })
    expect(s('bleeding')).toMatchObject({ name: '流血', turn_start: { hp: -2 }, until: 'battle_end', kind: 'wound', cleansed_by: expect.arrayContaining(['first_aid']) })
    expect(s('limb_hurt')).toMatchObject({ mods: { hit: -2 }, until: 'battle_end', kind: 'wound' })
    // 熱能：之後兩回合各 1d6；電磁：失效一回合
    expect(s('burning')).toMatchObject({ name: '燃燒', turn_start: { hp_dice: 1 }, until: 'own_turn_start', turns: 2 })
    expect(s('jammed')).toMatchObject({ until: 'own_turn_end', turns: 1 })
    // 標記：到標記的人的下一回合開始前，全隊打他命中 +2
    expect(s('marked')).toMatchObject({ name: '標記', mods: { hit_against: 2 }, until: 'source_turn_start', kind: 'mark' })
    // EVENTS 2.4.1 節的「被壓住」：第一回合行動點 −1
    expect(s('pinned_down')).toMatchObject({ turn_start: { ap: -1 }, once: true })
    expect(statusRuleOf(k.content, 'lose_turn')).toMatchObject({ loseTurn: true, until: 'own_turn_start', turns: 1, kind: 'control' })
    for (const e of k.content.list<BattleStatusEntry>('battle_status')) expect(e.desc.length, e.id).toBeGreaterThan(5)
  })

  it('戰鬥中用得到的道具（ITEMS 5.2 節）：束帶、鎖橋器、急救凝膠、冷卻劑、止血針、醒腦針、煙霧彈', () => {
    const k = kernel()
    const it = (id: string) => k.content.get<ItemEntry>('item', id)!
    expect(it('it_zip_tie')).toMatchObject({ name: '束帶', category: 'consumable', grade: 1, legal: 'free', price: 10, tags: expect.arrayContaining(['restraint']) })
    expect(it('it_bridge_lock')).toMatchObject({ name: '鎖橋器', grade: 2, legal: 'register', price: 260, consumable: false, tags: expect.arrayContaining(['restraint']) })
    // 急救凝膠 I～IV：回 8／12／16／24，止血；自己用 1 點、替相鄰的隊友用 2 點
    expect([1, 2, 3, 4].map((g) => it(`it_medgel_${g}`).use)).toEqual([8, 12, 16, 24].map((hp) => ({ ap: 1, ap_other: 2, target: 'ally', modes: ['meat'], effects: [{ op: 'heal', amount: hp }, { op: 'cleanse', by: 'first_aid' }] })))
    expect([1, 2, 3, 4].map((g) => it(`it_medgel_${g}`).price)).toEqual([40, 140, 430, 1620])
    // 冷卻劑 I～III：消一層餘韻、排 4／8／12；IV 消兩層、排 12
    expect([1, 2, 3, 4].map((g) => it(`it_coolant_${g}`).use!.effects)).toEqual([
      [{ op: 'afterglow', layers: -1 }, { op: 'vent', amount: 4 }], [{ op: 'afterglow', layers: -1 }, { op: 'vent', amount: 8 }],
      [{ op: 'afterglow', layers: -1 }, { op: 'vent', amount: 12 }], [{ op: 'afterglow', layers: -2 }, { op: 'vent', amount: 12 }],
    ])
    expect(it('it_stop_bleed').use!.effects).toEqual([{ op: 'cleanse', status: 'bleeding' }])
    expect(it('it_wake_up').use!.effects).toEqual([{ op: 'cleanse', status: 'dazed' }])
    // 煙霧彈 I、II：一格兩回合、三回合（III 是兩格，先不收）
    expect([1, 2].map((g) => it(`it_smoke_${g}`).use)).toEqual([2, 3].map((rounds) => ({ ap: 1, target: 'slot', modes: ['meat'], effects: [{ op: 'soft_cover', kind: 'smoke', rounds }] })))
    for (const e of k.content.list<ItemEntry>('item')) expect(e.desc.length, e.id).toBeGreaterThan(5)
  })
})

describe('M1-data-rules：兩張地圖（先證明版面讀得進來；其餘的在 M2）', () => {
  const maps = () => kernel().content.list<SpecialMapEntry>('special_map')
  const count = (m: SpecialMapEntry, mark: string) => m.sheets.reduce((n, s) => n + markersInLayout(s).filter((x) => x.mark === mark).length, 0)

  it('小辦公室（單張 9×9）與俱樂部（串兩張 13×9）：版面和設計書一字不差', () => {
    const [office, club] = [maps().find((m) => m.id === 'map_office_small')!, maps().find((m) => m.id === 'map_club')!]
    expect(maps().map((m) => m.id).sort()).toEqual(['map_club', 'map_office_small'])
    expect(office).toMatchObject({ kind: 'office_small', size: [9, 9], max_maps: 1 })
    expect(office.sheets).toHaveLength(1)
    expect(office.sheets[0]!.layout).toEqual(['####=E###', '#TOT#.OS#', '#.2.%G1.#', '#DC.#o.o#', '######+##', '#T&.#.GS#', 'E...%.O.#', '#X..#C.K#', '######E##'])
    expect(office.sheets[0]!.spots).toEqual([{ id: '!1', at: [6, 2], cover: 'dense' }, { id: '!2', at: [2, 2], cover: 'one_sided' }])
    expect(club).toMatchObject({ kind: 'club', size: [13, 9], max_maps: 2 })
    expect(club.sheets).toHaveLength(2)
    for (const s of club.sheets) {
      expect(s.size).toEqual([13, 9])
      expect(s.links!.length).toBeGreaterThan(0)
    }
    // 兩張互相接得上：從一張的連接格走過去，站得上另一張
    const [a, b] = club.sheets
    expect(a!.links!.some((l) => l.to === b!.id)).toBe(true)
    expect(b!.links!.some((l) => l.to === a!.id)).toBe(true)
  })

  it('標記的數量到 SITES 12.1 節的下限（E T D C G K X 以一個模板算；遭遇點每一張至少 2）；每個標記有名字', () => {
    expect(maps()).toHaveLength(2)
    for (const m of maps()) {
      expect(count(m, 'E'), `${m.id} E`).toBeGreaterThanOrEqual(2)
      expect(count(m, 'T'), `${m.id} T`).toBeGreaterThanOrEqual(1)
      expect(count(m, 'D'), `${m.id} D`).toBeGreaterThanOrEqual(1)
      expect(count(m, 'C'), `${m.id} C`).toBeGreaterThanOrEqual(2)
      expect(count(m, 'G'), `${m.id} G`).toBeGreaterThanOrEqual(2)
      expect(count(m, 'K'), `${m.id} K`).toBeGreaterThanOrEqual(1)
      expect(count(m, 'X'), `${m.id} X`).toBeGreaterThanOrEqual(1)
      for (const s of m.sheets) {
        expect((s.spots ?? []).length, `${m.id}/${s.id}`).toBeGreaterThanOrEqual(2)
        expect(markersInLayout(s).filter((x) => x.mark === 'T').length).toBeLessThanOrEqual(3)
        for (const c of s.cells ?? []) expect(c.name.trim().length, `${m.id}/${s.id}/${c.id}`).toBeGreaterThan(0)
        for (const c of s.controls ?? []) expect(c.node.startsWith('cn_'), c.node).toBe(true)
        // 區塊圖和版面一樣大；每個入口都站得上去
        const sheet = new Sheet(s)
        for (const e of (s.cells ?? []).filter((c) => c.mark === 'E')) expect(sheet.walkable(e.at[0], e.at[1])).toBe(true)
      }
    }
  })

  it('走得進去：開一份實例、站在第一個入口、看得到周圍', () => {
    const game = new Game({ features: allFeatures(), content: [CORE_PACK], strict: true })
    game.newGame({ seed: 1 })
    for (const id of ['map_office_small', 'map_club']) {
      const inst = game.enterMap(id)
      expect(game.gridView()).toMatchObject({ map: inst, here: { marker: { mark: 'E' } } })
    }
  })
})
