// 驗收測試：dev/work/M4-ui-scene.md（cpp-ui）。成人場景的畫面接上第二版的引擎：多人（一圈三四個人、別的圈一行字、換圈與叫人）、單人、內海皮、
// 開場確認框用引擎給的摘要、夜課的學習、結算頁每個對象一列、設定（場景的 AI、內容篩選）、寫法指令（略過、戰鬥結束、戰敗事件）。
// 用引擎真的功能；內容用 fixtures.ts 的最小假資料。畫面用 Vue 的伺服器端渲染轉成 HTML 來檢查；「點」就是呼叫畫面呼叫的那幾個 store 函式。
// 所有參與者都是成年人；畫面沒有露骨的字。

import { afterEach, describe, expect, it, vi } from 'vitest'
import { sceneRawOf, sceneSetupOf } from '@engine/src/features/scene'
import AdultSceneScreen from '../../src/screens/AdultSceneScreen.vue'
import SceneConfirm from '../../src/components/scene/SceneConfirm.vue'
import SceneActions from '../../src/components/scene/SceneActions.vue'
import SceneCircles from '../../src/components/scene/SceneCircles.vue'
import DirectionField from '../../src/components/scene/DirectionField.vue'
import NightClassPanel from '../../src/components/scene/NightClassPanel.vue'
import AvatarEditor from '../../src/components/scene/AvatarEditor.vue'
import SettingsDialog from '../../src/dialogs/SettingsDialog.vue'
import { FILTER_ROWS, FILTER_TAGS, aiSettingsFromUi, rulesFromUi, uiFromAiSettings } from '../../src/lib/engineView'
import { DIRECTION_MAX } from '@engine/src/shell/ai/sceneChains'
import { DIRECTION_LIMIT, directionCount, isGroup, isSolo, othersOf, reasonText } from '../../src/lib/scene/sceneView'
import { attrOf, html, setup, tagOf, text, BEA, CAT, SETUP, TRIO, type Setup } from './fixtures'
import type { Actor } from '@engine/src'

vi.mock('../../src/router', () => ({ FULL_PAGES: [{ path: '/', name: '主畫面' }], router: {} }))
afterEach(() => { delete (globalThis as { localStorage?: unknown }).localStorage })

const page = (s: Setup, q = 'gate=0') => html(s.pinia, AdultSceneScreen, {}, `/scene?${q}`)
const act = async (s: Setup, input: Parameters<Setup['e']['scene']['act']>[0]) => {
  const r = await s.e.scene.act(input)
  expect(r.reason).toBeUndefined()
  expect(r.status).toBe('applied')
}
const rest = (s: Setup) => s.e.scene.partnerTurn(0)
/** 三個人一圈（完整版）；別的圈一個人 */
const trio = (o: Parameters<typeof setup>[0] = {}) => setup({ mode: 'full', people: [BEA, CAT], ...o, setup: o.setup?.circles ? { nature: 'mutual', mode: 'full', ...o.setup } : { ...TRIO, ...(o.setup ?? {}) } })
const ann = 'npc_ann'

