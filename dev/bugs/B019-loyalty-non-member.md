# B019：AI 給不在名冊上的人忠誠，照收並寫進結果
- 發現者：cpp-tester-boundary（M2 量表 × AI_TASKS 2.5 的邊界測試）
- 嚴重度：小問題（那個人之後進名冊時 `roster.join` 用 `set` 蓋掉，數字不會留下來；但這一次的結果寫「忠誠（街坊小周）：+5」，正文會寫出一個不存在的關係，存檔裡多一個沒用的鍵）
- 規格出處：NPC_SYSTEM 10.4 節：「忠誠（0～100）是他對你這個老闆的信任……只有名冊上的人有」；EVENTS 2.4 節的上限表（`loyalty` 個人 ±10，出處 NPC_SYSTEM 10.4）。
- 實際行為：委託情境裡（名冊上有行者 `a_tw_runner`），AI 給 `{ kind: 'loyalty', key: 'npc_tw_friend', amount: 5 }`（街坊，不在名冊上）：沒有錯誤、沒有提醒，`state.meters.loyalty.npc_tw_friend = 35`，結果的那一行是「忠誠（街坊小周）：+5」。對照：名冊上的行者 30 → 35，是對的。
- 重現：engine/tests/boundary/fixtures/B019-loyalty-non-member.json（種子 6）；會失敗的測試 engine/tests/pending/B019-loyalty-non-member.test.ts（第一個照預期失敗，「對照」會過）。
- 可能的位置（只寫推測，不改）：`engine/src/features/roster/index.ts` 定義 `loyalty` 量表的地方；核心的量表效果（`core/rules/meters.ts`）沒有「這個鍵現在算不算數」的掛點，要嘛 `MeterDef` 多一個 `accepts(state, key)`（不接受的整筆拿掉並提醒），要嘛 roster 另外註冊一個效果的檢查。屬於核心的話是 cpp-architect 的範圍。

- fixed in: 2026-11-23 M2 修 bug 批。用同一個 `MeterDef.accepts`（見 B018）：忠誠量表（`features/roster`）對不在名冊上的人回「忠誠只有名冊上的人有。」，AI 與玩家要的那一筆整筆拿掉並提醒、不留結果的一行、不佔同一批合計的量；內建的結算（出身的名冊、每週的冷落）照寫的算。回歸測試：`engine/tests/boundary/B019-loyalty-non-member.test.ts`、`engine/tests/features/M2-fix-bugs.test.ts`「B019」。
