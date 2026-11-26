// 驗收測試：dev/work/M4-ui-contract.md（cpp-ui）。契約面板的兩面（主角是契約人、主角是持約人）、掃橋多出來的幾行、蠱惑（找過主角的流竄 AI）、
// 惡意韌體、調校與靜室、請教，全部接引擎的 features/contract、security、lure、malware、tuning、abilities。
// 引擎用真的；內容是示意世界包（它自己的資料，data/demo/contract.ts 等）加核心包，掃橋那一條用測試自帶的最小世界。
// 畫面用 Vue 的伺服器端渲染轉成 HTML 檢查（沒有瀏覽器）；「點按鈕」就是呼叫 store 的動作（元件的 onclick 只是接上它們）。

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { createMemoryHistory, createRouter } from 'vue-router'
import { createSSRApp } from 'vue'
import type { Component } from 'vue'
import { renderToString } from 'vue/server-renderer'
import type { ContentPack, Feature } from '@engine/src'
import { FakeProvider, Game, effectCtx } from '@engine/src'
import { CORE_PACK } from '@engine/data'
import { allFeatures } from '@engine/src/features'
import { boundView, holderContractView, holderEvents } from '@engine/src/features/contract'
import { scanView } from '@engine/src/features/security'
import { useEngine } from '../../src/stores/engine'
import { DEMO_AI, DEMO_HOLDER_NPC, DEMO_STILL, DEMO_TEACHER_NPC, blockIdOf, demoPack, demoStartFeature, withDemoOrigins } from '../../src/data/demo'
import { markerOfFacility } from '../../src/data/demo/world'
import ContractDialog from '../../src/dialogs/ContractDialog.vue'
import ScanDialog from '../../src/dialogs/ScanDialog.vue'
import AdultTab from '../../src/dialogs/character/AdultTab.vue'
import BridgeTab from '../../src/dialogs/character/BridgeTab.vue'
import TalkDialog from '../../src/dialogs/TalkDialog.vue'
import BoundPanel from '../../src/components/contract/BoundPanel.vue'
import HolderPanel from '../../src/components/contract/HolderPanel.vue'
import TuningPanel from '../../src/components/body/TuningPanel.vue'
import MalwarePanel from '../../src/components/body/MalwarePanel.vue'
import TeachPanel from '../../src/components/TeachPanel.vue'
import { freshEffects } from '../../src/lib/engineView'
import { leftText, orderRows, personRows } from '../../src/lib/contractView'
import contractDialogSrc from '../../src/dialogs/ContractDialog.vue?raw'
import boundSrc from '../../src/components/contract/BoundPanel.vue?raw'
import holderSrc from '../../src/components/contract/HolderPanel.vue?raw'
import newGameSrc from '../../src/screens/NewGameScreen.vue?raw'
import profileSrc from '../../src/data/profile.ts?raw'
import items2Src from '../../src/data/items2.ts?raw'

vi.mock('../../src/router', () => ({ FULL_PAGES: [{ path: '/', name: '主畫面' }], router: {} }))

type Rec = Record<string, unknown>
type Eng = ReturnType<typeof useEngine>

const DRAFT = {
  name: '露', gender: 'female', age: 22, origin: 'hive', originChoice: { favor: 'lonestar' },
  attrPick: { reflex: 15, charm: 14, intellect: 13, body: 12, resolve: 10, tech: 8 },
  attrBonus: { tech: -4, reflex: 3, resolve: 3 },
  skills: { streetwise: 3, negotiate: 3, perform: 2, stealth: 2 },
  perks: ['smooth_talker', 'tough'],
}

const router = () => createRouter({ history: createMemoryHistory(), routes: [{ path: '/', component: { render: () => null } }] })
async function render(pinia: ReturnType<typeof createPinia>, comp: Component, props: Rec = {}): Promise<string> {
  const r = router()
  await r.push('/')
  await r.isReady()
  const app = createSSRApp(comp, props)
  app.use(pinia)
  app.use(r)
  return renderToString(app)
}
const clean = (s: string) => s.replace(/<!--[\s\S]*?-->/g, '')
const text = (s: string) => clean(s).replace(/<[^>]+>/g, '').replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;/g, "'")
/** 屬性值裡的逐字比對（title 與 data-* 會把引號與 & 轉義） */
const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

/** 示意世界包開一局（建角走真的流程）；start 是開局的契約。 */
function startDemo(start: 'normal' | 'bound' | 'holder') {
  const pinia = createPinia()
  setActivePinia(pinia)
  const e = useEngine()
  expect(e.newGame({ seed: 7, rules: {}, draft: DRAFT as never, start, demo: { on: true } })).toEqual([])
  return { e, pinia }
}
/** 另一個獨立的引擎讀同一份存檔：直接呼叫引擎函式，當標準答案、也拿來產生效果的變更。 */
function oracle(e: Eng, features: Feature[] = []): Game {
  const g = new Game({ features: [...allFeatures(), demoStartFeature(), ...features], content: [withDemoOrigins(CORE_PACK), demoPack()], fakeProvider: new FakeProvider() })
  expect(g.load(e.save())).toBeNull()
  return g
}
/** 用內建的來源套一串效果並提交（變更是另一個引擎算的，這邊只是 commit）。 */
function fx(e: Eng, effects: Rec[]): void {
  const g = oracle(e)
  const ctx = effectCtx(g.k, g.state, { source: 'builtin', actor: g.state.pc! })
  expect(g.k.effects.validate(effects as never, ctx)).toEqual([])
  const res = g.k.effects.resolve(effects as never, ctx)
  expect(res.errors).toEqual([])
  expect(e.commit({ summary: '測試的效果', changes: res.changes })).toBeNull()
}
const wait = (e: Eng, minutes: number) => expect(e.commit({ summary: '等', changes: [{ op: 'time', minutes }] as never })).toBeNull()

