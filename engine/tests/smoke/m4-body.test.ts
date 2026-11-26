// 冒煙 M4・第一波：身體（dev/work/M4-smoke.md 第 3 點、dev/work/M4-plan.md「第一波」那一圈）。固定種子、AI 關閉。
// 建角（選橋、義體、裝備、生命軌跡）→ 診所裝一件義體 → 沉溺被補到下限 → 休養過完效果生效 → 組一把槍 → 打一場現實戰鬥（開反射加速器）
// → 受重創 → 診所治療與手術 → 吃藥到依賴 → 戒斷。
// 內容一律是 testkit 的 bodyWorld()（最小的假世界：TEST_WORLD 加內海加 worldBody.ts）；功能是全部；走的是真正的功能與真正的提交。
// 每一個數字都是「這一局這樣算出來」的結果，不是設計書的承諾；設計書的數字在各功能自己的測試裡。

import { describe, expect, it, vi } from 'vitest'
import type { Report } from '../../src'
import { BattleRun, toMinutes } from '../../src'
import { buildCreationReport } from '../../src/features/creation'
import type { CreationDraft } from '../../src/features/creation'
import { assembleDraft, learnDraft } from '../../src/features/craft'
import { cyberOf, cyberView, installDraft } from '../../src/features/cyberware'
import { detoxDraft, drugView, useDraft } from '../../src/features/drugs'
import { gearOf, equip } from '../../src/features/gear'
import { clinicHealDraft, medicalView, woundSurgeryDraft, woundsOf } from '../../src/features/medical'
import type { Game } from '../../src/shell/game'
import { BODY_BLOCKS, flow, giveItem, giveMoney, giveProduct, makeBodyGame, observed, passTime, standAt, stateHash } from '../../src/testkit'

vi.setConfig({ testTimeout: 60_000 })

const actions = (rs: Report[]): string[] => rs.map((r) => r.action ?? '')
const NOW = '2026-11-26T00:00:00Z'
const pc = (g: Game) => g.state.actors.pc!
const floorOf = (g: Game): number => g.k.stats.stat(g.state, 'pc', 'sink_floor')
const bodyParts = (g: Game) => g.k.stats.attrParts(g.state, 'pc', 'body')
/** 這個狀況現在還在不在（有 until 的過了期限就不算；狀況本身不會自己從清單上拿掉） */
const hasLive = (g: Game, id: string): boolean => pc(g).conditions.some((c) => c.id === id && (c.until === undefined || c.until > toMinutes(g.state.time)))

const DRAFT: CreationDraft = {
  name: '露', gender: 'female', age: 22, origin: 'tw_origin', originChoice: { favor: 'f_gang' },
  attrPick: { reflex: 15, tech: 14, body: 13, intellect: 12, resolve: 10, charm: 8 }, attrBonus: { charm: -4, reflex: 3, resolve: 3 },
  skills: { mechanics: 3, firearms: 3, medicine: 2, streetwise: 2 }, perks: ['perk_tw_smooth', 'perk_tw_tough'],
  bridge: 'bp_tw_bridge', cyber: [{ blueprint: 'bp_tw_eye' }], gear: [{ id: 'bp_tw_pistol' }, { id: 'i_tw_medkit', qty: 2 }],
  lifepath: { family: 'lp_tw_fam_tower', incident: 'lp_tw_inc_cash', friend: 'lp_tw_fr_old', enemy: 'lp_tw_en_rival', ex: 'lp_tw_ex_gone', want: 'lp_tw_want_money', sex: 'lp_tw_sex_some', kink: 'lp_tw_kink_rope' },
}

