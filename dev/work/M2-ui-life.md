# M2-ui-life

- 交給：cpp-ui（sonnet）
- 目標：過日子的四塊畫面接上引擎：商店、每週帳單、打工、休息與住處。買到的東西進引擎的背包；錢、時間都是引擎的。
- 規格出處：docs/art/UI.md 3.5 節（錢與人情）、3.8 節（商店）、3.10 節（每週帳單）、3.12 節（打工）、第 12 節裡住處的抬頭與睡覺那一列（家園的地圖不做）；dev/work/M2-trade.md、M2-market.md、M2-bills.md、M2-rest-housing.md、M2-work.md 的「新的格式與鍵」與「對外」。
- 可以改的路徑：`ui/src/dialogs/`（`ShopDialog.vue`、`BillsDialog.vue`；新增 `WorkDialog.vue`、`RestDialog.vue`）、`ui/src/lib/`（新增 `lifeView.ts`；`price.ts`、`bills.ts`、`shopEvents.ts` 裡被引擎取代的規則刪掉）、`ui/src/stores/engine.ts`（只加轉接）、`ui/src/stores/game.ts`（拿掉假的 `bills`、`job`）、`ui/src/data/demo/`、`ui/tests/`。
- 可以用的介面：`@engine/src/features/trade`（`shopView`、`quote`、`checkout`、殺價的輸入、`routesHint`）、`@engine/src/features/bills`（`billPreview`、改設定）、`@engine/src/features/work`（`jobsHere`、`shift`）、`@engine/src/features/rest`（`sleepOptions`、喘口氣、睡一覺、租與退）、`Game.act`（殺價）、`Game.commitNarrated`、store 的 `blockOf`。
- 不可以做的事：不改 `engine/`；價錢的拆解、帳單的順序、報酬的公式都問引擎；AI 的當日優惠、長期折扣、洗錢、派別人去打工、家園的地圖先灰掉並寫「還沒有開放。」；共同的規定見 dev/work/M2-plan.md。

## 要做的

1. **商店**（走進店的設施時打開）：抬頭（種類、店主與親密度、後台勢力、收哪幾種錢）；買與賣兩個分頁，每一列的價錢與選不了的原因；購物車（買與賣同一台）；選中那一件的價格拆解（每一步的名字與 ▲▼ 百分比照引擎回的）；用哪一種錢付的兩格（不收的那一格灰掉並寫原因）；合計；殺價（整車、每間店每天一次，送主動行動）；結帳。
2. **每週帳單**（引擎出了 `bill.settle` 或玩家從錢包打開）：支出每項一列（從哪裡付、金額、沒付成的紅線）、收入、合計與差多少、下坡的四格（現在在哪一格）；每一項可以設用現金付或不付了。週日的提醒顯示成通知。
3. **打工**（在可以打工的設施打開）：這裡的工作、階段的兩格或三格（時薪、升上去的條件與進度；被篩選關掉的階段不顯示）、做多久、預計的錢與成功率、上班、上一班的結果。升階的詢問是事件視窗。
4. **休息**：睡一覺與喘口氣的選項照 `sleepOptions`（回復率、價錢、選不了的原因）；住處的抬頭（哪一間、週租、欠了幾週）、租與退。
5. **示意世界包**（M2-plan 第 5 項）：把 `ui/src/data/shops.ts`、`weekly.ts` 與幾份示意的打工、兩三處住處整理成引擎的內容。

## 驗收條件（測試自帶一間店、六樣東西、一份工作、一處住處）

- 結帳之後引擎的背包多了買的、錢少了；存檔再讀還在（status 的待辦「買到的東西不會進引擎的背包」收掉）。
- 拆解的每一步和 `quote` 回的一樣；只收現金的店帳戶那一格是灰的、`title` 是引擎的原因。
- 殺價成功之後今天的價錢變了、按鈕變灰並寫今天殺過了。
- 帳單：跨過週一之後對話框出現，每一項的金額、哪一項沒付成和引擎的報告一樣；把一項改成用現金付，下一次預覽跟著變。
- 打工一班：時間與錢和引擎一致；條件不夠的階段寫出還差什麼；升階的事件出現時視窗打開。
- 睡一覺：不到 16 小時按鈕是灰的並有原因；睡完生命、時間和引擎一致。租房扣押金、退租拿回。
- 有委託在進行時這四塊的入口都被擋，原因是引擎的。
- 這幾個元件與 `lifeView.ts` 裡沒有價錢、報酬、回復量的算式；不 import `ui/src/data/shops`、`weekly`。
- `npm test` 與 `vue-tsc` 全過。

## 依賴

M2-trade、M2-market、M2-bills、M2-rest-housing、M2-work、M2-ui-world（事件視窗與設施）。

## 完成時回報

改了哪些檔、測試結果、UI 那幾節裡因為引擎還沒有而沒顯示的東西、刪掉的舊程式清單。