describe('1 一對一照舊（M2 的測試不改邏輯）；摘要與寫法指令', () => {
  it('確認框的摘要是引擎 startProblems 的：誰、性質、身分、目的、標籤、篩選；畫面不判斷第幾步', async () => {
    const s = await setup({ setup: { ...SETUP, goal: 'please', place: '測試的房間', tags: ['tg_dom'], role: 'guest' } })
    const sum = s.e.scene.gate()!
    expect(sum).toMatchObject({ kind: 'pair', layer: 'meat', nature: 'mutual', role: 'guest', goal: { id: 'please' }, place: '測試的房間' })
    expect(sum.with.map((x) => x.id)).toEqual([ann])
    expect(sum.tags.map((x) => x.id)).toEqual(['tg_dom'])
    // 確認框還在（引擎說還能略過）
    const h = await page(s, '')
    expect(h).toContain('data-gate')
    const gate = text(h.slice(h.indexOf('data-gate')))
    for (const w of ['安', '兩情相悅', '客人', '取悅', '測試的房間', '支配']) expect(gate).toContain(w)
    expect(h).toContain('data-gate-tags')
    // 做了一步，引擎就不讓略過：確認框不出來
    expect(s.e.scene.skipBlock()).toBeNull()
    await act(s, { kind: 'talk' })
    expect(s.e.scene.skipBlock()).toContain('只能按「停下」')
    expect(await page(s, '')).not.toContain('data-gate')
  })
  it('sceneSetupOf（引擎）還原成引擎要的設定：摘要（sceneGateSummary）和一開始照設定問的一樣', async () => {
    const s = await trio({ setup: { circles: [['pc', ann, 'npc_bea'], ['npc_cat']], nature: 'trade', role: 'guest', place: '房間', goal: 'info' } })
    const raw = sceneRawOf(s.e.state)!
    const setupBack = sceneSetupOf(raw)
    expect(setupBack).toMatchObject({ nature: 'trade', role: 'guest', goal: 'info', place: '房間', mode: 'full', layer: 'meat' })
    const sum = s.e.scene.gate()!
    expect(sum.kind).toBe('group')
    expect(sum.with.map((x) => x.id)).toEqual([ann, 'npc_bea'])
    expect(sum.circles!.flat().map((x) => x.id)).toEqual(['npc_cat'])
  })
  it('結算頁：一對一有一列（契合、評價、親密度的變化）', async () => {
    const s = await setup()
    await act(s, { kind: 'talk' })
    await rest(s)
    if (s.e.scene.active()) await act(s, { kind: 'stop' })
    const d = s.e.scene.debrief()!
    expect(d.rows).toHaveLength(1)
    expect(d.rows[0]).toMatchObject({ id: ann, name: '安' })
    expect(d.rows[0]!.affinity).not.toBeNull()
    const h = await page(s)
    expect(h).toContain('data-report-rows')
    expect(text(h.slice(h.indexOf('data-report-rows')))).toContain(`安契合 ${d.rows[0]!.fit}・${d.rows[0]!.rating}`)
  })
})

