// 驗收測試：dev/work/M1b-ui-skills.md（cpp-ui）。技能樹與「橋」分頁讀引擎。
// 內容用測試自帶的最小假資料（兩棵樹，各一個招牌加三個技能、一個共鳴），接在核心的內容後面。
// 畫面用 Vue 的伺服器端渲染轉成 HTML 來檢查（沒有瀏覽器）；數字拿另一個獨立的引擎（讀同一份存檔）直接呼叫來比。

import { beforeEach, describe, expect, it } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { createSSRApp } from 'vue'
import { renderToString } from 'vue/server-renderer'
import type { ContentPack } from '@engine/src'
import { FakeProvider, Game } from '@engine/src'
import { CORE_PACK } from '@engine/data'
import { allFeatures } from '@engine/src/features'
import { abilitiesOf, capacityOf, learnBlock, resonanceOn, treeTier, TREE_XP } from '@engine/src/features/abilities'
import { BATTLE_SETUPS } from '@engine/src/testkit'
import { useEngine } from '../../src/stores/engine'
import AbilityTreeView from '../../src/components/AbilityTreeView.vue'
import BridgeTab from '../../src/dialogs/character/BridgeTab.vue'
import treeSrc from '../../src/components/AbilityTreeView.vue?raw'
import bridgeSrc from '../../src/dialogs/character/BridgeTab.vue?raw'
import dialogSrc from '../../src/dialogs/SkillTreeDialog.vue?raw'
import viewSrc from '../../src/lib/skillView.ts?raw'
import { bridgeRows, capCells, cardOf, draftUse, filterRows, gridOf, listTrees, previewOf, richText, sameList, toggleDraft, useLine } from '../../src/lib/skillView'

const ab = (id: string, path: string, category: string, tier: number, layer: string, more: Record<string, unknown>) => ({
  id, name: `${id}名`, text: `${id}的說明。`, path, category, tier, layer, kind: 'active', cap: 1, xp: tier * 20, cells: 1, meat: null, net: null, opinion: null, ...more,
})
// 換配置要在住處或調校診所（M2：features/abilities/loadout.ts）：測試自帶一塊有調校診所的街區，開局站在診所上
const CLINIC_MAP = { id: 'm_clinic', kind: 'street', size: [6, 5], sheets: [{ id: 's', name: '診所街', size: [6, 5], layout: ['######', '#F.E.#', '#1..2#', '#....#', '######'], cells: [{ id: 'E1', at: [3, 1], mark: 'E', name: '口' }, { id: 'F1', at: [1, 1], mark: 'F', name: '調校診所' }], spots: [{ id: '!1', at: [1, 2], cover: 'sparse' }, { id: '!2', at: [4, 2], cover: 'dense' }] }] }
const PACK: ContentPack = {
  id: 'ui_skills_test',
  content: {
    special_map: [CLINIC_MAP],
    district: [{ id: 'd_t', name: '測試區', grade: 1, blocks: ['b_t'] }],
    block: [{ id: 'b_t', district: 'd_t', name: '診所街', kind: 'block', map: 'm_clinic', exits: {}, facilities: { F1: { type: 'tuning_clinic', name: '調校診所' } } }],
    path: [
      { id: 'ta', name: '測試甲', tree: '甲樹', category: 'meat', signature: 'ta_sig', domains: { meat: 'strong', net: 'none', opinion: 'none' }, resonance: [{ tier: 1, cells: 1, text: '先攻 +1。', effect: { initiative: 1 } }, { tier: 2, cells: 1, text: '第二階的共鳴。', effect: { pending: true } }] },
      { id: 'tb', name: '測試乙', tree: '乙樹', category: 'social', signature: 'tb_sig', domains: { meat: 'mid', net: 'none', opinion: 'mid' }, resonance: [{ tier: 1, cells: 1, text: '乙樹的共鳴。', effect: { pending: true } }] },
    ],
    ability: [
      ab('ta_sig', 'ta', 'meat', 1, 'signature', { kind: 'passive', cap: 1, cells: 0, text: '開場時**先手**加一。', meat: { pending: true } }),
      ab('ta_one', 'ta', 'meat', 1, 'front', { after: 'ta_sig', cap: 6, use: { ap: 2, per_turn: 1 }, meat: { target: 'enemy', attack: {} } }),
      ab('ta_two', 'ta', 'meat', 1, 'back', { after: 'ta_one', kind: 'passive', cap: 1, meat: null }),
      ab('ta_three', 'ta', 'meat', 2, 'front', { after: 'ta_one', kind: 'passive', cap: 4, meat: { pending: true } }),
      ab('tb_sig', 'tb', 'social', 1, 'signature', { kind: 'passive', cap: 1, cells: 0, meat: { pending: true } }),
      ab('tb_one', 'tb', 'social', 1, 'front', { after: 'tb_sig', cap: 2, meat: { pending: true }, opinion: { pending: true, text: '輿論上的做法。' } }),
      ab('tb_two', 'tb', 'social', 1, 'back', { after: 'tb_one', cap: 1, meat: { pending: true } }),
      ab('tb_three', 'tb', 'social', 2, 'front', { after: 'tb_one', cap: 3, meat: { pending: true } }),
    ],
  },
}

