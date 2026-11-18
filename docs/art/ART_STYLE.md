# 美術風格與繪圖管線

> 上層：[GAME_DESIGN](../GAME_DESIGN.md)。依賴：[DISTRICTS](../world/DISTRICTS.md)（地圖）、[CORE_RULES](../systems/CORE_RULES.md)（三條軌的顏色語意）。
> 檔案：`docs/art/`（SVG 原稿）、`docs/mockups/`（HTML 樣稿與可以操作的 Demo）、`docs/art/preview/`（轉出來的 PNG，給人看的）、`tools/art/render.mjs`（轉檔）。

設計階段能畫的東西先畫出來：地圖、介面樣式、圖標。**人物圖與背景圖不在這裡做**——那是之後生圖管線的事（ElondiaRPG 的 PORTRAITS、BACKGROUNDS）。

## 1. 怎麼畫

所有圖都是**手寫的向量與網頁**，不靠生圖模型：

| 種類 | 格式 | 為什麼 |
|---|---|---|
| 地圖、示意圖、圖標 | SVG | 文字檔，可以進版本控制、可以逐行修改、之後能直接放進遊戲 |
| 介面樣稿 | HTML + CSS | 樣稿裡的 CSS 變數就是實作時要用的設計代幣，不用重做一次 |
| 預覽 | PNG | 由 `tools/art/render.mjs` 用無頭瀏覽器轉出，方便在任何地方看 |

```bash
node tools/art/render.mjs
```

不給參數時把 `docs/art/` 與 `docs/mockups/` 裡的 SVG、HTML 全部轉到 `docs/art/preview/`；也可以指定檔案。需要 Node 22 與 Playwright。

**改圖的流程**：改 SVG 或 HTML → 轉檔 → 看 PNG → 再改。預覽圖進版本控制，這樣在 GitHub 上直接看得到。

## 2. 目前有的圖

| 圖 | 原稿 | 預覽 | 說明 |
|---|---|---|---|
| 緋夜城地圖 v0 | [`art/city-map.svg`](city-map.svg) | [`art/preview/city-map.png`](preview/city-map.png) | 八個區的位置、城牆與城門、地鐵兩線、輕軌、巴士、渡輪、主要地標、地下層入口。示意圖，非比例 |
| 地圖規模 v0 | [`art/map-scale.svg`](map-scale.svg)（由 `tools/art/gen_scale.py` 產生） | [`art/preview/map-scale.png`](preview/map-scale.png) | 一塊街區的格子樣本（蜂巢・天井市場，13×9）與八個區的 39 塊街區 |
| 街區結構 v0 | [`art/district-blocks.svg`](district-blocks.svg)（由 `tools/art/gen_maps.py` 產生） | [`art/preview/district-blocks.png`](preview/district-blocks.png) | 八個區各自的街區、橋接區、要地與出口 |
| 內海結構 v0 | [`art/cyberspace.svg`](cyberspace.svg)（同上） | [`art/preview/cyberspace.png`](preview/cyberspace.png) | 網路空間的七個分區、粉牆、現實的接點 |
| 樣式規劃 v0 | [`mockups/style-guide.html`](../mockups/style-guide.html) | [`art/preview/style-guide.png`](preview/style-guide.png) | 色彩、三條軌的量條、按鈕與標籤、紀錄、字、圖標風格（24 個樣本） |
| 勢力圖 v0 | [`art/factions.svg`](factions.svg) | [`art/preview/factions.png`](preview/factions.png) | 勢力之間的關係示意，對應 [FACTIONS](../world/FACTIONS.md) 的草稿 |

**可以操作的 Demo**（HTML，直接用瀏覽器打開；它們是三個戰場畫面的現行參考，[UI](UI.md) 之後照它們重寫）：

