# M2-fix-bugs（cpp-architect，sonnet）

使用者 2026-11-23 裁決：B017 不管（接受，不修）；hostility_floor 照場合分兩列；街頭信譽改規則（下面第 3 項）。

## 要修

1. **bug**（報告在 dev/bugs/，重現在 engine/tests/pending/）：B016、B018、B019、B020、B021、B022、W014、W015。每一條修好後把 pending 測試搬到 tests/features（或對應位置）變成一般測試，bug 報告記處理結果。
   - B022：效果登錄表加「AI 可用」的封閉清單與夾值，照 EVENTS 2.4（`debt`、`bargain`、`bill` 新項目都要夾或不給 AI；內建內容不受影響）。
2. **B017 不修**：bug 報告寫「使用者 2026-11-23 裁決：接受，不修」；pending 測試移除（或改成記錄現況的一般測試，註明是接受的行為）。
3. **hostility_floor**：一般事件（AI）最多 +5、永久；戰敗與契約事件可以 +10 並帶天數（持續若干天後解除）。照 EVENTS 2.4 兩列。
4. **街頭信譽新規則**（0～100、六階門檻 15／35／55／75／90 不變）：
   - 主角的「級」：無名、熟面孔 I；有號 II；搶手 III；頂尖 IV；傳說 V（LIFE 1.3）。
   - 完成委託：同級 +2，評價 S 再 +1；高一級以上 +4（S 也 +1）；比你低級的委託信譽不變（錢與歷練照給）。
   - 失敗 −3，不分等級。
   - 事件等非委託來源的正值：最多加到下一階門檻 −1，不能跨階；負值照扣。
   - 規則表數字放 `fixer_rules`（取代 `rep_done`、`rep_fail`），其他來源的夾值放在信譽寫入的地方（不要每個事件自己判斷）。
5. **介面回報的引擎缺口**：`features/rest` 匯出 `depositOf`、`residencePools`；`features/transit` 匯出 `taxiArrival(k, state, to)`（只做抵達那份草稿）。

## 不做

- 不改 docs/（文件代理同時在改 CORE_RULES、FIXER、EVENTS 等）、不改 ui/。

## 驗收

- tsc 0 錯、npm test 全過、test:smoke 全過、test:pending 只剩 B009。每項有行為測試；新規則寫進 invariants（接著編號）。不 commit，回報中文：改了什麼、ui 要跟著改什麼。
