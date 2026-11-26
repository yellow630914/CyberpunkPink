# M5-home-people

- 交給：cpp-feature（sonnet）　（**第二波**）
- 目標：`home` 的第三塊：住戶（留宿的名冊成員、同居的人、契約人的位子）、家務六種、訪客（帶人回來、過夜）、人在哪一間、居家的觸發點、每週的上門、曝光、闖空門。
- 規格出處：DOWNTIME 7.1 節的表（住戶與家務上限）、7.8、7.9、7.10 節、5.1 節（家務的工錢在帳單第 7 項）、第 8 節；EVENTS 3.1 節（`home`、`weekly`）、3.3 節（家園那一列）、3.4 節（上門的優先序）、4.6 節；NPC_SYSTEM 10.3、10.4 節（同居、忠誠；只看門檻）；dev/adr/0020 第十節、V47、V50、D5；dev/work/M5-home-base.md、M5-home-furnish.md。
- 可以改的路徑：`engine/src/features/home/`、`engine/tests/features/M5-home-people.test.ts`；`engine/src/features/roster/ops.ts`（只有一處：「這一週有沒有和主角在一起」多問條件 `home_resident`，見「要做的」第 9 項）。
- 可以用的介面：前兩張的狀態與入口；`meterOf`（`affinity`、`loyalty`、`hostility`）；條件 `in_roster`、`contract`（0019 的；有人註冊才用）；效果 `affinity`、`loyalty`、`hostility`（先問）；掛點 `bill.collect`、`bill.settled`；掛鉤 `time.passed`（順序 15）、`rest.done`；核心的檢定（主動行動的那一擲用引擎的檢定，不走 AI 的鏈）、固定亂數；`actor.conditions`（`lying_low`）；報告的 `triggers`；`k.effects.register`。
- 不可以做的事：不 import 別的功能；居家事件、上門、訪客的內容不寫（只發觸發點與給效果）；同床會不會走到成人場景不判定（只在過夜的那一份報告帶觸發點）；耳目、機娘被駭、假身分被拆穿的後果不寫（只擲旗標）；契約人的住戶與家務不存在這個功能的狀態裡（從掛點 `home.people` 問；讓 `contract` 回答是 M5-contract-link）；人怎麼走不做（V47）；共同的規定見 dev/work/M5-plan.md。

## 新的格式與鍵

- 內容種類 `staff_job`（`overridable`）：六筆（`maid` 派遣女僕、`robot` 家用機娘、`cook` 廚師、`guard` 看門的、`manager` 店長、`clerk` 帳房），各自的週薪或訂閱、效果的鍵（舒適 +2、看家、吃得好、上門 −15、店面營業、家務上限 +1）、要什麼家具（廚房組、充電座）、`spy_chance?`、`faction?`。
- `home_rule` 多：各級的住戶上限（0、1、3、5）與家務上限（0、1、2、4）、留宿的忠誠門檻（40；低於 20 自己走）、同居的親密度門檻（80）與 DC 的式子、同居搬走的門檻（40）、請離開的親密度（−15）、帶人回來的 DC（16 − 親密度 ÷ 10；風格合 −2）、請認識的人做家務的 DC（14 − 親密度 ÷ 10）、訪客一次幾小時（2～4）與結束時的親密度（+1～+3）、主動上門的親密度（50）、上門的式子（7.10）、曝光的倍率（×2）與解除的條件（搬家或敵對值降到 30 以下）、居家觸發點帶的機率不在這裡（`event_scope`）。
- `Base` 多：`residents: Array<{ npc, kind: 'lodger' | 'cohabit' | 'contract', since, room?: 區塊 }>`、`staff: Array<{ npc?: 角色 id, job, wage, spy?: boolean, since, unpaid?: number }>`、`visitors: Array<{ npc, until: 總分鐘, overnight?: boolean }>`、`asked: Record<npc, 這一週問過>`。
- 效果：`home_burgle { n?: [最少, 最多] }`（拿走不在保險箱與暗格的 1～3 種；看家的機娘或加固門讓它先過一次檢定）、`home_expose { faction }`、`home_visitor { npc, hours? }`（事件帶一個人上門）。
- 條件：`home_resident { npc?, kind? }`（含掛點回來的契約人）、`home_exposed { faction? }`、`home_room { for: 'resident' }`（家裡還住得下一個人：住戶上限與床位都還有）。
- 掛點（這一張宣告、問）：`home.people`：`{ state }` → `Array<{ owner, npc: 角色 id, kind: 'contract', job?: staff_job 的 id }> | void`（「住在你的據點」的人；`job` 是他做的家務）。
- 報告：`home.resident`（kind `social`：請住進來、請離開、搬走）、`home.guest`（`social`：帶人回來、送走、過夜）、`home.staff`（`deal`：雇、辭）、`home.weekly`（`downtime`：這一週住戶與家務的變化、上門的那一擲；帶觸發點 `weekly`）。
- 匯出：`peopleView(k, state, base?)`（每個人：是誰、哪一種、這個時段在哪一間、效果；訪客剩多久；家務的週薪；上限與床位）、`invite`（留宿或同居）、`inviteChance`、`askLeave`、`bringHome`、`bringChance`、`seeOff`、`stayOver`、`hire`、`fire`、`roomOf(state, base, npc)`、`visitChance(k, state)`（這一週上門的機率與式子的每一項）。

