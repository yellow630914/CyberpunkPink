# ui-legacy-money-in-save：假存檔還放著帳戶與現金，讀檔時蓋過引擎的錢；值不合法時讀檔只做一半並丟例外

- 發現者：cpp-tester-whitebox
- 嚴重度：錯誤
- 和審查的關係：dev/reviews/2026-11-21-M0.md 的 E7，同一件；這份補上兩份重現資料。
- 規格出處：dev/work/M0-ui-engine.md 第五節第 3 步（引擎的那幾樣——時間、錢、紀錄——不再放進假存檔）；dev/invariants.md 第 6 條（讀不進來的存檔不改變現在的狀態）。
- 期望的行為：`g.serialize().money` 只有 `fav`；讀檔時錢一律以引擎存檔為準；任何一份讀不進來就回傳錯誤訊息、兩邊狀態都不變，不丟例外。
- 實際行為：
  1. `g.serialize().money` 是 `{ acc, cash, fav }`。把 legacy 的 `acc` 改成 99999 再讀：`loadRaw` 回傳 null，引擎的帳戶變成 99999，多一份 `ui.money` 報告（引擎存檔的驗證被繞過），讀檔後 `canUndo` 是 true。
  2. 把 legacy 的 `acc` 改成 −1（或字串）再讀：`e.load` 已經把引擎換成存檔的狀態（時間從 18:20 回到 17:20），接著 `g.hydrate` 經過錢的 setter 提交 −4621 的帳，引擎拒絕並丟 `ChangeError`；`loadRaw` 把例外丟到元件，舊系統只換了一半。
- 重現：`ui/tests/fixtures/repro/ui-legacy-money-in-save.json`、`ui/tests/fixtures/repro/ui-load-not-atomic.json`；會失敗的測試：`ui/tests/pending/M0-ui-engine-bugs.test.ts`。
- 可能的位置（推測）：`ui/src/stores/game.ts` 的 `serialize`（`money: { ...money }` 帶到 getter 的值）與 `hydrate`（`Object.assign(money, d.money)` 觸發 setter）；`ui/src/stores/saves.ts` 的 `loadRaw`（先 `e.load` 再 `g.hydrate`，中間沒有退路）。

- 狀態：已修（2026-11-21，cpp-ui；測試在 ui/src/stores/repro.test.ts）
