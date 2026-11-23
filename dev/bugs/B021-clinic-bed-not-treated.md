# B021：睡在診所的病床不算「傷口處理過」，重傷的人睡了 50 塊的病床只回到一半
- 發現者：cpp-tester-whitebox（M2 白箱：rest 的睡一覺各條分支）
- 嚴重度：小問題（花了錢卻拿不到診所該有的回復；不會讓狀態壞掉）
- 規格出處：DOWNTIME 2.3 節的表：「診所的病床 | 60%，算處理過 | — | 50／晚，另付治療費」；2.2 節重傷限制：「處理過＝急救成功、診所治療、用過急救凝膠，或睡在有醫療床的據點」；dev/work/M2-rest-housing.md 只寫「身上沒有 `treated` 的人最多回到一半」（工單只讀 treated，沒有寫設施給不給 treated）。
- 實際行為：`features/rest/ops.ts` 的 `sleepDraft` 判斷重傷限制只看 `hasCondition(state, who, 'treated')`；睡在有 `sleep` 的設施（診所：`facility_types.json` 的 `clinic` 是 `sleep: { rate: 0.6, cost: 50 }`）不會讓人算處理過。生命 5／40 沒有處理過的人睡診所：付 50、回到 20（一半）；規格是回到 29（5 + 60% × 40）。對照：身上有 `treated` 的人睡同一間回到 29。
- 重現：engine/tests/whitebox/fixtures/B021-clinic-bed-not-treated.json（診所的小街、生命 5、體格 10、種子 7）；會失敗的測試 engine/tests/pending/B021-clinic-bed-not-treated.test.ts（第三筆照預期失敗，前兩筆對照會過）。
- 可能的位置（只寫推測，不改）：`engine/src/features/rest/ops.ts` 的 `sleepDraft`（`hurt_ratio` 那一段）與 `engine/src/features/rest/model.ts` 的 `sleepFacilityAt`／`sleepProblems`：facility_type 的 `sleep` 多一個欄位（例：`treated: true`，診所寫、旅館與潛艙店不寫），睡在那種設施時重傷限制不套用；資料 `engine/data/rules/facility_types.json` 的 clinic 要跟著加。自己據點的「診療室（醫療床）」（DOWNTIME 7.4）同理，那是 M3 之後的據點。屬於 cpp-architect 決定欄位名稱、cpp-feature 實作。
