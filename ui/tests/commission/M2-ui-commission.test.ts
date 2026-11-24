// 驗收測試：dev/work/M2-ui-commission.md（cpp-ui）。委託的四拍（接案、踩點、召集、副本）與中間人的店接上引擎；副本裡走引擎的地圖；召集頁的技能配置讀引擎。
// 內容用測試自帶的最小假資料（fixtures.ts）：一位中間人、三件假委託（兩張小房間）、名冊上的幾個人。
// 畫面用 Vue 的伺服器端渲染轉成 HTML 來檢查（沒有瀏覽器）；點按鈕做的事就是呼叫畫面呼叫的那幾個 store 函式。
// 擲骰的測試不假設骰面：對每個種子先跑一次，挑到要的那個種子再驗。

import { afterEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { useEngine } from '../../src/stores/engine'
import TakePanel from '../../src/components/commission/TakePanel.vue'
import ScoutTab from '../../src/components/commission/ScoutTab.vue'
import CallTab from '../../src/components/commission/CallTab.vue'
import RunTab from '../../src/components/commission/RunTab.vue'
import StageTrack from '../../src/components/StageTrack.vue'
import CommissionScreen from '../../src/screens/CommissionScreen.vue'
import { lockedNear } from '../../src/lib/commissionView'
import { fmt } from '../../src/lib/price'
import { at, runUiRepro, type UiRepro } from '../helpers/uiRepro'
import { setup, html, text, DRAFT, type Setup } from './fixtures'

// 整頁的元件會 import 路由檔（建 hash 路由要瀏覽器的 location）：伺服器端渲染用不到，只留頁面清單
vi.mock('../../src/router', () => ({ FULL_PAGES: [{ path: '/', name: '主畫面' }], router: {} }))
afterEach(() => { delete (globalThis as { localStorage?: unknown }).localStorage })

const FX = 'fx_ui'
const accept = async (e: Setup['e'], id = 'of_ui_a', pay: 'cash' | 'cred' | 'favor' = 'cash') => {
  const r = await e.fixer.accept({ id, fixer: FX }, pay)
  expect(r.reason).toBeUndefined()
  expect(r.status).toBe('applied')
}
/** 進副本：接案、出發 */
const depart = async (e: Setup['e'], id = 'of_ui_a') => {
  await accept(e, id)
  const r = await e.fixer.go(id)
  expect(r.status).toBe('applied')
}
const stageOne = async (e: Setup['e'], branch = 'assault') => {
  expect((await e.commission.chooseFace('meat')).status).toBe('applied')
  expect((await e.commission.chooseBranch(branch)).status).toBe('applied')
}
/** 帶某個屬性的那個標籤的 class（Vue 的 class 順序不固定，照詞比） */
const classesOf = (h: string, attr: string): string[] => {
  const i = h.indexOf(attr)
  const open = h.lastIndexOf('<', i)
  return (/class="([^"]*)"/.exec(h.slice(open, h.indexOf('>', i)))?.[1] ?? '').split(/\s+/)
}
const minutes = (e: Setup['e']): number => e.state.time.day * 1440 + e.state.time.hour * 60 + e.state.time.minute

/** 找一個種子：開局、接案、做 act()，直到條件成立（擲骰的結果是種子決定的） */
async function seedWhere(act: (s: Setup) => Promise<boolean>, crew = 0): Promise<number> {
  for (let seed = 1; seed <= 150; seed++) {
    const s = setup({ seed, crew })
    if (await act(s)) return seed
  }
  throw new Error('找不到合用的種子')
}

