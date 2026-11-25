# M4-auction

- 交給：cpp-feature（sonnet）　（**第五波**）
- 目標：新功能 `auction` 的前半：一家拍賣行是一筆內容；會員資格（好感或推薦）與停權；每週的目錄與競標者（程式抽，確定性）；預展看貨。進場與競價是下一張（M4-auction-bid）。
- 規格出處：LEWD_SYSTEM 6.2 節的「進場」「一場拍賣」與「成交」裡預展看貨那一條、最後「資料」那一句；第 6 節表裡「拍賣會」那一列；第 9 節（契約支配的篩選）；FACTIONS 5.1 節（好感 40 是友好）；LIFE 1.2 節（買斷一份普通的契約 8,000 起，只當市價的參考）；SITES 5.3 節樂園 2F 那一列（另一家拍賣行，只賣契約；這一張只要讓資料寫得出第二家）；EVENTS_CITY「白槌的預展」（只當預展是什麼的參考，事件本身是內容）；dev/adr/0019 第十八節與 P76、P77、P79、P81、P83、P84。
- 可以改的路徑：`engine/src/features/auction/`（新）、`engine/src/features/index.ts`、`engine/tests/features/M4-auction.test.ts`。
- 可以用的介面：核心的 `productPrice`、`productOf`、內容種類 `part`、`blueprint`、`item`、`npc`、`faction`、`quirk`；`deriveRng`（不動存檔亂數的游標）；`weekdayOf`、`segmentOf`、`daysUntilWeekday`、`toMinutes`（核心的時間）；量表 `favor`、`affinity`（用 `meterOf` 讀，查不到當 0）；條件 `has_favor` 與變更 `favor.spend`（`features/favors`；用登錄表問，沒有人註冊時「用人情換推薦」不列）；條件 `at_facility` 與設施種類的欄位（照 `features/rest` 讀 `sleep` 的做法）；`makeCheck`、`checkParts`；`k.effects.has`（看 `contract_hold` 有沒有人註冊）；`contentAllowed`（`contract_dom` 與拍品的 `tags`）；`k.effects.register`、`k.conditions.register`；核心的 `ext`、`time` 變更。
- 不可以做的事：不寫白槌、任何一件拍品、任何一位競標者的內容（測試自帶）；不做進場與競價；鑑定書與主持人的口白只用資料與程式的句子，不叫 AI（P84）；寄存武器與掃描義體不做機制（P82）；不 import `contract`、`favors`、`security`、`npcs`、`craft`；共同的規定見 dev/work/M4-plan.md。

## 新的格式與鍵

