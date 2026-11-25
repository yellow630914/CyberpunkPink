# B026：追蹤度在 100（上限）時開戰，這一場永遠不會被定位
- 發現者：cpp-tester-boundary
- 嚴重度：錯誤
- 規格出處：CYBERSPACE 6.8 節（到 90：定位。三回合後全隊被強制斷線；這場算戰敗，走「被定位」的事件）；NETRUNNING 第 5 節（90 以上：定位）。使用者 2026-11-24 的裁決（不變式第 182 條）只讓**增援**看「這一場有沒有跨過門檻」，定位沒有這個例外。
- 實際行為：
  - `features/netcombat/out.ts`：開戰的第一輪 `markStarting` 只把 30／60 記成到過，不處理 90；定位的倒數只在 `crossings` 開始，而 `crossings` 只在 `addTrace` 真的改了數字之後才叫。
  - 追蹤度已經是 100（量表與戰場的上限）時，每輪的 +3 經 `addTrace`：`to === from` 直接回傳 0、不叫 `crossings`，倒數永遠不開始，打多少輪都不會被強制斷線。探索中被定位（倒數 3 個探索回合）之後走進一場遭遇，就是這個情況：戰鬥變成躲定位的地方。
  - 從 90～99 開戰的，要等第 2 輪的 +3 才開始倒數（第 5 輪開頭才斷線，比「到 90 就開始數」晚一輪）。這一點規格沒寫清楚「開戰時已經在 90 以上」怎麼算，交 cpp-architect 一起定。
- 重現：`engine/tests/boundary/fixtures/B026-located-at-trace-cap.json`。會失敗的測試：`engine/tests/pending/B026-located-at-trace-cap.test.ts` 的第二條（從 95 開戰的對照那一條會過）。
- 可能的位置（只寫推測，不改）：`engine/src/features/netcombat/out.ts` 的 `markStarting`：開戰時追蹤度已經 ≥ t3 而 `field.located` 還沒有，就開始倒數（記一拍 `located`）；或 `roundStart` 每輪加完之後不論 `addTrace` 有沒有改到數字都叫一次 `crossings`。
