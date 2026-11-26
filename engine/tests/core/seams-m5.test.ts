// M5 加在核心上的兩處小機制（工單 dev/work/M5-core-seams.md；設計 dev/adr/0020 第三節「直播不回退」、第十節）：
// 1. 活動的 deny：進行中時擋下外殼自己的動作（現在只有回退步數 'undo'）；Game.undoBlock 與 Game.undoSteps；
// 2. 家的地圖種類 HOME_MAP_KINDS／isHomeMapKind（不要求遭遇點）與格子的種類 furniture（家具：走不上去、看得穿；只出現在補丁裡）。
// 規格：MEDIA 1.2「直播中不能回退」；DOWNTIME 7.4 節；UI 1.1 節規則 3；dev/adr/0016 第一節（活動的登錄表）、dev/adr/0012、0018 第五節（地圖的種類怎麼分世界）。
// 內容一律用測試自帶的最小假資料；活動用 testkit 的玩具活動（TEST_ACTIVITY，沒有 deny，當對照）與這個檔自己定義的幾個（寫 deny 的）。

import { describe, expect, it } from 'vitest'
import type { ActivityDef, Change, Feature, ReportDraft, SheetDef, SpecialMapEntry } from '../../src'
import { CELL_TRAITS, DEFAULT_LEGEND, Game, HOME_MAP_KINDS, NET_LEGEND, SHELL_ACTS, Sheet, UNDO_STEPS, blankState, clone, createKernel, installFeature, isHomeMapKind, markersInLayout, sheetProblems, specialMapProblems } from '../../src'
import { allFeatures } from '../../src/features'
import { TEST_ACTIVITY, makeGame, observed, stateHash } from '../../src/testkit'

// ---------------------------------------------------------------------------------------------------------------------------------
// 共用：報告草稿與「由旗標決定進行中與否」的活動

const draft = (action: string, changes: Change[], summary = '記一筆。'): ReportDraft => ({
  kind: 'system', action, location: {}, party: [], timeline: [], changes, outcome: { result: 'ok', summary },
})
const note = (key = 'noted'): ReportDraft => draft('test.note', [{ op: 'flag', key, value: true }])
const start = (kind: string): ReportDraft => draft(`${kind}.start`, [{ op: 'flag', key: kind, value: true }], `${kind} 開始了。`)
const end = (kind: string): ReportDraft => draft(`${kind}.end`, [{ op: 'flag', key: kind, value: false }], `${kind} 結束了。`)

/** 一個由旗標（旗標名＝kind）決定進行中與否的活動；o 可以蓋掉任何欄位（deny、allow、reason……）。 */
function flagActivity(kind: string, order: number, o: Partial<ActivityDef> = {}): Feature {
  return {
    id: `flag_${kind}`,
    install: (k) => k.activity.define({
      kind, owner: `flag_${kind}`, order,
      active: (s) => (s.flags[kind] === true ? { id: `${kind}1`, label: kind } : null),
      allow: [`commit:${kind}.`, 'commit:test.', 'chain:', 'rewind:'],
      reason: (_s, doing) => (doing === 'undo' ? `${kind}進行中，不能回退。` : `${kind}進行中，先把它做完。`),
      ...o,
    }),
  }
}

/** 寫了 deny: ['undo'] 的玩具直播（直播不回退）。 */
const LIVE = flagActivity('livetoy', 40, { deny: ['undo'] })

// ---------------------------------------------------------------------------------------------------------------------------------

