// 驗收測試：dev/work/M2-ui-battle-after.md（cpp-ui）。戰敗事件（演、選項、後果、三選一、被贖回）、打贏的戰利品、俘虜的處置接上引擎。
// 內容用測試自帶的最小假資料：一件兩段的假戰敗事件、一個帶掉落的假敵人；替身功能：caller（發起戰鬥的功能，收戰敗的結果、委託失敗時回退）、
// ransom（戰敗多給的「被贖回」，現金不夠就選不了）。畫面用 Vue 的伺服器端渲染轉成 HTML 來檢查（沒有瀏覽器）；點按鈕做的事就是呼叫面板呼叫的那幾個 store 函式。

import { beforeEach, describe, expect, it } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { createSSRApp } from 'vue'
import { renderToString } from 'vue/server-renderer'
import type { BattleSetup, ContentPack, Feature, Report } from '@engine/src'
import { BATTLE_SETUPS, enemyUnit } from '@engine/src/testkit'
import { useEngine } from '../../src/stores/engine'
import DefeatPanel from '../../src/components/combat/DefeatPanel.vue'
import SpoilsPanel from '../../src/components/combat/SpoilsPanel.vue'
import SceneGate from '../../src/components/combat/SceneGate.vue'
import EventDialog from '../../src/dialogs/EventDialog.vue'
import { choiceGroups, consequences, defeatStory, itemName, spoilsOf } from '../../src/lib/afterBattleView'
import { useAfterBattle } from '../../src/lib/useAfterBattle'

// ---- 替身 ----

/** 發起的人要不要在事件算失敗時要求回退（要有入口的快照才開） */
let rewindOn = false
const heard: Array<{ kind: string; outcome: string; result: Record<string, unknown> }> = []
/** 發起戰鬥的功能：收戰敗的結果；事件算委託失敗時要求回退到入口的快照（引擎照報告的 rewind 在同一次提交裡回去） */
const caller: Feature = {
  id: 'caller',
  install(k) {
    k.hooks.on('activity.end', 'caller', (p) => {
      if (p.kind !== 'defeat' || p.origin.by !== 'caller') return
      heard.push({ kind: p.kind, outcome: p.outcome, result: p.result })
      return rewindOn && p.result.fails_commission === true ? { lines: ['委託失敗'], rewind: { kind: 'entry', summary: '委託失敗，回到出發之前。' } } : { lines: ['委託照舊'] }
    })
  },
}
const RANSOM = 500
/** 戰敗多給的選項「被贖回」：付 500、跳過事件；現金不夠就選不了（原因是替身寫的，畫面照列） */
const ransom: Feature = {
  id: 'ransom_stub',
  install: (k) => void k.hooks.on('defeat.options', 'ransom_stub', ({ state }) => [{
    id: 'ransom', name: '被贖回', desc: `付 ${RANSOM} C$，跳過戰敗事件。`,
    blocks: state.money.cash >= RANSOM ? [] : [`現金不夠（要 ${RANSOM}，現在 ${state.money.cash}）。`],
    changes: [{ op: 'cash', delta: -RANSOM }], lines: ['付了贖金。'], summary: '你們被贖回來了，沒有經歷戰敗事件。',
  }]),
}

// ---- 假資料 ----

type Fx = Record<string, unknown>
const opt = (id: string, text: string, o: Fx = {}): Fx => ({ id, text, outcomes: { any: [] }, ...o })
const cash = (amount: number) => ({ kind: 'cash', amount })
const flag = (key: string) => ({ kind: 'flag', key, value: true })
const ITEMS = [
  { id: 'it_ui_chip', name: '測試晶片', desc: '晶片。', category: 'misc', grade: 1, size: 1, legal: 'free' },
  { id: 'it_ui_gel', name: '測試凝膠', desc: '凝膠。', category: 'misc', grade: 1, size: 1, legal: 'free' },
]
const foe = (id: string, more: Fx = {}): Fx => ({
  id, name: '測試打手', desc: '測試用的敵人。', faction: 'hizakura', rank: 'minion', grades: [1, 5], kind: 'human',
  position: { prefer: [1, 2], cover_use: 0.5 }, mode: 'lethal', weapons: [{ class: 'pistol' }], ai: { prefer: 'weakest', focus: 1, flee_below: 0 }, ...more,
})
/** 一件兩段的假戰敗事件：第一段扣 300（現金 2000、比例 0.5 內）加旗標，第二段兩個選項；整件算委託失敗 */
const TWO: Fx = {
  id: 'df_ui_two', name: '地下診所的兩段', kind: 'generic', factions: [], fails_commission: true,
  versions: { default: { text: '你在一張冰冷的桌子上醒來，頭頂是一盞刺眼的燈。', stages: [
    { options: [opt('s1a', '先鬆口。', { outcomes: { any: [cash(-300), flag('stage1_a')] } }), opt('s1b', '咬牙撐著。', { outcomes: { any: [flag('stage1_b')] } })] },
    { text: '他們把門鎖上了。', options: [opt('s2a', '認了。', { outcomes: { any: [flag('stage2_a')] } }), opt('s2b', '再拖一下。', { outcomes: { any: [flag('stage2_b')] } })] },
  ] } },
}
/** 不算委託失敗的一件 */
const SOFT: Fx = { id: 'df_ui_soft', name: '被放走', kind: 'generic', factions: [], fails_commission: false, versions: { default: { text: '他們嫌你麻煩，把你丟在路邊。', stages: [{ options: [opt('g1', '爬起來。')] }] } } }
const PACK: ContentPack = {
  id: 'after_ui',
  content: {
    item: ITEMS,
    enemy: [foe('en_ui_thug', { loot: [{ item: 'it_ui_chip', chance: 1, qty: 2 }] })],
    defeat_event: [TWO, SOFT],
  } as unknown as ContentPack['content'],
}

