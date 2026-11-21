// 功能的總表：L6 的每個功能做完之後在這裡加一行。ui 的 store、冒煙測試與種子重播都從這裡拿整組功能。
// 這個檔是唯一可以同時 import 好幾個功能的地方（分層檢查把它算在外殼）；功能之間不可以互相 import，也不可以 import 這個檔。
//
// 加一個功能的寫法：
//   import { characterFeature } from './character'
//   export const FEATURES: Record<string, Feature> = { [characterFeature.id]: characterFeature, ... }
// 順序就是安裝的順序：被別人的掛鉤依賴的排前面。

import type { Feature } from '../core/kernel'
import { actionsFeature } from './actions'
import { characterFeature } from './character'
import { creationFeature } from './creation'
import { perksFeature } from './perks'

export const FEATURES: Record<string, Feature> = { [actionsFeature.id]: actionsFeature, [characterFeature.id]: characterFeature, [perksFeature.id]: perksFeature, [creationFeature.id]: creationFeature }

export function allFeatures(): Feature[] {
  return Object.values(FEATURES)
}
