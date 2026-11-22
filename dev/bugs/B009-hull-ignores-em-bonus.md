# B009：電磁武器打機體耐久沒有加倍
- 發現者：cpp-tester-whitebox
- 嚴重度：小問題（機甲是 M6，核心現在只有接口，正式內容走不到；但接口的結算和規格已經不一樣，M6 接上來會直接帶著）
- 規格出處：COMBAT_SYSTEM 9.3 節「對付機甲：打機體耐久（電磁加倍，第 5 節）」；第 5 節傷害類型表「電磁……對機器、無人機、機甲傷害加倍」。
- 實際行為：`BattleRun.damage` 的標籤倍率（`type.vs`，電磁對 machine ×2）只看目標「單位」帶的標籤。穿機甲的是機師（人），沒有 machine 標籤，所以傷害先照一般的生命算，再整份被機體吸收，沒有加倍。
- 重現：單位掛一個耐久 100、護甲 0 的機體（`unit.hull`），`run.damage(unit, 10, 'em')`：期望機體耐久少 20，實際少 10；物理 10 點少 10（對照，是對的）。
  會失敗的測試：`engine/tests/pending/B009-hull-em-double.test.ts`（一個失敗、一個對照會過）。
- 可能的位置（只寫推測，不改）：`engine/src/core/battle/run.ts` 的 `damage`：機體在場時（`target.hull`）傷害類型的 `vs` 要照機體算（機體視同 machine），不看機師的標籤；神經傷害對機體無效的那一條（「神經武器對機體無效」）也在同一個地方。
- 狀態：不在 M1 修，留到 M6（機甲與機體耐久搬進來時一起處理）。`engine/tests/pending/B009-hull-em-double.test.ts` 繼續留在 pending。
