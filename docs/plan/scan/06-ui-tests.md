# 06 — UI／Store／測試／工具掃描（ElondiaRPG）

> 唯讀掃描 `/home/user/yellow630914/elondiarpg`。行數取自 `deps.json` 的 `loc`；元件共 216 檔（含 `App.vue`）。
> 分類判定方法：依賴圖 + grep（`Math.`、算式、直接改 state、`useGame()`）+ 精讀約 15 個大檔的 script。**沒有逐行讀完 35k 行**，(c) 類清單是「找到的」而非「全部」。**沒有執行測試**。

## 1. 元件盤點

型態：(a) 純呈現　(b) 編排：讀 `game.state`、呼叫 store 動作與引擎的查詢函式　(c) 內嵌規則。
整體觀察：**122 個元件直接 `useGame()`**，幾乎沒有 props-driven 的元件；變更一律走 `game.xxx()`（store 的 `run()`），grep 不到元件直接改 `game.state` 的寫法。元件對引擎的 744 次 import 絕大多數是「查詢／預覽／名稱」函式。所以主體是 (b)，(c) 是零星重複的預覽算式。

| 組 | 檔數 | 行數 | engine/stores/narrator import | 型態 | 主要檔案（`src/components/`） |
|---|---|---|---|---|---|
| A 外殼、導覽、開新遊戲 | 22 | 3,547 | 63/23/0 | b（少量 c） | `../App.vue`(551)、`HomeView`、`mobile/{MobileGame,BottomSheet,SwipeTabs}.vue`、`mobile/mobile.ts`、`events/EventCenter.vue`、`events/eventQueue.ts`、`fx/{AmbientLayer,BackgroundLayer}.vue`、`fx/backgrounds.ts`、`WorldBar`、`IntentPanel`、`NewGameView`(690)、`StartGearDialog`、`LookPicker`、`PcTagPicker`、`PerkBuilder`、`PerkPicker`、`CustomDifficultyEditor`、`RuleFields`、`home/CreditsDialog` |
| B 日誌、敘事、行動、事件卡 | 16 | 1,949 | 48/27/5 | b | `LogView`(192)、`ReportCard`(481)、`PendingActionCard`、`ActionPanel`、`JudgeToggle`、`SceneImage`、`SceneSplitDialog`、`SceneStatus`、`NotebookView`、`StoryNodeCard`、`StoryPanel`、`DefeatEventPanel`、`events/{RoadEvent,LevelUp,PerkOffer,ClassRebalance}Panel.vue` |
| C 地圖、地點、旅行、休息 | 17 | 2,131 | 83/13/0 | b（少量 c） | `MapPanel`、`AreaMap`(321，DOM 格子不是 canvas)、`WorldOverviewMap`、`PlacePanel`(617)、`RoadPanel`、`TravelDialog`、`LandmarkPanel`、`ExpeditionBar`、`GuardStatus`、`StandoffPanel`、`RestPanel`、`place/{BuildingMenu,SceneBanner,TattooShop}.vue`、`TownTagChips`、`ui/tiles.ts`、`ui/cellIcons.ts` |
| D 戰鬥 | 5 | 1,419 | 20/6/1 | b（演出邏輯重） | `CombatView`(1,080)、`AbilityPicker`、`BestiaryPanel`、`ArenaPanel`、`CaptivesPanel` |
| E 角色、行囊、裝備 | 24 | 3,256 | 120/15/0 | b | `party/{CharacterDialog(520),PaperDoll(346),PartyCards(292),MakeRoomDialog,ParasitePane,RoomMembers,SlotButton,TattooMap,BodyFigure}.vue`、`party/{memberInfo,bodyShapes}.ts`、`PartyStrip`、`items/{InventoryView,BindTip,EffectLine,ItemIcon}.vue`、`items/{itemArt(488),itemIcon,itemInfo}.ts`、`TrainPanel`、`PurifyPanel`、`UncursePanel`、`TattooPanel`、`MarkPicker` |
| F 商店、交易、工藝、打工 | 13 | 2,213 | 65/16/0 | b | `items/{ShopDialog(454),CartPanel,MarketTags,PriceSteps}.vue`、`ShopPanel`、`MarketPanel`、`AuctionPanel`、`NegotiationPanel`、`CraftDialog`、`CraftPanel`(415)、`RecipePanel`、`InventPanel`、`WorkPanel` |
| G NPC、夥伴、關係、形象圖 | 12 | 2,434 | 59/23/3 | b | `PeoplePanel`(383)、`RelationsView`、`RelationDetail`(356)、`MemoryList`、`TavernPanel`(461)、`NameTag`、`BondStylePicker`、`events/{JoinPanel,SuggestionPanel}.vue`、`PortraitBox`、`PortraitStudio`(416)、`ui/Avatar.vue` |
| H 成人、契約、奴隸 | 15 | 1,836 | 55/12/0 | b | `adult/{AdultDeco,AdultShopMenu,FuseAltar,OutfitAtelier}.vue`、`adult/deco.ts`、`ContractDialog`(412)、`OwnedSlavesDialog`、`BrothelPanel`、`MasterEventPanel`、`VolunteerSlavePanel`、`NurseryPanel`、`events/{MarkingPanel,BirthPanel,BroodBirthPanel}.vue`、`ContentTagChips` |
| I 住家 | 1 | 200 | 5/1/0 | b | `HomePanel`（`home/` 目錄只有 `CreditsDialog`，名不符實；`HomeView` 是首頁不是住家） |
| J 設定、AI 來源、提示詞 | 11 | 2,524 | 8/17/15 | b | `SettingsView`(497)、`SettingsFilePanel`、`AiToggles`、`ModelSourceEditor`、`ImageSettings`、`ComfySettings`、`PromptsView`(572)、`PromptEntryList`、`PromptSetBar`、`RegexPanel`、`TavernPresetDialog` |
| K 存檔 | 2 | 236 | 2/3/0 | b | `SaveDialog`(218)、`download.ts` |
| L 內容編輯器 | 63 | 12,339 | 217/68/0 | b（表單）+ a（表單小件） | `ContentView`(1,236) + `content/` 62 檔：19 個大 Editor（`ItemEditor` 837、`NpcEditor` 562、`SpecialMapEditor` 489、`TravelEventEditor` 472、`EnemyEditor` 471、`PerkEditor` 434、`AbilityEditor` 415、`EffectsEditor` 400…）＋通用表單小件 |
| M 通用小元件、圖示 | 16 | 1,844 | 9/2/0 | a | `AppDialog`(151，rev 23)、`ui/{Hint(rev 90),GameIcon(rev 82),FoldMenu,StatGrid,Chip,ClassWeaponsHint}.vue`、`ui/{iconPaths,pixelArt}.ts`、`marquee.ts`、`StatBar`、`icons/{ContentIcon.vue,abilityArt,materialArt,monsterArt,perkArt}.ts` |

