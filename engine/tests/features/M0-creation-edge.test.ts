// M0-creation 的補充：驗收測試沒有碰到的邊界（工單的函式規則）。
import { describe, expect, it } from 'vitest'
import { attrBlock, buildCreationReport, creationBlocks, creationFeature, perkBlock, skillBlock } from '../../src/features/creation'
import type { CreationDraft } from '../../src/features/creation'
import { makeGame } from '../../src/testkit'
import { MINI_PACK } from '../helpers/miniContent'

const setup = (rules: Record<string, unknown> = {}) => makeGame({ scenario: 'beforeCreation', features: [creationFeature], content: [MINI_PACK], patch: { rules: rules as never } }).game
const draft = (over: Partial<CreationDraft> = {}): CreationDraft => ({
  name: '露', gender: 'female', age: 22, origin: 'hive', originChoice: { favor: '野良' },
  attrPick: { reflex: 15, charm: 14, intellect: 13, body: 12, resolve: 10, tech: 8 },
  attrBonus: { tech: -4, reflex: 3, resolve: 3 }, skills: { streetwise: 3 }, perks: [], ...over,
})

describe('M0-creation 邊界', () => {
  it('屬性的增減不是整數：先擋，放在其他檢查之前', () => {
    const { k } = setup()
    expect(attrBlock(k, {}, { tech: 1.5 })).toMatch(/整數/)
  })

  it('基本功：等級 0 的不查 id；兩個缺陷加兩個特質在預算內可以過', () => {
    const { k, state } = setup()
    expect(skillBlock(k, state, { juggling: 0 })).toBeNull()
    expect(perkBlock(k, state, ['smooth_talker', 'tough', 'loose_lips', 'old_wound'])).toBeNull()
  })

  it('單項上限 6 的設定：出身的 +1 不會把等級推過 6', () => {
    const game = setup({ startSkillMax: 6, startSkillPoints: 6 })
    const r = buildCreationReport(game.k, game.state, draft({ skills: { streetwise: 6 } }))
    expect(game.commit(r)).toHaveLength(1)
    expect(game.state.actors.pc!.skills.streetwise).toBe(6)
  })

  it('起始的錢是 0：不放 cash 變更；已有主角與名字、性別各自擋', () => {
    const game = setup({ startMoney: 0 })
    expect(buildCreationReport(game.k, game.state, draft()).changes.map((c) => c.op)).toEqual(['actor.add', 'pc'])
    expect(creationBlocks(game.k, game.state, draft({ gender: '' }))[0]!.reason).toBe('要選性別。')
    expect(creationBlocks(game.k, game.state, draft({ originChoice: { favor: '緋櫻' } }))[0]!.reason).toBe('要選一個勢力：孤星連、野良。')
  })
})
