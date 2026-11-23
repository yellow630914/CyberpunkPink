# M2-ui-commission

- 交給：cpp-ui（sonnet）
- 目標：委託的四拍（接案、踩點、召集、副本）與中間人的店接上引擎；副本裡的探索改走引擎的地圖；召集頁的技能配置讀引擎；舊的假副本與它自己的快照拿掉，「回到這個階段開始時」的第二份重現轉正。
- 規格出處：docs/art/UI.md 第 7 節全部、第 13 節（中間人）、3.5 節（錢與人情怎麼標）；dev/bugs/2026-11-22-ui-stage-outside-dungeon.md（第二份重現）；dev/work/M2-fixer.md、M2-fixer-pay.md、M2-commission-run.md、M2-commission-aux.md、M2-commission-close.md、M2-explore.md 的「新的格式與鍵」與「對外」。
- 可以改的路徑：`ui/src/screens/CommissionScreen.vue`、`DungeonScreen.vue`、`ui/src/dialogs/FixerDialog.vue`、`ui/src/components/`（新增 `StageTrack.vue`）、`ui/src/lib/`（新增 `commissionView.ts`；`commission.ts`、`dungeon.ts` 裡的規則刪掉）、`ui/src/stores/engine.ts`（只加轉接）、`ui/src/stores/game.ts`（拿掉副本的假狀態、`takeSnapshot('階段' | '入口')`、`inRun`、`loadout`）、`ui/src/data/demo/`、`ui/tests/`（含 `fixtures/repro-pending/ui-stage-legacy-dungeon.json`、`tests/pending/M1-ui-combat-picks-bugs.test.ts`、`helpers/uiRepro.ts`）。
- 可以用的介面：`@engine/src/features/fixer`（`board`、`payOptions`、`accept`、交涉、`scout`、買情報、`scoutedOf`、`hireOptions`、`hire`、`splitPreview`、`go`）、`@engine/src/features/roster`（`muster`）、`@engine/src/features/commission`（`commissionView`、選面、選分支、喘口氣、撤退）、`@engine/src/features/explore`（這一格能做的事、開鎖）、`@engine/src/features/abilities`（裝著的技能）、`Game.gridMove`、`Game.rewindToStage`、`Game.commitNarrated`。
- 不可以做的事：不改 `engine/`；成功率、分帳、DC、評價都問引擎，畫面不自己算；派名冊的人去踩點先灰掉並寫「還沒有開放。」；輿論與內海的面照引擎回的原因顯示，不自己判斷；共同的規定見 dev/work/M2-plan.md。

## 要做的

1. **接案**：委託清單、簡報（沒踩到的階段是問號）、怎麼付的三格（到手的數字與代價）、那一輪交涉、接案。
2. **踩點**：未知清單（沒揭開的寫哪些手段揭得開）、次數的格子（第 4 次起 +1 先標出來）、每種手段的加值與成功率、上一次的擲骰、買情報。
3. **召集**：隊伍與同行（名冊的 `muster`）、這一趟裝的技能（讀引擎，標「進去之後不能換」）、分帳的那一條（`splitPreview`）、輔助面每一面派誰與四種請人的辦法（選不了的寫引擎的原因）、出發。
4. **副本**：階段軌、面卡（沒有開放的面變淡並寫原因）、輔助面的擲骰、分支（條件不夠的寫原因）、拿到的連動、警戒條（刻度在 60）、喘口氣、撤退（先提示會回到進去之前）。「進入這一段」之後是引擎的地圖：走路、這一格能做的事、上鎖的門被擋下時給撬與破門兩個按鈕。
5. **舊系統**：`stores/game.ts` 裡副本的假狀態與它自己的快照拿掉；戰敗三選一的「回到這個階段開始時」只轉接 `Game.rewindToStage`。把 `ui-stage-legacy-dungeon.json` 改寫成走引擎的委託（進副本、進第一階段、過一段時間、打輸、回到階段），期望不變（時間回到這個階段開始的那一刻），搬到 `ui/tests/fixtures/repro/`；pending 的那個測試檔跟著轉正或刪掉。
6. **示意世界包**（M2-plan 第 5 項）：把 `ui/src/data/commission.ts`、`dungeon.ts` 的示意資料整理成引擎的內容（中間人、兩三種委託的類型、詞條、連動、地圖沿用 `engine/data` 已經有的）。

## 驗收條件（測試自帶一個中間人與兩件假副本）

- 接案之後引擎的狀態裡有那一件；三種付法畫面上的數字和引擎的 `payOptions` 一樣。
- 踩點一次：時間往前一個時段、揭開的那一格從問號變成內容；自然 1 時畫面有驚動目標的提醒；次數用完按鈕是灰的並有原因。
- 召集：第五個人加不進去、原因是引擎的；技能的標籤和引擎裝著的一樣（測試掃原始碼：`CommissionScreen` 不再讀 `g.loadout`）。
- 分帳那一條每一段的數字和 `splitPreview` 一樣。
- 進副本之後商店、休息的入口被擋（原因是引擎的）；選面、選分支、走完一段，階段軌往前一格、城裡的時間多 2 小時。
- 只有強攻走得了時其他分支是灰的並各有原因。
- 撤退：回到召集頁，時間與錢回到出發之前，紀錄裡那一段標成被收回。
- 在副本裡打輸選「回到這個階段開始時」：回到這個階段的開頭（重播的那一份固定檔通過）。
- `lib/commission.ts`、`lib/dungeon.ts` 裡沒有擲骰與算式；元件不 import `ui/src/data/commission`。
- `npm test` 與 `vue-tsc` 全過。

## 依賴

M2-fixer、M2-fixer-pay、M2-commission-gen、M2-commission-run、M2-commission-aux、M2-commission-close、M2-explore、M2-roster。排在 M2-ui-world 之後（地圖的元件共用）。

## 完成時回報

改了哪些檔、測試結果、UI 第 7 節裡因為引擎還沒有而沒顯示的東西（預期：附帶條件、直播、輿論的壓力）、刪掉的舊程式清單。