describe('2 多人：一圈三個人、別的圈一行字、換圈與叫人', () => {
  it('兩張對象卡、各自的契合與主動權（引擎的 pairs）；別的圈是一行字', async () => {
    const s = await trio({ setup: { circles: [['pc', ann, 'npc_bea'], ['npc_cat']] } })
    const v = s.e.scene.view()!
    expect(isGroup(v)).toBe(true)
    expect(othersOf(v).map((x) => x.id)).toEqual([ann, 'npc_bea'])
    const h = await page(s)
    expect(h.match(/data-actor="partner"/g)).toHaveLength(2)
    for (const id of [ann, 'npc_bea']) {
      const card = h.slice(h.indexOf(`data-pair="${id}"`), h.indexOf(`data-pair="${id}"`) + 900)
      expect(text(card)).toContain(String(v.pairs[id]!.fit))
      expect(text(card)).toContain(v.pairs[id]!.rating.name)
      expect(text(card)).toContain(String(v.pairs[id]!.init))
    }
    // 別的圈：每圈一行（誰、契合、評價）
    expect(h).toContain('data-circles')
    const c = text(h.slice(h.indexOf('data-circle="c1"'), h.indexOf('data-circle="c1"') + 400))
    expect(c).toContain('凱')
    expect(c).toContain(`契合 ${v.circles[0]!.fit}・${s.e.scene.rating(v.circles[0]!.fit)}`)
    // 行動要選對象：對象一排（自動＋每個人）
    expect(h).toContain('data-targets')
    for (const id of ['auto', ann, 'npc_bea']) expect(h).toContain(`data-target="${id}"`)
  })
  it('主角沒有主動權時「切換體位」灰掉，原因和引擎逐字相同', async () => {
    const s = await trio({ pcDocility: 95, setup: { nature: 'captive' } })
    const why = s.e.scene.options()!.actions.find((a) => a.id === 'switch')!.blocks
    expect(why.length).toBeGreaterThan(0)
    const t = tagOf(await page(s), 'data-position')
    expect(t).toContain('is-unavailable')
    expect(attrOf(t, 'title')).toBe(reasonText(why))
    // 三個人的場景：體位的上位是引擎說的（PersonView.upper），畫面不推論
    const v = s.e.scene.view()!
    expect(text(await page(s))).toContain(v.seats.filter((x) => x.upper).map((x) => (x.id === 'pc' ? '你' : x.name)).join('、') + '在上位')
  })
  it('換圈：2 點；換過之後卡片換了、原來的人變成別的圈；叫人過來有引擎的原因', async () => {
    const s = await trio({ setup: { circles: [['pc', ann, 'npc_bea'], ['npc_cat']] } })
    const o = s.e.scene.options()!
    const move = o.actions.find((a) => a.id === 'move_circle')!
    const call = o.actions.find((a) => a.id === 'call')!
    expect(move.ap).toBe(2)
    expect(move.blocks).toEqual([])
    expect(call.blocks.length).toBeGreaterThan(0) // 這一圈加上凱超過體位的人數
    let h = await page(s)
    expect(tagOf(h, 'data-act="call"')).toContain('is-unavailable')
    expect(attrOf(tagOf(h, 'data-act="call"'), 'title')).toBe(reasonText(call.blocks))
    expect(tagOf(h, 'data-act="move_circle"')).not.toContain('is-unavailable')
    await act(s, { kind: 'move_circle', circle: move.choices![0]!.id })
    const v = s.e.scene.view()!
    expect(v.seats.map((x) => x.id)).toEqual(['pc', 'npc_cat'])
    expect(v.circles[0]!.people).toEqual([ann, 'npc_bea'])
    h = await page(s)
    expect(h.match(/data-actor="partner"/g)).toHaveLength(1)
    expect(h).toContain('data-actor-id="npc_cat"')
    const at = h.indexOf(`data-circle="${v.circles[0]!.id}"`)
    expect(at).toBeGreaterThan(0)
    expect(text(h.slice(at, at + 300))).toContain('安、貝')
  })
  it('指定行動對象：作用在他身上；引擎的預覽與原因照指定的人', async () => {
    const s = await trio()
    await act(s, { kind: 'talk', target: 'npc_bea', pick: { my_part: 'hand_r', their_part: 'chest' } })
    const links = sceneRawOf(s.e.state)!.links
    expect(links.every((l) => l.to === 'npc_bea')).toBe(true)
    // 指定了對象，預覽用引擎 sceneView(selected) 的
    const sel = s.e.scene.view({ kind: 'dominate', target: 'npc_bea' })!.selected!
    expect(sel.input).toMatchObject({ kind: 'dominate', target: 'npc_bea' })
  })
  it('完整版輪到對方：一次 sceneNext 走完一整輪，partnerTurn 一路走到交回主角', async () => {
    const s = await trio()
    await act(s, { kind: 'end_turn' })
    expect(s.e.scene.turn()!.turn).not.toBe('pc')
    await rest(s)
    const t = s.e.scene.turn()
    expect(t === null || t.turn === t.pc).toBe(true)
  })
  it('精簡版遇到多人設定：只展開第一個對象，其餘收成別的圈；別的圈照引擎的 circles 列', async () => {
    const s = await setup({ mode: 'simple', people: [BEA], setup: { with: [ann, 'npc_bea'], nature: 'mutual', mode: 'simple' } })
    const v = s.e.scene.view()!
    expect(v.kind).toBe('pair')
    expect(v.seats.map((x) => x.id)).toEqual(['pc', ann])
    expect(v.circles[0]!.people).toEqual(['npc_bea'])
    const h = await page(s)
    expect(h).toContain('data-circle="')
    // 精簡版沒有換圈與叫人的行動
    expect(s.e.scene.options()!.actions.map((a) => a.id)).not.toContain('move_circle')
  })
  it('結算頁：每個對象各一列；別的圈也在', async () => {
    const s = await trio({ setup: { circles: [['pc', ann, 'npc_bea'], ['npc_cat']] } })
    await act(s, { kind: 'stop' })
    const d = s.e.scene.debrief()!
    expect(d.rows.map((r) => r.id).sort()).toEqual([ann, 'npc_bea'].sort())
    const h = await page(s)
    for (const r of d.rows) expect(text(h.slice(h.indexOf(`data-row="${r.id}"`)))).toContain(`契合 ${r.fit}・${r.rating}`)
  })
})

