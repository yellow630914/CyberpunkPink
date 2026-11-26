// B033（M4 白箱，cpp-tester-whitebox）：夜課的橋參數條件，對沒有橋的人讀成 0。
// 規格：LEWD_SYSTEM 第 1 節「沒有橋的人沒有這四項」；NIGHT_LESSONS「寫法的約定」的 requires.bridge（<參數>_min／_max）。
// 程式（features/nightclass/learn.ts 的 bridgeValue）註解寫「沒有橋是 null」、requireBlocks 有一條「要看X，可是你現在沒有橋。」；
// 可是裝了 lewd（正式的局一定裝）時 bridge_<參數> 這個衍生數值存在，沒有橋的人讀到 0：_min 的寫成「X要有 40，你現在是 0。」，_max 的直接算過。
// 重現：engine/tests/whitebox/fixtures/B033-night-bridge-req-without-bridge.json。dev/bugs/B033-night-bridge-req-without-bridge.md。

import { describe, expect, it } from 'vitest'
import type { ContentPack } from '../../src'
import { characterFeature } from '../../src/features/character'
import { lewdFeature } from '../../src/features/lewd'
import { learnProblems, nightclassFeature } from '../../src/features/nightclass'
import { sceneFeature } from '../../src/features/scene'
import { makeGame } from '../../src/testkit'

const HAND = { ap: 1, my_part: ['hand_l'], their_part: ['chest'], on_use: { their_load: '1d6', fit: 2 } }
const roles = [{ id: 'a', upper: true }, { id: 'b', upper: false }]
const links = [{ from: ['a', 'hand_l'], to: ['b', 'chest'] }, { from: ['b', 'hand_l'], to: ['a', 'chest'] }]
const PACK: ContentPack = {
  id: 'b033',
  content: {
    night_skill: [
      { id: 'nt_tol', name: '再忍一下', branch: 'common', tier: 1, tag: '共通', requires: { bridge: { tolerance_min: 40 } }, scene: HAND },
      { id: 'nt_docile', name: '別太聽話', branch: 'common', tier: 1, tag: '共通', requires: { bridge: { docility_max: 60 } }, scene: HAND },
    ],
    position: [{ id: 'pos_face', name: '面對面', people: 2, roles, mult: { a: 1, b: 1 }, initiative_drift: 3, tags: [], unlocked_by: null, links }],
  } as never,
}

describe('B033：沒有橋的人學要看橋參數的夜課（LEWD_SYSTEM 第 1 節：沒有橋的人沒有這四項）', () => {
  const bridgeless = () => {
    const g = makeGame({ features: [characterFeature, lewdFeature, sceneFeature, nightclassFeature], content: [PACK], pc: { ext: { bridge: null } } }).game
    g.state.meters.insight = { _: 50 }
    return g
  }

  it('要耐受 40 以上：原因是「要看耐受，可是你現在沒有橋。」（不是「你現在是 0」）', () => {
    const g = bridgeless()
    expect(learnProblems(g.k, g.state, 'pc', 'nt_tol')).toEqual(['要看耐受，可是你現在沒有橋。'])
  })

  it('要馴化 60 以下：沒有橋不算過（「要看馴化，可是你現在沒有橋。」）', () => {
    const g = bridgeless()
    expect(learnProblems(g.k, g.state, 'pc', 'nt_docile')).toEqual(['要看馴化，可是你現在沒有橋。'])
  })
})
