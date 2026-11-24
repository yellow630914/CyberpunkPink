# M3-dive

- 交給：cpp-feature（sonnet）　（**第二波**；使用者不要第二波時不做）
- 目標：新功能 `dive`：在接入點潛入、在網內選去處、登出回到身體。它是自己潛進去的那幾種玩法（自己去挖的子網、迷宮館、之後的固定區塊）共用的外層。
- 規格出處：CYBERSPACE 2.1～2.4 節（兩種連線、接入點、誰能進、身體）、第 1 節的表（時間一比一、倒下之後）、4.1 節（倒下一小時內不能再潛入）、4.3 節（SKIN 在接入點換）；NETRUNNING 第 3 節；EVENTS 3.3 節的表（子網與內海：登入與登出 10%）、4.3 節；DATA 第 12 節（設施的種類）；dev/adr/0018 第八節與 N30；dev/adr/0016 第一節。
- 可以改的路徑：`engine/src/features/dive/`（新）、`engine/src/features/index.ts`、`engine/tests/features/M3-dive.test.ts`。
- 可以用的介面：`k.activity.define`／`allow`、報告的 `launch`／`triggers`；`k.grid.usesOf`（站在設施上列「潛入」）；內容 `facility_type`（`functions` 裡的 `dive`）；條件 `at_facility`（城市的功能登記的，沒有就不列）；效果 `deck_rental`、`move`（有人登記才用）；衍生數值 `deck_grade`；`actor.conditions`（`net_burn`）；`actor.ext.bridge`（有沒有橋：共用的資料慣例）；掛鉤 `activity.end`；`cash` 變更。
- 不可以做的事：不 import `features/netrun`、`features/deck`、`features/world`、`features/rest`；委託副本的內海面不經過這裡；不做投影（走在現實裡看網路）、帶潛、身體在現實出事（事件的內容）、多人一起潛的接入艙；固定區塊的內容不寫；共同的規定見 dev/work/M3-plan.md。

## 新的格式與鍵

- 活動 `dive`（order 85）。放行的 doing：`commit:dive.`、`netrun.start`、`commit:netrun.`、`commit:maze.`、`grid.`、`commit:grid.`、`commit:world.`、`battle.`、`commit:battle.`、`chain:battle_end`、`battle.retry`、`event.start`、`commit:event.`、`commit:defeat.`、`commit:trade.`、`commit:npc.`、`commit:deck.skin`、`chain:free_action`。
- 設施種類的資料（`facility_type`）多 `dive?: { fee?: number, rental?: 甲板的 id, deposit?: number, safe?: 0～3 }`（`functions` 有 `dive` 的才讀）。
- 內容種類 `net_site`（網內去得了的地方，一筆一個）：`{ name, kind: 'netrun' | 'block', need: 'deck' | 'rental' | 'any', setup?: 開那一趟的設定（kind 是 netrun 時原樣交給活動 netrun；可以寫 by: 'maze' 這類讓別的功能接手）, block?, marker?, when?: 條件 }`。
- 狀態 `state.ext.dive`：`{ since, body: { location, at? }, access: { facility?, type, safe }, deck: 'own' | 'rental' | 'none', paid?: { fee, deposit } }`。
- 報告：`dive.enter`、`dive.go`（選一個去處）、`dive.exit`。觸發點 `login`、`logout`（範圍「子網與內海」）。
- 匯出：`diveOptions(k, state)`（這裡能不能潛入、費用、為什麼不行）、`enter`、`sites(k, state)`（去得了的地方與去不了的原因）、`go`、`exit`、`diveView`。

## 要做的

1. **潛入**：站在帶 `dive` 的設施上才行；主角要有橋、沒有 `net_burn`；付得起費用與押金（現金；付不出來就是做不成）。自己有甲板用自己的；沒有而這裡有租的，給租用的甲板（效果 `deck_rental`）；都沒有就是訪客。記下身體的位置。
2. **去處**：`sites` 照 `net_site` 列——`need: 'deck'` 的要自己的甲板、`'rental'` 的租的也行、`'any'` 訪客也能去；`when` 不成立的不列。`go`：`kind: 'netrun'` 的 `launch` 一趟（`origin.by: 'dive'`，或資料寫的那個功能）；`kind: 'block'` 的用 `move` 效果把人放到那一塊（沒有人登記 `move` 就灰掉）。
3. **那一趟結束**（聽 `activity.end`，`origin.by` 是 `dive` 的）：`left`、`done` 回到選去處；`located` 與戰敗被接受之後，自動登出（下面那一步），租用的押金沒收。
4. **登出**：不在一趟行程裡才行；人回到身體的位置（在區塊上時用 `move` 放回去）、收回租用的甲板、退押金（沒被沒收的話）、帶觸發點 `logout`。
5. 潛入期間現實的事都做不了（白名單以外的被擋，原因一句：「你的意識在網內，身體躺在<接入點>。先登出。」）。

## 驗收條件（`engine/tests/features/M3-dive.test.ts`；測試自帶一種帶 `dive` 的設施（費用 30、租用一副 2 槽的甲板、押金 50）、兩筆 `net_site`（一筆 `netrun`、一筆只有自己的甲板能去）；`netrun`、`deck_rental`、`at_facility` 用測試的替身）

- 不在那種設施上：`diveOptions` 說不行並有原因；沒有橋、帶著 `net_burn`、錢不夠各一句。
- 沒有甲板的主角潛入：現金少 80、`deck_rental` 被叫到、狀態記著身體的位置；有甲板的只少 30。
- 潛入中：替身的 `rest.`、`transit.`、`fixer.` 報告被擋；清單上的放行。
- `sites`：租用甲板的人看得到兩筆、其中「要自己的甲板」那一筆灰掉並有原因。
- `go` 開了替身的 `netrun`；它交回 `left` 之後還在潛入中、可以再去；交回 `located` 之後自動登出、押金沒退。
- 登出：位置回到潛入前、`deck_rental` 收回、押金退回、報告帶 `logout` 觸發點；一趟行程進行中登出被擋。
- 存檔再讀，潛入的狀態一樣。
- `npm test`、`npx tsc --noEmit`、分層檢查全過。

## 依賴

M3-deck（`deck_rental`、`deck_grade`）、M3-netrun（活動 `netrun` 的 `setup` 與 `outcome`）。做完才能開 M3-netrun-dig、M3-maze、M3-ui-dive。

## 完成時回報

改了哪些檔、測試結果、放行清單、CYBERSPACE 第 2 節沒做的（預期：投影、帶潛、接入艙、舊網節點、身體出事）。
