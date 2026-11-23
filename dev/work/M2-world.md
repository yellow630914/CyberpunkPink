# M2-world

- 交給：cpp-feature（sonnet）
- 目標：新功能 `world`：一座連在一起的城市。區、街區、橋接區、設施的資料；在街區圖上走、走到邊緣換到隔壁那一塊、走上設施；走路花時間並帶著事件的觸發點。
- 規格出處：DISTRICTS 1.1、1.2 節（一座連在一起的城市、橋接區）、1.3 節（街區與橋接區的大小）、1.4 節（日與夜）；DATA 第 12 節（設施的種類）；EVENTS 3.1 節（`enter_block`、`walk`、`enter_bridge`、`enter_facility`）；UI 1.1 節（到了看得到能做的事、按了才做）；dev/adr/0012（格子地圖）、0016 第二、六節與 G8。
- 可以改的路徑：`engine/src/features/world/`（新）、`engine/src/features/index.ts`、`engine/tests/features/M2-world.test.ts`。
- 可以用的介面：內容種類 `special_map`（街區的版面用同一種格式）、`k.grid.onEnter`／`usesOf`／`passRule`、`GridEffect`（`changes`、`triggers`、`stop`、`line`）、核心的 `map.open`、`map.at`、`location`、`time` 變更、`Game.gridMove`（測試用）、`k.effects.register`、`k.conditions.register`。
- 不可以做的事：公共交通（M2-transit）；每一種設施裡做什麼（各功能自己用 `usesOf` 接）；區域狀態、封鎖、追逐、要地；不改核心的格子引擎；共同的規定見 dev/work/M2-plan.md。

## 新的格式與鍵

- 內容種類 `district`：`{ id, name, grade, price_mult?, step_minutes?, blocks: [街區 id], factions?: [勢力 id] }`（核心的 `areaGrade` 已經在讀 `grade`；別的功能多讀的欄位照樣放這裡）。
- 內容種類 `block`：`{ id, district, name, kind: 'block' | 'bridge', map: 地圖 id, exits: { [標記 id]: { to: 街區 id, arrive: 標記 id } }, facilities: { [標記 id]: { type, name, npc?, open?: { time?, weekday? } } } }`。出口是版面上的 `E`，設施是版面上的 `F`（圖例由資料加）。
- 內容種類 `facility_type`：`{ id, name }`（清單是資料）。
- 狀態 `state.ext.world`：每一塊街區開過的地圖實例、去過的街區、走了幾格。位置本身是核心的 `state.maps.at` 與 `state.location`（`district`、`block`、`facility`）。
- 效果 `move`（`{ kind, block, at? }`：把人帶到一塊街區；EVENTS 2.4 節）。條件 `in_district`、`in_block`、`at_facility`（`{ types: [...] }`）。
- 報告：`world.arrive`。走路是核心的走一步（併進那一份）。

## 要做的

1. `arrive(k, state, block, at?)`：開（或沿用）那一塊的地圖實例、站到指定的標記、改 `location`；同一塊街區的實例整局只有一份（看過的格子留著）。
2. `onEnter`（只管自己開的實例）：每走進一格加時間（那一區的 `step_minutes`，沒寫照 G8）；每 10 格帶一個 `walk` 的觸發點；走上出口就換到隔壁那一塊（這一段路到這裡為止），帶 `enter_block` 或 `enter_bridge`；走上設施就把 `location.facility` 設成它並帶 `enter_facility`（`where` 帶設施的種類），離開那一格清掉。觸發點的 `where` 帶區、街區、設施的種類。
3. 設施的營業時間：不在時段或星期裡時，`usesOf` 給一項灰掉的「現在沒有開。」；開著的時候這個功能自己不列任何事（各功能自己列）。
4. 對外：`worldView(k, state)`（現在在哪一區哪一塊、這一塊的出口通到哪、這一塊的設施與開不開）、`cityGraph(k)`（區與街區怎麼連，給城市地圖用）。
5. 內容檢查：出口與設施的標記在版面上找得到、`to` 指得到、出口成對（從甲走到乙，乙也有回甲的出口）、每個區至少一塊街區。

## 驗收條件（測試自帶兩個區、三塊街區加一塊橋接區的假資料）

- `arrive` 之後 `location` 與站的格子都對；走到出口那一格之後人在隔壁那一塊的對應標記上，`location.block` 換了。
- 回到原本那一塊：是同一份實例，之前看過的格子還是看過的。
- 走 10 格時間多了 10 個 `step_minutes`；鏽帶那一區寫 2 的話是兩倍。
- 第 10 格的那一份報告帶 `walk`；換街區的帶 `enter_block`，走進橋接區的帶 `enter_bridge`；走上設施的帶 `enter_facility` 而且 `where.facility` 是那個種類。
- 走上設施時 `location.facility` 有值、條件 `at_facility` 成立；走開之後沒有。
- 不在營業時間的設施列出一項灰掉的並有原因。
- 效果 `move` 把人帶到指定的街區。
- 有 `commission` 的替身活動進行時，`world.arrive` 被擋下。
- 出口不成對、標記找不到的資料在載入時被擋並寫出是哪一筆。
- 存檔往返位置與看過的格子不變。

## 依賴

M2-core-activity（`triggers`）。M2-transit、M2-rest-housing、M2-ui-world 要它。

## 完成時回報

改了哪些檔、測試結果、DISTRICTS 1.2 節裡沒做的（預期：封鎖與繞路、追逐、地下層的入口）。
