import type { ContentPack, Feature, GridKernel } from '@engine/src'
import { planArrive } from '@engine/src/features/world'
import { demoStart, legacyFacilityAt, blockIdOf, stationMarkerOf, worldContent } from './world'
import { transitContent } from './transit'
import { eventContent } from './events'
import { commissionContent } from './commission'
import { sceneContent } from './scene'
import { lifeContent } from './life'
import { DEMO_NPC_IDS, peopleContent } from './people'

/**
 * 示意世界包（dev/work/M2-plan.md 使用者定案第 5 項）：引擎不再匯入內容，畫面接上引擎之後城市是空的，
 * 所以介面把自己的假資料整理成一份內容包，開新局時由 stores/engine.ts 載入。**不放進 engine/data**；
 * 正式內容匯入時整包換掉。測試不用它（測試自帶最小假資料）。
 *
 * 格式：就是引擎的 ContentPack（區、街區與版面、設施、路線、事件與範圍），一種內容一個檔：
 *   world.ts 區、街區、版面、設施種類　　transit.ts 路線與計程車的規則　　events.ts 事件的範圍與事件
 *   commission.ts 中間人與委託的類型　　life.ts 商店與貨、打工、住處（M2-ui-life）　　market.ts 區的行情　　scene.ts 成人場景的體位、夜課技能、道具、標籤與兩場示範的場景
 * people.ts 固定 NPC（用 engine/data 已有的 id）、每區的生成規則與名字池、開局的名冊與候選人（M2-ui-people）。
 * 之後的介面工單往這裡加自己的檔。
 */
export const DEMO_PACK_ID = 'demo_world'

export function demoPack(): ContentPack {
  // 規則表（事件範圍 street 與 transit、計程車的規則 transit_rule……）和引擎的核心包（CORE_PACK）同一個 id 時，後載入的取代前面的
  // （內容種類的 overridable，dev/adr/0017）：示意包放在核心包後面，用自己的機率與公里數表
  // 同一種內容在好幾個檔裡有（物品：成人場景的道具與商店的貨）：把每個檔的接起來，不互相蓋掉
  const merged: Record<string, unknown[]> = {}
  for (const part of [worldContent(), transitContent(), eventContent(), commissionContent(), sceneContent(), lifeContent(), peopleContent()] as Array<Record<string, unknown[]>>) {
    for (const [kind, list] of Object.entries(part)) merged[kind] = [...(merged[kind] ?? []), ...list]
  }
  return { id: DEMO_PACK_ID, content: merged as unknown as ContentPack['content'] }
}

/**
 * 核心包去掉被示意包重寫的固定 NPC：engine/data 的 npc 只有 id 與名字，`npc` 不是規則表（同一個 id 不能載兩次），
 * 所以要用示意包時，載入的是這份去掉那幾筆的核心包，加上 demoPack()。順序：[demoCoreWithoutPeople(CORE_PACK), demoPack()]。
 */
export function demoCoreWithoutPeople(core: ContentPack): ContentPack {
  const content = { ...core.content } as Record<string, Array<{ id: string }>>
  content.npc = (content.npc ?? []).filter(n => !DEMO_NPC_IDS.includes(n.id))
  return { ...core, content: content as unknown as ContentPack['content'] }
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

export { demoPeopleChanges } from './people'
export { DEMO_SCENES, demoSceneChanges } from './scene'
export type { DemoScene } from './scene'
export { demoStart, legacyFacilityAt, blockIdOf, stationMarkerOf }