const DRAFT = {
  name: '露', gender: 'female', age: 22, origin: 'hive', originChoice: { favor: 'lonestar' },
  attrPick: { reflex: 15, charm: 14, intellect: 13, body: 12, resolve: 10, tech: 8 },
  attrBonus: { tech: -4, reflex: 3, resolve: 3 },
  skills: { streetwise: 3, negotiate: 3, perform: 2, stealth: 2 },
  perks: ['smooth_talker', 'tough'],
}
type Eng = ReturnType<typeof useEngine>

function setup(xp = 100) {
  const pinia = createPinia()
  setActivePinia(pinia)
  const e = useEngine()
  e.newGame({ seed: 7, testContent: [PACK] })
  expect(e.createCharacter(DRAFT)).toEqual([])
  const id = e.state.pc!
  expect(e.commit({ summary: '站在調校診所。', changes: [{ op: 'location', to: { district: 'd_t', block: 'b_t', facility: 'F1' } }] })).toBeNull()
  expect(e.commit({
    summary: '給技能資料。',
    changes: [
      { op: 'actor.ext', id, key: 'abilities', value: { xp, learned: [], equipped: [], spent: {} } },
      { op: 'actor.ext', id, key: 'bridge', value: { capacity: { meat: 8, net: 8, social: 8, media: 8 } } },
    ],
  })).toBeNull()
  return { pinia, e }
}
/** 另一個獨立的引擎讀同一份存檔：直接呼叫引擎函式，當標準答案。 */
function oracle(e: Eng) {
  const g = new Game({ features: allFeatures(), content: [CORE_PACK, PACK], fakeProvider: new FakeProvider() })
  expect(g.load(e.save())).toBeNull()
  return g
}
async function html(pinia: ReturnType<typeof createPinia>, comp: object, props: Record<string, unknown> = {}): Promise<string> {
  const app = createSSRApp(comp, props)
  app.use(pinia)
  return renderToString(app)
}
const pc = (e: Eng) => e.state.pc!
const mineOf = (e: Eng) => abilitiesOf(e.state, pc(e))
const stripTags = (h: string) => h.replace(/<!--[\s\S]*?-->/g, '').replace(/<[^>]+>/g, '')
const treeVm = (e: Eng) => listTrees(e.skills.paths(), e.skills.abilities(), e.skills.mine(), e.skills.tierOf, e.skills.treeXp)

