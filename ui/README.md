# CyberpunkPink 互動介面（第二版）

這是遊戲介面的**參考實作**：Vue 3 + Pinia + Vite + TypeScript，和引擎預定的技術相同（[IMPLEMENTATION](../docs/plan/IMPLEMENTATION.md) 第 1 節）。它取代 `docs/mockups/` 的靜態樣稿，當作寫引擎時的介面依據；兩者不一致時以這裡為準（規則寫在 [UI](../docs/art/UI.md) 的「互動版介面」一節）。

資料全部是假的：沒有後端、沒有 AI 呼叫。狀態放在 Pinia 的 store 裡，之後換成引擎狀態的投影。

## 怎麼跑

```bash
cd ui
npm install
npm run dev       # 開發伺服器，http://localhost:5173
npm test          # Vitest：格子、家具、價格、技能樹、建角的點數、組裝、帳單、存檔、世界編輯器的檢查、街區、地下城的刷新
npm run build     # 從文件產生內容＋抽圖標＋型別檢查＋建置到 ui/dist/
npm run content   # 只重新產生 src/data/content.generated.ts
npm run preview   # 在本機看建置結果
```

- `vite.config.ts` 設了 `base: './'`，路由用 hash，所以 `dist/` 放在任何路徑底下、用任何靜態伺服器打開都能用。瀏覽器不讓 `file://` 跑模組腳本，直接雙擊 `index.html` 打不開，要經過伺服器（`npm run preview` 或 `python3 -m http.server`）。
- 直接打開某個對話框：`#/?dialog=shop&shopId=gunshop`、`#/?dialog=character&tab=bridge`、`#/?dialog=skills&tree=night`、`#/?dialog=saves&tab=snap`（測試與截圖用；對話框的名字見 `src/stores/ui.ts` 的 `DialogName`）。
- `npm run build` 先跑 `scripts/build-content.mjs`：從 `docs/content/SKILL_TREES.md`、`NIGHT_LESSONS.md`、`GUIDES.md`、`docs/art/UI.md` 3.6 節與 `docs/art/icons/skills.csv` 抽出技能樹、夜課、指南，寫成 `src/data/content.generated.ts`（不要手改）。表格的格式對不上的那一列印出警告並略過，建置照樣成功；找不到文件時保留現有的輸出。
- `npm run build` 會先跑 `scripts/build-icons.mjs`：從 `docs/art/style/icons-l3-sprite.svg` 抽出資料用到的第 3 層圖標，攤平成 `public/icons-items.svg`（外部 sprite 裡巢狀的 `<use>` 瀏覽器不畫，原檔也有幾個重複的屬性，當成外部 SVG 讀時是 XML 錯誤）。資料加了新的物品，重新建置就會帶進來。

## 資料夾