describe('活動的 deny：進行中時擋下外殼自己的動作（dev/adr/0020 第三節）', () => {
  it('SHELL_ACTS 現在只有 undo（封閉清單，之後要加再加）', () => {
    expect([...SHELL_ACTS]).toEqual(['undo'])
  })

  describe('define 時檢查清單', () => {
    const def = (deny: unknown): ActivityDef => ({ kind: 'dd', owner: 'dd_owner', order: 40, active: () => null, allow: [], reason: () => '', deny: deny as string[] })

    it('deny: ["nope"]（清單以外的字）丟錯，訊息寫出是哪個活動、哪個字；沒有登記進去，同一個 kind 之後還可以正常登記', () => {
      const k = createKernel()
      expect(() => k.activity.define(def(['nope']))).toThrow(/活動 dd（dd_owner）的 deny 只能寫外殼的動作（undo），拿到 "nope"/)
      expect(k.activity.get('dd')).toBeUndefined()
      expect(() => k.activity.define(def(['undo']))).not.toThrow()
      expect(k.activity.get('dd')!.deny).toEqual(['undo'])
    })

    it('一個對、一個錯也丟錯（兩個錯的都列出來）；不是陣列、陣列裡不是字串也丟錯', () => {
      const k = createKernel()
      expect(() => k.activity.define(def(['undo', 'nope']))).toThrow(/拿到 "nope"/)
      expect(() => k.activity.define(def(['x', 'y']))).toThrow(/拿到 "x"、"y"/)
      expect(() => k.activity.define(def('undo'))).toThrow(/要是外殼動作的陣列/)
      expect(() => k.activity.define(def([1]))).toThrow(/拿到 1/)
      expect(() => k.activity.define(def(null))).toThrow(/要是外殼動作的陣列/)
      expect(k.activity.get('dd')).toBeUndefined()
    })

    it('丟錯發生在任何登記之前：先對這個 kind 加的 allow 還留在待辦裡，之後登記得成時併得進去', () => {
      const k = createKernel()
      k.activity.allow('dd', 'late.', 'early')
      expect(() => k.activity.define(def(['nope']))).toThrow()
      k.activity.define(def(['undo']))
      expect(k.activity.get('dd')!.allow).toEqual(['late.'])
    })

    it('不寫、寫空陣列、寫 ["undo"]、重複寫都合格；存進去的是一份複製（外面改原本的陣列不影響）', () => {
      const k = createKernel()
      k.activity.define({ ...def(undefined), kind: 'a0' })
      k.activity.define({ ...def([]), kind: 'a1' })
      const mine = ['undo']
      k.activity.define({ ...def(mine), kind: 'a2' })
      k.activity.define({ ...def(['undo', 'undo']), kind: 'a3' })
      mine.push('nope')
      expect(k.activity.get('a0')!.deny).toBeUndefined()
      expect(k.activity.get('a1')!.deny).toEqual([])
      expect(k.activity.get('a2')!.deny).toEqual(['undo'])
      expect(k.activity.get('a3')!.deny).toEqual(['undo', 'undo'])
    })

    it('登記時的探針事件：寫了 deny 才帶 deny，沒寫的和以前逐欄相同', () => {
      const k = createKernel()
      k.probe.start()
      k.activity.define({ ...def(undefined), kind: 'plain' })
      k.activity.define({ ...def(['undo']), kind: 'denier' })
      const events = k.probe.stop().filter((e) => e.type === 'registry.register' && e.source === 'core/action/activity')
      expect(events.map((e) => e.data)).toEqual([
        { registry: 'activity', id: 'plain', owner: 'dd_owner' },
        { registry: 'activity', id: 'denier', owner: 'dd_owner', deny: ['undo'] },
      ])
    })
  })

  describe('寫了 deny: ["undo"] 的活動進行中：回退被擋、什麼都不動', () => {
    it('undoBlock 回它的原因、undoSteps 回 false（不論 n），狀態與回退的堆疊都沒變；之後 undoBlock 變回 null', async () => {
      const { game } = makeGame({ features: [LIVE] })
      const { violations } = await observed(game, () => {
        game.commit(note(), '記一筆')
        game.commit(start('livetoy'), '開播')
        expect(game.undo.size).toBe(2)
        expect(game.k.activity.active(game.state).map((a) => a.kind)).toEqual(['livetoy'])
        const frozen = clone(game.state)
        const labels = game.undo.labels()
        expect(game.undoBlock()).toBe('livetoy進行中，不能回退。')
        for (const n of [1, 2, 5, UNDO_STEPS + 1, 0, -1, 1.5]) expect(game.undoSteps(n), String(n)).toBe(false)
        expect(game.undoSteps()).toBe(false)
        expect(game.state).toEqual(frozen)
        expect(game.undo.size).toBe(2)
        expect(game.undo.labels()).toEqual(labels)
        // 活動結束（併進同一步、不另留回退）：不再被擋
        game.commit(end('livetoy'), { attach: true })
        expect(game.undoBlock()).toBeNull()
        expect(game.undo.size).toBe(2)
      })
      expect(violations).toEqual([])
    })

    it('活動結束之後 undoSteps 成功，回到的是開始之前那一步（被擋的期間堆疊原樣留著，一步都沒少）', () => {
      const { game } = makeGame({ features: [LIVE] })
      const h0 = stateHash(game.state)
      game.commit(note(), '記一筆')
      const hNoted = stateHash(game.state)
      game.commit(start('livetoy'), '開播')
      expect(game.undoSteps(1)).toBe(false)
      expect(game.undo.size).toBe(2)
      game.commit(end('livetoy'), { attach: true })
      expect(game.undoBlock()).toBeNull()
      // 開播那一步回退：回到開播之前（記一筆之後）
      expect(game.undoSteps(1)).toBe(true)
      expect(stateHash(game.state)).toBe(hNoted)
      expect(game.state.flags.livetoy).toBeUndefined()
      expect(game.undoSteps(1)).toBe(true)
      expect(stateHash(game.state)).toBe(h0)
      expect(game.undoSteps(1)).toBe(false)
    })

    it('收播獨立成一步（沒有併進前一步）：回退一次回到「收播之前」的狀態，那時活動又在進行中，所以再回退又被擋（M5-live 組收播的報告時要知道）', () => {
      const { game } = makeGame({ features: [LIVE] })
      game.commit(start('livetoy'), '開播')
      const hLive = stateHash(game.state)
      game.commit(end('livetoy'), '收播')
      expect(game.undoBlock()).toBeNull()
      expect(game.undo.size).toBe(2)
      expect(game.undoSteps(1)).toBe(true)
      expect(stateHash(game.state)).toBe(hLive)
      expect(game.undoBlock()).toBe('livetoy進行中，不能回退。')
      expect(game.undoSteps(1)).toBe(false)
      expect(game.undo.size).toBe(1)
    })

    it('被擋下的是外殼的回退，不是提交：進行中照樣提交得了（放行的白名單照舊），提交之後堆疊照常長', () => {
      const { game } = makeGame({ features: [LIVE] })
      game.commit(start('livetoy'), '開播')
      game.commit(note('a'), '第一件')
      game.commit(note('b'), '第二件')
      expect(game.undo.size).toBe(3)
      expect(game.undoSteps(1)).toBe(false)
      expect(game.undo.labels()).toEqual(['開播', '第一件', '第二件'])
    })

    it('回退堆疊滿了（5 步）的時候也一樣：被擋、一步不少、擠掉的最舊那步不會跑回來也不會再被擠', () => {
      const { game } = makeGame({ features: [LIVE] })
      for (let i = 0; i < UNDO_STEPS; i++) game.commit(note(`k${i}`), `第 ${i} 件`)
      const labels = game.undo.labels()
      expect(labels).toHaveLength(5)
      game.commit(start('livetoy'), '開播')
      const after = game.undo.labels()
      expect(after).toEqual([...labels.slice(1), '開播'])
      expect(game.undoSteps(5)).toBe(false)
      expect(game.undo.labels()).toEqual(after)
    })

    it('讀檔、回到快照（rewindToKind）、帶 rewind 的報告都不受 deny 管：各有自己的 doing', () => {
      const { game } = makeGame({ features: [LIVE] })
      // 進行中之前存一份檔、留一份快照
      game.commit(draft('test.entry', [{ op: 'snapshot.take', kind: 'entry', label: '入口' }, { op: 'flag', key: 'entered', value: true }]), '入口')
      const raw = game.save()
      game.commit(start('livetoy'), '開播')
      expect(game.undoBlock()).not.toBeNull()
      // 回到快照：照常成功（活動的放行清單有 rewind:），狀態回到入口那一刻、活動沒了、堆疊清掉
      expect(game.rewindToKind('entry', '回到入口')).toBeNull()
      expect(game.state.flags.livetoy).toBeUndefined()
      expect(game.undoBlock()).toBeNull()
      // 讀檔：活動進行中也讀得進來（存檔是活動開始前的）
      game.commit(start('livetoy'), '又開播')
      expect(game.undoBlock()).not.toBeNull()
      expect(game.load(raw)).toBeNull()
      expect(game.state.flags.livetoy).toBeUndefined()
      expect(game.undo.size).toBe(0)
      // 帶 rewind 的報告
      game.commit(draft('test.entry', [{ op: 'snapshot.take', kind: 'entry', label: '入口' }]), '入口')
      game.commit(start('livetoy'), '開播')
      const reports = game.commit({ ...draft('test.back', []), rewind: { kind: 'entry', summary: '撤退。' } }, { attach: true })
      expect(reports.length).toBeGreaterThan(0)
      expect(game.state.flags.livetoy).toBeUndefined()
    })

    it('重試與重擲最新一樓不受 deny 管：進行中做了一件事之後，重試、重擲照常，結果和沒有 deny 的對照局逐位元組相同；回退照樣被擋', async () => {
      const run = async (features: Feature[]) => {
        const { game } = makeGame({ features })
        game.commit(start('livetoy'), '開播')
        expect((await game.act({ kind: 'free', text: '我看看四周' })).status).toBe('applied')
        const actions = game.stepActions('roll')
        expect((await game.retryStep('judge')).status).toBe('applied')
        expect((await game.reroll('roll')).status).toBe('applied')
        return { game, actions }
      }
      const denied = await run([LIVE])
      const plain = await run([flagActivity('livetoy', 40)])
      expect(denied.actions).toEqual({ retry: null, useRules: '只有 AI 的步驟可以用規則代替。', reroll: null })
      expect(denied.actions).toEqual(plain.actions)
      expect(stateHash(denied.game.state)).toBe(stateHash(plain.game.state))
      // 重試與重擲不吃回退的步數：開播一步、做的那一件一步，共兩步
      expect(denied.game.undo.size).toBe(2)
      expect(denied.game.undoBlock()).not.toBeNull()
      expect(denied.game.undoSteps(1)).toBe(false)
      expect(denied.game.undo.size).toBe(2)
      expect(plain.game.undoSteps(1)).toBe(true)
    })
  })

  describe('沒有 deny 的活動：undoSteps 的結果和這張工單之前一樣', () => {
    it('玩具活動（TEST_ACTIVITY）進行中：undoBlock 是 null，回退照常（回到開始之前那一步）', () => {
      const { game } = makeGame({ features: [TEST_ACTIVITY] })
      const h0 = stateHash(game.state)
      game.commit(note(), '記一筆')
      const hNoted = stateHash(game.state)
      game.launch('toy', {}, { by: 'test' })
      expect(game.k.activity.active(game.state).map((a) => a.kind)).toEqual(['toy'])
      expect(game.k.activity.get('toy')!.deny).toBeUndefined()
      expect(game.undoBlock()).toBeNull()
      expect(game.undo.size).toBe(2)
      expect(game.undoSteps(1)).toBe(true)
      expect(stateHash(game.state)).toBe(hNoted)
      expect(game.undoSteps(1)).toBe(true)
      expect(stateHash(game.state)).toBe(h0)
      expect(game.undoBlock()).toBeNull()
    })

    it('寫了 deny: [] 的活動等於沒寫', () => {
      const { game } = makeGame({ features: [flagActivity('livetoy', 40, { deny: [] })] })
      game.commit(note(), '記一筆')
      game.commit(start('livetoy'), '開播')
      expect(game.undoBlock()).toBeNull()
      expect(game.undoSteps(1)).toBe(true)
    })

    it('什麼活動都沒有：和以前一樣——有步數就成功，沒有就 false，n 不是正整數是 false', () => {
      const { game } = makeGame()
      expect(game.undoBlock()).toBeNull()
      expect(game.undoSteps(1)).toBe(false)
      game.commit(note(), '記一筆')
      expect(game.undoSteps(0)).toBe(false)
      expect(game.undoSteps(1.5)).toBe(false)
      expect(game.undoSteps(2)).toBe(false)
      expect(game.undo.size).toBe(1)
      expect(game.undoSteps(1)).toBe(true)
      expect(game.undoSteps(1)).toBe(false)
    })

    it('寫了 deny 但現在沒有進行中的：不擋（只管進行中）', () => {
      const { game } = makeGame({ features: [LIVE] })
      game.commit(note(), '記一筆')
      expect(game.k.activity.active(game.state)).toEqual([])
      expect(game.undoBlock()).toBeNull()
      expect(game.undoSteps(1)).toBe(true)
    })

    it('現有的每一種活動都沒有寫 deny（只有直播之後可以寫）：完整的功能清單裝起來逐一看', () => {
      const game = new Game({ features: allFeatures(), strict: true })
      const kinds = game.k.activity.list()
      for (const k of ['battle', 'defeat', 'scene', 'event', 'scan', 'auction', 'netrun', 'retreat', 'ride', 'dive', 'commission']) expect(kinds.map((d) => d.kind), k).toContain(k)
      const ALLOWED = ['live']
      expect(kinds.filter((d) => d.deny !== undefined && !ALLOWED.includes(d.kind)).map((d) => d.kind)).toEqual([])
    })
  })

  describe('denied：照 order 找第一個進行中而且寫了這個動作的活動', () => {
    // 兩層都放行所有報告（這一組只看回退）：外層 order 90、內層 order 20（小的先問）
    const OUTER = (o: Partial<ActivityDef> = {}) => flagActivity('outer', 90, { allow: ['commit:'], reason: (_s, doing) => `外層進行中，不能做${doing}。`, ...o })
    const INNER = (o: Partial<ActivityDef> = {}) => flagActivity('inner', 20, { allow: ['commit:'], reason: (_s, doing) => `內層進行中，不能做${doing}。`, ...o })

    it('兩個活動都進行中、只有外層寫 deny：照樣被擋，原因是外層的', () => {
      const { game } = makeGame({ features: [INNER(), OUTER({ deny: ['undo'] })] })
      game.commit(note(), '記一筆')
      game.commit(start('outer'), '外層')
      game.commit(start('inner'), '內層')
      expect(game.k.activity.active(game.state).map((a) => a.kind)).toEqual(['inner', 'outer'])
      expect(game.undoBlock()).toBe('外層進行中，不能做undo。')
      expect(game.undoSteps(1)).toBe(false)
      expect(game.undo.size).toBe(3)
      // 內層先結束：外層還在，照樣被擋；外層也結束才放行
      game.commit(end('inner'), { attach: true })
      expect(game.undoBlock()).toBe('外層進行中，不能做undo。')
      game.commit(end('outer'), { attach: true })
      expect(game.undoBlock()).toBeNull()
      expect(game.undoSteps(1)).toBe(true)
    })

    it('只有內層寫 deny、外層沒寫：被擋，原因是內層的；內層結束之後外層（沒寫）不擋', () => {
      const { game } = makeGame({ features: [INNER({ deny: ['undo'] }), OUTER()] })
      game.commit(start('outer'), '外層')
      game.commit(start('inner'), '內層')
      expect(game.undoBlock()).toBe('內層進行中，不能做undo。')
      game.commit(end('inner'), { attach: true })
      expect(game.k.activity.active(game.state).map((a) => a.kind)).toEqual(['outer'])
      expect(game.undoBlock()).toBeNull()
    })

    it('兩個都寫：order 小的（內層）先問，原因是它的；登記的先後不影響', () => {
      for (const features of [[INNER({ deny: ['undo'] }), OUTER({ deny: ['undo'] })], [OUTER({ deny: ['undo'] }), INNER({ deny: ['undo'] })]]) {
        const { game } = makeGame({ features })
        game.commit(start('outer'), '外層')
        game.commit(start('inner'), '內層')
        expect(game.undoBlock()).toBe('內層進行中，不能做undo。')
      }
    })

    it('denied 的第二個參數是動作的名字，原因函式的 doing 拿到的就是它；表外的動作一律 null（沒有活動能把它寫進 deny）', () => {
      const { game } = makeGame({ features: [LIVE] })
      game.commit(start('livetoy'), '開播')
      expect(game.k.activity.denied(game.state, 'undo')).toBe('livetoy進行中，不能回退。')
      expect(game.k.activity.denied(game.state, 'nope')).toBeNull()
      expect(game.k.activity.denied(game.state, 'commit:test.note')).toBeNull()
      expect(game.k.activity.denied(game.state, '')).toBeNull()
    })

    it('不改狀態：呼叫前後狀態逐位元組相同', () => {
      const { game } = makeGame({ features: [LIVE] })
      game.commit(start('livetoy'), '開播')
      const before = stateHash(game.state)
      const copy = clone(game.state)
      game.k.activity.denied(game.state, 'undo')
      game.undoBlock()
      expect(stateHash(game.state)).toBe(before)
      expect(game.state).toEqual(copy)
    })
  })

  describe('deny 和放行的白名單是兩條線，互不影響', () => {
    const DOINGS = ['commit:test.note', 'commit:livetoy.step', 'commit:zzz.other', 'chain:a1', 'rewind:entry', 'grid.enter', 'grid.move', 'battle.start', 'event.start', 'livetoy.start', 'commit:live.start', 'commit:contract.choose']

    it('同一個活動有沒有寫 deny，blockOf 對每一種 doing 的回答逐一相同（原因也一樣）', () => {
      const withDeny = makeGame({ features: [flagActivity('livetoy', 40, { deny: ['undo'] })] }).game
      const without = makeGame({ features: [flagActivity('livetoy', 40)] }).game
      for (const g of [withDeny, without]) {
        g.k.activity.allow('livetoy', 'event.', 'x')
        g.k.activity.allow('livetoy', 'grid.', 'x', (_s, doing) => doing === 'grid.move')
        g.k.activity.allowEverywhere('commit:live.', 'live')
        g.k.activity.allowEverywhere('commit:contract.choose', 'contract', ['battle', 'defeat'])
        g.commit(start('livetoy'), '開播')
      }
      for (const doing of DOINGS) expect(withDeny.blockOf(doing), doing).toBe(without.blockOf(doing))
      // 抽幾條確認不是兩邊都全擋或全放
      expect(withDeny.blockOf('commit:test.note')).toBeNull()
      expect(withDeny.blockOf('commit:zzz.other')).toBe('livetoy進行中，先把它做完。')
      expect(withDeny.blockOf('grid.enter')).toBe('livetoy進行中，先把它做完。')
      expect(withDeny.blockOf('grid.move')).toBeNull()
      // 外殼的回退只有寫了 deny 的那邊被擋
      expect(withDeny.undoBlock()).not.toBeNull()
      expect(without.undoBlock()).toBeNull()
    })

    it('allowEverywhere 放行的前綴照樣放行、同時回退照樣被擋（allowEverywhere 在活動登記之前、之後加，都一樣）', () => {
      const before = createKernel()
      before.activity.allowEverywhere('commit:live.', 'live')
      installFeature(before, flagActivity('livetoy', 40, { deny: ['undo'] }))
      const after = createKernel()
      installFeature(after, flagActivity('livetoy', 40, { deny: ['undo'] }))
      after.activity.allowEverywhere('commit:live.', 'live')
      for (const k of [before, after]) {
        const s = blankState(1)
        s.flags.livetoy = true
        expect(k.activity.blockOf(s, 'commit:live.start'), '放行').toBeNull()
        expect(k.activity.blockOf(s, 'commit:live.settle'), '放行').toBeNull()
        expect(k.activity.blockOf(s, 'commit:zzz.other'), '沒放行的照樣擋').not.toBeNull()
        expect(k.activity.denied(s, 'undo'), '回退被擋').toBe('livetoy進行中，不能回退。')
        expect(k.activity.get('livetoy')!.allow).toContain('commit:live.')
      }
    })

    it('allowEverywhere 的例外（核心的戰鬥與戰敗只收自己的事）不因 deny 改變：寫 deny 的活動不是例外', () => {
      const { game } = makeGame({ features: [LIVE] })
      game.k.activity.allowEverywhere('commit:live.', 'live', ['battle', 'defeat'])
      expect(game.k.activity.get('battle')!.allow).not.toContain('commit:live.')
      expect(game.k.activity.get('defeat')!.allow).not.toContain('commit:live.')
      expect(game.k.activity.get('livetoy')!.allow).toContain('commit:live.')
    })
  })
})

