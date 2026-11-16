# 03 地圖・事件・委託・NPC・隊伍 掃描報告（ElondiaRPG → 賽博龐克新專案）

範圍：`src/engine` 下 43 個模組（約 13,900 行）。唯讀掃描，未改動 repo、未執行測試。
路徑省略前綴 `/home/user/yellow630914/elondiarpg/`。

## 0. 先講結論

1. **執行期真正乾淨的只有 `rng.ts`、`money.ts`、`content.ts`、`world.ts`＋`data.ts`**。`data.ts`（2,706 行）對 engine 只有 `import type`，是執行期的葉節點，但它一次匯入 33 個 JSON；`world.ts` 只依賴 `data.ts`。deps.json 把 type-only import 也算成邊，所以圖上看起來全在同一個循環裡。
2. **`grid.ts`（1,797 行）是本區的糾結中心**：直接匯入 33 個模組、被 59 個 engine 模組匯入。它同時是：格子型別、固定地圖載入、三種隨機生成器、移動與尋路、進格結算（戰鬥／陷阱／採集／寶箱／開鎖）、城門／近郊／樓層切換、戰後與戰敗處置。
3. **地圖資料格式（字元網格 + legend + connections）與 `Area/Cell/Position` 模型幾乎可以直接沿用**，很適合「8 區固定地圖直接相連」。要丟掉的是世界形狀：多城鎮、路線圖、旅途單行道、近郊、地下城五層。
4. **NPC 名單／每日位置／人際記憶的演算法可用**，但全部綁在 `level / class / race / region / dungeon` 上，需要改規則而不是改架構。
5. **回合管線（移動之後依序觸發什麼）寫在 `src/stores/game.ts`，不在 engine**，移植時最容易漏。

## 1. 各子系統

