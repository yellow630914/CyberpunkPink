# B041：未登錄零件寫了生體卻沒指定類型，會抽到沒有生體版的類型，交貨永遠丟錯
- 發現者：cpp-tester-boundary（M4 邊界：未登錄零件的框架性質測試 `engine/tests/boundary/M4-unreg-frame.boundary.test.ts`）
- 嚴重度：錯誤（拿到的獎勵領不到；內容（事件、任務）寫 `part_unreg { material: 'bio' }` 不寫 type 是合法的格式）
- 規格出處：CRAFTING 第 11 節（有些類型沒有生體版，`types.<id>.bio: false`）；`features/unreg/frame.ts` 的 `frameOf` 檔頭「沒有生體版的類型給了生體丟 ActionBlocked」。
- 實際行為：效果 `{ kind: 'part_unreg', source: 'gift', material: 'bio', grade: 2 }`（沒有 type）。格式檢查（`paramProblems`→`specProblems`）只在有 type 時查「這個類型有沒有生體版」，所以通過；`frameOf` 先照 `specProblems` 查（那時 type 還是 undefined，不擋），再從所有類型裡用種子抽一個，抽到 `action`（機構）或 `barrel`（槍管）時，產出材質 bio 的框架，這個框架自己的 `frameProblems` 說「機構沒有生體版。」。零件進了等著交貨的佇列，到時間交貨時 ActionBlocked「機構沒有生體版。」，每次交都一樣，零件永遠領不到。
- 重現：`engine/tests/pending/fixtures/B041-unreg-bio-without-type.json`（40 個種子裡有 7 個壞；種子 2 交貨丟錯）；會失敗的測試：`engine/tests/pending/B041-unreg-bio-without-type.test.ts`。邊界測試 `M4-unreg-frame.boundary.test.ts` 因此把「type 沒給、material 給 bio」從性質測試裡排除，另寫了對照。
- 可能的位置（只寫推測，不改）：`features/unreg/frame.ts` 的 `frameOf`：type 沒給又是生體時，只從 `rules.types[id].bio !== false` 的類型裡抽；全部都沒有生體版時才丟 ActionBlocked。順手讓 `paramProblems` 在沒指定 type 時也查一次「至少有一個類型有生體版」。
- 狀態：待修。