describe('3 單人', () => {
  const solo = (o: Parameters<typeof setup>[0] = {}) => setup({ mode: 'simple', ...o, setup: { solo: true, place: '房間', ...(o.setup ?? {}) } })
  it('沒有對象卡、有節奏；行動是引擎給的那一組（沒有主導與迎合）', async () => {
    const s = await solo()
    const v = s.e.scene.view()!
    expect(isSolo(v)).toBe(true)
    expect(othersOf(v)).toHaveLength(0)
    const o = s.e.scene.options()!
    const ids = o.actions.map((a) => a.id)
    expect(ids).toContain('faster')
    expect(ids).toContain('slower')
    for (const x of ['dominate', 'yield', 'tease', 'move_circle', 'call']) expect(ids).not.toContain(x)
    const h = await page(s)
    expect(h).not.toContain('data-actor="partner"')
    expect(h).toContain('data-pace')
    expect(h).not.toContain('data-init')
    expect(h).toContain('data-solo')
    expect(text(h)).toContain('沒有人在看')
    expect(attrOf(tagOf(h, 'data-pace'), 'data-pace')).toBe('')
    expect(text(h.slice(h.indexOf('data-pace')))).toContain(String(v.pace))
    for (const id of ['faster', 'slower']) expect(h).toContain(`data-act="${id}"`)
    expect(h).not.toContain('data-act="dominate"')
  })
  it('灰掉的技能有引擎的原因：這個要有人在看；說話沒有人在聽', async () => {
    const s = await solo({ skills: ['nt_aud'] })
    const o = s.e.scene.options()!
    const skill = o.actions.find((a) => a.id === 'skill')!
    expect(skill.blocks.join('')).toContain('有人在看')
    const t = tagOf(await page(s), 'data-act="skill"')
    expect(t).toContain('is-unavailable')
    expect(attrOf(t, 'title')).toBe(reasonText(skill.blocks))
    const talk = o.actions.find((a) => a.id === 'talk')!
    expect(talk.blocks.length).toBeGreaterThan(0)
    expect(attrOf(tagOf(await page(s), 'data-act="talk"'), 'title')).toBe(reasonText(talk.blocks))
    // solo: ok 的技能用得出來
    const ok = await solo({ skills: ['nt_solo'] })
    expect(ok.e.scene.options()!.actions.find((a) => a.id === 'skill')!.blocks).toEqual([])
    await act(ok, { kind: 'faster' })
  })
  it('有人在看（audience）的單人場景：要有觀眾的技能用得出來', async () => {
    const s = await solo({ skills: ['nt_aud'], setup: { audience: true } })
    expect(s.e.scene.view()!.audience).toBe(true)
    expect(s.e.scene.options()!.actions.find((a) => a.id === 'skill')!.blocks).toEqual([])
    expect(text(await page(s))).toContain('有人在看')
  })
  it('確認框：單人寫「獨自一人」，不列對象；略過時節奏那一列', async () => {
    const s = await solo()
    const h = await page(s, '')
    expect(h).toContain('data-gate')
    expect(text(h.slice(h.indexOf('data-gate-who')))).toContain('獨自一人')
    await s.e.scene.skip()
    const d = s.e.scene.debrief()!
    expect(d.solo).toBe(true)
    expect(d.pace).not.toBeNull()
    expect(d.rows).toHaveLength(0)
    const r = await page(s)
    expect(text(r.slice(r.indexOf('data-report-pace')))).toContain(`${d.pace}`)
    expect(r).not.toContain('data-report-rows')
  })
  it('住處獨處的入口：開一場單人；引擎擋下時回傳它的原因（已經有一場在進行）', async () => {
    const s = await setup({ begin: false })
    expect(await s.e.scene.soloAtHome()).toBeNull()
    expect(s.e.scene.view()!.kind).toBe('solo')
    expect(s.e.scene.view()!.place).toBe('住處')
    expect(await s.e.scene.soloAtHome()).toBe('已經有一場成人場景在進行，先把它結束。')
  })
})

