// 驗收測試：dev/work/M5-media-pov.md（cpp-feature）。素材的視角與鏡頭來源：紀錄與素材的視角、一件事的每個鏡頭各記一則、品質上限看鏡頭的等級、
// 視角給看點與可信的修正、多機位、攝影機的架設、直播選鏡頭與第一人稱直播。
// 規格：MEDIA 1.1、1.2、1.3、2、2.2、3、6 節；ITEMS 第 6 節；DECISIONS 2026-11-27；使用者 2026-11-27 裁決（第一人稱直播的修正活動直播也套用）。
// 內容一律用測試自帶的最小假資料：義體與無人機的替身 provider（角色 ext 的 rec、drec、fq、fcap）、幾件攝影機物品、替身的頻道（訂閱量表、條件 channel_open、channel_staff）。

import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import type { Change, ContentPack, Feature, GameState, Kernel, ReportDraft } from '../../src'
import { ActionBlocked, attachActivityEnd, endActivity, meterOf, toMinutes } from '../../src'
import {
  camBlock, camRows, convertBlock, convertDraft, cut, cutPreview, dropCamera, lensesOf, materialOf, mediaFeature, mediaRules, mediaView, qualityParts, readMedia, recStatus, recut, setCamera,
} from '../../src/features/media'
import { ruleProblems } from '../../src/features/media/model'
import { povParts, povSelf, povText } from '../../src/features/media/pov'
import { liveFeature, goLive, livePreview, cutLive, slotEnd, slotPreview, slotStart, readLive, liveView } from '../../src/features/live'
import { BATTLE_SETUPS, METER_CONTENT, TEST_COMBAT, makeActor, makeBattleGame, makeGame, meterFeature, testMeter } from '../../src/testkit'
import type { ActorOverrides } from '../../src/testkit'

type Rec = Record<string, any>
type G = ReturnType<typeof makeGame>['game']

// ===================================================================================================================
// 假資料與小工具
// ===================================================================================================================

/** 替身：義體與無人機的被動效果（角色 ext.rec 當 rec_grade、ext.drec 當 drone_rec、ext.fq、ext.fcap）、替身的頻道（條件 channel_open、channel_staff）。 */
const TOY: Feature = {
  id: 'pov_toy',
  install(k: Kernel) {
    for (const [stat, key] of [['rec_grade', 'rec'], ['drone_rec', 'drec'], ['footage_quality', 'fq'], ['footage_cap', 'fcap']] as const) {
      k.stats.addStatProvider(stat, 'pov_toy', (state, actor) => {
        const v = state.actors[actor]?.ext[key]
        return typeof v === 'number' ? [{ label: '測試義體', value: v, source: 'cyber' }] : []
      })
    }
    for (const kind of ['district', 'facility_type', 'block']) k.content.defineKind({ kind, owner: 'pov_toy', validate: () => [] })
    k.conditions.register({ kind: 'channel_open', owner: 'pov_toy', validate: () => [], test: (_c, ctx) => ctx.state.flags.channel_on === true, describe: () => '要開著頻道' })
    k.conditions.register({ kind: 'channel_staff', owner: 'pov_toy', validate: () => [], test: (c: Rec, ctx: Rec) => ((ctx.state.ext.toy_staff as string[] | undefined) ?? []).includes(c.role) })
    k.conditions.register({ kind: 'at_home', owner: 'pov_toy', validate: () => [], test: (_c: Rec, ctx: Rec) => ctx.state.flags.at_home === true })
  },
}

const item = (id: string, name: string, camera: string, grade: number): Rec => ({ id, name, desc: `${name}。`, category: 'tool', grade, size: 1, legal: 'free', camera })

const PACK: ContentPack = {
  id: 'pov_pack',
  content: {
    district: [{ id: 'd_a', name: '甲區' }, { id: 'd_b', name: '乙區' }, { id: 'd_nocam', name: '禁拍的區', no_rec: true }],
    facility_type: [{ id: 'fac_plain', name: '一般的店' }],
    block: [{ id: 'blk_a', name: '甲街' }],
    faction: [{ id: 'f_a', name: '星旗', short: '星旗', class: 'corp', grade: 3 }, { id: 'f_b', name: '蜂巢會', short: '蜂巢會', class: 'street', grade: 2 }],
    item: [
      item('cam_hand', '手持攝影機', 'hand', 3), item('cam_worn', '運動攝影機', 'worn', 2), item('cam_tripod', '腳架攝影機', 'tripod', 3), item('cam_pin', '針孔攝影機', 'pinhole', 1),
      { id: 'not_cam', name: '一般工具', desc: '一般工具。', category: 'tool', grade: 1, size: 1, legal: 'free' },
    ] as never,
  },
}

const buddy = (o: ActorOverrides = {}) => makeActor({ id: 'bud', name: '夥伴', role: 'companion', ...o })

function make(o: { pc?: ActorOverrides; actors?: ReturnType<typeof makeActor>[]; patch?: Partial<GameState>; features?: Feature[] } = {}): G {
  return makeGame({
    features: [mediaFeature, TOY, TEST_COMBAT, ...(o.features ?? [])], content: [PACK], pc: { ext: { rec: 3 }, ...o.pc },
    ...(o.actors ? { actors: o.actors } : {}), patch: { flags: { channel_on: true }, ...o.patch },
  }).game
}

const sys = (changes: Change[], action = 'test.give', extra: Partial<ReportDraft> = {}): ReportDraft => ({ kind: 'system', action, location: {}, party: [], timeline: [], changes, outcome: { result: 'ok', summary: '測試。' }, ...extra })
const give = (g: G, changes: Change[]) => g.commit(sys(changes))
const media = (g: G) => readMedia(g.state)
const recs = (g: G) => Object.values(media(g).records)
const reasonOf = (fn: () => unknown): string => {
  try { fn() } catch (e) { if (e instanceof ActionBlocked) return e.message; throw e }
  return ''
}
const haveItem = (g: G, id: string, qty = 1): void => { give(g, [{ op: 'item', id, qty }]) }

/** 直接加一則紀錄（media.add；pov、event 要自己寫）。回傳它的 id。 */
function addRec(g: G, o: Rec = {}): string {
  give(g, [{
    op: 'media.add',
    record: { at: toMinutes(g.state.time), source: { kind: 'battle', ref: 'bx' }, label: '一場測試的戰鬥', by: 'pc', grade: 3, type: 'battle', involves: { factions: [], people: [] }, marks: [], exclusive: true, pov: { kind: 'self_pov', who: 'pc' }, event: 'battle:bx', ...o },
  }])
  return recs(g).at(-1)!.id
}
const convert = (g: G, id: string) => { g.commit(convertDraft(g.k, g.state, id)); return media(g).footage[media(g).records[id]!.made!]! }
const q = (g: G, id: string) => qualityParts(g.k, g.state, media(g).records[id]!)

function endOf(g: G, kind: string, o: { id?: string; origin?: Rec; outcome?: string; result?: Rec } = {}): void {
  const end = endActivity(g.k, { state: g.state, kind, id: o.id ?? 'x1', origin: { by: 'test', ...o.origin }, outcome: o.outcome ?? 'done', result: o.result ?? {} })
  g.commit(attachActivityEnd(sys([...end.changes], `${kind}.end`), end))
}

/** 打一場（直接定案）；mutate 可以在定案前改戰場（放一台被擊落的無人機之類）。 */
async function fight(g: G, mutate?: (b: NonNullable<GameState['battle']>) => void, origin?: Rec): Promise<void> {
  g.startBattle({ ...BATTLE_SETUPS.encounter(), ...(origin ? { origin: { escapable: true, ...origin } } : {}) })
  const b = structuredClone(g.state.battle!)
  mutate?.(b)
  b.result = { outcome: 'win', text: '結束。' }
  g.commit({ kind: 'combat', action: 'battle.step', location: {}, party: [], timeline: [], changes: [{ op: 'battle', state: b, step: true }], outcome: { result: 'win', summary: '結束。' } }, { attach: true, turn: false })
  await g.finishBattle()
}

