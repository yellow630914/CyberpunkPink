import type { ContentPack, Feature, GridKernel } from '@engine/src'
import { planArrive } from '@engine/src/features/world'
import { demoStart, legacyFacilityAt, blockIdOf, stationMarkerOf, worldContent } from './world'
import { transitContent } from './transit'
import { eventContent } from './events'
import { commissionContent, demoCommissionFeature } from './commission'
import { sceneContent } from './scene'
import { lifeContent } from './life'
import { peopleContent } from './people'
import { netContent } from './net'
import { bodyContent } from './body'
import { craftContent } from './craft'
import { creationContent } from './creation'
import { contractContent } from './contract'
import { curtainContent, CURTAIN_BLOCK, CURTAIN_DISTRICT } from './curtain'

/**
 * 示意世界包（dev/work/M2-plan.md 使用者定案第 5 項）：引擎不再匯入內容，畫面接上引擎之後城市是空的，
 * 所以介面把自己的假資料整理成一份內容包，開新局時由 stores/engine.ts 載入。**不放進 engine/data**；
 * 正式內容匯入時整包換掉。測試不用它（測試自帶最小假資料）。
 *
 * 格式：就是引擎的 ContentPack（區、街區與版面、設施、路線、事件與範圍），一種內容一個檔：
 *   world.ts 區、街區、版面、設施種類　　transit.ts 路線與計程車的規則　　events.ts 事件的範圍與事件
 *   commission.ts 中間人與委託的類型　　life.ts 商店與貨、打工、住處（M2-ui-life）　　market.ts 區的行情　　scene.ts 成人場景的體位、夜課技能、道具、標籤與兩場示範的場景
 * net.ts 甲板、構裝、SKIN、腳本與開局送的那一份（M3-ui-deck）。
 * people.ts 固定 NPC（用 engine/data 已有的 id）、每區的生成規則與名字池、開局的名冊與候選人（M2-ui-people）。
 * body.ts 義體（橋、七件義體與零件、怪癖）、藥、開局的身體（M4-ui-body）。
 * craft.ts 設計圖、零件、怪癖、授權書與三種做的地方（M4-ui-craft）。
 * creation.ts 生命軌跡的條目與傾向標籤、出身白給的（withDemoOrigins）、買得到的橋與衣服、建角第 6 與第 9 步的清單（M4-ui-creation）。
 * contract.ts 阿音、範圍 contract 的觸發點與幾件示意事件、「主角是持約人」的開局 demoHolderChanges（M4-contract-holder）；
 *   M4-ui-contract 補：「主角是契約人」的開局 demoBoundChanges、三件指令事件、流竄 AI 與兩件蠱惑事件、牠的吻、調校靜水與聚光、可以請教的老何。
 * curtain.ts 簾後館：簾口設施與去處、兩個夜（兩種文化）、雙形象的敵人與層主、三張表、落幕的戰敗事件（M4-ui-curtain）。
 * 之後的介面工單往這裡加自己的檔。
 */
export const DEMO_PACK_ID = 'demo_world'

export function demoPack(): ContentPack {
  // 規則表（事件範圍 street 與 transit、計程車的規則 transit_rule……）和引擎的核心包（CORE_PACK）同一個 id 時，後載入的取代前面的
  // （內容種類的 overridable，dev/adr/0017）：示意包放在核心包後面，用自己的機率與公里數表
  // 同一種內容在好幾個檔裡有（物品：成人場景的道具與商店的貨）：把每個檔的接起來，不互相蓋掉
  const merged: Record<string, unknown[]> = {}
  for (const part of [worldContent(), transitContent(), eventContent(), commissionContent(), sceneContent(), lifeContent(), peopleContent(), netContent(), bodyContent(), craftContent(), creationContent(), contractContent(), curtainContent()] as Array<Record<string, unknown[]>>) {
    for (const [kind, list] of Object.entries(part)) merged[kind] = [...(merged[kind] ?? []), ...list]
  }
  // 簾口的街區放在「地下層」底下（區的內容是整筆的，這裡把它的街區清單接上一塊）
  merged.district = (merged.district ?? []).map(d => ((d as { id?: string }).id === CURTAIN_DISTRICT ? { ...(d as object), blocks: [...(((d as { blocks?: string[] }).blocks) ?? []), CURTAIN_BLOCK] } : d))
  return { id: DEMO_PACK_ID, content: merged as unknown as ContentPack['content'] }
}

/**
 * 開新局站在哪：四號塔的屋頂晾衣場。用 game.new 掛點給變更（開局那一份報告裡），不另外開一份「到了」的報告。
 * 這是介面端的小功能，只用引擎公開的 planArrive；測試不裝它。
 */
export function demoStartFeature(): Feature {
  return {
    id: 'demo_start',
    install(kernel) {
      demoCommissionFeature().install(kernel)
      const k = kernel as unknown as GridKernel
      k.hooks.on('game.new', 'demo_start', ({ state }) => {
        const start = demoStart()
        return planArrive(k, state, start.block, start.at).changes
      })
    },
  }
}

export { demoPeopleChanges } from './people'
export { demoHolderChanges, demoBoundChanges, DEMO_HOLDER_NPC, DEMO_TEACHER_NPC, DEMO_AI, DEMO_STILL } from './contract'
export { demoNetChanges, DEMO_DECK, DEMO_DECK_UID, DEMO_SCRIPT } from './net'
export { demoBodyChanges, DEMO_START_SINK } from './body'
export { demoCraftChanges } from './craft'
export { withDemoOrigins, BRIDGE_LIST, CYBER_LIST, GEAR_LIST, SUGGESTED_KITS, CYBER_LOOK, GEAR_STYLE, DAILY_WEAR } from './creation'
export type { CyberLook } from './creation'
export { DEMO_SCENES, demoSceneChanges } from './scene'
export { CURTAIN_BLOCK, CURTAIN_SITE, CURTAIN_NIGHTS, CURTAIN_CULTURES } from './curtain'
export type { DemoScene } from './scene'
export { demoStart, legacyFacilityAt, blockIdOf, stationMarkerOf }
