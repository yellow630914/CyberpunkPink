# M2-enemy-encounter

- 交給：cpp-feature（sonnet）
- 目標：讓別的功能只說「這個勢力、這一級、這個位階」就拿得到一個敵人；一場遭遇可以替某個敵人多掛附屬單位（詞條「獵犬」）；打贏之後的俘虜。
- 規格出處：ENEMIES 1.6 節（各勢力出現在哪幾級）、第 13 節（遭遇怎麼組）、第 10 節「跟著主人寫在主人的條目裡」那一列、6.1 節（俘虜：條件、機率、不能俘虜的、之後、篩選關掉時的三選一）；COMMISSIONS 第 9 節（詞條）；dev/adr/0013 D5、0016 第四、五節與 G13。
- 可以改的路徑：`engine/src/features/enemies/`（新增 `pick.ts`、`capture.ts`）、`tools/data_enemies_gen.py`（只加：名冊裡跟著主人的附屬單位轉成 `attached`；不重跑、不改 `engine/data`）、`engine/tests/features/M2-enemy-encounter.test.ts`。
- 可以用的介面：`k.battle.unitSource`、`k.battle.onEnd`、`activity.end`、報告的 `launch`（開一件內嵌的事件）、`deriveRng`、`meterOf`、`state.rules.contentOff`、`k.effects`。
- 不可以做的事：不改現有的 `enemy` 來源對沒寫新欄位的資料的行為（M1 的敵人測試原樣全過）；帶走之後的成人場景不在這裡做（只發 `launch`）；共同的規定見 dev/work/M2-plan.md。

## 新的格式與鍵

- 來源 `enemy_pick`：`{ from: 'enemy_pick', faction, grade, rank, seed?, attached? }`。從那個勢力、等級範圍含這一級（沒有就照最近的一級，D5）、這個位階的兵種裡挑一個；亂數是 `deriveRng(state.rng, 'enemy_pick/<seed>')`，同一個 `seed` 永遠同一個。挑不到丟錯並寫出三個條件。
- `enemy` 與 `enemy_pick` 的 `UnitRef` 可以寫 `attached: [{ enemy, count?, slot? }]`：蓋掉兵種自己的附屬單位（寫空陣列就是不帶）。
- 敵人資料多一個選填的 `capture: false`（不能俘虜：非人形的機器、吉祥物、溺感者）；`humanoid: true` 的機器改成被電磁打到停機時制伏也算。
- 狀態 `state.ext.capture`（這一場可以帶走的人）。報告：`capture.offer`、`capture.done`。

## 要做的

1. `enemy_pick`，以及載入之後的檢查函式 `pickProblems(k, { faction, grade, rank })`（給生成委託的功能在生成時先問，免得開打才發現挑不到）。
2. `attached` 的覆寫：開打時照 `UnitRef` 寫的掛，沒寫照兵種的。
3. **俘虜**（只在打贏時）：符合條件的是「感載滿了、失去回合時被制伏」的敵人；每人擲一次（雜兵 40%、精英 25%、首領 10%，主角的誘惑每級 +3%）；一場最多一個，好幾個成功時全列出來讓玩家挑。
4. 有人可以帶走時，戰鬥結束的那一份帶 `launch`：一件內嵌的事件，選項是帶走（只在「對象非自願」沒被關掉、而且有人登記 `scene` 時列；選了就由事件的 `adult_scene` 開場景，性質是俘虜、主動權的加成由場景那邊照性質算）、問話（威嚇或交涉對 10 ＋ 等級 × 2，精英 +2、首領 +4）、交出去、放走。敵對值的加減照 6.1 節的表。問話成功的收穫先記成旗標與一行結果（接到委託的未知清單是 M2-fixer 的效果 `scout_reveal`，有人註冊才給）。
5. 轉換腳本：名冊裡「跟著主人」的無人機、獵犬、飛劍、攝影機寫成主人的 `attached`；詞條 `hounds` 對到哪個兵種列在腳本的註解裡。只改腳本，不產生資料。

## 驗收條件

- 同一個 `seed` 挑到同一個兵種；等級範圍不含這一級時挑最近的；沒有符合的勢力時錯誤訊息寫出勢力、等級、位階。
- `attached` 覆寫：寫兩隻獵犬就掛兩台、主人倒下後自律（照 M1b 的行為）；寫空陣列不掛。
- 被生命打倒的、投降的不擲；感載滿了被制伏的才擲；固定骰面下雜兵 40% 的兩邊各驗一次；誘惑 3 級多 9%。
- 兩個人都擲中：事件裡兩個都列、只能帶走一個。
- `capture: false` 的不擲；戰敗與脫離不擲。
- 「對象非自願」關掉：沒有帶走的選項，其餘三個都在。
- 問話成功與失敗、交出去、放走各自的敵對值變化對得上表。
- 俘虜的事件做完之後 `state.ext.capture` 清掉；同一個種子結果一樣。
- M1 的敵人、掉落測試原樣全過。

## 依賴

`enemy_pick` 與 `attached` 只靠現有的敵人功能；俘虜要 M2-event-run。M2-commission-run、M2-commission-gen 要 `enemy_pick`。

## 完成時回報

改了哪些檔、測試結果、ENEMIES 6.1 節裡沒做的（預期：帶走之後的場景本身、交給委託人的報酬 +10%、放走之後再遇到他）。
