// 驗收測試：dev/work/M2-ui-scene.md（cpp-ui）。成人場景的畫面接上引擎：確認框、一對一的回合、九種行動、連接與體位、結束後的戰報；精簡版用自動接線。
// 內容用測試自帶的最小假資料（fixtures.ts）。畫面用 Vue 的伺服器端渲染轉成 HTML 來檢查；點按鈕做的事就是呼叫畫面呼叫的那幾個 store 函式。
// 所有參與者都是成年人；畫面沒有露骨的字：部位只是文字標籤。

import { afterEach, describe, expect, it, vi } from 'vitest'
import { sceneRawOf } from '@engine/src/features/scene'
import type { SceneInput } from '@engine/src/features/scene'
import AdultSceneScreen from '../../src/screens/AdultSceneScreen.vue'
import SceneDebrief from '../../src/components/scene/SceneDebrief.vue'
import RuleFields from '../../src/components/RuleFields.vue'
import { hidesIntimate, partLabels, pickMark, previewLines } from '../../src/lib/scene/sceneView'
import { rulesFromUi } from '../../src/lib/engineView'
import { attrOf, html, setup, tagOf, text, SETUP, type Setup } from './fixtures'

// 整頁的元件會 import 路由檔：伺服器端渲染用不到，只留頁面清單
vi.mock('../../src/router', () => ({ FULL_PAGES: [{ path: '/', name: '主畫面' }], router: {} }))
afterEach(() => { delete (globalThis as { localStorage?: unknown }).localStorage })

const page = (s: Setup, q = 'gate=0') => html(s.pinia, AdultSceneScreen, {}, `/scene?${q}`)
const act = async (s: Setup, input: SceneInput) => {
  const r = await s.e.scene.act(input)
  expect(r.reason).toBeUndefined()
  expect(r.status).toBe('applied')
}
/** 輪到主角時再做下一步：把對方的回合一路走完 */
const rest = (s: Setup) => s.e.scene.partnerTurn(0)
const reportsOf = (s: Setup, action: string) => s.e.state.reports.filter((r) => r.action === action)

describe('1 確認框', () => {
  it('開場景的時候先出確認框：和誰、性質、目的、略過時怎麼算；兩個按鈕', async () => {
    const s = await setup({ setup: { ...SETUP, goal: 'please', place: '測試的房間' } })
    const h = await page(s, '')
    expect(h).toContain('data-gate')
    expect(text(tagOf(h, 'data-gate-who') + h.slice(h.indexOf('data-gate-who')))).toContain('安')
    const gate = h.slice(h.indexOf('data-gate'), h.indexOf('data-enter') + 40)
    for (const w of ['和誰', '性質', '目的', '略過時', '兩情相悅', '取悅', '測試的房間']) expect(text(gate)).toContain(w)
    expect(h).toContain('data-skip')
    expect(h).toContain('data-enter')
  })
  it('gate=0 或已經做過一步就不出確認框', async () => {
    const s = await setup()
    expect(await page(s, 'gate=0')).not.toContain('data-gate')
    await act(s, { kind: 'talk' })
    expect(await page(s, '')).not.toContain('data-gate')
  })
  it('選略過：不進畫面，紀錄多一份結果；場景結束、戰報卡出來', async () => {
    const s = await setup()
    const before = s.e.state.reports.length
    expect((await s.e.scene.skip()).status).toBe('applied')
    expect(s.e.scene.active()).toBe(false)
    const ends = reportsOf(s, 'scene.end')
    expect(ends).toHaveLength(1)
    expect(s.e.state.reports.length).toBeGreaterThan(before)
    // 紀錄裡看得到這一份
    expect(s.e.log.some((l) => l.prose.join('').includes('略過'))).toBe(true)
    const h = await page(s)
    expect(h).toContain('data-report')
    expect(h).not.toContain('data-scene>')
  })
})

