# M3-fix-ui（cpp-ui，sonnet）

依據：dev/reviews/2026-11-24-M3-ui.md（介面審查）；之後再加 M3-fix-review 回報裡 ui 要跟著改的項目。

## 要修

- P1（必修）：內海戰鬥結束後照引擎狀態決定回哪頁（行程還在回 /subnet；行程沒了、副本還在或手上有委託回 /commission；其餘主畫面）；補全員拔線、接受戰敗、回到階段開始的流程測試（真的點，不掃原始碼）。
- S1：等戰敗三選一時 NetCombatScreen 藏「← 主畫面」。
- S2：「回到去處」換完頁再開對話框。
- S3：runMemo、lastEnd、netStageMemo 在讀檔、回退、開新局時清掉並核對行程 id；補測試。
- S4：潛入中內海分頁的 SKIN 照引擎 skinBlock，不整頁唯讀。
- A1～A4 與測試缺口（登出確認框真的點、內海分頁唯讀測潛入中、場景換檔測試不要包在 if 裡）。

## 驗收

ui npm test 全過、vue-tsc、npm run build 通過；Playwright 截圖自己看過。不改 engine/，不 commit。