| 子系統 | 檔案與入口 | 怎麼運作 | 讀的資料 | 依賴 |
|---|---|---|---|---|
| 格子地圖引擎 | `grid.ts`：`Area`/`Cell`/`CellKind`/`Position`、`getArea`、`currentArea`/`currentCell`、`placeAt`、`move`、`blockedMove`、`crossLink`、`pathTo`、`reveal`/`isRevealed`、`enterLocation` | 區域 key 決定來源：`<地點>/<區塊>` 由 `buildBlock` 即時建立並快取（`baseBlock`）；`sm/` 特殊地圖、`<地點>/L<n>`、`<地點>/outskirts`、`side/`、`road` 存在 `state.areas`；`home/` 存在房子資料。`move` → 扣時間 → `burnStep` → `reveal` → `enterCell`（私有）。`link` 格要玩家主動 `crossLink` 才換區。 | `data/world/maps.json`（legend、maps、templates、template_by_type、generation、lighting、expedition） | data、state、light、specialMaps、landmarks、homes、security（`zoneEntryBlock`、`gateCheck`）、combat、story、intel、leads、park、road、slavery、masterHome、population… |
| 城鎮固定地圖 | `grid.ts`：`blocksFor`、`buildBlock`、`settlementBlocks`、`zonesOf`、`settlementArea`、`tavernSpot`、`setCellOverrides`、`invalidateBlocks` | 每個地點 2～5 個 `BlockDef`（字元網格），數字字元 1–9 是區塊間通道（`links`），兩端用同一個數字配對。沒有專屬地圖的地點用 `templates[template_by_type[type]]`。之後依序疊：商店覆蓋 → 地標 → 待售空地（`overlayLots`）→ 特殊地圖通道（`overlayConnections`）→ 隱藏地標（`hideLandmarks`）。 | maps.json 的 `maps`（14 座城）、`templates`（4 種） | data（landmarks、shopRules）、homes、specialMaps、storyFlags |
| 隨機生成器 | `grid.ts`：`generateOutskirts`、`generateLayer`、`generateSide`、`generateSpecial`；私有 `randomCells`、`ensureConnected`、`farthest`、`chestLock` | 近郊：障礙機率撒牆 + `ensureConnected`。地下城層／臨時地圖／隨機特殊地圖：從底邊中央隨機漫步挖通道（偏向往上），入口旁安全房、最遠格放階梯或層主，再撒遭遇／強敵／陷阱／資源／寶箱。之後 `ensureQuestTargets`、`ensureStoryMarkers`、`ensureIntelPoints`。 | maps.json `generation`；`enemies.json` 的 `encounters`（經 data 的 `dungeonEncounters`/`wildEncounters`）；`travel_events.json` 的 `side_maps` | data、rng、materialQuests、story、intel、park、light |
| 特殊地圖 | `specialMaps.ts`：`specialArea`、`endpointsIn`、`overlayConnections`、`enterSpecial`、`leaveSpecial`、`onAreaChange`、`closeOut`、`specialDefeat`、`pruneSpecialMaps`；`grid.ts`：`generateSpecial`、`specialVersion`、`specialTable` | 手工 `grid` 或 `size` 隨機；`connections` 讓 at 格與另一張圖的 to 格互通，`requires` 旗標成立時兩端變 `link`。`refresh` 的地圖離開後作廢重生；其他永久存檔。定義改了靠 `specialVersion` 雜湊重生。`state.special` 記回程位置。 | `data/world/special_maps.json` | grid（雙向循環）、road（`leaveSide`）、state、storyFlags、data |
| 地標 | `landmarks.ts`：`landmarkHere`、`enterLandmark`、`visitLandmark`、`setupExplore`/`applyExplore`、`sceneShown`、`scenesHere`、`playLandmarkScene`；`grid.ts`：`landmarkHidden`、`placeLandmarks` | 地標是一個格子，格子種類就是地標 id（`lm_`）。功能：開放條件、參訪（付錢／時間換效果）、探索（檢定）、固定場景（含登場角色）、內部（一張 peaceful 特殊地圖）。打工走 `work.ts`。 | `data/world/landmarks.json`（122 個、10 種類型） | grid、specialMaps、effects、npcs、town、trade、security、lewd、brood、lactation、pregMarks（成人向耦合重） |
| 地點間旅行 | `world.ts`：`rebuildRoutes`、`shortestPath`、`reachable`；`travel.ts`：`arrive`、`legFare`、`rollLegDays`、`daysToHours`、`EVENTS`；`road.ts`：`startJourney`、`roadMove`、`finishJourney`、`enterSide`/`leaveSide`、`applyPendingMove`、`queueMove` | `geography.json` 的 `routes` 建鄰接表，Dijkstra 以最少天數計；地下城不能穿越。出發時 `buildRoad` 把路程畫成寬 N 高 1 的 `road` 區域，一格一天，事件出發時就擲好。抵達呼叫 `arrive`（建名單、盤查、歸隊）。 | `data/world/geography.json`（62 地點、65 路線）、`data/rules/travel_events.json` | grid、security、population、companions、masterHome、story、slavery、trade |
| 遭遇 | `encounters.ts`：`checkHostiles`、`avoidFoes`、`revealSelf`、`fightFoes`、`payToll`、`setupStandoff`/`applyStandoff`；格子上的怪物遭遇在 `grid.ts` 的 `enterCell` → `combat.startCombat` | `encounters.ts` 只管「敵對的冒險者 NPC」：進入視野時潛行對抗察覺，進入 `state.standoff`，再選避開／偷襲／蒙混／威嚇／付錢／開戰。怪物遭遇是 `Cell.group`（`EncounterGroup = [怪物id, 數量][]`）。 | `npc_population.json` 的 `hostility` | grid、combat、npcs、population、party、character |
| 地圖上的事件 | `townEvents.ts`：`maybeTownEvent`、`answerTownEvent`；`dungeonEvents.ts`：`maybeDungeonEvent`、`answerDungeonEvent`、`offerTrapLure`、`pcEventReport`、`resolvePcOption`；`road.ts`：`roll`、`applyRoadOutcome`、`answerRoadEvent` | 一份模板表（344 個）用 `scope` 分八種：road 46、town 71、dungeon 134、lead 12，其餘 81 是 pregnancy／parasite／lactation／brood。各 scope 有自己的機率、冷卻、權重、篩選。檢定與結果套用共用 `road.ts` 的 `roll` 與 `applyRoadOutcome`。 | `travel_events.json`（templates、town、dungeon、side_maps） | grid、road、content（`tagsAllowed`）、storyFlags、look、lewd、parasites |
| 線索／情報池 | `leads.ts`：`ensureLeadPool`、`regionPlaces`、`discoverLead`、`stumbleOnLead`、`informantLeads`、`hiddenLeadFor`；`intel.ts`：`addIntel`、`ensureIntelPoints`、`finishIntel`、`pointOffers`、`storyOffers`、`makePoint`、`nearbyPlaces`；`leadEvents.ts`：`startLeadEvent`、`answerLeadEvent`、`pickCast` | 每個地區一個池子（6 格），進入該地區的近郊／地下城時擲。每格抽一種（強敵、寶箱、流浪商人、遺物、事件）；四成分給情報商、其餘隱藏。進入區域時 `ensureIntelPoints` 把點放上格子。 | 常數寫在 `leads.ts`（`LEAD_SLOTS`、`LEAD_EMPTY`、`LEAD_INFORMANT`、`LEAD_WEIGHTS`）；模板在 travel_events.json | grid、data、story、npcs、population、npcLife、effects |
| 酒館打聽 | `askAround.ts`：`askAroundBlock`、`askAround` | 付 15、魅力檢定 DC 13，成功揭露 1 則隱藏線索，大成功 2 則；一天一次、1 小時。 | 無（`ASK_COST`、`ASK_DC` 是常數） | leads、checks、rollParts、money、grid |
| 休息／打工／活動／用餐 | `rest.ts`：`shortRest`、`longRest`、`campRest`、`longRestBlocked`、`restChecks`；`work.ts`：`jobHere`、`setupWork`/`applyWork`；`activities.ts`：`npcActivity`、`noteBystanders`；`meals.ts`：`mealMenu`、`eatMeal` | 休息照 D&D 5e（生命骰、法術環、長休間隔）；長休後跑離隊檢查。打工：站在設施上、花時間、檢定決定報酬。活動：純函式，依「NPC id＋日期＋時段」雜湊挑一句。 | `companions.json`（rest、conditions）、`work.json`、`npc_activities.json`（103 條規則）、`economy.json`（meals_cc） | rest 匯入 27 個模組（含 pregnancy、parasite、slavery、tattoos）；work 依賴 brothelLife、lewd、tattoos；activities 只依賴 data、grid、npcs、population、rng |
| 公會委託 | `town.ts`：`guildQuests`、`acceptQuest`、`doTownQuest`、`turnInQuest`、`abandonQuest`、`canAcceptRank`；`materialQuests.ts`：`postWildQuests`、`postDungeonQuests`、`questTargets`、`layerRank`、`rewardRange`；`guild.ts`：`playerRank`、`promotionStatus`、`postExam`、`addMerit`、`applyRankUp`；`questBoard.ts`：`arrangeBoard` | 委託板每 `refresh_days` 更新：F 級城內／近郊模板數個、7 天內可到的每座地下城一個清剿委託、材料與層主委託。帶著委託進入區域時 `grid.ensureQuestTargets` 補足目標格。階級 F～S，功績與等級夠了發晉升考核。 | `town_quests.json`（20 個模板、material_quests）、`progression.json`（階級，未細讀） | world、grid、deadlines、storyFlags、gear、character |
| AI 任務生成 | `questGen.ts`：`buildGenerated`、`rewardFor`、`enemyBand` | **不是委託板的生成**。把 AI 回覆的 JSON 整理成可加進世界的「特殊任務」內容包（換 id、加旗標前綴、夾數值範圍）。 | 無直接 JSON | contentImport、contentRefs、mods、storyMods、landmarkMods |
| NPC 名冊與生成 | `npcs.ts`：`generateNpc`、`registerNpc`、`npcRecord`、`characterFor`、`askingPrice`、`pickNpcClass`、`npcIdentity`；`population.ts`：`ensureRoster`、`generateResident`、`pickTags`、`buildHaunts`、`refreshRosters`、`spawnVisitors`、`pruneNpcs`；`promoteNpc.ts` | 固定 NPC 在 `npcs.json`（232 位）；生成的存在 `state.npcs`。每個聚落第一次進入時用「存檔種子＋地點」的固定亂數建名單（冒險者／普通人各半，固定 NPC 佔名額）。外貌、名字、性格由 `traits.ts` 的 `rollLook`。 | `npcs.json`、`npc_pool.json`、`npc_traits.json`、`npc_tags.json`、`npc_population.json` | data、traits、character、perks、squads、grid、story |
| NPC 每日位置與日子 | `population.ts`：`areaOf`、`whereToday`、`npcCell`、`fixedCell`、`peopleHere`、`isHostile`；`squads.ts`：`followsLeader`；`npcLife.ts`：`tickNpcLife`、`rollOnce`、`newsOf` | 位置不存檔：`haunts`（地點＋zone＋權重）加「NPC id＋日期」雜湊決定今天在哪個區塊、哪一格。小隊成員依機率跟隊長。`npcLife` 每 X 天替關注的冒險者擲近況（升級、換裝、去過哪座地下城）。 | 同上；`npcLife` 的常數寫在程式裡 | grid（zone、區塊 key）、squads、story、lewd、sexRecord、gear |
| 互動與關係記憶 | `interactions.ts`：`setupInteraction`、`applyInteraction`、`affinityTable`；`social.ts`：`ensureRelationship`、`setAffinity`、`recordMemory`、`compactMemories`、`selectContext`、`formatContext`、`addSuggestions` | 互動六種（聊天、送禮、獻媚、誘惑、偷竊、偷襲）走主動行動：先擲骰，親密度與後果由程式依成功程度決定。記憶由報告自動產生（依 `report.kind` 給重要度），上限 200，超過壓縮；`selectContext` 依參與人、地點、時間檢索交給 AI。 | `actions.json`（kinds）、`security.json`（steal、attack）、`economy.json` | social 只依賴 bondStyle、character、data、npcLife、npcs；interactions 依賴 combat、lewd、security、population |
| 談判 | `negotiation.ts`：`canNegotiate`、`startNegotiation`、`chooseOption`、`applyNegotiationOutcome`、`negotiationSetup`、`applyAiOptions` | 模板 = 目標 + 可選方式（屬性＋DC）+ 各成功程度的效果；部分成功可再談，最多 `max_attempts` 次。兩個模板：委託報酬、商店折扣。 | `negotiations.json` | effects、checks、trade、town、social、npcs |
| 警戒／通緝／聲望 | `security.ts`：`alertLevel`、`raiseAlert`、`isWanted`、`fineDue`、`payFine`、`gateCheck`、`arrivalCheck`、`zoneEntryBlock`、`persuadePalaceGuard`、`consequences`、`reputationBand` | 警戒是「每個地點」0～3 級、7 天衰減；通緝與聲望是「每個勢力」。城門盤查 DC = 10 + 3×警戒；貴族區與王城另有門檻。聲望分五段影響買賣價與罰金。 | `security.json` | character、party、pcTags、money、rollParts、state、data（**不依賴 grid**） |
| 隊伍與夥伴 | `party.ts`：`joinParty`、`leaveParty`、`partyMax`/`partyRoom`、`pcOf`、`addAffinity`、`addCondition`/`gainCondition`、`setHp`；`companions.ts`：`tavernCandidates`、`applyHire`、`applyInvite`、`applySquadJoin`、`marketStock`、`buySlave`、`setupFor`；`away.ts`：`lodgeAtTavern`、`sendHome`、`queueJoin`/`acceptPendingJoin` | 六種關係（hired、voluntary、slave、leader、ally、guest）；入隊時同步人際關係與初始親密度。`companions.ts`（1,167 行、匯入 37 個模組）混了雇傭、邀請、小隊、奴隸市場、自賣、逃亡、向主人提議，以及主動行動的分派 `setupFor`。 | `companions.json`、`combat.json`（party_max）、`slavery.json`、`market.json` | party 被 59 個模組匯入；匯入 slavery、tattoos、masterHome、parasites、crafting |