describe('4 內海的場景', () => {
  it('layer 是 net 的場景套內海皮的記號、卡片上的部位來自化身（多一個部位之後選得到）', async () => {
    const s = await setup({ begin: false, ext: { deck: { avatar: { parts: ['extra'] } } }, setup: undefined })
    expect(await s.e.scene.begin({ ...SETUP, layer: 'net', dream: true, mode: 'full' })).toBeNull()
    const v = s.e.scene.view()!
    expect(v.layer).toBe('net')
    expect(v.seats[0]!.parts.map((p) => p.id)).toContain('extra')
    const h = await page(s)
    expect(h).toContain('data-layer="net"')
    expect(h).toContain('data-net')
    expect(h).toContain('data-part="pc:extra"')
    expect(s.e.scene.gate()).toMatchObject({ layer: 'net', dream: true })
    expect(text(h)).toContain('內海')
  })
  it('現實的場景沒有化身的部位；沒有甲板、又不是夢，開不了內海的場景（引擎的原因）', async () => {
    const s = await setup({ mode: 'full', ext: { deck: { avatar: { parts: ['extra'] } } } })
    expect(s.e.scene.view()!.layer).toBe('meat')
    expect(s.e.scene.view()!.seats[0]!.parts.map((p) => p.id)).not.toContain('extra')
    expect(await page(s)).toContain('data-layer="meat"')
    const nodeck = await setup({ begin: false })
    expect(await nodeck.e.scene.begin({ ...SETUP, layer: 'net' })).toBe('你沒有甲板，進不了內海，開不起這一場。')
    expect(nodeck.e.scene.active()).toBe(false)
  })
  it('化身編輯：部位、存幾套；不在接入點引擎擋下，原因直接顯示在按鈕上', async () => {
    const s = await setup({ begin: false })
    const why = s.e.deck.avatar.block({ parts: ['extra'] })
    expect(why).toContain('接入點')
    const h = await html(s.pinia, AvatarEditor)
    expect(h).toContain('data-avatar')
    for (const p of ['extra', 'tail', 'tentacle']) expect(h).toContain(`data-avatar-part="${p}"`)
    expect(attrOf(tagOf(h, 'data-avatar-part="extra"'), 'title')).toBe(why)
    expect(s.e.deck.avatar.set({ parts: ['extra'] })).toBe(why)
    expect(s.e.deck.avatar.savesMax).toBe(5)
  })
})

describe('5 夜課（成人分頁）', () => {
  it('五個分支各自開到幾階與原因；體悟不夠的按鈕灰掉、原因是引擎的；階沒開的也灰', async () => {
    const s = await setup({ begin: false, insight: 12 })
    const l = s.e.night.list()!
    expect(l.branches.map((b) => b.branch)).toEqual(['common', 'relation', 'sense', 'body', 'costume'])
    expect(l.insight).toBe(12)
    const byId = Object.fromEntries(l.branches.flatMap((b) => b.skills).map((x) => [x.id, x]))
    expect(byId.nt_c1!.status).toBe('learnable')
    expect(byId.nt_rich!.status).toBe('unmet')
    expect(byId.nt_c3!.status).toBe('tier_closed')
    const h = await html(s.pinia, NightClassPanel)
    for (const b of ['common', 'relation', 'sense', 'body', 'costume']) expect(h).toContain(`data-branch="${b}"`)
    expect(text(h.slice(h.indexOf('data-insight')))).toContain('12')
    // 按鈕
    const rich = tagOf(h, 'data-learn="nt_rich"')
    expect(rich).toContain('aria-disabled="true"')
    expect(attrOf(rich, 'title')).toBe(s.e.night.learnBlock('nt_rich'))
    expect(attrOf(rich, 'title')).toContain('體悟')
    // UI 8.4：還沒開的階，下一階之後只顯示掛在你有的標籤上的技能；沒掛標籤的 3 階（現在開到 1 階）寫「…」，不列名字與按鈕（引擎的答案照樣是 tier_closed）
    expect(h).not.toContain('data-learn="nt_c3"')
    expect(h).toContain('data-masked="3"')
    expect(byId.nt_c3!.reason).toContain('3 階還沒開')
    expect(tagOf(h, 'data-learn="nt_c1"')).not.toContain('aria-disabled')
    // 狀態字
    expect(attrOf(tagOf(h, 'data-skill="nt_c1"'), 'data-status')).toBe('learnable')
    // 共鳴：開了的生效、沒開的寫還沒開
    expect(h).toContain('data-resonance="res_c1"')
    expect(attrOf(tagOf(h, 'data-resonance="res_c1"'), 'class')).toContain('on')
    expect(attrOf(tagOf(h, 'data-resonance="res_c4"'), 'class') ?? '').not.toContain('on')
  })
  it('學了之後 actor.ext.scene.skills 多一筆、體悟少了、場景裡用得出來', async () => {
    const s = await setup({ begin: false, insight: 30 })
    const pc = s.e.state.pc!
    expect((s.e.state.actors[pc]!.ext.scene as { skills: string[] }).skills).not.toContain('nt_c1')
    expect(s.e.night.learn('nt_c1')).toBeNull()
    expect((s.e.state.actors[pc]!.ext.scene as { skills: string[] }).skills).toContain('nt_c1')
    expect(s.e.night.list()!.insight).toBe(20)
    expect(s.e.night.list()!.branches[0]!.skills.find((x) => x.id === 'nt_c1')!.status).toBe('learned')
    // 再學一次：引擎說已經會了
    expect(s.e.night.learn('nt_c1')).toBe('已經學會了。')
    expect(await s.e.scene.begin(SETUP)).toBeNull()
    expect(s.e.scene.options()!.actions.find((a) => a.id === 'skill')!.choices!.map((c) => c.id)).toContain('nt_c1')
    // 場景進行中學不了：引擎的原因
    expect(s.e.night.learnBlock('nt_rich')).toBeTruthy()
  })
  it('被內容篩選關掉的技能不出現（NTR 這類額外跟著的篩選）', async () => {
    const s = await setup({ begin: false, insight: 30, rules: rulesFromUi({ filterRestraint: false }) })
    // 示意技能裡沒有 restraint 的；用引擎的 hiddenReason：標籤被關掉的整個不列
    expect(s.e.scene.contentOff()).toEqual(['restraint'])
    const ids = s.e.night.list()!.branches.flatMap((b) => b.skills.map((x) => x.id))
    expect(ids).toContain('nt_c1')
  })
})

