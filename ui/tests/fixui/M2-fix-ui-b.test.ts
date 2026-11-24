// M2 最後一小批介面跟改（引擎修正 6213f6d，dev/adr/0017 第 16～25 項）：押金與計程車抵達用引擎的、放棄委託的確認框寫信譽、
// 信譽預告、診所的床算處理過、敵對值的有期限下限。內容用測試自帶的最小假資料。

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { createSSRApp } from 'vue'
import { createMemoryHistory, createRouter } from 'vue-router'
import { renderToString } from 'vue/server-renderer'
import { FakeProvider, Game } from '@engine/src'
import type { ContentPack, Feature } from '@engine/src'
import { CORE_PACK } from '@engine/data'
import { allFeatures } from '@engine/src/features'
import { depositOf, sleepOptions } from '@engine/src/features/rest'
import { abandonRepOf, fixerRules, jobOf, repGainOf } from '@engine/src/features/fixer'
import { useEngine } from '../../src/stores/engine'
import { abandonText, repChangeText, repForecastText, repGainText } from '../../src/lib/commissionView'
import RestDialog from '../../src/dialogs/RestDialog.vue'
import RelationsDialog from '../../src/dialogs/RelationsDialog.vue'
import CommissionScreen from '../../src/screens/CommissionScreen.vue'
import TakePanel from '../../src/components/commission/TakePanel.vue'
import RunTab from '../../src/components/commission/RunTab.vue'
import { PACK as CPACK, PROVIDER, html as chtml } from '../commission/fixtures'
import storeSrc from '../../src/stores/engine.ts?raw'
import commissionSrc from '../../src/screens/CommissionScreen.vue?raw'

const DRAFT = {
  name: '露', gender: 'female', age: 22, origin: 'hive', originChoice: { favor: 'lonestar' },
  attrPick: { reflex: 15, charm: 14, intellect: 13, body: 12, resolve: 10, tech: 8 },
  attrBonus: { tech: -4, reflex: 3, resolve: 3 },
  skills: { streetwise: 3, negotiate: 3, perform: 2, stealth: 2 },
  perks: ['smooth_talker', 'tough'],
}
const E = [{ id: 'E1', at: [0, 2], mark: 'E', name: '西口' }]
const PACK: ContentPack = {
  id: 'fix_b_test',
  content: {
    special_map: [{ id: 'm_c', kind: 'street', size: [14, 5], sheets: [{ id: 'street', name: '街', size: [14, 5], layout: ['##############', '#F.F.F.......#', 'E.1........2.E', '#............#', '##############'], cells: [{ id: 'F1', at: [1, 1], mark: 'F', name: '診所' }, { id: 'F2', at: [3, 1], mark: 'F', name: '旅店' }, { id: 'F3', at: [5, 1], mark: 'F', name: '空地' }, ...E, { id: 'E2', at: [13, 2], mark: 'E', name: '東口' }], spots: [{ id: '!1', at: [2, 2], cover: 'sparse' }, { id: '!2', at: [11, 2], cover: 'dense' }] }] }],
    facility_type: [{ id: 'fac_clinic', name: '診所', sleep: { rate: 0.5, cost: 30, treated: true } }, { id: 'fac_inn', name: '旅店', sleep: { rate: 0.5, cost: 10 } }],
    district: [{ id: 'd_c', name: '甲區', grade: 1, price_mult: 1, blocks: ['b_c'] }],
    block: [{ id: 'b_c', district: 'd_c', name: '甲街', kind: 'block', map: 'm_c', exits: {}, facilities: { F1: { type: 'fac_clinic', name: '診所' }, F2: { type: 'fac_inn', name: '旅店' }, F3: { type: 'fac_inn', name: '空地' } } }],
    residence: [{ id: 'res_c', name: '出租屋', district: 'd_c', block: 'b_c', facility: 'F2', level: 1, rent: 120, cash_ok: true }],
  } as unknown as ContentPack['content'],
}
type Eng = ReturnType<typeof useEngine>
/** 另一個獨立的引擎讀同一份存檔：數字拿它直接問引擎函式來比 */
function oracle(e: Eng, content: ContentPack[], features: Feature[] = []): Game {
  const g = new Game({ features: [...allFeatures(), ...features], content: [CORE_PACK, ...content], fakeProvider: new FakeProvider() })
  expect(g.load(e.save())).toBeNull()
  return g
}
async function setup(at: string) {
  const pinia = createPinia()
  setActivePinia(pinia)
  const e = useEngine()
  e.newGame({ seed: 7, testContent: [PACK] })
  e.setAi({ useAi: false })
  expect(e.createCharacter(DRAFT)).toEqual([])
  expect((await e.world.arrive('b_c', at)).status).toBe('applied')
  return { pinia, e }
}
const strip = (h: string) => h.replace(/<!--[\s\S]*?-->/g, '').replace(/<[^>]+>/g, '')
async function html(pinia: ReturnType<typeof createPinia>, comp: object, props: Record<string, unknown> = {}): Promise<string> {
  const app = createSSRApp(comp, { entryId: 1, ...props })
  app.use(pinia)
  app.use(createRouter({ history: createMemoryHistory(), routes: [{ path: '/', component: { render: () => null } }] }))
  return renderToString(app)
}
vi.mock('../../src/router', () => ({ FULL_PAGES: [{ path: '/', name: '主畫面' }], router: {} }))
beforeEach(() => setActivePinia(createPinia()))

