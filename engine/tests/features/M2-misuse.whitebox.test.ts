// 白箱：M2 各功能對外的「改狀態的入口」被叫錯的時候：不存在的 id、不在對的地方、沒有主角、參數是壞值。
// 規格：dev/invariants.md 第 1、4 條（被擋下的動作不改狀態）；各功能檔頭的「不成立丟 ActionBlocked（原因一句一條）」；GAME_DESIGN 第 3 節（壞輸入整串不套）。
// 性質：每一個入口，不成立時丟 ActionBlocked（原因是完整的一句話）或回傳 null／原因；絕不丟 TypeError／RangeError；丟了之後狀態一個字都不變。
// 不存在的商店與不存在的 npc 是呼叫的人寫錯 id（介面只會給選單上有的），丟一般的 Error 也算過，只是要寫出是哪個 id。

import { describe, expect, it } from 'vitest'
import { ActionBlocked } from '../../src'
import { setBill } from '../../src/features/bills'
import { spend, spendBlock, call } from '../../src/features/favors'
import { accept, buyIntel, drop, go, haggle, hire, scout, unhire } from '../../src/features/fixer'
import { meetNpc, watchNpc } from '../../src/features/npcs'
import { leave, join, setPay, muster } from '../../src/features/roster'
import { breathDraft, leaveDraft, rentDraft, sleepDraft } from '../../src/features/rest'
import { sceneAct, sceneNext } from '../../src/features/scene'
import { checkout } from '../../src/features/trade'
import { advance, alight, board, taxi, wait } from '../../src/features/transit'
import { shift } from '../../src/features/work'
import { arrive } from '../../src/features/world'
import { makeCityGame, makeCommissionGame, stateHash } from '../../src/testkit'
import type { Game } from '../../src/shell/game'

type Call = [string, (g: Game) => unknown]

function sweep(g: Game, calls: Call[], where: string): { blocked: string[]; plain: string[]; ok: string[] } {
  const blocked: string[] = []
  const plain: string[] = []
  const ok: string[] = []
  for (const [name, fn] of calls) {
    const before = stateHash(g.state)
    try {
      fn(g)
      ok.push(name)
    } catch (e) {
      expect(e instanceof TypeError || e instanceof RangeError || e instanceof ReferenceError, `${where} ${name}：${(e as Error).name}：${(e as Error).message}`).toBe(false)
      if (e instanceof ActionBlocked) {
        expect((e as ActionBlocked).reason.length, `${where} ${name}`).toBeGreaterThan(5)
        blocked.push(name)
      } else {
        expect((e as Error).message.length, `${where} ${name}`).toBeGreaterThan(3)
        plain.push(name)
      }
    }
    expect(stateHash(g.state), `${where} ${name} 改了狀態`).toBe(before)
  }
  return { blocked, plain, ok }
}

describe('白箱 M2 入口被叫錯：城市', () => {
  it('租、睡、喘氣、帳單、打工、買、搭車、計程車、進場景、人物：不存在的 id、不在對的地方、壞參數', () => {
    const { game: g } = makeCityGame({ seed: 7 })
    const r = sweep(g, [
      ['rent 不存在', (x) => rentDraft(x.k, x.state, 'no_such')],
      ['rent 已經有家', (x) => rentDraft(x.k, x.state, 'r_tw_unit')],
      ['leave 沒有家以外', (x) => { leaveDraft(x.k, x.state) }],
      ['sleep 壞睡處', (x) => sleepDraft(x.k, x.state, { spot: 'nowhere' as never })],
      ['sleep 設施', (x) => sleepDraft(x.k, x.state, { spot: 'facility' })],
      ['bill 不存在的項目', (x) => setBill(x.k, x.state, 'no_such', { stopped: true })],
      ['bill 現金', (x) => setBill(x.k, x.state, 'rent', { cash: true })],
      ['work 不存在', (x) => shift(x.k, x.state, 'no_such', 4)],
      ['work 不在碼頭', (x) => shift(x.k, x.state, 'j_tw_porter', 4)],
      ['work NaN', (x) => shift(x.k, x.state, 'j_tw_porter', Number.NaN)],
      ['buy 不存在的店', (x) => checkout(x.k, x.state, 'no_shop', { buy: [{ item: 'i_tw_ration', qty: 1 }], pay: 'cash' })],
      ['buy 不在店裡', (x) => checkout(x.k, x.state, 's_tw_stall', { buy: [{ item: 'i_tw_ration', qty: 1 }], pay: 'cash' })],
      ['buy 空車', (x) => checkout(x.k, x.state, 's_tw_stall', { buy: [], pay: 'cash' })],
      ['board 不存在的線', (x) => board(x.k, x.state, { line: 'no_line', pay: 'cred' })],
      ['board 壞付法', (x) => board(x.k, x.state, { line: 'tw_metro', pay: 'cheque' as never })],
      ['board 不在站上', (x) => board(x.k, x.state, { line: 'tw_metro', pay: 'cred' })],
      ['wait 沒有搭車', (x) => wait(x.k, x.state)],
      ['advance 沒有搭車', (x) => advance(x.k, x.state)],
      ['alight 沒有搭車', (x) => alight(x.k, x.state)],
      ['taxi 不存在的站', (x) => taxi(x.k, x.state, 'no_station')],
      ['arrive 不存在的街區', (x) => arrive(x.k, x.state, 'no_block', 'E1')],
      ['arrive 不存在的標記', (x) => arrive(x.k, x.state, 'tw_market', 'ZZ')],
      ['scene 沒有場景 act', (x) => sceneAct(x.k, x.state, { kind: 'stop' })],
      ['scene 沒有場景 next', (x) => sceneNext(x.k, x.state)],
      ['meet 不存在的人', (x) => meetNpc(x.k, x.state, 'no_such')],
      ['watch 不存在的人', (x) => watchNpc(x.k, x.state, 'no_such')],
      ['favor spend 沒有', (x) => spend(x.k, x.state, { size: 'small' })],
      ['favor spend 壞 id', (x) => spend(x.k, x.state, { id: 'fv_999' })],
      ['favor call 沒有', (x) => call(x.k, x.state, 'fv_999', 'do')],
      ['roster leave 不在名冊', (x) => leave(x.state, 'no_such')],
      ['roster setPay 不在名冊', (x) => setPay(x.state, 'no_such', { pay: 'fee' })],
      ['roster join 主角', (x) => join(x.k, x.state, 'pc')],
      ['roster muster 不在名冊', (x) => muster(x.k, x.state, { party: ['no_such'] })],
    ], '城市')
    // 這幾個不是「呼叫的人寫錯」就是該被擋下來的，一個都不該成立
    for (const name of ['rent 不存在', 'sleep 壞睡處', 'bill 不存在的項目', 'work 不存在', 'buy 不存在的店', 'board 不存在的線', 'taxi 不存在的站', 'scene 沒有場景 act', 'roster leave 不在名冊', 'roster join 主角']) {
      expect(r.ok, name).not.toContain(name)
    }
    expect(spendBlock(g.k, g.state, { size: 'small' })).toContain('沒有')
  })

  it('沒有主角：睡、喘氣、打工、搭車、進名冊、召集都被擋、不丟程式錯誤', () => {
    const { game: g } = makeCityGame({ seed: 7 })
    g.state.pc = null as never
    sweep(g, [
      ['sleep', (x) => sleepDraft(x.k, x.state)],
      ['breath', (x) => breathDraft(x.k, x.state)],
      ['work', (x) => shift(x.k, x.state, 'j_tw_porter', 4)],
      ['rent', (x) => rentDraft(x.k, x.state, 'r_tw_unit')],
      ['muster', (x) => muster(x.k, x.state, {})],
      ['join', (x) => join(x.k, x.state, 'npc_tw_friend')],
    ], '沒有主角')
  })
})

