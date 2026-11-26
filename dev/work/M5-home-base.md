# M5-home-base

- 交給：cpp-feature（sonnet）　（**第二波**；這一張會動到兩個核心路徑的檔與介面的 import，各只改 import 與呼叫的名字，派工時由總指揮明說放行，見「可以改的路徑」）
- 目標：新功能 `home` 的第一塊：接手 `rest` 管的住處（租、退、房租、欠繳與換鎖），擴成「一個家加最多兩處安全屋」，加上買斷、押金、搬家、升級與工期、改裝五種；進門時把家開成一張格子地圖的實例、出門時關掉。家具、住戶、店面在後三張。
- 規格出處：DOWNTIME 7.1、7.2、7.3 節、7.4 節的前三條（地圖大小、房間是畫好的區域、升級往外長）、第 5 節（房租與管理費在帳單的哪一項、欠繳）、第 8、9 節；FIXER 第 9 節；UI 第 12 節（抬頭與安全屋那幾列要什麼）；dev/adr/0020 第十節、V46、V47、D6；dev/adr/0019 第十四節（條件 `at_home` 的 `level_min`）；dev/work/M2-rest-housing.md（現在的住處怎麼做的）、M5-core-seams.md（家的地圖種類）。
- 可以改的路徑：`engine/src/features/home/`（新）、`engine/src/features/rest/`（住處的部分搬走）、`engine/src/features/explore/`（只加「家的地圖上不作用」）、`engine/src/features/index.ts`、`engine/tests/features/M5-home-base.test.ts`、`engine/tests/fixtures/saves/`（加一份有 `ext.rest.home` 的舊檔）；**因為換了主人而要跟著改 import 與功能清單的檔（只改這兩樣，行為與斷言不變；改了哪些列在回報）**：`engine/tests/` 裡 import `features/rest` 住處入口、或只裝 `restFeature` 就問 `at_home`／`has_home` 的測試（2026-11-26 是這些：`features/M2-rest-housing`、`M2-rest.boundary`、`M2-fuzzplay.whitebox`、`M2-misuse.whitebox`、`M2-ext-corrupt.whitebox`、`M4-craft`、`M4-followups`、`M4-medical`、`M4-sink`、`smoke/m2`、`smoke/m4-contract`，動手前自己再 grep 一次）、`engine/src/testkit/scenarios.ts` 與 `steps.ts`（各一行 `rentDraft` 的 import）、`ui/src/stores/engine.ts` 與 `ui/src/data/demo/`、`ui/tests/`（只修 import 與型別讓 `npm test`、`vue-tsc` 照樣過，不做畫面：畫面是 M5-ui-home）。
- 可以用的介面：核心的 `openMap`、`closeMap`、`gridHere`、`isHomeMapKind`、`map.at`、`map.sheet`、`map.ext`；`k.grid.usesOf`、`onEnter`；掛點 `bill.collect`、`bill.settled`；掛鉤 `save.loaded`、`game.new`、`time.passed`（工期）；`k.conditions.register`；`cred`、`cash`、`time`、`location` 變更；`k.content`（`residence`、`block`、`facility_type`、`special_map`）；條件 `in_block`、`at_facility`；量表的效果 `favor`（屋頂村要野良好感 20：住處資料的 `requires`）。
- 不可以做的事：不 import `features/rest`、`features/world`、`features/bills`；不讀 `rest` 的 `state.ext`（唯一的例外是 `save.loaded` 的搬家：那是存檔的格式，讀一次、搬完就清掉）；不寫家具、舒適度、儲物、住戶、訪客、店面；等級 0 的地方（愛情旅館、膠囊）不是住處，照舊是設施的睡覺服務（V46）；假身分租只算隱蔽 +2（V50）；共同的規定見 dev/work/M5-plan.md。

## 新的格式與鍵

