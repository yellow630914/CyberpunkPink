// 驗收測試：dev/work/M5-media-chain.md（cpp-feature）。媒體的一條鏈（前半）：紀錄的索引、錄影的開關、轉成素材、使用次數、三個掛點、效果 footage。
// 規格：MEDIA 1.1 節、第 2 節、2.1 節、第 6 節；EVENTS 2.4 節的 footage；DATA 第 11 節；dev/adr/0020 第一節、第十三節、V1～V6、V54、V57；
// 使用者 2026-11-24 裁決第 2、3 題（撤退與失敗收回的紀錄不限制轉成素材，撤退收回的品質 −1）。
// 內容一律用測試自帶的最小假資料：一個會給 rec_grade 的替身 provider（義體的被動效果的替身）、玩具活動（用 endActivity 發 activity.end）、假的里程碑報告。
// 一局：makeGame（只裝媒體與替身）；用全部功能的那一條走 makeBodyGame，錄影等級由真的義體的被動效果給。

import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import type { Actor, Change, ContentPack, Feature, GameState, Kernel, ReportDraft } from '../../src'
import { ActionBlocked, attachActivityEnd, effectCtx, endActivity, toMinutes } from '../../src'
import {
  DEFAULT_MEDIA_RULES, blankMedia, battleMarks, convertBlock, convertDraft, materialOf, materialsOf, mediaFeature, mediaRules, mediaView, qualityParts, readMedia, recStatus, recorderOf, setRecording, spend,
} from '../../src/features/media'
import { ruleProblems } from '../../src/features/media/model'
import { BATTLE_SETUPS, TEST_COMBAT, applyEffects, makeActor, makeBodyGame, makeGame, passTime, playOut } from '../../src/testkit'

type Rec = Record<string, any>
type G = ReturnType<typeof makeGame>['game']

// ===================================================================================================================
// 假資料與小工具
// ===================================================================================================================

/**
 * 替身：義體的被動效果的替身（角色 ext.rec 當 rec_grade、ext.fq 當 footage_quality、ext.fcap 當 footage_cap；media 自己不加任何 provider），
 * 加上這一局要查的幾種內容種類（世界功能的 district、facility_type、block、special_map、npc 在這裡不裝，只留格式）與豔名量表。
 */
const TOY: Feature = {
  id: 'rec_toy',
  install(k: Kernel) {
    for (const [stat, key] of [['rec_grade', 'rec'], ['footage_quality', 'fq'], ['footage_cap', 'fcap']] as const) {
      k.stats.addStatProvider(stat, 'rec_toy', (state, actor) => {
        const v = state.actors[actor]?.ext[key]
        return typeof v === 'number' ? [{ label: '測試義體', value: v, source: 'cyber' }] : []
      })
    }
    for (const kind of ['district', 'facility_type', 'block']) k.content.defineKind({ kind, owner: 'rec_toy', validate: () => [] })
    k.meters.define({ kind: 'fame', owner: 'rec_toy', name: '豔名', min: 0, max: 100, start: 0, keyed: 'district' })
  },
}

const PACK: ContentPack = {
  id: 'rec_toy_pack',
  content: {
    district: [{ id: 'd_a', name: '甲區' }, { id: 'd_b', name: '乙區' }, { id: 'd_nocam', name: '禁拍的區', no_rec: true }],
    facility_type: [{ id: 'fac_nocam', name: '禁拍的店', no_rec: true }, { id: 'fac_plain', name: '一般的店' }],
    block: [{ id: 'blk_nocam', name: '禁拍的街', no_rec: true }],
    npc: [{ id: 'npc_shy', name: '怕鏡頭的人', no_rec: true }, { id: 'npc_ok', name: '阿音' }],
    faction: [{ id: 'f_a', name: '星旗', short: '星旗', class: 'corp' }, { id: 'f_b', name: '蜂巢會', short: '蜂巢會', class: 'street' }],
  },
}

function make(o: { pc?: Rec; actors?: Actor[]; features?: Feature[]; content?: ContentPack[]; patch?: Partial<GameState> } = {}) {
  const t = makeGame({ features: [mediaFeature, TOY, TEST_COMBAT, ...(o.features ?? [])], content: [PACK, ...(o.content ?? [])], pc: { ext: { rec: 1 }, ...o.pc }, ...(o.actors ? { actors: o.actors } : {}), ...(o.patch ? { patch: o.patch } : {}) })
  return t.game
}

const sys = (changes: Change[], action = 'test.give', extra: Partial<ReportDraft> = {}): ReportDraft => ({ kind: 'system', action, location: {}, party: [], timeline: [], changes, outcome: { result: 'ok', summary: '測試。' }, ...extra })
const give = (g: G, changes: Change[]) => g.commit(sys(changes))
const media = (g: G) => readMedia(g.state)
const recs = (g: G) => Object.values(media(g).records)
const lastRec = (g: G) => recs(g).at(-1)!
const reasonOf = (fn: () => unknown): string => {
  try { fn() } catch (e) { if (e instanceof ActionBlocked) return e.message; throw e }
  return ''
}

/** 直接加一則紀錄（用 media.add 這條路，記號與錄影等級自己給；其餘預設）。回傳它的 id。 */
function addRec(g: G, o: Rec = {}): string {
  give(g, [{
    op: 'media.add',
    record: { at: toMinutes(g.state.time), source: { kind: 'battle', ref: 'bx' }, label: '一場測試的戰鬥', by: 'pc', grade: 1, type: 'battle', involves: { factions: [], people: [] }, marks: [], exclusive: true, ...o },
  }])
  return lastRec(g).id
}

/** 轉成素材，回傳那一段。 */
function convert(g: G, id: string) {
  g.commit(convertDraft(g.k, g.state, id))
  return media(g).footage[media(g).records[id]!.made!]!
}

/** 玩具活動結束：發 activity.end（kind、origin、outcome、result 照給的），處理函式回傳的東西併進那一份報告。 */
function endOf(g: G, kind: string, o: { id?: string; origin?: Rec; outcome?: string; result?: Rec } = {}): void {
  const end = endActivity(g.k, { state: g.state, kind, id: o.id ?? 'x1', origin: { by: 'test', ...o.origin }, outcome: o.outcome ?? 'done', result: o.result ?? {} })
  g.commit(attachActivityEnd(sys([...end.changes], `${kind}.end`), end))
}

/** 正在打的戰鬥直接定案（不必真的打完；之後的每一步照常經過提交），再走結算。 */
async function fight(g: G, outcome = 'win', setup = BATTLE_SETUPS.encounter()): Promise<void> {
  g.startBattle(setup)
  const b = structuredClone(g.state.battle!)
  b.result = { outcome, text: '結束。' }
  g.commit({ kind: 'combat', action: 'battle.step', location: {}, party: [], timeline: [], changes: [{ op: 'battle', state: b, step: true }], outcome: { result: outcome, summary: '結束。' } }, { attach: true, turn: false })
  await g.finishBattle()
}

/** 假的里程碑報告：timeline 帶一拍 commission.milestone。 */
function milestone(g: G, data: Rec): void {
  g.commit(sys([], 'commission.milestone', { timeline: [{ layer: 'meat', text: '階段做完。', tag: 'commission.milestone', data }] }))
}

const DAYS = (n: number): number => n * 1440

