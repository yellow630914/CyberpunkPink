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
import { billsFeature } from './bills'
import { combatFeature } from './combat'
import { commissionFeature } from './commission'
import { contractFeature } from './contract'
import { craftFeature } from './craft'
import { creationFeature } from './creation'
import { cyberwareFeature } from './cyberware'
import { deckFeature } from './deck'
import { defeatFeature } from './defeat'
import { directorFeature, eventRunFeature } from './director'
import { diveFeature } from './dive'
import { drugsFeature } from './drugs'
import { tuningFeature } from './tuning'
import { malwareFeature } from './malware'
import { enemiesFeature } from './enemies'
import { favorsFeature } from './favors'
import { fixerFeature } from './fixer'
import { gearFeature } from './gear'
import { lewdFeature } from './lewd'
import { lureFeature } from './lure'
import { mazeFeature } from './maze'
import { medicalFeature } from './medical'
import { netcombatFeature } from './netcombat'
import { nightclassFeature } from './nightclass'
import { netrunFeature } from './netrun'
import { hackFeature } from './hack'
import { exploreFeature } from './explore'
import { npcsFeature } from './npcs'
import { perksFeature } from './perks'
import { restFeature } from './rest'
import { rosterFeature } from './roster'
import { sceneFeature } from './scene'
import { securityFeature } from './security'
import { sinkFeature } from './sink'
import { summonsFeature } from './summons'
import { tradeFeature } from './trade'
import { transitFeature } from './transit'
import { workFeature } from './work'
import { worldFeature } from './world'

export const FEATURES: Record<string, Feature> = { [actionsFeature.id]: actionsFeature, [characterFeature.id]: characterFeature, [perksFeature.id]: perksFeature, [creationFeature.id]: creationFeature, [combatFeature.id]: combatFeature, [gearFeature.id]: gearFeature, [enemiesFeature.id]: enemiesFeature, [defeatFeature.id]: defeatFeature, [exploreFeature.id]: exploreFeature, [netrunFeature.id]: netrunFeature, [summonsFeature.id]: summonsFeature, [abilitiesFeature.id]: abilitiesFeature, [cyberwareFeature.id]: cyberwareFeature, [deckFeature.id]: deckFeature, [netcombatFeature.id]: netcombatFeature, [hackFeature.id]: hackFeature, [favorsFeature.id]: favorsFeature, [worldFeature.id]: worldFeature, [transitFeature.id]: transitFeature, [directorFeature.id]: directorFeature, [eventRunFeature.id]: eventRunFeature, [workFeature.id]: workFeature, [lewdFeature.id]: lewdFeature, [securityFeature.id]: securityFeature, [npcsFeature.id]: npcsFeature, [sinkFeature.id]: sinkFeature, [rosterFeature.id]: rosterFeature, [billsFeature.id]: billsFeature, [restFeature.id]: restFeature, [tradeFeature.id]: tradeFeature, [commissionFeature.id]: commissionFeature, [fixerFeature.id]: fixerFeature, [sceneFeature.id]: sceneFeature, [nightclassFeature.id]: nightclassFeature, [diveFeature.id]: diveFeature, [mazeFeature.id]: mazeFeature, [craftFeature.id]: craftFeature, [medicalFeature.id]: medicalFeature, [drugsFeature.id]: drugsFeature, [tuningFeature.id]: tuningFeature, [malwareFeature.id]: malwareFeature, [contractFeature.id]: contractFeature, [lureFeature.id]: lureFeature }

export function allFeatures(): Feature[] {
  return Object.values(FEATURES)
}