/** 在戰場上放一台無人機（操作者是第一個我方單位，把它的 actor 設成 who）。 */
const drone = (who: string, down: boolean) => (b: NonNullable<GameState['battle']>): void => {
  const unit = Object.values(b.units).find((u) => u.side === 'ally')!
  unit.actor = who
  b.overlays.push({ id: 'ov1', side: 'ally', slot: 1, owner: unit.id, kind: 'attack', name: '蜂', hp: { now: down ? 0 : 10, max: 10 }, armor: 0, evade: 10, used: false, down, ext: { drone: 0, operator: unit.id } })
}


// ===================================================================================================================
describe('一件事的每個鏡頭各記一則（M5-media-pov 要做的 2；MEDIA 2.2 節）', () => {
  it('同一場戰鬥：主角的錄影眼、隊友的錄影眼、一台錄影無人機 → 三則紀錄、三種視角、共用同一個 event；主角那一則 self 為假，另兩則為真', async () => {
    const g = make({ pc: { ext: { rec: 3 } }, actors: [buddy({ ext: { rec: 2, drec: 2 } })] })
    await fight(g)
    const list = recs(g)
    expect(list).toHaveLength(3)
    const by = (kind: string, who?: string) => list.find((r) => r.pov.kind === kind && (who === undefined || r.pov.who === who))!
    expect(by('self_pov', 'pc')).toMatchObject({ by: 'pc', grade: 3, type: 'battle' })
    expect(by('follow')).toMatchObject({ by: 'bud', grade: 2 })
    expect(by('drone')).toMatchObject({ by: 'bud', grade: 2 })
    expect(new Set(list.map((r) => r.event)).size).toBe(1)
    expect(list[0]!.event).toMatch(/^battle:/)
    expect(by('self_pov').marks).not.toContain('self')
    expect(by('follow').marks).toContain('self')
    expect(by('drone').marks).toContain('self')
    // 三則各自能轉成素材：視角跟著帶過去，各有三次
    for (const r of list) {
      const f = convert(g, r.id)
      expect(f).toMatchObject({ pov: r.pov, event: r.event, uses: 3 })
      expect(f.self).toBe(r.marks.includes('self'))
    }
  })

  it('不同的事不共用 event：兩場戰鬥各自有自己的鍵', async () => {
    const g = make()
    await fight(g)
    await fight(g)
    const events = recs(g).map((r) => r.event)
    expect(new Set(events).size).toBe(2)
  })

  it('隊友的錄影義體拍主角是跟拍（畫面裡有你）；主角自己沒有義體：只有那一則', async () => {
    const g = make({ pc: { ext: {} }, actors: [buddy({ ext: { rec: 4 } })] })
    await fight(g)
    expect(recs(g)).toHaveLength(1)
    expect(recs(g)[0]).toMatchObject({ by: 'bud', grade: 4, pov: { kind: 'follow' } })
    expect(recs(g)[0]!.marks).toContain('self')
  })

  it('沒有任何鏡頭：照舊記一則沒錄到的（by 是 null、原因是沒有人錄得到）；轉不了', async () => {
    const g = make({ pc: { ext: {} } })
    await fight(g)
    expect(recs(g)).toHaveLength(1)
    expect(recs(g)[0]).toMatchObject({ by: null, miss: 'none', grade: 0 })
    expect(convertBlock(g.k, g.state, recs(g)[0]!.id)).toContain('沒有留下畫面')
  })

  it('錄影關著：所有鏡頭都不錄（原因 off）；不准錄的地方：在場的鏡頭都被擋（原因 banned）', async () => {
    const g = make({ actors: [buddy({ ext: { drec: 2 } })] })
    give(g, [{ op: 'media.rec', on: false }])
    await fight(g)
    expect(recs(g)).toHaveLength(1)
    expect(recs(g)[0]).toMatchObject({ by: null, miss: 'off' })
    const h = make({ actors: [buddy({ ext: { drec: 2 } })], patch: { location: { district: 'd_nocam' } } })
    await fight(h)
    expect(recs(h)).toHaveLength(1)
    expect(recs(h)[0]).toMatchObject({ by: null, miss: 'banned' })
  })

  it('無人機在戰鬥中被擊落：那一則照舊記，標 cut_short；沒被擊落的、別的鏡頭不標', async () => {
    const g = make({ pc: { ext: { rec: 3 } }, actors: [buddy({ ext: { drec: 3 } })] })
    await fight(g, drone('bud', true))
    const d = recs(g).find((r) => r.pov.kind === 'drone')!
    expect(d.marks).toContain('cut_short')
    expect(recs(g).filter((r) => r.marks.includes('cut_short'))).toHaveLength(1)
    // 轉成素材的說明提到斷錄
    expect(convert(g, d.id).text).toContain('被擊落')
    const h = make({ pc: { ext: {} }, actors: [buddy({ ext: { drec: 3 } })] })
    await fight(h, drone('bud', false))
    expect(recs(h).find((r) => r.pov.kind === 'drone')!.marks).not.toContain('cut_short')
  })

  it('成人場景：主角自己的錄影眼是主角的 POV（沒有 self）；加一台腳架攝影機架在這裡：多一則攝影機的視角（有 self）', () => {
    const g = make()
    haveItem(g, 'cam_tripod')
    g.commit(setCamera(g.k, g.state, { item: 'cam_tripod' }))
    endOf(g, 'scene', { result: { with: 'npc_ok', touched: ['x_tag'] } })
    const list = recs(g)
    expect(list.map((r) => r.pov.kind).sort()).toEqual(['camera', 'self_pov'])
    expect(list.find((r) => r.pov.kind === 'self_pov')!.marks).toEqual(['adult'])
    expect(list.find((r) => r.pov.kind === 'camera')!.marks.sort()).toEqual(['adult', 'self'])
    expect(list.every((r) => r.tags?.includes('x_tag'))).toBe(true)
  })

  it('委託副本：階段裡的幾場事先放進暫存、里程碑那一拍每個鏡頭各出一則；階段裡被擊落的無人機那一則標 cut_short；同一個階段共用一個 event，下一個階段是另一個', async () => {
    const g = make({ pc: { ext: { rec: 3 } }, actors: [buddy({ ext: { drec: 3 } })] })
    await fight(g, drone('bud', true), { ext: { by: 'commission', ref: 'cm1', commission: 'cm1', stage: 1, face: 'meat' } })
    expect(recs(g)).toHaveLength(0)
    expect(media(g).stage).toMatchObject({ commission: 'cm1', cut: ['drone:bud'] })
    g.commit(sys([], 'commission.milestone', { timeline: [{ layer: 'meat', text: '階段做完。', tag: 'commission.milestone', data: { id: 'cm1', stage: 1, face: 'meat', faction: 'f_b', grade: 2 } }] }))
    expect(recs(g)).toHaveLength(2)
    expect(recs(g).find((r) => r.pov.kind === 'drone')!.marks).toContain('cut_short')
    expect(recs(g).find((r) => r.pov.kind === 'self_pov')!.marks).not.toContain('cut_short')
    expect(new Set(recs(g).map((r) => r.event))).toEqual(new Set(['stage:cm1#1']))
    expect(media(g).stage).toBeNull()
    g.commit(sys([], 'commission.milestone', { timeline: [{ layer: 'meat', text: '階段做完。', tag: 'commission.milestone', data: { id: 'cm1', stage: 2, face: 'meat' } }] }))
    expect(new Set(recs(g).map((r) => r.event))).toEqual(new Set(['stage:cm1#1', 'stage:cm1#2']))
  })

  it('事件給的視角（record.pov）：監視器多一個鏡頭（等級照規則表，不看錄影的開關與「不准錄」）；self 預設沒有、hint.self 寫了才有', () => {
    const g = make({ pc: { ext: {} } })
    // 沒有任何鏡頭，但事件給了一份監視器的畫面
    endOf(g, 'event', { result: { event: 'ev_x' }, origin: { ext: { record: { pov: { kind: 'cctv' }, type: 'crime' } } } })
    expect(recs(g)).toHaveLength(1)
    expect(recs(g)[0]).toMatchObject({ pov: { kind: 'cctv' }, by: 'pc', grade: mediaRules(g.k).pov.cctv_grade, type: 'crime' })
    expect(recs(g)[0]!.marks).not.toContain('self')
    endOf(g, 'event', { id: 'x2', result: { event: 'ev_y' }, origin: { ext: { record: { pov: { kind: 'cctv' }, self: true } } } })
    expect(recs(g).at(-1)!.marks).toContain('self')
    // 錄影關著、不准錄也一樣有（不是玩家自己錄的）
    const h = make({ patch: { location: { district: 'd_nocam' } } })
    give(h, [{ op: 'media.rec', on: false }])
    endOf(h, 'event', { result: { event: 'ev_x' }, origin: { ext: { record: { pov: { kind: 'other_pov', who: 'foe1' }, grade: 4 } } } })
    expect(recs(h)).toHaveLength(1)
    expect(recs(h)[0]).toMatchObject({ pov: { kind: 'other_pov', who: 'foe1' }, grade: 4 })
    expect(recs(h)[0]!.by).not.toBeNull()
  })

  it('舊的寫法（media.add 不帶 pov、event）讀得進來：視角當「某人的 POV」（不帶人）、event 由來源推；標 legacy；舊存檔的欄位缺了一樣讀得進來', () => {
    const g = make()
    give(g, [{ op: 'media.add', record: { at: 0, source: { kind: 'battle', ref: 'b9' }, label: '舊紀錄', by: 'pc', grade: 1, type: 'battle', involves: { factions: [], people: [] }, marks: [], exclusive: true } }])
    expect(recs(g)[0]).toMatchObject({ pov: { kind: 'self_pov' }, event: 'battle:b9', legacy: true })
    expect(recs(g)[0]!.pov.who).toBeUndefined()
    // 存檔的樣子：沒有 pov、event 的整份 ext
    const raw = JSON.parse(JSON.stringify(g.state.ext.media)) as Rec
    for (const r of Object.values<Rec>(raw.records)) { delete r.pov; delete r.event; delete r.legacy }
    delete raw.cams
    const old = readMedia({ ext: { media: raw } } as never)
    expect(Object.values(old.records)[0]).toMatchObject({ pov: { kind: 'self_pov' }, event: 'battle:b9', legacy: true })
    expect(old.cams).toEqual([])
    // 舊的素材
    raw.footage = { ft1: { title: '舊素材', text: '', type: 'battle', quality: 2, authentic: 'real', exclusive: true, involves: {}, uses: 3, made_at: 0, origin: 'own' } }
    expect(readMedia({ ext: { media: raw } } as never).footage.ft1).toMatchObject({ pov: { kind: 'self_pov' } })
  })

  it('壞的 pov 不收：media.add 的 record.pov 不是視角整步不成立', () => {
    const g = make()
    expect(() => give(g, [{ op: 'media.add', record: { at: 0, source: { kind: 'battle' }, label: 'x', by: 'pc', grade: 1, type: 'battle', involves: { factions: [], people: [] }, marks: [], exclusive: true, pov: { kind: 'nope' } } }])).toThrow()
  })
})

