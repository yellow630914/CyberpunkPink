# CyberpunkPink 互動介面（第三版）

這是遊戲介面的**參考實作**：Vue 3 + Pinia + Vite + TypeScript，和引擎預定的技術相同（[IMPLEMENTATION](../docs/plan/IMPLEMENTATION.md) 第 1 節）。它取代 `docs/mockups/` 的靜態樣稿，當作寫引擎時的介面依據；兩者不一致時以這裡為準（規則寫在 [UI](../docs/art/UI.md) 的「互動版介面」一節）。

資料全部是假的：沒有後端、沒有 AI 呼叫。狀態放在 Pinia 的 store 裡，之後換成引擎狀態的投影。

## 怎麼跑

```bash
cd ui
npm install
npm run dev       # 開發伺服器，http://localhost:5173
npm test          # Vitest：格子、家具、價格、技能樹、建角的點數（含屬性往下壓）、組裝、帳單、存檔（含第 3 版的升級）、世界編輯器的檢查（含欄位表）、街區、地下城的刷新、快捷鍵（含戰鬥的鍵）、搭車與計程車、三個戰場（命中、傷害、遮蔽、先攻、過載、整場打完）、委託、診所、機甲、難度、世界書
npm run build     # 從文件產生內容＋抽圖標＋型別檢查＋建置到 ui/dist/
npm run content   # 只重新產生 src/data/content.generated.ts
npm run preview   # 在本機看建置結果
```

- `vite.config.ts` 設了 `base: './'`，路由用 hash，所以 `dist/` 放在任何路徑底下、用任何靜態伺服器打開都能用。瀏覽器不讓 `file://` 跑模組腳本，直接雙擊 `index.html` 打不開，要經過伺服器（`npm run preview` 或 `python3 -m http.server`）。
- 直接打開某個對話框：`#/?dialog=shop&shopId=gunshop`、`#/?dialog=character&tab=bridge`、`#/?dialog=skills&tree=night`、`#/?dialog=saves&tab=snap`、`#/?dialog=mech`、`#/?dialog=clinic`（測試與截圖用；對話框的名字見 `src/stores/ui.ts` 的 `DialogName`）。
- 戰鬥畫面：`#/combat?enc=warehouse|chute|capture`、`#/netcombat?enc=bluewhale|patrol`、`#/opinion?topic=idol&foe=pr_jess`；`from=` 是打完回哪一頁，`seed=` 固定亂數，`fast=1` 讓敵人的回合不等（自動測試用）。
- `npm run build` 先跑 `scripts/build-content.mjs`：從 `docs/content/SKILL_TREES.md`、`NIGHT_LESSONS.md`、`GUIDES.md`、`docs/art/UI.md` 3.6 節與 `docs/art/icons/skills.csv` 抽出技能樹、夜課、指南，寫成 `src/data/content.generated.ts`（不要手改）。表格的格式對不上的那一列印出警告並略過，建置照樣成功；找不到文件時保留現有的輸出。
- `npm run build` 會先跑 `scripts/build-icons.mjs`：從 `docs/art/style/icons-l3-sprite.svg` 抽出資料用到的第 3 層圖標，攤平成 `public/icons-items.svg`（外部 sprite 裡巢狀的 `<use>` 瀏覽器不畫，原檔也有幾個重複的屬性，當成外部 SVG 讀時是 XML 錯誤）。資料加了新的物品，重新建置就會帶進來。

## 資料夾