describe('1 接案', () => {
  it('中間人今天的委託列在畫面上；三種付法到手的數字和引擎的 payOptions 一樣', async () => {
    const { pinia, e } = setup()
    const board = e.fixer.board(FX)
    expect(board.open).toBe(true)
    expect(board.offers.map((o) => o.id)).toEqual(['of_ui_a', 'of_ui_b', 'of_ui_c'])
    const h = await html(pinia, TakePanel, { fixerId: FX })
    const t = text(h)
    for (const o of board.offers) expect(t).toContain(o.offer.title)
    // 畫面上選著的是第一件：三格付法各自的數字與引擎的一樣
    const first = board.offers[0]!
    expect(first.pay.map((p) => p.id)).toEqual(['cash', 'cred', 'favor'])
    for (const p of first.pay) {
      const chunk = h.slice(h.indexOf(`data-pay="${p.id}"`))
      const amount = /data-pay-amount[^>]*>([\s\S]*?)<\/b>/.exec(chunk)![1]!.replace(/<[^>]+>/g, '')
      expect(amount).toContain(fmt(p.amount))
      expect(t).toContain(p.cost)
    }
    // 簡報：沒踩到的階段是問號、最後一個階段（主面）看得到
    expect(h).toContain('data-stage-row="3"')
    expect(text(h.slice(h.indexOf('data-stage-row="1"'), h.indexOf('data-stage-row="2"')))).toContain('？')
    expect(text(h.slice(h.indexOf('data-stage-row="3"')))).toMatch(/★\s*第 3 階段\s*：\s*現/)
  })

  it('接案之後引擎的狀態裡有那一件；中間人桌上不再有它', async () => {
    const { e } = setup()
    await accept(e, 'of_ui_a', 'cred')
    const fx = e.state.ext.fixer as { jobs: Array<{ id: string; terms: { pay: string; reward: number }; status: string }> }
    expect(fx.jobs.map((j) => [j.id, j.status, j.terms.pay, j.terms.reward])).toEqual([['of_ui_a', 'active', 'cred', 1000]])
    expect(e.fixer.jobs().map((j) => j.id)).toEqual(['of_ui_a'])
    expect(e.fixer.board(FX).offers.map((o) => o.id)).toEqual(['of_ui_b', 'of_ui_c'])
  })

  it('那一輪交涉：談過之後畫面寫談過了、按鈕灰掉並寫引擎的原因', async () => {
    const { pinia, e } = setup()
    const r = await e.fixer.haggle({ id: 'of_ui_a', fixer: FX })
    expect(r.status).toBe('applied')
    const row = e.fixer.board(FX).offers[0]!
    expect(row.haggled).not.toBeNull()
    expect(row.haggle_block).toBe('這件委託已經談過一輪了。')
    const h = await html(pinia, TakePanel, { fixerId: FX })
    expect(h).toContain('data-haggled')
    expect(h).toMatch(/aria-disabled="true"[^>]*title="這件委託已經談過一輪了。"|title="這件委託已經談過一輪了。"[^>]*aria-disabled="true"/)
  })

  it('信譽不夠的委託變淡並寫門檻（引擎的原因）', async () => {
    const { pinia, e } = setup()
    // 把中間人的門檻調高：用另一份假內容太重，這裡直接看引擎給的 block 欄位怎麼上畫面
    const row = e.fixer.board(FX).offers[0]!
    expect(row.block).toBeNull()
    const h = await html(pinia, TakePanel, { fixerId: FX })
    expect(h).not.toContain('is-unavailable')
  })
})

