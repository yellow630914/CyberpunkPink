# CyberpunkPink 互動介面（第四版）

這是遊戲介面的**參考實作**：Vue 3 + Pinia + Vite + TypeScript，和引擎預定的技術相同（[IMPLEMENTATION](../docs/plan/IMPLEMENTATION.md) 第 1 節）。它取代 `docs/mockups/` 的靜態樣稿，當作寫引擎時的介面依據；兩者不一致時以這裡為準（規則寫在 [UI](../docs/art/UI.md) 的「互動版介面」一節）。

資料全部是假的：沒有後端、沒有 AI 呼叫。狀態放在 Pinia 的 store 裡，之後換成引擎狀態的投影。

## 怎麼跑

```bash
cd ui
npm install
npm run dev       # 開發伺服器，http://localhost:5173
npm test          # Vitest：格子、家具、價格、技能樹、建角（點數、外觀推出來的三樣）、組裝、帳單、存檔（到第 4 版）、世界編輯器（檢查、用在哪）、街區、地下城、快捷鍵、到達的選單、搭車、三個戰場（第四版的技能、機甲、無人機、下載撐回合、城市事件、收買、找上門、片進牌庫）、成人場景、委託（模板、連動、直播目標）、診所、機甲（大修、升級、修車）、住處的地圖與搬家、商店的事件、染色、難度、世界書、任務鏈、未登錄零件（報酬欄與交貨、背包與組裝、委託台、勢力窗口、學工藝、partAi）、拍賣行（階段、會員、目錄與看貨、競價、結算）
npm run build     # 從文件產生內容＋抽圖標＋型別檢查＋建置到 ui/dist/
npm run content   # 只重新產生 src/data/content.generated.ts
npm run build:preview  # 介面示意版：同 build，但用 preview 模式（.env.preview 的 VITE_DEMO_DEFAULT=on，開新局的示意模式預設開），輸出到 ui/dist-preview/
npm run preview   # 在本機看建置結果
```

- `vite.config.ts` 設了 `base: './'`，路由用 hash，所以 `dist/` 放在任何路徑底下、用任何靜態伺服器打開都能用。瀏覽器不讓 `file://` 跑模組腳本，直接雙擊 `index.html` 打不開，要經過伺服器（`npm run preview` 或 `python3 -m http.server`）。
- 直接打開某個對話框：`#/?dialog=shop&shopId=gunshop`、`#/?dialog=character&tab=bridge`、`#/?dialog=skills&tree=night`、`#/?dialog=saves&tab=snap`、`#/?dialog=mech`、`#/?dialog=clinic`（測試與截圖用；對話框的名字見 `src/stores/ui.ts` 的 `DialogName`）。
- 戰鬥畫面：`#/combat?enc=warehouse|chute|capture|mech`、`#/netcombat`（內海戰鬥：開哪一場由引擎決定，網址只是深連結與內海皮；沒有進行中的戰鬥就只寫一句話）、`#/opinion?topic=idol&foe=pr_jess|pr_starbelle|pr_kunlun|pr_nightingale`；成人場景 `#/scene?scene=amber|rin|trio`（示範的場景，`solo=1` 在住處獨處（單人）；只有這個網址入口：要先有主角，技能、體位、道具由示範入口放好，用完不補；遊戲裡沒有任何選單會連到它；`gate=0` 跳過確認框；`fast=1` 對方的回合不等；引擎開了場景時 App 會自動換到這一頁，`from=` 是結束後回哪一頁）；`from=` 是打完回哪一頁，`seed=` 固定亂數，`fast=1` 讓敵人的回合不等（自動測試用）；委託帶過來的 `minus=`（少幾個敵人）、`va=`、`cells=`、`inside=`、`pr=`、`rounds=`（輿論戰的開場）、`goal0=`（場景目的的起始）。
- `npm run build` 先跑 `scripts/build-content.mjs`：從 `docs/content/SKILL_TREES.md`、`NIGHT_LESSONS.md`、`GUIDES.md`、`docs/art/UI.md` 3.6 節與 `docs/art/icons/skills.csv` 抽出技能樹、夜課、指南，寫成 `src/data/content.generated.ts`（不要手改）。表格的格式對不上的那一列印出警告並略過，建置照樣成功；找不到文件時保留現有的輸出。
- `npm run build` 會先跑 `scripts/build-icons.mjs`：從 `docs/art/style/icons-l3-sprite.svg` 抽出資料用到的第 3 層圖標，攤平成 `public/icons-items.svg`（外部 sprite 裡巢狀的 `<use>` 瀏覽器不畫，原檔也有幾個重複的屬性，當成外部 SVG 讀時是 XML 錯誤）。資料加了新的物品，重新建置就會帶進來。

## 資料夾

