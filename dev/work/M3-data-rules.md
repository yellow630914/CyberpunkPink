# M3-data-rules

- 交給：cpp-data（sonnet）
- 目標：把 M3 各功能的規則數字寫成資料檔（只有規則表，不含任何內容），補上內海用的戰場、狀態與事件範圍的觸發點。
- 規格出處（每一張表對一處）：CYBERSPACE 6.1～6.8 節（戰場的差別、RAM、同步、追蹤度）、8.1 節（密度表的一般子網與迷宮館兩列、DC 照等級、陷阱）、8.2 節（組別、標準回合數、評價）、8.3 節（設施類型的表、追蹤度在子網裡）；CORE_RULES 第 5 節；NETRUNNING 第 5 節；ENEMIES 1.5 節的內海表；ITEMS 11.1 節（構裝等級的加值）、5.2 節（腳本的上限）；EVENTS 3.3 節的表（子網與內海那一列）；dev/adr/0018 第十四節（N 的暫定值照表寫，檔案的說明欄標「暫定」與編號）。
- 可以改的路徑：`engine/data/rules/`（新增檔案；`battle_modes.json`、`battle_statuses.json`、`event_scopes.json` 只加）、`engine/data/index.ts`、`engine/tests/data/M3-data-rules.test.ts`。
- 不可以做的事：不寫內容（甲板、構裝、SKIN、快駭程式、蕾絲、詞條、設施類型以外的子網資料、迷宮館的主題與獎品都不是這一張的；`net_facility` 的六種設施類型算規則表，寫）；不改現有規則表的數字；不改 `engine/src`（功能的預設和設計書對不上時停下來回報，不要自己挑一邊）；共同的規定見 dev/work/M3-plan.md。

## 要做的

1. `battle_modes.json` 加 `net` 一筆（和核心的預設逐欄相同，含 `attr_as`、`guard_stat`、`leave`）；`meat` 補 `guard_stat`。
2. `battle_statuses.json` 加內海用到的：`flash`（和核心內建的一致）、`jam_weapon`、`jam_defense`、`jam_tool`、標記（到下次過載）、「不攻擊」（安撫）、脫鉤衝擊的暈眩用現有的。
3. 每個功能開的規則種類各寫一個檔（檔名與 id 照各功能匯出的名字）：`sync_rule`、`deck_rule`、`netcombat_rule`、`netrun_rule`、`net_region`（`subnet` 一筆；`maze`、`wreck`、`deep` 三筆只照設計書的密度與壓力條寫，程式現在只讀前兩種）、`net_facility`（六種）、`maze_rule`（第二波有做才寫）、`commission_rule` 與 `fixer_rule` 加 M3 的欄位。
4. `event_scopes.json` 的 `net` 加 `login`、`logout` 各 0.1（EVENTS 3.3）。
5. `engine/data/index.ts` 把新檔接進規則的那一包。

## 驗收條件（`engine/tests/data/M3-data-rules.test.ts`）

- 帶著全部功能載入整包資料沒有錯；每個新檔至少被一個功能讀到（沒有人認得的種類列在回報裡）。
- **資料和功能的預設一致**：每一張表逐格和那個功能（或核心）匯出的 `DEFAULT_…` 比，一樣才過。
- **兩邊各有一份的數字相同**：`netcombat_rule` 與 `netrun_rule` 的三個門檻（30、60、90）與定位的回合數（3）。
- 抽查設計書的數字（每張表至少三格）：同步四檔 −2／×0.5、0／×1、+2／×1.5、+4／×2.5；回填 +2；戰鬥每回合追蹤度 +3、管理行動 +1、失敗 +5、白蕾絲 +5；警報節點 +10、下載每回合 +2；一般子網 11 × 9、`carve` 30～40、遭遇 2～3；迷宮館 9 × 7、18～24；DC 10、13、16、19、22；六種設施類型的層；構裝 III 級多 1 顆骰；腳本「甲板等級 ＋1」支。
- 現有的資料測試原樣全過。

## 依賴

引擎的功能都做完之後（第一波做完就可以先寫第一波的；第二波的表等第二波）。

## 完成時回報

加了哪些檔、測試結果、功能的預設和設計書對不上的地方（逐條：哪一格、兩邊各是多少）、標了「暫定」的格子清單。
