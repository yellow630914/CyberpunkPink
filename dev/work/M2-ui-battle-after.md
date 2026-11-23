# M2-ui-battle-after

- 交給：cpp-ui（sonnet）
- 目標：戰鬥結束之後的三塊畫面接上引擎：戰敗事件（演、選項、後果、三選一，加上被贖回這類多出來的選項）、打贏的戰利品、俘虜的處置。
- 規格出處：docs/art/UI.md 4.1 節（戰敗事件）、第 4 節裡戰鬥結束的部分；COMBAT_SYSTEM 8.3、8.4 節（只為了看懂畫面上的字）；dev/status.md「被贖回（保釋）的選項要 UI 用 defeatOptions／chooseDefeatOption 顯示」；dev/work/M2-defeat.md、M2-enemy-encounter.md、M1b-loot.md 的「對外」與報告的樣子。
- 可以改的路徑：`ui/src/screens/CombatScreen.vue`、`ui/src/components/combat/`（新增 `DefeatPanel.vue`、`SpoilsPanel.vue`）、`ui/src/lib/`（新增 `afterBattleView.ts`，只整理）、`ui/src/stores/engine.ts`（只加轉接）、`ui/tests/`。
- 可以用的介面：`@engine/src/features/defeat`（`defeatView`、看或不看、接受、`defeatOptions`、`chooseDefeatOption`）、`Game.retryBattle`、`Game.rewindToStage`、`@engine/src/features/director`（戰敗事件與俘虜的處置都是事件視窗：`eventView`、`chooseOption`）、戰鬥結束那一份報告（戰利品的每一行、現金）、`@engine/src/features/commission`（`commissionView`：在不在副本裡）。
- 不可以做的事：不改 `engine/`；「接受之後會怎樣」（委託失敗或繼續、最多被拿多少）照引擎的 `defeatView` 顯示，不自己推；沒有成人場景的畫面時（M2-ui-scene 還沒做完）場景的入口先顯示「略過」的結果；共同的規定見 dev/work/M2-plan.md。

## 要做的

1. **戰敗**（取代戰鬥畫面）：抬頭（在哪裡、誰贏了、哪一件戰敗事件）；引擎先問要不要看的時候給兩個按鈕；事件進行中用 M2-ui-world 的事件視窗元件嵌在面板裡（正文橘色左線、選項、條件不夠的變淡）；事件做完之後才亮「接受結果」；「重來這場戰鬥」「回到這個階段開始時」一直在。多出來的選項（被贖回）照引擎回的列出來：名字、說明、選不了的原因。
2. **後果**兩格：這一次的後果（委託失敗或繼續、錢與快取格、敵對值）與回退時留下的。
3. **戰利品**（打贏）：拿到的每一樣與現金，從戰鬥結束那一份報告讀；俘虜有人可以帶走時，接著是事件視窗的那幾個選項。
4. 手機版：面板直向排，三選一固定在底部。

## 驗收條件（測試自帶一件兩段的假戰敗事件、一個帶掉落的假敵人）

- 打輸之後面板出現；事件還沒做完時「接受結果」是灰的、原因是引擎的；兩段都選完之後亮起來。
- 存檔規則是「可以跳過」時先問；選不看，面板直接列出結果。
- 接受之後面板關掉、不再擋；在副本裡而且這件事件算失敗時，畫面回到出發之前（引擎回退），紀錄留著。
- 被贖回：有保釋而且現金夠時列出來、選了之後扣錢並跳過事件；現金不夠時是灰的並寫引擎的原因。
- 重來：回到開打之前再打一次；事件扣的東西回來了。
- 打贏：戰利品的每一行和報告裡的一樣；有俘虜時四個（或三個）選項照引擎的，選完之後面板關掉。
- 面板與 `afterBattleView.ts` 裡沒有機率與金額的算式。
- `npm test` 與 `vue-tsc` 全過。

## 依賴

M2-defeat、M2-enemy-encounter、M2-ui-world（事件視窗的元件）。

## 完成時回報

改了哪些檔、測試結果、UI 4.1 節裡因為引擎還沒有而沒顯示的東西。