const DRAFT = {
  name: '露', gender: 'female', age: 22, origin: 'hive', originChoice: { favor: 'lonestar' },
  attrPick: { reflex: 15, charm: 14, intellect: 13, body: 12, resolve: 10, tech: 8 },
  attrBonus: { tech: -4, reflex: 3, resolve: 3 },
  skills: { streetwise: 3, negotiate: 3, perform: 2, stealth: 2 },
  perks: ['smooth_talker', 'tough'],
}
type Eng = ReturnType<typeof useEngine>

interface Opts { seed?: number; rules?: object; cash?: number; features?: Feature[] }
const WITH_RANSOM = [caller, ransom]
/** 開一局：測試自帶的內容、建好角色、現金 2000；入口的快照留一份（回退用），入口之後再花 100 */
function setup(o: Opts = {}) {
  heard.length = 0
  rewindOn = false
  const pinia = createPinia()
  setActivePinia(pinia)
  const e = useEngine()
  e.newGame({ seed: o.seed ?? 7, ...(o.rules ? { rules: o.rules } : {}), testContent: [PACK], testFeatures: o.features ?? [caller] })
  expect(e.createCharacter(DRAFT)).toEqual([])
  e.ledger([{ op: 'cash', delta: (o.cash ?? 2000) - e.money.cash }])
  return { pinia, e }
}
async function html(pinia: ReturnType<typeof createPinia>, comp: object, props: Record<string, unknown> = {}): Promise<string> {
  const app = createSSRApp(comp, props)
  app.use(pinia)
  return renderToString(app)
}
const clean = (h: string) => h.replace(/<!--[\s\S]*?-->/g, '')
const strip = (h: string) => clean(h).replace(/<[^>]+>/g, '')
const buttonOf = (h: string, attr: string): string => clean(h).match(new RegExp(`<button[^>]*${attr}[^>]*>`))?.[0] ?? ''
const isGrey = (h: string, attr: string): boolean => /aria-disabled="true"/.test(buttonOf(h, attr))

/** 一場必輸的戰鬥（輪到我方就投降），結算到戰敗；origin.ext 指定這一場的戰敗事件，發起的人是 caller */
async function lose(e: Eng): Promise<void> {
  const base = BATTLE_SETUPS.hopeless()
  e.startBattle({ ...base, origin: { ...base.origin, ext: { by: 'caller', defeat_event: 'df_ui_two' } } })
  for (let i = 0; i < 500 && e.battleOptions()?.waiting !== 'over'; i++) {
    if (e.battleOptions()?.waiting === 'ai') e.battleNext()
    else e.battleAct({ action: 'surrender' })
  }
  expect((await e.finishBattle()).status).toBe('applied')
}
const view = (e: Eng) => e.defeatFlow.view()!
const choice = (e: Eng, id: string) => view(e).choices.find((c) => c.id === id)!
/** 事件開著時選第一個選得了的（或指定的）選項 */
async function pick(e: Eng, id?: string): Promise<void> {
  const v = e.event.view()!
  const o = id ? v.options.find((x) => x.id === id)! : v.options.find((x) => !x.locked)!
  const r = await e.event.choose(o.id)
  expect(r, o.id + ' ' + JSON.stringify(r.reason)).toMatchObject({ status: 'applied' })
}

beforeEach(() => setActivePinia(createPinia()))