## 2. 寫死的奇幻／世界形狀假設

| 位置 | 假設 | 單一城市要怎麼改 |
|---|---|---|
| `grid.ts` `Zone` = town／noble／palace／temple／brothel／outskirts／dungeon；`zonesOf` 用字元 `C`、`B` 判斷神殿與娼館 | zone 是封閉的列舉，兼做 NPC 出沒與門禁 | 改成資料驅動的 zone 表（8 區各一個 id，另加網路空間、委託副本）；`zoneEntryBlock` 的 noble／palace 改成每區的門禁規則 |
| `grid.ts` `CellKind`／`CELL_NAME`／`CELL_ICON`／`SPOT_KINDS`、`townEvents.ts` `TOWN_EVENT_CELLS` | 設施種類（公會、神殿、鐵匠鋪、魔法物品店…）寫在型別與四張表裡 | 設施改成資料表（id、名稱、圖示、可否觸發城鎮事件）；`shop_`、`lm_` 前綴已經示範了資料驅動的做法 |
| `grid.ts` `enterLocation`、`goOutskirts`、`returnToTown`、`placeOutside`、`enterTownGate`、`canTravelHere` | 「城門 → 近郊 → 回城」與「地點 = 聚落或地下城」 | 整段不要。8 區直接用 `link` 相連；進入點改成每區的預設出生格 |
| `grid.ts` `generateLayer`、`descend`/`ascend`、`retreat`、`DUNGEON_LAYERS`、`layerKey`；`expedition.ts`；`data.ts` `DungeonLayerId` | 五層固定名稱（周邊→底層），層決定陷阱 DC、寶箱鎖、層主 | 網路空間用「深度參數表」取代具名的層；`generateSide`/`generateSpecial` 也借用 `DUNGEON_LAYERS` 取陷阱與鎖的數值，要一起解開 |
| `grid.ts` 寶箱 `level` = 遭遇表怪物最高等級；`leads.ts` `regionPlaces` 用 `pcOf(state).level + LEVEL_SLACK`；`npcLife.ts` `levelUpChance`、`dungeonEntryLevel`；`npcs.ts` `askingPrice`、`slavePrice`、`tierLevels`；`encounters.ts` 威嚇依等級；`materialQuests.ts` `rankForLevel`、`layerRank` | 等級貫穿難度、報酬、雇用價、線索篩選 | 沒有等級：改用「威脅值／區域難度」一個數字，或直接拿掉篩選 |
| `npcs.ts` `pickNpcClass`、`generateNpc`（`class`、`race`）、`raceWeights`（地區 id 寫死：south、north、forest、east_sea、west、yanhua_*）；`population.ts` `pickTags` 的 `class_mult`；`party.ts` `isNoncombatant(c.class)` | NPC 一定有職業與種族；種族比例依地區 | 職業 → 夥伴的固定角色（role）；種族整個拿掉；`raceWeights` 刪除 |
| `rest.ts` | 法術環、生命骰、長休間隔（D&D 5e） | 重寫成新的回復規則；可保留「地點決定能不能長休」「休息時被襲擊」的骨架 |
| `world.ts`、`travel.ts`、`road.ts` `startJourney`/`buildRoad`、`travel.ts` `MODE_NAME`（官道、山道、海路…）、`EVENTS`、`ROAD_DAILY_CC`、`SEA_FARE_CC` | 多城鎮＋以「天」計的路線圖＋旅途單行道 | 不需要。大眾運輸 = 站點格之間的瞬移（花時間與車資），可用 `link` 或新的 `transit` 格加一張站點表；`shortestPath` 可留給站點圖用 |
| `population.ts` `buildHaunts`、`rosterEvent`、`spawnVisitors`、本地的 `neighbors` | NPC 活躍地點 = 所屬聚落的各 zone ＋相鄰聚落＋附近地下城；搬家到鄰鎮 | 名單改成「每區一份」或「全城一份」；haunts 只留 zone 權重；`spawnVisitors` 改成副本／網路空間的訪客 |
| `population.ts` `EAST`、`continentOf` | 兩片大陸的名字寫在程式裡 | 刪除 |
| `security.ts` `gateCheck`、`arrivalCheck`、`GATE_WAYS`、`zoneEntryBlock`、`palace*` | 警戒以「聚落」為單位、通緝與聲望以「勢力」為單位；城門盤查；王城 | 警戒改成每區；城門盤查改成區界檢查哨或掃描；王城邏輯可改寫成「企業區門禁」 |
| `town.ts` `guildQuests`、`canAcceptRank`、`QUEST_RANGE_DAYS`；`guild.ts`；`materialQuests.ts` `RANK_ORDER` | 冒險者公會、階級 F～S、晉升考核、清剿地下城、怪物材料 | 委託板骨架（模板池、定期更新、期限、談報酬）可留；階級與考核刪掉或換成「信譽」；清剿／材料委託換成「委託副本」 |
| `leads.ts`、`intel.ts` `nearbyPlaces`/`dungeonPlaces`、`leadEvents.ts` `knownCast` | 池子以「地區」為單位，放置地點是近郊與地下城各層 | 池子改成全城一個或每區一個；放置地點改成城區的格子與網路空間 |
| `townEvents.ts` `location_types`（capital／city／town…）；`npc_population.json` `roster` 依聚落規模 | 聚落規模等級 | 只有一座城：這個維度拿掉，改用區 id |
| `landmarks.ts`、`work.ts`、`interactions.ts`、`rest.ts`、`road.ts`、`party.ts`、`companions.ts` | 成人向與奴隸系統穿插在通用流程裡（lewd、brothelLife、slavery、tattoos、pregnancy、parasite、masterHome） | 新遊戲若不做這些，要逐檔剪掉對應的分支與匯入；這是移植工作量的主要來源 |