| 位置 | 放什麼 |
|---|---|
| `src/components/` | 通用元件：`HereOptions`（「這裡」的選單：預設黃框、帶 E）、`combat/ActionRing`（行動圓環，1～9）、`combat/BattleBoard`（現實與內海戰鬥共用的戰鬥畫面本體：`CombatScreen`、`NetCombatScreen` 只是外殼）、`combat/NetSync`／`NetTrace`／`NetAdmin`（內海的同步檔位、追蹤度條、管理行動）、`combat/HoldButton`（長按的脫離、投降、拔線）、`LivePanel`（直播面板）、`SchemaForm`（世界編輯器照欄位表畫的表單）、`ChainFlow`（任務鏈的流程圖）、`Dialog`（對話框的外框）、`DialogHost`（對話框層、Esc）、`Hint`（「?」提示）、`ItemSlot`（物品格：等級色＋圖標；放在別的按鈕裡時加 `inert`）、`GradeBadge`、`Icon`（sprite 圖標）、`Tabs`、`GridMap`（共用的格子地圖與方向鈕；掛上時登記成這一頁的移動目標）、`AbilityTreeView`（技能樹的本體：對話框與建角第 8 步共用，讀引擎；建角時讀草稿）、`creation/`（建角第 5、6、8、9 步：`LifepathStep`、`CyberStep`、`AbilitiesStep`、`GearStep`、`OwnedList` 身上已經有的，全讀引擎的 creation，M4-ui-creation）、`TrackBar`、`MoneyTag`、`ReasonButton`（做不到的按鈕說原因）、`RuleFields`（存檔規則：設定、建角第 10 步共用）、`PartyRow`、`BodyFigure`、`CityMap`、`LogView`、`StatusBar` |
| `src/screens/` | 全頁：標題、主畫面、委託、現實戰鬥、內海戰鬥、輿論戰、成人場景（`AdultSceneScreen`）、開新局與建角、世界編輯器、AI 工坊、家園地圖、子網地圖、地下城 |
| `src/dialogs/` | 對話框：背包、角色與義體（`character/` 是內海、橋、成人三個分頁）、和 NPC 說話、商店、設定、名冊、關係、技能樹、組裝、頻道、契約、每週帳單、指南、備忘錄、待處理、讀檔與存檔、城市地圖、搭車、中間人的店、直播、素材與剪片、機甲整備、診所、修車廠、自訂難度、染色 |
| `src/stores/` | Pinia：`game`（假存檔；`serialize()`／`hydrate()` 是存檔的進出口，第 3 版起連 `home` 一起存；另有進行中的委託 `job`、媒體 `media`、機甲 `mech`）、`saves`（存檔的格子）、`ui`（對話框堆疊、提示訊息）、`home`、`settings`（設定與 AI 工坊共用） |
| `src/data/demo/` | **示意世界包**（引擎不再匯入內容，畫面自己帶一份，開新局時由 `stores/engine.ts` 載入；不放進 `engine/data`）：`world.ts`（八個區、街區的版面與設施、設施種類，由 `districts.ts` 轉成引擎的 district、block、special_map、facility_type）、`transit.ts`（五條線與計程車的規則）、`events.ts`（街頭與交通的事件範圍與幾件事件）、`commission.ts`（中間人與委託的類型）、`life.ts`（三間店與貨、兩份打工、三處住處，由舊資料 `shops.ts`、`items.ts` 轉成引擎的 item、shop_type、shop、job、residence）、`market.ts`（區的行情）、`scene.ts`（成人場景的五個體位、夜課技能、兩件道具、傾向標籤與琥珀、小麥兩場示範）、`index.ts`（`demoPack()`、`demoStartFeature()` 開局站在四號塔）。之後的介面工單往這裡加自己的檔；正式內容匯入時整包換掉 |
| `src/data/` | 有型別的假資料：物品（ITEMS；`items2.ts` 是零件、設計圖、構裝、SKIN）、主角與部位、主角第二版的資料（`profile.ts`）、NPC 與名冊、區與街區、商店、家具與家園版面、地下城、建角、組裝、頻道、契約、帳單與待處理、世界編輯器、AI 工坊；`content.generated.ts` 由文件產生 |
| `src/lib/` | 純邏輯，有測試：`scene/sceneView.ts`（成人場景只整理引擎給的：部位標籤與內容篩選、預覽的字、選部位的點選狀態、戰報卡的欄位；規則在 `engine/src/features/scene`）、`here`（到達的選單與 E）、`dye`（染色的顏色、價錢、外觀的一句）、`shopEvents`（殺價、特別交易、店內事件）、`combat/`（`field` 兩排四格的共用部分、`opinion` 輿論戰、`rng` 有種子的擲骰；現實與內海戰鬥的舊 Demo 規則已拿掉）、`useBattle`（現實與內海戰鬥共用的畫面驅動：選行動與目標、敵人的回合節奏、按鍵、結算，全讀引擎）、`netView`（內海三塊：同步檔位、追蹤度條、管理行動，與卡片上的標記；只整理引擎給的）、`commission`（怎麼付、分帳、踩點、輔助面、連動的效果 `linkMods`、直播目標）、`clinic`（手術費、沉溺成本、休養）、`difficulty`（難度的係數表）、`schemas`（世界編輯器的欄位表）、`lorebook`（世界書的預算、逐行差異）、`keys`（全域快捷鍵）、`transit`（搭車與計程車的車資）、`grid`（尋路、視野）、`home`（佔地、轉向、擺放的檢查、用途、舒適度、儲物）、`grade`、`price`、`creation`（調整值的正負號、外觀推出來的三樣 `derivedLooks`；點數、原因、換多少現金全是引擎的）、`crafting`（槽、難度、成功率）、`bills`（帳單的結算與下坡路）、`save`（存檔的格式、回退、快照）、`worldCheck`（世界編輯器的檢查、所有種類的「用在哪」`whereUsed`）、`dungeon`（地下城的刷新）、`useWalk`、`useGuides` |
| `src/styles/` | `tokens.css`（顏色、兩套皮、等級色、間距、字級）、`base.css`（斜切角、面板、按鈕、標籤） |
| `public/` | `icons-sprite.svg`（第 1、2 層）、`icons-items.svg`（第 3 層的子集）、`icon-centers.json`、`city-map.svg`、`legacy/`（四個舊 Demo 的原檔，第四版起都不再連過去） |

## 做了什麼

**全頁**：標題畫面（`#/title`）、主畫面與城市地圖、開新局與建角（世界 → 內容篩選 → 建角十步，最後一頁是總覽）、世界編輯器（三級頁簽、設施、劇情計數器、匯入與匯出）、AI 工坊（任務、任務鏈、模型與路由、紀錄與回報、變數字典、提示詞組）、家園地圖、子網地圖、地下城（垃圾滑道，離開後重新擺放）、現實戰鬥、內海戰鬥、輿論戰、委託（第三版，見下）、成人場景（第四版重做成元件）。