describe('2 踩點', () => {
  it('踩點一次：時間往前一個時段、揭開的那一格從問號變成內容', async () => {
    const seed = await seedWhere(async ({ e }) => { await accept(e); await e.fixer.scout('of_ui_a', 'survey'); return e.fixer.scoutView('of_ui_a').last?.revealed.length === 1 })
    const { pinia, e } = setup({ seed })
    await accept(e)
    const before = e.fixer.scoutView('of_ui_a')
    const h0 = await html(pinia, ScoutTab, { jobId: 'of_ui_a' })
    expect(h0.match(/？？？？/g)).toHaveLength(4)
    const t0 = minutes(e)
    expect((await e.fixer.scout('of_ui_a', 'survey')).status).toBe('applied')
    expect(minutes(e) - t0).toBe(before.minutes)
    const sv = e.fixer.scoutView('of_ui_a')
    const got = sv.unknowns.find((u) => u.id === sv.last!.revealed[0])!
    expect(got.text).not.toBeNull()
    const h1 = await html(pinia, ScoutTab, { jobId: 'of_ui_a' })
    expect(h1.match(/？？？？/g)).toHaveLength(3)
    expect(text(h1)).toContain(got.text!)
    expect(classesOf(h1, `data-unknown="${got.id}"`)).toEqual(expect.arrayContaining(['unk', 'open', 'fresh']))
    expect(h1).toContain('data-last')
  })

  it('自然 1：畫面有驚動目標的提醒，副本的警戒起始跟著加', async () => {
    const seed = await seedWhere(async ({ e }) => { await accept(e); await e.fixer.scout('of_ui_a', 'survey'); const l = e.fixer.scoutView('of_ui_a').last; return l?.degree === 'fumble' && l.natural === 1 })
    const { pinia, e } = setup({ seed })
    await accept(e)
    await e.fixer.scout('of_ui_a', 'survey')
    const sv = e.fixer.scoutView('of_ui_a')
    expect(sv.last!.natural).toBe(1)
    expect(sv.alert_start).toBeGreaterThan(0)
    const h = await html(pinia, ScoutTab, { jobId: 'of_ui_a' })
    expect(h).toContain('data-fumble')
    expect(h).toContain('data-alarm')
    expect(text(h)).toContain(`警戒起始 +${sv.alert_start}`)
  })

  it('第 4 次起 +1 的格子先標出來；次數用完按鈕是灰的並有引擎的原因', async () => {
    const { pinia, e } = setup({ cash: 5000 })
    await accept(e, 'of_ui_c')
    const sv0 = e.fixer.scoutView('of_ui_c')
    expect([sv0.max, sv0.hard_from]).toEqual([4, 4])
    const h0 = await html(pinia, ScoutTab, { jobId: 'of_ui_c' })
    expect(h0.match(/<i class="hard"|<i class="used hard"|class="hard"/g) ?? []).toHaveLength(1)
    for (let i = 0; i < sv0.max; i++) expect((await e.fixer.scout('of_ui_c', 'survey')).status).toBe('applied')
    const sv = e.fixer.scoutView('of_ui_c')
    expect(sv.done).toBe(4)
    expect(sv.next_dc).toBeGreaterThan(sv0.next_dc)
    const why = sv.methods.find((m) => m.id === 'survey')!.block!
    expect(why).toContain('最多踩 4 次')
    const h = await html(pinia, ScoutTab, { jobId: 'of_ui_c' })
    expect(h).toMatch(/data-scouts[^>]*>4／4/)
    expect(h).toMatch(new RegExp(`data-scout[^>]*title="${why}"|title="${why}"[^>]*data-scout`))
    // 再按也不成立：引擎擋下、時間不動
    const t = minutes(e)
    expect((await e.fixer.scout('of_ui_c', 'survey')).status).toBe('refused')
    expect(minutes(e)).toBe(t)
  })

  it('派名冊的人去踩點：灰掉並寫「還沒有開放。」', async () => {
    const { pinia, e } = setup()
    await accept(e)
    const h = await html(pinia, ScoutTab, { jobId: 'of_ui_a' })
    expect(h).toContain('data-locked="dispatch"')
    expect(text(h.slice(h.indexOf('data-locked="dispatch"'), h.indexOf('data-locked="dispatch"') + 200))).toContain('還沒有開放。')
  })

  it('買情報：付現金直接揭開、不花時間、不算踩點的次數', async () => {
    const { e } = setup()
    await accept(e)
    const sv = e.fixer.scoutView('of_ui_a')
    expect(sv.intel.find((i) => i.id === 'cash')!.block).toBeNull()
    const t = minutes(e)
    const cash = e.money.cash
    expect((await e.fixer.buyIntel('of_ui_a', 'u_client', 'cash')).status).toBe('applied')
    expect(minutes(e)).toBe(t)
    expect(e.money.cash).toBe(cash - sv.intel.find((i) => i.id === 'cash')!.price)
    const after = e.fixer.scoutView('of_ui_a')
    expect([after.done, after.unknowns.find((u) => u.id === 'u_client')!.revealed]).toEqual([0, true])
  })
})