describe('戰敗：打輸之後面板出現，事件沒做完時「接受結果」是灰的、原因是引擎的', () => {
  it('抬頭是引擎給的（哪一件事件、怎麼選到的、投降或戰敗）；開頭的敘事是引擎那一版的文字；事件的第一段嵌在面板裡', async () => {
    const { e, pinia } = setup()
    await lose(e)
    expect(e.pendingDefeat).not.toBeNull()
    const v = view(e)
    expect(v).toMatchObject({ step: 'playing', setting: 'always', event: { id: 'df_ui_two', name: '地下診所的兩段', tier: 'origin' } })
    const h = await html(pinia, DefeatPanel)
    expect(h).toContain('data-defeat')
    const t = strip(h)
    expect(t).toContain('戰敗')
    expect(t).toContain('地下診所的兩段')
    expect(t).toContain('這一場指定的')
    expect(defeatStory(e.state.reports)).toBe('你在一張冰冷的桌子上醒來，頭頂是一盞刺眼的燈。')
    // 事件開在面板裡：正文、兩個選項、「第 1 段」是事件視窗的內容
    expect(e.event.view()).toMatchObject({ stage: { index: 0, count: 2 } })
    expect(h).toContain('data-defeat-event-body')
    expect(h).toContain('data-opt="s1a"')
    expect(h).toContain('data-opt="s1b"')
    // 沒有把事件放兩次：面板沒有先問的按鈕
    expect(h).not.toContain('data-defeat-ask')
  })

  it('事件還沒做完：接受是灰的，寫的原因就是引擎的；按下去被擋、狀態不動；重來一直亮著', async () => {
    const { e, pinia } = setup()
    await lose(e)
    const why = choice(e, 'accept').why
    expect(choice(e, 'accept').can).toBe(false)
    expect(why).toBeTruthy()
    const h = await html(pinia, DefeatPanel)
    expect(isGrey(h, 'data-defeat-accept')).toBe(true)
    expect(strip(h)).toContain(why!)
    expect(isGrey(h, 'data-defeat-retry')).toBe(false)
    expect(isGrey(h, 'data-defeat-stage')).toBe(false)
    const cashBefore = e.money.cash
    expect(e.defeatFlow.accept()).toBe(why)
    expect(e.pendingDefeat).not.toBeNull()
    expect(e.money.cash).toBe(cashBefore)
  })

  it('兩段都選完才亮起來：第一段選完還是灰的（換到第二段），第二段選完接受才可以', async () => {
    const { e, pinia } = setup()
    await lose(e)
    await pick(e, 's1a')
    expect(e.state.flags.stage1_a).toBe(true)
    expect(e.event.view()).toMatchObject({ stage: { index: 1, count: 2 }, text: '他們把門鎖上了。' })
    expect(choice(e, 'accept').can).toBe(false)
    expect(isGrey(await html(pinia, DefeatPanel), 'data-defeat-accept')).toBe(true)
    await pick(e, 's2a')
    expect(e.state.flags.stage2_a).toBe(true)
    expect(e.event.view()).toBeNull()
    expect(view(e).step).toBe('played')
    expect(choice(e, 'accept')).toMatchObject({ can: true, why: null })
    const h = await html(pinia, DefeatPanel)
    expect(isGrey(h, 'data-defeat-accept')).toBe(false)
    expect(h).not.toContain('data-accept-why')
  })
})

describe('戰敗：存檔規則是「可以跳過」時先問；選不看，面板直接列出結果', () => {
  it('先問：兩個按鈕（看、不看），事件還沒開、接受是灰的、原因是引擎的', async () => {
    const { e, pinia } = setup({ rules: { defeatView: 'skippable' } })
    await lose(e)
    expect(view(e)).toMatchObject({ step: 'ask', setting: 'skippable' })
    expect(e.event.view()).toBeNull()
    const groups = choiceGroups(view(e))
    expect(groups.ask.map((c) => c.id)).toEqual(['watch', 'skip'])
    expect(groups.ask.every((c) => c.can)).toBe(true)
    const h = await html(pinia, DefeatPanel)
    expect(h).toContain('data-defeat-ask')
    expect(buttonOf(h, 'data-defeat-choice="watch"')).not.toBe('')
    expect(isGrey(h, 'data-defeat-choice="watch"')).toBe(false)
    expect(isGrey(h, 'data-defeat-choice="skip"')).toBe(false)
    expect(isGrey(h, 'data-defeat-accept')).toBe(true)
    expect(strip(h)).toContain(choice(e, 'accept').why!)
    expect(h).not.toContain('data-defeat-event-body')
  })

  it('選不看：面板直接列出結果（引擎的不演版），沒有事件視窗；接受時才真的發生', async () => {
    const { e, pinia } = setup({ rules: { defeatView: 'skippable' } })
    await lose(e)
    const cash0 = e.money.cash
    expect(e.defeatFlow.skip()).toBeNull()
    expect(view(e)).toMatchObject({ step: 'played', skipped: true })
    expect(e.event.view()).toBeNull()
    const lines = view(e).accept.lines
    expect(lines.length).toBeGreaterThan(0)
    const h = await html(pinia, DefeatPanel)
    expect(h).not.toContain('data-defeat-ask')
    expect(h).not.toContain('data-defeat-event-body')
    for (const l of lines) expect(strip(h)).toContain(l)
    expect(e.money.cash).toBe(cash0) // 接受之前什麼都還沒發生
    expect(choice(e, 'accept').can).toBe(true)
  })

  it('選要看：事件視窗開起來、嵌在面板裡；看或不看已經決定，先問的那一組不再出現', async () => {
    const { e, pinia } = setup({ rules: { defeatView: 'skippable' } })
    await lose(e)
    expect(e.defeatFlow.watch()).toBeNull()
    expect(view(e).step).toBe('playing')
    expect(e.event.view()).not.toBeNull()
    const h = await html(pinia, DefeatPanel)
    expect(h).not.toContain('data-defeat-ask')
    expect(h).toContain('data-opt="s1a"')
  })

  it('存檔規則是「一律要看」：沒有先問的按鈕；「不看」就算被叫到，引擎也說不行', async () => {
    const { e } = setup()
    await lose(e)
    expect(choice(e, 'skip')).toMatchObject({ can: false })
    expect(e.defeatFlow.skip()).toBe(choice(e, 'skip').why)
  })
})