## 要做的

1. **住戶**（只有家，安全屋沒有）：
   - 留宿的名冊成員：二級以上、他在名冊上（條件 `in_roster`）、忠誠 40 以上、有空床；效果：每週忠誠 +1、身上有 `lying_low` 的人在這裡敵對值消退加倍（給一個衍生數值或條件讓敵對值的功能讀：先註冊條件 `home_resident`，回報 security 要不要讀）；忠誠低於 20 那一週自己走。
   - 同居：親密度 80 以上；主動行動擲魅力＋交涉（或誘惑）對 18 − ⌊(親密度 − 80) ÷ 5⌋（已經是戀人再 −4：讀條件，有人註冊才看）；失敗這一週不能再問。效果：在家睡一覺之後到下次睡一覺所有檢定 +1（狀況 `home_warmth` 加檢定修正）、每天親密度 +1（每週最多 +3）、舒適 +1；親密度掉到 40 以下搬走；請他搬走親密度 −15。
   - 契約人：`kind: 'contract'` 的住戶不由這裡的入口加減，而是每次從 `home.people` 問來（住處是契約面板設的，M4 的 `Held.home === 'base'`；兩邊各存一份會對不上）。他們算在住戶上限裡、要有床（DOWNTIME 7.1：住戶＝同居的人＋留宿的名冊成員＋住在這裡的契約人）；回答裡超過上限或床位的那幾個照順序不算住戶（`peopleView` 列出來並寫「住不下」）。沒有人回答就是沒有契約人。
   - 上限 = 那一級的住戶上限（有店面另 +2：M5-shop 給）；還要有床（`home_beds`）。舒適度裡「住戶與家務」那一項由這一張給（同居 +1、女僕或機娘 +2）；擁擠照床位算。
2. **家務**：照 `staff_job`；上限照等級（帳房 +1）；同一個職位雇兩個不疊加；工錢是 `bill.collect` 的一筆（順序第 7 項），沒付成（`bill.settled`）那個人不再來。雇的時候照 `spy_chance` 擲一個旗標（只存著）。請認識的人來做要擲（DC 照規則）。契約人做家務不用工錢、不佔上限：`home.people` 回的 `job` 是這一張認得的 `staff_job`（女僕、廚師、看門的）時，那個職位的效果照算、帳單沒有他的工錢、家務上限不算他；同一個職位已經有人時不疊加。廚師要有廚房組、機娘要有充電座（讀家具的功能）。「吃得好」是 `rest.done` 在家睡一覺時加的狀況（核心的 `actor.conditions`；EVENTS 2.4.1 的名字 `吃得好` 的 id 照現有資料，沒有就用 `well_fed` 並回報）。
3. **訪客**：帶人回來（要在外面、和那個人同一處：條件由呼叫的人保證，這裡只擲 DC 與檢查同時在場的上限 = 床位 ＋ 訪客座）；在家 2～4 小時（`time`），結束親密度 +1～+3（固定亂數），舒適度到「精神飽滿」再 +1；過夜要有空床或同床，報告帶觸發點 `home_overnight`（`where`：對象）。零級的地方不經過這裡。
4. **人在哪一間**（V47）：`roomOf` 是純函式——晚上（黃金時段之後到清晨）在自己的床那一間（住戶各有一張床：照住進來的先後分；同居的和主角同一張）；白天照「存檔種子＋日子＋時段＋那個人」挑一間不是浴廁的房；訪客在主室。客房的條件（有床而且有住戶或過夜的訪客睡在這間）這時成立，回頭讓上一張的用途算得出來。
5. **居家的觸發點**：進門（上一張已經帶 `home`）；在家待滿 3 小時（聽 `time.passed`，人在家的地圖裡時）；在家睡一覺醒來（`rest` 本來就帶 `rest` 與 `home`，確認 `where` 帶得到「有哪些住戶與家務」——由這一張在 `report.before` 補進 `where`，或回報做不到）。
6. **上門**（每週一，`home.weekly`）：機率 = 最高的那條敵對值 − 30 − 隱蔽 × 8 − 看門的 15（%；最低 0；敵對值 80 以上再擲一次）；對那個勢力曝光的 ×2。中了：報告帶觸發點 `weekly`，`where` 帶 `visit: 勢力`、`base`。欠繳第 2 週必有一件討債：帶 `where.debt: true`（欠繳讀自己的 `arrears`）。
7. **曝光**：效果 `home_expose`；搬家（把家換到另一處）或那條敵對值降到 30 以下時解除（每週檢查）。
8. **闖空門**：效果 `home_burgle` 照固定亂數從箱子拿走；保險箱與暗格不動；結果的句子寫少了什麼。
9. **名冊認得同住**（改 `features/roster/ops.ts` 一處）：M4 的名冊在每週看「這一週有沒有和主角在一起」（主角沉溺過百時誰跟著、誰看穿），現在只算被召集過的人，註解寫著「同住還沒有狀態可以認」。那個函式多一個「或條件 `home_resident { npc: 那個人 }` 成立」（有人註冊才問）；roster 不 import home。