describe('2 行動：灰掉的寫引擎的原因', () => {
  it('沒有連接時主導、迎合、挑逗是灰的，title 是引擎的原因；說話之後亮起來', async () => {
    const s = await setup()
    const o = s.e.scene.options()!
    for (const id of ['dominate', 'yield', 'tease']) {
      const a = o.actions.find((x) => x.id === id)!
      expect(a.blocks.join('')).toContain('還沒有連接')
    }
    let h = await page(s)
    for (const id of ['dominate', 'yield', 'tease']) {
      const t = tagOf(h, `data-act="${id}"`)
      expect(t).toContain('is-unavailable')
      expect(attrOf(t, 'title')).toContain('還沒有連接')
    }
    expect(tagOf(h, 'data-act="restrain"')).not.toContain('is-unavailable')
    await act(s, { kind: 'talk' })
    h = await page(s)
    // 說話之後輪到對方：先走完對方的回合再看
    await rest(s)
    h = await page(s)
    for (const id of ['dominate', 'yield', 'tease']) expect(tagOf(h, `data-act="${id}"`)).not.toContain('is-unavailable')
    expect(sceneRawOf(s.e.state)!.links.length).toBeGreaterThan(0)
  })
  it('九種行動都列出來，花費是引擎的；行動點在畫面上', async () => {
    const s = await setup()
    const o = s.e.scene.options()!
    expect(o.actions.map((a) => a.id)).toEqual(['dominate', 'yield', 'tease', 'restrain', 'skill', 'talk', 'item', 'switch', 'gear', 'stop'])
    const h = await page(s)
    // 換檔不在行動列，只在上方的同步按鈕
    for (const a of o.actions.filter((x) => x.id !== 'gear')) expect(h).toContain(`data-act="${a.id}"`)
    expect(h).not.toContain('data-act="gear"')
    const sync = h.slice(h.indexOf('data-sync'), h.indexOf('</div>', h.indexOf('data-sync')))
    for (const g of ['shallow', 'standard', 'deep', 'full']) expect(sync).toContain(`data-gear="${g}"`)
    expect(attrOf(tagOf(h, 'data-ap'), 'aria-label')).toBe(`行動點 ${o.ap.now}／${o.ap.max}`)
  })
})

describe('3 做一步之後：畫面的數字是引擎的', () => {
  it('兩邊的感載、契合、主動權和引擎的狀態一樣；對方的一步接著做', async () => {
    const s = await setup()
    await act(s, { kind: 'talk' })
    // 做完一步之後輪到對方（行動點用完之前還是自己的回合：說話只花 1 點，主角還有行動點）
    await act(s, { kind: 'restrain' })
    await rest(s)
    const st = sceneRawOf(s.e.state)
    if (st) {
      const v = s.e.scene.view()!
      expect(v.fit).toBe(st.pairs.npc_ann!.fit)
      expect(v.init).toBe(st.pairs.npc_ann!.init)
      expect(v.seats[0]!.load.now).toBe(s.e.state.actors.pc!.load)
      expect(v.seats[1]!.load.now).toBe(s.e.state.actors.npc_ann!.load)
      const h = await page(s)
      expect(/data-fit[^>]*>(\d+)</.exec(h)![1]).toBe(String(st.pairs.npc_ann!.fit))
      expect(/data-init[^>]*>(\d+)</.exec(h)![1]).toBe(String(st.pairs.npc_ann!.init))
    }
  })
  it('預覽的數字是引擎回的：畫面上的字就是 previewLines(引擎的 preview)', async () => {
    const s = await setup()
    await act(s, { kind: 'talk' })
    await rest(s)
    const o = s.e.scene.options()!
    const a = o.actions.find((x) => x.id === 'dominate')!
    expect(a.preview).not.toBeNull()
    const lines = previewLines(a.preview, '安')
    expect(lines.length).toBeGreaterThan(0)
    const h = await page(s)
    const pv = text(h.slice(h.indexOf('data-preview')))
    for (const l of lines) expect(pv).toContain(l)
  })
  it('結束回合：回合交給對方，partnerTurn 一路走到交回主角', async () => {
    const s = await setup()
    await act(s, { kind: 'end_turn' })
    expect(sceneRawOf(s.e.state)!.turn).toBe('npc_ann')
    await rest(s)
    const st = sceneRawOf(s.e.state)
    expect(st === null || st.turn === 'pc').toBe(true)
    expect(reportsOf(s, 'scene.next').length).toBeGreaterThan(0)
  })
})

