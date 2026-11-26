# B042：簾後館記帳的欠款超過「保證金的兩倍」的上限
- 發現者：cpp-tester-whitebox（M4 探針「簾後館一趟到落幕」，dev/reports/curtain-fall-probe-2026-11-26.md）
- 嚴重度：小問題（要先欠到接近上限又落幕一次；欠款變多、每週利息跟著變多）
- 規格出處：CYBERSPACE 8.8 節「打輸會怎樣」第 4 點：「記帳：欠著，每週 10%，列進每週帳單；欠款上限是保證金的兩倍，欠到上限就不能再報名，直到還清。」
- 實際行為：上限只是報名的閘門（`features/curtain/enter.ts`：欠款 ≥ 上限就擋下報名）。選「記帳」（`fall.ts` 的 `settleDraft`，how: 'tab'）把設備費與違約金（保證金的一半）直接加進欠款，沒有夾、`settleBlock` 也沒有擋。欠 590（上限 600，還能報名）的人再落幕選記帳 150：欠款 740，每週利息 74；`accountView` 同時回報 `owed: 740, cap: 600`。
- 重現：`engine/tests/features/fixtures/B042-curtain-tab-over-cap.json`；會失敗的測試：`engine/tests/features/B042-curtain-tab-over-cap.test.ts`（預期 ≤ 600，實際 740）。
- 規格要問（不自己裁決）：「欠款上限」要怎麼執行？(a) 夾住：記帳最多記到上限，超出的部分當場付（或不收）；(b) 擋下：欠款 + 設備費 > 上限時「記帳」這一條路灰掉，只剩付清與簽檔期；(c) 現況（上限只當報名的閘門）是設計本意，規格改寫成「欠到上限就不能再報名」。測試照字面（欠款不超過上限）寫，選 (c) 時把這條測試改掉。
- 可能的位置（只寫推測，不改）：`features/curtain/fall.ts` 的 `settleBlock`（how: 'tab'）加一條「欠款加設備費超過上限」的原因，或 `settleDraft` 的記帳那一支夾金額。
- 狀態：已修（M4-fix-2，2026-11-26；使用者裁決 1：落幕時記帳會超過欠款上限，「記帳」灰掉，只能付清或簽檔期）。`features/curtain/fall.ts` 的 `settleBlock`（how: 'tab'）：欠款加設備費與違約金超過上限（保證金的兩倍；`accountView` 與 `fallView` 同一個上限）就擋下並寫原因，剛好到上限可以；`pathsOf` 的記帳列 `can: false`。原本的測試（欠款不超過上限）改成新的規則，加了剛好到上限與沒有欠款的對照。測試：`engine/tests/features/B042-curtain-tab-over-cap.test.ts`。
