# 01 地基與行動／效果管線掃描（ElondiaRPG `src/engine`）

唯讀掃描，沒有改動 repo。行號以掃描當下的檔案為準。
分析腳本與中間結果：`/tmp/claude-0/-home-user-CyberpunkPink/59ded358-0440-5225-ba4d-18b6cdad343b/scratchpad/scan/f/`（`rt.py` 區分 runtime / type-only import，`rt.json` 是結果）。

## 0. 最重要的結論

1. **101 模組的大循環有一部分是假象**。把 `import type`（與全部是 `type X` 的具名匯入）拿掉之後，runtime 循環是 **86 個模組**；`data.ts`、`types.ts`、`rng.ts`、`money.ts`、`content.ts`、`checks.ts`、`script.ts`、`world.ts`、`gameRules.ts`、`actions.ts` 都**不在** runtime 循環裡。（我用 engine 內的檔案算出 type+runtime 是 100，和已知的 101 差 1，沒有追查差在哪。）
2. **剩下的 86 模組循環沒有「切幾條邊就分層」的解**：循環內有 696 條邊、45 對互相匯入；把 14 個樞紐模組的對外匯入全部清空，還剩 9 個模組的循環。它是功能模組彼此直接呼叫造成的，不是少數幾條壞邊。
3. 對新專案的意義：**不要搬循環，搬「形狀」**。可以直接帶走的是葉子模組與幾個小而完整的機制（rng、檢定程度、報告結構、回退、存檔槽、旗標／計數器、世界包格式、路徑規劃）；`state.ts`、`effects.ts`、`actions.ts`、`mods.ts`、`data.ts` 要照同樣的設計重寫成「核心＋註冊」的樣子。
4. 規則有一段住在 engine 外面：`src/stores/game.ts` 的 `run()`、`afterMove()`、`load()` 決定「每個動作之後要跑哪些 tick」與「讀檔要修哪些東西」。

## 1. 各管線

### 1.1 總表

| 管線 | 入口（檔案：函式） | 可攜性 | 奇幻假設 |
|---|---|---|---|
| 報告產生與提交 | `state.ts:593 commitReport`、`state.ts:567 newReportId`、約 26 個 `xxxReport()` 工廠（`town.ts:39 baseReport` 等） | 結構可帶走，`commitReport` 要重寫 | `ActorState.race/class/level/mp`、`Changes.xp/level_up/hit_dice/resources(slot)/merit/rank_up`、`commitReport` 內的升級與公會階級 |
| 存檔／讀檔／遷移 | `stores/saves.ts`（`slotStore`、`currentStore`、`parseSaveFile`）、`state.ts:382 migrate`、`state.ts:191 SCHEMA_STEPS`、`stores/game.ts:217 load`、`:865 enter` | 儲存層幾乎原樣可用；遷移內容全部丟掉 | `SlotMeta.race/cls/level`、`assertClasses`、`migrate` 裡的 mp→法術環轉換 |
| 回退 | `stores/undo.ts`（`restoreTurn`、`firstNewReport`、`midTurn`）、`stores/game.ts:394 run`、`:628 snapshotState`、`:476 undo` | 原樣可用（76 行，純函式） | 無（`midTurn` 看 `combat`/`pendingAction` 兩個欄位） |
| 效果模板 | `effects.ts:45 RewardEffect`、`:204 applyEffects`、`:170 affordable` | 設計可用，實作要拆 | `xp`、`slot`（法術環）、`hit_dice`、`ability`（職業、環階）、`ability_pool`（等級）、`meet`（race/class/level） |
| 主動行動 | `actions.ts:181 prepareAction` → `stores/game.ts:1283 judge`（`narrator/compose.ts composeJudge`）→ `actions.ts:318 sanitizeJudgment` → `:679 resolveAction` | 三段式流程可帶走，檔案本身要重寫 | d20、五屬性、`proficiency(level)`、`money_cc_per_level`、`xp_per_level`、法術環加值 |
| 技能檢定 | `checks.ts`（`computeDegree`、`clampDegree`、`naturalCritOnly`）、`rollParts.ts rollBreakdown`、`perks.ts checkModifiers` | `checks.ts` 幾乎原樣 | 自然 20／自然 1 寫死 |
| 劇情旗標／特殊任務 | `storyFlags.ts`（`hasFlag`、`condMet`、`counterValue`、`addCounters`）、`story.ts`（`startStory`、`playNode`、`applyStoryCheck`、`startAutoStories`） | 旗標與計數器可帶走；`story.ts` 要解耦 | `pc_races`、`start.min_level`、`StoryDef.rank`（公會階級） |
| 內容載入＋覆寫 | `data.ts`（JSON→單例）、`mods.ts:503 applyContent`、`:1165 normalizeMods`、`worldPackage.ts`、`contentRefs.ts`、`contentImport.ts`、`stores/content.ts` | 「快照→還原→套用」的做法可帶走；程式碼不行 | 整份 `ContentMods` 的 section 都是這個遊戲的內容種類（classes、abilities…） |
| 亂數 | `rng.ts`（`Rng`、`roll`、`withBonus`）、`state.ts:534 withRng` | 原樣可用 | 無 |
| 時間 | `state.ts:551 addHours`、`:544 advanceTime`、`:561 formatTime`、`timeOfDay.ts`、`deadlines.ts` | `addHours`/`timeOfDay` 可帶走 | 無（但跨日 tick 寫死在 `state.ts`） |

