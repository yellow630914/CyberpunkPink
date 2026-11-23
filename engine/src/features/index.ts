// 功能的總表：L6 的每個功能做完之後在這裡加一行。ui 的 store、冒煙測試與種子重播都從這裡拿整組功能。
// 這個檔是唯一可以同時 import 好幾個功能的地方（分層檢查把它算在外殼）；功能之間不可以互相 import，也不可以 import 這個檔。
//
// 加一個功能的寫法：
//   import { characterFeature } from './character'
//   export const FEATURES: Record<string, Feature> = { [characterFeature.id]: characterFeature, ... }
// 順序就是安裝的順序：被別人的掛鉤依賴的排前面。

import type { Feature } from '../core/kernel'
import { abilitiesFeature } from './abilities'
import { actionsFeature } from './actions'
import { characterFeature } from './character'
import { combatFeature } from './combat'
import { creationFeature } from './creation'
import { defeatFeature } from './defeat'
import { directorFeature } from './director'
import { enemiesFeature } from './enemies'
import { favorsFeature } from './favors'
import { gearFeature } from './gear'
import { lewdFeature } from './lewd'
import { hackFeature } from './hack'
import { exploreFeature } from './explore'
import { perksFeature } from './perks'
import { summonsFeature } from './summons'
import { worldFeature } from './world'

export const FEATURES: Record<string, Feature> = { [actionsFeature.id]: actionsFeature, [characterFeature.id]: characterFeature, [perksFeature.id]: perksFeature, [creationFeature.id]: creationFeature, [combatFeature.id]: combatFeature, [gearFeature.id]: gearFeature, [enemiesFeature.id]: enemiesFeature, [defeatFeature.id]: defeatFeature, [exploreFeature.id]: exploreFeature, [summonsFeature.id]: summonsFeature, [abilitiesFeature.id]: abilitiesFeature, [hackFeature.id]: hackFeature, [favorsFeature.id]: favorsFeature, [worldFeature.id]: worldFeature, [directorFeature.id]: directorFeature, [lewdFeature.id]: lewdFeature }

export function allFeatures(): Feature[] {
  return Object.values(FEATURES)
}