beforeEach(() => setActivePinia(createPinia()))

// ================= 主角是契約人 =================

describe('契約人這一面：契約、佇列、照做與抗拒', () => {
  it('示意開局「主角是契約人」：一份伊甸園的債務契約、佇列三條、沒有多一份「簽約」的紀錄', () => {
    const { e } = startDemo('bound')
    const v = e.contract.bound()!
    expect(v).toMatchObject({ type: 'debt', type_name: '債務契約', debt: 24000 })
    expect(v.holder.name).toBe('伊甸園')
    expect(v.queue.map((o) => o.kind)).toEqual(['errand', 'work', 'report'])
    expect(v.queue.every((o) => o.state === 'sent')).toBe(true)
    expect(e.contract.held()).toEqual([])
    expect(e.state.reports.filter((r) => (r.action ?? '').startsWith('contract.'))).toHaveLength(0)
  })

  it('面板的每一欄等於 boundView：持約人、契約、債、規矩、勾的指令、佇列每一條的狀態與地點', async () => {
    const { e, pinia } = startDemo('bound')
    const truth = boundView(oracle(e).k, oracle(e).state)!
    const h = clean(await render(pinia, BoundPanel))
    expect(h).toContain('data-bound')
    expect(text(h)).toContain(truth.holder.name)
    expect(h).toMatch(/data-type[^>]*>債務契約</)
    expect(text(h)).toContain('還欠 C$24,000')
    expect(h).toMatch(/data-relation[^>]*>名實相符</)
    for (const o of truth.orders) expect(h).toContain(`data-order-kind="${o.kind}" data-ticked="${o.ticked}"`)
    expect(h.match(/data-rule[ >]/g)).toHaveLength(truth.rules.length)
    expect(text(h)).toContain(`${Math.round(truth.daily_chance * 100)}%`)
    for (const o of truth.queue) {
      expect(h).toContain(`data-order="${o.id}"`)
      expect(h).toContain(`data-state="${o.state_name}"`)
      if (o.place_name) expect(text(h)).toContain(`地點：${o.place_name}`)
      expect(text(h)).toContain(o.on_overdue!.join('、'))
    }
    // 還沒回應的那三條都有「照做」與「抗拒」，抗拒的旁邊是引擎的 DC 與成功率
    expect(h.match(/data-comply/g)).toHaveLength(3)
    for (const r of orderRows(e.contract.bound()!)) expect(text(h)).toContain(r.resistText)
    expect(text(h)).toMatch(/DC \d+・成功率 \d+%/)
  })

  it('抗拒：佇列那一條的狀態照引擎（抗拒成功或變成強制）；照做：變成照做中', async () => {
    const { e, pinia } = startDemo('bound')
    const [errand, work] = e.contract.bound()!.queue
    expect(e.contract.choose(work!.id, 'comply')).toBeNull()
    expect(e.contract.bound()!.queue.find((o) => o.id === work!.id)!.state).toBe('doing')
    expect(e.contract.choose(errand!.id, 'resist')).toBeNull()
    const report = e.state.reports.filter((r) => r.action === 'contract.choose').at(-1)!
    const after = e.contract.bound()!.queue.find((o) => o.id === errand!.id)!
    expect(after.state).toBe(report.outcome.result === 'resisted' ? 'resisted' : 'forced')
    const h = clean(await render(pinia, BoundPanel))
    expect(h).toContain(`data-order="${errand!.id}" data-state="${after.state_name}"`)
    // 被擋下的原因是引擎的：已經回應過的不能再選
    expect(e.contract.chooseBlock(errand!.id, 'comply')).toBe('這一條指令已經回應過了。')
    expect(e.contract.choose(errand!.id, 'comply')).toBe('這一條指令已經回應過了。')
  })

  it('逾期的那一條標成紅的，而且寫了處置（引擎在紀錄裡寫的）；還沒了結的寫「逾期會怎樣」（引擎的 on_overdue）', async () => {
    const { e, pinia } = startDemo('bound')
    const work = e.contract.bound()!.queue.find((o) => o.kind === 'work')!
    expect(e.contract.choose(work.id, 'comply')).toBeNull()
    wait(e, 13 * 60)
    const view = e.contract.bound()!.queue.find((o) => o.id === work.id)!
    expect(view.state).toBe('overdue')
    // 了結的那一條帶引擎給的處置（OrderView.outcome），不從報告的正文比對
    expect(view.outcome?.text).toBeTruthy()
    const row = orderRows(e.contract.bound()!).find((r) => r.id === work.id)!
    expect(row.overdue).toBe(true)
    expect(row.penalty).toBe(view.outcome!.text)
    const h = clean(await render(pinia, BoundPanel))
    expect(h).toMatch(new RegExp(`data-order="${work.id}" data-state="逾期" data-overdue="true"`))
    expect(text(h)).toContain(`處置：${row.penalty}`)
    // 同一刻還沒到期的別條照常：寫逾期會怎樣（作廢）
    const errand = e.contract.bound()!.queue.find((o) => o.kind === 'errand')!
    expect(errand.on_overdue).toEqual(['作廢，滿意下降'])
    expect(h).toMatch(new RegExp(`data-order="${errand.id}" data-state="送達" data-overdue="false"`))
    expect(text(h)).toContain('逾期會：作廢，滿意下降')
    // 倒數的字樣：過期的寫「已經過期」
    expect(leftText(-90)).toBe('已經過期 2 小時')
    expect(leftText(125)).toBe('2 小時 5 分')
    expect(leftText(3000)).toBe('2 天 2 小時')
  })

  it('人在指定的地方：照做之後 arriveBlock 成立，走到了送出觸發點、事件接手；主動要一條與還清都走引擎', async () => {
    const { e } = startDemo('bound')
    const work = e.contract.bound()!.queue.find((o) => o.kind === 'work')!
    // 還沒回應：先選照做才走得過去（引擎的原因）
    expect(e.contract.arriveBlock(work.id)).toBe('這一條指令你還沒回應：先選照做，再走過去。')
    expect(e.contract.choose(work.id, 'comply')).toBeNull()
    // 工作的地點是開局站的四號塔
    expect(e.contract.arriveBlock(work.id)).toBeNull()
    expect(e.contract.arrive(work.id)).toBeNull()
    expect(e.state.reports.some((r) => r.action === 'contract.arrive')).toBe(true)
    expect(e.contract.arriveBlock(work.id)).toBe('你已經到過那裡了。')
    // 導演從範圍 contract 挑了示範的指令事件：開著，擋住別的操作；選完之後那一條由事件的 order_done 收尾
    const ev = e.event.view()!
    expect(ev).not.toBeNull()
    // 契約的回話在任何活動裡都能做（使用者 2026-11-26 裁決 2）；別的事（睡覺之類）仍然被事件擋住
    expect(e.contract.chooseBlock(e.contract.bound()!.queue.find((o) => o.kind === 'report')!.id, 'resist')).toBeNull()
    expect(e.blockOf('commit:rest.sleep')).toMatch(/眼前有一件事要先回應/)
    expect((await e.event.choose(ev.options[0]!.id)).status).toBe('applied')
    expect(e.event.view()).toBeNull()
    expect(e.contract.bound()!.queue.find((o) => o.id === work.id)!.state).toBe('done')
    // 還有兩條沒了結：可以要一條，要來的是照做中、標「你要的」；佇列滿了（三條）就不能再要，原因是引擎的
    expect(e.contract.askBlock('errand')).toBeNull()
    expect(e.contract.askOrder('errand')).toBeNull()
    expect(e.contract.bound()!.queue.some((o) => o.asked && o.state === 'doing')).toBe(true)
    expect(e.contract.askBlock('errand')).toMatch(/還有指令沒做完/)
    expect(e.contract.askOrder('errand')).toMatch(/還有指令沒做完/)
  })

  it('還清：價錢與談價的資格是引擎的；錢不夠的原因逐字用引擎的；付清之後契約沒了', async () => {
    const { e, pinia } = startDemo('bound')
    const q = e.contract.payoffQuote()!
    const g = oracle(e)
    expect(q).toEqual(boundView(g.k, g.state)!.payoff)
    expect(q.debt).toBe(24000)
    e.ledger([{ op: 'cred', delta: -e.money.cred }, { op: 'cash', delta: -e.money.cash }] as never)
    const why = e.contract.payoffBlock()
    expect(why).toMatch(/錢不夠/)
    const h = clean(await render(pinia, BoundPanel))
    expect(h).toContain(esc(why!))
    e.ledger([{ op: 'cred', delta: q.price + 10 }] as never)
    expect(e.contract.payoffBlock()).toBeNull()
    expect(e.contract.payoff()).toBeNull()
    expect(e.contract.bound()).toBeNull()
    // 沒有契約了：面板只寫一句話
    const dlg = text(await render(pinia, ContractDialog))
    expect(dlg).toContain('沒有管理級的契約')
  })

  it('光紋：遮不遮是引擎的（沒有遮標頸環的東西時原因是引擎的那一句）', () => {
    const { e } = startDemo('bound')
    expect(e.contract.coverBlock(true)).toBe('你身上沒有能遮光紋的東西（遮標頸環、遮瑕貼之類）。')
    expect(e.contract.coverBlock(false)).toBe('光紋本來就露著。')
  })

  it('指令送達是一則通知：每天的與每週回報的指令（contract.order）進通知，主動要的不算', () => {
    const r = (result: string) => ({ action: 'contract.order', outcome: { summary: '伊甸園派了一條差事給你。', result } })
    expect(freshEffects([r('sent')]).toasts).toEqual(['伊甸園派了一條差事給你。'])
    expect(freshEffects([r('weekly')]).toasts).toHaveLength(1)
    expect(freshEffects([r('asked')]).toasts).toEqual([])
  })
})