**對話框**：背包、角色與義體（概要含基本功、身體、裝備含快取格、內海、橋、成人）、和 NPC 說話、商店、設定、名冊、關係、技能樹（八棵樹與夜課）、組裝、頻道、契約（持約人與契約人兩面）、每週帳單、指南、備忘錄（筆記與指南）、待處理、讀檔與存檔（三個手動格、兩個自動格、匯出與匯入、委託副本的快照、紀錄的回退）。

**街區**：每一區至少一塊手畫的街區：四號塔、刀巷、千本通、中央廣場、倉庫區、俱樂部街、薔薇驛、月台市（SITES 第 3～9 節的設施）。其他街區用通用的版面。

**移動與快捷鍵**（第三版，`src/lib/keys.ts`、`App.vue`）：方向鍵與 WASD 隨時走一格、E 和腳下的東西互動，不必先點地圖（打字時、對話框開著時不作用）；手機與觸控的地圖下面有方向鈕。C 角色、B 背包、K 技能樹、R 名冊、L 關係、J 備忘錄、N 待處理、G 組裝、V 頻道、T 契約、Y 帳單、H 家園、M 城市地圖；F5／Ctrl+S 快速存檔、F9 快速讀檔；Esc 關對話框，沒有對話框時開選單。完整的表在設定的「顯示」分頁。

**城市地圖與搭車**（M2-ui-world 起接引擎）：街區圖、走路、「這裡」、出口、城市地圖、搭車、事件視窗、掃橋都是引擎的（`features/world`、`transit`、`director`、`security`）；`stores/engine.ts` 的 `world`、`transit`、`event` 只轉接，`lib/worldView.ts` 只整理與排序，元件不算機率、車資、DC。街區圖畫引擎的 `gridView`（看過的格子，沒看過的蓋霧），方向鍵與點格子走 `gridMove`，被擋下時提示列是引擎的原因；走上出口那一格引擎就換到隔壁的街區（所以出口只列在右欄「出口」，點了是走過去）。城市地圖是對話框（M），只能叫浮空計程車（只去去過的車站，原因與車資是引擎的）；自己的車引擎還沒有，按鈕灰掉。地鐵、輕軌、巴士、渡輪在街區圖上的車站，走上去按 E 開選站；上車之後地圖區換成路線條（等車、坐一站、坐到目的地、下車；坐到目的地是一站一站呼叫引擎，路上開了事件就停）。引擎有開著的事件時 `EventDialog` 自動打開、擋住別的操作（正文、選項與灰掉的原因、檢定的成功率、「我要做別的」、選完的擲骰與結果）；事件是掃橋發起的時候換成 `ScanDialog`（四步、身上被掃到的東西、怎麼過）。

**第三版的樣式規則**：做不到的一律 `.is-unavailable`（灰掉）；清單用 `.grid2`（寬的一列兩個）；字級用 `tokens.css` 的階層（`--fs-page`／`--fs-section`／`--fs-card`／`--fs-body`／`--fs-label`／`--fs-fine`）。

**和設定共用的值**：AI 工坊與設定讀寫同一個 `settings` store（PROMPTS 2.14 節）；建角第 10 步、設定的「遊戲」分頁用同一個 `RuleFields`；讀檔與存檔對話框和設定的「存檔」分頁用同一組格子。

**五條介面規則**的做法見 [UI](../docs/art/UI.md) 的「互動版介面」一節。

**第三版**（`src/lib/combat/` 的規則都照舊 Demo，數字照 BALANCE 的 I 級）：

- **三個戰場重做成元件**：現實戰鬥（`#/combat`：兩排四格、先攻條、行動圓環、遮蔽、監視、制伏、要活的、長按的脫離與投降、敵人的 AI、急救噴劑、戰鬥中可以開直播面板）、內海戰鬥（`#/netcombat`，內海皮：RAM、防火牆、同步檔位、餘韻、追蹤度與增援、管理行動、彈幕、拔線）、輿論戰（`#/opinion`：棋盤、手牌、帶風向與追擊、佔領、六個時段；對手有一般的公關、萬華鏡、緋櫻、第一手的潔絲）。舊的 `#/demo/combat` 等路由轉到新的畫面，`public/legacy/` 的檔案還在。子網的蕾絲、巡邏，地下城的遭遇，委託的每一段都連到新的畫面。
- **戰鬥的鍵**：1～9 按行動圓環的九格、空白鍵結束回合、Tab 換目標、Enter 確定、Esc 取消；輿論戰 1～5 出牌。
- **委託**（`#/commission`，全頁）：接案（簡報、談判、怎麼付）、踩點（未知清單、七種手段、次數）、召集（隊伍、技能配置、分帳、輔助面）、副本（壓力條、階段軌、選面、輔助結算、分支、進入這一段、里程碑、連動、喘口氣、撤退、快照）。
- **對話框**：中間人的店、直播、素材與剪片、機甲整備、診所（義體與調校）、修車廠（買車，城市地圖可以自己開車）、自訂難度（BALANCE 7.3 節）。
- **家園**：住處（搬到高樓層的打通戶）、三級的一樓店面（另一張圖、每週營收）、安全屋（最多兩處）。**子網**：巡邏（你走一步牠走一步、遭遇、斷路）。
- **世界編輯器**其餘十七種內容照 DATA.md 的欄位表畫表單並檢查；**AI 工坊**的世界書（條目、注入方式、字數預算）、生圖、和預設比較、任務鏈的流程圖。
- **存檔第 3 版**：存檔與快照帶著家園與子網；第 2 版的存檔照樣讀得回來（`migrateSave`）。
- 方向鈕只在手機與觸控。鍵值列與清單列不再撐滿整列。建角可以寫私處（成人內容，受內容篩選控制）。

