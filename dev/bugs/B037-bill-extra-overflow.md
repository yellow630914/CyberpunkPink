# B037：新的帳單項目金額接近安全整數的上限：關著時照收、之後的欠款累加溢位；AI 的那條路整筆拿掉
- 發現者：cpp-tester-boundary（AI_TASKS 2.5 的邊界，「最大組合」那一格）
- 嚴重度：小問題（要玩家把夾值關掉、明說要一筆天價的保護費；AI 那一條要 AI 交出安全整數上限的金額）
- 規格出處：EVENTS 2.4 節「格式的底線，夾值關著也照擋：數值要是正常範圍的整數（不能大到溢位、不能是無限或非數）」；dev/invariants.md 第 36 條（數量是安全整數，「套用之後的值也是」）；bills 自己的規則（`features/bills/index.ts` 的 `budget` 註解、dev/adr/0017 第 17 項：一期都付不起的把金額縮成上限、只收一期）。
- 實際行為：
  - 設定關著、`asked` 對得上：`{ kind: 'bill', name: '保護費', amount: 9007199254740991, weeks: 3, pay: 'cred' }` 照收（金額本身是安全整數）。第一個週一付不出來，欠款 `bills.arrears` = 9007199254740991；第二個週一再累加，變成 18014398509481982，不是安全整數。`observed` 沒有報違規，存讀檔也照過，所以這個值會一直留在存檔裡。
  - AI 的那條路同一個金額、520 週：預算的合計（金額 × 週數 ≈ 4.68e18）先溢位，往回扣的算術失真，結果整筆拿掉（提醒「這一筆沒有算」、`from` 是 4683743612465315000），不是照 bills 的規則縮成 120、只收一期。
- 重現：`engine/tests/pending/fixtures/B037-bill-extra-overflow.json`；會失敗的測試：`engine/tests/pending/B037-bill-extra-overflow.test.ts`（兩條）。
- 可能的位置（只寫推測，不改）：`features/bills/index.ts` 的 `bill` 效果：`validate` 可以多擋「金額 × 週數不是安全整數」（格式的底線，四條路都擋），或 `budget` 的 `amount` 先夾在安全範圍；每週結算累加欠款的地方（`features/bills/settle.ts` 一類）沒有檢查加完還是安全整數。哪一種是對的修法由 cpp-architect 決定（底線擋在入口最省事）。
- 狀態：待修。