// ================= 主角是持約人 =================

describe('持約人這一面：事件頁、契約頁', () => {
  it('示意開局「主角是持約人」：阿音是你持有的人；兩頁讀引擎的 holderEvents 與 holderContractView', async () => {
    const { e, pinia } = startDemo('holder')
    expect(e.contract.held().map((x) => x.id)).toEqual([DEMO_HOLDER_NPC])
    expect(e.contract.bound()).toBeNull()
    const g = oracle(e)
    const truth = holderEvents(g.k, g.state, DEMO_HOLDER_NPC)
    expect(truth.map((x) => x.kind)).toEqual(['errand', 'modify', 'serve', 'work', 'talk'])
    const h = clean(await render(pinia, HolderPanel, { npc: DEMO_HOLDER_NPC }))
    for (const ev of truth) expect(h).toContain(`data-event="${ev.kind}" data-available="${ev.available}"`)
    expect(h).toContain('data-page="events"')
    // 契約頁的欄位
    const v = holderContractView(g.k, g.state, DEMO_HOLDER_NPC)!
    expect(e.contract.holder(DEMO_HOLDER_NPC)).toEqual(v)
    expect(v).toMatchObject({ name: '阿音', debt: 6000 })
  })

  it('觸發一次之後：那一種今天灰掉、原因是引擎的；事件視窗開著；別種照樣能做', async () => {
    const { e, pinia } = startDemo('holder')
    expect(e.contract.triggerBlock(DEMO_HOLDER_NPC, 'errand')).toBeNull()
    expect(e.contract.trigger(DEMO_HOLDER_NPC, 'errand')).toBeNull()
    const g = oracle(e)
    const ev = holderEvents(g.k, g.state, DEMO_HOLDER_NPC)
    const errand = ev.find((x) => x.kind === 'errand')!
    expect(errand.available).toBe(false)
    expect(errand.reason).toMatch(/今天已經對阿音做過/)
    expect(e.contract.events(DEMO_HOLDER_NPC).find((x) => x.kind === 'errand')!.reason).toBe(errand.reason)
    expect(e.contract.trigger(DEMO_HOLDER_NPC, 'errand')).toBe(errand.reason)
    const h = clean(await render(pinia, HolderPanel, { npc: DEMO_HOLDER_NPC }))
    expect(h).toContain('data-event="errand" data-available="false"')
    expect(h).toContain(esc(errand.reason!))
    // 事件是導演從範圍 contract 挑的，視窗開著（開著時別的操作先被擋，原因是引擎的）
    const open = e.event.view()!
    expect(open).not.toBeNull()
    expect(e.contract.triggerBlock(DEMO_HOLDER_NPC, 'talk')).toBe('眼前有一件事要先回應：選一個選項，或寫下你要做的別的事。')
    expect((await e.event.choose(open.options[0]!.id)).status).toBe('applied')
    expect(e.contract.triggerBlock(DEMO_HOLDER_NPC, 'talk')).toBeNull()
    expect(clean(await render(pinia, HolderPanel, { npc: DEMO_HOLDER_NPC }))).toContain('data-event="talk" data-available="true"')
  })

  it('把關係改成夥伴：親密度不夠時灰掉，原因在引擎、調整項目、畫面三處逐字相同', async () => {
    const { e, pinia } = startDemo('holder')
    expect(e.commit({ summary: '冷下來', changes: [{ op: 'meter', kind: 'affinity', key: DEMO_HOLDER_NPC, set: 10 }] as never })).toBeNull()
    const why = e.contract.adjustBlock(DEMO_HOLDER_NPC, { relation: 'partner' })
    expect(why).toMatch(/親密度還不到/)
    const g = oracle(e)
    const item = holderContractView(g.k, g.state, DEMO_HOLDER_NPC)!.adjust.find((a) => a.key === 'relation')!
    expect(item.options!.find((o) => o.value === 'partner')!.blocked).toBe(why)
    // 名實相符永遠可以（但本來就是這一個）
    expect(item.options!.find((o) => o.value === 'formal')!.blocked).toMatch(/已經是/)
    // 畫面：契約頁的「夥伴」那一顆灰掉，title 就是引擎的原因（逐字）；名實相符那一顆也標原因
    const paper = clean(await render(pinia, HolderPanel, { npc: DEMO_HOLDER_NPC, page: 'paper' }))
    expect(paper).toMatch(new RegExp(`aria-disabled="true"[^>]*title="${esc(why!)}"[^>]*data-relation-opt="partner"`))
    expect(e.contract.adjust(DEMO_HOLDER_NPC, { relation: 'partner' })).toBe(why)
    expect(e.contract.holder(DEMO_HOLDER_NPC)!.relation).toBe('formal')
    // 親密度夠時可以改，改完引擎的 relation 變了
    expect(e.commit({ summary: '熱起來', changes: [{ op: 'meter', kind: 'affinity', key: DEMO_HOLDER_NPC, set: 60 }] as never })).toBeNull()
    expect(e.contract.adjust(DEMO_HOLDER_NPC, { relation: 'partner' })).toBeNull()
    expect(e.contract.holder(DEMO_HOLDER_NPC)!.relation).toBe('partner')
    const h = clean(await render(pinia, HolderPanel, { npc: DEMO_HOLDER_NPC }))
    expect(h).toMatch(/data-relation[^>]*>實為夥伴</)
    expect(clean(await render(pinia, HolderPanel, { npc: DEMO_HOLDER_NPC, page: 'paper' }))).toMatch(/data-relation-opt="partner"/)
  })

  it('調整契約：規矩、分帳、工作都走引擎，擋住的原因（沒有改動）也是引擎的', () => {
    const { e } = startDemo('holder')
    expect(e.contract.adjust(DEMO_HOLDER_NPC, { split: 0.3, job: '麵攤洗碗', rules_add: [{ kind: 'curfew', value: '01:00' }] })).toBeNull()
    const v = e.contract.holder(DEMO_HOLDER_NPC)!
    expect(v).toMatchObject({ split: 0.3, job: '麵攤洗碗' })
    expect(v.rules).toEqual([{ kind: 'curfew', value: '01:00' }])
    expect(e.contract.adjustBlock(DEMO_HOLDER_NPC, { split: 0.3 })).toBe('分帳已經是這樣了。')
    expect(e.contract.adjustBlock(DEMO_HOLDER_NPC, { rules_remove: [{ kind: 'zone', value: '沒有這一條' }] })).toBe('契約上沒有這一條規矩可以拿掉。')
    // 出借：沒有「契約支配」以外的擋住時可以借，借出去之後叫回來
    expect(e.contract.adjust(DEMO_HOLDER_NPC, { lend: { to: '老闆', hours: 5 } })).toBeNull()
    expect(e.contract.holder(DEMO_HOLDER_NPC)!.lent!.to).toBe('老闆')
    expect(e.contract.adjust(DEMO_HOLDER_NPC, { lend: null })).toBeNull()
  })

  it('面板開關前後引擎的狀態沒有變（深比較）：對話框、名冊鈕、說話頁的契約鈕只讀', async () => {
    const { e, pinia } = startDemo('holder')
    const before = JSON.stringify(e.state)
    await render(pinia, ContractDialog, { entryId: 1, npcId: DEMO_HOLDER_NPC, side: 'held' })
    await render(pinia, HolderPanel, { npc: DEMO_HOLDER_NPC })
    await render(pinia, ContractDialog, { entryId: 2 })
    expect(JSON.stringify(e.state)).toBe(before)
    const bound = startDemo('bound')
    const b0 = JSON.stringify(bound.e.state)
    await render(bound.pinia, ContractDialog, { entryId: 1 })
    await render(bound.pinia, BoundPanel)
    expect(JSON.stringify(bound.e.state)).toBe(b0)
  })

  it('解約要確認：面板有確認步驟；按下確認才送，留旗標 released:<npc>、阿音不再是你持有的人', async () => {
    expect(holderSrc).toContain('data-release-confirm')
    expect(holderSrc).toContain('confirming')
    const { e, pinia } = startDemo('holder')
    expect(e.contract.releaseBlock(DEMO_HOLDER_NPC, true)).toBeNull()
    expect(e.contract.release(DEMO_HOLDER_NPC, true)).toBeNull()
    expect(e.contract.held()).toEqual([])
    expect(e.state.flags[`released:${DEMO_HOLDER_NPC}`]).toBe(true)
    expect(e.contract.release(DEMO_HOLDER_NPC)).toBe('他不是你持有契約的人。')
    expect(text(await render(pinia, HolderPanel, { npc: DEMO_HOLDER_NPC }))).toContain('你沒有持有這個人的契約')
  })

  it('身上被裝了什麼：引擎的 cyberView（可以問任何一個角色）；契約鈕與名冊的入口只在持約人那裡', async () => {
    const { e, pinia } = startDemo('holder')
    const body = e.contract.cyberOf(DEMO_HOLDER_NPC)!
    expect(body.actor).toBe(DEMO_HOLDER_NPC)
    expect(body.parts).toHaveLength(11)
    // 契約頁多一塊「身上被裝了什麼」（在能調的項目與解約之前）
    const paper = clean(await render(pinia, HolderPanel, { npc: DEMO_HOLDER_NPC, page: 'paper' }))
    expect(paper).toContain('data-body')
    expect(text(paper)).toContain('身上被裝了什麼')
    expect(text(paper)).toContain(`沉溺的下限${body.sink_floor}`)
    expect(paper.indexOf('data-body')).toBeLessThan(paper.indexOf('data-adjust'))
    expect(paper.indexOf('data-adjust')).toBeLessThan(paper.indexOf('data-release'))
    // 說話頁：持約人多一顆「契約」，不是持約人的沒有
    expect(clean(await render(pinia, TalkDialog, { entryId: 1, npcId: DEMO_HOLDER_NPC }))).toContain('data-open-contract')
  })
})

