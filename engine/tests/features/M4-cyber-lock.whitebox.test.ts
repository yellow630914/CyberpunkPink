// 白箱：features/cyberware 的補繳、破解與畫面讀的鎖（crack.ts、lock.ts）沒有走到的分支（M4 白箱，cpp-tester-whitebox）。
// 規格：CYBERWARE 第 5 節「授權鎖」（訂閱沒付就鎖、付清解鎖、改造師破解）；TRADE 3.4 節；DOWNTIME 3.1 節（修理）；dev/adr/0019 P11、P12、P45；dev/work/M4-cyber-lock.md 第 3、9 條。
// 一局：makeBodyGame（bodyWorld 的義眼 II、義臂 III，勢力 f_corp）。有鎖的義體用內建來源的效果 cyber_install 直接裝上（事件與契約用的同一條路）。

import { describe, expect, it } from 'vitest'
import type { Change, ReportDraft } from '../../src'
import { ActionBlocked } from '../../src'
import { crackProblems, cyberOf, lockView, payLockBlock, payLockDraft, payLockProblems } from '../../src/features/cyberware'
import { applyEffects, makeBodyGame } from '../../src/testkit'

type Rec = Record<string, any>
const sys = (changes: Change[], action = 'test.give'): ReportDraft => ({ kind: 'system', action, location: {}, party: [], timeline: [], changes, outcome: { result: 'ok', summary: '測試。' } })
const reasonOf = (fn: () => unknown): string => {
  try { fn() } catch (e) { if (e instanceof ActionBlocked) return e.message; throw e }
  return ''
}

/** 身上一件訂閱的義眼（欠 30）與一件契約的義臂（欠 50、持有者 f_corp）。 */
function locked() {
  const g = makeBodyGame().game
  expect(applyEffects(g, [{ kind: 'cyber_install', blueprint: 'bp_tw_eye', lock: { kind: 'subscription', owed: 30 } }]).errors).toEqual([])
  expect(applyEffects(g, [{ kind: 'cyber_install', blueprint: 'bp_tw_arm', side: 'l', lock: { kind: 'contract', holder: 'f_corp', owed: 50 } }]).errors).toEqual([])
  const [eye, arm] = cyberOf(g.state, 'pc')
  return { g, eye: eye!.uid, arm: arm!.uid }
}
/** 直接改身上幾件的欄位（off、lock）並提交。 */
function patchPieces(g: ReturnType<typeof makeBodyGame>['game'], fn: (p: Rec) => Rec) {
  const ext = structuredClone(g.state.actors.pc!.ext.cyber) as Rec
  ext.pieces = ext.pieces.map(fn)
  g.commit(sys([{ op: 'actor.ext', id: 'pc', key: 'cyber', value: ext }]))
}

describe('補繳（CYBERWARE 第 5 節「解鎖的方法：付清」；crack.ts 的 planPay）', () => {
  it('找不到角色、身上沒有這一件、這一件沒有授權鎖：各一句，第一條就是 payLockBlock', () => {
    const { g } = locked()
    expect(applyEffects(g, [{ kind: 'cyber_install', blueprint: 'bp_tw_plating' }]).errors).toEqual([])
    const plain = cyberOf(g.state, 'pc').find((p) => p.bp === 'bp_tw_plating')!.uid
    expect(payLockProblems(g.k, g.state, { actor: 'nobody', uid: 'x' })).toEqual(['找不到這個角色。'])
    expect(payLockBlock(g.k, g.state, { actor: 'pc', uid: 'nope' })).toBe('身上沒有這一件義體。')
    expect(payLockBlock(g.k, g.state, { actor: 'pc', uid: plain })).toBe('皮下裝甲 II沒有授權鎖。')
    expect(reasonOf(() => payLockDraft(g.k, g.state, { actor: 'pc', uid: plain }))).toBe('皮下裝甲 II沒有授權鎖。')
  })

  it('身上兩件都有鎖：補繳其中一件只動那一件，另一件的欠款與鎖原樣', () => {
    const { g, eye, arm } = locked()
    patchPieces(g, (p) => ({ ...p, off: { why: 'lock' } }))
    const cred = g.state.money.cred
    g.commit(payLockDraft(g.k, g.state, { actor: 'pc', uid: eye }))
    expect(g.state.money.cred).toBe(cred - 30)
    const after = Object.fromEntries(cyberOf(g.state, 'pc').map((p) => [p.uid, p]))
    expect(after[eye]!.off).toBeUndefined()
    expect((after[eye]!.lock as Rec).owed).toBe(0)
    expect(after[arm]!.off).toEqual({ why: 'lock' })
    expect((after[arm]!.lock as Rec)).toMatchObject({ kind: 'contract', holder: 'f_corp', owed: 50 })
  })

  it('壞掉（off.why 是 broken）又欠著錢的那一件：補繳只把帳清掉（「帳清了」），還是壞的（要另外修；repair.ts 第 6 行）', () => {
    const { g, eye } = locked()
    patchPieces(g, (p) => (p.uid === eye ? { ...p, off: { why: 'broken' } } : p))
    const [r] = g.commit(payLockDraft(g.k, g.state, { actor: 'pc', uid: eye }))
    expect(r!.outcome.summary).toMatch(/帳清了/)
    const piece = cyberOf(g.state, 'pc').find((p) => p.uid === eye)!
    expect(piece.off).toEqual({ why: 'broken' })
    expect((piece.lock as Rec).owed).toBe(0)
  })

  it('沒有被鎖住、只是欠著（事件裝上的時候就帶欠款）：補繳之後「帳清了」，鎖的紀錄留著（持有者不變）', () => {
    const { g, arm } = locked()
    const [r] = g.commit(payLockDraft(g.k, g.state, { actor: 'pc', uid: arm, pay: 'cash' }))
    expect(r!.outcome.summary).toMatch(/帳清了/)
    expect(g.state.money.cash).toBe(2000 - 50)
    expect(cyberOf(g.state, 'pc').find((p) => p.uid === arm)!.lock).toMatchObject({ kind: 'contract', holder: 'f_corp', owed: 0 })
  })
})

