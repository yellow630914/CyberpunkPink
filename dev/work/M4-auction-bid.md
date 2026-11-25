# M4-auction-bid

- 交給：cpp-feature（sonnet）　（**第五波**）
- 目標：`auction` 的後半：進場、一場拍賣是一個活動、一件拍品一回合一回合地喊（玩家加價、等、退出；NPC 照預算與興趣決定）、落槌、付款與佣金、當場取貨（零件、義體、藝術品、機密、契約）、仿品到手才發現、結束。
- 規格出處：LEWD_SYSTEM 6.2 節「一場拍賣」的時間那一條、「競價的回合」五步、「成交」三條；LIFE 1.1 節（兩種錢；用帳戶做髒交易）；CRAFTING 第 4 節（二手的狀態）；LEWD_SYSTEM 第 7 節開頭與 7.5 節（買下的契約：只用效果 `contract_hold`）；dev/adr/0016 第一節（活動）；dev/adr/0019 第十八節與 P78～P80、P82、P83。
- 可以改的路徑：`engine/src/features/auction/`、`engine/tests/features/M4-auction-bid.test.ts`。
- 可以用的介面：M4-auction 的 `sessionOf`、`catalogOf`、`memberOf`、`auctionRules`、`state.ext.auction`；`k.activity.define`（寫法看 `features/transit` 的搭車與 `features/netrun`）、核心的 `endActivity` 與 `attachActivityEnd`（結束的那一份報告用它們發 `activity.end`，寫法看 `features/transit/trip.ts`）；`deriveRng`；核心的 `productOf`、`readProduct`、成品編號的現有做法（M4-craft 買原廠成品的那一段）；內容種類 `quirk`（`pool` 含 `flaw`）；核心的 `item`、`cash`、`cred`、`time`、`ext` 變更；效果用登錄表跑（`contract_hold`、拍品的 `effects`、量表 `hostility` 的效果；查不到略過）；報告上的 `triggers`；`contentAllowed`。
- 不可以做的事：不改 M4-auction 的目錄與會員規則；NPC 的決定只看預算、興趣與這一回合有沒有人加過價（有脾氣、記仇、暗標、買斷、舉報、玩家寄拍都不做：IDEAS 的「真正的競拍系統」）；不叫 AI；鬧事只有 M4-auction 的效果 `auction_ban`，這一張不做搶標與威脅的動作；不 import `contract`、`craft`、`security`；共同的規定見 dev/work/M4-plan.md。

## 新的格式與鍵

- `auction_rule` 這一張讀的鍵：`rounds_max`（8）、`raise_max`（3）、`interest`（`{ yes: 0.7, no: 0.15, after_raise: 0.1 }`）、`fee_pct`（0.1）、`min_minutes`（60）、`cred_dirty`（`{ amount: 2, factions: [] }`：用帳戶買違禁品或契約時，清單裡每個勢力的敵對值加多少；清單預設空的）。
- `state.ext.auction.run`：`{ house, session, pay: 'cash' | 'cred', lots: LotRun[], bidders: Array<{ id, name, npc?, interests, mult }>, at: 現在第幾件, spent, won: Array<{ lot, price, fee }>, log: Array<{ lot, winner: 'pc' | 競標者的 id | null, price }> }`。
- `LotRun`：`{ lot, kind, name, market, reserve, step, fake, price（現價）, holder: 'pc' | 競標者的 id | null, round, quiet（連續幾回合沒有人加價）, out: 競標者的 id[], pc_out: boolean, state: 'open' | 'sold' | 'passed' }`。
- 活動 `auction`（`order: 40`；進行中＝`run` 有東西；`allow: ['commit:auction.']`；擋下的句子「拍賣還在進行：先把這一場喊完，或是離場。」）。
- 報告：`auction.enter`、`auction.bid`、`auction.leave`、`auction.close`。匯出：`enterBlocks(k, state, house)`、`enterDraft(k, state, { house, pay })`、`auctionView(k, state)`、`bidOptions(k, state)`、`bidDraft(k, state, input)`（`input` 是 `{ act: 'raise', steps: 1 | 2 | 3 }`、`{ act: 'wait' }`、`{ act: 'fold' }`）、`leaveDraft(k, state)`。