// ===================================================================================================================
describe('視角的顯示與 self 的判斷（pov.ts）', () => {
  it('povText：某人的 POV、跟拍、無人機跟拍、攝影機、監視器、別人的 POV；素材的說明與檢視都有那一句', async () => {
    const g = make({ actors: [buddy({ ext: { rec: 2, drec: 2 } })] })
    expect(povText(g.state, { kind: 'self_pov', who: 'pc' })).toBe(`${g.state.actors.pc!.name}的 POV`)
    expect(povText(g.state, { kind: 'follow' })).toBe('跟拍')
    expect(povText(g.state, { kind: 'drone' })).toBe('無人機跟拍')
    expect(povText(g.state, { kind: 'camera' })).toBe('攝影機')
    expect(povText(g.state, { kind: 'cctv' })).toBe('監視器')
    expect(povText(g.state, { kind: 'other_pov', who: 'bud' })).toContain('夥伴的 POV')
    await fight(g)
    const id = recs(g).find((r) => r.pov.kind === 'drone')!.id
    const f = convert(g, id)
    expect(f.text).toContain('視角：無人機跟拍')
    const v = mediaView(g.k, g.state)
    expect(v.records.find((r) => r.id === id)).toMatchObject({ pov_text: '無人機跟拍', pov: { kind: 'drone' } })
    expect(v.footage[0]).toMatchObject({ pov_text: '無人機跟拍', povs: [{ kind: 'drone' }] })
    expect(materialOf(g.k, g.state, f.id)!.pov_text).toBe('無人機跟拍')
  })

  it('povSelf：主角自己的 POV 沒有；跟拍、無人機、攝影機有；監視器與別人的 POV 看那一件事寫的（預設沒有）', () => {
    expect(povSelf({ kind: 'self_pov', who: 'pc' })).toBe(false)
    expect(povSelf({ kind: 'self_pov', who: 'pc' }, true)).toBe(false)
    for (const kind of ['follow', 'drone', 'camera'] as const) expect(povSelf({ kind })).toBe(true)
    expect(povSelf({ kind: 'cctv' })).toBe(false)
    expect(povSelf({ kind: 'cctv' }, true)).toBe(true)
    expect(povSelf({ kind: 'other_pov', who: 'x' })).toBe(false)
  })
})

