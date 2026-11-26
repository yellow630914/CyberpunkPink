# B036：AI 一件事對同一個傾向標籤給幾筆就長幾點
- 發現者：cpp-tester-boundary（AI_TASKS 2.5 的邊界：M2 後段到 M4 的效果）
- 嚴重度：錯誤
- 規格出處：EVENTS 2.4 節的表 `tendency`「一個標籤一點」；表上方「『每件』是一件事加起來：同一件事件（或同一次行動的結算）裡同一種效果的所有筆數合計之後才比上限，拆成幾筆給也一樣」。
- 實際行為：AI（或設定開著時玩家要的）一件事給 `{ kind: 'tendency', tag: 'tg_tw_dom' }` 三筆，那一軸（relation）的點數從 0 變 3；兩筆就是 2。沒有夾值的記號、沒有提醒。內建的照寫的算（不受上限管）是對的。
- 重現：`engine/tests/features/fixtures/B036-tendency-same-tag-stacks.json`；會失敗的測試：`engine/tests/features/B036-tendency-same-tag-stacks.test.ts`（預期 1，實際 3、2）。
- 可能的位置（只寫推測，不改）：`features/lewd/index.ts` 的 `tendency` 效果沒有 `budget`。照 `bridge` 的寫法加一組「每個標籤一組、上限 1」（`group: 'tendency:<tag>'`，`ctx.level === 'cap'` 才算）。
- 規格要問的（不自己裁決）：「一個標籤一點」是「每個標籤各最多一點」，還是「一件事只長一個標籤、一點」？現在一件事給三個不同的標籤，三個都長（各一點）。照前一種讀法這是對的，照後一種要再擋。重現只測同一個標籤。
- 狀態：已修（M4-fix-2，2026-11-26）。照「每個標籤各最多一點」讀（`dev/adr/0019` 補記「M4-fix-2」）：`features/lewd/index.ts` 的 `tendency` 效果加 `budget`，每個標籤一組（`group: tendency:<標籤>`）、上限 1，只有 `ctx.level === 'cap'` 才算；同一個標籤拆成幾筆給也只長一點，多的被夾並有提醒；不同標籤各長各的；內建的照寫的算。要改成「一件事只長一個標籤」再另外裁決。測試：`engine/tests/features/B036-tendency-same-tag-stacks.test.ts`。