### (c) 內嵌規則：找到的最嚴重者

| 位置 | 內嵌的規則 | 應該在 |
|---|---|---|
| `src/components/events/eventQueue.ts`（119 行，9 個 engine import） | 「目前有哪些待回應事件、哪些會擋住行動」整個從 20 多個 state 欄位推導（`pendingDefeat`、`standoff`、`captives`、`pendingMark`…），含標題字串與奴隸／娼館分支 | 引擎的 `pendingEvents(state)`；元件只留 `snoozed`／對話框開關 |
| `src/stores/game.ts` `afterMove()`（190–211）與 `run()`（394–435） | 每步之後的回合管線：對峙檢查、同伴歸隊、主人／奴隸／城鎮／寄生／懷孕事件擲骰、期限到期、NPC 生活 tick、自動任務開始。**是遊戲規則，卻在 store** | 引擎的 `endOfAction(state)` |
| `src/stores/game.ts` `load()`（217–250） | 讀檔修復與各事件 prune 的順序 | 引擎的 `migrate`／`loadState` |
| `src/stores/game.ts` `hire()`（1430） | 「出價 ≥ 要價就直接成交，否則走判定」 | `companions` |
| `src/components/PlacePanel.vue` `lockBonus()`、`canPersuade` | 開鎖加值公式（屬性修正 + 工具 + `checkBonus`）、王城衛兵「今天被拒過就不能再說服」 | `engine/checks`、`security` 提供預覽函式 |
| `src/App.vue` `canAskMaster`、`crime`、`crimeLevel` | 何時可請求主人許可、通緝等級 = 通緝數×10 + 警戒 | `slavery`／`security` |
| `src/components/TravelDialog.vue` `fareOf()`、`overdueMark()` | 船資 = Σ`legFare` × 身分倍率並四捨五入（註解自承「和出發時扣的一樣」＝重複實作） | `road.farePreview()` |
| `src/components/CombatView.vue` `affinityTags()`；`party/memberInfo.ts` 79 行 | 抗性倍率 `max(0, 1+delta)` 與弱點／抗性／免疫分類，兩處重複 | `combat`／`effects` |
| `src/components/events/JoinPanel.vue` 19 行 | 隊伍上限（`party_max` vs `party_max_following`） | `party.partyMax(state, kind)` |
| `PeoplePanel.vue` `hire()` 與 `TavernPanel.vue` `hire()` | 同一段雇用流程（`askingFor`、`floor`、`requireRoom`）複製兩份 | 抽 composable |
| `ContractDialog.vue`／`OwnedSlavesDialog.vue` | `affPos`、`pct`、小時→天 的換算各寫一份 | `ui/format.ts` |

