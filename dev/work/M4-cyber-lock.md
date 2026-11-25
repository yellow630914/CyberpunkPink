# M4-cyber-lock

- 交給：cpp-feature（sonnet）
- 目標：義體是把柄的那一面：授權鎖（訂閱、契約）、每週的訂閱費、鎖住與解鎖、二手的殘響；給別的功能用的四個效果；回答戰敗與掃橋；光紋刺青；修理與換零件的小手術。
- 規格出處：CYBERWARE 第 1 節（光紋刺青）、第 5 節（授權鎖、二手貨；惡意韌體是 M4-malware）；CRAFTING 第 4 節狀態的表；TRADE 3.4 節（解授權鎖）；DOWNTIME 第 5 節（每週帳單的項目）；LIFE 3.1 節（合法性；只看義體那幾列）；dev/adr/0019 第三節「授權鎖」與 P11、P12、P45。
- 可以改的路徑：`engine/src/features/cyberware/`、`engine/tests/features/M4-cyber-lock.test.ts`。
- 可以用的介面：掛點 `bill.collect`、`bill.settled`（`features/bills/settle.ts` 宣告；`BillLine` 的欄位看 `features/bills/model.ts`）、`defeat.gear`（`features/defeat/flow.ts`）、`scan.person`（M4-security-m4 宣告：用名字掛，沒有人問也不會壞）；`k.effects.register`（`ai: false`）；`k.effects` 查某種效果有沒有人註冊；量表 `hostility`（`features/security`；用效果加，查不到就略過）；`productPrice`、`productOf`；`makeCheck`。
- 不可以做的事：三種買法怎麼賣是交易與內容的事（這一張只認那一件的 `lock`）；契約持約人「遠端接管」不做（只有鎖與讀）；惡意韌體本身不做（只在效果登錄表查得到 `malware` 時叫它）；不 import `features/bills`、`features/security`；共同的規定見 dev/work/M4-plan.md。

## 新的格式與鍵

- 那一件的 `lock`：`{ kind: 'subscription' | 'contract', holder?: 勢力或 NPC 的 id, weekly?: 整數, owed?: 整數 }`。鎖住是 `off: { why: 'lock' }`。
- 效果（內建的來源才收，`ai: false`）：
  - `cyber_install`：`{ blueprint, parts?, slot?, side?, lock?, quirks? }`：直接裝上一件（零件沒寫用 `stock`）；不收費、不休養、沉溺成本照正規診所。沒有空槽時落空並提醒。
  - `cyber_take`：`{ slot?, bp?, uid?, to?: 'gone' | 'bag' }`：拿走一件（好幾件符合時拿照槽順序的第一件；橋拿不走）。
  - `cyber_lock`：`{ slot?, bp?, uid?, on: boolean, hours?, why? }`：鎖住或解開；帶 `hours` 的到時間自己解開。
  - `cyber_unlock`：`{ uid? | slot? }`：把 `lock` 整個拿掉（買斷、偽造授權成功）。
- 報告：`cyber.pay`（補繳）、`cyber.crack`（破解）、`cyber.repair`、`cyber.modify`。匯出：`lockView`、`payLockDraft`、`crackBlock`／`crackDraft(k, state, { actor, uid, by? })`、`repairDraft`、`modifyDraft`。
- 規則 `cyber_rule` 多：`subscription_rate`（0.03）、`crack_dc_bonus`（3）、`crack_hostility`（5）、`used_malware`（0.10）。

## 要做的

