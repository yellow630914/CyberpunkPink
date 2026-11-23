// L6 功能：探索的「這一格能做的事」與撬鎖、破門（SITES 12.5 節；COMMISSION_MAPS 1.5 節）。
//
// 每一種只留下狀態與報告：做過的標記記成 used、拿到的憑證進 ext.keys、帶走的人進 ext.carry、接管的區進 ext.controlled；
// 報告 grid.use 的時間軸有一拍標籤 mark:<標記>（做成了才有；沒做成的是 mark_fail:<標記>）。不知道這件事對哪個委託有什麼意義。

import type { Change, CheckRoll, GameState, GridCtx, GridKernel, GridUse, MarkerDef, ReportDraft, TimelineBeat } from '../../core'
import { ActionBlocked, DEGREE_NAME, clone, closeMap, gridHere, pointKey, rollCheck } from '../../core'
import type { Ext } from './ext'
import { dcBase, extChange, extOf, hasKey, isControlled, strList, zoneKey } from './ext'

export const OPEN_ALERT = { pick_fail: 5, break: 10 }

interface UseSpec { mark: string; id: string; name: string }
const USES: UseSpec[] = [
  { mark: 'T', id: 'take', name: '拿取／動手' },
  { mark: 'D', id: 'plug', name: '插上資料埠' },
  { mark: 'K', id: 'key', name: '拿走憑證' },
  { mark: 'C', id: 'seize', name: '接管控制區' },
  { mark: '$', id: 'open', name: '打開' },
  { mark: '&', id: 'carry', name: '帶走' },
  { mark: 'X', id: 'leave', name: '離開' },
]
const ATTR_OF: Record<string, string> = { mechanics: 'tech', athletics: 'body', interface: 'intellect' }

const usedAt = (state: GameState, at: { map: string; sheet: string }, x: number, y: number): boolean =>
  !!state.maps.instances[at.map]?.sheets[at.sheet]?.cells[pointKey(x, y)]?.used

/** 這個標記現在能做的事（畫面走到上面立刻列出來，按了才做）。 */
export function usesAt(_k: GridKernel, ctx: GridCtx, marker: MarkerDef): GridUse[] {
  const spec = USES.find((u) => u.mark === marker.mark)
  if (!spec) return []
  if (marker.mark === 'X') return [{ id: spec.id, name: spec.name, block: null }]
  return [{ id: spec.id, name: spec.name, block: usedAt(ctx.state, ctx.at, marker.at[0], marker.at[1]) ? `${marker.name}已經做過了。` : null }]
}

interface Rolled { roll: CheckRoll; skill: string; roller: string }

/** 擲一次檢定（誰擲：主角）。骰面從存檔的亂數導出：同一個狀態同一個用途一定一樣，報告裡的 rng 變更讓下一次換一顆。 */
function rollFor(k: GridKernel, state: GameState, skills: string[], dc: number, purpose: string, tags: string[]): Rolled {
  const roller = state.pc
  if (!roller || !state.actors[roller]) throw new ActionBlocked('還沒有主角。')
  let best: Rolled | undefined
  for (const skill of skills) {
    const attr = ((k.content.get('skill', skill)?.attr as string | undefined) ?? ATTR_OF[skill] ?? 'tech') as never
    const roll = rollCheck(k.stats, state, { actor: roller, attr, skill, dc, purpose, tags })
    // 幾種基本功都行時取合計最高的（同分取排前面的）
    if (!best || roll.total > best.roll.total) best = { roll, skill, roller }
  }
  return best!
}

const rollBeat = (r: Rolled, text: string, data: Record<string, unknown>): TimelineBeat => ({
  layer: 'meat', actor: r.roller, tag: 'grid.roll', roll: r.roll, data,
  text: `${text}：${DEGREE_NAME[r.roll.degree]}（骰 ${r.roll.natural}，合計 ${r.roll.total}，對 DC ${r.roll.dc}）`,
})
const passed = (r: Rolled): boolean => r.roll.degree === 'critical' || r.roll.degree === 'success'
const alertChange = (map: string, delta: number): Change => ({ op: 'meter', kind: 'alert', key: map, delta })
const rngChange: Change = { op: 'rng', advance: 1 }