// ===================================================================================================================
describe('錄到一場戰鬥（MEDIA 1.1 節①；V2、V6）', () => {
  it('副本外打完一場：多一則 battle 的紀錄，by 是錄影等級最高的人，grade 是他的等級；錄影一開局是開著的', async () => {
    const g = make({ pc: { ext: { rec: 2 } } })
    expect(media(g).rec).toBe(true)
    await fight(g, 'win')
    expect(recs(g)).toHaveLength(1)
    const r = lastRec(g)
    expect(r).toMatchObject({ source: { kind: 'battle' }, type: 'battle', by: 'pc', grade: 2, exclusive: true })
    expect(r.id).toMatch(/^rc\d+$/)
    expect(r.label).toContain('測試用的倉庫')
    expect(r.marks).not.toContain('lost')
  })

  it('隊伍裡有兩個人有錄影：by 是 rec_grade 最高的那個', () => {
    const g = make({ actors: [makeActor({ id: 'bud', name: '夥伴', role: 'companion', ext: { rec: 4 } })] })
    expect(g.state.party).toEqual(['pc', 'bud'])
    expect(recorderOf(g.k, g.state)).toEqual({ id: 'bud', grade: 4 })
    expect(recStatus(g.k, g.state)).toEqual({ by: 'bud', grade: 4 })
    // 同分取排得前面的
    const g2 = make({ actors: [makeActor({ id: 'bud', name: '夥伴', role: 'companion', ext: { rec: 1 } })] })
    expect(recorderOf(g2.k, g2.state)).toEqual({ id: 'pc', grade: 1 })
  })

  it('關掉錄影再打一場：那一則照樣記，by 是 null、轉不了，原因是完整的一句', async () => {
    const g = make()
    g.commit(setRecording(g.k, g.state, false))
    expect(media(g).rec).toBe(false)
    await fight(g, 'win')
    const r = lastRec(g)
    expect(r).toMatchObject({ by: null, grade: 0, miss: 'off' })
    const why = convertBlock(g.k, g.state, r.id)
    expect(why).toContain('錄影是關著的')
    expect(why).toContain(r.label)
    expect(reasonOf(() => convertDraft(g.k, g.state, r.id))).toBe(why)
    expect(mediaView(g.k, g.state).records[0]).toMatchObject({ can: false, why, quality: null })
  })

  it('沒有人裝著錄影義體（rec_grade 全是 0）：by 是 null、原因是隊伍裡沒有人錄得到', async () => {
    const g = make({ pc: { ext: {} } })
    await fight(g, 'win')
    expect(lastRec(g)).toMatchObject({ by: null, miss: 'none' })
    expect(convertBlock(g.k, g.state, lastRec(g).id)).toContain('沒有人裝著錄影的義體')
  })

  it('錄影開關：已經是那個樣子丟 ActionBlocked；報告是 media.rec（kind broadcast）；開回來之後記的又錄得到', async () => {
    const g = make()
    expect(reasonOf(() => setRecording(g.k, g.state, true))).toBe('錄影本來就開著。')
    const [rep] = g.commit(setRecording(g.k, g.state, false))
    expect(rep).toMatchObject({ kind: 'broadcast', action: 'media.rec' })
    expect(reasonOf(() => setRecording(g.k, g.state, false))).toBe('錄影本來就是關著的。')
    g.commit(setRecording(g.k, g.state, true))
    await fight(g, 'win')
    expect(lastRec(g).by).toBe('pc')
  })

  it('戰鬥或副本進行中不能轉素材、不能開關錄影：沒有登記放行，原因是活動的那一句', () => {
    const g = make()
    const id = addRec(g)
    g.startBattle(BATTLE_SETUPS.encounter())
    expect(convertBlock(g.k, g.state, id)).toBe('正在戰鬥，先把這一場打完。')
    expect(reasonOf(() => setRecording(g.k, g.state, false))).toBe('正在戰鬥，先把這一場打完。')
    expect(() => g.commit(convertDraft(g.k, g.state, id))).toThrow(ActionBlocked)
  })

  it('輸掉的戰鬥記 lost（戰敗的畫面）；脫離不記', async () => {
    const g = make()
    await fight(g, 'fled')
    expect(lastRec(g).marks).not.toContain('lost')
    const g2 = make()
    await fight(g2, 'lose')
    expect(lastRec(g2).marks).toContain('lost')
  })

  it('戰鬥的記號從這一場的報告數：我方打出 crit 記 crit、我方打倒首領記 boss；敵人打出 crit、小兵倒下、我方倒下都不算', () => {
    const beat = (tag: string, data: Rec) => ({ layer: 'meat', text: '一拍', tag, data })
    const reports = [
      { id: 'r1', timeline: [beat('crit', { attacker: 'f1' }), beat('down', { target: 'a2', side: 'ally', rank: 'boss' }), beat('down', { target: 'f2', side: 'foe', rank: 'minion' })] },
      { id: 'r9', timeline: [beat('crit', { attacker: 'a1' })] },
    ] as unknown as GameState['reports']
    const b = { steps: ['r1'], units: { a1: { side: 'ally' }, f1: { side: 'foe' } } } as never
    expect(battleMarks({ reports }, b, 'win')).toEqual([])
    const reports2 = [{ id: 'r1', timeline: [beat('crit', { attacker: 'a1' }), beat('down', { target: 'f3', side: 'foe', rank: 'boss' })] }] as unknown as GameState['reports']
    expect(battleMarks({ reports: reports2 }, { steps: ['r1'], units: { a1: { side: 'ally' } } } as never, 'win').sort()).toEqual(['boss', 'crit'])
    expect(battleMarks({ reports: reports2 }, { steps: ['r1'], units: { a1: { side: 'ally' } } } as never, 'surrender')).toContain('lost')
  })

  it('真的打一場首領戰：記號只可能是 crit、boss、lost；標題寫地點與對手', async () => {
    const g = make()
    g.startBattle(BATTLE_SETUPS.boss())
    playOut(g)
    await g.finishBattle()
    const r = lastRec(g)
    expect(r.marks.every((m) => ['crit', 'boss', 'lost'].includes(m))).toBe(true)
    expect(r.label).toContain('測試用的頂樓')
  })
})