describe('戰敗：接受之後面板關掉、不再擋；在副本裡算失敗時回到出發之前（引擎回退），紀錄留著', () => {
  it('接受：面板不再出現（沒有等待中的戰敗），別的提交收得進去；發起的人收到戰敗的結果', async () => {
    const { e, pinia } = setup()
    await lose(e)
    await pick(e, 's1b')
    await pick(e, 's2b')
    expect(e.defeatFlow.accept()).toBeNull()
    expect(e.pendingDefeat).toBeNull()
    expect(e.defeatFlow.view()).toBeNull()
    expect(clean(await html(pinia, DefeatPanel))).toBe('')
    expect(e.commit({ summary: '擋住的事收得進去了。' })).toBeNull()
    expect(heard).toHaveLength(1)
    expect(heard[0]).toMatchObject({ outcome: 'accept', result: { event: 'df_ui_two', fails_commission: true, option: 's2b' } })
  })

  it('事件算失敗、發起的人要求回退：接受之後畫面回到出發之前（現金、旗標都回去），紀錄留著並標成被收回', async () => {
    const { e } = setup()
    rewindOn = true
    // 出發：留入口的快照，之後再花 100、做幾件事
    expect(e.commit({ summary: '出發。', changes: [{ op: 'snapshot.take', kind: 'entry', label: '入口' }] })).toBeNull()
    const atEntry = e.money.cash
    e.ledger([{ op: 'cash', delta: -100 }])
    await lose(e)
    await pick(e, 's1a') // 扣 300、旗標
    await pick(e, 's2a')
    expect(e.money.cash).toBe(atEntry - 100 - 300)
    const reportsBefore = e.state.reports.length
    const logBefore = e.log.length
    expect(e.defeatFlow.accept()).toBeNull()
    expect(e.money.cash).toBe(atEntry)
    expect(e.state.flags.stage1_a).toBeUndefined()
    expect(e.pendingDefeat).toBeNull()
    // 紀錄留著：比之前多（交代回退的那一則），打過那一場、事件的報告還在，標成被收回
    expect(e.state.reports.length).toBeGreaterThan(reportsBefore)
    expect(e.log.length).toBeGreaterThanOrEqual(logBefore)
    expect(e.state.reports.some((r) => r.action === 'battle.end' && r.retracted)).toBe(true)
    expect(e.state.reports.at(-1)!.outcome.summary).toContain('回到出發之前')
  })

  it('事件算不失敗（引擎說了算）時不回退', async () => {
    const { e } = setup()
    rewindOn = true
    expect(e.commit({ summary: '出發。', changes: [{ op: 'snapshot.take', kind: 'entry', label: '入口' }] })).toBeNull()
    const atEntry = e.money.cash
    e.ledger([{ op: 'cash', delta: -100 }])
    const base = BATTLE_SETUPS.hopeless()
    e.startBattle({ ...base, origin: { ...base.origin, ext: { by: 'caller', defeat_event: 'df_ui_soft' } } })
    for (let i = 0; i < 500 && e.battleOptions()?.waiting !== 'over'; i++) {
      if (e.battleOptions()?.waiting === 'ai') e.battleNext()
      else e.battleAct({ action: 'surrender' })
    }
    await e.finishBattle()
    expect(view(e).accept.fails_commission).toBe(false)
    await pick(e)
    expect(e.defeatFlow.accept()).toBeNull()
    expect(e.money.cash).toBe(atEntry - 100)
  })
})

