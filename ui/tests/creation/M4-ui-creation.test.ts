// 驗收測試：dev/work/M4-ui-creation.md（cpp-ui）。建角的第 5、6、8、9 步與總覽接上引擎的 creation（生命軌跡、橋與義體、技能、錢與裝備），
// 技能頁的基本功升級與洗點接上引擎的 abilities。引擎用真的；內容是示意世界包（它自己的資料，data/demo/creation.ts）加核心包。
// 畫面用 Vue 的伺服器端渲染轉成 HTML 檢查（沒有瀏覽器）；「點按鈕」就是呼叫 store 的動作（元件的 onclick 只是接上它們）。

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { createMemoryHistory, createRouter } from 'vue-router'
import { createSSRApp } from 'vue'
import type { Component } from 'vue'
import { renderToString } from 'vue/server-renderer'
import { FakeProvider, Game, blankState, sanitizeRules } from '@engine/src'
import { CORE_PACK } from '@engine/data'
import { allFeatures } from '@engine/src/features'
import { creationSummary, cyberStepBlock, lifepathRoll, lifepathTables } from '@engine/src/features/creation'
import type { CreationDraft } from '@engine/src/features/creation'
import { NO_BRIDGE_NOTE } from '@engine/src/features/cyberware/creation'
import { NO_BRIDGE_ABILITY } from '@engine/src/features/abilities/creation'
import { NEEDS_TEACHER } from '@engine/src/features/abilities'
import { useEngine } from '../../src/stores/engine'
import { demoPack, withDemoOrigins } from '../../src/data/demo'
import { rulesFromUi } from '../../src/lib/engineView'
import LifepathStep from '../../src/components/creation/LifepathStep.vue'
import CyberStep from '../../src/components/creation/CyberStep.vue'
import AbilitiesStep from '../../src/components/creation/AbilitiesStep.vue'
import GearStep from '../../src/components/creation/GearStep.vue'
import OwnedList from '../../src/components/creation/OwnedList.vue'
import screenSrc from '../../src/screens/NewGameScreen.vue?raw'
import lifepathSrc from '../../src/components/creation/LifepathStep.vue?raw'
import cyberSrc from '../../src/components/creation/CyberStep.vue?raw'
import abilitiesSrc from '../../src/components/creation/AbilitiesStep.vue?raw'
import gearSrc from '../../src/components/creation/GearStep.vue?raw'
import ownedSrc from '../../src/components/creation/OwnedList.vue?raw'
import libCreationSrc from '../../src/lib/creation.ts?raw'
import dataCreationSrc from '../../src/data/creation.ts?raw'

vi.mock('../../src/router', () => ({ FULL_PAGES: [{ path: '/', name: '主畫面' }], router: {} }))

type Eng = ReturnType<typeof useEngine>

const BASE = {
  name: '露', gender: 'female', age: 22, origin: 'hive', originChoice: { favor: 'lonestar' },
  attrPick: { reflex: 15, charm: 14, intellect: 13, body: 12, resolve: 10, tech: 8 },
  attrBonus: { tech: -4, reflex: 3, resolve: 3 },
  skills: { streetwise: 3, negotiate: 3, perform: 2, stealth: 2 },
  perks: ['smooth_talker', 'tough'],
} as unknown as CreationDraft
const draftOf = (over: Record<string, unknown> = {}): CreationDraft => ({ ...BASE, ...over }) as CreationDraft

const router = () => createRouter({ history: createMemoryHistory(), routes: [{ path: '/', component: { render: () => null } }] })
async function render(pinia: ReturnType<typeof createPinia>, comp: Component, props: Record<string, unknown> = {}): Promise<string> {
  const r = router()
  await r.push('/')
  await r.isReady()
  const app = createSSRApp(comp, props)
  app.use(pinia)
  app.use(r)
  return renderToString(app)
}
const clean = (s: string) => s.replace(/<!--[\s\S]*?-->/g, '')
const text = (s: string) => clean(s).replace(/<[^>]+>/g, '').replace(/&amp;/g, '&')

