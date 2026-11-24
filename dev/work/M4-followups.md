# M4-followups

- 交給：cpp-feature（sonnet）
- 目標：五個既有功能在 dev/status.md 標了 M4 的待辦，各一小段：戰敗（丙丁戊三組的效果接得上、資料檢查）、名冊（沉溺 100、看穿藏著的沉溺）、帳單（鎖義體、簽契約真的發生）、休息（破損、舒適的接口）、打工（沒有動到 M4-venues 的部分）。
- 規格出處：COMBAT_SYSTEM 8.3 節；dev/work/M2-plan.md 使用者定案裡戰敗事件丙、丁、戊三組那張表；NPC_SYSTEM 10.6 節（「他的沉溺到 100」「主角的沉溺到 100」「藏著沉溺的時候」）；DOWNTIME 5.2 節（付不出來）；FIXER 第 4 節（下坡路）；CYBERSPACE 6.5 節破損「下一次休息拿掉」；EVENTS 2.4 節 `hostility_floor`；dev/adr/0017 M2 修 bug 批第 25 項；dev/status.md 的「defeat 留下的」「roster 沒做的」「bills 沒做的」「M3-netcombat 回報」。
- 可以改的路徑：`engine/src/features/defeat/`、`engine/src/features/roster/`、`engine/src/features/bills/`、`engine/src/features/rest/`、`engine/src/features/director/model.ts`（只加一條內文檢查）、`engine/tests/features/M4-followups.test.ts`。
- 可以用的介面：效果 `cyber_take`、`cyber_install`、`cyber_lock`、`tuning`、`malware`、`contract_sign`、`sink_floor`（都用登錄表查：有人註冊才用）；條件 `sunk`；衍生數值 `sink_shown`；掛點 `scan.person`（讀 `hide`）；`features/bills` 現有的旗標與 `bill.settled`；`features/roster` 的名冊、忠誠、離開；`features/defeat` 的事件格式與 `defeat.gear`；`rest.done`；`makeCheck`。
- 不可以做的事：不寫戰敗事件的內容；`handed_over` 轉雇主、`police` 轉 `arrest`、多段的現金上限、版本比例不在這一張；五個功能之間不互相 import；共同的規定見 dev/work/M4-plan.md。

## 要做的

**戰敗（`features/defeat`）**

1. 丙組（身體被改）、丁組（沉溺與污染）、戊組（契約）的戰敗事件用到的效果現在有人註冊了：寫一組測試資料（每組一件），確認載得進來、接受之後效果真的落下（`tuning` 被強制裝上、`cyber_take` 拿走一件、`malware` 種下、`contract_sign` 簽下去）；存檔規則「戰敗時拿走義體與裝備」關著時，`defeat.gear` 回答 true 的那幾筆被拿掉、其餘照常。對應的功能沒裝時那一筆效果照現有的規則在載入時擋下（不是這一張的事，確認訊息指得出是哪一件）。
2. 資料檢查：戰敗事件裡的 `hostility_floor` 一定要寫 `days`（沒寫的整件擋下並指出來）。`features/director/model.ts` 加同一條內文檢查給範圍是 `contract` 的事件。
3. 內海的 `pinned`、`polluted` 這兩種：事件格式不用改；補一條測試，確認贏的那一方是粉蕾絲而資料寫 `defeat: 'pinned'` 時走到那一件，而且裡面的 `malware` 效果（帶 `pool: 'lace'`）落得下去。

**名冊（`features/roster`）**

4. 他的沉溺到 100（每週結帳那一刻檢查名冊上每個人的 `sink`）：離開名冊，原因記 `sunk`，立旗標 `sunk_away:<npc>`（之後以別的身分出現是內容）。
5. 主角的沉溺到 100：看的是別人看到的沉溺（`sink_shown`，沒有人註冊就看真正的）。每週結帳時每個同住或這一週同行過的人各擲一次看穿（主角有藏的時候才擲）：他的調查或街頭直覺取高的，加親密度每 20 點 +1，對 10 ＋ mod(意志) ＋ 定力 ＋ `hide` × 2（`hide` 問 `scan.person`）。看到的值到 100 的那一週：忠誠 70 以下的人離開（原因 `pc_sunk`）；親密度 80 以上而且他自己沉溺 40 以上的人立旗標 `follows_down:<npc>`；其餘留下。只發生一次（旗標 `pc_sunk_done`）。

**帳單（`features/bills`）**

6. 付不出來的後果（DOWNTIME 5.2 節）現在只有旗標：鎖義體那一段改成發效果 `cyber_lock`（鎖一件最貴的？沒有資料可比，改成「照槽順序第一件非橋的」：不給 `uid`、給 `on: true` 與 `why: 'debt'`，讓 `cyberware` 自己挑）；簽契約那一段改成發效果 `contract_sign`（`holder` 是規則表寫的債主，預設伊甸園；`type: 'debt'`；`debt` 是欠的總額）。兩個效果都查不到時照舊只立旗標。補繳之後解鎖（發 `cyber_lock` 帶 `on: false`、`why: 'debt'`）。

**休息（`features/rest`）**

7. 喘口氣與睡一覺時把角色身上的狀況 `net_broken` 拿掉（M3-netcombat 回報）。
8. 睡在診所的病床（`sleep.treated`）時另外發效果 `treated`（有人註冊才發），讓 `medical` 的狀況一致。

**打工（`features/work`）**

9. 派去打工的人是主角持約的契約人、打工的人是契約人：都不在這一張（M5 的派工、`contract` 的 `report.before`）。這一張只把結算報告的 `action` 與錢的那一筆變更的形狀寫進檔頭的註解（`contract` 靠它認），並補一條測試守著那個形狀。

## 驗收條件（`engine/tests/features/M4-followups.test.ts`；需要的功能在各自的測試裡一起裝，另外各有一條「那個功能沒裝」的對照）

- 戰敗：三組各一件事件接受之後，對應的狀態變了；存檔規則關著時 `cyber_take` 那一筆沒發生、同一件事件裡的錢照扣。`hostility_floor` 沒寫 `days` 的戰敗事件載不進來、訊息指出事件的 id；範圍 `contract` 的事件同一條。
- 名冊：一個沉溺 100 的成員過了週一不在名冊、旗標在。主角真正 100、看到的 80、`hide` 1：固定骰子沒看穿時沒有人離開；看穿的那個人（忠誠 60）離開；主角沒有藏時忠誠 60 的離開、忠誠 80 的留下、親密度 85 而且自己沉溺 45 的有 `follows_down` 旗標。第二週不再發生。
- 帳單：走到鎖義體那一步時假的 `cyber_lock` 被叫到（`why: 'debt'`）；補繳之後被叫到 `on: false`；走到簽契約那一步時假的 `contract_sign` 被叫到、`debt` 是欠的總額；兩個效果都沒註冊時行為和現在一樣（`M2-bills` 的測試不改全過）。
- 休息：帶著 `net_broken` 喘口氣之後沒有了；睡診所的病床時假的 `treated` 效果被叫到。
- 打工：結算報告的形狀那一條。
- `npm test`、`npx tsc --noEmit`、分層檢查全過。

## 依賴

M4-cyber-lock、M4-sink、M4-contract、M4-malware、M4-tuning、M4-medical。和 M4-venues、M4-sink 不要同時做。

## 完成時回報

改了哪些檔、測試結果、帳單的債主是誰寫在哪個規則、名冊「這一週同行過」怎麼判斷、戰敗三組裡還表達不出來的效果（預期：怪癖、容量減半、`unbridged` 把橋拿掉）。
