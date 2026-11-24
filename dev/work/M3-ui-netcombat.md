# M3-ui-netcombat

- 交給：cpp-ui（sonnet）
- 目標：內海戰鬥的畫面接上引擎：和現實戰鬥用同一組戰鬥元件，照引擎給的戰場換皮換字，加上同步檔位、追蹤度條、管理行動三塊；舊 Demo 的規則（`lib/combat/net.ts`）整份拿掉。
- 規格出處：docs/art/UI.md 第 5 節（最後兩條：網內戰鬥的版面、手機版）、第 4 節（現實戰鬥的版面、長按、鍵位）、1.1 節「戰鬥的鍵」；CYBERSPACE 6.1 節的對照表（哪些字要換）；dev/adr/0018 第十二節（那張「不照 Demo」的表）；dev/adr/0014（`icon`、`picks`）；dev/work/M3-netcombat.md、M3-netcombat-out.md、M3-netadmin.md 的「新的格式與鍵」與匯出的 `netBattleView`。
- 可以改的路徑：`ui/src/screens/NetCombatScreen.vue`、`CombatScreen.vue`（只抽共用的部分）、`ui/src/components/combat/`、`ui/src/lib/`（`battleView.ts`、`battlePicks.ts`、`useBattle.ts`、`keys.ts`、`liveEvents.ts`；刪 `lib/combat/net.ts`、`net4.test.ts`，`lib/combat/real.ts` 被引用的常數與型別搬到 `battleView.ts` 之後刪掉）、`ui/src/data/combatIcons.ts`、`ui/src/data/encounters.ts`（刪 `NET_ENCOUNTERS`；整檔沒有人用就刪）、`ui/src/stores/engine.ts`（只加轉接）、`ui/src/App.vue`（戰鬥換頁與內海皮照狀態）、`ui/src/router.ts`、`ui/tests/net/`。
- 可以用的介面：`@engine/src` 的 `battleOptions`、`battleAct`、`battleNext`、`finishBattle`、`retryBattle`；`@engine/src/features/netcombat` 的 `netBattleView`；戰場的資料（`coverNames`、`coverWord`、`layer`）；每一拍的事件標籤（`shift`、`jam`、`break`、`pin`、`jack_out`、`admin`、`trace`、`located`、`overload` 的 `data.flash`）。
- 不可以做的事：不改 `engine/`；命中率、花費、能不能做、為什麼不能、次數、追蹤度都讀引擎，畫面不自己算；不留任何內海的戰鬥邏輯在 `ui/`；`lib/combat/opinion.ts`、`field.ts`、`rng.ts` 不動（輿論戰還在用）；共同的規定見 dev/work/M3-plan.md。

## 要做的

1. **一組元件、兩個戰場**：把 `CombatScreen` 裡和戰場無關的部分（先攻條、雙方四格、行動圓環、目標與 `picks` 的流程、紀錄、回合按鈕、戰敗與戰利品的面板）抽成共用的元件或組合函式；`NetCombatScreen` 用同一組，只多內海的三塊與內海皮。引擎開了內海的戰鬥時 `App.vue` 換到 `/netcombat`（看 `battle.mode` 對到的戰場 `layer`，不看網址參數）；`/demo/net` 的轉址留著。
2. **換字**：遮蔽的名字與「遮蔽」這個字讀戰場的資料；卡片上只有感載一條（沒有生命的單位不畫生命）；RAM 用分格；圓環照引擎給的行動排（內環攻擊與近戰、中環回填、換構裝、腳本、外環換位、打牆、監視、釘住），鍵位 1～9 照圓環的順序。
3. **同步檔位**：四檔一排，現在的那一檔亮；開不了的灰掉、原因是引擎的句子；這一回合換過了就整排灰掉。每張我方的卡片上標檔位。
4. **追蹤度條**：有追蹤度的場地才顯示；刻度在 30、60、90；被定位時顯示還剩幾輪；每次變動照那一拍的 `trace` 事件跳一下。
5. **管理行動**：有的人才顯示一個面板：七個按鈕各寫 RAM、旁邊寫這一回合還能做幾次；灰掉的帶原因；要選格子或目標的走現有的目標流程。技能清單裡花管理行動的技能同樣標出來。
6. **標記**：閃斷（卡片上一個標，到那個狀態結束）、被釘住、破損的槽、被停用的構裝、標記。
7. **回合按鈕**：結束回合、拔線、投降；拔線與投降長按。這一場在委託副本裡時（`netBattleView` 給的），拔線的提示加一句「全員拔線會回到進副本之前」。
8. **結束**：結果是 `jack_out` 時不是戰敗面板，是一句話與「回去」；戰敗照現有的戰敗面板（多顯示被扣線）。
9. **氣氛**：彈幕照事件標籤放（`lib/liveEvents.ts` 加內海的幾種），不影響任何數字；觀看數先拿掉（直播的容器在 M5）。
10. 圖示：`refill`、`net_swap`、`script`、`hit_wall`、`pin`、`jack_out`、`shift`、`admin`、`hack` 與工具構裝的預設圖示補進 `combatIcons.ts`（沒有圖的先用現有最接近的，列在回報）。

## 驗收條件（`ui/tests/net/M3-ui-netcombat.test.ts`；測試自帶四個化身、三隻假蕾絲、最小的構裝；用引擎真的 `netcombat`）

- 引擎開一場內海戰鬥：畫面換到 `/netcombat`、套內海皮；卡片沒有生命那一條；遮蔽的字是引擎戰場資料裡的。
- 圓環的每一格、花費、灰掉的原因和 `battleOptions` 一樣；數字鍵與空白鍵作用。
- 換檔：點深檔之後引擎的單位是深檔；開不了的那一檔的原因和引擎的句子逐字相同；同一回合第二次點不動。
- 追蹤度條的值和 `netBattleView` 一樣；沒有追蹤度的戰鬥不顯示。
- 管理行動的面板只在有 `admin` 的人輪到時出現；次數用完全部灰掉。
- 把一個單位打到過載：卡片上有閃斷的標。
- 四個人都拔線：顯示撤退的那一句、沒有戰敗面板。
- 掃原始碼：`ui/src` 裡沒有任何檔 import `lib/combat/net`、`NET_ENCOUNTERS`；`lib/combat/net.ts`、`net4.test.ts`、`real.ts` 不存在；`NetCombatScreen.vue` 裡沒有 `d20`、`Math.random`、`applyDifficulty`。
- 現實戰鬥的介面測試原樣全過；`npm test` 與 `vue-tsc` 全過。

## 依賴

M3-deck、M3-netcombat、M3-netcombat-out、M3-netadmin、M3-lace、M3-abilities-net。介面的五張彼此不同時做。

## 完成時回報

改了哪些檔、刪掉的舊程式清單、測試結果、UI 第 5 節裡因為引擎還沒有而沒顯示的東西、還缺圖的圖示鍵。
