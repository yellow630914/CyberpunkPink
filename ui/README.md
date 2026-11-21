# CyberpunkPink 互動介面 v1

這是遊戲介面的**參考實作**：Vue 3 + Pinia + Vite + TypeScript，和引擎預定的技術相同（[IMPLEMENTATION](../docs/plan/IMPLEMENTATION.md) 第 1 節）。它取代 `docs/mockups/` 的靜態樣稿，當作寫引擎時的介面依據；兩者不一致時以這裡為準（規則寫在 [UI](../docs/art/UI.md) 的「互動版介面」一節）。

資料全部是假的：沒有後端、沒有 AI 呼叫。狀態放在 Pinia 的 store 裡，之後換成引擎狀態的投影。

## 怎麼跑

```bash
cd ui
npm install
npm run dev       # 開發伺服器，http://localhost:5173
npm test          # Vitest：格子尋路、家具擺放的檢查、等級色、價格
npm run build     # 型別檢查＋建置到 ui/dist/
npm run preview   # 在本機看建置結果
```

- `vite.config.ts` 設了 `base: './'`，路由用 hash，所以 `dist/` 放在任何路徑底下、用任何靜態伺服器打開都能用。瀏覽器不讓 `file://` 跑模組腳本，直接雙擊 `index.html` 打不開，要經過伺服器（`npm run preview` 或 `python3 -m http.server`）。
- 直接打開某個對話框：`#/?dialog=shop&shopId=gunshop`、`#/?dialog=character&tab=gear`、`#/?dialog=talk&npcId=xiaomai`（測試與截圖用）。
- `npm run build` 會先跑 `scripts/build-icons.mjs`：從 `docs/art/style/icons-l3-sprite.svg` 抽出資料用到的第 3 層圖標，攤平成 `public/icons-items.svg`（外部 sprite 裡巢狀的 `<use>` 瀏覽器不畫，原檔也有幾個重複的屬性，當成外部 SVG 讀時是 XML 錯誤）。資料加了新的物品，重新建置就會帶進來。

## 資料夾

| 位置 | 放什麼 |
|---|---|
| `src/components/` | 通用元件：`Dialog`（對話框的外框）、`DialogHost`（對話框層、Esc）、`Hint`（「?」提示）、`ItemSlot`（物品格：等級色＋圖標）、`GradeBadge`、`Icon`（sprite 圖標）、`Tabs`、`GridMap`（共用的格子地圖）、`TrackBar`、`MoneyTag`、`ReasonButton`（做不到的按鈕說原因）、`PartyRow`、`BodyFigure`、`CityMap`、`LogView`、`StatusBar` |
| `src/screens/` | 全頁：主畫面與城市地圖、家園地圖、子網地圖、地下城、舊 Demo 的外框 |
| `src/dialogs/` | 對話框：背包、角色與義體、和 NPC 說話、商店、設定 |
| `src/stores/` | Pinia：`game`（假存檔）、`ui`（對話框堆疊、提示訊息）、`home`、`subnet`、`settings` |
| `src/data/` | 有型別的假資料：物品（取自 ITEMS）、主角與部位、NPC（小麥）、區與街區、商店、家具與家園版面、子網、地下城 |
| `src/lib/` | 純邏輯，有測試：`grid`（尋路、視野）、`home`（佔地、轉向、擺放的檢查、用途、舒適度、儲物）、`grade`（等級色）、`price`（TRADE 的公式）、`useWalk`（點格子走路） |
| `src/styles/` | `tokens.css`（顏色、兩套皮、等級色、間距、字級）、`base.css`（斜切角、面板、按鈕、標籤） |
| `public/` | `icons-sprite.svg`（第 1、2 層）、`icons-items.svg`（第 3 層的子集）、`icon-centers.json`、`city-map.svg`、`legacy/`（四個可以操作的舊 Demo） |

## 做了什麼

**全頁**：主畫面與城市地圖（三欄；手機是四個分頁）、家園地圖、子網地圖（內海皮）、地下城（垃圾滑道）、現實戰鬥／內海戰鬥／輿論戰／成人場景（`public/legacy/` 的舊 Demo，用 iframe 接上）。

**對話框**：背包、角色與義體（概要、身體、裝備）、和 NPC 說話、商店（三間店）、設定（七個分頁的簡單版，存檔頁真的存進瀏覽器）。

**五條介面規則**的做法見 [UI](../docs/art/UI.md) 的「互動版介面」一節。

## 還沒做（第二版）

- 對話框：名冊、關係、技能樹、組裝、頻道、契約、帳單、指南、待處理；讀檔與存檔獨立成對話框（現在在設定裡）。
- 全頁：世界編輯器、AI 工坊、建角、標題畫面；戰鬥、輿論戰、成人場景改寫成元件（現在是舊 Demo）。
- 角色與義體的「內海」「橋」「成人」三個分頁；快取格的換裝；義體在診所的拆裝。
- 街區：只有四號塔、天井市場、倉庫區、刀巷有自己的設施，其他街區用通用的版面。
- 家園的三級店面與安全屋；子網的巡邏與戰鬥內的管理行動；地下城的刷新。
- 鍵盤操作格子地圖（現在只有家具的 R 轉向）。
