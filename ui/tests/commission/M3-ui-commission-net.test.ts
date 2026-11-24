// 驗收測試：dev/work/M3-ui-commission-net.md（cpp-ui）。委託的內海面：追蹤度條、面卡與隔離區、進入內海的一段、離開後的帳、簡報與踩點的內海標示。
// 引擎用真的（commission、fixer、netrun、netcombat、deck、enemies）；內容是測試自帶的最小假資料（fixtures.ts 的房間加一座蕾絲與一副甲板）。
import { afterEach, describe, expect, it, vi } from 'vitest'
import { AIRGAP_TEXT } from '@engine/src/features/commission'
import RunTab from '../../src/components/commission/RunTab.vue'
import TakePanel from '../../src/components/commission/TakePanel.vue'
import ScoutTab from '../../src/components/commission/ScoutTab.vue'
import app from '../../src/App.vue?raw'
import { html, text } from './fixtures'
import { playNetStage } from './netPlay'

vi.mock('../../src/router', () => ({ FULL_PAGES: [{ path: '/', name: '主畫面' }], router: {} }))
afterEach(() => { delete (globalThis as { localStorage?: unknown }).localStorage })

import { start, depart, minutes, type Eng } from './netFixtures'
/** 把人傳到現實面的格子（測試用的引擎變更）並讓副本自己接里程碑 */
function meatTo(e: Eng, x: number, y: number) {
  const at = e.state.maps.at!
  expect(e.commit({ summary: '傳送', action: 'commission.test', changes: [{ op: 'map.at', to: { map: at.map, sheet: at.sheet, x, y } }] as never })).toBeNull()
}
async function stageMeat(e: Eng, at: [number, number] = [4, 2]) {
  expect((await e.commission.chooseFace('meat')).status).toBe('applied')
  expect((await e.commission.chooseBranch('assault')).status).toBe('applied')
  meatTo(e, at[0], at[1])
}

describe('副本頁：追蹤度條', () => {
  it('有內海階段的委託顯示追蹤度條，值與刻度等於引擎的 commissionView().trace', async () => {
    const { e, pinia } = start()
    await depart(e, 'of_net4')
    const v = e.commission.view()!
    const h = await html(pinia, RunTab)
    expect(h).toContain('data-trace')
    expect(h).toContain(`data-value="${v.trace.value}"`)
    expect(text(h)).toContain(`刻度在 ${v.trace.marks.join('、')}`)
    expect(v.trace.marks).toEqual([30, 60, 90])
  })
  it('純現實的委託不顯示', async () => {
    const { e, pinia } = start()
    await depart(e, 'of_meat3')
    expect(await html(pinia, RunTab)).not.toContain('data-trace')
  })
})