// ---------------------------------------------------------------------------------------------------------------------------------
// 家的地圖種類與 furniture 格

/**
 * 一間小屋：左右兩個房間，中間一扇門（+），大門 E 在最左邊。
 *   x:0 1 2 3 4 5 6 7
 * y=1 # . . # . . . #
 * y=2 E . . + . . . #
 * y=3 # . . # . . . #
 * 房間（zones）：a 客廳（左）、b 臥室（右）。
 */
const HOME: SheetDef = {
  id: 'home1', name: '一樓的小屋', size: [8, 5],
  layout: ['########', '#..#...#', 'E..+...#', '#..#...#', '########'],
  zones: ['########', '#aa#bbb#', 'aaa+bbb#', '#aa#bbb#', '########'],
  zone_names: { a: '客廳', b: '臥室' },
  cells: [{ id: 'E1', at: [0, 2], mark: 'E', name: '大門' }],
}
const homeMap = (kind = 'home', sheets: SheetDef[] = [HOME]): SpecialMapEntry => ({ id: 'map_home', kind, size: [8, 5], sheets })
const problems = (e: SpecialMapEntry): string[] => specialMapProblems(e as unknown as Record<string, unknown>)

describe('家的地圖種類 HOME_MAP_KINDS（dev/adr/0020 第十節）', () => {
  it('HOME_MAP_KINDS 是 ["home"]；isHomeMapKind 只認這一種（和街區、網內的種類不撞）', () => {
    expect([...HOME_MAP_KINDS]).toEqual(['home'])
    expect(isHomeMapKind('home')).toBe(true)
    for (const kind of ['block', 'bridge', 'subnet', 'maze', 'wreck', 'deep', 'office_small', 'street', 'club', 'Home', '', undefined, null, 1, {}]) expect(isHomeMapKind(kind), String(kind)).toBe(false)
  })

  it('kind: "home" 的地圖沒有遭遇點可以載入（沒有問題、內容登錄表收）；有遭遇點也合格', () => {
    expect(HOME.spots).toBeUndefined()
    expect(problems(homeMap())).toEqual([])
    const withSpots: SheetDef = { ...HOME, layout: ['########', '#..#.1.#', 'E..+...#', '#..#2..#', '########'], spots: [{ id: '!1', at: [5, 1], cover: 'sparse' }, { id: '!2', at: [4, 3], cover: 'sparse' }] }
    expect(problems(homeMap('home', [withSpots]))).toEqual([])
    const { game } = makeGame({ content: [{ id: 'homes', content: { special_map: [homeMap()] } }] })
    expect(game.k.content.get('special_map', 'map_home')).toBeDefined()
  })

  it('kind: "office_small"（副本的模板）少遭遇點照舊被擋；內容登錄表載入時也丟錯', () => {
    expect(problems(homeMap('office_small')).join('\n')).toMatch(/至少要有 2 個遭遇點/)
    expect(() => makeGame({ content: [{ id: 'homes', content: { special_map: [homeMap('office_small')] } }] })).toThrow(/至少要有 2 個遭遇點/)
  })

  it('其餘的檢查照舊：入口認 E 或連接格、每格走得到、連接格走得上去、標記與版面對得上', () => {
    // 沒有入口也沒有連接格
    const noEntry: SheetDef = { ...HOME, layout: ['########', '#..#...#', '#..+...#', '#..#...#', '########'], cells: [] }
    expect(problems(homeMap('home', [noEntry])).join('\n')).toMatch(/沒有入口也沒有連接格/)
    // 只有連接格（二樓：樓梯上來就是入口）也行
    const stairs: SheetDef = { ...HOME, id: 'up1', name: '二樓', layout: ['########', '#..#...#', '>..+...#', '#..#...#', '########'], cells: [], links: [{ at: [[0, 2]], to: 'home1' }] }
    const ground: SheetDef = { ...HOME, layout: ['########', '#..#...#', 'E..+..<#', '#..#...#', '########'], links: [{ at: [[6, 2]], to: 'up1' }] }
    expect(problems(homeMap('home', [ground, stairs]))).toEqual([])
    // 有一格地板從入口走不到（門換成牆，右邊的房間被關在外面）
    const sealed: SheetDef = { ...HOME, layout: ['########', '#..#...#', 'E..#...#', '#..#...#', '########'] }
    expect(problems(homeMap('home', [sealed])).join('\n')).toMatch(/（floor）從入口走不到/)
    // 連接格站不上去
    const badLink: SheetDef = { ...HOME, links: [{ at: [[3, 1]], to: 'home1' }] }
    expect(problems(homeMap('home', [badLink])).join('\n')).toMatch(/連接格 3,1 走不上去/)
    // 版面上的 E 在 0,2，資料寫在別處
    const moved: SheetDef = { ...HOME, cells: [{ id: 'E1', at: [0, 3], mark: 'E', name: '大門' }] }
    expect(problems(homeMap('home', [moved])).join('\n')).toMatch(/E1/)
  })
})

