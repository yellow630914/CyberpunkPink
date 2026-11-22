# M1b-ui-gear

- 交給：cpp-ui（sonnet）
- 目標：角色詳情的「裝備」分頁與背包改成讀引擎（`features/gear` 與背包），拿掉這兩處的假資料與畫面裡的規則。
- 規格出處：docs/art/UI.md 8.2 節「裝備」那一列與 8.3 節最後的「手機版」、3.7 節（背包）、第 16 節（通用元件）；EQUIPMENT 第 2～4 節、6.1 節（只為了看懂畫面上的字，規則一律問引擎）；dev/work/M1-gear.md 第一、二節（引擎給什麼）。
- 可以改的路徑：`ui/src/dialogs/CharacterDialog.vue`、`ui/src/dialogs/character/`（新增 `GearTab.vue`）、`ui/src/dialogs/BagDialog.vue`、`ui/src/components/ItemSlot.vue`、`ui/src/lib/gearView.ts`（新增，純函式：把引擎的狀態整理成畫面要的列）、`ui/src/stores/engine.ts`（只加轉接的函式）、`ui/tests/`。
- 可以用的介面（`@engine/src/features/gear`）：`gearOf`、`equipBlock`、`equip`、`unequip`、`armorOf`、`weaponOf`、`concealment`、`scanFinds`、`quickCapacity`、`WEAR_SLOTS`、`ACCESSORY_SLOTS`、`CARRY_SLOTS`、`QUICK_BASE`、`QUICK_MAX`；快取格與外套用引擎的變更（`engine/src/features/gear/changes.ts`，經由 store 的 `commit`；被擋下時顯示引擎回的原因）；背包是 `state.inventory`，物品的名字與等級查內容（`item`、`blueprint`、`part`）。
- 不可以做的事：不改 `engine/`；不在元件或 `lib` 裡判斷能不能穿、算護甲、算藏匿量（一律問引擎；`gearView.ts` 只整理與排序）；不用 `ui/src/data/items.ts`、`items2.ts` 的假資料餵這兩處；引擎還沒有的數字（重量、曝露度、風格標籤、「還能加的格子怎麼加」、目錄價與這裡賣多少）不要自己編，先不顯示並列在回報裡；拆解、丟掉、鑑定的按鈕先灰掉並寫「還沒有開放。」。

## 要做的

1. **裝備分頁**：穿著 10 格、飾品 5 格、攜帶 3 格，每格寫欄位名、物品名與等級色；空格是虛線框。快取格寫「用了幾格／上限」（上限問 `quickCapacity`）。右欄：外套敞開或扣上的切換、全身的護甲（`armorOf`）、藏匿量與藏著、露出來的東西（`concealment`）、被掃到時每件武器會不會被發現（`scanFinds`，強度先用三檔讓玩家切著看）。
2. **穿脫**：點一格列出背包裡能放這一格的東西；每一件能不能穿問 `equipBlock`，不能的灰掉、原因放在泡泡與提示列（用現有的 `ReasonButton`）。穿上、脫下各提交一份報告。
3. **背包**：篩選（全部、裝備、零件、設計圖、消耗品、貨物、雜物；義體與素材在 M4 之前沒有東西，篩選鈕留著、裡面是空的說明）；物品格用 `ItemSlot`；詳情寫類別、等級、組成（成品的零件）、武器的數字（`weaponOf`）；按鈕「裝上」（寫裝到哪一格）、「放進快取格」。
4. **手機版**：裝備格三欄；詳情接在清單下面。
5. 戰鬥中、等著選戰敗的三個選擇時整頁唯讀，原因用 store 的 `blockOf`。

## 驗收條件（測試自己寫在 `ui/tests/`；內容用測試自帶的最小假資料：兩張設計圖、三個零件、兩件消耗品，接在核心的內容後面——store 的建局入口加一個只給測試用的參數把假內容帶進去）

- 穿上一件之後，那一格顯示它、引擎的狀態裡也有；存檔再讀回來還在。
- 引擎說不能穿的東西按鈕是灰的，`title` 是引擎回的那一句，畫面上沒有自己拼的原因。
- 連身的衣服佔兩格、兩格都顯示它；被外套蓋住的格子有「被外套蓋住」。
- 快取格放滿之後再放會被引擎擋下、提示列是引擎的原因；用了幾格的數字跟著變。
- 護甲、藏匿量、掃描的結果和直接呼叫引擎函式的結果一樣（測試拿兩邊比）。
- 背包的篩選只留那一類；詳情裡武器的命中、骰數、射程和 `weaponOf` 一樣。
- 元件與 `gearView.ts` 裡沒有出現護甲、藏匿、容量的算式（測試掃原始碼：這兩處不 import `ui/src/data/items*`、不出現 `QUICK_BASE +` 這類自己算的寫法）。
- 手機寬度下裝備格是三欄（快照或樣式的斷點測試）。
- `npm test` 與 `vue-tsc` 全過。

## 依賴

只靠已經做完的 `features/gear`；不必等第二波的其他工單，可以最早開始。

## 完成時回報

改了哪些檔、測試結果、UI.md 那兩節裡因為引擎還沒有而沒顯示的欄位清單、還留在畫面裡的規則（如果有）。