其餘 `Math.*` 多為顯示格式化（百分比、進度條、tween），屬 (a)/(b)。

## 2. Store 層（`src/stores/`，13 檔 6.2k 行）

| Store | 行 | 持有 | 呼叫引擎／敘事 |
|---|---|---|---|
| `game.ts` | 1,774 | **一個 `state = ref<GameState \| null>`（整份遊戲狀態一個大物件）**、`narrations`（report id→敘事文字）、`usage`（token）、`error`／`notice`／`judging`／`intent`、存檔欄位清單、undo 堆疊 | 75 個 engine import；回傳物件約 200 個一行的 `xxx: (…) => run((s) => engine.fn(s, …))` 轉發；敘事用動態 `import('@/narrator/…')`（compose、providers、sexLog） |
| `content.ts` | 1,393 | 世界清單（自訂內容包）、`mods`、`version` 計數器（引擎資料不是響應式，靠它重算） | 39 個 engine import：`applyContent`、各 section 的儲存／刪除／引用檢查 |
| `settings.ts` | 502 | 模型來源、AI 功能開關、遊戲選項；`watch` 把設定**推進引擎的模組層級全域**（`setContentFilters`、`setNpcLife`、`setStepMinutes`… 12 個 setter） | 9 engine、1 narrator |
| `saves.ts` | 365 | IndexedDB／localStorage 的 slot 與「進行中的遊戲」；不是 Pinia store，是函式 + 可替換的 `SlotStore`／`CurrentStore` 介面 | `assertSchema` |
| `portraits.ts` | 595 | 形象圖 IndexedDB、生成工作佇列 | narrator 的 image* |
| `scenes.ts` | 305 | 日誌插圖 | narrator |
| `prompts.ts` | 332 | 提示詞組、世界書覆寫 | narrator compose/lore |
| `image.ts` | 325 | 生圖設定 | narrator sceneInfo |
| `questGen.ts` | 245 | AI 編排任務的草稿 | narrator questGenSpec |
| `undo.ts` 77、`logArchive.ts` 68、`settingsFile.ts` 132、`characterPresets.ts` 91 | — | 純函式／小 store | — |

**動作與報告的提交**：`run(fn)`（`game.ts:394`）= `snapshotState`（`structuredClone`，`reports`／`logArchive` 只淺複製陣列）→ 執行引擎函式（**原地改 `state.value`**，引擎自己把 Report push 進 `state.reports`）→ 回合後管線 → `archiveOldReports` → `recordTurn` → `saveSoon()`（延後序列化寫 IndexedDB）→ 若回傳值是 Report 且設定允許，`narrate(report)`（串流寫入 `narrations[report_id]`）。丟例外時 `state.value = before` 並把訊息放 `error`（或 `onMap` 時顯示在地圖）。需要判定的行動：`perform()` = `run(prepareAction)` → `judge()`（AI 或規則）→ `run(resolveAction)`。