- 設施種類多讀 `auction?: { house: 拍賣行的 id }`。
- 內容種類 `auction_house`：`{ id, name, weekday（開槌是星期幾，照核心的 `Weekday`）, segment（哪一個時段，照核心的 `SegmentId`）, lots: [最少, 最多], kinds: LotKind[], must?: LotKind[]（至少要有一件是這幾種之一）, bidders: [最少, 最多], member: { faction?, favor_min?, ref?: boolean } }`。`LotKind`＝`part`、`cyberware`、`art`、`secret`、`contract`。
- 內容種類 `auction_lot`（拍品池）：`{ id, kind, name?, desc?, cert?（鑑定書的一句）, part?（零件的 id）, blueprint?（義體設計圖的 id，拍的是它的 `stock`）, item?（藝術品與機密是哪一件物品）, npc?、contract?（契約：誰的、`contract_hold` 的參數）, effects?（得標時另外跑的效果，內建的來源）, market?（市價；零件與義體不用寫）, houses?（哪幾家會出現，沒寫是都會）, weight?, once?, needs?: Condition[], tags?: string[] }`。格式檢查：`kind` 與它要的那一欄對得上；零件與義體的等級要在 `auction_rule.grades` 裡（V 級擋下）；`art`、`secret`、`contract` 要有 `market`。
- 內容種類 `auction_bidder`：`{ id, name, npc?（是哪個認識的人）, interests: LotKind[], weight? }`。NPC 的資料（`npc`）多讀選填的 `auction_ref`（`true`，或拍賣行 id 的陣列：這個人寫得出推薦函）。
- 規則 `auction_rule`（`overridable`，id `default`；預設值寫在 `DEFAULT_AUCTION_RULES`）：`grades`（`[3, 4]`）、`reserve_pct`（0.5）、`step_pct`（0.1）、`step_min`（50）、`budget`（`[0.8, 1.6]`）、`fake`（`{ chance: 0.15, dc: 16, skills: ['cyberware', 'investigate'], minutes: 10 }`）、`preview`（`{ days_before: 1, from_hour: 8, to_hour: 18 }`）、`ref`（`{ favor: 'small', affinity: 40 }`）、`ban_days`（28）。下一張的鍵先留著不讀。
- `state.ext.auction = { member: Record<拍賣行, { by?: npc, at: 分鐘 }>, banned: Record<拍賣行, 到什麼時候（分鐘）>, looked: Record<`<拍賣行>:<場次>:<第幾件>`, 'ok' | 'fake' | 'unknown'>, sold: string[], done: Record<拍賣行, 場次>, run?: 下一張 }`。「場次」是那一場開槌日的天數（`day`）。
- 效果（`ai: false`，內建的來源才收）：`auction_ref`（`{ house, by? }`：直接給推薦）、`auction_ban`（`{ house, days? }`：停權，沒寫天數用 `ban_days`）。條件 `auction_member`（`{ house }`）。
- 報告：`auction.ref`、`auction.inspect`。匯出：`auctionFeature`、`DEFAULT_AUCTION_RULES`、`auctionRules`、`housesHere(k, state)`、`sessionOf(k, state, house)`、`catalogOf(k, state, house)`、`catalogView(k, state, house)`、`memberOf(k, state, house)`、`refOptions(k, state, house)`、`refBlock`／`refDraft(k, state, { house, npc, pay: 'favor' | 'affinity' })`、`inspectOptions(k, state, house)`、`inspectBlock`／`inspectDraft(k, state, { house, lot, by? })`。

## 要做的

1. 場次（`sessionOf`）：照 `weekday` 與 `segment` 算出「下一場」開槌日的天數、目錄公布的時間（開槌日前 `days_before` 天的 `from_hour`）、預展的起訖（那一天的 `from_hour`～`to_hour`）、開槌的起訖（那個時段）。這一場已經去過（`done`）或開槌的時段已經過了，就是再下一週的那一場。
2. 目錄（`catalogOf`；純函式，亂數用 `deriveRng`，鍵是 `auction`、拍賣行、場次——同一場不管什麼時候問、問幾次都一樣）：
   - 件數在 `lots` 的範圍裡照種子取。從池裡照 `weight` 不重複抽：`kinds`、`houses`、`needs`、`tags`（被篩選關掉的不抽）、`once` 而已經在 `sold` 裡的不抽；`contract` 在沒有人註冊 `contract_hold` 效果時不抽。抽完沒有 `must` 的任何一種，就把最後一件換成池裡一件 `must` 的（池裡沒有就維持）。池不夠就有幾件給幾件。
   - 每一件算好：`market`（零件是目錄價、義體是 `productPrice` 配設計圖的 `stock`、其餘是資料的 `market`）、`reserve`＝`market × reserve_pct`（四捨五入到十位）、`step`＝`max(reserve × step_pct, step_min)`（四捨五入到十位）、`fake`（只有零件與義體擲 `fake.chance`，其餘一律不是）。
   - 競標者：人數在 `bidders` 的範圍裡；從 `auction_bidder` 照 `weight` 抽，不夠的補「N 號牌」（興趣照種子給一到三種）；每一位一個預算倍率（`budget` 範圍裡，取到小數兩位），這一場每一件都用同一個倍率乘那一件的市價。
