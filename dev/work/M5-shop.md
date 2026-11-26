# M5-shop

- 交給：cpp-feature（sonnet）　（**第二波**）
- 目標：`home` 的第四塊：店面——三級據點的一樓、五種、裝潢、每週營收、店長、在自己的店工作；轉播站當頻道的據點。
- 規格出處：DOWNTIME 7.11 節（全部）、4.1b 節、7.3 節（2→3 的升級）、7.1 節的表（三級那一列）、5.1 節（收入先入帳）；FIXER 第 9 節、第 4 節（收入）；MEDIA 4.6 節（轉播站每類兩件）；UI 第 12 節最後幾條；dev/adr/0020 第十節、V51；dev/work/M5-home-base.md、M5-home-people.md、M5-away.md（`away.jobs`）、M2-work.md（打工的格式）。
- 可以改的路徑：`engine/src/features/home/`（`shop.ts` 等）、`engine/src/features/work/`（只加「在自己的店工作」要的條件與一個入口，見下）、`engine/tests/features/M5-shop.test.ts`。
- 可以用的介面：前三張的狀態與入口；掛點 `bill.collect`、`bill.settled`、`away.jobs`（away 宣告的）；核心的檢定與固定亂數；`actor.skills`、`actor.conditions`（`busy`）；`k.stats.addStatProvider('studio_slots', …)`；`k.content`（`district` 的 `price_mult`）；效果 `hostility`、`favor`、`owed_to_pc`、`footage`、`subs`、`fame`（先問）；條件 `in_roster`；`state.rules.contentOff`；報告的 `triggers`。
- 不可以做的事：不 import 別的功能（`work` 那一邊的改動只用條件與衍生數值相接）；店面的事件、客人、任務線不寫；診所的治療折扣、同人工坊接訂做只給條件與旗標（那是 0019 的 medical、craft 的事）；區域狀態當 1（V51）；人偶館的內容不寫（只有營收與伊甸園的敵對值）；共同的規定見 dev/work/M5-plan.md。

## 新的格式與鍵

- 內容種類 `shop_kind`（`overridable`）：五筆（`bar` 酒吧、`clinic` 診所、`doll` 小型人偶館、`relay` 轉播站、`workshop` 同人工坊），各自能開在哪些區、裝潢費、每週基礎營收、經營的基本功（可以兩項取高）、店長的條件（診所：醫療 3 以上）、附帶（每週的效果範本與機率）、每班的獎勵（4.1b 的表：效果的範本）、打工的階段數（人偶館 3、其餘 2）、內容篩選的標籤。
- `home_rule` 多：營運費（基礎 × 0.4）、經營的 DC（13）、四級結果的倍率（1.5、1、0.6、0.3）、主角在店裡每滿一班營收 +10%（最多 +50%）、雇來的店長週薪（400）、店面讓住戶上限 +2。
- `Base` 多：`shop: { kind, fitted: boolean, manager?: 角色 id, hired_manager?: boolean, week: { minutes: number, rolled?: 結果 }, stage: number, minutes_total: number, last?: { roll, result, income } } | null`。
- 條件：`has_shop { kind? }`、`at_own_shop { kind? }`。
- 報告：`shop.open`（選種類、付裝潢；kind `deal`）、`shop.manager`（指定或換店長）、`shop.shift`（在自己的店工作一班；`downtime`，帶觸發點 `work`）、`shop.close`。每週的營收併在帳單（`bill.collect` 的收入）；大失敗的那一週 `bill.settled` 回的變更裡帶觸發點 `shop_trouble`。
- 匯出：`shopView(k, state)`（種類、店長、這一週預估的營收與式子的每一項、主角這一週待了幾班、附帶、階段）、`openShop`、`setManager`、`workShift`、`closeShop`、`shopKinds(k, state, base)`（這個住處能開哪幾種與原因）、`weekIncome`。

## 要做的