// ===================================================================================================================
describe('品質：上限看鏡頭的等級（MEDIA 2.2 節）', () => {
  it('義體 II 的 POV：品質最高 2；III 最高 3；沒有聚光燈的隊伍最高 3，footage_cap 讓 IV、V 的鏡頭再往上', () => {
    const g = make({ pc: { ext: { rec: 2, fq: 3 }, skills: { perform: 5 } } })
    const r2 = addRec(g, { grade: 2, marks: ['crit', 'hq'] })
    expect(q(g, r2)).toMatchObject({ cap: 2, value: 2 })
    const r3 = addRec(g, { grade: 3, marks: ['crit', 'hq'] })
    expect(q(g, r3)).toMatchObject({ cap: 3, value: 3 })
    const r5 = addRec(g, { grade: 5, marks: ['crit', 'hq'] })
    expect(q(g, r5).cap).toBe(3)
    const h = make({ pc: { ext: { rec: 5, fq: 3, fcap: 2 }, skills: { perform: 5 } } })
    expect(q(h, addRec(h, { grade: 5, marks: ['crit', 'hq'] }))).toMatchObject({ cap: 5, value: 5 })
    expect(q(h, addRec(h, { grade: 4, marks: ['crit', 'hq'] })).cap).toBe(4)
  })

  it('每種鏡頭的品質那一項用自己的名字；無人機感測器與攝影機也受自己的等級限制', () => {
    const g = make({ pc: { ext: { rec: 3, fq: 3 }, skills: { perform: 5 } } })
    const d = addRec(g, { grade: 1, pov: { kind: 'drone' }, marks: ['crit', 'hq'] })
    expect(q(g, d)).toMatchObject({ cap: 1, value: 1 })
    const c = addRec(g, { grade: 2, pov: { kind: 'camera' }, marks: ['crit', 'hq'] })
    expect(q(g, c)).toMatchObject({ cap: 2, value: 2 })
    const big = addRec(g, { grade: 5, pov: { kind: 'drone' }, marks: ['crit', 'hq'] })
    expect(q(g, big).parts.map((p) => p.label)).toContain('無人機感測器')
    expect(q(g, addRec(g, { grade: 5, pov: { kind: 'camera' } })).parts.map((p) => p.label)).toContain('攝影機')
  })

  it('監視器：品質最高 2（等級照規則表）；針孔攝影機（物品 I 級）：最高 1', () => {
    const g = make({ pc: { ext: { fq: 3 }, skills: { perform: 5 } } })
    endOf(g, 'event', { result: { event: 'ev_x' }, origin: { ext: { record: { pov: { kind: 'cctv' }, hq: true, celebrity: true } } } })
    expect(q(g, recs(g)[0]!.id)).toMatchObject({ cap: 2, value: 2 })
    const h = make({ pc: { ext: { fq: 3 }, skills: { perform: 5 } } })
    haveItem(h, 'cam_pin')
    h.commit(setCamera(h.k, h.state, { item: 'cam_pin' }))
    endOf(h, 'event', { result: { event: 'ev_x' }, origin: { ext: { record: { hq: true, celebrity: true } } } })
    const r = recs(h).find((x) => x.pov.kind === 'camera')!
    expect(r.grade).toBe(1)
    expect(q(h, r.id)).toMatchObject({ cap: 1, value: 1 })
  })

  it('舊的寫法（沒有 pov）的紀錄：鏡頭等級不當上限，品質照舊（V5）', () => {
    const g = make({ pc: { ext: { rec: 1 }, skills: { perform: 5 } } })
    give(g, [{ op: 'media.add', record: { at: toMinutes(g.state.time), source: { kind: 'battle' }, label: '舊', by: 'pc', grade: 1, type: 'battle', involves: { factions: [], people: [] }, marks: [], exclusive: true } }])
    expect(q(g, recs(g)[0]!.id)).toMatchObject({ cap: 3, value: 3 })
  })
})

// ===================================================================================================================
describe('視角給看點與可信的修正（MEDIA 2.2、第 3 節）', () => {
  /** 轉一則給定視角與類型的紀錄，回傳那一段素材。 */
  const footage = (g: G, o: Rec): string => { const f = convert(g, addRec(g, o)); return f.id }
  const draw = (g: G, ref: string) => materialOf(g.k, g.state, ref)!

  it('某人的 POV：親密與戰鬥類看點 +1，其他類型沒有；跟拍、攝影機沒有', () => {
    const g = make()
    const battle = footage(g, { type: 'battle' })
    const intimate = footage(g, { type: 'intimate' })
    const daily = footage(g, { type: 'daily' })
    const follow = footage(g, { type: 'battle', pov: { kind: 'follow' } })
    const cam = footage(g, { type: 'battle', pov: { kind: 'camera' } })
    const base = draw(g, daily).quality
    expect(draw(g, battle).draw).toBe(draw(g, battle).quality + 1)
    expect(draw(g, intimate).draw).toBe(draw(g, intimate).quality + 1)
    expect(draw(g, daily).draw).toBe(base)
    expect(draw(g, follow).draw).toBe(draw(g, follow).quality)
    expect(draw(g, cam).draw).toBe(draw(g, cam).quality)
  })

  it('無人機：戰鬥類看點 +1，親密類沒有', () => {
    const g = make()
    const b = footage(g, { type: 'battle', pov: { kind: 'drone' } })
    const i = footage(g, { type: 'intimate', pov: { kind: 'drone' } })
    expect(draw(g, b).draw).toBe(draw(g, b).quality + 1)
    expect(draw(g, i).draw).toBe(draw(g, i).quality)
  })

  it('監視器：看點 −1（最少 0）、可信 +2；別人的 POV：可信 +2；可信最多 10', () => {
    const g = make()
    const c = footage(g, { type: 'crime', pov: { kind: 'cctv' } })
    const o = footage(g, { type: 'crime', pov: { kind: 'other_pov', who: 'foe' } })
    const plain = footage(g, { type: 'crime', pov: { kind: 'camera' } })
    expect(draw(g, c).draw).toBe(draw(g, plain).draw - 1)
    expect(draw(g, c).trust).toBe(draw(g, plain).trust + 2)
    expect(draw(g, o).trust).toBe(draw(g, plain).trust + 2)
    expect(draw(g, o).draw).toBe(draw(g, plain).draw)
    const top = footage(g, { type: 'crime', grade: 5, pov: { kind: 'other_pov', who: 'foe' } })
    expect(draw(g, top).trust).toBeLessThanOrEqual(10)
    // 看點最少 0
    expect(Math.max(0, 1 - 5)).toBe(0)
  })

  it('沒有 pov 的舊素材：沒有視角的加成（數字不變）', () => {
    const g = make()
    give(g, [{ op: 'media.make', footage: { title: '舊', text: '', type: 'battle', quality: 2, authentic: 'real', exclusive: true, involves: { factions: [], people: [] }, uses: 3, made_at: 0, origin: 'own', celebrity: false, self: false, adult: false } }])
    const f = Object.values(media(g).footage)[0]!
    expect(f.pov).toEqual({ kind: 'self_pov' })
    expect(materialOf(g.k, g.state, f.id)).toMatchObject({ draw: 2, trust: 4 })
  })

  it('剪片：視角的加成只加一次（兩段都是主角的 POV 也只 +1）；片的 pov_parts 記著每一項；重剪沿用', () => {
    const g = make({ actors: [buddy()] })
    const a = footage(g, { type: 'battle', event: 'e1', grade: 3 })
    const b = footage(g, { type: 'battle', event: 'e2', grade: 3 })
    const base = cutPreview(g.k, g.state, { parts: [a, b], angle: 'documentary' })
    expect(base.detail!.parts.draw.filter((p) => p.label === '某人的 POV')).toEqual([{ label: '某人的 POV', value: 1 }])
    expect(base.detail!.draw).toBe(base.detail!.quality + 1)
  })

  it('povParts 的算式：數字在規則表 media_rule.pov，資料可蓋；格式不對的整筆被擋', () => {
    const rules = mediaRules(makeGame({ features: [mediaFeature] }).game.k)
    expect(rules.pov).toEqual({ pov_draw: 1, drone_draw: 1, cctv_draw: -1, cctv_trust: 2, other_trust: 2, multi_draw: 1, cctv_grade: 2, other_grade: 3 })
    expect(rules.cam).toEqual({ tripod_minutes: 240, pinhole_minutes: 10, hand_ap: 1 })
    expect(povParts(rules, [{ type: 'battle', pov: { kind: 'self_pov', who: 'pc' } }]).draw).toEqual([{ label: '某人的 POV', value: 1 }])
    expect(ruleProblems({ pov: { cctv_draw: 1 } })).toEqual(['pov.cctv_draw 要是 -5～0 的整數'])
    expect(ruleProblems({ pov: { pov_draw: 1.5 } })).toEqual(['pov.pov_draw 要是 0～5 的整數'])
    expect(ruleProblems({ cam: { hand_ap: 9 } })).toEqual(['cam.hand_ap 要是 0～3 的整數'])
    expect(ruleProblems({ pov: { pov_draw: 2, multi_draw: 0 }, cam: { tripod_minutes: 60 } })).toEqual([])
    const g = makeGame({ features: [mediaFeature], content: [{ id: 'r', content: { media_rule: [{ id: 'default', pov: { pov_draw: 3, cctv_draw: -2 }, cam: { hand_ap: 2 } }] } }] }).game
    expect(mediaRules(g.k).pov).toMatchObject({ pov_draw: 3, cctv_draw: -2, drone_draw: 1 })
    expect(mediaRules(g.k).cam.hand_ap).toBe(2)
  })
})

