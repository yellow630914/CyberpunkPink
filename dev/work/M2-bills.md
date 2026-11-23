# M2-bills

- 交給：cpp-feature（sonnet）
- 目標：新功能 `bills`：每週帳單。每週一 06:00 收入先入帳、再照順序扣款；付不出來的累計欠繳週數、走下坡；別的功能用兩個掛點把自己的項目接進來。
- 規格出處：FIXER 第 4 節；DOWNTIME 第 5 節（5.1 順序與那張表、5.2 付不出來、5.3 只做倍率）；EVENTS 2.4 節的 `bill`、`grace` 兩列與 2.2 節「帳單有沒有欠」；BALANCE 7.4 節（帳單倍率和難度無關）；UI 3.10 節；dev/adr/0016 第六、七節與 G3。
- 可以改的路徑：`engine/src/features/bills/`（新）、`engine/src/features/roster/`（只加：把薪水接上這兩個掛點、沒付成時忠誠 −8）、`engine/src/features/index.ts`、`engine/tests/features/M2-bills.test.ts`。
- 可以用的介面：`k.hooks.on('time.passed')`（順序 10）、`crossings`、`k.activity.active`（人在副本裡）、`state.rules.billMult`、核心的 `cred`、`cash` 變更、`k.effects.register`、`k.conditions.register`、報告的 `triggers`。
- 不可以做的事：每一個項目本身是誰的就由誰算（房租在 M2-rest-housing、義體訂閱與抑制劑在 M4）；鎖義體、簽契約只留觸發點與旗標；四個快捷的檔位不做（只有倍率）；共同的規定見 dev/work/M2-plan.md。

## 新的格式與鍵

- 掛點 `bill.collect`（這個功能宣告）：`[{ state, week }, BillLine[] | void]`；`BillLine` 是 `{ id, owner, name, kind: 'income' | 'due', amount, order: 1～10（照 5.1 節那張表的序號）, pay: 'cred' | 'cash' | 'either' }`。
- 掛點 `bill.settled`：`[{ state, week, lines: Array<BillLine & { paid: number; unpaid: number; skipped?: true }> }, Change[] | void]`。
- 狀態 `state.ext.bills`：欠繳週數、每個項目玩家設的「用現金付」「這一項不付了」、事件加的臨時項目與寬限、債（本金、週利率、付哪一種錢）、到期還沒結的那一週。
- 效果 `bill`（`{ kind, item, amount }`：這一週那一項加減，不超過那一項的一半；或 `{ kind, name, amount, weeks, pay }`：加一個新的項目）、`grace`（`{ kind, item, days }`，最多 7 天）、`debt`（`{ kind, to, amount, rate }`）。條件 `bill_overdue`（`{ min }`）。
- 報告：`bill.settle`（kind `downtime`，每一項付了多少、欠多少）、`bill.notice`（週日晚上的提醒，不擋）、`bill.set`（玩家改設定）。

## 要做的

1. 結算（每跨過一個週一 06:00 一次；一次跨好幾週就一週一週結）：問 `bill.collect` → 金額乘帳單倍率（收入不乘）→ 收入先入帳 → 照 `order` 扣款，錢不夠就停在那一項，後面的都算沒付 → `bill.settled` 回傳的變更併進這一份。倍率 0 時只入帳收入。
2. 每一項從哪裡扣：`cred` 扣帳戶、`cash` 扣現金、`either` 預設帳戶，玩家設了用現金就扣現金。玩家主動停掉的項目不付也不算欠。
3. 欠繳週數：有沒付的項目就 +1，付清歸零。那一份報告帶觸發點 `weekly`（`where: { overdue }`）；第 3 週把所有欠款併成一筆債（債主是規則裡寫的那個勢力，那個勢力的敵對值 +10）；第 1、2、4 週只留旗標與觸發點給事件與之後的功能接。
4. 債的利息是一個 `order` 5 的項目。寬限期間那一項不算欠。
5. 人在副本裡時（G3）：這一週先記成到期，出來之後的下一次 `time.passed` 才結。
6. `billPreview(k, state)`：下一次要付的每一項、帳戶夠不夠、差多少、會停在哪一項、現在在下坡的哪一格。週日 20:00 出一份 `bill.notice`。
7. 名冊的接法：`bill.collect` 回 `weeklyPay` 的每一筆（`order` 8、付現金）；`bill.settled` 裡沒付成的人忠誠 −8。

## 驗收條件（項目用測試自己掛在 `bill.collect` 上的）

- 跨過週一 06:00 結一次；同一週再過時間不重複；一次睡過兩個週一結兩次、兩份報告。
- 收入 200、三項各 150、帳戶 250：先變 450，付前兩項，第三項沒付，欠繳週數是 1；`bill.settled` 收到三筆各自付了多少。
- 倍率 0.5：應付的減半、收入不變；倍率 0：只有收入。
- `either` 的項目設成用現金之後扣的是現金；停掉的項目不扣、不算欠。
- 連三週沒付清：第三週多了一筆債、那個勢力敵對值 +10；之後每週有利息這一項；付清之後欠繳歸零。
- 效果 `bill` 把某一項加到超過一半時被夾；新的項目照週數出現幾週就沒了；`grace` 的那一項這週不算欠。
- 有 `commission` 的替身活動進行時跨過週一：不結；活動結束後過一分鐘就結。
- `billPreview` 的數字和實際結算一樣。
- 名冊的薪水沒付成：那個人忠誠 −8；付了不變。
- 同一個種子、中途存檔讀檔，結果一樣。

## 依賴

M2-core-shell（`crossings`）、M2-roster（接薪水）。M2-rest-housing 的房租接在後面。

## 完成時回報

改了哪些檔、測試結果、DOWNTIME 第 5 節裡沒做的（預期：四個檔位、鎖義體與換門鎖的後果、帳戶被凍結、洗錢補差額）。