describe('6 設定', () => {
  it('場景的 AI 三個選項、預設 closing；設定轉成引擎的 sceneAi；內容篩選補齊每一項直接對到 contentOff', async () => {
    const s = await setup({ begin: false })
    expect(aiSettingsFromUi({ sceneAi: 'full' })).toEqual({ sceneAi: 'full' })
    expect(aiSettingsFromUi({ sceneAi: 'closing' })).toEqual({ sceneAi: 'closing' })
    expect(aiSettingsFromUi({ sceneAi: '壞' })).toEqual({})
    expect(uiFromAiSettings({ sceneAi: 'off' })).toEqual({ sceneAi: 'off' })
    expect(s.e.scene.route()).toBe('closing')
    s.e.setAi({ sceneAi: 'full' })
    expect(s.e.scene.route()).toBe('full')
    s.e.setAi({ sceneAi: 'off' })
    expect(s.e.scene.route()).toBe('text')
    s.e.setAi({ useAi: false })
    expect(s.e.scene.route()).toBe('pure')
    // 每個篩選項對到引擎的標籤
    const flags = Object.fromEntries(FILTER_ROWS.map((r) => [r.k, false]))
    const off = rulesFromUi(flags).contentOff as string[]
    for (const tags of Object.values(FILTER_TAGS)) for (const t of tags) expect(off).toContain(t)
    for (const t of ['pc_unwilling', 'target_unwilling', 'contract_dom', 'ntr', 'puppet_amnesia', 'blacktape', 'male_partner', 'female_partner', 'femboy_partner', 'trans_partner', 'futa_partner']) expect(off).toContain(t)
    expect(rulesFromUi({ filterNtr: false }).contentOff).toEqual(['ntr'])
    expect(rulesFromUi({})).toEqual({})
  })
  it('設定對話框的「AI 開關」有場景的 AI、「內容篩選」補齊每一項', async () => {
    const s = await setup({ begin: false })
    const ai = await html(s.pinia, SettingsDialog, { entryId: 1, tab: 'ai' })
    expect(ai).toContain('data-scene-ai')
    for (const m of ['off', 'closing', 'full']) expect(ai).toContain(`data-scene-ai-opt="${m}"`)
    const f = await html(s.pinia, SettingsDialog, { entryId: 1, tab: 'filter' })
    for (const r of FILTER_ROWS) expect(text(f)).toContain(r.name)
    for (const w of ['TS 對象', 'NTR', '契約支配', '對象非自願', '人偶晶片的失憶', '黑帶']) expect(text(f)).toContain(w)
  })
  it('關掉「TS 對象」之後對象是那一類的場景開不了，原因是引擎的', async () => {
    const ts = { ...CAT, id: 'npc_ts', name: '椿', gender: 'trans_f' } as Actor
    const s = await setup({ begin: false, people: [ts], rules: rulesFromUi({ filterTrans: false }) })
    expect(s.e.scene.contentOff()).toEqual(['trans_partner'])
    const why = await s.e.scene.begin({ with: ['npc_ts'], nature: 'mutual' })
    expect(why).toBe('「TS 對象」被你的內容篩選關掉了，對象是這個性別的場景開不起來。')
    expect(s.e.scene.active()).toBe(false)
    // 開著時開得起來
    const on = await setup({ begin: false, people: [ts] })
    expect(await on.e.scene.begin({ with: ['npc_ts'], nature: 'mutual' })).toBeNull()
  })
  it('NTR、契約支配、對象非自願關掉：對應的場景開不起來（引擎的原因）', async () => {
    const s = await setup({ begin: false, rules: rulesFromUi({ filterNtr: false, filterContractDom: false, filterTargetUnwilling: false, filterPcUnwilling: false }) })
    expect(await s.e.scene.begin({ ...SETUP, tags: ['ntr'] })).toContain('NTR')
    expect(await s.e.scene.begin({ ...SETUP, nature: 'contract' })).toContain('契約支配')
    expect(await s.e.scene.begin({ ...SETUP, nature: 'captive' })).toContain('對象非自願')
    expect(await s.e.scene.begin({ ...SETUP, nature: 'forced' })).toContain('主角非自願')
  })
})

