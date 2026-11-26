// B038（邊界，cpp-tester-boundary）：內容資料的年齡底線繞得過去（內容的覆蓋、沒裝 npcs 功能時的匯入）。
// 規格：AI_TASKS 2.5 節第二條（使用者 2026-11-25）：新的人、匯入與世界編輯器的人物，年齡欄位低於 18 一律擋下；GAME_DESIGN 第 3 節（不論開關，內容底線一律擋）。
// 重現：tests/pending/fixtures/B038-content-age-bypass.json。dev/bugs/B038-content-age-bypass.md。

import { describe, expect, it } from 'vitest'
import { clone } from '../../src'
import { makeCityGame, makeWorldGame } from '../../src/testkit'
import { fixture } from './_b03x'

fixture('B038-content-age-bypass')
const NPC = 'npc_tw_friend'

describe('B038：內容裡低於 18 的年齡一律擋下', () => {
  it('覆蓋（applyOverlays）：把 npc 的 age 改成 16 → 丟錯、內容還原', () => {
    const { game: g } = makeCityGame()
    const base = clone(g.k.content.get('npc', NPC)!)
    expect(() => g.k.content.applyOverlays([{ id: 'ov', content: { npc: { set: [{ ...base, age: 16 } as never] } } }])).toThrow(/18|age/)
    expect(g.k.content.get('npc', NPC)!.age).not.toBe(16)
  })

  it('沒裝 npcs 功能：匯入 12 歲的 npc → 載入失敗', () => {
    expect(() => makeWorldGame({ without: ['npcs'], content: [{ id: 'import', content: { npc: [{ id: 'npc_tw_young', name: '小孩', age: 12 } as never] } }] })).toThrow(/18|age/)
  })
})
