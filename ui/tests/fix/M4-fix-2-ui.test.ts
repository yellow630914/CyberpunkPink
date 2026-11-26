// 驗收測試：dev/work/M4-fix-2.md「## 介面」那一節（cpp-ui）。
// 成功率、夜課 basis／hidden／deep、simple_note 與 targeted、橋參數效果句、篩選名字表、建角特質灰掉、拍賣階段、賣價、
// 橋關著的靜修提示、戰鬥生命值模糊、示意模式預設。引擎用真的；畫面用 Vue 的伺服器端渲染轉成 HTML 檢查（沒有 DOM）。
// 自動跟價逐回合與取消在 tests/auction/M4-ui-auction.test.ts。

import { afterEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { CONTENT_TAG_INFO, bridgeParamEffect, contentTagName } from '@engine/src'
import type { ContentPack } from '@engine/src'
import AdultSceneScreen from '../../src/screens/AdultSceneScreen.vue'
import AdultTab from '../../src/dialogs/character/AdultTab.vue'
import NightClassPanel from '../../src/components/scene/NightClassPanel.vue'
import BridgePanel from '../../src/components/body/BridgePanel.vue'
import SceneActions from '../../src/components/scene/SceneActions.vue'
import PerkList from '../../src/components/creation/PerkList.vue'
import RetreatPanel from '../../src/components/body/RetreatPanel.vue'
import { useEngine } from '../../src/stores/engine'
import { FILTER_ROWS, rulesFromUi } from '../../src/lib/engineView'
import { demoDefault, demoDefaultOf } from '../../src/lib/demoDefault'
import { hiddenLine, nightEntries } from '../../src/lib/nightView'
import { chanceText } from '../../src/lib/bodyView'
import { BEA, CAT, TRIO, html, setup, text } from '../scene/fixtures'
import newGameSrc from '../../src/screens/NewGameScreen.vue?raw'
import boardSrc from '../../src/components/combat/BattleBoard.vue?raw'
import pkgSrc from '../../package.json?raw'

vi.mock('../../src/router', () => ({ FULL_PAGES: [{ path: '/', name: '主畫面' }], router: {} }))
afterEach(() => { vi.unstubAllEnvs() })

describe('夜課：basis、hidden、deep（UI 8.4）', () => {
  it('每個分支寫引擎給的現況與每一階的開階條件（開了的標起來）', async () => {
    const s = await setup({ begin: false, insight: 12 })
    const l = s.e.night.list()!
    const h = await html(s.pinia, NightClassPanel)
    for (const b of l.branches) {
      const seg = h.slice(h.indexOf(`data-branch="${b.branch}"`))
      expect(text(seg.slice(seg.indexOf('data-basis'), seg.indexOf('data-basis') + 200))).toContain(b.basis.text)
      for (const g of b.basis.tiers) expect(seg).toContain(`data-gate="${g.tier}" data-open="${g.open}"`)
    }
  })

  it('還沒開的階：下一階整階顯示；再往後沒掛標籤的寫「…」；已開的階照引擎', () => {
    const sk = (id: string, tier: number, tag: string | null) => ({ id, name: id, branch: 'common', tier, cost: 1, tag, status: 'tier_closed', reason: null, reasons: [], positions: [], deep: false }) as never
    const out = nightEntries({ tier: 1, skills: [sk('a', 1, null), sk('b', 2, null), sk('c', 3, null), sk('d', 3, null), sk('e', 3, 'tg'), sk('f', 4, null)] })
    expect(out.map((x) => (x.kind === 'skill' ? x.skill.id : `…${x.tier}x${x.count}`))).toEqual(['a', 'b', '…3x2', 'e', '…4x1'])
  })

  it('「N 個掛在你沒有的標籤上」只在有數字時寫', () => {
    expect(hiddenLine(0)).toBe('')
    expect(hiddenLine(3)).toBe('3 個掛在你沒有的標籤上')
  })
})

describe('橋參數效果句', () => {
  it('橋分頁與成人分頁都寫引擎的 bridgeParamEffect（同一句）', async () => {
    const s = await setup({ begin: false })
    const params = s.e.body.bridgeParams()!
    expect(params.length).toBeGreaterThan(0)
    for (const p of params) expect(p.effect.length).toBeGreaterThan(0)
    const a = text(await html(s.pinia, AdultTab))
    const b = text(await html(s.pinia, BridgePanel))
    for (const p of params) { expect(a).toContain(p.effect); expect(b).toContain(p.effect) }
    expect(typeof bridgeParamEffect).toBe('function')
  })
})

describe('內容篩選的名字表', () => {
  it('引擎認得的標籤，設定與建角列的名字與說明是引擎的 CONTENT_TAG_INFO；內容自己的標籤才是介面的字', () => {
    const own = new Set(['filterRestraint', 'filterPublic', 'filterContract'])
    for (const r of FILTER_ROWS) {
      if (own.has(r.k)) continue
      const tag = rulesFromUi({ [r.k]: false }).contentOff as string[]
      expect(tag).toHaveLength(1)
      const info = (CONTENT_TAG_INFO as Record<string, { name: string; note: string }>)[tag[0]!]!
      expect(r.name).toBe(info.name)
      expect(r.name).toBe(contentTagName(tag[0]!))
      expect(r.hint).toBe(info.note)
    }
    expect(FILTER_ROWS).toHaveLength(15)
  })
})

describe('場景：simple_note 與 targeted', () => {
  it('精簡版遇到多人設定：引擎給 simple_note，畫面寫出來', async () => {
    const s = await setup({ mode: 'simple', people: [BEA, CAT], setup: { with: TRIO.with, nature: 'mutual' } })
    const v = s.e.scene.view()
    expect(v?.simple_note).toBeTruthy()
    const page = text(await html(s.pinia, AdultSceneScreen, {}, '/scene?gate=0'))
    expect(page).toContain(v!.simple_note!)
  })

  it('對象一排只在多人且有 targeted 的行動時出現；行動帶 targeted 是引擎的', async () => {
    const trio = await setup({ mode: 'full', people: [BEA, CAT], setup: { ...TRIO } })
    const opts = trio.e.scene.options()!
    expect(opts.actions.some((a) => a.targeted)).toBe(true)
    expect(await html(trio.pinia, SceneActions, { opts, playing: false, theirName: '對象', selected: 'dominate' })).toContain('data-targets')
    // 沒有任何 targeted 的行動：整排不出現
    const none = { ...opts, actions: opts.actions.map((a) => ({ ...a, targeted: false })) }
    expect(await html(trio.pinia, SceneActions, { opts: none, playing: false, theirName: '對象', selected: 'dominate' })).not.toContain('data-targets')
    // 單人：沒有 targeted
    const one = await setup({ mode: 'simple', setup: { solo: true, place: '房間' } })
    expect(one.e.scene.options()!.actions.every((a) => !a.targeted)).toBe(true)
  })
})

describe('成功率', () => {
  it('報價帶 chance 就寫百分比，沒有就不寫', () => {
    expect(chanceText({ chance: 0.85 })).toBe('・成功率 85%')
    expect(chanceText({ chance: 0.333 })).toBe('・成功率 33.3%')
    expect(chanceText({ dc: 12 })).toBe('')
  })
})

describe('建角特質：被內容篩選關掉的照樣列出、灰掉、寫原因', () => {
  const PACK = {
    id: 'perk_tag_test',
    content: { perk: [{ id: 'pk_t_ntr', name: '寢取的癖好', category: 'desire', cost: 1, flaw: false, desc: '測試用。', tags: ['ntr'] }] } as unknown as ContentPack['content'],
  } as ContentPack

  function start(rules: object) {
    setActivePinia(createPinia())
    const e = useEngine()
    e.newGame({ seed: 3, testContent: [PACK] })
    e.creation.previewRules(rules)
    return e
  }
  const rowsOf = (e: ReturnType<typeof useEngine>) => e.creation.perks.filter((p) => p.category !== 'origin')

  it('篩選開著：能選；關掉 NTR：特質仍在清單、灰掉、原因是引擎的 perkFilterBlock', async () => {
    const open = start({})
    expect(rowsOf(open).some((p) => p.id === 'pk_t_ntr')).toBe(true)
    expect(open.creation.perkFilterBlock('pk_t_ntr')).toBeNull()
    expect(open.creation.perkBlock(['pk_t_ntr'])).toBeNull()

    const e = start(rulesFromUi({ filterNtr: false }))
    const rows = rowsOf(e)
    expect(rows.some((p) => p.id === 'pk_t_ntr')).toBe(true) // 沒有從清單拿掉
    const why = e.creation.perkFilterBlock('pk_t_ntr')!
    expect(why).toContain('寢取的癖好')
    expect(why).toContain('NTR')
    expect(e.creation.perkBlock(['pk_t_ntr'])).toBe(why)
    const pinia = createPinia()
    setActivePinia(pinia)
    const h = await html(pinia, PerkList, { perks: rows, picked: [], addBlock: (id: string) => e.creation.perkFilterBlock(id) ?? e.creation.perkBlock([id]), filterWhy: (id: string) => e.creation.perkFilterBlock(id) })
    const tag = new RegExp('<button[^>]*data-perk="pk_t_ntr"[^>]*>').exec(h)![0]
    expect(tag).toContain('is-unavailable')
    expect(tag).toContain('aria-disabled="true"')
    expect(text(h.slice(h.indexOf('data-perk-filter')))).toContain(why)
    // 沒被篩掉的特質照常可以選
    const plain = rows.find((p) => p.id !== 'pk_t_ntr')!
    expect(new RegExp(`<button[^>]*data-perk="${plain.id}"[^>]*>`).exec(h)![0]).not.toContain('is-unavailable')
  })
  it('NewGameScreen 用 PerkList，且擋的順序先看篩選', () => {
    expect(newGameSrc).toContain('<PerkList')
    expect(newGameSrc).toContain('perkFilterWhy(id) ??')
  })
})

describe('示意模式的預設', () => {
  it('正式遊戲預設關；VITE_DEMO_DEFAULT=on（介面示意版建置）預設開', () => {
    expect(demoDefault()).toBe(false)
    vi.stubEnv('VITE_DEMO_DEFAULT', 'on')
    expect(demoDefault()).toBe(true)
    vi.stubEnv('VITE_DEMO_DEFAULT', 'off')
    expect(demoDefault()).toBe(false)
    expect(demoDefaultOf(undefined)).toBe(false)
    expect(demoDefaultOf('')).toBe(false)
    for (const v of ['on', 'ON', '1', 'true']) expect(demoDefaultOf(v)).toBe(true)
  })
  it('開新局的示意開關從 demoDefault() 起算；build:preview 用 preview 模式、.env.preview 設成 on', () => {
    expect(newGameSrc).toContain('ref(demoDefault())')
    expect(JSON.parse(pkgSrc).scripts['build:preview']).toContain('--mode preview')
  })
})

describe('橋關著的靜修提示', () => {
  it('沒在靜修：整塊不出現；橋關著（引擎的 bridgeClosed）時是引擎的答案', async () => {
    const s = await setup({ begin: false })
    expect(s.e.body.bridgeClosed()).toBe(false)
    expect(await html(s.pinia, RetreatPanel)).not.toContain('data-bridge-closed')
  })
})

describe('戰鬥畫面的生命值照 hp_blur', () => {
  it('BattleBoard 問引擎的 painBlind，模糊時只畫分段、不寫數字', () => {
    expect(boardSrc).toContain('engine.body.painBlind(id)')
    expect(boardSrc).toContain('data-hp-blur')
    expect(boardSrc).toContain("blurHp(cellOf(p)!.unit!.id) ? '生命（模糊），'")
  })
})
