import { describe, it, expect } from 'vitest'
import { AdultScene, rate, openingInit } from './scene'
import { DEMO_SCENES, TECHNIQUES } from './data'
import { seeded } from '../combat/rng'

const mk = (i = 0, seed = 1, opts = {}) => new AdultScene(DEMO_SCENES[i], seeded(seed), opts)

describe('成人場景：開場與連接', () => {
  it('開場的主動權＝50 ＋（對方的馴化 − 自己的）÷ 4 ＋ 性質', () => {
    expect(openingInit(DEMO_SCENES[0])).toBe(55)
    expect(openingInit({ ...DEMO_SCENES[0], nature: '工作' })).toBe(35)
  })
  it('沒有連接時主導、迎合、挑逗做不到；用技能建立連接', () => {
    const s = mk()
    expect(s.reason('lead')).toContain('還沒有連接')
    expect(s.techReason(TECHNIQUES[0], '右手', '胸')).toBeNull()
    s.technique('stroke', '右手', '胸')
    expect(s.links).toHaveLength(1)
    expect(s.reason('lead')).toBeNull()
  })
  it('一個部位同時只能有一條連接：同一個部位換事做、或換部位接同一個位置，舊的中斷', () => {
    const s = mk()
    s.ap.me = 5
    s.technique('stroke', '右手', '胸')
    s.technique('stroke', '右手', '前')
    expect(s.links.map(l => l.toPart)).toEqual(['前'])
    s.technique('kiss', '口', '胸')
    s.technique('stroke', '左手', '胸')
    expect(s.links.filter(l => l.toPart === '胸')).toHaveLength(1)
    expect(s.links.find(l => l.toPart === '胸')!.fromPart).toBe('左手')
  })
  it('體位碰不到的連接做不到；有標籤的技能要自己有那個標籤', () => {
    const s = mk()
    expect(s.techReason(TECHNIQUES.find(t => t.id === 'lick')!, '口', '後')).toContain('碰不到')
    expect(s.techReason(TECHNIQUES.find(t => t.id === 'whisper')!, '口', '口')).toContain('御姐')
  })
  it('內容篩選關掉拘束時，拘束的技能不出現', () => {
    expect(mk(0, 1, { filters: { filterRestraint: false } }).techniques().some(t => t.id === 'hold')).toBe(false)
  })
  it('切換體位要有主動權，會重置所有連接；不會的體位換不了', () => {
    const s = mk()
    s.technique('stroke', '右手', '胸')
    expect(s.posReason('ride')).toContain('還不會')
    s.switchPos('face')
    expect(s.pos.id).toBe('face')
    expect(s.links).toHaveLength(0)
    s.init = 40
    expect(s.posReason('behind')).toContain('主動權不在你手上')
  })
})

describe('成人場景：高潮、回合、結束', () => {
  it('過載就是高潮：感載歸零、疊一層餘韻、主動權照規則推', () => {
    const s = mk()
    s.them.load = s.them.loadMax - 1
    const init = s.init
    s.hurt('them', 10, 'me')
    expect(s.them.load).toBeLessThan(s.them.loadMax)
    expect(s.them.after).toBe(1)
    expect(s.init).toBe(init + 10)
  })
  it('你餘韻疊滿之後再高潮就失神，場景強制結束', () => {
    const s = mk()
    s.me.after = s.me.layers
    s.hurt('me', 999, 'them')
    expect(s.end?.reason).toBe('你失神了')
  })
  it('每回合連接自動生效一次；契合過了三回合還低於 10 就是對方不玩了', () => {
    const s = mk()
    s.technique('stroke', '右手', '胸')
    const fit = s.fit
    s.endTurn()
    expect(s.round).toBe(2)
    expect(s.fit).toBeGreaterThan(fit)
    const t = mk(0, 2)
    t.them.knows = []
    for (let i = 0; i < 4 && !t.end; i++) { t.fit = 0; t.links = []; t.endTurn() }
    expect(t.end?.reason).toBe('對方不玩了')
  })
  it('停下才出戰報：評價照契合分四級，第一次另加體悟；略過打七折', () => {
    expect(rate(10).rating).toBe('不合'); expect(rate(45).rating).toBe('普通'); expect(rate(70).rating).toBe('合拍'); expect(rate(90).rating).toBe('難忘')
    const s = mk()
    s.fit = 70
    s.stop()
    expect(s.end!.rating).toBe('合拍')
    expect(s.end!.insight).toBe(15 + 5 + 5)
    const k = mk(0, 3, { seen: { positions: ['side'] } })
    k.skip()
    expect(k.end!.reason).toBe('略過')
    expect(k.end!.insight).toBe(Math.round((rate(k.fit).insight + 5) * 0.7))
  })
  it('說話推進目的，一次最多 +20', () => {
    const s = mk()
    s.talk('三樓那位常客最近常來嗎？')
    expect(s.goal!).toBeGreaterThan(0)
    expect(s.goal!).toBeLessThanOrEqual(20)
  })
  it('整場打得完：照順序出手，直到停下或強制結束', () => {
    for (const seed of [1, 2, 3, 4]) {
      const s = mk(seed % 2, seed)
      for (let r = 0; r < 30 && !s.end; r++) {
        if (!s.links.length) s.technique('stroke', '右手', '胸')
        if (!s.reason('lead')) s.lead()
        s.endTurn()
      }
      if (!s.end) s.stop()
      expect(s.end).not.toBeNull()
      expect(s.lines.length).toBeGreaterThan(2)
    }
  })
})