describe('4 選部位（完整版）：只有引擎列的組合點得下去', () => {
  it('技能宣告了要選部位；pickMark 的點得下去與原因照引擎的 picks 與 pairs', async () => {
    const s = await setup({ mode: 'full' })
    const o = s.e.scene.options()!
    const skill = o.actions.find((a) => a.id === 'skill')!
    const hold = skill.choices!.find((c) => c.id === 'nt_hold')!
    expect(hold.picks.every((p) => p.required)).toBe(true)
    // 手（選項）→ 對方的胸、後
    const mine = hold.picks.find((p) => p.key === 'my_part')!.options.map((x) => x.value)
    expect(mine).toEqual(['hand_l', 'hand_r'])
    expect(pickMark(hold.picks, hold.pairs, null, 'pc', 'mouth')).toMatchObject({ pick: 'no' })
    expect(pickMark(hold.picks, hold.pairs, null, 'pc', 'hand_l')).toEqual({ pick: 'can' })
    expect(pickMark(hold.picks, hold.pairs, null, 'partner', 'chest')).toMatchObject({ pick: 'no', reason: '先點你自己的部位。' })
    expect(pickMark(hold.picks, hold.pairs, 'hand_l', 'pc', 'hand_l')).toEqual({ pick: 'picked' })
    // 每一個「可以點」的組合，真的做得下去；每一個「不能點」的組合，引擎也不收
    const outcomes: string[] = []
    for (const p of hold.pairs) {
      const mark = pickMark(hold.picks, hold.pairs, p.my_part, 'partner', p.their_part)
      outcomes.push(`${p.my_part}→${p.their_part}:${mark.pick}`)
      expect(mark.pick === 'can').toBe(p.blocks.length === 0)
    }
    expect(outcomes.some((x) => x.endsWith(':can'))).toBe(true)
    const bad = hold.pairs.find((p) => p.blocks.length > 0)
    if (bad) {
      const r = await s.e.scene.act({ kind: 'skill', id: 'nt_hold', pick: { my_part: bad.my_part, their_part: bad.their_part } })
      expect(r.status).toBe('refused')
      expect(r.reason).toContain(bad.blocks[0]!.slice(0, 6))
    }
    const good = hold.pairs.find((p) => p.blocks.length === 0)!
    await act(s, { kind: 'skill', id: 'nt_hold', pick: { my_part: good.my_part, their_part: good.their_part } })
    const links = sceneRawOf(s.e.state)!.links
    expect(links.map((l) => `${l.mine}→${l.theirs}`)).toContain(`${good.my_part}→${good.their_part}`)
  })
  it('完整版畫面有部位一排與連接的清單；精簡版沒有，只有持續效果的條數', async () => {
    const full = await setup({ mode: 'full' })
    await act(full, { kind: 'talk', pick: { my_part: 'mouth', their_part: 'mouth' } })
    await rest(full)
    let h = await page(full)
    expect(h).toContain('data-parts')
    expect(h).toContain('data-part="pc:mouth"')
    expect(h).toMatch(/data-link[\s>]/)
    expect(h).not.toContain('data-effects')
    const simple = await setup({ mode: 'simple' })
    await act(simple, { kind: 'talk' })
    await rest(simple)
    h = await page(simple)
    expect(h).not.toContain('data-parts')
    expect(h).not.toMatch(/data-link[\s>]/)
    expect(text(h.slice(h.indexOf('data-effects')))).toMatch(/持續效果：\d+ 條/)
  })
  it('連著的部位是 link、碰得到的是 reach、碰不到的是 off（照引擎的 sceneView）', async () => {
    const s = await setup({ mode: 'full' })
    await act(s, { kind: 'talk', pick: { my_part: 'mouth', their_part: 'mouth' } })
    await rest(s)
    const v = s.e.scene.view()!
    const h = await page(s)
    for (const w of ['pc', 'partner'] as const) {
      for (const p of v.seats[w === 'pc' ? 0 : 1]!.parts) {
        const cls = attrOf(tagOf(h, `data-part="${w}:${p.id}"`), 'class') ?? ''
        expect(cls.split(/\s+/)).toContain(p.linked ? 'link' : p.reach ? 'reach' : 'off')
      }
    }
  })
})