describe('引擎的押金與計程車抵達', () => {
  it('store 不再自己算押金、不再補 1e9 現金；押金等於引擎的 depositOf', async () => {
    expect(storeSrc).not.toMatch(/r\.rent \* weeks/)
    expect(storeSrc).not.toMatch(/1_000_000_000|1e9/)
    expect(storeSrc).toMatch(/from '@engine\/src\/features\/rest'/)
    expect(storeSrc).not.toContain("features/rest/model'")
    expect(storeSrc).toContain('transitTaxiArrival')
    const { e } = await setup('F2')
    const r = e.rest.residences().find((x) => x.id === 'res_c')!
    expect(r.deposit).toBe(depositOf(oracle(e, [PACK]).k, { rent: 120 }))
    expect(r.deposit).toBeGreaterThan(0)
  })
})

describe('診所的床算傷口處理過', () => {
  it('睡處列表帶 treated；診所的設施選項寫「算傷口處理過」，旅店沒有', async () => {
    const clinic = await setup('F1')
    const opt = clinic.e.rest.options().find((o) => o.id === 'facility')!
    expect(opt.treated).toBe(true)
    expect(opt).toEqual(sleepOptions(oracle(clinic.e, [PACK]).k, clinic.e.state).find((o) => o.id === 'facility'))
    const h = await html(clinic.pinia, RestDialog)
    expect(h).toContain('data-treated')
    expect(strip(h)).toContain('算傷口處理過')
    const inn = await setup('F2')
    expect(inn.e.rest.options().find((o) => o.id === 'facility')!.treated).toBe(false)
    expect(await html(inn.pinia, RestDialog)).not.toContain('data-treated')
  })
})

describe('敵對值：有期限的下限', () => {
  const addFloor = (e: Eng, value: number, days: number) => {
    const now = (e.state.time.day - 1) * 1440 + e.state.time.hour * 60 + e.state.time.minute
    expect(e.commit({ summary: '下限', changes: [{ op: 'security.floor', key: 'hizakura', value, until: now + days * 1440 } as never] })).toBeNull()
  }
  it('hostilityRows 的 floor 取永久與有期限較高的；timed 列出剩幾天', async () => {
    const { e } = await setup('F1')
    addFloor(e, 40, 3)
    addFloor(e, 25, 10)
    const row = e.hostilityRows().find((r) => r.faction === 'hizakura')!
    expect(row.floor).toBe(40)
    expect(row.timed).toEqual([{ value: 40, days: 3 }, { value: 25, days: 10 }])
  })
  it('關係視窗列出敵對值與「有期限的下限 N，剩 X 天」；沒有敵對值時不出現這一塊', async () => {
    const { e, pinia } = await setup('F1')
    expect(await html(pinia, RelationsDialog)).not.toContain('data-hostility')
    addFloor(e, 40, 3)
    const h = await html(pinia, RelationsDialog)
    expect(h).toContain('data-hostility-row="hizakura"')
    expect(strip(h)).toMatch(/有期限的下限 40，剩 3 天/)
    expect(strip(h)).toContain('下限 40')
  })
  it('到期的不列', async () => {
    const { e } = await setup('F1')
    addFloor(e, 40, 1)
    await e.act({ kind: 'free', text: '看看' })
    e.commit({ summary: '過兩天', changes: [{ op: 'time', minutes: 2 * 1440 } as never] })
    expect(e.hostilityRows().find((r) => r.faction === 'hizakura')?.timed ?? []).toEqual([])
  })
})