### 1.2 報告／日誌

- 每個玩家動作產生一個 `Report`（`types.ts:189`）：`time{start,end}`、`location`、`party` 快照、`timeline`（擲骰）、`outcome`、`changes`（差異）、`check`、`narration`（給 AI 的提示）。
- 功能模組自己組報告骨架，再呼叫 `commitReport`（`state.ts:593`，engine 內 47 個檔案、約 130 處呼叫）。這是**唯一**把 `changes` 寫進狀態、推進時間、把報告推進 `state.reports` 的地方。
- `changes` 的套用不一致：金錢、物品、好感、聲望、旗標、經驗、功績由 `commitReport` 套用；入隊、狀態、生命值、特質、刺青等由 `applyEffects` 或功能模組**直接改狀態**，`changes` 只是紀錄（`effects.ts:7-8` 的註解寫明）。所以 `changes` 不能重播。
- `commitReport` 夾帶功能邏輯：特殊地圖場景描述（603-613）、`lewdDaily`/`noteAdultScene`（616-617）、主人抽成 `masterTake`（629）、`noteLoot`、`addMerit`/`applyRankUp`、`gainXp` 升級（649-662）、`recordMemory`、`familyTick`。這是 `state.ts` 被拉進循環的主因之一。
- 日誌瘦身在 engine 外：`stores/logArchive.ts:39 archiveOldReports`（由 `run()` 呼叫）。AI 敘事另存在 `narrations`（store），不在 `GameState`。

### 1.3 存檔／讀檔／遷移

- 儲存：`stores/saves.ts` 的 `SlotStore`（IndexedDB，退回 localStorage）與 `CurrentStore`（進行中的遊戲，state／narrations／usage 分三份字串）。介面乾淨、可替換（`useSlotStore`、`useCurrentStore` 供測試）。
- 遷移有兩層：有版本號的 `SCHEMA_STEPS`（`state.ts:191`，目前 `SAVE_SCHEMA = 11`，`:456-461` 逐步套用），以及 `migrate()` 內約 90 行**沒有版本號、每次讀檔都跑**的補欄位與改名（`:382-475`）。
- 讀檔還有第三層在 store：`stores/game.ts:217 load()` 依序呼叫 `migrate`、`repairStrandedRoad`、`enforceClassWeapons`、`pruneStories`、五種 `pruneXxxEvent`、`syncGear`、`syncMasterHome`、`ensureRoster`、`checkClassRebalance`、`startAutoStories`。
- 存檔綁世界：`enter()`（`game.ts:865`）先 `useContent().enterWorld(state.world, data.content)` 再 `load`；`SaveData.content` 可帶自訂內容快照。
- 保護：`assertSchema`（新版存檔拒讀）、`assertClasses`（職業不存在拒讀）。

### 1.4 回退

- `run()`（`game.ts:394`）每個動作前 `snapshotState`（`structuredClone`，`reports`／`logArchive` 只淺複製陣列），丟例外時整份還原。
- 回退只是保留其中最多 5 份（`UNDO_STEPS`），以「產生新日誌的一輪」為單位；戰鬥中與等待判定時不開新的一輪（`midTurn`）。只放在記憶體，不進存檔。
- `restoreTurn` 回退時**換亂數種子**（允許重擲），並保留回退期間才封存的日誌。
- 注意：淺複製假設「舊報告不會被改」。`game.ts:1177 narrateWith` 會改既有報告的 `narration.player_intent`，我沒有驗證它改的是不是快照共用的同一個物件。