**第四版**（2026-11-21）：

- **先修的三件事**：建角外觀的「改造與風格」不再自己選，由第 6 步裝的義體（牌子的外觀照 NPC_SYSTEM 13.11 節）、獸耳與尾巴、第 9 步的穿著推出來，第 1 步只顯示結果；**到了就看得到選單、按 E 才做**（「這裡」立刻列出能做的事，不自動執行；E 在出口換地圖、其他地方做預設選項；預設選項黃框、帶 E 的鍵帽；街區、家園、子網、地下城都一樣）；鈴鐺與工具列的角標整個露在按鈕外面（`.cut-bg`、`.badge-n`、`.badge-dot`）。
- **使用者的決定**：輿論戰的數字照 OPINION 3.3、4.3b、4.3c 節（防守最少 0、編輯點照路數、豔名）；難度名稱照 BALANCE（故事、簡單、普通、困難、傳奇、自訂）；**染色**（主色調與副色調，`DyeDialog`、`lib/dye.ts`，存檔第 4 版）。
- **成人場景**重做成元件（`#/scene`）：scene_gate 的確認框（進入或略過）、部位與連接（一個部位一條、換部位或換體位就斷）、體位與主動權、感載與餘韻（過載就是高潮）、契合與目的、說話、道具、同步檔位、停下之後的戰報（契合的評價、體悟、關係）；內容篩選關掉的技能不出現。
- **戰鬥**：技能清單（要害射擊、連射、看我的！、快駭的標記、短路、癱瘓、奪取控制節點，關燈與防爆門、接管砲塔、煙霧彈）、機甲（玩家啟動、敵方第 2 回合啟動，機體耐久、回灌、損毀）、無人機（攻擊型、護盾型，和人重疊、永遠暴露、擊落時感載 +5）；新的遭遇 `mech`（夜裡的試射場，黑暗）。**內海**：`download`（守著節點撐三回合，每兩回合一波），追蹤度 60 的增援排隊、現實警戒。**輿論戰**：城市事件、收買、找上門（留守的隊友擋人，直播中擋住多一張料）、片進牌庫（全額、減半、無關）、星旗、崑崙、夜鶯的招牌。
- **委託**照模板跑（`src/data/templates.ts`）：竊密（藍鯨的帳本）、暗殺、蜜罐（決定性的一步是成人場景）、救援、網內打撈（決定性的一步是下載撐回合）、滅火（決定性的一步是六回合的輿論戰）、破壞；連動的效果（不必探索、壓力減半、少一個敵人、輿論戰的開場……）；副本直播的目標。
- **其他**：機甲的大修與升級、載具被打爛之後的修理；其他住處的地圖、請人搬家、打包的家具；世界編輯器所有種類的「用在哪」；任務鏈 23 條的流程圖；商店的殺價（TRADE 第 5 節）、當日特別交易、店內事件；角色成人分頁可以改私處的描述。

**人接引擎**（M2-ui-people）：「這裡的人」、說話與互動、關係、名冊與招募、人情、橋分頁的換配置只編排（`TalkDialog`、`RelationsDialog`、`RosterDialog`、`components/StatusBar` 與 `MoneyTag` 的人情、`character/BridgeTab`），`stores/engine.ts` 的 `people` 只轉接 `features/npcs`、`roster`、`favors`、`abilities`；`lib/peopleView.ts` 只整理（已知的事沒揭開的寫問號、互動列的 DC 與成功率字樣、記憶與近況的列、名單的篩選、人情的列），沒有 DC、成功率、親密度階段、容量的算式。主畫面「這裡的人」是引擎的 `npcsHere`；站在設施上時，只有出沒表寫了那一種設施的人才在。互動送出去走主動行動（送禮選背包裡的東西、讀橋選類別、「我要做別的」帶著對象）；威嚇中間人、沒有甲板讀橋、名冊滿了的原因都是引擎的；關係線、傳訊息、邀約、採訪、請教、派工還沒有開放。人情欠你的可以用掉、你欠的可以答應或回絕（引擎的 `favors.call`），錢包旁列出兩種數字（你欠的橘字）。橋分頁最下面一行寫現在能不能換（引擎的原因）與要花幾分鐘（衍生數值 `loadout_minutes`）。示意世界包多了 `data/demo/people.ts`：固定 NPC 用 `engine/data` 已有的 id（那邊只有 id 與名字；`npc` 可覆寫，示意包整筆取代同 id 的）、八區的生成規則與三份名字池、候選人（奈奈、喬）在開局那份報告裡由引擎自己的 `meetChanges` 放進去；名冊的成員（小麥、雷）是建角時照出身的名冊由引擎放進去（沒有主角的示意局才由 `demoPeopleChanges` 給）。

**成人場景接引擎**（M2-ui-scene）：`AdultSceneScreen` 與 `components/scene/` 只編排，感載、契合、主動權、預覽、能不能做與原因全是 `features/scene` 的（`stores/engine.ts` 的 `scene` 只轉接）。開場先出確認框（進入或略過；略過直接算結果、紀錄多一份）；一對一的回合，玩家做完一步就呼叫對方的一步；結束後出戰報卡（評價、體悟、關係、餘韻，AI 開著時有整場的正文）；場景進行中引擎不收別的報告，App 也不讓人停在別的全頁。設定的「成人場景的操作」（遊戲分頁）：**精簡版**（預設）由引擎自動接線，畫面只顯示持續效果的條數與大概數值；**完整版**自己選部位（技能、說話、道具要選時，照引擎宣告的選項點卡上的部位）。兩種的規則與數值相同，下一場生效。同步檔位固定「標準」（還沒有開放）、直播關。「身體的私密描寫」關掉時私密部位的名字收起來換成編號。