describe('後果兩格：全是引擎 defeatView 的欄位', () => {
  it('第一格：委託失敗或繼續、錢最多被拿多少、裝備；不演版的結果列在裡面；沒有在副本裡時寫「不在委託裡」', async () => {
    const { e, pinia } = setup({ rules: { defeatView: 'skippable' } })
    await lose(e)
    e.defeatFlow.skip()
    const v = view(e)
    const c = consequences(v, e.defeatFlow.commission())
    expect(e.defeatFlow.commission()).toBeNull()
    expect(c.now.rows[0]).toEqual({ k: '委託', v: '不在委託裡（事件算失敗）' })
    expect(c.now.rows.find((r) => r.k === '現金')!.v).toContain(String(v.accept.money_max).replace(/(\d)(?=(\d{3})+$)/g, '$1,'))
    expect(c.now.rows.find((r) => r.k === '裝備與義體')!.v).toBe(v.accept.gear_taken ? '可能被拿走' : '不會被拿走')
    expect(c.now.lines).toEqual(v.accept.lines)
    const h = strip(await html(pinia, DefeatPanel))
    expect(h).toContain('這一次的後果')
    expect(h).toContain('回退時留下的')
    for (const l of v.accept.lines) expect(h).toContain(l)
  })

  it('有人在副本裡時（引擎的 commissionView 有）：算失敗寫「算失敗」並多一列「回到進副本之前」；不算失敗寫「繼續」', () => {
    const v = { accept: { fails_commission: true, money_max: 300, gear_taken: false, lines: [], companions: ['安'] } } as never
    const fail = consequences(v, { name: '藍鯨的帳本' })
    expect(fail.now.rows[0]).toMatchObject({ k: '委託', v: '「藍鯨的帳本」算失敗', tone: 'bad' })
    expect(fail.now.rows.find((r) => r.k === '同行')!.v).toContain('安')
    expect(fail.kept.rows.map((r) => r.k)).toContain('委託失敗')
    const ok = consequences({ accept: { fails_commission: false, money_max: 0, gear_taken: true, lines: [], companions: [] } } as never, { name: '藍鯨的帳本' })
    expect(ok.now.rows[0]).toMatchObject({ v: '「藍鯨的帳本」繼續', tone: 'ok' })
    expect(ok.now.rows.find((r) => r.k === '現金')!.v).toBe('不會被拿')
    expect(ok.kept.rows.map((r) => r.k)).not.toContain('委託失敗')
  })
})

describe('被贖回（defeat.options 多出來的選項）', () => {
  it('有保釋而且現金夠：列出來（名字、說明）；引擎先問，選了之後扣錢並跳過事件', async () => {
    const { e, pinia } = setup({ features: WITH_RANSOM })
    await lose(e)
    // 有多出來的選項時，引擎不論哪一檔都先問
    expect(view(e)).toMatchObject({ step: 'ask', setting: 'always' })
    expect(e.event.view()).toBeNull()
    const ex = choiceGroups(view(e)).extra
    expect(ex).toEqual([{ id: 'ransom', name: '被贖回', can: true, why: null, desc: `付 ${RANSOM} C$，跳過戰敗事件。` }])
    const h = await html(pinia, DefeatPanel)
    expect(h).toContain('data-defeat-option="ransom"')
    expect(strip(h)).toContain('被贖回')
    expect(strip(h)).toContain(`付 ${RANSOM} C$，跳過戰敗事件。`)
    expect(h).not.toContain('data-defeat-option-why')
    const cash0 = e.money.cash
    expect(e.defeatFlow.choose('ransom')).toBeNull()
    expect(e.money.cash).toBe(cash0 - RANSOM)
    expect(e.pendingDefeat).toBeNull()
    expect(e.event.view()).toBeNull()
    expect(e.state.flags.stage1_a).toBeUndefined() // 沒有演事件
    expect(heard[0]!.result.option).toBe('ransom')
    expect(clean(await html(pinia, DefeatPanel))).toBe('')
  })

  it('現金不夠：選項是灰的，寫引擎的原因；按下去被擋、錢不動', async () => {
    const { e, pinia } = setup({ cash: 300, features: WITH_RANSOM })
    await lose(e)
    const o = choice(e, 'ransom')
    expect(o).toMatchObject({ can: false, why: '現金不夠（要 500，現在 300）。' })
    const h = await html(pinia, DefeatPanel)
    expect(h).toMatch(/class="is-unavailable extra"[^>]*data-defeat-option="ransom"/)
    expect(strip(h)).toContain('現金不夠（要 500，現在 300）。')
    expect(isGrey(h, 'data-defeat-option="ransom"') || /is-unavailable/.test(h)).toBe(true)
    expect(e.defeatFlow.choose('ransom')).toBe('現金不夠（要 500，現在 300）。')
    expect(e.money.cash).toBe(300)
    expect(e.pendingDefeat).not.toBeNull()
  })

  it('選了不看之後，被贖回還在（引擎說了算）；事件真的演過之後引擎不再給', async () => {
    const { e } = setup({ rules: { defeatView: 'skippable' }, features: WITH_RANSOM })
    await lose(e)
    e.defeatFlow.skip()
    expect(choiceGroups(view(e)).extra.map((c) => c.id)).toEqual(['ransom'])
    const g = setup({ rules: { defeatView: 'skippable' }, features: WITH_RANSOM })
    await lose(g.e)
    g.e.defeatFlow.watch()
    await pick(g.e)
    await pick(g.e)
    expect(choiceGroups(view(g.e)).extra).toEqual([])
  })
})

