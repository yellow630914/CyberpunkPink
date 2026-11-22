# B013：生體零件沒有帶 scan_proof 的特性就被掃到
- 發現者：cpp-tester-boundary
- 嚴重度：小問題（要確認設計：是程式漏了，還是設計是「生體件的資料自己寫 scan_proof」）
- 規格出處：EQUIPMENT 6.3 節表「生體件（爪、蛛絲、活皮）｜掃不到」；ITEMS 1.1 節「生體件一律自由……掃描不到」；CRAFTING 8.1 節；DATA 7.2 節零件的 `material`（`mech` 或 `bio`）。表上「防掃描特性的零件」與「生體件」是兩列，分開寫。
- 實際行為：`scanFinds`（`engine/src/features/gear/numbers.ts`）每個零件都要有 `traits` 裡的 `scan_proof` 才掃不到，完全不看 `material`。全是 `material: 'bio'` 的爪（沒寫 `scan_proof`）在強度 3 被掃到。
- 重現：種子 7，不擲骰。一把大小 2 的近戰武器，零件是兩個 `bio` 件。期望 `scanFinds(..., 3) = []`，實際 `['c1']`。對照（混了一個機械件，整件掃得到）會過。
  會失敗的測試：`engine/tests/pending/B013-bio-parts-not-scanned.test.ts`（一個失敗、一個對照會過）。
- 可能的位置（只寫推測，不改）：`scanFinds` 的 `parts.every(...)`：條件改成 `p.part.material === 'bio' || p.part.traits?.includes('scan_proof')`。如果決定資料要自己寫特性，就把 EQUIPMENT 6.3 節的表改成「生體件帶 scan_proof」並在 DATA 7.2 節補一條檢查。
- 附帶：同一節的「屏蔽襯裡」（外套選配零件，讓藏在外套裡、大小 ≤ 1／2／3 的東西掃不到）與「義體的藏匿艙 +1、搜身找不到」M1 沒有實作（`dev/work/M1-gear.md` 第六節沒列），不算這一條的 bug，M4 組裝做零件時一併處理。