**Undo**：`undoStack`（最多 `UNDO_STEPS = 5`，只在記憶體）存「這一輪開始前的整份快照 + 這輪第一則 report id + 可重擲的輸入」。`undo(reportId?)` 用 `restoreTurn()` 換回快照、換亂數種子、刪掉被撤銷日誌的敘事、token 併到 `_other`。`redo()` 是用同一個輸入重擲，不是重做。純函式在 `undo.ts`，有 `undo.spec.ts`。

**6 檔循環的成因**（多數是型別或執行期才取用的假循環）：
- `game → content／portraits／scenes`：`run()`、存讀檔、敘事完成後呼叫它們。
- `content → game`：儲存／刪除內容時要查 `useGame().state`（進行中不能切世界、物品是否被存檔用到、`forkVanilla` 改存檔的 world）。
- `portraits → game`、`scenes → game`：記 token 用量（`OTHER_USAGE`、`usageCollector`）與讀 state。
- `logArchive → game`、`saves → portraits`：**只有 `import type`**（`NarrationState`／`UsageEntry`、`PortraitFile`）。
解法：把 `UsageEntry`／`NarrationState`／`OTHER_USAGE` 與用量統計抽成 `stores/usage.ts`，`PortraitFile` 型別移到 `saves.ts` 或 types 檔；`content` 對 game 的查詢改成由呼叫端傳入 state（或 game 註冊一個 guard）。

## 3. 樣式

| 項目 | 現況 |
|---|---|
| 全域 | `src/style.css` 381 行：`:root` 約 51 個 CSS 變數（顏色、`--radius`、`--fs-xs…xl`、字型、邊框角落 SVG、雜訊貼圖）；全域 class 很少（`.panel .row .tag .small .muted .bar .grid .menu-list .menu-row .item-tile .narration .parchment .story-paper .unfold` + `.fx-*`） |
| 主題 | 沒有主題切換機制。只有「深色木框」根變數 + `.parchment` class 把同一組變數換成淺色羊皮紙（對話框、正文）。`html[data-bg]`、`html[data-fx]`、`:root:lang(zh-Hans)` 是功能開關不是主題 |
| 元件樣式 | 190 個 `.vue` 有 `<style scoped>`，SFC 內共約 3,500 行 CSS |
| 顏色 token 化 | **中等**：`var(--accent)` 295 次、`--danger` 161、`--border` 133、`--muted` 124；但 `.vue` 內仍有 517 個寫死的 hex（集中在 `CombatView`、`PaperDoll`、`OutfitAtelier`、`PortraitStudio`、`ReportCard`、`AreaMap`、`CharacterDialog`、`App.vue`），`.ts` 內 174 個（`adult/deco.ts`、`ui/tiles.ts`、`fx/combatFx.ts`、`fx/fx.ts`，JS 產生的特效與像素圖） |
| 間距 token 化 | **沒有**：`padding／margin／gap` 宣告 1,733 處，只有 1 處用變數；全是寫死的 px／rem |
| 字級 | 部分 token 化（`--fs-xs` 81 次、`--fs-sm` 49 次） |
| 手機 | 兩套機制並存：JS 的 `isMobile`（`mobile/mobile.ts`，`matchMedia('(max-width: 720px)')`，13 個檔用）換整個版面（`MobileGame`、`BottomSheet`、`SwipeTabs`、返回鍵的 history 堆疊）；另有散落的 `@media`，斷點不一致（720×13、760×4、640×4、560×4、1000×3、900×2、860×2） |
| 題材耦合 | 木框金邊、羊皮紙、像素角落 SVG、襯線字型都寫在變數裡；`icons/*Art.ts`、`items/itemArt.ts`、`ui/tiles.ts` 是奇幻像素圖 |