- 內容種類 `residence`（從 `rest` 接手；原本的欄位照收）多：`max_level`、`buy?: number | null`、`conceal`、`comfort?`（住處自帶）、`pay: 'cred' | 'cash' | 'either' | 'favor'`、`requires?: 條件`、`shop_ok?: string[]`（能開哪幾種店面）、`garage?: boolean`、`layouts: Record<'1' | '2' | '3', special_map 的 id>`。資料的檢查：每一級的版面要存在、`kind` 是 `home`、高一級的版面包含低一級的（左上角對齊、低一級的每一格在高一級是同一種格子；V47）、每張有一個 `E`（大門）。
- 內容種類 `home_rule`（`overridable`，id `default`）：買斷 = 週租 × 60、管理費 10%、賣回 70%、押金兩週、搬家（自己 8 小時、請人每件 50 與半天）、升級的費用與工期（1→2：3,000、5 天；2→3：頂讓 10,000、10 天）、各級的住戶與家務上限（下一張用）、安全屋最多幾處（2）、欠繳幾週換鎖（照 `rest` 現在的 2）。`rest_rule` 現在管住處的三個鍵（`deposit_weeks`、`lock_weeks`、`rent_order`）搬到這裡；`home_rates`（各級住處睡一覺的回復率）留在 `rest_rule`。
- 內容種類 `home_mod`（`overridable`）：五筆（`hidden` 暗格、`shield` 訊號屏蔽、`power` 獨立電源、`door` 加固門、`camera` 監視器），各自的費用、工期、效果的鍵。
- 狀態 `state.ext.home`：`{ bases: Record<id, Base>, main: id | null, seq, inside: { base, map: 地圖實例 id, back: GridPos | null } | null }`。`Base`（照 DOWNTIME 第 9 節的樣本）：`{ id, residence, district, block, facility?, level, max_level, home: boolean, owned, rent_weekly, deposit, pool, arrears, locked, conceal, mods: string[], exposed_to: string[], fake_id?: boolean, construction: { to: number | string, done_at: 總分鐘 } | null }`（家具、人、店面的欄位後三張加）。
- 條件（從 `rest` 接手，行為不變）：`has_home`（有任何一處）、`at_home { level_min?, use?, base? }`（站在自己住處的設施上，或在那一處的地圖裡；**不寫 `base` 是任何一處，家或安全屋都算**，`base: 'main'` 只認家；`level_min` 是 M4 加的，看的是人所在那一處的等級，**要保留**；`use` 這一張先收格式、一律不成立，下一張實作）、`home_level { min?, max? }`（家的等級）。`test` 要是唯讀的純函式：M4 的契約會在一份推演的狀態上問它（宵禁，`features/contract/time.ts`）。
- 報告（kind `downtime`；買賣是 `deal`）：`home.rent`、`home.leave`、`home.buy`、`home.sell`、`home.move`（搬家：把哪一處設成家）、`home.upgrade`、`home.mod`、`home.enter`、`home.exit`、`home.built`（施工完成）。
- 匯出：`homeView(k, state)`（每一處：名字、所在、等級與上限、家或安全屋、週租與付哪種錢、隱蔽、改裝、施工中、欠繳與鎖）、`listings(k, state)`（現在這裡租得到的與原因）、`rent`、`leave`、`buy`、`sell`、`setMain`、`upgrade`、`addMod`、`enter`、`exit`、各自的 `…Block`、`readHome`、`mainBase`、`concealOf`。

## 要做的

1. **接手**：`rest` 裡住處的狀態、`residence` 這種內容、`home.rent`／`home.leave`、`bill.collect` 的房租、欠繳與換鎖、條件 `has_home`／`at_home`、開局送的住處，搬到 `home`。`rest` 留下喘口氣與睡一覺：它問條件 `at_home` 決定「睡在自己的住處」（`sleepOptions` 的 `home` 那一項），那一處的等級用 `at_home { level_min: 3 }`、`2`、`1` 由高往低問出來、照 `rest_rule.home_rates` 查回復率，名字用站著的設施的名字；`at_home` 沒有人註冊時就沒有 `home` 那一項。`rest` 另外定義衍生數值 `sleep_recover_pct`（基礎 0；睡一覺的回復率再加這麼多個百分點），讓 home 的舒適度與 M4 的被動效果（藥：`testkit/drugCatalog.ts` 的 `DRUG_GAPS` 列的「睡覺回復率」）都寫得進來。`FEATURES` 裡 `homeFeature` 排在 `restFeature` 前面。
   - **入口的名字不換**：`home` 匯出和 `rest` 現在同名的 `rentDraft`、`rentBlock`、`leaveDraft`、`leaveBlock`、`homeOf`、`depositOf`、`residencePools`、`standingAt`（下面「匯出」列的 `rent`、`leave` 是它們的別名），所以測試、testkit 與介面只要把 import 的路徑從 `features/rest` 換成 `features/home`、kernel 的功能清單加上 `homeFeature`。
2. **舊存檔**（`save.loaded`）：狀態裡有 `ext.rest.home` 而 `ext.home` 還沒有時，把那一處搬成一個家（等級、押金、欠繳、鎖照舊），並把 `ext.rest.home` 清成 `null`。
3. **多處**：一個家（`main`）加最多兩處安全屋；每一處各付房租（`bill.collect` 各一筆；買斷的付管理費）。安全屋的 `home` 是 `false`。`setMain` 把另一處設成家（自己搬 8 小時；請人搬的費用要看家具件數，這一張先當 0 件）。
4. **租、退、買、賣**：押金兩週、退租時退（欠繳的先扣）；買斷與賣回照規則；付哪一種錢照住處的 `pay`（`favor` 的先擋下：「這個地方要用人情付，還沒有開放。」）；`requires` 不成立租不到（原因）。
5. **升級**：住處的上限夠、付得起；工期內新的房間不能用（`construction`），到期（`time.passed`）發一份 `home.built`、等級 +1；人在裡面時把地圖實例換成新一級的版面（位置不動）。2→3 要選店面的種類（這一張只收一個字串、存著，M5-shop 用）。
6. **改裝**：一項一項加，費用與工期照表；隱蔽 = 住處的 ＋ 訊號屏蔽 1 ＋ 假身分 2，上限 6（`concealOf`）。
7. **進門與出門**：站在自己住處的設施上，`usesOf` 多一項「回家」（鎖著的灰掉：「門鎖被換掉了，付清欠的房租才開。」）；`enter` 開那一級版面的實例（`owner` 是住處的 id、`ext.home: { base, level }`）、站到大門、記下原本在街區的位置；`exit`（站在大門 `E` 上才做得了，`usesOf` 列「出門」）關掉實例、站回去。`location` 不變（人還是在那個設施）。在家的地圖上走路不花時間、不發街頭的觸發點；進門那一份報告帶觸發點 `home`（EVENTS 3.1）。
8. **explore**：它的每一個 `onEnter`、`onMark`、`usesOf`、`passRule` 在 `isHomeMapKind(ctx.map.kind)` 時直接略過。
9. 補繳：欠繳時付清（`payArrears`），門鎖立刻打開（status 裡 `rest` 沒做的那一條）。