describe('契約面板的兩面與原始碼', () => {
  it('ContractDialog 不 import data/contracts（假資料已經拿掉），元件裡沒有規則的算式', () => {
    for (const src of [contractDialogSrc, boundSrc, holderSrc]) {
      expect(src).not.toMatch(/data\/contracts/)
      expect(src).not.toMatch(/Math\.random|rollCheck|computeDegree/)
    }
    expect(contractDialogSrc).toContain('eng.contract.bound')
    expect(boundSrc).toContain('eng.contract.choose')
    expect(holderSrc).toContain('eng.contract.trigger')
  })

  it('兩個示意開局各走得到面板；新局畫面有三個開局的選項', async () => {
    const a = startDemo('bound')
    const hb = text(await render(a.pinia, ContractDialog, { entryId: 1 }))
    expect(hb).toContain('你身上的契約')
    expect(hb).toContain('指令佇列')
    const b = startDemo('holder')
    const hh = text(await render(b.pinia, ContractDialog, { entryId: 1 }))
    expect(hh).toContain('你是持約人')
    expect(hh).toContain('阿音')
    expect(newGameSrc).toContain('data-start-kind')
    for (const id of ['normal', 'bound', 'holder']) expect(newGameSrc).toContain(`'${id}'`)
    // 契約開局只在示意模式（開新局的開關）才選得到；關著時送出去的永遠是一般開局
    expect(newGameSrc).toContain('data-demo-on')
    expect(newGameSrc).toContain("start: demoOn.value ? startKind.value : 'normal'")
    // 一般開局沒有契約
    const c = startDemo('normal')
    expect(c.e.contract.bound()).toBeNull()
    expect(c.e.contract.held()).toEqual([])
  })
})