**過日子接引擎**（M2-ui-life）：商店、每週帳單、打工、休息與住處（`ShopDialog`、`BillsDialog`、`WorkDialog`、`RestDialog`）只編排，`stores/engine.ts` 的 `trade`、`bills`、`work`、`rest` 只轉接 `features/trade`、`bills`、`work`、`rest`；`lib/lifeView.ts` 只整理與排序（購物車列、拆解的字、帳單分支出與收入、下坡的四格、升階的條件進度），沒有價錢、報酬、回復量的算式。站在店、打工的設施、自己的住處或有床位的設施上，「這裡」列引擎給的項目（`trade.shop:<店>`、`work.shift`、`rest.sleep`、`rest.breath`），點了打開對應的對話框（`#/?dialog=shop&shopId=alian`、`dialog=work`、`dialog=rest`、`dialog=bills`）；有活動進行時入口灰掉，原因是引擎的 `blockOf`。結帳之後買到的進引擎的背包、存檔帶著走。引擎出了 `bill.settle`（跨過週一）App 把帳單打開、`bill.notice`（週日晚上）顯示成通知。價錢的拆解、殺價（每間店每天一次）、結帳都是引擎的；洗錢、AI 的當日優惠、派別人去打工、家園的地圖還沒有開放。

**子網接引擎**（M3-ui-subnet）：`SubnetScreen` 只編排，`stores/engine.ts` 的 `net` 只轉接 `features/netrun`（`netrunView`、`useNode`、`descend`、`logout`）與核心的格子（`gridView`、`gridMove`）；`lib/netrunView.ts` 只整理（格子種類的圖示與顏色、迷霧、巡邏代幣、追蹤度刻度的說明、「這裡」與按 E 的選項、結束後離開這一頁）。地圖畫引擎看過的格子（沒看過的蓋霧、看過但不在視野裡的變暗、處理過的節點打勾、目標加星），巡邏的代幣在 `netrunView.patrols` 說的位置（只畫 `visible` 的）；遭遇節點站不上去，站在旁邊時右欄列開戰與潛行繞過；層的分頁只有目前這一層能選，換層只經由閘門的「往下一層」；登出先跳確認框（委託的那一段寫「會回到進副本之前」）。開戰之後 `App.vue` 換到內海戰鬥，打完回到這一頁；這一趟結束（引擎沒有行程了）離開：委託的那一段回副本頁，其餘回主畫面。自己潛進去的入口是接入點（潛艙店等，`dive`）與迷宮館（M3-ui-dive）；已經在網內時主畫面與工具列變成「回到子網」。舊的 `stores/subnet.ts`、`data/subnet.ts`（藍鯨物流、自己算的巡邏與追蹤度）已刪除，存檔不再帶子網（舊存檔的 `subnet` 欄位讀到就略過）。

**身體接引擎**（M4-ui-body）：角色的「身體」「橋」分頁與診所對話框（`dialogs/character/BodyTab.vue`、`BridgeTab.vue`、`ClinicDialog.vue`、`components/body/`：`QuoteCard`、`SinkPanel`、`DrugPanel`、`MedicalPanel`、`BridgePanel`、`HpBar`、`BodyFigure`）只編排，`stores/engine.ts` 的 `body` 只轉接 `features/cyberware`（`cyberView`、`surgeons`、`installQuote`、`bridgeQuote`、`removeQuote`、`modifyQuote`、`repairQuote`、`lockView`、`crackQuote`）、`medical`（`medicalView`）、`drugs`（`drugView`）、`sink`（`sinkView`、`therapyQuote`）、`lewd`（`bridgeOf`）與核心的 `k.passives`；`lib/bodyView.ts` 只整理（部位的順序與圖標、報價的列、被動效果照來源分組、下限的組成），沒有費用、成本、休養、機率與 DC 的算式（成功率用引擎的 `computeDegree` 逐面判一次）。診所對話框站在帶 `clinic` 的設施上才開得了（`body.clinicGate()`；自己動刀的入口在住處，條件是引擎的）；每一項先寫報價、按確認才送，擋住的原因逐字用引擎的。痛覺編輯器（設計圖的 `tags` 有 `pain_editor`）讓生命值只剩模糊的分段（`HpBar`、`PartyRow`）。示意包的義體、零件、藥在 `data/demo/body.ts`，開新局橋、甲板、義眼已經裝在身上。調校與惡意韌體在 M4-ui-contract 接上引擎（見下）。

**組裝接引擎**（M4-ui-craft）：組裝對話框（`dialogs/CraftDialog.vue`，四個分頁：組裝、換零件、拆解、解剖；`dialogs/craft/` 是各分頁與共用的零件清單、誰來做、結果）、染色對話框、背包的成品詳情（設計圖、每個槽的零件、品質、怪癖、狀態、目錄價；授權書有「學會」）、裝備分頁的曝露度與風格與重量，都只編排。`stores/engine.ts` 的 `craft` 只轉接 `features/craft`（`knownBlueprints`、`makers`、`assemblyPreview`、`assembleDraft`、`salvagePreview`／`salvageDraft`、`swapPreview`／`swapDraft`、`learnDraft`）、核心的 `productOf`、`productPrice`、`slotProblems` 與 `features/enemies` 的 `dissectOptions`／`dissectDraft`；`dye` 轉接 `features/gear` 的 `dyeOf`、`dyeBlock`、`dyeDraft`（價錢與時間讀引擎給的草稿）。難度的每一項、成功率、能不能放進槽、超規、工錢、價錢都是引擎的，不能放的零件灰掉、原因逐字用 `slotProblems` 的那一句；精工的項目由玩家選（讀預覽的 `result.polishable`，送 `polish`）。`lib/craftView.ts` 只整理（名字、色票、數值列、前後對照），沒有規則；舊的 `lib/crafting.ts`、`lib/dye.ts` 已經拿掉。站在帶 `craft` 的設施上，主畫面的「這裡」多一項「組裝」；打贏之後一小時內有東西可以拆，「戰後」多一項「解剖」。示意包的設計圖、零件、怪癖、授權書與三間做的地方（槍店、同人攤、原廠）在 `data/demo/craft.ts`，開新局會做手槍、背包裡有兩張授權書與各種零件。內海 SKIN 的染色引擎還沒有，維持介面自己的純外觀做法。

