# M3-ui-subnet

- 交給：cpp-ui（sonnet）
- 目標：子網地圖的畫面接上引擎：地圖、迷霧、節點、巡邏、層、追蹤度、這一格與旁邊能做的事、登出，全部讀引擎；舊的 `stores/subnet.ts` 與 `data/subnet.ts` 拿掉。
- 規格出處：docs/art/UI.md 第 5 節（子網那一半與表）、1.1 節規則 4、「到了就看得到選單、按 E 才做」、「移動與快捷鍵」；CYBERSPACE 8.1 節的「節點」表（每一種節點叫什麼）；dev/adr/0018 第五、六、七、十二節與 N5～N8、N23；dev/work/M3-netrun.md、M3-netrun-nodes.md 的「新的格式與鍵」與匯出的 `netrunView`。
- 可以改的路徑：`ui/src/screens/SubnetScreen.vue`、`ui/src/components/GridMap.vue`（只加網內節點的畫法）、`ui/src/lib/`（新增 `netrunView.ts`；`here.ts`、`useWalk.ts` 只加轉接）、`ui/src/stores/engine.ts`（只加轉接）、`ui/src/App.vue`、`ui/src/screens/MainScreen.vue` 與 `HomeScreen.vue`（「潛入」「子網」兩個假入口：第二波之前先灰掉並寫「還沒有開放。」）、`ui/tests/net/`；刪 `ui/src/stores/subnet.ts`、`ui/src/data/subnet.ts`。
- 可以用的介面：`Game.gridView`、`Game.gridMove`；`@engine/src/features/netrun` 的 `netrunView`、`useNode`、`logout`、`descend`；`Game.commit`／`commitNarrated`；引擎開戰之後 `App.vue` 現有的換頁。
- 不可以做的事：不改 `engine/`；巡邏怎麼走、陷阱、追蹤度、能不能做都讀引擎，畫面沒有任何一條規則；不自己記迷霧（讀 `gridView` 看過的格子）；共同的規定見 dev/work/M3-plan.md。

## 要做的

1. **地圖**：`GridMap` 畫引擎的 `gridView`；網內的格子種類各有圖示與顏色（沿用現在 `data/subnet.ts` 的 `NODE_INFO` 那一組圖示，搬到 `lib/netrunView.ts`，鍵改成引擎的種類：`net_gate`、`net_archive`、`net_control`、`net_foe`、`net_person`、`net_alarm`、`net_loop`、`net_puzzle`、`net_imprint`、`net_rest`、`net_safe`、入口；單向與會斷的鏈路各一個小記號）；處理過的節點打勾；巡邏是地圖上的代幣（位置讀 `netrunView`，只畫看得到的）；目標的節點加一個標。
2. **走路**：點格子尋路、方向鍵走一格、E 做這一格的預設選項，照主畫面街區圖的做法；被擋下時顯示引擎的原因。
3. **抬頭**：這座子網的名字、層的分頁（還沒到的層上鎖，不能點過去：換層只經由引擎的 `descend`）、追蹤度條（刻度 30、60、90，各寫那一段會發生什麼；被定位時顯示剩幾個探索回合）、探索回合數。
4. **右欄**：化身（每個隊員的感載、餘韻、同步上限）、這一格能做的事與**旁邊的遭遇節點**能做的事（開戰、潛行繞過、談……；灰掉的帶原因；預設選項黃框加 E 的鍵帽）、探索中的管理行動（有主控才有：破解、擦痕跡與這一層還能擦幾次）、目標與做到哪（下載的進度）、登出。
5. **登出**：委託副本裡的那一段，先跳確認框（引擎給的那一句：會回到進副本之前）；確認才送。
6. **開戰與回來**：選了開戰之後引擎開了戰鬥，`App.vue` 換到內海戰鬥；打完回到這一頁、地圖已經是引擎的新狀態。這一趟結束（引擎沒有進行中的 `face.net` 或 `netrun`）時離開這一頁：委託的那一段回副本頁，其餘回主畫面。
7. 沒有進行中的行程時打開 `/subnet`：顯示一句話與回去的按鈕（不再有假的藍鯨物流）。

## 驗收條件（`ui/tests/net/M3-ui-subnet.test.ts`；用引擎真的 `netrun`，區與蕾絲用測試自帶的資料，用玩具活動當成副本開一段 `face.net`）

- 畫面上的格子、看過的範圍、站的位置和 `gridView` 一樣；沒看過的格子不畫節點。
- 走一步：引擎的位置變了、畫面跟著；走到節點格，探索回合 +1（顯示的數字等於 `netrunView`）。
- 站在遭遇節點旁邊：右欄有開戰與潛行繞過；選開戰之後換到內海戰鬥，打贏回來那個節點是鏈路的樣子。
- 追蹤度條的值與刻度對；用效果推到 90 之後顯示倒數。
- 下載的目標：按三次「繼續下載」進度滿、這一趟結束、回到發起的那一頁。
- 登出跳確認框，取消不送、確認才送。
- 巡邏的代幣在引擎說的位置、看不到的時候不畫。
- 掃原始碼：`ui/src` 沒有任何檔 import `stores/subnet`、`data/subnet`，兩個檔不存在；`SubnetScreen.vue` 沒有 `addTrace`、`movePatrols` 這類自己算的函式。
- `npm test` 與 `vue-tsc` 全過。

## 依賴

M3-netrun、M3-netrun-nodes。排在 M3-ui-deck 之後。

## 完成時回報

改了哪些檔、刪掉的舊程式清單、測試結果、UI 第 5 節裡因為引擎還沒有而沒顯示的東西。
