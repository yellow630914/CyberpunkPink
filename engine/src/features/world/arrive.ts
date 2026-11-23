// L6 功能 world：到一塊街區。開（或沿用）那一塊的地圖實例、站到指定的標記、改 location。
// 同一塊街區的實例整局只有一份（記在 state.ext.world.instances），看過的格子留著；回到原來那一塊是同一份實例。

import type { Change, GameState, GridKernel, MarkerDef, ReportDraft, SheetDef } from '../../core'
import { SIGHT, Sheet, clone, openMap } from '../../core'
import type { BlockEntry } from './model'
import { OWNER, blockEntry, facilitiesOf, markerOf, sheetOfBlock, worldOf } from './model'

type Kx = GridKernel

export interface ArrivePlan {
  block: BlockEntry
  marker: MarkerDef
  changes: Change[]
}

/** 站的位置：指定的標記；沒指定是版面上第一個入口（E），都沒有就是第一個標記。 */
function pickMarker(block: BlockEntry, sheet: SheetDef, at: string | undefined): MarkerDef {
  const cells = sheet.cells ?? []
  if (at !== undefined) {
    const m = markerOf(sheet, at)
    if (!m) throw new Error(`${block.name}（${block.id}）的版面上沒有 ${at} 這個標記。`)
    return m
  }
  const m = cells.find((c) => c.mark === 'E') ?? cells[0]
  if (!m) throw new Error(`${block.name}（${block.id}）的版面上沒有可以站的標記。`)
  return m
}

/** 站到這一格之後看得到的格子，併進原本看過的。 */
function revealed(sheet: Sheet, seen: string[], at: { x: number; y: number }): string[] {
  const rows = (seen.length === sheet.h ? seen : sheet.def.layout.map((row) => '0'.repeat([...row].length))).map((r) => [...r])
  for (const key of sheet.visibleFrom(at, sheet.def.dark ? SIGHT.dark : SIGHT.lit)) {
    const [x, y] = key.split(',').map(Number) as [number, number]
    if (rows[y]?.[x] !== undefined) rows[y]![x] = '1'
  }
  return rows.map((r) => r.join(''))
}

/**
 * 到一塊街區要做的變更（純函式，不改狀態）：沒有實例就開一份（owner 是 world），有就沿用並把站的位置附近記成看過；
 * 接著 map.at、location、world.visit。state 是呼叫當下的狀態：一批效果裡好幾個 move 照順序套時，後面的看得到前面的結果。
 */
export function planArrive(k: Kx, state: GameState, blockId: string, at?: string): ArrivePlan {
  const block = blockEntry(k, blockId)
  if (!block) throw new Error(`沒有 ${blockId} 這塊街區。`)
  const found = sheetOfBlock(k, block)
  if (!found) throw new Error(`${block.name}（${block.id}）用的地圖 ${block.map} 找不到。`)
  const { sheet: def } = found
  const marker = pickMarker(block, def, at)
  const known = worldOf(state).instances[block.id]
  const existing = known ? state.maps.instances[known] : undefined
  const changes: Change[] = []
  if (existing) {
    const state0 = existing.sheets[def.id]
    const sheet = new Sheet(def, state0?.cells ?? {})
    if (!sheet.walkable(marker.at[0], marker.at[1])) throw new Error(`${block.id} 的 ${marker.id} 站不上去。`)
    changes.push(
      { op: 'map.sheet', map: existing.id, sheet: def.id, seen: revealed(sheet, state0?.seen ?? [], { x: marker.at[0], y: marker.at[1] }) },
      { op: 'map.at', to: { map: existing.id, sheet: def.id, x: marker.at[0], y: marker.at[1] } },
      { op: 'world.visit', block: block.id },
    )
  } else {
    const opened = openMap(k, state, block.map, { owner: OWNER, sheet: def.id, at: marker.id, ext: { block: block.id } })
    changes.push(...opened.changes, { op: 'world.visit', block: block.id, instance: opened.id })
  }
  const onFacility = marker.id in facilitiesOf(block)
  changes.push({ op: 'location', to: { district: block.district, block: block.id, ...(onFacility ? { facility: marker.id } : {}) } })
  return { block, marker, changes }
}

/**
 * 把人帶到一塊街區（報告 world.arrive）：開或沿用地圖實例、站到 at 這個標記（沒寫是第一個入口）、改 location。
 * 帶 enter_block 或（橋接區）enter_bridge 的觸發點，where 是 { district, block }。
 * 有活動擋著時（副本、事件視窗……）提交會被活動的白名單擋下，這裡不另外問。
 */
export function arrive(k: Kx, state: GameState, blockId: string, at?: string): ReportDraft {
  const { block, changes } = planArrive(k, state, blockId, at)
  return {
    kind: 'action', action: 'world.arrive', location: clone(state.location), ...(state.pc ? { actor: state.pc } : {}), party: [], timeline: [], changes,
    outcome: { result: 'arrived', summary: `到了${block.name}。` },
    triggers: [{ point: block.kind === 'bridge' ? 'enter_bridge' : 'enter_block', where: { district: block.district, block: block.id } }],
  }
}
