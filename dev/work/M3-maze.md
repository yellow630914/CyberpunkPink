# M3-maze

- 交給：cpp-feature（sonnet）　（**第二波**）
- 目標：新功能 `maze`：迷宮館——報名（組別、押金、能用的構裝）、三層、機關、時間與評價、寶箱與獎品表、比賽籌碼、打輸只是斷線。它是生成器與「一趟網內的行程」的第二個使用者：只靠活動 `netrun`、`net_region` 的資料與掛點接上去，不 import `netrun`。
- 規格出處：CYBERSPACE 3.3 節（迷宮館）、8.1 節（密度表的迷宮館那一列、壓力條的表）、8.2 節（全部；主題、詞條與獎品的內容只看格式）；ENEMIES 第 9 節最後一列（迷宮館的遊戲敵人）；DATA 第 10 節（`maze` 那一列的欄位）；dev/adr/0018 第六節、第十三節的掛點表。
- 可以改的路徑：`engine/src/features/maze/`（新）、`engine/src/features/index.ts`、`engine/tests/features/M3-maze.test.ts`。
- 可以用的介面：活動 `netrun`（`launch`；`setup.region: 'maze'`）與它的 `activity.end`；掛點 `netrun.round`、`netrun.close`；`k.grid.passRule('net_puzzle')`／`usesOf`（只在 `ext.net.region` 是 `maze` 的地圖上）；地圖實例的 `ext.net`（只讀格式）與自己的 `ext.maze`；效果 `deck_rental`；`battle.field.safe`（經 `net_region` 的資料讓開戰的人帶上）；`cash`、`item` 變更；核心的檢定。
- 不可以做的事：不 import `features/netrun`、`features/deck`、`features/dive`；主題、館主、獎品、詞條的內容不寫（表是資料，測試自帶小表）；直播與觀看數不做（評價只看回合數與倒下的人數）；延長賽不做；共同的規定見 dev/work/M3-plan.md。

## 新的格式與鍵

- 內容種類 `maze_rule`（`overridable`）：組別（`rookie`、`open`、`unlimited`：等級、押金、破關獎金、能不能用自己的構裝、比賽甲板的 id）、每層的標準回合數（12、15、10）、評價的門檻與倍率（S ×1.5、A ×1.2、B ×1、C ×0.7）、機關失敗的感載（8）、寶箱怪的機率（0.1）、籌碼的價值（10）。
- 內容種類 `maze_table`（寶箱表與獎品表：`{ kind: 'chest' | 'prize', rows: [{ weight, give: 效果[] }] }`）。
- 迷宮館這一區的規則（格式同 `net_region` 的一筆；這個功能自己帶預設，開那一趟時整筆放在 `setup.region`，資料的 `maze_rule.region` 可以蓋掉）：9 × 7、`carve` 18～24、`pressure: 'none'`、`safe: true`（倒下不加沉溺）、每層 2 場遭遇、機關 1、寶箱 1～2、陷阱 0～1；第三層 1 場加館主。
- 狀態 `state.ext.maze`：`{ bracket, deposit, rounds: 每層用了幾回合[], downs, chips, origin }`。
- 報告：`maze.enter`（報名）、`maze.use`（解機關、開寶箱）、`maze.result`（結算）。
- 匯出：`brackets(k, state)`（每一組能不能報、為什麼不行）、`enter`、`mazeView`（回合數與標準、籌碼、預估的評價）。

## 要做的

1. **報名**：付押金（現金）；新手組一律用館方的比賽甲板與比賽版構裝（效果 `deck_rental`）；公開組可以用自己 I～II 級的；無差別組不限。一隊最多四人。`launch` 一趟 `netrun`（`region: 'maze'`、三層、等級照組別、`origin.by: 'maze'`）。
2. **機關**（`net_puzzle`）：擋路；站在旁邊可以解——介面、街頭直覺或體格三選一對 DC（照等級），成功那一格變成地板（開出近路或通往一個寶箱）；失敗解的人感載 +8（照等級乘），可以再試。
3. **寶箱**（這一區的檔案庫）：開一次擲寶箱表；一成是寶箱怪（開一場遭遇：兩個小兵）。
4. **時間**：聽 `netrun.round` 數每一層用了幾個探索回合；戰鬥的回合數從那一場結束的報告加進來。
5. **層與層之間的休息**：下去之前自動 RAM 回滿（戰鬥外本來就滿）、感載 −10（不是歸零：迷宮館的休息點照 8.2）。
6. **結算**（聽 `netrun.close`）：破關（`done`）——評價照總回合數對標準的比例與倒下的人數，獎金乘評價、退押金、館主的獎品表擲一次、籌碼照算；打輸或全員拔線——押金沒收、籌碼照算到那一刻、沒有戰敗的後果以外的損失。收回比賽甲板。
7. 館裡沒有追蹤度（區的 `pressure: 'none'`：開的戰鬥沒有 `field.trace`）；倒下不加沉溺（`field.safe`）。

## 驗收條件（`engine/tests/features/M3-maze.test.ts`；測試自帶 `maze_rule` 的小表、一張寶箱表與一張獎品表、三個遊戲敵人；`netrun` 用真的（測試可以裝它），`deck_rental` 用替身或真的）

- 三組各自的條件：新手組拿到比賽甲板；公開組帶 III 級構裝被擋並有原因；錢不夠付押金被擋。
- 開的地圖是 9 × 7、三層；每層的遭遇、機關、寶箱數量對；戰鬥沒有追蹤度、有人昏過去沉溺不變。
- 機關：成功變地板；失敗感載照等級加、可以再試。
- 寶箱：固定種子擲到表的某一列、效果套用；寶箱怪那一次開了戰鬥。
- 走完三層：`maze.result` 的評價對——回合數剛好在標準以內、沒有人倒下是 S（門檻照規則）；獎金 = 表上的 × 倍率；押金退回；比賽甲板收回。
- 第二層全員拔線：押金沒收、籌碼留著、狀態清乾淨。
- 把 `features/maze` 拿掉，`netrun` 照樣跑得起來；把 `netrun` 拿掉，`maze` 的報名被擋並有原因（「迷宮館現在沒有開放。」）。
- `npm test`、`npx tsc --noEmit`、分層檢查全過。

## 依賴

M3-netrun-nodes（`netrun.round`、`netrun.close`、區的 `safe`）、M3-dive（從接入點過去；測試可以直接報名）。和 M3-netrun-dig 可以同時做。

## 完成時回報

改了哪些檔、測試結果、**接縫夠不夠**（為了做這個功能，`netrun` 或核心少了什麼掛點或資料；這是這一張最重要的回報）、CYBERSPACE 8.2 節沒做的（延長賽、直播、主題、十二條詞條）。