**重新換膚難度：中偏高（M–L）**。換 `:root` 與 `.parchment` 兩組變數能改掉約七成的色彩；剩下要處理 (1) 691 個寫死的 hex、(2) 間距完全沒有 token、(3) `.parchment` 這個「淺色紙」概念寫進很多元件的 class、(4) JS 特效與像素圖的顏色。建議移植時先補 `--space-*` 與語意色 token，再逐檔替換。

## 4. 可直接移植 vs 綁定奇幻系統

| 可原樣（或只改樣式）移植 | 備註 |
|---|---|
| `AppDialog.vue`、`ui/Hint.vue`、`ui/FoldMenu.vue`、`ui/GameIcon.vue` + `ui/iconPaths.ts`、`ui/StatGrid.vue`、`ui/Chip.vue`、`marquee.ts`、`download.ts` | 0 engine import |
| `mobile/BottomSheet.vue`、`mobile/SwipeTabs.vue`、`mobile/mobile.ts` | 0 engine；只有 history state 的 key 名含 `elondia` |
| `content/` 的表單小件：`FoldSet`、`EditorHeader`、`HelpText`、`UsageNote`、`CheckList`、`CheckRow`、`ComboInput`、`NameListInput`、`IconField`、`UnsavedDialog` + `unsaved.ts`、`graphEdges.ts`、`iconUpload.ts`、`StoryGraph.vue` | 通用表單與圖形 |
| 設定與 AI：`ModelSourceEditor`、`AiToggles`、`JudgeToggle`、`ImageSettings`、`ComfySettings`、`PromptsView`、`PromptEntryList`、`PromptSetBar`、`RegexPanel`、`TavernPresetDialog`、`SettingsFilePanel` | 只依賴 stores + narrator，0 engine |
| 存檔：`SaveDialog.vue`（engine 只用 `formatTime`、`locationById`）、`stores/saves.ts`、`stores/undo.ts`、`stores/logArchive.ts`、`stores/settingsFile.ts` | `saves.ts` 的 slot meta 欄位要改 |
| 日誌：`LogView.vue`（只用 `Report` 型別與 `formatTime`）、`SceneImage`、`SceneSplitDialog`、`SceneStatus`、`PendingActionCard`、`ActionPanel` | `ReportCard` 要拿掉 `invention`／`sexRecord` 分支 |
| 形象圖：`PortraitBox`、`PortraitStudio`、`stores/portraits.ts`、`image.ts`、`scenes.ts` | 0 engine（元件）；store 要解開對 game 的循環 |
| `fx/fx.ts`、`fx/seen.ts`、`i18n/uiScript.ts`、`stores/prompts.ts`、`stores/settings.ts` 的模型來源部分 | `settings.ts` 的遊戲選項半部綁引擎 setter |
| 架構可重用、內容要重寫：`App.vue` 外殼、`MobileGame`、`EventCenter` + `eventQueue`、`MapPanel`／`AreaMap`（格子地圖，綁 `engine/grid` 的 Cell 種類與 `ui/tiles.ts`）、`NewGameView`、`ContentView` 的清單／頁籤骨架 |

| 綁定奇幻／本作系統（需重寫或捨棄） |
|---|
| `CombatView`（AP、法術環位、仇恨、慾望值）、`party/PaperDoll`、`party/CharacterDialog`、`PartyCards`、`memberInfo.ts` |
| `PlacePanel`（公會、王城、開鎖、苗圃）、`TavernPanel`、`TravelDialog`、`RestPanel`、`LandmarkPanel`、`ExpeditionBar` |
| `CraftPanel`、`RecipePanel`、`InventPanel`、`items/ShopDialog`、`MarketPanel`、`AuctionPanel` |
| H 組全部（契約、奴隸、娼館、刺青、融合祭壇、育兒）、`TattooPanel`、`MarkPicker`、`PurifyPanel`、`UncursePanel` |
| `content/` 的 19 個大 Editor（對應本作資料 schema）、`icons/*Art.ts`、`items/itemArt.ts`、`adult/deco.ts` |

## 5. 測試