1. **開店**：那一處是三級（上一張的升級做完）、住處的 `shop_ok` 有這一種、區對得上、付得起裝潢；人偶館受內容篩選（關掉「人偶晶片的失憶工作」時只能開清醒的店：存一個旗標）。三級的版面第二張圖（一樓：前場、後場）這時才進得去；倉庫貨架可以放後場。
2. **店長**：名冊上的人（條件 `in_roster`；診所要他的醫療 3 以上）或雇來的（週薪 400，`bill.collect` 一筆）。名冊上的人當店長：回答 `away.jobs`——對他回一件 `shop_manager`（`free: true`、錢是 0），而且指定的那一刻就等於派出去了（他那一週 `busy`；V51）；away 沒裝時直接給他 `busy`、每週一重新給。沒有店長而主角這一週也沒待滿一班（8 小時）：這一週不營業（收入 0、只付營運費？——設計書沒寫，先當作「不營業、不付營運費」並回報）。
3. **每週營收**（`bill.collect` 的一筆收入；骰子用固定亂數）：基礎 × 區倍率 × 經營結果 × 區域狀態（1）− 營運費（基礎 × 0.4）；經營結果由店長擲（主角這一週在店裡待滿一班時改由主角擲），DC 13；主角每滿一班 +10%、最多 +50%。負的當 0 收入加一筆同額的支出（或直接夾在 0：照設計書的式子是可以賠的——做成一筆 `due`，回報）。轉播站的基礎只有 200（頻道的收入是頻道自己的）。
4. **附帶**（`bill.settled`）：照 `shop_kind` 的範本與固定亂數——酒吧每週一則傳聞的效果、30% 一個小人情；人偶館伊甸園敵對值每週 +2（蜜糖會好感 40 以上或旗標 `eden_franchise` 時不加；加盟抽三成營收）；診所沒有執照（旗標）時市警的上門機率加成（給 `visitChance` 一個入口）；同人工坊每週六的攤位只給旗標。對應的效果沒有人註冊就略過。
5. **在自己的店工作**（DOWNTIME 4.1b）：`workShift`——站在自己的店（一樓的地圖裡，或那個住處的設施上）、選 2、4、6 或 8 小時（M4：打工的一班改成這四種）、擲一次經營的檢定、這一週與累計的時數加上去（營收的「每滿一班 +10%」與「待滿一班由主角擲」都照累計每滿 8 小時算一班，0020 V61）、照那一種的「每班可能得到」範本擲一次獎勵（轉播站：訂閱或一段素材；人偶館：豔名、一則情報、體悟……有人註冊才給）、帶觸發點 `work`（`where` 帶 `own_shop: 種類`）。階段照打工的規則數自己的（M4 改成看累計時數，打工的資料是每個階段的 `need.hours`：這裡寫在 `shop_kind` 每一筆的 `stages`，預設第二階 30 小時、人偶館的第三階 72 小時加條件，DOWNTIME 4.1a；倍率乘在每班的獎勵機率上——設計書沒寫乘在哪，先這樣並回報；不滿 8 小時的一班獎勵的機率照時數比例）。`features/work` 那一邊：它的 `usesOf` 在 `at_own_shop` 成立時多列一項「在自己的店工作」（只是把入口的 id 列出來，做是這裡的 `workShift`）；`work` 不 import `home`，用條件相接。
6. **轉播站**：`studio_slots` 是 2（有店面而且種類是 `relay`）；剪片的地點（M5-media-cut 的 `edit`）——在自己的轉播站裡也算（條件 `at_own_shop { kind: 'relay' }`；media 那一邊認不認得由回報列出，改是修正工單的事）。
7. **住戶上限 +2**（有店面時）；主角在店裡時，上門的觸發點 `where` 帶 `at_shop: true`。

## 驗收條件（`engine/tests/features/M5-shop.test.ts`；測試自帶一處上限 3 的住處（兩張圖的版面）、兩個名冊上的人）

- 二級開不了店；三級而種類不在 `shop_ok` 被擋；錢不夠被擋；開了之後一樓的圖進得去。
- 營收的式子：酒吧基礎 600、區倍率 1、成功 → 600 − 240 = 360；大成功 660；大失敗（0.3）是負的 → 照做法的那一種結果；主角待了三班 +30%、六班夾在 +50%。
- 主角這一週待滿一班：擲的是主角的基本功；沒有：擲店長的。
- 名冊上的人當店長：那一週他 `busy`、召集不到；診所的店長醫療 2 被擋。雇來的店長帳單多一筆 400。
- 沒有店長也沒去：這一週照做法的結果。
- 人偶館：伊甸園敵對值每週 +2；旗標 `eden_franchise` 時不加、營收 ×0.7；內容篩選關掉時開不了（或只能開清醒的店）。
- 在自己的店工作 8 小時：時間過了 8 小時、這一週的時數 +480、帶 `work` 觸發點、轉播站的獎勵照固定亂數給（`footage` 有人註冊時）；做兩次 4 小時和一次 8 小時營收的加成一樣；累計 30 小時升二階。
- `studio_slots`：轉播站是 2。
- `away.jobs`：問當店長的那個人有 `shop_manager`；away 沒裝也照樣 `busy`。
- 把 `work` 拿掉：`workShift` 照樣做得了（入口不靠它）。M2 的 `work` 測試全過。
- `npm test`、`npx tsc --noEmit`、分層檢查全過。

## 依賴

M5-home-people、M5-away（`away.jobs` 的宣告；沒有也跑得起來）、M5-channel-shows（`studio_slots` 的定義；沒有就不加 provider）。做的時候不要有別的工單在改 `features/work`。

## M4 對帳（2026-11-26）

- **名字不要混**：`shop_type` 是 `trade` 的商店種類（M2，`engine/data/rules/shop_types.json`：雜貨、黑市……），這一張的 `shop_kind` 是自己的店面五種。兩個是不同的內容種類。
- **契約認不到這一班**：主角是契約人時，「打一班算照做工作指令、收入抽成」只認 `work.` 開頭的報告（`features/contract/time.ts`）。這一張的報告是 `shop.shift`，所以在自己的店工作不算照做持約人交代的工作、也不被抽成：這是刻意的（指令要的是他安排的那份工作）。
- **同人工坊接訂做**：M4 的未登錄零件（`features/unreg`）已經有委託台與交貨的流程；「玩家自己的社團接訂做」（CRAFTING 第 11 節第二條）這一批不做，這一張只給條件 `has_shop { kind: 'workshop' }` 與旗標。診所的治療折扣同理（`features/medical` 讀條件是之後的事）。
- 人偶館的內容篩選標籤是核心清單裡的 `puppet_amnesia`（人偶晶片的失憶工作）；五種店面各自可以在 `shop_kind` 寫 `tags`，經 `tagsAllowed`。
- 剪片的地點認轉播站、`studio_slots` 以外的下游，由 M5-home-links 一起接。

## 完成時回報

改了哪些檔、測試結果、三個「設計書沒寫、先這樣做」的地方（沒有店長的那一週、賠錢、階段的倍率）、診所與同人工坊要 0019 的 medical、craft 讀什麼條件、media 的剪片地點要不要認轉播站。