describe('重來這場戰鬥、回到這個階段開始時', () => {
  it('演完事件之後重來：回到開打之前再打一次；事件扣的錢與旗標回來了；面板關掉', async () => {
    const { e, pinia } = setup()
    const cash0 = e.money.cash
    await lose(e)
    await pick(e, 's1a')
    await pick(e, 's2a')
    expect(e.money.cash).toBe(cash0 - 300)
    expect(choice(e, 'retry').can).toBe(true)
    expect(e.retryBattle()).toBeNull()
    expect(e.money.cash).toBe(cash0)
    expect(e.state.flags.stage1_a).toBeUndefined()
    expect(e.inBattle).toBe(true)
    expect(e.pendingDefeat).toBeNull()
    expect(e.event.view()).toBeNull()
    expect(clean(await html(pinia, DefeatPanel))).toBe('')
    // 事件扣錢的那幾份報告標成被收回
    expect(e.state.reports.some((r) => r.retracted)).toBe(true)
  })

  it('事件正在演的時候也可以重來；回到階段（不在副本裡）等於重來這場戰鬥', async () => {
    const { e } = setup()
    await lose(e)
    expect(e.event.view()).not.toBeNull()
    expect(e.retryBattle()).toBeNull()
    expect(e.inBattle).toBe(true)
    await (async () => { for (let i = 0; i < 500 && e.battleOptions()?.waiting !== 'over'; i++) { if (e.battleOptions()?.waiting === 'ai') e.battleNext(); else e.battleAct({ action: 'surrender' }) } })()
    await e.finishBattle()
    expect(e.pendingDefeat).not.toBeNull()
    expect(choice(e, 'stage').can).toBe(true)
    expect(e.rewindToStage()).toBeNull()
    expect(e.inBattle).toBe(true)
  })
})

describe('事件視窗嵌在面板裡時，全域的事件對話框讓出來', () => {
  it('面板掛上（hostEvent）之後對話框不開；面板拿掉之後照常開', async () => {
    const { e, pinia } = setup()
    await lose(e)
    expect(e.event.view()).not.toBeNull()
    expect(clean(await html(pinia, EventDialog))).toContain('role="dialog"')
    e.hostEvent(true)
    expect(clean(await html(pinia, EventDialog))).toBe('')
    e.hostEvent(false)
    expect(clean(await html(pinia, EventDialog))).toContain('role="dialog"')
    e.hostEvent(false) // 多放一次不會變成負的
    expect(e.eventInline).toBe(0)
  })
})

// ---- 打贏 ----

/** 把存檔改一下再讀回來：測試用的捷徑（不經引擎的規則，只擺出「戰鬥已經分出結果、敵人怎麼退出」的局面） */
function patch(e: Eng, fn: (s: any) => void): void {
  const f = JSON.parse(e.save())
  fn(f.state)
  expect(e.load(JSON.stringify(f))).toBeNull()
}
/** 一場我方對 n 個假敵人的戰鬥，分出勝負：每個敵人怎麼退出由 outs 決定（down 被打倒；subdued 被制伏且當時感載滿了、失去回合） */
function winSetup(e: Eng, n: number, out: 'down' | 'subdued'): void {
  const base = BATTLE_SETUPS.encounter(1)
  const setup: BattleSetup = { ...base, foes: Array.from({ length: n }, () => ({ from: 'unit', unit: enemyUnit('minion', 1, { enemy: 'en_ui_thug' }) as unknown as Record<string, unknown> })) as never, origin: { ...base.origin, place: '測試用的倉庫', ext: { by: 'caller' } } }
  e.startBattle(setup)
  patch(e, (s) => {
    for (const u of Object.values<any>(s.battle.units)) {
      if (u.side !== 'foe') continue
      u.out = out
      if (out === 'subdued') u.ext = { enemies: { capturable: 'load' } }
    }
    s.battle.result = { outcome: 'win', text: '打完了。' }
  })
}