## 要做的

1. 進場（`enterBlocks`、`enterDraft`）：腳下的設施是這一家；是會員（`memberOf`）；現在在這一場開槌的時段裡（那一天、那個時段，幾點進來都可以）；這一場還沒進過（`done`）。`pay` 是這一場用哪一種錢付（整場一種）。成立：把 `catalogOf` 的拍品與競標者抄進 `run`（每一件 `price` 是底價、`holder` 是 null）。結果的句子帶一句「武器寄存在門口；會場掃了義體，沒有登記。」（只是字，P82）。
2. 一回合（`bidDraft`；一份報告就是一回合）：
   - 玩家：`raise`——現價加 `steps` 階（1～`raise_max`），玩家變成最高的人；「跟」就是加 1 階。`wait`——只有玩家已經是最高的人時可以（不加價）。`fold`——這一件退出，之後不能再喊。玩家是最高的人時不能 `raise`、不能 `fold`；不是最高的人時不能 `wait`。加價之後「價錢 ＋ 佣金 ＋ 這一場已經花掉的」超過身上那一種錢的，灰掉並寫「付不起這個價（含一成佣金）。」。
   - NPC：還在場的每一位照 `bidders` 的順序各決定一次——他是現在最高的人：不動；現價加一階超過他的預算（那一件的市價 × 他的倍率）：退出這一件；否則擲機率（對這一種有興趣是 `yes`、沒有是 `no`；這一回合在他之前已經有人加過價，含玩家，再加 `after_raise`），中了就加 1 階、變成最高的人。亂數用 `deriveRng`（鍵：`auction`、拍賣行、場次、第幾件、第幾回合、第幾位），不動存檔亂數的游標：同一個選擇重來一次結果一樣。
   - 回合結束：這一回合沒有任何人加價，`quiet` 加 1——1 是「倒數一次」、2 是落槌；有人加價就歸 0。`round` 到 `rounds_max` 也落槌。落槌時 `holder` 是 null 就流標，否則那個人以現價得標。
   - 報告的 `outcome` 帶這一回合每個人的動作（照順序：誰、做了什麼、之後的現價）、倒數的狀態、落槌的結果。
3. 玩家退出之後：這一件由程式照同一套規則繼續算到落槌（在同一份報告裡算完，`outcome` 列出每一回合），然後換下一件。
4. 玩家得標：付「現價 ＋ 現價 × `fee_pct`（四捨五入）」，從 `pay` 那一種錢扣；當場取貨——
   - 零件：`item` 加那個零件；它是仿品而且 `looked` 不是 `fake`（沒看、看不出來）時，那一疊帶 `data: { state: 'used' }`、結果多一句「拿到手才發現這一件是仿品。」。
   - 義體：加一疊成品（設計圖的 id、`ProductData` 是它的 `stock`，新的 `uid`）；仿品而沒看出來時 `state: 'used'`、`quality: 'flawed'`、多一筆 `pool` 含 `flaw` 的 `quirk`（查不到就不加），同樣多那一句。預展看出來是仿品還照標的，東西一樣是那個樣子，只是沒有那一句。
   - 藝術品與機密：`item` 加那一件（有寫才加），再跑拍品的 `effects`（內建的來源）。契約：跑效果 `contract_hold`（拍品的 `contract` 加上 `npc`，`origin` 是拍賣行的名字）。
   - `once` 的記進 `sold`。`pay` 是帳戶，而且這一件是違禁（`productOf` 或零件的 `legal` 是 `banned`）或契約：`cred_dirty.factions` 的每個勢力加敵對值（清單是空的就什麼都不做）。