describe('格子的種類 furniture（家具：走不上去、看得穿、只出現在補丁裡）', () => {
  /** 版面原本的格子上打一個 furniture 補丁（和 map.sheet 的 cells 同一個形狀）。 */
  const FURN = (...at: Array<[number, number]>): Record<string, { kind: string }> => Object.fromEntries(at.map(([x, y]) => [`${x},${y}`, { kind: 'furniture' }]))

  it('CELL_TRAITS.furniture：走不上去、看得穿、沒有標記、不是要條件的格子', () => {
    expect(CELL_TRAITS.furniture).toEqual({ walk: false, see: true })
  })

  it('不進任何圖例：預設圖例與網內的圖例都沒有它；它是唯一一種沒有圖例字元的格子（現有的格子種類性質一個都沒動）', () => {
    expect(Object.values(DEFAULT_LEGEND)).not.toContain('furniture')
    expect(Object.values(NET_LEGEND)).not.toContain('furniture')
    const drawable = new Set([...Object.values(DEFAULT_LEGEND), ...Object.values(NET_LEGEND)])
    expect(Object.keys(CELL_TRAITS).filter((kind) => !drawable.has(kind))).toEqual(['furniture'])
    // 抽幾種現有的確認沒變
    expect(CELL_TRAITS.wall).toEqual({ walk: false, see: false })
    expect(CELL_TRAITS.floor).toEqual({ walk: true, see: true })
    expect(CELL_TRAITS.cover).toEqual({ walk: false, see: false })
    expect(CELL_TRAITS.half_cover).toEqual({ walk: false, see: true })
    expect(CELL_TRAITS.door_locked).toEqual({ walk: false, see: false, locked: true })
    expect(CELL_TRAITS.facility).toEqual({ walk: true, see: true, mark: 'F' })
    expect(markersInLayout(HOME).map((m) => m.id)).toEqual(['E1'])
  })

  it('在一格地板上打 furniture 的補丁：walkable 是 false，拿掉補丁恢復原狀', () => {
    const plain = new Sheet(HOME)
    expect(plain.kindAt(5, 2)).toBe('floor')
    expect(plain.walkable(5, 2)).toBe(true)
    const furnished = new Sheet(HOME, FURN([5, 2]))
    expect(furnished.kindAt(5, 2)).toBe('furniture')
    expect(furnished.walkable(5, 2)).toBe(false)
    expect(furnished.traitsAt(5, 2)).toEqual({ walk: false, see: true })
    // 其他格子不受影響
    expect(furnished.walkable(4, 2)).toBe(true)
    expect(furnished.walkable(6, 2)).toBe(true)
    // 拿掉補丁（沒有補丁的實例）就是原來的版面
    const removed = new Sheet(HOME, {})
    expect(removed.kindAt(5, 2)).toBe('floor')
    expect(removed.walkable(5, 2)).toBe(true)
  })

  it('findPath 繞過它；整條路被擋死就走不到', () => {
    const from = { x: 4, y: 2 }, to = { x: 6, y: 2 }
    const straight = new Sheet(HOME).findPath(from, to)!
    expect(straight.map((p) => `${p.x},${p.y}`)).toEqual(['4,2', '5,2', '6,2'])
    const around = new Sheet(HOME, FURN([5, 2])).findPath(from, to)!
    expect(around).not.toBeNull()
    expect(around.map((p) => `${p.x},${p.y}`)).not.toContain('5,2')
    expect(around.length).toBe(5)
    expect(around[0]).toEqual(from)
    expect(around[around.length - 1]).toEqual(to)
    // 一整排堵住（x = 5 的三格）就過不去
    expect(new Sheet(HOME, FURN([5, 1], [5, 2], [5, 3])).findPath(from, to)).toBeNull()
    // 家具那一格本身不能當終點
    expect(new Sheet(HOME, FURN([5, 2])).findPath(from, { x: 5, y: 2 })).toBeNull()
  })

  it('reachable：被它堵死的房間（門口擺了家具）不包含；拿掉補丁之後回來', () => {
    const entry = { x: 0, y: 2 }
    const open = new Sheet(HOME).reachable(entry)
    expect(open.has('5,2')).toBe(true)
    const blocked = new Sheet(HOME, FURN([3, 2])).reachable(entry)
    for (const key of ['4,1', '4,2', '4,3', '5,2', '6,2', '6,3']) expect(blocked.has(key), key).toBe(false)
    expect(blocked.has('1,2')).toBe(true) // 客廳還在
    expect(blocked.has('3,2')).toBe(false) // 家具那一格本身也不算
    const restored = new Sheet(HOME, {}).reachable(entry)
    expect([...restored].sort()).toEqual([...open].sort())
  })

  it('visibleFrom 看得穿：看得到家具後面的格子（擋視線的 cover 作對照看不到）', () => {
    const from = { x: 4, y: 2 }
    const behind = '6,2'
    expect(new Sheet(HOME, FURN([5, 2])).visibleFrom(from, 3).has(behind)).toBe(true)
    expect(new Sheet(HOME, FURN([5, 2])).visibleFrom(from, 3).has('5,2')).toBe(true) // 家具本身也看得到
    expect(new Sheet(HOME, { '5,2': { kind: 'cover' } }).visibleFrom(from, 3).has(behind)).toBe(false)
    expect(new Sheet(HOME, { '5,2': { kind: 'wall' } }).visibleFrom(from, 3).has(behind)).toBe(false)
    // 視野的半徑照舊：半徑 1 看不到兩格以外
    expect(new Sheet(HOME, FURN([5, 2])).visibleFrom(from, 1).has(behind)).toBe(false)
  })

  it('版面的圖例寫 furniture 被 sheetProblems 擋下，訊息對；即使版面上沒用到那個字元也擋；specialMapProblems 一併帶出來', () => {
    const MSG = 'furniture 只能是擺上去的家具，不能畫在版面上。'
    const drawn: SheetDef = { ...HOME, legend: { f: 'furniture' }, layout: ['########', '#..#...#', 'E..+.f.#', '#..#...#', '########'] }
    const found = sheetProblems(drawn)
    expect(found).toHaveLength(1)
    expect(found[0]).toContain(MSG)
    expect(found[0]).toContain('"f"')
    expect(found[0]).toContain('sheets/home1')
    const unused: SheetDef = { ...HOME, legend: { f: 'furniture' } }
    expect(sheetProblems(unused).join('\n')).toContain(MSG)
    // 蓋掉預設的字元（把掩體 O 改成 furniture）也一樣
    const override: SheetDef = { ...HOME, legend: { O: 'furniture' } }
    expect(sheetProblems(override).join('\n')).toContain(MSG)
    expect(problems(homeMap('home', [drawn])).join('\n')).toContain(MSG)
    expect(() => makeGame({ content: [{ id: 'homes', content: { special_map: [homeMap('home', [drawn])] } }] })).toThrow(MSG)
    // 沒有寫 furniture 的合格
    expect(sheetProblems({ ...HOME, legend: { f: 'floor' } }, [], { minSpots: 0 })).toEqual([])
  })

  it('真的在狀態上走一遍：map.sheet 的補丁讓家具那一格走不過去（畫面問得到原因）、整個房間堵死就走不到；補丁拿掉（null）恢復', () => {
    const { game } = makeGame({ content: [{ id: 'homes', content: { special_map: [homeMap()] } }] })
    const id = game.enterMap('map_home')
    expect(game.state.maps.at).toMatchObject({ map: id, sheet: 'home1', x: 0, y: 2 })
    expect(game.gridView()!.moves.east).toBeNull()
    const furnish = (cells: Record<string, { kind: string } | null>) => game.commit(draft('test.furnish', [{ op: 'map.sheet', map: id, sheet: 'home1', cells } as Change]), '擺家具')
    // 大門旁邊擺一件：往東走不過去
    furnish({ '1,2': { kind: 'furniture' } })
    expect(game.state.maps.instances[id]!.sheets.home1!.cells['1,2']).toEqual({ kind: 'furniture' })
    expect(game.gridView()!.moves.east).toBe('那邊走不過去。')
    expect(game.gridMove('east')).toMatchObject({ status: 'refused', reason: '那邊走不過去。' })
    // 拿掉
    furnish({ '1,2': null })
    expect(game.gridView()!.moves.east).toBeNull()
    // 門口擺家具：右邊的房間走不到
    furnish({ '3,2': { kind: 'furniture' } })
    expect(game.gridMove([5, 2])).toMatchObject({ status: 'refused', reason: '走不到那裡。' })
    expect(game.gridMove([2, 2]).status).toBe('applied')
    furnish({ '3,2': null })
    expect(game.gridMove([5, 2]).status).toBe('applied')
    expect(game.state.maps.at).toMatchObject({ x: 5, y: 2 })
  })

  it('補丁跟著存檔走：存檔再讀檔，家具還在、還是走不上去', () => {
    const { game } = makeGame({ content: [{ id: 'homes', content: { special_map: [homeMap()] } }] })
    const id = game.enterMap('map_home')
    game.commit(draft('test.furnish', [{ op: 'map.sheet', map: id, sheet: 'home1', cells: { '1,2': { kind: 'furniture' } } } as Change]), '擺家具')
    const raw = game.save()
    const other = makeGame({ content: [{ id: 'homes', content: { special_map: [homeMap()] } }] }).game
    expect(other.load(raw)).toBeNull()
    expect(other.gridView()!.moves.east).toBe('那邊走不過去。')
    expect(stateHash(other.state)).toBe(stateHash(game.state))
  })
})