// ===================================================================================================================
describe('委託副本：階段的暫存與里程碑（V2）', () => {
  const inCommission = (extra: Rec = {}): Rec => ({ by: 'commission', ref: 'cm1', ext: { commission: 'cm1', stage: 1, face: 'meat', ...extra } })

  it('帶 origin.ext.commission 的兩場戰鬥加一件事件，之後一份帶 commission.milestone 那一拍的報告：只多一則 stage 的紀錄，記號是兩場與事件的聯集', async () => {
    const g = make()
    await fight(g, 'win', { ...BATTLE_SETUPS.encounter(), origin: { escapable: false, ext: { by: 'commission', ref: 'cm1', commission: 'cm1', stage: 1, face: 'meat', record: { celebrity: true } } } })
    await fight(g, 'win', { ...BATTLE_SETUPS.encounter(), origin: { escapable: false, ext: { by: 'commission', ref: 'cm1', commission: 'cm1', stage: 1, face: 'meat', record: { hq: true, involves: { factions: ['f_a'] } } } } })
    endOf(g, 'event', { origin: inCommission({ record: { self: true } }), result: { event: 'ev_gate', option: 'a', flags: [], stage: 1, version: 'default' } })
    expect(recs(g)).toHaveLength(0)
    expect(media(g).stage).toMatchObject({ commission: 'cm1' })
    expect(media(g).stage!.marks.sort()).toEqual(['celebrity', 'hq', 'self'])
    milestone(g, { id: 'cm1', stage: 1, face: 'meat', faction: 'f_b', grade: 2 })
    expect(recs(g)).toHaveLength(1)
    const r = lastRec(g)
    expect(r).toMatchObject({ source: { kind: 'stage', ref: 'cm1' }, type: 'battle', by: 'pc' })
    expect([...r.marks].sort()).toEqual(['celebrity', 'hq', 'self'])
    expect([...r.involves.factions].sort()).toEqual(['f_a', 'f_b'])
    expect(media(g).stage).toBeNull()
  })

  it('內海面的階段是罪證類；那一拍的 record.type 蓋掉預設；沒有暫存也出一則（照那一拍的資料）', () => {
    const g = make()
    milestone(g, { id: 'cm1', stage: 2, face: 'net', faction: 'none' })
    expect(lastRec(g)).toMatchObject({ type: 'crime', source: { kind: 'stage' } })
    expect(lastRec(g).involves.factions).toEqual([])
    milestone(g, { id: 'cm1', stage: 3, face: 'meat', record: { type: 'scandal', celebrity: true } })
    expect(lastRec(g)).toMatchObject({ type: 'scandal' })
    expect(lastRec(g).marks).toContain('celebrity')
    expect(recs(g)).toHaveLength(2)
  })

  it('輿論面的階段不出紀錄，暫存清掉；另一件委託留下的暫存不接著用', async () => {
    const g = make()
    endOf(g, 'event', { origin: inCommission(), result: { event: 'ev1' } })
    expect(media(g).stage).not.toBeNull()
    milestone(g, { id: 'cm1', stage: 1, face: 'opinion', faction: 'f_a' })
    expect(recs(g)).toHaveLength(0)
    expect(media(g).stage).toBeNull()
    // 另一件委託的暫存
    endOf(g, 'event', { origin: { by: 'commission', ext: { commission: 'cm_old', record: { hq: true } } }, result: { event: 'ev2' } })
    milestone(g, { id: 'cm2', stage: 1, face: 'meat' })
    expect(recs(g)).toHaveLength(1)
    expect(lastRec(g).marks).not.toContain('hq')
    expect(media(g).stage).toBeNull()
  })

  it('不帶 commission 的事件、場景各出一則（V2）；帶了的不出', () => {
    const g = make()
    endOf(g, 'event', { origin: { by: 'director' }, result: { event: 'ev_rain' } })
    expect(lastRec(g)).toMatchObject({ source: { kind: 'event', ref: 'ev_rain' }, type: 'daily', label: 'ev_rain' })
    endOf(g, 'scene', { origin: { by: 'director' }, result: { with: 'npc_ok', rating: '不錯', touched: ['t_a', 't_b'] } })
    expect(recs(g)).toHaveLength(2)
  })
})

// ===================================================================================================================
describe('成人場景的紀錄（V4、V57）', () => {
  it('場景記 adult、self；一對一涉及的人是對象，多人讀 pairs 的每一個；單人沒有對象；類型是親密；碰過的標籤帶進紀錄', () => {
    const g = make()
    endOf(g, 'scene', { result: { with: 'npc_ok', touched: ['x_tag'] } })
    expect(lastRec(g)).toMatchObject({ type: 'intimate', marks: ['adult', 'self'], involves: { people: ['npc_ok'] }, tags: ['x_tag'] })
    expect(lastRec(g).label).toContain('阿音')
    endOf(g, 'scene', { result: { with: 'npc_ok', pairs: { npc_ok: {}, npc_b: {} } } })
    expect(lastRec(g).involves.people.sort()).toEqual(['npc_b', 'npc_ok'])
    endOf(g, 'scene', { result: { solo: true, pace: 4 } })
    expect(lastRec(g)).toMatchObject({ involves: { people: [] }, label: '一個人的場景' })
  })

  it('內海的場景（result.layer 是 net）照樣記', () => {
    const g = make()
    endOf(g, 'scene', { result: { with: 'npc_ok', layer: 'net' } })
    expect(recs(g)).toHaveLength(1)
  })

  it('失憶的場景（result.amnesia）不留紀錄：那段畫面不歸你', () => {
    const g = make()
    endOf(g, 'scene', { result: { with: 'npc_ok', amnesia: true } })
    expect(recs(g)).toHaveLength(0)
  })

  it('對象不准錄（內容的 no_rec）：照樣記，by 是 null、原因是不准錄', () => {
    const g = make()
    endOf(g, 'scene', { result: { with: 'npc_shy' } })
    expect(lastRec(g)).toMatchObject({ by: null, miss: 'banned' })
    expect(convertBlock(g.k, g.state, lastRec(g).id)).toContain('不准錄')
  })
})

// ===================================================================================================================
describe('不准錄的地方（V6）：no_rec', () => {
  it.each([
    ['設施的種類', { facility: 'fac_nocam' }],
    ['街區', { block: 'blk_nocam' }],
  ])('%s標了 no_rec：那一則照樣記，沒錄到', (_n, loc) => {
    const g = make({ patch: { location: { district: 'd_a', ...loc } } as Partial<GameState> })
    endOf(g, 'event', { result: { event: 'ev1' } })
    expect(lastRec(g)).toMatchObject({ by: null, grade: 0, miss: 'banned' })
  })

  it('區標了 no_rec、所在的地圖模板標了 no_rec（special_map）：也沒錄到；離開那張地圖又錄得到', () => {
    const g = make({ patch: { location: { district: 'd_nocam' } } as Partial<GameState> })
    endOf(g, 'event', { result: { event: 'ev1' } })
    expect(lastRec(g)).toMatchObject({ by: null, miss: 'banned' })
    const map = { id: 'map_nocam', kind: 'test', size: [5, 3], no_rec: true, sheets: [{ id: 'f1', name: '一樓', size: [5, 3], layout: ['#####', 'E12..', '#####'], cells: [{ id: 'E1', at: [0, 1], mark: 'E', name: '門' }], spots: [{ id: '!1', at: [1, 1], cover: 'medium' }, { id: '!2', at: [2, 1], cover: 'sparse' }] }] }
    const g2 = make({ content: [{ id: 'maps', content: { special_map: [map] } }] })
    g2.enterMap('map_nocam')
    endOf(g2, 'event', { result: { event: 'ev1' } })
    expect(lastRec(g2)).toMatchObject({ by: null, miss: 'banned' })
  })

  it('一般的設施照樣錄；hint 直接說 no_rec 也算（media.record）', () => {
    const g = make({ patch: { location: { district: 'd_a', facility: 'fac_plain' } } as Partial<GameState> })
    endOf(g, 'event', { result: { event: 'ev1' } })
    expect(lastRec(g).by).toBe('pc')
    give(g, g.k.hooks.run('media.record', { state: g.state, source: { kind: 'x' }, label: '一件事', hint: { no_rec: true } }).flatMap((r) => r.result))
    expect(lastRec(g)).toMatchObject({ by: null, miss: 'banned' })
  })

  it('條件 rec_on：開著、有人錄得到、這裡准錄才成立', () => {
    const g = make({ patch: { location: { district: 'd_a', facility: 'fac_plain' } } as Partial<GameState> })
    const ctx = () => ({ state: g.state, stats: g.k.stats, timeRules: g.k.timeRules })
    expect(g.k.conditions.test({ kind: 'rec_on' }, ctx())).toBe(true)
    g.commit(setRecording(g.k, g.state, false))
    expect(g.k.conditions.test({ kind: 'rec_on' }, ctx())).toBe(false)
    expect(g.k.conditions.explain({ kind: 'rec_on' }, ctx())).toContain('正在錄影')
    g.commit(setRecording(g.k, g.state, true))
    give(g, [{ op: 'actor.ext', id: 'pc', key: 'rec', value: 0 }])
    expect(g.k.conditions.test({ kind: 'rec_on' }, ctx())).toBe(false)
  })
})