5. 全部拍品都落槌之後（或 `leaveDraft`：剩下的每一件都當成玩家退出，由程式算完）發 `auction.close`：時間推到這個時段結束，而且從進場算起至少 `min_minutes`；`done[house]` 記這一場；`run` 清掉；用 `endActivity` 發 `activity.end`（`kind: 'auction'`、`outcome: 'done'`、`result: { house, won, spent, log }`）並把回來的東西併進這一份報告；帶一個觸發點 `auction_done`（`where: { house, won: 得標幾件 }`）。
6. `auctionView`（給畫面）：第幾件之幾、這一件的名字與種類與鑑定書、底價、現價、一階、誰是最高、第幾回合、倒數的狀態、還在場的競標者（名字，預算不給）、這一場花了多少與得標的清單、身上那一種錢還剩多少。`bidOptions`：三種動作各自能不能做與原因、每一種加價之後的價錢與含佣金的總數。兩個都不改狀態。
7. 存檔在一場中途讀回來接得下去（東西都在 `run`）；回退照核心的做法一步一回合。

## 驗收條件（`engine/tests/features/M4-auction-bid.test.ts`；沿用 M4-auction 測試的資料；`contract_hold`、`hostility` 用測試註冊的假效果）

- 進場：不是會員、不在開槌的時段、不在拍賣行、這一場進過了，各被擋並有原因；進場之後 `k.activity.active` 是這一場、`commit:world.` 開頭的報告被擋、`commit:auction.bid` 放行。
- 一回合：玩家加 2 階之後現價多兩階、玩家是最高；固定種子下預算不夠的那一位退出、有興趣的那一位跟了一階；同一個狀態同一個選擇跑兩次逐欄相同；存檔亂數的游標沒變。
- 玩家是最高的人時 `raise` 與 `fold` 灰掉、`wait` 可以；不是的時候 `wait` 灰掉。錢只夠付現價不夠付佣金時加價灰掉、原因是那一句。
- 落槌：把興趣的機率設成 0，玩家加一階之後連等兩回合，第二回合結束落槌、玩家得標；沒有任何人出過價的那一件流標；把機率設成 1、預算設得很高，到第 8 回合落槌。
- 退出：玩家 `fold` 之後同一份報告裡這一件算到落槌、換到下一件；之後對這一件不能再喊。
- 得標：扣的是現價加一成；零件進背包；仿品沒看過的那一件帶 `state: 'used'` 而且有那一句，預展看出來的那一件沒有那一句；義體是一疊帶 `parts` 的成品，仿品的 `productPrice` 比真品低；契約那一件叫到假的 `contract_hold`、帶 `npc`；`once` 的進了 `sold`。
- 帳戶付違禁的零件：`cred_dirty.factions` 是空的時沒有事；測試把清單設成一個勢力之後假量表 +2；現金付不加。
- 結束：`auction.close` 之後時間是 23:00（19:10 進場）；19:00 進場而每一件都立刻退出時至少過 60 分鐘；`done` 記了、`run` 沒了、同一場再進被擋；報告帶觸發點 `auction_done`。`leaveDraft` 在第二件中途離場：剩下的每一件都有落槌的結果。
- 中途存檔再讀，接著喊完的結果和不中斷的逐欄相同。
- 性質測試（隨機的種子與隨機的玩家動作）：每一件的回合數不超過 8；成交價不低於底價加一階；得標的 NPC 的成交價不超過他的預算；玩家付的總數不超過進場時身上的錢。
- `npm test`、`npx tsc --noEmit`、分層檢查全過。

## 依賴

M4-auction。`contract` 沒裝也跑得起來（目錄裡本來就不會有契約）。

## 完成時回報

改了哪些檔、測試結果、一場六件大約幾份報告（給介面估演出）、`activity.end` 的 `result` 的形狀、設計書沒寫而照 0019 P78 做的幾處實際玩起來順不順（玩家是最高的人時只能等、NPC 一次只加一階）。