describe('進入內海的一段', () => {
  it('選內海面與強攻：引擎開了網內的行程（App 照它換到子網頁）；副本頁寫「回到子網」', async () => {
    const { e, pinia } = start()
    await depart(e, 'of_net4')
    expect((await e.commission.chooseFace('net')).status).toBe('applied')
    expect((await e.commission.chooseBranch('assault')).status).toBe('applied')
    expect(e.net.view()?.kind).toBe('face.net')
    expect(app).toMatch(/eng\.net\.view\(\)\?\.id[\s\S]*push\('\/subnet'\)/)
    expect(await html(pinia, RunTab)).toContain('data-to-subnet')
  })
  it('通過閘門之後回到副本頁：階段軌往前一格、城裡多 2 小時、寫離開時的追蹤度', async () => {
    const { e, pinia } = start()
    await depart(e, 'of_net4')
    const t0 = minutes(e)
    expect((await e.commission.chooseFace('net')).status).toBe('applied')
    expect((await e.commission.chooseBranch('assault')).status).toBe('applied')
    expect(await playNetStage(e)).toBeGreaterThan(0)
    expect(e.net.view()).toBeNull()
    const v = e.commission.view()!
    expect(v.stage).toBe(2)
    expect(v.step).toBe('face')
    expect(minutes(e) - t0).toBeGreaterThanOrEqual(120)
    const h = await html(pinia, RunTab)
    expect(h).toContain('data-net-last')
    expect(text(h)).toContain(`第 1 階段（內海）做完：追蹤度 ${v.trace.value}`)
  })
  it('在子網裡登出並確認：回到召集之前的狀態，紀錄標成被收回', async () => {
    const { e } = start()
    const m0 = minutes(e)
    const cash0 = e.money.cash
    await depart(e, 'of_net4')
    expect((await e.commission.chooseFace('net')).status).toBe('applied')
    expect((await e.commission.chooseBranch('assault')).status).toBe('applied')
    expect(e.net.view()!.logout.note).toBeTruthy()
    expect((await e.net.logout()).status).toBe('applied')
    expect(e.net.view()).toBeNull()
    expect(e.commission.view()).toBeNull()
    expect(minutes(e) - m0).toBeLessThanOrEqual(60)
    expect(e.money.cash).toBe(cash0)
    expect(e.state.reports.some((r) => r.retracted === true)).toBe(true)
  })
})

describe('隔離區', () => {
  it('第三階段做完、拿到資料埠之後，第四階段的內海面選得了', async () => {
    const { e, pinia } = start()
    await depart(e, 'of_net4')
    await stageMeat(e)
    await stageMeat(e)
    await stageMeat(e)
    const v = e.commission.view()!
    expect(v.stage).toBe(4)
    const f = v.faces.find((x) => x.face === 'net')!
    expect(f.locked).toBeUndefined()
    expect(f.block).toBeNull()
    expect(await html(pinia, RunTab)).not.toContain('data-locked="1"')
  })
  it('沒拿到資料埠：內海面變淡，原因和引擎的句子逐字相同', async () => {
    const { e, pinia } = start()
    await depart(e, 'of_net4_gap')
    await stageMeat(e)
    await stageMeat(e)
    await stageMeat(e)
    const v = e.commission.view()!
    expect(v.stage).toBe(4)
    const f = v.faces.find((x) => x.face === 'net')!
    expect(f.locked).toBe(AIRGAP_TEXT)
    expect(f.block).toBe(AIRGAP_TEXT)
    const h = await html(pinia, RunTab)
    const chunk = h.slice(h.indexOf('data-face="net"'), h.indexOf('data-face="net"') + 700)
    expect(chunk).toContain('data-locked="1"')
    expect(text(chunk)).toContain(AIRGAP_TEXT)
    expect((await e.commission.chooseFace('net')).reason).toBe(AIRGAP_TEXT)
  })
})

describe('簡報與踩點', () => {
  it('簡報：主面是內海的標「這是一件要潛進去的委託」，引擎的提醒照列', async () => {
    const { e, pinia } = start()
    const row = e.fixer.board('fx_ui').offers.find((o) => o.id === 'of_net4')!
    expect(row.net).not.toBeNull()
    const h = await html(pinia, TakePanel, { fixerId: 'fx_ui' })
    expect(h).toContain('data-offer="of_net4"')
    expect(h).toContain('data-net-note')
  })
  it('踩點：內海的未知照面標色', async () => {
    const { e, pinia } = start()
    expect((await e.fixer.accept({ id: 'of_net4', fixer: 'fx_ui' }, 'cash')).status).toBe('applied')
    const h = await html(pinia, ScoutTab, { jobId: 'of_net4' })
    expect(h).toContain('data-unknown="u_lace"')
    expect(h).toMatch(/class="[^"]*\bnet\b[^"]*"[^>]*data-unknown="u_lace"/)
    expect(text(h)).toContain('內海')
    expect(e.fixer.scoutView('of_net4').unknowns.find((u) => u.id === 'u_lace')!.face).toBe('net')
  })
})