// ===================================================================================================================
describe('品質（V5）：一項一項對', () => {
  const q = (g: G, id: string) => qualityParts(g.k, g.state, media(g).records[id]!)

  it('錄影等級 I、III、V：+0、+1、+2（II 與 IV 不多加）', () => {
    const got = [1, 2, 3, 4, 5].map((grade) => {
      const g = make()
      return q(g, addRec(g, { grade })).value
    })
    // 起點 1：I～II 是 1、III～IV 是 2、V 是 3（上限 3）
    expect(got).toEqual([1, 1, 2, 2, 3])
  })

  it('亮點：crit、boss、celebrity 任一個 +1，同時有也只加一次', () => {
    const g = make()
    const base = q(g, addRec(g, { grade: 1 })).value
    for (const mark of ['crit', 'boss', 'celebrity']) expect(q(g, addRec(g, { grade: 1, marks: [mark] })).value).toBe(base + 1)
    expect(q(g, addRec(g, { grade: 1, marks: ['crit', 'boss', 'celebrity'] })).value).toBe(base + 1)
  })

  it('基本功（隊伍裡表演或調查最高的一項）：2 不加、3 加 1、5 加 2', () => {
    const results: number[] = []
    for (const level of [2, 3, 5]) {
      const g = make({ pc: { ext: { rec: 1, fcap: 2 }, skills: { perform: level } } })
      results.push(q(g, addRec(g, { grade: 1 })).value)
    }
    expect(results).toEqual([1, 2, 3])
    const g = make({ pc: { ext: { rec: 1 }, skills: { perform: 1, investigate: 3 } } })
    expect(q(g, addRec(g, { grade: 1 })).value).toBe(2)
  })

  it('高品質記號 +1；footage_quality 加上去；每一項都在 parts 裡', () => {
    const g = make({ pc: { ext: { rec: 1, fq: 1 } } })
    const r = q(g, addRec(g, { grade: 1, marks: ['hq'] }))
    expect(r.value).toBe(3)
    expect(r.parts.map((p) => p.label)).toEqual(expect.arrayContaining(['基本', '高品質', '剪輯的功夫']))
  })

  it('紀錄超過 7 天才轉：−1（剛好 7 天不扣）；戰敗的畫面 −1；撤退收回的 −1（失敗收回的不扣）', () => {
    // 錄影 V（+2）加亮點（+1）= 4，上限放到 5：每一項扣 1 看得出來
    const g = make({ pc: { ext: { rec: 5, fcap: 2 } } })
    const o = { grade: 5, marks: ['crit'] }
    const fresh = addRec(g, o)
    const lost = addRec(g, { grade: 5, marks: ['crit', 'lost'] })
    const retreat = addRec(g, { ...o, retracted: true, retreat: true })
    const failed = addRec(g, { ...o, retracted: true })
    expect([fresh, lost, retreat, failed].map((id) => q(g, id).value)).toEqual([4, 3, 3, 4])
    passTime(g, DAYS(7))
    expect(q(g, fresh).value).toBe(4)
    passTime(g, 1)
    expect([fresh, lost, retreat, failed].map((id) => q(g, id).value)).toEqual([3, 2, 2, 3])
    expect(q(g, fresh).parts.find((p) => p.label === '紀錄放太久')).toEqual({ label: '紀錄放太久', value: -1 })
  })

  it('上限 = 3 + footage_cap：cap 是 0、1、2 的時候，加滿也只到 3、4、5；沒有主播的隊伍最高 3', () => {
    const got = [0, 1, 2].map((cap) => {
      const g = make({ pc: { ext: { rec: 5, fcap: cap, fq: 3 }, skills: { perform: 5 } } })
      const r = q(g, addRec(g, { grade: 5, marks: ['crit', 'hq'] }))
      return [r.cap, r.value]
    })
    expect(got).toEqual([[3, 3], [4, 4], [5, 5]])
  })

  it('下限 1：什麼都沒有而且又舊又戰敗也不會低於 1', () => {
    const g = make()
    const id = addRec(g, { grade: 1, marks: ['lost'], retreat: true })
    passTime(g, DAYS(30))
    expect(q(g, id).value).toBe(1)
  })

  it('規則表蓋掉預設：quality.hq 改成 2、uses 改成 2', () => {
    const pack: ContentPack = { id: 'rules', content: { media_rule: [{ id: 'default', quality: { hq: 2 }, uses: 2 }] } }
    const g = make({ content: [pack] })
    expect(mediaRules(g.k).quality.hq).toBe(2)
    expect(mediaRules(g.k).quality.base).toBe(DEFAULT_MEDIA_RULES.quality.base)
    const f = convert(g, addRec(g, { grade: 1, marks: ['hq'] }))
    expect(f).toMatchObject({ quality: 3, uses: 2 })
  })

  it('規則表的格式檢查：不認得的類型、超出範圍的數字、new 比 ok 大都不收', () => {
    expect(ruleProblems({ source_type: { battle: 'nope' } }).join()).toContain('source_type.battle')
    expect(ruleProblems({ quality: { base: 99 } }).join()).toContain('quality.base')
    expect(ruleProblems({ fresh_days: { new: 9, ok: 3 } }).join()).toContain('fresh_days.new')
    expect(ruleProblems({ uses: 0 }).join()).toContain('uses')
    expect(ruleProblems({})).toEqual([])
    expect(ruleProblems({ source_type: { stage: 'crime' }, quality: { rec_steps: [[2, 1]] }, old_days: 3 })).toEqual([])
  })
})