describe('委託：放棄的確認框與信譽預告', () => {
  async function started() {
    const pinia = createPinia()
    setActivePinia(pinia)
    const e = useEngine()
    e.newGame({ seed: 7, testContent: [CPACK], testFeatures: [PROVIDER] })
    e.setAi({ useAi: false })
    expect(e.createCharacter(DRAFT)).toEqual([])
    return { pinia, e }
  }
  it('abandonRep 讀引擎的 abandonRepOf：出發前 rep_abandon_early、出發過 rep_abandon（撤退回來也算）；文字寫出掉多少與出發前後', async () => {
    const { e } = await started()
    const k = oracle(e, [CPACK], [PROVIDER]).k
    const rules = fixerRules(k)
    expect(rules.rep_abandon_early).not.toBe(rules.rep_abandon)
    // 沒給委託的 id 或找不到：出發前的
    expect(e.fixer.abandonRep()).toBe(rules.rep_abandon_early)
    const row = e.fixer.board('fx_ui').offers.find((o) => o.id === 'of_ui_a')!
    expect((await e.fixer.accept({ id: row.id, fixer: 'fx_ui' }, row.pay.find((p) => p.block === null)!.id)).status).toBe('applied')
    expect(e.fixer.abandonRep('of_ui_a')).toBe(rules.rep_abandon_early)
    expect(e.fixer.abandonRep('of_ui_a')).toBe(abandonRepOf(k, jobOf(e.state, 'of_ui_a')!))
    // 出發、撤退回到手上：出發過了，放棄要掉的是 rep_abandon
    expect((await e.fixer.go('of_ui_a')).status).toBe('applied')
    expect((await e.commission.retreat()).status).toBe('applied')
    expect(e.fixer.job('of_ui_a')).toMatchObject({ status: 'active', departed: true })
    expect(e.fixer.abandonRep('of_ui_a')).toBe(rules.rep_abandon)
    expect(abandonText(-2)).toContain('還沒出發')
    expect(abandonText(-5, true)).toContain('已經出發過')
    expect(abandonText(-5, true)).toContain('掉 5 點')
    expect(abandonText(-12)).toContain('掉 12 點')
    expect(abandonText(0)).toContain('信譽不變')
    expect(commissionSrc).not.toMatch(/-?[25] 點/)
  })
  it('repGain 是引擎的 repGainOf；低級的寫「信譽不變」，S 的加成另寫', async () => {
    const { e } = await started()
    const offer = e.fixer.board('fx_ui').offers[0]!
    const g = e.fixer.repGain(offer.offer.commission)
    const k = oracle(e, [CPACK], [PROVIDER]).k
    const raw = repGainOf(k, e.state, { commission: offer.offer.commission }, 'B')
    expect(g.amount).toBe(raw.amount)
    expect(g.relation).toBe(raw.relation)
    expect(g.topBonus).toBe(repGainOf(k, e.state, { commission: offer.offer.commission }, 'S').amount - raw.amount)
    expect(repGainText({ amount: 0, topBonus: 0 })).toBe('信譽不變')
    expect(repGainText({ amount: 4, topBonus: 1 })).toBe('信譽 +4（評價 S 再 +1）')
    expect(repGainText({ amount: 2, topBonus: 0 })).toBe('信譽 +2')
  })
  it('接案頁寫預告；接下來的委託頁有預告，按放棄先出確認框（寫信譽），再按才放棄', async () => {
    const { e, pinia } = await started()
    const take = await html(pinia, TakePanel, { fixerId: 'fx_ui' })
    expect(take).toContain('data-rep-gain')
    expect(strip(take)).toMatch(/完成這件：信譽/)
    const row = e.fixer.board('fx_ui').offers.find((o) => o.id === 'of_ui_a')!
    const acc = await e.fixer.accept({ id: row.id, fixer: 'fx_ui' }, row.pay.find((p) => p.block === null)!.id)
    expect(acc.status).toBe('applied')
    const page = await chtml(pinia, CommissionScreen, {}, '/commission?job=of_ui_a&tab=take')
    expect(page).toContain('data-rep-gain')
    expect(page).toContain('data-drop')
    expect(page).not.toContain('data-drop-confirm') // 還沒按
    expect(commissionSrc).toContain('v-if="confirmDrop"')
    expect(commissionSrc).toContain('abandonText(e.fixer.abandonRep(job.id), !!job.departed)')
    expect(commissionSrc).toMatch(/@go="confirmDrop = true"/)
    // 直接呼叫 drop 會真的放棄（確認框只是畫面）
    expect((await e.fixer.drop('of_ui_a')).status).toBe('applied')
    expect(e.fixer.jobs()).toHaveLength(0)
  })
})