### 1.5 效果模板

- `RewardEffect` 是 43 種的 tagged union；`applyEffects(state, report, effects)` 是一個 400 行的 `switch`，回傳給玩家看的說明字串。20 個模組呼叫它（事件、任務、談判、打工、戰敗、地標…）。
- 沒有註冊機制：加一種效果要改 union、`EFFECT_TYPES`、`switch`、`storyMods.ts` 的 `sanitizeEffects`、`actions.ts` 的 `EFFECT_OF` 與 `sanitizeJudgment`。`effects.ts` 因此匯入 30 個功能模組。
- 與設定無關、可直接保留的種類：`money`、`item`、`affinity`、`reputation`、`flag`、`memory`、`condition`、`hp`、`relationship_text`、`meet`、`companion`/`leave`、`intel`/`rumor`、`start_story`、`quest_reward`/`quest_flag`、`gear`、`blueprint`。
- 奇幻專屬：`xp`（:242）、`slot`（:344，法術環）、`hit_dice`（:351）、`ability`（:522-571，`classAbilities(who.class)`、`maxCircle`、`type === 'spell'`）、`ability_pool`（:199，`unlock <= who.level`）。其餘（奴隸、刺青、寄生、懷孕、泌乳…）是這個遊戲的成人向系統。

### 1.6 主動行動（擲骰 → AI 判定 → 夾住的後果）

- `prepareAction`：檢查阻擋狀態 → `setupFor`（`companions.ts`，算 DC／屬性／情境修正）→ 扣能力資源 → 用 `withRng` 擲 1d20 → 存進 `state.pendingAction`（重新整理不會重擲）。
- store 的 `judge()` 組提示詞、呼叫模型、`extractJson`，交給 `sanitizeJudgment`：屬性不合法用預設、DC 夾在 `base_dc ± dc_adjust`、成功程度照存檔規則收斂、效果只留 `actionRules.kinds[kind].effects` 允許的種類，數值照 `actionRules.caps` 夾住，被截掉的寫進 `adjusted` 交給寫手。
- `resolveAction`：算參考程度 → 建報告 → `applyMechanics`（42 種行動的大 `switch`，:791）→ `applyEffects` → `commitReport`。AI 關閉時走 `defaultEffects`。
- 這個「程式擲骰、AI 只能在封閉清單與上限內提議」的三段式是最值得帶走的設計；但 `actions.ts` 本身匯入 42 個模組，不能直接搬。
- 奇幻假設：`roll(rng,'1d20')`（:234）、`proficiency(pc.level)`（:251、:670）、`caps.money_cc_per_level * pc.level`（:405）、`caps.xp_per_level * pc.level`（:554）、裝備等級上限 `pc.level`（:516-529）、法術環加值（:228）、`ATTR_IDS` 五屬性、`lewdModifiers`（:291）。

### 1.7 技能檢定

- `checks.ts`（36 行）：`computeDegree(natural, total, dc, naturalOnly)` 回傳五級 `Degree`；門檻來自 `actionRules.degrees`（`data/rules/actions.json`）。只依賴 `data.ts` 的 `actionRules` 與型別。
- 修正的來源在 `perks.ts checkModifiers`／`checkSkills`（特質、狀態、標籤），拆解顯示在 `rollParts.ts rollBreakdown`。
- 奇幻假設只有「自然 20 大成功、自然 1 大失敗」寫死（:18-19、:33-34）。

### 1.8 劇情旗標／特殊任務

- 旗標是 `state.flags` 上的字串鍵：`story:<名稱>`、`count:<計數器>`、`ai:<AI 設的>`，另有 `black_market:`、`underworld:`、`invite_wait:` 等功能自己的前綴。
- `condMet`（`storyFlags.ts:36`）是唯一的條件判斷，但把功能條件寫死在一個運算式：寄生物、慾望指標、魅力、穿著、`pc_races`、懷孕、泌乳、孩子。
- `story.ts`（1059 行）：`StoryDef` → 任務點 `StoryNode` → 選項／檢定／戰鬥 → `StoryOutcome`（旗標、計數器、效果、時間跳躍）。靜態分析在 `storyReach.ts`、`storylines.ts`、`storyGraph.ts`（只依賴 `data.ts` 的型別與資料，給編輯器用）。
- `story.ts` runtime 匯入 24 個模組（combat、grid、guild、road、specialMaps、underworld…），和 `effects.ts`、`combat.ts`、`grid.ts` 等 7 個模組互相匯入。
- 旗標寫入有兩條路：`report.changes.flags`（由 `commitReport` 套用）與直接寫 `state.flags[...]`（`companions.ts` 4 處、`town.ts`、`askAround.ts`、`underworld.ts`、`sexRecord.ts`、`masterHome.ts`）。`storyFlags.ts` 的 `setFlag`／`clearFlag` 只有測試在用。