- `vitest.config.ts`：happy-dom、`testTimeout` 30s，分兩個 project——`isolated`（內容含 `vi.mock`／`@/stores`／storage／`.vue` 的檔，自動偵測）與 `shared`（純引擎，`isolate: false`，每檔前跑 `src/__tests__/setup/resetGlobals.ts` 還原引擎的模組層級全域）。
- 全部在 `src/__tests__/`：**265 個 `*.spec.ts`**，連同輔助檔共 276 檔、約 40.6k 行。沒有 e2e。

| 類別（依 import 判定） | 檔數 | 行數 |
|---|---|---|
| 純引擎 | 154 | 21.9k |
| narrator | 44 | 7.4k |
| store（`setActivePinia` 48 檔） | 39 | 6.6k |
| 元件（`mount(` 僅 8 檔） | 15 | 1.5k |
| 其他（平衡模擬 `balance*.spec`、`docTables`、`editorRoundTrip*`（3 份 snapshot）、`worldCheck`、`wiki`、`guide`、`uiScript`） | 13 | 0.2k + 輔助檔 |

- **對應關係**：測試檔以「功能」命名（`campRest`、`lewdBrothel`、`storyCounters`…），不是一檔對一模組。以 import 反查：147 個引擎模組中只有 5 個沒有任何 spec 直接 import——`engine/resources`(92)、`travel`(88)、`builtinWorldReadme`(83)、`counterMods`(78)、`homeResolver`(17)，都很小。大模組覆蓋：`combat` 63 檔、`grid` 159、`mods` 75、`gear` 41、`trade` 34、`story` 24、`slavery` 23、`companions` 20。**相對薄的大模組**：`questGen`(640 行，2 檔)、`invention`(549，1 檔)、`masterHome`(531，2 檔)、`npcLife`(536，4 檔)、`sexRecord`(506，5 檔)、`pregnancy`(542，7 檔)。（只看 import 次數，沒有量 line coverage。）
- UI 幾乎沒測：216 個元件只有 8 個被 mount（`CombatView`、`ReportCard`、`GuardStatus`、`Hint`、`FoldSet`、`RequiresEditor`、`DungeonEditor`、`EnemyEditor`）。store：`game` 30 檔、`content` 16、`settings` 15；`characterPresets` 沒有測試。
- **狀態怎麼建**：200 個檔直接 `newGame({ name, race: 'human', classId: 'fighter', seed })`（`engine/state.ts:78`），用**真的內建資料**（`data/`）與固定 seed，再手動改 state。沒有 state builder／工廠；輔助只有 `helpers/fight.ts`（`fightToEnd`）、`helpers/travel.ts`（`arriveAt`、`walkTo`）、`testWorld.ts`（`editableWorld`）、`fixtures/`（舊存檔 `saves-v0.2.5.json`、comfy 工作流程、`race_combat.json`）。
- **能否隨模組移植**：斷言的邏輯結構可以，但 (1) 幾乎每檔都寫死本作的種族／職業／地點／物品 id 與中文名稱，(2) 依賴整份 `data/` 載入，(3) shared 組依賴 `resetGlobals.ts` 列出的引擎全域。移植一個模組時要先在新專案建 `makeState()` 工廠與最小測試資料，再改寫斷言中的 id。可原樣帶走的：`undo.spec`、`logArchive.spec`、`settingsFile.spec`、`saves.spec`、`regex`／`providers`／`vertex*`／`tavernPreset`／`comfy` 等 narrator 測試、`uiScript.spec`、`foldSet.spec`、`fxSeen.spec`。

## 6. 工具