| 位置 | 放什麼 |
|---|---|
| `src/components/` | 通用元件：`combat/ActionRing`（行動圓環，1～9）、`combat/HoldButton`（長按的脫離、投降、拔線）、`LivePanel`（直播面板）、`SchemaForm`（世界編輯器照欄位表畫的表單）、`ChainFlow`（任務鏈的流程圖）、`Dialog`（對話框的外框）、`DialogHost`（對話框層、Esc）、`Hint`（「?」提示）、`ItemSlot`（物品格：等級色＋圖標；放在別的按鈕裡時加 `inert`）、`GradeBadge`、`Icon`（sprite 圖標）、`Tabs`、`GridMap`（共用的格子地圖與方向鈕；掛上時登記成這一頁的移動目標）、`SkillTreeView`（技能樹的本體：對話框與建角第 8 步共用）、`TrackBar`、`MoneyTag`、`ReasonButton`（做不到的按鈕說原因）、`RuleFields`（存檔規則：設定、建角第 10 步共用）、`PartyRow`、`BodyFigure`、`CityMap`、`LogView`、`StatusBar` |
| `src/screens/` | 全頁：標題、主畫面、委託、現實戰鬥、內海戰鬥、輿論戰、開新局與建角、世界編輯器、AI 工坊、家園地圖、子網地圖、地下城、舊 Demo 的外框（只剩成人場景） |
| `src/dialogs/` | 對話框：背包、角色與義體（`character/` 是內海、橋、成人三個分頁）、和 NPC 說話、商店、設定、名冊、關係、技能樹、組裝、頻道、契約、每週帳單、指南、備忘錄、待處理、讀檔與存檔、城市地圖、搭車、中間人的店、直播、素材與剪片、機甲整備、診所、修車廠、自訂難度 |
| `src/stores/` | Pinia：`game`（假存檔；`serialize()`／`hydrate()` 是存檔的進出口，第 3 版起連 `home` 與 `subnet` 一起存；另有進行中的委託 `job`、媒體 `media`、機甲 `mech`）、`saves`（存檔的格子）、`ui`（對話框堆疊、提示訊息）、`home`、`subnet`、`settings`（設定與 AI 工坊共用） |
| `src/data/` | 有型別的假資料：物品（ITEMS；`items2.ts` 是零件、設計圖、構裝、SKIN）、主角與部位、主角第二版的資料（`profile.ts`）、NPC 與名冊、區與街區、商店、家具與家園版面、子網、地下城、建角、組裝、頻道、契約、帳單與待處理、世界編輯器、AI 工坊；`content.generated.ts` 由文件產生 |
| `src/lib/` | 純邏輯，有測試：`combat/`（`field` 兩排四格的共用部分、`real` 現實戰鬥、`net` 內海戰鬥、`opinion` 輿論戰、`rng` 有種子的擲骰）、`useBattle`（戰鬥的回合節奏與按鍵）、`commission`（怎麼付、分帳、踩點、輔助面）、`clinic`（手術費、沉溺成本、休養）、`difficulty`（難度的係數表）、`schemas`（世界編輯器的欄位表）、`lorebook`（世界書的預算、逐行差異）、`keys`（全域快捷鍵）、`transit`（搭車與計程車的車資）、`grid`（尋路、視野）、`home`（佔地、轉向、擺放的檢查、用途、舒適度、儲物）、`grade`、`price`、`skills`（學技能的條件、階、橋的容量、夜課）、`creation`（建角的點數預算、年齡）、`crafting`（槽、難度、成功率）、`bills`（帳單的結算與下坡路）、`save`（存檔的格式、回退、快照）、`worldCheck`（世界編輯器的檢查）、`dungeon`（地下城的刷新）、`useWalk`、`useGuides` |
| `src/styles/` | `tokens.css`（顏色、兩套皮、等級色、間距、字級）、`base.css`（斜切角、面板、按鈕、標籤） |
| `public/` | `icons-sprite.svg`（第 1、2 層）、`icons-items.svg`（第 3 層的子集）、`icon-centers.json`、`city-map.svg`、`legacy/`（四個可以操作的舊 Demo） |

## 做了什麼

**全頁**：標題畫面（`#/title`）、主畫面與城市地圖、開新局與建角（世界 → 內容篩選 → 建角十步，最後一頁是總覽）、世界編輯器（三級頁簽、設施、劇情計數器、匯入與匯出）、AI 工坊（任務、任務鏈、模型與路由、紀錄與回報、變數字典、提示詞組）、家園地圖、子網地圖、地下城（垃圾滑道，離開後重新擺放）、現實戰鬥、內海戰鬥、輿論戰、委託（第三版，見下）；成人場景（`public/legacy/` 的舊 Demo，用 iframe 接上）。

**對話框**：背包、角色與義體（概要含基本功、身體、裝備含快取格、內海、橋、成人）、和 NPC 說話、商店、設定、名冊、關係、技能樹（八棵樹與夜課）、組裝、頻道、契約（持約人與契約人兩面）、每週帳單、指南、備忘錄（筆記與指南）、待處理、讀檔與存檔（三個手動格、兩個自動格、匯出與匯入、委託副本的快照、紀錄的回退）。

**街區**：每一區至少一塊手畫的街區：四號塔、刀巷、千本通、中央廣場、倉庫區、俱樂部街、薔薇驛、月台市（SITES 第 3～9 節的設施）。其他街區用通用的版面。

**移動與快捷鍵**（第三版，`src/lib/keys.ts`、`App.vue`）：方向鍵與 WASD 隨時走一格、E 和腳下的東西互動，不必先點地圖（打字時、對話框開著時不作用）；手機與觸控的地圖下面有方向鈕。C 角色、B 背包、K 技能樹、R 名冊、L 關係、J 備忘錄、N 待處理、G 組裝、V 頻道、T 契約、Y 帳單、H 家園、M 城市地圖；F5／Ctrl+S 快速存檔、F9 快速讀檔；Esc 關對話框，沒有對話框時開選單。完整的表在設定的「顯示」分頁。

**城市地圖與搭車**：城市地圖是對話框（M），只能叫計程車或開自己的車；地鐵、輕軌、巴士、渡輪在街區圖上的車站，走上去就開選站（`src/data/transit.ts`）。

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
- **到了就是互動**：走到設施、出口、車站、節點上就互動，一個選項直接做、出口直接換地圖、好幾個列在「這裡」；E 再觸發一次。方向鈕只在手機與觸控。鍵值列與清單列不再撐滿整列。建角可以寫私處（成人內容，受內容篩選控制）。

## 還沒做（第四版）

- 成人場景從舊 Demo 重做成元件。
- 戰鬥的主動技能、機甲與無人機、場地效果；輿論戰的城市事件、收買、找上門、片進牌庫。
- 委託其餘的模板與連動的完整效果；機甲的升級與大修；其他住處的地圖；世界編輯器的引用關係（目前只有事件）；任務鏈其餘 13 條的流程圖。
- 紀錄的逐樓回退要等引擎存每一樓的快照。