### 1.9 內容載入＋模組／世界包覆寫

- `data.ts`（2706 行、280 個匯出）在模組載入時匯入 33 個 JSON，轉成**可變的模組層級單例**，同時定義幾乎所有領域型別。它 runtime 不匯入任何 engine 模組（葉子）。
- `mods.ts`：載入時 `clone` 一份內建快照（:177）；`applyContent(mods)`（:503）先 `restore()` 把單例原地還原，再照固定順序套用各 section（順序有相依：標籤→職業→狀態→…），每筆 `try/catch` 收集問題。之後呼叫 `bumpContentRevision()` 讓快取失效。
- 每種內容各有 `xxxMods.ts`（sanitize／apply／restore）。`worldPackage.ts`（52 行）只定義檔案格式；`contentRefs.ts` 建參照圖（匯出時帶相依項目）；`contentImport.ts` 處理匯入衝突；`builtinWorld.ts` 是內建世界的 zip 匯出入（用 `fflate`）。
- 世界管理（多個世界、切換、綁提示詞組）在 `stores/content.ts`（1392 行），不在 engine。
- 風險：全域單例代表同一時間只能有一個世界；測試之間會互相影響；`applyContent` 的套用順序是隱性規則。

### 1.10 亂數

- `rng.ts`：mulberry32，種子存在 `state.rngState`；`withRng(state, fn)` 執行後寫回。`roll(rng,'2d6+1')` 解析骰式。
- engine 內的 `Math.random` 只用在產生 id 與新遊戲種子（`state.ts:79`、各 `xxxMods.ts` 的 `newId`），沒有混進規則。回退時由 `undo.ts` 換種子。

### 1.11 時間

- `GameTime {day, hour?, minute?}`，day 從 1 起算。只有兩處寫 `state.time`：`advanceTime`（`state.ts:546`）與 `commitReport`（:614）。
- 跨日 tick 寫死：兩處都直接呼叫 `lewdDaily` 與 `familyTick`。其他「每個動作之後」的 tick（`expireDeadlines`、`tickNpcLife`、`startAutoStories`、`forgetStoryWaits`）在 store 的 `run()`。
- `timeOfDay.ts`：白天／夜裡與 `TimeJump`（推到夜裡／隔天早上）。`deadlines.ts`：委託與任務期限。

## 2. 為什麼有 101 模組的循環

### 2.1 type-only 邊（把地基拉進循環的假邊）

| 邊 | 匯入的型別 | 處理方式 |
|---|---|---|
| `data.ts → effects.ts` | `RewardEffect` | 型別移到 `types` 層 |
| `data.ts → light.ts` | `Lighting` | 同上 |
| `data.ts → types.ts`、`types.ts → data.ts` | 互相引用領域型別 | 合成一個純型別層 |
| `types.ts → actions.ts` | `ActionPending` | `GameState` 的欄位型別放回 `types` |
| `types.ts → combat.ts` | `CombatState` | 同上 |
| `types.ts → grid.ts` | `Area`、`Position` | 同上 |
| `types.ts → effects.ts / bestiary.ts / social.ts / classRebalance.ts` | `RewardEffect`、`BestiaryEntry`、`Memory`、`Relationship` | 同上 |

這些邊編譯後不存在，不影響執行；只影響「能不能單獨搬一個檔案」。只在 type+runtime 圖裡才進循環的模組：`actions`、`bestiary`、`bindRulesMods`、`checks`、`data`、`fieldCast`、`gameRules`、`homeResolver`、`look`、`tools`、`traits`、`types`、`upcast`、`world`。

### 2.2 runtime 邊（真正的循環，86 個模組）