## 3. 移植分類

| 分類 | 模組 | 說明 |
|---|---|---|
| 幾乎原樣 | `rng.ts`、`world.ts`（改給站點圖用）、`questBoard.ts`（去掉階級排序）、`activities.ts`、`pcWords.ts`、`squads.ts`、`social.ts`（去掉 bondStyle、npcLife 的兩個呼叫） | 邏輯與世界形狀無關，或只有很薄的一層 |
| 拆出核心後原樣 | `grid.ts` 的型別、`buildBlock`、`getArea`、`cellAt`/`findKind`、`reveal`、`placeAt`、`move`、`crossLink`、`pathTo`、`ensureConnected`、`farthest`、`randomCells`；`specialMaps.ts` 全部；`light.ts` | 要先把 grid 切開（見第 6 節 E1） |
| 要改規則 | `security.ts`、`population.ts`、`npcs.ts`、`npcLife.ts`、`interactions.ts`、`negotiation.ts`、`landmarks.ts`、`leads.ts`、`intel.ts`、`leadEvents.ts`、`askAround.ts`、`townEvents.ts`、`dungeonEvents.ts`、`encounters.ts`、`work.ts`、`meals.ts`、`rest.ts`、`party.ts`、`away.ts`、`town.ts`（委託部分）、`look.ts`、`pcTags.ts`、`promoteNpc.ts` | 演算法可用，資料形狀與數值要換 |
| 重寫比移植快 | `companions.ts`（先拆出雇傭／邀請兩塊）、`road.ts`（只留 `roll`、`applyRoadOutcome`、`enterSide`/`leaveSide`）、`materialQuests.ts` | 混了太多不需要的系統 |
| 不需要 | `travel.ts`、`expedition.ts`、`underworld.ts`、`park.ts`、`pruneLocations.ts`、`dungeonPreview.ts`、`guild.ts`、`questGen.ts`（除非要 AI 生成任務） | 多城鎮、地下城分層、公會階級、自建地下城編輯器 |