/** 另開一個引擎對照：同一份內容、同一個預覽用的空狀態（規則照 rulesFromUi）。畫面讀到的要和它逐字相同。 */
function engineCheck(rules: object = {}) {
  const game = new Game({ features: allFeatures(), content: [withDemoOrigins(CORE_PACK), demoPack()], fakeProvider: new FakeProvider() })
  const state = blankState(0)
  state.rules = sanitizeRules(rules)
  return { game, state, k: game.k }
}

function setup(rules: object = {}) {
  const pinia = createPinia()
  setActivePinia(pinia)
  const e = useEngine()
  e.creation.previewRules(rules)
  return { e, pinia }
}

beforeEach(() => setActivePinia(createPinia()))

describe('第 6 步：橋與義體', () => {
  it('超過 10 點：擋住的原因和引擎逐字相同，畫面顯示的也是它', async () => {
    const { e, pinia } = setup()
    const over = draftOf({ bridge: 'bp_bridge_net', cyber: [{ blueprint: 'bp_eye' }, { blueprint: 'bp_plating' }, { blueprint: 'bp_pump' }, { blueprint: 'bp_arm', side: 'l' }] })
    const s = e.creation.summary(over)
    expect(s.cyber.left).toBeLessThan(0)
    const direct = engineCheck()
    const want = cyberStepBlock(direct.k, direct.state, over)!.reason
    expect(want).toContain('超過')
    expect(e.creation.blocks(over).find((b) => b.step === 'cyber')!.reason).toBe(want)
    const html = text(await render(pinia, CyberStep, { draft: over, bridge: 'bp_bridge_net', cyber: over.cyber, beastLine: '貓', hasBeast: false }))
    expect(html).toContain(want)
    // 下一步按鈕用的就是這一條：第 6 步擋住
    expect(e.creation.blocks(over).map((b) => b.step)).toContain('cyber')
  })

  it('還沒選橋：要選一座橋（引擎的那一句）；選了一座就過', () => {
    const { e } = setup()
    const none = draftOf({ cyber: [] })
    expect(e.creation.blocks(none).find((b) => b.step === 'cyber')!.reason).toBe('要選一座橋，或選「沒有橋」。')
    expect(e.creation.blocks(draftOf({ bridge: 'bp_bridge_hive', cyber: [] })).some((b) => b.step === 'cyber')).toBe(false)
  })

  it('每一件的點數、沉溺成本是引擎的；企業出身才選得到那家企業的橋', () => {
    const { e } = setup()
    const net = e.creation.lone(BASE, 'cyber', { blueprint: 'bp_bridge_net', bridge: true })
    expect(net.points).toBe(creationSummary(engineCheck().k, engineCheck().state, draftOf({ bridge: 'bp_bridge_net' })).cyber.spent)
    expect(net.sink).toBeGreaterThan(0)
    const hive = draftOf({ bridge: undefined, cyber: [] })
    expect(e.creation.addBlock(hive, { ...hive, bridge: 'bp_bridge_field' }, 'cyber')).toContain('企業')
    const corp = draftOf({ origin: 'corp', originChoice: { favor: 'starbelle' }, cyber: [] })
    expect(e.creation.addBlock(corp, { ...corp, bridge: 'bp_bridge_field' }, 'cyber')).toBeNull()
    expect(e.creation.addBlock(corp, { ...corp, bridge: 'bp_bridge_deep' }, 'cyber')).toContain('夜鶯')
    // 左右：手臂不給左右會被引擎擋下
    expect(e.creation.blueprint('bp_arm')!.needsSide).toBe(true)
    expect(e.creation.blueprint('bp_eye')!.needsSide).toBe(false)
  })

  it('選「沒有橋」之前先看後果：說的是引擎的那一句；選了之後要接在橋上的義體被引擎擋下', () => {
    const { e } = setup()
    expect(e.creation.noBridgeNotes(draftOf({ cyber: [] }))).toEqual([NO_BRIDGE_NOTE])
    const d = draftOf({ bridge: null, cyber: [{ blueprint: 'bp_eye' }] })
    expect(e.creation.stepBlocks(d, 'cyber').join('\n')).toContain('沒有橋')
    expect(e.creation.summary(d).capacity).toEqual({ meat: 0, net: 0, social: 0, media: 0 })
  })

  it('側欄：點數、沉溺的起點、四類容量與「身上已經有的」都是引擎的；選了橋就看得到容量', async () => {
    const { e, pinia } = setup()
    const d = draftOf({ bridge: 'bp_bridge_net', cyber: [{ blueprint: 'bp_eye' }] })
    const s = e.creation.summary(d)
    expect(s.capacity.net).toBeGreaterThan(s.capacity.meat)
    expect(s.sink).toBeGreaterThan(0)
    const html = text(await render(pinia, CyberStep, { draft: d, bridge: 'bp_bridge_net', cyber: d.cyber, beastLine: '貓', hasBeast: false }))
    expect(html).toContain(`剩 ${s.cyber.left}／${s.cyber.total}`)
    expect(html).toContain(String(s.capacity.net))
    // 義眼是這一次選的、出身白給的日常服裝在最上面
    expect(s.owned.some((o) => o.from === 'pick' && o.id === 'bp_eye')).toBe(true)
    expect(html).toContain('蜂巢的工裝')
    expect(html.indexOf('出身白給的')).toBeLessThan(html.indexOf('這一次選的'))
  })
})

