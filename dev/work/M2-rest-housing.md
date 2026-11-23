# M2-rest-housing

- 交給：cpp-feature（sonnet）
- 目標：新功能 `rest`：喘口氣、睡一覺、睡在哪裡的差別；最小的住處：租一個地方、付房租、在那裡睡、退租。
- 規格出處：DOWNTIME 第 1 節、第 2 節全部（2.1 喘口氣、2.2 睡一覺、2.3 睡處的表）、7.1 節開頭與等級 0、1 的兩列、7.2 節的表與「押金」那一條（買斷、假身分租、搬家不做）、5.1 節房租那一列與 5.2 節「房租欠了兩週」；EVENTS 3.1 節（`rest`、`sleep_out`、`home`）；CORE_RULES 4.1、4.2 節；dev/adr/0016 第六節（`rest.done`）。
- 可以改的路徑：`engine/src/features/rest/`（新）、`engine/src/features/index.ts`、`engine/tests/features/M2-rest-housing.test.ts`。
- 可以用的介面：核心的 `actor.track`（生命、感載、餘韻）與 `time` 變更、`k.stats`（`max_hp`）、`rest.done` 的小函式、`k.hooks.on('bill.collect' | 'bill.settled' | 'game.new')`、`k.grid.usesOf`、`k.conditions.register`、`k.content`（`facility_type`）、報告的 `triggers`、`state.location`。
- 不可以做的事：治療、沉溺的消退、成癮（M4）；家園的地圖、家具、舒適度、儲物、住戶、訪客、安全屋（M5）；委託裡階段之間的喘口氣是 commission 的事；共同的規定見 dev/work/M2-plan.md。

## 新的格式與鍵

- 內容種類 `residence`：`{ id, name, district, block, facility?, level: 0 | 1 | 2 | 3, rent, cash_ok?: boolean | 'only', start? }`。
- 設施的種類多讀一個欄位：`facility_type.sleep: { rate, cost }`（潛艙店的隔間、膠囊旅館；露宿是規則裡的預設：10%、不花錢）。
- 狀態 `state.ext.rest`：上次睡一覺的時間、這之後喘過幾次氣、住處（哪一間、押金、欠了幾週房租、門鎖有沒有被換掉）。
- 條件 `has_home`、`at_home`、`slept_within`（`{ hours }`）。共用的狀況 id `treated`（傷口處理過；M2 只讀）。
- 報告：`rest.breath`、`rest.sleep`、`home.rent`、`home.leave`（kind `downtime`）。

## 要做的

1. 喘口氣（60 分鐘）：隊上每個人感載歸零、餘韻全消；生命回 2 ＋ mod(體格)（最少 1），兩次睡一覺之間只有前兩次會回；發 `rest.done`（`breath`）；帶觸發點 `rest`。
2. 睡一覺（480 分鐘）：距上次至少 16 小時，不到給原因；感載、餘韻歸零；生命回「上限 × 睡處的回復率」；生命低於一半而且身上沒有 `treated` 的人最多回到一半；發 `rest.done`（`sleep`）；帶觸發點 `rest`，露宿另帶 `sleep_out`，在自己的住處另帶 `home`。
3. 睡在哪：站在有 `sleep` 的設施上照它的回復率與價錢（付不出來給原因）；在自己的住處照等級（0 級 25%、1 級 55%、2 與 3 級 60%）；都不是就是露宿。`sleepOptions(k, state)` 把現在能選的列出來。
4. 住處：`rent`（付兩週押金；同時只有一個家）、`leave`（退押金）；`bill.collect` 回一筆房租（`order` 1；收現金的住處是 `either`）；`bill.settled` 裡房租沒付成就累計，欠到兩週門鎖被換掉（不能在那裡睡，付清才開）。
5. 開新局：內容裡有 `start` 的住處時，主角一開始就租著它（不收押金）。
6. 人站在自己住處的設施上時，`usesOf` 列出睡一覺與喘口氣。

## 驗收條件

- 喘口氣：時間 +60 分鐘、感載與餘韻是 0、體格 14 的人回 4 點；第三次喘口氣不回生命；睡過之後重新算。
- 睡一覺：上次睡完 10 小時再睡被擋並有原因；滿 16 小時可以。
- 上限 40 的人：露宿回 4、膠囊旅館回 10 並扣錢、1 級住處回 22。
- 生命 10／40 而且沒有 `treated`：睡在 1 級住處只回到 20；有 `treated` 回到 32。
- 三種觸發點各自出現在對的情況；`rest.done` 的處理函式被叫到、它回傳的變更在同一份報告裡。
- 租：押金是兩週房租、錢不夠被擋；退租拿回押金；第二個家被擋。
- 帳單裡有房租這一項；連兩週沒付：門鎖被換、`sleepOptions` 裡自己的住處灰掉並有原因；付清之後恢復。
- 開新局之後主角有起點的住處、`has_home` 成立。
- 有 `commission` 的替身活動進行時兩種休息都被擋。

## 依賴

M2-bills（兩個掛點）、M2-world（設施與 `at_facility`；沒有時 `sleepOptions` 只剩露宿與自己的住處）、M2-core-shell（`rest.done`）。

## 完成時回報

改了哪些檔、測試結果、DOWNTIME 第 2、7 節裡沒做的清單。