describe('5 體位卡', () => {
  it('主動權不在手上時體位卡不能點，title 是引擎的原因', async () => {
    const s = await setup({ pcDocility: 90 })
    expect(s.e.scene.view()!.holder).toBe('partner')
    const why = s.e.scene.options()!.actions.find((a) => a.id === 'switch')!.blocks
    expect(why.join('')).toContain('主動權')
    const t = tagOf(await page(s), 'data-position')
    expect(t).toContain('is-unavailable')
    expect(attrOf(t, 'title')).toBe(why.join(''))
  })
  it('主動權在手上時換得到；已經是這個體位、不會的體位各有引擎的原因', async () => {
    const s = await setup()
    const v = s.e.scene.view()!
    expect(v.holder).toBe('pc')
    const t = tagOf(await page(s), 'data-position')
    expect(t).not.toContain('is-unavailable')
    const cur = v.positions.find((p) => p.id === v.position.id)!
    expect(cur.blocks.join('')).toContain('已經是這個體位')
    const other = v.positions.find((p) => p.id !== v.position.id && p.blocks.length === 0)!
    await act(s, { kind: 'switch', position: other.id })
    expect(sceneRawOf(s.e.state)!.position).toBe(other.id)
  })
})

describe('6 停下之後：戰報卡', () => {
  it('停下之後有戰報卡，評價與體悟和引擎的結算一樣；場景中別的畫面的入口被擋，結束之後不擋', async () => {
    const s = await setup()
    // 場景進行中：別的報告被引擎擋下
    expect(s.e.blockOf('commit:world.arrive')).toBeTruthy()
    expect(s.e.blockOf('commit:transit.board')).toBeTruthy()
    await act(s, { kind: 'talk' })
    await rest(s)
    if (sceneRawOf(s.e.state)) await act(s, { kind: 'stop' })
    expect(s.e.scene.active()).toBe(false)
    const end = reportsOf(s, 'scene.end').at(-1)!
    const d = s.e.scene.debrief()!
    expect(d.results).toEqual(end.narration!.results)
    const beat = end.timeline.find((b) => b.tag === 'scene.end')!
    expect(d.fit).toBe((beat.data as { fit: number }).fit)
    expect(d.insight).toBe((beat.data as { insight: number }).insight)
    expect(d.results.join('')).toContain(`契合 ${d.fit}：${d.rating}`)
    expect(d.results.join('')).toContain(`體悟 +${d.insight}`)
    // 畫面
    const h = await page(s)
    expect(h).toContain('data-report')
    expect(text(h.slice(h.indexOf('data-report-fit')))).toContain(`${d.fit}・${d.rating}`)
    expect(text(h.slice(h.indexOf('data-report-insight')))).toContain(`+${d.insight}`)
    for (const r of d.results) expect(text(h)).toContain(r)
    // 結束之後不擋
    expect(s.e.blockOf('commit:world.arrive')).toBeNull()
    // 回去：戰報清掉
    s.e.scene.clearEnded()
    expect(s.e.scene.debrief()).toBeNull()
  })
  it('AI 開著時戰報有整場的正文，預設展開；折疊成人內容打開時收起來', async () => {
    const s = await setup()
    await s.e.scene.skip()
    const d = s.e.scene.debrief()!
    const withText = { ...d, text: ['第一段。', '第二段。'] }
    const open = await html(s.pinia, SceneDebrief, { debrief: withText, fold: false, leaveText: '回去' })
    expect(open).toMatch(/<details[^>]*open/)
    expect(open).toContain('第二段。')
    const folded = await html(s.pinia, SceneDebrief, { debrief: withText, fold: true, leaveText: '回去' })
    expect(folded).not.toMatch(/<details[^>]*open/)
    const none = await html(s.pinia, SceneDebrief, { debrief: { ...d, text: [] }, fold: false, leaveText: '回去' })
    expect(none).not.toContain('<details')
  })
})