// ================= 掃橋 =================

describe('掃橋多的幾行（scanView.person）', () => {
  const MAP = (id: string, rows: string[]) => ({ id, kind: 'street', size: [10, 3], sheets: [{ id: 'street', name: '街', size: [10, 3], layout: rows, cells: [{ id: 'F1', at: [1, 1], mark: 'F', name: '車站' }, { id: 'E1', at: [0, 1], mark: 'E', name: '西口' }], spots: [{ id: '!1', at: [3, 1], cover: 'sparse' }, { id: '!2', at: [8, 1], cover: 'dense' }] }] })
  const PACK: ContentPack = {
    id: 'scan_person_test',
    content: {
      special_map: [MAP('m_a', ['##########', 'EF.1....2#', '##########']), MAP('m_b', ['##########', 'EF.1....2#', '##########'])],
      facility_type: [{ id: 'fac_station', name: '車站' }],
      district: [{ id: 'd_a', name: '甲區', grade: 1, blocks: ['b_a', 'b_b'] }],
      block: [
        { id: 'b_a', district: 'd_a', name: '甲街', kind: 'block', map: 'm_a', exits: {}, facilities: { F1: { type: 'fac_station', name: '甲站' } } },
        { id: 'b_b', district: 'd_a', name: '乙街', kind: 'block', map: 'm_b', exits: {}, facilities: { F1: { type: 'fac_station', name: '乙站' } } },
      ],
      transit_line: [{ id: 'line_scan', name: '掃描線', kind: 'metro', minutes_per_stop: 5, wait: [3, 3], fare: { base: 2, per_stop: 1 }, pay: ['cred'], scan: 2, stops: [{ id: 's1', name: '甲站', block: 'b_a', at: 'F1' }, { id: 's2', name: '乙站', block: 'b_b', at: 'F1' }] }],
      transit_rule: [{ id: 'default', km: [] }],
    } as unknown as ContentPack['content'],
  }
  /** 替身：回答 scan.person（一件違禁的義體、一件登記類） */
  const answers = (answer: Rec): Feature => ({ id: 'scan_person_stub', install: (k) => k.hooks.on('scan.person' as never, 'scan_person_stub', (() => answer) as never) })
  const STUB = answers({
    cyber: { count: 2, items: [{ uid: 'u1', name: '違禁的義臂', legal: 'banned', registered: false }, { uid: 'u2', name: '登記過的義眼', legal: 'register', registered: true }] },
    contract: { class: 'bound', holder: '伊甸園', level: 'manage', covered: false },
  })

  async function scanning(features: Feature[]) {
    const pinia = createPinia()
    setActivePinia(pinia)
    const e = useEngine()
    e.newGame({ seed: 7, testContent: [PACK], testFeatures: features })
    expect(e.createCharacter(DRAFT as never)).toEqual([])
    e.ledger([{ op: 'cred', delta: 500 - e.money.cred }] as never)
    expect((await e.world.arrive('b_a', 'E1')).status).toBe('applied')
    expect(e.world.walk([1, 1]).ok).toBe(true)
    const r = await e.transit.board({ line: 'line_scan', pay: 'cred' })
    expect(r.status).toBe('applied')
    return { e, pinia }
  }

  it('引擎回答有違禁義體時：對話框列出那一件與「鎖定 24 小時」，沒違禁的列處置，契約列持約人與級別', async () => {
    const { e, pinia } = await scanning([STUB])
    const sv = e.event.scan()!
    expect(sv.person).toBeDefined()
    expect(sv.person!.cyber).toMatchObject({ count: 2, detailed: true })
    const h = clean(await render(pinia, ScanDialog, { view: sv }))
    expect(h).toContain('data-person')
    expect(h).toContain('data-person-row="cyber:違禁的義臂"')
    expect(text(h)).toContain('違禁的義臂')
    expect(text(h)).toContain('鎖住 24 小時')
    expect(h).toContain('data-person-row="cyber:登記過的義眼"')
    expect(text(h)).toContain('讀到 2 件')
    // 畫面的列等於 scanView 的整理
    const rows = personRows(sv.person)
    expect(rows.find((r) => r.key === 'cyber:違禁的義臂')!.tone).toBe('warn')
    const truth = scanView(oracleScan(e).k, oracleScan(e).state)!
    expect(truth.person).toEqual(sv.person)
  })

  function oracleScan(e: Eng): Game {
    const g = new Game({ features: [...allFeatures(), STUB], content: [CORE_PACK, PACK], fakeProvider: new FakeProvider() })
    expect(g.load(e.save())).toBeNull()
    return g
  }

  it('強度只讀得到件數時只列件數；沒有東西讀到時整塊不畫', async () => {
    expect(personRows(undefined)).toEqual([])
    const rows = personRows({ reads: ['cyber'], cyber: { count: 3, detailed: false, items: [] }, sentences: ['掃描器讀到你身上有 3 件義體。'] })
    expect(rows).toEqual([{ key: 'cyber', label: '義體', value: '讀到 3 件', tone: 'plain' }])
    const sink = personRows({ reads: ['sink'], sink: { read: 70, notice: false, stop: true, saw_through: true, dc: 12 }, sentences: [] })
    expect(sink[0]).toMatchObject({ key: 'sink', tone: 'warn' })
    expect(sink[0]!.value).toContain('藏的被看穿了')
    expect(sink[0]!.value).toContain('過了線')
    const covered = personRows({ reads: ['contract'], contract: { class: 'bound', holder: '伊甸園', level: 'manage', covered: true }, rights: [{ holder: '天使急救', level: 'read' }], sentences: [] })
    expect(covered.map((r) => r.key)).toEqual(['contract', 'right:天使急救:read'])
    expect(covered[0]!.value).toContain('光紋遮著')
  })
})

