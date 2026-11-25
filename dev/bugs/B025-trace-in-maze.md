# B025：迷宮館（沒有追蹤度的公開場館）裡，AI 給的追蹤度照收
- 發現者：cpp-tester-boundary
- 嚴重度：小問題
- 規格出處：EVENTS 2.4 節效果表 `alert`、`trace` 那一列（追蹤度在委託副本與企業的固定子網裡；±20）；CYBERSPACE 6.8 節（公開的地方——港灣、大街、樂園島——沒有追蹤度；迷宮館在樂園島）；AI_TASKS 2.5 節（不收的那一筆整筆拿掉，報告卡提醒）；不變式第 19 條。
- 實際行為：
  - 潛入、報名迷宮館新手組之後，AI 自己給的 `{ kind: 'trace', amount: 5 }`（自由行動的回報、Agent 的事件）照收：`state.meters.trace` 多了迷宮館那張地圖（`m2: 5`），沒有提醒。整條自由行動的鏈（`chain:free_action` 在 netrun 的放行表裡）走一遍也一樣。
  - 迷宮館的區 `pressure` 是 `none`，netrun 開戰時不給 `field.trace`、畫面也不顯示追蹤度，所以這個數字沒有任何作用，但寫正文收到的 `<results>` 會寫「追蹤度 +5」，玩家看到的結果和實際的規則對不上。
  - 自己去挖的子網、委託的內海面（`pressure: trace`）照常收、照 ±20 夾（`tests/features/M3-net.boundary.test.ts`「AI 給的追蹤度」會過）。
- 重現：`engine/tests/boundary/fixtures/B025-trace-in-maze.json`（`makeDiveGame({ seed: 4 })`、換比賽版構裝、潛入、報名）。會失敗的測試：`engine/tests/pending/B025-trace-in-maze.test.ts`。主套件裡記著現在的行為：`tests/features/M3-net.boundary.test.ts`「迷宮館……現在照收（B025）」，修好之後改成規格的期望。
- 可能的位置（只寫推測，不改）：`engine/src/features/netrun/index.ts` 追蹤度量表的 `accepts`：現在只看「有沒有在網內的一趟裡、鍵是不是這一趟的地圖」，多看一條「這一趟的區 `pressure === 'trace'`」（`runRegion(k, run)`，`close.ts` 與 `fight.ts` 已經這樣判斷），不是的回「這裡沒有追蹤度。」。
