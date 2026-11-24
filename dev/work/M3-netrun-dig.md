# M3-netrun-dig

- 交給：cpp-feature（sonnet）　（**第二波**）
- 目標：`netrun` 的第三張：自己去挖的一般子網——多層、照設施類型決定層數、每層照密度表放東西、詞條、離開之後留著（七天內再進去是同一張圖）、後門、離開時留下的敵對值、探索的時間。
- 規格出處：CYBERSPACE 8.1 節（「每一層的密度」的一般子網那一列、「共通詞條」、「帶出去才算數」）、8.3 節（全部：兩種進去的方式、設施類型的表、每一層放什麼、追蹤度在生成的子網裡、各家企業的表與詞條只看欄位）；NETRUNNING 第 4 節（後門）、第 5 節（登出時留下的敵對值、起始值）；DATA 第 10 節（`subnet` 那一列的欄位）；dev/adr/0018 第六節與 N1、N2、N16。
- 可以改的路徑：`engine/src/features/netrun/`、`engine/tests/features/M3-netrun-dig.test.ts`。
- 可以用的介面：M3-netrun、M3-netrun-nodes 的全部；`k.effects`（`hostility`，有人登記才給）；條件 `hostility_tier`；`time` 變更；地圖實例的 `owner` 與 `ext`（留著的子網）；`time.passed` 掛鉤（過期的清掉）。
- 不可以做的事：不 import 別的功能；十二家企業各自的脾氣不寫程式（做成規則表的欄位，寫得出來的寫、寫不出來的列在回報）；檔案庫的內容、提貨單、髒錢不寫；手工的子網不做；共同的規定見 dev/work/M3-plan.md。

## 新的格式與鍵

- 活動 `netrun` 的 `setup` 多：`entry: 'dig'`、`facility`（設施類型的 id）、`site`（這座子網的鍵：同一個鍵七天內是同一張圖）、`from_backdoor?`（從哪一層的後門進來）。
- 內容種類 `net_facility`（設施類型，CYBERSPACE 8.3 的表；`overridable`）：`{ name, layers: 層的名字[], airgap_at?: 等級, controls: 每層幾個 }`。
- `net_region` 的 `subnet` 多：`affixes?: 詞條的 id[]`；內容種類 `net_affix`（`{ name, region?, fx: { …只收封閉的鍵… } }`）：`foe_plus`、`foe_minus`、`patrol_plus`、`no_patrol`、`archive_plus`、`archive_minus`、`trap_minus`、`trap_marked`、`layer_plus`、`oneway`、`gate_dc`、`trace_start`、`white_plus`、`all_pink`、`check_mod`、`first_ambush`（第一場我方先手）、`hot_spot`（一場遭遇等級 +1、它後面的檔案庫多擲一次）。
- `netrun_rule` 多：`round_minutes`（自己的那一趟每個探索回合算幾分鐘，暫定 5；委託的階段不算）、`keep_days`（7）、`revisit_trace`（再進去從上次離開時的一半起算）、`located_foe_plus`（被定位過的子網七天內每層的遭遇多一個雜兵）、`leave_hostility`（離開時每多少追蹤度那家的敵對值 +1，暫定 20，進位、最多 5；被定位另外 +5）。
- 留著的子網：地圖實例不關，`owner` 是 `netrun:dig:<site>`，`ext.net` 多 `left: { at, trace, located? }`、`backdoors: 圖的 id[]`。

## 要做的

1. **生成**：層數與每層的名字照設施類型；每一層照密度表放（遭遇 2～3、巡邏 1、檔案庫 1～2 再加「自己去挖每層多一個」、陷阱 1～2、休息點 1）；閘門前那一場是層主（6 點）、最後一層的最後一場是首領戰（8 點）、其餘一般（4 點）；遭遇的組合用和委託同一套點數（位階的組合由這個功能照預算排，兵種交給 `enemy_pick`）。III 級以上多擲一次共通詞條。詞條在組 `spec` 之前套。
2. **進去的起點**：追蹤度照 N16（那家的敵對值分段）；七天內再進同一座，從上次離開時的一半起算（兩者取高的）；從後門進來是 0。
3. **後門**（安全點）：站在上面可以登出；有主控的人可以花一個探索回合在這一層「留後門」（記進 `backdoors`），下次可以直接從這一層進來。被定位之後每個後門各有一半的機會被清掉。
4. **離開**：正常離開（登出、拔線、從最後一層出去）東西全部帶走；留下的敵對值照離開時的追蹤度（`leave_hostility`）。地圖實例留著、記下 `left`。
5. **再進去**：同一個 `site`、沒過期，用留著的那一份（處理過的節點、拿過的檔案庫、打掉的遭遇都照舊；巡邏重放）；過期（`keep_days`）的在 `time.passed` 清掉，下次重新生成。被定位過的，七天內每層的遭遇多一個雜兵。
6. **時間**：自己的那一趟每個探索回合加 `round_minutes`；戰鬥不另外算。
7. **結束**：打完最後一層從出口離開是 `done`；其餘照 M3-netrun。

## 驗收條件（`engine/tests/features/M3-netrun-dig.test.ts`；測試自帶兩種設施類型（兩層、四層）、五條詞條、一個勢力的六種蕾絲）

- 兩層的設施生成兩張圖、四層的四張；每層的遭遇、檔案庫、陷阱、休息點數量在密度表的範圍內（二十個種子）；最後一層的最後一場是首領戰的預算。
- 詞條各驗一條：`foe_minus` 少一場、`no_patrol` 沒有巡邏、`trap_marked` 陷阱一開始就看得到、`layer_plus` 多一層、`trace_start: 10` 從 10 起算。
- 走完兩層從出口離開：`done`、東西都在、時間照探索回合數加、那家的敵對值照離開時的追蹤度加。
- 中途登出再進同一座：版面、處理過的節點一樣，追蹤度是上次的一半；過了八天再進去是新的一張。
- 留後門之後從那一層進來、追蹤度 0。
- 被定位：後門照固定的骰面被清掉、再進去每層的遭遇多一個雜兵、敵對值多 5。
- 留著三座子網的存檔讀回來一樣；存檔的大小在回報裡給一個數字。
- `npm test`、`npx tsc --noEmit`、分層檢查全過。

## 依賴

M3-netrun-nodes、M3-dive（從接入點進來；測試可以直接 `launch`）。和 M3-maze 可以同時做（不同的資料夾）。

## 完成時回報

改了哪些檔、測試結果、CYBERSPACE 8.3 節十二家企業的「脾氣」與兩張詞條表逐條的狀態（寫得出來／要加鍵／要內容）。