describe('7 內容篩選與同步檔位', () => {
  it('「身體的私密描寫」關掉時，那幾個部位的標籤收起來（換成編號），其餘照舊', async () => {
    const s = await setup({ mode: 'full', rules: rulesFromUi({ filterIntimateBody: false }) })
    expect(s.e.scene.contentOff()).toEqual(['intimate_body'])
    const h = await page(s)
    const parts = h.slice(h.indexOf('data-parts'), h.indexOf('data-parts') + 3000)
    expect(text(parts)).not.toMatch(/[胸前後]/)
    expect(text(parts)).toContain('部位①')
    expect(text(parts)).toContain('口')
    // 開著時照舊
    const on = await setup({ mode: 'full' })
    expect(text((await page(on)).slice(0, 99999))).toMatch(/胸/)
  })
  it('partLabels：只收起私密的部位，編號固定', () => {
    const names = { mouth: '口', chest: '胸', front: '前', hand_l: '左手' }
    expect(hidesIntimate(['intimate_body'])).toBe(true)
    expect(hidesIntimate([])).toBe(false)
    expect(partLabels(['mouth', 'chest', 'front', 'hand_l'], names, true)).toEqual({ mouth: '口', chest: '部位①', front: '部位②', hand_l: '左手' })
    expect(partLabels(['mouth', 'chest'], names, false)).toEqual({ mouth: '口', chest: '胸' })
  })
  it('同步檔位照引擎：四檔、現在的亮起、開不了的寫引擎的原因；換檔後畫面與引擎一致；直播關', async () => {
    const s = await setup()
    const v0 = s.e.scene.view()!
    const gv = v0.seats[0]!.gear
    let h = await page(s)
    const sync = (x: string): string => x.slice(x.indexOf('data-sync'), x.indexOf('</div>', x.indexOf('data-sync')))
    expect(sync(h)).not.toContain('還沒有開放。')
    expect(text(sync(h))).toContain(gv.name)
    expect(attrOf(tagOf(h, `data-gear="${gv.now}"`), 'class')).toContain('on')
    for (const g of gv.gears) {
      const t = tagOf(h, `data-gear="${g.id}"`)
      if (g.blocks.length && !g.current) {
        expect(t).toContain('is-unavailable')
        expect(attrOf(t, 'title')).toContain(g.blocks[0]!)
      }
    }
    expect(text(h)).not.toContain('還沒有開放。同步')
    expect(text(h)).toContain('直播：關')
    // 換到一個開得了的檔：畫面的檔位與引擎一致，這回合不能再換
    const to = gv.gears.find((g) => !g.current && g.blocks.length === 0)
    expect(to, '要有一個開得了的檔可以換').toBeTruthy()
    const r = await s.e.scene.act({ kind: 'gear', gear: to!.id })
    expect(r.status).toBe('applied')
    const v1 = s.e.scene.view()!
    expect(v1.seats[0]!.gear.now).toBe(to!.id)
    expect(v1.seats[0]!.gear.shifted).toBe(true)
    h = await page(s)
    expect(attrOf(tagOf(h, `data-gear="${to!.id}"`), 'class')).toContain('on')
    const other = v1.seats[0]!.gear.gears.find((g) => !g.current)!
    const why = s.e.scene.options()!.actions.find((a) => a.id === 'gear')!.choices!.find((c) => c.id === other.id)!.blocks
    expect(why.length).toBeGreaterThan(0)
    expect(tagOf(h, `data-gear="${other.id}"`)).toContain('is-unavailable')
    expect(attrOf(tagOf(h, `data-gear="${other.id}"`), 'title')).toContain(why[0]!)
    expect(text(h)).toContain(v0.seats[1]!.gear.name)
  })
})

