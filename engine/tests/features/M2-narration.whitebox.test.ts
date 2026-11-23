// 白箱：M2 各功能交給 AI 寫正文的「結果」句子（報告的 narration.results）不帶 H4 會擋的數字。
// 規格：AI_TASKS 4.1「正文的硬規則」、PROMPTS H4（擲骰、DC、傷害、生命、感載的數字不寫進文字；世界裡的數字照常寫）；dev/invariants.md 第 125 條；
// 背景：AI 會把結果句子抄進正文。句子裡帶「生命值 +3」，正文被硬規則擋下，行動停在半路（M2 修正批 13 修過睡覺與喘口氣）。
// 做法：把城市（跑十二天）與委託的幾條路線都玩一遍，每一份報告的每一行結果都過一次和 checkProse 同一組規則（複製在這裡；那邊改了這邊要跟著改）。
// 另一個保險：用開著 AI 的假服務商，把報告的結果原樣抄成正文，每一份報告都該寫得進去、不被擋。

import { describe, expect, it } from 'vitest'
import { playAll } from '../helpers/m2-flows'

const STATUS_BAR = [/^\s{0,3}#{1,6}\s/m, /\b(?:HP|MP|AP|SP|XP|DC|LV)\s*[:：]?\s*[-−+]?\d/, /(?:生命值?|感載|過載|護甲|行動點|餘韻|沉溺)\s*[:：]?\s*\d+\s*[/／]\s*\d+/]
const DICE_JARGON = [/(?:擲出|骰出|擲到|骰到|擲得)\s*\d/, /\bDC\s*\d/, /\b\d*d(?:4|6|8|10|12|20|100)\b/, /\brolled\s+\d/i, /命中率/]
const MECHANIC_NUMBERS = [
  /\d[\d,]*\s*點\s*(?:的\s*)?(?:傷害|生命|血量|感載|護甲|行動點|HP)/,
  /(?:傷害|生命值?|血量|感載|護甲|行動點|HP)\s*[:：]?\s*[-−+＋－]\s*\d/,
  /(?:造成|受到|承受|失去|損失)\s*\d[\d,]*\s*(?:傷害|生命|感載)/,
]
const ALL = [...STATUS_BAR, ...DICE_JARGON, ...MECHANIC_NUMBERS]

describe('白箱 H4／H10：M2 各功能的結果句子', () => {
  it('城市與委託的每一條路線、每一份報告的每一行結果都過硬規則；報告裡有結果可看（掃到的行數夠多）', async () => {
    const games = await playAll()
    let lines = 0
    const bad: string[] = []
    const actions = new Set<string>()
    for (const g of games) {
      for (const r of g.state.reports) {
        for (const line of r.narration?.results ?? []) {
          lines++
          actions.add((r.action ?? '').split('.')[0]!)
          if (ALL.some((re) => re.test(line))) bad.push(`${r.action}：${line.slice(0, 60)}`)
        }
      }
    }
    expect(lines).toBeGreaterThan(60)
    for (const prefix of ['rest', 'work', 'trade', 'bill', 'fixer', 'commission', 'event', 'scene']) expect(actions.has(prefix), `沒有掃到 ${prefix} 的結果`).toBe(true)
    expect([...new Set(bad)]).toEqual([])
  }, 120_000)
})