describe('破解的擋下（CYBERWARE 第 5 節「請改造師破解」；crack.ts 的 planCrack）', () => {
  it('找不到角色只回一句；動刀的人不存在：「找不到動刀的人。」而且不算報價', () => {
    const { g, eye } = locked()
    expect(crackProblems(g.k, g.state, { actor: 'nobody', uid: eye })).toEqual(['找不到這個角色。'])
    expect(crackProblems(g.k, g.state, { actor: 'pc', uid: eye, by: 'ghost' })).toEqual(['找不到動刀的人。'])
  })

  it('沒有鎖的紀錄、只是被鎖住（off.why 是 lock，例如契約事件用 cyber_lock 鎖的）：沒有授權鎖可以破解', () => {
    const { g } = locked()
    expect(applyEffects(g, [{ kind: 'cyber_install', blueprint: 'bp_tw_plating' }]).errors).toEqual([])
    const plain = cyberOf(g.state, 'pc').find((p) => p.bp === 'bp_tw_plating')!.uid
    patchPieces(g, (p) => (p.uid === plain ? { ...p, off: { why: 'lock' } } : p))
    expect(crackProblems(g.k, g.state, { actor: 'pc', uid: plain })).toEqual(['皮下裝甲 II沒有授權鎖可以破解。'])
    expect(payLockBlock(g.k, g.state, { actor: 'pc', uid: plain })).toBe('皮下裝甲 II沒有授權鎖。')
  })
})

describe('畫面讀的鎖（lockView）', () => {
  it('被鎖住但沒有鎖的紀錄：kind 是 null、weekly 與 owed 是 0、locked true；有期限的帶 until', () => {
    const { g } = locked()
    expect(applyEffects(g, [{ kind: 'cyber_install', blueprint: 'bp_tw_plating' }]).errors).toEqual([])
    const plain = cyberOf(g.state, 'pc').find((p) => p.bp === 'bp_tw_plating')!.uid
    const until = 3 * 1440 + 10 * 60 + 600
    patchPieces(g, (p) => (p.uid === plain ? { ...p, off: { why: 'lock', until } } : p))
    const row = lockView(g.k, g.state, 'pc').find((x) => x.uid === plain)!
    expect(row).toMatchObject({ kind: null, weekly: 0, owed: 0, locked: true, until })
    expect(row).not.toHaveProperty('holder')
  })

  it('訂閱的 weekly 沒寫照成品價 × subscription_rate；契約的 weekly 沒寫是 0；壞掉的那一件 locked 是 false', () => {
    const { g, eye, arm } = locked()
    patchPieces(g, (p) => (p.uid === arm ? { ...p, off: { why: 'broken' } } : p))
    const rows = Object.fromEntries(lockView(g.k, g.state, 'pc').map((x) => [x.uid, x]))
    expect(rows[eye]!.weekly).toBeGreaterThan(0)
    expect(rows[arm]).toMatchObject({ weekly: 0, locked: false, holder: 'f_corp' })
    expect(rows[arm]).not.toHaveProperty('until')
  })
})