describe('第 8 步：技能', () => {
  const learnable = (e: Eng, base: CreationDraft, n: number): string[] => {
    const list: string[] = []
    for (const ab of e.skills.abilities().filter((a) => a.tier === 1)) {
      if (list.length >= n) break
      if (e.creation.addBlock({ ...base, abilities: list }, { ...base, abilities: [...list, ab.id] }, 'abilities') === null) list.push(ab.id)
    }
    return list
  }

  it('選了「沒有橋」之後整頁是引擎給的那一句', async () => {
    const { pinia, e } = setup()
    const d = draftOf({ bridge: null, cyber: [], abilities: [] })
    expect(e.creation.noBridgeAbility).toBe(NO_BRIDGE_ABILITY)
    const html = text(await render(pinia, AbilitiesStep, { draft: d, abilities: [] }))
    expect(html).toContain(NO_BRIDGE_ABILITY)
    expect(html).not.toContain('照學的順序裝進橋')
  })

  it('有橋時是技能樹畫面：歷練點、學會的、原因全讀引擎；學了裝不下的標出來', async () => {
    const { pinia, e } = setup()
    const base = draftOf({ bridge: 'bp_bridge_hive', cyber: [] })
    const ids = learnable(e, base, 3)
    expect(ids.length).toBeGreaterThanOrEqual(2)
    const d = { ...base, abilities: ids } as CreationDraft
    const s = e.creation.summary(d)
    expect(e.creation.abilityState(d).learned).toEqual(ids)
    expect(s.xp.left).toBe(s.xp.total - ids.reduce((n, id) => n + e.skills.abilities().find((a) => a.id === id)!.xp, 0))
    const html = clean(await render(pinia, AbilitiesStep, { draft: d, abilities: ids }))
    expect(text(html)).toContain(`剩 ${s.xp.left}／${s.xp.total} 歷練點`)
    expect(html).toContain('data-fit')
    for (const id of ids) expect(html).toContain(`data-fit-row="${id}"`)
    // 學到的卡片顯示「學會了」，歷練點不夠的那一張原因是引擎的
    expect(html).toContain('data-state="learned"')
    const poor = e.skills.abilities().find((a) => a.xp > s.xp.left && a.tier === 1 && !ids.includes(a.id))
    if (poor) expect(e.creation.addBlock(d, { ...d, abilities: [...ids, poor.id] }, 'abilities')).toContain('歷練點不夠')
  })

  it('退掉一個：後面接不上的一起退（引擎重新問一次）', () => {
    const { e } = setup()
    const base = draftOf({ bridge: 'bp_bridge_hive', cyber: [] })
    const ids = learnable(e, base, 2)
    const rest = ids.slice(1)
    expect(e.creation.abilityState({ ...base, abilities: rest } as CreationDraft).learned.length).toBeLessThanOrEqual(rest.length)
  })
})

