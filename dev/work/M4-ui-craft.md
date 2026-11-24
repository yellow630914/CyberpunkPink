# M4-ui-craft

- 交給：cpp-ui（sonnet）
- 目標：組裝對話框與染色接上引擎：會做的設計圖、把零件放進槽、預覽、誰來做、組裝、拆解、換零件；背包的成品顯示組成與價錢。`lib/crafting.ts`、`lib/dye.ts` 的規則拿掉。
- 規格出處：docs/art/UI.md 第 9 節（組裝）與染色那一段、1.1 節；CRAFTING 第 10 節；EQUIPMENT 第 9 節；dev/adr/0019 第一、四節；dev/work/M4-craft.md、M4-craft-salvage.md、M4-gear-m4.md 的「匯出」。
- 可以改的路徑：`ui/src/dialogs/CraftDialog.vue`、`ui/src/dialogs/DyeDialog.vue`、`ui/src/dialogs/BagDialog.vue`（成品的詳情）、`ui/src/dialogs/character/GearTab.vue`（曝露度、風格、重量）、`ui/src/lib/`（新增 `craftView.ts`；刪 `crafting.ts`、`dye.ts` 與它們的測試）、`ui/src/stores/engine.ts`（只加轉接）、`ui/src/data/crafting.ts`、`ui/src/data/workshop.ts`（假資料拿掉或搬進示意包）、`ui/src/data/demo/`（新增 `craft.ts`）、`ui/tests/craft/`。
- 可以用的介面：`@engine/src/features/craft` 的 `knownBlueprints`、`makers`、`assemblyPreview`、`assembleDraft`、`learnDraft`、`salvagePreview`、`salvageDraft`、`swapDraft`；`@engine/src/core` 的 `productOf`、`productPrice`、`slotProblems`；`features/gear` 的 `styleOf`、`dyeDraft` 與衍生數值 `exposure`、`style_value`、`carry_load`、`carry_cap`；`features/enemies` 的 `dissectOptions`、`dissectDraft`；`Game.commit`。
- 不可以做的事：不改 `engine/`；難度、成功率、能不能放進槽、合法性、價錢都讀引擎（現在 `lib/crafting.ts` 的 `checkSlot`、`checkAssembly`、`successChance` 整個不用）；不做訂做零件的畫面；共同的規定見 dev/work/M4-plan.md。

## 要做的

1. 組裝對話框：左邊選設計圖（只列會做的；店家代工時列店家有圖的）；中間每個槽一格，點槽列出背包裡的零件，放不進去的灰掉並寫 `slotProblems` 的原因，超規的標出來；右邊是預覽（引擎的每一個數字：難度的每一項、加值、成功率、等級、合法性、價錢、重量、合計的 `stats`、義體的沉溺成本）。來回換零件時預覽跟著變。
2. 誰來做：引擎的 `makers` 列出這裡有誰；每一種的工錢、限制（不做超規、只收全套）照引擎。確認之後送 `assembleDraft`，結果用引擎的報告（精工、瑕疵、燒掉了哪一個）顯示。
3. 拆解與換零件：背包裡的成品可以「拆解」（先顯示每個零件完好的機率）與「換零件」。戰後有東西可以拆時（`dissectOptions` 不是空的）主畫面的「這裡」多一項。
4. 背包：成品的詳情列設計圖、每個槽的零件、品質、怪癖、狀態、價錢（`productPrice`）；授權書可以「學會」。
5. 染色對話框：顏色的選項與價錢、時間讀引擎；送 `dyeDraft`。
6. 裝備分頁：曝露度、風格（主要的標籤、是不是一致）、重量與上限、超重的標示，都讀引擎（拿掉 `gearView.ts` 裡自己算的 `COAT_COVERS` 這一類，引擎給了就用引擎的）。
7. 示意世界包（`craft.ts`）：三張設計圖（手槍、防彈衣、義臂）各自的零件兩三個牌子、一個超規用的高一級零件、兩個生體零件、三筆瑕疵與怪癖、授權書兩張；槍店、同人攤、原廠各一間有 `craft` 的設施。

## 驗收條件（`ui/tests/craft/M4-ui-craft.test.ts`；用引擎真的功能）

- 沒學過的設計圖不在清單；用掉授權書之後出現。
- 放一個類型不對的零件：那一格灰掉、原因和引擎逐字相同；放一個高一級的：有超規的標示、難度多 3。
- 預覽的每個數字等於 `assemblyPreview`；換一個牌子之後難度 +1。
- 自己做與店家做各走一次：背包多一疊成品、零件少了、錢與時間對；店家遇到超規按鈕灰掉。
- 拆解：機率有顯示；拆完背包多了零件。
- 染色之後那一件的顏色存進引擎的狀態。
- 掃原始碼：`ui/src` 沒有 `lib/crafting`、`lib/dye`；`CraftDialog.vue` 沒有自己算難度的式子。
- `npm test` 與 `vue-tsc` 全過。

## 依賴

M4-craft、M4-craft-salvage、M4-gear-m4。排在 M4-ui-body 之後（都改 `stores/engine.ts`）。

## 完成時回報

改了哪些檔、測試結果、缺的圖示、`ui/src/data/items.ts` 這類舊的假目錄還有哪些畫面在用。