// ===================================================================================================================
describe('轉成素材（MEDIA 1.1 節②、第 2 節、2.1 節）', () => {
  it('一則只能轉一次；轉出來的素材 3 次、真的、獨家照那一則；報告是 media.convert（kind broadcast）；說明不帶數字', () => {
    const g = make()
    const id = addRec(g, { grade: 3, marks: ['crit', 'celebrity'], involves: { factions: ['f_a'], people: ['npc_ok'] }, tags: ['x_tag'] })
    const [rep] = g.commit(convertDraft(g.k, g.state, id))
    expect(rep).toMatchObject({ kind: 'broadcast', action: 'media.convert' })
    expect(rep!.narration!.results!.join('')).not.toMatch(/\d/)
    expect(rep!.timeline[0]!.data).toMatchObject({ record: id, quality: 3, uses: 3 })
    const rec = media(g).records[id]!
    expect(rec.made).toMatch(/^ft\d+$/)
    const f = media(g).footage[rec.made!]!
    expect(f).toMatchObject({ from_record: id, type: 'battle', quality: 3, authentic: 'real', exclusive: true, uses: 3, origin: 'own', celebrity: true, self: false, adult: false, tags: ['x_tag'], involves: { factions: ['f_a'], people: ['npc_ok'] } })
    expect(f.made_at).toBe(toMinutes(g.state.time))
    expect(f.title).toBe('一場測試的戰鬥')
    expect(f.text).toContain('拍到了要害的一擊')
    expect(convertBlock(g.k, g.state, id)).toContain('已經轉成素材了')
    expect(reasonOf(() => convertDraft(g.k, g.state, id))).toContain('一則紀錄只能轉一次')
    expect(Object.keys(media(g).footage)).toHaveLength(1)
  })

  it('沒有這則紀錄：一句原因；素材不進背包、不給街頭信譽', () => {
    const g = make()
    expect(convertBlock(g.k, g.state, 'rc99')).toBe('沒有這則紀錄。')
    const id = addRec(g)
    const before = JSON.stringify([g.state.inventory, g.state.meters])
    convert(g, id)
    expect(JSON.stringify([g.state.inventory, g.state.meters])).toBe(before)
  })

  it('品質在轉的時候就定了，之後不隨時間變；新鮮度 3 天內 new、7 天內 ok、之後 old（剛好 3 天、7 天仍算那一格）', () => {
    const g = make()
    const f = convert(g, addRec(g, { grade: 3 }))
    const fresh = () => materialOf(g.k, g.state, f.id)!
    expect(fresh()).toMatchObject({ fresh: 'new', quality: 2 })
    passTime(g, DAYS(3))
    expect(fresh().fresh).toBe('new')
    passTime(g, 1)
    expect(fresh().fresh).toBe('ok')
    passTime(g, DAYS(4) - 1)
    expect(fresh().fresh).toBe('ok')
    passTime(g, 1)
    expect(fresh()).toMatchObject({ fresh: 'old', quality: 2 })
    expect(media(g).footage[f.id]!.quality).toBe(2)
  })

  it('撤退或失敗收回的紀錄不限制（使用者 2026-11-24）：照樣轉得了', () => {
    const g = make()
    expect(convertBlock(g.k, g.state, addRec(g, { retracted: true }))).toBeNull()
    expect(convertBlock(g.k, g.state, addRec(g, { retracted: true, retreat: true }))).toBeNull()
  })

  it('素材的算式：看點 = 品質（涉及名人 +1）；可信 = 品質 × 2，偽造 −3，夾 0～10；風險 2、偽造再 +5；card 是 fuel、值是看點', () => {
    const g = make({ pc: { ext: { rec: 5, fcap: 2, fq: 3 } } })
    const real = convert(g, addRec(g, { grade: 5, marks: ['crit'], type: 'crime' }))
    expect(materialOf(g.k, g.state, real.id)).toMatchObject({ quality: 5, draw: 5, trust: 10, risk: 2, forged: false, card: { kind: 'fuel', value: 5 }, kind: 'footage', types: ['crime'], tags: [] })
    const star = convert(g, addRec(g, { grade: 1, marks: ['celebrity'] }))
    expect(materialOf(g.k, g.state, star.id)).toMatchObject({ celebrity: true, draw: star.quality + 1, trust: star.quality * 2 })
    // 偽造的（內建的效果給）
    expect(applyEffects(g, [{ kind: 'footage', type: 'scandal', quality: 4, forged: true }]).errors).toEqual([])
    const forged = Object.values(media(g).footage).find((f) => f.authentic === 'forged')!
    expect(materialOf(g.k, g.state, forged.id)).toMatchObject({ forged: true, trust: 5, risk: 7, quality: 4 })
  })

  it('親密類的看點加主角各區豔名最高那一區的級數（每 30 點一級）', () => {
    const g = make()
    const f = convert(g, addRec(g, { grade: 1, type: 'intimate' }))
    const draw = () => materialOf(g.k, g.state, f.id)!.draw
    expect(draw()).toBe(1)
    give(g, [{ op: 'meter', kind: 'fame', key: 'd_a', set: 29 }, { op: 'meter', kind: 'fame', key: 'd_b', set: 60 }])
    expect(draw()).toBe(1 + 2)
    give(g, [{ op: 'meter', kind: 'fame', key: 'd_b', set: 29 }])
    expect(draw()).toBe(1)
    give(g, [{ op: 'meter', kind: 'fame', key: 'd_a', set: 30 }])
    expect(draw()).toBe(2)
    // 其他類型不加
    const b = convert(g, addRec(g, { grade: 1, type: 'battle' }))
    expect(materialOf(g.k, g.state, b.id)!.draw).toBe(1)
  })
})

// ===================================================================================================================
describe('用掉一件（掛點 media.spend）與問素材庫（media.materials）', () => {
  const ask = (g: G, ref: string, o: { all?: boolean; how?: string } = {}) =>
    g.k.hooks.run('media.spend', { state: g.state, ref, how: o.how ?? 'post', ...(o.all !== undefined ? { all: o.all } : {}) })[0]!.result as { changes: Change[]; material: Rec } & { block?: string }
  const usesOf = (g: G, ref: string): number => media(g).footage[ref]!.uses

  it('扣 1：回傳的 material 是扣完之後的樣子；變更沒套用以前狀態不變，套用之後次數才少', () => {
    const g = make()
    const f = convert(g, addRec(g))
    const before = JSON.stringify(g.state)
    const r = ask(g, f.id)
    expect(r.material).toMatchObject({ ref: f.id, uses: 2 })
    expect(JSON.stringify(g.state)).toBe(before)
    expect(usesOf(g, f.id)).toBe(3)
    give(g, r.changes)
    expect(usesOf(g, f.id)).toBe(2)
  })

  it('一路扣到 0：3 → 2 → 1 → 0；0 次被擋，原因是一句完整的話；用完的還留在庫裡', () => {
    const g = make()
    const f = convert(g, addRec(g))
    for (const n of [2, 1, 0]) {
      give(g, ask(g, f.id).changes)
      expect(usesOf(g, f.id)).toBe(n)
    }
    const r = ask(g, f.id)
    expect(r.block).toBe('「一場測試的戰鬥」已經用完了，只能留著當紀念。')
    expect(media(g).footage[f.id]).toBeDefined()
    expect(ask(g, 'ft999').block).toBe('素材庫裡沒有這件料。')
  })

  it('all 扣光（賣斷、勒索）；剩 1 次也扣得掉', () => {
    const g = make()
    const f = convert(g, addRec(g))
    give(g, ask(g, f.id).changes)
    give(g, ask(g, f.id).changes)
    expect(usesOf(g, f.id)).toBe(1)
    const r = ask(g, f.id, { all: true })
    expect(r.material.uses).toBe(0)
    give(g, r.changes)
    expect(usesOf(g, f.id)).toBe(0)
  })

  it('同一份報告用掉好幾件、同一件用兩次：變更疊得起來，不互相蓋掉', () => {
    const g = make()
    const a = convert(g, addRec(g))
    const b = convert(g, addRec(g))
    give(g, [...ask(g, a.id).changes, ...ask(g, b.id).changes, ...ask(g, b.id).changes])
    expect(usesOf(g, a.id)).toBe(2)
    expect(usesOf(g, b.id)).toBe(1)
  })

  it('變更自己也守著：用完的再扣、不存在的整份報告不收，狀態不變', () => {
    const g = make()
    const f = convert(g, addRec(g))
    const fresh = convert(g, addRec(g))
    give(g, [{ op: 'media.use', ref: f.id, take: 'all' }])
    const before = JSON.stringify(g.state)
    expect(() => give(g, [{ op: 'media.use', ref: f.id, take: 1 }])).toThrow(/已經用完了/)
    expect(() => give(g, [{ op: 'media.use', ref: 'ft77', take: 1 }])).toThrow(/沒有 ft77/)
    expect(() => give(g, [{ op: 'media.use', ref: fresh.id, take: 0 }])).toThrow(/take/)
    expect(() => give(g, [{ op: 'media.use', ref: fresh.id, take: 1.5 }])).toThrow(/take/)
    expect(JSON.stringify(g.state)).toBe(before)
  })

  it('media.materials 不列 0 次的；kinds 只要片就沒有（片是下一張）；mediaView 全列，用完的標成 spent', () => {
    const g = make()
    const a = convert(g, addRec(g))
    const b = convert(g, addRec(g, { type: 'crime' }))
    give(g, [{ op: 'media.use', ref: a.id, take: 'all' }])
    const list = (kinds?: Array<'footage' | 'clip'>) => g.k.hooks.run('media.materials', { state: g.state, ...(kinds ? { kinds } : {}) })[0]!.result as Rec[]
    expect(list().map((m) => m.ref)).toEqual([b.id])
    expect(list(['clip'])).toEqual([])
    expect(list(['footage', 'clip']).map((m) => m.ref)).toEqual([b.id])
    expect(materialsOf(g.k, g.state).map((m) => m.ref)).toEqual([b.id])
    const view = mediaView(g.k, g.state)
    expect(view.footage.map((f) => [f.ref, f.spent, f.uses]).sort()).toEqual([[a.id, true, 0], [b.id, false, 3]].sort())
    expect(view.clips).toEqual([])
  })

  it('一件料用的次數 spend 與掛點同一份：直接呼叫匯出的 spend 結果相同', () => {
    const g = make()
    const f = convert(g, addRec(g))
    expect(spend(g.k, g.state, { ref: f.id, how: 'post' })).toEqual(ask(g, f.id))
  })
})