- `state.ts` 同時是最底層的工具（`withRng`、`addItem`、`addHours`、`commitReport`，被 76 個模組匯入）和最上層的組裝（`newGame`、`migrate`），runtime 匯入 19 個功能模組：`perks`、`character`、`specialMaps`、`parasites`、`pruneLocations`、`expedition`、`gear`、`guild`、`slavery`、`social`、`tattoos`、`lewd`、`pregnancy`、`pcTags`、`crafting`、`npcs`、`look`、`traits`、`sexRecord`。
- `effects.ts` 匯入 30 個功能模組，又被其中的 `story`、`slavery`、`brood`、`lactation` 匯入回來。
- 連「看起來是底層」的模組也往上匯入：`light.ts → state.ts`、`timeOfDay.ts → state.ts + light.ts`、`storyFlags.ts → lewd / parasites / gear / tattoos / charm / schools / pregMarks`、`npcs.ts → storyFlags.ts`、`gear.ts ↔ perks.ts`、`perks.ts → party.ts`、`party.ts ↔ grid.ts`、`grid.ts` 匯入 31 個模組（含 `combat`、`story`）。
- 量化：循環內 696 條邊、45 對互相匯入。逐一清空樞紐模組的對外匯入（貪婪選擇）：`companions`→76、`perks`→71、`lewd`→65、`pcTags`→60、`state`→55、`charm`→50、`party`→45、`rest`→41、`combat`→37、`slavery`→34、`town`→31、`grid`→27、`road`→21、`effects`→9。

結論：**沒有「一小組邊」**。要分層得改結構（見 3.3），不是刪 import。

### 2.3 第二個循環（`*Mods`）

runtime 是 7 個模組（`itemIcons.ts → mods.ts` 是 type-only）。真正造成循環的只有 3 條邊，都是為了拿 `mods.ts` 裡的 sanitize 工具：

| 邊 | 匯入 |
|---|---|
| `storyMods.ts → mods.ts` | `sanitizeCond`、`sanitizeCounterDeltas`、`sanitizeGearSpecLoose` |
| `dungeonMods.ts → mods.ts` | `sanitizeCond` |
| `travelEventMods.ts → mods.ts` | `sanitizeCond` |

把這三個函式搬到一個葉子檔，循環就消失（S 級修改）。

## 3. 可攜性與建議分層

### 3.1 幾乎原樣可帶走

| 模組 | 行數 | 要改的地方 |
|---|---|---|
| `rng.ts` | 50 | 無 |
| `checks.ts` | 36 | 門檻改由參數傳入；自然 20／1 視新規則調整 |
| `stores/undo.ts` | 76 | 只依賴 `GameState` 的 `reports`、`logArchive`、`rngState`、`combat`、`pendingAction` |
| `stores/saves.ts` | 364 | `SlotMeta` 的 `race/cls/level` 與 `slotTitle`；DB 名稱 `elondia` |
| `stores/logArchive.ts` | 67 | 無 |
| `worldPackage.ts` | 52 | 檔案 type 字串 |
| `world.ts` | 91 | 改成接收路線資料而不是匯入 `geography` |
| `script.ts` | 19 | 依賴 `opencc-js`；只有保留繁簡比對時才需要 |
| `content.ts` | 128 | 標籤清單全換；「設定用模組層級變數」的做法可留 |
| `timeOfDay.ts` | 65 | `addHours` 與 `isNight` 改成從核心匯入 |
| `storyReach.ts`、`storylines.ts` | 122＋75 | 只依賴 `StoryDef` 型別 |
| `contentRefs.ts`、`contentImport.ts` | 212＋144 | section 清單換成新遊戲的 |

### 3.2 要先解開

| 模組 | 問題 | 做法 |
|---|---|---|
| `state.ts` | 工具＋組裝＋遷移混在一起；`commitReport` 內有功能邏輯 | 拆成 `core/state`（`withRng`、`addItem`、`removeItem`、`addHours`、`formatTime`、`newReportId`、`commitReport`＋hook）、`newGame`、`migrate` |
| `effects.ts` | 一個 `switch` 認識所有功能 | 改成 `registerEffect(type, {apply, sanitize, cap})`；核心只留通用種類 |
| `actions.ts` | `applyMechanics` 的 42 路 `switch`；`sanitizeJudgment` 每種效果一段 | 行動種類也註冊；夾值規則跟著效果的註冊走 |
| `storyFlags.ts` | `condMet` 寫死功能條件 | 旗標／計數器／好感／`after` 留在核心，其他條件用 `registerCond` |
| `story.ts` | 匯入 24 個模組 | 任務狀態機留下；地圖標記、同行夥伴、戰鬥接續改成回呼 |
| `data.ts` | 型別＋JSON＋查詢＋可變單例 | 拆成型別、載入器、各領域的查詢 |
| `mods.ts` | 2084 行：覆寫引擎＋各種 sanitize＋用途查詢＋編輯器輔助 | 覆寫引擎（快照／還原／套用／問題收集）獨立，內容種類註冊進來 |
| `gameRules.ts` | 機制 40 行，其餘是這個遊戲的規則表 | 帶走 `RuleDef`＋`gameRule`＋`sanitizeRules` 的形狀 |
| `deadlines.ts`、`usage.ts` | 依賴 guild、town、story、gear、homes… | 新專案照需要重寫 |