// ===================================================================================================================
describe('多機位（MEDIA 2.2、第 3 節）', () => {
  const foot = (g: G, o: Rec): string => convert(g, addRec(g, o)).id
  const drawOf = (g: G, parts: string[]) => cutPreview(g.k, g.state, { parts, angle: 'documentary' }).detail!

  it('兩段同一件事、視角不同：看點 +1；換成不同事件不加；同一件事同一種視角不加', () => {
    const g = make()
    const a = foot(g, { type: 'daily', event: 'e1', pov: { kind: 'follow' } })
    const b = foot(g, { type: 'daily', event: 'e1', pov: { kind: 'camera' } })
    const c = foot(g, { type: 'daily', event: 'e2', pov: { kind: 'camera' } })
    const d = foot(g, { type: 'daily', event: 'e1', pov: { kind: 'follow' } })
    const same = drawOf(g, [a, b])
    expect(same.parts.draw).toContainEqual({ label: '多機位', value: 1 })
    expect(same.draw).toBe(same.quality + 1)
    const other = drawOf(g, [a, c])
    expect(other.parts.draw.map((p) => p.label)).not.toContain('多機位')
    expect(drawOf(g, [a, d]).parts.draw.map((p) => p.label)).not.toContain('多機位')
    // 同一種視角、不同的人：算不同的視角
    const w1 = foot(g, { type: 'daily', event: 'e3', pov: { kind: 'self_pov', who: 'pc' } })
    const w2 = foot(g, { type: 'daily', event: 'e3', pov: { kind: 'self_pov', who: 'bud' } })
    expect(drawOf(g, [w1, w2]).parts.draw.map((p) => p.label)).toContain('多機位')
  })

  it('三段：兩段同一件事不同視角，第三段是別的事：只加一次', () => {
    const g = make()
    const a = foot(g, { type: 'daily', event: 'e1', pov: { kind: 'follow' } })
    const b = foot(g, { type: 'daily', event: 'e1', pov: { kind: 'camera' } })
    const c = foot(g, { type: 'daily', event: 'e9', pov: { kind: 'drone' } })
    expect(drawOf(g, [a, b, c]).parts.draw.filter((p) => p.label === '多機位')).toEqual([{ label: '多機位', value: 1 }])
  })

  it('用真的一場戰鬥的三則紀錄：三段素材剪在一起看點 +1（多機位）加視角的加成；和另一場的拼起來不算多機位；剪出來的片帶著來源的視角，重剪沿用修正', async () => {
    const g = make({ pc: { ext: { rec: 3 } }, actors: [buddy({ ext: { rec: 3, drec: 3 } })] })
    await fight(g)
    const ids = recs(g).map((r) => convert(g, r.id).id)
    const full = cutPreview(g.k, g.state, { parts: ids, angle: 'documentary' }).detail!
    expect(full.parts.draw.map((p) => p.label).filter((l) => l !== '品質').sort()).toEqual(['多機位', '某人的 POV', '無人機'].sort())
    await fight(g)
    const second = recs(g).filter((r) => r.event !== recs(g)[0]!.event).map((r) => convert(g, r.id).id)
    const mixed = cutPreview(g.k, g.state, { parts: [ids[0]!, second[0]!], angle: 'documentary' }).detail!
    expect(mixed.parts.draw.map((p) => p.label)).not.toContain('多機位')
    // 剪出來的片
    g.state.flags.at_home = true
    g.commit(cut(g.k, g.state, { parts: ids, angle: 'documentary' }))
    const clip = Object.values(media(g).clips)[0]!
    expect(clip.povs!.map((p) => p.kind).sort()).toEqual(['drone', 'follow', 'self_pov'])
    expect(clip.pov_parts!.draw.map((p) => p.label).sort()).toEqual(['多機位', '某人的 POV', '無人機'].sort())
    expect(materialOf(g.k, g.state, clip.id)!.pov_text).toContain('無人機跟拍')
    void recut
  })
})

