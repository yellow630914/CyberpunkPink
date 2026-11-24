# M4-ui-creation

- 交給：cpp-ui（sonnet）
- 目標：建角的第 5、6、8、9 步與總覽接上引擎；技能頁的歷練點與升基本功用引擎的。`lib/creation.ts`、`lib/skills.ts` 裡的規則拿掉。
- 規格出處：docs/art/UI.md 第 14 節（建角）、8.3～8.4 節（技能頁）；CHARACTER 第 1～3 節、5.4 節；dev/adr/0019 第十一節；dev/work/M4-creation-body.md、M4-creation-lifepath.md、M4-abilities-m4.md 的「匯出」；dev/status.md「M0 收尾」「技能介面等引擎給的」。
- 可以改的路徑：`ui/src/screens/NewGameScreen.vue` 與它的子元件、`ui/src/dialogs/SkillTreeDialog.vue`、`ui/src/components/SkillTreeView.vue`、`ui/src/lib/`（刪 `creation.ts` 裡第 5、6、8、9 步的規則與 `skills.ts` 的規則；`derivedLooks` 這種純文字的可以留）、`ui/src/data/creation.ts`（假的選項搬進示意包）、`ui/src/stores/engine.ts`（只加轉接）、`ui/src/data/demo/`（新增 `creation.ts`）、`ui/tests/creation/`。
- 可以用的介面：`@engine/src/features/creation` 的 `creationLimits`、`creationSummary`、`cyberStepBlock`、`abilitiesStepBlock`、`gearStepBlock`、`lifepathTables`、`lifepathRoll`、`lifepathBlock`、`lifepathResults`、`commit`；`features/abilities` 的 `learnBlock`、`capacityOf`、`skillUpBlock`／`skillUpDraft`、`respecQuote`／`respecDraft`、`abilitiesOf`；`features/cyberware` 的 `bridgeCapacityOf`；核心的 `productPrice`。
- 不可以做的事：不改 `engine/`；點數、能不能選、擋住的原因、換多少現金全部讀引擎；快速開始的預設角色不做（按鈕留著、灰掉並說明）；共同的規定見 dev/work/M4-plan.md。

## 要做的

1. 第 5 步（生命軌跡）：`lifepathTables` 給的每張表一個下拉（選、擲、跳過）；「潛在性癖」可以把標籤標成潛在；整張被篩掉的表不出現；右邊是 `lifepathResults`（每一條會變成什麼）。
2. 第 6 步（橋與義體）：列出買得到的橋（含「沒有橋」，選它之前跳一個說明後果的確認）與義體，每一件的點數、沉溺成本、部位；右邊是點數、沉溺的起點、四類容量（選了橋就看得到）；擋住的原因用引擎的。
3. 第 8 步（技能）：技能樹用引擎的 `learnBlock` 那一套的建角版（`abilitiesStepBlock`）；學的順序就是裝的順序，容量不夠的標出來「學了但還裝不下」。
4. 第 9 步（錢與裝備）：可以買的東西與點數讀引擎；白給的東西列在最上面；沒花完的點數換多少現金即時顯示。
5. 總覽：`creationSummary`；任何一步擋住時不能開始，點那一行回到那一步。
6. 技能頁（遊戲中）：歷練點讀引擎的（拿掉假 store 的 `xp`）；基本功的升級按鈕（`skillUpDraft`；5、6 級顯示引擎的那一句，M4-training 做完之後由 M4-ui-contract 接「請教」）；洗點的入口（在調校診所）。
7. 示意世界包（`creation.ts`）：每張生命軌跡表三四條（含一條被篩選標籤擋住的、一條出身限定的）、出身的 `kit_free`、買得到的橋與義體、起始裝備的清單；都照 M4-ui-body 的示意資料引用同一批東西。

## 驗收條件（`ui/tests/creation/M4-ui-creation.test.ts`；用引擎真的功能）

- 第 6 步超過 10 點：下一步灰掉、原因和引擎逐字相同；選「沒有橋」之後第 8 步整頁是引擎給的那一句。
- 第 5 步：關掉一個篩選標籤之後對應的條目消失；擲的結果和 `lifepathRoll` 一樣。
- 走完整個建角按開始：引擎的主角有選的橋與義體、學的技能裝上了、背包有買的與白給的、錢是 1,500 加沒花完的點數換的。
- 技能頁的歷練點等於引擎的；升一級基本功之後兩邊一致。
- 掃原始碼：`NewGameScreen` 與它的子元件不 import `lib/creation` 的 `cyberPickBlock`、`gearAddBlock`、`fitKit` 與 `lib/skills` 的 `learnBlock`；`ui/src/lib/creation.ts` 裡沒有 `CYBER_POINTS`、`GEAR_POINTS`。
- `npm test` 與 `vue-tsc` 全過。

## 依賴

M4-creation-body、M4-creation-lifepath、M4-abilities-m4。

## 完成時回報

改了哪些檔、測試結果、`ui/src/lib/creation.ts` 還留著什麼與為什麼、外觀的推導（外露的義體、獸化、風格）目前還在介面（要不要搬進引擎請 cpp-architect 決定）。
