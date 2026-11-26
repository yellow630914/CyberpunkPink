# M5-contract-link

- 交給：cpp-feature（sonnet）　（**第二波**；dev/adr/0020 第十四節 D5 說「M4 做完再開」的那一張，2026-11-26 M4 對帳時開的）
- 目標：把 M4 的契約（主角是持約人那一面）接到 M5 的派工與家園：主角持約的人照契約分帳去派工、可以派去場所工作；住處設成「你的據點」的人算家裡的住戶；工作安排成家務的人做家務不用工錢。
- 規格出處：LEWD_SYSTEM 7.5 節（持約人面板能調的：他的住處、工作的安排、收入怎麼分、要不要出借）；DOWNTIME 4.3 節最後一句（契約人照契約的收入分法與規矩）、7.1 節（住戶＝同居的人＋留宿的名冊成員＋住在這裡的契約人）、7.8 節（契約人那一列與「契約人做家務」那一條）；FIXER 第 7 節開頭（契約人的系統也會用到派工）；dev/adr/0020 文末「M4 對帳」D5、V62；dev/work/M5-away.md（`away.terms`、`venue`）、M5-home-people.md（`home.people`、`home_room`）、M4-contract-holder.md（`Held` 的欄位與面板）。
- 可以改的路徑：`engine/src/features/contract/`（`holder.ts`、`holderView.ts`、`index.ts`、`model.ts`；只加下面列的）、`engine/tests/features/M5-contract-link.test.ts`。
- 可以用的介面：contract 自己的 `heldIn`、`heldOf`、`heldPeople`、`Held`（`home: 'own' | 'base'`、`job?`、`split`、`lent?`）、`adjustBlock`／`adjustDraft`、`homeBlock`、`holderContractView`；掛點 `away.terms`（away 宣告）、`home.people`（home 宣告）——用名字掛，回答的型別在自己這一邊照那兩張工單的格式寫，不 import；條件 `has_home`、`home_room`（先看 `k.conditions.kinds()`）；`k.content`（`staff_job`、`away_job`、`job`：`hasKind` 是真的才查）。
- 不可以做的事：不 import `features/away`、`features/home`、`features/roster`；不改主角是契約人那一面（指令、期限、收入歸屬、宵禁）；不改持約人的事件（`triggerDraft`）與抗命；面板不直接改任何人的參數；不替他自動派工（派是玩家在名冊上做的，away 的入口）；共同的規定見 dev/work/M5-plan.md。

## 要做的

1. **回答 `away.terms`**（`{ state, who }`）：`who` 是主角持約的人時回 `{ owner: 'contract', label: '契約人', fee_share: 他的 split }`（`split` 是「收入他拿幾成」，0～1）；他被借出去而且還沒到期（`lent.until` 大於現在）時多帶 `block`（用 `holder.ts` 現成的那一句：「……現在被借給……了，要等他回來才能再叫他。」）。不是持約的人不回。
2. **回答 `home.people`**（`{ state }`）：每一個 `home === 'base'` 而且沒有被借出去的持約的人回一筆 `{ owner: 'contract', npc, kind: 'contract', job? }`，順序照 `heldPeople`。`job` 只在他的 `Held.job` 是一個 `staff_job` 的 id 時帶（`staff_job` 這種內容沒有人定義就不帶）。
3. **住處設成據點的檢查**（`homeBlock`）：現在只問條件 `has_home`。多問 `home_room { for: 'resident' }`（有人註冊才問）：不成立時擋下，原因：「你的據點住不下了：住戶的上限或床位不夠。」已經住在據點的人改別的欄位時不重複擋。
4. **工作的安排認得 id**（`Held.job`，現在是「一句話或一份工作的 id」）：`holderContractView` 的那一項多回 `job_kind`——寫的字是 `staff_job` 的 id 回 `staff`、是 `job`（打工）的 id 回 `work`、是 `away_job` 的 id 回 `away`、其餘回 `text`（那幾種內容沒有人定義就一律 `text`）。安排成家務（`staff`）而他不住在據點時，`adjustDraft` 的報告多一句提醒（不擋）：「他不住在你的據點，做不了家務。」`adjustBlock` 的規則不變（長度上限照舊）。
5. `index.ts` 檔頭的註解補上這兩個回答與 `home_room`；`heldPeople` 的註解改成「外殼與介面用；功能之間走掛點」。

## 驗收條件（`engine/tests/features/M5-contract-link.test.ts`；測試裝真的 `contract`、`roster`、`bills`、`away`、`home`（那兩個功能這時已經做完），用 M4-smoke 的持約人情境起一個持約的人；自帶一份 `job` 與一筆 `staff_job`（`maid`））

- 派工：持約的人派去打工，過週一之後帳單那一筆收入是全額 ×（1 − `split`）、沒有扣出場費、名字帶「契約人」；`split` 是 0 與 0.2 各一例。名冊上自由的人照舊扣出場費。
- 他可以派去 `venue`（在場所工作）；自由的人不行、原因的句子對。
- 借出去期間派不了（原因是借出的那一句）、家裡的住戶也沒有他；到期之後都回來。
- 住處設成據點：`peopleView` 多一個 `kind: 'contract'` 的住戶、佔一個住戶上限與一張床；據點滿了（上限或床位）時 `adjustBlock` 擋下、原因對；改回 `own` 之後不在；`home` 的狀態裡從頭到尾沒有他（`state.ext.home` 裡找不到他的 id）。
- 工作安排成 `maid` 而且住在據點：舒適 +2、帳單沒有他的工錢、家務上限沒有少一格；不住在據點時不算，調整的報告有那一句提醒；`holderContractView` 的 `job_kind` 四種各一例。
- 解約（`releaseDraft`）之後派工的分帳、住戶、家務都跟著消失。
- 把 `away` 拿掉、把 `home` 拿掉各一次：`contract` 的 M4 測試原樣全過，`homeBlock` 照舊只問 `has_home`。
- 分層檢查：`features/contract` 沒有 import `away`、`home`、`roster`。`npm test`、`npx tsc --noEmit` 全過。

## 依賴

M5-away（`away.terms`）、M5-home-people（`home.people`、`home_room`）。做的時候不要有別的工單在改 `features/contract`。介面那一邊（名冊的派工選單顯示「照契約分帳」、持約人面板連過去）在 M5-ui-away-shop。

## 完成時回報

改了哪些檔、測試結果、`away.terms` 與 `home.people` 的格式夠不夠用（不夠的列出來，不自己改那兩個功能）、「工作的安排」要不要變成每週自動派（設計書沒寫，這一張沒做）、主角是契約人那一面有沒有需要接到派工與家園的（預期：沒有）。