### 只跑 `grid.ts` + `specialMaps.ts` + 一張固定地圖的最小依賴

`grid.ts` 現況拉進整個 105 模組的循環，不能直接搬。可行的最小集合：

| 需要 | 內容 |
|---|---|
| 原樣 | `rng.ts` |
| 精簡版 `data.ts` | 只留 `Location`、`geography`、`locationById`、`specialMaps`、`specialKey`、`specialMapOfKey`、`specialMapLegend`、`SpecialMapDef`、`SpecialConnection`、`contentRevision`、`landmarks`/`landmarkDef`（可先給空表）、`shopRules`（可先給空表） |
| 精簡版 `types.ts` | `GameState` 只留 `location`、`position`、`areas`、`special`、`side`、`time`、`flags`、`seed`、`trail` |
| 精簡版 `state.ts` | `withRng`、`advanceTime` |
| 精簡版 `storyFlags.ts` | `condMet`（原版依賴 charm、lewd、parasites、gear、tattoos、schools、pregMarks） |
| `light.ts` | 可先用常數 `sightIn = 1` 代替；原版依賴 `state.removeItem`、`tools.toolValue` |
| `grid.ts` 要留 | 型別、`buildBlock`、`baseBlock`、`getArea`、`settlementArea`、`cellAt`、`findKind`、`currentArea`/`currentCell`/`position`、`reveal`/`isRevealed`、`storeArea`、`placeAt`、`move`、`blockedMove`、`crossLink`、`pathTo`、`generateSpecial`、`specialVersion` |
| `grid.ts` 要切掉 | `enterCell` 的內容結算（改成回呼或事件）、`overlayLots`、地標疊加、`zoneEntryBlock`、`assertNoStandoff`（改成可註冊的阻擋檢查）、park、masterHome、expedition、近郊與樓層、`afterCombat`/`afterDefeat` |
| `specialMaps.ts` 要改 | 拿掉 `leaveSide`（road）一個匯入；`enterLocation` 換成新遊戲的出生點函式 |