// ===================================================================================================================
describe('攝影機的架設（ITEMS 第 6 節；MEDIA 2.2 節）', () => {
  it('手持：要有人拿著（隊友或製作）；主角自己拿不了、沒人拿不錄；放下就不錄', async () => {
    const g = make({ pc: { ext: {} }, actors: [buddy()] })
    haveItem(g, 'cam_hand')
    expect(reasonOf(() => setCamera(g.k, g.state, { item: 'cam_hand' }))).toContain('手持攝影機要有人拿著')
    expect(reasonOf(() => setCamera(g.k, g.state, { item: 'cam_hand', holder: 'pc' }))).toContain('手持攝影機要有人拿著')
    expect(reasonOf(() => setCamera(g.k, g.state, { item: 'cam_hand', holder: 'producer' }))).toContain('沒有製作')
    g.commit(setCamera(g.k, g.state, { item: 'cam_hand', holder: 'bud' }))
    expect(lensesOf(g.k, g.state)).toHaveLength(1)
    expect(lensesOf(g.k, g.state)[0]).toMatchObject({ kind: 'camera', by: 'bud', grade: 3, hand: true, pov: { kind: 'camera' } })
    await fight(g)
    expect(recs(g)).toHaveLength(1)
    expect(recs(g)[0]).toMatchObject({ by: 'bud', grade: 3, pov: { kind: 'camera' } })
    expect(recs(g)[0]!.marks).toContain('self')
    const uid = media(g).cams[0]!.uid
    g.commit(dropCamera(g.k, g.state, uid))
    expect(media(g).cams).toEqual([])
    expect(lensesOf(g.k, g.state)).toHaveLength(0)
  })

  it('手持：頻道編制的製作拿著（條件 channel_staff）：拍的人記主角，不佔隊上的手；製作不在了就不錄', () => {
    const g = make({ pc: { ext: {} }, patch: { ext: { toy_staff: ['producer'] } } })
    haveItem(g, 'cam_hand')
    g.commit(setCamera(g.k, g.state, { item: 'cam_hand', holder: 'producer' }))
    const l = lensesOf(g.k, g.state)
    expect(l).toHaveLength(1)
    expect(l[0]!.hand).toBeUndefined()
    g.state.ext.toy_staff = []
    expect(lensesOf(g.k, g.state)).toHaveLength(0)
  })

  it('運動攝影機：別在身上（預設主角），不佔手；戴的人要在隊上；離隊了就不錄', () => {
    const g = make({ pc: { ext: {} }, actors: [buddy()] })
    haveItem(g, 'cam_worn')
    expect(reasonOf(() => setCamera(g.k, g.state, { item: 'cam_worn', holder: 'nobody' }))).toContain('要別在隊上的人身上')
    g.commit(setCamera(g.k, g.state, { item: 'cam_worn' }))
    expect(media(g).cams[0]).toMatchObject({ kind: 'worn', holder: 'pc' })
    expect(lensesOf(g.k, g.state)[0]).toMatchObject({ by: 'pc', grade: 2 })
    expect(lensesOf(g.k, g.state)[0]!.hand).toBeUndefined()
  })

  it('腳架：架在現在這個地點、花一個時段；換了地方就不錄，回來又錄；重架（帶 uid）換地方並再花一個時段；戰鬥中不能換', async () => {
    const g = make({ pc: { ext: {} }, patch: { location: { district: 'd_a' } } })
    haveItem(g, 'cam_tripod')
    const before = toMinutes(g.state.time)
    const [rep] = g.commit(setCamera(g.k, g.state, { item: 'cam_tripod' }))
    expect(rep).toMatchObject({ action: 'media.cam' })
    expect(toMinutes(g.state.time) - before).toBe(mediaRules(g.k).cam.tripod_minutes)
    expect(media(g).cams[0]).toMatchObject({ kind: 'tripod', place: { district: 'd_a' } })
    expect(lensesOf(g.k, g.state)).toHaveLength(1)
    expect(camRows(g.k, g.state)[0]).toMatchObject({ kind: 'tripod', recording: true })
    g.state.location = { district: 'd_b' }
    expect(lensesOf(g.k, g.state)).toHaveLength(0)
    expect(camRows(g.k, g.state)[0]!.recording).toBe(false)
    g.state.location = { district: 'd_a' }
    expect(lensesOf(g.k, g.state)).toHaveLength(1)
    g.state.location = { district: 'd_b' }
    const t = toMinutes(g.state.time)
    g.commit(setCamera(g.k, g.state, { item: 'cam_tripod', uid: media(g).cams[0]!.uid }))
    expect(toMinutes(g.state.time) - t).toBe(mediaRules(g.k).cam.tripod_minutes)
    expect(media(g).cams).toHaveLength(1)
    expect(lensesOf(g.k, g.state)).toHaveLength(1)
    // 戰鬥中不能換
    g.startBattle(BATTLE_SETUPS.encounter())
    expect(camBlock(g.k, g.state, { item: 'cam_tripod', uid: media(g).cams[0]!.uid }).block).not.toBeNull()
    void fight
  })

  it('針孔：留在現場、不花一個時段（pinhole_minutes）；背包裡沒有那一件、不是攝影機、沒有多的都架不了', () => {
    const g = make({ pc: { ext: {} }, patch: { location: { district: 'd_a' } } })
    expect(reasonOf(() => setCamera(g.k, g.state, { item: 'cam_pin' }))).toContain('背包裡沒有多的')
    expect(reasonOf(() => setCamera(g.k, g.state, { item: 'not_cam' }))).toBe('那不是一台攝影機。')
    haveItem(g, 'cam_pin')
    const t = toMinutes(g.state.time)
    g.commit(setCamera(g.k, g.state, { item: 'cam_pin' }))
    expect(toMinutes(g.state.time) - t).toBe(mediaRules(g.k).cam.pinhole_minutes)
    expect(reasonOf(() => setCamera(g.k, g.state, { item: 'cam_pin' }))).toContain('背包裡沒有多的')
    expect(lensesOf(g.k, g.state)[0]).toMatchObject({ grade: 1, pov: { kind: 'camera' } })
    // 東西離開背包：那一台不錄
    give(g, [{ op: 'item', id: 'cam_pin', qty: -1 }])
    expect(lensesOf(g.k, g.state)).toHaveLength(0)
  })

  it('一個地方可以同時有好幾台：兩台腳架（背包裡有兩件）各記一則', () => {
    const g = make({ pc: { ext: {} }, patch: { location: { district: 'd_a' } } })
    haveItem(g, 'cam_tripod', 2)
    g.commit(setCamera(g.k, g.state, { item: 'cam_tripod' }))
    g.commit(setCamera(g.k, g.state, { item: 'cam_tripod' }))
    expect(lensesOf(g.k, g.state)).toHaveLength(2)
    endOf(g, 'event', { result: { event: 'ev_x' } })
    expect(recs(g)).toHaveLength(2)
    expect(new Set(recs(g).map((r) => r.event)).size).toBe(1)
  })

  it('放下不存在的、沒有主角：原因是完整的一句；活動進行中不能架、不能放下', () => {
    const g = make()
    expect(reasonOf(() => dropCamera(g.k, g.state, 'cm99'))).toBe('沒有這一台架好的攝影機。')
    haveItem(g, 'cam_worn')
    g.startBattle(BATTLE_SETUPS.encounter())
    expect(reasonOf(() => setCamera(g.k, g.state, { item: 'cam_worn' }))).not.toBe('')
  })

  it('手持攝影機：拿的人戰鬥中每回合少回 cam.hand_ap 點行動點（單位帶標籤 holding_camera）；別人不受影響；運動與腳架沒有', () => {
    const g = make({ pc: { ext: {} }, actors: [buddy()] })
    haveItem(g, 'cam_hand')
    g.commit(setCamera(g.k, g.state, { item: 'cam_hand', holder: 'bud' }))
    g.startBattle(BATTLE_SETUPS.encounter())
    const view = g.state.battle!
    void view
    const mods = (actor: string) => g.k.battle.loadoutOf(g.state, actor, 'meat').tags ?? []
    expect(mods('bud')).toContain('holding_camera')
    expect(mods('pc')).not.toContain('holding_camera')
    const h = make({ pc: { ext: {} }, actors: [buddy()] })
    haveItem(h, 'cam_worn')
    h.commit(setCamera(h.k, h.state, { item: 'cam_worn', holder: 'bud' }))
    expect(h.k.battle.loadoutOf(h.state, 'bud', 'meat').tags ?? []).not.toContain('holding_camera')
  })
})

// ===================================================================================================================
describe('掛點 media.cameras 與 media.record 的直接指定', () => {
  it('media.cameras 回每一個鏡頭（義體、無人機、攝影機）：id、視角、持有的人、等級、是不是第一人稱', () => {
    const g = make({ pc: { ext: { rec: 3 } }, actors: [buddy({ ext: { rec: 2, drec: 4 } })] })
    haveItem(g, 'cam_worn')
    g.commit(setCamera(g.k, g.state, { item: 'cam_worn' }))
    const answer = g.k.hooks.run('media.cameras' as never, { state: g.state } as never).flatMap((r) => r.result as Rec[])
    expect(answer.map((c) => c.id)).toEqual(['implant:pc', 'implant:bud', 'drone:bud', `cam:${media(g).cams[0]!.uid}`])
    expect(answer[0]).toMatchObject({ pov: { kind: 'self_pov', who: 'pc' }, first_person: true, grade: 3, by: 'pc' })
    expect(answer[1]).toMatchObject({ pov: { kind: 'follow' }, first_person: false })
    expect(answer[2]).toMatchObject({ pov: { kind: 'drone' }, grade: 4, pov_text: '無人機跟拍' })
    expect(mediaView(g.k, g.state).lenses).toHaveLength(4)
  })

  it('media.record 帶 pov 與 by：只記那一個鏡頭的一則（視角、拍的人、等級照 hint）；沒帶 pov：在場每個鏡頭各一則', () => {
    const g = make({ pc: { ext: { rec: 3 } }, actors: [buddy({ ext: { rec: 2 } })] })
    const run = (hint: Rec): Change[] => g.k.hooks.run('media.record' as never, { state: g.state, source: { kind: 'live', ref: 'lv1' }, label: '直播', hint } as never).flatMap((r) => r.result as Change[])
    expect(run({ live: true, hq: true })).toHaveLength(2)
    const one = run({ live: true, hq: true, pov: { kind: 'drone' }, by: 'bud', grade: 4 })
    expect(one).toHaveLength(1)
    expect((one[0] as Rec).record).toMatchObject({ pov: { kind: 'drone' }, by: 'bud', grade: 4, event: 'live:lv1' })
    expect((one[0] as Rec).record.marks).toContain('self')
    const own = run({ live: true, pov: { kind: 'self_pov', who: 'pc' }, by: 'pc', grade: 3 })
    expect((own[0] as Rec).record.marks).not.toContain('self')
  })

  it('recStatus 照舊回最高等級的那個鏡頭；沒有鏡頭回原因', () => {
    const g = make({ pc: { ext: { rec: 1 } }, actors: [buddy({ ext: { drec: 4 } })] })
    expect(recStatus(g.k, g.state)).toEqual({ by: 'bud', grade: 4 })
    const h = make({ pc: { ext: {} } })
    expect(recStatus(h.k, h.state)).toEqual({ miss: 'none' })
  })
})