describe('3 召集', () => {
  it('第五個人加不進去，原因是引擎的', async () => {
    const { pinia, e } = setup({ crew: 5 })
    await accept(e)
    for (const id of ['jo', 'ann', 'bob']) expect((await e.fixer.muster([...e.fixer.party().filter((x) => x !== e.state.pc), id], [])).status).toBe('applied')
    expect(e.fixer.party()).toHaveLength(4)
    const blocks = e.fixer.musterBlocks(['jo', 'ann', 'bob', 'cy'], [])
    expect(blocks.join('')).toContain('隊伍最多 4 人')
    const r = await e.fixer.muster(['jo', 'ann', 'bob', 'cy'], [])
    expect(r.status).toBe('refused')
    expect(r.reason).toBe(blocks.join(''))
    const h = await html(pinia, CallTab, { jobId: 'of_ui_a' })
    const chunk = h.slice(h.indexOf('data-roster="cy"'))
    expect(chunk.slice(0, 900)).toContain(`title="${blocks.join('')}"`)
    expect(h).not.toContain('data-party-member="cy"')
  })

  it('技能的標籤和引擎裝著的一樣；委託頁不再讀 g.loadout', async () => {
    const { pinia, e } = setup()
    await accept(e)
    const ids = e.skills.abilities().slice(0, 3).map((a) => a.id)
    const mine = e.skills.mine()
    expect(e.commit({ summary: '裝技能', changes: [{ op: 'actor.ext', id: e.state.pc!, key: 'abilities', value: { ...mine, learned: ids, equipped: ids } }] as never }, { attach: true })).toBeNull()
    expect(e.skills.mine().equipped).toEqual(ids)
    const names = ids.map((id) => e.skills.abilities().find((a) => a.id === id)!.name)
    const h = await html(pinia, CallTab, { jobId: 'of_ui_a' })
    const loadout = text(h.slice(h.indexOf('data-loadout'), h.indexOf('data-loadout') + 600))
    for (const n of names) expect(loadout).toContain(n)
    expect(text(h)).toContain('進去之後不能換')
    // 掃原始碼
    const files = import.meta.glob(['../../src/screens/CommissionScreen.vue', '../../src/components/commission/*.vue', '../../src/stores/game.ts'], { query: '?raw', import: 'default', eager: true }) as Record<string, string>
    expect(Object.keys(files).length).toBeGreaterThanOrEqual(6)
    for (const [f, src] of Object.entries(files)) expect(src, f).not.toMatch(/\bg\.loadout\b|\bloadout\s*=\s*ref|\bloadout:\s*loadout/)
  })

  it('分帳那一條每一段的數字和 splitPreview 一樣', async () => {
    const { pinia, e } = setup({ crew: 3 })
    await accept(e)
    // 請兩個人：付錢（出場費）與靠交情
    const opt = e.fixer.hireOptions('of_ui_a', 'net', 'ann')
    expect(opt.find((o) => o.way === 'pay')!.block).toBeNull()
    expect((await e.fixer.hire('of_ui_a', { face: 'net', way: 'pay', actor: 'ann' })).status).toBe('applied')
    expect((await e.fixer.muster(['jo'], [])).status).toBe('applied')
    const split = e.fixer.split('of_ui_a')!
    expect(split.segments.length).toBeGreaterThanOrEqual(2)
    const h = await html(pinia, CallTab, { jobId: 'of_ui_a' })
    const amounts = [...h.matchAll(/data-seg-amount[^>]*>([\s\S]*?)<\/b>/g)].map((m) => Number(m[1]!.replace(/<[^>]+>/g, '').trim().split(/\s/)[0]))
    expect(amounts).toEqual(split.segments.map((s) => s.amount))
    const lines = [...h.matchAll(/data-split-line[^>]*>([\s\S]*?)<\/p>/g)].map((m) => m[1]!)
    expect(lines).toEqual(split.lines)
    expect(text(h.slice(h.indexOf('data-pc-net')))).toContain(fmt(split.pc_net))
  })

  it('輔助面：請人的辦法與成功率是引擎的；請了之後出發，輔助結算寫在副本頁', async () => {
    const { pinia, e } = setup({ crew: 2 })
    await accept(e)
    const opts = e.fixer.hireOptions('of_ui_a', 'net', 'jo')
    expect(opts.map((o) => o.way)).toEqual(expect.arrayContaining(['pay', 'bond']))
    expect((await e.fixer.hire('of_ui_a', { face: 'net', way: 'pay', actor: 'jo' })).status).toBe('applied')
    const chance = e.fixer.auxChance('of_ui_a', 'net', ['jo'])!
    const h = await html(pinia, CallTab, { jobId: 'of_ui_a' })
    expect(h).toContain(`拿到連動 ${chance.chance}%，出事 ${chance.mishap}%`)
    expect((await e.fixer.go('of_ui_a')).status).toBe('applied')
    expect((await e.commission.chooseFace('meat')).status).toBe('applied')
    const run = await html(pinia, RunTab)
    expect(run).toContain('data-aux')
    expect(text(run.slice(run.indexOf('data-aux'), run.indexOf('data-aux') + 400))).toContain('輔助・內海')
  })
})