// ================= 蠱惑、惡意韌體、調校、請教 =================

describe('蠱惑：成人分頁列出找過主角的流竄 AI', () => {
  it('順著、拒絕、問牠是誰各留下紀錄；問過揭開一格，沒揭開的寫問號；內容是引擎的 lureView', async () => {
    const { e, pinia } = startDemo('normal')
    expect(e.lure.view()).toEqual([])
    expect(clean(await render(pinia, AdultTab))).not.toContain('data-lures')
    fx(e, [{ kind: 'lure', ai: DEMO_AI, choice: 'ask' }, { kind: 'lure', ai: DEMO_AI, choice: 'follow' }])
    const v = e.lure.view()
    expect(v).toHaveLength(1)
    expect(v[0]).toMatchObject({ id: DEMO_AI, name: '媽咪', follow: 1, asked: 1, refused: 0 })
    expect(v[0]!.lore).toHaveLength(1)
    const h = clean(await render(pinia, AdultTab))
    expect(h).toContain(`data-lure="${DEMO_AI}"`)
    expect(h).toMatch(/data-follow[^>]*>順著 1 次</)
    expect(h).toContain('data-lore="origin" data-unknown="false"')
    expect(h).toContain('data-lore="want" data-unknown="true"')
    expect(text(h)).toContain(v[0]!.lore[0]!.text)
    expect(h.match(/data-unknown="true"/g)).toHaveLength(3)
    // 契約那一行讀引擎
    expect(text(h)).toContain('持約 0・身上 0')
  })

  it('兩件蠱惑事件是範圍 rogue_ai 的資料（登入、長休各一件），選項與沉溺寫在資料裡', () => {
    const pack = demoPack().content as Record<string, Array<Rec>>
    const lure = pack.event!.filter((x) => x.scope === 'rogue_ai')
    expect(lure.map((x) => (x.triggers as string[])[0]).sort()).toEqual(['login', 'rest'])
    // 範圍表（rogue_ai、contract）是引擎的正式表，示意包只加事件、不重寫
    expect((pack.event_scope ?? []).find((s) => s.id === 'rogue_ai' || s.id === 'contract')).toBeUndefined()
    expect(((CORE_PACK.content as Record<string, Array<Rec>>).event_scope!.find((s) => s.id === 'rogue_ai')!.triggers as Record<string, number>).login).toBe(0.15)
    expect(pack.rogue_ai).toHaveLength(1)
  })
})