describe('第 5 步：生命軌跡', () => {
  it('每張表有條目才列；關掉一個題材之後對應的條目消失；擲的結果和 lifepathRoll 一樣', () => {
    const { e } = setup()
    const d = draftOf()
    const tables = e.creation.lifepath.tables(d)
    expect(tables.map((t) => t.table)).toEqual(['family', 'incident', 'friend', 'enemy', 'ex', 'want', 'sex', 'kink'])
    const incidents = (xs: ReturnType<typeof e.creation.lifepath.tables>) => xs.find((t) => t.table === 'incident')!.options.map((o) => o.id)
    expect(incidents(tables)).toContain('inc_contract')
    expect(incidents(tables)).not.toContain('inc_dock') // 舊港限定
    expect(e.creation.lifepath.tables(draftOf({ origin: 'oldport', originChoice: { favor: 'rouge' } })).find((t) => t.table === 'incident')!.options.map((o) => o.id)).toContain('inc_dock')

    // 契約的題材關掉：契約那一條不見；公開場合關掉：豐富的性經歷與暴露不見；拘束關掉：束縛不見
    const off = rulesFromUi({ filterContract: false, filterPublic: false, filterRestraint: false })
    expect(off.contentOff).toEqual(['restraint', 'public', 'contract'])
    e.creation.previewRules(off)
    const t2 = e.creation.lifepath.tables(d)
    expect(incidents(t2)).not.toContain('inc_contract')
    expect(t2.find((t) => t.table === 'sex')!.options.map((o) => o.id)).not.toContain('sex_rich')
    const kinks = t2.find((t) => t.table === 'kink')!.options.map((o) => o.id)
    expect(kinks).not.toContain('kink_restraint')
    expect(kinks).not.toContain('kink_public')
    expect(kinks).toContain('kink_doll')
    expect(e.creation.lifepath.kinks().map((k) => k.id)).not.toContain('restraint')
    // 和引擎直接問一樣
    const direct = engineCheck(off)
    expect(lifepathTables(direct.k, direct.state, d)).toEqual(t2)

    // 擲：每一次（含重擲）都等於引擎的 lifepathRoll
    for (const table of ['family', 'want', 'kink'] as const) {
      for (let n = 0; n < 4; n++) expect(e.creation.lifepath.roll(d, table, n)).toBe(lifepathRoll(direct.k, direct.state, d, table, n))
    }
  })

  it('畫面：每張表一個下拉（選、擲、跳過）；每一條會變成什麼是引擎的一句話；選到被關掉的那一條引擎擋下', async () => {
    const { e, pinia } = setup()
    const picked = { family: 'fam_tower', incident: 'inc_debt', friend: 'fr_grew', want: 'want_money' }
    const d = draftOf({ lifepath: picked })
    const html = clean(await render(pinia, LifepathStep, { draft: d, lifepath: picked, kinks: [] }))
    for (const t of ['family', 'incident', 'friend', 'enemy', 'ex', 'want', 'sex', 'kink']) {
      expect(html).toContain(`data-pick="${t}"`)
      expect(html).toContain(`data-roll="${t}"`)
    }
    const results = e.creation.lifepath.results(d)
    expect(results.map((r) => r.table)).toEqual(['family', 'incident', 'friend', 'want'])
    const tx = text(html)
    for (const r of results) for (const o of r.outcomes) expect(tx).toContain(o.text)
    expect(results.find((r) => r.table === 'friend')!.outcomes[0]!.text).toContain('名冊')
    // 內容篩選關掉之後，原本選的那一條（契約）被引擎擋下
    const contract = draftOf({ lifepath: { incident: 'inc_contract' } })
    expect(e.creation.lifepath.problems(contract)).toEqual([])
    e.creation.previewRules(rulesFromUi({ filterContract: false }))
    expect(e.creation.lifepath.problems(contract)[0]).toContain('內容篩選')
    expect(e.creation.blocks(contract).find((b) => b.step === 'lifepath')).toBeTruthy()
  })

  it('自己挑潛在性癖：最多 2 個，超過的引擎擋下', () => {
    const { e } = setup()
    expect(e.creation.lifepath.kinkMax).toBe(2)
    expect(e.creation.lifepath.problems(draftOf({ kinks: [{ tag: 'pamper', latent: true }, { tag: 'voice' }, { tag: 'doll_chip' }] }))[0]).toContain('最多')
  })
})