## 驗收條件（`engine/tests/features/M5-home-base.test.ts`；測試自帶兩個住處（一個 1→2、一個 2→3）與它們的版面、一塊街區）

- M2 的住處測試在換了主人之後行為不變（租、付房租、在那裡睡、退租、欠兩週換鎖）。
- 舊存檔：讀進來之後 `homeView` 有那一處、是家、押金與欠繳對；`ext.rest.home` 是 `null`；再存再讀不會搬第二次。
- 租第二、第三處是安全屋；第四處被擋（原因）；每週帳單有三筆房租。
- 買斷：價錢 = 週租 × 60；之後帳單是管理費；賣回 70%。
- 升級：錢不夠、上限不夠各被擋；工期內等級還是舊的、`construction` 有值；五天後多一份 `home.built`、等級 +1。
- 版面的檢查：高一級沒有包含低一級的被擋並指出是哪一格。
- 改裝：加訊號屏蔽隱蔽 +1；上限 6。
- 進門：`maps.at` 在家的實例的大門上、街區的實例還在；出門：回到原本那一格、家的實例關了；鎖著時進不去。
- 在家的地圖上走十格：時間沒變、報告沒有 `walk` 觸發點；探索的監視器與巡邏的規則沒有被呼叫（用探針確認）。
- 條件：`at_home` 站在設施上與在地圖裡都成立；`at_home { level_min: 2 }` 在一級的家不成立、升級之後成立；`has_home`。
- 補繳之後門鎖打開。
- `rest`、`bills`、`dive`、`work` 的既有測試全過（改了的地方列出來）；M4 讀 `at_home`／`has_home` 的每一個功能的測試全過：`craft`（自己組裝，`level_min`）、`cyberware`（自己動刀、自己修）、`medical`、`deck`（改化身）、`gear`（自己染）、`abilities`（配置）、`contract`（宵禁、持約人「他住在據點」）；`npm test`、`npx tsc --noEmit`、分層檢查全過；`ui` 的 `npm test` 與 `vue-tsc` 全過。
- `at_home` 在安全屋也成立；`at_home { base: 'main' }` 在安全屋不成立；在一份複製的狀態上問不會改到它（前後逐位元組相同）。
- 睡在二級的家：`sleepOptions` 的 `home` 那一項回復率是 `home_rates` 的二級；`sleep_recover_pct` 用測試的 provider 給 10 時回復多一成；沒有裝 `home` 的局沒有 `home` 那一項、其餘照舊。

## 依賴

M5-core-seams（家的地圖種類）。做的時候不要有別的工單在改 `features/rest`、`features/explore`，也不要有介面的工單在跑（這一張會碰 `ui/src/stores/engine.ts` 的 import）。

## M4 對帳（2026-11-26）

- **影響面比 M4 之前大**：M4 有七個功能讀 `at_home`／`has_home`（上面驗收列的），它們的測試有好幾份直接 import `features/rest` 的 `rentDraft` 當「先租一個家」；testkit（核心路徑）的 `scenarios.ts`、`steps.ts` 與介面的 store 也是。所以這一張定了「入口的名字不換」，把這次搬家壓成只換 import 的路徑。
- **`dive` 不認住處**：它只認帶 `dive` 欄位的設施（`features/dive/ops.ts`）。「從家裡潛入」要等接入艙（M5-home-furnish 的 `home_use`）與 M5-home-links。同樣地，自己組裝、自己修義體現在是用「住處二級以上」代替「有工作台」（`craft_rule.self_home_level`、`cyber_rule.repair_home_level`）：這一張不改它們，換成看家具是 M5-home-links。
- **睡一覺的計數器**：`rest` 在睡一覺的報告上寫 `sleeps:<週>`（`features/sink` 週一讀它算沉溺的自然下降）。這一條留在 `rest`，不要搬。
- `rest` 睡在自己住處時帶的觸發點 `home`、長休醒來的 `rest`（M4 冒煙確認過蠱惑的事件靠它）照舊由 `rest` 發；進門的 `home` 是這一張發的，兩個是不同的時機。
- 新註冊的條件，如果條件的登錄表已經有「說明句」的欄位（M4 收尾修正批；以 0019 末尾的補記為準），要一起寫。

## 完成時回報

改了哪些檔、測試結果、改了哪些既有測試與為什麼、跟著改 import 的檔案清單、V46、V47 對不上的地方。
