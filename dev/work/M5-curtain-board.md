# M5-curtain-board

- 交給：cpp-feature（sonnet；引擎的那一半）與 cpp-ui（sonnet；畫面的那一半，引擎做完再派）　（**第三波**；M4 的 P57 留給 M5 的「檔期榜上別隊的模擬與月榜升席」，2026-11-26 M4 對帳時開的）
- 目標：簾後館的檔期榜與月榜：每週結算當週的總打賞、其他隊由模擬補上、前三名拿一份獎金；月榜前三升一個席次。
- 規格出處：CYBERSPACE 8.8 節「檔期榜」那一條（「每週結算當週總打賞，其他隊由模擬補上。前三名拿一份獎金（等於破關獎金）。月榜前三升席次、拿貴賓邀請。」）與席次的表（貴賓席：館方邀請——月榜前三，或贊助人點名）；dev/adr/0019 第十二節與 P57；dev/adr/0020 文末「M4 對帳」V60；`engine/src/features/curtain/model.ts` 檔頭（`week`、`member`）、`member.ts`、`heat.ts`（`tipsRatio`）。
- 可以改的路徑：`engine/src/features/curtain/`（新檔 `board.ts`；`model.ts`、`index.ts`、`view.ts`、`patch.ts` 加欄位與掛鉤）、`engine/tests/features/M5-curtain-board.test.ts`；畫面：`ui/src/dialogs/CurtainDialog.vue`、`ui/src/components/curtain/`（新增一個榜的元件）、`ui/src/stores/engine.ts`（只加轉接）、`ui/tests/curtain/M5-ui-curtain-board.test.ts`。
- 可以用的介面：curtain 自己的 `readCurtain`、`curtainRules`、`curtain.patch`、`week`（`index`、`tips`、`runs`）、`member`（`tier`、`suspended`、`clears`）、`TIER_IDS`、`tipsRatio`；掛鉤 `time.passed`（這個功能已經在聽：簽的檔期的週結）；`weeklyCrossings`；固定亂數（存檔種子＋週次＋隊的編號，不推進游標）；`cash` 變更。
- 不可以做的事：不 import 別的功能；別隊沒有任何內容（只有代號與一個數字）；不改一趟的結算、場熱、打賞的算法；沒有會員證、停權、或那一週一場都沒上的不上榜、不出報告；共同的規定見 dev/work/M5-plan.md。

## 新的格式與鍵

- `curtain_rule` 多 `board`（暫定，V60）：`{ teams: 7（別隊幾隊）, runs: [1, 3]（每隊一週上幾場）, heat: [25, 95]（每一場結算時的場熱落在哪）, top: 3, month_weeks: 4, names: string[]（別隊的代號，預設「甲隊」～「庚隊」） }`。
- 狀態 `state.ext.curtain.board`：`{ weeks: Array<{ index, tier, mine, rank, others: number[]（由高到低）, prize }>（最近八週）, month: { from: 週, mine: number, others: number[] } }`。
- 報告：`curtain.board`（kind `downtime`）：這一週的名次、前三名的數字、拿到的獎金；月結的那一週多一段。
- 匯出：`boardView(k, state)`（這一週到現在的打賞、上一週的榜、月榜的累計與還剩幾週）、`boardOf`。

## 要做的（引擎）

1. **每週結算**（`time.passed` 跨過週一 06:00；一次跨好幾週各算一次）：剛結束的那一週 `week.index` 對得上而且 `week.runs` 不是空的，才結。自己的數字是 `week.tips`（開過內場直播的加倍已經在裡面）。
2. **別隊的模擬**：每一隊照固定亂數擲場數（`runs` 的範圍），每一場擲一個場熱（`heat` 的範圍），那一場的打賞＝玩家這個席次的破關獎金 × `tipsRatio(場熱)`；合計是那一隊這一週的打賞。同一個存檔、同一週問幾次都一樣。
3. **名次與獎金**：把自己和別隊由高到低排，同分時玩家排前面；前 `top` 名各拿一份獎金＝這個席次的破關獎金（進現金或帳戶：照一趟結算的那一種）。玩家不在前三名就沒有獎金，報告照出（一句名次）。
4. **月榜**：每 `month_weeks` 週一段（從第一次上榜那一週起算），把這幾週自己的與每一隊的打賞各自加總；一段結束時玩家在前三名：席次升一級（`TIER_IDS` 的下一個；已經是最高的不升，改給一份獎金）。升席之後保證金與會費照新席次的算，下一次報名與下一個週一生效。M4 的升席是面談（`member.ts`：一席一席升、要街頭信譽與一次檢定，過了就是 `{ ...member, tier, clears: 0 }`）；月榜的升席不經面談、不看信譽，直接做同一個改動，報告一句「館方把你請到了<席次>。」
5. `boardView` 給畫面：別隊只給代號與數字。

## 要做的（畫面）

簾後館的對話框多一個「檔期榜」分頁：這一週到現在的打賞、上一週的名次與每一隊的數字（自己那一列標出來）、拿到的獎金、月榜的累計與「還有幾週結算」；沒有會員證時不顯示這個分頁。數字全部讀 `boardView`。

## 驗收條件

引擎（`engine/tests/features/M5-curtain-board.test.ts`；用 M4 冒煙的簾後館情境，直接用 `curtain.patch` 把 `week.tips` 設成要的數字）：

- 同一個種子、同一週，`boardView` 問兩次別隊的數字相同；換一週不同。
- 自己的打賞比每一隊都高：第一名、拿到一份等於破關獎金的錢；剛好第四名：沒有錢、報告有名次。
- 這一週沒上場：沒有 `curtain.board`；停權中：沒有。
- 一次跨兩個週一：結兩次，第二次因為沒上場不出報告。
- 月榜：四週累計在前三名 → 席次升一級；已經是貴賓席改拿獎金；不在前三名什麼都沒有；下一段從頭算。
- 存檔讀回來榜還在；`weeks` 只留最近八筆。
- M4 簾後館的測試原樣全過；`npm test`、`npx tsc --noEmit`、分層檢查全過。

畫面（`ui/tests/curtain/M5-ui-curtain-board.test.ts`）：分頁上的名次、每一隊的數字、獎金等於 `boardView`；沒有會員證時沒有這個分頁；`ui` 的 `npm test` 與 `vue-tsc` 全過。

## 依賴

M4 的簾後館。排在 M5-live-houses 之後（都改 `features/curtain`；那一張的內場直播加倍會進 `week.tips`）；不依賴 `live`。

## 完成時回報

改了哪些檔、測試結果、V60 的暫定數字實際寫進規則表的樣子（給 M5-data-rules 與平衡的 session）、升席走的是哪一條路、「貴賓邀請」這一張的讀法（升到貴賓席就是邀請）和設計書對不對得上。