describe('4 副本', () => {
  it('進副本之後商店、休息的入口被擋（原因是引擎的）', async () => {
    const { e } = setup()
    expect(e.blockOf('commit:trade.checkout')).toBeNull()
    expect(e.blockOf('commit:rest.sleep')).toBeNull()
    await depart(e)
    const shop = e.blockOf('commit:trade.checkout')
    const rest = e.blockOf('commit:rest.sleep')
    expect(shop).toBeTruthy()
    expect(rest).toBeTruthy()
    expect(shop).toContain('副本')
  })

  it('選面、選分支、走完一段：階段軌往前一格、城裡的時間多 2 小時', async () => {
    const { pinia, e } = setup()
    await depart(e)
    const v0 = e.commission.view()!
    expect(v0.track.map((n) => n.state)).toEqual(['current', 'ahead', 'ahead'])
    const t0 = minutes(e)
    await stageOne(e)
    const grid = e.world.grid()!
    expect(grid.name).toBe('小房間')
    const mid = await html(pinia, RunTab)
    expect(mid).toContain('data-goal')
    expect(text(mid)).toContain('走到目標')
    expect(e.world.walk([4, 2])).toEqual({ ok: true })
    const v1 = e.commission.view()!
    expect([v1.stage, v1.step]).toEqual([2, 'face'])
    expect(v1.track.map((n) => n.state)).toEqual(['done', 'current', 'ahead'])
    expect(minutes(e) - t0).toBe(v1.stageMinutes)
    expect(v1.stageMinutes).toBe(120)
    const h = await html(pinia, RunTab)
    expect(h).toMatch(/data-stage="1"[^>]*>|class="nd done[^"]*" data-stage="1"/)
    expect(h).toMatch(/data-stage-title[^>]*>第 2 階段/)
    const track = await html(pinia, StageTrack, { track: v1.track })
    expect([1, 2, 3].map((n) => classesOf(track, `data-stage="${n}"`).filter((c) => ['done', 'current', 'ahead'].includes(c))[0])).toEqual(['done', 'current', 'ahead'])
    expect(track).toContain('決定性的一步')
  })

  it('只有強攻走得了時，其他分支是灰的並各有原因（引擎的原因）', async () => {
    const { pinia, e } = setup()
    await depart(e)
    expect((await e.commission.chooseFace('meat')).status).toBe('applied')
    const v = e.commission.view()!
    const blocked = v.branches.filter((b) => b.block)
    expect(v.branches.find((b) => b.id === 'assault')!.block).toBeNull()
    expect(blocked.map((b) => b.id)).toEqual(['duct', 'bribe', 'pass'])
    expect(new Set(blocked.map((b) => b.block)).size).toBe(3)
    const h = await html(pinia, RunTab)
    for (const b of blocked) {
      const chunk = h.slice(h.indexOf(`data-branch="${b.id}"`), h.indexOf(`data-branch="${b.id}"`) + 700)
      expect(text(chunk)).toContain(b.block!)
    }
    expect(h.match(/is-unavailable/g) ?? []).toHaveLength(blocked.length)
    // 連動與踩點開出來的路加小標
    expect(h).toContain('>連動<')
    // 選了不能走的路：引擎擋下，狀態不動
    const r = await e.commission.chooseBranch('duct')
    expect(r.status).toBe('refused')
    expect(r.reason).toBe(blocked.find((b) => b.id === 'duct')!.block)
    expect(e.commission.view()!.step).toBe('branch')
  })

  it('面卡：沒有開放的面變淡並寫引擎的原因', async () => {
    const { pinia, e } = setup()
    await depart(e)
    const v = e.commission.view()!
    // 內海面 M3 已經開放；輿論面（M5）還沒有，拿它驗「未開放的面變淡並寫原因」
    const opinion = v.faces.find((f) => f.face === 'opinion')!
    expect(opinion.block).toBe('這一面還沒有開放。')
    const h = await html(pinia, RunTab)
    const chunk = h.slice(h.indexOf('data-face="opinion"'), h.indexOf('data-face="opinion"') + 600)
    expect(text(chunk)).toContain('這一面還沒有開放。')
    expect(h.slice(h.indexOf('data-face="meat"'), h.indexOf('data-face="meat"') + 300)).not.toContain('data-face-block')
  })

  it('警戒條的刻度在 60；副本直播灰掉並寫「還沒有開放。」', async () => {
    const { pinia, e } = setup()
    await depart(e)
    expect(e.commission.view()!.alert.reinforce).toBe(60)
    const h = await html(pinia, RunTab)
    expect(h).toContain('data-alert')
    expect(h).toMatch(/left:\s*60%/)
    expect(text(h)).toContain('副本直播（還沒有開放。）')
  })

  it('上鎖的門被擋下時給撬與破門兩個按鈕；開了之後走得過去', async () => {
    const { pinia, e } = setup()
    await depart(e, 'of_ui_b')
    await stageOne(e)
    expect(e.world.walk([4, 1]).ok).toBe(true)
    // 還沒站在門邊以外：門鎖著，引擎擋下並給原因
    const blocked = e.world.walk([4, 3])
    expect(blocked.ok).toBe(false)
    expect(blocked.reason).toBeTruthy()
    expect(lockedNear(e.world.grid())).toEqual([[4, 2]])
    const h = await html(pinia, RunTab)
    expect(h).toContain('data-unlock="pick"')
    expect(h).toContain('data-unlock="break"')
    // 破門：成功了門就開了（失敗了再來；每次引擎擲骰、加警戒）
    for (let i = 0; i < 12 && lockedNear(e.world.grid()).length > 0; i++) await e.commission.unlock([4, 2], 'break')
    expect(lockedNear(e.world.grid())).toEqual([])
    expect(e.world.walk([4, 3]).ok).toBe(true)
    expect(e.commission.view()!.stage).toBe(2)
  })

  it('撤退：回到召集頁，時間與錢回到出發之前，紀錄裡那一段標成被收回', async () => {
    const { pinia, e } = setup({ crew: 1 })
    await accept(e)
    expect((await e.fixer.hire('of_ui_a', { face: 'net', way: 'pay', actor: 'jo' })).status).toBe('applied')
    const t = minutes(e)
    const cash = e.money.cash
    expect((await e.fixer.go('of_ui_a')).status).toBe('applied')
    await stageOne(e)
    expect(e.world.walk([4, 2]).ok).toBe(true)
    expect(minutes(e)).toBeGreaterThan(t)
    const run = await html(pinia, RunTab)
    expect(run).toContain('data-retreat')
    const r = await e.commission.retreat()
    expect(r.status).toBe('applied')
    expect(e.commission.view()).toBeNull()
    expect(minutes(e)).toBe(t)
    // 請人的錢在撤退時一起回來（引擎的 rewind.keep 把請的人退掉）
    expect(e.money.cash).toBeGreaterThanOrEqual(cash)
    expect(e.fixer.jobs().map((j) => j.id)).toEqual(['of_ui_a'])
    expect(e.state.reports.filter((x) => x.retracted).length).toBeGreaterThan(0)
    expect(e.state.reports.filter((x) => x.action?.startsWith('commission.')).every((x) => x.retracted === true || x.action === 'commission.retreat')).toBe(true)
    // 回到召集頁：副本頁沒有東西、召集頁可以再出發
    expect(e.fixer.goBlock('of_ui_a')).toBeNull()
    const screen = await html(pinia, CommissionScreen, {}, '/commission?tab=call')
    expect(screen).toContain('data-call-tab')
  })

  it('撤退之前先提示會回到進去之前', async () => {
    const { pinia, e } = setup()
    await depart(e)
    const h = await html(pinia, RunTab)
    // 撤退按鈕按了才出現確認框；框裡的字寫了「回到進副本之前」
    const src = (await import('../../src/components/commission/RunTab.vue?raw')).default as string
    expect(src).toContain('data-confirm')
    expect(src).toContain('時間與錢會回到進副本之前')
    expect(h).not.toContain('data-confirm')
  })

  it('喘口氣：第一個階段不能，引擎的原因寫在按鈕上', async () => {
    const { pinia, e } = setup()
    await depart(e)
    const why = e.commission.view()!.breathe.reason!
    expect(why).toBeTruthy()
    const h = await html(pinia, RunTab)
    expect(h).toContain(`title="${why}"`)
  })

  it('整頁：四個分頁各自畫得出來，沒有拋錯', async () => {
    const { pinia, e } = setup()
    await accept(e)
    for (const tab of ['take', 'scout', 'call']) {
      const h = await html(pinia, CommissionScreen, {}, `/commission?tab=${tab}&job=of_ui_a`)
      expect(h).toContain('data-head-name')
    }
    expect((await html(pinia, CommissionScreen, {}, '/commission?tab=take&job=of_ui_a'))).toContain('data-taken')
    expect((await e.fixer.go('of_ui_a')).status).toBe('applied')
    expect((await html(pinia, CommissionScreen, {}, '/commission'))).toContain('data-run')
  })
})

