// 驗收測試：dev/work/M4-fix-ui.md（cpp-ui，M4 收尾修正批・介面）。
// 審查必修 1（角色對話框的體悟、橋參數讀引擎）、應修 10（寫法指令原樣送出）、建角的目錄與外觀讀引擎、示意模式。
// 用引擎真的功能；內容用 scene 的 fixtures。畫面用 Vue 的伺服器端渲染轉成 HTML 檢查；沒有 DOM，「點」是呼叫畫面呼叫的 store 入口。

import { afterEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { FakeProvider } from '@engine/src'
import { DIRECTION_MAX } from '@engine/src/shell/ai/sceneChains'
import AdultTab from '../../src/dialogs/character/AdultTab.vue'
import NightClassPanel from '../../src/components/scene/NightClassPanel.vue'
import BridgePanel from '../../src/components/body/BridgePanel.vue'
import { useEngine } from '../../src/stores/engine'
import { html, setup, text } from '../scene/fixtures'

vi.mock('../../src/router', () => ({ FULL_PAGES: [{ path: '/', name: '主畫面' }], router: {} }))
afterEach(() => { delete (globalThis as { localStorage?: unknown }).localStorage })

const strip = (h: string): string => text(h).replace(/\s+/g, ' ')
const attrNum = (h: string, attr: string): number => Number(/>(-?\d+)</.exec(h.slice(h.indexOf(attr)))?.[1])
/** 這個假服務商收到的每一份請求的訊息內文（沒有 JSON 轉義） */
const promptsOf = (fake: FakeProvider): string[] => fake.requests.map((q) => q.messages.map((m) => m.content).join('\n'))

describe('P1 角色的成人分頁：全讀引擎', () => {
  it('體悟：成人分頁、夜課面板與引擎的 nightList 是同一個數字；學一招之後三處一起變', async () => {
    const s = await setup({ begin: false, insight: 12 })
    const e = s.e
    const insights = async (): Promise<number[]> => {
      const a = await html(s.pinia, AdultTab)
      const n = await html(s.pinia, NightClassPanel)
      return [attrNum(a, 'data-adult-insight'), attrNum(n, 'data-insight'), e.night.list()!.insight]
    }
    expect(await insights()).toEqual([12, 12, 12])
    expect(e.night.learn('nt_c1')).toBeNull()
    const after = await insights()
    expect(after[2]).toBeLessThan(12)
    expect(new Set(after).size).toBe(1)
  })

  it('橋參數：成人分頁的有效值與橋分頁（引擎的 bridgeParams）一致，不套自己的公式', async () => {
    const s = await setup({ begin: false })
    const params = s.e.body.bridgeParams()
    expect(params).not.toBeNull()
    const a = await html(s.pinia, AdultTab)
    const b = await html(s.pinia, BridgePanel)
    for (const p of params!) {
      const seg = a.slice(a.indexOf(`data-param="${p.id}"`))
      expect(Number(/data-param-value[^>]*>(\d+)</.exec(seg)?.[1])).toBe(p.value)
      expect(Number(/data-param-base[^>]*>(\d+)</.exec(seg)?.[1])).toBe(p.base)
      expect(b).toContain(p.name)
    }
    // 沒有橋的效果句子：引擎沒給，畫面不寫（不用介面的公式）
    expect(strip(a)).not.toMatch(/受到的感載 ×|深同步要|承受層數 \+/)
  })

  it('性經歷與傾向讀引擎的紀錄；沒有的寫「還沒有」', async () => {
    const s = await setup({ begin: false })
    const pc = s.e.pc!.id
    expect(s.e.commit({ summary: '寫一筆', action: 'ui.test_sex', changes: [{ op: 'actor.ext', id: pc, key: 'sex_record', value: { partners: 2, times: 7, service_times: 0, people: { npc_ann: 7 }, positions: [], tags: [] } }] as never }, { attach: true })).toBeNull()
    const a = await html(s.pinia, AdultTab)
    expect(attrNum(a, 'data-sex-times')).toBe(7)
    expect(attrNum(a, 'data-sex-partners')).toBe(2)
    expect(strip(a)).toContain('還沒有')
  })
})

describe('應修 10 寫法指令：原樣送出，超過上限由引擎截斷並提醒', () => {
  it('略過的場景：帶空白、標點、全形與表情符號的字，進寫正文的請求逐字相同', async () => {
    const fake = new FakeProvider()
    const s = await setup({ provider: fake })
    const dir = '  慢一點，再慢一點！　（全形空白）😊 —— end '
    const r = await s.e.scene.skip(dir)
    expect(r.status).toBe('applied')
    expect(r.notices ?? []).toEqual([])
    const sent = promptsOf(fake).filter((m) => m.includes('<direction>'))
    expect(sent.length).toBeGreaterThan(0)
    expect(sent.some((m) => m.includes(`<direction>\n${dir}\n</direction>`))).toBe(true)
  })

  it('超過上限：引擎截成前 DIRECTION_MAX 個字（照字數，不是 UTF-16），並給它那一句提醒', async () => {
    const fake = new FakeProvider()
    const s = await setup({ provider: fake })
    const long = '😊'.repeat(DIRECTION_MAX + 7)
    const r = await s.e.scene.skip(long)
    expect(r.status).toBe('applied')
    expect(r.notices).toEqual([`指令最多 ${DIRECTION_MAX} 字，超過的部分沒有送出。`])
    const sent = promptsOf(fake).find((m) => m.includes('<direction>'))!
    expect(sent).toContain(`<direction>\n${'😊'.repeat(DIRECTION_MAX)}\n</direction>`)
  })
})

describe('建角：買得到什麼、建議組合、外觀都問引擎', () => {
  const draftOf = (origin: string, extra: Record<string, unknown> = {}) => ({
    name: '露', gender: 'female', age: 22, origin, originChoice: { favor: 'lonestar' }, attrPick: { reflex: 15, charm: 14, intellect: 13, body: 12, resolve: 10, tech: 8 }, attrBonus: { tech: -4, reflex: 3, resolve: 3 },
    skills: { streetwise: 3, negotiate: 3, perform: 2, stealth: 2 }, perks: ['smooth_talker', 'tough'], ...extra,
  }) as never

  it('示意世界的目錄：橋、義體、裝備分四組都有，選不得的帶引擎的原因；不再有介面自己的清單', () => {
    setActivePinia(createPinia())
    const e = useEngine()
    const cat = e.creation.catalog(draftOf('hive'))
    expect(cat.bridges.length).toBeGreaterThan(0)
    expect(cat.cyber.length).toBeGreaterThan(0)
    expect(cat.gear.length).toBeGreaterThan(0)
    // 企業限定的橋：蜂巢出身選不得，原因寫在那一列
    const field = cat.bridges.find((b) => b.id === 'bp_bridge_field')
    expect(field?.block).toBeTruthy()
    expect(e.creation.catalog(draftOf('corp', { originChoice: { favor: 'starbelle' } })).bridges.find((b) => b.id === 'bp_bridge_field')?.block).toBeNull()
  })

  it('出身的建議組合是出身資料的 suggested（照點數裁過）；外觀的句子與風格是引擎的 creationLook', () => {
    setActivePinia(createPinia())
    const e = useEngine()
    const kit = e.creation.suggested(draftOf('hive', { bridge: 'bp_bridge_used' }))
    expect(kit.has).toBe(true)
    expect(kit.gear.length).toBeGreaterThan(0)
    const look = e.creation.look(draftOf('hive', { bridge: 'bp_bridge_used', cyber: [{ blueprint: 'bp_eye', side: 'l' }, { blueprint: 'bp_ears' }], beastLine: '狐' }))
    expect(look.cyber.some((t) => t.includes('後頸'))).toBe(true)
    expect(look.cyber.some((t) => t.includes('左眼'))).toBe(true)
    expect(look.beast[0]).toContain('狐耳')
    expect(look.style.main).toBeTruthy()
    expect(e.creation.beastLines()).toContain('貓')
  })
})