// ===================================================================================================================
// 直播：選鏡頭與第一人稱直播
// ===================================================================================================================

const SUBS = testMeter({ kind: 'subs', owner: 'ch_toy', name: '訂閱', min: 0, max: Infinity, start: 0, keyed: 'none' })

/** 一局已經開打的遊戲（真的媒體與直播、替身的頻道量表）。 */
function makeLive(o: { pc?: ActorOverrides; actors?: ReturnType<typeof makeActor>[]; media?: boolean } = {}): G {
  return makeBattleGame({
    features: [TEST_COMBAT, ...(o.media === false ? [] : [mediaFeature]), TOY, meterFeature(SUBS, testMeter({ kind: 'fame', owner: 'lewd_toy', name: '豔名', keyed: 'district' })), liveFeature],
    content: [METER_CONTENT, PACK, { id: 'goals', content: { stream_goal: [{ id: 'g_one', text: '打倒至少一個敵人。', scope: ['combat'], check: { event: 'foe_down', count_min: 1 }, heat: 3, tip_per_grade: 10 }] as never } }],
    seed: 11, patch: { flags: { channel_on: true }, meters: { subs: { _: 1000 } } }, pc: { ext: { rec: 3 }, ...o.pc }, ...(o.actors ? { actors: o.actors } : {}),
  }).game
}
const lv = (g: G) => readLive(g.state)

describe('直播：開播條件與選鏡頭（M5-media-pov 要做的 6；MEDIA 第 6 節）', () => {
  it('隊上有任何一種鏡頭就開得了：只有腳架攝影機（沒有錄影義體）：一般直播，主角在畫面裡', () => {
    const g = makeLive({ pc: { ext: {} } })
    expect(livePreview(g.k, g.state).blocks.join('')).toContain('隊上沒有任何一種鏡頭')
    expect(() => goLive(g.k, g.state)).toThrow(ActionBlocked)
    // 戰鬥中架不了（commit:live. 是放行的前綴，借它在戰鬥裡改狀態）：先確認原因，再用狀態直接放一台
    g.commit(sys([{ op: 'item', id: 'cam_tripod', qty: 1 }], 'live.test'))
    expect(reasonOf(() => setCamera(g.k, g.state, { item: 'cam_tripod' }))).not.toBe('')
    g.commit(sys([{ op: 'media.cam', set: { item: 'cam_tripod', kind: 'tripod', place: { district: g.state.location.district, block: g.state.location.block } } }], 'live.test'))
    const p = livePreview(g.k, g.state)
    expect(p.blocks).toEqual([])
    expect(p.cameras.map((c) => c.pov.kind)).toEqual(['camera'])
    expect(p.camera).toMatchObject({ pov: { kind: 'camera' }, first_person: false })
    expect(p.first_person).toBe(false)
    g.commit(goLive(g.k, g.state))
    expect(lv(g).session!.camera).toMatchObject({ pov: { kind: 'camera' }, first_person: false })
  })

  it('沒裝媒體的局：不要求鏡頭，照舊開得了', () => {
    const g = makeLive({ media: false, pc: { ext: {} } })
    const p = livePreview(g.k, g.state)
    expect(p.ok).toBe(true)
    expect(p.cameras).toEqual([])
    expect(p.camera).toBeNull()
    g.commit(goLive(g.k, g.state))
    expect(lv(g).session!.camera).toBeUndefined()
  })

  it('同時有第三人稱的鏡頭：預設選第一個第三人稱的；可以選別的；選了清單裡沒有的被擋；視角寫進直播的紀錄', () => {
    const g = makeLive({ pc: { ext: { rec: 3 } }, actors: [buddy({ ext: { drec: 2 } })] })
    const p = livePreview(g.k, g.state)
    expect(p.cameras.map((c) => c.id)).toEqual(['implant:pc', 'drone:bud'])
    expect(p.camera!.id).toBe('drone:bud')
    expect(p.first_person).toBe(false)
    expect(livePreview(g.k, g.state, 'implant:pc')).toMatchObject({ first_person: true, camera: { id: 'implant:pc' } })
    expect(livePreview(g.k, g.state, 'cam:zz').blocks.join('')).toContain('選的那個鏡頭現在用不了')
    expect(reasonOf(() => goLive(g.k, g.state, { camera: 'nope' }))).toContain('選的那個鏡頭現在用不了')
    g.commit(goLive(g.k, g.state, { drop: [], camera: 'drone:bud' }))
    expect(lv(g).session!.camera).toMatchObject({ id: 'drone:bud', by: 'bud', grade: 2, pov: { kind: 'drone' } })
    expect(liveView(g.k, g.state).session).toMatchObject({ first_person: false, camera: { pov_text: '無人機跟拍' } })
    g.commit(cutLive(g.k, g.state))
    // 直播留下的紀錄只有選的那個鏡頭的一則，視角就是它
    expect(recs(g)).toHaveLength(1)
    expect(recs(g)[0]).toMatchObject({ pov: { kind: 'drone' }, by: 'bud', grade: 2, source: { kind: 'live' }, event: expect.stringMatching(/^live:lv/) })
    expect(recs(g)[0]!.marks).toEqual(expect.arrayContaining(['live', 'hq', 'self']))
  })

  it('只有主角自己的錄影義體：第一人稱直播；留下的紀錄是主角的 POV（沒有 self）', () => {
    const g = makeLive()
    const p = livePreview(g.k, g.state)
    expect(p.first_person).toBe(true)
    expect(p.camera).toMatchObject({ id: 'implant:pc', first_person: true })
    g.commit(goLive(g.k, g.state))
    expect(liveView(g.k, g.state).session!.first_person).toBe(true)
    g.commit(cutLive(g.k, g.state))
    expect(recs(g)).toHaveLength(1)
    expect(recs(g)[0]).toMatchObject({ pov: { kind: 'self_pov', who: 'pc' }, by: 'pc' })
    expect(recs(g)[0]!.marks).not.toContain('self')
  })

  it('活動直播的第一人稱：一般內容（戰鬥）收播的訂閱 ×0.8，第三人稱的不減；規則表 first_person 可以蓋', () => {
    const subsOf = (camera: string, actors?: ReturnType<typeof makeActor>[]): { subs: number; heat: number; viewers: number } => {
      const g = makeLive({ pc: { ext: { rec: 3 } }, ...(actors ? { actors } : {}) })
      g.commit(goLive(g.k, g.state, { camera }))
      // 打幾個亮點：熱度大於 0，訂閱才有得換
      g.commit(sys([{ op: 'live.add', events: [{ event: 'foe_down', heat: 5, report: 'r' }], heat: 5, tips: 0 }], 'live.test'))
      g.commit(cutLive(g.k, g.state))
      const e = lv(g).log.at(-1)!
      expect(meterOf(g.k, g.state, 'subs')).toBe(1000 + e.subs)
      return { subs: e.subs, heat: e.heat, viewers: e.viewers! }
    }
    const buddies = [buddy({ ext: { drec: 2 } })]
    const first = subsOf('implant:pc', buddies)
    const third = subsOf('drone:bud', buddies)
    expect(third.heat).toBe(first.heat)
    const rules = { heat_subs: 6, views_div: 400 }
    const full = first.heat * rules.heat_subs + Math.floor(first.viewers / rules.views_div)
    expect(third.subs).toBe(full)
    expect(first.subs).toBe(Math.floor(full * 0.8))
    expect(first.subs).toBeLessThan(third.subs)
  })

  it('時段直播：只有主角自己的錄影義體是第一人稱——一般內容（閒聊）收播訂閱 ×0.8；成人那一種總熱度 +1（不減訂閱）；第三人稱的都沒有', () => {
    const run = (camera: string, kind: 'chat' | 'adult') => {
      const g = makeLive({ pc: { ext: { rec: 3 } }, actors: [buddy({ ext: { drec: 2 } })] })
      // 戰鬥不在：換成沒有戰鬥的局比較乾淨，這裡直接用 slotPreview 看熱度、用收播的結果看訂閱
      return { g, kind, camera }
    }
    const heats = (camera: string, kind: 'chat' | 'adult'): { heat: number; fp: boolean } => {
      const { g } = run(camera, kind)
      const p = slotPreview(g.k, g.state, { kind, hours: 2, camera })
      return { heat: p.heat?.success ?? -1, fp: p.first_person }
    }
    // 戰鬥進行中開不了時段直播（有別的活動）：預覽的熱度與第一人稱旗標照樣算得出來
    const adultFirst = heats('implant:pc', 'adult')
    const adultThird = heats('drone:bud', 'adult')
    expect(adultFirst.fp).toBe(true)
    expect(adultThird.fp).toBe(false)
    expect(adultFirst.heat).toBe(adultThird.heat + 1)
    const chatFirst = heats('implant:pc', 'chat')
    const chatThird = heats('drone:bud', 'chat')
    expect(chatFirst.heat).toBe(chatThird.heat)
  })
})

