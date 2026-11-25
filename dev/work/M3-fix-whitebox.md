# M3-fix-whitebox（cpp-architect，sonnet）

依據：dev/bugs/B025～B029、dev/reports/net-commission-probe-2026-11-25.md、dev/status.md「M3 白箱」段。使用者 2026-11-25 裁決：都照建議。

## 要修
1. **B025**：迷宮館（沒有追蹤度的潛入）擋掉 AI 給的追蹤度，results 或報告附一句提示（例如「這裡沒有追蹤度。」），不記到任何量表。
2. **B026**：開戰時追蹤度已經 100 → 第一輪就開始定位倒數；90～99 開戰照常，在跨過 100 那一輪開始倒數（照現有）。
3. **B027**：`ram_max` 下限只管公式那一行：`max(4, 公式)` 之後才加甲板等加值。
4. **B028**：重創寫回 `net_broken` 時記是哪一件構裝；下一場內海戰鬥帶進來（那件不能用）；修好：登出內海後睡覺（`rest.sleep`）清掉，或在有修理服務的地方付錢修（照 CRAFTING／ITEMS 現有修理價，沒有就用構裝價 10%，寫進規則表）。
5. **B029**：餘韻在戰鬥外每 10 分鐘消一層（CORE_RULES 4.3），掛 `time.passed`，睡覺與短休照舊清。
6. **潛入中換腳本**：放行，和換 SKIN 一致（deck 的 `scriptsBlock` 照 `skinBlock`）。
7. **煙霧彈目標**：現實戰鬥 `features/combat/items.ts` 的道具目標 `'slot'` 可選我方或敵方格子（ITEMS、`it_smoke_1/2`）；netcombat `actions.ts` 腳本的同樣寫法一起改。
8. **報告噪音**：追蹤度升了但沒跨門檻時，不要多發只有「追蹤度 N。」的 `netrun.trace` 報告（併進該步原本的報告的 changes）。

## 規格（文件代理改 docs，你照現況不用動程式）
- 追蹤度範圍 −30～100；連動先減半再比 AI ±20 上限；ENEMIES 內海表補「防火牆 11＋等級」；潛入中可換腳本；煙霧彈雙方格子。

## 驗收
- B025～B029 的 pending 測試移到 `tests/features/`（或併入既有檔）改成正式測試並通過；pending 只剩 B009。bug 報告標「已修」。
- `npx tsc --noEmit` 0 錯、`npm test` 全過、`npm run test:smoke` 全過；ui/ 的 `npm test` 全過（改到 ui 用的介面時）。
- 新規則補 invariants.md（第 185 條起）與 ADR 0018「M3 白箱修正」小節。
- 不 commit；回報改了什麼、測試數、做不到的。