describe('7 想怎麼發生（選填）：原樣送出', () => {
  it('字數即時、最多 200 字；AI 關著灰掉並說明；字原樣留在格子裡', async () => {
    expect(DIRECTION_LIMIT).toBe(DIRECTION_MAX)
    expect(directionCount('a'.repeat(250))).toEqual({ used: 250, left: -50 })
    expect(directionCount('你好嗎')).toEqual({ used: 3, left: 197 })
    const s = await setup({ begin: false })
    const live = await html(s.pinia, DirectionField, { modelValue: '想要慢一點', live: true })
    expect(live).toContain('data-direction-input')
    // 不在瀏覽器擋（沒有 maxlength）；超過時字數標紅、照樣送出，由引擎截斷並提醒
    expect(live).not.toContain('maxlength')
    expect(text(live)).toContain(`5／${DIRECTION_MAX}`)
    expect(live).not.toContain('data-direction-over')
    const over = await html(s.pinia, DirectionField, { modelValue: 'x'.repeat(DIRECTION_MAX + 5), live: true })
    expect(over).toContain('data-direction-over')
    expect(over).toContain('x'.repeat(DIRECTION_MAX + 5))
    expect(live).not.toContain('is-unavailable')
    expect(live).not.toContain('disabled')
    const off = await html(s.pinia, DirectionField, { modelValue: '想要慢一點', live: false })
    expect(off).toContain('is-unavailable')
    expect(off).toContain('disabled')
    expect(text(off)).toContain('AI 關著，這一格不會用到。')
    expect(off).toContain('想要慢一點')
  })
  it('開場確認框：略過旁邊有這一格；按略過時文字原樣交給引擎（AI 關著時回「AI 關著，指令不會用到。」；超過 200 字回截斷的提醒）', async () => {
    const s = await setup()
    s.e.setAi({ useAi: false })
    const h = await html(s.pinia, SceneConfirm, { view: s.e.scene.view()!, summary: s.e.scene.gate(), title: 't', busy: false, aiLive: false })
    expect(h).toContain('data-direction')
    expect(text(h)).toContain('想怎麼發生（選填）')
    expect(h.indexOf('data-direction')).toBeLessThan(h.indexOf('data-skip'))
    expect(text(h)).toContain('AI 關著，這一格不會用到。')
    const r = await s.e.scene.skip('x'.repeat(250))
    expect(r.status).toBe('applied')
    expect(r.notices).toEqual(['指令最多 200 字，超過的部分沒有送出。', 'AI 關著，指令不會用到。'])
    expect(s.e.scene.active()).toBe(false)
  })
  it('AI 開著時略過把指令交給引擎（假的服務商），不丟錯、結果照樣出來；沒有提醒', async () => {
    const s = await setup()
    const r = await s.e.scene.skip('慢慢來，不要太快')
    expect(r.status).toBe('applied')
    expect(r.notices ?? []).toEqual([])
    expect(s.e.scene.debrief()).not.toBeNull()
  })
  // 戰鬥結束與戰敗事件的寫法指令是行為測試：tests/after/M2-ui-battle-after.test.ts 的「寫法指令」（假的服務商記下請求、逐字相同）
})