`grid.ts` ↔ `specialMaps.ts` 互相匯入（`generateSpecial` 在 grid、`overlayConnections` 在 specialMaps），移植時建議把 `generateSpecial` 搬到 specialMaps 這一側，變成單向。

## 4. 生成器怎麼給網路空間與委託副本用

| 用途 | 現成的機制 | 要補的 |
|---|---|---|
| 委託副本（獨立於城市地圖） | **`SpecialMapDef` 幾乎就是這個**：手工 `grid` 或 `size`＋`carve_steps` 隨機；`refresh: true` 每次進來重生；`enterSpecial`/`leaveSpecial` 用 `state.special.back` 記回程；`specialDefeat` 處理倒下；`bosses` 指定 BOSS 格；`ensureStoryMarkers` 放任務點。另有 `enterSide`/`leaveSide` + `state.side.story`：帶任務進臨時地圖、沒完成就離開等於放棄。 | 現在一張圖一個 `sm/<id>` key，同一個定義同時只能有一份實例。副本要加實例 key（例如 `inst/<委託id>`）與「委託結束時清掉」；遭遇表改由委託指定（已有 `def.table`） |
| 網路空間（大量隨機地圖） | `generateSide(state, key, template, def, location, table, rng, layer?)` 是最乾淨的入口：吃一個 `SideMapDef`（size、carve_steps、各種內容的數量範圍、lighting）與一張遭遇表，回傳 `Area`。`link` 格 + `storeArea` 可把多張圖串成圖狀結構（`descend` 的「沒生成過就生成、生成過就沿用」是範例）。 | (1) 只有一種演算法（隨機漫步），地圖小（預設 7×7～9×7），大圖會很空或很糊，要加房間＋走廊或細胞自動機。(2) 入口固定在底邊中央、出口固定在最遠格。(3) 生成不是純函式：吃 `state` 為了放任務格與情報點，建議拆成「純佈局」與「依存檔佈置」兩步。(4) 亂數來自 `withRng(state)`，要重現同一張圖得另外給種子（`population.ts` 的 `new Rng(hashString(seed:key))` 是現成的做法）。(5) 沒有「節點之間的拓樸」概念，要另外寫一層網路空間的節點圖 |
| 兩者共用 | `randomCells`、`ensureConnected`、`farthest`、`chestLock`、`reveal`（戰爭迷霧）、`light.ts`（可以改寫成「訊號／ICE 可見度」） | 把三份重複的挖通道與 `strongestPlusOne` 合成一個（見 E2） |

## 5. 重複、沒用到的匯出、engine 外的規則

### 重複的邏輯

| 位置 | 內容 |
|---|---|
| `grid.ts` 780、883、993 行 | 隨機漫步挖通道寫了三次（`generateLayer`、`generateSide`、`generateSpecial`） |
| `grid.ts` 749（`strongestPlusOne`）、890、955、1302 行 | 「最強的一組再多一隻」寫了四次，只有第一處是函式 |
| `grid.ts` `enterLocation` 與 `enterTownGate` | 找城門區塊、站到城門的程式碼相同 |
| `population.ts` 50、54 行 | 本地的 `neighbors`、`isSettlement`，與 `world.ts` `neighbors`、`data.ts` `isSettlement` 重複（簽章不同） |
| `road.ts` `weighted`、`leads.ts` `pick`、`npcs.ts` `weightedPick` | 三份加權抽選 |
| `grid.ts` `eventReport`、`town.ts` `baseReport`、`security.ts` `securityReport`、`dungeonEvents.ts` `pcEventReport` | 四份「建一份空報告」 |
| `town.ts` `rest`/`restCost` 與 `rest.ts` `longRest`/`innCost` | 舊的入口還留著；`town.ts` 又 re-export `INN_CC_PER_PERSON` |
| `townEvents.ts`、`dungeonEvents.ts`、`leadEvents.ts`（另有 parasiteEvents、pregnancyEvents） | 每個 scope 各有一套 templates／candidates／weight／maybe／pending／answer／prune，結構相同 |
| `leads.ts` `regionPlaces` 與 `intel.ts` `nearbyPlaces`/`placesAt` | 都在列舉「可以放事件點的地方」 |

