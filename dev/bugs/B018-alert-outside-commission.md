# B018：AI 給的警戒在副本外也收，key 寫不存在的地圖實例也收
- 發現者：cpp-tester-boundary（M2 量表 × AI_TASKS 2.5 的邊界測試）
- 嚴重度：小問題（城市裡的警戒沒有人讀，但會在存檔裡留下沒用的鍵，報告的結果寫「警戒：+5」，正文會照它寫；不存在的 id 照收違反「引用的 id 要存在」）
- 規格出處：EVENTS 2.4 節的上限表：「`alert`、`trace` | 警戒只在委託副本裡；追蹤度在委託副本與企業的固定子網裡；±20」；EVENTS 3.4 節（副本裡的事件效果以警戒、追蹤度為主）；AI_TASKS 2.5 節（設定關著也照擋：「引用的 id 要存在」）。
- 實際行為：
  - 人在城市的街區地圖（塔下，實例 `m1`，不在副本裡），AI 給 `{ kind: 'alert', amount: 5 }`：照收，`state.meters.alert.m1 = 5`。
  - AI 給 `{ kind: 'alert', key: 'm999', amount: 1 }`（沒有這張實例）：照收，`state.meters.alert.m999 = 1`；城市裡、副本裡都一樣。
  - 對照：副本裡照收、+21 夾在 +20，是對的。
- 重現：engine/tests/boundary/fixtures/B018-alert-outside-commission.json（種子 6；城市與副本兩個情境、四筆輸入與期望）；會失敗的測試 engine/tests/pending/B018-alert-outside-commission.test.ts（前兩個照預期失敗，「對照」會過）。
- 可能的位置（只寫推測，不改）：`engine/src/core/state/meters.ts` 的 `meterKeyProblems`，`keyed: 'map'` 走 `default: return []`，沒有查 `state.maps.instances` 有沒有這個 key（核心，cpp-architect）；「只在副本裡」是量表定義的事，可以讓 `MeterDef` 帶一個「AI 給的時候要在哪種活動裡」的條件，或由 explore 定義 alert 時用 `adjust`／新的掛點擋掉不是副本地圖的鍵。內建的事件照寫的算（EVENTS 2.4 開頭），要不要也擋由 architect 定。

- fixed in: 2026-11-23 M2 修 bug 批。兩處：(1) 核心 `meterKeyProblems` 對 `keyed: 'map'` 查地圖實例存在（效果與核心的 `meter` 變更都擋，不存在的 key 是格式錯誤、整批不收）；(2) 新的量表欄位 `MeterDef.accepts(state, key)`：來源不是內建的效果，這個鍵現在不收就整筆拿掉並提醒；警戒（`features/explore`）問活動登錄表有沒有進行中的 `commission`（探索不認識委託）。內建的事件照寫的算。回歸測試：`engine/tests/boundary/B018-alert-outside-commission.test.ts`、`engine/tests/features/M2-fix-bugs.test.ts`「B018」、`engine/tests/core/meters.test.ts`。