// ===================================================================================================================
describe('效果 footage（EVENTS 2.4 節）', () => {
  const ctx = (g: G, source: 'builtin' | 'ai') => effectCtx(g.k, g.state, { source })

  it('內建的照寫：類型、品質、標題、涉及的勢力、偽造、來歷；3 次；來歷預設 event；不進背包', () => {
    const g = make()
    const r = applyEffects(g, [{ kind: 'footage', type: 'crime', quality: 4, title: '倉庫裡的十分鐘', involves: { factions: ['f_a'], people: ['npc_ok'] }, exclusive: false, origin: 'stolen' }])
    expect(r.errors).toEqual([])
    const f = Object.values(media(g).footage)[0]!
    expect(f).toMatchObject({ type: 'crime', quality: 4, title: '倉庫裡的十分鐘', authentic: 'real', exclusive: false, uses: 3, origin: 'stolen', involves: { factions: ['f_a'], people: ['npc_ok'] } })
    expect(g.state.inventory).toEqual([])
    applyEffects(g, [{ kind: 'footage', type: 'daily' }])
    const d = Object.values(media(g).footage)[1]!
    expect(d).toMatchObject({ quality: 2, origin: 'event', exclusive: true, uses: 3 })
    expect(d.title).toContain('日常')
    const res = g.k.effects.resolve([{ kind: 'footage', type: 'crime', title: '一段' }], ctx(g, 'builtin'))
    expect(res.lines).toEqual(['拿到一段素材：「一段」。'])
  })

  it('內建的來源不被封閉清單的上限管：給兩段、品質 5 都照收', () => {
    const g = make()
    const res = g.k.effects.resolve([{ kind: 'footage', type: 'crime', quality: 5 }, { kind: 'footage', type: 'scandal', quality: 5 }], ctx(g, 'builtin'))
    expect(res.errors).toEqual([])
    expect(res.changes).toHaveLength(2)
    expect(res.clamps).toEqual([])
  })

  it('AI 的來源：一件事給兩段只收一段（留第一段），品質超過所在那一區的等級就被夾', () => {
    const g = make()
    expect(g.k.effects.aiKinds()).toContain('footage')
    const res = g.k.effects.resolve([{ kind: 'footage', type: 'crime', quality: 5 }, { kind: 'footage', type: 'scandal', quality: 2 }], ctx(g, 'ai'))
    expect(res.errors).toEqual([])
    expect(res.changes).toHaveLength(1)
    expect(res.effects[0]).toMatchObject({ type: 'crime', quality: 1 })
    expect(res.clamps.map((c) => c.notice).join()).toContain('一件事最多給一段素材')
    expect(res.clamps.map((c) => c.notice).join()).toContain('品質降到這一區的等級')
    // 區的等級高：品質照寫，上限是區的等級
    const hi = effectCtx(g.k, g.state, { source: 'ai', grade: 3 })
    expect(g.k.effects.resolve([{ kind: 'footage', type: 'crime', quality: 5 }], hi).effects[0]).toMatchObject({ quality: 3 })
    expect(g.k.effects.resolve([{ kind: 'footage', type: 'crime', quality: 2 }], hi).effects[0]).toMatchObject({ quality: 2 })
  })

  it('格式：不認得的類型、品質 0、標題太長、不存在的勢力、不認得的欄位都整批不收', () => {
    const g = make()
    const bad = (e: Rec): string => g.k.effects.resolve([{ kind: 'footage', type: 'crime', ...e }], ctx(g, 'builtin')).errors.join('；')
    expect(bad({ type: 'nope' })).toContain('type')
    expect(bad({ quality: 0 })).toContain('quality')
    expect(bad({ quality: 6 })).toContain('quality')
    expect(bad({ title: 'x'.repeat(61) })).toContain('title')
    expect(bad({ involves: { factions: ['f_none'] } })).toContain('查不到勢力')
    expect(bad({ origin: 'dream' })).toContain('origin')
    expect(bad({ uses: 9 })).toContain('uses')
    expect(bad({ forged: 'yes' })).toContain('forged')
  })

  it('條件 has_footage：勢力、類型、最低品質、還能用；不寫條件的欄位就不看；說明句寫完整的要什麼', () => {
    const g = make()
    const ctxc = () => ({ state: g.state, stats: g.k.stats, timeRules: g.k.timeRules })
    const has = (c: Rec): boolean => g.k.conditions.test({ kind: 'has_footage', ...c }, ctxc())
    expect(has({})).toBe(false)
    applyEffects(g, [{ kind: 'footage', type: 'crime', quality: 3, involves: { factions: ['f_a'] } }])
    expect(has({})).toBe(true)
    expect(has({ faction: 'f_a' })).toBe(true)
    expect(has({ faction: 'f_b' })).toBe(false)
    expect(has({ type: 'crime', min_quality: 3 })).toBe(true)
    expect(has({ type: 'scandal' })).toBe(false)
    expect(has({ min_quality: 4 })).toBe(false)
    const ref = Object.keys(media(g).footage)[0]!
    give(g, [{ op: 'media.use', ref, take: 'all' }])
    expect(has({ faction: 'f_a' })).toBe(true)
    expect(has({ faction: 'f_a', usable: true })).toBe(false)
    expect(g.k.conditions.explain({ kind: 'has_footage', faction: 'f_b', type: 'crime', min_quality: 3, usable: true }, ctxc())).toBe('要有一段涉及蜂巢會的罪證類的素材（品質 3 以上），而且還能用')
    expect(g.k.conditions.validate({ kind: 'has_footage', type: 'x' })).not.toEqual([])
    expect(g.k.conditions.validate({ kind: 'has_footage', min_quality: 9 })).not.toEqual([])
  })
})

