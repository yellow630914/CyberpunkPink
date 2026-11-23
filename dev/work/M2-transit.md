# M2-transit

- 交給：cpp-feature（sonnet）
- 目標：新功能 `transit`：公共交通。在車站上車、等車、一站一站坐、選一站下車；浮空計程車點到點。車資、時間、進站的掃橋、每站的觸發點。
- 規格出處：DISTRICTS 1.2.1 節全部（路線的表、車資、「搭車」那一段）；EVENTS 3.1 節（`transit_wait`、`transit_stop`、`transit_taxi`）；UI 3.13、3.14 節；LIFE 2.1 節（進站掃橋）；dev/adr/0016 第一、六節。
- 可以改的路徑：`engine/src/features/transit/`（新）、`engine/src/features/index.ts`、`engine/tests/features/M2-transit.test.ts`。
- 可以用的介面：`k.grid.usesOf`（在車站設施上列「搭車」）、`k.activity.define`（車上是一種活動）、報告的 `launch`（進站的 `scan`）、`activity.end`、效果 `move`（M2-world）經 `k.effects.resolve`、條件 `at_facility`、`state.rules.fastTravel`、`deriveRng`。
- 不可以做的事：車廂裡的人與車上能做的每一件事（那是別的功能照活動的放行接上來）；自己的車；不 import `features/world`、`features/security`；共同的規定見 dev/work/M2-plan.md。

## 新的格式與鍵

- 內容種類 `transit_line`：`{ id, name, kind: 'metro' | 'light_rail' | 'bus' | 'ferry', stops: [{ id, name, block, at: 標記 id }], minutes_per_stop, wait: [最少, 最多], fare: { base, per_stop }, pay: ['cred' | 'cash'], scan?: 強度, night?: false, loop? }`；另一筆規則 `transit_rule`（計程車的起跳與每公里、兩區之間的公里數表、哪些區不去）。
- 狀態 `state.ext.transit`：去過的站、現在這一趟（哪條線、方向、到第幾站、目的地、付的是哪一種錢）。
- 活動 `ride`（`order` 80；放行 `commit:transit.`、`commit:event.`、`event.start`、`chain:free_action`、`commit:npc.`）。
- 報告：`transit.board`、`transit.wait`、`transit.stop`（坐一站）、`transit.alight`、`transit.taxi`（出發與抵達各一份）。

## 要做的

1. 上車：站在車站設施上才行；深夜停駛的線給原因；車資照表、付不出來給原因；線寫了 `scan` 的先掃橋（報告帶 `launch` 一個 `scan`，等它的 `activity.end`：沒過就不上車、車資不扣）。
2. 等車：照班距在範圍裡擲幾分鐘，那一份帶 `transit_wait`。
3. 坐一站：時間照線、帶 `transit_stop`（`where` 帶線、時刻是尖峰或深夜）；到終點站一定要下車；環線繞回去。目的地只是記號：到了不會自動下車，介面自己決定要不要停。
4. 下車：用 `move` 把人放到那一站所在的街區與標記；那一站記成去過。
5. 計程車：只去去過的站（存檔規則可以放寬）、有些區不去、`fastTravel` 關著時不能叫；車資 = 起跳 ＋ 每公里 × 公里數，乘目的地那一區的物價（低於 1 當 1），帳戶付；出發與抵達各一份報告、各帶 `transit_taxi`；時間 10 分鐘。
6. 對外：`transitView(k, state)`（這個車站停哪幾條線、每條線現在開不開與原因、每一站的車資與幾分鐘；車上時：路線條、到了第幾站、還有幾站）。

## 驗收條件（測試自帶一條四站的地鐵、一條環線、兩個區）

- 不在車站上不能上車；深夜的地鐵被擋並有原因；錢不夠被擋。
- 坐兩站：時間多了等車加兩站的分鐘數，錢少了起跳加兩站；每一站的報告帶 `transit_stop`。
- 下車之後人在那一站的街區、站在車站的標記上，活動 `ride` 結束；車上時走地圖被擋下。
- 有 `scan` 的線：掃橋的替身回 `passed: false` 時沒有上車、沒有扣錢。
- 用現金買票的那一趟狀態裡記的是現金。
- 終點站不下車被擋；環線坐一圈回到上車的那一站。
- 計程車：沒去過的站被擋；`fastTravel` 關著被擋；車資對得上公式；兩份報告各帶觸發點。
- 同一個種子等車的分鐘數一樣；車上存檔再讀接著坐。

## 依賴

M2-world、M2-security（掃橋；測試可以用替身）、M2-core-activity。

## 完成時回報

改了哪些檔、測試結果、DISTRICTS 1.2.1 節裡沒做的（預期：車廂裡的人、看窗外、渡輪帶貨與人情付費、乘客紀錄被調出來）。