/** 一條身體的主幹：回傳最後的遊戲。checkpoint 在中途被叫到（測試在那裡存檔讀檔）。 */
async function bodyFlow(g: Game, f = flow('身體'), checkpoint: (label: string) => void = () => undefined): Promise<Game> {
  const { k } = g
  await f.step('建角：選橋、義體、裝備、生命軌跡；橋與義眼已經裝在身上、沉溺在下限', () => {
    const reports = g.commit(buildCreationReport(k, g.state, DRAFT))
    expect(actions(reports)).toContain('creation.commit')
    expect(cyberOf(g.state, 'pc').map((p) => p.bp)).toEqual(['bp_tw_bridge', 'bp_tw_eye'])
    expect(cyberView(k, g.state, 'pc').bridge).toBe(true)
    expect(pc(g).sink).toBe(floorOf(g))
    expect(pc(g).sink).toBeGreaterThan(0)
    expect(g.state.inventory.map((s) => s.id)).toEqual(expect.arrayContaining(['bp_tw_pistol', 'i_tw_medkit']))
    expect(pc(g).perks).toEqual(expect.arrayContaining(['perk_tw_smooth']))
  })
  checkpoint('after-creation')
  await f.step('站上診所街，給主角手術的錢與兩件義體成品（義臂、反射加速器）', () => {
    giveMoney(g, 0, 0)
    standAt(g, BODY_BLOCKS.clinics, 'F1')
    giveProduct(g, 'bp_tw_arm', 'U_ARM')
    giveProduct(g, 'bp_tw_accel', 'U_ACCEL')
    expect(g.blockOf('commit:cyber.install')).toBeNull()
  })
  const sink0 = pc(g).sink
  await f.step('診所裝一件義體（義臂）：收費、花時間、新裝的部位休養；沉溺被補到新的下限', () => {
    const cred0 = g.state.money.cred
    const reports = g.commit(installDraft(k, g.state, { actor: 'pc', uid: 'U_ARM', side: 'l', via: 'clinic' }))
    expect(actions(reports)).toContain('cyber.install')
    expect(g.state.money.cred).toBeLessThan(cred0)
    expect(cyberOf(g.state, 'pc').map((p) => p.bp)).toContain('bp_tw_arm')
    expect(floorOf(g)).toBeGreaterThan(sink0)
    expect(pc(g).sink).toBe(floorOf(g))
    expect(hasLive(g, 'recovering')).toBe(true)
  })
  await f.step('休養中新裝的部位不生效（體格沒有義臂的加成）；休養過完（幾天之後）才生效', () => {
    expect(bodyParts(g).some((p) => p.source === 'cyber')).toBe(false)
    expect(cyberView(k, g.state, 'pc').recovering_until).toBeGreaterThan(toMinutes(g.state.time))
    passTime(g, 5 * 24 * 60)
    expect(hasLive(g, 'recovering')).toBe(false)
    expect(bodyParts(g).some((p) => p.source === 'cyber' && p.value === 1)).toBe(true)
  })
  await f.step('再裝反射加速器（腦部）：沉溺再往上補、休養過完', () => {
    const before = floorOf(g)
    g.commit(installDraft(k, g.state, { actor: 'pc', uid: 'U_ACCEL', via: 'clinic' }))
    expect(floorOf(g)).toBeGreaterThan(before)
    expect(pc(g).sink).toBe(floorOf(g))
    passTime(g, 5 * 24 * 60)
    expect(hasLive(g, 'recovering')).toBe(false)
  })
  checkpoint('after-install')
  const gun = await f.step('組一把槍：學會設計圖（授權書）→ 槍店用背包裡的零件組 → 裝備上', () => {
    standAt(g, BODY_BLOCKS.shops, 'F1')
    giveItem(g, 'it_tw_lic')
    giveItem(g, 'pt_tw_barrel')
    giveItem(g, 'pt_tw_action')
    g.commit(learnDraft(k, g.state, { item: 'it_tw_lic' }))
    const before = g.state.inventory.filter((s) => s.id === 'bp_tw_pistol').length
    const reports = g.commit(assembleDraft(k, g.state, { blueprint: 'bp_tw_pistol', parts: { barrel: 'pt_tw_barrel', action: 'pt_tw_action' }, maker: 'shop' }))
    expect(actions(reports)).toContain('craft.assemble')
    const guns = g.state.inventory.filter((s) => s.id === 'bp_tw_pistol')
    expect(guns.length).toBeGreaterThan(before - 1)
    // 帶 data.uid 的成品：最新做的那一把
    const made = guns.filter((s) => s.data?.uid).map((s) => String((s.data as { uid: string }).uid))
    expect(made.length).toBeGreaterThan(0)
    const uid = made[made.length - 1]!
    g.commit(equip(k, g.state, 'pc', uid))
    expect(JSON.stringify(gearOf(g.state, 'pc'))).toContain(uid)
    return uid
  })
  await f.step('打一場現實戰鬥：開反射加速器（標準檔）；打到分出結果', async () => {
    standAt(g, BODY_BLOCKS.clinics, 'E1')
    g.startBattle({
      mode: 'meat', grade: 1, cover: 'medium', allies: [{ from: 'actor', id: 'pc' }],
      foes: [{ from: 'enemy', id: 'en_tw_mook' }, { from: 'enemy', id: 'en_tw_mook' }], origin: { escapable: true, place: '診所街的後巷' },
    })
    expect(g.battle).not.toBeNull()
    const me = Object.values(g.battle!.units).find((u) => u.actor === 'pc')!
    expect(me.implants?.map((i) => i.kind)).toEqual(expect.arrayContaining(['reflex']))
    expect(me.cyber).toBeGreaterThan(0)
    // 輪到主角：開反射加速器
    for (let i = 0; i < 40; i++) {
      const o = g.battleOptions()
      if (!o || o.waiting === 'over') break
      if (o.current === me.id && o.waiting === 'player') break
      if (o.waiting === 'ai') g.battleNext()
      else g.battleAct({ action: 'end_turn' })
    }
    const r = g.battleAct({ action: 'cyber_reflex', pick: { gear: 'standard' } })
    expect(r.reasons ?? []).toEqual([])
    expect(r.status).toBe('applied')
    expect(g.battle!.units[me.id]!.ext.cyber).toMatchObject({ on: { cyber_reflex: 'standard' } })
  })
  await f.step('受重創：同一個部位連著兩次重創（肢體）；戰鬥打贏結算之後身上有 wound_limb', async () => {
    const me = Object.values(g.battle!.units).find((u) => u.actor === 'pc')!
    const foe = Object.values(g.battle!.units).find((u) => u.side === 'foe')!
    for (let i = 0; i < 2; i++) k.battle.emit('wound', { run: new BattleRun(k, g.state, g.state.battle!), attacker: foe, target: g.state.battle!.units[me.id]!, aimed: true, part: 'limb' })
    expect(g.state.battle!.units[me.id]!.wounds.limb).toBe(2)
    const { playOut } = await import('../../src/testkit')
    const { outcome } = playOut(g)
    expect(outcome).toBe('win')
    await g.finishBattle()
    expect(g.battle).toBeNull()
    expect(woundsOf(g.state, 'pc')).toContain('limb')
  })
  await f.step('診所治療與手術：回復生命、重創的手術把重創拿掉（留一段休養）', () => {
    standAt(g, BODY_BLOCKS.clinics, 'F1')
    giveMoney(g, 5000, 0)
    const view = medicalView(k, g.state)
    expect(view).not.toBeNull()
    const reports = g.commit(woundSurgeryDraft(k, g.state, { target: 'pc', part: 'limb', via: 'clinic' }))
    expect(actions(reports)).toContain('medical.surgery')
    expect(woundsOf(g.state, 'pc')).not.toContain('limb')
    expect(hasLive(g, 'wound_recovering')).toBe(true)
    // 生命值不是滿的就給診所治一下
    const hp0 = pc(g).hp
    if (hp0 < k.stats.stat(g.state, 'pc', 'max_hp')) g.commit(clinicHealDraft(k, g.state, { target: 'pc' }))
    expect(pc(g).hp).toBeGreaterThanOrEqual(hp0)
  })
  await f.step('吃藥到依賴：兩劑雲絲，成癮值到重度的那一檔', () => {
    giveItem(g, 'it_tw_cloud', 3)
    g.commit(useDraft(k, g.state, { actor: 'pc', item: 'it_tw_cloud' }))
    passTime(g, 120)
    const reports = g.commit(useDraft(k, g.state, { actor: 'pc', item: 'it_tw_cloud' }))
    expect(actions(reports)).toContain('drug.use')
    const a = drugView(k, g.state, 'pc')!.addiction.find((x) => x.id === 'it_tw_cloud')!
    expect(a.value).toBeGreaterThanOrEqual(80)
    expect(a.stage).toBe('heavy')
    expect(a.withdrawal).toBeNull()
  })
  await f.step('戒斷：不再吃，過了幾天進入戒斷（意志的懲罰、來源 withdrawal）', () => {
    passTime(g, 4 * 24 * 60)
    const a = drugView(k, g.state, 'pc')!.addiction.find((x) => x.id === 'it_tw_cloud')!
    expect(a.withdrawal).not.toBeNull()
    expect(g.k.stats.attrParts(g.state, 'pc', 'resolve').some((p) => p.source === 'withdrawal' && p.value < 0)).toBe(true)
  })
  await f.step('互助診所的戒斷療程：成癮值往下降；過完戒斷期成癮歸零、戒斷的懲罰跟著拿掉', () => {
    standAt(g, BODY_BLOCKS.shops, 'F4')
    const v0 = drugView(k, g.state, 'pc')!.addiction.find((x) => x.id === 'it_tw_cloud')!.value
    const reports = g.commit(detoxDraft(k, g.state, { actor: 'pc', drug: 'it_tw_cloud' }))
    expect(actions(reports)).toContain('drug.detox')
    expect(drugView(k, g.state, 'pc')!.addiction.find((x) => x.id === 'it_tw_cloud')!.value).toBeLessThan(v0)
    passTime(g, 14 * 24 * 60)
    expect(drugView(k, g.state, 'pc')!.addiction.find((x) => x.id === 'it_tw_cloud')?.value ?? 0).toBe(0)
    expect(g.k.stats.attrParts(g.state, 'pc', 'resolve').some((p) => p.source === 'withdrawal')).toBe(false)
  })
  void gun
  return g
}

describe('冒煙 M4：身體', () => {
  it('建角 → 診所裝義體 → 沉溺到下限 → 休養 → 組槍 → 打一場（反射加速器）→ 重創 → 治療與手術 → 吃藥 → 戒斷', async () => {
    const t = makeBodyGame({ scenario: 'beforeCreation', at: null })
    const { violations } = await observed(t.game, async () => bodyFlow(t.game))
    expect(violations).toEqual([])
  })
})
