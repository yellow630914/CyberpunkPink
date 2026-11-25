// M3 修正批的介面跟改：委託夥伴有橋、內海面的 block、輔助結算多出留下的夥伴、每輪追蹤度減半的字。
import { describe, expect, it } from 'vitest'
import { auxLine } from '../../src/lib/commissionView'
import { disabledReason } from '../../src/lib/battleView'
import { beatText } from '../../src/lib/netView'
import { person } from '../commission/fixtures'
import { start, depart } from '../commission/netFixtures'

describe('M3 修正批：介面', () => {
  it('測試用的委託夥伴帶橋（actor.ext.bridge），內海階段才不會被留在現實', () => {
    expect(person('x', '人x').ext.bridge).toBeTruthy()
  })

  it('內海面的 block 逐字是引擎的原因（隊上沒有人有橋與甲板）', async () => {
    const { e } = start()
    // 把主角腦裡的甲板拆掉（甲板是腦部的義體）：全隊都沒有甲板，內海面選不了
    expect(e.commit({ summary: '拆甲板', changes: [{ op: 'actor.ext', id: e.state.pc!, key: 'cyber', value: { pieces: [] } }] as never })).toBeNull()
    await depart(e, 'of_net4')
    const net = e.commission.view()!.faces.find((f) => f.face === 'net')!
    expect(net.block).toContain('隊上沒有人有橋與甲板，進不了內海')
    const r = await e.commission.chooseFace('net')
    expect(r.reason).toBe(net.block)
  })

  it('輔助結算：在場的人不只擲骰的一位時，寫出全部在場的人', () => {
    const nameOf = (id: string) => `人${id}`
    const base = { stage: 1, face: 'meat', roller: 'a', skill: 'stealth', bonus: { skill: 0, path: 0, crowd: 0 }, roll: { natural: 10, total: 12, dc: 11, parts: [] }, outcome: 'success' }
    const one = auxLine({ ...base, people: ['a'] } as never, nameOf, (x) => x, (x) => x)
    const two = auxLine({ ...base, people: ['a', 'b'] } as never, nameOf, (x) => x, (x) => x)
    expect(one).not.toContain('在場')
    expect(two).toContain('（在場：人a、人b）')
  })

  it('閃斷中的行動灰掉：原因整句照引擎顯示，不截斷', () => {
    const why = '閃斷中：這個回合只能做不花 RAM 的事（換位、換構裝、回填）。'
    expect(disabledReason({ ok: false, blocks: [why], targets: [] })).toBe(why)
  })

  it('每輪追蹤度那一拍帶 data.halved：顯示「連動讓上升減半」，引擎已經寫了就不重複', () => {
    expect(beatText({ text: '追蹤度 +2（現在 10）。', tag: 'trace', data: { halved: true } })).toBe('追蹤度 +2（現在 10）。（連動讓上升減半）')
    expect(beatText({ text: '追蹤度 +2（連動讓上升減半，現在 10）。', tag: 'trace', data: { halved: true } })).toBe('追蹤度 +2（連動讓上升減半，現在 10）。')
    expect(beatText({ text: '追蹤度 +3。', tag: 'trace', data: {} })).toBe('追蹤度 +3。')
    expect(beatText({ text: '別的。', tag: 'hit', data: { halved: true } })).toBe('別的。')
  })
})
