# M4-craft-salvage

- 交給：cpp-feature（sonnet）
- 目標：組裝的另一半：拆解、換零件（背包裡的那一件）、完整拆解之後畫出設計圖；戰後從敵人身上拆義體與零件（「解剖」的現實面）。
- 規格出處：CRAFTING 第 10.3、10.4 節，第 11 節第一條；ENEMIES 第 7 節（掉落）與第 15 節裡義體的那幾條；SKILL_TREES 改造師的「解剖」（日常那一段的現實面）；LIFE 第 9 節行規裡「拆死人的、拆活人的」那一條；dev/adr/0019 第四節。
- 可以改的路徑：`engine/src/features/craft/`、`engine/src/features/enemies/`（`loot.ts` 與存「這一場倒下的人」的那一小段）、`engine/tests/features/M4-craft-salvage.test.ts`。
- 可以用的介面：M4-craft 的 `known`、`makers`、規則表；核心的 `productOf`、`slotProblems`、`readProduct`；`makeCheck`、`deriveRng`；條件 `ability`（`daily: 'dissect'`）、`at_home`、`at_facility`；效果 `sink`、量表 `hostility` 的效果（查不到就略過）；`features/enemies/loot.ts` 現有的掉落表與 `needs: 'dissect'`（M3-lace 加的，內海用）；`k.battle.onEnd`。
- 不可以做的事：`craft` 與 `enemies` 不互相 import；身上義體的換零件是 `cyberware` 的小手術（M4-cyber-lock 做了）；內海的解剖不動；不做收贓與鑑定；共同的規定見 dev/work/M4-plan.md。

## 新的格式與鍵

- 規則 `craft_rule` 多：`salvage_base`（0.7：一個零件完好拆下來的機率）、`salvage_per_skill`（0.05）、`salvage_max`（0.95）、`salvage_minutes`（60）。
- 拆下來的零件是背包裡帶 `data: { state: 'used' }` 的一疊（和全新的分開放）。內嵌的零件（未登錄零件，0019 第十七節）拆下來、換下來時用核心的 `partStack` 整筆放回背包，不改它的內容（M4-plan 規定 10）。
- 敵人資料的掉落多收 `needs: 'dissect'` 的義體項目：`{ blueprint, parts?, chance, needs: 'dissect' }`（零件沒寫用 `stock`）。
- `state.ext.enemies_dissect`：`{ battle, until, targets: Array<{ key, name, faction?, human: boolean, loot: 掉落項目 }>, done?: true }`：最近一場打贏的現實戰鬥裡倒下、可以拆的人；一小時內有效。
- 報告：`craft.salvage`、`craft.swap`、`enemies.dissect`。匯出（craft）：`salvagePreview`、`salvageBlock`／`salvageDraft(k, state, { uid, by })`、`swapBlock`／`swapDraft(k, state, { uid, type, part, by })`；（enemies）：`dissectOptions(k, state)`、`dissectDraft(k, state, { target, by })`。

## 要做的

1. 拆解（背包裡的一件成品）：要在住處（`level_min` 2）或帶 `craft` 的設施；有 `lock` 的擋下（「有授權鎖的東西要先解鎖。」）。每個零件各擲一次：機率是 `salvage_base` ＋做的人那一項基本功（義體用義體學、其餘用機械）× `salvage_per_skill`，最多 `salvage_max`。完好的回背包（`state: 'used'`）；沒過的報廢。生體的零件一律報廢（「拆了就死」）。成品那一疊拿掉；時間加 `salvage_minutes`。
2. 畫設計圖：一件成品的零件**全部**完好拆下來，而且還不會做那張設計圖時，學會它（`known` 多一筆，結果的句子寫明）。
3. 換零件：背包裡的成品換掉一個零件。槽的檢查用 `slotProblems`；擲一次組裝的檢定（難度照換完之後的那一件，算法是 M4-craft 的同一個函式）；成功照換；失敗照換但多一筆瑕疵；大失敗新的零件燒掉、舊的留在原位。換下來的零件回背包（`state: 'used'`）。武器與護甲在住處的工作台或店家；店家換一定成功、收工錢（設計圖等級 ×100 的一半，暫定）。
4. 戰後的解剖（`enemies`）：一場現實的戰鬥打贏時（`onEnd`），把倒下、被制伏的敵人裡資料有 `needs: 'dissect'` 掉落的記進 `enemies_dissect`（蓋掉上一場的）。`dissectOptions` 列出來；`dissectDraft` 一場只能做一次、要在一小時內、`by` 要通過條件 `ability`（`daily: 'dissect'`；沒有人註冊這個條件時一律不能做）。做了：照那個敵人的項目各擲機率，擲到的給一疊義體成品（`state: 'used'`）；時間加 60 分鐘。對象是人（不是機器）時：做的人沉溺 +1（走 `sink` 效果）、那個勢力的敵對值 +5（有量表才加）。
5. 內海那一邊（M3 的自動擲）不動；這一張只確保兩邊的 `needs: 'dissect'` 不會互相誤觸（現實的不在戰鬥結束時自動擲）。

## 驗收條件（`engine/tests/features/M4-craft-salvage.test.ts`；沿用 M4-craft 測試的設計圖與零件；敵人用測試自己的兩筆：一個人形帶一條義臂、一台機器帶一個零件）

- 拆一把三個零件的槍：骰子固定成全過時背包多三疊 `used` 的零件、成品沒有了、學會那張設計圖；固定成一個沒過時少一疊而且沒有學會。帶生體零件的那一件，生體的不會回來。有 `lock` 的被擋。
- 換零件：成功之後 `productOf` 的 `stats` 變了、舊零件在背包；類型不對被擋；大失敗新零件沒了、成品沒變。
- 內嵌的零件：一把槍的槍管是一筆 `InlinePart`（測試自己組）——拆解完好時背包多一疊 `UNREG_STACK_ID`、`stackPart` 讀回來逐欄相同；換零件把它換下來也一樣；拿背包裡一疊內嵌的零件換上去，成品的 `parts` 裡是那一整筆。
- 解剖：打贏之後 `dissectOptions` 列出兩個對象；沒有人註冊 `ability` 時 `dissectDraft` 被擋；註冊之後拆人形的那一個：背包多一條 `used` 的義臂、沉溺 +1、假量表 +5、時間 +60 分鐘；同一場第二次被擋；過了一小時被擋。拆機器的不加沉溺。打輸的那一場沒有對象。
- 內海戰鬥打贏照舊自動擲（抽 `M3-lace` 的一條驗一次）。
- `npm test`、`npx tsc --noEmit`、分層檢查全過。

## 依賴

M4-craft。和 M4-enemies-m4 不要同時做。

## 完成時回報

改了哪些檔、測試結果、「失敗的零件降一級」沒有做（零件是內容的一筆，沒有低一級的對應）、二手零件在交易裡還沒有另外的價錢。