describe('調校：靜水、槽、靜室', () => {
  async function atClinic(fac: string, block = blockIdOf('ave42', '刀巷')) {
    const s = startDemo('normal')
    expect((await s.e.world.arrive(block, markerOfFacility(block, fac)!)).status).toBe('applied')
    s.e.ledger([{ op: 'cred', delta: 50000 }] as never)
    return s
  }

  it('示意包的靜水照 0019 P65 寫成兩筆被動效果加 no_full_sync；舊的「加倍」文字改成「消退 +N」', () => {
    const t = (demoPack().content as Record<string, Array<Rec>>).tuning!.find((x) => x.id === DEMO_STILL)!
    expect(t.effects).toEqual([{ stat: 'net_load_decay', amount: 2 }, { mod: 'decay', amount: 2, layer: 'meat' }])
    expect(t.flags).toEqual(['no_full_sync'])
    expect(String(t.desc)).toContain('每回合感載消退 +2 點')
    expect(profileSrc).toContain('每回合感載消退 +2 點')
    expect(items2Src).toContain('每回合感載消退 +2 點，現實與內海都有效')
    expect(profileSrc + items2Src).not.toMatch(/自然消退加倍/)
  })

  it('在調校診所裝靜水：價錢與擋住的原因是引擎的，裝好之後被動效果有消退兩筆，面板列出來源', async () => {
    const { e, pinia } = await atClinic('qinghe')
    const here = e.tuning.here()!
    expect(here).toMatchObject({ install: true, quiet_room: true })
    expect(e.tuning.view()!.has_bridge).toBe(true)
    expect(e.tuning.view()!.slots).toHaveLength(2)
    const q = e.tuning.installQuote(DEMO_STILL)!
    expect(q.price).toBe(800)
    expect(e.tuning.installBlock(DEMO_STILL)).toBeNull()
    expect(e.tuning.install(DEMO_STILL)).toBeNull()
    expect(e.tuning.installBlock(DEMO_STILL)).toMatch(/已經裝著/)
    const slot = e.tuning.view()!.slots.find((s) => s.id === DEMO_STILL)!
    expect(slot.flags.map((f) => f.id)).toEqual(['no_full_sync'])
    const passives = e.body.passives().filter((p) => p.source === 'tuning')
    expect(passives.some((p) => 'stat' in p && p.stat === 'net_load_decay' && p.amount === 2)).toBe(true)
    expect(passives.some((p) => 'mod' in p && p.mod === 'decay' && p.amount === 2 && p.layer === 'meat')).toBe(true)
    const h = clean(await render(pinia, TuningPanel))
    expect(h).toContain(`data-tuning-id="${DEMO_STILL}"`)
    expect(text(h)).toContain('開不了全檔')
    expect(h).toContain(`data-tuning-item="${DEMO_STILL}"`)
    // 橋分頁也有調校與惡意韌體兩塊，橋面板寫裝了幾個
    const bridge = clean(await render(pinia, BridgeTab))
    expect(bridge).toContain('data-tuning-count')
    expect(text(bridge)).toContain('調校槽 1／2')
    expect(bridge).toContain('data-malware')
    // 不在調校診所時引擎說原因
    const away = await atClinic('backalley')
    expect(away.e.tuning.here()).toBeNull()
    expect(away.e.tuning.installBlock('tu_demo_spot')).toBe('這裡不是調校診所，裝不了調校。')
  })

  it('靜室：往上與往下的價錢、沉溺、擋住的原因是引擎的；調一次之後這一週用完', async () => {
    const { e, pinia } = await atClinic('qinghe')
    const before = e.tuning.view()!.params!.craving.base
    const q = e.tuning.quietQuote('craving', -1)!
    expect(q.price).toBeGreaterThan(0)
    expect(e.tuning.quietBlock('craving', -1)).toBeNull()
    expect(clean(await render(pinia, TuningPanel))).toContain('data-quiet-down="craving"')
    expect(e.tuning.quiet('craving', -1)).toBeNull()
    expect(e.tuning.view()!.params!.craving.base).toBe(before + q.delta)
    expect(e.tuning.quietBlock('craving', 1)).toBe('這一週已經在靜室調過了，下個週一再來。')
    // 不在靜室的診所沒有那兩顆鈕
    const away = await atClinic('backalley')
    expect(clean(await render(away.pinia, TuningPanel))).not.toContain('data-quiet-down')
  })
})