describe('打贏：戰利品', () => {
  it('戰利品的每一行和戰鬥結束那一份報告裡的一樣；拿到的東西與現金讀報告的變更，背包與現金真的增加', async () => {
    const { e, pinia } = setup()
    const cash0 = e.money.cash
    winSetup(e, 2, 'down')
    expect((await e.finishBattle()).status).toBe('applied')
    const report = [...e.state.reports].reverse().find((r) => r.action === 'battle.end') as Report
    const s = spoilsOf(e.state.reports)!
    expect(s).toMatchObject({ report: report.id, outcome: 'win' })
    expect(s.lines).toEqual(report.narration!.results)
    expect(s.lines.some((l) => l.includes('測試晶片'))).toBe(true)
    // 一般的假敵人一個人掉 1 件（雜兵上限 1），兩個人合成一筆 ×2……數字是引擎的，這裡只對報告
    expect(s.items).toEqual(report.changes.filter((c) => c.op === 'item' && (c.qty as number) > 0).map((c) => ({ id: c.id, qty: c.qty })))
    expect(s.items[0]).toMatchObject({ id: 'it_ui_chip' })
    expect(s.cash).toBe(report.changes.filter((c) => c.op === 'cash' && (c.delta as number) > 0).reduce((n, c) => n + (c.delta as number), 0))
    expect(e.money.cash).toBe(cash0 + s.cash)
    expect(e.state.inventory.filter((x) => x.id === 'it_ui_chip').reduce((n, x) => n + x.qty, 0)).toBe(s.items[0]!.qty)

    const h = await html(pinia, SpoilsPanel, { spoils: s, place: '測試用的倉庫' })
    const text = clean(h)
    // 每一行原樣列出
    const lineTexts = [...text.matchAll(/<li data-loot-line[^>]*>([^<]*)<\/li>/g)].map((m) => m[1])
    expect(lineTexts).toEqual(s.lines)
    // 拿到的東西用名字（引擎的內容）、現金用現金的圖示
    expect(strip(h)).toContain(itemName(e.contentName, 'it_ui_chip'))
    expect(itemName(e.contentName, 'it_ui_chip')).toBe('測試晶片')
    expect(text).toContain('data-loot-item')
    expect(text).toContain('data-loot-cash')
    expect(strip(h)).toContain('勝利')
    expect(strip(h)).toContain('測試用的倉庫')
    // 沒有俘虜：沒有事件，離開是亮的
    expect(text).not.toContain('data-captive')
    expect(isGrey(h, 'data-spoils-leave')).toBe(false)
  })

  it('useAfterBattle：打贏而且有東西可看才開面板；打輸、沒有東西時不開；離開之後關掉', async () => {
    const { e } = setup()
    const a = useAfterBattle()
    winSetup(e, 1, 'down')
    await e.finishBattle()
    expect(a.show()).toBe(true)
    expect(a.spoils.value!.outcome).toBe('win')
    expect(a.holdReason.value).toBeNull()
    a.dismiss()
    expect(a.spoils.value).toBeNull()

    // 打輸：最近一份戰鬥結束的報告不是 win，不開戰利品面板
    const g = setup()
    const b = useAfterBattle()
    await lose(g.e)
    expect(b.show()).toBe(false)
    expect(b.spoils.value).toBeNull()
  })

  it('什麼都沒拿到而且沒有俘虜：不開面板（直接離開）；spoilsOf 不看被收回的報告', () => {
    const rep = (o: Partial<Report>): Report => ({ id: 'r', kind: 'combat', action: 'battle.end', time: { start: { day: 1, hour: 0, minute: 0 }, end: { day: 1, hour: 0, minute: 0 } }, location: {}, party: [], timeline: [], changes: [], outcome: { result: 'win', summary: 'x' }, ...o }) as Report
    expect(spoilsOf([rep({ id: 'a', retracted: true, narration: { results: ['拿到 A'] } })])).toBeNull()
    expect(spoilsOf([rep({ id: 'a', narration: { results: ['拿到 A'] }, changes: [{ op: 'item', id: 'x', qty: 2 } as never, { op: 'item', id: 'y', qty: -1 } as never, { op: 'cash', delta: 50 } as never, { op: 'cash', delta: -5 } as never] })])).toEqual({ report: 'a', outcome: 'win', lines: ['拿到 A'], items: [{ id: 'x', qty: 2 }], cash: 50 })
    expect(spoilsOf([])).toBeNull()
  })
})

describe('打贏：俘虜的處置（事件視窗的選項嵌在面板裡）', () => {
  /** 找一個擲得中俘虜的種子（引擎的亂數是種子導出來的，同一個種子永遠同一個結果） */
  async function withCaptive() {
    for (let seed = 1; seed <= 60; seed++) {
      const s = setup({ seed })
      winSetup(s.e, 4, 'subdued')
      await s.e.finishBattle()
      if (s.e.event.view()) return s
    }
    throw new Error('找不到擲得中俘虜的種子')
  }

  it('有俘虜：選項照引擎的（帶走在有場景、對象非自願沒關時才列），面板的選項和引擎的一模一樣；選完之後面板關掉', async () => {
    const { e, pinia } = await withCaptive()
    const a = useAfterBattle()
    expect(a.show()).toBe(true)
    // 成功的不只一個時，引擎先開「挑一個」（選項 pick:<單位>）；面板列的和引擎的一模一樣。
    // （挑完之後的處置事件現在開不起來：引擎的 scout_reveal 在沒有委託時格式不合，見回報；所以這裡走「全部放走」收尾）
    const ev = e.event.view()!
    const ids = ev.options.map((o) => o.id)
    expect(ids.length).toBeGreaterThanOrEqual(2)
    expect(ids.length).toBeLessThanOrEqual(4)
    expect(ids.every((id) => id.startsWith('pick:'))).toBe(true)
    const h = await html(pinia, SpoilsPanel, { spoils: a.spoils.value!, place: '測試用的倉庫' })
    const shown = [...clean(h).matchAll(/data-opt="([^"]+)"/g)].map((m) => m[1])
    expect(shown).toEqual(ids)
    expect(clean(h)).toContain('data-captive')
    // 事件還開著：離開是灰的、原因寫出來
    expect(a.holdReason.value).toBeTruthy()
    expect(isGrey(h, 'data-spoils-leave')).toBe(true)
    expect(strip(h)).toContain(a.holdReason.value!)
    // 全部放走（「我要做別的」）：事件做完、俘虜的狀態被引擎清掉，離開亮起來
    expect((await e.event.free('算了，都放走。')).status).not.toBe('refused')
    expect(e.event.view()).toBeNull()
    expect(e.state.ext.capture ?? null).toBeNull()
    expect(a.holdReason.value).toBeNull()
    const after = await html(pinia, SpoilsPanel, { spoils: a.spoils.value!, place: '測試用的倉庫' })
    expect(isGrey(after, 'data-spoils-leave')).toBe(false)
    a.dismiss()
    expect(a.spoils.value).toBeNull()
  })

  it('選「帶走」：事件開的成人場景在畫面還沒做之前只有「略過」，略過之後面板才放行', async () => {
    const { e, pinia } = await withCaptive()
    const a = useAfterBattle()
    a.show()
    const take = e.event.view()!.options.find((o) => o.id === 'take')
    if (!take) return // 帶走沒有列（引擎說這一局沒有人登記成人場景或被篩掉）：沒有場景要略過
    expect(take.locked ?? null).toBeNull()
    await pick(e, 'take')
    expect(e.sceneGate.active()).toBe(true)
    expect(a.holdReason.value).toBe('成人場景還沒結束。')
    const h = await html(pinia, SceneGate)
    expect(clean(h)).toContain('data-scene-gate')
    expect(clean(h)).toContain('data-scene-skip')
    expect(e.sceneGate.skip()).toBeNull()
    expect(e.sceneGate.active()).toBe(false)
  })
})