### 3.3 建議的核心套件（由下到上）

```
L0 型別      GameTime、Report、Changes、TimelineEntry、CheckInfo、Degree、GameState 骨架（只有型別，不匯入任何東西）
L1 純工具    rng、time（addHours／hoursBetween／formatTime）、money 格式、sanitize 工具（num／int／str／clamp）、id 產生
L2 內容      載入器、內容登錄表、覆寫引擎（快照→還原→套用）、世界包格式、參照圖
L3 狀態核心  withRng、背包、旗標／計數器、commitReport（套用通用 changes＋onCommit／onDayPassed hook）
L4 規則核心  checks、效果登錄表（applyEffects）、條件登錄表（condMet）、存檔規則表（gameRule）
L5 行動核心  prepare → judge 介面 → sanitize（封閉清單＋上限）→ resolve；行動種類登錄表
L6 功能      戰鬥、裝備、任務、NPC…：只往下匯入，用註冊把自己接進 L3–L5
L7 殼        存檔槽、回退、遷移步驟表、回合管線（run）、AI 提示詞
```

規則只有一條：L6 的功能模組之間要互相用到時，透過 L3–L5 的 hook 或登錄表，不直接匯入。

## 4. 重複、沒用到的匯出、engine 外的規則

### 4.1 重複實作

| 內容 | 位置 |
|---|---|
| `GameTime` 換算成小時／分鐘 | 約 17 處各寫一份，而且有兩種起算（`day*24` 與 `(day-1)*24`）：`deadlines.ts:16`、`masterHome.ts:26`、`garden.ts:11`、`away.ts:52`、`town.ts:173`、`townEvents.ts:25`、`parasiteEvents.ts:39`、`social.ts:210`、`slaveEvents.ts:20`、`rest.ts:69`、`pregnancyEvents.ts:55`、`pregnancy.ts:45`、`storyFlags.ts:66`、`dungeonEvents.ts:24`、`slavery.ts:494`、`timeOfDay.ts:58`、`narrator/continuity.ts:39`，還有兩個 `.vue` |
| 分鐘 → `GameTime` | `state.ts:551 addHours`、`storyFlags.ts:79`、`narrator/continuity.ts:43` |
| 報告骨架 | 約 26 個 `xxxReport()` 工廠，各自寫 `schema_version: '0.1'`、`party.map(snapshot)`、`lore_keys` |
| sanitize 小工具 `num`／`int`／`str`／`clip`／`clamp` | 約 23 個檔案各自定義（`mods.ts`、`storyMods.ts`、`actions.ts`、`dungeonMods.ts`…）；`clamp` 有 7 份 |
| 骰式正規表示式 | `rng.ts:35 DICE_RE` 與 `mods.ts:688 DICE`＋`parseDice`／`formatDice` |
| 自建 id 產生 | `mods.ts:2061`、`dungeonMods.ts:102`、`landmarkMods.ts:66`、`shopMods.ts:88`、`specialMapMods.ts:47` |
| 「誰用到這筆內容」 | `usage.ts`（enemy／item／gear／npc／story／perk）、`mods.ts`（`conditionUsage`、`parasiteUsage`、`statusUsage`、`abilityUsage`）、`contentRefs.ts buildRefs` 三套 |
| 「找主角」 | `state.ts:527 player`、`party.ts pcOf`、`storyFlags.ts` 內 7 次 `state.party.find((m) => m.isPlayer)` |
| 學會能力並記進報告 | `effects.ts:191 teachAbility` 與 `:546-549`、`:565-567` 兩段幾乎相同 |
| 讀同一個 JSON | `money.ts` 與 `data.ts` 都匯入 `economy.json`；`gameRules.ts` 另外匯入 6 個規則 JSON（`slavery.json`、`lewd.json` 和 `data.ts` 重複） |