describe('惡意韌體：階段與清除的路', () => {
  it('種下並鑑定之後列出：階段、效果、清除的每一條路（DC、成功率、價錢是引擎的 malwareView）；診所清除之後沒了', async () => {
    const { e, pinia } = startDemo('normal')
    expect(clean(await render(pinia, MalwarePanel))).toContain('data-none')
    fx(e, [{ kind: 'malware', id: 'mw_demo_kiss' }])
    // 潛伏而且還不知道：不列
    expect(e.malware.view()[0]!.hidden).toBe(true)
    expect(clean(await render(pinia, MalwarePanel))).toContain('data-none')
    fx(e, [{ kind: 'malware_reveal', id: 'mw_demo_kiss' }])
    const m = e.malware.view().find((x) => x.id === 'mw_demo_kiss')!
    expect(m.hidden).toBe(false)
    const h = clean(await render(pinia, MalwarePanel))
    expect(h).toContain('data-malware-id="mw_demo_kiss"')
    expect(text(h)).toContain(m.name)
    expect(text(h)).toContain(m.stage_name)
    for (const r of m.routes) {
      expect(h).toContain(`data-route="${r.via}"`)
      if (r.dc !== null) expect(text(h)).toContain(`DC ${r.dc}・成功率 ${Math.round(r.rate * 100)}%`)
      if (r.block) expect(h).toContain(esc(r.block))
    }
    // 在診所（正規診所有 clinic）：診所那條路一定成功
    const block = blockIdOf('ave42', '刀巷')
    await e.world.arrive(block, markerOfFacility(block, 'qinghe')!)
    e.ledger([{ op: 'cred', delta: 50000 }] as never)
    expect(e.malware.cleanBlock({ id: 'mw_demo_kiss', via: 'clinic' })).toBeNull()
    expect(e.malware.clean({ id: 'mw_demo_kiss', via: 'clinic' })).toBeNull()
    expect(e.malware.view()).toEqual([])
  })
})

describe('請教與上課', () => {
  it('老何（槍械 6 級）在四號塔：選單多「請教」；列出能學的基本功、三種付法與原因、上課的進度，上一個時段進度 +1', async () => {
    const { e, pinia } = startDemo('normal')
    const pc = e.pc!.id
    // 主角槍械 4 級（直接放進狀態當前提，和別的測試一樣）；先認識老何
    e.ledger([{ op: 'actor.skill', id: pc, skill: 'firearms', delta: 4 - (e.pc!.skills.firearms ?? 0) }] as never)
    expect((await e.people.meet(DEMO_TEACHER_NPC)).status).toBe('applied')
    expect(e.people.interactions(DEMO_TEACHER_NPC).some((i) => i.kind === 'npc_consult')).toBe(true)
    const opts = e.training.options({ npc: DEMO_TEACHER_NPC })
    expect(opts).toHaveLength(1)
    const o = opts[0]!
    expect(o).toMatchObject({ skill: 'firearms', level: 5, max: 6, done: 0 })
    expect(o.pays.map((p) => p.pay)).toEqual(['affinity', 'favor', 'tuition'])
    const h = clean(await render(pinia, TeachPanel, { npc: DEMO_TEACHER_NPC }))
    expect(h).toContain('data-lesson="firearms"')
    expect(h).toMatch(/data-level[^>]*>升到 5 級（他最多教到 6 級）</)
    expect(h).toMatch(/data-progress[^>]*>0／2 個時段/)
    for (const p of o.pays) if (p.reason) expect(h).toContain(esc(p.reason))
    // 付學費上一個時段（親密度不夠、沒做過事）：進度 +1，時間 +240 分鐘
    const t0 = e.state.time
    expect(e.training.lesson({ skill: 'firearms', from: { npc: DEMO_TEACHER_NPC }, pay: 'tuition' })).toBeNull()
    expect(e.training.options({ npc: DEMO_TEACHER_NPC })[0]!.done).toBe(1)
    expect(e.state.time).not.toEqual(t0)
    // 說話頁的「請教」是同一份
    const talk = clean(await render(pinia, TalkDialog, { entryId: 1, npcId: DEMO_TEACHER_NPC }))
    expect(talk).toContain('data-kind="npc_consult"')
  })

  it('機構的課：槍店教槍械到 5 級，站在槍店才列；不在那裡時沒有「上課」', async () => {
    const { e, pinia } = startDemo('normal')
    expect(e.training.options()).toEqual([])
    const block = blockIdOf('ave42', '刀巷')
    const marker = markerOfFacility(block, 'gunshop') ?? markerOfFacility(blockIdOf('hive', '天井市場'), 'gunshop')
    // 槍店在哪一塊由示意世界決定：找得到就站上去
    const found = [blockIdOf('ave42', '刀巷'), blockIdOf('ave42', '上城段'), blockIdOf('ave42', '中城段・北'), blockIdOf('ave42', '中城段・南')].find((b) => markerOfFacility(b, 'gunshop'))
    if (found) {
      expect((await e.world.arrive(found, markerOfFacility(found, 'gunshop')!)).status).toBe('applied')
      e.ledger([{ op: 'actor.skill', id: e.pc!.id, skill: 'firearms', delta: 4 - (e.pc!.skills.firearms ?? 0) }, { op: 'cred', delta: 10000 }] as never)
      const o = e.training.options()
      expect(o.map((x) => x.skill)).toContain('firearms')
      const row = o.find((x) => x.skill === 'firearms')!
      expect(row.pays.map((p) => p.pay)).toEqual(['tuition'])
      expect(row.pays[0]!.price).toBe(1200)
      const h = text(clean(await render(pinia, TeachPanel)))
      expect(h).toContain('C$1,200')
    } else expect(marker).toBeNull()
  })
})