describe('第 9 步：錢與裝備', () => {
  it('點數、換多少現金都是引擎的：沒花完的每點換現金，全部加起來就是起始的錢', () => {
    const { e } = setup()
    const none = draftOf({ bridge: 'bp_bridge_hive', cyber: [], gear: [] })
    const s0 = e.creation.summary(none)
    expect(s0.gear.spent).toBe(0)
    const one = e.creation.lone(none, 'gear', { id: 'it_f0db7d' })
    expect(one.points).toBeGreaterThan(0)
    const s1 = e.creation.summary({ ...none, gear: [{ id: 'it_f0db7d' }] } as CreationDraft)
    expect(s1.gear.spent).toBe(one.points)
    expect(s0.gear.cash - s1.gear.cash).toBe(one.points * e.creation.limits.gearPointCash)
    expect(s1.money.total).toBe(e.creation.limits.startMoney + s1.cyber.cash + s1.gear.cash)
    expect(e.creation.startMoney(none).total).toBe(s0.money.total)
  })

  it('擋住的原因是引擎的：III 級、買不到的、點數不夠', () => {
    const { e } = setup()
    const base = draftOf({ bridge: 'bp_bridge_hive', cyber: [], gear: [] })
    expect(e.creation.addBlock(base, { ...base, gear: [{ id: 'it_c7dbe5' }] } as CreationDraft, 'gear')).toContain('I～II')
    expect(e.creation.addBlock(base, { ...base, gear: [{ id: 'it_f0db7d' }] } as CreationDraft, 'gear')).toBeNull()
    const many = draftOf({ bridge: 'bp_bridge_hive', cyber: [], gear: [{ id: 'dk_nightingale_2' }] })
    expect(e.creation.addBlock(many, { ...many, gear: [...many.gear!, { id: 'it_6fa4e8' }] } as CreationDraft, 'gear')).toContain('點數超過了')
    // 甲板要有橋
    const noBridge = draftOf({ bridge: null, cyber: [], gear: [{ id: 'dk_nightingale_2' }] })
    expect(e.creation.stepBlocks(noBridge, 'gear').join('\n')).toContain('沒有橋')
  })

  it('畫面：白給的列在最上面，同類同位置標「已經有」；沒花完的點數換多少現金即時顯示', async () => {
    const { e, pinia } = setup()
    const d = draftOf({ bridge: 'bp_bridge_hive', cyber: [{ blueprint: 'bp_eye' }], gear: [{ id: 'it_f0db7d' }] })
    const s = e.creation.summary(d)
    const kit = s.owned.filter((o) => o.from === 'kit').map((o) => o.id)
    expect(kit).toEqual(expect.arrayContaining(['it_wear_hive', 'it_d2d2de', 'it_ammo_std']))
    const html = clean(await render(pinia, GearStep, { draft: d, gear: d.gear }))
    expect(text(html)).toContain(`剩 ${s.gear.left}／${s.gear.total}`)
    expect(text(html)).toContain(`C$${s.gear.cash}`)
    expect(html).toContain('data-owned-kit')
    expect(html.indexOf('data-owned-kit')).toBeLessThan(html.indexOf('data-owned-pick'))
    // 日常服裝已經有了：清單上的外套標「已經有」，指到白給的那一套
    const jacket = html.slice(html.indexOf('data-gear="it_jacket_street"'), html.indexOf('data-gear="it_coat_corp"'))
    expect(jacket).toContain('data-have')
    expect(text(jacket)).toContain('蜂巢的工裝')
    // 義體與裝備兩步的側欄是同一份
    const cyberHtml = text(await render(pinia, CyberStep, { draft: d, bridge: 'bp_bridge_hive', cyber: d.cyber, beastLine: '貓', hasBeast: false }))
    expect(cyberHtml).toContain('義眼「寒鴉」II')
    expect(cyberHtml).toContain('蜂巢的工裝')
    const ownedHtml = text(await render(pinia, OwnedList, { owned: s.owned }))
    for (const o of s.owned) expect(ownedHtml).toContain(o.name)
  })
})