1. 訂閱（P11）：`bill.collect` 時，主角身上每一件 `lock.kind === 'subscription'` 的各出一行（名字是那一件的名字加「訂閱」；金額是 `weekly`，沒寫照成品價 × `subscription_rate` 四捨五入）。`bill.settled`：那一行沒付成就鎖住並把欠的加進 `owed`；付了而且 `owed` 是 0 的解開。
2. 鎖住的義體：效果停（被動效果、`implants`、戰鬥行動、`deck.source` 的回答都當它不存在），`sink_floor` 那一筆照算；拆不了。
3. 補繳：`payLockDraft` 付清 `owed` 就解開。破解：動刀的人擲技術＋義體學對（設計圖等級的標準 DC ＋ `crack_dc_bonus`）；成功把 `lock` 拿掉；失敗觸發回報（`holder` 是勢力時那個勢力的敵對值 + `crack_hostility`，查不到量表就只寫一句）；大失敗另外讓那一件壞掉（`off: { why: 'broken' }`，要修）。條件 `ability`（`daily: 'unlock'`）成立的人檢定 +2、失敗不觸發回報（SKILL_TREES 解鎖匠的日常；沒有人註冊這個條件就沒有這一條）。
4. 二手（P12）：裝上一件 `state: 'used'` 而且身上沒有 `echo` 類 `quirk` 的義體時，照 `uid` 當種子從 `pool` 含 `used` 的 `quirk` 抽一筆加上去；效果登錄表查得到 `malware` 時，照 `used_malware` 的機率給一筆 `{ kind: 'malware', pool: 'used', piece: uid }`。這一步掛在 M4-cyberware 的 `installDraft` 後面（同一份報告）。
5. `defeat.gear`：對 `cyber_install`、`cyber_take`、`cyber_lock` 回答 true。
6. `scan.person`：回答 `{ cyber: { count, items: Array<{ uid, name, legal, registered }> } }`。全生體的、帶 `scan_proof` 特性的零件佔全部的那一件不列；合法性用 `productOf().legal`。
7. 光紋刺青（P45）：設計圖帶 `tattoo` 的義體照一般的皮膚義體裝；這一張只加條件 `cyber` 的兩個鍵（`tattoo: 'deco' | 'gang'`、`faction`）與 `cyberView` 的標示，效果都是資料的 `effects`。
8. 有期限的鎖（`hours`）：讀的時候比對時間，過期的當成沒有；下一次寫 `pieces` 時順手清掉。
9. 修理：壞掉的那一件（`off.why === 'broken'`；破解大失敗、之後的事件）用 `repairBlock`／`repairDraft(k, state, { actor, uid, via, by? })` 修好：診所收成品價的兩成；自己修要在有工作台的住處（條件 `at_home` 帶 `level_min: 2`）或診所，擲技術＋義體學對 13，失敗只花掉時間（DOWNTIME 3.1 節最後一條）。
10. 小手術（CRAFTING 10.3 節）：`modifyBlock`／`modifyDraft(k, state, { actor, uid, type, part, via, by? })` 換掉身上一件義體的一個零件：槽的檢查用核心的 `slotProblems`；手術費是那個零件目錄價的五成（照動刀的人的 `fee` 比例換算：正規 0.5、無照 0.3、黑 0.4、自己 0）；自己動刀擲一次和安裝同樣的檢定；換下來的零件回背包（零件一律用核心的 `stackPart`、`partStack` 讀寫：換上去的可能是內嵌的零件，放進義體的是那一整筆；M4-plan 規定 10）；沉溺成本重算（下限跟著變，沉溺不到的補上）；不另外休養。橋的零件一律走換橋那一種手術的費用與休養（`bridge_fee_mult`、`bridge_recovery_minutes`）。

## 驗收條件（`engine/tests/features/M4-cyber-lock.test.ts`；`bills` 與 `security` 用測試自己掛的假掛點與假量表）

- 一件訂閱的義眼（成品價 1,000）：`bill.collect` 出一行 30；告訴它沒付成（`bill.settled` 帶 `unpaid: 30`）之後它鎖住：效果沒有、`sink_floor` 沒變、拆被擋；`payLockDraft` 付 30 之後回來。
- 破解：成功 `lock` 沒了；失敗假量表多 5；大失敗那一件是 `broken`。測試註冊條件 `ability` 之後失敗不加敵對值。
- 四個效果：`cyber_install` 直接多一件（沒有扣錢、沒有 `recovering`）、槽滿時落空並有提醒；`cyber_take` 預設整件消失、`to: 'bag'` 回到背包；`cyber_lock` 帶 `hours: 24` 一天後自己解開；AI 與玩家要的這四種一律被擋。
- 二手的義臂裝上之後多一筆 `echo`；同一個 `uid` 重裝還是那一筆。測試註冊假的 `malware` 效果、把機率設成 1：它被叫到一次。
- `defeat.gear` 對三種效果是 true，對別的不回答。`scan.person` 不列全生體的那一件。
- 條件 `cyber: { tattoo: 'gang', faction: 'f1' }` 的真假對。
- 修理：診所扣兩成之後那一件恢復生效；自己修失敗時還是壞的、時間照過。
- 小手術：把義臂的板材換成護甲值高 1 的那一塊，`armor` 多 1、舊的那一塊在背包；換成類型不對的零件被擋並是 `slotProblems` 的那一句；換了一個 `stats.sink: -2` 的神經元之後 `sink_floor` 少 2。
- `npm test`、`npx tsc --noEmit`、分層檢查全過。

## 依賴

M4-cyber-battle 之後（同一個資料夾）。M4-security-m4、M4-followups 要它的效果。

## 完成時回報

改了哪些檔、測試結果、契約義體（`lock.kind: 'contract'`）目前只有哪些行為、CYBERWARE 第 5 節的三種解鎖方法裡「請潛網者偽造授權」只留了 `cyber_unlock` 這個出口。
