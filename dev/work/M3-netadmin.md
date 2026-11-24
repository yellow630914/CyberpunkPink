# M3-netadmin

- 交給：cpp-feature（sonnet）
- 目標：`netcombat` 的第三張：潛網者的七種管理行動（造牆、拆牆、斷路、接管、破解、擦痕跡、標記），敵方的潛網者也用同一組；裝著的駭入程式改它們的數字。
- 規格出處：CYBERSPACE 6.6 節（全部）、第 5 節潛網者那一列；NETRUNNING 第 3 節；SKILL_TREES 潛網者的招牌「主控」的內海欄（次數、檢定的加值，只看機制要留哪些口）；ITEMS 11.5 節（駭入程式改的是哪些數字）、11.4 節「後門鑰匙」（戰鬥中等於破解）；dev/adr/0018 第一節（管理行動那一條）與 N10、N31。
- 可以改的路徑：`engine/src/features/netcombat/`（新增 `admin.ts`）、`engine/tests/features/M3-netadmin.test.ts`。
- 可以用的介面：M3-netcombat、M3-netcombat-out 的全部（`net.trace`、`unit.ext.net.admin`、`unit.uses`）；`run.raiseCover`、`run.lowerCover`、`run.cutSlot`（M3-core-battle 補的：一格在某一輪結束前不能換位進出、補位跳過它）、`run.applyStatus`、`run.save`、`run.effects`（接管用快駭功能註冊的 `hack.takeover`；`k.battle.getEffect` 查不到就是沒有裝）；修正 `admin_uses`、`action_ram`、`save`（帶標籤）；`unit.ext.deck.constructs` 與內容 `construct` 的 `admin` 欄位。
- 不可以做的事：不 import `features/hack`、`features/abilities`；地圖上的破解、接管、擦痕跡（探索中）是 M3-netrun-nodes 的事，這一張只有戰鬥裡的；「改寫地形」（駭入程式帶來的新行動）不做；共同的規定見 dev/work/M3-plan.md。

## 新的格式與鍵

- 行動（`modes: ['net']`、圈 `skill`、標籤 `admin` 與 `admin:<名字>`；`has` 看單位的 `admin` 標籤；**行動點都是 0**）：

  | id | RAM | 目標 | 效果 |
  |---|---|---|---|
  | `adm_wall` | 2 | 我方一格 | 遮蔽升一級、耐久補滿 |
  | `adm_breach` | 2 | 敵方一格 | 遮蔽降一級，不必過耐久 |
  | `adm_cut` | 2 | 敵方一格 | 這一輪結束前那一格不能換位進出、補位跳過 |
  | `adm_seize` | 3 | 敵方掛著的一台 | 那一台一回合是我方的（`hack.takeover`） |
  | `adm_crack` | 2 | 無 | 開出離開這一場的路：全隊立刻脫身，結果 `fled`（N31） |
  | `adm_wipe` | 1 | 無 | 追蹤度 −5 |
  | `adm_mark` | 1 | 一個敵人 | 標記：全隊打他 +2，到他下次過載 |

- 每回合的次數 = `unit.ext.net.admin`（基數：角色是主控的樹階，由技能那一邊在 `unit.ready` 寫；敵人由資料寫）加修正 `admin_uses`；用掉的記在 `unit.uses['turn:admin']`（回合開始核心會清）。匯出 `adminLeft(view, unit)` 與 `spendAdmin(run, unit, n)`（技能「1 次管理行動」的消耗也呼叫它；這兩個函式另外登記成效果 `net.admin_spend`，讓不能 import 的功能用）。
- 駭入程式的資料（`construct` 的 `admin`）：`{ <wall|breach|cut|seize|crack|wipe|mark>: { ram?, bonus?, levels?, slots?, turns?, amount?, targets?, fail_trace? } }`。
- `netcombat_rule` 加 `admin: { 每一種的 ram 與數字, trace: 1, fail_trace: 5 }`。