describe('走完整個建角按開始', () => {
  it('引擎的主角有選的橋與義體、學的技能裝上了、背包有買的與白給的、錢是 1,500 加沒花完的點數換的', () => {
    const { e } = setup()
    const base = draftOf({ bridge: 'bp_bridge_hive', cyber: [{ blueprint: 'bp_eye' }, { blueprint: 'bp_pump' }], gear: [{ id: 'it_f0db7d' }, { id: 'it_1ace6d' }, { id: 'it_ammo_std', qty: 2 }] })
    const ids: string[] = []
    for (const ab of e.skills.abilities().filter((a) => a.tier === 1)) {
      if (ids.length >= 2) break
      if (e.creation.addBlock({ ...base, abilities: ids }, { ...base, abilities: [...ids, ab.id] }, 'abilities') === null) ids.push(ab.id)
    }
    const draft = { ...base, abilities: ids, lifepath: { family: 'fam_tower', incident: 'inc_debt', friend: 'fr_grew', want: 'want_money' }, kinks: [{ tag: 'pamper', latent: true }] } as CreationDraft
    expect(e.creation.blocks(draft)).toEqual([])
    const s = e.creation.summary(draft)

    expect(e.newGame({ seed: 5, rules: {}, draft })).toEqual([])
    // 橋與義體：引擎的主角身上就是選的這幾件，不多不少
    const view = e.body.cyber()!
    const worn = view.parts.flatMap((p) => p.pieces).filter(Boolean).map((p) => p!.bp)
    expect(worn.sort()).toEqual(['bp_pump', 'bp_bridge_hive', 'bp_eye'].sort())
    expect(view.bridge).toBe(true)
    expect(e.body.sink()!.floor).toBe(s.sink)
    // 技能：學的都在、起始的歷練點照引擎、裝上了
    const mine = e.skills.mine()
    expect(mine.learned).toEqual(ids)
    expect(mine.xp).toBe(s.xp.left)
    expect(mine.equipped.length).toBeGreaterThan(0)
    // 背包：買的與白給的
    const have = (id: string) => e.state.inventory.filter((x) => x.id === id).reduce((n, x) => n + x.qty, 0)
    expect(have('it_f0db7d')).toBe(1)
    expect(have('it_1ace6d')).toBe(1)
    expect(have('it_wear_hive')).toBe(1)
    expect(have('it_d2d2de')).toBeGreaterThanOrEqual(1)
    expect(have('it_ammo_std')).toBe(4) // 買 2 加白給 2
    // 錢：1,500 加沒花完的點數換的（義體每點 500、裝備每點 250）
    expect(e.money.cash).toBe(1500 + s.cyber.left * 500 + s.gear.left * 250)
    expect(e.money.cash).toBe(s.money.total)
    // 沒有示意包的整包送禮：沒選的義體與甲板不會憑空出現
    expect(have('bp_pistol')).toBe(0)
  })

  it('什麼都沒選就開始：被擋下，狀態不動（原因是引擎的第一條）', () => {
    const { e } = setup()
    const blocked = e.newGame({ seed: 5, rules: {}, draft: draftOf({ cyber: [] }) })
    expect(blocked.length).toBeGreaterThan(0)
    expect(blocked[0]!.step).toBe('cyber')
    expect(e.pc).toBeNull()
  })
})

