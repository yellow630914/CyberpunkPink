# ui-retreat-time：委託副本撤退之後，城市的時間沒有回到進入入口那一刻

- 發現者：cpp-tester-whitebox
- 嚴重度：錯誤
- 和審查的關係：dev/reviews/2026-11-21-M0.md 的 E6，同一件；這份補上重現資料。
- 規格出處：SERIES 第 6 節（撤退＝生命……城市的時間，全部回到進入入口那一刻的存檔快照）。
- 期望的行為：入口快照在第 14 天 17:20、現金 3700；之後過了 120 分鐘、花了 100 現金；撤退之後時間回到 17:20、現金回到 3700。
- 實際行為：現金回到 3700（用一筆 +100 的帳補回去），時間停在 19:20；紀錄卻寫「時間回到入口（第 14 天 17:20）」。原因是 M0-ui-engine 把 `day`、`minutes` 從 `serialize` 拿掉，而引擎的時間只能用變更往前走（不變式第 7 條），`hydrate` 沒有辦法把它倒回去。
- 重現：`ui/tests/fixtures/repro/ui-retreat-time.json`；會失敗的測試：`ui/tests/pending/M0-ui-engine-bugs.test.ts`。
- 可能的位置（推測）：`ui/src/stores/game.ts` 的 `takeSnapshot`、`rollback`。比較可能的修法是快照時一併記下引擎的存檔（`e.save()`），撤退時 `e.load` 再 `hydrate` 舊系統那一份；這樣不用讓時間「倒走」，也不違反不變式第 7 條。要不要這樣做請 cpp-architect 決定（審查 E6 也這樣建議）。

- 狀態：已修（2026-11-21，cpp-ui；測試在 ui/src/stores/repro.test.ts）
