# B010：同一個目標，物件鍵的順序不同就被當成「這個目標不能選」
- 發現者：cpp-tester-whitebox
- 嚴重度：小問題（介面現在照 `targets` 列的原樣送回，順序一樣，所以走不到；從存檔、JSON、別的程式組目標時會被擋）
- 規格出處：dev/invariants.md 第 46 條（`battleOptions` 列出每個目標、選不了的帶原因；列出來可以選的目標一步就送得出去）；`BattleTarget` 是聯集型別（`engine/src/core/types/battle.ts`），物件的鍵沒有順序。
- 實際行為：`sameTarget`（`engine/src/core/battle/field.ts`）用 `JSON.stringify` 比對：`{ side: 'ally', slot: 2 }` 與 `{ slot: 2, side: 'ally' }` 不相等。`battleAct`（`step.ts`）、AI 的 `usable`（`ai.ts`）、`pickApplies`／`pickProblems`（`registry.ts`）都用它。
- 重現：開一場一般遭遇，輪到 a1 時 `game.battleAct({ action: 'move', target: { slot: 2, side: 'ally' } })` 回 `refused`、`reasons: ['這個目標不能選。']`；把鍵順序換成 `{ side: 'ally', slot: 2 }` 就成功。
  會失敗的測試：`engine/tests/pending/B010-same-target-key-order.test.ts`（兩個失敗、一個對照會過）。
- 可能的位置（只寫推測，不改）：`sameTarget` 改成逐鍵比對（四種目標只有 unit、side＋slot、overlay、node 幾個鍵）。
