import type { ContentPack, Feature, GridKernel } from '@engine/src'
import { CORE_PACK } from '@engine/data'
import { planArrive } from '@engine/src/features/world'
import { demoStart, legacyFacilityAt, blockIdOf, stationMarkerOf, worldContent } from './world'
import { transitContent } from './transit'
import { eventContent } from './events'

/**
 * 示意世界包（dev/work/M2-plan.md 使用者定案第 5 項）：引擎不再匯入內容，畫面接上引擎之後城市是空的，
 * 所以介面把自己的假資料整理成一份內容包，開新局時由 stores/engine.ts 載入。**不放進 engine/data**；
 * 正式內容匯入時整包換掉。測試不用它（測試自帶最小假資料）。
 *
 * 格式：就是引擎的 ContentPack（區、街區與版面、設施、路線、事件與範圍），一種內容一個檔：
 *   world.ts 區、街區、版面、設施種類　　transit.ts 路線與計程車的規則　　events.ts 事件的範圍與事件
 * 之後的介面工單（商店、委託、人）往這裡加自己的檔。
 */
export const DEMO_PACK_ID = 'demo_world'

export function demoPack(): ContentPack {
  const all = { ...worldContent(), ...transitContent(), ...eventContent() } as Record<string, Array<{ id: string }>>
  // 引擎的規則表（CORE_PACK）已經有的 id（事件範圍、設施種類、計程車的規則……）以規則表為準：id 不能重複載入
  const core = CORE_PACK.content as Record<string, Array<{ id: string }>>
  const content = Object.fromEntries(Object.entries(all).map(([kind, list]) => [kind, Array.isArray(list) ? list.filter((e) => !core[kind]?.some((c) => c.id === e.id)) : list]))
  return { id: DEMO_PACK_ID, content: content as unknown as ContentPack['content'] }
}

/**
 * 開新局站在哪：四號塔的屋頂晾衣場。用 game.new 掛點給變更（開局那一份報告裡），不另外開一份「到了」的報告。
 * 這是介面端的小功能，只用引擎公開的 planArrive；測試不裝它。
 */
export function demoStartFeature(): Feature {
  return {
    id: 'demo_start',
    install(kernel) {
      const k = kernel as unknown as GridKernel
      k.hooks.on('game.new', 'demo_start', ({ state }) => {
        const start = demoStart()
        return planArrive(k, state, start.block, start.at).changes
      })
    },
  }
}

export { demoStart, legacyFacilityAt, blockIdOf, stationMarkerOf }
