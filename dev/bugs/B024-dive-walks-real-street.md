# B024：潛入中（身體躺在潛艙店）還走得了現實的街、跨區、買東西
- 發現者：cpp-architect（M3 冒煙：第二波的潛入）
- 嚴重度：錯誤（dev/status.md 的 M3-ui-dive 回報已經列為「審查確認」：潛入中主畫面仍可走格子和做現實的「這裡」）
- 規格出處：CYBERSPACE 第 2 節的表（潛入：「意識整個進去。身體躺著不動」）、2.4 節（潛入的時候，身體是最大的弱點）；dev/adr/0018 第八節（活動 `dive` 進行中只放行網內做得了的事）。
- 實際行為：`features/dive/index.ts` 的 `DIVE_ALLOW` 為了讓內海固定的街區（`net_site` 的 `kind: 'block'`，用 `move` 效果把人放到網內的街區）走得動，放行了 `grid.`、`commit:grid.`、`commit:world.`、`commit:trade.`、`commit:npc.`；但沒有分「腳下是現實的街」還是「網內的街區」。結果：站在塔下的潛艙店潛入之後（`readDive` 有值、活動 `dive` 進行中），人照樣能在現實的街上走：走到東口、走出街區、進閘門，`location` 變成 `tw_gate`，而 `dive.body` 還記著身體在潛艙店。對照：`rest.sleep` 之類的現實行動有被擋（「你的意識在網內，身體躺在潛艙店。先登出。」），只有走路與交易漏了。
  - 重現（最小）：`makeDiveGame()` → `diveIn(game)` → `walkTo(game, 'E2')` 成功（報告 `grid.move`、`world.arrive`）；期望被擋下，原因含「先登出」，人還站在潛艙店。
  - 連帶：潛入中也能買現實的東西：照樣的情境走到市場（`E1`、`F1`），在商行 `checkout` 一個罐頭成功，現金 470 變 461。
- 重現：固定檔 `engine/tests/pending/fixtures/B024-dive-walks-real-street.json`（種子 4、具名情境 `dive`、輸入：潛入、走到 E2；期望丟出含「先登出」的錯誤）；會失敗的測試 `engine/tests/pending/B024-dive-walks-real-street.test.ts`（兩條照預期失敗，登出之後走得動的對照那一條會過）。固定檔放在 `tests/pending/fixtures/`，不放 `tests/fixtures/repro/`：後者每次主套件都重播，會讓主套件變紅。
- 可能的位置（只寫推測，不改）：`engine/src/features/dive/index.ts` 的 `DIVE_ALLOW` 與 `activity.allow`：走格子與交易、對話只在「站的是網內的地圖或街區」時放行（`isNetMapKind(map.kind)` 或街區的 `district` 是網內的區）；要不然在活動的 `allow` 之外多一個「這一步現在放不放行」的函式（活動登錄表目前只有前綴白名單）。修好之後，`DIVE_ALLOW` 那一段的檔頭註解（「世界的移動（網內的街區）、事件、…、交易與對話（內海裡買東西、找人）」）也要跟著改。