## 要做的

1. 每一種都要過一次檢定：智識加介面，標籤 `admin` 與 `admin:<名字>`。DC（N10）：造牆、拆牆、斷路、破解、擦痕跡對 `origin.ext.net.dc`（開戰的人給的地圖 DC；沒有就照場景的等級 10、13、16、19、22）；標記與接管對目標的防火牆（走核心 `check` 效果的 `vs: { firewall: true }`，精英與首領照它的寫法）。失敗：RAM 照花、沒有效果。
2. 每做一次追蹤度 +1（加修正 `trace_admin`，最少 0）；檢定失敗再 +5。只有我方做的才加；沒有追蹤度的場地不加。
3. 次數用完時七個都灰掉，原因寫出這一回合有幾次、用了幾次。
4. 破解（N31）：成功就 `run.finish('fled', …)`，那一拍的 `data.cracked` 是 true（在地圖上的那一趟靠它知道這一場算過了）。帶著工具構裝「後門鑰匙」這一類（資料的 `do` 寫 `{ op: 'net.crack' }`）的人沒有主控也做得到：把「破解成功」做成效果 `net.crack`，行動與工具都用它。
5. 駭入程式：裝著的每一件照 `admin` 改對應行動的數字（RAM、檢定加值、降幾級、幾格、幾回合、擦多少、標幾個、失敗時追蹤度加多少）；淺檔時不算（ITEMS 11.7：專屬構裝淺檔不能用，駭入程式跟著主控走）。
6. 敵方的潛網者：`aiScore`——自己那一格沒有掩體時造牆、目標站在掩體後面時拆牆、其餘標記正在被集火的人；一回合照它的次數做。敵人做的不加追蹤度。
7. 每個行動寫齊 `icon`（`admin`）、`picks`、`blocks`。

## 驗收條件（`engine/tests/features/M3-netadmin.test.ts`；單位直接給、帶 `admin` 標籤與 `unit.ext.net.admin: 2`）

- 沒有 `admin` 標籤的人圓環上沒有這七個；有的人有，行動點是 0。
- 一回合做兩次之後第三次灰掉，原因寫「2 次」；下一回合又可以；測試給 `admin_uses` +1 的修正時是三次；全檔再 +1。
- 釘死骰面成功：造牆之後那一格高一級、耐久是滿的；拆牆低一級；斷路的那一格這一輪站在上面的人換不了位、後面的人補不進來，下一輪恢復；標記的目標被打時命中 +2，他過載之後標記沒了；擦痕跡之後追蹤度是原本 +1 −5。
- 檢定失敗：RAM 少了、沒有效果、追蹤度 +1 +5。
- DC：`origin.ext.net.dc` 是 16 時造牆對 16；沒寫、場景 III 級也是 16；標記對目標的防火牆。
- 破解成功：結果是 `fled`、`data.cracked` 是 true；帶著「後門鑰匙」的工具（測試的資料）沒有 `admin` 標籤也做得到、用完那一件從這一場消失。
- 裝著「擦 −10」的駭入程式（測試的資料）：擦痕跡是 −10；換到淺檔變回 −5。
- 接管：沒有裝快駭功能時那個行動灰掉，原因是完整的句子；裝了之後敵方掛著的一台一回合聽我方的。
- 敵方潛網者（`admin: 1`）在自己那一格是暴露時會造牆，一回合不超過一次，追蹤度不因此增加。
- `spendAdmin`：技能替身花掉一次之後，這一回合只剩一次。
- `npm test`、`npx tsc --noEmit`、分層檢查全過。

## 依賴

M3-netcombat-out；`run.cutSlot`（M3-core-battle）。做完才能開 M3-skill-net-a。

## 完成時回報

改了哪些檔、測試結果、ITEMS 11.5 節八個駭入程式裡寫不出來的（預期：改寫地形）。