describe('技能樹讀引擎（M1b-ui-skills）', () => {
  beforeEach(() => setActivePinia(createPinia()))

  it('歷練點夠、前置學了的技能學得下去：歷練點減少、卡片變學會了、樹的累計增加；存檔再讀回來還在', () => {
    const { e } = setup()
    expect(e.skills.learnBlock('ta_sig')).toBeNull()
    expect(e.skills.learn('ta_sig')).toBeNull()
    expect(mineOf(e).xp).toBe(80)
    expect(mineOf(e).spent.ta).toBe(20)
    const sig = e.skills.abilities().find((a) => a.id === 'ta_sig')!
    expect(cardOf(sig, e.skills.mine(), e.skills.tierOf('ta'), e.skills.learnBlock('ta_sig')).state).toBe('learned')
    expect(cardOf(e.skills.abilities().find((a) => a.id === 'ta_one')!, e.skills.mine(), e.skills.tierOf('ta'), e.skills.learnBlock('ta_one')).state).toBe('can')
    const tree = treeVm(e).find((t) => t.id === 'ta')!
    expect(tree.spent).toBe(20)
    expect(tree.dim).toBe(false)
    expect(treeVm(e).find((t) => t.id === 'tb')!.dim).toBe(true)
    // 引擎的狀態一致
    expect(abilitiesOf(oracle(e).state, pc(e))).toEqual(mineOf(e))
    const raw = e.save()
    e.newGame({ seed: 99, testContent: [PACK] })
    expect(e.load(raw)).toBeNull()
    expect(mineOf(e).learned).toEqual(['ta_sig'])
    expect(mineOf(e).xp).toBe(80)
  })

  it('三種學不了的原因：畫面顯示的字和引擎的 learnBlock 一樣（前置沒學、點數不夠、階還沒開）', async () => {
    const { pinia, e } = setup()
    const g = () => oracle(e)
    // 前置沒學
    const pre = learnBlock(g().k, g().state, pc(e), 'ta_two')
    expect(pre).toMatch(/要先學會/)
    expect(e.skills.learnBlock('ta_two')).toBe(pre)
    // 階還沒開
    const tier = learnBlock(g().k, g().state, pc(e), 'ta_three')
    expect(tier).toMatch(/還沒開到 2 階/)
    expect(e.skills.learnBlock('ta_three')).toBe(tier)
    // 點數不夠
    expect(e.commit({ summary: '歷練點剩 10。', changes: [{ op: 'actor.ext', id: pc(e), key: 'abilities', value: { ...mineOf(e), xp: 10 } }] })).toBeNull()
    const poor = learnBlock(g().k, g().state, pc(e), 'ta_sig')
    expect(poor).toMatch(/歷練點不夠/)
    expect(e.skills.learnBlock('ta_sig')).toBe(poor)
    // 畫面：詳情的按鈕 title 與下面那一行都是這一句；學不了的按下去什麼都不會發生
    for (const [skill, why] of [['ta_two', pre], ['ta_three', tier], ['ta_sig', poor]] as const) {
      const h = await html(pinia, AbilityTreeView, { tree: 'ta', skill })
      expect(h).toContain(`title="${why}"`)
      expect(h).toMatch(/aria-disabled="true"/)
      expect(h).toMatch(new RegExp(`data-why[^>]*>${why}<`))
    }
    const before = mineOf(e)
    expect(e.skills.learn('ta_three')).toBe(tier)
    expect(mineOf(e)).toEqual(before)
    // 畫面的程式裡沒有這幾句原因
    for (const src of [treeSrc, viewSrc, dialogSrc]) for (const s of ['要先學會', '還沒開到', '歷練點不夠']) expect(src).not.toContain(s)
  })

  it('樹的累計到 40 時第二階從斜紋變成開的', async () => {
    const { pinia, e } = setup()
    expect(TREE_XP[1]).toBe(40)
    expect(await html(pinia, AbilityTreeView, { tree: 'ta' })).toMatch(/data-tier="2" data-open="false"/)
    expect(e.skills.learn('ta_sig')).toBeNull()
    expect(await html(pinia, AbilityTreeView, { tree: 'ta' })).toMatch(/data-tier="2" data-open="false"/)
    expect(e.skills.learn('ta_one')).toBeNull()
    expect(mineOf(e).spent.ta).toBe(40)
    expect(treeTier(oracle(e).k, oracle(e).state, pc(e), 'ta')).toBe(2)
    expect(e.skills.tierOf('ta')).toBe(2)
    const h = await html(pinia, AbilityTreeView, { tree: 'ta' })
    expect(h).toMatch(/data-tier="2" data-open="true"/)
    // 共鳴生效要裝著這棵樹的招牌（問引擎）：學了沒裝不生效
    expect(h).toMatch(/data-reso="2" data-on="false"/)
    expect(e.skills.equip(['ta_sig'])).toBeNull()
    expect(await html(pinia, AbilityTreeView, { tree: 'ta' })).toMatch(/data-reso="2" data-on="true"/)
    expect(e.skills.learnBlock('ta_three')).toBeNull()
    // 第三階以後的樹沒有資料也照樣排得出來（五階各兩列）
    expect(gridOf(treeVm(e).find((t) => t.id === 'ta')!).tiers).toHaveLength(5)
  })

  it('共鳴「生效中」問引擎：學了這棵樹但沒裝招牌不生效；裝上招牌、樹階到了才生效（和戰鬥裡的修正同一條）', async () => {
    const { pinia, e } = setup()
    expect(e.skills.learn('ta_sig')).toBeNull()
    expect(e.skills.resonanceOn('ta', 1)).toBe(false)
    expect(resonanceOn(oracle(e).k, oracle(e).state, pc(e), 'ta', 1)).toBe(false)
    expect(await html(pinia, AbilityTreeView, { tree: 'ta' })).toMatch(/data-reso="1" data-on="false"/)
    expect(e.skills.equip(['ta_sig'])).toBeNull()
    expect(e.skills.resonanceOn('ta', 1)).toBe(true)
    expect(e.skills.resonanceOn('ta', 1)).toBe(resonanceOn(oracle(e).k, oracle(e).state, pc(e), 'ta', 1))
    // 第 2 階：樹的累計還沒到
    expect(e.skills.resonanceOn('ta', 2)).toBe(false)
    expect(await html(pinia, AbilityTreeView, { tree: 'ta' })).toMatch(/data-reso="1" data-on="true"/)
    expect(treeSrc).not.toMatch(/r\.tier <= open\.value/)
  })

  it('技能卡的消耗：直接寫的、照戰場分的、RAM、現金、人情、每件委託都寫得出來；沒寫是「沒有消耗」', () => {
    const line = (use: unknown) => useLine({ use } as never)
    expect(line(undefined)).toBe('沒有消耗')
    expect(line({ ap: 2, per_turn: 1 })).toBe('2 行動點，每回合 1 次')
    // 照戰場分、只有現實：不標戰場
    expect(line({ meat: { ap: 1, cash: 'grade*500' } })).toBe('1 行動點，現金（照等級）')
    expect(line({ meat: { ap: 2, favor: 'mid', per_commission: 1 } })).toBe('2 行動點，中人情 1 個，每件委託 1 次')
    // 兩個戰場：每個各一段
    expect(line({ meat: { ap: 2, ram: 2 }, net: { ap: 1, ram_all_min: 5, per_fight: 1 } })).toBe('現實：2 行動點，2 RAM；內海：1 行動點，花掉全部 RAM（至少 5 點），每場 1 次')
    expect(line({ meat: { first_round: true } })).toBe('只能在第一回合')
    expect(line({ meat: {} })).toBe('沒有消耗')
  })

  it('「meat」是 null 的技能在現實那一列是淡的；標 pending 的有「還沒有做成機制」', async () => {
    const { pinia } = setup()
    const dim = await html(pinia, AbilityTreeView, { tree: 'ta', skill: 'ta_two' })
    expect(dim).toMatch(/data-lane="meat" data-dim="true"/)
    expect(dim).toMatch(/data-lane="net" data-dim="true"/)
    const pend = await html(pinia, AbilityTreeView, { tree: 'tb', skill: 'tb_one' })
    expect(pend).toMatch(/data-lane="meat" data-dim="false"/)
    expect(stripTags(pend)).toContain('還沒有做成機制。')
    expect(stripTags(pend)).toContain('輿論上的做法。')
    const live = await html(pinia, AbilityTreeView, { tree: 'ta', skill: 'ta_one' })
    expect(live).toMatch(/data-lane="meat" data-dim="false"/)
    expect(stripTags(live.split('data-lane="meat"')[1]!.split('data-lane="net"')[0]!)).not.toContain('還沒有做成機制')
    // 消耗寫成一句
    expect(live).toMatch(/data-use[^>]*>2 行動點，每回合 1 次</)
  })

  it('說明文字裡的 **字** 顯示成粗體，畫面上沒有星號', async () => {
    const { pinia } = setup()
    expect(richText('開場時**先手**加一。')).toEqual([{ text: '開場時', bold: false }, { text: '先手', bold: true }, { text: '加一。', bold: false }])
    const h = await html(pinia, AbilityTreeView, { tree: 'ta', skill: 'ta_sig' })
    expect(h).toMatch(/<b[^>]*>先手<\/b>/)
    expect(stripTags(h)).not.toContain('*')
  })

  it('一棵樹的排版：招牌在上，三條線照 after 的鏈排；沒有技能的樹不列、一棵都沒有就寫「還沒有技能的資料。」', async () => {
    const { pinia, e } = setup()
    const t = treeVm(e).find((x) => x.id === 'ta')!
    const g = gridOf(t)
    expect(g.signature?.id).toBe('ta_sig')
    const at = (tier: number, layer: 'front' | 'back') => g.tiers[tier - 1]!.rows.find((r) => r.layer === layer)!.cells
    expect(at(1, 'front')[0]!.map((a) => a.id)).toEqual(['ta_one'])
    expect(at(1, 'back')[0]!.map((a) => a.id)).toEqual(['ta_two'])
    expect(at(2, 'front')[0]!.map((a) => a.id)).toEqual(['ta_three']) // 同一條鏈同一欄
    // 沒有技能資料的路數不列
    const empty = listTrees([{ ...e.skills.paths()[0]!, id: 'nobody' }], e.skills.abilities(), e.skills.mine(), () => 1, TREE_XP)
    expect(empty).toEqual([])
    expect(treeSrc).toContain('還沒有技能的資料。')
    // 示意資料與測試資料的樹都列出來
    const ids = treeVm(e).map((x) => x.id)
    expect(ids).toEqual(expect.arrayContaining(['ta', 'tb']))
    expect(await html(pinia, AbilityTreeView, {})).toContain('data-tree="ta"')
  })
})