describe('8 設定與兩種模式', () => {
  it('設定的「成人場景的操作」開關在遊戲設定裡；預設精簡', async () => {
    const s = await setup({ begin: false })
    const h = await html(s.pinia, RuleFields, { })
    expect(h).toContain('data-scene-mode')
    expect(text(tagOf(h, 'data-scene-mode-set="simple"') + h.slice(h.indexOf('data-scene-mode-set="simple"')))).toContain('精簡')
    expect(h).toContain('data-scene-mode-set="full"')
  })
  it('下一場生效：改了模式，下一場開起來就是那個模式', async () => {
    const s = await setup({ mode: 'simple', begin: false })
    expect(await s.e.scene.begin(SETUP)).toBeNull()
    expect(s.e.scene.view()!.mode).toBe('simple')
    await s.e.scene.skip()
    s.e.scene.clearEnded()
    s.e.scene.setMode('full')
    expect(await s.e.scene.begin(SETUP)).toBeNull()
    expect(s.e.scene.view()!.mode).toBe('full')
  })
  it('同一個種子、同樣的行動序列：完整版手動選到和精簡版自動接的一樣，結果相同', async () => {
    const a = await setup({ mode: 'simple', seed: 11 })
    await act(a, { kind: 'skill', id: 'nt_hold' })
    const auto = sceneRawOf(a.e.state)!.links[0]!
    const b = await setup({ mode: 'full', seed: 11 })
    await act(b, { kind: 'skill', id: 'nt_hold', pick: { my_part: auto.mine, their_part: auto.theirs } })
    const sa = sceneRawOf(a.e.state)!
    const sb = sceneRawOf(b.e.state)!
    expect([sb.pairs.npc_ann, sb.seats.map((x) => x.ap), sb.links.map((l) => [l.mine, l.theirs])]).toEqual([sa.pairs.npc_ann, sa.seats.map((x) => x.ap), sa.links.map((l) => [l.mine, l.theirs])])
    expect(b.e.state.actors.npc_ann!.load).toBe(a.e.state.actors.npc_ann!.load)
    expect(b.e.state.actors.pc!.load).toBe(a.e.state.actors.pc!.load)
  })
})

describe('9 畫面裡沒有骰子與算式', () => {
  const sources = import.meta.glob(['../../src/screens/AdultSceneScreen.vue', '../../src/lib/scene/sceneView.ts', '../../src/components/scene/*.vue'], { query: '?raw', import: 'default', eager: true }) as Record<string, string>
  const code = (src: string) => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/<!--[\s\S]*?-->/g, '').replace(/^\s*\/\/.*$/gm, '').replace(/<style[\s\S]*?<\/style>/g, '')
  it('找得到要掃的檔', () => {
    expect(Object.keys(sources).length).toBeGreaterThanOrEqual(6)
  })
  for (const [name, src] of Object.entries(sources)) {
    it(`${name.split('/').pop()}：不擲骰、不算感載與契合與主動權`, () => {
      const c = code(src)
      expect(c).not.toMatch(/Math\.|\brng\b|deriveRng|\brollDie\b|\brollDice\b|\bdice\.int\b|Math\.random/)
      expect(c).not.toMatch(/\b\d+d\d+\b/)
      expect(c).not.toMatch(/\.(load|fit|init|ap)\b[^=\n]*[-+*/]\s*\d|\b(fit|init|load)\s*[-+*/]=/)
      expect(c).not.toMatch(/blocks\s*=\s*\[|\bhasTendencyTag\b|\bsceneRules\b|\bopeningInit\b/)
    })
  }
})
