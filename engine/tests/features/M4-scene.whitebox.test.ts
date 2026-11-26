// 白箱：成人場景的輸入檢查與行動的擋下（features/scene/play.ts 的 inputProblem、blocks、circleBlocks、callBlocks）沒有走到的分支（M4 白箱，cpp-tester-whitebox）。
// 規格：LEWD_SYSTEM 3.5 節（行動表：換圈 2 點、叫人 1 點只有主角；一圈最多四個人；精簡版固定一對一不分圈；單人沒有對象：沒有主導、迎合、挑逗，也沒有圈，加快與放慢只有單人才有）、
// 第 5 節（夜課的功夫 once：每場一次）；AI_TASKS 3.6 節（scene_turn 的輸入格式）；GAME_DESIGN 第 3 節（壞輸入整串不套、狀態不變）。
// 一局：makeBodyGame（bodyWorld 的體位、夜課）加六位成年 NPC；用 openScene 開場，sceneAct 做行動。

import { describe, expect, it } from 'vitest'
import { ActionBlocked } from '../../src'
import { sceneAct } from '../../src/features/scene'
import { inputProblem } from '../../src/features/scene/play'
import type { SceneInput } from '../../src/features/scene'
import type { Game } from '../../src/shell/game'
import { makeBodyGame, openScene, sceneCast, standAt, stateHash } from '../../src/testkit'

const NAMES = ['ann', 'bo', 'cy', 'di', 'ev', 'fa']
const id = (n: string) => `npc_tw_${n}`
const start = (setup: Record<string, unknown>): Game => {
  const g = makeBodyGame({ actors: sceneCast(...NAMES), at: { block: 'tw_tower', marker: 'E1' } }).game
  standAt(g, 'tw_tower', 'E1')
  openScene(g, setup)
  return g
}
const reason = (g: Game, input: unknown): string => {
  const before = stateHash(g.state)
  try { sceneAct(g.k, g.state, input as SceneInput) } catch (e) {
    if (e instanceof ActionBlocked) {
      expect(stateHash(g.state), '被擋下的行動不改狀態').toBe(before)
      return e.message
    }
    throw e
  }
  return ''
}

describe('輸入的格式（inputProblem；AI 交來的與玩家送的行動都先過這一關）', () => {
  const cases: Array<[string, unknown, RegExp | null]> = [
    ['不是物件', 'tease', /要給一個行動/],
    ['null', null, /要給一個行動/],
    ['kind 不是字串', { kind: 5 }, /要給一個行動/],
    ['kind 不認得', { kind: 'strangle' }, /沒有「strangle」這種行動/],
    ['kind 是原型的鍵', { kind: 'constructor' }, /沒有「constructor」這種行動/],
    ['技能沒有 id', { kind: 'skill' }, /要指明是哪一個（id）/],
    ['道具的 id 是空字串', { kind: 'item', id: '' }, /要指明是哪一個（id）/],
    ['切換體位沒有 position', { kind: 'switch' }, /切換體位.+position/],
    ['換檔的 gear 不認得', { kind: 'gear', gear: 'turbo' }, /換檔要指明換到哪一檔/],
    ['換圈沒有 circle', { kind: 'move_circle' }, /要指明換到哪一圈/],
    ['叫人沒有 who', { kind: 'call', who: '' }, /要指明叫誰/],
    ['夜課的功夫 id 不認得', { kind: 'once', id: 'win' }, /要指明是哪一個（id：set_init、fit_floor）/],
    ['夜課的功夫 value 是字串', { kind: 'once', id: 'set_init', value: '70' }, /value 要是數字/],
    ['target 是空字串', { kind: 'tease', target: '' }, /target 要是角色的 id/],
    ['target 是數字', { kind: 'tease', target: 3 }, /target 要是角色的 id/],
    ['pick 是字串', { kind: 'tease', pick: 'hand' }, /pick 要是/],
    ['pick.my_part 是數字', { kind: 'tease', pick: { my_part: 1 } }, /pick 要是/],
    ['合格：技能', { kind: 'skill', id: 'nt_tw_kiss' }, null],
    ['合格：夜課的功夫', { kind: 'once', id: 'fit_floor' }, null],
    ['合格：結束回合', { kind: 'end_turn' }, null],
  ]
  for (const [what, input, re] of cases) {
    it(`${what}`, () => {
      const p = inputProblem(input)
      if (re === null) expect(p).toBeNull()
      else expect(p, JSON.stringify(input)).toMatch(re)
    })
  }
})