**成人場景第二版**（M4-ui-scene）：`AdultSceneScreen` 與 `components/scene/` 改接 `Game.sceneBegin`／`sceneStep`／`sceneFinish({ how, direction })`（`stores/engine.ts` 的 `scene.act`／`next`／`finish`／`skip`／`begin`），讀引擎第二版的 `seats`、`pairs`、`circles`、`pace`、`audience`、`PersonView.known`（`SceneView.people.partner` 在單人與多人時不讀，畫面讀 `othersOf(view)`）。確認框的摘要是 `startProblems().summary`（`scene.gate()`；引擎不存開場的設定，`lib/scene/sceneView.ts` 的 `setupOf` 把場景狀態翻回設定的形狀），要不要出確認框問引擎略過那一步會不會被擋下（`scene.skipBlock()`），畫面不數第幾步。多人：主角這一圈每個人一張卡（感載、餘韻、契合與主動權、到了幾次、退出的變暗）、行動要選對象時多一排「對象」（自動＝引擎挑）、別的圈在連接上面一行字（`SceneCircles`）、換圈與叫人過來是行動列的兩個行動；精簡版遇到多人設定時顯示引擎那一句（`scene.simpleNote()`）。單人：沒有對象卡、契合換成節奏、行動是引擎給的那一組。內海的場景（`layer` 是 `net`）套內海皮（`App.vue` 的 `netSkin`）、部位來自化身（角色的內海分頁加 `AvatarEditor`）。結算頁每個對象一列（`debriefOf` 的 `rows`；單人是節奏）。角色的成人分頁加夜課的學習（`NightClassPanel`，`stores/engine.ts` 的 `night` 只轉接 `features/nightclass`）。設定：「AI 開關」加場景的 AI（關、只有進場與收尾、每回合都問，引擎的 `sceneAi`）、「內容篩選」補齊引擎認得的題材（`lib/engineView.ts` 的 `FILTER_ROWS` 與 `FILTER_TAGS`，每一項直接對到 `contentOff`）。**想怎麼發生（選填）**：`DirectionField`（最多 200 字、即時字數、AI 關著灰掉並說明）在略過旁邊、戰鬥結束與戰敗事件各一格，玩家的字原樣送出、不篩選、不提示（`Game.sceneFinish({ direction })`、`finishBattle({ direction })`、`commitNarrated({ direction })`）。示意世界包補了三人的體位、十個夜課技能（五個分支都有）、兩筆共鳴、一個三人場景的事件，臥室多一個「獨處」（單人）的選項。測試在 `tests/scene/M4-ui-scene.test.ts`。

**契約接引擎**（M4-ui-contract）：契約面板（`dialogs/ContractDialog.vue`，內容在 `components/contract/BoundPanel.vue` 與 `HolderPanel.vue`）、掃橋對話框、橋分頁與診所的調校、惡意韌體、請教與上課，全部只編排，`stores/engine.ts` 的 `contract`、`malware`、`tuning`、`lure`、`training` 只轉接 `features/contract`（`boundView`、`chooseDraft`、`arriveDraft`、`completeDraft`、`askOrderDraft`、`payoffQuote`／`payoffDraft`、`coverMarkDraft`、`holderEvents`、`holderContractView`、`triggerDraft`、`adjustDraft`、`releaseDraft`）、`malware`（`malwareView`、`cleanDraft`）、`tuning`（`bridgeView`、`tuningList`、`installDraft`／`removeDraft`、`quietDraft`、`tuningHere`）、`lure`（`lureView`）、`abilities`（`teachOptions`、`lessonDraft`）與 `cyberware` 的 `cyberView`；`lib/contractView.ts` 只整理（倒數的字樣、規矩一行、佇列每一條的列、逾期處置的字、掃橋讀到的人整理成列），沒有 DC、成功率、價錢、能不能做的算式。主角是契約人：工具列的「契約」鈕在 `boundView` 有東西（或持有別人的契約）時才出現；契約寫了什麼（種類、持約人、債或期限、紙上勾的指令、規矩、滿意、光紋）、佇列每一條（種類、倒數、逾期會怎樣；已經逾期的紅色並寫引擎記的處置）、照做與抗拒（抗拒旁是引擎的 DC 與成功率）、「到了，去做」與「做完了」、主動要一條、還清與先談價（價錢與資格是引擎的）；人在指令指定的地方時，主畫面「這裡」多一項「去做：〈指令〉」（`arriveBlock` 成立才列）；每天或每週送達的指令是一則通知（`freshEffects` 認 `contract.order`，主動要的不算）。主角是持約人：名冊卡與說話頁多一顆「契約」；事件頁（五種事能不能做與引擎的原因、他可能抗命的 DC 與成功率、紙上劃掉的標出來；觸發之後那一份報告顯示在下面，他抗命時就是 `contract.refuse`）、契約頁（來歷、債、橋參數、親密度與忠誠、**身上被裝了什麼**、能調的每一項各自的控制與擋住的原因、解約要先確認）。掃橋：`ScanDialog` 多一塊「讀到你身上的」（`scanView.person`：義體件數、強度夠時逐件與處置如「會被鎖住 24 小時」、沉溺讀到多少與有沒有被看穿、契約的持約人與級別，被遮住時引擎不給就不列）。成人分頁列出找過主角的流竄 AI（順著、拒絕、問過幾次，「牠的事」四格揭開幾格，沒揭開的寫問號）；蠱惑事件走原本的事件視窗。橋分頁最下面與診所的「調校」「清除韌體」分頁用同一組元件：`components/body/TuningPanel.vue`（槽、裝著什麼、裝不穩、鎖、能裝的清單、橋參數的來源、靜室）與 `MalwarePanel.vue`（階段、效果、清除的每一條路與 DC、成功率、價錢）。請教：NPC 互動選單的「請教」（引擎 `interactions` 的 `handoff`）換成 `components/TeachPanel.vue`（能學的基本功、三種付法與原因、上課進度），站在教課的設施上主畫面「這裡」多一項「上課」（`dialogs/LessonDialog.vue`）。新局畫面的「世界」步驟多「開局的契約」：一般、契約人開局（`demoBoundChanges`：欠伊甸園 C$24,000 的債務契約、佇列三條）、持約人開局（`demoHolderChanges`：買下阿音的債）；`stores/engine.ts` 的 `newGame({ start })` 在建角那份報告後面接示意包給的變更。示意包 `data/demo/contract.ts` 多了三件指令事件、流竄 AI 與兩件蠱惑事件（登入、長休）、牠的吻、調校靜水（兩筆被動效果加 `no_full_sync`，照 0019 P65）與聚光、可以請教的老何（槍械 6 級），`world.ts` 的診所多 `tuning`、`craft.ts` 的槍店多 `teach`。舊的 `data/contracts.ts`（假的持約人與範例）已刪，存檔不再帶 `contracts`（舊存檔的欄位讀到就略過）；「靜水」「每回合感載自然消退加倍」的舊文字（`data/profile.ts`、`data/items2.ts`）改成「每回合感載消退 +2 點」。測試在 `tests/contract/M4-ui-contract.test.ts`。

