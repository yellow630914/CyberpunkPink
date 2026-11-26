# M5-home-furnish

- 交給：cpp-feature（sonnet）　（**第二波**）
- 目標：`home` 的第二塊：家具（物品的 `furniture` 欄位）、擺放與檢查、房間的用途、舒適度與它對睡一覺的效果、儲物（箱子、保險箱、暗格）。擺放的純邏輯從 `ui/src/lib/home.ts` 搬進引擎，逐條對設計書。
- 規格出處：DOWNTIME 7.1 節的表（每間的家具位）、7.4 節（全部）、7.5、7.6、7.7 節、第 8 節（擺設與存取不出報告）；UI 第 12 節、1.1 節規則 3；dev/adr/0020 第十節、V47～V49、D6、D7；`ui/src/lib/home.ts` 與 `home.test.ts`（現有的邏輯與測試案例：`validatePlacement`、`deriveRooms`、`comfort`、`storage`；設計書和它不一樣時照設計書並回報）；dev/work/M5-home-base.md。
- 可以改的路徑：`engine/src/features/home/`、`engine/tests/features/M5-home-furnish.test.ts`。
- 可以用的介面：上一張的狀態與入口；核心的 `Sheet`（`zoneAt`、`walkable`、`reachable`）、`map.sheet` 的補丁（格子種類 `furniture`）；`item` 變更（`data.uid` 指定哪一疊）、`cash` 變更；掛鉤 `rest.done`；`k.stats.defineStat`／`addStatProvider`；`actor.condition` 變更；`k.content`（`item` 的 `furniture` 欄位）；`state.rules.contentOff`（遊戲間）。
- 不可以做的事：不 import 別的功能；不 import `ui/`（把邏輯搬過來，不是引用）；住戶、家務、訪客的效果不寫（舒適度裡「住戶與家務」那一項先收一個數字的入口，下一張給）；車庫只留條件（機甲在 M6）；培養槽、植物澆水不做；共同的規定見 dev/work/M5-plan.md。

## 新的格式與鍵

- 物品的 `furniture` 欄位（DOWNTIME 7.5）：`{ function: 功能 | 功能[], beds?, comfort, style?, size: [寬, 高], rooms?: string[]（只能放的房間種類：`garage`、`store`）, storage?: 種數, safe?: boolean, seats?, fixed?: boolean, adult?: boolean }`。功能的字彙：`bed`、`workbench`、`surgery`、`netpod`、`stream`、`storage`、`safe`、`restraint`、`mechrack`、`kitchen`、`seat`、`decor`、`charger`、`tank`。
- 家的版面（`special_map`、`kind: 'home'`）多讀：`rooms: Record<區塊的字母, { name, slots, fixed_use?, garage?, store? }>`（房間是版面 `zones` 的區塊；沒有列在 `rooms` 的區塊是走廊）。
- `home_rule` 多：用途九種的條件與順序（車庫、診療室、接入室、工作間、攝影間、遊戲間、倉庫、客房、臥室）、舒適度三段的門檻與效果（6、12、20）、套組（同風格 4 件 +2）、擁擠（每多一人 −2）、倉庫的容量 +25%、每一級每間的家具位（主室 6、浴廁 2、前場 8）。
- `Base` 多：`furniture: Array<{ uid, item, sheet, x, y, rot: 0 | 90 | 180 | 270 }>`、`rooms: Record<區塊, { use?: string }>`（玩家改選的用途）、`stash: Record<家具的 uid | 'hidden', ItemStack[]>`、`safe_cash: number`。
- 衍生數值（這一張定義）：`home_beds`（床位）、`home_comfort`；對 `sleep_recover_pct`（`rest` 定義的，M5-home-base）加 provider（這一次睡一覺回復率的加成，0、10、20、30）；對 `studio_slots` 加 provider（有攝影間 1；沒有 0；店面的轉播站由 M5-shop 給 2）。身上有 `rested_*` 時：對 `load_cap`（`features/character` 定義的衍生數值）加 provider；「定力」是基本功 `composure`（不是衍生數值），用 `k.stats.addCheckModifier` 對它的檢定加（M4 的沉溺分段就是對同一個基本功加減：`features/sink/model.ts`）。
- 狀況（`actor.conditions`，到下次睡一覺）：`rested_1`、`rested_2`、`rested_3`。
- 條件：`home_use { use, base? }`、`at_home` 的 `use`（上一張留的）、`home_has_item { item, qty? }`。效果：`home_take { item, qty }`（從箱子拿走，內建的來源才收）。
- 擺設與存取不出報告（DOWNTIME 第 8 節）：它們是「不進紀錄的提交」嗎？引擎沒有這種東西——做成一般的報告 `home.place`、`home.stash`，kind `system`，摘要一句；回報這一點。
- 匯出：`placeCheck(k, state, { item | uid, sheet, x, y, rot })`（放得下或原因）、`place`、`move`、`rotate`、`pickUp`、`roomsView`（每間：名字、格數、家具幾件／家具位、滿足的用途、現在的用途）、`setRoomUse`、`comfortView`（拆解：家具、套組、臥室、住處自帶、住戶與家務、擁擠、合計、哪一段、離下一段多少）、`stashView`、`stashPut`、`stashTake`、`hereUses(k, state)`（站在家具旁邊能做的事：睡一覺、打開箱子、打開頻道、組裝、潛入；只列入口的 id，做是別的功能的事）。