## 驗收條件（`engine/tests/features/M5-home-people.test.ts`；測試裝真的 `roster`、`npcs`（或用 `testMeter` 的替身給親密度與忠誠），自帶一處二級的家與幾件家具）

- 留宿：一級的家、忠誠 39、沒有空床，各被擋並有原因；住進來之後每週忠誠 +1；忠誠掉到 19 的那一週自己走。
- 同居：親密度 79 不能問；80 的 DC 是 18、90 是 16；失敗之後這一週再問被擋；成功後在家睡一覺有 `home_warmth`、檢定 +1；親密度每天 +1、一週最多 +3；掉到 39 搬走。
- 上限：二級三個住戶、第四個被擋；床位不夠被擋。
- 家務：雇女僕舒適 +2、帳單多一筆 250；沒付成那一週之後她不在；同職位第二個不加舒適；沒有廚房組雇不了廚師。
- 訪客：DC 照式子；同時在場的上限；待三小時時間過了、親密度加了；過夜的那一份帶 `home_overnight`。
- `roomOf`：同一個時段問兩次一樣；晚上住戶在有他的床的那一間；客房的用途在有人睡的時候成立。
- 上門：敵對值 70、隱蔽 2、沒有看門的 → 24%；有看門的 9%；曝光 ×2；敵對值 85 擲兩次；固定亂數下中的那一週報告帶 `visit`。
- 闖空門：箱子裡五種少了 1～3 種、保險箱不動；沒有東西時不丟錯。
- 曝光在敵對值降到 29 的那一週解除。
- 把 `roster`、`npcs` 拿掉（量表沒有人定義）：留宿與同居被擋（「還沒有這個人的資料。」這類），其餘照跑。
- `home.people` 的替身回兩個契約人（一個帶 `job: 'maid'`）：`peopleView` 有他們、`home_resident { kind: 'contract' }` 成立、住戶上限與床位把他們算進去（第四個住戶被擋）、舒適 +2、帳單沒有女僕的工錢、家務上限沒有少一格；替身不回之後他們就不在了。`home_room` 在滿的時候不成立。
- 名冊：留宿的人這一週沒被召集過，`roster` 的「這一週在一起」對他成立；搬走之後不成立（`roster` 既有的測試原樣全過）。
- `npm test`、`npx tsc --noEmit`、分層檢查全過。

## 依賴

M5-home-furnish。

## M4 對帳（2026-11-26）

- M4 的契約已經有「他的住處」（`own`／`base`）與「工作的安排」，而且設成 `base` 時只查主角有沒有住處（條件 `has_home`）。這一張把另一半做出來：誰住得下（`home_room`）、住進來算什麼（`home.people`）。contract 不 import home，home 不讀 `state.ext.contract`。
- 住戶與訪客「有沒有空」用到的共用狀況 M4 多了 `recovering`；留宿與訪客不擋（人本來就在家）。
- 居家觸發點的事件範圍：`engine/data/rules/event_scopes.json` 的 `home` 那一列現在只有 `home` 與 `rest` 兩個觸發點，沒有 `weekly`（上門）；由 M5-data-rules 補，這一張的測試自帶範圍。M4 的契約事件走自己的範圍 `contract`（觸發點 `order`、`holder_order`），和居家的觸發點互不影響。
- 同居與留宿的加成（每週忠誠、每天親密度）走 `loyalty`、`affinity` 的效果；M4 的名冊每週結算在 `time.passed` 順序 14，這一張是 15，接在它後面。

## 完成時回報

改了哪些檔、測試結果、「躲風頭的人敵對值消退加倍」security 那一邊要不要改、居家觸發點的 `where` 帶不帶得到住戶、EVENTS 4.6 那五件樣本事件用現在的效果與條件寫不寫得出來（寫不出來的差什麼）、`home.people` 與 `home_room` 給 M5-contract-link 夠不夠用。