| Demo | 檔案 | 內容 | 規則在哪 |
|---|---|---|---|
| 現實戰鬥 | [`mockups/combat-demo.html`](../mockups/combat-demo.html) | 四格對四格的站位、行動圓環、生命值與感載兩條量條 | [COMBAT_SYSTEM](../systems/COMBAT_SYSTEM.md) 第 10 節 |
| 內海戰鬥 | [`mockups/net-demo.html`](../mockups/net-demo.html) | 同一個站位版面，加上同步檔位與管理行動的按鈕 | [CYBERSPACE](../systems/CYBERSPACE.md) 第 6 節 |
| 輿論戰 | [`mockups/opinion-demo.html`](../mockups/opinion-demo.html) | 3×3 的棋盤、手牌、聲量與風向 | [OPINION](../systems/OPINION.md) 第 3、4、10 節 |

![緋夜城地圖](preview/city-map.png)

## 3. 視覺方向

**一句話**：深紫黑的底，粉色的光，斜切的角。

- **深色底**。緋夜城沒有白天，介面也沒有淺色模式（至少第一版沒有）。
- **粉是訊號，不是底色**。整個畫面的粉不超過一成。它只出現在三種地方：玩家現在該看的東西、感載、被選中的東西。到處都粉就等於沒有粉。
- **斜切一角**。面板與按鈕切掉右上與左下，不用圓角。這是整個介面的招牌形狀，也是賽博龐克題材的共通語言。
- **格線**。底圖有很淡的方格，像設計圖。地圖、面板、紀錄都坐在同一張格線上。
- **霓虹只給重要的東西**。發光（外暈）只用在標題、感載條、四十二番街。
- **不可愛**。世界裡滿是可愛的東西（吉祥物、女僕、偶像），但介面本身是冷的、工具性的——玩家是隔著一層終端機在看這座城市。可愛留給內容。

## 4. 顏色的語意

色票與代號在樣稿的 `:root` 裡。語意固定，不混用：

| 顏色 | 意思 |
|---|---|
| 紅 | 生命值、肉體傷害、危險 |
| 粉 | 感載、神經、主要動作、粉蕾絲 |
| 青 | 沉溺、海、冷的東西 |
| 金 | 行動點、錢、冠冕區與企業 |
| 薄荷 | RAM、網內、成功、地下層 |
| 紫 | 蜂巢、一般的強調 |
| 鏽橘 | 鏽帶、巴士、舊的東西 |

每個區有代表色（地圖上的那一組）。進入該區時，介面的強調色換成那個顏色——玩家不看地名也知道自己在哪。

## 5. 圖標

- 24 格、線寬 1.6、圓頭圓角、不填色。
- **每個圖標只有一筆是粉的**：那一筆是它的重點（槍手的準星中心、感載的波形、契約的鎖扣）。
- 16px 要認得出來，所以形狀要簡單：一個主體、最多兩個細節。
- 之後的圖標照這個規格補：基本功 18 個、義體部位 9 個、傷害類型 5 個（物理、熱能、電磁、神經、快感）、勢力徽記 29 個、設施。勢力徽記可以稍微破格（填色、用勢力自己的顏色）。

## 6. 之後要畫的

| 圖 | 用途 |
|---|---|
| 各區的街區圖 | 每區一張，比城市地圖細一級：街道、地標的實際位置、路口 |
| 地鐵路線圖 | 遊戲內的車站介面 |
| 主畫面樣稿 | 三欄佈局：地圖、紀錄、設施與人 |
| 潛入畫面樣稿 | 子網的節點圖。現實戰鬥、內海戰鬥與輿論戰的畫面已經有可以操作的 Demo（第 2 節），這三個不必另外畫靜態樣稿 |
| 成人場景、委託副本、技能樹的樣稿 | 這三個畫面還沒有 Demo；[UI](UI.md) 重寫時一起畫 |
| 義體部位圖 | 人形輪廓與九個部位的槽 |
| 勢力徽記 | 二十九個勢力各一個（十二家企業、十五個街頭勢力、市警、鎮溺隊）；主要勢力（八家企業、七個街頭勢力）優先，次要的之後。輿論戰棋盤的格子要用佔著它的勢力的圖案，所以這一項排在棋盤的樣式之前 |
