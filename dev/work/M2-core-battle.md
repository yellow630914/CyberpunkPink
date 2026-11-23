# M2-core-battle

- 交給：cpp-architect 角色（sonnet；**改的是核心**，可以改 `engine/src/core/battle/` 與 `engine/src/core/types/battle.ts`）
- 目標：照 dev/adr/0016 第五節，讓戰鬥裡叫得到「候補的人」（名冊的增援）、開戰設定可以給一方先攻的優勢、`battleOptions` 給出到每個敵人的距離。
- 規格出處：dev/adr/0016 第五節與 G7；dev/adr/0013 C6（補位怎麼進場）；SKILL_TREES 掮客「增援」那一列（只為了對照）；COMBAT_SYSTEM 第 2 節（距離怎麼算）。
- 可以改的路徑：`engine/src/core/battle/`、`engine/src/core/types/battle.ts`、`engine/tests/core/`、dev/invariants.md。
- 不可以做的事：不寫名冊、不寫技能的效果（那是 M2-roster、M2-abilities-m2）；不改現有的補位與先攻的行為；共同的規定見 dev/work/M2-plan.md。

## 新的型別與鍵

- `k.battle.bench(owner, fn)`：`fn(state, battle, side)` 回傳 `BenchEntry[]`（`{ id, ref: UnitRef, name, blocks: string[] }`）。`BattleView.bench(side)` 把每個來源的合起來（同一個 `id` 只留第一筆；已經在這一場裡的人不列）。
- `run.callIn(side, ref, opts?)`：回傳進場的單位，或 `null`。
- `BattleSetup.edge?: 'ally' | 'foe'`。
- `BattleOptions.distances: Record<string, number>`（輪到的人到場上每個敵人、每一台掛著的東西的距離）。
- `BATTLE_EVENTS` 加 `call_in`。

## 要做的

1. `callIn`：照開戰時同一條路把 `ref` 解成單位（來源查不到丟錯）；那一方現在沒有空格就回傳 `null`、什麼都不動；有空格就排進後方的最前面，記一拍 `call_in`，**下一輪開頭**（`round.start` 之前）補進最後面的空格，先攻當場擲、行動點從上限開始（照 C6）。到時候空格被別人佔了，就留在後方照平常的補位等。
2. `edge`：那一方每個人的先攻擲兩次取高；紀錄裡看得到兩顆骰。沒寫就是現在的行為。
3. `distances`：用核心現有的距離算法，不另寫一份；`battleOptions` 每次都帶。
4. 型別的註解裡寫明 `origin.ext` 的慣用鍵（`by`、`commission`、`stage`、`face`、`pre`、`defeat_event`；0016 第五節），不加程式。

## 驗收條件（`engine/tests/core/battle-m2.test.ts`；用 testkit 的情境與 `TEST_COMBAT`，候補用測試裡臨時註冊的來源）

- 沒有人註冊候補時 `bench` 是空的；註冊兩個來源時合在一起，已經在場上的人不列。
- 我方三個人時 `callIn`：這一輪他不在場上，下一輪開頭站在第 4 格、行動點是上限、排進先攻的順序；紀錄有 `call_in` 與進場的那一拍。
- 我方四格都有人時 `callIn` 回傳 `null`，戰鬥狀態與提交之前一樣。
- 叫了之後、進場之前有人倒下又被救回來把空格佔掉：他留在後方，之後有人倒下時照補位進場。
- `edge: 'foe'`：固定骰面之下，敵方的先攻是兩顆裡大的那一顆；我方不變。
- `distances` 的每一個數字和直接呼叫核心的距離函式一樣；掛著的東西也有。
- 帶著「叫了還沒進場的人」的戰鬥存了再讀，接著打的結果和沒有中斷的一樣；`battleProblems` 不把他當成壞資料。
- `npm test`、`npx tsc --noEmit`、分層檢查全過。

## 依賴

M2-core-activity 做完之後隨時可以做（和 M2-core-shell 不衝突）。做完才能開 M2-roster、M2-abilities-m2。

## 完成時回報

改了哪些檔、測試結果、ADR 做不到的地方。
