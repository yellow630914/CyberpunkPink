import { it } from 'vitest'
import { NET_TREES_B } from '../fixtures/skills'

it('table', () => {
  const NAME: Record<string, string> = { done: '做了', approx: '近似', none: '寫不出來', wait: '等M5/M6' }
  for (const [k, t] of Object.entries(NET_TREES_B)) {
    const by: Record<string, string[]> = { done: [], approx: [], none: [], wait: [] }
    for (const n of t.notes) by[n.status]!.push(n.name + (n.text === '—' ? '(—)' : ''))
    const dash = t.notes.filter((n) => n.text === '—').length
    console.log(`${k}: 做了 ${by.done!.length}（含「—」${dash}）近似 ${by.approx!.length} 寫不出來 ${by.none!.length} 等 ${by.wait!.length}`)
    for (const s of ['done', 'approx', 'none', 'wait']) console.log(`  ${NAME[s]}：${by[s]!.join('、')}`)
  }
})