**簾後館接引擎**（M4-ui-curtain）：簾後館對話框（`dialogs/CurtainDialog.vue`：面談或會員頁、口味單、報名、帳與母帶）、一趟裡的面板（`components/curtain/CurtainPanel.vue`、`HeatBar.vue`、`CurtainRoom.vue`；子網頁在簾後館的一趟裡換上它）、落幕（`FallPanel.vue`：補演的確認可以喊停、之後三條路）、結算卡（`ResultCard.vue`，併進離開結算 `EndCard`）只編排，`stores/engine.ts` 的 `curtain` 只轉接 `features/curtain`（`memberView`、`interviewDraft`、`tasteOptions`／`tasteDraft`、`nightPool`、`enterQuote`／`enterBlocks`／`enterDraft`、`curtainView`、`useCurtain`、`orderChoices`、`restDraft`、`encoreDraft`、`fallView`、`replayDraft`、`callOffDraft`、`settleDraft({ how })`、`payTabDraft`、`buybackDraft`、`doorBlock`）與 `enemies` 的 `unitFormView`；`lib/curtainView.ts` 只整理（場熱刻度、這裡的選項、口味單分組、結算欄位），沒有場熱、打賞、DC、價錢、能不能做的算式。遭遇的開戰與潛行繞過仍讀 `netrunView`。入口在潛入頁的「簾後館」一段；落幕之後引擎有等著處理的一筆時 App 會自動打開簾後館對話框。戰鬥的敵人名牌讀 `unitFormView`（引擎沒有「敵人現在鎖定誰」，暫時一律照主角）。示意包：`data/demo/curtain.ts`（簾口設施與去處、兩個夜、雙形象的敵人與層主、三張表、落幕事件）。測試：`tests/curtain/M4-ui-curtain.test.ts`。

## 還沒做（第五版）

- 場景裡的直播與觀眾（M5）。
- 戰鬥其餘的主動技能、機甲的部位與開艙、載具叫來當掩體、其他三種無人機；輿論戰其餘的對手與城市事件、公信力。
- 委託其餘十二型、中型與大型的 2a／2b 階段、附帶條件與報酬公式、詞條、踩點開出來的路。
- 機甲武器與零件的買賣；另外三處住處、買斷與假身分；商店的長期折扣；染色接上 AI 的外觀描述。
- 紀錄的逐樓回退要等引擎存每一樓的快照。

## M2 介面修正批（2026-11-23）

- **佇列**：`stores/engine.ts` 的 `commitDrafts` 只在「同一個動作的前一份已提交、後面那份被擋」時才留草稿（計程車的抵達，放行時照當下狀態重做）；整個動作被擋下的不留。開新局、讀檔、回退、undo、重來戰鬥、回到階段開始都清空。
- **全域換頁**：`App.vue` 看 `inBattle` 與等著選的戰敗，不在戰鬥相關頁面就換到 `/combat`；帳單與通知看 store 的 `feed`（這一步提交新產生的報告），不靠報告 id。
- **讀引擎**：小隊（`partyRows`）、狀態列的敵對值（`hostilityTop`）、中間人的店的人情、召集的人數上限（`fixer.crewRules`）、互動列的 `note`、勢力人情的名字；主畫面「休息」開休息對話框、臥室睡一覺走 `rest.sleep`。設定的快速移動與名冊會死經 `rulesFromUi` 交給引擎。

## M3 介面修正批（2026-11-24）