/** 做這一格能做的事。不成立丟 ActionBlocked 或錯（原因寫成給玩家看的句子）。 */
export function useAt(k: GridKernel, state: GameState, id: string): ReportDraft {
  const spec = USES.find((u) => u.id === id)
  if (!spec) throw new Error(`這一格沒有「${id}」可以做。`)
  const here = gridHere(k, state)
  const marker = here?.sheet.markerAt(here.at.x, here.at.y)
  if (spec.mark === 'X') {
    if (!here || !marker || marker.mark !== 'X') throw new Error('這一格不是撤離點，不能離開。')
    return {
      kind: 'action', action: 'grid.leave', location: clone(state.location), party: [], timeline: [],
      changes: closeMap(state, here.instance.id),
      outcome: { result: 'left', summary: `你從${marker.name}離開。` },
    }
  }
  if (!here || !marker || marker.mark !== spec.mark) throw new Error(`這一格沒有「${spec.name}」可以做。`)
  if (usedAt(state, here.at, marker.at[0], marker.at[1])) throw new ActionBlocked(`${marker.name}已經做過了。`)

  const map = here.at.map
  const ext = clone(extOf(state, map)) as Ext
  const cell: Change = { op: 'map.sheet', map, sheet: here.at.sheet, cells: { [pointKey(marker.at[0], marker.at[1])]: { used: true } } }
  const timeline: TimelineBeat[] = []
  const changes: Change[] = []
  let ok = true
  let summary: string
  let next: Ext | null = null

  const dc = dcBase(ext)
  const purpose = `explore/use/${map}/${marker.id}`
  switch (spec.mark) {
    case 'T':
      summary = `你在${marker.name}動了手。`
      break
    case 'D':
      summary = `你把自己插上了${marker.name}。`
      break
    case 'K':
      next = { ...ext, keys: [...strList(ext.keys), marker.id] }
      summary = `你從${marker.name}拿到了憑證。`
      break
    case '&':
      next = { ...ext, carry: [...strList(ext.carry), marker.id] }
      summary = `你把人從${marker.name}帶走。`
      break
    case 'C': {
      const r = rollFor(k, state, ['mechanics', 'interface'], dc, purpose, ['explore', 'seize'])
      timeline.push(rollBeat(r, `接管${marker.name}`, { marker: marker.id, dc }))
      changes.push(rngChange)
      ok = passed(r)
      if (ok) {
        const control = (here.sheet.def.controls ?? []).find((c) => c.id === marker.id)
        const zones = control && Array.isArray(control.zones) ? control.zones : [here.sheet.zoneAt(marker.at[0], marker.at[1])].filter((z): z is string => z !== undefined)
        const have = strList(ext.controlled)
        next = { ...ext, controlled: [...have, ...zones.map((z) => zoneKey(here.at.sheet, z)).filter((z) => !have.includes(z))] }
      }
      summary = ok ? `你接管了${marker.name}，那幾區的監視器與門鎖都聽你的。` : `接管${marker.name}沒有成功。`
      break
    }
    default: {
      // $：打開（機械對 DC 基準 ＋ 2）
      const r = rollFor(k, state, ['mechanics'], dc + 2, purpose, ['explore', 'open'])
      timeline.push(rollBeat(r, `打開${marker.name}`, { marker: marker.id, dc: dc + 2 }))
      changes.push(rngChange)
      ok = passed(r)
      summary = ok ? `你打開了${marker.name}。` : `${marker.name}沒打開。`
    }
  }
  if (ok) {
    changes.push(cell)
    if (next) changes.push(extChange(map, next))
  }
  timeline.push({ layer: 'meat', ...(state.pc ? { actor: state.pc } : {}), text: summary, tag: ok ? `mark:${spec.mark}` : `mark_fail:${spec.mark}`, data: { marker: marker.id, at: [marker.at[0], marker.at[1]], use: spec.id, ok } })
  return {
    kind: 'action', action: 'grid.use', location: clone(state.location), ...(state.pc ? { actor: state.pc } : {}), party: [], timeline, changes,
    outcome: { result: ok ? 'done' : 'failed', summary },
  }
}

/**
 * 對身邊一格上鎖的門動手（SITES 12.5 節「門鎖」）：
 * pick 撬鎖：機械對 DC 基準，失敗警戒 +5；break 破門：運動對 DC 基準，不論成敗警戒 +10。成功門改成開的。
 * at 是那一格門的座標，要在身邊（上下左右）。已經有憑證或那一區被接管的門不必動手。
 */
export function unlock(k: GridKernel, state: GameState, at: [number, number], how: 'pick' | 'break'): ReportDraft {
  if (how !== 'pick' && how !== 'break') throw new ActionBlocked('只能撬鎖（pick）或破門（break）。')
  const here = gridHere(k, state)
  if (!here) throw new ActionBlocked('現在不在格子地圖上。')
  const [x, y] = at
  if (here.sheet.kindAt(x, y) !== 'door_locked') throw new ActionBlocked('那一格不是上鎖的門。')
  if (Math.abs(x - here.at.x) + Math.abs(y - here.at.y) !== 1) throw new ActionBlocked('要站在上鎖的門旁邊才能動手。')
  const map = here.at.map
  const ext = extOf(state, map)
  if (hasKey(ext) || isControlled(ext, here.at.sheet, here.sheet.zoneAt(x, y))) throw new ActionBlocked('你有憑證、或這一區已經接管了，門會直接放行，不必動手。')

  const dc = dcBase(ext)
  const pick = how === 'pick'
  const r = rollFor(k, state, [pick ? 'mechanics' : 'athletics'], dc, `explore/unlock/${map}/${x},${y}/${how}`, ['explore', how])
  const ok = passed(r)
  const raise = pick ? (ok ? 0 : OPEN_ALERT.pick_fail) : OPEN_ALERT.break
  const changes: Change[] = [rngChange]
  if (raise) changes.push(alertChange(map, raise))
  if (ok) changes.push({ op: 'map.sheet', map, sheet: here.at.sheet, cells: { [pointKey(x, y)]: { kind: 'door' } } })
  const name = pick ? '撬鎖' : '破門'
  const summary = `${name}${ok ? '成功，門開了' : '沒成功，門還鎖著'}${raise ? `，警戒 +${raise}` : ''}。`
  return {
    kind: 'action', action: 'grid.unlock', location: clone(state.location), ...(state.pc ? { actor: state.pc } : {}), party: [],
    timeline: [rollBeat(r, name, { at: [x, y], how, dc, ok }), { layer: 'meat', actor: r.roller, text: summary, tag: ok ? 'unlock' : 'unlock_fail', data: { at: [x, y], how, alert: raise } }],
    changes, outcome: { result: ok ? 'unlocked' : 'failed', summary },
  }
}