// ===================================================================================================================
describe('掛點 media.record（直播之類請它記）', () => {
  const rec = (g: G, hint: Rec | undefined, source: Rec = { kind: 'live', ref: 'lv1' }) =>
    give(g, g.k.hooks.run('media.record', { state: g.state, source: source as never, label: '一場直播', ...(hint ? { hint } : {}) }).flatMap((r) => r.result))

  it('帶 live、hq：那一則 exclusive 是 false、類型照來源的預設（日常）；轉出來的品質 +1', () => {
    const g = make()
    rec(g, { live: true, hq: true })
    const a = lastRec(g)
    expect(a).toMatchObject({ source: { kind: 'live', ref: 'lv1' }, type: 'daily', exclusive: false, by: 'pc' })
    expect(a.marks.sort()).toEqual(['hq', 'live'])
    rec(g, { live: true })
    const b = lastRec(g)
    expect(b.exclusive).toBe(false)
    expect(convert(g, a.id).quality).toBe(convert(g, b.id).quality + 1)
  })

  it('hint 可以蓋掉類型、涉及的人與勢力、exclusive；沒寫 live 的預設獨家', () => {
    const g = make()
    rec(g, { type: 'scandal', involves: { factions: ['f_a'], people: ['npc_ok'] }, celebrity: true, exclusive: false, adult: true, self: true })
    expect(lastRec(g)).toMatchObject({ type: 'scandal', exclusive: false, involves: { factions: ['f_a'], people: ['npc_ok'] } })
    expect(lastRec(g).marks.sort()).toEqual(['adult', 'celebrity', 'self'])
    rec(g, undefined)
    expect(lastRec(g)).toMatchObject({ type: 'daily', exclusive: true })
  })

  it('壞的請求（沒有標題、來源種類不對）不記；不認得的 hint 欄位與壞的型別被忽略', () => {
    const g = make()
    const run = (p: Rec): Change[] => g.k.hooks.run('media.record', { state: g.state, ...p } as never).flatMap((r) => r.result)
    expect(run({ source: { kind: 'live' }, label: '' })).toEqual([])
    expect(run({ source: { kind: '' }, label: 'x' })).toEqual([])
    rec(g, { type: 'nope', hq: 'yes', mystery: 1 })
    expect(lastRec(g)).toMatchObject({ type: 'daily', exclusive: true })
    expect(lastRec(g).marks).toEqual([])
  })

  it('直播的那一則別人也記得到：by 是錄影等級最高的人；沒人錄得到就是 null', () => {
    const g = make({ pc: { ext: {} } })
    rec(g, { live: true })
    expect(lastRec(g)).toMatchObject({ by: null, miss: 'none' })
  })
})

// ===================================================================================================================
describe('回到快照（rewind.keep）', () => {
  /** 快照之前：一則轉好、扣過一次的素材。快照。快照之後：一則普通的、一則直播的，再多扣一次。 */
  function scenario(retreat: boolean) {
    const g = make({ pc: { ext: { rec: 3 } } })
    const before = addRec(g, { grade: 3, label: '快照之前' })
    const f = convert(g, before)
    give(g, [{ op: 'media.use', ref: f.id, take: 1 }])
    g.commit(sys([{ op: 'snapshot.take', kind: 'entry', label: '入口' }], 'test.entry'))
    const plain = addRec(g, { grade: 3, label: '快照之後的普通' })
    give(g, g.k.hooks.run('media.record', { state: g.state, source: { kind: 'live', ref: 'lv' }, label: '快照之後的直播', hint: { live: true } }).flatMap((r) => r.result))
    const live = lastRec(g).id
    give(g, [{ op: 'media.use', ref: f.id, take: 1 }])
    const seq = media(g).seq
    // 回去：撤退是一份帶 rewind 的報告（外殼提交完自己回去）；其他是 Game.rewindToKind
    if (retreat) g.commit(sys([], 'commission.retreat', { rewind: { kind: 'entry', summary: '你從副本撤退，所有進度回到進去之前。', fresh: true }, outcome: { result: 'retreat', summary: '你撤退了。' } }))
    else expect(g.rewindToKind('entry', '回到入口。')).toBeNull()
    return { g, before, f, plain, live, seq }
  }

  it('快照之後記的兩則：一則標 retracted、一則（直播的）標 lost 還能轉、品質少 1；快照之前的紀錄與轉好的素材（連它被扣掉的次數）都在', () => {
    const { g, before, f, plain, live } = scenario(false)
    const m = media(g)
    expect(m.records[before]).toMatchObject({ made: f.id })
    expect(m.records[before]!.retracted).toBeUndefined()
    expect(m.footage[f.id]!.uses).toBe(1)
    expect(m.records[plain]).toMatchObject({ retracted: true })
    expect(m.records[plain]!.retreat).toBeUndefined()
    expect(m.records[live]!.retracted).toBeUndefined()
    expect(m.records[live]!.marks).toEqual(expect.arrayContaining(['live', 'lost']))
    // 直播那則：品質少 1（lost）；沒有 hq 時 3 級錄影是 2，再扣 1 是 1
    expect(qualityParts(g.k, g.state, m.records[live]!).value).toBe(qualityParts(g.k, g.state, { ...m.records[live]!, marks: ['live'] }).value - 1)
    // 被收回的也轉得了（不扣；撤退才扣）
    expect(convertBlock(g.k, g.state, plain)).toBeNull()
    expect(qualityParts(g.k, g.state, m.records[plain]!).value).toBe(2)
    expect(convertBlock(g.k, g.state, live)).toBeNull()
  })

  it('撤退收回的紀錄多標 retreat，轉成素材時品質 −1；失敗或一般的回退沒有這一條', () => {
    const { g, plain, live } = scenario(true)
    const m = media(g)
    expect(m.records[plain]).toMatchObject({ retracted: true, retreat: true })
    expect(qualityParts(g.k, g.state, m.records[plain]!).value).toBe(1)
    expect(m.records[live]!.retreat).toBeUndefined()
  })

  it('流水號用回去之前的（不重複發號）；之後記的又轉得出新的素材；委託階段的暫存回到快照那一刻的', () => {
    const { g, seq } = scenario(false)
    expect(media(g).seq).toBe(seq)
    const id = addRec(g)
    expect(id).toBe(`rc${seq + 1}`)
    const f = convert(g, id)
    expect(f.id).toBe(`ft${seq + 2}`)
    // 暫存：快照之前沒有、之後有 → 回去之後沒有
    const g2 = make()
    g2.commit(sys([{ op: 'snapshot.take', kind: 'entry', label: '入口' }], 'test.entry'))
    endOf(g2, 'event', { origin: { by: 'commission', ext: { commission: 'cm1' } }, result: { event: 'e' } })
    expect(media(g2).stage).not.toBeNull()
    expect(g2.rewindToKind('entry', '回去。')).toBeNull()
    expect(media(g2).stage).toBeNull()
  })

  it('錄影的開關是玩家的設定：回到快照不改它；沒有任何媒體資料時什麼都不寫', () => {
    const g = make()
    g.commit(sys([{ op: 'snapshot.take', kind: 'entry', label: '入口' }], 'test.entry'))
    g.commit(setRecording(g.k, g.state, false))
    expect(g.rewindToKind('entry', '回去。')).toBeNull()
    expect(media(g).rec).toBe(false)
    // 狀態裡沒有 ext.media（舊檔）：rewind.keep 不寫
    const g3 = make()
    g3.commit(sys([{ op: 'snapshot.take', kind: 'entry', label: '入口' }, { op: 'ext', key: 'media', value: null }], 'test.entry'))
    expect(g3.state.ext.media).toBeUndefined()
    expect(g3.rewindToKind('entry', '回去。')).toBeNull()
    expect(g3.state.ext.media).toBeUndefined()
  })
})