| 項目 | 內容 | 可重用 |
|---|---|---|
| `package.json` scripts | `dev`、`build`（`type-check` + `build-only` 並行）、`preview`、`test:unit`（vitest）、`type-check`（`vue-tsc --build`）、`docs:gen`（`UPDATE_DOCS=1 vitest run docTables.spec.ts`，由資料重產文件表格）。**沒有 lint／format script** | 全部 |
| `vite.config.ts` | `woff2Only` plugin（砍 fontsource 的 woff）、`__APP_VERSION__`、`base: './'`、alias `@`／`@data` | 是 |
| `vitest.config.ts` | isolated／shared 雙 project 的自動分組 | 是（很值得帶） |
| `.github/workflows/release.yml` | tag `v*`：測試 → build → Pages + 本機版 zip（`release/local/` 的啟動腳本）→ 從 `CHANGELOG.md` 切 release notes | 是（改名稱與網址） |
| `.github/workflows/wiki.yml` + `tools/wiki/build.mjs` | docs → GitHub Wiki；`--check` 確保每份文件都登記（`wiki.spec.ts` 也跑） | 是，`GROUPS` 要重寫 |
| `tools/pixel/`、`tools/backgrounds/`、`tools/portraits/` | Python：用 ComfyUI／OpenAI／NovelAI 生像素圖示、背景、形象圖並後處理 | 流程可用，prompt 與 palette 是奇幻題材 |
| 資料驗證 | **不是獨立腳本**，寫成測試：`worldCheck.ts`（358 行，世界包匯入／引用／平衡檢查，`WORLD=路徑` 時跑）、`balanceSim.ts`、`lustBalanceSim.ts`、`docTables.ts`、`editorRoundTrip.ts`、`contentRefs`／`contentIssues`／`contentSafety` spec | 架構可用，內容綁本作 |
| `schemas/report.schema.json` | 唯一的 JSON Schema（374 行，Report 0.1：引擎輸出給 AI 的結構化報告）。約 9 個 spec 用 ajv 驗證產生的 Report | **可重用**——Report 是引擎↔敘事的合約，`kind` enum 要換 |
| `worldgen/` | 世界生成指南、平衡文件、`scripts/elondia/*.py`（一次性內容腳本） | 指南結構可參考，腳本不可 |

沒有驗證 `data/*.json` 的 JSON Schema；資料正確性靠 TS 型別 + `mods.ts` 的 normalize + 測試。

## 7. 死碼

| 項目 | 依據 |
|---|---|
| `src/components/StatBar.vue`（18 行） | `rev` 為空，全 repo grep 無引用 |
| `src/components/ui/Chip.vue`（23 行） | 同上 |
| `game.restAtSafeRoom`（`stores/game.ts`） | 全 `src`（含測試）只出現在定義處 |
| `prompts.isCustomLore`（`stores/prompts.ts`） | 只有定義與 return |
| `game.stopWalk`、`game.prunePortraits`；`portraits.versionBlob`、`withJob`；`questGen.draftId`、`removeDraft`、`evaluate` | 有回傳出去，但 store 外沒人用（內部有用）→ 不必 export |
| `game.runAction`、`flushed`、`hasProgress`；`content.diffMods`、`mergeMods`；`portraits.countFor` | **只有測試用**（`runAction` 26 個測試；註解寫「少數元件用」已過時，元件 0 次） |
| `settings.SOURCE_COUNT` | 連檔內都沒再用（只有宣告） |
| `portraits.ts`：`editInstruction`、`TWEAK_TEXT_STRENGTH`、`segmentKey`（scenes）等 | 有 export 但只在檔內用——多餘的 export，不是死碼 |
| `saves.useSlotStore`、`useCurrentStore`；`logArchive.ARCHIVE_BATCH`；`settings.narrateKindOf`；`settingsFile.stripKeys`／`fillKeys` | 測試用的接縫，保留 |

方法：`deps.json` 的 `rev` + 以字界 grep 檢查 store 的 top-level export 與 `return {…}` 成員。動態字串存取（`game[name]`）沒有檢查，但 grep 未見這種寫法。

## 8. 降熵建議（本區）

