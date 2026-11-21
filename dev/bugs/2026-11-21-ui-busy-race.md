# ui-busy-race：任務鏈還在跑時又送一次動作，busy 被提早設成 false

- 發現者：cpp-tester-whitebox
- 嚴重度：小問題（畫面在 busy 時會把輸入框與任務鏈列的按鈕停用，正常操作很難連送兩次；但 busy 一旦被錯設成 false，按鈕就重新可以按）
- 規格出處：dev/work/M0-ui-engine.md 第三節的 store 匯出表（`busy`：任務鏈在跑的時候是 true；`act` 被擋下時不讓錯誤跑到元件）。
- 期望的行為：第一條鏈還在跑時，不論第二次呼叫怎麼結束，`busy` 都維持 true，直到第一條鏈結束。
- 實際行為：AI 開（假的服務商）、種子 7、建角之後，先呼叫 `e.act(...)` 不等它，再呼叫一次 `e.act(...)`：第二次被引擎拒絕（`Error: 上一條任務鏈還在跑。`，不是 `ActionBlocked`，所以照原樣丟到元件），`run()` 的 `finally` 把 `busy` 設成 false 並停掉重新整理任務鏈列的計時器；這時第一條鏈還沒跑完。`retryStep`、`useRules`、`reroll` 在鏈跑到一半時呼叫也是同一條路。
- 重現：`ui/tests/fixtures/repro/ui-busy-race.json`；會失敗的測試：`ui/tests/pending/M0-ui-engine-bugs.test.ts`。
- 可能的位置（推測）：`ui/src/stores/engine.ts` 的 `run()`（`busy` 是一個布林，不是計數；`finally` 一律設成 false）。可以在 `busy` 已經是 true 時直接回傳一個狀態（例如 `{ status: 'busy' }`）而不呼叫引擎。

- 狀態：已修（2026-11-21，cpp-ui；測試在 ui/src/stores/repro.test.ts）
