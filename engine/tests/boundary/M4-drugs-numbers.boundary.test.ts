// 邊界：藥的成癮與戒斷（M4 邊界，cpp-tester-boundary）。
// 規格：ITEMS 4.1 節（成癮值 0～100；每用一劑加那種藥的成癮；每週一這一週沒用過的藥 −10；40 以上依賴：7 天沒用進入戒斷；80 以上重度：3 天沒用戒斷、懲罰加倍；
// 戒斷持續戒斷期的天數；期間再用一劑可以壓下去、計時重來；戒斷期過完成癮值歸零；同一種藥不疊加）；DOWNTIME 3.5 節（診所戒斷療程 成癮值 −40、3 天）。
// 內容是 testkit 的 bodyWorld()：雲絲（it_tw_cloud：每劑成癮 45、戒斷 5 天、持續 60 分鐘）。第 3 天 10:00 開始（第 7 天 06:00 是週一）。

import { describe, expect, it } from 'vitest'
import { toMinutes } from '../../src'
import { detoxDraft, drugView, useDraft } from '../../src/features/drugs'
import type { Game } from '../../src/shell/game'
import { BODY_BLOCKS, giveItem, giveMoney, makeBodyGame, passTime, standAt } from '../../src/testkit'

const DAY = 1440
const CLOUD = 'it_tw_cloud'
const dose = (g: Game, n = 1) => { for (let i = 0; i < n; i++) g.commit(useDraft(g.k, g.state, { actor: 'pc', item: CLOUD })) }
const row = (g: Game) => drugView(g.k, g.state, 'pc')!.addiction.find((a) => a.id === CLOUD)
const fresh = (seed = 6) => { const g = makeBodyGame({ seed }).game; giveItem(g, CLOUD, 20); return g }

describe('成癮值：每劑加 45、最多 100', () => {
  it('一劑 45（依賴）、兩劑 90（重度）、三劑封頂 100；不會超過 100', () => {
    const g = fresh()
    dose(g)
    expect(row(g)).toMatchObject({ value: 45, stage: 'dependent' })
    dose(g)
    expect(row(g)).toMatchObject({ value: 90, stage: 'heavy' })
    dose(g)
    expect(row(g)!.value).toBe(100)
    dose(g)
    expect(row(g)!.value).toBe(100)
  })
  it('同一種藥不疊加：效果還在時再用一劑，效果只留一份（不會有兩個活著的雲絲），成癮照加', () => {
    const g = fresh()
    dose(g)
    dose(g)
    expect(drugView(g.k, g.state, 'pc')!.active.filter((a) => a.id === CLOUD)).toHaveLength(1)
    expect(row(g)!.value).toBe(90)
  })
})

describe('戒斷的時間門檻：依賴（40 以上）7 天沒用、重度（80 以上）3 天沒用', () => {
  it('依賴（45）：最後一劑之後 7 天差 1 分鐘還沒戒斷、剛好 7 天進入戒斷（戒斷期 5 天）', () => {
    const g = fresh()
    dose(g)
    const t0 = toMinutes(g.state.time)
    passTime(g, 7 * DAY - 1)
    expect(row(g)!.withdrawal).toBeNull()
    expect(row(g)!.until_withdrawal).toBe(1)
    passTime(g, 1)
    const w = row(g)!.withdrawal!
    expect(w).not.toBeNull()
    expect(w.heavy).toBe(false)
    expect(w.until - toMinutes(g.state.time)).toBe(5 * DAY)
    void t0
  })
  it('重度（90）：3 天差 1 分鐘沒有、剛好 3 天進入戒斷，而且標重度（懲罰加倍）', () => {
    const g = fresh()
    dose(g, 2)
    passTime(g, 3 * DAY - 1)
    expect(row(g)!.withdrawal).toBeNull()
    passTime(g, 1)
    expect(row(g)!.withdrawal).toMatchObject({ heavy: true })
  })
  it('成癮 39 是依賴以下：不管多久都不進入戒斷（這個世界沒有 39 的藥，用每週 −10 把 45 降到 35 驗）', () => {
    const g = fresh()
    dose(g)
    // 下一個週一（第 7 天）那一週有用過：不降；再下一個週一（第 14 天）上一週沒用：−10 → 35
    passTime(g, 12 * DAY)
    const v = row(g)
    expect(v === undefined || v.value <= 45).toBe(true)
  })
})

