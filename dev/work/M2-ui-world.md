# M2-ui-world

- 交給：cpp-ui（sonnet）
- 目標：主畫面的城市接上引擎：街區圖與走路、「這裡」能做的事、城市地圖、搭車；事件視窗與待處理；掃橋的框。拿掉這幾處畫面裡的規則與假資料。
- 規格出處：docs/art/UI.md 1.1 節、3.1、3.3 節、3.11 節（掃橋）、3.13、3.14 節；dev/adr/0016 第一、二、四節；dev/work/M2-world.md、M2-transit.md、M2-event-run.md、M2-security.md 的「新的格式與鍵」與「對外」那幾條（引擎給什麼）。
- 可以改的路徑：`ui/src/screens/MainScreen.vue`、`ui/src/components/`（`GridMap.vue`、`CityMap.vue`、`HereOptions.vue`；新增 `EventDialog.vue`、`ScanDialog.vue` 放 `ui/src/dialogs/`）、`ui/src/dialogs/`（`CityDialog.vue`、`TransitDialog.vue`、`PendingDialog.vue`）、`ui/src/lib/`（新增 `worldView.ts`：只整理與排序；`grid.ts`、`here.ts`、`transit.ts` 裡被引擎取代的規則刪掉）、`ui/src/stores/engine.ts`（只加轉接）、`ui/src/data/demo/`（新：示意世界包）、`ui/tests/`。
- 可以用的介面：`@engine/src/features/world`（`arrive`、`worldView`、`cityGraph`）、`Game.gridMove`／`gridView`、`@engine/src/features/transit`（`transitView` 與上車、坐一站、下車、計程車）、`@engine/src/features/director`（`eventView`、`chooseOption`、`directorView`）、`@engine/src/features/security`（`scanView`）、store 的 `blockOf`、`commit`、`act`、`Game.commitNarrated`。
- 不可以做的事：不改 `engine/`；元件與 `lib` 裡不算機率、車資、DC、能不能過（一律問引擎）；引擎沒有的東西（車廂裡的人、看窗外、區域狀態）先不顯示並列在回報裡；共同的規定見 dev/work/M2-plan.md。

## 要做的

1. **街區圖**：畫引擎的 `gridView`；方向鍵與點格子走 `gridMove`；被擋下時把引擎的原因放提示列。「這裡」列引擎回的每一項能做的事（設施的、各功能的），灰掉的帶原因。
2. **城市地圖**：區與街區怎麼連用 `cityGraph`，現在的位置用 `worldView`；計程車的選項、車資與做不到的原因問引擎。
3. **搭車**：站在車站上打開；路線條、每站的時間與車資、深夜停駛的原因照 `transitView`。「坐到目的地」是介面一站一站呼叫引擎，中途引擎開了事件就停。
4. **事件視窗**（`EventDialog`）：引擎有開著的事件時自動打開、擋住別的操作；正文、選項（選不了的灰掉並寫引擎的原因）、檢定的基本功與成功率、「我要做別的」的輸入框（送自由行動）；選完顯示擲骰與結果。標題寫還有幾件延後的。
5. **掃橋**（`ScanDialog`）：事件是掃橋發起的時候換成這個樣子：四步各一列（過、注意、不適用）、身上會被掃到的東西、怎麼過的每一條。
6. **示意世界包**（M2-plan 要使用者定的第 5 項；沒定之前先做）：把 `ui/src/data/districts.ts`、`transit.ts` 與幾件示意的街頭事件整理成引擎的內容（區、街區與版面、設施、路線、事件與範圍的設定），開新局時經 store 的建局入口載入。

## 驗收條件（測試自己寫在 `ui/tests/`；內容用測試自帶的最小假資料，不用示意世界包）

- 走一步之後畫面的位置、時間和引擎的狀態一致；走到出口換到隔壁那一塊；被牆擋下時提示列是引擎的句子。
- 走上設施，「這裡」出現引擎列的那幾項；不在營業時間的那一項是灰的、`title` 是引擎的原因。
- 引擎開了事件：視窗出現、走路的按鈕被擋；選一個選項之後視窗關掉、紀錄多一份；選不了的選項是灰的。
- 「我要做別的」送出去的是自由行動，事件跟著結束。
- 掃橋：四步的狀態與引擎的 `scanView` 一樣；選掉頭之後人沒有過去。
- 搭車：上車扣的錢、每站的時間和引擎一樣；快轉途中有事件就停在那一站。
- 計程車在 `fastTravel` 關著時按鈕是灰的、原因是引擎的。
- 元件與 `worldView.ts` 裡沒有機率、車資與 DC 的算式（測試掃原始碼：不 import `ui/src/data/districts`、`transit` 的假資料，不出現自己擲骰的寫法）。
- 手機寬度下事件視窗的選項直向排、不超出畫面。
- `npm test` 與 `vue-tsc` 全過。

## 依賴

M2-world、M2-transit、M2-event-run、M2-security。介面的六張彼此不要同時做（都改 `stores/engine.ts`）。

## 完成時回報

改了哪些檔、測試結果、UI 那幾節裡因為引擎還沒有而沒顯示的欄位、還留在畫面裡的規則（如果有）。