describe('委託：副本裡的信譽預告與結算後實際的信譽變化', () => {
  async function started() {
    const pinia = createPinia()
    setActivePinia(pinia)
    const e = useEngine()
    e.newGame({ seed: 7, testContent: [CPACK], testFeatures: [PROVIDER] })
    e.setAi({ useAi: false })
    expect(e.createCharacter(DRAFT)).toEqual([])
    return { pinia, e }
  }
  const take = async (e: Eng) => {
    const row = e.fixer.board('fx_ui').offers.find((o) => o.id === 'of_ui_a')!
    expect((await e.fixer.accept({ id: row.id, fixer: 'fx_ui' }, row.pay.find((p) => p.block === null)!.id)).status).toBe('applied')
  }

  it('副本頁有信譽預告：做完的數字是引擎 repGainOf 照預估的評價算的，失敗的是規則 rep_failed', async () => {
    const { pinia, e } = await started()
    await take(e)
    expect((await e.fixer.go('of_ui_a')).status).toBe('applied')
    const v = e.commission.view()!
    const k = oracle(e, [CPACK], [PROVIDER]).k
    const job = jobOf(e.state, 'of_ui_a')!
    const gain = repGainOf(k, e.state, job, v.close.rating)
    const top = repGainOf(k, e.state, job, 'S')
    const h = await chtml(pinia, RunTab)
    expect(h).toContain('data-rep-forecast')
    const want = repForecastText({ amount: gain.amount, topBonus: top.amount - gain.amount }, fixerRules(k).rep_failed)
    expect(strip(h)).toContain(want)
    expect(want).toContain(`信譽 +${gain.amount}`)
    expect(e.fixer.repFailed()).toBe(fixerRules(k).rep_failed)
    expect(strip(h)).toContain('失敗：信譽 −3')
  })

  it('做完入帳之後：settledJob 讀引擎記的入帳紀錄（信譽 from→to）；結算框把它寫出來，沒有指定就不出現', async () => {
    const { pinia, e } = await started()
    await take(e)
    expect((await e.fixer.go('of_ui_a')).status).toBe('applied')
    for (let i = 0; i < 3; i++) {
      expect((await e.commission.chooseFace('meat')).status).toBe('applied')
      expect((await e.commission.chooseBranch('assault')).status).toBe('applied')
      expect(e.world.walk([4, 2]).ok).toBe(true)
    }
    expect(e.commission.view()).toBeNull()
    const j = e.fixer.settledJob('cm_ui_a')!
    expect(j.status).toBe('done')
    const rep = j.payout!.rep!
    expect(rep.to).toBe(e.state.meters.rep!._) // 實際的結果就是現在的信譽
    expect(rep.to).toBeGreaterThan(rep.from)
    const open = await chtml(pinia, CommissionScreen, {}, '/commission?settled=of_ui_a')
    expect(open).toContain('data-settle')
    expect(strip(open)).toContain(repChangeText(rep))
    expect(strip(open)).toContain(`信譽 ${rep.from} → ${rep.to}`)
    expect(open).toContain(`data-settle-rating`)
    expect(await chtml(pinia, CommissionScreen, {}, '/commission')).not.toContain('data-settle')
    expect(commissionSrc).toContain('e.fixer.settledJob(was)')
    expect(commissionSrc).toContain('repChangeText(settledPay.rep)')
  })

  it('撤退（委託還在手上、沒有入帳）沒有結算（失敗入帳的信譽紀錄由引擎測試驗）', async () => {
    const { e } = await started()
    await take(e)
    expect((await e.fixer.go('of_ui_a')).status).toBe('applied')
    expect((await e.commission.retreat()).status).toBe('applied')
    expect(e.fixer.settledJob('cm_ui_a')).toBeNull()
  })

  it('repChangeText：加、扣、不變、沒有紀錄', () => {
    expect(repChangeText({ from: 10, to: 14 })).toBe('信譽 10 → 14（+4）')
    expect(repChangeText({ from: 30, to: 27 })).toBe('信譽 30 → 27（−3）')
    expect(repChangeText({ from: 0, to: 0 })).toBe('信譽不變（0）')
    expect(repChangeText(undefined)).toBe('信譽沒有變化')
  })
})
