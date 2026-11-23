// 測試基礎建設：量表（dev/test-harness.md 第 1 節；dev/adr/0016 第三節）。
//
// 核心自己不定義任何一種量表，所以下游功能的測試要用到敵對值、好感、警戒的時候，不必等管它們的功能做完，
// 用這裡的 testMeter 定義一個、meterFeature 裝上去（makeGame({ features: [meterFeature(...)] })），
// 勢力與人的鍵要查得到，另外載入 METER_CONTENT（假的兩個勢力與一個人；區的鍵要 district 這種內容，由測試自己定義或裝世界的功能）。

import type { ContentPack } from '../core/content/registry'
import type { Feature } from '../core/kernel'
import type { MeterDef } from '../core/state/meters'

/** 一個預設的量表定義：0～100、起始 0、不分對象、沒有上限的 cap。要改的欄位自己蓋。 */
export function testMeter(over: Partial<MeterDef> = {}): MeterDef {
  return { kind: 'mood', owner: 'test', name: '心情', min: 0, max: 100, start: 0, keyed: 'none', ...over }
}

/** 把給定的量表定義裝上去的功能（id 是 test-meters；一局只能裝一個）。 */
export function meterFeature(...defs: MeterDef[]): Feature {
  return { id: 'test-meters', install(k) { for (const d of defs) k.meters.define(d) } }
}

/** 假的內容：兩個勢力（f_alpha、f_beta）與一位具名的人（npc_ann），給 keyed 是 faction 或 npc 的量表查鍵用。 */
export const METER_CONTENT: ContentPack = {
  id: 'test-meter-content',
  content: {
    faction: [
      { id: 'f_alpha', name: '阿爾法公司', short: '阿爾法', class: 'corp' },
      { id: 'f_beta', name: '貝塔幫', short: '貝塔', class: 'street' },
    ],
    npc: [{ id: 'npc_ann', name: '安' }],
  },
}