3. `catalogView`：還沒到公布的時間回 `{ open: false, at: 公布的時間 }`；公布之後列每一件的名字（資料沒寫就用零件、設計圖、物品的名字）、種類（`contract` 在 `contract_dom` 被關掉時種類的名字是「債權」，其餘不變）、底價、一階、鑑定書（`cert`，沒寫是「附鑑定書，來路乾淨。」）、看過貨的結果（只有 `looked` 裡有的才帶；`fake` 這個欄位本身不外露）、競標者的名字與人數（預算不外露）。
4. 會員（`memberOf`）：停權中（`banned` 還沒到期）→ 不是，原因寫到哪一天；`member.faction` 的好感在 `favor_min` 以上 → 是（`via: 'favor'`，不存，每次現算）；`member.ref` 開著而 `state.ext.auction.member` 有這一家 → 是（`via: 'ref'`）；否則不是，原因各一句（好感差多少、可以找誰寫推薦）。條件 `auction_member` 用同一個函式。
5. 推薦（`refOptions`、`refDraft`）：對象是資料帶 `auction_ref`（對得上這一家）的 NPC。兩種換法：`favor`——條件 `has_favor`（`dir: 'owed_to_pc'`、`who` 是他、`size` 是 `ref.favor`）成立，變更 `favor.spend`；`affinity`——他對主角的親密度在 `ref.affinity` 以上，不扣。成立：`member[house]` 記下、報告 `auction.ref`、時間加 10 分鐘。已經是會員、停權中，各擋一句。效果 `auction_ref` 直接記下；`auction_ban` 記 `banned`（靠推薦的資格留著，到期之後照舊算）。
6. 預展看貨（`inspectOptions`、`inspectDraft`；`inspectOptions` 對目錄的每一件回答能不能看、原因、會用哪一項基本功、DC 與成功率）：腳下的設施是這一家；現在在預展的起訖裡；那一件是零件或義體；這一場這一件還沒看過（一件一次）。不必是會員。檢定：`by`（主角或隊上的人，沒給是主角）的 `fake.skills` 裡等級最高的那一項，屬性照那一項基本功的資料，對 `fake.dc`。成功：`looked` 記真的結果（`ok` 或 `fake`），結果的句子是「看起來沒有問題。」或「這一件是仿品，或者有瑕疵。」；失敗：記 `unknown`，句子是「看不出什麼。」。時間加 `fake.minutes`。

## 驗收條件（`engine/tests/features/M4-auction.test.ts`；測試自帶：一家拍賣行（週五、晚上那一段、4～6 件、五種都賣、`must` 是零件與義體、會員看一個勢力的好感 40 或推薦）、第二家只賣契約的、十二件拍品（零件 III、IV 各兩件、一件 V 級拿來驗擋下、兩張義體設計圖、藝術品、機密、契約各兩件，其中一件 `once`）、四位競標者（一位帶 `npc`）、兩位帶 `auction_ref` 的 NPC；`favor`、`affinity` 用測試註冊的假量表）

- 格式：V 級的零件當拍品被擋；`art` 沒寫 `market` 被擋；`kind: 'part'` 沒寫 `part` 被擋。
- `sessionOf`：週三問，開槌日是這個週五、公布是週四 08:00；週五 23:30 問，是下週五。
- `catalogOf`：同一場問兩次逐欄相同、不同場不同；件數在 4～6；至少一件零件或義體（把池裡的零件與義體的 `weight` 調到很低也成立）；底價是市價的一半、一階至少 50；競標者 3～6 位、倍率在 0.8～1.6；沒裝會註冊 `contract_hold` 的功能時目錄裡沒有契約，測試註冊一個假的 `contract_hold` 之後有；第二家只出契約。性質測試（隨機的場次）：以上幾條都成立。
- `once` 的那一件記進 `sold` 之後不再出現。拍品的 `tags` 被篩選關掉時不出現；`contract_dom` 關掉時契約的種類名字是「債權」。
- `catalogView`：週三是 `open: false`；週四 08:00 之後列得出來；任何一欄都沒有 `fake` 與預算。
- 會員：好感 39 不是並寫差多少；40 是；用小人情換推薦之後好感 0 也是、人情少一個；親密度 40 的那一位不扣東西；`auction_ban` 之後不是並寫到哪一天，過了 28 天又是。AI 給的 `auction_ref` 被擋。
- 看貨：週四 10:00 在拍賣行可以；週四 19:00 被擋；不在拍賣行被擋；契約那一件被擋；固定骰子成功時 `looked` 是真的結果、失敗是 `unknown`；同一件第二次被擋；時間各加 10 分鐘。
- `npm test`、`npx tsc --noEmit`、分層檢查全過。

## 依賴

M4-core-product（`productPrice`）。`contract`、`favors` 沒裝也跑得起來。做完才能開 M4-auction-bid。

## 完成時回報

改了哪些檔、測試結果、`sessionOf` 的星期與時段實際怎麼對到核心的時間（給介面）、池子太小時實際會發生什麼、樂園 2F 那一家用這份格式寫得出來嗎。
