// M3-fix-ui：內海戰鬥結束之後回哪一頁（P1）、戰敗等選時不能離開（S1）、離開結算與登出確認真的走一遍（S2、測試缺口）。
// 引擎用真的；委託與子網的假資料與 M3-ui-commission-net 共用（netFixtures.ts）。畫面沒有瀏覽器：「點按鈕」就是呼叫
// useBattle 回給元件的函式與 lib 的流程（元件的 onclick 只是接上它們），換頁用真的 vue-router（記憶體歷史）。
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { createMemoryHistory, createRouter } from 'vue-router'
import { createSSRApp, defineComponent, h, watch } from 'vue'
import { renderToString } from 'vue/server-renderer'
import { useUi } from '../../src/stores/ui'
import { useBattle } from '../../src/lib/useBattle'
import { leaveSettlement, logoutFlow } from '../../src/lib/netrunView'
import NetCombatScreen from '../../src/screens/NetCombatScreen.vue'
import { depart, start, type Eng } from './netFixtures'
import { standNextToFoe } from './netPlay'

vi.mock('../../src/router', () => ({ FULL_PAGES: [{ path: '/', name: '主畫面' }], router: {} }))
afterEach(() => { delete (globalThis as { localStorage?: unknown }).localStorage })

const PAGES = ['/', '/subnet', '/commission', '/netcombat', '/combat']
const mkRouter = () => createRouter({ history: createMemoryHistory(), routes: PAGES.map((path) => ({ path, component: { render: () => null } })) })
type R = ReturnType<typeof mkRouter>

/** 在 /netcombat 開一份 useBattle（和戰鬥畫面用的一樣），from 是子網（戰鬥是從子網頁走進來的） */
async function board(pinia: ReturnType<typeof createPinia>, from = '/subnet'): Promise<{ bt: ReturnType<typeof useBattle>; r: R }> {
  const r = mkRouter()
  await r.push('/netcombat')
  await r.isReady()
  let bt!: ReturnType<typeof useBattle>
  const Probe = defineComponent({ setup() { bt = useBattle({ from: () => from, fast: () => true, enc: () => undefined, fallback: false }); return () => h('div') } })
  const app = createSSRApp(Probe)
  app.use(pinia)
  app.use(r)
  await renderToString(app)
  return { bt, r }
}

/** 讓進行中的換頁跑完 */
const flush = (): Promise<void> => new Promise((ok) => setTimeout(ok, 0))

/** 委託第一階段選內海、強攻、站到遭遇旁邊並開戰 */
async function toNetFight(seed = 7) {
  const { e, pinia } = start(seed)
  await depart(e, 'of_net4')
  expect((await e.commission.chooseFace('net')).status).toBe('applied')
  expect((await e.commission.chooseBranch('assault')).status).toBe('applied')
  const foe = standNextToFoe(e)
  expect((await e.net.use('fight', foe)).status).toBe('applied')
  expect(e.battleLayer()).toBe('net')
  return { e, pinia }
}
/** 一直做同一個行動到戰鬥結束（輪到敵人就讓它走） */
function playOut(e: Eng, action: string): void {
  for (let i = 0; i < 200 && e.battleOptions()!.waiting !== 'over'; i++) {
    if (e.battleOptions()!.waiting === 'ai') e.battleNext()
    else expect(e.battleAct({ action } as never).status).toBe('applied')
  }
  expect(e.battleOptions()!.waiting).toBe('over')
}