describe('技能頁（遊戲中）：歷練點與基本功升級', () => {
  function started() {
    const { e, pinia } = setup()
    const draft = draftOf({ bridge: 'bp_bridge_hive', cyber: [], abilities: [], gear: [] })
    expect(e.newGame({ seed: 5, rules: {}, draft })).toEqual([])
    return { e, pinia }
  }

  it('歷練點是引擎的；升一級基本功之後兩邊一致', () => {
    const { e } = started()
    const xp0 = e.skills.mine().xp
    expect(xp0).toBe(e.creation.summary(draftOf({ bridge: 'bp_bridge_hive', abilities: [] })).xp.total)
    const lv0 = e.skills.basicLevel('negotiate')
    const cost = e.skills.basicCost('negotiate')
    expect(e.skills.basicBlock('negotiate')).toBeNull()
    expect(e.skills.basicUp('negotiate')).toBeNull()
    expect(e.skills.basicLevel('negotiate')).toBe(lv0 + 1)
    expect(e.state.actors[e.pc!.id]!.skills.negotiate).toBe(lv0 + 1)
    expect(e.skills.mine().xp).toBe(xp0 - cost)
  })

  it('4 級再往上要有人教：按鈕灰掉，原因是引擎那一句；歷練點不夠也是引擎的原因', () => {
    const { e } = started()
    // 出身送的那項（蜂巢：街頭直覺）3 + 1 = 4 級
    expect(e.skills.basicLevel('streetwise')).toBe(4)
    expect(e.skills.basicBlock('streetwise')).toBe(NEEDS_TEACHER)
    expect(e.skills.basicUp('streetwise')).toBe(NEEDS_TEACHER)
    expect(e.skills.basicLevel('streetwise')).toBe(4)
    // 一直升到沒有歷練點：第一個擋住的原因是歷練點不夠
    let guard = 0
    while (e.skills.basicBlock('athletics') === null && guard++ < 20) expect(e.skills.basicUp('athletics')).toBeNull()
    const why = e.skills.basicBlock('athletics')
    expect(why).not.toBeNull()
    expect(why === NEEDS_TEACHER || /歷練點不夠/.test(why!)).toBe(true)
  })

  it('洗點在調校診所：不在診所時是引擎的原因；報價是學會的技能退回多少歷練點', () => {
    const { pinia } = started()
    setActivePinia(pinia)
    const e = useEngine()
    const base = draftOf({ bridge: 'bp_bridge_hive', cyber: [], gear: [] })
    const ids: string[] = []
    for (const ab of e.skills.abilities().filter((a) => a.tier === 1)) {
      if (ids.length >= 1) break
      if (e.creation.addBlock({ ...base, abilities: ids }, { ...base, abilities: [...ids, ab.id] }, 'abilities') === null) ids.push(ab.id)
    }
    expect(e.newGame({ seed: 6, rules: {}, draft: { ...base, abilities: ids } as CreationDraft })).toEqual([])
    const q = e.skills.respecQuote()!
    expect(q.abilities).toEqual(ids)
    expect(q.xp).toBe(e.skills.abilities().find((a) => a.id === ids[0])!.xp)
    expect(e.skills.respecBlock()).toContain('調校診所')
    expect(e.skills.respec()).toContain('調校診所')
    expect(e.skills.mine().learned).toEqual(ids)
  })
})

describe('原始碼', () => {
  const files: Record<string, string> = {
    'screens/NewGameScreen.vue': screenSrc, 'components/creation/LifepathStep.vue': lifepathSrc, 'components/creation/CyberStep.vue': cyberSrc,
    'components/creation/AbilitiesStep.vue': abilitiesSrc, 'components/creation/GearStep.vue': gearSrc, 'components/creation/OwnedList.vue': ownedSrc,
  }

  it('NewGameScreen 與它的子元件不 import 舊的規則函式', () => {
    for (const [f, src] of Object.entries(files)) {
      for (const name of ['cyberPickBlock', 'gearAddBlock', 'fitKit', 'cyberSummary', 'gearSummary', 'gearPoints', 'cyberBlock']) {
        expect(src.match(new RegExp(`import\\s*(type\\s*)?\\{[^}]*\\b${name}\\b[^}]*\\}\\s*from`)), `${f} import ${name}`).toBeNull()
      }
      expect(src, f).not.toMatch(/lib\/skills'/)
      expect(src, f).not.toContain('SkillTreeView')
    }
  })

  it('lib/creation 與 data/creation 裡沒有點數的常數', () => {
    for (const src of [libCreationSrc, dataCreationSrc]) {
      for (const name of ['CYBER_POINTS', 'GEAR_POINTS', 'CYBER_POINT_MONEY', 'GEAR_POINT_MONEY']) expect(src).not.toContain(name)
    }
  })
})
