# B040：拍賣離場那一段時間，契約指令的期限沒有暫停
- 發現者：cpp-tester-whitebox（M4 探針「契約人的一週」，dev/reports/contract-week-probe-2026-11-26.md）
- 嚴重度：小問題（只影響在拍賣裡待著的那幾個小時；但拍賣離場一次就推 3～4 小時，24 小時期限的差事會被吃掉六分之一）
- 規格出處：EVENTS 4.5 節「期限暫停：主角處於任何獨佔的活動時（委託副本、潛入、簾後館一趟、網內行程、拍賣、成人場景）所有契約指令的期限暫停，活動結束才接著算」；LEWD_SYSTEM 6.2 節（離場把時間推到時段結束）、7.4 節。
- 實際行為：照做中的差事（期限 7800）。19:10 進場（時間 5470）、離場那一份報告（auction.leave）把時間推到 23:00（5700，經過 230 分鐘）。離場之後差事的期限還是 7800，沒有往後挪 230 分鐘。
- 成因（推測）：`features/contract/time.ts` 的 `mineDrafts` 用「time.passed 發生當下的狀態」判斷在不在獨佔活動裡（`paused = inActivity(k, state)`）。離場那一份報告同時結束活動、推進時間，掛點看到的是離場之後的狀態（沒有活動），所以不暫停。進場那一份報告沒有推進時間，所以沒事。其他「結束活動的同一份報告推進時間」的路徑也可能一樣：成人場景的結算不花分鐘（探針測到 0 分鐘），委託副本、簾後館一趟的結算沒有逐一驗。
- 重現：`engine/tests/pending/fixtures/B040-auction-leave-not-paused.json`；會失敗的測試：`engine/tests/pending/B040-auction-leave-not-paused.test.ts`（預期位移 230，實際 0）。探針腳本 `engine/tests/probe/contract.probe.test.ts` 的「拍賣」那一段也記了同一個數字（記在「已開 bug 的不一致」）。
- 可能的位置（只寫推測，不改）：`mineDrafts` 的暫停判斷要看「這一段時間裡」有沒有在活動裡：例如 `report.before`（時間推進之前，活動還在）先記下「這份報告開始時在不在活動裡」，或 time.passed 的 payload 帶 `from` 那一刻的活動；或讓離場的報告在 `activity.end` 的掛點裡替指令補挪。
- 狀態：待修。