- **內海戰鬥結束回哪頁**：`useBattle.leave()` 在 `/netcombat` 時用 `lib/netrunView.ts` 的 `netBattleLeaveTo` 照引擎的狀態決定：行程還在回子網；行程沒了而副本還在或手上有委託回 `/commission`；其餘主畫面（全員拔線、接受戰敗、回到階段開始都不再落在空的子網頁）。戰敗等三選一時內海戰鬥頁藏「← 主畫面」。
- **子網離開結算**：`leaveSettlement` 先換完頁才打開「去處」對話框；登出確認抽成 `logoutFlow`（按登出只開框、取消不送、確認才送），兩個都有真的走一遍的測試。
- **這一趟的帳**：store 的 `runMemo`、`lastEnd`、`netStageMemo` 在開新局、讀檔、回退、undo、重來戰鬥、回到階段開始時清掉並重抄引擎現在的行程；行程沒了又沒有結束報告收走時也清。
- **內海分頁**：潛入中整頁鎖只套甲板、構裝、腳本；SKIN 用引擎 `deckView().skins[].block`（`skinBlock`）。
- **說明文字**：不再寫死「1 分鐘」「甲板等級 ＋1」「七天內」「不限」這些會被資料蓋掉的數字；追蹤度三道刻度的說明照 NETRUNNING 第 5 節，內海戰鬥與子網頁同一份。副本頁讀檔後沒有「這一段拿到的東西」的記錄時只寫追蹤度，不寫「沒有帶東西出來」。
- 測試：`tests/commission/M3-fix-ui.test.ts`（新）；`netFixtures.ts` 是委託內海面測試共用的假資料與開局。沒有 DOM 環境，「點」是呼叫 `useBattle` 與 lib 的流程函式。

## M4 介面待辦（「二十之二」乙欄，2026-11-25）

- **人物詳情**（`TalkDialog`）：認識之後左欄多「你怎麼叫他／他怎麼叫你」兩格（引擎的 `callNamesDraft`，上限 `CALL_MAX`）；送禮多「附一句話」（`note`，上限 `GIFT_NOTE_MAX`）；化身分頁（`scene/AvatarEditor`）多外觀描述（`avatar.text`，上限 `AVATAR_TEXT_MAX`）。玩家寫的字原樣送出，不篩選、不提示。
- **請教**：拿掉 `peopleView.UNOPENED_ACTIONS` 灰掉的「請教」，`npc_consult` 的 handoff 打開 `TeachPanel`；handoff 帶 `also: ['abilities.tutorOptions']` 時同一頁多列向 NPC 學工藝的課（`training.tutorOptions`／`tutorLesson`）。
- **診所與修理構裝**：主畫面與家園開診所之前先問 `body.clinicGate()`（開不了就灰掉並寫原因）；站在有 `repair_construct` 的設施上，引擎在格子上列「修理構裝」，打開新的 `RepairDialog`（`repair.rows`／`block`／`fix`，只收現金）。
- **背包**：藥的詳情多「使用」（`drugView.usable`、`useDraft`）。
- **成人場景**：行動列列出 `once`、`dress`（`once` 的選項 id 由 `lib/scene/sceneView.ts` 的 `onceInput` 拆成輸入），並列出 `SceneOptions.inserted`（視窗插進來的選項）。
- **組裝的動手人**：組裝、換零件、拆解、解剖多「動手的人」（`craft/CrewPicker`，主角與隊友，送引擎的 `by`）。
- **讀引擎**：沒有橋的說明改讀 `NO_BRIDGE_NOTE`；藥泵圖示 `pump` 進 `data/combatIcons.ts`。
- 測試：`tests/followups/M4-ui-followups.test.ts`。

## M4 收尾修正批・介面（2026-11-26）

依據 dev/work/M4-fix-ui.md、dev/reviews/2026-11-26-M4-ui.md、dev/work/M4-closing-notes.md。元件只編排；規則一律問引擎。

- **示意模式**（開新局的開關，預設關）：契約開局（契約人／持約人）、簾後館的邀請函、拍賣行常客的交情都只在開著時出現；關著時沒有任何示意捷徑。`stores/engine.ts` 的 `newGame({ demo: { on, invite, auction }, start })`、`demoMode`；簾後館對話框的「領一張邀請函」只在示意模式開著時顯示。示意包不再放規則表（`unreg_rule` 用正式表只蓋報酬機率一格，`curtain_rule`、事件範圍 `contract`／`rogue_ai` 用正式表）。
- **斷線靜修**是進行中的活動：`components/body/RetreatPanel.vue`（待下去、提早離開；主畫面中欄與沉溺面板都有）。
- **角色的成人分頁與角色卡**：橋參數、傾向、性經歷、豔名、體悟全讀引擎（`adult`、`night`、`bridgeParams`、`partyRows`）；沒有介面自己的公式。
- **建角**：第 6、9 步買得到什麼、出身的建議組合、外觀裡推出來的三樣都是引擎的 `creationCatalog`、`suggestedKit`、`creationLook`（示意包把 `look`、`style`、`suggested` 寫在設計圖、物品與出身自己的欄位上）。
- **拍賣**：廳裡有「自動跟到 C$___」（`bidDraft({ auto: { max } })`）；結算頁讀引擎的 `auctionSummary`；進行中其他入口灰掉（引擎的 `blockOf`）。
- **契約**：了結的逾期那一條的處置讀 `OrderView.outcome`、「走過去」讀 `goto`；契約人面板在手機版指令佇列排第一。
- **寫法指令**：不在瀏覽器擋字數（沒有 `maxlength`）；超過上限字數變紅、照樣送出，由引擎截斷並提醒（上限是引擎的 `DIRECTION_MAX`）。玩家寫的字原樣送出。
- **其他讀引擎**：名字表（`statName`、`modName`、`partTypeName`）、`coveredSlots`、SKIN 染色（`dyeDraft` 收 SKIN id，拿掉 `where: 'net'` 舊做法）、鎖定目標的名牌（`lockedTarget`）、痛覺編輯器的模糊（衍生數值 `hp_blur`）、未登錄零件（`pendingView`、`Game.unregPaused`）、帳與母帶（`accountView`）。
- 測試：`tests/fix/M4-fix-ui.test.ts`（新）；寫法指令的行為測試在 `tests/after/M2-ui-battle-after.test.ts`。