// ---- 面板與 afterBattleView 裡沒有規則 ----

import deathSrc from '../../src/components/combat/DefeatPanel.vue?raw'
import spoilsSrc from '../../src/components/combat/SpoilsPanel.vue?raw'
import gateSrc from '../../src/components/combat/SceneGate.vue?raw'
import bodySrc from '../../src/components/EventBody.vue?raw'
import viewSrc from '../../src/lib/afterBattleView.ts?raw'
import hookSrc from '../../src/lib/useAfterBattle.ts?raw'
const code = (src: string) => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/<!--[\s\S]*?-->/g, '').replace(/^\s*\/\/.*$/gm, '')

describe('面板與 afterBattleView.ts 裡沒有機率與金額的算式', () => {
  const SOURCES: Record<string, string> = { 'DefeatPanel.vue': deathSrc, 'SpoilsPanel.vue': spoilsSrc, 'SceneGate.vue': gateSrc, 'EventBody.vue': bodySrc, 'afterBattleView.ts': viewSrc, 'useAfterBattle.ts': hookSrc }
  for (const [name, src] of Object.entries(SOURCES)) {
    it(`${name}：不擲骰、不算機率與金額、不自己判斷接受之後會怎樣`, () => {
      const c = code(src)
      expect(c).not.toMatch(/Math\.random|\brng\b|deriveRng|\.next\(\)|\brollDie\b|\brollDice\b/)
      expect(c).not.toMatch(/captureChance|rollCaptures|askDc|CAPTURE_|LOOT_|CASH_RANGE|moneyLimit|failsAfter|rewriteEffects|defeatMoneyLoss|defeatMoneyCap|defeatTakeGear/)
      expect(c).not.toMatch(/\*\s*(0\.\d|rules\.|state\.rules)|Math\.(floor|round|ceil|min|max)\(/)
      // 金額、百分率只顯示不計算：沒有 money 或 cash 參與的乘除與加減
      const script = c.match(/<script[\s\S]*?<\/script>/)?.[0] ?? c
      expect(script).not.toMatch(/(cash|money|cred)\w*\s*[-+*/]\s*\w|\w\s*[-+*/]\s*(cash|money|cred)\b/i)
    })
  }
  it('面板不 import 引擎的規則函式（defeatOptions、rewriteOf 等）；只讀 store 的 defeatFlow', () => {
    for (const src of [deathSrc, spoilsSrc]) expect(code(src)).not.toMatch(/@engine\/src\/features/)
    expect(code(deathSrc)).toMatch(/defeatFlow/)
  })
})

describe('手機版：面板直向排、三選一固定在底部', () => {
  it('DefeatPanel：720 以下主欄一欄、三選一 sticky 固定在底部；選項不超出畫面', () => {
    const media = deathSrc.match(/@media \(max-width: 720px\) \{([\s\S]*?)\n\}/)
    expect(media, '要有手機的 media').toBeTruthy()
    expect(media![1]).toMatch(/\.da-main \{ grid-template-columns: minmax\(0, 1fr\)/)
    expect(media![1]).toMatch(/\.da-final \{[^}]*position: sticky; bottom: 0/)
    expect(deathSrc).toMatch(/\.da \{ min-width: 0; \}/)
    expect(deathSrc).toMatch(/overflow-wrap: anywhere/)
  })
})