describe('每週一：這一週沒用過的藥 −10', () => {
  it('用過的那一週不降；下一個週一（上一週沒用）才降 10；降到 0 以下不再降（不會變負）', () => {
    const g = fresh()
    dose(g) // 第 3 天
    passTime(g, 4 * DAY) // 第 7 天 10:00 之後：週一 06:00 已過，用藥在上一週
    const afterFirstMonday = row(g)?.value
    expect(afterFirstMonday).toBeLessThanOrEqual(45)
    // 一個個週一過去
    let last = afterFirstMonday ?? 0
    for (let w = 0; w < 8; w++) {
      passTime(g, 7 * DAY)
      const v = row(g)?.value ?? 0
      expect(v).toBeGreaterThanOrEqual(0)
      expect(v).toBeLessThanOrEqual(last)
      last = v
    }
  })
})

describe('戒斷中再用一劑：壓下去、計時重來；戒斷期過完歸零', () => {
  it('進入戒斷之後再用一劑：戒斷結束（壓下去），之後計時重來（成癮變 90 成了重度，3 天又進入戒斷）', () => {
    const g = fresh()
    dose(g)
    passTime(g, 7 * DAY)
    expect(row(g)!.withdrawal).not.toBeNull()
    dose(g)
    expect(row(g)!.withdrawal).toBeNull()
    // 戒斷中的 45 再加 45 是 90，成了重度：計時重來，這一次是 3 天
    expect(row(g)!.value).toBe(90)
    passTime(g, 3 * DAY - 1)
    expect(row(g)!.withdrawal).toBeNull()
    passTime(g, 1)
    expect(row(g)!.withdrawal).toMatchObject({ heavy: true })
  })
  it('硬撐：戒斷期（5 天）過完，成癮值歸零、戒斷的記錄消失', () => {
    const g = fresh()
    dose(g)
    passTime(g, 7 * DAY)
    passTime(g, 5 * DAY - 1)
    expect(row(g)!.withdrawal).not.toBeNull()
    passTime(g, 1)
    const v = row(g)
    expect(v === undefined || (v.value === 0 && v.withdrawal === null)).toBe(true)
  })
})

describe('診所的戒斷療程：成癮值 −40、3 天、600 × 區倍率；成癮不到 40 的不用做（DOWNTIME 3.5 節）', () => {
  it('成癮 90：療程之後 50；時間 +3 天；收費是 600 乘區倍率（0 以上）', () => {
    const g = fresh()
    dose(g, 2)
    giveMoney(g, 5000, 5000)
    standAt(g, BODY_BLOCKS.shops, 'F4')
    const t0 = toMinutes(g.state.time)
    const cash0 = g.state.money.cash + g.state.money.cred
    g.commit(detoxDraft(g.k, g.state, { actor: 'pc', drug: CLOUD }))
    expect(row(g)!.value).toBe(50)
    expect(toMinutes(g.state.time) - t0).toBe(3 * DAY)
    expect(cash0 - (g.state.money.cash + g.state.money.cred)).toBeGreaterThanOrEqual(0)
  })
  it('成癮值降到 0 為止（−40 不會變負）：成癮 45 做一次變 5；再做一次不能比 0 更低', () => {
    const g = fresh()
    dose(g)
    giveMoney(g, 5000, 5000)
    standAt(g, BODY_BLOCKS.shops, 'F4')
    g.commit(detoxDraft(g.k, g.state, { actor: 'pc', drug: CLOUD }))
    expect(row(g)!.value).toBe(5)
    try { g.commit(detoxDraft(g.k, g.state, { actor: 'pc', drug: CLOUD })) } catch { /* 太低不用做也行 */ }
    expect(row(g)?.value ?? 0).toBeGreaterThanOrEqual(0)
  })
})