| # | 位置 | 問題 | 建議 | 風險 | 規模 |
|---|---|---|---|---|---|
| 1 | `stores/game.ts` `afterMove`、`run()` 管線、`load()`、`hire()` | 回合後規則與讀檔修復寫在 store，引擎單獨跑（測試、模擬）得不到同樣行為 | 搬進引擎（`engine/turn.ts` 的 `afterAction(state, before)`、`loadState()`），store 只留快照／存檔／敘事 | 中：順序敏感，要靠既有 30 個 game store 測試守 | M |
| 2 | `stores/game.ts` return 內約 200 個轉發 | 1,774 行的 god store；每加一個引擎動作要改 store | 泛用 `dispatch(fn, opts)` 或依領域拆 composable（`useTradeActions` 等），元件直接 `game.run(s => trade.buyDeal(s, …))` | 低–中：觸及 122 個元件的呼叫點 | L |
| 3 | 6 檔循環 | usage 型別／常數放在 game；`content` 反查 game | 抽 `stores/usage.ts`；型別移出；`content` 改收參數 | 低 | S–M |
| 4 | `components/events/eventQueue.ts` | 待回應事件的推導在 UI 層 | `engine/pendingEvents.ts` 回傳 `{id, kind, blocking, ref}`，標題／圖示留在 UI | 低（已有 `eventQueue.spec`） | S |
| 5 | `settings.ts` 的 12 個 `watch → engine.setXxx` | 引擎有模組層級全域設定，測試要靠 `resetGlobals.ts` 手動列清單 | 設定併入 `state.options` 或以 `EngineConfig` 物件傳入 | 高：碰引擎很多處 | L |
| 6 | `content.version` + 元件裡的 `void content.version` | 引擎資料非響應式，靠手動觸碰計數器，漏寫就不更新 | 提供 `useContentData(() => …)` composable 統一依賴 | 低 | S |
| 7 | `App.vue` 的 `window` CustomEvent（`elondia:open-settings`、`elondia:open-slaves`）+ 約 10 個 `showXxx` ref | 導覽是事件 + 布林散落；手機與桌面各接一次 | 一個 `useUi()` store 管對話框堆疊 | 低 | S–M |
| 8 | `PeoplePanel`／`TavernPanel` 的 hire、`ContractDialog`／`OwnedSlavesDialog` 的 `affPos`／`pct`、`CombatView`／`memberInfo` 的抗性倍率、`TravelDialog.fareOf`、`PlacePanel.lockBonus` | 重複的預覽算式 | 引擎提供 `*Preview()`；格式化抽 `ui/format.ts` | 低 | S |
| 9 | 樣式 | 間距無 token、691 個寫死 hex、斷點 7 種 | 補 `--space-*`、語意色、統一斷點常數；`.parchment` 改成 `[data-surface]` | 低（純視覺），量大 | M–L |
| 10 | `src/components/` 根目錄 89 檔平鋪 | 找檔困難；`home/` 目錄與 `HomePanel`／`HomeView` 命名混淆 | 依第 1 節的組分資料夾 | 低（只動 import） | S |
| 11 | 巨型 SFC：`ContentView` 1,236、`CombatView` 1,080、`ItemEditor` 837、`NewGameView` 690、`PlacePanel` 617 | 一檔多職 | `PlacePanel` 依設施拆、`CombatView` 拆演出佇列與面板 | 中 | M |
| 12 | 測試建 state | 200 檔手寫 `newGame` + 改欄位，綁真資料 | 加 `makeState()`／`withParty()` 工廠與最小測試世界 | 低 | M |
| 13 | 死碼 | 第 7 節 | 刪 `StatBar`、`ui/Chip`、`restAtSafeRoom`、`isCustomLore`、`SOURCE_COUNT`；修正 `runAction` 註解 | 極低 | S |
| 14 | 沒有 lint／format | 風格只靠人 | 加 eslint + `vue/no-unused-components` 等 | 低 | S |

## 無法確認的事項

- 沒有執行 `vitest`／`vue-tsc`，測試是否全綠、實際覆蓋率未知；「模組↔測試」只依 import 反查。
- (c) 類清單來自 grep 與抽讀，未逐行審 35k 行元件；19 個大 Editor 與 `NewGameView`、`CraftPanel`、`CharacterDialog` 的 script 沒有細讀，可能還有內嵌的驗證／預覽規則。
- `docs/MOBILE_UI.md`、`CONTENT_EDITOR.md`、`I18N.md`、`SAVES.md` 只讀了開頭與章節標題。
- 寫死 hex 的數字包含 SVG 與註解中的色碼，是上限估計。
- `tools/*.py`、`worldgen/scripts` 只看了檔名與 README 標題。
