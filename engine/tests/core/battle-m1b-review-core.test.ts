// 驗收測試：dev/work/M1b-review-core.md（M1b 審查與白箱的核心修正）。
// 規格：dev/adr/0015 與「實作補記（M1b-review-core）」；審查 dev/reviews/2026-11-23-M1b.md 的 E1、E3、S1、S6～S8、S10、S11；
// 白箱 dev/bugs/2026-11-23-W011、W012、W013 與 B015。
// 效果、掛點與規則表的狀態都是測試裡臨時註冊、自帶的最小假資料；不讀 engine/data 的內容類。

import { readdirSync, readFileSync, statSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import type { BattleEffectLast, BattleOverlayInit, Kernel } from '../../src'
import { BATTLE_EVENTS, LOSE_TURN, advance, beginTurn, clone, createKernel, noteAttack, poolName, setupBattle } from '../../src'
import { TEST_COMBAT, makeState, testWeapon } from '../../src/testkit'
import type { Arena } from '../helpers/battle'
import { TEST_STATUSES, arena, duel, foe, one } from '../helpers/battle'

/** 骰面：給的先出，之後都是 1。 */
const dice = (...v: number[]) => [...v, ...Array(80).fill(1)]
const SRC = { kind: 'ability', id: 'sk_x', name: '測試' } as const
const GUN = { ...testWeapon('pistol', 7), name: '炮', dice: 1 }
const load = (k: Kernel) => k.content.loadPack({ id: 'review_core', content: { battle_status: TEST_STATUSES } })
/** 數這個 run 擲了幾次骰（用來證明「沒有擲任何骰」）。 */
function counted(run: { roll(count: number, sides: number): number[] }): { n: number } {
  const seen = { n: 0 }
  const orig = run.roll.bind(run)
  run.roll = (c, s) => (seen.n++, orig(c, s))
  return seen
}
const tags = (run: { beats: Array<{ tag?: string }> }) => run.beats.map((b) => b.tag).filter(Boolean)
/** 一台敵方的砲塔（沒有操作者、有自己的武器）；耐久與護甲預設 1 與 0：一槍就倒。 */
const turret = (o: Partial<BattleOverlayInit> = {}): BattleOverlayInit => ({ side: 'foe', slot: 1, kind: 'turret', name: '砲塔', hp: { now: 1, max: 1 }, armor: 0, evade: 0, weapon: clone(GUN), ...o })
/** 我方的一台（有操作者 a1）。 */
const friendly = (o: Partial<BattleOverlayInit> = {}): BattleOverlayInit => ({ side: 'ally', slot: 2, owner: 'a1', kind: 'shield', name: '護盾機', hp: { now: 50, max: 50 }, armor: 0, evade: 0, ...o })
/** 兩對兩：a1 沒有護甲、生命 100，其餘照預設。 */
const two = () => duel([one({ armor: 0, evade: 0, hp: { now: 100, max: 100 } }), one({}, 2)], [foe(), foe()])

// ---------------------------------------------------------------------------------------------------------------------
describe('E1：替身（和人重疊的東西自己開火）在 attack.before 裡被打下來，這一擊不發生', () => {
  /** a2 在 attack.before 裡對開火的砲塔打回去（自然 20，一槍就倒）；只反應第一次。 */
  const withReaction = (seen: string[] = []) =>
    arena(two(), [TEST_COMBAT], (k) => {
      let done = false
      k.battle.on('attack.before', 'react', ({ run, attacker }) => {
        if (!attacker.ext.overlay || done) return
        done = true
        run.attack(run.unit('a2'), attacker, { natural: 20, spend: 0 })
      })
      k.battle.on('attack.after', 'spy', ({ target }) => { seen.push(`after:${target.name}`) })
    })

  it('探針：砲塔打 a1，a2 的反應把砲塔打下來 → 這一擊 aborted：不擲骰、a1 的生命不變、沒有 attack.after、沒有命中的那一拍', () => {
    const after: string[] = []
    const a = withReaction(after)
    const run = a.run(dice(6, 6, 6))
    const o = run.addOverlay(turret())
    const rolls = counted(run)
    const r = run.overlayAttack(o, a.ally(1), { natural: 20 })
    expect(o.down).toBe(true)
    expect(r).toMatchObject({ aborted: true, hit: false, dealt: 0, raw: 0 })
    expect(a.ally(1).hp!.now).toBe(100)
    // 反應自己擲了一顆傷害骰；被打下來的砲塔那一槍沒有再擲任何骰
    expect(rolls.n).toBe(1)
    expect(after).toEqual(['after:砲塔']) // 只有 a2 打砲塔的那一次，砲塔打 a1 的不發
    expect(run.beats.some((b) => b.text.includes('用炮射擊 你'))).toBe(false)
    expect(run.beats.some((b) => b.tag === 'wound')).toBe(false)
    expect(tags(run)).toContain('overlay.down')
  })

  it('砲塔打的是別的掛著的東西（attackOverlay 那一條路）：被反應打下來之後一樣沒有發生，目標的耐久不變', () => {
    const a = withReaction()
    const run = a.run(dice(6, 6, 6))
    const o = run.addOverlay(turret())
    const mine = run.addOverlay(friendly())
    const r = run.attack(run.standIn(o), run.standIn(mine), { natural: 20, spend: 0 })
    expect(o.down).toBe(true)
    expect(r).toMatchObject({ aborted: true, hit: false, dealt: 0 })
    expect(mine.hp.now).toBe(50)
  })

  it('對照：沒有人把它打下來，這一擊照常打完（命中、傷害、attack.after）', () => {
    const after: string[] = []
    const a = arena(two(), [TEST_COMBAT], (k) => k.battle.on('attack.after', 'spy', ({ target }) => { after.push(`after:${target.name}`) }))
    const run = a.run(dice(6, 6, 6))
    const o = run.addOverlay(turret())
    const r = run.overlayAttack(o, a.ally(1), { natural: 20 })
    expect(r).toMatchObject({ hit: true, track: 'hp' })
    expect(a.ally(1).hp!.now).toBeLessThan(100)
    expect(after).toEqual([`after:${a.ally(1).name}`])
  })

  it('反應「收走」砲塔（從 battle.overlays 拿掉）也一樣；真的單位被打倒的老規矩不變', () => {
    const a = arena(two(), [TEST_COMBAT], (k) => {
      k.battle.on('attack.before', 'react', ({ run, attacker }) => { if (attacker.ext.overlay) run.battle.overlays = [] })
    })
    const run = a.run(dice())
    const o = run.addOverlay(turret({ hp: { now: 30, max: 30 } }))
    expect(run.overlayAttack(o, a.ally(1), { natural: 20 })).toMatchObject({ aborted: true })
    expect(a.ally(1).hp!.now).toBe(100)
    // 真的單位：反應把他打倒，這一擊也沒有發生
    const b = arena(two(), [TEST_COMBAT], (k) => {
      k.battle.on('attack.before', 'react', ({ run, attacker }) => { if (attacker.id === 'f1') run.setOut(attacker, 'down') })
    })
    const r2 = b.run(dice())
    expect(r2.attack(b.foe(1), b.ally(1), { natural: 20, spend: 0 })).toMatchObject({ aborted: true })
    expect(b.ally(1).hp!.now).toBe(100)
  })

  it('run.gone：退出的人、被擊落或收走的替身是 true；還在場上的人、還掛著的替身、後方排隊的人是 false', () => {
    const a = arena(two())
    const run = a.run(dice())
    const o = run.addOverlay(turret({ hp: { now: 30, max: 30 } }))
    const s = run.standIn(o)
    expect(run.gone(a.ally(1))).toBe(false)
    expect(run.gone(s)).toBe(false)
    a.ally(2).slot = 0
    expect(run.gone(a.ally(2))).toBe(false) // 還在後方等，不算退出
    run.setOut(a.ally(1), 'fled')
    expect(run.gone(a.ally(1))).toBe(true)
    o.down = true
    expect(run.gone(s)).toBe(true)
    o.down = false
    expect(run.gone(s)).toBe(false)
    a.battle.overlays = []
    expect(run.gone(s)).toBe(true)
  })
})

// ---------------------------------------------------------------------------------------------------------------------
describe('W011、B015：失去回合的人，回合照樣開始與結束（turn.start、turn.end 帶 lost: true）', () => {
  const field = (extra?: (k: Kernel) => void): Arena => arena(duel([one(), one({}, 2)], [foe(), foe()]), [TEST_COMBAT], (k) => { load(k); extra?.(k) })

  it('失去回合：beginTurn 回傳 false、發 turn.skip，然後發 turn.start（lost: true）；這時他的失去回合狀態已經拿掉、battle.acting 沒有設', () => {
    const a = field()
    const seen: Array<Record<string, unknown>> = []
    a.k.battle.on('turn.start', 'spy', (p) => { seen.push({ unit: p.unit.id, ...('lost' in p ? { lost: p.lost } : {}), acting: p.run.battle.acting, hasLoseTurn: p.unit.statuses.some((s) => s.id === LOSE_TURN) }) })
    const run = a.run(dice())
    delete a.battle.acting // 兩個回合之間
    run.applyStatus(a.ally(1), LOSE_TURN, { force: true })
    expect(beginTurn(run, a.ally(1))).toBe(false)
    expect(seen).toEqual([{ unit: 'a1', lost: true, acting: undefined, hasLoseTurn: false }])
    expect(a.battle.acting).toBeUndefined()
    expect(tags(run)).toEqual(['turn.skip'])
    // 下一個回合動得了：照舊發 turn.start，沒有 lost 這個欄位，battle.acting 是他
    expect(beginTurn(run, a.ally(1))).toBe(true)
    expect(seen[1]).toEqual({ unit: 'a1', acting: 'a1', hasLoseTurn: false })
  })

  it('advance：失去回合的人也有 turn.end（lost: true）；順序是 上一個人的 turn.end → 他的 turn.start → 他的 turn.end → 下一個人的 turn.start', () => {
    const a = field()
    const log: string[] = []
    a.k.battle.on('turn.start', 'spy', ({ unit, lost }) => { log.push(`start:${unit.id}${lost ? ':lost' : ''}`) })
    a.k.battle.on('turn.end', 'spy', ({ unit, lost }) => { log.push(`end:${unit.id}${lost ? ':lost' : ''}`) })
    const run = a.run(dice())
    const [first, second, third] = a.battle.order as [string, string, string]
    a.battle.turn = 0
    run.applyStatus(a.battle.units[second]!, LOSE_TURN, { force: true })
    advance(run)
    expect(log).toEqual([`end:${first}`, `start:${second}:lost`, `end:${second}:lost`, `start:${third}`])
    expect(a.battle.order[a.battle.turn]).toBe(third)
  })

  it('核心的狀態與功能的計時同一刻數：turn.start 裡看得到 own_turn_start 的狀態已經到期、turn_end 的狀態在 turn.end 之前還在', () => {
    const a = field()
    const seen: string[] = []
    a.k.battle.on('turn.start', 'spy', ({ unit, lost }) => { if (lost) seen.push(`start:${unit.statuses.map((s) => s.id).join(',')}`) })
    a.k.battle.on('turn.end', 'spy', ({ unit, lost }) => { if (lost) seen.push(`end:${unit.statuses.map((s) => s.id).join(',')}`) })
    const run = a.run(dice())
    a.battle.turn = 0
    const me = a.battle.units[a.battle.order[1]!]!
    run.applyStatus(me, LOSE_TURN, { force: true })
    run.applyStatus(me, 'burning', { by: a.foe(1) })
    run.applyStatus(me, 'suppressed', { by: a.foe(1) })
    advance(run)
    // 燃燒的 own_turn_start 兩回合：這一次數一次，還在；壓制的 own_turn_end 在 turn.end 之後才數
    expect(seen).toEqual(['start:burning,suppressed', 'end:burning,suppressed'])
    expect(me.statuses.map((s) => s.id)).toEqual(['burning'])
  })

  it('開場第一個人就失去回合（setupBattle 走 beginTurn 再 advance）：turn.start 與 turn.end 同樣帶 lost: true', () => {
    const log: string[] = []
    const k = createKernel([TEST_COMBAT])
    k.content.load('battle_status', TEST_STATUSES)
    k.battle.on('unit.ready', 't', ({ unit }) => { if (unit.id === 'a1') { unit.initBonus = 99; unit.statuses.push({ id: LOSE_TURN, until: { at: 'turn_start', of: 'a1', turns: 1 } }) } })
    k.battle.on('turn.start', 'spy', ({ unit, lost }) => { log.push(`start:${unit.id}${lost ? ':lost' : ''}`) })
    k.battle.on('turn.end', 'spy', ({ unit, lost }) => { log.push(`end:${unit.id}${lost ? ':lost' : ''}`) })
    const run = setupBattle(k, makeState(), duel([one()], [foe()]))
    expect(run.battle.order[0]).toBe('a1')
    expect(log).toEqual(['start:a1:lost', 'end:a1:lost', 'start:f1'])
    expect(run.battle.acting).toBe('f1')
  })

  it('turn.start（lost）的處理函式讓他又過載：新的失去回合留到下一個回合，不會被這一次一起算掉', () => {
    const a = field((k) => k.battle.on('turn.start', 'over', ({ run, unit, lost }) => { if (lost && !unit.layers) run.addLoad(unit, 9999, undefined, { exact: true }) }))
    const run = a.run(dice())
    const me = a.ally(1)
    run.applyStatus(me, LOSE_TURN, { force: true })
    expect(beginTurn(run, me)).toBe(false)
    expect(me.layers).toBe(1)
    expect(me.statuses.map((s) => s.id)).toContain(LOSE_TURN)
    expect(beginTurn(run, me)).toBe(false) // 下一個回合又失去了
  })

  it('turn.start（lost）的處理函式讓他倒下：beginTurn 回傳 false、advance 不再對他發 turn.end', () => {
    const a = field((k) => k.battle.on('turn.start', 'kill', ({ run, unit, lost }) => { if (lost) run.setOut(unit, 'down') }))
    const ended: string[] = []
    a.k.battle.on('turn.end', 'spy', ({ unit }) => { ended.push(unit.id) })
    const run = a.run(dice())
    a.battle.turn = 0
    const first = a.battle.order[0]!
    const second = a.battle.order[1]!
    run.applyStatus(a.battle.units[second]!, LOSE_TURN, { force: true })
    advance(run)
    expect(a.battle.units[second]!.out).toBe('down')
    expect(ended).toEqual([first])
  })
})

// ---------------------------------------------------------------------------------------------------------------------
describe('W012：他再也沒有回合了：給別人的、算他的回合的狀態在他退出時結束', () => {
  const field = (extra?: (k: Kernel) => void): Arena => arena(duel([one(), one({}, 2)], [foe(), foe()]), [TEST_COMBAT], (k) => { load(k); extra?.(k) })

  it('source_turn_start、source_turn_end 的狀態：給的人退出（任何一種退出）時，別人身上的這兩種當場結束，記一拍「結束了」', () => {
    for (const how of ['down', 'subdued', 'surrendered', 'fled']) {
      const a = field()
      const run = a.run(dice())
      run.applyStatus(a.foe(1), 'marked', { by: a.ally(1) }) // source_turn_start
      run.applyStatus(a.foe(2), 'jammed', { by: a.ally(1), until: 'source_turn_end' })
      run.beats.length = 0
      expect(run.setOut(a.ally(1), how), how).toBe(true)
      expect(a.foe(1).statuses, how).toEqual([])
      expect(a.foe(2).statuses, how).toEqual([])
      expect(run.beats.filter((b) => b.tag === 'status.end').map((b) => b.data?.status), how).toEqual(['marked', 'jammed'])
    }
  })

  it('不相干的不動：別人給的 source 狀態、這個人自己身上的、別人身上算他「自己」回合的（own_turn_*）都留著', () => {
    const a = field()
    const run = a.run(dice())
    run.applyStatus(a.foe(1), 'marked', { by: a.ally(2) }) // a2 給的，a1 退出不相干
    run.applyStatus(a.foe(2), 'suppressed', { by: a.ally(1) }) // own_turn_end：算 f2 自己的回合
    run.applyStatus(a.ally(1), 'marked', { by: a.foe(1) }) // f1 給 a1 的：f1 的回合照常數
    run.setOut(a.ally(1), 'down', a.foe(1))
    expect(a.foe(1).statuses.map((s) => s.id)).toEqual(['marked'])
    expect(a.foe(2).statuses.map((s) => s.id)).toEqual(['suppressed'])
    expect(a.ally(1).statuses.map((s) => s.id)).toEqual(['marked'])
  })

  it('out 掛點發的時候，這些狀態已經拿掉了（功能在 out 裡接著收自己的計時，看到的是一致的狀態）', () => {
    const seen: string[][] = []
    const a = field((k) => k.battle.on('out', 'spy', ({ run }) => { seen.push(run.unit('f1').statuses.map((s) => s.id)) }))
    const run = a.run(dice())
    run.applyStatus(a.foe(1), 'marked', { by: a.ally(1) })
    run.setOut(a.ally(1), 'down')
    expect(seen).toEqual([[]])
  })

  it('他在自己的回合裡倒下：給別人的 source_turn_end 當場拿掉；advance 不對退出的人發 turn.end（只有還在場的人才發）', () => {
    const a = field()
    const ended: string[] = []
    a.k.battle.on('turn.end', 'spy', ({ unit }) => { ended.push(unit.id) })
    const run = a.run(dice(1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1))
    const me = a.battle.units[a.battle.order[0]!]!
    a.battle.turn = 0
    a.battle.acting = me.id
    const other = Object.values(a.battle.units).find((u) => u.side !== me.side)!
    run.applyStatus(other, 'jammed', { by: me, until: 'source_turn_end' })
    run.setOut(me, 'down')
    expect(other.statuses).toEqual([])
    advance(run)
    expect(ended).not.toContain(me.id)
    expect(a.battle.acting).not.toBe(me.id) // 他的回合結束了：acting 已經是下一個人
  })

  it('跟著退出的人一起走的只有 turn_start、turn_end 的狀態：battle_end 的（流血）、過載的標記不受影響', () => {
    const a = field()
    const run = a.run(dice())
    run.applyStatus(a.foe(1), 'bleeding', { by: a.ally(1) })
    run.applyStatus(a.foe(1), LOSE_TURN, { by: a.ally(1) })
    run.setOut(a.ally(1), 'down')
    expect(a.foe(1).statuses.map((s) => s.id).sort()).toEqual(['bleeding', LOSE_TURN].sort())
  })
})

// ---------------------------------------------------------------------------------------------------------------------
describe('W013：救回來：狀態與姿態清空，發 revive 掛點讓功能清自己記的限時的東西', () => {
  it('run.revive 發 revive：已經回到場上、生命給了、行動點 0、核心的狀態與姿態清空；救不起來的不發', () => {
    const seen: Array<Record<string, unknown>> = []
    const a = arena(two(), [TEST_COMBAT], (k) => {
      load(k)
      k.battle.on('revive', 'spy', ({ unit }) => { seen.push({ id: unit.id, out: unit.out, slot: unit.slot, hp: unit.hp!.now, ap: unit.ap.now, statuses: unit.statuses.length, stance: unit.stance }) })
    })
    const run = a.run(dice())
    const me = a.ally(1)
    me.stance = 'sk_fortress'
    run.applyStatus(me, 'bleeding', { by: a.foe(1) })
    run.setOut(me, 'down', a.foe(1))
    expect(run.revive(me, 5)).toBe(true)
    expect(seen).toEqual([{ id: 'a1', out: undefined, slot: expect.any(Number), hp: 5, ap: 0, statuses: 0, stance: undefined }])
    expect(seen[0]!.slot as number).toBeGreaterThanOrEqual(1)
    // 還站著的、昏過去（burnout）的救不起來：不發
    expect(run.revive(a.ally(2), 5)).toBe(false)
    run.setOut(a.ally(2), 'burnout')
    expect(run.revive(a.ally(2), 5)).toBe(false)
    expect(seen).toHaveLength(1)
  })
})

// ---------------------------------------------------------------------------------------------------------------------
describe('E3：BATTLE_EVENTS 補上 angel、tease、trait；戰鬥裡每一拍的標籤都在清單裡（不變式第 54 條）', () => {
  it('清單裡有這三個', () => {
    for (const t of ['angel', 'tease', 'trait']) expect(BATTLE_EVENTS, t).toContain(t)
    expect(new Set(BATTLE_EVENTS).size).toBe(BATTLE_EVENTS.length)
  })

  /** 掃 src 裡每一個 `.say(文字, '標籤', …)`：第二個參數裡的字串都要在 BATTLE_EVENTS 裡（寫成運算式的，裡面的每個字串都算）。 */
  function sayTags(source: string): string[] {
    const out: string[] = []
    let from = 0
    for (;;) {
      const at = source.indexOf('.say(', from)
      if (at < 0) break
      from = at + 5
      // 照最外層的逗號切開參數，略過字串、樣板字串（含 ${}）、括號
      const args: string[] = []
      let depth = 0, cur = '', i = from
      const quote = (q: string): void => {
        cur += source[i]!; i++
        while (i < source.length && source[i] !== q) {
          if (source[i] === '\\') { cur += source[i]!; i++ }
          if (q === '`' && source[i] === '$' && source[i + 1] === '{') {
            let d = 0
            do { if (source[i] === '{') d++; if (source[i] === '}') d--; cur += source[i]!; i++ } while (i < source.length && d > 0)
            continue
          }
          cur += source[i]!; i++
        }
        cur += source[i] ?? ''; i++
      }
      while (i < source.length) {
        const c = source[i]!
        if (c === '\'' || c === '"' || c === '`') { quote(c); continue }
        if (c === '(' || c === '[' || c === '{') depth++
        if (c === ')' || c === ']' || c === '}') {
          if (depth === 0) break
          depth--
        }
        if (c === ',' && depth === 0) { args.push(cur); cur = ''; i++; continue }
        cur += c; i++
      }
      args.push(cur)
      if (args.length >= 2) for (const m of args[1]!.matchAll(/'([^']*)'/g)) out.push(m[1]!)
    }
    return out
  }
  const walk = (dir: string): string[] => readdirSync(dir).flatMap((f) => (statSync(join(dir, f)).isDirectory() ? walk(join(dir, f)) : f.endsWith('.ts') ? [join(dir, f)] : []))

  it('掃原始碼：核心與功能裡每一個 run.say 的標籤都在 BATTLE_EVENTS 裡', () => {
    const root = fileURLToPath(new URL('../../src/', import.meta.url))
    const bad: string[] = []
    const found = new Set<string>()
    let n = 0
    for (const file of [...walk(join(root, 'core/battle')), ...walk(join(root, 'features'))]) {
      for (const t of sayTags(readFileSync(file, 'utf8'))) {
        n++
        found.add(t)
        if (!(BATTLE_EVENTS as readonly string[]).includes(t)) bad.push(`${file.slice(root.length)}：${t}`)
      }
    }
    expect(n).toBeGreaterThan(50) // 掃得到東西（不是整個沒掃到）
    expect([...found]).toEqual(expect.arrayContaining(['angel', 'tease', 'trait', 'overlay', 'turn.skip'])) // 補上的三個確實有人在用
    expect(bad).toEqual([])
  })
})

// ---------------------------------------------------------------------------------------------------------------------
describe('S1：效果的 stop 是「這一筆做完之後」：這一筆落在好幾個人身上，每個落點都做完才停', () => {
  it('落在三個敵人身上的一筆設了 stop：三個都做，後面的筆不做；沒有設的照常往下', () => {
    const a = arena(two(), [TEST_COMBAT])
    const log: string[] = []
    a.k.battle.effect('halt_if_first', 't', (ctx) => { log.push(`h:${ctx.unit!.id}`); if (ctx.unit!.id === 'f1') ctx.last.stop = true })
    a.k.battle.effect('mark', 't', (ctx) => { log.push(`m:${ctx.unit!.id}`) })
    const run = a.run(dice())
    const last = run.effects([{ op: 'halt_if_first', who: 'foes' }, { op: 'mark', who: 'self' }], { user: a.ally(1), source: SRC })
    expect(log).toEqual(['h:f1', 'h:f2'])
    expect(last.stop).toBe(true)
    log.length = 0
    run.effects([{ op: 'mark', who: 'foes' }, { op: 'mark', who: 'self' }], { user: a.ally(1), source: SRC })
    expect(log).toEqual(['m:f1', 'm:f2', 'm:a1'])
  })
})

// ---------------------------------------------------------------------------------------------------------------------
describe('S11：沒有發生的一擊，last.hit 是 undefined（noteAttack）：if: miss 不成立', () => {
  it('noteAttack：正常的結果照寫；aborted 的清掉上一筆留下的 hit、crit、downed，dealt 是 0，標 aborted；下一次正常的結果把 aborted 拿掉', () => {
    const last: BattleEffectLast = {}
    noteAttack(last, { hit: false, crit: false, downed: false, dealt: 0 })
    expect(last).toEqual({ hit: false, crit: false, downed: false, dealt: 0 })
    noteAttack(last, { hit: true, crit: true, downed: true, dealt: 9 })
    noteAttack(last, { hit: false, crit: false, downed: false, dealt: 0, aborted: true })
    expect(last).toEqual({ dealt: 0, aborted: true })
    expect('hit' in last).toBe(false)
    noteAttack(last, { hit: true, crit: false, downed: false, dealt: 4 })
    expect(last).toEqual({ hit: true, crit: false, downed: false, dealt: 4 })
  })

  it('串在一起：卡彈（被取消）的一擊之後，if: miss 與 if: hit 都不做；真的沒打中才算 miss', () => {
    const a = arena(two(), [TEST_COMBAT], (k) => {
      let cancel = true
      k.battle.on('attack.before', 'jam', ({ opts }) => { if (cancel) opts.cancel = '卡彈了。' })
      k.battle.effect('shoot', 't', (ctx, e) => {
        if (e.cancel === false) cancel = false
        const r = ctx.run.attack(ctx.user, ctx.unit!, { natural: e.natural as number, spend: 0 })
        noteAttack(ctx.last, r)
      })
    })
    const log: string[] = []
    a.k.battle.effect('after', 't', (_ctx, e) => { log.push(String(e.tag)) })
    const run = a.run(dice(1, 1, 1))
    const input = { user: a.ally(1), target: { unit: 'f1' }, source: SRC }
    // 被取消的一擊
    run.effects([{ op: 'shoot', natural: 20 }, { op: 'after', tag: 'miss', if: 'miss' }, { op: 'after', tag: 'hit', if: 'hit' }, { op: 'after', tag: 'fail?', if: 'fail' }], input)
    expect(log).toEqual([])
    // 取消解除：自然 1 一定失手 → miss 成立
    run.effects([{ op: 'shoot', natural: 1, cancel: false }, { op: 'after', tag: 'miss', if: 'miss' }, { op: 'after', tag: 'hit', if: 'hit' }], input)
    expect(log).toEqual(['miss'])
  })
})

// ---------------------------------------------------------------------------------------------------------------------
describe('S6：到下次過載（features 的 buff 用）：過載與餘韻疊滿的那一刻，核心都先發掛點', () => {
  it('一般過載發 overload（感載已經歸零、餘韻加了一層）；餘韻疊滿再過載先發 out.before（how: burnout）：有人擋下也發，擋下的那一次沒有 overload', () => {
    const log: string[] = []
    const a = arena(two(), [TEST_COMBAT], (k) => {
      load(k)
      k.battle.on('overload', 'spy', ({ unit }) => { log.push(`overload:${unit.id}:${unit.load!.now}:${unit.layers}`) })
      k.battle.on('out.before', 'spy', ({ unit, how, out }) => {
        log.push(`out.before:${unit.id}:${how}`)
        if (unit.id === 'a2') out.prevent = true
      })
    })
    const run = a.run(dice())
    run.addLoad(a.ally(1), 9999, undefined, { exact: true })
    expect(log).toEqual(['overload:a1:0:1'])
    log.length = 0
    // 餘韻疊滿（layersMax 層）之後再過載
    for (const id of ['a1', 'a2']) a.battle.units[id]!.layers = a.battle.units[id]!.layersMax
    a.ally(1).load!.now = 0
    run.addLoad(a.ally(1), 9999, undefined, { exact: true })
    run.addLoad(a.ally(2), 9999, undefined, { exact: true })
    expect(log).toEqual(['out.before:a1:burnout', 'out.before:a2:burnout'])
    expect(a.ally(1).out).toBe('burnout')
    expect(a.ally(2).out).toBeUndefined()
  })
})

// ---------------------------------------------------------------------------------------------------------------------
describe('S7、S10：核心的介面夠用：gainSink（沉溺）與 poolName（池的中文名）', () => {
  it('run.gainSink(unit, n, { by })：發 sink.before（帶 unit、amount、by）、被擋就不加、回傳實際加的；退出的人與替身加不上、不發掛點', () => {
    const seen: Array<Record<string, unknown>> = []
    const a = arena(two(), [TEST_COMBAT], (k) => k.battle.on('sink.before', 'spy', ({ unit, amount, by, out }) => { seen.push({ unit: unit.id, amount, by: by?.id }); if (unit.id === 'f2') out.block = true }))
    const run = a.run(dice())
    expect(run.gainSink(a.foe(1), 2, { by: a.ally(1) })).toBe(2)
    expect(a.foe(1).sink).toBe(2)
    expect(run.gainSink(a.foe(2), 1, { by: a.ally(1) })).toBe(0)
    expect(a.foe(2).sink).toBe(0)
    run.setOut(a.foe(1), 'down')
    expect(run.gainSink(a.foe(1), 1, { by: a.ally(1) })).toBe(0)
    const o = run.addOverlay(turret({ slot: 3 }))
    expect(run.gainSink(run.standIn(o), 1)).toBe(0)
    expect(seen).toEqual([{ unit: 'f1', amount: 2, by: 'a1' }, { unit: 'f2', amount: 1, by: 'a1' }])
  })

  it('poolName：行動點、RAM、現金、三種人情有中文名，沒列的池用自己的鍵（效果的紀錄用它，不要把鍵大寫）', () => {
    expect(['ap', 'ram', 'cash', 'favor_small', 'favor_mid', 'favor_big', 'drone_fuel'].map(poolName)).toEqual(['行動點', 'RAM', '現金', '小人情', '中人情', '大人情', 'drone_fuel'])
  })
})

// ---------------------------------------------------------------------------------------------------------------------
describe('S8：替身開火的取消後果（炸膛）：攻擊者是替身時，傷害要打在那一台上，不會憑空消失', () => {
  it('attack.cancel 拿到的攻擊者是替身，那一台還掛著：run.overlayOfStandIn + run.damageOverlay 打得到它；擊落時發 overlay.down；對替身直接 run.damage 照舊沒有效果', () => {
    const downs: string[] = []
    const a = arena(two(), [TEST_COMBAT], (k) => {
      k.battle.on('attack.before', 'jam', ({ attacker, opts }) => { if (attacker.ext.overlay) { opts.cancel = '砲塔炸膛了。'; opts.cancelData = { backfire: true } } })
      k.battle.on('attack.cancel', 'backfire', ({ run, attacker }) => {
        const o = run.overlayOfStandIn(attacker)
        expect(o).toBeDefined()
        expect(run.damage(attacker, 3, 'physical')).toEqual({ dealt: 0, track: 'none' }) // 舊的寫法：憑空消失
        run.damageOverlay(o!, 3, 'physical')
      })
      k.battle.on('overlay.down', 'spy', ({ overlay }) => { downs.push(overlay.name) })
    })
    const run = a.run(dice())
    const o = run.addOverlay(turret({ hp: { now: 5, max: 5 } }))
    const r = run.overlayAttack(o, a.ally(1), { natural: 20 })
    expect(r).toMatchObject({ aborted: true, cancelled: '砲塔炸膛了。' })
    expect(o.hp.now).toBe(2)
    expect(a.ally(1).hp!.now).toBe(a.ally(1).hp!.max)
    // 再一次：打到耐久歸零，擊落
    run.overlayAttack(o, a.ally(1), { natural: 20 })
    expect(o.down).toBe(true)
    expect(downs).toEqual(['砲塔'])
  })
})