### 沒被用到的匯出（正則比對 `src/` 與 `tools/`，可能有誤判）

- 完全沒人用：`grid.currentZone`、`town.restCost`、`light.LIGHTING_NAME`、`underworld.inUnderworld`、`away.pendingNeed`、`npcs.findNpcByName`、`npcLife.npcPairsOn`、`interactions.isInteraction`、`negotiation.optionText`、`party.conditionPenalty`
- 只有測試在用（共約 70 個）：例如 `grid.standOn`、`grid.generateLayer`、`road.finishJourney`、`road.enterSide`、`security.raiseAlert`、`population.npcCell`、`population.whereToday`、`rest.restChecks`
- 只在自己檔案裡用卻匯出（約 70 個）：例如 `grid.generateOutskirts`、`leads.regionPlaces`、`companions.hireDc`、`population.buildHaunts`

### 寫在 engine 外，或寫在程式裡而不是資料裡的規則

| 位置 | 內容 |
|---|---|
| `src/stores/game.ts` `afterMove`（約 190 行） | 移動後的觸發順序：敵對冒險者 → 夥伴歸隊 → 主人事件 → 奴隸事件 → 城鎮事件 → 寄生物 → 懷孕。這是遊戲規則，卻在 store 裡 |
| `src/stores/game.ts` `run`（約 400 行） | 每個動作後的結算：`startAutoStories`、`expireDeadlines`、`tickNpcLife`、`noteBystanders` |
| `src/stores/game.ts` `load`、1610／1717 行 | 讀檔時的修補順序；`goOutskirts`／`descend`／`ascend` 之後手動接 `checkHostiles` |
| `src/components/TravelDialog.vue` `fareOf` | 重算一次船資，與 `road.ts` `startJourney` 的公式重複 |
| `travel.ts` `EVENTS`、`ROAD_DAILY_CC`、`SEA_FARE_CC`、`MODE_NAME` | 旅途事件表與費用是程式常數 |
| `leads.ts` `LEAD_*`、`askAround.ts` `ASK_COST`/`ASK_DC`、`town.ts` `RATION_CC`/`TEMPLE_CC`/`QUEST_RANGE_DAYS`、`rest.ts` `INN_CC_PER_PERSON`、`dungeonEvents.ts` `DEFAULT_LAYER_DC`、`npcLife.ts` 的門檻常數 | 平衡數值不在 `data/rules` |
| `npcs.ts` `raceWeights`、`tierLevels`；`population.ts` `EAST` | 地區 id 與等級區間寫死 |
| `security.ts` `GATE_WAYS`；`grid.ts` `gather` 的 `'古錢'` 特例、`LOCK_METHODS` | 規則與文字混在程式裡 |

## 6. 給 ElondiaRPG 的降熵建議