## 要做的

1. **擺放的檢查**（DOWNTIME 7.4「擺得下才放得下」，一條一個原因）：整件在同一間房的地板上；不壓牆、不擋門與大門、不放走廊；不疊在別的家具上；不壓在主角站的那一格；那一間的件數不超過家具位（`fixed` 的不算）；限定房間的家具只能放在那種房間；放下之後每一格沒被佔住的地板都還要從大門走得到（「會把路堵死。」）。施工中的新區域不能擺。
2. **擺、搬、轉、收**：擺是把背包裡的那一件拿走、記進 `furniture`；收是放回背包（箱子裡有東西的不能收：「先把裡面的東西拿出來。」）。人在那一處的地圖裡時，同一份報告用 `map.sheet` 的補丁把那幾格換成 `furniture` 或還原。進門時（上一張的 `enter`）把所有家具的格子一次補上。
3. **用途**：照房間裡家具的功能推（條件照規則表）；同時滿足好幾種時預設最專門的，玩家可以從滿足的裡面改選；條件不再滿足時改選的失效；浴廁這類 `fixed_use` 寫死。每一種用途可以在規則表寫 `tags`，經核心的 `tagsAllowed(state.rules, tags)`：被關掉的不出現。遊戲間預設帶 `contract_dom`（契約支配；DOWNTIME 7.4 只寫「篩選關掉時這個用途不出現」，沒說是哪一項，0020 V59 暫定）。客房的條件裡「有住戶或留宿的訪客睡在這間」下一張才有資料，這一張先留入口。
4. **舒適度**（7.6 的式子）：家具的舒適合計 ＋ 套組 ＋ 臥室（每間算一張床 +1）＋ 住處自帶 ＋ 住戶與家務（入口）− 擁擠。
5. **睡一覺**（聽 `rest.done`，`kind: 'sleep'`；人在家——條件 `at_home` 對那一處成立，而且那一處有床）：照舒適度的段給 `rested_*`（先拿掉舊的）；`sleep_recover_pct` 讓 `rest` 在這一次的回復上加成（`rest` 已經在 M5-home-base 讀它）；「安穩」每週沉溺自然下降再 −1：`features/sink` 的自然下降現在是「上一週的計數器 `sleeps:<週>` 滿 `decay.sleeps` 次就 −`decay.amount`」，沒有別人加碼的入口，所以這一張只寫一個同樣編號的計數器 `snug:<週>`（在安穩的家睡一覺 +1；週的編號照 `rest` 寫 `sleeps:<週>` 的那一個算法），讓 sink 讀它是 M5-home-links 的事。
6. **儲物**：每件儲物家具一格，容量以「種」算（物品 id 加實例資料不同算不同種，V49）、數量不限；倉庫用途的房間容量 +25%（捨去）；保險箱 6 種而且可以放現金晶片（`safe_cash`，不算身上的錢）；暗格是改裝，4 種；零級沒有儲物。存取要人在那一處的地圖裡、站在那件家具旁邊（暗格與保險箱不必站旁邊？——照設計書沒寫，先都要站旁邊；暗格在大門以外任何一格都行）。
7. `hereUses`：站在家具的四鄰格時列它的行動 id（`sleep`、`stash`、`channel`、`craft`、`surgery`、`dive`），讓介面與別的功能接；這一張不做那些事。