// ===================================================================================================================
describe('狀態的讀取與開新局', () => {
  it('開新局：錄影開著、庫是空的（game.new）；狀態裡沒有 ext.media 或被弄壞，讀出來也是合法的空庫，不丟例外', () => {
    const t = makeGame({ features: [mediaFeature, TOY] })
    expect(readMedia(t.game.state)).toEqual(blankMedia())
    const BAD: unknown[] = [null, 'x', 0, -1, 1.5, Number.NaN, [], {}, true, [null], { a: 1 }]
    for (const bad of BAD) {
      for (const key of ['rec', 'seq', 'records', 'footage', 'clips', 'stage']) {
        const s = { ext: { media: { ...blankMedia(), [key]: bad } } } as unknown as GameState
        expect(() => readMedia(s)).not.toThrow()
        const m = readMedia(s)
        expect(typeof m.rec).toBe('boolean')
        expect(Number.isSafeInteger(m.seq)).toBe(true)
      }
      expect(() => readMedia({ ext: { media: bad } } as unknown as GameState)).not.toThrow()
    }
    // 一筆壞的紀錄、一筆壞的素材被丟掉，好的留著
    const s = { ext: { media: { ...blankMedia(), records: { rc1: { at: 1 }, rc2: { at: 5, label: '好', source: { kind: 'x' } } }, footage: { ft1: null, ft2: { title: '好', made_at: 3, uses: 99, quality: 9 } } } } } as unknown as GameState
    const m = readMedia(s)
    expect(Object.keys(m.records)).toEqual(['rc2'])
    expect(m.footage.ft2).toMatchObject({ uses: 20, quality: 5 })
  })

  it('變更的格式：壞的紀錄、壞的素材、轉兩次都不收，狀態不變', () => {
    const g = make()
    const before = JSON.stringify(g.state)
    expect(() => give(g, [{ op: 'media.add', record: { label: '' } }])).toThrow()
    expect(() => give(g, [{ op: 'media.make', footage: { title: 'x', type: 'battle', quality: 9, uses: 3, made_at: 0 } }])).toThrow(/quality/)
    expect(() => give(g, [{ op: 'media.rec', on: 'yes' }])).toThrow()
    expect(() => give(g, [{ op: 'media.stage' }])).toThrow()
    expect(JSON.stringify(g.state)).toBe(before)
    const id = addRec(g)
    convert(g, id)
    expect(() => give(g, [{ op: 'media.make', record: id, footage: { title: 'x', type: 'battle', quality: 2, uses: 3, made_at: 0 } }])).toThrow(/已經轉成素材/)
  })
})

// ===================================================================================================================
describe('給畫面的檢視（mediaView）', () => {
  it('紀錄新的在前、能不能轉與原因、現在轉的話品質與上限；錄影的人與開關', async () => {
    const g = make({ pc: { ext: { rec: 3 } } })
    const a = addRec(g, { label: '第一則' })
    passTime(g, 60)
    const b = addRec(g, { label: '第二則', by: null, grade: 0, miss: 'none' })
    passTime(g, 60)
    const c = addRec(g, { label: '第三則' })
    convert(g, a)
    const v = mediaView(g.k, g.state)
    expect(v).toMatchObject({ rec: true, recording: true, recorder: { id: 'pc', grade: 3 } })
    expect(v.records.map((r) => r.id)).toEqual([c, b, a])
    expect(v.records[0]).toMatchObject({ can: true, why: null, type: 'battle', type_name: '戰鬥', by_name: expect.any(String), quality: 1, cap: 3, made: null, retracted: false })
    expect(v.records[1]).toMatchObject({ can: false, quality: null })
    expect(v.records[1]!.why).toContain('沒有人裝著錄影的義體')
    expect(v.records[2]).toMatchObject({ can: false, made: expect.stringMatching(/^ft/) })
    expect(v.records[2]!.why).toContain('已經轉成素材了')
  })
})

// ===================================================================================================================
describe('用全部功能的局：錄影等級由義體的被動效果給，media 自己沒有 provider', () => {
  const EYE: ContentPack = {
    id: 'rec_eye',
    content: {
      blueprint: [{
        id: 'bp_rec_eye', kind: 'cyberware', name: '錄影眼', desc: '測試用：內建錄影的義眼。', brand: 'hz', grade: 3, legal: 'free', price: 900, require: [{ type: 'plate' }], optional: [], slot: 'eye',
        invasiveness: 'light', sink_cost: 2, needs_bridge: false, effects: [{ stat: 'rec_grade', amount: 3 }], stock: { plate: 'pt_tw_plate_skin' },
      }],
    },
  }

  it('裝一件 effects 寫 { stat: rec_grade, amount: 3 } 的義體：rec_grade 是 3、打完一場那一則的 by 是主角、grade 是 3；沒裝時是 0、沒有人錄得到', async () => {
    const t = makeBodyGame({ content: [EYE] })
    const g = t.game
    expect(g.k.stats.stat(g.state, 'pc', 'rec_grade')).toBe(0)
    expect(recorderOf(g.k, g.state)).toBeNull()
    expect(applyEffects(g, [{ kind: 'cyber_install', blueprint: 'bp_rec_eye' }]).errors).toEqual([])
    expect(g.k.stats.stat(g.state, 'pc', 'rec_grade')).toBe(3)
    await fight(g, 'win')
    const r = Object.values(readMedia(g.state).records).at(-1)!
    expect(r).toMatchObject({ source: { kind: 'battle' }, type: 'battle', by: 'pc', grade: 3 })
    const f = (() => { g.commit(convertDraft(g.k, g.state, r.id)); return Object.values(readMedia(g.state).footage)[0]! })()
    expect(f).toMatchObject({ uses: 3, origin: 'own', authentic: 'real' })
    expect(f.quality).toBeGreaterThanOrEqual(2)
  })

  it('這個功能自己沒有往 rec_grade 掛任何 provider、不讀背包、不 import 別的功能、不讀別的功能的 state.ext（掃原始碼）', () => {
    const dir = fileURLToPath(new URL('../../src/features/media', import.meta.url))
    const files = readdirSync(dir).filter((f) => f.endsWith('.ts'))
    expect(files.length).toBeGreaterThan(3)
    for (const f of files) {
      const text = readFileSync(join(dir, f), 'utf8')
      const code = text.split('\n').filter((l) => !l.trim().startsWith('//') && !l.trim().startsWith('*') && !l.trim().startsWith('/*')).join('\n')
      expect(code, f).not.toMatch(/addStatProvider|addAttrProvider/)
      expect(code, f).not.toMatch(/state\.inventory|\.inventory\b/)
      expect(code, f).not.toMatch(/from '\.\.\/(?!\.\.\/core)[a-z]/)
      expect(code, f).not.toMatch(/state\.ext\??\.(?!media)\w+|ext\[(?!EXT)/)
    }
  })

  it('拿掉媒體照樣跑；加上媒體之後，用全部功能的局裡每一個衍生數值與效果都註冊得起來（footage 是 AI 可用的效果）', () => {
    const t = makeBodyGame({ without: ['media'] })
    expect(t.game.k.stats.hasStat('rec_grade')).toBe(false)
    const g = makeBodyGame().game
    for (const stat of ['rec_grade', 'footage_quality', 'footage_cap']) expect(g.k.stats.hasStat(stat)).toBe(true)
    expect(g.k.conditions.kinds()).toEqual(expect.arrayContaining(['has_footage', 'rec_on']))
    expect(g.k.effects.aiKinds()).toContain('footage')
  })
})