describe('白箱 M2 入口被叫錯：委託', () => {
  it('接案、踩點、買情報、請人、出發：不存在的委託、重複、已經在副本裡', () => {
    const t = makeCommissionGame({ seed: 6 })
    const { game: g, job } = t
    sweep(g, [
      ['accept 不存在', (x) => accept(x.k, x.state, { id: 'of_nope', fixer: 'fx_tw_broker' }, { pay: 'cash' })],
      ['accept 不存在的中間人', (x) => accept(x.k, x.state, { id: 'of_nope', fixer: 'fx_nope' }, { pay: 'cash' })],
      ['accept 壞付法', (x) => accept(x.k, x.state, { id: job, fixer: 'fx_tw_broker' }, { pay: 'bitcoin' as never })],
      ['haggle 不存在', (x) => haggle(x.k, x.state, { id: 'of_nope', fixer: 'fx_tw_broker' })],
      ['scout 不存在的委託', (x) => scout(x.k, x.state, 'no_job', 'survey')],
      ['scout 不存在的手段', (x) => scout(x.k, x.state, job, 'telepathy')],
      ['buyIntel 不存在的未知', (x) => buyIntel(x.k, x.state, job, 'u_nope', 'cash')],
      ['buyIntel 壞付法', (x) => buyIntel(x.k, x.state, job, 'u_nope', 'gold' as never)],
      ['hire 不存在的委託', (x) => hire(x.k, x.state, 'no_job', { actor: 'a_tw_runner', face: 'meat', way: 'pay' } as never)],
      ['unhire 沒請', (x) => unhire(x.k, x.state, job, 'a_tw_runner')],
      ['drop 不存在', (x) => drop(x.k, x.state, 'no_job')],
      ['go 不存在', (x) => go(x.k, x.state, 'no_job')],
    ], '委託')
    // 出發之後：草稿做得出來（草稿是純函式，不看活動），但提交會被副本的放行表擋下：再出發、放下手上的、踩點、接新案、請人、睡覺、租屋、買東西、打工
    g.commit(go(g.k, g.state, job))
    const blockedAtCommit: Call[] = [
      ['go 再一次', (x) => x.commit(go(x.k, x.state, job))],
      ['drop 副本中', (x) => x.commit(drop(x.k, x.state, job))],
      ['scout 副本中', (x) => x.commit(scout(x.k, x.state, job, 'survey'))],
      ['sleep 副本中', (x) => x.commit(sleepDraft(x.k, x.state, { spot: 'wild' }))],
      ['rent 副本中', (x) => x.commit(rentDraft(x.k, x.state, 'r_tw_unit'))],
      ['work 副本中', (x) => x.commit(shift(x.k, x.state, 'j_tw_porter', 4))],
      ['buy 副本中', (x) => x.commit(checkout(x.k, x.state, 's_tw_stall', { buy: [{ item: 'i_tw_ration', qty: 1 }], pay: 'cash' }))],
      ['muster 副本中', (x) => x.commit(muster(x.k, x.state, { party: [] }))],
    ]
    const r = sweep(g, blockedAtCommit, '副本中')
    expect(r.ok).toEqual([])
  })
})