### 4.2 沒用到的匯出

整個 `src`、`tools`、`worldgen` 都沒有其他引用（只有定義那一行）：

- `mods.ts`：`tableLabel`、`builtinItem`
- `effects.ts`：`EFFECT_TYPES`
- `story.ts`：`storyProgress`

只有測試在用：`storyFlags.ts` 的 `setFlag`／`clearFlag`、`state.ts assertClasses`（在 `migrate` 內部有用）、`data.ts indexById`（內部有用）／`skillOfAction`、`story.ts` 的 `storyPaused`／`nodeIsHere`／`nodeHours`／`storyWearUnfit`、`timeOfDay.ts jumpFrom`。

另有約 90 個「匯出了但只在自己檔案裡用」的名稱（多數是型別），例如 `effects.ts` 的 `resolveNpc`／`poolAbility`、`actions.ts` 的 `situationalFor`／`adultSceneFor`、`worldPackage.ts` 的 4 個、`builtinWorld.ts` 的 8 個、`data.ts` 的 34 個型別。完整清單可用 `f/dead.py` 重跑。這是以名稱比對得出的，沒有用編譯器驗證。

### 4.3 住在 engine 外的規則

| 位置 | 內容 |
|---|---|
| `stores/game.ts:394 run()` | 每個動作之後依序：`startAutoStories` → `expireDeadlines` → `tickNpcLife` → `forgetStoryWaits` → `archiveOldReports`；還有自動存檔的條件（長休、抵達） |
| `stores/game.ts:191 afterMove()` | 每走一步的事件順序：敵對冒險者 → 歸隊 → 主人事件 → 奴隸事件 → 城鎮事件 → 寄生發作 → 懷孕事件 |
| `stores/game.ts:217 load()` | 讀檔修復與 prune 的順序（見 1.3） |
| `stores/game.ts:1283 judge()` | AI 判定失敗的處理、`splitNarrative`、判定敘事和成人寫手分流 |
| `stores/content.ts` | 世界切換、內容改變後要呼叫哪些 `pruneXxx` |
| `stores/game.ts:261` | `perkPitch.ai` 由 store 寫進 engine 的模組變數 |
| `content.ts` | 內容篩選是模組層級變數，由設定 store 呼叫 `setContentFilters` 等寫入；不在 `GameState`，也不進存檔 |

## 5. ElondiaRPG 本身的減熵建議