## 驗收條件（`engine/tests/features/M5-home-furnish.test.ts`；測試自帶 11 × 8 兩間房的版面、十件家具的物品）

- 擺放檢查的每一條各一個例子，原因的句子對；`ui/src/lib/home.test.ts` 的案例搬過來的那幾個結果一樣（不一樣的列在回報）。
- 擺一張 2 × 2 的床：背包少一件、地圖上那四格走不過去、尋路繞開；轉 90 度的 1 × 2 佔地對調；收起來之後格子恢復。
- 家具位：主室第七件被擋；浴廁的固定設備不算。
- 用途：擺床 → 臥室；再擺工作台 → 預設工作間、可以改回臥室；搬走工作台 → 改選的失效。
- 舒適度：一組固定的擺設逐項對拆解；跨過 6、12、20 的段對。
- 在家睡一覺：舒適度 12 → 身上有 `rested_2`、`load_cap` +5、基本功 `composure` 的檢定 +1（別的基本功不加）；再睡一次在別的地方 → 拿掉。在安穩那一段的家睡一覺：計數器 `snug:<週>` +1。
- 內容篩選：關掉 `contract_dom` 時遊戲間不在「滿足的用途」裡，拘束類的家具照樣擺得下（只是推不出那個用途）。
- 儲物：12 種的置物箱放第 13 種被擋；同一種放一百個可以；染色不同的同一件算兩種；倉庫 +25%；保險箱放現金之後身上的現金少了、`safe_cash` 多了。
- 有東西的箱子不能收。
- `studio_slots`：擺了直播桌是 1、搬走是 0。
- `home_use { use: 'workshop' }` 在擺了工作台的那一處成立。
- 打到一半存檔讀回來，家具與箱子都在、地圖上的格子對。
- `npm test`、`npx tsc --noEmit`、分層檢查全過。

## 依賴

M5-home-base。

## M4 對帳（2026-11-26）

- **用途的下游都在 M4 的功能裡**，這一張只把條件與旗標做出來，不改它們：工作間（組裝難度 −1、換零件時間減半 → `craft`）、診療室（在家睡一覺算傷口處理過 → `rest` 的 `treated`；自己動刀 → `cyberware`、`medical`）、接入室（從家裡潛入 → `dive`）、在家組裝時箱子算背包的延伸（→ `craft`）。接上去是 M5-home-links。
- `hereUses` 列的入口 id 對到的東西 M4 之後都有了：`craft`（組裝）、`surgery`（自己動刀）、`dive`（潛入）、`sleep`（`rest`）、`channel`（M5-ui-channel）；另外「在住處就能做」而不靠家具的（技能配置 `abilities`、自己染色 `gear`、改化身 `deck`）不列在 `hereUses`，它們照舊只問 `at_home`。
- `rested_*` 與 `home_warmth` 是 `actor.conditions` 的共用狀況，不是 M4 的被動效果來源（那張清單是封閉的，沒有 `home`）：數字用 provider 與檢定修正給，不要去註冊 `k.passives`。
- 家具是帶 `furniture` 欄位的 `item`（不是設計圖的成品），不經 `gear` 與 `productOf`。

## 完成時回報

改了哪些檔、測試結果、和 `ui/src/lib/home.ts` 不一樣的地方（哪一邊照設計書）、擺設「不出報告」怎麼處理的、`home_use`、`home_has_item`、`home_take` 實際的格式（給 M5-home-links）。