describe('P1：委託裡的內海戰鬥結束之後回哪一頁（照引擎的狀態，不照 from）', () => {
  it('全員拔線：行程沒了、副本回到召集之前，手上還有這件委託 → 召集頁 /commission', async () => {
    const { e, pinia } = await toNetFight()
    const { bt, r } = await board(pinia)
    playOut(e, 'net_jack_out')
    expect(bt.retreat.value).toBe(true)
    await bt.settle()
    await flush()
    expect(e.net.view()).toBeNull()
    expect(e.commission.view()).toBeNull()
    expect(e.fixer.jobs().length).toBeGreaterThan(0)
    expect(r.currentRoute.value.path).toBe('/commission')
  })

  it('投降、回到這個階段開始時：副本還在、行程沒了 → 副本頁 /commission', async () => {
    const { e, pinia } = await toNetFight()
    const { bt, r } = await board(pinia)
    playOut(e, 'net_surrender')
    await bt.settle()
    await flush()
    expect(e.pendingDefeat).not.toBeNull()
    expect(r.currentRoute.value.path).toBe('/netcombat')
    bt.stage()
    await flush()
    expect(e.pendingDefeat).toBeNull()
    expect(e.net.view()).toBeNull()
    expect(e.commission.view()).not.toBeNull()
    expect(r.currentRoute.value.path).toBe('/commission')
  })

  it('投降、接受戰敗：不回空的子網頁；照引擎的狀態去召集頁或主畫面', async () => {
    const { e, pinia } = await toNetFight()
    const { bt, r } = await board(pinia)
    playOut(e, 'net_surrender')
    await bt.settle()
    for (let i = 0; i < 10 && e.event.view(); i++) await e.event.choose(e.event.view()!.options.find((x) => !x.locked)!.id)
    expect(e.defeatFlow.accept()).toBeNull()
    bt.leave()
    await flush()
    expect(e.net.view()).toBeNull()
    const want = e.commission.view() || e.fixer.jobs().length > 0 ? '/commission' : '/'
    expect(r.currentRoute.value.path).toBe(want)
    expect(r.currentRoute.value.path).not.toBe('/subnet')
  })

  it('打贏：行程還在 → 回子網頁', async () => {
    const { e, pinia } = await toNetFight()
    const { bt, r } = await board(pinia)
    for (let i = 0; i < 400 && e.battleOptions()!.waiting !== 'over'; i++) if (e.battleNext({ anyone: true }).status !== 'applied') break
    expect(e.battle!.result!.outcome).toBe('win')
    await bt.settle()
    bt.leave()
    await flush()
    expect(e.net.view()).not.toBeNull()
    expect(r.currentRoute.value.path).toBe('/subnet')
  })
})

describe('S1：等戰敗三選一時內海戰鬥頁沒有「← 主畫面」', () => {
  it('戰敗等選時頂端沒有回主畫面的按鈕；之前有', async () => {
    const { e, pinia } = await toNetFight()
    const { bt } = await board(pinia)
    const page = async (): Promise<string> => {
      const r = mkRouter()
      await r.push('/netcombat')
      await r.isReady()
      const app = createSSRApp(NetCombatScreen)
      app.use(pinia)
      app.use(r)
      return renderToString(app)
    }
    expect(await page()).toContain('← 主畫面')
    playOut(e, 'net_surrender')
    await bt.settle()
    expect(e.pendingDefeat).not.toBeNull()
    expect(await page()).not.toContain('← 主畫面')
  })
})

describe('S2：離開結算後的「回到去處」：換完頁再開對話框，不會被換頁關掉', () => {
  it('和 App 一樣換頁就關掉所有對話框；走 leaveSettlement 之後去處還開著', async () => {
    setActivePinia(createPinia())
    const ui = useUi()
    const r = mkRouter()
    await r.push('/subnet')
    watch(() => r.currentRoute.value.path, () => ui.closeAll())
    let cleared = 0
    await leaveSettlement({ clear: () => { cleared++ }, go: (p) => r.replace(p), diving: true, openDive: () => ui.openRoot('dive') })
    await flush()
    expect(cleared).toBe(1)
    expect(r.currentRoute.value.path).toBe('/')
    expect(ui.stack.map((d) => d.name)).toEqual(['dive'])
    // 不是潛入中：只換頁
    ui.closeAll()
    await r.push('/subnet')
    await leaveSettlement({ clear: () => {}, go: (p) => r.replace(p), diving: false, openDive: () => ui.openRoot('dive') })
    await flush()
    expect(ui.stack).toEqual([])
  })
})

describe('登出確認框：真的走一遍', () => {
  it('按登出只開框；取消不送；確認才呼叫引擎；被擋下顯示原因、不開框', async () => {
    const calls: string[] = []
    const toasts: string[] = []
    let block: string | null = null
    const f = logoutFlow({ block: () => block, logout: async () => { calls.push('logout'); return { status: 'applied' } }, toast: (m) => toasts.push(m) })
    f.ask()
    expect(f.confirm.value).toBe(true)
    expect(calls).toEqual([])
    f.cancel()
    expect(f.confirm.value).toBe(false)
    expect(calls).toEqual([])
    f.ask()
    await f.ok()
    expect(f.confirm.value).toBe(false)
    expect(calls).toEqual(['logout'])
    block = '現在登不出去。'
    f.ask()
    expect(f.confirm.value).toBe(false)
    expect(toasts).toEqual(['現在登不出去。'])
    expect(calls).toEqual(['logout'])
  })
})