| # | 位置 | 問題 | 建議 | 風險 | 規模 |
|---|---|---|---|---|---|
| E1 | `grid.ts` | 1,797 行、匯入 33 個模組、被 59 個模組匯入，八種職責混在一起 | 拆成 `gridCore`（型別、取區域、移動、尋路、迷霧）、`mapgen`（三個生成器）、`cellEffects`（陷阱、採集、寶箱、開鎖）、`areaFlow`（城門、近郊、樓層、戰後）；`grid.ts` 先保留為 re-export | 匯入面很廣，要靠現有測試（`grid.spec`、`specialMaps.spec`、`road.spec` 等）把關；存檔格式不受影響 | L |
| E2 | `grid.ts` 780／883／993、749／890／955／1302 | 挖通道三份、強敵四份 | 抽出 `carve(rng, w, h, steps)` 與統一用 `strongestPlusOne` | 亂數呼叫順序必須完全不變，否則同一個種子生出不同的地圖 | S |
| E3 | `grid.ts` ↔ `specialMaps.ts` | 互相匯入 | `generateSpecial`、`specialVersion`、`specialTable` 搬到 `specialMaps.ts` | 低 | S |
| E4 | `grid.ts` `assertNoStandoff` | 最底層的移動函式知道 13 種上層的待處理狀態 | 改成註冊式：各系統登記自己的阻擋檢查 | 中：漏註冊會讓玩家在事件中途走掉 | M |
| E5 | `grid.ts` `enterCell` | 直接呼叫 combat、leads、intel、dungeonEvents、park | 進格只回傳「發生了什麼」，由上層分派 | 中 | M |
| E6 | `src/stores/game.ts` `afterMove`、`run` | 回合管線在 store，engine 單獨測不到 | 搬進 engine（例如 `turn.ts` 的 `afterMove(state, result)`、`afterAction(state)`） | 低；順序要照抄 | M |
| E7 | `townEvents`／`dungeonEvents`／`leadEvents`／`parasiteEvents`／`pregnancyEvents` | 五套相同的事件導演 | 抽出共用的 scope 導演（候選、權重、冷卻、等待、回應、清理），各 scope 只給篩選與機率 | 中：各 scope 的冷卻與權重細節不同 | L |
| E8 | `road.ts` | 旅途、共用的事件型別（`RoadTemplate`、`EventScope`）、檢定（`roll`）、結果套用、臨時地圖全在一個檔案；所有事件模組因此都依賴 road | 拆出 `eventTypes.ts`、`eventResolve.ts`、`sideMaps.ts` | 低，主要是搬移 | M |
| E9 | `companions.ts` | 1,167 行、匯入 37 個模組；`setupFor` 是所有主動行動的分派 | 拆成 hire／invite／market／selfSale／proposal；`setupFor` 搬到 `actions.ts` | 中 | L |
| E10 | `data.ts` | 2,706 行、一次匯入 33 個 JSON，任何模組要一個型別就拉進全部資料 | 依領域分檔（world／npc／rules／items），`data.ts` 保留為 re-export | 低 | M |
| E11 | 第 5 節列的常數 | 平衡數值散在程式裡 | 搬進 `data/rules`（例如 `leads.json`，或併入 `travel_events.json`、`economy.json`） | 低 | S |
| E12 | `population.ts` 本地 `neighbors`／`isSettlement`；三份加權抽選；四份空報告 | 重複的小工具 | 各留一份（`world.neighbors`、`rng` 加 `weighted`、`state` 加 `blankReport`） | 加權抽選合併時要確認亂數消耗次數一致 | S |
| E13 | 第 5 節的未使用匯出 | 約 10 個完全沒用、約 70 個只在檔內使用 | 刪除沒用的；只在檔內用的拿掉 `export`；只給測試用的集中標示 | 低；先用 `ts-prune` 或 `knip` 再確認一次 | S |
| E14 | `town.ts` | 混了旅店、神殿、乾糧、招募、委託、技能選擇 | 委託搬到 `quests.ts`；`rest`/`restCost` 舊入口刪掉 | 低 | M |
| E15 | `grid.ts` `Zone`、`CellKind`、`CELL_NAME`、`CELL_ICON`、`SPOT_KINDS` 與 `townEvents.TOWN_EVENT_CELLS` | 加一種設施要改五個地方 | 一張設施表（id、名稱、圖示、是否具名地點、是否觸發城鎮事件） | 低 | S |
| E16 | `TravelDialog.vue` `fareOf` | 與 `startJourney` 重複計價 | engine 匯出 `journeyFare(state, path)`，兩邊共用 | 低 | S |

## 7. 沒有驗證的部分

- 沒有執行測試與型別檢查；所有結論來自閱讀程式碼。
- 只讀了檔頭註解與匯出清單、沒有逐行讀函式本體的：`companions.ts`、`npcLife.ts`、`interactions.ts`（讀了前 60 行）、`social.ts`（讀了記憶重要度一段）、`negotiation.ts`、`landmarks.ts`、`rest.ts`、`work.ts`、`meals.ts`、`away.ts`、`questGen.ts`、`dungeonPreview.ts`、`park.ts`、`underworld.ts`、`leadEvents.ts`、`townEvents.ts`、`dungeonEvents.ts`、`materialQuests.ts`、`guild.ts`。這些子系統的「怎麼運作」主要依據註解與資料檔，細節可能有出入。
- `road.ts` 只讀了型別、`startJourney`、`buildRoad`、臨時地圖與 `applyPendingMove`；`roll`、`applyRoadOutcome`、`roadMove` 沒讀。
- 10 份相關文件只讀了 `DUNGEON_DESIGN.md` 全文與 `COMPANIONS.md` 的章節標題，其餘沒讀。
- 「沒用到的匯出」是用正則做整字比對：同名的區域變數會造成漏報，經字串或動態存取的使用會造成誤報。
- deps.json 的邊包含 type-only import（依 `data.ts` 的匯入推斷）；「執行期乾淨」的判斷只逐一核對了 `data.ts`、`world.ts`、`light.ts`、`squads.ts`、`social.ts`、`storyFlags.ts`、`state.ts`、`types.ts`。
- `progression.json`（公會階級）與 `enemies.json` 的 `encounters` 結構沒有打開看，只從程式的用法推斷。
- 行號是掃描當下的，僅供定位。
