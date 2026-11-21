import { describe, it, expect, beforeEach } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { packSave, unpackSave, rollbackKeeping, underageAt, snapshotUse, migrateSave, SAVE_VERSION, type Snapshot } from './save'
import { useHome } from '../stores/home'
import { useSubnet } from '../stores/subnet'
import { useGame } from '../stores/game'

describe('存檔的打包與讀回', () => {
  beforeEach(() => setActivePinia(createPinia()))
  it('整份狀態存了再讀回來一模一樣', () => {
    const g = useGame()
    g.money.acc = 1234
    g.learnSkill('gun:看我的！')
    g.addItem('it_57e531', 3)
    g.channel.subs = 999
    const raw = packSave(g.serialize(), g.saveMeta())
    const before = g.serialize()
    setActivePinia(createPinia())
    const g2 = useGame()
    expect(g2.money.acc).not.toBe(1234)
    const r = unpackSave<ReturnType<typeof g2.serialize>>(raw)
    expect(r.ok).toBe(true)
    if (r.ok) g2.hydrate(r.file.state)
    expect(g2.serialize()).toEqual(before)
    expect(g2.learned).toContain('gun:看我的！')
  })
  it('第一版的存檔照樣讀得回來', () => {
    const v1 = JSON.stringify({ day: 20, minutes: 600, money: { acc: 1, cash: 2, fav: 3 }, inventory: [], equip: {}, loc: { district: 'hive', block: '四號塔', pos: { x: 1, y: 2 }, facility: null }, npcs: {}, log: [] })
    const r = unpackSave(v1)
    expect(r.ok).toBe(true)
    // 讀進來時照 migrateSave 升到現在的版本：家園與子網補成 null（不動現在的）
    if (r.ok) { expect(r.file.version).toBe(4); expect((r.file.state as Record<string, unknown>).home).toBeNull() }
  })
  it('有低於 18 的年齡，整筆拒絕', () => {
    const bad = packSave({ npcs: { a: { age: 30 }, b: { age: 17 } } }, { label: '', day: 1, time: '', place: '', savedAt: '' })
    const r = unpackSave(bad)
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error).toContain('18')
    expect(underageAt({ x: [{ age: 16 }] })).toEqual(['x[0].age'])
  })
  it('格式不對、版本太新都讀不了', () => {
    expect(unpackSave('not json').ok).toBe(false)
    expect(unpackSave(JSON.stringify({ hello: 1 })).ok).toBe(false)
    expect(unpackSave(JSON.stringify({ format: 'cyberpunkpink-save', version: 99, state: {} })).ok).toBe(false)
  })
})

describe('回退（SERIES 第 6 節）', () => {
  it('換回快照，但紀錄、性經歷記錄與共同記憶留著', () => {
    const snap = { money: 100, log: ['舊'], sexRecord: { count: 1 }, npcs: { a: { memories: ['舊的記憶'], affinity: 10 } } }
    const now = { money: 5, log: ['新', '舊'], sexRecord: { count: 2 }, npcs: { a: { memories: ['新的記憶', '舊的記憶'], affinity: 30 } } }
    const out = rollbackKeeping(now, snap, '被收回了')
    expect(out.money).toBe(100)
    expect(out.npcs.a.affinity).toBe(10)
    expect(out.npcs.a.memories).toEqual(['新的記憶', '舊的記憶'])
    expect(out.sexRecord).toEqual({ count: 2 })
    expect(out.log).toEqual(['被收回了', '新', '舊'])
  })
  it('哪些快照能用：戰鬥重來、入口撤退、目前這個階段；更早的階段只留著', () => {
    const mk = (id: string, kind: Snapshot['kind']): Snapshot => ({ id, kind, label: id, at: '', state: '{}' })
    const list = [mk('e', '入口'), mk('s1', '階段'), mk('s2', '階段'), mk('f', '戰鬥')]
    expect(snapshotUse(list, list[3])).toEqual({ action: '重來這場戰鬥', reason: null })
    expect(snapshotUse(list, list[0]).action).toBe('撤退')
    expect(snapshotUse(list, list[2]).reason).toBeNull()
    expect(snapshotUse(list, list[1]).reason).toContain('已經過了')
  })
  it('遊戲裡的回退：狀態回去，紀錄多一行', () => {
    setActivePinia(createPinia())
    const g = useGame()
    const acc = g.money.acc
    const s = g.takeSnapshot('戰鬥', '戰鬥開打前')
    g.money.acc -= 500
    g.addLog({ prose: ['打輸了。'] })
    const n = g.log.length
    g.rollback(s.id)
    expect(g.money.acc).toBe(acc)
    expect(g.log.length).toBe(n + 1)
    expect(g.log[0].prose[0]).toContain('收回')
  })
})

describe('第 3 版：家園與子網跟著存檔與快照走', () => {
  beforeEach(() => setActivePinia(createPinia()))
  it('v2 的存檔升到現在（v4）：補上 home、subnet 與空的染色表', () => {
    const f = migrateSave({ format: 'cyberpunkpink-save', version: 2, meta: { label: '', day: 1, time: '', place: '', savedAt: '' }, state: { day: 3 } as Record<string, unknown> })
    expect(SAVE_VERSION).toBe(4)
    expect(f.version).toBe(4)
    expect(f.state).toMatchObject({ day: 3, home: null, subnet: null, dyes: {} })
  })
  it('家園的等級、家具與子網的追蹤度存了再讀回來', () => {
    const g = useGame(), h = useHome(), s = useSubnet()
    h.upgrade()
    h.addSafehouse('container')
    s.addTrace(20)
    s.stepTo({ x: 1, y: 0 })
    const raw = packSave(g.serialize(), g.saveMeta())
    setActivePinia(createPinia())
    const g2 = useGame(), h2 = useHome(), s2 = useSubnet()
    expect(h2.tier).toBe(1)
    const r = unpackSave<ReturnType<typeof g2.serialize>>(raw)
    if (r.ok) g2.hydrate(r.file.state)
    expect(h2.tier).toBe(2)
    expect(h2.safehouses).toEqual(['container'])
    expect(s2.trace).toBe(54)
    expect(s2.pos).toEqual({ x: 1, y: 0 })
    expect(s2.isExplored({ x: 0, y: 0 })).toBe(true)
  })
  it('委託副本的快照帶著子網：回退時追蹤度也回去', () => {
    const g = useGame(), s = useSubnet()
    const snap = g.takeSnapshot('階段', '階段開始時')
    s.addTrace(30)
    g.rollback(snap.id)
    expect(s.trace).toBe(34)
  })
})