| 位置 | 放什麼 |
|---|---|
| `src/components/` | 通用元件：`Dialog`（對話框的外框）、`DialogHost`（對話框層、Esc）、`Hint`（「?」提示）、`ItemSlot`（物品格：等級色＋圖標；放在別的按鈕裡時加 `inert`）、`GradeBadge`、`Icon`（sprite 圖標）、`Tabs`、`GridMap`（共用的格子地圖，方向鍵與 Enter）、`TrackBar`、`MoneyTag`、`ReasonButton`（做不到的按鈕說原因）、`RuleFields`（存檔規則：設定、建角第 10 步共用）、`PartyRow`、`BodyFigure`、`CityMap`、`LogView`、`StatusBar` |
| `src/screens/` | 全頁：標題、主畫面與城市地圖、開新局與建角、世界編輯器、AI 工坊、家園地圖、子網地圖、地下城、舊 Demo 的外框 |
| `src/dialogs/` | 對話框：背包、角色與義體（`character/` 是內海、橋、成人三個分頁）、和 NPC 說話、商店、設定、名冊、關係、技能樹、組裝、頻道、契約、每週帳單、指南、備忘錄、待處理、讀檔與存檔 |
| `src/stores/` | Pinia：`game`（假存檔；`serialize()`／`hydrate()` 是存檔的進出口）、`saves`（存檔的格子）、`ui`（對話框堆疊、提示訊息）、`home`、`subnet`、`settings`（設定與 AI 工坊共用） |
| `src/data/` | 有型別的假資料：物品（ITEMS；`items2.ts` 是零件、設計圖、構裝、SKIN）、主角與部位、主角第二版的資料（`profile.ts`）、NPC 與名冊、區與街區、商店、家具與家園版面、子網、地下城、建角、組裝、頻道、契約、帳單與待處理、世界編輯器、AI 工坊；`content.generated.ts` 由文件產生 |
| `src/lib/` | 純邏輯，有測試：`grid`（尋路、視野）、`home`（佔地、轉向、擺放的檢查、用途、舒適度、儲物）、`grade`、`price`、`skills`（學技能的條件、階、橋的容量、夜課）、`creation`（建角的點數預算、年齡）、`crafting`（槽、難度、成功率）、`bills`（帳單的結算與下坡路）、`save`（存檔的格式、回退、快照）、`worldCheck`（世界編輯器的檢查）、`dungeon`（地下城的刷新）、`useWalk`、`useGuides` |
| `src/styles/` | `tokens.css`（顏色、兩套皮、等級色、間距、字級）、`base.css`（斜切角、面板、按鈕、標籤） |
| `public/` | `icons-sprite.svg`（第 1、2 層）、`icons-items.svg`（第 3 層的子集）、`icon-centers.json`、`city-map.svg`、`legacy/`（四個可以操作的舊 Demo） |

## 做了什麼

**全頁**：標題畫面（`#/title`）、主畫面與城市地圖、開新局與建角（世界 → 內容篩選 → 建角十步，最後一頁是總覽）、世界編輯器（三級頁簽、設施、劇情計數器、匯入與匯出）、AI 工坊（任務、任務鏈、模型與路由、紀錄與回報、變數字典、提示詞組）、家園地圖、子網地圖、地下城（垃圾滑道，離開後重新擺放）、現實戰鬥／內海戰鬥／輿論戰／成人場景（`public/legacy/` 的舊 Demo，用 iframe 接上）。

**對話框**：背包、角色與義體（概要含基本功、身體、裝備含快取格、內海、橋、成人）、和 NPC 說話、商店、設定、名冊、關係、技能樹（八棵樹與夜課）、組裝、頻道、契約（持約人與契約人兩面）、每週帳單、指南、備忘錄（筆記與指南）、待處理、讀檔與存檔（三個手動格、兩個自動格、匯出與匯入、委託副本的快照、紀錄的回退）。

**街區**：每一區至少一塊手畫的街區：四號塔、刀巷、千本通、中央廣場、倉庫區、俱樂部街、薔薇驛、月台市（SITES 第 3～9 節的設施）。其他街區用通用的版面。

**格子地圖的鍵盤**：地圖拿到焦點時方向鍵走一格，Enter 和腳下的東西互動（街區：走進設施或出口；家園：擺設時移動游標、Enter 放下；子網與地下城：跳到這一格的行動）。

**和設定共用的值**：AI 工坊與設定讀寫同一個 `settings` store（PROMPTS 2.14 節）；建角第 10 步、設定的「遊戲」分頁用同一個 `RuleFields`；讀檔與存檔對話框和設定的「存檔」分頁用同一組格子。

**五條介面規則**的做法見 [UI](../docs/art/UI.md) 的「互動版介面」一節。

## 還沒做（第三版）

- 三個戰場與成人場景從舊 Demo 改寫成元件（優先順序：現實戰鬥、內海戰鬥、輿論戰；成人場景先留舊 Demo）。
- 委託畫面（接案、踩點、召集、副本的階段軌）；中間人的店；直播面板、素材與剪片；機甲整備。
- 家園的三級店面與安全屋；子網的巡邏與戰鬥內的管理行動；義體在診所的拆裝；調校的安裝。
- 世界編輯器裡「區與街區、勢力、子網、技能樹」等種類的編輯；AI 工坊的世界書、生圖、和預設比較；自訂難度的係數表。
- 回退目前只回存 `game` store（子網、家園的 store 不在快照裡）；紀錄的逐樓回退要等引擎存每一樓的快照。
