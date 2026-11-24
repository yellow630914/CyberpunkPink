# M3-core-grid

- 交給：cpp-architect 角色（sonnet；**改的是核心**，可以改 `engine/src/core/grid/`、`engine/src/core/types/grid.ts`、`engine/src/core/state/`（`map.open` 的驗證）、`engine/src/shell/save.ts`）
- 目標：照 dev/adr/0018 第五節，讓一份地圖實例可以自己帶定義（生成的地圖）、加上網內的格子種類與「這張地圖是網內的」的判斷、視野可以照圖設定；存檔升到第 4 版。
- 規格出處：dev/adr/0018 第五節與 N1、N26；dev/adr/0012；CYBERSPACE 8.1 節的「節點」表；UI 1.1 節規則 4；DATA 9.3 節（版面的格式不變）。
- 可以改的路徑：`engine/src/core/grid/model.ts`、`walk.ts`、`registry.ts`、`index.ts`、`engine/src/core/types/grid.ts`、`engine/src/core/state/coreChanges.ts`（`map.open`）、`engine/src/shell/save.ts`、`engine/tests/core/grid-m3.test.ts`、`engine/tests/fixtures/saves/`（加一份第 3 版的舊檔）、dev/invariants.md。
- 可以用的介面：`CELL_TRAITS`、`Sheet`、`sheetProblems`／`specialMapProblems`、`openMap`、`gridHere`、`gridWalk`、`gridView`、存檔的遷移掛點。
- 不可以做的事：不寫生成器（M3-core-mapgen）、不寫任何節點的規則（M3-netrun）；不改現有格子種類的性質與現實地圖的行為（`engine/tests/core/grid.test.ts` 與探索的測試原樣全過）；共同的規定見 dev/work/M3-plan.md。

## 新的型別與鍵

- `MapInstance.gen?: { map: SpecialMapEntry; seed: number; by: string }`：這份實例自己帶的定義（生成的）。有 `gen` 時 `def` 等於 `gen.map.id`，內容裡不必有這個 id。
- `instanceDef(k, instance): SpecialMapEntry`（有 `gen` 用它，沒有查內容）；`openMap(k, state, def, o)` 的 `def` 可以是 id 或整筆定義，`o` 多 `seed?`、`by?`。
- `NET_MAP_KINDS = ['subnet', 'maze', 'wreck', 'deep']`、`isNetMapKind(kind)`。
- `CELL_TRAITS` 加（標記是小寫字母）：`net_gate`（`g`）、`net_archive`（`a`）、`net_control`（`c`）、`net_foe`（`f`，走不上去、`locked`）、`net_person`（`p`）、`net_alarm`（`w`）、`net_loop`（`o`）、`net_puzzle`（`m`，走不上去、`locked`）、`net_imprint`（`i`）、`net_rest`（`r`）、`net_safe`（`b`）、`net_valve`（沒有標記，走不上去、`locked`）、`net_bridge`（沒有標記，走得上去）。全部看得穿。
- `NET_LEGEND`：生成器用的圖例（`#` 牆、`.` 地板、`E` 入口，上面每一種各一個字元：標記的字母本身，`net_valve` 用 `v`、`net_bridge` 用 `x`）。
- `SheetDef.sight?: number`（1～9）：這一張圖的視野半徑，蓋掉核心的預設；沒寫照舊。

## 要做的

1. `map.open` 收帶 `gen` 的實例：`gen.map` 要過 `specialMapProblems`（不合格整筆不收，訊息寫出問題）、`gen.map.id` 等於 `def`、`seed` 是安全整數。變更記進紀錄時不留整份定義（只留 id 與種子）。
2. `gridHere`、`gridWalk`、`gridView` 與核心裡其他「照實例找定義」的地方一律走 `instanceDef`。經 `GridCtx.map` 拿定義的功能不用改。
3. 網內的地圖（`isNetMapKind`）不要求遭遇點（和街區地圖同一個做法）；入口照舊認 `E` 或連接格。
4. 十三種新的格子：`markersInLayout` 照字母編號（`g1`、`a1`……），大寫與小寫各自編、互不相干；`locked` 的三種沒有人註冊放行規則時過不去（原因的句子：`net_foe`「有東西守在這個節點上。」、`net_puzzle`「這裡有一道機關擋著。」、`net_valve`「這條鏈路是單向的，從這一邊過不去。」；有人註冊就用他的）。放行規則拿到的 `ctx.at` 是現在站的那一格，功能靠它判斷從哪一邊來。
5. `sight`：`reveal` 與視野照這一張圖的 `sight`（有寫時）。
6. 存檔第 4 版：驗證認得 `gen`（形狀與 `specialMapProblems`）；第 3 版讀進來不用補東西；回歸用的舊檔 `v3-m2.json`（從現在的主幹存一份，帶一份委託的地圖實例與一份階段快照）。

## 驗收條件（`engine/tests/core/grid-m3.test.ts`）

- 用一筆測試自己寫的 11 × 9 定義（`kind: 'subnet'`，內容裡沒有它）開地圖：`gridView`、`gridMove` 照它走；存檔再讀接著走的結果一樣；`map.open` 帶缺一列的定義被擋，狀態不變。
- `kind: 'subnet'` 的地圖沒有遭遇點合格；`office_small` 沒有遭遇點照舊不合格。
- 每一種新格子走不走得上去、標記的字母、`locked` 與預設的句子各驗一次；同一張圖上有 `C` 也有 `c`，編出來是 `C1` 與 `c1`。
- 把 `net_foe` 那一格改成 `floor`（`map.sheet` 的 `cells`）之後走得過去、尋路會穿過它；改之前尋路會繞開（或走不到）。`net_bridge` 改成 `wall` 之後走不過去。
- 測試註冊一條 `net_valve` 的放行規則（從西邊來才放行）：從西邊過得去、從東邊被擋。
- `sight: 2` 的圖只揭開兩格以內；沒寫的圖照舊。
- 第 3 版的舊檔讀得進來、接著玩；帶 `gen` 的第 4 版存檔往返之後狀態一模一樣；快照（`snapshot.take`）裡帶著生成的地圖，回到快照之後還在。
- 現有的地圖與探索測試原樣全過；`npm test`、`npx tsc --noEmit`、分層檢查全過。

## 依賴

沒有（和 M3-core-battle 不同時做：兩張都要動 `core/index.ts` 與 dev/invariants.md）。做完才能開 M3-core-mapgen、M3-netrun。

## 完成時回報

改了哪些檔、測試結果、存檔第 4 版的遷移怎麼寫的、不變式加了哪幾條、ADR 做不到的地方。