describe('換圈與叫人（LEWD_SYSTEM 3.5 節第二～八點）', () => {
  it('精簡版不分圈：換圈、叫人都被擋，並說到設定裡切到完整版', () => {
    const g = start({ with: [id('ann')], nature: 'mutual', goal: 'please', mode: 'simple' })
    expect(reason(g, { kind: 'move_circle', circle: 'c1' })).toMatch(/精簡版不分圈/)
    expect(reason(g, { kind: 'call', who: id('bo') })).toMatch(/精簡版不分圈/)
  })
  it('完整版：沒有這一圈、別的圈沒有這個人、這一圈已經滿了（一圈最多四個人）', () => {
    const g = start({ circles: [['pc', id('ann'), id('bo')], [id('cy'), id('di')]], nature: 'mutual', mode: 'full' })
    expect(reason(g, { kind: 'move_circle', circle: 'c99' })).toMatch(/沒有這一圈/)
    expect(reason(g, { kind: 'call', who: id('fa') })).toMatch(/別的圈裡沒有這個人/)
    // 這一圈三個人，叫一個進來要四人體位：測試世界沒有（行動點夠的時候才看得到這一句）
    expect(reason(g, { kind: 'call', who: id('di') })).toMatch(/沒有全圈都會的 4 人體位：叫不過來/)
  })
  it('別的圈已經有三個人：加上主角剛好四個，沒有共同會的四人體位被擋；別的圈有四個人：加上你超過四個人', () => {
    const g = start({ circles: [['pc', id('ann'), id('bo')], [id('cy'), id('di'), id('ev')]], nature: 'mutual', mode: 'full' })
    expect(reason(g, { kind: 'move_circle', circle: 'c1' })).toMatch(/沒有共同會的 4 人體位/)
    const h = start({ circles: [['pc', id('ann'), id('bo')], [id('cy'), id('di'), id('ev'), id('fa')]], nature: 'mutual', mode: 'full' })
    expect(reason(h, { kind: 'move_circle', circle: 'c1' })).toMatch(/那一圈已經有 4 個人，加上你超過四個人/)
  })
  it('行動點不夠的時候，換圈的擋下多一句「行動點不夠」（換圈 2 點）', () => {
    const g = start({ circles: [['pc', id('ann'), id('bo')], [id('cy'), id('di')]], nature: 'mutual', mode: 'full' })
    const seat = (g.state.ext.scene as { seats: Array<{ id: string; ap: number }> }).seats.find((x) => x.id === 'pc')!
    seat.ap = 1
    expect(reason(g, { kind: 'move_circle', circle: 'c1' })).toMatch(/行動點不夠：這個行動要 2 點，你只剩 1 點/)
    expect(reason(g, { kind: 'call', who: id('cy') })).toMatch(/叫不過來|行動點不夠/)
  })
  it('換圈與叫人只有主角能做：npc 的回合送這兩種行動被丟掉（performMoves 的規矩），輪到對方時主角送行動被擋（還沒輪到你）', () => {
    const g = start({ with: [id('ann')], nature: 'mutual', goal: 'please', mode: 'full' })
    expect(reason(g, { kind: 'tease', target: id('zzz') })).toMatch(/這一圈裡沒有這個人/)
    expect(reason(g, { kind: 'tease', target: 'pc' })).toMatch(/這一圈裡沒有這個人/)
  })
})

describe('單人沒有對象（LEWD_SYSTEM 3.5 節第九點）與只有單人才有的加快、放慢', () => {
  it('單人：主導、迎合、挑逗、換圈、叫人各被擋並說明；一對一用加快與放慢被擋', () => {
    const solo = start({ solo: true, mode: 'full' })
    expect(reason(solo, { kind: 'dominate' })).toMatch(/單人沒有主導與迎合/)
    expect(reason(solo, { kind: 'yield' })).toMatch(/單人沒有主導與迎合/)
    expect(reason(solo, { kind: 'tease' })).toMatch(/單人沒有對象可以挑逗/)
    expect(reason(solo, { kind: 'move_circle', circle: 'c1' })).toMatch(/單人沒有別的圈/)
    expect(reason(solo, { kind: 'call', who: id('ann') })).toMatch(/單人沒有別的圈/)
    const pair = start({ with: [id('ann')], nature: 'mutual', goal: 'please', mode: 'full' })
    expect(reason(pair, { kind: 'faster' })).toMatch(/只有單人的場景才有加快與放慢/)
    expect(reason(pair, { kind: 'slower' })).toMatch(/只有單人的場景才有加快與放慢/)
  })
  it('夜課的功夫（once）：還沒學不能用；對象不存在被擋；在單人場景裡不能用', () => {
    const pair = start({ with: [id('ann')], nature: 'mutual', goal: 'please', mode: 'full' })
    expect(reason(pair, { kind: 'once', id: 'fit_floor' })).toMatch(/還沒有這個夜課的功夫|沒有契合可以動/)
    const solo = start({ solo: true, mode: 'full' })
    expect(reason(solo, { kind: 'once', id: 'fit_floor' })).toMatch(/只有你和對象之間才用得出這個功夫/)
  })
  it('換衣服（dress）沒有那個共鳴不能用；沒有連接就不能主導、迎合、挑逗', () => {
    const pair = start({ with: [id('ann')], nature: 'mutual', goal: 'please', mode: 'full' })
    expect(reason(pair, { kind: 'dress' })).toMatch(/沒有脫換衣服的功夫/)
    expect(reason(pair, { kind: 'dominate' })).toMatch(/還沒有連接/)
    expect(reason(pair, { kind: 'tease' })).toMatch(/還沒有連接/)
  })
  it('壞輸入整串不套：格式不對的行動丟 ActionBlocked 而不是程式錯誤，狀態一個字都不變', () => {
    const g = start({ with: [id('ann')], nature: 'mutual', goal: 'please', mode: 'full' })
    for (const bad of ['x', null, 7, { kind: 'zzz' }, { kind: 'skill' }, { kind: 'once', id: 'nope' }, { kind: 'tease', pick: 5 }]) expect(reason(g, bad)).not.toBe('')
  })
})