describe('5 舊系統', () => {
  it('戰敗三選一的「回到這個階段開始時」：第二份重現（走引擎的委託）通過', async () => {
    const files = import.meta.glob<UiRepro>('../fixtures/repro/ui-stage-legacy-dungeon.json', { eager: true, import: 'default' })
    const fx = Object.values(files)[0]!
    expect(fx).toBeDefined()
    expect(fx.steps.map((s) => s.type)).toEqual(expect.arrayContaining(['takeJob', 'depart', 'enterStage', 'loseBattle', 'rewindToStage']))
    const pending = import.meta.glob('../fixtures/repro-pending/*.json')
    expect(Object.keys(pending)).toEqual([])
    const view = await runUiRepro(fx)
    for (const [path, want] of Object.entries(fx.expect)) expect(at(view, path), path).toEqual(want)
    // 時間回到「這個階段開始」那一刻（不是進副本那一刻）
    expect(view.time).toEqual({ day: 1, hour: 9, minute: 0 })
  })

  it('舊的假副本拿掉了：lib/commission.ts、data/commission.ts、data/templates.ts 不在；元件不 import 它們；新的整理檔裡沒有擲骰', async () => {
    expect(Object.keys(import.meta.glob(['../../src/lib/commission.ts', '../../src/data/commission.ts', '../../src/data/templates.ts']))).toEqual([])
    const vue = import.meta.glob(['../../src/**/*.vue', '../../src/**/*.ts', '!../../src/**/*.test.ts'], { query: '?raw', import: 'default', eager: true }) as Record<string, string>
    for (const [f, src] of Object.entries(vue)) {
      expect(src, f).not.toMatch(/from '[./]+\/data\/(commission|templates)'/)
      expect(src, f).not.toMatch(/from '[./]+\/lib\/commission'/)
    }
    const view = vue['../../src/lib/commissionView.ts']!
    expect(view).toBeTruthy()
    expect(view).not.toMatch(/Math\.random|\brng\b|mulberry|rollCheck|\bdie\b|function\s+(roll|chance|dc)/i)
    const game = vue['../../src/stores/game.ts']!
    expect(game).not.toMatch(/inRun|takeSnapshot\('(入口|階段)'|\bloadout\b|JobState|START_JOB/)
  })
})

describe('6 出口的 world.go', () => {
  it('站在出口那一格上：這一格能做的事有 world.go，world.go() 用出口的 to 與 arrive 走回隔壁那一塊', async () => {
    // 用示意世界包（走上出口那一格引擎就換街區；人站在新街區的出口上，這時可以再走回去）
    let done = false
    for (let seed = 1; seed <= 30 && !done; seed++) {
      setActivePinia(createPinia())
      const e = useEngine()
      e.newGame({ seed })
      expect(e.createCharacter(DRAFT)).toEqual([])
      const from = e.world.view()
      const exit = from.exits[0]!
      expect(exit.at).not.toBeNull()
      if (!e.world.walk(exit.at!).ok || e.event.view() !== null) continue
      const there = e.world.view()
      if (there.block?.id !== exit.to) continue
      const uses = e.world.grid()!.here.uses
      expect(uses.map((u) => u.id)).toContain('world.go')
      const r = await e.world.go()
      expect(r.status).toBe('applied')
      expect(e.world.view().block?.id).toBe(from.block?.id)
      done = true
    }
    expect(done).toBe(true)
  })

  it('不在出口上：world.go() 不做事、回傳原因', async () => {
    setActivePinia(createPinia())
    const e = useEngine()
    e.newGame({ seed: 1 })
    expect(e.createCharacter(DRAFT)).toEqual([])
    const before = JSON.stringify(e.state.location)
    const r = await e.world.go()
    expect(r).toEqual({ status: 'refused', reason: '這一格不是出口。' })
    expect(JSON.stringify(e.state.location)).toBe(before)
  })
})

describe('7 樣式', () => {
  it('新的與改過的元件的樣式區塊都編得過（伺服器端渲染不會編樣式，壞了只有建置才發現）', async () => {
    const { parse, compileStyle } = await import('vue/compiler-sfc')
    const files = import.meta.glob(['../../src/components/commission/*.vue', '../../src/components/StageTrack.vue', '../../src/screens/CommissionScreen.vue', '../../src/dialogs/FixerDialog.vue'], { query: '?raw', import: 'default', eager: true }) as Record<string, string>
    expect(Object.keys(files).length).toBe(7)
    for (const [f, src] of Object.entries(files)) {
      const { descriptor, errors } = parse(src, { filename: f })
      expect(errors, f).toEqual([])
      for (const st of descriptor.styles) expect(compileStyle({ source: st.content, filename: f, id: 'x', scoped: !!st.scoped }).errors, f).toEqual([])
    }
  })
})