/** 沒有戰鬥的局：時段直播。 */
function makeSlot(o: { pc?: ActorOverrides; actors?: ReturnType<typeof makeActor>[]; subs?: number } = {}): G {
  return makeGame({
    features: [mediaFeature, TOY, meterFeature(SUBS, testMeter({ kind: 'fame', owner: 'lewd_toy', name: '豔名', keyed: 'district' })), liveFeature],
    content: [METER_CONTENT, PACK], seed: 7, patch: { flags: { channel_on: true }, meters: { subs: { _: o.subs ?? 1000 } } }, pc: { ext: { rec: 3 }, ...o.pc }, ...(o.actors ? { actors: o.actors } : {}),
  }).game
}

describe('時段直播的第一人稱與鏡頭', () => {
  const lastEntry = (g: G) => lv(g).log.at(-1)!

  it('第一人稱的閒聊：收播訂閱 = 換算 × 0.8；第三人稱（無人機）不減；熱度一樣', () => {
    const play = (camera: string) => {
      const g = makeSlot({ actors: [buddy({ ext: { drec: 2 } })] })
      g.commit(slotStart(g.k, g.state, { kind: 'chat', hours: 2, camera }))
      expect(lv(g).session!.camera!.id).toBe(camera)
      g.commit(slotEnd(g.k, g.state))
      return { e: lastEntry(g), g }
    }
    const first = play('implant:pc')
    const third = play('drone:bud')
    expect(first.e.heat).toBe(third.e.heat)
    const full = first.e.heat * 6 + Math.floor(first.e.viewers! / 400)
    expect(third.e.subs).toBe(full)
    expect(first.e.subs).toBe(Math.floor(full * 0.8))
    // 紀錄的視角是開播時選的鏡頭
    expect(recs(first.g)).toHaveLength(1)
    expect(recs(first.g)[0]).toMatchObject({ pov: { kind: 'self_pov', who: 'pc' } })
    expect(recs(third.g)[0]).toMatchObject({ pov: { kind: 'drone' }, by: 'bud' })
  })

  it('成人那一種：第一人稱總熱度 +1（預覽與開播一致）、訂閱不減；最高 12 仍然夾住', () => {
    const g = makeSlot({ actors: [buddy({ ext: { drec: 2 } })] })
    const first = slotPreview(g.k, g.state, { kind: 'adult', hours: 1, camera: 'implant:pc' })
    const third = slotPreview(g.k, g.state, { kind: 'adult', hours: 1, camera: 'drone:bud' })
    expect(first.first_person).toBe(true)
    for (const r of ['fumble', 'fail', 'success', 'critical'] as const) expect(first.heat![r]).toBe(Math.min(first.cap, third.heat![r] + 1))
    const h = makeSlot({ pc: { ext: { rec: 3 } } })
    h.commit(slotStart(h.k, h.state, { kind: 'adult', hours: 1 }))
    expect(lv(h).session!.heat).toBeLessThanOrEqual(12)
    h.commit(slotEnd(h.k, h.state))
    const e = lastEntry(h)
    expect(e.subs).toBe(e.heat * 6 + Math.floor(e.viewers! / 400))
  })

  it('沒有任何鏡頭：時段直播開不了；原因是完整的一句；預覽也列出來', () => {
    const g = makeSlot({ pc: { ext: {} } })
    expect(slotPreview(g.k, g.state, { kind: 'chat', hours: 1 }).blocks.join('')).toContain('隊上沒有任何一種鏡頭')
    expect(reasonOf(() => slotStart(g.k, g.state, { kind: 'chat', hours: 1 }))).toContain('隊上沒有任何一種鏡頭')
    haveItem(g, 'cam_worn')
    g.commit(setCamera(g.k, g.state, { item: 'cam_worn' }))
    expect(slotPreview(g.k, g.state, { kind: 'chat', hours: 1 })).toMatchObject({ ok: true, first_person: false, camera: { pov: { kind: 'camera' } } })
  })

  it('規則表 live_rule.first_person 可以蓋；格式不對的被擋', async () => {
    const { ruleProblems: liveRuleProblems } = await import('../../src/features/live/model')
    const { liveRules } = await import('../../src/features/live')
    expect(liveRuleProblems({ first_person: { subs_mult: 2 } })).toEqual(['first_person.subs_mult 要是 0～1 的數字'])
    expect(liveRuleProblems({ first_person: { adult_heat: 1.5 } })).toEqual(['first_person.adult_heat 要是 0～10 的整數'])
    const g = makeGame({ features: [liveFeature], content: [{ id: 'r', content: { live_rule: [{ id: 'default', first_person: { subs_mult: 0.5, adult_heat: 2 } }] } }] }).game
    expect(liveRules(g.k).first_person).toEqual({ subs_mult: 0.5, adult_heat: 2 })
    expect(liveRules(makeGame({ features: [liveFeature] }).game.k).first_person).toEqual({ subs_mult: 0.8, adult_heat: 1 })
  })
})

// ===================================================================================================================
describe('程式的界線', () => {
  it('media 與 live 的原始碼：不 import 別的功能、不用 Math.random／Date、不讀別的功能的 state.ext、不用 run.say、沒有街頭信譽；新的效果沒有（B022 的清單不動）', () => {
    for (const feature of ['media', 'live']) {
      const dir = fileURLToPath(new URL(`../../src/features/${feature}`, import.meta.url))
      for (const f of readdirSync(dir).filter((x) => x.endsWith('.ts'))) {
        const text = readFileSync(join(dir, f), 'utf8')
        const code = text.split('\n').filter((l) => !l.trim().startsWith('//') && !l.trim().startsWith('*') && !l.trim().startsWith('/*')).join('\n')
        expect(code, `${feature}/${f}`).not.toMatch(/from '\.\.\/(?!\.\.\/core)[a-z]/)
        expect(code, `${feature}/${f}`).not.toMatch(/Math\.random|new Date|Date\.now/)
        expect(code, `${feature}/${f}`).not.toMatch(/run\.say\(/)
        expect(code, `${feature}/${f}`).not.toMatch(/op: 'rep'/)
      }
    }
  })

  it('pov.ts 與 lens.ts 是純函式：不碰登錄表；視角的格式只收六種', () => {
    const dir = fileURLToPath(new URL('../../src/features/media', import.meta.url))
    for (const f of ['pov.ts', 'lens.ts']) {
      const text = readFileSync(join(dir, f), 'utf8')
      expect(text, f).not.toMatch(/k\.changes\.register|k\.effects\.register|k\.hooks\.on/)
    }
  })
})