describe('8 原始碼：畫面不自己判斷、用的是引擎的三個入口', () => {
  const sources = import.meta.glob(['../../src/screens/AdultSceneScreen.vue', '../../src/components/scene/*.vue', '../../src/lib/scene/sceneView.ts'], { query: '?raw', import: 'default', eager: true }) as Record<string, string>
  const code = (src: string) => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/<!--[\s\S]*?-->/g, '').replace(/^\s*\/\/.*$/gm, '').replace(/<style[\s\S]*?<\/style>/g, '')
  const screen = code(Object.entries(sources).find(([k]) => k.endsWith('AdultSceneScreen.vue'))![1])
  it('AdultSceneScreen.vue 沒有 step === 0、round === 1 這類自己判斷確認框的寫法', () => {
    expect(screen).not.toMatch(/\bstep\s*===?\s*\d|\bround\s*===?\s*\d|\.step\b/)
    expect(screen).not.toMatch(/\bturn\s*===?\s*'(pc|partner)'|'partner'\s*===/)
  })
  it('store 用 Game.sceneBegin、sceneStep、sceneFinish；不再自己呼叫功能的 sceneAct、sceneNext、sceneSkip 提交', () => {
    const engine = Object.entries(import.meta.glob('../../src/stores/engine.ts', { query: '?raw', import: 'default', eager: true }) as Record<string, string>)[0]![1]
    expect(engine).toContain('game.sceneStep(')
    expect(engine).toContain('game.sceneFinish(')
    expect(engine).toContain('game.sceneBegin(')
    expect(engine).not.toMatch(/commitMade\(\(\) => sceneSkip|sceneAct\(game|sceneNext\(game/)
  })
  it('畫面裡沒有 pc／partner 的舊外觀（sceneOf）', () => {
    for (const [name, src] of Object.entries(sources)) expect(code(src), name).not.toMatch(/\bsceneOf\b|features\/scene\/legacy/)
  })
  it('SceneView 的對象是選填：單人沒有 partner，畫面讀 seats、pairs、circles', () => {
    expect(screen).toContain('othersOf')
    expect(screen).not.toMatch(/people\.partner/)
  })
})

describe('9 單元：SceneActions、SceneCircles 的元件', () => {
  it('SceneActions：對象一排只在一圈有兩個人以上時出現；換圈與叫人是行動', async () => {
    const s = await trio({ setup: { circles: [['pc', ann, 'npc_bea'], ['npc_cat']] } })
    const h = await html(s.pinia, SceneActions, { opts: s.e.scene.options()!, playing: false, theirName: '對象', selected: 'dominate' })
    expect(h).toContain('data-targets')
    expect(h).toContain('data-act="move_circle"')
    const one = await setup()
    const h1 = await html(one.pinia, SceneActions, { opts: one.e.scene.options()!, playing: false, theirName: '安', selected: 'dominate' })
    expect(h1).not.toContain('data-targets')
    expect(h1).not.toContain('data-act="move_circle"')
  })
  it('SceneCircles：沒有別的圈也沒有說明就什麼都不畫', async () => {
    const s = await setup()
    const h = await html(s.pinia, SceneCircles, { circles: [], nameOf: (x: string) => x, ratingOf: () => '', note: null })
    expect(h).not.toContain('data-circles')
  })
})