| # | 位置 | 問題 | 建議 | 風險 | 大小 |
|---|---|---|---|---|---|
| 1 | `mods.ts` 的 `sanitizeCond`／`sanitizeCounterDeltas`／`sanitizeGearSpecLoose` | 造成 `*Mods` 的 7 模組循環 | 搬到葉子檔（例如 `modSanitize.ts`），`mods.ts` 重新匯出 | 低 | S |
| 2 | engine 內約 17 處時間換算 | 兩種起算，容易差一天 | 在一個檔案提供 `minutesOf`／`hoursBetween`／`fromMinutes`，逐一替換 | 低；要確認每處原本用哪種起算（相減時不影響，和絕對值比較時會） | S |
| 3 | 約 23 個檔案的 `num`／`int`／`str`／`clamp` | 重複，行為略有不同 | 集中成一個 sanitize 工具檔 | 低；各份的預設值與上下限寫法不同，要逐一對照 | S–M |
| 4 | `types.ts` 與 `data.ts` 的 type-only 回邊 | 地基看起來在循環裡，單檔搬不走 | `ActionPending`、`CombatState`、`Area`、`Position`、`RewardEffect`、`Memory`、`Relationship`、`Lighting` 的定義移進純型別檔，原檔重新匯出 | 低（只動型別） | M |
| 5 | `state.ts` | 工具、`newGame`、`migrate` 同檔；19 條往上的 runtime 匯入 | 拆成 `stateCore.ts`（葉子）＋`newGame.ts`＋`migrate.ts`；`state.ts` 暫時重新匯出 | 中；76 個匯入者，但重新匯出可以不動它們 | M |
| 6 | `state.ts:593 commitReport`、`:544 advanceTime` | 寫死 `lewdDaily`、`familyTick`、`noteLoot`、`addMerit`、`gainXp`、`recordMemory` | 改成 `onCommit`／`onDayPassed` 的訂閱清單，功能模組自己註冊 | 中；呼叫順序有意義，要用固定順序的清單並補測試 | M |
| 7 | `state.ts:382 migrate` | 約 90 行沒有版本號的補丁每次讀檔都跑 | 新的補丁一律進 `SCHEMA_STEPS`；舊的逐步收進一個步驟 | 中；舊存檔的行為要用測試存檔守住 | M |
| 8 | `stores/game.ts` 的 `run()`、`afterMove()`、`load()` | 回合與讀檔的規則在 store，engine 測試跑不到 | 搬成 engine 的 `afterAction(state)`、`afterStep(state)`、`loadState(state)`，store 只呼叫 | 低–中；`run()` 裡和 UI 交錯的部分要留在 store | M |
| 9 | 旗標寫入 | `changes.flags` 與直接寫 `state.flags` 兩條路；`setFlag` 只有測試用 | 統一成一條；直接寫的 9 處改用 `setFlag` 或 `changes.flags` | 低；改成 `changes.flags` 會把生效時間延到提交，要逐處確認 | S |
| 10 | 約 26 個 `xxxReport()` 工廠 | 骨架重複 | 一個 `makeReport(state, {kind, hours, scene})`，各工廠只補差異 | 低 | M |
| 11 | `effects.ts applyEffects` | 400 行 `switch`、30 個匯入；加效果要改 5 個地方 | 效果登錄表：每個功能模組註冊自己的 `apply`、`sanitize`、判定上限 | 中–高；牽涉 `storyMods.ts` 與 `actions.ts` 的驗證 | L |
| 12 | `actions.ts applyMechanics`、`sanitizeJudgment` | 42 路 `switch`、42 個匯入 | 行動種類登錄表（`setup`、`apply`） | 中–高 | L |
| 13 | `storyFlags.ts condMet` | 功能條件寫死，拉進 `lewd`、`parasites`、`gear` 等 7 個匯入 | 條件登錄表；核心只留旗標、計數器、好感、`after` | 中 | M |
| 14 | `data.ts` | 2706 行、280 個匯出 | 照領域拆檔，`data.ts` 留作重新匯出的入口 | 低（機械式）但 diff 很大 | L |
| 15 | `mods.ts` | 2084 行混四種職責 | 覆寫引擎、各內容的 sanitize、用途查詢、編輯器輔助分開；用途查詢和 `usage.ts` 合併 | 中 | L |
| 16 | `mods.ts tableLabel`／`builtinItem`、`effects.ts EFFECT_TYPES`、`story.ts storyProgress` | 沒有引用 | 刪除 | 低 | S |
| 17 | `effects.ts:546-549`、`:565-567` | 和 `teachAbility` 重複 | 改呼叫 `teachAbility` | 低；日誌文字「領悟了／學會了」不同，要保留 | S |
| 18 | `stores/game.ts:628 snapshotState` | `reports` 淺複製，假設舊報告不變 | 確認 `narrateWith` 等改報告的路徑；必要時複製最後一則 | 低 | S |

## 6. 沒有驗證的部分

- 沒有執行測試、沒有跑 `tsc`；所有結論來自讀程式碼與 import 的正規表示式分析。type-only 的判斷依據是 `import type` 或具名匯入全部標 `type`，沒有檢查 `verbatimModuleSyntax` 之類的編譯設定。
- 我算出的 type+runtime 循環是 100 個 engine 模組，和已知的 101 差 1，沒有追查。
- `docs/*.md` 只看了 `SAVES.md` 的標題；`GAME_DESIGN.md`、`EFFECTS.md`、`ACTIONS.md`、`STORY_QUESTS.md` 沒有讀，文件和程式是否一致沒有比對。
- `story.ts`、`mods.ts`、`data.ts`、`stores/content.ts`、`builtinWorld.ts`、`contentRefs.ts`、`contentImport.ts`、`storyGraph.ts`、`usage.ts`、`deadlines.ts` 只讀了大綱與關鍵段落，沒有逐行讀。
- 「沒用到的匯出」是全字比對，可能漏掉動態存取或同名的誤判。
- `narrator/`（提示詞組裝、`extractJson`）不在這次範圍，只確認了呼叫點。
- 1.4 提到的 `narrateWith` 是否會改到回退快照共用的報告物件，沒有驗證。