describe('橋的分頁讀引擎（M1b-ui-skills）', () => {
  beforeEach(() => setActivePinia(createPinia()))

  function learnAll(e: Eng, ids: string[]) {
    for (const id of ids) expect(e.skills.learn(id)).toBeNull()
  }

  it('清單只列學會的技能，可以照樹篩、只看裝著的；容量條是引擎的數字', async () => {
    const { pinia, e } = setup(400)
    learnAll(e, ['ta_sig', 'ta_one', 'tb_sig', 'tb_one'])
    const rows = bridgeRows(e.skills.paths(), e.skills.abilities(), e.skills.mine())
    expect(rows.map((r) => r.id)).toEqual(['ta_sig', 'ta_one', 'tb_sig', 'tb_one'])
    expect(filterRows(rows, 'ta', []).map((r) => r.id)).toEqual(['ta_sig', 'ta_one'])
    expect(filterRows(rows, 'on', ['tb_one']).map((r) => r.id)).toEqual(['tb_one'])
    const h = await html(pinia, BridgeTab)
    expect(h).toContain('data-row="ta_one"')
    expect(h).not.toContain('data-row="ta_two"')
    const cap = capacityOf(oracle(e).k, oracle(e).state, pc(e))
    expect(cap.meat).toEqual({ used: 0, max: 8 })
    expect(stripTags(h)).toContain('0/8')
  })

  it('勾了超過容量的組合按「套用」：引擎的原因顯示出來，狀態沒有變', () => {
    const { e } = setup(400)
    learnAll(e, ['ta_sig', 'ta_one', 'ta_two', 'ta_three'])
    let draft: string[] = []
    for (const id of ['ta_one', 'ta_three']) draft = toggleDraft(draft, id) // 6 + 4 = 10 > 8
    const before = mineOf(e)
    const why = e.skills.equip(draft)
    expect(why).toMatch(/現實型的容量不夠（要 10，橋只有 8）/)
    expect(mineOf(e)).toEqual(before)
    expect(mineOf(e).equipped).toEqual([])
    // 畫面上的數字是暫存清單的用量（加法），超過的格子是紅框
    const rows = bridgeRows(e.skills.paths(), e.skills.abilities(), e.skills.mine())
    expect(draftUse(rows, draft).meat).toBe(10)
    expect(capCells(8, 10, null).filter((c) => c.over)).toHaveLength(2)
  })

  it('合格的組合套用之後，capacityOf 的數字和畫面一樣；游標指著還沒裝的技能，預覽是現在用掉的加上它的容量', async () => {
    const { pinia, e } = setup(400)
    learnAll(e, ['ta_sig', 'ta_one', 'ta_two', 'ta_three', 'tb_sig', 'tb_one'])
    const rows = bridgeRows(e.skills.paths(), e.skills.abilities(), e.skills.mine())
    const draft = ['ta_one', 'ta_two', 'tb_one']
    expect(e.skills.equip(draft)).toBeNull()
    expect(mineOf(e).equipped).toEqual(draft)
    const cap = capacityOf(oracle(e).k, oracle(e).state, pc(e))
    expect(cap.meat.used).toBe(7)
    expect(cap.social.used).toBe(2)
    expect(e.skills.capacity()).toEqual(cap)
    expect(draftUse(rows, draft)).toEqual({ meat: cap.meat.used, net: cap.net.used, social: cap.social.used, media: cap.media.used })
    const h = stripTags(await html(pinia, BridgeTab))
    expect(h).toContain(`${cap.meat.used}/${cap.meat.max}`)
    expect(h).toContain(`${cap.social.used}/${cap.social.max}`)
    // 預覽：現實現在 7，指著 ta_three（容量 4）→ 11；已經勾著的沒有預覽
    const used = draftUse(rows, draft)
    expect(previewOf(rows.find((r) => r.id === 'ta_three')!, draft, used)).toEqual({ category: 'meat', after: 11 })
    expect(previewOf(rows.find((r) => r.id === 'ta_one')!, draft, used)).toBeNull()
    // 暫存清單的小工具
    expect(sameList(['a', 'b'], ['b', 'a'])).toBe(true)
    expect(toggleDraft(draft, 'ta_one')).toEqual(['ta_two', 'tb_one'])
    // 存檔再讀回來還在
    const raw = e.save()
    e.newGame({ seed: 99, testContent: [PACK] })
    expect(e.load(raw)).toBeNull()
    expect(mineOf(e).equipped).toEqual(draft)
  })

  it('不在住處或調校診所：套用被擋，原因是引擎的 loadoutBlock，狀態與時間不變；在診所套用花半小時', () => {
    const { e } = setup(400)
    learnAll(e, ['ta_sig', 'ta_one'])
    const t0 = e.state.time.hour * 60 + e.state.time.minute
    expect(e.skills.loadoutBlock()).toBeNull()
    expect(e.skills.equip(['ta_one'])).toBeNull()
    expect(e.state.time.hour * 60 + e.state.time.minute - t0).toBe(30)
    expect(e.commit({ summary: '走到街上。', changes: [{ op: 'location', to: { district: 'd_t', block: 'b_t' } }] })).toBeNull()
    const why = e.skills.loadoutBlock()
    expect(why).toMatch(/才能換技能配置/)
    const before = mineOf(e)
    expect(e.skills.equip([])).toBe(why)
    expect(mineOf(e)).toEqual(before)
  })

  it('套用沒學的技能：引擎的原因，狀態不變', () => {
    const { e } = setup()
    const before = mineOf(e)
    expect(e.skills.equip(['ta_one'])).toBe('還沒學會ta_one名。')
    expect(mineOf(e)).toEqual(before)
  })

  it('戰鬥中打開是唯讀的：原因是 store 給的那一句，提交被擋、狀態不變', async () => {
    const { pinia, e } = setup(400)
    learnAll(e, ['ta_sig', 'ta_one'])
    e.startBattle(BATTLE_SETUPS.encounter(1))
    const why = e.blockOf('commit:ability.equip')
    expect(why).toBeTruthy()
    expect(e.skills.lock()).toBe(why)
    const before = mineOf(e)
    expect(e.skills.equip(['ta_one'])).toBe(why)
    expect(e.skills.learn('ta_two')).toBe(why)
    expect(mineOf(e)).toEqual(before)
    expect(await html(pinia, BridgeTab)).toMatch(new RegExp(`data-footer[^>]*>${why}<`))
    expect(await html(pinia, AbilityTreeView, { tree: 'ta', skill: 'ta_two' })).toMatch(new RegExp(`data-lock[^>]*>${why}<`))
    expect(bridgeSrc).not.toContain('正在戰鬥')
  })

  it('不在戰鬥時最下面一行寫「可以換」，不寫時間或地點', async () => {
    const { pinia } = setup()
    const h = await html(pinia, BridgeTab)
    expect(h).toMatch(/data-footer[^>]*>可以換。</)
    expect(stripTags(h)).not.toMatch(/半小時|據點|診所/)
  })
})

describe('原始碼檢查（M1b-ui-skills）', () => {
  it('元件與 skillView 不 import 假的技能資料，沒有自己比歷練點或容量的判斷式', () => {
    for (const src of [treeSrc, bridgeSrc, dialogSrc, viewSrc]) {
      expect(src).not.toMatch(/skillTypes|content\.generated|data\/profile|stores\/game|lib\/skills['"]/)
      // 歷練點與容量：不拿 xp、used、max、cap 跟別的數字比大小（判斷在引擎）
      expect(src).not.toMatch(/\.xp\s*[<>]=?|[<>]=?\s*[\w.]*\.xp\b/)
      expect(src).not.toMatch(/\bmine(?:\.value)?\.xp\b/)
      expect(src).not.toMatch(/\.max\s*[<>]=?|[<>]=?\s*[\w.]*\.max\b|used\[[^\]]*\]\s*[<>]|\bcap\s*[<>]=?/)
    }
  })
})
